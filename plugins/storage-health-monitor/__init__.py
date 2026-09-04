# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/storage-health-monitor/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: storage-health-monitor — ProxmoxVEx Plugin
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
storage-health-monitor — ProxmoxVEx Plugin
Reports disk health across cluster nodes and simulates storage scrub jobs.
"""

import contextlib
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugin_data_bridge import get_clusters
from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.globals import cluster_managers
from ProxmoxVEx.utils.audit import log_audit

PLUGIN_ID = "storage-health-monitor"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
DATA_DIR = PLUGIN_DIR / "data"
SCRUB_HISTORY_FILE = DATA_DIR / "scrub_history.json"
HEALTH_SNAPSHOTS_FILE = DATA_DIR / "health_snapshots.json"
ALERT_RULES_FILE = DATA_DIR / "alert_rules.json"
AUDIT_LOG_FILE = DATA_DIR / "audit_log.json"
DISK_HISTORY_FILE = DATA_DIR / "disk_health_history.json"
SCHEDULE_FILE = DATA_DIR / "schedule.json"


# ─── Data helpers ──────────────────────────────────────────────────────


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix=""):
    return f"{prefix}{uuid.uuid4()}"


def _load_json(path, default):
    if not path.exists():
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _save_json(path, data):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        log.error(f"save {path}: {e}")


def _ensure_data_files():
    for path, default in (
        (SCRUB_HISTORY_FILE, []),
        (HEALTH_SNAPSHOTS_FILE, []),
        (ALERT_RULES_FILE, {"rules": [], "active_alerts": []}),
        (AUDIT_LOG_FILE, []),
        (DISK_HISTORY_FILE, {}),
        (SCHEDULE_FILE, {"schedules": {}}),
    ):
        if not path.exists():
            _save_json(path, default)


def _current_user():
    return getattr(request, "session", {}).get("user", "unknown")


def _audit(action, cluster_id, details=None):
    user = _current_user()
    entry = {
        "id": _new_id("audit-"),
        "action": action,
        "cluster_id": cluster_id or "",
        "user": user,
        "timestamp": _now_iso(),
        "details": details or {},
    }
    audit_log = _load_json(AUDIT_LOG_FILE, [])
    audit_log.insert(0, entry)
    _save_json(AUDIT_LOG_FILE, audit_log[:5000])
    with contextlib.suppress(Exception):
        log_audit(user, action, json.dumps(details) if details else "", cluster=cluster_id)


def _get_cluster_id_from_request():
    body = request.get_json(silent=True) or {}
    return (request.args.get("cluster_id", "") or body.get("cluster_id", "")).strip()


def _manager_or_error(cluster_id):
    if not cluster_id:
        return None, (jsonify({"error": "cluster_id is required"}), 400)
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return None, err
    return get_connected_manager(cluster_id)


# ─── Health helpers ────────────────────────────────────────────────────


def _normalize_health(raw):
    value = (raw or "Unknown").strip().upper()
    if value in ("OK", "PASSED", "GOOD"):
        return "OK"
    if "WARN" in value:
        return "Warning"
    if value in ("", "UNKNOWN", "?"):
        return "Unknown"
    return "Failing"


def _parse_size(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return 0


def _normalize_disk(raw, node_name):
    health = _normalize_health(raw.get("health"))
    size = _parse_size(raw.get("size"))
    return {
        "node": raw.get("node") or node_name,
        "devpath": raw.get("devpath") or raw.get("name") or "Unknown",
        "name": raw.get("name") or raw.get("devpath") or "Unknown",
        "health": health,
        "size": size,
        "model": raw.get("model") or raw.get("vendor") or "Unknown",
        "serial": raw.get("serial") or "",
        "wearout": raw.get("wearout", ""),
        "temperature": raw.get("temperature", ""),
    }


def _get_disks_for_cluster(manager, cluster_id):
    nodes = manager.api_request("GET", "/nodes") or []
    all_disks = []
    for node in nodes:
        node_name = node.get("node")
        if not node_name:
            continue
        try:
            disks = manager.api_request("GET", f"/nodes/{node_name}/disks/list") or []
        except Exception:
            disks = []
        for d in disks:
            d["node"] = node_name
        all_disks.extend(disks)
    return all_disks


def _categorize_disks(disks):
    healthy = warning = failing = unknown = 0
    for d in disks:
        h = d["health"]
        if h == "OK":
            healthy += 1
        elif h == "Warning":
            warning += 1
        elif h == "Unknown":
            unknown += 1
        else:
            failing += 1
    return healthy, warning, failing, unknown


def _disk_key(d):
    return f"{d.get('node', '')}|{d.get('devpath', d.get('name', ''))}"


def _load_disk_history():
    return _load_json(DISK_HISTORY_FILE, {})


def _save_disk_history(history):
    _save_json(DISK_HISTORY_FILE, history)


def _apply_disk_changes(cluster_id, disks):
    """Mark disks whose health changed since the previous check."""
    history = _load_disk_history()
    previous = history.get(cluster_id, {})
    for d in disks:
        key = _disk_key(d)
        last = previous.get(key, {}).get("health")
        d["previous_health"] = last if last is not None else ""
        d["changed"] = bool(last) and last != d["health"]
    history[cluster_id] = {_disk_key(d): {"health": d["health"], "checked_at": _now_iso()} for d in disks}
    _save_disk_history(history)
    return disks


def _get_schedule_for_cluster(cluster_id):
    data = _load_json(SCHEDULE_FILE, {"schedules": {}})
    return data.get("schedules", {}).get(cluster_id, {"interval_minutes": 0})


def _set_schedule_for_cluster(cluster_id, interval_minutes):
    data = _load_json(SCHEDULE_FILE, {"schedules": {}})
    data.setdefault("schedules", {})[cluster_id] = {
        "interval_minutes": interval_minutes,
        "updated_at": _now_iso(),
    }
    _save_json(SCHEDULE_FILE, data)


def _next_check_at(cluster_id, last_at):
    schedule = _get_schedule_for_cluster(cluster_id)
    interval = schedule.get("interval_minutes", 0) or 0
    if not interval or not last_at:
        return None
    try:
        last = datetime.fromisoformat(last_at.replace("Z", "+00:00"))
        return (last + timedelta(minutes=interval)).isoformat()
    except Exception:
        return None


def _load_thresholds():
    data = _load_alerts()
    defaults = {
        "min_ok_percentage": 90,
        "max_warning_disks": 0,
        "max_failing_disks": 0,
    }
    stored = data.get("thresholds") or {}
    if not isinstance(stored, dict):
        stored = {}
    merged = {**defaults, **stored}
    data["thresholds"] = merged
    return merged


def _thresholds_for_cluster(cluster_id, thresholds):
    return {
        "min_ok_percentage": thresholds.get("min_ok_percentage", 90),
        "max_warning_disks": thresholds.get("max_warning_disks", 0),
        "max_failing_disks": thresholds.get("max_failing_disks", 0),
    }


# ─── Alert helpers ─────────────────────────────────────────────────────


def _load_alerts():
    data = _load_json(ALERT_RULES_FILE, {"rules": [], "active_alerts": []})
    if not isinstance(data, dict):
        data = {"rules": [], "active_alerts": []}
    data.setdefault("rules", [])
    data.setdefault("active_alerts", [])
    return data


def _save_alerts(data):
    _save_json(ALERT_RULES_FILE, data)


def _eval_rule(rule, result):
    if not rule.get("enabled"):
        return False
    threshold = rule.get("threshold")
    operator = rule.get("operator")
    value = rule.get("value")
    if threshold == "healthy_percentage":
        sample = (result.get("health_index", 0) * 100) if result else 0
    elif threshold == "warning_count":
        sample = result.get("warning_disks", 0) if result else 0
    elif threshold == "failing_count":
        sample = result.get("failing_disks", 0) if result else 0
    elif threshold == "total_count":
        sample = result.get("total_disks", 0) if result else 0
    else:
        return False
    try:
        if operator == "lt":
            return sample < value
        if operator == "gt":
            return sample > value
        if operator == "eq":
            return sample == value
        return False
    except Exception:
        return False


def _maybe_fire_alerts(result):
    data = _load_alerts()
    triggered = []
    for rule in data.get("rules", []):
        if _eval_rule(rule, result):
            existing = next(
                (a for a in data["active_alerts"] if a.get("rule_id") == rule["id"] and not a.get("resolved_at")),
                None,
            )
            if not existing:
                msg = f"{rule['threshold']} {rule['operator']} {rule['value']} for cluster {result.get('cluster_id')}"
                alert = {
                    "id": _new_id("alert-"),
                    "rule_id": rule["id"],
                    "cluster_id": rule.get("cluster_id") or result.get("cluster_id"),
                    "message": msg,
                    "severity": "danger"
                    if rule.get("threshold") == "failing_count" or rule.get("threshold") == "healthy_percentage"
                    else "warning",
                    "created_at": _now_iso(),
                    "resolved_at": None,
                    "resolved_by": None,
                }
                data["active_alerts"].append(alert)
                triggered.append(alert)
    _save_alerts(data)
    return triggered


# ─── Route handlers ─────────────────────────────────────────────────────


def _get_status():
    """Plugin status."""
    return {"plugin": PLUGIN_ID, "status": "running"}


def _get_clusters():
    """List clusters the current user may access."""
    clusters = get_clusters().get("clusters", [])

    for cluster_id, mgr in cluster_managers.items():
        allowed, _ = check_cluster_access(cluster_id)
        if not allowed:
            continue
        clusters.append({
            "id": cluster_id,
            "name": getattr(mgr.config, "name", cluster_id),
            "display_name": getattr(mgr.config, "name", cluster_id),
            "reachable": mgr.is_connected,
            "connected": mgr.is_connected,
        })
    return {"data": sorted(clusters, key=lambda c: c.get("name", "").lower())}


def _get_nodes():
    """List nodes for a cluster."""
    cluster_id = _get_cluster_id_from_request()
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        nodes = manager.api_request("GET", "/nodes") or []
        data = []
        for n in nodes:
            name = n.get("node")
            if not name:
                continue
            data.append({
                "name": name,
                "status": n.get("status", "unknown"),
                "online": n.get("status") == "online",
            })
        return {"cluster_id": cluster_id, "data": data}
    except Exception as e:
        log.exception("[nodes] failed")
        return jsonify({"error": safe_error(e, "node list failed")}), 500


def _get_storages():
    """List storage on a node."""
    body = request.get_json(silent=True) or {}
    cluster_id = _get_cluster_id_from_request()
    node = (request.args.get("node") or body.get("node") or "").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    if not node:
        return jsonify({"error": "node is required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        storages = manager.api_request("GET", f"/nodes/{node}/storage") or []
        data = []
        for s in storages:
            data.append({
                "name": s.get("storage"),
                "type": s.get("type", "unknown"),
                "content": s.get("content", ""),
                "node": node,
            })
        return {"cluster_id": cluster_id, "node": node, "data": data}
    except Exception as e:
        log.exception("[storages] failed")
        return jsonify({"error": safe_error(e, "storage list failed")}), 500


def _get_health():
    """GET health index with disk status."""
    cluster_id = _get_cluster_id_from_request()
    dry_run = request.args.get("dry_run", "0") in ("1", "true") or (request.get_json(silent=True) or {}).get("dry_run")
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        if dry_run:
            _audit("health_check", cluster_id, {"dry_run": True})
            return {
                "cluster_id": cluster_id,
                "dry_run": True,
                "health_index": None,
                "healthy_disks": 0,
                "warning_disks": 0,
                "failing_disks": 0,
                "unknown_disks": 0,
                "total_disks": 0,
                "disks": [],
            }
        raw_disks = _get_disks_for_cluster(manager, cluster_id)
        disks = [_normalize_disk(d, d.get("node", "")) for d in raw_disks]
        _apply_disk_changes(cluster_id, disks)
        healthy, warning, failing, unknown = _categorize_disks(disks)
        total = len(disks) or 1
        health_index = round(healthy / total, 2)
        thresholds = _thresholds_for_cluster(cluster_id, _load_thresholds())
        checked_at = _now_iso()
        result = {
            "cluster_id": cluster_id,
            "health_index": health_index,
            "healthy_disks": healthy,
            "warning_disks": warning,
            "failing_disks": failing,
            "unknown_disks": unknown,
            "total_disks": len(disks),
            "disks": disks,
            "checked_at": checked_at,
            "next_check_at": _next_check_at(cluster_id, checked_at),
            "meets_threshold": (health_index * 100) >= thresholds["min_ok_percentage"],
            "thresholds": thresholds,
        }
        snapshots = _load_json(HEALTH_SNAPSHOTS_FILE, [])
        snapshots.insert(
            0,
            {
                "id": _new_id("snap-"),
                "cluster_id": cluster_id,
                "timestamp": result["checked_at"],
                "health_index": result["health_index"],
                "healthy_disks": healthy,
                "warning_disks": warning,
                "failing_disks": failing,
                "unknown_disks": unknown,
                "total_disks": result["total_disks"],
            },
        )
        _save_json(HEALTH_SNAPSHOTS_FILE, snapshots[:5000])
        _maybe_fire_alerts(result)
        _audit(
            "health_check",
            cluster_id,
            {"healthy": healthy, "warning": warning, "failing": failing, "total": result["total_disks"]},
        )
        return result
    except Exception as e:
        log.exception("[health] failed")
        return jsonify({"error": safe_error(e, "health check failed")}), 500


def _get_disks():
    """GET list of disks."""
    cluster_id = _get_cluster_id_from_request()
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        raw = _get_disks_for_cluster(manager, cluster_id)
        disks = [_normalize_disk(d, d.get("node", "")) for d in raw]
        return {"cluster_id": cluster_id, "disks": disks}
    except Exception as e:
        log.exception("[disks] failed")
        return jsonify({"error": safe_error(e, "disk list failed")}), 500


def _start_scrub():
    """POST start a scrub on a node/storage combination."""
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or request.args.get("cluster_id", "")).strip()
    node = (body.get("node") or request.args.get("node", "")).strip()
    storage = (body.get("storage") or request.args.get("storage", "")).strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    if not node or not storage:
        return jsonify({"error": "node and storage are required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        storages = manager.api_request("GET", f"/nodes/{node}/storage") or []
        names = {s.get("storage") for s in storages}
        if storage not in names:
            return jsonify({"error": f"storage {storage} not found on node {node}"}), 404
    except Exception as e:
        log.exception("[start-scrub] storage validation failed")
        return jsonify({"error": safe_error(e, "could not validate storage")}), 500
    job = {
        "job_id": _new_id("scrub-"),
        "cluster_id": cluster_id,
        "node": node,
        "storage": storage,
        "status": "started",
        "started_at": _now_iso(),
        "completed_at": None,
        "result": {"message": "Scrub queued", "warnings": []},
    }
    history = _load_json(SCRUB_HISTORY_FILE, [])
    history.insert(0, job)
    _save_json(SCRUB_HISTORY_FILE, history[:5000])
    _audit("start_scrub", cluster_id, {"job_id": job["job_id"], "node": node, "storage": storage})
    return job


def _get_scrub_history():
    """GET scrub history with sort/filter."""
    cluster_id = (request.args.get("cluster_id") or "").strip()
    status = request.args.get("status", "").strip().lower()
    node = request.args.get("node", "").strip()
    storage = request.args.get("storage", "").strip()
    sort = request.args.get("sort", "started_at")
    reverse = request.args.get("order", "desc").lower() == "desc"
    try:
        limit = max(1, min(1000, int(request.args.get("limit", 50))))
        offset = max(0, int(request.args.get("offset", 0)))
    except ValueError:
        limit, offset = 50, 0
    history = _load_json(SCRUB_HISTORY_FILE, [])
    if cluster_id:
        history = [h for h in history if h.get("cluster_id") == cluster_id]
    if status:
        history = [h for h in history if h.get("status", "").lower() == status]
    if node:
        history = [h for h in history if h.get("node") == node]
    if storage:
        history = [h for h in history if h.get("storage") == storage]
    if sort in ("started_at", "status", "node", "storage"):
        history.sort(key=lambda h: h.get(sort, ""), reverse=reverse)
    return {
        "data": history[offset : offset + limit],
        "total": len(history),
        "limit": limit,
        "offset": offset,
    }


def _cancel_scrub():
    """POST cancel a running or started scrub."""
    body = request.get_json(silent=True) or {}
    job_id = (body.get("job_id") or request.args.get("job_id", "")).strip()
    if not job_id:
        return jsonify({"error": "job_id is required"}), 400
    history = _load_json(SCRUB_HISTORY_FILE, [])
    for job in history:
        if job.get("job_id") == job_id and job.get("status") in ("started", "running"):
            job["status"] = "cancelled"
            job["completed_at"] = _now_iso()
            _save_json(SCRUB_HISTORY_FILE, history)
            _audit("cancel_scrub", job.get("cluster_id"), {"job_id": job_id})
            return {"job_id": job_id, "status": "cancelled"}
    return jsonify({"error": "job not found or not running"}), 404


def _get_trends():
    """GET health snapshots over time."""
    cluster_id = _get_cluster_id_from_request()
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    start = request.args.get("start", "").strip()
    end = request.args.get("end", "").strip()
    interval = request.args.get("interval", "hourly").lower()
    snapshots = _load_json(HEALTH_SNAPSHOTS_FILE, [])
    snapshots = [s for s in snapshots if s.get("cluster_id") == cluster_id]
    if start:
        snapshots = [s for s in snapshots if s.get("timestamp", "") >= start]
    if end:
        snapshots = [s for s in snapshots if s.get("timestamp", "") <= end]
    if interval in ("daily", "weekly"):
        buckets = {}
        for s in snapshots:
            ts = s.get("timestamp", _now_iso())
            bucket = ts[:10]
            if interval == "weekly":
                bucket = ts[:7]
            buckets.setdefault(bucket, []).append(s)
        agg = []
        for _bucket, items in sorted(buckets.items()):
            agg.append({
                "timestamp": items[0]["timestamp"],
                "health_index": round(sum(i.get("health_index", 0) for i in items) / len(items), 2),
                "healthy_disks": items[-1].get("healthy_disks", 0),
                "warning_disks": items[-1].get("warning_disks", 0),
                "failing_disks": items[-1].get("failing_disks", 0),
                "total_disks": items[-1].get("total_disks", 0),
            })
        snapshots = agg
    return {"cluster_id": cluster_id, "interval": interval, "data": snapshots}


def _get_schedule():
    """GET/POST periodic health check interval."""
    cluster_id = _get_cluster_id_from_request() or ""
    body = request.get_json(silent=True) or {}
    if request.method == "POST":
        interval = body.get("interval_minutes", 0)
        try:
            interval = max(0, int(interval))
        except (TypeError, ValueError):
            interval = 0
        _set_schedule_for_cluster(cluster_id, interval)
        _audit("schedule_update", cluster_id, {"interval_minutes": interval})
    schedule = _get_schedule_for_cluster(cluster_id)
    snapshots = _load_json(HEALTH_SNAPSHOTS_FILE, [])
    last_check = ""
    for s in snapshots:
        if s.get("cluster_id") == cluster_id:
            last_check = s.get("timestamp", "")
            break
    interval = schedule.get("interval_minutes", 0) or 0
    return {
        "cluster_id": cluster_id,
        "interval_minutes": interval,
        "last_check_at": last_check,
        "next_check_at": _next_check_at(cluster_id, last_check) if last_check else None,
    }


def _get_alert_rules():
    """GET alert rules."""
    data = _load_alerts()
    cluster_id = request.args.get("cluster_id", "").strip()
    rules = data.get("rules", [])
    if cluster_id:
        rules = [r for r in rules if r.get("cluster_id") == cluster_id or r.get("cluster_id") == "*"]
    return {"data": rules}


def _post_alert_rules():
    """POST/PUT alert rule."""
    body = request.get_json(silent=True) or {}
    data = _load_alerts()
    rule_id = body.get("id")
    rule = {
        "id": rule_id or _new_id("rule-"),
        "cluster_id": (body.get("cluster_id") or "*").strip(),
        "enabled": bool(body.get("enabled", True)),
        "threshold": body.get("threshold", "healthy_percentage"),
        "operator": body.get("operator", "lt"),
        "value": body.get("value", 0),
        "channels": body.get("channels", ["ui"]),
        "email": body.get("email", ""),
        "webhook_url": body.get("webhook_url", ""),
        "created_at": _now_iso(),
    }
    rules = data.get("rules", [])
    existing = next((i for i, r in enumerate(rules) if r.get("id") == rule["id"]), None)
    if existing is not None:
        rule["created_at"] = rules[existing].get("created_at", rule["created_at"])
        rules[existing] = rule
        action = "alert_update"
    else:
        rules.insert(0, rule)
        action = "alert_create"
    _save_alerts(data)
    _audit(action, rule.get("cluster_id"), rule)
    return {"data": rule}


def _delete_alert_rule():
    """DELETE alert rule by id."""
    body = request.get_json(silent=True) or {}
    rule_id = (request.args.get("id") or body.get("id") or "").strip()
    if not rule_id:
        return jsonify({"error": "id is required"}), 400
    data = _load_alerts()
    data["rules"] = [r for r in data.get("rules", []) if r.get("id") != rule_id]
    _save_alerts(data)
    return {"deleted": rule_id}


def _alert_rules_handler():
    """Dispatch alert rules CRUD by HTTP method."""
    if request.method == "POST":
        return _post_alert_rules()
    if request.method == "DELETE":
        return _delete_alert_rule()
    return _get_alert_rules()


def _get_active_alerts():
    """GET active and resolved alerts."""
    data = _load_alerts()
    cluster_id = request.args.get("cluster_id", "").strip()
    severity = request.args.get("severity", "").strip()
    resolved = request.args.get("resolved", "").strip()
    alerts = data.get("active_alerts", [])
    if cluster_id:
        alerts = [a for a in alerts if a.get("cluster_id") == cluster_id]
    if severity:
        alerts = [a for a in alerts if a.get("severity") == severity]
    if resolved == "true":
        alerts = [a for a in alerts if a.get("resolved_at")]
    elif resolved == "false":
        alerts = [a for a in alerts if not a.get("resolved_at")]
    return {"data": sorted(alerts, key=lambda a: a.get("created_at", ""), reverse=True)}


def _resolve_alert():
    """POST resolve an active alert."""
    body = request.get_json(silent=True) or {}
    alert_id = (body.get("id") or request.args.get("id", "")).strip()
    if not alert_id:
        return jsonify({"error": "id is required"}), 400
    data = _load_alerts()
    for a in data.get("active_alerts", []):
        if a.get("id") == alert_id and not a.get("resolved_at"):
            a["resolved_at"] = _now_iso()
            a["resolved_by"] = _current_user()
            _save_alerts(data)
            _audit("alert_resolve", a.get("cluster_id"), {"alert_id": alert_id})
            return {"data": a}
    return jsonify({"error": "alert not found or already resolved"}), 404


def _get_audit():
    """GET audit log."""
    cluster_id = request.args.get("cluster_id", "").strip()
    action = request.args.get("action", "").strip()
    try:
        limit = max(1, min(1000, int(request.args.get("limit", 50))))
        offset = max(0, int(request.args.get("offset", 0)))
    except ValueError:
        limit, offset = 50, 0
    audit_log = _load_json(AUDIT_LOG_FILE, [])
    if cluster_id:
        audit_log = [e for e in audit_log if e.get("cluster_id") == cluster_id]
    if action:
        audit_log = [e for e in audit_log if e.get("action") == action]
    return {
        "data": audit_log[offset : offset + limit],
        "total": len(audit_log),
        "limit": limit,
        "offset": offset,
    }


def _get_ui():
    """Serve the Storage Health Monitor HTML interface."""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def _bulk_start_scrub():
    """POST start scrub jobs for multiple storages on one node."""
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or request.args.get("cluster_id", "")).strip()
    node = (body.get("node") or request.args.get("node", "")).strip()
    storages = body.get("storages") or []
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    if not node or not storages:
        return jsonify({"error": "node and storages are required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        available = manager.api_request("GET", f"/nodes/{node}/storage") or []
        names = {s.get("storage") for s in available}
        missing = [s for s in storages if s not in names]
        if missing:
            return jsonify({"error": f"storages not found on node {node}: {', '.join(missing)}"}), 404
    except Exception as e:
        log.exception("[bulk-scrub] storage validation failed")
        return jsonify({"error": safe_error(e, "could not validate storages")}), 500
    jobs = []
    for storage in storages:
        job = {
            "job_id": _new_id("scrub-"),
            "cluster_id": cluster_id,
            "node": node,
            "storage": storage,
            "status": "started",
            "started_at": _now_iso(),
            "completed_at": None,
            "result": {"message": "Scrub queued", "warnings": []},
        }
        history = _load_json(SCRUB_HISTORY_FILE, [])
        history.insert(0, job)
        _save_json(SCRUB_HISTORY_FILE, history[:5000])
        jobs.append(job)
        _audit("start_scrub", cluster_id, {"job_id": job["job_id"], "node": node, "storage": storage})
    return {"data": jobs}


def _compare_clusters():
    """GET health summary for multiple clusters."""
    cluster_ids = []
    raw = request.args.get("cluster_ids", "") or request.get_json(silent=True, force=True).get("cluster_ids", [])
    if isinstance(raw, str):
        cluster_ids = [c.strip() for c in raw.split(",") if c.strip()]
    elif isinstance(raw, list):
        cluster_ids = [str(c).strip() for c in raw if c]
    snapshots = _load_json(HEALTH_SNAPSHOTS_FILE, [])
    data = []
    for cluster_id in cluster_ids:
        allowed, _ = check_cluster_access(cluster_id)
        if not allowed:
            continue
        latest = next((s for s in snapshots if s.get("cluster_id") == cluster_id), None)
        if latest:
            data.append({
                "cluster_id": cluster_id,
                "timestamp": latest.get("timestamp"),
                "health_index": latest.get("health_index"),
                "healthy_disks": latest.get("healthy_disks", 0),
                "warning_disks": latest.get("warning_disks", 0),
                "failing_disks": latest.get("failing_disks", 0),
                "unknown_disks": latest.get("unknown_disks", 0),
                "total_disks": latest.get("total_disks", 0),
            })
        else:
            data.append({
                "cluster_id": cluster_id,
                "timestamp": None,
                "health_index": None,
                "healthy_disks": 0,
                "warning_disks": 0,
                "failing_disks": 0,
                "unknown_disks": 0,
                "total_disks": 0,
            })
    return {"data": data}


def _get_thresholds():
    """GET custom health thresholds."""
    return {"data": _load_thresholds()}


def _post_thresholds():
    """POST custom health thresholds."""
    body = request.get_json(silent=True) or {}
    data = _load_alerts()
    thresholds = {
        "min_ok_percentage": max(0, min(100, float(body.get("min_ok_percentage", 90)))),
        "max_warning_disks": max(0, int(body.get("max_warning_disks", 0))),
        "max_failing_disks": max(0, int(body.get("max_failing_disks", 0))),
    }
    data["thresholds"] = thresholds
    _save_alerts(data)
    _audit("threshold_update", _get_cluster_id_from_request() or "", thresholds)
    return {"data": thresholds}


def _thresholds_handler():
    """Dispatch threshold requests by method."""
    if request.method == "POST":
        return _post_thresholds()
    return _get_thresholds()


def _get_report():
    """GET a printable health report for the selected cluster."""
    cluster_id = _get_cluster_id_from_request()
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        raw_disks = _get_disks_for_cluster(manager, cluster_id)
        disks = [_normalize_disk(d, d.get("node", "")) for d in raw_disks]
        _apply_disk_changes(cluster_id, disks)
        healthy, warning, failing, unknown = _categorize_disks(disks)
        total = len(disks) or 1
        return {
            "cluster_id": cluster_id,
            "generated_at": _now_iso(),
            "health_index": round(healthy / total, 2),
            "healthy_disks": healthy,
            "warning_disks": warning,
            "failing_disks": failing,
            "unknown_disks": unknown,
            "total_disks": len(disks),
            "disks": disks,
            "thresholds": _thresholds_for_cluster(cluster_id, _load_thresholds()),
        }
    except Exception as e:
        log.exception("[report] failed")
        return jsonify({"error": safe_error(e, "report generation failed")}), 500


# ─── Plugin registration ───────────────────────────────────────────────


def register(app):
    """Register plugin routes."""
    _ensure_data_files()
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "nodes", _get_nodes)
    register_plugin_route(PLUGIN_ID, "storages", _get_storages)
    register_plugin_route(PLUGIN_ID, "health", _get_health)
    register_plugin_route(PLUGIN_ID, "disks", _get_disks)
    register_plugin_route(PLUGIN_ID, "dry-run", _get_health)
    register_plugin_route(PLUGIN_ID, "start-scrub", _start_scrub)
    register_plugin_route(PLUGIN_ID, "scrub-history", _get_scrub_history)
    register_plugin_route(PLUGIN_ID, "scrub/cancel", _cancel_scrub)
    register_plugin_route(PLUGIN_ID, "trends", _get_trends)
    register_plugin_route(PLUGIN_ID, "alerts/rules", _alert_rules_handler)
    register_plugin_route(PLUGIN_ID, "alerts/active", _get_active_alerts)
    register_plugin_route(PLUGIN_ID, "alerts/resolve", _resolve_alert)
    register_plugin_route(PLUGIN_ID, "audit", _get_audit)
    register_plugin_route(PLUGIN_ID, "schedule", _get_schedule)
    register_plugin_route(PLUGIN_ID, "scrub/bulk", _bulk_start_scrub)
    register_plugin_route(PLUGIN_ID, "compare", _compare_clusters)
    register_plugin_route(PLUGIN_ID, "thresholds", _thresholds_handler)
    register_plugin_route(PLUGIN_ID, "report", _get_report)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s registered", PLUGIN_ID)
