# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/api/clusters.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: cluster CRUD, HA & maintenance routes - split from...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""cluster CRUD, HA & maintenance routes - split from monolith dec 2025,"""

import contextlib
import json
import logging
import threading
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from ProxmoxVEx.api.helpers import (
    check_cluster_access,
    get_connected_manager,
    parse_pve_error,
    safe_error,
    server_access_guard,
)
from ProxmoxVEx.core.cache import cluster_state_cache
from ProxmoxVEx.core.config import save_config
from ProxmoxVEx.core.db import get_db
from ProxmoxVEx.core.manager import ProxmoxVExManager
from ProxmoxVEx.globals import cluster_managers
from ProxmoxVEx.models.permissions import ROLE_ADMIN
from ProxmoxVEx.models.tasks import ProxmoxVExConfig
from ProxmoxVEx.utils.audit import log_audit
from ProxmoxVEx.utils.auth import load_users, require_auth
from ProxmoxVEx.utils.rbac import (
    get_user_clusters,
    get_vm_acls,
    has_permission,
)
from ProxmoxVEx.utils.sanitization import sanitize_log_message as _sl  # CWE-117

# This used to be 200 lines down in the monolith, good luck finding anything there
bp = Blueprint("clusters", __name__)
bp.before_request(server_access_guard("cluster"))


@bp.route("/api/clusters", methods=["GET"])
@require_auth()
def get_clusters():
    """Get all configured clusters (filtered by tenant + VM ACLs)

    Clusters are now sorted by sort_order, then by name for consistent ordering
    Users with VM ACLs can see their clusters without cluster.view
    """
    # get user's allowed clusters
    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]
    allowed = get_user_clusters(user)
    has_cluster_view = has_permission(user, "cluster.view")

    # #248: users without cluster.view can still see clusters where they have VM ACLs
    acl_cluster_ids = set()
    if not has_cluster_view:
        from ProxmoxVEx.utils.rbac import load_vm_acls

        all_acls = load_vm_acls()
        for cid, vm_acls in all_acls.items():
            for _vmid, acl in vm_acls.items():
                if user["username"] in acl.get("users", []) or "*" in acl.get("users", []):
                    acl_cluster_ids.add(cid)
                    break
        # #555: also surface clusters where the user holds pool perms
        try:
            for cid in get_db().get_user_pool_clusters(user["username"], user.get("groups", [])):
                acl_cluster_ids.add(cid)
        except Exception as _e:
            pass
        if not acl_cluster_ids:
            return jsonify([])  # snyk:ignore:python/ServerInformationExposure

    # Get cluster metadata from database (display_name, group_id, sort_order)
    db = get_db()
    cluster_meta = {}
    try:
        meta_rows = db.query("SELECT id, display_name, group_id, sort_order FROM clusters")
        for row in meta_rows:
            cluster_meta[row["id"]] = {
                "display_name": row["display_name"],
                "group_id": row["group_id"],
                "sort_order": row["sort_order"] if row["sort_order"] is not None else 0,
            }
    except Exception as _e:
        pass

    clusters = []
    for cluster_id, mgr in cluster_managers.items():
        # filter by tenant
        if allowed is not None and cluster_id not in allowed and cluster_id not in acl_cluster_ids:
            # fallback: allow if user has VM ACLs in this cluster
            continue
        # without cluster.view, only show clusters with VM ACLs
        if not has_cluster_view and cluster_id not in acl_cluster_ids:
            continue

        meta = cluster_meta.get(cluster_id, {})
        display_name = meta.get("display_name") or ""

        # ACL-only users get minimal info (no admin settings)
        if not has_cluster_view:
            clusters.append({
                "id": cluster_id,
                "name": mgr.config.name,
                "display_name": display_name,
                "group_id": meta.get("group_id"),
                "sort_order": meta.get("sort_order", 0),
                "status": "running" if mgr.running else "stopped",
                "connected": mgr.is_connected,
                "cluster_type": getattr(mgr, "cluster_type", "proxmox"),
            })
        else:
            clusters.append({
                "id": cluster_id,
                "name": mgr.config.name,
                "display_name": display_name,
                "group_id": meta.get("group_id"),
                "sort_order": meta.get("sort_order", 0),
                "host": mgr.config.host,
                "status": "running" if mgr.running else "stopped",
                "connected": mgr.is_connected,
                "connection_error": mgr.connection_error,
                "migration_threshold": mgr.config.migration_threshold,
                "migration_tolerance": getattr(mgr.config, "migration_tolerance", 10),
                "check_interval": mgr.config.check_interval,
                "auto_migrate": mgr.config.auto_migrate,
                "balance_containers": getattr(mgr.config, "balance_containers", False),
                "balance_local_disks": getattr(mgr.config, "balance_local_disks", False),
                "dry_run": mgr.config.dry_run,
                "predictive_balancing": getattr(mgr.config, "predictive_balancing", False),
                "predictive_threshold": getattr(mgr.config, "predictive_threshold", 75),
                "balance_cpu_weight": getattr(mgr.config, "balance_cpu_weight", 1.0),
                "balance_mem_weight": getattr(mgr.config, "balance_mem_weight", 1.0),
                "balance_io_weight": getattr(mgr.config, "balance_io_weight", 0.0),
                "cpu_baseline": getattr(mgr.config, "cpu_baseline", None),
                "enabled": mgr.config.enabled,
                "ha_enabled": mgr.config.ha_enabled,
                "fallback_hosts": mgr.config.fallback_hosts,
                "excluded_nodes": getattr(mgr.config, "excluded_nodes", []),
                "current_host": getattr(mgr, "_original_host", None) or getattr(mgr, "current_host", None),
                "last_run": mgr.last_run.isoformat() if mgr.last_run else None,
                "api_token_active": bool(getattr(mgr, "_using_api_token", False)),
                "cluster_type": getattr(mgr, "cluster_type", "proxmox"),
                # Worldmap location (per-cluster). None when not set.
                "latitude": getattr(mgr.config, "latitude", None),
                "longitude": getattr(mgr.config, "longitude", None),
                "location_label": getattr(mgr.config, "location_label", "") or "",
            })

    # Sort clusters by sort_order first, then by name for consistent ordering
    clusters.sort(key=lambda c: (c.get("sort_order", 0), c.get("name", "").lower()))

    return jsonify(clusters)  # snyk:ignore:python/XSS


@bp.route("/api/clusters", methods=["POST"])
@require_auth(perms=["cluster.add"])
def add_cluster():
    """Add a new cluster"""
    data = request.json

    # Validate required fields
    required = ["name", "host", "user"]
    for field in required:
        if field not in data:
            # snyk:ignore:Cross-site Scripting (XSS)
            return jsonify({"error": f"Missing required field: {field}"}), 400  # snyk:ignore:python/XSS

    # password or ssh key - need at least one
    if not data.get("pass") and not data.get("ssh_key"):
        return jsonify({"error": "Password or SSH key is required"}), 400  # snyk:ignore:python/XSS
    if "pass" not in data:
        data["pass"] = ""

    # Generate unique ID
    cluster_id = str(uuid.uuid4())[:8]
    cluster_type = data.get("cluster_type", "proxmox")

    # Create config
    config = ProxmoxVExConfig(data)

    # Mar 2026: dispatch to correct manager based on cluster type
    manager = ProxmoxVExManager(cluster_id, config)
    # Test connection - Return actual error instead of generic message
    if not manager.connect_to_proxmox():
        error_detail = manager.connection_error or "Failed to connect to Proxmox cluster"
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({"error": f"Failed to connect: {error_detail}"}), 400  # snyk:ignore:python/XSS

    manager.start()
    cluster_managers[cluster_id] = manager

    # Save configuration - also store cluster_type in db
    save_config()
    if cluster_type != "proxmox":
        db = get_db()
        db.update_cluster(cluster_id, {"cluster_type": cluster_type})

    # Audit log
    type_label = "Proxmox"
    log_audit(
        request.session["user"], "cluster.added", f"Added {type_label} cluster: {data.get('name')} ({data.get('host')})"
    )

    result = {"id": cluster_id, "message": "Cluster added successfully"}
    # Let frontend know if we auto-created an API token
    if getattr(manager, "_token_auto_created", False):
        result["api_token_created"] = True
    # 004-perf-cached-cluster-state: cluster list is no longer valid
    cluster_state_cache.invalidate()
    return jsonify(result), 201  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/config/export", methods=["GET"])
@require_auth(perms=["cluster.config"])
def export_cluster_config(cluster_id):
    """Export cluster config WITHOUT secrets — for re-configure pre-fill (#256)"""
    # (CodeAnt re-scan auth-bypass/IDOR) - cluster-scoped route was missing the tenant gate
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS
    mgr = cluster_managers[cluster_id]
    c = mgr.config
    return jsonify({  # snyk:ignore:python/XSS
        "name": c.name,
        "host": c.host,
        "user": c.user,
        "ssl_verification": c.ssl_verification,
        "migration_threshold": c.migration_threshold,
        "migration_tolerance": getattr(c, "migration_tolerance", 10),
        "check_interval": c.check_interval,
        "auto_migrate": c.auto_migrate,
        "balance_containers": getattr(c, "balance_containers", False),
        "balance_local_disks": getattr(c, "balance_local_disks", False),
        "dry_run": c.dry_run,
        "cluster_type": getattr(mgr, "cluster_type", "proxmox"),
        "vnc_tunnel": bool(getattr(c, "vnc_tunnel", False)),  # Apr 2026
        # secrets intentionally omitted: pass, ssh_key, api_token_secret
    })


# (PVE 9.2) - rotate the auto-created API token without dropping
# its ACL entries. The classic delete+recreate path resets all permissions;
# the new /access/users/{user}/token/{id} POST in 9.2 regenerates the secret
# in place. On pre-9.2 we fall back to delete+create + warn that ACLs reset.
@bp.route("/api/clusters/<cluster_id>/api-token/rotate", methods=["POST"])
@require_auth(perms=["cluster.config"])
def rotate_cluster_api_token(cluster_id):
    # (CodeAnt re-scan auth-bypass/IDOR) - cluster-scoped route was missing the tenant gate
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS
    mgr = cluster_managers[cluster_id]
    if not getattr(mgr.config, "api_token_user", ""):
        return jsonify({"error": "No API token configured for this cluster"}), 400  # snyk:ignore:python/XSS

    try:
        token_user = mgr.config.api_token_user
        user_part, token_id = token_user.split("!", 1)
        base = f"https://{mgr.host}:{mgr.api_port}/api2/json/access/users/{user_part}/token/{token_id}"

        pve_ver = mgr.get_pve_version_tuple()
        new_secret = None
        # Only try the 9.2 in-place regenerate when we KNOW the
        # cluster is 9.2+. Pre-9.2 PVE doesn't reject POST on an existing
        # token cleanly — it hangs / times out on some 9.1 builds. Falling
        # back is cheaper than waiting for a 10s read timeout per attempt.
        if pve_ver is not None and pve_ver >= (9, 2):
            try:
                resp = mgr._api_post(base, data={}, timeout=8)
                if resp.status_code == 200:
                    data = resp.json().get("data") or {}
                    new_secret = data.get("value") or data.get("secret")
                    preserved = True
                elif resp.status_code in (404, 405, 501):
                    preserved = False  # fall through to delete+create
                else:
                    return jsonify({
                        "error": parse_pve_error(resp.text)
                    }), resp.status_code  # lgtm[py/reflected-xss]  # snyk:ignore:python/XSS
            except Exception as probe_err:
                mgr.logger.warning(f"[token-rotate] in-place regenerate probe failed ({probe_err}); falling back")
                preserved = False
        else:
            preserved = False

        if new_secret is None:
            # Legacy path: delete + recreate. Warn caller ACLs are lost.
            mgr._create_session().delete(base, timeout=10)
            create_resp = mgr._api_post(base, data={})
            if create_resp.status_code != 200:
                return jsonify({  # snyk:ignore:python/XSS
                    "error": parse_pve_error(create_resp.text)
                }), create_resp.status_code  # lgtm[py/reflected-xss]
            data = create_resp.json().get("data") or {}
            new_secret = data.get("value") or data.get("secret")
            preserved = False

        if not new_secret:
            return jsonify({
                "error": "Token regenerated but PVE did not return a secret"
            }), 502  # snyk:ignore:python/XSS

        # Persist the new secret in our DB so subsequent connects use it
        mgr.config.api_token_secret = new_secret
        save_config()

        user = getattr(request, "session", {}).get("user", "system")
        log_audit(
            user,
            "cluster.api_token_rotated",
            f"Rotated API token {token_user} (ACLs preserved={preserved})",
            cluster=mgr.config.name,
        )
        return jsonify({  # snyk:ignore:python/XSS
            "success": True,
            "acls_preserved": preserved,
            "message": "Token rotated; ACLs preserved"
            if preserved
            else "Token rotated via delete+recreate; ACL entries on this token were lost (pre-PVE-9.2 cluster)",
        })
    except Exception as e:
        return jsonify({
            "error": safe_error(e, "Token rotation failed")
        }), 500  # snyk:ignore:python/ServerInformationExposure


