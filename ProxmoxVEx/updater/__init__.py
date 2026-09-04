# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/updater/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Updater package: check for GitHub releases and publish...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Updater package: check for GitHub releases and publish new ones."""

from ProxmoxVEx.updater.checker import check_for_update
from ProxmoxVEx.updater.uploader import upload_release

__all__ = ["check_for_update", "upload_release"]
