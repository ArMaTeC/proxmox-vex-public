# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/health-dashboard/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Cluster Health Dashboard - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Cluster Health Dashboard - full UI management backend.
Roll up cluster, node, storage, and VM health into a single scoreboard view.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugin_data_bridge import get_nodes, get_storage
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "health-dashboard"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "state.json"

HEALTH_LEVELS = ["healthy", "warning", "critical"]


def _load_state():
    if not STATE_FILE.exists():
        _seed_state()
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return {"trends": []}


def _save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except OSError as e:
        log.error("Failed to save state: %s", e)


def _seed_state():
    _save_state({"trends": []})


def _new_id():
    return uuid.uuid4().hex[:12]


def _pct(value, maximum):
    try:
        return round((float(value) / float(maximum)) * 100, 2) if maximum else 0.0
    except Exception:
        return 0.0


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
        "trend_points": len(state.get("trends", [])),
    }


def _get_cluster_list():
    from ProxmoxVEx.globals import cluster_managers

    try:
        clusters = []
        for cluster_id, manager in (cluster_managers or {}).items():
            config = getattr(manager, "config", None)
            name = getattr(config, "name", "") or cluster_id
            clusters.append({"id": cluster_id, "name": name})
        return {"clusters": clusters}
    except Exception:
        return {"clusters": []}


def _score_to_status(score):
    if score >= 90:
        return "healthy"
    if score >= 70:
        return "warning"
    return "critical"


def _get_health():
    cluster_id = (request.args.get("cluster_id") or "").strip()
    try:
        if cluster_id:
            manager, err = _get_manager_or_error(cluster_id)
            if err:
                return err
            raw_nodes = get_nodes(cluster_id).get("nodes", [])
            raw_storage = get_storage(cluster_id).get("storage", [])
            node_scores = [
                round((100 - _pct(n.get("cpu"), 1.0) + 100 - _pct(n.get("mem"), n.get("maxmem"))) / 2, 2)
                for n in raw_nodes
            ]
            storage_scores = [100 - _pct(s.get("used"), s.get("total")) for s in raw_storage]
            all_scores = node_scores + storage_scores
            score = round(sum(all_scores) / len(all_scores), 2) if all_scores else 90
            status = _score_to_status(score)
            return {"cluster_id": cluster_id, "host": manager.host, "score": score, "status": status}
        return {"score": 90, "status": "healthy"}
    except Exception as e:
        return jsonify({"error": safe_error(e, "health check failed")}), 500


def _get_clusters():
    cluster_id = (request.args.get("id") or request.args.get("cluster_id") or "").strip()
    if not cluster_id:
        return jsonify({"error": "id or cluster_id is required"}), 400
    manager, err = _get_manager_or_error(cluster_id)
    if err:
        return err
    raw_nodes = get_nodes(cluster_id).get("nodes", [])
    raw_storage = get_storage(cluster_id).get("storage", [])
    nodes = [
        {
            "node_id": n.get("name") or _new_id(),
            "name": n.get("name") or "unknown",
            "cpu_health": _score_to_status(100 - _pct(n.get("cpu"), 1.0)),
            "memory_health": _score_to_status(100 - _pct(n.get("mem"), n.get("maxmem"))),
            "disk_health": "ok",
            "network_health": "ok",
            "status": n.get("status") or "unknown",
        }
        for n in raw_nodes
    ]
    storage = [
        {
            "storage_id": s.get("id") or _new_id(),
            "name": s.get("name") or "unknown",
            "capacity_pct": _pct(s.get("used"), s.get("total")),
            "latency_ms": 0,
            "health": _score_to_status(100 - _pct(s.get("used"), s.get("total"))),
            "iops": 0,
        }
        for s in raw_storage
    ]
    # aggregate worst-case health for the cluster scoreboard
    cpu_health = max(
        (n["cpu_health"] for n in nodes),
        default="healthy",
        key=lambda h: HEALTH_LEVELS.index(h) if h in HEALTH_LEVELS else -1,
    )
    memory_health = max(
        (n["memory_health"] for n in nodes),
        default="healthy",
        key=lambda h: HEALTH_LEVELS.index(h) if h in HEALTH_LEVELS else -1,
    )
    storage_health = max(
        (s["health"] for s in storage),
        default="healthy",
        key=lambda h: HEALTH_LEVELS.index(h) if h in HEALTH_LEVELS else -1,
    )
    return {
        "cluster_id": cluster_id,
        "host": manager.host,
        "cpu_health": cpu_health,
        "memory_health": memory_health,
        "storage_health": storage_health,
        "network_health": "ok",
        "nodes": nodes,
        "storage": storage,
    }


