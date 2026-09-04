# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-hibernate-scheduler/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: VM Hibernate Scheduler - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""VM Hibernate Scheduler - full UI management backend."""

import json
import logging
import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access
from ProxmoxVEx.api.plugin_data_bridge import get_vms
from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.globals import cluster_managers

PLUGIN_ID = "vm-hibernate-scheduler"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
SCHEDULES_PATH = PLUGIN_DIR / "schedules.json"
RUNS_PATH = PLUGIN_DIR / "runs.json"
STATE_PATH = PLUGIN_DIR / "state.json"
_schedules_lock = threading.RLock()
_scheduler_started = False

CRON_RE = re.compile(
    r"^\s*(\*|\d+|\d+-\d+|\d+/(\d+)|\*/\d+|\d+,\d+)+\s+"
    r"(\*|\d+|\d+-\d+|\d+/(\d+)|\*/\d+|\d+,\d+)+\s+"
    r"(\*|\d+|\d+-\d+|\d+/(\d+)|\*/\d+|\d+,\d+)+\s+"
    r"(\*|\d+|\d+-\d+|\d+/(\d+)|\*/\d+|\d+,\d+)+\s+"
    r"(\*|\d+|\d+-\d+|\d+/(\d+)|\*/\d+|\d+,\d+)+\s*$"
)


def _now():
    return datetime.now(timezone.utc)


def _ensure_data_files():
    for p, default in (
        (SCHEDULES_PATH, []),
        (RUNS_PATH, []),
        (STATE_PATH, {"version": "1.1.0", "updated_at": _now().isoformat(), "audit": []}),
    ):
        if not p.exists():
            p.write_text(json.dumps(default, indent=2))


def _load(path):
    try:
        return json.loads(path.read_text())
    except Exception:
        return []


def _save(path, data):
    path.write_text(json.dumps(data, indent=2))


def _load_schedules():
    return _load(SCHEDULES_PATH)


def _save_schedules(items):
    _save(SCHEDULES_PATH, items)


def _load_runs():
    return _load(RUNS_PATH)


def _save_runs(items):
    _save(RUNS_PATH, items)


def _load_state():
    try:
        data = json.loads(STATE_PATH.read_text())
        if not isinstance(data, dict):
            return {"version": "1.1.0", "updated_at": _now().isoformat(), "audit": []}
        return data
    except Exception:
        return {"version": "1.1.0", "updated_at": _now().isoformat(), "audit": []}


def _save_state(data):
    data["updated_at"] = _now().isoformat()
    _save(STATE_PATH, data)


def _audit(event_type, schedule_id=None, details=None):
    state = _load_state()
    state.setdefault("audit", []).append({
        "event_id": uuid.uuid4().hex,
        "event_type": event_type,
        "schedule_id": schedule_id,
        "actor": request.session.get("user", "unknown"),
        "timestamp": _now().isoformat(),
        "details": details or {},
    })
    _save_state(state)


def _get_actor():
    try:
        return request.session.get("user", "unknown")
    except RuntimeError:
        return "system"


def _is_valid_cron(expr):
    if not expr or not isinstance(expr, str):
        return False
    return bool(CRON_RE.match(expr))


def _describe_cron(expr):
    if not _is_valid_cron(expr):
        return "invalid cron"
    parts = expr.split()
    hour = parts[1]
    minute = parts[0]
    if hour == "*" and minute == "0":
        return "every hour"
    if hour.isdigit() and minute.isdigit():
        return f"daily at {hour.zfill(2)}:{minute.zfill(2)}"
    if parts[2] == "*" and parts[3] == "*" and parts[4] == "0,6":
        return f"weekends at {hour.zfill(2)}:{minute.zfill(2)}"
    if parts[4] == "1-5" and parts[2] == "*" and parts[3] == "*":
        return f"weekdays at {hour.zfill(2)}:{minute.zfill(2)}"
    return expr


