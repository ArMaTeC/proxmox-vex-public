# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/opnsense/opnsense_src/collectors/firewall_log.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Firewall log tail.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Firewall log tail.

Endpoint `/api/diagnostics/firewall/log?limit=N` returns recent rule hits.
This collector limits + projects to a slim shape — full payload is bulky
(372KB on a quiet lab; far worse on a busy firewall).
"""

from __future__ import annotations

from typing import TypedDict

from opnsense_src.client import OPNsenseClient


class LogEntry(TypedDict):
    timestamp: str
    interface: str
    action: str  # "pass" | "block" | "rdr" | "nat" | "binat"
    direction: str  # "in" | "out"
    rule_label: str
    src: str
    dst: str
    protocol: str
    ip_version: str
    length: int


def _safe_int(value: object) -> int:
    try:
        return int(str(value).strip())
    except (ValueError, AttributeError):
        return 0


def collect_firewall_log(client: OPNsenseClient, limit: int = 100) -> list[LogEntry]:
    rows = client.get(f"/api/diagnostics/firewall/log?limit={int(limit)}")
    out: list[LogEntry] = []
    if not isinstance(rows, list):
        return out
    for r in rows:
        out.append(
            LogEntry(
                timestamp=str(r.get("__timestamp__", "")),
                interface=str(r.get("interface", "")),
                action=str(r.get("action", "")),
                direction=str(r.get("dir", "")),
                rule_label=str(r.get("label", "")),
                src=str(r.get("src", "")),
                dst=str(r.get("dst", "")),
                protocol=str(r.get("protoname", r.get("protonum", ""))),
                ip_version=str(r.get("ipversion", "")),
                length=_safe_int(r.get("length", 0)),
            )
        )
    return out
