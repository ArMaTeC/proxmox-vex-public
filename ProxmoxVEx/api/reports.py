# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/api/reports.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: reports + legacy tags routes - split from monolith dec...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""reports + legacy tags routes - split from monolith dec 2025,"""

import base64
import concurrent.futures
import contextlib
import gzip
import json
import logging
import queue as queue_module
import re
import threading
import time
from datetime import datetime, timedelta
from urllib.parse import urlparse

from flask import Blueprint, jsonify, request

from ProxmoxVEx.api.helpers import check_cluster_access, load_server_settings
from ProxmoxVEx.api.schedules import start_scheduler
from ProxmoxVEx.background.metrics import load_metrics_history, start_metrics_collector
from ProxmoxVEx.background.syslog_server import SEVERITY_MAP
from ProxmoxVEx.core.db_pg import PGConnection, _pg_dsn
from ProxmoxVEx.globals import cluster_managers
from ProxmoxVEx.utils.auth import load_users, require_auth
from ProxmoxVEx.utils.rbac import get_user_clusters

bp = Blueprint("reports", __name__)


# In-memory cache for generated reports.
class ReportCache:
    """Simple TTL cache for report generation results."""

    def __init__(self, default_ttl=60):
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

    def clear(self):
        with self._lock:
            self._data.clear()
            self._ttl.clear()


report_cache = ReportCache(default_ttl=60)


def get_cached_report(cache_key, generator):
    """Return a cached report or generate and cache it."""
    cached = report_cache.get(cache_key)
    if cached is not None:
        return cached
    result = generator()
    report_cache.set(cache_key, result)
    return result


class LazyReportLoader:
    """Lazy loader that defers report chunk generation until requested."""

    def __init__(self, generator, chunk_size=50):
        self._generator = generator
        self._chunk_size = chunk_size
        self._chunks = []

    def get_chunk(self, index):
        """Return a specific chunk, materializing up to that point."""
        while len(self._chunks) <= index:
            chunk = []
            try:
                for _ in range(self._chunk_size):
                    chunk.append(next(self._generator))
            except StopIteration:
                break
            if not chunk:
                break
            self._chunks.append(chunk)
        if index < len(self._chunks):
            return self._chunks[index]
        return []

    def total_chunks(self):
        """Materialize all chunks and return the total count."""
        i = 0
        while True:
            chunk = self.get_chunk(i)
            if not chunk:
                break
            i += 1
        return i


def load_report_lazy(data, chunk_size=50):
    """Wrap a report data list in a lazy chunk loader."""
    if not isinstance(data, list):
        data = []
    return LazyReportLoader(iter(data), chunk_size=chunk_size)


def paginate_report(data, page=1, per_page=50):
    """Return a paginated slice of a report with metadata."""
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


def batch_report(data, batch_size=50):
    """Split a report into fixed-size batches."""
    if not isinstance(data, list):
        data = []
    return [data[i : i + batch_size] for i in range(0, len(data), batch_size)]


def index_report(data, field="id"):
    """Build a lookup index of report items by a field."""
    if not isinstance(data, list):
        data = []
    index = {}
    for item in data:
        if isinstance(item, dict) and field in item:
            index.setdefault(item[field], []).append(item)
        elif hasattr(item, field):
            index.setdefault(getattr(item, field), []).append(item)
    return index


def compress_report(data):
    """Compress a report payload using gzip and base64."""
    if not isinstance(data, list):
        data = []
    payload = json.dumps(data).encode("utf-8")
    return base64.b64encode(gzip.compress(payload)).decode("ascii")


def decompress_report(compressed):
    """Decompress a gzip/base64 report payload."""
    raw = gzip.decompress(base64.b64decode(compressed))
    return json.loads(raw.decode("utf-8"))


class ReportConnectionPool:
    """Reusable connection pool for report generation clients."""

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


report_connection_pool = ReportConnectionPool()


def get_pooled_report_connection(factory=None):
    """Get a report connection from the shared pool."""
    return report_connection_pool.acquire(factory)


class ReportAsyncWorker:
    """Background worker pool for report generation tasks."""

    def __init__(self, max_workers=4):
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)

    def submit(self, fn, *args, **kwargs):
        """Submit a task to the worker pool."""
        return self._executor.submit(fn, *args, **kwargs)

    def shutdown(self, wait=True):
        """Shut down the worker pool."""
        self._executor.shutdown(wait=wait)


report_async_worker = ReportAsyncWorker()


