# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/alert-correlator/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Alert Correlator - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Alert Correlator - full UI management backend.
Deduplicate and correlate incoming alerts into incidents by cluster, node, or VM.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "alert-correlator"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "state.json"

DEFAULT_RULES = [
    {"rule_id": "cluster", "description": "Group by cluster", "key": "cluster_id"},
    {"rule_id": "node", "description": "Group by node", "key": "node"},
    {"rule_id": "vm", "description": "Group by VM", "key": "vmid"},
    {"rule_id": "alert_type", "description": "Group by alert type", "key": "alert"},
    {"rule_id": "severity", "description": "Group by severity", "key": "severity"},
    {"rule_id": "storage", "description": "Group by storage", "key": "storage"},
    {"rule_id": "service", "description": "Group by service", "key": "service"},
]


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


def _get_status():
    state = _load_state()
    incidents = state.get("incidents", [])
    open_count = sum(1 for i in incidents if i.get("status") != "resolved")
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "version": "1.1.0",
        "incident_count": len(incidents),
        "open_count": open_count,
        "rule_count": len(state.get("rules", DEFAULT_RULES)),
    }


def _get_clusters():
    from ProxmoxVEx.globals import cluster_managers

    try:
        clusters = []
        for cluster_id, manager in (cluster_managers or {}).items():
            config = getattr(manager, "config", None)
            display_name = getattr(config, "name", "") or cluster_id
            clusters.append({"id": cluster_id, "display_name": display_name})
        return {"data": clusters}
    except Exception as e:
        log.warning("clusters failed: %s", e)
    return {"data": []}


def _get_incidents():
    state = _load_state()
    return {"incidents": state.get("incidents", [])}


def _post_correlate():
    body = request.get_json(silent=True) or {}
    cluster_id = body.get("cluster_id", "").strip()
    alerts = body.get("alerts", [])
    if not isinstance(alerts, list) or not alerts:
        return jsonify({"error": "alerts must be a non-empty list"}), 400
    title = (body.get("title") or "").strip()
    incident = {
        "incident_id": _new_id(),
        "cluster_id": cluster_id,
        "title": title,
        "alerts": alerts,
        "status": "open",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    state = _load_state()
    state.setdefault("incidents", []).append(incident)
    _save_state(state)
    return {"incident": incident}


def _post_ack():
    body = request.get_json(silent=True) or {}
    incident_id = body.get("incident_id", "").strip()
    note = body.get("note", "")
    if not incident_id:
        return jsonify({"error": "incident_id is required"}), 400
    state = _load_state()
    for inc in state.get("incidents", []):
        if inc.get("incident_id") == incident_id:
            inc["acknowledged"] = True
            inc["acknowledged_at"] = datetime.now(timezone.utc).isoformat()
            if note:
                inc.setdefault("notes", []).append({"text": note, "at": datetime.now(timezone.utc).isoformat()})
            _save_state(state)
            return {"incident": inc}
    return jsonify({"error": "incident not found"}), 404


def _post_resolve():
    body = request.get_json(silent=True) or {}
    incident_id = body.get("incident_id", "").strip()
    if not incident_id:
        return jsonify({"error": "incident_id is required"}), 400
    state = _load_state()
    for inc in state.get("incidents", []):
        if inc.get("incident_id") == incident_id:
            inc["status"] = "resolved"
            inc["resolved_at"] = datetime.now(timezone.utc).isoformat()
            _save_state(state)
            return {"incident": inc}
    return jsonify({"error": "incident not found"}), 404


def _get_rules():
    state = _load_state()
    return {"rules": state.get("rules", DEFAULT_RULES)}


def _upsert_rule():
    body = request.get_json(silent=True) or {}
    rid = (body.get("rule_id") or "").strip()
    description = (body.get("description") or "").strip()
    key = (body.get("key") or "").strip()
    if not rid:
        return jsonify({"error": "rule_id is required"}), 400
    state = _load_state()
    rules = state.get("rules", list(DEFAULT_RULES))
    existing = next((r for r in rules if r["rule_id"] == rid), None)
    if existing and body.get("id") != rid:
        return jsonify({"error": "rule_id must be unique"}), 400
    rule = {"rule_id": rid, "description": description, "key": key}
    if existing:
        for idx, r in enumerate(rules):
            if r["rule_id"] == rid:
                rules[idx] = rule
                break
    else:
        rules.append(rule)
    state["rules"] = rules
    _save_state(state)
    return {"rule": rule, "saved": True}


def _delete_rule():
    rid = (request.get_json(silent=True) or {}).get("rule_id") or request.args.get("rule_id")
    if not rid:
        return jsonify({"error": "rule_id is required"}), 400
    state = _load_state()
    rules = state.get("rules", [])
    state["rules"] = [r for r in rules if r["rule_id"] != rid]
    _save_state(state)
    return {"deleted": rid}


def _get_ui():
    """Serve the Alert Correlator HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "incidents", _get_incidents)
    register_plugin_route(PLUGIN_ID, "correlate", _post_correlate)
    register_plugin_route(PLUGIN_ID, "ack", _post_ack)
    register_plugin_route(PLUGIN_ID, "resolve", _post_resolve)
    register_plugin_route(PLUGIN_ID, "rules", _get_rules)
    register_plugin_route(PLUGIN_ID, "rule", _upsert_rule)
    register_plugin_route(PLUGIN_ID, "rule_delete", _delete_rule)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
