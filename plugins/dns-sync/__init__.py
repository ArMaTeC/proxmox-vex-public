# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/dns-sync/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: DNS Sync - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
DNS Sync - full UI management backend.
Sync DNS zones and records with live cluster VM hostnames and export
BIND/dnsmasq-compatible zone files so the records can be used by real
name servers.
"""

import ipaddress
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "dns-sync"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")

PLUGIN_DIR = Path(__file__).parent
ZONES_FILE = PLUGIN_DIR / "zones.json"
CONFIG_FILE = PLUGIN_DIR / "config.json"

DEFAULT_TTL = 300
DEFAULT_PRIMARY_NS = "ns1"
DEFAULT_ADMIN_EMAIL = "admin"
RECORD_TYPES = {"A", "AAAA", "PTR", "CNAME", "MX", "TXT", "NS", "SOA"}


def _load_state():
    if not ZONES_FILE.exists():
        return []
    try:
        with open(ZONES_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return []


def _save_state(data):
    ZONES_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(ZONES_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _load_config():
    if not CONFIG_FILE.exists():
        return {}
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load config: %s", e)
        return {}


def _config_value(key, default=None):
    return _load_config().get(key, default)


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
    zones = _load_state()
    records = sum(len(z.get("records", [])) for z in zones)
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "zones_count": len(zones),
        "records_count": records,
    }


def _filter_zones(zones, zone_type):
    if not zone_type:
        return zones
    return [z for z in zones if z.get("type") == zone_type]


def _normalize_zone_name(name):
    """Return a canonical zone name (lowercase, absolute, trailing dot)."""
    name = (name or "").strip().lower()
    if name and not name.endswith("."):
        name += "."
    return name


def _is_valid_ip(ip):
    if not ip or not isinstance(ip, str):
        return False
    try:
        ipaddress.ip_address(ip)
        return True
    except ValueError:
        return False


def _ptr_for_ip(ip):
    """Return the DNS reverse pointer (FQDN with trailing dot) for an IP."""
    try:
        addr = ipaddress.ip_address(ip)
        return f"{addr.reverse_pointer}."
    except ValueError:
        return None


def _sanitize_label(label):
    """Convert an arbitrary VM name into a valid DNS host label."""
    label = (label or "").lower()
    label = re.sub(r"[^a-z0-9-]", "-", label)
    label = re.sub(r"-+", "-", label).strip("-")
    if not label or not re.match(r"^[a-z]", label):
        label = f"vm-{label or 'host'}"
    return label


def _record_fqdn(label, zone_name):
    """Return a fully-qualified record name under a zone."""
    zone = _normalize_zone_name(zone_name)
    if not zone:
        return None
    return f"{_sanitize_label(label)}.{zone}"


def _soa_admin(admin_email, zone_name):
    """Turn an email-like string into a DNS SOA RNAME (e.g. admin.example.com.)."""
    zone = _normalize_zone_name(zone_name).rstrip(".")
    admin = (admin_email or "admin").replace("@", ".").rstrip(".").lower()
    if "." not in admin:
        admin = f"{admin}.{zone}"
    return f"{admin}."


def _ns_fqdn(primary_ns, zone_name):
    """Return a fully-qualified primary NS name for a zone."""
    zone = _normalize_zone_name(zone_name).rstrip(".")
    ns = (primary_ns or "ns1").rstrip(".").lower()
    if "." not in ns:
        ns = f"{ns}.{zone}"
    return f"{ns}."


def _desired_records_for_zone(vms, zone, cfg):
    """Build the desired record set for a zone from live VM data."""
    zone_name = _normalize_zone_name(zone.get("name"))
    zone_type = zone.get("type", "forward")
    default_ttl = cfg.get("default_ttl", DEFAULT_TTL) if cfg else DEFAULT_TTL
    ptr_target = _normalize_zone_name(zone.get("ptr_target")) if zone.get("ptr_target") else None
    desired = []
    for v in vms:
        vm_name = _sanitize_label(v.get("name"))
        if not vm_name:
            continue
        if zone_type == "forward":
            for field, rtype in (("ip", "A"), ("ip6", "AAAA")):
                ip = v.get(field)
                if _is_valid_ip(ip):
                    desired.append({
                        "name": _record_fqdn(vm_name, zone_name),
                        "type": rtype,
                        "value": ip,
                        "ttl": default_ttl,
                        "vmid": v.get("vmid"),
                    })
        elif zone_type == "reverse" and zone_name:
            for field in ("ip", "ip6"):
                ip = v.get(field)
                if not _is_valid_ip(ip):
                    continue
                ptr = _ptr_for_ip(ip)
                if not ptr or not ptr.endswith(_normalize_zone_name(zone_name)):
                    continue
                target = _record_fqdn(vm_name, ptr_target) if ptr_target else f"{vm_name}.local."
                desired.append({
                    "name": ptr,
                    "type": "PTR",
                    "value": target,
                    "ttl": default_ttl,
                    "vmid": v.get("vmid"),
                })
    return desired


def _reconcile_records(existing, desired):
    """Compare existing records with desired records and return (to_add, to_remove)."""
    existing_by_key = {(r.get("name"), r.get("type")): r for r in existing}
    desired_by_key = {(d.get("name"), d.get("type")): d for d in desired}
    to_add = []
    to_remove = []
    for key, d in desired_by_key.items():
        ex = existing_by_key.get(key)
        if not ex:
            to_add.append(d)
        elif ex.get("value") != d.get("value") or ex.get("ttl") != d.get("ttl"):
            d["id"] = ex["id"]
            to_add.append(d)
    for key, ex in existing_by_key.items():
        if key not in desired_by_key:
            to_remove.append({
                "id": ex.get("id"),
                "name": ex.get("name"),
                "type": ex.get("type"),
            })
    return to_add, to_remove


def _format_bind_zone(zone, cfg):
    """Render a zone as a BIND-formatted zone file."""
    zone_name = _normalize_zone_name(zone.get("name"))
    records = zone.get("records", [])
    default_ttl = cfg.get("default_ttl", DEFAULT_TTL) if cfg else DEFAULT_TTL
    primary_ns = _ns_fqdn(cfg.get("primary_ns", DEFAULT_PRIMARY_NS), zone_name)
    admin = _soa_admin(cfg.get("admin_email", DEFAULT_ADMIN_EMAIL), zone_name)
    serial = datetime.now(timezone.utc).strftime("%Y%m%d%H")
    lines = [
        f"; BIND zone file for {zone_name}",
        "; Generated by ProxmoxVEx DNS Sync",
        f"$TTL {default_ttl}",
        f"$ORIGIN {zone_name}",
        f"@ IN SOA {primary_ns} {admin} (",
        f"    {serial} ; serial",
        "    3600       ; refresh",
        "    1800       ; retry",
        "    604800     ; expire",
        "    86400 )    ; minimum",
        f"  IN NS {primary_ns}",
        "",
    ]
    for r in records:
        name = (r.get("name") or "@").rstrip(".")
        rtype = (r.get("type") or "A").upper()
        if rtype not in RECORD_TYPES:
            continue
        value = r.get("value") or ""
        ttl = r.get("ttl") or default_ttl
        lines.append(f"{name} {ttl} IN {rtype} {value}")
    return "\n".join(lines) + "\n"


def _format_dnsmasq_zone(zone, cfg):
    """Render a zone as a dnsmasq configuration snippet."""
    zone_name = _normalize_zone_name(zone.get("name"))
    records = zone.get("records", [])
    lines = [
        f"# dnsmasq configuration for {zone_name}",
        "# Generated by ProxmoxVEx DNS Sync",
    ]
    for r in records:
        rtype = (r.get("type") or "A").upper()
        value = r.get("value") or ""
        name = (r.get("name") or "").rstrip(".")
        if not name or not value:
            continue
        if rtype in ("A", "AAAA"):
            lines.append(f"address=/{name}/{value}")
        elif rtype == "PTR":
            lines.append(f"ptr-record={name},{value}")
    return "\n".join(lines) + "\n"


def _zones_handler():
    method = request.method
    zones = _load_state()

    if method == "GET":
        zone_type = (request.args.get("type") or "").strip().lower()
        filtered = _filter_zones(zones, zone_type)
        sort = (request.args.get("sort") or "name").strip()
        order = (request.args.get("order") or "asc").strip()
        rev = order == "desc"
        filtered.sort(key=lambda z: z.get(sort, "").lower(), reverse=rev)
        return {"data": filtered}

    if method == "POST":
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        zone_type = (body.get("type") or "forward").strip().lower()
        ptr_target = (body.get("ptr_target") or "").strip()
        if not name:
            return jsonify({"error": "'name' is required"}), 400
        if any(z.get("name") == name and z.get("type") == zone_type for z in zones):
            return jsonify({"error": "Zone already exists"}), 409
        zone = {
            "id": str(uuid.uuid4()),
            "name": name,
            "type": zone_type,
            "ptr_target": ptr_target if zone_type == "reverse" else "",
            "records": [],
        }
        zones.append(zone)
        _save_state(zones)
        return {"data": zone}

    if method == "PUT":
        body = request.get_json(silent=True) or {}
        zone_id = (body.get("id") or "").strip()
        if not zone_id:
            return jsonify({"error": "'id' is required"}), 400
        for z in zones:
            if z.get("id") == zone_id:
                z["name"] = (body.get("name") or z["name"]).strip()
                if "type" in body:
                    z["type"] = (body.get("type") or z["type"]).strip().lower()
                if "ptr_target" in body:
                    z["ptr_target"] = (body.get("ptr_target") or "").strip()
                _save_state(zones)
                return {"data": z}
        return jsonify({"error": "Zone not found"}), 404

    if method == "DELETE":
        zone_id = (request.args.get("id") or "").strip()
        if not zone_id:
            return jsonify({"error": "'id' is required"}), 400
        before = len(zones)
        zones = [z for z in zones if z.get("id") != zone_id]
        if len(zones) == before:
            return jsonify({"error": "Zone not found"}), 404
        _save_state(zones)
        return {"deleted": zone_id}

    return jsonify({"error": "Method not allowed"}), 405


def _sync_handler():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405

    body = request.get_json(silent=True) or {}
    cluster_id = (body.get("cluster_id") or "").strip()
    zone_id = (body.get("zone_id") or "").strip()
    if not cluster_id:
        return jsonify({"error": "'cluster_id' is required"}), 400

    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err

    manager, err = get_connected_manager(cluster_id)
    if err:
        return err

    try:
        zones = _load_state()
        zone = next((z for z in zones if z.get("id") == zone_id), None) if zone_id else None
        # Use the manager directly so guest-agent-injected IP data is available.
        vms = manager.get_vms() or []
        vms = [v for v in vms if v.get("name") and (v.get("ip") or v.get("ip6"))]
        cfg = _load_config()
        if zone:
            desired = _desired_records_for_zone(vms, zone, cfg)
            existing = zone.get("records", [])
            to_add, to_remove = _reconcile_records(existing, desired)
            plan_zone_name = zone.get("name", "")
        else:
            to_add, to_remove = [], []
            plan_zone_name = ""
        plan = {
            "cluster_id": cluster_id,
            "cluster_node": manager.host,
            "vms_discovered": len(vms),
            "records_to_add": to_add,
            "records_to_remove": to_remove,
            "zone_id": zone_id,
            "zone_name": plan_zone_name,
        }
        return {"data": plan}
    except Exception as e:
        log.exception("[%s] DNS sync error", cluster_id)
        return jsonify({"error": safe_error(e, "DNS sync failed")}), 500


def _apply_handler():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    body = request.get_json(silent=True) or {}
    zone_id = (body.get("zone_id") or "").strip()
    plan = body.get("plan", {})
    if not zone_id:
        return jsonify({"error": "'zone_id' is required"}), 400
    zones = _load_state()
    for z in zones:
        if z.get("id") != zone_id:
            continue
        records = z.setdefault("records", [])
        records_by_id = {r.get("id"): r for r in records if r.get("id")}
        records_by_key = {(r.get("name"), r.get("type")): r for r in records}

        # Remove records first so updates are clean.
        for rec in plan.get("records_to_remove", []):
            if rec.get("id") and rec["id"] in records_by_id:
                records.remove(records_by_id[rec["id"]])
                continue
            key = (rec.get("name"), rec.get("type"))
            if key in records_by_key:
                records.remove(records_by_key[key])

        # Add or update records.
        for rec in plan.get("records_to_add", []):
            if not rec.get("name") or not rec.get("type"):
                continue
            rec_type = str(rec.get("type")).upper()
            if rec_type not in RECORD_TYPES:
                continue
            rid = rec.get("id")
            if rid and rid in records_by_id:
                records_by_id[rid]["value"] = rec.get("value")
                records_by_id[rid]["ttl"] = rec.get("ttl")
                continue
            key = (rec.get("name"), rec_type)
            if key in records_by_key:
                records_by_key[key]["value"] = rec.get("value")
                records_by_key[key]["ttl"] = rec.get("ttl")
            else:
                records.append({
                    "id": str(uuid.uuid4()),
                    "name": rec.get("name"),
                    "type": rec_type,
                    "value": rec.get("value"),
                    "ttl": rec.get("ttl"),
                    "vmid": rec.get("vmid"),
                })

        _save_state(zones)
        return {"data": z}
    return jsonify({"error": "Zone not found"}), 404


def _records_handler():
    method = request.method
    zones = _load_state()
    if method == "GET":
        zone_id = request.args.get("zone_id")
        result = []
        for z in zones:
            if not zone_id or z.get("id") == zone_id:
                for r in z.get("records", []):
                    result.append({"zone_id": z["id"], "zone_name": z["name"], **r})
        return {"data": result}

    if method == "PUT":
        body = request.get_json(silent=True) or {}
        record_id = (body.get("id") or "").strip()
        if not record_id:
            return jsonify({"error": "'id' is required"}), 400
        rtype = (body.get("type") or "").strip().upper()
        if rtype and rtype not in RECORD_TYPES:
            return jsonify({"error": f"Invalid record type: {rtype}"}), 400
        for z in zones:
            for r in z.get("records", []):
                if r.get("id") == record_id:
                    r["name"] = (body.get("name") or r["name"]).strip()
                    if "type" in body:
                        r["type"] = rtype
                    r["value"] = (body.get("value") or r["value"]).strip()
                    if "ttl" in body:
                        try:
                            r["ttl"] = int(body["ttl"])
                        except (TypeError, ValueError):
                            return jsonify({"error": "'ttl' must be an integer"}), 400
                    _save_state(zones)
                    return {"data": r}
        return jsonify({"error": "Record not found"}), 404

    if method == "DELETE":
        record_id = (request.args.get("id") or "").strip()
        if not record_id:
            return jsonify({"error": "'id' is required"}), 400
        for z in zones:
            before = len(z.get("records", []))
            z["records"] = [r for r in z.get("records", []) if r.get("id") != record_id]
            if len(z["records"]) < before:
                _save_state(zones)
                return {"deleted": record_id}
        return jsonify({"error": "Record not found"}), 404

    return jsonify({"error": "Method not allowed"}), 405


def _export_handler():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    zone_id = (request.args.get("zone_id") or "").strip()
    fmt = (request.args.get("format") or "").strip().lower()
    if not zone_id:
        return jsonify({"error": "'zone_id' is required"}), 400
    if fmt not in ("bind", "dnsmasq"):
        return jsonify({"error": "'format' must be 'bind' or 'dnsmasq'"}), 400
    zones = _load_state()
    for z in zones:
        if z.get("id") == zone_id:
            cfg = _load_config()
            content = _format_bind_zone(z, cfg) if fmt == "bind" else _format_dnsmasq_zone(z, cfg)
            suffix = "zone" if fmt == "bind" else "conf"
            filename = f"{_normalize_zone_name(z.get('name', 'zone')).rstrip('.')}.{suffix}"
            return {"content": content, "filename": filename}
    return jsonify({"error": "Zone not found"}), 404


def _get_ui():
    """Serve the DNS Sync HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "zones", _zones_handler)
    register_plugin_route(PLUGIN_ID, "sync", _sync_handler)
    register_plugin_route(PLUGIN_ID, "apply", _apply_handler)
    register_plugin_route(PLUGIN_ID, "records", _records_handler)
    register_plugin_route(PLUGIN_ID, "export", _export_handler)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[%s] Plugin registered", PLUGIN_ID)
