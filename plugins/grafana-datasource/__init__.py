# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/grafana-datasource/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Grafana Data Source - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Grafana Data Source - full UI management backend.
Provide a JSON data source and provisioning helper for Grafana dashboards.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "grafana-datasource"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "state.json"


def _load_state():
    if not STATE_FILE.exists():
        return {
            "datasource": None,
            "dashboards": [
                {"id": "health", "title": "Cluster Health"},
                {"id": "capacity", "title": "Capacity"},
            ],
        }
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, dict):
                return {"datasource": None, "dashboards": []}
            return data
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return {"datasource": None, "dashboards": []}


def _save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
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


def _get_status():
    return {"plugin": PLUGIN_ID, "status": "running", "version": "1.0.0"}


def _get_datasource():
    state = _load_state()
    ds = state.get("datasource") or {
        "name": PLUGIN_ID,
        "type": "grafana-json-datasource",
        "url": "/api/plugins/grafana-datasource/api",
    }
    return {"datasource": ds}


def _post_provision():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    state = _load_state()
    ds = {
        "name": name,
        "cluster_id": (body.get("cluster_id") or "").strip(),
        "type": (body.get("type") or "grafana-json-datasource").strip(),
        "url": (body.get("url") or "/api/plugins/grafana-datasource/api").strip(),
        "provisioned_at": datetime.now(timezone.utc).isoformat(),
    }
    state["datasource"] = ds
    _save_state(state)
    return {"datasource": ds}


def _post_unprovision():
    state = _load_state()
    state["datasource"] = None
    _save_state(state)
    return {"datasource": None}


def _post_test():
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    manager, err = _get_manager_or_error(cluster_id)
    if err:
        return err
    return {"connected": True, "host": manager.host}


def _get_query():
    return {
        "endpoints": [
            {"path": "/status", "method": "GET", "description": "Plugin status"},
            {"path": "/datasource", "method": "GET", "description": "Current data source"},
            {"path": "/dashboards", "method": "GET", "description": "Available dashboards"},
            {"path": "/test", "method": "POST", "description": "Test cluster connection"},
        ]
    }


def _get_dashboards():
    state = _load_state()
    dashboards = state.get(
        "dashboards",
        [
            {"id": "health", "title": "Cluster Health"},
            {"id": "capacity", "title": "Capacity"},
        ],
    )
    return {"dashboards": dashboards}


def _get_ui():
    """Serve the Grafana Data Source HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "datasource", _get_datasource)
    register_plugin_route(PLUGIN_ID, "provision", _post_provision)
    register_plugin_route(PLUGIN_ID, "unprovision", _post_unprovision)
    register_plugin_route(PLUGIN_ID, "test", _post_test)
    register_plugin_route(PLUGIN_ID, "query", _get_query)
    register_plugin_route(PLUGIN_ID, "dashboards", _get_dashboards)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