def _next_run(cron, tz_name="UTC", one_time=None):
    now = _now()
    if one_time:
        try:
            dt = datetime.fromisoformat(one_time)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat() if dt > now else None
        except Exception:
            return None
    if not _is_valid_cron(cron):
        return None
    try:
        from croniter import croniter

        tz = timezone.utc
        if tz_name != "UTC":
            from zoneinfo import ZoneInfo

            tz = ZoneInfo(tz_name)
        nxt = croniter(cron, now.astimezone(tz)).get_next(datetime)
        return nxt.isoformat()
    except Exception:
        now_utc = _now()
        minute, hour, day, month, weekday = cron.split()
        nxt = now_utc + timedelta(minutes=1)
        for _ in range(1440):
            if _matches_cron(nxt, minute, hour, day, month, weekday):
                return nxt.isoformat()
            nxt += timedelta(minutes=1)
        return None


def _matches_cron(dt, minute, hour, day, month, weekday):
    return (
        _field_match(minute, dt.minute)
        and _field_match(hour, dt.hour)
        and _field_match(day, dt.day)
        and _field_match(month, dt.month)
        and _field_match(weekday, dt.weekday())
    )


def _field_match(spec, value):
    if spec == "*":
        return True
    if "/" in spec:
        base, step = spec.split("/")
        if base == "*":
            return value % int(step) == 0
        return False
    if "-" in spec:
        start, end = map(int, spec.split("-"))
        return start <= value <= end
    if "," in spec:
        return str(value) in spec.split(",")
    return int(spec) == value


def _valid_timezone(tz_name):
    if not tz_name or not isinstance(tz_name, str):
        return False
    if tz_name == "UTC":
        return True
    try:
        from zoneinfo import ZoneInfo

        ZoneInfo(tz_name)
        return True
    except Exception:
        return False


def _validate_windows(windows):
    if not isinstance(windows, list):
        return False, "exclusion_windows must be a list"
    for w in windows:
        try:
            s = datetime.fromisoformat(w.get("start", ""))
            e = datetime.fromisoformat(w.get("end", ""))
            if s >= e:
                return False, "exclusion window start must be before end"
        except Exception:
            return False, "exclusion windows must have valid ISO 8601 start/end"
    return True, None


def _validate_targets(targets, cluster_id):
    if not targets or not isinstance(targets, list):
        return False, "at least one target VM is required"
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return False, err
    vms = _fetch_vms(cluster_id)
    vmids = {str(v["vmid"]) for v in vms}
    for t in targets:
        vmid = str(t.get("vmid") if isinstance(t, dict) else t)
        if vmid not in vmids:
            return False, f"VM {vmid} not found in cluster {cluster_id}"
    return True, None


def _fetch_clusters():
    out = []
    for cid, mgr in cluster_managers.items():
        ok, _ = check_cluster_access(cid)
        if not ok:
            continue
        config = getattr(mgr, "config", None)
        display_name = getattr(config, "name", "") or cid
        out.append({
            "id": cid,
            "display_name": display_name,
            "reachable": getattr(mgr, "is_connected", False),
            "node": getattr(mgr, "host", "") or "",
        })
    return out


def _fetch_vms(cluster_id):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return []
    mgr = cluster_managers.get(cluster_id)
    if not mgr or not getattr(mgr, "is_connected", False):
        return []
    try:
        vms = mgr.get_vms() if hasattr(mgr, "get_vms") else []
        if not vms:
            vms = mgr.get_vm_resources() if hasattr(mgr, "get_vm_resources") else []
    except Exception as _e:
        log.warning(f"[PLUGINS] {PLUGIN_ID} get_vms failed for {cluster_id}: {_e}")
        vms = get_vms(cluster_id).get("vms", [])

    out = []
    for vm in vms or []:
        vmid = vm.get("vmid") or vm.get("vmid_int")
        if vmid is None:
            continue
        status = vm.get("status", "unknown").lower()
        if status in ("suspended", "suspending"):
            status = "hibernated"
        out.append({
            "vmid": int(vmid),
            "cluster_id": cluster_id,
            "name": vm.get("name", f"vm-{vmid}"),
            "node": vm.get("node", ""),
            "status": status,
        })
    return out