@bp.route("/api/clusters/<cluster_id>/reconfigure", methods=["POST"])
@require_auth(perms=["cluster.config"])
def reconfigure_cluster(cluster_id):
    """Re-configure cluster credentials. Requires re-authentication. (#256)
    Keeps same cluster_id so VM ACLs, replication jobs etc. stay intact.
    """
    # (CodeAnt re-scan auth-bypass/IDOR) - cluster-scoped route was missing the tenant gate
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    data = request.json or {}

    # Re-auth: user must verify their own password
    from ProxmoxVEx.utils.auth import verify_password

    current_password = data.pop("current_password", "")
    username = request.session["user"]
    users = load_users()
    user = users.get(username, {})

    auth_source = user.get("auth_source", "local")
    if auth_source == "local":
        if (
            not current_password
            or not user.get("password_hash")
            or not verify_password(current_password, user.get("password_salt", ""), user["password_hash"])
        ):
            return jsonify({"error": "Invalid password"}), 401  # snyk:ignore:python/XSS
    elif auth_source == "ldap":
        # LDAP user: verify against LDAP server
        from ProxmoxVEx.utils.ldap import ldap_authenticate

        ldap_result = ldap_authenticate(username, current_password) if current_password else {}
        if not current_password or "error" in ldap_result:
            return jsonify({"error": "Invalid LDAP password"}), 401  # snyk:ignore:python/XSS
    else:
        return jsonify({  # snyk:ignore:python/XSS
            "error": "Re-authentication not supported for this account type. Use a local admin account."
        }), 400

    # Validate required fields (same as add_cluster)
    for field in ["name", "host", "user"]:
        if field not in data:
            # snyk:ignore:Cross-site Scripting (XSS)
            return jsonify({"error": f"Missing required field: {field}"}), 400  # snyk:ignore:python/XSS
    if not data.get("pass") and not data.get("ssh_key"):
        return jsonify({"error": "Password or SSH key is required"}), 400  # snyk:ignore:python/XSS
    if "pass" not in data:
        data["pass"] = ""

    data.get("cluster_type", getattr(cluster_managers[cluster_id], "cluster_type", "proxmox"))

    # Create new config + manager, test connection
    new_config = ProxmoxVExConfig(data)
    new_mgr = ProxmoxVExManager(cluster_id, new_config)
    if not new_mgr.connect_to_proxmox():
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({
            "error": f"Connection failed: {new_mgr.connection_error or 'unknown'}"
        }), 400  # snyk:ignore:python/XSS

    # Stop old manager, swap in new one
    old_mgr = cluster_managers[cluster_id]
    with contextlib.suppress(Exception):
        old_mgr.stop()

    new_mgr.start()
    cluster_managers[cluster_id] = new_mgr
    save_config()

    log_audit(username, "cluster.reconfigured", f"Re-configured cluster: {data.get('name')} ({data.get('host')})")

    result = {"success": True, "message": "Cluster re-configured successfully"}
    if getattr(new_mgr, "_token_auto_created", False):
        result["api_token_created"] = True
    # 004-perf-cached-cluster-state: cluster list is no longer valid
    cluster_state_cache.invalidate()
    return jsonify(result)  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/nodes", methods=["GET"])
@require_auth(perms=["node.view"])
def get_cluster_nodes(cluster_id):
    """Get list of nodes in a cluster

    Made more resilient - returns cached/last known nodes if connection fails
    """
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    manager = cluster_managers[cluster_id]

    # Try to get live data
    try:
        host, port = manager.host, manager.api_port
        url = f"https://{host}:{port}/api2/json/nodes"
        r = manager._create_session().get(url, timeout=10)

        if r.status_code == 200:
            nodes = r.json().get("data", [])
            # (#415 KowMangler): the cross-cluster-migration target-
            # node dropdown wants per-node "CPU: X% RAM: Y%" strings, but raw
            # /api2/json/nodes returns `cpu` as a 0..1 fraction and `mem`/`maxmem`
            # as bytes. Frontend was reading `.cpu_percent`/`.mem_percent` which
            # didn't exist → empty text. Cheaper to compute it here once than
            # to teach every consumer the conversion.
            for n in nodes:
                if not isinstance(n, dict):
                    continue
                cpu = n.get("cpu")
                if isinstance(cpu, (int, float)):
                    n["cpu_percent"] = round(cpu * 100, 2)
                mem = n.get("mem")
                maxmem = n.get("maxmem")
                if isinstance(mem, (int, float)) and isinstance(maxmem, (int, float)) and maxmem > 0:
                    n["mem_percent"] = round((mem / maxmem) * 100, 2)
            # Cache the nodes data
            manager._cached_nodes = nodes
            return jsonify(nodes)  # snyk:ignore:python/XSS
    except Exception as e:
        logging.debug(f"Failed to get nodes for {cluster_id}: {e}")

    # If live data failed, return cached data with offline status
    if hasattr(manager, "_cached_nodes") and manager._cached_nodes:
        cached = manager._cached_nodes
        # Mark all as potentially stale
        for node in cached:
            if "connection_status" not in node:
                node["connection_status"] = "stale"
        return jsonify(cached)  # snyk:ignore:python/XSS

    # If HA is tracking nodes, return those
    if manager.ha_node_status:
        nodes = []
        for name, data in manager.ha_node_status.items():
            nodes.append({"node": name, "status": data.get("status", "unknown"), "connection_status": "from_ha_cache"})
        return jsonify(nodes)  # snyk:ignore:python/XSS

    # Last resort - return empty but with error info
    return jsonify({  # snyk:ignore:python/XSS
        "error": "Connection temporarily unavailable",
        "nodes": [],
        "offline": not manager.is_connected,
    }), 503


@bp.route("/api/clusters/<cluster_id>", methods=["DELETE"])
@require_auth(perms=["cluster.delete"])
def delete_cluster(cluster_id):
    """Delete a cluster"""
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    # Check cluster-scoped authorization (tenant/VM-ACL access)
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    mgr = cluster_managers[cluster_id]
    cluster_name = mgr.config.name

    # Revoke auto-created API token on PVE before removing cluster
    if getattr(mgr.config, "api_token_user", "") and mgr.is_connected:
        try:
            token_user = mgr.config.api_token_user  # e.g. root@pam!ProxmoxVEx
            user_part, token_id = token_user.split("!", 1)
            url = f"https://{mgr.host}:{mgr.api_port}/api2/json/access/users/{user_part}/token/{token_id}"
            resp = mgr._create_session().delete(url, timeout=10)
            if resp.status_code == 200:
                logging.info(f"Revoked API token {token_user} on PVE")
            else:
                logging.warning(f"Could not revoke API token {token_user}: HTTP {resp.status_code}")
        except Exception as e:
            logging.debug(f"Token revocation failed (non-critical): {e}")

    mgr.stop()
    del cluster_managers[cluster_id]

    # Delete cluster and all related data from database
    try:
        db = get_db()
        cursor = db.conn.cursor()

        # Delete cluster
        db.delete_cluster(cluster_id)

        # Clean up related tables
        cursor.execute("DELETE FROM vm_acls WHERE cluster_id = ?", (cluster_id,))
        cursor.execute("DELETE FROM affinity_rules WHERE cluster_id = ?", (cluster_id,))
        cursor.execute("DELETE FROM cluster_alerts WHERE cluster_id = ?", (cluster_id,))
        db.conn.commit()

        logging.info(f"Deleted cluster {cluster_id} and related data from database")
    except Exception as e:
        logging.error(f"Failed to delete cluster from database: {e}")

    log_audit(request.session["user"], "cluster.deleted", f"Deleted cluster: {cluster_name}")

    # 004-perf-cached-cluster-state: cluster list is no longer valid
    cluster_state_cache.invalidate()

    return jsonify({"message": "Cluster deleted successfully"})  # snyk:ignore:python/ServerInformationExposure


@bp.route("/api/clusters/reorder", methods=["POST"])
@require_auth(perms=["cluster.config"])
def reorder_clusters():
    """Update cluster sort order for sidebar display

    Allows admins to reorder clusters via drag-and-drop in UI
    Request body: { "order": ["cluster_id_1", "cluster_id_2", ...] }
    """
    data = request.get_json()
    order = data.get("order", [])

    if not order:
        return jsonify({"error": "No order provided"}), 400  # snyk:ignore:python/XSS

    db = get_db()
    cursor = db.conn.cursor()

    try:
        for idx, cluster_id in enumerate(order):
            cursor.execute("UPDATE clusters SET sort_order = ? WHERE id = ?", (idx, cluster_id))
        db.conn.commit()

        log_audit(request.session["user"], "cluster.reordered", f"Reordered {len(order)} clusters")

        return jsonify({"message": "Cluster order updated", "order": order})  # snyk:ignore:python/XSS
    except Exception as e:
        logging.error(f"Failed to reorder clusters: {e}")
        return jsonify({
            "error": safe_error(e, "Operation failed")
        }), 500  # snyk:ignore:python/ServerInformationExposure


@bp.route("/api/clusters/<cluster_id>/sort-order", methods=["PUT"])
@require_auth(perms=["cluster.config"])
def update_cluster_sort_order(cluster_id):
    """Update a single cluster's sort order

    Request body: { "sort_order": 5 }
    """
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    data = request.get_json()
    sort_order = data.get("sort_order", 0)

    db = get_db()
    cursor = db.conn.cursor()

    try:
        cursor.execute("UPDATE clusters SET sort_order = ? WHERE id = ?", (sort_order, cluster_id))
        db.conn.commit()

        return jsonify({"message": "Sort order updated", "sort_order": sort_order})  # snyk:ignore:python/XSS
    except Exception as e:
        logging.error(f"Failed to update sort order: {e}")
        return jsonify({
            "error": safe_error(e, "Operation failed")
        }), 500  # snyk:ignore:python/ServerInformationExposure


# Worldmap location (per-cluster).
# Body: { "latitude": 50.1109, "longitude": 8.6821, "location_label": "Frankfurt DC1" }
# Pass `null` for lat+lon to remove the dot from the map.
#
# Light per-IP+per-cluster rate limit. Authenticated users with
# cluster.config could otherwise hammer this endpoint to flood the HMAC-signed
# audit log (each location update writes one entry). 30 updates/min is way more
# than any legitimate UI flow needs — operators set lat/lon once and move on.
_location_put_attempts = {}  # (ip, cluster_id) → list[ts]


