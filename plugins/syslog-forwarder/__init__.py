# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/syslog-forwarder/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: syslog-forwarder — ProxmoxVEx Plugin
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
syslog-forwarder — ProxmoxVEx Plugin
Forward PVE and ProxmoxVEx logs to a remote syslog/SIEM with filtering and TLS.
"""

import contextlib
import fnmatch
import ipaddress
import json
import logging
import re
import socket
import ssl
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, safe_error
from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.utils.audit import log_audit

PLUGIN_ID = "syslog-forwarder"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "state.json"
CERT_DIR = PLUGIN_DIR / "certs"
CERT_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_STATE = {
    "config": {
        "version": "1.0.0",
        "updated_at": None,
        "paused": False,
        "targets": [],
    },
    "test_log": [],
    "audit_log": [],
    "health": {},
    "certificates": {},
}


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix=""):
    return f"{prefix}{uuid.uuid4().hex[:12]}"


def _current_user():
    return getattr(request, "session", {}).get("user", "unknown")


def _load_state():
    if not STATE_FILE.exists():
        return DEFAULT_STATE.copy()
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return DEFAULT_STATE.copy()


def _save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except OSError as e:
        log.error("Failed to save state: %s", e)


def _init_state():
    state = _load_state()
    changed = False
    for key, default in DEFAULT_STATE.items():
        if key not in state:
            state[key] = default
            changed = True
    if changed:
        _save_state(state)
    return state


def _record_audit(action, previous, next_, cluster_id="", target_id=""):
    user = _current_user()
    entry = {
        "id": _new_id("audit-"),
        "actor": user,
        "timestamp": _now_iso(),
        "action": action,
        "cluster_id": cluster_id,
        "target_id": target_id,
        "previous": previous or {},
        "next": next_ or {},
    }
    state = _load_state()
    audit = state.setdefault("audit_log", [])
    audit.insert(0, entry)
    state["audit_log"] = audit[:5000]
    _save_state(state)
    with contextlib.suppress(Exception):
        log_audit(user, f"syslog-forwarder.{action}", json.dumps({"cluster_id": cluster_id, "target_id": target_id}))


def _valid_cluster_id(cluster_id):
    if not cluster_id or cluster_id == "__global__":
        return True
    allowed, _ = check_cluster_access(cluster_id)
    return allowed


_HOST_RE = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9_.-]*[A-Za-z0-9])?$")


def _is_valid_host(host):
    if not host or not isinstance(host, str):
        return False
    host = host.strip()
    if not host:
        return False
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    return bool(_HOST_RE.match(host))


def _validate_filter_rules(rules):
    errors = []
    if not isinstance(rules, list):
        return ["filter.rules must be a list"]
    for idx, rule in enumerate(rules):
        if not isinstance(rule, dict):
            errors.append(f"rule {idx} is not an object")
            continue
        typ = rule.get("type", "regex")
        pattern = rule.get("pattern", "")
        if not isinstance(pattern, str):
            errors.append(f"rule {idx} pattern must be a string")
            continue
        if typ == "regex":
            try:
                re.compile(pattern)
            except re.error as e:
                errors.append(f"rule {idx} invalid regex: {e}")
        elif typ == "glob":
            try:
                re.compile(fnmatch.translate(pattern))
            except re.error as e:
                errors.append(f"rule {idx} invalid glob: {e}")
        elif typ == "exact":
            if not pattern:
                errors.append(f"rule {idx} exact pattern is empty")
        else:
            errors.append(f"rule {idx} unknown type: {typ}")
    return errors


def _compile_pattern(rule):
    typ = rule.get("type", "regex")
    pattern = rule.get("pattern", "")
    if typ == "regex":
        return re.compile(pattern)
    if typ == "glob":
        return re.compile(fnmatch.translate(pattern))
    if typ == "exact":
        return re.compile(re.escape(pattern))
    return re.compile("")


def _rule_matches(rule, message):
    if not rule.get("enabled", True):
        return False
    try:
        return bool(_compile_pattern(rule).search(message))
    except re.error:
        return False


def _filter_matches(rules, message):
    """Return True if the message passes the filter rule set."""
    if not rules:
        return True
    matched_include = False
    has_include = False
    for rule in rules:
        if rule.get("action") == "include" and rule.get("enabled", True):
            has_include = True
            if _rule_matches(rule, message):
                matched_include = True
        if rule.get("action") == "exclude" and _rule_matches(rule, message):
            return False
    if has_include:
        return matched_include
    return True


def _validate_target(data):
    errors = []
    cluster_id = data.get("cluster_id", "")
    if cluster_id and cluster_id != "__global__" and not _valid_cluster_id(cluster_id):
        errors.append("cluster_id is not accessible")
    host = (data.get("host") or "").strip()
    if not _is_valid_host(host):
        errors.append("host must be a non-empty hostname, IP, or FQDN")
    try:
        port = int(data.get("port", 0))
        if not 1 <= port <= 65535:
            errors.append("port must be between 1 and 65535")
    except (TypeError, ValueError):
        errors.append("port must be an integer")
    protocol = data.get("protocol", "")
    if protocol not in ("udp", "tcp", "tls-over-tcp"):
        errors.append("protocol must be udp, tcp, or tls-over-tcp")
    tls = data.get("tls", False)
    if protocol == "udp" and tls:
        errors.append("TLS is not supported with UDP")
    fmt = data.get("format", "rfc3164")
    if fmt not in ("rfc3164", "rfc5424", "custom"):
        errors.append("format must be rfc3164, rfc5424, or custom")
    filter_rules = (data.get("filter") or {}).get("rules", [])
    errors.extend(_validate_filter_rules(filter_rules))
    fallback = data.get("fallback_target_id", "")
    if fallback:
        state = _load_state()
        ids = {t.get("id") for t in state.get("config", {}).get("targets", [])}
        if fallback not in ids and fallback != data.get("id"):
            errors.append("fallback_target_id does not reference an existing target")
    return errors


def _send_message(target, message):
    """Attempt to send a test syslog message to target. Returns (result, latency_ms, error)."""
    host = target.get("host", "").strip()
    port = int(target.get("port", 514))
    protocol = target.get("protocol", "udp")
    if not host or not port:
        return "error", 0, "missing host or port"
    msg = (message or "ProxmoxVEx test message").encode("utf-8") + b"\n"
    start = time.monotonic()
    try:
        if protocol == "udp":
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.settimeout(5.0)
                s.sendto(msg, (host, port))
            return "success", int((time.monotonic() - start) * 1000), ""
        elif protocol == "tcp":
            with socket.create_connection((host, port), timeout=5.0) as s:
                s.sendall(msg)
            return "success", int((time.monotonic() - start) * 1000), ""
        elif protocol == "tls-over-tcp":
            ctx = ssl.create_default_context()
            sock = socket.create_connection((host, port), timeout=5.0)
            try:
                s = ctx.wrap_socket(sock, server_hostname=host)
                s.sendall(msg)
                s.close()
                return "success", int((time.monotonic() - start) * 1000), ""
            finally:
                sock.close()
        else:
            return "error", 0, f"unknown protocol {protocol}"
    except socket.timeout:
        return "timeout", int((time.monotonic() - start) * 1000), "connection timed out"
    except OSError as e:
        return "error", int((time.monotonic() - start) * 1000), safe_error(e, "send failed")
    except Exception as e:
        return "error", int((time.monotonic() - start) * 1000), safe_error(e, "send failed")


def _diagnose(target, test_type):
    host = target.get("host", "").strip()
    port = int(target.get("port", 514))
    if not host or not port:
        return {"result": "error", "details": "missing host or port"}
    if test_type == "dns":
        try:
            infos = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)
            ips = [info[4][0] for info in infos]
            return {"result": "ok", "details": f"resolved to {', '.join(set(ips[:5]))}"}
        except socket.gaierror as e:
            return {"result": "error", "details": f"DNS resolution failed: {e}"}
    if test_type == "reachability":
        try:
            with socket.create_connection((host, port), timeout=5.0):
                return {"result": "ok", "details": f"TCP connect to {host}:{port} succeeded"}
        except OSError as e:
            return {"result": "error", "details": safe_error(e, "reachability test failed")}
    return {"result": "error", "details": f"unknown diagnostic type: {test_type}"}


def _record_health(target_id, status, last_send=None, last_error="", queue_depth=0, throughput=None):
    state = _load_state()
    health = state.setdefault("health", {})
    health[target_id] = {
        "target_id": target_id,
        "status": status,
        "last_send": last_send,
        "last_error": last_error,
        "throughput": throughput or {"messages_per_sec": 0, "bytes_per_sec": 0},
        "queue_depth": queue_depth,
        "updated_at": _now_iso(),
    }
    _save_state(state)


def _status_from_health(h):
    if not h:
        return "unknown"
    return h.get("status", "unknown")


# ─── Route handlers ────────────────────────────────────────────────────


def _get_status():
    state = _load_state()
    cfg = state.get("config", {})
    targets = cfg.get("targets", [])
    health = state.get("health", {})
    status_counts = {"ok": 0, "warning": 0, "error": 0, "paused": 0, "unknown": 0}
    for t in targets:
        status = _status_from_health(health.get(t.get("id")))
        status_counts[status] = status_counts.get(status, 0) + 1
    return {
        "plugin": PLUGIN_ID,
        "status": "paused" if cfg.get("paused") else "running",
        "paused": cfg.get("paused", False),
        "version": cfg.get("version", "1.0.0"),
        "updated_at": cfg.get("updated_at"),
        "targets": {
            "total": len(targets),
            "enabled": sum(1 for t in targets if t.get("enabled")),
            "status": status_counts,
        },
    }


def _config_handler():
    state = _load_state()
    cfg = state.get("config", DEFAULT_STATE["config"].copy())
    if request.method == "GET":
        cluster_id = request.args.get("cluster_id", "").strip()
        if cluster_id and cluster_id != "__global__" and not _valid_cluster_id(cluster_id):
            return jsonify({"error": "cluster_id is not accessible"}), 403
        if cluster_id:
            scope = cluster_id if cluster_id != "__global__" else "__global__"
            targets = [t for t in cfg.get("targets", []) if t.get("cluster_id") == scope]
        else:
            targets = cfg.get("targets", [])
        return jsonify({
            "version": cfg.get("version", "1.0.0"),
            "updated_at": cfg.get("updated_at"),
            "paused": cfg.get("paused", False),
            "targets": targets,
        })
    # POST: save full or partial config
    body = request.get_json(silent=True) or {}
    previous = json.loads(json.dumps(cfg))
    if "paused" in body:
        cfg["paused"] = bool(body["paused"])
    if "targets" in body:
        for t in body["targets"]:
            errors = _validate_target(t)
            if errors:
                return jsonify({"error": "; ".join(errors)}), 400
        cfg["targets"] = body["targets"]
        for idx, t in enumerate(cfg["targets"]):
            t["order"] = idx
    cfg["version"] = _new_id("cfg-")
    cfg["updated_at"] = _now_iso()
    state["config"] = cfg
    _save_state(state)
    _record_audit("config.save", previous.get("targets"), cfg.get("targets"))
    return jsonify(cfg)


def _targets_handler():
    state = _load_state()
    cfg = state.get("config", DEFAULT_STATE["config"].copy())
    targets = cfg.get("targets", [])
    if request.method == "GET":
        cluster_id = request.args.get("cluster_id", "").strip()
        enabled = request.args.get("enabled", "")
        data = targets
        if cluster_id:
            scope = cluster_id if cluster_id != "__global__" else "__global__"
            data = [t for t in data if t.get("cluster_id") == scope]
        if enabled in ("0", "1"):
            flag = enabled == "1"
            data = [t for t in data if t.get("enabled") == flag]
        return jsonify({"data": data})
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        errors = _validate_target(body)
        if errors:
            return jsonify({"error": "; ".join(errors)}), 400
        target = {
            "id": _new_id("tgt-"),
            "cluster_id": body.get("cluster_id") or "__global__",
            "enabled": bool(body.get("enabled", True)),
            "host": (body.get("host") or "").strip(),
            "port": int(body.get("port", 514)),
            "protocol": body.get("protocol", "udp"),
            "tls": bool(body.get("tls", False)),
            "format": body.get("format", "rfc3164"),
            "template": (body.get("template") or "").strip(),
            "fallback_target_id": body.get("fallback_target_id") or "",
            "rate_limit": int(body.get("rate_limit") or 0) or None,
            "filter": body.get("filter") or {"rules": [], "presets": []},
            "order": len(targets),
        }
        targets.append(target)
        cfg["targets"] = targets
        cfg["version"] = _new_id("cfg-")
        cfg["updated_at"] = _now_iso()
        state["config"] = cfg
        _save_state(state)
        _record_audit("target.create", {}, target, target.get("cluster_id"), target.get("id"))
        return jsonify(target)
    if request.method == "PUT":
        body = request.get_json(silent=True) or {}
        target_id = (request.args.get("id", "") or body.get("id", "")).strip()
        if not target_id:
            return jsonify({"error": "id is required"}), 400
        for t in targets:
            if t.get("id") == target_id:
                previous = json.loads(json.dumps(t))
                for key, value in body.items():
                    if key == "id":
                        continue
                    if key in t:
                        t[key] = value
                errors = _validate_target(t)
                if errors:
                    return jsonify({"error": "; ".join(errors)}), 400
                cfg["version"] = _new_id("cfg-")
                cfg["updated_at"] = _now_iso()
                state["config"] = cfg
                _save_state(state)
                _record_audit("target.update", previous, t, t.get("cluster_id"), t.get("id"))
                _record_health(target_id, "ok" if t.get("enabled") else "paused")
                return jsonify(t)
        return jsonify({"error": "target not found"}), 404
    if request.method == "DELETE":
        body = request.get_json(silent=True) or {}
        target_id = (request.args.get("id", "") or body.get("id", "")).strip()
        if not target_id:
            return jsonify({"error": "id is required"}), 400
        for i, t in enumerate(targets):
            if t.get("id") == target_id:
                targets.pop(i)
                cfg["targets"] = targets
                cfg["version"] = _new_id("cfg-")
                cfg["updated_at"] = _now_iso()
                state["health"].pop(target_id, None)
                _save_state(state)
                _record_audit("target.delete", t, {}, t.get("cluster_id"), t.get("id"))
                return jsonify({"deleted": target_id})
        return jsonify({"error": "target not found"}), 404
    return jsonify({"error": "method not allowed"}), 405


def _targets_reorder():
    state = _load_state()
    cfg = state.get("config", DEFAULT_STATE["config"].copy())
    targets = cfg.get("targets", [])
    body = request.get_json(silent=True) or {}
    order = body.get("order", [])
    if not isinstance(order, list):
        return jsonify({"error": "order must be a list of ids"}), 400
    by_id = {t.get("id"): t for t in targets}
    missing = [i for i in order if i not in by_id]
    if missing:
        return jsonify({"error": f"unknown ids: {missing[:3]}"}), 400
    reordered = [by_id[i] for i in order]
    for extra in [t for t in targets if t.get("id") not in set(order)]:
        reordered.append(extra)
    for idx, t in enumerate(reordered):
        t["order"] = idx
    cfg["targets"] = reordered
    cfg["version"] = _new_id("cfg-")
    cfg["updated_at"] = _now_iso()
    state["config"] = cfg
    _save_state(state)
    _record_audit("target.reorder", {}, {"order": order})
    return jsonify({"data": reordered})


def _target_toggle():
    state = _load_state()
    cfg = state.get("config", DEFAULT_STATE["config"].copy())
    targets = cfg.get("targets", [])
    body = request.get_json(silent=True) or {}
    target_id = (request.args.get("id", "") or body.get("id", "")).strip()
    if not target_id:
        return jsonify({"error": "id is required"}), 400
    for t in targets:
        if t.get("id") == target_id:
            t["enabled"] = not t.get("enabled", True)
            cfg["version"] = _new_id("cfg-")
            cfg["updated_at"] = _now_iso()
            state["config"] = cfg
            _save_state(state)
            _record_audit("target.toggle", not t["enabled"], t["enabled"], t.get("cluster_id"), t.get("id"))
            _record_health(target_id, "ok" if t["enabled"] else "paused")
            return jsonify(t)
    return jsonify({"error": "target not found"}), 404


def _test_handler():
    state = _load_state()
    cfg = state.get("config", DEFAULT_STATE["config"].copy())
    body = request.get_json(silent=True) or {}
    target_id = (request.args.get("target_id", "") or body.get("target_id", "")).strip()
    message = body.get("message", "ProxmoxVEx test message")
    targets = cfg.get("targets", [])
    target = None
    for t in targets:
        if t.get("id") == target_id:
            target = t
            break
    if not target:
        return jsonify({"error": "target not found"}), 404
    if not target.get("enabled"):
        return jsonify({"error": "target is disabled"}), 400
    if cfg.get("paused"):
        return jsonify({"error": "forwarding is paused"}), 400
    result, latency_ms, error = _send_message(target, message)
    entry = {
        "id": _new_id("test-"),
        "target_id": target_id,
        "message": message,
        "result": result,
        "latency_ms": latency_ms,
        "error": error,
        "sent_at": _now_iso(),
    }
    log = state.setdefault("test_log", [])
    log.insert(0, entry)
    state["test_log"] = log[:1000]
    _save_state(state)
    _record_health(target_id, "ok" if result == "success" else result, last_send=_now_iso(), last_error=error)
    return jsonify(entry)


def _test_batch():
    state = _load_state()
    cfg = state.get("config", DEFAULT_STATE["config"].copy())
    body = request.get_json(silent=True) or {}
    target_ids = body.get("target_ids", [])
    message = body.get("message", "ProxmoxVEx batch test message")
    if not target_ids:
        return jsonify({"error": "target_ids is required"}), 400
    results = []
    for tid in target_ids:
        target = next((t for t in cfg.get("targets", []) if t.get("id") == tid), None)
        if not target:
            results.append({"target_id": tid, "result": "error", "error": "not found"})
            continue
        if not target.get("enabled"):
            results.append({"target_id": tid, "result": "error", "error": "disabled"})
            continue
        result, latency_ms, error = _send_message(target, message)
        entry = {
            "id": _new_id("test-"),
            "target_id": tid,
            "message": message,
            "result": result,
            "latency_ms": latency_ms,
            "error": error,
            "sent_at": _now_iso(),
        }
        log = state.setdefault("test_log", [])
        log.insert(0, entry)
        _record_health(tid, "ok" if result == "success" else result, last_send=_now_iso(), last_error=error)
        results.append(entry)
    state["test_log"] = log[:1000]
    _save_state(state)
    return jsonify({"results": results})


def _test_log_handler():
    state = _load_state()
    if request.method == "DELETE":
        state["test_log"] = []
        _save_state(state)
        return jsonify({"cleared": True})
    target_id = request.args.get("target_id", "").strip()
    try:
        limit = max(1, min(100, int(request.args.get("limit", 20))))
        offset = max(0, int(request.args.get("offset", 0)))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid pagination"}), 400
    log = state.get("test_log", [])
    if target_id:
        log = [e for e in log if e.get("target_id") == target_id]
    total = len(log)
    data = log[offset : offset + limit]
    return jsonify({"data": data, "total": total})


def _generate_test_logs():
    state = _load_state()
    body = request.get_json(silent=True) or {}
    count = min(50, max(1, int(body.get("count", 5))))
    target_id = body.get("target_id", "")
    messages = body.get("messages", [])
    if not messages:
        messages = [f"generated test log line {i + 1}" for i in range(count)]
    log = state.setdefault("test_log", [])
    for _i, msg in enumerate(messages[:count]):
        entry = {
            "id": _new_id("test-"),
            "target_id": target_id,
            "message": msg,
            "result": "success",
            "latency_ms": 0,
            "error": "",
            "sent_at": _now_iso(),
        }
        log.insert(0, entry)
    state["test_log"] = log[:1000]
    _save_state(state)
    return jsonify({"generated": len(messages[:count])})


def _health_handler():
    state = _load_state()
    cfg = state.get("config", DEFAULT_STATE["config"].copy())
    target_id = request.args.get("target_id", "").strip()
    cluster_id = request.args.get("cluster_id", "").strip()
    if cluster_id and cluster_id != "__global__" and not _valid_cluster_id(cluster_id):
        return jsonify({"error": "cluster_id is not accessible"}), 403
    targets = cfg.get("targets", [])
    if target_id:
        target = next((t for t in targets if t.get("id") == target_id), None)
        if not target:
            return jsonify({"error": "target not found"}), 404
        h = state.get("health", {}).get(
            target_id,
            {
                "target_id": target_id,
                "status": "ok" if target.get("enabled") else "paused",
                "last_send": None,
                "last_error": "",
                "throughput": {"messages_per_sec": 0, "bytes_per_sec": 0},
                "queue_depth": 0,
            },
        )
        return jsonify(h)
    data = []
    for t in targets:
        if cluster_id:
            scope = cluster_id if cluster_id != "__global__" else "__global__"
            if t.get("cluster_id") != scope:
                continue
        h = state.get("health", {}).get(
            t.get("id"),
            {
                "target_id": t.get("id"),
                "status": "ok" if t.get("enabled") else "paused",
                "last_send": None,
                "last_error": "",
                "throughput": {"messages_per_sec": 0, "bytes_per_sec": 0},
                "queue_depth": 0,
            },
        )
        data.append(h)
    return jsonify({"data": data})


def _diagnostics_handler():
    state = _load_state()
    cfg = state.get("config", DEFAULT_STATE["config"].copy())
    body = request.get_json(silent=True) or {}
    target_id = (request.args.get("target_id", "") or body.get("target_id", "")).strip()
    test_type = (request.args.get("type", "") or body.get("type", "")).strip()
    if not target_id or not test_type:
        return jsonify({"error": "target_id and type are required"}), 400
    target = next((t for t in cfg.get("targets", []) if t.get("id") == target_id), None)
    if not target:
        return jsonify({"error": "target not found"}), 404
    result = _diagnose(target, test_type)
    return jsonify({"target_id": target_id, "type": test_type, **result})


def _audit_log_handler():
    state = _load_state()
    try:
        limit = max(1, min(100, int(request.args.get("limit", 20))))
        offset = max(0, int(request.args.get("offset", 0)))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid pagination"}), 400
    logs = state.get("audit_log", [])
    cluster_id = request.args.get("cluster_id", "").strip()
    if cluster_id:
        logs = [a for a in logs if a.get("cluster_id") == cluster_id]
    total = len(logs)
    data = logs[offset : offset + limit]
    return jsonify({"data": data, "total": total})


def _config_export():
    state = _load_state()
    cfg = state.get("config", DEFAULT_STATE["config"].copy())
    cluster_id = request.args.get("cluster_id", "").strip()
    export = {
        "version": cfg.get("version"),
        "updated_at": cfg.get("updated_at"),
        "paused": cfg.get("paused", False),
        "targets": cfg.get("targets", []),
    }
    if cluster_id:
        scope = cluster_id if cluster_id != "__global__" else "__global__"
        export["targets"] = [t for t in export["targets"] if t.get("cluster_id") == scope]
    # Sanitize certificate PEMs if any are added later.
    for t in export["targets"]:
        t.pop("_server_pem", None)
    return jsonify(export)


def _config_import():
    state = _load_state()
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        return jsonify({"error": "import body must be a JSON object"}), 400
    previous = json.loads(json.dumps(state.get("config", {})))
    targets = body.get("targets", [])
    if not isinstance(targets, list):
        return jsonify({"error": "targets must be a list"}), 400
    for t in targets:
        if not t.get("id"):
            t["id"] = _new_id("tgt-")
        t.pop("_server_pem", None)
        errors = _validate_target(t)
        if errors:
            return jsonify({"error": "; ".join(errors)}), 400
    cfg = state.get("config", DEFAULT_STATE["config"].copy())
    cfg["targets"] = targets
    cfg["paused"] = bool(body.get("paused", cfg.get("paused", False)))
    cfg["version"] = _new_id("cfg-")
    cfg["updated_at"] = _now_iso()
    state["config"] = cfg
    _save_state(state)
    _record_audit("config.import", previous.get("targets"), cfg.get("targets"))
    presets = sum(len((t.get("filter") or {}).get("presets", [])) for t in targets)
    return jsonify({
        "imported": {
            "targets": len(targets),
            "presets": presets,
        }
    })


def _pause_handler():
    state = _load_state()
    cfg = state.get("config", DEFAULT_STATE["config"].copy())
    body = request.get_json(silent=True) or {}
    previous = cfg.get("paused", False)
    cfg["paused"] = bool(body.get("paused", not previous))
    cfg["version"] = _new_id("cfg-")
    cfg["updated_at"] = _now_iso()
    state["config"] = cfg
    _save_state(state)
    _record_audit("config.pause", previous, cfg["paused"])
    return jsonify({"paused": cfg["paused"]})


def _filter_validate():
    body = request.get_json(silent=True) or {}
    rules = body.get("rules", [])
    errors = _validate_filter_rules(rules)
    return jsonify({"valid": not errors, "errors": errors})


def _filter_test():
    body = request.get_json(silent=True) or {}
    rules = body.get("rules", [])
    messages = body.get("messages", [])
    if not isinstance(messages, list):
        return jsonify({"error": "messages must be a list"}), 400
    matched = 0
    results = []
    for msg in messages:
        ok = _filter_matches(rules, msg)
        if ok:
            matched += 1
        results.append({"message": msg, "matched": ok})
    return jsonify({"matched": matched, "total": len(messages), "results": results})


def _copy_to_cluster():
    state = _load_state()
    body = request.get_json(silent=True) or {}
    source_id = body.get("source_id", "").strip()
    target_cluster = body.get("target_cluster", "").strip()
    if not source_id or not target_cluster:
        return jsonify({"error": "source_id and target_cluster are required"}), 400
    if not _valid_cluster_id(target_cluster):
        return jsonify({"error": "target_cluster is not accessible"}), 403
    cfg = state.get("config", DEFAULT_STATE["config"].copy())
    source = next((t for t in cfg.get("targets", []) if t.get("id") == source_id), None)
    if not source:
        return jsonify({"error": "source target not found"}), 404
    new_target = json.loads(json.dumps(source))
    new_target["id"] = _new_id("tgt-")
    new_target["cluster_id"] = target_cluster
    new_target["enabled"] = False
    new_target["order"] = len(cfg.get("targets", []))
    cfg["targets"].append(new_target)
    cfg["version"] = _new_id("cfg-")
    cfg["updated_at"] = _now_iso()
    state["config"] = cfg
    _save_state(state)
    _record_audit("target.copy", source, new_target, target_cluster, new_target["id"])
    return jsonify({"data": new_target})


def _get_clusters():
    """Return clusters that can host syslog targets."""
    from ProxmoxVEx.globals import cluster_managers

    out = []
    for cid, mgr in cluster_managers.items():
        ok, _ = check_cluster_access(cid)
        if not ok:
            continue
        config = getattr(mgr, "config", None)
        name = getattr(config, "name", "") or cid
        out.append({
            "id": cid,
            "name": name,
            "connected": getattr(mgr, "is_connected", False),
            "host": getattr(mgr, "host", "") or "",
        })
    return {"clusters": sorted(out, key=lambda c: c["name"].lower())}


def _get_ui():
    """Serve the Syslog/SIEM Forwarder HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    _init_state()
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "config", _config_handler)
    register_plugin_route(PLUGIN_ID, "targets", _targets_handler)
    register_plugin_route(PLUGIN_ID, "targets/reorder", _targets_reorder)
    register_plugin_route(PLUGIN_ID, "targets/toggle", _target_toggle)
    register_plugin_route(PLUGIN_ID, "test", _test_handler)
    register_plugin_route(PLUGIN_ID, "test/batch", _test_batch)
    register_plugin_route(PLUGIN_ID, "test-log", _test_log_handler)
    register_plugin_route(PLUGIN_ID, "test/generate", _generate_test_logs)
    register_plugin_route(PLUGIN_ID, "health", _health_handler)
    register_plugin_route(PLUGIN_ID, "diagnostics", _diagnostics_handler)
    register_plugin_route(PLUGIN_ID, "audit-log", _audit_log_handler)
    register_plugin_route(PLUGIN_ID, "config/export", _config_export)
    register_plugin_route(PLUGIN_ID, "config/import", _config_import)
    register_plugin_route(PLUGIN_ID, "pause", _pause_handler)
    register_plugin_route(PLUGIN_ID, "filter/validate", _filter_validate)
    register_plugin_route(PLUGIN_ID, "filter/test", _filter_test)
    register_plugin_route(PLUGIN_ID, "copy-to-cluster", _copy_to_cluster)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
