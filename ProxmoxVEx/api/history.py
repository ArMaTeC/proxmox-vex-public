# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/api/history.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: migration history, affinity rules & scheduled tasks -...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""migration history, affinity rules & scheduled tasks - split from monolith dec 2025"""

import json
import logging
import os
import uuid
from datetime import datetime

from flask import Blueprint, jsonify, request

from ProxmoxVEx.api.helpers import check_cluster_access
from ProxmoxVEx.background.scheduler import (
    describe_cron,
    execute_scheduled_task,
    get_next_run,
    load_scheduled_tasks,
    save_scheduled_tasks,
    validate_cron,
)
from ProxmoxVEx.constants import AFFINITY_RULES_FILE, MIGRATION_HISTORY_FILE
from ProxmoxVEx.core.db import get_db
from ProxmoxVEx.globals import cluster_managers
from ProxmoxVEx.models.permissions import ROLE_ADMIN
from ProxmoxVEx.utils.audit import log_audit
from ProxmoxVEx.utils.auth import require_auth

bp = Blueprint("history", __name__)


@bp.route("/api/scheduled-tasks", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_scheduled_tasks():
    """Get all scheduled tasks scoped to the caller's reachable clusters"""
    config = load_scheduled_tasks()
    from flask import g as _g

    from ProxmoxVEx.utils.rbac import get_user_clusters

    _allowed = get_user_clusters(getattr(_g, "current_user", None) or {})
    if _allowed is not None:
        config = dict(config)
        config["tasks"] = [t for t in config.get("tasks", []) if t.get("cluster_id") in _allowed]

    for task in config.get("tasks", []):
        if task.get("schedule_cron"):
            task["schedule_human"] = describe_cron(task["schedule_cron"])
            if task.get("enabled"):
                task["next_run"] = get_next_run(task["schedule_cron"])

    return jsonify(config)


def _validate_task(data, existing_names=None):
    """Shared validation for scheduled task payloads"""
    errors = {}
    name = str(data.get("name", "")).strip()
    if not name:
        errors["name"] = "name is required"
    if existing_names is not None and name in existing_names:
        errors["name"] = "task name must be unique"

    cluster_id = str(data.get("cluster_id", "")).strip()
    if not cluster_id:
        errors["cluster_id"] = "target cluster is required"

    cron = str(data.get("schedule_cron", "")).strip()
    if not cron:
        errors["schedule_cron"] = "schedule is required"
    elif not validate_cron(cron):
        errors["schedule_cron"] = "invalid cron expression"

    return name, cluster_id, errors


@bp.route("/api/scheduled-tasks/validate-cron", methods=["POST"])
@require_auth(perms=["cluster.view"])
def validate_cron_endpoint():
    """Validate a cron expression and return a human-readable description"""
    data = request.json or {}
    cron = str(data.get("schedule_cron", "")).strip()
    if not cron:
        return jsonify({"valid": False, "error": "schedule is required"}), 400
    if not validate_cron(cron):
        return jsonify({"valid": False, "error": "invalid cron expression"}), 400
    return jsonify({
        "valid": True,
        "description": describe_cron(cron),
        "next_run": get_next_run(cron),
    })


@bp.route("/api/scheduled-tasks", methods=["POST"])
@require_auth(roles=[ROLE_ADMIN])
def create_scheduled_task():
    """Create a new scheduled task"""
    data = request.json or {}
    config = load_scheduled_tasks()
    existing_names = {t["name"] for t in config.get("tasks", [])}
    name, cluster_id, errors = _validate_task(data, existing_names)
    if errors:
        return jsonify({"error": errors}), 400

    new_task = {
        "id": str(uuid.uuid4())[:8],
        "name": name,
        "cluster_id": cluster_id,
        "target_type": data.get("target_type", "qemu"),
        "target_id": str(data.get("target_id", "")),
        "target_node": str(data.get("target_node", "")),
        "action": data.get("action", ""),
        "action_type": data.get("action_type", ""),
        "action_params": data.get("action_params", {}),
        "schedule_cron": str(data.get("schedule_cron", "")).strip(),
        "description": data.get("description", ""),
        "enabled": data.get("enabled", True),
        "retry_count": data.get("retry_count", 0),
        "retry_delay": data.get("retry_delay", 0),
        "timeout": data.get("timeout", 300),
        "notification": data.get("notification", "never"),
        "tags": data.get("tags", []),
        "last_run": None,
        "created": datetime.now().isoformat(),
    }
    if new_task["enabled"]:
        new_task["next_run"] = get_next_run(new_task["schedule_cron"])
        new_task["schedule_human"] = describe_cron(new_task["schedule_cron"])

    config["tasks"].append(new_task)
    save_scheduled_tasks(config)

    user = request.session.get("user", "unknown")
    log_audit(user, "scheduled_task.created", f"Created scheduled task: {new_task['name']}")

    return jsonify(new_task), 201


@bp.route("/api/scheduled-tasks/<task_id>", methods=["PUT"])
@require_auth(roles=[ROLE_ADMIN])
def update_scheduled_task(task_id):
    """Update a scheduled task"""
    data = request.json or {}
    config = load_scheduled_tasks()

    task = None
    for t in config["tasks"]:
        if t["id"] == task_id:
            task = t
            break
    if task is None:
        return jsonify({"error": "Task not found"}), 404

    existing_names = {t["name"] for t in config.get("tasks", []) if t["id"] != task_id}
    name, cluster_id, errors = _validate_task(data, existing_names)
    if errors:
        return jsonify({"error": errors}), 400

    updates = {
        "name": name,
        "cluster_id": cluster_id,
        "target_type": data.get("target_type", task.get("target_type", "qemu")),
        "target_id": str(data.get("target_id", task.get("target_id", ""))),
        "target_node": str(data.get("target_node", task.get("target_node", ""))),
        "action": data.get("action", task.get("action", "")),
        "action_type": data.get("action_type", task.get("action_type", "")),
        "action_params": data.get("action_params", task.get("action_params", {})),
        "schedule_cron": str(data.get("schedule_cron", task.get("schedule_cron", ""))).strip(),
        "description": data.get("description", task.get("description", "")),
        "enabled": data.get("enabled", task.get("enabled", True)),
        "retry_count": data.get("retry_count", task.get("retry_count", 0)),
        "retry_delay": data.get("retry_delay", task.get("retry_delay", 0)),
        "timeout": data.get("timeout", task.get("timeout", 300)),
        "notification": data.get("notification", task.get("notification", "never")),
        "tags": data.get("tags", task.get("tags", [])),
        "updated": datetime.now().isoformat(),
    }
    updates["next_run"] = get_next_run(updates["schedule_cron"]) if updates["enabled"] else None
    updates["schedule_human"] = describe_cron(updates["schedule_cron"])

    task.update(updates)
    save_scheduled_tasks(config)

    user = request.session.get("user", "unknown")
    log_audit(user, "scheduled_task.updated", f"Updated scheduled task: {task['name']}")

    return jsonify(task)


@bp.route("/api/scheduled-tasks/<task_id>", methods=["DELETE"])
@require_auth(roles=[ROLE_ADMIN])
def delete_scheduled_task(task_id):
    """Delete a scheduled task"""
    config = load_scheduled_tasks()
    config["tasks"] = [t for t in config["tasks"] if t["id"] != task_id]
    save_scheduled_tasks(config)

    user = request.session.get("user", "unknown")
    log_audit(user, "scheduled_task.deleted", f"Deleted scheduled task: {task_id}")

    return jsonify({"success": True})


@bp.route("/api/scheduled-tasks/<task_id>/run", methods=["POST"])
@require_auth(roles=[ROLE_ADMIN])
def run_scheduled_task_now(task_id):
    """Run a scheduled task immediately"""
    config = load_scheduled_tasks()

    for task in config["tasks"]:
        if task["id"] == task_id:
            # snyk:ignore:Server-Side Request Forgery (SSRF)
            # snyk:ignore:Command Injection
            # lgtm[py/ssrf]
            # lgtm[py/command-line-injection]
            execute_scheduled_task(task)
            task["last_run"] = datetime.now().isoformat()
            task["next_run"] = get_next_run(task.get("schedule_cron", ""))
            save_scheduled_tasks(config)
            return jsonify({"success": True, "message": f"Task '{task['name']}' executed"})

    return jsonify({"error": "Task not found"}), 404


@bp.route("/api/scheduled-tasks/<task_id>/dry-run", methods=["POST"])
@require_auth(roles=[ROLE_ADMIN])
def dry_run_scheduled_task(task_id):
    """Run a scheduled task in dry-run mode"""
    config = load_scheduled_tasks()

    for task in config["tasks"]:
        if task["id"] == task_id:
            # snyk:ignore:Server-Side Request Forgery (SSRF)
            # snyk:ignore:Command Injection
            # lgtm[py/ssrf]
            # lgtm[py/command-line-injection]
            execute_scheduled_task(task, dry_run=True)
            return jsonify({"success": True, "message": f"Dry run for '{task['name']}' completed"})

    return jsonify({"error": "Task not found"}), 404


@bp.route("/api/scheduled-tasks/<task_id>/clone", methods=["POST"])
@require_auth(roles=[ROLE_ADMIN])
def clone_scheduled_task(task_id):
    """Clone an existing scheduled task"""
    config = load_scheduled_tasks()
    for task in config["tasks"]:
        if task["id"] == task_id:
            existing_names = {t["name"] for t in config.get("tasks", [])}
            new_name = task["name"]
            candidate = f"{new_name} (copy)"
            n = 2
            while candidate in existing_names:
                candidate = f"{new_name} (copy {n})"
                n += 1
            cloned = dict(task)
            cloned["id"] = str(uuid.uuid4())[:8]
            cloned["name"] = candidate
            cloned["enabled"] = False
            cloned["last_run"] = None
            cloned["next_run"] = get_next_run(cloned.get("schedule_cron", "")) if cloned.get("enabled") else None
            cloned["created"] = datetime.now().isoformat()
            cloned.pop("updated", None)
            config["tasks"].append(cloned)
            save_scheduled_tasks(config)

            user = request.session.get("user", "unknown")
            log_audit(user, "scheduled_task.cloned", f"Cloned scheduled task: {cloned['name']}")

            return jsonify(cloned), 201

    return jsonify({"error": "Task not found"}), 404


@bp.route("/api/scheduled-tasks/<task_id>/duplicate", methods=["POST"])
@require_auth(roles=[ROLE_ADMIN])
def duplicate_scheduled_task(task_id):
    """Duplicate a scheduled task to another cluster"""
    data = request.json or {}
    target_cluster_id = str(data.get("target_cluster_id", "")).strip()
    if not target_cluster_id:
        return jsonify({"error": "target_cluster_id is required"}), 400
    ok, _ = check_cluster_access(target_cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403

    config = load_scheduled_tasks()
    for task in config["tasks"]:
        if task["id"] == task_id:
            existing_names = {t["name"] for t in config.get("tasks", [])}
            candidate = f"{task['name']} ({target_cluster_id})"
            n = 2
            while candidate in existing_names:
                candidate = f"{task['name']} ({target_cluster_id}) {n}"
                n += 1
            duplicated = dict(task)
            duplicated["id"] = str(uuid.uuid4())[:8]
            duplicated["name"] = candidate
            duplicated["cluster_id"] = target_cluster_id
            duplicated["target_id"] = ""
            duplicated["target_node"] = ""
            duplicated["enabled"] = False
            duplicated["last_run"] = None
            duplicated["next_run"] = (
                get_next_run(duplicated.get("schedule_cron", "")) if duplicated.get("enabled") else None
            )
            duplicated["created"] = datetime.now().isoformat()
            duplicated.pop("updated", None)
            config["tasks"].append(duplicated)
            save_scheduled_tasks(config)

            user = request.session.get("user", "unknown")
            log_audit(
                user,
                "scheduled_task.duplicated",
                f"Duplicated scheduled task to cluster {target_cluster_id}: {duplicated['name']}",
            )

            return jsonify(duplicated), 201

    return jsonify({"error": "Task not found"}), 404


@bp.route("/api/scheduled-tasks/<task_id>/runs", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_scheduled_task_runs(task_id):
    """Get run history for a scheduled task"""
    try:
        db = get_db()
        cursor = db.conn.cursor()
        cursor.execute(
            "SELECT * FROM scheduled_task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1000",
            (task_id,),
        )
        runs = []
        for row in cursor.fetchall():
            runs.append({
                "run_id": row["run_id"],
                "task_id": row["task_id"],
                "started_at": row["started_at"],
                "ended_at": row["ended_at"],
                "duration": row["duration"],
                "status": row["status"],
                "output": row["output"],
                "error": row["error"],
            })
        return jsonify({"runs": runs})
    except Exception as e:
        logging.error(f"Error loading scheduled task runs: {e}")
        return jsonify({"error": "Failed to load run history"}), 500


# =====================================================
# MIGRATION HISTORY - Dec 2025
# SQLite version
# =====================================================


def load_migration_history():
    """Load migration history from SQLite database

    SQLite migration
    """
    try:
        db = get_db()
        cursor = db.conn.cursor()
        cursor.execute("SELECT * FROM migration_history ORDER BY timestamp DESC LIMIT 1000")

        migrations = []
        for row in cursor.fetchall():
            migrations.append({
                "id": row["id"],
                "cluster_id": row["cluster_id"],
                "vmid": row["vmid"],
                "vm_name": row["vm_name"],
                "source_node": row["source_node"],
                "target_node": row["target_node"],
                "reason": row["reason"],
                "status": row["status"],
                "duration": row["duration_seconds"],
                "timestamp": row["timestamp"],
            })

        return {"migrations": migrations}
    except Exception as e:
        logging.error(f"Error loading migration history from database: {e}")
        # Legacy fallback
        if os.path.exists(MIGRATION_HISTORY_FILE):
            try:
                with open(MIGRATION_HISTORY_FILE) as f:
                    return json.load(f)
            except Exception:
                pass
    return {"migrations": []}


def save_migration_history(config):
    """Save migration history - now handled per-entry via log_migration()

    saves directly to db
    This function is kept for backwards compatibility
    """
    # In SQLite version, saving is handled per-entry in log_migration()
    pass


def log_migration(
    cluster_id: str,
    vmid: int,
    vm_name: str,
    vm_type: str,
    source_node: str,
    target_node: str,
    migration_type: str,
    status: str,
    user: str = "system",
    duration: float = 0,
):
    """Log a VM migration event to SQLite database

    Called from migrate_vm and HA failover functions
    writes to db now
    """
    try:
        db = get_db()
        cursor = db.conn.cursor()

        cursor.execute(
            """
            INSERT INTO migration_history
            (cluster_id, vmid, vm_name, source_node, target_node,
             reason, status, duration_seconds, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                cluster_id,
                vmid,
                vm_name,
                source_node,
                target_node,
                f"{migration_type} by {user}",
                status,
                duration,
                datetime.now().isoformat(),
            ),
        )

        db.conn.commit()

        # Cleanup old entries (keep last 1000)
        cursor.execute("""
            DELETE FROM migration_history
            WHERE id NOT IN (
                SELECT id FROM migration_history
                ORDER BY timestamp DESC LIMIT 1000
            )
        """)
        db.conn.commit()

    except Exception as e:
        logging.error(f"Error logging migration: {e}")

    return {
        "cluster_id": cluster_id,
        "vmid": vmid,
        "vm_name": vm_name,
        "source_node": source_node,
        "target_node": target_node,
        "migration_type": migration_type,
        "status": status,
        "user": user,
        "duration": duration,
        "timestamp": datetime.now().isoformat(),
    }


@bp.route("/api/migration-history", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_migration_history():
    """Get migration history"""
    config = load_migration_history()

    # Optional filters
    cluster_id = request.args.get("cluster_id")
    vmid = request.args.get("vmid")
    limit = int(request.args.get("limit", 100))

    migrations = config.get("migrations", [])

    if cluster_id:
        migrations = [m for m in migrations if m.get("cluster_id") == cluster_id]
    if vmid:
        migrations = [m for m in migrations if str(m.get("vmid")) == str(vmid)]

    # (CodeAnt IDOR) - scope the global migration log to the caller's clusters.
    from flask import g as _g

    from ProxmoxVEx.utils.rbac import get_user_clusters

    _allowed = get_user_clusters(getattr(_g, "current_user", None) or {})
    if _allowed is not None:
        migrations = [m for m in migrations if m.get("cluster_id") in _allowed]

    return jsonify(migrations[:limit])


@bp.route("/api/clusters/<cluster_id>/vms/<int:vmid>/migration-history", methods=["GET"])
@require_auth(perms=["vm.view"])
def get_vm_migration_history(cluster_id, vmid):
    """Get migration history for a specific VM"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403

    config = load_migration_history()

    migrations = [
        m for m in config.get("migrations", []) if m.get("cluster_id") == cluster_id and m.get("vmid") == vmid
    ]

    return jsonify(migrations)


# =====================================================
# AFFINITY RULES - keeps VMs together or apart
# =====================================================


def load_affinity_rules():
    """Load affinity rules from SQLite database

    SQLite migration
    """
    try:
        db = get_db()
        rules_by_cluster = db.get_affinity_rules()

        # Convert to flat list format
        all_rules = []
        for cluster_id, rules in rules_by_cluster.items():
            for rule in rules:
                rule["cluster_id"] = cluster_id
                all_rules.append(rule)

        return {"rules": all_rules}
    except Exception as e:
        logging.error(f"Error loading affinity rules: {e}")
        # Legacy fallback
        if os.path.exists(AFFINITY_RULES_FILE):
            try:
                with open(AFFINITY_RULES_FILE) as f:
                    return json.load(f)
            except Exception:
                pass
    return {"rules": []}


def save_affinity_rules(config):
    """Save affinity rules to SQLite database

    SQLite migration
    """
    try:
        db = get_db()

        # Group rules by cluster_id
        rules_by_cluster = {}
        for rule in config.get("rules", []):
            cluster_id = rule.get("cluster_id", "default")
            if cluster_id not in rules_by_cluster:
                rules_by_cluster[cluster_id] = []
            rules_by_cluster[cluster_id].append(rule)

        db.save_all_affinity_rules(rules_by_cluster)
        return True
    except Exception as e:
        logging.error(f"Error saving affinity rules: {e}")
        return False


def check_affinity_violation(cluster_id: str, vmid: int, target_node: str) -> dict:
    """Check if moving a VM/CT to a node would violate affinity rules

    Returns enforce flag so callers can block or just warn.
    Works for both QEMU and LXC now (Issue #73).
    """
    config = load_affinity_rules()

    if cluster_id not in cluster_managers:
        return {"violation": False}

    manager = cluster_managers[cluster_id]
    resources = manager.get_vm_resources()

    # Build map of VM -> current node
    vm_nodes = {}
    for res in resources:
        if res.get("type") in ["qemu", "lxc"]:
            vm_nodes[str(res.get("vmid"))] = res.get("node")

    for rule in config.get("rules", []):
        if rule.get("cluster_id") != cluster_id or not rule.get("enabled", True):
            continue

        rule_type = rule.get("type", "together")  # together, separate
        # Database stores as 'vms', frontend sends 'vm_ids' - was always reading empty list before
        vm_ids = [str(v) for v in (rule.get("vm_ids") or rule.get("vms", []))]

        if str(vmid) not in vm_ids:
            continue

        # Get nodes of other VMs/CTs in this rule
        other_nodes = set()
        for vid in vm_ids:
            if vid != str(vmid) and vid in vm_nodes:
                other_nodes.add(vm_nodes[vid])

        if rule_type == "together":
            # All VMs/CTs should be on same node
            if other_nodes and target_node not in other_nodes:
                return {
                    "violation": True,
                    "enforce": rule.get("enforce", False),
                    "rule": rule.get("name", "Affinity Rule"),
                    "message": f"VM/CT must stay with IDs {', '.join([v for v in vm_ids if v != str(vmid)])} on node {list(other_nodes)[0]}",
                }

        elif rule_type == "separate" and target_node in other_nodes:
            # VMs/CTs should be on different nodes
            return {
                "violation": True,
                "enforce": rule.get("enforce", False),
                "rule": rule.get("name", "Anti-Affinity Rule"),
                "message": f"VM/CT must not be on the same node as IDs {', '.join([v for v in vm_ids if v != str(vmid) and vm_nodes.get(v) == target_node])}",
            }

    return {"violation": False}


@bp.route("/api/affinity-rules", methods=["GET"])
@bp.route("/api/clusters/<cluster_id>/affinity-rules", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_affinity_rules(cluster_id=None):
    """Get affinity rules, optionally filtered by cluster"""
    config = load_affinity_rules()
    if cluster_id:
        # (CodeAnt IDOR) - path-scoped alias: enforce cluster access.
        ok, _ = check_cluster_access(cluster_id)
        if not ok:
            return jsonify({"error": "Access denied to this cluster"}), 403
        config["rules"] = [r for r in config["rules"] if r.get("cluster_id") == cluster_id]
    else:
        # (CodeAnt IDOR) - scope the unfiltered list to reachable clusters.
        from flask import g as _g

        from ProxmoxVEx.utils.rbac import get_user_clusters

        _allowed = get_user_clusters(getattr(_g, "current_user", None) or {})
        if _allowed is not None:
            config = dict(config)
            config["rules"] = [r for r in config.get("rules", []) if r.get("cluster_id") in _allowed]
    return jsonify(config)


@bp.route("/api/affinity-rules", methods=["POST"])
@bp.route("/api/clusters/<cluster_id>/affinity-rules", methods=["POST"])
@require_auth(roles=[ROLE_ADMIN])
def create_affinity_rule(cluster_id=None):
    """Create a new affinity rule"""
    data = request.json or {}
    config = load_affinity_rules()

    import uuid

    # Frontend sends vm_ids, database column is vms - accept both
    vms_data = data.get("vm_ids") or data.get("vms", [])
    # Cluster_id from URL takes priority over body
    rule_cluster_id = cluster_id or data.get("cluster_id", "")
    new_rule = {
        "id": str(uuid.uuid4())[:8],
        "name": data.get("name", "New Rule"),
        "cluster_id": rule_cluster_id,
        "type": data.get("type", "together"),  # together, separate
        "vms": vms_data,
        "vm_ids": vms_data,  # keep both so frontend doesn't break
        "enabled": data.get("enabled", True),
        "enforce": data.get("enforce", False),
        "created": datetime.now().isoformat(),
    }

    config["rules"].append(new_rule)
    save_affinity_rules(config)

    user = request.session.get("user", "unknown")
    log_audit(user, "affinity_rule.created", f"Created affinity rule: {new_rule['name']}")

    return jsonify(new_rule), 201


@bp.route("/api/affinity-rules/<rule_id>", methods=["PUT"])
@bp.route("/api/clusters/<cluster_id>/affinity-rules/<rule_id>", methods=["PUT"])
@require_auth(roles=[ROLE_ADMIN])
def update_affinity_rule(rule_id, cluster_id=None):
    """Update an affinity rule"""
    data = request.json or {}
    config = load_affinity_rules()

    for rule in config["rules"]:
        if rule["id"] == rule_id:
            # Try every possible source for the vm list
            vms_data = data.get("vm_ids") or data.get("vms") or rule.get("vms") or rule.get("vm_ids", [])
            rule.update({
                "name": data.get("name", rule["name"]),
                "cluster_id": cluster_id or data.get("cluster_id", rule.get("cluster_id", "")),
                "type": data.get("type", rule["type"]),
                "vms": vms_data,
                "vm_ids": vms_data,
                "enabled": data.get("enabled", rule["enabled"]),
                "enforce": data.get("enforce", rule.get("enforce", False)),
            })
            save_affinity_rules(config)
            return jsonify(rule)

    return jsonify({"error": "Rule not found"}), 404


@bp.route("/api/affinity-rules/<rule_id>", methods=["DELETE"])
@bp.route("/api/clusters/<cluster_id>/affinity-rules/<rule_id>", methods=["DELETE"])
@require_auth(roles=[ROLE_ADMIN])
def delete_affinity_rule(rule_id, cluster_id=None):
    """Delete an affinity rule"""
    config = load_affinity_rules()
    config["rules"] = [r for r in config["rules"] if r["id"] != rule_id]
    save_affinity_rules(config)

    user = request.session.get("user", "unknown")
    log_audit(user, "affinity_rule.deleted", f"Deleted affinity rule: {rule_id}")

    return jsonify({"success": True})


@bp.route("/api/clusters/<cluster_id>/vms/<int:vmid>/check-affinity/<target_node>", methods=["GET"])
@require_auth(perms=["vm.view"])
def check_vm_affinity(cluster_id, vmid, target_node):
    """Check if moving VM to target node would violate affinity rules"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403

    result = check_affinity_violation(cluster_id, vmid, target_node)
    return jsonify(result)