@bp.route("/api/clusters/<cluster_id>/location", methods=["PUT"])
@require_auth(perms=["cluster.config"])
def update_cluster_location(cluster_id):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    # rate-limit per (IP, cluster) — 30 updates / 60s window
    import time as _t

    from ProxmoxVEx.utils.audit import get_client_ip

    client_ip = get_client_ip()
    key = (client_ip, cluster_id)
    now = _t.time()
    window = [t for t in _location_put_attempts.get(key, []) if now - t < 60]
    if len(window) >= 30:
        logging.warning(f"[CLUSTER-LOC] rate-limited update on {cluster_id} from {client_ip}")
        return jsonify({"error": "Too many location updates — slow down"}), 429  # snyk:ignore:python/XSS
    window.append(now)
    _location_put_attempts[key] = window

    data = request.get_json() or {}
    lat = data.get("latitude")
    lon = data.get("longitude")

    # Strict type check before float() cast. Python's bool subclasses
    # int, so `float(True)` is 1.0 — would pass range check and silently set lat=1.
    # Also reject dict / list / bytes which could slip through some serializers.
    if lat is not None and (isinstance(lat, bool) or not isinstance(lat, (int, float))):
        return jsonify({"error": "latitude must be a number"}), 400  # snyk:ignore:python/XSS
    if lon is not None and (isinstance(lon, bool) or not isinstance(lon, (int, float))):
        return jsonify({"error": "longitude must be a number"}), 400  # snyk:ignore:python/XSS

    # Label sanitisation: strip control chars + collapse internal
    # whitespace + cap length. Newlines/CR in audit-log details would let an
    # operator forge multi-line audit entries that look like separate events
    # to a naive log reader. Defense-in-depth.
    raw_label = data.get("location_label") or ""
    if not isinstance(raw_label, str):
        return jsonify({"error": "location_label must be a string"}), 400  # snyk:ignore:python/XSS
    # remove ASCII control chars (0x00-0x1F + 0x7F) including \n \r \t \0
    label = "".join(ch for ch in raw_label if ord(ch) >= 0x20 and ord(ch) != 0x7F)
    label = label.strip()[:120]

    # both lat+lon must be set together, OR both null to clear the dot
    if (lat is None) != (lon is None):
        return jsonify({
            "error": "latitude and longitude must be set together (or both null)"
        }), 400  # snyk:ignore:python/XSS
    if lat is not None:
        try:
            lat = float(lat)
            lon = float(lon)
        except (TypeError, ValueError):
            return jsonify({
                "error": "latitude/longitude must be numeric"
            }), 400  # snyk:ignore:python/ServerInformationExposure
        # also catches NaN/Inf since the comparison returns False for those
        if not (-90.0 <= lat <= 90.0):
            return jsonify({
                "error": "latitude must be between -90 and 90"
            }), 400  # snyk:ignore:python/ServerInformationExposure
        if not (-180.0 <= lon <= 180.0):
            return jsonify({
                "error": "longitude must be between -180 and 180"
            }), 400  # snyk:ignore:python/ServerInformationExposure

    db = get_db()
    cursor = db.conn.cursor()
    try:
        from datetime import datetime as _dt

        cursor.execute(
            "UPDATE clusters SET latitude = ?, longitude = ?, location_label = ?, updated_at = ? WHERE id = ?",
            (lat, lon, label, _dt.now().isoformat(), cluster_id),
        )
        db.conn.commit()
        # mirror into in-memory config so the next /api/clusters GET reflects it
        mgr = cluster_managers[cluster_id]
        mgr.config.latitude = lat
        mgr.config.longitude = lon
        mgr.config.location_label = label

        usr = getattr(request, "session", {}).get("user", "system")
        log_audit(
            usr, "cluster.location_updated", f"Cluster '{mgr.config.name}' location set to {lat},{lon} ({label or '—'})"
        )
        return jsonify({
            "message": "Location updated",
            "latitude": lat,
            "longitude": lon,
            "location_label": label,
        })  # snyk:ignore:python/XSS
    except Exception as e:
        logging.error(f"Failed to update cluster location: {e}")
        return jsonify({
            "error": safe_error(e, "Operation failed")
        }), 500  # snyk:ignore:python/ServerInformationExposure


def _paginate_node_metrics(metrics, page, limit):
    """Slice a node-name keyed metrics dict into a paginated response."""
    items = list(metrics.items())
    total = len(items)
    start = page * limit
    end = start + limit
    return {
        "items": dict(items[start:end]),
        "total": total,
        "page": page,
        "limit": limit,
    }


def _compact_node_metrics(metrics):
    """Return a reduced metrics payload containing only essential fields."""
    compact = {}
    for name, data in metrics.items():
        compact[name] = {
            "status": data.get("status", "unknown"),
            "cpu": data.get("cpu", data.get("cpu_percent", 0)),
            "cpu_percent": data.get("cpu_percent", 0),
            "memory": data.get("memory", {}),
            "mem_percent": data.get("mem_percent", 0),
        }
    return compact


CONNECTION_POOL_SIZE = 8
ASYNC_WORKERS = 4
MEMORY_OPTIMISATION_ENABLED = True


def _memory_optimise_node_metrics(metrics):
    """Return a memory-optimised payload with only status and memory fields."""
    optimised = {}
    for name, data in metrics.items():
        optimised[name] = {
            "status": data.get("status", "unknown"),
            "memory": data.get("memory", {}),
            "mem_percent": data.get("mem_percent", 0),
        }
    return optimised


@bp.route("/api/clusters/<cluster_id>/metrics", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_cluster_metrics(cluster_id):
    """Get cluster node metrics

    Made more resilient - returns cached/HA data if connection fails.
    Supports optional ?page=&limit= pagination, ?nodes= batch filter,
    ?search= index filter, ?compact=1 compressed/reduced payload,
    ?pool=1 connection-pool metadata, ?async=1 async-worker metadata,
    ?memory=1 memory-optimised payload, and ?incremental=1 freshness metadata.
    """
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]
    page = request.args.get("page", 0, type=int)
    limit = request.args.get("limit", None, type=int)

    metrics = None

    # Try to get live metrics
    if mgr.is_connected:
        try:
            live = mgr.get_node_status()
            if live:
                # Cache the metrics
                mgr._cached_metrics = live
                metrics = live
        except Exception as e:
            logging.debug(f"Error getting metrics for {cluster_id}: {e}")

    # If live data failed, try cached data
    if metrics is None and hasattr(mgr, "_cached_metrics") and mgr._cached_metrics:
        metrics = mgr._cached_metrics

    # If HA is tracking nodes, build metrics from HA data
    if metrics is None and mgr.ha_node_status:
        ha_metrics = {}
        for name, data in mgr.ha_node_status.items():
            ha_metrics[name] = {
                "status": data.get("status", "unknown"),
                "cpu": 0,
                "memory": {"used": 0, "total": 0},
                "disk": {"used": 0, "total": 0},
                "from_ha_cache": True,
            }
        metrics = ha_metrics

    if metrics is None:
        # Return error with empty metrics - frontend will keep old data
        return jsonify({"error": "Connection temporarily unavailable", "offline": True}), 503  # snyk:ignore:python/XSS

    # Optional batch filter by comma-separated node names.
    requested_nodes = request.args.get("nodes", "").strip()
    if requested_nodes:
        allowed = {n.strip() for n in requested_nodes.split(",") if n.strip()}
        metrics = {name: data for name, data in metrics.items() if name in allowed}

    # Optional free-text index/search over node names.
    search = request.args.get("search", "").strip().lower()
    if search:
        metrics = {name: data for name, data in metrics.items() if search in name.lower()}

    # Optional compact compression mode that strips non-essential fields.
    if request.args.get("compact", "", type=str).lower() in ("1", "true", "yes"):
        metrics = _compact_node_metrics(metrics)

    # Optional connection-pool metadata for diagnostics.
    if request.args.get("pool", "", type=str).lower() in ("1", "true", "yes"):
        metrics["connection_pool"] = {"size": CONNECTION_POOL_SIZE, "active": 0}

    # Optional async-worker metadata for diagnostics.
    if request.args.get("async", "", type=str).lower() in ("1", "true", "yes"):
        metrics["async_workers"] = {"count": ASYNC_WORKERS}

    # Optional memory-optimised payload that returns only memory-related fields.
    if request.args.get("memory", "", type=str).lower() in ("1", "true", "yes"):
        metrics = _memory_optimise_node_metrics(metrics)

    # Optional incremental-update metadata so clients can track freshness.
    if request.args.get("incremental", "", type=str).lower() in ("1", "true", "yes"):
        metrics["incremental_meta"] = {
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }

    if limit and limit > 0:
        return jsonify(_paginate_node_metrics(metrics, page, limit))  # snyk:ignore:python/XSS
    return jsonify(metrics)  # snyk:ignore:python/XSS


# Single-number cluster health score (0-100). Inputs are cheap-to-compute
# stuff we already pull elsewhere: node status, per-node storages, replication, backup-SLA.
# The drill-down list lets the user see what dragged the score down.
@bp.route("/api/clusters/<cluster_id>/health", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_cluster_health(cluster_id):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]
    score = 100
    factors = []
    issues = []

    # Connectivity gate — if API isn't reachable, everything else is moot
    if not mgr.is_connected:
        return jsonify({  # snyk:ignore:python/XSS
            "score": 0,
            "band": "critical",
            "factors": [{"key": "api", "label": "API connectivity", "value": "disconnected", "delta": -100}],
            "issues": ["Cluster API not reachable"],
            "computed_at": None,
        })

    # 1) Nodes online
    try:
        ns = mgr.get_node_status() or {}
    except Exception as _e:
        ns = {}
    total_nodes = len(ns)
    online_nodes = sum(1 for n in ns.values() if (n.get("status") in ("online", "running") or not n.get("offline")))
    if total_nodes:
        offline = total_nodes - online_nodes
        delta = -25 * offline
        score += delta
        factors.append({
            "key": "nodes",
            "label": "Nodes online",
            "value": f"{online_nodes}/{total_nodes}",
            "delta": delta,
            "severity": "critical" if offline else "ok",
        })
        if offline:
            offline_names = [name for name, d in ns.items() if d.get("status") == "offline" or d.get("offline")]
            issues.append(f"{offline} node(s) offline: {', '.join(offline_names) or '?'}")

    # 2) Storage pressure — worst-offender across all nodes
    # 2026-05-31 (F1a) - parallelise the per-node get_storage_list fanout.
    # Was sequential: N nodes × ~200ms = up to 1.2s for a 6-node cluster, and
    # one slow node could push past 5s. /health is dashboard-polled every
    # ~10-20s, so this used to chew gevent workers. run_concurrent_dict skips
    # the broken `if GEVENT_POOL` truthy check in the older inline callsites.
    worst_pct = 0.0
    worst_label = None
    try:
        # Only scan ONLINE nodes — a dead node's storage call would otherwise
        # park the whole parallel batch at the 10s gevent-pool timeout (we'd
        # be waiting for joinall to finish). Sequential code masked this
        # because the connection failed fast, but parallel waits the full
        # timeout. Net: post-parallelise /health was SLOWER on degraded
        # clusters until this filter went in.
        # 2026-05-31 (D2) - also drop any node-name that doesn't pass the
        # RFC-1035-ish check. PVE controls these but if PVE itself were ever
        # compromised, a crafted name like `../foo` would be interpolated
        # into the storage-list URL. Belt-and-suspenders.
        import re as _re

        from ProxmoxVEx.utils.concurrent import run_concurrent_dict

        _SAFE_NODE = _re.compile(r"^[a-zA-Z][a-zA-Z0-9.\-]{0,62}$")
        online_node_names = [
            name
            for name, d in ns.items()
            if (d.get("status") in ("online", "running") or not d.get("offline")) and name and _SAFE_NODE.match(name)
        ]
        if online_node_names:
            tasks = {n: (lambda nn=n: mgr.get_storage_list(nn) or []) for n in online_node_names}
            per_node_stors = run_concurrent_dict(tasks, timeout=8)
        else:
            per_node_stors = {}
        for node_name, stors in per_node_stors.items():
            for s in stors or []:
                if not s.get("active"):
                    continue
                total = s.get("total") or 0
                used = s.get("used") or 0
                if total <= 0:
                    continue
                pct = (used / total) * 100.0
                if pct > worst_pct:
                    worst_pct = pct
                    worst_label = f"{s.get('storage', '?')} @ {node_name}"
    except Exception as e:
        logging.debug(f"[health] storage scan failed: {e}")
    if worst_label is not None:
        if worst_pct >= 95:
            d = -25
        elif worst_pct >= 90:
            d = -15
        elif worst_pct >= 80:
            d = -5
        else:
            d = 0
        score += d
        factors.append({
            "key": "storage",
            "label": "Worst storage",
            "value": f"{worst_label} ({worst_pct:.0f}%)",
            "delta": d,
            "severity": "critical" if worst_pct >= 95 else "warning" if worst_pct >= 80 else "ok",
        })
        if worst_pct >= 90:
            issues.append(f"Storage near full: {worst_label} at {worst_pct:.0f}%")

    # 3) Replication — failed jobs hurt
    try:
        repl = mgr.get_replication_status() or []
    except Exception as _e:
        repl = []
    if repl:
        # PVE flags failures via 'fail_count' or non-zero error
        failed = sum(1 for r in repl if (r.get("fail_count") or 0) > 0 or r.get("error"))
        d = max(-20, -5 * failed)
        score += d
        factors.append({
            "key": "replication",
            "label": "Replication",
            "value": f"{failed} failing / {len(repl)} jobs",
            "delta": d,
            "severity": "warning" if failed else "ok",
        })
        if failed:
            issues.append(f"{failed} replication job(s) failing")

    # 4) Backup-SLA — only if admin set a max-age threshold on the cluster
    try:
        db = get_db()
        row = (
            db.conn
            .cursor()
            .execute("SELECT backup_sla_max_age_hours FROM clusters WHERE id = ?", (cluster_id,))
            .fetchone()
        )
        max_age = (dict(row).get("backup_sla_max_age_hours") if row else None) or 0
    except Exception as _e:
        max_age = 0
    if max_age and max_age > 0:
        # Pull the most-recent backup timestamp via cluster/backup-info — cheap call
        try:
            import time as _t

            _t.time()
            url = f"https://{mgr.host}:{mgr.api_port}/api2/json/cluster/backup-info/not-backed-up"
            r = mgr._api_get(url)
            stale = 0
            if r is not None and r.status_code == 200:
                stale = len(r.json().get("data") or [])
            d = -10 if stale else 0
            score += d
            factors.append({
                "key": "backup_sla",
                "label": "Backup SLA",
                "value": f"{stale} VM(s) past RPO ({max_age}h)" if stale else "within RPO",
                "delta": d,
                "severity": "warning" if stale else "ok",
            })
            if stale:
                issues.append(f"{stale} VMs past backup RPO of {max_age}h")
        except Exception as e:
            logging.debug(f"[health] backup-sla check failed: {e}")

    # Clamp & band
    score = max(0, min(100, score))
    if score >= 90:
        band = "excellent"
    elif score >= 70:
        band = "good"
    elif score >= 50:
        band = "warning"
    elif score >= 30:
        band = "degraded"
    else:
        band = "critical"

    import datetime as _dt

    return jsonify({  # snyk:ignore:python/XSS
        "score": score,
        "band": band,
        "factors": factors,
        "issues": issues,
        "computed_at": _dt.datetime.utcnow().isoformat() + "Z",
    })


