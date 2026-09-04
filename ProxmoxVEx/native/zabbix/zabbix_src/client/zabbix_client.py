# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/zabbix/zabbix_src/client/zabbix_client.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Zabbix JSON-RPC client using requests.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Zabbix JSON-RPC client using requests.

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
class ZabbixHost:
    """Connection parameters for a Zabbix JSON-RPC API."""

    name: str
    url: str
    api_token: str = ""
    verify_tls: bool = True


class ZabbixClient:
    """Minimal read-only JSON-RPC client for the Zabbix integration."""

    def __init__(self, host: ZabbixHost) -> None:
        self.host = host

    def _base_url(self) -> str:
        """Normalize the configured URL to an HTTPS base URL."""
        raw = self.host.url.strip()
        if not raw:
            raise ValueError("Zabbix url is empty")
        if raw.startswith(("http://", "https://")):
            return raw.rstrip("/")
        return f"https://{raw.rstrip('/')}"

    def _post(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """Call a Zabbix JSON-RPC method and return the ``result`` payload."""
        if requests is None:  # pragma: no cover - guarded at call sites
            raise RuntimeError("requests not installed")
        endpoint = f"{self._base_url()}/api_jsonrpc.php"
        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {},
            "id": 1,
        }
        headers = {
            "Content-Type": "application/json-rpc",
            "Authorization": f"Bearer {self.host.api_token}",
        }
        response = requests.post(
            endpoint,
            json=payload,
            headers=headers,
            verify=self.host.verify_tls,
            timeout=30,
        )
        response.raise_for_status()
        data: dict[str, Any] = response.json()
        if "error" in data:
            raise RuntimeError(f"Zabbix API error: {data['error']}")
        return data.get("result")

    def api_info(self) -> dict[str, Any]:
        """Return the Zabbix API version."""
        if requests is None:
            return {"ok": False, "error": "requests not installed"}
        try:
            result = self._post("apiinfo.version")
            return {"ok": True, "data": [{"version": result}]}
        except Exception as e:
            log.exception("Zabbix apiinfo failed for %s", self.host.name)
            return {"ok": False, "error": str(e)}

    def list_hosts(self) -> dict[str, Any]:
        """List configured Zabbix hosts."""
        if requests is None:
            return {"ok": False, "error": "requests not installed"}
        try:
            data = self._post(
                "host.get",
                {
                    "output": ["hostid", "host", "name", "status"],
                    "limit": 100,
                },
            )
            return {"ok": True, "data": data if isinstance(data, list) else [data]}
        except Exception as e:
            log.exception("Zabbix host.get failed for %s", self.host.name)
            return {"ok": False, "error": str(e)}

    def list_problems(self) -> dict[str, Any]:
        """List current Zabbix problems."""
        if requests is None:
            return {"ok": False, "error": "requests not installed"}
        try:
            data = self._post(
                "problem.get",
                {
                    "output": "extend",
                    "recent": True,
                    "sortfield": ["eventid"],
                    "sortorder": "DESC",
                    "limit": 100,
                },
            )
            return {"ok": True, "data": data if isinstance(data, list) else [data]}
        except Exception as e:
            log.exception("Zabbix problem.get failed for %s", self.host.name)
            return {"ok": False, "error": str(e)}
