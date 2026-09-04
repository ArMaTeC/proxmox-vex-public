# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/zabbix/zabbix_src/routes/overview.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Read-only route payloads for Zabbix overview, hosts and...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Read-only route payloads for Zabbix overview, hosts and problems."""

from __future__ import annotations

import logging
from typing import Any

from zabbix_src.client import ZabbixClient, ZabbixHost
from zabbix_src.collectors import collect_hosts, collect_problems, collect_system

log = logging.getLogger(__name__)


def _build_overview(client: ZabbixClient) -> dict[str, Any]:
    """Aggregate the v0.1 overview snapshot from Zabbix collectors."""
    system = collect_system(client)
    if not system.get("ok"):
        return system
    hosts = collect_hosts(client)
    problems = collect_problems(client)
    return {
        "ok": True,
        "data": [
            {
                "host": client.host.name,
                "url": client.host.url,
                "api_version": system["data"][0].get("version", "") if system.get("data") else "",
                "hosts_count": len(hosts.get("data", [])),
                "problems_count": len(problems.get("data", [])),
                "hosts_ok": hosts.get("ok", False),
                "problems_ok": problems.get("ok", False),
            }
        ],
    }


def build_overview_payload(host: ZabbixHost) -> tuple[int, dict[str, Any]]:
    """Build the overview payload for a single Zabbix host."""
    client = ZabbixClient(host)
    payload = _build_overview(client)
    status = 200 if payload.get("ok") else 503
    return status, payload


def build_hosts_payload(host: ZabbixHost) -> tuple[int, dict[str, Any]]:
    """Build the hosts payload for a single Zabbix host."""
    client = ZabbixClient(host)
    payload = collect_hosts(client)
    status = 200 if payload.get("ok") else 503
    return status, payload


def build_problems_payload(host: ZabbixHost) -> tuple[int, dict[str, Any]]:
    """Build the problems payload for a single Zabbix host."""
    client = ZabbixClient(host)
    payload = collect_problems(client)
    status = 200 if payload.get("ok") else 503
    return status, payload
