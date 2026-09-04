# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/pfsense/pfsense_src/routes/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: REST routes exposed by the pfSense plugin to the...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""REST routes exposed by the pfSense plugin to the ProxmoxVEx dashboard."""

from .overview import (  # noqa: F401
    build_network_payload,
    build_overview_payload,
    build_rules_payload,
)
