# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/notifications/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Push Notifications - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Push Notifications - full UI management backend.
Sends ProxmoxVEx alerts to Ntfy (self-hosted or ntfy.sh) and optionally
through Apprise (80+ notification services: Slack, Discord, Telegram, etc.)

Apprise is optional - install with: pip install apprise
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import requests
from flask import request, send_file

from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.globals import _notification_handlers

PLUGIN_DIR = Path(__file__).parent
CONFIG_PATH = PLUGIN_DIR / "config.json"
HISTORY_PATH = PLUGIN_DIR / "history.json"

# try loading apprise - not required
_apprise_available = False
try:
    import apprise

    _apprise_available = True
except ImportError:
    pass


def _load_config():
    if not CONFIG_PATH.exists():
        return {"ntfy_enabled": False, "apprise_enabled": False}
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log = logging.getLogger("plugin.notifications")
        log.warning("Failed to load config: %s", e)
        return {"ntfy_enabled": False, "apprise_enabled": False}


def _save_config(cfg):
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


def _load_history():
    if not HISTORY_PATH.exists():
        return []
    try:
        with open(HISTORY_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log = logging.getLogger("plugin.notifications")
        log.warning("Failed to load history: %s", e)
        return []


def _save_history(history):
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(HISTORY_PATH, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2)


def _require_admin():
    from ProxmoxVEx.models.permissions import ROLE_ADMIN
    from ProxmoxVEx.utils.auth import load_users

    username = request.session.get("user", "")
    users = load_users()
    if users.get(username, {}).get("role") != ROLE_ADMIN:
        return {"error": "Admin access required"}, 403
    return None


# ─── Ntfy sender ───


def _send_ntfy(alert_data, cfg):
    topic = cfg.get("ntfy_topic", "")
    if not topic:
        return False, "No ntfy topic configured"
    url = f"{cfg.get('ntfy_url', 'https://ntfy.sh').rstrip('/')}/{topic}"
    prio_map = cfg.get("ntfy_priority_map", {})
    priority = prio_map.get(alert_data.get("severity", "info"), "default")

    headers = {
        "Priority": priority,
        "Title": f"ProxmoxVEx: {alert_data.get('alert_name', 'Alert')}",
        "Tags": f"ProxmoxVEx,{alert_data.get('severity', 'info')},{alert_data.get('metric', '')}",
    }
    token = cfg.get("ntfy_token", "")
    # Security audit - token may be encrypted, try decrypting
    if token:
        try:
            from ProxmoxVEx.core.db import get_db

            decrypted = get_db()._decrypt(token)
            if decrypted:
                token = decrypted
        except Exception:
            pass
        headers["Authorization"] = f"Bearer {token}"

    try:
        # SSRF guard: ntfy URLs are admin-supplied and could
        # accidentally (or maliciously) point at metadata / internal services.
        try:
            from ProxmoxVEx.utils.url_security import SsrfError, sanitize_outbound_url

            sanitize_outbound_url(url, allowed_schemes=("https", "http"))
        except SsrfError as guard_err:
            return False, f"ntfy URL rejected: {guard_err}"
        r = requests.post(url, data=alert_data.get("message", ""), headers=headers, timeout=10)
        if r.status_code in (200, 201):
            return True, None
        return False, f"ntfy returned {r.status_code}"
    except Exception as e:
        return False, str(e)


# ─── Apprise sender ───


def _send_apprise(alert_data, cfg):
    if not _apprise_available:
        return False, "apprise not installed"
    urls = cfg.get("apprise_urls", [])
    if not urls:
        return False, "No apprise URLs configured"
    # (CodeAnt SSRF) - the prefix blocklist missed decimal/hex/IPv6/metadata-by-
    # hostname encodings; run the real SSRF guard on http(s) apprise targets (other apprise
    # schemes like discord://, tgram:// go to provider APIs, not arbitrary IPs, so leave them).
    from ProxmoxVEx.utils.url_security import SsrfError, sanitize_outbound_url

    try:
        ap = apprise.Apprise()
        for u in urls:
            _ul = str(u).lower()
            if _ul.startswith("file://"):
                logging.warning("[Notifications] Blocked file:// apprise URL")
                continue
            if _ul.startswith(("http://", "https://")):
                try:
                    sanitize_outbound_url(u, allowed_schemes=("http", "https"), allow_private=False)
                except SsrfError as _se:
                    logging.warning(f"[Notifications] Blocked SSRF apprise URL: {_se}")
                    continue
            ap.add(u)
        ok = ap.notify(
            title=f"ProxmoxVEx: {alert_data.get('alert_name', 'Alert')}",
            body=alert_data.get("message", ""),
            notify_type=apprise.NotifyType.WARNING
            if alert_data.get("severity") == "warning"
            else apprise.NotifyType.FAILURE
            if alert_data.get("severity") == "critical"
            else apprise.NotifyType.INFO,
        )
        return ok, None
    except Exception as e:
        return False, str(e)


# ─── Alert handler (called by ProxmoxVEx alert system) ───


def _notification_handler(alert_data):
    cfg = _load_config()

    if cfg.get("ntfy_enabled") and cfg.get("ntfy_topic"):
        ok, err = _send_ntfy(alert_data, cfg)
        if ok:
            logging.info(f"[Notifications] ntfy sent: {alert_data.get('alert_name')}")
        elif err:
            logging.warning(f"[Notifications] ntfy failed: {err}")

    if cfg.get("apprise_enabled") and cfg.get("apprise_urls"):
        ok, err = _send_apprise(alert_data, cfg)
        if ok:
            logging.info(f"[Notifications] apprise sent: {alert_data.get('alert_name')}")
        elif err:
            logging.warning(f"[Notifications] apprise failed: {err}")


# ─── API routes ───


def _get_status():
    cfg = _load_config()
    history = _load_history()
    last = history[0] if history else None
    return {
        "ntfy_enabled": cfg.get("ntfy_enabled", False),
        "ntfy_topic": cfg.get("ntfy_topic", ""),
        "apprise_enabled": cfg.get("apprise_enabled", False),
        "apprise_available": _apprise_available,
        "apprise_url_count": len(cfg.get("apprise_urls", [])),
        "handler_registered": _notification_handler in _notification_handlers,
        "history_count": len(history),
        "last_alert_at": last.get("timestamp") if last else None,
    }


def _get_config():
    err = _require_admin()
    if err:
        return err
    cfg = _load_config()
    cfg["apprise_available"] = _apprise_available
    return cfg


def _validate_config(data):
    if "ntfy_priority_map" in data:
        try:
            json.dumps(data["ntfy_priority_map"])
        except TypeError:
            return {"error": "ntfy_priority_map must be valid JSON"}, 400
    if "apprise_urls" in data and isinstance(data["apprise_urls"], str):
        data["apprise_urls"] = [u.strip() for u in data["apprise_urls"].splitlines() if u.strip()]
    return None


def _update_config():
    err = _require_admin()
    if err:
        return err
    data = request.get_json() or {}
    validation = _validate_config(data)
    if validation:
        return validation
    cfg = _load_config()
    for k in [
        "ntfy_enabled",
        "ntfy_url",
        "ntfy_topic",
        "ntfy_token",
        "ntfy_priority_map",
        "apprise_enabled",
        "apprise_urls",
    ]:
        if k in data:
            cfg[k] = data[k]
    _save_config(cfg)
    _add_history("Config updated", "success")
    return {"success": True}


def _add_history(event, status="info"):
    history = _load_history()
    history.insert(
        0,
        {
            "event": event,
            "status": status,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
    history = history[:100]
    _save_history(history)
    return history


def _get_history():
    err = _require_admin()
    if err:
        return err
    return {"history": _load_history()}


def _send_test():
    """Send a test notification to verify config works"""
    err = _require_admin()
    if err:
        return err
    cfg = _load_config()
    test_alert = {
        "alert_name": "Test Notification",
        "metric": "test",
        "operator": ">",
        "threshold": 0,
        "current_value": 42.0,
        "target_type": "system",
        "target_name": "ProxmoxVEx",
        "cluster_id": "test",
        "severity": "info",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "message": "This is a test notification from ProxmoxVEx. If you see this, notifications are working!",
    }
    results = {}
    if cfg.get("ntfy_enabled") and cfg.get("ntfy_topic"):
        ok, err_msg = _send_ntfy(test_alert, cfg)
        results["ntfy"] = {"success": ok, "error": err_msg}
    else:
        results["ntfy"] = {"success": False, "error": "Not enabled or no topic"}

    if cfg.get("apprise_enabled") and cfg.get("apprise_urls"):
        ok, err_msg = _send_apprise(test_alert, cfg)
        results["apprise"] = {"success": ok, "error": err_msg}
    else:
        results["apprise"] = {"success": False, "error": "Not enabled or no URLs"}

    _add_history(
        "Test notification",
        "success" if (results.get("ntfy", {}).get("success") or results.get("apprise", {}).get("success")) else "error",
    )
    return results


def _get_ui():
    """Serve the Push Notifications HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route("notifications", "status", _get_status)
    register_plugin_route("notifications", "config", _get_config)
    register_plugin_route("notifications", "config/update", _update_config)
    register_plugin_route("notifications", "history", _get_history)
    register_plugin_route("notifications", "test", _send_test)
    register_plugin_route("notifications", "ui", _get_ui)

    # register as alert handler
    if _notification_handler not in _notification_handlers:
        _notification_handlers.append(_notification_handler)

    logging.info(
        f"[PLUGINS] Push Notifications plugin registered (ntfy + apprise{'=available' if _apprise_available else '=not installed'})"
    )
