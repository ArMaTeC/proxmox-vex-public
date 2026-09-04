# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/backup-verification-runner/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Backup Verification Runner - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Backup Verification Runner - full UI management backend.
Simulates backup restore verification and tracks re-verification schedules.
"""

import json
import logging
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugin_data_bridge import get_clusters, get_lxc, get_vms
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "backup-verification-runner"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
RESULTS_FILE = PLUGIN_DIR / "results.json"
SCHEDULES_FILE = PLUGIN_DIR / "schedules.json"

VALID_FREQUENCIES = ["daily", "weekly", "monthly"]


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
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        log.error("save %s: %s", path, e)


def _manager_or_error(cluster_id):
    if not cluster_id:
        return None, (jsonify({"error": "cluster_id is required"}), 400)
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return None, err
    return get_connected_manager(cluster_id)


def _get_clusters():
    try:
        return get_clusters()
    except Exception as e:
        log.warning("clusters failed: %s", e)
    return {"clusters": []}


def _get_vms():
    # Include both QEMU VMs and LXC containers so verification can target CTs too.
    cluster_id = (request.args.get("cluster_id") or "").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    try:
        qemu_vms = get_vms(cluster_id).get("vms", [])
        lxc_cts = get_lxc(cluster_id).get("lxc", [])
        for v in qemu_vms:
            v["type"] = "qemu"
        for c in lxc_cts:
            c["type"] = "lxc"
        return {"vms": qemu_vms + lxc_cts}
    except Exception as e:
        log.warning("vms failed: %s", e)
    return {"vms": []}


def _scan_node_backups(session, host, port, node, vmid, vm_type=None):
    """Return backup entries for vmid from one node's backup-capable storages."""
    backups = []
    storage_url = f"https://{host}:{port}/api2/json/nodes/{node}/storage"
    try:
        stor_resp = session.get(storage_url, timeout=5)
    except Exception:
        return backups
    if stor_resp.status_code != 200:
        return backups

    try:
        storages = stor_resp.json().get("data", [])
    except Exception:
        return backups

    for storage in storages:
        content = storage.get("content", "")
        if "backup" not in content:
            continue
        stor_name = storage.get("storage")
        if not stor_name:
            continue
        content_url = f"https://{host}:{port}/api2/json/nodes/{node}/storage/{stor_name}/content"
        try:
            content_resp = session.get(
                content_url,
                params={"content": "backup", "vmid": vmid},
                timeout=(5, 30),
            )
        except Exception:
            continue
        if content_resp.status_code != 200:
            continue
        try:
            items = content_resp.json().get("data", [])
        except Exception:
            continue
        for item in items:
            volid = item.get("volid", "")
            if not volid:
                continue
            filename = volid.split("/")[-1] if "/" in volid else volid.split(":")[-1]
            if (
                f"-{vmid}-" in filename
                or (vm_type and filename.startswith(f"vzdump-{vm_type[:4]}-{vmid}"))
                or f"/vm/{vmid}/" in volid
                or f"/ct/{vmid}/" in volid
            ):
                backups.append({
                    "volid": volid,
                    "filename": filename,
                    "storage": stor_name,
                    "size": item.get("size", 0),
                    "ctime": item.get("ctime", 0),
                    "format": item.get("format", "unknown"),
                    "notes": item.get("notes", ""),
                })
    return backups


