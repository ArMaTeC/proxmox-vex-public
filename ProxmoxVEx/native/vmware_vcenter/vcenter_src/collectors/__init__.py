# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/vmware_vcenter/vcenter_src/collectors/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Read-only collectors against a vCenter host.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Read-only collectors against a vCenter host.

Each collector takes a ``VCenterClient`` and returns an ``{'ok': True,
'data': [...]}`` shape, propagating API failures as exceptions or as the
gentle pyvmomi-missing status returned by the client.
"""

from .datastores import collect_datastores  # noqa: F401
from .hosts import collect_hosts  # noqa: F401
from .system import collect_system  # noqa: F401
from .vms import collect_vms  # noqa: F401
