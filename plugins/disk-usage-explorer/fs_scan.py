# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/disk-usage-explorer/fs_scan.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Core traversal/sizing/sandboxing logic for the Disk...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Core traversal/sizing/sandboxing logic for the Disk Usage Explorer plugin.

Kept separate from __init__.py so the highest-risk logic (path containment,
symlink handling, permission-denied handling, cumulative sizing) can be unit
tested without booting the full plugin/Flask registration machinery.
"""

import atexit
import fnmatch
import json
import logging
import os
import stat as stat_module
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from types import SimpleNamespace

log = logging.getLogger("plugin.disk-usage-explorer")

DEFAULT_CACHE_TTL_S = 300
DEFAULT_MAX_CHILDREN_PER_PAGE = 2000
DEFAULT_SCAN_BUDGET_MS = 2500
DEFAULT_FULL_SCAN_BUDGET_MS = 300000


class PathNotAllowedError(Exception):
    """Raised when a requested path resolves outside every configured allowed root."""


class ConfigError(Exception):
    """Raised when the plugin's scan configuration is missing/invalid (e.g. no allowed_roots)."""


@dataclass
class CacheEntry:
    size_bytes: int
    entry_count: int
    computed_at: float
    partial: bool


# In-process only cache (never persisted) — see data-model.md "Scan Result /
# Cache Entry". Guarded by a lock, matching the _plugin_lock pattern used in
# ProxmoxVEx/api/plugins.py and ProxmoxVEx/native/registry.py.
_CACHE: dict = {}
_CACHE_LOCK = threading.Lock()


def clear_cache():
    """Drop all cached sizes. Used by tests and available for admin troubleshooting."""
    with _CACHE_LOCK:
        _CACHE.clear()


def _cache_get(path, ttl_s):
    with _CACHE_LOCK:
        entry = _CACHE.get(path)
    if entry is None:
        return None, "unscanned"
    age = time.monotonic() - entry.computed_at
    if age > ttl_s:
        return entry, "stale"
    return entry, "partial" if entry.partial else "complete"


def _cache_set(path, size_bytes, entry_count, partial):
    with _CACHE_LOCK:
        _CACHE[path] = CacheEntry(
            size_bytes=size_bytes, entry_count=entry_count, computed_at=time.monotonic(), partial=partial
        )


def load_scan_config(raw_config):
    """Validate & normalize a plugin config.json dict.

    Returns a dict with resolved allowed_roots (via realpath) plus the other
    settings. Raises ConfigError if allowed_roots is empty/invalid so callers
    fail closed instead of silently widening scope to '/' (Security First).
    """
    allowed_roots_raw = raw_config.get("allowed_roots") or []
    if not allowed_roots_raw:
        raise ConfigError("allowed_roots must be configured with at least one absolute path")

    resolved_roots = []
    for root in allowed_roots_raw:
        if not isinstance(root, str) or not os.path.isabs(root):
            log.warning("[disk-usage-explorer] Ignoring non-absolute allowed_root: %r", root)
            continue
        resolved_roots.append(os.path.realpath(root))

    if not resolved_roots:
        raise ConfigError("allowed_roots contained no valid absolute paths")

    scan_budget_ms = int(raw_config.get("scan_budget_ms", DEFAULT_SCAN_BUDGET_MS))
    full_scan_budget_ms = int(raw_config.get("full_scan_budget_ms", DEFAULT_FULL_SCAN_BUDGET_MS))
    return {
        "allowed_roots": resolved_roots,
        "excluded_patterns": raw_config.get("excluded_patterns") or [],
        "cache_ttl_s": int(raw_config.get("cache_ttl_s", DEFAULT_CACHE_TTL_S)),
        "max_children_per_page": int(raw_config.get("max_children_per_page", DEFAULT_MAX_CHILDREN_PER_PAGE)),
        "scan_budget_ms": scan_budget_ms,
        "full_scan_budget_ms": max(scan_budget_ms, full_scan_budget_ms),
        "scan_user": str(raw_config.get("scan_user") or ""),
        "scan_password": str(raw_config.get("scan_password") or ""),
        "auto_precompute": bool(raw_config.get("auto_precompute", True)),
    }


