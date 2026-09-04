# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-tag-enforcer/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: VM Tag Enforcer - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""VM Tag Enforcer - full UI management backend."""

import csv
import io
import json
import logging
import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager, safe_error
from ProxmoxVEx.api.plugin_data_bridge import get_clusters
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "vm-tag-enforcer"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
DATA_PATH = PLUGIN_DIR / "rules.json"
AUTO_RULES_PATH = PLUGIN_DIR / "auto_rules.json"
STATE_PATH = PLUGIN_DIR / "state.json"
_state_lock = threading.RLock()
_worker_started = False

DEFAULT_AUTO_RULES = [
    {
        "id": "os",
        "enabled": False,
        "source": "ostype",
        "template": "os-{value}",
        "prefix": "os-",
        "description": "Tag VMs by guest OS type",
    },
    {
        "id": "memory",
        "enabled": False,
        "source": "memory_gb",
        "template": "mem-{value}gb",
        "prefix": "mem-",
        "description": "Tag VMs by memory size",
    },
    {
        "id": "cpu",
        "enabled": False,
        "source": "cpu_count",
        "template": "cpu-{value}",
        "prefix": "cpu-",
        "description": "Tag VMs by CPU count",
    },
    {
        "id": "uptime",
        "enabled": False,
        "source": "uptime_bucket",
        "template": "uptime-{value}",
        "prefix": "uptime-",
        "description": "Tag VMs by uptime bucket",
    },
    {
        "id": "ip",
        "enabled": False,
        "source": "ip",
        "template": "ip-{value}",
        "prefix": "ip-",
        "description": "Tag VMs by primary IP",
    },
    {
        "id": "node",
        "enabled": False,
        "source": "node",
        "template": "node-{value}",
        "prefix": "node-",
        "description": "Tag VMs by host node",
    },
    {
        "id": "status",
        "enabled": False,
        "source": "status",
        "template": "status-{value}",
        "prefix": "status-",
        "description": "Tag VMs by running/stopped state",
    },
    {
        "id": "storage",
        "enabled": False,
        "source": "storage",
        "template": "storage-{value}",
        "prefix": "storage-",
        "description": "Tag VMs by primary storage",
    },
]


# Default required-tag rules for new installs. These are checked by Validate and
# Cluster Scan; a rule with required=True flags any VM that does not carry the
# specified tag. Users can edit, disable or delete these in the Rules tab.
DEFAULT_RULES = [
    {
        "id": "owner",
        "tag": "owner",
        "level": "warning",
        "required": True,
        "description": "VMs should be tagged with an owner or team",
    },
    {
        "id": "role",
        "tag": "role",
        "level": "warning",
        "required": True,
        "description": "VMs should be tagged with their role or function",
    },
    {
        "id": "env",
        "tag": "env",
        "level": "warning",
        "required": True,
        "description": "VMs should be tagged with their environment",
    },
    {
        "id": "backup",
        "tag": "backup",
        "level": "critical",
        "required": True,
        "description": "VMs must be tagged for backup inclusion",
    },
]


# PVE tags only allow letters, digits, underscore, -, +, . and optional leading +.
_PVE_TAG_RE = re.compile(r"^\+?[a-z0-9_][a-z0-9_\-\+\.]*$", re.IGNORECASE)


def _is_valid_pve_tag(tag):
    return bool(_PVE_TAG_RE.match(tag or ""))


def _parse_tags(tag_str):
    """Split a PVE tag string, strip whitespace, and drop empty entries."""
    return {t.strip() for t in (tag_str or "").split(";") if t.strip()}


def _now():
    return datetime.now(timezone.utc)


def _ensure_data_files():
    if not DATA_PATH.exists():
        DATA_PATH.write_text(json.dumps(DEFAULT_RULES, indent=2))
    if not AUTO_RULES_PATH.exists():
        # Seed disabled defaults so users can opt-in rather than starting from scratch.
        AUTO_RULES_PATH.write_text(json.dumps(DEFAULT_AUTO_RULES, indent=2))
    if not STATE_PATH.exists():
        STATE_PATH.write_text(json.dumps({"jobs": [], "scans": [], "auto_runs": [], "version": "1.1.0"}, indent=2))


def _load():
    try:
        return json.loads(DATA_PATH.read_text())
    except Exception:
        return []


def _save(items):
    DATA_PATH.write_text(json.dumps(items, indent=2))


def _load_auto():
    try:
        return json.loads(AUTO_RULES_PATH.read_text())
    except Exception:
        return []


def _save_auto(items):
    AUTO_RULES_PATH.write_text(json.dumps(items, indent=2))


def _load_state():
    try:
        return json.loads(STATE_PATH.read_text())
    except Exception:
        return {"jobs": [], "scans": [], "auto_runs": [], "version": "1.1.0"}


def _save_state(data):
    data["version"] = "1.1.0"
    data["updated_at"] = _now().isoformat()
    STATE_PATH.write_text(json.dumps(data, indent=2))


