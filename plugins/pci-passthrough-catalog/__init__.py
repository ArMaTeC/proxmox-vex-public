# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/pci-passthrough-catalog/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: PCI Passthrough Catalog - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
PCI Passthrough Catalog - full UI management backend.
Scan and simulate PCI passthrough assignments.
"""

import json
import logging
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugin_data_bridge import get_nodes
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "pci-passthrough-catalog"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
ASSIGN_FILE = PLUGIN_DIR / "assignments.json"


def _load_json(path, default):
    if not path.exists():
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return default


def _save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except OSError as e:
        log.error("save %s: %s", path, e)


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
    devices = _load_json(PLUGIN_DIR / "last_scan.json", {}).get("devices", [])
    assignments = _load_json(ASSIGN_FILE, [])
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "version": "1.0.0",
        "total_devices": len(devices),
        "assigned_devices": len(assignments),
        "routes": ["status", "clusters", "scan", "assign", "release", "assignments", "device"],
    }


def _get_manager(cluster_id):
    if not cluster_id:
        return None, (jsonify({"error": "cluster_id is required"}), 400)
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return None, err
    return get_connected_manager(cluster_id)


def _scan():
    cluster_id = request.args.get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    manager, err = _get_manager(cluster_id)
    if err:
        return err
    devices = []
    try:
        nodes = manager.api_request("GET", "/cluster/resources?type=node") or []
    except Exception as e:
        log.error("%s", safe_error(e, "node list failed"))
        nodes = get_nodes(cluster_id).get("nodes", [])

    if not nodes:
        nodes = get_nodes(cluster_id).get("nodes", [])

    for n in nodes:
        node = n.get("node")
        if not node:
            continue
        try:
            pci = manager.api_request("GET", f"/nodes/{node}/hardware/pci") or []
        except Exception as e:
            log.error("%s", safe_error(e, f"pci scan on {node} failed"))
            pci = []
        for dev in pci:
            devices.append({
                "node": node,
                "device_id": dev.get("id", ""),
                "name": dev.get("name", ""),
                "description": dev.get("description", ""),
                "iommugroup": dev.get("iommugroup"),
                "driver": dev.get("driver", ""),
                "type": dev.get("type", "pci"),
            })
    if not devices:
        devices = []
    _save_json(PLUGIN_DIR / "last_scan.json", {"cluster_id": cluster_id, "devices": devices})
    sort = request.args.get("sort") or "device_id"
    order = (request.args.get("order") or "asc").strip()
    node_filter = (request.args.get("node") or "").strip()
    search = (request.args.get("q") or "").strip().lower()
    if node_filter:
        devices = [d for d in devices if d.get("node") == node_filter]
    if search:
        devices = [
            d
            for d in devices
            if search in (d.get("name") or "").lower() or search in (d.get("device_id") or "").lower()
        ]
    devices.sort(key=lambda d: d.get(sort) or "", reverse=(order == "desc"))
    return {"cluster_id": cluster_id, "devices": devices}


def _device_detail():
    device_id = (request.args.get("device_id") or "").strip()
    node = (request.args.get("node") or "").strip()
    if not device_id:
        return jsonify({"error": "device_id is required"}), 400
    scan = _load_json(PLUGIN_DIR / "last_scan.json", {})
    for d in scan.get("devices", []):
        if d.get("device_id") == device_id and (not node or d.get("node") == node):
            return d
    return jsonify({"error": "device not found"}), 404


def _assign():
    data = request.get_json(silent=True) or {}
    cluster_id = data.get("cluster_id")
    vmid = data.get("vmid")
    device_id = data.get("device_id")
    node = data.get("node", "")
    if not all([vmid, device_id]):
        return jsonify({"error": "vmid and device_id are required"}), 400
    assignments = _load_json(ASSIGN_FILE, [])
    if any(a.get("device_id") == device_id and a.get("node") == node for a in assignments):
        return jsonify({"error": "device already assigned"}), 409
    assignments.append({
        "cluster_id": cluster_id,
        "vmid": vmid,
        "device_id": device_id,
        "node": node,
        "assigned_at": "2026-08-09T00:00:00",
    })
    _save_json(ASSIGN_FILE, assignments)
    return {"assigned": True, "vmid": vmid, "device_id": device_id}


def _release():
    data = request.get_json(silent=True) or {}
    vmid = data.get("vmid")
    device_id = data.get("device_id")
    node = data.get("node", "")
    if not all([vmid, device_id]):
        return jsonify({"error": "vmid and device_id are required"}), 400
    assignments = _load_json(ASSIGN_FILE, [])
    before = len(assignments)
    assignments = [
        a
        for a in assignments
        if not (a.get("vmid") == vmid and a.get("device_id") == device_id and a.get("node") == node)
    ]
    _save_json(ASSIGN_FILE, assignments)
    if len(assignments) == before:
        return jsonify({"error": "assignment not found"}), 404
    return {"released": True, "vmid": vmid, "device_id": device_id}


def _get_assignments():
    assignments = _load_json(ASSIGN_FILE, [])
    vmid = (request.args.get("vmid") or "").strip()
    node = (request.args.get("node") or "").strip()
    cluster_id = (request.args.get("cluster_id") or "").strip()
    if vmid:
        assignments = [a for a in assignments if a.get("vmid") == vmid]
    if node:
        assignments = [a for a in assignments if a.get("node") == node]
    if cluster_id:
        assignments = [a for a in assignments if a.get("cluster_id") == cluster_id]
    return {"assignments": assignments}


def _get_ui():
    """Serve the PCI Passthrough Catalog HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "scan", _scan)
    register_plugin_route(PLUGIN_ID, "device", _device_detail)
    register_plugin_route(PLUGIN_ID, "assign", _assign)
    register_plugin_route(PLUGIN_ID, "release", _release)
    register_plugin_route(PLUGIN_ID, "assignments", _get_assignments)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s registered", PLUGIN_ID)
