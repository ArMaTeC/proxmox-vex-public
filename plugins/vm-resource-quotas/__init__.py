# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-resource-quotas/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: VM Resource Quotas - ProxmoxVEx Plugin
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
VM Resource Quotas - ProxmoxVEx Plugin
Manage per-tenant resource quotas, view live usage, create templates,
configure alerts, and track history through a single-page UI.
"""

import contextlib
import csv
import io
import json
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from flask import Response, g, jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugin_data_bridge import get_clusters
from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.globals import cluster_managers

PLUGIN_ID = "vm-resource-quotas"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
DATA_DIR = PLUGIN_DIR / "data"

QUOTAS_FILE = DATA_DIR / "quotas.json"
TEMPLATES_FILE = DATA_DIR / "templates.json"
HISTORY_FILE = DATA_DIR / "history.json"
CONFIG_FILE = DATA_DIR / "config.json"

DEFAULT_THRESHOLDS = {"warning": 80, "danger": 95}
DEFAULT_LIMITS = {
    "max_vcpus": None,
    "max_memory_mb": None,
    "max_storage_gb": None,
    "max_vms": None,
    "notes": "",
    "alert_thresholds": {
        "vcpus": DEFAULT_THRESHOLDS,
        "memory": DEFAULT_THRESHOLDS,
        "storage": DEFAULT_THRESHOLDS,
        "vms": DEFAULT_THRESHOLDS,
    },
}

# Ensure data directory is present before any access.
DATA_DIR.mkdir(parents=True, exist_ok=True)


# ─── helpers ─────────────────────────────────────────────────────────────────


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix=""):
    return f"{prefix}{uuid.uuid4().hex[:12]}"


def _load_json(path, default):
    if not path.exists():
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        log.warning(f"[{PLUGIN_ID}] Failed to load {path}: {e}")
        return default


def _save_json(path, data):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        log.error(f"[{PLUGIN_ID}] Failed to save {path}: {e}")


def _get_user():
    user = getattr(g, "current_user", None)
    if not user:
        username = getattr(request, "session", {}).get("user", "unknown")
        user = {"username": username}
    if isinstance(user, dict) and "username" not in user:
        user["username"] = getattr(request, "session", {}).get("user", "unknown")
    return user


def _allowed_clusters():
    from ProxmoxVEx.utils.rbac import get_user_clusters

    user = _get_user()
    return get_user_clusters(user)


def _visible_tenants():
    from ProxmoxVEx.utils.rbac import load_tenants

    all_tenants = load_tenants()
    allowed = _allowed_clusters()
    if allowed is None:
        return all_tenants
    allowed_set = set(allowed)
    visible = {}
    for tid, t in all_tenants.items():
        t_clusters = t.get("clusters") or []
        if not t_clusters or any(c in allowed_set for c in t_clusters):
            visible[tid] = t
    return visible


def _get_tenant_by_id(tenant_id):
    visible = _visible_tenants()
    return visible.get(tenant_id)


def _get_manager_or_error(cluster_id):
    if not cluster_id:
        return None, (jsonify({"error": "cluster_id is required"}), 400)
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return None, err
    return get_connected_manager(cluster_id)


def _coerce_int(value):
    if value is None or value == "":
        return None
    try:
        v = int(value)
        return v if v >= 0 else None
    except (ValueError, TypeError):
        return None


def _coerce_threshold(value):
    with contextlib.suppress(ValueError, TypeError):
        v = int(value)
        if 0 <= v <= 100:
            return v
    return None


def _validate_thresholds(thresholds):
    out = {}
    for resource in ("vcpus", "memory", "storage", "vms"):
        raw = thresholds.get(resource, {}) if isinstance(thresholds, dict) else {}
        warning = _coerce_threshold(raw.get("warning", DEFAULT_THRESHOLDS["warning"]))
        danger = _coerce_threshold(raw.get("danger", DEFAULT_THRESHOLDS["danger"]))
        if warning is None:
            warning = DEFAULT_THRESHOLDS["warning"]
        if danger is None:
            danger = DEFAULT_THRESHOLDS["danger"]
        if warning >= danger:
            warning = danger - 5
            if warning < 0:
                warning = 0
        out[resource] = {"warning": warning, "danger": danger}
    return out


def _validate_quota_body(body):
    tenant_id = (body.get("tenant_id") or "").strip()
    if not tenant_id:
        return None, "tenant_id is required"
    if not _get_tenant_by_id(tenant_id):
        return None, "tenant not found or not visible"

    limits = {}
    for key in ("max_vcpus", "max_memory_mb", "max_storage_gb", "max_vms"):
        limits[key] = _coerce_int(body.get(key))

    notes = str(body.get("notes", ""))[:500]
    thresholds = _validate_thresholds(body.get("alert_thresholds"))
    return {"tenant_id": tenant_id, "limits": limits, "notes": notes, "thresholds": thresholds}, None


def _audit(action, tenant_id=None, details=None):
    entry = {
        "id": _new_id("hist-"),
        "action": action,
        "actor": _get_user().get("username", "unknown"),
        "timestamp": _now_iso(),
        "tenant_id": tenant_id or "",
        "details": details or {},
    }
    history = _load_json(HISTORY_FILE, [])
    history.insert(0, entry)
    _save_json(HISTORY_FILE, history[:5000])


def _load_quotas():
    return _load_json(QUOTAS_FILE, [])


def _load():
    """Load all tenant quotas, defaulting to an empty list."""
    return _load_quotas()


def _default_config():
    """Return the built-in default quota configuration."""
    return {"default_quota": {**DEFAULT_LIMITS, "max_vms": 10}}


def _save_quotas(quotas):
    _save_json(QUOTAS_FILE, quotas)


def _load_templates():
    return _load_json(TEMPLATES_FILE, [])


def _save_templates(templates):
    _save_json(TEMPLATES_FILE, templates)


def _load_config():
    return _load_json(CONFIG_FILE, {"defaults": {}, "acknowledged_alerts": []})


def _save_config(config):
    _save_json(CONFIG_FILE, config)


def _get_acknowledged_alert_ids():
    return set(_load_config().get("acknowledged_alerts", []))


def _tenant_vm_map():
    """Map tenant_id -> set of (cluster_id, vmid) from tenant-isolation if available."""
    map_path = PLUGIN_DIR.parent / "tenant-isolation" / "state.json"
    mapping = defaultdict(set)
    state = _load_json(map_path, {})
    for bound in state.get("bounds", []):
        tid = bound.get("tenant_id")
        cid = bound.get("cluster_id")
        for vmid in bound.get("vmids", []):
            if tid and cid and vmid:
                mapping[tid].add((cid, str(vmid)))
    return mapping


def _compute_usage(tenant_id):
    """Return live resource usage for a tenant across visible clusters."""
    allowed = _allowed_clusters()
    tenant = _get_tenant_by_id(tenant_id)
    if not tenant:
        return None

    allowed_set = None if allowed is None else set(allowed)
    tmap = _tenant_vm_map()
    target = tmap.get(tenant_id, set())
    is_default = tenant.get("id") == "default" or tenant_id == "default"
    use_all = not target and is_default

    vcpus = 0
    memory_mb = 0
    storage_gb = 0
    vm_count = 0
    errors = []

    for cid, mgr in cluster_managers.items():
        if allowed_set is not None and cid not in allowed_set:
            continue
        try:
            resources = mgr.api_request("GET", "/cluster/resources") or []
        except Exception as e:
            errors.append(f"{cid}: {safe_error(e, 'cluster query failed')}")
            continue
        for r in resources or []:
            if r.get("type") not in ("qemu", "lxc"):
                continue
            vmid = str(r.get("vmid", ""))
            if not use_all and (cid, vmid) not in target:
                continue
            vcpus += int(r.get("maxcpu") or r.get("cpus") or 0)
            mem = r.get("maxmem") or r.get("memory") or 0
            memory_mb += int(mem) // (1024 * 1024)
            disk = r.get("maxdisk") or r.get("disk") or 0
            storage_gb += int(disk) // (1024**3)
            vm_count += 1

    return {
        "vcpus_used": vcpus,
        "memory_used_mb": memory_mb,
        "storage_used_gb": storage_gb,
        "vm_count": vm_count,
        "errors": errors,
    }


def _usage_state(used, limit, thresholds):
    if not limit:
        return {"percent": 0.0, "state": "ok"}
    pct = round((used / limit) * 100, 2) if limit else 0.0
    warning = thresholds.get("warning", 80)
    danger = thresholds.get("danger", 95)
    if pct >= danger:
        state = "danger"
    elif pct >= warning:
        state = "warning"
    else:
        state = "ok"
    return {"percent": pct, "state": state}


def _build_usage_view(quota, usage):
    if usage is None:
        return None
    thresholds = quota.get("alert_thresholds", DEFAULT_LIMITS["alert_thresholds"])
    view = {"vcpus": {}, "memory": {}, "storage": {}, "vms": {}}
    for resource, key in (
        ("vcpus", "max_vcpus"),
        ("memory", "max_memory_mb"),
        ("storage", "max_storage_gb"),
        ("vms", "max_vms"),
    ):
        used = usage.get(f"{resource}_used" if resource != "vms" else "vm_count", 0)
        if resource == "vcpus":
            used = usage["vcpus_used"]
        elif resource == "memory":
            used = usage["memory_used_mb"]
        elif resource == "storage":
            used = usage["storage_used_gb"]
        elif resource == "vms":
            used = usage["vm_count"]
        limit = quota.get(key)
        view[resource] = _usage_state(used, limit, thresholds.get(resource, DEFAULT_THRESHOLDS))
    within = all(v["state"] != "danger" for v in view.values())
    return {"usage": usage, "quotas": {k: quota.get(k) for k in DEFAULT_LIMITS}, "view": view, "within_limits": within}


def _generate_alert_id(tenant_id, resource, severity):
    return f"{tenant_id}:{resource}:{severity}"


def _active_alerts(quota, usage, ack_ids):
    view = _build_usage_view(quota, usage)
    if not view:
        return []
    alerts = []
    for resource, data in view["view"].items():
        if data["state"] in ("warning", "danger"):
            alert_id = _generate_alert_id(quota["tenant_id"], resource, data["state"])
            if alert_id in ack_ids:
                continue
            alerts.append({
                "id": alert_id,
                "tenant_id": quota["tenant_id"],
                "resource": resource,
                "severity": data["state"],
                "percent": data["percent"],
                "threshold": quota["alert_thresholds"][resource][data["state"]],
                "fired_at": _now_iso(),
            })
    return alerts


# ─── route handlers ──────────────────────────────────────────────────────────


def _get_status():
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "version": "1.1.0",
        "quotas": len(_load_quotas()),
        "templates": len(_load_templates()),
        "routes": [
            "status",
            "clusters",
            "tenants",
            "quotas",
            "usage",
            "templates",
            "templates/apply",
            "alerts",
            "alerts/acknowledge",
            "defaults",
            "defaults/apply",
            "export",
            "import",
            "history",
            "dashboard",
        ],
    }


def _get_clusters():
    return {"clusters": _visible_clusters()}


def _visible_clusters():
    clusters = get_clusters().get("clusters", [])

    for cid, mgr in cluster_managers.items():
        allowed, _ = check_cluster_access(cid)
        if not allowed:
            continue
        clusters.append({
            "id": cid,
            "name": getattr(mgr, "name", cid),
            "connected": getattr(mgr, "is_connected", False),
        })
    clusters.sort(key=lambda c: c.get("name", c["id"]))
    return clusters


def _get_tenants():
    items = [
        {"id": tid, "name": t.get("name", tid), "status": t.get("status", "active")}
        for tid, t in _visible_tenants().items()
    ]
    items.sort(key=lambda t: t["name"].lower())
    return {"tenants": items}


def _get_quotas():
    quotas = _load_quotas()
    tenant_filter = (request.args.get("tenant_id") or "").strip()
    search = (request.args.get("search") or "").lower()
    sort = request.args.get("sort", "tenant_name")
    order = request.args.get("order", "asc")
    try:
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
    except ValueError:
        return jsonify({"error": "limit and offset must be integers"}), 400

    if tenant_filter:
        quotas = [q for q in quotas if q.get("tenant_id") == tenant_filter]

    visible = set(_visible_tenants().keys())
    quotas = [q for q in quotas if q.get("tenant_id") in visible]

    if search:
        quotas = [q for q in quotas if search in q.get("tenant_name", "").lower()]

    reverse = order == "desc"
    quotas.sort(key=lambda q: q.get(sort, ""), reverse=reverse)

    total = len(quotas)
    page = quotas[offset : offset + limit]
    return {"quotas": page, "total": total}


def _create_quota():
    body = request.get_json(silent=True) or {}
    validated, err = _validate_quota_body(body)
    if err:
        return jsonify({"error": err}), 400

    quotas = _load_quotas()
    if any(q.get("tenant_id") == validated["tenant_id"] for q in quotas):
        return jsonify({"error": "quota for this tenant already exists"}), 409

    tenant = _get_tenant_by_id(validated["tenant_id"])
    quota = {
        "id": _new_id("quota-"),
        "tenant_id": validated["tenant_id"],
        "tenant_name": tenant.get("name", validated["tenant_id"]),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    quota.update(validated["limits"])
    quota["notes"] = validated["notes"]
    quota["alert_thresholds"] = validated["thresholds"]
    quotas.append(quota)
    _save_quotas(quotas)
    _audit("create", tenant_id=validated["tenant_id"], details={"limits": validated["limits"]})
    return {"quota": quota, "saved": True}


def _update_quota():
    body = request.get_json(silent=True) or {}
    quota_id = (body.get("id") or "").strip()
    if not quota_id:
        return jsonify({"error": "id is required"}), 400

    validated, err = _validate_quota_body(body)
    if err:
        return jsonify({"error": err}), 400

    quotas = _load_quotas()
    quota = next((q for q in quotas if q.get("id") == quota_id), None)
    if not quota:
        return jsonify({"error": "quota not found"}), 404

    tenant = _get_tenant_by_id(validated["tenant_id"])
    quota["tenant_id"] = validated["tenant_id"]
    quota["tenant_name"] = tenant.get("name", validated["tenant_id"])
    quota.update(validated["limits"])
    quota["notes"] = validated["notes"]
    quota["alert_thresholds"] = validated["thresholds"]
    quota["updated_at"] = _now_iso()
    _save_quotas(quotas)
    _audit("edit", tenant_id=validated["tenant_id"], details={"limits": validated["limits"]})
    return {"quota": quota, "saved": True}


def _delete_quota():
    quota_id = request.args.get("id", "").strip()
    if not quota_id:
        body = request.get_json(silent=True) or {}
        quota_id = (body.get("id") or "").strip()
    if not quota_id:
        return jsonify({"error": "id is required"}), 400

    quotas = _load_quotas()
    quota = next((q for q in quotas if q.get("id") == quota_id), None)
    if not quota:
        return jsonify({"error": "quota not found"}), 404

    quotas = [q for q in quotas if q.get("id") != quota_id]
    _save_quotas(quotas)
    _audit("delete", tenant_id=quota.get("tenant_id"), details={"quota_id": quota_id})
    return {"deleted": quota_id}


def _quotas_handler():
    if request.method == "GET":
        return _get_quotas()
    if request.method == "POST":
        return _create_quota()
    if request.method == "PUT":
        return _update_quota()
    if request.method == "DELETE":
        return _delete_quota()
    return jsonify({"error": "Method not allowed"}), 405


def _get_usage():
    tenant_id = request.args.get("tenant_id", "").strip()
    if not tenant_id:
        return jsonify({"error": "tenant_id is required"}), 400
    if not _get_tenant_by_id(tenant_id):
        return jsonify({"error": "tenant not found or not visible"}), 404

    quotas = _load_quotas()
    quota = next((q for q in quotas if q.get("tenant_id") == tenant_id), None)
    if not quota:
        quota = DEFAULT_LIMITS.copy()
        quota["tenant_id"] = tenant_id
        quota["tenant_name"] = _get_tenant_by_id(tenant_id).get("name", tenant_id)

    usage = _compute_usage(tenant_id)
    if usage is None:
        return jsonify({"error": "failed to compute usage"}), 500

    view = _build_usage_view(quota, usage)
    return {"tenant_id": tenant_id, "quota": quota, "usage": view}


def _get_templates():
    templates = _load_templates()
    return {"templates": templates}


def _create_template():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400

    limits = {k: _coerce_int(body.get(k)) for k in ("max_vcpus", "max_memory_mb", "max_storage_gb", "max_vms")}
    notes = str(body.get("notes", ""))[:500]
    templates = _load_templates()
    if any(t.get("name", "").lower() == name.lower() for t in templates):
        return jsonify({"error": "template name already exists"}), 409

    template = {
        "id": _new_id("tmpl-"),
        "name": name,
        "limits": limits,
        "notes": notes,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    templates.append(template)
    _save_templates(templates)
    _audit("create_template", details={"name": name})
    return {"template": template}


def _update_template():
    body = request.get_json(silent=True) or {}
    template_id = (body.get("id") or "").strip()
    if not template_id:
        return jsonify({"error": "id is required"}), 400

    templates = _load_templates()
    template = next((t for t in templates if t.get("id") == template_id), None)
    if not template:
        return jsonify({"error": "template not found"}), 404

    name = (body.get("name") or "").strip()
    if name:
        if any(t.get("name", "").lower() == name.lower() and t.get("id") != template_id for t in templates):
            return jsonify({"error": "template name already in use"}), 409
        template["name"] = name

    template["limits"] = {
        k: _coerce_int(body.get(k, template["limits"].get(k)))
        for k in ("max_vcpus", "max_memory_mb", "max_storage_gb", "max_vms")
    }
    template["notes"] = str(body.get("notes", template.get("notes", "")))[:500]
    template["updated_at"] = _now_iso()
    _save_templates(templates)
    _audit("edit_template", details={"template_id": template_id})
    return {"template": template}


def _delete_template():
    template_id = request.args.get("id", "").strip()
    if not template_id:
        body = request.get_json(silent=True) or {}
        template_id = (body.get("id") or "").strip()
    if not template_id:
        return jsonify({"error": "id is required"}), 400

    templates = _load_templates()
    if not any(t.get("id") == template_id for t in templates):
        return jsonify({"error": "template not found"}), 404

    templates = [t for t in templates if t.get("id") != template_id]
    _save_templates(templates)
    _audit("delete_template", details={"template_id": template_id})
    return {"deleted": template_id}


def _templates_handler():
    if request.method == "GET":
        return _get_templates()
    if request.method == "POST":
        return _create_template()
    if request.method == "PUT":
        return _update_template()
    if request.method == "DELETE":
        return _delete_template()
    return jsonify({"error": "Method not allowed"}), 405


def _apply_template():
    body = request.get_json(silent=True) or {}
    template_id = (body.get("template_id") or "").strip()
    tenant_id = (body.get("tenant_id") or "").strip()
    if not template_id or not tenant_id:
        return jsonify({"error": "template_id and tenant_id are required"}), 400
    if not _get_tenant_by_id(tenant_id):
        return jsonify({"error": "tenant not found or not visible"}), 404

    templates = _load_templates()
    template = next((t for t in templates if t.get("id") == template_id), None)
    if not template:
        return jsonify({"error": "template not found"}), 404

    quotas = _load_quotas()
    quota = next((q for q in quotas if q.get("tenant_id") == tenant_id), None)
    if not quota:
        tenant = _get_tenant_by_id(tenant_id)
        quota = {
            "id": _new_id("quota-"),
            "tenant_id": tenant_id,
            "tenant_name": tenant.get("name", tenant_id),
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        quota.update(DEFAULT_LIMITS)
        quotas.append(quota)

    quota.update(template.get("limits", {}))
    quota["updated_at"] = _now_iso()
    _save_quotas(quotas)
    _audit("apply_template", tenant_id=tenant_id, details={"template_id": template_id})
    return {"quota": quota}


def _get_alerts():
    ack_ids = _get_acknowledged_alert_ids()
    quotas = _load_quotas()
    alerts = []
    for quota in quotas:
        if quota.get("tenant_id") not in _visible_tenants():
            continue
        usage = _compute_usage(quota["tenant_id"])
        if usage is None:
            continue
        alerts.extend(_active_alerts(quota, usage, ack_ids))
    return {"alerts": alerts, "total": len(alerts)}


def _acknowledge_alert():
    body = request.get_json(silent=True) or {}
    alert_id = (body.get("id") or "").strip()
    if not alert_id:
        return jsonify({"error": "id is required"}), 400
    config = _load_config()
    ack = set(config.get("acknowledged_alerts", []))
    ack.add(alert_id)
    config["acknowledged_alerts"] = sorted(ack)
    _save_config(config)
    return {"acknowledged": alert_id}


def _get_defaults():
    cluster_id = request.args.get("cluster_id", "").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    config = _load_config()
    defaults = config.get("defaults", {}).get(cluster_id, {})
    return {"cluster_id": cluster_id, "defaults": defaults}


def _defaults_handler():
    # register_plugin_route() has no concept of per-method handlers (unlike
    # Flask's own @bp.route), so GET/POST for the same path must be
    # dispatched from a single registered function — same pattern as
    # _quotas_handler() above.
    if request.method == "GET":
        return _get_defaults()
    if request.method == "POST":
        return _set_defaults()
    return jsonify({"error": "Method not allowed"}), 405


def _set_defaults():
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err

    limits = {k: _coerce_int(body.get(k)) for k in ("max_vcpus", "max_memory_mb", "max_storage_gb", "max_vms")}
    config = _load_config()
    config.setdefault("defaults", {})[cluster_id] = limits
    _save_config(config)
    _audit("set_defaults", details={"cluster_id": cluster_id, "limits": limits})
    return {"cluster_id": cluster_id, "defaults": limits}


def _apply_defaults():
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err

    config = _load_config()
    defaults = config.get("defaults", {}).get(cluster_id, {})
    if not defaults:
        return jsonify({"error": "no defaults configured for this cluster"}), 400

    allowed_clusters = _allowed_clusters()
    allowed_set = None if allowed_clusters is None else set(allowed_clusters)
    visible = _visible_tenants()
    quotas = _load_quotas()
    updated = []

    for tenant_id, tenant in visible.items():
        t_clusters = tenant.get("clusters") or []
        if allowed_set is not None and t_clusters and not any(c in allowed_set for c in t_clusters):
            continue
        if allowed_set is not None and t_clusters and cluster_id not in t_clusters:
            continue
        quota = next((q for q in quotas if q.get("tenant_id") == tenant_id), None)
        if not quota:
            quota = {
                "id": _new_id("quota-"),
                "tenant_id": tenant_id,
                "tenant_name": tenant.get("name", tenant_id),
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
            }
            quota.update(DEFAULT_LIMITS)
            quotas.append(quota)
        quota.update({k: v for k, v in defaults.items() if v is not None})
        quota["updated_at"] = _now_iso()
        updated.append(tenant_id)

    _save_quotas(quotas)
    _audit("apply_defaults", details={"cluster_id": cluster_id, "tenants": updated})
    return {"cluster_id": cluster_id, "updated": updated}


def _export_data():
    fmt = (request.args.get("format") or "").lower()
    quotas = _load_quotas()
    templates = _load_templates()
    data = {"quotas": quotas, "templates": templates}

    if fmt == "json":
        return Response(
            json.dumps(data, indent=2),
            mimetype="application/json",
            headers={"Content-Disposition": "attachment; filename=vm-resource-quotas.json"},
        )
    if fmt == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "tenant_id",
            "tenant_name",
            "max_vcpus",
            "max_memory_mb",
            "max_storage_gb",
            "max_vms",
            "notes",
        ])
        for q in quotas:
            writer.writerow([
                q.get("tenant_id"),
                q.get("tenant_name"),
                q.get("max_vcpus") or "",
                q.get("max_memory_mb") or "",
                q.get("max_storage_gb") or "",
                q.get("max_vms") or "",
                q.get("notes", ""),
            ])
        return Response(
            output.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=vm-resource-quotas.csv"},
        )

    return data


def _import_data():
    body = request.get_json(silent=True) or {}
    fmt = (body.get("format") or "json").lower()
    imported = 0
    skipped = 0
    errors = []

    quotas = _load_quotas()

    if fmt == "json":
        data = body.get("data")
        if not isinstance(data, dict):
            return jsonify({"error": "data must be an object"}), 400
        for q in data.get("quotas", []):
            name = (q.get("tenant_id") or "").strip()
            if not name or not _get_tenant_by_id(name):
                skipped += 1
                continue
            if any(x.get("tenant_id") == name for x in quotas):
                errors.append(f"quota already exists for {name}")
                continue
            validated, err = _validate_quota_body({
                "tenant_id": name,
                **{k: q.get(k) for k in ("max_vcpus", "max_memory_mb", "max_storage_gb", "max_vms")},
                "notes": q.get("notes", ""),
                "alert_thresholds": q.get("alert_thresholds"),
            })
            if err:
                skipped += 1
                errors.append(f"{name}: {err}")
                continue
            quota = {
                "id": _new_id("quota-"),
                "tenant_id": name,
                "tenant_name": _get_tenant_by_id(name).get("name", name),
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
            }
            quota.update(validated["limits"])
            quota["notes"] = validated["notes"]
            quota["alert_thresholds"] = validated["thresholds"]
            quotas.append(quota)
            imported += 1
    elif fmt == "csv":
        raw = body.get("data") or ""
        reader = csv.DictReader(io.StringIO(raw))
        for row in reader:
            tid = (row.get("tenant_id") or "").strip()
            if not tid or not _get_tenant_by_id(tid):
                skipped += 1
                continue
            q = {
                "tenant_id": tid,
                "max_vcpus": row.get("max_vcpus"),
                "max_memory_mb": row.get("max_memory_mb"),
                "max_storage_gb": row.get("max_storage_gb"),
                "max_vms": row.get("max_vms"),
                "notes": row.get("notes", ""),
            }
            validated, err = _validate_quota_body(q)
            if err:
                skipped += 1
                errors.append(f"{tid}: {err}")
                continue
            if any(x.get("tenant_id") == tid for x in quotas):
                errors.append(f"quota already exists for {tid}")
                continue
            quota = {
                "id": _new_id("quota-"),
                "tenant_id": tid,
                "tenant_name": _get_tenant_by_id(tid).get("name", tid),
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
            }
            quota.update(validated["limits"])
            quota["notes"] = validated["notes"]
            quota["alert_thresholds"] = validated["thresholds"]
            quotas.append(quota)
            imported += 1
    else:
        return jsonify({"error": "format must be json or csv"}), 400

    _save_quotas(quotas)
    _audit("import", details={"imported": imported, "skipped": skipped, "format": fmt})
    return {"imported": imported, "skipped": skipped, "errors": errors}


def _get_history():
    history = _load_json(HISTORY_FILE, [])
    tenant_id = request.args.get("tenant_id", "").strip()
    action = request.args.get("action", "").strip()
    try:
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
    except ValueError:
        return jsonify({"error": "limit and offset must be integers"}), 400

    if tenant_id:
        history = [h for h in history if h.get("tenant_id") == tenant_id]
    if action:
        history = [h for h in history if h.get("action") == action]

    sort = request.args.get("sort", "timestamp")
    order = request.args.get("order", "desc")
    reverse = order == "desc"
    history.sort(key=lambda h: h.get(sort, ""), reverse=reverse)

    total = len(history)
    page = history[offset : offset + limit]
    return {"history": page, "total": total}


def _get_dashboard():
    quotas = _load_quotas()
    visible = _visible_tenants()
    rows = []
    for quota in quotas:
        if quota.get("tenant_id") not in visible:
            continue
        usage = _compute_usage(quota["tenant_id"])
        if usage is None:
            continue
        view = _build_usage_view(quota, usage)
        highest = max((v["percent"] for v in view["view"].values()), default=0.0)
        worst = max(
            (v["state"] for v in view["view"].values()), key=lambda s: {"ok": 0, "warning": 1, "danger": 2}.get(s, 0)
        )
        rows.append({
            "tenant_id": quota["tenant_id"],
            "tenant_name": quota.get("tenant_name", quota["tenant_id"]),
            "highest_pct": highest,
            "state": worst,
        })
    rows.sort(key=lambda r: r["highest_pct"], reverse=True)
    return {"tenants": rows[:50]}


def _get_ui():
    """Serve the VM Resource Quotas HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "tenants", _get_tenants)
    register_plugin_route(PLUGIN_ID, "quotas", _quotas_handler)
    register_plugin_route(PLUGIN_ID, "usage", _get_usage)
    register_plugin_route(PLUGIN_ID, "templates", _templates_handler)
    register_plugin_route(PLUGIN_ID, "templates/apply", _apply_template)
    register_plugin_route(PLUGIN_ID, "alerts", _get_alerts)
    register_plugin_route(PLUGIN_ID, "alerts/acknowledge", _acknowledge_alert)
    register_plugin_route(PLUGIN_ID, "defaults", _defaults_handler)
    register_plugin_route(PLUGIN_ID, "defaults/apply", _apply_defaults)
    register_plugin_route(PLUGIN_ID, "export", _export_data)
    register_plugin_route(PLUGIN_ID, "import", _import_data)
    register_plugin_route(PLUGIN_ID, "history", _get_history)
    register_plugin_route(PLUGIN_ID, "dashboard", _get_dashboard)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info(f"[PLUGINS] {PLUGIN_ID} registered")
