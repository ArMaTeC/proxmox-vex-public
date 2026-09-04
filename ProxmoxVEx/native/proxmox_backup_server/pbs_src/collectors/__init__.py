# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/proxmox_backup_server/pbs_src/collectors/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Read-only collectors against a Proxmox Backup Server host.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Read-only collectors against a Proxmox Backup Server host.

Each collector takes a ``PBSClient`` and returns an ``{'ok': True,
'data': [...]}`` shape, propagating API failures as exceptions.
"""

from .datastores import collect_datastores  # noqa: F401
from .snapshots import collect_snapshots  # noqa: F401
from .system import collect_system  # noqa: F401
