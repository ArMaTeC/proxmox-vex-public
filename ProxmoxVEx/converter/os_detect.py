# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/converter/os_detect.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Guest OS detection for conversion targets.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Guest OS detection for conversion targets.

Primary path: virt-inspector (libguestfs).
Fallback path: partition-table and filesystem heuristics from fdisk/file.
"""

from __future__ import annotations

import defusedxml.ElementTree as ET

from ProxmoxVEx.converter.models import DetectedOS


def detect_os_from_disk(
    runner,
    disk_path: str,
    img_format: str = "raw",
) -> DetectedOS:
    """Detect OS details from a disk image on a Proxmox node.

    Args:
        runner: NodeRunner instance for executing commands on the node.
        disk_path: Path to the disk image on the node.
        img_format: Disk image format (raw, qcow2, etc.).

    Returns:
        DetectedOS with best-effort detection results.
    """
    detected = DetectedOS()

    # Primary: virt-inspector
    if _has_virt_inspector(runner):
        result = _detect_via_guestfs(runner, disk_path, img_format)
        if result:
            return result

    # Fallback: partition heuristics
    result = _detect_via_partition_types(runner, disk_path)
    if result:
        return result

    return detected


def _has_virt_inspector(runner) -> bool:
    result = runner.run(["command", "-v", "virt-inspector"], timeout=10)
    return result.ok and bool(result.stdout.strip())


def _detect_via_guestfs(
    runner,
    disk_path: str,
    img_format: str,
) -> DetectedOS | None:
    """Use virt-inspector to detect OS details."""
    from ProxmoxVEx.converter import commands as cmd

    result = runner.run(
        ["LIBGUESTFS_BACKEND=direct"] + cmd.virt_inspector(disk_path, img_format),
        timeout=60,
    )
    if not result.ok or not result.stdout.strip():
        return None

    detected = DetectedOS()
    try:
        root = ET.fromstring(result.stdout)
    except ET.ParseError:
        return None

    # OS type and distro
    os_elem = root.find(".//os")
    if os_elem is not None:
        name = _xml_text(os_elem, "name")
        if name:
            name_lower = name.lower()
            if "windows" in name_lower:
                detected.os_type = "windows"
                detected.distro = "windows"
            elif "linux" in name_lower:
                detected.os_type = "linux"
                distro = _xml_text(os_elem, "distro") or "unknown"
                detected.distro = _normalize_distro(distro)

        detected.version = _xml_text(os_elem, "version") or ""

    # Partition table and boot mode
    for part in root.findall(".//partition"):
        part_type = (part.get("type") or "").lower()
        if part_type == "efi":
            detected.has_esp = True
            detected.boot_mode = "uefi"
            break

    partition_table = root.find(".//partition_table")
    if partition_table is not None:
        style = (partition_table.get("style") or "").lower()
        if style in ("gpt", "mbr"):
            detected.partition_table = style
            if detected.boot_mode == "unknown":
                detected.boot_mode = "uefi" if style == "gpt" else "bios"

    if detected.os_type == "unknown":
        return None
    return detected


def _detect_via_partition_types(
    runner,
    disk_path: str,
) -> DetectedOS | None:
    """Fallback OS detection using fdisk/parted and file signatures."""
    from ProxmoxVEx.converter import commands as cmd

    detected = DetectedOS()

    fdisk_result = runner.run(cmd.fdisk_list(disk_path), timeout=30)
    fdisk_out = fdisk_result.stdout if fdisk_result.ok else ""

    if not fdisk_out:
        return None

    fdisk_lower = fdisk_out.lower()
    if "gpt" in fdisk_lower:
        detected.partition_table = "gpt"
        detected.boot_mode = "uefi"
    elif "dos" in fdisk_lower or "msdos" in fdisk_lower:
        detected.partition_table = "mbr"
        detected.boot_mode = "bios"

    if "efi" in fdisk_lower or "ef00" in fdisk_lower:
        detected.has_esp = True
        detected.boot_mode = "uefi"

    file_result = runner.run(cmd.file_disk_signature(disk_path), timeout=10)
    file_out = file_result.stdout if file_result.ok else ""
    file_lower = file_out.lower()

    if "ntfs" in file_lower or "windows" in file_lower:
        detected.os_type = "windows"
        detected.distro = "windows"
    elif any(fs in file_lower for fs in ("ext2", "ext3", "ext4", "xfs", "btrfs")):
        detected.os_type = "linux"
        detected.distro = "unknown"

    if detected.os_type == "unknown" and detected.has_esp:
        # Last resort: try to detect NTFS through ntfscluster
        ntfs_result = runner.run(["bash", "-c", f"ntfscluster {disk_path} >/dev/null 2>&1 && echo NTFS"], timeout=10)
        if ntfs_result.ok and "ntfs" in ntfs_result.stdout.lower():
            detected.os_type = "windows"
            detected.distro = "windows"

    if detected.os_type == "unknown":
        return None
    return detected


def _xml_text(element, tag: str) -> str | None:
    child = element.find(f".//{tag}")
    return child.text if child is not None else None


def _normalize_distro(distro: str) -> str:
    distro = distro.lower().strip()
    mapping = {
        "debian": "debian",
        "ubuntu": "ubuntu",
        "alpine": "alpine",
        "rocky": "rocky",
        "centos": "centos",
        "rhel": "rhel",
        "redhat": "rhel",
        "red hat": "rhel",
        "fedora": "fedora",
        "almalinux": "almalinux",
        "arch": "arch",
        "manjaro": "arch",
    }
    for key, value in mapping.items():
        if key in distro:
            return value
    return distro or "unknown"


def is_distro_supported(distro: str, operation: str) -> bool:
    """Check if a detected distro is supported for a given operation."""
    from ProxmoxVEx.converter.constants import (
        SUPPORTED_LXC_TO_VM_DISTROS,
        SUPPORTED_VM_TO_LXC_DISTROS,
    )

    if operation == "lxc_to_vm":
        return _normalize_distro(distro) in SUPPORTED_LXC_TO_VM_DISTROS
    if operation == "vm_to_lxc":
        return _normalize_distro(distro) in SUPPORTED_VM_TO_LXC_DISTROS
    # Disk operations do not depend on OS.
    return True


def recommended_kernel_packages(distro: str) -> list[str]:
    """Return the package names needed to make a converted container bootable as a VM."""
    mapping = {
        "debian": ["linux-image-amd64", "grub-pc"],
        "ubuntu": ["linux-image-generic", "grub-pc"],
        "alpine": ["linux-lts", "syslinux"],
        "rocky": ["kernel", "grub2-pc"],
        "centos": ["kernel", "grub2-pc"],
        "rhel": ["kernel", "grub2-pc"],
        "almalinux": ["kernel", "grub2-pc"],
        "fedora": ["kernel", "grub2-pc"],
        "arch": ["linux", "grub"],
    }
    return mapping.get(_normalize_distro(distro), [])