def run_report_workers(tasks):
    """Run a list of callables concurrently and return their results."""
    if not isinstance(tasks, list):
        tasks = []
    futures = [report_async_worker.submit(t) for t in tasks if callable(t)]
    return [f.result() for f in futures]


def compact_report(data, max_items=100):
    """Drop oldest report items to keep memory usage bounded."""
    if not isinstance(data, list):
        data = []
    if len(data) > max_items:
        return data[-max_items:]
    return data


def shrink_report(data, max_items=100):
    """Trim a report list to a maximum item count."""
    return compact_report(data, max_items=max_items)


def diff_report(old, new, key_field="id"):
    """Return report items from `new` that are not in `old` by a key field."""
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


def _syslog_search_terms(search_text):
    return [term for term in re.split(r"\s+", search_text.strip()) if term]


def _syslog_escape_fts_term(term):
    sanitized = "".join(ch for ch in term if ch.isprintable() and ch not in "\x00\r\n\t")
    sanitized = sanitized.replace('"', '""').strip()
    return f'"{sanitized}"*' if sanitized else ""


def _syslog_fts_query(search_text):
    terms = _syslog_search_terms(search_text)
    if not terms:
        return ""
    escaped_terms = [_syslog_escape_fts_term(term) for term in terms]
    escaped_terms = [term for term in escaped_terms if term]
    return " AND ".join(escaped_terms)


def _syslog_like_clause(search_text):
    like = f"%{search_text}%"
    return (
        """(
            timestamp ILIKE ? OR
            source_ip ILIKE ? OR
            hostname ILIKE ? OR
            severity_text ILIKE ? OR
            message ILIKE ? OR
            protocol ILIKE ?
        )""",
        [like, like, like, like, like, like],
    )


def _syslog_hostname_tokens(value):
    value = str(value or "").strip().lower()
    if not value:
        return set()
    if "://" in value:
        parsed = urlparse(value)
        value = parsed.hostname or value
    value = value.split("/")[0].split("@")[-1]
    if value.startswith("[") and "]" in value:
        value = value[1 : value.index("]")]
    elif ":" in value and value.count(":") == 1:
        value = value.rsplit(":", 1)[0]
    value = value.strip(".")
    if not value:
        return set()
    tokens = {value}
    if "." in value:
        tokens.add(value.split(".", 1)[0])
    return tokens


def _syslog_cluster_hostnames(cluster_id):
    manager = cluster_managers.get(cluster_id)
    if not manager:
        return set()

    hostnames = set()
    config = getattr(manager, "config", None)
    for value in (
        getattr(manager, "host", ""),
        getattr(config, "host", "") if config else "",
        getattr(config, "name", "") if config else "",
    ):
        hostnames.update(_syslog_hostname_tokens(value))

    try:
        node_status = manager.get_node_status() or {}
        for node_name in node_status:
            hostnames.update(_syslog_hostname_tokens(node_name))
    except Exception as exc:
        logging.debug(f"[Syslog] Could not load nodes for cluster filter {cluster_id}: {exc}")
        for node_name in getattr(manager, "ha_node_status", {}):
            hostnames.update(_syslog_hostname_tokens(node_name))

    return hostnames


