# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vlan-provisioner/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: vlan-provisioner — ProxmoxVEx Plugin
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
vlan-provisioner — ProxmoxVEx Plugin
Define, validate, apply, and audit VLANs across clusters.
"""

import csv
import io
import ipaddress
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Response, g, jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager
from ProxmoxVEx.api.plugin_data_bridge import get_clusters
from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.globals import cluster_managers

PLUGIN_ID = "vlan-provisioner"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")

PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "state.json"
VLANS_FILE = PLUGIN_DIR / "vlans.json"

MAX_VID = 4094
HEX_RE = re.compile(r"^#([0-9a-fA-F]{3}){1,2}$")


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


def _current_user():
    user = getattr(g, "current_user", None)
    if not user:
        user = getattr(request, "session", {}).get("user")
    return user or "unknown"


def _default_state():
    return {
        "version": "1",
        "updated_at": _now_iso(),
        "vlans": [],
        "apply_history": [],
        "compliance_checks": [],
        "audit_log": [],
        "schedule": {"enabled": False, "interval_minutes": 60, "last_run_at": None},
        "cluster_vlan_state": {},
    }


def _load_state():
    if not STATE_FILE.exists():
        return _default_state()
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return _default_state()
        for key, default in _default_state().items():
            data.setdefault(key, default)
        return data
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return _default_state()


def _save_state(data):
    data["updated_at"] = _now_iso()
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        # Mirror VLANs to vlans.json for backward compatibility.
        with open(VLANS_FILE, "w", encoding="utf-8") as f:
            json.dump(data.get("vlans", []), f, indent=2)
    except OSError as e:
        log.error("Failed to save state: %s", e)


def _audit(action, target_id=None, before=None, after=None):
    state = _load_state()
    entry = {
        "id": _new_id(),
        "actor": _current_user(),
        "action": action,
        "target_id": target_id,
        "timestamp": _now_iso(),
        "before": before,
        "after": after,
    }
    state.setdefault("audit_log", []).insert(0, entry)
    state["audit_log"] = state["audit_log"][:5000]
    _save_state(state)


def _get_vlan_index(vlans, vlan_id):
    for idx, v in enumerate(vlans):
        if v.get("id") == vlan_id:
            return idx
    return None


def _find_vlan_by(vlans, key, value, exclude_id=None):
    for v in vlans:
        if v.get(key) == value and v.get("id") != exclude_id:
            return v
    return None


def _normalize_tags(raw):
    if not raw:
        return []
    if isinstance(raw, str):
        raw = [raw]
    tags = []
    for t in raw:
        if t is None:
            continue
        s = str(t).strip()
        if s:
            tags.append(s)
    return list(dict.fromkeys(tags))


def _valid_cidr(value):
    if not value:
        return True
    try:
        ipaddress.ip_network(value.strip(), strict=False)
        return True
    except (ValueError, TypeError):
        return False


def _cidr_overlap(a, b):
    if not a or not b:
        return False
    try:
        net_a = ipaddress.ip_network(a.strip(), strict=False)
        net_b = ipaddress.ip_network(b.strip(), strict=False)
        return net_a.overlaps(net_b)
    except (ValueError, TypeError):
        return False


def _validate_vlan(vlan, vlans, exclude_id=None):
    errors = []
    name = str(vlan.get("name", "")).strip()
    if not name:
        errors.append("name is required")
    elif _find_vlan_by(vlans, "name", name, exclude_id):
        errors.append(f"VLAN name '{name}' already exists")

    vid = vlan.get("vid")
    try:
        vid = int(vid)
    except (TypeError, ValueError):
        errors.append("vid must be an integer")
    else:
        if not (1 <= vid <= MAX_VID):
            errors.append(f"vid must be between 1 and {MAX_VID}")
        elif _find_vlan_by(vlans, "vid", vid, exclude_id):
            errors.append(f"VID {vid} is already in use")
        vlan["vid"] = vid

    subnet = (str(vlan.get("subnet", "")).strip()) if vlan.get("subnet") is not None else ""
    if subnet and not _valid_cidr(subnet):
        errors.append(f"subnet '{subnet}' is not a valid CIDR")
    if subnet:
        for v in vlans:
            if v.get("id") == exclude_id:
                continue
            if v.get("subnet") and _cidr_overlap(subnet, v["subnet"]):
                errors.append(f"subnet overlaps with VLAN '{v.get('name')}'")
                break

    tags = _normalize_tags(vlan.get("tags"))
    vlan["tags"] = tags
    color = (str(vlan.get("color", "")).strip()) if vlan.get("color") is not None else ""
    if color and not HEX_RE.match(color):
        errors.append("color must be a 3 or 6 digit hex value")
    environment = (str(vlan.get("environment", "")).strip()) if vlan.get("environment") is not None else ""

    vlan.update({
        "name": name,
        "subnet": subnet,
        "description": (str(vlan.get("description", "")).strip()) if vlan.get("description") is not None else "",
        "tags": tags,
        "color": color,
        "environment": environment,
    })
    return errors


def _to_vlan_summary(v):
    return {
        "id": v.get("id"),
        "name": v.get("name"),
        "vid": v.get("vid"),
        "subnet": v.get("subnet"),
        "description": v.get("description"),
        "tags": v.get("tags", []),
        "color": v.get("color"),
        "environment": v.get("environment"),
        "applied_cluster_ids": v.get("applied_cluster_ids", []),
        "last_applied_at": v.get("last_applied_at"),
        "created_at": v.get("created_at"),
        "updated_at": v.get("updated_at"),
    }


def _filter_and_sort_vlans(vlans, params):
    filtered = list(vlans)
    query = (params.get("filter") or "").strip().lower()
    tag = (params.get("tag") or "").strip().lower()
    env = (params.get("environment") or "").strip().lower()

    if query:
        filtered = [
            v
            for v in filtered
            if query in v.get("name", "").lower()
            or query in str(v.get("vid"))
            or query in (v.get("description") or "").lower()
        ]
    if tag:
        filtered = [v for v in filtered if any(tag == t.lower() for t in v.get("tags", []))]
    if env:
        filtered = [v for v in filtered if (v.get("environment") or "").lower() == env]

    sort = (params.get("sort") or "name").lower()
    order = (params.get("order") or "asc").lower()
    if sort in ("name", "vid", "subnet", "environment"):

        def _key(v):
            val = v.get(sort, "")
            return (val or "").lower() if isinstance(val, str) else (val if val is not None else 0)

        reverse = order == "desc"
        filtered = sorted(filtered, key=_key, reverse=reverse)
    return filtered


def _get_status():
    state = _load_state()
    vlans = state.get("vlans", [])
    checks = state.get("compliance_checks", [])
    last = checks[0] if checks else None
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "vlans_count": len(vlans),
        "compliance_status": "compliant" if (not last or last.get("compliant")) else "drift",
        "last_check_at": (last or {}).get("run_at"),
    }


def _get_clusters():
    clusters = get_clusters().get("clusters", [])

    for cluster_id, mgr in cluster_managers.items():
        allowed, _ = check_cluster_access(cluster_id)
        if not allowed:
            continue
        clusters.append({
            "id": cluster_id,
            "name": getattr(mgr.config, "name", cluster_id),
            "display_name": getattr(mgr.config, "name", cluster_id),
            "reachable": mgr.is_connected,
            "connected": mgr.is_connected,
            "node": mgr.host,
        })
    return {"data": sorted(clusters, key=lambda c: c.get("display_name", "").lower())}


def _vlans_handler():
    method = request.method
    state = _load_state()
    vlans = state.setdefault("vlans", [])

    if method == "GET":
        if "id" in request.args:
            vlan_id = request.args.get("id")
            v = next((v for v in vlans if v.get("id") == vlan_id), None)
            if not v:
                return jsonify({"error": "VLAN not found"}), 404
            return {"data": _to_vlan_summary(v)}

        filtered = _filter_and_sort_vlans(vlans, request.args)
        return {"data": [_to_vlan_summary(v) for v in filtered]}

    if method == "POST":
        body = request.get_json(silent=True) or {}
        vlan = {
            "id": _new_id(),
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "applied_cluster_ids": [],
            "last_applied_at": None,
        }
        for field in ["name", "vid", "subnet", "description", "tags", "color", "environment"]:
            if field in body:
                vlan[field] = body[field]
        errors = _validate_vlan(vlan, vlans)
        if errors:
            return jsonify({"error": errors[0], "errors": errors}), 400
        vlans.append(vlan)
        _save_state(state)
        _audit("create", target_id=vlan["id"], after=_to_vlan_summary(vlan))
        return {"data": _to_vlan_summary(vlan)}

    if method == "PUT":
        vlan_id = request.args.get("id") or (request.get_json(silent=True) or {}).get("id")
        if not vlan_id:
            return jsonify({"error": "id is required"}), 400
        idx = _get_vlan_index(vlans, vlan_id)
        if idx is None:
            return jsonify({"error": "VLAN not found"}), 404
        body = request.get_json(silent=True) or {}
        before = _to_vlan_summary(vlans[idx])
        for field in ["name", "vid", "subnet", "description", "tags", "color", "environment"]:
            if field in body:
                vlans[idx][field] = body[field]
        errors = _validate_vlan(vlans[idx], vlans, exclude_id=vlan_id)
        if errors:
            return jsonify({"error": errors[0], "errors": errors}), 400
        vlans[idx]["updated_at"] = _now_iso()
        _save_state(state)
        _audit("edit", target_id=vlan_id, before=before, after=_to_vlan_summary(vlans[idx]))
        return {"data": _to_vlan_summary(vlans[idx])}

    if method == "DELETE":
        vlan_id = request.args.get("id") or (request.get_json(silent=True) or {}).get("id")
        if not vlan_id:
            return jsonify({"error": "id is required"}), 400
        idx = _get_vlan_index(vlans, vlan_id)
        if idx is None:
            return jsonify({"error": "VLAN not found"}), 404
        if vlans[idx].get("applied_cluster_ids"):
            return jsonify({"error": "Cannot delete a VLAN that is currently applied to a cluster"}), 409
        before = _to_vlan_summary(vlans[idx])
        del vlans[idx]
        _save_state(state)
        _audit("delete", target_id=vlan_id, before=before)
        return {"deleted": vlan_id}

    return jsonify({"error": "Method not allowed"}), 405


def _vlans_bulk_delete():
    body = request.get_json(silent=True) or {}
    ids = body.get("ids") or []
    if not ids or not isinstance(ids, list):
        return jsonify({"error": "ids must be a non-empty list"}), 400
    state = _load_state()
    vlans = state.setdefault("vlans", [])
    deleted = []
    failed = {}
    for vlan_id in ids:
        idx = _get_vlan_index(vlans, vlan_id)
        if idx is None:
            failed[vlan_id] = "not found"
            continue
        if vlans[idx].get("applied_cluster_ids"):
            failed[vlan_id] = "currently applied to a cluster"
            continue
        before = _to_vlan_summary(vlans[idx])
        del vlans[idx]
        _audit("delete", target_id=vlan_id, before=before)
        deleted.append(vlan_id)
    _save_state(state)
    return {"deleted": deleted, "failed": failed}


def _vlans_generate():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    start = body.get("start_vid")
    end = body.get("end_vid")
    name_prefix = (body.get("name_prefix") or "").strip()
    if not name_prefix:
        return jsonify({"error": "name_prefix is required"}), 400
    try:
        start = int(start)
        end = int(end)
    except (TypeError, ValueError):
        return jsonify({"error": "start_vid and end_vid must be integers"}), 400
    if not (1 <= start <= MAX_VID and 1 <= end <= MAX_VID) or start > end:
        return jsonify({"error": f"VID range must be within 1-{MAX_VID} and start <= end"}), 400

    candidates = []
    state = _load_state()
    vlans = state.get("vlans", [])
    existing_vids = {v.get("vid") for v in vlans}
    for vid in range(start, end + 1):
        candidate = {
            "id": f"cand-{vid}",
            "name": f"{name_prefix}-{vid}",
            "vid": vid,
            "subnet": (str(body.get("subnet", "")).strip()) if body.get("subnet") is not None else "",
            "description": (str(body.get("description", "")).strip()) if body.get("description") is not None else "",
            "tags": _normalize_tags(body.get("tags")),
            "color": (str(body.get("color", "")).strip()) if body.get("color") is not None else "",
            "environment": (str(body.get("environment", "")).strip()) if body.get("environment") is not None else "",
            "valid": 1 <= vid <= MAX_VID and vid not in existing_vids,
        }
        candidates.append(candidate)
    return {"data": candidates}


def _apply_handler():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    cluster_id = (str(body.get("cluster_id", ""))).strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400

    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    manager, err = get_connected_manager(cluster_id)
    if err:
        return err

    state = _load_state()
    vlans = state.get("vlans", [])
    selected = body.get("vlan_ids") or []
    pushed = [v for v in vlans if v.get("id") in selected] if selected else list(vlans)
    if not pushed:
        return jsonify({"error": "No VLANs to apply"}), 400

    dry_run = bool(body.get("dry_run"))
    now = _now_iso()
    results = {"created": [], "updated": [], "unchanged": [], "errors": []}

    cluster_state = state.setdefault("cluster_vlan_state", {}).setdefault(cluster_id, [])
    for v in pushed:
        if dry_run:
            if v.get("vid") in cluster_state:
                results["unchanged"].append(v["vid"])
            else:
                results["created"].append(v["vid"])
        else:
            if v.get("vid") not in cluster_state:
                cluster_state.append(v["vid"])
                results["created"].append(v["vid"])
            else:
                results["unchanged"].append(v["vid"])
            v.setdefault("applied_cluster_ids", []).append(cluster_id)
            v["applied_cluster_ids"] = list(dict.fromkeys(v["applied_cluster_ids"]))
            v["last_applied_at"] = now

    record = {
        "id": _new_id(),
        "cluster_id": cluster_id,
        "cluster_node": manager.host,
        "vlan_ids": [v.get("id") for v in pushed],
        "dry_run": dry_run,
        "pushed_count": len(pushed),
        "results": results,
        "created_at": now,
        "actor": _current_user(),
    }
    state.setdefault("apply_history", []).insert(0, record)
    state["apply_history"] = state["apply_history"][:1000]
    if not dry_run:
        _save_state(state)
        _audit("apply", target_id=record["id"], after=record)

    return {
        "applied": True,
        "cluster_id": cluster_id,
        "cluster_node": manager.host,
        "vlans_pushed": len(pushed),
        "dry_run": dry_run,
        "results": results,
    }


def _apply_bulk():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    cluster_ids = body.get("cluster_ids") or []
    if not cluster_ids or not isinstance(cluster_ids, list):
        return jsonify({"error": "cluster_ids must be a non-empty list"}), 400

    vlan_ids = body.get("vlan_ids") or []
    dry_run = bool(body.get("dry_run"))
    results = []
    for cluster_id in cluster_ids:
        allowed, err = check_cluster_access(cluster_id)
        if not allowed:
            return err
        manager, err = get_connected_manager(cluster_id)
        if err:
            return err

    for cluster_id in cluster_ids:
        manager, _ = get_connected_manager(cluster_id)
        state = _load_state()
        vlans = state.get("vlans", [])
        selected = vlan_ids or [v.get("id") for v in vlans]
        pushed = [v for v in vlans if v.get("id") in selected]
        cluster_state = state.setdefault("cluster_vlan_state", {}).setdefault(cluster_id, [])
        res = {"created": [], "updated": [], "unchanged": [], "errors": []}
        now = _now_iso()
        for v in pushed:
            if v.get("vid") not in cluster_state:
                cluster_state.append(v["vid"])
                res["created"].append(v["vid"])
            else:
                res["unchanged"].append(v["vid"])
            if not dry_run:
                v.setdefault("applied_cluster_ids", []).append(cluster_id)
                v["applied_cluster_ids"] = list(dict.fromkeys(v["applied_cluster_ids"]))
                v["last_applied_at"] = now
        if not dry_run:
            state.setdefault("apply_history", []).insert(
                0,
                {
                    "id": _new_id(),
                    "cluster_id": cluster_id,
                    "cluster_node": manager.host,
                    "vlan_ids": selected,
                    "dry_run": dry_run,
                    "pushed_count": len(pushed),
                    "results": res,
                    "created_at": now,
                    "actor": _current_user(),
                },
            )
            _save_state(state)
        results.append({
            "cluster_id": cluster_id,
            "cluster_node": manager.host,
            "vlans_pushed": len(pushed),
            "dry_run": dry_run,
            "results": res,
        })
    return {"results": results}


def _compliance_handler():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    cluster_id = request.args.get("cluster_id", "").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err

    state = _load_state()
    stored = state.get("vlans", [])
    cluster_state = state.get("cluster_vlan_state", {}).get(cluster_id, [])
    stored_vids = {v.get("vid") for v in stored}
    actual_vids = set(cluster_state)

    diff = []
    for v in stored:
        if v.get("vid") not in actual_vids:
            diff.append({"vid": v["vid"], "name": v.get("name"), "status": "missing", "side": "stored"})
    for vid in actual_vids:
        if vid not in stored_vids:
            name = next((v.get("name") for v in stored if v.get("vid") == vid), "unknown")
            diff.append({"vid": vid, "name": name, "status": "extra", "side": "actual"})

    actual = [
        {"vid": vid, "name": next((v.get("name") for v in stored if v.get("vid") == vid), "unknown"), "present": True}
        for vid in actual_vids
    ]
    stored_summary = [
        {"vid": v.get("vid"), "name": v.get("name"), "present": v.get("vid") in actual_vids} for v in stored
    ]
    compliant = not diff

    check = {
        "id": _new_id(),
        "cluster_id": cluster_id,
        "run_at": _now_iso(),
        "compliant": compliant,
        "stored": stored_summary,
        "actual": actual,
        "diff": diff,
    }
    state.setdefault("compliance_checks", []).insert(0, check)
    state["compliance_checks"] = state["compliance_checks"][:500]
    _save_state(state)
    _audit("compliance", target_id=check["id"], after=check)
    return {"data": check}


def _compliance_reapply():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    cluster_id = (str(body.get("cluster_id", ""))).strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    manager, err = get_connected_manager(cluster_id)
    if err:
        return err

    state = _load_state()
    vlans = state.get("vlans", [])
    selected = body.get("vlan_ids") or []
    to_push = [v for v in vlans if not selected or v.get("id") in selected]
    cluster_state = state.setdefault("cluster_vlan_state", {}).setdefault(cluster_id, [])
    now = _now_iso()
    for v in to_push:
        if v.get("vid") not in cluster_state:
            cluster_state.append(v.get("vid"))
        v.setdefault("applied_cluster_ids", []).append(cluster_id)
        v["applied_cluster_ids"] = list(dict.fromkeys(v["applied_cluster_ids"]))
        v["last_applied_at"] = now
    _save_state(state)
    _audit("compliance", target_id=cluster_id, after={"action": "reapply", "vids": [v.get("vid") for v in to_push]})
    return {"applied": True, "cluster_id": cluster_id, "vlans_pushed": len(to_push)}


def _compliance_remove():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    cluster_id = (str(body.get("cluster_id", ""))).strip()
    vids = body.get("vids") or []
    if not cluster_id or not vids or not isinstance(vids, list):
        return jsonify({"error": "cluster_id and vids are required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    manager, err = get_connected_manager(cluster_id)
    if err:
        return err

    state = _load_state()
    cluster_state = state.setdefault("cluster_vlan_state", {}).setdefault(cluster_id, [])
    removed = []
    for vid in vids:
        try:
            vid = int(vid)
        except (TypeError, ValueError):
            continue
        if vid in cluster_state:
            cluster_state.remove(vid)
            removed.append(vid)
    _save_state(state)
    _audit("compliance", target_id=cluster_id, after={"action": "remove", "vids": removed})
    return {"removed": removed}


def _apply_history():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    state = _load_state()
    history = list(state.get("apply_history", []))
    cluster_id = request.args.get("cluster_id", "").strip()
    if cluster_id:
        history = [h for h in history if h.get("cluster_id") == cluster_id]
    try:
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
    except (TypeError, ValueError):
        limit = 50
        offset = 0
    total = len(history)
    return {"data": history[offset : offset + limit], "total": total}


def _audit_handler():
    state = _load_state()
    if request.method == "GET":
        log_data = list(state.get("audit_log", []))
        action = (request.args.get("action") or "").strip()
        if action:
            log_data = [e for e in log_data if e.get("action") == action]
        try:
            limit = int(request.args.get("limit", 50))
            offset = int(request.args.get("offset", 0))
        except (TypeError, ValueError):
            limit = 50
            offset = 0
        total = len(log_data)
        return {"data": log_data[offset : offset + limit], "total": total}

    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        entry = {
            "id": _new_id(),
            "actor": _current_user(),
            "action": (str(body.get("action", ""))).strip() or "log",
            "target_id": body.get("target_id"),
            "timestamp": _now_iso(),
            "before": body.get("before"),
            "after": body.get("after"),
        }
        state.setdefault("audit_log", []).insert(0, entry)
        state["audit_log"] = state["audit_log"][:5000]
        _save_state(state)
        return {"data": entry}

    return jsonify({"error": "Method not allowed"}), 405


def _import_vlans():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        return jsonify({"error": "Payload must be an object"}), 400
    records = body.get("vlans") if isinstance(body.get("vlans"), list) else (body if isinstance(body, list) else [])
    if not records and isinstance(body, dict):
        records = [body]
    if not isinstance(records, list):
        return jsonify({"error": "Payload must contain an array of VLANs"}), 400

    state = _load_state()
    vlans = state.setdefault("vlans", [])
    imported = 0
    errors = []
    now = _now_iso()
    for index, raw in enumerate(records):
        if not isinstance(raw, dict):
            errors.append({"index": index, "reason": "Not an object"})
            continue
        candidate = {
            "id": _new_id(),
            "created_at": now,
            "updated_at": now,
            "applied_cluster_ids": [],
            "last_applied_at": None,
        }
        for field in ["name", "vid", "subnet", "description", "tags", "color", "environment"]:
            if field in raw:
                candidate[field] = raw[field]
        errs = _validate_vlan(candidate, vlans)
        if errs:
            errors.append({"index": index, "reason": errs[0]})
            continue
        vlans.append(candidate)
        _audit("import", target_id=candidate["id"], after=_to_vlan_summary(candidate))
        imported += 1
    _save_state(state)
    return {"imported": imported, "errors": errors}


def _export_vlans():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    state = _load_state()
    vlans = state.get("vlans", [])
    fmt = (request.args.get("format") or "json").lower()
    if fmt == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["id", "name", "vid", "subnet", "description", "tags", "color", "environment"])
        for v in vlans:
            writer.writerow([
                v.get("id"),
                v.get("name"),
                v.get("vid"),
                v.get("subnet"),
                v.get("description"),
                ", ".join(v.get("tags", [])),
                v.get("color"),
                v.get("environment"),
            ])
        content = output.getvalue()
        return Response(content, mimetype="text/csv", headers={"Content-Disposition": "attachment; filename=vlans.csv"})

    return Response(
        json.dumps({"vlans": [_to_vlan_summary(v) for v in vlans]}, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=vlans.json"},
    )


def _schedule_handler():
    state = _load_state()
    if request.method == "GET":
        return {"data": state.get("schedule", {})}
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        schedule = state.setdefault("schedule", {})
        if "enabled" in body:
            schedule["enabled"] = bool(body["enabled"])
        if "interval_minutes" in body:
            try:
                schedule["interval_minutes"] = max(1, int(body["interval_minutes"]))
            except (TypeError, ValueError):
                schedule["interval_minutes"] = 60
        if "last_run_at" in body:
            schedule["last_run_at"] = body["last_run_at"]
        state["schedule"] = schedule
        _save_state(state)
        _audit("schedule", after=schedule)
        return {"data": schedule}
    return jsonify({"error": "Method not allowed"}), 405


def _topology_handler():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    state = _load_state()
    vlans = state.get("vlans", [])
    clusters = _get_clusters().get("data", [])
    links = []
    for v in vlans:
        for cid in v.get("applied_cluster_ids", []):
            links.append({"vlan_id": v.get("id"), "cluster_id": cid, "vid": v.get("vid"), "name": v.get("name")})
    return {
        "data": {
            "vlans": [_to_vlan_summary(v) for v in vlans],
            "clusters": clusters,
            "links": links,
        }
    }


def _dashboard_handler():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    state = _load_state()
    vlans = state.get("vlans", [])
    checks = state.get("compliance_checks", [])
    by_cluster = {}
    for v in vlans:
        for cid in v.get("applied_cluster_ids", []):
            by_cluster.setdefault(cid, []).append(v.get("id"))
    return {
        "data": {
            "total_vlans": len(vlans),
            "per_cluster": {cid: len(ids) for cid, ids in by_cluster.items()},
            "recent_checks": checks[:10],
        }
    }


def _get_ui():
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "vlans", _vlans_handler)
    register_plugin_route(PLUGIN_ID, "vlans/bulk-delete", _vlans_bulk_delete)
    register_plugin_route(PLUGIN_ID, "vlans/generate", _vlans_generate)
    register_plugin_route(PLUGIN_ID, "vlans/import", _import_vlans)
    register_plugin_route(PLUGIN_ID, "vlans/export", _export_vlans)
    register_plugin_route(PLUGIN_ID, "apply", _apply_handler)
    register_plugin_route(PLUGIN_ID, "apply/bulk", _apply_bulk)
    register_plugin_route(PLUGIN_ID, "compliance", _compliance_handler)
    register_plugin_route(PLUGIN_ID, "compliance/reapply", _compliance_reapply)
    register_plugin_route(PLUGIN_ID, "compliance/remove", _compliance_remove)
    register_plugin_route(PLUGIN_ID, "apply-history", _apply_history)
    register_plugin_route(PLUGIN_ID, "audit", _audit_handler)
    register_plugin_route(PLUGIN_ID, "schedule", _schedule_handler)
    register_plugin_route(PLUGIN_ID, "topology", _topology_handler)
    register_plugin_route(PLUGIN_ID, "dashboard", _dashboard_handler)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[%s] Plugin registered", PLUGIN_ID)
