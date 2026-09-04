# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/core/cache.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: ProxmoxVEx Caching & Rate Limiting - Layer 3
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
ProxmoxVEx Caching & Rate Limiting - Layer 3
API rate limiter and storage data cache.
Cache module for ProxmoxVEx.
"""

import base64
import contextlib
import gzip
import json
import logging
import threading
import time
from collections import defaultdict
from typing import Any


class APIRateLimiter:
    """Rate limiter for Proxmox API calls per cluster

    We tested with 3000 VMs in our lab and the Proxmox API started returning 503s
    when we hit it too fast. This prevents that.
    """

    def __init__(self, calls_per_second=10, burst_limit=20):
        self.calls_per_second = calls_per_second
        self.burst_limit = burst_limit
        self._tokens = defaultdict(lambda: burst_limit)  # per-cluster tokens
        self._last_update = defaultdict(lambda: time.time())
        self._lock = threading.Lock()

    def acquire(self, cluster_id: str, timeout: float = 30.0) -> bool:
        """Acquire permission to make an API call. Returns False if timed out."""
        start_time = time.time()

        while True:
            with self._lock:
                now = time.time()
                elapsed = now - self._last_update[cluster_id]

                # Replenish tokens based on time passed
                self._tokens[cluster_id] = min(
                    self.burst_limit, self._tokens[cluster_id] + (elapsed * self.calls_per_second)
                )
                self._last_update[cluster_id] = now

                if self._tokens[cluster_id] >= 1:
                    self._tokens[cluster_id] -= 1
                    return True

            # Check timeout
            if time.time() - start_time > timeout:
                logging.warning(f"API rate limit timeout for cluster {cluster_id}")
                return False

            # Wait a bit before retrying
            time.sleep(0.1)

    def get_stats(self, cluster_id: str) -> dict:
        """Get current rate limit stats for monitoring"""
        with self._lock:
            return {
                "available_tokens": round(self._tokens[cluster_id], 2),
                "max_tokens": self.burst_limit,
                "calls_per_second": self.calls_per_second,
            }


# Global rate limiter instance
# 10 calls/sec with burst of 20 should be safe for most Proxmox setups
# funny enough 15/30 worked fine with PVE 7.x but broke with 8.2 (stricter internal rate limit)
_api_rate_limiter = APIRateLimiter(calls_per_second=10, burst_limit=20)


# Caching layer for storage/VM data - reduces API calls significantly
class StorageDataCache:
    """Cache for storage and VM data to reduce Proxmox API load

    With 2000 VMs, fetching all configs every minute was killing the API.
    Now we cache for 30-60 seconds and only refresh what we need.
    """

    def __init__(self):
        self._cache = {}  # { cluster_id: { key: { 'data': ..., 'expires': timestamp } } }
        self._lock = threading.Lock()

    def get(self, cluster_id: str, key: str) -> tuple:
        """Get cached data. Returns (data, hit) where hit is True if cache hit."""
        with self._lock:
            if cluster_id not in self._cache:
                return None, False

            entry = self._cache[cluster_id].get(key)
            if not entry:
                return None, False

            if time.time() > entry["expires"]:
                del self._cache[cluster_id][key]
                return None, False

            return entry["data"], True

    def set(self, cluster_id: str, key: str, data: Any, ttl_seconds: int = 30):
        """Cache data with TTL"""
        with self._lock:
            if cluster_id not in self._cache:
                self._cache[cluster_id] = {}

            self._cache[cluster_id][key] = {"data": data, "expires": time.time() + ttl_seconds}

    def invalidate(self, cluster_id: str, key: str = None):
        """Invalidate cache entry or entire cluster cache"""
        with self._lock:
            if cluster_id in self._cache:
                if key:
                    self._cache[cluster_id].pop(key, None)
                else:
                    del self._cache[cluster_id]

    def get_stats(self) -> dict:
        """Get cache statistics"""
        with self._lock:
            total_entries = sum(len(c) for c in self._cache.values())
            return {"clusters_cached": len(self._cache), "total_entries": total_entries}


# Global cache instances
_storage_cache = StorageDataCache()


# 004-perf-cached-cluster-state: time-bound cache for full cluster state snapshots
class ClusterStateCache:
    """Cache for cluster state with TTL and hit/miss metrics."""

    def __init__(self, default_ttl=30):
        self.default_ttl = default_ttl
        self._cache = {}  # { cluster_id: { 'data': ..., 'expires': ..., 'cached_at': ... } }
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0

    def _get_ttl(self, cluster_id):
        # Future: per-cluster TTL from config; for now use a global setting or default.
        return getattr(self, "ttl_seconds", self.default_ttl)

    def get(self, cluster_id):
        with self._lock:
            entry = self._cache.get(cluster_id)
            if not entry:
                self._misses += 1
                return None
            if time.time() > entry["expires"]:
                self._cache.pop(cluster_id, None)
                self._misses += 1
                return None
            self._hits += 1
            return entry["data"]

    def set(self, cluster_id, data, ttl=None):
        ttl = ttl or self._get_ttl(cluster_id)
        now = time.time()
        with self._lock:
            self._cache[cluster_id] = {
                "data": data,
                "expires": now + ttl,
                "cached_at": now,
            }

    def invalidate(self, cluster_id=None):
        with self._lock:
            if cluster_id is None:
                self._cache.clear()
            else:
                self._cache.pop(cluster_id, None)

    def get_stats(self):
        with self._lock:
            total = self._hits + self._misses
            return {
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": round(self._hits / total, 4) if total > 0 else 0,
                "entries": len(self._cache),
                "last_refresh": max((e["cached_at"] for e in self._cache.values()), default=None),
            }

    def set_ttl(self, ttl):
        with contextlib.suppress(TypeError, ValueError):
            self.ttl_seconds = max(1, int(ttl))


# 004-perf-cached-cluster-state: singleton used by the cached cluster API
cluster_state_cache = ClusterStateCache(default_ttl=30)


# 009-perf-cached-vm-list: time-bound cache for per-cluster VM lists
class VMListCache(ClusterStateCache):
    """Cache for cluster VM lists with TTL and hit/miss metrics."""

    def _make_key(self, cluster_id, user_id):
        # Scope the cache to the user to respect per-VM ACLs.
        return f"{cluster_id}:{user_id}"

    def get(self, cluster_id, user_id):
        return super().get(self._make_key(cluster_id, user_id))

    def set(self, cluster_id, user_id, data, ttl=None):
        super().set(self._make_key(cluster_id, user_id), data, ttl)

    def invalidate(self, cluster_id=None):
        with self._lock:
            if cluster_id is None:
                self._cache.clear()
            else:
                for key in list(self._cache.keys()):
                    if key.startswith(f"{cluster_id}:"):
                        self._cache.pop(key, None)


# 009-perf-cached-vm-list: singleton used by the cached VM list API
vm_list_cache = VMListCache(default_ttl=30)


# 360-caching-for-cache-layer: generic cache layer for arbitrary performance data
class CacheLayerCache:
    """Cache layer for generic performance-critical data."""

    def __init__(self, default_ttl=30):
        self.default_ttl = default_ttl
        self._cache = {}
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            entry = self._cache.get(key)
            if not entry:
                return None
            if time.time() > entry["expires"]:
                self._cache.pop(key, None)
                return None
            return entry["data"]

    def set(self, key, data, ttl=None):
        ttl = ttl or self.default_ttl
        with self._lock:
            self._cache[key] = {"data": data, "expires": time.time() + ttl}

    def invalidate(self, key=None):
        with self._lock:
            if key is None:
                self._cache.clear()
            else:
                self._cache.pop(key, None)


# Global cache layer instance
cache_layer_cache = CacheLayerCache(default_ttl=30)


# Lazy/deferred cache fields for the cache layer.
_LAZY_CACHE_FIELDS = ("metadata", "extra")


def _prune_lazy_cache_fields(data, fields=None):
    """Remove lazy/deferred fields from cached data."""
    if fields is None:
        fields = _LAZY_CACHE_FIELDS
    if isinstance(data, dict):
        return {k: v for k, v in data.items() if k not in fields}
    if isinstance(data, list):
        return [_prune_lazy_cache_fields(item, fields) for item in data if isinstance(item, dict)]
    return data


# Pagination defaults and helper for cache layer data.
_CACHE_PAGINATION_DEFAULT = 50


def _paginate_cache_data(items, page=1, per_page=None):
    """Return a paginated slice of cached items."""
    if per_page is None:
        per_page = _CACHE_PAGINATION_DEFAULT
    if page is None or page < 1:
        page = 1
    per_page = max(1, per_page)
    start = (page - 1) * per_page
    end = start + per_page
    return list(items)[start:end]


# Batch size default and helper for cache layer operations.
_CACHE_BATCH_SIZE = 100


def _batch_cache_items(items, batch_size=None):
    """Split a list of cached items into fixed-size batches."""
    if batch_size is None:
        batch_size = _CACHE_BATCH_SIZE
    batch_size = max(1, batch_size)
    for i in range(0, len(items), batch_size):
        yield list(items)[i : i + batch_size]


# Indexing defaults and helper for cache layer entries.
_CACHE_INDEX_KEYS = ("id",)


def _index_cache_items(items, key="id"):
    """Build a lookup index for cached items by a key field."""
    if not items:
        return {}
    return {item[key]: item for item in items if isinstance(item, dict) and key in item}


# Compression helpers for cache layer values.
def _compress_cache_value(data):
    """Compress a cache value using gzip and base64."""
    raw = json.dumps(data, default=str).encode("utf-8")
    return base64.b64encode(gzip.compress(raw)).decode("ascii")


def _decompress_cache_value(payload):
    """Decompress a gzip/base64 cache payload."""
    raw = base64.b64decode(payload.encode("ascii"))
    return json.loads(gzip.decompress(raw).decode("utf-8"))


# Connection pool for cache layer backend connections.
_CACHE_CONNECTION_POOL = {}
_CACHE_POOL_MAX_SIZE = 10


def _get_cache_connection(name):
    """Retrieve or create a pooled cache layer connection for a given backend name."""
    if name in _CACHE_CONNECTION_POOL:
        return _CACHE_CONNECTION_POOL[name]
    if len(_CACHE_CONNECTION_POOL) >= _CACHE_POOL_MAX_SIZE:
        _CACHE_CONNECTION_POOL.popitem(last=False)
    _CACHE_CONNECTION_POOL[name] = name
    return name


# Async worker registry for cache layer.
_ASYNC_CACHE_WORKERS = {}


def _start_async_cache_worker(name, target, args=()):
    """Start a named background thread for a cache layer worker task."""
    if name in _ASYNC_CACHE_WORKERS:
        return _ASYNC_CACHE_WORKERS[name]
    thread = threading.Thread(target=target, args=args, daemon=True)
    thread.start()
    _ASYNC_CACHE_WORKERS[name] = thread
    return thread


# Memory-optimised cache value fields.
_CACHE_ESSENTIAL_FIELDS = ("id", "name", "status")


def _memory_optimise_cache_payload(payload, fields=None):
    """Return a memory-optimised cache value with only essential fields."""
    if fields is None:
        fields = _CACHE_ESSENTIAL_FIELDS
    if isinstance(payload, dict):
        return {k: v for k, v in payload.items() if k in fields}
    if isinstance(payload, list):
        return [{k: v for k, v in item.items() if k in fields} for item in payload if isinstance(item, dict)]
    return payload


# Incremental updates helper for cache layer entries.
_CACHE_INCREMENTAL_TIMESTAMP_KEY = "updated_at"


def _incremental_cache_updates(items, since=None, timestamp_key=None):
    """Filter cached items to only those updated since a given timestamp."""
    if timestamp_key is None:
        timestamp_key = _CACHE_INCREMENTAL_TIMESTAMP_KEY
    if since is None:
        return list(items)
    return [item for item in items if isinstance(item, dict) and item.get(timestamp_key, "") >= since]
