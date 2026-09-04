# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/tape-library-manager/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: tape-library-manager — ProxmoxVEx Plugin
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
tape-library-manager — ProxmoxVEx Plugin
Manages tape drives, tape inventory, loads, ejects, audit, and bulk import/export.
"""

import csv
import io
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Response, jsonify, request, send_file

from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "tape-library-manager"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
INVENTORY_FILE = PLUGIN_DIR / "inventory.json"


# ---- helpers ----


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


_DEFAULT_DRIVES = [
    {
        "id": "drive0",
        "name": "LTO-0",
        "serial": "",
        "status": "empty",
        "loaded_tape": "",
        "load_count": 0,
        "eject_count": 0,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    },
    {
        "id": "drive1",
        "name": "LTO-1",
        "serial": "",
        "status": "empty",
        "loaded_tape": "",
        "load_count": 0,
        "eject_count": 0,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    },
]


def _new_uuid():
    return str(uuid.uuid4())


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
        log.error(f"save {path}: {e}")


def _load_inventory():
    return _load_json(INVENTORY_FILE, {"version": "1.0", "drives": [], "tapes": [], "activity": []})


def _save_inventory(data):
    data["updated_at"] = _now_iso()
    _save_json(INVENTORY_FILE, data)


def _ensure_inventory():
    if not INVENTORY_FILE.exists():
        _save_json(
            INVENTORY_FILE,
            {
                "version": "1.0",
                "updated_at": _now_iso(),
                "drives": list(_DEFAULT_DRIVES),
                "tapes": [],
                "activity": [],
            },
        )


def _current_user():
    return getattr(request, "session", {}).get("user", "system") or "system"


def _log_activity(data, action, drive_id=None, tape_id=None, details=None):
    entry = {
        "id": _new_uuid(),
        "action": action,
        "drive_id": drive_id or "",
        "tape_id": tape_id or "",
        "actor": _current_user(),
        "timestamp": _now_iso(),
        "details": details or {},
    }
    data.setdefault("activity", []).insert(0, entry)
    data["activity"] = data["activity"][:5000]


# ---- status ----


def _get_status():
    inv = _load_inventory()
    drives = inv.get("drives", [])
    tapes = inv.get("tapes", [])
    loaded = sum(1 for d in drives if d.get("status") == "loaded")
    retired = sum(1 for t in tapes if t.get("status") in ("retired", "bad"))
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "drives": len(drives),
        "tapes": len(tapes),
        "loaded_tapes": loaded,
        "retired_tapes": retired,
    }


# ---- drives ----


def _drives():
    data = _load_inventory()
    method = request.method

    if method == "GET":
        return {"drives": data.get("drives", [])}

    if method == "POST":
        body = request.get_json(silent=True) or {}
        drive_id = (body.get("id") or "").strip()
        name = (body.get("name") or "").strip()
        if not drive_id:
            return jsonify({"error": "id is required"}), 400
        if not name:
            return jsonify({"error": "name is required"}), 400
        if any(d.get("id") == drive_id for d in data.get("drives", [])):
            return jsonify({"error": f"drive id already exists: {drive_id}"}), 400
        drive = {
            "id": drive_id,
            "name": name,
            "serial": (body.get("serial") or "").strip(),
            "status": "empty",
            "loaded_tape": "",
            "load_count": 0,
            "eject_count": 0,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        data.setdefault("drives", []).append(drive)
        _log_activity(data, "add_drive", drive_id=drive_id)
        _save_inventory(data)
        return drive

    if method in ("PUT", "DELETE"):
        drive_id = (request.args.get("id") or (request.get_json(silent=True) or {}).get("id") or "").strip()
        if not drive_id:
            return jsonify({"error": "id is required"}), 400
        drives = data.get("drives", [])
        drive = next((d for d in drives if d.get("id") == drive_id), None)
        if not drive:
            return jsonify({"error": f"drive not found: {drive_id}"}), 404

        if method == "DELETE":
            if drive.get("status") != "empty" or drive.get("loaded_tape"):
                return jsonify({"error": "cannot delete a drive that is not empty"}), 400
            if any(a.get("drive_id") == drive_id for a in data.get("activity", [])):
                return jsonify({"error": "cannot delete a drive with activity history"}), 400
            data["drives"] = [d for d in drives if d.get("id") != drive_id]
            _log_activity(data, "delete_drive", drive_id=drive_id)
            _save_inventory(data)
            return {"deleted": drive_id}

        if method == "PUT":
            body = request.get_json(silent=True) or {}
            drive["name"] = (body.get("name") or drive["name"]).strip()
            drive["serial"] = (body.get("serial") or "").strip()
            if "status" in body and isinstance(body.get("status"), str):
                drive["status"] = body.get("status").strip() or drive["status"]
            drive["updated_at"] = _now_iso()
            _log_activity(data, "edit_drive", drive_id=drive_id, details={"name": drive["name"]})
            _save_inventory(data)
            return drive

    return jsonify({"error": "method not allowed"}), 405


# ---- tapes ----


def _get_tape_by_id(data, tape_id):
    return next((t for t in data.get("tapes", []) if t.get("id") == tape_id), None)


def _barcode_exists(data, barcode, exclude_id=None):
    return any(t.get("barcode") == barcode and t.get("id") != exclude_id for t in data.get("tapes", []))


def _normalize_tape(body, existing=None):
    now = _now_iso()
    tape = existing or {
        "id": _new_uuid(),
        "added_at": now,
        "use_count": 0,
        "last_used": None,
    }
    barcode = (body.get("barcode") or "").strip()
    tape["barcode"] = barcode
    tape["location"] = (body.get("location") or "shelf").strip()
    tape["status"] = body.get("status") or (existing.get("status") if existing else "shelf")
    tape["metadata"] = (
        body.get("metadata")
        if isinstance(body.get("metadata"), dict)
        else (existing.get("metadata") if existing else {})
    )
    tape["backup_job"] = (body.get("backup_job") or "").strip()
    tape["updated_at"] = now
    return tape


def _tapes():
    data = _load_inventory()
    method = request.method

    if method == "GET":
        tapes = list(data.get("tapes", []))
        location = (request.args.get("location") or "").strip().lower()
        status = (request.args.get("status") or "").strip().lower()
        search = (request.args.get("search") or "").strip().lower()
        sort = (request.args.get("sort") or "added_at").strip()
        order = (request.args.get("order") or "desc").strip().lower()
        limit = request.args.get("limit", type=int)
        offset = request.args.get("offset", type=int) or 0

        if location:
            tapes = [t for t in tapes if location in (t.get("location") or "").lower()]
        if status:
            tapes = [t for t in tapes if (t.get("status") or "").lower() == status]
        if search:
            tapes = [
                t
                for t in tapes
                if search in (t.get("barcode") or "").lower() or search in (t.get("location") or "").lower()
            ]

        reverse = order == "desc"
        sort_key = sort if sort in ("barcode", "location", "added_at", "updated_at", "last_used") else "added_at"
        tapes.sort(
            key=lambda t: (
                (t.get(sort_key) or "").lower() if isinstance(t.get(sort_key), str) else (t.get(sort_key) or "")
            ),
            reverse=reverse,
        )

        total = len(tapes)
        if limit:
            tapes = tapes[offset : offset + limit]
        return {"tapes": tapes, "total": total}

    if method == "POST":
        body = request.get_json(silent=True) or {}
        barcode = (body.get("barcode") or "").strip()
        if not barcode:
            return jsonify({"error": "barcode is required"}), 400
        if _barcode_exists(data, barcode):
            return jsonify({"error": f"barcode already exists: {barcode}"}), 400
        tape = _normalize_tape(body)
        data.setdefault("tapes", []).append(tape)
        _log_activity(data, "add", tape_id=tape["id"], details={"barcode": barcode})
        _save_inventory(data)
        return tape

    if method in ("PUT", "DELETE"):
        tape_id = (request.args.get("id") or (request.get_json(silent=True) or {}).get("id") or "").strip()
        if not tape_id:
            return jsonify({"error": "id is required"}), 400
        tape = _get_tape_by_id(data, tape_id)
        if not tape:
            return jsonify({"error": f"tape not found: {tape_id}"}), 404

        if method == "DELETE":
            loaded_in = next((d for d in data.get("drives", []) if d.get("loaded_tape") == tape_id), None)
            if loaded_in:
                return jsonify({"error": f"tape is currently loaded in drive {loaded_in.get('id')}"}), 400
            data["tapes"] = [t for t in data.get("tapes", []) if t.get("id") != tape_id]
            _log_activity(data, "delete", tape_id=tape_id, details={"barcode": tape.get("barcode")})
            _save_inventory(data)
            return {"deleted": tape_id}

        if method == "PUT":
            body = request.get_json(silent=True) or {}
            new_barcode = (body.get("barcode") or "").strip()
            if (
                new_barcode
                and new_barcode != tape.get("barcode")
                and _barcode_exists(data, new_barcode, exclude_id=tape_id)
            ):
                return jsonify({"error": f"barcode already exists: {new_barcode}"}), 400
            _normalize_tape(body, existing=tape)
            _log_activity(data, "edit", tape_id=tape_id, details={"barcode": tape.get("barcode")})
            _save_inventory(data)
            return tape

    return jsonify({"error": "method not allowed"}), 405


def _duplicate_tape():
    data = _load_inventory()
    body = request.get_json(silent=True) or {}
    tape_id = (body.get("id") or "").strip()
    if not tape_id:
        return jsonify({"error": "id is required"}), 400
    source = _get_tape_by_id(data, tape_id)
    if not source:
        return jsonify({"error": f"tape not found: {tape_id}"}), 404
    barcode = (body.get("barcode") or source.get("barcode") or "").strip()
    if not barcode or _barcode_exists(data, barcode):
        return jsonify({"error": f"duplicate barcode or barcode missing: {barcode}"}), 400
    tape = {
        "id": _new_uuid(),
        "barcode": barcode,
        "location": (body.get("location") or source.get("location") or "shelf").strip(),
        "status": "shelf",
        "use_count": 0,
        "last_used": None,
        "metadata": dict(source.get("metadata") or {}),
        "backup_job": (body.get("backup_job") or source.get("backup_job") or "").strip(),
        "added_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    data.setdefault("tapes", []).append(tape)
    _log_activity(data, "duplicate", tape_id=tape["id"], details={"source": tape_id, "barcode": tape["barcode"]})
    _save_inventory(data)
    return tape


def _tape_locations():
    data = _load_inventory()
    counts = {}
    for t in data.get("tapes", []):
        loc = t.get("location") or "unknown"
        counts[loc] = counts.get(loc, 0) + 1
    return {"locations": [{"name": k, "count": v} for k, v in sorted(counts.items())]}


# ---- load / eject ----


def _load():
    body = request.get_json(silent=True) or {}
    drive_id = (body.get("drive") or "").strip()
    tape_id = (body.get("tape") or "").strip()
    if not drive_id or not tape_id:
        return jsonify({"error": "drive and tape are required"}), 400

    data = _load_inventory()
    drive = next((d for d in data.get("drives", []) if d.get("id") == drive_id), None)
    if not drive:
        return jsonify({"error": f"drive not found: {drive_id}"}), 404
    if drive.get("status") == "maintenance":
        return jsonify({"error": "drive is in maintenance mode"}), 400
    if drive.get("status") == "loaded" or drive.get("loaded_tape"):
        return jsonify({"error": "drive already contains a tape"}), 400

    tape = _get_tape_by_id(data, tape_id)
    if not tape:
        return jsonify({"error": f"tape not found: {tape_id}"}), 404
    warning = f"tape is marked as {tape.get('status')}" if tape.get("status") in ("retired", "bad") else None

    now = _now_iso()
    drive["status"] = "loaded"
    drive["loaded_tape"] = tape_id
    drive["load_count"] = drive.get("load_count", 0) + 1
    drive["updated_at"] = now
    tape["status"] = "loaded"
    tape["location"] = f"drive:{drive_id}"
    tape["use_count"] = tape.get("use_count", 0) + 1
    tape["last_used"] = now
    tape["updated_at"] = now

    _log_activity(data, "load", drive_id=drive_id, tape_id=tape_id)
    _save_inventory(data)
    result = {"drive": drive_id, "tape": tape_id, "status": "loaded"}
    if warning:
        result["warning"] = warning
    return result


def _eject():
    body = request.get_json(silent=True) or {}
    drive_id = (body.get("drive") or "").strip()
    if not drive_id:
        return jsonify({"error": "drive is required"}), 400

    data = _load_inventory()
    drive = next((d for d in data.get("drives", []) if d.get("id") == drive_id), None)
    if not drive:
        return jsonify({"error": f"drive not found: {drive_id}"}), 404
    if drive.get("status") != "loaded" or not drive.get("loaded_tape"):
        return jsonify({"error": "drive is empty"}), 400

    tape_id = drive.get("loaded_tape")
    tape = _get_tape_by_id(data, tape_id)
    now = _now_iso()
    drive["status"] = "empty"
    drive["loaded_tape"] = ""
    drive["eject_count"] = drive.get("eject_count", 0) + 1
    drive["updated_at"] = now
    if tape:
        tape["status"] = "shelf"
        tape["location"] = (request.args.get("location") or tape.get("location") or "shelf").strip()
        tape["updated_at"] = now

    _log_activity(data, "eject", drive_id=drive_id, tape_id=tape_id)
    _save_inventory(data)
    return {"drive": drive_id, "status": "ejected"}


# ---- activity ----


def _activity():
    data = _load_inventory()
    activities = list(data.get("activity", []))
    drive_id = (request.args.get("drive") or "").strip()
    tape_id = (request.args.get("tape") or "").strip()
    action = (request.args.get("action") or "").strip().lower()
    limit = request.args.get("limit", type=int) or 50
    offset = request.args.get("offset", type=int) or 0

    if drive_id:
        activities = [a for a in activities if a.get("drive_id") == drive_id]
    if tape_id:
        activities = [a for a in activities if a.get("tape_id") == tape_id]
    if action:
        activities = [a for a in activities if a.get("action") == action]

    activities.sort(key=lambda a: a.get("timestamp") or "", reverse=True)
    total = len(activities)
    return {"activity": activities[offset : offset + limit], "total": total}


# ---- import / export ----


def _export_tapes():
    data = _load_inventory()
    fmt = (request.args.get("format") or "json").strip().lower()
    tapes = data.get("tapes", [])

    if fmt == "csv":
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow([
            "id",
            "barcode",
            "location",
            "status",
            "use_count",
            "last_used",
            "added_at",
            "updated_at",
            "backup_job",
        ])
        for t in tapes:
            writer.writerow([
                t.get("id"),
                t.get("barcode"),
                t.get("location"),
                t.get("status"),
                t.get("use_count", 0),
                t.get("last_used") or "",
                t.get("added_at"),
                t.get("updated_at"),
                t.get("backup_job", ""),
            ])
        return Response(
            out.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=tapes.csv"},
        )

    return jsonify({"tapes": tapes})


def _import_tapes():
    data = _load_inventory()
    body = request.get_json(silent=True) or {}
    fmt = (body.get("format") or "").strip().lower()
    raw = body.get("data") or ""
    mode = (body.get("mode") or "append").strip().lower()

    rows = []
    if fmt == "json":
        try:
            payload = json.loads(raw) if isinstance(raw, str) else raw
            rows = payload.get("tapes", payload) if isinstance(payload, dict) else payload
            if not isinstance(rows, list):
                return jsonify({"error": "JSON payload must contain a list of tapes"}), 400
        except Exception as e:
            return jsonify({"error": f"invalid JSON: {e}"}), 400
    elif fmt == "csv":
        try:
            reader = csv.DictReader(io.StringIO(raw))
            rows = list(reader)
        except Exception as e:
            return jsonify({"error": f"invalid CSV: {e}"}), 400
    else:
        return jsonify({"error": "format must be csv or json"}), 400

    if not rows:
        return jsonify({"imported": 0, "skipped": 0, "errors": [], "mode": mode})

    existing_barcodes = {t.get("barcode") for t in data.get("tapes", [])}
    imported = 0
    skipped = 0
    errors = []

    if mode == "replace":
        data["tapes"] = []
        existing_barcodes = set()

    for idx, row in enumerate(rows):
        barcode = (row.get("barcode") or "").strip()
        if not barcode:
            errors.append(f"row {idx}: barcode is empty")
            skipped += 1
            continue
        if barcode in existing_barcodes:
            errors.append(f"row {idx}: duplicate barcode {barcode}")
            skipped += 1
            continue
        tape = {
            "id": _new_uuid(),
            "barcode": barcode,
            "location": (row.get("location") or "shelf").strip() or "shelf",
            "status": (row.get("status") or "shelf").strip() or "shelf",
            "use_count": 0,
            "last_used": None,
            "backup_job": (row.get("backup_job") or "").strip(),
            "metadata": {},
            "added_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        data.setdefault("tapes", []).append(tape)
        existing_barcodes.add(barcode)
        imported += 1

    _log_activity(data, "import", details={"imported": imported, "skipped": skipped, "format": fmt})
    _save_inventory(data)
    return {"imported": imported, "skipped": skipped, "errors": errors, "mode": mode}


# ---- ui ----


def _get_ui():
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


# ---- registration ----


def register(app):
    _ensure_inventory()
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "drives", _drives)
    register_plugin_route(PLUGIN_ID, "tapes", _tapes)
    register_plugin_route(PLUGIN_ID, "tapes/duplicate", _duplicate_tape)
    register_plugin_route(PLUGIN_ID, "tapes/locations", _tape_locations)
    register_plugin_route(PLUGIN_ID, "tapes/import", _import_tapes)
    register_plugin_route(PLUGIN_ID, "tapes/export", _export_tapes)
    register_plugin_route(PLUGIN_ID, "load", _load)
    register_plugin_route(PLUGIN_ID, "eject", _eject)
    register_plugin_route(PLUGIN_ID, "activity", _activity)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s registered", PLUGIN_ID)
