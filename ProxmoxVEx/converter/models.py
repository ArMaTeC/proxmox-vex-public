# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/converter/models.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Data models for conversion jobs, presets, and pre-...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Data models for conversion jobs, presets, and pre-flight reports.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ProxmoxVEx.converter.constants import (
    JobOperation,
    JobStatus,
    WorkloadType,
)


@dataclass
class WorkloadRef:
    """Reference to a Proxmox workload (CT or VM)."""

    cluster_id: str
    node: str
    type: WorkloadType
    id: int


@dataclass
class DetectedOS:
    """Guest OS detection result."""

    os_type: str = "unknown"
    distro: str = "unknown"
    version: str = ""
    boot_mode: str = "unknown"
    partition_table: str = "unknown"
    has_esp: bool = False


@dataclass
class PreFlightCheck:
    """A single pre-flight validation check."""

    name: str
    category: str
    passed: bool
    required: bool = True
    message: str = ""
    reason: str = ""
    fix: str = ""
    fix_commands: list[str] = field(default_factory=list)
    auto_fix: bool = False


@dataclass
class PreFlightReport:
    """Collection of pre-flight checks."""

    job_id: str = ""
    checks: list[PreFlightCheck] = field(default_factory=list)

    @property
    def overall_passed(self) -> bool:
        """True only if all required checks passed."""
        return all(not (check.required and not check.passed) for check in self.checks)


@dataclass
class ConversionJob:
    """Persistent representation of a conversion/resize job."""

    id: str
    created_at: str
    created_by: str
    operation: JobOperation
    status: JobStatus = JobStatus.PENDING
    progress_pct: int = 0
    phase: str = ""
    source: WorkloadRef | None = None
    target: WorkloadRef | None = None
    target_storage: str = ""
    target_disk_size_gb: int | None = None
    target_disk_format: str = ""
    target_bridge: str = ""
    target_bios: str = ""
    dry_run: bool = False
    replace_target: bool = False
    snapshot_source: bool = False
    rollback_on_failure: bool = True
    destroy_source: bool = False
    headroom_gb: int = 1
    preserve_network: bool = False
    auto_start: bool = False
    detected_os: DetectedOS = field(default_factory=DetectedOS)
    error_code: str | None = None
    error_reason: str = ""
    error_fix: str = ""
    log_tail: str = ""
    full_log_path: str = ""
    started_at: str | None = None
    completed_at: str | None = None
    depends_on_job_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "created_at": self.created_at,
            "created_by": self.created_by,
            "operation": self.operation.value,
            "status": self.status.value,
            "progress_pct": self.progress_pct,
            "phase": self.phase,
            "source": self._workload_to_dict(self.source),
            "target": self._workload_to_dict(self.target),
            "target_storage": self.target_storage,
            "target_disk_size_gb": self.target_disk_size_gb,
            "target_disk_format": self.target_disk_format,
            "target_bridge": self.target_bridge,
            "target_bios": self.target_bios,
            "dry_run": self.dry_run,
            "replace_target": self.replace_target,
            "snapshot_source": self.snapshot_source,
            "rollback_on_failure": self.rollback_on_failure,
            "destroy_source": self.destroy_source,
            "headroom_gb": self.headroom_gb,
            "preserve_network": self.preserve_network,
            "auto_start": self.auto_start,
            "detected_os": {
                "os_type": self.detected_os.os_type,
                "distro": self.detected_os.distro,
                "version": self.detected_os.version,
                "boot_mode": self.detected_os.boot_mode,
                "partition_table": self.detected_os.partition_table,
                "has_esp": self.detected_os.has_esp,
            },
            "error_code": self.error_code,
            "error_reason": self.error_reason,
            "error_fix": self.error_fix,
            "log_tail": self.log_tail,
            "full_log_path": self.full_log_path,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "depends_on_job_id": self.depends_on_job_id,
        }

    @staticmethod
    def _workload_to_dict(ref: WorkloadRef | None) -> dict[str, Any] | None:
        if ref is None:
            return None
        return {
            "cluster_id": ref.cluster_id,
            "node": ref.node,
            "type": ref.type.value,
            "id": ref.id,
        }


@dataclass
class ConversionPreset:
    """Saved reusable conversion configuration."""

    id: str
    name: str
    owner: str
    operation: JobOperation
    target_storage: str = ""
    target_disk_format: str = ""
    target_bridge: str = ""
    target_bios: str = ""
    headroom_gb: int = 1
    snapshot_source: bool = False
    rollback_on_failure: bool = True
