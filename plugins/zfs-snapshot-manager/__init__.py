# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/zfs-snapshot-manager/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: ZFS Snapshot Manager - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
ZFS Snapshot Manager - full UI management backend.
Manages ZFS snapshots, simulates rollback and prunes by age.
"""

import json
import logging
import random
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "zfs-snapshot-manager"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
SNAPSHOTS_FILE = PLUGIN_DIR / "snapshots.json"
STATE_FILE = PLUGIN_DIR / "state.json"

CRON_RE = re.compile(r"^[\d\-*/, ]+$")


def _now():
    return datetime.now(timezone.utc)


def _load_json(path, default):
    if not path.exists():
        return default
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def _save_json(path, data):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        log.error("save %s: %s", path, e)


def _load_state():
    return _load_json(STATE_FILE, {"schedules": [], "history": [], "version": "1.1.0"})


def _save_state(data):
    data["version"] = "1.1.0"
    data["updated_at"] = _now().isoformat()
    _save_json(STATE_FILE, data)


def _ensure_files():
    if not SNAPSHOTS_FILE.exists():
        _save_json(SNAPSHOTS_FILE, [])
    if not STATE_FILE.exists():
        _save_state({"schedules": [], "history": []})


def _datasets():
    return ["tank/vm-100", "tank/vm-101", "tank/data", "rpool/pve-100"]


def _is_valid_cron(expr):
    if not expr:
        return False
    parts = expr.split()
    if len(parts) != 5:
        return False
    return all(CRON_RE.match(part) for part in parts)


def _get_status():
    snapshots = _load_json(SNAPSHOTS_FILE, [])
    state = _load_state()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "snapshot_count": len(snapshots),
        "schedule_count": len(state.get("schedules", [])),
    }


def _get_datasets():
    return {"data": _datasets()}


def _snapshots():
    if request.method == "GET":
        return _load_json(SNAPSHOTS_FILE, [])

    if request.method == "DELETE":
        snap_id = request.args.get("id") or request.get_json(silent=True).get("id")
        if not snap_id:
            return jsonify({"error": "id is required"}), 400
        snapshots = _load_json(SNAPSHOTS_FILE, [])
        snapshots = [s for s in snapshots if s.get("id") != snap_id]
        _save_json(SNAPSHOTS_FILE, snapshots)
        return {"deleted": True, "id": snap_id}

    body = request.get_json(silent=True) or {}
    dataset = (body.get("dataset") or "").strip()
    name = (body.get("name") or "").strip()
    if not dataset or not name:
        return jsonify({"error": "dataset and name are required"}), 400
    snapshots = _load_json(SNAPSHOTS_FILE, [])
    warnings = []
    if any(s.get("dataset") == dataset and s.get("name") == name for s in snapshots):
        warnings.append(f"snapshot {dataset}@{name} already exists")
    snapshot = {
        "id": f"snap-{uuid.uuid4().hex[:8]}",
        "dataset": dataset,
        "name": name,
        "size_mb": random.randint(10, 500),
        "created_at": _now().isoformat(),
    }
    snapshots.append(snapshot)
    _save_json(SNAPSHOTS_FILE, snapshots)
    return {"snapshot": snapshot, "warnings": warnings}


def _rollback():
    body = request.get_json(silent=True) or {}
    snap_id = (body.get("snapshot_id") or "").strip()
    dataset = (body.get("dataset") or "").strip()
    dry_run = bool(body.get("dry_run"))
    if not snap_id or not dataset:
        return jsonify({"error": "snapshot_id and dataset are required"}), 400
    snapshots = _load_json(SNAPSHOTS_FILE, [])
    snap = next((s for s in snapshots if s.get("id") == snap_id), None)
    if not snap:
        return jsonify({"error": "snapshot not found"}), 404
    if dry_run:
        return {"snapshot": snap, "dataset": dataset, "dry_run": True, "would_rollback": True, "status": "dry_run"}
    return {
        "snapshot": snap,
        "dataset": dataset,
        "status": "rolled_back",
        "rolled_at": _now().isoformat(),
    }


def _prune():
    body = request.get_json(silent=True) or {}
    age_days = body.get("age_days")
    if age_days is None:
        return jsonify({"error": "age_days is required"}), 400
    try:
        age_days = int(age_days)
    except (TypeError, ValueError):
        return jsonify({"error": "age_days must be an integer"}), 400
    dry_run = bool(body.get("dry_run"))
    cut = _now() - timedelta(days=age_days)
    snapshots = _load_json(SNAPSHOTS_FILE, [])
    kept = []
    pruned = []
    for s in snapshots:
        try:
            ts = datetime.fromisoformat(s["created_at"])
        except (ValueError, KeyError):
            ts = _now()
        if ts < cut:
            pruned.append(s)
        else:
            kept.append(s)
    if not dry_run:
        _save_json(SNAPSHOTS_FILE, kept)
    state = _load_state()
    state.setdefault("history", []).append({
        "run_id": f"prune-{uuid.uuid4().hex[:8]}",
        "age_days": age_days,
        "dry_run": dry_run,
        "pruned": len(pruned),
        "kept": len(kept),
        "ran_at": _now().isoformat(),
    })
    _save_state(state)
    return {"pruned": len(pruned), "kept": len(kept), "dry_run": dry_run, "pruned_snapshots": pruned}


def _prune_schedules():
    state = _load_state()
    if request.method == "GET":
        return {"schedules": state.get("schedules", [])}
    body = request.get_json(silent=True) or {}
    schedule = body.get("schedule")
    if not schedule or not _is_valid_cron(schedule):
        return jsonify({"error": "invalid cron expression"}), 400
    entry = {
        "id": f"sch-{uuid.uuid4().hex[:8]}",
        "schedule": schedule,
        "age_days": int(body.get("age_days", 7)),
        "enabled": bool(body.get("enabled", True)),
        "created_at": _now().isoformat(),
    }
    state.setdefault("schedules", []).append(entry)
    _save_state(state)
    return {"schedule": entry}


def _prune_history():
    state = _load_state()
    return {"history": state.get("history", [])[::-1]}


def _get_ui():
    _ensure_files()
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    _ensure_files()
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "datasets", _get_datasets)
    register_plugin_route(PLUGIN_ID, "snapshots", _snapshots)
    register_plugin_route(PLUGIN_ID, "rollback", _rollback)
    register_plugin_route(PLUGIN_ID, "prune", _prune)
    register_plugin_route(PLUGIN_ID, "prune_schedules", _prune_schedules)
    register_plugin_route(PLUGIN_ID, "prune_history", _prune_history)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s registered", PLUGIN_ID)
