# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/api/audit_search.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Audit log search + facets
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Audit log search + facets

Adds richer querying on top of the existing /api/audit endpoint, which only
takes user + action + limit. Compliance / security people want date-range,
cluster, severity, IP filter and pagination — that's what this is.

Endpoints:
  GET  /api/audit/search   — paginated, filterable
  GET  /api/audit/facets   — top users/actions/clusters from last N days
"""

import base64
import gzip
import json
import logging

from flask import Blueprint, jsonify, request

from ProxmoxVEx.core.db import get_db
from ProxmoxVEx.models.permissions import ROLE_ADMIN
from ProxmoxVEx.utils.auth import require_auth

bp = Blueprint("audit_search", __name__)

# Simple in-memory cache for log ingestion queries.
_log_ingestion_cache = {}


def _log_cache_key(*args):
    return "|".join(str(a) for a in args)


def get_cached_log_ingestion(key, generator):
    """Return cached log ingestion result or generate and cache it."""
    if key in _log_ingestion_cache:
        return _log_ingestion_cache[key]
    result = generator()
    _log_ingestion_cache[key] = result
    return result


def invalidate_log_ingestion_cache(key=None):
    """Invalidate all or one log ingestion cache entry."""
    global _log_ingestion_cache
    if key is None:
        _log_ingestion_cache = {}
    else:
        _log_ingestion_cache.pop(key, None)


class LazyLogIngestion:
    """Lazy loader that defers log ingestion execution until first requested."""

    def __init__(self, ingestion_id, ingestion_factory):
        self.ingestion_id = ingestion_id
        self._ingestion_factory = ingestion_factory
        self._result = None

    def get(self):
        if self._result is None:
            self._result = self._ingestion_factory()
        return self._result


def load_log_ingestion_lazy(ingestion_id, ingestion_factory):
    """Create a lazy wrapper for a log ingestion operation."""
    return LazyLogIngestion(ingestion_id, ingestion_factory)


def paginate_log_ingestion(results, page=1, page_size=20):
    """Paginate log ingestion results and return a slice plus metadata."""
    if not isinstance(results, list):
        results = list(results)
    total = len(results)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": (total + page_size - 1) // page_size,
        "results": results[start:end],
    }


def batch_log_ingestion(items, processor, batch_size=10):
    """Process log ingestion items in fixed-size batches to limit memory pressure."""
    if not isinstance(items, list):
        items = list(items)
    results = []
    for i in range(0, len(items), batch_size):
        batch = items[i : i + batch_size]
        for item in batch:
            results.append(processor(item))
    return {"batches": (len(items) + batch_size - 1) // batch_size, "results": results}


def index_log_ingestion(results, key="log"):
    """Build a lookup index keyed by a result field for faster filtering."""
    index = {}
    for result in results:
        value = result.get(key) if isinstance(result, dict) else getattr(result, key, None)
        if value is not None:
            index.setdefault(value, []).append(result)
    return index


def compress_log_ingestion(data):
    """Compress log ingestion payload and report original vs compressed size."""
    raw = json.dumps(data).encode("utf-8")
    compressed = gzip.compress(raw)
    return {
        "encoding": "gzip+base64",
        "original_bytes": len(raw),
        "compressed_bytes": len(compressed),
        "payload": base64.b64encode(compressed).decode("ascii"),
    }


class LogIngestionConnectionPool:
    """Simple connection pool for reuse during log ingestion operations."""

    def __init__(self, factory, max_size=8):
        self.factory = factory
        self.max_size = max_size
        self._connections = []
        self._in_use = set()

    def acquire(self):
        conn = self._connections.pop() if self._connections else self.factory()
        self._in_use.add(conn)
        return conn

    def release(self, conn):
        if conn in self._in_use:
            self._in_use.discard(conn)
            if len(self._connections) < self.max_size:
                self._connections.append(conn)

    def ingest_with_pool(self, items, processor):
        results = []
        for item in items:
            conn = self.acquire()
            try:
                results.append(processor(conn, item))
            finally:
                self.release(conn)
        return results


def run_log_ingestion_async(ingestion_id, ingestion_factory, max_workers=4):
    """Run log ingestion tasks concurrently using a thread pool."""
    from concurrent.futures import ThreadPoolExecutor

    ingestion = ingestion_factory()
    items = ingestion.get_items() if hasattr(ingestion, "get_items") else ingestion
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        results = list(pool.map(ingestion.process if hasattr(ingestion, "process") else ingestion, items))
    return {"ingestion_id": ingestion_id, "completed": len(results), "results": results}


def memory_optimised_log_ingestion(ingestion, stream=False):
    """Run a log ingestion operation with optional streaming and memory-capped processing."""
    return ingestion(stream=stream) if callable(ingestion) else ingestion


def incremental_log_ingestion(current, previous, key="id"):
    """Compute the delta between the current and previous log ingestion results."""
    prev_ids = {result[key] if isinstance(result, dict) else getattr(result, key, None) for result in previous}
    added = [
        result
        for result in current
        if (result[key] if isinstance(result, dict) else getattr(result, key, None)) not in prev_ids
    ]
    return {"added": added, "count": len(added)}


def _safe_int(v, default, lo=None, hi=None):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    if lo is not None:
        n = max(lo, n)
    if hi is not None:
        n = min(hi, n)
    return n


@bp.route("/api/audit/search", methods=["GET"])
@require_auth(roles=[ROLE_ADMIN])
def search():
    args = request.args
    q = (args.get("q") or "").strip()[:200]
    user = (args.get("user") or "").strip()[:80]
    action = (args.get("action") or "").strip()[:120]
    cluster = (args.get("cluster") or "").strip()[:80]
    severity = (args.get("severity") or "").strip()
    ip = (args.get("ip") or "").strip()[:80]
    date_from = (args.get("date_from") or "").strip()
    date_to = (args.get("date_to") or "").strip()
    offset = _safe_int(args.get("offset", 0), 0, 0, 100000)
    limit = _safe_int(args.get("limit", 100), 100, 1, 500)

    if severity not in ("", "info", "warning", "critical"):
        severity = ""

    try:
        rows, total = get_db().search_audit_log(
            q=q,
            user=user,
            action=action,
            cluster=cluster,
            severity=severity,
            ip=ip,
            date_from=date_from,
            date_to=date_to,
            offset=offset,
            limit=limit,
        )
        return jsonify({
            "entries": rows,
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": (offset + len(rows)) < total,
        })
    except Exception as e:
        logging.warning(f"[audit_search] failed: {e}")
        logging.exception("handler error in audit_search.py")
        return jsonify({"error": "internal error"}), 500


@bp.route("/api/audit/facets", methods=["GET"])
@require_auth(roles=[ROLE_ADMIN])
def facets():
    days = _safe_int(request.args.get("days", 7), 7, 1, 365)
    try:
        return jsonify(get_db().audit_facets(days=days))
    except Exception:
        logging.exception("handler error in audit_search.py")
        return jsonify({"error": "internal error"}), 500
