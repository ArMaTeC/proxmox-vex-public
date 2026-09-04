# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/maintenance-windows/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Maintenance Windows - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Maintenance Windows - full UI management backend.
Define, edit, delete, and override maintenance windows that suppress alerts and operations.
"""

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "maintenance-windows"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "state.json"


def _load_state():
    if not STATE_FILE.exists():
        return {}
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return {}


def _save_state(state):
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except OSError as e:
        log.error("Failed to save state: %s", e)


def _new_id():
    return uuid.uuid4().hex[:12]


def _parse_dt(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _get_window_status(w):
    start = _parse_dt(w.get("start"))
    end = _parse_dt(w.get("end"))
    now = datetime.now(timezone.utc)
    if not start or not end:
        return "unknown"
    if w.get("override"):
        return "overridden"
    if start <= now <= end:
        return "active"
    if now > end:
        return "past"
    return "upcoming"


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
    state = _load_state()
    return {"plugin": PLUGIN_ID, "status": "running", "windows_count": len(state.get("windows", []))}


def _get_windows():
    state = _load_state()
    windows = state.get("windows", [])
    status_filter = (request.args.get("status") or "").strip()
    sort = request.args.get("sort") or "start"
    order = (request.args.get("order") or "asc").strip()
    for w in windows:
        w["status"] = _get_window_status(w)
    if status_filter:
        windows = [w for w in windows if _get_window_status(w) == status_filter]
    rev = order == "desc"

    def _sort_key(w):
        v = w.get(sort) or w.get("start") or ""
        return v

    windows.sort(key=_sort_key, reverse=rev)
    return {"windows": windows}


def _validate_window(body, require_id=False):
    name = (body.get("name") or "").strip()
    start = (body.get("start") or "").strip()
    end = (body.get("end") or "").strip()
    if not name or not start or not end:
        return {"error": "name, start, and end are required"}, 400
    start_dt = _parse_dt(start)
    end_dt = _parse_dt(end)
    if not start_dt or not end_dt:
        return {"error": "start and end must be valid ISO-8601 timestamps"}, 400
    if end_dt <= start_dt:
        return {"error": "end must be after start"}, 400
    if body.get("recurring"):
        cron = (body.get("cron") or "").strip()
        if cron and not re.match(r"^[\*\d\-,/ ]+$", cron):
            return {"error": "cron expression contains invalid characters"}, 400
    if require_id and not (body.get("window_id") or body.get("id")):
        return {"error": "window_id is required"}, 400
    return None


def _post_window():
    body = request.get_json(silent=True) or {}
    err = _validate_window(body)
    if err:
        return err
    state = _load_state()
    windows = state.setdefault("windows", [])
    window_id = (body.get("window_id") or body.get("id") or "").strip()
    existing = None
    if window_id:
        existing = next((w for w in windows if w.get("window_id") == window_id), None)
    if existing:
        existing.update({
            "name": (body.get("name") or existing.get("name")).strip(),
            "start": (body.get("start") or existing.get("start")).strip(),
            "end": (body.get("end") or existing.get("end")).strip(),
            "recurring": bool(body.get("recurring", existing.get("recurring", False))),
            "cron": (body.get("cron") or existing.get("cron", "")).strip(),
            "cluster_id": (body.get("cluster_id") or existing.get("cluster_id", "")).strip(),
            "timezone": (body.get("timezone") or existing.get("timezone", "UTC")).strip(),
            "description": (body.get("description") or existing.get("description", "")).strip(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        _save_state(state)
        return {"window": existing, "saved": True}
    window = {
        "window_id": _new_id(),
        "name": (body.get("name") or "").strip(),
        "start": body.get("start", "").strip(),
        "end": body.get("end", "").strip(),
        "recurring": bool(body.get("recurring", False)),
        "cron": (body.get("cron") or "").strip(),
        "cluster_id": (body.get("cluster_id") or "").strip(),
        "timezone": (body.get("timezone") or "UTC").strip(),
        "description": (body.get("description") or "").strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    windows.append(window)
    _save_state(state)
    return {"window": window, "saved": True}


def _delete_window():
    window_id = request.args.get("id") or (request.get_json(silent=True) or {}).get("id")
    if not window_id:
        return jsonify({"error": "id is required"}), 400
    state = _load_state()
    before = len(state.get("windows", []))
    state["windows"] = [w for w in state.get("windows", []) if w.get("window_id") != window_id]
    _save_state(state)
    if len(state["windows"]) == before:
        return jsonify({"error": "window not found"}), 404
    return {"deleted": window_id}


def _get_impact():
    window_id = request.args.get("window_id", "").strip() or request.args.get("id", "").strip()
    cluster_id = request.args.get("cluster_id", "").strip()
    if not window_id:
        return jsonify({"error": "window_id is required"}), 400
    state = _load_state()
    window = next((w for w in state.get("windows", []) if w.get("window_id") == window_id), None)
    if not window:
        return jsonify({"error": "window not found"}), 404
    result = {"window_id": window_id, "name": window.get("name", ""), "impact": "alerts suppressed"}
    if cluster_id:
        manager, err = _get_manager_or_error(cluster_id)
        if err:
            return err
        result["cluster_id"] = cluster_id
        result["host"] = manager.host
    if window.get("override"):
        result["impact"] = "override active - operations allowed"
    return result


def _post_override():
    body = request.get_json(silent=True) or {}
    window_id = body.get("window_id", "").strip() or body.get("id", "").strip()
    if not window_id:
        return jsonify({"error": "window_id is required"}), 400
    state = _load_state()
    for w in state.get("windows", []):
        if w.get("window_id") == window_id:
            w["override"] = bool(body.get("override", True))
            w["updated_at"] = datetime.now(timezone.utc).isoformat()
            _save_state(state)
            return {"window": w}
    return jsonify({"error": "window not found"}), 404


def _get_ui():
    """Serve the Maintenance Windows HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "windows", _get_windows)
    register_plugin_route(PLUGIN_ID, "window", _post_window)
    register_plugin_route(PLUGIN_ID, "delete", _delete_window)
    register_plugin_route(PLUGIN_ID, "impact", _get_impact)
    register_plugin_route(PLUGIN_ID, "override", _post_override)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
