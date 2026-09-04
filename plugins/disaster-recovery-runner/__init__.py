# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/disaster-recovery-runner/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Disaster Recovery Runner - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Disaster Recovery Runner - full UI management backend.
Execute and report on disaster recovery drills: failover, verify, failback.
"""

import copy
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "disaster-recovery-runner"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "state.json"

STEP_CATALOG = ["failover", "verify", "failback", "network-isolate", "custom"]


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_state():
    if not STATE_FILE.exists():
        return {"scenarios": [], "runs": []}
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        data = {}
    for key in ("scenarios", "runs"):
        data.setdefault(key, [])
    return data


def _save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except OSError as e:
        log.error("Failed to save state: %s", e)


def _new_id():
    return uuid.uuid4().hex[:12]


def _get_status():
    state = _load_state()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "scenarios_count": len(state.get("scenarios", [])),
        "runs_count": len(state.get("runs", [])),
    }


def _get_catalog():
    return {"steps": STEP_CATALOG}


def _normalize_steps(raw):
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass
    raise ValueError("steps must be a JSON array")


def _filter_scenarios(scenarios, name):
    if not name:
        return scenarios
    return [s for s in scenarios if name.lower() in s.get("name", "").lower()]


def _get_scenarios():
    state = _load_state()
    scenarios = state.get("scenarios", [])
    name = (request.args.get("name") or "").strip()
    scenarios = _filter_scenarios(scenarios, name)
    sort = (request.args.get("sort") or "created_at").strip()
    order = (request.args.get("order") or "desc").strip()
    rev = order == "desc"
    scenarios.sort(
        key=lambda s: float(s.get(sort, 0)) if isinstance(s.get(sort), (int, float)) else str(s.get(sort, "")).lower(),
        reverse=rev,
    )
    return {"scenarios": scenarios}


def _post_scenario():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    try:
        steps = _normalize_steps(body.get("steps"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    state = _load_state()
    scenarios = state.setdefault("scenarios", [])
    scenario = {
        "scenario_id": _new_id(),
        "name": name,
        "steps": steps,
        "created_at": _now(),
    }
    scenarios.append(scenario)
    _save_state(state)
    return {"scenario": scenario}


def _put_scenario():
    body = request.get_json(silent=True) or {}
    scenario_id = (body.get("scenario_id") or "").strip()
    if not scenario_id:
        return jsonify({"error": "scenario_id is required"}), 400
    try:
        steps = _normalize_steps(body.get("steps"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    state = _load_state()
    for s in state.get("scenarios", []):
        if s.get("scenario_id") == scenario_id:
            s["name"] = (body.get("name") or s["name"]).strip()
            s["steps"] = steps if body.get("steps") is not None else s["steps"]
            _save_state(state)
            return {"scenario": s}
    return jsonify({"error": "scenario not found"}), 404


def _post_duplicate():
    body = request.get_json(silent=True) or {}
    scenario_id = (body.get("scenario_id") or "").strip()
    if not scenario_id:
        return jsonify({"error": "scenario_id is required"}), 400
    state = _load_state()
    for s in state.get("scenarios", []):
        if s.get("scenario_id") == scenario_id:
            dup = copy.deepcopy(s)
            dup["scenario_id"] = _new_id()
            dup["name"] = f"{s['name']} (copy)"
            dup["created_at"] = _now()
            state["scenarios"].append(dup)
            _save_state(state)
            return {"scenario": dup}
    return jsonify({"error": "scenario not found"}), 404


def _delete_scenario():
    scenario_id = (request.args.get("scenario_id") or "").strip()
    if not scenario_id:
        return jsonify({"error": "scenario_id is required"}), 400
    state = _load_state()
    before = len(state.get("scenarios", []))
    state["scenarios"] = [s for s in state.get("scenarios", []) if s.get("scenario_id") != scenario_id]
    if len(state["scenarios"]) == before:
        return jsonify({"error": "scenario not found"}), 404
    _save_state(state)
    return {"deleted": scenario_id}


def _post_run():
    body = request.get_json(silent=True) or {}
    scenario_id = (body.get("scenario_id") or "").strip()
    if not scenario_id:
        return jsonify({"error": "scenario_id is required"}), 400
    state = _load_state()
    for s in state.get("scenarios", []):
        if s.get("scenario_id") == scenario_id:
            run = {
                "run_id": _new_id(),
                "scenario_id": scenario_id,
                "scenario_name": s.get("name"),
                "status": "running",
                "started_at": _now(),
                "steps": [
                    {"name": step.get("name", step) if isinstance(step, dict) else step, "status": "pending"}
                    for step in (s.get("steps") or [])
                ],
            }
            state.setdefault("runs", []).append(run)
            _save_state(state)
            return {"run": run}
    return jsonify({"error": "scenario not found"}), 404


def _get_result():
    run_id = (request.args.get("run_id") or "").strip() or (request.args.get("id") or "").strip()
    if not run_id:
        return jsonify({"error": "run_id or id is required"}), 400
    state = _load_state()
    for r in state.get("runs", []):
        if r.get("run_id") == run_id:
            return {"result": r}
    return jsonify({"error": "run not found"}), 404


def _get_ui():
    """Serve the Disaster Recovery Runner HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "catalog", _get_catalog)
    register_plugin_route(PLUGIN_ID, "scenarios", _get_scenarios)
    register_plugin_route(PLUGIN_ID, "scenario", _post_scenario)
    register_plugin_route(PLUGIN_ID, "scenario-edit", _put_scenario)
    register_plugin_route(PLUGIN_ID, "scenario-duplicate", _post_duplicate)
    register_plugin_route(PLUGIN_ID, "scenario-delete", _delete_scenario)
    register_plugin_route(PLUGIN_ID, "run", _post_run)
    register_plugin_route(PLUGIN_ID, "result", _get_result)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
