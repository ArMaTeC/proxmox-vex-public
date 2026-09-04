# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/converter/flows/clone_replace.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Clone a workload's primary disk to a new disk of the...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Clone a workload's primary disk to a new disk of the requested size, then swap
it into place (offline).
"""

from __future__ import annotations

import logging

from ProxmoxVEx.converter import commands as cmd
from ProxmoxVEx.converter.constants import DEFAULT_DISK_FORMAT, MIN_DISK_GB
from ProxmoxVEx.converter.models import ConversionJob
from ProxmoxVEx.converter.runner import NodeRunner


def run_clone_replace(job: ConversionJob, runner: NodeRunner, target_runner: NodeRunner, engine) -> None:
    """Clone the primary disk of an LXC container or VM to a new disk, then replace it."""
    if job.source is None:
        raise RuntimeError("Clone-replace requires a source workload")
    workload_id = job.source.id
    target_size_gb = job.target_disk_size_gb
    if not target_size_gb:
        raise RuntimeError("clone_replace_disk operation requires target_disk_size_gb")
    if target_size_gb < MIN_DISK_GB:
        raise RuntimeError(f"Target disk size must be at least {MIN_DISK_GB} GB")

    storage = job.target_storage or "local-lvm"
    disk_format = job.target_disk_format or DEFAULT_DISK_FORMAT
    temp_dir = f"/var/lib/vz/dump/converter-{job.id}"

    try:
        engine.set_phase(job, "stopping_workload", progress=5)
        if job.source.type.value == "lxc":
            runner.run(cmd.pct_stop(workload_id), timeout=60)
            _replace_lxc_rootfs(job, runner, engine, storage, target_size_gb)
        else:
            runner.run(cmd.qm_stop(workload_id), timeout=60)
            _replace_vm_disk(job, runner, engine, storage, target_size_gb, disk_format)

        if job.auto_start:
            engine.set_phase(job, "starting_workload", progress=95)
            if job.source.type.value == "lxc":
                runner.run(["pct", "start", str(workload_id)], timeout=30)
            else:
                runner.run(["qm", "start", str(workload_id)], timeout=30)

        engine.set_phase(job, "completed", progress=100)
        engine.mark_succeeded(job)
    except Exception:
        logging.exception("Clone-replace disk failed for job %s", job.id)
        raise
    finally:
        runner.run(["rm", "-rf", temp_dir], timeout=60)


def _replace_lxc_rootfs(
    job: ConversionJob,
    runner: NodeRunner,
    engine,
    storage: str,
    target_size_gb: int,
) -> None:
    """Replace an LXC container rootfs with a larger/smaller volume."""
    if job.source is None:
        raise RuntimeError("Clone-replace requires a source workload")
    ctid = job.source.id
    current_volid = _get_lxc_rootfs_volid(runner, ctid)
    if not current_volid:
        raise RuntimeError(f"Could not determine rootfs volume for CT {ctid}")

    engine.set_phase(job, "creating_new_volume", progress=25)
    new_volid = _create_lxc_rootfs_volume(runner, storage, ctid, target_size_gb)

    engine.set_phase(job, "copying_data", progress=45)
    _copy_lxc_rootfs(runner, ctid, current_volid, new_volid)

    engine.set_phase(job, "swapping_rootfs", progress=75)
    result = runner.run(
        ["pct", "set", str(ctid), "--rootfs", new_volid],
        timeout=30,
    )
    if not result.ok:
        raise RuntimeError(f"Failed to set new rootfs: {result.stderr}")

    if job.destroy_source:
        engine.set_phase(job, "removing_old_volume", progress=90)
        _remove_volid(runner, current_volid)


def _replace_vm_disk(
    job: ConversionJob,
    runner: NodeRunner,
    engine,
    storage: str,
    target_size_gb: int,
    disk_format: str,
) -> None:
    """Replace a VM primary disk with a resized copy."""
    if job.source is None:
        raise RuntimeError("Clone-replace requires a source workload")
    vmid = job.source.id
    disk_name, current_volid = _get_primary_vm_disk(runner, vmid)
    if not disk_name or not current_volid:
        raise RuntimeError(f"Could not determine primary disk for VM {vmid}")

    current_path = _resolve_volid_path(runner, current_volid)
    new_image = f"/var/lib/vz/dump/converter-{job.id}/new-disk-{vmid}.{disk_format}"

    engine.set_phase(job, "cloning_disk", progress=30)
    result = runner.run(
        cmd.qemu_img_convert(current_path, new_image, src_fmt="auto", dst_fmt=disk_format),
        timeout=600,
    )
    if not result.ok:
        raise RuntimeError(f"Failed to clone VM disk: {result.stderr}")

    # Resize if needed
    result = runner.run(cmd.qemu_img_info(new_image), timeout=15)
    if result.ok:
        try:
            import json

            info = json.loads(result.stdout)
            current_gb = info.get("virtual-size", 0) // (1024**3)
        except Exception:
            current_gb = 0
    else:
        current_gb = 0

    if current_gb != target_size_gb:
        engine.set_phase(job, "resizing_cloned_disk", progress=55)
        result = runner.run(
            cmd.qemu_img_resize(new_image, target_size_gb, shrink=target_size_gb < current_gb), timeout=300
        )
        if not result.ok:
            raise RuntimeError(f"Failed to resize cloned disk: {result.stderr}")

    engine.set_phase(job, "importing_new_disk", progress=75)
    result = runner.run(cmd.qm_importdisk(vmid, new_image, storage, disk_format), timeout=600)
    if not result.ok:
        raise RuntimeError(f"Failed to import new disk: {result.stderr}")

    # The new disk appears as unusedN; attach it as the primary disk.
    config_result = runner.run(cmd.qm_config(vmid), timeout=15)
    new_volid = None
    if config_result.ok:
        for line in config_result.stdout.splitlines():
            if line.startswith("unused"):
                new_volid = line.split(":", 1)[1].strip().split(",")[0].strip()
                break

    if not new_volid:
        raise RuntimeError("Could not find imported disk in VM config")

    result = runner.run(cmd.qm_set_disk(vmid, disk_name, new_volid), timeout=30)
    if not result.ok:
        raise RuntimeError(f"Failed to attach new disk as {disk_name}: {result.stderr}")

    if job.destroy_source:
        engine.set_phase(job, "removing_old_volume", progress=90)
        _remove_volid(runner, current_volid)


def _get_lxc_rootfs_volid(runner: NodeRunner, ctid: int) -> str | None:
    result = runner.run(cmd.pct_config(ctid), timeout=15)
    if not result.ok:
        return None
    for line in result.stdout.splitlines():
        if line.startswith("rootfs:"):
            return line.split(":", 1)[1].strip().split(",")[0].strip()
    return None


def _create_lxc_rootfs_volume(runner: NodeRunner, storage: str, ctid: int, size_gb: int) -> str:
    """Create a new LXC rootfs subvolume and return its volid."""
    # pct create-volume creates a volume but does not attach it.
    result = runner.run(
        ["pvesm", "alloc", storage, str(ctid), f"rootfs-new-{ctid}", f"{size_gb}G"],
        timeout=60,
    )
    if not result.ok:
        raise RuntimeError(f"Failed to allocate new rootfs volume: {result.stderr}")
    return f"{storage}:rootfs-new-{ctid}"


def _copy_lxc_rootfs(runner: NodeRunner, ctid: int, source_volid: str, target_volid: str) -> None:
    """Mount both rootfs volumes and rsync data from old to new."""
    temp_dir = f"/var/lib/vz/dump/converter-copy-{ctid}"
    runner.run(["mkdir", "-p", temp_dir], timeout=10)
    try:
        src_path = _resolve_volid_path(runner, source_volid)
        dst_path = _resolve_volid_path(runner, target_volid)

        src_mount = f"{temp_dir}/src"
        dst_mount = f"{temp_dir}/dst"
        runner.run(["mkdir", "-p", src_mount, dst_mount], timeout=10)

        result = runner.run(["mount", src_path, src_mount], timeout=15)
        if not result.ok:
            raise RuntimeError(f"Failed to mount source rootfs: {result.stderr}")
        try:
            result = runner.run(["mount", dst_path, dst_mount], timeout=15)
            if not result.ok:
                raise RuntimeError(f"Failed to mount target rootfs: {result.stderr}")
            try:
                exclude = ["/proc", "/sys", "/dev", "/run", "/boot", "/tmp"]  # nosec: B108 - rsync rootfs exclude list, not a temp file
                result = runner.run(cmd.rsync_rootfs(src_mount, dst_mount, exclude_paths=exclude), timeout=600)
                if not result.ok:
                    raise RuntimeError(f"Failed to copy rootfs data: {result.stderr}")
            finally:
                runner.run(["umount", "-R", dst_mount], timeout=15)
        finally:
            runner.run(["umount", "-R", src_mount], timeout=15)
    finally:
        runner.run(["rm", "-rf", temp_dir], timeout=30)


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


def _remove_volid(runner: NodeRunner, volid: str) -> None:
    result = runner.run(["pvesm", "remove", volid], timeout=60)
    if not result.ok:
        logging.warning("Could not remove old volume %s: %s", volid, result.stderr)
