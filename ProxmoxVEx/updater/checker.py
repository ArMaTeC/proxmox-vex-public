# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/updater/checker.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Fetch the latest version from GitHub and compare it to...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Fetch the latest version from GitHub and compare it to the local one."""

from __future__ import annotations

from typing import Any

from ProxmoxVEx.constants import GITHUB_ARCHIVE_URL, GITHUB_TOKEN, GITHUB_VERSION_URL
from ProxmoxVEx.updater.github import get_json
from ProxmoxVEx.updater.version import is_newer


def check_for_update(
    current_version: str,
    current_build: str,
    version_url: str = GITHUB_VERSION_URL,
) -> dict[str, Any]:
    """Check GitHub for a newer version.

    Returns a dictionary that mirrors the payload the UI expects from
    ``/api/ProxmoxVEx/check-update``.
    """
    remote = get_json(version_url, token=GITHUB_TOKEN, timeout=10)

    if remote is None:
        return {
            "error": "Update server is unreachable",
            "current_version": current_version,
            "current_build": current_build,
            "update_available": False,
        }

    latest_version = remote.get("version", "0.0.0")
    update_available = is_newer(
        current_version.replace("Alpha ", "").replace("Beta ", ""),
        latest_version.replace("Alpha ", "").replace("Beta ", ""),
    )

    return {
        "current_version": current_version,
        "current_build": current_build,
        "latest_version": latest_version,
        "latest_build": remote.get("build"),
        "release_date": remote.get("release_date"),
        "changelog": remote.get("changelog", []),
        "download_url": remote.get(
            "download_url", GITHUB_VERSION_URL.replace("raw.githubusercontent.com", "github.com")
        ),
        "update_archive": remote.get("update_archive", GITHUB_ARCHIVE_URL),
        "min_python": remote.get("min_python", "3.8"),
        "breaking_changes": remote.get("breaking_changes", []),
        "update_available": update_available,
    }
