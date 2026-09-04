# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-bulk-deployer/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: vm-bulk-deployer — ProxmoxVEx Plugin
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
vm-bulk-deployer — ProxmoxVEx Plugin
Queue, monitor, and manage bulk VM deployments across Proxmox clusters.
"""

import csv
import io
import json
import logging
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Response, g, jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager
from ProxmoxVEx.api.plugin_data_bridge import get_clusters, get_vms
from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.globals import cluster_managers

PLUGIN_ID = "vm-bulk-deployer"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")

PLUGIN_DIR = Path(__file__).parent
JOBS_FILE = PLUGIN_DIR / "jobs.json"
TEMPLATES_FILE = PLUGIN_DIR / "templates.json"
AUDIT_FILE = PLUGIN_DIR / "audit.json"
_jobs_lock = threading.RLock()
_worker_started = False

MAX_COUNT = 100
RESERVED_PREFIXES = {"pve", "root", "admin", "localhost"}
INVALID_PREFIX_RE = re.compile(r"^[0-9\-]|[/\\<>:\"|?*\x00-\x1f]")


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


def _short_id():
    return f"vmb-{uuid.uuid4().hex[:8]}"


def _current_user():
    user = getattr(g, "current_user", None)
    if not user:
        user = getattr(request, "session", {}).get("user")
    return user or "unknown"


def _load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default


def _save_json(path, data):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except OSError as e:
        log.error("Failed to save %s: %s", path, e)


def _load_jobs():
    with _jobs_lock:
        data = _load_json(JOBS_FILE, {"version": "1", "updated_at": _now_iso(), "jobs": []})
        return data.get("jobs", [])


def _save_jobs(jobs):
    with _jobs_lock:
        _save_json(JOBS_FILE, {"version": "1", "updated_at": _now_iso(), "jobs": jobs})


def _load_templates():
    data = _load_json(TEMPLATES_FILE, {"version": "1", "updated_at": _now_iso(), "templates": []})
    return data.get("templates", [])


def _save_templates(templates):
    _save_json(TEMPLATES_FILE, {"version": "1", "updated_at": _now_iso(), "templates": templates})


def _load_audit():
    data = _load_json(AUDIT_FILE, {"version": "1", "updated_at": _now_iso(), "entries": []})
    return data.get("entries", [])


def _save_audit(entries):
    _save_json(AUDIT_FILE, {"version": "1", "updated_at": _now_iso(), "entries": entries})


def _audit(action, target_id=None, before=None, after=None):
    entries = _load_audit()
    entries.insert(
        0,
        {
            "id": _new_id(),
            "actor": _current_user(),
            "action": action,
            "target_id": target_id,
            "timestamp": _now_iso(),
            "before": before,
            "after": after,
        },
    )
    _save_audit(entries[:5000])


def _normalize_tags(tags):
    if not tags:
        return []
    if isinstance(tags, str):
        return [t.strip() for t in tags.split(",") if t.strip()]
    return [str(t).strip() for t in tags if str(t).strip()]


def _validate_count(count):
    try:
        count = int(count)
    except (TypeError, ValueError):
        return 0, "count must be an integer"
    if not 1 <= count <= MAX_COUNT:
        return 0, f"count must be between 1 and {MAX_COUNT}"
    return count, None


def _validate_prefix(prefix):
    if not prefix or not str(prefix).strip():
        return None, "naming_prefix is required"
    prefix = str(prefix).strip().lower()
    if prefix in RESERVED_PREFIXES:
        return None, f"naming_prefix '{prefix}' is reserved"
    if INVALID_PREFIX_RE.search(prefix):
        return None, "naming_prefix contains invalid characters or starts with a number"
    return prefix, None


def _expand_pattern(pattern, prefix, index):
    pattern = (pattern or "{prefix}-{index}").strip()
    if "{prefix}" not in pattern or "{index}" not in pattern:
        pattern = "{prefix}-{index}"
    index_str = str(index)
    return pattern.replace("{prefix}", prefix).replace("{index}", index_str)


def _generate_names(prefix, count, pattern=None, start=1):
    names = []
    for i in range(start, start + count):
        names.append(_expand_pattern(pattern, prefix, i))
    return names


def _get_cluster_sources(cluster_id, manager=None):
    """Return VM/template sources from the cluster manager or a fallback sample."""
    if manager is None:
        manager, _ = get_connected_manager(cluster_id)
    if manager is None:
        return []
    try:
        vms = manager.get_vms() or []
    except Exception:
        return []
    sources = []
    for v in vms:
        vmid = v.get("vmid")
        name = v.get("name", "")
        # Template detection: PVE marks templates with a 'template' field or name convention
        is_template = bool(v.get("template") or name.endswith("-template"))
        sources.append({
            "id": str(vmid),
            "cluster_id": cluster_id,
            "vmid": int(vmid) if str(vmid).isdigit() else 0,
            "name": name,
            "type": "template" if is_template else "vm",
            "node": v.get("node", ""),
            "storage": v.get("storage", ""),
        })
    return sources


def _get_source(cluster_id, source_id, manager=None):
    for s in _get_cluster_sources(cluster_id, manager):
        if str(s.get("id")) == str(source_id) or str(s.get("vmid")) == str(source_id):
            return s
    return None


def _get_cluster_nodes(cluster_id):
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        return []
    try:
        nodes = getattr(manager, "nodes", None) or []
        if nodes:
            return [{"id": n.get("node", n), "name": n.get("node", n), "status": n.get("status", "")} for n in nodes]
    except Exception:
        pass
    return []


def _get_cluster_storages(cluster_id):
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        return []
    try:
        storages = getattr(manager, "_cached_shared_storages", []) or []
        return [{"id": s.get("storage", s), "name": s.get("storage", s), "type": s.get("type", "")} for s in storages]
    except Exception:
        return []


def _get_cluster_networks(cluster_id):
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        return []
    try:
        nets = getattr(manager, "_networks", None) or []
        return [{"id": n.get("iface", n), "name": n.get("iface", n), "type": n.get("type", "")} for n in nets]
    except Exception:
        return []


def _validate_source(cluster_id, source, manager=None):
    if not source:
        return None, "source is required"
    src = _get_source(cluster_id, source, manager)
    if not src:
        return None, "source VM/template not found in this cluster"
    return src, None


def _validate_unique_names(cluster_id, prefix, count, pattern=None, exclude_job_id=None):
    """Return error string if generated names already exist in cluster VMs, else None."""
    names = _generate_names(prefix, count, pattern)
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        return None  # cannot verify while offline; accept
    existing = {str(v.get("name", "")) for v in _get_cluster_sources(cluster_id, manager)}
    jobs = _load_jobs()
    for j in jobs:
        if j.get("job_id") == exclude_job_id:
            continue
        if j.get("cluster_id") != cluster_id:
            continue
        for vm in j.get("vms", []):
            existing.add(str(vm.get("name", "")))
    conflicts = [n for n in names if n in existing]
    if conflicts:
        return f"generated names already exist: {', '.join(conflicts[:3])}"
    return None


def _summary(job):
    return {
        "job_id": job.get("job_id"),
        "cluster_id": job.get("cluster_id"),
        "source": job.get("source"),
        "count": job.get("count"),
        "naming_prefix": job.get("naming_prefix"),
        "naming_pattern": job.get("naming_pattern"),
        "status": job.get("status"),
        "mode": job.get("mode"),
        "created": job.get("created"),
        "updated": job.get("updated"),
    }


def _build_vm_list(cluster_id, source, count, prefix, pattern=None, target_node=None, target_storage=None, start=1):
    names = _generate_names(prefix, count, pattern, start)
    vms = get_vms(cluster_id).get("vms", [])

    for i, name in enumerate(names, start=start):
        vms.append({
            "name": name,
            "node": target_node or "",
            "status": "pending",
            "progress": 0,
            "vmid": None,
            "error": None,
            "log": [],
            "index": i,
        })
    return vms


def _estimate_impact(source_summary, count):
    """Return rough impact based on source summary or zeroes if unknown."""
    try:
        cpu = float(source_summary.get("cpu", 0) or 0)
        mem = int(source_summary.get("memory", 0) or 0)
        disk = int(source_summary.get("disk", 0) or 0)
    except Exception:
        cpu = mem = disk = 0
    return {
        "total_cpu": round(cpu * count, 2),
        "total_memory": mem * count,
        "total_disk": disk * count,
    }


def _create_job(payload, dry_run=False):
    data = payload or {}
    cluster_id = (str(data.get("cluster_id", ""))).strip()
    if not cluster_id:
        return None, (jsonify({"error": "cluster_id is required"}), 400)

    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return None, err

    source = (str(data.get("source", ""))).strip()
    src, err = _validate_source(cluster_id, source)
    if err:
        return None, (jsonify({"error": err}), 400)

    count, err = _validate_count(data.get("count"))
    if err:
        return None, (jsonify({"error": err}), 400)

    prefix, err = _validate_prefix(data.get("naming_prefix"))
    if err:
        return None, (jsonify({"error": err}), 400)

    naming_pattern = (str(data.get("naming_pattern", ""))).strip() or "{prefix}-{index}"
    unique_err = _validate_unique_names(cluster_id, prefix, count, naming_pattern)
    if unique_err:
        return None, (jsonify({"error": unique_err}), 400)

    target_node = (str(data.get("target_node", ""))).strip()
    target_storage = (str(data.get("target_storage", ""))).strip()
    mode = (str(data.get("mode", "sequential"))).strip()
    if mode not in ("sequential", "parallel"):
        mode = "sequential"
    try:
        start_delay = int(data.get("start_delay", 0) or 0)
    except (TypeError, ValueError):
        start_delay = 0
    on_completion = (str(data.get("on_completion", ""))).strip()
    tags = _normalize_tags(data.get("tags"))

    source_summary = {
        "id": src["id"],
        "name": src.get("name"),
        "type": src.get("type"),
        "vmid": src.get("vmid"),
        "node": src.get("node"),
    }

    vms = _build_vm_list(
        cluster_id,
        source_summary,
        count,
        prefix,
        naming_pattern,
        target_node=target_node,
        target_storage=target_storage,
    )

    if dry_run:
        return {
            "would_create": [v["name"] for v in vms],
            "count": count,
            "source": source_summary,
            "impact": _estimate_impact(src, count),
        }, None

    job = {
        "job_id": _short_id(),
        "cluster_id": cluster_id,
        "source": source_summary,
        "count": count,
        "naming_prefix": prefix,
        "naming_pattern": naming_pattern,
        "status": "queued",
        "mode": mode,
        "start_delay": start_delay,
        "tags": tags,
        "target_node": target_node,
        "target_storage": target_storage,
        "on_completion": on_completion,
        "created": _now_iso(),
        "updated": _now_iso(),
        "vms": vms,
    }
    return job, None


def _get_status():
    jobs = _load_jobs()
    templates = _load_templates()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "version": "1.0.0",
        "jobs_count": len(jobs),
        "templates_count": len(templates),
    }


def _get_clusters():
    clusters = get_clusters().get("clusters", [])

    for cluster_id in sorted(cluster_managers.keys()):
        allowed, _ = check_cluster_access(cluster_id)
        if not allowed:
            continue
        mgr = cluster_managers[cluster_id]
        clusters.append({
            "id": cluster_id,
            "name": getattr(mgr.config, "name", cluster_id),
            "display_name": getattr(mgr.config, "name", cluster_id),
            "reachable": mgr.is_connected,
            "connected": mgr.is_connected,
            "node": getattr(mgr, "host", "") or "",
        })
    return {"data": clusters}


def _get_sources():
    cluster_id = request.args.get("cluster_id") or (request.get_json(silent=True) or {}).get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    manager, err = get_connected_manager(cluster_id)
    if err:
        return err
    return {"data": _get_cluster_sources(cluster_id, manager)}


def _get_source_detail():
    cluster_id = request.args.get("cluster_id") or (request.get_json(silent=True) or {}).get("cluster_id")
    vmid = request.args.get("vmid") or (request.get_json(silent=True) or {}).get("vmid")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    if not vmid:
        return jsonify({"error": "vmid is required"}), 400
    src = _get_source(cluster_id, vmid)
    if not src:
        return jsonify({"error": "Source not found"}), 404
    return {"data": src}


def _get_nodes():
    cluster_id = request.args.get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    return {"data": _get_cluster_nodes(cluster_id)}


def _get_storages():
    cluster_id = request.args.get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    return {"data": _get_cluster_storages(cluster_id)}


def _get_networks():
    cluster_id = request.args.get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    return {"data": _get_cluster_networks(cluster_id)}


def _deploy():
    job, err = _create_job(request.get_json(silent=True) or {})
    if err:
        return err
    jobs = _load_jobs()
    jobs.insert(0, job)
    _save_jobs(jobs)
    _audit("deploy", target_id=job["job_id"], after=_summary(job))
    return {"job": _summary(job)}


def _dry_run():
    result, err = _create_job(request.get_json(silent=True) or {}, dry_run=True)
    if err:
        return err
    return result


def _jobs_handler():
    method = request.method
    if method == "GET":
        return _list_jobs()
    if method == "POST":
        return _create_job(request.get_json(silent=True) or {})
    if method == "PUT":
        return _update_job()
    if method == "DELETE":
        return _delete_job()
    return jsonify({"error": "Method not allowed"}), 405


def _list_jobs():
    params = request.args
    jobs = _load_jobs()
    status = (params.get("status") or "").strip().lower()
    source = (params.get("source") or "").strip().lower()
    cluster_id = (params.get("cluster_id") or "").strip()

    filtered = jobs
    if status:
        filtered = [j for j in filtered if j.get("status") == status]
    if source:
        filtered = [j for j in filtered if source in (j.get("source") or {}).get("name", "").lower()]
    if cluster_id:
        filtered = [j for j in filtered if j.get("cluster_id") == cluster_id]

    sort = (params.get("sort") or "created").lower()
    order = (params.get("order") or "desc").lower()
    reverse = order == "desc"

    if sort == "status":
        filtered = sorted(filtered, key=lambda j: j.get("status", ""), reverse=reverse)
    elif sort == "source":
        filtered = sorted(filtered, key=lambda j: (j.get("source") or {}).get("name", "").lower(), reverse=reverse)
    else:
        filtered = sorted(filtered, key=lambda j: j.get("created", ""), reverse=reverse)

    total = len(filtered)
    try:
        page = max(1, int(params.get("page", 1)))
        per_page = max(1, min(100, int(params.get("per_page", 25))))
    except (TypeError, ValueError):
        page = 1
        per_page = 25
    start = (page - 1) * per_page
    paginated = filtered[start : start + per_page]

    return {"data": [_summary(j) for j in paginated], "total": total, "page": page, "per_page": per_page}


def _get_job_by_id(job_id):
    jobs = _load_jobs()
    for j in jobs:
        if j.get("job_id") == job_id:
            return j, jobs
    return None, jobs


def _get_job():
    job_id = request.args.get("id") or request.args.get("job_id")
    if not job_id:
        return jsonify({"error": "job_id is required"}), 400
    job, _ = _get_job_by_id(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return {"data": job}


def _update_job():
    body = request.get_json(silent=True) or {}
    job_id = request.args.get("id") or body.get("job_id")
    if not job_id:
        return jsonify({"error": "job_id is required"}), 400
    job, jobs = _get_job_by_id(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    for field in ["status", "vms", "updated"]:
        if field in body:
            job[field] = body[field]
    if "vms" in body:
        job["updated"] = _now_iso()
    _save_jobs(jobs)
    _audit("update", target_id=job_id, after=_summary(job))
    return {"data": _summary(job)}


def _delete_job():
    job_id = request.args.get("id") or (request.get_json(silent=True) or {}).get("job_id")
    if not job_id:
        return jsonify({"error": "job_id is required"}), 400
    job, jobs = _get_job_by_id(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job.get("status") in ("queued", "running"):
        return jsonify({"error": "Cannot delete an active job"}), 409
    jobs = [j for j in jobs if j.get("job_id") != job_id]
    _save_jobs(jobs)
    _audit("delete", target_id=job_id, before=_summary(job))
    return {"deleted": job_id}


def _cancel_job():
    body = request.get_json(silent=True) or {}
    job_id = request.args.get("id") or body.get("job_id")
    if not job_id:
        return jsonify({"error": "job_id is required"}), 400
    job, jobs = _get_job_by_id(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job.get("status") not in ("queued", "running"):
        return jsonify({"error": "Job is not queued or running"}), 409
    job["status"] = "cancelled"
    job["updated"] = _now_iso()
    for vm in job.get("vms", []):
        if vm.get("status") in ("pending", "creating", "starting"):
            vm["status"] = "skipped"
    _save_jobs(jobs)
    _audit("cancel", target_id=job_id, after=_summary(job))
    return {"job": _summary(job)}


def _retry_job():
    body = request.get_json(silent=True) or {}
    job_id = request.args.get("id") or body.get("job_id")
    if not job_id:
        return jsonify({"error": "job_id is required"}), 400
    job, jobs = _get_job_by_id(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    vm_names = body.get("vms") or []
    failed = [vm for vm in job.get("vms", []) if vm.get("status") == "failed"]
    if vm_names:
        failed = [vm for vm in failed if vm.get("name") in vm_names]
    if not failed:
        return jsonify({"error": "No failed VMs to retry"}), 400
    for vm in failed:
        vm["status"] = "pending"
        vm["progress"] = 0
        vm["error"] = None
        vm["log"] = []
    job["status"] = "queued"
    job["updated"] = _now_iso()
    _save_jobs(jobs)
    _audit("retry", target_id=job_id, after=_summary(job))
    return {"job": _summary(job)}


def _duplicate_job():
    body = request.get_json(silent=True) or {}
    job_id = request.args.get("id") or body.get("job_id")
    if not job_id:
        return jsonify({"error": "job_id is required"}), 400
    job, jobs = _get_job_by_id(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    new_job = dict(job)
    new_job["job_id"] = _short_id()
    new_job["status"] = "queued"
    new_job["created"] = _now_iso()
    new_job["updated"] = _now_iso()
    # strip per-VM state so the duplicate starts fresh
    new_job["vms"] = _build_vm_list(
        new_job.get("cluster_id", ""),
        new_job.get("source", {}),
        new_job.get("count", 1),
        new_job.get("naming_prefix", "bulk-"),
        new_job.get("naming_pattern"),
    )
    jobs.insert(0, new_job)
    _save_jobs(jobs)
    _audit("duplicate", target_id=new_job["job_id"], after=_summary(new_job))
    return {"job": _summary(new_job)}


def _clone_job():
    body = request.get_json(silent=True) or {}
    job_id = request.args.get("id") or body.get("job_id")
    new_prefix = (str(body.get("naming_prefix", ""))).strip()
    if not job_id:
        return jsonify({"error": "job_id is required"}), 400
    job, jobs = _get_job_by_id(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if not new_prefix:
        new_prefix = f"clone-{job.get('naming_prefix', 'bulk-')}"
    prefix, err = _validate_prefix(new_prefix)
    if err:
        return jsonify({"error": err}), 400
    new_job = dict(job)
    new_job["job_id"] = _short_id()
    new_job["naming_prefix"] = prefix
    new_job["status"] = "queued"
    new_job["created"] = _now_iso()
    new_job["updated"] = _now_iso()
    new_job["vms"] = _build_vm_list(
        new_job.get("cluster_id", ""),
        new_job.get("source", {}),
        new_job.get("count", 1),
        prefix,
        new_job.get("naming_pattern"),
    )
    jobs.insert(0, new_job)
    _save_jobs(jobs)
    _audit("clone", target_id=new_job["job_id"], after=_summary(new_job))
    return {"job": _summary(new_job)}


def _bulk_delete_jobs():
    body = request.get_json(silent=True) or {}
    ids = body.get("ids") or []
    if not isinstance(ids, list) or not ids:
        return jsonify({"error": "ids must be a non-empty list"}), 400
    jobs = _load_jobs()
    by_id = {j.get("job_id"): j for j in jobs}
    deleted = []
    failed = {}
    for job_id in ids:
        j = by_id.get(job_id)
        if not j:
            failed[job_id] = "not found"
            continue
        if j.get("status") in ("queued", "running"):
            failed[job_id] = "active job cannot be deleted"
            continue
        jobs = [x for x in jobs if x.get("job_id") != job_id]
        deleted.append(job_id)
        _audit("delete", target_id=job_id, before=_summary(j))
    _save_jobs(jobs)
    return {"deleted": deleted, "failed": failed}


def _clear_completed_jobs():
    jobs = _load_jobs()
    kept = [j for j in jobs if j.get("status") not in ("completed", "failed", "cancelled")]
    removed = [j.get("job_id") for j in jobs if j.get("status") in ("completed", "failed", "cancelled")]
    _save_jobs(kept)
    for job_id in removed:
        _audit("clear", target_id=job_id)
    return {"cleared": removed}


def _export_jobs():
    fmt = (request.args.get("format") or "json").lower()
    jobs = _load_jobs()
    if fmt == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["job_id", "cluster_id", "source", "count", "prefix", "status", "created"])
        for j in jobs:
            src = j.get("source") or {}
            writer.writerow([
                j.get("job_id"),
                j.get("cluster_id"),
                src.get("name", ""),
                j.get("count"),
                j.get("naming_prefix"),
                j.get("status"),
                j.get("created"),
            ])
        return Response(
            output.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=vm-bulk-deployer-jobs.csv"},
        )
    return Response(
        json.dumps({"jobs": jobs}, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=vm-bulk-deployer-jobs.json"},
    )


def _dashboard():
    jobs = _load_jobs()
    return {
        "queued": sum(1 for j in jobs if j.get("status") == "queued"),
        "running": sum(1 for j in jobs if j.get("status") == "running"),
        "completed": sum(1 for j in jobs if j.get("status") == "completed"),
        "failed": sum(1 for j in jobs if j.get("status") == "failed"),
    }


def _templates_handler():
    method = request.method
    if method == "GET":
        return _list_templates()
    if method == "POST":
        return _create_template()
    return jsonify({"error": "Method not allowed"}), 405


def _list_templates():
    templates = _load_templates()
    template_id = request.args.get("id")
    if template_id:
        for t in templates:
            if t.get("template_id") == template_id:
                return {"data": t}
        return jsonify({"error": "Template not found"}), 404
    return {"data": templates}


def _create_template():
    body = request.get_json(silent=True) or {}
    name = (str(body.get("name", ""))).strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    templates = _load_templates()
    if any(t.get("name") == name for t in templates):
        return jsonify({"error": "Template name already exists"}), 400
    cluster_id = (str(body.get("cluster_id", ""))).strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    src, err = _validate_source(cluster_id, body.get("source"))
    if err:
        return jsonify({"error": err}), 400
    count, err = _validate_count(body.get("count"))
    if err:
        return jsonify({"error": err}), 400
    prefix, err = _validate_prefix(body.get("naming_prefix"))
    if err:
        return jsonify({"error": err}), 400
    template = {
        "template_id": _short_id(),
        "name": name,
        "cluster_id": cluster_id,
        "source": {
            "id": src["id"],
            "name": src.get("name"),
            "type": src.get("type"),
            "vmid": src.get("vmid"),
            "node": src.get("node"),
        },
        "count": count,
        "naming_prefix": prefix,
        "naming_pattern": (str(body.get("naming_pattern", ""))).strip() or "{prefix}-{index}",
        "mode": (str(body.get("mode", "sequential"))).strip(),
        "start_delay": int(body.get("start_delay", 0) or 0),
        "tags": _normalize_tags(body.get("tags")),
        "target_node": (str(body.get("target_node", ""))).strip(),
        "target_storage": (str(body.get("target_storage", ""))).strip(),
        "on_completion": (str(body.get("on_completion", ""))).strip(),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    templates.append(template)
    _save_templates(templates)
    _audit("template.create", target_id=template["template_id"], after=template)
    return {"data": template}


def _update_template():
    body = request.get_json(silent=True) or {}
    template_id = request.args.get("id") or body.get("template_id")
    if not template_id:
        return jsonify({"error": "template_id is required"}), 400
    templates = _load_templates()
    for _idx, t in enumerate(templates):
        if t.get("template_id") == template_id:
            # Validate unique name if changing
            new_name = (str(body.get("name", t.get("name")))).strip()
            if new_name != t.get("name") and any(x.get("name") == new_name for x in templates if x is not t):
                return jsonify({"error": "Template name already exists"}), 400
            t["name"] = new_name
            for field in [
                "cluster_id",
                "count",
                "naming_prefix",
                "naming_pattern",
                "mode",
                "start_delay",
                "tags",
                "target_node",
                "target_storage",
                "on_completion",
            ]:
                if field in body:
                    t[field] = body[field]
            t["source"] = body.get("source", t.get("source"))
            t["updated_at"] = _now_iso()
            _save_templates(templates)
            _audit("template.update", target_id=template_id, after=t)
            return {"data": t}
    return jsonify({"error": "Template not found"}), 404


def _delete_template():
    body = request.get_json(silent=True) or {}
    template_id = request.args.get("id") or body.get("template_id")
    if not template_id:
        return jsonify({"error": "template_id is required"}), 400
    templates = _load_templates()
    for _idx, t in enumerate(templates):
        if t.get("template_id") == template_id:
            del templates[_idx]
            _save_templates(templates)
            _audit("template.delete", target_id=template_id, before=t)
            return {"deleted": template_id}
    return jsonify({"error": "Template not found"}), 404


def _audit_handler():
    method = request.method
    if method == "GET":
        params = request.args
        action = (params.get("action") or "").strip()
        target_id = (params.get("target_id") or "").strip()
        entries = _load_audit()
        if action:
            entries = [e for e in entries if e.get("action") == action]
        if target_id:
            entries = [e for e in entries if e.get("target_id") == target_id]
        return {"data": entries[:1000]}
    if method == "POST":
        body = request.get_json(silent=True) or {}
        _audit(
            body.get("action", "custom"),
            target_id=body.get("target_id"),
            before=body.get("before"),
            after=body.get("after"),
        )
        return {"ok": True}
    return jsonify({"error": "Method not allowed"}), 405


def _resolve_source_node(manager, source_vmid):
    try:
        for v in manager.get_vms() or []:
            if str(v.get("vmid")) == str(source_vmid):
                return v.get("node")
    except Exception:
        pass
    return None


def _process_vm(job, vm, jobs):
    manager, _ = get_connected_manager(job.get("cluster_id"))
    if not manager:
        vm["status"] = "failed"
        vm["error"] = "cluster not connected"
        return

    source = job.get("source") or {}
    source_vmid = source.get("vmid")
    if not source_vmid:
        vm["status"] = "failed"
        vm["error"] = "source not configured"
        return

    source_vmid = int(source_vmid)
    source_node = source.get("node") or _resolve_source_node(manager, source_vmid)
    if not source_node:
        vm["status"] = "failed"
        vm["error"] = "source VM not found"
        return

    if not vm.get("vmid"):
        next_id = manager.get_next_vmid()
        if not next_id or not next_id.get("success"):
            vm["status"] = "failed"
            vm["error"] = next_id.get("error") if next_id else "could not get next VMID"
            return
        vm["vmid"] = next_id.get("vmid")

    target_vmid = int(vm.get("vmid"))
    target_node = job.get("target_node") or source_node
    target_storage = job.get("target_storage")
    vm["status"] = "running"
    _save_jobs(jobs)

    result = manager.clone_vm(
        node=source_node,
        vmid=source_vmid,
        vm_type="qemu",
        newid=target_vmid,
        name=vm.get("name"),
        full=True,
        target_node=target_node,
        target_storage=target_storage,
    )
    if not result or not result.get("success"):
        vm["status"] = "failed"
        vm["error"] = str(result.get("error") if result else "clone failed")
        return

    upid = result.get("data")
    if isinstance(upid, str):
        if manager._wait_for_task(source_node, upid, timeout=300):
            vm["status"] = "completed"
        else:
            vm["status"] = "failed"
            vm["error"] = "clone task did not complete"
    else:
        vm["status"] = "completed"


def _process_job(job, jobs):
    if job.get("status") != "queued":
        return
    manager, _ = get_connected_manager(job.get("cluster_id"))
    if not manager:
        job["status"] = "failed"
        job["error"] = "cluster not connected"
        _save_jobs(jobs)
        return

    job["status"] = "running"
    job["started"] = _now_iso()
    _save_jobs(jobs)

    any_failed = False
    for vm in job.get("vms", []):
        if job.get("status") == "cancelled":
            break
        if vm.get("status") != "pending":
            continue
        _process_vm(job, vm, jobs)
        _save_jobs(jobs)
        if vm.get("status") == "failed":
            any_failed = True

    job["status"] = "completed" if not any_failed else "failed"
    job["finished"] = _now_iso()
    _save_jobs(jobs)


def _run_queued_jobs():
    with _jobs_lock:
        jobs = _load_jobs()
        for job in list(jobs):
            if job.get("status") == "queued":
                _process_job(job, jobs)


def _job_worker():
    while True:
        try:
            _run_queued_jobs()
        except Exception:
            log.exception("[%s] worker error", PLUGIN_ID)
        try:
            time.sleep(5)
        except Exception:
            break


def start_background_tasks(app=None):
    global _worker_started
    with _jobs_lock:
        if _worker_started:
            return
        _worker_started = True
    t = threading.Thread(target=_job_worker, daemon=True, name=f"{PLUGIN_ID}-worker")
    t.start()
    log.info("[%s] background worker started", PLUGIN_ID)


def _get_ui():
    """Serve the VM Bulk Deployer HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def _history():
    """Return job history, same as jobs list without pagination for export-style views."""
    return _list_jobs()


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "sources", _get_sources)
    register_plugin_route(PLUGIN_ID, "sources/detail", _get_source_detail)
    register_plugin_route(PLUGIN_ID, "nodes", _get_nodes)
    register_plugin_route(PLUGIN_ID, "storages", _get_storages)
    register_plugin_route(PLUGIN_ID, "networks", _get_networks)
    register_plugin_route(PLUGIN_ID, "deploy", _deploy)
    register_plugin_route(PLUGIN_ID, "dry-run", _dry_run)
    register_plugin_route(PLUGIN_ID, "jobs", _jobs_handler)
    register_plugin_route(PLUGIN_ID, "jobs/detail", _get_job)
    register_plugin_route(PLUGIN_ID, "jobs/cancel", _cancel_job)
    register_plugin_route(PLUGIN_ID, "jobs/retry", _retry_job)
    register_plugin_route(PLUGIN_ID, "jobs/duplicate", _duplicate_job)
    register_plugin_route(PLUGIN_ID, "jobs/clone", _clone_job)
    register_plugin_route(PLUGIN_ID, "jobs/bulk-delete", _bulk_delete_jobs)
    register_plugin_route(PLUGIN_ID, "jobs/clear-completed", _clear_completed_jobs)
    register_plugin_route(PLUGIN_ID, "jobs/export", _export_jobs)
    register_plugin_route(PLUGIN_ID, "dashboard", _dashboard)
    register_plugin_route(PLUGIN_ID, "templates", _templates_handler)
    register_plugin_route(PLUGIN_ID, "templates/detail", _list_templates)
    register_plugin_route(PLUGIN_ID, "templates/update", _update_template)
    register_plugin_route(PLUGIN_ID, "templates/delete", _delete_template)
    register_plugin_route(PLUGIN_ID, "audit", _audit_handler)
    register_plugin_route(PLUGIN_ID, "history", _history)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    start_background_tasks()
    log.info("[PLUGINS] %s registered", PLUGIN_ID)
