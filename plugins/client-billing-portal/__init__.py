# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/client-billing-portal/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Client Billing Portal - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Client Billing Portal - full UI management backend.
Client-facing portal for usage, invoices, and payment status.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "client-billing-portal"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
DATA_FILE = PLUGIN_DIR / "state.json"

DEFAULT_STATE = {
    "clients": [{"id": "client-001", "name": "Acme Corp"}],
    "invoices": [],
    "usage": [],
    "payments": [],
}


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_state():
    if not DATA_FILE.exists():
        return json.loads(json.dumps(DEFAULT_STATE))
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
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
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        log.error("[%s] Failed to save state: %s", PLUGIN_ID, e)


def _get_status():
    """Return billing summary including outstanding pending invoice totals."""
    state = _load_state()
    invoices = state.get("invoices", [])
    pending = [i for i in invoices if i.get("status") in ("pending", "sent", "unpaid")]
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "clients_count": len(state.get("clients", [])),
        "invoices_count": len(invoices),
        "pending_count": len(pending),
        "pending_total": round(sum(i.get("total", 0.0) for i in pending), 4),
    }


def _get_clients():
    state = _load_state()
    return {"clients": state.get("clients", [])}


def _get_invoices():
    client_id = request.args.get("client_id", "").strip()
    if not client_id:
        return jsonify({"error": "client_id is required"}), 400
    state = _load_state()
    invoices = [i for i in state.get("invoices", []) if i.get("client_id") == client_id]
    status = (request.args.get("status") or "").strip().lower()
    sort = (request.args.get("sort") or "date").strip()
    order = (request.args.get("order") or "desc").strip()
    if status:
        invoices = [i for i in invoices if i.get("status") == status]
    rev = order == "desc"
    invoices.sort(key=lambda i: str(i.get(sort, "")), reverse=rev)
    return {"client_id": client_id, "invoices": invoices}


def _post_invoice():
    body = request.get_json(silent=True) or {}
    client_id = (body.get("client_id") or "").strip()
    if not client_id:
        return jsonify({"error": "client_id is required"}), 400
    total = body.get("total")
    try:
        total = float(total)
        if total < 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "total must be a non-negative number"}), 400
    state = _load_state()
    invoice = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "date": _now(),
        "total": round(total, 4),
        "status": "pending",
        "items": body.get("items", []),
    }
    state["invoices"].append(invoice)
    _save_state(state)
    return {"invoice": invoice}


def _invoice_handler():
    if request.method == "GET":
        return _get_invoices()
    if request.method == "POST":
        return _post_invoice()
    if request.method == "DELETE":
        body = request.get_json(silent=True) or {}
        invoice_id = body.get("invoice_id")
        if not invoice_id:
            return jsonify({"error": "invoice_id is required"}), 400
        state = _load_state()
        state["invoices"] = [i for i in state["invoices"] if i.get("id") != invoice_id]
        _save_state(state)
        return {"deleted": invoice_id}
    return jsonify({"error": "Method not allowed"}), 405


def _get_usage():
    client_id = request.args.get("client_id", "").strip()
    if not client_id:
        return jsonify({"error": "client_id is required"}), 400
    state = _load_state()
    usage = [u for u in state.get("usage", []) if u.get("client_id") == client_id]
    resource = (request.args.get("resource") or "").strip().lower()
    if resource:
        usage = [u for u in usage if (u.get("resource") or "").lower() == resource]
    total = sum(u.get("cost", 0.0) for u in usage)
    return {"client_id": client_id, "usage": usage, "total": round(total, 4)}


def _get_payments():
    client_id = request.args.get("client_id", "").strip()
    if not client_id:
        return jsonify({"error": "client_id is required"}), 400
    state = _load_state()
    payments = [p for p in state.get("payments", []) if p.get("client_id") == client_id]
    return {"client_id": client_id, "payments": payments}


def _payment_handler():
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        client_id = (body.get("client_id") or "").strip()
        invoice_id = (body.get("invoice_id") or "").strip()
        amount = body.get("amount")
        if not client_id or not invoice_id or amount is None:
            return jsonify({"error": "client_id, invoice_id and amount are required"}), 400
        try:
            amount = float(amount)
            if amount <= 0:
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({"error": "amount must be a positive number"}), 400
        state = _load_state()
        payment = {"client_id": client_id, "invoice_id": invoice_id, "amount": round(amount, 4), "timestamp": _now()}
        state["payments"].append(payment)
        for inv in state["invoices"]:
            if inv.get("id") == invoice_id and inv.get("client_id") == client_id:
                inv["status"] = "paid"
                break
        _save_state(state)
        return {"payment": payment}
    return jsonify({"error": "Method not allowed"}), 405


def _mark_paid_handler():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    invoice_id = body.get("invoice_id")
    if not invoice_id:
        return jsonify({"error": "invoice_id is required"}), 400
    state = _load_state()
    for inv in state["invoices"]:
        if inv.get("id") == invoice_id:
            inv["status"] = "paid"
            _save_state(state)
            return {"invoice": inv}
    return jsonify({"error": "Invoice not found"}), 404


def _void_handler():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    invoice_id = body.get("invoice_id")
    if not invoice_id:
        return jsonify({"error": "invoice_id is required"}), 400
    state = _load_state()
    for inv in state["invoices"]:
        if inv.get("id") == invoice_id:
            inv["status"] = "void"
            _save_state(state)
            return {"invoice": inv}
    return jsonify({"error": "Invoice not found"}), 404


def _get_ui():
    """Serve the Client Billing Portal HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clients", _get_clients)
    register_plugin_route(PLUGIN_ID, "invoices", _invoice_handler)
    register_plugin_route(PLUGIN_ID, "usage", _get_usage)
    register_plugin_route(PLUGIN_ID, "payments", _get_payments)
    register_plugin_route(PLUGIN_ID, "payment", _payment_handler)
    register_plugin_route(PLUGIN_ID, "mark-paid", _mark_paid_handler)
    register_plugin_route(PLUGIN_ID, "void", _void_handler)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