@bp.route("/api/reports/summary", methods=["GET"])
@require_auth()
def get_reports_summary():
    """Get summary report across all clusters

    Query params:
    - period: 'hour', 'day', 'week' (default: day)
    """
    period = request.args.get("period", "day")

    # Tenant filtering for multi-tenant security
    usr = getattr(request, "session", {}).get("user", "system")
    users_db = load_users()
    user_data = users_db.get(usr, {})
    accessible_clusters = get_user_clusters(user_data)  # None = admin (all clusters)

    history = load_metrics_history()
    snapshots = history.get("snapshots", [])

    if not snapshots:
        return jsonify({"error": "No historical data available yet"}), 404

    # Filter by period
    now = datetime.now()
    if period == "hour":
        cutoff = now - timedelta(hours=1)
    elif period == "week":
        cutoff = now - timedelta(days=7)
    else:  # day
        cutoff = now - timedelta(days=1)

    cutoff_str = cutoff.isoformat()
    filtered = [s for s in snapshots if s.get("timestamp", "") >= cutoff_str]

    if not filtered:
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({"error": f"No data for the last {period}"}), 404

    # Calculate averages and trends
    report = {
        "period": period,
        "data_points": len(filtered),
        "start_time": filtered[0].get("timestamp"),
        "end_time": filtered[-1].get("timestamp"),
        "clusters": {},
    }

    # Aggregate per cluster
    for snapshot in filtered:
        for cluster_id, cluster_data in snapshot.get("clusters", {}).items():
            # Skip clusters the user cannot access
            if accessible_clusters is not None and cluster_id not in accessible_clusters:
                continue
            if cluster_id not in report["clusters"]:
                report["clusters"][cluster_id] = {
                    "name": cluster_data.get("name", cluster_id),
                    "cpu_samples": [],
                    "mem_samples": [],
                    "vm_samples": [],
                }

            totals = cluster_data.get("totals", {})
            if totals.get("cpu_total", 0) > 0:
                cpu_percent = totals["cpu_used"] / totals["cpu_total"] * 100
                report["clusters"][cluster_id]["cpu_samples"].append(cpu_percent)

            if totals.get("mem_total", 0) > 0:
                mem_percent = totals["mem_used"] / totals["mem_total"] * 100
                report["clusters"][cluster_id]["mem_samples"].append(mem_percent)

            vm_count = totals.get("vms_running", 0) + totals.get("cts_running", 0)
            report["clusters"][cluster_id]["vm_samples"].append(vm_count)

    # Calculate stats
    for _, data in report["clusters"].items():
        cpu = data.pop("cpu_samples", [])
        mem = data.pop("mem_samples", [])
        vms = data.pop("vm_samples", [])

        data["cpu"] = {
            "avg": round(sum(cpu) / len(cpu), 1) if cpu else 0,
            "min": round(min(cpu), 1) if cpu else 0,
            "max": round(max(cpu), 1) if cpu else 0,
            "current": round(cpu[-1], 1) if cpu else 0,
        }

        data["memory"] = {
            "avg": round(sum(mem) / len(mem), 1) if mem else 0,
            "min": round(min(mem), 1) if mem else 0,
            "max": round(max(mem), 1) if mem else 0,
            "current": round(mem[-1], 1) if mem else 0,
        }

        data["vms_running"] = {
            "avg": round(sum(vms) / len(vms), 1) if vms else 0,
            "min": min(vms) if vms else 0,
            "max": max(vms) if vms else 0,
            "current": vms[-1] if vms else 0,
        }

    return jsonify(report)


