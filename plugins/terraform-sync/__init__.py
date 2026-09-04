# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/terraform-sync/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: terraform-sync — ProxmoxVEx Plugin
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
terraform-sync — ProxmoxVEx Plugin
Export ProxmoxVEx-managed resources to Terraform and keep state in sync.
"""

import contextlib
import io
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager
from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.core.db import get_db
from ProxmoxVEx.utils.audit import log_audit

PLUGIN_ID = "terraform-sync"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "state.json"
DATA_DIR = PLUGIN_DIR / "data"

BUILTIN_RESOURCE_TYPES = [
    {"id": "proxmox_vm_qemu", "label": "terraformSync.typeVM", "built_in": True},
    {"id": "proxmox_lxc", "label": "terraformSync.typeLXC", "built_in": True},
    {"id": "proxmox_storage", "label": "terraformSync.typeStorage", "built_in": True},
    {"id": "proxmox_node", "label": "terraformSync.typeNode", "built_in": True},
]

SAMPLE_RESOURCES = []


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix=""):
    return f"{prefix}{uuid.uuid4()}"


def _load_state():
    if not STATE_FILE.exists():
        _save_state(_default_state())
        return _default_state()
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return _default_state()


def _save_state(state):
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except OSError as e:
        log.error("Failed to save state: %s", e)


def _default_state():
    return {
        "version": "1.0.0",
        "updated_at": _now_iso(),
        "terraform_state": {
            "resources": [],
            "provider": {
                "required_providers": {
                    "proxmox": {
                        "source": "bpg/proxmox",
                        "version": "0.66.2",
                    }
                },
                "version": "0.66.2",
            },
            "last_sync": None,
            "sync_status": "idle",
        },
        "exports": [],
        "schedules": [],
        "templates": [],
        "audit": [],
    }


def _ensure_state():
    state = _load_state()
    _save_state(state)


def _current_user():
    return getattr(request, "session", {}).get("user", "unknown")


def _audit(action, cluster_id=None, resource_type=None, resource_ids=None, details=None):
    user = _current_user()
    entry = {
        "id": _new_id("audit-"),
        "action": action,
        "actor": user,
        "timestamp": _now_iso(),
        "cluster_id": cluster_id or "",
        "resource_type": resource_type or "",
        "resource_ids": resource_ids or [],
        "details": details or {},
    }
    state = _load_state()
    audit = state.setdefault("audit", [])
    audit.insert(0, entry)
    state["audit"] = audit[:5000]
    _save_state(state)
    with contextlib.suppress(Exception):
        log_audit(user, action, json.dumps(details) if details else "", cluster=cluster_id)


def _manager_or_error(cluster_id):
    if not cluster_id:
        return None, (jsonify({"error": "cluster_id is required"}), 400)
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return None, err
    return get_connected_manager(cluster_id)


def _get_cluster_id_from_request():
    body = request.get_json(silent=True) or {}
    return (request.args.get("cluster_id", "") or body.get("cluster_id", "")).strip()


def _get_resource_type_from_request():
    body = request.get_json(silent=True) or {}
    return (request.args.get("resource_type", "") or body.get("resource_type", "")).strip()


def _fetch_clusters_from_app():
    try:
        db = get_db()
        rows = db.query("SELECT id, name, host FROM clusters ORDER BY name") or []
        return [{"id": r["id"], "name": r["name"], "host": r["host"]} for r in rows]
    except Exception as e:
        log.warning("Failed to load clusters: %s", e)
        return []


def _normalize_vm(raw, cluster_id):
    return {
        "id": str(raw.get("vmid", raw.get("id", ""))),
        "name": raw.get("name", f"vm-{raw.get('vmid', '')}"),
        "node": raw.get("node", ""),
        "status": raw.get("status", "unknown"),
        "type": "proxmox_vm_qemu",
        "cluster_id": cluster_id,
        "attributes": {k: v for k, v in raw.items() if k not in ("id", "vmid")},
    }


def _normalize_lxc(raw, cluster_id):
    return {
        "id": str(raw.get("vmid", raw.get("id", ""))),
        "name": raw.get("name", f"lxc-{raw.get('vmid', '')}"),
        "node": raw.get("node", ""),
        "status": raw.get("status", "unknown"),
        "type": "proxmox_lxc",
        "cluster_id": cluster_id,
        "attributes": {k: v for k, v in raw.items() if k not in ("id", "vmid")},
    }


def _normalize_storage(raw, cluster_id):
    return {
        "id": raw.get("storage", raw.get("id", "")),
        "name": raw.get("storage", ""),
        "node": raw.get("node", ""),
        "status": "active" if raw.get("active", 1) else "inactive",
        "type": "proxmox_storage",
        "cluster_id": cluster_id,
        "attributes": dict(raw.items()),
    }


def _normalize_node(raw, cluster_id):
    return {
        "id": raw.get("node", raw.get("id", "")),
        "name": raw.get("node", ""),
        "node": raw.get("node", ""),
        "status": "online" if raw.get("status") == "online" else "unknown",
        "type": "proxmox_node",
        "cluster_id": cluster_id,
        "attributes": dict(raw.items()),
    }


def _filter_and_sort(items, search, sort, order, limit, offset):
    if search:
        q = search.lower()
        items = [i for i in items if q in (i.get("name") or "").lower() or q in (i.get("id") or "").lower()]
    reverse = order == "desc"
    sort_key = sort or "name"
    with contextlib.suppress(Exception):
        items = sorted(items, key=lambda x: x.get(sort_key, ""), reverse=reverse)
    total = len(items)
    start = max(0, offset)
    end = start + (limit or total)
    return items[start:end], total


def _generate_terraform(resources, resource_type, excluded_fields=None, module=False, provider_version="0.66.2"):
    excluded = set(excluded_fields or [])
    lines = [
        "terraform {",
        "  required_providers {",
        "    proxmox = {",
        '      source  = "bpg/proxmox"',
        f'      version = "{provider_version}"',
        "    }",
        "  }",
        "}",
        "",
        'provider "proxmox" {',
        "  # endpoint = var.proxmox_url",
        "  # api_token = var.proxmox_token",
        "  # insecure = var.proxmox_insecure",
        "}",
        "",
    ]
    if module:
        lines.extend([
            'module "proxmox_resources" {',
            '  source = "./modules/proxmox_resources"',
            "",
            "  resources = {",
        ])
    for r in resources:
        name = (r.get("name") or f"res_{r.get('id')}").replace("-", "_").replace(".", "_")
        attrs = (r.get("attributes") or {}).copy()
        for f in excluded:
            attrs.pop(f, None)
        lines.append(f'resource "{resource_type}" "{name}" {{')
        for k, v in attrs.items():
            if isinstance(v, str):
                lines.append(f"  {k} = {json.dumps(v)}")
            elif isinstance(v, bool):
                lines.append(f"  {k} = {str(v).lower()}")
            elif isinstance(v, (int, float)):
                lines.append(f"  {k} = {v}")
            elif isinstance(v, (list, tuple, dict)):
                lines.append(f"  {k} = {json.dumps(v)}")
        lines.append("  target_node = " + json.dumps(r.get("node") or "pve"))
        lines.append("  vmid = " + json.dumps(r.get("id")))
        lines.append("}")
        lines.append("")
    if module:
        lines.extend([
            "  }",
            "}",
        ])
    return "\n".join(lines)


def _run_drift(live, state_resources):
    state_map = {f"{s.get('type')}/{s.get('id')}": s for s in (state_resources or [])}
    drifts = []
    for r in live:
        key = f"{r.get('type')}/{r.get('id')}"
        state_res = state_map.get(key)
        if not state_res:
            drifts.append({
                "resource_id": r.get("id"),
                "resource_type": r.get("type"),
                "cluster_id": r.get("cluster_id"),
                "live": r.get("attributes", {}),
                "state": {},
                "diff_fields": list(r.get("attributes", {}).keys()),
                "detected_at": _now_iso(),
            })
            continue
        live_attrs = r.get("attributes", {})
        state_attrs = state_res.get("attributes", {})
        diff = []
        for k in set(live_attrs) | set(state_attrs):
            if live_attrs.get(k) != state_attrs.get(k):
                diff.append(k)
        if diff:
            drifts.append({
                "resource_id": r.get("id"),
                "resource_type": r.get("type"),
                "cluster_id": r.get("cluster_id"),
                "live": live_attrs,
                "state": state_attrs,
                "diff_fields": diff,
                "detected_at": _now_iso(),
            })
    return drifts


# ─── Route handlers ─────────────────────────────────────────────────────


def _get_status():
    state = _load_state()
    exports = state.get("exports", [])
    terraform_state = state.get("terraform_state", {})
    return {
        "plugin": PLUGIN_ID,
        "status": terraform_state.get("sync_status", "idle"),
        "last_sync": terraform_state.get("last_sync"),
        "exports_count": len(exports),
        "provider_version": terraform_state.get("provider", {}).get("version", "0.66.2"),
    }


def _get_clusters():
    return {"clusters": _fetch_clusters_from_app()}


def _get_resource_types():
    state = _load_state()
    custom = {e.get("resource_type") for e in state.get("exports", []) if e.get("resource_type")}
    custom_types = [
        {"id": c, "label": c, "built_in": False}
        for c in sorted(custom)
        if c and c not in {b["id"] for b in BUILTIN_RESOURCE_TYPES}
    ]
    return {"resource_types": BUILTIN_RESOURCE_TYPES + custom_types}


def _get_resources():
    cluster_id = _get_cluster_id_from_request()
    resource_type = _get_resource_type_from_request()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    if not resource_type:
        return jsonify({"error": "resource_type is required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err

    search = (request.args.get("search") or "").strip()
    sort = request.args.get("sort", "name")
    order = request.args.get("order", "asc")
    try:
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
    except ValueError:
        limit, offset = 50, 0

    resources = []
    try:
        if resource_type == "proxmox_vm_qemu":
            raw = manager.api_request("GET", "/cluster/resources?type=vm") or []
            for r in raw:
                if r.get("type") == "qemu":
                    resources.append(_normalize_vm(r, cluster_id))
        elif resource_type == "proxmox_lxc":
            raw = manager.api_request("GET", "/cluster/resources?type=vm") or []
            for r in raw:
                if r.get("type") == "lxc":
                    resources.append(_normalize_lxc(r, cluster_id))
        elif resource_type == "proxmox_storage":
            raw = manager.api_request("GET", "/storage") or []
            resources = [_normalize_storage(s, cluster_id) for s in raw]
        elif resource_type == "proxmox_node":
            raw = manager.api_request("GET", "/nodes") or []
            resources = [_normalize_node(n, cluster_id) for n in raw]
        else:
            resources = [
                r for r in SAMPLE_RESOURCES if r["type"] == resource_type and r.get("cluster_id") == cluster_id
            ]
    except Exception as e:
        log.warning("Failed to fetch live resources for %s/%s: %s", cluster_id, resource_type, e)
        resources = [r for r in SAMPLE_RESOURCES if r["type"] == resource_type]

    filtered, total = _filter_and_sort(resources, search, sort, order, limit, offset)
    return {
        "cluster_id": cluster_id,
        "resource_type": resource_type,
        "resources": filtered,
        "total": total,
    }


def _post_export_preview():
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    resource_type = (body.get("resource_type") or "").strip()
    resource_ids = body.get("resource_ids", []) or []
    excluded_fields = body.get("excluded_fields", []) or []
    module = bool(body.get("module", False))
    provider_version = body.get("provider_version", "0.66.2")
    if not cluster_id or not resource_type:
        return jsonify({"error": "cluster_id and resource_type are required"}), 400
    if not resource_ids:
        return jsonify({"error": "at least one resource_id is required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err

    resources = _get_resources_by_ids(manager, cluster_id, resource_type, resource_ids)
    tf = _generate_terraform(resources, resource_type, excluded_fields, module, provider_version)
    return {
        "tf": tf,
        "resource_count": len(resources),
        "cluster_id": cluster_id,
        "resource_type": resource_type,
    }


def _get_resources_by_ids(manager, cluster_id, resource_type, resource_ids):
    all_resources = []
    try:
        if resource_type == "proxmox_vm_qemu":
            raw = manager.api_request("GET", "/cluster/resources?type=vm") or []
            all_resources = [_normalize_vm(r, cluster_id) for r in raw if r.get("type") == "qemu"]
        elif resource_type == "proxmox_lxc":
            raw = manager.api_request("GET", "/cluster/resources?type=vm") or []
            all_resources = [_normalize_lxc(r, cluster_id) for r in raw if r.get("type") == "lxc"]
        elif resource_type == "proxmox_storage":
            raw = manager.api_request("GET", "/storage") or []
            all_resources = [_normalize_storage(s, cluster_id) for s in raw]
        elif resource_type == "proxmox_node":
            raw = manager.api_request("GET", "/nodes") or []
            all_resources = [_normalize_node(n, cluster_id) for n in raw]
        else:
            all_resources = [r for r in SAMPLE_RESOURCES if r["type"] == resource_type]
    except Exception as e:
        log.warning("Live resource fetch failed: %s", e)
        all_resources = [r for r in SAMPLE_RESOURCES if r["type"] == resource_type]
    return [r for r in all_resources if r.get("id") in resource_ids]


def _post_export():
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    resource_type = (body.get("resource_type") or "").strip()
    resource_ids = body.get("resource_ids", []) or []
    name = (body.get("name") or "").strip()
    excluded_fields = body.get("excluded_fields", []) or []
    module = bool(body.get("module", False))
    if not cluster_id or not resource_type:
        return jsonify({"error": "cluster_id and resource_type are required"}), 400
    if not resource_ids:
        return jsonify({"error": "at least one resource_id is required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err

    resources = _get_resources_by_ids(manager, cluster_id, resource_type, resource_ids)
    tf = _generate_terraform(resources, resource_type, excluded_fields, module)

    state = _load_state()
    exports = state.setdefault("exports", [])
    if not name:
        name = f"{resource_type}-{cluster_id}-{_new_id()[:8]}"
    export = {
        "id": _new_id("exp-"),
        "name": name,
        "cluster_id": cluster_id,
        "resource_type": resource_type,
        "resource_ids": resource_ids,
        "excluded_fields": excluded_fields,
        "module": module,
        "resource_count": len(resources),
        "tf": tf,
        "created_at": _now_iso(),
        "created_by": _current_user(),
    }
    exports.insert(0, export)
    state["exports"] = exports[:2000]
    _save_state(state)
    _audit("export", cluster_id, resource_type, resource_ids, {"export_id": export["id"]})
    return {"export": export}


def _get_exports():
    state = _load_state()
    exports = list(state.get("exports", []))
    cluster_id = (request.args.get("cluster_id") or "").strip()
    resource_type = (request.args.get("resource_type") or "").strip()
    search = (request.args.get("search") or "").strip()
    sort = request.args.get("sort", "created_at")
    order = request.args.get("order", "desc")
    try:
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
    except ValueError:
        limit, offset = 50, 0

    if cluster_id:
        exports = [e for e in exports if e.get("cluster_id") == cluster_id]
    if resource_type:
        exports = [e for e in exports if e.get("resource_type") == resource_type]
    if search:
        q = search.lower()
        exports = [
            e for e in exports if q in (e.get("name") or "").lower() or q in (e.get("resource_type") or "").lower()
        ]
    reverse = order == "desc"
    sort_key = sort or "created_at"
    with contextlib.suppress(Exception):
        exports = sorted(exports, key=lambda x: x.get(sort_key, ""), reverse=reverse)
    total = len(exports)
    start = max(0, offset)
    end = start + (limit or total)
    return {"exports": exports[start:end], "total": total}


def _download_export():
    export_id = (request.args.get("id") or "").strip()
    if not export_id:
        return jsonify({"error": "id is required"}), 400
    state = _load_state()
    exports = state.get("exports", [])
    export = next((e for e in exports if e.get("id") == export_id), None)
    if not export:
        return jsonify({"error": "export not found"}), 404
    filename = f"{export.get('name', 'export').replace(' ', '_')}.tf"
    buffer = io.BytesIO(export.get("tf", "").encode("utf-8"))
    return send_file(buffer, mimetype="text/plain", as_attachment=True, download_name=filename)


def _post_re_export():
    body = request.get_json(silent=True) or {}
    export_id = (body.get("id") or "").strip()
    if not export_id:
        return jsonify({"error": "id is required"}), 400
    state = _load_state()
    exports = state.get("exports", [])
    export = next((e for e in exports if e.get("id") == export_id), None)
    if not export:
        return jsonify({"error": "export not found"}), 404
    manager, err = _manager_or_error(export.get("cluster_id", ""))
    if err:
        return err
    resources = _get_resources_by_ids(
        manager,
        export.get("cluster_id", ""),
        export.get("resource_type", ""),
        export.get("resource_ids", []),
    )
    tf = _generate_terraform(
        resources,
        export.get("resource_type", ""),
        export.get("excluded_fields", []),
        export.get("module", False),
    )
    new_export = {
        "id": _new_id("exp-"),
        "name": f"{export.get('name', 're-export')} (re-export)",
        "cluster_id": export.get("cluster_id"),
        "resource_type": export.get("resource_type"),
        "resource_ids": export.get("resource_ids"),
        "excluded_fields": export.get("excluded_fields"),
        "module": export.get("module"),
        "resource_count": len(resources),
        "tf": tf,
        "created_at": _now_iso(),
        "created_by": _current_user(),
    }
    exports.insert(0, new_export)
    state["exports"] = exports[:2000]
    _save_state(state)
    _audit(
        "re_export",
        export.get("cluster_id"),
        export.get("resource_type"),
        export.get("resource_ids"),
        {"original_export_id": export_id, "new_export_id": new_export["id"]},
    )
    return {"export": new_export}


def _delete_export():
    body = request.get_json(silent=True) or {}
    export_id = (body.get("id") or "").strip() or (request.args.get("id") or "").strip()
    if not export_id:
        return jsonify({"error": "id is required"}), 400
    state = _load_state()
    exports = state.get("exports", [])
    export = next((e for e in exports if e.get("id") == export_id), None)
    if not export:
        return jsonify({"error": "export not found"}), 404
    state["exports"] = [e for e in exports if e.get("id") != export_id]
    _save_state(state)
    _audit(
        "delete_export",
        export.get("cluster_id"),
        export.get("resource_type"),
        export.get("resource_ids"),
        {"export_id": export_id},
    )
    return {"deleted": export_id}


def _post_sync():
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    force = bool(body.get("force", False))
    state = _load_state()
    sync_id = _new_id("sync-")
    state["terraform_state"] = state.get("terraform_state", {}) or {}
    state["terraform_state"]["sync_status"] = "in_progress"
    state["terraform_state"]["last_sync"] = _now_iso()
    _save_state(state)
    _audit("sync", cluster_id or "", details={"sync_id": sync_id, "force": force})
    return {"sync_id": sync_id, "status": "in_progress", "started_at": _now_iso()}


def _get_sync():
    sync_id = (request.args.get("sync_id") or "").strip()
    state = _load_state()
    terraform_state = state.get("terraform_state", {})
    if not sync_id:
        return {
            "last_sync": terraform_state.get("last_sync"),
            "status": terraform_state.get("sync_status", "idle"),
            "resources_synced": len(terraform_state.get("resources", [])),
        }
    return {
        "sync_id": sync_id,
        "status": terraform_state.get("sync_status", "idle"),
        "started_at": terraform_state.get("last_sync"),
        "finished_at": terraform_state.get("last_sync"),
        "resources_synced": len(terraform_state.get("resources", [])),
    }


def _post_sync_complete():
    body = request.get_json(silent=True) or {}
    sync_id = (body.get("sync_id") or "").strip()
    status = body.get("status", "success")
    state = _load_state()
    state["terraform_state"] = state.get("terraform_state", {}) or {}
    state["terraform_state"]["sync_status"] = status
    state["terraform_state"]["last_sync"] = _now_iso()
    _save_state(state)
    return {"sync_id": sync_id, "status": status, "finished_at": _now_iso()}


def _get_state():
    state = _load_state()
    return {"state": state.get("terraform_state", {})}


def _get_state_download():
    state = _load_state()
    buffer = io.BytesIO(json.dumps(state.get("terraform_state", {}), indent=2).encode("utf-8"))
    return send_file(buffer, mimetype="application/json", as_attachment=True, download_name="terraform-state.json")


def _post_state_refresh():
    state = _load_state()
    state["terraform_state"] = state.get("terraform_state", {}) or {}
    state["terraform_state"]["last_sync"] = _now_iso()
    _save_state(state)
    return {
        "status": state["terraform_state"].get("sync_status", "idle"),
        "last_sync": state["terraform_state"].get("last_sync"),
    }


def _post_drift():
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    resource_type = (body.get("resource_type") or "").strip()
    resource_ids = body.get("resource_ids", []) or []
    if not cluster_id or not resource_type:
        return jsonify({"error": "cluster_id and resource_type are required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err

    resources = _get_resources_by_ids(manager, cluster_id, resource_type, resource_ids)
    state = _load_state()
    drifts = _run_drift(resources, state.get("terraform_state", {}).get("resources", []))
    _audit("drift", cluster_id, resource_type, resource_ids, {"drift_count": len(drifts)})
    return {"drifts": drifts, "total": len(drifts)}


def _post_drift_import():
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    resource_type = (body.get("resource_type") or "").strip()
    resource_ids = body.get("resource_ids", []) or []
    if not cluster_id or not resource_type:
        return jsonify({"error": "cluster_id and resource_type are required"}), 400
    if not resource_ids:
        return jsonify({"error": "at least one resource_id is required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err

    resources = _get_resources_by_ids(manager, cluster_id, resource_type, resource_ids)
    state = _load_state()
    state["terraform_state"] = state.get("terraform_state", {}) or {}
    existing = {f"{r.get('type')}/{r.get('id')}": r for r in state["terraform_state"].get("resources", [])}
    for r in resources:
        key = f"{r.get('type')}/{r.get('id')}"
        existing[key] = r
    state["terraform_state"]["resources"] = list(existing.values())
    _save_state(state)
    _audit("import", cluster_id, resource_type, resource_ids, {"imported_count": len(resources)})
    return {"imported": resources, "state": state["terraform_state"]}


def _post_import():
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    resource_type = (body.get("resource_type") or "").strip()
    content = (body.get("content") or "").strip()
    data = body.get("data")
    if not content and not data:
        return jsonify({"error": "content or data is required"}), 400
    try:
        parsed = data or json.loads(content)
    except Exception:
        return jsonify({"error": "content is not parseable"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    live = _get_resources_by_ids(manager, cluster_id, resource_type, list(parsed.get("resource_ids", [])))
    state_resources = parsed.get("resources", [])
    drifts = _run_drift(live, state_resources)
    _audit("import_upload", cluster_id, resource_type, details={"drift_count": len(drifts)})
    return {"matches": live, "drifts": drifts, "imported": len(live)}


def _get_schedules():
    state = _load_state()
    return {"schedules": state.get("schedules", [])}


def _post_schedules():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    enabled = bool(body.get("enabled", True))
    try:
        interval_minutes = int(body.get("interval_minutes", 60))
    except ValueError:
        return jsonify({"error": "interval_minutes must be an integer"}), 400
    if interval_minutes <= 0:
        return jsonify({"error": "interval_minutes must be positive"}), 400
    schedule = {
        "id": _new_id("sch-"),
        "name": name or f"Schedule every {interval_minutes} minutes",
        "enabled": enabled,
        "interval_minutes": interval_minutes,
        "created_at": _now_iso(),
    }
    state = _load_state()
    state.setdefault("schedules", []).append(schedule)
    _save_state(state)
    _audit("update_schedule", details={"schedule_id": schedule["id"]})
    return {"schedule": schedule}


def _put_schedules():
    body = request.get_json(silent=True) or {}
    schedule_id = (body.get("id") or body.get("schedule_id") or "").strip()
    if not schedule_id:
        return jsonify({"error": "id is required"}), 400
    try:
        interval_minutes = int(body.get("interval_minutes", 60))
    except ValueError:
        return jsonify({"error": "interval_minutes must be an integer"}), 400
    if interval_minutes <= 0:
        return jsonify({"error": "interval_minutes must be positive"}), 400
    state = _load_state()
    schedules = state.get("schedules", [])
    schedule = next((s for s in schedules if s.get("id") == schedule_id), None)
    if not schedule:
        return jsonify({"error": "schedule not found"}), 404
    schedule["name"] = (body.get("name") or schedule.get("name")).strip()
    schedule["enabled"] = bool(body.get("enabled", schedule.get("enabled")))
    schedule["interval_minutes"] = interval_minutes
    schedule["next_run"] = _calculate_next_run(schedule.get("last_run"), interval_minutes)
    _save_state(state)
    _audit("update_schedule", details={"schedule_id": schedule_id})
    return {"schedule": schedule}


def _calculate_next_run(last_run, interval_minutes):
    if not last_run or not interval_minutes:
        return None
    try:
        last = datetime.fromisoformat(last_run.replace("Z", "+00:00"))
        return (last + timedelta(minutes=interval_minutes)).isoformat()
    except Exception:
        return None


def _delete_schedules():
    body = request.get_json(silent=True) or {}
    schedule_id = (body.get("id") or "").strip() or (request.args.get("id") or "").strip()
    if not schedule_id:
        return jsonify({"error": "id is required"}), 400
    state = _load_state()
    state["schedules"] = [s for s in state.get("schedules", []) if s.get("id") != schedule_id]
    _save_state(state)
    _audit("delete_schedule", details={"schedule_id": schedule_id})
    return {"deleted": schedule_id}


def _get_templates():
    state = _load_state()
    return {"templates": state.get("templates", [])}


def _post_templates():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    template = {
        "id": _new_id("tpl-"),
        "name": name,
        "resource_type": (body.get("resource_type") or "").strip(),
        "module": bool(body.get("module", False)),
        "excluded_fields": body.get("excluded_fields", []) or [],
        "variables": body.get("variables", []) or [],
        "created_at": _now_iso(),
    }
    state = _load_state()
    state.setdefault("templates", []).append(template)
    _save_state(state)
    _audit("save_template", resource_type=template["resource_type"], details={"template_id": template["id"]})
    return {"template": template}


def _put_templates():
    body = request.get_json(silent=True) or {}
    template_id = (body.get("id") or "").strip()
    if not template_id:
        return jsonify({"error": "id is required"}), 400
    state = _load_state()
    templates = state.get("templates", [])
    template = next((t for t in templates if t.get("id") == template_id), None)
    if not template:
        return jsonify({"error": "template not found"}), 404
    template["name"] = (body.get("name") or template.get("name")).strip()
    template["resource_type"] = (body.get("resource_type") or template.get("resource_type")).strip()
    template["module"] = bool(body.get("module", template.get("module")))
    template["excluded_fields"] = body.get("excluded_fields", template.get("excluded_fields"))
    template["variables"] = body.get("variables", template.get("variables"))
    _save_state(state)
    _audit("save_template", resource_type=template["resource_type"], details={"template_id": template_id})
    return {"template": template}


def _delete_templates():
    body = request.get_json(silent=True) or {}
    template_id = (body.get("id") or "").strip() or (request.args.get("id") or "").strip()
    if not template_id:
        return jsonify({"error": "id is required"}), 400
    state = _load_state()
    state["templates"] = [t for t in state.get("templates", []) if t.get("id") != template_id]
    _save_state(state)
    _audit("delete_template", details={"template_id": template_id})
    return {"deleted": template_id}


def _get_audit():
    state = _load_state()
    audit = list(state.get("audit", []))
    cluster_id = (request.args.get("cluster_id") or "").strip()
    action = (request.args.get("action") or "").strip()
    sort = request.args.get("sort", "timestamp")
    order = request.args.get("order", "desc")
    try:
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
    except ValueError:
        limit, offset = 50, 0

    if cluster_id:
        audit = [a for a in audit if a.get("cluster_id") == cluster_id]
    if action:
        audit = [a for a in audit if a.get("action") == action]
    reverse = order == "desc"
    sort_key = sort or "timestamp"
    with contextlib.suppress(Exception):
        audit = sorted(audit, key=lambda x: x.get(sort_key, ""), reverse=reverse)
    total = len(audit)
    start = max(0, offset)
    end = start + (limit or total)
    return {"audit": audit[start:end], "total": total}


def _get_summary():
    state = _load_state()
    exports = state.get("exports", [])
    clusters = _fetch_clusters_from_app()
    summary = []
    for cluster in clusters:
        cluster_exports = [e for e in exports if e.get("cluster_id") == cluster["id"]]
        types = {}
        for e in cluster_exports:
            types[e.get("resource_type", "unknown")] = types.get(e.get("resource_type", "unknown"), 0) + 1
        summary.append({
            "cluster_id": cluster["id"],
            "cluster_name": cluster["name"],
            "total_exports": len(cluster_exports),
            "resource_types": types,
            "last_export": max((e.get("created_at") for e in cluster_exports), default=None),
        })
    return {"summary": summary}


def _post_compare():
    body = request.get_json(silent=True) or {}
    left_id = (body.get("left_id") or "").strip()
    right_id = (body.get("right_id") or "").strip()
    if not left_id or not right_id:
        return jsonify({"error": "left_id and right_id are required"}), 400
    state = _load_state()
    exports = state.get("exports", [])
    left = next((e for e in exports if e.get("id") == left_id), None)
    right = next((e for e in exports if e.get("id") == right_id), None)
    if not left or not right:
        return jsonify({"error": "export not found"}), 404
    return {
        "left": left,
        "right": right,
        "diff": {
            "left_tf": left.get("tf", "").splitlines(),
            "right_tf": right.get("tf", "").splitlines(),
        },
    }


def _get_ui():
    """Serve the Terraform State Sync HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


