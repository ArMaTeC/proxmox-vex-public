# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/core/dbcrypto.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: PostgreSQL off-hub heavy query helpers.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
PostgreSQL off-hub heavy query helpers.

This module runs expensive read/write queries on a fresh independent
PostgreSQL connection inside gevent's OS threadpool so they do not block
the main event loop. It also re-exports compatibility shims (Row,
IntegrityError, etc.) for the small amount of legacy SQLite-style code that
still references them, but no SQLite/SQLCipher connection is ever opened.
"""

from __future__ import annotations

import contextlib
import logging
import os
import time as _time

import psycopg2

_LOG = logging.getLogger(__name__)

# Re-export compatibility shims. PGCursor uses psycopg2.extras.DictCursor
# for column-name access, so the row_factory is only present for
# SQLite-style compatibility; actual rows already support dict() and [] access.
Row = None
IntegrityError = psycopg2.IntegrityError
OperationalError = psycopg2.OperationalError
DatabaseError = psycopg2.DatabaseError


def backend_status() -> dict:
    """For the /api/security/db-status endpoint + admin health-indicator."""
    return {
        "backend": "postgresql",
        "encrypted_at_rest": False,
        "cipher": None,
        "note": ("PostgreSQL is the only supported backend. Sensitive fields are encrypted at the application level."),
    }


def _heavy_read_offload(sql: str, params: tuple, transform=None):
    """Run the query (and optionally a transform of the rows) on a fresh
    independent PostgreSQL connection inside gevent's OS threadpool — or inline
    if no hub.

    `transform(rows)` runs INSIDE the worker thread too, so CPU-heavy
    post-processing (e.g. json.loads of thousands of rows) also stays off the
    hub instead of being done by the calling greenlet."""

    def _work():
        from .db_pg import PGConnection, _pg_dsn

        conn = PGConnection(_pg_dsn())
        try:
            cur = conn.cursor()
            cur.execute(sql, params)
            rows = cur.fetchall()
        finally:
            with contextlib.suppress(Exception):
                conn.close()
        return transform(rows) if transform is not None else rows

    try:
        from gevent import get_hub

        return get_hub().threadpool.apply(_work)
    except Exception:
        # No active hub (synchronous CLI context) — run inline.
        return _work()


# ─── Tier 2: result cache + single-flight + concurrency cap ──────────────────
# 2026-06-04 - Tier-1 (off-hub reads) keeps a single heavy query from
# freezing the hub, but under heavy CONCURRENT load (many users opening
# Insights/Cost/Power at once) the crypto worker threads still contend the GIL
# and the hub blips. Tier-2 closes that:
#   - TTL cache keyed by an explicit semantic key (not the raw SQL/params,
#     whose `cutoff` timestamp varies by microseconds per call). metrics_history
#     is 5-min cadence, so a short TTL is correct — "last 30d as of now" vs
#     "as of 60s ago" is identical data.
#   - Single-flight: while one greenlet is fetching a key, others wait on its
#     AsyncResult instead of each firing their own query (no stampede). The
#     heavy metrics_history query is cluster-AGNOSTIC (it loads every cluster
#     then filters in Python), so all clusters + all concurrent callers for a
#     given window share ONE query.
#   - Concurrency cap: a bounded semaphore limits how many DISTINCT heavy
#     queries hit the crypto threadpool at once, so distinct-key misses can't
#     GIL-storm the hub.

_HEAVY_TTL = float(os.environ.get("PROXMOXVEX_HEAVY_READ_TTL", "60") or "60")
_HEAVY_CACHE: dict = {}  # cache_key -> (expiry_monotonic, rows)
_HEAVY_INFLIGHT: dict = {}  # cache_key -> AsyncResult


def _heavy_sem():
    # Lazily build a gevent BoundedSemaphore (needs the hub). Cap concurrent
    # distinct heavy queries; default 4. Falls back to None if gevent absent.
    global _HEAVY_SEM_OBJ
    try:
        return _HEAVY_SEM_OBJ
    except NameError:
        try:
            from gevent.lock import BoundedSemaphore

            n = int(os.environ.get("PROXMOXVEX_HEAVY_READ_CONCURRENCY", "4") or "4")
            _HEAVY_SEM_OBJ = BoundedSemaphore(max(1, n))
        except Exception:
            _HEAVY_SEM_OBJ = None
        return _HEAVY_SEM_OBJ


def run_heavy_read(sql: str, params: tuple = (), cache_key: str = None, ttl: float = None, transform=None):  # noqa: ANN001
    """Execute a read-only query off the gevent hub. Returns a list of Row
    objects (column-name access preserved), or transform(rows) when given.

    cache_key — when provided, results are TTL-cached + single-flighted under
    this key (callers pass a stable semantic key like 'mh:30', NOT the raw
    cutoff which varies per call). Omit for uncached off-hub reads.
    ttl — override the cache TTL (seconds) for this key.
    transform — optional callable(rows)->value run INSIDE the worker thread, so
    CPU-heavy post-processing (json.loads of thousands of rows) also stays off
    the hub. The transformed value is what gets cached/returned.

    Falls back to a direct in-thread query when gevent isn't available.
    """
    if not cache_key:
        return _heavy_read_offload(sql, params, transform)

    now = _time.monotonic()
    ent = _HEAVY_CACHE.get(cache_key)
    if ent and ent[0] > now:
        return ent[1]

    # single-flight: if someone is already fetching this key, wait for them.
    inflight = _HEAVY_INFLIGHT.get(cache_key)
    if inflight is not None:
        try:
            return inflight.get()
        except Exception:
            # the in-flight fetch failed; fall through and try ourselves
            pass

    # we are the fetcher
    try:
        from gevent.event import AsyncResult

        ar = AsyncResult()
    except Exception:
        ar = None
    if ar is not None:
        _HEAVY_INFLIGHT[cache_key] = ar
    try:
        sem = _heavy_sem()
        if sem is not None:
            with sem:
                rows = _heavy_read_offload(sql, params, transform)
        else:
            rows = _heavy_read_offload(sql, params, transform)
        _HEAVY_CACHE[cache_key] = (now + (ttl if ttl is not None else _HEAVY_TTL), rows)
        if ar is not None:
            ar.set(rows)
        return rows
    except Exception as e:
        if ar is not None:
            ar.set_exception(e)
        raise
    finally:
        _HEAVY_INFLIGHT.pop(cache_key, None)


def run_heavy_write(statements=None, build=None):
    """Execute write statements on a FRESH PostgreSQL connection inside gevent's
    threadpool so a big INSERT/DELETE doesn't freeze the hub.

    statements — iterable of (sql, params) run in one transaction.
    build       — optional callable() -> statements, run INSIDE the worker
                  thread so even CPU-heavy prep (json.dumps) stays off the hub.
    Returns True on success."""

    def _work():
        from .db_pg import PGConnection, _pg_dsn

        conn = PGConnection(_pg_dsn())
        try:
            stmts = build() if build is not None else (statements or [])
            cur = conn.cursor()
            for sql, params in stmts:
                cur.execute(sql, params or ())
            conn.commit()
            return True
        finally:
            with contextlib.suppress(Exception):
                conn.close()

    try:
        from gevent import get_hub

        return get_hub().threadpool.apply(_work)
    except Exception:
        # No active hub (synchronous context) — run inline.
        return _work()
