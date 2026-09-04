# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/vmware_vcenter/vcenter_src/client/vcenter_client.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: pyVmomi-based vCenter client.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""pyVmomi-based vCenter client.

Connects to vCenter with ``SmartConnect`` and exposes read-only list APIs
for VMs, ESXi hosts and datastores.  The pyVmomi import is guarded so this
module can be imported cleanly in linting / unit-test contexts where the
dependency may not be present.
"""

from __future__ import annotations

import logging
import ssl
from dataclasses import dataclass
from typing import Any

# pyVmomi is a runtime dependency; keep the module importable without it.
try:  # pragma: no cover - optional runtime dependency
    from pyVim.connect import Disconnect, SmartConnect
    from pyVmomi import vim
except ImportError:  # pragma: no cover
    Disconnect = None  # type: ignore[assignment]
    SmartConnect = None  # type: ignore[assignment]
    vim = None  # type: ignore[assignment]

log = logging.getLogger(__name__)


class VCenterError(Exception):
    """Raised when the vCenter API returns an unexpected response."""


class VCenterAuthError(VCenterError):
    """Invalid credentials or insufficient privileges."""


class VCenterTimeoutError(VCenterError):
    """Connection or read timeout to vCenter."""


@dataclass(frozen=True)
class VCenterHost:
    """Connection parameters for a single vCenter appliance."""

    name: str
    host: str
    port: int
    username: str
    password: str
    verify_ssl: bool = True


class VCenterClient:
    """Minimal pyVmomi client for the VMware vCenter integration."""

    def __init__(self, host: VCenterHost) -> None:
        self.host = host
        self._si: Any = None

    # -------------------------------------------------------------- vCenter APIs

    def connect(self) -> dict[str, Any]:
        """Open a SmartConnect session and return an ``{'ok': ...}`` status."""
        if SmartConnect is None or vim is None:  # pragma: no cover
            return {"ok": False, "error": "pyvmomi not installed"}
        try:
            ssl_context = None
            if not self.host.verify_ssl:
                # User explicitly disabled SSL verification. Create an insecure
                # context explicitly so the intent is clear to SAST tooling.
                ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE
            self._si = SmartConnect(
                host=self.host.host,
                user=self.host.username,
                pwd=self.host.password,
                port=self.host.port,
                sslContext=ssl_context,
            )
            return {"ok": True, "data": []}
        except vim.fault.InvalidLogin as e:
            raise VCenterAuthError(f"Invalid login for {self.host.name} ({self.host.host}): {e}") from e
        except Exception as e:
            message = str(e).lower()
            if "timeout" in message or "timed out" in message:
                raise VCenterTimeoutError(f"Timeout connecting to {self.host.name} ({self.host.host}): {e}") from e
            raise VCenterError(f"Failed to connect to {self.host.name} ({self.host.host}): {e}") from e

    def list_vms(self) -> dict[str, Any]:
        """Return all virtual machines as ``{'ok': True, 'data': [...]}``.

        If pyVmomi is not installed, returns ``{'ok': False, 'error': 'pyvmomi not installed'}``.
        """
        if SmartConnect is None or vim is None:  # pragma: no cover
            return {"ok": False, "error": "pyvmomi not installed"}
        self._ensure_connected()
        content = self._si.RetrieveContent()
        view = content.viewManager.CreateContainerView(content.rootFolder, [vim.VirtualMachine], True)
        data: list[dict[str, Any]] = []
        for vm in view.view:
            data.append({
                "name": vm.name,
                "power_state": str(vm.runtime.powerState),
                "mo_ref": str(vm._moId),
            })
        view.Destroy()
        return {"ok": True, "data": data}

    def list_hosts(self) -> dict[str, Any]:
        """Return all ESXi hosts as ``{'ok': True, 'data': [...]}``.

        If pyVmomi is not installed, returns ``{'ok': False, 'error': 'pyvmomi not installed'}``.
        """
        if SmartConnect is None or vim is None:  # pragma: no cover
            return {"ok": False, "error": "pyvmomi not installed"}
        self._ensure_connected()
        content = self._si.RetrieveContent()
        view = content.viewManager.CreateContainerView(content.rootFolder, [vim.HostSystem], True)
        data: list[dict[str, Any]] = []
        for h in view.view:
            data.append({
                "name": h.name,
                "connection_state": str(h.runtime.connectionState),
                "power_state": str(h.runtime.powerState),
                "status": str(h.overallStatus),
                "mo_ref": str(h._moId),
            })
        view.Destroy()
        return {"ok": True, "data": data}

    def list_datastores(self) -> dict[str, Any]:
        """Return all datastores as ``{'ok': True, 'data': [...]}``.

        If pyVmomi is not installed, returns ``{'ok': False, 'error': 'pyvmomi not installed'}``.
        """
        if SmartConnect is None or vim is None:  # pragma: no cover
            return {"ok": False, "error": "pyvmomi not installed"}
        self._ensure_connected()
        content = self._si.RetrieveContent()
        view = content.viewManager.CreateContainerView(content.rootFolder, [vim.Datastore], True)
        data: list[dict[str, Any]] = []
        for ds in view.view:
            capacity = ds.summary.capacity or 0
            free = ds.summary.freeSpace or 0
            data.append({
                "name": ds.name,
                "type": ds.summary.type,
                "accessible": bool(ds.summary.accessible),
                "capacity_gb": round(capacity / (1024**3), 2),
                "free_gb": round(free / (1024**3), 2),
                "used_gb": round((capacity - free) / (1024**3), 2),
                "mo_ref": str(ds._moId),
            })
        view.Destroy()
        return {"ok": True, "data": data}

    def disconnect(self) -> None:
        """Close the active SmartConnect session if one exists."""
        if self._si is not None and Disconnect is not None:
            try:
                Disconnect(self._si)
            except Exception:
                log.exception("Disconnect failed for %s", self.host.name)
            finally:
                self._si = None

    # ----------------------------------------------------------------- internal

    def _ensure_connected(self) -> None:
        if self._si is None:
            result = self.connect()
            if not result.get("ok"):
                raise VCenterError(result.get("error", "pyvmomi not installed"))
