# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/background/scheduler.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: ProxmoxVEx Task Scheduler - Layer 7
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
ProxmoxVEx Task Scheduler - Layer 7
Background scheduled task execution.
"""

import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timedelta

from ProxmoxVEx.constants import SCHEDULED_TASKS_FILE
from ProxmoxVEx.core.db import get_db
from ProxmoxVEx.globals import cluster_managers
from ProxmoxVEx.utils.audit import log_audit
from ProxmoxVEx.utils.sanitization import sanitize_log_message as _sl  # CWE-117 tainted-log sanitiser


def _pack_schedule(task):
    """Return the schedule fields as a JSON-serialisable dict."""
    return {
        "schedule_type": task.get("schedule_type", "daily"),
        "schedule_time": task.get("schedule_time", "02:00"),
        "schedule_day": task.get("schedule_day", 0),
        "schedule_cron": task.get("schedule_cron", ""),
    }


def _valid_cron_part(part, lo, hi):
    for sub in part.split(","):
        sub = sub.strip()
        if not sub:
            return False
        step = 1
        base = sub
        if "/" in sub:
            base, _, step_s = sub.partition("/")
            try:
                step = int(step_s)
            except ValueError:
                return False
            if step <= 0:
                return False
        if "-" in base:
            a, _, b = base.partition("-")
            try:
                a = int(a)
                b = int(b)
            except ValueError:
                return False
            if a < lo or b > hi or a > b:
                return False
        elif base != "*":
            try:
                v = int(base)
            except ValueError:
                return False
            if v < lo or v > hi:
                return False
    return True


def _validate_cron_basic(cron_expr):
    parts = str(cron_expr).split()
    if len(parts) != 5:
        return False
    ranges = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 7)]
    return all(_valid_cron_part(part, lo, hi) for part, (lo, hi) in zip(parts, ranges))


def validate_cron(cron_expr):
    """Return True if cron_expr is a valid standard cron expression."""
    if not cron_expr:
        return False
    try:
        from croniter import croniter

        croniter(cron_expr)
        return True
    except ImportError:
        return _validate_cron_basic(cron_expr)
    except Exception:
        return False


def get_next_run(cron_expr, after=None):
    """Compute the next run time (ISO 8601) for a cron expression."""
    if not cron_expr:
        return None
    try:
        from croniter import croniter

        return croniter(cron_expr, after or datetime.now()).get_next(datetime).isoformat()
    except Exception:
        return None


def describe_cron(cron_expr):
    """Return a human-readable description of a cron expression."""
    if not cron_expr:
        return ""
    try:
        from cron_descriptor import get_description

        return get_description(cron_expr)
    except Exception:
        return cron_expr


# This was buried somewhere around line 40k in the monolith, nobody could find it
def load_scheduled_tasks():
    """Load scheduled tasks from SQLite database

    SQLite migration
    """
    try:
        db = get_db()
        cursor = db.conn.cursor()
        cursor.execute("SELECT * FROM scheduled_tasks")

        tasks = []
        for row in cursor.fetchall():
            try:
                schedule = json.loads(row["schedule"] or "{}")
            except json.JSONDecodeError:
                schedule = {}
            config = json.loads(row["config"] or "{}")
            task = {
                "id": row["id"],
                "cluster_id": row["cluster_id"],
                "name": row["name"],
                "task_type": row["task_type"],
                "enabled": bool(row["enabled"]),
                "last_run": row["last_run"],
                "next_run": row["next_run"],
            }
            task.update(schedule)
            task.update(config)
            tasks.append(task)

        return {"tasks": tasks}
    except Exception as e:
        logging.error(f"Error loading scheduled tasks from database: {e}")
        # Legacy fallback
        if os.path.exists(SCHEDULED_TASKS_FILE):
            try:
                with open(SCHEDULED_TASKS_FILE) as f:
                    return json.load(f)
            except Exception:
                pass
    return {"tasks": []}


def save_scheduled_tasks(config):
    """Save scheduled tasks to SQLite database

    SQLite migration
    """
    try:
        db = get_db()
        cursor = db.conn.cursor()
        now = datetime.now().isoformat()

        # Clear existing tasks (simple approach)
        cursor.execute("DELETE FROM scheduled_tasks")

        for task in config.get("tasks", []):
            task_id = task.get("id") or str(uuid.uuid4())[:8]
            schedule = _pack_schedule(task)
            # Fields that are not stored in the fixed columns go into config JSON
            reserved = {
                "id",
                "cluster_id",
                "name",
                "task_type",
                "enabled",
                "last_run",
                "next_run",
                "created_at",
            }
            task_config = {k: v for k, v in task.items() if k not in reserved and k not in schedule}

            # Re-compute next run for enabled cron tasks
            next_run = task.get("next_run")
            if task.get("enabled") and not next_run and task.get("schedule_cron"):
                next_run = get_next_run(task["schedule_cron"])

            cursor.execute(
                """
                INSERT INTO scheduled_tasks
                (id, cluster_id, name, task_type, schedule, config,
                 enabled, last_run, next_run, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    task_id,
                    task.get("cluster_id", ""),
                    task.get("name", ""),
                    task.get("task_type", task.get("action", "")),
                    json.dumps(schedule),
                    json.dumps(task_config),
                    1 if task.get("enabled", True) else 0,
                    task.get("last_run"),
                    next_run,
                    now,
                ),
            )

        db.conn.commit()
        return True
    except Exception as e:
        logging.error(f"Error saving scheduled tasks: {e}")
        return False


