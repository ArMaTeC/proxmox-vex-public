# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/gpu-passthrough-catalog/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: GPU Passthrough Catalog - live GPU passthrough...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
GPU Passthrough Catalog - live GPU passthrough management backend.
Discovers GPU-class PCI devices on Proxmox VE nodes and applies real
hostpci configuration changes to QEMU VMs instead of only simulating them.
"""

import json
import logging
import re
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, parse_pve_error, safe_error
from ProxmoxVEx.api.plugin_data_bridge import get_nodes
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "gpu-passthrough-catalog"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "assignments.json"

# GPU class codes: VGA, 3D, display controllers, and HDMI/DisplayPort audio.
_GPU_CLASS_PREFIXES = ("03", "0403")
_GPU_NAME_KEYWORDS = ("nvidia", "amd", "radeon", "geforce", "tesla", "gpu", "vga")


def _load_state():
    if not STATE_FILE.exists():
        return {"assignments": []}
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return {"assignments": []}


def _save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except OSError as e:
        log.error("Failed to save state: %s", e)


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
    state = _load_state()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "assignments_count": len(state.get("assignments", [])),
    }


def _get_manager(cluster_id):
    if not cluster_id:
        return None, (jsonify({"error": "cluster_id is required"}), 400)
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return None, err
    return get_connected_manager(cluster_id)


def _normalise_pci_id(pci_id):
    """Strip the domain from a PCI ID so 0000:01:00.0 and 01:00.0 compare equal."""
    if not pci_id:
        return ""
    cleaned = str(pci_id).strip().lower()
    if re.match(r"^[0-9a-f]{4}:", cleaned):
        cleaned = cleaned[5:]
    return cleaned


def _is_gpu_device(dev):
    """Return True when a PCI device entry represents a GPU or its audio function."""
    name = (dev.get("vendor_name") or "") + " " + (dev.get("device_name") or "")
    desc = (dev.get("description") or "") + " " + (dev.get("name") or "")
    combined = f"{name} {desc}".lower()
    class_code = (dev.get("class") or "").lower().replace("0x", "")
    if class_code.startswith(_GPU_CLASS_PREFIXES):
        return True
    if "audio" in combined and "hdmi" not in combined and "displayport" not in combined:
        return False
    return any(k in combined for k in _GPU_NAME_KEYWORDS)


def _find_gpu_assignments(manager):
    """Read every QEMU VM config and map normalised PCI device IDs to VM info."""
    try:
        vms = manager.api_request("GET", "/cluster/resources?type=vm") or []
    except Exception as e:
        log.error(safe_error(e, "vm list failed"))
        return {}

    assignments = {}
    for vm in vms:
        if vm.get("type") != "qemu":
            continue
        node = vm.get("node")
        vmid = vm.get("vmid")
        if not node or not vmid:
            continue
        try:
            config = manager.api_request("GET", f"/nodes/{node}/qemu/{vmid}/config") or {}
        except Exception as e:
            log.debug("config fetch failed for %s/%s: %s", node, vmid, e)
            continue
        for key, value in config.items():
            if not key.startswith("hostpci") or not value:
                continue
            device_id = _normalise_pci_id(value.split(",", 1)[0])
            if device_id:
                assignments[device_id] = {"node": node, "vmid": vmid, "slot": key}
    return assignments


def _scan():
    cluster_id = request.args.get("cluster_id") or (request.get_json(silent=True) or {}).get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    manager, err = _get_manager(cluster_id)
    if err:
        return err

    try:
        nodes = manager.api_request("GET", "/cluster/resources?type=node") or []
    except Exception as e:
        log.error(safe_error(e, "node list failed"))
        nodes = get_nodes(cluster_id).get("nodes", [])

    if not nodes:
        nodes = get_nodes(cluster_id).get("nodes", [])

    pve_assignments = _find_gpu_assignments(manager)
    gpus = []
    for n in nodes:
        node = n.get("node") or n.get("name")
        if not node:
            continue
        try:
            pci = manager.api_request("GET", f"/nodes/{node}/hardware/pci") or []
        except Exception as e:
            log.error(safe_error(e, f"pci scan on {node} failed"))
            pci = []
        for dev in pci:
            if not _is_gpu_device(dev):
                continue
            device_id = dev.get("id", "")
            norm_id = _normalise_pci_id(device_id)
            assignment = pve_assignments.get(norm_id)
            if not assignment:
                assignment = _is_assigned(device_id, cluster_id, node)
            status = "assigned" if assignment else "available"
            gpus.append({
                "node": node,
                "device_id": device_id,
                "name": dev.get("vendor_name") or dev.get("name", ""),
                "description": dev.get("device_name") or dev.get("description", ""),
                "class": dev.get("class", ""),
                "iommugroup": dev.get("iommugroup"),
                "driver": dev.get("driver", ""),
                "type": "gpu",
                "status": status,
                "vmid": assignment.get("vmid") if assignment else None,
                "slot": assignment.get("slot") if assignment else None,
            })
    return {"cluster_id": cluster_id, "devices": gpus}


def _is_assigned(device_id, cluster_id, node):
    state = _load_state()
    target = _normalise_pci_id(device_id)
    for a in state.get("assignments", []):
        if (
            _normalise_pci_id(a.get("device_id", "")) == target
            and a.get("cluster_id") == cluster_id
            and a.get("node") == node
        ):
            return a
    return None


def _get_vm_config(manager, node, vmid):
    """Fetch a QEMU VM config, returning None on any failure."""
    try:
        return manager.api_request("GET", f"/nodes/{node}/qemu/{vmid}/config")
    except Exception as e:
        log.error(safe_error(e, f"config fetch for {node}/{vmid} failed"))
        return None


def _find_free_hostpci_slot(config):
    """Return the lowest unused hostpci slot index, up to 15."""
    used = set()
    for key in config:
        if key.startswith("hostpci"):
            suffix = key[len("hostpci") :]
            if suffix.isdigit():
                used.add(int(suffix))
    for slot in range(16):
        if slot not in used:
            return slot
    return None


def _build_hostpci_value(device_id, options):
    """Assemble the PVE hostpci config string from a device ID and option flags."""
    value = str(device_id)
    if options.get("pcie"):
        value += ",pcie=1"
    if options.get("rombar") is False:
        value += ",rombar=0"
    if options.get("x-vga"):
        value += ",x-vga=1"
    mdev = options.get("mdev")
    if mdev:
        value += f",mdev={mdev}"
    return value


def _set_vm_config(manager, node, vmid, update_data, delete_key=None):
    """Apply a QEMU VM config update through the PVE API."""
    host = manager.host
    port = manager.api_port
    url = f"https://{host}:{port}/api2/json/nodes/{node}/qemu/{vmid}/config"
    if delete_key:
        update_data = {"delete": delete_key}
    try:
        session = manager._create_session()
        response = session.put(url, data=update_data, timeout=15)
    except Exception as e:
        return False, safe_error(e, "PVE API request failed")
    if response.status_code == 200:
        return True, response.json().get("data") or "ok"
    return False, parse_pve_error(response.text)


def _require_vm_config_perm(cluster_id, vmid):
    """Verify that the current user is allowed to modify this VM's configuration."""
    from flask import g

    from ProxmoxVEx.utils.auth import build_authz_user
    from ProxmoxVEx.utils.rbac import user_can_access_vm

    try:
        username = getattr(g, "current_user", {}).get("username") or request.session.get("user", "")
        session = getattr(request, "session", {})
        user = build_authz_user(username, session)
        if user_can_access_vm(user, cluster_id, int(str(vmid)), "vm.config", "qemu"):
            return True, None
    except Exception as e:
        log.warning("vm access check failed: %s", e)
    return False, (jsonify({"error": "Access denied to this VM"}), 403)


