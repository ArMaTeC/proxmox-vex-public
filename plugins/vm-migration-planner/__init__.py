# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-migration-planner/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: VM Migration Planner - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""VM Migration Planner - full UI management backend."""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugin_data_bridge import get_clusters, get_nodes, get_vms
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "vm-migration-planner"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_PATH = PLUGIN_DIR / "state.json"

CPU_WARN = 0.75
MEM_WARN_PCT = 0.20


def _now():
    return datetime.now(timezone.utc)


def _ensure_data_files():
    if not STATE_PATH.exists():
        STATE_PATH.write_text(json.dumps({"jobs": [], "settings": _default_settings(), "version": "1.1.0"}, indent=2))


def _default_settings():
    return {
        "policy": "balance_cpu",
        "excluded_nodes": [],
        "pinned_vms": [],
        "auto_hibernate_after": False,
    }


def _load_state():
    try:
        return json.loads(STATE_PATH.read_text())
    except Exception:
        return {"jobs": [], "settings": _default_settings(), "version": "1.1.0"}


def _save_state(data):
    data["version"] = "1.1.0"
    data["updated_at"] = _now().isoformat()
    STATE_PATH.write_text(json.dumps(data, indent=2))


def _get_status():
    state = _load_state()
    running = [j for j in state.get("jobs", []) if j.get("status") == "running"]
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "version": "1.1.0",
        "jobs_count": len(state.get("jobs", [])),
        "running_count": len(running),
    }


def _manager_or_error(cluster_id):
    if not cluster_id:
        return None, (jsonify({"error": "cluster_id is required"}), 400)
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return None, err
    manager = get_connected_manager(cluster_id)
    if manager is None:
        return None, (jsonify({"error": "cluster not connected"}), 503)
    return manager, None


def _get_clusters():
    try:
        return {
            "data": [{"id": c.get("id"), "display_name": c.get("name")} for c in get_clusters().get("clusters", [])]
        }
    except Exception as e:
        log.error(safe_error(e, "cluster list failed"))
    return {"data": []}


def _get_nodes():
    cluster_id = request.args.get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    nodes = get_nodes(cluster_id).get("nodes", [])

    try:
        data = manager.api_request("GET", "/cluster/resources?type=node") or []
    except Exception as e:
        log.error(safe_error(e, "node list failed"))
        data = []
    if not data:
        data = []
    for n in data:
        node = n.get("node") or n.get("id") or "node"
        maxmem = n.get("maxmem", 1) or 1
        mem = n.get("mem", 0) or 0
        mem_free = maxmem - mem
        maxcpu = n.get("maxcpu", 1) or 1
        cpu = n.get("cpu", 0) or 0
        mem_pct = 1.0 - (mem_free / maxmem)
        nodes.append({
            "node": node,
            "cpu_load": round(cpu, 3),
            "cpu_capacity": maxcpu,
            "cpu_pct": round(cpu / maxcpu, 3),
            "mem_free_mb": mem_free // (1024 * 1024),
            "mem_total_mb": maxmem // (1024 * 1024),
            "mem_pct": round(mem_pct, 3),
            "high_cpu": cpu / maxcpu > CPU_WARN,
            "low_mem": mem_pct > (1.0 - MEM_WARN_PCT),
        })
    return {"cluster_id": cluster_id, "nodes": nodes}


def _get_vms():
    cluster_id = request.args.get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        data = manager.api_request("GET", "/cluster/resources?type=vm") or []
    except Exception as e:
        log.error(safe_error(e, "vm list failed"))
        data = []
    if not data:
        data = []
    vms = get_vms(cluster_id).get("vms", [])

    for vm in data:
        vms.append({
            "vmid": vm.get("vmid"),
            "name": vm.get("name") or f"vm-{vm.get('vmid')}",
            "node": vm.get("node") or vm.get("host") or "unknown",
            "cpu": vm.get("cpu", 0),
            "maxcpu": vm.get("maxcpu", 1),
            "mem_mb": (vm.get("mem", 0) or 0) // (1024 * 1024),
            "maxmem_mb": (vm.get("maxmem", 0) or 1) // (1024 * 1024),
        })
    return {"cluster_id": cluster_id, "vms": vms}


