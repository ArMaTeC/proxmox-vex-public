# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/proxmox_backup_server/pbs_src/collectors/system.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: System-level collector for Proxmox Backup Server.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""System-level collector for Proxmox Backup Server."""

from __future__ import annotations

from typing import Any

from pbs_src.client import PBSClient, PBSError


def _unwrap(resp: Any) -> Any:
    """Return the PBS ``data`` payload, or the raw response."""
    if isinstance(resp, dict):
        return resp.get("data", resp)
    return resp


def _as_list(data: Any) -> list[dict[str, Any]]:
    """Normalize a PBS response into a list of dicts."""
    if data is None:
        return []
    if isinstance(data, list):
        return [dict(item) for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        return [dict(data)]
    return []


def _get_nested(node: dict[str, Any], *keys: str) -> Any:
    """Drill into nested dicts, returning None if any key is missing."""
    for key in keys:
        if not isinstance(node, dict) or key not in node:
            return None
        node = node[key]
    return node


def _pct(part: Any, whole: Any) -> float:
    """Safely calculate a percentage."""
    try:
        if not whole:
            return 0.0
        return round((float(part) / float(whole)) * 100, 2)
    except (TypeError, ValueError):
        return 0.0


def _used(total: Any, free: Any) -> Any:
    """Return the used portion, or 0 when either value is missing."""
    if total is None or free is None:
        return 0
    return total - free


def collect_system(client: PBSClient, datastores: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Return PBS host summary as an ``{'ok': True, 'data': [...]}`` shape.

    ``datastores`` may be provided to avoid an extra ``datastores()`` call.
    """
    if datastores is None:
        raw = client.datastores()
        datastores = _as_list(_unwrap(raw))
    try:
        node = _unwrap(client.node_status())
    except PBSError:
        node = None
    try:
        version = _unwrap(client.version())
    except PBSError:
        version = None
    if not isinstance(node, dict):
        node = {}
    if not isinstance(version, dict):
        version = {}

    memory_total = _get_nested(node, "memory", "total")
    memory_free = _get_nested(node, "memory", "free")
    swap_total = _get_nested(node, "swap", "total")
    swap_free = _get_nested(node, "swap", "free")
    rootfs = node.get("rootfs", {}) if isinstance(node.get("rootfs"), dict) else {}
    rootfs_total = rootfs.get("total")
    rootfs_free = rootfs.get("free")
    rootfs_used = rootfs.get("used")
    memory_used = _used(memory_total, memory_free)
    swap_used = _used(swap_total, swap_free)

    return {
        "ok": True,
        "data": [
            {
                "host": client.host.name,
                "url": client.host.url,
                "datastores_count": len(datastores),
                "datastore_names": [ds.get("store", "") for ds in datastores],
                "version": version.get("version", version.get("repoid", "")),
                "cpu_count": node.get("cpu"),
                "uptime": node.get("uptime"),
                "memory": {
                    "total": memory_total,
                    "free": memory_free,
                    "used": memory_used,
                    "pct": _pct(memory_used, memory_total),
                },
                "swap": {
                    "total": swap_total,
                    "free": swap_free,
                    "used": swap_used,
                    "pct": _pct(swap_used, swap_total),
                },
                "rootfs": {
                    "total": rootfs_total,
                    "free": rootfs_free,
                    "used": rootfs_used,
                    "pct": _pct(rootfs_used or _used(rootfs_total, rootfs_free), rootfs_total),
                },
            }
        ],
    }
