# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/converter/engine.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Conversion job state machine and execution engine.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Conversion job state machine and execution engine.
"""

from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime
from typing import Any

from ProxmoxVEx.converter import db as converter_db
from ProxmoxVEx.converter.constants import JobOperation, JobStatus
from ProxmoxVEx.converter.errors import JobCancelledError, map_exception
from ProxmoxVEx.converter.models import ConversionJob, DetectedOS, WorkloadRef, WorkloadType
from ProxmoxVEx.converter.preflight import run_preflight
from ProxmoxVEx.converter.runner import NodeRunner, get_runner
from ProxmoxVEx.converter.validators import validate_job_payload
from ProxmoxVEx.core.db import get_db
from ProxmoxVEx.utils.audit import log_audit
from ProxmoxVEx.utils.realtime import broadcast_sse


class JobNotFoundError(Exception):
    pass


class ConversionEngine:
    """Owns the lifecycle of a conversion job."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._cancelled: set[str] = set()

    def submit_job(self, payload: dict[str, Any], created_by: str) -> ConversionJob:
        """Validate and persist a new job, then start it in a background thread."""
        normalized = validate_job_payload(payload)

        job_id = str(uuid.uuid4())
        now = datetime.now().isoformat()

        source = WorkloadRef(
            cluster_id=normalized["source_cluster_id"],
            node=normalized["source_node"],
            type=normalized["source_type"],
            id=normalized["source_id"],
        )
        target = None
        if "target_type" in normalized and "target_id" in normalized:
            target = WorkloadRef(
                cluster_id=normalized.get("target_cluster_id", source.cluster_id),
                node=normalized.get("target_node", source.node),
                type=normalized["target_type"],
                id=normalized["target_id"],
            )

        job = ConversionJob(
            id=job_id,
            created_at=now,
            created_by=created_by,
            operation=normalized["operation"],
            source=source,
            target=target,
            target_storage=normalized.get("target_storage", ""),
            target_disk_size_gb=normalized.get("target_disk_size_gb"),
            target_disk_format=normalized.get("target_disk_format", ""),
            target_bridge=normalized.get("target_bridge", ""),
            target_bios=normalized.get("target_bios", ""),
            dry_run=normalized.get("dry_run", False),
            replace_target=normalized.get("replace_target", False),
            snapshot_source=normalized.get("snapshot_source", False),
            rollback_on_failure=normalized.get("rollback_on_failure", True),
            destroy_source=normalized.get("destroy_source", False),
            headroom_gb=normalized.get("headroom_gb", 1),
            preserve_network=normalized.get("preserve_network", False),
            auto_start=normalized.get("auto_start", False),
        )

        _persist_job(job)
        log_audit(
            user=created_by,
            action="converter.job.submitted",
            details=f"{job.operation.value} job {job.id} from {source.type.value} {source.id} to target {target.id if target else 'n/a'}",
            cluster=source.cluster_id,
        )

        thread = threading.Thread(target=self._run_job, args=(job,), daemon=True)
        thread.start()
        return job

    def _run_job(self, job: ConversionJob) -> None:
        """Execute a job through its state machine."""
        if not (job.source is not None):
            raise AssertionError("invariant failed")
        try:
            self.check_cancel(job)
            self._transition(job, JobStatus.VALIDATING)

            runner = get_runner(job.source.cluster_id, job.source.node)

            target = job.target
            target_runner = runner
            if target is not None and (
                target.cluster_id != job.source.cluster_id or target.node != job.source.node
            ):
                target_runner = get_runner(target.cluster_id, target.node)
                # Cross-cluster data transfer is not yet fully wired in the MVP flows.
                if target.cluster_id != job.source.cluster_id:
                    self._fail_with(
                        job,
                        "Cross-cluster conversion is not yet supported in this release.",
                        "Use a same-cluster target or wait for a future release with cross-cluster runner support.",
                        code="E_NOT_SUPPORTED",
                    )
                    return

            # Validation / RBAC is assumed already enforced by API layer; this is a sanity check.
            self._transition(job, JobStatus.PREFLIGHT)
            report = run_preflight(job.id, runner, self._job_to_payload(job), dry_run=job.dry_run)

            if not report.overall_passed:
                failed = [c for c in report.checks if c.required and not c.passed]
                reason = failed[0].reason if failed else "Pre-flight checks failed"
                fix = failed[0].fix if failed else "Review the pre-flight report and retry"
                self._fail_with(job, reason, fix)
                return

            if job.dry_run:
                self._log(job, "Dry-run completed; no changes made.")
                self._transition(job, JobStatus.SUCCEEDED, progress=100)
                return

            self._transition(job, JobStatus.RUNNING, progress=0)
            self._execute_operation(job, runner, target_runner)
        except JobCancelledError:
            return
        except Exception as exc:
            logging.exception("Conversion job %s failed", job.id)
            self._fail(job, exc)

    def _execute_operation(self, job: ConversionJob, runner: NodeRunner, target_runner: NodeRunner) -> None:
        """Dispatch to the operation-specific flow, executing configured hooks."""
        self._run_hooks("pre_convert", job, runner)
        try:
            if job.operation == JobOperation.LXC_TO_VM:
                from ProxmoxVEx.converter.flows.lxc_to_vm import run_lxc_to_vm

                run_lxc_to_vm(job, runner, target_runner, self)
            elif job.operation == JobOperation.VM_TO_LXC:
                from ProxmoxVEx.converter.flows.vm_to_lxc import run_vm_to_lxc

                run_vm_to_lxc(job, runner, target_runner, self)
            elif job.operation in (
                JobOperation.SHRINK_LXC,
                JobOperation.EXPAND_LXC,
                JobOperation.SHRINK_VM,
                JobOperation.EXPAND_VM,
            ):
                from ProxmoxVEx.converter.flows.disk_resize import run_disk_resize

                run_disk_resize(job, runner, target_runner, self)
            elif job.operation == JobOperation.CLONE_REPLACE_DISK:
                from ProxmoxVEx.converter.flows.clone_replace import run_clone_replace

                run_clone_replace(job, runner, target_runner, self)
            else:
                raise RuntimeError(f"Unsupported operation: {job.operation}")
        finally:
            self._run_hooks("post_convert", job, runner)

    def _run_hooks(self, stage: str, job: ConversionJob, runner: NodeRunner) -> None:
        """Run enabled hooks for a given stage on the target node."""
        if job.status == JobStatus.CANCELLED:
            return
        try:
            hooks = converter_db.list_hooks(enabled_only=True)
        except Exception as exc:
            logging.warning("Could not load conversion hooks for stage %s: %s", stage, exc)
            return

        for hook in hooks:
            if hook.get("stage") != stage:
                continue
            path = hook.get("path", "")
            if not path:
                continue
            # Only allow absolute paths under /etc/ProxmoxVEx/hooks for safety.
            if not path.startswith("/etc/ProxmoxVEx/hooks/"):
                self._log(job, f"Skipping hook {hook.get('name')} (path outside /etc/ProxmoxVEx/hooks)")
                continue
            self._log(job, f"Running {stage} hook: {hook.get('name')}")
            result = runner.run([path, job.id, stage, job.operation.value], timeout=300)
            self.log_command(job, result, f"hook_{stage}")
            if not result.ok:
                raise RuntimeError(f"Hook '{hook.get('name')}' failed: {result.stderr}")

    def _transition(self, job: ConversionJob, status: JobStatus, progress: int | None = None) -> None:
        """Update job status and optionally progress."""
        self.check_cancel(job)
        job.status = status
        if progress is not None:
            job.progress_pct = min(100, max(0, progress))
        _persist_job(job)

    def set_phase(self, job: ConversionJob, phase: str, progress: int | None = None) -> None:
        """Update the current phase and progress."""
        self.check_cancel(job)
        job.phase = phase
        if progress is not None:
            job.progress_pct = min(100, max(0, progress))
        _persist_job(job)
        self._log(job, f"Phase: {phase}")
        self._broadcast(job)

    def _log(self, job: ConversionJob, message: str) -> None:
        """Append a line to the job's log tail."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{timestamp}] {message}"
        job.log_tail = (job.log_tail + "\n" + line).strip()
        if len(job.log_tail) > 10000:
            job.log_tail = job.log_tail[-10000:]
        _persist_job(job)

    def log_command(self, job: ConversionJob, result, phase: str) -> None:
        """Log the outcome of a shell command."""
        status = "OK" if result.ok else f"FAILED({result.returncode})"
        self._log(job, f"[{phase}] {status}: {result.command}")
        if not result.ok and result.stderr:
            self._log(job, f"[{phase}] stderr: {result.stderr[:500]}")

    def _fail(self, job: ConversionJob, exc: Exception) -> None:
        code, reason, fix = map_exception(exc)
        self._fail_with(job, reason, fix, code=code.value)

    def _fail_with(
        self,
        job: ConversionJob,
        reason: str,
        fix: str,
        code: str = "E_CONVERSION",
    ) -> None:
        if not (job.source is not None):
            raise AssertionError("invariant failed")
        job.status = JobStatus.FAILED
        job.error_code = code
        job.error_reason = reason
        job.error_fix = fix
        job.completed_at = datetime.now().isoformat()
        _persist_job(job)
        self._broadcast(job)
        log_audit(
            user=job.created_by,
            action="converter.job.failed",
            details=f"Job {job.id} failed: {reason}",
            cluster=job.source.cluster_id,
        )

    def _broadcast(self, job: ConversionJob) -> None:
        """Send a lightweight converter job update to SSE/WebSocket clients."""
        if not (job.source is not None):
            raise AssertionError("invariant failed")
        try:
            broadcast_sse(
                "converter_job",
                {
                    "job_id": job.id,
                    "status": job.status.value,
                    "phase": job.phase,
                    "progress_pct": job.progress_pct,
                    "operation": job.operation.value,
                    "cluster_id": job.source.cluster_id,
                    "source_id": job.source.id,
                    "error_code": job.error_code,
                },
                cluster_id=job.source.cluster_id,
            )
        except Exception as exc:
            logging.debug("Failed to broadcast converter job update: %s", exc)

    def mark_succeeded(self, job: ConversionJob) -> None:
        if not (job.source is not None):
            raise AssertionError("invariant failed")
        job.status = JobStatus.SUCCEEDED
        job.progress_pct = 100
        job.completed_at = datetime.now().isoformat()
        _persist_job(job)
        self._broadcast(job)
        log_audit(
            user=job.created_by,
            action="converter.job.succeeded",
            details=f"Job {job.id} succeeded",
            cluster=job.source.cluster_id,
        )

    def request_cancel(self, job_id: str) -> bool:
        with self._lock:
            self._cancelled.add(job_id)
        return True

    def is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._cancelled

    def check_cancel(self, job: ConversionJob) -> None:
        if self.is_cancelled(job.id):
            job.status = JobStatus.CANCELLED
            job.completed_at = datetime.now().isoformat()
            _persist_job(job)
            raise JobCancelledError("Job cancelled by user")

    @staticmethod
    def _job_to_payload(job: ConversionJob) -> dict[str, Any]:
        if not (job.source is not None):
            raise AssertionError("invariant failed")
        payload: dict[str, Any] = {
            "operation": job.operation.value,
            "source_cluster_id": job.source.cluster_id,
            "source_node": job.source.node,
            "source_type": job.source.type.value,
            "source_id": job.source.id,
        }
        if job.target is not None:
            payload.update({
                "target_cluster_id": job.target.cluster_id,
                "target_node": job.target.node,
                "target_type": job.target.type.value,
                "target_id": job.target.id,
            })
        optional = [
            "target_storage",
            "target_disk_size_gb",
            "target_disk_format",
            "target_bridge",
            "target_bios",
            "dry_run",
            "replace_target",
            "snapshot_source",
            "rollback_on_failure",
            "destroy_source",
            "headroom_gb",
            "preserve_network",
            "auto_start",
        ]
        for key in optional:
            value = getattr(job, key)
            if value is not None and value != "":
                payload[key] = value
        return payload


# Global engine instance
_engine: ConversionEngine | None = None


def get_engine() -> ConversionEngine:
    global _engine
    if _engine is None:
        _engine = ConversionEngine()
    return _engine


def _persist_job(job: ConversionJob) -> None:
    """Persist a ConversionJob to the SQLite database."""
    db = get_db()
    cursor = db.conn.cursor()

    data = job.to_dict()
    source = data.get("source") or {}
    target = data.get("target") or {}
    detected = data.get("detected_os") or {}

    cursor.execute(
        """
        INSERT OR REPLACE INTO conversion_jobs (
            id, created_at, created_by, operation, status, progress_pct, phase,
            source_cluster_id, source_node, source_type, source_id,
            target_cluster_id, target_node, target_type, target_id,
            target_storage, target_disk_size_gb, target_disk_format,
            target_bridge, target_bios,
            dry_run, replace_target, snapshot_source, rollback_on_failure,
            destroy_source, headroom_gb, preserve_network, auto_start,
            detected_os_type, detected_os_distro, detected_os_version,
            detected_boot_mode, detected_partition_table, detected_has_esp,
            error_code, error_reason, error_fix, log_tail, full_log_path,
            started_at, completed_at, depends_on_job_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            data["id"],
            data["created_at"],
            data["created_by"],
            data["operation"],
            data["status"],
            data["progress_pct"],
            data["phase"],
            source.get("cluster_id"),
            source.get("node"),
            source.get("type"),
            source.get("id"),
            target.get("cluster_id"),
            target.get("node"),
            target.get("type"),
            target.get("id"),
            data.get("target_storage"),
            data.get("target_disk_size_gb"),
            data.get("target_disk_format"),
            data.get("target_bridge"),
            data.get("target_bios"),
            int(data.get("dry_run", False)),
            int(data.get("replace_target", False)),
            int(data.get("snapshot_source", False)),
            int(data.get("rollback_on_failure", True)),
            int(data.get("destroy_source", False)),
            data.get("headroom_gb", 1),
            int(data.get("preserve_network", False)),
            int(data.get("auto_start", False)),
            detected.get("os_type"),
            detected.get("distro"),
            detected.get("version"),
            detected.get("boot_mode"),
            detected.get("partition_table"),
            int(detected.get("has_esp", False)),
            data.get("error_code"),
            data.get("error_reason"),
            data.get("error_fix"),
            data.get("log_tail"),
            data.get("full_log_path"),
            data.get("started_at"),
            data.get("completed_at"),
            data.get("depends_on_job_id"),
        ),
    )
    db.conn.commit()


