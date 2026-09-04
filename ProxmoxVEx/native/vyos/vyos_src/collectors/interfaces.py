# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/vyos/vyos_src/collectors/interfaces.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Interfaces collector for VyOS.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Interfaces collector for VyOS."""

from __future__ import annotations

from typing import Any

from vyos_src.client import VyOSClient


def collect_interfaces(client: VyOSClient) -> dict[str, Any]:
    """Return VyOS interfaces as an ``{'ok': True, 'data': ...}`` shape."""
    return client.show_interfaces()
