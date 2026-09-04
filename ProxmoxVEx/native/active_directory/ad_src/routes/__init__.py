# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/active_directory/ad_src/routes/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Read-only route payload builders for Active Directory.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Read-only route payload builders for Active Directory."""

from __future__ import annotations

from .overview import (  # noqa: F401
    build_groups_payload,
    build_overview_payload,
    build_users_payload,
)