def resolve_and_check_path(path, allowed_roots):
    """Canonicalize `path` and verify it is inside one of `allowed_roots`.

    Returns the canonical (realpath-resolved, symlinks included) path on
    success. Raises PathNotAllowedError on any attempt to escape the sandbox
    (../ traversal, symlink escape, etc) per FR-007/SC-004.
    """
    if not path:
        raise PathNotAllowedError("path is required")
    real = os.path.realpath(path)
    for root in allowed_roots:
        root = root.rstrip(os.sep)
        if real == root or real.startswith(root + os.sep):
            return real
    raise PathNotAllowedError(f"path '{path}' is outside all configured allowed roots")


def _is_excluded(name, patterns):
    return any(fnmatch.fnmatch(name, pat) for pat in patterns)


def _iso(ts):
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


# Sort modes supported by list_children. Keys are documented in the API
# contract and consumed by the frontend's sort dropdown.
_SORT_FIELDS = {
    "size": ("size_bytes", True, -1),
    "size_asc": ("size_bytes", False, -1),
    "size_on_disk": ("size_on_disk_bytes", True, -1),
    "size_on_disk_asc": ("size_on_disk_bytes", False, -1),
    "modified": ("modified_at", True, ""),
    "modified_asc": ("modified_at", False, ""),
    "name": ("name", False, None),
    "name_desc": ("name", True, None),
}
SORT_MODES = set(_SORT_FIELDS.keys())


def _sort_nodes(nodes, sort):
    spec = _SORT_FIELDS.get(sort, _SORT_FIELDS["size"])
    field, reverse, missing = spec

    def _key(n):
        val = n.get(field)
        if val is None:
            return (1, missing)
        if field == "name":
            return (0, val.lower())
        if field == "modified_at":
            # ISO-8601 strings sort correctly as text; missing last.
            return (0, val)
        return (0, val)

    nodes.sort(key=_key, reverse=reverse)


# Path to the long-lived privileged scandir helper. Started once and reused
# across all privileged directory listings so a scan only pays the sudo/python
# startup cost once, not once per directory.
_HELPER_PATH = os.path.join(os.path.dirname(__file__), "priv_scan.py")
_PRIVILEGED_SCANNERS = {}


class _FakeEntry:
    """Stand-in for os.DirEntry returned by a privileged scandir subprocess."""

    __slots__ = ("name", "path", "_stat")

    def __init__(self, name, path, stat):
        self.name = name
        self.path = path
        self._stat = stat

    def __str__(self):
        return f"_FakeEntry({self.name!r})"

    __repr__ = __str__

    def stat(self, follow_symlinks=False):
        return self._stat


def _make_stat(d):
    """Build a stat-like object from a JSON-serialized stat dict."""
    return SimpleNamespace(
        st_mode=d["st_mode"],
        st_size=d["st_size"],
        st_mtime=d["st_mtime"],
        st_blocks=d.get("st_blocks"),
    )