def _get_status():
    state = _load_state()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "version": "1.1.0",
        "rule_count": len(_load()),
        "auto_rule_count": len(_load_auto()),
        "scan_count": len(state.get("scans", [])),
        "job_count": len(state.get("jobs", [])),
        "auto_run_count": len(state.get("auto_runs", [])),
    }


def _get_manager(cluster_id):
    if not cluster_id:
        # Return a plain dict so the same helper can be used outside a Flask
        # request context (e.g. the schedule worker); Flask will JSONify it.
        return None, ({"error": "cluster_id is required"}, 400)
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return None, err
    # get_connected_manager returns a (manager, error) tuple.
    manager, conn_err = get_connected_manager(cluster_id)
    if conn_err or manager is None:
        # Plain dict so this helper is safe outside a Flask request context;
        # Flask view functions still return the dict as a JSON response.
        return None, ({"error": conn_err[0].get("error") if conn_err else "cluster not connected"}, 503)
    return manager, None


def _get_clusters():
    try:
        return {
            "data": [{"id": c.get("id"), "display_name": c.get("name")} for c in get_clusters().get("clusters", [])]
        }
    except Exception as e:
        log.error(safe_error(e, "cluster list failed"))
    return {"data": []}


def _discover_vms(manager):
    """Fetch /cluster/resources and parse qemu/lxc VMs with diagnostics.

    Some Proxmox installs reject the 'type' query parameter, so the unfiltered
    call is the most compatible. The long timeout avoids PVE's cluster-wide
    aggregation timing out on large clusters.
    """
    out = {"vms": [], "total": 0, "types": [], "error": None}
    host = getattr(manager, "host", None)
    port = getattr(manager, "api_port", 8006)
    verify = getattr(manager, "_ssl_verify", True)
    if not host:
        out["error"] = "manager has no host configured"
        log.error("[vm-tag-enforcer] %s", out["error"])
        return out
    url = f"https://{host}:{port}/api2/json/cluster/resources"
    try:
        r = manager._api_get(url, timeout=20, verify=verify)
    except Exception as e:
        out["error"] = f"request failed: {e}"
        log.error(safe_error(e, "vm list request failed"))
        return out
    if r.status_code != 200:
        out["error"] = f"PVE returned {r.status_code}: {r.text[:200]}"
        log.warning("[vm-tag-enforcer] %s", out["error"])
        return out
    try:
        data = r.json().get("data") or []
    except Exception as e:
        out["error"] = f"invalid JSON from PVE: {e}"
        log.error(safe_error(e, "vm list json parse failed"))
        return out
    out["total"] = len(data)
    out["types"] = sorted({r.get("type") for r in data if r.get("type")})
    vms = [r for r in data if r.get("type") in ("qemu", "lxc")]
    out["vms"] = [
        {
            "vmid": v.get("vmid"),
            "name": v.get("name") or f"vm-{v.get('vmid')}",
            "node": v.get("node", ""),
            "type": v.get("type", "qemu"),
            "maxmem": v.get("maxmem", 0) or 0,
            "maxcpu": v.get("maxcpu", 1) or 1,
            "status": v.get("status", ""),
            "uptime": v.get("uptime"),
            "tags": sorted(_parse_tags(v.get("tags"))),
        }
        for v in vms
    ]
    return out


def _list_vms(manager):
    return _discover_vms(manager)["vms"]


def _get_vms():
    cluster_id = request.args.get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    manager, err = _get_manager(cluster_id)
    if err:
        return err
    return {"data": _list_vms(manager)}


def _resolve_vm_node_type(manager, vmid):
    """Find the real PVE node and VM type (qemu/lxc) for a vmid from cluster resources."""
    try:
        resources = manager.api_request("GET", "/cluster/resources") or []
    except Exception as e:
        log.error(safe_error(e, "vm resource lookup failed"))
        return None, None
    for r in resources:
        if str(r.get("vmid")) == str(vmid) and r.get("type") in ("qemu", "lxc"):
            return r.get("node"), r.get("type") or "qemu"
    return None, None


def _vm_config(manager, node, vmtype, vmid):
    if not node or not vmtype or not vmid:
        return {}
    try:
        return manager.api_request("GET", f"/nodes/{node}/{vmtype}/{vmid}/config") or {}
    except Exception as e:
        log.error(safe_error(e, "config lookup failed"))
        return {}


def _violations_for(tags):
    rules = _load()
    return [
        {"rule_id": r.get("id"), "tag": r.get("tag"), "level": r.get("level", "warning")}
        for r in rules
        if r.get("required") and r.get("tag") not in tags
    ]


def _rules():
    if request.method == "GET":
        return {"rules": _load()}
    data = request.get_json(silent=True) or {}
    rid = data.get("id")
    if not rid:
        return jsonify({"error": "id is required"}), 400
    tag = (data.get("tag") or "").strip()
    if not tag:
        return jsonify({"error": "tag is required"}), 400
    level = data.get("level") or "warning"
    if level not in ("warning", "critical"):
        return jsonify({"error": "level must be warning or critical"}), 400
    rules = _load()
    existing = next((r for r in rules if r.get("id") == rid), None)
    entry = {
        "id": rid,
        "tag": tag,
        "level": level,
        "required": data.get("required", True),
        "description": data.get("description", ""),
    }
    if existing:
        existing.update(entry)
    else:
        rules.append(entry)
    _save(rules)
    return {"rule": entry, "saved": True}


