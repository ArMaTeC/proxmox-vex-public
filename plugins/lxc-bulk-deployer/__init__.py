# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/lxc-bulk-deployer/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: LXC Bulk Deployer - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
LXC Bulk Deployer - full UI management backend.
Queue, monitor, and manage bulk LXC container deployments from saved specs.
"""

import json
import logging
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "lxc-bulk-deployer"
PLUGIN_DIR = Path(__file__).parent
JOBS_PATH = PLUGIN_DIR / "jobs.json"
SPECS_PATH = PLUGIN_DIR / "specs.json"
_jobs_lock = threading.RLock()
_worker_started = False
log = logging.getLogger(f"plugin.{PLUGIN_ID}")


def _load(path, default=None):
    if default is None:
        default = []
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _save(path, items):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(items, indent=2), encoding="utf-8")


def _load_jobs():
    return _load(JOBS_PATH)


def _save_jobs(items):
    with _jobs_lock:
        _save(JOBS_PATH, items)


def _load_specs():
    return _load(SPECS_PATH)


def _save_specs(items):
    _save(SPECS_PATH, items)


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
    jobs = _load_jobs()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "jobs_count": len(jobs),
        "queued": len([j for j in jobs if j.get("status") == "queued"]),
        "running": len([j for j in jobs if j.get("status") == "running"]),
    }


def _validate_spec(body):
    count = body.get("count", 1)
    try:
        count = int(count)
    except (TypeError, ValueError):
        return {"error": "count must be an integer"}, 400
    if count < 1 or count > 100:
        return {"error": "count must be between 1 and 100"}, 400
    return None


def _deploy():
    data = request.get_json(silent=True) or {}
    source = (data.get("source") or "").strip()
    count = data.get("count", 1)
    prefix = (data.get("naming_prefix") or "lxc-").strip()
    start_index = data.get("start_index") or 1
    cluster_id = (data.get("cluster_id") or "").strip()
    if not source:
        return jsonify({"error": "source is required"}), 400
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    err = _validate_spec(data)
    if err:
        return err
    try:
        start_index = int(start_index)
    except (TypeError, ValueError):
        start_index = 1
    manager, err = get_connected_manager(cluster_id)
    if err:
        return err
    with _jobs_lock:
        jobs = _load_jobs()
        job = {
            "job_id": f"job-{uuid.uuid4().hex[:8]}",
            "cluster_id": cluster_id,
            "source": source,
            "count": int(count),
            "naming_prefix": prefix,
            "start_index": start_index,
            "container": True,
            "status": "queued",
            "created": datetime.now().isoformat(),
            "containers": [
                {"vmid": start_index + i, "name": f"{prefix}{start_index + i}", "status": "queued"}
                for i in range(int(count))
            ],
            "host": manager.host,
        }
        jobs.append(job)
        _save_jobs(jobs)
    return {"job": job}


def _jobs_list():
    jobs = _load_jobs()
    status = (request.args.get("status") or "").strip()
    sort = request.args.get("sort") or "created"
    order = (request.args.get("order") or "desc").strip()
    if status:
        jobs = [j for j in jobs if j.get("status") == status]
    rev = order == "desc"
    jobs.sort(key=lambda j: j.get(sort, j.get("created", "")), reverse=rev)
    return {"jobs": jobs}


def _job_action():
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    action = (data.get("action") or "").strip().lower()
    if not job_id or action not in ("cancel", "delete"):
        return jsonify({"error": "job_id and valid action (cancel/delete) required"}), 400
    with _jobs_lock:
        jobs = _load_jobs()
        for j in jobs:
            if j.get("job_id") == job_id:
                if action == "cancel":
                    if j.get("status") not in ("queued", "running"):
                        return jsonify({"error": "Job cannot be cancelled"}), 409
                    j["status"] = "cancelled"
                    for c in j.get("containers", []):
                        if c.get("status") == "queued":
                            c["status"] = "cancelled"
                    _save_jobs(jobs)
                    return {"job": j}
                if action == "delete":
                    jobs = [x for x in jobs if x.get("job_id") != job_id]
                    _save_jobs(jobs)
                    return {"deleted": job_id}
    return jsonify({"error": "Job not found"}), 404


def _specs_handler():
    method = request.method
    specs = _load_specs()
    if method == "GET":
        return {"data": specs}
    if method == "POST":
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        if not name:
            return jsonify({"error": "name is required"}), 400
        spec = {
            "id": str(uuid.uuid4()),
            "name": name,
            "source": (body.get("source") or "").strip(),
            "count": body.get("count", 1),
            "naming_prefix": (body.get("naming_prefix") or "lxc-").strip(),
            "start_index": body.get("start_index", 1),
            "memory": body.get("memory", 512),
            "cores": body.get("cores", 1),
        }
        specs.append(spec)
        _save_specs(specs)
        return {"data": spec}
    if method == "DELETE":
        spec_id = (request.args.get("id") or "").strip() or (request.get_json(silent=True) or {}).get("id")
        if not spec_id:
            return jsonify({"error": "id is required"}), 400
        specs = [s for s in specs if s.get("id") != spec_id]
        _save_specs(specs)
        return {"deleted": spec_id}
    return jsonify({"error": "Method not allowed"}), 405


def _get_ui():
    """Serve the LXC Bulk Deployer HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def _find_lxc_source(manager, source):
    """Locate the source LXC container by VMID in the cluster resources."""
    try:
        source_vmid = int(source)
    except (TypeError, ValueError):
        return None
    for v in manager.get_vms() or []:
        if v.get("type") == "lxc" and v.get("vmid") == source_vmid:
            return v
    return None


