# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/api/plugins.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: ProxmoxVEx Plugin Management API - Layer 6
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
ProxmoxVEx Plugin Management API - Layer 6
Auto-discover plugins from plugins/ dir, enable/disable via Settings

Plugins register route handlers via register_plugin_route() which are dispatched
through a single catch-all Flask route. This avoids Flask's restriction on
registering blueprints after the first request — plugins can be loaded at runtime.
"""

import concurrent.futures
import contextlib
import gzip
import importlib.util
import json
import logging
import os
import re
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, current_app, jsonify, make_response, request, send_file

from ProxmoxVEx.api.plugin_data_bridge import get_live_data
from ProxmoxVEx.constants import PLUGINS_DIR
from ProxmoxVEx.core.db import get_db
from ProxmoxVEx.services.licensing import LicensingService
from ProxmoxVEx.utils.audit import log_audit
from ProxmoxVEx.utils.auth import require_auth

bp = Blueprint("plugins", __name__)

# (#381 pentest) - strict path-segment whitelist for frontend_route
# values. One segment between slashes; alphanumerics + . _ - only.
_SAFE_PATH_SEG = re.compile(r"^[A-Za-z0-9_.-]+$")

# in-memory registries — guarded by _plugin_lock to prevent
# "dictionary changed size during iteration" crashes that made plugins
# appear to vanish under load (several users reported this).
_plugin_lock = threading.RLock()
_loaded_plugins = {}  # {plugin_id: module}
_plugin_routes = {}  # {plugin_id: {path: handler_fn}}

# Caching for plugin loader to reduce repeated disk scans.
_plugin_loader_cache = {}


def get_plugin_loader_cache(key, loader):
    """Return a cached plugin loader result or build it."""
    if key in _plugin_loader_cache:
        return _plugin_loader_cache[key]
    result = loader()
    _plugin_loader_cache[key] = result
    return result


def invalidate_plugin_loader_cache(key=None):
    """Invalidate all or one plugin loader cache entry."""
    global _plugin_loader_cache
    if key is None:
        _plugin_loader_cache = {}
    else:
        _plugin_loader_cache.pop(key, None)


class LazyPluginLoader:
    """Lazy loader that defers plugin module loading until first requested."""

    def __init__(self, plugin_id, load_factory):
        self.plugin_id = plugin_id
        self._load_factory = load_factory
        self._module = None

    def get(self):
        if self._module is None:
            self._module = self._load_factory()
        return self._module


def load_plugin_lazy(plugin_id, load_factory):
    """Create a lazy wrapper for loading a single plugin."""
    return LazyPluginLoader(plugin_id, load_factory)


# In-memory index for fast plugin lookups.
_plugin_index = {}


def build_plugin_index(plugins):
    """Build an in-memory inverted index from plugin manifests."""
    index = {}
    for i, plugin in enumerate(plugins):
        tokens = [str(plugin.get("_id", "")).lower()]
        for key in ("name", "category"):
            value = plugin.get(key)
            if value:
                tokens.append(str(value).lower())
        for token in set(tokens):
            index.setdefault(token, []).append(i)
    return index


def compress_plugins(data):
    """Compress plugin data with gzip."""
    return gzip.compress(json.dumps(data).encode("utf-8"))


def decompress_plugins(compressed):
    """Decompress gzip-compressed plugin data."""
    return json.loads(gzip.decompress(compressed).decode("utf-8"))


# Connection pool cache for plugin loader resources.
_plugin_connection_pool = {}


def get_plugin_connection_pool(key, factory):
    """Return a cached plugin connection or build one."""
    if key in _plugin_connection_pool:
        return _plugin_connection_pool[key]
    conn = factory()
    _plugin_connection_pool[key] = conn
    return conn


# ThreadPoolExecutor for async plugin loader tasks.
_plugin_loader_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)


def load_plugins_async(load_fn, plugin_ids):
    """Load multiple plugins concurrently using a thread pool."""
    results = {}
    futures = {pid: _plugin_loader_executor.submit(load_fn, pid) for pid in plugin_ids}
    for pid, future in futures.items():
        try:
            results[pid] = future.result()
        except Exception as e:
            results[pid] = (False, str(e))
    return results


class PluginEntry:
    """Memory-optimised plugin manifest entry."""

    __slots__ = ("_id", "name", "category", "version", "enabled")

    def __init__(self, _id, name, category, version, enabled):
        self._id = _id
        self.name = name
        self.category = category
        self.version = version
        self.enabled = enabled


def compact_plugins(plugins):
    """Convert raw plugin dicts to memory-optimised PluginEntry objects."""
    return [
        PluginEntry(
            p.get("_id"),
            p.get("name"),
            p.get("category"),
            p.get("version"),
            p.get("enabled", False),
        )
        for p in plugins
    ]


# Version timestamp for incremental plugin loader updates.
plugin_index_version = 0


def update_plugins_incrementally(existing, new_plugins, removed_ids):
    """Update the plugin list with new/changed plugins and removed ids."""
    global plugin_index_version
    lookup = {p.get("_id"): p for p in existing if p.get("_id")}
    for plugin in new_plugins:
        key = plugin.get("_id")
        if key:
            lookup[key] = plugin
    for rid in removed_ids:
        lookup.pop(rid, None)
    plugin_index_version += 1
    return list(lookup.values())


# CodeQL flagged plugin_id as a path-injection vector (admin-only
# endpoints but still). Every endpoint below now passes plugin_id through this
# validator before touching the filesystem. Allowed chars match what
# `_discover_plugins` accepts — directory-name-safe ASCII only, no dots.
_PLUGIN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

# (#015) cache of explicitly allow-listed untrusted plugin IDs, loaded from
# config/untrusted_plugins.json once per process. Empty by default so untrusted
# plugins cannot run until an admin explicitly approves them.
_ALLOWED_UNTRUSTED: set[str] = set()
_ALLOWED_UNTRUSTED_LOADED = False


def _is_untrusted_allowed(plugin_id: str) -> bool:
    """Return True if an untrusted plugin ID has been explicitly approved."""
    return plugin_id in _load_untrusted_allowlist()


def _load_untrusted_allowlist() -> set[str]:
    """Load the set of explicitly approved untrusted plugin IDs."""
    global _ALLOWED_UNTRUSTED, _ALLOWED_UNTRUSTED_LOADED
    if _ALLOWED_UNTRUSTED_LOADED:
        return _ALLOWED_UNTRUSTED
    _ALLOWED_UNTRUSTED_LOADED = True
    try:
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        allowlist_path = os.path.join(project_root, "plugins", "untrusted_plugins.json")
        with open(allowlist_path) as f:
            data = json.load(f)
        _ALLOWED_UNTRUSTED = set(data.get("allowed_untrusted", []))
    except Exception:
        # If the file is missing or malformed, default to deny.
        _ALLOWED_UNTRUSTED = set()
    return _ALLOWED_UNTRUSTED


def _valid_plugin_id(pid):
    return isinstance(pid, str) and bool(_PLUGIN_ID_RE.match(pid))


def _license_gate(plugin_id):
    """Check the active license tier before dispatching to a plugin.

    Re-checked on every request (not just at load time) so a tier downgrade
    or expiry blocks new plugin activity without needing a restart or a
    manual disable/enable cycle - the plugin module can stay loaded, but
    further requests are refused until the tier covers it again.
    Returns None if allowed, or a (response, status) tuple if blocked.
    """
    try:
        service = LicensingService()
        if service.can_use_plugin(get_db(), plugin_id):
            return None
        from ProxmoxVEx.models.plugins import get_plugin_tier_requirement

        required = get_plugin_tier_requirement(plugin_id)
        return (
            jsonify({
                "error": "License upgrade required for this plugin",
                "required_tier": required,
            }),
            402,
        )
    except Exception as e:
        # Fail open on licensing-service errors so a licensing outage doesn't
        # take down unrelated plugin functionality; the load-time check and
        # the 24h grace period in LicensingService already provide the real
        # enforcement backstop.
        logging.warning(f"[PLUGINS] License guard skipped for {plugin_id}: {e}")
        return None


# ---- Plugin Route Registration (used by plugins) ----


def register_plugin_route(plugin_id, path, handler):
    """Register a route handler for a plugin. Called from plugin's register() function."""
    with _plugin_lock:
        _plugin_routes.setdefault(plugin_id, {})[path] = handler