class _PrivilegedScanner:
    """Long-lived sudo-wrapped scandir process for a (user, password)."""

    def __init__(self, config):
        self._config = config
        self._proc = None
        self._lock = threading.Lock()

    def _ensure_started(self):
        if self._proc is not None and self._proc.poll() is None:
            return
        scan_user = self._config.get("scan_user")
        scan_password = self._config.get("scan_password") or ""
        log.info("[disk-usage-explorer] starting privileged helper user=%s", scan_user)
        if scan_password:
            cmd = ["sudo", "-S", "-u", scan_user, sys.executable, _HELPER_PATH]
            input_data = scan_password + "\n"
        else:
            cmd = ["sudo", "-n", "-u", scan_user, sys.executable, _HELPER_PATH]
            input_data = None
        self._proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )
        if input_data is not None:
            self._proc.stdin.write(input_data)
            self._proc.stdin.flush()

    def scandir(self, path, excluded=None):
        with self._lock:
            self._ensure_started()
            req = json.dumps({"path": path, "excluded": excluded or []})
            try:
                self._proc.stdin.write(req + "\n")
                self._proc.stdin.flush()
                line = self._proc.stdout.readline()
            except (OSError, ValueError) as e:
                raise OSError(f"privileged helper communication failed: {e}") from e
            if not line:
                raise OSError("privileged helper closed stream")
            try:
                resp = json.loads(line)
            except json.JSONDecodeError as e:
                raise OSError(f"privileged helper returned invalid JSON: {e}") from e
            if "error" in resp:
                raise OSError(resp["error"])
            return [_FakeEntry(d["name"], d["path"], _make_stat(d)) for d in resp["entries"]]

    def close(self):
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                try:
                    self._proc.stdin.write(json.dumps({"cmd": "close"}) + "\n")
                    self._proc.stdin.flush()
                    self._proc.wait(timeout=2)
                except Exception:
                    pass
                try:
                    self._proc.terminate()
                    self._proc.wait(timeout=2)
                except Exception:
                    pass


def _get_scanner(config):
    """Return (creating if needed) the privileged scanner for this config."""
    key = (config.get("scan_user"), config.get("scan_password") or "")
    if key not in _PRIVILEGED_SCANNERS:
        _PRIVILEGED_SCANNERS[key] = _PrivilegedScanner(config)
    return _PRIVILEGED_SCANNERS[key]


@atexit.register
def _close_scanners():
    for scanner in _PRIVILEGED_SCANNERS.values():
        scanner.close()


@contextmanager
def _scandir_iter(path, config=None):
    """Yield an iterator over directory entries, using sudo when configured."""
    privileged = bool(config and config.get("scan_user"))
    log.debug("[disk-usage-explorer] scandir path=%s privileged=%s", path, privileged)
    if not privileged:
        try:
            with os.scandir(path) as it:
                yield it
        except OSError as e:
            log.warning("[disk-usage-explorer] unprivileged scandir denied for %s: %s", path, e)
            raise
    else:
        try:
            scanner = _get_scanner(config)
            entries = scanner.scandir(path, config.get("excluded_patterns") or [])
            log.debug("[disk-usage-explorer] privileged scandir returned %s entries for %s", len(entries), path)
            yield entries
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as e:
            log.warning("[disk-usage-explorer] privileged scandir failed for %s: %s", path, e)
            raise OSError(f"privileged scandir failed for {path}: {e}") from e


def _classify_entry(entry):
    """Return (type, stat_result) for a directory entry.

    Uses DirEntry.stat so symlinks are never auto-followed.
    """
    try:
        lst = entry.stat(follow_symlinks=False)
    except OSError as e:
        log.warning("[disk-usage-explorer] stat failed for %s: %s", entry.path, e)
        return None, None
    if stat_module.S_ISLNK(lst.st_mode):
        return "symlink", lst
    if stat_module.S_ISDIR(lst.st_mode):
        return "directory", lst
    if stat_module.S_ISREG(lst.st_mode):
        return "file", lst
    return "other", lst


def _size_on_disk(lst):
    blocks = getattr(lst, "st_blocks", None)
    return blocks * 512 if blocks is not None else None


def _base_node(entry_path, name, node_type, lst):
    return {
        "path": entry_path,
        "name": name,
        "type": node_type,
        "size_bytes": None,
        "size_on_disk_bytes": None,
        "modified_at": _iso(lst.st_mtime) if lst is not None else None,
        "accessible": True,
        "symlink_target": None,
        "child_count": None,
        "scan_status": "unscanned",
    }


