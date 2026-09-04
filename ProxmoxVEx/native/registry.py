# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/registry.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Native integration route registry and catch-all API...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Native integration route registry and catch-all API dispatcher."""

import importlib
import importlib.util
import json
import logging
import os
import re
import threading

from flask import Blueprint, Response, request, send_file

from ProxmoxVEx.core.db import get_db
from ProxmoxVEx.services.licensing import LicensingService
from ProxmoxVEx.utils.auth import require_auth

_native_lock = threading.RLock()
_native_routes = {}

# Module IDs are sub-package names under ProxmoxVEx.native. Only allow
# Python-identifier-like names; block path traversal and dot-walking.
_VALID_MODULE_ID = re.compile(r"\A[A-Za-z_][A-Za-z0-9_]{0,99}\Z")
# Subpaths are route keys registered by native modules (e.g. "config", "config/save").
_VALID_SUBPATH = re.compile(r"\A[A-Za-z0-9_/.-]{1,200}\Z")

bp = Blueprint("native", __name__)


def _json_response(data, status=200):
    """Return a JSON Response without taint-carrying formatting."""
    return Response(json.dumps(data, default=str), status=status, mimetype="application/json")


def _bad_request(message):
    """Return a 400 JSON Response with a static message."""
    return _json_response({"error": message}, status=400)


def _dispatch_handler_result(result):
    """Normalize a native handler's return value into a safe Flask Response.

    Lists/dicts are JSON-encoded.  Explicit Response objects are passed
    through (so a handler can still return HTML or files via send_file).
    Bare strings are served as text/plain so a user-influenced string
    cannot be rendered as HTML in the browser.
    """
    if isinstance(result, (dict, list)):
        return _json_response(result)
    if isinstance(result, Response):
        return result
    if isinstance(result, str):
        return Response(result, mimetype="text/plain")
    return result


def register_native_route(module_id, path, handler):
    """Register a native integration route handler."""
    with _native_lock:
        _native_routes.setdefault(module_id, {})[path] = handler


def _license_gate(module_id):
    """Check the active license tier before dispatching a native integration request.

    Re-checked on every request so a tier downgrade/expiry blocks new
    activity immediately (native integrations are always registered at
    import time, so there's no separate "load" step to gate like plugins/).
    Returns None if allowed, or a Response if blocked.
    """
    try:
        allowed = LicensingService().can_use_native(get_db(), module_id)
    except Exception as e:
        # Fail open on licensing-service errors so an outage doesn't take
        # down unrelated native integrations.
        logging.warning("[NATIVE] License guard skipped for %s: %s", module_id, e)
        return None
    if allowed:
        return None
    from ProxmoxVEx.models.plugins import get_native_tier_requirement

    required = get_native_tier_requirement(module_id)
    return _json_response(
        {"error": "License upgrade required for this integration", "required_tier": required},
        status=402,
    )


@bp.route("/api/<module_id>/<path:subpath>", methods=["GET", "POST", "PUT", "DELETE"])
@require_auth(perms=["plugins.view"])
def native_proxy(module_id, subpath):
    """Dispatch native integration API requests."""
    if not _VALID_MODULE_ID.match(module_id):
        return _bad_request("Invalid module_id")
    if not _VALID_SUBPATH.match(subpath):
        return _bad_request("Invalid subpath")

    blocked = _license_gate(module_id)
    if blocked:
        return blocked

    with _native_lock:
        handler = _native_routes.get(module_id, {}).get(subpath)

    if not handler:
        # Serve any sibling .css/.js asset from the native module directory.
        # This supports the standard ui.css/ui.js as well as named assets that
        # match the native HTML page (e.g. active_directory.css, vyos.js).
        if (
            request.method == "GET"
            and subpath.endswith((".css", ".js"))
            and "/" not in subpath
            and ".." not in subpath
            and not subpath.startswith(".")
        ):
            spec = importlib.util.find_spec(f"ProxmoxVEx.native.{module_id}")
            if spec and spec.origin:
                static_path = os.path.join(os.path.dirname(spec.origin), subpath)
                if os.path.isfile(static_path):
                    mimetype = "text/css" if subpath.endswith(".css") else "text/javascript"
                    return send_file(static_path, mimetype=mimetype)
        logging.info("[NATIVE] Route not found: %s", subpath)
        return _json_response({"error": "Route not found"}, status=404)

    try:
        result = handler()
        return _dispatch_handler_result(result)
    except Exception as e:
        logging.error("[NATIVE] %s/%s error: %s", module_id, subpath, e)
        return _json_response({"error": "Native request failed"}, status=500)