@bp.route("/api/syslog/events", methods=["GET"])
@require_auth(perms=["admin.audit"])
def get_integrated_syslog_events():
    """Paginated overview of events stored by the integrated syslog server."""
    try:
        page = max(int(request.args.get("page", 1)), 1)
    except (TypeError, ValueError):
        page = 1

    try:
        per_page = int(request.args.get("per_page", 50))
    except (TypeError, ValueError):
        per_page = 50
    per_page = min(max(per_page, 1), 50)

    search = (request.args.get("search") or "").strip()
    severity = (request.args.get("severity") or "").strip()
    protocol = (request.args.get("protocol") or "").strip().upper()
    hostname = (request.args.get("hostname") or "").strip()
    source_ip = (request.args.get("source_ip") or "").strip()
    facility = (request.args.get("facility") or "").strip()
    cluster_id = (request.args.get("cluster_id") or "").strip()

    sort_map = {
        "id": "logs.id",
        "timestamp": "logs.timestamp",
        "source_ip": "logs.source_ip",
        "hostname": "logs.hostname",
        "facility": "logs.facility",
        "severity": "logs.severity",
        "severity_text": "logs.severity_text",
        "message": "logs.message",
        "protocol": "logs.protocol",
    }

    sort_by = sort_map.get(request.args.get("sort_by", "timestamp"), "timestamp")
    sort_dir = "asc" if request.args.get("sort_dir", "desc").lower() == "asc" else "desc"
    # Belt-and-braces gegen die SQLi-finding bei semgrep am 2026-05-06.
    # sort_by ist eh aus dem map.get() mit hardcoded fallback 'timestamp', und
    # sort_dir aus dem ternary nur asc/desc -- aber semgrep sieht das nicht
    # weil der validate-step 80 zeilen frueher steht. hier nochmal explizit
    # damit's am sink offensichtlich ist und ich nicht in einem halben jahr
    # an dieser stelle nochmal grübeln muss.
    if sort_by not in sort_map.values():
        sort_by = "logs.timestamp"
    if sort_dir not in ("asc", "desc"):
        sort_dir = "desc"

    where = []
    params = []
    joins = []

    # PostgreSQL connection for the integrated syslog logs table.
    conn = PGConnection(_pg_dsn())

    if search:
        like_clause, like_params = _syslog_like_clause(search)
        where.append(like_clause)
        params.extend(like_params)

    if severity != "":
        try:
            severity_value = int(severity)
            where.append("logs.severity = ?")
            params.append(severity_value)
        except ValueError:
            pass

    if protocol:
        where.append("logs.protocol = ?")
        params.append(protocol)

    if hostname:
        where.append("logs.hostname ILIKE ?")
        params.append(f"{hostname}%")

    if source_ip:
        where.append("logs.source_ip ILIKE ?")
        params.append(f"{source_ip}%")

    if facility != "":
        try:
            facility_value = int(facility)
            where.append("logs.facility = ?")
            params.append(facility_value)
        except ValueError:
            pass

    if cluster_id and load_server_settings().get("syslog_filter_by_selected_cluster", False):
        ok, _ = check_cluster_access(cluster_id)
        if not ok:
            return jsonify({"error": "Access denied to this cluster"}), 403
        cluster_hostnames = sorted(_syslog_cluster_hostnames(cluster_id))
        if cluster_hostnames:
            cluster_hostname_where = []
            for value in cluster_hostnames:
                cluster_hostname_where.append("LOWER(logs.hostname) = ?")
                params.append(value)
                cluster_hostname_where.append("LOWER(logs.hostname) LIKE ?")
                params.append(f"{value}.%")
            where.append(f"({' OR '.join(cluster_hostname_where)})")
        else:
            where.append("1 = 0")

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    joins_sql = f"{' '.join(joins)}" if joins else ""
    offset = (page - 1) * per_page

    try:
        count_sql = f"SELECT COUNT(*) AS count FROM logs {joins_sql} {where_sql}"  # nosec: B608 - joins/where from allowlists, sort validated
        total = conn.execute(count_sql, params).fetchone()["count"]

        # fmt: off
        select_sql = f"SELECT logs.id, logs.timestamp, logs.source_ip, logs.hostname, logs.facility, logs.severity, logs.severity_text, logs.message, logs.protocol FROM logs {joins_sql} {where_sql} ORDER BY {sort_by} {sort_dir}, logs.id DESC LIMIT ? OFFSET ?"  # nosec: B608 - joins/where use placeholders; sort validated
        rows = conn.execute(select_sql, [*params, per_page, offset]).fetchall()
        # fmt: on

        protocol_rows = conn.execute(
            """
            SELECT DISTINCT protocol
            FROM logs
            WHERE protocol IS NOT NULL AND TRIM(protocol) != ''
            ORDER BY protocol ASC
            """
        ).fetchall()
    finally:
        conn.close()

    total_pages = (total + per_page - 1) // per_page if total else 0

    return jsonify({
        "items": [dict(row) for row in rows],
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
        },
        "filters": {
            "protocols": [row["protocol"] for row in protocol_rows],
            "severities": [{"value": level, "label": text} for level, text in sorted(SEVERITY_MAP.items())],
        },
    })


