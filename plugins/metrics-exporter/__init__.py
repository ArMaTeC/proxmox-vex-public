# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/metrics-exporter/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Prometheus Metrics Exporter - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Prometheus Metrics Exporter - full UI management backend.
Manage scrape targets, configuration, and preview Prometheus-compatible metrics.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "metrics-exporter"
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
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "targets_count": len(state.get("targets", [])),
    }


def _get_metrics():
    from ProxmoxVEx.api.plugin_data_bridge import get_prometheus_sample

    cluster_id = request.args.get("cluster_id", "").strip()
    prefix = (request.args.get("prefix") or "").strip()
    try:
        if cluster_id:
            manager, err = _get_manager_or_error(cluster_id)
            if err:
                return err
        sample = get_prometheus_sample(cluster_id, prefix=prefix)
        return {
            "format": "prometheus",
            "sample": sample,
            "cluster_id": cluster_id,
        }
    except Exception as e:
        return jsonify({"error": safe_error(e, "metrics failed")}), 500


def _get_targets():
    state = _load_state()
    targets = state.get("targets", [])
    enabled = request.args.get("enabled")
    cluster = (request.args.get("cluster_id") or "").strip()
    sort = request.args.get("sort") or "target_id"
    order = (request.args.get("order") or "asc").strip()
    if enabled is not None:
        enabled_flag = enabled.lower() == "true"
        targets = [t for t in targets if bool(t.get("enabled", True)) == enabled_flag]
    if cluster:
        targets = [t for t in targets if t.get("cluster_id") == cluster]
    rev = order == "desc"
    targets.sort(key=lambda t: t.get(sort) or "", reverse=rev)
    return {"targets": targets}


def _post_scrape():
    body = request.get_json(silent=True) or {}
    target_id = (body.get("target_id") or "").strip()
    cluster_id = (body.get("cluster_id") or "").strip()
    if not target_id:
        return jsonify({"error": "target_id is required"}), 400
    state = _load_state()
    targets = state.setdefault("targets", [])
    existing = next((t for t in targets if t.get("target_id") == target_id), None)
    if existing:
        existing["enabled"] = bool(body.get("enabled", existing.get("enabled", True)))
        if cluster_id:
            existing["cluster_id"] = cluster_id
        existing["updated_at"] = datetime.now(timezone.utc).isoformat()
        _save_state(state)
        return {"target": existing, "total": len(targets)}
    target = {
        "target_id": target_id,
        "cluster_id": cluster_id,
        "enabled": bool(body.get("enabled", True)),
        "added_at": datetime.now(timezone.utc).isoformat(),
    }
    targets.append(target)
    _save_state(state)
    return {"target": target, "total": len(targets)}


def _toggle_target():
    body = request.get_json(silent=True) or {}
    target_id = (body.get("target_id") or "").strip()
    if not target_id:
        return jsonify({"error": "target_id is required"}), 400
    state = _load_state()
    targets = state.setdefault("targets", [])
    for t in targets:
        if t.get("target_id") == target_id:
            t["enabled"] = bool(body.get("enabled", not t.get("enabled", True)))
            t["updated_at"] = datetime.now(timezone.utc).isoformat()
            _save_state(state)
            return {"target": t}
    return jsonify({"error": "target not found"}), 404


def _delete_target():
    target_id = (request.args.get("id") or "").strip() or (request.get_json(silent=True) or {}).get("target_id", "")
    if not target_id:
        return jsonify({"error": "target_id is required"}), 400
    state = _load_state()
    before = len(state.get("targets", []))
    state["targets"] = [t for t in state.get("targets", []) if t.get("target_id") != target_id]
    _save_state(state)
    if len(state["targets"]) == before:
        return jsonify({"error": "target not found"}), 404
    return {"deleted": target_id}


def _config():
    state = _load_state()
    if request.method == "GET":
        return state.get(
            "exporter_config",
            {
                "interval": 60,
                "format": "prometheus",
                "path": "/metrics",
            },
        )
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        fmt = (body.get("format") or "prometheus").strip()
        if fmt not in ("prometheus", "influx", "json"):
            return jsonify({"error": "unsupported format"}), 400
        config = {
            "interval": int(body.get("interval", 60)),
            "format": fmt,
            "path": (body.get("path") or "/metrics").strip(),
        }
        state["exporter_config"] = config
        _save_state(state)
        return {"config": config}
    return jsonify({"error": "Method not allowed"}), 405


def _get_ui():
    """Serve the Prometheus Metrics Exporter HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "metrics", _get_metrics)
    register_plugin_route(PLUGIN_ID, "targets", _get_targets)
    register_plugin_route(PLUGIN_ID, "scrape", _post_scrape)
    register_plugin_route(PLUGIN_ID, "toggle", _toggle_target)
    register_plugin_route(PLUGIN_ID, "delete", _delete_target)
    register_plugin_route(PLUGIN_ID, "config", _config)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