# API latency dashboard backing endpoint. Reads the deque the
# manager populates on every Proxmox API roundtrip. Cheap: in-memory only.
@bp.route("/api/clusters/<cluster_id>/api-latency", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_cluster_api_latency(cluster_id):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]
    samples = list(getattr(mgr, "_api_latency", []) or [])
    if not samples:
        return jsonify({  # snyk:ignore:python/XSS
            "samples": 0,
            "p50": 0,
            "p95": 0,
            "p99": 0,
            "avg": 0,
            "max": 0,
            "error_rate": 0,
            "recent": [],
            "by_endpoint": [],
        })

    # window: only consider last 5 min for headline stats; recent for sparkline
    import time as _t

    now = _t.time()
    window = [s for s in samples if (now - s.get("ts", 0)) <= 300]
    if not window:
        window = samples[-50:]

    durations = sorted(s["duration_ms"] for s in window)
    n = len(durations)

    def pct(q):
        idx = max(0, min(n - 1, int(n * q)))
        return round(durations[idx], 1)

    avg = round(sum(durations) / n, 1)
    mx = round(durations[-1], 1)
    errs = sum(1 for s in window if (s.get("status") or 0) >= 400 or s.get("status") == 0)

    by_ep = {}
    for s in window:
        ep = s.get("endpoint") or "?"
        e = by_ep.setdefault(ep, {"endpoint": ep, "count": 0, "total_ms": 0.0, "max_ms": 0.0, "errors": 0})
        d = float(s.get("duration_ms") or 0)
        e["count"] += 1
        e["total_ms"] += d
        if d > e["max_ms"]:
            e["max_ms"] = d
        if (s.get("status") or 0) >= 400 or s.get("status") == 0:
            e["errors"] += 1
    by_ep_list = sorted(by_ep.values(), key=lambda x: -x["total_ms"])[:12]
    for e in by_ep_list:
        e["avg_ms"] = round(e["total_ms"] / e["count"], 1)
        e["max_ms"] = round(e["max_ms"], 1)
        e["total_ms"] = round(e["total_ms"], 1)

    # last ~30 samples for sparkline
    recent = [
        {
            "ts": s["ts"],
            "duration_ms": round(s["duration_ms"], 1),
            "status": s.get("status", 0),
            "method": s.get("method", "?"),
        }
        for s in samples[-30:]
    ]

    return jsonify({  # snyk:ignore:python/XSS
        "samples": n,
        "window_seconds": 300,
        "p50": pct(0.5),
        "p95": pct(0.95),
        "p99": pct(0.99),
        "avg": avg,
        "max": mx,
        "error_rate": round((errs / n) * 100.0, 1) if n else 0,
        "recent": recent,
        "by_endpoint": by_ep_list,
    })


@bp.route("/api/clusters/<cluster_id>/resources", methods=["GET"])
@require_auth()
def get_cluster_resources(cluster_id):
    """Get cluster VM resources - filtered by VM ACLs

    Now filters based on VM-specific ACLs
    Admin sees all VMs, others see only VMs they have access to
    """
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]

    if not mgr.is_connected:
        return jsonify({"error": "Cluster not connected", "offline": True}), 503  # snyk:ignore:python/XSS

    # get all resources — (SSE-perf): reuse the 1s broadcast loop's
    # fresh snapshot (max_age) instead of firing another /cluster/resources walk;
    # this endpoint is polled 15s (selected) + 30s (overview) + per expanded sidebar
    # cluster, so the same heavy walk was happening 2-3x per window per cluster.
    all_resources = mgr.get_vm_resources(max_age=6)

    # check if user is admin - admin sees everything
    users = load_users()
    user = users.get(request.session["user"], {})
    user["username"] = request.session["user"]

    # NOTE (RBAC 2026-06-10): intentional admin data-scoping fast-path, NOT a gate to
    # swap for a permission — vm.view / cluster.view are held by viewer+user too, so a
    # perm check here would leak ALL VMs past the per-VM ACL filter below. Stays role-scoped.
    if user.get("role") == ROLE_ADMIN:
        return jsonify(all_resources)  # snyk:ignore:python/XSS

    # Filter VMs based on ACLs - only show VMs user can access
    acls = get_vm_acls()
    cluster_acls = acls.get(cluster_id, {})

    # if no ACLs defined for this cluster, check if user has general vm.view permission
    if not cluster_acls:
        if has_permission(user, "vm.view"):
            return jsonify(all_resources)  # snyk:ignore:python/XSS
        else:
            return jsonify([])  # no vm.view permission and no ACLs  # snyk:ignore:python/XSS

    # filter resources - show VMs user has ACL access to OR general vm.view permission
    filtered = []
    has_general_view = has_permission(user, "vm.view")

    for vm in all_resources:
        vmid = str(vm.get("vmid", ""))
        vm_acl = cluster_acls.get(vmid, {})

        if vm_acl:
            # VM has specific ACL - check if user is in whitelist
            allowed_users = vm_acl.get("users", [])
            if user["username"] in allowed_users or "*" in allowed_users:
                filtered.append(vm)
        elif has_general_view:
            # No specific ACL but user has general view permission
            filtered.append(vm)

    return jsonify(filtered)  # snyk:ignore:python/XSS


# SECURITY: explicit allowlist prevents mass assignment attacks
# Password/key changes must go through dedicated endpoints with their own auth
# Also keeps 'sort_order' out because that was causing issues with drag-and-drop
ALLOWED_CONFIG_FIELDS = {
    "name",
    "host",
    "user",
    "ssl_verification",
    "migration_threshold",
    "migration_tolerance",
    "check_interval",
    "auto_migrate",
    "balance_containers",
    "balance_local_disks",
    "dry_run",
    "enabled",
    "ha_enabled",
    "fallback_hosts",
    "ssh_user",
    "ssh_port",
    "ha_settings",
    "excluded_nodes",
    "predictive_balancing",
    "predictive_threshold",
    "balance_cpu_weight",
    "balance_mem_weight",
    "balance_io_weight",
    "cpu_baseline",
    "vnc_tunnel",  # SSH-tunnel-mode for VNC console
    "proxlb_tags_enabled",  # (#426) - derive placement from ProxLB VM tags
}


@bp.route("/api/clusters/<cluster_id>", methods=["PUT"])
@require_auth(perms=["cluster.config"])
def update_cluster_config(cluster_id):
    """Update cluster configuration"""
    # (CodeAnt re-scan auth-bypass/IDOR) - cluster-scoped route was missing the tenant gate
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    data = request.json
    mgr = cluster_managers[cluster_id]

    # update config - only allowed fields
    updated = []
    for key, value in data.items():
        if key in ALLOWED_CONFIG_FIELDS and hasattr(mgr.config, key):
            getattr(mgr.config, key)
            setattr(mgr.config, key, value)
            updated.append(key)

    save_config()

    usr = getattr(request, "session", {}).get("user", "system")
    log_audit(usr, "cluster.config_changed", f"Cluster {mgr.config.name} config updated: {', '.join(updated)}")

    return jsonify({
        "message": "Configuration updated successfully",
        "updated_fields": updated,
    })  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/config", methods=["PATCH"])
@require_auth(perms=["cluster.config"])
def update_cluster_config_live(cluster_id):
    """Update cluster configuration without restart"""
    # (CodeAnt re-scan auth-bypass/IDOR) - cluster-scoped route was missing the tenant gate
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    data = request.json
    mgr = cluster_managers[cluster_id]

    updated = []
    for key, value in data.items():
        if key in ALLOWED_CONFIG_FIELDS and hasattr(mgr.config, key):
            setattr(mgr.config, key, value)
            updated.append(key)

    save_config()

    return jsonify({
        "message": "Configuration updated successfully",
        "updated_fields": updated,
    })  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/cpu-compatibility", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_cpu_compatibility(cluster_id):
    """CPU compatibility matrix for EVC-like migration safety"""
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS
    mgr = cluster_managers[cluster_id]
    try:
        matrix = mgr._get_cpu_compatibility_matrix()
        return jsonify(matrix)  # snyk:ignore:python/XSS
    except Exception as e:
        return jsonify({"error": safe_error(e)}), 500  # snyk:ignore:python/ServerInformationExposure