@bp.route("/api/reports/timeline", methods=["GET"])
@require_auth()
def get_reports_timeline():
    """Get timeline data for charts

    Query params:
    - period: 'hour', 'day', 'week'
    - cluster_id: Optional - filter to specific cluster
    - metric: 'cpu', 'memory', 'vms' (default: all)
    """
    period = request.args.get("period", "day")
    filter_cluster = request.args.get("cluster_id")
    metric = request.args.get("metric", "all")

    # Tenant filtering for multi-tenant security
    usr = getattr(request, "session", {}).get("user", "system")
    users_db = load_users()
    user_data = users_db.get(usr, {})
    accessible_clusters = get_user_clusters(user_data)  # None = admin (all clusters)

    history = load_metrics_history()
    snapshots = history.get("snapshots", [])

    if not snapshots:
        return jsonify({"error": "No historical data available"}), 404

    # Filter by period
    now = datetime.now()
    if period == "hour":
        cutoff = now - timedelta(hours=1)
    elif period == "week":
        cutoff = now - timedelta(days=7)
    else:
        cutoff = now - timedelta(days=1)

    cutoff_str = cutoff.isoformat()
    filtered = [s for s in snapshots if s.get("timestamp", "") >= cutoff_str]

    # Build timeline
    timeline = {"period": period, "timestamps": [], "data": {}}

    for snapshot in filtered:
        timestamp = snapshot.get("timestamp", "")
        timeline["timestamps"].append(timestamp)

        for cluster_id, cluster_data in snapshot.get("clusters", {}).items():
            if filter_cluster and cluster_id != filter_cluster:
                continue
            # Skip clusters the user cannot access
            if accessible_clusters is not None and cluster_id not in accessible_clusters:
                continue

            if cluster_id not in timeline["data"]:
                timeline["data"][cluster_id] = {
                    "name": cluster_data.get("name", cluster_id),
                    "cpu": [],
                    "memory": [],
                    "vms": [],
                }

            totals = cluster_data.get("totals", {})

            # CPU
            if metric in ["all", "cpu"]:
                cpu = 0
                if totals.get("cpu_total", 0) > 0:
                    cpu = round(totals["cpu_used"] / totals["cpu_total"] * 100, 1)
                timeline["data"][cluster_id]["cpu"].append(cpu)

            # Memory
            if metric in ["all", "memory"]:
                mem = 0
                if totals.get("mem_total", 0) > 0:
                    mem = round(totals["mem_used"] / totals["mem_total"] * 100, 1)
                timeline["data"][cluster_id]["memory"].append(mem)

            # VMs
            if metric in ["all", "vms"]:
                vms = totals.get("vms_running", 0) + totals.get("cts_running", 0)
                timeline["data"][cluster_id]["vms"].append(vms)

    return jsonify(timeline)


@bp.route("/api/reports/top-vms", methods=["GET"])
@require_auth()
def get_top_vms():
    """Get top VMs by resource usage

    Query params:
    - metric: 'cpu' or 'memory' (default: cpu)
    - limit: Number of results (default: 10)
    """
    metric = request.args.get("metric", "cpu")
    limit = int(request.args.get("limit", 10))

    # Tenant filtering for multi-tenant security
    usr = getattr(request, "session", {}).get("user", "system")
    users_db = load_users()
    user_data = users_db.get(usr, {})
    accessible_clusters = get_user_clusters(user_data)  # None = admin (all clusters)

    vms = []

    for cluster_id, mgr in cluster_managers.items():
        # Skip clusters the user cannot access
        if accessible_clusters is not None and cluster_id not in accessible_clusters:
            continue
        if not mgr.is_connected:
            continue

        try:
            resources = mgr.get_vm_resources()
            for r in resources:
                if r.get("status") != "running":
                    continue

                vm_data = {
                    "cluster_id": cluster_id,
                    "cluster_name": mgr.config.name,
                    "vmid": r.get("vmid"),
                    "name": r.get("name"),
                    "node": r.get("node"),
                    "type": r.get("type"),
                    "cpu": r.get("cpu", 0),
                    "mem": r.get("mem", 0),
                    "maxmem": r.get("maxmem", 0),
                    "mem_percent": round(r.get("mem", 0) / max(r.get("maxmem", 1), 1) * 100, 1),
                }
                vms.append(vm_data)
        except Exception:
            pass

    # Sort by metric
    if metric == "memory":
        vms.sort(key=lambda x: x.get("mem_percent", 0), reverse=True)
    else:
        vms.sort(key=lambda x: x.get("cpu", 0), reverse=True)

    return jsonify(vms[:limit])


# Start background threads when server starts
# Move this to main() later, for now it's fine here
threading.Timer(5, start_scheduler).start()
threading.Timer(10, start_metrics_collector).start()


# ============================================
# CVE / Package Vulnerability Scanner
# Per-node security scanning
# ============================================