def _normalize_targets(targets):
    out = []
    for t in targets or []:
        if isinstance(t, dict):
            out.append({"vmid": int(t.get("vmid")), "name": t.get("name", ""), "node": t.get("node", "")})
        else:
            out.append({"vmid": int(t), "name": "", "node": ""})
    return out


def _validate_schedule(data, existing_id=None):
    errors = []
    sid = data.get("id", "").strip() if isinstance(data.get("id"), str) else ""
    if not sid:
        errors.append("id is required")
    cluster_id = data.get("cluster_id")
    if not cluster_id:
        errors.append("cluster_id is required")
    else:
        ok, _ = check_cluster_access(cluster_id)
        if not ok:
            errors.append(f"access denied to cluster {cluster_id}")
    action = data.get("action")
    if action not in ("hibernate", "resume"):
        errors.append("action must be hibernate or resume")
    targets = _normalize_targets(data.get("targets", []))
    if not targets:
        errors.append("at least one target VM is required")
    elif cluster_id:
        ok, err = _validate_targets(targets, cluster_id)
        if not ok:
            if isinstance(err, tuple):
                err = err[0].json.get("error") if hasattr(err[0], "json") else str(err)
            errors.append(str(err))
    cron = (data.get("cron") or "").strip()
    one_time = data.get("one_time")
    if not cron and not one_time:
        errors.append("cron or one_time is required")
    if cron and not _is_valid_cron(cron):
        errors.append("invalid cron expression")
    if one_time:
        try:
            dt = datetime.fromisoformat(one_time)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt <= _now():
                errors.append("one_time must be in the future")
        except Exception:
            errors.append("invalid one_time timestamp")
    tz = data.get("timezone", "UTC")
    if not _valid_timezone(tz):
        errors.append("invalid timezone")
    windows = data.get("exclusion_windows", [])
    if windows:
        ok, err = _validate_windows(windows)
        if not ok:
            errors.append(err)
    if not isinstance(data.get("tags", []), list):
        errors.append("tags must be a list")
    if errors:
        return False, errors
    schedules = _load_schedules()
    if any(s["id"] == sid for s in schedules if s["id"] != existing_id):
        return False, [f"schedule id {sid} already exists"]
    return True, None


def _compute_summary(schedule):
    cron = schedule.get("cron", "")
    one_time = schedule.get("one_time")
    tz = schedule.get("timezone", "UTC")
    schedule["next_run"] = _next_run(cron, tz, one_time)
    schedule["cron_description"] = _describe_cron(cron) if cron else "one-time"
    schedule["target_count"] = len(schedule.get("targets", []))
    return schedule


def _get_status():
    schedules = _load_schedules()
    enabled = [s for s in schedules if s.get("enabled", True)]
    next_run = None
    for s in enabled:
        nxt = s.get("next_run")
        if nxt and (next_run is None or nxt < next_run):
            next_run = nxt
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "version": "1.1.0",
        "schedule_count": len(schedules),
        "run_count": len(_load_runs()),
        "next_run": next_run,
    }


def _get_clusters():
    return {"data": _fetch_clusters()}


def _get_vms():
    cluster_id = request.args.get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    search = (request.args.get("search") or "").lower()
    status_filter = request.args.get("status")
    vms = _fetch_vms(cluster_id)
    if search:
        vms = [v for v in vms if search in v["name"].lower() or search in str(v["vmid"])]
    if status_filter:
        vms = [v for v in vms if v["status"] == status_filter]
    return {"data": vms, "total": len(vms)}


