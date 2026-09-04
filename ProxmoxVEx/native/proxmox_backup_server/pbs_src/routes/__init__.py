# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/proxmox_backup_server/pbs_src/routes/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: REST routes exposed by the Proxmox Backup Server plugin...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""REST routes exposed by the Proxmox Backup Server plugin to the ProxmoxVEx dashboard."""

from .overview import (  # noqa: F401
    build_datastores_payload,
    build_overview_payload,
    build_snapshots_payload,
)
