# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/active_directory/ad_src/client/ldap_client.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Active Directory LDAP client using ldap3.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Active Directory LDAP client using ldap3.

The ``ldap3`` import is guarded so this module can be imported in linting
and unit-test contexts where the dependency may not be installed.
"""

from __future__ import annotations

import contextlib
import logging
from dataclasses import dataclass
from typing import Any

# ldap3 is a runtime dependency; keep the module importable without it.
try:  # pragma: no cover - optional runtime dependency
    import ldap3
except ImportError:  # pragma: no cover
    ldap3 = None  # type: ignore[assignment]

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ADHost:
    """Connection parameters for an Active Directory LDAP server."""

    name: str
    server: str
    port: int = 636
    use_ssl: bool = True
    bind_dn: str = ""
    bind_password: str = ""
    base_dn: str = ""
    verify_tls: bool = True


class ADClient:
    """Minimal read-only LDAP client for the Active Directory integration."""

    def __init__(self, host: ADHost) -> None:
        self.host = host

    def _server(self) -> Any:
        """Build an ldap3 Server from the host configuration."""
        raw = self.host.server
        if raw.startswith("ldaps://"):
            use_ssl = True
            host = raw[8:]
        elif raw.startswith("ldap://"):
            use_ssl = False
            host = raw[7:]
        else:
            use_ssl = bool(self.host.use_ssl)
            host = raw

        if ldap3 is None:  # pragma: no cover - guarded at call sites
            raise RuntimeError("ldap3 not installed")

        if not self.host.verify_tls:
            import ssl

            tls = ldap3.Tls(validate=ssl.CERT_NONE)
        else:
            tls = None

        return ldap3.Server(
            host,
            port=self.host.port,
            use_ssl=use_ssl,
            tls=tls,
            get_info=ldap3.NONE,
        )

    def _connect(self) -> Any:
        """Open an auto-bound ldap3 Connection."""
        if ldap3 is None:  # pragma: no cover - guarded at call sites
            raise RuntimeError("ldap3 not installed")
        server = self._server()
        return ldap3.Connection(
            server,
            user=self.host.bind_dn,
            password=self.host.bind_password,
            auto_bind=True,
            receive_timeout=15,
        )

    def test_connection(self) -> dict[str, Any]:
        """Validate the configured bind DN can connect to the AD server."""
        if ldap3 is None:
            return {"ok": False, "error": "ldap3 not installed"}
        try:
            conn = self._connect()
            with contextlib.suppress(Exception):
                conn.unbind()
            return {
                "ok": True,
                "data": [
                    {
                        "name": self.host.name,
                        "server": self.host.server,
                        "base_dn": self.host.base_dn,
                    }
                ],
            }
        except Exception as e:
            log.exception("AD connection test failed for %s", self.host.name)
            return {"ok": False, "error": str(e)}

    def list_users(self) -> dict[str, Any]:
        """List user objects under the configured base DN."""
        if ldap3 is None:
            return {"ok": False, "error": "ldap3 not installed"}
        try:
            conn = self._connect()
            try:
                conn.search(
                    self.host.base_dn,
                    "(objectClass=user)",
                    attributes=[
                        "sAMAccountName",
                        "cn",
                        "distinguishedName",
                        "mail",
                        "displayName",
                        "userPrincipalName",
                    ],
                )
                data = _entries_to_dicts(conn.entries)
            finally:
                with contextlib.suppress(Exception):
                    conn.unbind()
            return {"ok": True, "data": data}
        except Exception as e:
            log.exception("AD users list failed for %s", self.host.name)
            return {"ok": False, "error": str(e)}

    def list_groups(self) -> dict[str, Any]:
        """List group objects under the configured base DN."""
        if ldap3 is None:
            return {"ok": False, "error": "ldap3 not installed"}
        try:
            conn = self._connect()
            try:
                conn.search(
                    self.host.base_dn,
                    "(objectClass=group)",
                    attributes=[
                        "cn",
                        "sAMAccountName",
                        "distinguishedName",
                        "member",
                        "groupType",
                        "description",
                    ],
                )
                data = _entries_to_dicts(conn.entries)
            finally:
                with contextlib.suppress(Exception):
                    conn.unbind()
            return {"ok": True, "data": data}
        except Exception as e:
            log.exception("AD groups list failed for %s", self.host.name)
            return {"ok": False, "error": str(e)}


def _entries_to_dicts(entries: Any) -> list[dict[str, Any]]:
    """Normalize a list of ldap3 Entry objects into plain dicts."""
    out: list[dict[str, Any]] = []
    for entry in entries:
        out.append({
            "dn": str(entry.entry_dn),
            "attributes": entry.entry_attributes_as_dict,
        })
    return out
