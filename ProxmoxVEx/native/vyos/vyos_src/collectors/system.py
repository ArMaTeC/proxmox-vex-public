# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/vyos/vyos_src/collectors/system.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: System-level collector for VyOS.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""System-level collector for VyOS."""

from __future__ import annotations

from typing import Any

from vyos_src.client import VyOSClient


def collect_system(client: VyOSClient) -> dict[str, Any]:
    """Return the full VyOS configuration as an ``{'ok': True, 'data': ...}`` shape."""
    return client.show_config([])
