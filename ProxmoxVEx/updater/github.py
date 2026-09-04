# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/updater/github.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Low-level GitHub API client used for both checking and...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Low-level GitHub API client used for both checking and publishing releases."""

from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any

import requests


def github_headers(token: str | None = None, accept: str = "application/vnd.github+json") -> dict[str, str]:
    """Return request headers with optional bearer auth."""
    headers = {"Accept": accept, "User-Agent": "ProxmoxVEx"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def get_json(url: str, token: str | None = None, timeout: int = 10) -> dict[str, Any] | None:
    """GET a JSON payload from a GitHub URL.

    Returns None on network or HTTP errors so callers can decide how to fall back.
    """
    # 2026-08-12: raw.githubusercontent.com private files accept the bearer
    # token directly, so try the URL as-is before converting to the GitHub
    # Contents API. This keeps update checks working when the API path is
    # rate-limited or otherwise rejects the request.
    try:
        resp = requests.get(url, headers=github_headers(token), timeout=timeout)
    except requests.RequestException as exc:
        logging.warning(f"GitHub request failed for {url}: {exc}")
    else:
        if resp.status_code == 200:
            try:
                return resp.json()
            except json.JSONDecodeError as exc:
                logging.warning(f"GitHub response was not valid JSON for {url}: {exc}")
                return None
        if resp.status_code == 404:
            # File does not exist — no point retrying via the API and spamming warnings.
            logging.info(f"GitHub version file not found: {url}")
            return None
        logging.warning(f"GitHub returned {resp.status_code} for {url}")

    raw_match = re.match(r"^https://raw\.githubusercontent\.com/([^/]+)/([^/]+)/([^/]+)/(.+)$", url)
    if raw_match:
        owner, repo, ref, path = raw_match.groups()
        api_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={ref}"
        try:
            resp = requests.get(api_url, headers=github_headers(token), timeout=timeout)
        except requests.RequestException as exc:
            logging.warning(f"GitHub API request failed for {api_url}: {exc}")
            return None

        if resp.status_code != 200:
            logging.warning(f"GitHub API returned {resp.status_code} for {api_url}")
            return None

        try:
            payload = resp.json()
            decoded = base64.b64decode(payload.get("content", "")).decode("utf-8")
            return json.loads(decoded)
        except (json.JSONDecodeError, ValueError) as exc:
            logging.warning(f"GitHub API response was not valid JSON for {api_url}: {exc}")
            return None

    return None


def post_json(url: str, token: str, payload: dict[str, Any], timeout: int = 30) -> dict[str, Any]:
    """POST a JSON payload to a GitHub API endpoint."""
    resp = requests.post(
        url,
        json=payload,
        headers=github_headers(token),
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()
