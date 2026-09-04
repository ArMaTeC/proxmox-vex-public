# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/carbon-footprint/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Carbon Footprint - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Carbon Footprint - full UI management backend.
Estimate power consumption and carbon emissions by cluster and tenant.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import has_app_context, jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "carbon-footprint"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
DATA_FILE = PLUGIN_DIR / "state.json"

DEFAULT_STATE = {
    "factor": 0.4,
    "estimates": [],
    "trends": [],
}

# Simple power model used for the live cluster carbon estimate.
# Values are intentionally conservative defaults that can be refined later.
_POWER_MODEL = {
    "node_idle_w": 80.0,
    "cpu_w_per_core": 10.0,
    "mem_w_per_gb": 0.3,
    "pue": 1.5,
}

PRESETS = [
    {"name": "Global average", "value": 0.4},
    {"name": "EU average", "value": 0.25},
    {"name": "US average", "value": 0.38},
    {"name": "Renewable", "value": 0.05},
]


def _load_state():
    if not DATA_FILE.exists():
        return json.loads(json.dumps(DEFAULT_STATE))
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
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
    except Exception as e:
        log.error("[%s] Failed to save state: %s", PLUGIN_ID, e)


def _get_manager_or_error(cluster_id):
    if not cluster_id:
        return None, ({"error": "cluster_id is required"}, 400)
    if not has_app_context():
        return None, None
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return None, err
    return get_connected_manager(cluster_id)


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
    state = _load_state()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "version": "1.1.0",
        "routes": ["status", "estimate", "live", "clusters", "factor", "trends", "estimates", "presets"],
        "estimate_count": len(state.get("estimates", [])),
    }


def _do_estimate(cluster_id, hours, kw):
    manager, err = _get_manager_or_error(cluster_id)
    if err:
        return err
    if hours <= 0:
        return jsonify({"error": "hours must be a positive number"}), 400
    if kw < 0:
        return jsonify({"error": "kw must be a non-negative number"}), 400
    state = _load_state()
    factor = state.get("factor", 0.4)
    energy = kw * hours
    co2 = energy * factor
    return {
        "cluster_id": cluster_id,
        "manager_host": getattr(manager, "host", None),
        "hours": hours,
        "average_kw": kw,
        "energy_kwh": round(energy, 4),
        "factor": factor,
        "co2_kg": round(co2, 4),
    }


def _live_estimate(manager, hours, cluster_id):
    """Build a live power and CO2 estimate from current cluster resources."""
    if not manager:
        return jsonify({"error": "cluster not connected"}), 503
    if hours <= 0:
        return jsonify({"error": "hours must be a positive number"}), 400
    nodes = list(getattr(manager, "nodes", {}) or {})
    vms = manager.get_vm_resources(max_age=15) if callable(getattr(manager, "get_vm_resources", None)) else []
    running = [v for v in vms if v.get("status") == "running"]
    node_set = set(nodes) | {v.get("node") for v in running}

    node_idle_w = _POWER_MODEL["node_idle_w"] * len(node_set)
    cpu_w = 0.0
    mem_w = 0.0
    for v in running:
        maxcpu = float(v.get("maxcpu", 0) or 0)
        cpu_percent = float(v.get("cpu_percent", 0) or 0)
        cpu_w += (cpu_percent / 100.0) * maxcpu * _POWER_MODEL["cpu_w_per_core"]
        maxmem = int(v.get("maxmem", 0) or 0)
        mem_w += (maxmem / (1024**3)) * _POWER_MODEL["mem_w_per_gb"]

    base_w = node_idle_w + cpu_w + mem_w
    total_w = base_w * _POWER_MODEL["pue"]
    kw = total_w / 1000.0
    state = _load_state()
    factor = state.get("factor", 0.4)
    energy = kw * hours
    co2 = energy * factor

    return {
        "cluster_id": cluster_id,
        "manager_host": getattr(manager, "host", None),
        "hours": hours,
        "average_kw": round(kw, 4),
        "energy_kwh": round(energy, 4),
        "factor": factor,
        "co2_kg": round(co2, 4),
        "power_w": round(total_w, 2),
        "breakdown": {
            "nodes": len(node_set),
            "running_vms": len(running),
            "node_idle_w": round(node_idle_w, 2),
            "cpu_w": round(cpu_w, 2),
            "mem_w": round(mem_w, 2),
            "pue": _POWER_MODEL["pue"],
        },
    }