def _post_plan():
    data = request.get_json(silent=True) or {}
    cluster_id = data.get("cluster_id")
    vmid = data.get("vmid")
    target_override = data.get("target")
    if not all([cluster_id, vmid]):
        return jsonify({"error": "cluster_id and vmid are required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    vms = _cluster_vms(manager)
    nodes = _cluster_nodes(manager)
    vm = next((v for v in vms if str(v.get("vmid")) == str(vmid)), None)
    if not vm:
        return jsonify({"error": "vm not found"}), 404
    source = vm.get("node") or "unknown"
    if target_override:
        target = target_override
        reason = "user-selected target"
    else:
        target, reason = _recommend_target(nodes, source, vm)
    feasible = _is_feasible(nodes, target, vm)
    mem_mb = (vm.get("mem", 0) or 0) // (1024 * 1024)
    estimate = max(1, int(mem_mb / 1024))
    return {
        "cluster_id": cluster_id,
        "vmid": vmid,
        "source": source,
        "recommended_target": target,
        "reason": reason,
        "feasible": feasible,
        "downtime_seconds": 0 if data.get("live", True) else estimate,
        "estimated_minutes": estimate,
    }


def _cluster_nodes(manager):
    try:
        data = manager.api_request("GET", "/cluster/resources?type=node") or []
    except Exception as e:
        log.error(safe_error(e, "node list failed"))
        data = []
    if not data:
        data = []
    return data


def _cluster_vms(manager):
    try:
        data = manager.api_request("GET", "/cluster/resources?type=vm") or []
    except Exception as e:
        log.error(safe_error(e, "vm list failed"))
        data = []
    if not data:
        data = []
    return data


def _recommend_target(nodes, source, vm):
    candidates = [n for n in nodes if n.get("node") and n.get("node") != source]
    if not candidates:
        return source, "no alternative nodes available"
    vm_mem = vm.get("mem", 0)
    for n in candidates:
        n["free"] = (n.get("maxmem", 1) - n.get("mem", 0)) - vm_mem
    best = max(candidates, key=lambda n: n.get("free", 0))
    return best.get("node"), "least-loaded alternative node"


def _is_feasible(nodes, target, vm):
    node = next((n for n in nodes if n.get("node") == target), None)
    if not node:
        return False
    free = (node.get("maxmem", 0) or 0) - (node.get("mem", 0) or 0)
    return free >= (vm.get("mem", 0) or 0)


def _post_dry_run():
    data = request.get_json(silent=True) or {}
    plans = data.get("plans", [])
    if not plans:
        return jsonify({"error": "plans list is required"}), 400
    results = []
    for p in plans:
        p["feasible"] = True
        results.append({
            "vmid": p.get("vmid"),
            "source": p.get("source"),
            "target": p.get("target"),
            "feasible": p.get("feasible", True),
            "reason": p.get("reason", "dry-run"),
        })
    return {"simulated": len(results), "plans": results}


def _get_recommendations():
    cluster_id = request.args.get("cluster_id")
    policy = request.args.get("policy", "balance_cpu")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    vms = _cluster_vms(manager)
    nodes = _cluster_nodes(manager)
    settings = _load_state().get("settings", _default_settings())
    excluded = set(settings.get("excluded_nodes", []))
    pinned = set(settings.get("pinned_vms", []))
    recommendations = []
    for vm in vms:
        if str(vm.get("vmid")) in pinned:
            continue
        source = vm.get("node") or "unknown"
        candidates = [n for n in nodes if n.get("node") != source and n.get("node") not in excluded]
        if not candidates:
            continue
        if policy == "balance_cpu":
            best = min(candidates, key=lambda n: n.get("cpu", 0))
        else:
            best = max(candidates, key=lambda n: n.get("maxmem", 1) - n.get("mem", 0))
        recommendations.append({
            "vmid": vm.get("vmid"),
            "name": vm.get("name") or f"vm-{vm.get('vmid')}",
            "source": source,
            "target": best.get("node"),
            "reason": f"{policy} rebalance",
        })
    return {"cluster_id": cluster_id, "policy": policy, "recommendations": recommendations}


def _post_execute():
    data = request.get_json(silent=True) or {}
    plans = data.get("plans", [])
    if not plans:
        return jsonify({"error": "plans list is required"}), 400
    cluster_id = data.get("cluster_id")
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    state = _load_state()
    job_id = f"mig-{uuid.uuid4().hex[:8]}"
    now = _now().isoformat()
    job = {
        "job_id": job_id,
        "cluster_id": cluster_id,
        "plans": plans,
        "status": "running",
        "started_at": now,
        "finished_at": None,
        "message": "Migration job started",
    }
    state.setdefault("jobs", []).append(job)
    _save_state(state)
    return {"job_id": job_id, "status": "running"}


def _get_history():
    state = _load_state()
    jobs = state.get("jobs", [])[::-1]
    total = len(jobs)
    return {"data": jobs, "total": total}


def _get_history_detail():
    job_id = request.args.get("job_id") or (request.get_json(silent=True) or {}).get("job_id")
    state = _load_state()
    job = next((j for j in state.get("jobs", []) if j.get("job_id") == job_id), None)
    if not job:
        return jsonify({"error": "job not found"}), 404
    return job


def _post_cancel():
    job_id = (request.get_json(silent=True) or {}).get("job_id")
    state = _load_state()
    job = next((j for j in state.get("jobs", []) if j.get("job_id") == job_id), None)
    if not job:
        return jsonify({"error": "job not found"}), 404
    if job.get("status") == "running":
        job["status"] = "cancelled"
        job["finished_at"] = _now().isoformat()
        job["message"] = "Cancelled by user"
        _save_state(state)
    return job


def _post_retry():
    job_id = (request.get_json(silent=True) or {}).get("job_id")
    state = _load_state()
    job = next((j for j in state.get("jobs", []) if j.get("job_id") == job_id), None)
    if not job:
        return jsonify({"error": "job not found"}), 404
    if job.get("status") == "failed":
        job["status"] = "running"
        job["started_at"] = _now().isoformat()
        job["finished_at"] = None
        job["message"] = "Retrying migration"
        _save_state(state)
    return job


def _get_settings():
    state = _load_state()
    return {"settings": state.get("settings", _default_settings())}


def _post_settings():
    data = request.get_json(silent=True) or {}
    state = _load_state()
    settings = state.get("settings", _default_settings())
    for k, v in data.items():
        if k in settings:
            settings[k] = v
    state["settings"] = settings
    _save_state(state)
    return {"settings": settings, "saved": True}


def _get_export():
    state = _load_state()
    return jsonify({"jobs": state.get("jobs", []), "settings": state.get("settings", _default_settings())})


def _post_import():
    data = request.get_json(silent=True) or {}
    if "jobs" not in data and "settings" not in data:
        return jsonify({"error": "invalid import payload"}), 400
    state = _load_state()
    if "settings" in data:
        state["settings"] = data["settings"]
    if "jobs" in data:
        state["jobs"] = data["jobs"]
    _save_state(state)
    return {"imported": True}


def _settings():
    if request.method == "POST":
        return _post_settings()
    return _get_settings()


def _get_ui():
    _ensure_data_files()
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    _ensure_data_files()
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "nodes", _get_nodes)
    register_plugin_route(PLUGIN_ID, "vms", _get_vms)
    register_plugin_route(PLUGIN_ID, "plan", _post_plan)
    register_plugin_route(PLUGIN_ID, "dry-run", _post_dry_run)
    register_plugin_route(PLUGIN_ID, "recommendations", _get_recommendations)
    register_plugin_route(PLUGIN_ID, "execute", _post_execute)
    register_plugin_route(PLUGIN_ID, "history", _get_history)
    register_plugin_route(PLUGIN_ID, "history-detail", _get_history_detail)
    register_plugin_route(PLUGIN_ID, "cancel", _post_cancel)
    register_plugin_route(PLUGIN_ID, "retry", _post_retry)
    register_plugin_route(PLUGIN_ID, "settings", _settings)
    register_plugin_route(PLUGIN_ID, "export", _get_export)
    register_plugin_route(PLUGIN_ID, "import", _post_import)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info(f"[PLUGINS] {PLUGIN_ID} registered")