def _delete_rule():
    rid = (request.get_json(silent=True) or {}).get("id") or request.args.get("id")
    if not rid:
        return jsonify({"error": "id is required"}), 400
    rules = _load()
    rules = [r for r in rules if r.get("id") != rid]
    _save(rules)
    return {"deleted": rid, "count": len(rules)}


def _validate():
    data = request.get_json(silent=True) or {}
    cluster_id = data.get("cluster_id")
    vmid = data.get("vmid")
    if not all([cluster_id, vmid]):
        return jsonify({"error": "cluster_id and vmid are required"}), 400
    manager, err = _get_manager(cluster_id)
    if err:
        return err
    tags = []
    try:
        # Resolve the actual node and type (qemu/lxc) from cluster resources
        # instead of hardcoding localhost/qemu, which broke on real clusters.
        node, vmtype = _resolve_vm_node_type(manager, vmid)
        if not node:
            return jsonify({"error": "VM not found in cluster resources"}), 404
        cfg = manager.api_request("GET", f"/nodes/{node}/{vmtype}/{vmid}/config")
        if isinstance(cfg, dict):
            tags = sorted(_parse_tags(cfg.get("tags", "")))
    except Exception as e:
        log.error(safe_error(e, "config lookup failed"))
        tags = []
    violations = _violations_for(tags)
    return {"cluster_id": cluster_id, "vmid": vmid, "tags": tags, "violations": violations}


def _remediate():
    data = request.get_json(silent=True) or {}
    cluster_id = data.get("cluster_id")
    vmid = data.get("vmid")
    if not all([cluster_id, vmid]):
        return jsonify({"error": "cluster_id and vmid are required"}), 400
    manager, err = _get_manager(cluster_id)
    if err:
        return err
    state = _load_state()
    job = {
        "job_id": f"remedy-{uuid.uuid4().hex[:8]}",
        "cluster_id": cluster_id,
        "vmid": vmid,
        "action": "add_missing_tags",
        "status": "queued",
        "created_at": _now().isoformat(),
    }
    state.setdefault("jobs", []).append(job)
    _save_state(state)
    # Run the queued job immediately so the tag is applied before the user
    # sees the success popup and the History tab reflects the result.
    _run_queued_jobs()
    return {"remediated": True, "vmid": vmid, "cluster_id": cluster_id, "job_id": job["job_id"]}


def _scan():
    cluster_id = request.args.get("cluster_id") or (request.get_json(silent=True) or {}).get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    manager, err = _get_manager(cluster_id)
    if err:
        return err
    try:
        vms = _list_vms(manager)
    except Exception as e:
        log.error(safe_error(e, "vm list failed"))
        vms = []
    results = []
    for vm in vms:
        vio = _violations_for(vm.get("tags", []))
        if vio:
            results.append({
                "vmid": vm.get("vmid"),
                "name": vm.get("name"),
                "tags": vm.get("tags", []),
                "violations": vio,
            })
    state = _load_state()
    scan = {
        "scan_id": f"scan-{uuid.uuid4().hex[:8]}",
        "cluster_id": cluster_id,
        "created_at": _now().isoformat(),
        "non_compliant": len(results),
        "results": results,
    }
    state.setdefault("scans", []).append(scan)
    _save_state(state)
    return scan


def _get_scans():
    state = _load_state()
    return {"data": state.get("scans", [])[::-1]}


def _get_history():
    """Return a unified activity history: remediation jobs, auto-tag runs, and scheduled runs."""
    state = _load_state()
    items = []
    for j in state.get("jobs", []):
        items.append({
            "kind": "remediation",
            "id": j.get("job_id"),
            "target": j.get("vmid"),
            "cluster_id": j.get("cluster_id"),
            "status": j.get("status", ""),
            "error": j.get("error", ""),
            "message": j.get("message", ""),
            "created_at": j.get("created_at"),
        })
    for r in state.get("auto_runs", []):
        items.append({
            "kind": "auto_tag",
            "id": r.get("run_id"),
            "target": r.get("cluster_id"),
            "cluster_id": r.get("cluster_id"),
            "status": "preview" if r.get("dry_run") else "run",
            "message": r.get("message", ""),
            "created_at": r.get("created_at"),
        })
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return {"data": items[:100]}


def _get_export():
    fmt = request.args.get("format", "json")
    state = _load_state()
    scans = state.get("scans", [])
    if fmt == "csv":
        out = io.StringIO()
        writer = csv.DictWriter(out, fieldnames=["scan_id", "cluster_id", "created_at", "non_compliant"])
        writer.writeheader()
        for s in scans:
            writer.writerow({
                "scan_id": s.get("scan_id"),
                "cluster_id": s.get("cluster_id"),
                "created_at": s.get("created_at"),
                "non_compliant": s.get("non_compliant", 0),
            })
        return send_file(
            io.BytesIO(out.getvalue().encode()),
            mimetype="text/csv",
            as_attachment=True,
            download_name="tag-enforcer-scans.csv",
        )
    return jsonify({"scans": scans})


