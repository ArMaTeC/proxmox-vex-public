# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/cert-manager/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Certificate Manager - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Certificate Manager - full UI management backend.
Request, renew, deploy and track certificate expiry.
"""

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "cert-manager"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")

PLUGIN_DIR = Path(__file__).parent
CERTS_FILE = PLUGIN_DIR / "certs.json"
ALERT_FILE = PLUGIN_DIR / "alerts.json"


def _now_utc():
    return datetime.now(timezone.utc)


def _load_state():
    if not CERTS_FILE.exists():
        return []
    try:
        with open(CERTS_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return []


def _save_state(data):
    CERTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CERTS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _load_alerts():
    if not ALERT_FILE.exists():
        return {"threshold_days": 30, "target": ""}
    try:
        with open(ALERT_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"threshold_days": 30, "target": ""}


def _save_alerts(data):
    ALERT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(ALERT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _get_status():
    certs = _load_state()
    return {"plugin": PLUGIN_ID, "status": "running", "certs_count": len(certs)}


def _get_nodes():
    from ProxmoxVEx.globals import cluster_managers

    try:
        return {"nodes": [{"id": n, "name": n} for n in (cluster_managers or {})]}
    except Exception as e:
        log.warning("nodes failed: %s", e)
    return {"nodes": [{"id": "pve-node-01", "name": "pve-node-01"}]}


def _certs_handler():
    method = request.method
    certs = _load_state()

    if method == "GET":
        cert_id = request.args.get("id")
        if cert_id:
            for c in certs:
                if c.get("id") == cert_id:
                    return {"data": c}
            return jsonify({"error": "Certificate not found"}), 404

        status = (request.args.get("status") or "").strip().lower()
        sort = (request.args.get("sort") or "domain").strip()
        order = (request.args.get("order") or "asc").strip()
        data = certs
        if status:
            data = [c for c in data if c.get("status") == status]
        rev = order == "desc"
        data.sort(key=lambda c: str(c.get(sort, "")).lower(), reverse=rev)
        return {"data": data}

    if method == "POST":
        body = request.get_json(silent=True) or {}
        domain = (body.get("domain") or "").strip()
        if not domain:
            return jsonify({"error": "'domain' is required"}), 400
        sans = body.get("sans", [])
        if not isinstance(sans, list):
            try:
                sans = json.loads(sans)
                if not isinstance(sans, list):
                    raise ValueError
            except (TypeError, ValueError):
                return jsonify({"error": "'sans' must be a JSON array"}), 400
        cert = {
            "id": str(uuid.uuid4()),
            "domain": domain,
            "sans": sans,
            "description": (body.get("description") or "").strip(),
            "provider": (body.get("provider") or "acme-v2").strip(),
            "status": "pending",
            "created_at": _now_utc().isoformat().replace("+00:00", "Z"),
            "expires_at": (_now_utc() + timedelta(days=90)).isoformat().replace("+00:00", "Z"),
        }
        certs.append(cert)
        _save_state(certs)
        return {"data": cert}

    if method == "DELETE":
        cert_id = (request.get_json(silent=True) or {}).get("cert_id") or request.args.get("id")
        if not cert_id:
            return jsonify({"error": "'cert_id' is required"}), 400
        before = len(certs)
        certs = [c for c in certs if c.get("id") != cert_id]
        if len(certs) == before:
            return jsonify({"error": "Certificate not found"}), 404
        _save_state(certs)
        return {"deleted": cert_id}

    return jsonify({"error": "Method not allowed"}), 405


def _renew_handler():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405

    body = request.get_json(silent=True) or {}
    cert_id = body.get("cert_id")
    if not cert_id:
        return jsonify({"error": "'cert_id' is required"}), 400

    certs = _load_state()
    for c in certs:
        if c.get("id") == cert_id:
            c["status"] = "active"
            c["renewed_at"] = _now_utc().isoformat().replace("+00:00", "Z")
            c["expires_at"] = (_now_utc() + timedelta(days=90)).isoformat().replace("+00:00", "Z")
            _save_state(certs)
            return {"data": c}
    return jsonify({"error": "Certificate not found"}), 404


def _deploy_handler():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405

    body = request.get_json(silent=True) or {}
    cert_id = body.get("cert_id")
    node = (body.get("node") or "").strip()
    if not cert_id or not node:
        return jsonify({"error": "'cert_id' and 'node' are required"}), 400

    certs = _load_state()
    for c in certs:
        if c.get("id") == cert_id:
            c.setdefault("deployed_to", []).append(node)
            _save_state(certs)
            return {"deployed": True, "cert_id": cert_id, "node": node}
    return jsonify({"error": "Certificate not found"}), 404


def _expiry_handler():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    try:
        days = int(request.args.get("days", 30))
    except (TypeError, ValueError):
        return jsonify({"error": "'days' must be an integer"}), 400

    threshold = _now_utc() + timedelta(days=days)
    certs = _load_state()
    expiring = []
    for c in certs:
        try:
            expires = datetime.fromisoformat(c.get("expires_at", "").replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue
        if expires <= threshold:
            expiring.append(c)
    return {"data": expiring, "threshold_days": days}


def _alerts_handler():
    if request.method == "GET":
        return _load_alerts()
    body = request.get_json(silent=True) or {}
    try:
        days = int(body.get("threshold_days", 30))
    except (TypeError, ValueError):
        return jsonify({"error": "'threshold_days' must be an integer"}), 400
    alert = {"threshold_days": days, "target": (body.get("target") or "").strip()}
    _save_alerts(alert)
    return {"saved": True, "alert": alert}


def _get_ui():
    """Serve the Certificate Manager HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "nodes", _get_nodes)
    register_plugin_route(PLUGIN_ID, "certs", _certs_handler)
    register_plugin_route(PLUGIN_ID, "renew", _renew_handler)
    register_plugin_route(PLUGIN_ID, "deploy", _deploy_handler)
    register_plugin_route(PLUGIN_ID, "expiry", _expiry_handler)
    register_plugin_route(PLUGIN_ID, "alerts", _alerts_handler)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[%s] Plugin registered", PLUGIN_ID)
