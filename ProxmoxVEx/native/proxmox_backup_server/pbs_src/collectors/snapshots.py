# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/proxmox_backup_server/pbs_src/collectors/snapshots.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Snapshot collector for Proxmox Backup Server.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Snapshot collector for Proxmox Backup Server."""

from __future__ import annotations

from typing import Any

from pbs_src.client import PBSClient


def _unwrap(resp: Any) -> Any:
    """Return the PBS ``data`` payload, or the raw response."""
    if isinstance(resp, dict):
        return resp.get("data", resp)
    return resp


def _as_list(data: Any) -> list[dict[str, Any]]:
    """Normalize a PBS response into a list of snapshot-shaped dicts."""
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


def _first_store(data: list[dict[str, Any]]) -> str:
    """Return the first available datastore name from a list of datastores."""
    for ds in data:
        store = ds.get("store") or ds.get("name")
        if store:
            return str(store)
    return ""


def _store_name(ds: dict[str, Any]) -> str:
    """Return the canonical datastore name from a datastore record."""
    return str(ds.get("store") or ds.get("name") or "")


def collect_snapshots(
    client: PBSClient, datastore: str | None = None, stores: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    """Return PBS snapshots as an ``{'ok': True, 'data': [...]}`` shape.

    If ``datastore`` is not provided, the first datastore returned by the
    server is used. The response also includes the list of available stores
    so the UI can render a selector. Pass ``stores`` to avoid an extra API
    call when the list is already known.
    """
    if stores is None:
        stores = _as_list(_unwrap(client.datastores()))
    store_names = [_store_name(s) for s in stores if _store_name(s)]
    store = datastore or _first_store(stores)
    if not store:
        return {"ok": True, "data": [], "stores": store_names, "selected": ""}
    raw = client.snapshots(store)
    data = _as_list(_unwrap(raw))
    return {"ok": True, "data": data, "stores": store_names, "selected": store}
