# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/power-manager/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Power Manager - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Power Manager - full UI management backend.
Control PDU and IPMI power outlets for nodes and document power events.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "power-manager"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
DATA_FILE = PLUGIN_DIR / "state.json"

DEFAULT_STATE = {
    "outlets": [],
    "history": [],
}


def _load_state():
    if not DATA_FILE.exists():
        return json.loads(json.dumps(DEFAULT_STATE))
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("[%s] Failed to load state: %s", PLUGIN_ID, e)
        return json.loads(json.dumps(DEFAULT_STATE))
    for key, value in DEFAULT_STATE.items():
        if key not in data:
            data[key] = value
    return data


def _save_state(data):
    try:
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except OSError as e:
        log.error("[%s] Failed to save state: %s", PLUGIN_ID, e)


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


def _get_manager_or_error(cluster_id):
    if not cluster_id:
        return None, (jsonify({"error": "cluster_id is required"}), 400)
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return None, err
    return get_connected_manager(cluster_id)


def _get_status():
    state = _load_state()
    outlets = state.get("outlets", [])
    active = [o for o in outlets if o.get("state") == "on"]
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "total_outlets": len(outlets),
        "active_outlets": len(active),
        "routes": ["status", "clusters", "outlets", "on", "off", "cycle", "history"],
    }


def _get_outlets():
    cluster_id = request.args.get("cluster_id", "").strip()
    if cluster_id:
        manager, err = _get_manager_or_error(cluster_id)
        if err:
            return err
    state = _load_state()
    outlets = state.get("outlets", [])
    if not outlets:
        outlets = []
    sort = request.args.get("sort") or "node"
    order = (request.args.get("order") or "asc").strip()
    state_filter = (request.args.get("state") or "").strip()
    node_filter = (request.args.get("node") or "").strip()
    if state_filter:
        outlets = [o for o in outlets if o.get("state") == state_filter]
    if node_filter:
        outlets = [o for o in outlets if o.get("node") == node_filter]
    outlets.sort(key=lambda o: o.get(sort) or "", reverse=(order == "desc"))
    response = {"outlets": outlets}
    if cluster_id:
        response["cluster_id"] = cluster_id
        response["manager_host"] = manager.host
    return response


def _control(action):
    body = request.get_json(silent=True) or {}
    node = (body.get("node") or "").strip()
    outlet = (body.get("outlet") or "").strip()
    if not node or not outlet:
        return jsonify({"error": "node and outlet are required"}), 400
    try:
        state = _load_state()
        target = None
        for o in state["outlets"]:
            if o.get("node") == node and str(o.get("outlet")) == str(outlet):
                o["state"] = "on" if action in ("on", "cycle") else "off"
                o["last_action"] = action
                o["last_changed"] = datetime.now(timezone.utc).isoformat()
                target = o
                break
        if target is None:
            target = {
                "node": node,
                "outlet": outlet,
                "state": "on" if action in ("on", "cycle") else "off",
                "last_action": action,
                "last_changed": datetime.now(timezone.utc).isoformat(),
            }
            state["outlets"].append(target)
        record = {
            "node": node,
            "outlet": outlet,
            "action": action,
            "timestamp": target["last_changed"],
        }
        state["history"].insert(0, record)
        state["history"] = state["history"][:1000]
        _save_state(state)
        return {"outlet": target, "history": record}
    except Exception as e:
        log.exception("[%s/%s] %s error", node, outlet, action)
        return jsonify({"error": safe_error(e, f"{action} failed")}), 500


def _outlet_on():
    return _control("on")


def _outlet_off():
    return _control("off")


def _outlet_cycle():
    return _control("cycle")


def _get_history():
    state = _load_state()
    history = state.get("history", [])
    sort = request.args.get("sort") or "timestamp"
    order = (request.args.get("order") or "desc").strip()
    action_filter = (request.args.get("action") or "").strip()
    node_filter = (request.args.get("node") or "").strip()
    if action_filter:
        history = [h for h in history if h.get("action") == action_filter]
    if node_filter:
        history = [h for h in history if h.get("node") == node_filter]
    history.sort(key=lambda h: h.get(sort) or "", reverse=(order == "desc"))
    page = request.args.get("page", "1")
    per_page = request.args.get("per_page", "50")
    try:
        page = int(page)
        per_page = int(per_page)
    except ValueError:
        page, per_page = 1, 50
    start = (page - 1) * per_page
    end = start + per_page
    total = len(history)
    return {
        "history": history[start:end],
        "page": page,
        "per_page": per_page,
        "total": total,
    }


def _get_ui():
    """Serve the Power Manager HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "outlets", _get_outlets)
    register_plugin_route(PLUGIN_ID, "on", _outlet_on)
    register_plugin_route(PLUGIN_ID, "off", _outlet_off)
    register_plugin_route(PLUGIN_ID, "cycle", _outlet_cycle)
    register_plugin_route(PLUGIN_ID, "history", _get_history)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