# ---- Live data bridge for plugin UIs ----


@bp.route("/api/plugins/<plugin_id>/api/live/<resource>", methods=["GET"])
@require_auth(perms=["plugins.view"])
def plugin_live(plugin_id, resource):
    """Return live cluster data for plugin UIs (clusters, nodes, vms, etc.)."""
    if not _valid_plugin_id(plugin_id):
        return jsonify({"error": "Invalid plugin id"}), 400
    with _plugin_lock:
        if plugin_id not in _loaded_plugins:
            return jsonify({"error": "Plugin not loaded"}), 404
    blocked = _license_gate(plugin_id)
    if blocked:
        return blocked
    cluster_id = request.args.get("cluster_id", "").strip()
    try:
        data = get_live_data(resource, cluster_id=cluster_id)
        if isinstance(data, dict) and data.get("error"):
            return jsonify(data), 400
        return jsonify(data)
    except Exception as e:
        logging.error(f"[PLUGINS] live/{plugin_id}/{resource} error: {e}")
        return jsonify({"error": "Live data request failed"}), 500


# ---- Plugin UI serving (shared base stylesheet injection) ----


_PLUGIN_UI_CSS_LINK = '<link rel="stylesheet" href="/static/css/plugin-ui.css" />'
_PLUGIN_UI_THEME_SCRIPT = '<script src="/static/js/plugin-theme.js"></script>'


