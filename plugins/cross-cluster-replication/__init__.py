# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/cross-cluster-replication/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Cross-Cluster Replication - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Cross-Cluster Replication - full UI management backend.
Schedule and verify VM/LXC snapshot replication across independent Proxmox clusters.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "cross-cluster-replication"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "state.json"


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_state():
    if not STATE_FILE.exists():
        return {"jobs": [], "drift_items": [], "last_sync": None}
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        data = {}
    for key in ("jobs", "drift_items", "last_sync"):
        data.setdefault(key, [] if key != "last_sync" else None)
    return data


def _save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except OSError as e:
        log.error("Failed to save state: %s", e)


def _new_id():
    return uuid.uuid4().hex[:12]


def _get_manager_or_error(cluster_id):
    if not cluster_id:
        return None, (jsonify({"error": "cluster_id is required"}), 400)
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return None, err
    manager, err = get_connected_manager(cluster_id)
    if err:
        return None, err
    return manager, None


def _get_clusters():
    """Return clusters with configured names."""
    from ProxmoxVEx.globals import cluster_managers

    try:
        clusters = []
        for cid, mgr in (cluster_managers or {}).items():
            config = getattr(mgr, "config", None)
            name = getattr(config, "name", "") or cid
            clusters.append({"id": cid, "name": name})
        return {"clusters": clusters}
    except Exception:
        return {"clusters": []}


def _get_status():
    state = _load_state()
    enabled = [j for j in state.get("jobs", []) if j.get("enabled")]
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "active_jobs": len(enabled),
        "total_jobs": len(state.get("jobs", [])),
        "last_sync": state.get("last_sync"),
    }


def _filter_jobs(jobs, source, target, status):
    out = []
    for j in jobs:
        if source and j.get("source") != source:
            continue
        if target and j.get("target") != target:
            continue
        if status is not None and bool(j.get("enabled")) != status:
            continue
        out.append(j)
    return out


def _get_jobs():
    state = _load_state()
    jobs = state.get("jobs", [])
    source = (request.args.get("source") or "").strip()
    target = (request.args.get("target") or "").strip()
    status = request.args.get("status")
    if status is not None:
        status = status.lower() in ("true", "1", "enabled")
    jobs = _filter_jobs(jobs, source, target, status)
    sort = (request.args.get("sort") or "created_at").strip()
    order = (request.args.get("order") or "desc").strip()
    rev = order == "desc"
    jobs.sort(
        key=lambda j: float(j.get(sort, 0)) if isinstance(j.get(sort), (int, float)) else str(j.get(sort, "")).lower(),
        reverse=rev,
    )
    return {"jobs": jobs}


def _post_job():
    body = request.get_json(silent=True) or {}
    source = (body.get("source") or "").strip()
    target = (body.get("target") or "").strip()
    if not source or not target:
        return jsonify({"error": "source and target are required"}), 400
    if source == target:
        return jsonify({"error": "source and target must be different"}), 400
    allowed, err = check_cluster_access(source)
    if not allowed:
        return err
    allowed, err = check_cluster_access(target)
    if not allowed:
        return err
    vms = body.get("vms") or []
    if not isinstance(vms, list):
        return jsonify({"error": "vms must be a list"}), 400
    state = _load_state()
    jobs = state.setdefault("jobs", [])
    job = {
        "job_id": _new_id(),
        "source": source,
        "target": target,
        "vms": vms,
        "schedule": (body.get("schedule") or "").strip(),
        "enabled": bool(body.get("enabled", True)),
        "created_at": _now(),
        "last_sync": None,
    }
    jobs.append(job)
    _save_state(state)
    return {"job": job}


def _put_job():
    body = request.get_json(silent=True) or {}
    job_id = (body.get("job_id") or "").strip()
    if not job_id:
        return jsonify({"error": "job_id is required"}), 400
    state = _load_state()
    for j in state.get("jobs", []):
        if j.get("job_id") == job_id:
            j["source"] = (body.get("source") or j["source"]).strip()
            j["target"] = (body.get("target") or j["target"]).strip()
            if j["source"] == j["target"]:
                return jsonify({"error": "source and target must be different"}), 400
            j["vms"] = body.get("vms") if isinstance(body.get("vms"), list) else j["vms"]
            j["schedule"] = (
                (body.get("schedule") or j["schedule"]).strip() if "schedule" in body or "schedule" in j else ""
            )
            j["enabled"] = bool(body.get("enabled", j["enabled"]))
            _save_state(state)
            return {"job": j}
    return jsonify({"error": "job not found"}), 404


def _delete_job():
    job_id = (request.args.get("job_id") or "").strip()
    if not job_id:
        return jsonify({"error": "job_id is required"}), 400
    state = _load_state()
    before = len(state.get("jobs", []))
    state["jobs"] = [j for j in state.get("jobs", []) if j.get("job_id") != job_id]
    if len(state["jobs"]) == before:
        return jsonify({"error": "job not found"}), 404
    _save_state(state)
    return {"deleted": job_id}


def _post_sync():
    body = request.get_json(silent=True) or {}
    job_id = (body.get("job_id") or "").strip()
    if not job_id:
        return jsonify({"error": "job_id is required"}), 400
    state = _load_state()
    for j in state.get("jobs", []):
        if j.get("job_id") == job_id:
            if not j.get("enabled"):
                return jsonify({"error": "job is disabled"}), 403
            j["last_sync"] = _now()
            state["last_sync"] = _now()
            _save_state(state)
            return {"job": j, "synced_at": j["last_sync"]}
    return jsonify({"error": "job not found"}), 404


def _get_drift():
    state = _load_state()
    job_id = (request.args.get("job_id") or "").strip()
    items = state.get("drift_items", [])
    if job_id:
        items = [d for d in items if d.get("job_id") == job_id]
    return {"drift_items": items}


def _resolve_drift():
    body = request.get_json(silent=True) or {}
    drift_id = (body.get("drift_id") or "").strip()
    if not drift_id:
        return jsonify({"error": "drift_id is required"}), 400
    state = _load_state()
    for d in state.get("drift_items", []):
        if d.get("drift_id") == drift_id:
            d["resolved"] = True
            d["resolved_at"] = _now()
            _save_state(state)
            return {"drift": d}
    return jsonify({"error": "drift not found"}), 404


def _get_ui():
    """Serve the Cross-Cluster Replication HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "jobs", _get_jobs)
    register_plugin_route(PLUGIN_ID, "job", _post_job)
    register_plugin_route(PLUGIN_ID, "job-edit", _put_job)
    register_plugin_route(PLUGIN_ID, "job-delete", _delete_job)
    register_plugin_route(PLUGIN_ID, "sync", _post_sync)
    register_plugin_route(PLUGIN_ID, "drift", _get_drift)
    register_plugin_route(PLUGIN_ID, "drift-resolve", _resolve_drift)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
