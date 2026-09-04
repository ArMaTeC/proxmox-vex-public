# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/api/realtime.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: ProxmoxVEx Realtime API Routes - Layer 6
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
ProxmoxVEx Realtime API Routes - Layer 6
WebSocket, SSE, and email test endpoints.
"""

import concurrent.futures
import contextlib
import gzip
import json
import logging
import queue as queue_module
import threading
import time
import uuid
from datetime import datetime

from flask import Blueprint, Response, jsonify, request
from flask_sock import Sock

from ProxmoxVEx.api.helpers import load_server_settings
from ProxmoxVEx.constants import SSE_TOKEN_TTL
from ProxmoxVEx.globals import (
    cluster_managers,
    sse_clients,
    sse_clients_lock,
    ws_clients,
    ws_clients_lock,
)
from ProxmoxVEx.utils.auth import load_users, require_auth, validate_session
from ProxmoxVEx.utils.email import send_email
from ProxmoxVEx.utils.rbac import get_user_clusters
from ProxmoxVEx.utils.realtime import (
    create_sse_token,
    create_ws_token,
    validate_sse_token,
    validate_ws_token,
)

# 2026-06-04 (CWE-117 log-injection scanner findings): strip CR/LF/U+2028/9
# from anything user-controlled before f-stringing into a logger.
from ProxmoxVEx.utils.sanitization import sanitize_log_message as _sl

bp = Blueprint("realtime", __name__)
sock = Sock()


# Caching for WebSocket feed messages.
class WebSocketFeedCache:
    """Generic in-memory cache for WebSocket feed messages."""

    def __init__(self, default_ttl=30):
        self._data = {}
        self._ttl = {}
        self._lock = threading.Lock()
        self.default_ttl = default_ttl

    def get(self, key, default=None):
        with self._lock:
            if key in self._data and self._ttl[key] >= time.time():
                return self._data[key]
            self._data.pop(key, None)
            self._ttl.pop(key, None)
            return default

    def set(self, key, value, ttl=None):
        if ttl is None:
            ttl = self.default_ttl
        with self._lock:
            self._data[key] = value
            self._ttl[key] = time.time() + ttl

    def get_paginated(self, key, page=1, per_page=50):
        """Return a paginated slice of cached feed items for a key."""
        value = self.get(key, default=[])
        if not isinstance(value, list):
            value = []
        total = len(value)
        start = max(0, (page - 1) * per_page)
        end = start + per_page
        return {
            "items": value[start:end],
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": max(1, (total + per_page - 1) // per_page),
        }

    def get_batched(self, key, batch_size=50):
        """Return the next batch of cached feed items for a key."""
        value = self.get(key, default=[])
        if not isinstance(value, list):
            value = []
        return value[:batch_size]

    def index_by(self, key, field):
        """Build an in-memory index mapping `field` values to items."""
        value = self.get(key, default=[])
        if not isinstance(value, list):
            return {}
        index = {}
        for item in value:
            if isinstance(item, dict) and field in item:
                index.setdefault(item[field], []).append(item)
            elif hasattr(item, field):
                index.setdefault(getattr(item, field), []).append(item)
        return index

    def compress(self, key):
        """Return a gzip-compressed JSON representation of cached items."""
        value = self.get(key, default=[])
        payload = json.dumps(value).encode("utf-8")
        return gzip.compress(payload)

    def shrink(self, key, max_items=100):
        """Trim a cached feed list to a maximum item count."""
        value = self.get(key, default=[])
        if not isinstance(value, list):
            value = []
        if len(value) > max_items:
            value = value[-max_items:]
            self.set(key, value)
        return value

    def append(self, key, item):
        """Append a new item to a cached feed list incrementally."""
        with self._lock:
            value = self._data.get(key, [])
            if not isinstance(value, list):
                value = []
            value.append(item)
            self._data[key] = value
            self._ttl[key] = time.time() + self.default_ttl

    def clear(self):
        with self._lock:
            self._data.clear()
            self._ttl.clear()


ws_feed_cache = WebSocketFeedCache(default_ttl=30)


# Connection pooling for WebSocket clients.
class WebSocketConnectionPool:
    """Reusable connection pool for WebSocket feed clients."""

    def __init__(self, maxsize=20):
        self._maxsize = maxsize
        self._pool = queue_module.Queue(maxsize=maxsize)

    def acquire(self, factory=None):
        """Acquire a connection from the pool or create one if empty."""
        try:
            return self._pool.get_nowait()
        except queue_module.Empty:
            if factory:
                return factory()
            return None

    def release(self, conn):
        """Return a connection to the pool."""
        if conn is None:
            return
        with contextlib.suppress(queue_module.Full):
            self._pool.put_nowait(conn)


ws_connection_pool = WebSocketConnectionPool()


# Lazy loading field selection for WebSocket feed payloads.
_WS_FEED_LAZY_FIELDS = ("metadata", "extra")


def _prune_ws_feed_fields(data, fields=None):
    """Remove lazy/deferred fields from WebSocket feed payload."""
    if fields is None:
        fields = _WS_FEED_LAZY_FIELDS
    if isinstance(data, dict):
        return {k: v for k, v in data.items() if k not in fields}
    if isinstance(data, list):
        return [_prune_ws_feed_fields(item, fields) for item in data if isinstance(item, dict)]
    return data


def paginate_ws_feed(data, page=1, per_page=50):
    """Paginate a WebSocket feed list with stable metadata."""
    if not isinstance(data, list):
        data = []
    total = len(data)
    start = max(0, (page - 1) * per_page)
    end = start + per_page
    return {
        "items": data[start:end],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    }


def batch_ws_feed(data, batch_size=50):
    """Split a WebSocket feed list into fixed-size batches."""
    if not isinstance(data, list):
        data = []
    return [data[i : i + batch_size] for i in range(0, len(data), batch_size)]


def index_ws_feed(data, field):
    """Index a WebSocket feed list by a given field or attribute."""
    if not isinstance(data, list):
        data = []
    index = {}
    for item in data:
        if isinstance(item, dict) and field in item:
            index.setdefault(item[field], []).append(item)
        elif hasattr(item, field):
            index.setdefault(getattr(item, field), []).append(item)
    return index


def compress_ws_feed(data):
    """Compress a WebSocket feed payload with gzip and base64."""
    if not isinstance(data, list):
        data = []
    import base64

    payload = json.dumps(data).encode("utf-8")
    return base64.b64encode(gzip.compress(payload)).decode("ascii")


def decompress_ws_feed(compressed):
    """Decompress a gzip/base64 WebSocket feed payload."""
    import base64

    raw = gzip.decompress(base64.b64decode(compressed))
    return json.loads(raw.decode("utf-8"))


def get_pooled_connection(factory=None):
    """Get a WebSocket connection from the shared pool."""
    return ws_connection_pool.acquire(factory)


class WebSocketAsyncWorker:
    """Background worker pool for async WebSocket feed tasks."""

    def __init__(self, max_workers=4):
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)

    def submit(self, fn, *args, **kwargs):
        """Submit a task to the worker pool."""
        return self._executor.submit(fn, *args, **kwargs)

    def shutdown(self, wait=True):
        """Shut down the worker pool."""
        self._executor.shutdown(wait=wait)


ws_async_worker = WebSocketAsyncWorker()


def run_async_workers(tasks):
    """Run a list of callables concurrently and return their results."""
    if not isinstance(tasks, list):
        tasks = []
    futures = [ws_async_worker.submit(t) for t in tasks if callable(t)]
    return [f.result() for f in futures]


def compact_ws_feed(data, max_items=100):
    """Drop oldest feed items to keep memory usage bounded."""
    if not isinstance(data, list):
        data = []
    if len(data) > max_items:
        return data[-max_items:]
    return data


def diff_ws_feed(old, new, key_field="id"):
    """Return items from `new` that are not in `old` by a key field."""
    if not isinstance(old, list):
        old = []
    if not isinstance(new, list):
        new = []
    old_ids = set()
    for item in old:
        if isinstance(item, dict) and key_field in item:
            old_ids.add(item[key_field])
        elif hasattr(item, key_field):
            old_ids.add(getattr(item, key_field))
    return [
        item
        for item in new
        if (isinstance(item, dict) and key_field in item and item[key_field] not in old_ids)
        or (hasattr(item, key_field) and getattr(item, key_field) not in old_ids)
    ]


@sock.route("/api/ws/updates")
def ws_live_updates(ws):
    """WebSocket endpoint for live updates"""
    client_id = str(uuid.uuid4())
    client_lock = threading.Lock()

    # Authenticate via first message
    try:
        auth_msg = ws.receive(timeout=3)
        auth_data = json.loads(auth_msg)
        session_id = auth_data.get("session_id")

        session = validate_session(session_id)
        if not session:
            ws.send(json.dumps({"type": "error", "message": "Authentication required"}))
            return

        username = session["user"]
        subscribed_clusters = auth_data.get("clusters", None)

        with ws_clients_lock:
            ws_clients[client_id] = {
                "ws": ws,
                "lock": client_lock,
                "user": username,
                "clusters": subscribed_clusters,
                "connected_at": datetime.now().isoformat(),
            }

        logging.info(f"WebSocket client connected: {_sl(username)} ({client_id})")
        ws.send(json.dumps({"type": "connected", "client_id": client_id}))

        # Keep connection alive
        while True:
            try:
                # Wait for incoming messages with timeout
                msg = ws.receive(timeout=30)
                if msg is None:
                    break

                data = json.loads(msg)
                msg_type = data.get("type")

                if msg_type == "ping":
                    with client_lock:
                        ws.send(json.dumps({"type": "pong"}))
                elif msg_type == "pong":
                    pass
                elif msg_type == "subscribe":
                    with ws_clients_lock:
                        if client_id in ws_clients:
                            ws_clients[client_id]["clusters"] = data.get("clusters")

            except Exception as e:
                err_str = str(e).lower()
                if "timed out" in err_str:
                    # Send ping on timeout
                    try:
                        with client_lock:
                            ws.send(json.dumps({"type": "ping"}))
                    except Exception:
                        break
                else:
                    logging.debug(f"WebSocket error for {client_id}: {e}")
                    break

    except Exception as e:
        logging.error(f"WebSocket connection error: {e}")
    finally:
        with ws_clients_lock:
            if client_id in ws_clients:
                del ws_clients[client_id]
        logging.info(f"WebSocket client disconnected: {client_id}")


@bp.route("/api/sse/token", methods=["POST"])
@require_auth()
def get_sse_token():
    """Get SSE token for URL param auth"""
    user = request.session.get("user", "unknown")
    users = load_users()
    user_data = users.get(user, {})
    allowed_clusters = get_user_clusters(user_data)

    token = create_sse_token(user, allowed_clusters)

    return jsonify({
        "token": token,
        "expires_in": SSE_TOKEN_TTL,
        "hint": "Use this token in /api/sse/updates?token=...",
    })


# WebSocket auth tokens (single-use, 60s TTL)
# VNC/SSH WebSocket servers call /api/ws/token/validate instead of trusting session in URL
@bp.route("/api/ws/token", methods=["POST"])
@require_auth()
def get_ws_token():
    """Get a single-use WebSocket auth token - avoids session_id in URLs"""
    user = request.session.get("user", "unknown")
    role = request.session.get("role", "viewer")
    token = create_ws_token(user, role)
    return jsonify({"token": token, "expires_in": 60})


@bp.route("/api/ws/token/validate")
def validate_ws_token_api():
    """Validate a WS token - called by standalone VNC/SSH servers
    Internal endpoint, consumes the token (single-use)

    (CodeAnt CWE-285) - if the caller passes ?cluster_id=<id>, also
    verify the token's user has access to that cluster. Closes the cross-cluster
    BOLA case where someone with cluster-A access could open a WS for cluster-B
    and trust the token alone to gate it. cluster_id is OPTIONAL for back-compat
    (the VNC paths in vms.py / VM-level shells call without it today).
    """
    token = request.args.get("token")
    if not token:
        return jsonify({"error": "Token required"}), 401

    data = validate_ws_token(token)
    if not data:
        return jsonify({"error": "Invalid or expired token"}), 401

    requested_cluster = (request.args.get("cluster_id") or "").strip()
    cluster_context = None
    if requested_cluster:
        try:
            from ProxmoxVEx.utils.auth import load_users
            from ProxmoxVEx.utils.rbac import get_user_clusters, load_vm_acls

            users = load_users()
            user = users.get(data["user"], {})
            allowed = get_user_clusters(user)
            access_ok = allowed is None or requested_cluster in allowed
            if not access_ok:
                # VM-ACL fallback (mirrors api/helpers.py check_cluster_access)
                cluster_acls = load_vm_acls().get(requested_cluster, {}) or {}
                for _vmid, acl in cluster_acls.items():
                    if data["user"] in (acl.get("users") or []) or "*" in (acl.get("users") or []):
                        access_ok = True
                        break
            if not access_ok:
                # #555: pool fallback — a pool grant in this cluster lets the WS token open
                # (cluster-level reach only; the proxy + user_can_access_vm gate the VM)
                try:
                    from ProxmoxVEx.core.db import get_db

                    # sec-review: ignore empty {pool: []} grants (truthy dict, no perm)
                    _pp = get_db().get_user_pool_permissions(requested_cluster, data["user"], user.get("groups", []))
                    if any(p for p in _pp.values()):
                        access_ok = True
                except Exception:
                    pass
            if not access_ok:
                logging.warning(
                    f"[WS-TOKEN] user '{_sl(data['user'])}' has no access to cluster '{_sl(requested_cluster)}'"
                )
                return jsonify({"error": "Access denied to this cluster"}), 403

            # Lightweight cluster context for the SSH/VNC proxy.
            # We intentionally do NOT call mgr._get_node_ip() here: that has a
            # network-probing first-call path (up to ~15s) which would hang the
            # validate endpoint when this same Flask process is busy. The proxy
            # gets the cluster's primary host + any fallback_hosts already known
            # from the DB. Multi-node clusters where the frontend prefetched a
            # per-node IP that isn't in this set will need to re-resolve through
            # the normal cluster-creds endpoint with a session cookie.
            try:
                from ProxmoxVEx.globals import cluster_managers

                mgr = cluster_managers.get(requested_cluster)
                if mgr is not None:
                    cluster_host = getattr(mgr, "host", None)
                    cfg = getattr(mgr, "config", None)
                    node_ips = {}
                    # Include fallback_hosts from the DB — those were discovered by
                    # the manager at connect time and persist across restarts. Cheap.
                    fb = getattr(cfg, "fallback_hosts", None) or []
                    for i, host in enumerate(fb):
                        if host:
                            node_ips[f"_fallback_{i}"] = host
                    cluster_context = {
                        "host": cluster_host,
                        "node_ips": node_ips,
                        "ssh_port": getattr(cfg, "ssh_port", 22) or 22,
                    }
                    # 2026-06-05 (C-1): hand the PVE session cookie to the WS
                    # subprocess server-side (it used to come from the browser).
                    # Mint fresh; None for token-only clusters. termproxy is the
                    # only consumer — VNC/SSH ignore it.
                    try:
                        _tk = mgr.mint_console_auth_ticket()
                        if _tk:
                            cluster_context["pve_auth_ticket"] = _tk
                    except Exception:
                        pass
            except Exception as e:
                logging.debug(f"[WS-TOKEN] cluster-context build soft-fail: {e}")
        except Exception as e:
            logging.error(f"[WS-TOKEN] cluster-access check failed: {e}")
            # fail closed
            return jsonify({"error": "Authorization check failed"}), 500

    resp = {"valid": True, "user": data["user"], "role": data["role"]}
    if cluster_context is not None:
        resp["cluster_context"] = cluster_context
    return jsonify(resp)


@bp.route("/api/sse/updates")
def sse_updates():
    """SSE endpoint for live updates

    Accepts ?token= (preferred) or ?session= (legacy)
    Token is better because session IDs in URLs can leak to logs
    """
    # token auth first (preferred)
    sse_token = request.args.get("token")

    user = None
    allowed_clusters = None
    auth_method = None

    if sse_token:
        # Validate SSE token
        token_data = validate_sse_token(sse_token)
        if token_data:
            user = token_data["user"]
            allowed_clusters = token_data["allowed_clusters"]
            auth_method = "token"

    # Removed session_id fallback, token-only auth for SSE
    if not user:
        return jsonify({"error": "Authentication required. Provide a valid SSE token."}), 401

    client_id = str(uuid.uuid4())
    message_queue = queue_module.Queue(maxsize=100)

    # Get cluster subscription from query params
    clusters_param = request.args.get("clusters")
    requested_clusters = clusters_param.split(",") if clusters_param else None

    # Only let users subscribe to clusters they have access to
    if requested_clusters:
        if allowed_clusters is None:
            # admin - all clusters allowed
            subscribed_clusters = requested_clusters
        else:
            # filter to allowed only
            subscribed_clusters = [c for c in requested_clusters if c in allowed_clusters]
            if not subscribed_clusters:
                logging.warning(f"[SSE] User {user} tried to subscribe to unauthorized clusters")
                subscribed_clusters = allowed_clusters
    else:
        subscribed_clusters = allowed_clusters

    with sse_clients_lock:
        sse_clients[client_id] = {
            "queue": message_queue,
            "user": user,
            "clusters": subscribed_clusters,
            "connected_at": datetime.now().isoformat(),
            "auth_method": auth_method,
        }

    logging.info(f"[SSE] Client connected: {client_id} (user: {user}, auth: {auth_method}) - Total: {len(sse_clients)}")

    def generate():
        try:
            # Send initial connected message
            yield f"data: {json.dumps({'type': 'connected', 'client_id': client_id})}\n\n"

            while True:
                try:
                    # Wait for message with timeout
                    message = message_queue.get(timeout=30)
                    yield f"data: {message}\n\n"
                except queue_module.Empty:
                    # Send keepalive
                    yield ": keepalive\n\n"
        except GeneratorExit:
            pass
        finally:
            with sse_clients_lock:
                if client_id in sse_clients:
                    del sse_clients[client_id]
            logging.info(f"[SSE] Client disconnected: {client_id} - Remaining clients: {len(sse_clients)}")

    response = Response(generate(), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    # Do NOT set Connection: keep-alive.  Keep-alive is the default over
    # HTTP/1.1, and the Connection header is an invalid hop-by-hop field on
    # HTTP/2 paths.  Some browsers/proxies (Cloudflare, nginx http2) reject
    # the SSE stream with ERR_HTTP2_PROTOCOL_ERROR if this leaks through.
    return response


@bp.route("/api/sse/subscribe", methods=["POST"])
@require_auth()
def update_sse_subscription():
    """Update cluster subscription for an active SSE client without reconnecting.
    Avoids 200-500ms data gap on sidebar toggle
    """
    data = request.json or {}
    client_id = data.get("client_id")
    requested = data.get("clusters")  # list of cluster IDs or None for all

    if not client_id:
        return jsonify({"error": "client_id required"}), 400

    username = request.session.get("user", "unknown")

    # RBAC: what clusters is this user allowed to see?
    users = load_users()
    user_data = users.get(username, {})
    allowed = get_user_clusters(user_data)  # None = admin

    # filter requested against allowed
    if requested and len(requested) > 0:
        if allowed is not None:
            filtered = [c for c in requested if c in allowed]
            new_sub = filtered if filtered else allowed
        else:
            new_sub = requested  # admin sees all
    else:
        new_sub = allowed  # None = everything user can see

    with sse_clients_lock:
        client = sse_clients.get(client_id)
        if not client:
            # Return 200 not 404 - client may have reconnected with a new ID
            # (token refresh cycle), frontend treats subscribe as best-effort anyway
            return jsonify({"ok": False, "reason": "client_not_found"})
        if client.get("user") != username:
            return jsonify({"error": "Unauthorized"}), 403
        old_sub = client.get("clusters")
        client["clusters"] = new_sub

    # R2 (regression fix): the IP/disk refresh loop is gated on watched-clusters
    # and only re-runs ~every 40s, so a freshly-selected cluster would show stale
    # guest IPs/disk for that window. Kick a one-shot refresh for clusters that
    # just became watched (explicit→explicit transition only; all-access already
    # refreshes everything).
    if old_sub is not None and new_sub is not None:
        newly = set(new_sub) - set(old_sub)
        for cid in newly:
            mgr = cluster_managers.get(cid)
            if mgr and getattr(mgr, "is_connected", False) and hasattr(mgr, "refresh_ip_cache"):
                try:
                    import gevent

                    gevent.spawn(mgr.refresh_ip_cache)
                except Exception:
                    pass

    logging.debug(f"[SSE] Subscription updated for {client_id}: {new_sub}")
    return jsonify({"ok": True, "clusters": new_sub})


@bp.route("/api/settings/smtp/test", methods=["POST"])
@require_auth(perms=["admin.settings"])
def test_smtp():
    """Send a test email to verify SMTP settings

    Uses the same send_email function for consistency
    """
    data = request.json or {}
    test_email = data.get("email", "")

    logging.info(f"[SMTP Test] Received data: {list(data.keys())}")

    if not test_email:
        return jsonify({"error": "Email address required"}), 400

    # Load saved settings first (we might need the real password)
    saved_settings = load_server_settings()

    # Build SMTP settings from request or use saved
    smtp_host = data.get("smtp_host", "")

    if smtp_host:
        # Use provided settings for testing (before save)
        # But if password is masked (********), use the saved password
        provided_password = data.get("smtp_password", "")
        if provided_password == "********" or not provided_password:
            # Use saved password - Feb 2026: now encrypted in database, must decrypt
            raw_password = saved_settings.get("smtp_password", "")
            try:
                from ProxmoxVEx.core.db import get_db

                real_password = get_db()._decrypt(raw_password) if raw_password else ""
            except Exception:
                real_password = raw_password  # Fallback for unencrypted legacy values
            logging.info("[SMTP Test] Using saved password (frontend sent masked value)")
        else:
            real_password = provided_password

        smtp_settings = {
            "smtp_host": smtp_host,
            "smtp_port": data.get("smtp_port", 587),
            "smtp_user": data.get("smtp_user", ""),
            "smtp_password": real_password,
            "smtp_from_email": data.get("smtp_from_email", ""),
            "smtp_from_name": data.get("smtp_from_name", "ProxmoxVEx"),
            "smtp_tls": data.get("smtp_tls", True),
            "smtp_ssl": data.get("smtp_ssl", False),
        }

        if not smtp_settings["smtp_from_email"]:
            return jsonify({"error": "From email address is required"}), 400

        logging.info(
            f"[SMTP Test] Using settings: host={smtp_host}, user={smtp_settings['smtp_user']}, has_password={bool(real_password)}"
        )
    else:
        # Use saved settings
        smtp_settings = None  # send_email will load from database
        if not saved_settings.get("smtp_enabled"):
            return jsonify({"error": "SMTP not enabled"}), 400

    # Send test email using the same function as alerts
    success, error = send_email(
        to_addresses=[test_email],
        subject="ProxmoxVEx Test Email",
        body="This is a test email from ProxmoxVEx to verify your SMTP settings are working correctly.",
        html_body='<h2>ProxmoxVEx Test Email</h2><p>This is a test email to verify your SMTP settings.</p><p style="color: green;">Your SMTP configuration is working!</p>',
        smtp_settings=smtp_settings,
    )

    if success:
        return jsonify({"success": True, "message": f"Test email sent to {test_email}"})
    else:
        return jsonify({"error": error or "Failed to send test email"}), 400