def _serve_plugin_ui(plugin_id):
    """Serve a plugin's ui.html with the shared theme bridge and stylesheet injected.

    The theme bridge runs first so the plugin's CSS (both the shared
    plugin-ui.css and the plugin's own ui.css) resolves against the current
    application theme variables. This gives every plugin a uniform look that
    follows the theme/colour selected in the main app.
    """
    ui_path = Path(PLUGINS_DIR) / plugin_id / "ui.html"
    if not ui_path.exists():
        return jsonify({"error": "UI not found"}), 404
    try:
        html = ui_path.read_text(encoding="utf-8")
    except Exception as e:
        logging.error("[PLUGINS] Failed to read %s: %s", ui_path, e)
        return jsonify({"error": "Failed to read UI"}), 500

    # Replace any per-request cache-buster token in the plugin HTML so that
    # references like ui.css?v=__CACHE_BUST__ become unique on every load.
    # This defeats service workers and reverse proxies that might otherwise
    # serve a stale asset after a plugin UI fix.
    bust = str(int(datetime.now(timezone.utc).timestamp()))
    html = html.replace("__CACHE_BUST__", bust)

    # Insert the shared theme bridge script and stylesheet at the start of
    # <head>. The script runs first and sets CSS custom properties from the
    # parent window theme, so every plugin (including its shared and own CSS)
    # renders with the active application theme. Skip each asset if the plugin
    # author already referenced it manually.
    if _PLUGIN_UI_THEME_SCRIPT not in html and _PLUGIN_UI_CSS_LINK not in html:
        if "<head>" in html:
            html = html.replace(
                "<head>",
                f"<head>\n{_PLUGIN_UI_THEME_SCRIPT}\n{_PLUGIN_UI_CSS_LINK}",
                1,
            )
        elif "</head>" in html:
            html = html.replace(
                "</head>",
                f"{_PLUGIN_UI_THEME_SCRIPT}\n{_PLUGIN_UI_CSS_LINK}\n</head>",
                1,
            )
        else:
            # Fallback: prepend to the very top if the html is not head-closed.
            html = f"{_PLUGIN_UI_THEME_SCRIPT}\n{_PLUGIN_UI_CSS_LINK}\n{html}"
    elif _PLUGIN_UI_THEME_SCRIPT not in html:
        # CSS already included; add the missing theme bridge before it.
        html = html.replace(_PLUGIN_UI_CSS_LINK, f"{_PLUGIN_UI_THEME_SCRIPT}\n{_PLUGIN_UI_CSS_LINK}", 1)
    elif _PLUGIN_UI_CSS_LINK not in html:
        # Theme bridge already included; add the missing CSS after it.
        html = html.replace(_PLUGIN_UI_THEME_SCRIPT, f"{_PLUGIN_UI_THEME_SCRIPT}\n{_PLUGIN_UI_CSS_LINK}", 1)
    resp = make_response(html, 200, {"Content-Type": "text/html"})
    # Plugin UI HTML is generated per-request; do not cache it so new asset
    # references and injected theme bridge changes are picked up immediately.
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


# ---- Catch-all route for plugin API calls ----


