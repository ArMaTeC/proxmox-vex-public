# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-update-manager/routes.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Routes PY source
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
import json
import logging
import os
from datetime import datetime, timezone

from flask import g, jsonify, request

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager
from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.utils.rbac import has_permission
from ProxmoxVEx.utils.sanitization import sanitize_int, sanitize_log_message

from . import db, engine, utils
from .drivers.ssh_driver import SSHDriver
from .drivers.windows_driver import WindowsDriver

# UI assets (ui.html, ui.css, ui.js) are served by the core plugin proxy in
# ProxmoxVEx/api/plugins.py so every plugin shares the same theme-bridge
# injection and cache-busting behaviour. The plugin only registers API routes
# below this point.


def _require_perm(perm):
    user = getattr(g, "current_user", None)
    if not user or not has_permission(user, perm):
        return (
            jsonify({
                "error": "Permission denied",
                "code": "MISSING_PERMISSION",
                "required": perm,
            }),
            403,
        )
    return None


def _guests():
    if request.method == "GET":
        err = _require_perm("vm.view")
        if err:
            return err
        cluster_id = request.args.get("cluster_id", "").strip()
        try:
            guests = db.list_guests(cluster_id or None)
        except Exception as e:
            logging.exception("[vm-update] list_guests failed")
            return jsonify({"error": str(e)}), 500

        # Batch-load credentials, policies, and last checks once for the whole
        # list instead of hitting the database three times per guest.
        guest_ids = [g.id for g in guests]
        try:
            credentials = db.get_credentials_for_guests(guest_ids)
            policies = db.get_policies_for_guests(guest_ids)
            last_checks = db.get_last_checks_for_guests(guest_ids)
        except Exception:
            logging.exception("[vm-update] batch enrichment load failed")
            credentials = {}
            policies = {}
            last_checks = {}

        def _enrich(g):
            data = g.to_dict()
            try:
                policy = policies.get(g.id)
                cred = credentials.get(g.id)
                data["username"] = cred.username if cred else ""
                data["schedule_enabled"] = bool(policy.schedule_enabled) if policy else False
                data["schedule_cron"] = policy.schedule_cron if policy else ""
                data["auto_apply"] = bool(policy.auto_apply) if policy else False
                data["dry_run"] = bool(policy.dry_run) if policy else True
                data["notify_on_failure"] = bool(policy.notify_on_failure) if policy else True
                if policy and policy.schedule_enabled:
                    last = last_checks.get(g.id)
                    after = datetime.fromisoformat(last) if last else datetime.now(timezone.utc)
                    nxt = engine._next_run(policy.schedule_cron, after)
                    data["next_run"] = nxt.isoformat() if nxt else None
                else:
                    data["next_run"] = None
            except Exception:
                logging.exception(f"[vm-update] enrich guest {g.id} failed")
                data["next_run"] = None
                data["username"] = ""
            return data

        try:
            return [_enrich(g) for g in guests]
        except Exception as e:
            logging.exception("[vm-update] _guests enrichment failed")
            return jsonify({"error": str(e)}), 500

    if request.method == "POST":
        err = _require_perm("vm.config")
        if err:
            return err
        data = utils.get_json_body()
        san = utils.sanitize_guest_payload(data)
        ok, msg = utils.validate_guest_base(san)
        if not ok:
            return jsonify({"error": msg}), 400
        cluster_ok, cluster_err = check_cluster_access(san["cluster_id"])
        if not cluster_ok:
            return cluster_err
        if san["auth_type"] == "ssh_key":
            ok, msg = utils.validate_ssh_private_key(san["ssh_private_key"])
            if not ok:
                return jsonify({"error": msg}), 400
        elif not san["password"]:
            return jsonify({"error": "password is required"}), 400
        if db._guest_exists(san["cluster_id"], san["vmid"]):
            return jsonify({"error": "guest already configured"}), 409
        manager, mgr_err = get_connected_manager(san["cluster_id"])
        if not manager:
            return mgr_err
        vms = manager.get_vms() or []
        match = [v for v in vms if v.get("vmid") == san["vmid"]]
        if not match:
            return jsonify({"error": "VM not found in cluster"}), 404
        expected = "lxc" if san["guest_type"] == "lxc" else "qemu"
        if match[0].get("type") != expected:
            return (
                jsonify({"error": f"Expected {expected} for vmid {san['vmid']}"}),
                400,
            )
        password_enc = utils.encrypt_secret(san["password"]) if san["password"] else ""
        ssh_key_enc = utils.encrypt_secret(san["ssh_private_key"]) if san["ssh_private_key"] else ""
        try:
            guest_id = db.create_guest(san, san["username"], password_enc, san["auth_type"], ssh_key_enc)
        except Exception as e:
            logging.error(f"[vm-update] create guest failed: {e}")
            return jsonify({"error": "Failed to save guest"}), 500
        return {"ok": True, "guest_id": guest_id}

    return jsonify({"error": "Method not allowed"}), 405