def _native_config_path(module_id):
    """Resolve the config.json path for a native module."""
    if not _VALID_MODULE_ID.match(module_id):
        raise ValueError("Invalid module_id")
    mod = importlib.import_module(f"ProxmoxVEx.native.{module_id}")
    return os.path.join(os.path.dirname(mod.__file__), "config.json")


@bp.route("/api/native/<module_id>/config", methods=["GET", "POST"])
@require_auth(perms=["admin.settings"])
def native_config(module_id):
    """Read or write a native integration's config.

    Delegates to module-specific ``config`` / ``config/save`` handlers when
    they are registered so encryption, masking and validation are preserved.
    Falls back to raw ``config.json`` read/write for modules without custom
    handlers.
    """
    if not _VALID_MODULE_ID.match(module_id):
        return _bad_request("Invalid module_id")

    with _native_lock:
        module_routes = _native_routes.get(module_id, {})
        config_handler = module_routes.get("config")
        save_handler = module_routes.get("config/save")

    if request.method == "GET" and config_handler:
        try:
            result = config_handler()
            return _dispatch_handler_result(result)
        except Exception as e:
            logging.error("[NATIVE] %s config handler error: %s", module_id, e)
            return _json_response({"error": "Failed to load config"}, status=500)

    if request.method == "POST" and save_handler:
        try:
            result = save_handler()
            return _dispatch_handler_result(result)
        except Exception as e:
            logging.error("[NATIVE] %s config/save handler error: %s", module_id, e)
            return _json_response({"error": "Failed to save config"}, status=500)

    cfg_path = _native_config_path(module_id)
    if request.method == "GET":
        if not os.path.exists(cfg_path):
            return _json_response({})
        try:
            with open(cfg_path) as f:
                return _json_response(json.load(f))
        except Exception as e:
            logging.error("[NATIVE] %s config read error: %s", module_id, e)
            return _json_response({"error": "Failed to read config"}, status=500)

    data = request.get_json(silent=True)
    if data is None:
        return _bad_request("Invalid JSON body")
    try:
        os.makedirs(os.path.dirname(cfg_path), exist_ok=True)
        with open(cfg_path, "w") as f:
            json.dump(data, f, indent=2)
        return _json_response({"ok": True})
    except Exception as e:
        logging.error("[NATIVE] %s config write error: %s", module_id, e)
        return _json_response({"error": "Failed to write config"}, status=500)


def _native_i18n_path(module_id, lang):
    """Resolve a native integration i18n JSON path."""
    if not _VALID_MODULE_ID.match(module_id):
        raise ValueError("Invalid module_id")
    mod = importlib.import_module(f"ProxmoxVEx.native.{module_id}")
    return os.path.join(os.path.dirname(mod.__file__), "i18n", f"{lang}.json")


@bp.route("/api/native/<module_id>/i18n/<lang>.json", methods=["GET"])
@require_auth(perms=["plugins.view"])
def native_i18n(module_id, lang):
    """Serve a native integration's per-language i18n JSON from its i18n/ directory."""
    if not _VALID_MODULE_ID.match(module_id):
        return _bad_request("Invalid module_id")
    if not re.match(r"^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)*$", lang):
        return _bad_request("Invalid language")
    i18n_path = _native_i18n_path(module_id, lang)
    if not os.path.isfile(i18n_path):
        return _json_response({}, status=404)
    try:
        with open(i18n_path, encoding="utf-8") as f:
            data = json.load(f)
        return _json_response(data)
    except Exception as e:
        logging.error("[NATIVE] i18n/%s/%s.json error: %s", module_id, lang, e)
        return _json_response({"error": "Failed to read i18n file"}, status=500)
