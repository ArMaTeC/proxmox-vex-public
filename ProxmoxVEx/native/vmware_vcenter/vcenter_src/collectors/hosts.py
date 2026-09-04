# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/vmware_vcenter/vcenter_src/collectors/hosts.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: ESXi host collector for vCenter.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""ESXi host collector for vCenter."""

from __future__ import annotations

from typing import Any

from vcenter_src.client import VCenterClient


def collect_hosts(client: VCenterClient) -> dict[str, Any]:
    """Return all vCenter ESXi hosts."""
    return client.list_hosts()
