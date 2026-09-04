# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/vmware_vcenter/vcenter_src/collectors/vms.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Virtual machine collector for vCenter.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Virtual machine collector for vCenter."""

from __future__ import annotations

from typing import Any

from vcenter_src.client import VCenterClient


def collect_vms(client: VCenterClient) -> dict[str, Any]:
    """Return all vCenter virtual machines."""
    return client.list_vms()
