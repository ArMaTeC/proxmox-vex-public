# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/audit-search-enhanced/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Enhanced Audit Search - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Enhanced Audit Search - full UI management backend.
Full-text, date-range, and user-filtered search over the tamper-evident audit log.
"""

import contextlib
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Response, g, jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access
from ProxmoxVEx.api.plugin_data_bridge import get_clusters
from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.core.db import get_db
from ProxmoxVEx.utils.audit import log_audit

PLUGIN_ID = "audit-search-enhanced"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "state.json"

# Load plugin version from manifest.json so the status endpoint stays in sync.
MANIFEST_FILE = PLUGIN_DIR / "manifest.json"
PLUGIN_VERSION = "1.0.0"
try:
    with open(MANIFEST_FILE, encoding="utf-8") as _mf:
        _manifest = json.load(_mf)
        PLUGIN_VERSION = _manifest.get("version", PLUGIN_VERSION)
except (OSError, json.JSONDecodeError) as _e:
    log.warning("Failed to load plugin manifest: %s", _e)

# Configurable window (in days) for the user dropdown; results are cached briefly.
USER_WINDOW_DAYS = 30
USER_CACHE_TTL_SECONDS = 60
_users_cache = {"ts": 0.0, "users": []}

# Brief cache for the raw cluster list to avoid repeated lookups.
CLUSTERS_CACHE_TTL_SECONDS = 60
_clusters_cache = {"ts": 0.0, "clusters": []}

# Simple per-client in-memory rate limiting for search/export endpoints.
RATE_LIMIT_MAX = 30
RATE_LIMIT_WINDOW = 60
_rate_limit = {}


def _load_state():
    if not STATE_FILE.exists():
        return {}
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return {}


def _save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except OSError as e:
        log.error("Failed to save state: %s", e)


def _new_id():
    return uuid.uuid4().hex[:12]


def _current_username():
    user = getattr(g, "current_user", {}) or {}
    return user.get("username") or user.get("email") or "unknown"


def _has_admin_audit():
    user = getattr(g, "current_user", {}) or {}
    perms = user.get("permissions", [])
    if isinstance(perms, str):
        try:
            perms = json.loads(perms)
        except (json.JSONDecodeError, TypeError):
            perms = []
    return user.get("role") == "admin" or "admin.audit" in perms


def _rate_limit_key():
    # Prefer IP, but fall back to username so tests/loopback don't all share one bucket.
    return request.remote_addr or _current_username() or "unknown"


def _check_rate_limit():
    now = time.time()
    key = _rate_limit_key()
    timestamps = [t for t in _rate_limit.get(key, []) if now - t < RATE_LIMIT_WINDOW]
    if len(timestamps) >= RATE_LIMIT_MAX:
        return False
    timestamps.append(now)
    _rate_limit[key] = timestamps
    return True


def _safe_log_audit(action: str, details: str, cluster: str | None = None):
    with contextlib.suppress(Exception):
        log_audit(_current_username(), action, details, request.remote_addr, cluster)


def _parse_dt(s):
    """Parse an ISO timestamp string and normalize it to UTC.

    Returns None for empty or unparseable inputs. Used by the in-memory
    search fallback in `_post_search()` and `_matches()` until the
    backend moves to SQL date-range filtering.
    """
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    # Normalize naive and aware datetimes to UTC so date-range comparisons don't mix tzinfo.
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _get_clusters():
    """List clusters the current user is allowed to access."""
    global _clusters_cache
    now = time.time()
    try:
        if now - _clusters_cache["ts"] > CLUSTERS_CACHE_TTL_SECONDS:
            _clusters_cache = {"ts": now, "clusters": get_clusters().get("clusters", [])}
        clusters = _clusters_cache["clusters"]
        accessible = []
        for cluster in clusters:
            cluster_id = cluster.get("id")
            if not cluster_id:
                continue
            allowed, _ = check_cluster_access(cluster_id)
            if not allowed:
                continue
            accessible.append({
                "id": cluster_id,
                "display_name": cluster.get("name", cluster_id),
                "connected": cluster.get("connected", False),
            })
        return {"data": accessible}
    except Exception as e:
        log.warning("clusters failed: %s", e)
    return {"data": _clusters_cache.get("clusters", [])}


def _get_users():
    """Return distinct audit-log users seen within the configured window.

    Results are cached for USER_CACHE_TTL_SECONDS to avoid repeated facet
    queries while the dropdown is being populated.
    """
    global _users_cache
    now = time.time()
    if now - _users_cache["ts"] < USER_CACHE_TTL_SECONDS:
        return {"users": _users_cache["users"]}
    try:
        facets = get_db().audit_facets(days=USER_WINDOW_DAYS)
        users = [u["user"] for u in facets.get("users", []) if u.get("user")]
        users = sorted(users)
        _users_cache = {"ts": now, "users": users}
        return {"users": users}
    except Exception as e:
        log.warning("users failed: %s", e)
    return {"users": _users_cache.get("users", [])}


def _get_status():
    total = 0
    try:
        _, total = get_db().search_audit_log(limit=1)
    except Exception as e:
        log.warning("status failed: %s", e)
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "version": PLUGIN_VERSION,
        "total": total,
    }


def _matches(entry, filters):
    """Check whether an in-memory audit entry satisfies the supplied filters.

    This helper is used by the `_post_search()` fallback while the plugin
    is backed by `state.json`. It is kept intentionally pure so it can be
    replaced by SQL predicates once the search moves to the database.
    """
    cluster = filters.get("cluster_id")
    if cluster and entry.get("cluster_id") != cluster:
        return False
    user = filters.get("user", "").lower()
    if user and entry.get("user", "").lower() != user:
        return False
    severity = filters.get("severity", "").lower()
    if severity and entry.get("severity", "").lower() != severity:
        return False
    action = filters.get("action", "").lower()
    if action and action not in (entry.get("action", "") or "").lower():
        return False
    ip = filters.get("ip", "").lower()
    if ip and ip not in (entry.get("ip_address") or entry.get("ip") or "").lower():
        return False
    text = filters.get("text", "").lower()
    if text and text not in str(entry).lower():
        return False
    start = _parse_dt(filters.get("start"))
    end = _parse_dt(filters.get("end"))
    ts = _parse_dt(entry.get("timestamp") or entry.get("created_at"))
    if start and end and end < start:
        raise ValueError("end date must not be before start date")
    if start and ts and ts < start:
        return False
    return not (end and ts and ts > end)


def _post_search():
    if not _check_rate_limit():
        return jsonify({"error": "rate limit exceeded"}), 429
    body = request.get_json(silent=True) or {}
    cluster_id = body.get("cluster_id", "").strip()
    if cluster_id:
        allowed, err = check_cluster_access(cluster_id)
        if not allowed:
            return err
    start = (body.get("start") or "").strip()
    end = (body.get("end") or "").strip()
    start_dt = _parse_dt(start)
    end_dt = _parse_dt(end)
    if start_dt and end_dt and end_dt < start_dt:
        return jsonify({"error": "end date must not be before start date"}), 400
    try:
        rows, total = get_db().search_audit_log(
            q=(body.get("text") or "").strip(),
            user=(body.get("user") or "").strip(),
            action=(body.get("action") or "").strip(),
            cluster=cluster_id,
            severity=(body.get("severity") or "").strip(),
            ip=(body.get("ip") or "").strip(),
            date_from=start,
            date_to=end,
            offset=max(0, body.get("offset", 0)),
            limit=min(1000, max(1, body.get("limit", 100))),
        )
    except Exception as e:
        log.warning("search failed: %s", e)
        return jsonify({"error": "failed to search audit log"}), 500
    sort_col = body.get("sort", "timestamp")
    order = body.get("order", "desc")
    for r in rows:
        if "cluster" in r and "cluster_id" not in r:
            r["cluster_id"] = r.pop("cluster") or ""
    if sort_col not in ("timestamp", "created_at"):
        rows.sort(key=lambda x: str(x.get(sort_col, "")).lower(), reverse=order == "desc")
    filters = {
        "cluster_id": cluster_id,
        "start": start,
        "end": end,
        "user": body.get("user", "").lower(),
        "text": body.get("text", "").lower(),
        "severity": body.get("severity", "").lower(),
        "action": body.get("action", "").lower(),
        "ip": body.get("ip", "").lower(),
    }
    _safe_log_audit(
        "audit.search",
        f"search filters: {json.dumps(filters)}",
        cluster_id or None,
    )
    return {"count": total, "filters": filters, "results": rows}


def _get_export():
    """Export audit-log entries.

    Returns JSON by default; pass `?format=csv` for CSV. Exports above 10,000
    rows require the client to confirm (`?confirm=1`); when confirmed a cap of
    100,000 rows is still applied to protect the server. `id` is included for
    traceability; `hmac_signature` is intentionally excluded to avoid leaking
    audit integrity keys.
    """
    if not _check_rate_limit():
        return jsonify({"error": "rate limit exceeded"}), 429
    if not _has_admin_audit():
        return jsonify({"error": "admin.audit permission required"}), 403
    EXPORT_LIMIT = 10000
    MAX_EXPORT_LIMIT = 100000
    fmt = (request.args.get("format") or "json").lower()
    try:
        preview_rows, total = get_db().search_audit_log(limit=1)
    except Exception as e:
        log.warning("export failed: %s", e)
        return jsonify({"error": "failed to export audit log"}), 500
    if total > EXPORT_LIMIT and request.args.get("confirm") != "1":
        return jsonify({"confirm_required": True, "total": total}), 409
    limit = MAX_EXPORT_LIMIT if request.args.get("confirm") == "1" else EXPORT_LIMIT
    try:
        rows, total = get_db().search_audit_log(limit=limit)
    except Exception as e:
        log.warning("export failed: %s", e)
        return jsonify({"error": "failed to export audit log"}), 500
    entries = [
        {
            "id": r.get("id"),
            "timestamp": r.get("timestamp"),
            "user": r.get("user"),
            "action": r.get("action"),
            "details": r.get("details"),
            "ip_address": r.get("ip_address"),
            "cluster": r.get("cluster") or "",
            "severity": r.get("severity") or "info",
        }
        for r in rows
    ]
    _safe_log_audit(
        "audit.export",
        f"exported {len(entries)} entries (capped={total > limit})",
    )
    if fmt == "csv":
        import csv
        import io

        output = io.StringIO()
        writer = csv.DictWriter(
            output,
            fieldnames=[
                "id",
                "timestamp",
                "user",
                "action",
                "details",
                "ip_address",
                "cluster",
                "severity",
            ],
        )
        writer.writeheader()
        for e in entries:
            writer.writerow(e)
        return Response(
            output.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=audit-export.csv"},
        )
    return {"audit_entries": entries, "total": total, "capped": total > limit}


def _get_aggregations():
    """Compute aggregation counts directly in the database with GROUP BY."""
    try:
        cursor = get_db().conn.cursor()
        cursor.execute('SELECT user, COUNT(*) AS n FROM audit_log WHERE user IS NOT NULL AND user != "" GROUP BY user')
        by_user = {r["user"]: r["n"] for r in cursor.fetchall()}
        cursor.execute("SELECT severity, COUNT(*) AS n FROM audit_log GROUP BY severity")
        by_severity = {r["severity"]: r["n"] for r in cursor.fetchall()}
        cursor.execute("SELECT COUNT(*) AS n FROM audit_log")
        total = cursor.fetchone()["n"]
        return {"by_user": by_user, "by_severity": by_severity, "total": total}
    except Exception as e:
        log.warning("aggregations failed: %s", e)
    return {"by_user": {}, "by_severity": {}, "total": 0}


def _ensure_saved_searches_table():
    """Create the per-user saved-searches table if it doesn't exist."""
    try:
        cursor = get_db().conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_search_saved (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
                filters TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_search_saved_user ON audit_search_saved(username)")
        get_db().conn.commit()
    except Exception as e:
        log.warning("failed to ensure saved searches table: %s", e)


def _validate_saved_search_filters(filters):
    """Validate the filter keys/values before persisting a saved search."""
    allowed_keys = {
        "cluster_id",
        "start",
        "end",
        "user",
        "text",
        "severity",
        "action",
        "sort",
        "order",
        "offset",
        "limit",
    }
    allowed_severities = {"", "info", "warning", "error"}
    if not isinstance(filters, dict):
        raise ValueError("filters must be an object")
    for key, value in filters.items():
        if key not in allowed_keys:
            raise ValueError(f"invalid filter key: {key}")
        if key == "severity" and str(value).lower() not in allowed_severities:
            raise ValueError(f"invalid severity value: {value}")
        if key in ("offset", "limit") and not isinstance(value, int):
            raise ValueError(f"{key} must be an integer")
    return filters


def _row_to_saved(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "filters": json.loads(row["filters"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _saved_searches():
    _ensure_saved_searches_table()
    username = _current_username()
    cursor = get_db().conn.cursor()
    if request.method == "GET":
        cursor.execute(
            "SELECT * FROM audit_search_saved WHERE username = ? ORDER BY name",
            (username,),
        )
        return {"saved": [_row_to_saved(r) for r in cursor.fetchall()]}
    if request.method in ("POST", "DELETE", "PUT") and not _has_admin_audit():
        return jsonify({"error": "admin.audit permission required"}), 403
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        if not name:
            return jsonify({"error": "name is required"}), 400
        try:
            filters = _validate_saved_search_filters(body.get("filters", {}))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        now = datetime.now(timezone.utc).isoformat()
        search_id = _new_id()
        cursor.execute(
            """
            INSERT INTO audit_search_saved (id, username, name, filters, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """,
            (search_id, username, name, json.dumps(filters), now, now),
        )
        get_db().conn.commit()
        _safe_log_audit("audit.saved_search.create", f"saved search '{name}'")
        return {"saved": {"id": search_id, "name": name, "filters": filters, "created_at": now, "updated_at": now}}
    if request.method == "PUT":
        body = request.get_json(silent=True) or {}
        search_id = (body.get("id") or "").strip()
        name = (body.get("name") or "").strip()
        if not search_id:
            return jsonify({"error": "id is required"}), 400
        if not name:
            return jsonify({"error": "name is required"}), 400
        try:
            filters = _validate_saved_search_filters(body.get("filters", {}))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        now = datetime.now(timezone.utc).isoformat()
        cursor.execute(
            """
            UPDATE audit_search_saved
            SET name = ?, filters = ?, updated_at = ?
            WHERE id = ? AND username = ?
        """,
            (name, json.dumps(filters), now, search_id, username),
        )
        get_db().conn.commit()
        if cursor.rowcount == 0:
            return jsonify({"error": "saved search not found"}), 404
        _safe_log_audit("audit.saved_search.update", f"saved search '{name}'")
        return {"saved": {"id": search_id, "name": name, "filters": filters, "updated_at": now}}
    if request.method == "DELETE":
        sid = (request.get_json(silent=True) or {}).get("id") or request.args.get("id")
        cursor.execute(
            "DELETE FROM audit_search_saved WHERE id = ? AND username = ?",
            (sid, username),
        )
        get_db().conn.commit()
        _safe_log_audit("audit.saved_search.delete", f"deleted saved search {sid}")
        return {"deleted": sid}
    return jsonify({"error": "Method not allowed"}), 405


def _get_ui():
    """Serve the Enhanced Audit Search HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "users", _get_users)
    register_plugin_route(PLUGIN_ID, "search", _post_search)
    register_plugin_route(PLUGIN_ID, "export", _get_export)
    register_plugin_route(PLUGIN_ID, "aggregations", _get_aggregations)
    register_plugin_route(PLUGIN_ID, "saved", _saved_searches)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
