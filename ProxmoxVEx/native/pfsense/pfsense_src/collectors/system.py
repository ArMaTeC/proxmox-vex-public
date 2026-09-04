# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/pfsense/pfsense_src/collectors/system.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: System-level collector for pfSense.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""System-level collector for pfSense."""

from __future__ import annotations

from typing import Any

from pfsense_src.client import PFsenseClient


def _unwrap(resp: Any) -> Any:
    """Return the FauxAPI ``data`` payload, or the raw response."""
    if isinstance(resp, dict):
        return resp.get("data", resp)
    return resp


def collect_system(client: PFsenseClient) -> dict[str, Any]:
    """Return pfSense system info as an ``{'ok': True, 'data': [...]}`` shape."""
    raw = client.system_info()
    data = _unwrap(raw)
    if not isinstance(data, list):
        data = [data] if data is not None else []
    return {"ok": True, "data": data}
