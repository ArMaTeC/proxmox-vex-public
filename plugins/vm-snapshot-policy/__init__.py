# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-snapshot-policy/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: VM Snapshot Policy - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""VM Snapshot Policy - full UI management backend."""

import json
import logging
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugin_data_bridge import get_clusters, get_vms
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "vm-snapshot-policy"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
DATA_PATH = PLUGIN_DIR / "policies.json"
STATE_PATH = PLUGIN_DIR / "state.json"
_state_lock = threading.RLock()
_worker_started = False

CRON_RE = re.compile(r"^[\d\-*/, ]+$")


def _now():
    return datetime.now(timezone.utc)


def _ensure_data_files():
    if not DATA_PATH.exists():
        DATA_PATH.write_text("[]")
    if not STATE_PATH.exists():
        STATE_PATH.write_text(json.dumps({"assignments": [], "history": [], "version": "1.1.0"}, indent=2))


def _load():
    try:
        return json.loads(DATA_PATH.read_text())
    except Exception:
        return []


def _save(items):
    DATA_PATH.write_text(json.dumps(items, indent=2))


def _load_state():
    try:
        return json.loads(STATE_PATH.read_text())
    except Exception:
        return {"assignments": [], "history": [], "version": "1.1.0"}


def _save_state(data):
    data["version"] = "1.1.0"
    data["updated_at"] = _now().isoformat()
    STATE_PATH.write_text(json.dumps(data, indent=2))


def _get_status():
    state = _load_state()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "version": "1.1.0",
        "policy_count": len(_load()),
        "assignment_count": len(state.get("assignments", [])),
        "history_count": len(state.get("history", [])),
    }


def _get_manager(cluster_id):
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
    try:
        return {
            "data": [{"id": c.get("id"), "display_name": c.get("name")} for c in get_clusters().get("clusters", [])]
        }
    except Exception as e:
        log.error(safe_error(e, "cluster list failed"))
    return {"data": []}


def _get_vms():
    cluster_id = request.args.get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    # Pull live VM list from the shared bridge instead of a hard-coded fallback.
    result = get_vms(cluster_id)
    if "error" in result:
        return jsonify({"error": result["error"]}), 503
    data = result.get("vms", [])
    return {
        "data": [
            {"vmid": v.get("vmid"), "name": v.get("name") or f"vm-{v.get('vmid')}", "node": v.get("node", "")}
            for v in data
        ]
    }


def _is_valid_cron(expr):
    if not expr:
        return False
    parts = expr.split()
    if len(parts) != 5:
        return False
    return all(CRON_RE.match(part) for part in parts)


def _policies():
    if request.method == "GET":
        return {"policies": _load()}
    data = request.get_json(silent=True) or {}
    if request.method == "POST":
        pid = data.get("id")
        if not pid:
            return jsonify({"error": "id is required"}), 400
        if data.get("schedule") and not _is_valid_cron(data.get("schedule")):
            return jsonify({"error": "invalid cron expression"}), 400
        try:
            retention = int(data.get("retention", 1))
        except (TypeError, ValueError):
            return jsonify({"error": "retention must be a positive integer"}), 400
        if retention < 1:
            return jsonify({"error": "retention must be a positive integer"}), 400
        policies = _load()
        existing = next((p for p in policies if p.get("id") == pid), None)
        entry = {
            "id": pid,
            "schedule": data.get("schedule", ""),
            "retention": retention,
            "description": data.get("description", ""),
            "enabled": data.get("enabled", True),
            "human_schedule": f"Cron: {data.get('schedule', 'manual')}",
        }
        if existing:
            existing.update(entry)
        else:
            policies.append(entry)
        _save(policies)
        return {"policy": entry, "saved": True}
    if request.method == "DELETE":
        pid = data.get("id") or request.args.get("id")
        if not pid:
            return jsonify({"error": "id is required"}), 400
        state = _load_state()
        assigned = [a for a in state.get("assignments", []) if a.get("policy_id") == pid]
        policies = _load()
        policies = [p for p in policies if p.get("id") != pid]
        _save(policies)
        return {
            "deleted": pid,
            "count": len(policies),
            "warnings": [f"policy was assigned to {len(assigned)} VM(s)"] if assigned else [],
        }
    return jsonify({"error": "Method not allowed"}), 405


