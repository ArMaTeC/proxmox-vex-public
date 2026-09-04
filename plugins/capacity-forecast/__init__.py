# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/capacity-forecast/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Capacity Forecaster - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Capacity Forecaster - full UI management backend.
Predict CPU, RAM, storage, and power needs from historical trends.
"""

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "capacity-forecast"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "state.json"

RESOURCES = ["cpu", "ram", "storage", "power"]


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
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except OSError as e:
        log.error("Failed to save state: %s", e)


def _new_id():
    return uuid.uuid4().hex[:12]


def _normalize_factors(factors):
    """Clamp scenario factors to sane numeric bounds, defaulting to 1.0."""
    out = {}
    for r in RESOURCES:
        v = factors.get(r) if isinstance(factors, dict) else 1
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = 1.0
        out[r] = round(max(0.0, min(100.0, v)), 2)
    return out


def _validate_cron(cron):
    """Basic cron validation: 5 fields of valid cron characters."""
    pattern = re.compile(r"^[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+$")
    return bool(pattern.match(cron.strip()))


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


def _now():
    return datetime.now(timezone.utc)


# Default sample data so the plugin is useful on first use.
DEFAULT_SCENARIOS = [
    {
        "scenario_id": "default-base",
        "name": "Base",
        "description": "Baseline forecast with no multipliers.",
        "factors": {"cpu": 1.0, "ram": 1.0, "storage": 1.0, "power": 1.0},
        "created_at": _now().isoformat(),
    },
    {
        "scenario_id": "default-growth",
        "name": "20% Growth",
        "description": "Moderate 20% growth across CPU, RAM and storage.",
        "factors": {"cpu": 1.2, "ram": 1.2, "storage": 1.2, "power": 1.1},
        "created_at": _now().isoformat(),
    },
    {
        "scenario_id": "default-stress",
        "name": "Stress Test",
        "description": "High-load scenario with a 50% CPU/RAM increase.",
        "factors": {"cpu": 1.5, "ram": 1.5, "storage": 1.0, "power": 1.3},
        "created_at": _now().isoformat(),
    },
]

DEFAULT_SCHEDULES = [
    {"id": "default-cpu-02", "cron": "0 2 * * *", "resource": "cpu", "created_at": _now().isoformat()},
    {"id": "default-ram-03", "cron": "0 3 * * *", "resource": "ram", "created_at": _now().isoformat()},
    {"id": "default-storage-04", "cron": "0 4 * * *", "resource": "storage", "created_at": _now().isoformat()},
    {"id": "default-power-05", "cron": "0 5 * * *", "resource": "power", "created_at": _now().isoformat()},
]


def _ensure_defaults():
    """Seed state with sample scenarios and schedules on first run."""
    state = _load_state()
    if state.get("_seeded"):
        return
    state["_seeded"] = True
    if "scenarios" not in state:
        state["scenarios"] = list(DEFAULT_SCENARIOS)
    if "schedules" not in state:
        state["schedules"] = list(DEFAULT_SCHEDULES)
    _save_state(state)


def _get_clusters():
    from ProxmoxVEx.globals import cluster_managers

    try:
        clusters = []
        for cluster_id, manager in (cluster_managers or {}).items():
            config = getattr(manager, "config", None)
            name = getattr(config, "name", "") or cluster_id
            clusters.append({"id": cluster_id, "name": name})
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
        "scenario_count": len(state.get("scenarios", [])),
        "schedule_count": len(state.get("schedules", [])),
    }


def _generate_forecast(resource, window_days, cluster_id=""):
    from ProxmoxVEx.api.plugin_data_bridge import get_forecast_series

    return get_forecast_series(resource, window_days, cluster_id=cluster_id)


def _eta_from_forecast(forecast, threshold):
    """Return the interpolated day when the forecast first crosses threshold_pct."""
    if not forecast or threshold <= 0:
        return None
    prev = forecast[0]["value"]
    if prev >= threshold:
        return 0
    for i in range(1, len(forecast)):
        cur = forecast[i]["value"]
        if cur >= threshold:
            if cur == prev:
                return i
            return round(i - 1 + (threshold - prev) / (cur - prev), 2)
        prev = cur
    return None


def _get_forecast():
    cluster_id = request.args.get("cluster_id", "").strip()
    resource = request.args.get("resource", "cpu").strip()
    window = request.args.get("window", "7")
    try:
        window = int(window)
    except (TypeError, ValueError):
        window = 7
    if resource not in RESOURCES:
        return jsonify({"error": f"resource must be one of {RESOURCES}"}), 400
    try:
        threshold = request.args.get("threshold_pct", "90")
        try:
            threshold = float(threshold)
        except (TypeError, ValueError):
            threshold = 90.0
        threshold = max(0.0, min(100.0, threshold))
        forecast = _generate_forecast(resource, window, cluster_id=cluster_id)
        eta = _eta_from_forecast(forecast, threshold)
        if cluster_id:
            manager, err = _get_manager_or_error(cluster_id)
            if err:
                return err
            return {
                "cluster_id": cluster_id,
                "host": getattr(manager, "host", None),
                "resource": resource,
                "window_days": window,
                "threshold_pct": threshold,
                "eta_days": eta,
                "forecast": forecast,
            }
        return {
            "resource": resource,
            "window_days": window,
            "threshold_pct": threshold,
            "eta_days": eta,
            "forecast": forecast,
        }
    except Exception as e:
        return jsonify({"error": safe_error(e, "forecast failed")}), 500


def _scenarios():
    state = _load_state()
    if request.method == "GET":
        return {"scenarios": state.get("scenarios", [])}
    if request.method == "DELETE":
        sid = (request.get_json(silent=True) or {}).get("scenario_id") or request.args.get("id")
        if not sid:
            return jsonify({"error": "id is required"}), 400
        before = len(state.get("scenarios", []))
        state["scenarios"] = [s for s in state.get("scenarios", []) if s.get("scenario_id") != sid]
        _save_state(state)
        if len(state["scenarios"]) == before:
            return jsonify({"error": "scenario not found"}), 404
        return {"deleted": sid}

    body = request.get_json(silent=True) or {}
    eid = body.get("scenario_id") or ""
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    scenarios = state.setdefault("scenarios", [])
    for s in scenarios:
        if s.get("name") == name and s.get("scenario_id") != eid:
            return jsonify({"error": "name must be unique"}), 400
    clone_from = body.get("clone_from") or ""
    if clone_from and not eid:
        source = next((s for s in scenarios if s.get("scenario_id") == clone_from), None)
        if not source:
            return jsonify({"error": "source scenario not found"}), 404
        existing = {
            "scenario_id": _new_id(),
            "name": name,
            "factors": _normalize_factors(source.get("factors", {})),
            "description": source.get("description", ""),
            "created_at": _now().isoformat(),
        }
        scenarios.append(existing)
        _save_state(state)
        return {"scenario": existing, "saved": True}
    factors = _normalize_factors(body.get("factors") or {})
    description = (body.get("description") or "").strip()
    existing = next((s for s in scenarios if s.get("scenario_id") == eid), None)
    if existing:
        existing["name"] = name
        existing["factors"] = factors
        existing["description"] = description
        existing["updated_at"] = _now().isoformat()
    else:
        existing = {
            "scenario_id": _new_id(),
            "name": name,
            "factors": factors,
            "description": description,
            "created_at": _now().isoformat(),
        }
        scenarios.append(existing)
    _save_state(state)
    return {"scenario": existing, "saved": True}


def _export_scenarios():
    """Return all scenarios as JSON for export/download."""
    state = _load_state()
    return {"scenarios": state.get("scenarios", [])}


def _import_scenarios():
    """Import scenarios from a JSON payload, avoiding name collisions."""
    body = request.get_json(silent=True) or {}
    imported = body.get("scenarios")
    if not isinstance(imported, list):
        return jsonify({"error": "scenarios must be a list"}), 400
    state = _load_state()
    scenarios = state.setdefault("scenarios", [])
    existing_names = {s.get("name") for s in scenarios}
    added = []
    for s in imported:
        name = (s.get("name") or "").strip()
        if not name:
            continue
        original = name
        counter = 1
        while name in existing_names:
            name = f"{original} (import {counter})"
            counter += 1
        existing_names.add(name)
        new = {
            "scenario_id": _new_id(),
            "name": name,
            "factors": _normalize_factors(s.get("factors")),
            "description": (s.get("description") or "").strip(),
            "created_at": _now().isoformat(),
        }
        scenarios.append(new)
        added.append(new)
    _save_state(state)
    return {"imported": len(added), "scenarios": added}


def _apply_scenario():
    body = request.get_json(silent=True) or {}
    sid = body.get("scenario_id")
    resource = (body.get("resource") or "cpu").strip()
    window = body.get("window", 7)
    try:
        window = int(window)
    except (TypeError, ValueError):
        window = 7
    threshold = body.get("threshold_pct", "90")
    try:
        threshold = float(threshold)
    except (TypeError, ValueError):
        threshold = 90.0
    threshold = max(0.0, min(100.0, threshold))
    if not sid:
        return jsonify({"error": "scenario_id is required"}), 400
    if resource not in RESOURCES:
        return jsonify({"error": f"resource must be one of {RESOURCES}"}), 400
    state = _load_state()
    scenario = next((s for s in state.get("scenarios", []) if s.get("scenario_id") == sid), None)
    if not scenario:
        return jsonify({"error": "scenario not found"}), 404
    factor = (scenario.get("factors") or {}).get(resource, 1.0)
    cluster_id = body.get("cluster_id", "").strip() or request.args.get("cluster_id", "").strip()
    base = _generate_forecast(resource, window, cluster_id=cluster_id)
    adjusted = [
        {"timestamp": f["timestamp"], "value": round(f["value"] * factor, 2), "baseline": f["value"]} for f in base
    ]
    eta = _eta_from_forecast(adjusted, threshold)
    return {
        "scenario_id": sid,
        "resource": resource,
        "factor": factor,
        "threshold_pct": threshold,
        "eta_days": eta,
        "forecast": adjusted,
    }


def _compare_scenarios():
    body = request.get_json(silent=True) or {}
    a_id = body.get("a")
    b_id = body.get("b")
    resource = (body.get("resource") or "cpu").strip()
    if not a_id or not b_id:
        return jsonify({"error": "a and b scenario ids are required"}), 400
    if resource not in RESOURCES:
        return jsonify({"error": f"resource must be one of {RESOURCES}"}), 400
    state = _load_state()
    a = next((s for s in state.get("scenarios", []) if s.get("scenario_id") == a_id), None)
    b = next((s for s in state.get("scenarios", []) if s.get("scenario_id") == b_id), None)
    if not a or not b:
        return jsonify({"error": "scenario not found"}), 404
    fa = (a.get("factors") or {}).get(resource, 1.0)
    fb = (b.get("factors") or {}).get(resource, 1.0)
    cluster_id = body.get("cluster_id", "").strip() or request.args.get("cluster_id", "").strip()
    base = _generate_forecast(resource, 7, cluster_id=cluster_id)
    delta = [
        {
            "timestamp": f["timestamp"],
            "a": round(f["value"] * fa, 2),
            "b": round(f["value"] * fb, 2),
            "delta": round((f["value"] * fb) - (f["value"] * fa), 2),
        }
        for f in base
    ]
    return {"a": a_id, "b": b_id, "resource": resource, "comparison": delta}


def _get_trends():
    """Return live resource trend summaries from metrics history.

    The trends tab used to read from an empty `state["trends"]` array that
    was never populated, so it always showed "No trends". Compute the
    per-resource trend from the real metrics snapshot history instead.
    """
    try:
        from ProxmoxVEx.api.helpers import load_metrics_window

        rows = load_metrics_window(7)
        series = {r: [] for r in RESOURCES}
        for ts_unix, clusters in rows:
            for resource in RESOURCES:
                values = []
                for cd in clusters.values():
                    value = _history_pct_for_cluster(cd, resource)
                    if value is not None:
                        values.append(value)
                if values:
                    series[resource].append({
                        "timestamp": datetime.fromtimestamp(ts_unix, tz=timezone.utc).isoformat(),
                        "value": round(sum(values) / len(values), 2),
                    })

        trends = []
        for resource, samples in series.items():
            if not samples:
                continue
            last_value = samples[-1]["value"]

            # simple least-squares slope in percent per day
            trend = "flat"
            if len(samples) >= 3:
                xs = [int(datetime.fromisoformat(s["timestamp"]).timestamp()) for s in samples]
                ys = [s["value"] for s in samples]
                n = len(xs)
                mx = sum(xs) / n
                my = sum(ys) / n
                num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
                den = sum((x - mx) ** 2 for x in xs)
                if den:
                    slope = num / den
                    per_day = slope * 86400
                    if per_day > 0.1:
                        trend = "up"
                    elif per_day < -0.1:
                        trend = "down"

            trends.append({
                "resource": resource,
                "last_value": last_value,
                "trend": trend,
            })
        return {"trends": trends}
    except Exception as e:
        return jsonify({"error": safe_error(e, "trends failed")}), 500


def _schedules():
    state = _load_state()
    if request.method == "GET":
        return {"schedules": state.get("schedules", [])}
    if request.method == "DELETE":
        sid = (request.get_json(silent=True) or {}).get("id") or request.args.get("id")
        if not sid:
            return jsonify({"error": "id is required"}), 400
        before = len(state.get("schedules", []))
        state["schedules"] = [s for s in state.get("schedules", []) if s.get("id") != sid]
        _save_state(state)
        if len(state["schedules"]) == before:
            return jsonify({"error": "schedule not found"}), 404
        return {"deleted": sid}

    body = request.get_json(silent=True) or {}
    if request.method == "PUT":
        sid = body.get("id")
        enabled = body.get("enabled")
        if not sid or enabled is None:
            return jsonify({"error": "id and enabled are required"}), 400
        for s in state.get("schedules", []):
            if s.get("id") == sid:
                s["enabled"] = bool(enabled)
                _save_state(state)
                return {"schedule": s, "saved": True}
        return jsonify({"error": "schedule not found"}), 404

    cron = (body.get("cron") or "").strip()
    resource = (body.get("resource") or "").strip()
    if not cron or not resource:
        return jsonify({"error": "cron and resource are required"}), 400
    if resource not in RESOURCES:
        return jsonify({"error": f"resource must be one of {RESOURCES}"}), 400
    if not _validate_cron(cron):
        return jsonify({"error": "cron must be a valid 5-field cron expression"}), 400
    schedule = {
        "id": _new_id(),
        "cron": cron,
        "resource": resource,
        "enabled": bool(body.get("enabled", True)),
        "created_at": _now().isoformat(),
    }
    state.setdefault("schedules", []).append(schedule)
    _save_state(state)
    return {"schedule": schedule, "saved": True}


def _history_pct_for_cluster(cd, resource, node=None):
    """Extract a resource percent from one cluster's metrics snapshot."""
    if not cd:
        return None
    nodes = cd.get("nodes") or {}
    if node:
        n = nodes.get(node)
        if not n:
            return None
        if resource == "cpu" and "cpu" in n:
            return n["cpu"]
        if resource in ("ram", "memory") and "mem_percent" in n:
            return n["mem_percent"]
        return None
    totals = cd.get("totals") or {}
    if resource == "cpu":
        total = totals.get("cpu_total", 0)
        used = totals.get("cpu_used", 0)
        if total:
            return round(used / total * 100, 2)
    elif resource in ("ram", "memory"):
        total = totals.get("mem_total", 0)
        used = totals.get("mem_used", 0)
        if total:
            return round(used / total * 100, 2)
    elif resource == "storage":
        storage = cd.get("storage") or {}
        vals = [s.get("pct") for s in storage.values() if s.get("pct") is not None]
        return round(sum(vals) / len(vals), 2) if vals else None
    vals = []
    for n in nodes.values():
        if resource == "cpu" and "cpu" in n:
            vals.append(n["cpu"])
        elif resource in ("ram", "memory") and "mem_percent" in n:
            vals.append(n["mem_percent"])
    return round(sum(vals) / len(vals), 2) if vals else None


