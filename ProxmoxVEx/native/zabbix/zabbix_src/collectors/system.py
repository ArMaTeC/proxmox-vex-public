# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/zabbix/zabbix_src/collectors/system.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: System-level collector for Zabbix.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""System-level collector for Zabbix."""

from __future__ import annotations

from typing import Any

from zabbix_src.client import ZabbixClient


def collect_system(client: ZabbixClient) -> dict[str, Any]:
    """Return Zabbix API version as an ``{'ok': True, 'data': [...]}`` shape."""
    return client.api_info()
