# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/api/helpers.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: shared helpers for all api routes - split from monolith...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""shared helpers for all api routes - split from monolith dec 2025,"""

import html
import json
import logging
import os
import time
from datetime import datetime

from ProxmoxVEx.constants import (
    LOGIN_ATTEMPT_WINDOW,
    LOGIN_LOCKOUT_TIME,
    LOGIN_MAX_ATTEMPTS,
    SESSION_TIMEOUT,
)
from ProxmoxVEx.core.db import get_db
from ProxmoxVEx.globals import (
    task_ProxmoxVEx_users_cache,
    task_ProxmoxVEx_users_lock,
)


def effective_reverse_proxy(settings=None):
    """#614 — the frontend builds console (VNC/SSH) WebSocket URLs from
    reverse_proxy_enabled. PROXMOXVEX_BEHIND_PROXY forces behind-proxy mode at boot
    (app.py) but is never persisted, so report the OR of the persisted setting and
    the env override — otherwise `PROXMOXVEX_BEHIND_PROXY=true` alone leaves consoles
    dialing port+1/+2, which the reverse proxy can't route."""
    if settings is None:
        settings = load_server_settings()
    return bool(settings.get("reverse_proxy_enabled", False)) or os.environ.get(
        "PROXMOXVEX_BEHIND_PROXY", ""
    ).lower() in ("1", "true", "yes")