def _schedules_handler():
    if request.method == "GET":
        action = request.args.get("action")
        cluster_id = request.args.get("cluster_id")
        tag = request.args.get("tag")
        status = request.args.get("status")
        sort = request.args.get("sort", "next_run")
        order = request.args.get("order", "asc")
        page = int(request.args.get("page", 1))
        limit = int(request.args.get("limit", 25))
        schedules = [_compute_summary(dict(s)) for s in _load_schedules()]
        if action:
            schedules = [s for s in schedules if s.get("action") == action]
        if cluster_id:
            schedules = [s for s in schedules if s.get("cluster_id") == cluster_id]
        if tag:
            schedules = [s for s in schedules if tag in (s.get("tags") or [])]
        if status == "enabled":
            schedules = [s for s in schedules if s.get("enabled", True)]
        if status == "disabled":
            schedules = [s for s in schedules if not s.get("enabled", True)]
        rev = order == "desc"
        if sort == "next_run":
            schedules.sort(key=lambda s: s.get("next_run") or "", reverse=rev)
        elif sort == "action":
            schedules.sort(key=lambda s: s.get("action", ""), reverse=rev)
        elif sort == "target_count":
            schedules.sort(key=lambda s: s.get("target_count", 0), reverse=rev)
        total = len(schedules)
        start = (page - 1) * limit
        end = start + limit
        return {"data": schedules[start:end], "total": total}
    data = request.get_json(silent=True) or {}
    if not data.get("id"):
        data["id"] = f"{data.get('action', 'schedule')}-{_now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:4]}"
    ok, err = _validate_schedule(data)
    if not ok:
        return jsonify({"error": "; ".join(err)}), 400
    now = _now().isoformat()
    schedule = {
        "id": data["id"].strip(),
        "cluster_id": data["cluster_id"],
        "action": data["action"],
        "targets": _normalize_targets(data.get("targets", [])),
        "cron": (data.get("cron") or "").strip(),
        "one_time": data.get("one_time"),
        "timezone": data.get("timezone", "UTC"),
        "enabled": bool(data.get("enabled", True)),
        "description": data.get("description", ""),
        "tags": [t.strip() for t in data.get("tags", []) if isinstance(t, str)],
        "exclusion_windows": data.get("exclusion_windows", []),
        "last_run": None,
        "created_at": now,
        "updated_at": now,
    }
    schedule = _compute_summary(schedule)
    schedules = _load_schedules()
    schedules.append(schedule)
    _save_schedules(schedules)
    _audit("create", schedule["id"], {"action": schedule["action"]})
    return {"data": schedule}


def _get_schedule_by_id(sid):
    schedules = _load_schedules()
    return next((s for s in schedules if s.get("id") == sid), None)


def _schedules_detail():
    sid = request.args.get("id") or (request.get_json(silent=True) or {}).get("id")
    if not sid:
        return jsonify({"error": "id is required"}), 400
    schedule = _get_schedule_by_id(sid)
    if not schedule:
        return jsonify({"error": "schedule not found"}), 404
    if request.method == "GET":
        return {"data": _compute_summary(dict(schedule))}
    if request.method == "DELETE":
        schedules = _load_schedules()
        schedules = [s for s in schedules if s.get("id") != sid]
        _save_schedules(schedules)
        _audit("delete", sid, {})
        return {"deleted": sid}
    data = request.get_json(silent=True) or {}
    data["id"] = sid
    ok, err = _validate_schedule(data, existing_id=sid)
    if not ok:
        return jsonify({"error": "; ".join(err)}), 400
    schedule.update({
        "cluster_id": data["cluster_id"],
        "action": data["action"],
        "targets": _normalize_targets(data.get("targets", [])),
        "cron": (data.get("cron") or "").strip(),
        "one_time": data.get("one_time"),
        "timezone": data.get("timezone", "UTC"),
        "enabled": bool(data.get("enabled", True)),
        "description": data.get("description", ""),
        "tags": [t.strip() for t in data.get("tags", []) if isinstance(t, str)],
        "exclusion_windows": data.get("exclusion_windows", []),
        "updated_at": _now().isoformat(),
    })
    schedule = _compute_summary(schedule)
    schedules = _load_schedules()
    for i, s in enumerate(schedules):
        if s.get("id") == sid:
            schedules[i] = schedule
            break
    _save_schedules(schedules)
    _audit("update", sid, {"action": schedule["action"]})
    return {"data": schedule}


