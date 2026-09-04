# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/updater/version.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Version parsing and comparison helpers used by the...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Version parsing and comparison helpers used by the updater."""


def parse_version(v: str) -> tuple[int, ...]:
    """Return a sortable tuple of integers from a version string.

    Non-numeric and empty components are ignored so pre-release markers such
    as "Alpha" or "Beta" do not break the comparison.
    """
    if not v:
        return (0, 0)
    cleaned = str(v).replace("Alpha ", "").replace("Beta ", "")
    return tuple(int(part) for part in cleaned.split(".") if part.isdigit())


def is_newer(current: str, latest: str) -> bool:
    """Return True when *latest* is greater than *current*."""
    return parse_version(latest) > parse_version(current)