def load_server_settings():
    """Load server settings from SQLite database

    SQLite migration
    """
    defaults = {
        "domain": "",
        "port": 5000,  # Web server port
        "ssl_enabled": False,
        # ACME / Let's Encrypt auto-certs
        "acme_enabled": False,
        "acme_email": "",
        "acme_staging": False,  # use LE staging for testing
        "acme_challenge_type": "http-01",
        "acme_dns_provider": "manual",
        "acme_dns_rfc2136_nameserver": "",
        "acme_dns_rfc2136_port": 53,
        "acme_dns_rfc2136_zone": "",
        "acme_dns_rfc2136_key_name": "",
        "acme_dns_rfc2136_secret": "",
        "acme_dns_rfc2136_algorithm": "hmac-sha512",
        "acme_dns_rfc2136_ttl": 60,
        "acme_dns_propagation_seconds": 30,
        "logo_url": "",
        "app_name": "ProxmoxVEx",
        # HTTP redirect port
        # Now that we have protocol detection on the main port, this is only needed
        # if you want HTTP:80 → HTTPS:5000 redirect
        # 0 = auto (80 if root, disabled otherwise), -1 = disabled, or specific port
        "http_redirect_port": -1,  # Disabled by default - protocol detection handles same-port redirect
        # Brute force protection settings
        "login_max_attempts": 5,
        "login_lockout_time": 300,  # 5 min
        "login_attempt_window": 600,  # 10 min
        # Password policy settings
        "password_min_length": 8,
        "password_require_uppercase": True,
        "password_require_lowercase": True,
        "password_require_numbers": True,
        "password_require_special": False,  # too annoying for most users
        # Password expiry
        "password_expiry_enabled": False,  # disabled by default
        "password_expiry_days": 90,  # days until password expires
        "password_expiry_warning_days": 14,  # warn this many days before
        "password_expiry_email_enabled": True,  # send email notifications
        "password_expiry_include_admins": False,  # Opt-in for admins, otherwise they could lock themselves out
        # Session settings
        "session_timeout": SESSION_TIMEOUT,  # Use constant (8h HIPAA default)
        # SMTP Settings
        "smtp_enabled": False,
        "smtp_host": "",
        "smtp_port": 587,
        "smtp_user": "",
        "smtp_password": "",  # stored encrypted ideally
        "smtp_from_email": "",
        "smtp_from_name": "ProxmoxVEx Alerts",
        "smtp_tls": True,
        "smtp_ssl": False,
        # Alert notification settings
        "alert_email_recipients": [],  # list of email addresses
        "alert_cooldown": 300,  # Don't send same alert within 5 min
        # (#331) - email notification when a new ProxmoxVEx release appears.
        # Opt-in; re-uses alert_email_recipients. Dedupes via last-notified-version.
        "alert_update_available": False,
        "alert_last_notified_version": "",
        # 2026-04-24 - when true, validate_session() invalidates a session if the
        # source IP changes. Default off because mobile roaming / carrier NAT
        # legitimately shifts IPs mid-session.
        "strict_session_ip": False,
        # When true, /api/metrics needs no auth. Useful for setups
        # where a reverse proxy/mutual-TLS already gates scrapes. Default off.
        "metrics_public": False,
        # When enabled, the Syslog viewer only shows hostnames belonging to
        # the currently selected cluster instead of all collected syslog rows.
        "syslog_filter_by_selected_cluster": False,
        # 2026-06-05 (audit N1): gate the syslog RECEIVER (UDP+TCP :1514).
        # Default True preserves the always-on behaviour; set False to close the
        # port on installs that don't ingest syslog. (DoS-safe either way now
        # ingestion is bounded-queue + batched off-hub.)
        "syslog_enabled": True,
        # 2026-06-05 (S1): retention for the syslog receiver database (syslog.database). The
        # receiver only INSERTs, so without a sweep it grows unbounded on the same
        # volume as the main DB. Pruned ~hourly by the drain loop.
        "syslog_retention_days": 30,
        # Webhook alert channels (Slack, Discord, Teams, ntfy, generic)
        # Each: {id, name, type, url, enabled, ...type-specific fields}
        "alert_webhooks": [],
        # IP Whitelisting
        "ip_whitelist_enabled": False,
        "ip_whitelist": "",  # Comma-separated IPs/CIDRs
        "ip_blacklist": "",  # Comma-separated IPs/CIDRs (always blocked)
        # LDAP defaults (must be here so get_ldap_settings always has values!)
        # Without these, a partial save (e.g. only ldap_enabled=True) causes "LDAP not configured"
        "ldap_enabled": False,
        "ldap_server": "",
        "ldap_port": 389,
        "ldap_use_ssl": False,
        "ldap_use_starttls": False,
        "ldap_bind_dn": "",
        "ldap_bind_password": "",
        "ldap_base_dn": "",
        "ldap_user_filter": "(&(objectClass=person)(sAMAccountName={username}))",
        "ldap_username_attribute": "sAMAccountName",
        "ldap_email_attribute": "mail",
        "ldap_display_name_attribute": "displayName",
        "ldap_group_base_dn": "",
        "ldap_group_filter": "(&(objectClass=group)(member={user_dn}))",
        "ldap_admin_group": "",
        "ldap_user_group": "",
        "ldap_viewer_group": "",
        "ldap_default_role": "viewer",
        "ldap_auto_create_users": True,
        "ldap_group_mappings": [],
        # Reverse proxy support (nginx/haproxy)
        "reverse_proxy_enabled": False,
        "trusted_proxies": "",  # comma-separated IPs/CIDRs, empty = loopback only
        "proxy_bind_address": "",  # custom bind addr when behind proxy on different host
        # OIDC defaults
        "oidc_enabled": False,
        "oidc_provider": "entra",
        "oidc_cloud_environment": "commercial",  # Commercial, gcc, gcc_high, dod
        "oidc_client_id": "",
        "oidc_client_secret": "",
        "oidc_tenant_id": "",
        "oidc_authority": "",
        "oidc_scopes": "openid profile email",
        "oidc_redirect_uri": "",
        "oidc_admin_group_id": "",
        "oidc_user_group_id": "",
        "oidc_viewer_group_id": "",
        "oidc_default_role": "viewer",
        "oidc_auto_create_users": True,
        "oidc_button_text": "Sign in with Microsoft",
        "oidc_group_mappings": [],
        "oidc_skip_jwt_verification": False,  # Disable JWT sig check for broken JWKS envs
        "oidc_skip_ssl_verify": False,  # (#188): self-signed-cert escape hatch
        # (#412 SeeJayEmm): SSRF guard's default behaviour rejects
        # any discovery URL that resolves to a private/loopback IP. Internal IdPs
        # (Keycloak/Authentik/Authentik-on-LAN at 10.x or 192.168.x) are the
        # exact use case that breaks. Opt-in knob to relax the guard for the
        # OIDC discovery path SPECIFICALLY — metadata IPs (169.254.169.254
        # etc.) are still rejected, and the guard remains on for all other
        # outbound paths (webhook, SAML metadata fetch, plugin upstream).
        "oidc_allow_private_ip": False,
        # (PVE 9.2 parity) - extra audiences (comma-separated)
        # accepted on the JWT verify alongside the client_id.
        "oidc_audiences": "",
    }

    try:
        db = get_db()
        saved = db.get_server_settings()
        if saved:
            # Merge with defaults (so new fields are always present)
            return {**defaults, **saved}
    except Exception as e:
        logging.error(f"Error loading server settings from database: {e}")
        # Plain-JSON SERVER_SETTINGS_FILE fallback removed (encrypted database only).

    return defaults


