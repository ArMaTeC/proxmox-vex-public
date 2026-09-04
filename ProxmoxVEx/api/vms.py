# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/api/vms.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: VM operations, snapshots, backups, replication &...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""VM operations, snapshots, backups, replication & console routes - split from monolith dec 2025"""

import contextlib
import gzip
import hashlib
import html
import json
import logging
import os
import re
import shlex
import shutil
import socket
import ssl
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import quote as url_quote
from urllib.parse import urlencode

import requests
from flask import Blueprint, current_app, g, jsonify, make_response, request
from requests.adapters import HTTPAdapter

from ProxmoxVEx.api.helpers import (
    check_cluster_access,
    get_connected_manager,
    register_task_user,
)
from ProxmoxVEx.api.realtime import sock
from ProxmoxVEx.background.bulk_actions import VALID_BULK_ACTIONS, get_bulk_job, start_bulk_job
from ProxmoxVEx.constants import VERIFY_SSL  # noqa: F401
from ProxmoxVEx.core.cache import vm_list_cache
from ProxmoxVEx.core.config import save_config
from ProxmoxVEx.core.db import get_db
from ProxmoxVEx.globals import cluster_managers
from ProxmoxVEx.models.permissions import ROLE_ADMIN
from ProxmoxVEx.utils.audit import log_audit
from ProxmoxVEx.utils.auth import build_authz_user, load_users, require_auth, validate_session
from ProxmoxVEx.utils.qemu_guest_agent import (
    detect_os_from_pve_config,
    get_iso_path,
    safe_iso_filename,
)
from ProxmoxVEx.utils.rbac import get_user_permissions, user_can_access_vm
from ProxmoxVEx.utils.realtime import broadcast_action, broadcast_sse, push_immediate_update
from ProxmoxVEx.utils.sanitization import (
    sanitize_int,
    validate_storage_name,
)
from ProxmoxVEx.utils.sanitization import (
    sanitize_log_message as _sl,  # CWE-117 tainted-log sanitiser
)
from ProxmoxVEx.utils.ssh import apply_ssh_host_key_policy, get_paramiko
from ProxmoxVEx.utils.validation import validate_body


def _pve_url(url):
    return url_quote(url, safe=":/?=&")


def _require_vm_access(cluster_id, vmid, perm, vm_type=None):
    """Per-VM BOLA/IDOR guard.  : several VM-scoped detail and
    action routes only did check_cluster_access + a role permission and never honoured
    per-VM ACLs (the /resources LIST did) — a confused deputy that let a low-priv or
    tenant user read/act on a restricted VM. Returns None when the acting (token-scoped)
    user may access this VM for `perm`, else a jsonify(403) tuple the caller must return.
    build_authz_user applies effective_role so an admin-owned scoped token can't bypass."""
    user = build_authz_user(request.session.get("user", ""), request.session)
    if not user_can_access_vm(user, cluster_id, vmid, perm, vm_type):
        # Return a per-VM denial that distinguishes VM-level authz from cluster-level.
        # html.escape defangs the permission string for SAST taint tracking.
        return jsonify({"error": f"Access denied to this VM ({html.escape(perm)})"}), 403
    return None


bp = Blueprint("vms", __name__)

# 856-connection-pooling-for-bulk-operations: keep a shared session with a connection
# pool sized for high-volume bulk API traffic, avoiding repeated TCP setup/teardown.
BULK_OPERATIONS_SESSION = requests.Session()
BULK_OPERATIONS_SESSION.mount(
    "https://", HTTPAdapter(pool_connections=20, pool_maxsize=100)
)
BULK_OPERATIONS_SESSION.mount(
    "http://", HTTPAdapter(pool_connections=20, pool_maxsize=100)
)


def _access_denied():
    return jsonify({"error": "Access denied to this cluster"}), 403


def _cluster_not_found():
    return jsonify({"error": "Cluster not found"}), 404


def _cluster_not_connected():
    return jsonify({"error": "Cluster not connected", "offline": True}), 503


def _api_error(default_msg, status=500, success=None):
    logging.exception(default_msg)
    body = {"error": default_msg}
    if success is not None:
        body["success"] = success
    return jsonify(body), status


def _pve_error(response, status=None):
    text = (response.text or "").strip()[:500]
    msg = "Proxmox API error"
    if text:
        try:
            data = json.loads(text.replace("\\n", " "))
            _m = data.get("message") or data.get("errors") or data.get("error")
            if isinstance(_m, dict):
                _m = "; ".join(f"{k}: {v}" for k, v in _m.items())
            if _m:
                msg = _m
        except Exception:
            msg = text
    return jsonify({"error": html.escape(str(msg))}), (status or response.status_code)


# VNC connection hardening helpers. We keep the proxy path through
# ProxmoxVEx (most customer browsers can't reach the PVE node directly), so the
# resilience has to come from the proxy code itself. These helpers apply OS-level
# keepalive and a shared connect timeout that's long enough for slow corporate
# inspection middleboxes (TLS DPI, Falcon-style EDR scoring) to finish their work.
VNC_PVE_CONNECT_TIMEOUT = int(os.environ.get("PROXMOXVEX_VNC_CONNECT_TIMEOUT", "15"))
_WS_FALLBACK_HOST = os.environ.get("PROXMOXVEX_WS_FALLBACK_HOST", "0.0.0.0")


# 2026-05-06: cluster-add / -join nehmen frei eingegebene node-targets
# entgegen. Semgrep flagt das als tainted-flask-input -> paramiko.connect.
# Paramiko's connect() ist zwar nicht shell-injectable, aber wir wollen auch
# nicht dass jemand der admin.cluster perm hat hier internal network scans
# triggert via 192.168.1.255 oder so. Strikte regex auf hostname/ipv4/ipv6.
_HOST_RE = re.compile(
    r"^(?:"
    r"(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?"
    r"(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*)"
    r"|"
    r"(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})"
    r"|"
    r"(?:\[[0-9a-fA-F:]+\])"
    r")$"
)


def _validate_host(value):
    """Return value if it looks like a hostname/IPv4/IPv6, else None.
    Used at the boundary where flask request input flows into paramiko.connect."""
    v = (value or "").strip()
    if not v or len(v) > 253:
        return None
    return v if _HOST_RE.match(v) else None


def _apply_vnc_socket_options(sock):
    """Apply TCP_NODELAY + aggressive TCP keepalive to a VNC-forwarding socket.

    Stateful firewalls / EDR-network-filters often drop "established" TCP sessions
    that look idle. RFB has natural quiet periods (user reading, no mouse/key
    activity). Default Linux keepalive is 2h idle which doesn't help. 15s idle +
    5s probe interval + 3 misses survives most enterprise conntrack timeouts.
    Best-effort — failures are logged debug, not raised."""
    try:
        import socket as _s

        sock.setsockopt(_s.IPPROTO_TCP, _s.TCP_NODELAY, 1)
        sock.setsockopt(_s.SOL_SOCKET, _s.SO_KEEPALIVE, 1)
        if hasattr(_s, "TCP_KEEPIDLE"):
            sock.setsockopt(_s.IPPROTO_TCP, _s.TCP_KEEPIDLE, 15)
        if hasattr(_s, "TCP_KEEPINTVL"):
            sock.setsockopt(_s.IPPROTO_TCP, _s.TCP_KEEPINTVL, 5)
        if hasattr(_s, "TCP_KEEPCNT"):
            sock.setsockopt(_s.IPPROTO_TCP, _s.TCP_KEEPCNT, 3)
    except Exception as _e:
        logging.debug(f"[VNC] socket options not fully applied: {_e}")


# =====================================================
# DATACENTER / CLUSTER CONFIGURATION API
# =====================================================


@bp.route("/api/clusters/<cluster_id>/datacenter/status", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_datacenter_status(cluster_id):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port

        # Cluster-wide aggregates ([cluster/status] + [cluster/resources])
        # are genuinely expensive on big clusters (PVE walks every node to build the
        # response). 10s was too tight; bump to 15s and mark the host as cold on
        # timeout so subsequent calls roll over to a fallback host via the
        # connect_to_proxmox skip-cache.
        status_url = f"https://{host}:{port}/api2/json/cluster/status"
        resources_url = f"https://{host}:{port}/api2/json/cluster/resources"
        # (SSE-perf): these two full node-walks were issued SERIALLY, so
        # the route's wall-time was the SUM of two heavy aggregations. Fire them
        # concurrently (shared pooled session) → wall-time is the MAX. run_concurrent
        # swallows per-task exceptions into None, so we detect a failed walk and keep
        # the original cold-host + reconnect failover.
        from ProxmoxVEx.utils.concurrent import run_concurrent

        sess = manager._create_session()
        status_resp, resources_resp = run_concurrent(
            [
                lambda: sess.get(status_url, timeout=15),
                lambda: sess.get(resources_url, timeout=15),
            ],
            timeout=20,
        )
        if status_resp is None or resources_resp is None:
            # a walk timed out / errored — mark the primary cold AND force an
            # immediate reconnect so manager.host pivots to a warm fallback for the
            # next request (otherwise the host pointer still points at the dead one).
            manager._mark_host_failure(host)
            try:
                manager.is_connected = False
                manager.connect_to_proxmox()
            except Exception as _e:
                pass  # best-effort; user sees the offline state this round
            # lgtm[py/reflected-xss]
            return jsonify({"error": "Cluster temporarily unreachable", "offline": True}), 503

        status_data = status_resp.json().get("data", []) if status_resp.status_code == 200 else []
        resources_data = resources_resp.json().get("data", []) if resources_resp.status_code == 200 else []

        # calc summary
        nodes_online = sum(1 for s in status_data if s.get("type") == "node" and s.get("online", 0) == 1)
        nodes_offline = sum(1 for s in status_data if s.get("type") == "node" and s.get("online", 0) == 0)
        cluster_info = next((s for s in status_data if s.get("type") == "cluster"), None)
        is_standalone = cluster_info is None

        vms_running = sum(1 for r in resources_data if r.get("type") == "qemu" and r.get("status") == "running")
        vms_stopped = sum(1 for r in resources_data if r.get("type") == "qemu" and r.get("status") == "stopped")
        cts_running = sum(1 for r in resources_data if r.get("type") == "lxc" and r.get("status") == "running")
        cts_stopped = sum(1 for r in resources_data if r.get("type") == "lxc" and r.get("status") == "stopped")

        # Calculate total resources
        total_cpu = sum(r.get("maxcpu", 0) for r in resources_data if r.get("type") == "node")
        used_cpu = sum(r.get("cpu", 0) * r.get("maxcpu", 0) for r in resources_data if r.get("type") == "node")
        total_mem = sum(r.get("maxmem", 0) for r in resources_data if r.get("type") == "node")
        used_mem = sum(r.get("mem", 0) for r in resources_data if r.get("type") == "node")
        total_disk = sum(r.get("maxdisk", 0) for r in resources_data if r.get("type") == "storage")
        used_disk = sum(r.get("disk", 0) for r in resources_data if r.get("type") == "storage")

        # Single-node Proxmox doesn't return a cluster entry, was showing red X for no reason
        if is_standalone:
            node_name = next((s.get("name", "") for s in status_data if s.get("type") == "node"), manager.config.name)
            cluster_result = {"name": node_name, "quorate": None, "standalone": True, "version": 0}
        else:
            cluster_result = {
                "name": cluster_info.get("name", "Unknown"),
                "quorate": cluster_info.get("quorate", 0) == 1,
                "standalone": False,
                "version": cluster_info.get("version", 0),
            }

        # lgtm[py/reflected-xss]
        return jsonify({
            "cluster": cluster_result,
            "nodes": {"online": nodes_online, "offline": nodes_offline, "total": nodes_online + nodes_offline},
            "guests": {
                "vms": {"running": vms_running, "stopped": vms_stopped},
                "containers": {"running": cts_running, "stopped": cts_stopped},
            },
            "resources": {
                "cpu": {
                    "total": total_cpu,
                    "used": used_cpu,
                    "percent": round(used_cpu / total_cpu * 100, 1) if total_cpu > 0 else 0,
                },
                "memory": {
                    "total": total_mem,
                    "used": used_mem,
                    "percent": round(used_mem / total_mem * 100, 1) if total_mem > 0 else 0,
                },
                "storage": {
                    "total": total_disk,
                    "used": used_disk,
                    "percent": round(used_disk / total_disk * 100, 1) if total_disk > 0 else 0,
                },
            },
        })
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
        logging.warning(f"[API] Cluster {cluster_id} unreachable for datacenter/status: {e}")
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster temporarily unreachable", "offline": True}), 503
    except Exception:
        return _api_error("Failed to get datacenter status", status=500)


@bp.route("/api/clusters/<cluster_id>/vms", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_cluster_vms_list(cluster_id):
    """Get all VMs and containers in a cluster

    Added Dec 2025 for VM ACL management
    Returns simple list with vmid, name, node, type
    """
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    # 009-perf-cached-vm-list: serve cached VM list when available
    user_id = request.session.get("user")
    cached = vm_list_cache.get(cluster_id, user_id)
    if cached is not None:
        return jsonify({"vms": cached, "from_cache": True})

    # Use manager method instead of raw API call - handles timeouts gracefully
    resources = manager.get_vm_resources()
    vms = []
    for r in resources:
        if r.get("type") in ["qemu", "lxc"] and r.get("vmid"):
            vms.append({
                "vmid": r.get("vmid"),
                "name": r.get("name", ""),
                "node": r.get("node"),
                "type": r.get("type"),
                "status": r.get("status", "unknown"),
            })
    vms.sort(key=lambda x: x.get("vmid", 0))
    vm_list_cache.set(cluster_id, user_id, vms)
    # lgtm[py/reflected-xss]
    return jsonify({"vms": vms, "from_cache": False})


@bp.route("/api/clusters/<cluster_id>/datacenter/cluster-info", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_cluster_info(cluster_id):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        session = manager._create_session()

        # Try corosync config first (has ring0_addr for join info)
        nodes = []
        try:
            url = f"https://{host}:{port}/api2/json/cluster/config/nodes"
            r = session.get(url, timeout=5)
            if r.status_code == 200:
                nodes = r.json().get("data", [])
        except Exception as _e:
            pass

        # Merge with /nodes to get online status (corosync config doesn't have it)
        # Also serves as fallback for standalone nodes without corosync
        try:
            nodes_url = f"https://{host}:{port}/api2/json/nodes"
            nr = session.get(nodes_url, timeout=5)
            if nr.status_code == 200:
                api_nodes = {n.get("node", n.get("name", "")): n for n in nr.json().get("data", [])}

                if nodes:
                    # Merge online status into corosync nodes
                    for node in nodes:
                        name = node.get("name", "")
                        if name in api_nodes:
                            node["online"] = 1 if api_nodes[name].get("status") == "online" else 0
                            node["node"] = name
                else:
                    # No corosync data - use /nodes as primary source
                    nodes = [
                        {
                            "name": n.get("node", ""),
                            "node": n.get("node", ""),
                            "online": 1 if n.get("status") == "online" else 0,
                        }
                        for n in nr.json().get("data", [])
                    ]
        except Exception as _e:
            pass

        # lgtm[py/reflected-xss]
        return jsonify(nodes)
    except Exception as _e:
        # lgtm[py/reflected-xss]
        return jsonify([])


@bp.route("/api/clusters/<cluster_id>/datacenter/join-info", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_join_info(cluster_id):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port

        # try to get join info
        url = f"https://{host}:{port}/api2/json/cluster/config/join"
        r = manager._create_session().get(url, timeout=5)

        if r.status_code == 200:
            data = r.json().get("data", {})
            if "preferred_node" not in data:
                data["preferred_node"] = host
            # Proxmox returns fingerprint as 'pve_fp' per node,
            # but frontend expects top-level 'fingerprint'. Extract it.
            if not data.get("fingerprint"):
                for node_entry in data.get("nodelist", []):
                    if isinstance(node_entry, dict) and node_entry.get("pve_fp"):
                        data["fingerprint"] = node_entry["pve_fp"]
                        break
            # Still no fingerprint? Get from SSL cert
            if not data.get("fingerprint"):
                try:
                    context = ssl.create_default_context()
                    context.check_hostname = False
                    context.verify_mode = ssl.CERT_NONE
                    with socket.create_connection((host, 8006), timeout=5) as sock, context.wrap_socket(
                        sock, server_hostname=host
                    ) as ssock:
                        cert_der = ssock.getpeercert(binary_form=True)
                        fp_hex = hashlib.sha256(cert_der).hexdigest()
                        data["fingerprint"] = ":".join(fp_hex[i : i + 2].upper() for i in range(0, len(fp_hex), 2))
                except Exception as _e:
                    pass
            # lgtm[py/reflected-xss]
            return jsonify(data)

        # fallback
        result = {"cluster_name": None, "fingerprint": None, "preferred_node": host, "nodelist": []}

        status_url = f"https://{host}:{port}/api2/json/cluster/status"
        status_resp = manager._create_session().get(status_url, timeout=5)

        if status_resp.status_code == 200:
            status_data = status_resp.json().get("data", [])
            cluster_info = next((s for s in status_data if s.get("type") == "cluster"), {})
            nodes = [s for s in status_data if s.get("type") == "node"]

            result["cluster_name"] = cluster_info.get("name", "Unknown")
            result["nodelist"] = [
                {"name": n.get("name"), "ip": n.get("ip"), "online": n.get("online", 0)} for n in nodes
            ]

        # get nodes config
        nodes_url = f"https://{host}:{port}/api2/json/cluster/config/nodes"
        nodes_resp = manager._create_session().get(nodes_url, timeout=5)

        if nodes_resp.status_code == 200:
            nodes_data = nodes_resp.json().get("data", [])
            for node in nodes_data:
                # Update nodelist with ring0_addr
                for n in result["nodelist"]:
                    if n["name"] == node.get("name"):
                        n["ring0_addr"] = node.get("ring0_addr")
                        n["pve_addr"] = node.get("pve_addr")

        # Try to get fingerprint via SSL certificate
        try:
            context = ssl.create_default_context()
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE

            with socket.create_connection((host, 8006), timeout=5) as sock, context.wrap_socket(
                sock, server_hostname=host
            ) as ssock:
                cert_der = ssock.getpeercert(binary_form=True)
                fingerprint = hashlib.sha256(cert_der).hexdigest()
                # Format as colon-separated uppercase
                result["fingerprint"] = ":".join(fingerprint[i : i + 2].upper() for i in range(0, len(fingerprint), 2))
        except Exception as e:
            logging.debug(f"Could not get SSL fingerprint: {e}")
            result["fingerprint"] = f'Run "pvecm status" on {host} to get fingerprint'

        # lgtm[py/reflected-xss]
        return jsonify(result)

    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
        logging.warning(f"[API] Cluster {cluster_id} unreachable for join-info: {e}")
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster temporarily unreachable", "offline": True}), 503
    except Exception:
        return _api_error("Failed to get cluster info", status=500)


@bp.route("/api/clusters/<cluster_id>/datacenter/options", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_datacenter_options(cluster_id):
    """Get datacenter options"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/cluster/options"
        response = manager._create_session().get(url, timeout=5)

        if response.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(response.json().get("data", {}))
        # lgtm[py/reflected-xss]
        return jsonify({})
    except Exception:
        return _api_error("Failed to get datacenter options", status=500)


@bp.route("/api/clusters/<cluster_id>/datacenter/options", methods=["PUT"])
@require_auth(perms=["cluster.config"])
@validate_body({
    k: {"required": False}
    for k in {
        "keyboard",
        "language",
        "console",
        "email_from",
        "max_workers",
        "migration",
        "migration_unsecure",
        "ha",
        "fencing",
        "mac_prefix",
        "bwlimit",
        "u2f",
        "webauthn",
        "description",
        "tag-style",
        "notify",
        "registered-tags",
        "user-tag-access",
        "crs",
    }
})
def set_datacenter_options(cluster_id):
    """Update datacenter options"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    # Allowlist of valid datacenter options to prevent mass assignment
    ALLOWED_DC_OPTIONS = {
        "keyboard",
        "language",
        "console",
        "email_from",
        "max_workers",
        "migration",
        "migration_unsecure",
        "ha",
        "fencing",
        "mac_prefix",
        "bwlimit",
        "u2f",
        "webauthn",
        "description",
        "tag-style",
        "notify",
        "registered-tags",
        "user-tag-access",
        "crs",
    }
    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/cluster/options"
        raw_data = request.json or {}
        data = {k: v for k, v in raw_data.items() if k in ALLOWED_DC_OPTIONS}

        # Version-gate the crs sub-keys. Live-probed PVE 9.2.2:
        #   scheduling=basic  → 400 "property is not defined in schema"
        #   ha-rebalance-on-start=1 → 200 OK
        #   ha-auto-rebalance=1     → 200 OK
        #   ha-auto-rebalance-{threshold,method,margin,hold-duration} → 200 OK
        # Any one rejected sub-key tanks the whole crs PUT — so a UI that
        # picks "Basic" in the Scheduling Mode dropdown blocked every other
        # CRS field too. Strip `scheduling=` on 9.2+ so admins can still
        # save the auto-rebalance settings.
        # (Pre-9.2 keeps scheduling — it's still in the schema there.)
        if "crs" in data and isinstance(data["crs"], str) and data["crs"]:
            pve_ver = manager.get_pve_version_tuple()
            if pve_ver is not None and pve_ver >= (9, 2):
                kept = []
                dropped = []
                for part in data["crs"].split(","):
                    key = part.split("=", 1)[0].strip()
                    if key == "scheduling":
                        dropped.append(part)
                        continue
                    kept.append(part)
                if dropped:
                    data["crs"] = ",".join(kept)
                    if not data["crs"]:
                        data.pop("crs", None)
                    try:
                        from ProxmoxVEx.utils.audit import log_audit

                        log_audit(
                            request.session.get("user", "system"),
                            "datacenter.crs.stripped",
                            f"PVE {pve_ver[0]}.{pve_ver[1]} — dropped {dropped}",
                            cluster=manager.config.name,
                        )
                    except Exception as _e:
                        pass

        # /cluster/options PUT can legitimately take 15-25s on
        # busy clusters (PVE writes datacenter.cfg, ipcc-syncs to all nodes,
        # restarts pveproxy on each). The old 10s was tight enough to fail
        # consistently on the ESXi-Test-Env lab; bump to 30s. If it still
        # times out the host is genuinely wedged — mark it cold so the next
        # request goes via fallback instead of waiting 30s again.
        try:
            response = manager._create_session().put(url, data=data, timeout=30)
        except requests.exceptions.Timeout:
            manager._mark_host_failure(host)
            try:
                manager.is_connected = False
                manager.connect_to_proxmox()
            except Exception as _e:
                pass
            raise

        if response.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify({"success": True, "message": "Options updated"})
        # lgtm[py/reflected-xss]
        return _pve_error(response)
    except requests.exceptions.Timeout:
        # Map to 504 so the frontend knows it's a slow-PVE thing, not a code bug.
        # Settings *may* have applied — pveproxy on busy clusters sometimes
        # commits the write but doesn't reply in time. Operator should re-load.
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": "PVE took too long to apply datacenter options. The change may still have been written — reload the page to verify.",
            "timeout": True,
        }), 504
    except Exception:
        return _api_error("Failed to set datacenter options", status=500)


# Storage API
@bp.route("/api/clusters/<cluster_id>/datacenter/storage", methods=["GET"])
@require_auth(perms=["storage.view"])
def get_storage_list(cluster_id):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/storage"
        r = manager._create_session().get(url, timeout=5)

        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(r.json().get("data", []))
        # lgtm[py/reflected-xss]
        return jsonify([])
    except Exception as _e:
        # lgtm[py/reflected-xss]
        return jsonify([])


# (SSE-perf): short per-cluster cache for the datastores aggregate.
# get_datastores fans out /nodes/<node>/storage per ONLINE node (O(nodes), 8-wide,
# ~13 serial waves at 100 nodes) with no cache, and since 0548dc3/32486a6 it rides
# BOTH the 15s selected-cluster poll AND a 30s per-expanded-sidebar-cluster loop
# so the heavy fan-out fired several times a minute per cluster. Storage totals move
# on grow/add, not per-15s, so a small snapshot collapses the overlapping pollers
# (and multiple browser tabs) onto one fan-out per window. Keyed per cluster; the
# payload is cluster-global + already storage.view-gated by the caller above.
_datastores_cache = {}
_DATASTORES_TTL = 12.0


@bp.route("/api/clusters/<cluster_id>/datastores", methods=["GET"])
@require_auth(perms=["storage.view"])
def get_datastores(cluster_id):
    """Get all datastores with usage info"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    _dc = _datastores_cache.get(cluster_id)
    if _dc and (time.time() - _dc[0]) < _DATASTORES_TTL:
        # lgtm[py/reflected-xss]
        return jsonify(_dc[1])

    try:
        host, port = manager.host, manager.api_port
        sess = manager._create_session()

        # get storage configs
        storage_url = f"https://{host}:{port}/api2/json/storage"
        storage_resp = sess.get(storage_url, timeout=5)
        storage_configs = {}
        if storage_resp.status_code == 200:
            for s in storage_resp.json().get("data", []):
                storage_configs[s["storage"]] = s

        # Fetch nodes via /cluster/resources to get the *online* flag.
        # /api2/json/nodes alone doesn't tell us which are reachable; if we then
        # try to fetch /storage from a dead node we waste 10s per offline node.
        nodes = []  # [(name, status), ...]
        try:
            cr_resp = sess.get(f"https://{host}:{port}/api2/json/cluster/resources", params={"type": "node"}, timeout=5)
            if cr_resp.status_code == 200:
                for n in cr_resp.json().get("data", []):
                    nm = n.get("node")
                    if nm:
                        nodes.append((nm, n.get("status", "unknown")))
        except Exception as _e:
            pass
        if not nodes:
            # fallback to /nodes (no online flag, still iterate but trust try/except)
            nodes_resp = sess.get(f"https://{host}:{port}/api2/json/nodes", timeout=5)
            if nodes_resp.status_code == 200:
                nodes = [(n["node"], n.get("status", "unknown")) for n in nodes_resp.json().get("data", [])]

        online_nodes = [n for n, st in nodes if st == "online"]
        offline_nodes = [n for n, st in nodes if st != "online"]
        all_node_names = [n for n, _ in nodes]

        shared_storages = {}
        local_storages = {}

        # Fetch all online nodes' storage in parallel; gevent
        # patches threading so this is cheap. Each call has its own short
        # timeout so a slow node doesn't drag the whole response.
        from concurrent.futures import ThreadPoolExecutor, as_completed

        def _probe_node(node):
            try:
                u = f"https://{host}:{port}/api2/json/nodes/{node}/storage"
                r = sess.get(u, timeout=8)
                if r.status_code == 200:
                    # lgtm[py/reflected-xss]
                    return node, r.json().get("data", []), None
                # lgtm[py/reflected-xss]
                return node, [], f"HTTP {r.status_code}"
            except Exception as e:
                # lgtm[py/reflected-xss]
                return node, [], str(e)

        results = []
        if online_nodes:
            with ThreadPoolExecutor(max_workers=min(8, len(online_nodes))) as ex:
                futures = [ex.submit(_probe_node, n) for n in online_nodes]
                for fut in as_completed(futures, timeout=15):
                    try:
                        results.append(fut.result())
                    except Exception as e:
                        logging.debug(f"[datastores] future error: {e}")

        for node, storages, err in results:
            if err:
                logging.debug(f"[datastores] node {node} unreachable: {err}")
                continue
            for storage in storages:
                storage_name = storage.get("storage")
                config = storage_configs.get(storage_name, {})
                is_shared = config.get("shared", 0) == 1
                is_active_here = storage.get("active", 1) == 1 and storage.get("enabled", 1) == 1

                storage_info = {
                    "storage": storage_name,
                    "type": storage.get("type", config.get("type", "unknown")),
                    "content": storage.get("content", config.get("content", "")),
                    "total": storage.get("total", 0),
                    "used": storage.get("used", 0),
                    "avail": storage.get("avail", 0),
                    "used_fraction": storage.get("used_fraction", 0),
                    "active": storage.get("active", 1),
                    "enabled": storage.get("enabled", 1),
                    "shared": is_shared,
                    "path": config.get("path", ""),
                    "nodes": config.get("nodes", ""),
                }

                if is_shared:
                    if storage_name not in shared_storages:
                        shared_storages[storage_name] = dict(storage_info)
                        shared_storages[storage_name]["active_on"] = []
                        shared_storages[storage_name]["inactive_on"] = []
                    entry = shared_storages[storage_name]
                    (entry["active_on"] if is_active_here else entry["inactive_on"]).append(node)
                    # Always prefer the largest-known total (any reachable
                    # node should report the same number for shared, but rounding +
                    # transient zero values can flap).
                    if is_active_here and storage.get("total", 0) > entry.get("total", 0):
                        entry.update({
                            "total": storage.get("total", 0),
                            "used": storage.get("used", 0),
                            "avail": storage.get("avail", 0),
                            "used_fraction": storage.get("used_fraction", 0),
                        })
                    if is_active_here:
                        entry["active"] = 1
                        entry["enabled"] = 1
                else:
                    if node not in local_storages:
                        local_storages[node] = []
                    local_storages[node].append(storage_info)

        # For offline nodes: surface their last-known storages from the
        # cluster's storage config so the UI can render "this node has these storages,
        # node is currently offline" instead of an empty space. We can't get current
        # used/avail without contacting the node, so we mark them as `node_offline`.
        for off_node in offline_nodes:
            local_storages.setdefault(off_node, [])
            for sname, cfg in storage_configs.items():
                if cfg.get("shared", 0) == 1:
                    continue
                node_filter = cfg.get("nodes", "")
                # apply if node_filter is empty (= all nodes) or contains this node
                if node_filter and off_node not in node_filter.split(","):
                    continue
                local_storages[off_node].append({
                    "storage": sname,
                    "type": cfg.get("type", "unknown"),
                    "content": cfg.get("content", ""),
                    "total": 0,
                    "used": 0,
                    "avail": 0,
                    "used_fraction": 0,
                    "active": 0,
                    "enabled": cfg.get("disable", 0) != 1,
                    "shared": False,
                    "path": cfg.get("path", ""),
                    "nodes": node_filter,
                    "node_offline": True,
                })

        # also include shared storages from config that didn't appear (no online node mounted them)
        for sname, cfg in storage_configs.items():
            if sname not in shared_storages and cfg.get("shared", 0) == 1:
                shared_storages[sname] = {
                    "storage": sname,
                    "type": cfg.get("type", "unknown"),
                    "content": cfg.get("content", ""),
                    "total": 0,
                    "used": 0,
                    "avail": 0,
                    "used_fraction": 0,
                    "active": 0,
                    "enabled": cfg.get("disable", 0) != 1,
                    "shared": True,
                    "path": cfg.get("path", ""),
                    "nodes": cfg.get("nodes", ""),
                    "active_on": [],
                    "inactive_on": list(all_node_names),
                }

        payload = {
            "shared": list(shared_storages.values()),
            "local": local_storages,
            "nodes": all_node_names,
            "offline_nodes": offline_nodes,
        }
        _datastores_cache[cluster_id] = (time.time(), payload)
        # lgtm[py/reflected-xss]
        return jsonify(payload)
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
        logging.warning(f"[API] Cluster {cluster_id} unreachable for datastores: {e}")
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster temporarily unreachable", "offline": True}), 503
    except Exception:
        return _api_error("Failed to get storage list", status=500)


def _fmt_size_human(size):
    size = size or 0
    if size >= 1024**4:
        # lgtm[py/reflected-xss]
        return f"{size / 1024**4:.2f} TB"
    if size >= 1024**3:
        # lgtm[py/reflected-xss]
        return f"{size / 1024**3:.2f} GB"
    if size >= 1024**2:
        # lgtm[py/reflected-xss]
        return f"{size / 1024**2:.2f} MB"
    if size >= 1024:
        # lgtm[py/reflected-xss]
        return f"{size / 1024:.2f} KB"
    # lgtm[py/reflected-xss]
    return f"{int(size)} B"


def _pve_size_to_bytes(s):
    # '32G' / '500M' / '1.5T' -> bytes; a bare number is already bytes
    if not s:
        # lgtm[py/reflected-xss]
        return 0
    s = str(s).strip().upper()
    mult = {"K": 1024, "M": 1024**2, "G": 1024**3, "T": 1024**4, "P": 1024**5}
    if s and s[-1] in mult:
        try:
            # lgtm[py/reflected-xss]
            return int(float(s[:-1]) * mult[s[-1]])
        except ValueError:
            # lgtm[py/reflected-xss]
            return 0
    try:
        # lgtm[py/reflected-xss]
        return int(float(s))
    except ValueError:
        # lgtm[py/reflected-xss]
        return 0


# Shared SAN/LVM (and the StarWind starlvm plugin) only report a
# volume's real size on the node whose host currently has the LV active. Browse
# the datastore "from" any other node and the disk shows up but reads 0 bytes
# (Nico hit this on a multi-node shared LVM). The true size still lives
# cluster-wide in the owning guest's config as size=NNG, so backfill the zeros
# from there. No-op on file/thick-LVM storages that already hand us a size.
def _backfill_zero_datastore_sizes(manager, host, port, content):
    zero = [it for it in content if not (it.get("size") or 0) and it.get("vmid")]
    if not zero:
        return
    rr = manager._create_session().get(f"https://{host}:{port}/api2/json/cluster/resources?type=vm", timeout=8)
    if rr.status_code != 200:
        return
    vm_loc = {}
    for r in rr.json().get("data", []):
        vm_loc[r.get("vmid")] = (r.get("node"), "lxc" if r.get("type") == "lxc" else "qemu")

    # distinct guests we still need a config from — capped so a 10k-VM estate
    # can't turn one datastore click into thousands of config calls
    want, seen = [], set()
    for it in zero:
        vid = it.get("vmid")
        if vid in vm_loc and vid not in seen:
            seen.add(vid)
            want.append(vid)
    CAP = 250
    if len(want) > CAP:
        logging.info(
            f"[datastore] size-backfill capped at {CAP}/{len(want)} guests — some remote disks will still read 0"
        )
        want = want[:CAP]

    def _fetch(vid):
        node, vtype = vm_loc[vid]
        try:
            cr = manager._create_session().get(
                f"https://{host}:{port}/api2/json/nodes/{node}/{vtype}/{vid}/config", timeout=6
            )
            if cr.status_code == 200:
                # lgtm[py/reflected-xss]
                return vid, cr.json().get("data", {})
        except Exception as _e:
            pass
        # lgtm[py/reflected-xss]
        return vid, None

    from ProxmoxVEx.utils.concurrent import run_concurrent

    got = run_concurrent([lambda v=v: _fetch(v) for v in want], timeout=25)

    # volume-basename -> bytes, harvested from every disk line across those configs
    size_by_vol = {}
    for pair in got:
        if not pair or not pair[1]:
            continue
        for _key, val in pair[1].items():
            if not isinstance(val, str) or ":" not in val or "size=" not in val:
                continue
            base = val.split(",", 1)[0].split(":", 1)[1].split("/")[-1]  # vm-100-disk-0
            m = re.search(r"size=([0-9.]+[KMGTP]?)", val)
            if m and base:
                size_by_vol[base] = _pve_size_to_bytes(m.group(1))

    for it in zero:
        volid = it.get("volid") or ""
        base = (volid.split(":", 1)[1] if ":" in volid else volid).split("/")[-1]
        b = size_by_vol.get(base)
        if b:
            it["size"] = b
            it["size_from_config"] = True  # UI could badge this later if we want


@bp.route("/api/clusters/<cluster_id>/datastores/<storage_name>/content", methods=["GET"])
@require_auth(perms=["storage.view"])
def get_datastore_content(cluster_id, storage_name):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        node = request.args.get("node")

        # If no node specified, find first node that has this storage
        if not node:
            nodes_url = f"https://{host}:{port}/api2/json/nodes"
            nodes_response = manager._create_session().get(nodes_url, timeout=5)
            if nodes_response.status_code == 200:
                for n in nodes_response.json().get("data", []):
                    node = n["node"]
                    break

        if not node:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "No node available"}), 400

        # Get storage content
        content_url = f"https://{host}:{port}/api2/json/nodes/{node}/storage/{storage_name}/content"
        response = manager._create_session().get(content_url, timeout=5)

        if response.status_code == 200:
            content = response.json().get("data", [])
            for item in content:
                item["storage"] = storage_name
                item["node"] = node
                item["in_use"] = bool(item.get("vmid"))

            # backfill sizes PVE reported as 0 for disks whose LV is active on
            # another node (shared SAN/LVM, starlvm) — see helper above
            try:
                _backfill_zero_datastore_sizes(manager, host, port, content)
            except Exception as e:
                logging.debug(f"[datastore] size backfill skipped: {e}")

            for item in content:
                item["size_human"] = _fmt_size_human(item.get("size") or 0)

            # lgtm[py/reflected-xss]
            return jsonify(content)
        # lgtm[py/reflected-xss]
        return jsonify([])
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
        logging.warning(f"[API] Cluster {cluster_id} unreachable for storage content: {e}")
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster temporarily unreachable", "offline": True}), 503
    except Exception as e:
        logging.error(f"Error getting datastore content: {e}")
        return _api_error("Failed to get datastore content", status=500)


@bp.route("/api/clusters/<cluster_id>/datastores/<storage_name>/content/<path:volid>", methods=["DELETE"])
@require_auth(perms=["storage.delete"])
def delete_datastore_content(cluster_id, storage_name, volid):
    """Delete content from a datastore (ISO, backup, etc.)"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        node = request.args.get("node")

        if not node:
            # Find a node that has this storage
            nodes_url = f"https://{host}:{port}/api2/json/nodes"
            nodes_response = manager._create_session().get(nodes_url, timeout=5)
            if nodes_response.status_code == 200:
                for n in nodes_response.json().get("data", []):
                    node = n["node"]
                    break

        if not node:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "No node available"}), 400

        # check volume is in use by any VM or Container
        resources_url = f"https://{host}:{port}/api2/json/cluster/resources?type=vm"
        resources_response = manager._create_session().get(resources_url, timeout=5)

        if resources_response.status_code == 200:
            for vm in resources_response.json().get("data", []):
                vm_node = vm.get("node")
                vmid = vm.get("vmid")
                vm_type = "qemu" if vm.get("type") == "qemu" else "lxc"

                # Get VM/CT config to check disks and mounted ISOs
                config_url = f"https://{host}:{port}/api2/json/nodes/{vm_node}/{vm_type}/{vmid}/config"
                config_response = manager._create_session().get(config_url, timeout=5)
                if config_response.status_code == 200:
                    config = config_response.json().get("data", {})

                    # Check all config entries for volume reference
                    for key, value in config.items():
                        if not isinstance(value, str):
                            continue

                        # Check for disk images
                        if volid in value:
                            resource_name = "VM" if vm_type == "qemu" else "Container"
                            # lgtm[py/reflected-xss]
                            return jsonify({
                                "error": f"Volume is in use by {resource_name} {vmid} ({key})",
                                "in_use": True,
                                "vmid": vmid,
                                "type": vm_type,
                            }), 400

                        # Check for mounted ISOs (ide*, sata*, scsi* with media=cdrom)
                        if volid.endswith(".iso"):
                            # check this ISO is mounted
                            iso_name = volid.split("/")[-1] if "/" in volid else volid
                            if iso_name in value or volid in value:
                                # lgtm[py/reflected-xss]
                                return jsonify({
                                    "error": f"ISO is mounted in VM {vmid} ({key})",
                                    "in_use": True,
                                    "vmid": vmid,
                                    "type": "qemu",
                                }), 400

                    # For containers, also check mount points
                    if vm_type == "lxc":
                        for key, value in config.items():
                            if key.startswith("mp") and isinstance(value, str) and volid in value:
                                # lgtm[py/reflected-xss]
                                return jsonify({
                                    "error": f"Volume is mounted in Container {vmid} ({key})",
                                    "in_use": True,
                                    "vmid": vmid,
                                    "type": "lxc",
                                }), 400

        # Delete the volume
        # URL encode the volid properly
        encoded_volid = volid.replace("/", "%2F")
        delete_url = f"https://{host}:{port}/api2/json/nodes/{node}/storage/{storage_name}/content/{encoded_volid}"
        response = manager._create_session().delete(delete_url, timeout=10)

        if response.status_code == 200:
            user = request.session.get("user", "unknown")
            log_audit(
                user, "storage.content_deleted", f"Deleted {volid} from {storage_name}", cluster=manager.config.name
            )
            # lgtm[py/reflected-xss]
            return jsonify({"success": True, "message": f"Deleted {volid}"})
        else:
            error_msg = response.json().get("errors", response.text) if response.text else "Delete failed"
            # lgtm[py/reflected-xss]
            return (
                jsonify({"error": html.escape(str(error_msg))}),
                response.status_code,
            )

    except Exception as e:
        logging.error(f"Error deleting content: {e}")
        return _api_error("Failed to delete datastore content", status=500)


@bp.route("/api/clusters/<cluster_id>/datastores/<storage_name>/upload", methods=["POST"])
@require_auth(perms=["storage.upload"])
def upload_to_datastore(cluster_id, storage_name):
    """Upload ISO or other content to a datastore"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    tmp_path = None
    try:
        host, port = manager.host, manager.api_port
        node = request.form.get("node") or request.args.get("node")
        content_type = request.form.get("content", "iso")  # iso, vztmpl, etc.

        if not node:
            # Pick an online node, not just the first one
            try:
                nodes_resp = manager._api_get(f"https://{host}:{port}/api2/json/nodes")
                if nodes_resp.status_code == 200:
                    for n in nodes_resp.json().get("data", []):
                        if n.get("status") == "online":
                            node = n["node"]
                            break
                    # fallback: first node if none reported online
                    if not node:
                        ndata = nodes_resp.json().get("data", [])
                        if ndata:
                            node = ndata[0]["node"]
            except Exception as e:
                logging.warning(f"Node lookup for upload failed: {e}")

        if not node:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "No node available"}), 400

        if "file" not in request.files:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "No file provided"}), 400

        file = request.files["file"]
        if not file.filename:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "No file selected"}), 400

        # Allow disk images alongside ISOs
        filename = os.path.basename(file.filename)  # strip directory components
        if not filename or filename.startswith(".") or "/" in filename or "\\" in filename:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "Invalid filename"}), 400
        _allowed_ext = {
            "iso": (".iso",),
            "import": (".vmdk", ".qcow2", ".img", ".raw"),
            "vztmpl": (".tar.gz", ".tar.xz", ".tar.zst"),
        }
        allowed = _allowed_ext.get(content_type)
        if allowed and not filename.lower().endswith(allowed):
            # lgtm[py/reflected-xss]
            # snyk:ignore:Cross-site Scripting (XSS)
            return jsonify({
                "error": f"Invalid file type. Allowed: {', '.join(allowed)}"
            }), 400  # snyk:ignore:Cross-site Scripting (XSS)
        # Reject filenames with null bytes or shell metacharacters
        if any(c in filename for c in "\x00;|&$`"):
            # lgtm[py/reflected-xss]
            return jsonify({"error": "Invalid characters in filename"}), 400

        # Save to temp file first, SpooledTemporaryFile + requests is unreliable
        # across werkzeug versions. Temp file is cleaned up in finally block.
        # #119: use app dir for temp, not /tmp (LXC tmpfs is often too small for ISOs)
        import tempfile

        upload_tmp_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tmp")
        os.makedirs(upload_tmp_dir, mode=0o700, exist_ok=True)
        # don't include user extension in temp filename
        fd, tmp_path = tempfile.mkstemp(dir=upload_tmp_dir)
        try:
            # (pentest DoS) - the /upload route permits a very large body
            # (100 GB cap); refuse up front if the appliance temp dir can't hold it
            # (disk-exhaustion DoS) instead of filling the disk mid-write. 256 MB reserve.
            import shutil as _shutil

            _clen = request.content_length or 0
            if _clen and (_clen + 256 * 1024 * 1024) > _shutil.disk_usage(upload_tmp_dir).free:
                os.close(fd)
                with contextlib.suppress(Exception):
                    os.unlink(tmp_path)
                # lgtm[py/reflected-xss]
                return jsonify({"error": "Insufficient free space on the appliance to buffer this upload"}), 507
            file.save(tmp_path)
        except Exception as _e:
            os.close(fd)
            raise
        else:
            os.close(fd)

        upload_url = f"https://{host}:{port}/api2/json/nodes/{node}/storage/{storage_name}/upload"

        with open(tmp_path, "rb") as fh:
            # 2026-06-04 (#525 ccesario): switched from `files=` (which
            # makes requests run fp.read() to encode the whole multipart
            # body into memory before sending — OOMs the appliance for
            # 2+ GB ISOs with MemoryError out of requests.models._encode_files)
            # to MultipartEncoder, which exposes a file-like body that
            # requests streams chunk-by-chunk over the wire. Memory
            # footprint becomes constant in the file size — a 50 GB ISO
            # uses the same RAM as a 5 MB one.
            from requests_toolbelt.multipart.encoder import MultipartEncoder

            # 2026-06-17 - field ORDER matters here: Proxmox's upload parser needs the
            # `content` param to arrive BEFORE the file part, otherwise it rejects the whole
            # request with "content: property is missing and it is not optional". The #525
            # switch to MultipartEncoder passed a dict with the file field first, which flipped
            # the order vs the old files=/data= path (data fields came first there) and
            # regressed *every* ISO/template upload. Use an ordered list, content first.
            encoder = MultipartEncoder(
                fields=[
                    ("content", content_type),
                    ("filename", (filename, fh, "application/octet-stream")),
                ]
            )
            # Use _api_post for auto-reconnect tracking, 1h timeout for large ISOs
            response = manager._api_post(
                upload_url,
                data=encoder,
                headers={"Content-Type": encoder.content_type},
                timeout=3600,
            )

        if response.status_code == 200:
            result = response.json()
            user = request.session.get("user", "unknown")
            log_audit(user, "storage.upload", f"Uploaded {filename} to {storage_name}", cluster=manager.config.name)
            # lgtm[py/reflected-xss]
            return jsonify({"success": True, "message": f"Upload started: {filename}", "upid": result.get("data")})
        else:
            # Safe error parsing, Proxmox sometimes returns HTML on 5xx
            try:
                pve = response.json()
                errs = pve.get("errors")
                # 2026-06-08 (#524 ccesario): PVE returns field errors as a dict
                # (e.g. {'filename': 'invalid format - ...'} when a name carries chars
                # it won't accept, like parentheses). Flatten it — handing the dict
                # straight through showed up as "[object Object]" in the upload alert.
                if isinstance(errs, dict):
                    error_msg = "; ".join(f"{k}: {v}" for k, v in errs.items()) or pve.get("message") or "Upload failed"
                else:
                    error_msg = errs or pve.get("message") or response.text or "Upload failed"
            except Exception as _e:
                error_msg = response.text[:500] if response.text else "Upload failed"
            logging.error(f"Upload to {storage_name} failed: HTTP {response.status_code} - {error_msg}")
            # lgtm[py/reflected-xss]
            return (
                jsonify({"error": html.escape(str(error_msg))}),
                response.status_code,
            )

    except Exception as e:
        logging.error(f"Error uploading to {storage_name}: {e}")
        return _api_error("Failed to upload to datastore", status=500)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            with contextlib.suppress(Exception):
                os.unlink(tmp_path)


# Download ISO from URL
# Like Proxmox's "Download from URL" feature
# Tracks download progress in memory (for status polling)
_url_downloads = {}  # task_id -> { status, percent, message, ... }


@bp.route("/api/clusters/<cluster_id>/datastores/<storage_name>/download-url", methods=["POST"])
@require_auth(perms=["storage.upload"])
def download_iso_from_url(cluster_id, storage_name):
    """Download ISO/image from URL to storage (like Proxmox)"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        data = request.json or {}
        url = data.get("url", "").strip()
        filename = data.get("filename", "").strip()
        node = data.get("node", "").strip()

        if not url:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "URL is required"}), 400

        # (pentest HIGH) - the previous hand-rolled filter FAILED OPEN on an
        # unresolvable host ("let proxmox handle it") and missed multicast / CGNAT /
        # metadata-by-hostname. Delegate to the central guard, which fails CLOSED
        # (require_resolution) and blocks private/loopback/link-local/metadata. The URL is
        # fetched by the Proxmox node, so this SSRF would fire from the PVE management LAN.
        from ProxmoxVEx.utils.url_security import SsrfError, sanitize_outbound_url

        try:
            url = sanitize_outbound_url(url, allowed_schemes=("https", "http"))
        except SsrfError as _ssrf:
            return _api_error("URL rejected by SSRF guard", status=400)

        # Extract filename from URL if not provided
        if not filename:
            from urllib.parse import unquote, urlparse

            parsed = urlparse(url)
            filename = unquote(parsed.path.split("/")[-1]) or "download.iso"

        # Ensure proper extension
        if not any(filename.lower().endswith(ext) for ext in [".iso", ".img", ".qcow2", ".raw"]):
            filename += ".iso"

        host, port = manager.host, manager.api_port

        # Find node if not specified
        if not node:
            nodes_url = f"https://{host}:{port}/api2/json/nodes"
            nodes_response = manager._create_session().get(nodes_url, timeout=5)
            if nodes_response.status_code == 200:
                for n in nodes_response.json().get("data", []):
                    node = n["node"]
                    break

        if not node:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "No node available"}), 400

        # Try using Proxmox's native download-url API (PVE 7.0+)
        download_url = f"https://{host}:{port}/api2/json/nodes/{node}/storage/{storage_name}/download-url"

        download_data = {"url": url, "filename": filename, "content": "iso"}

        # Check if it's HTTPS and might need checksum verification disabled
        if url.startswith("https://"):
            download_data["verify-certificates"] = 0  # Skip SSL verification for downloads

        response = manager._create_session().post(download_url, data=download_data, timeout=30)

        if response.status_code == 200:
            result = response.json()
            upid = result.get("data")

            # Generate task ID for tracking
            task_id = f"dl_{int(time.time())}_{os.urandom(4).hex()}"

            _url_downloads[task_id] = {
                "status": "downloading",
                "percent": 0,
                "message": f"Downloading {filename}...",
                "upid": upid,
                "cluster_id": cluster_id,
                "node": node,
                "filename": filename,
                "started": time.time(),
            }

            # Start background thread to poll Proxmox task status
            def poll_download_status():
                try:
                    while task_id in _url_downloads:
                        task_info = _url_downloads[task_id]
                        if task_info["status"] in ["completed", "error"]:
                            break

                        # Poll Proxmox task status
                        status_url = f"https://{host}:{port}/api2/json/nodes/{node}/tasks/{upid}/status"
                        try:
                            status_resp = manager._create_session().get(status_url, timeout=10)
                            if status_resp.status_code == 200:
                                status_data = status_resp.json().get("data", {})

                                if status_data.get("status") == "stopped":
                                    if status_data.get("exitstatus") == "OK":
                                        _url_downloads[task_id] = {
                                            "status": "completed",
                                            "percent": 100,
                                            "message": f"Download complete: {filename}",
                                        }
                                    else:
                                        _url_downloads[task_id] = {
                                            "status": "error",
                                            "percent": 0,
                                            "message": status_data.get("exitstatus", "Download failed"),
                                        }
                                    break
                                else:
                                    # Still running - try to get progress from task log
                                    log_url = f"https://{host}:{port}/api2/json/nodes/{node}/tasks/{upid}/log"
                                    log_resp = manager._create_session().get(log_url, timeout=10)
                                    if log_resp.status_code == 200:
                                        log_data = log_resp.json().get("data", [])
                                        for entry in reversed(log_data):
                                            text = entry.get("t", "")
                                            # Look for progress percentage in log
                                            import re

                                            match = re.search(r"(\d+(?:\.\d+)?)\s*%", text)
                                            if match:
                                                _url_downloads[task_id]["percent"] = float(match.group(1))
                                                _url_downloads[task_id]["message"] = f"Downloading... {match.group(1)}%"
                                                break
                        except Exception as e:
                            logging.debug(f"Error polling download status: {e}")

                        time.sleep(2)

                    # Cleanup old entries after 5 minutes
                    time.sleep(300)
                    if task_id in _url_downloads:
                        del _url_downloads[task_id]

                except Exception as e:
                    logging.error(f"Error in download status poll: {e}")
                    if task_id in _url_downloads:
                        _url_downloads[task_id] = {"status": "error", "percent": 0, "message": str(e)}

            import threading

            threading.Thread(target=poll_download_status, daemon=True).start()

            user = request.session.get("user", "unknown")
            log_audit(
                user,
                "storage.download",
                f"Started download: {filename} from {url[:50]}...",
                cluster=manager.config.name,
            )

            # lgtm[py/reflected-xss]
            return jsonify({"success": True, "task_id": task_id, "message": f"Download started: {filename}"})
        else:
            # Proxmox API error
            try:
                error_data = response.json()
                error_msg = error_data.get("errors", {})
                if isinstance(error_msg, dict):
                    error_msg = ", ".join(f"{k}: {v}" for k, v in error_msg.items())
                elif not error_msg:
                    error_msg = response.text or "Download failed"
            except Exception as _e:
                error_msg = response.text or "Download failed"

            error_detail = html.escape(str(error_msg))
            return (
                jsonify({"error": f"Proxmox API error: {error_detail}"}),
                response.status_code,
            )

    except Exception as e:
        logging.error(f"Error starting download: {e}")
        return _api_error("Failed to start URL download", status=500)


@bp.route("/api/clusters/<cluster_id>/datastores/<storage_name>/download-status/<task_id>", methods=["GET"])
@require_auth(perms=["storage.upload"])
def get_download_status(cluster_id, storage_name, task_id):
    """Get status of URL download task"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if task_id not in _url_downloads:
        # lgtm[py/reflected-xss]
        return jsonify({"status": "unknown", "message": "Task not found"}), 404

    # lgtm[py/reflected-xss]
    return jsonify(_url_downloads[task_id])


# ============================================

# VM Backup Management
# Get backups for a specific VM, restore, delete
# ============================================


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/backups", methods=["GET"])
@require_auth(perms=["backup.view"])
def get_vm_backups(cluster_id, node, vm_type, vmid):
    """Get all backups for a specific VM

    Scans all backup-capable storages for vzdump files matching the vmid
    """
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        # snyk:ignore:python/XSS - constant 403 response; taint from check_cluster_access does not reach the error message
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Access denied to this cluster"}), 403
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        session = manager._create_session()

        backups = []

        # get all storages that can hold backups
        # This is kinda slow if you have lots of storages but whatever
        storage_url = f"https://{host}:{port}/api2/json/nodes/{node}/storage"
        stor_resp = session.get(storage_url, timeout=5)

        if stor_resp.status_code != 200:
            # lgtm[py/reflected-xss]
            return jsonify([])

        storages = stor_resp.json().get("data", [])

        for storage in storages:
            # Only check storages that can hold backups
            content = storage.get("content", "")
            if "backup" not in content:
                continue

            stor_name = storage.get("storage")
            content_url = f"https://{host}:{port}/api2/json/nodes/{node}/storage/{stor_name}/content"
            try:
                # #143: pass vmid filter — critical for PBS storages which can have
                # thousands of backups. Without it PVE returns ALL backups and we hang
                content_resp = session.get(content_url, params={"content": "backup", "vmid": vmid}, timeout=(5, 30))
            except Exception as _e:
                continue

            if content_resp.status_code != 200:
                continue

            items = content_resp.json().get("data", [])

            for item in items:
                # vzdump naming: vzdump-{type}-{vmid}-{date}_{time}.{ext}
                # Proxmox naming conventions are weird but ok
                volid = item.get("volid", "")
                filename = volid.split("/")[-1] if "/" in volid else volid.split(":")[-1]

                # double-check vmid match (PVE filter isn't always exact)
                # #143: PBS volids use path format backup/vm/{vmid}/ instead of vzdump filename
                if (
                    f"-{vmid}-" in filename
                    or filename.startswith(f"vzdump-{vm_type[:4]}-{vmid}")
                    or f"/vm/{vmid}/" in volid
                    or f"/ct/{vmid}/" in volid
                ):
                    backups.append({
                        "volid": volid,
                        "storage": stor_name,
                        "filename": filename,
                        "size": item.get("size", 0),
                        "ctime": item.get("ctime", 0),  # creation time
                        "format": item.get("format", "unknown"),
                        "notes": item.get("notes", ""),
                    })

        # sort by creation time, newest first
        backups.sort(key=lambda x: x.get("ctime", 0), reverse=True)

        # lgtm[py/reflected-xss]
        return jsonify(backups)

    except Exception as e:
        logging.error(f"[BACKUP] Error getting VM backups: {e}")
        return _api_error("Failed to get VM backups", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/backups/create", methods=["POST"])
@require_auth(perms=["backup.create"])
def create_vm_backup(cluster_id, node, vm_type, vmid):
    """Create a backup of a VM

    Uses vzdump to create a backup
    """
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    # Check pool permission for vm.backup
    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    if not user_can_access_vm(user, cluster_id, vmid, "vm.backup", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.backup"}), 403

    data = request.json or {}
    storage = data.get("storage", "local")
    mode = data.get("mode", "snapshot")  # stop, suspend, snapshot
    compress = data.get("compress", "zstd")
    notes = data.get("notes", "")

    try:
        host, port = manager.host, manager.api_port
        session = manager._create_session()

        # vzdump endpoint
        url = f"https://{host}:{port}/api2/json/nodes/{node}/vzdump"

        backup_params = {"vmid": vmid, "storage": storage, "mode": mode, "compress": compress}

        if notes:
            backup_params["notes-template"] = notes

        response = session.post(url, data=backup_params, timeout=30)

        if response.status_code == 200:
            task = response.json().get("data", "")
            user = getattr(request, "session", {}).get("user", "system")
            log_audit(user, "backup.created", f"Started backup for {vm_type}/{vmid}", cluster=manager.config.name)
            # lgtm[py/reflected-xss]
            return jsonify({"success": True, "task": task})

        # lgtm[py/reflected-xss]
        return _pve_error(response)

    except Exception as e:
        logging.error(f"[BACKUP] Error creating backup: {e}")
        return _api_error("Failed to create backup", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/backups/restore", methods=["POST"])
@require_auth(perms=["backup.restore"])
def restore_vm_backup(cluster_id, node, vm_type, vmid):
    """Restore a VM from backup

    Can restore to same VMID (overwrite) or new VMID
    """
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    # Check pool permission for vm.backup
    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    if not user_can_access_vm(user, cluster_id, vmid, "vm.backup", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.backup"}), 403

    data = request.json or {}
    volid = data.get("volid")
    target_vmid = data.get("target_vmid", vmid)  # default: restore to same vmid
    target_storage = data.get("storage", "")
    start_after = data.get("start", False)

    if not volid:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Backup volume ID required"}), 400

    try:
        host, port = manager.host, manager.api_port
        session = manager._create_session()

        # restore endpoint depends on vm type
        # Why does Proxmox have different endpoints for this?? annoying
        if vm_type == "qemu":
            url = f"https://{host}:{port}/api2/json/nodes/{node}/qemu"
        else:
            url = f"https://{host}:{port}/api2/json/nodes/{node}/lxc"

        restore_params = {
            "vmid": target_vmid,
            "archive": volid,
            "force": 1 if target_vmid == vmid else 0,  # force overwrite if same vmid
        }

        if target_storage:
            restore_params["storage"] = target_storage

        if start_after:
            restore_params["start"] = 1

        target_name = data.get("name") or data.get("hostname")
        if target_name:
            if vm_type == "qemu":
                restore_params["name"] = target_name
            else:
                restore_params["hostname"] = target_name

        logging.debug(f"restore params: {restore_params}")

        response = session.post(url, data=restore_params, timeout=30)

        if response.status_code == 200:
            task = response.json().get("data", "")
            user = getattr(request, "session", {}).get("user", "system")
            log_audit(user, "backup.restored", f"Restored {volid} to VMID {target_vmid}", cluster=manager.config.name)
            # lgtm[py/reflected-xss]
            return jsonify({"success": True, "task": task, "vmid": target_vmid})

        # Proxmox sometimes returns weird error messages, should probably parse them better
        # lgtm[py/reflected-xss]
        return _pve_error(response)

    except Exception as e:
        logging.error(f"[BACKUP] Error restoring backup: {e}")
        return _api_error("Failed to restore backup", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/backups/<path:volid>", methods=["DELETE"])
@require_auth(perms=["backup.delete"])
def delete_vm_backup(cluster_id, node, vm_type, vmid, volid):
    """Delete a specific backup

    Deletes from the storage where the backup is located
    """
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    # Check VM-level backup permission
    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    if not user_can_access_vm(user, cluster_id, vmid, "vm.backup", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.backup"}), 403
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        session = manager._create_session()

        # volid format is usually: storage:backup/vzdump-xxx.vma.zst
        # we need to extract storage name
        if ":" in volid:
            storage = volid.split(":")[0]
        else:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "Invalid volume ID format"}), 400

        # URL encode the volid for the path
        encoded_volid = url_quote(volid, safe="")

        url = f"https://{host}:{port}/api2/json/nodes/{node}/storage/{storage}/content/{encoded_volid}"

        response = session.delete(url, timeout=30)

        if response.status_code == 200:
            user = getattr(request, "session", {}).get("user", "system")
            log_audit(user, "backup.deleted", f"Deleted backup {volid}", cluster=manager.config.name)
            # lgtm[py/reflected-xss]
            return jsonify({"success": True})

        # lgtm[py/reflected-xss]
        return _pve_error(response)

    except Exception as e:
        logging.error(f"[BACKUP] Error deleting backup: {e}")
        return _api_error("Failed to delete backup", status=500)


@bp.route("/api/clusters/<cluster_id>/datacenter/replication", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_replication_jobs(cluster_id):
    """Get all replication jobs (datacenter-level view)"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    # (#333) - go through manager.get_replication_jobs() which merges
    # per-node runtime data (last_sync/last_try/state/error/fail_count) onto the
    # cluster-level job definitions. The plain /cluster/replication endpoint
    # only returns config so the datacenter view used to show "Last sync = Never"
    # for jobs that were running fine.
    try:
        # lgtm[py/reflected-xss]
        return jsonify(manager.get_replication_jobs())
    except Exception:
        return _api_error("Failed to get replication jobs", status=500)


# HA Manager Status API
@bp.route("/api/clusters/<cluster_id>/datacenter/ha/status", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_ha_manager_status(cluster_id):
    """Get Proxmox HA manager status (quorum, master, lrm nodes)"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port

        # Get manager status (quorum, master, lrm for each node)
        url = f"https://{host}:{port}/api2/json/cluster/ha/status/manager_status"
        resp = manager._create_session().get(url, timeout=30)

        if resp.status_code == 200:
            data = resp.json().get("data", {})
            # lgtm[py/reflected-xss]
            return jsonify(data)
        else:
            # Fallback to current status
            url2 = f"https://{host}:{port}/api2/json/cluster/ha/status/current"
            resp2 = manager._create_session().get(url2, timeout=30)
            if resp2.status_code == 200:
                # lgtm[py/reflected-xss]
                return jsonify(resp2.json().get("data", []))
            # lgtm[py/reflected-xss]
            return jsonify([])
    except Exception as e:
        logging.error(f"Error getting HA manager status: {e}")
        # lgtm[py/reflected-xss]
        return jsonify([])


# Firewall API
@bp.route("/api/clusters/<cluster_id>/datacenter/firewall/options", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_firewall_options(cluster_id):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/cluster/firewall/options"
        r = manager._create_session().get(url, timeout=5)

        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(r.json().get("data", {}))
        # lgtm[py/reflected-xss]
        return jsonify({})
    except Exception as _e:
        # lgtm[py/reflected-xss]
        return jsonify({})


@bp.route("/api/clusters/<cluster_id>/datacenter/firewall/options", methods=["PUT"])
@require_auth(perms=["cluster.config"])
def set_firewall_options(cluster_id):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/cluster/firewall/options"
        data = request.json or {}

        r = manager._create_session().put(url, data=data, timeout=10)

        if r.status_code == 200:
            usr = getattr(request, "session", {}).get("user", "system")
            log_audit(usr, "firewall.options_changed", "Firewall options updated", cluster=manager.config.name)
            # lgtm[py/reflected-xss]
            return jsonify({"success": True, "message": "Firewall options updated"})
        # lgtm[py/reflected-xss]
        return _pve_error(r)
    except Exception:
        return _api_error("Failed to set firewall options", status=500)


@bp.route("/api/clusters/<cluster_id>/datacenter/firewall/rules", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_firewall_rules(cluster_id):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/cluster/firewall/rules"
        r = manager._create_session().get(url, timeout=5)

        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(r.json().get("data", []))
        # lgtm[py/reflected-xss]
        return jsonify([])
    except Exception as _e:
        # lgtm[py/reflected-xss]
        return jsonify([])


@bp.route("/api/clusters/<cluster_id>/datacenter/firewall/rules", methods=["POST"])
@require_auth(perms=["cluster.config"])
def create_firewall_rule(cluster_id):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/cluster/firewall/rules"
        data = request.json or {}

        r = manager._create_session().post(url, data=data, timeout=10)

        if r.status_code == 200:
            usr = getattr(request, "session", {}).get("user", "system")
            log_audit(usr, "firewall.rule_created", "Firewall rule created", cluster=manager.config.name)
            # lgtm[py/reflected-xss]
            return jsonify({"success": True, "message": "Firewall rule created"})
        # lgtm[py/reflected-xss]
        return _pve_error(r)
    except Exception:
        return _api_error("Failed to create firewall rule", status=500)


@bp.route("/api/clusters/<cluster_id>/datacenter/firewall/rules/<int:pos>", methods=["PUT"])
@require_auth(perms=["cluster.config"])
def update_firewall_rule(cluster_id, pos):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/cluster/firewall/rules/{pos}"
        data = request.json or {}

        r = manager._create_session().put(url, data=data, timeout=10)

        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify({"success": True, "message": "Firewall rule updated"})
        # lgtm[py/reflected-xss]
        return _pve_error(r)
    except Exception:
        return _api_error("Failed to update firewall rule", status=500)


@bp.route("/api/clusters/<cluster_id>/datacenter/firewall/rules/<int:pos>", methods=["DELETE"])
@require_auth(perms=["cluster.config"])
def delete_firewall_rule(cluster_id, pos):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/cluster/firewall/rules/{pos}"

        response = manager._create_session().delete(url, timeout=10)

        if response.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify({"success": True, "message": "Firewall rule deleted"})
        # lgtm[py/reflected-xss]
        return _pve_error(response)
    except Exception:
        return _api_error("Failed to delete firewall rule", status=500)


@bp.route("/api/clusters/<cluster_id>/datacenter/firewall/groups", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_firewall_groups(cluster_id):
    """Get firewall security groups"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/cluster/firewall/groups"
        response = manager._create_session().get(url, timeout=5)

        if response.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(response.json().get("data", []))
        # lgtm[py/reflected-xss]
        return jsonify([])
    except Exception:
        return _api_error("Failed to get firewall groups", status=500)


@bp.route("/api/clusters/<cluster_id>/datacenter/firewall/aliases", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_firewall_aliases(cluster_id):
    """Get firewall aliases"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/cluster/firewall/aliases"
        response = manager._create_session().get(url, timeout=5)

        if response.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(response.json().get("data", []))
        # lgtm[py/reflected-xss]
        return jsonify([])
    except Exception:
        return _api_error("Failed to get firewall aliases", status=500)


@bp.route("/api/clusters/<cluster_id>/datacenter/firewall/ipset", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_firewall_ipsets(cluster_id):
    """Get firewall IP sets"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/cluster/firewall/ipset"
        response = manager._create_session().get(url, timeout=5)

        if response.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(response.json().get("data", []))
        # lgtm[py/reflected-xss]
        return jsonify([])
    except Exception:
        return _api_error("Failed to get firewall IP sets", status=500)


# ============================================
# Per-VM/CT Firewall API
# ============================================


def _vm_fw_url(manager, node, vmtype, vmid, sub=""):
    host, port = manager.host, manager.api_port
    # lgtm[py/reflected-xss]
    return f"https://{host}:{port}/api2/json/nodes/{node}/{vmtype}/{vmid}/firewall{sub}"


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/options", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_vm_firewall_options(cluster_id, node, vmtype, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        r = manager._create_session().get(_vm_fw_url(manager, node, vmtype, vmid, "/options"), timeout=5)
        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(r.json().get("data", {}))
        # lgtm[py/reflected-xss]
        return jsonify({})
    except Exception as _e:
        # lgtm[py/reflected-xss]
        return jsonify({})


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/options", methods=["PUT"])
@require_auth(perms=["vm.config"])
def set_vm_firewall_options(cluster_id, node, vmtype, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        data = request.json or {}
        r = manager._create_session().put(_vm_fw_url(manager, node, vmtype, vmid, "/options"), data=data, timeout=10)
        if r.status_code == 200:
            usr = getattr(request, "session", {}).get("user", "system")
            log_audit(usr, "vm.firewall.options", f"VM {vmid} firewall options updated", cluster=manager.config.name)
            # lgtm[py/reflected-xss]
            return jsonify({"success": True})
        # lgtm[py/reflected-xss]
        return _pve_error(r)
    except Exception:
        return _api_error("Failed to set VM firewall options", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/rules", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_vm_firewall_rules(cluster_id, node, vmtype, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        url = _vm_fw_url(manager, node, vmtype, vmid, "/rules")
        r = manager._create_session().get(url, timeout=5)
        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(r.json().get("data", []))
        logging.warning(f"VM FW rules GET failed: {r.status_code} {r.text[:200]}")
        # lgtm[py/reflected-xss]
        return jsonify([])
    except Exception as e:
        logging.warning(f"VM FW rules GET exception: {e}")
        # lgtm[py/reflected-xss]
        return jsonify([])


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/rules", methods=["POST"])
@require_auth(perms=["vm.config"])
def create_vm_firewall_rule(cluster_id, node, vmtype, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        data = request.json or {}
        url = _vm_fw_url(manager, node, vmtype, vmid, "/rules")
        r = manager._create_session().post(url, data=data, timeout=10)
        if r.status_code == 200:
            usr = getattr(request, "session", {}).get("user", "system")
            log_audit(usr, "vm.firewall.rule_created", f"VM {vmid} firewall rule created", cluster=manager.config.name)
            # lgtm[py/reflected-xss]
            return jsonify({"success": True})
        # Extract Proxmox error message
        try:
            pve_err = r.json().get("errors", r.json().get("data", r.text))
        except Exception as _e:
            pve_err = r.text
        logging.warning(f"VM FW rule create failed: {r.status_code} data={data} pve_response={r.text[:300]}")
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": pve_err,
            "status": r.status_code,
        }), r.status_code  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure
    except Exception:
        return _api_error("Failed to create VM firewall rule", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/rules/<int:pos>", methods=["PUT"])
@require_auth(perms=["vm.config"])
def update_vm_firewall_rule(cluster_id, node, vmtype, vmid, pos):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        data = request.json or {}
        r = manager._create_session().put(
            _vm_fw_url(manager, node, vmtype, vmid, f"/rules/{pos}"), data=data, timeout=10
        )
        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify({"success": True})
        # lgtm[py/reflected-xss]
        return _pve_error(r)
    except Exception:
        return _api_error("Failed to update VM firewall rule", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/rules/<int:pos>", methods=["DELETE"])
@require_auth(perms=["vm.config"])
def delete_vm_firewall_rule(cluster_id, node, vmtype, vmid, pos):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        r = manager._create_session().delete(_vm_fw_url(manager, node, vmtype, vmid, f"/rules/{pos}"), timeout=10)
        if r.status_code == 200:
            usr = getattr(request, "session", {}).get("user", "system")
            log_audit(
                usr, "vm.firewall.rule_deleted", f"VM {vmid} firewall rule {pos} deleted", cluster=manager.config.name
            )
            # lgtm[py/reflected-xss]
            return jsonify({"success": True})
        # lgtm[py/reflected-xss]
        return _pve_error(r)
    except Exception:
        return _api_error("Failed to delete VM firewall rule", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/aliases", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_vm_firewall_aliases(cluster_id, node, vmtype, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        r = manager._create_session().get(_vm_fw_url(manager, node, vmtype, vmid, "/aliases"), timeout=5)
        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(r.json().get("data", []))
        # lgtm[py/reflected-xss]
        return jsonify([])
    except Exception as _e:
        # lgtm[py/reflected-xss]
        return jsonify([])


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/aliases", methods=["POST"])
@require_auth(perms=["vm.config"])
def create_vm_firewall_alias(cluster_id, node, vmtype, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        data = request.json or {}
        r = manager._create_session().post(_vm_fw_url(manager, node, vmtype, vmid, "/aliases"), data=data, timeout=10)
        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify({"success": True})
        # lgtm[py/reflected-xss]
        return _pve_error(r)
    except Exception:
        return _api_error("Failed to create VM firewall alias", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/aliases/<name>", methods=["PUT"])
@require_auth(perms=["vm.config"])
def update_vm_firewall_alias(cluster_id, node, vmtype, vmid, name):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        data = request.json or {}
        r = manager._create_session().put(
            _vm_fw_url(manager, node, vmtype, vmid, f"/aliases/{name}"), data=data, timeout=10
        )
        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify({"success": True})
        # lgtm[py/reflected-xss]
        return _pve_error(r)
    except Exception:
        return _api_error("Failed to update VM firewall alias", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/aliases/<name>", methods=["DELETE"])
@require_auth(perms=["vm.config"])
def delete_vm_firewall_alias(cluster_id, node, vmtype, vmid, name):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        r = manager._create_session().delete(_vm_fw_url(manager, node, vmtype, vmid, f"/aliases/{name}"), timeout=10)
        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify({"success": True})
        # lgtm[py/reflected-xss]
        return _pve_error(r)
    except Exception:
        return _api_error("Failed to delete VM firewall alias", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/ipset", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_vm_firewall_ipsets(cluster_id, node, vmtype, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        r = manager._create_session().get(_vm_fw_url(manager, node, vmtype, vmid, "/ipset"), timeout=5)
        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(r.json().get("data", []))
        # lgtm[py/reflected-xss]
        return jsonify([])
    except Exception as _e:
        # lgtm[py/reflected-xss]
        return jsonify([])


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/ipset", methods=["POST"])
@require_auth(perms=["vm.config"])
def create_vm_firewall_ipset(cluster_id, node, vmtype, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        data = request.json or {}
        r = manager._create_session().post(_vm_fw_url(manager, node, vmtype, vmid, "/ipset"), data=data, timeout=10)
        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify({"success": True})
        # lgtm[py/reflected-xss]
        return _pve_error(r)
    except Exception:
        return _api_error("Failed to create VM firewall IP set", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/ipset/<name>", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_vm_firewall_ipset_content(cluster_id, node, vmtype, vmid, name):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        r = manager._create_session().get(_vm_fw_url(manager, node, vmtype, vmid, f"/ipset/{name}"), timeout=5)
        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(r.json().get("data", []))
        # lgtm[py/reflected-xss]
        return jsonify([])
    except Exception as _e:
        # lgtm[py/reflected-xss]
        return jsonify([])


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/ipset/<name>", methods=["POST"])
@require_auth(perms=["vm.config"])
def add_vm_firewall_ipset_entry(cluster_id, node, vmtype, vmid, name):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        data = request.json or {}
        r = manager._create_session().post(
            _vm_fw_url(manager, node, vmtype, vmid, f"/ipset/{name}"), data=data, timeout=10
        )
        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify({"success": True})
        # lgtm[py/reflected-xss]
        return _pve_error(r)
    except Exception:
        return _api_error("Failed to add IP set entry", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/ipset/<name>/<path:cidr>", methods=["DELETE"])
@require_auth(perms=["vm.config"])
def delete_vm_firewall_ipset_entry(cluster_id, node, vmtype, vmid, name, cidr):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        r = manager._create_session().delete(
            _vm_fw_url(manager, node, vmtype, vmid, f"/ipset/{name}/{cidr}"), timeout=10
        )
        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify({"success": True})
        # lgtm[py/reflected-xss]
        return _pve_error(r)
    except Exception:
        return _api_error("Failed to delete IP set entry", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/ipset/<name>", methods=["DELETE"])
@require_auth(perms=["vm.config"])
def delete_vm_firewall_ipset(cluster_id, node, vmtype, vmid, name):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        r = manager._create_session().delete(_vm_fw_url(manager, node, vmtype, vmid, f"/ipset/{name}"), timeout=10)
        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify({"success": True})
        # lgtm[py/reflected-xss]
        return _pve_error(r)
    except Exception:
        return _api_error("Failed to delete VM firewall IP set", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/refs", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_vm_firewall_refs(cluster_id, node, vmtype, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        r = manager._create_session().get(_vm_fw_url(manager, node, vmtype, vmid, "/refs"), timeout=5)
        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(r.json().get("data", []))
        # lgtm[py/reflected-xss]
        return jsonify([])
    except Exception as _e:
        # lgtm[py/reflected-xss]
        return jsonify([])


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vmtype>/<vmid>/firewall/log", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_vm_firewall_log(cluster_id, node, vmtype, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vmtype)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        params = {}
        if request.args.get("limit"):
            params["limit"] = request.args["limit"]
        if request.args.get("start"):
            params["start"] = request.args["start"]
        r = manager._create_session().get(_vm_fw_url(manager, node, vmtype, vmid, "/log"), params=params, timeout=10)
        if r.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(r.json().get("data", []))
        # lgtm[py/reflected-xss]
        return jsonify([])
    except Exception as _e:
        # lgtm[py/reflected-xss]
        return jsonify([])


# Resource Mappings API
@bp.route("/api/clusters/<cluster_id>/datacenter/mapping/pci", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_pci_mappings(cluster_id):
    """Get PCI device mappings"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/cluster/mapping/pci"
        response = manager._create_session().get(url, timeout=5)

        if response.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(response.json().get("data", []))
        # lgtm[py/reflected-xss]
        return jsonify([])
    except Exception:
        return _api_error("Failed to get PCI mappings", status=500)


@bp.route("/api/clusters/<cluster_id>/datacenter/mapping/usb", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_usb_mappings(cluster_id):
    """Get USB device mappings"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/cluster/mapping/usb"
        response = manager._create_session().get(url, timeout=5)

        if response.status_code == 200:
            # lgtm[py/reflected-xss]
            return jsonify(response.json().get("data", []))
        # lgtm[py/reflected-xss]
        return jsonify([])
    except Exception:
        return _api_error("Failed to get USB mappings", status=500)


# Maintenance Mode API Routes
@bp.route("/api/clusters/<cluster_id>/nodes/<node_name>/maintenance-preview", methods=["GET"])
@require_auth(perms=["node.maintenance"])
def maintenance_capacity_preview_api(cluster_id, node_name):
    # #611 — read-only pre-flight: does evacuating this node overcommit the
    # remaining nodes' RAM past `threshold`? Non-blocking hint for the UI.
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404
    mgr = cluster_managers[cluster_id]
    try:
        threshold = float(request.args.get("threshold", 90))
    except (TypeError, ValueError):
        threshold = 90.0
    threshold = max(1.0, min(100.0, threshold))
    try:
        # lgtm[py/reflected-xss]
        return jsonify(mgr.maintenance_capacity_preview(node_name, threshold=threshold))
    except Exception:
        return _api_error("Failed to compute maintenance preview", status=500)


@bp.route("/api/clusters/<cluster_id>/nodes/<node_name>/maintenance", methods=["PUT"])
@require_auth(perms=["node.maintenance"])
def set_maintenance_mode(cluster_id, node_name):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    data = request.json or {}
    enable = data.get("enable", True)
    skip_evacuation = data.get("skip_evacuation", False)  # For non-reboot updates
    usr = getattr(request, "session", {}).get("user", "system")

    if enable:
        task = mgr.enter_maintenance_mode(node_name, skip_evacuation=skip_evacuation)

        if skip_evacuation:
            log_audit(
                usr,
                "node.maintenance_entered",
                f"Node {node_name} entered maintenance mode (skip_evacuation=True)",
                cluster=mgr.config.name,
            )
            broadcast_action(
                "maintenance_enter",
                "node",
                node_name,
                {"status": "completed", "skip_evacuation": True},
                cluster_id,
                usr,
            )
        else:
            log_audit(
                usr, "node.maintenance_entered", f"Node {node_name} entered maintenance mode", cluster=mgr.config.name
            )
            broadcast_action("maintenance_enter", "node", node_name, {"status": "evacuating"}, cluster_id, usr)

        # lgtm[py/reflected-xss]
        return jsonify({
            "message": f"Entering maintenance mode for {node_name}",
            "skip_evacuation": skip_evacuation,
            "warning": "VMs not evacuated - they may be affected if update fails!" if skip_evacuation else None,
            "task": task.to_dict(),
        })
    else:
        success = mgr.exit_maintenance_mode(node_name)
        if success:
            log_audit(
                usr, "node.maintenance_exited", f"Node {node_name} exited maintenance mode", cluster=mgr.config.name
            )
            broadcast_action("maintenance_exit", "node", node_name, {}, cluster_id, usr)
            # lgtm[py/reflected-xss]
            return jsonify({"message": f"Exited maintenance mode for {node_name}"})
        else:
            # lgtm[py/reflected-xss]
            # snyk:ignore:Cross-site Scripting (XSS)
            return jsonify({
                "error": f"Node {node_name} is not in maintenance mode"
            }), 400  # snyk:ignore:Cross-site Scripting (XSS)


@bp.route("/api/clusters/<cluster_id>/nodes/<node_name>/maintenance", methods=["GET"])
@require_auth(perms=["node.view"])
def get_maintenance_status(cluster_id, node_name):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    # Force-refresh from PVE so we don't return stale data
    mgr.refresh_maintenance_status()
    status = mgr.get_maintenance_status(node_name)

    # lgtm[py/reflected-xss]
    return jsonify(status if status else {"maintenance_mode": False})


@bp.route("/api/clusters/<cluster_id>/nodes/<node_name>/maintenance", methods=["DELETE"])
@require_auth(perms=["node.maintenance"])
def exit_maintenance_mode_api(cluster_id, node_name):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    success = mgr.exit_maintenance_mode(node_name)
    usr = getattr(request, "session", {}).get("user", "system")

    if success:
        log_audit(usr, "node.maintenance_exited", f"Node {node_name} exited maintenance mode", cluster=mgr.config.name)
        broadcast_action("maintenance_exit", "node", node_name, {}, cluster_id, usr)
        # lgtm[py/reflected-xss]
        return jsonify({"message": f"Exited maintenance mode for {node_name}"})
    else:
        # lgtm[py/reflected-xss]
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({
            "error": f"Node {node_name} is not in maintenance mode"
        }), 400  # snyk:ignore:Cross-site Scripting (XSS)


@bp.route("/api/clusters/<cluster_id>/nodes/<node_name>/maintenance/acknowledge", methods=["POST"])
@require_auth(perms=["node.maintenance"])
def acknowledge_maintenance_warning(cluster_id, node_name):
    """Acknowledge maintenance warning (e.g., when some VMs couldn't migrate)"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]

    # Store acknowledgment in maintenance task
    if node_name in manager.nodes_in_maintenance:
        manager.nodes_in_maintenance[node_name].acknowledged = True

        user = getattr(request, "session", {}).get("user", "system")
        log_audit(
            user,
            "node.maintenance_acknowledged",
            f"User acknowledged maintenance warning for {node_name}",
            cluster=manager.config.name,
        )

        # Broadcast update
        broadcast_action("maintenance_acknowledged", "node", node_name, {}, cluster_id, user)

        # lgtm[py/reflected-xss]
        return jsonify({"message": f"Maintenance warning acknowledged for {node_name}"})
    else:
        # lgtm[py/reflected-xss]
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({
            "error": f"Node {node_name} is not in maintenance mode"
        }), 400  # snyk:ignore:Cross-site Scripting (XSS)


# =============================================================================
# NODE CLUSTER MANAGEMENT API - Join/Remove nodes from cluster
# Added by Node Management Integration
# =============================================================================


@bp.route("/api/clusters/<cluster_id>/nodes/join/test", methods=["POST"])
@require_auth(perms=["cluster.admin"])
def test_node_connection(cluster_id):
    """Test SSH connection to a new node and gather system info"""
    # Pre-flight check before join, also detects orphaned cluster configs
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    paramiko = get_paramiko()
    if not paramiko:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "SSH not available. Install paramiko: pip install paramiko"}), 500

    data = request.get_json() or {}
    node_ip = _validate_host(data.get("node_ip", ""))
    username = data.get("username", "root")
    password = data.get("password", "")
    ssh_port = sanitize_int(data.get("ssh_port", 22), default=22, min_val=1, max_val=65535)

    if not node_ip:
        # lgtm[py/reflected-xss]
        return jsonify({
            "success": False,
            "error": "Node IP is required (must be a valid hostname or IP address)",
        }), 400  # snyk:ignore:Cross-site Scripting (XSS)
    if not password:
        # lgtm[py/reflected-xss]
        return jsonify({
            "success": False,
            "error": "SSH password is required",
        }), 400  # snyk:ignore:Cross-site Scripting (XSS)

    try:
        # Connect via SSH
        ssh = paramiko.SSHClient()
        apply_ssh_host_key_policy(ssh)
        ssh.connect(node_ip, port=ssh_port, username=username, password=password, timeout=15)

        # Get hostname
        stdin, stdout, stderr = ssh.exec_command("hostname")
        hostname = stdout.read().decode().strip()

        # Check if Proxmox is installed
        stdin, stdout, stderr = ssh.exec_command('pveversion 2>/dev/null || echo "NOT_INSTALLED"')
        pve_output = stdout.read().decode().strip()
        proxmox_installed = "NOT_INSTALLED" not in pve_output
        proxmox_version = pve_output if proxmox_installed else None

        # Check if already in a cluster
        stdin, stdout, stderr = ssh.exec_command('pvecm status 2>/dev/null || echo "NO_CLUSTER"')
        cluster_output = stdout.read().decode().strip()
        already_in_cluster = "NO_CLUSTER" not in cluster_output and "Cluster information" in cluster_output

        current_cluster = None
        if already_in_cluster:
            # Extract cluster name
            for line in cluster_output.split("\n"):
                if "Cluster Name:" in line:
                    current_cluster = line.split(":")[1].strip()
                    break

        # Check for orphaned cluster config files
        # /etc/PVE/ is a FUSE mount (pmxcfs), test -f doesn't always work there
        # so we also use ls and check for leftover node directories
        stdin, stdout, stderr = ssh.exec_command(
            "test -f /etc/corosync/authkey && echo HAS_AUTHKEY; "
            "test -f /etc/corosync/corosync.conf && echo HAS_COROSYNC; "
            "ls /etc/pve/corosync.conf 2>/dev/null && echo HAS_PVE_COROSYNC; "
            "ls /etc/pve/nodes/ 2>/dev/null | wc -_l"
        )
        orphan_output = stdout.read().decode().strip()
        has_old_config = (
            "HAS_AUTHKEY" in orphan_output or "HAS_COROSYNC" in orphan_output or "HAS_PVE_COROSYNC" in orphan_output
        )

        # Check if /etc/pve/nodes/ has dirs for other nodes (leftover from old cluster)
        try:
            lines = orphan_output.strip().split("\n")
            node_dir_count = int(lines[-1]) if lines[-1].isdigit() else 0
            if node_dir_count > 1:
                has_old_config = True
        except Exception as _e:
            pass

        ssh.close()

        # lgtm[py/reflected-xss]
        return jsonify({
            "success": True,
            "info": {
                "hostname": hostname,
                "ip": node_ip,
                "proxmox_installed": proxmox_installed,
                "proxmox_version": proxmox_version,
                "already_in_cluster": already_in_cluster,
                "current_cluster": current_cluster,
                "has_old_config": has_old_config,
            },
        })

    except paramiko.AuthenticationException:
        # lgtm[py/reflected-xss]
        return jsonify({
            "success": False,
            "error": "Authentication failed. Check username/password.",
        }), 401  # snyk:ignore:Cross-site Scripting (XSS)
    except paramiko.SSHException:
        return _api_error("SSH error", status=500, success=False)
    except socket.timeout:
        # lgtm[py/reflected-xss]
        return jsonify({
            "success": False,
            "error": "Connection timeout. Check IP and network.",
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)
    except Exception:
        return _api_error("Connection failed", status=500, success=False)


@bp.route("/api/clusters/<cluster_id>/nodes/join", methods=["POST"])
@require_auth(perms=["cluster.admin"])
def join_node_to_cluster(cluster_id):
    """Add a new node to the Proxmox cluster"""
    # This uses SSH + interactive shell because pvecm add prompts for password
    # Force rejoin option added to handle nodes removed via pvecm delnode that still have stale configs
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    paramiko = get_paramiko()
    if not paramiko:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "SSH not available. Install paramiko: pip install paramiko"}), 500

    mgr = cluster_managers[cluster_id]
    data = request.get_json() or {}

    node_ip = _validate_host(data.get("node_ip", ""))
    username = data.get("username", "root")
    password = data.get("password", "")
    ssh_port = sanitize_int(data.get("ssh_port", 22), default=22, min_val=1, max_val=65535)
    link0_address = data.get("link0_address", "").strip()
    force_rejoin = data.get("force", False)  # Clean old cluster config before join

    if not node_ip or not password:
        # lgtm[py/reflected-xss]
        return jsonify({
            "success": False,
            "error": "Node IP and password are required",
        }), 400  # snyk:ignore:Cross-site Scripting (XSS)

    try:
        # Get join information from existing cluster
        # Use direct API call (same as get_join_info which works)
        # instead of api_request() wrapper which was silently failing
        host, port = mgr.host, mgr.api_port
        join_url = f"https://{host}:{port}/api2/json/cluster/config/join"
        join_resp = mgr._create_session().get(join_url, timeout=10)

        if join_resp.status_code != 200:
            logging.error(f"Join info API returned {join_resp.status_code}: {join_resp.text[:500]}")
            # lgtm[py/reflected-xss]
            return jsonify({
                "success": False,
                "error": f"Could not get cluster join information (HTTP {join_resp.status_code})",
            }), 500

        join_info = join_resp.json().get("data", {})
        logging.info(
            f"[Join] Got join info keys: {list(join_info.keys()) if isinstance(join_info, dict) else type(join_info)}"
        )

        # Extract fingerprint and join address from nodelist
        # Proxmox returns fingerprint per-node as 'pve_fp', not top-level
        fingerprint = ""
        join_addr = None

        # Check top-level first (some PVE versions)
        if isinstance(join_info, dict):
            fingerprint = join_info.get("fingerprint", "") or ""

        # Iterate nodelist for pve_fp and ring0_addr
        nodelist = join_info.get("nodelist", []) if isinstance(join_info, dict) else []
        for node_data in nodelist:
            if isinstance(node_data, dict):
                # Get fingerprint from first node that has it
                if not fingerprint and node_data.get("pve_fp"):
                    fingerprint = node_data["pve_fp"]
                # Find best node to join to
                if not join_addr and node_data.get("ring0_addr"):
                    join_addr = node_data["ring0_addr"]
                # Also try pve_addr as fallback for join address
                if not join_addr and node_data.get("pve_addr"):
                    join_addr = node_data["pve_addr"]

        if not join_addr:
            # Fallback to cluster host
            join_addr = mgr.config.host

        if not fingerprint:
            # Fallback: extract fingerprint from Proxmox SSL certificate
            # Same method as get_join_info uses - this is the cert fingerprint
            # that pvecm add --fingerprint expects
            logging.warning(f"[Join] No pve_fp in API response, extracting from SSL certificate of {host}")
            try:
                import hashlib
                import socket
                import ssl

                context = ssl.create_default_context()
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE

                with socket.create_connection((host, 8006), timeout=5) as sock, context.wrap_socket(
                    sock, server_hostname=host
                ) as ssock:
                    cert_der = ssock.getpeercert(binary_form=True)
                    fp_hex = hashlib.sha256(cert_der).hexdigest()
                    fingerprint = ":".join(fp_hex[i : i + 2].upper() for i in range(0, len(fp_hex), 2))
                    logging.info(f"[Join] Got SSL fingerprint: {fingerprint[:20]}...")
            except Exception as ssl_err:
                logging.error(f"[Join] SSL fingerprint extraction failed: {ssl_err}")

        if not fingerprint:
            logging.error(
                f"[Join] No fingerprint found! join_info type={type(join_info).__name__}, "
                f"nodelist={len(nodelist)} entries, "
                f"first_node_keys={list(nodelist[0].keys()) if nodelist and isinstance(nodelist[0], dict) else 'N/A'}"
            )
            # lgtm[py/reflected-xss]
            return jsonify({
                "success": False,
                "error": "Could not get cluster fingerprint. Check server logs for details.",
            }), 500

        # Connect to new node via SSH
        ssh = paramiko.SSHClient()
        apply_ssh_host_key_policy(ssh)
        ssh.connect(node_ip, port=ssh_port, username=username, password=password, timeout=30)

        # Clean old cluster config if force rejoin
        # This is needed when a node was removed from a cluster but still has
        # old corosync/pve config files (authkey, corosync.conf, etc.)
        if force_rejoin:
            logging.info(f"[Join] Force rejoin: cleaning old cluster config on {node_ip}")
            channel = ssh.invoke_shell()
            time.sleep(0.5)
            if channel.recv_ready():
                channel.recv(4096)

            cleanup_commands = [
                "systemctl stop pve-cluster corosync 2>/dev/null",
                "sleep 1",
                "killall -9 pmxcfs 2>/dev/null",
                "sleep 1",
                "rm -f /var/lock/pve-cluster.lck /var/lock/pvecm.lock /var/lib/pve-cluster/.pmxcfs.lockfile",
                "pmxcfs -_l &",
                "sleep 3",
                "rm -f /etc/corosync/authkey",
                "rm -f /etc/corosync/corosync.conf",
                "rm -f /etc/pve/corosync.conf",
                "killall -9 pmxcfs 2>/dev/null",
                "sleep 1",
                "rm -f /var/lock/pve-cluster.lck /var/lock/pvecm.lock /var/lib/pve-cluster/.pmxcfs.lockfile",
                "systemctl start pve-cluster",
                "sleep 3",
                "echo CLEANUP_DONE",
            ]
            for cmd in cleanup_commands:
                channel.send(cmd + "\n")
                time.sleep(0.5)

            time.sleep(5)
            cleanup_output = ""
            for _ in range(20):
                if channel.recv_ready():
                    cleanup_output += channel.recv(4096).decode("utf-8", errors="ignore")
                if "CLEANUP_DONE" in cleanup_output:
                    break
                time.sleep(0.5)

            channel.close()
            logging.info(f"[Join] Cleanup output: {cleanup_output[-500:]}")

            # Reconnect SSH after pve-cluster restart
            ssh.close()
            time.sleep(2)
            ssh = paramiko.SSHClient()
            apply_ssh_host_key_policy(ssh)
            ssh.connect(node_ip, port=ssh_port, username=username, password=password, timeout=30)

        # Use interactive shell for pvecm add (it prompts for password)
        channel = ssh.invoke_shell()
        time.sleep(0.5)

        # Clear initial output
        if channel.recv_ready():
            channel.recv(4096)

        # Build and send the join command
        join_cmd = f"pvecm add {join_addr} --fingerprint {fingerprint}"
        if force_rejoin:
            join_cmd += " --force"
        if link0_address:
            join_cmd += f" --link0 {link0_address}"

        channel.send(join_cmd + "\n")
        time.sleep(2)  # Wait for password prompt

        # Read output to check for password prompt
        output = ""
        for _ in range(10):
            if channel.recv_ready():
                output += channel.recv(4096).decode("utf-8", errors="ignore")
            time.sleep(0.5)
            if "password" in output.lower() or "Password" in output:
                break

        # Send password for the cluster root user
        channel.send(password + "\n")

        # Wait for completion (join can take 30-60 seconds)
        time.sleep(5)
        full_output = output
        for _ in range(60):  # Wait up to 60 seconds
            if channel.recv_ready():
                chunk = channel.recv(4096).decode("utf-8", errors="ignore")
                full_output += chunk
                if "successfully" in chunk.lower() or "joined" in chunk.lower():
                    break
                if "error" in chunk.lower() or "failed" in chunk.lower():
                    break
            time.sleep(1)

        channel.close()
        ssh.close()

        # Check result
        if "error" in full_output.lower() or "failed" in full_output.lower():
            # Extract error message
            error_lines = [_l for _l in full_output.split("\n") if "error" in _l.lower() or "failed" in _l.lower()]
            error_msg = error_lines[0] if error_lines else "Join command failed"
            # lgtm[py/reflected-xss]
            return jsonify({
                "success": False,
                "error": error_msg,
            }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure

        # Log the action
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(user, "cluster.node_joined", f"Node {node_ip} joined cluster", cluster=mgr.config.name)

        # Update fallback hosts and HA after node join
        # Without this, the new node won't be a fallback target until HA's periodic 60s refresh
        def _post_join_update():
            """Background task: update fallback hosts + HA after join settles"""
            time.sleep(15)  # Wait for Proxmox cluster to sync the new node
            try:
                # Refresh connection to discover new node
                mgr.connect_to_proxmox()

                # Rediscover fallback hosts (includes the new node)
                if hasattr(mgr, "_auto_discover_fallback_hosts"):
                    old_fallbacks = list(mgr.config.fallback_hosts or [])
                    mgr._auto_discover_fallback_hosts()
                    new_fallbacks = list(mgr.config.fallback_hosts or [])
                    if old_fallbacks != new_fallbacks:
                        logging.info(
                            f"[Join] Updated fallback hosts after node join: {old_fallbacks} → {new_fallbacks}"
                        )

                # If HA is active, update its node tracking
                if hasattr(mgr, "ha_enabled") and mgr.ha_enabled:
                    if hasattr(mgr, "_ha_update_fallback_hosts"):
                        mgr._ha_update_fallback_hosts()
                    logging.info("[Join] HA fallback hosts updated after node join")

            except Exception as e:
                logging.warning(f"[Join] Post-join update error (non-critical): {e}")

        threading.Thread(target=_post_join_update, daemon=True).start()

        # lgtm[py/reflected-xss]
        return jsonify({"success": True, "message": "Node joined cluster"})

    except paramiko.AuthenticationException:
        # lgtm[py/reflected-xss]
        return jsonify({
            "success": False,
            "error": "SSH authentication failed",
        }), 401  # snyk:ignore:Cross-site Scripting (XSS)
    except Exception as e:
        logging.error(f"Error joining node to cluster: {e}")
        return _api_error("Failed to join node to cluster", status=500, success=False)


@bp.route("/api/clusters/<cluster_id>/nodes/<node_name>/can-remove", methods=["GET"])
@require_auth(perms=["cluster.admin"])
def check_can_remove_node(cluster_id, node_name):
    """Check if a node can be safely removed from the cluster"""
    # Blockers vs warnings: blockers prevent removal, warnings are recommendations
    # Offline check is a warning not a blocker because pvecm delnode runs on another node
    try:
        ok, _ = check_cluster_access(cluster_id)
        if not ok:
            return _access_denied()

        if cluster_id not in cluster_managers:
            # lgtm[py/reflected-xss]
            return jsonify({
                "can_remove": False,
                "error": "Cluster not found",
                "blockers": ["Cluster not found"],
            }), 200  # snyk:ignore:Cross-site Scripting (XSS)

        mgr = cluster_managers[cluster_id]

        # Check maintenance status
        in_maintenance = node_name in mgr.nodes_in_maintenance
        maintenance_complete = False
        if in_maintenance:
            task = mgr.nodes_in_maintenance[node_name]
            maintenance_complete = getattr(task, "status", None) in ["completed", "completed_with_errors"]

        # Check if node is offline
        is_offline = True
        try:
            host, port = mgr.host, mgr.api_port
            nodes_url = f"https://{host}:{port}/api2/json/nodes"
            nodes_resp = mgr._create_session().get(nodes_url, timeout=10)
            nodes_list = nodes_resp.json().get("data", []) if nodes_resp.status_code == 200 else []
            for n in nodes_list:
                if n.get("node") == node_name:
                    is_offline = n.get("status") != "online"
                    break
        except Exception as e:
            logging.debug(f"[RemoveNode] Could not check node status: {e}")

        # Check for VMs/CTs on the node
        has_vms = False
        vm_count = 0
        try:
            host, port = mgr.host, mgr.api_port
            session = mgr._create_session()
            resources = []
            for endpoint in [f"/nodes/{node_name}/qemu", f"/nodes/{node_name}/lxc"]:
                try:
                    r = session.get(f"https://{host}:{port}/api2/json{endpoint}", timeout=10)
                    if r.status_code == 200:
                        resources += r.json().get("data", [])
                except Exception as _e:
                    pass
            vm_count = len(resources)
            has_vms = vm_count > 0
        except Exception as _e:
            pass

        # Determine blockers
        # Pvecm delnode runs on a REMAINING online node,
        # so the target node doesn't need to be offline.
        # It just needs VMs evacuated (maintenance complete).
        blockers = []
        warnings = []
        if not in_maintenance:
            blockers.append("Node must be in maintenance mode first")
        if not maintenance_complete and in_maintenance:
            blockers.append("Maintenance/evacuation must be complete")
        if has_vms:
            blockers.append(f"Node still has {vm_count} VM(s)/Container(s) - evacuate first")
        if not is_offline:
            warnings.append(
                "Node is still online - it will be removed from cluster config. Recommended: shutdown node after removal."
            )

        can_remove = len(blockers) == 0

        # lgtm[py/reflected-xss]
        return jsonify({
            "can_remove": can_remove,
            "in_maintenance": in_maintenance,
            "maintenance_complete": maintenance_complete,
            "is_offline": is_offline,
            "has_vms": has_vms,
            "vm_count": vm_count,
            "blockers": blockers,
            "warnings": warnings,
        })
    except Exception as e:
        logging.error(f"[RemoveNode] check_can_remove error: {e}")
        # lgtm[py/reflected-xss]
        return jsonify({
            "can_remove": False,
            "error": "Failed to check node removal",
            "blockers": ["Failed to check node removal"],
        }), 200


@bp.route("/api/clusters/<cluster_id>/nodes/<node_name>/cluster-membership", methods=["DELETE"])
@require_auth(perms=["cluster.admin"])
def remove_node_from_cluster(cluster_id, node_name):
    """Remove a node from the Proxmox cluster"""
    # Runs pvecm delnode on a remaining online node, then SSHs into the
    # removed node to clean up stale configs (authkey, corosync.conf, lock files)
    # IP must be resolved BEFORE delnode or we might wipe the wrong node!
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    # Validate node_name strictly. URL-routed param flows into
    # `pvecm delnode {node_name}` via SSH (line ~2617). Without validation, a
    # request like .../nodes/pve1;curl%20attacker/cluster-membership becomes a
    # shell-injection chain even though the route is gated to cluster.admin.
    # PVE/Debian node names follow RFC-1035-ish DNS rules: letter-led, then
    # letters/digits/hyphens, max ~63 chars. Reject anything else.
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9.\-]{0,62}$", node_name or ""):
        # lgtm[py/reflected-xss]
        return jsonify({"success": False, "error": "Invalid node name"}), 400  # snyk:ignore:Cross-site Scripting (XSS)

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    paramiko = get_paramiko()
    if not paramiko:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "SSH not available. Install paramiko: pip install paramiko"}), 500

    mgr = cluster_managers[cluster_id]
    data = request.get_json() or {}

    if not data.get("confirm"):
        # lgtm[py/reflected-xss]
        return jsonify({
            "success": False,
            "error": "Confirmation required",
        }), 400  # snyk:ignore:Cross-site Scripting (XSS)

    # Maintenance is recommended but not strictly required
    # pvecm delnode runs on another node, not on the target
    in_maintenance = node_name in mgr.nodes_in_maintenance
    if not in_maintenance:
        logging.warning(f"[RemoveNode] {node_name} not in maintenance mode - proceeding anyway")

    try:
        # Get cluster credentials for SSH - same pattern as HA
        cluster_config = mgr.config
        ssh_user = getattr(cluster_config, "ssh_user", None) or ""
        if not ssh_user:
            api_user = cluster_config.user
            ssh_user = (api_user or "root").split("@")[0]  # PR #62 (ry-ops): null-safe
        ssh_password = getattr(cluster_config, "pass_", "") or ""
        ssh_key_content = getattr(cluster_config, "ssh_key", "") or ""

        # Find an online node to execute the removal from
        host, port = mgr.host, mgr.api_port
        nodes_url = f"https://{host}:{port}/api2/json/nodes"
        nodes_resp = mgr._create_session().get(nodes_url, timeout=10)
        nodes = nodes_resp.json().get("data", []) if nodes_resp.status_code == 200 else []

        online_node = None
        online_node_ip = None

        for node in nodes:
            if node.get("node") != node_name and node.get("status") == "online":
                online_node = node.get("node")
                online_node_ip = mgr._get_node_ip(online_node) or cluster_config.host
                break

        if not online_node:
            # lgtm[py/reflected-xss]
            return jsonify({
                "success": False,
                "error": "No online node found to execute removal",
            }), 500  # snyk:ignore:Cross-site Scripting (XSS)

        # CRITICAL: Resolve the target node's IP BEFORE removal
        # After pvecm delnode, the node is gone from cluster config and _get_node_ip
        # would return wrong/stale data, potentially wiping another node's config!
        removed_node_ip = mgr._get_node_ip(node_name) if hasattr(mgr, "_get_node_ip") else None
        logging.info(f"[RemoveNode] Pre-resolved IP for {node_name}: {removed_node_ip}")

        # Connect to an online node via SSH
        ssh = paramiko.SSHClient()
        apply_ssh_host_key_policy(ssh)

        # Try SSH key first, then password
        connected = False
        if ssh_key_content:
            try:
                import io

                key_file = io.StringIO(ssh_key_content)
                pkey = None
                for key_class in [
                    paramiko.RSAKey,
                    paramiko.Ed25519Key,
                    paramiko.ECDSAKey,
                    getattr(paramiko, "DSSKey", None),
                ]:
                    if key_class is None:
                        continue
                    try:
                        key_file.seek(0)
                        pkey = key_class.from_private_key(key_file)
                        break
                    except Exception as _e:
                        continue
                if pkey:
                    ssh.connect(online_node_ip, port=22, username=ssh_user, pkey=pkey, timeout=30)
                    connected = True
            except Exception as key_err:
                logging.debug(f"[RemoveNode] SSH key auth failed: {key_err}")

        if not connected and ssh_password:
            ssh.connect(online_node_ip, port=22, username=ssh_user, password=ssh_password, timeout=30)
            connected = True

        if not connected:
            # lgtm[py/reflected-xss]
            return jsonify({
                "success": False,
                "error": "Could not authenticate via SSH. Configure SSH key or password.",
            }), 500

        # Execute pvecm delnode command. Apr 2026: shlex.quote belt-and-braces
        # — node_name is already regex-validated at the top of the function,
        # but the second layer keeps things safe if the regex ever loosens.
        cmd = f"pvecm delnode {shlex.quote(node_name)}"
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=60)

        exit_code = stdout.channel.recv_exit_status()
        stdout_text = stdout.read().decode("utf-8", errors="ignore")
        stderr_text = stderr.read().decode("utf-8", errors="ignore")

        ssh.close()

        if exit_code != 0:
            error_msg = stderr_text or stdout_text or "Unknown error"
            # lgtm[py/reflected-xss]
            return jsonify({
                "success": False,
                "error": f"Failed to remove node: {error_msg}",
            }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure

        # SSH into the REMOVED node and clean up old cluster config
        # pvecm delnode only updates the remaining nodes' config, the removed node
        # still has stale corosync/authkey/pve config that blocks future joins
        # IMPORTANT: removed_node_ip was resolved BEFORE pvecm delnode (see above)
        # Lock files (.pmxcfs.lockfile) are the #1 reason PVE-cluster won't start after cleanup
        cleanup_result = {"success": False, "message": "Skipped - could not determine node IP"}

        if removed_node_ip:
            try:
                logging.info(f"[RemoveNode] Cleaning up cluster config on removed node {node_name} ({removed_node_ip})")
                ssh_cleanup = paramiko.SSHClient()
                apply_ssh_host_key_policy(ssh_cleanup)

                # Try to connect to the removed node
                cleanup_connected = False
                if ssh_key_content:
                    try:
                        import io

                        key_file = io.StringIO(ssh_key_content)
                        pkey = None
                        for key_class in [
                            paramiko.RSAKey,
                            paramiko.Ed25519Key,
                            paramiko.ECDSAKey,
                            getattr(paramiko, "DSSKey", None),
                        ]:
                            if key_class is None:
                                continue
                            try:
                                key_file.seek(0)
                                pkey = key_class.from_private_key(key_file)
                                break
                            except Exception as _e:
                                continue
                        if pkey:
                            ssh_cleanup.connect(removed_node_ip, port=22, username=ssh_user, pkey=pkey, timeout=15)
                            cleanup_connected = True
                    except Exception as _e:
                        pass
                if not cleanup_connected and ssh_password:
                    try:
                        ssh_cleanup.connect(
                            removed_node_ip, port=22, username=ssh_user, password=ssh_password, timeout=15
                        )
                        cleanup_connected = True
                    except Exception as _e:
                        pass

                if cleanup_connected:
                    # SAFETY CHECK: Verify we're on the correct node before wiping config!
                    stdin, stdout, stderr = ssh_cleanup.exec_command("hostname", timeout=10)
                    actual_hostname = stdout.read().decode().strip()

                    # Case-insensitive compare - Proxmox uses lowercase node names
                    # but hostname might be "Pve1" while node_name is "pve1"
                    if actual_hostname.lower() != node_name.lower():
                        cleanup_result = {
                            "success": False,
                            "message": f"Hostname mismatch! Expected {node_name} but got {actual_hostname} - cleanup ABORTED to protect wrong node",
                        }
                        logging.error(
                            f"[RemoveNode] CRITICAL: Hostname mismatch on {removed_node_ip}! Expected '{node_name}', got '{actual_hostname}'. Cleanup aborted!"
                        )
                        ssh_cleanup.close()
                    else:
                        # Use invoke_shell for cleanup because:
                        # /etc/pve/ is a FUSE mount (pmxcfs). exec_command can't properly
                        # background pmxcfs -_l. invoke_shell handles this correctly.
                        channel = ssh_cleanup.invoke_shell()
                        time.sleep(0.5)
                        if channel.recv_ready():
                            channel.recv(4096)  # clear prompt

                        cleanup_commands = [
                            "systemctl stop pve-cluster corosync 2>/dev/null",
                            "sleep 1",
                            "killall -9 pmxcfs 2>/dev/null",
                            "sleep 1",
                            "rm -f /var/lock/pve-cluster.lck /var/lock/pvecm.lock /var/lib/pve-cluster/.pmxcfs.lockfile",
                            "pmxcfs -_l &",
                            "sleep 3",
                            "rm -f /etc/corosync/authkey",
                            "rm -f /etc/corosync/corosync.conf",
                            "rm -f /etc/pve/corosync.conf",
                            "killall -9 pmxcfs 2>/dev/null",
                            "sleep 1",
                            "rm -f /var/lock/pve-cluster.lck /var/lock/pvecm.lock /var/lib/pve-cluster/.pmxcfs.lockfile",
                            "systemctl start pve-cluster",
                            "echo CLEANUP_DONE",
                        ]

                        for cmd in cleanup_commands:
                            channel.send(cmd + "\n")
                            time.sleep(0.5)

                        # Wait for completion
                        time.sleep(5)
                        cleanup_output = ""
                        for _ in range(20):
                            if channel.recv_ready():
                                cleanup_output += channel.recv(4096).decode("utf-8", errors="ignore")
                            if "CLEANUP_DONE" in cleanup_output:
                                break
                            time.sleep(0.5)

                        channel.close()
                        ssh_cleanup.close()

                        logging.info(f"[RemoveNode] Cleanup output on {node_name}: {cleanup_output[-500:]}")

                        if "CLEANUP_DONE" in cleanup_output:
                            cleanup_result = {"success": True, "message": "Old cluster config cleaned up"}
                            logging.info(f"[RemoveNode] Cleanup on {node_name} successful")
                        else:
                            cleanup_result = {
                                "success": False,
                                "message": f"Cleanup uncertain - check node manually. Output: {cleanup_output[-200:]}",
                            }
                            logging.warning(f"[RemoveNode] Cleanup on {node_name} uncertain")
                else:
                    cleanup_result = {"success": False, "message": "Could not SSH into removed node for cleanup"}
                    logging.warning(f"[RemoveNode] Could not connect to {removed_node_ip} for cleanup")
            except Exception as cleanup_ex:
                cleanup_result = {"success": False, "message": str(cleanup_ex)}
                logging.warning(f"[RemoveNode] Cleanup error on {node_name}: {cleanup_ex}")

        # Clean up maintenance task
        if node_name in mgr.nodes_in_maintenance:
            del mgr.nodes_in_maintenance[node_name]

        # Clean up excluded_nodes - remove the deleted node
        excluded = getattr(mgr.config, "excluded_nodes", []) or []
        if node_name in excluded:
            excluded.remove(node_name)
            mgr.config.excluded_nodes = excluded
            logging.info(f"Removed {node_name} from excluded_nodes")

        # Clean up fallback_hosts - remove IPs of deleted node
        # Use pre-resolved IP (removed_node_ip) instead of _get_node_ip()
        # because _get_node_ip() queries Proxmox API which no longer knows this node after pvecm delnode!
        fallback = getattr(mgr.config, "fallback_hosts", []) or []
        if removed_node_ip and removed_node_ip in fallback:
            fallback.remove(removed_node_ip)
            mgr.config.fallback_hosts = fallback
            logging.info(f"Removed {removed_node_ip} from fallback_hosts")

        # Clean up HA node status for removed node
        if hasattr(mgr, "ha_node_status") and node_name in mgr.ha_node_status:
            with mgr.ha_lock:
                del mgr.ha_node_status[node_name]
            logging.info(f"[RemoveNode] Cleaned up HA tracking for {node_name}")

        # Clean up HA recovery state
        if hasattr(mgr, "ha_recovery_in_progress"):
            mgr.ha_recovery_in_progress.pop(node_name, None)

        # Save changes to database
        save_config()

        # Full fallback rediscovery in background
        # This ensures the fallback list is fully accurate after removal
        def _post_remove_update():
            """Background: rediscover fallback hosts after node removal"""
            time.sleep(5)  # Wait for cluster to settle
            try:
                mgr.connect_to_proxmox()
                if hasattr(mgr, "_auto_discover_fallback_hosts"):
                    mgr.config.fallback_hosts = []  # Clear and rediscover
                    mgr._auto_discover_fallback_hosts()
                    logging.info(f"[RemoveNode] Rediscovered fallback hosts: {mgr.config.fallback_hosts}")
                    save_config()
                if hasattr(mgr, "ha_enabled") and mgr.ha_enabled and hasattr(mgr, "_ha_update_fallback_hosts"):
                    mgr._ha_update_fallback_hosts()
            except Exception as e:
                logging.warning(f"[RemoveNode] Post-remove update error (non-critical): {e}")

        threading.Thread(target=_post_remove_update, daemon=True).start()

        # Log the action
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(user, "cluster.node_removed", f"Node {node_name} removed from cluster", cluster=mgr.config.name)

        # Broadcast the change
        broadcast_action("node_removed", "cluster", node_name, {}, cluster_id, user)

        # lgtm[py/reflected-xss]
        return jsonify({
            "success": True,
            "message": f"Node {node_name} has been removed from the cluster",
            "cleanup": cleanup_result,
        })

    except paramiko.AuthenticationException:
        # lgtm[py/reflected-xss]
        return jsonify({
            "success": False,
            "error": "SSH authentication failed. Check cluster credentials.",
        }), 401  # snyk:ignore:Cross-site Scripting (XSS)
    except Exception as e:
        logging.error(f"Error removing node from cluster: {e}")
        return _api_error("Failed to remove node from cluster", status=500, success=False)


# Node Action API (reboot/shutdown)
@bp.route("/api/clusters/<cluster_id>/nodes/<node_name>/action/<action>", methods=["POST"])
@require_auth(perms=["node.reboot"])
def node_action_api(cluster_id, node_name, action):
    """Perform action on node (reboot, shutdown) - requires maintenance mode"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    if action not in ["reboot", "shutdown"]:
        # lgtm[py/reflected-xss]
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({
            "error": f"Invalid action: {action}. Valid: reboot, shutdown"
        }), 400  # snyk:ignore:Cross-site Scripting (XSS)

    paramiko = get_paramiko()
    if not paramiko:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "SSH not available. Install paramiko: pip install paramiko"}), 500

    mgr = cluster_managers[cluster_id]

    # check node is in maintenance
    if node_name not in mgr.nodes_in_maintenance:
        # lgtm[py/reflected-xss]
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({
            "error": f"Node {node_name} not in maintenance mode"
        }), 400  # snyk:ignore:Cross-site Scripting (XSS)

    maintenance_task = mgr.nodes_in_maintenance[node_name]
    if maintenance_task.status not in ["completed", "completed_with_errors"]:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Evacuation still in progress"}), 400

    user = getattr(request, "session", {}).get("user", "system")

    try:
        node_ip = mgr._get_node_ip(node_name)
        if not node_ip:
            # lgtm[py/reflected-xss]
            # snyk:ignore:Cross-site Scripting (XSS)
            return jsonify({
                "error": f"Could not determine IP for {node_name}"
            }), 500  # snyk:ignore:Cross-site Scripting (XSS)

        ssh = mgr._ssh_connect(node_ip)
        if not ssh:
            if not getattr(mgr.config, "ssh_key", ""):
                # lgtm[py/reflected-xss]
                return jsonify({"error": "SSH connection failed"}), 500
            # lgtm[py/reflected-xss]
            return jsonify({"error": "SSH connection failed."}), 500

        try:
            # Check if we're already root (common on Proxmox)
            stdin, stdout, stderr = ssh.exec_command("id -u")
            uid = stdout.read().decode().strip()
            is_root = uid == "0"

            # Always use PTY for reliable execution
            transport = ssh.get_transport()
            channel = transport.open_session()
            channel.get_pty()
            channel.settimeout(10)

            # Use shutdown commands which are more reliable
            if is_root:
                if action == "reboot":
                    channel.exec_command("shutdown -r now")
                else:
                    channel.exec_command("shutdown -h now")
            else:
                if action == "reboot":
                    channel.exec_command("sudo shutdown -r now")
                else:
                    channel.exec_command("sudo shutdown -h now")

            # Wait briefly for command to be sent
            time.sleep(2)

            # Try to read any output
            try:
                output = channel.recv(1024).decode()
                logging.info(f"Node {action} output: {output}")
            except Exception as _e:
                pass

            channel.close()
            ssh.close()

            # Audit log
            log_audit(user, f"node.{action}", f"Node {node_name} {action} initiated")

            # Broadcast to all clients
            broadcast_action(f"node_{action}", "node", node_name, {}, cluster_id, user)

            # lgtm[py/reflected-xss]
            return jsonify({"success": True, "message": f"Node {node_name} {action} initiated"})

        except Exception as e:
            ssh.close()
            logging.error(f"Error executing {action} on {node_name}: {e}")
            return _api_error("Failed to execute node action", status=500)

    except Exception as e:
        logging.error(f"Node action error: {e}")
        return _api_error("Node action failed", status=500)


# Node Update API Routes
@bp.route("/api/clusters/<cluster_id>/nodes/<node_name>/update", methods=["POST"])
@require_auth(perms=["node.update"])
def start_node_update(cluster_id, node_name):
    """Start updating a node (must be in maintenance mode unless force=true)"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    paramiko = get_paramiko()
    if not paramiko:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "SSH nicht verfuegbar. Bitte installiere paramiko"}), 500

    mgr = cluster_managers[cluster_id]
    data = request.json or {}
    reboot = data.get("reboot", True)
    force = data.get("force", False)

    # check maintenance mode (unless force)
    if not force:
        if node_name not in mgr.nodes_in_maintenance:
            # lgtm[py/reflected-xss]
            # snyk:ignore:Cross-site Scripting (XSS)
            return jsonify({
                "error": f"Node {node_name} ist nicht im Wartungsmodus."
            }), 400  # snyk:ignore:Cross-site Scripting (XSS)

        maintenance_task = mgr.nodes_in_maintenance[node_name]
        if maintenance_task.status not in ["completed", "completed_with_errors"]:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "Evacuation in progress."}), 400

    task = mgr.start_node_update(node_name, reboot, force)

    if task:
        usr = getattr(request, "session", {}).get("user", "system")
        mode = "(forced)" if force else "(maintenance)"
        log_audit(usr, "node.update_started", f"Node {node_name} update started {mode}", cluster=mgr.config.name)
        # lgtm[py/reflected-xss]
        return jsonify({"success": True, "message": f"Update started for {node_name}", "task": task.to_dict()})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Update konnte nicht gestartet werden"}), 500


@bp.route("/api/clusters/<cluster_id>/nodes/<node_name>/update", methods=["GET"])
@require_auth(perms=["node.view"])
def get_update_status(cluster_id, node_name):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    status = mgr.get_update_status(node_name)

    # lgtm[py/reflected-xss]
    return jsonify(status if status else {"is_updating": False})


@bp.route("/api/clusters/<cluster_id>/nodes/<node_name>/update", methods=["DELETE"])
@require_auth(perms=["node.update"])
def clear_update_status_api(cluster_id, node_name):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    success = mgr.clear_update_status(node_name)

    if success:
        # lgtm[py/reflected-xss]
        return jsonify({"message": f"Update status cleared for {node_name}"})
    # lgtm[py/reflected-xss]
    # snyk:ignore:Cross-site Scripting (XSS)
    return jsonify({
        "error": f"No completed update found for {node_name}"
    }), 400  # snyk:ignore:Cross-site Scripting (XSS)


# VM Control API Routes
@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/<action>", methods=["POST"])
@require_auth()
def vm_action_api(cluster_id, node, vm_type, vmid, action):
    """Perform action on VM (start, stop, shutdown, reboot, reset, suspend, resume)

    Updated Dec 2025 - Now checks VM-specific ACLs
    """
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    logging.info(f"[VM-ACTION] Received: {action} on {vm_type}/{vmid} at {node}, cluster={cluster_id}")

    # check cluster access
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    valid_actions = ["start", "stop", "shutdown", "reboot", "reset", "suspend", "resume"]
    if action not in valid_actions:
        # lgtm[py/reflected-xss]
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({
            "error": f"Invalid action. Valid actions: {valid_actions}"
        }), 400  # snyk:ignore:Cross-site Scripting (XSS)

    # check permission for action - now uses VM ACLs
    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]  # Make sure username is set

    manager = cluster_managers[cluster_id]
    perm_map = {
        "start": "vm.start",
        "stop": "vm.stop",
        "shutdown": "vm.stop",
        "reboot": "vm.restart",
        "reset": "vm.restart",
        "suspend": "vm.stop",
        "resume": "vm.start",
    }
    required_perm = perm_map.get(action, "vm.start")

    # Use VM-specific ACL check instead of general permission
    # Added vm_type for pool permission check
    if not user_can_access_vm(user, cluster_id, vmid, required_perm, vm_type):
        logging.warning(f"[VM-ACTION] Permission denied for {request.session['user']}: {required_perm} on VM {vmid}")
        # lgtm[py/reflected-xss]
        return jsonify({"error": f"Permission denied: {html.escape(str(required_perm))}"}), 403

    # Check for force parameter (for force stop) - handle empty body gracefully
    force = False
    try:
        if request.is_json and request.data:
            data = request.get_json(silent=True) or {}
            force = data.get("force", False)
            logging.info(f"[VM-ACTION] Force parameter: {_sl(force)}, raw data: {request.data}")
    except Exception as e:
        logging.warning(f"[VM-ACTION] Error parsing body: {e}")

    logging.info(f"[VM-ACTION] Executing {action} with force={force}")
    manager = cluster_managers[cluster_id]
    try:
        result = manager.vm_action(node, vmid, vm_type, action, force=force)
    except Exception as e:
        logging.error(f"[VM-ACTION] Unhandled error: {action} on {vm_type}/{vmid}: {e}", exc_info=True)
        # lgtm[py/reflected-xss]
        return jsonify({"error": f"{html.escape(str(action))} failed"}), 500

    # If the manager resolved an empty/missing node from cluster resources,
    # use the resolved value for audit logs and real-time broadcasts.
    node = result.get("node", node)

    if result["success"]:
        # Audit log
        usr = getattr(request, "session", {}).get("user", "system")
        action_map = {
            "start": "vm.started",
            "stop": "vm.stopped",
            "shutdown": "vm.stopped",
            "reboot": "vm.restarted",
            "reset": "vm.restarted",
            "suspend": "vm.suspended",
            "resume": "vm.resumed",
        }
        log_audit(
            usr,
            action_map.get(action, f"vm.{action}"),
            f"{vm_type.upper()} {vmid} on {node} - {action}" + (" (force)" if force else ""),
            cluster=manager.config.name,
        )

        # Broadcast action to all clients for real-time updates
        broadcast_action(action, vm_type, str(vmid), {"node": node, "force": force}, cluster_id, usr)

        # Push immediate resource update for faster UI feedback
        push_immediate_update(cluster_id, delay=0.5)

        # Register which ProxmoxVEx user initiated this task
        upid = result.get("data")
        if upid:
            register_task_user(upid, usr, cluster_id)

        # lgtm[py/reflected-xss]
        return jsonify({"message": f"{action} successful for VM {vmid}", "data": result.get("data")})
    else:
        # Return 400 for client errors (like LXC reset), 500 for server errors
        error_msg = result.get("error", "Unknown error")
        status_code = 400 if "not supported" in error_msg.lower() else 500
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": error_msg
        }), status_code  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/nextid", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_next_vmid_api(cluster_id):
    # check cluster access
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    result = mgr.get_next_vmid()

    if result["success"]:
        # lgtm[py/reflected-xss]
        return jsonify({"vmid": result["vmid"]})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/clone", methods=["POST"])
@require_auth(perms=["vm.clone"])
def clone_vm_api(cluster_id, node, vm_type, vmid):
    """Clone a VM or container"""
    # tenant check
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    # Check pool permission for vm.clone
    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    if not user_can_access_vm(user, cluster_id, vmid, "vm.clone", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.clone"}), 403

    manager = cluster_managers[cluster_id]
    data = request.json or {}

    newid = data.get("newid")
    if not newid:
        # Get next available VMID
        next_result = manager.get_next_vmid()
        if next_result["success"]:
            newid = next_result["vmid"]
        else:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "Could not get next VMID"}), 500

    result = manager.clone_vm(
        node=node,
        vmid=vmid,
        vm_type=vm_type,
        newid=int(newid),
        name=data.get("name"),
        full=data.get("full", True),
        target_node=data.get("target_node"),
        target_storage=data.get("target_storage"),
        description=data.get("description"),
    )

    if result["success"]:
        # #194: apply Cloud-Init config to cloned QEMU VM (before first boot)
        if vm_type == "qemu":
            ci_params = {}
            for ci_key in ("ciuser", "cipassword", "sshkeys", "ipconfig0", "ipconfig1", "nameserver", "searchdomain"):
                if data.get(ci_key):
                    ci_params[ci_key] = data[ci_key]
            if ci_params:
                try:
                    upid = result.get("data")
                    if upid:
                        manager._wait_for_task(node, upid, timeout=600)
                    clone_node = data.get("target_node") or node
                    ci_url = (
                        f"https://{manager.host}:{manager.api_port}/api2/json/nodes/{clone_node}/qemu/{newid}/config"
                    )
                    manager._api_post(ci_url, data=ci_params)
                    logging.info(f"[CLONE] Applied Cloud-Init config to VM {newid}: {list(ci_params.keys())}")
                except Exception as e:
                    logging.warning(f"[CLONE] Cloud-Init config failed for {newid}: {e}")

        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(
            user,
            "vm.cloned",
            f"{vm_type.upper()} {vmid} cloned to {newid}" + (f" as '{data.get('name')}'" if data.get("name") else ""),
            cluster=manager.config.name,
        )

        # Register ProxmoxVEx user for this task
        upid = result.get("data")
        if upid:
            register_task_user(upid, user, cluster_id)

        # Push immediate update for live UI
        push_immediate_update(cluster_id, delay=0.5)

        # lgtm[py/reflected-xss]
        return jsonify({"message": f"Clone gestartet: {vmid} -> {newid}", "newid": newid, "data": result.get("data")})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/console", methods=["GET"])
@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/vnc", methods=["GET"])
@require_auth()
def get_console_ticket(cluster_id, node, vm_type, vmid):
    """Get VNC console ticket for VM - Now uses VM ACLs"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]

    mgr = cluster_managers[cluster_id]
    console_perm = "vm.console"
    if not user_can_access_vm(user, cluster_id, vmid, console_perm, vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": f"Permission denied: {html.escape(str(console_perm))}"}), 403

    result = mgr.get_vnc_ticket(node, vmid, vm_type)

    if result.get("success"):
        # Log who opened the console
        usr = request.session.get("user", "unknown")
        log_audit(usr, "vm.console", f"VNC console opened: {vm_type}/{vmid} on {node}", cluster=mgr.config.name)

        # Tag the vncproxy task with the ProxmoxVEx user who opened it,
        # so the taskbar shows YOUR user (not the shared PVE credential). Every other
        # task-creating action registers; the console path was the one that never did.
        if result.get("upid"):
            register_task_user(result["upid"], usr, cluster_id)

        # Stable VNC Mode (D). Frontend opt-in via ?stable=1.
        # Returns an additional AES-256-GCM session key + handle the WS handler
        # picks up on connect. Inner-encryption layer survives TLS-inspection
        # middleboxes that re-encrypt the outer TLS and modify binary RFB bytes.
        if request.args.get("stable") == "1":
            try:
                import base64 as _b64
                import secrets as _secrets

                from ProxmoxVEx.utils import vnc_crypto

                key = vnc_crypto.generate_session_key()
                sid = _secrets.token_urlsafe(16)
                vnc_crypto.stash_session_key(sid, key)
                result["stable"] = {
                    "session_id": sid,
                    "key_b64": _b64.b64encode(key).decode("ascii"),
                    "frame_format": "aes256-gcm-seq32-iv96",
                    "protocol_version": 1,
                }
            except Exception as _enc_err:
                logging.warning(f"[VNC] stable-mode key generation failed (falling back to plain): {_enc_err}")

        # lgtm[py/reflected-xss]
        return jsonify(result)
    # lgtm[py/reflected-xss]
    return jsonify({
        "error": result.get("error", "Failed")
    }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


# Framebuffer grab for the "Console Available" tile preview.
# Uses QEMU `screendump` over qm monitor (NOT vncproxy) — a vncproxy shows up
# as a "console opened" task in the PVE log on every grab, which spammed the
# log; screendump is invisible there. Needs node exec (API /execute or SSH);
# on API-token-only clusters without SSH it just fails and the tile shows the
# icon. Cached so re-renders don't re-run qm monitor.
_vm_screenshot_cache = {}  # {f"{cid}:{vmid}": (mono_ts, png_bytes)}
_vm_screenshot_lock = threading.Lock()
_VM_SCREENSHOT_TTL = 60.0


# RFB fallback for the console tile. screendump (qm monitor) is the
# primary grab, but it comes back empty/black for some guests — the big one being
# Windows on the virtio-gpu / QXL driver, where the HMP dump just doesn't render.
# In that case pull ONE frame straight off the vncproxy (RFB), which works no matter
# the guest GPU because it's QEMU's own VNC server. shared=1 so we don't kick an open
# console. Costs a single "console opened" line in the PVE log, hence fallback-only.
def _screenshot_via_rfb(mgr, node, vm_type, vmid, max_width=480, timeout=10):
    import json as _json
    import ssl as _ssl
    import urllib.parse
    import urllib.request

    import websocket as ws_client

    from ProxmoxVEx.utils import vnc_grab

    host, port = mgr.host, mgr.api_port

    ssl_ctx = _ssl.create_default_context()
    # (CodeAnt) - gate TLS verify on the per-cluster ssl_verify flag
    # (default off: PVE ships self-signed; honoured when the admin enables it).
    _verify_tls = bool(getattr(mgr, "_ssl_verify", False))
    if not _verify_tls:
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = _ssl.CERT_NONE

    # login → vncproxy ticket/port (same flow as vnc_poll)
    login_data = urllib.parse.urlencode({"username": mgr.config.user, "password": mgr.config.pass_}).encode("utf-8")
    login_req = urllib.request.Request(
        _pve_url(f"https://{host}:{port}/api2/json/access/ticket"), data=login_data, method="POST"
    )
    with urllib.request.urlopen(login_req, context=ssl_ctx, timeout=10) as r:
        login_result = _json.loads(r.read().decode("utf-8"))
    pve_ticket = login_result["data"]["ticket"]
    csrf_token = login_result["data"]["CSRFPreventionToken"]

    vnc_url = f"https://{host}:{port}/api2/json/nodes/{node}/{vm_type}/{vmid}/vncproxy"
    vnc_req = urllib.request.Request(
        _pve_url(vnc_url), data=urllib.parse.urlencode({"websocket": "1"}).encode("utf-8"), method="POST"
    )
    vnc_req.add_header("Cookie", f"PVEAuthCookie={pve_ticket}")
    vnc_req.add_header("CSRFPreventionToken", csrf_token)
    with urllib.request.urlopen(vnc_req, context=ssl_ctx, timeout=10) as r:
        vnc_result = _json.loads(r.read().decode("utf-8"))
    vnc_ticket = vnc_result["data"]["ticket"]
    vnc_port = vnc_result["data"]["port"]

    # optional SSH tunnel for clusters where 8006 isn't directly reachable from us
    tunnel_endpoint = None
    target_host, target_port = host, 8006
    try:
        if bool(getattr(mgr.config, "vnc_tunnel", False)):
            from ProxmoxVEx.utils import vnc_tunnel as _vt

            _ssh_user = getattr(mgr.config, "ssh_user", None) or (mgr.config.user or "root").split("@")[0]
            _ssh_port = getattr(mgr.config, "ssh_port", 22) or 22
            tunnel_endpoint = _vt.acquire(
                cluster_id=getattr(mgr, "id", ""),
                pve_host=host,
                ssh_user=_ssh_user,
                ssh_port=_ssh_port,
                ssh_key_content=getattr(mgr.config, "ssh_key", "") or "",
                ssh_password=getattr(mgr.config, "pass_", "") or "",
                target_host="127.0.0.1",
                target_port=8006,
            )
            target_host, target_port = "127.0.0.1", tunnel_endpoint.local_port
    except Exception as te:
        logging.warning(f"[Screenshot] RFB tunnel setup failed ({te}) — direct")
        tunnel_endpoint = None
        target_host, target_port = host, 8006

    encoded_ticket = url_quote(vnc_ticket, safe="")
    pve_ws_path = f"/api2/json/nodes/{node}/{vm_type}/{vmid}/vncwebsocket?port={vnc_port}&vncticket={encoded_ticket}"
    pve_ws_url = f"wss://{target_host}:{target_port}{pve_ws_path}"
    pve_ws = None
    try:
        # PVE 9.1+ drops the vncwebsocket upgrade unless the client advertises
        # the "binary" WebSocket subprotocol (noVNC uses the same).
        pve_ws = ws_client.create_connection(
            pve_ws_url,
            sslopt=({} if _verify_tls else {"cert_reqs": _ssl.CERT_NONE}),
            header={"Cookie": f"PVEAuthCookie={pve_ticket}", "Host": f"{host}:{port}"},
            subprotocols=["binary"],
            timeout=timeout,
        )
        img = vnc_grab.grab_frame(pve_ws, vnc_ticket, timeout=timeout)
    finally:
        try:
            if pve_ws:
                pve_ws.close()
        except Exception as _e:
            pass
        try:
            if tunnel_endpoint:
                tunnel_endpoint.stop()
        except Exception as _e:
            pass

    # same blank-guard as screendump — a genuinely-off display shouldn't render a black tile
    ex = img.getextrema()
    if max(hi for _lo, hi in ex) <= 10:
        raise OSError("blank framebuffer (display likely off)")
    # lgtm[py/reflected-xss]
    return vnc_grab.to_png_thumbnail(img, max_width=max_width)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/screenshot", methods=["GET"])
@require_auth()
def get_vm_screenshot(cluster_id, node, vm_type, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404
    if vm_type not in ("qemu", "lxc"):
        # Only QEMU and LXC expose a console we can screenshot
        # lgtm[py/reflected-xss]
        return jsonify({"error": "screenshot only available for qemu and lxc"}), 400

    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    mgr = cluster_managers[cluster_id]
    if getattr(mgr, "cluster_type", "proxmox") != "proxmox":
        # lgtm[py/reflected-xss]
        return jsonify({"error": "screenshot only available on proxmox"}), 400
    if not user_can_access_vm(user, cluster_id, vmid, "vm.console", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.console"}), 403

    cache_key = f"{cluster_id}:{vmid}"
    now = time.monotonic()
    if request.args.get("fresh") != "1":
        with _vm_screenshot_lock:
            hit = _vm_screenshot_cache.get(cache_key)
        if hit and (now - hit[0]) < _VM_SCREENSHOT_TTL:
            resp = current_app.response_class(hit[1], mimetype="image/png")
            resp.headers["Cache-Control"] = "private, max-age=60"
            resp.headers["X-Screenshot-Cache"] = "hit"
            # lgtm[py/reflected-xss]
            return resp

    # LXC has no QEMU monitor, so go straight to an RFB frame from the
    # PVE vncproxy/websocket; QEMU tries the lighter qm monitor screendump
    # first and falls back to the same RFB path.
    if vm_type == "lxc":
        try:
            png = _screenshot_via_rfb(mgr, node, vm_type, vmid, max_width=480, timeout=10)
        except Exception as e:
            logging.info(f"[Screenshot] RFB failed {vm_type}/{vmid}@{node}: {e}")
            return _api_error("screenshot unavailable", status=502)
    else:
        # screendump via qm monitor — no vncproxy, so no "console opened" PVE task
        try:
            from ProxmoxVEx.utils import vnc_grab

            png = vnc_grab.screendump_to_png(mgr, node, vmid, max_width=480, timeout=20)
        except Exception as e:
            # screendump came back empty/blank, or can't run (API-token-only / no SSH).
            # The common one is Windows on virtio-gpu/QXL — qm monitor screendump renders
            # nothing there, so the tile only ever showed the icon. Fall back to a one-off
            # RFB frame off the vncproxy (guest-GPU-independent) before giving up.
            logging.info(f"[Screenshot] screendump failed {vm_type}/{vmid}@{node}: {e} — trying RFB")
            try:
                png = _screenshot_via_rfb(mgr, node, vm_type, vmid, max_width=480, timeout=10)
            except Exception as e2:
                logging.info(f"[Screenshot] RFB fallback also failed {vm_type}/{vmid}@{node}: {e2}")
                return _api_error("screenshot unavailable", status=502)

    with _vm_screenshot_lock:
        _vm_screenshot_cache[cache_key] = (time.monotonic(), png)
        # keep the cache from growing unbounded on big estates
        if len(_vm_screenshot_cache) > 512:
            oldest = sorted(_vm_screenshot_cache.items(), key=lambda kv: kv[1][0])[:128]
            for k, _ in oldest:
                _vm_screenshot_cache.pop(k, None)

    resp = current_app.response_class(png, mimetype="image/png")
    resp.headers["Cache-Control"] = "private, max-age=60"
    resp.headers["X-Screenshot-Cache"] = "miss"
    # lgtm[py/reflected-xss]
    return resp


# HTTP-polling fallback for the VNC proxy. Used when the WS
# leg between browser and ProxmoxVEx is killed by a security middlebox (rare
# but real: CrowdStrike with WS DPI on, Zscaler strict mode). Same auth, same
# Stable-Mode crypto, same SSH tunnel for the second leg — only the transport
# changes from "one persistent WSS" to "many short HTTPS POSTs". Higher latency,
# but goes through anything that allows plain HTTPS.
@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/vnc-poll", methods=["POST"])
@require_auth()
def vnc_poll(cluster_id, node, vm_type, vmid):
    """Action-dispatched HTTP-polling endpoint for VNC.

    Body shapes:
      {action: 'open',  enc_session?: '...'}    -> {ok, poll_id, ...}
      {action: 'send',  poll_id, data_b64}      -> {ok, sent}
      {action: 'recv',  poll_id, max_wait?}     -> {ok, chunks_b64, closed}
      {action: 'close', poll_id}                -> {ok}
    """
    from ProxmoxVEx.utils import vnc_polling as _poll

    body = request.get_json(silent=True) or {}
    action = body.get("action")

    # All actions need cluster + perm checks
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    mgr = cluster_managers[cluster_id]
    console_perm = "vm.console"
    if not user_can_access_vm(user, cluster_id, vmid, console_perm, vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": f"Permission denied: {html.escape(str(console_perm))}"}), 403

    if vm_type not in ("qemu", "lxc"):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "invalid vm_type"}), 400

    # ───── action: open ─────
    if action == "open":
        # acquire PVE auth + vncproxy ticket (mirrors the WS handler flow)
        import base64 as _b64
        import json as _json
        import ssl as _ssl
        import urllib.parse
        import urllib.request

        import websocket as ws_client

        host, port = mgr.host, mgr.api_port

        ssl_ctx = _ssl.create_default_context()
        # (CodeAnt) - gate TLS verify on the per-cluster ssl_verify flag
        # (default off: PVE ships self-signed; honoured when the admin enables it).
        _verify_tls = bool(getattr(mgr, "_ssl_verify", False))
        if not _verify_tls:
            ssl_ctx.check_hostname = False
            ssl_ctx.verify_mode = _ssl.CERT_NONE

        try:
            login_data = urllib.parse.urlencode({
                "username": mgr.config.user,
                "password": mgr.config.pass_,
            }).encode("utf-8")
            login_req = urllib.request.Request(
                _pve_url(f"https://{host}:{port}/api2/json/access/ticket"), data=login_data, method="POST"
            )
            with urllib.request.urlopen(login_req, context=ssl_ctx, timeout=10) as r:
                login_result = _json.loads(r.read().decode("utf-8"))
            pve_ticket = login_result["data"]["ticket"]
            csrf_token = login_result["data"]["CSRFPreventionToken"]

            # (#352 follow-up) - same single-vncproxy fix applies
            # to the polling endpoint. If JS provides pve_port + pve_ticket in
            # the open body, reuse them so noVNC's RFB password matches PVE's.
            pve_port_q = body.get("pve_port")
            pve_ticket_q = body.get("pve_ticket")
            _ppt_ok, _ppt_port = _safe_vnc_passthrough(pve_port_q, pve_ticket_q)
            if pve_port_q and pve_ticket_q and _ppt_ok:
                vnc_ticket = pve_ticket_q
                vnc_port = _ppt_port
            else:
                vnc_url = f"https://{host}:{port}/api2/json/nodes/{node}/{vm_type}/{vmid}/vncproxy"
                vnc_req = urllib.request.Request(
                    _pve_url(vnc_url), data=urllib.parse.urlencode({"websocket": "1"}).encode("utf-8"), method="POST"
                )
                vnc_req.add_header("Cookie", f"PVEAuthCookie={pve_ticket}")
                vnc_req.add_header("CSRFPreventionToken", csrf_token)
                with urllib.request.urlopen(vnc_req, context=ssl_ctx, timeout=10) as r:
                    vnc_result = _json.loads(r.read().decode("utf-8"))
                vnc_ticket = vnc_result["data"]["ticket"]
                vnc_port = vnc_result["data"]["port"]
        except Exception:
            logging.exception("pve auth/proxy failed")
            # lgtm[py/reflected-xss]
            return jsonify({"error": "pve auth/proxy failed"}), 502

        encoded_ticket = url_quote(vnc_ticket, safe="")
        pve_ws_path = (
            f"/api2/json/nodes/{node}/{vm_type}/{vmid}/vncwebsocket?port={vnc_port}&vncticket={encoded_ticket}"
        )

        # Optional SSH tunnel (same path as WS handler)
        tunnel_endpoint = None
        target_host = host
        target_port = 8006
        try:
            if bool(getattr(mgr.config, "vnc_tunnel", False)):
                from ProxmoxVEx.utils import vnc_tunnel as _vt

                _ssh_user = getattr(mgr.config, "ssh_user", None) or (mgr.config.user or "root").split("@")[0]
                _ssh_port = getattr(mgr.config, "ssh_port", 22) or 22
                tunnel_endpoint = _vt.acquire(
                    cluster_id=cluster_id,
                    pve_host=host,
                    ssh_user=_ssh_user,
                    ssh_port=_ssh_port,
                    ssh_key_content=getattr(mgr.config, "ssh_key", "") or "",
                    ssh_password=getattr(mgr.config, "pass_", "") or "",
                    target_host="127.0.0.1",
                    target_port=8006,
                )
                target_host = "127.0.0.1"
                target_port = tunnel_endpoint.local_port
                logging.info(f"[VncPoll] tunnel routed via 127.0.0.1:{target_port} → SSH → {host}:{port}")
        except Exception as te:
            logging.warning(f"[VncPoll] tunnel setup failed ({te}) — direct WSS to PVE")
            tunnel_endpoint = None
            target_host = host
            target_port = 8006

        pve_ws_url = f"wss://{target_host}:{target_port}{pve_ws_path}"
        try:
            pve_ws = ws_client.create_connection(
                pve_ws_url,
                sslopt=({} if _verify_tls else {"cert_reqs": _ssl.CERT_NONE}),
                header={"Cookie": f"PVEAuthCookie={pve_ticket}", "Host": f"{host}:{port}"},
                subprotocols=["binary"],
                timeout=VNC_PVE_CONNECT_TIMEOUT,
            )
            _apply_vnc_socket_options(pve_ws.sock)
        except Exception:
            try:
                if tunnel_endpoint:
                    tunnel_endpoint.stop()
            except Exception:
                pass
            logging.exception("pve ws connect failed")
            # lgtm[py/reflected-xss]
            return jsonify({"error": "pve ws connect failed"}), 502

        # Optional Stable-Mode crypto
        crypto_session = None
        enc_sid = body.get("enc_session")
        if enc_sid:
            try:
                from ProxmoxVEx.utils import vnc_crypto as _vc

                key = _vc.claim_session_key(enc_sid)
                if key:
                    crypto_session = _vc.VncCryptoSession(key)
            except Exception as ce:
                logging.warning(f"[VncPoll] crypto setup failed ({ce}) — plain mode")

        sess = _poll.VncPollSession(
            poll_id=_poll.new_poll_id(),
            pve_ws=pve_ws,
            tunnel_endpoint=tunnel_endpoint,
            crypto_session=crypto_session,
            cluster_id=cluster_id,
            vm_type=vm_type,
            vmid=vmid,
            host=host,
        )
        _poll.register(sess)
        log_audit(
            request.session.get("user", "unknown"),
            "vm.console",
            f"VNC poll session opened: {vm_type}/{vmid} on {node}",
            cluster=mgr.config.name,
        )
        logging.info(
            f"[VncPoll] open id={sess.poll_id[:8]} {vm_type}/{vmid}@{node} crypto={'on' if crypto_session else 'off'} tunnel={'on' if tunnel_endpoint else 'off'}"
        )
        # lgtm[py/reflected-xss]
        return jsonify({
            "ok": True,
            "poll_id": sess.poll_id,
            "transport": "http-polling",
            "recv_max_wait": _poll.RECV_LONG_POLL_DEFAULT,
        })

    # All other actions require an existing poll_id
    poll_id = body.get("poll_id") or ""
    sess = _poll.get(poll_id)
    if not sess:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "unknown or expired poll session"}), 404
    if sess.cluster_id != cluster_id or sess.vm_type != vm_type or sess.vmid != vmid:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "poll session does not match resource"}), 403

    if action == "send":
        try:
            n = sess.send(body.get("data_b64", ""))
        except Exception:
            logging.exception("send failed")
            # lgtm[py/reflected-xss]
            return jsonify({"error": "send failed", "closed": sess.closed}), 502
        # lgtm[py/reflected-xss]
        return jsonify({"ok": True, "sent": n})

    if action == "recv":
        max_wait = float(body.get("max_wait", 5.0) or 5.0)
        chunks = sess.recv(max_wait=max_wait)
        import base64 as _b64

        # lgtm[py/reflected-xss]
        return jsonify({
            "ok": True,
            "chunks_b64": [_b64.b64encode(c).decode("ascii") for c in chunks],
            "closed": sess.closed,
        })

    if action == "close":
        _poll.drop(poll_id)
        # lgtm[py/reflected-xss]
        return jsonify({"ok": True})

    # lgtm[py/reflected-xss]
    return jsonify({"error": f"unknown action {html.escape(str(action))}"}), 400


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/shell", methods=["POST"])
@require_auth(perms=["node.shell"])
def get_node_shell_ticket(cluster_id, node):
    """Get shell ticket for node - requires node.shell permission"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    result = mgr.get_node_shell_ticket(node)

    # audit - shell access is sensitive
    usr = getattr(request, "session", {}).get("user", "system")
    log_audit(usr, "node.shell_access", f"Shell access requested for node {node}", cluster=mgr.config.name)

    if result["success"]:
        # lgtm[py/reflected-xss]
        return jsonify(result)
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


def _get_vm_config_response(cluster_id, node, vm_type, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    denied = _require_vm_access(cluster_id, vmid, "vm.view", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied

    mgr = cluster_managers[cluster_id]
    try:
        result = mgr.get_vm_config(node, vmid, vm_type)
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
        logging.warning(f"[API] Cluster {cluster_id} unreachable for vm config: {e}")
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster temporarily unreachable", "offline": True}), 503

    if result["success"]:
        config = result["config"]
        if isinstance(config, dict) and not config.get("tags") and not config.get("tag"):
            raw = config.get("raw") if isinstance(config.get("raw"), dict) else {}
            general = config.get("general") if isinstance(config.get("general"), dict) else {}
            vm_tags = raw.get("tags") or general.get("tags")
            if vm_tags:
                config["tags"] = vm_tags
        # lgtm[py/reflected-xss]
        return jsonify(config)
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


def _resolve_vm_location(mgr, vmid, requested_node=None, requested_type=None):
    """Find the current node/type for a VMID so shorthand VM routes can work."""
    requested_node = (requested_node or "").strip() or None
    requested_type = (requested_type or "").strip() or None
    if requested_type == "ct":
        requested_type = "lxc"

    try:
        resources = mgr.get_vm_resources() or []
    except Exception:
        logging.exception(f"[API] Failed to resolve VM {vmid} location")
        return None, None, jsonify({"error": "Failed to resolve VM location"}), 500

    matches = []
    for item in resources:
        if str(item.get("vmid")) != str(vmid):
            continue
        item_type = item.get("type") or "qemu"
        item_node = item.get("node") or requested_node
        if requested_type and item_type != requested_type:
            continue
        if requested_node and item_node != requested_node:
            continue
        matches.append((item_node, item_type))

    if not matches:
        # lgtm[py/reflected-xss]
        # snyk:ignore:Cross-site Scripting (XSS)
        return None, None, jsonify({"error": f"VM {vmid} not found"}), 404

    unique = []
    for match in matches:
        if match not in unique:
            unique.append(match)

    if len(unique) > 1:
        # lgtm[py/reflected-xss]
        return (
            None,
            None,
            jsonify({
                "error": f"VM {vmid} is ambiguous; use /vms/<node>/<type>/{vmid}/config",
                "matches": [{"node": node, "type": vm_type} for node, vm_type in unique],
            }),
            409,
        )

    node, vm_type = unique[0]
    if not node:
        node = requested_node or ""
    # lgtm[py/reflected-xss]
    return node, vm_type, None, None


# VM Config API Routes
@bp.route("/api/clusters/<cluster_id>/vms/<int:vmid>/config", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_vm_config_by_id_api(cluster_id, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    node, vm_type, error_body, status = _resolve_vm_location(
        mgr,
        vmid,
        requested_node=request.args.get("node"),
        requested_type=request.args.get("type") or request.args.get("vm_type"),
    )
    if error_body is not None:
        # lgtm[py/reflected-xss]
        return error_body, status

    # lgtm[py/reflected-xss]
    return _get_vm_config_response(cluster_id, node, vm_type, vmid)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/config", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_vm_config_api(cluster_id, node, vm_type, vmid):
    # lgtm[py/reflected-xss]
    return _get_vm_config_response(cluster_id, node, vm_type, vmid)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/lock", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_vm_lock_status_api(cluster_id, node, vm_type, vmid):
    """Get lock status of a VM/CT"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]

    try:
        result = mgr.get_vm_lock_status(node, vmid, vm_type)

        if result.get("success"):
            # lgtm[py/reflected-xss]
            return jsonify({
                "locked": result.get("locked", False),
                "lock_reason": result.get("lock_reason"),
                "lock_description": result.get("lock_description"),
                "unlock_command": f"qm unlock {vmid}" if vm_type == "qemu" else f"pct unlock {vmid}",
            })
        else:
            # Return not-locked instead of error for better UX
            # The VM config might not be accessible but that doesn't mean it's locked
            logging.warning(f"Could not get lock status for {vm_type}/{vmid}: {result.get('error')}")
            # lgtm[py/reflected-xss]
            return jsonify({
                "locked": False,
                "lock_reason": None,
                "lock_description": None,
                "unlock_command": None,
                "note": "Could not determine lock status",
            })
    except Exception as e:
        logging.error(f"Error getting lock status for {vm_type}/{vmid}: {e}")
        # lgtm[py/reflected-xss]
        return jsonify({"locked": False, "lock_reason": None, "lock_description": None, "unlock_command": None})


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/unlock", methods=["POST"])
@require_auth(perms=["vm.config"])
def unlock_vm_api(cluster_id, node, vm_type, vmid):
    """Unlock a VM/CT - use with caution!"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    result = mgr.unlock_vm(node, vmid, vm_type)

    if result["success"]:
        usr = getattr(request, "session", {}).get("user", "system")
        log_audit(
            usr,
            "vm.unlock",
            f"Unlocked {vm_type}/{vmid} on {node} (was: {result.get('lock_reason', 'unknown')})",
            cluster=mgr.config.name,
        )
        # lgtm[py/reflected-xss]
        return jsonify({
            "message": result["message"],
            "was_locked": result.get("was_locked", False),
            "lock_reason": result.get("lock_reason"),
        })
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


# Issue #50 - Guest Agent info (hostname, OS, kernel)
# Additive enrichment for the monitoring panel: kernel_version,
# interfaces[] (with MAC + per-NIC IPs), filesystems[], users[], guest_time_ns.
# All existing fields stay unchanged — old UI consumers render exactly as before.
@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/guest-info", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_vm_guest_info_api(cluster_id, node, vm_type, vmid):
    """Get QEMU Guest Agent info (hostname, OS, kernel, NICs, filesystems, users, clock)"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    # (#560 @j0c00) - LXCs have no guest agent, but PVE still exposes the
    # container's live IPs via /lxc/<vmid>/interfaces (_fetch_lxc_ips, #300) and the OS
    # type + hostname via config. Surface them so the detail view shows OS + IP like the
    # PVE UI does, instead of a bare "LXC Container" with no address.
    if vm_type == "lxc":
        res = {
            "agent_running": False,
            "is_lxc": True,
            "hostname": None,
            "os_pretty_name": None,
            "os_id": None,
            "os_version": None,
            "os_kernel": None,
            "ip_addresses": [],
            "interfaces": [],
        }
        try:
            mgr = cluster_managers[cluster_id]
            seen = set()
            clean = []
            for ip in mgr._fetch_lxc_ips(node, vmid) or []:
                if not ip or ip in seen:
                    continue
                seen.add(ip)
                # skip loopback / link-local / the docker bridge noise
                if ip.startswith(("127.", "::1", "169.254.", "fe80", "172.17.")):
                    continue
                clean.append(ip)
            res["ip_addresses"] = clean
            cfg = mgr.get_vm_config(node, vmid, "lxc")
            if cfg.get("success"):
                gen = cfg["config"].get("general", {}) or {}
                res["hostname"] = gen.get("hostname")
                _ost = gen.get("ostype")
                if _ost:
                    res["os_pretty_name"] = str(_ost).capitalize()
        except Exception as e:
            logging.debug(f"[lxc-info] {vm_type}/{vmid}: {e}")
        # lgtm[py/reflected-xss]
        return jsonify(res)

    if vm_type != "qemu":
        # lgtm[py/reflected-xss]
        return jsonify({"agent_running": False}), 200

    mgr = cluster_managers[cluster_id]
    result = {
        "agent_running": False,
        "hostname": None,
        "os_pretty_name": None,
        "os_id": None,
        "os_version": None,
        "os_kernel": None,
        "os_machine": None,
        "ip_addresses": [],
        "kernel_version": None,
        "interfaces": [],
        "users": [],
        "filesystems": [],
        "guest_time_ns": None,
    }

    try:
        session = mgr._create_session()
        base = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/qemu/{vmid}/agent"

        try:
            resp = session.get(f"{base}/get-host-name", timeout=8)
            logging.info(f"[guest-info:{vmid}] get-host-name status={resp.status_code} body={resp.text[:200]}")
            if resp.status_code == 200:
                data = resp.json().get("data", {}).get("result", {})
                result["hostname"] = data.get("host-name")
                result["agent_running"] = True
            elif resp.status_code == 500 and "not running" in (resp.text or "").lower():
                # short-circuit: agent down, skip the 5 follow-up calls
                # lgtm[py/reflected-xss]
                return jsonify(result)
        except Exception as _e:
            logging.info(f"[guest-info:{vmid}] get-host-name exception: {_e}")

        try:
            resp = session.get(f"{base}/get-osinfo", timeout=8)
            logging.info(f"[guest-info:{vmid}] get-osinfo status={resp.status_code} body={resp.text[:200]}")
            if resp.status_code == 200:
                data = resp.json().get("data", {}).get("result", {})
                result["os_pretty_name"] = data.get("pretty-name")
                result["os_id"] = data.get("id")
                result["os_version"] = data.get("version-id") or data.get("version")
                result["os_kernel"] = data.get("kernel-release")
                result["os_machine"] = data.get("machine")
                result["kernel_version"] = data.get("kernel-version")
                result["agent_running"] = True
        except Exception as _e:
            logging.info(f"[guest-info:{vmid}] get-osinfo exception: {_e}")

        # #159 - reuse centralized IP fetch method
        try:
            ips = mgr._fetch_qemu_ips(node, vmid)
            logging.info(f"[guest-info:{vmid}] _fetch_qemu_ips returned {len(ips) if ips else 0} ips")
            result["ip_addresses"] = ips
            if ips:
                result["agent_running"] = True
        except Exception as _e:
            logging.info(f"[guest-info:{vmid}] _fetch_qemu_ips exception: {_e}")

        # Per-NIC detail (name + MAC + IPs from inside the guest)
        try:
            resp = session.get(f"{base}/network-get-interfaces", timeout=8)
            if resp.status_code == 200:
                nics = resp.json().get("data", {}).get("result", []) or []
                ifaces = []
                for nic in nics:
                    nic_ips = [
                        {
                            "address": ip.get("ip-address"),
                            "family": ip.get("ip-address-type"),
                            "prefix": ip.get("prefix"),
                        }
                        for ip in (nic.get("ip-addresses") or [])
                    ]
                    ifaces.append({
                        "name": nic.get("name"),
                        "mac": nic.get("hardware-address"),
                        "ips": nic_ips,
                    })
                result["interfaces"] = ifaces
            elif resp.status_code == 500:
                # Agent not available — remember so background polls skip it.
                mgr.mark_no_agent(vmid)
        except Exception as _e:
            pass

        # Filesystems with real fill - same data as /guest-fsinfo, mirrored
        # here so the detail panel does one round-trip instead of two.
        try:
            resp = session.get(f"{base}/get-fsinfo", timeout=8)
            if resp.status_code == 200:
                fsraw = resp.json().get("data", {}).get("result", []) or []
                fslist = []
                for fs in fsraw:
                    total = fs.get("total-bytes")
                    used = fs.get("used-bytes")
                    mt = fs.get("mountpoint")
                    if not mt:
                        continue
                    pct = (
                        round((used / total) * 100, 1)
                        if (isinstance(total, (int, float)) and total > 0 and isinstance(used, (int, float)))
                        else None
                    )
                    fslist.append({
                        "name": fs.get("name"),
                        "mountpoint": mt,
                        "type": fs.get("type"),
                        "used_bytes": used,
                        "total_bytes": total,
                        "used_pct": pct,
                    })
                result["filesystems"] = fslist
            elif resp.status_code == 500:
                # Agent not available — remember so background polls skip it.
                mgr.mark_no_agent(vmid)
        except Exception as _e:
            pass

        # Logged-in users - "who's on this VM right now"
        try:
            resp = session.get(f"{base}/get-users", timeout=8)
            if resp.status_code == 200:
                ur = resp.json().get("data", {}).get("result", []) or []
                if isinstance(ur, list):
                    result["users"] = [
                        {"user": u.get("user"), "domain": u.get("domain"), "login_time": u.get("login-time")}
                        for u in ur
                    ]
        except Exception as _e:
            pass

        # Guest clock vs host (ns since epoch) - ntp sanity check
        try:
            resp = session.get(f"{base}/get-time", timeout=8)
            if resp.status_code == 200:
                t = resp.json().get("data", {}).get("result")
                if isinstance(t, (int, float)):
                    result["guest_time_ns"] = t
        except Exception as _e:
            pass

    except Exception as e:
        result["error"] = str(e)

    # lgtm[py/reflected-xss]
    return jsonify(result)


# #334 - surface the guest agent's fsinfo so scripts can monitor mountpoint
# usage without having to call both ProxmoxVEx + Proxmox. Returns [] + agent_running=False
# when the agent isn't installed / the VM isn't running — callers treat it as "no data".
@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/guest-fsinfo", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_vm_guest_fsinfo_api(cluster_id, node, vm_type, vmid):
    """Proxy for qemu-agent get-fsinfo — list mounted filesystems with used/total bytes."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    # LXC doesn't speak qemu-agent — no-op response keeps the frontend uniform
    if vm_type != "qemu":
        # lgtm[py/reflected-xss]
        return jsonify({"agent_running": False, "filesystems": [], "reason": "lxc_not_supported"}), 200

    mgr = cluster_managers[cluster_id]
    payload = {"agent_running": False, "filesystems": [], "reason": None}

    try:
        session = mgr._create_session()
        url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/qemu/{vmid}/agent/get-fsinfo"
        resp = session.get(url, timeout=10)
        if resp.status_code == 200:
            data = (resp.json().get("data") or {}).get("result") or []
            out = []
            for fs in data:
                total = fs.get("total-bytes")
                used = fs.get("used-bytes")
                mount = fs.get("mountpoint")
                if not mount:
                    continue
                pct = None
                if isinstance(total, (int, float)) and total > 0 and isinstance(used, (int, float)):
                    pct = round((used / total) * 100, 1)
                out.append({
                    "name": fs.get("name"),
                    "mountpoint": mount,
                    "type": fs.get("type"),
                    "used_bytes": used,
                    "total_bytes": total,
                    "used_pct": pct,
                })
            payload["agent_running"] = True
            payload["filesystems"] = out
        elif resp.status_code == 500:
            # Proxmox returns 500 with "QEMU guest agent is not running" in body
            # Remember this VM so the background refresh loop stops re-probing it.
            mgr.mark_no_agent(vmid)
            body = (resp.text or "").lower()
            if "not running" in body or "not installed" in body:
                payload["reason"] = "agent_not_running"
            else:
                payload["reason"] = f"proxmox_{resp.status_code}"
        else:
            payload["reason"] = f"proxmox_{resp.status_code}"
    except Exception as e:
        payload["reason"] = f"error: {e}"

    # lgtm[py/reflected-xss]
    return jsonify(payload)


# Read a file from a running VM via the qemu-guest-agent.
# PVE 9.2 added optional `count`, `offset`, `decode` (base64) params so you
# can stream large files in chunks without dragging the whole thing through
# memory. We pass them through; older PVE silently ignores extras.
@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/guest-file-read", methods=["POST"])
@require_auth(perms=["vm.view"])
def get_vm_guest_file_read_api(cluster_id, node, vm_type, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    if vm_type != "qemu":
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Guest-agent file-read is QEMU-only"}), 400

    mgr = cluster_managers[cluster_id]
    body = request.json or {}
    file_path = body.get("file")
    if not file_path:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "file path required"}), 400

    params = {"file": file_path}
    # 9.2 optional params — accept ints + a base64 toggle
    for k in ("count", "offset"):
        if k in body and body[k] not in (None, ""):
            try:
                params[k] = int(body[k])
            except (TypeError, ValueError):
                # lgtm[py/reflected-xss]
                return jsonify({"error": f"{html.escape(str(k))} must be an integer"}), 400
    if body.get("decode"):
        # PVE expects '1' / '0', accept boolean or string
        params["decode"] = 1 if body["decode"] in (True, 1, "1", "true") else 0

    try:
        url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/qemu/{vmid}/agent/file-read"
        resp = mgr._api_post(url, data=params)
        if resp.status_code == 200:
            data = resp.json().get("data") or {}
            # lgtm[py/reflected-xss]
            return jsonify({
                "content": data.get("content"),
                "truncated": bool(data.get("truncated", False)),
                "bytes_read": data.get("bytes-read") or data.get("content-size"),
            })
        # lgtm[py/reflected-xss]
        return _pve_error(resp)
    except Exception:
        return _api_error("Failed to read VM guest file", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/rrd/<timeframe>", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_vm_rrd_api(cluster_id, node, vm_type, vmid, timeframe):
    """Get VM RRD metrics data for graphs

    Timeframes: hour, day, week, month, year
    """
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    valid_timeframes = ["hour", "day", "week", "month", "year"]
    if timeframe not in valid_timeframes:
        # lgtm[py/reflected-xss]
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({
            "error": f"Invalid timeframe. Valid: {valid_timeframes}"
        }), 400  # snyk:ignore:Cross-site Scripting (XSS)

    mgr = cluster_managers[cluster_id]
    result = mgr.get_vm_rrd(node, vmid, vm_type, timeframe)

    if result["success"]:
        # lgtm[py/reflected-xss]
        return jsonify(result["data"])
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/config", methods=["PUT"])
@require_auth(perms=["vm.config"])
def update_vm_config_api(cluster_id, node, vm_type, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]

    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]

    if not user_can_access_vm(user, cluster_id, vmid, "vm.config", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.config"}), 403

    config_updates = request.json or {}

    result = manager.update_vm_config(node, vmid, vm_type, config_updates)

    if result["success"]:
        # Broadcast VM config change via SSE for live UI updates
        try:
            updated_config = manager.get_vm_config(node, vmid, vm_type)
            if isinstance(updated_config, dict):
                cfg = updated_config.get("config", updated_config)
                broadcast_sse("vm_config", {"vmid": vmid, "node": node, "vm_type": vm_type, "config": cfg}, cluster_id)
        except Exception as e:
            logging.debug(f"Failed to broadcast vm_config SSE: {e}")

        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        changes = ", ".join([f"{k}={v}" for k, v in config_updates.items()][:5])
        log_audit(
            user,
            "vm.config_changed",
            f"{vm_type.upper()} {vmid} config updated: {changes}",
            cluster=manager.config.name,
        )
        # lgtm[py/reflected-xss]
        return jsonify({"message": result["message"]})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/sanitize-boot-order", methods=["POST"])
@require_auth(perms=["vm.config"])
def sanitize_boot_order_api(cluster_id, node, vm_type, vmid):
    """Sanitize boot order by removing non-existent devices.

    Fixes 'invalid bootorder: device does not exist' errors.
    """
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    if not user_can_access_vm(user, cluster_id, vmid, "vm.config", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.config"}), 403

    manager = cluster_managers[cluster_id]
    result = manager.sanitize_boot_order(node, vmid, vm_type)

    if result["success"]:
        if result.get("changed"):
            user = getattr(request, "session", {}).get("user", "system")
            log_audit(
                user,
                "vm.boot_order_sanitized",
                f"{vm_type.upper()} {vmid} boot order sanitized",
                cluster=manager.config.name,
            )
        # lgtm[py/reflected-xss]
        return jsonify(result)
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


# =====================================================
# PCI / USB / SERIAL PASSTHROUGH API
# =====================================================


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/hardware/pci", methods=["GET"])
@require_auth(perms=["node.view"])
def get_node_pci_devices(cluster_id, node):
    """Get available PCI devices on a node for passthrough"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/nodes/{node}/hardware/pci"
        response = manager._create_session().get(url, timeout=10)

        if response.status_code == 200:
            devices = response.json().get("data", [])
            # Enhance device info with friendly names
            for device in devices:
                device["display_name"] = (
                    f"{device.get('vendor_name', 'Unknown')} {device.get('device_name', device.get('id', 'Unknown'))}"
                )
                device["passthrough_capable"] = device.get("iommugroup", -1) >= 0
            # lgtm[py/reflected-xss]
            return jsonify(devices)
        # lgtm[py/reflected-xss]
        return jsonify([])
    except Exception as e:
        logging.error(f"Error getting PCI devices: {e}")
        return _api_error("Failed to get PCI devices", status=500)


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/hardware/usb", methods=["GET"])
@require_auth(perms=["node.view"])
def get_node_usb_devices(cluster_id, node):
    """Get available USB devices on a node for passthrough"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/nodes/{node}/hardware/usb"
        response = manager._create_session().get(url, timeout=10)

        if response.status_code == 200:
            devices = response.json().get("data", [])
            # Add display name
            for device in devices:
                vendor = device.get("manufacturer", device.get("vendid", "Unknown"))
                product = device.get("product", device.get("prodid", "Unknown"))
                device["display_name"] = f"{vendor} - {product}"
            # lgtm[py/reflected-xss]
            return jsonify(devices)
        # lgtm[py/reflected-xss]
        return jsonify([])
    except Exception as e:
        logging.error(f"Error getting USB devices: {e}")
        return _api_error("Failed to get USB devices", status=500)


# Recover the QEMU --args after the user changed disk bus type
# (scsi0 → sata0 etc.) via the Proxmox UI. The static sector-size args we wrote
# at V2P-migration time reference the original bus, so QEMU refuses to start
# ("there is no device 'scsi0' defined"). This endpoint reads the current VM
# config, regenerates the matching -set device.<bus><idx>.{logical,physical}_block_size
# from the actual disk attachments, and writes them back via `qm set --args`.
# No node-side artifacts (deliberately not a hookscript), one-shot recovery.
@bp.route("/api/clusters/<cluster_id>/vms/<node>/qemu/<int:vmid>/fix-args", methods=["POST"])
@require_auth(perms=["vm.config"])
def fix_vm_qemu_args(cluster_id, node, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", "qemu")
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()
    try:
        from ProxmoxVEx.core.v2p import _rebuild_sector_args

        changed, new_args, problem = _rebuild_sector_args(manager, node, vmid)
        if problem:
            # lgtm[py/reflected-xss]
            return jsonify({
                "ok": False,
                "error": problem,
                "args": new_args,
            }), 400  # snyk:ignore:Cross-site Scripting (XSS)
        log_audit(
            request.session.get("user", "admin"),
            "vm.fix_args",
            f"vmid={vmid} node={node} cluster={cluster_id} changed={changed}",
        )
        # lgtm[py/reflected-xss]
        return jsonify({
            "ok": True,
            "changed": changed,
            "args": new_args,
            "message": "args updated" if changed else "args already match current disks",
        })
    except Exception:
        logging.exception("Failed to get VM RRD data")
        return jsonify({
            "ok": False,
            "error": "An internal error occurred",
        }), 500


@bp.route("/api/clusters/<cluster_id>/vms/<node>/qemu/<int:vmid>/passthrough", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_vm_passthrough_devices(cluster_id, node, vmid):
    """Get current passthrough devices configured for a VM"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.view", "qemu")
    if denied:
        # lgtm[py/reflected-xss]
        return denied

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/nodes/{node}/qemu/{vmid}/config"
        r = manager._create_session().get(url, timeout=10)

        if r.status_code != 200:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "Failed: VM config"}), 500

        config = r.json().get("data", {})

        # extract passthrough devices
        passthrough = {"pci": [], "usb": [], "serial": []}

        for key, value in config.items():
            # PCI devices
            if key.startswith("hostpci"):
                slot = key.replace("hostpci", "")
                passthrough["pci"].append({
                    "slot": slot,
                    "key": key,
                    "value": value,
                    "parsed": _parse_pci_config(value),
                })

            # USB devices
            if key.startswith("usb") and key[3:].isdigit():
                slot = key.replace("usb", "")
                passthrough["usb"].append({
                    "slot": slot,
                    "key": key,
                    "value": value,
                    "parsed": _parse_usb_config(value),
                })

            # Serial ports
            if key.startswith("serial"):
                slot = key.replace("serial", "")
                passthrough["serial"].append({"slot": slot, "key": key, "value": value})

        # lgtm[py/reflected-xss]
        return jsonify(passthrough)
    except Exception:
        return _api_error("Failed to get passthrough devices", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/qemu/<int:vmid>/passthrough/pci", methods=["POST"])
@require_auth(perms=["vm.config"])
def add_pci_passthrough(cluster_id, node, vmid):
    """Add a PCI device passthrough to a VM"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", "qemu")
    if denied:
        # lgtm[py/reflected-xss]
        return denied

    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    data = request.json or {}
    device_id = data.get("device_id")

    if not device_id:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "device_id required"}), 400

    try:
        host, port = manager.host, manager.api_port

        # Find next available hostpci slot
        config_url = f"https://{host}:{port}/api2/json/nodes/{node}/qemu/{vmid}/config"
        config_response = manager._create_session().get(config_url, timeout=10)
        config = config_response.json().get("data", {}) if config_response.status_code == 200 else {}

        # Find free slot (0-15)
        used_slots = [int(k.replace("hostpci", "")) for k in config if k.startswith("hostpci")]
        next_slot = 0
        while next_slot in used_slots and next_slot < 16:
            next_slot += 1

        if next_slot >= 16:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "No free PCI slots available"}), 400

        # Build PCI passthrough config
        pci_config = device_id
        if data.get("pcie"):
            pci_config += ",pcie=1"
        if data.get("rombar") is False:
            pci_config += ",rombar=0"
        if data.get("x-vga"):
            pci_config += ",x-vga=1"

        # Update VM config
        update_url = f"https://{host}:{port}/api2/json/nodes/{node}/qemu/{vmid}/config"
        update_data = {f"hostpci{next_slot}": pci_config}
        response = manager._create_session().put(update_url, data=update_data, timeout=15)

        if response.status_code == 200:
            user = getattr(request, "session", {}).get("user", "system")
            log_audit(
                user,
                "vm.pci_added",
                f"VM {vmid}: Added PCI device {device_id} at slot {next_slot}",
                cluster=manager.config.name,
            )
            # lgtm[py/reflected-xss]
            return jsonify({"message": f"PCI device added at hostpci{next_slot}", "slot": next_slot})
        else:
            # lgtm[py/reflected-xss]
            return _pve_error(response, 500)

    except Exception as e:
        logging.error(f"Error adding PCI passthrough: {e}")
        return _api_error("Failed to add PCI passthrough", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/qemu/<int:vmid>/passthrough/usb", methods=["POST"])
@require_auth(perms=["vm.config"])
def add_usb_passthrough(cluster_id, node, vmid):
    """Add a USB device passthrough to a VM"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", "qemu")
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    data = request.json or {}

    # USB can be specified by vendor:product ID or by host bus/port
    vendor_id = data.get("vendorid")
    product_id = data.get("productid")
    host_bus = data.get("hostbus")
    host_port = data.get("hostport")

    if not ((vendor_id and product_id) or (host_bus and host_port)):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Either vendorid+productid or hostbus+hostport required"}), 400

    try:
        host, port = manager.host, manager.api_port

        # Find next available usb slot
        config_url = f"https://{host}:{port}/api2/json/nodes/{node}/qemu/{vmid}/config"
        config_response = manager._create_session().get(config_url, timeout=10)
        config = config_response.json().get("data", {}) if config_response.status_code == 200 else {}

        # Find free slot (0-4)
        used_slots = [int(k.replace("usb", "")) for k in config if k.startswith("usb") and k[3:].isdigit()]
        next_slot = 0
        while next_slot in used_slots and next_slot < 5:
            next_slot += 1

        if next_slot >= 5:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "No free USB slots available (max 5)"}), 400

        # Build USB config
        usb_config = f"host={vendor_id}:{product_id}" if vendor_id and product_id else f"host={host_bus}-{host_port}"

        if data.get("usb3"):
            usb_config += ",usb3=1"

        # Update VM config
        update_url = f"https://{host}:{port}/api2/json/nodes/{node}/qemu/{vmid}/config"
        update_data = {f"usb{next_slot}": usb_config}
        response = manager._create_session().put(update_url, data=update_data, timeout=15)

        if response.status_code == 200:
            user = getattr(request, "session", {}).get("user", "system")
            log_audit(
                user, "vm.usb_added", f"VM {vmid}: Added USB device at slot {next_slot}", cluster=manager.config.name
            )
            # lgtm[py/reflected-xss]
            return jsonify({"message": f"USB device added at usb{next_slot}", "slot": next_slot})
        else:
            # lgtm[py/reflected-xss]
            return _pve_error(response, 500)

    except Exception as e:
        logging.error(f"Error adding USB passthrough: {e}")
        return _api_error("Failed to add USB passthrough", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/qemu/<int:vmid>/passthrough/serial", methods=["POST"])
@require_auth(perms=["vm.config"])
def add_serial_port(cluster_id, node, vmid):
    """Add a serial port to a VM"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", "qemu")
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    data = request.json or {}
    serial_type = data.get("type", "socket")  # socket, pty, or /dev/xxx

    try:
        host, port = manager.host, manager.api_port

        # Find next available serial slot
        config_url = f"https://{host}:{port}/api2/json/nodes/{node}/qemu/{vmid}/config"
        config_response = manager._create_session().get(config_url, timeout=10)
        config = config_response.json().get("data", {}) if config_response.status_code == 200 else {}

        # Find free slot (0-3)
        used_slots = [int(k.replace("serial", "")) for k in config if k.startswith("serial")]
        next_slot = 0
        while next_slot in used_slots and next_slot < 4:
            next_slot += 1

        if next_slot >= 4:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "No free serial slots available (max 4)"}), 400

        # Update VM config
        update_url = f"https://{host}:{port}/api2/json/nodes/{node}/qemu/{vmid}/config"
        update_data = {f"serial{next_slot}": serial_type}
        response = manager._create_session().put(update_url, data=update_data, timeout=15)

        if response.status_code == 200:
            user = getattr(request, "session", {}).get("user", "system")
            log_audit(
                user,
                "vm.serial_added",
                f"VM {vmid}: Added serial port at slot {next_slot}",
                cluster=manager.config.name,
            )
            # lgtm[py/reflected-xss]
            return jsonify({"message": f"Serial port added at serial{next_slot}", "slot": next_slot})
        else:
            # lgtm[py/reflected-xss]
            return _pve_error(response, 500)

    except Exception as e:
        logging.error(f"Error adding serial port: {e}")
        return _api_error("Failed to add serial port", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/qemu/<int:vmid>/passthrough/<device_type>/<key>", methods=["DELETE"])
@require_auth(perms=["vm.config"])
def remove_passthrough_device(cluster_id, node, vmid, device_type, key):
    """Remove a passthrough device from a VM"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", "qemu")
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    manager, _ = get_connected_manager(cluster_id)
    if not manager:
        if cluster_id not in cluster_managers:
            return _cluster_not_found()
        return _cluster_not_connected()

    # Validate device type and key
    valid_prefixes = {"pci": "hostpci", "usb": "usb", "serial": "serial"}
    if device_type not in valid_prefixes:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Invalid device type"}), 400

    # Key should be like hostpci0, usb1, serial0
    expected_prefix = valid_prefixes[device_type]
    if not key.startswith(expected_prefix):
        # lgtm[py/reflected-xss]
        return jsonify({"error": f"Invalid key for {html.escape(str(device_type))}"}), 400

    try:
        host, port = manager.host, manager.api_port

        # Delete by setting to empty/delete
        update_url = f"https://{host}:{port}/api2/json/nodes/{node}/qemu/{vmid}/config"
        update_data = {"delete": key}
        response = manager._create_session().put(update_url, data=update_data, timeout=15)

        if response.status_code == 200:
            user = getattr(request, "session", {}).get("user", "system")
            log_audit(user, f"vm.{device_type}_removed", f"VM {vmid}: Removed {key}", cluster=manager.config.name)
            # lgtm[py/reflected-xss]
            return jsonify({"message": f"Device {key} removed"})
        else:
            # lgtm[py/reflected-xss]
            return _pve_error(response, 500)

    except Exception as e:
        logging.error(f"Error removing passthrough device: {e}")
        return _api_error("Failed to remove passthrough device", status=500)


def _parse_pci_config(config_str):
    """Parse PCI passthrough config string"""
    result = {"device": None, "options": {}}
    if not config_str:
        # lgtm[py/reflected-xss]
        return jsonify(result)

    parts = config_str.split(",")
    result["device"] = parts[0]

    for part in parts[1:]:
        if "=" in part:
            key, value = part.split("=", 1)
            result["options"][key] = value

    # lgtm[py/reflected-xss]
    return jsonify(result)


def _parse_usb_config(config_str):
    """Parse USB passthrough config string"""
    result = {"host": None, "options": {}}
    if not config_str:
        # lgtm[py/reflected-xss]
        return jsonify(result)

    parts = config_str.split(",")
    for part in parts:
        if "=" in part:
            key, value = part.split("=", 1)
            if key == "host":
                result["host"] = value
            else:
                result["options"][key] = value

    # lgtm[py/reflected-xss]
    return jsonify(result)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/resize", methods=["PUT"])
@require_auth(perms=["vm.config"])
def resize_vm_disk_api(cluster_id, node, vm_type, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    denied = _require_vm_access(cluster_id, vmid, "vm.config", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied

    manager = cluster_managers[cluster_id]
    data = request.json or {}
    disk = data.get("disk")
    size = data.get("size")

    if not disk or not size:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "disk and size required"}), 400

    result = manager.resize_vm_disk(node, vmid, vm_type, disk, size)

    if result["success"]:
        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(
            user,
            "vm.disk_resized",
            f"{vm_type.upper()} {vmid} disk {disk} resized to {size}",
            cluster=manager.config.name,
        )
        # lgtm[py/reflected-xss]
        return jsonify({"message": result["message"]})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/storage", methods=["GET"])
@require_auth(perms=["storage.view"])
def get_storage_list_api(cluster_id, node):
    """Get available storage on a node"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    storage = manager.get_storage_list(node)
    # lgtm[py/reflected-xss]
    return jsonify(storage)


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/networks", methods=["GET"])
@require_auth(perms=["node.view"])
def get_network_list_api(cluster_id, node):
    """Get available networks on a node"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    networks = manager.get_network_list(node)
    # lgtm[py/reflected-xss]
    return jsonify(networks)


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/isos", methods=["GET"])
@require_auth(perms=["storage.view"])
def get_iso_list_api(cluster_id, node):
    """Get available ISO images on a node"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    storage = request.args.get("storage")
    isos = manager.get_iso_list(node, storage)
    # lgtm[py/reflected-xss]
    return jsonify(isos)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/disks", methods=["POST"])
@require_auth(perms=["vm.config"])
def add_disk_api(cluster_id, node, vm_type, vmid):
    """Add a disk to VM or container"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    disk_config = request.json or {}

    result = manager.add_disk(node, vmid, vm_type, disk_config)

    if result["success"]:
        # Broadcast VM config change via SSE for live UI updates
        try:
            updated_config = manager.get_vm_config(node, vmid, vm_type)
            if updated_config.get("success"):
                broadcast_sse(
                    "vm_config",
                    {"vmid": vmid, "node": node, "vm_type": vm_type, "config": updated_config.get("config", {})},
                    cluster_id,
                )
        except Exception as e:
            logging.debug(f"Failed to broadcast vm_config SSE: {e}")

        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(
            user,
            "vm.disk_added",
            f"{vm_type.upper()} {vmid} - disk added: {disk_config.get('size', 'unknown')}GB on {disk_config.get('storage', 'default')}",
            cluster=manager.config.name,
        )
        # lgtm[py/reflected-xss]
        return jsonify({"message": result["message"]})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/disks/<disk_id>", methods=["DELETE"])
@require_auth(perms=["vm.config"])
def remove_disk_api(cluster_id, node, vm_type, vmid, disk_id):
    """Remove disk from VM - boot order cleanup is now handled in remove_disk method"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    delete_data = request.args.get("delete_data", "false").lower() == "true"

    result = manager.remove_disk(node, vmid, vm_type, disk_id, delete_data)

    if result["success"]:
        # Broadcast VM config change via SSE for live UI updates
        try:
            updated_config = manager.get_vm_config(node, vmid, vm_type)
            if updated_config.get("success"):
                broadcast_sse(
                    "vm_config",
                    {"vmid": vmid, "node": node, "vm_type": vm_type, "config": updated_config.get("config", {})},
                    cluster_id,
                )
        except Exception as e:
            logging.debug(f"Failed to broadcast vm_config SSE: {e}")

        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(
            user,
            "vm.disk_removed",
            f"{vm_type.upper()} {vmid} - disk {disk_id} removed" + (" (data deleted)" if delete_data else ""),
            cluster=manager.config.name,
        )
        # lgtm[py/reflected-xss]
        return jsonify({"message": result["message"]})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/disks/<disk_id>/move", methods=["POST"])
@require_auth(perms=["vm.config"])
def move_disk_api(cluster_id, node, vm_type, vmid, disk_id):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    denied = _require_vm_access(cluster_id, vmid, "vm.config", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied

    manager = cluster_managers[cluster_id]
    data = request.json or {}
    target_storage = data.get("storage")
    delete_original = data.get("delete", True)

    if not target_storage:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Target storage required"}), 400

    result = manager.move_disk(node, vmid, vm_type, disk_id, target_storage, delete_original)

    if result["success"]:
        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(
            user,
            "vm.disk_moved",
            f"{vm_type.upper()} {vmid} - disk {disk_id} moved to {target_storage}",
            cluster=manager.config.name,
        )

        # Register ProxmoxVEx user for this task
        upid = result.get("task") or result.get("upid")
        if upid:
            register_task_user(upid, user, cluster_id)

        # lgtm[py/reflected-xss]
        return jsonify({"message": result["message"], "task": result.get("task")})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/vms/<node>/qemu/<int:vmid>/cdrom", methods=["PUT"])
@require_auth(perms=["vm.config"])
def set_cdrom_api(cluster_id, node, vmid):
    """Set or eject CD-ROM"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", "qemu")
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    data = request.json or {}
    iso_path = data.get("iso")  # None to eject
    drive = data.get("drive", "ide2")

    result = manager.set_cdrom(node, vmid, iso_path, drive)

    if result["success"]:
        # Broadcast VM config change via SSE for live UI updates
        try:
            updated_config = manager.get_vm_config(node, vmid, "qemu")
            if updated_config.get("success"):
                broadcast_sse(
                    "vm_config",
                    {"vmid": vmid, "node": node, "vm_type": "qemu", "config": updated_config.get("config", {})},
                    cluster_id,
                )
        except Exception as e:
            logging.debug(f"Failed to broadcast vm_config SSE: {e}")

        # lgtm[py/reflected-xss]
        return jsonify({"message": result["message"]})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/networks", methods=["POST"])
@require_auth(perms=["vm.config"])
def add_network_api(cluster_id, node, vm_type, vmid):
    """Add a network interface"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    net_config = request.json or {}

    result = manager.add_network(node, vmid, vm_type, net_config)

    if result["success"]:
        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(
            user,
            "vm.network_added",
            f"{vm_type.upper()} {vmid} - network added: bridge={net_config.get('bridge', 'default')}",
            cluster=manager.config.name,
        )
        # lgtm[py/reflected-xss]
        return jsonify({"message": result["message"]})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/networks/<net_id>", methods=["PUT"])
@require_auth(perms=["vm.config"])
def update_network_api(cluster_id, node, vm_type, vmid, net_id):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    net_config = request.json or {}

    result = manager.update_network(node, vmid, vm_type, net_id, net_config)

    if result["success"]:
        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(
            user,
            "vm.network_updated",
            f"{vm_type.upper()} {vmid} - network {net_id} updated",
            cluster=manager.config.name,
        )
        # lgtm[py/reflected-xss]
        return jsonify({"message": result["message"]})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/networks/<net_id>", methods=["DELETE"])
@require_auth(perms=["vm.config"])
def remove_network_api(cluster_id, node, vm_type, vmid, net_id):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]

    result = manager.remove_network(node, vmid, vm_type, net_id)

    if result["success"]:
        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(
            user,
            "vm.network_removed",
            f"{vm_type.upper()} {vmid} - network {net_id} removed",
            cluster=manager.config.name,
        )
        # lgtm[py/reflected-xss]
        return jsonify({"message": result["message"]})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/networks/<net_id>/link", methods=["PUT"])
@require_auth(perms=["vm.config"])
def toggle_network_link_api(cluster_id, node, vm_type, vmid, net_id):
    """Toggle network link_down state - simulates cable unplug

    This is a hot-pluggable operation for QEMU VMs (no reboot needed)
    Very useful for testing network failover scenarios
    """
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.config", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    # Only QEMU supports link_down toggle
    if vm_type != "qemu":
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Network disconnect only supported for QEMU VMs"}), 400

    manager = cluster_managers[cluster_id]
    data = request.json or {}
    link_down = data.get("link_down", False)

    result = manager.toggle_network_link(node, vmid, net_id, link_down)

    if result["success"]:
        user = getattr(request, "session", {}).get("user", "system")
        action = "disconnected" if link_down else "connected"
        log_audit(
            user, "vm.network_link_toggle", f"QEMU {vmid} - network {net_id} {action}", cluster=manager.config.name
        )
        # lgtm[py/reflected-xss]
        return jsonify({"message": result["message"]})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


# ==================== SNAPSHOT API ROUTES ====================


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/snapshot-capability", methods=["GET"])
@require_auth(perms=["vm.view"])
def check_snapshot_capability_api(cluster_id, node, vm_type, vmid):
    """Check if VM/CT can create snapshots and why not"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    result = manager.check_snapshot_capability(node, vmid, vm_type)
    # lgtm[py/reflected-xss]
    return jsonify(result)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/snapshots", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_snapshots_api(cluster_id, node, vm_type, vmid):
    """Get list of snapshots for a VM/CT"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied

    manager = cluster_managers[cluster_id]
    snapshots = manager.get_snapshots(node, vmid, vm_type)
    # lgtm[py/reflected-xss]
    return jsonify(snapshots)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/snapshots", methods=["POST"])
@require_auth(perms=["vm.snapshot"])
def create_snapshot_api(cluster_id, node, vm_type, vmid):
    # tenant check
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    # Check pool permission for vm.snapshot
    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    if not user_can_access_vm(user, cluster_id, vmid, "vm.snapshot", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.snapshot"}), 403

    mgr = cluster_managers[cluster_id]
    data = request.json or {}

    snapname = data.get("snapname", f"snap_{int(time.time())}")
    description = data.get("description", "")
    vmstate = data.get("vmstate", False)

    result = mgr.create_snapshot(node, vmid, vm_type, snapname, description, vmstate)

    if result["success"]:
        usr = getattr(request, "session", {}).get("user", "system")
        log_audit(
            usr,
            "snapshot.created",
            f"{vm_type.upper()} {vmid} - snapshot '{snapname}' created" + (" (with RAM)" if vmstate else ""),
            cluster=mgr.config.name,
        )
        # lgtm[py/reflected-xss]
        return jsonify({"message": f"Snapshot {snapname} erstellt", "task": result.get("task")})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/snapshots/<snapname>", methods=["DELETE"])
@require_auth(perms=["vm.snapshot"])
def delete_snapshot_api(cluster_id, node, vm_type, vmid, snapname):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    # Check pool permission for vm.snapshot
    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    if not user_can_access_vm(user, cluster_id, vmid, "vm.snapshot", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.snapshot"}), 403

    mgr = cluster_managers[cluster_id]
    result = mgr.delete_snapshot(node, vmid, vm_type, snapname)

    if result["success"]:
        usr = getattr(request, "session", {}).get("user", "system")
        log_audit(
            usr,
            "snapshot.deleted",
            f"{vm_type.upper()} {vmid} - snapshot '{snapname}' deleted",
            cluster=mgr.config.name,
        )
        # lgtm[py/reflected-xss]
        return jsonify({"message": "Snapshot deleted", "task": result.get("task")})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/snapshots/<snapname>/rollback", methods=["POST"])
@require_auth(perms=["vm.snapshot"])
def rollback_snapshot_api(cluster_id, node, vm_type, vmid, snapname):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    # Check pool permission for vm.snapshot
    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    if not user_can_access_vm(user, cluster_id, vmid, "vm.snapshot", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.snapshot"}), 403

    mgr = cluster_managers[cluster_id]
    result = mgr.rollback_snapshot(node, vmid, vm_type, snapname)

    if result["success"]:
        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(
            user,
            "snapshot.restored",
            f"{vm_type.upper()} {vmid} - rolled back to snapshot '{snapname}'",
            cluster=mgr.config.name,
        )
        # lgtm[py/reflected-xss]
        return jsonify({"message": f"Rollback zu {snapname} gestartet", "task": result.get("task")})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


# Snapshot config + diff endpoints. Backs the Snapshot Comparison
# UI: pick two snapshots of the same VM, see config-level diff.
@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/snapshots/<snapname>/config", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_snapshot_config_api(cluster_id, node, vm_type, vmid, snapname):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    mgr = cluster_managers[cluster_id]
    if not mgr.is_connected:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster offline"}), 503
    if vm_type not in ("qemu", "lxc"):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Invalid vm_type"}), 400
    try:
        url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{vm_type}/{vmid}/snapshot/{snapname}/config"
        r = mgr._api_get(url)
        if r is None or r.status_code != 200:
            # lgtm[py/reflected-xss]
            # snyk:ignore:Cross-site Scripting (XSS)
            return jsonify({
                "error": f"Failed to fetch snapshot config (status {getattr(r, 'status_code', '?')})"
            }), 502  # snyk:ignore:Cross-site Scripting (XSS)
        # lgtm[py/reflected-xss]
        return jsonify(r.json().get("data", {}) or {})
    except Exception:
        return _api_error("Failed to get snapshot config", status=500)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/snapshots/diff", methods=["GET"])
@require_auth(perms=["vm.view"])
def diff_snapshots_api(cluster_id, node, vm_type, vmid):
    """Compare two snapshot configs. Query: ?a=<snapA>&b=<snapB>"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    denied = _require_vm_access(cluster_id, vmid, "vm.view", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404
    a = (request.args.get("a") or "").strip()
    b = (request.args.get("b") or "").strip()
    if not a or not b:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Both ?a and ?b query params are required"}), 400
    # disallow path-traversal-ish stuff
    for s in (a, b):
        if "/" in s or "\x00" in s or len(s) > 64:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "Invalid snapshot name"}), 400

    mgr = cluster_managers[cluster_id]
    if not mgr.is_connected:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster offline"}), 503
    if vm_type not in ("qemu", "lxc"):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Invalid vm_type"}), 400

    def _fetch(snap):
        # 'current' is a synthetic name in PVE — request via ?current=1 endpoint
        if snap.lower() == "current":
            url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{vm_type}/{vmid}/config?current=1"
        else:
            url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{vm_type}/{vmid}/snapshot/{snap}/config"
        r = mgr._api_get(url)
        if r is None or r.status_code != 200:
            # lgtm[py/reflected-xss]
            return None, f"fetch failed for {snap} (status {getattr(r, 'status_code', '?')})"
        # lgtm[py/reflected-xss]
        return r.json().get("data") or {}, None

    cfg_a, err_a = _fetch(a)
    if err_a:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": err_a
        }), 502  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure
    cfg_b, err_b = _fetch(b)
    if err_b:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": err_b
        }), 502  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure

    keys = sorted(set(cfg_a.keys()) | set(cfg_b.keys()))
    diffs = []
    for k in keys:
        va = cfg_a.get(k)
        vb = cfg_b.get(k)
        if va == vb:
            kind = "same"
        elif k not in cfg_a:
            kind = "added"
        elif k not in cfg_b:
            kind = "removed"
        else:
            kind = "changed"
        diffs.append({"key": k, "a": va, "b": vb, "kind": kind})

    summary = {
        "added": sum(1 for d in diffs if d["kind"] == "added"),
        "removed": sum(1 for d in diffs if d["kind"] == "removed"),
        "changed": sum(1 for d in diffs if d["kind"] == "changed"),
        "same": sum(1 for d in diffs if d["kind"] == "same"),
    }
    # lgtm[py/reflected-xss]
    return jsonify({
        "a": a,
        "b": b,
        "config_a": cfg_a,
        "config_b": cfg_b,
        "diffs": diffs,
        "summary": summary,
    })


# ==================== EFFICIENT (LVM COW) SNAPSHOT API ====================
# Space-efficient snapshot endpoints


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/efficient-snapshots", methods=["GET"])
@require_auth(perms=["vm.snapshot"])
def get_efficient_snapshots_api(cluster_id, node, vm_type, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    if not user_can_access_vm(user, cluster_id, vmid, "vm.snapshot", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.snapshot"}), 403

    mgr = cluster_managers[cluster_id]
    refresh = request.args.get("refresh", "false").lower() == "true"
    snapshots = mgr.get_efficient_snapshots(cluster_id, vmid, refresh_usage=refresh)
    # lgtm[py/reflected-xss]
    return jsonify(snapshots)


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/efficient-snapshots", methods=["POST"])
@require_auth(perms=["vm.snapshot"])
def create_efficient_snapshot_api(cluster_id, node, vm_type, vmid):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    if not user_can_access_vm(user, cluster_id, vmid, "vm.snapshot", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.snapshot"}), 403

    mgr = cluster_managers[cluster_id]
    data = request.json or {}

    snapname = data.get("snapname", f"snap_{int(time.time())}")
    description = data.get("description", "")
    snap_size_gb = data.get("snap_size_gb")

    result = mgr.create_efficient_snapshot(node, vmid, vm_type, snapname, description, snap_size_gb)

    if result["success"]:
        usr = getattr(request, "session", {}).get("user", "system")
        savings = result.get("space_savings", {})
        log_audit(
            usr,
            "snapshot.efficient_created",
            f"{vm_type.upper()} {vmid} - efficient snapshot '{snapname}' created "
            f"({savings.get('efficient_size_gb', 0):.1f} GB vs {savings.get('normal_size_gb', 0):.1f} GB normal, "
            f"{savings.get('savings_percent', 0)}% savings)",
            cluster=mgr.config.name,
        )
        # lgtm[py/reflected-xss]
        return jsonify({
            "message": f"Platzsparender Snapshot {snapname} erstellt",
            "snap_id": result["snap_id"],
            "space_savings": result["space_savings"],
        })
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route(
    "/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/efficient-snapshots/<snap_id>", methods=["DELETE"]
)
@require_auth(perms=["vm.snapshot"])
def delete_efficient_snapshot_api(cluster_id, node, vm_type, vmid, snap_id):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    if not user_can_access_vm(user, cluster_id, vmid, "vm.snapshot", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.snapshot"}), 403

    mgr = cluster_managers[cluster_id]
    result = mgr.delete_efficient_snapshot(node, vmid, snap_id)

    if result["success"]:
        usr = getattr(request, "session", {}).get("user", "system")
        log_audit(
            usr,
            "snapshot.efficient_deleted",
            f"{vm_type.upper()} {vmid} - efficient snapshot deleted",
            cluster=mgr.config.name,
        )
        # lgtm[py/reflected-xss]
        return jsonify({"message": "Platzsparender Snapshot gelöscht"})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route(
    "/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/efficient-snapshots/<snap_id>/rollback",
    methods=["POST"],
)
@require_auth(perms=["vm.snapshot"])
def rollback_efficient_snapshot_api(cluster_id, node, vm_type, vmid, snap_id):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    if not user_can_access_vm(user, cluster_id, vmid, "vm.snapshot", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.snapshot"}), 403

    mgr = cluster_managers[cluster_id]
    result = mgr.rollback_efficient_snapshot(node, vmid, vm_type, snap_id)

    if result["success"]:
        usr = getattr(request, "session", {}).get("user", "system")
        log_audit(
            usr,
            "snapshot.efficient_rollback",
            f"{vm_type.upper()} {vmid} - efficient snapshot rollback started",
            cluster=mgr.config.name,
        )
        # lgtm[py/reflected-xss]
        return jsonify({"message": result.get("message", "Rollback gestartet")})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


# ==================== SNAPSHOT OVERVIEW API ====================


@bp.route("/api/snapshots/overview", methods=["GET", "POST"])
@require_auth(perms=["vm.view"])
def snapshots_overview():
    """Get overview of old snapshots across all clusters or a specific cluster

    Returns snapshots older than specified date, sorted by age

    Added cluster_id filter - when provided, only shows snapshots from that cluster
    """
    from ProxmoxVEx.utils.concurrent import run_concurrent

    user = request.session.get("user", "")
    users_db = load_users()
    user_data = users_db.get(user, {})
    user_data["username"] = user
    data = request.get_json(silent=True) or {}
    # Don't filter by date unless user explicitly sets one - old default hid today's snapshots
    date_filter = data.get("date")
    filter_limit = data.get("limit", 200)
    filter_cluster = data.get("cluster_id")
    is_admin = user_data.get("role") == ROLE_ADMIN
    user_clusters = user_data.get("clusters", [])

    cutoff_date = None
    if date_filter:
        with contextlib.suppress(ValueError):
            cutoff_date = datetime.strptime(date_filter, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    all_vms = []
    for cluster_id, mgr in cluster_managers.items():
        if not mgr.is_connected:
            continue
        if filter_cluster and cluster_id != filter_cluster:
            continue
        if not is_admin and user_clusters and cluster_id not in user_clusters:
            continue
        try:
            for r in mgr.get_vm_resources():
                vmid = r.get("vmid")
                node = r.get("node")
                if vmid and node:
                    all_vms.append((cluster_id, node, vmid, r.get("name", ""), r.get("type", "qemu")))
        except Exception as e:
            logging.warning(f"[Snapshots] Failed to list VMs for {cluster_id}: {e}")

    # Fetch snapshots in parallel instead of sequential - huge speedup
    def _fetch_snap(args):
        cid, node, vmid, vm_name, vm_type = args
        try:
            mgr = cluster_managers.get(cid)
            if not mgr:
                # lgtm[py/reflected-xss]
                return []
            raw = mgr.get_snapshots(node, vmid, vm_type)
            results = []
            now = datetime.now(timezone.utc)
            for snap in raw:
                snap_name = snap.get("name")
                snap_ts = snap.get("snaptime")
                if not snap_name or not snap_ts or snap_name == "current":
                    continue
                snap_dt = datetime.fromtimestamp(snap_ts, tz=timezone.utc)
                if cutoff_date and snap_dt >= cutoff_date:
                    continue
                age_s = int((now - snap_dt).total_seconds())
                age = (
                    f"{age_s // 60} min"
                    if age_s < 3600
                    else f"{age_s // 3600} h"
                    if age_s < 86400
                    else f"{age_s // 86400} days"
                )
                results.append({
                    "vmid": vmid,
                    "vm_name": vm_name,
                    "vm_type": vm_type,
                    "node": node,
                    "snapshot_name": snap_name,
                    "snapshot_date": snap_dt.strftime("%Y-%m-%d %H:%M"),
                    "age": age,
                    "cluster_id": cid,
                })
            # lgtm[py/reflected-xss]
            return results
        except Exception as _e:
            # lgtm[py/reflected-xss]
            return []

    tasks = [lambda a=vm: _fetch_snap(a) for vm in all_vms]
    parallel_results = run_concurrent(tasks, timeout=25.0)

    snapshots = []
    for batch in parallel_results:
        if batch:
            snapshots.extend(batch)

    snapshots.sort(key=lambda s: s["snapshot_date"], reverse=False)
    snapshots = snapshots[:filter_limit]

    # lgtm[py/reflected-xss]
    return jsonify({"snapshots": snapshots})


@bp.route("/api/snapshots/delete", methods=["POST"])
@require_auth(perms=["vm.view", "vm.snapshot"])
def snapshots_overview_delete():
    """Delete multiple snapshots at once

    Bulk delete for snapshot cleanup
    """
    user = request.session.get("user", "")
    users_db = load_users()
    user_data = users_db.get(user, {})
    user_data["username"] = user
    data = request.get_json(silent=True) or {}
    snapshots = data.get("snapshots", [])
    is_admin = user_data.get("role") == ROLE_ADMIN
    user_clusters = user_data.get("clusters", [])

    deleted_count = 0
    errors = []
    result = {"success": False}

    for snapshot in snapshots:
        try:
            cluster_id = snapshot.get("cluster_id")
            node = snapshot.get("node")
            vmid = snapshot.get("vmid")
            snapname = snapshot.get("snapshot_name")
            vm_type = snapshot.get("vm_type", "qemu")

            if cluster_id not in cluster_managers:
                errors.append(f"Cluster {cluster_id} not found")
                continue

            mgr = cluster_managers[cluster_id]

            if not mgr.is_connected:
                errors.append(f"Cluster {cluster_id} not connected")
                continue

            if not is_admin and user_clusters and cluster_id not in user_clusters:
                errors.append(f"No access to cluster {cluster_id}")
                continue

            # VM-level ACL check for snapshot delete
            if not user_can_access_vm(user_data, cluster_id, vmid, "vm.snapshot", vm_type):
                errors.append(f"Permission denied: vm.snapshot for VM {vmid}")
                continue

            result = mgr.delete_snapshot(node, vmid, vm_type, snapname)

            if result.get("success"):
                deleted_count += 1
                log_audit(
                    user,
                    "snapshot.deleted",
                    f"{vm_type.upper()} {vmid} - snapshot '{snapname}' deleted",
                    cluster=mgr.config.name,
                )
            else:
                errors.append(f"Failed to delete {snapname}: {result.get('error', 'Unknown error')}")

        except Exception as e:
            errors.append("Error deleting snapshot")
            logging.debug(f"Snapshot deletion failed: {e}")

    if deleted_count > 0:
        # lgtm[py/reflected-xss]
        return jsonify({
            "success": True,
            "message": f"{deleted_count} snapshot(s) deleted",
            "deleted": deleted_count,
            "errors": errors if errors else None,
        })
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "success": False,
            "error": "No snapshots deleted",
            "errors": errors,
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


# ==================== REPLICATION API ROUTES ====================


@bp.route("/api/clusters/<cluster_id>/replication", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_replication_jobs_api(cluster_id):
    """Get all replication jobs"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    vmid = request.args.get("vmid", type=int)
    jobs = manager.get_replication_jobs(vmid)
    # lgtm[py/reflected-xss]
    return jsonify(jobs)


@bp.route("/api/clusters/<cluster_id>/replication", methods=["POST"])
@require_auth(perms=["cluster.config"])
def create_replication_job_api(cluster_id):
    """Create a replication job"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    data = request.json or {}

    vmid = data.get("vmid")
    target_node = data.get("target")
    schedule = data.get("schedule", "*/15")
    rate = data.get("rate")
    comment = data.get("comment", "")

    if not vmid or not target_node:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "vmid and target are required"}), 400

    result = manager.create_replication_job(vmid, target_node, schedule, rate, comment)

    if result["success"]:
        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(
            user,
            "replication.created",
            f"VM {vmid} replication to {target_node} (schedule: {schedule})",
            cluster=manager.config.name,
        )
        # lgtm[py/reflected-xss]
        return jsonify({"message": "Replication Job erstellt", "job_id": result.get("job_id")})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/replication/<job_id>", methods=["DELETE"])
@require_auth(perms=["cluster.config"])
def delete_replication_job_api(cluster_id, job_id):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    data = request.json or {}
    keep = data.get("keep", False)
    force = data.get("force", False)

    result = manager.delete_replication_job(job_id, keep, force)

    if result["success"]:
        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(user, "replication.deleted", f"Replication job {job_id} deleted", cluster=manager.config.name)
        # lgtm[py/reflected-xss]
        return jsonify({"message": "Replication Job deleted"})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/replication/<job_id>/run", methods=["POST"])
@require_auth(perms=["cluster.config"])
def run_replication_now_api(cluster_id, job_id):
    """Trigger immediate replication"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    result = manager.run_replication_now(job_id)

    if result["success"]:
        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(
            user, "replication.triggered", f"Replication job {job_id} manually triggered", cluster=manager.config.name
        )
        # lgtm[py/reflected-xss]
        return jsonify({"message": "Replication gestartet"})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result["error"]
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


# ==================== CROSS-CLUSTER REPLICATION ====================
# Same-cluster snapshot replication for non-ZFS storage
# Proxmox native replication needs ZFS, this works with any storage backend
# Flow: snapshot -> clone to target storage -> migrate clone to target node -> cleanup
def _safe_vnc_passthrough(port_raw, ticket_raw):
    """#352 single-vncproxy passthrough: the browser hands back the port+ticket of
    the vncproxy IT opened so noVNC's RFB password matches. Validate before those
    values steer a wss:// authority / Cookie (sec-review): port must be a plain
    1-65535 integer, ticket a single-line opaque token. (ok, int_port)."""
    try:
        p = int(str(port_raw).strip())
    except (TypeError, ValueError):
        # lgtm[py/reflected-xss]
        return (False, None)
    if not (1 <= p <= 65535):
        # lgtm[py/reflected-xss]
        return (False, None)
    t = str(ticket_raw or "")
    if not t or len(t) > 4096 or any(c in t for c in "\r\n\x00"):
        # lgtm[py/reflected-xss]
        return (False, None)
    # lgtm[py/reflected-xss]
    return (True, p)


def _resolve_vm_node(mgr, vmid, vm_type="qemu"):
    """Authoritatively locate which node a VMID lives on by probing each node's
    status endpoint directly. /cluster/resources is fed by pmxcfs and lags by
    several seconds — right after a migrate it can still point at the old node,
    which is fatal for a destructive op (we'd delete the wrong/empty side and
    leave the real replica behind). Returns (node, info_dict) or (None, None).
    (#552)."""
    try:
        nresp = mgr._api_get(f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes")
        nodes = [n.get("node") for n in nresp.json().get("data", [])] if nresp.status_code == 200 else []
    except Exception as _e:
        nodes = []
    for node in nodes:
        if not node:
            continue
        try:
            r = mgr._api_get(
                f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{vm_type}/{vmid}/status/current"
            )
            if r.status_code == 200:
                info = r.json().get("data", {}) or {}
                info["node"] = node
                # lgtm[py/reflected-xss]
                return (node, info)
        except Exception as _e:
            continue
    # lgtm[py/reflected-xss]
    return (None, None)


def _free_local_target_vmid(mgr, tgt_vmid, src_vmid, vm_type, target_node):
    """For a pinned local-replication target VMID: if a VM already sits on it,
    remove it ONLY when it is EXACTLY this job's prior replica — the name ProxmoxVEx
    writes is `repl-<src>-<target_node>` (clone_label), so match that exactly rather
    than a loose prefix. Refuse to touch anything else so we never clobber an
    unrelated VM. Returns (ok, error_message). #552 (exact-match hardening sec-review)
    """
    try:
        node, existing = _resolve_vm_node(mgr, tgt_vmid, vm_type)
        if not existing:
            # lgtm[py/reflected-xss]
            return (True, "")  # free, go ahead

        vname = existing.get("name", "") or ""
        if vname != f"repl-{src_vmid}-{target_node}":
            # lgtm[py/reflected-xss]
            return (
                False,
                (
                    f'Target VMID {tgt_vmid} is in use by "{vname or "unknown"}" which is not a '
                    f"replica of VM {src_vmid}. Pick a free VMID or remove that VM first."
                ),
            )

        # it's our old replica — stop (if running) and delete
        if existing.get("status") == "running":
            try:
                mgr._api_post(
                    f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{vm_type}/{tgt_vmid}/status/stop",
                    data={},
                )
                time.sleep(5)
            except Exception as _e:
                pass
        del_resp = mgr._api_delete(
            f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{vm_type}/{tgt_vmid}",
            params={"purge": 1, "destroy-unreferenced-disks": 1},
        )
        if del_resp.status_code != 200:
            # lgtm[py/reflected-xss]
            return (False, f"Could not remove old replica {tgt_vmid}: {del_resp.text[:200]}")
        del_task = del_resp.json().get("data")
        if del_task:
            ok, detail = _wait_for_task(mgr, del_task, timeout=600)
            if not ok:
                # lgtm[py/reflected-xss]
                return (False, f"Delete of old replica {tgt_vmid} failed: {detail}")
        logging.info(f"[REPL] Freed pinned target VMID {tgt_vmid} (old replica '{vname}' removed)")
        # lgtm[py/reflected-xss]
        return (True, "")
    except Exception:
        logging.exception("Error freeing target VMID %s", tgt_vmid)
        # lgtm[py/reflected-xss]
        return (False, f"Error freeing target VMID {tgt_vmid}")


def _execute_local_replication(job):
    """Run snapshot-based replication within the same cluster (no ZFS needed)."""
    db = get_db()
    job_id = job["id"]
    vmid = int(job["vmid"])
    vm_type = job.get("vm_type", "qemu") or "qemu"
    cluster_id = job["source_cluster"]
    target_node = job.get("target_node", "")
    target_storage = job.get("target_storage", "") or "local-lvm"

    mgr = cluster_managers.get(cluster_id)
    if not mgr:
        _update_repl_status(db, job_id, "error", "Cluster not found")
        return

    if not mgr.is_connected:
        _update_repl_status(db, job_id, "error", "Cluster not connected")
        return

    snap_name = f"repl-{job_id}-{int(time.time())}"
    clone_vmid = None
    source_node = None

    try:
        # 1. find source node
        res = mgr._api_get(f"https://{mgr.host}:{mgr.api_port}/api2/json/cluster/resources", params={"type": "vm"})
        if res.status_code == 200:
            for r in res.json().get("data", []):
                if int(r.get("vmid", 0)) == vmid:
                    source_node = r.get("node")
                    break

        if not source_node:
            _update_repl_status(db, job_id, "error", f"VM {vmid} not found")
            return

        if not target_node:
            _update_repl_status(db, job_id, "error", "No target node configured")
            return

        logging.info(f"[REPL] Job {job_id}: replicating {vm_type}/{vmid} from {source_node} to {target_node}")

        # 2. create snapshot
        snap_url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{source_node}/{vm_type}/{vmid}/snapshot"
        snap_resp = mgr._api_post(
            snap_url, data={"snapname": snap_name, "description": f"Snapshot replication {job_id}"}
        )
        if snap_resp.status_code != 200:
            _update_repl_status(db, job_id, "error", f"Snapshot failed: {snap_resp.text}")
            return

        snap_task = snap_resp.json().get("data")
        snap_ok, snap_detail = _wait_for_task(mgr, snap_task)
        if not snap_ok:
            _update_repl_status(db, job_id, "error", f"Snapshot failed: {snap_detail}")
            return

        # 3. pick the replica VMID
        # #552 - if the operator pinned a target VMID, reuse it every run (so the
        # replica keeps a stable ID) instead of leaking a fresh nextid each time.
        # A pinned ID means last run's replica is sitting on it -> clear it first,
        # but only if it's actually one of ours (name-matched, never a foreign VM).
        tgt_vmid = int(job.get("target_vmid") or 0)
        if tgt_vmid:
            freed, free_err = _free_local_target_vmid(mgr, tgt_vmid, vmid, vm_type, target_node)
            if not freed:
                _cleanup_snapshot(mgr, source_node, vmid, vm_type, snap_name)
                _update_repl_status(db, job_id, "error", free_err)
                return
            clone_vmid = tgt_vmid
        else:
            nextid_resp = mgr._api_get(f"https://{mgr.host}:{mgr.api_port}/api2/json/cluster/nextid")
            if nextid_resp.status_code != 200:
                _cleanup_snapshot(mgr, source_node, vmid, vm_type, snap_name)
                _update_repl_status(db, job_id, "error", "Could not get next VMID")
                return
            clone_vmid = int(nextid_resp.json().get("data"))

        # 4. clone — check storage type for snapshot compatibility (#192)
        clone_url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{source_node}/{vm_type}/{vmid}/clone"
        # Verified against PVE storage plugins (copy+snap feature matrix)
        # rbd DOES support snap clone. lvm only supports qcow2 snap clone (VMs are raw).
        # zfs (iSCSI) and zfspool (local) both lack snap support. LXC uses rsync, not affected.
        _no_snap_clone_types = {"zfspool", "zfs", "lvm", "iscsi", "iscsidirect"}
        use_snap_clone = True
        try:
            stor_resp = mgr._api_get(f"https://{mgr.host}:{mgr.api_port}/api2/json/storage")
            if stor_resp.status_code == 200:
                stor_types = {s["storage"]: s.get("type", "") for s in stor_resp.json().get("data", [])}
                vm_stor = mgr._get_vm_storage(source_node, vmid, vm_type)
                if vm_type == "qemu" and vm_stor and stor_types.get(vm_stor) in _no_snap_clone_types:
                    use_snap_clone = False
                    logging.info(f"[REPL] Storage '{vm_stor}' is {stor_types.get(vm_stor)} — direct clone (#192)")
        except Exception as _e:
            pass

        # (#448) - same hostname-vs-name fix as the xcrepl path.
        clone_data = {
            "newid": clone_vmid,
            "full": 1,
        }
        clone_label = f"repl-{vmid}-{target_node}"
        if vm_type == "lxc":
            clone_data["hostname"] = clone_label
        else:
            clone_data["name"] = clone_label
        if use_snap_clone:
            clone_data["snapname"] = snap_name
        if target_storage:
            clone_data["storage"] = target_storage

        clone_resp = mgr._api_post(clone_url, data=clone_data)
        if clone_resp.status_code != 200:
            _cleanup_snapshot(mgr, source_node, vmid, vm_type, snap_name)
            _update_repl_status(db, job_id, "error", f"Clone failed: {clone_resp.text}")
            return

        clone_task = clone_resp.json().get("data")
        clone_ok, clone_detail = _wait_for_task(mgr, clone_task, timeout=1800)
        if not clone_ok:
            _cleanup_snapshot(mgr, source_node, vmid, vm_type, snap_name)
            _update_repl_status(db, job_id, "error", f"Clone failed: {clone_detail}")
            return

        logging.info(f"[REPL] Job {job_id}: clone {clone_vmid} created")

        # 5. migrate clone to target node (if on different node)
        if source_node != target_node:
            mig_result = mgr.migrate_vm_manual(
                node=source_node,
                vmid=clone_vmid,
                vm_type=vm_type,
                target_node=target_node,
                online=False,
                options={"targetstorage": target_storage} if target_storage else {},
            )
            if not mig_result.get("success"):
                # cleanup clone + snap
                _cleanup_clone_and_snap(mgr, source_node, clone_vmid, vmid, vm_type, snap_name)
                _update_repl_status(db, job_id, "error", f"Migration failed: {mig_result.get('error')}")
                return

            mig_task = mig_result.get("task")
            if mig_task:
                mig_ok, mig_detail = _wait_for_task(mgr, mig_task, timeout=3600)
                if not mig_ok:
                    _cleanup_clone_and_snap(mgr, source_node, clone_vmid, vmid, vm_type, snap_name)
                    _update_repl_status(db, job_id, "error", f"Migration failed: {mig_detail}")
                    return

        logging.info(f"[REPL] Job {job_id}: clone migrated to {target_node}")

        # 6. delete old replica if exists, rename new one
        # check for previous replica VMs with name pattern repl-{vmid}-{target_node}
        try:
            all_vms = mgr._api_get(
                f"https://{mgr.host}:{mgr.api_port}/api2/json/cluster/resources", params={"type": "vm"}
            )
            if all_vms.status_code == 200:
                for v in all_vms.json().get("data", []):
                    vname = v.get("name", "")
                    vid = int(v.get("vmid", 0))
                    # delete previous replicas but not the one we just created
                    if vname == f"repl-{vmid}-{target_node}" and vid != clone_vmid:
                        old_node = v.get("node", target_node)
                        try:
                            # stop if running
                            if v.get("status") == "running":
                                mgr._api_post(
                                    f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{old_node}/{vm_type}/{vid}/status/stop",
                                    data={},
                                )
                                time.sleep(5)
                            mgr._api_delete(
                                f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{old_node}/{vm_type}/{vid}"
                            )
                            logging.info(f"[REPL] Deleted old replica VM {vid}")
                        except Exception as del_e:
                            logging.warning(f"[REPL] Could not delete old replica {vid}: {del_e}")
        except Exception as _e:
            pass

        # 7. cleanup snapshot on source
        _cleanup_snapshot(mgr, source_node, vmid, vm_type, snap_name)
        _update_repl_status(db, job_id, "ok", "")
        logging.info(f"[REPL] Job {job_id}: replication complete")

    except Exception as e:
        logging.error(f"[REPL] Job {job_id}: error: {e}")
        _update_repl_status(db, job_id, "error", str(e))
        if clone_vmid:
            with contextlib.suppress(Exception):
                _cleanup_clone_and_snap(mgr, source_node, clone_vmid, vmid, vm_type, snap_name)


# Snapshot-based replication between clusters
# Proxmox native replication only works intra-cluster, so for DR across
# separate clusters we use snapshot + clone + remote-migrate approach.

# (#456 @DarmokNoob) - net interface MAC tokens vary by VM type:
# LXC uses `hwaddr=<mac>`, QEMU uses `<model>=<mac>` where model is virtio/e1000/etc.
_QEMU_NIC_MODELS = (
    "virtio",
    "e1000",
    "e1000-82540em",
    "e1000-82544gc",
    "e1000-82545em",
    "e1000e",
    "i82551",
    "i82557b",
    "i82559er",
    "ne2k_isa",
    "ne2k_pci",
    "pcnet",
    "rtl8139",
    "vmxnet3",
)


def _extract_nic_mac(nic_value):
    """Return the MAC from a PVE net interface config string (or None)."""
    if not isinstance(nic_value, str):
        # lgtm[py/reflected-xss]
        return None
    for part in nic_value.split(","):
        if "=" not in part:
            continue
        key, val = part.split("=", 1)
        if key == "hwaddr":
            # lgtm[py/reflected-xss]
            return val
        if key in _QEMU_NIC_MODELS:
            # lgtm[py/reflected-xss]
            return val
    # lgtm[py/reflected-xss]
    return None


def _swap_nic_mac(nic_value, new_mac):
    """Rewrite a PVE net interface config to use new_mac, preserving every other token."""
    if not isinstance(nic_value, str) or not new_mac:
        # lgtm[py/reflected-xss]
        return nic_value
    parts = []
    replaced = False
    for part in nic_value.split(","):
        if "=" not in part:
            parts.append(part)
            continue
        key, val = part.split("=", 1)
        if key == "hwaddr":
            parts.append(f"hwaddr={new_mac}")
            replaced = True
        elif key in _QEMU_NIC_MODELS:
            parts.append(f"{key}={new_mac}")
            replaced = True
        else:
            parts.append(part)
    # lgtm[py/reflected-xss]
    return ",".join(parts) if replaced else nic_value


def _capture_vm_identity(mgr, node, vmid, vm_type):
    """Pull hostname/name + per-NIC MAC from a VM's config so the xcrepl flow can
    restore them on the target replica after clone+migrate destroyed both."""
    out = {"hostname": None, "name": None, "nets": {}}
    try:
        cfg_url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{vm_type}/{vmid}/config"
        resp = mgr._api_get(cfg_url)
        if resp.status_code != 200:
            logging.debug(f"[XCREPL] _capture_vm_identity: GET {cfg_url} -> {resp.status_code}")
            # lgtm[py/reflected-xss]
            return out
        cfg = resp.json().get("data", {})
        if vm_type == "lxc":
            out["hostname"] = cfg.get("hostname")
        else:
            out["name"] = cfg.get("name")
        for k, v in cfg.items():
            if k.startswith("net") and k[3:].isdigit():
                mac = _extract_nic_mac(v)
                if mac:
                    out["nets"][k] = mac
    except Exception as e:
        logging.debug(f"[XCREPL] _capture_vm_identity error: {e}")
    # lgtm[py/reflected-xss]
    return out


def _restore_vm_identity(mgr, node, vmid, vm_type, identity):
    """Apply the source's hostname/name + per-NIC MAC to a freshly-migrated replica.

    Reads the target's current net config so we preserve bridge / firewall / VLAN-tag /
    rate-limit tokens that the migration set — only the MAC token gets swapped back to
    the source value.
    """
    if not identity:
        return
    cfg_url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{vm_type}/{vmid}/config"
    payload = {}

    if vm_type == "lxc" and identity.get("hostname"):
        payload["hostname"] = identity["hostname"]
    elif vm_type == "qemu" and identity.get("name"):
        payload["name"] = identity["name"]

    if identity.get("nets"):
        try:
            cur_resp = mgr._api_get(cfg_url)
            if cur_resp.status_code == 200:
                cur_cfg = cur_resp.json().get("data", {})
                for netname, src_mac in identity["nets"].items():
                    cur_val = cur_cfg.get(netname)
                    if cur_val:
                        rebuilt = _swap_nic_mac(cur_val, src_mac)
                        if rebuilt != cur_val:
                            payload[netname] = rebuilt
        except Exception as e:
            logging.debug(f"[XCREPL] could not read target config for MAC restore: {e}")

    if not payload:
        return

    put_resp = mgr._api_put(cfg_url, data=payload)
    if put_resp.status_code == 200:
        logging.info(
            f"[XCREPL] Restored identity on {vm_type}/{vmid}: "
            f"{'hostname' if vm_type == 'lxc' else 'name'}={payload.get('hostname') or payload.get('name')}, "
            f"{sum(1 for k in payload if k.startswith('net'))} NIC(s) MAC-swapped"
        )
    else:
        logging.warning(f"[XCREPL] Identity PUT returned {put_resp.status_code}: {put_resp.text[:200]}")


# (#413 @blackshocks) - Replica safety gate. The earlier xcrepl flow
# deleted any VM on the target that happened to share the source VMID, on the
# assumption that the VMID-collision had to be a previous run of this same job.
# Real-world scenario: two freshly-paired clusters where the target already had
# an UNRELATED VM at the same VMID — the delete destroyed user data.
#
# Replicas are now tagged with a job-specific marker after a successful migration,
# and the safety gate refuses to delete anything that isn't tagged for THIS job.
# That also prevents cross-job blast: two unrelated xcrepl jobs colliding on the
# same target VMID won't nuke each other's replicas.
ProxmoxVEx_REPLICA_TAG = "ProxmoxVEx-replica"


def _job_tag(job_id):
    # lgtm[py/reflected-xss]
    return f"xcrepl-job-{job_id}"


def _read_target_tags(mgr, node, vmid, vm_type):
    """Return the set of tags on a VM, or None if config fetch failed."""
    try:
        cfg_url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{vm_type}/{vmid}/config"
        resp = mgr._api_get(cfg_url)
        if resp.status_code != 200:
            # lgtm[py/reflected-xss]
            return None
        cfg = resp.json().get("data", {})
        tags_raw = cfg.get("tags", "") or ""
        # PVE separates tags by ';' for both LXC and QEMU.
        # lgtm[py/reflected-xss]
        return {t.strip() for t in tags_raw.split(";") if t.strip()}
    except Exception as _e:
        # lgtm[py/reflected-xss]
        return None


def _is_replica_of_job(mgr, node, vmid, vm_type, job_id):
    """True iff the target VM is tagged as a replica of THIS specific xcrepl job."""
    tags = _read_target_tags(mgr, node, vmid, vm_type)
    if tags is None:
        # lgtm[py/reflected-xss]
        return False
    # lgtm[py/reflected-xss]
    return _job_tag(job_id) in tags


def _tag_as_replica(mgr, node, vmid, vm_type, job_id):
    """Mark the freshly-migrated replica with the job-specific + general
    ProxmoxVEx-replica tags. Preserves any pre-existing tags so users' own
    organisation tags stay intact."""
    cfg_url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{vm_type}/{vmid}/config"
    try:
        resp = mgr._api_get(cfg_url)
        if resp.status_code != 200:
            return
        cfg = resp.json().get("data", {})
        tags_raw = cfg.get("tags", "") or ""
        existing = [t.strip() for t in tags_raw.split(";") if t.strip()]
        want = [ProxmoxVEx_REPLICA_TAG, _job_tag(job_id)]
        merged = list(existing)
        for t in want:
            if t not in merged:
                merged.append(t)
        if merged == existing:
            # lgtm[py/reflected-xss]
            return  # nothing to do
        new_tags = ";".join(merged)
        put = mgr._api_put(cfg_url, data={"tags": new_tags})
        if put.status_code == 200:
            logging.info(f"[XCREPL] Tagged replica {vm_type}/{vmid} on {node} with {want}")
        else:
            logging.warning(f"[XCREPL] tag PUT returned {put.status_code}: {put.text[:200]}")
    except Exception as e:
        logging.warning(f"[XCREPL] Could not tag replica {vmid}: {e}")


def _execute_replication(job):
    """
    Run a single cross-cluster replication cycle for one job.

    Steps: snapshot source VM -> clone from snapshot -> remote-migrate clone
    to target cluster -> cleanup snapshot + clone on source.

    This is basically the same flow as manual cross-cluster migration,
    but we snapshot first so the source VM stays untouched. The clone gets
    migrated and then deleted on the source side.
    """
    db = get_db()
    job_id = job["id"]
    vmid = int(job["vmid"])
    vm_type = job.get("vm_type", "qemu") or "qemu"
    source_cid = job["source_cluster"]
    target_cid = job["target_cluster"]
    target_storage = job.get("target_storage", "") or "local-lvm"
    target_bridge = job.get("target_bridge", "vmbr0") or "vmbr0"
    target_node = job.get("target_node", "")
    # #552 - replica VMID is operator-pinned if set, else mirror the source VMID
    # (PVE remote-migrate still needs an explicit target-vmid either way).
    tgt_vmid = int(job.get("target_vmid") or 0) or vmid

    source_mgr = cluster_managers.get(source_cid)
    target_mgr = cluster_managers.get(target_cid)

    if not source_mgr or not target_mgr:
        _update_repl_status(db, job_id, "error", "Source or target cluster not found")
        return

    if not source_mgr.is_connected or not target_mgr.is_connected:
        _update_repl_status(db, job_id, "error", "Cluster not connected")
        return

    # Auto-detect target node if not configured
    if not target_node:
        try:
            nodes_resp = target_mgr._api_get(f"https://{target_mgr.host}:{target_mgr.api_port}/api2/json/nodes")
            if nodes_resp.status_code == 200:
                for n in nodes_resp.json().get("data", []):
                    if n.get("status") == "online":
                        target_node = n["node"]
                        break
        except Exception as _e:
            pass
        if not target_node:
            _update_repl_status(db, job_id, "error", "No online node found on target cluster")
            return

    snap_name = f"xcrepl-{job_id}-{int(time.time())}"
    clone_vmid = None

    try:
        # 1. find which node the VM lives on
        source_node = None
        resources = source_mgr._api_get(
            f"https://{source_mgr.host}:{source_mgr.api_port}/api2/json/cluster/resources", params={"type": "vm"}
        )
        if resources.status_code == 200:
            for r in resources.json().get("data", []):
                if int(r.get("vmid", 0)) == vmid:
                    source_node = r.get("node")
                    break

        if not source_node:
            _update_repl_status(db, job_id, "error", f"VM {vmid} not found on source cluster")
            return

        logging.info(
            f"[XCREPL] Job {job_id}: replicating {vm_type}/{vmid} from {source_node} -> {target_node} ({target_cid})"
        )

        # (#456 @DarmokNoob) - capture source identity (hostname/name +
        # per-NIC hwaddr) BEFORE the clone overwrites the label and PVE re-rolls the MAC.
        # Replica is supposed to be a drop-in copy of the source for DR — the replica's
        # hostname + DHCP-MAC need to match or Site Recovery failover lands on the wrong
        # network identity.
        source_identity = _capture_vm_identity(source_mgr, source_node, vmid, vm_type)

        # 2. create snapshot
        snap_url = (
            f"https://{source_mgr.host}:{source_mgr.api_port}/api2/json/nodes/{source_node}/{vm_type}/{vmid}/snapshot"
        )
        snap_resp = source_mgr._api_post(
            snap_url, data={"snapname": snap_name, "description": f"Cross-cluster replication {job_id}"}
        )
        if snap_resp.status_code != 200:
            _update_repl_status(db, job_id, "error", f"Snapshot failed: {snap_resp.text}")
            return

        snap_task = snap_resp.json().get("data")
        snap_ok, snap_detail = _wait_for_task(source_mgr, snap_task)
        if not snap_ok:
            _update_repl_status(db, job_id, "error", f"Snapshot failed: {snap_detail}")
            return

        logging.info(f"[XCREPL] Job {job_id}: snapshot '{snap_name}' created")

        # 3. get next free VMID for clone
        nextid_resp = source_mgr._api_get(f"https://{source_mgr.host}:{source_mgr.api_port}/api2/json/cluster/nextid")
        if nextid_resp.status_code != 200:
            _cleanup_snapshot(source_mgr, source_node, vmid, vm_type, snap_name)
            _update_repl_status(db, job_id, "error", "Could not get next VMID")
            return

        clone_vmid = int(nextid_resp.json().get("data"))
        logging.debug(f"[XCREPL] Using clone VMID {clone_vmid}")

        # 4. clone — detect storage type first to choose correct strategy (#192)
        # ZFS and RBD don't support full clone from snapshot, must clone directly
        clone_url = (
            f"https://{source_mgr.host}:{source_mgr.api_port}/api2/json/nodes/{source_node}/{vm_type}/{vmid}/clone"
        )
        # Check if storage supports full clone from snapshot
        # Verified against PVE storage plugins (copy+snap feature matrix)
        # rbd DOES support snap clone. lvm only supports qcow2 snap clone (VMs are raw).
        # zfs (iSCSI) and zfspool (local) both lack snap support. LXC uses rsync, not affected.
        _no_snap_clone_types = {"zfspool", "zfs", "lvm", "iscsi", "iscsidirect"}
        use_snap_clone = True
        try:
            stor_resp = source_mgr._api_get(f"https://{source_mgr.host}:{source_mgr.api_port}/api2/json/storage")
            if stor_resp.status_code == 200:
                stor_types = {s["storage"]: s.get("type", "") for s in stor_resp.json().get("data", [])}
                # get the VM's primary storage
                vm_stor = source_mgr._get_vm_storage(source_node, vmid, vm_type)
                if vm_type == "qemu" and vm_stor and stor_types.get(vm_stor) in _no_snap_clone_types:
                    use_snap_clone = False
                    logging.info(
                        f"[XCREPL] Storage '{vm_stor}' is {stor_types.get(vm_stor)} — using direct clone without snapshot (#192)"
                    )
        except Exception as e:
            logging.debug(f"[XCREPL] Could not detect storage type: {e}")

        # (#448 @DarmokNoob) - PVE clone schema differs by VM type:
        # QEMU (`/qemu/{vmid}/clone`) accepts `name=` for the clone label;
        # LXC  (`/lxc/{vmid}/clone`)  rejects `name=` as "property is not
        # defined in schema" and wants `hostname=` instead. Confirmed via
        # pvesh + curl by the reporter. Earlier this function always sent
        # `name`, so every cross-cluster LXC DR job 400'd at the clone step.
        clone_data = {
            "newid": clone_vmid,
            "full": 1,
        }
        clone_label = f"xcrepl-{vmid}-tmp"
        if vm_type == "lxc":
            clone_data["hostname"] = clone_label
        else:
            clone_data["name"] = clone_label
        if use_snap_clone:
            clone_data["snapname"] = snap_name

        clone_resp = source_mgr._api_post(clone_url, data=clone_data)
        if clone_resp.status_code != 200:
            _cleanup_snapshot(source_mgr, source_node, vmid, vm_type, snap_name)
            _update_repl_status(db, job_id, "error", f"Clone failed: {clone_resp.text}")
            return

        clone_task = clone_resp.json().get("data")
        clone_ok, clone_detail = _wait_for_task(source_mgr, clone_task, timeout=1800)
        if not clone_ok:
            _cleanup_snapshot(source_mgr, source_node, vmid, vm_type, snap_name)
            _update_repl_status(db, job_id, "error", f"Clone failed: {clone_detail}")
            return

        logging.info(f"[XCREPL] Job {job_id}: clone {clone_vmid} created from snapshot")

        # 5. build storage mapping from clone's actual disks -> target storage
        # Mar 2026: PVE remote_migrate needs "source_stor:target_stor" format
        # when source and target storage names differ (#192)
        storage_mapping = target_storage  # fallback: plain name
        try:
            cfg_url = f"https://{source_mgr.host}:{source_mgr.api_port}/api2/json/nodes/{source_node}/{vm_type}/{clone_vmid}/config"
            cfg_resp = source_mgr._api_get(cfg_url)
            if cfg_resp.status_code == 200:
                clone_cfg = cfg_resp.json().get("data", {})
                source_storages = set()
                for k, v in clone_cfg.items():
                    if (
                        k.startswith(("scsi", "virtio", "ide", "sata", "efidisk", "tpmstate", "rootfs", "mp"))
                        and isinstance(v, str)
                        and ":" in v
                    ):
                        stor = v.split(":")[0]
                        if stor and stor != "none":
                            source_storages.add(stor)
                if source_storages:
                    # map each source storage to the target
                    mappings = [f"{s}:{target_storage}" for s in source_storages]
                    storage_mapping = ",".join(mappings)
                    logging.info(f"[XCREPL] Job {job_id}: storage mapping: {storage_mapping}")
        except Exception as e:
            logging.warning(f"[XCREPL] Job {job_id}: could not build storage mapping, using plain: {e}")

        # remote-migrate clone to target cluster
        # same token/fingerprint flow as cross_cluster_lb.py
        token_name = f"xcrepl-{job_id}-{int(time.time()) % 100000}"
        token = target_mgr.create_api_token(token_name)
        if not token.get("success"):
            _cleanup_clone_and_snap(source_mgr, source_node, clone_vmid, vmid, vm_type, snap_name)
            _update_repl_status(db, job_id, "error", f"Token creation failed: {token.get('error')}")
            return

        try:
            fp = target_mgr.get_cluster_fingerprint()
            if not fp.get("success"):
                target_mgr.delete_api_token(token_name)
                _cleanup_clone_and_snap(source_mgr, source_node, clone_vmid, vmid, vm_type, snap_name)
                _update_repl_status(db, job_id, "error", f"Fingerprint failed: {fp.get('error')}")
                return

            endpoint = (
                f"apitoken=PVEAPIToken={token['token_id']}={token['token_value']},"
                f"host={fp['host']},fingerprint={fp['fingerprint']}"
            )

            # Apr 2026: #321 - second+ replication run fails because VM exists on target.
            # A replication job's whole point is to REPLACE the old copy, so remove it here
            # before remote_migrate tries to create-from-empty (which errors on existing VMID).
            existing_target_node = None
            try:
                tgt_res = target_mgr._api_get(
                    f"https://{target_mgr.host}:{target_mgr.api_port}/api2/json/cluster/resources",
                    params={"type": "vm"},
                )
                if tgt_res.status_code == 200:
                    for r in tgt_res.json().get("data", []):
                        if int(r.get("vmid", 0)) == tgt_vmid:
                            existing_target_node = r.get("node")
                            break
            except Exception as e:
                logging.warning(f"[XCREPL] Job {job_id}: target existence check failed: {e}")

            if existing_target_node:
                # (#413 @blackshocks) - refuse to delete unless the existing
                # target VM is tagged as a replica of THIS job. Without this gate, freshly
                # paired clusters with an unrelated VM at the matching VMID lose data.
                if not _is_replica_of_job(target_mgr, existing_target_node, tgt_vmid, vm_type, job_id):
                    target_mgr.delete_api_token(token_name)
                    _cleanup_clone_and_snap(source_mgr, source_node, clone_vmid, vmid, vm_type, snap_name)
                    err_msg = (
                        f"Target VM {tgt_vmid} on node {existing_target_node} is not tagged as a replica "
                        f"of this job ({_job_tag(job_id)} tag missing). Refusing to overwrite to "
                        f"prevent data loss. If this is a stranded replica from a previous run or "
                        f"manual clone, tag it with `{_job_tag(job_id)}` and re-run. If it is an "
                        f"unrelated VM, pick a different target VMID for the job."
                    )
                    _update_repl_status(db, job_id, "error", err_msg)
                    logging.error(f"[XCREPL] Job {job_id}: ABORT — {err_msg}")
                    return

                logging.info(
                    f"[XCREPL] Job {job_id}: VM {tgt_vmid} already on target node {existing_target_node}, removing old replica (tag verified)"
                )
                try:
                    # stop first so PVE lets us delete it (ignore errors if already stopped)
                    stop_url = (
                        f"https://{target_mgr.host}:{target_mgr.api_port}/api2/json/nodes/{existing_target_node}"
                        f"/{vm_type}/{tgt_vmid}/status/stop"
                    )
                    try:
                        stop_resp = target_mgr._api_post(stop_url, data={})
                        if stop_resp.status_code == 200:
                            stop_task = stop_resp.json().get("data")
                            if stop_task:
                                _wait_for_task(target_mgr, stop_task, timeout=60)
                    except Exception as _e:
                        pass

                    # delete the VM and its disks (purge removes replication jobs, destroy removes unreferenced disks)
                    del_url = (
                        f"https://{target_mgr.host}:{target_mgr.api_port}/api2/json/nodes/{existing_target_node}"
                        f"/{vm_type}/{tgt_vmid}"
                    )
                    del_resp = target_mgr._api_delete(del_url, params={"purge": 1, "destroy-unreferenced-disks": 1})
                    if del_resp.status_code == 200:
                        del_task = del_resp.json().get("data")
                        if del_task:
                            del_ok, del_detail = _wait_for_task(target_mgr, del_task, timeout=600)
                            if not del_ok:
                                raise RuntimeError(f"delete task failed: {del_detail}")
                        logging.info(f"[XCREPL] Job {job_id}: old replica {tgt_vmid} removed from target")
                    else:
                        raise RuntimeError(f"delete request failed: {del_resp.status_code} {del_resp.text[:200]}")
                except Exception as e:
                    logging.error(f"[XCREPL] Job {job_id}: could not remove old replica: {e}")
                    target_mgr.delete_api_token(token_name)
                    _cleanup_clone_and_snap(source_mgr, source_node, clone_vmid, vmid, vm_type, snap_name)
                    _update_repl_status(db, job_id, "error", f"Could not remove old replica on target: {e}")
                    return

            # migrate the clone (offline, delete source clone after)
            result = source_mgr.remote_migrate_vm(
                node=source_node,
                vmid=clone_vmid,
                vm_type=vm_type,
                target_endpoint=endpoint,
                target_storage=storage_mapping,
                target_bridge=target_bridge,
                target_vmid=tgt_vmid,
                online=False,
                delete_source=True,
            )

            if result.get("success"):
                mig_task = result.get("task")
                mig_ok, mig_detail = _wait_for_task(source_mgr, mig_task, timeout=3600)
                if mig_ok:
                    logging.info(f"[XCREPL] Job {job_id}: migration complete")
                    # (#456) - restore source identity on the replica so
                    # DR failover lands on the right hostname + DHCP-MAC. Best-effort
                    # don't fail the whole replication if this trips.
                    try:
                        _restore_vm_identity(target_mgr, target_node, tgt_vmid, vm_type, source_identity)
                    except Exception as e:
                        logging.warning(f"[XCREPL] Job {job_id}: identity restoration failed: {e}")
                    # (#413) - tag the replica so the safety gate on the next
                    # run recognises it as ours and can cycle it without operator action.
                    try:
                        _tag_as_replica(target_mgr, target_node, tgt_vmid, vm_type, job_id)
                    except Exception as e:
                        logging.warning(f"[XCREPL] Job {job_id}: replica-tag write failed: {e}")
                    _update_repl_status(db, job_id, "ok", "")
                else:
                    logging.error(f"[XCREPL] Job {job_id}: migration task failed: {mig_detail}")
                    _update_repl_status(db, job_id, "error", f"Migration task failed: {mig_detail}")
            else:
                _update_repl_status(db, job_id, "error", f"Migration failed: {result.get('error')}")

        except Exception as e:
            logging.error(f"[XCREPL] Job {job_id}: migration error: {e}")
            _update_repl_status(db, job_id, "error", str(e))
        finally:
            # always clean up token
            with contextlib.suppress(Exception):
                target_mgr.delete_api_token(token_name)

        # 6. cleanup snapshot on source (clone auto-deleted by delete_source=True)
        _cleanup_snapshot(source_mgr, source_node, vmid, vm_type, snap_name)

        # Handle retention - delete oldest replicas on target if over limit
        retention = int(job.get("retention", 3) or 3)
        _enforce_retention(target_mgr, tgt_vmid, vm_type, snap_name, retention)

    except Exception as e:
        logging.error(f"[XCREPL] Job {job_id}: unexpected error: {e}")
        _update_repl_status(db, job_id, "error", str(e))
        # best-effort cleanup
        if clone_vmid:
            with contextlib.suppress(Exception):
                _cleanup_clone_and_snap(source_mgr, source_node, clone_vmid, vmid, vm_type, snap_name)


def _update_repl_status(db, job_id, status, error=""):
    """Update job status in DB after a replication run."""
    try:
        db.execute(
            "UPDATE cross_cluster_replications SET last_run = ?, last_status = ?, last_error = ?, updated_at = ? WHERE id = ?",
            (datetime.now().isoformat(), status, error or "", datetime.now().isoformat(), job_id),
        )
    except Exception as e:
        logging.warning(f"[XCREPL] Could not update status for {job_id}: {e}")
    # (audit completeness) - emit terminal audit event so the bundle's
    # audit_log captures the outcome of every xcrepl run, not just `replication.triggered`.
    # Mirrors the gap that surfaced via #438 on the v2p side: started-only audit forces
    # log archaeology on every silent-failure investigation.
    try:
        if status == "ok":
            log_audit("system", "replication.completed", f"xcrepl job {job_id} succeeded")
        elif status == "error":
            log_audit("system", "replication.failed", f"xcrepl job {job_id} failed: {error or 'no detail'}")
    except Exception as _e:
        pass


def _wait_for_task(mgr, task_upid, timeout=600, poll=5):
    """Poll Proxmox task status until it finishes or times out.
    Similar to the cleanup thread logic but blocking.
    Returns (success: bool, detail: str) — detail has PVE status or error info.
    """
    if not task_upid:
        # lgtm[py/reflected-xss]
        return (False, "no task UPID")
    elapsed = 0
    while elapsed < timeout:
        try:
            tasks = mgr.get_tasks(limit=100)
            for t in tasks:
                if t and t.get("upid") == task_upid:
                    st = t.get("status", "")
                    if st and st != "running":
                        ok = st in ("OK", "WARNINGS")
                        detail = st if ok else (t.get("exitstatus") or st)
                        # lgtm[py/reflected-xss]
                        return (ok, detail)
                    break
        except Exception as _e:
            pass
        time.sleep(poll)
        elapsed += poll
    # lgtm[py/reflected-xss]
    return (False, f"timed out after {timeout}s")


def _cleanup_snapshot(mgr, node, vmid, vm_type, snap_name):
    """Delete a snapshot, best-effort, with NFS/ESTALE recovery.

    (#422 depedro-ai): On NetApp / NFS qcow2 storage, the underlying
    `qemu-img snapshot -d` can fail with ESTALE ("Stale file handle") even
    though PVE issued the DELETE successfully. When that happens, PVE leaves
    the VM in `lock = snapshot-delete` state and refuses *all* subsequent
    operations (shutdown, migrate, failover) with "VM is locked
    (snapshot-delete)" — which is exactly the silent-failure depedro-ai hit.

    Fix: always pass `force=1` so PVE removes the snapshot config entry even
    if the on-disk delete fails. Then, if the VM is still locked afterwards
    (defence in depth), explicitly unlock via the PVE API. xcrepl snapshots
    are ours from end to end — operator never cares about the orphan .qcow2
    internal slot that may be left on storage; what matters is the VM gets
    out of the locked state cleanly.
    """
    url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{vm_type}/{vmid}/snapshot/{snap_name}"
    try:
        # `force=1` tells PVE: remove config entry even if qemu-img delete fails.
        # Without it, NFS ESTALE → VM stuck at lock=snapshot-delete indefinitely.
        mgr._api_delete(url, params={"force": 1})
        logging.debug(f"[XCREPL] Deleted snapshot {snap_name} on {vmid} (force=1)")
    except Exception as e:
        logging.warning(f"[XCREPL] Could not delete snapshot {snap_name}: {e}")

    # Defence in depth: explicitly check + clear the lock if still set.
    # `qm unlock` via the API is `POST /nodes/<node>/<type>/<vmid>/status/current`
    # with `lock=` body — actually no, that's setting. The right one is the
    # config endpoint with `delete=lock`. Use that.
    try:
        cfg_url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{vm_type}/{vmid}/config"
        cfg_resp = mgr._api_get(cfg_url)
        if cfg_resp is not None and cfg_resp.status_code == 200:
            cfg = (cfg_resp.json() or {}).get("data", {}) or {}
            current_lock = cfg.get("lock")
            if current_lock == "snapshot-delete":
                logging.warning(
                    f"[XCREPL] VM {vmid} still locked at 'snapshot-delete' after cleanup — "
                    f"clearing lock so subsequent operations don't silently fail (#422)"
                )
                # PUT /config with delete=lock removes the lock field
                from ProxmoxVEx.utils.audit import log_audit

                try:
                    mgr._api_put(cfg_url, data={"delete": "lock"})
                    log_audit(
                        user="system",
                        action="vm.unlock_after_xcrepl",
                        details=f"vmid={vmid} lock=snapshot-delete cleared after cross-cluster replication cleanup",
                        ip_address="127.0.0.1",
                    )
                except Exception as unlock_err:
                    logging.warning(f"[XCREPL] Could not auto-unlock VM {vmid}: {unlock_err}")
    except Exception as e:
        logging.debug(f"[XCREPL] Lock-state recheck on {vmid} failed (non-fatal): {e}")


def _cleanup_clone_and_snap(mgr, node, clone_vmid, orig_vmid, vm_type, snap_name):
    """Remove leftover clone VM + snapshot after failure."""
    # delete clone
    try:
        url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{vm_type}/{clone_vmid}"
        mgr._api_delete(url)
    except Exception as _e:
        pass
    # delete snapshot
    _cleanup_snapshot(mgr, node, orig_vmid, vm_type, snap_name)


def _enforce_retention(target_mgr, vmid, vm_type, current_snap, retention):
    """
    Remove old xcrepl snapshots on target if we exceed retention count.
    We only manage snapshots we created (prefixed with 'xcrepl-').
    """
    try:
        # find the target node for this VM
        resources = target_mgr._api_get(
            f"https://{target_mgr.host}:{target_mgr.api_port}/api2/json/cluster/resources", params={"type": "vm"}
        )
        if resources.status_code != 200:
            return

        target_node = None
        for r in resources.json().get("data", []):
            if int(r.get("vmid", 0)) == vmid:
                target_node = r.get("node")
                break
        if not target_node:
            return

        snap_url = (
            f"https://{target_mgr.host}:{target_mgr.api_port}/api2/json/nodes/{target_node}/{vm_type}/{vmid}/snapshot"
        )
        snap_resp = target_mgr._api_get(snap_url)
        if snap_resp.status_code != 200:
            return

        xcrepl_snaps = [
            s
            for s in snap_resp.json().get("data", [])
            if s.get("name", "").startswith("xcrepl-") and s.get("name") != "current"
        ]
        # sort by name (contains timestamp) so oldest first
        xcrepl_snaps.sort(key=lambda s: s.get("name", ""))

        while len(xcrepl_snaps) > retention:
            oldest = xcrepl_snaps.pop(0)
            try:
                del_url = (
                    f"https://{target_mgr.host}:{target_mgr.api_port}/api2/json/nodes/{target_node}"
                    f"/{vm_type}/{vmid}/snapshot/{oldest['name']}"
                )
                target_mgr._api_delete(del_url)
                logging.info(f"[XCREPL] Retention: deleted old snapshot {oldest['name']} on target")
            except Exception as e:
                logging.warning(f"[XCREPL] Retention cleanup failed for {oldest['name']}: {e}")
    except Exception as e:
        logging.debug(f"[XCREPL] Retention check skipped: {e}")


@bp.route("/api/cross-cluster-replications", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_cross_cluster_replications():
    """List cross-cluster replication jobs, optionally filtered by vmid."""
    db = get_db()
    vmid = request.args.get("vmid", type=int)

    if vmid:
        rows = db.query("SELECT * FROM cross_cluster_replications WHERE vmid = ?", (vmid,))
    else:
        rows = db.query("SELECT * FROM cross_cluster_replications")

    # (sec-review) - don't expose other tenants' job rows (ids, clusters,
    # target VMIDs). Filter to clusters the caller can actually reach; admins/untenanted
    # users get None (= everything), unchanged.
    from ProxmoxVEx.utils.rbac import get_user_clusters

    user = getattr(g, "current_user", None)
    if user is None:
        user = db.get_user(request.session.get("user", "")) or {}
    allowed = get_user_clusters(user)
    out = []
    for r in rows:
        d = dict(r)
        if allowed is None or d.get("source_cluster") in allowed or d.get("target_cluster") in allowed:
            out.append(d)
    # lgtm[py/reflected-xss]
    return jsonify(out)


@bp.route("/api/cross-cluster-replications", methods=["POST"])
@require_auth(perms=["cluster.config"])
def create_cross_cluster_replication():
    """Create a new cross-cluster replication job."""
    data = request.json or {}

    source_cluster = data.get("source_cluster")
    target_cluster = data.get("target_cluster")
    vmid = data.get("vmid")

    if not source_cluster or not target_cluster or not vmid:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "source_cluster, target_cluster and vmid are required"}), 400

    if source_cluster not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Source cluster not found"}), 404
    if target_cluster not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Target cluster not found"}), 404

    # (sec-review) - cluster.config is a GLOBAL perm; the tenant/ACL
    # boundary in this codebase is check_cluster_access. The cross-cluster MIGRATION
    # endpoint gates both sides, so replication (which can overwrite/destroy a VM on
    # the target) must too — else a tenant-scoped operator could drive a job into a
    # cluster they don't own.
    for _cid in (source_cluster, target_cluster):
        ok, err = check_cluster_access(_cid)
        if not ok:
            return _access_denied()

    # Same-cluster snapshot replication for non-ZFS (Issue
    # target_node required when source == target cluster
    target_node = data.get("target_node", "")
    if source_cluster == target_cluster and not target_node:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "target_node is required for same-cluster replication"}), 400

    job_id = str(uuid.uuid4())[:8]
    now = datetime.now().isoformat()
    db = get_db()

    # MatthieuTr #532 — per-NIC bridge mapping. PVE's target-bridge takes a
    # "src:tgt,src:tgt" list, so a multi-NIC VM keeps each card on its own
    # destination bridge (same encoding the cross-cluster migration endpoint uses).
    # Validate every iface name (defence-in-depth) so nothing smuggles extra map
    # entries / commas into the PVE target-bridge param.
    def _ok_iface(n):
        # lgtm[py/reflected-xss]
        return isinstance(n, str) and 1 <= len(n) <= 32 and n[0].isalpha() and all(c.isalnum() or c in "_.-" for c in n)

    bridge_map = data.get("target_bridge_map")
    if isinstance(bridge_map, dict) and bridge_map:
        if len(bridge_map) > 64:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "target_bridge_map has too many entries"}), 400
        if not all(_ok_iface(s) and _ok_iface(t) for s, t in bridge_map.items()):
            # lgtm[py/reflected-xss]
            return jsonify({"error": "target_bridge_map contains an invalid bridge name"}), 400
        target_bridge = ",".join(f"{s}:{t}" for s, t in bridge_map.items())
    else:
        target_bridge = data.get("target_bridge", "vmbr0") or "vmbr0"
        if not _ok_iface(target_bridge):
            # lgtm[py/reflected-xss]
            return jsonify({"error": "invalid target_bridge"}), 400

    # helppp #552 — optional fixed replica VMID (NULL = let PVE pick at run time).
    # Parse defensively: garbage must 400, not crash the route with a 500.
    tv = data.get("target_vmid")
    if tv in (None, "", 0, "0"):
        target_vmid = None
    else:
        try:
            target_vmid = int(tv)
        except (TypeError, ValueError):
            # lgtm[py/reflected-xss]
            return jsonify({"error": "target_vmid must be an integer"}), 400
        if not (100 <= target_vmid <= 999999999):
            # lgtm[py/reflected-xss]
            return jsonify({"error": "target_vmid out of range (100–999999999)"}), 400
    delete_target = 1 if data.get("delete_target") else 0

    db.execute(
        """
        INSERT INTO cross_cluster_replications
        (id, source_cluster, target_cluster, vmid, vm_type, schedule, retention,
         target_storage, target_bridge, target_node, target_vmid, delete_target,
         enabled, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    """,
        (
            job_id,
            source_cluster,
            target_cluster,
            int(vmid),
            data.get("vm_type", "qemu"),
            data.get("schedule", "0 */6 * * *"),
            int(data.get("retention", 3)),
            data.get("target_storage", ""),
            target_bridge,
            target_node,
            target_vmid,
            delete_target,
            getattr(request, "session", {}).get("user", "system"),
            now,
            now,
        ),
    )

    usr = getattr(request, "session", {}).get("user", "system")
    log_audit(
        usr,
        "replication.created",
        f"Cross-cluster replication {job_id}: VM {vmid} from {source_cluster} to {target_cluster} "
        f"(target VMID {target_vmid or 'auto'}{', delete-target ON' if delete_target else ''})",
    )

    # lgtm[py/reflected-xss]
    return jsonify({"success": True, "id": job_id})


def _delete_replica_target(job):
    """#552 - tear down the replica VM for a job. Only removes a VM we can prove
    is this job's replica (xcrepl: job-tag; local: repl-<src>- name prefix), so a
    mis-set target VMID never nukes a bystander. Returns (ok, detail)."""
    src_vmid = int(job["vmid"])
    tgt_vmid = int(job.get("target_vmid") or 0) or src_vmid
    vm_type = job.get("vm_type", "qemu") or "qemu"
    job_id = job["id"]
    is_local = job.get("source_cluster") == job.get("target_cluster")
    mgr = cluster_managers.get(job.get("target_cluster"))
    if not mgr:
        # lgtm[py/reflected-xss]
        return (False, "target cluster not found")
    if not mgr.is_connected:
        # lgtm[py/reflected-xss]
        return (False, "target cluster not connected")
    try:
        # authoritative node lookup — cluster/resources lags after a migrate (#552)
        node, found = _resolve_vm_node(mgr, tgt_vmid, vm_type)
        if not found:
            # lgtm[py/reflected-xss]
            return (True, "replica not present")
        # ownership check — never delete a VM that isn't provably ours.
        # local: EXACT replica name repl-<src>-<target_node> (not a loose prefix);
        # xcrepl: the job-specific replica tag.
        if is_local:
            vname = found.get("name", "") or ""
            owned = vname == f"repl-{src_vmid}-{job.get('target_node', '')}"
        else:
            owned = _is_replica_of_job(mgr, node, tgt_vmid, vm_type, job_id)
        if not owned:
            # lgtm[py/reflected-xss]
            return (False, f"VMID {tgt_vmid} is not tagged/named as this job's replica — left untouched")

        if found.get("status") == "running":
            try:
                stop = mgr._api_post(
                    f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{vm_type}/{tgt_vmid}/status/stop",
                    data={},
                )
                st = stop.json().get("data") if stop.status_code == 200 else None
                if st:
                    _wait_for_task(mgr, st, timeout=60)
            except Exception as _e:
                pass
        dr = mgr._api_delete(
            f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{vm_type}/{tgt_vmid}",
            params={"purge": 1, "destroy-unreferenced-disks": 1},
        )
        if dr.status_code != 200:
            # lgtm[py/reflected-xss]
            return (False, f"delete failed: {dr.text[:160]}")
        dt = dr.json().get("data")
        if dt:
            # bounded wait — this teardown runs inline in the request greenlet, so
            # don't let one delete pin a worker for 10 min (sec-review). A replica
            # qmdestroy is quick; if it ever exceeds this, PVE still finishes it and
            # a retry sees 'replica not present'.
            ok, detail = _wait_for_task(mgr, dt, timeout=180)
            if not ok:
                # lgtm[py/reflected-xss]
                return (False, f"delete task failed: {detail}")
        # lgtm[py/reflected-xss]
        return (True, f"VM {tgt_vmid} removed")
    except Exception as e:
        # lgtm[py/reflected-xss]
        return (False, str(e))


def _wants_delete_target(job):
    """Resolve whether the replica VM should be torn down on job delete.
    Per-request override (query ?delete_target=1 or JSON body) wins; otherwise
    fall back to the flag stored on the job."""
    raw = request.args.get("delete_target")
    if raw is None:
        # #563 — silent parse: a DELETE with an empty body but a JSON content-type
        # (what the fetch wrapper sends) used to make request.json throw a 400.
        body = request.get_json(silent=True) or {}
        if isinstance(body, dict) and "delete_target" in body:
            raw = body.get("delete_target")
    if raw is None:
        raw = job.get("delete_target")
    if isinstance(raw, bool):
        # lgtm[py/reflected-xss]
        return raw
    # lgtm[py/reflected-xss]
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


@bp.route("/api/cross-cluster-replications/<job_id>", methods=["DELETE"])
@require_auth(perms=["cluster.config"])
def delete_cross_cluster_replication(job_id):
    """Delete a cross-cluster replication job (optionally its replica VM too)."""
    db = get_db()
    existing = db.query_one("SELECT * FROM cross_cluster_replications WHERE id = ?", (job_id,))
    if not existing:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Replication job not found"}), 404
    job = dict(existing)

    # (sec-review) - per-cluster access gate (same boundary as create/run).
    # Without it, a tenant-scoped cluster.config holder could destroy another tenant's
    # replica VM via delete_target, or tamper with their job config.
    for _cid in (job.get("source_cluster"), job.get("target_cluster")):
        # #563 — a cluster that no longer exists can't be tenant-owned anymore and its
        # replica is gone with it, so its absence must not block cleanup of the orphaned
        # job. Still gate clusters that DO exist (the BOLA boundary the comment below means).
        if _cid and _cid in cluster_managers:
            ok, _ = check_cluster_access(_cid)
            if not ok:
                return _access_denied()

    want_teardown = _wants_delete_target(job)

    # Don't race an in-flight run: tearing the replica down mid-run just lets the run
    # re-create it (we hit exactly this during testing). Same _claim_job set the run
    # + scheduler use.
    if want_teardown:
        from ProxmoxVEx.background.cross_cluster_replication import is_job_inflight

        if is_job_inflight(job_id):
            # lgtm[py/reflected-xss]
            return jsonify({
                "error": "Replication job is running",
                "detail": "Wait for the current run to finish before deleting with target teardown.",
            }), 409

    target_detail = ""
    target_deleted = False
    if want_teardown:
        _tgt = job.get("target_cluster")
        if _tgt and _tgt not in cluster_managers:
            # #563 — target cluster was removed; the replica died with it, there's
            # nothing left to tear down. Drop the job rather than wedging on a teardown
            # that can never succeed.
            logging.info(f"[XCREPL] Job {job_id}: target cluster {_tgt} gone, dropping job without teardown")
            target_detail = " (target cluster removed — replica gone with it)"
        else:
            ok, detail = _delete_replica_target(job)
            if not ok:
                # teardown genuinely failed — keep the job row so the operator keeps the
                # handle and can retry (or delete without teardown to just drop the job).
                logging.warning(f"[XCREPL] Job {job_id}: replica teardown failed, keeping job: {detail}")
                # lgtm[py/reflected-xss]
                return jsonify({"error": "Replica teardown failed — replication job kept", "detail": detail}), 409
            target_deleted = True
            target_detail = f" (replica: {detail})"

    db.execute("DELETE FROM cross_cluster_replications WHERE id = ?", (job_id,))

    usr = getattr(request, "session", {}).get("user", "system")
    log_audit(usr, "replication.deleted", f"Cross-cluster replication {job_id} deleted{target_detail}")

    # lgtm[py/reflected-xss]
    return jsonify({"success": True, "target_deleted": target_deleted, "target_detail": target_detail.strip()})


@bp.route("/api/cross-cluster-replications/<job_id>/run", methods=["POST"])
@require_auth(perms=["cluster.config"])
def run_cross_cluster_replication(job_id):
    """Trigger a cross-cluster replication job immediately (async)."""
    db = get_db()
    job = db.query_one("SELECT * FROM cross_cluster_replications WHERE id = ?", (job_id,))
    if not job:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Replication job not found"}), 404

    # (sec-review) - gate per-cluster access before kicking off a run that
    # migrates into / overwrites the replica on these clusters (same boundary as create).
    _job = dict(job)
    for _cid in (_job.get("source_cluster"), _job.get("target_cluster")):
        if _cid:
            ok, _ = check_cluster_access(_cid)
            if not ok:
                return _access_denied()

    # (#455 @DarmokNoob) - block duplicate triggers while a previous
    # run is still in-flight. The scheduler uses the same _claim_job() guard.
    from ProxmoxVEx.background.cross_cluster_replication import _claim_job, _release_job, _tracked_run

    if not _claim_job(job_id):
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": "Replication job is already running",
            "detail": "Wait for the current run to finish, then retry.",
        }), 409

    # kick off in background so the API responds right away
    # Detect same-cluster -> use local replication
    job_dict = dict(job)
    is_local = job_dict.get("source_cluster") == job_dict.get("target_cluster")
    handler = _execute_local_replication if is_local else _execute_replication
    try:
        threading.Thread(target=_tracked_run, args=(handler, job_dict), daemon=True).start()
    except Exception:
        _release_job(job_id)
        logging.exception("Failed to start replication")
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Failed to start replication"}), 500

    usr = getattr(request, "session", {}).get("user", "system")
    log_audit(
        usr,
        "replication.triggered",
        f"{'Local' if is_local else 'Cross-cluster'} replication {job_id} manually triggered",
    )

    # lgtm[py/reflected-xss]
    return jsonify({"success": True, "message": "Replication started"})


# Get snapshot replication jobs filtered by cluster
@bp.route("/api/clusters/<cluster_id>/snapshot-replications", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_snapshot_replications_for_cluster(cluster_id):
    """Get snapshot-based replication jobs where this cluster is source or target."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    db = get_db()
    rows = db.query(
        "SELECT * FROM cross_cluster_replications WHERE source_cluster = ? OR target_cluster = ?",
        (cluster_id, cluster_id),
    )
    # lgtm[py/reflected-xss]
    return jsonify([dict(r) for r in rows])


@bp.route("/api/hardware-options", methods=["GET"])
@require_auth(perms=["node.view"])
def get_hardware_options():
    """Get available hardware options (CPU types, SCSI controllers, etc.)

    Extended Dec 2025 with machine types
    """
    # Use any manager to get options
    if cluster_managers:
        manager = list(cluster_managers.values())[0]
        # lgtm[py/reflected-xss]
        return jsonify({
            "cpu_types": manager.get_cpu_types(),
            "scsi_controllers": manager.get_scsi_controllers(),
            "network_models": manager.get_network_models(),
            "disk_bus_types": manager.get_disk_bus_types(),
            "cache_modes": manager.get_cache_modes(),
            "machine_types": manager.get_machine_types(),
        })
    else:
        # Return defaults if no cluster configured
        # lgtm[py/reflected-xss]
        return jsonify({
            "cpu_types": ["host", "kvm64", "qemu64", "x86-64-v2-AES"],
            "scsi_controllers": [{"value": "virtio-scsi-pci", "label": "VirtIO SCSI"}],
            "network_models": [{"value": "virtio", "label": "VirtIO"}],
            "disk_bus_types": [{"value": "scsi", "label": "SCSI", "max": 30}],
            "cache_modes": [{"value": "", "label": "Default"}],
            "machine_types": [
                {"value": "", "label": "Default"},
                {"value": "q35", "label": "q35 (Latest)"},
                {"value": "pc-q35-11.0+pve1", "label": "q35 11.0+pve1"},
                {"value": "pc-q35-10.1", "label": "q35 10.1"},
                {"value": "pc-q35-9.2+pve1", "label": "q35 9.2+pve1"},
                {"value": "pc-q35-8.2", "label": "q35 8.2"},
                {"value": "i440fx", "label": "i440fx (Latest)"},
                {"value": "pc-i440fx-11.0+pve1", "label": "i440fx 11.0+pve1"},
                {"value": "pc-i440fx-10.1", "label": "i440fx 10.1"},
                {"value": "pc-i440fx-9.2+pve1", "label": "i440fx 9.2+pve1"},
                {"value": "pc-i440fx-8.2", "label": "i440fx 8.2"},
            ],
        })


# 2026-06-05 (security audit H-1/H-2): the console WS proxies self-mint a PVE
# ticket for whatever vmid is in the URL, so checking the `vm.console` permission
# alone is a BOLA — a console-capable user could reach ANY VM on ANY cluster/
# tenant. Every console entry point must also confirm THIS user is authorised for
# THIS cluster AND VM. Works without request.session (the async/standalone
# handlers don't have one) by taking the resolved user dict directly.
def _console_authz(user, cluster_id, vmid, vm_type=None):
    """Return (ok, reason) — user must have cluster access AND per-VM console access."""
    from ProxmoxVEx.utils.rbac import get_user_clusters, load_vm_acls, user_can_access_vm

    if not user:
        # lgtm[py/reflected-xss]
        return False, "no user"
    if user.get("role") == ROLE_ADMIN:
        # lgtm[py/reflected-xss]
        return True, None
    username = user.get("username", "") or ""
    # cluster gate (mirrors helpers.check_cluster_access, but no request.session)
    allowed = get_user_clusters(user)
    if allowed is not None and cluster_id not in allowed:
        cluster_acls = load_vm_acls().get(cluster_id, {}) or {}
        if not any(username in (a.get("users") or []) or "*" in (a.get("users") or []) for a in cluster_acls.values()):
            # lgtm[py/reflected-xss]
            return False, "no cluster access"
    # per-VM gate
    try:
        vmid_int = int(vmid)
    except (TypeError, ValueError):
        # lgtm[py/reflected-xss]
        return False, "bad vmid"
    if not user_can_access_vm(user, cluster_id, vmid_int, "vm.console", vm_type):
        # lgtm[py/reflected-xss]
        return False, "no VM access"
    # lgtm[py/reflected-xss]
    return True, None


# WebSocket proxy for VNC - using geventwebsocket
def handle_vnc_websocket(ws, cluster_id, node, vm_type, vmid):
    """Handle VNC WebSocket connection"""
    logging.info(f"\n{'=' * 60}")
    logging.info(f"VNC WEBSOCKET: {vm_type}/{vmid} on {node}")
    logging.info(f"{'=' * 60}")
    if cluster_id not in cluster_managers:
        logging.error(f"ERROR: Cluster {cluster_id} not found")
        return

    manager = cluster_managers[cluster_id]
    host, port = manager.host, manager.api_port

    logging.info(f"Target host: {host}")
    pve_ws = None
    running = True

    try:
        import json
        import urllib.parse
        import urllib.request

        import websocket
        from gevent import sleep as gsleep
        from gevent import spawn

        # Create SSL context
        ssl_context = ssl.create_default_context()
        # (CodeAnt) - gate TLS verify on the per-cluster ssl_verify flag
        # (default off: PVE ships self-signed; honoured when the admin enables it).
        _verify_tls = bool(getattr(manager, "_ssl_verify", False))
        if not _verify_tls:
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE

        # Step 1: Login
        logging.info("Step 1: Login...")
        login_data = urlencode({"username": manager.config.user, "password": manager.config.pass_}).encode("utf-8")

        login_req = urllib.request.Request(
            _pve_url(f"https://{host}:{port}/api2/json/access/ticket"), data=login_data, method="POST"
        )

        with urllib.request.urlopen(login_req, context=ssl_context, timeout=10) as response:
            login_result = json.loads(response.read().decode("utf-8"))

        pve_ticket = login_result["data"]["ticket"]
        csrf_token = login_result["data"]["CSRFPreventionToken"]
        logging.info("Got PVE ticket")
        # (#352 follow-up) - single-vncproxy mode. If the JS
        # already got a vncproxy ticket+port via /console, reuse it so the VNC
        # password noVNC uses matches the password PVE's vncterm expects. PVE
        # 9.1.x generates fresh random VNC password per vncproxy call.
        pve_port_q = request.args.get("pve_port")
        pve_ticket_q = request.args.get("pve_ticket")
        _ppt_ok, _ppt_port = _safe_vnc_passthrough(pve_port_q, pve_ticket_q)
        if pve_port_q and pve_ticket_q and _ppt_ok:
            vnc_ticket = pve_ticket_q
            port = _ppt_port
            logging.info(f"Reusing JS-issued vncproxy ticket port={port}")
        else:
            logging.info("Step 2: Get VNC ticket...")
            if vm_type == "qemu":
                vnc_url = f"https://{host}:{port}/api2/json/nodes/{node}/qemu/{vmid}/vncproxy"
            else:
                vnc_url = f"https://{host}:{port}/api2/json/nodes/{node}/lxc/{vmid}/vncproxy"
            vnc_data = urlencode({"websocket": "1"}).encode("utf-8")
            vnc_req = urllib.request.Request(_pve_url(vnc_url), data=vnc_data, method="POST")
            vnc_req.add_header("Cookie", f"PVEAuthCookie={pve_ticket}")
            vnc_req.add_header("CSRFPreventionToken", csrf_token)
            with urllib.request.urlopen(vnc_req, context=ssl_context, timeout=10) as response:
                vnc_result = json.loads(response.read().decode("utf-8"))
            vnc_ticket = vnc_result["data"]["ticket"]
            port = vnc_result["data"]["port"]
            logging.info(f"Got VNC ticket, port={port} (no JS pass-through — PVE 9.1.x users may hit issue #352)")
        # Step 3: Connect to Proxmox WebSocket
        logging.info("Step 3: Connect to Proxmox...")
        encoded_vnc_ticket = url_quote(vnc_ticket, safe="")

        if vm_type == "qemu":
            pve_ws_path = f"/api2/json/nodes/{node}/qemu/{vmid}/vncwebsocket?port={port}&vncticket={encoded_vnc_ticket}"
        else:
            pve_ws_path = f"/api2/json/nodes/{node}/lxc/{vmid}/vncwebsocket?port={port}&vncticket={encoded_vnc_ticket}"

        pve_ws_url = f"wss://{host}:{port}{pve_ws_path}"

        pve_ws = websocket.create_connection(
            pve_ws_url,
            sslopt=({} if _verify_tls else {"cert_reqs": ssl.CERT_NONE}),
            header={"Cookie": f"PVEAuthCookie={pve_ticket}"},
            subprotocols=["binary"],
            timeout=VNC_PVE_CONNECT_TIMEOUT,
        )
        # TCP_NODELAY + keepalive: survives idle conntrack drops
        _apply_vnc_socket_options(pve_ws.sock)

        logging.info("✓ Connected to Proxmox!")
        pve_ws.settimeout(0.1)

        bytes_sent = 0
        bytes_received = 0

        # Greenlet to read from Proxmox and send to client
        def proxmox_to_client():
            nonlocal bytes_received, running
            try:
                while running:
                    try:
                        data = pve_ws.recv()
                        if data:
                            bytes_received += len(data)
                            ws.send(data)
                    except websocket.WebSocketTimeoutException:
                        gsleep(0.01)
                    except websocket.WebSocketConnectionClosedException:
                        logging.info("Proxmox closed")
                        running = False
                        break
                    except Exception as e:
                        if running:
                            logging.error(f"PVE->Client error: {e}")
                        running = False
                        break
            except Exception as e:
                logging.error(f"proxmox_to_client crashed: {e}")
                running = False

        # Start the proxmox reader greenlet
        pve_reader = spawn(proxmox_to_client)

        logging.info("Step 4: Proxy running...")
        # Main loop: read from client, send to Proxmox
        while running:
            try:
                data = ws.receive()
                if data is None:
                    logging.info("Client disconnected")
                    running = False
                    break
                if data:
                    bytes_sent += len(data)
                    pve_ws.send(data)
            except Exception as e:
                if running:
                    err_str = str(e)
                    if "closed" not in err_str.lower():
                        logging.error(f"Client->PVE error: {e}")
                running = False
                break

        running = False
        pve_reader.kill()

        logging.info(f"Session ended: sent {bytes_sent}, received {bytes_received}")
    except Exception as e:
        logging.exception(f"VNC proxy error: {type(e).__name__}: {e}")
    finally:
        running = False
        if pve_ws:
            with contextlib.suppress(Exception):
                pve_ws.close()
        logging.info(f"{'=' * 60}\n")


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/vncwebsocket")
def vnc_websocket_route(cluster_id, node, vm_type, vmid):
    """WebSocket endpoint for VNC - redirect to dedicated WS port

    Auth via query param since WebSocket can't send custom headers
    """
    # 2026-06-10: don't call check_cluster_access() here. This route has no
    # @require_auth (it authenticates via the ?token=/?session= query param below,
    # because a WebSocket can't send custom headers), so request.session isn't
    # populated yet and check_cluster_access() would blow up with
    # AttributeError: 'Request' object has no attribute 'session' on every GET.
    # The cluster gate is enforced by _console_authz() below — it does the same
    # get_user_clusters() + VM-ACL fallback against the resolved query-param user.
    # Prefer WS token, session as fallback
    from ProxmoxVEx.utils.realtime import validate_ws_token

    ws_token = request.args.get("token")
    session_id = request.args.get("session")

    auth_user = None
    if ws_token:
        token_data = validate_ws_token(ws_token)
        if not token_data:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "Invalid token", "code": "INVALID_TOKEN"}), 401
        auth_user = token_data["user"]
        token_data["role"]
    elif session_id:
        session = validate_session(session_id)
        if not session:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "Invalid session", "code": "INVALID_SESSION"}), 401
        auth_user = session["user"]
        session["role"]
    else:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Auth required", "code": "AUTH_REQUIRED"}), 401

    # Check permissions
    users = load_users()
    user = users.get(auth_user, {})
    get_user_permissions(user)
    # 2026-06-10 (#537/RBAC): coarse "global vm.console perm OR admin" pre-check dropped
    # the per-VM _console_authz gate below is authoritative and portal/custom-role aware.
    # H-1/H-2: cluster + per-VM gate (vm.console alone isn't enough)
    user["username"] = auth_user
    _ok, _why = _console_authz(user, cluster_id, vmid, vm_type)
    if not _ok:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied", "code": "INSUFFICIENT_PERMISSIONS"}), 403

    # This route is just a fallback - actual WebSocket handling is done by the
    # dedicated WebSocket server started in start_vnc_websocket_server()
    # 2026-06-10: removed a redundant local `from flask import request` here
    # request is already module-level, and the local re-import made `request` a
    # function-local, so the request.args.get(...) auth lookup above raised
    # UnboundLocalError once check_cluster_access (which used to crash first) was gone.
    logging.info(f"\n*** VNC ROUTE HIT (HTTP): {vm_type}/{vmid} on {node} ***")
    logging.info(f"HTTP_UPGRADE: {request.environ.get('HTTP_UPGRADE', 'NONE')}")
    logging.info(f"wsgi.websocket: {request.environ.get('wsgi.websocket', 'NONE')}")
    # Try geventwebsocket first
    ws = request.environ.get("wsgi.websocket")
    if ws is not None:
        logging.info("Using geventwebsocket handler...")
        handle_vnc_websocket(ws, cluster_id, node, vm_type, vmid)
        # lgtm[py/reflected-xss]
        return ""

    # If not a websocket, return error
    # lgtm[py/reflected-xss]
    return jsonify({"error": "WebSocket connection required"}), 426


# Standalone VNC WebSocket Server using websockets library
def start_vnc_websocket_server(port=5001, ssl_cert=None, ssl_key=None, host="127.0.0.1"):
    """Start a dedicated WebSocket server for VNC proxying"""
    import asyncio
    import re
    import threading

    from ProxmoxVEx.utils.server_control import kill_existing_on_port

    try:
        import websockets
    except ImportError:
        logging.warning("WARNING: 'websockets' library not installed. VNC console will not work.")
        logging.info("Install with: pip install websockets")
        return

    kill_existing_on_port(port, "tcp")

    # Event to signal server is ready
    server_ready = threading.Event()

    async def vnc_handler(websocket):
        """Handle VNC WebSocket connections

        Auth via query param since WebSocket can't send custom headers
        """
        # Get path from websocket
        path = websocket.request.path if hasattr(websocket, "request") else websocket.path

        logging.info(f"\n{'=' * 60}")
        logging.info(f"VNC WebSocket connected: {path}")
        logging.info(f"{'=' * 60}")
        # Authenticate via single-use WS token (not session in URL)
        from urllib.parse import parse_qs, urlparse

        parsed = urlparse(path)
        query_params = parse_qs(parsed.query)
        ws_token = query_params.get("token", [None])[0]
        # Backwards compat, accept session= too for now
        session_id = query_params.get("session", [None])[0]

        # Stable VNC Mode (D): if frontend asked for an encrypted
        # tunnel via /console?stable=1, it gets back an enc_session id which it
        # then passes here. We claim the matching AES-256-GCM key (one-shot,
        # auto-expires after 60s if never claimed) and use it to wrap forwarded
        # frames in both directions. None → plain mode (default, backwards-compat).
        crypto_session = None
        enc_sid = query_params.get("enc_session", [None])[0]
        if enc_sid:
            try:
                from ProxmoxVEx.utils import vnc_crypto as _vc

                _key = _vc.claim_session_key(enc_sid)
                if _key:
                    crypto_session = _vc.VncCryptoSession(_key)
                    logging.info(f"[VNC] stable mode active for sid={enc_sid[:8]}...")
                else:
                    logging.error(
                        f"[VNC] enc_session={enc_sid[:8]}... not found / expired — falling back to plain mode"
                    )
            except Exception as _e:
                logging.error(f"[VNC] crypto setup failed ({_e}) — falling back to plain mode")
        if ws_token:
            from ProxmoxVEx.utils.realtime import validate_ws_token

            token_data = validate_ws_token(ws_token)
            if not token_data:
                logging.error("ERROR: Invalid or expired WS token")
                await websocket.close(1002, "Invalid token")
                return
            # check perms from token
            users = load_users()
            user = users.get(token_data["user"], {})
            user["username"] = token_data["user"]
            # 2026-06-10 (#537 abyss1): the per-VM _console_authz gate below (H-1/H-2) is the
            # authoritative check (cluster + per-VM vm.console via user_can_access_vm). The old
            # coarse "global vm.console perm OR admin" pre-check here rejected Client-Portal users
            # — they hold per-VM console access through the portal model, not a global RBAC perm
            # so the portal console hung at "Connecting…". Dropped; _console_authz still enforces it.
            logging.info(f"User {token_data['user']} authenticated for VNC (ws_token)")
        elif session_id:
            session = validate_session(session_id)
            if not session:
                logging.error("ERROR: Invalid session")
                await websocket.close(1002, "Invalid session")
                return
            users = load_users()
            user = users.get(session["user"], {})
            user["username"] = session["user"]
            # #537: per-VM _console_authz below is the authoritative gate (see ws_token note).
            logging.info(f"User {session['user']} authenticated for VNC (session)")
        else:
            logging.error("ERROR: No token or session provided")
            await websocket.close(1002, "Authentication required")
            return

        # Parse path: /api/clusters/{cluster_id}/vms/{node}/{vm_type}/{vmid}/vncwebsocket
        match = re.match(r"/api/clusters/([^/]+)/vms/([^/]+)/(qemu|lxc)/(\d+)/vncwebsocket", parsed.path)
        if not match:
            logging.error(f"ERROR: Invalid path: {parsed.path}")
            await websocket.close(1002, "Invalid path")
            return

        cluster_id, node, vm_type, vmid = match.groups()
        vmid = int(vmid)

        logging.info(f"Cluster: {cluster_id}, Node: {node}, Type: {vm_type}, VMID: {vmid}")
        # H-1/H-2: cluster + per-VM gate before we self-mint a PVE ticket for this vmid
        _ok, _why = _console_authz(user, cluster_id, vmid, vm_type)
        if not _ok:
            logging.error(f"ERROR: console authz denied ({_why}) for {cluster_id}/{vmid}")
            await websocket.close(1002, "Permission denied")
            return

        if cluster_id not in cluster_managers:
            logging.error(f"ERROR: Cluster {cluster_id} not found")
            await websocket.close(1002, "Cluster not found")
            return

        manager = cluster_managers[cluster_id]
        host, port = manager.host, manager.api_port

        pve_ws = None

        try:
            import json
            import urllib.parse
            import urllib.request

            import websocket as ws_client

            ssl_ctx = ssl.create_default_context()
            # (CodeAnt) - gate TLS verify on the per-cluster ssl_verify flag
            # (default off: PVE ships self-signed; honoured when the admin enables it).
            _verify_tls = bool(getattr(manager, "_ssl_verify", False))
            if not _verify_tls:
                ssl_ctx.check_hostname = False
                ssl_ctx.verify_mode = ssl.CERT_NONE

            # Login to Proxmox to get auth ticket
            login_data = urlencode({"username": manager.config.user, "password": manager.config.pass_}).encode("utf-8")

            login_req = urllib.request.Request(
                _pve_url(f"https://{host}:{port}/api2/json/access/ticket"), data=login_data, method="POST"
            )

            # Wrap synchronous urllib.urlopen in asyncio.to_thread
            # so concurrent VNC handlers don't serialize on the TLS handshake.
            import asyncio as _aiowrap

            def _do_urlopen(req):
                with urllib.request.urlopen(req, context=ssl_ctx, timeout=10) as r:
                    # lgtm[py/reflected-xss]
                    return r.read()

            login_body = await _aiowrap.to_thread(_do_urlopen, login_req)
            login_result = json.loads(login_body.decode("utf-8"))

            pve_ticket = login_result["data"]["ticket"]
            csrf_token = login_result["data"]["CSRFPreventionToken"]

            # Issue #352 follow-up. Single-vncproxy fast path.
            # If the JS already obtained a vncproxy ticket+port via /console
            # (which it always does — that's where it gets the VNC RFB password
            # for noVNC), reuse THAT ticket here instead of issuing a fresh
            # vncproxy call. PVE 9.1.x generates a random VNC password per
            # vncproxy call. Two calls = two different passwords; noVNC sends
            # DES(password_A) but PVE's vncterm is initialised with password_B,
            # so RFB auth fails (the customer-visible recv=60B + ttfb≈1s pattern).
            # Older PVE was tolerant because passwords were derived from the
            # ticket prefix. Newer PVE is strict.
            pve_port_q = query_params.get("pve_port", [None])[0]
            pve_ticket_q = query_params.get("pve_ticket", [None])[0]
            # sec-review: validate the passthrough; null it on garbage so both this
            # block AND the auth-header reuse below fall back cleanly to a fresh vncproxy.
            _ppt_ok, _ppt_port = _safe_vnc_passthrough(pve_port_q, pve_ticket_q)
            if not _ppt_ok:
                pve_port_q = pve_ticket_q = None
            if pve_port_q and pve_ticket_q:
                # Single-vncproxy mode: trust the caller-supplied port+ticket.
                vnc_ticket = pve_ticket_q
                port = _ppt_port
                logging.info(f"[VNC] reusing JS-issued vncproxy ticket port={port} (single-call mode)")
            else:
                # Backwards-compat fallback: issue our own vncproxy. This still
                # works on older PVE where two vncproxy calls produce matching
                # passwords (or where noVNC isn't used in the browser).
                if vm_type == "qemu":
                    vnc_url = f"https://{host}:{port}/api2/json/nodes/{node}/qemu/{vmid}/vncproxy"
                else:
                    vnc_url = f"https://{host}:{port}/api2/json/nodes/{node}/lxc/{vmid}/vncproxy"
                vnc_data = urlencode({"websocket": "1"}).encode("utf-8")
                vnc_req = urllib.request.Request(_pve_url(vnc_url), data=vnc_data, method="POST")
                vnc_req.add_header("Cookie", f"PVEAuthCookie={pve_ticket}")
                vnc_req.add_header("CSRFPreventionToken", csrf_token)
                vnc_body = await _aiowrap.to_thread(_do_urlopen, vnc_req)
                vnc_result = json.loads(vnc_body.decode("utf-8"))
                vnc_ticket = vnc_result["data"]["ticket"]
                port = vnc_result["data"]["port"]
                logging.warning(
                    f"[VNC] no pve_port/pve_ticket in URL — issued fresh vncproxy (port={port}). Update the frontend to pass JS-issued ticket through to avoid PVE 9.1.x password-mismatch (issue #352)."
                )

            encoded_vnc_ticket = url_quote(vnc_ticket, safe="")

            if vm_type == "qemu":
                pve_ws_path = (
                    f"/api2/json/nodes/{node}/qemu/{vmid}/vncwebsocket?port={port}&vncticket={encoded_vnc_ticket}"
                )
            else:
                pve_ws_path = (
                    f"/api2/json/nodes/{node}/lxc/{vmid}/vncwebsocket?port={port}&vncticket={encoded_vnc_ticket}"
                )

            # VNC SSH-Tunnel-Mode (D2 / second leg).
            # If the cluster is flagged with vnc_tunnel=True, we open a persistent
            # SSH connection to the PVE node and forward localhost:RAND→pve:8006
            # through it. The WSS connection then goes to localhost:RAND instead
            # of pve:8006, so the WSS bytes ride inside SSH which TLS-inspection
            # engines can't decrypt (no trust-anchor for the SSH host key).
            # Multi-user: each session gets its own ephemeral local port.
            tunnel_endpoint = None
            tunnel_target_host = host
            tunnel_target_port = 8006
            try:
                _use_tunnel = bool(getattr(manager.config, "vnc_tunnel", False))
            except Exception as _e:
                _use_tunnel = False

            if _use_tunnel:
                try:
                    from ProxmoxVEx.utils import vnc_tunnel as _vt

                    _ssh_user = (
                        getattr(manager.config, "ssh_user", None) or (manager.config.user or "root").split("@")[0]
                    )
                    _ssh_port = getattr(manager.config, "ssh_port", 22) or 22
                    _ssh_key = getattr(manager.config, "ssh_key", "") or ""
                    _ssh_pass = getattr(manager.config, "pass_", "") or ""
                    # _vt.acquire() is sync. On the *first* call for a
                    # cluster it builds the SSH transport (~1-2s on a fast LAN, more
                    # over WAN). If we ran it directly on the event loop, that 1-2s
                    # blocks websockets.serve from completing opening handshakes for
                    # other concurrent connections — which is exactly the "5/5 timed
                    # out during opening handshake" we saw in the multi-user test.
                    # Offload to a worker so the event loop stays free.
                    import asyncio as _aio_acq

                    tunnel_endpoint = await _aio_acq.to_thread(
                        _vt.acquire,
                        cluster_id=cluster_id,
                        pve_host=host,
                        ssh_user=_ssh_user,
                        ssh_port=_ssh_port,
                        ssh_key_content=_ssh_key,
                        ssh_password=_ssh_pass,
                        target_host="127.0.0.1",
                        target_port=8006,
                    )
                    # Reroute the WSS through the local listener
                    tunnel_target_host = "127.0.0.1"
                    tunnel_target_port = tunnel_endpoint.local_port
                    logging.info(
                        f"[VNC] SSH tunnel mode active for cluster={cluster_id}: "
                        f"WSS routed via 127.0.0.1:{tunnel_target_port} → SSH → {host}:{port}"
                    )
                except Exception as _tun_err:
                    logging.warning(
                        f"[VNC] SSH tunnel setup failed ({_tun_err}) — falling back "
                        f"to direct WSS to {host}:{port}. Customer may still see "
                        "TLS-inspection issues until SSH is fixed."
                    )
                    tunnel_endpoint = None
                    tunnel_target_host = host
                    tunnel_target_port = 8006

            pve_ws_url = f"wss://{tunnel_target_host}:{tunnel_target_port}{pve_ws_path}"

            # (#352 follow-up) - auth-context for the PVE WS upgrade.
            # When we're REUSING the JS-issued vncproxy ticket, the ticket was
            # bound to the manager's existing auth context (API token or stored
            # access cookie). Using a fresh login's cookie produces "permission
            # denied - invalid PVEVNC ticket" on PVE 9.1.x. Reuse the manager's
            # stored auth instead. Backwards-compat path keeps the fresh login.
            ws_auth_header = {"Host": f"{host}:{port}"}
            if pve_port_q and pve_ticket_q:
                if getattr(manager, "_using_api_token", False) and getattr(manager, "_api_token", None):
                    ws_auth_header["Authorization"] = f"PVEAPIToken={manager._api_token}"
                elif getattr(manager, "_ticket", None):
                    ws_auth_header["Cookie"] = f"PVEAuthCookie={manager._ticket}"
                else:
                    ws_auth_header["Cookie"] = f"PVEAuthCookie={pve_ticket}"
            else:
                ws_auth_header["Cookie"] = f"PVEAuthCookie={pve_ticket}"

            # Ws_client.create_connection is synchronous; offload to
            # a worker thread so concurrent VNC handlers don't serialize on the
            # TLS+WS-Upgrade handshake (~1-2s each) on the event loop.
            import asyncio as _asyncio_for_connect
            import time as _t_connect

            _connect_started = _t_connect.monotonic()
            # PVE 9.1+ drops the vncwebsocket upgrade unless the client advertises
            # the "binary" WebSocket subprotocol (noVNC uses the same).
            pve_ws = await _asyncio_for_connect.to_thread(
                ws_client.create_connection,
                pve_ws_url,
                sslopt=({} if _verify_tls else {"cert_reqs": ssl.CERT_NONE}),
                header=ws_auth_header,
                subprotocols=["binary"],
                timeout=VNC_PVE_CONNECT_TIMEOUT,
            )
            _connect_ms = int((_t_connect.monotonic() - _connect_started) * 1000)

            # Apr 2026: TCP_NODELAY + aggressive keepalive (replaces older Comment).
            # Nagle off = no 40ms input lag for keystrokes/mouse; keepalive on = stateful
            # firewalls don't drop the session during natural idle periods.
            _apply_vnc_socket_options(pve_ws.sock)

            logging.info(f"[VNC] connected to {host} for {vm_type}/{vmid} in {_connect_ms}ms")
            if _connect_ms > 3000:
                logging.warning(
                    f"[VNC] slow PVE connect: {_connect_ms}ms — possible TLS-inspection / EDR latency on the path to {host}"
                )

            import asyncio

            bytes_sent = 0
            bytes_received = 0
            running = True
            stop_evt = asyncio.Event()
            # Time-to-first-byte from PVE side; helps distinguish
            # "couldn't connect" from "connected but stuck mid-handshake" in support
            _ttfb_ms = None
            _session_started = _t_connect.monotonic()

            # (#312/#92): the old loop used settimeout(0.001) + asyncio.sleep(0.005)
            # to fake non-blocking recv. That's a busy-wait that blocks the event loop on every
            # recv() call — under load or network jitter it drops bytes and the session dies after
            # a few minutes. Switch to blocking recv in a worker thread via asyncio.to_thread.
            pve_ws.settimeout(None)  # blocking mode — to_thread handles the blocking call

            async def proxmox_to_client():
                """Forward data from Proxmox to browser (blocking recv handled in thread).

                In Stable VNC Mode (crypto_session is not None): plain RFB bytes
                from PVE are wrapped in an AES-256-GCM frame before they hit the
                browser-side WebSocket. The middlebox can re-encrypt our outer
                TLS but sees opaque ciphertext inside, so it can't pattern-match
                or modify the binary RFB.
                """
                nonlocal bytes_received, running, _ttfb_ms
                while running:
                    try:
                        data = await asyncio.to_thread(pve_ws.recv)
                        if not data:
                            running = False
                            break
                        if _ttfb_ms is None:
                            _ttfb_ms = int((_t_connect.monotonic() - _session_started) * 1000)
                        bytes_received += len(data)
                        if isinstance(data, str):
                            data = data.encode("latin-1")
                        if crypto_session is not None:
                            data = crypto_session.encrypt(data)
                        await websocket.send(data)
                    except ws_client.WebSocketConnectionClosedException:
                        running = False
                        break
                    except Exception as e:
                        if running:
                            logging.debug(f"[VNC] PVE->Client: {e}")
                        running = False
                        break
                stop_evt.set()

            async def client_to_proxmox():
                """Forward data from browser to Proxmox (blocking send handled in thread).

                In Stable VNC Mode: each browser-side WebSocket frame is an
                AES-256-GCM ciphertext blob. We unwrap it (which also verifies
                the auth tag — if a middlebox modified bytes mid-flight, decrypt
                raises and we close the session with code 4099 and a clear
                'integrity check failed' reason instead of letting RFB later
                fail with a confusing 'Authentication failed').
                """
                nonlocal bytes_sent, running
                try:
                    async for message in websocket:
                        if not running:
                            break
                        bytes_sent += len(message)
                        if isinstance(message, str):
                            message = message.encode("latin-1")
                        if crypto_session is not None:
                            try:
                                message = crypto_session.decrypt(message)
                            except Exception as _crypto_err:
                                logging.warning(
                                    f"[VNC] integrity check FAILED on browser→PVE frame "
                                    f"(host={host} vm={vm_type}/{vmid}): {_crypto_err}. "
                                    "TLS-inspection / EDR is modifying packets mid-flight."
                                )
                                running = False
                                with contextlib.suppress(Exception):
                                    await websocket.close(4099, f"integrity_check_failed: {_crypto_err}")
                                break
                        await asyncio.to_thread(pve_ws.send, message)
                except Exception as e:
                    if running and "close" not in str(e).lower():
                        logging.debug(f"[VNC] Client->PVE: {e}")
                finally:
                    running = False
                    stop_evt.set()

            async def pve_keepalive():
                """Keepalive for pvedaemon idle timeout (#312).

                Two-layer: WS ping every 15s AND an RFB-level FramebufferUpdateRequest
                every 20s. pveproxy sits between us and qemu and can timeout based on
                RFB traffic, not WS frames — the browser's WS ping alone doesn't always
                count as activity on the qemu side. By injecting an RFB incremental
                update request we produce real RFB traffic that flows end-to-end.

                RFB FramebufferUpdateRequest wire format (8 bytes, Big-Endian):
                  U8  message-type = 3
                  U8  incremental  = 1   (only changed regions -> cheap)
                  U16 x            = 0
                  U16 y            = 0
                  U16 width        = 0xFFFF  (server clamps to FB size)
                  U16 height       = 0xFFFF

                15s grace before first RFB frame so the RFB handshake completes first
                injecting our bytes into the handshake would confuse qemu.
                """
                import time as _time

                RFB_FB_UPDATE_REQUEST = b"\x03\x01\x00\x00\x00\x00\xff\xff\xff\xff"
                session_start = _time.monotonic()
                ws_ping_interval = 15
                rfb_interval = 20
                next_rfb_at = session_start + 15 + rfb_interval  # 15s grace + 20s first interval
                while running:
                    try:
                        await asyncio.wait_for(stop_evt.wait(), timeout=ws_ping_interval)
                        break  # stop_evt was set — session ending
                    except asyncio.TimeoutError:
                        pass
                    if not running:
                        break
                    # WS-layer ping (cheap, keeps any websocket-aware intermediary happy)
                    try:
                        await asyncio.to_thread(pve_ws.ping)
                    except Exception as _e:
                        break
                    # RFB-layer keepalive (keeps pveproxy/qemu from declaring the session idle)
                    now = _time.monotonic()
                    if now >= next_rfb_at:
                        try:
                            await asyncio.to_thread(pve_ws.send_binary, RFB_FB_UPDATE_REQUEST)
                            next_rfb_at = now + rfb_interval
                        except Exception as e:
                            logging.debug(f"[VNC] RFB keepalive send failed: {e}")
                            break

            task1 = asyncio.create_task(proxmox_to_client())
            task2 = asyncio.create_task(client_to_proxmox())
            task3 = asyncio.create_task(pve_keepalive())

            done, pending = await asyncio.wait([task1, task2, task3], return_when=asyncio.FIRST_COMPLETED)

            running = False

            for task in pending:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

            # Richer session-end diagnostic. Helps support correlate
            # short / weird sessions with network / inspection issues. Format is
            # easy to grep + machine-parseable.
            _duration_ms = int((_t_connect.monotonic() - _session_started) * 1000)
            _ttfb_str = f"{_ttfb_ms}ms" if _ttfb_ms is not None else "never"
            _short_session = _duration_ms < 5000 and bytes_received < 4096
            _level = logging.WARNING if _short_session else logging.INFO
            logging.log(
                _level,
                f"[VNC] session ended host={host} vm={vm_type}/{vmid} "
                f"connect={_connect_ms}ms ttfb={_ttfb_str} duration={_duration_ms}ms "
                f"sent={bytes_sent}B recv={bytes_received}B "
                f"{'SHORT_OR_EMPTY — middlebox/EDR may be interfering' if _short_session else ''}",
            )

        except Exception as e:
            logging.exception(f"VNC WS handler error: {type(e).__name__}: {e}")
        finally:
            # Pve_ws.close() is a SYNC call from the websocket-client
            # library. It runs the TLS close handshake which on a tunneled SSH leg
            # can block when the far end is gone. If we run it on the event loop,
            # ALL subsequent VNC handshakes on this server queue behind it (we hit
            # this in the multi-user concurrency test: 1st session OK, then 5 in
            # parallel all timeout). Offload to a worker with a short upper bound.
            if pve_ws:
                try:
                    import asyncio as _aio_close

                    await _aio_close.wait_for(_aio_close.to_thread(pve_ws.close), timeout=2.0)
                except Exception as _e:
                    pass
            try:
                if "tunnel_endpoint" in locals() and tunnel_endpoint is not None:
                    tunnel_endpoint.stop()
            except Exception as _tend:
                logging.debug(f"[VNC] tunnel cleanup error: {_tend}")
            logging.info(f"{'=' * 60}\n")

    async def main():
        nonlocal server_ready
        ssl_context = None
        if ssl_cert and ssl_key:
            ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ssl_context.load_cert_chain(ssl_cert, ssl_key)
            proto = "wss"
        else:
            proto = "ws"

        # Suppress websocket error logs from bots/scanners
        import logging as ws_logging

        ws_logging.getLogger("websockets").setLevel(ws_logging.CRITICAL)

        # Added ping keepalive like SSH server has, was causing random disconnects
        # Feb 2026: host='' means all interfaces (asyncio creates IPv4+IPv6 listeners)
        # (#352): lenient Connection-header recovery for PVE 9.1.8-9 hosts
        # and middlebox-stripped Upgrade tokens. See ProxmoxVEx/utils/ws_lenient.py.
        from ProxmoxVEx.utils.ws_lenient import lenient_process_request as _lpr_vnc

        ws_host = host if host else _WS_FALLBACK_HOST
        display_host = host or _WS_FALLBACK_HOST
        try:
            async with websockets.serve(
                vnc_handler,
                ws_host,
                port,
                ssl=ssl_context,
                compression=None,
                ping_interval=20,
                ping_timeout=10,
                process_request=_lpr_vnc,
            ):
                logging.info(f"VNC WebSocket Server ready on {proto}://{display_host}:{port}")
                server_ready.set()
                await asyncio.Future()  # Run forever
        except OSError as bind_err:
            # Issue #71: IPv6 bind failed, fall back to 0.0.0.0
            if ":" in str(host):
                logging.error(f"VNC WebSocket: IPv6 bind failed ({bind_err}), falling back to {_WS_FALLBACK_HOST}")
                async with websockets.serve(
                    vnc_handler,
                    _WS_FALLBACK_HOST,
                    port,
                    ssl=ssl_context,
                    compression=None,
                    ping_interval=20,
                    ping_timeout=10,
                    process_request=_lpr_vnc,
                ):
                    logging.info(f"VNC WebSocket Server ready on {proto}://0.0.0.0:{port}")
                    server_ready.set()
                    await asyncio.Future()
            else:
                raise

    # Run in thread, with proper fallback for gevent environments
    # (#388 follow-up) - capture exception into a shared box so the
    # caller waiting on server_ready can surface it loudly in the journal
    # instead of just "may not be ready yet". Silent thread death is the
    # hardest pattern to debug at the customer.
    thread_err = {}  # exception sink — populated if the thread crashes pre-bind

    def run_server():
        try:
            # Try asyncio.run() first (clean Python, no gevent)
            asyncio.run(main())
        except RuntimeError as e:
            if "cannot be called from a running event loop" in str(e):
                # Gevent monkey-patches asyncio, need explicit event loop
                logging.info("VNC WebSocket: gevent detected, using new event loop")
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(main())
                finally:
                    loop.close()
            else:
                logging.exception(f"VNC WebSocket Server RuntimeError: {e}")
                thread_err["err"] = ("RuntimeError", str(e))
        except (KeyboardInterrupt, SystemExit):
            pass
        except OSError as e:
            # bind failures land here — port in use, permission denied, AppArmor block, etc.
            logging.exception(f"VNC WebSocket Server bind failed (port {port}): {e}")
            thread_err["err"] = ("OSError", f"bind error: {e}")
        except TypeError as e:
            # signature mismatches with websockets library (e.g. older websockets)
            logging.exception(f"VNC WebSocket Server TypeError (likely websockets lib version mismatch): {e}")
            thread_err["err"] = ("TypeError", str(e))
        except Exception as e:
            logging.exception(f"VNC WebSocket Server crashed: {type(e).__name__}: {e}")
            thread_err["err"] = (type(e).__name__, str(e))

    logging.info(f"VNC WebSocket: starting thread, target port {port}")
    ws_thread = threading.Thread(target=run_server, daemon=True, name=f"vnc-ws:{port}")
    ws_thread.start()

    # (#388): if the thread is dead at this point and never set
    # server_ready, surface WHY in the log so support can act. Silent failure
    # was the customer-visible symptom that hid the underlying cause.
    if server_ready.wait(timeout=5):
        logging.info(f"VNC WebSocket Server started successfully on port {port}")
    else:
        # Wait briefly for the thread to fully die so thread_err has a chance to populate
        ws_thread.join(timeout=1)
        if thread_err.get("err"):
            etype, emsg = thread_err["err"]
            logging.error(
                f"[VNC] startup failed — thread died with {etype}: {emsg}. "
                f"Port {port} will NOT be bound. Console connections to this server will fail. "
                f"Most common causes: (a) port already in use by another process, "
                f"(b) websockets library version mismatch (need ≥11.0; we expect "
                f"the post-13.x process_request signature), "
                f"(c) AppArmor/SELinux blocking the bind, "
                f"(d) SSL cert path missing or unreadable. "
                f"Run: ss -tlnp | grep ':{port}'  +  pip show websockets  +  journalctl -u ProxmoxVEx -p err"
            )
        elif not ws_thread.is_alive():
            logging.error(
                f"[VNC] startup timed out — thread died silently within 5s without setting "
                f"server_ready and without raising an exception we could capture. "
                f"Port {port} will NOT be bound. Probable causes: SystemExit / os._exit "
                f"in a downstream import or a fatal C-level signal. "
                f"Run: journalctl -u ProxmoxVEx --since '1 minute ago'"
            )
        else:
            logging.warning(
                f"[VNC] startup slow — server_ready not set after 5s but thread is still alive. "
                f"Port {port} may bind shortly. If it never does, the asyncio event loop "
                f"is likely blocked at startup."
            )


# Keep flask-sock version as backup (renamed)
@sock.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/vncwebsocket")
def vnc_websocket_proxy(ws, cluster_id, node, vm_type, vmid):
    """WebSocket proxy for VNC connection via Flask-Sock (same port as main app)"""
    from gevent import sleep as gsleep
    from gevent import spawn

    logging.info(f"\n{'=' * 60}")
    logging.info(f"VNC WEBSOCKET: {vm_type}/{vmid} on {node}")
    logging.info(f"{'=' * 60}")
    # Prefer WS token, session as legacy fallback
    from ProxmoxVEx.utils.realtime import validate_ws_token

    ws_token = request.args.get("token")
    session_id = request.args.get("session")

    auth_user = None
    if ws_token:
        token_data = validate_ws_token(ws_token)
        if not token_data:
            with contextlib.suppress(BaseException):
                ws.send("Invalid or expired token")
            return
        users = load_users()
        user = users.get(token_data["user"], {})
        get_user_permissions(user)
        # #537/RBAC: coarse "global vm.console OR admin" pre-check dropped — _console_authz below is authoritative.
        auth_user = token_data["user"]
    elif session_id:
        session = validate_session(session_id)
        if not session:
            with contextlib.suppress(BaseException):
                ws.send("Invalid session")
            return
        users = load_users()
        user = users.get(session["user"], {})
        get_user_permissions(user)
        # #537/RBAC: coarse pre-check dropped — _console_authz below is authoritative.
        auth_user = session["user"]
    else:
        with contextlib.suppress(BaseException):
            ws.send("Authentication required")
        return

    logging.info(f"User {auth_user} authenticated for VNC")
    # H-1/H-2: cluster + per-VM gate before this proxy self-mints a PVE ticket
    user["username"] = auth_user
    _ok, _why = _console_authz(user, cluster_id, vmid, vm_type)
    if not _ok:
        with contextlib.suppress(BaseException):
            ws.send("Permission denied")
        return

    # 2026-06-04 (PR #523 / Aikido SSRF triage): `node` flows raw into the
    # PVE vncproxy URL path below. The route's string converter blocks '/'
    # but not '..', so a crafted node could path-manipulate the request on the
    # (trusted) PVE host. Validate against the same node-name shape api/nodes.py
    # uses (_NODE_NAME_RE). vmid is already int-safe via the <int:vmid> route
    # converter, and vm_type only ever reaches the URL through the qemu/lxc
    # if/else — node is the only raw segment. (Closed the Aikido PR in favour
    # of this: its vm_type regex would have regressed the qemu/lxc normalisation.)
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9.\-]{0,62}$", node or "") or vm_type not in ("qemu", "lxc"):
        with contextlib.suppress(BaseException):
            ws.send("Invalid node or vm_type")
        return

    if cluster_id not in cluster_managers:
        logging.error(f"ERROR: Cluster {cluster_id} not found")
        return

    manager = cluster_managers[cluster_id]
    host, port = manager.host, manager.api_port

    logging.info(f"Target host: {host}")
    pve_ws = None
    running = True

    try:
        import json
        import urllib.parse
        import urllib.request

        import websocket

        # Create SSL context
        ssl_context = ssl.create_default_context()
        # (CodeAnt) - gate TLS verify on the per-cluster ssl_verify flag
        # (default off: PVE ships self-signed; honoured when the admin enables it).
        _verify_tls = bool(getattr(manager, "_ssl_verify", False))
        if not _verify_tls:
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE

        # Step 1: Login
        logging.info("Step 1: Login...")
        login_data = urlencode({"username": manager.config.user, "password": manager.config.pass_}).encode("utf-8")

        login_req = urllib.request.Request(
            _pve_url(f"https://{host}:{port}/api2/json/access/ticket"), data=login_data, method="POST"
        )

        with urllib.request.urlopen(login_req, context=ssl_context, timeout=10) as response:
            login_result = json.loads(response.read().decode("utf-8"))

        pve_ticket = login_result["data"]["ticket"]
        csrf_token = login_result["data"]["CSRFPreventionToken"]
        logging.info("Got PVE ticket")
        # (#352 follow-up) - single-vncproxy mode. If the JS
        # already got a vncproxy ticket+port via /console, reuse it so the VNC
        # password noVNC uses matches the password PVE's vncterm expects. PVE
        # 9.1.x generates fresh random VNC password per vncproxy call.
        pve_port_q = request.args.get("pve_port")
        pve_ticket_q = request.args.get("pve_ticket")
        _ppt_ok, _ppt_port = _safe_vnc_passthrough(pve_port_q, pve_ticket_q)
        if pve_port_q and pve_ticket_q and _ppt_ok:
            vnc_ticket = pve_ticket_q
            port = _ppt_port
            logging.info(f"Reusing JS-issued vncproxy ticket port={port}")
        else:
            logging.info("Step 2: Get VNC ticket...")
            if vm_type == "qemu":
                vnc_url = f"https://{host}:{port}/api2/json/nodes/{node}/qemu/{vmid}/vncproxy"
            else:
                vnc_url = f"https://{host}:{port}/api2/json/nodes/{node}/lxc/{vmid}/vncproxy"
            vnc_data = urlencode({"websocket": "1"}).encode("utf-8")
            vnc_req = urllib.request.Request(_pve_url(vnc_url), data=vnc_data, method="POST")
            vnc_req.add_header("Cookie", f"PVEAuthCookie={pve_ticket}")
            vnc_req.add_header("CSRFPreventionToken", csrf_token)
            with urllib.request.urlopen(vnc_req, context=ssl_context, timeout=10) as response:
                vnc_result = json.loads(response.read().decode("utf-8"))
            vnc_ticket = vnc_result["data"]["ticket"]
            port = vnc_result["data"]["port"]
            logging.info(f"Got VNC ticket, port={port} (no JS pass-through — PVE 9.1.x users may hit issue #352)")
        # Step 3: Connect to Proxmox WebSocket
        logging.info("Step 3: Connect to Proxmox...")
        encoded_vnc_ticket = url_quote(vnc_ticket, safe="")

        if vm_type == "qemu":
            pve_ws_path = f"/api2/json/nodes/{node}/qemu/{vmid}/vncwebsocket?port={port}&vncticket={encoded_vnc_ticket}"
        else:
            pve_ws_path = f"/api2/json/nodes/{node}/lxc/{vmid}/vncwebsocket?port={port}&vncticket={encoded_vnc_ticket}"

        pve_ws_url = f"wss://{host}:{port}{pve_ws_path}"

        pve_ws = websocket.create_connection(
            pve_ws_url,
            sslopt=({} if _verify_tls else {"cert_reqs": ssl.CERT_NONE}),
            header={"Cookie": f"PVEAuthCookie={pve_ticket}"},
            subprotocols=["binary"],
            timeout=VNC_PVE_CONNECT_TIMEOUT,
        )
        # TCP_NODELAY + keepalive (consolidated helper)
        _apply_vnc_socket_options(pve_ws.sock)

        logging.info("✓ Connected!")
        pve_ws.settimeout(0.1)

        bytes_sent = 0
        bytes_received = 0

        # Greenlet to read from Proxmox and send to client
        def proxmox_to_client():
            nonlocal bytes_received, running
            try:
                while running:
                    try:
                        data = pve_ws.recv()
                        if data:
                            bytes_received += len(data)
                            ws.send(data)
                    except websocket.WebSocketTimeoutException:
                        gsleep(0.01)
                    except websocket.WebSocketConnectionClosedException:
                        logging.info("Proxmox closed")
                        running = False
                        break
                    except Exception as e:
                        if running:
                            logging.error(f"PVE->Client error: {e}")
                        running = False
                        break
            except Exception as e:
                logging.error(f"proxmox_to_client crashed: {e}")
                running = False

        # Start the proxmox reader greenlet
        pve_reader = spawn(proxmox_to_client)

        logging.info("Step 4: Proxy running...")
        # Main loop: read from client, send to Proxmox
        while running:
            try:
                data = ws.receive(timeout=0.1)
                if data is None:
                    logging.info("Client disconnected")
                    running = False
                    break
                if data:
                    bytes_sent += len(data)
                    pve_ws.send(data)
            except TimeoutError:
                gsleep(0.01)
            except Exception as e:
                if "timed out" not in str(e).lower() and "timeout" not in str(e).lower():
                    logging.error(f"Client->PVE error: {e}")
                    running = False
                    break
                gsleep(0.01)

        running = False
        pve_reader.kill()

        logging.info(f"Session ended: sent {bytes_sent}, received {bytes_received}")
    except Exception as e:
        logging.exception(f"SSH proxy error: {type(e).__name__}: {e}")
    finally:
        running = False
        if pve_ws:
            with contextlib.suppress(Exception):
                pve_ws.close()
        logging.info(f"{'=' * 60}\n")


# Proxmox built-in termproxy (xterm.js) for LXC + QEMU.
# Same idea as the VNC proxy above but talks PVE's text-frame termproxy
# protocol instead of RFB. No second login: the ProxmoxVEx session is
# already trusted to act as the cluster admin user, so we log into PVE
# server-side, fetch the termproxy ticket, send the `user:ticket\n`
# handshake to PVE on behalf of the browser, then bidirectionally proxy
# bytes between the ProxmoxVEx client WS and the PVE WS.
#
# Wire protocol (verbatim from pve-xtermjs/src/www/main.js):
#   client → PVE  (after auth):  "0:<len>:<data>"  (xterm input bytes)
#                                "1:<cols>:<rows>:" (resize, no body)
#                                "2"               (keepalive, optional)
#   PVE → client (after auth):   raw text bytes (TTY output, no framing)
#                                first message after handshake: "OK"
#
# Our wrapper handles the framing on both sides so the browser-side
# component is plain xterm.js with no PVE-specific glue.
@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/termproxy", methods=["POST"])
@require_auth(perms=["vm.console"])
def get_termproxy_ticket_api(cluster_id, node, vm_type, vmid):
    """issues a PVE termproxy ticket for a VM/CT.

    Server-side: log into PVE with cluster credentials (NOT API token, since
    termproxy needs a real session cookie), POST /termproxy, return both the
    auth_ticket (used as PVEAuthCookie) and the termproxy_ticket (used as
    ?vncticket=) so the standalone WS server can complete the handshake.
    """
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404
    if vm_type not in ("qemu", "lxc"):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Unsupported vm_type"}), 400

    # H-1/H-2: per-VM gate (cluster access alone isn't enough for a console)
    from flask import g as _g

    _u = getattr(_g, "current_user", None)
    if _u is None:
        _u = get_db().get_user(request.session.get("user", "")) or {}
    _u = dict(_u)
    _u["username"] = request.session.get("user", "")
    _ok2, _why2 = _console_authz(_u, cluster_id, vmid, vm_type)
    if not _ok2:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: no access to this VM"}), 403

    mgr = cluster_managers[cluster_id]
    pve_pwd = getattr(mgr.config, "pass_", None) or getattr(mgr.config, "password", None)
    pve_usr = getattr(mgr.config, "user", None) or "root@pam"
    if not pve_pwd:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": "Cluster has no stored password — termproxy needs user/pass auth (API tokens cannot mint termproxy tickets)."
        }), 400

    import ssl as _ssl
    import urllib.request as _urlreq
    from urllib.parse import urlencode as _urlencode

    ssl_ctx = _ssl.create_default_context()
    # (CodeAnt) - gate TLS verify on the per-cluster ssl_verify flag
    # (default off: PVE ships self-signed; honoured when the admin enables it).
    _verify_tls = bool(getattr(mgr, "_ssl_verify", False))
    if not _verify_tls:
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = _ssl.CERT_NONE
    host, port = mgr.host, mgr.api_port

    # Step 1: real PVE session login
    try:
        login_req = _urlreq.Request(
            _pve_url(f"https://{host}:{port}/api2/json/access/ticket"),
            data=_urlencode({"username": pve_usr, "password": pve_pwd}).encode("utf-8"),
            method="POST",
        )
        with _urlreq.urlopen(login_req, context=ssl_ctx, timeout=10) as resp:
            login_result = json.loads(resp.read().decode("utf-8"))
        auth_ticket = login_result["data"]["ticket"]
        csrf_token = login_result["data"]["CSRFPreventionToken"]
        pve_login_user = login_result["data"].get("username") or pve_usr
    except Exception as e:
        logging.exception(f"[TERMPROXY-API] PVE login failed: {e}")
        # lgtm[py/reflected-xss]
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({
            "error": f"PVE login failed: {type(e).__name__}"
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)

    # Step 2: POST /termproxy with the session cookie
    try:
        if vm_type == "qemu":
            tp_url = f"https://{host}:{port}/api2/json/nodes/{node}/qemu/{vmid}/termproxy"
        else:
            tp_url = f"https://{host}:{port}/api2/json/nodes/{node}/lxc/{vmid}/termproxy"
        tp_req = _urlreq.Request(_pve_url(tp_url), data=b"", method="POST")
        tp_req.add_header("Cookie", f"PVEAuthCookie={auth_ticket}")
        tp_req.add_header("CSRFPreventionToken", csrf_token)
        with _urlreq.urlopen(tp_req, context=ssl_ctx, timeout=10) as resp:
            tp_result = json.loads(resp.read().decode("utf-8"))
        term_ticket = tp_result["data"]["ticket"]
        term_port = tp_result["data"]["port"]
        term_user = tp_result["data"].get("user") or pve_login_user
    except Exception as e:
        logging.exception(f"[TERMPROXY-API] termproxy ticket failed: {e}")
        # lgtm[py/reflected-xss]
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({
            "error": f"termproxy ticket failed: {type(e).__name__}"
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)

    log_audit(
        request.session.get("user", "unknown"),
        "vm.terminal",
        f"Terminal opened: {vm_type}/{vmid} on {node}",
        cluster=getattr(mgr.config, "name", cluster_id),
    )

    # 2026-06-05 (security audit C-1): the PVE session ticket (auth_ticket =
    # PVEAuthCookie = effectively root on pve:8006) is NO LONGER returned to the
    # browser. The standalone WS subprocess fetches it server-side via the
    # cluster-creds / ws-token-validate internal path right before the PVE WS
    # connect. Only the per-console termproxy ticket (scoped to this vmid:port)
    # leaves to the client.
    # lgtm[py/reflected-xss]
    return jsonify({
        "success": True,
        "host": host,
        "port": term_port,
        "ticket": term_ticket,
        "user": term_user,
        "node": node,
        "vmid": vmid,
        "vm_type": vm_type,
    })


def start_ssh_websocket_server(port=5002, ssl_cert=None, ssl_key=None, host="127.0.0.1"):
    """Start a dedicated WebSocket server for SSH terminal proxying

    runs as separate process to avoid gevent/asyncio conflicts.
    Gevent monkey-patches asyncio which breaks the websockets library.
    By using a subprocess, we get a clean Python interpreter.
    """
    import os
    import subprocess

    # Create a standalone script that runs the SSH WebSocket server
    server_script = '''#!/usr/bin/env python3
"""Standalone SSH WebSocket Server - runs without gevent"""
import asyncio
import contextlib
import json
import logging
import os
import re
import ssl
import sys
import warnings
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

warnings.filterwarnings('ignore')

PORT = int(os.environ.get('PROXMOXVEX_SSH_WS_PORT') or os.environ.get('SSH_WS_PORT', '5002'))
BIND_HOST = os.environ.get('PROXMOXVEX_SSH_WS_HOST') or os.environ.get('SSH_WS_HOST', '127.0.0.1')
SSL_CERT = os.environ.get('PROXMOXVEX_SSH_WS_SSL_CERT') or os.environ.get('SSH_WS_SSL_CERT', '')
SSL_KEY = os.environ.get('PROXMOXVEX_SSH_WS_SSL_KEY') or os.environ.get('SSH_WS_SSL_KEY', '')
# The standalone subprocess does not import vms.py; it needs its own copy of this constant.
_WS_FALLBACK_HOST = os.environ.get('PROXMOXVEX_WS_FALLBACK_HOST', '0.0.0.0')
ProxmoxVEx_URL = os.environ.get('PROXMOXVEX_URL') or 'http://127.0.0.1:5000'

# TLS verification for outbound ProxmoxVEx API calls.
# Defaults to True (verify). Set PROXMOXVEX_VERIFY_SSL=0 to disable explicitly.
VERIFY_SSL = os.environ.get('PROXMOXVEX_VERIFY_SSL', '1').strip().lower() not in ('0', 'false', 'no', 'off')

try:
    import paramiko
    import requests
    import urllib3
    import websockets
    urllib3.disable_warnings()
except ImportError as e:
    logging.info(f"Missing library: {e}")
    sys.exit(1)


def apply_ssh_host_key_policy(client, known_hosts_path=None):
    """Trust-on-first-use host key policy with persistent known_hosts storage.

    Mirrors ProxmoxVEx.utils.ssh.apply_ssh_host_key_policy so this standalone
    server can run without importing the full package.
    """
    path = known_hosts_path or os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        'config',
        '.ssh_known_hosts',
    )

    class _PersistentTOFUPolicy:
        def missing_host_key(self, client, hostname, key):
            with contextlib.suppress(Exception):
                client.get_host_keys().add(hostname, key.get_name(), key)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                client.save_host_keys(path)
                os.chmod(path, 0o600)

    if os.path.exists(path):
        with contextlib.suppress(Exception):
            client.load_host_keys(path)
    client.set_missing_host_key_policy(_PersistentTOFUPolicy())

async def ssh_handler(websocket):
    """SSH WebSocket handler with user credential prompt and SSH key support

    Supports both password and SSH key authentication
    Frontend can pre-fetch the IP and pass it as query parameter
    """
    path = websocket.request.path if hasattr(websocket, 'request') else websocket.path
    logging.info(f"SSH WebSocket connection: {path}")
    parsed = urlparse(path)
    query = parse_qs(parsed.query)
    ws_token = query.get('token', [None])[0]
    session_id = query.get('session', [None])[0]  # Backwards compat
    prefetched_ip = query.get('ip', [None])[0]  # IP pre-fetched by frontend
    if prefetched_ip:
        prefetched_ip = unquote(prefetched_ip)
        # (CodeAnt CWE-117) - prefetched_ip is unquoted user input; strip CR/LF so
        # it can't forge log lines (self-contained: this runs in the standalone WS subprocess).
        logging.info("Frontend provided IP: " + str(prefetched_ip).replace(chr(10), ' ').replace(chr(13), ' '))
    # Accept both shell and termproxy paths.
    # termproxy: /api/clusters/<cid>/vms/<node>/<vm_type>/<vmid>/termwebsocket
    #            with ?ticket=, ?port=, ?user=, ?host= from the frontend.
    m_term = re.match(r'/api/clusters/([^/]+)/vms/([^/]+)/(qemu|lxc)/([0-9]+)/termwebsocket', parsed.path)
    if m_term:
        await termproxy_handler(websocket, query, m_term, ws_token, session_id)
        return

    # Match both /shell and /shellws
    match = re.match(r'/api/clusters/([^/]+)/nodes/([^/]+)/shell(?:ws)?', parsed.path)
    if not match:
        logging.error(f"Invalid path: {parsed.path}")
        await websocket.send('{"status":"error","message":"Invalid path"}')
        await websocket.close(1008, "Invalid path")
        return

    cluster_id, node = match.groups()
    logging.info(f"Cluster: {cluster_id}, Node: {node}")
    # Prefer WS token auth (single-use, doesn't leak session)
    auth_token = ws_token or session_id
    if not auth_token:
        logging.info("No token or session provided")
        await websocket.send('{"status":"error","message":"No auth token provided"}')
        await websocket.close(1008, "No auth")
        return

    # Validate via main server. When called with ws_token + cluster_id,
    # the response now also carries `cluster_context` (host/node_ips/ssh_port) so we
    # don't need a second authenticated round-trip. The WS subprocess holds only the
    # consumed ws-token, no session cookie, so cluster-creds was previously
    # unreachable from here.
    node_ip = None
    cluster_host = None
    cluster_port = None
    node_ips = {}
    try:
        if ws_token:
            validate_url = (
                f"{ProxmoxVEx_URL}/api/ws/token/validate"
                f"?token={ws_token}&cluster_id={quote_plus(cluster_id)}&node={quote_plus(node)}"
            )
            logging.info(f"Validating WS token (cluster={cluster_id}, node={node})...")
        else:
            validate_url = f"{ProxmoxVEx_URL}/api/auth/validate"
            logging.info("Validating session (legacy)...")
        headers = {'X-Session-ID': session_id} if session_id else {}
        cookies = {'session': session_id} if session_id else {}
        # nosec B501 — localhost-to-ProxmoxVEx (ProxmoxVEx_URL = 127.0.0.1:port) with our
        # own self-signed cert. Same-host trust boundary; attacker with local
        # cert-read access already has more direct attack paths. 2026-06-04.
        r = requests.get(validate_url, cookies=cookies, headers=headers, timeout=8, verify=VERIFY_SSL)

        if r.status_code == 403:
            logging.error(f"Auth failed: 403 (no access to cluster {cluster_id})")
            await websocket.send(json.dumps({'status': 'error', 'message': f'No access to cluster {cluster_id}'}))
            await websocket.close(1008, "Forbidden")
            return
        if r.status_code != 200:
            logging.error(f"Auth failed: {r.status_code}")
            await websocket.send('{"status":"error","message":"Session ungültig - bitte neu einloggen"}')
            await websocket.close(1008, "Invalid auth")
            return

        # Pull the cluster context out of the validate response (ws-token path only)
        if ws_token:
            try:
                payload = r.json() or {}
                ctx = payload.get('cluster_context') or {}
                cluster_host = ctx.get('host')
                cluster_port = ctx.get('port')
                node_ips = ctx.get('node_ips') or {}
                node_ip = node_ips.get(node) or node_ips.get(node.lower())
                logging.info(f"validate→ host={cluster_host} node_ips={node_ips} resolved_node_ip={node_ip}")
            except Exception as e:
                logging.info(f"Could not parse validate payload: {e}")
        # Legacy session path: fall back to cluster-creds with the session cookie.
        if not ws_token and session_id:
            try:
                logging.info(f"Fetching cluster creds from: {ProxmoxVEx_URL}/api/internal/cluster-creds/{cluster_id}")
                # nosec B501 — same-host ProxmoxVEx self-signed cert, see 2026-06-04 audit
                rc = requests.get(f"{ProxmoxVEx_URL}/api/internal/cluster-creds/{cluster_id}",
                                  cookies={'session': session_id}, timeout=10, verify=VERIFY_SSL)
                if rc.status_code == 200:
                    creds = rc.json()
                    cluster_host = creds.get('host')
                    cluster_port = creds.get('port')
                    node_ips = creds.get('node_ips', {})
                    node_ip = node_ips.get(node) or node_ips.get(node.lower())
            except Exception as e:
                logging.info(f"Could not get node IP from API: {e}")
        logging.info("Auth successful")
    except requests.exceptions.ConnectionError as e:
        logging.error(f"Connection error to main server: {e}")
        # Never skip auth, even if main server is unreachable
        await websocket.send('{"status":"error","message":"Authentifizierung fehlgeschlagen - Server nicht erreichbar"}')
        await websocket.close(1011, "Auth server unreachable")
        return
    except Exception as e:
        logging.error(f"Auth error: {e}")
        await websocket.send('{"status":"error","message":"Authentifizierungsfehler"}')
        await websocket.close(1011, "Auth error")
        return

    # cluster_host fallback for node_ip (single-node setups where only the host
    # was registered).
    if not node_ip and cluster_host:
        node_ip = cluster_host
        logging.info(f"Using cluster host as fallback: {cluster_host}")
    if not cluster_port:
        cluster_port = 8006
    # (CodeAnt CWE-918) - build the SSH allow-list. prefetched_ip from
    # URL and user-supplied creds.host below must both be in this set; otherwise
    # an authenticated user could turn ProxmoxVEx into an SSH jump host for any
    # internal IP. Set comes from server-side resolution only.
    allowed_hosts = set()
    if cluster_host:
        allowed_hosts.add(cluster_host)
    allowed_hosts.update(v for v in (node_ips or {}).values() if v)

    if prefetched_ip:
        if prefetched_ip in allowed_hosts:
            node_ip = prefetched_ip
            logging.info(f"Using prefetched IP (allow-list match): {node_ip}")
        else:
            logging.info(f"REJECT prefetched ?ip={prefetched_ip!r} not in {sorted(allowed_hosts)}")
            await websocket.send(json.dumps({
                'status': 'error',
                'message': f"Prefetched IP {prefetched_ip!r} is not a known node of cluster {cluster_id}."
            }))
            await websocket.close(1008, "prefetched ip not allowed")
            return

    # If we still don't have an IP, allow manual entry (but allow-list still applies)
    allow_manual_ip = False
    if not node_ip:
        logging.info("No IP found - allowing manual entry")
        node_ip = ""  # Empty - user must provide
        allow_manual_ip = True

    logging.info(f"Final node IP for {node}: {node_ip or '(manual entry required)'}")
    logging.info(f"Allow-list for host override: {sorted(allowed_hosts) or '(empty - no manual override permitted)'}")
    # Send need_credentials status - frontend will show login dialog
    await websocket.send(json.dumps({
        'status': 'need_credentials',
        'node': node,
        'ip': node_ip,
        'allowManualIp': allow_manual_ip
    }))

    # Wait for credentials from user
    try:
        creds_msg = await asyncio.wait_for(websocket.recv(), timeout=300)
        creds = json.loads(creds_msg)
        ssh_user = creds.get('username', 'root')
        ssh_pass = creds.get('password', '')
        ssh_key = creds.get('privateKey', '')

        # (CodeAnt CWE-918) - host override is gated by allow_hosts.
        # Empty set rejects all overrides (no-resolved-cluster case).
        user_ip = creds.get('host', '').strip()
        if user_ip:
            if user_ip not in allowed_hosts:
                logging.info(f"REJECT user host override: {user_ip!r} not in {sorted(allowed_hosts)}")
                await websocket.send(json.dumps({
                    'status': 'error',
                    'message': f"Host {user_ip!r} is not a known node of cluster {cluster_id}. Manual override blocked."
                }))
                await websocket.close(1008, "host not allowed")
                return
            node_ip = user_ip
            logging.info(f"Using user-provided IP (allow-list match): {node_ip}")
        if not node_ip:
            await websocket.send('{"status":"error","message":"Host/IP address required"}')
            return

        if not ssh_pass and not ssh_key:
            await websocket.send('{"status":"error","message":"Password or SSH key required"}')
            return

    except asyncio.TimeoutError:
        await websocket.send('{"status":"error","message":"Login timeout"}')
        await websocket.close(1008, "Timeout")
        return
    except Exception as e:
        logging.error(f"Credentials receive error: {e}")
        await websocket.send('{"status":"error","message":"Failed to receive credentials"}')
        return

    # Send connecting status
    await websocket.send('{"status":"connecting"}')

    # Connect SSH
    ssh = paramiko.SSHClient()
    apply_ssh_host_key_policy(ssh)

    try:
        logging.info(f"Connecting SSH to {ssh_user}@{node_ip}...")
        # Try SSH key authentication first if provided
        if ssh_key:
            try:
                import io
                # Parse the private key
                key_file = io.StringIO(ssh_key)

                # Try different key types
                pkey = None
                for key_class in [paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey, getattr(paramiko, 'DSSKey', None)]:
                    if key_class is None:
                        continue
                    try:
                        key_file.seek(0)
                        pkey = key_class.from_private_key(key_file, password=ssh_pass if ssh_pass else None)
                        break
                    except Exception as _e:
                        continue

                if pkey:
                    logging.info("Using SSH key authentication")
                    ssh.connect(node_ip, port=22, username=ssh_user, pkey=pkey, timeout=10, look_for_keys=False, allow_agent=False)
                else:
                    raise Exception("Could not parse SSH key - unsupported format")

            except Exception as key_error:
                logging.error(f"SSH key auth failed: {key_error}")
                await websocket.send(f'{{"status":"error","message":"SSH key error: {str(key_error)}"}}')
                return
        else:
            # Password authentication
            ssh.connect(node_ip, port=22, username=ssh_user, password=ssh_pass, timeout=10, look_for_keys=False, allow_agent=False)

        channel = ssh.invoke_shell(term='xterm-256color', width=120, height=40)
        channel.settimeout(0.1)

        logging.info(f"SSH connected: {cluster_id}/{node}")
        # Send connected status - frontend will clear terminal
        await websocket.send('{"status":"connected"}')

        async def ssh_to_ws():
            while True:
                try:
                    if channel.recv_ready():
                        data = channel.recv(4096)
                        if data:
                            await websocket.send(data.decode('utf-8', errors='replace'))
                    await asyncio.sleep(0.01)
                except Exception as _e:
                    break

        async def ws_to_ssh():
            with contextlib.suppress(Exception):
                async for message in websocket:
                    if isinstance(message, str):
                        if message.startswith('{"type":"resize"'):
                            with contextlib.suppress(Exception):
                                data = json.loads(message)
                                if data.get('type') == 'resize':
                                    channel.resize_pty(width=data.get('cols', 120), height=data.get('rows', 40))
                        elif message.startswith('{'):
                            # Ignore other JSON messages (like old credential format)
                            pass
                        else:
                            channel.send(message)
                    else:
                        channel.send(message)

        await asyncio.gather(ssh_to_ws(), ws_to_ssh(), return_exceptions=True)
    except paramiko.AuthenticationException as e:
        logging.error(f"SSH auth failed: {e}")
        await websocket.send('\\r\\n\\x1b[31mSSH Authentication Failed\\x1b[0m\\r\\nCheck cluster credentials.\\r\\n')
    except Exception as e:
        logging.error(f"SSH error: {e}")
        with contextlib.suppress(Exception):
            await websocket.send(f"\\r\\n\\x1b[31mSSH Error: {e}\\x1b[0m\\r\\n")
    finally:
        with contextlib.suppress(Exception):
            ssh.close()
        logging.info(f"SSH disconnected: {cluster_id}/{node}")
# Proxmox termproxy proxy.
# Frontend has already POSTed /termproxy on the main app and got a ticket.
# It sends the ticket+port+host+user as query params on the WS open.
# We connect to PVE's vncwebsocket with that ticket, send the
# `user:ticket\\n` handshake, wait for "OK", then proxy bytes both ways.
# No SSH, no second login — the cluster auth happens server-side at the
# /termproxy POST step.
async def termproxy_handler(client_ws, query, m_term, ws_token, session_id):
    cluster_id, node, vm_type, vmid_str = m_term.groups()
    logging.info(f"[TERMPROXY] {vm_type}/{vmid_str} on {node} cluster={cluster_id}")
    auth_token = ws_token or session_id
    if not auth_token:
        await client_ws.send('{"status":"error","message":"No auth token"}')
        await client_ws.close(1008, "No auth")
        return

    # Validate via main server (cluster-scope check + inline cluster context)
    # Response carries cluster_context so we don't need a second
    # authenticated round-trip from the WS subprocess.
    validate_payload = {}
    try:
        if ws_token:
            validate_url = (
                f"{ProxmoxVEx_URL}/api/ws/token/validate"
                f"?token={ws_token}&cluster_id={quote_plus(cluster_id)}&node={quote_plus(node)}"
            )
        else:
            validate_url = f"{ProxmoxVEx_URL}/api/auth/validate"
        headers = {'X-Session-ID': session_id} if session_id else {}
        cookies = {'session': session_id} if session_id else {}
        # nosec B501 — localhost-to-ProxmoxVEx (ProxmoxVEx_URL = 127.0.0.1:port) with our
        # own self-signed cert. Same-host trust boundary; attacker with local
        # cert-read access already has more direct attack paths. 2026-06-04.
        r = requests.get(validate_url, cookies=cookies, headers=headers, timeout=8, verify=VERIFY_SSL)
        if r.status_code == 403:
            await client_ws.send(json.dumps({'status': 'error', 'message': f'No access to cluster {cluster_id}'}))
            await client_ws.close(1008, "Forbidden")
            return
        if r.status_code != 200:
            await client_ws.send('{"status":"error","message":"Invalid session"}')
            await client_ws.close(1008, "auth")
            return
        try:
            validate_payload = r.json() or {}
        except Exception as _e:
            validate_payload = {}
    except Exception as e:
        logging.error(f"[TERMPROXY] auth validate failed: {e}")
        await client_ws.send('{"status":"error","message":"Auth server unreachable"}')
        await client_ws.close(1011, "auth")
        return

    # Frontend gave us the termproxy ticket+port already (via POST /termproxy).
    # 2026-06-05 (security audit C-1): the PVE session cookie (auth_ticket =
    # PVEAuthCookie, effectively root on pve:8006) is NO LONGER taken from the
    # browser query — we resolve it server-side below from the validate /
    # cluster-creds cluster_context.
    pve_ticket = query.get('ticket', [None])[0]
    pve_port = query.get('port', [None])[0]
    pve_host = query.get('host', [None])[0]
    pve_user = query.get('user', [None])[0]
    pve_auth = None  # resolved server-side from cluster_context, see below
    if not (pve_ticket and pve_port and pve_host and pve_user):
        logging.info(f"[TERMPROXY] missing query params; got: ticket={bool(pve_ticket)} port={pve_port} host={pve_host} user={pve_user}")
        await client_ws.send('{"status":"error","message":"Missing termproxy params"}')
        await client_ws.close(1008, "params")
        return

    pve_ticket = unquote(pve_ticket)
    pve_user = unquote(pve_user)
    pve_host = unquote(pve_host)

    # (CodeAnt CWE-918) - SSRF gate. Use the cluster_context already
    # returned by the validate call; fall back to cluster-creds only on the legacy
    # session-cookie path (ws-token flow has no session cookie to authenticate it).
    allowed_hosts = set()
    ctx = (validate_payload or {}).get('cluster_context') or {}
    if ctx.get('host'):
        allowed_hosts.add(ctx['host'])
    allowed_hosts.update(v for v in (ctx.get('node_ips') or {}).values() if v)
    # C-1: server-side PVE session cookie (ws-token flow)
    if ctx.get('pve_auth_ticket'):
        pve_auth = ctx['pve_auth_ticket']
    # 2026-06-04: pull per-cluster ssl_verify out of the same context for
    # the PVE wss-proxy below. Defaults to False because PVE ships self-signed
    # certs and most labs run them. Admins toggle on once they've installed
    # a real cert + the cluster's `ssl_verify` config field is true.
    verify_pve_tls = bool(ctx.get('verify_pve_tls', False))
    if not allowed_hosts and session_id:
        try:
            cr = requests.get(f"{ProxmoxVEx_URL}/api/internal/cluster-creds/{cluster_id}",
                              cookies={'session': session_id}, timeout=10, verify=VERIFY_SSL)  # nosec B501 — localhost-to-ProxmoxVEx self-signed cert; same-host trust boundary, see 2026-06-04 audit
            if cr.status_code == 200:
                cr_data = cr.json() or {}
                if cr_data.get('host'):
                    allowed_hosts.add(cr_data['host'])
                allowed_hosts.update(v for v in (cr_data.get('node_ips') or {}).values() if v)
                # Honour the cluster-side ssl_verify flag from the creds payload.
                if 'verify_pve_tls' in cr_data:
                    verify_pve_tls = bool(cr_data['verify_pve_tls'])
                # C-1: server-side PVE session cookie (session-cookie flow)
                if cr_data.get('pve_auth_ticket'):
                    pve_auth = cr_data['pve_auth_ticket']
            else:
                logging.info(f"[TERMPROXY] cluster-creds non-200 ({cr.status_code}); allow-list empty")
        except Exception as e:
            logging.error(f"[TERMPROXY] cluster-creds legacy fetch failed: {e}")
    if pve_host not in allowed_hosts:
        logging.info(f"[TERMPROXY] REJECT host {pve_host!r} (not in {sorted(allowed_hosts)})")
        await client_ws.send(json.dumps({
            'status': 'error',
            'message': f"Host {pve_host!r} is not a known node of cluster {cluster_id}."
        }))
        await client_ws.close(1008, "host not allowed")
        return

    # C-1: the PVE session cookie must have come from the server-side
    # cluster_context (not the browser). If it's missing the cluster has no
    # password auth (termproxy can't work) or the mint failed — fail closed.
    if not pve_auth:
        logging.info(f"[TERMPROXY] no server-side PVE auth ticket for cluster {cluster_id}")
        await client_ws.send('{"status":"error","message":"Console auth unavailable for this cluster (needs user/password auth)"}')
        await client_ws.close(1011, "no-pve-auth")
        return

    # Connect to PVE WS — Cookie uses session auth ticket; URL uses termproxy ticket.
    pve_path = f"/api2/json/nodes/{node}/{vm_type}/{vmid_str}/vncwebsocket?port={pve_port}&vncticket={quote_plus(pve_ticket)}"
    pve_url = f"wss://{pve_host}:8006{pve_path}"
    # (CodeAnt sensitive-data-in-url) - never log the vncticket (a live PVE console
    # credential in the query string); redact it (self-contained: runs in the WS subprocess).
    logging.info("[TERMPROXY] connecting to PVE: " + pve_url.split('vncticket=')[0] + "vncticket=[REDACTED]")
    # 2026-06-04: TLS verify is gated by the per-cluster ssl_verify flag
    # (exposed via /api/internal/cluster-creds as `verify_pve_tls`). Default
    # is False because PVE ships self-signed certs by default; admins flip
    # it on once they have a real cert + uploaded the CA. Hard-disabling
    # check_hostname + verify_mode used to be unconditional — now it's the
    # opt-out path with a logged warning so cert posture is observable.
    pve_ssl = ssl.create_default_context()
    if not verify_pve_tls:
        pve_ssl.check_hostname = False
        pve_ssl.verify_mode = ssl.CERT_NONE
        logging.info(f"[TERMPROXY] TLS verify DISABLED for PVE host {pve_host!r} (cluster ssl_verify=false)")
    try:
        pve_ws = await websockets.connect(
            pve_url,
            additional_headers={'Cookie': f'PVEAuthCookie={pve_auth}'},
            ssl=pve_ssl,
            open_timeout=10,
        )
    except Exception as e:
        logging.error(f"[TERMPROXY] PVE WS connect failed: {type(e).__name__}: {e}")
        await client_ws.send(f'{{"status":"error","message":"PVE WS connect failed: {type(e).__name__}"}}')
        await client_ws.close(1011, "pve")
        return

    # Send PVE auth handshake: user:ticket\\n
    try:
        await pve_ws.send(f"{pve_user}:{pve_ticket}\\n")
        first = await asyncio.wait_for(pve_ws.recv(), timeout=5.0)
        first_str = first.decode('utf-8', errors='replace') if isinstance(first, (bytes, bytearray)) else (first or '')
        if not first_str.startswith('OK'):
            logging.info(f"[TERMPROXY] PVE rejected handshake: {first_str!r}")
            await client_ws.send(f'{{"status":"error","message":"PVE rejected: {first_str[:80]!r}"}}')
            await pve_ws.close()
            await client_ws.close(1011, "pve-auth")
            return
        logging.info("[TERMPROXY] PVE handshake OK")
    except Exception as e:
        logging.error(f"[TERMPROXY] handshake error: {type(e).__name__}: {e}")
        await client_ws.send(f'{{"status":"error","message":"handshake error: {type(e).__name__}"}}')
        try:
            await pve_ws.close()
        except Exception as _e:
            logging.debug(f"[TERMPROXY] pve_ws.close() failed: {_e}")
        await client_ws.close(1011, "handshake")
        return

    await client_ws.send('{"status":"connected"}')

    # Bidirectional proxy
    async def pve_to_client():
        try:
            async for msg in pve_ws:
                # PVE termproxy sends raw bytes (TTY output)
                if isinstance(msg, (bytes, bytearray)):
                    await client_ws.send(msg.decode('utf-8', errors='replace'))
                else:
                    await client_ws.send(msg)
        except Exception as e:
            logging.info(f"[TERMPROXY] PVE→client: {type(e).__name__}: {e}")
    async def client_to_pve():
        try:
            async for msg in client_ws:
                if isinstance(msg, str):
                    # Resize protocol: JSON {type:'resize', cols, rows}
                    if msg.startswith('{'):
                        with contextlib.suppress(Exception):
                            j = json.loads(msg)
                            if j.get('type') == 'resize':
                                cols = int(j.get('cols', 80))
                                rows = int(j.get('rows', 24))
                                await pve_ws.send(f"1:{cols}:{rows}:")
                                continue
                    payload_len = len(msg.encode('utf-8'))
                    await pve_ws.send(f"0:{payload_len}:{msg}")
                else:
                    try:
                        text = msg.decode('utf-8')
                    except Exception as _e:
                        text = msg.decode('latin-1', errors='replace')
                    await pve_ws.send(f"0:{len(msg)}:{text}")
        except Exception as e:
            logging.info(f"[TERMPROXY] client→PVE: {type(e).__name__}: {e}")
    try:
        await asyncio.gather(pve_to_client(), client_to_pve(), return_exceptions=True)
    finally:
        try:
            await pve_ws.close()
        except Exception as _e:
            logging.debug(f"[TERMPROXY] pve_ws.close() failed: {_e}")
        logging.info(f"[TERMPROXY] session ended {vm_type}/{vmid_str}")
async def main():
    ssl_context = None
    if SSL_CERT and SSL_KEY and os.path.exists(SSL_CERT) and os.path.exists(SSL_KEY):
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(SSL_CERT, SSL_KEY)

    # Issue #71/#95: empty host = all interfaces (dual-stack IPv4+IPv6)
    ws_host = BIND_HOST if BIND_HOST else _WS_FALLBACK_HOST
    display_host = BIND_HOST or _WS_FALLBACK_HOST
    # (#388): wire the lenient_process_request hook so PVE 9.1.x
    # hosts (and any middlebox that strips the Upgrade token from Connection)
    # don't trigger InvalidUpgrade at SSH WS handshake. Was only on VNC before.
    # crcro on issue #388 reported the exact SSH-WS InvalidUpgrade trace this fixes.
    _lpr_ssh = None
    try:
        sys.path.insert(0, os.environ.get('PROXMOXVEX_PKG_BASE') or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        from ProxmoxVEx.utils.ws_lenient import lenient_process_request as _lpr_ssh
    except Exception as _e:
        logging.warning(f"[SSH-WS] WARNING: lenient_process_request not importable ({_e}) — strict handshake only")
    serve_kwargs = {'ssl': ssl_context, 'compression': None, 'ping_interval': 30, 'ping_timeout': 10}
    if _lpr_ssh is not None:
        serve_kwargs['process_request'] = _lpr_ssh
    try:
        async with websockets.serve(ssh_handler, ws_host, PORT, **serve_kwargs):
            logging.info(f"SSH WebSocket server ready on {display_host}:{PORT} (lenient-hook={_lpr_ssh is not None})")
            await asyncio.Future()
    except OSError as e:
        if ':' in str(display_host):
            logging.error(f"SSH WebSocket: IPv6 bind failed ({e}), falling back to {_WS_FALLBACK_HOST}")
            async with websockets.serve(ssh_handler, _WS_FALLBACK_HOST, PORT, **serve_kwargs):
                logging.info(f"SSH WebSocket server ready on {_WS_FALLBACK_HOST}:{PORT}")
                await asyncio.Future()
        else:
            raise

if __name__ == '__main__':
    asyncio.run(main())
'''

    # Write the helper script where the service user can actually write.
    # 2026-06-09 (#528 akagoldsmith): the Debian package lives under
    # /usr/lib/ProxmoxVEx (root-owned, read-only for the ProxmoxVEx service user), so
    # writing into the package's api/ dir failed with EACCES and the SSH-WS
    # subprocess never started — port 5002 stayed dead. Fall back to a writable dir;
    # the subprocess gets the package base via PROXMOXVEX_PKG_BASE below so its
    # `import ProxmoxVEx.*` still resolves from wherever the script ends up.
    import tempfile

    pkg_base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if not os.access(script_dir, os.W_OK):
        script_dir = tempfile.gettempdir()
    script_path = os.path.join(script_dir, ".ssh_ws_server.py")

    from ProxmoxVEx.utils.server_control import kill_existing_on_port

    try:
        kill_existing_on_port(port, "tcp")

        with open(script_path, "w") as f:
            f.write(server_script)

        # Set environment variables for the subprocess
        env = os.environ.copy()
        env["PROXMOXVEX_PKG_BASE"] = pkg_base  # #528: subprocess may live outside the pkg dir now
        env["SSH_WS_PORT"] = str(port)
        env["SSH_WS_HOST"] = host  # Issue #71: IPv6 support
        main_port = port - 2
        env["ProxmoxVEx_URL"] = f"https://127.0.0.1:{main_port}" if ssl_cert else f"http://127.0.0.1:{main_port}"
        if ssl_cert:
            env["SSH_WS_SSL_CERT"] = ssl_cert
        if ssl_key:
            env["SSH_WS_SSL_KEY"] = ssl_key

        # Start as subprocess (completely separate process, no gevent)
        # Use same working directory as main server
        proc = subprocess.Popen(
            [sys.executable, script_path],
            env=env,
            cwd=os.getcwd(),  # Ensure same working dir for config file access
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

        # Read output in background
        def read_output():
            for line in proc.stdout:
                line = line.decode("utf-8", errors="replace").strip()
                if line:
                    logging.info(f"[SSH-WS] {line}")

        import threading

        output_thread = threading.Thread(target=read_output, daemon=True)
        output_thread.start()

        logging.info(f"SSH WebSocket server subprocess started (PID: {proc.pid})")
    except Exception as e:
        logging.error(f"Failed to start SSH WebSocket server: {e}")


# Terminal/Shell WebSocket proxy (legacy - flask-sock version, kept for non-gevent setups)
@sock.route("/api/clusters/<cluster_id>/nodes/<node>/shellws")
def node_shell_websocket_proxy(ws, cluster_id, node):
    """WebSocket proxy for node shell via SSH"""

    # Feb 2026: Authentication + authorization (was missing entirely - critical security fix)
    # Prefer single-use WS token, session as legacy fallback
    from ProxmoxVEx.utils.realtime import validate_ws_token

    ws_token = request.args.get("token")
    session_id = request.args.get("session")

    if ws_token:
        token_data = validate_ws_token(ws_token)
        if not token_data:
            logging.error("SHELL WS: Invalid or expired token")
            with contextlib.suppress(Exception):
                ws.send('{"status":"error","message":"Invalid or expired token"}')
            return
        session = {"user": token_data["user"]}
    elif session_id:
        valid_session = validate_session(session_id)
        if not valid_session:
            logging.error("SHELL WS: Invalid session")
            with contextlib.suppress(Exception):
                ws.send('{"status":"error","message":"Invalid session"}')
            return
        session = valid_session
    else:
        logging.error("SHELL WS: No token or session provided")
        with contextlib.suppress(Exception):
            ws.send('{"status":"error","message":"Authentication required"}')
        return

    # Check permissions - require node.shell or admin role
    users = load_users()
    user = users.get(session["user"], {})
    user_perms = get_user_permissions(user)
    # 2026-06-10 (RBAC): gate on the node.shell perm only - admin holds it via
    # all-perms so the explicit admin bypass was redundant; a custom role with node.shell now works.
    if "node.shell" not in user_perms:
        logging.error(f"SHELL WS: User {session['user']} lacks node.shell permission")
        with contextlib.suppress(Exception):
            ws.send('{"status":"error","message":"Permission denied"}')
        return

    # Check cluster access based on user's allowed clusters
    from ProxmoxVEx.utils.rbac import get_user_clusters

    allowed_clusters = get_user_clusters(user)
    if allowed_clusters is not None and cluster_id not in allowed_clusters:
        logging.error(f"SHELL WS: User {session['user']} denied access to cluster {cluster_id}")
        with contextlib.suppress(Exception):
            ws.send('{"status":"error","message":"Access denied to this cluster"}')
        return

    logging.info(f"SHELL WS: User {session['user']} authenticated for shell on {cluster_id}/{node}")

    logging.info("")
    logging.info("========================================")
    logging.info(f"SSH SHELL: {cluster_id}/{node}")
    logging.info("========================================")

    # Check paramiko availability first
    try:
        import paramiko
    except ImportError:
        logging.error("paramiko not installed!")
        with contextlib.suppress(Exception):
            ws.send('{"status":"error","message":"SSH library (paramiko) not installed on server"}')
        return

    if cluster_id not in cluster_managers:
        logging.error(f"Cluster {cluster_id} not found")
        with contextlib.suppress(Exception):
            ws.send('{"status":"error","message":"Cluster not found"}')
        return

    manager = cluster_managers[cluster_id]
    cluster_host = manager.config.host
    cluster_port = getattr(manager.config, "port", 8006)

    # Get node IP address from cluster status
    logging.info(f"Step 1: Getting IP for node {node}...")

    # First authenticate with cluster
    if not manager.connect_to_proxmox():
        logging.error("Failed to authenticate with cluster!")
        with contextlib.suppress(Exception):
            ws.send('{"status":"error","message":"Cluster auth failed"}')
        return

    node_ip = None
    try:
        cluster_url = f"https://{cluster_host}:{cluster_port}/api2/json/cluster/status"
        cluster_response = manager._create_session().get(cluster_url, timeout=5)
        if cluster_response.status_code == 200:
            cluster_data = cluster_response.json().get("data", [])
            for item in cluster_data:
                if item.get("type") == "node" and item.get("name") == node:
                    node_ip = item.get("ip")
                    logging.info(f"  Found node IP: {node_ip}")
                    break
    except Exception as e:
        logging.error(f"  Error getting cluster status: {e}")

    if not node_ip:
        prefetched_ip = (request.args.get("ip") or "").strip()
        if prefetched_ip:
            node_ip = prefetched_ip
            logging.info(f"  Using frontend-provided IP: {node_ip}")

    if not node_ip:
        node_ip = cluster_host
        logging.info(f"  Using cluster host: {node_ip}")

    # Request credentials from client
    try:
        ws.send(f'{{"status":"need_credentials","node":"{node}","ip":"{node_ip}"}}')
    except Exception as e:
        logging.error(f"Failed to send need_credentials: {e}")
        return

    logging.info("Step 2: Waiting for SSH credentials...")

    # Wait for credentials from client
    try:
        cred_msg = ws.receive(timeout=60)
        if not cred_msg:
            logging.error("No credentials received")
            return

        creds = json.loads(cred_msg)
        ssh_user = creds.get("username", "root")
        ssh_pass = creds.get("password", "")
        ssh_key = creds.get("privateKey", "")
        user_host = (creds.get("host") or "").strip()
        if user_host:
            node_ip = user_host
            logging.info(f"  Using user-provided host: {node_ip}")

        if not ssh_pass and not ssh_key:
            with contextlib.suppress(Exception):
                ws.send('{"status":"error","message":"Password or SSH key required"}')
            return

        logging.info(f"  Got credentials for user: {ssh_user}")

    except Exception as e:
        logging.error(f"Error receiving credentials: {e}")
        with contextlib.suppress(Exception):
            ws.send('{"status":"error","message":"Credentials timeout"}')
        return

    # Tell client we're connecting
    try:
        ws.send('{"status":"connecting"}')
    except Exception as _e:
        return

    logging.info(f"Step 3: Connecting SSH to {ssh_user}@{node_ip}...")

    try:
        # Create SSH client
        ssh = paramiko.SSHClient()
        apply_ssh_host_key_policy(ssh)

        # Prefer SSH key authentication if a key was provided
        if ssh_key:
            import io

            key_file = io.StringIO(ssh_key)
            pkey = None
            for key_class in [
                paramiko.RSAKey,
                paramiko.Ed25519Key,
                paramiko.ECDSAKey,
                getattr(paramiko, "DSSKey", None),
            ]:
                if key_class is None:
                    continue
                try:
                    key_file.seek(0)
                    pkey = key_class.from_private_key(key_file, password=ssh_pass if ssh_pass else None)
                    break
                except Exception:
                    continue
            if pkey is None:
                with contextlib.suppress(Exception):
                    ws.send('{"status":"error","message":"Could not parse SSH key"}')
                return
            ssh.connect(
                hostname=node_ip,
                port=22,
                username=ssh_user,
                pkey=pkey,
                timeout=30,
                allow_agent=False,
                look_for_keys=False,
            )
        else:
            # Password authentication
            ssh.connect(
                hostname=node_ip,
                port=22,
                username=ssh_user,
                password=ssh_pass,
                timeout=30,
                allow_agent=False,
                look_for_keys=False,
            )

        logging.info("Step 4: SSH connected! Opening shell...")

        # Get interactive shell
        channel = ssh.invoke_shell(term="xterm-256color", width=120, height=40)
        channel.settimeout(0.1)

        ws.send('{"status":"connected"}')
        logging.info("Step 5: Shell ready!")

        stop_event = threading.Event()

        # Thread: SSH -> WebSocket
        def ssh_to_ws():
            try:
                while not stop_event.is_set():
                    try:
                        if channel.recv_ready():
                            data = channel.recv(4096)
                            if data:
                                ws.send(data)
                        else:
                            import time

                            time.sleep(0.01)
                    except socket.timeout:
                        continue
                    except Exception as e:
                        logging.error(f"SSH recv error: {e}")
                        break
            except Exception as _e:
                pass
            finally:
                stop_event.set()

        ssh_thread = threading.Thread(target=ssh_to_ws)
        ssh_thread.daemon = True
        ssh_thread.start()

        # Main loop: WebSocket -> SSH
        while not stop_event.is_set():
            try:
                data = ws.receive()
                if data is None:
                    logging.info("Client disconnected")
                    break

                # Handle JSON messages
                if isinstance(data, str) and data.startswith("{"):
                    try:
                        msg = json.loads(data)
                        # Handle resize
                        if msg.get("type") == "resize":
                            channel.resize_pty(width=msg.get("cols", 120), height=msg.get("rows", 40))
                        continue
                    except Exception as _e:
                        pass

                # Send to SSH
                if isinstance(data, str):
                    channel.send(data)
                else:
                    channel.send(data)

            except Exception as e:
                logging.error(f"WS recv error: {e}")
                break

        stop_event.set()

    except paramiko.AuthenticationException:
        logging.error("SSH authentication failed!")
        ws.send('{"status":"error","message":"SSH login failed - wrong username or password"}')
    except paramiko.SSHException as e:
        logging.error(f"SSH error: {e}")
        ws.send(f'{{"status":"error","message":"SSH error: {str(e)}"}}')
    except Exception as e:
        logging.exception(f"Shell error: {e}")
        ws.send(f'{{"status":"error","message":"{str(e)}"}}')
    finally:
        with contextlib.suppress(Exception):
            channel.close()
        with contextlib.suppress(Exception):
            ssh.close()
        logging.info("========================================")
        logging.info(f"SSH SESSION ENDED: {node}")
        logging.info("========================================")


# Migration API Routes
@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/migrate", methods=["POST"])
@require_auth(perms=["vm.migrate"])
def migrate_vm_api(cluster_id, node, vm_type, vmid):
    """Migrate a VM or container to another node"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    # Check pool permission for vm.migrate
    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    if not user_can_access_vm(user, cluster_id, vmid, "vm.migrate", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.migrate"}), 403

    try:
        manager = cluster_managers[cluster_id]
        data = request.json or {}
        target_node = data.get("target")
        online = data.get("online", True)

        if not target_node:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "Target node is required"}), 400

        target_storage = data.get("targetstorage")
        with_local_disks = data.get("with-local-disks", False)
        force = data.get("force", False)  # For conntrack state in containers

        # Affinity rule enforcement (Issue
        from ProxmoxVEx.api.history import check_affinity_violation

        aff = check_affinity_violation(cluster_id, vmid, target_node)
        if aff.get("violation"):
            if aff.get("enforce"):
                # lgtm[py/reflected-xss]
                return jsonify({
                    "error": f"Migration blocked by affinity rule '{aff['rule']}': {aff['message']}",
                    "affinity_violation": True,
                    "rule": aff["rule"],
                }), 409
            else:
                # Just warn, don't block
                logging.warning(f"Affinity warning for VMID {vmid} -> {target_node}: {aff['message']} (not enforced)")

        migrate_options = {
            "online": online,
            "targetstorage": target_storage,
            "with_local_disks": with_local_disks,
            "force": force,
        }
        result = manager.migrate_vm_manual(node, vmid, vm_type, target_node, online, migrate_options)

        if result.get("success"):
            # Audit log
            user = getattr(request, "session", {}).get("user", "system")
            details = f"{vm_type.upper()} {vmid} migrated from {node} to {target_node}"
            if online:
                details += " (online)"
            log_audit(user, "vm.migrated", details, cluster=manager.config.name)

            # Register ProxmoxVEx user for this task
            upid = result.get("upid") or result.get("task") or result.get("data")
            if upid:
                register_task_user(upid, user, cluster_id)

            push_immediate_update(cluster_id, delay=0.5)
            # lgtm[py/reflected-xss]
            return jsonify(result)
        else:
            # lgtm[py/reflected-xss]
            return jsonify(result), 400
    except Exception as e:
        logging.error(f"[MIGRATE] Unhandled error migrating {vm_type}/{vmid}: {e}", exc_info=True)
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Migration failed"}), 500


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>", methods=["DELETE"])
@require_auth(perms=["vm.delete"])
def delete_vm_api(cluster_id, node, vm_type, vmid):
    # tenant check
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    # Check pool permission for vm.delete
    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    if not user_can_access_vm(user, cluster_id, vmid, "vm.delete", vm_type):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Permission denied: vm.delete"}), 403

    manager = cluster_managers[cluster_id]
    data = request.json or {}
    purge = data.get("purge", False)
    destroy_unreferenced = data.get("destroyUnreferenced", False)

    result = manager.delete_vm(node, vmid, vm_type, purge, destroy_unreferenced)

    if result.get("success"):
        usr = getattr(request, "session", {}).get("user", "system")
        log_audit(
            usr,
            "vm.deleted",
            f"{vm_type.upper()} {vmid} deleted from {node}" + (" (purged)" if purge else ""),
            cluster=manager.config.name,
        )
        broadcast_action("delete", vm_type, str(vmid), {"node": node, "purge": purge}, cluster_id, usr)

        # Register ProxmoxVEx user for this task
        upid = result.get("task") or result.get("upid") or result.get("data")
        if upid:
            register_task_user(upid, usr, cluster_id)

        # Push immediate update for live UI
        push_immediate_update(cluster_id, delay=0.5)

        # lgtm[py/reflected-xss]
        return jsonify({"message": f"{vm_type.upper()} {vmid} deleted", "task": result.get("task")})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result.get("error", "Delete failed")
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/vms/bulk-migrate", methods=["POST"])
@require_auth(perms=["vm.migrate"])
def bulk_migrate_api(cluster_id):
    """Migrate multiple VMs at once"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    data = request.json or {}
    vms = data.get("vms", [])  # List of {node, vmid, type}
    # (pentest DoS) - cap the batch so one request can't fan out unbounded
    # per-VM cluster-walk + SQLCipher work (a 10 MB body could carry tens of thousands
    # of entries). 1000 is far above any realistic bulk migrate; split larger jobs.
    if isinstance(vms, list) and len(vms) > 1000:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Too many VMs in one request (max 1000). Split into smaller batches."}), 400
    target_node = data.get("target")
    online = data.get("online", True)

    if not target_node:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Target node is required"}), 400

    if not vms:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "No VMs specified"}), 400

    user = getattr(request, "session", {}).get("user", "system")
    log_audit(user, "vm.bulk_migrated", f"Bulk migration of {len(vms)} VMs to {target_node}", cluster=mgr.config.name)

    # Enforced violations skip that VM but don't abort the whole batch
    from ProxmoxVEx.api.history import check_affinity_violation

    results = []
    for vm in vms:
        # Affinity check per VM
        aff = check_affinity_violation(cluster_id, vm["vmid"], target_node)
        if aff.get("violation") and aff.get("enforce"):
            results.append({
                "vmid": vm["vmid"],
                "success": False,
                "task": None,
                "error": f"Blocked by affinity rule '{aff['rule']}': {aff['message']}",
            })
            continue
        elif aff.get("violation"):
            logging.warning(f"Affinity warning for VMID {vm['vmid']} -> {target_node}: {aff['message']} (not enforced)")

        result = mgr.migrate_vm_manual(vm["node"], vm["vmid"], vm["type"], target_node, online)

        # Register ProxmoxVEx user for each migration task
        if result.get("task") or result.get("upid"):
            register_task_user(result.get("task") or result.get("upid"), user, cluster_id)

        results.append({
            "vmid": vm["vmid"],
            "success": result.get("success", False),
            "task": result.get("task"),
            "error": result.get("error"),
        })

    # Push immediate update for live UI (all migrations started)
    push_immediate_update(cluster_id, delay=0.5)

    # lgtm[py/reflected-xss]
    return jsonify({"results": results, "total": len(vms), "successful": sum(1 for r in results if r["success"])})


@bp.route("/api/clusters/<cluster_id>/fingerprint", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_cluster_fingerprint_api(cluster_id):
    """Get cluster SSL fingerprint for remote migration"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    result = manager.get_cluster_fingerprint()

    if result.get("success"):
        # lgtm[py/reflected-xss]
        return jsonify(result)
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result.get("error", "Failed: fingerprint")
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/remote-migrate", methods=["POST"])
@require_auth(perms=["vm.migrate"])
def remote_migrate_vm_api(cluster_id, node, vm_type, vmid):
    """Cross-cluster remote migration"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    # (route-authz contract) - cross-cluster migrate is state-changing on
    # this VM; gate it per-VM like the local migrate/clone routes (was missing).
    denied = _require_vm_access(cluster_id, vmid, "vm.migrate", vm_type)
    if denied:
        # lgtm[py/reflected-xss]
        return denied

    manager = cluster_managers[cluster_id]
    data = request.json or {}

    target_endpoint = data.get("target_endpoint")
    target_storage = data.get("target_storage")
    target_bridge = data.get("target_bridge")
    target_vmid = data.get("target_vmid")
    online = data.get("online", True)
    delete_source = data.get("delete_source", True)
    bwlimit = data.get("bwlimit")

    if not all([target_endpoint, target_storage, target_bridge]):
        # lgtm[py/reflected-xss]
        return jsonify({"error": "target_endpoint, target_storage, and target_bridge are required"}), 400

    result = manager.remote_migrate_vm(
        node, vmid, vm_type, target_endpoint, target_storage, target_bridge, target_vmid, online, delete_source, bwlimit
    )

    if result.get("success"):
        # Register ProxmoxVEx user for this task
        user = getattr(request, "session", {}).get("user", "system")
        upid = result.get("task") or result.get("upid")
        if upid:
            register_task_user(upid, user, cluster_id)

        # Push immediate update for live UI
        push_immediate_update(cluster_id, delay=0.5)

        # lgtm[py/reflected-xss]
        return jsonify({"message": f"Remote migration started for {vm_type}/{vmid}", "task": result.get("task")})
    else:
        # lgtm[py/reflected-xss]
        return jsonify({
            "error": result.get("error", "Remote migration failed")
        }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure


@bp.route("/api/cross-cluster-migrate", methods=["POST"])
@require_auth(perms=["vm.migrate"])
def cross_cluster_migrate_api():
    """
    High-level cross-cluster migration API

    This is the fancy one - migrates VMs between completely separate
    Proxmox clusters using SSH tunnels. Takes care of:
    - Creating temp API tokens on target
    - Setting up SSH tunnel for migration traffic
    - Cleaning up tokens after migration

    Known issue: For large VMs (>50GB disk), online migration may fail with
    "401 Unauthorized" during RAM sync due to Proxmox WebSocket ticket timeout.
    Workaround: Use offline migration for large VMs.
    """
    data = request.json or {}

    source_cluster_id = data.get("source_cluster")
    target_cluster_id = data.get("target_cluster")
    vmid = data.get("vmid")
    vm_type = data.get("vm_type", "qemu")
    source_node = data.get("source_node")
    target_node = data.get("target_node")
    target_storage = data.get("target_storage")
    # per-storage mapping: {"local-lvm": "ceph-pool", "local": "nfs-stor"} → PVE format "local-lvm:ceph-pool,local:nfs-stor"
    storage_map = data.get("target_storage_map")
    if storage_map and isinstance(storage_map, dict):
        target_storage = ",".join(f"{s}:{t}" for s, t in storage_map.items())
    # per-NIC bridge mapping: {"vmbr0": "vmbr1", "vmbr1": "vmbr2"} → PVE format "vmbr0:vmbr1,vmbr1:vmbr2"
    # Was using = instead of : (#274), PVE remote_migrate uses same format as target-storage
    bridge_map = data.get("target_bridge_map")
    if bridge_map and isinstance(bridge_map, dict):
        target_bridge = ",".join(f"{s}:{t}" for s, t in bridge_map.items())
    else:
        target_bridge = data.get("target_bridge", "vmbr0")
    target_vmid = data.get("target_vmid")
    online = data.get("online", True)
    force_online = data.get("force_online", False)  # Override automatic offline for large disks
    delete_source = data.get("delete_source", True)
    bwlimit = data.get("bwlimit", 0)  # 0 = no limit (maximum speed to beat ticket timeout)

    if not target_node:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Target node is required for cross-cluster migration"}), 400

    if source_cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Source cluster not found"}), 404
    if target_cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Target cluster not found"}), 404
    # Check access to BOTH source and target cluster
    ok, err = check_cluster_access(source_cluster_id)
    if not ok:
        return _access_denied()
    ok, err = check_cluster_access(target_cluster_id)
    if not ok:
        return _access_denied()

    source_manager = cluster_managers[source_cluster_id]
    target_manager = cluster_managers[target_cluster_id]

    # Check VM disk size and warn about potential issues with online migration
    warnings = []
    try:
        vm_info = source_manager.get_vm_config(source_node, vmid, vm_type)
        if vm_info.get("success"):
            config = vm_info.get("config", {})
            total_disk_gb = 0
            for key, value in config.items():
                if key.startswith(("scsi", "virtio", "sata", "ide", "efidisk", "tpmstate")) and "size" in str(value):
                    # Extract size from disk config
                    import re

                    size_match = re.search(r"size=(\d+)([GMT])", str(value))
                    if size_match:
                        size_val = int(size_match.group(1))
                        size_unit = size_match.group(2)
                        if size_unit == "G":
                            total_disk_gb += size_val
                        elif size_unit == "T":
                            total_disk_gb += size_val * 1024
                        elif size_unit == "M":
                            total_disk_gb += size_val / 1024

            if total_disk_gb > 100 and online and not force_online:
                # Proxmox WebSocket tickets have internal timeout (~5 min)
                # Large disk migrations take longer than this, causing 401 errors
                # during RAM sync phase. Auto-switch to offline migration.
                #
                # Math: 100GB in 5 min = 333 MB/s = ~2.7 Gbit/s sustained
                # Most cross-cluster links can't sustain this.
                required_speed_mbps = (total_disk_gb * 1024) / 300  # MB/s needed for 5 min
                warnings.append(
                    f"VM has {total_disk_gb:.0f}GB disk. Would need {required_speed_mbps:.0f} MB/s ({required_speed_mbps * 8 / 1000:.1f} Gbit/s) to complete in 5 min. Automatically using offline migration."
                )
                logging.warning(
                    f"[CROSS-MIGRATE] Large VM ({total_disk_gb}GB) - forcing offline migration due to Proxmox WebSocket ticket timeout limitation"
                )
                online = False  # Force offline migration for large disks
            elif total_disk_gb > 100 and online and force_online:
                required_speed_mbps = (total_disk_gb * 1024) / 300
                warnings.append(
                    f"VM has {total_disk_gb:.0f}GB disk with forced online migration. Need {required_speed_mbps:.0f} MB/s sustained to avoid timeout. Migration may fail with '401 Unauthorized'."
                )
                logging.warning(
                    f"[CROSS-MIGRATE] Large VM ({total_disk_gb}GB) - online migration forced by user, may fail"
                )
    except Exception as e:
        logging.debug(f"Could not check VM size: {e}")

    # Generate unique token name
    import time

    token_name = f"ProxmoxVEx-migrate-{int(time.time())}"
    target_token = None

    try:
        # Step 1: Create temporary API token on TARGET cluster (without privilege separation)
        logging.info(
            f"Creating temporary API token on target cluster ({target_cluster_id}) for user {target_manager.config.user}..."
        )
        token_result = target_manager.create_api_token(token_name)
        if not token_result.get("success"):
            # lgtm[py/reflected-xss]
            # snyk:ignore:Cross-site Scripting (XSS)
            return jsonify({
                "error": f"Could not create API token on target cluster: {token_result.get('error')}"
            }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure

        target_token = token_result
        logging.info(f"Created token on target cluster: {target_token['token_id']}")

        # Step 2: Get target cluster fingerprint
        fp_result = target_manager.get_cluster_fingerprint()
        if not fp_result.get("success"):
            raise Exception(f"Could not get target fingerprint: {fp_result.get('error')}")

        # Step 3: Build target endpoint string
        # Format must be exact - Proxmox is picky about this
        # Format: apitoken=PVEAPIToken=<user>!<tokenname>=<secret>,host=<host>,fingerprint=<fp>
        target_endpoint = (
            f"apitoken=PVEAPIToken={target_token['token_id']}={target_token['token_value']},"
            f"host={fp_result['host']},"
            f"fingerprint={fp_result['fingerprint']}"
        )

        logging.info(
            f"Starting remote migration of {vm_type}/{vmid} from {source_cluster_id} to {target_cluster_id}..."
        )
        logging.info(
            f"Target host: {fp_result['host']}, Token user: {target_token['token_id'].split('!')[0]}, Online: {online}"
        )

        # Step 4: Perform the migration
        result = source_manager.remote_migrate_vm(
            source_node,
            vmid,
            vm_type,
            target_endpoint,
            target_storage,
            target_bridge,
            target_vmid,
            online,
            delete_source,
            bwlimit,
        )

        if result.get("success"):
            # Log to audit
            user = request.session.get("user", "system")
            log_audit(
                user,
                "vm.cross_cluster_migrate",
                f"Cross-cluster migration: {vm_type}/{vmid} from {source_cluster_id} to {target_cluster_id}/{target_node}",
                request.remote_addr,
            )

            # Register ProxmoxVEx user for this task
            task_upid = result.get("task")
            if task_upid:
                register_task_user(task_upid, user, source_cluster_id)

            # Push immediate update for live UI (source cluster)
            push_immediate_update(source_cluster_id, delay=0.5)

            # Schedule intelligent token cleanup - monitors task status
            def cleanup_token_when_done():
                import time

                max_wait = 7200  # Maximum 2 hours (large VMs can take a long time!)
                poll_interval = 15  # Check every 15 seconds
                elapsed = 0
                min_wait_before_assuming_done = 300  # Wait at least 5 minutes before assuming task is done

                logging.info(f"[TOKEN-CLEANUP] Monitoring task {task_upid} for completion...")

                while elapsed < max_wait:
                    try:
                        # Get task status from source cluster (where the migration task runs)
                        tasks = source_manager.get_tasks(limit=100)
                        task_found = False

                        for task in tasks:
                            if task and task.get("upid") == task_upid:
                                task_found = True
                                status = task.get("status", "")

                                # check task is finished
                                if status and status != "running":
                                    if status == "OK":
                                        logging.info("[TOKEN-CLEANUP] Migration task completed successfully!")
                                    else:
                                        logging.warning(f"[TOKEN-CLEANUP] Migration task ended with status: {status}")

                                    # Wait a bit more after task completion to be safe
                                    # The VM might still be syncing final state
                                    time.sleep(30)

                                    # Task finished - delete token
                                    target_manager.delete_api_token(token_name)
                                    logging.info(f"[TOKEN-CLEANUP] Deleted migration token: {token_name}")
                                    return
                                break

                        # Fix for Issue #19 - Don't delete token too early!
                        # If task not found, it might have completed and scrolled out of task list
                        # BUT we need to wait much longer to be safe (was 60s, now 5 min minimum)
                        if not task_found and elapsed > min_wait_before_assuming_done:
                            # Double-check: Try to verify VM exists on target cluster
                            try:
                                # Check if VM exists on target (migration successful)
                                target_vms = target_manager.get_vm_resources()
                                vm_on_target = any(
                                    v.get("vmid") == vmid or v.get("vmid") == target_vmid for v in (target_vms or [])
                                )
                                if vm_on_target:
                                    logging.info(
                                        "[TOKEN-CLEANUP] VM found on target cluster, migration likely successful"
                                    )
                                else:
                                    logging.info("[TOKEN-CLEANUP] VM not yet on target, waiting longer...")
                                    time.sleep(poll_interval)
                                    elapsed += poll_interval
                                    continue
                            except Exception as e:
                                logging.warning(f"[TOKEN-CLEANUP] Could not verify VM on target: {e}")

                            logging.info(
                                f"[TOKEN-CLEANUP] Task no longer in task list after {elapsed}s, assuming completed"
                            )
                            target_manager.delete_api_token(token_name)
                            logging.info(f"[TOKEN-CLEANUP] Deleted migration token: {token_name}")
                            return

                    except Exception as e:
                        logging.warning(f"[TOKEN-CLEANUP] Error checking task status: {e}")

                    time.sleep(poll_interval)
                    elapsed += poll_interval

                # Timeout - delete token anyway
                logging.warning(f"[TOKEN-CLEANUP] Timeout after {max_wait}s waiting for task, deleting token anyway")
                target_manager.delete_api_token(token_name)
                logging.info(f"[TOKEN-CLEANUP] Deleted migration token: {token_name}")

            cleanup_thread = threading.Thread(target=cleanup_token_when_done, daemon=True)
            cleanup_thread.start()

            response = {
                "message": f"Cross-cluster migration started: {vm_type}/{vmid} from {source_cluster_id} to {target_cluster_id}/{target_node}",
                "task": result.get("task"),
                "online": online,
                "info": "Temporary API token will be automatically cleaned up after migration completes.",
            }
            if warnings:
                response["warnings"] = warnings

            # lgtm[py/reflected-xss]
            return jsonify(response)
        else:
            # Migration failed - cleanup token immediately
            error_msg = result.get("error", "Cross-cluster migration failed")

            # Add helpful hint for 401 errors
            if "401" in error_msg or "Unauthorized" in error_msg or "Broken pipe" in error_msg:
                error_msg += ". If this persists, check ProxmoxVEx version (token cleanup timing was fixed in 0.6.2)"

            target_manager.delete_api_token(token_name)
            # lgtm[py/reflected-xss]
            return jsonify({
                "error": error_msg
            }), 500  # snyk:ignore:Cross-site Scripting (XSS)  # snyk:ignore:Server Information Exposure

    except Exception as e:
        # Cleanup token on any error
        if target_token:
            target_manager.delete_api_token(token_name)
        logging.error(f"Cross-cluster migration error: {e}")
        return _api_error("Cross-cluster migration failed", status=500)


@bp.route("/api/clusters/<cluster_id>/nodes-status", methods=["GET"])
@require_auth(perms=["node.view"])
def get_cluster_nodes_status_api(cluster_id):
    """Get list of nodes with status info - alternative endpoint with more details"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    node_status = manager.get_node_status()

    # Return just the node names and basic info
    nodes = []
    for node_name, status in node_status.items():
        nodes.append({
            "node": node_name,
            "status": status.get("status", "unknown"),
            "cpu_percent": status.get("cpu_percent", 0),
            "mem_percent": status.get("mem_percent", 0),
        })

    # lgtm[py/reflected-xss]
    return jsonify(nodes)


# VM/CT Creation API Routes
@bp.route("/api/clusters/<cluster_id>/nodes/<node>/nextid", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_next_vmid_for_node_api(cluster_id, node):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    result = manager.get_next_vmid()

    if result.get("success"):
        # lgtm[py/reflected-xss]
        return jsonify({"vmid": result["vmid"]})
    else:
        # lgtm[py/reflected-xss]
        return jsonify(result), 400


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/templates", methods=["GET"])
@require_auth(perms=["storage.view"])
def get_templates_api(cluster_id, node):
    """Get available templates for VM/CT creation"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]

    templates = manager.get_templates(node)
    # lgtm[py/reflected-xss]
    return jsonify(templates)


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/qemu", methods=["POST"])
@require_auth(perms=["vm.create"])
def create_vm_api(cluster_id, node):
    """Create a new VM on a node"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]

    vm_config = request.json or {}

    # #502 - tenant quota pre-flight (fail-open: a quota bug must never block a create)
    try:
        from ProxmoxVEx.utils.rbac import DEFAULT_TENANT_ID, check_tenant_quota

        _qu = load_users().get(request.session.get("user", ""), {})
        _tid = _qu.get("tenant_id") or DEFAULT_TENANT_ID
        _qcores = int(vm_config.get("cores") or 1) * int(vm_config.get("sockets") or 1)
        _qmem = float(vm_config.get("memory") or 0) / 1024.0  # MB → GB
        _qchk = check_tenant_quota(_tid, add_cores=_qcores, add_mem_gb=_qmem, add_vms=1)
        if not _qchk["ok"] and _qchk.get("enforce") == "block":
            # lgtm[py/reflected-xss]
            return jsonify({
                "error": f"Tenant quota exceeded ({', '.join(_qchk['violations'])}) — "
                f"usage {_qchk['usage']} vs quota {_qchk['quota']}",
                "quota": _qchk,
            }), 403
    except Exception as _qe:
        logging.debug(f"[quota] qemu pre-flight skipped: {_qe}")

    result = manager.create_vm(node, vm_config)

    if result.get("success"):
        # Audit log
        user = getattr(request, "session", {}).get("user", "unknown")
        vmid = vm_config.get("vmid") or result.get("vmid") or result.get("data", {}).get("vmid", "unknown")
        vm_name = vm_config.get("name", f"vm-{vmid}")
        log_audit(user, "vm.create", f"Created VM {vmid} ({vm_name}) on {node}", cluster=manager.config.name)

        # Broadcast to all clients
        broadcast_action("create", "qemu", str(vmid), {"node": node, "name": vm_name}, cluster_id, user)

        # Push immediate update for live UI
        push_immediate_update(cluster_id, delay=0.5)

        # lgtm[py/reflected-xss]
        return jsonify(result)
    else:
        # lgtm[py/reflected-xss]
        return jsonify(result), 400


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/lxc", methods=["POST"])
@require_auth(perms=["vm.create"])
def create_container_api(cluster_id, node):
    """Create a new container on a node"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    ct_config = request.json or {}

    # #502 - tenant quota pre-flight (fail-open)
    try:
        from ProxmoxVEx.utils.rbac import DEFAULT_TENANT_ID, check_tenant_quota

        _qu = load_users().get(request.session.get("user", ""), {})
        _tid = _qu.get("tenant_id") or DEFAULT_TENANT_ID
        _qcores = int(ct_config.get("cores") or 1)
        _qmem = float(ct_config.get("memory") or 0) / 1024.0  # MB → GB
        _qchk = check_tenant_quota(_tid, add_cores=_qcores, add_mem_gb=_qmem, add_vms=1)
        if not _qchk["ok"] and _qchk.get("enforce") == "block":
            # lgtm[py/reflected-xss]
            return jsonify({
                "error": f"Tenant quota exceeded ({', '.join(_qchk['violations'])}) — "
                f"usage {_qchk['usage']} vs quota {_qchk['quota']}",
                "quota": _qchk,
            }), 403
    except Exception as _qe:
        logging.debug(f"[quota] lxc pre-flight skipped: {_qe}")

    result = manager.create_container(node, ct_config)

    if result.get("success"):
        # Audit log
        user = getattr(request, "session", {}).get("user", "unknown")
        vmid = ct_config.get("vmid") or result.get("data", {}).get("vmid", "unknown")
        ct_name = ct_config.get("hostname", f"ct-{vmid}")
        log_audit(user, "container.create", f"Created CT {vmid} ({ct_name}) on {node}", cluster=manager.config.name)

        # Broadcast to all clients
        broadcast_action("create", "lxc", str(vmid), {"node": node, "name": ct_name}, cluster_id, user)

        # Push immediate update for live UI
        push_immediate_update(cluster_id, delay=0.5)

        # lgtm[py/reflected-xss]
        return jsonify(result)
    else:
        # lgtm[py/reflected-xss]
        return jsonify(result), 400


# ---------------------------------------------------------------------------
# QEMU Guest Agent automated install endpoints
# ---------------------------------------------------------------------------


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/guest-agent-install/prepare", methods=["POST"])
@require_auth(perms=["vm.view"])
def guest_agent_install_prepare_api(cluster_id, node, vm_type, vmid):
    """Detect the guest OS and return the matching ISO/script metadata."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    denied = _require_vm_access(cluster_id, vmid, "vm.view", vm_type)
    if denied:
        return denied

    manager, err = get_connected_manager(cluster_id)
    if not manager:
        return err

    if vm_type != "qemu":
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Guest agent install is only supported for QEMU VMs"}), 400

    try:
        cfg_result = manager.get_vm_config(node, vmid, vm_type)
        if not cfg_result.get("success"):
            logging.warning(f"Failed to read VM config for {vm_type}/{vmid}: {cfg_result.get('error')}")
            # lgtm[py/reflected-xss]
            return jsonify({"error": cfg_result.get("error", "Could not read VM config")}), 500

        raw = cfg_result.get("config", {}).get("raw", {})
        ostype = raw.get("ostype")
        info = detect_os_from_pve_config(ostype)
        info["vmid"] = vmid
        info["node"] = node
        info["vm_type"] = vm_type

        # Include ISO-capable storages so the frontend can render a dropdown
        # with free/total sizes instead of a raw text input.
        try:
            all_storages = manager.get_storage_list(node)
            iso_storages = []
            for s in all_storages:
                content = s.get("content", "")
                # PVE content field is comma-separated, e.g. "iso,vztmpl,backup"
                if "iso" in content.split(","):
                    iso_storages.append({
                        "storage": s.get("storage"),
                        "type": s.get("type", "unknown"),
                        "total": s.get("total", 0),
                        "used": s.get("used", 0),
                        "avail": s.get("avail", 0),
                        "enabled": s.get("enabled", 1),
                        "active": s.get("active", 1),
                    })
            info["storages"] = iso_storages
        except Exception as e_stor:
            logging.warning(f"Could not fetch storages for node {node}: {e_stor}")
            info["storages"] = []

        # lgtm[py/reflected-xss]
        return jsonify(info)
    except Exception as e:
        logging.error(f"Error preparing guest-agent install for {vm_type}/{vmid}: {e}")
        # lgtm[py/reflected-xss]
        return jsonify({"error": f"Internal error: {e}"}), 500


@bp.route("/api/clusters/<cluster_id>/vms/<node>/<vm_type>/<int:vmid>/guest-agent-install/mount", methods=["POST"])
@require_auth(perms=["vm.config"])
def guest_agent_install_mount_api(cluster_id, node, vm_type, vmid):
    """Upload the reduced ISO to a PVE datastore and attach it to the VM CD-ROM."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    denied = _require_vm_access(cluster_id, vmid, "vm.config", vm_type)
    if denied:
        return denied

    if cluster_id not in cluster_managers:
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]
    if not manager.is_connected:
        conn_err = manager.connection_error or "Cluster not connected"
        # lgtm[py/reflected-xss]
        return jsonify({"error": conn_err, "offline": True}), 503

    if vm_type != "qemu":
        # lgtm[py/reflected-xss]
        return jsonify({"error": "Guest agent install is only supported for QEMU VMs"}), 400

    storage = request.args.get("storage", "local")
    if not validate_storage_name(storage):
        # lgtm[py/reflected-xss]
        return jsonify({"error": f"Invalid storage name: {storage}"}), 400

    replace = request.args.get("replace", "").lower() in ("1", "true", "yes")
    create_cdrom = request.args.get("create_cdrom", "").lower() in ("1", "true", "yes")
    reboot = request.args.get("reboot", "").lower() in ("1", "true", "yes")
    power_cycle = request.args.get("power_cycle", "").lower() in ("1", "true", "yes")
    tmp_iso = None

    try:
        cfg_result = manager.get_vm_config(node, vmid, vm_type)
        if not cfg_result.get("success"):
            logging.warning(f"Failed to read VM config for {vm_type}/{vmid}: {cfg_result.get('error')}")
            # lgtm[py/reflected-xss]
            return jsonify({"error": cfg_result.get("error", "Could not read VM config")}), 500

        raw = cfg_result.get("config", {}).get("raw", {})
        ostype = raw.get("ostype")
        info = detect_os_from_pve_config(ostype)
        if not info.get("supported"):
            # lgtm[py/reflected-xss]
            return jsonify({"error": info.get("message", "Unsupported guest OS"), "os_info": info}), 400

        iso_path = get_iso_path(info["iso_variant"])
        if not iso_path.exists():
            logging.error(f"Reduced ISO missing for variant {info['iso_variant']}: {iso_path}")
            # lgtm[py/reflected-xss]
            return jsonify({"error": f"Reduced ISO not found for {info['iso_variant']}"}), 500

        cdrom_key = "ide2"
        current_cdrom = raw.get(cdrom_key)
        is_cdrom = isinstance(current_cdrom, str) and ("media=cdrom" in current_cdrom or current_cdrom == "none")

        # If the VM has no ide2 CD-ROM device, the PVE config API will refuse an
        # ISO mount. Offer to create the device first when create_cdrom is not set.
        if not current_cdrom and not create_cdrom:
            # lgtm[py/reflected-xss]
            return jsonify({
                "error": f"{cdrom_key} CD-ROM device is not configured on this VM.",
                "device": cdrom_key,
                "needs_cdrom": True,
            }), 409

        # If the ide2 slot exists but is not a CD-ROM (could be a disk), need explicit
        # replace permission to overwrite it.
        if current_cdrom and not is_cdrom and not replace:
            # lgtm[py/reflected-xss]
            return jsonify({
                "error": f"{cdrom_key} is already occupied by {current_cdrom}.",
                "device": cdrom_key,
                "needs_replace": True,
            }), 409

        # When create_cdrom is requested (or the slot is missing), ensure ide2 is
        # an empty CD-ROM before mounting the ISO.
        if not current_cdrom or (current_cdrom and not is_cdrom):
            create_value = "none,media=cdrom"
            create_result = manager.update_vm_config(
                node,
                vmid,
                vm_type,
                {cdrom_key: create_value},
            )
            if not create_result.get("success"):
                # lgtm[py/reflected-xss]
                return jsonify({
                    "error": create_result.get("error", f"Failed to create {cdrom_key} CD-ROM device"),
                    "device": cdrom_key,
                    "needs_cdrom": True,
                }), 500

        # Build a stable, safe filename that includes a short content hash.
        iso_hash = hashlib.sha256(str(iso_path).encode("utf-8")).hexdigest()[:8]
        filename = safe_iso_filename(f"proxmoxvex-virtio-{info['iso_variant']}-{iso_hash}.iso")
        if not filename:
            # lgtm[py/reflected-xss]
            return jsonify({"error": "Generated ISO filename was rejected as unsafe"}), 500

        # Decompress the built .iso.gz to a temporary .iso for upload.
        # Reuse the same temp directory the datastore upload endpoint uses.
        upload_tmp_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tmp")
        os.makedirs(upload_tmp_dir, mode=0o700, exist_ok=True)
        fd, tmp_iso = tempfile.mkstemp(dir=upload_tmp_dir, suffix=".iso")
        # os.fdopen takes ownership of `fd`; exiting the `with` block closes it.
        # Do NOT call os.close(fd) again afterwards.
        try:
            with os.fdopen(fd, "wb") as out_fh, gzip.open(iso_path, "rb") as in_fh:
                shutil.copyfileobj(in_fh, out_fh)
        except Exception:
            # If os.fdopen itself failed (unlikely), fd may still be open.
            with contextlib.suppress(OSError):
                os.close(fd)
            raise

        # Upload the .iso to the selected PVE storage on the target node.
        host, port = manager.host, manager.api_port
        upload_url = f"https://{host}:{port}/api2/json/nodes/{node}/storage/{storage}/upload"
        with open(tmp_iso, "rb") as fh:
            from requests_toolbelt.multipart.encoder import MultipartEncoder

            encoder = MultipartEncoder(
                fields=[
                    ("content", "iso"),
                    ("filename", (filename, fh, "application/octet-stream")),
                ]
            )
            response = manager._api_post(
                upload_url,
                data=encoder,
                headers={"Content-Type": encoder.content_type},
                timeout=3600,
            )

        if response.status_code != 200:
            logging.error(f"ISO upload to {storage} failed for {vmid}: {response.text}")
            # lgtm[py/reflected-xss]
            return jsonify({"error": f"Failed to upload ISO to storage '{storage}': {response.text}"}), 500

        # Attach the uploaded ISO to the VM CD-ROM and ensure the QEMU guest agent
        # is enabled in the PVE VM config. Without this, PVE returns "No QEMU guest
        # agent configured" even if the guest has the agent installed and running.
        # PVE requires the explicit `media=cdrom` option on ISO images.
        agent_val = raw.get("agent", "")
        agent_enabled = isinstance(agent_val, str) and (agent_val == "1" or "enabled=1" in agent_val)
        config_updates = {cdrom_key: f"{storage}:iso/{filename},media=cdrom"}
        if not agent_enabled:
            config_updates["agent"] = "enabled=1"
            logging.info(f"Enabling QEMU guest agent for {vm_type}/{vmid}: agent was {agent_val!r}")
        update_result = manager.update_vm_config(node, vmid, vm_type, config_updates)
        if not update_result.get("success"):
            # lgtm[py/reflected-xss]
            return jsonify({"error": update_result.get("error", "Failed to attach ISO to VM")}), 500

        # Optionally reboot or full power-cycle the VM so the newly added CD-ROM is
        # detected by the guest. PVE config changes with pending restart require a
        # full stop+start to apply; a `reboot` leaves the config pending.
        reboot_result = None
        if power_cycle:
            stop_result = manager.stop_vm(node, vmid, vm_type)
            if stop_result and stop_result.get("success"):
                # Give PVE a moment to release the VM lock before starting again.
                time.sleep(2)
                start_result = manager.start_vm(node, vmid, vm_type)
                reboot_result = {
                    "success": start_result and start_result.get("success"),
                    "stop": stop_result,
                    "start": start_result,
                }
                if not start_result.get("success"):
                    logging.warning(f"Start after power-cycle for {vm_type}/{vmid} failed: {start_result.get('error')}")
            else:
                reboot_result = {"success": False, "error": stop_result.get("error", "Stop failed before power-cycle")}
                logging.warning(f"Stop for power-cycle of {vm_type}/{vmid} failed: {reboot_result.get('error')}")
        elif reboot:
            reboot_result = manager.restart_vm(node, vmid, vm_type)
            if not reboot_result.get("success"):
                logging.warning(f"Reboot after ISO mount for {vm_type}/{vmid} failed: {reboot_result.get('error')}")

        # Audit the action.
        user = request.session.get("user", "unknown")
        log_audit(
            user,
            "vm.config_changed",
            f"Mounted guest-agent install ISO for {vm_type} {vmid}: {filename}",
            cluster=manager.config.name,
        )

        # lgtm[py/reflected-xss]
        response = {
            "success": True,
            "device": cdrom_key,
            "filename": filename,
            "storage": storage,
            "script_name": info["script_name"],
            "os_pretty_name": info["os_pretty_name"],
        }
        if power_cycle:
            if reboot_result and reboot_result.get("success"):
                response["power_cycled"] = True
                response["message"] = (
                    "ISO mounted and VM power-cycled. The CD drive will be visible after the guest starts."
                )
            else:
                response["power_cycled"] = False
                response["reboot_error"] = reboot_result.get("error") if reboot_result else "Power-cycle attempt failed"
                response["message"] = (
                    "ISO mounted, but the power-cycle failed. Stop and start the VM manually and run the install script from the CD drive."
                )
        elif reboot:
            if reboot_result and reboot_result.get("success"):
                response["rebooted"] = True
                response["message"] = (
                    "ISO mounted and VM rebooted. The CD drive will be visible after the guest starts."
                )
            else:
                response["rebooted"] = False
                response["reboot_error"] = reboot_result.get("error") if reboot_result else "Reboot attempt failed"
                response["message"] = (
                    "ISO mounted, but the VM reboot failed. Reboot manually and run the install script from the CD drive."
                )
        else:
            response["message"] = (
                "ISO uploaded and mounted. Open the VM console, browse the CD drive, and run the install script."
            )
        # lgtm[py/reflected-xss]
        return jsonify(response)
    except Exception as e:
        logging.error(f"Error mounting guest-agent ISO for {vm_type}/{vmid}: {e}")
        # lgtm[py/reflected-xss]
        return jsonify({"error": f"Internal error: {e}"}), 500
    finally:
        if tmp_iso:
            with contextlib.suppress(Exception):
                os.unlink(tmp_iso)


# =====================================================
# Bulk VM/LXC action routes
# 003-ux-bulk-selection
# =====================================================


@bp.route("/api/clusters/<cluster_id>/vms/bulk", methods=["POST"])
@require_auth()
def bulk_vm_action_api(cluster_id):
    """Enqueue a bulk start/stop/restart action against a list of guests."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404

    data = request.get_json(silent=True) or {}
    action = str(data.get("action", "")).strip().lower()
    if action not in VALID_BULK_ACTIONS:
        return jsonify({"error": f"Invalid action. Valid actions: {VALID_BULK_ACTIONS}"}), 400

    guests = data.get("guests", [])
    if not isinstance(guests, list) or not guests:
        return jsonify({"error": "guests must be a non-empty list"}), 400

    # Validate list items and per-VM permissions
    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]

    perm_map = {
        "start": "vm.start",
        "stop": "vm.stop",
        "shutdown": "vm.stop",
        "reboot": "vm.restart",
        "reset": "vm.restart",
        "suspend": "vm.stop",
        "resume": "vm.start",
    }
    required_perm = perm_map.get(action, "vm.start")

    for guest in guests:
        if not isinstance(guest, dict) or not guest.get("vmid") or not guest.get("node") or not guest.get("type"):
            return jsonify({"error": "Each guest must include vmid, node and type"}), 400

        vmid = guest["vmid"]
        vm_type = guest["type"]
        if not user_can_access_vm(user, cluster_id, vmid, required_perm, vm_type):
            logging.warning(f"[BULK-ACTION] Permission denied for {user['username']}: {required_perm} on VM {vmid}")
            return jsonify({"error": f"Permission denied for VM {html.escape(str(vmid))}"}), 403

    raw_batch = data.get("batch_size")
    try:
        batch_size = int(raw_batch) if raw_batch is not None else None
    except (TypeError, ValueError):
        batch_size = None
    if batch_size is not None and (batch_size < 1 or batch_size > 200):
        return jsonify({"error": "batch_size must be between 1 and 200"}), 400
    params = {"force": data.get("force", False)}
    if batch_size is not None:
        params["batch_size"] = batch_size
    task = start_bulk_job(cluster_id, action, guests, params, request.session["user"])
    return jsonify({"job_id": task.id, "status": task.status, "total": task.total}), 202


@bp.route("/api/clusters/<cluster_id>/vms/bulk/<job_id>", methods=["GET"])
@require_auth()
def get_bulk_vm_action_api(cluster_id, job_id):
    """Get status of an enqueued bulk action job."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    task = get_bulk_job(job_id)
    if not task:
        return jsonify({"error": "Job not found"}), 404

    return jsonify(task.to_dict())


BULK_OPS_CACHE_TTL = 30.0
# 858-memory-optimisation-for-bulk-operations: cap the in-memory bulk status cache
# to prevent completed bulk jobs from accumulating in the API worker over time.
BULK_OPS_CACHE_MAX_SIZE = 100
_bulk_ops_cache = {}


def _prune_bulk_cache_if_needed():
    """Drop the oldest half of the cache when it exceeds the configured limit."""
    if len(_bulk_ops_cache) <= BULK_OPS_CACHE_MAX_SIZE:
        return
    oldest = sorted(_bulk_ops_cache.items(), key=lambda kv: kv[1]["time"])
    for key, _ in oldest[: len(oldest) // 2]:
        del _bulk_ops_cache[key]


def _get_cached_bulk_status(cluster_id, job_id):
    """Return the cached bulk job status if it has not expired."""
    import time as _t

    cached = _bulk_ops_cache.get(f"{cluster_id}:{job_id}")
    if cached is not None and (_t.monotonic() - cached["time"]) < BULK_OPS_CACHE_TTL:
        return cached["status"]
    return None


def _set_cached_bulk_status(cluster_id, job_id, status):
    """Cache the bulk job status for fast lookups."""
    import time as _t

    _prune_bulk_cache_if_needed()
    _bulk_ops_cache[f"{cluster_id}:{job_id}"] = {"status": status, "time": _t.monotonic()}


@bp.route("/api/clusters/<cluster_id>/vms/bulk-cache/<job_id>", methods=["GET"])
@require_auth()
def get_bulk_vm_action_cached(cluster_id, job_id):
    """Return cached bulk job status if available, otherwise refresh from the task queue."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    cached = _get_cached_bulk_status(cluster_id, job_id)
    if cached is not None:
        return jsonify({"ok": True, "data": {"cached": True, "status": cached}})
    task = get_bulk_job(job_id)
    if not task:
        return jsonify({"error": "Job not found"}), 404
    status = task.to_dict()
    _set_cached_bulk_status(cluster_id, job_id, status)
    return jsonify({"ok": True, "data": {"cached": False, "status": status}})


def _load_bulk_job_lazy(job_id, page=1, per_page=20):
    """Lazily load a paginated summary of a bulk job without full guest details."""
    task = get_bulk_job(job_id)
    if not task:
        return None
    summary = task.to_dict()
    guests = summary.get("guests", [])
    total = len(guests)
    per_page = max(1, min(int(per_page), 100))
    page = max(1, int(page))
    start = (page - 1) * per_page
    end = start + per_page
    summary["guests"] = guests[start:end]
    summary["pagination"] = {
        "page": page,
        "per_page": per_page,
        "total": total,
        "pages": max(1, (total + per_page - 1) // per_page),
    }
    summary["is_partial"] = True
    return summary


@bp.route("/api/clusters/<cluster_id>/vms/bulk-lazy/<job_id>", methods=["GET"])
@require_auth()
def get_bulk_vm_action_lazy(cluster_id, job_id):
    """Return a lazily loaded, paginated summary of a bulk job."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 20, type=int)
    summary = _load_bulk_job_lazy(job_id, page=page, per_page=per_page)
    if summary is None:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({"ok": True, "data": summary})


@bp.route("/api/clusters/<cluster_id>/vms/bulk-index/<job_id>", methods=["GET"])
@require_auth()
def get_bulk_vm_action_index(cluster_id, job_id):
    """Return bulk job results indexed by vmid for fast lookups."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    # 854-indexing-for-bulk-operations: build an O(1) lookup table of per-guest results.
    task = get_bulk_job(job_id)
    if not task:
        return jsonify({"error": "Job not found"}), 404
    indexed = {str(r.get("vmid")): r for r in task.results if r.get("vmid") is not None}
    return jsonify({"ok": True, "data": {"total": len(indexed), "index": indexed}})


@bp.route("/api/clusters/<cluster_id>/vms/bulk-compressed/<job_id>", methods=["GET"])
@require_auth()
def get_bulk_vm_action_compressed(cluster_id, job_id):
    """Return a gzip-compressed bulk job status payload."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    # 855-compression-for-bulk-operations: reduce payload size for large bulk results.
    task = get_bulk_job(job_id)
    if not task:
        return jsonify({"error": "Job not found"}), 404
    payload = json.dumps({"ok": True, "data": task.to_dict()}, default=str).encode("utf-8")
    compressed = gzip.compress(payload)
    resp = make_response(compressed)
    resp.headers["Content-Type"] = "application/json"
    resp.headers["Content-Encoding"] = "gzip"
    resp.headers["Content-Length"] = str(len(compressed))
    return resp


@bp.route("/api/clusters/<cluster_id>/vms/bulk-updates/<job_id>", methods=["GET"])
@require_auth()
def get_bulk_vm_action_updates(cluster_id, job_id):
    """Return bulk job results that have a timestamp newer than the provided `since` value."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()
    # 859-incremental-updates-for-bulk-operations: only return new results
    # to reduce bandwidth and client-side memory churn on long-running jobs.
    task = get_bulk_job(job_id)
    if not task:
        return jsonify({"error": "Job not found"}), 404

    since = request.args.get("since", "")
    if not since:
        return jsonify({"error": "since timestamp query parameter is required"}), 400

    try:
        since_dt = datetime.fromisoformat(since)
    except ValueError:
        return jsonify({"error": "since must be a valid ISO-8601 timestamp"}), 400

    updated = [r for r in task.results if datetime.fromisoformat(r["timestamp"]) > since_dt]
    return jsonify({"ok": True, "data": {"since": since, "total": len(updated), "results": updated}})
