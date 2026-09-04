# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/converter/errors.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Map failed commands and exceptions to stable error...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Map failed commands and exceptions to stable error codes, human-readable
reasons, and actionable fix suggestions.
"""

from ProxmoxVEx.converter.constants import ConverterErrorCode


class JobCancelledError(Exception):
    """Raised when a conversion job is cancelled by the user."""


def classify_command_error(command: str, stderr: str = "") -> tuple[ConverterErrorCode, str, str]:
    """Classify a failed shell command into an error code, reason, and fix.

    Returns:
        (error_code, reason, fix)
    """
    cmd_lower = command.lower()
    err_lower = (stderr or "").lower()

    if "pct mount" in cmd_lower or "pct unmount" in cmd_lower:
        return (
            ConverterErrorCode.CONVERSION,
            "Container mount/unmount failed (container state, storage backend issue, or lock).",
            "Run: pct status <CTID>; pct unlock <CTID>; verify storage health, then retry.",
        )

    if "qm config" in cmd_lower or "pct config" in cmd_lower or "pvesm path" in cmd_lower:
        return (
            ConverterErrorCode.NOT_FOUND,
            "Workload or storage lookup failed.",
            "Verify the source/target ID exists and the storage is available.",
        )

    if "rsync" in cmd_lower:
        return (
            ConverterErrorCode.CONVERSION,
            "File copy failed due to permissions, I/O errors, or insufficient temp space.",
            "Check free space in the temp dir, source filesystem health, and retry.",
        )

    if any(tool in cmd_lower for tool in ("losetup", "kpartx", "parted", "mkfs.")):
        return (
            ConverterErrorCode.CONVERSION,
            "Disk image preparation failed (loop/mapper mapping or partition/filesystem creation).",
            "Check loop devices (losetup -a), /dev/mapper entries, and required disk tooling.",
        )

    if "chroot" in cmd_lower:
        return (
            ConverterErrorCode.CONVERSION,
            "Kernel/bootloader injection failed inside chroot.",
            "Review package-manager errors in the log; verify DNS/repositories and distro package names.",
        )

    if any(pkg in cmd_lower for pkg in ("apt-get", "yum", "dnf", "apk", "pacman")):
        return (
            ConverterErrorCode.CONVERSION,
            "Package installation failed in chroot (repo/network/package availability).",
            "Test internet + DNS from host/chroot, refresh repositories, and verify package names.",
        )

    if "qm importdisk" in cmd_lower:
        return (
            ConverterErrorCode.CONVERSION,
            "Disk import failed (storage target issue or inaccessible temp image).",
            "Run pvesm status; verify target storage has free space and the image file exists.",
        )

    if any(qm_cmd in cmd_lower for qm_cmd in ("qm create", "qm set", "qm resize")):
        return (
            ConverterErrorCode.CONVERSION,
            "VM creation/configuration failed (VM ID conflict, storage/bridge invalid, or missing disk).",
            "Verify the target VM ID, storage, and bridge names, then retry.",
        )

    if any(pct_cmd in cmd_lower for pct_cmd in ("pct create", "pct set")):
        return (
            ConverterErrorCode.CONVERSION,
            "Container creation/configuration failed.",
            "Validate storage/bridge names and OS template availability.",
        )

    if "lvresize" in cmd_lower or "zfs set volsize" in cmd_lower:
        return (
            ConverterErrorCode.NO_SPACE,
            "Storage-level resize failed (backend constraints, permissions, or in-use volume).",
            "Verify backend health and free space; ensure the target volume/image is not busy.",
        )

    if "resize2fs" in cmd_lower:
        return (
            ConverterErrorCode.EXPAND_FAILED,
            "Filesystem resize failed (target too small or filesystem inconsistent).",
            "Increase target size/headroom and run e2fsck first; review minimum size output.",
        )

    if "e2fsck" in cmd_lower:
        return (
            ConverterErrorCode.SHRINK_FAILED,
            "Filesystem check found unrecoverable issues or could not access the device.",
            "Run e2fsck manually on the target device and ensure the workload is stopped.",
        )

    if "qemu-img" in cmd_lower:
        return (
            ConverterErrorCode.CONVERSION,
            "QCOW2 image operation failed (corruption, locked image, or insufficient space).",
            "Check image integrity with qemu-img check and ensure the workload is stopped.",
        )

    if "permission denied" in err_lower or "access denied" in err_lower:
        return (
            ConverterErrorCode.PERMISSION,
            "Permission denied on the Proxmox host.",
            "Verify the ProxmoxVEx node credentials have root or passwordless sudo access.",
        )

    if "no space" in err_lower or "insufficient space" in err_lower:
        return (
            ConverterErrorCode.DISK_FULL,
            "Insufficient disk space for temporary or target files.",
            "Free up space on the target storage or choose a different storage backend.",
        )

    return (
        ConverterErrorCode.CONVERSION,
        "Command failed during conversion workflow.",
        "Check the full job log and rerun with dry-run to verify inputs and environment.",
    )


def map_exception(exc: Exception) -> tuple[ConverterErrorCode, str, str]:
    """Map a Python exception to a stable error code and actionable message."""
    msg = str(exc).lower()

    if "validation" in msg:
        return (
            ConverterErrorCode.INVALID_ARG,
            "Input validation failed.",
            "Review the request parameters and retry.",
        )

    if "permission" in msg or "forbidden" in msg:
        return (
            ConverterErrorCode.PERMISSION,
            "Permission denied.",
            "Verify RBAC permissions and host credentials.",
        )

    if "not found" in msg:
        return (
            ConverterErrorCode.NOT_FOUND,
            "A required workload or resource was not found.",
            "Verify IDs and storage exist before retrying.",
        )

    if "timeout" in msg:
        return (
            ConverterErrorCode.CONVERSION,
            "Operation timed out.",
            "Retry the operation; if it persists, check host/network health.",
        )

    return (
        ConverterErrorCode.CONVERSION,
        "An unexpected error occurred during the conversion workflow.",
        "Check the full job log for details and retry.",
    )
