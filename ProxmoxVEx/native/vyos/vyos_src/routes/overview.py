# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/vyos/vyos_src/routes/overview.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Read-only route payloads for VyOS overview, interfaces...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Read-only route payloads for VyOS overview, interfaces and routes."""

from __future__ import annotations

import logging
from typing import Any

from vyos_src.client import VyOSClient, VyOSHost
from vyos_src.collectors import collect_interfaces, collect_routes, collect_system

log = logging.getLogger(__name__)


def _count_items(data: Any) -> int:
    """Return a safe length for list or dict collector data."""
    if isinstance(data, (list, dict)):
        return len(data)
    return 0


def _build_overview(client: VyOSClient) -> dict[str, Any]:
    """Aggregate the v0.1 overview snapshot from VyOS collectors."""
    system = collect_system(client)
    if not system.get("ok"):
        return system
    interfaces = collect_interfaces(client)
    routes = collect_routes(client)
    return {
        "ok": True,
        "data": [
            {
                "host": client.host.name,
                "url": client.host.url,
                "system_data": system.get("data", {}),
                "interfaces_ok": interfaces.get("ok", False),
                "interfaces_count": _count_items(interfaces.get("data")),
                "routes_ok": routes.get("ok", False),
                "routes_count": _count_items(routes.get("data")),
            }
        ],
    }


def build_overview_payload(host: VyOSHost) -> tuple[int, dict[str, Any]]:
    """Build the overview payload for a single VyOS host."""
    client = VyOSClient(host)
    payload = _build_overview(client)
    status = 200 if payload.get("ok") else 503
    return status, payload


def build_interfaces_payload(host: VyOSHost) -> tuple[int, dict[str, Any]]:
    """Build the interfaces payload for a single VyOS host."""
    client = VyOSClient(host)
    payload = collect_interfaces(client)
    status = 200 if payload.get("ok") else 503
    return status, payload


def build_routes_payload(host: VyOSHost) -> tuple[int, dict[str, Any]]:
    """Build the routes payload for a single VyOS host."""
    client = VyOSClient(host)
    payload = collect_routes(client)
    status = 200 if payload.get("ok") else 503
    return status, payload
