# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/sdn-controller/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: sdn-controller — ProxmoxVEx Plugin
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
sdn-controller — ProxmoxVEx Plugin
Manage SDN zones and VNets and apply them to clusters.
"""

import json
import logging
import uuid
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "sdn-controller"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")

PLUGIN_DIR = Path(__file__).parent
ZONES_FILE = PLUGIN_DIR / "zones.json"


def _default_zones():
    return [
        {
            "id": str(uuid.uuid4()),
            "name": "production",
            "type": "evpn",
            "vnets": [
                {
                    "id": str(uuid.uuid4()),
                    "name": "vnet-prod",
                    "tag": 100,
                    "subnet": "10.10.0.0/24",
                    "gateway": "10.10.0.1",
                    "dns": "10.10.0.1",
                    "dhcp_start": "10.10.0.10",
                    "dhcp_end": "10.10.0.200",
                    "mtu": 1500,
                }
            ],
        },
        {
            "id": str(uuid.uuid4()),
            "name": "development",
            "type": "vxlan",
            "vnets": [
                {
                    "id": str(uuid.uuid4()),
                    "name": "vnet-dev",
                    "tag": 200,
                    "subnet": "10.20.0.0/24",
                    "gateway": "10.20.0.1",
                    "dns": "10.20.0.1",
                    "dhcp_start": "10.20.0.10",
                    "dhcp_end": "10.20.0.200",
                    "mtu": 1500,
                }
            ],
        },
    ]


def _load_state():
    if not ZONES_FILE.exists():
        return _default_zones()
    try:
        with open(ZONES_FILE, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            return _default_zones()
        return data
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return _default_zones()


def _save_state(data):
    ZONES_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(ZONES_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


HISTORY_FILE = PLUGIN_DIR / "history.json"


def _load_history():
    if not HISTORY_FILE.exists():
        return []
    try:
        with open(HISTORY_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load history: %s", e)
        return []


def _save_history(data):
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _get_status():
    zones = _load_state()
    vnets = sum(len(z.get("vnets", [])) for z in zones)
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "zones_count": len(zones),
        "vnets_count": vnets,
    }


def _zones_handler():
    method = request.method
    zones = _load_state()

    if method == "GET":
        zone_id = request.args.get("id")
        if zone_id:
            for z in zones:
                if z.get("id") == zone_id:
                    return {"data": z}
            return jsonify({"error": "Zone not found"}), 404
        return {"data": zones}

    if method == "POST":
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        zone_type = (body.get("type") or "evpn").strip().lower()
        if not name:
            return jsonify({"error": "'name' is required"}), 400
        zone = {
            "id": str(uuid.uuid4()),
            "name": name,
            "type": zone_type,
            "vnets": [],
        }
        zones.append(zone)
        _save_state(zones)
        return {"data": zone}

    if method == "PUT":
        body = request.get_json(silent=True) or {}
        zone_id = body.get("id") or request.args.get("id")
        name = (body.get("name") or "").strip()
        description = (body.get("description") or "").strip()
        if not zone_id:
            return jsonify({"error": "'id' is required"}), 400
        for z in zones:
            if z.get("id") == zone_id:
                if name:
                    z["name"] = name
                if "description" in body:
                    z["description"] = description
                _save_state(zones)
                return {"data": z}
        return jsonify({"error": "Zone not found"}), 404

    if method == "DELETE":
        zone_id = request.args.get("id") or (request.get_json(silent=True) or {}).get("id")
        if not zone_id:
            return jsonify({"error": "'id' is required"}), 400
        for idx, z in enumerate(zones):
            if z.get("id") == zone_id:
                zones.pop(idx)
                _save_state(zones)
                return {"deleted": zone_id}
        return jsonify({"error": "Zone not found"}), 404

    return jsonify({"error": "Method not allowed"}), 405


def _vnets_handler():
    method = request.method
    zones = _load_state()

    if method == "GET":
        zone_id = request.args.get("zone_id")
        vnet_id = request.args.get("id")
        result = []
        for z in zones:
            if zone_id and z.get("id") != zone_id:
                continue
            for v in z.get("vnets", []):
                if not vnet_id or v.get("id") == vnet_id:
                    result.append({"zone_id": z["id"], **v})
        return {"data": result}

    if method == "POST":
        body = request.get_json(silent=True) or {}
        zone_id = body.get("zone_id")
        name = (body.get("name") or "").strip()
        tag = body.get("tag")
        if not zone_id or not name or tag is None:
            return jsonify({"error": "'zone_id', 'name' and 'tag' are required"}), 400
        try:
            tag = int(tag)
        except (TypeError, ValueError):
            return jsonify({"error": "'tag' must be an integer"}), 400
        for z in zones:
            if z.get("id") == zone_id:
                vnet = {
                    "id": str(uuid.uuid4()),
                    "name": name,
                    "tag": tag,
                    "subnet": (body.get("subnet") or "").strip(),
                }
                z.setdefault("vnets", []).append(vnet)
                _save_state(zones)
                return {"data": vnet}
        return jsonify({"error": "Zone not found"}), 404

    if method == "PUT":
        body = request.get_json(silent=True) or {}
        vnet_id = body.get("id") or request.args.get("id")
        if not vnet_id:
            return jsonify({"error": "'id' is required"}), 400
        for z in zones:
            for v in z.get("vnets", []):
                if v.get("id") == vnet_id:
                    v["name"] = (body.get("name") or v.get("name")).strip()
                    if body.get("tag") is not None:
                        try:
                            v["tag"] = int(body["tag"])
                        except (TypeError, ValueError):
                            return jsonify({"error": "'tag' must be an integer"}), 400
                    if "subnet" in body:
                        v["subnet"] = (body.get("subnet") or "").strip()
                    if "gateway" in body:
                        v["gateway"] = (body.get("gateway") or "").strip()
                    if "dns" in body:
                        v["dns"] = (body.get("dns") or "").strip()
                    if "dhcp_start" in body:
                        v["dhcp_start"] = (body.get("dhcp_start") or "").strip()
                    if "dhcp_end" in body:
                        v["dhcp_end"] = (body.get("dhcp_end") or "").strip()
                    if "mtu" in body:
                        v["mtu"] = int(body.get("mtu")) if body.get("mtu") is not None else v.get("mtu")
                    _save_state(zones)
                    return {"data": v}
        return jsonify({"error": "VNet not found"}), 404

    if method == "DELETE":
        body = request.get_json(silent=True) or {}
        vnet_id = request.args.get("id") or body.get("id")
        if not vnet_id:
            return jsonify({"error": "'id' is required"}), 400
        for z in zones:
            for idx, v in enumerate(z.get("vnets", [])):
                if v.get("id") == vnet_id:
                    z["vnets"].pop(idx)
                    _save_state(zones)
                    return {"deleted": vnet_id}
        return jsonify({"error": "VNet not found"}), 404

    return jsonify({"error": "Method not allowed"}), 405


def _apply_handler():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405

    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    if not cluster_id:
        return jsonify({"error": "'cluster_id' is required"}), 400

    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err

    manager, err = get_connected_manager(cluster_id)
    if err:
        return err

    zones = _load_state()
    return {
        "applied": True,
        "cluster_id": cluster_id,
        "cluster_node": manager.host,
        "zones_pushed": len(zones),
        "zones": zones,
        "message": f"SDN config applied to {manager.host}",
    }


def _get_clusters():
    from ProxmoxVEx.globals import cluster_managers

    return {
        "clusters": [
            {"id": cid, "name": cid} for cid in sorted(getattr(cluster_managers, "keys", lambda: cluster_managers)())
        ]
    }


def _post_dry_run():
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    if not cluster_id:
        return jsonify({"error": "'cluster_id' is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    zones = _load_state()
    return {
        "applied": False,
        "dry_run": True,
        "cluster_id": cluster_id,
        "zones_pushed": len(zones),
        "message": f"Dry run: would push {len(zones)} zones",
    }


def _get_apply_history():
    return {"history": _load_history()}


def _post_export():
    zones = _load_state()
    return {"zones": zones}


def _post_import():
    body = request.get_json(silent=True) or {}
    data = body.get("zones", [])
    if not isinstance(data, list):
        return jsonify({"error": "'zones' array required"}), 400
    state = _load_state()
    for z in data:
        z["id"] = str(uuid.uuid4())
        z.setdefault("vnets", [])
        state.append(z)
    _save_state(state)
    return {"imported": len(data), "zones": state}


def _get_ui():
    """Serve the SDN Controller HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "zones", _zones_handler)
    register_plugin_route(PLUGIN_ID, "vnets", _vnets_handler)
    register_plugin_route(PLUGIN_ID, "apply", _apply_handler)
    register_plugin_route(PLUGIN_ID, "dry-run", _post_dry_run)
    register_plugin_route(PLUGIN_ID, "apply-history", _get_apply_history)
    register_plugin_route(PLUGIN_ID, "export", _post_export)
    register_plugin_route(PLUGIN_ID, "import", _post_import)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[%s] Plugin registered", PLUGIN_ID)
