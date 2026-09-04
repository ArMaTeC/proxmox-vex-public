# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/tenant-isolation/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Tenant Isolation - ProxmoxVEx Plugin
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Tenant Isolation - ProxmoxVEx Plugin
Enforce resource, network, and permission boundaries between tenants.
"""

import contextlib
import json
import logging
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugin_data_bridge import get_clusters
from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.globals import cluster_managers
from ProxmoxVEx.utils.audit import log_audit

PLUGIN_ID = "tenant-isolation"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
DATA_FILE = PLUGIN_DIR / "state.json"

DEFAULT_STATE = {
    "version": "1.0",
    "updated_at": None,
    "tenants": [],
    "bounds": [],
    "audit": [],
    "network_rules": [],
    "permission_templates": [],
}

VALID_STATUSES = {"active", "locked", "retired"}


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix=""):
    return f"{prefix}{uuid.uuid4().hex[:8]}"


def _current_user():
    return getattr(request, "session", {}).get("user", "unknown")


def _load_state():
    if not DATA_FILE.exists():
        return json.loads(json.dumps(DEFAULT_STATE))
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        log.warning(f"[{PLUGIN_ID}] Failed to load state: {e}")
        return json.loads(json.dumps(DEFAULT_STATE))
    for key, value in DEFAULT_STATE.items():
        if key not in data:
            data[key] = value
    if "version" not in data:
        data["version"] = "1.0"
    return data


def _save_state(data):
    try:
        data["updated_at"] = _now_iso()
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        log.error(f"[{PLUGIN_ID}] Failed to save state: {e}")


def _audit(action, cluster_id=None, tenant_id=None, vmid=None, details=None):
    user = _current_user()
    entry = {
        "id": _new_id("audit-"),
        "action": action,
        "actor": user,
        "timestamp": _now_iso(),
        "tenant_id": tenant_id or "",
        "cluster_id": cluster_id or "",
        "vmid": str(vmid) if vmid is not None else "",
        "details": details or {},
    }
    state = _load_state()
    state["audit"].insert(0, entry)
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


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


def _get_status():
    state = _load_state()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "tenant_count": len(state.get("tenants", [])),
        "bound_count": len(state.get("bounds", [])),
        "audit_count": len(state.get("audit", [])),
    }


# ---------------------------------------------------------------------------
# Clusters / VMs
# ---------------------------------------------------------------------------


def _get_clusters():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    clusters = get_clusters().get("clusters", [])

    for cluster_id, mgr in cluster_managers.items():
        allowed, _ = check_cluster_access(cluster_id)
        if not allowed:
            continue
        clusters.append({
            "id": cluster_id,
            "name": getattr(mgr, "name", cluster_id),
            "host": getattr(mgr, "host", ""),
            "connected": getattr(mgr, "is_connected", False),
        })
    return {"clusters": sorted(clusters, key=lambda c: c["name"])}


def _get_vms():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    cluster_id = request.args.get("cluster_id", "").strip()
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        vms = manager.get_vms() or []
        return {
            "cluster_id": cluster_id,
            "vms": [
                {
                    "vmid": str(v.get("vmid", "")),
                    "name": v.get("name", ""),
                    "node": v.get("node", ""),
                    "status": v.get("status", ""),
                    "type": v.get("type", ""),
                }
                for v in vms
            ],
        }
    except Exception as e:
        log.exception(f"[{cluster_id}] get vms error")
        return jsonify({"error": safe_error(e, "Failed to load VMs")}), 500


# ---------------------------------------------------------------------------
# Tenants
# ---------------------------------------------------------------------------


def _tenant_name_in_use(state, name, exclude=None):
    for t in state.get("tenants", []):
        if t["id"] == exclude:
            continue
        if t.get("name", "").strip().lower() == name.strip().lower():
            return True
    return False


def _tenant_bound_count(state, tenant_id):
    return sum(len(b.get("vmids", [])) for b in state.get("bounds", []) if b.get("tenant_id") == tenant_id)


def _get_tenant_by_id(state, tenant_id):
    for t in state.get("tenants", []):
        if t.get("id") == tenant_id:
            return t
    return None


def _normalize_quotas(quotas):
    if not quotas or not isinstance(quotas, dict):
        return {}
    return {
        "max_vms": quotas.get("max_vms"),
        "max_cpu": quotas.get("max_cpu"),
        "max_memory": quotas.get("max_memory"),
    }


def _tenants_handler():
    method = request.method
    state = _load_state()

    if method == "GET":
        tenant_id = request.args.get("id", "").strip()
        if tenant_id:
            t = _get_tenant_by_id(state, tenant_id)
            if not t:
                return jsonify({"error": "Tenant not found"}), 404
            t = dict(t)
            t["vm_count"] = _tenant_bound_count(state, tenant_id)
            return {"tenant": t}

        search = (request.args.get("search") or "").lower()
        status_filter = request.args.get("status", "").strip()
        sort = request.args.get("sort", "name")
        order = request.args.get("order", "asc")
        try:
            limit = int(request.args.get("limit", 50))
            offset = int(request.args.get("offset", 0))
        except ValueError:
            return jsonify({"error": "limit and offset must be integers"}), 400

        items = [dict(t) for t in state.get("tenants", [])]
        for t in items:
            t["vm_count"] = _tenant_bound_count(state, t["id"])

        if search:
            items = [t for t in items if search in t.get("name", "").lower()]
        if status_filter:
            items = [t for t in items if t.get("status", "active") == status_filter]

        if sort in ("name", "created_at", "status"):
            reverse = order == "desc"
            items.sort(key=lambda t: t.get(sort, ""), reverse=reverse)

        total = len(items)
        page = items[offset : offset + limit]
        return {"tenants": page, "total": total}

    if method == "POST":
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        if not name:
            return jsonify({"error": "name is required"}), 400
        if _tenant_name_in_use(state, name):
            return jsonify({"error": "Tenant name already exists"}), 400

        quotas = _normalize_quotas(body.get("quotas"))
        status = body.get("status", "active")
        if status not in VALID_STATUSES:
            status = "active"

        tenant = {
            "id": _new_id("tenant-"),
            "name": name,
            "status": status,
            "quotas": quotas,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        state["tenants"].append(tenant)
        _save_state(state)
        _audit("create", tenant_id=tenant["id"], details={"name": name})
        return {"tenant": tenant}

    if method == "PUT":
        body = request.get_json(silent=True) or {}
        tenant_id = (body.get("id") or "").strip()
        if not tenant_id:
            return jsonify({"error": "id is required"}), 400
        t = _get_tenant_by_id(state, tenant_id)
        if not t:
            return jsonify({"error": "Tenant not found"}), 404

        name = (body.get("name") or "").strip()
        if name:
            if _tenant_name_in_use(state, name, exclude=tenant_id):
                return jsonify({"error": "Tenant name already exists"}), 400
            t["name"] = name

        if "status" in body:
            status = body.get("status")
            if status in VALID_STATUSES:
                t["status"] = status

        if "quotas" in body:
            t["quotas"] = _normalize_quotas(body.get("quotas"))

        t["updated_at"] = _now_iso()
        _save_state(state)
        _audit("edit", tenant_id=tenant_id, details={"name": t.get("name")})
        return {"tenant": t}

    if method == "DELETE":
        tenant_id = request.args.get("id", "").strip()
        if not tenant_id:
            body = request.get_json(silent=True) or {}
            tenant_id = (body.get("id") or "").strip()
        if not tenant_id:
            return jsonify({"error": "id is required"}), 400
        t = _get_tenant_by_id(state, tenant_id)
        if not t:
            return jsonify({"error": "Tenant not found"}), 404

        force = _is_truthy(request.args.get("force")) or _is_truthy((request.get_json(silent=True) or {}).get("force"))
        tenant_bounds = [b for b in state.get("bounds", []) if b.get("tenant_id") == tenant_id]
        if tenant_bounds and not force:
            return jsonify({
                "error": "Tenant has assigned resources",
                "resources": sum(len(b.get("vmids", [])) for b in tenant_bounds),
            }), 409

        state["bounds"] = [b for b in state.get("bounds", []) if b.get("tenant_id") != tenant_id]
        state["tenants"] = [t for t in state["tenants"] if t.get("id") != tenant_id]
        _save_state(state)
        _audit("delete", tenant_id=tenant_id, details={"name": t.get("name")})
        return {"deleted": tenant_id}

    return jsonify({"error": "Method not allowed"}), 405


def _is_truthy(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in ("1", "true", "yes", "on")
    return bool(value)


# ---------------------------------------------------------------------------
# Bounds
# ---------------------------------------------------------------------------


def _get_bound_by_id(state, bound_id):
    for b in state.get("bounds", []):
        if b.get("id") == bound_id:
            return b
    return None


def _vmid_assigned_to_other_tenant(state, cluster_id, vmid, tenant_id):
    for b in state.get("bounds", []):
        if b.get("cluster_id") != cluster_id:
            continue
        if b.get("tenant_id") == tenant_id:
            continue
        if vmid in [str(v) for v in b.get("vmids", [])]:
            return b
    return None


def _bounds_handler():
    method = request.method
    state = _load_state()

    if method == "GET":
        cluster_id = request.args.get("cluster_id", "").strip()
        tenant_id = request.args.get("tenant_id", "").strip()
        items = state.get("bounds", [])
        if cluster_id:
            items = [b for b in items if b.get("cluster_id") == cluster_id]
        if tenant_id:
            items = [b for b in items if b.get("tenant_id") == tenant_id]
        return {
            "bounds": sorted(items, key=lambda b: b.get("created_at", "")),
            "total": len(items),
        }

    if method == "POST":
        body = request.get_json(silent=True) or {}
        cluster_id = (body.get("cluster_id") or "").strip()
        tenant_id = (body.get("tenant_id") or "").strip()
        vmids = body.get("vmids", [])
        if not cluster_id or not tenant_id:
            return jsonify({"error": "cluster_id and tenant_id are required"}), 400
        if not vmids:
            return jsonify({"error": "vmids are required"}), 400

        manager, err = _manager_or_error(cluster_id)
        if err:
            return err

        tenant = _get_tenant_by_id(state, tenant_id)
        if not tenant:
            return jsonify({"error": "Tenant not found"}), 404
        if tenant.get("status") in ("locked", "retired"):
            return jsonify({"error": "Tenant is locked or retired"}), 400

        existing = None
        for b in state.get("bounds", []):
            if b.get("cluster_id") == cluster_id and b.get("tenant_id") == tenant_id:
                existing = b
                break

        added = []
        duplicates = []
        for vmid in vmids:
            vmid = str(vmid).strip()
            if not vmid:
                continue
            if not vmid.isdigit():
                duplicates.append(f"{vmid}: must be an integer")
                continue
            other = _vmid_assigned_to_other_tenant(state, cluster_id, vmid, tenant_id)
            if other:
                duplicates.append(f"{vmid}: already assigned to tenant {other.get('tenant_id')}")
                continue
            if existing:
                if vmid not in [str(v) for v in existing.get("vmids", [])]:
                    existing.setdefault("vmids", []).append(vmid)
                    added.append(vmid)
            else:
                if vmid not in added:
                    added.append(vmid)

        if not existing:
            new_bound = {
                "id": _new_id("bound-"),
                "cluster_id": cluster_id,
                "tenant_id": tenant_id,
                "vmids": added,
                "manager_host": getattr(manager, "host", ""),
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
            }
            state["bounds"].append(new_bound)
            existing = new_bound
        else:
            existing["vmids"] = list(dict.fromkeys([str(v) for v in existing.get("vmids", [])]))
            existing["updated_at"] = _now_iso()

        _save_state(state)
        _audit(
            "bound",
            cluster_id=cluster_id,
            tenant_id=tenant_id,
            details={"vmids": added, "duplicates": duplicates},
        )
        return {
            "bound": existing,
            "added": added,
            "duplicates": duplicates,
            "manager_host": getattr(manager, "host", ""),
        }

    if method == "DELETE":
        body = request.get_json(silent=True) or {}
        bound_id = (request.args.get("id") or body.get("id") or "").strip()
        vmid = (request.args.get("vmid") or body.get("vmid") or "").strip()
        if not bound_id:
            return jsonify({"error": "id is required"}), 400

        bound = _get_bound_by_id(state, bound_id)
        if not bound:
            return jsonify({"error": "Bound not found"}), 404

        if vmid:
            vmid = str(vmid)
            if vmid in [str(v) for v in bound.get("vmids", [])]:
                bound["vmids"] = [v for v in bound["vmids"] if str(v) != vmid]
            if not bound["vmids"]:
                state["bounds"] = [b for b in state["bounds"] if b.get("id") != bound_id]
                _save_state(state)
                _audit(
                    "unbound",
                    cluster_id=bound.get("cluster_id"),
                    tenant_id=bound.get("tenant_id"),
                    vmid=vmid,
                    details={"removed": True},
                )
                return {"deleted": bound_id}
            bound["updated_at"] = _now_iso()
            _save_state(state)
            _audit(
                "unbound",
                cluster_id=bound.get("cluster_id"),
                tenant_id=bound.get("tenant_id"),
                vmid=vmid,
                details={"removed": False},
            )
            return {"bound": bound, "unassigned": vmid}

        state["bounds"] = [b for b in state["bounds"] if b.get("id") != bound_id]
        _save_state(state)
        _audit(
            "unbound",
            cluster_id=bound.get("cluster_id"),
            tenant_id=bound.get("tenant_id"),
            details={"removed_all": True},
        )
        return {"deleted": bound_id}

    return jsonify({"error": "Method not allowed"}), 405


def _bounds_bulk_unassign():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    tenant_id = (body.get("tenant_id") or "").strip()
    vmids = body.get("vmids", [])
    if not cluster_id or not tenant_id or not vmids:
        return jsonify({"error": "cluster_id, tenant_id and vmids are required"}), 400

    state = _load_state()
    for b in state.get("bounds", []):
        if b.get("cluster_id") == cluster_id and b.get("tenant_id") == tenant_id:
            b["vmids"] = [v for v in b["vmids"] if str(v) not in [str(x) for x in vmids]]
            b["updated_at"] = _now_iso()
            if not b["vmids"]:
                state["bounds"].remove(b)
            break
    _save_state(state)
    _audit(
        "unbound",
        cluster_id=cluster_id,
        tenant_id=tenant_id,
        details={"bulk_unassigned": vmids},
    )
    return {"unassigned": vmids}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _validate_handler():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    tenant_id = (body.get("tenant_id") or "").strip()
    vmid = (body.get("vmid") or "").strip()

    if not cluster_id or not tenant_id:
        return jsonify({"error": "cluster_id and tenant_id are required"}), 400

    manager, err = _manager_or_error(cluster_id)
    if err:
        return err

    state = _load_state()
    tenant = _get_tenant_by_id(state, tenant_id)
    if not tenant:
        return jsonify({"error": "Tenant not found"}), 404

    # Full tenant validation
    if not vmid:
        results = []
        for b in state.get("bounds", []):
            if b.get("cluster_id") != cluster_id or b.get("tenant_id") != tenant_id:
                continue
            for v in b.get("vmids", []):
                other = _vmid_assigned_to_other_tenant(state, cluster_id, str(v), tenant_id)
                if other:
                    results.append({
                        "vmid": str(v),
                        "valid": False,
                        "reason": f"assigned to tenant {other.get('tenant_id')}",
                    })
                else:
                    results.append({"vmid": str(v), "valid": True})
        _audit(
            "validate",
            cluster_id=cluster_id,
            tenant_id=tenant_id,
            details={"count": len(results)},
        )
        return {"cluster_id": cluster_id, "tenant_id": tenant_id, "results": results}

    if not vmid.isdigit():
        return jsonify({"error": "vmid must be an integer"}), 400

    other = _vmid_assigned_to_other_tenant(state, cluster_id, vmid, tenant_id)
    if other:
        _audit(
            "validate",
            cluster_id=cluster_id,
            tenant_id=tenant_id,
            vmid=vmid,
            details={"valid": False},
        )
        return {
            "cluster_id": cluster_id,
            "tenant_id": tenant_id,
            "vmid": vmid,
            "manager_host": getattr(manager, "host", ""),
            "valid": False,
            "reason": f"assigned to tenant {other.get('tenant_id')}",
        }
    _audit(
        "validate",
        cluster_id=cluster_id,
        tenant_id=tenant_id,
        vmid=vmid,
        details={"valid": True},
    )
    return {
        "cluster_id": cluster_id,
        "tenant_id": tenant_id,
        "vmid": vmid,
        "manager_host": getattr(manager, "host", ""),
        "valid": True,
    }


# ---------------------------------------------------------------------------
# Conflicts
# ---------------------------------------------------------------------------


def _get_conflicts():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    state = _load_state()
    by_cluster_vmid = {}
    for b in state.get("bounds", []):
        cluster_id = b.get("cluster_id")
        tenant_id = b.get("tenant_id")
        for vmid in [str(v) for v in b.get("vmids", [])]:
            by_cluster_vmid.setdefault(cluster_id, {}).setdefault(vmid, []).append({
                "tenant_id": tenant_id,
                "bound_id": b.get("id"),
            })

    conflicts = []
    for cluster_id, vmids in by_cluster_vmid.items():
        for vmid, entries in vmids.items():
            tenant_ids = sorted({e["tenant_id"] for e in entries})
            if len(tenant_ids) > 1:
                conflicts.append({
                    "vmid": vmid,
                    "cluster_id": cluster_id,
                    "tenant_ids": tenant_ids,
                    "type": "multi_tenant",
                })
    return {"conflicts": conflicts}


def _conflicts_fix():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    vmid = (body.get("vmid") or "").strip()
    target_tenant_id = (body.get("tenant_id") or "").strip()
    if not cluster_id or not vmid:
        return jsonify({"error": "cluster_id and vmid are required"}), 400

    state = _load_state()
    fixed = []
    removed = 0
    for b in list(state.get("bounds", [])):
        if b.get("cluster_id") != cluster_id:
            continue
        if str(vmid) not in [str(v) for v in b.get("vmids", [])]:
            continue
        if target_tenant_id and b.get("tenant_id") != target_tenant_id:
            b["vmids"] = [v for v in b["vmids"] if str(v) != vmid]
            removed += 1
            if not b["vmids"]:
                state["bounds"].remove(b)
            continue
        if not target_tenant_id:
            b["vmids"] = [v for v in b["vmids"] if str(v) != vmid]
            removed += 1
            if not b["vmids"]:
                state["bounds"].remove(b)
            continue
        fixed.append(b.get("id"))

    _save_state(state)
    _audit(
        "auto_fix",
        cluster_id=cluster_id,
        vmid=vmid,
        details={"target_tenant": target_tenant_id, "fixed": fixed, "removed": removed},
    )
    return {"fixed": fixed, "removed": removed, "conflicts_remaining": len(_get_conflicts()["conflicts"])}


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


def _audit_handler():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    state = _load_state()
    tenant_id = request.args.get("tenant_id", "").strip()
    cluster_id = request.args.get("cluster_id", "").strip()
    action = request.args.get("action", "").strip()
    try:
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
    except ValueError:
        return jsonify({"error": "limit and offset must be integers"}), 400

    items = state.get("audit", [])
    if tenant_id:
        items = [a for a in items if a.get("tenant_id") == tenant_id]
    if cluster_id:
        items = [a for a in items if a.get("cluster_id") == cluster_id]
    if action:
        items = [a for a in items if a.get("action") == action]

    sort = request.args.get("sort", "timestamp")
    order = request.args.get("order", "desc")
    if sort == "timestamp":
        reverse = order == "desc"
        items = sorted(
            items,
            key=lambda a: a.get("timestamp", ""),
            reverse=reverse,
        )

    total = len(items)
    page = items[offset : offset + limit]
    return {"audit": page, "total": total}


# ---------------------------------------------------------------------------
# Import / Export
# ---------------------------------------------------------------------------


def _export_handler():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    state = _load_state()
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tmp:
            json.dump(state, tmp, indent=2)
            tmp_path = tmp.name
        return send_file(tmp_path, as_attachment=True, download_name="tenant-isolation.json")
    except Exception as e:
        log.exception("export error")
        return jsonify({"error": safe_error(e, "Export failed")}), 500


def _import_handler():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    mode = body.get("mode", "append")
    data = body.get("data")
    if not data or not isinstance(data, dict):
        return jsonify({"error": "data is required"}), 400

    errors = []
    if not isinstance(data.get("tenants", []), list):
        errors.append("tenants must be a list")
    if not isinstance(data.get("bounds", []), list):
        errors.append("bounds must be a list")
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400

    state = _load_state()
    imported_t = 0
    imported_b = 0
    skipped = 0

    if mode == "replace":
        state["tenants"] = []
        state["bounds"] = []

    for t in data.get("tenants", []):
        name = (t.get("name") or "").strip()
        if not name:
            skipped += 1
            errors.append("skipped tenant with empty name")
            continue
        if _tenant_name_in_use(state, name):
            skipped += 1
            errors.append(f"skipped duplicate tenant name: {name}")
            continue
        tenant = {
            "id": _new_id("tenant-"),
            "name": name,
            "status": t.get("status", "active") if t.get("status") in VALID_STATUSES else "active",
            "quotas": _normalize_quotas(t.get("quotas")),
            "created_at": t.get("created_at") or _now_iso(),
            "updated_at": _now_iso(),
        }
        state["tenants"].append(tenant)
        imported_t += 1

    # Map old tenant IDs to new for bounds
    tenant_name_map = {(t.get("name") or "").strip().lower(): t["id"] for t in state["tenants"]}
    for b in data.get("bounds", []):
        tenant_id = b.get("tenant_id", "")
        tenant = _get_tenant_by_id(state, tenant_id)
        if not tenant:
            # Try to find by name from imported tenants
            for t in data.get("tenants", []):
                if t.get("id") == tenant_id:
                    mapped = tenant_name_map.get((t.get("name") or "").strip().lower())
                    if mapped:
                        tenant_id = mapped
                        break
        tenant = _get_tenant_by_id(state, tenant_id)
        if not tenant:
            skipped += 1
            errors.append(f"skipped bound: tenant {tenant_id} not found")
            continue

        cluster_id = (b.get("cluster_id") or "").strip()
        if not cluster_id:
            skipped += 1
            continue

        existing = None
        for existing_b in state["bounds"]:
            if existing_b.get("cluster_id") == cluster_id and existing_b.get("tenant_id") == tenant_id:
                existing = existing_b
                break

        if not existing:
            new_bound = {
                "id": _new_id("bound-"),
                "cluster_id": cluster_id,
                "tenant_id": tenant_id,
                "vmids": [],
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
            }
            state["bounds"].append(new_bound)
            existing = new_bound

        seen = {str(v) for v in existing.get("vmids", [])}
        for vmid in [str(v) for v in b.get("vmids", [])]:
            other = _vmid_assigned_to_other_tenant(state, cluster_id, vmid, tenant_id)
            if other:
                errors.append(f"skipped overlapping vmid {vmid} for cluster {cluster_id}")
                continue
            if vmid not in seen:
                existing["vmids"].append(vmid)
                seen.add(vmid)
        imported_b += 1

    _save_state(state)
    _audit(
        "import",
        details={
            "mode": mode,
            "imported_tenants": imported_t,
            "imported_bounds": imported_b,
            "skipped": skipped,
        },
    )
    return {
        "imported": {"tenants": imported_t, "bounds": imported_b},
        "skipped": skipped,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Duplicate
# ---------------------------------------------------------------------------


def _duplicate_tenant():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    source_id = (body.get("id") or "").strip()
    new_name = (body.get("name") or "").strip()
    if not source_id:
        return jsonify({"error": "id is required"}), 400
    if not new_name:
        return jsonify({"error": "name is required"}), 400

    state = _load_state()
    source = _get_tenant_by_id(state, source_id)
    if not source:
        return jsonify({"error": "Source tenant not found"}), 404
    if _tenant_name_in_use(state, new_name):
        return jsonify({"error": "Tenant name already exists"}), 400

    new_tenant = {
        "id": _new_id("tenant-"),
        "name": new_name,
        "status": source.get("status", "active"),
        "quotas": _normalize_quotas(source.get("quotas")),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    state["tenants"].append(new_tenant)

    copied = 0
    for b in state.get("bounds", []):
        if b.get("tenant_id") == source_id:
            state["bounds"].append({
                "id": _new_id("bound-"),
                "cluster_id": b.get("cluster_id"),
                "tenant_id": new_tenant["id"],
                "vmids": list(b.get("vmids", [])),
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
            })
            copied += 1

    _save_state(state)
    _audit(
        "duplicate",
        tenant_id=new_tenant["id"],
        details={"source": source_id, "bounds_copied": copied},
    )
    return {"tenant": new_tenant, "bounds_copied": copied}


# ---------------------------------------------------------------------------
# Network isolation
# ---------------------------------------------------------------------------


def _network_handler():
    method = request.method
    state = _load_state()
    if method == "GET":
        tenant_id = request.args.get("tenant_id", "").strip()
        rules = state.get("network_rules", [])
        if tenant_id:
            rules = [r for r in rules if r.get("tenant_id") == tenant_id]
        return {"rules": rules}
    if method == "POST":
        body = request.get_json(silent=True) or {}
        tenant_id = (body.get("tenant_id") or "").strip()
        vlans = body.get("vlans", [])
        if not tenant_id:
            return jsonify({"error": "tenant_id is required"}), 400
        if not _get_tenant_by_id(state, tenant_id):
            return jsonify({"error": "Tenant not found"}), 404

        existing = next(
            (r for r in state.get("network_rules", []) if r.get("tenant_id") == tenant_id),
            None,
        )
        if existing:
            existing["vlans"] = [str(v) for v in vlans]
            existing["updated_at"] = _now_iso()
            rule = existing
        else:
            rule = {
                "id": _new_id("net-"),
                "tenant_id": tenant_id,
                "vlans": [str(v) for v in vlans],
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
            }
            state.setdefault("network_rules", []).append(rule)
        _save_state(state)
        _audit(
            "edit",
            tenant_id=tenant_id,
            details={"network_vlans": rule.get("vlans", [])},
        )
        return {"rule": rule}
    return jsonify({"error": "Method not allowed"}), 405


# ---------------------------------------------------------------------------
# Quotas
# ---------------------------------------------------------------------------


def _quotas_handler():
    method = request.method
    state = _load_state()
    if method == "GET":
        tenant_id = request.args.get("tenant_id", "").strip()
        if not tenant_id:
            return jsonify({"error": "tenant_id is required"}), 400
        tenant = _get_tenant_by_id(state, tenant_id)
        if not tenant:
            return jsonify({"error": "Tenant not found"}), 404
        usage = _tenant_bound_count(state, tenant_id)
        return {
            "tenant_id": tenant_id,
            "quotas": tenant.get("quotas", {}),
            "vm_usage": usage,
        }
    if method == "PUT":
        body = request.get_json(silent=True) or {}
        tenant_id = (body.get("tenant_id") or "").strip()
        if not tenant_id:
            return jsonify({"error": "tenant_id is required"}), 400
        tenant = _get_tenant_by_id(state, tenant_id)
        if not tenant:
            return jsonify({"error": "Tenant not found"}), 404
        tenant["quotas"] = _normalize_quotas(body.get("quotas"))
        tenant["updated_at"] = _now_iso()
        _save_state(state)
        _audit(
            "edit",
            tenant_id=tenant_id,
            details={"quotas": tenant["quotas"]},
        )
        return {"tenant": tenant}
    return jsonify({"error": "Method not allowed"}), 405


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


def _permissions_handler():
    method = request.method
    state = _load_state()
    if method == "GET":
        return {"templates": state.get("permission_templates", [])}
    if method == "POST":
        body = request.get_json(silent=True) or {}
        tenant_id = (body.get("tenant_id") or "").strip()
        template = (body.get("template") or "").strip()
        if not tenant_id or not template:
            return jsonify({"error": "tenant_id and template are required"}), 400
        tenant = _get_tenant_by_id(state, tenant_id)
        if not tenant:
            return jsonify({"error": "Tenant not found"}), 404
        tenant["permission_template"] = template
        tenant["updated_at"] = _now_iso()
        _save_state(state)
        _audit(
            "edit",
            tenant_id=tenant_id,
            details={"permission_template": template},
        )
        return {"tenant": tenant}
    return jsonify({"error": "Method not allowed"}), 405


# ---------------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------------


def _get_ui():
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "vms", _get_vms)
    register_plugin_route(PLUGIN_ID, "tenants", _tenants_handler)
    register_plugin_route(PLUGIN_ID, "bounds", _bounds_handler)
    register_plugin_route(PLUGIN_ID, "bounds/bulk-unassign", _bounds_bulk_unassign)
    register_plugin_route(PLUGIN_ID, "validate", _validate_handler)
    register_plugin_route(PLUGIN_ID, "conflicts", _get_conflicts)
    register_plugin_route(PLUGIN_ID, "conflicts/fix", _conflicts_fix)
    register_plugin_route(PLUGIN_ID, "audit", _audit_handler)
    register_plugin_route(PLUGIN_ID, "export", _export_handler)
    register_plugin_route(PLUGIN_ID, "import", _import_handler)
    register_plugin_route(PLUGIN_ID, "tenants/duplicate", _duplicate_tenant)
    register_plugin_route(PLUGIN_ID, "network", _network_handler)
    register_plugin_route(PLUGIN_ID, "quotas", _quotas_handler)
    register_plugin_route(PLUGIN_ID, "permissions", _permissions_handler)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
