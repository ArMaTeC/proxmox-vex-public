# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/zabbix/zabbix_src/collectors/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Read-only collectors against a Zabbix host.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Read-only collectors against a Zabbix host.

Each collector takes a ``ZabbixClient`` and returns an ``{'ok': True,
'data': [...]}`` shape, propagating API failures as ``ok``/``error``
responses.
"""

from __future__ import annotations

from .hosts import collect_hosts  # noqa: F401
from .problems import collect_problems  # noqa: F401
from .system import collect_system  # noqa: F401
