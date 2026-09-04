# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/vyos/vyos_src/collectors/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Read-only collectors against a VyOS host.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Read-only collectors against a VyOS host.

Each collector takes a ``VyOSClient`` and returns an ``{'ok': True,
'data': [...]}`` shape, propagating API failures as ``ok``/``error``
responses.
"""

from __future__ import annotations

from .interfaces import collect_interfaces  # noqa: F401
from .routes import collect_routes  # noqa: F401
from .system import collect_system  # noqa: F401
