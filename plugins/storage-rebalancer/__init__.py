# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/storage-rebalancer/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: storage-rebalancer — ProxmoxVEx Plugin
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
storage-rebalancer — ProxmoxVEx Plugin
Analyzes Proxmox storage utilization, plans VM rebalances, simulates and
executes moves, and records history and utilization trends.
"""

import contextlib
import csv
import io
import json
import logging
import re
import time
import uuid
from datetime import datetime
from pathlib import Path

from flask import Response, jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugin_data_bridge import get_clusters
from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.globals import cluster_managers

PLUGIN_ID = "storage-rebalancer"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
DATA_DIR = PLUGIN_DIR / "data"
HISTORY_FILE = DATA_DIR / "history.json"
SNAPSHOTS_FILE = DATA_DIR / "snapshots.json"
CONFIG_FILE = DATA_DIR / "config.json"

DEFAULT_THRESHOLDS = {"threshold_warning": 70, "threshold_danger": 90}


# ─── persistence helpers ─────────────────────────────────────────────────────


def _load_json(path, default):
    if not path.exists():
        return default
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def _save_json(path, data):
    # Write to a temp file and atomically replace the target so a crash
    # mid-write never leaves a half-written JSON file.
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        with open(tmp, "w") as f:
            json.dump(data, f, indent=2)
        tmp.replace(path)
    except Exception as e:
        log.error(f"save {path}: {e}")


def _ensure_data_files():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not HISTORY_FILE.exists():
        _save_json(HISTORY_FILE, [])
    if not SNAPSHOTS_FILE.exists():
        _save_json(SNAPSHOTS_FILE, [])
    if not CONFIG_FILE.exists():
        _save_json(CONFIG_FILE, DEFAULT_THRESHOLDS)


_ensure_data_files()


# ─── config / thresholds ─────────────────────────────────────────────────────


def _get_thresholds():
    cfg = _load_json(CONFIG_FILE, DEFAULT_THRESHOLDS)
    return {
        "threshold_warning": int(cfg.get("threshold_warning", DEFAULT_THRESHOLDS["threshold_warning"])),
        "threshold_danger": int(cfg.get("threshold_danger", DEFAULT_THRESHOLDS["threshold_danger"])),
    }


# ─── cluster / manager helpers ───────────────────────────────────────────────


def _manager_or_error(cluster_id):
    if not cluster_id:
        return None, (jsonify({"error": "cluster_id is required"}), 400)
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return None, err
    return get_connected_manager(cluster_id)


def _get_cluster_id_from_request():
    body = request.get_json(silent=True) or {}
    return (request.args.get("cluster_id", "") or body.get("cluster_id", "")).strip()


def _get_vmid_from_request():
    body = request.get_json(silent=True) or {}
    vmid = request.args.get("vmid", "") or body.get("vmid", "")
    try:
        return int(vmid)
    except (ValueError, TypeError):
        return None


# ─── Proxmox data extraction ─────────────────────────────────────────────────


def _storage_state(percent, thresholds):
    if percent >= thresholds["threshold_danger"]:
        return "danger"
    if percent >= thresholds["threshold_warning"]:
        return "warning"
    return "ok"


def _normalize_storage(raw_storage, thresholds):
    normalized = []
    for s in raw_storage or []:
        total = int(s.get("total") or 0)
        used = int(s.get("used") or 0)
        avail = int(s.get("avail") or 0)
        if total <= 0:
            total = used + avail
        percent = 0.0 if total <= 0 else round((used / total) * 100, 2)
        content = s.get("content", "")
        normalized.append({
            "storage": s.get("storage", ""),
            "type": s.get("type", ""),
            "content": content,
            "total": total,
            "used": used,
            "avail": avail,
            "percent_used": percent,
            "threshold_state": _storage_state(percent, thresholds),
        })
    return normalized


def _normalize_vms(raw_resources):
    vms = []

    for r in raw_resources or []:
        if r.get("type") not in ("qemu", "lxc"):
            continue
        maxdisk = r.get("maxdisk") or r.get("disk") or 0
        disk_kb = int(maxdisk / 1024) if maxdisk else 0
        vms.append({
            "vmid": r.get("vmid"),
            "name": r.get("name", "") or f"{r['type'].upper()} {r['vmid']}",
            "type": r.get("type"),
            "node": r.get("node", ""),
            "status": r.get("status", ""),
            "storage": r.get("storage", ""),  # may be empty if not provided
            "disk_size": disk_kb,
            "running": r.get("status") == "running",
        })
    return vms


def _image_storage(storage_list):
    return [s for s in storage_list if "images" in (s.get("content") or "")]


def _vm_config(manager, node, vmtype, vmid):
    if not node or not vmtype or not vmid:
        return {}
    try:
        return manager.api_request("GET", f"/nodes/{node}/{vmtype}/{vmid}/config") or {}
    except Exception as e:
        log.warning(f"[vm_config] {node}/{vmtype}/{vmid}: {e}")
        return {}


def _parse_storage_from_config(cfg, default=""):
    # QEMU uses ide/sata/scsi/virtio; LXC uses rootfs. Prefer rootfs when
    # present because it is the container's primary storage.
    for key, value in cfg.items():
        if not re.match(r"^(?:(ide|sata|scsi|virtio)\d+|rootfs)$", key):
            continue
        if not value or not isinstance(value, str):
            continue
        # value format: local-lvm:vm-100-disk-0,format=raw,size=32G
        part = value.split(",")[0]
        if ":" in part:
            return part.split(":")[0]
    return default


def _get_vm_disk_kb(cfg, fallback_kb=0):
    # Try to read the size of the first attached disk from the config value.
    # LXC rootfs is included alongside QEMU disk types.
    size_kb = 0
    for key, value in cfg.items():
        if not re.match(r"^(?:(ide|sata|scsi|virtio)\d+|rootfs)$", key):
            continue
        if not value or not isinstance(value, str):
            continue
        size_match = re.search(r"size=(\d+)([KMGT]?)\b", value)
        if size_match:
            num = int(size_match.group(1))
            unit = size_match.group(2).upper()
            multiplier = {
                "K": 1,
                "M": 1024,
                "G": 1024**2,
                "T": 1024**3,
            }.get(unit, 1)
            size_kb = num * multiplier
            break
    return size_kb or fallback_kb


def _get_first_disk_key(cfg):
    """Return the first disk config key (e.g. 'scsi0' or 'rootfs') or None."""
    # LXC primary storage is 'rootfs' and should take precedence.
    if "rootfs" in cfg:
        return "rootfs"
    for key in cfg:
        if re.match(r"^(ide|sata|scsi|virtio)\d+$", key):
            return key
    return None


def _current_storage_and_disk(manager, vmid, resources=None):
    if resources is None:
        # Use the VM-specific, cached helper instead of a raw /cluster/resources walk.
        resources = manager.get_vm_resources() or []
    for r in resources:
        if r.get("type") in ("qemu", "lxc") and r.get("vmid") == vmid:
            cfg = _vm_config(manager, r.get("node"), r.get("type"), vmid)
            current = _parse_storage_from_config(cfg, r.get("storage", ""))
            disk_kb = _get_vm_disk_kb(cfg, int((r.get("maxdisk") or r.get("disk") or 0) / 1024))
            return current, disk_kb, r.get("status") == "running", r, cfg
    return "", 0, False, {}, {}


def _record_snapshots(cluster_id, storage_list):
    try:
        snapshots = _load_json(SNAPSHOTS_FILE, [])
        now = datetime.now().isoformat()
        for s in storage_list:
            snapshots.append({
                "id": str(uuid.uuid4()),
                "cluster_id": cluster_id,
                "timestamp": now,
                "storage": s["storage"],
                "total": s["total"],
                "used": s["used"],
                "avail": s["avail"],
                "percent_used": s["percent_used"],
            })
        _save_json(SNAPSHOTS_FILE, snapshots[-5000:])
    except Exception as e:
        log.warning(f"[record_snapshots] {e}")


# ─── route handlers ──────────────────────────────────────────────────────────


def _get_status():
    """Plugin status."""
    return {"plugin": PLUGIN_ID, "status": "running"}


def _get_clusters():
    """List clusters the current user is allowed to access."""
    try:
        clusters = get_clusters().get("clusters", [])

        # get_clusters() already returns the configured cluster managers, so
        # only append any clusters it may have missed (avoiding duplicates).
        existing_ids = {c.get("id") for c in clusters}
        for cluster_id, mgr in cluster_managers.items():
            allowed, _ = check_cluster_access(cluster_id)
            if not allowed or cluster_id in existing_ids:
                continue
            clusters.append({
                "id": cluster_id,
                "name": getattr(mgr.config, "name", cluster_id),
                "display_name": getattr(mgr.config, "name", cluster_id),
                "connected": getattr(mgr, "is_connected", False),
            })
        clusters.sort(key=lambda c: c.get("name", c["id"]))
        return clusters
    except Exception as e:
        log.exception("[clusters] failed")
        return jsonify({"error": safe_error(e, "failed to list clusters")}), 500


def _analyze():
    """GET/POST analyze storage and VM placement."""
    cluster_id = _get_cluster_id_from_request()
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        thresholds = _get_thresholds()
        storage_raw = manager.api_request("GET", "/storage") or []
        # Use the VM-specific resources helper for consistent, cached VM data.
        resources = manager.get_vm_resources() or []
        storage = _normalize_storage(storage_raw, thresholds)
        vms = _normalize_vms(resources)

        summary = {"ok": 0, "warning": 0, "danger": 0}
        for s in storage:
            summary[s["threshold_state"]] = summary.get(s["threshold_state"], 0) + 1

        if request.args.get("refresh") == "1" or (request.get_json(silent=True) or {}).get("refresh"):
            _record_snapshots(cluster_id, storage)

        return {
            "cluster_id": cluster_id,
            "storage": storage,
            "vms": vms,
            "vm_count": len(vms),
            "threshold_state_summary": summary,
        }
    except Exception as e:
        log.exception("[analyze] failed")
        return jsonify({"error": safe_error(e, "analyze failed")}), 500


def _get_vms():
    """GET list of VMs for a cluster."""
    cluster_id = _get_cluster_id_from_request()
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        # Use the manager's VM-specific resources helper; it filters by
        # type=vm and handles timeouts/caching consistently with the rest
        # of the application, so VM dropdowns actually populate.
        resources = manager.get_vm_resources() or []
        return {"data": _normalize_vms(resources)}
    except Exception as e:
        log.exception("[vms] failed")
        return jsonify({"error": safe_error(e, "failed to list VMs")}), 500


def _plan_for_vm(manager, vmid, storage_list, resources=None):
    thresholds = _get_thresholds()
    storage = _normalize_storage(storage_list, thresholds)
    candidates = _image_storage(storage)
    if not candidates:
        return None, "no image-capable storage found"

    if resources is None:
        resources = manager.get_vm_resources() or []
    current, disk_kb, running, _r, _cfg = _current_storage_and_disk(manager, vmid, resources)

    # Only suggest targets that can actually hold the VM's disk.
    if disk_kb > 0:
        candidates = [s for s in candidates if s["avail"] >= disk_kb]
    if not candidates:
        return None, "no target storage has enough free space"

    # Pick image-capable storage with the most available space.
    best = max(candidates, key=lambda s: s["avail"])
    if best["storage"] == current and current:
        return {
            "vmid": vmid,
            "current_storage": current,
            "target_storage": best["storage"],
            "available_kb": best["avail"],
            "disk_size": disk_kb,
            "suggested": False,
            "reason": "already on optimal storage",
        }, None
    return {
        "vmid": vmid,
        "current_storage": current,
        "target_storage": best["storage"],
        "available_kb": best["avail"],
        "disk_size": disk_kb,
        "suggested": True,
        "reason": "most available space",
    }, None


def _plan():
    """POST suggest a target storage for one VM."""
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or request.args.get("cluster_id", "")).strip()
    vmid = _get_vmid_from_request()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    if not vmid:
        return jsonify({"error": "vmid is required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        storage_raw = manager.api_request("GET", "/storage") or []
        plan, reason = _plan_for_vm(manager, vmid, storage_raw)
        if not plan:
            return jsonify({"error": reason}), 404
        return plan
    except Exception as e:
        log.exception("[plan] failed")
        return jsonify({"error": safe_error(e, "plan failed")}), 500


def _bulk_plan():
    """POST bulk plan for selected VMs."""
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    vmids = body.get("vmids") or []
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    if not vmids:
        return jsonify({"error": "vmids is required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        storage_raw = manager.api_request("GET", "/storage") or []
        # Fetch VM list once for the whole bulk plan instead of once per VM.
        resources = manager.get_vm_resources() or []
        plans = []
        feasible = 0
        infeasible = 0
        for vmid in vmids:
            plan, reason = _plan_for_vm(manager, int(vmid), storage_raw, resources)
            if plan:
                plans.append(plan)
                feasible += 1
            else:
                plans.append({"vmid": vmid, "suggested": False, "reason": reason})
                infeasible += 1
        return {
            "id": str(uuid.uuid4()),
            "cluster_id": cluster_id,
            "plans": plans,
            "summary": {"total": len(vmids), "feasible": feasible, "infeasible": infeasible},
        }
    except Exception as e:
        log.exception("[bulk-plan] failed")
        return jsonify({"error": safe_error(e, "bulk plan failed")}), 500


def _wait_for_task(manager, node, upid, timeout=60, interval=2):
    """Poll a PVE task until it stops or the timeout is reached."""
    if not upid:
        return "no UPID returned"
    deadline = time.time() + timeout
    while time.time() < deadline:
        result = manager.api_request("GET", f"/nodes/{node}/tasks/{upid}/status")
        if not result:
            return "failed to query task status"
        if result.get("status") == "stopped":
            return result.get("exitstatus") or "unknown"
        time.sleep(interval)
    return "timeout waiting for PVE task"


def _do_execute(cluster_id, vmid, target_storage, dry_run=False):
    manager, err = _manager_or_error(cluster_id)
    if err:
        return None, err
    try:
        thresholds = _get_thresholds()
        storage_raw = manager.api_request("GET", "/storage") or []
        storage = _normalize_storage(storage_raw, thresholds)

        current, disk_kb, running, r, cfg = _current_storage_and_disk(manager, vmid)

        target = next((s for s in storage if s["storage"] == target_storage), None)
        if not target:
            return None, (jsonify({"error": "target storage not found"}), 404)
        if "images" not in (target.get("content") or ""):
            return None, (jsonify({"error": "target storage is not image-capable"}), 400)
        if current and current == target_storage:
            return None, (jsonify({"error": "target cannot be the same as current storage"}), 400)
        if disk_kb and target["avail"] < disk_kb:
            return None, (jsonify({"error": "target has insufficient free space"}), 400)

        now = datetime.now().isoformat()
        move = {
            "id": str(uuid.uuid4()),
            "cluster_id": cluster_id,
            "vmid": vmid,
            "current_storage": current,
            "target_storage": target_storage,
            "status": "dry-run" if dry_run else "completed",
            "planned_at": now,
            "started_at": None,
            "completed_at": None,
            "error": None,
        }

        if not dry_run:
            # For safety, require the VM to be stopped before moving its disk.
            if running:
                return None, (jsonify({"error": "VM must be stopped before moving its disk"}), 400)

            disk_key = _get_first_disk_key(cfg)
            if not disk_key:
                return None, (jsonify({"error": "could not find a disk to move"}), 400)

            node = r.get("node")
            vmtype = r.get("type")
            if vmtype == "lxc":
                # LXC uses /move_volume with a 'volume' parameter.
                upid = manager.api_request(
                    "POST",
                    f"/nodes/{node}/lxc/{vmid}/move_volume",
                    data={"storage": target_storage, "volume": disk_key, "delete": 1},
                )
            else:
                # QEMU uses /move_disk with a 'disk' parameter.
                upid = manager.api_request(
                    "POST",
                    f"/nodes/{node}/qemu/{vmid}/move_disk",
                    data={"storage": target_storage, "disk": disk_key, "delete": 1},
                )
            if not upid:
                return None, (jsonify({"error": "PVE move API call failed"}), 500)

            move["pve_task_id"] = upid
            move["started_at"] = datetime.now().isoformat()
            exit_status = _wait_for_task(manager, node, upid)
            move["completed_at"] = datetime.now().isoformat()

            if exit_status == "OK":
                move["status"] = "completed"
            else:
                move["status"] = "failed"
                move["error"] = exit_status

            history = _load_json(HISTORY_FILE, [])
            history.append(move)
            _save_json(HISTORY_FILE, history)

        return move, None
    except Exception as e:
        log.exception("[execute] failed")
        return None, (jsonify({"error": safe_error(e, "execute failed")}), 500)


def _execute():
    """POST execute a VM move."""
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    vmid = body.get("vmid")
    target_storage = (body.get("target_storage") or "").strip()
    dry_run = bool(body.get("dry_run"))
    if not cluster_id or not vmid or not target_storage:
        return jsonify({"error": "cluster_id, vmid and target_storage are required"}), 400
    try:
        vmid = int(vmid)
    except (ValueError, TypeError):
        return jsonify({"error": "vmid must be an integer"}), 400
    move, err = _do_execute(cluster_id, vmid, target_storage, dry_run=dry_run)
    if err:
        return err
    return move


def _dry_run():
    """POST dry-run a VM move (no persistence)."""
    body = request.get_json(silent=True) or {}
    body["dry_run"] = True
    request._cached_json = body  # allow _get_vmid helpers to read body; not used here
    cluster_id = (body.get("cluster_id") or "").strip()
    vmid = body.get("vmid")
    target_storage = (body.get("target_storage") or "").strip()
    if not cluster_id or not vmid or not target_storage:
        return jsonify({"error": "cluster_id, vmid and target_storage are required"}), 400
    try:
        vmid = int(vmid)
    except (ValueError, TypeError):
        return jsonify({"error": "vmid must be an integer"}), 400
    move, err = _do_execute(cluster_id, vmid, target_storage, dry_run=True)
    if err:
        return err
    return move


def _bulk_execute():
    """POST bulk execute a list of planned moves."""
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    moves_input = body.get("moves") or []
    dry_run = bool(body.get("dry_run"))
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    if not moves_input:
        return jsonify({"error": "moves is required"}), 400
    manager, err = _manager_or_error(cluster_id)
    if err:
        return err
    try:
        results = []
        completed = 0
        failed = 0
        skipped = 0
        for item in moves_input:
            vmid = item.get("vmid")
            target = (item.get("target_storage") or "").strip()
            if not vmid or not target:
                results.append({"vmid": vmid, "status": "skipped", "error": "missing vmid or target"})
                skipped += 1
                continue
            try:
                vmid_int = int(vmid)
            except (ValueError, TypeError):
                results.append({"vmid": vmid, "status": "failed", "error": "invalid vmid"})
                failed += 1
                continue
            move, move_err = _do_execute(cluster_id, vmid_int, target, dry_run=dry_run)
            if move_err:
                results.append({"vmid": vmid, "status": "failed", "error": move_err[0].get_json().get("error")})
                failed += 1
            else:
                results.append(move)
                if move.get("status") in ("completed", "dry-run"):
                    completed += 1
                elif move.get("status") == "failed":
                    failed += 1
                else:
                    skipped += 1
        return {
            "id": str(uuid.uuid4()),
            "cluster_id": cluster_id,
            "moves": results,
            "dry_run": dry_run,
            "summary": {"total": len(moves_input), "completed": completed, "failed": failed, "skipped": skipped},
        }
    except Exception as e:
        log.exception("[bulk-execute] failed")
        return jsonify({"error": safe_error(e, "bulk execute failed")}), 500


def _history_handler():
    """GET/DELETE history."""
    if request.method == "DELETE":
        record_id = request.args.get("id", "") or (request.get_json(silent=True) or {}).get("id")
        if not record_id:
            return jsonify({"error": "id is required"}), 400
        history = _load_json(HISTORY_FILE, [])
        new_history = [h for h in history if h.get("id") != record_id]
        _save_json(HISTORY_FILE, new_history)
        return {"deleted": record_id}

    history = _load_json(HISTORY_FILE, [])
    cluster_id = request.args.get("cluster_id", "")
    status = request.args.get("status", "")
    vmid = request.args.get("vmid", "")
    fmt = request.args.get("format", "")
    sort_field = request.args.get("sort", "planned_at")
    order = request.args.get("order", "desc")
    limit = request.args.get("limit", type=int)
    offset = request.args.get("offset", 0, type=int)

    data = list(history)
    if cluster_id:
        data = [h for h in data if h.get("cluster_id") == cluster_id]
    if status:
        data = [h for h in data if h.get("status") == status]
    if vmid:
        with contextlib.suppress(ValueError, TypeError):
            data = [h for h in data if str(h.get("vmid")) == str(int(vmid))]

    data.sort(
        key=lambda h: h.get(sort_field, "") or "",
        reverse=(order == "desc"),
    )
    total = len(data)
    if limit:
        data = data[offset : offset + limit]

    if fmt == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["id", "cluster_id", "vmid", "current_storage", "target_storage", "status", "planned_at"])
        for h in data:
            writer.writerow([
                h.get("id"),
                h.get("cluster_id"),
                h.get("vmid"),
                h.get("current_storage"),
                h.get("target_storage"),
                h.get("status"),
                h.get("planned_at"),
            ])
        return Response(
            output.getvalue(), mimetype="text/csv", headers={"Content-Disposition": "attachment; filename=history.csv"}
        )
    if fmt == "json":
        return Response(
            json.dumps(data, indent=2),
            mimetype="application/json",
            headers={"Content-Disposition": "attachment; filename=history.json"},
        )

    return {"data": data, "total": total}


def _history_clone():
    """POST clone a historical move."""
    body = request.get_json(silent=True) or {}
    record_id = body.get("id", "")
    if not record_id:
        return jsonify({"error": "id is required"}), 400
    history = _load_json(HISTORY_FILE, [])
    for h in history:
        if h.get("id") == record_id:
            new_move = dict(h)
            new_move["id"] = str(uuid.uuid4())
            new_move["status"] = "planned"
            new_move["planned_at"] = datetime.now().isoformat()
            new_move["started_at"] = None
            new_move["completed_at"] = None
            new_move["error"] = None
            history.append(new_move)
            _save_json(HISTORY_FILE, history)
            return new_move
    return jsonify({"error": "record not found"}), 404


def _history_cancel():
    """POST cancel a planned move."""
    body = request.get_json(silent=True) or {}
    record_id = body.get("id", "")
    if not record_id:
        return jsonify({"error": "id is required"}), 400
    history = _load_json(HISTORY_FILE, [])
    for h in history:
        if h.get("id") == record_id and h.get("status") == "planned":
            h["status"] = "cancelled"
            _save_json(HISTORY_FILE, history)
            return h
    return jsonify({"error": "record not found or not in a cancellable state"}), 404


def _get_snapshots():
    """GET stored storage snapshots."""
    snapshots = _load_json(SNAPSHOTS_FILE, [])
    cluster_id = request.args.get("cluster_id", "")
    if cluster_id:
        snapshots = [s for s in snapshots if s.get("cluster_id") == cluster_id]
    return {"data": snapshots}


def _get_trends():
    """GET utilization trends for a storage."""
    cluster_id = _get_cluster_id_from_request()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    storage_name = request.args.get("storage", "")
    start = request.args.get("start", "")
    end = request.args.get("end", "")
    interval = request.args.get("interval", "daily")
    snapshots = _load_json(SNAPSHOTS_FILE, [])
    data = [s for s in snapshots if s.get("cluster_id") == cluster_id]
    if storage_name:
        data = [s for s in data if s.get("storage") == storage_name]
    if start:
        data = [s for s in data if s.get("timestamp", "") >= start]
    if end:
        data = [s for s in data if s.get("timestamp", "") <= end]
    data.sort(key=lambda s: s.get("timestamp", ""))

    if interval == "hourly":
        return {"data": data}

    # Daily aggregation: average percent per day.
    grouped = {}
    for s in data:
        day = (s.get("timestamp") or "")[:10]
        grouped.setdefault(day, []).append(s)
    aggregated = []
    for day in sorted(grouped):
        entries = grouped[day]
        avg = sum(e.get("percent_used", 0) for e in entries) / len(entries)
        aggregated.append({
            "id": f"{day}-agg",
            "cluster_id": cluster_id,
            "timestamp": day,
            "storage": entries[0].get("storage"),
            "percent_used": round(avg, 2),
        })
    return {"data": aggregated}


def _config_handler():
    """GET/POST plugin configuration (thresholds)."""
    if request.method == "GET":
        return _get_thresholds()
    body = request.get_json(silent=True) or {}
    cfg = _get_thresholds()
    if "threshold_warning" in body:
        cfg["threshold_warning"] = int(body["threshold_warning"])
    if "threshold_danger" in body:
        cfg["threshold_danger"] = int(body["threshold_danger"])
    _save_json(CONFIG_FILE, cfg)
    return cfg


def _get_ui():
    """Serve the Storage Rebalancer HTML interface."""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    """Register plugin routes."""
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "analyze", _analyze)
    register_plugin_route(PLUGIN_ID, "vms", _get_vms)
    register_plugin_route(PLUGIN_ID, "plan", _plan)
    register_plugin_route(PLUGIN_ID, "bulk-plan", _bulk_plan)
    register_plugin_route(PLUGIN_ID, "plan/bulk", _bulk_plan)
    register_plugin_route(PLUGIN_ID, "execute", _execute)
    register_plugin_route(PLUGIN_ID, "bulk-execute", _bulk_execute)
    register_plugin_route(PLUGIN_ID, "bulk", _bulk_execute)
    register_plugin_route(PLUGIN_ID, "dry-run", _dry_run)
    register_plugin_route(PLUGIN_ID, "history", _history_handler)
    register_plugin_route(PLUGIN_ID, "history/clone", _history_clone)
    register_plugin_route(PLUGIN_ID, "history/cancel", _history_cancel)
    register_plugin_route(PLUGIN_ID, "snapshots", _get_snapshots)
    register_plugin_route(PLUGIN_ID, "trends", _get_trends)
    register_plugin_route(PLUGIN_ID, "config", _config_handler)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s registered", PLUGIN_ID)
