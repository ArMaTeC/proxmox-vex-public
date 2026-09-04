# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/proxmox_backup_server/pbs_src/routes/overview.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Read-only route payloads for PBS overview, datastores...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Read-only route payloads for PBS overview, datastores and snapshots."""

from __future__ import annotations

import logging
from typing import Any

from pbs_src.client import (
    PBSAuthError,
    PBSClient,
    PBSError,
    PBSHost,
    PBSTimeoutError,
)
from pbs_src.collectors import collect_datastores, collect_snapshots, collect_system

log = logging.getLogger(__name__)


def _first_store(data: list[dict[str, Any]]) -> str:
    """Return the first available datastore name from a list of datastores."""
    for ds in data:
        store = ds.get("store") or ds.get("name")
        if store:
            return str(store)
    return ""


def _build_overview(client: PBSClient) -> dict[str, Any]:
    """Aggregate the v0.1 overview snapshot from collectors."""
    datastores = collect_datastores(client)
    ds_list = datastores.get("data", [])
    first = _first_store(ds_list)
    system = collect_system(client, datastores=ds_list)
    snapshots = (
        collect_snapshots(client, datastore=first, stores=ds_list)
        if first
        else {"ok": True, "data": [], "stores": [], "selected": ""}
    )
    snapshots_data = snapshots.get("data", [])
    if not isinstance(snapshots_data, list):
        snapshots_data = []
    return {
        "ok": True,
        "data": [
            {
                "host": client.host.name,
                "url": client.host.url,
                "system": system["data"][0] if system.get("data") else {},
                "datastores": datastores.get("data", []),
                "snapshots_count": len(snapshots_data),
                "snapshots": snapshots_data,
            }
        ],
    }


def _error_status(exc: PBSError) -> tuple[int, dict[str, Any]]:
    """Map a PBS client exception to a ProxmoxVEx payload + HTTP status."""
    if isinstance(exc, PBSAuthError):
        return 401, {"ok": False, "error": "auth", "detail": str(exc)}
    if isinstance(exc, PBSTimeoutError):
        return 504, {"ok": False, "error": "timeout", "detail": str(exc)}
    return 502, {"ok": False, "error": "upstream", "detail": str(exc)}


def build_overview_payload(host: PBSHost) -> tuple[int, dict[str, Any]]:
    """Build the overview payload for a single PBS host."""
    client = PBSClient(host)
    try:
        return 200, _build_overview(client)
    except PBSError as e:
        log.exception("overview failed for %s", host.name)
        return _error_status(e)


def build_datastores_payload(host: PBSHost) -> tuple[int, dict[str, Any]]:
    """Build the datastores payload for a single PBS host."""
    client = PBSClient(host)
    try:
        return 200, collect_datastores(client)
    except PBSError as e:
        log.exception("datastores failed for %s", host.name)
        return _error_status(e)


def build_snapshots_payload(host: PBSHost, datastore: str | None = None) -> tuple[int, dict[str, Any]]:
    """Build the snapshots payload for a single PBS host."""
    client = PBSClient(host)
    try:
        return 200, collect_snapshots(client, datastore)
    except PBSError as e:
        log.exception("snapshots failed for %s", host.name)
        return _error_status(e)