def _get_backups():
    # Scan backup-capable storage for live vzdump backups of the selected guest.
    cluster_id = (request.args.get("cluster_id") or "").strip()
    vmid = (request.args.get("vmid") or "").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    if not vmid:
        return jsonify({"error": "vmid is required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        host, port = manager.host, manager.api_port
        session = manager._create_session()
        seen = set()
        backups = []
        guest_node = None
        guest_type = None

        # Fast path: scan the guest's current node first.
        resources = manager.get_vm_resources() or []
        guest = next(
            (r for r in resources if str(r.get("vmid")) == str(vmid)),
            None,
        )
        if guest:
            guest_node = guest.get("node")
            guest_type = guest.get("type")

        if guest_node:
            for b in _scan_node_backups(session, host, port, guest_node, vmid, guest_type):
                seen.add(b["volid"])
                backups.append(b)

        # Fallback: scan every node until we find backups for this vmid.
        if not backups:
            try:
                nodes_resp = session.get(f"https://{host}:{port}/api2/json/nodes", timeout=5)
                if nodes_resp.status_code == 200:
                    nodes = nodes_resp.json().get("data", [])
                    for n in nodes:
                        node = n.get("node")
                        if not node or node == guest_node:
                            continue
                        for b in _scan_node_backups(session, host, port, node, vmid, None):
                            if b["volid"] in seen:
                                continue
                            seen.add(b["volid"])
                            backups.append(b)
            except Exception:
                pass

        backups.sort(key=lambda x: x.get("ctime", 0), reverse=True)
        return {"backups": backups}
    except Exception as e:
        log.warning("backups failed: %s", e)
    return {"backups": []}


def _next_run(frequency, start=None):
    start = start or datetime.now()
    if frequency == "daily":
        return start + timedelta(days=1)
    if frequency == "weekly":
        return start + timedelta(weeks=1)
    if frequency == "monthly":
        return start + timedelta(days=30)
    return start


def _get_status():
    """Plugin status."""
    results = _load_json(RESULTS_FILE, [])
    schedules = _load_json(SCHEDULES_FILE, [])
    return {"plugin": PLUGIN_ID, "status": "running", "result_count": len(results), "schedule_count": len(schedules)}


def _verify():
    """POST simulate a restore and health check."""
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or request.args.get("cluster_id", "")).strip()
    vmid = body.get("vmid")
    backup_id = body.get("backup_id")
    if not cluster_id or not vmid or not backup_id:
        return jsonify({"error": "cluster_id, vmid and backup_id are required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        _ = manager
        result = {
            "id": str(uuid.uuid4()),
            "cluster_id": cluster_id,
            "vmid": vmid,
            "backup_id": backup_id,
            "result": "ok",
            "checked_at": datetime.now().isoformat(),
        }
        results = _load_json(RESULTS_FILE, [])
        results.append(result)
        _save_json(RESULTS_FILE, results)
        return result
    except Exception as e:
        log.exception("[verify] failed")
        return jsonify({"error": safe_error(e, "verification failed")}), 500


def _get_results():
    """GET verification results."""
    results = _load_json(RESULTS_FILE, [])
    cluster = request.args.get("cluster", "").strip().lower()
    vm = request.args.get("vm", "").strip()
    status = request.args.get("status", "").strip().lower()
    sort = request.args.get("sort", "checked_at")
    order = request.args.get("order", "desc")
    if cluster:
        results = [r for r in results if r.get("cluster_id", "").lower() == cluster]
    if vm:
        results = [r for r in results if str(r.get("vmid", "")) == vm]
    if status:
        results = [r for r in results if (r.get("result") or "").lower() == status]
    rev = order == "desc"
    if sort == "checked_at":
        results.sort(key=lambda r: r.get("checked_at") or "", reverse=rev)
    else:
        results.sort(key=lambda r: str(r.get(sort, "")).lower(), reverse=rev)
    return {"results": results}


def _schedule():
    """GET/POST/DELETE verification schedules."""
    if request.method == "GET":
        schedules = _load_json(SCHEDULES_FILE, [])
        for s in schedules:
            s["next_run"] = _next_run(s.get("frequency", "daily")).isoformat()
        return {"schedules": schedules}

    if request.method == "DELETE":
        sid = (request.get_json(silent=True) or {}).get("id") or request.args.get("id")
        if not sid:
            return jsonify({"error": "id is required"}), 400
        schedules = _load_json(SCHEDULES_FILE, [])
        before = len(schedules)
        schedules = [s for s in schedules if s.get("id") != sid]
        _save_json(SCHEDULES_FILE, schedules)
        if len(schedules) == before:
            return jsonify({"error": "schedule not found"}), 404
        return {"deleted": True, "id": sid}

    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or request.args.get("cluster_id", "")).strip()
    vmid = body.get("vmid")
    backup_id = body.get("backup_id")
    frequency = (body.get("frequency") or "daily").lower()
    if not cluster_id or not vmid or not backup_id:
        return jsonify({"error": "cluster_id, vmid and backup_id are required"}), 400
    if frequency not in VALID_FREQUENCIES:
        return jsonify({"error": f"frequency must be one of {VALID_FREQUENCIES}"}), 400
    cron = body.get("cron")
    schedule = {
        "id": str(uuid.uuid4()),
        "cluster_id": cluster_id,
        "vmid": vmid,
        "backup_id": backup_id,
        "frequency": frequency,
        "cron": cron,
        "next_run": _next_run(frequency).isoformat(),
        "created_at": datetime.now().isoformat(),
    }
    schedules = _load_json(SCHEDULES_FILE, [])
    schedules.append(schedule)
    _save_json(SCHEDULES_FILE, schedules)
    return {"schedule": schedule, "saved": True}


def _history():
    results = _load_json(RESULTS_FILE, [])
    by_day = {}
    for r in results:
        day = (r.get("checked_at") or "")[:10]
        if not day:
            continue
        if day not in by_day:
            by_day[day] = {"ok": 0, "fail": 0}
        if (r.get("result") or "").lower() == "ok":
            by_day[day]["ok"] += 1
        else:
            by_day[day]["fail"] += 1
    return {"history": [{"date": d, **v} for d, v in sorted(by_day.items())]}


def _get_ui():
    """Serve the Backup Verification Runner HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    """Register plugin routes."""
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "vms", _get_vms)
    register_plugin_route(PLUGIN_ID, "backups", _get_backups)
    register_plugin_route(PLUGIN_ID, "verify", _verify)
    register_plugin_route(PLUGIN_ID, "results", _get_results)
    register_plugin_route(PLUGIN_ID, "schedule", _schedule)
    register_plugin_route(PLUGIN_ID, "history", _history)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s registered", PLUGIN_ID)