def _assign():
    data = request.get_json(silent=True) or {}
    vmid = data.get("vmid")
    device_id = data.get("device_id")
    cluster_id = data.get("cluster_id")
    node = data.get("node") or "pve1"
    if not all([vmid, device_id, cluster_id]):
        return jsonify({"error": "vmid, device_id, and cluster_id are required"}), 400
    try:
        vmid = int(vmid)
    except (ValueError, TypeError):
        return jsonify({"error": "vmid must be an integer"}), 400

    ok, err = _require_vm_config_perm(cluster_id, vmid)
    if not ok:
        return err

    manager, err = _get_manager(cluster_id)
    if err:
        return err

    config = _get_vm_config(manager, node, vmid)
    if not config:
        return jsonify({"error": "Failed to read VM config"}), 500

    norm_device = _normalise_pci_id(device_id)
    for key, value in config.items():
        if key.startswith("hostpci"):
            existing = _normalise_pci_id(value.split(",", 1)[0])
            if existing == norm_device:
                return jsonify({"error": "Device is already assigned to this VM", "slot": key}), 409

    existing = _find_gpu_assignments(manager).get(norm_device)
    if existing and str(existing.get("vmid")) != str(vmid):
        return jsonify(
            {"error": f"Device already assigned to VM {existing['vmid']} on {existing['node']}"}
        ), 409

    slot = _find_free_hostpci_slot(config)
    if slot is None:
        return jsonify({"error": "No free hostpci slots available (max 16)"}), 400

    options = {
        "pcie": data.get("pcie"),
        "rombar": data.get("rombar"),
        "x-vga": data.get("x-vga"),
        "mdev": data.get("mdev"),
    }
    hostpci_value = _build_hostpci_value(device_id, options)
    update_data = {f"hostpci{slot}": hostpci_value}

    success, msg = _set_vm_config(manager, node, vmid, update_data)
    if not success:
        return jsonify({"error": f"Proxmox API error: {msg}"}), 500

    state = _load_state()
    assignment = {
        "vmid": vmid,
        "device_id": device_id,
        "cluster_id": cluster_id,
        "node": node,
        "slot": f"hostpci{slot}",
        "options": options,
    }
    state.setdefault("assignments", []).append(assignment)
    _save_state(state)
    return {"assigned": True, "assignment": assignment}