def _node_from_entry(entry, config):
    """Build a Filesystem Node dict (data-model.md) for a single directory entry.

    Directory nodes are returned with size_bytes still None here; the caller
    (list_children) fills in computed/cached sizes separately so this
    function stays cheap and side-effect free.
    """
    node_type, lst = _classify_entry(entry)
    if node_type is None:
        return {
            "path": entry.path,
            "name": entry.name,
            "type": "other",
            "size_bytes": None,
            "size_on_disk_bytes": None,
            "modified_at": None,
            "accessible": False,
            "symlink_target": None,
            "child_count": None,
            "scan_status": "unscanned",
        }

    node = _base_node(entry.path, entry.name, node_type, lst)

    if node_type == "symlink":
        try:
            node["symlink_target"] = os.readlink(entry.path)
        except OSError as e:
            log.debug("[disk-usage-explorer] readlink failed for %s: %s", entry.path, e)
            node["accessible"] = False
        # Deliberately left as None (not lst.st_size, the tiny inode size of
        # the link itself): compute_size() never follows symlinks into their
        # target's contents, so a symlink contributes nothing to a parent's
        # cumulative size — reporting its own inode size here would skew
        # percent_of_parent sums away from ~100% for no useful information.
        node["size_bytes"] = None
        node["scan_status"] = "complete"
        return node

    if node_type == "file":
        node["size_bytes"] = lst.st_size
        node["size_on_disk_bytes"] = _size_on_disk(lst)
        node["scan_status"] = "complete"
        return node

    if node_type == "directory":
        try:
            with _scandir_iter(entry.path, config) as it:
                node["child_count"] = sum(1 for _ in it)
        except OSError as e:
            log.debug("[disk-usage-explorer] scandir(count) failed for %s: %s", entry.path, e)
            node["accessible"] = False
        return node

    return node


def compute_size(path, budget_ms, config=None):
    """Iteratively walk `path`'s subtree (never following symlinks) summing sizes.

    Returns (size_bytes, entry_count, partial: bool). Stops early (partial=True)
    if the wall-clock budget is exceeded or any subtree can't be read, rather
    than failing the whole computation (FR-009, FR-014).
    """
    start = time.monotonic()
    budget_s = max(budget_ms, 0) / 1000.0
    log.debug("[disk-usage-explorer] compute_size start path=%s budget_ms=%s", path, budget_ms)
    total = 0
    count = 0
    partial = False
    stack = [path]

    while stack:
        if time.monotonic() - start > budget_s:
            partial = True
            break
        current = stack.pop()
        try:
            with _scandir_iter(current, config) as it:
                entries = list(it)
        except OSError as e:
            log.warning("[disk-usage-explorer] compute_size: cannot read %s: %s", current, e)
            partial = True
            continue
        for entry in entries:
            try:
                lst = entry.stat(follow_symlinks=False)
            except OSError as e:
                log.debug("[disk-usage-explorer] compute_size: cannot stat %s: %s", entry.path, e)
                partial = True
                continue
            if stat_module.S_ISLNK(lst.st_mode):
                # Never auto-descend into a symlink's target (FR-010) — count
                # the link itself but don't add its target's size.
                count += 1
                continue
            if stat_module.S_ISDIR(lst.st_mode):
                stack.append(entry.path)
                continue
            total += lst.st_size
            count += 1

    return total, count, partial


def get_or_compute_size(path, config, force=False, deadline=None):
    """Return (size_bytes, entry_count, scan_status) for `path`.

    Uses the cache unless `force` is set or the cached entry is stale. When a
    shared `deadline` (a time.monotonic() timestamp) is supplied and already
    passed, returns without computing so a single request can't blow past its
    overall time budget while sizing many sibling directories (SC-002/SC-006).
    """
    ttl_s = config["cache_ttl_s"]
    if not force:
        cached, status = _cache_get(path, ttl_s)
        if cached is not None and status != "stale":
            return cached.size_bytes, cached.entry_count, status

    if deadline is not None and time.monotonic() >= deadline:
        return None, None, "unscanned"

    remaining_ms = config["scan_budget_ms"]
    if deadline is not None:
        remaining_ms = max(0, (deadline - time.monotonic()) * 1000)

    size_bytes, entry_count, partial = compute_size(path, remaining_ms, config)
    _cache_set(path, size_bytes, entry_count, partial)
    return size_bytes, entry_count, "partial" if partial else "complete"