def _apply():
    data = request.get_json(silent=True) or {}
    cluster_id = data.get("cluster_id")
    vmid = data.get("vmid")
    policy_id = data.get("policy_id")
    if not all([cluster_id, vmid, policy_id]):
        return jsonify({"error": "cluster_id, vmid and policy_id are required"}), 400
    manager, err = _get_manager(cluster_id)
    if err:
        return err
    policy = next((p for p in _load() if p.get("id") == policy_id), None)
    if not policy:
        return jsonify({"error": "policy not found"}), 404
    state = _load_state()
    state.setdefault("assignments", []).append({
        "assignment_id": f"asn-{uuid.uuid4().hex[:8]}",
        "cluster_id": cluster_id,
        "vmid": vmid,
        "policy_id": policy_id,
        "created_at": _now().isoformat(),
    })
    snap = {
        "history_id": f"hst-{uuid.uuid4().hex[:8]}",
        "cluster_id": cluster_id,
        "vmid": vmid,
        "policy_id": policy_id,
        "snapname": f"snap-{policy_id}-{int(time.time())}",
        "description": policy.get("description", "policy snapshot"),
        "status": "queued",
        "started_at": _now().isoformat(),
    }
    state.setdefault("history", []).append(snap)
    _save_state(state)
    return {"planned": snap}


def _get_assignments():
    state = _load_state()
    return {"data": state.get("assignments", [])}


def _delete_assignment():
    aid = (request.get_json(silent=True) or {}).get("assignment_id")
    if not aid:
        return jsonify({"error": "assignment_id is required"}), 400
    state = _load_state()
    state["assignments"] = [a for a in state.get("assignments", []) if a.get("assignment_id") != aid]
    _save_state(state)
    return {"deleted": aid}


def _get_history():
    state = _load_state()
    return {"data": state.get("history", [])[::-1]}


def _find_vm(manager, vmid):
    try:
        for v in manager.get_vms() or []:
            if str(v.get("vmid")) == str(vmid):
                return v
    except Exception:
        pass
    return None


def _process_snapshot(snap, state):
    manager, conn_err = get_connected_manager(snap.get("cluster_id"))
    if not manager:
        snap["status"] = "failed"
        snap["error"] = str(conn_err) if conn_err else "cluster not connected"
        snap["finished"] = _now().isoformat()
        return

    vm = _find_vm(manager, snap.get("vmid"))
    if not vm:
        snap["status"] = "failed"
        snap["error"] = "VM not found in cluster"
        snap["finished"] = _now().isoformat()
        return

    snap["status"] = "running"
    snap["started"] = _now().isoformat()
    result = manager.create_snapshot(
        node=vm.get("node"),
        vmid=snap.get("vmid"),
        vm_type=vm.get("type", "qemu"),
        snapname=snap.get("snapname"),
        description=snap.get("description", ""),
    )

    if not result or not result.get("success"):
        snap["status"] = "failed"
        snap["error"] = str(result.get("error") if result else "snapshot failed")
        snap["finished"] = _now().isoformat()
        return

    task = result.get("task")
    if isinstance(task, str):
        if manager._wait_for_task(vm.get("node"), task, timeout=300):
            snap["status"] = "completed"
        else:
            snap["status"] = "failed"
            snap["error"] = "snapshot task did not complete"
    else:
        snap["status"] = "completed"
    snap["finished"] = _now().isoformat()


def _run_queued_snapshots():
    with _state_lock:
        state = _load_state()
        changed = False
        for snap in list(state.get("history", [])):
            if snap.get("status") == "queued":
                _process_snapshot(snap, state)
                changed = True
        if changed:
            _save_state(state)


def _snapshot_worker():
    while True:
        try:
            _run_queued_snapshots()
        except Exception:
            log.exception("[%s] worker error", PLUGIN_ID)
        try:
            time.sleep(5)
        except Exception:
            break


def start_background_tasks(app=None):
    global _worker_started
    with _state_lock:
        if _worker_started:
            return
        _worker_started = True
    t = threading.Thread(target=_snapshot_worker, daemon=True, name=f"{PLUGIN_ID}-worker")
    t.start()
    log.info("[%s] background worker started", PLUGIN_ID)


def _get_ui():
    _ensure_data_files()
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    _ensure_data_files()
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "vms", _get_vms)
    register_plugin_route(PLUGIN_ID, "policies", _policies)
    register_plugin_route(PLUGIN_ID, "apply", _apply)
    register_plugin_route(PLUGIN_ID, "assignments", _get_assignments)
    register_plugin_route(PLUGIN_ID, "unassign", _delete_assignment)
    register_plugin_route(PLUGIN_ID, "history", _get_history)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    start_background_tasks()
    log.info(f"[PLUGINS] {PLUGIN_ID} registered")