@bp.route("/api/clusters/<cluster_id>/reports/cve-scan", methods=["POST"])
@require_auth(perms=["node.view"])
def scan_all_nodes_cves(cluster_id):
    """Scan all nodes in a cluster for package vulnerabilities"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    if not mgr.is_connected:
        return jsonify({"error": "Cluster not connected"}), 503

    try:
        node_status = mgr.get_node_status()
    except Exception:
        return jsonify({"error": "Failed to get node list"}), 500

    results = []
    for node_name in node_status:
        # #199: skip offline nodes — no point trying SSH on dead nodes
        ns = node_status.get(node_name, {})
        if ns.get("offline") or ns.get("status") == "offline":
            results.append({"node": node_name, "error": "Node offline"})
            continue
        try:
            scan = mgr.scan_node_packages(node_name)
            results.append(scan)
        except Exception as e:
            results.append({"node": node_name, "error": str(e)})

    total_sec = sum(r.get("security_count", 0) for r in results)
    total_upd = sum(r.get("total_count", 0) for r in results)
    total_cves = sum(r.get("cve_count", 0) for r in results)
    has_debsecan = any(r.get("debsecan_available") for r in results)

    return jsonify({
        "cluster_id": cluster_id,
        "cluster_name": getattr(mgr.config, "name", cluster_id),
        "scanned_at": datetime.now().isoformat(),
        "nodes": results,
        "summary": {
            "nodes_scanned": len(results),
            "nodes_ok": sum(
                1
                for r in results
                if not r.get("error") and r.get("cve_count", 0) == 0 and r.get("security_count", 0) == 0
            ),
            "total_cves": total_cves,
            "total_security": total_sec,
            "total_updates": total_upd,
            "debsecan_available": has_debsecan,
        },
    })


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/cve-scan", methods=["POST"])
@require_auth(perms=["node.view"])
def scan_single_node_cves(cluster_id, node):
    """Scan a single node for package vulnerabilities"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    if not mgr.is_connected:
        return jsonify({"error": "Cluster not connected"}), 503

    result = mgr.scan_node_packages(node)
    return jsonify(result)


