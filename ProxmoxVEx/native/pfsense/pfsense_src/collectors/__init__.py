# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/pfsense/pfsense_src/collectors/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Read-only collectors against a pfSense host.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Read-only collectors against a pfSense host.

Each collector takes a ``PFsenseClient`` and returns an ``{'ok': True,
'data': [...]}`` shape, propagating API failures as exceptions.
"""

from .interfaces import collect_interfaces  # noqa: F401
from .rules import collect_rules  # noqa: F401
from .system import collect_system  # noqa: F401