@bp.route("/api/plugins/<plugin_id>/api/<path:subpath>", methods=["GET", "POST", "PUT", "DELETE"])
@require_auth(perms=["plugins.view"])
def plugin_proxy(plugin_id, subpath):
    """Dispatch API requests to loaded plugins"""
    if not _valid_plugin_id(plugin_id):
        return jsonify({"error": "Invalid plugin id"}), 400

    # Serve plugin UI through a common helper so every plugin gets the shared CSS.
    if subpath == "ui" and request.method == "GET":
        with _plugin_lock:
            if plugin_id not in _loaded_plugins:
                return jsonify({"error": "Plugin not loaded"}), 404
        blocked = _license_gate(plugin_id)
        if blocked:
            from ProxmoxVEx.models.plugins import get_plugin_tier_requirement

            required = get_plugin_tier_requirement(plugin_id)
            html = (
                "<html><body style='font-family:sans-serif;padding:2rem;color:#ccc;"
                "background:#1a1a1a'><h2>Upgrade required</h2>"
                f"<p>This plugin requires the <strong>{required}</strong> license tier.</p></body></html>"
            )
            return make_response(html, 402, {"Content-Type": "text/html"})
        return _serve_plugin_ui(plugin_id)

    with _plugin_lock:
        if plugin_id not in _loaded_plugins:
            return jsonify({"error": "Plugin not loaded"}), 404
        handler = _plugin_routes.get(plugin_id, {}).get(subpath)

    blocked = _license_gate(plugin_id)
    if blocked:
        return blocked

    if not handler:
        # Serve any sibling .css/.js asset from the plugin directory. This covers
        # the standard ui.css/ui.js as well as named assets for additional pages
        # such as status.css or portal.js. Path traversal is blocked by _safe_plugin_path.
        if request.method == "GET" and subpath.endswith((".css", ".js")):
            static_path = _safe_plugin_path(plugin_id, subpath)
            if not static_path or not static_path.is_file():
                return jsonify({"error": "Route not found"}), 404
            # SAST: verify the resolved file is still under the plugins root.
            root = Path(PLUGINS_DIR).resolve()
            try:
                if os.path.commonpath([str(static_path), str(root)]) != str(root):
                    return jsonify({"error": "Route not found"}), 404
            except ValueError:
                return jsonify({"error": "Route not found"}), 404
            mimetype = "text/css" if subpath.endswith(".css") else "text/javascript"
            resp = send_file(static_path, mimetype=mimetype)
            # Plugin CSS/JS assets are served from source and can change between
            # releases or hotfixes; tell browsers and any reverse proxy not to
            # cache them so UI fixes are picked up immediately.
            resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            resp.headers["Pragma"] = "no-cache"
            resp.headers["Expires"] = "0"
            return resp
        return jsonify({"error": "Route not found"}), 404

    try:
        result = handler()
        if isinstance(result, (dict, list)):
            return jsonify(result)
        # snyk:ignore:Cross-site Scripting (XSS)
        # Plugin output is generated by the loaded plugin code, not raw user input.
        return result
    except Exception as e:
        logging.error(f"[PLUGINS] {plugin_id}/{subpath} error: {e}")
        return jsonify({"error": "Plugin request failed"}), 500


# ---- Plugin i18n serving ----


@bp.route("/api/plugins/<plugin_id>/i18n/<lang>.json", methods=["GET"])
@require_auth(perms=["plugins.view"])
def plugin_i18n(plugin_id, lang):
    """Serve a plugin's per-language i18n JSON from its i18n/ directory."""
    if not _valid_plugin_id(plugin_id):
        return jsonify({"error": "Invalid plugin id"}), 400
    if not re.match(r"^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)*$", lang, re.IGNORECASE):
        return jsonify({"error": "Invalid language"}), 400
    with _plugin_lock:
        if plugin_id not in _loaded_plugins:
            return jsonify({"error": "Plugin not loaded"}), 404
    i18n_path = Path(PLUGINS_DIR) / plugin_id / "i18n" / f"{lang}.json"
    if not i18n_path.exists():
        return jsonify({}), 404
    try:
        with open(i18n_path, encoding="utf-8") as f:
            data = json.load(f)
        resp = jsonify(data)
        # Plugin i18n JSON can change between releases/hotfixes; prevent caching
        # so updated translations are always served immediately.
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp
    except Exception as e:
        logging.error("[PLUGINS] i18n/%s/%s.json error: %s", plugin_id, lang, e)
        return jsonify({"error": "Failed to read i18n file"}), 500


# ---- Discovery & State ----


def _discover_plugins():
    """Scan plugins/ dir for subfolders with manifest.json"""
    found = []
    plugins_path = Path(PLUGINS_DIR)
    if not plugins_path.exists():
        return found

    for d in sorted(plugins_path.iterdir()):
        if not d.is_dir() or d.name.startswith(("_", ".")):
            continue
        manifest_file = d / "manifest.json"
        if not manifest_file.exists():
            continue
        try:
            with open(manifest_file) as f:
                meta = json.load(f)
            meta["_id"] = d.name
            meta["_dir"] = str(d)
            meta["_has_init"] = (d / "__init__.py").exists()
            found.append(meta)
        except Exception as e:
            logging.warning(f"[PLUGINS] Bad manifest in {d.name}: {e}")
            found.append({
                "_id": d.name,
                "_dir": str(d),
                "_has_init": False,
                "name": d.name,
                "error": f"Invalid manifest: {e}",
            })

    return found


def _get_plugin_states():
    db = get_db()
    rows = db.query("SELECT plugin_id, enabled, loaded_at, error FROM plugin_state") or []
    return {r["plugin_id"]: dict(r) for r in rows}


def _set_plugin_state(plugin_id, enabled, error=""):
    db = get_db()
    now = datetime.now().isoformat()
    existing = db.query_one("SELECT plugin_id FROM plugin_state WHERE plugin_id = ?", (plugin_id,))
    if existing:
        db.execute(
            "UPDATE plugin_state SET enabled = ?, loaded_at = ?, error = ? WHERE plugin_id = ?",
            (1 if enabled else 0, now, error, plugin_id),
        )
    else:
        db.execute(
            "INSERT INTO plugin_state (plugin_id, enabled, loaded_at, error) VALUES (?, ?, ?, ?)",
            (plugin_id, 1 if enabled else 0, now, error),
        )


