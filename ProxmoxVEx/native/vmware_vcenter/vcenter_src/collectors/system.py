# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/vmware_vcenter/vcenter_src/collectors/system.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: System-level collector for vCenter.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""System-level collector for vCenter."""

from __future__ import annotations

from typing import Any

from vcenter_src.client import VCenterClient


def collect_system(client: VCenterClient) -> dict[str, Any]:
    """Return the configured vCenter host identity."""
    return {
        "ok": True,
        "data": [
            {
                "name": client.host.name,
                "host": client.host.host,
                "port": client.host.port,
                "username": client.host.username,
            }
        ],
    }