def _auto_rules():
    if request.method == "GET":
        return {"auto_rules": _load_auto()}
    data = request.get_json(silent=True) or {}
    rid = data.get("id")
    if not rid:
        return jsonify({"error": "id is required"}), 400
    source = (data.get("source") or "").strip()
    if not source:
        return jsonify({"error": "source is required"}), 400
    template = (data.get("template") or "").strip()
    if not template or "{value}" not in template:
        return jsonify({"error": "template must contain {value}"}), 400
    rules = _load_auto()
    existing = next((r for r in rules if r.get("id") == rid), None)
    prefix = (data.get("prefix") or "").strip()
    if not prefix:
        prefix = template.split("{value}", 1)[0]
    entry = {
        "id": rid,
        "enabled": bool(data.get("enabled", True)),
        "source": source,
        "template": template,
        "prefix": prefix,
        "description": data.get("description", ""),
    }
    if existing:
        existing.update(entry)
    else:
        rules.append(entry)
    _save_auto(rules)
    return {"auto_rule": entry, "saved": True}


def _delete_auto_rule():
    rid = (request.get_json(silent=True) or {}).get("id") or request.args.get("id")
    if not rid:
        return jsonify({"error": "id is required"}), 400
    rules = _load_auto()
    rules = [r for r in rules if r.get("id") != rid]
    _save_auto(rules)
    return {"deleted": rid, "count": len(rules)}


def _get_auto_runs():
    state = _load_state()
    return {"data": state.get("auto_runs", [])[::-1]}


def _extract_ip(text):
    if not text:
        return ""
    match = re.search(r"(?:^|,)ip=([^/,;\s]+)", text)
    if not match:
        return ""
    ip = match.group(1).strip()
    if ip.lower() == "dhcp":
        return ""
    # Strip CIDR prefix (e.g. 10.0.0.5/24) so the tag is just the address.
    return ip.split("/")[0]


def _primary_ip(manager, node, vmtype, vmid, cfg):
    """Return the best IP we can find: ipconfig0/net0 first, then qemu guest agent."""
    if vmtype == "qemu":
        ip = _extract_ip(cfg.get("ipconfig0", ""))
        if ip:
            return ip
        agent = cfg.get("agent")
        if agent and str(agent) != "0" and str(agent).lower() != "false":
            try:
                data = manager.api_request("GET", f"/nodes/{node}/qemu/{vmid}/agent/network-get-interfaces")
                if isinstance(data, dict):
                    result = data.get("result") or []
                    for iface in result:
                        if not isinstance(iface, dict) or iface.get("name") == "lo":
                            continue
                        for addr in iface.get("ip-addresses") or []:
                            if addr.get("ip-address-type") == "ipv4":
                                return addr.get("ip-address", "")
            except Exception as e:
                log.debug(safe_error(e, "agent ip lookup failed"))
    if vmtype == "lxc":
        return _extract_ip(cfg.get("net0", ""))
    return ""


def _primary_storage(cfg, vmtype):
    if vmtype == "lxc":
        rootfs = cfg.get("rootfs", "")
        if rootfs:
            return rootfs.split(":")[0].split(",")[0]
        return ""
    for key in sorted(cfg.keys()):
        if re.match(r"^(ide|sata|scsi|virtio)\d+$", key):
            val = cfg[key]
            if not val:
                continue
            return val.split(":")[0].split(",")[0]
    return ""


def _memory_gb(maxmem):
    if not maxmem:
        return "0"
    return str(int(round(maxmem / (1024**3))))


def _cpu_count(maxcpu):
    return str(int(maxcpu)) if maxcpu else "0"


def _uptime_bucket(seconds):
    # PVE tags cannot contain '<' or start with a digit, so spell buckets with letters.
    if seconds is None or seconds == 0:
        return "stopped"
    seconds = int(seconds)
    if seconds < 3600:
        return "lt1h"
    if seconds < 86400:
        return "lt1d"
    if seconds < 604800:
        return "lt7d"
    if seconds < 2592000:
        return "lt30d"
    return "ge30d"


def _gather_facts(manager, vm):
    node = vm.get("node")
    vmtype = vm.get("type", "qemu")
    vmid = vm.get("vmid")
    cfg = _vm_config(manager, node, vmtype, vmid)
    maxmem = vm.get("maxmem") or (cfg.get("memory", 0) * 1024 * 1024)
    if not maxmem and vmtype == "lxc":
        maxmem = cfg.get("memory", 0) * 1024 * 1024
    maxcpu = vm.get("maxcpu") or (int(cfg.get("sockets", 1)) * int(cfg.get("cores", 1)))
    ostype = cfg.get("ostype", "")
    if not ostype:
        ostype = cfg.get("ostype", "")
    facts = {
        "vmid": str(vmid),
        "name": vm.get("name") or cfg.get("name", f"vm-{vmid}"),
        "node": node or "",
        "type": vmtype,
        "status": vm.get("status") or "",
        "ostype": str(ostype).lower() if ostype else "",
        "memory_gb": _memory_gb(maxmem),
        "cpu_count": _cpu_count(maxcpu),
        "uptime_bucket": _uptime_bucket(vm.get("uptime")),
        "storage": _primary_storage(cfg, vmtype),
        "ip": _primary_ip(manager, node, vmtype, vmid, cfg),
    }
    return facts, cfg


