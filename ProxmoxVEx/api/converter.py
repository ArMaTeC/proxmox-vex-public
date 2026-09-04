# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/api/converter.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: API endpoints for LXC/VM conversion, disk resize, and...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
API endpoints for LXC/VM conversion, disk resize, and clone-replace.
"""

from __future__ import annotations

import logging

from flask import Blueprint, g, jsonify, request

from ProxmoxVEx.api.helpers import check_cluster_access
from ProxmoxVEx.converter import db as converter_db
from ProxmoxVEx.converter.constants import (
    SUPPORTED_LXC_TO_VM_DISTROS,
    SUPPORTED_VM_TO_LXC_DISTROS,
    WorkloadType,
)
from ProxmoxVEx.converter.engine import (
    JobNotFoundError,
    clear_jobs,
    delete_job,
    get_engine,
    list_jobs,
    load_job,
)
from ProxmoxVEx.converter.models import ConversionJob, WorkloadRef
from ProxmoxVEx.converter.preflight import _check_target_collision, run_preflight
from ProxmoxVEx.converter.runner import get_runner
from ProxmoxVEx.converter.validators import ValidationError, validate_job_payload
from ProxmoxVEx.models.permissions import ROLE_ADMIN
from ProxmoxVEx.utils.auth import require_auth
from ProxmoxVEx.utils.rbac import has_permission

# Package sets used by the auto-fix endpoint for missing host tools.
_FIX_PACKAGES = {
    "lxc_to_vm": ["parted", "kpartx", "rsync", "qemu-utils"],
    "vm_to_lxc": ["parted", "kpartx", "rsync", "qemu-utils"],
    "clone_replace_disk": ["parted", "kpartx", "rsync", "qemu-utils"],
    "shrink_lxc": ["e2fsprogs"],
    "expand_lxc": ["e2fsprogs"],
    "shrink_vm": ["e2fsprogs", "qemu-utils"],
    "expand_vm": ["e2fsprogs", "qemu-utils"],
}

bp = Blueprint("converter", __name__)


def _current_username() -> str:
    user = request.session.get("user", "unknown") if hasattr(request, "session") else "unknown"
    return user or "unknown"


def _access_denied():
    return jsonify({"error": "Access denied to this cluster"}), 403


def _current_user() -> dict:
    """Return the acting user dict set by require_auth, falling back to a DB lookup."""
    user = getattr(g, "current_user", None)
    if user is not None:
        return user
    try:
        from ProxmoxVEx.core.db import get_db

        return get_db().get_user(_current_username()) or {}
    except Exception:
        return {"role": request.session.get("role", "")} if hasattr(request, "session") else {}


def _is_admin_or_owner(job: ConversionJob) -> bool:
    """True if the acting user is an admin or the job creator."""
    user = _current_user()
    if user.get("role") == ROLE_ADMIN:
        return True
    if has_permission(user, "converter.admin"):
        return True
    return job.created_by == _current_username()


def _api_error(default_msg):
    """Return a safe JSON error response and log the active exception server-side."""
    logging.exception(default_msg)
    return jsonify({"error": default_msg}), 500


def _job_response(job: ConversionJob):
    return jsonify(job.to_dict())


def _preflight_response(report):
    return jsonify({
        "job_id": report.job_id,
        "overall_passed": report.overall_passed,
        "checks": [
            {
                "name": c.name,
                "category": c.category,
                "passed": c.passed,
                "required": c.required,
                "message": c.message,
                "reason": c.reason,
                "fix": c.fix,
                "fix_commands": c.fix_commands,
                "auto_fix": c.auto_fix,
            }
            for c in report.checks
        ],
    })


@bp.route("/api/converter/jobs", methods=["GET"])
@require_auth(perms=["converter.view"])
def get_jobs():
    """List conversion/resize jobs."""
    cluster_id = request.args.get("cluster_id")
    node = request.args.get("node")
    status = request.args.get("status")
    operation = request.args.get("operation")
    try:
        limit = int(request.args.get("limit", 100))
        offset = int(request.args.get("offset", 0))
    except ValueError:
        return jsonify({"error": "limit and offset must be integers"}), 400

    jobs = list_jobs(
        cluster_id=cluster_id,
        node=node,
        status=status,
        operation=operation,
        limit=limit,
        offset=offset,
    )
    return jsonify({"items": [j.to_dict() for j in jobs], "total": len(jobs)})


@bp.route("/api/converter/jobs", methods=["POST"])
@require_auth(perms=["converter.run"])
def submit_job():
    """Submit a new conversion/resize job."""
    payload = request.get_json(silent=True) or {}
    cluster_id = payload.get("source_cluster_id")
    if not cluster_id:
        return jsonify({"error": "source_cluster_id is required"}), 400

    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    try:
        job = get_engine().submit_job(payload, _current_username())
    except ValidationError as exc:
        return jsonify({"error": "Validation failed", "field": exc.field, "message": exc.message}), 400
    except Exception:
        return _api_error("Failed to submit converter job")

    return jsonify({"job_id": job.id, "status": job.status.value}), 202


@bp.route("/api/converter/jobs/<job_id>", methods=["GET"])
@require_auth(perms=["converter.view"])
def get_job(job_id: str):
    """Get a single job by ID."""
    try:
        job = load_job(job_id)
    except JobNotFoundError:
        return jsonify({"error": "Job not found"}), 404
    except Exception:
        return _api_error("Failed to load job")

    if not (job.source is not None):
        raise AssertionError("invariant failed")
    ok, _ = check_cluster_access(job.source.cluster_id)
    if not ok:
        return _access_denied()

    return _job_response(job)


@bp.route("/api/converter/jobs/<job_id>/cancel", methods=["POST"])
@require_auth(perms=["converter.run"])
def cancel_job(job_id: str):
    """Request cancellation of a running or pending job."""
    try:
        job = load_job(job_id)
    except JobNotFoundError:
        return jsonify({"error": "Job not found"}), 404
    except Exception:
        return _api_error("Failed to load job")

    if not (job.source is not None):
        raise AssertionError("invariant failed")
    ok, _ = check_cluster_access(job.source.cluster_id)
    if not ok:
        return _access_denied()

    if job.status.value in ("succeeded", "failed", "cancelled", "rolled_back"):
        return jsonify({"error": "Job is already terminal"}), 400

    get_engine().request_cancel(job_id)
    return jsonify({"message": "Cancellation requested", "job_id": job_id})


@bp.route("/api/converter/jobs/<job_id>/stop", methods=["POST"])
@require_auth(perms=["converter.run"])
def stop_job(job_id: str):
    """Stop a running conversion job (alias for cancel)."""
    return cancel_job(job_id)


@bp.route("/api/converter/jobs/<job_id>", methods=["DELETE"])
@require_auth(perms=["converter.run"])
def remove_job(job_id: str):
    """Remove a conversion job from the history."""
    try:
        job = load_job(job_id)
    except JobNotFoundError:
        return jsonify({"deleted": True})
    except Exception:
        return _api_error("Failed to load job")

    if not (job.source is not None):
        raise AssertionError("invariant failed")
    ok, _ = check_cluster_access(job.source.cluster_id)
    if not ok:
        return _access_denied()

    if not _is_admin_or_owner(job):
        return jsonify({"error": "Permission denied"}), 403

    deleted = delete_job(job_id)
    return jsonify({"deleted": deleted})


@bp.route("/api/converter/jobs/clear", methods=["POST"])
@require_auth(perms=["converter.run"])
def clear_job_history():
    """Clear terminal conversion jobs, optionally filtered by cluster/status."""
    data = request.get_json(silent=True) or {}
    cluster_id = data.get("cluster_id") or request.args.get("cluster_id")
    status = data.get("status") or request.args.get("status")

    user = _current_user()
    created_by = None
    if user.get("role") != ROLE_ADMIN and not has_permission(user, "converter.admin"):
        created_by = _current_username()

    try:
        count = clear_jobs(
            cluster_id=cluster_id,
            status=status,
            created_by=created_by,
            older_than_hours=data.get("older_than_hours"),
        )
    except Exception:
        return _api_error("Failed to clear conversion job history")

    return jsonify({"deleted": count})


@bp.route("/api/converter/validate-target-id", methods=["POST"])
@require_auth(perms=["converter.run"])
def validate_target_id():
    """Check whether a target VM/CT ID is already in use on the requested node."""
    data = request.get_json(silent=True) or {}
    cluster_id = data.get("cluster_id")
    node = data.get("node")
    target_type = data.get("target_type")
    target_id = data.get("target_id")
    replace_target = bool(data.get("replace_target", False))

    if not cluster_id or not node:
        return jsonify({"error": "cluster_id and node are required"}), 400
    if target_type not in ("lxc", "vm"):
        return jsonify({"error": "target_type must be lxc or vm"}), 400
    try:
        target_id = int(target_id)
    except (TypeError, ValueError):
        return jsonify({"error": "target_id must be an integer"}), 400

    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    try:
        runner = get_runner(cluster_id, node)
    except Exception as exc:
        return jsonify({"available": False, "message": f"Could not connect to node: {exc}"}), 200

    target = WorkloadRef(cluster_id=cluster_id, node=node, type=WorkloadType(target_type), id=target_id)
    try:
        checks = _check_target_collision(runner, target, replace_target)
    except Exception as exc:
        return jsonify({"available": False, "message": f"Target check failed: {exc}"}), 200

    check = checks[0] if checks else None
    if check is None:
        return jsonify({"available": False, "message": "Unable to verify target ID"}), 200

    return jsonify({
        "available": check.passed,
        "message": check.message,
        "reason": check.reason,
        "fix": check.fix,
        "fix_commands": check.fix_commands,
    })


@bp.route("/api/converter/jobs/<job_id>/logs", methods=["GET"])
@require_auth(perms=["converter.view"])
def get_job_logs(job_id: str):
    """Return the recorded log tail for a job."""
    try:
        job = load_job(job_id)
    except JobNotFoundError:
        return jsonify({"error": "Job not found"}), 404
    except Exception:
        return _api_error("Failed to load job")

    if not (job.source is not None):
        raise AssertionError("invariant failed")
    ok, _ = check_cluster_access(job.source.cluster_id)
    if not ok:
        return _access_denied()

    lines = [line for line in (job.log_tail or "").splitlines() if line]
    try:
        offset = int(request.args.get("offset", 0))
        limit = int(request.args.get("limit", 100))
    except ValueError:
        return jsonify({"error": "offset and limit must be integers"}), 400

    total = len(lines)
    return jsonify({"lines": lines[offset : offset + limit], "total_lines": total})


@bp.route("/api/converter/preflight", methods=["POST"])
@require_auth(perms=["converter.run"])
def run_preflight_check():
    """Run pre-flight checks without modifying cluster state."""
    payload = request.get_json(silent=True) or {}
    cluster_id = payload.get("source_cluster_id")
    if not cluster_id:
        return jsonify({"error": "source_cluster_id is required"}), 400

    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    try:
        normalized = validate_job_payload(payload)
    except ValidationError as exc:
        return jsonify({"error": "Validation failed", "field": exc.field, "message": exc.message}), 400

    try:
        runner = get_runner(cluster_id, normalized["source_node"])
    except Exception:
        return _api_error("Could not connect to source node")

    try:
        report = run_preflight(
            job_id="",
            runner=runner,
            payload=normalized,
            dry_run=True,
        )
    except Exception:
        return _api_error("Pre-flight check failed")

    return _preflight_response(report)


@bp.route("/api/converter/fix-tools", methods=["POST"])
@require_auth(perms=["converter.run"])
def fix_missing_tools():
    """Install the packages required for the requested operation on the source node."""
    data = request.get_json(silent=True) or {}
    cluster_id = data.get("source_cluster_id")
    if not cluster_id:
        return jsonify({"error": "source_cluster_id is required"}), 400

    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return _access_denied()

    node = data.get("source_node")
    if not node:
        return jsonify({"error": "source_node is required"}), 400

    operation = data.get("operation", "")
    if operation not in _FIX_PACKAGES:
        return jsonify({"error": "Unsupported or missing operation"}), 400

    try:
        runner = get_runner(cluster_id, node)
    except Exception:
        return _api_error("Could not connect to source node")

    packages = _FIX_PACKAGES[operation]
    command = f"apt-get update && apt-get install -y {' '.join(packages)}"
    try:
        result = runner.run_with_status(command, timeout=180)
    except Exception:
        return _api_error("Failed to run package install")

    return jsonify({
        "ok": result.ok,
        "command": command,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "packages": packages,
    })


@bp.route("/api/converter/supported-os", methods=["GET"])
@require_auth(perms=["converter.view"])
def get_supported_os():
    """Return supported guest OS/distro lists."""
    return jsonify({
        "lxc_to_vm": sorted(SUPPORTED_LXC_TO_VM_DISTROS),
        "vm_to_lxc": sorted(SUPPORTED_VM_TO_LXC_DISTROS),
    })


# ---------------------------------------------------------------------------
# Presets
# ---------------------------------------------------------------------------


@bp.route("/api/converter/presets", methods=["GET"])
@require_auth(perms=["converter.view"])
def get_presets():
    """List saved conversion presets."""
    items = converter_db.list_presets()
    return jsonify({"items": items})


@bp.route("/api/converter/presets", methods=["POST"])
@require_auth(perms=["converter.admin"])
def create_preset():
    """Create a new conversion preset."""
    data = request.get_json(silent=True) or {}
    required = {"name", "operation"}
    missing = required - set(data)
    if missing:
        return jsonify({"error": "Missing fields", "fields": sorted(missing)}), 400
    try:
        preset_id = converter_db.create_preset({**data, "owner": _current_username()})
    except Exception:
        return _api_error("Failed to create preset")
    return jsonify({"id": preset_id}), 201


@bp.route("/api/converter/presets/<preset_id>", methods=["GET"])
@require_auth(perms=["converter.view"])
def get_preset(preset_id: str):
    """Get a single preset."""
    preset = converter_db.get_preset(preset_id)
    if not preset:
        return jsonify({"error": "Preset not found"}), 404
    return jsonify(preset)


@bp.route("/api/converter/presets/<preset_id>", methods=["PUT"])
@require_auth(perms=["converter.admin"])
def update_preset(preset_id: str):
    """Update a preset."""
    data = request.get_json(silent=True) or {}
    try:
        ok = converter_db.update_preset(preset_id, data)  # lgtm[py/sql-injection]
    except Exception:
        return _api_error("Failed to update preset")
    if not ok:
        return jsonify({"error": "Preset not found or nothing to update"}), 404
    return jsonify({"id": preset_id})


@bp.route("/api/converter/presets/<preset_id>", methods=["DELETE"])
@require_auth(perms=["converter.admin"])
def delete_preset(preset_id: str):
    """Delete a preset."""
    try:
        ok = converter_db.delete_preset(preset_id)
    except Exception:
        return _api_error("Failed to delete preset")
    if not ok:
        return jsonify({"error": "Preset not found"}), 404
    return jsonify({"deleted": True})


# ---------------------------------------------------------------------------
# Hooks
# ---------------------------------------------------------------------------


@bp.route("/api/converter/hooks", methods=["GET"])
@require_auth(perms=["converter.view"])
def get_hooks():
    """List configured conversion hooks."""
    items = converter_db.list_hooks()
    return jsonify({"items": items})


@bp.route("/api/converter/hooks", methods=["POST"])
@require_auth(perms=["converter.admin"])
def create_hook():
    """Create a new conversion hook."""
    data = request.get_json(silent=True) or {}
    required = {"name", "stage", "path"}
    missing = required - set(data)
    if missing:
        return jsonify({"error": "Missing fields", "fields": sorted(missing)}), 400
    try:
        hook_id = converter_db.create_hook(data)
    except Exception:
        return _api_error("Failed to create hook")
    return jsonify({"id": hook_id}), 201


@bp.route("/api/converter/hooks/<hook_id>", methods=["GET"])
@require_auth(perms=["converter.view"])
def get_hook(hook_id: str):
    """Get a single hook."""
    hook = converter_db.get_hook(hook_id)
    if not hook:
        return jsonify({"error": "Hook not found"}), 404
    return jsonify(hook)


@bp.route("/api/converter/hooks/<hook_id>", methods=["PUT"])
@require_auth(perms=["converter.admin"])
def update_hook(hook_id: str):
    """Update a hook."""
    data = request.get_json(silent=True) or {}
    try:
        ok = converter_db.update_hook(hook_id, data)  # lgtm[py/sql-injection]
    except Exception:
        return _api_error("Failed to update hook")
    if not ok:
        return jsonify({"error": "Hook not found or nothing to update"}), 404
    return jsonify({"id": hook_id})


@bp.route("/api/converter/hooks/<hook_id>", methods=["DELETE"])
@require_auth(perms=["converter.admin"])
def delete_hook(hook_id: str):
    """Delete a hook."""
    try:
        ok = converter_db.delete_hook(hook_id)
    except Exception:
        return _api_error("Failed to delete hook")
    if not ok:
        return jsonify({"error": "Hook not found"}), 404
    return jsonify({"deleted": True})
