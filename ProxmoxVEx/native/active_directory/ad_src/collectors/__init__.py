# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/active_directory/ad_src/collectors/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Read-only collectors against an Active Directory host.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Read-only collectors against an Active Directory host.

Each collector takes an ``ADClient`` and returns an ``{'ok': True,
'data': [...]}`` shape, propagating LDAP failures as ``ok``/``error``
responses.
"""

from __future__ import annotations

from .groups import collect_groups  # noqa: F401
from .system import collect_system  # noqa: F401
from .users import collect_users  # noqa: F401
