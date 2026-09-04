# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/webhook-router/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Webhook Router - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Webhook Router - full UI management backend.
Route ProxmoxVEx events to arbitrary HTTP endpoints with filtering,
retries, and signatures.
"""

import json
import logging
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from flask import jsonify, request, send_file

from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "webhook-router"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
DATA_FILE = PLUGIN_DIR / "state.json"
_state_lock = threading.RLock()
_worker_started = False

DEFAULT_STATE = {
    "endpoints": [],
    "deliveries": [],
}


def _now():
    return datetime.now(timezone.utc)


def _load_state():
    if not DATA_FILE.exists():
        return json.loads(json.dumps(DEFAULT_STATE))
    try:
        with open(DATA_FILE) as f:
            data = json.load(f)
    except Exception as e:
        log.warning("[%s] Failed to load state: %s", PLUGIN_ID, e)
        return json.loads(json.dumps(DEFAULT_STATE))
    for key, value in DEFAULT_STATE.items():
        if key not in data:
            data[key] = value
    return data


def _save_state(data):
    try:
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(DATA_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        log.error("[%s] Failed to save state: %s", PLUGIN_ID, e)


def _is_valid_url(url):
    try:
        result = urlparse(url)
        return result.scheme in ("http", "https") and bool(result.netloc)
    except Exception:
        return False


def _get_status():
    state = _load_state()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "endpoint_count": len(state.get("endpoints", [])),
        "delivery_count": len(state.get("deliveries", [])),
    }


def _get_endpoints():
    state = _load_state()
    return {"endpoints": state.get("endpoints", [])}


def _upsert_endpoint():
    body = request.get_json(silent=True) or {}
    eid = (body.get("id") or "").strip()
    name = (body.get("name") or "").strip()
    url = (body.get("url") or "").strip()
    events = body.get("events", [])
    if not name:
        return jsonify({"error": "name is required"}), 400
    if not url:
        return jsonify({"error": "url is required"}), 400
    if not _is_valid_url(url):
        return jsonify({"error": "url must be a valid HTTP(S) URL"}), 400
    if not isinstance(events, list):
        return jsonify({"error": "events must be a list"}), 400
    state = _load_state()
    existing = next((e for e in state["endpoints"] if e.get("id") == eid), None)
    for e in state["endpoints"]:
        if e.get("name") == name and e.get("id") != eid:
            return jsonify({"error": "name must be unique"}), 400
    endpoint = {
        "id": eid or f"ep-{uuid.uuid4().hex[:8]}",
        "name": name,
        "url": url,
        "events": events,
        "enabled": bool(body.get("enabled", True)),
        "filter": body.get("filter", ""),
        "retries": max(0, int(body.get("retries", 3))),
        "secret": body.get("secret", ""),
        "created_at": existing.get("created_at") if existing else _now().isoformat(),
        "updated_at": _now().isoformat(),
    }
    if existing:
        for idx, e in enumerate(state["endpoints"]):
            if e.get("id") == eid:
                state["endpoints"][idx] = endpoint
                break
    else:
        state["endpoints"].append(endpoint)
    _save_state(state)
    return {"endpoint": endpoint, "saved": True}


def _delete_endpoint():
    eid = (request.get_json(silent=True) or {}).get("id") or request.args.get("id")
    if not eid:
        return jsonify({"error": "id is required"}), 400
    state = _load_state()
    for idx, e in enumerate(state["endpoints"]):
        if e.get("id") == eid:
            state["endpoints"].pop(idx)
            _save_state(state)
            return {"deleted": eid}
    return jsonify({"error": "Endpoint not found"}), 404


def _test_endpoint():
    body = request.get_json(silent=True) or {}
    endpoint_id = (body.get("id") or "").strip()
    url = (body.get("url") or "").strip()
    if not endpoint_id and not url:
        return jsonify({"error": "id or url is required"}), 400
    state = _load_state()
    endpoint = None
    if endpoint_id:
        for e in state.get("endpoints", []):
            if e.get("id") == endpoint_id:
                endpoint = e
                break
        if not endpoint:
            return jsonify({"error": "Endpoint not found"}), 404
    else:
        if not _is_valid_url(url):
            return jsonify({"error": "manual url must be valid HTTP(S)"}), 400
        endpoint = {"id": "manual", "url": url, "name": "manual"}
    payload = body.get("payload", {})
    if not isinstance(payload, dict):
        return jsonify({"error": "payload must be a JSON object"}), 400
    delivery = {
        "id": f"dlv-{uuid.uuid4().hex[:8]}",
        "endpoint_id": endpoint.get("id"),
        "endpoint_name": endpoint.get("name"),
        "url": endpoint.get("url"),
        "status": "queued",
        "timestamp": _now().isoformat(),
        "payload": payload,
    }
    state["deliveries"].insert(0, delivery)
    _save_state(state)
    return {"delivery": delivery, "endpoint": endpoint}


def _get_deliveries():
    endpoint_id = request.args.get("endpoint_id", "").strip()
    state = _load_state()
    deliveries = state.get("deliveries", [])
    if endpoint_id:
        deliveries = [d for d in deliveries if d.get("endpoint_id") == endpoint_id]
    return {"deliveries": deliveries}


def _endpoint_handler():
    if request.method == "POST":
        return _upsert_endpoint()
    if request.method == "GET":
        return _get_endpoints()
    if request.method == "DELETE":
        return _delete_endpoint()
    return jsonify({"error": "Method not allowed"}), 405


def _process_delivery(delivery, state):
    endpoints = state.get("endpoints", [])
    endpoint = next((e for e in endpoints if e.get("id") == delivery.get("endpoint_id")), None)
    if not endpoint:
        delivery["status"] = "failed"
        delivery["error"] = "endpoint not found"
        delivery["finished"] = _now().isoformat()
        return
    if not endpoint.get("enabled", True):
        delivery["status"] = "skipped"
        delivery["finished"] = _now().isoformat()
        return

    url = endpoint.get("url")
    payload = delivery.get("payload", {})
    max_retries = max(0, int(endpoint.get("retries", 0)))
    attempts = 0
    delivered = False
    last_error = ""
    while attempts <= max_retries and not delivered:
        attempts += 1
        try:
            resp = requests.post(url, json=payload, timeout=10)
            delivery["response_status"] = resp.status_code
            if 200 <= resp.status_code < 300:
                delivered = True
            else:
                last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
        except requests.RequestException as exc:
            last_error = str(exc)
        if not delivered and attempts <= max_retries:
            time.sleep(1)

    delivery["attempts"] = attempts
    delivery["status"] = "delivered" if delivered else "failed"
    delivery["last_error"] = last_error
    delivery["finished"] = _now().isoformat()


def _run_queued_deliveries():
    with _state_lock:
        state = _load_state()
        changed = False
        for delivery in list(state.get("deliveries", [])):
            if delivery.get("status") == "queued":
                _process_delivery(delivery, state)
                changed = True
        if changed:
            _save_state(state)


def _delivery_worker():
    while True:
        try:
            _run_queued_deliveries()
        except Exception:
            log.exception("[%s] worker error", PLUGIN_ID)
        try:
            time.sleep(5)
        except Exception:
            break


def start_background_tasks(app=None):
    global _worker_started
    with _state_lock:
        if _worker_started:
            return
        _worker_started = True
    t = threading.Thread(target=_delivery_worker, daemon=True, name=f"{PLUGIN_ID}-worker")
    t.start()
    log.info("[%s] background worker started", PLUGIN_ID)


def _get_ui():
    """Serve the Webhook Router HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "endpoints", _endpoint_handler)
    register_plugin_route(PLUGIN_ID, "test", _test_endpoint)
    register_plugin_route(PLUGIN_ID, "deliveries", _get_deliveries)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    start_background_tasks()
    log.info("[%s] plugin registered", PLUGIN_ID)