def decrypt_secret_setting(value, *, label="secret"):
    """Decrypt an encrypted server setting, preserving legacy plaintext values."""
    if not value or value == "********":
        return ""
    try:
        return get_db()._decrypt(str(value))
    except RuntimeError as e:
        logging.error(f"Failed to decrypt {label}: {e}")
        return ""
    except Exception as e:
        if str(value).startswith(("aes256:", "gAAAA")):
            logging.error(f"Could not decrypt encrypted {label}: {e}")
            return ""
        logging.warning(f"Could not decrypt {label}; treating as legacy plaintext: {e}")
        return str(value)


def acme_dns_config_from_settings(settings):
    """Build an RFC 2136 DNS config, decrypting the TSIG secret only for use."""
    settings = settings or {}
    return {
        "nameserver": settings.get("acme_dns_rfc2136_nameserver", ""),
        "port": settings.get("acme_dns_rfc2136_port", 53),
        "zone": settings.get("acme_dns_rfc2136_zone", ""),
        "key_name": settings.get("acme_dns_rfc2136_key_name", ""),
        "secret": decrypt_secret_setting(settings.get("acme_dns_rfc2136_secret", ""), label="ACME RFC 2136 secret"),
        "algorithm": settings.get("acme_dns_rfc2136_algorithm", "hmac-sha512"),
        "ttl": settings.get("acme_dns_rfc2136_ttl", 60),
        "propagation_seconds": settings.get("acme_dns_propagation_seconds", 30),
    }


def save_server_settings(settings):
    """Save server settings to SQLite database

    SQLite migration
    """
    try:
        db = get_db()
        db.save_server_settings(settings)
        return True
    except Exception as e:
        logging.error(f"Error saving server settings: {e}")
        return False


def get_session_timeout():
    # get timeout from settings
    try:
        settings = load_server_settings()
        return settings.get("session_timeout", SESSION_TIMEOUT)
    except Exception:
        return SESSION_TIMEOUT  # fallback


def _fmt_size(size_bytes):
    # Simple bytes formatter, nothing fancy
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024**2:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024**3:
        return f"{size_bytes / 1024**2:.1f} MB"
    else:
        return f"{size_bytes / 1024**3:.1f} GB"


def get_login_settings():
    # Pulled these out to be configurable via settings
    try:
        settings = load_server_settings()
    except Exception:
        settings = {}
    return {
        "max_attempts": settings.get("login_max_attempts", LOGIN_MAX_ATTEMPTS),
        "lockout_time": settings.get("login_lockout_time", LOGIN_LOCKOUT_TIME),
        "attempt_window": settings.get("login_attempt_window", LOGIN_ATTEMPT_WINDOW),
    }


def register_task_user(upid: str, username: str, cluster_id: str = None):
    """Register which ProxmoxVEx user initiated a task - persists to database"""
    if not upid or not username:
        return

    # Update in-memory cache
    with task_ProxmoxVEx_users_lock:
        task_ProxmoxVEx_users_cache[upid] = {"user": username, "timestamp": time.time()}
        # S2 (regression scan): this dict was never evicted (TASK_USER_CACHE_TTL was
        # dead) → slow unbounded RSS creep over weeks. Bound it: when over the cap,
        # drop the oldest ~10% by timestamp. The DB row remains the source of truth
        # (get_task_user falls back to the DB on a cache miss).
        if len(task_ProxmoxVEx_users_cache) > 50000:
            try:
                _old = sorted(task_ProxmoxVEx_users_cache.items(), key=lambda kv: kv[1].get("timestamp", 0))[:5000]
                for _k, _ in _old:
                    task_ProxmoxVEx_users_cache.pop(_k, None)
            except Exception:
                task_ProxmoxVEx_users_cache.clear()

    # Persist to database
    try:
        db = get_db()
        cursor = db.conn.cursor()
        cursor.execute(
            """
            INSERT OR REPLACE INTO task_users (upid, username, cluster_id, created_at)
            VALUES (?, ?, ?, ?)
        """,
            (upid, username, cluster_id, datetime.now().isoformat()),
        )
        db.conn.commit()
    except Exception as e:
        logging.debug(f"Failed to persist task user to DB: {e}")


