# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/converter/flows/disk_resize.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Shrink/expand LXC and VM disks.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Shrink/expand LXC and VM disks.
"""

from __future__ import annotations

import json
import logging

from ProxmoxVEx.converter import commands as cmd
from ProxmoxVEx.converter.constants import JobOperation
from ProxmoxVEx.converter.models import ConversionJob
from ProxmoxVEx.converter.runner import NodeRunner


def run_disk_resize(job: ConversionJob, runner: NodeRunner, target_runner: NodeRunner, engine) -> None:
    """Execute disk shrink/expand for an LXC container or VM."""
    if job.source is None:
        raise RuntimeError("Disk resize requires a source workload")
    workload_id = job.source.id
    operation = job.operation

    engine.set_phase(job, "stopping_workload", progress=5)
    if job.source.type.value == "lxc":
        runner.run(cmd.pct_stop(workload_id), timeout=60)
    else:
        runner.run(cmd.qm_stop(workload_id), timeout=60)

    target_size_gb = job.target_disk_size_gb
    if not target_size_gb:
        raise RuntimeError("Disk resize operation requires target_disk_size_gb")

    try:
        if operation in (JobOperation.SHRINK_LXC, JobOperation.EXPAND_LXC):
            _resize_lxc_disk(job, runner, engine, target_size_gb)
        elif operation in (JobOperation.SHRINK_VM, JobOperation.EXPAND_VM):
            _resize_vm_disk(job, runner, engine, target_size_gb)
        else:
            raise RuntimeError(f"Unsupported resize operation: {operation}")

        engine.set_phase(job, "completed", progress=100)
        engine.mark_succeeded(job)
    except Exception:
        logging.exception("Disk resize failed for job %s", job.id)
        raise


def _resize_lxc_disk(job: ConversionJob, runner: NodeRunner, engine, target_size_gb: int) -> None:
    if job.source is None:
        raise RuntimeError("Disk resize requires a source workload")
    ctid = job.source.id

    if job.operation == JobOperation.EXPAND_LXC:
        engine.set_phase(job, "expanding_container_disk", progress=50)
        result = runner.run(
            ["pct", "resize", str(ctid), "rootfs", f"{target_size_gb}G"],
            timeout=120,
        )
        if not result.ok:
            raise RuntimeError(f"Failed to expand LXC disk: {result.stderr}")
        return

    # Shrink path: resize filesystem first, then shrink the volume.
    engine.set_phase(job, "shrinking_filesystem", progress=35)
    _shrink_lxc_filesystem(runner, ctid, target_size_gb)

    engine.set_phase(job, "shrinking_container_disk", progress=75)
    result = runner.run(
        ["pct", "resize", "--shrink", str(ctid), "rootfs", f"{target_size_gb}G"],
        timeout=120,
    )
    if not result.ok:
        raise RuntimeError(f"Failed to shrink LXC disk: {result.stderr}")


def _shrink_lxc_filesystem(runner: NodeRunner, ctid: int, target_size_gb: int) -> None:
    """Mount LXC rootfs, check and resize ext4 filesystem offline."""
    mount_result = runner.run(cmd.pct_mount(ctid), timeout=30)
    if not mount_result.ok:
        raise RuntimeError(f"Failed to mount container for filesystem shrink: {mount_result.stderr}")

    try:
        rootfs = f"/var/lib/lxc/{ctid}/rootfs"
        runner.run(["bash", "-c", f"umount {rootfs}/dev/null {rootfs}/proc {rootfs}/sys 2>/dev/null; true"], timeout=10)
        # Find the underlying block device for the container rootfs
        df_result = runner.run(["df", "-P", rootfs], timeout=10)
        device = None
        if df_result.ok:
            lines = df_result.stdout.strip().splitlines()
            if len(lines) >= 2:
                device = lines[1].split()[0]

        if not device:
            raise RuntimeError("Could not determine rootfs block device for shrink")

        # Force check and resize
        runner.run(["e2fsck", "-f", "-y", device], timeout=120)
        resize = runner.run(["resize2fs", device, f"{target_size_gb}G"], timeout=120)
        if not resize.ok:
            raise RuntimeError(f"Failed to resize filesystem: {resize.stderr}")
    finally:
        runner.run(cmd.pct_unmount(ctid), timeout=30)


def _resize_vm_disk(job: ConversionJob, runner: NodeRunner, engine, target_size_gb: int) -> None:
    if job.source is None:
        raise RuntimeError("Disk resize requires a source workload")
    vmid = job.source.id
    disk_name, volid = _get_primary_vm_disk(runner, vmid)
    if not disk_name or not volid:
        raise RuntimeError(f"Could not determine primary disk for VM {vmid}")

    disk_path = _resolve_volid_path(runner, volid)

    if job.operation == JobOperation.EXPAND_VM:
        engine.set_phase(job, "expanding_vm_disk", progress=50)
        current_gb = _get_disk_size_gb(runner, disk_path)
        delta_gb = target_size_gb - current_gb
        if delta_gb <= 0:
            raise RuntimeError(f"Target size {target_size_gb}GB is not larger than current size {current_gb}GB")
        result = runner.run(cmd.qm_resize(vmid, disk_name, delta_gb), timeout=120)
        if not result.ok:
            raise RuntimeError(f"Failed to expand VM disk: {result.stderr}")
        return

    # Shrink VM disk offline via qemu-img resize --shrink
    engine.set_phase(job, "shrinking_vm_disk", progress=50)
    runner.run(["qm", "set", str(vmid), f"--{disk_name}", "none,media=cdrom"], timeout=30)
    try:
        result = runner.run(cmd.qemu_img_resize(disk_path, target_size_gb, shrink=True), timeout=300)
        if not result.ok:
            raise RuntimeError(f"Failed to shrink VM disk image: {result.stderr}")
    finally:
        runner.run(cmd.qm_set_disk(vmid, disk_name, volid), timeout=30)


def _infer_lxc_storage(runner: NodeRunner, ctid: int) -> str:
    result = runner.run(cmd.pct_config(ctid), timeout=15)
    if result.ok:
        for line in result.stdout.splitlines():
            if line.startswith("rootfs:"):
                return line.split(":", 1)[1].strip().split(":")[0]
    return "local-lvm"


def _get_primary_vm_disk(runner: NodeRunner, vmid: int) -> tuple[str | None, str | None]:
    result = runner.run(cmd.qm_config(vmid), timeout=15)
    if not result.ok:
        return None, None
    for line in result.stdout.splitlines():
        for prefix in ("scsi0:", "ide0:", "sata0:", "virtio0:"):
            if line.startswith(prefix):
                disk_name = prefix.rstrip(":")
                volid = line.split(":", 1)[1].strip().split(",")[0].strip()
                return disk_name, volid
    return None, None


def _resolve_volid_path(runner: NodeRunner, volid: str) -> str:
    result = runner.run(cmd.pvesm_path(volid), timeout=15)
    if result.ok:
        return result.stdout.strip()
    return volid


def _get_disk_size_gb(runner: NodeRunner, disk_path: str) -> int:
    result = runner.run(cmd.qemu_img_info(disk_path), timeout=15)
    if result.ok:
        try:
            info = json.loads(result.stdout)
            return info.get("virtual-size", 0) // (1024**3)
        except json.JSONDecodeError:
            pass
    return 0
