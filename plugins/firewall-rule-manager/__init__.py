# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/firewall-rule-manager/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Firewall Rule Manager - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Firewall Rule Manager - full UI management backend.
Manage firewall rule entries and simulate/apply them to a cluster or network.
"""

import json
import logging
import uuid
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "firewall-rule-manager"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")

PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "rules.json"

PROTOCOLS = {"tcp", "udp", "icmp"}
ACTIONS = {"accept", "deny"}


def _load_state(default=None):
    if default is None:
        default = []
    if not STATE_FILE.exists():
        return default
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return default


def _save_state(data):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _port_valid(port):
    if not port:
        return True
    for part in port.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            if not (a.isdigit() and b.isdigit() and 1 <= int(a) <= 65535 and 1 <= int(b) <= 65535 and int(a) <= int(b)):
                return False
        elif not (part.isdigit() and 1 <= int(part) <= 65535):
            return False
    return True


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
    rules = _load_state([])
    enabled = [r for r in rules if r.get("enabled")]
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "rules_count": len(rules),
        "enabled_count": len(enabled),
    }


def _filter_rules(rules, query, protocol, action, enabled):
    out = []
    for r in rules:
        if (
            query
            and query.lower() not in r.get("name", "").lower()
            and query not in r.get("source", "")
            and query not in r.get("destination", "")
        ):
            continue
        if protocol and r.get("protocol") != protocol:
            continue
        if action and r.get("action") != action:
            continue
        if enabled is not None and bool(r.get("enabled")) != enabled:
            continue
        out.append(r)
    return out


def _rules_handler():
    method = request.method
    rules = _load_state([])

    if method == "GET":
        rule_id = request.args.get("id")
        if rule_id:
            for rule in rules:
                if rule.get("id") == rule_id:
                    return {"data": rule}
            return jsonify({"error": "Rule not found"}), 404
        query = (request.args.get("q") or "").strip()
        protocol = (request.args.get("protocol") or "").strip().lower()
        action = (request.args.get("action") or "").strip().lower()
        enabled = request.args.get("enabled")
        if enabled is not None:
            enabled = enabled.lower() in ("true", "1", "yes")
        filtered = _filter_rules(rules, query, protocol, action, enabled)
        sort = (request.args.get("sort") or "name").strip()
        order = (request.args.get("order") or "asc").strip()
        rev = order == "desc"
        filtered.sort(key=lambda r: r.get(sort, "").lower(), reverse=rev)
        return {"data": filtered}

    if method == "POST":
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        if not name:
            return jsonify({"error": "'name' is required"}), 400
        port = (body.get("port") or "").strip()
        if not _port_valid(port):
            return jsonify({"error": "'port' is invalid"}), 400
        protocol = (body.get("protocol") or "tcp").strip().lower()
        action = (body.get("action") or "accept").strip().lower()
        if protocol not in PROTOCOLS:
            return jsonify({"error": "'protocol' must be tcp, udp, or icmp"}), 400
        if action not in ACTIONS:
            return jsonify({"error": "'action' must be accept or deny"}), 400
        rule = {
            "id": str(uuid.uuid4()),
            "name": name,
            "source": (body.get("source") or "").strip(),
            "destination": (body.get("destination") or "").strip(),
            "port": port,
            "protocol": protocol,
            "action": action,
            "enabled": bool(body.get("enabled", True)),
            "description": (body.get("description") or "").strip(),
        }
        rules.append(rule)
        _save_state(rules)
        return {"data": rule}

    if method == "PUT":
        body = request.get_json(silent=True) or {}
        rule_id = body.get("id")
        if not rule_id:
            return jsonify({"error": "'id' is required"}), 400
        for rule in rules:
            if rule.get("id") == rule_id:
                for key in ("name", "source", "destination", "port", "protocol", "action", "description"):
                    if key in body:
                        rule[key] = str(body[key]).strip()
                if "port" in body and not _port_valid(rule["port"]):
                    return jsonify({"error": "'port' is invalid"}), 400
                if "protocol" in body and rule["protocol"] not in PROTOCOLS:
                    return jsonify({"error": "'protocol' must be tcp, udp, or icmp"}), 400
                if "action" in body and rule["action"] not in ACTIONS:
                    return jsonify({"error": "'action' must be accept or deny"}), 400
                if "enabled" in body:
                    rule["enabled"] = bool(body["enabled"])
                _save_state(rules)
                return {"data": rule}
        return jsonify({"error": "Rule not found"}), 404

    if method == "DELETE":
        rule_id = request.args.get("id") or (request.get_json(silent=True) or {}).get("id")
        if not rule_id:
            return jsonify({"error": "'id' is required"}), 400
        for idx, rule in enumerate(rules):
            if rule.get("id") == rule_id:
                rules.pop(idx)
                _save_state(rules)
                return {"deleted": rule_id}
        return jsonify({"error": "Rule not found"}), 404

    return jsonify({"error": "Method not allowed"}), 405


def _test_handler():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405

    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    rule_id = body.get("rule_id")

    if not cluster_id:
        return jsonify({"error": "'cluster_id' is required"}), 400

    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err

    manager, err = get_connected_manager(cluster_id)
    if err:
        return err

    rules = _load_state([])
    rule = next((r for r in rules if r.get("id") == rule_id), None)
    if rule_id and not rule:
        return jsonify({"error": "Rule not found"}), 404
    if rule and not rule.get("enabled"):
        return jsonify({"error": "Rule is disabled"}), 403

    return {
        "simulated": True,
        "cluster_id": cluster_id,
        "cluster_node": manager.host,
        "rule": rule,
        "target_network": body.get("network", "default"),
        "result": "Rule would be applied to cluster firewall",
    }


def _apply_handler():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    rule_ids = body.get("rule_ids") or []
    if not cluster_id:
        return jsonify({"error": "'cluster_id' is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    manager, err = get_connected_manager(cluster_id)
    if err:
        return err
    rules = _load_state([])
    applied = []
    skipped = []
    for r in rules:
        if r.get("id") in rule_ids:
            if r.get("enabled"):
                applied.append(r)
            else:
                skipped.append({"id": r["id"], "reason": "disabled"})
    return {
        "applied": applied,
        "skipped": skipped,
        "cluster_id": cluster_id,
        "cluster_node": manager.host,
    }


def _get_ui():
    """Serve the Firewall Rule Manager HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "rules", _rules_handler)
    register_plugin_route(PLUGIN_ID, "test", _test_handler)
    register_plugin_route(PLUGIN_ID, "apply", _apply_handler)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[%s] Plugin registered", PLUGIN_ID)