def _render_tag(template, value):
    return template.replace("{value}", str(value))


def _set_vm_tags(manager, vm, tags_set, cfg):
    """Write a new tag list back to the VM config and verify the result.

    Returns (success: bool, error: str).
    """
    # Normalize tags first: PVE may return tags with leading/trailing whitespace,
    # and users sometimes add tags that begin or end with spaces. Stripping them
    # prevents empty-looking tags that would otherwise fail validation.
    cleaned = _parse_tags(";".join(tags_set))
    # PVE rejects the entire tag list if any tag contains illegal characters.
    # Validate locally so we fail fast with a clear, per-VM error message.
    invalid = sorted(t for t in cleaned if not _is_valid_pve_tag(t))
    if invalid:
        return False, f"invalid PVE tag characters in: {'; '.join(invalid)}"
    if not cleaned:
        return False, "no valid tags to apply"
    tag_str = ";".join(sorted(cleaned))
    node = vm.get("node")
    vmtype = vm.get("type", "qemu")
    vmid = vm.get("vmid")
    # PVE config updates are PUT, not POST; POST is not implemented for LXC.
    # skiplock is restricted to root users, so omit it to allow non-root writes.
    data = {"tags": tag_str}
    if isinstance(cfg, dict) and cfg.get("digest"):
        data["digest"] = cfg["digest"]
    url = f"https://{manager.host}:{manager.api_port}/api2/json/nodes/{node}/{vmtype}/{vmid}/config"
    try:
        r = manager._api_put(url, data=data, verify=manager._ssl_verify)
        if r.status_code != 200:
            try:
                body = r.json()
                errors = body.get("errors") or body.get("message") or r.text[:200]
            except Exception:
                errors = r.text[:200]
            return False, f"PVE returned {r.status_code}: {errors}"
        # Verify the write actually stuck.
        updated = manager.api_request("GET", f"/nodes/{node}/{vmtype}/{vmid}/config") or {}
        if isinstance(updated, dict) and (updated.get("tags") or "") == tag_str:
            return True, ""
        return False, f"verification failed: PVE tags are now '{updated.get('tags')}' expected '{tag_str}'"
    except Exception as e:
        log.error(safe_error(e, "set tags failed"))
        return False, str(e)


def _fix_hint(error, vm):
    """Return a human-readable remediation hint for a PVE tag update error."""
    if not error:
        return ""
    err = error.lower()
    vmtype = (vm.get("type") or "qemu").lower()
    node = vm.get("node") or "the node"
    if "method 'post" in err and "not implemented" in err:
        return "The auto-tagger was using POST to update the PVE config. Restart the ProxmoxVEx backend so the updated plugin (which uses PUT) is loaded."
    if "skiplock" in err and "root" in err:
        return "The tag update was sending skiplock, which only the PVE root account may use. The plugin now omits skiplock; restart the backend to apply the change."
    if "invalid pve tag characters" in err:
        return "One or more tags contain invalid characters or whitespace. The auto-tagger now strips and validates tags before writing; re-run after restarting the backend."
    if "does not exist" in err and vmtype == "lxc":
        return f"This LXC container references a device or resource that is not available on node '{node}' (for example a GPU mount or missing storage). Remove the missing device from the container's hardware in Proxmox, or move the container to a node that has the resource."
    if "500" in err:
        return "Proxmox returned an internal server error. Check the PVE node logs (journalctl -u pveproxy, /var/log/syslog) for the exact cause; it is usually a missing device or storage resource."
    if "401" in err or "403" in err:
        return "Permission denied. Make sure the ProxmoxVEx cluster connection uses a PVE user with permission to edit VM/LXC configuration."
    return "Check the PVE node logs and the VM/LXC configuration for the underlying issue, then re-run the auto-tagger."


