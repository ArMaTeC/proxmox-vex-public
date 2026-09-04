# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Native built-in integrations loader.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Native built-in integrations loader."""

import logging


def register_native(app):
    """Register all native built-in integration modules on the Flask app."""
    from ProxmoxVEx.native import (
        active_directory,
        docker_swarm,
        netapp_storage,
        opnsense,
        pfsense,
        proxmox_backup_server,
        truenas,
        vmware_vcenter,
        vyos,
        zabbix,
    )

    modules = [
        active_directory,
        docker_swarm,
        netapp_storage,
        opnsense,
        pfsense,
        proxmox_backup_server,
        truenas,
        vmware_vcenter,
        vyos,
        zabbix,
    ]
    for mod in modules:
        try:
            mod.register(app)
            logging.info(f"[NATIVE] {mod.__name__} registered")
        except Exception as e:
            logging.error(f"[NATIVE] {mod.__name__} failed to register: {e}")