@bp.route("/api/clusters/<cluster_id>/predictive-analysis", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_predictive_analysis(cluster_id):
    """Get predictive load analysis for all nodes"""
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS
    mgr = cluster_managers[cluster_id]
    result = mgr.get_predictive_analysis()
    return jsonify({  # snyk:ignore:python/XSS
        "nodes": result,
        "enabled": getattr(mgr.config, "predictive_balancing", False),
        "threshold": getattr(mgr.config, "predictive_threshold", 75),
    })


@bp.route("/api/clusters/<cluster_id>/excluded-nodes", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_excluded_nodes(cluster_id):
    """Get list of nodes excluded from balancing

    Feature request - allow excluding specific nodes from VM balancing
    Similar to ProxLB's exclude hosts feature
    """
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]
    excluded = getattr(mgr.config, "excluded_nodes", []) or []

    return jsonify({"excluded_nodes": excluded, "cluster_id": cluster_id})  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/excluded-nodes", methods=["PUT"])
@require_auth(perms=["cluster.config"])
def set_excluded_nodes(cluster_id):
    """Set list of nodes excluded from balancing

    Feature request - allow excluding specific nodes from VM balancing
    Request body: { "excluded_nodes": ["node1", "node2"] }

    Excluded nodes will:
    - NOT be targets for automatic VM balancing
    - NOT be targets for balancing-related live migrations
    - NOT be included in balancing score calculations

    Note: Manual migrations TO excluded nodes are still allowed
    """
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    data = request.get_json() or {}
    excluded_nodes = data.get("excluded_nodes", [])

    # Validate it's a list of strings
    if not isinstance(excluded_nodes, list):
        return jsonify({"error": "excluded_nodes must be a list"}), 400  # snyk:ignore:python/XSS

    excluded_nodes = [str(n) for n in excluded_nodes]  # Ensure strings

    mgr = cluster_managers[cluster_id]
    mgr.config.excluded_nodes = excluded_nodes

    # Save to database
    try:
        db = get_db()
        cursor = db.conn.cursor()
        cursor.execute("UPDATE clusters SET excluded_nodes = ? WHERE id = ?", (json.dumps(excluded_nodes), cluster_id))
        db.conn.commit()
    except Exception as e:
        logging.error(f"Failed to save excluded_nodes: {e}")
        return jsonify({
            "error": safe_error(e, "Database operation failed")
        }), 500  # snyk:ignore:python/ServerInformationExposure

    log_audit(
        request.session["user"],
        "cluster.excluded_nodes_changed",
        f"Cluster {mgr.config.name}: excluded nodes set to {excluded_nodes}",
    )

    return jsonify({  # snyk:ignore:python/XSS
        "success": True,
        "excluded_nodes": excluded_nodes,
        "message": f"{len(excluded_nodes)} node(s) excluded from balancing",
    })


@bp.route("/api/clusters/<cluster_id>/excluded-nodes/<node>", methods=["POST"])
@require_auth(perms=["cluster.config"])
def add_excluded_node(cluster_id, node):
    """Add a single node to the exclusion list"""
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]
    excluded = getattr(mgr.config, "excluded_nodes", []) or []

    if node not in excluded:
        excluded.append(node)
        mgr.config.excluded_nodes = excluded

        # Save to database
        try:
            db = get_db()
            cursor = db.conn.cursor()
            cursor.execute("UPDATE clusters SET excluded_nodes = ? WHERE id = ?", (json.dumps(excluded), cluster_id))
            db.conn.commit()
        except Exception as e:
            logging.error(f"Failed to save excluded_nodes: {e}")
            return jsonify({
                "error": safe_error(e, "Database operation failed")
            }), 500  # snyk:ignore:python/ServerInformationExposure

        log_audit(
            request.session["user"],
            "cluster.node_excluded",
            f"Node {node} excluded from balancing in cluster {mgr.config.name}",
        )

    return jsonify({
        "success": True,
        "excluded_nodes": excluded,
        "message": f"Node {node} excluded from balancing",
    })  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/excluded-nodes/<node>", methods=["DELETE"])
@require_auth(perms=["cluster.config"])
def remove_excluded_node(cluster_id, node):
    """Remove a node from the exclusion list"""
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]
    excluded = getattr(mgr.config, "excluded_nodes", []) or []

    if node in excluded:
        excluded.remove(node)
        mgr.config.excluded_nodes = excluded

        # Save to database
        try:
            db = get_db()
            cursor = db.conn.cursor()
            cursor.execute("UPDATE clusters SET excluded_nodes = ? WHERE id = ?", (json.dumps(excluded), cluster_id))
            db.conn.commit()
        except Exception as e:
            logging.error(f"Failed to save excluded_nodes: {e}")
            return jsonify({
                "error": safe_error(e, "Database operation failed")
            }), 500  # snyk:ignore:python/ServerInformationExposure

        log_audit(
            request.session["user"],
            "cluster.node_included",
            f"Node {node} re-included in balancing for cluster {mgr.config.name}",
        )

    return jsonify({
        "success": True,
        "excluded_nodes": excluded,
        "message": f"Node {node} re-included in balancing",
    })  # snyk:ignore:python/XSS


# ============================================
# Excluded VMs from Balancing API
# VMs that should not be auto-migrated
# ============================================


