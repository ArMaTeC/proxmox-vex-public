# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/api-token-manager/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: API Token Manager - thin management layer over the real...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
API Token Manager - thin management layer over the real core pgx_ token store.

This plugin now delegates create/rotate/revoke/list to ProxmoxVEx.utils.auth
instead of maintaining its own parallel state.json token list. Tokens created
here are real ProxmoxVEx API tokens that can be used for Bearer auth.
"""

import json
import logging
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.core.db import get_db
from ProxmoxVEx.globals import audit_log
from ProxmoxVEx.models.permissions import ROLE_ADMIN, ROLE_USER, ROLE_VIEWER
from ProxmoxVEx.utils.audit import log_audit
from ProxmoxVEx.utils.auth import create_api_token, list_user_tokens, load_users, revoke_api_token
from ProxmoxVEx.utils.rbac import has_permission

PLUGIN_ID = "api-token-manager"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent

PREDEFINED_SCOPES = ["*", "read:vms", "write:vms", "read:storage", "write:storage", "read:nodes", "read:tasks"]

_MAX_TOKEN_NAME_LEN = 64
_TOKEN_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
_MAX_ACTIVE_TOKENS = 10

_rate_limit_attempts: dict[str, list[float]] = {}
_rate_limit_lock = threading.Lock()


def _now():
    return datetime.now(timezone.utc)


def _is_active(token):
    """Return True when a token dict is currently active."""
    if token.get("revoked"):
        return False
    exp = token.get("expires_at")
    if exp:
        try:
            if datetime.fromisoformat(exp) < _now():
                return False
        except ValueError:
            pass
    return True


def _username():
    """Return the current request user."""
    return request.session.get("user")


def _current_user():
    """Return the full user record for the current request."""
    username = _username()
    try:
        return get_db().get_user(username)
    except Exception:
        return load_users().get(username)


def _has_admin_api():
    """True when the current user has the admin.api permission."""
    user = _current_user()
    return has_permission(user, "admin.api") if user else False


def _check_rate_limit(action, username, max_attempts=10, window=60):
    """Sliding-window rate limiter for token-management actions."""
    key = f"{username}:{action}"
    now = time.time()
    with _rate_limit_lock:
        attempts = [t for t in _rate_limit_attempts.get(key, []) if now - t < window]
        if len(attempts) >= max_attempts:
            raise ValueError(f"Rate limit exceeded for {action}; try again later")
        attempts.append(now)
        _rate_limit_attempts[key] = attempts


def _validate_name(name):
    """Validate the token name."""
    if not name or not str(name).strip():
        raise ValueError("name is required")
    if len(name) > _MAX_TOKEN_NAME_LEN:
        raise ValueError(f"name must be at most {_MAX_TOKEN_NAME_LEN} characters")
    if not _TOKEN_NAME_RE.match(name):
        raise ValueError("name must contain only letters, digits, underscore, dot, or hyphen")


def _validate_scopes(scopes):
    """Validate the requested scope list."""
    if not isinstance(scopes, list):
        raise ValueError("scopes must be a list")
    if len(scopes) > 64:
        raise ValueError("too many scopes")
    seen = set()
    for s in scopes:
        if not isinstance(s, str) or not s.strip():
            raise ValueError("scope must be a non-empty string")
        if len(s) > _MAX_TOKEN_NAME_LEN:
            raise ValueError("scope too long")
        if s not in PREDEFINED_SCOPES:
            raise ValueError(f"Invalid scope: {s}")
        if s in seen:
            raise ValueError(f"Duplicate scope: {s}")
        seen.add(s)


def _check_token_quota(username, excluding_id=None):
    """Enforce the active-token quota for a user."""
    tokens = list_user_tokens(username)
    active = sum(1 for t in tokens if _is_active(t) and t.get("id") != excluding_id)
    if active >= _MAX_ACTIVE_TOKENS:
        raise ValueError(f"Maximum of {_MAX_ACTIVE_TOKENS} active tokens allowed")


def _derive_role(scopes):
    """Pick the least-privileged role that can hold the requested scopes."""
    if not isinstance(scopes, (list, tuple)):
        scopes = []
    if "*" in scopes:
        return ROLE_ADMIN
    if any(str(s).startswith("write:") or str(s) == "write" for s in scopes):
        return ROLE_USER
    return ROLE_VIEWER


def _parse_expires(expires_at):
    """Convert a datetime-local string into the number of days from now (1-365)."""
    if not expires_at or not str(expires_at).strip():
        return None
    raw = str(expires_at).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        try:
            dt = datetime.fromisoformat(raw + ":00")
        except ValueError as exc:
            raise ValueError(f"Invalid expires_at: {exc}") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    now = _now()
    if dt <= now:
        raise ValueError("Expiration must be in the future")
    delta = dt - now
    days = delta.days + (1 if delta.seconds or delta.microseconds else 0)
    if not 1 <= days <= 365:
        raise ValueError("Expiry must be between 1 and 365 days")
    return days


def _permissions_to_scopes(permissions):
    """Return a list of scopes from the core permissions column."""
    if isinstance(permissions, str):
        try:
            return json.loads(permissions)
        except Exception:
            return []
    return list(permissions or [])


def _token_from_core(t):
    """Convert a core api_tokens row into the shape the plugin UI expects."""
    scopes = _permissions_to_scopes(t.get("permissions"))
    expires_at = t.get("expires_at")
    return {
        "id": t.get("id"),
        "name": t.get("name"),
        "scopes": scopes,
        "role": t.get("role"),
        "token_prefix": t.get("token_prefix"),
        "token": None,  # raw secret is only returned once, at creation
        "expires_at": expires_at,
        "created_at": t.get("created_at"),
        "last_used_at": t.get("last_used_at"),
        "last_used_ip": t.get("last_used_ip"),
        "revoked": bool(t.get("revoked")),
        "_active": _is_active({**t, "scopes": scopes}),
    }


def _list_all_tokens():
    """List every token in the core store (admin only)."""
    db = get_db()
    cursor = db.conn.cursor()
    cursor.execute("""
        SELECT id, token_prefix, username, name, role, permissions, expires_at,
               last_used_at, last_used_ip, created_at, revoked
        FROM api_tokens ORDER BY created_at DESC
    """)
    return [dict(row) for row in cursor.fetchall()]


def _get_status():
    username = _username()
    tokens = list_user_tokens(username)
    active = sum(1 for t in tokens if _is_active(t))
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "token_count": len(tokens),
        "active_count": active,
    }


def _get_tokens():
    username = _username()
    admin = _has_admin_api()
    token_id = request.args.get("id")
    all_view = admin and request.args.get("all") == "true"

    source = _list_all_tokens() if all_view else list_user_tokens(username)

    if token_id is not None:
        for t in source:
            if str(t.get("id")) == str(token_id):
                return {"token": _token_from_core(t)}
        return jsonify({"error": "Token not found"}), 404

    tokens = [_token_from_core(t) for t in source]
    return {"tokens": tokens, "scopes": PREDEFINED_SCOPES}


def _upsert_token():
    body = request.get_json(silent=True) or {}
    eid = str(body.get("id") or "").strip()
    name = (body.get("name") or "").strip()
    scopes = body.get("scopes", [])
    expires_at = (body.get("expires_at") or "").strip()
    username = _username()

    try:
        _validate_name(name)
        _validate_scopes(scopes)
        _check_rate_limit("token.upsert", username)
        expires_days = _parse_expires(expires_at) if expires_at else None
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    role = _derive_role(scopes)
    existing = list_user_tokens(username)
    token_id = None

    if eid:
        try:
            token_id = int(eid)
        except ValueError:
            return jsonify({"error": "Invalid token id"}), 400
        old = next((t for t in existing if t.get("id") == token_id), None)
        if not old:
            return jsonify({"error": "Token not found"}), 404
        if any(t.get("name") == name and t.get("id") != token_id for t in existing if not t.get("revoked")):
            return jsonify({"error": f'Token name "{name}" already exists'}), 400
        if not revoke_api_token(token_id, username):
            return jsonify({"error": "Token not found"}), 404
        log_audit(username, "token.revoked", f"Revoked API token id={token_id} before edit")
    else:
        if any(t.get("name") == name for t in existing if not t.get("revoked")):
            return jsonify({"error": f'Token name "{name}" already exists'}), 400

    try:
        _check_token_quota(username, token_id if eid else None)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    result = create_api_token(
        username,
        name,
        role=role,
        permissions=scopes,
        expires_days=expires_days,
    )
    if "error" in result:
        return jsonify(result), 400

    raw_token = result.get("token")
    new_id = result.get("token_id")
    log_audit(username, "token.created", f"API token '{name}' created")

    new = next((t for t in list_user_tokens(username) if t.get("id") == new_id), {})
    return {
        "token": _token_from_core(new),
        "raw_token": raw_token,
        "saved": True,
    }


def _delete_token():
    body = request.get_json(silent=True) or {}
    token_id = body.get("id") or request.args.get("id")
    if not token_id:
        return jsonify({"error": "id is required"}), 400
    try:
        tid = int(token_id)
    except ValueError:
        return jsonify({"error": "Invalid token id"}), 400
    username = _username()
    try:
        _check_rate_limit("token.delete", username)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 429
    db = get_db()
    cursor = db.conn.cursor()
    cursor.execute("DELETE FROM api_tokens WHERE id = ? AND username = ?", (tid, username))
    db.conn.commit()
    if cursor.rowcount == 0:
        return jsonify({"error": "Token not found"}), 404
    log_audit(username, "token.deleted", f"Deleted API token id={tid}")
    return {"deleted": str(tid)}


def _token_handler():
    if request.method == "POST":
        return _upsert_token()
    if request.method == "DELETE":
        return _delete_token()
    return jsonify({"error": "Method not allowed"}), 405


def _rotate_token():
    body = request.get_json(silent=True) or {}
    token_id = str(body.get("id") or "").strip()
    if not token_id:
        return jsonify({"error": "id is required"}), 400
    try:
        tid = int(token_id)
    except ValueError:
        return jsonify({"error": "Invalid token id"}), 400
    username = _username()
    try:
        _check_rate_limit("token.rotate", username)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 429
    existing = next((t for t in list_user_tokens(username) if t.get("id") == tid), None)
    if not existing:
        return jsonify({"error": "Token not found"}), 404
    if existing.get("revoked"):
        return jsonify({"error": "Token is already revoked"}), 400

    name = existing.get("name")
    scopes = _permissions_to_scopes(existing.get("permissions"))
    role = existing.get("role") or _derive_role(scopes)
    expires_at = existing.get("expires_at")
    expires_days = None
    if expires_at:
        try:
            remaining = datetime.fromisoformat(expires_at) - _now()
            days = remaining.days + (1 if remaining.seconds or remaining.microseconds else 0)
            if 1 <= days <= 365:
                expires_days = days
        except ValueError:
            pass

    try:
        _check_token_quota(username, tid)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if not revoke_api_token(tid, username):
        return jsonify({"error": "Failed to revoke existing token"}), 500

    result = create_api_token(username, name, role=role, permissions=scopes, expires_days=expires_days)
    if "error" in result:
        return jsonify(result), 400

    raw_token = result.get("token")
    new_id = result.get("token_id")
    log_audit(username, "token.rotated", f"Rotated API token '{name}'")

    new = next((t for t in list_user_tokens(username) if t.get("id") == new_id), {})
    return {"token": _token_from_core(new), "raw_token": raw_token}


def _revoke_token():
    body = request.get_json(silent=True) or {}
    token_id = str(body.get("id") or "").strip()
    if not token_id:
        return jsonify({"error": "id is required"}), 400
    try:
        tid = int(token_id)
    except ValueError:
        return jsonify({"error": "Invalid token id"}), 400
    username = _username()
    try:
        _check_rate_limit("token.revoke", username)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 429
    existing = next((t for t in list_user_tokens(username) if t.get("id") == tid), None)
    if not existing:
        return jsonify({"error": "Token not found"}), 404
    if not revoke_api_token(tid, username):
        return jsonify({"error": "Token not found"}), 404
    log_audit(username, "token.revoked", f"Revoked API token '{existing.get('name')}'")
    return {"token": _token_from_core(existing)}


def _get_audit():
    username = _username()
    admin = _has_admin_api()
    token_actions = {"token.created", "token.revoked", "token.rotated", "token.deleted"}
    entries = []
    for e in audit_log:
        if e.get("action") not in token_actions:
            continue
        if not admin and e.get("user") != username:
            continue
        details = e.get("details") or ""
        token_name = details.split("'")[1] if "'" in details else "-"
        token_id = details.split("=")[-1] if "=" in details else "-"
        entries.append({
            "token_name": token_name,
            "token_id": token_id,
            "endpoint": e.get("action"),
            "at": e.get("timestamp"),
        })
        if len(entries) >= 50:
            break
    return {"audit": list(reversed(entries))}


def _get_ui():
    """Serve the API Token Manager HTML interface."""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "tokens", _get_tokens)
    register_plugin_route(PLUGIN_ID, "token", _token_handler)
    register_plugin_route(PLUGIN_ID, "rotate", _rotate_token)
    register_plugin_route(PLUGIN_ID, "revoke", _revoke_token)
    register_plugin_route(PLUGIN_ID, "audit", _get_audit)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[%s] plugin registered", PLUGIN_ID)