# ---- Loading ----


def load_plugin(app, plugin_id):
    """Load a plugin module and call its register() function
    WARNING: Plugins execute arbitrary Python with full process privileges.
    Only load plugins from trusted sources. There is no sandbox.
    Apr 2026: idempotent - if already loaded, return success without re-registering."""
    # (Aikido SAST hardening) - defense-in-depth on plugin_id.
    # All API entry points already validate via _valid_plugin_id, but if a
    # future caller bypasses that we still refuse a path-traversal name here.
    if not _valid_plugin_id(plugin_id):
        return False, "Invalid plugin id"
    # idempotency — re-enable clicks used to double-register routes
    with _plugin_lock:
        if plugin_id in _loaded_plugins:
            return True, ""

    # license tier enforcement - blocks *loading* a plugin the active tier
    # doesn't cover. Request-time dispatch (plugin_proxy/plugin_live) also
    # re-checks on every call so a mid-session downgrade takes effect without
    # needing to unload/reload the plugin.
    try:
        service = LicensingService()
        if not service.can_use_plugin(get_db(), plugin_id):
            from ProxmoxVEx.models.plugins import get_plugin_tier_requirement

            required = get_plugin_tier_requirement(plugin_id)
            return False, f"License upgrade required: this plugin needs the {required} tier"
    except Exception as e:
        logging.warning(f"[PLUGINS] License guard skipped for {plugin_id}: {e}")

    init_file = _safe_plugin_path(plugin_id, "__init__.py")
    if not init_file:
        return False, "Invalid plugin id"
    if not init_file.exists():
        return False, "No __init__.py found"

    # Check manifest for trusted flag - warn if missing
    manifest_path = _safe_plugin_path(plugin_id, "manifest.json")
    is_trusted = False
    if manifest_path and manifest_path.exists():
        root = Path(PLUGINS_DIR).resolve()
        if not manifest_path.is_relative_to(root):
            return False, "Invalid plugin manifest path"
        try:
            with manifest_path.open() as f:
                manifest = json.load(f)
            # Author prefix is the legacy marker; an explicit `trusted`
            # boolean in the manifest is authoritative when present.
            is_trusted = manifest.get("trusted")
            if is_trusted is None:
                is_trusted = manifest.get("author", "").startswith("ProxmoxVEx")
        except Exception:
            pass
    if not is_trusted:
        # (#015) Untrusted plugins must be explicitly allow-listed before
        # execution. They run with full process privileges, so the default
        # is deny and an admin must add the plugin ID to
        # config/untrusted_plugins.json after reviewing the code.
        allowed = _load_untrusted_allowlist()
        if plugin_id not in allowed:
            logging.warning(
                f"[PLUGINS] [SECURITY] BLOCKED untrusted plugin '{plugin_id}' — "
                "add it to plugins/untrusted_plugins.json to allow loading."
            )
            return False, f"Untrusted plugin '{plugin_id}' is not in the allowlist"
        logging.info(f"[PLUGINS] [SECURITY] Allow-listed untrusted plugin '{plugin_id}' loaded")
    # Security audit: plugins run with FULL process privileges, no sandbox
    # this is by design (like Grafana/Jenkins plugins) but must be documented
    from ProxmoxVEx.utils.audit import log_audit

    with contextlib.suppress(BaseException):
        log_audit("system", "plugin.load", f"Plugin '{plugin_id}' loaded (trusted={is_trusted})")

    try:
        mod_name = f"plugins.{plugin_id}"
        spec = importlib.util.spec_from_file_location(mod_name, init_file)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[mod_name] = mod
        spec.loader.exec_module(mod)

        # plugin calls register_plugin_route() inside register()
        if hasattr(mod, "register"):
            mod.register(app)

        with _plugin_lock:
            _loaded_plugins[plugin_id] = mod
        logging.info(f"[PLUGINS] Loaded: {plugin_id}")
        return True, ""

    except Exception as e:
        logging.error(f"[PLUGINS] Failed to load {plugin_id}: {e}")
        # roll back partial state — a register() that half-succeeded can leave
        # stale routes referencing a module we're about to drop
        with _plugin_lock:
            _plugin_routes.pop(plugin_id, None)
            _loaded_plugins.pop(plugin_id, None)
        if f"plugins.{plugin_id}" in sys.modules:
            del sys.modules[f"plugins.{plugin_id}"]
        return False, str(e)


def unload_plugin(plugin_id):
    """Unload a plugin — remove routes and module"""
    with _plugin_lock:
        _plugin_routes.pop(plugin_id, None)
        _loaded_plugins.pop(plugin_id, None)
    mod_name = f"plugins.{plugin_id}"
    if mod_name in sys.modules:
        del sys.modules[mod_name]
    logging.info(f"[PLUGINS] Unloaded: {plugin_id}")