def _guest():
    guest_id = sanitize_int(request.args.get("id"), 0, 1)
    if not guest_id:
        return jsonify({"error": "id is required"}), 400

    if request.method == "GET":
        err = _require_perm("vm.view")
        if err:
            return err
        g_obj = db.get_guest(guest_id)
        if not g_obj:
            return jsonify({"error": "guest not found"}), 404
        cred = db.get_credential(guest_id)
        policy = db.get_policy(guest_id)
        result = g_obj.to_dict()
        result["username"] = cred.username if cred else ""
        result["auth_type"] = cred.auth_type if cred else "password"
        result["schedule_enabled"] = policy.schedule_enabled if policy else False
        result["schedule_cron"] = policy.schedule_cron if policy else ""
        result["auto_apply"] = policy.auto_apply if policy else False
        result["dry_run"] = policy.dry_run if policy else True
        result["notify_on_failure"] = policy.notify_on_failure if policy else True
        return result

    if request.method == "PUT":
        err = _require_perm("vm.config")
        if err:
            return err
        data = utils.get_json_body()
        data["id"] = guest_id
        san = utils.sanitize_guest_payload(data)
        ok, msg = utils.validate_guest_base(san)
        if not ok:
            return jsonify({"error": msg}), 400
        existing = db.get_guest(guest_id)
        if not existing:
            return jsonify({"error": "guest not found"}), 404
        cluster_ok, cluster_err = check_cluster_access(san["cluster_id"])
        if not cluster_ok:
            return cluster_err
        if db._guest_exists(san["cluster_id"], san["vmid"], exclude_id=guest_id):
            return jsonify({"error": "guest already configured"}), 409
        if san["auth_type"] == "ssh_key" and san["ssh_private_key"]:
            ok, msg = utils.validate_ssh_private_key(san["ssh_private_key"])
            if not ok:
                return jsonify({"error": msg}), 400
        password_enc = utils.encrypt_secret(san["password"]) if san["password"] else None
        ssh_key_enc = utils.encrypt_secret(san["ssh_private_key"]) if san["ssh_private_key"] else None
        try:
            updated = db.update_guest(guest_id, san, san["username"], password_enc, san["auth_type"], ssh_key_enc)
        except Exception as e:
            logging.error(f"[vm-update] update guest failed: {e}")
            return jsonify({"error": "Failed to update guest"}), 500
        return {"ok": updated}

    if request.method == "DELETE":
        err = _require_perm("vm.config")
        if err:
            return err
        try:
            deleted = db.delete_guest(guest_id)
        except Exception as e:
            logging.error(f"[vm-update] delete guest failed: {e}")
            return jsonify({"error": "Failed to delete guest"}), 500
        return {"ok": deleted}

    return jsonify({"error": "Method not allowed"}), 405


