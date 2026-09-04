# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/ups-monitor/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: UPS Monitor - paid plugin for monitoring UPS devices.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
UPS Monitor - paid plugin for monitoring UPS devices.

Supports NUT (Network UPS Tools) servers for live power and battery readings,
configurable thresholds, and event logging. Designed for datacenter-grade
power visibility without requiring agents on Proxmox hosts.
"""

import json
import logging
import re
import socket
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "ups-monitor"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "state.json"

DEFAULT_POLL_INTERVAL = 60
DEFAULT_THRESHOLDS = {
    "low_battery_pct": 20,
    "low_runtime_minutes": 10,
    "max_load_pct": 90,
    "max_temperature_c": 45,
}
KEY_VARIABLES = [
    "battery.charge",
    "battery.runtime",
    "battery.runtime.low",
    "battery.voltage",
    "input.voltage",
    "input.voltage.nominal",
    "ups.load",
    "ups.realpower",
    "ups.realpower.nominal",
    "ups.status",
    "ups.temperature",
]
SEVERITY_RANK = {"ok": 0, "warning": 1, "critical": 2}


def _higher_severity(a, b):
    """Return the more severe of two severity strings."""
    return a if SEVERITY_RANK.get(a, 0) >= SEVERITY_RANK.get(b, 0) else b


def _load_state():
    if not STATE_FILE.exists():
        return {"config": {"devices": []}, "readings": {}, "events": []}
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            data = json.load(f)
        data.setdefault("config", {"devices": []})
        data.setdefault("readings", {})
        data.setdefault("events", [])
        data["config"].setdefault("devices", [])
        return data
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return {"config": {"devices": []}, "readings": {}, "events": []}


def _save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except OSError as e:
        log.error("Failed to save state: %s", e)


def _new_id():
    return uuid.uuid4().hex[:12]


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _nut_query(host, port, command, username=None, password=None, timeout=5):
    """Send a single NUT protocol command and return all response lines."""
    with socket.create_connection((host, int(port)), timeout=timeout) as s:
        s.settimeout(timeout)
        reader = s.makefile("r", encoding="ascii", errors="replace")
        # consume connection banner
        reader.readline()

        if username:
            s.sendall(f"USERNAME {username}\n".encode("ascii"))
            line = reader.readline().strip()
            if line.startswith("ERR"):
                raise RuntimeError(f"NUT username rejected: {line}")

        if password:
            s.sendall(f"PASSWORD {password}\n".encode("ascii"))
            line = reader.readline().strip()
            if line.startswith("ERR"):
                raise RuntimeError(f"NUT password rejected: {line}")

        s.sendall(f"{command}\n".encode("ascii"))
        lines = []
        while True:
            line = reader.readline()
            if not line:
                break
            line = line.rstrip("\n").rstrip("\r")
            if line.startswith("ERR"):
                raise RuntimeError(line)
            lines.append(line)
            if line.startswith("END "):
                break
        return lines


def _parse_nut_list(lines):
    """Parse LIST UPS or LIST VAR NUT responses."""
    ups_list = []
    var_map = {}
    var_re = re.compile(r'^VAR\s+\S+\s+(\S+)\s+"(.*)"$')
    ups_re = re.compile(r'^UPS\s+(\S+)\s+"(.*)"$')
    for line in lines:
        m = ups_re.match(line)
        if m:
            ups_list.append({"name": m.group(1), "description": m.group(2)})
            continue
        m = var_re.match(line)
        if m:
            var_map[m.group(1)] = m.group(2)
    return ups_list, var_map


def _read_nut_device(device):
    """Fetch the configured variables for a single NUT-backed UPS device."""
    host = device.get("host", "localhost")
    port = device.get("port", 3493)
    name = device.get("ups_name", "ups")
    user = device.get("username") or None
    passwd = device.get("password") or None
    lines = _nut_query(host, port, f"LIST VAR {name}", user, passwd)
    _, variables = _parse_nut_list(lines)
    return variables


def _numeric(variables, key, default=None):
    """Extract a float from a NUT variable value if present and parseable."""
    value = variables.get(key)
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def _evaluate_status(device, variables):
    """Derive a simple status from NUT ups.status and numeric thresholds."""
    status = variables.get("ups.status", "")
    flags = set(status.split())
    thresholds = {**DEFAULT_THRESHOLDS, **(device.get("thresholds") or {})}
    issues = []
    severity = "ok"

    if "OB" in flags:
        issues.append("On battery")
        severity = _higher_severity(severity, "warning")
    if "LB" in flags:
        issues.append("Low battery")
        severity = _higher_severity(severity, "critical")
    if "RB" in flags:
        issues.append("Replace battery")
        severity = _higher_severity(severity, "warning")

    charge = _numeric(variables, "battery.charge")
    if charge is not None and charge < thresholds["low_battery_pct"]:
        issues.append(f"Battery charge {charge}% below {thresholds['low_battery_pct']}%")
        severity = _higher_severity(severity, "critical")

    runtime = _numeric(variables, "battery.runtime")
    if runtime is not None and runtime < thresholds["low_runtime_minutes"] * 60:
        issues.append(f"Runtime {int(runtime)}s below {thresholds['low_runtime_minutes']} min")
        severity = _higher_severity(severity, "critical")

    load = _numeric(variables, "ups.load")
    if load is not None and load > thresholds["max_load_pct"]:
        issues.append(f"UPS load {load}% above {thresholds['max_load_pct']}%")
        severity = _higher_severity(severity, "warning")

    temp = _numeric(variables, "ups.temperature")
    if temp is not None and temp > thresholds["max_temperature_c"]:
        issues.append(f"Temperature {temp}C above {thresholds['max_temperature_c']}C")
        severity = _higher_severity(severity, "warning")

    return {
        "raw_status": status,
        "on_battery": "OB" in flags,
        "low_battery": "LB" in flags,
        "severity": severity,
        "issues": issues,
    }


def _refresh_readings():
    """Poll every configured device and update stored readings plus events."""
    state = _load_state()
    devices = state["config"].get("devices", [])
    readings = state["readings"]
    events = state["events"]
    now = _now_iso()

    for device in devices:
        did = device["device_id"]
        try:
            variables = _read_nut_device(device)
            eval_status = _evaluate_status(device, variables)
            previous = readings.get(did)
            if previous and previous.get("status"):
                prev = previous["status"]
                # emit an event when the power source changes
                if eval_status["on_battery"] and not prev.get("on_battery"):
                    events.append({
                        "event_id": _new_id(),
                        "device_id": did,
                        "type": "power_loss",
                        "message": f"{device.get('name', did)} switched to battery power",
                        "severity": "warning",
                        "created_at": now,
                    })
                elif not eval_status["on_battery"] and prev.get("on_battery"):
                    events.append({
                        "event_id": _new_id(),
                        "device_id": did,
                        "type": "power_restored",
                        "message": f"{device.get('name', did)} returned to mains power",
                        "severity": "info",
                        "created_at": now,
                    })
                # emit low battery transitions
                if eval_status["low_battery"] and not prev.get("low_battery"):
                    events.append({
                        "event_id": _new_id(),
                        "device_id": did,
                        "type": "low_battery",
                        "message": f"{device.get('name', did)} reports low battery",
                        "severity": "critical",
                        "created_at": now,
                    })

            readings[did] = {
                "device_id": did,
                "polled_at": now,
                "variables": {k: variables.get(k) for k in KEY_VARIABLES if k in variables},
                "status": eval_status,
            }
        except Exception as e:
            readings[did] = {
                "device_id": did,
                "polled_at": now,
                "variables": {},
                "status": {
                    "raw_status": "",
                    "on_battery": False,
                    "low_battery": False,
                    "severity": "critical",
                    "issues": [str(e)],
                },
            }

    # keep only the most recent 500 events to avoid unbounded growth
    events[:] = events[-500:]
    state["last_poll_at"] = now
    _save_state(state)
    return state


# ---- API handlers ----


def _get_status():
    state = _load_state()
    readings = state.get("readings", {})
    on_battery = sum(1 for r in readings.values() if r.get("status", {}).get("on_battery"))
    low_battery = sum(1 for r in readings.values() if r.get("status", {}).get("low_battery"))
    critical = sum(1 for r in readings.values() if r.get("status", {}).get("severity") == "critical")
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "version": "1.0.0",
        "device_count": len(state["config"].get("devices", [])),
        "on_battery_count": on_battery,
        "low_battery_count": low_battery,
        "critical_count": critical,
        "last_poll_at": state.get("last_poll_at"),
    }


def _get_config():
    state = _load_state()
    return {"config": state["config"]}


def _post_config():
    body = request.get_json(silent=True) or {}
    state = _load_state()
    # only store whitelisted top-level keys to keep the surface small
    for key in ("poll_interval", "webhook_url"):
        if key in body:
            state["config"][key] = body[key]
    _save_state(state)
    return {"saved": True}


def _get_devices():
    state = _load_state()
    return {"devices": state["config"].get("devices", [])}


def _post_device():
    body = request.get_json(silent=True) or {}
    state = _load_state()
    devices = state["config"].setdefault("devices", [])
    device_id = (body.get("device_id") or "").strip()
    if not device_id:
        device_id = _new_id()

    device = {
        "device_id": device_id,
        "name": (body.get("name") or "UPS").strip(),
        "driver": "nut",
        "host": (body.get("host") or "localhost").strip(),
        "port": int(body.get("port", 3493)),
        "ups_name": (body.get("ups_name") or "ups").strip(),
        "username": (body.get("username") or "").strip() or None,
        "password": (body.get("password") or "").strip() or None,
        "thresholds": {**DEFAULT_THRESHOLDS, **(body.get("thresholds") or {})},
    }

    # replace existing entry with the same id, or append
    for i, d in enumerate(devices):
        if d["device_id"] == device_id:
            devices[i] = device
            break
    else:
        devices.append(device)

    _save_state(state)
    return {"device": device}


def _delete_device():
    body = request.get_json(silent=True) or {}
    device_id = (body.get("device_id") or "").strip()
    if not device_id:
        return jsonify({"error": "device_id is required"}), 400
    state = _load_state()
    state["config"]["devices"] = [d for d in state["config"].get("devices", []) if d["device_id"] != device_id]
    state["readings"].pop(device_id, None)
    _save_state(state)
    return {"deleted": device_id}


def _post_test():
    body = request.get_json(silent=True) or {}
    host = (body.get("host") or "localhost").strip()
    port = int(body.get("port", 3493))
    ups_name = (body.get("ups_name") or "ups").strip()
    username = (body.get("username") or "").strip() or None
    password = (body.get("password") or "").strip() or None
    try:
        lines = _nut_query(host, port, f"LIST VAR {ups_name}", username, password)
        _, variables = _parse_nut_list(lines)
        return {"connected": True, "variables": variables}
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)}), 502


def _post_refresh():
    state = _refresh_readings()
    return {"readings": state.get("readings", {}), "last_poll_at": state.get("last_poll_at")}


def _get_readings():
    state = _load_state()
    return {"readings": state.get("readings", {}), "last_poll_at": state.get("last_poll_at")}


def _get_events():
    state = _load_state()
    return {"events": state.get("events", [])[-100:]}


def _get_ui():
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "config", _get_config)
    register_plugin_route(PLUGIN_ID, "config_save", _post_config)
    register_plugin_route(PLUGIN_ID, "devices", _get_devices)
    register_plugin_route(PLUGIN_ID, "device_save", _post_device)
    register_plugin_route(PLUGIN_ID, "device_delete", _delete_device)
    register_plugin_route(PLUGIN_ID, "test", _post_test)
    register_plugin_route(PLUGIN_ID, "refresh", _post_refresh)
    register_plugin_route(PLUGIN_ID, "readings", _get_readings)
    register_plugin_route(PLUGIN_ID, "events", _get_events)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