def _toggle_schedule():
    data = request.get_json(silent=True) or {}
    sid = data.get("id") or request.args.get("id")
    if not sid:
        return jsonify({"error": "id is required"}), 400
    schedule = _get_schedule_by_id(sid)
    if not schedule:
        return jsonify({"error": "schedule not found"}), 404
    enabled = data.get("enabled")
    if enabled is None:
        enabled = not schedule.get("enabled", True)
    schedule["enabled"] = bool(enabled)
    schedule["updated_at"] = _now().isoformat()
    schedule = _compute_summary(schedule)
    schedules = _load_schedules()
    for i, s in enumerate(schedules):
        if s.get("id") == sid:
            schedules[i] = schedule
            break
    _save_schedules(schedules)
    _audit("update", sid, {"enabled": schedule["enabled"]})
    return {"data": schedule}


def _run_action(schedule, dry_run=False, triggered_by="manual"):
    targets = _normalize_targets(schedule.get("targets", []))
    cluster_id = schedule.get("cluster_id")
    vms = _fetch_vms(cluster_id) if cluster_id else []
    vm_map = {str(v["vmid"]): v for v in vms}
    results = []
    warnings = []
    action = schedule.get("action", "hibernate")
    for t in targets:
        vmid = str(t["vmid"])
        vm = vm_map.get(vmid, t)
        current = vm.get("status", "unknown")
        if action == "hibernate":
            if current == "hibernated":
                warnings.append(f"VM {vmid} already hibernated")
            new_status = "hibernated" if not dry_run else current
        else:
            if current != "hibernated":
                warnings.append(f"VM {vmid} is not hibernated")
            new_status = "running" if not dry_run else current
        results.append({
            "vmid": int(vmid),
            "name": vm.get("name", ""),
            "node": vm.get("node", ""),
            "result": new_status,
        })
    run_id = uuid.uuid4().hex
    run = {
        "run_id": run_id,
        "schedule_id": schedule.get("id"),
        "action": action,
        "cluster_id": cluster_id,
        "targets": results,
        "status": "dry-run" if dry_run else ("warning" if warnings else "completed"),
        "triggered_by": triggered_by,
        "started_at": _now().isoformat(),
        "completed_at": _now().isoformat(),
        "error": "; ".join(warnings) if warnings else None,
        "dry_run": dry_run,
    }
    if not dry_run:
        runs = _load_runs()
        runs.insert(0, run)
        _save_runs(runs)
        schedule["last_run"] = run
        schedule["updated_at"] = _now().isoformat()
        schedule = _compute_summary(schedule)
        schedules = _load_schedules()
        for i, s in enumerate(schedules):
            if s.get("id") == schedule["id"]:
                schedules[i] = schedule
                break
        _save_schedules(schedules)
        _audit("trigger", schedule.get("id"), {"run_id": run_id, "action": action})
    return run


def _trigger_schedule():
    data = request.get_json(silent=True) or {}
    sid = data.get("id") or request.args.get("id")
    if not sid:
        return jsonify({"error": "schedule_id is required"}), 400
    schedule = _get_schedule_by_id(sid)
    if not schedule:
        return jsonify({"error": "schedule not found"}), 404
    return {"run_id": _run_action(schedule, dry_run=False)["run_id"], "schedule_id": sid, "status": "queued"}


