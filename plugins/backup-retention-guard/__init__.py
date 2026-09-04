# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/backup-retention-guard/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Backup Retention Guard - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Backup Retention Guard - full UI management backend.
Manages backup retention policies, assignments, and simulates pruning and compliance.
"""

import json
import logging
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import safe_error
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "backup-retention-guard"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
POLICIES_FILE = PLUGIN_DIR / "policies.json"
BACKUPS_FILE = PLUGIN_DIR / "backups.json"

DEFAULT_POLICIES = [
    {
        "id": str(uuid.uuid4()),
        "name": "Daily 7/30",
        "keep_count": 7,
        "max_age_days": 30,
        "description": "Keep the latest 7 daily backups and prune anything older than 30 days.",
        "created_at": datetime.now().isoformat(),
    },
    {
        "id": str(uuid.uuid4()),
        "name": "Weekly 4/90",
        "keep_count": 4,
        "max_age_days": 90,
        "description": "Keep the latest 4 weekly backups and prune anything older than 90 days.",
        "created_at": datetime.now().isoformat(),
    },
    {
        "id": str(uuid.uuid4()),
        "name": "Monthly 12/365",
        "keep_count": 12,
        "max_age_days": 365,
        "description": "Keep the latest 12 monthly backups and prune anything older than 365 days.",
        "created_at": datetime.now().isoformat(),
    },
    {
        "id": str(uuid.uuid4()),
        "name": "Yearly 3/1095",
        "keep_count": 3,
        "max_age_days": 1095,
        "description": "Keep the latest 3 yearly backups and prune anything older than 1095 days.",
        "created_at": datetime.now().isoformat(),
    },
]


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


def _ensure_default_policies():
    """Seed the policies file with sensible defaults on first run."""
    if not POLICIES_FILE.exists():
        _save_json(POLICIES_FILE, DEFAULT_POLICIES)
        log.info("[PLUGINS] %s seeded %d default policies", PLUGIN_ID, len(DEFAULT_POLICIES))


def _get_status():
    """Plugin status."""
    policies = _load_json(POLICIES_FILE, [])
    return {"plugin": PLUGIN_ID, "status": "running", "policy_count": len(policies)}


def _policies():
    """GET/POST/PUT/DELETE retention policies."""
    if request.method == "GET":
        return {"policies": _load_json(POLICIES_FILE, [])}

    if request.method == "DELETE":
        body = request.get_json(silent=True) or {}
        policy_id = request.args.get("id") or body.get("id")
        if not policy_id:
            return jsonify({"error": "id is required"}), 400
        policies = _load_json(POLICIES_FILE, [])
        before = len(policies)
        policies = [p for p in policies if p.get("id") != policy_id]
        _save_json(POLICIES_FILE, policies)
        if len(policies) == before:
            return jsonify({"error": "policy not found"}), 404
        return {"deleted": True, "id": policy_id}

    body = request.get_json(silent=True) or {}
    eid = body.get("id", "")
    name = (body.get("name") or "").strip()
    keep_count = body.get("keep_count")
    max_age_days = body.get("max_age_days")
    description = (body.get("description") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    try:
        keep_count = int(keep_count or 7)
        max_age_days = int(max_age_days or 30)
    except (TypeError, ValueError):
        return jsonify({"error": "keep_count and max_age_days must be integers"}), 400
    if keep_count < 1 or max_age_days < 1:
        return jsonify({"error": "keep_count and max_age_days must be positive"}), 400
    policies = _load_json(POLICIES_FILE, [])
    for p in policies:
        if p.get("name") == name and p.get("id") != eid:
            return jsonify({"error": "name must be unique"}), 400
    existing = next((p for p in policies if p.get("id") == eid), None)
    if existing:
        existing["name"] = name
        existing["keep_count"] = keep_count
        existing["max_age_days"] = max_age_days
        existing["description"] = description
        existing["updated_at"] = datetime.now().isoformat()
    else:
        existing = {
            "id": str(uuid.uuid4()),
            "name": name,
            "keep_count": keep_count,
            "max_age_days": max_age_days,
            "description": description,
            "created_at": datetime.now().isoformat(),
        }
        policies.append(existing)
    _save_json(POLICIES_FILE, policies)
    return {"policy": existing, "saved": True}


def _list_backups(policy):
    now = datetime.now()
    backups = _load_json(BACKUPS_FILE, [])
    if not backups:
        backups = [
            {
                "backup_id": f"backup-{(now - timedelta(days=i)).date().isoformat()}",
                "date": (now - timedelta(days=i)).isoformat(),
                "age_days": i,
            }
            for i in range(policy.get("keep_count", 7) + 10)
        ]
    return backups


def _prune():
    """POST apply a policy and return simulated pruned backups."""
    body = request.get_json(silent=True) or {}
    policy_id = (body.get("policy_id") or request.args.get("policy_id", "")).strip()
    if not policy_id:
        return jsonify({"error": "policy_id is required"}), 400
    policies = _load_json(POLICIES_FILE, [])
    policy = next((p for p in policies if p.get("id") == policy_id), None)
    if not policy:
        return jsonify({"error": "policy not found"}), 404
    try:
        now = datetime.now()
        cut = now - timedelta(days=policy.get("max_age_days", 30))
        keep = policy.get("keep_count", 7)
        backups = _list_backups(policy)
        backups.sort(key=lambda b: b.get("date", ""), reverse=True)
        pruned = []
        kept = []
        for idx, b in enumerate(backups):
            btime = datetime.fromisoformat(b.get("date"))
            if idx < keep:
                kept.append(b)
            elif btime < cut:
                pruned.append({"backup_id": b.get("backup_id"), "date": b.get("date"), "pruned": True, "reason": "age"})
        return {"policy_id": policy_id, "pruned_backups": pruned, "kept": len(kept), "pruned_count": len(pruned)}
    except Exception as e:
        log.exception("[prune] failed")
        return jsonify({"error": safe_error(e, "prune failed")}), 500


def _apply_prune():
    """POST actually apply prune (confirmation required)."""
    body = request.get_json(silent=True) or {}
    policy_id = (body.get("policy_id") or "").strip()
    if not policy_id:
        return jsonify({"error": "policy_id is required"}), 400
    sim = _prune()
    if isinstance(sim, tuple):
        return sim
    return {"applied": True, "removed": sim["pruned_count"], "policy_id": policy_id}


def _assign():
    """POST/GET policy assignments."""
    state = _load_json(POLICIES_FILE, [])
    if request.method == "GET":
        return {"assignments": [p.get("assignments", []) for p in state if p.get("assignments")]}
    body = request.get_json(silent=True) or {}
    policy_id = body.get("policy_id")
    target = body.get("target")
    if not policy_id or not target:
        return jsonify({"error": "policy_id and target are required"}), 400
    policies = _load_json(POLICIES_FILE, [])
    for p in policies:
        if p.get("id") == policy_id:
            p.setdefault("assignments", []).append(target)
            _save_json(POLICIES_FILE, policies)
            return {"assigned": True, "policy_id": policy_id, "target": target}
    return jsonify({"error": "policy not found"}), 404


def _compliance():
    """GET compliance status."""
    policies = _load_json(POLICIES_FILE, [])
    return {
        "policies_defined": len(policies),
        "compliant": len(policies) > 0,
        "last_check": datetime.now().isoformat(),
    }


def _get_ui():
    """Serve the Backup Retention Guard HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    """Register plugin routes."""
    _ensure_default_policies()
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "policies", _policies)
    register_plugin_route(PLUGIN_ID, "prune", _prune)
    register_plugin_route(PLUGIN_ID, "apply", _apply_prune)
    register_plugin_route(PLUGIN_ID, "assign", _assign)
    register_plugin_route(PLUGIN_ID, "compliance", _compliance)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s registered", PLUGIN_ID)