def _guest_connect():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    err = _require_perm("vm.config")
    if err:
        return err
    data = utils.get_json_body()
    guest_id = sanitize_int(data.get("guest_id"), 0, 1)
    if not guest_id:
        return jsonify({"error": "guest_id is required"}), 400
    guest, cred = db.get_guest_with_credential(guest_id)
    if not guest or not cred:
        return jsonify({"error": "guest not found"}), 404
    if not cred.password_enc and not cred.ssh_key_enc:
        return jsonify({"error": "no credentials stored"}), 400
    try:
        password, private_key = utils.resolve_credential_secret(cred)
    except Exception as e:
        logging.error(f"[vm-update] decrypt error: {e}")
        return jsonify({"error": "failed to decrypt credentials"}), 500
    driver = _get_driver(guest)
    try:
        result = driver.connect(guest.ip_host, guest.ssh_port, cred.username, password, private_key=private_key)
    except Exception as e:
        logging.error(f"[vm-update] connect error: {e}")
        result = {"ok": False, "error": sanitize_log_message(str(e))}
    db.update_guest_status(
        guest_id,
        "reachable" if result.get("ok") else (result.get("error") or "unreachable"),
        datetime.now(timezone.utc).isoformat(),
    )
    return result


def _guest_check():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    err = _require_perm("vm.config")
    if err:
        return err
    data = utils.get_json_body()
    guest_id = sanitize_int(data.get("guest_id"), 0, 1)
    if not guest_id:
        return jsonify({"error": "guest_id is required"}), 400
    guest = db.get_guest(guest_id)
    if not guest:
        return jsonify({"error": "guest not found"}), 404
    cluster_ok, cluster_err = check_cluster_access(guest.cluster_id)
    if not cluster_ok:
        return cluster_err
    try:
        job_id = db.create_job(guest_id, "check")
        engine.enqueue_job({"job_id": job_id, "guest_id": guest_id, "job_type": "check"})
    except Exception as e:
        logging.error(f"[vm-update] enqueue check failed: {e}")
        return jsonify({"error": "Failed to enqueue check"}), 500
    return {"ok": True, "job_id": job_id}


def _guest_preview():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    err = _require_perm("vm.config")
    if err:
        return err
    data = utils.get_json_body()
    guest_id = sanitize_int(data.get("guest_id"), 0, 1)
    if not guest_id:
        return jsonify({"error": "guest_id is required"}), 400
    guest, cred = db.get_guest_with_credential(guest_id)
    if not guest or not cred:
        return jsonify({"error": "guest not found"}), 404
    try:
        password, private_key = utils.resolve_credential_secret(cred)
    except Exception as e:
        logging.error(f"[vm-update] decrypt error: {e}")
        return jsonify({"error": "failed to decrypt credentials"}), 500
    driver = _get_driver(guest)
    try:
        result = driver.apply(
            guest.ip_host,
            guest.ssh_port,
            cred.username,
            password,
            dry_run=True,
            timeout=300,
            private_key=private_key,
        )
    except Exception as e:
        logging.error(f"[vm-update] preview error: {e}")
        result = {"ok": False, "error": sanitize_log_message(str(e))}
    return result


def _guest_checks():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    err = _require_perm("vm.view")
    if err:
        return err
    raw_guest = request.args.get("guest_id")
    guest_id = None
    if raw_guest:
        try:
            guest_id = int(raw_guest)
        except (ValueError, TypeError):
            return jsonify({"error": "guest_id must be an integer"}), 400
    limit = sanitize_int(request.args.get("limit"), 20, 1, 100)
    offset = sanitize_int(request.args.get("offset"), 0, 0)
    jobs = db.list_jobs(guest_id, limit, offset)
    return [j.to_dict() for j in jobs]


def _guest_packages():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    err = _require_perm("vm.view")
    if err:
        return err
    job_id = sanitize_int(request.args.get("job_id"), 0, 1)
    if not job_id:
        return jsonify({"error": "job_id is required"}), 400
    packages = db.list_packages(job_id)
    return [p.to_dict() for p in packages]


def _get_driver(guest):
    if guest.os_family == "windows":
        return WindowsDriver()
    return SSHDriver()


def _apply():
    if request.method != "POST":
        return jsonify({"error": "Method not allowed"}), 405
    err = _require_perm("vm.config")
    if err:
        return err
    data = utils.get_json_body()
    guest_id = sanitize_int(data.get("guest_id"), 0, 1)
    if not guest_id:
        return jsonify({"error": "guest_id is required"}), 400
    guest = db.get_guest(guest_id)
    if not guest:
        return jsonify({"error": "guest not found"}), 404
    cluster_ok, cluster_err = check_cluster_access(guest.cluster_id)
    if not cluster_ok:
        return cluster_err
    try:
        job_id = db.create_job(guest_id, "apply")
        engine.enqueue_job({"job_id": job_id, "guest_id": guest_id, "job_type": "apply", "manual": True})
    except Exception as e:
        logging.error(f"[vm-update] apply enqueue failed: {e}")
        return jsonify({"error": "Failed to enqueue apply"}), 500
    return {"ok": True, "job_id": job_id}


