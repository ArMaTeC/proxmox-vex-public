# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/pfsense/pfsense_src/collectors/interfaces.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Interface collector for pfSense.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Interface collector for pfSense."""

from __future__ import annotations

from typing import Any

from pfsense_src.client import PFsenseClient


def _unwrap(resp: Any) -> Any:
    """Return the FauxAPI ``data`` payload, or the raw response."""
    if isinstance(resp, dict):
        return resp.get("data", resp)
    return resp


def _as_list(data: Any) -> list[dict[str, Any]]:
    """Normalize a FauxAPI response into a list of interface-shaped dicts."""
    if data is None:
        return []
    if isinstance(data, list):
        return [dict(item) for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        out: list[dict[str, Any]] = []
        for key, value in data.items():
            if isinstance(value, dict):
                out.append({"name": key, **value})
            else:
                out.append({"name": key, "value": value})
        return out
    return []


def collect_interfaces(client: PFsenseClient) -> dict[str, Any]:
    """Return pfSense interfaces as an ``{'ok': True, 'data': [...]}`` shape."""
    raw = client.interface_list()
    data = _as_list(_unwrap(raw))
    return {"ok": True, "data": data}