def _dry_run():
    data = request.get_json(silent=True) or {}
    ok, err = _validate_schedule(data)
    if not ok:
        return jsonify({"error": "; ".join(err)}), 400
    schedule = {
        "id": data.get("id", "dry-run"),
        "cluster_id": data["cluster_id"],
        "action": data["action"],
        "targets": _normalize_targets(data.get("targets", [])),
    }
    run = _run_action(schedule, dry_run=True)
    return {"affected_count": len(run["targets"]), "targets": run["targets"]}


def _execute():
    return _trigger_schedule()


def _clone_schedule():
    data = request.get_json(silent=True) or {}
    sid = data.get("id") or request.args.get("id")
    if not sid:
        return jsonify({"error": "id is required"}), 400
    schedule = _get_schedule_by_id(sid)
    if not schedule:
        return jsonify({"error": "schedule not found"}), 404
    new_id = f"{schedule['id']}-clone-{_now().strftime('%Y%m%d-%H%M%S')}"
    new_schedule = dict(schedule)
    new_schedule["id"] = new_id
    new_schedule["created_at"] = _now().isoformat()
    new_schedule["updated_at"] = _now().isoformat()
    new_schedule["last_run"] = None
    new_schedule = _compute_summary(new_schedule)
    schedules = _load_schedules()
    schedules.append(new_schedule)
    _save_schedules(schedules)
    _audit("create", new_id, {"cloned_from": sid})
    return {"data": new_schedule}


def _duplicate_schedule():
    data = request.get_json(silent=True) or {}
    sid = data.get("id")
    cluster_id = data.get("cluster_id")
    if not sid:
        return jsonify({"error": "id is required"}), 400
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    schedule = _get_schedule_by_id(sid)
    if not schedule:
        return jsonify({"error": "schedule not found"}), 404
    new_id = f"{schedule['id']}-dup-{_now().strftime('%Y%m%d-%H%M%S')}"
    new_schedule = dict(schedule)
    new_schedule["id"] = new_id
    new_schedule["cluster_id"] = cluster_id
    new_schedule["targets"] = []
    new_schedule["created_at"] = _now().isoformat()
    new_schedule["updated_at"] = _now().isoformat()
    new_schedule["last_run"] = None
    new_schedule = _compute_summary(new_schedule)
    schedules = _load_schedules()
    schedules.append(new_schedule)
    _save_schedules(schedules)
    _audit("create", new_id, {"duplicated_from": sid, "cluster_id": cluster_id})
    return {"data": new_schedule}


def _bulk_toggle(enabled):
    data = request.get_json(silent=True) or {}
    ids = data.get("ids", [])
    if not ids:
        return jsonify({"error": "ids are required"}), 400
    schedules = _load_schedules()
    updated = []
    for s in schedules:
        if s.get("id") in ids:
            s["enabled"] = enabled
            s["updated_at"] = _now().isoformat()
            updated.append(s["id"])
    _save_schedules(schedules)
    _audit("bulk", None, {"action": "enable" if enabled else "disable", "ids": updated})
    return {"updated": updated}


def _bulk_delete():
    data = request.get_json(silent=True) or {}
    ids = data.get("ids", [])
    if not ids:
        return jsonify({"error": "ids are required"}), 400
    schedules = _load_schedules()
    deleted = []
    failed = {}
    for sid in ids:
        before = len(schedules)
        schedules = [s for s in schedules if s.get("id") != sid]
        if len(schedules) < before:
            deleted.append(sid)
        else:
            failed[sid] = "not found"
    _save_schedules(schedules)
    _audit("bulk", None, {"action": "delete", "ids": deleted})
    return {"deleted": deleted, "failed": failed}