def _do_live_estimate(cluster_id, hours):
    manager, err = _get_manager_or_error(cluster_id)
    if err:
        return err
    return _live_estimate(manager, hours, cluster_id)


def _get_estimate():
    cluster_id = request.args.get("cluster_id", "").strip()
    try:
        hours = float(request.args.get("hours", "1"))
    except (TypeError, ValueError):
        return jsonify({"error": "hours must be a positive number"}), 400
    try:
        kw = float(request.args.get("kw", "1.0"))
    except (TypeError, ValueError):
        return jsonify({"error": "kw must be a non-negative number"}), 400
    try:
        return _do_estimate(cluster_id, hours, kw)
    except Exception as e:
        log.exception("[%s] estimate error", cluster_id)
        return jsonify({"error": safe_error(e, "Estimate failed")}), 500


def _get_live_estimate():
    cluster_id = request.args.get("cluster_id", "").strip()
    try:
        hours = float(request.args.get("hours", "24"))
    except (TypeError, ValueError):
        return jsonify({"error": "hours must be a positive number"}), 400
    try:
        return _do_live_estimate(cluster_id, hours)
    except Exception as e:
        log.exception("[%s] live estimate error", cluster_id)
        return jsonify({"error": safe_error(e, "Live estimate failed")}), 500


def _estimates():
    state = _load_state()
    if request.method == "GET":
        data = state.get("estimates", [])
        cluster = request.args.get("cluster", "").strip().lower()
        sort = request.args.get("sort", "created_at")
        order = request.args.get("order", "desc")
        if cluster:
            data = [e for e in data if e.get("cluster_id", "").lower() == cluster]
        rev = order == "desc"
        if sort == "created_at":
            data.sort(key=lambda e: e.get("created_at") or "", reverse=rev)
        else:
            data.sort(key=lambda e: str(e.get(sort, "")).lower(), reverse=rev)
        return {"estimates": data}

    if request.method == "DELETE":
        eid = (request.get_json(silent=True) or {}).get("id") or request.args.get("id")
        if not eid:
            return jsonify({"error": "id is required"}), 400
        before = len(state.get("estimates", []))
        state["estimates"] = [e for e in state.get("estimates", []) if e.get("id") != eid]
        _save_state(state)
        if len(state["estimates"]) == before:
            return jsonify({"error": "estimate not found"}), 404
        return {"deleted": eid}

    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or request.args.get("cluster_id", "")).strip()
    hours = body.get("hours")
    kw = body.get("kw")
    try:
        hours = float(hours)
        kw = float(kw)
    except (TypeError, ValueError):
        return jsonify({"error": "hours and kw must be numbers"}), 400
    est = _do_estimate(cluster_id, hours, kw)
    if isinstance(est, tuple):
        return est
    est["id"] = str(uuid.uuid4())
    est["created_at"] = datetime.now(timezone.utc).isoformat()
    state.setdefault("estimates", []).append(est)
    _save_state(state)
    return {"estimate": est, "saved": True}


def _set_factor():
    if request.method == "GET":
        state = _load_state()
        return {"factor": state.get("factor", 0.4), "presets": PRESETS}
    body = request.get_json(silent=True) or {}
    if "factor" not in body:
        return jsonify({"error": "factor is required"}), 400
    try:
        factor = float(body["factor"])
        if factor < 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "factor must be a non-negative number"}), 400
    state = _load_state()
    state["factor"] = factor
    _save_state(state)
    return {"factor": factor}


def _get_trends():
    cluster_id = request.args.get("cluster_id", "").strip()
    state = _load_state()
    trends = state.get("trends", [])
    if cluster_id:
        trends = [t for t in trends if t.get("cluster_id") == cluster_id]
    return {"trends": trends}


def _get_ui():
    """Serve the Carbon Footprint HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "estimate", _get_estimate)
    register_plugin_route(PLUGIN_ID, "live", _get_live_estimate)
    register_plugin_route(PLUGIN_ID, "estimates", _estimates)
    register_plugin_route(PLUGIN_ID, "factor", _set_factor)
    register_plugin_route(PLUGIN_ID, "presets", lambda: {"presets": PRESETS})
    register_plugin_route(PLUGIN_ID, "trends", _get_trends)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