def list_children(path, config, sort="size", page=1, page_size=None):
    """List the immediate children of `path` (already validated/canonical).

    Returns a dict matching the GET /list response contract in
    specs/001-filesystem-treeview/contracts/api.md, including the queried
    directory's own cumulative size/scan_status and a percent_of_parent for
    each returned child.
    """
    max_page_size = config["max_children_per_page"]
    page_size = min(page_size, max_page_size) if page_size else max_page_size
    page_size = max(1, page_size)
    page = max(1, page)
    log.debug("[disk-usage-explorer] list_children path=%s sort=%s page=%s", path, sort, page)

    try:
        with _scandir_iter(path, config) as it:
            raw_entries = [(e.name, e.path, e) for e in it]
    except OSError as e:
        log.warning("[disk-usage-explorer] list_children denied for %s: %s", path, e)
        return {
            "path": path,
            "type": "directory",
            "accessible": False,
            "total_children": 0,
            "page": page,
            "page_size": page_size,
            "size_bytes": None,
            "scan_status": "unscanned",
            "children": [],
        }

    excluded = config.get("excluded_patterns") or []
    filtered = [(name, p, e) for name, p, e in raw_entries if not _is_excluded(name, excluded)]

    nodes = [_node_from_entry(e, config) for name, p, e in filtered]

    # Shared time budget for computing/refreshing directory-child sizes on
    # this page, so a directory with many large subfolders can't make a
    # single expand-request run unbounded (FR-002, SC-002, SC-006).
    deadline = time.monotonic() + config["scan_budget_ms"] / 1000.0

    _sort_nodes(nodes, sort)

    total = len(nodes)
    start = (page - 1) * page_size
    page_nodes = nodes[start : start + page_size]

    for node in page_nodes:
        if node["type"] == "directory" and node["accessible"]:
            size_bytes, _entry_count, status = get_or_compute_size(node["path"], config, deadline=deadline)
            node["size_bytes"] = size_bytes
            node["scan_status"] = status

    _sort_nodes(page_nodes, sort)

    self_size, _self_count, self_status = get_or_compute_size(path, config, deadline=deadline)

    for node in page_nodes:
        node["percent_of_parent"] = round((node["size_bytes"] or 0) / self_size, 4) if self_size else 0.0

    return {
        "path": path,
        "type": "directory",
        "accessible": True,
        "total_children": total,
        "page": page,
        "page_size": page_size,
        "size_bytes": self_size,
        "scan_status": self_status,
        "children": page_nodes,
    }


