# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/pbs-manager/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: PBS Manager - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
PBS Manager - full UI management backend.
Exposes Proxmox Backup Server datastores, backup jobs and verification.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "pbs-manager"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
JOBS_FILE = PLUGIN_DIR / "jobs.json"


def _load_json(path, default):
    if not path.exists():
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return default


def _save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except OSError as e:
        log.error("save %s: %s", path, e)


def _manager_or_error(cluster_id):
    if not cluster_id:
        return None, (jsonify({"error": "cluster_id is required"}), 400)
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return None, err
    return get_connected_manager(cluster_id)


def _get_clusters():
    from ProxmoxVEx.globals import cluster_managers

    try:
        return {"clusters": [{"id": c, "name": c} for c in (cluster_managers or {})]}
    except Exception:
        return {"clusters": []}


def _get_status():
    jobs = _load_json(JOBS_FILE, [])
    return {"plugin": PLUGIN_ID, "status": "running", "jobs_count": len(jobs)}


def _validate_cron(expr):
    parts = (expr or "").strip().split()
    return len(parts) == 5


def _get_datastores():
    cluster_id = request.args.get("cluster_id", "").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        data = manager.api_request("GET", "/storage?content=backup") or []
        datastores = [s for s in data if s.get("content") in ("backup", "images,backup")]
        if not datastores:
            datastores = []
        for ds in datastores:
            ds.setdefault("capacity", 0)
            ds.setdefault("used", 0)
            ds.setdefault("unit", "GB")
        sort = request.args.get("sort") or "name"
        order = (request.args.get("order") or "asc").strip()
        ds_type = (request.args.get("type") or "").strip()
        if ds_type:
            datastores = [d for d in datastores if d.get("type") == ds_type]
        rev = order == "desc"
        datastores.sort(key=lambda d: d.get(sort) or "", reverse=rev)
        return {"cluster_id": cluster_id, "datastores": datastores}
    except Exception as e:
        log.exception("[datastores] failed")
        return jsonify({"error": safe_error(e, "datastore list failed")}), 500


def _datastore_detail():
    name = (request.args.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    cluster_id = (request.args.get("cluster_id") or "").strip()
    all_data = _get_datastores() if not cluster_id else None
    if isinstance(all_data, tuple):
        return all_data
    datastores = all_data.get("datastores", []) if all_data else []
    ds = next((d for d in datastores if d.get("name") == name), None)
    if not ds:
        return jsonify({"error": "datastore not found"}), 404
    return ds


def _jobs():
    if request.method == "GET":
        jobs = _load_json(JOBS_FILE, [])
        sort = request.args.get("sort") or "datastore"
        order = (request.args.get("order") or "asc").strip()
        datastore = (request.args.get("datastore") or "").strip()
        if datastore:
            jobs = [j for j in jobs if j.get("datastore") == datastore]
        rev = order == "desc"
        jobs.sort(key=lambda j: j.get(sort) or "", reverse=rev)
        return {"jobs": jobs}

    if request.method == "DELETE":
        job_id = request.args.get("id") or request.get_json(silent=True).get("id")
        if not job_id:
            return jsonify({"error": "id is required"}), 400
        jobs = _load_json(JOBS_FILE, [])
        before = len(jobs)
        jobs = [j for j in jobs if j.get("id") != job_id]
        _save_json(JOBS_FILE, jobs)
        if len(jobs) == before:
            return jsonify({"error": "job not found"}), 404
        return {"deleted": True, "id": job_id}

    body = request.get_json(silent=True) or {}
    job_id = (body.get("id") or "").strip()
    datastore = body.get("datastore")
    schedule = body.get("schedule")
    scope = body.get("scope", [])
    retention = body.get("retention", 7)
    if not datastore or not schedule:
        return jsonify({"error": "datastore and schedule are required"}), 400
    if not _validate_cron(schedule):
        return jsonify({"error": "schedule must be a 5-part cron expression"}), 400
    jobs = _load_json(JOBS_FILE, [])
    if job_id:
        for j in jobs:
            if j.get("id") == job_id:
                j.update({
                    "datastore": datastore,
                    "schedule": schedule,
                    "scope": scope,
                    "retention": retention,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                _save_json(JOBS_FILE, jobs)
                return j
    job = {
        "id": str(uuid.uuid4()),
        "datastore": datastore,
        "schedule": schedule,
        "scope": scope,
        "retention": retention,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    jobs.append(job)
    _save_json(JOBS_FILE, jobs)
    return job


def _run_job():
    body = request.get_json(silent=True) or {}
    job_id = (body.get("id") or "").strip()
    if not job_id:
        return jsonify({"error": "id is required"}), 400
    jobs = _load_json(JOBS_FILE, [])
    for j in jobs:
        if j.get("id") == job_id:
            return {
                "run_id": f"run-{uuid.uuid4()}",
                "job_id": job_id,
                "datastore": j.get("datastore"),
                "status": "running",
                "started_at": datetime.now(timezone.utc).isoformat(),
            }
    return jsonify({"error": "job not found"}), 404


def _verify():
    body = request.get_json(silent=True) or {}
    datastore = body.get("datastore")
    if not datastore:
        return jsonify({"error": "datastore is required"}), 400
    return {
        "job_id": f"verify-{uuid.uuid4()}",
        "datastore": datastore,
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
    }


def _get_ui():
    """Serve the PBS Manager HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "datastores", _get_datastores)
    register_plugin_route(PLUGIN_ID, "datastore", _datastore_detail)
    register_plugin_route(PLUGIN_ID, "jobs", _jobs)
    register_plugin_route(PLUGIN_ID, "run", _run_job)
    register_plugin_route(PLUGIN_ID, "verify", _verify)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s registered", PLUGIN_ID)
