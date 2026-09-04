# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/rolling-update-orchestrator/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Rolling Update Orchestrator - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Rolling Update Orchestrator - full UI management backend.
Cordon, evacuate, update, and reboot PVE nodes in a cluster with automatic rollback checks.
"""

import contextlib
import json
import logging
import queue
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Response, jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "rolling-update-orchestrator"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "state.json"

# Per-plan SSE feed queues — keyed by plan_id.
_plan_feeds = {}
_plan_feeds_lock = threading.Lock()
# Serialize state file read/writes to avoid half-written JSON while the executor runs.
_state_lock = threading.Lock()


def _load_state():
    if not STATE_FILE.exists():
        return {"orchestrator_status": "idle", "plans": []}
    with _state_lock:
        try:
            with open(STATE_FILE, encoding="utf-8") as f:
                data = json.load(f)
                if not isinstance(data, dict):
                    return {"orchestrator_status": "idle", "plans": []}
                return data
        except (json.JSONDecodeError, OSError) as e:
            log.warning("Failed to load state: %s", e)
            return {"orchestrator_status": "idle", "plans": []}


def _save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with _state_lock:
        try:
            with open(STATE_FILE, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2)
        except OSError as e:
            log.error("Failed to save state: %s", e)


def _new_id():
    return uuid.uuid4().hex[:12]


def _get_clusters():
    from ProxmoxVEx.globals import cluster_managers

    try:
        return {"clusters": [{"id": c, "name": c} for c in (cluster_managers or {})]}
    except Exception:
        return {"clusters": []}


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


def _start_plan_feed(plan_id):
    with _plan_feeds_lock:
        if plan_id not in _plan_feeds:
            _plan_feeds[plan_id] = queue.Queue(maxsize=100)
        return _plan_feeds[plan_id]


def _close_plan_feed(plan_id):
    with _plan_feeds_lock:
        q = _plan_feeds.pop(plan_id, None)
    if q:
        with contextlib.suppress(queue.Full):
            q.put_nowait(None)


def _emit_plan_event(plan_id, plan=None):
    if plan is None:
        state = _load_state()
        for p in state.get("plans", []):
            if p.get("plan_id") == plan_id:
                plan = p
                break
    if not plan:
        return
    q = _start_plan_feed(plan_id)
    try:
        q.put_nowait({"type": "plan", "plan": plan})
    except queue.Full:
        log.warning("Plan feed queue full for %s; dropping event", plan_id)


def _plan_feed_generator(plan_id):
    q = _start_plan_feed(plan_id)
    state = _load_state()
    for p in state.get("plans", []):
        if p.get("plan_id") == plan_id:
            yield f"data: {json.dumps({'type': 'plan', 'plan': p})}\n\n"
            if p.get("status") in ("completed", "aborted", "failed"):
                _close_plan_feed(plan_id)
                return
            break
    else:
        # Plan not found; nothing to stream.
        return
    while True:
        try:
            item = q.get(timeout=15)
        except queue.Empty:
            # Send a keep-alive comment so browsers do not drop the connection.
            yield ":\n\n"
            continue
        if item is None:
            break
        if item.get("type") == "plan":
            yield f"data: {json.dumps(item)}\n\n"
            if item.get("plan", {}).get("status") in ("completed", "aborted", "failed"):
                break


def _feed():
    plan_id = (request.args.get("plan_id") or "").strip()
    if not plan_id:
        return jsonify({"error": "plan_id is required"}), 400
    state = _load_state()
    for p in state.get("plans", []):
        if p.get("plan_id") == plan_id:
            return Response(
                _plan_feed_generator(plan_id),
                mimetype="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
    return jsonify({"error": "plan not found"}), 404


def _get_status():
    state = _load_state()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "orchestrator_status": state.get("orchestrator_status", "idle"),
        "plans_count": len(state.get("plans", [])),
    }


def _get_plans():
    state = _load_state()
    plans = state.get("plans", [])
    sort = request.args.get("sort") or "created_at"
    order = (request.args.get("order") or "desc").strip()
    status_filter = (request.args.get("status") or "").strip()
    search = (request.args.get("q") or "").strip().lower()
    if status_filter:
        plans = [p for p in plans if (p.get("status") or "created") == status_filter]
    if search:
        plans = [
            p
            for p in plans
            if search in (p.get("plan_id") or "").lower() or search in (p.get("cluster_id") or "").lower()
        ]
    plans.sort(key=lambda p: p.get(sort) or "", reverse=(order == "desc"))
    return {"plans": plans}


def _post_plan():
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    manager, err = _get_manager_or_error(cluster_id)
    if err:
        return err
    state = _load_state()
    steps = body.get("steps") or ["cordon", "evacuate", "update", "reboot"]
    template = body.get("template", "")
    vm_sequence = body.get("vm_sequence") or []
    if not isinstance(steps, list) or not all(isinstance(s, str) for s in steps):
        return jsonify({"error": "steps must be a list of strings"}), 400
    if not isinstance(vm_sequence, list) or not all(isinstance(v, dict) and v.get("vmid") for v in vm_sequence):
        return jsonify({"error": "vm_sequence must be a list of objects with vmid"}), 400
    plan = {
        "plan_id": _new_id(),
        "cluster_id": cluster_id,
        "host": manager.host,
        "steps": steps,
        "vm_sequence": vm_sequence,
        "template": template,
        "status": "created",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "step_progress": [{"step": s, "state": "pending", "ts": datetime.now(timezone.utc).isoformat()} for s in steps],
        "current_step": None,
        "current_vm": None,
        "logs": [],
    }
    state.setdefault("plans", []).append(plan)
    _save_state(state)
    return {"plan": plan}


_MAINTENANCE_TIMEOUT = 900
_UPDATE_TIMEOUT = 3600


def _update_plan(plan_id, mutator):
    state = _load_state()
    for p in state.get("plans", []):
        if p.get("plan_id") == plan_id:
            mutator(p)
            _save_state(state)
            _emit_plan_event(plan_id, p)
            return p
    return None


def _append_plan_log(plan_id, message):
    def _m(p):
        p.setdefault("logs", []).append(f"{datetime.now(timezone.utc).isoformat()} - {message}")

    _update_plan(plan_id, _m)


def _set_step_in_progress(plan, step):
    for sp in plan.get("step_progress", []):
        if sp.get("step") == step:
            sp["state"] = "in_progress"
            sp["ts"] = datetime.now(timezone.utc).isoformat()
            continue
        if sp.get("state") not in ("completed", "failed"):
            sp["state"] = "pending"
            sp["ts"] = datetime.now(timezone.utc).isoformat()
    plan["current_step"] = step


def _set_step_completed(plan, step):
    for sp in plan.get("step_progress", []):
        if sp.get("step") == step:
            sp["state"] = "completed"
            sp["ts"] = datetime.now(timezone.utc).isoformat()


def _fail_plan(plan_id, error):
    def _m(p):
        p["status"] = "failed"
        p["error"] = error
        p.setdefault("logs", []).append(f"{datetime.now(timezone.utc).isoformat()} - ERROR: {error}")

    _update_plan(plan_id, _m)
    _close_plan_feed(plan_id)


def _complete_plan(plan_id, message="Plan completed"):
    def _m(p):
        p["status"] = "completed"
        p.setdefault("logs", []).append(f"{datetime.now(timezone.utc).isoformat()} - {message}")

    _update_plan(plan_id, _m)
    _close_plan_feed(plan_id)


def _wait_maintenance_task(task, plan_id, node):
    deadline = time.time() + _MAINTENANCE_TIMEOUT
    last = ""
    while time.time() < deadline:
        if task.status == "completed":
            _append_plan_log(
                plan_id,
                f"{node} evacuation completed: {task.migrated_vms}/{task.total_vms} VMs migrated",
            )
            return
        if task.status == "completed_with_errors":
            _append_plan_log(
                plan_id,
                f"{node} evacuation completed with errors: {task.migrated_vms}/{task.total_vms} migrated; note: {task.note or 'none'}",
            )
            return
        if task.status == "failed":
            raise Exception(f"{node} evacuation failed: {task.error or task.note or 'unknown'}")
        report = f"{node} evacuating: {task.migrated_vms}/{task.total_vms} VMs migrated"
        if task.note and task.note != last:
            report = f"{report} — {task.note}"
        if report != last:
            _append_plan_log(plan_id, report)
            last = report
        time.sleep(5)
    raise Exception(f"{node} evacuation timed out after {_MAINTENANCE_TIMEOUT}s")


def _wait_update_task(task, plan_id, node):
    deadline = time.time() + _UPDATE_TIMEOUT
    seen = 0
    while time.time() < deadline:
        for line in task.output_lines[seen:]:
            text = line.get("text")
            if text:
                _append_plan_log(plan_id, f"[{node}] {text}")
            seen += 1
        if task.status == "completed":
            _append_plan_log(plan_id, f"{node} update completed")
            return
        if task.status == "failed":
            raise Exception(f"{node} update failed: {task.error or 'unknown error'}")
        time.sleep(3)
    raise Exception(f"{node} update timed out after {_UPDATE_TIMEOUT}s")


def _run_node_step(manager, plan_id, node, step):
    if step == "cordon":
        _append_plan_log(plan_id, f"{node} cordoned")
        time.sleep(1)
        return
    if step == "evacuate":
        _append_plan_log(plan_id, f"Entering maintenance / evacuating {node}")
        maint = manager.enter_maintenance_mode(node, skip_evacuation=False)
        _wait_maintenance_task(maint, plan_id, node)
        return
    if step == "update":
        force = node not in manager.nodes_in_maintenance
        if force:
            _append_plan_log(plan_id, f"{node} not in maintenance; forcing update")
        _append_plan_log(plan_id, f"Starting package update on {node}")
        task = manager.start_node_update(node, reboot=False, force=force)
        if not task:
            raise Exception(f"Could not start update on {node}")
        _wait_update_task(task, plan_id, node)
        return
    if step == "reboot":
        force = node not in manager.nodes_in_maintenance
        _append_plan_log(plan_id, f"Rebooting {node}")
        task = manager.start_node_update(node, reboot=True, force=force)
        if not task:
            raise Exception(f"Could not start reboot on {node}")
        _wait_update_task(task, plan_id, node)
        _append_plan_log(plan_id, f"Exiting maintenance mode on {node}")
        manager.exit_maintenance_mode(node)
        return
    _append_plan_log(plan_id, f"Unknown step '{step}' for {node}; skipping")


def _execute_plan(plan_id):
    state = _load_state()
    plan = next((p for p in state.get("plans", []) if p.get("plan_id") == plan_id), None)
    if not plan or plan.get("status") != "running":
        return
    cluster_id = plan.get("cluster_id")
    manager, err = get_connected_manager(cluster_id)
    if err or not manager:
        error_text = err[0].get("error") if isinstance(err, (tuple, list)) and err else "Cluster not available"
        _fail_plan(plan_id, f"Cluster {cluster_id} is not available: {error_text}")
        return
    vms = plan.get("vm_sequence", [])
    if not vms:
        _fail_plan(plan_id, "No VMs in plan")
        return
    seen = set()
    node_vms = []
    for vm in vms:
        node = (vm or {}).get("node")
        if node and node not in seen:
            seen.add(node)
            node_vms.append((node, vm))
    if not node_vms:
        _fail_plan(plan_id, "No nodes to update")
        return
    steps = plan.get("steps", [])

    def _start_step(step):
        def _m(p):
            _set_step_in_progress(p, step)
            p.setdefault("logs", []).append(
                f"{datetime.now(timezone.utc).isoformat()} - Starting step '{step}' on {len(node_vms)} node(s)"
            )
            p["current_step"] = step
            p["current_vm"] = node_vms[0][1]

        _update_plan(plan_id, _m)

    def _start_node(step, node, vm):
        def _m(p):
            p["current_step"] = step
            p["current_vm"] = vm
            p.setdefault("logs", []).append(f"{datetime.now(timezone.utc).isoformat()} - {step}: processing {node}")

        _update_plan(plan_id, _m)

    def _finish_step(step):
        def _m(p):
            _set_step_completed(p, step)
            p.setdefault("logs", []).append(f"{datetime.now(timezone.utc).isoformat()} - Step '{step}' completed")

        _update_plan(plan_id, _m)

    for step in steps:
        _start_step(step)
        for node, vm in node_vms:
            _start_node(step, node, vm)
            try:
                _run_node_step(manager, plan_id, node, step)
            except Exception as e:
                _fail_plan(plan_id, f"{node} step '{step}' failed: {e}")
                return
        _finish_step(step)
    _complete_plan(plan_id)


def _post_start():
    body = request.get_json(silent=True) or {}
    plan_id = (body.get("plan_id") or "").strip()
    if not plan_id:
        return jsonify({"error": "plan_id is required"}), 400
    state = _load_state()
    for p in state.get("plans", []):
        if p.get("plan_id") == plan_id:
            if p.get("status") in ("running", "completed"):
                return jsonify({"error": f"Plan already {p.get('status')}"}), 409
            p["status"] = "running"
            p["started_at"] = datetime.now(timezone.utc).isoformat()
            p["step_progress"] = [
                {"step": s, "state": "pending", "ts": datetime.now(timezone.utc).isoformat()}
                for s in p.get("steps", [])
            ]
            # Initialise live feedback fields so the UI can show the first target immediately.
            p["current_step"] = p["steps"][0] if p.get("steps") else None
            p["current_vm"] = p["vm_sequence"][0] if p.get("vm_sequence") else None
            p["logs"] = [f"{datetime.now(timezone.utc).isoformat()} - Plan started"]
            if p["step_progress"]:
                p["step_progress"][0]["state"] = "in_progress"
            _save_state(state)
            _emit_plan_event(plan_id, p)
            threading.Thread(target=_execute_plan, args=(plan_id,), daemon=True).start()
            return {"plan": p}
    return jsonify({"error": "plan not found"}), 404


def _post_step():
    body = request.get_json(silent=True) or {}
    plan_id = (body.get("plan_id") or "").strip()
    step = (body.get("step") or "").strip()
    step_state = (body.get("step_state") or "").strip()
    vm = body.get("vm")  # optional current VM object for live feedback
    message = (body.get("message") or "").strip()
    if not plan_id or not step or not step_state:
        return jsonify({"error": "plan_id, step, and step_state are required"}), 400
    state = _load_state()
    for p in state.get("plans", []):
        if p.get("plan_id") == plan_id:
            for sp in p.get("step_progress", []):
                if sp.get("step") == step:
                    sp["state"] = step_state
                    sp["ts"] = datetime.now(timezone.utc).isoformat()
                    p["current_step"] = step
                    if isinstance(vm, dict) and vm.get("vmid"):
                        p["current_vm"] = vm
                    if message:
                        p.setdefault("logs", []).append(f"{datetime.now(timezone.utc).isoformat()} - {message}")
                    if step_state == "failed":
                        p["status"] = "failed"
                        p["error"] = message or f"Step {step} failed"
                    elif step_state == "completed" and p.get("steps") and step == p["steps"][-1]:
                        p["status"] = "completed"
                        p.setdefault("logs", []).append(f"{datetime.now(timezone.utc).isoformat()} - Plan completed")
                    _save_state(state)
                    _emit_plan_event(plan_id, p)
                    if p.get("status") in ("failed", "completed"):
                        _close_plan_feed(plan_id)
                    return {"plan": p}
    return jsonify({"error": "plan or step not found"}), 404


def _post_abort():
    body = request.get_json(silent=True) or {}
    plan_id = (body.get("plan_id") or "").strip()
    if not plan_id:
        return jsonify({"error": "plan_id is required"}), 400
    state = _load_state()
    for p in state.get("plans", []):
        if p.get("plan_id") == plan_id:
            p["status"] = "aborted"
            p["aborted_at"] = datetime.now(timezone.utc).isoformat()
            _save_state(state)
            _emit_plan_event(plan_id, p)
            _close_plan_feed(plan_id)
            return {"plan": p}
    return jsonify({"error": "plan not found"}), 404


def _get_vms():
    """List cluster VMs so the UI can build an ordered VM sequence."""
    cluster_id = (request.args.get("cluster_id") or "").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    manager, err = _get_manager_or_error(cluster_id)
    if err:
        return err
    try:
        vms = manager.get_vms() or []
    except Exception as e:
        log.warning("Failed to load VMs for cluster %s: %s", cluster_id, e)
        return jsonify({"vms": []})
    return {
        "vms": [
            {
                "vmid": v.get("vmid"),
                "name": v.get("name", "unnamed"),
                "node": v.get("node", ""),
                "type": v.get("type", ""),
                "status": v.get("status", ""),
            }
            for v in vms
            if v.get("vmid")
        ]
    }


def _get_ui():
    """Serve the Rolling Update Orchestrator HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "plans", _get_plans)
    register_plugin_route(PLUGIN_ID, "plan", _post_plan)
    register_plugin_route(PLUGIN_ID, "start", _post_start)
    register_plugin_route(PLUGIN_ID, "step", _post_step)
    register_plugin_route(PLUGIN_ID, "abort", _post_abort)
    register_plugin_route(PLUGIN_ID, "vms", _get_vms)
    register_plugin_route(PLUGIN_ID, "feed", _feed)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
