# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/pfsense/pfsense_src/routes/overview.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Read-only route payloads for pfSense overview, network...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Read-only route payloads for pfSense overview, network and rules."""

from __future__ import annotations

import logging
from typing import Any

from pfsense_src.client import (
    PFsenseAuthError,
    PFsenseClient,
    PFsenseError,
    PFsenseHost,
    PFsenseTimeoutError,
)
from pfsense_src.collectors import collect_interfaces, collect_rules, collect_system

log = logging.getLogger(__name__)


def _build_overview(client: PFsenseClient) -> dict[str, Any]:
    """Aggregate the v0.1 overview snapshot from collectors."""
    system = collect_system(client)
    interfaces = collect_interfaces(client)
    rules = collect_rules(client)
    return {
        "ok": True,
        "data": [
            {
                "system": system["data"][0] if system.get("data") else {},
                "interfaces": interfaces.get("data", []),
                "rules": rules.get("data", []),
            }
        ],
    }


def _error_status(exc: PFsenseError) -> tuple[int, dict[str, Any]]:
    """Map a pfSense client exception to a ProxmoxVEx payload + HTTP status."""
    if isinstance(exc, PFsenseAuthError):
        return 401, {"ok": False, "error": "auth", "detail": str(exc)}
    if isinstance(exc, PFsenseTimeoutError):
        return 504, {"ok": False, "error": "timeout", "detail": str(exc)}
    return 502, {"ok": False, "error": "upstream", "detail": str(exc)}


def build_overview_payload(host: PFsenseHost) -> tuple[int, dict[str, Any]]:
    """Build the overview payload for a single pfSense host."""
    client = PFsenseClient(host)
    try:
        return 200, _build_overview(client)
    except PFsenseError as e:
        log.exception("overview failed for %s", host.name)
        return _error_status(e)


def build_network_payload(host: PFsenseHost) -> tuple[int, dict[str, Any]]:
    """Build the network payload for a single pfSense host."""
    client = PFsenseClient(host)
    try:
        return 200, collect_interfaces(client)
    except PFsenseError as e:
        log.exception("network failed for %s", host.name)
        return _error_status(e)


def build_rules_payload(host: PFsenseHost) -> tuple[int, dict[str, Any]]:
    """Build the firewall rules payload for a single pfSense host."""
    client = PFsenseClient(host)
    try:
        return 200, collect_rules(client)
    except PFsenseError as e:
        log.exception("rules failed for %s", host.name)
        return _error_status(e)