def top_entries(path, config, n=20):
    """Return the top-N largest files and directories under `path`.

    Performs a bounded recursive walk respecting `scan_budget_ms`.  The result
    is sorted largest-first and includes a `percent_of_total`.  The first entry
    is always the queried root directory itself.
    """
    budget_s = config["scan_budget_ms"] / 1000.0
    start = time.monotonic()
    deadline = start + budget_s
    excluded = config.get("excluded_patterns") or []

    # file_records: (path, name, size)
    file_records = []
    # dir_children[dir_path] = list of child dir paths discovered
    # dir_files[dir_path] = list of (name, size) for immediate files
    dir_children = {path: []}
    dir_files = {path: []}
    partial = False

    stack = [path]
    while stack:
        if time.monotonic() > deadline:
            partial = True
            break
        current = stack.pop()
        dir_children.setdefault(current, [])
        dir_files.setdefault(current, [])
        try:
            with _scandir_iter(current, config) as it:
                entries = list(it)
        except OSError:
            partial = True
            continue
        for entry in entries:
            if _is_excluded(entry.name, excluded):
                continue
            try:
                lst = entry.stat(follow_symlinks=False)
            except OSError:
                partial = True
                continue
            if stat_module.S_ISLNK(lst.st_mode):
                continue
            if stat_module.S_ISDIR(lst.st_mode):
                dir_children[current].append(entry.path)
                dir_children.setdefault(entry.path, [])
                dir_files.setdefault(entry.path, [])
                stack.append(entry.path)
            elif stat_module.S_ISREG(lst.st_mode):
                dir_files[current].append((entry.name, lst.st_size))
                file_records.append((entry.path, entry.name, lst.st_size))

    # Compute cumulative directory sizes from deepest to shallowest so parents
    # naturally include the sizes of already-summed children.
    dir_sizes = dict.fromkeys(dir_children, 0)
    for d in sorted(dir_children, key=len, reverse=True):
        total = sum(s for _, s in dir_files.get(d, []))
        total += sum(dir_sizes.get(c, 0) for c in dir_children.get(d, []))
        dir_sizes[d] = total

    results = []
    for d, size in dir_sizes.items():
        if d == path:
            continue
        results.append({
            "path": d,
            "name": os.path.basename(d) or d,
            "type": "directory",
            "size_bytes": size,
            "size_on_disk_bytes": None,
            "scan_status": "partial" if partial else "complete",
        })

    for p, name, size in file_records:
        results.append({
            "path": p,
            "name": name,
            "type": "file",
            "size_bytes": size,
            "size_on_disk_bytes": None,
            "scan_status": "complete",
        })

    _sort_nodes(results, "size")

    total_size = dir_sizes.get(path, 0)
    for r in results:
        r["percent_of_total"] = round((r["size_bytes"] or 0) / total_size, 4) if total_size else 0.0

    return {
        "path": path,
        "total_size": total_size,
        "count": len(results),
        "scan_status": "partial" if partial else "complete",
        "entries": results[:n],
    }


def type_breakdown(path, config):
    """Return a breakdown of file extensions by total size under `path`.

    Walks files (not symlinks, not directories) with the shared scan budget.
    Files without an extension are grouped under `(no extension)`.
    """
    budget_s = config["scan_budget_ms"] / 1000.0
    start = time.monotonic()
    deadline = start + budget_s
    excluded = config.get("excluded_patterns") or []
    partial = False

    groups = {}
    stack = [path]
    while stack:
        if time.monotonic() > deadline:
            partial = True
            break
        current = stack.pop()
        try:
            with _scandir_iter(current, config) as it:
                entries = list(it)
        except OSError:
            partial = True
            continue
        for entry in entries:
            if _is_excluded(entry.name, excluded):
                continue
            try:
                lst = entry.stat(follow_symlinks=False)
            except OSError:
                partial = True
                continue
            if stat_module.S_ISLNK(lst.st_mode):
                continue
            if stat_module.S_ISDIR(lst.st_mode):
                stack.append(entry.path)
            elif stat_module.S_ISREG(lst.st_mode):
                name = entry.name
                ext = os.path.splitext(name)[1].lower()
                if not ext:
                    ext = "(no extension)"
                rec = groups.setdefault(ext, {"extension": ext, "count": 0, "size_bytes": 0})
                rec["count"] += 1
                rec["size_bytes"] += lst.st_size

    results = sorted(groups.values(), key=lambda r: r["size_bytes"], reverse=True)
    return {
        "path": path,
        "count": len(results),
        "scan_status": "partial" if partial else "complete",
        "types": results,
    }