def _downsample(samples, step):
    """Average samples into step-second buckets for long time windows."""
    if step <= 0 or len(samples) < 2:
        return samples
    bucketed = []
    cur = []
    cur_start = None
    for s in samples:
        ts = int(datetime.fromisoformat(s["timestamp"]).timestamp())
        start = ts - (ts % step)
        if cur_start is None:
            cur_start = start
        if start != cur_start:
            if cur:
                bucketed.append({
                    "timestamp": datetime.fromtimestamp(cur_start, tz=timezone.utc).isoformat(),
                    "value": round(sum(x["value"] for x in cur) / len(cur), 2),
                })
            cur = []
            cur_start = start
        cur.append(s)
    if cur:
        bucketed.append({
            "timestamp": datetime.fromtimestamp(cur_start, tz=timezone.utc).isoformat(),
            "value": round(sum(x["value"] for x in cur) / len(cur), 2),
        })
    return bucketed


def _get_history():
    """Return historical utilisation samples from the metrics_history table."""
    cluster_id = request.args.get("cluster_id", "").strip()
    node = request.args.get("node", "").strip()
    resource = request.args.get("resource", "cpu").strip()
    days = request.args.get("days", "7")
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = 7
    days = max(1, min(days, 365))
    step = request.args.get("step", "0")
    try:
        step = int(step)
    except (TypeError, ValueError):
        step = 0
    step = max(0, min(step, 86400))
    if resource not in RESOURCES:
        return jsonify({"error": f"resource must be one of {RESOURCES}"}), 400
    try:
        from ProxmoxVEx.api.helpers import load_metrics_window

        rows = load_metrics_window(days)
        out = []
        for ts_unix, clusters in rows:
            if cluster_id:
                value = _history_pct_for_cluster(clusters.get(cluster_id), resource, node=node)
            else:
                vals = [
                    _history_pct_for_cluster(cd, resource, node=node)
                    for cd in clusters.values()
                    if _history_pct_for_cluster(cd, resource, node=node) is not None
                ]
                value = round(sum(vals) / len(vals), 2) if vals else None
            if value is not None:
                out.append({
                    "timestamp": datetime.fromtimestamp(ts_unix, tz=timezone.utc).isoformat(),
                    "value": value,
                })
        if step > 0:
            out = _downsample(out, step)
        note = ""
        if not out:
            note = "No snapshots in window yet — collector runs every 5 minutes"
        return {
            "cluster_id": cluster_id,
            "node": node,
            "resource": resource,
            "days": days,
            "step": step,
            "sample_count": len(out),
            "note": note,
            "samples": out,
        }
    except Exception as e:
        return jsonify({"error": safe_error(e, "history failed")}), 500


def _get_ui():
    """Serve the Capacity Forecaster HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "forecast", _get_forecast)
    register_plugin_route(PLUGIN_ID, "scenario", _scenarios)
    register_plugin_route(PLUGIN_ID, "scenario/export", _export_scenarios)
    register_plugin_route(PLUGIN_ID, "scenario/import", _import_scenarios)
    register_plugin_route(PLUGIN_ID, "apply", _apply_scenario)
    register_plugin_route(PLUGIN_ID, "compare", _compare_scenarios)
    register_plugin_route(PLUGIN_ID, "trends", _get_trends)
    register_plugin_route(PLUGIN_ID, "schedules", _schedules)
    register_plugin_route(PLUGIN_ID, "history", _get_history)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    _ensure_defaults()
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