def _jobs():
    if request.method == "GET":
        err = _require_perm("vm.view")
        if err:
            return err
        raw_guest = request.args.get("guest_id")
        guest_id = None
        if raw_guest:
            try:
                guest_id = int(raw_guest)
            except (ValueError, TypeError):
                return jsonify({"error": "guest_id must be an integer"}), 400
        limit = sanitize_int(request.args.get("limit"), 50, 1, 100)
        offset = sanitize_int(request.args.get("offset"), 0, 0)
        jobs = db.list_jobs(guest_id, limit, offset)
        return [j.to_dict() for j in jobs]
    return jsonify({"error": "Method not allowed"}), 405


def _job():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    err = _require_perm("vm.view")
    if err:
        return err
    job_id = sanitize_int(request.args.get("id"), 0, 1)
    if not job_id:
        return jsonify({"error": "id is required"}), 400
    j = db.get_job(job_id)
    if not j:
        return jsonify({"error": "job not found"}), 404
    return j.to_dict()


def _config():
    err = _require_perm("plugins.view")
    if err:
        return err
    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    if request.method == "GET":
        try:
            with open(config_path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    if request.method == "POST" or request.method == "PUT":
        err = _require_perm("plugins.manage")
        if err:
            return err
        data = request.get_json(silent=True) or {}
        try:
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            return {"ok": True}
        except Exception as e:
            logging.error(f"[vm-update] save config failed: {e}")
            return jsonify({"error": "Failed to save config"}), 500
    return jsonify({"error": "Method not allowed"}), 405


def _guest_vms():
    if request.method != "GET":
        return jsonify({"error": "Method not allowed"}), 405
    err = _require_perm("vm.view")
    if err:
        return err
    cluster_id = request.args.get("cluster_id", "").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    cluster_ok, cluster_err = check_cluster_access(cluster_id)
    if not cluster_ok:
        return cluster_err
    manager, mgr_err = get_connected_manager(cluster_id)
    if not manager:
        return mgr_err
    try:
        resources = manager.get_vm_resources()
    except Exception as e:
        logging.error(f"[vm-update] get_vm_resources failed: {e}")
        return jsonify({"error": "Failed to load VM resources"}), 500
    vms = []
    for r in resources:
        if r.get("type") in ("qemu", "lxc") and r.get("vmid"):
            vms.append({
                "vmid": r.get("vmid"),
                "name": r.get("name", ""),
                "node": r.get("node"),
                "type": r.get("type"),
                "status": r.get("status", "unknown"),
                "ip": r.get("ip", ""),
                "ip_addresses": r.get("ip_addresses", []),
            })
    vms.sort(key=lambda x: x.get("vmid", 0))
    return {"vms": vms}


def register_all():
    # UI assets are served by the core plugin proxy; only API routes need to be
    # registered here (see ProxmoxVEx/api/plugins.py).
    register_plugin_route("vm-update-manager", "guests", _guests)
    register_plugin_route("vm-update-manager", "guest", _guest)
    register_plugin_route("vm-update-manager", "guests/connect", _guest_connect)
    register_plugin_route("vm-update-manager", "guests/preview", _guest_preview)
    register_plugin_route("vm-update-manager", "check", _guest_check)
    register_plugin_route("vm-update-manager", "checks", _guest_checks)
    register_plugin_route("vm-update-manager", "packages", _guest_packages)
    register_plugin_route("vm-update-manager", "apply", _apply)
    register_plugin_route("vm-update-manager", "jobs", _jobs)
    register_plugin_route("vm-update-manager", "job", _job)
    register_plugin_route("vm-update-manager", "config", _config)
    register_plugin_route("vm-update-manager", "guests/vm-list", _guest_vms)