def load_enabled_plugins(app):
    """Called once at startup — load all enabled plugins"""
    states = _get_plugin_states()
    discovered = _discover_plugins()

    loaded = []
    for plugin in discovered:
        pid = plugin["_id"]
        state = states.get(pid, {})
        enabled = state.get("enabled")
        # Auto-enable trusted frontend plugins on first discovery so
        # management UIs (IDS/IPS, Storage Health, etc.) are visible
        # without a manual enable step in the Plugins tab.
        if enabled is None and plugin.get("has_frontend") and plugin.get("author", "").startswith("ProxmoxVEx"):
            _set_plugin_state(pid, True, error="")
            enabled = True
        if enabled:
            ok, err = load_plugin(app, pid)
            if ok:
                loaded.append(plugin.get("name", pid))
                # clear any old error from the DB
                _set_plugin_state(pid, True, error="")
            else:
                # keep enabled flag so user still sees the intent, record error for UI
                _set_plugin_state(pid, True, error=err)

    if loaded:
        logging.info(f"[PLUGINS] {len(loaded)} plugin(s) loaded: {', '.join(loaded)}")


def start_plugin_backgrounds():
    # snapshot under lock to avoid "dictionary changed size during iteration"
    with _plugin_lock:
        plugins_snapshot = list(_loaded_plugins.items())
    for pid, mod in plugins_snapshot:
        if hasattr(mod, "start_background_tasks"):
            try:
                mod.start_background_tasks()
                logging.info(f"[PLUGINS] Background tasks started for {pid}")
            except Exception as e:
                logging.error(f"[PLUGINS] Background task failed for {pid}: {e}")


# ---- API Routes ----


