# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/hello_world/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Hello World - full UI management example plugin.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Hello World - full UI management example plugin.
Demonstrates how to build a plugin with routes, auth, and ProxmoxVEx API access.
"""

import logging
from datetime import datetime, timezone
from pathlib import Path

from flask import request, send_file

from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.globals import cluster_managers

PLUGIN_NAME = "Hello World"
PLUGIN_DIR = Path(__file__).parent


def _safe(obj):
    try:
        return list(obj.values()) if hasattr(obj, "values") else list(obj)
    except Exception:
        return []


def _get_status():
    """Return plugin status, message, current user, and cluster counts."""
    connected = sum(1 for m in _safe(cluster_managers) if getattr(m, "is_connected", False))
    total = len(_safe(cluster_managers))
    user = getattr(request, "session", {}).get("user", "unknown")
    return {
        "plugin": "hello_world",
        "status": "running",
        "message": "Hello from the plugin system!",
        "authenticated_user": user,
        "clusters": {"connected": connected, "total": total},
    }


def _get_info():
    """Return plugin metadata, routes, and API docs."""
    return {
        "name": PLUGIN_NAME,
        "version": "1.0.0",
        "author": "ProxmoxVEx Team",
        "description": "Example plugin demonstrating the ProxmoxVEx plugin API with full UI management.",
        "available_routes": ["status", "info", "echo", "docs"],
        "api_docs": {
            "status": "GET /api/plugins/hello_world/api/status — Plugin status + cluster info",
            "info": "GET /api/plugins/hello_world/api/info — Plugin metadata",
            "echo": "POST /api/plugins/hello_world/api/echo — Echo a message back",
            "docs": "GET /api/plugins/hello_world/api/docs — API documentation",
        },
    }


def _get_docs():
    """Return plain API documentation."""
    return {"documentation": _get_info().get("api_docs", {})}


def _post_echo():
    """Echo a message back for manual API route testing."""
    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "Hello!").strip()
    return {"echo": message, "received_at": datetime.now(timezone.utc).isoformat()}


def _get_ui():
    """Serve the Hello World HTML interface."""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def _get_ui_css():
    """Serve the Hello World CSS as a separate import."""
    return send_file(PLUGIN_DIR / "ui.css", mimetype="text/css")


def _get_ui_js():
    """Serve the Hello World JavaScript as a separate import."""
    return send_file(PLUGIN_DIR / "ui.js", mimetype="application/javascript")


def register(app):
    register_plugin_route("hello_world", "status", _get_status)
    register_plugin_route("hello_world", "info", _get_info)
    register_plugin_route("hello_world", "docs", _get_docs)
    register_plugin_route("hello_world", "echo", _post_echo)
    register_plugin_route("hello_world", "ui", _get_ui)
    register_plugin_route("hello_world", "ui.css", _get_ui_css)
    register_plugin_route("hello_world", "ui.js", _get_ui_js)
    logging.info("[PLUGINS] Hello World plugin registered")