@bp.route("/api/clusters/<cluster_id>/reports/install-debsecan", methods=["POST"])
@require_auth(perms=["node.maintenance"])
def install_debsecan(cluster_id):
    """Install debsecan on all nodes in the cluster via SSH"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    if not mgr.is_connected:
        return jsonify({"error": "Cluster not connected"}), 503

    try:
        node_status = mgr.get_node_status()
    except Exception:
        return jsonify({"error": "Failed to get node list"}), 500

    results = []
    for node_name in node_status:
        out = mgr._ssh_node_output(
            node_name, "DEBIAN_FRONTEND=noninteractive /usr/bin/apt-get install -y debsecan 2>&1 | tail -3", timeout=120
        )
        if out is not None:
            results.append({"node": node_name, "success": True, "output": out.strip()[-200:]})
        else:
            results.append({"node": node_name, "success": False, "error": "SSH failed"})

    ok_count = sum(1 for r in results if r["success"])
    return jsonify({"installed": ok_count, "total": len(results), "nodes": results})


# ============================================
# CIS Hardening Endpoints - Mar 2026
# ============================================


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/hardening", methods=["GET"])
@require_auth(perms=["node.maintenance"])
def check_hardening(cluster_id, node):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404
    mgr = cluster_managers[cluster_id]
    if not mgr.is_connected:
        return jsonify({"error": "Cluster offline"}), 503

    # (#322): verbose mode - returns per-control evidence for audit reports
    verbose = str(request.args.get("verbose", "")).lower() in ("1", "true", "yes")
    # Profile filter; Harden PVE Node UI + Compliance Dashboard share these.
    profile = (request.args.get("profile", "") or "").strip().lower() or None
    if profile and profile not in {
        "cis-l1",
        "cis-l2",
        "vs-nfd",
        "bsi",
        "iso",
        "nis2",
        "cmmc1",
        "cmmc2",
        "nist53",
        "stig",
        "dr",
        "rgs",
    }:
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({"error": f"unknown profile: {profile}"}), 400
    result = mgr.check_node_hardening(node, verbose=verbose, profile=profile)
    if result is None:
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({"error": f"SSH to {node} failed"}), 502

    return jsonify({"node": node, "controls": result, "verbose": verbose, "profile": profile or "cis-l1"})


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/hardening", methods=["POST"])
@require_auth(perms=["node.maintenance"])
def apply_hardening(cluster_id, node):
    """Apply selected CIS controls"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404
    mgr = cluster_managers[cluster_id]
    if not mgr.is_connected:
        return jsonify({"error": "Cluster offline"}), 503

    data = request.get_json() or {}
    controls = data.get("controls", [])
    if not controls:
        return jsonify({"error": "No controls specified"}), 400

    ctrl_params = data.get("params", {})
    results = mgr.apply_node_hardening(node, controls, params=ctrl_params)
    ok_count = sum(1 for v in results.values() if v.get("success"))

    from ProxmoxVEx.utils.audit import log_audit

    log_audit(
        "node.hardening_applied", {"node": node, "controls": controls, "success": ok_count, "total": len(controls)}
    )

    return jsonify({"node": node, "results": results, "applied": ok_count, "total": len(controls)})


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/hardening/rollback", methods=["POST"])
@require_auth(perms=["node.maintenance"])
def rollback_hardening(cluster_id, node):
    """Restore selected CIS controls to their pre-apply state (#386)"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404
    mgr = cluster_managers[cluster_id]
    if not mgr.is_connected:
        return jsonify({"error": "Cluster offline"}), 503

    data = request.get_json() or {}
    controls = data.get("controls", [])
    if not controls:
        return jsonify({"error": "No controls specified"}), 400

    results = mgr.rollback_node_hardening(node, controls)
    ok_count = sum(1 for v in results.values() if v.get("success"))

    from ProxmoxVEx.utils.audit import log_audit

    log_audit(
        "node.hardening_rolled_back", {"node": node, "controls": controls, "restored": ok_count, "total": len(controls)}
    )

    return jsonify({"node": node, "results": results, "restored": ok_count, "total": len(controls)})


# ============================================
# Compliance framework mapping  -  Apr 2026
# Frontend pulls these to render the compliance PDFs with real
# CMMC / NIST / STIG / ISO / BSI control IDs instead of our internal
# names like "pam_faillock". See ProxmoxVEx/core/compliance_mapping.py
# ============================================


@bp.route("/api/compliance/mapping", methods=["GET"])
@require_auth()
def compliance_mapping_api():
    framework = (request.args.get("framework", "") or "").strip().lower()
    from ProxmoxVEx.core import compliance_mapping as cm

    payload_full = {
        "family_labels": cm.FAMILY_LABELS,
        "mappings": cm.FRAMEWORK_MAPPING,
        "remediation": cm.REMEDIATION,
        "severity": cm.SEVERITY,
        "recommended_timeline": cm.RECOMMENDED_TIMELINE,
        "priority_level": cm.PRIORITY_LEVEL,
        "framework_meta": cm.FRAMEWORK_META,
        "posture_levels": cm.POSTURE_LEVELS,
        "glossary": cm.GLOSSARY,
        "methodology": cm.METHODOLOGY,
    }
    if not framework:
        return jsonify(payload_full)
    if framework not in cm.FRAMEWORK_MAPPING:
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({"error": f"unknown framework: {framework}"}), 400
    return jsonify({
        "framework": framework,
        "family_labels": cm.FAMILY_LABELS,
        "mapping": cm.FRAMEWORK_MAPPING[framework],
        "remediation": cm.REMEDIATION,
        "severity": cm.SEVERITY,
        "recommended_timeline": cm.RECOMMENDED_TIMELINE,
        "priority_level": cm.PRIORITY_LEVEL,
        "framework_meta": cm.FRAMEWORK_META.get(framework, {}),
        "posture_levels": cm.POSTURE_LEVELS,
        "glossary": cm.GLOSSARY,
        "methodology": cm.METHODOLOGY,
    })


# ============================================
# Legacy Fallback Endpoints
# old tags endpoints, kept for compat, these prevent 404s
# ============================================


@bp.route("/api/tags", methods=["GET"])
@require_auth()
def get_tags_legacy():
    """Legacy: Returns empty for old Settings UI"""
    return jsonify({"tags": {}, "available_tags": []})


@bp.route("/api/tags/available", methods=["GET"])
@require_auth()
def get_available_tags_legacy():
    """Legacy: Returns empty list"""
    return jsonify([])


@bp.route("/api/tags/available", methods=["POST"])
@require_auth()
def create_tag_legacy():
    """Legacy: Redirect to cluster-based tags"""
    return jsonify({"error": "Please use VM-based tags (click tag icon on VMs)"}), 400


@bp.route("/api/tags/available/<tag_name>", methods=["DELETE"])
@require_auth()
def delete_tag_legacy(tag_name):
    """Legacy: No-op"""
    return jsonify({"success": True})


# ============================================
# Cluster-Based Reports Endpoint
# reports are now per-cluster, not global
# ============================================


@bp.route("/api/clusters/<cluster_id>/reports/summary", methods=["GET"])
@require_auth()
def get_cluster_report_summary(cluster_id):
    """Get report summary for a specific cluster

    Returns both historical data (if available) and current live data
    """
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    period = request.args.get("period", "day")

    # Get LIVE current data from cluster using get_node_status()
    live_cpu = 0
    live_vms = 0
    live_cts = 0
    cpu_total = 0
    mem_total = 0
    mem_used = 0
    nodes_online = 0

    if mgr.is_connected:
        try:
            # Use get_node_status which actually fetches live data from Proxmox
            node_status = mgr.get_node_status()

            for _node_name, node_data in node_status.items():
                if not node_data:
                    continue
                # Check status
                status = node_data.get("status", "")
                if status in ["online", "running"]:
                    nodes_online += 1
                    # CPU and memory from get_node_status are already percentages
                    cpu_pct = node_data.get("cpu_percent", 0) or 0
                    node_data.get("mem_percent", 0) or 0
                    mem_t = node_data.get("mem_total", 0) or 0
                    mem_u = node_data.get("mem_used", 0) or 0

                    # Accumulate (we'll average later)
                    live_cpu += cpu_pct
                    mem_total += mem_t
                    mem_used += mem_u

            # Average CPU across nodes
            if nodes_online > 0:
                live_cpu = live_cpu / nodes_online
        except Exception as e:
            logging.error(f"Error getting node status for reports: {e}")

        # Count running VMs
        try:
            resources = mgr.get_vm_resources() or []
            for r in resources:
                if r and r.get("status") == "running":
                    if r.get("type") == "qemu":
                        live_vms += 1
                    else:
                        live_cts += 1
        except Exception as e:
            logging.error(f"Error getting VM resources: {e}")

    # Calculate live percentages
    live_cpu_pct = round(live_cpu, 1)
    live_mem_pct = round(mem_used / max(mem_total, 1) * 100, 1) if mem_total > 0 else 0

    # Load historical metrics
    history = load_metrics_history()
    snapshots = history.get("snapshots", [])

    # Filter by period
    now = datetime.now()
    if period == "hour":
        cutoff = now - timedelta(hours=1)
    elif period == "week":
        cutoff = now - timedelta(days=7)
    else:
        cutoff = now - timedelta(days=1)

    cutoff_str = cutoff.isoformat()
    filtered = [s for s in snapshots if s.get("timestamp", "") >= cutoff_str]

    # Extract data for this cluster only
    report = {
        "period": period,
        "cluster_id": cluster_id,
        "cluster_name": getattr(mgr.config, "name", None) or cluster_id,
        "data_points": 0,
        "cpu": {"avg": live_cpu_pct, "min": live_cpu_pct, "max": live_cpu_pct, "current": live_cpu_pct, "samples": []},
        "memory": {
            "avg": live_mem_pct,
            "min": live_mem_pct,
            "max": live_mem_pct,
            "current": live_mem_pct,
            "samples": [],
        },
        "vms_running": {
            "avg": live_vms + live_cts,
            "min": live_vms + live_cts,
            "max": live_vms + live_cts,
            "current": live_vms + live_cts,
            "samples": [],
        },
        "timestamps": [],
        # Add live data section
        "live": {
            "cpu_percent": live_cpu_pct,
            "mem_percent": live_mem_pct,
            "vms_running": live_vms,
            "cts_running": live_cts,
            "cpu_total": cpu_total,
            "mem_total": mem_total,
            "mem_used": mem_used,
        },
    }

    for snapshot in filtered:
        cluster_data = snapshot.get("clusters", {}).get(cluster_id)
        if not cluster_data:
            continue

        report["timestamps"].append(snapshot.get("timestamp", ""))
        report["data_points"] += 1

        totals = cluster_data.get("totals", {})

        # CPU
        if totals.get("cpu_total", 0) > 0:
            cpu = round(totals["cpu_used"] / totals["cpu_total"] * 100, 1)
            report["cpu"]["samples"].append(cpu)

        # Memory
        if totals.get("mem_total", 0) > 0:
            mem = round(totals["mem_used"] / totals["mem_total"] * 100, 1)
            report["memory"]["samples"].append(mem)

        # VMs
        vms = totals.get("vms_running", 0) + totals.get("cts_running", 0)
        report["vms_running"]["samples"].append(vms)

    # Calculate stats from historical data (keep samples for charts)
    for metric in ["cpu", "memory", "vms_running"]:
        samples = report[metric].get("samples", [])
        if samples:
            report[metric]["avg"] = round(sum(samples) / len(samples), 1)
            report[metric]["min"] = round(min(samples), 1)
            report[metric]["max"] = round(max(samples), 1)
            report[metric]["current"] = round(samples[-1], 1) if samples else report[metric]["current"]

    return jsonify(report)


# predictive-analysis endpoint moved to api/clusters.py (was duplicate registration —
# clusters_bp wins URL match anyway). May 2026.
