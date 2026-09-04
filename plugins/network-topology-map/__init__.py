# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/network-topology-map/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Network Topology Map - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Network Topology Map - full UI management backend.
Build, refresh, and inspect network topology graphs for clusters.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugin_data_bridge import get_nodes
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "network-topology-map"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")

PLUGIN_DIR = Path(__file__).parent
CACHE_FILE = PLUGIN_DIR / "topology_cache.json"


def _load_cache():
    if not CACHE_FILE.exists():
        return {"nodes": [], "edges": [], "updated_at": None}
    try:
        with open(CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load cache: %s", e)
        return {"nodes": [], "edges": [], "updated_at": None}


def _save_cache(data):
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _get_clusters():
    from ProxmoxVEx.globals import cluster_managers

    try:
        return {"clusters": [{"id": c, "name": c} for c in (cluster_managers or {})]}
    except Exception:
        return {"clusters": []}


def _build_graph(cluster_id, manager):
    host = manager.host
    raw_nodes = get_nodes(cluster_id).get("nodes", [])

    # The UI expects graph nodes to have id, type and label fields.
    nodes = []
    for n in raw_nodes:
        name = n.get("name") or "unknown"
        nodes.append({**n, "id": name, "type": "node", "label": name})

    edges = []
    return {
        "cluster_id": cluster_id,
        "cluster_node": host,
        "nodes": nodes,
        "edges": edges,
    }


def _get_status():
    cache = _load_cache()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "cached_nodes": len(cache.get("nodes", [])),
        "cached_edges": len(cache.get("edges", [])),
    }


def _map_handler():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    cluster_id = request.args.get("cluster_id", "").strip()
    if not cluster_id:
        return jsonify({"error": "'cluster_id' is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    manager, err = get_connected_manager(cluster_id)
    if err:
        return err
    try:
        graph = _build_graph(cluster_id, manager)
        return {"data": graph}
    except Exception as e:
        log.exception("[%s] Map error", cluster_id)
        return jsonify({"error": safe_error(e, "Map build failed")}), 500


def _nodes_handler():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    cache = _load_cache()
    node_type = (request.args.get("type") or "").strip()
    nodes = cache.get("nodes", [])
    if node_type:
        nodes = [n for n in nodes if n.get("type") == node_type]
    return {"data": nodes}


def _edges_handler():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    cache = _load_cache()
    edges = cache.get("edges", [])
    sort = request.args.get("sort") or "source"
    order = (request.args.get("order") or "asc").strip()
    edge_type = (request.args.get("type") or "").strip()
    if edge_type:
        edges = [e for e in edges if e.get("type") == edge_type]
    rev = order == "desc"
    edges.sort(key=lambda e: e.get(sort) or e.get("source") or "", reverse=rev)
    return {"data": edges}


def _refresh_handler():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    if not cluster_id:
        return jsonify({"error": "'cluster_id' is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    manager, err = get_connected_manager(cluster_id)
    if err:
        return err
    try:
        graph = _build_graph(cluster_id, manager)
        cache = {
            "id": str(uuid.uuid4()),
            "cluster_id": cluster_id,
            "nodes": graph["nodes"],
            "edges": graph["edges"],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        _save_cache(cache)
        return {"data": cache}
    except Exception as e:
        log.exception("[%s] Refresh error", cluster_id)
        return jsonify({"error": safe_error(e, "Refresh failed")}), 500


def _get_ui():
    """Serve the Network Topology Map HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "map", _map_handler)
    register_plugin_route(PLUGIN_ID, "nodes", _nodes_handler)
    register_plugin_route(PLUGIN_ID, "edges", _edges_handler)
    register_plugin_route(PLUGIN_ID, "refresh", _refresh_handler)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[%s] Plugin registered", PLUGIN_ID)
