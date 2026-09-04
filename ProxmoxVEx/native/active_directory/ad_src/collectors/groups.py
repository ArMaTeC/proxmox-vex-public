# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/active_directory/ad_src/collectors/groups.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Groups collector for Active Directory.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Groups collector for Active Directory."""

from __future__ import annotations

from typing import Any

from ad_src.client import ADClient


def collect_groups(client: ADClient) -> dict[str, Any]:
    """Return AD groups as an ``{'ok': True, 'data': [...]}`` shape."""
    return client.list_groups()
