# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/converter/commands.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Build sanitized Proxmox/node shell command arrays for...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Build sanitized Proxmox/node shell command arrays for converter operations.

All command builders return either a list of arguments (when safe) or a single
shell string (only when required for redirection/chroot pipelines). Inputs are
assumed to have been validated by validators.py before reaching this module.
"""

from __future__ import annotations

import shlex

from ProxmoxVEx.converter.constants import DEFAULT_BIOS, DEFAULT_BRIDGE, DEFAULT_DISK_FORMAT
from ProxmoxVEx.converter.validators import sanitize_shell_arg


def _quote(value: str) -> str:
    """Return a shell-quoted string suitable for embedding in shell commands."""
    return shlex.quote(value)


def pct_config(ctid: int) -> list[str]:
    return ["pct", "config", str(ctid)]


def pct_status(ctid: int) -> list[str]:
    return ["pct", "status", str(ctid)]


def pct_mount(ctid: int) -> list[str]:
    return ["pct", "mount", str(ctid)]


def pct_unmount(ctid: int) -> list[str]:
    return ["pct", "unmount", str(ctid)]


def pct_unlock(ctid: int) -> list[str]:
    return ["pct", "unlock", str(ctid)]


def pct_stop(ctid: int) -> list[str]:
    return ["pct", "stop", str(ctid)]


def pct_destroy(ctid: int, destroy_unreferenced_disks: bool = True, purge: bool = True) -> list[str]:
    cmd = ["pct", "destroy", str(ctid)]
    if destroy_unreferenced_disks:
        cmd.extend(["--destroy-unreferenced-disks", "1"])
    if purge:
        cmd.extend(["--purge", "1"])
    return cmd


def pct_set_rootfs_size(ctid: int, volid: str, size_gb: int) -> list[str]:
    return ["pct", "set", str(ctid), "--rootfs", f"{volid},size={size_gb}G"]


def qm_config(vmid: int) -> list[str]:
    return ["qm", "config", str(vmid)]


def qm_status(vmid: int) -> list[str]:
    return ["qm", "status", str(vmid)]


def qm_stop(vmid: int) -> list[str]:
    return ["qm", "stop", str(vmid)]


def qm_unlock(vmid: int) -> list[str]:
    return ["qm", "unlock", str(vmid)]


def qm_destroy(vmid: int, destroy_unreferenced_disks: bool = True, purge: bool = True) -> list[str]:
    cmd = ["qm", "destroy", str(vmid)]
    if destroy_unreferenced_disks:
        cmd.extend(["--destroy-unreferenced-disks", "1"])
    if purge:
        cmd.extend(["--purge", "1"])
    return cmd


def qm_create(
    vmid: int,
    name: str,
    memory: int = 2048,
    cores: int = 2,
    bios: str = DEFAULT_BIOS,
    bridge: str = DEFAULT_BRIDGE,
    storage: str = "local-lvm",
    disk_size_gb: int = 8,
    disk_format: str = DEFAULT_DISK_FORMAT,
) -> list[str]:
    return [
        "qm",
        "create",
        str(vmid),
        "--name",
        str(name),
        "--memory",
        str(memory),
        "--cores",
        str(cores),
        "--bios",
        bios,
        "--net0",
        f"virtio,bridge={bridge}",
        "--scsihw",
        "virtio-scsi-single",
        "--scsi0",
        f"{storage}:{disk_size_gb},format={disk_format}",
    ]


def qm_importdisk(vmid: int, image_path: str, storage: str, format: str = DEFAULT_DISK_FORMAT) -> list[str]:
    return ["qm", "importdisk", str(vmid), image_path, storage, "--format", format]


def qm_set_disk(vmid: int, disk_name: str, volid: str) -> list[str]:
    return ["qm", "set", str(vmid), f"--{disk_name}", volid]


def qm_resize(vmid: int, disk_name: str, size_gb: int) -> list[str]:
    return ["qm", "disk", "resize", str(vmid), disk_name, f"+{size_gb}G"]


def pvesm_status() -> list[str]:
    return ["pvesm", "status"]


def pvesm_list(storage: str) -> list[str]:
    return ["pvesm", "list", storage, "--output-format", "json"]


def pvesm_path(volid: str) -> list[str]:
    return ["pvesm", "path", volid]


def qemu_img_create(
    path: str,
    size_gb: int,
    fmt: str = DEFAULT_DISK_FORMAT,
) -> list[str]:
    return ["qemu-img", "create", "-f", fmt, path, f"{size_gb}G"]


def qemu_img_resize(path: str, size_gb: int, shrink: bool = False) -> list[str]:
    cmd = ["qemu-img", "resize"]
    if shrink:
        cmd.append("--shrink")
    cmd.extend([path, f"{size_gb}G"])
    return cmd


def qemu_img_convert(
    src: str,
    dst: str,
    src_fmt: str = "raw",
    dst_fmt: str = DEFAULT_DISK_FORMAT,
) -> list[str]:
    return [
        "qemu-img",
        "convert",
        "-f",
        src_fmt,
        "-O",
        dst_fmt,
        src,
        dst,
    ]


def qemu_img_info(path: str) -> list[str]:
    return ["qemu-img", "info", "--output", "json", path]


def rsync_rootfs(
    src_root: str,
    dst_root: str,
    exclude_paths: list[str] | None = None,
    delete: bool = True,
) -> list[str]:
    exclude_paths = exclude_paths or []
    cmd = [
        "rsync",
        "-aHAX",
        "--sparse",
        "--info=progress2",
    ]
    if delete:
        cmd.append("--delete")
    for path in exclude_paths:
        cmd.extend(["--exclude", path])
    cmd.extend([f"{src_root.rstrip('/')}/", f"{dst_root.rstrip('/')}/"])
    return cmd


def parted_mklabel(path: str, label: str = "gpt") -> list[str]:
    return ["parted", "-s", path, "mklabel", label]


def parted_mkpart(
    path: str,
    part_type: str,
    fs_type: str,
    start: str,
    end: str,
) -> list[str]:
    return ["parted", "-s", path, "mkpart", part_type, fs_type, start, end]


def parted_set_flag(path: str, part_num: int, flag: str, on_off: str) -> list[str]:
    return ["parted", "-s", path, "set", str(part_num), flag, on_off]


def losetup_find() -> list[str]:
    return ["losetup", "-f"]


def losetup_attach(path: str) -> list[str]:
    return ["losetup", "-f", "--show", path]


def losetup_detach(device: str) -> list[str]:
    return ["losetup", "-d", device]


def kpartx_add(device: str) -> list[str]:
    return ["kpartx", "-av", device]


def kpartx_del(device: str) -> list[str]:
    return ["kpartx", "-dv", device]


def mkfs_ext4(device: str, label: str = "") -> list[str]:
    cmd = ["mkfs.ext4", "-F"]
    if label:
        cmd.extend(["-L", label])
    cmd.append(device)
    return cmd


def e2fsck(device: str, force: bool = False) -> list[str]:
    cmd = ["e2fsck", "-f", "-y"]
    if force:
        cmd.append("-f")
    cmd.append(device)
    return cmd


def resize2fs(device: str) -> list[str]:
    return ["resize2fs", device]


def vgs_free(vg_name: str) -> list[str]:
    return [
        "vgs",
        "--noheadings",
        "--units",
        "m",
        "-o",
        "vg_free",
        vg_name,
    ]


def zfs_list_available(dataset: str) -> list[str]:
    return ["zfs", "list", "-H", "-o", "available", dataset]


def df_free_kb(path: str) -> list[str]:
    return ["df", "-k", path]


def virt_inspector(disk_path: str, img_format: str = "raw") -> list[str]:
    return [
        "virt-inspector",
        "--format",
        img_format,
        "-a",
        disk_path,
    ]


def fdisk_list(disk_path: str) -> list[str]:
    return ["fdisk", "-l", disk_path]


def file_disk_signature(disk_path: str) -> list[str]:
    return ["file", "-sL", disk_path]


def command_to_shell(cmd: list[str]) -> str:
    """Convert an argument list into a single shell-escaped command string.

    Only use this when a shell string is unavoidable (e.g., for SSH exec).
    """
    return " ".join(shlex.quote(str(arg)) for arg in cmd)


def chroot_script(chroot_path: str, inner_script: str) -> str:
    """Return a shell string that chroots into a path and runs an inner script."""
    safe_path = _quote(chroot_path)
    safe_inner = sanitize_shell_arg(inner_script)
    return f"chroot {safe_path} /bin/bash -c '{safe_inner}'"


def guestfish_inspect(disk_path: str) -> list[str]:
    """Use guestfish to list filesystems when virt-inspector is unavailable."""
    return ["guestfish", "-a", disk_path, "run", ": list-filesystems"]