def load_job(job_id: str) -> ConversionJob:
    db = get_db()
    cursor = db.conn.cursor()
    cursor.execute("SELECT * FROM conversion_jobs WHERE id = ?", (job_id,))
    row = cursor.fetchone()
    if row is None:
        raise JobNotFoundError(f"Job {job_id} not found")

    return _row_to_job(row)


def list_jobs(
    cluster_id: str | None = None,
    node: str | None = None,
    status: str | None = None,
    operation: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[ConversionJob]:
    db = get_db()
    cursor = db.conn.cursor()

    query = "SELECT * FROM conversion_jobs WHERE 1=1"
    params: list[Any] = []
    if cluster_id:
        query += " AND source_cluster_id = ?"
        params.append(cluster_id)
    if node:
        query += " AND source_node = ?"
        params.append(node)
    if status:
        query += " AND status = ?"
        params.append(status)
    if operation:
        query += " AND operation = ?"
        params.append(operation)
    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    cursor.execute(query, params)
    return [_row_to_job(row) for row in cursor.fetchall()]


def _row_to_job(row) -> ConversionJob:
    def _bool(value):
        return bool(int(value)) if value is not None else False

    source = WorkloadRef(
        cluster_id=row["source_cluster_id"],
        node=row["source_node"],
        type=WorkloadType(row["source_type"]),
        id=row["source_id"],
    )
    target = None
    if row["target_cluster_id"]:
        target = WorkloadRef(
            cluster_id=row["target_cluster_id"],
            node=row["target_node"],
            type=WorkloadType(row["target_type"]),
            id=row["target_id"],
        )

    return ConversionJob(
        id=row["id"],
        created_at=row["created_at"],
        created_by=row["created_by"],
        operation=JobOperation(row["operation"]),
        status=JobStatus(row["status"]),
        progress_pct=row["progress_pct"] or 0,
        phase=row["phase"] or "",
        source=source,
        target=target,
        target_storage=row["target_storage"] or "",
        target_disk_size_gb=row["target_disk_size_gb"],
        target_disk_format=row["target_disk_format"] or "",
        target_bridge=row["target_bridge"] or "",
        target_bios=row["target_bios"] or "",
        dry_run=_bool(row["dry_run"]),
        replace_target=_bool(row["replace_target"]),
        snapshot_source=_bool(row["snapshot_source"]),
        rollback_on_failure=_bool(row["rollback_on_failure"]),
        destroy_source=_bool(row["destroy_source"]),
        headroom_gb=row["headroom_gb"] or 1,
        preserve_network=_bool(row["preserve_network"]),
        auto_start=_bool(row["auto_start"]),
        detected_os=DetectedOS(
            os_type=row["detected_os_type"] or "unknown",
            distro=row["detected_os_distro"] or "unknown",
            version=row["detected_os_version"] or "",
            boot_mode=row["detected_boot_mode"] or "unknown",
            partition_table=row["detected_partition_table"] or "unknown",
            has_esp=_bool(row["detected_has_esp"]),
        ),
        error_code=row["error_code"],
        error_reason=row["error_reason"] or "",
        error_fix=row["error_fix"] or "",
        log_tail=row["log_tail"] or "",
        full_log_path=row["full_log_path"] or "",
        started_at=row["started_at"],
        completed_at=row["completed_at"],
        depends_on_job_id=row["depends_on_job_id"],
    )


def delete_job(job_id: str) -> bool:
    """Delete a conversion job from the database."""
    db = get_db()
    cursor = db.conn.cursor()
    cursor.execute("DELETE FROM conversion_jobs WHERE id = ?", (job_id,))
    db.conn.commit()
    return cursor.rowcount > 0


_TERMINAL_STATUSES = {"succeeded", "failed", "cancelled", "rolled_back"}


def clear_jobs(
    cluster_id: str | None = None,
    status: str | None = None,
    created_by: str | None = None,
    older_than_hours: int | None = None,
) -> int:
    """Delete terminal or filtered conversion jobs from the database.

    Returns the number of rows removed.
    """
    db = get_db()
    cursor = db.conn.cursor()
    query = "DELETE FROM conversion_jobs WHERE 1=1"
    params: list[Any] = []

    if status:
        query += " AND status = ?"
        params.append(status)
    else:
        query += f" AND status IN ({','.join('?' for _ in _TERMINAL_STATUSES)})"
        params.extend(_TERMINAL_STATUSES)

    if cluster_id:
        query += " AND source_cluster_id = ?"
        params.append(cluster_id)

    if created_by:
        query += " AND created_by = ?"
        params.append(created_by)

    if older_than_hours:
        from datetime import timedelta

        cutoff = (datetime.now() - timedelta(hours=older_than_hours)).isoformat()
        query += " AND created_at < ?"
        params.append(cutoff)

    cursor.execute(query, params)
    db.conn.commit()
    return cursor.rowcount
