# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/zabbix/zabbix_src/collectors/hosts.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Hosts collector for Zabbix.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Hosts collector for Zabbix."""

from __future__ import annotations

from typing import Any

from zabbix_src.client import ZabbixClient


def collect_hosts(client: ZabbixClient) -> dict[str, Any]:
    """Return Zabbix hosts as an ``{'ok': True, 'data': [...]}`` shape."""
    return client.list_hosts()