def precompute_directory_sizes(path, config, progress=None):
    """Pre-compute and cache cumulative sizes for every directory under `path`.

    This makes subsequent treeview expansions instant because list_children()
    will find a warm cache entry for every directory. The walk respects the
    same exclusions and symlink rules as compute_size(). A shared `progress`
    dict is updated so callers (e.g. a background thread) can report progress
    to a UI.
    """
    if progress is None:
        progress = {}
    progress["status"] = "running"
    progress["started_at"] = datetime.now(timezone.utc).isoformat()
    progress["directories"] = 0
    progress["files"] = 0
    progress["bytes"] = 0
    progress["current_path"] = ""
    progress["complete"] = False
    progress["stopped_path"] = None
    progress["reason"] = "running"

    budget_ms = config.get("full_scan_budget_ms", DEFAULT_FULL_SCAN_BUDGET_MS)
    budget_s = max(0, budget_ms) / 1000.0
    start = time.monotonic()
    deadline = start + budget_s
    progress["budget_ms"] = budget_ms
    excluded = config.get("excluded_patterns") or []
    partial = False

    log.info("[disk-usage-explorer] precompute started: root=%s budget_ms=%s deadline=%s", path, budget_ms, deadline)

    dir_children = {path: []}
    dir_files = {path: []}
    files_scanned = 0
    dirs_scanned = 0
    total_bytes = 0

    stack = [path]
    while stack:
        if time.monotonic() > deadline:
            partial = True
            break
        current = stack.pop()
        progress["current_path"] = current
        dirs_scanned += 1
        progress["directories"] = dirs_scanned
        dir_children.setdefault(current, [])
        dir_files.setdefault(current, [])
        try:
            with _scandir_iter(current, config) as it:
                entries = list(it)
        except OSError:
            continue
        for entry in entries:
            if _is_excluded(entry.name, excluded):
                continue
            try:
                lst = entry.stat(follow_symlinks=False)
            except OSError:
                continue
            if stat_module.S_ISLNK(lst.st_mode):
                continue
            if stat_module.S_ISDIR(lst.st_mode):
                dir_children[current].append(entry.path)
                dir_children.setdefault(entry.path, [])
                dir_files.setdefault(entry.path, [])
                stack.append(entry.path)
            elif stat_module.S_ISREG(lst.st_mode):
                dir_files[current].append(lst.st_size)
                files_scanned += 1
                total_bytes += lst.st_size
                progress["files"] = files_scanned
                progress["bytes"] = total_bytes

    # Compute cumulative sizes bottom-up so parent sizes include children.
    elapsed_s = time.monotonic() - start
    dir_sizes = dict.fromkeys(dir_children, 0)
    for d in sorted(dir_children, key=len, reverse=True):
        total = sum(dir_files.get(d, []))
        total += sum(dir_sizes.get(c, 0) for c in dir_children.get(d, []))
        dir_sizes[d] = total
        # Cache the cumulative size for this directory (not partial unless the
        # overall walk was stopped early, which is reflected in progress).
        _cache_set(d, total, len(dir_files.get(d, [])) + len(dir_children.get(d, [])), False)

    elapsed_ms = elapsed_s * 1000
    progress["elapsed_ms"] = elapsed_ms
    if partial:
        progress["reason"] = "time_budget_exceeded"
        progress["stopped_path"] = stack[-1] if stack else None
    else:
        progress["reason"] = "completed"
        progress["stopped_path"] = None

    progress["status"] = "partial" if partial else "complete"
    progress["complete"] = True
    progress["completed_at"] = datetime.now(timezone.utc).isoformat()
    progress["bytes"] = dir_sizes.get(path, 0)
    progress["directories"] = dirs_scanned
    progress["files"] = files_scanned
    log.info(
        "[disk-usage-explorer] precompute finished: status=%s reason=%s directories=%s files=%s elapsed_ms=%s budget_ms=%s",
        progress["status"],
        progress["reason"],
        dirs_scanned,
        files_scanned,
        elapsed_ms,
        budget_ms,
    )
    return dir_sizes.get(path, 0)