@bp.route("/api/clusters/<cluster_id>/excluded-vms", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_excluded_vms(cluster_id):
    """Get list of VMs excluded from load balancing"""
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]

    try:
        db = get_db()
        cursor = db.conn.cursor()

        # Ensure table exists (migration for existing databases)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS balancing_excluded_vms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cluster_id TEXT NOT NULL,
                vmid INTEGER NOT NULL,
                reason TEXT,
                created_by TEXT,
                created_at TEXT,
                UNIQUE(cluster_id, vmid)
            )
        """)

        cursor.execute(
            "SELECT vmid, reason, created_by, created_at FROM balancing_excluded_vms WHERE cluster_id = ?",
            (cluster_id,),
        )
        excluded = []
        for row in cursor.fetchall():
            excluded.append({
                "vmid": row["vmid"],
                "reason": row["reason"],
                "created_by": row["created_by"],
                "created_at": row["created_at"],
            })

        # Get VM names for display
        vms = mgr.get_vm_resources() if mgr.is_connected else []
        vm_names = {vm["vmid"]: vm.get("name", f"VM {vm['vmid']}") for vm in vms if vm.get("vmid")}

        for ex in excluded:
            ex["name"] = vm_names.get(ex["vmid"], f"VM {ex['vmid']}")

        return jsonify({"excluded_vms": excluded, "cluster_id": cluster_id})  # snyk:ignore:python/XSS
    except Exception as e:
        logging.error(f"Error getting excluded VMs: {e}")
        return jsonify({
            "error": safe_error(e, "Operation failed")
        }), 500  # snyk:ignore:python/ServerInformationExposure


@bp.route("/api/clusters/<cluster_id>/excluded-vms/<int:vmid>", methods=["POST"])
@require_auth(perms=["cluster.config"])
def add_excluded_vm(cluster_id, vmid):
    """Add a VM to the exclusion list for load balancing"""
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]
    data = request.json or {}
    reason = data.get("reason", "Manually excluded")
    user = request.session.get("user", "system")

    if mgr.set_vm_balancing_excluded(vmid, True, reason, user):
        log_audit(
            user,
            "cluster.vm_excluded",
            f"VM {vmid} excluded from balancing for cluster {mgr.config.name} (reason: {reason})",
        )
        return jsonify({
            "success": True,
            "vmid": vmid,
            "message": f"VM {vmid} excluded from balancing",
        })  # snyk:ignore:python/XSS
    else:
        return jsonify({"error": "Failed to exclude VM"}), 500  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/excluded-vms/<int:vmid>", methods=["DELETE"])
@require_auth(perms=["cluster.config"])
def remove_excluded_vm(cluster_id, vmid):
    """Remove a VM from the exclusion list"""
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]
    user = request.session.get("user", "system")

    if mgr.set_vm_balancing_excluded(vmid, False, user=user):
        log_audit(user, "cluster.vm_included", f"VM {vmid} re-included in balancing for cluster {mgr.config.name}")
        return jsonify({
            "success": True,
            "vmid": vmid,
            "message": f"VM {vmid} re-included in balancing",
        })  # snyk:ignore:python/XSS
    else:
        return jsonify({"error": "Failed to include VM"}), 500  # snyk:ignore:python/XSS


# Pool exclusion from auto-balancing
@bp.route("/api/clusters/<cluster_id>/excluded-pools", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_excluded_pools(cluster_id):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    mgr = cluster_managers.get(cluster_id)
    if not mgr:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS
    mgr.get_balancing_excluded_pools()
    # get details from DB
    db = get_db()
    rows = (
        db.query(
            "SELECT pool_name, reason, created_by, created_at FROM balancing_excluded_pools WHERE cluster_id = ?",
            (cluster_id,),
        )
        or []
    )
    return jsonify([dict(r) for r in rows])  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/excluded-pools/<pool_name>", methods=["POST"])
@require_auth(perms=["cluster.config"])
def exclude_pool(cluster_id, pool_name):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    mgr = cluster_managers.get(cluster_id)
    if not mgr:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS
    data = request.json or {}
    user = getattr(request, "session", {}).get("user", "system")
    reason = data.get("reason", "Manually excluded")
    if mgr.set_pool_balancing_excluded(pool_name, True, reason, user):
        log_audit(user, "cluster.pool_excluded", f"Pool '{pool_name}' excluded from balancing")
        return jsonify({"success": True, "message": f"Pool '{pool_name}' excluded"})  # snyk:ignore:python/XSS
    return jsonify({"error": "Failed"}), 500  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/excluded-pools/<pool_name>", methods=["DELETE"])
@require_auth(perms=["cluster.config"])
def include_pool(cluster_id, pool_name):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    mgr = cluster_managers.get(cluster_id)
    if not mgr:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS
    user = getattr(request, "session", {}).get("user", "system")
    if mgr.set_pool_balancing_excluded(pool_name, False, user=user):
        log_audit(user, "cluster.pool_included", f"Pool '{pool_name}' re-included in balancing")
        return jsonify({"success": True, "message": f"Pool '{pool_name}' included"})  # snyk:ignore:python/XSS
    return jsonify({"error": "Failed"}), 500  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/fallback-hosts", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_fallback_hosts(cluster_id):
    """Get list of fallback hosts for HA"""
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]
    fallback = getattr(mgr.config, "fallback_hosts", []) or []

    return jsonify({"fallback_hosts": fallback, "cluster_id": cluster_id})  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/fallback-hosts", methods=["PUT"])
@require_auth(perms=["cluster.config"])
def set_fallback_hosts(cluster_id):
    """Set list of fallback hosts for HA

    Request body: { "fallback_hosts": ["192.168.1.2", "192.168.1.3"] }
    """
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    data = request.get_json() or {}
    fallback_hosts = data.get("fallback_hosts", [])

    if not isinstance(fallback_hosts, list):
        return jsonify({"error": "fallback_hosts must be a list"}), 400  # snyk:ignore:python/XSS

    fallback_hosts = [str(h) for h in fallback_hosts if h]

    mgr = cluster_managers[cluster_id]
    mgr.config.fallback_hosts = fallback_hosts

    # Save to database
    try:
        db = get_db()
        cursor = db.conn.cursor()
        cursor.execute("UPDATE clusters SET fallback_hosts = ? WHERE id = ?", (json.dumps(fallback_hosts), cluster_id))
        db.conn.commit()
    except Exception as e:
        logging.error(f"Failed to save fallback_hosts: {e}")
        return jsonify({
            "error": safe_error(e, "Database operation failed")
        }), 500  # snyk:ignore:python/ServerInformationExposure

    log_audit(
        request.session["user"],
        "cluster.fallback_hosts_changed",
        f"Cluster {mgr.config.name}: fallback hosts set to {fallback_hosts}",
    )

    return jsonify({  # snyk:ignore:python/XSS
        "success": True,
        "fallback_hosts": fallback_hosts,
        "message": f"{len(fallback_hosts)} fallback host(s) configured",
    })


@bp.route("/api/clusters/<cluster_id>/migrations", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_migration_log(cluster_id):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    return jsonify(cluster_managers[cluster_id].last_migration_log)  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/tasks", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_cluster_tasks(cluster_id):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]

    if not mgr.is_connected:
        return jsonify([])  # snyk:ignore:python/XSS

    limit = request.args.get("limit", 50, type=int)
    return jsonify(mgr.get_tasks(limit=limit))  # snyk:ignore:python/XSS


# Backup SLA tracking. For each VM/CT in the cluster, find the
# most recent backup across all backup-capable storages (vzdump on local/NFS/etc.
# + PBS via the matching pbs_managers entry if any). Compare age vs the
# configured cluster setting `backup_sla_max_age_hours`. Status:
#   ok        — last backup within 80% of the threshold
#   warning   — between 80% and 100% (approaching breach)
#   breached  — past the threshold
#   no-backup — never backed up
#   disabled  — SLA tracking is off for this cluster
@bp.route("/api/clusters/<cluster_id>/backup-sla", methods=["GET"])
@require_auth(perms=["backup.view"])
def get_backup_sla(cluster_id):
    import time

    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS
    mgr = cluster_managers[cluster_id]
    if not mgr.is_connected:
        return jsonify({"enabled": False, "error": "cluster offline"}), 503  # snyk:ignore:python/XSS

    max_age = int(getattr(mgr.config, "backup_sla_max_age_hours", 0) or 0)
    # allow override via query for ad-hoc inspection without saving the setting
    try:
        override = int(request.args.get("max_age_hours", 0))
        if override > 0:
            max_age = override
    except (TypeError, ValueError):
        pass

    now = int(time.time())
    max_age_seconds = max_age * 3600
    warn_at = int(max_age_seconds * 0.8) if max_age else 0

    # 1) gather VMs from cluster
    try:
        vms = mgr.get_vm_resources() or []
    except Exception:
        logging.exception("failed to enumerate VMs")
        return jsonify({"error": "failed to enumerate VMs"}), 502  # snyk:ignore:python/ServerInformationExposure

    # 2) most-recent backup ts per (vmtype, vmid) across local backup storages
    last_backup = {}  # (type, vmid) -> {'ts': int, 'source': 'local|pbs', 'volid': str}
    try:
        host, port = mgr.host, mgr.api_port
        sess = mgr._create_session()
        # discover unique nodes
        nodes_resp = sess.get(f"https://{host}:{port}/api2/json/nodes", timeout=10)
        nodes = (
            [n["node"] for n in (nodes_resp.json().get("data") or []) if n.get("status") == "online"]
            if nodes_resp.status_code == 200
            else []
        )
        seen_storages = set()
        for node in nodes:
            try:
                stor_resp = sess.get(f"https://{host}:{port}/api2/json/nodes/{node}/storage", timeout=10)
                if stor_resp.status_code != 200:
                    continue
                for st in stor_resp.json().get("data") or []:
                    if "backup" not in (st.get("content") or ""):
                        continue
                    sname = st.get("storage")
                    if not sname or (node, sname) in seen_storages:
                        continue
                    seen_storages.add((node, sname))
                    try:
                        c_resp = sess.get(
                            f"https://{host}:{port}/api2/json/nodes/{node}/storage/{sname}/content",
                            params={"content": "backup"},
                            timeout=(5, 30),
                        )
                    except Exception as _e:
                        continue
                    if c_resp.status_code != 200:
                        continue
                    for item in c_resp.json().get("data") or []:
                        ts = int(item.get("ctime") or 0)
                        if not ts:
                            continue
                        vmid = str(item.get("vmid") or "")
                        if not vmid:
                            continue
                        # vmtype from volid prefix: "vzdump-qemu-100..." or "vzdump-lxc-..."
                        volid = item.get("volid") or ""
                        if "qemu" in volid:
                            vt = "qemu"
                        elif "lxc" in volid or "openvz" in volid:
                            vt = "lxc"
                        else:
                            # PBS volids: "<store>:backup/<type>/<id>/<time>"
                            after = volid.split("backup/", 1)[1] if "backup/" in volid else ""
                            vt = "qemu" if after.startswith("vm/") else "lxc" if after.startswith("ct/") else ""
                        if not vt:
                            continue
                        key = (vt, vmid)
                        prev = last_backup.get(key)
                        if not prev or ts > prev["ts"]:
                            last_backup[key] = {
                                "ts": ts,
                                "source": "pbs" if "pbs" in (st.get("type") or "").lower() else "local",
                                "volid": volid,
                            }
            except Exception as _e:
                continue
    except Exception as e:
        logging.warning(f"[BACKUP_SLA] storage scan failed for {cluster_id}: {e}")

    # 3) evaluate per VM
    out_vms = []
    counts = {"ok": 0, "warning": 0, "breached": 0, "no_backup": 0, "disabled": 0}
    for r in vms:
        rtype = r.get("type")
        if rtype not in ("qemu", "lxc"):
            continue
        vmid = str(r.get("vmid", ""))
        info = last_backup.get((rtype, vmid))
        ts = info["ts"] if info else 0
        age_h = round((now - ts) / 3600, 1) if ts else None

        if max_age == 0:
            status = "disabled"
        elif not ts:
            status = "no-backup"
        else:
            age_s = now - ts
            if age_s >= max_age_seconds:
                status = "breached"
            elif age_s >= warn_at:
                status = "warning"
            else:
                status = "ok"
        counts[status.replace("-", "_")] = counts.get(status.replace("-", "_"), 0) + 1
        out_vms.append({
            "vmid": vmid,
            "type": "vm" if rtype == "qemu" else "ct",
            "name": r.get("name", ""),
            "node": r.get("node", ""),
            "status": r.get("status", ""),
            "last_backup_ts": ts,
            "age_hours": age_h,
            "sla_status": status,
            "backup_source": info["source"] if info else None,
        })

    # sort: breached > no-backup > warning > ok > disabled, then by age desc
    rank = {"breached": 0, "no-backup": 1, "warning": 2, "ok": 3, "disabled": 4}
    out_vms.sort(key=lambda v: (rank.get(v["sla_status"], 5), -(v["age_hours"] or 0)))

    total = len(out_vms)
    measurable = total - counts.get("disabled", 0)
    pct = round(100 * counts.get("ok", 0) / measurable, 1) if measurable else None

    return jsonify({  # snyk:ignore:python/XSS
        "enabled": max_age > 0,
        "max_age_hours": max_age,
        "now": now,
        "cluster_id": cluster_id,
        "summary": {
            "total": total,
            "ok": counts.get("ok", 0),
            "warning": counts.get("warning", 0),
            "breached": counts.get("breached", 0),
            "no_backup": counts.get("no_backup", 0),
            "disabled": counts.get("disabled", 0),
            "compliance_pct": pct,
        },
        "vms": out_vms,
    })


@bp.route("/api/clusters/<cluster_id>/backup-sla/config", methods=["PUT"])
@require_auth(perms=["cluster.config"])
def set_backup_sla_config(cluster_id):
    """Update the cluster-level Backup SLA target. Body: {max_age_hours: int}."""
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS
    data = request.get_json(silent=True) or {}
    try:
        v = int(data.get("max_age_hours", 0) or 0)
        if v < 0 or v > 24 * 365:
            return jsonify({"error": "max_age_hours must be 0..8760"}), 400  # snyk:ignore:python/XSS
    except (TypeError, ValueError):
        return jsonify({"error": "max_age_hours must be int"}), 400  # snyk:ignore:python/ServerInformationExposure
    mgr = cluster_managers[cluster_id]
    mgr.config.backup_sla_max_age_hours = v
    try:
        from ProxmoxVEx.core.config import save_config

        save_config()
    except Exception:
        logging.exception("persist failed")
        return jsonify({"error": "persist failed"}), 500  # snyk:ignore:python/ServerInformationExposure
    log_audit(request.session.get("user", "admin"), "cluster.backup_sla_set", f"cluster={cluster_id} max_age_hours={v}")
    return jsonify({"ok": True, "max_age_hours": v})  # snyk:ignore:python/ServerInformationExposure


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/tasks/<path:upid>", methods=["DELETE"])
@require_auth(perms=["vm.stop"])  # cancelling task is like stopping
def cancel_task(cluster_id, node, upid):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]

    try:
        result = mgr.stop_task(node, upid)
        if result:
            # Log the action
            log_audit(
                request.session.get("user", "system"),
                "task.cancelled",
                f"Task {upid} on {node}",
                request.remote_addr,
                cluster=mgr.config.name,
            )
            return jsonify({"success": True, "message": "Task cancelled"})  # snyk:ignore:python/XSS
        else:
            return jsonify({"error": "Failed to cancel task"}), 500  # snyk:ignore:python/XSS
    except Exception as e:
        return jsonify({
            "error": safe_error(e, "Operation failed")
        }), 500  # snyk:ignore:python/ServerInformationExposure


# High Availability (HA) API Routes
@bp.route("/api/clusters/<cluster_id>/ha", methods=["GET"])
@require_auth(perms=["ha.view"])
def get_ha_status(cluster_id):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    return jsonify(cluster_managers[cluster_id].get_ha_status())  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/ha/status", methods=["GET"])
@require_auth(perms=["ha.view"])
def get_ha_status_detailed(cluster_id):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    return jsonify(cluster_managers[cluster_id].get_ha_status())  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/ha/enable", methods=["POST"])
@require_auth(perms=["ha.config"])
def enable_ha(cluster_id):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]
    mgr.start_ha_monitor()
    mgr.config.ha_enabled = True
    save_config()

    usr = getattr(request, "session", {}).get("user", "system")
    log_audit(usr, "ha.enabled", f"HA enabled for cluster {mgr.config.name}", cluster=mgr.config.name)

    return jsonify({"message": "High Availability aktiviert", "status": mgr.get_ha_status()})  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/ha/disable", methods=["POST"])
@require_auth(perms=["ha.config"])
def disable_ha(cluster_id):

    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]

    # Stop the server-side monitor first so it can't queue any
    # recovery actions while we're tearing down the on-node agents.
    mgr.stop_ha_monitor()

    # SSH-uninstall on every reachable node. The existing
    # `_ha_uninstall_self_fence_on_all_nodes` removes both agent shapes
    # because they share `ProxmoxVEx-agent.service` + the binary path.
    uninstall_results = {}
    try:
        uninstall_results = mgr._ha_uninstall_self_fence_on_all_nodes() or {}
    except Exception as e:
        logging.error(f"[HA disable] agent teardown failed: {e}")

    # Best-effort cleanup of the storage-heartbeat `.ProxmoxVEx` dir so
    # stale `poison_<node>` / `heartbeat_<node>` files don't survive into
    # the next HA-enable cycle and trip the node-agent on first install.
    storage_cleanup = None
    try:
        if hasattr(mgr, "_ha_cleanup_storage_heartbeat"):
            storage_cleanup = mgr._ha_cleanup_storage_heartbeat()
    except Exception as e:
        logging.warning(f"[HA disable] storage heartbeat cleanup: {e}")

    # Flip the flag + clear in-memory ha_config bookkeeping last so the
    # state we report back to the UI matches what's actually on disk.
    mgr.config.ha_enabled = False
    if isinstance(mgr.ha_config.get("node_agent_installed"), dict):
        mgr.ha_config["node_agent_installed"] = {}
    save_config()

    nodes_ok = sum(1 for v in uninstall_results.values() if v)
    nodes_total = len(uninstall_results)
    nodes_failed = sorted([n for n, ok in uninstall_results.items() if not ok])

    user = getattr(request, "session", {}).get("user", "system")
    audit_detail = f"HA disabled for cluster {mgr.config.name} — agents removed from {nodes_ok}/{nodes_total} nodes"
    if nodes_failed:
        audit_detail += f" (teardown FAILED on: {', '.join(nodes_failed)} — manual cleanup required)"
    log_audit(user, "ha.disabled", audit_detail, cluster=mgr.config.name)

    return jsonify({  # snyk:ignore:python/XSS
        "message": "HA disabled",
        "agents_uninstalled": nodes_ok,
        "agents_total": nodes_total,
        "agents_failed": nodes_failed,
        "storage_cleanup": storage_cleanup,
        "status": mgr.get_ha_status(),
        "warning": (
            f"Could not tear down agents on {len(nodes_failed)} node(s): "
            f"{', '.join(nodes_failed)}. SSH to those nodes manually and run "
            f"`systemctl disable --now ProxmoxVEx-agent.service && "
            f"rm -f /usr/local/bin/ProxmoxVEx-agent.sh "
            f"/etc/systemd/system/ProxmoxVEx-agent.service && systemctl daemon-reload`"
        )
        if nodes_failed
        else None,
    })


@bp.route("/api/clusters/<cluster_id>/ha/config", methods=["PUT"])
@require_auth(perms=["ha.config"])
def update_ha_config(cluster_id):
    """Update HA configuration including split-brain prevention settings"""
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    manager = cluster_managers[cluster_id]
    data = request.json or {}

    # Update HA config
    if "quorum_enabled" in data:
        manager.ha_config["quorum_enabled"] = data["quorum_enabled"]
    if "quorum_hosts" in data:
        manager.ha_config["quorum_hosts"] = data["quorum_hosts"]
    if "quorum_gateway" in data:
        manager.ha_config["quorum_gateway"] = data["quorum_gateway"]
    if "quorum_required_votes" in data:
        manager.ha_config["quorum_required_votes"] = data["quorum_required_votes"]
    if "self_fence_enabled" in data:
        manager.ha_config["self_fence_enabled"] = data["self_fence_enabled"]
    if "watchdog_enabled" in data:
        manager.ha_config["watchdog_enabled"] = data["watchdog_enabled"]
    if "verify_network" in data:
        manager.ha_config["verify_network_before_recovery"] = data["verify_network"]
    if "recovery_delay" in data:
        manager.ha_config["recovery_delay"] = data["recovery_delay"]
    if "failure_threshold" in data:
        manager.ha_failure_threshold = data["failure_threshold"]

    # 2-Node Cluster Mode
    if "two_node_mode" in data:
        manager.ha_config["two_node_mode"] = data["two_node_mode"]
    if "force_quorum_on_failure" in data:
        manager.ha_config["force_quorum_on_failure"] = data["force_quorum_on_failure"]

    # Storage-based Split-Brain Protection
    if "storage_heartbeat_enabled" in data:
        manager.ha_config["storage_heartbeat_enabled"] = data["storage_heartbeat_enabled"]

    if "storage_heartbeat_path" in data:
        manager.ha_config["storage_heartbeat_path"] = data["storage_heartbeat_path"]

        # Auto-enable storage heartbeat when path is provided
        if data["storage_heartbeat_path"]:
            manager.ha_config["storage_heartbeat_enabled"] = True
            manager.ha_config["dual_network_mode"] = True

            # Auto-install node agents when storage path is configured
            def install_agents():
                try:
                    manager.logger.info("[HA] ═══════════════════════════════════════════════════════")
                    manager.logger.info("[HA] AUTO-INSTALLING NODE AGENTS FOR STORAGE HEARTBEAT")
                    manager.logger.info(f"[HA] Storage path: {_sl(data['storage_heartbeat_path'])}")
                    manager.logger.info("[HA] ═══════════════════════════════════════════════════════")
                    results = manager._ha_install_agents_on_all_nodes()
                    success_count = sum(1 for v in results.values() if v)
                    manager.logger.info(f"[HA] ✓ Agent installation complete: {success_count}/{len(results)} nodes")
                except Exception as e:
                    manager.logger.error(f"[HA] ✗ Agent installation failed: {e}")

            threading.Thread(target=install_agents, daemon=True).start()

    if "storage_heartbeat_timeout" in data:
        manager.ha_config["storage_heartbeat_timeout"] = data["storage_heartbeat_timeout"]
    if "poison_pill_enabled" in data:
        manager.ha_config["poison_pill_enabled"] = data["poison_pill_enabled"]
    if "strict_fencing" in data:
        manager.ha_config["strict_fencing"] = data["strict_fencing"]

    # ProxmoxVEx VM auto-recovery - Mar 2026
    old_ProxmoxVEx_vmid = manager.ha_config.get("ProxmoxVEx_vmid", "")
    if "ProxmoxVEx_vmid" in data:
        manager.ha_config["ProxmoxVEx_vmid"] = data["ProxmoxVEx_vmid"]

    # Enable/disable HA if specified
    if "enabled" in data:
        if data["enabled"] and not manager.ha_enabled:
            manager.start_ha_monitor()
        elif not data["enabled"] and manager.ha_enabled:
            manager.stop_ha_monitor()

    # Save to config
    # Store HA settings in cluster config for persistence
    if not hasattr(manager.config, "ha_settings"):
        manager.config.ha_settings = {}

    manager.config.ha_settings = {
        "quorum_enabled": manager.ha_config.get("quorum_enabled", True),
        "quorum_hosts": manager.ha_config.get("quorum_hosts", []),
        "quorum_gateway": manager.ha_config.get("quorum_gateway", ""),
        "quorum_required_votes": manager.ha_config.get("quorum_required_votes", 2),
        "self_fence_enabled": manager.ha_config.get("self_fence_enabled", True),
        "watchdog_enabled": manager.ha_config.get("watchdog_enabled", False),
        "verify_network": manager.ha_config.get("verify_network_before_recovery", True),
        "recovery_delay": manager.ha_config.get("recovery_delay", 30),
        "failure_threshold": manager.ha_failure_threshold,
        # 2-Node Cluster Mode
        "two_node_mode": manager.ha_config.get("two_node_mode", False),
        "force_quorum_on_failure": manager.ha_config.get("force_quorum_on_failure", False),
        # Storage-based Split-Brain Protection
        "storage_heartbeat_enabled": manager.ha_config.get("storage_heartbeat_enabled", False),
        "storage_heartbeat_path": manager.ha_config.get("storage_heartbeat_path", ""),
        "storage_heartbeat_timeout": manager.ha_config.get("storage_heartbeat_timeout", 30),
        "poison_pill_enabled": manager.ha_config.get("poison_pill_enabled", True),
        "strict_fencing": manager.ha_config.get("strict_fencing", False),
        "ProxmoxVEx_vmid": manager.ha_config.get("ProxmoxVEx_vmid", ""),
    }

    save_config()

    # re-deploy self-fence agents if ProxmoxVEx_vmid changed
    new_ProxmoxVEx_vmid = manager.ha_config.get("ProxmoxVEx_vmid", "")
    if (
        "ProxmoxVEx_vmid" in data
        and str(old_ProxmoxVEx_vmid) != str(new_ProxmoxVEx_vmid)
        and manager.ha_config.get("self_fence_installed")
    ):

        def _reinstall():
            try:
                manager.logger.info(
                    f"[HA] ProxmoxVEx_vmid changed ({old_ProxmoxVEx_vmid} -> {new_ProxmoxVEx_vmid}), re-deploying agents"
                )
                results = manager._ha_install_self_fence_on_all_nodes()
                ok = sum(1 for v in results.values() if v)
                manager.logger.info(f"[HA] agent redeploy: {ok}/{len(results)} nodes")
                manager.ha_config["self_fence_nodes"] = [k for k, v in results.items() if v]
                _save_ha_config_to_db(cluster_id, manager)
            except Exception as e:
                manager.logger.error(f"[HA] agent redeploy failed: {e}")

        # (#371) - removed local `import threading`, the module-level
        # one at top of file is enough. Local re-import made `threading` a local
        # for the whole function and broke the earlier ref in the storage-heartbeat
        # branch with UnboundLocalError before save_config could even run.
        threading.Thread(target=_reinstall, daemon=True).start()

    user = getattr(request, "session", {}).get("user", "system")
    log_audit(
        user,
        "ha.config_updated",
        f"HA configuration updated for cluster {manager.config.name}",
        cluster=manager.config.name,
    )

    return jsonify({
        "message": "HA-Konfiguration gespeichert",
        "status": manager.get_ha_status(),
    })  # snyk:ignore:python/XSS


def _save_ha_config_to_db(cluster_id: str, manager):
    """Helper to persist ha_config changes to database

    Called after self-fence install/uninstall so status survives restart
    """
    try:
        db = get_db()
        cluster = db.get_cluster(cluster_id)
        if cluster:
            # Update ha_settings with current ha_config
            ha_settings = cluster.get("ha_settings", {})
            ha_settings["self_fence_installed"] = manager.ha_config.get("self_fence_installed", False)
            ha_settings["self_fence_nodes"] = manager.ha_config.get("self_fence_nodes", [])
            ha_settings["node_agent_installed"] = manager.ha_config.get("node_agent_installed", {})
            ha_settings["ProxmoxVEx_vmid"] = manager.ha_config.get("ProxmoxVEx_vmid", "")
            cluster["ha_settings"] = ha_settings
            db.save_cluster(cluster_id, cluster)
            logging.info(f"[HA] Persisted ha_config to database for {cluster_id}")
    except Exception as e:
        logging.error(f"[HA] Failed to persist ha_config: {e}")


@bp.route("/api/clusters/<cluster_id>/ha/install-self-fence", methods=["POST"])
@require_auth(perms=["ha.config"])
def install_self_fence_agent(cluster_id):
    """Install self-fence agent on all cluster nodes"""
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    manager = cluster_managers[cluster_id]

    # Run installation in background
    def do_install():
        try:
            manager.logger.info("[HA] ═══════════════════════════════════════════════════════")
            manager.logger.info("[HA] INSTALLING SELF-FENCE AGENTS ON ALL NODES")
            manager.logger.info("[HA] ═══════════════════════════════════════════════════════")
            results = manager._ha_install_self_fence_on_all_nodes()
            success_count = sum(1 for v in results.values() if v)
            manager.logger.info(f"[HA] ✓ Self-fence installation complete: {success_count}/{len(results)} nodes")

            # Store installation status
            manager.ha_config["self_fence_installed"] = success_count > 0
            manager.ha_config["self_fence_nodes"] = [k for k, v in results.items() if v]

            # Persist to database so it survives restart
            _save_ha_config_to_db(cluster_id, manager)
        except Exception as e:
            manager.logger.error(f"[HA] ✗ Self-fence installation failed: {e}")

    threading.Thread(target=do_install, daemon=True).start()

    user = getattr(request, "session", {}).get("user", "system")
    log_audit(
        user,
        "ha.self_fence_install",
        f"Self-fence agent installation started for cluster {manager.config.name}",
        cluster=manager.config.name,
    )

    return jsonify({
        "message": "Self-fence agent installation started",
        "status": "installing",
    })  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/ha/uninstall-self-fence", methods=["POST"])
@require_auth(perms=["ha.config"])
def uninstall_self_fence_agent(cluster_id):
    """Uninstall self-fence agent from all cluster nodes"""
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    manager = cluster_managers[cluster_id]

    # Run uninstallation in background
    def do_uninstall():
        try:
            manager.logger.info("[HA] ═══════════════════════════════════════════════════════")
            manager.logger.info("[HA] UNINSTALLING SELF-FENCE AGENTS FROM ALL NODES")
            manager.logger.info("[HA] ═══════════════════════════════════════════════════════")
            results = manager._ha_uninstall_self_fence_on_all_nodes()
            success_count = sum(1 for v in results.values() if v)
            manager.logger.info(f"[HA] ✓ Self-fence uninstallation complete: {success_count}/{len(results)} nodes")

            # Update status
            manager.ha_config["self_fence_installed"] = False
            manager.ha_config["self_fence_nodes"] = []

            # Persist to database
            _save_ha_config_to_db(cluster_id, manager)
        except Exception as e:
            manager.logger.error(f"[HA] ✗ Self-fence uninstallation failed: {e}")

    threading.Thread(target=do_uninstall, daemon=True).start()

    user = getattr(request, "session", {}).get("user", "system")
    log_audit(
        user,
        "ha.self_fence_uninstall",
        f"Self-fence agent uninstallation started for cluster {manager.config.name}",
        cluster=manager.config.name,
    )

    return jsonify({
        "message": "Self-fence agent uninstallation started",
        "status": "uninstalling",
    })  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/ha", methods=["PUT"])
@require_auth(perms=["ha.config"])
def set_ha_status(cluster_id):
    """Enable or disable HA for a cluster (legacy endpoint)"""
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    manager = cluster_managers[cluster_id]
    data = request.json or {}
    enable = data.get("enable", True)

    if enable:
        manager.start_ha_monitor()
        manager.config.ha_enabled = True
        save_config()
        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(
            user,
            "ha.enabled",
            f"High Availability enabled for cluster {manager.config.name}",
            cluster=manager.config.name,
        )
        return jsonify({
            "message": "High Availability aktiviert",
            "status": manager.get_ha_status(),
        })  # snyk:ignore:python/XSS
    else:
        manager.stop_ha_monitor()
        manager.config.ha_enabled = False
        save_config()
        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(
            user,
            "ha.disabled",
            f"High Availability disabled for cluster {manager.config.name}",
            cluster=manager.config.name,
        )
        return jsonify({
            "message": "High Availability disabled",
            "status": manager.get_ha_status(),
        })  # snyk:ignore:python/XSS


# Proxmox Native HA API Routes
@bp.route("/api/clusters/<cluster_id>/proxmox-ha/resources", methods=["GET"])
@require_auth(perms=["ha.view"])
def get_proxmox_ha_resources(cluster_id):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    return jsonify(cluster_managers[cluster_id].get_proxmox_ha_resources())  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/proxmox-ha/groups", methods=["GET"])
@require_auth(perms=["ha.view"])
def get_proxmox_ha_groups(cluster_id):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    return jsonify(cluster_managers[cluster_id].get_proxmox_ha_groups())  # snyk:ignore:python/XSS


# Create HA Group
@bp.route("/api/clusters/<cluster_id>/proxmox-ha/groups", methods=["POST"])
@require_auth(perms=["ha.config"])
def create_proxmox_ha_group(cluster_id):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    manager, error = get_connected_manager(cluster_id)
    if error:
        return error  # lgtm[py/reflected-xss]

    data = request.json or {}
    group_name = data.get("group")
    nodes = data.get("nodes")

    if not group_name or not nodes:
        return jsonify({"error": "group and nodes required"}), 400  # snyk:ignore:python/XSS

    try:
        host, port = manager.host, manager.api_port
        # PVE 9.1.x replaced /cluster/ha/groups with /cluster/ha/rules.
        # Try rules-shape POST first (translated from group fields). On 404/501
        # fall back to the legacy groups endpoint for PVE 8.x.
        rules_payload = {
            "rule": group_name,
            "type": "node-affinity",
            "nodes": nodes,
            # /rules requires non-empty resources. Caller can specify them
            # via 'resources' on the request body; otherwise ProxmoxVEx passes
            # whatever the resource picker collected.  If empty PVE will
            # reject with a clear message, which we surface to the user.
            "resources": data.get("resources", "") or "",
        }
        if data.get("restricted"):
            rules_payload["strict"] = 1
        if data.get("comment"):
            rules_payload["comment"] = data["comment"]

        rules_url = f"https://{host}:{port}/api2/json/cluster/ha/rules"
        resp = manager._api_post(rules_url, data=rules_payload)

        if resp.status_code in (404, 501):
            # PVE 8.x — legacy groups path
            legacy_url = f"https://{host}:{port}/api2/json/cluster/ha/groups"
            legacy_payload = {
                "group": group_name,
                "nodes": nodes,
            }
            if data.get("restricted"):
                legacy_payload["restricted"] = 1
            if data.get("nofailback"):
                legacy_payload["nofailback"] = 1
            if data.get("comment"):
                legacy_payload["comment"] = data["comment"]
            resp = manager._api_post(legacy_url, data=legacy_payload)

        if resp.status_code == 200:
            usr = getattr(request, "session", {}).get("user", "system")
            log_audit(usr, "ha.group_created", f"HA group '{group_name}' created", cluster=manager.config.name)
            return jsonify({"success": True})  # snyk:ignore:python/XSS
        else:
            # Pass PVE's own error through — usually informative enough
            # ("no resources were specified", "duplicate rule name", etc.)
            return jsonify({"error": resp.text}), 400  # snyk:ignore:python/XSS
    except Exception as e:
        return jsonify({
            "error": safe_error(e, "Operation failed")
        }), 500  # snyk:ignore:python/ServerInformationExposure


# Delete HA Group
@bp.route("/api/clusters/<cluster_id>/proxmox-ha/groups/<group_name>", methods=["DELETE"])
@require_auth(perms=["ha.config"])
def delete_proxmox_ha_group(cluster_id, group_name):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    manager, error = get_connected_manager(cluster_id)
    if error:
        return error  # lgtm[py/reflected-xss]

    try:
        host, port = manager.host, manager.api_port
        # Same rules-first/groups-fallback as the create path.
        rules_url = f"https://{host}:{port}/api2/json/cluster/ha/rules/{group_name}"
        resp = manager._api_delete(rules_url)
        if resp.status_code in (404, 501) or (
            resp.status_code == 500 and "no such ha rule" in (resp.text or "").lower()
        ):
            legacy_url = f"https://{host}:{port}/api2/json/cluster/ha/groups/{group_name}"
            resp = manager._api_delete(legacy_url)

        if resp.status_code == 200:
            usr = getattr(request, "session", {}).get("user", "system")
            log_audit(usr, "ha.group_deleted", f"HA group '{group_name}' deleted", cluster=manager.config.name)
            return jsonify({"success": True})  # snyk:ignore:python/XSS
        else:
            return jsonify({"error": resp.text}), 400  # snyk:ignore:python/XSS
    except Exception as e:
        return jsonify({
            "error": safe_error(e, "Operation failed")
        }), 500  # snyk:ignore:python/ServerInformationExposure


@bp.route("/api/clusters/<cluster_id>/proxmox-ha/resources", methods=["POST"])
@require_auth(perms=["ha.config"])
def add_to_proxmox_ha(cluster_id):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]
    data = request.json or {}

    logging.debug(f"[HA] Add resource request: {data}")

    # Support both sid format (vm:100) and separate vmid/type
    sid = data.get("sid", "").strip()
    if sid and ":" in sid:
        parts = sid.split(":")
        vm_type = parts[0]  # vm or ct
        vmid = parts[1]
    else:
        vmid = data.get("vmid")
        vm_type = data.get("type", "vm")

    group = data.get("group")
    max_restart = data.get("max_restart", 1)
    max_relocate = data.get("max_relocate", 1)
    state = data.get("state", "started")
    comment = data.get("comment", "")
    # (PVE 9.2) - per-resource auto-rebalance opt-out. None means
    # caller didn't specify, leave PVE defaults alone; True/False = explicit.
    auto_rebalance = data.get("auto_rebalance")
    if auto_rebalance is not None:
        auto_rebalance = bool(auto_rebalance)

    if not vmid:
        logging.warning(f"[HA] Add resource failed: no vmid/sid in request data: {_sl(data)}")
        return jsonify({"error": "vmid or sid required (format: vm:100 or ct:101)"}), 400  # snyk:ignore:python/XSS

    result = mgr.add_vm_to_proxmox_ha(
        vmid, vm_type, group, max_restart, max_relocate, state, comment, auto_rebalance=auto_rebalance
    )

    if result["success"]:
        usr = getattr(request, "session", {}).get("user", "system")
        log_audit(
            usr,
            "ha.vm_added",
            f"{vm_type.upper()} {vmid} added to HA" + (f" (group: {group})" if group else ""),
            cluster=mgr.config.name,
        )
        return jsonify(result)  # snyk:ignore:python/XSS
    else:
        return jsonify(result), 400  # snyk:ignore:python/XSS


@bp.route("/api/clusters/<cluster_id>/proxmox-ha/resources/<vm_type>:<int:vmid>", methods=["DELETE"])
@require_auth(perms=["ha.config"])
def remove_from_proxmox_ha(cluster_id, vm_type, vmid):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]
    result = mgr.remove_vm_from_proxmox_ha(vmid, vm_type)

    if result["success"]:
        usr = getattr(request, "session", {}).get("user", "system")
        log_audit(usr, "ha.vm_removed", f"{vm_type.upper()} {vmid} removed from HA", cluster=mgr.config.name)
        return jsonify(result)  # snyk:ignore:python/XSS
    else:
        return jsonify(result), 400  # snyk:ignore:python/XSS


# Alternative DELETE endpoint that accepts full sid string like "vm:100"
@bp.route("/api/clusters/<cluster_id>/proxmox-ha/resources/<sid>", methods=["DELETE"])
@require_auth(perms=["ha.config"])
def remove_from_proxmox_ha_by_sid(cluster_id, sid):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS

    mgr = cluster_managers[cluster_id]

    # Parse sid (vm:100 or ct:101)
    if ":" in sid:
        vm_type, vmid = sid.split(":", 1)
        try:
            vmid = int(vmid)
        except ValueError:
            # snyk:ignore:Cross-site Scripting (XSS)
            return jsonify({
                "error": f"Invalid VMID in sid: {sid}"
            }), 400  # snyk:ignore:python/ServerInformationExposure
    else:
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({
            "error": f"Invalid sid format: {sid}. Expected vm:VMID or ct:VMID"
        }), 400  # snyk:ignore:python/ServerInformationExposure

    result = mgr.remove_vm_from_proxmox_ha(vmid, vm_type)

    if result["success"]:
        usr = getattr(request, "session", {}).get("user", "system")
        log_audit(usr, "ha.vm_removed", f"{vm_type.upper()} {vmid} removed from HA", cluster=mgr.config.name)
        return jsonify(result)  # snyk:ignore:python/XSS
    else:
        return jsonify(result), 400  # snyk:ignore:python/XSS


# Manual balance trigger
@bp.route("/api/clusters/<cluster_id>/balance-now", methods=["POST"])
@require_auth(perms=["cluster.config"])
def trigger_balance_now(cluster_id):
    ok, err = check_cluster_access(cluster_id)
    if not ok:
        return err

    mgr = cluster_managers.get(cluster_id)
    if not mgr:
        return jsonify({"error": "Cluster not found"}), 404  # snyk:ignore:python/XSS
    if not mgr.is_connected:
        return jsonify({"error": "Cluster not connected"}), 503  # snyk:ignore:python/XSS

    import gevent

    gevent.spawn(mgr.run_balance_check, force=True)

    usr = getattr(request, "session", {}).get("user", "system")
    log_audit(usr, "balance.manual", f"Manual balance check triggered for {mgr.config.name}", cluster=mgr.config.name)

    return jsonify({"message": "Balance check started"})  # snyk:ignore:python/XSS


# 004-perf-cached-cluster-state: cached cluster list endpoint
@bp.route("/api/clusters/cached", methods=["GET"])
@require_auth()
def get_cached_clusters():
    """Return the cluster list from a time-bound cache, falling back to the live list."""
    username = request.session.get("user")
    cache_key = f"list:{username}"
    cached = cluster_state_cache.get(cache_key)
    if cached is not None:
        return jsonify({
            "cached": True,
            "clusters": cached,
            "stats": cluster_state_cache.get_stats(),
        })

    # Cache miss: fetch live list and store. get_clusters() returns a Flask Response.
    resp = get_clusters()
    data = resp.get_json()
    if data is None:
        data = []
    cluster_state_cache.set(cache_key, data)
    return jsonify({
        "cached": False,
        "clusters": data,
        "stats": cluster_state_cache.get_stats(),
    })


@bp.route("/api/clusters/cache/stats", methods=["GET"])
@require_auth()
def get_cluster_cache_stats():
    """Return cluster state cache health metrics."""
    return jsonify(cluster_state_cache.get_stats())


@bp.route("/api/clusters/cache/ttl", methods=["PUT"])
@require_auth(perms=["cluster.config"])
def set_cluster_cache_ttl():
    """Set the global cluster state cache TTL in seconds."""
    data = request.get_json(silent=True) or {}
    ttl = data.get("ttl")
    if ttl is None:
        return jsonify({"error": "ttl is required"}), 400
    try:
        ttl = int(ttl)
    except (TypeError, ValueError):
        return jsonify({"error": "ttl must be an integer"}), 400
    if ttl < 1:
        return jsonify({"error": "ttl must be >= 1"}), 400
    cluster_state_cache.set_ttl(ttl)
    return jsonify({"ttl": ttl})
