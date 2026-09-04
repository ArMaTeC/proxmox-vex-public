# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/ansible-runner/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Ansible Playbook Runner - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Ansible Playbook Runner - full UI management backend.
Run Ansible playbooks against Proxmox nodes/VMs via ProxmoxVEx and report results.
"""

import json
import logging
import re
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import check_cluster_access
from ProxmoxVEx.api.plugins import register_plugin_route

PLUGIN_ID = "ansible-runner"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
STATE_FILE = PLUGIN_DIR / "state.json"
_state_lock = threading.RLock()
_worker_started = False

CRON_RE = re.compile(r"^[\d\-*/, ]+$")

DEFAULT_PLAYBOOKS = [
    {"id": "pb-node-update", "name": "node-update.yml", "path": "playbooks/node-update.yml"},
    {"id": "pb-backup-all", "name": "backup-all-guests.yml", "path": "playbooks/backup-all-guests.yml"},
    {"id": "pb-reboot", "name": "reboot-required.yml", "path": "playbooks/reboot-required.yml"},
    {
        "id": "pb-no-sub-repo",
        "name": "configure-no-subscription-repo.yml",
        "path": "playbooks/configure-no-subscription-repo.yml",
    },
]


def _load_state():
    if not STATE_FILE.exists():
        return {}
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Failed to load state: %s", e)
        return {}


def _save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except OSError as e:
        log.error("Failed to save state: %s", e)


def _new_id():
    return uuid.uuid4().hex[:12]


def _resolve_playbook_path(raw_path):
    """Resolve a playbook path relative to the server's working directory.

    Only relative paths are allowed and the resolved location must stay
    within the current working directory so playbook files cannot be
    written or executed from arbitrary filesystem locations.
    """
    p = Path(raw_path)
    if p.is_absolute():
        return None
    try:
        root = Path.cwd().resolve()
        full = (root / p).resolve()
        full.relative_to(root)
        return full
    except (ValueError, OSError):
        return None


def _is_valid_cron(expr):
    if not expr:
        return False
    parts = expr.split()
    return len(parts) == 5 and all(CRON_RE.match(part) for part in parts)


def _get_status():
    state = _load_state()
    runs = state.get("runs", [])
    schedules = state.get("schedules", [])
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "version": "1.1.0",
        "run_count": len(runs),
        "schedule_count": len(schedules),
    }


def _get_clusters():
    from ProxmoxVEx.globals import cluster_managers

    try:
        return {"data": [{"id": c, "display_name": c} for c in (cluster_managers or {})]}
    except Exception as e:
        log.warning("clusters failed: %s", e)
    return {"data": []}


def _playbooks():
    state = _load_state()
    if request.method == "GET":
        return {"playbooks": state.get("playbooks", DEFAULT_PLAYBOOKS)}
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        path = (body.get("path") or "").strip()
        content = body.get("content")
        if not name or not path:
            return jsonify({"error": "name and path are required"}), 400
        playbooks = state.get("playbooks", list(DEFAULT_PLAYBOOKS))
        existing = next((p for p in playbooks if p.get("id") == body.get("id")), None)
        for p in playbooks:
            if p.get("name") == name and p.get("id") != body.get("id"):
                return jsonify({"error": "name must be unique"}), 400
        pb = {"id": body.get("id") or _new_id(), "name": name, "path": path}
        if content is not None:
            pb_path = _resolve_playbook_path(path)
            if not pb_path:
                return jsonify({"error": "invalid or unsafe playbook path"}), 400
            try:
                pb_path.parent.mkdir(parents=True, exist_ok=True)
                pb_path.write_text(content, encoding="utf-8")
            except OSError as exc:
                return jsonify({"error": f"Failed to write playbook file: {exc}"}), 500
        if existing:
            for idx, p in enumerate(playbooks):
                if p.get("id") == pb["id"]:
                    playbooks[idx] = pb
                    break
        else:
            playbooks.append(pb)
        state["playbooks"] = playbooks
        _save_state(state)
        return {"playbook": pb, "saved": True}
    if request.method == "DELETE":
        pbid = (request.get_json(silent=True) or {}).get("id") or request.args.get("id")
        if not pbid:
            return jsonify({"error": "id is required"}), 400
        playbooks = state.get("playbooks", [])
        state["playbooks"] = [p for p in playbooks if p.get("id") != pbid]
        _save_state(state)
        return {"deleted": pbid}
    return jsonify({"error": "Method not allowed"}), 405


def _post_run():
    body = request.get_json(silent=True) or {}
    playbook = body.get("playbook", "").strip()
    cluster_id = body.get("cluster_id", "").strip()
    if not playbook:
        return jsonify({"error": "playbook is required"}), 400
    if cluster_id:
        allowed, err = check_cluster_access(cluster_id)
        if not allowed:
            return err
    state = _load_state()
    run = {
        "run_id": _new_id(),
        "playbook": playbook,
        "cluster_id": cluster_id,
        "limit": body.get("limit", ""),
        "extra_vars": body.get("extra_vars", {}),
        "dry_run": bool(body.get("dry_run")),
        "status": "queued",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    state.setdefault("runs", []).append(run)
    _save_state(state)
    return {"run": run}


def _get_runs():
    run_id = request.args.get("id") or request.args.get("run_id", "").strip()
    state = _load_state()
    if run_id:
        for r in state.get("runs", []):
            if r.get("run_id") == run_id:
                return {"run": r}
        return jsonify({"error": "run not found"}), 404
    return {"runs": state.get("runs", [])[::-1]}


def _get_logs():
    run_id = request.args.get("id") or request.args.get("run_id", "").strip()
    if not run_id:
        return jsonify({"error": "run_id or id is required"}), 400
    state = _load_state()
    logs = [log for log in state.get("logs", []) if log.get("run_id") == run_id]
    return {"run_id": run_id, "logs": logs}


def _schedules():
    state = _load_state()
    if request.method == "GET":
        return {"schedules": state.get("schedules", [])}
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        schedule = body.get("schedule", "").strip()
        if not schedule or not _is_valid_cron(schedule):
            return jsonify({"error": "invalid cron expression"}), 400
        if not body.get("playbook"):
            return jsonify({"error": "playbook is required"}), 400
        entry = {
            "id": _new_id(),
            "playbook": body.get("playbook"),
            "cluster_id": body.get("cluster_id", ""),
            "schedule": schedule,
            "extra_vars": body.get("extra_vars", {}),
            "enabled": bool(body.get("enabled", True)),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        state.setdefault("schedules", []).append(entry)
        _save_state(state)
        return {"schedule": entry}
    if request.method == "DELETE":
        sid = (request.get_json(silent=True) or {}).get("id") or request.args.get("id")
        if not sid:
            return jsonify({"error": "id is required"}), 400
        state["schedules"] = [s for s in state.get("schedules", []) if s.get("id") != sid]
        _save_state(state)
        return {"deleted": sid}
    return jsonify({"error": "Method not allowed"}), 405


def _playbook_path(run, state):
    playbooks = state.get("playbooks", list(DEFAULT_PLAYBOOKS))
    pbid = run.get("playbook")
    pb = next((p for p in playbooks if p.get("id") == pbid or p.get("name") == pbid), None)
    raw = pb.get("path") if pb else pbid
    resolved = _resolve_playbook_path(raw) if raw else None
    return str(resolved) if resolved else None


def _process_run(run, state):
    path = _playbook_path(run, state)
    if not path:
        run["status"] = "failed"
        run["error"] = "playbook path not found"
        run["completed_at"] = datetime.now(timezone.utc).isoformat()
        return

    if not Path(path).is_file():
        run["status"] = "failed"
        run["error"] = f"playbook file not found: {path}"
        run["completed_at"] = datetime.now(timezone.utc).isoformat()
        return

    cmd = ["ansible-playbook", path]
    if run.get("limit"):
        cmd += ["-l", str(run["limit"])]
    if run.get("dry_run"):
        cmd += ["--check", "--diff"]
    for k, v in (run.get("extra_vars") or {}).items():
        if v is not None:
            cmd += ["-e", f"{k}={v}"]
    run["status"] = "running"
    run["started_at"] = datetime.now(timezone.utc).isoformat()
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,
        )
        run["output"] = proc.stdout
        run["stderr"] = proc.stderr
        run["returncode"] = proc.returncode
        run["status"] = "completed" if proc.returncode == 0 else "failed"
    except subprocess.TimeoutExpired:
        run["status"] = "failed"
        run["error"] = "ansible-playbook timed out after 600s"
    except FileNotFoundError:
        run["status"] = "failed"
        run["error"] = "ansible-playbook command not found"
    except Exception as exc:
        run["status"] = "failed"
        run["error"] = str(exc)
    run["completed_at"] = datetime.now(timezone.utc).isoformat()


def _run_queued_runs():
    with _state_lock:
        state = _load_state()
        changed = False
        for run in list(state.get("runs", [])):
            if run.get("status") == "queued":
                _process_run(run, state)
                changed = True
        if changed:
            _save_state(state)


def _job_worker():
    while True:
        try:
            _run_queued_runs()
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
    t = threading.Thread(target=_job_worker, daemon=True, name=f"{PLUGIN_ID}-worker")
    t.start()
    log.info("[%s] background worker started", PLUGIN_ID)


def _get_playbook_content():
    pbid = request.args.get("id", "").strip()
    if not pbid:
        return jsonify({"error": "id is required"}), 400
    state = _load_state()
    playbooks = state.get("playbooks", list(DEFAULT_PLAYBOOKS))
    pb = next((p for p in playbooks if p.get("id") == pbid), None)
    if not pb:
        return jsonify({"error": "playbook not found"}), 404
    resolved = _resolve_playbook_path(pb.get("path"))
    if not resolved or not resolved.is_file():
        return {"content": ""}
    try:
        return {"content": resolved.read_text(encoding="utf-8")}
    except OSError as exc:
        log.warning("Failed to read playbook %s: %s", pb.get("path"), exc)
        return {"content": ""}


def _get_ui():
    """Serve the Ansible Runner HTML interface"""
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "playbooks", _playbooks)
    register_plugin_route(PLUGIN_ID, "playbook-content", _get_playbook_content)
    register_plugin_route(PLUGIN_ID, "run", _post_run)
    register_plugin_route(PLUGIN_ID, "runs", _get_runs)
    register_plugin_route(PLUGIN_ID, "logs", _get_logs)
    register_plugin_route(PLUGIN_ID, "schedules", _schedules)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    start_background_tasks()
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