def _run_auto_tag_core(manager, cluster_id, dry_run=False):
    """Execute an auto-tag run for a cluster and return the run record.

    This is split out from _run_auto_tag so the scheduler can call it without
    a Flask request object.
    """
    rules = [r for r in _load_auto() if r.get("enabled")]
    if not rules:
        return {"error": "no enabled auto tag rules"}
    discovery = _discover_vms(manager)
    vms = discovery["vms"]
    results = []
    changes = []
    failed = []
    for vm in vms:
        facts, cfg = _gather_facts(manager, vm)
        current_tags = _parse_tags(cfg.get("tags"))
        new_tags = set(current_tags)
        vm_changes = []
        for rule in rules:
            raw = facts.get(rule["source"])
            if raw is None or raw == "":
                continue
            desired = _render_tag(rule["template"], raw)
            prefix = rule.get("prefix") or _render_tag(rule["template"], "")
            # Remove any existing tag managed by this rule so the value can auto-update.
            for t in list(new_tags):
                if t.startswith(prefix) and t != desired:
                    new_tags.discard(t)
                    vm_changes.append({"rule_id": rule["id"], "old": t, "new": desired})
            if desired and desired not in new_tags:
                new_tags.add(desired)
                vm_changes.append({"rule_id": rule["id"], "old": None, "new": desired})
        result = {
            "vmid": vm.get("vmid"),
            "name": vm.get("name"),
            "type": vm.get("type", "qemu"),
            "node": vm.get("node"),
            "new_tags": sorted(new_tags),
            "changes": vm_changes,
            "error": "",
            "fix_hint": "",
            "status": "unchanged",
        }
        if vm_changes:
            if dry_run:
                result["status"] = "planned"
            else:
                ok, vm_error = _set_vm_tags(manager, vm, new_tags, cfg)
                if ok:
                    result["status"] = "applied"
                    changes.append({
                        "vmid": vm.get("vmid"),
                        "name": vm.get("name"),
                        "new_tags": sorted(new_tags),
                        "changes": vm_changes,
                    })
                else:
                    result["status"] = "failed"
                    result["error"] = vm_error
                    result["fix_hint"] = _fix_hint(vm_error, vm)
                    failed.append({
                        "vmid": vm.get("vmid"),
                        "name": vm.get("name"),
                        "error": vm_error,
                        "fix_hint": result["fix_hint"],
                    })
        results.append(result)
    unchanged = sum(1 for r in results if r["status"] == "unchanged")
    planned = sum(1 for r in results if r["status"] == "planned")
    applied = sum(1 for r in results if r["status"] == "applied")
    failed_count = len(failed)
    run_id = f"auto-{uuid.uuid4().hex[:8]}"
    if discovery.get("error"):
        message = f"Discovery failed: {discovery['error']}"
    elif not vms:
        message = f"No VMs found. PVE returned {discovery['total']} resources with types: {discovery['types']}."
    else:
        action = "Preview" if dry_run else "Run"
        message = f"{action} complete: {applied} applied, {failed_count} failed, {unchanged} unchanged."
    log.info(
        f"[vm-tag-enforcer] auto_tag {run_id}: vms={len(vms)} total_resources={discovery['total']} types={discovery['types']} planned={planned} applied={applied} failed={failed_count} dry_run={dry_run}"
    )
    state = _load_state()
    record = {
        "run_id": run_id,
        "cluster_id": cluster_id,
        "created_at": _now().isoformat(),
        "dry_run": dry_run,
        "vms_count": len(vms),
        "resources_total": discovery["total"],
        "resource_types": discovery["types"],
        "discovery_error": discovery.get("error") or "",
        "changed_vms": applied,
        "failed_vms": failed_count,
        "unchanged_vms": unchanged,
        "message": message,
        "results": results,
        "changes": changes,
        "failed": failed,
    }
    state.setdefault("auto_runs", []).append(record)
    _save_state(state)
    return record


def _run_auto_tag():
    data = request.get_json(silent=True) or {}
    cluster_id = data.get("cluster_id")
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    dry_run = data.get("dry_run", False)
    manager, err = _get_manager(cluster_id)
    if err:
        return err
    record = _run_auto_tag_core(manager, cluster_id, dry_run)
    if isinstance(record, dict) and record.get("error"):
        return jsonify({"error": record["error"]}), 400
    return record


def _find_vm(manager, vmid):
    try:
        for v in _discover_vms(manager).get("vms", []):
            if str(v.get("vmid")) == str(vmid):
                return v
    except Exception:
        pass
    return None


# ------------------------------------------------------------------
# Scheduled auto-tag runs
# ------------------------------------------------------------------
SCHEDULES_PATH = PLUGIN_DIR / "schedules.json"


def _load_schedules():
    try:
        return json.loads(SCHEDULES_PATH.read_text())
    except Exception:
        return []


def _save_schedules(items):
    SCHEDULES_PATH.write_text(json.dumps(items, indent=2))


def _new_schedule_id():
    return f"sched-{uuid.uuid4().hex[:8]}"


def _parse_time(value):
    """Parse a HH:MM string into a (hour, minute) tuple or None."""
    if not value:
        return None
    try:
        h, m = value.split(":")
        return int(h), int(m)
    except Exception:
        return None


