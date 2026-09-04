# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/cost-chargeback/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Cost Chargeback - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Cost Chargeback - full UI management backend.
Calculate VM/LXC running costs by CPU, RAM, storage, network, and power
and allocate to tenants.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "cost-chargeback"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
DATA_FILE = PLUGIN_DIR / "state.json"

DEFAULT_STATE = {
    "rates": {
        "cpu_per_core_hour": 0.05,
        "ram_per_gb_hour": 0.02,
        "storage_per_gb_hour": 0.001,
        "network_per_gb": 0.01,
        "power_per_kwh": 0.15,
    },
    "allocations": [],
    "invoices": [],
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


def _get_manager_or_error(cluster_id):
    if not cluster_id:
        return None, (jsonify({"error": "cluster_id is required"}), 400)
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return None, err
    return get_connected_manager(cluster_id)


def _get_clusters():
    """Return clusters with configured names."""
    from ProxmoxVEx.globals import cluster_managers

    try:
        clusters = []
        for cid, mgr in (cluster_managers or {}).items():
            config = getattr(mgr, "config", None)
            name = getattr(config, "name", "") or cid
            clusters.append({"id": cid, "name": name})
        return {"clusters": clusters}
    except Exception:
        return {"clusters": []}


def _get_status():
    state = _load_state()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "rates": state.get("rates", DEFAULT_STATE["rates"]),
    }


def _filter_by_date(items, from_param, to_param):
    from_str = (request.args.get(from_param) or "").strip()
    to_str = (request.args.get(to_param) or "").strip()
    if not from_str and not to_str:
        return items
    result = []
    for it in items:
        d = it.get("date")
        if not d:
            continue
        if from_str and d < from_str:
            continue
        if to_str and d > to_str:
            continue
        result.append(it)
    return result


def _get_report():
    cluster_id = request.args.get("cluster_id", "").strip()
    manager, err = _get_manager_or_error(cluster_id)
    if err:
        return err
    try:
        state = _load_state()
        rates = state.get("rates", {})
        allocations = [a for a in state.get("allocations", []) if a.get("cluster_id") == cluster_id]
        allocations = _filter_by_date(allocations, "from", "to")
        sort = (request.args.get("sort") or "vm").strip()
        order = (request.args.get("order") or "asc").strip()
        rev = order == "desc"
        allocations.sort(
            key=lambda a: (
                float(a.get(sort, 0)) if isinstance(a.get(sort), (int, float)) else str(a.get(sort, "")).lower()
            ),
            reverse=rev,
        )
        total = sum(a.get("cost", 0.0) for a in allocations)
        return {
            "cluster_id": cluster_id,
            "manager_host": manager.host,
            "rates": rates,
            "allocations": allocations,
            "total_cost": round(total, 4),
        }
    except Exception as e:
        log.exception("[%s] report error", cluster_id)
        return jsonify({"error": safe_error(e, "Report generation failed")}), 500


def _set_rate():
    body = request.get_json(silent=True) or {}
    required = ["cpu_per_core_hour", "ram_per_gb_hour", "storage_per_gb_hour", "network_per_gb", "power_per_kwh"]
    missing = [f for f in required if f not in body]
    if missing:
        return jsonify({"error": "Missing required fields", "missing": missing}), 400
    try:
        rates = {k: float(body[k]) for k in required}
    except (TypeError, ValueError):
        return jsonify({"error": "All rate fields must be numbers"}), 400
    for k, v in rates.items():
        if v < 0:
            return jsonify({"error": f"{k} must be non-negative"}), 400
    state = _load_state()
    state["rates"] = rates
    _save_state(state)
    return {"rates": rates}


def _get_invoices():
    state = _load_state()
    invoices = state.get("invoices", [])
    sort = (request.args.get("sort") or "date").strip()
    order = (request.args.get("order") or "desc").strip()
    rev = order == "desc"
    invoices.sort(
        key=lambda i: float(i.get(sort, 0)) if isinstance(i.get(sort), (int, float)) else str(i.get(sort, "")).lower(),
        reverse=rev,
    )
    return {"invoices": invoices}


def _create_invoice():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    tenant = (body.get("tenant") or "").strip()
    total = body.get("total")
    if not cluster_id or not tenant or total is None:
        return jsonify({"error": "cluster_id, tenant, and total are required"}), 400
    try:
        total = float(total)
        if total < 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "total must be a non-negative number"}), 400
    state = _load_state()
    inv = {
        "id": str(uuid.uuid4()),
        "cluster_id": cluster_id,
        "tenant": tenant,
        "period": (body.get("period") or "").strip(),
        "total": round(total, 4),
        "status": "pending",
        "date": _now(),
    }
    state["invoices"].append(inv)
    _save_state(state)
    return {"invoice": inv}


def _get_summary():
    cluster_id = request.args.get("cluster_id", "").strip()
    manager, err = _get_manager_or_error(cluster_id)
    if err:
        return err
    try:
        state = _load_state()
        allocations = [a for a in state.get("allocations", []) if a.get("cluster_id") == cluster_id]
        allocations = _filter_by_date(allocations, "from", "to")
        totals = {}
        for a in allocations:
            tenant = a.get("tenant", "unallocated")
            totals[tenant] = totals.get(tenant, 0.0) + a.get("cost", 0.0)
        grand = sum(totals.values())
        rows = [
            {"tenant": k, "cost": round(v, 4), "percent": round((v / grand * 100), 2) if grand else 0}
            for k, v in totals.items()
        ]
        return {
            "cluster_id": cluster_id,
            "manager_host": manager.host,
            "tenants": rows,
            "total": round(grand, 4),
        }
    except Exception as e:
        log.exception("[%s] summary error", cluster_id)
        return jsonify({"error": safe_error(e, "Summary failed")}), 500


def _get_ui():
    """Serve the Cost Chargeback HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "report", _get_report)
    register_plugin_route(PLUGIN_ID, "rate", _set_rate)
    register_plugin_route(PLUGIN_ID, "invoices", _create_invoice)
    register_plugin_route(PLUGIN_ID, "invoice-list", _get_invoices)
    register_plugin_route(PLUGIN_ID, "summary", _get_summary)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
