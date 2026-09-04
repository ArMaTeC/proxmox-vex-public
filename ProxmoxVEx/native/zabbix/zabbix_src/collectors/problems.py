# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/zabbix/zabbix_src/collectors/problems.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Problems collector for Zabbix.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Problems collector for Zabbix."""

from __future__ import annotations

from typing import Any

from zabbix_src.client import ZabbixClient


def collect_problems(client: ZabbixClient) -> dict[str, Any]:
    """Return Zabbix problems as an ``{'ok': True, 'data': [...]}`` shape."""
    return client.list_problems()