@bp.route("/api/plugins", methods=["GET"])
@require_auth(perms=["plugins.view"])
def list_plugins():
    """List all discovered plugins with their enabled/disabled state"""
    discovered = _discover_plugins()
    states = _get_plugin_states()

    result = []
    # snapshot the registries so the list is consistent even if enable/disable runs mid-request
    with _plugin_lock:
        loaded_snapshot = set(_loaded_plugins.keys())
        routes_snapshot = {k: list(v.keys()) for k, v in _plugin_routes.items()}

    # licensing lookups are best-effort - a licensing outage shouldn't break the plugin list
    try:
        license_service = LicensingService()
        db_conn = get_db()
    except Exception:
        license_service = None
        db_conn = None

    for plugin in discovered:
        pid = plugin["_id"]
        state = states.get(pid, {})
        if license_service is not None:
            try:
                lock_info = license_service.plugin_lock_info(db_conn, pid)
            except Exception:
                lock_info = {"required_tier": "basic", "licensed": True}
        else:
            lock_info = {"required_tier": "basic", "licensed": True}
        # (#381) - surface the manifest's frontend hook so the
        # dashboard can build a plugin tab without core changes per plugin.
        # Sanitize: route must be a string starting with /api/plugins/<pid>/
        # so a malicious manifest can't redirect the iframe to an external host.
        has_frontend = bool(plugin.get("has_frontend", False))
        raw_route = plugin.get("frontend_route", "")
        frontend_route = ""

        # (#381) - strict route validation. Accept either:
        #   1. fully-qualified plugin path: /api/plugins/<pid>/api/...
        #   2. pure relative form: 'ui' or 'admin/dash' → scoped under us
        # Reject anything else: external URLs, protocol-relative, absolute
        # paths to other plugins, leading slash, control chars, query/fragment.
        # (pentest follow-up) - additionally reject anything with
        # control chars (CRLF/null/tab), URL semantics (?, #, %, \), or
        # parent-segment traversal (..). These would otherwise land verbatim
        # in the iframe src and could enable URL/header injection downstream.
        def _is_safe_relative_path(s):
            if not s or not isinstance(s, str):
                return False
            if any(ord(c) < 0x20 or ord(c) == 0x7F for c in s):
                return False
            for bad in ("?", "#", "%", "\\", "*", ":", " ", "\t"):
                if bad in s:
                    return False
            for seg in s.split("/"):
                if not seg or seg in ("..", "."):
                    return False
                if not _SAFE_PATH_SEG.match(seg):
                    return False
            return True

        if has_frontend and isinstance(raw_route, str):
            expected_prefix = f"/api/plugins/{pid}/"
            if raw_route.startswith(expected_prefix):
                tail = raw_route[len(expected_prefix) :]
                if _is_safe_relative_path(tail):
                    frontend_route = raw_route
                else:
                    has_frontend = False
            elif raw_route and _is_safe_relative_path(raw_route):
                # 'ui' → /api/plugins/<pid>/api/ui — matches register_plugin_route()
                frontend_route = f"/api/plugins/{pid}/api/{raw_route}"
            else:
                has_frontend = False
        else:
            # non-string routes (number, dict, list, None) → drop entirely
            has_frontend = False
        result.append({
            "id": pid,
            "name": plugin.get("name", pid),
            "version": plugin.get("version", ""),
            "author": plugin.get("author", ""),
            "description": plugin.get("description", ""),
            "category": plugin.get("category", "Other"),
            "enabled": bool(state.get("enabled", 0)),
            "loaded": pid in loaded_snapshot,
            "error": state.get("error", "") or plugin.get("error", ""),
            "has_init": plugin.get("_has_init", False),
            "routes": routes_snapshot.get(pid, []),
            "trusted": plugin.get("author", "").startswith("ProxmoxVEx"),
            "has_frontend": has_frontend,
            "frontend_route": frontend_route,
            "licensed": lock_info["licensed"],
            "required_tier": lock_info["required_tier"],
        })

    page = max(1, int(request.args.get("page", 1)))
    # (#20) Plugin manager and licence page expect the full list; default to
    # all discovered plugins when the caller does not request a page size.
    page_size = int(request.args.get("page_size", 0)) or len(result)
    batch_size = max(1, int(request.args.get("batch_size", 10)))
    total_pages = max(1, (len(result) + page_size - 1) // page_size)
    batches = max(1, (len(result) + batch_size - 1) // batch_size)
    start = (page - 1) * page_size
    end = start + page_size
    return jsonify({
        "plugins": result[start:end],
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "batch_size": batch_size,
        "batches": batches,
        "total": len(result),
    })


@bp.route("/api/plugins/<plugin_id>/reload", methods=["POST"])
@require_auth(perms=["plugins.manage"])
def reload_plugin(plugin_id):
    """Force-reload a plugin (unload + load). Helps when a plugin crashed
    and the user wants to retry without a full server restart."""
    if not _valid_plugin_id(plugin_id):
        return jsonify({"error": "Invalid plugin id"}), 400
    manifest_path = _safe_plugin_path(plugin_id, "manifest.json")
    if not manifest_path:
        return jsonify({"error": "Invalid plugin id"}), 400
    plugins_path = manifest_path.parent
    if not plugins_path.exists() or not manifest_path.exists():
        return jsonify({"error": "Plugin not found"}), 404

    unload_plugin(plugin_id)
    ok, err = load_plugin(current_app._get_current_object(), plugin_id)
    _set_plugin_state(plugin_id, True, error=err)

    usr = getattr(request, "session", {}).get("user", "system")
    log_audit(usr, "plugins.reloaded", f"Reloaded plugin: {plugin_id}")

    if ok:
        mod = _loaded_plugins.get(plugin_id)
        if mod and hasattr(mod, "start_background_tasks"):
            with contextlib.suppress(Exception):
                mod.start_background_tasks()
        return jsonify({"success": True})
    return jsonify({"success": False, "error": err}), 500


@bp.route("/api/plugins/<plugin_id>/enable", methods=["POST"])
@require_auth(perms=["plugins.manage"])
def enable_plugin(plugin_id):
    """Enable and load a plugin at runtime"""
    if not _valid_plugin_id(plugin_id):
        return jsonify({"error": "Invalid plugin id"}), 400
    manifest_path = _safe_plugin_path(plugin_id, "manifest.json")
    if not manifest_path:
        return jsonify({"error": "Invalid plugin id"}), 400
    plugins_path = manifest_path.parent
    if not plugins_path.exists() or not manifest_path.exists():
        return jsonify({"error": "Plugin not found"}), 404

    # load at runtime — no blueprint needed, uses catch-all route
    ok, err = load_plugin(current_app._get_current_object(), plugin_id)
    _set_plugin_state(plugin_id, True, error=err)

    usr = getattr(request, "session", {}).get("user", "system")
    log_audit(usr, "plugins.enabled", f"Enabled plugin: {plugin_id}")

    if ok:
        # start background tasks
        mod = _loaded_plugins.get(plugin_id)
        if mod and hasattr(mod, "start_background_tasks"):
            with contextlib.suppress(Exception):
                mod.start_background_tasks()
        return jsonify({"success": True, "message": f"Plugin {plugin_id} enabled and loaded."})
    else:
        return jsonify({"success": False, "error": err}), 500


@bp.route("/api/plugins/<plugin_id>/disable", methods=["POST"])
@require_auth(perms=["plugins.manage"])
def disable_plugin(plugin_id):
    """Disable and unload a plugin"""
    if not _valid_plugin_id(plugin_id):
        return jsonify({"error": "Invalid plugin id"}), 400
    unload_plugin(plugin_id)
    _set_plugin_state(plugin_id, False)

    usr = getattr(request, "session", {}).get("user", "system")
    log_audit(usr, "plugins.disabled", f"Disabled plugin: {plugin_id}")

    return jsonify({"success": True, "message": f"Plugin {plugin_id} disabled."})


@bp.route("/api/plugins/rescan", methods=["POST"])
@require_auth(perms=["plugins.manage"])
def rescan_plugins():
    """Rescan plugins/ directory for new or removed plugins"""
    discovered = _discover_plugins()
    usr = getattr(request, "session", {}).get("user", "system")
    log_audit(usr, "plugins.rescan", f"Rescanned plugins directory: {len(discovered)} found")
    return jsonify({"success": True, "count": len(discovered), "message": f"{len(discovered)} plugin(s) found."})


@bp.route("/api/plugins/<plugin_id>", methods=["DELETE"])
@require_auth(perms=["plugins.manage"])
def delete_plugin(plugin_id):
    """Unload, remove state, and delete plugin from disk"""
    if not _valid_plugin_id(plugin_id):
        return jsonify({"error": "Invalid plugin id"}), 400
    import shutil

    safe_dir = _safe_plugin_path(plugin_id, "__init__.py")
    if not safe_dir:
        return jsonify({"error": "Invalid plugin id"}), 400
    plugins_path = safe_dir.parent
    root = Path(PLUGINS_DIR).resolve()
    # SAST: explicit commonpath containment check before shutil.rmtree.
    try:
        if os.path.commonpath([str(plugins_path), str(root)]) != str(root):
            return jsonify({"error": "Invalid plugin path"}), 400
    except ValueError:
        return jsonify({"error": "Invalid plugin path"}), 400
    if not plugins_path.exists():
        return jsonify({"error": "Plugin not found"}), 404

    # unload if loaded
    unload_plugin(plugin_id)

    # remove DB state
    db = get_db()
    db.execute("DELETE FROM plugin_state WHERE plugin_id = ?", (plugin_id,))

    # delete from disk
    try:
        shutil.rmtree(plugins_path)
    except Exception:
        logging.exception("Failed to delete plugin files for %s", plugin_id)
        return jsonify({"error": "Failed to delete plugin files"}), 500

    usr = getattr(request, "session", {}).get("user", "system")
    log_audit(usr, "plugins.deleted", f"Deleted plugin: {plugin_id}")

    return jsonify({"success": True, "message": f"Plugin {plugin_id} deleted."})


def _safe_plugin_path(plugin_id, filename="config.json"):
    """Validate plugin_id and return safe path — prevents path traversal"""
    if not _valid_plugin_id(plugin_id):
        return None
    if filename != "config.json" and (
        ".." in filename or "/" in filename or "\\" in filename or filename.startswith(".")
    ):
        return None
    root = Path(PLUGINS_DIR).resolve()
    resolved = (Path(PLUGINS_DIR) / plugin_id / filename).resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        return None
    return resolved


@bp.route("/api/plugins/<plugin_id>/config", methods=["GET"])
@require_auth(perms=["plugins.manage"])
def get_plugin_config(plugin_id):
    """Read plugin config.json as raw text"""
    if not _valid_plugin_id(plugin_id):
        return jsonify({"error": "Invalid plugin id"}), 400
    config_path = _safe_plugin_path(plugin_id)
    if not config_path:
        return jsonify({"error": "Invalid plugin ID"}), 400
    if not config_path.exists():
        return jsonify({"config": "{}"}), 200
    try:
        return jsonify({"config": config_path.read_text(encoding="utf-8")})
    except Exception:
        logging.exception("Failed to read plugin config for %s", plugin_id)
        return jsonify({"error": "Failed to read plugin config"}), 500


@bp.route("/api/plugins/<plugin_id>/config", methods=["PUT"])
@require_auth(perms=["plugins.manage"])
def save_plugin_config(plugin_id):
    """Write plugin config.json — validates JSON before saving"""
    if not _valid_plugin_id(plugin_id):
        return jsonify({"error": "Invalid plugin id"}), 400
    config_path = _safe_plugin_path(plugin_id)
    if not config_path:
        return jsonify({"error": "Invalid plugin ID"}), 400
    if not config_path.parent.exists():
        return jsonify({"error": "Plugin not found"}), 404

    data = request.get_json() or {}
    raw = data.get("config", "")
    if not raw:
        return jsonify({"error": "Empty config"}), 400

    # validate JSON
    try:
        json.loads(raw)
    except json.JSONDecodeError:
        logging.exception("Invalid JSON for plugin %s", plugin_id)
        return jsonify({"error": "Invalid JSON"}), 400

    try:
        config_path.write_text(raw, encoding="utf-8")
    except Exception:
        logging.exception("Failed to write config for plugin %s", plugin_id)
        return jsonify({"error": "Failed to write"}), 500

    usr = getattr(request, "session", {}).get("user", "system")
    log_audit(usr, "plugins.config_saved", f"Updated config for plugin: {plugin_id}")

    return jsonify({"success": True})
