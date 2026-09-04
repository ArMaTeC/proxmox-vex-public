# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/active_directory/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Package initializer for active_directory
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
import json
import logging
import os
import sys
from typing import Any, Callable

PLUGIN_ID = "active_directory"
PLUGIN_NAME = "Active Directory"
PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_DIR = os.path.join(PLUGIN_DIR, "state")
CONFIG_PATH = os.path.join(PLUGIN_DIR, "config.json")
HOSTS_KEY = "ad_hosts"
SECRET_KEYS = ["bind_password"]

if PLUGIN_DIR not in sys.path:
    sys.path.insert(0, PLUGIN_DIR)

from ad_src.client import ADHost  # noqa: E402

register_native_route: Callable[[Any, Any, Any], Any] | None = None
try:  # pragma: no cover - optional framework deps
    from flask import Response, send_file

    from ProxmoxVEx.native.registry import register_native_route as _register_native_route

    register_native_route = _register_native_route
except ImportError:  # pragma: no cover
    pass

log = logging.getLogger(f"native.{PLUGIN_ID}")


def _load_config():
    """Load plugin config from CONFIG_PATH (JSON). Returns dict with defaults."""
    os.makedirs(STATE_DIR, exist_ok=True)
    if not os.path.exists(CONFIG_PATH):
        return {HOSTS_KEY: [], "poll_interval": 30, "read_only": False}
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        log.error("Failed to load config: %s", e)
        return {HOSTS_KEY: [], "poll_interval": 30, "read_only": False}


def _require_admin():
    """Return a 403 Flask response if the current user is not an admin."""
    from flask import jsonify, request

    from ProxmoxVEx.models.permissions import ROLE_ADMIN
    from ProxmoxVEx.utils.auth import load_users

    username = request.session.get("user", "")
    users = load_users()
    if users.get(username, {}).get("role") != ROLE_ADMIN:
        return jsonify({"error": "Admin access required"}), 403
    return None


def _host_lookup_key(h):
    """Stable lookup key for matching a host in the saved config."""
    return str(h.get("url", h.get("name", ""))).rstrip("/")


def _host_from_dict(h: dict):
    """Convert a config.json host entry into a typed ADHost."""
    return ADHost(
        name=str(h.get("name", "ad")),
        server=str(h.get("server", "")),
        port=int(h.get("port", 636)),
        use_ssl=bool(h.get("use_ssl", True)),
        bind_dn=str(h.get("bind_dn", "")),
        bind_password=str(h.get("bind_password", "")),
        base_dn=str(h.get("base_dn", "")),
        verify_tls=bool(h.get("verify_tls", True)),
    )


def _h_health():
    cfg = _load_config()
    return {
        "plugin": PLUGIN_ID,
        "version": "0.1.0",
        "configured": bool(cfg.get(HOSTS_KEY)),
        "read_only": cfg.get("read_only", False),
        "hosts_configured": len(cfg.get(HOSTS_KEY) or []),
    }


def _h_ui():
    return send_file(os.path.join(PLUGIN_DIR, "active_directory.html"), mimetype="text/html")


def _unconfigured_response():
    from flask import jsonify

    return jsonify({"ok": False, "error": "unconfigured", "detail": f"No {HOSTS_KEY} in config.json"}), 400


def _h_overview():
    from ad_src.routes.overview import build_overview_payload
    from flask import jsonify

    cfg = _load_config()
    hosts = cfg.get(HOSTS_KEY) or []
    if not hosts:
        return _unconfigured_response()
    host = _host_from_dict(hosts[0])
    status, payload = build_overview_payload(host)
    return jsonify(payload), status


def _h_users():
    from ad_src.routes.overview import build_users_payload
    from flask import jsonify

    cfg = _load_config()
    hosts = cfg.get(HOSTS_KEY) or []
    if not hosts:
        return _unconfigured_response()
    host = _host_from_dict(hosts[0])
    status, payload = build_users_payload(host)
    return jsonify(payload), status


def _h_groups():
    from ad_src.routes.overview import build_groups_payload
    from flask import jsonify

    cfg = _load_config()
    hosts = cfg.get(HOSTS_KEY) or []
    if not hosts:
        return _unconfigured_response()
    host = _host_from_dict(hosts[0])
    status, payload = build_groups_payload(host)
    return jsonify(payload), status


def _h_metrics():
    cfg = _load_config()
    hosts = cfg.get(HOSTS_KEY) or []
    lines = [f"# {PLUGIN_ID} plugin metrics"]
    if not hosts:
        lines.append(f'{PLUGIN_ID}_up{{host="unknown"}} 0')
    else:
        for h in hosts:
            label = h.get("name", "unknown")
            lines.append(f'{PLUGIN_ID}_up{{host="{label}"}} 1')
    return Response("\n".join(lines) + "\n", mimetype="text/plain; version=0.0.4")


def _h_config():
    """GET - Return plugin config (admin only, masks secrets)."""
    err = _require_admin()
    if err:
        return err
    cfg = _load_config()
    masked_hosts = []
    for h in cfg.get(HOSTS_KEY, []):
        masked = dict(h)
        for k in SECRET_KEYS:
            if masked.get(k):
                masked[k] = "***"
        masked_hosts.append(masked)
    return {
        HOSTS_KEY: masked_hosts,
        "poll_interval": cfg.get("poll_interval", 30),
        "read_only": cfg.get("read_only", False),
    }


def _h_save_config():
    """POST - Save plugin config (admin only).

    Masked secrets ('***') are preserved from the stored config by matching
    the host URL/name so the UI can round-trip without leaking credentials.
    """
    from flask import request

    err = _require_admin()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    cfg = _load_config()

    old_secrets = {_host_lookup_key(h): h for h in cfg.get(HOSTS_KEY, [])}

    new_hosts = []
    for h in data.get(HOSTS_KEY, []):
        if not isinstance(h, dict):
            continue
        key = _host_lookup_key(h)
        merged = dict(h)
        for k in SECRET_KEYS:
            if merged.get(k) == "***":
                merged[k] = old_secrets.get(key, {}).get(k, "")
        new_hosts.append(merged)

    cfg[HOSTS_KEY] = new_hosts
    cfg["poll_interval"] = max(5, min(3600, int(data.get("poll_interval", cfg.get("poll_interval", 30)))))
    cfg["read_only"] = bool(data.get("read_only", cfg.get("read_only", False)))

    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        log.error("Failed to save config: %s", e)
        return {"error": "Failed to save config"}, 500
    return {"success": True}


def register(app=None):  # noqa: ARG001
    """Called by ProxmoxVEx when the plugin is enabled."""
    if register_native_route is None:
        raise RuntimeError("ProxmoxVEx framework not available - register() must run inside a ProxmoxVEx host")
    log.info("%s v0.1.0 loading", PLUGIN_NAME)
    os.makedirs(STATE_DIR, exist_ok=True)
    routes = {
        "health": _h_health,
        "ui": _h_ui,
        "config": _h_config,
        "config/save": _h_save_config,
        "overview": _h_overview,
        "users": _h_users,
        "groups": _h_groups,
        "metrics": _h_metrics,
    }
    for path, handler in routes.items():
        register_native_route(PLUGIN_ID, path, handler)
    log.info("%s registered %d routes", PLUGIN_NAME, len(routes))
