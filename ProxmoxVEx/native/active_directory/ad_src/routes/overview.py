# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/active_directory/ad_src/routes/overview.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Read-only route payloads for AD overview, users and...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Read-only route payloads for AD overview, users and groups."""

from __future__ import annotations

import logging
from typing import Any

from ad_src.client import ADClient, ADHost
from ad_src.collectors import collect_groups, collect_system, collect_users

log = logging.getLogger(__name__)


def _build_overview(client: ADClient) -> dict[str, Any]:
    """Aggregate the v0.1 overview snapshot from AD collectors."""
    system = collect_system(client)
    if not system.get("ok"):
        return system
    users = collect_users(client)
    groups = collect_groups(client)
    return {
        "ok": True,
        "data": [
            {
                "host": client.host.name,
                "server": client.host.server,
                "base_dn": client.host.base_dn,
                "connection": system["data"][0] if system.get("data") else {},
                "users_count": len(users.get("data", [])),
                "groups_count": len(groups.get("data", [])),
                "users_ok": users.get("ok", False),
                "groups_ok": groups.get("ok", False),
            }
        ],
    }


def build_overview_payload(host: ADHost) -> tuple[int, dict[str, Any]]:
    """Build the overview payload for a single AD host."""
    client = ADClient(host)
    payload = _build_overview(client)
    status = 200 if payload.get("ok") else 503
    return status, payload


def build_users_payload(host: ADHost) -> tuple[int, dict[str, Any]]:
    """Build the users payload for a single AD host."""
    client = ADClient(host)
    payload = collect_users(client)
    status = 200 if payload.get("ok") else 503
    return status, payload


def build_groups_payload(host: ADHost) -> tuple[int, dict[str, Any]]:
    """Build the groups payload for a single AD host."""
    client = ADClient(host)
    payload = collect_groups(client)
    status = 200 if payload.get("ok") else 503
    return status, payload
