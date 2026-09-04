# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/converter/flows/vm_to_lxc.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Convert a Proxmox QEMU/KVM virtual machine into an LXC...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Convert a Proxmox QEMU/KVM virtual machine into an LXC container.
"""

from __future__ import annotations

import contextlib
import logging

from ProxmoxVEx.converter import commands as cmd
from ProxmoxVEx.converter.constants import MIN_DISK_GB
from ProxmoxVEx.converter.models import ConversionJob
from ProxmoxVEx.converter.os_detect import detect_os_from_disk
from ProxmoxVEx.converter.runner import NodeRunner


def run_vm_to_lxc(job: ConversionJob, runner: NodeRunner, target_runner: NodeRunner, engine) -> None:
    """Execute the VM -> LXC conversion flow."""
    if job.source is None:
        raise RuntimeError("VM to LXC conversion requires a source VM")
    if job.target is None:
        raise RuntimeError("VM to LXC conversion requires a target CT ID")
    source_id = job.source.id
    target_id = job.target.id

    storage = job.target_storage or "local-lvm"
    temp_dir = f"/var/lib/vz/dump/converter-{job.id}"
    image_path = f"{temp_dir}/disk-{source_id}.raw"

    try:
        engine.set_phase(job, "stopping_source", progress=5)
        runner.run(cmd.qm_stop(source_id), timeout=60)

        engine.set_phase(job, "detecting_os", progress=10)
        _ensure_temp_dir(runner, temp_dir)
        disk_volid = _get_primary_disk_volid(runner, source_id)
        if not disk_volid:
            raise RuntimeError(f"Could not determine primary disk for VM {source_id}")

        disk_path = _resolve_volid_path(runner, disk_volid)
        detected = detect_os_from_disk(runner, disk_path)
        job.detected_os = detected
        engine._persist_job(job)

        if detected.os_type == "windows":
            raise RuntimeError("Windows guests cannot be converted to LXC containers")

        engine.set_phase(job, "exporting_disk", progress=20)
        _export_vm_disk(runner, disk_path, image_path)

        target_size_gb = _calculate_target_disk_gb(runner, job, image_path)
        template = _select_lxc_template(runner, detected)

        engine.set_phase(job, "creating_container", progress=40)
        _create_lxc_container(runner, target_id, storage, target_size_gb, template, job)

        engine.set_phase(job, "copying_rootfs", progress=55)
        _rsync_from_image_to_container(runner, image_path, target_id)

        engine.set_phase(job, "configuring_container", progress=80)
        _configure_container_network(runner, target_id, detected)

        if job.auto_start:
            engine.set_phase(job, "starting_container", progress=95)
            runner.run(["pct", "start", str(target_id)], timeout=30)

        if job.destroy_source:
            engine.set_phase(job, "destroying_source", progress=98)
            runner.run(cmd.qm_stop(source_id), timeout=30)
            runner.run(
                cmd.qm_destroy(source_id, destroy_unreferenced_disks=True, purge=True),
                timeout=60,
            )

        engine.set_phase(job, "completed", progress=100)
        engine.mark_succeeded(job)

    except Exception:
        logging.exception("VM to LXC conversion failed for job %s", job.id)
        if job.rollback_on_failure and job.target:
            from ProxmoxVEx.converter.rollback import destroy_target_if_exists

            destroy_target_if_exists(job, runner)
        raise
    finally:
        runner.run(["rm", "-rf", temp_dir], timeout=60)


def _ensure_temp_dir(runner: NodeRunner, temp_dir: str) -> None:
    runner.run(["mkdir", "-p", temp_dir], timeout=10)


def _get_primary_disk_volid(runner: NodeRunner, vmid: int) -> str | None:
    result = runner.run(cmd.qm_config(vmid), timeout=15)
    if not result.ok:
        return None
    for line in result.stdout.splitlines():
        for prefix in ("scsi0:", "ide0:", "sata0:", "virtio0:"):
            if line.startswith(prefix):
                return line.split(":", 1)[1].strip().split(",")[0].strip()
    return None


def _resolve_volid_path(runner: NodeRunner, volid: str) -> str:
    result = runner.run(cmd.pvesm_path(volid), timeout=15)
    if result.ok:
        return result.stdout.strip()
    return volid


def _export_vm_disk(runner: NodeRunner, disk_path: str, image_path: str) -> None:
    """Convert the VM disk to a raw image using qemu-img."""
    fmt = "qcow2" if disk_path.endswith((".qcow2", ".qcow2")) else "raw"
    result = runner.run(cmd.qemu_img_convert(disk_path, image_path, src_fmt=fmt, dst_fmt="raw"), timeout=600)
    if not result.ok:
        raise RuntimeError(f"Failed to export VM disk: {result.stderr}")


def _calculate_target_disk_gb(runner: NodeRunner, job: ConversionJob, image_path: str) -> int:
    if job.target_disk_size_gb:
        return max(MIN_DISK_GB, job.target_disk_size_gb)

    result = runner.run(cmd.qemu_img_info(image_path), timeout=15)
    if result.ok:
        with contextlib.suppress(Exception):
            import json

            info = json.loads(result.stdout)
            virtual_size = info.get("virtual-size", 0)
            return max(MIN_DISK_GB, virtual_size // (1024**3) + job.headroom_gb)
    return 8


def _select_lxc_template(runner: NodeRunner, detected_os) -> str:
    """Pick a best-effort LXC template based on detected distro."""
    distro = detected_os.distro
    templates = {
        "debian": "debian-12-standard_12_amd64.tar.zst",
        "ubuntu": "ubuntu-22.04-standard_22.04.1-1_amd64.tar.zst",
        "alpine": "alpine-3.19-default_3.19.0_amd64.tar.zst",
        "rocky": "rockylinux-9-default_9.2_amd64.tar.zst",
        "centos": "centos-9-stream-default_9-latest_amd64.tar.zst",
        "almalinux": "almalinux-9-default_9.2_amd64.tar.zst",
        "fedora": "fedora-39-default_20240112_amd64.tar.zst",
        "arch": "archlinux-base_20240101-1_amd64.tar.zst",
    }
    return templates.get(distro, "debian-12-standard_12_amd64.tar.zst")


def _create_lxc_container(
    runner: NodeRunner,
    ctid: int,
    storage: str,
    size_gb: int,
    template: str,
    job: ConversionJob,
) -> None:
    """Create the target LXC container with the selected template."""
    bridge = job.target_bridge or "vmbr0"
    result = runner.run(
        [
            "pct",
            "create",
            str(ctid),
            f"{storage}:{size_gb}",
            template,
            "--features",
            "nesting=1",
            "--net0",
            f"name=eth0,bridge={bridge},ip=dhcp",
            "--start",
            "0",
        ],
        timeout=120,
    )
    if not result.ok:
        raise RuntimeError(f"Failed to create LXC container: {result.stderr}")


def _rsync_from_image_to_container(runner: NodeRunner, image_path: str, ctid: int) -> None:
    """Mount the exported image and rsync its rootfs into the container rootfs."""
    temp_dir = f"/var/lib/vz/dump/converter-rsync-{ctid}"
    runner.run(["mkdir", "-p", temp_dir], timeout=10)
    try:
        loop_result = runner.run(cmd.losetup_attach(image_path), timeout=30)
        if not loop_result.ok or not loop_result.stdout.strip():
            raise RuntimeError(f"Failed to attach loop device: {loop_result.stderr}")
        loop_device = loop_result.stdout.strip().split()[0]

        runner.run(["partprobe", loop_device], timeout=15)
        root_part = f"{loop_device}p1"
        mount_point = f"{temp_dir}/mnt"
        runner.run(["mkdir", "-p", mount_point], timeout=10)
        mount_result = runner.run(["mount", root_part, mount_point], timeout=15)
        if not mount_result.ok:
            # Try whole disk (no partitions)
            mount_result = runner.run(["mount", loop_device, mount_point], timeout=15)
            if not mount_result.ok:
                runner.run(cmd.losetup_detach(loop_device), timeout=10)
                raise RuntimeError(f"Could not mount exported disk: {mount_result.stderr}")

        try:
            target_rootfs = f"/var/lib/lxc/{ctid}/rootfs"
            exclude = ["/proc", "/sys", "/dev", "/run", "/boot", "/tmp"]  # nosec: B108 - rsync rootfs exclude list, not a temp file
            result = runner.run(cmd.rsync_rootfs(mount_point, target_rootfs, exclude_paths=exclude), timeout=600)
            if not result.ok:
                raise RuntimeError(f"Failed to copy rootfs into container: {result.stderr}")
        finally:
            runner.run(["umount", "-R", mount_point], timeout=15)
            runner.run(cmd.losetup_detach(loop_device), timeout=10)
    finally:
        runner.run(["rm", "-rf", temp_dir], timeout=30)


def _configure_container_network(runner: NodeRunner, ctid: int, detected_os) -> None:
    """Write a DHCP-on-eth0 network config inside the container rootfs."""
    rootfs = f"/var/lib/lxc/{ctid}/rootfs"
    interfaces_path = f"{rootfs}/etc/network/interfaces"
    if detected_os.distro in ("debian", "ubuntu"):
        config = """auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp
"""
        runner.run(["bash", "-c", f"cat > {interfaces_path} <<'EOF'\n{config}\nEOF"], timeout=10)
    # Alpine uses /etc/network/interfaces too, but its networking stack is busybox-based.
    # For RHEL/Fedora/etc., NetworkManager defaults usually handle DHCP on eth0 automatically.