def run_scheduled_tasks():
    """Check and execute due scheduled tasks

    Runs every minute, checks if any tasks are due
    Supported actions: start, stop, restart, snapshot, backup
    """
    config = load_scheduled_tasks()
    current_time = datetime.now()

    for task in config.get("tasks", []):
        if not task.get("enabled", True):
            continue

        last_run = task.get("last_run")
        should_run = False

        # Prefer cron expressions if present
        if task.get("schedule_cron"):
            if not validate_cron(task["schedule_cron"]):
                logging.warning(f"Invalid cron expression for task {task.get('id')}: {task['schedule_cron']}")
                continue
            base = datetime.fromisoformat(last_run) if last_run else current_time - timedelta(minutes=1)
            next_due_iso = get_next_run(task["schedule_cron"], base)
            if next_due_iso is None:
                logging.error(f"Could not compute next run for task {task.get('id')}: {task['schedule_cron']}")
                continue
            next_due = datetime.fromisoformat(next_due_iso)
            # Allow a one-minute window around the due time to avoid duplicates
            if next_due <= current_time and (
                not last_run or (current_time - datetime.fromisoformat(last_run)).total_seconds() > 60
            ):
                should_run = True
        else:
            # Legacy schedule_* support
            schedule_type = task.get("schedule_type", "daily")
            schedule_time = task.get("schedule_time", "02:00")
            schedule_day = task.get("schedule_day", 0)

            try:
                hour, minute = map(int, schedule_time.split(":"))

                if schedule_type == "hourly":
                    if current_time.minute == minute and (
                        not last_run or (datetime.fromisoformat(last_run) + timedelta(hours=1)) <= current_time
                    ):
                        should_run = True

                elif schedule_type == "daily":
                    if (
                        current_time.hour == hour
                        and current_time.minute == minute
                        and (not last_run or datetime.fromisoformat(last_run).date() < current_time.date())
                    ):
                        should_run = True

                elif schedule_type == "weekly":
                    if (
                        current_time.weekday() == schedule_day
                        and current_time.hour == hour
                        and current_time.minute == minute
                    ) and (not last_run or (datetime.fromisoformat(last_run) + timedelta(days=7)) <= current_time):
                        should_run = True

                elif schedule_type == "monthly" and (
                    current_time.day == schedule_day
                    and current_time.hour == hour
                    and current_time.minute == minute
                    and (not last_run or datetime.fromisoformat(last_run).month != current_time.month)
                ):
                    should_run = True

            except Exception as e:
                logging.error(f"Error parsing legacy schedule for task {task.get('id')}: {e}")
                continue

        if should_run:
            execute_scheduled_task(task)
            task["last_run"] = current_time.isoformat()
            save_scheduled_tasks(config)