def get_task_user(upid: str) -> str | None:
    """Get ProxmoxVEx user who initiated a task - checks cache first, then database"""
    if not upid:
        return None

    # Check in-memory cache first (fast path)
    with task_ProxmoxVEx_users_lock:
        data = task_ProxmoxVEx_users_cache.get(upid)
        if data:
            return data.get("user")

    # Check database (slow path, but persists across restarts)
    try:
        db = get_db()
        cursor = db.conn.cursor()
        cursor.execute("SELECT username FROM task_users WHERE upid = ?", (upid,))
        row = cursor.fetchone()
        if row:
            username = row[0]
            # Update cache for future lookups
            with task_ProxmoxVEx_users_lock:
                task_ProxmoxVEx_users_cache[upid] = {"user": username, "timestamp": time.time()}
            return username
    except Exception as e:
        logging.debug(f"Failed to get task user from DB: {e}")

    return None


def get_connected_manager(cluster_id):
    """Get a cluster manager, return (manager, None) if connected, (None, error_response) if not"""
    import ProxmoxVEx.globals as g

    if cluster_id not in g.cluster_managers:
        return None, ({"error": "Cluster not found"}, 404)
    manager = g.cluster_managers[cluster_id]
    if not manager.is_connected:
        conn_err = html.escape(manager.connection_error or "") if manager.connection_error else ""
        return None, (
            {"error": "Cluster not connected", "offline": True, "connection_error": conn_err},
            503,
        )
    return manager, None


def check_cluster_access(cluster_id):
    """Check if current user can access a cluster based on tenant or VM ACLs.
    Returns (True, None) if allowed, (False, error_response) if not.
    """
    from flask import g, has_app_context, jsonify, request

    from ProxmoxVEx.utils.rbac import get_user_clusters

    if not has_app_context():
        return True, None

    # H2 (scale audit): reuse the acting user require_auth already fetched (g.current_user),
    # else fetch just that one user — don't re-scan the whole users table per cluster route.
    user = getattr(g, "current_user", None)
    if user is None:
        try:
            user = get_db().get_user(request.session["user"]) or {}
        except Exception:
            from ProxmoxVEx.utils.auth import load_users

            user = load_users().get(request.session["user"], {})
    allowed = get_user_clusters(user)
    if allowed is not None and cluster_id not in allowed:
        # #248: check VM ACLs as fallback — users with VM-level access can reach the cluster
        username = request.session.get("user", "")
        from ProxmoxVEx.utils.rbac import load_vm_acls

        cluster_acls = load_vm_acls().get(cluster_id, {})
        for _vmid, acl in cluster_acls.items():
            if username in acl.get("users", []) or "*" in acl.get("users", []):
                return True, None
        # #555: pool fallback — any pool grant in THIS cluster lets the user reach it
        # (per-VM gating still runs downstream via user_can_access_vm)
        try:
            groups = user.get("groups", []) if isinstance(user, dict) else []
            # sec-review: a {pool: []} row is truthy as a dict but grants nothing — match
            # the rest of the pool model (user_has_any_pool_access) and require a real perm.
            _pp = get_db().get_user_pool_permissions(cluster_id, username, groups)
            if any(p for p in _pp.values()):
                return True, None
        except Exception:
            pass
        return False, (jsonify({"error": "Access denied to this cluster"}), 403)
    return True, None


