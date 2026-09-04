# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-update-manager/engine.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Engine PY source
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
import contextlib
import json
import logging
import queue
import threading
import time
from datetime import datetime, timedelta, timezone

from . import db, utils
from .drivers.base import PackageUpdate
from .drivers.ssh_driver import SSHDriver
from .drivers.windows_driver import WindowsDriver

SCHEDULER_TICK = 60
MAX_WORKERS = 4

_job_queue = queue.Queue()
_scheduler_thread = None
_worker_threads = []


def _now():
    return datetime.now(timezone.utc).isoformat()


def _next_run(cron_expr, after=None):
    """Return the next scheduled datetime after `after` for a cron expression."""
    if after is None:
        after = datetime.now(timezone.utc)
    try:
        from croniter import croniter

        return croniter(cron_expr, after).get_next(datetime)
    except Exception:
        pass
    return _simple_next_run(cron_expr, after)


def _simple_next_run(expr, after):
    """Fallback for `daily@HH:MM` and `hourly@MM` style strings."""
    expr = expr.strip().lower()
    if expr.startswith("daily@"):
        time_part = expr.split("@", 1)[1]
        try:
            h, m = map(int, time_part.split(":"))
            target = after.replace(hour=h, minute=m, second=0, microsecond=0)
            if target <= after:
                target += timedelta(days=1)
            return target
        except Exception:
            pass
    if expr.startswith("hourly@"):
        try:
            m = int(expr.split("@", 1)[1])
            target = after.replace(minute=m, second=0, microsecond=0)
            if target <= after:
                target += timedelta(hours=1)
            return target
        except Exception:
            pass
    return None


def _is_due(policy):
    now = datetime.now(timezone.utc)
    last = db.get_last_check(policy.guest_id)
    after = datetime.fromisoformat(last) if last else now
    next_run = _next_run(policy.schedule_cron, after)
    if next_run is None or next_run > now:
        return False
    recent = db.list_jobs(policy.guest_id, limit=1, offset=0)
    return not (recent and recent[0].job_type in ("check", "apply") and recent[0].status in ("pending", "running"))


def start_scheduler():
    """Start the scheduler and worker threads if not already running."""
    global _scheduler_thread
    if _scheduler_thread is not None and _scheduler_thread.is_alive():
        return
    _scheduler_thread = threading.Thread(target=_scheduler_loop, daemon=True, name="vm-update-scheduler")
    _scheduler_thread.start()
    for i in range(MAX_WORKERS):
        t = threading.Thread(target=_worker_loop, daemon=True, name=f"vm-update-worker-{i}")
        t.start()
        _worker_threads.append(t)


def _scheduler_loop():
    while True:
        try:
            _check_schedules()
        except Exception as e:
            logging.error(f"[{__name__}] scheduler error: {e}")
        time.sleep(SCHEDULER_TICK)


def _check_schedules():
    for policy in db.list_enabled_schedules():
        try:
            if _is_due(policy):
                job_id = db.create_job(policy.guest_id, "check")
                enqueue_job({
                    "job_id": job_id,
                    "guest_id": policy.guest_id,
                    "job_type": "check",
                    "auto_apply": policy.auto_apply,
                })
        except Exception as e:
            logging.error(f"[{__name__}] scheduling failed for {policy.guest_id}: {e}")


def _worker_loop():
    while True:
        try:
            job = _job_queue.get()
            if job is None:
                break
            _run_job(job)
            _job_queue.task_done()
        except Exception as e:
            logging.error(f"[{__name__}] worker error: {e}")


def _run_job(job):
    job_id = job.get("job_id")
    guest_id = job.get("guest_id")
    job_type = job.get("job_type")

    try:
        db.update_job(job_id, status="running")
        guest, cred = db.get_guest_with_credential(guest_id)
        if not guest or not cred:
            db.update_job(
                job_id,
                status="failed",
                completed_at=_now(),
                error="Guest or credentials not found",
                output=json.dumps([{"level": "error", "message": "Guest or credentials not found"}]),
            )
            return
        password, private_key = utils.resolve_credential_secret(cred)
        driver = WindowsDriver() if guest.os_family == "windows" else SSHDriver()

        if job_type == "check":
            _do_check(
                job_id,
                guest,
                cred.username,
                password,
                driver,
                auto_apply=job.get("auto_apply", False),
                private_key=private_key,
            )
        elif job_type == "apply":
            _do_apply(
                job_id,
                guest,
                cred.username,
                password,
                driver,
                private_key=private_key,
                manual=job.get("manual", False),
            )
        else:
            db.update_job(
                job_id,
                status="failed",
                completed_at=_now(),
                error=f"Unknown job type: {job_type}",
            )
    except Exception as e:
        logging.error(f"[{__name__}] job {job_id} error: {e}")
        with contextlib.suppress(Exception):
            db.update_job(
                job_id,
                status="failed",
                completed_at=_now(),
                error=str(e),
                output=json.dumps([{"level": "error", "message": str(e)}]),
            )


def _do_check(job_id, guest, username, password, driver, auto_apply=False, private_key=None):
    result = driver.discover(guest.ip_host, guest.ssh_port, username, password, private_key=private_key)
    status = "completed" if result.get("ok") else "failed"
    db.update_guest_status(guest.id, status, _now())
    if not result.get("ok"):
        db.update_job(
            job_id,
            status="failed",
            completed_at=_now(),
            error=result.get("error", ""),
            output=json.dumps(result.get("log", [{"level": "error", "message": result.get("error", "")}])),
        )
        return
    raw_packages = result.get("packages", [])
    packages = [PackageUpdate(**p) for p in raw_packages]
    db.save_packages(job_id, packages)
    log = result.get("log", [])
    log.append({"level": "info", "message": f"Found {len(packages)} update(s)", "at": _now()})
    db.update_job(
        job_id,
        status="completed",
        completed_at=_now(),
        packages_found=len(packages),
        output=json.dumps(log),
    )
    if auto_apply and packages:
        try:
            apply_job_id = db.create_job(guest.id, "apply")
            enqueue_job({"job_id": apply_job_id, "guest_id": guest.id, "job_type": "apply"})
        except Exception as e:
            logging.error(f"[{__name__}] auto-apply enqueue failed: {e}")


def _do_apply(job_id, guest, username, password, driver, private_key=None, manual=False):
    policy = db.get_policy(guest.id)
    dry_run = (policy.dry_run if policy else True) and not manual
    result = driver.apply(
        guest.ip_host,
        guest.ssh_port,
        username,
        password,
        dry_run=dry_run,
        private_key=private_key,
    )
    status = "completed" if result.get("ok") else "failed"
    db.update_guest_status(guest.id, status, _now())
    if not result.get("ok"):
        db.update_job(
            job_id,
            status="failed",
            completed_at=_now(),
            error=result.get("error", ""),
            output=json.dumps(result.get("log", [{"level": "error", "message": result.get("error", "")}])),
        )
        return
    db.update_job(
        job_id,
        status="completed",
        completed_at=_now(),
        packages_applied=result.get("packages_applied", 0),
        output=json.dumps(result.get("log", result.get("output", []))),
    )


def enqueue_job(job):
    _job_queue.put(job)
