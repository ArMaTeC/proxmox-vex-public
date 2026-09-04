# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-rightsizing/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: VM Rightsizing - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""VM Rightsizing - full UI management backend."""

import csv
import io
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugin_data_bridge import get_clusters
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "vm-rightsizing"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_PATH = PLUGIN_DIR / "state.json"

CPU_UP = 0.8
CPU_DOWN = 0.2


def _now():
    return datetime.now(timezone.utc)


def _ensure_data_files():
    if not STATE_PATH.exists():
        STATE_PATH.write_text(json.dumps({"reports": [], "schedules": [], "version": "1.1.0"}, indent=2))


def _load_state():
    try:
        return json.loads(STATE_PATH.read_text())
    except Exception:
        return {"reports": [], "schedules": [], "version": "1.1.0"}


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
        "report_count": len(state.get("reports", [])),
        "schedule_count": len(state.get("schedules", [])),
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


def _vms_for_cluster(cluster_id):
    manager, err = _manager_or_error(cluster_id)
    if err:
        return None, err
    try:
        data = manager.api_request("GET", "/cluster/resources?type=vm") or []
    except Exception as e:
        log.error(safe_error(e, "VM list failed"))
        data = []
    return data, None


def _recommendation_for(vm):
    maxcpu = vm.get("maxcpu", 1) or 1
    cpu = vm.get("cpu", 0) or 0
    maxmem = (vm.get("maxmem", 0) or 0) / (1024 * 1024 * 1024)
    ratio = float(cpu) / float(maxcpu)
    if ratio > CPU_UP:
        return "scale_up_cpu"
    if ratio < CPU_DOWN and maxcpu > 1:
        return "scale_down_cpu"
    if maxmem > 8 and float(cpu or 0) < 0.3:
        return "reduce_memory"
    return "right_sized"


def _scan():
    cluster_id = request.args.get("cluster_id") or (request.get_json(silent=True) or {}).get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    vms, err = _vms_for_cluster(cluster_id)
    if err:
        return err
    recs = []
    for vm in vms:
        rec = _recommendation_for(vm)
        recs.append({
            "vmid": vm.get("vmid", "?"),
            "name": vm.get("name", ""),
            "vcpus": vm.get("maxcpu", 1),
            "memory_gb": round((vm.get("maxmem", 0) or 0) / (1024 * 1024 * 1024), 1),
            "cpu_util": round(vm.get("cpu", 0) / (vm.get("maxcpu", 1) or 1), 2),
            "recommendation": rec,
        })
    return {"cluster_id": cluster_id, "recommendations": recs}


def _post_report():
    data = request.get_json(silent=True) or {}
    cluster_id = data.get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    vms, err = _vms_for_cluster(cluster_id)
    if err:
        return err
    recs = []
    for vm in vms:
        rec = _recommendation_for(vm)
        recs.append({
            "vmid": vm.get("vmid", "?"),
            "name": vm.get("name", ""),
            "vcpus": vm.get("maxcpu", 1),
            "memory_gb": round((vm.get("maxmem", 0) or 0) / (1024 * 1024 * 1024), 1),
            "cpu_util": round(vm.get("cpu", 0) / (vm.get("maxcpu", 1) or 1), 2),
            "recommendation": rec,
        })
    state = _load_state()
    report = {
        "report_id": f"rsz-{uuid.uuid4().hex[:8]}",
        "name": data.get("name") or f"Scan {_now().isoformat()}",
        "cluster_id": cluster_id,
        "created_at": _now().isoformat(),
        "recommendations": recs,
    }
    state.setdefault("reports", []).append(report)
    _save_state(state)
    return report


def _get_reports():
    state = _load_state()
    return {"data": state.get("reports", [])[::-1]}


def _get_report():
    report_id = request.args.get("report_id") or (request.get_json(silent=True) or {}).get("report_id")
    state = _load_state()
    report = next((r for r in state.get("reports", []) if r.get("report_id") == report_id), None)
    if not report:
        return jsonify({"error": "report not found"}), 404
    return report


def _post_apply():
    data = request.get_json(silent=True) or {}
    changes = data.get("changes", [])
    if not changes:
        return jsonify({"error": "changes list is required"}), 400
    applied = []
    for c in changes:
        applied.append({
            "vmid": c.get("vmid"),
            "new_vcpus": c.get("new_vcpus"),
            "new_memory_gb": c.get("new_memory_gb"),
            "status": "requested",
        })
    return {"applied": len(applied), "changes": applied}


def _get_schedules():
    state = _load_state()
    return {"data": state.get("schedules", [])}


def _post_schedule():
    data = request.get_json(silent=True) or {}
    cron = data.get("cron")
    if not cron:
        return jsonify({"error": "cron is required"}), 400
    state = _load_state()
    schedule = {
        "id": f"sch-{uuid.uuid4().hex[:8]}",
        "cluster_id": data.get("cluster_id"),
        "cron": cron,
        "enabled": data.get("enabled", True),
        "created_at": _now().isoformat(),
    }
    state.setdefault("schedules", []).append(schedule)
    _save_state(state)
    return {"schedule": schedule}


def _get_export():
    fmt = request.args.get("format", "json")
    state = _load_state()
    reports = state.get("reports", [])
    if fmt == "csv":
        out = io.StringIO()
        writer = csv.DictWriter(out, fieldnames=["report_id", "name", "cluster_id", "created_at"])
        writer.writeheader()
        for r in reports:
            writer.writerow({
                "report_id": r.get("report_id"),
                "name": r.get("name"),
                "cluster_id": r.get("cluster_id"),
                "created_at": r.get("created_at"),
            })
        return send_file(
            io.BytesIO(out.getvalue().encode()),
            mimetype="text/csv",
            as_attachment=True,
            download_name="rightsizing-reports.csv",
        )
    return jsonify({"reports": reports})


def _get_ui():
    _ensure_data_files()
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    _ensure_data_files()
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "scan", _scan)
    register_plugin_route(PLUGIN_ID, "report", _post_report)
    register_plugin_route(PLUGIN_ID, "reports", _get_reports)
    register_plugin_route(PLUGIN_ID, "report-detail", _get_report)
    register_plugin_route(PLUGIN_ID, "apply", _post_apply)
    register_plugin_route(PLUGIN_ID, "schedules", _get_schedules)
    register_plugin_route(PLUGIN_ID, "schedule", _post_schedule)
    register_plugin_route(PLUGIN_ID, "export", _get_export)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info(f"[PLUGINS] {PLUGIN_ID} registered")