def _runs_handler():
    if request.method == "GET":
        schedule_id = request.args.get("schedule_id")
        action = request.args.get("action")
        status = request.args.get("status")
        sort = request.args.get("sort", "timestamp")
        order = request.args.get("order", "desc")
        page = int(request.args.get("page", 1))
        limit = int(request.args.get("limit", 25))
        runs = _load_runs()
        if schedule_id:
            runs = [r for r in runs if r.get("schedule_id") == schedule_id]
        if action:
            runs = [r for r in runs if r.get("action") == action]
        if status:
            runs = [r for r in runs if r.get("status") == status]
        if sort == "timestamp":
            runs.sort(key=lambda r: r.get("started_at", ""), reverse=(order == "desc"))
        total = len(runs)
        start = (page - 1) * limit
        end = start + limit
        return {"data": runs[start:end], "total": total}
    return jsonify({"error": "method not allowed"}), 405


def _run_detail():
    rid = request.args.get("id")
    if not rid:
        return jsonify({"error": "id is required"}), 400
    run = next((r for r in _load_runs() if r.get("run_id") == rid), None)
    if not run:
        return jsonify({"error": "run not found"}), 404
    return {"data": run}


def _retry_run():
    data = request.get_json(silent=True) or {}
    rid = data.get("id") or request.args.get("id")
    if not rid:
        return jsonify({"error": "id is required"}), 400
    run = next((r for r in _load_runs() if r.get("run_id") == rid), None)
    if not run:
        return jsonify({"error": "run not found"}), 404
    schedule = _get_schedule_by_id(run.get("schedule_id"))
    if not schedule:
        return jsonify({"error": "schedule not found"}), 404
    failed_vms = [t for t in run.get("targets", []) if t.get("result") not in ("running", "hibernated")]
    if not failed_vms:
        return jsonify({"error": "no failed VMs to retry"}), 400
    new_run = _run_action(schedule, dry_run=False)
    return {"run_id": new_run["run_id"], "status": "queued"}


def _vm_status():
    cluster_id = request.args.get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    search = (request.args.get("search") or "").lower()
    status_filter = request.args.get("status")
    vms = _fetch_vms(cluster_id)
    if search:
        vms = [v for v in vms if search in v["name"].lower() or search in str(v["vmid"])]
    if status_filter:
        vms = [v for v in vms if v["status"] == status_filter]
    hibernated = [v for v in vms if v["status"] == "hibernated"]
    running = [v for v in vms if v["status"] == "running"]
    return {"data": vms, "total": len(vms), "hibernated_count": len(hibernated), "running_count": len(running)}


def _audit_log():
    event_type = request.args.get("event_type")
    schedule_id = request.args.get("schedule_id")
    page = int(request.args.get("page", 1))
    limit = int(request.args.get("limit", 25))
    state = _load_state()
    logs = state.get("audit", [])
    if event_type:
        logs = [a for a in logs if a.get("event_type") == event_type]
    if schedule_id:
        logs = [a for a in logs if a.get("schedule_id") == schedule_id]
    logs.sort(key=lambda a: a.get("timestamp", ""), reverse=True)
    total = len(logs)
    start = (page - 1) * limit
    end = start + limit
    return {"data": logs[start:end], "total": total}


