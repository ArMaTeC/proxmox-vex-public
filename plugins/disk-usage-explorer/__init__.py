# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/disk-usage-explorer/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Disk Usage Explorer — interactive filesystem treeview...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Disk Usage Explorer — interactive filesystem treeview plugin.

Lets an admin browse the host filesystem (lazily, one directory level at a
time) and see where disk space is used, restricted to admin-configured
allowed root path(s). See specs/001-filesystem-treeview/ for the full spec,
plan, and API contract this plugin implements.
"""

import contextlib
import csv
import io
import json
import logging
import os
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, make_response, request, send_file, send_from_directory

from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.utils.audit import log_audit

from . import fs_scan

PLUGIN_ID = "disk-usage-explorer"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent

# Persist plugin config and default data across container recreates by keeping
# them on the ProxmoxVEx-config volume (/app/config) instead of the image.
_PLUGIN_CONFIG_DIR = Path("/app/config/plugins/disk-usage-explorer")
_PLUGIN_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_PATH = _PLUGIN_CONFIG_DIR / "config.json"
DEFAULT_DATA_DIR = _PLUGIN_CONFIG_DIR / "data"
SCAN_LOG_FILE = DEFAULT_DATA_DIR / "scan.log"

# One-time migration: copy a config file bundled in the image to the persistent
# location so fresh deployments still have safe defaults.
if not CONFIG_PATH.exists():
    _bundled_config = PLUGIN_DIR / "config.json"
    if _bundled_config.exists():
        DEFAULT_DATA_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(_bundled_config, CONFIG_PATH)

# Shared state for the optional background precompute scan. Guarded by its own
# lock so the status endpoint is always consistent even if the thread updates
# progress concurrently.
_PRECOMPUTE_LOCK = threading.Lock()
_PRECOMPUTE_STATE = {}
_PRECOMPUTE_THREAD = None


def _current_user():
    return getattr(request, "session", {}).get("user", "unknown")


def _audit_denied(raw_path, reason):
    """Log a rejected out-of-bounds path attempt (FR-011)."""
    user = _current_user()
    with contextlib.suppress(Exception):
        log_audit(user, "disk_usage_explorer.path_denied", f"path={raw_path!r} reason={reason}")


def _ensure_default_config():
    """Seed config.json with safe defaults on first load and backfill any
    missing keys on subsequent loads.

    New settings (e.g. full_scan_budget_ms, auto_precompute) are written to
    existing configs so precompute and UI behavior is consistent after upgrades.
    If allowed_roots is empty/missing, default to the plugin's own `data/`
    subdirectory rather than the OS root, per FR-013 (Security First: no
    silent widening of scope). Admins can broaden this later via the
    existing generic plugin config editor (PUT /api/plugins/<id>/config).
    """
    raw = _read_raw_config()
    defaults = {
        "excluded_patterns": [],
        "cache_ttl_s": 300,
        "max_children_per_page": 2000,
        "scan_budget_ms": 2500,
        "full_scan_budget_ms": 300000,
        "scan_user": "",
        "scan_password": "",
        "auto_precompute": True,
    }

    updated = False
    for key, value in defaults.items():
        if key not in raw:
            raw[key] = value
            updated = True

    if not raw.get("allowed_roots"):
        try:
            DEFAULT_DATA_DIR.mkdir(parents=True, exist_ok=True)
            readme = DEFAULT_DATA_DIR / "README.txt"
            if not readme.exists():
                readme.write_text(
                    "This is the default sandboxed root for the Disk Usage Explorer plugin.\n"
                    "Add real host paths to 'allowed_roots' in this plugin's settings to browse more.\n",
                    encoding="utf-8",
                )
        except OSError as e:
            log.warning("[%s] Failed to prepare default data dir: %s", PLUGIN_ID, e)
            return

        raw["allowed_roots"] = [str(DEFAULT_DATA_DIR)]
        updated = True

    if updated:
        try:
            CONFIG_PATH.write_text(json.dumps(raw, indent=4), encoding="utf-8")
        except OSError as e:
            log.warning("[%s] Failed to write config.json: %s", PLUGIN_ID, e)


def _read_raw_config():
    if not CONFIG_PATH.exists():
        return {}
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f) or {}
    except (OSError, json.JSONDecodeError) as e:
        log.error("[%s] Failed to read config.json: %s", PLUGIN_ID, e)
        return {}


def _load_config_or_error():
    """Return (config, error_response). error_response is None on success."""
    raw = _read_raw_config()
    try:
        return fs_scan.load_scan_config(raw), None
    except fs_scan.ConfigError as e:
        log.warning("[%s] Invalid scan configuration: %s", PLUGIN_ID, e)
        return None, (jsonify({"error": str(e)}), 409)


def _resolve_or_error(raw_path, config):
    """Return (canonical_path, error_response). error_response is None on success."""
    try:
        return fs_scan.resolve_and_check_path(raw_path, config["allowed_roots"]), None
    except fs_scan.PathNotAllowedError as e:
        _audit_denied(raw_path, str(e))
        return None, (jsonify({"error": "Path is outside the configured allowed roots"}), 403)


def _h_list():
    """GET /api/plugins/disk-usage-explorer/api/list — list a directory's immediate children."""
    config, err = _load_config_or_error()
    if err:
        return err

    raw_path = request.args.get("path") or config["allowed_roots"][0]
    sort = request.args.get("sort", "size")
    if sort not in fs_scan.SORT_MODES:
        sort = "size"

    try:
        page = max(1, int(request.args.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    page_size = None
    page_size_raw = request.args.get("page_size")
    if page_size_raw:
        try:
            page_size = max(1, int(page_size_raw))
        except (TypeError, ValueError):
            page_size = None

    canonical, err = _resolve_or_error(raw_path, config)
    if err:
        return err
    canonical = os.path.realpath(canonical)  # SAST sanitizer; fs_scan already validated

    if not os.path.exists(canonical):
        return jsonify({"error": "Path does not exist"}), 404
    if not os.path.isdir(canonical):
        return jsonify({"error": "Path is not a directory"}), 400

    try:
        result = fs_scan.list_children(canonical, config, sort=sort, page=page, page_size=page_size)
    except OSError as e:
        log.error("[%s] list failed for %s: %s", PLUGIN_ID, canonical, e)
        return jsonify({"error": "Failed to list directory"}), 500

    return jsonify(result)


def _h_size():
    """POST /api/plugins/disk-usage-explorer/api/size — explicitly (re)compute a directory's size."""
    config, err = _load_config_or_error()
    if err:
        return err

    body = request.get_json(silent=True) or {}
    raw_path = (body.get("path") or "").strip()
    if not raw_path:
        return jsonify({"error": "path is required"}), 400

    canonical, err = _resolve_or_error(raw_path, config)
    if err:
        return err
    canonical = os.path.realpath(canonical)  # SAST sanitizer; fs_scan already validated

    if not os.path.exists(canonical):
        return jsonify({"error": "Path does not exist"}), 404
    if not os.path.isdir(canonical):
        return jsonify({"error": "Path is not a directory"}), 400

    try:
        size_bytes, entry_count, status = fs_scan.get_or_compute_size(canonical, config, force=True)
    except OSError as e:
        log.error("[%s] size refresh failed for %s: %s", PLUGIN_ID, canonical, e)
        return jsonify({"error": "Failed to compute size"}), 500

    return jsonify({
        "path": canonical,
        "size_bytes": size_bytes,
        "entry_count": entry_count,
        "scan_status": status,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    })


def _h_top():
    """GET /api/plugins/disk-usage-explorer/api/top — largest files and directories under a path."""
    config, err = _load_config_or_error()
    if err:
        return err

    raw_path = request.args.get("path") or config["allowed_roots"][0]
    canonical, err = _resolve_or_error(raw_path, config)
    if err:
        return err
    canonical = os.path.realpath(canonical)  # SAST sanitizer; fs_scan already validated

    if not os.path.exists(canonical):
        return jsonify({"error": "Path does not exist"}), 404
    if not os.path.isdir(canonical):
        return jsonify({"error": "Path is not a directory"}), 400

    try:
        n = max(1, int(request.args.get("n", 20)))
    except (TypeError, ValueError):
        n = 20

    try:
        result = fs_scan.top_entries(canonical, config, n=n)
    except OSError as e:
        log.error("[%s] top failed for %s: %s", PLUGIN_ID, canonical, e)
        return jsonify({"error": "Failed to scan for top entries"}), 500

    return jsonify(result)


def _h_types():
    """GET /api/plugins/disk-usage-explorer/api/types — file type breakdown under a path."""
    config, err = _load_config_or_error()
    if err:
        return err

    raw_path = request.args.get("path") or config["allowed_roots"][0]
    canonical, err = _resolve_or_error(raw_path, config)
    if err:
        return err
    canonical = os.path.realpath(canonical)  # SAST sanitizer; fs_scan already validated

    if not os.path.exists(canonical):
        return jsonify({"error": "Path does not exist"}), 404
    if not os.path.isdir(canonical):
        return jsonify({"error": "Path is not a directory"}), 400

    try:
        result = fs_scan.type_breakdown(canonical, config)
    except OSError as e:
        log.error("[%s] types failed for %s: %s", PLUGIN_ID, canonical, e)
        return jsonify({"error": "Failed to scan file types"}), 500

    return jsonify(result)


def _h_export():
    """GET /api/plugins/disk-usage-explorer/api/export — download current children as JSON or CSV."""
    config, err = _load_config_or_error()
    if err:
        return err

    raw_path = request.args.get("path") or config["allowed_roots"][0]
    fmt = (request.args.get("format") or "json").lower()
    if fmt not in ("json", "csv"):
        fmt = "json"

    canonical, err = _resolve_or_error(raw_path, config)
    if err:
        return err
    canonical = os.path.realpath(canonical)  # SAST sanitizer; fs_scan already validated

    if not os.path.exists(canonical):
        return jsonify({"error": "Path does not exist"}), 404
    if not os.path.isdir(canonical):
        return jsonify({"error": "Path is not a directory"}), 400

    try:
        data = fs_scan.list_children(canonical, config, sort="size")
    except OSError as e:
        log.error("[%s] export failed for %s: %s", PLUGIN_ID, canonical, e)
        return jsonify({"error": "Failed to export directory"}), 500

    if fmt == "json":
        response = make_response(json.dumps(data, indent=2), 200)
        response.headers["Content-Type"] = "application/json"
        response.headers["Content-Disposition"] = (
            f'attachment; filename="disk_usage_{os.path.basename(canonical) or "root"}.json"'
        )
        return response

    # CSV export of the children list
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([
        "name",
        "type",
        "size_bytes",
        "size_on_disk_bytes",
        "percent_of_parent",
        "scan_status",
        "modified_at",
        "path",
    ])
    for child in data.get("children", []):
        writer.writerow([
            child.get("name"),
            child.get("type"),
            child.get("size_bytes"),
            child.get("size_on_disk_bytes"),
            child.get("percent_of_parent"),
            child.get("scan_status"),
            child.get("modified_at"),
            child.get("path"),
        ])
    response = make_response(out.getvalue(), 200)
    response.headers["Content-Type"] = "text/csv"
    response.headers["Content-Disposition"] = (
        f'attachment; filename="disk_usage_{os.path.basename(canonical) or "root"}.csv"'
    )
    return response


def _h_precompute():
    """POST /api/plugins/disk-usage-explorer/api/precompute — start a background full-size scan."""
    global _PRECOMPUTE_THREAD
    config, err = _load_config_or_error()
    if err:
        return err

    body = request.get_json(silent=True) or {}
    raw_path = (body.get("path") or "").strip()
    if not raw_path:
        raw_path = config["allowed_roots"][0]

    canonical, err = _resolve_or_error(raw_path, config)
    if err:
        return err
    canonical = os.path.realpath(canonical)  # SAST sanitizer; fs_scan already validated

    if not os.path.exists(canonical):
        return jsonify({"error": "Path does not exist"}), 404
    if not os.path.isdir(canonical):
        return jsonify({"error": "Path is not a directory"}), 400

    with _PRECOMPUTE_LOCK:
        if _PRECOMPUTE_STATE.get("status") == "running":
            return jsonify({"error": "A scan is already in progress"}), 409
        _PRECOMPUTE_STATE.clear()
        _PRECOMPUTE_STATE["root"] = canonical
        _PRECOMPUTE_STATE["status"] = "running"
        _PRECOMPUTE_STATE["directories"] = 0
        _PRECOMPUTE_STATE["files"] = 0
        _PRECOMPUTE_STATE["bytes"] = 0
        _PRECOMPUTE_STATE["current_path"] = canonical
        _PRECOMPUTE_STATE["complete"] = False

    def _worker():
        try:
            fs_scan.precompute_directory_sizes(canonical, config, _PRECOMPUTE_STATE)
        except Exception as e:
            log.error("[%s] precompute failed: %s", PLUGIN_ID, e)
            with _PRECOMPUTE_LOCK:
                _PRECOMPUTE_STATE["status"] = "error"
                _PRECOMPUTE_STATE["error"] = str(e)
                _PRECOMPUTE_STATE["complete"] = True

    _PRECOMPUTE_THREAD = threading.Thread(target=_worker, name="disk-usage-precompute", daemon=True)
    _PRECOMPUTE_THREAD.start()
    return jsonify({"status": "started", "root": canonical})


def _h_precompute_status():
    """GET /api/plugins/disk-usage-explorer/api/precompute/status — current scan progress."""
    with _PRECOMPUTE_LOCK:
        return jsonify(dict(_PRECOMPUTE_STATE))


MAX_INLINE_BYTES = 2 * 1024 * 1024
TAIL_LINES = 1000


def _h_content():
    """GET /api/plugins/disk-usage-explorer/api/content — read a text/log file."""
    config, err = _load_config_or_error()
    if err:
        return err

    raw_path = request.args.get("path", "").strip()
    if not raw_path:
        return jsonify({"error": "path is required"}), 400

    canonical, err = _resolve_or_error(raw_path, config)
    if err:
        return err
    # Resolve symlinks and re-validate containment with a standard-library
    # check so SAST taint tracking sees the path as sanitized before open().
    canonical = os.path.realpath(canonical)
    _allowed = False
    for _root in config["allowed_roots"]:
        try:
            if os.path.commonpath([canonical, _root]) == _root:
                _allowed = True
                break
        except ValueError:
            pass
    if not _allowed:
        _audit_denied(raw_path, "path is outside all configured allowed roots")
        return jsonify({"error": "Path is outside the configured allowed roots"}), 403

    if not os.path.exists(canonical):
        return jsonify({"error": "Path does not exist"}), 404
    if not os.path.isfile(canonical):
        return jsonify({"error": "Path is not a file"}), 400

    tail = request.args.get("tail", "1").isdigit() and int(request.args.get("tail", "0")) or TAIL_LINES
    try:
        with open(canonical, encoding="utf-8", errors="replace") as f:
            if tail:
                lines = f.readlines()
                content = "".join(lines[-tail:])
            else:
                content = f.read(MAX_INLINE_BYTES)
                if len(content) >= MAX_INLINE_BYTES:
                    content = content[:MAX_INLINE_BYTES] + "\n\n[... truncated ...]"
    except OSError as e:
        log.error("[%s] content failed for %s: %s", PLUGIN_ID, canonical, e)
        return jsonify({"error": "Failed to read file"}), 500

    log_audit(_current_user(), "disk_usage_explorer.file_viewed", f"path={raw_path}")
    return jsonify({
        "name": os.path.basename(canonical),
        "path": raw_path,
        "size_bytes": os.path.getsize(canonical),
        "content": content,
    })


def _h_download():
    """GET /api/plugins/disk-usage-explorer/api/download — download a file."""
    config, err = _load_config_or_error()
    if err:
        return err

    raw_path = request.args.get("path", "").strip()
    if not raw_path:
        return jsonify({"error": "path is required"}), 400

    canonical, err = _resolve_or_error(raw_path, config)
    if err:
        return err

    # Resolve symlinks and re-validate containment. We then serve the file with
    # send_from_directory so Werkzeug's safe_join enforces the sandbox again
    # and removes Snyk's taint on the first argument to send_file.
    canonical = os.path.realpath(canonical)
    allowed_root = None
    for _root in config["allowed_roots"]:
        try:
            if os.path.commonpath([canonical, _root]) == _root:
                allowed_root = _root
                break
        except ValueError:
            pass
    if not allowed_root:
        _audit_denied(raw_path, "path is outside all configured allowed roots")
        return jsonify({"error": "Path is outside the configured allowed roots"}), 403

    if not os.path.exists(canonical) or not os.path.isfile(canonical):
        return jsonify({"error": "File not found"}), 404

    rel = os.path.relpath(canonical, allowed_root)
    if os.path.isabs(rel) or rel.startswith(".."):
        _audit_denied(raw_path, "computed relative path escapes allowed root")
        return jsonify({"error": "Path is outside the configured allowed roots"}), 403

    log_audit(_current_user(), "disk_usage_explorer.file_downloaded", f"path={raw_path}")
    return send_from_directory(allowed_root, rel, as_attachment=True, download_name=os.path.basename(rel))


def _h_status():
    """Return plugin status and precompute progress."""
    with _PRECOMPUTE_LOCK:
        precompute = dict(_PRECOMPUTE_STATE)
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "precompute": precompute,
    }


def _h_ui():
    """GET /api/plugins/disk-usage-explorer/api/ui — serve the iframe frontend."""
    return send_file(PLUGIN_DIR / "ui.html")


def _setup_scan_logging():
    """Mirror the scan logger to a dedicated file so operators can debug permission issues.

    The handler is isolated from the root logger to avoid duplicating the same
    messages into the main ProxmoxVEx log files and creating I/O feedback loops.
    """
    try:
        DEFAULT_DATA_DIR.mkdir(parents=True, exist_ok=True)
        scan_logger = logging.getLogger("plugin.disk-usage-explorer")
        scan_logger.setLevel(logging.DEBUG)
        scan_logger.propagate = False
        for h in scan_logger.handlers:
            if isinstance(h, logging.FileHandler) and h.baseFilename == str(SCAN_LOG_FILE):
                return
        # Only warning/error and key lifecycle events go to the scan log. Per-call
        # debug noise is controlled by the per-line log level in fs_scan.py.
        fh = logging.FileHandler(SCAN_LOG_FILE, mode="a", encoding="utf-8")
        fh.setLevel(logging.INFO)
        fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        scan_logger.addHandler(fh)
    except OSError as e:
        log.warning("[%s] Failed to set up scan log file: %s", PLUGIN_ID, e)


def _h_scan_log():
    """GET /api/plugins/disk-usage-explorer/api/scan_log — return the dedicated scan log."""
    if not _has_log_access():
        return jsonify({"error": "Admin access required"}), 403
    if not SCAN_LOG_FILE.exists():
        return jsonify({
            "name": "scan.log",
            "path": str(SCAN_LOG_FILE),
            "size_bytes": 0,
            "content": "(no scan log yet)",
        })
    tail = request.args.get("tail", "1").isdigit() and int(request.args.get("tail", "0")) or TAIL_LINES
    try:
        with open(SCAN_LOG_FILE, encoding="utf-8", errors="replace") as f:
            if tail:
                lines = f.readlines()
                content = "".join(lines[-tail:])
            else:
                content = f.read(MAX_INLINE_BYTES)
                if len(content) >= MAX_INLINE_BYTES:
                    content = content[:MAX_INLINE_BYTES] + "\n\n[... truncated ...]"
    except OSError as e:
        log.error("[%s] scan_log read failed: %s", PLUGIN_ID, e)
        return jsonify({"error": "Failed to read scan log"}), 500
    return jsonify({
        "name": SCAN_LOG_FILE.name,
        "path": str(SCAN_LOG_FILE),
        "size_bytes": SCAN_LOG_FILE.stat().st_size,
        "content": content,
    })


def _h_config():
    """GET/PUT /api/plugins/disk-usage-explorer/api/config — persistent plugin config."""
    if request.method == "PUT":
        data = request.get_json() or {}
        raw = data.get("config", "")
        if not raw:
            return jsonify({"error": "Empty config"}), 400
        try:
            json.loads(raw)
        except json.JSONDecodeError:
            return jsonify({"error": "Invalid JSON"}), 400
        try:
            CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            CONFIG_PATH.write_text(raw, encoding="utf-8")
            _ensure_default_config()
        except OSError as e:
            log.error("[%s] config write failed: %s", PLUGIN_ID, e)
            return jsonify({"error": "Failed to write config"}), 500
        log_audit(_current_user(), "plugins.config_saved", f"Updated config for plugin: {PLUGIN_ID}")
        return jsonify({"success": True})

    if not CONFIG_PATH.exists():
        return jsonify({"config": "{}"})
    try:
        return jsonify({"config": CONFIG_PATH.read_text(encoding="utf-8")})
    except OSError as e:
        log.error("[%s] config read failed: %s", PLUGIN_ID, e)
        return jsonify({"error": "Failed to read config"}), 500


# Shared helper with _h_content/_h_download


def _has_log_access():
    user = _current_user()
    perms = getattr(user, "permissions", []) if not isinstance(user, dict) else user.get("permissions", [])
    if isinstance(perms, str):
        try:
            import json

            perms = json.loads(perms)
        except (json.JSONDecodeError, TypeError):
            perms = []
    role = user.get("role") if isinstance(user, dict) else getattr(user, "role", None)
    return role == "admin" or "admin.logs" in perms


def register(app):
    """Called by ProxmoxVEx when the plugin is loaded/enabled."""
    _ensure_default_config()
    _setup_scan_logging()

    register_plugin_route(PLUGIN_ID, "status", _h_status)
    register_plugin_route(PLUGIN_ID, "list", _h_list)
    register_plugin_route(PLUGIN_ID, "size", _h_size)
    register_plugin_route(PLUGIN_ID, "top", _h_top)
    register_plugin_route(PLUGIN_ID, "types", _h_types)
    register_plugin_route(PLUGIN_ID, "export", _h_export)
    register_plugin_route(PLUGIN_ID, "precompute", _h_precompute)
    register_plugin_route(PLUGIN_ID, "precompute_status", _h_precompute_status)
    register_plugin_route(PLUGIN_ID, "content", _h_content)
    register_plugin_route(PLUGIN_ID, "download", _h_download)
    register_plugin_route(PLUGIN_ID, "scan_log", _h_scan_log)
    register_plugin_route(PLUGIN_ID, "config", _h_config)
    register_plugin_route(PLUGIN_ID, "ui", _h_ui)

    log.info("[PLUGINS] Disk Usage Explorer registered (UI: /api/plugins/%s/api/ui)", PLUGIN_ID)