def check_pbs_access(pbs_id):
    """Check if current user can access a PBS server based on its linked clusters.
    Returns (True, None) if allowed, (False, error_response) if not.

    A PBS server is accessible if:
    - User is admin (full access), OR
    - PBS has no linked_clusters (backward compatibility - accessible to all), OR
    - User has access to at least one of the PBS's linked clusters
    """
    from flask import has_app_context, jsonify, request

    from ProxmoxVEx.globals import pbs_managers
    from ProxmoxVEx.models.permissions import ROLE_ADMIN
    from ProxmoxVEx.utils.auth import load_users
    from ProxmoxVEx.utils.rbac import get_user_clusters

    if not has_app_context():
        return True, None

    # Check if PBS exists
    if pbs_id not in pbs_managers:
        return False, (jsonify({"error": "PBS server not found"}), 404)

    pbs_mgr = pbs_managers[pbs_id]
    users = load_users()
    user = users.get(request.session["user"], {})

    # Admins have full access
    if user.get("role") == ROLE_ADMIN:
        return True, None

    # Server access group gate.
    from ProxmoxVEx.utils.rbac import user_can_access_server

    if not user_can_access_server(user, "pbs", pbs_id, "view"):
        return False, (jsonify({"error": "Access denied to this PBS server"}), 403)

    # Get PBS linked clusters
    pbs_linked = pbs_mgr.linked_clusters or []

    # If PBS has no linked clusters, allow access (backward compatibility)
    if not pbs_linked:
        return True, None

    # Get user's allowed clusters
    user_clusters = get_user_clusters(user)

    # If user has access to all clusters (None), allow
    if user_clusters is None:
        return True, None

    # Check if user has access to at least one linked cluster
    for cluster_id in pbs_linked:
        if cluster_id in user_clusters:
            return True, None

    return False, (jsonify({"error": "Access denied to this PBS server"}), 403)


def check_vmware_access(vmware_id):
    """tenant gate for a VMware/ESXi server, mirroring
    check_pbs_access. Most vmware.py routes only had a role perm and never scoped to tenant, so
    any vmware.* holder could read/act on ANOTHER tenant's ESXi. A server is accessible if the
    caller is a global admin, the server has no linked_clusters (backward-compat), the caller is
    all-cluster (get_user_clusters None), or the caller reaches one of the server's linked clusters.
    Returns (True, None) or (False, error_response)."""
    from flask import jsonify, request

    from ProxmoxVEx.globals import vmware_managers
    from ProxmoxVEx.models.permissions import ROLE_ADMIN
    from ProxmoxVEx.utils.auth import load_users
    from ProxmoxVEx.utils.rbac import get_user_clusters

    if vmware_id not in vmware_managers:
        return False, (jsonify({"error": "VMware server not found"}), 404)
    user = load_users().get(request.session.get("user", ""), {})
    if user.get("role") == ROLE_ADMIN:
        return True, None

    # Server access group gate.
    from ProxmoxVEx.utils.rbac import user_can_access_server

    if not user_can_access_server(user, "vmware", vmware_id, "view"):
        return False, (jsonify({"error": "Access denied to this VMware server"}), 403)

    linked = getattr(vmware_managers[vmware_id], "linked_clusters", None) or []
    if not linked:
        return True, None  # backward-compat: unlinked server is accessible to all
    uc = get_user_clusters(user)
    if uc is None:
        return True, None
    if any(c in uc for c in linked):
        return True, None
    return False, (jsonify({"error": "Access denied to this VMware server"}), 403)


def server_access_guard(server_type: str, server_id_arg: str = "cluster_id", write_level: str = "admin"):
    """Return a Flask before_request function that enforces server access levels.

    GET/HEAD endpoints require at least 'view'. All other methods require
    `write_level` (default 'admin' for cluster-level admin routes). Denied
    requests are logged to the server access audit log.
    """
    from ProxmoxVEx.models import server_access

    def _guard():
        from flask import g, has_app_context, jsonify, request

        from ProxmoxVEx.models.permissions import ROLE_ADMIN
        from ProxmoxVEx.utils.auth import load_users
        from ProxmoxVEx.utils.rbac import user_can_access_server

        if not has_app_context():
            return None

        server_id = (request.view_args or {}).get(server_id_arg)
        if not server_id:
            return None

        user = getattr(g, "current_user", None)
        if user is None:
            try:
                username = request.session.get("user", "")
                user = load_users().get(username, {}) if username else {}
            except Exception:
                user = {}

        if not user or user.get("role") == ROLE_ADMIN:
            return None

        level = "view" if request.method in ("GET", "HEAD") else write_level
        if not user_can_access_server(user, server_type, server_id, level):
            try:
                username = request.session.get("user", "")
            except Exception:
                username = ""
            server_access.log_server_access_event(
                actor=username,
                action="access_denied",
                target_type=server_type,
                target_id=server_id,
                details={"required_level": level, "method": request.method},
            )
            return jsonify({"error": "Access denied to this server"}), 403

    return _guard


