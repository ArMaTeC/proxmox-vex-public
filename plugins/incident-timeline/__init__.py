# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/incident-timeline/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Incident Timeline - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Incident Timeline - full UI management backend.
Reconstruct a timeline of events for a cluster or VM during an incident.
"""

import csv
import io
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "incident-timeline"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "state.json"


def _new_id():
    return uuid.uuid4().hex[:12]


def _load_state():
    if not STATE_FILE.exists():
        return _default_state()
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return _default_state()
        return _migrate_state(data)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return _default_state()


def _default_state():
    return {
        "events": [],
        "bookmarks": [],
        "pinned": [],
        "presets": [],
    }


def _migrate_state(data):
    for k in ("events", "bookmarks", "pinned", "presets"):
        if not isinstance(data.get(k), list):
            data[k] = []
    return data


def _save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except OSError as e:
        log.error("Failed to save state: %s", e)


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


def _get_status():
    state = _load_state()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "version": "1.0.0",
        "event_count": len(state.get("events", [])),
        "bookmark_count": len(state.get("bookmarks", [])),
    }


def _filter_events(events, q="", since=None, until=None, severity=None, event_type=None, vmid=None, cluster_id=None):
    q = (q or "").lower()
    out = events
    if q:
        out = [e for e in out if q in (e.get("message") or "").lower() or q in (e.get("event_id") or "").lower()]
    if since:
        out = [e for e in out if (e.get("timestamp") or "") >= since]
    if until:
        out = [e for e in out if (e.get("timestamp") or "") <= until]
    if severity:
        out = [e for e in out if e.get("severity") == severity]
    if event_type:
        out = [e for e in out if e.get("event_type") == event_type]
    if cluster_id:
        out = [e for e in out if e.get("cluster_id") == cluster_id]
    if vmid:
        out = [e for e in out if e.get("vmid") == vmid]
    return sorted(out, key=lambda x: x.get("timestamp") or "", reverse=True)


def _get_timeline():
    cluster_id = request.args.get("cluster_id", "").strip()
    vmid = request.args.get("vmid", "").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    manager, err = _get_manager_or_error(cluster_id)
    if err:
        return err
    state = _load_state()
    q = request.args.get("q", "").strip()
    since = request.args.get("since")
    until = request.args.get("until")
    severity = request.args.get("severity")
    event_type = request.args.get("event_type")
    events = _filter_events(state.get("events", []), q, since, until, severity, event_type, vmid, cluster_id)
    return {
        "cluster_id": cluster_id,
        "vmid": vmid,
        "host": manager.host,
        "events": events,
    }


def _get_events():
    state = _load_state()
    q = request.args.get("q", "").strip()
    since = request.args.get("since")
    until = request.args.get("until")
    severity = request.args.get("severity")
    event_type = request.args.get("event_type")
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("page_size", 25, type=int)
    events = _filter_events(state.get("events", []), q, since, until, severity, event_type)
    total = len(events)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "events": events[start:end],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size if total else 1,
    }


def _post_bookmark():
    body = request.get_json(silent=True) or {}
    event_id = (body.get("event_id") or "").strip()
    note = (body.get("note") or "").strip()
    if not event_id:
        return jsonify({"error": "event_id is required"}), 400
    state = _load_state()
    bkm = {
        "id": _new_id(),
        "event_id": event_id,
        "note": note,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    state["bookmarks"].append(bkm)
    _save_state(state)
    return {"bookmark": bkm}


def _get_bookmarks():
    return {"bookmarks": _load_state().get("bookmarks", [])}


def _post_delete_bookmark():
    body = request.get_json(silent=True) or {}
    bid = body.get("id")
    if not bid:
        return jsonify({"error": "id is required"}), 400
    state = _load_state()
    state["bookmarks"] = [b for b in state["bookmarks"] if b.get("id") != bid]
    _save_state(state)
    return {"deleted": bid}


def _post_import():
    body = request.get_json(silent=True) or {}
    events = body.get("events", [])
    if not isinstance(events, list):
        return jsonify({"error": "events must be a list"}), 400
    state = _load_state()
    imported = []
    for e in events:
        if not e.get("event_id"):
            continue
        imported.append({
            "id": _new_id(),
            "event_id": str(e.get("event_id")),
            "timestamp": e.get("timestamp") or datetime.now(timezone.utc).isoformat(),
            "message": (e.get("message") or "").strip(),
            "severity": e.get("severity", "info"),
            "event_type": e.get("event_type", "unknown"),
            "cluster_id": e.get("cluster_id", ""),
            "vmid": str(e.get("vmid") or ""),
            "tags": e.get("tags") or [],
        })
    state["events"].extend(imported)
    _save_state(state)
    return {"imported": len(imported)}


def _get_export():
    fmt = request.args.get("format", "json")
    state = _load_state()
    q = request.args.get("q", "").strip()
    events = _filter_events(state.get("events", []), q=q)
    if fmt == "csv":
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["event_id", "timestamp", "message", "severity", "event_type", "cluster_id", "vmid"])
        for e in events:
            writer.writerow([
                e.get("event_id"),
                e.get("timestamp"),
                e.get("message"),
                e.get("severity"),
                e.get("event_type"),
                e.get("cluster_id"),
                e.get("vmid"),
            ])
        return out.getvalue()
    return jsonify({"events": events})


def _get_heatmap():
    state = _load_state()
    counts = {}
    for e in state.get("events", []):
        ts = (e.get("timestamp") or "")[:13]  # hour bucket
        counts[ts] = counts.get(ts, 0) + 1
    return {"heatmap": counts}


def _get_ui():
    """Serve the Incident Timeline HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "timeline", _get_timeline)
    register_plugin_route(PLUGIN_ID, "events", _get_events)
    register_plugin_route(PLUGIN_ID, "bookmark", _post_bookmark)
    register_plugin_route(PLUGIN_ID, "bookmarks", _get_bookmarks)
    register_plugin_route(PLUGIN_ID, "bookmarks/delete", _post_delete_bookmark)
    register_plugin_route(PLUGIN_ID, "import", _post_import)
    register_plugin_route(PLUGIN_ID, "export", _get_export)
    register_plugin_route(PLUGIN_ID, "heatmap", _get_heatmap)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
