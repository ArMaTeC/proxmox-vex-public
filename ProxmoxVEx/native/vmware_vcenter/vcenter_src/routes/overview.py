# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/vmware_vcenter/vcenter_src/routes/overview.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Read-only route payloads for vCenter overview, vms,...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Read-only route payloads for vCenter overview, vms, hosts and datastores."""

from __future__ import annotations

import logging
from typing import Any

from vcenter_src.client import (
    VCenterAuthError,
    VCenterClient,
    VCenterError,
    VCenterHost,
    VCenterTimeoutError,
)
from vcenter_src.collectors import (
    collect_datastores,
    collect_hosts,
    collect_system,
    collect_vms,
)

log = logging.getLogger(__name__)


def _build_overview(client: VCenterClient) -> dict[str, Any]:
    """Aggregate the v0.1 overview snapshot from collectors."""
    system = collect_system(client)
    if not system.get("ok"):
        return system
    vms = collect_vms(client)
    if not vms.get("ok"):
        return vms
    hosts = collect_hosts(client)
    if not hosts.get("ok"):
        return hosts
    datastores = collect_datastores(client)
    if not datastores.get("ok"):
        return datastores
    return {
        "ok": True,
        "data": [
            {
                "name": client.host.name,
                "host": client.host.host,
                "port": client.host.port,
                "username": client.host.username,
                "system": system.get("data", [{}])[0] if system.get("data") else {},
                "vms_count": len(vms.get("data", [])),
                "vms": vms.get("data", []),
                "hosts_count": len(hosts.get("data", [])),
                "hosts": hosts.get("data", []),
                "datastores_count": len(datastores.get("data", [])),
                "datastores": datastores.get("data", []),
            }
        ],
    }


def _error_status(exc: VCenterError) -> tuple[int, dict[str, Any]]:
    """Map a vCenter client exception to a ProxmoxVEx payload + HTTP status."""
    if isinstance(exc, VCenterAuthError):
        return 401, {"ok": False, "error": "auth", "detail": str(exc)}
    if isinstance(exc, VCenterTimeoutError):
        return 504, {"ok": False, "error": "timeout", "detail": str(exc)}
    return 502, {"ok": False, "error": "upstream", "detail": str(exc)}


def _build_tab_payload(
    client: VCenterClient,
    collector,
) -> tuple[int, dict[str, Any]]:
    """Run a single collector and map missing pyvmomi / failure states to HTTP status."""
    try:
        result = collector(client)
        if not result.get("ok"):
            return 503, result
        return 200, result
    except VCenterError as e:
        log.exception("%s failed for %s", collector.__name__, client.host.name)
        return _error_status(e)


def build_overview_payload(host: VCenterHost) -> tuple[int, dict[str, Any]]:
    """Build the overview payload for a single vCenter host."""
    client = VCenterClient(host)
    try:
        overview = _build_overview(client)
        if not overview.get("ok"):
            return 503, overview
        return 200, overview
    except VCenterError as e:
        log.exception("overview failed for %s", host.name)
        return _error_status(e)


def build_vms_payload(host: VCenterHost) -> tuple[int, dict[str, Any]]:
    """Build the VMs payload for a single vCenter host."""
    client = VCenterClient(host)
    return _build_tab_payload(client, collect_vms)


def build_hosts_payload(host: VCenterHost) -> tuple[int, dict[str, Any]]:
    """Build the hosts payload for a single vCenter host."""
    client = VCenterClient(host)
    return _build_tab_payload(client, collect_hosts)


def build_datastores_payload(host: VCenterHost) -> tuple[int, dict[str, Any]]:
    """Build the datastores payload for a single vCenter host."""
    client = VCenterClient(host)
    return _build_tab_payload(client, collect_datastores)
