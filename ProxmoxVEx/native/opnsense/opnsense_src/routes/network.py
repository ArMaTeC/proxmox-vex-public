# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/opnsense/opnsense_src/routes/network.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Network detail endpoint — interfaces + gateways +...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Network detail endpoint — interfaces + gateways + routes + neighbors.

Used by the Network tab. Heavier than overview (ARP/NDP can be hundreds of
rows) so it's its own route to keep the overview tick fast.
"""

from __future__ import annotations

import logging
from typing import Any

from opnsense_src.client import (
    OPNsenseAuthError,
    OPNsenseClient,
    OPNsenseError,
    OPNsenseHost,
    OPNsenseTimeoutError,
)
from opnsense_src.collectors import (
    collect_arp,
    collect_gateways,
    collect_interfaces,
    collect_ndp,
    collect_routes,
)

log = logging.getLogger(__name__)


def build_network(client: OPNsenseClient) -> dict[str, Any]:
    return {
        "interfaces": collect_interfaces(client),
        "gateways": collect_gateways(client),
        "routes": collect_routes(client),
        "arp": collect_arp(client),
        "ndp": collect_ndp(client),
    }


def build_network_payload(host: OPNsenseHost) -> tuple[int, dict[str, Any]]:
    client = OPNsenseClient(host)
    try:
        return 200, {"ok": True, "data": build_network(client)}
    except OPNsenseAuthError as e:
        return 401, {"ok": False, "error": "auth", "detail": str(e)}
    except OPNsenseTimeoutError as e:
        return 504, {"ok": False, "error": "timeout", "detail": str(e)}
    except OPNsenseError as e:
        log.exception("network failed")
        return 502, {"ok": False, "error": "upstream", "detail": str(e)}