# ─── Plugin registration ───────────────────────────────────────────────


def _dispatch_exports():
    if request.method == "POST":
        return _post_export()
    if request.method == "DELETE":
        return _delete_export()
    if request.method == "PUT":
        return _post_re_export()
    return _get_exports()


def _dispatch_schedules():
    if request.method == "POST":
        return _post_schedules()
    if request.method == "PUT":
        return _put_schedules()
    if request.method == "DELETE":
        return _delete_schedules()
    return _get_schedules()


def _dispatch_templates():
    if request.method == "POST":
        return _post_templates()
    if request.method == "PUT":
        return _put_templates()
    if request.method == "DELETE":
        return _delete_templates()
    return _get_templates()


def _dispatch_state():
    if request.method == "POST" and request.args.get("refresh"):
        return _post_state_refresh()
    if request.method == "GET" and request.args.get("download"):
        return _get_state_download()
    if request.method == "POST":
        return _post_sync_complete()
    return _get_state()


def _dispatch_sync():
    if request.method == "POST":
        return _post_sync()
    return _get_sync()


def _dispatch_drift():
    if request.method == "POST" and request.args.get("import"):
        return _post_drift_import()
    if request.method == "POST":
        return _post_drift()
    return jsonify({"error": "method not allowed"}), 405