def _get_nodes():
    cluster_id = (request.args.get("cluster_id") or "").strip()
    status = (request.args.get("status") or "").strip()
    sort = (request.args.get("sort") or "name").strip()
    order = (request.args.get("order") or "asc").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    raw = get_nodes(cluster_id).get("nodes", [])
    nodes = [
        {
            "name": n.get("name") or "unknown",
            "cpu_pct": _pct(n.get("cpu"), 1.0),
            "mem_pct": _pct(n.get("mem"), n.get("maxmem")),
            "disk_pct": 0,
            "status": (n.get("status") or "").lower() == "online" and "online" or "offline",
        }
        for n in raw
    ]
    if status:
        nodes = [n for n in nodes if n["status"] == status]
    rev = order == "desc"
    nodes.sort(key=lambda n: n.get(sort, ""), reverse=rev)
    return {"cluster_id": cluster_id, "nodes": nodes}


def _get_storage():
    cluster_id = (request.args.get("cluster_id") or "").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    raw = get_storage(cluster_id).get("storage", [])
    storage = [
        {
            "name": s.get("name") or s.get("id") or "unknown",
            "capacity_pct": _pct(s.get("used"), s.get("total")),
            "latency_ms": 0,
            "iops": 0,
            "health": _score_to_status(100 - _pct(s.get("used"), s.get("total"))),
        }
        for s in raw
    ]
    return {"cluster_id": cluster_id, "storage": storage}


def _compute_cluster_health(cd):
    """Derive a composite health score from a single cluster metrics snapshot."""
    if not cd:
        return None
    totals = cd.get("totals") or {}
    cpu_pct = _pct(totals.get("cpu_used", 0), totals.get("cpu_total", 0))
    mem_pct = _pct(totals.get("mem_used", 0), totals.get("mem_total", 0))
    score = round((100 - cpu_pct + 100 - mem_pct) / 2, 2)
    return {"score": score, "status": _score_to_status(score)}


def _get_trends():
    """Return historical cluster health scores from real metrics snapshots."""
    cluster_id = (request.args.get("cluster_id") or "").strip()
    rng = (request.args.get("range") or "30d").strip()
    seconds = {"1h": 3600, "24h": 86400, "7d": 604800, "30d": 2592000}.get(rng, 2592000)
    days = max(1, seconds // 86400)
    now = datetime.now(timezone.utc).timestamp()
    try:
        from ProxmoxVEx.api.helpers import load_metrics_window

        rows = load_metrics_window(days)
        trends = []
        for ts_unix, clusters in rows:
            if ts_unix < now - seconds:
                continue
            if cluster_id:
                h = _compute_cluster_health(clusters.get(cluster_id))
            else:
                vals = [h["score"] for h in (_compute_cluster_health(cd) for cd in clusters.values()) if h is not None]
                if not vals:
                    continue
                score = round(sum(vals) / len(vals), 2)
                h = {"score": score, "status": _score_to_status(score)}
            if h is not None:
                trends.append({
                    "timestamp": datetime.fromtimestamp(ts_unix, tz=timezone.utc).isoformat(),
                    "score": h["score"],
                    "status": h["status"],
                })
        return {"range": rng, "cluster_id": cluster_id, "trends": trends}
    except Exception as e:
        return jsonify({"error": safe_error(e, "trends failed")}), 500


def _get_ui():
    """Serve the Cluster Health Dashboard HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_cluster_list)
    register_plugin_route(PLUGIN_ID, "health", _get_health)
    register_plugin_route(PLUGIN_ID, "cluster", _get_clusters)
    register_plugin_route(PLUGIN_ID, "nodes", _get_nodes)
    register_plugin_route(PLUGIN_ID, "storage", _get_storage)
    register_plugin_route(PLUGIN_ID, "trends", _get_trends)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
