# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/proxmox_backup_server/pbs_src/collectors/datastores.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Datastore collector for Proxmox Backup Server.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Datastore collector for Proxmox Backup Server."""

from __future__ import annotations

import logging
from typing import Any

from pbs_src.client import PBSClient

log = logging.getLogger(__name__)


def _unwrap(resp: Any) -> Any:
    """Return the PBS ``data`` payload, or the raw response."""
    if isinstance(resp, dict):
        return resp.get("data", resp)
    return resp


def _as_list(data: Any) -> list[dict[str, Any]]:
    """Normalize a PBS response into a list of datastore-shaped dicts."""
    if data is None:
        return []
    if isinstance(data, list):
        return [dict(item) for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        return [dict(data)]
    return []


def _pct(part: Any, whole: Any) -> float:
    """Safely calculate a percentage."""
    try:
        if not whole:
            return 0.0
        return round((float(part) / float(whole)) * 100, 2)
    except (TypeError, ValueError):
        return 0.0


def _store_name(ds: dict[str, Any]) -> str:
    """Return the canonical datastore name from a datastore record."""
    return str(ds.get("store") or ds.get("name") or ds.get("datastore") or "")


def _merge_status(ds: dict[str, Any], status: dict[str, Any]) -> dict[str, Any]:
    """Merge per-datastore status fields into the config record."""
    out = dict(ds)
    total = status.get("total")
    used = status.get("used")
    count = status.get("count")
    if total is not None:
        out["total"] = total
    if used is not None:
        out["used"] = used
    if count is not None:
        out["count"] = count
    if total is not None and used is not None:
        out["pct"] = _pct(used, total)
    last_backup = status.get("last-backup") or status.get("last_backup")
    if last_backup:
        out["last_backup"] = last_backup
    return out


def collect_datastores(client: PBSClient) -> dict[str, Any]:
    """Return PBS datastores as an ``{'ok': True, 'data': [...]}`` shape."""
    raw = client.datastores()
    data = _as_list(_unwrap(raw))
    enriched: list[dict[str, Any]] = []
    for ds in data:
        name = _store_name(ds)
        if name:
            try:
                status = _unwrap(client.datastore_status(name))
                if isinstance(status, dict):
                    ds = _merge_status(ds, status)
            except Exception as e:
                log.warning("datastore status for %s failed: %s", name, e)
        enriched.append(ds)
    return {"ok": True, "data": enriched}
