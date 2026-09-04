# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/api/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: ProxmoxVEx API Blueprint Registration
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
ProxmoxVEx API Blueprint Registration
"""

import contextlib
import gzip
import json as _json
import logging
import time

from flask import jsonify, request

from ProxmoxVEx.utils.auth import validate_api_token, validate_session

# In-memory cache for API call responses.
_API_CALL_CACHE = {}
_API_CALL_CACHE_TTL = 30


def _api_cache_key(path, query=None):
    """Build a cache key from the request path and optional query."""
    return f"{path}:{hash(str(query))}"


def _get_cached_api_response(path, query=None):
    """Return a cached API response if it has not expired."""
    key = _api_cache_key(path, query)
    entry = _API_CALL_CACHE.get(key)
    if entry is None or time.time() - entry["ts"] > _API_CALL_CACHE_TTL:
        return None
    return entry["data"]


def _cache_api_response(path, query=None, data=None):
    """Store an API response in the in-memory cache."""
    _API_CALL_CACHE[_api_cache_key(path, query)] = {"ts": time.time(), "data": data}


# Lazy loading: fields that are expensive to compute and can be deferred for API calls.
_LAZY_API_FIELDS = {
    "detail",
    "history",
    "extended",
}


def _prune_lazy_api_fields(payload):
    """Remove lazy/deferred fields from an API payload to reduce initial response size."""
    if not isinstance(payload, dict):
        return payload
    return {k: v for k, v in payload.items() if k not in _LAZY_API_FIELDS}


def _paginate_api_data(data, page=1, limit=0):
    """Apply optional pagination to API response data."""
    if not data or limit <= 0:
        return data
    page = max(1, page)
    start = (page - 1) * limit
    end = start + limit
    return data[start:end]


def _batch_api_calls(items, batch_size=10):
    """Split a list of API calls/items into fixed-size batches."""
    if not items or batch_size <= 0:
        return [items] if items else []
    return [items[i : i + batch_size] for i in range(0, len(items), batch_size)]


def _index_api_results(items, key=None):
    """Build a lookup index for API call results keyed by the provided field."""
    if not items or not key:
        return {}
    index = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        k = item.get(key)
        if k is not None:
            index.setdefault(k, []).append(item)
    return index


def _compress_api_response(payload, accept_encoding=""):
    """Compress an API payload with gzip when accepted by the client."""
    if not accept_encoding or "gzip" not in accept_encoding.lower():
        return payload, None
    try:
        raw = _json.dumps(payload).encode("utf-8") if not isinstance(payload, bytes) else payload
        return gzip.compress(raw), "gzip"
    except (TypeError, ValueError):
        return payload, None


# Connection pool for API calls to reduce connection setup overhead.
_API_CONNECTION_POOL = {}


def _get_api_connection(conn_id):
    """Return a cached connection for the given API call target."""
    return _API_CONNECTION_POOL.get(conn_id)


# Async worker registry for API call background tasks.
_ASYNC_API_WORKERS = set()


def _start_async_api_worker(worker_id):
    """Register a new async worker for API call background tasks."""
    _ASYNC_API_WORKERS.add(worker_id)
    return worker_id


# Memory-optimised API response field whitelist.
_API_RESPONSE_ESSENTIAL_FIELDS = (
    "id",
    "name",
    "status",
    "type",
    "ctime",
    "vm_name",
)


def _memory_optimise_api_payload(payload):
    """Drop heavy unused fields from an API payload to reduce memory."""
    if not isinstance(payload, list):
        return payload
    return [
        {k: v for k, v in item.items() if k in _API_RESPONSE_ESSENTIAL_FIELDS}
        for item in payload
        if isinstance(item, dict)
    ]


def _incremental_api_updates(items, since=None, timestamp_key="mtime"):
    """Filter API call results to only include items updated since a given timestamp."""
    if not since:
        return items
    return [item for item in items if isinstance(item, dict) and item.get(timestamp_key, 0) > since]


def register_blueprints(app):
    """Register all API blueprints with the Flask app."""
    from ProxmoxVEx.api.alerts import bp as alerts_bp
    from ProxmoxVEx.api.audit_search import bp as audit_search_bp
    from ProxmoxVEx.api.auth import bp as auth_bp
    from ProxmoxVEx.api.ceph import bp as ceph_bp
    from ProxmoxVEx.api.clusters import bp as clusters_bp
    from ProxmoxVEx.api.converter import bp as converter_bp
    from ProxmoxVEx.api.costs import bp as costs_bp
    from ProxmoxVEx.api.datacenter import bp as datacenter_bp
    from ProxmoxVEx.api.disaster_recovery import bp as disaster_recovery_bp
    from ProxmoxVEx.api.drift import bp as drift_bp
    from ProxmoxVEx.api.drift import start_scanner as start_drift_scanner
    from ProxmoxVEx.api.groups import bp as groups_bp
    from ProxmoxVEx.api.history import bp as history_bp
    from ProxmoxVEx.api.ids import bp as ids_bp
    from ProxmoxVEx.api.insights import bp as insights_bp
    from ProxmoxVEx.api.licence import bp as licence_bp
    from ProxmoxVEx.api.metrics_exporter import bp as metrics_exporter_bp
    from ProxmoxVEx.api.nodes import bp as nodes_bp
    from ProxmoxVEx.api.pbs import bp as pbs_bp
    from ProxmoxVEx.api.plugins import bp as plugins_bp
    from ProxmoxVEx.api.power import bp as power_bp
    from ProxmoxVEx.api.push import bp as push_bp
    from ProxmoxVEx.api.push import register_alert_handler
    from ProxmoxVEx.api.realtime import bp as realtime_bp
    from ProxmoxVEx.api.reports import bp as reports_bp
    from ProxmoxVEx.api.schedules import bp as schedules_bp
    from ProxmoxVEx.api.search import bp as search_bp
    from ProxmoxVEx.api.server_access import bp as server_access_bp
    from ProxmoxVEx.api.settings import bp as settings_bp
    from ProxmoxVEx.api.siem import bp as siem_bp
    from ProxmoxVEx.api.siem import start_worker as start_siem_worker
    from ProxmoxVEx.api.site_recovery import bp as site_recovery_bp
    from ProxmoxVEx.api.snapshots import bp as snapshots_bp
    from ProxmoxVEx.api.snapshots import start_scheduler as start_snap_scheduler
    from ProxmoxVEx.api.static_files import bp as static_files_bp
    from ProxmoxVEx.api.storage import bp as storage_bp
    from ProxmoxVEx.api.templates_lib import bp as templates_lib_bp
    from ProxmoxVEx.api.topology import bp as topology_bp
    from ProxmoxVEx.api.users import bp as users_bp
    from ProxmoxVEx.api.vms import bp as vms_bp
    from ProxmoxVEx.api.vmware import bp as vmware_bp
    from ProxmoxVEx.api.webauthn import bp as webauthn_bp
    from ProxmoxVEx.integrations.active_directory import bp as active_directory_bp
    from ProxmoxVEx.integrations.docker import bp as docker_bp
    from ProxmoxVEx.integrations.git import bp as git_bp
    from ProxmoxVEx.integrations.grafana import bp as grafana_bp
    from ProxmoxVEx.integrations.kubernetes import bp as kubernetes_bp
    from ProxmoxVEx.integrations.ldap import bp as ldap_integration_bp
    from ProxmoxVEx.integrations.packer import bp as packer_bp
    from ProxmoxVEx.integrations.pbs import bp as pbs_integration_bp
    from ProxmoxVEx.integrations.phpipam import bp as phpipam_bp
    from ProxmoxVEx.integrations.prometheus import bp as prometheus_bp
    from ProxmoxVEx.integrations.s3 import bp as s3_bp
    from ProxmoxVEx.integrations.terraform import bp as terraform_bp
    from ProxmoxVEx.integrations.vault import bp as vault_bp
    from ProxmoxVEx.integrations.vmware import bp as vmware_integration_bp
    from ProxmoxVEx.integrations.webhooks import bp as webhooks_bp
    from ProxmoxVEx.native.registry import bp as native_bp

    _blueprints = [
        ("auth", auth_bp),
        ("users", users_bp),
        ("converter", converter_bp),
        ("clusters", clusters_bp),
        ("vms", vms_bp),
        ("nodes", nodes_bp),
        ("pbs", pbs_bp),
        ("storage", storage_bp),
        ("datacenter", datacenter_bp),
        ("vmware", vmware_bp),
        ("schedules", schedules_bp),
        ("reports", reports_bp),
        ("settings", settings_bp),
        ("alerts", alerts_bp),
        ("realtime", realtime_bp),
        ("search", search_bp),
        ("server_access", server_access_bp),
        ("static_files", static_files_bp),
        ("history", history_bp),
        ("ids", ids_bp),
        ("groups", groups_bp),
        ("ceph", ceph_bp),
        ("site_recovery", site_recovery_bp),
        # disaster-recovery routes live under /api/site-recovery/plans/<plan_id>/...
        # and must be registered before the native catch-all /api/<module_id>/<path:subpath>
        # to avoid being shadowed by the native proxy.
        ("disaster_recovery", disaster_recovery_bp),
        ("plugins", plugins_bp),
        ("native", native_bp),
        ("webauthn", webauthn_bp),
        ("metrics_exporter", metrics_exporter_bp),
        ("insights", insights_bp),
        ("licence", licence_bp),
        ("templates_lib", templates_lib_bp),
        ("push", push_bp),
        ("costs", costs_bp),
        ("drift", drift_bp),
        ("audit_search", audit_search_bp),
        ("siem", siem_bp),
        ("snapshots", snapshots_bp),
        ("topology", topology_bp),
        ("terraform", terraform_bp),
        ("vmware_integration", vmware_integration_bp),
        ("active_directory", active_directory_bp),
        ("kubernetes", kubernetes_bp),
        ("packer", packer_bp),
        ("prometheus", prometheus_bp),
        ("phpipam", phpipam_bp),
        ("pbs_integration", pbs_integration_bp),
        ("grafana", grafana_bp),
        ("ldap", ldap_integration_bp),
        ("s3", s3_bp),
        ("docker", docker_bp),
        ("git", git_bp),
        ("power", power_bp),
        ("vault", vault_bp),
        ("webhooks", webhooks_bp),
    ]

    _public_blueprints = {
        "auth",
        "static_files",
        "realtime",
        "webauthn",
        "push",
        "metrics_exporter",
    }

    def _require_auth_for_request():
        """Blueprint before_request guard: require a valid session or API token."""
        # Non-API routes (/, /static, /favicon.ico, /app.bundle.js, etc.) are public SPA assets.
        if not request.path.startswith("/api/"):
            return None
        auth_header = request.headers.get("Authorization", "")
        session = None
        if auth_header.startswith("Bearer pgx_"):
            session = validate_api_token(auth_header[7:])
        if not session:
            session_id = request.headers.get("X-Session-ID") or request.cookies.get("session_id")
            session = validate_session(session_id)
        if not session:
            return jsonify({"error": "Unauthorized", "code": "AUTH_REQUIRED"}), 401
        request.session = session

    for name, bp in _blueprints:
        if name not in _public_blueprints and not getattr(bp, "_ProxmoxVEx_auth_guard", False):
            bp._ProxmoxVEx_auth_guard = True
            bp.before_request(_require_auth_for_request)
        # Pass an explicit registration name so blueprints whose internal name
        # clashes with a core API blueprint (e.g. vmware vs vmware_integration)
        # can still be mounted without a Flask "name already registered" error.
        app.register_blueprint(bp, name=name)

    # Initialize WebSocket support for realtime blueprint
    from ProxmoxVEx.api.realtime import sock

    sock.init_app(app)

    # Wire push handler into the alerts pipeline
    with contextlib.suppress(Exception):
        register_alert_handler()

    # Drift scanner thread (6h cadence; harmless if mgrs not yet up)
    try:
        start_drift_scanner()
    except Exception as e:
        logging.warning(f"drift scanner start failed: {e}")

    # SIEM forwarder worker
    try:
        start_siem_worker()
    except Exception as e:
        logging.warning(f"siem worker start failed: {e}")

    # Snapshot scheduler (60s tick, idempotent)
    try:
        start_snap_scheduler()
    except Exception as e:
        logging.warning(f"snapshot scheduler start failed: {e}")

    # Native built-in integrations (Docker, NetApp, OPNsense, TrueNAS)
    try:
        from ProxmoxVEx.native import register_native

        register_native(app)
    except Exception as e:
        logging.warning(f"native integrations registration failed: {e}")
