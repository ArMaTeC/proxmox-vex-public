# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/pfsense/pfsense_src/client/pfsense_client.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: pfSense FauxAPI HTTP client.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""pfSense FauxAPI HTTP client.

Talks to ``https://<host>/fauxapi/v1/?action=<action>`` using the
``fauxapi-auth: <api_key>:<api_secret>`` header.

The ``requests`` import is guarded so this module can be imported in
linting / unit-test contexts where the dependency may not be present.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

# requests is a runtime dependency; keep the module importable without it.
try:  # pragma: no cover - optional runtime dependency
    import requests
    from requests.exceptions import RequestException
except ImportError:  # pragma: no cover
    requests = None  # type: ignore[assignment]
    RequestException = Exception  # type: ignore[misc,assignment]

log = logging.getLogger(__name__)


class PFsenseError(Exception):
    """Raised when the pfSense FauxAPI returns an unexpected response."""


class PFsenseAuthError(PFsenseError):
    """401/403 from pfSense — bad credentials or insufficient privileges."""


class PFsenseTimeoutError(PFsenseError):
    """Network or read timeout talking to pfSense."""


@dataclass(frozen=True)
class PFsenseHost:
    name: str
    url: str
    api_key: str
    api_secret: str
    verify_tls: bool = True
    ca_bundle_path: str | None = None
    connect_timeout: float = 5.0
    read_timeout: float = 15.0


class PFsenseClient:
    """Minimal FauxAPI client for the v0.1 pfSense integration."""

    def __init__(
        self,
        host: PFsenseHost,
        session: requests.Session | None = None,
    ) -> None:
        if requests is None:  # pragma: no cover - requests missing
            raise RuntimeError(
                "requests is required to use PFsenseClient; install requests or skip HTTP tests in this context"
            )
        if not host.url.startswith("https://"):
            raise ValueError("pfSense FauxAPI requires HTTPS")
        self.host = host
        self._session = session or requests.Session()
        self._verify: bool | str = host.ca_bundle_path or host.verify_tls

    # -------------------------------------------------------------- action APIs

    def system_info(self) -> dict[str, Any]:
        """Return raw FauxAPI ``system_info`` response."""
        return self._get_action("system_info")

    def interface_list(self) -> dict[str, Any]:
        """Return raw FauxAPI ``interface_list`` response."""
        return self._get_action("interface_list")

    def rules(self) -> dict[str, Any]:
        """Return raw FauxAPI ``rules`` response."""
        return self._get_action("rules")

    # ----------------------------------------------------------------- internal

    def _get_action(self, action: str) -> dict[str, Any]:
        url = self._action_url(action)
        headers = {
            "fauxapi-auth": f"{self.host.api_key}:{self.host.api_secret}",
            "accept": "application/json",
        }
        log.debug("%s GET %s", self.host.name, action)
        try:
            resp = self._session.get(
                url,
                headers=headers,
                timeout=(self.host.connect_timeout, self.host.read_timeout),
                verify=self._verify,
            )
        except RequestException as e:
            raise PFsenseTimeoutError(f"GET {action} failed for {self.host.name}: {e}") from e

        if resp.status_code in (401, 403):
            raise PFsenseAuthError(
                f"GET {action} for {self.host.name} -> {resp.status_code} "
                "(check api_key/api_secret and user privileges)"
            )

        if not resp.ok:
            raise PFsenseError(f"GET {action} for {self.host.name} -> HTTP {resp.status_code}: {resp.text[:200]}")

        try:
            return resp.json()
        except ValueError as e:
            raise PFsenseError(f"GET {action} for {self.host.name} -> non-JSON response") from e

    def _action_url(self, action: str) -> str:
        base = self.host.url.rstrip("/")
        return f"{base}/fauxapi/v1/?action={action}"