def _dispatch_import():
    if request.method == "POST":
        return _post_import()
    return jsonify({"error": "method not allowed"}), 405


def register(app):
    _ensure_state()
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "resource-types", _get_resource_types)
    register_plugin_route(PLUGIN_ID, "resources", _get_resources)
    register_plugin_route(PLUGIN_ID, "export/preview", _post_export_preview)
    register_plugin_route(PLUGIN_ID, "export", _post_export)
    register_plugin_route(PLUGIN_ID, "exports", _dispatch_exports)
    register_plugin_route(PLUGIN_ID, "exports/download", _download_export)
    register_plugin_route(PLUGIN_ID, "exports/re-export", _post_re_export)
    register_plugin_route(PLUGIN_ID, "exports/delete", _delete_export)
    register_plugin_route(PLUGIN_ID, "exports/compare", _post_compare)
    register_plugin_route(PLUGIN_ID, "sync", _dispatch_sync)
    register_plugin_route(PLUGIN_ID, "sync/complete", _post_sync_complete)
    register_plugin_route(PLUGIN_ID, "state", _dispatch_state)
    register_plugin_route(PLUGIN_ID, "drift", _dispatch_drift)
    register_plugin_route(PLUGIN_ID, "import", _dispatch_import)
    register_plugin_route(PLUGIN_ID, "schedules", _dispatch_schedules)
    register_plugin_route(PLUGIN_ID, "templates", _dispatch_templates)
    register_plugin_route(PLUGIN_ID, "audit", _get_audit)
    register_plugin_route(PLUGIN_ID, "summary", _get_summary)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