def safe_error(e, default_msg="An internal error occurred"):
    """Return a safe error message for API responses.
    Logs full exception but returns generic message to client.
    Prevents leaking internal paths, stack traces, and DB details.
    """
    logging.error(f"[API] {default_msg}: {e}", exc_info=True)
    return default_msg


def parse_pve_error(response_text, fallback="Proxmox API error"):
    """Extract user-friendly error from Proxmox API response.
    PVE returns JSON like {"data":null,"message":"some error\\n"} or plain text.

    Defense-in-depth: HTML-escape the extracted message before
    returning. Reflecting raw upstream response text into our JSON error
    field gets flagged by Snyk Code as reflected-XSS-via-JSON even though
    Flask's jsonify sets Content-Type: application/json (which prevents
    browser execution). Escaping makes the trace clean and gives us a
    safety net if a future code path returns this string as text/html.
    """
    import html

    if not response_text:
        return fallback
    try:
        import json

        # PVE often has literal newlines in JSON strings — strip them
        cleaned = response_text.replace("\n", " ").replace("\r", "")
        data = json.loads(cleaned)
        msg = data.get("message") or data.get("errors") or data.get("error")
        if isinstance(msg, dict):
            msg = "; ".join(f"{k}: {v}" for k, v in msg.items())
        if msg:
            return html.escape(str(msg).strip()[:500])
    except (json.JSONDecodeError, ValueError, AttributeError):
        pass
    # plain text — truncate and clean
    text = response_text.strip()[:200]
    if "<html" in text.lower():
        return fallback
    return html.escape(text) if text else fallback


# 2026-06-04 - shared metrics_history loader for insights/cost/power.
# The expensive part of these three endpoints isn't the SQL fetch, it's
# json.loads()'ing every snapshot blob (8.6k rows over 30d). Tier-1 moved the
# fetch off the gevent hub; this moves the PARSE off too AND caches the parsed
# result. The parse runs inside run_heavy_read's transform (worker thread), so
# even the cold-cache caller doesn't block the hub, and concurrent callers for
# the same window coalesce onto one fetch+parse (single-flight). Returns a list
# of (ts_unix, clusters_dict) for ALL clusters; callers filter for their own id.
def _history_stride(days):
    # Snapshots land ~every 5 min. Parsing thousands of them is the GIL-bound
    # ceiling (json.loads holds the GIL even in a worker thread), so for long
    # windows we decimate to a coarser cadence. All three consumers are
    # ratio/average/percentile based — sample COUNT doesn't change the result,
    # only the resolution — so this is lossless for cost/power numbers and only
    # smooths insights trends. Recent (<=2d) views keep full 5-min detail.
    if days <= 2:
        return 1  # 5-min, full resolution
    if days <= 14:
        return 3  # ~15-min
    return 12  # ~hourly for month+ windows


def load_metrics_window(days):
    from datetime import timedelta

    from ProxmoxVEx.core.dbcrypto import run_heavy_read

    cutoff = (datetime.now() - timedelta(days=days)).isoformat()
    stride = _history_stride(days)

    def _parse(rows):
        out = []
        for row in rows:
            try:
                d = json.loads(row["data"])
                ts_unix = int(datetime.fromisoformat(row["timestamp"]).timestamp())
                out.append((ts_unix, d.get("clusters") or {}))
            except Exception:
                continue
        return out

    # Pick ~every Nth snapshot (1 = 5-min, 3 = ~15-min, 12 = ~hourly). Use
    # `id = (id / stride) * stride` instead of `id % stride = 0` because the
    # literal `%` is a psycopg2 percent-escape metacharacter and the translator
    # turns `?` placeholders into `%s`, which collides with `%%` handling.
    if stride > 1:
        sql = "SELECT timestamp, data FROM metrics_history WHERE timestamp >= ? AND id = (id / ?) * ? ORDER BY timestamp ASC"
        sql_params = (cutoff, stride, stride)
    else:
        sql = "SELECT timestamp, data FROM metrics_history WHERE timestamp >= ? ORDER BY timestamp ASC"
        sql_params = (cutoff,)

    # cache_key shared across every cluster + across insights/cost/power.
    # NOTE: the returned dicts are the cached parsed structure — callers must
    # treat them as read-only (the aggregation paths only read, never mutate).
    return run_heavy_read(sql, sql_params, cache_key=f"mh_parsed:{days}", transform=_parse)
