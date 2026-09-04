# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/proxmox_backup_server/pbs_src/client/pbs_client.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Proxmox Backup Server JSON-API HTTP client.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Proxmox Backup Server JSON-API HTTP client.

Talks to ``https://<host>/api2/json/<endpoint>`` using the
``Authorization: PBSAPIToken <token>`` header.

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


class PBSError(Exception):
    """Raised when the Proxmox Backup Server API returns an unexpected response."""


class PBSAuthError(PBSError):
    """401/403 from PBS — bad credentials or insufficient privileges."""


class PBSTimeoutError(PBSError):
    """Network or read timeout talking to PBS."""


@dataclass(frozen=True)
class PBSHost:
    name: str
    url: str
    api_token_id: str
    api_token_secret: str
    verify_tls: bool = True
    connect_timeout: float = 5.0
    read_timeout: float = 15.0


class PBSClient:
    """Minimal JSON-API client for the Proxmox Backup Server integration."""

    def __init__(
        self,
        host: PBSHost,
        session: requests.Session | None = None,
    ) -> None:
        if requests is None:  # pragma: no cover - requests missing
            raise RuntimeError(
                "requests is required to use PBSClient; install requests or skip HTTP tests in this context"
            )
        self.host = host
        self._session = session or requests.Session()
        self._verify = host.verify_tls

    # -------------------------------------------------------------- PBS APIs

    def version(self) -> dict[str, Any]:
        """Return raw ``version`` response."""
        return self._get("version")

    def node_status(self) -> dict[str, Any]:
        """Return raw ``nodes/localhost/status`` response."""
        return self._get("nodes/localhost/status")

    def datastores(self) -> dict[str, Any]:
        """Return raw ``admin/datastore`` response."""
        return self._get("admin/datastore")

    def datastore_status(self, datastore: str) -> dict[str, Any]:
        """Return raw ``admin/datastore/<name>/status`` response."""
        return self._get(f"admin/datastore/{datastore}/status")

    def snapshots(self, datastore: str) -> dict[str, Any]:
        """Return raw ``admin/datastore/<name>/snapshots`` response."""
        return self._get(f"admin/datastore/{datastore}/snapshots")

    def content(self, datastore: str) -> dict[str, Any]:
        """Return raw ``admin/datastore/<name>/content`` response."""
        return self._get(f"admin/datastore/{datastore}/content")

    # ----------------------------------------------------------------- internal

    def _get(self, endpoint: str) -> dict[str, Any]:
        url = self._api_url(endpoint)
        # PBS uses a colon between the token ID and secret (unlike PVE's equals sign).
        headers = {
            "Authorization": f"PBSAPIToken={self.host.api_token_id}:{self.host.api_token_secret}",
            "accept": "application/json",
        }
        log.debug("%s GET %s", self.host.name, endpoint)
        try:
            resp = self._session.get(
                url,
                headers=headers,
                timeout=(self.host.connect_timeout, self.host.read_timeout),
                verify=self._verify,
            )
        except RequestException as e:
            raise PBSTimeoutError(f"GET {endpoint} failed for {self.host.name}: {e}") from e

        if resp.status_code in (401, 403):
            raise PBSAuthError(
                f"GET {endpoint} for {self.host.name} -> {resp.status_code} (check api_token and user privileges)"
            )

        if not resp.ok:
            raise PBSError(f"GET {endpoint} for {self.host.name} -> HTTP {resp.status_code}: {resp.text[:200]}")

        try:
            return resp.json()
        except ValueError as e:
            raise PBSError(f"GET {endpoint} for {self.host.name} -> non-JSON response") from e

    def _api_url(self, endpoint: str) -> str:
        base = self.host.url.rstrip("/")
        if not base.startswith("https://"):
            base = f"https://{base}"
        return f"{base}/api2/json/{endpoint}"
