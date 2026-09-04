# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/ceph-dashboard/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Ceph Dashboard - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Ceph Dashboard - full UI management backend.
Reads Proxmox managed Ceph status, pools and OSDs.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugin_data_bridge import get_pools
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "ceph-dashboard"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
HISTORY_FILE = PLUGIN_DIR / "history.json"


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


def _get_first_node(manager):
    nodes = manager.api_request("GET", "/nodes") or []
    for n in nodes:
        if n.get("node"):
            return n["node"]
    return None


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
    except Exception as e:
        log.warning("clusters failed: %s", e)
    return {"clusters": []}


def _get_status():
    """Plugin status."""
    return {"plugin": PLUGIN_ID, "status": "running"}


def _get_cluster_status():
    """GET Ceph status from the first available node."""
    cluster_id = request.args.get("cluster_id", "").strip()
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        node = _get_first_node(manager)
        if not node:
            return jsonify({"error": "no nodes found"}), 404
        status = manager.api_request("GET", f"/nodes/{node}/ceph/status") or {}
        if not status:
            status = {}
        _record_history(cluster_id, status.get("health", "UNKNOWN"))
        return {"cluster_id": cluster_id, "node": node, "status": status}
    except Exception as e:
        log.exception("[cluster-status] failed")
        return jsonify({"error": safe_error(e, "Ceph status failed")}), 500


def _record_history(cluster_id, health):
    history = _load_json(HISTORY_FILE, [])
    history.append({"cluster_id": cluster_id, "health": health, "timestamp": datetime.now(timezone.utc).isoformat()})
    _save_json(HISTORY_FILE, history[-100:])


def _get_pools():
    """GET Ceph pools."""
    cluster_id = request.args.get("cluster_id", "").strip()
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        node = _get_first_node(manager)
        if not node:
            return jsonify({"error": "no nodes found"}), 404
        pools = manager.api_request("GET", f"/nodes/{node}/ceph/pools") or []
        if not pools:
            pools = get_pools(cluster_id).get("pools", [])

        return {"cluster_id": cluster_id, "pools": pools}
    except Exception as e:
        log.exception("[pools] failed")
        return jsonify({"error": safe_error(e, "Ceph pools failed")}), 500


def _get_osds():
    """GET Ceph OSDs."""
    cluster_id = request.args.get("cluster_id", "").strip()
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        node = _get_first_node(manager)
        if not node:
            return jsonify({"error": "no nodes found"}), 404
        osds = manager.api_request("GET", f"/nodes/{node}/ceph/osd") or []
        if not osds:
            osds = []
        return {"cluster_id": cluster_id, "osds": osds}
    except Exception as e:
        log.exception("[osds] failed")
        return jsonify({"error": safe_error(e, "Ceph OSDs failed")}), 500


def _get_history():
    cluster_id = request.args.get("cluster_id", "").strip()
    history = _load_json(HISTORY_FILE, [])
    if cluster_id:
        history = [h for h in history if h.get("cluster_id") == cluster_id]
    return {"history": history[-50:]}


def _get_health_checks():
    if request.method == "GET":
        return _load_json(PLUGIN_DIR / "checks.json", {"checks": []})
    body = request.get_json(silent=True) or {}
    enabled = body.get("enabled", [])
    _save_json(PLUGIN_DIR / "checks.json", {"checks": enabled})
    return {"saved": True, "checks": enabled}


def _get_ui():
    """Serve the Ceph Dashboard HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    """Register plugin routes."""
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "cluster-status", _get_cluster_status)
    register_plugin_route(PLUGIN_ID, "pools", _get_pools)
    register_plugin_route(PLUGIN_ID, "osds", _get_osds)
    register_plugin_route(PLUGIN_ID, "history", _get_history)
    register_plugin_route(PLUGIN_ID, "health-checks", _get_health_checks)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s registered", PLUGIN_ID)
