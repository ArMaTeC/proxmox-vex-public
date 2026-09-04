# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vpn-access-portal/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: VPN Access Portal - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
VPN Access Portal - full UI management backend.
Manage VPN clients and generate configuration bundles.
"""

import io
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "vpn-access-portal"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")

PLUGIN_DIR = Path(__file__).parent
CLIENTS_FILE = PLUGIN_DIR / "clients.json"
STATE_FILE = PLUGIN_DIR / "state.json"

CIDR_RE = re.compile(r"^(\d{1,3}\.){3}\d{1,3}/\d{1,2}$")


def _now():
    return datetime.now(timezone.utc)


def _load_clients():
    if not CLIENTS_FILE.exists():
        return []
    try:
        with open(CLIENTS_FILE) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load clients: %s", e)
        return []


def _save_clients(data):
    CLIENTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CLIENTS_FILE, "w") as f:
        json.dump(data, f, indent=2)


def _load_state():
    if not STATE_FILE.exists():
        return {"sessions": [], "audit": [], "version": "1.1.0"}
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {"sessions": [], "audit": [], "version": "1.1.0"}


def _save_state(data):
    data["version"] = "1.1.0"
    data["updated_at"] = _now().isoformat()
    STATE_FILE.write_text(json.dumps(data, indent=2))


def _audit(action, target):
    state = _load_state()
    state.setdefault("audit", []).append({"action": action, "target": target, "at": _now().isoformat()})
    _save_state(state)


def _valid_cidrs(ips):
    if not isinstance(ips, list):
        return False
    for ip in ips:
        if not CIDR_RE.match(ip):
            return False
        parts = ip.split("/")
        octets = parts[0].split(".")
        for o in octets:
            if int(o) > 255:
                return False
        if int(parts[1]) > 32:
            return False
    return True


def _get_status():
    clients = _load_clients()
    state = _load_state()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "clients_count": len(clients),
        "sessions_count": len(state.get("sessions", [])),
        "audit_count": len(state.get("audit", [])),
    }


def _clients_handler():
    method = request.method
    clients = _load_clients()

    if method == "GET":
        client_id = request.args.get("id")
        if client_id:
            for c in clients:
                if c.get("id") == client_id:
                    return {"data": c}
            return jsonify({"error": "Client not found"}), 404
        return {"data": clients}

    if method == "POST":
        body = request.get_json(silent=True) or {}
        client_id = body.get("id")
        name = (body.get("name") or "").strip()
        client_type = (body.get("type") or "wireguard").strip().lower()
        if not name:
            return jsonify({"error": "'name' is required"}), 400
        if client_type not in ("wireguard", "openvpn"):
            return jsonify({"error": "'type' must be 'wireguard' or 'openvpn'"}), 400
        allowed_ips = body.get("allowed_ips", ["10.200.0.0/24"])
        if not _valid_cidrs(allowed_ips):
            return jsonify({"error": "allowed_ips must be a list of valid CIDRs"}), 400
        existing = next((c for c in clients if c.get("id") == client_id), None) if client_id else None
        if not existing:
            for c in clients:
                if c.get("name") == name and c.get("id") != client_id:
                    return jsonify({"error": "'name' must be unique"}), 400
        client = {
            "id": client_id or str(uuid.uuid4()),
            "name": name,
            "type": client_type,
            "enabled": bool(body.get("enabled", True)),
            "allowed_ips": allowed_ips,
            "description": body.get("description", ""),
            "email": body.get("email", ""),
            "expires_at": body.get("expires_at", ""),
            "created_at": existing.get("created_at") if existing else _now().isoformat(),
            "updated_at": _now().isoformat(),
        }
        if existing:
            for idx, c in enumerate(clients):
                if c.get("id") == client_id:
                    clients[idx] = client
                    break
            _audit("updated", name)
        else:
            clients.append(client)
            _audit("created", name)
        _save_clients(clients)
        return {"data": client, "saved": True}

    if method == "DELETE":
        client_id = request.args.get("id") or (request.get_json(silent=True) or {}).get("id")
        if not client_id:
            return jsonify({"error": "'id' is required"}), 400
        for idx, c in enumerate(clients):
            if c.get("id") == client_id:
                name = c.get("name", client_id)
                clients.pop(idx)
                _save_clients(clients)
                _audit("deleted", name)
                return {"deleted": client_id}
        return jsonify({"error": "Client not found"}), 404

    return jsonify({"error": "Method not allowed"}), 405


def _config_for_client(c):
    client_type = c.get("type", "wireguard")
    if client_type == "wireguard":
        return {
            "interface": {
                "private_key": "SIMULATED_PRIVATE_KEY",
                "address": "10.200.0.2/32",
                "dns": "1.1.1.1",
            },
            "peer": {
                "public_key": "SIMULATED_SERVER_PUBLIC_KEY",
                "allowed_ips": c.get("allowed_ips", ["0.0.0.0/0"]),
                "endpoint": "vpn.example.com:51820",
            },
            "raw": f"[Interface]\nPrivateKey = SIMULATED_PRIVATE_KEY\nAddress = 10.200.0.2/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = SIMULATED_SERVER_PUBLIC_KEY\nAllowedIPs = {','.join(c.get('allowed_ips', ['0.0.0.0/0']))}\nEndpoint = vpn.example.com:51820\n",
        }
    return {
        "ca": "SIMULATED_CA_CERT",
        "cert": "SIMULATED_CLIENT_CERT",
        "key": "SIMULATED_CLIENT_KEY",
        "remote": "vpn.example.com 1194 udp",
        "raw": "client\ndev tun\nproto udp\nremote vpn.example.com 1194\n<ca>\nSIMULATED_CA_CERT\n</ca>\n<cert>\nSIMULATED_CLIENT_CERT\n</cert>\n<key>\nSIMULATED_CLIENT_KEY\n</key>\n",
    }


def _config_handler():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    client_id = request.args.get("client_id")
    if not client_id:
        return jsonify({"error": "'client_id' is required"}), 400
    clients = _load_clients()
    for c in clients:
        if c.get("id") == client_id:
            if not c.get("enabled", True):
                return jsonify({"warning": "client is disabled"}), 200
            return {"data": {"client": c, "config": _config_for_client(c)}}
    return jsonify({"error": "Client not found"}), 404


def _download_handler():
    client_id = request.args.get("client_id")
    if not client_id:
        return jsonify({"error": "'client_id' is required"}), 400
    clients = _load_clients()
    for c in clients:
        if c.get("id") == client_id:
            cfg = _config_for_client(c)
            ext = ".conf" if c.get("type") == "wireguard" else ".ovpn"
            filename = f"{c.get('name')}{ext}"
            raw = cfg.get("raw", "")
            return send_file(
                io.BytesIO(raw.encode()), mimetype="text/plain", as_attachment=True, download_name=filename
            )
    return jsonify({"error": "Client not found"}), 404


def _sessions_handler():
    state = _load_state()
    sessions = state.get("sessions", []) or [
        {
            "client_id": "sim-1",
            "name": "Alice",
            "ip": "10.200.0.2",
            "bytes": 1234567,
            "connected_since": _now().isoformat(),
        },
    ]
    return {"data": sessions}


def _audit_handler():
    state = _load_state()
    return {"data": state.get("audit", [])[::-1]}


def _get_ui():
    """Serve the VPN Access Portal HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clients", _clients_handler)
    register_plugin_route(PLUGIN_ID, "config", _config_handler)
    register_plugin_route(PLUGIN_ID, "download", _download_handler)
    register_plugin_route(PLUGIN_ID, "sessions", _sessions_handler)
    register_plugin_route(PLUGIN_ID, "audit", _audit_handler)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[%s] Plugin registered", PLUGIN_ID)
