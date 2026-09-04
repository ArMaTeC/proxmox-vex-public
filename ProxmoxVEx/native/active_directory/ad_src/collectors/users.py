# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/active_directory/ad_src/collectors/users.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Users collector for Active Directory.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Users collector for Active Directory."""

from __future__ import annotations

from typing import Any

from ad_src.client import ADClient


def collect_users(client: ADClient) -> dict[str, Any]:
    """Return AD users as an ``{'ok': True, 'data': [...]}`` shape."""
    return client.list_users()