def _process_job(job, jobs):
    """Execute an LXC bulk deployment job by cloning the source into each target."""
    manager, _ = get_connected_manager(job.get("cluster_id"))
    if not manager:
        job["status"] = "failed"
        job.setdefault("errors", []).append("Cluster not connected")
        return

    source = _find_lxc_source(manager, job.get("source"))
    if not source:
        job["status"] = "failed"
        job.setdefault("errors", []).append("Source LXC not found in cluster")
        return

    source_node = source.get("node")
    job["status"] = "running"
    job["started"] = datetime.now().isoformat()
    _save_jobs(jobs)

    any_failed = False
    for c in job.get("containers", []):
        if job.get("status") == "cancelled":
            break
        c["status"] = "running"
        _save_jobs(jobs)
        result = manager.clone_vm(
            node=source_node,
            vmid=int(job["source"]),
            vm_type="lxc",
            newid=c["vmid"],
            name=c["name"],
            full=True,
            target_node=source_node,
        )
        if not result or not result.get("success"):
            c["status"] = "failed"
            c["error"] = str(result.get("error") if result else "clone failed")
            any_failed = True
        else:
            upid = result.get("data")
            if isinstance(upid, str):
                if manager._wait_for_task(source_node, upid, timeout=300):
                    c["status"] = "completed"
                else:
                    c["status"] = "failed"
                    c["error"] = "clone task did not complete"
                    any_failed = True
            else:
                c["status"] = "completed"
        _save_jobs(jobs)

    job["status"] = "completed" if not any_failed else "failed"
    job["finished"] = datetime.now().isoformat()
    _save_jobs(jobs)


def _run_queued_jobs():
    """Drain any queued LXC bulk deployment jobs from the jobs file."""
    with _jobs_lock:
        jobs = _load_jobs()
        for job in jobs:
            if job.get("status") != "queued":
                continue
            _process_job(job, jobs)


def _job_worker():
    """Background daemon that repeatedly polls and runs queued deployments."""
    while True:
        try:
            _run_queued_jobs()
        except Exception:
            log.exception("LXC bulk deployer worker error")
        try:
            time.sleep(5)
        except Exception:
            break


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "deploy", _deploy)
    register_plugin_route(PLUGIN_ID, "jobs", _jobs_list)
    register_plugin_route(PLUGIN_ID, "job", _job_action)
    register_plugin_route(PLUGIN_ID, "specs", _specs_handler)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    global _worker_started
    if not _worker_started:
        _worker_started = True
        t = threading.Thread(target=_job_worker, daemon=True, name="lxc-bulk-deployer-worker")
        t.start()
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