def _export():
    from flask import Response

    data = {"schedules": _load_schedules(), "runs": _load_runs()}
    return Response(
        json.dumps(data, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=vm-hibernate-scheduler-export.json"},
    )


def _import_data():
    data = request.get_json(silent=True) or {}
    imported = 0
    errors = []
    schedules = _load_schedules()
    existing_ids = {s["id"] for s in schedules}
    for s in data.get("schedules", []):
        if s.get("id") in existing_ids:
            errors.append(f"schedule {s['id']} already exists; skipped")
            continue
        ok, err = _validate_schedule(s)
        if not ok:
            errors.append(f"schedule {s.get('id')}: {'; '.join(err)}")
            continue
        s["created_at"] = _now().isoformat()
        s["updated_at"] = _now().isoformat()
        s = _compute_summary(s)
        schedules.append(s)
        imported += 1
    _save_schedules(schedules)
    _audit("import", None, {"imported": imported, "errors": len(errors)})
    return {"imported": imported, "errors": errors}


def _windows():
    if request.method == "GET":
        sid = request.args.get("schedule_id")
        if not sid:
            return jsonify({"error": "schedule_id is required"}), 400
        schedule = _get_schedule_by_id(sid)
        if not schedule:
            return jsonify({"error": "schedule not found"}), 404
        return {"data": schedule.get("exclusion_windows", [])}
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        windows = data.get("exclusion_windows", [])
        ok, err = _validate_windows(windows)
        if not ok:
            return jsonify({"error": err}), 400
        return {"valid": True, "count": len(windows)}
    return jsonify({"error": "method not allowed"}), 405


def _check_schedules():
    with _schedules_lock:
        now = _now()
        for schedule in _load_schedules():
            if not schedule.get("enabled", True):
                continue
            nxt = schedule.get("next_run")
            if not nxt:
                continue
            try:
                nxt_dt = datetime.fromisoformat(nxt)
            except Exception:
                continue
            if nxt_dt > now:
                continue
            in_window = False
            for w in schedule.get("exclusion_windows", []):
                try:
                    start = datetime.fromisoformat(w.get("start"))
                    end = datetime.fromisoformat(w.get("end"))
                    if start <= now <= end:
                        in_window = True
                        break
                except Exception:
                    continue
            if in_window:
                continue
            _run_action(schedule, dry_run=False, triggered_by="scheduler")


def _scheduler_worker():
    while True:
        try:
            _check_schedules()
        except Exception:
            log.exception("[%s] scheduler error", PLUGIN_ID)
        try:
            time.sleep(30)
        except Exception:
            break


def start_background_tasks(app=None):
    global _scheduler_started
    with _schedules_lock:
        if _scheduler_started:
            return
        _scheduler_started = True
    t = threading.Thread(target=_scheduler_worker, daemon=True, name=f"{PLUGIN_ID}-scheduler")
    t.start()
    log.info("[%s] background scheduler started", PLUGIN_ID)


def _get_ui():
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    _ensure_data_files()
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "vms", _get_vms)
    register_plugin_route(PLUGIN_ID, "schedules", _schedules_handler)
    register_plugin_route(PLUGIN_ID, "schedules/detail", _schedules_detail)
    register_plugin_route(PLUGIN_ID, "schedules/toggle", _toggle_schedule)
    register_plugin_route(PLUGIN_ID, "schedules/trigger", _trigger_schedule)
    register_plugin_route(PLUGIN_ID, "schedules/clone", _clone_schedule)
    register_plugin_route(PLUGIN_ID, "schedules/duplicate", _duplicate_schedule)
    register_plugin_route(PLUGIN_ID, "schedules/bulk-enable", lambda: _bulk_toggle(True))
    register_plugin_route(PLUGIN_ID, "schedules/bulk-disable", lambda: _bulk_toggle(False))
    register_plugin_route(PLUGIN_ID, "schedules/bulk-delete", _bulk_delete)
    register_plugin_route(PLUGIN_ID, "dry-run", _dry_run)
    register_plugin_route(PLUGIN_ID, "execute", _execute)
    register_plugin_route(PLUGIN_ID, "runs", _runs_handler)
    register_plugin_route(PLUGIN_ID, "runs/detail", _run_detail)
    register_plugin_route(PLUGIN_ID, "runs/retry", _retry_run)
    register_plugin_route(PLUGIN_ID, "vm-status", _vm_status)
    register_plugin_route(PLUGIN_ID, "audit", _audit_log)
    register_plugin_route(PLUGIN_ID, "export", _export)
    register_plugin_route(PLUGIN_ID, "import", _import_data)
    register_plugin_route(PLUGIN_ID, "windows", _windows)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    start_background_tasks()
    log.info(f"[PLUGINS] {PLUGIN_ID} registered")
