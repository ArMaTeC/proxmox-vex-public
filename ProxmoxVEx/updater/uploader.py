# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/updater/uploader.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Create GitHub releases and upload release assets using...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Create GitHub releases and upload release assets using the GitHub API."""

from __future__ import annotations

import logging
import os
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import requests

from ProxmoxVEx.updater.github import github_headers, post_json

GITHUB_API_BASE = "https://api.github.com"


def _upload_asset(release: dict[str, Any], token: str, path: Path, timeout: int = 120) -> dict[str, Any]:
    """Upload a single file to an existing release."""
    upload_url = release["upload_url"].replace("{?name,label}", "")
    name = path.name
    with path.open("rb") as f:
        data = f.read()

    resp = requests.post(
        f"{upload_url}?name={name}",
        data=data,
        headers={
            **github_headers(token),
            "Content-Type": "application/octet-stream",
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    logging.info(f"Uploaded asset: {name}")
    return resp.json()


def upload_release(
    tag: str,
    assets: Sequence[str | os.PathLike[str]],
    token: str | None = None,
    repo: str = "ArMaTeC/ProxmoxVEx",
    name: str | None = None,
    body: str = "",
    draft: bool = False,
    prerelease: bool = False,
) -> dict[str, Any]:
    """Create a GitHub release and upload the supplied assets.

    The token is read from the ``GITHUB_TOKEN`` environment variable when not
    supplied explicitly. Raises ``RuntimeError`` if no token is available.
    """
    token = token or os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GitHub token is required; set GITHUB_TOKEN or pass token=")

    payload = {
        "tag_name": tag,
        "name": name or tag,
        "body": body,
        "draft": draft,
        "prerelease": prerelease,
    }

    release_url = f"{GITHUB_API_BASE}/repos/{repo}/releases"
    release = post_json(release_url, token, payload)

    uploaded: list[dict[str, Any]] = []
    for asset in assets:
        asset_path = Path(asset)
        if not asset_path.is_file():
            logging.warning(f"Asset not found, skipping: {asset_path}")
            continue
        uploaded.append(_upload_asset(release, token, asset_path))

    return {
        "id": release["id"],
        "tag_name": release["tag_name"],
        "html_url": release["html_url"],
        "upload_url": release["upload_url"],
        "assets": uploaded,
    }
