# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/converter/validators.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Input validation helpers for the converter module.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Input validation helpers for the converter module.
All user-controlled values are validated before use in shell commands.
"""

from __future__ import annotations

import re
from typing import Any

from ProxmoxVEx.converter.constants import (
    MAX_PROXMOX_ID,
    MIN_DISK_GB,
    MIN_PROXMOX_ID,
    JobOperation,
    StorageBackend,
    WorkloadType,
)


class ValidationError(Exception):
    """Raised when a converter input fails validation."""

    def __init__(self, field: str, message: str):
        self.field = field
        self.message = message
        super().__init__(f"{field}: {message}")


def validate_proxmox_id(value: Any, field: str = "id") -> int:
    """Validate a Proxmox CT/VM ID."""
    if not isinstance(value, int):
        try:
            value = int(value)
        except (TypeError, ValueError) as exc:
            raise ValidationError(field, "must be an integer") from exc
    if not (MIN_PROXMOX_ID <= value <= MAX_PROXMOX_ID):
        raise ValidationError(field, f"must be between {MIN_PROXMOX_ID} and {MAX_PROXMOX_ID}")
    return value


def validate_storage_name(name: str) -> str:
    """Validate a Proxmox storage name."""
    if not isinstance(name, str):
        raise ValidationError("storage", "must be a string")
    if not name:
        raise ValidationError("storage", "cannot be empty")
    if len(name) > 64:
        raise ValidationError("storage", "too long")
    if not re.match(r"^[a-zA-Z0-9_\-]+$", name):
        raise ValidationError("storage", "contains invalid characters")
    return name


def validate_disk_size_gb(value: Any, field: str = "disk_size") -> int:
    """Validate a disk size in GB."""
    if not isinstance(value, int):
        try:
            value = int(value)
        except (TypeError, ValueError) as exc:
            raise ValidationError(field, "must be an integer") from exc
    if value < MIN_DISK_GB:
        raise ValidationError(field, f"must be at least {MIN_DISK_GB} GB")
    return value


def validate_headroom_gb(value: Any) -> int:
    """Validate shrink headroom in GB."""
    if not isinstance(value, int):
        try:
            value = int(value)
        except (TypeError, ValueError) as exc:
            raise ValidationError("headroom_gb", "must be an integer") from exc
    if value < 0:
        raise ValidationError("headroom_gb", "cannot be negative")
    return value


def validate_bridge_name(name: str) -> str:
    """Validate a network bridge name."""
    if not isinstance(name, str):
        raise ValidationError("bridge", "must be a string")
    if not name:
        raise ValidationError("bridge", "cannot be empty")
    if not re.match(r"^[a-zA-Z0-9_\-]+$", name):
        raise ValidationError("bridge", "contains invalid characters")
    return name


def validate_path(path: str) -> str:
    """Validate a file path argument does not contain shell metacharacters."""
    if not isinstance(path, str):
        raise ValidationError("path", "must be a string")
    if not path:
        raise ValidationError("path", "cannot be empty")
    if re.search(r"[;&|`$(){}\[\]<>\\]", path):
        raise ValidationError("path", "contains shell metacharacters")
    return path


def validate_operation(value: Any) -> JobOperation:
    """Validate a converter operation enum value."""
    if isinstance(value, JobOperation):
        return value
    try:
        return JobOperation(value)
    except ValueError as exc:
        raise ValidationError("operation", f"must be one of: {', '.join(op.value for op in JobOperation)}") from exc


def validate_workload_type(value: Any) -> WorkloadType:
    """Validate a workload type (lxc or vm)."""
    if isinstance(value, WorkloadType):
        return value
    try:
        return WorkloadType(value)
    except ValueError as exc:
        raise ValidationError("workload_type", f"must be one of: {', '.join(t.value for t in WorkloadType)}") from exc


def validate_storage_backend(value: str) -> StorageBackend:
    """Validate a Proxmox storage backend type."""
    try:
        return StorageBackend(value)
    except ValueError as exc:
        raise ValidationError(
            "storage_backend", f"must be one of: {', '.join(b.value for b in StorageBackend)}"
        ) from exc


def sanitize_shell_arg(value: str) -> str:
    """Return a string that can safely be embedded in single-quoted shell contexts.

    This is a last-resort helper. Prefer passing command arguments as arrays
    rather than interpolating them into shell strings.
    """
    if not isinstance(value, str):
        value = str(value)
    # Prevent single-quote escape sequences and null bytes.
    if "\x00" in value:
        raise ValidationError("shell_arg", "null bytes are not allowed")
    return value.replace("'", "'\"'\"'")


def validate_job_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate a complete converter job submission payload.

    Returns a normalized dict with typed values. Raises ValidationError on failure.
    """
    if not isinstance(payload, dict):
        raise ValidationError("payload", "must be a JSON object")

    operation = validate_operation(payload.get("operation"))
    source_type = validate_workload_type(payload.get("source_type"))
    source_id = validate_proxmox_id(payload.get("source_id"), "source_id")

    source_cluster_id = payload.get("source_cluster_id")
    source_node = payload.get("source_node")
    if not source_cluster_id or not isinstance(source_cluster_id, str):
        raise ValidationError("source_cluster_id", "required")
    if not source_node or not isinstance(source_node, str):
        raise ValidationError("source_node", "required")

    normalized: dict[str, Any] = {
        "operation": operation,
        "source_cluster_id": source_cluster_id,
        "source_node": source_node,
        "source_type": source_type,
        "source_id": source_id,
    }

    # Target fields depend on operation category.
    target_required = operation in {
        JobOperation.LXC_TO_VM,
        JobOperation.VM_TO_LXC,
    }

    target_type_value = payload.get("target_type")
    target_id_value = payload.get("target_id")
    if target_required or target_type_value is not None:
        if target_type_value is None:
            raise ValidationError("target_type", "required for this operation")
        target_type = validate_workload_type(target_type_value)
        normalized["target_type"] = target_type

    if target_required or target_id_value is not None:
        if target_id_value is None:
            raise ValidationError("target_id", "required for this operation")
        normalized["target_id"] = validate_proxmox_id(target_id_value, "target_id")

    target_node = payload.get("target_node", source_node)
    if not isinstance(target_node, str):
        raise ValidationError("target_node", "must be a string")
    normalized["target_node"] = target_node

    target_cluster_id = payload.get("target_cluster_id", source_cluster_id)
    if not isinstance(target_cluster_id, str):
        raise ValidationError("target_cluster_id", "must be a string")
    normalized["target_cluster_id"] = target_cluster_id

    if "target_storage" in payload:
        normalized["target_storage"] = validate_storage_name(payload["target_storage"])

    if "target_disk_size_gb" in payload:
        normalized["target_disk_size_gb"] = validate_disk_size_gb(payload["target_disk_size_gb"], "target_disk_size_gb")

    if "target_disk_format" in payload:
        fmt = payload["target_disk_format"]
        if fmt not in ("qcow2", "raw"):
            raise ValidationError("target_disk_format", "must be qcow2 or raw")
        normalized["target_disk_format"] = fmt

    if "target_bridge" in payload:
        normalized["target_bridge"] = validate_bridge_name(payload["target_bridge"])

    if "target_bios" in payload:
        bios = payload["target_bios"]
        if bios not in ("seabios", "ovmf"):
            raise ValidationError("target_bios", "must be seabios or ovmf")
        normalized["target_bios"] = bios

    # Boolean flags
    for flag in (
        "dry_run",
        "replace_target",
        "snapshot_source",
        "rollback_on_failure",
        "destroy_source",
        "preserve_network",
        "auto_start",
    ):
        normalized[flag] = bool(payload.get(flag, False))

    if "headroom_gb" in payload:
        normalized["headroom_gb"] = validate_headroom_gb(payload["headroom_gb"])

    # Validate operation/type consistency.
    if operation == JobOperation.LXC_TO_VM and normalized.get("target_type") != WorkloadType.VM:
        raise ValidationError("target_type", "must be 'vm' for lxc_to_vm")
    if operation == JobOperation.VM_TO_LXC and normalized.get("target_type") != WorkloadType.LXC:
        raise ValidationError("target_type", "must be 'lxc' for vm_to_lxc")

    return normalized