def _compute_next_run(schedule, now=None):
    """Compute the next ISO datetime a schedule should execute.

    Returns None for one-off schedules that have already passed or for invalid config.
    """
    now = now or _now()
    sched_type = schedule.get("schedule_type", "interval")
    if sched_type == "once":
        run_at = schedule.get("run_at")
        if not run_at:
            return None
        try:
            dt = datetime.fromisoformat(run_at)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat() if dt > now else None
        except Exception:
            return None
    if sched_type == "interval":
        interval = schedule.get("interval_minutes")
        try:
            interval = int(interval)
        except (TypeError, ValueError):
            return None
        if interval <= 0:
            return None
        base = now
        last = schedule.get("last_run")
        if last:
            try:
                base = datetime.fromisoformat(last)
                if base.tzinfo is None:
                    base = base.replace(tzinfo=timezone.utc)
            except Exception:
                pass
        return (base + timedelta(minutes=interval)).isoformat()
    if sched_type == "daily":
        hhmm = _parse_time(schedule.get("daily_time", ""))
        if hhmm is None:
            return None
        h, m = hhmm
        target = now.replace(hour=h, minute=m, second=0, microsecond=0)
        last = schedule.get("last_run")
        last_dt = None
        if last:
            try:
                last_dt = datetime.fromisoformat(last)
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
            except Exception:
                pass
        # If the target time today has passed and we haven't already run today, run tomorrow.
        if target <= now or (last_dt and last_dt.date() == now.date() and target <= last_dt):
            target = target + timedelta(days=1)
        return target.isoformat()
    return None


def _is_due(schedule, now=None):
    """Return True if a schedule is enabled and its next_run is now or in the past."""
    now = now or _now()
    if not schedule.get("enabled"):
        return False
    start = schedule.get("start_at")
    if start:
        try:
            start_dt = datetime.fromisoformat(start)
            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=timezone.utc)
            if now < start_dt:
                return False
        except Exception:
            pass
    end = schedule.get("end_at")
    if end:
        try:
            end_dt = datetime.fromisoformat(end)
            if end_dt.tzinfo is None:
                end_dt = end_dt.replace(tzinfo=timezone.utc)
            if now > end_dt:
                return False
        except Exception:
            pass
    next_run = schedule.get("next_run")
    if not next_run:
        return False
    try:
        next_dt = datetime.fromisoformat(next_run)
        if next_dt.tzinfo is None:
            next_dt = next_dt.replace(tzinfo=timezone.utc)
        return next_dt <= now
    except Exception:
        return False


def _run_schedule(schedule):
    """Execute a schedule and update its last_run / next_run / last_error fields."""
    cluster_id = schedule.get("cluster_id")
    if not cluster_id:
        schedule["last_error"] = "cluster_id is required"
        return
    dry_run = bool(schedule.get("dry_run"))
    manager, err = _get_manager(cluster_id)
    if err:
        # _get_manager now returns a (dict, status) tuple even outside a request context.
        schedule["last_error"] = (
            err[0].get("error") if isinstance(err, tuple) and err and isinstance(err[0], dict) else str(err)
        )
        return
    now = _now()
    record = _run_auto_tag_core(manager, cluster_id, dry_run)
    if isinstance(record, dict) and record.get("error"):
        schedule["last_error"] = record["error"]
    else:
        schedule["last_error"] = ""
    schedule["last_run"] = now.isoformat()
    schedule["next_run"] = _compute_next_run(schedule, now)
    if schedule.get("schedule_type") == "once":
        schedule["enabled"] = False


def _check_schedules():
    """Load schedules and trigger any that are due."""
    schedules = _load_schedules()
    now = _now()
    changed = False
    for sched in schedules:
        if _is_due(sched, now):
            _run_schedule(sched)
            changed = True
    if changed:
        _save_schedules(schedules)


def _schedules():
    """CRUD endpoint for auto-tag schedules."""
    if request.method == "GET":
        return {"schedules": _load_schedules()}
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"error": "name is required"}), 400
        cluster_id = (data.get("cluster_id") or "").strip()
        if not cluster_id:
            return jsonify({"error": "cluster_id is required"}), 400
        sched_type = (data.get("schedule_type") or "interval").strip()
        if sched_type not in ("interval", "daily", "once"):
            return jsonify({"error": "schedule_type must be interval, daily, or once"}), 400
        item = {
            "id": _new_schedule_id(),
            "name": name,
            "cluster_id": cluster_id,
            "dry_run": bool(data.get("dry_run", False)),
            "enabled": bool(data.get("enabled", True)),
            "schedule_type": sched_type,
            "interval_minutes": data.get("interval_minutes", 60),
            "daily_time": (data.get("daily_time") or "").strip(),
            "run_at": (data.get("run_at") or "").strip(),
            "start_at": (data.get("start_at") or "").strip(),
            "end_at": (data.get("end_at") or "").strip(),
            "description": (data.get("description") or "").strip(),
            "created_at": _now().isoformat(),
            "last_run": "",
            "next_run": "",
            "last_error": "",
        }
        item["next_run"] = _compute_next_run(item) or ""
        schedules = _load_schedules()
        schedules.append(item)
        _save_schedules(schedules)
        return {"schedule": item, "saved": True}
    return jsonify({"error": "method not allowed"}), 405


def _delete_schedule():
    rid = (request.get_json(silent=True) or {}).get("id") or request.args.get("id")
    if not rid:
        return jsonify({"error": "id is required"}), 400
    schedules = _load_schedules()
    schedules = [s for s in schedules if s.get("id") != rid]
    _save_schedules(schedules)
    return {"deleted": rid, "count": len(schedules)}


