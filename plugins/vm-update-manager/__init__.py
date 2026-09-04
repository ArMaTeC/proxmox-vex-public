# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-update-manager/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Package initializer for vm-update-manager
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
import logging

from ProxmoxVEx.core.db import get_db

PLUGIN_ID = "vm-update-manager"


def register(app):
    """Plugin entry point called by ProxmoxVEx.api.plugins.load_plugin."""
    try:
        from . import db, engine, routes

        db.ensure_tables(get_db().conn)
        routes.register_all()
        engine.start_scheduler()
        logging.info(f"[{PLUGIN_ID}] loaded successfully")
    except Exception as e:
        logging.error(f"[{PLUGIN_ID}] failed to load: {e}")