def _log_run(run_id, task_id, started, ended, status, output=None, error=None):
    """Persist a scheduled task run to SQLite"""
    try:
        db = get_db()
        cursor = db.conn.cursor()
        duration = (ended - started).total_seconds() if ended and started else 0
        cursor.execute(
            """
            INSERT INTO scheduled_task_runs
            (run_id, task_id, started_at, ended_at, duration, status, output, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                run_id,
                task_id,
                started.isoformat() if started else None,
                ended.isoformat() if ended else None,
                duration,
                status,
                output or "",
                error or "",
            ),
        )
        db.conn.commit()
    except Exception as e:
        logging.error(f"Error logging scheduled task run: {e}")


def execute_scheduled_task(task, dry_run=False):
    """Execute a scheduled task and log the run"""
    run_id = str(uuid.uuid4())[:8]
    started = datetime.now()
    status = "success"
    error = None

    cluster_id = task.get("cluster_id", "")
    action = task.get("action", "")
    target_type = task.get("target_type", "vm")
    target_id = task.get("target_id", "")
    target_node = task.get("target_node", "")

    if cluster_id not in cluster_managers:
        error = f"Cluster {cluster_id} not found"
        logging.error(f"Scheduled task failed: {error}")
        _log_run(run_id, task.get("id"), started, datetime.now(), "failed", error=error)
        return

    manager = cluster_managers[cluster_id]
    logging.info(f"Executing scheduled task: {_sl(task.get('name'))} - {action} on {target_type}/{target_id}")

    if dry_run:
        _log_run(run_id, task.get("id"), started, datetime.now(), "dry_run")
        log_audit(
            "scheduler",
            "scheduled_task.dry_run",
            f"Dry-run task '{task.get('name')}': {action} on {target_type}/{target_id}",
        )
        return

    try:
        if action == "start":
            manager.start_vm(target_node, int(target_id), target_type)
        elif action == "stop":
            manager.stop_vm(target_node, int(target_id), target_type)
        elif action == "restart":
            manager.restart_vm(target_node, int(target_id), target_type)
        elif action == "shutdown":
            manager.shutdown_vm(target_node, int(target_id), target_type)
        elif action == "snapshot":
            snap_name = f"scheduled_{datetime.now().strftime('%Y%m%d_%H%M')}"
            manager.create_snapshot(target_node, int(target_id), target_type, snap_name, "Scheduled snapshot", False)
        elif action == "backup":
            # Trigger backup job
            storage = task.get("backup_storage", "local")
            manager.backup_vm(target_node, int(target_id), target_type, storage)
        elif action == "plugin_route":
            # Future: dispatch to plugin route endpoint
            pass
        elif action == "webhook":
            import requests

            url = task.get("action_params", {}).get("url", "")
            if not url:
                raise ValueError("webhook URL is required")
            requests.post(url, timeout=task.get("timeout", 30))  # nosec: B113 - timeout always provided with fallback
        elif action == "shell_command":
            import shlex
            import subprocess

            cmd = task.get("action_params", {}).get("command", "")
            if not cmd:
                raise ValueError("shell command is required")
            cmd_list = shlex.split(cmd)
            subprocess.run(cmd_list, shell=False, timeout=task.get("timeout", 300), check=True)
        elif action == "converter":
            from ProxmoxVEx.converter.engine import get_engine
            from ProxmoxVEx.converter.validators import validate_job_payload

            config = task.get("config", {})
            payload = {
                "operation": config.get("operation"),
                "source_cluster_id": cluster_id,
                "source_node": target_node,
                "source_type": config.get("source_type", target_type),
                "source_id": config.get("source_id", target_id),
                "target_cluster_id": config.get("target_cluster_id", cluster_id),
                "target_node": config.get("target_node", target_node),
                "target_type": config.get("target_type"),
                "target_id": config.get("target_id"),
                "target_storage": config.get("target_storage"),
                "target_disk_size_gb": config.get("target_disk_size_gb"),
                "target_disk_format": config.get("target_disk_format"),
                "target_bridge": config.get("target_bridge"),
                "target_bios": config.get("target_bios"),
                "dry_run": config.get("dry_run", False),
                "replace_target": config.get("replace_target", False),
                "snapshot_source": config.get("snapshot_source", False),
                "rollback_on_failure": config.get("rollback_on_failure", True),
                "destroy_source": config.get("destroy_source", False),
                "headroom_gb": config.get("headroom_gb", 1),
                "preserve_network": config.get("preserve_network", False),
                "auto_start": config.get("auto_start", False),
            }
            normalized = validate_job_payload(payload)
            engine = get_engine()
            engine.submit_job(normalized, "scheduler")

        log_audit(
            "scheduler",
            "scheduled_task.executed",
            f"Task '{task.get('name')}' executed: {action} on {target_type}/{target_id}",
        )

    except Exception as e:
        status = "failed"
        error = str(e)
        logging.error(f"Scheduled task failed: {e}")
        log_audit("scheduler", "scheduled_task.failed", f"Task '{task.get('name')}' failed: {e}")

    _log_run(run_id, task.get("id"), started, datetime.now(), status, error=error)


# Scheduler thread
_scheduler_thread = None
_scheduler_running = False


def scheduler_loop():
    """Background thread that runs scheduled tasks"""
    global _scheduler_running
    _scheduler_running = True

    while _scheduler_running:
        try:
            run_scheduled_tasks()
        except Exception as e:
            logging.error(f"Scheduler error: {e}")

        # Check every 60 seconds (was 30 but that caused duplicate executions when tasks
        # took longer than the interval - we lost 4h debugging that one)
        time.sleep(60)


def start_scheduler_thread():
    global _scheduler_thread
    if _scheduler_thread is None or not _scheduler_thread.is_alive():
        _scheduler_thread = threading.Thread(target=scheduler_loop, daemon=True)
        _scheduler_thread.start()
        logging.info("Task scheduler thread started")
