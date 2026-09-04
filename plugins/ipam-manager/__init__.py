# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/ipam-manager/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: IPAM Manager - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
IPAM Manager - full UI management backend.
Manage subnets and IP reservations.
"""

import ipaddress
import json
import logging
import uuid
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "ipam-manager"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")

PLUGIN_DIR = Path(__file__).parent
SUBNETS_FILE = PLUGIN_DIR / "subnets.json"


def _load_state():
    if not SUBNETS_FILE.exists():
        return []
    try:
        with open(SUBNETS_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return []


def _save_state(data):
    SUBNETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SUBNETS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _next_ip(network, reservations, specific=None):
    used = {r.get("ip") for r in reservations}
    if specific:
        ip = str(ipaddress.ip_address(specific))
        if ip in used:
            return None
        if ipaddress.ip_address(ip) in network:
            return ip
        return None
    for host in network.hosts():
        ip = str(host)
        if ip not in used:
            return ip
    return None


def _subnet_overlaps(cidr, exclude_id=None):
    try:
        network = ipaddress.ip_network(cidr, strict=False)
    except ValueError:
        return False
    for s in _load_state():
        if exclude_id and s.get("id") == exclude_id:
            continue
        try:
            other = ipaddress.ip_network(s["cidr"], strict=False)
        except ValueError:
            continue
        if network.overlaps(other):
            return True
    return False


def _utilization(subnet):
    try:
        network = ipaddress.ip_network(subnet["cidr"], strict=False)
        total = sum(1 for _ in network.hosts())
        used = len(subnet.get("reservations", []))
        return {
            "total": total,
            "used": used,
            "free": max(0, total - used),
            "pct": round((used / total) * 100, 1) if total else 0,
        }
    except ValueError:
        return {"total": 0, "used": 0, "free": 0, "pct": 0}


def _get_status():
    subnets = _load_state()
    total_ips = sum(len(s.get("reservations", [])) for s in subnets)
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "subnets_count": len(subnets),
        "reservations_count": total_ips,
    }


def _subnets_handler():
    method = request.method
    subnets = _load_state()

    if method == "GET":
        subnet_id = request.args.get("id")
        if subnet_id:
            for s in subnets:
                if s.get("id") == subnet_id:
                    s["utilization"] = _utilization(s)
                    return {"data": s}
            return jsonify({"error": "Subnet not found"}), 404
        family = request.args.get("family")
        for s in subnets:
            s["utilization"] = _utilization(s)
        data = subnets
        if family in ("4", "6"):
            data = [s for s in data if ipaddress.ip_network(s["cidr"], strict=False).version == int(family)]
        sort = request.args.get("sort") or "name"
        order = (request.args.get("order") or "asc").strip()
        rev = order == "desc"
        data.sort(key=lambda s: str(s.get(sort, "")).lower(), reverse=rev)
        return {"data": data}

    if method == "POST":
        body = request.get_json(silent=True) or {}
        cidr = (body.get("cidr") or "").strip()
        name = (body.get("name") or "").strip()
        if not cidr or not name:
            return jsonify({"error": "'cidr' and 'name' are required"}), 400
        try:
            network = ipaddress.ip_network(cidr, strict=False)
        except ValueError as e:
            return jsonify({"error": f"Invalid CIDR: {e}"}), 400
        gateway = (body.get("gateway") or "").strip()
        if gateway and ipaddress.ip_address(gateway) not in network:
            return jsonify({"error": "'gateway' must be within the subnet"}), 400
        if _subnet_overlaps(cidr):
            return jsonify({"error": "Subnet overlaps an existing subnet"}), 409
        subnet = {
            "id": str(uuid.uuid4()),
            "name": name,
            "cidr": cidr,
            "gateway": gateway,
            "network": str(network),
            "reservations": [],
        }
        subnets.append(subnet)
        _save_state(subnets)
        subnet["utilization"] = _utilization(subnet)
        return {"data": subnet}

    if method == "PUT":
        body = request.get_json(silent=True) or {}
        subnet_id = body.get("id")
        if not subnet_id:
            return jsonify({"error": "'id' is required"}), 400
        for s in subnets:
            if s.get("id") == subnet_id:
                name = (body.get("name") or s.get("name")).strip()
                gateway = (body.get("gateway") or s.get("gateway")).strip()
                cidr = (body.get("cidr") or s.get("cidr")).strip()
                try:
                    network = ipaddress.ip_network(cidr, strict=False)
                except ValueError as e:
                    return jsonify({"error": f"Invalid CIDR: {e}"}), 400
                if gateway and ipaddress.ip_address(gateway) not in network:
                    return jsonify({"error": "'gateway' must be within the subnet"}), 400
                if cidr != s.get("cidr") and _subnet_overlaps(cidr, exclude_id=subnet_id):
                    return jsonify({"error": "Subnet overlaps an existing subnet"}), 409
                s["name"] = name
                s["gateway"] = gateway
                s["cidr"] = cidr
                s["network"] = str(network)
                _save_state(subnets)
                s["utilization"] = _utilization(s)
                return {"data": s}
        return jsonify({"error": "Subnet not found"}), 404

    if method == "DELETE":
        subnet_id = request.args.get("id") or (request.get_json(silent=True) or {}).get("id")
        if not subnet_id:
            return jsonify({"error": "'id' is required"}), 400
        for idx, s in enumerate(subnets):
            if s.get("id") == subnet_id:
                if s.get("reservations"):
                    return jsonify({
                        "error": "Subnet has reservations",
                        "reservations_count": len(s["reservations"]),
                    }), 409
                subnets.pop(idx)
                _save_state(subnets)
                return {"deleted": subnet_id}
        return jsonify({"error": "Subnet not found"}), 404

    return jsonify({"error": "Method not allowed"}), 405


def _ips_handler():
    method = request.method
    if method == "GET":
        subnet_id = request.args.get("subnet_id")
        subnets = _load_state()
        result = []
        for s in subnets:
            if not subnet_id or s.get("id") == subnet_id:
                result.extend([{"subnet_id": s["id"], **r} for r in s.get("reservations", [])])
        return {"data": result}

    if method == "POST":
        body = request.get_json(silent=True) or {}
        action = (body.get("action") or "").strip().lower()
        if action not in ("reserve", "release"):
            return jsonify({"error": "'action' must be 'reserve' or 'release'"}), 400

        subnets = _load_state()

        if action == "reserve":
            subnet_id = body.get("subnet_id")
            if not subnet_id:
                return jsonify({"error": "'subnet_id' is required"}), 400
            for s in subnets:
                if s.get("id") == subnet_id:
                    try:
                        network = ipaddress.ip_network(s["cidr"], strict=False)
                    except ValueError:
                        return jsonify({"error": "Subnet CIDR is invalid"}), 500
                    specific = (body.get("ip") or "").strip()
                    ip = _next_ip(network, s.get("reservations", []), specific or None)
                    if not ip:
                        return jsonify({"error": "No free IPs in subnet"}), 409
                    reservation = {
                        "id": str(uuid.uuid4()),
                        "ip": ip,
                        "label": (body.get("label") or "").strip(),
                        "mac": (body.get("mac") or "").strip(),
                        "status": "reserved",
                    }
                    s.setdefault("reservations", []).append(reservation)
                    _save_state(subnets)
                    return {"data": reservation}
            return jsonify({"error": "Subnet not found"}), 404

        # release
        ip_id = body.get("ip_id") or body.get("id")
        ip = body.get("ip")
        for s in subnets:
            for idx, r in enumerate(s.get("reservations", [])):
                if (ip_id and r.get("id") == ip_id) or (ip and r.get("ip") == ip):
                    s["reservations"].pop(idx)
                    _save_state(subnets)
                    return {"released": r}
        return jsonify({"error": "Reservation not found"}), 404

    return jsonify({"error": "Method not allowed"}), 405


def _get_ui():
    """Serve the IPAM Manager HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "subnets", _subnets_handler)
    register_plugin_route(PLUGIN_ID, "ips", _ips_handler)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[%s] Plugin registered", PLUGIN_ID)