def _release():
    data = request.get_json(silent=True) or {}
    vmid = data.get("vmid")
    device_id = data.get("device_id")
    cluster_id = data.get("cluster_id")
    node = data.get("node") or "pve1"
    if not all([vmid, device_id, cluster_id]):
        return jsonify({"error": "vmid, device_id, and cluster_id are required"}), 400
    try:
        vmid = int(vmid)
    except (ValueError, TypeError):
        return jsonify({"error": "vmid must be an integer"}), 400

    ok, err = _require_vm_config_perm(cluster_id, vmid)
    if not ok:
        return err

    manager, err = _get_manager(cluster_id)
    if err:
        return err

    config = _get_vm_config(manager, node, vmid)
    if not config:
        return jsonify({"error": "Failed to read VM config"}), 500

    norm_device = _normalise_pci_id(device_id)
    target_slot = None
    for key, value in config.items():
        if key.startswith("hostpci"):
            existing = _normalise_pci_id(value.split(",", 1)[0])
            if existing == norm_device:
                target_slot = key
                break

    if not target_slot:
        return jsonify({"error": "Device not found in VM config"}), 404

    success, msg = _set_vm_config(manager, node, vmid, {}, delete_key=target_slot)
    if not success:
        return jsonify({"error": f"Proxmox API error: {msg}"}), 500

    state = _load_state()
    state["assignments"] = [
        a
        for a in state.get("assignments", [])
        if not (
            str(a.get("vmid")) == str(vmid)
            and _normalise_pci_id(a.get("device_id", "")) == norm_device
            and a.get("cluster_id") == cluster_id
            and a.get("node") == node
        )
    ]
    _save_state(state)
    return {"released": True, "vmid": vmid, "device_id": device_id, "slot": target_slot}


def _assignments():
    cluster_id = (request.args.get("cluster_id") or "").strip()
    node = (request.args.get("node") or "").strip()
    vmid = request.args.get("vmid")

    pve_assignments = []
    if cluster_id:
        manager, _ = _get_manager(cluster_id)
        if manager:
            pve_map = _find_gpu_assignments(manager)
            for norm_id, info in pve_map.items():
                if node and info.get("node") != node:
                    continue
                if vmid and str(info.get("vmid")) != str(vmid):
                    continue
                pve_assignments.append({
                    "cluster_id": cluster_id,
                    "node": info["node"],
                    "vmid": info["vmid"],
                    "device_id": norm_id,
                    "slot": info["slot"],
                    "source": "pve",
                })

    state = _load_state()
    local = state.get("assignments", [])
    seen = {
        (a.get("cluster_id"), a.get("node"), a.get("vmid"), _normalise_pci_id(a.get("device_id", "")))
        for a in pve_assignments
    }
    for a in local:
        if cluster_id and a.get("cluster_id") != cluster_id:
            continue
        if node and a.get("node") != node:
            continue
        if vmid and str(a.get("vmid")) != str(vmid):
            continue
        key = (a.get("cluster_id"), a.get("node"), a.get("vmid"), _normalise_pci_id(a.get("device_id", "")))
        if key not in seen:
            a = dict(a)
            a["source"] = "local"
            pve_assignments.append(a)
            seen.add(key)

    return {"assignments": pve_assignments}


def _get_ui():
    """Serve the GPU Passthrough Catalog HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "scan", _scan)
    register_plugin_route(PLUGIN_ID, "assign", _assign)
    register_plugin_route(PLUGIN_ID, "release", _release)
    register_plugin_route(PLUGIN_ID, "assignments", _assignments)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