def _toggle_schedule():
    data = request.get_json(silent=True) or {}
    rid = data.get("id") or request.args.get("id")
    if not rid:
        return jsonify({"error": "id is required"}), 400
    schedules = _load_schedules()
    for s in schedules:
        if s.get("id") == rid:
            s["enabled"] = not bool(s.get("enabled"))
            s["next_run"] = _compute_next_run(s) or "" if s["enabled"] else ""
            _save_schedules(schedules)
            return {"schedule": s, "saved": True}
    return jsonify({"error": "schedule not found"}), 404


def _process_job(job, state):
    manager, err = _get_manager(job.get("cluster_id"))
    if not manager:
        job["status"] = "failed"
        # _get_manager now returns a (dict, status) tuple, so capture the real error.
        job["error"] = (
            err[0].get("error")
            if isinstance(err, tuple) and err and isinstance(err[0], dict)
            else "cluster not connected"
        )
        job["finished"] = _now().isoformat()
        return

    vm = _find_vm(manager, job.get("vmid"))
    if not vm:
        job["status"] = "failed"
        job["error"] = "VM not found in cluster"
        job["finished"] = _now().isoformat()
        return

    facts, cfg = _gather_facts(manager, vm)
    current_tags = _parse_tags(cfg.get("tags"))
    new_tags = set(current_tags)
    changes = []
    action = job.get("action") or "auto_tag"
    if action == "add_missing_tags":
        # Remediation jobs add the required tags that the Validate/Scan tabs
        # flagged as missing, not the dynamically rendered auto-tag values.
        for v in _violations_for(current_tags):
            tag = v["tag"]
            if tag not in new_tags:
                new_tags.add(tag)
                changes.append({"rule_id": v.get("rule_id"), "old": None, "new": tag})
    else:
        for rule in [r for r in _load_auto() if r.get("enabled")]:
            raw = facts.get(rule["source"])
            if raw is None or raw == "":
                continue
            desired = _render_tag(rule["template"], raw)
            prefix = rule.get("prefix") or _render_tag(rule["template"], "")
            for t in list(new_tags):
                if t.startswith(prefix) and t != desired:
                    new_tags.discard(t)
                    changes.append({"rule_id": rule["id"], "old": t, "new": desired})
            if desired and desired not in new_tags:
                new_tags.add(desired)
                changes.append({"rule_id": rule["id"], "old": None, "new": desired})

    if changes:
        ok, vm_error = _set_vm_tags(manager, vm, new_tags, cfg)
        if not ok:
            job["status"] = "failed"
            job["error"] = vm_error
            job["message"] = f"Failed to add tags: {vm_error}"
            job["finished"] = _now().isoformat()
            return

    added = [c["new"] for c in changes]
    job["status"] = "completed"
    job["tags"] = sorted(new_tags)
    job["changes"] = changes
    job["message"] = f"Added tags: {', '.join(added)}" if added else "No missing required tags to add"
    job["finished"] = _now().isoformat()


def _run_queued_jobs():
    with _state_lock:
        state = _load_state()
        changed = False
        for job in list(state.get("jobs", [])):
            if job.get("status") == "queued":
                _process_job(job, state)
                changed = True
        if changed:
            _save_state(state)


def _job_worker():
    schedule_check_interval = 60  # seconds
    last_schedule_check = 0.0
    while True:
        try:
            _run_queued_jobs()
        except Exception:
            log.exception("[%s] worker error", PLUGIN_ID)
        try:
            now = time.monotonic()
            if now - last_schedule_check >= schedule_check_interval:
                _check_schedules()
                last_schedule_check = now
        except Exception:
            log.exception("[%s] schedule worker error", PLUGIN_ID)
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
    t = threading.Thread(target=_job_worker, daemon=True, name=f"{PLUGIN_ID}-worker")
    t.start()
    log.info("[%s] background worker started", PLUGIN_ID)


def _get_ui():
    _ensure_data_files()
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    _ensure_data_files()
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "vms", _get_vms)
    register_plugin_route(PLUGIN_ID, "rules", _rules)
    register_plugin_route(PLUGIN_ID, "rule", _delete_rule)
    register_plugin_route(PLUGIN_ID, "validate", _validate)
    register_plugin_route(PLUGIN_ID, "remediate", _remediate)
    register_plugin_route(PLUGIN_ID, "scan", _scan)
    register_plugin_route(PLUGIN_ID, "scans", _get_scans)
    register_plugin_route(PLUGIN_ID, "history", _get_history)
    register_plugin_route(PLUGIN_ID, "auto_rules", _auto_rules)
    register_plugin_route(PLUGIN_ID, "auto_rule", _delete_auto_rule)
    register_plugin_route(PLUGIN_ID, "auto_tag", _run_auto_tag)
    register_plugin_route(PLUGIN_ID, "auto_runs", _get_auto_runs)
    register_plugin_route(PLUGIN_ID, "export", _get_export)
    register_plugin_route(PLUGIN_ID, "schedules", _schedules)
    register_plugin_route(PLUGIN_ID, "schedule", _delete_schedule)
    register_plugin_route(PLUGIN_ID, "schedule_toggle", _toggle_schedule)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    start_background_tasks()
    log.info(f"[PLUGINS] {PLUGIN_ID} registered")
