# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/vyos/vyos_src/client/vyos_client.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: VyOS HTTP API client using requests.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""VyOS HTTP API client using requests.

The ``requests`` import is guarded so this module can be imported in
linting and unit-test contexts where the dependency may not be installed.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from types import ModuleType
from typing import Any

# requests is a runtime dependency; keep the module importable without it.
requests: ModuleType | None = None
try:  # pragma: no cover - optional runtime dependency
    import requests as _requests

    requests = _requests
except ImportError:  # pragma: no cover
    pass

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class VyOSHost:
    """Connection parameters for the VyOS HTTP API."""

    name: str
    url: str
    api_key: str = ""
    verify_tls: bool = True


class VyOSClient:
    """Minimal read-only client for the VyOS HTTP API."""

    def __init__(self, host: VyOSHost) -> None:
        self.host = host

    def _base_url(self) -> str:
        """Normalize the configured URL to an HTTPS base URL."""
        raw = self.host.url.strip()
        if not raw:
            raise ValueError("VyOS url is empty")
        if raw.startswith(("http://", "https://")):
            return raw.rstrip("/")
        return f"https://{raw.rstrip('/')}"

    def _retrieve_url(self) -> str:
        """Full /retrieve endpoint for this host."""
        return f"{self._base_url()}/retrieve"

    def _post(self, op: str, path: list[str]) -> dict[str, Any]:
        """POST to /retrieve and return the parsed JSON response."""
        if requests is None:  # pragma: no cover - guarded at call sites
            raise RuntimeError("requests not installed")
        payload = {"op": op, "path": list(path)}
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.host.api_key}",
        }
        response = requests.post(
            self._retrieve_url(),
            json=payload,
            headers=headers,
            verify=self.host.verify_tls,
            timeout=30,
        )
        response.raise_for_status()
        data: dict[str, Any] = response.json()
        return data

    def _result(self, op: str, path: list[str]) -> dict[str, Any]:
        """Call a /retrieve op and normalize to ``{'ok': ..., 'data'/'error': ...}``."""
        try:
            data = self._post(op, path)
        except Exception as e:
            log.exception("VyOS /retrieve failed for %s", self.host.name)
            return {"ok": False, "error": str(e)}
        if not isinstance(data, dict):
            return {"ok": False, "error": "unexpected response type"}
        if data.get("success") is False or data.get("error"):
            return {"ok": False, "error": data.get("error") or "unknown API error"}
        return {"ok": True, "data": data.get("data", data)}

    def show_config(self, path: list[str] | None = None) -> dict[str, Any]:
        """Retrieve a VyOS configuration path using ``showConfig``."""
        return self._result("showConfig", path or [])

    def show_interfaces(self) -> dict[str, Any]:
        """Retrieve VyOS interfaces using ``show``."""
        return self._result("show", ["interfaces"])

    def show_routes(self) -> dict[str, Any]:
        """Retrieve VyOS routes using ``show``."""
        return self._result("show", ["ip", "route"])
