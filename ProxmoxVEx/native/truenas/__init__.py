# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/truenas/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: TrueNAS — ProxmoxVEx Plugin
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
TrueNAS — ProxmoxVEx Plugin
Codename: truenas
"""

import logging
import os
import sys

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
_SRC_DIR = os.path.join(PLUGIN_DIR, "truenas_src")
for _p in (PLUGIN_DIR, _SRC_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from routes import api as routes_api  # noqa: E402

from ProxmoxVEx.native.registry import register_native_route  # noqa: E402

PLUGIN_ID = routes_api.PLUGIN_ID
log = logging.getLogger(f"native.{PLUGIN_ID}")


def register(app=None):
    routes_api.init(PLUGIN_DIR)
    for path, handler in routes_api.ROUTES.items():
        register_native_route(PLUGIN_ID, path, handler)
    log.info(f"[{PLUGIN_ID}] Registered {len(routes_api.ROUTES)} routes")
    # RE-ENABLED 2026-07-21: was temporarily disabled after both TrueNAS
    # instances got marked permanently unreachable on first deploy. Root
    # cause confirmed by reading /etc/nginx/nginx.conf directly on .64: the
    # `/api` location (what /api/current is proxied through) has no
    # proxy_read_timeout override, so it inherits nginx's 60s default —
    # the poller's 60s-silent-then-burst cadence hit that exactly. Fixed
    # with a 25s WebSocket keepalive ping in ws_client.py
    # (DEFAULT_KEEPALIVE_INTERVAL_S) plus the separate ensure_logged_in
    # auth-race fix this incident also surfaced. See CHANGELOG.md v0.14.0.
    routes_api.start_poller()
