# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/converter/flows/lxc_to_vm.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Convert a Proxmox LXC container into a bootable...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Convert a Proxmox LXC container into a bootable QEMU/KVM virtual machine.
"""

from __future__ import annotations

import contextlib
import logging

from ProxmoxVEx.converter import commands as cmd
from ProxmoxVEx.converter.constants import DEFAULT_BIOS, DEFAULT_BRIDGE, DEFAULT_DISK_FORMAT, MIN_DISK_GB
from ProxmoxVEx.converter.models import ConversionJob
from ProxmoxVEx.converter.os_detect import detect_os_from_disk, recommended_kernel_packages
from ProxmoxVEx.converter.runner import NodeRunner


def run_lxc_to_vm(job: ConversionJob, runner: NodeRunner, target_runner: NodeRunner, engine) -> None:
    """Execute the LXC -> VM conversion flow.

    Steps:
      1. Detect source container OS.
      2. Stop the container.
      3. Mount container rootfs.
      4. Create a raw/qcow2 disk image sized to target.
      5. Partition, format, and mount the image.
      6. Rsync rootfs into the image.
      7. Install bootloader/kernel inside a chroot.
      8. Unmount and import disk into the new VM.
      9. Create the VM and attach the disk.
     10. Optionally start the VM and destroy the source container.
    """
    if job.source is None:
        raise RuntimeError("LXC to VM conversion requires a source CT")
    if job.target is None:
        raise RuntimeError("LXC to VM conversion requires a target VM ID")
    source_id = job.source.id
    target_id = job.target.id

    storage = job.target_storage or "local-lvm"
    disk_format = job.target_disk_format or DEFAULT_DISK_FORMAT
    bridge = job.target_bridge or DEFAULT_BRIDGE
    bios = job.target_bios or DEFAULT_BIOS

    temp_dir = f"/var/lib/vz/dump/converter-{job.id}"
    image_path = f"{temp_dir}/disk-{source_id}.raw"

    try:
        engine.set_phase(job, "detecting_os", progress=5)
        _ensure_temp_dir(runner, temp_dir)

        # Mount container for inspection
        mount_result = runner.run(cmd.pct_mount(source_id), timeout=30)
        engine.log_command(job, mount_result, "mount_source")
        if not mount_result.ok:
            raise RuntimeError(f"Failed to mount source container {source_id}")

        rootfs_path = f"/var/lib/lxc/{source_id}/rootfs"
        detected = _detect_os_from_rootfs(runner, rootfs_path)
        job.detected_os = detected
        engine._persist_job(job)

        engine.set_phase(job, "stopping_source", progress=10)
        runner.run(cmd.pct_stop(source_id), timeout=60)

        # Determine disk size
        target_size_gb = _calculate_target_disk_gb(runner, job, rootfs_path)

        engine.set_phase(job, "creating_disk_image", progress=20)
        _create_disk_image(runner, image_path, target_size_gb)

        engine.set_phase(job, "preparing_filesystem", progress=30)
        loop_device = _setup_loop_device(runner, image_path)
        try:
            _partition_and_format(runner, loop_device)
            part_device = _map_partition(runner, loop_device)
            mount_point = f"{temp_dir}/mnt"
            _mount_target(runner, part_device, mount_point)
            try:
                engine.set_phase(job, "copying_rootfs", progress=40)
                _rsync_rootfs(runner, rootfs_path, mount_point)

                engine.set_phase(job, "installing_bootloader", progress=60)
                _install_bootloader(runner, mount_point, detected)

                engine.set_phase(job, "configuring_vm_network", progress=75)
                _configure_network(runner, mount_point, bridge, detected)
            finally:
                _umount_target(runner, mount_point)
        finally:
            _teardown_loop(runner, loop_device)

        engine.set_phase(job, "importing_disk", progress=85)
        _import_disk_to_vm(runner, job, image_path, storage, disk_format)

        engine.set_phase(job, "creating_vm", progress=90)
        _create_vm(runner, job, bridge, bios)

        if job.auto_start:
            engine.set_phase(job, "starting_vm", progress=95)
            runner.run(["qm", "start", str(target_id)], timeout=30)

        if job.destroy_source:
            engine.set_phase(job, "destroying_source", progress=98)
            runner.run(cmd.pct_stop(source_id), timeout=30)
            runner.run(
                cmd.pct_destroy(source_id, destroy_unreferenced_disks=True, purge=True),
                timeout=60,
            )

        engine.set_phase(job, "completed", progress=100)
        engine.mark_succeeded(job)

    except Exception:
        logging.exception("LXC to VM conversion failed for job %s", job.id)
        if job.rollback_on_failure and job.target:
            from ProxmoxVEx.converter.rollback import destroy_target_if_exists

            destroy_target_if_exists(job, runner)
        raise
    finally:
        # Best-effort cleanup of temp files
        runner.run(["rm", "-rf", temp_dir], timeout=60)
        runner.run(cmd.pct_unmount(source_id), timeout=30)


def _ensure_temp_dir(runner: NodeRunner, temp_dir: str) -> None:
    runner.run(["mkdir", "-p", temp_dir], timeout=10)


def _detect_os_from_rootfs(runner: NodeRunner, rootfs_path: str):
    """Detect OS by reading /etc/os-release from the mounted rootfs."""
    result = runner.run(["cat", f"{rootfs_path}/etc/os-release"], timeout=10)
    if not result.ok:
        return detect_os_from_disk(runner, rootfs_path)

    from ProxmoxVEx.converter.os_detect import _normalize_distro

    content = result.stdout
    os_type = "linux"
    distro = "unknown"
    version = ""
    for line in content.splitlines():
        if line.startswith("ID="):
            distro = _normalize_distro(line.split("=", 1)[1].strip().strip('"'))
        if line.startswith("VERSION_ID="):
            version = line.split("=", 1)[1].strip().strip('"')

    from ProxmoxVEx.converter.models import DetectedOS

    return DetectedOS(
        os_type=os_type,
        distro=distro,
        version=version,
        boot_mode="bios",
        partition_table="mbr",
    )


def _calculate_target_disk_gb(runner: NodeRunner, job: ConversionJob, rootfs_path: str) -> int:
    if job.target_disk_size_gb:
        return max(MIN_DISK_GB, job.target_disk_size_gb)

    # Auto-calculate: used space + headroom
    result = runner.run(["du", "-sb", rootfs_path], timeout=30)
    used_bytes = 0
    if result.ok:
        with contextlib.suppress(ValueError, IndexError):
            used_bytes = int(result.stdout.split()[0])
    used_gb = used_bytes // (1024**3)
    return max(MIN_DISK_GB, used_gb + job.headroom_gb)


def _create_disk_image(runner: NodeRunner, path: str, size_gb: int) -> None:
    result = runner.run(cmd.qemu_img_create(path, size_gb, "raw"), timeout=60)
    if not result.ok:
        raise RuntimeError(f"Failed to create disk image: {result.stderr}")


def _setup_loop_device(runner: NodeRunner, image_path: str) -> str:
    result = runner.run(cmd.losetup_attach(image_path), timeout=30)
    if not result.ok or not result.stdout.strip():
        raise RuntimeError(f"Failed to attach loop device: {result.stderr}")
    return result.stdout.strip().split()[0]


def _teardown_loop(runner: NodeRunner, loop_device: str) -> None:
    runner.run(cmd.losetup_detach(loop_device), timeout=30)


def _partition_and_format(runner: NodeRunner, loop_device: str) -> None:
    result = runner.run(cmd.parted_mklabel(loop_device, "msdos"), timeout=30)
    if not result.ok:
        raise RuntimeError(f"Failed to create partition table: {result.stderr}")

    result = runner.run(
        cmd.parted_mkpart(loop_device, "primary", "ext4", "1MiB", "100%"),
        timeout=30,
    )
    if not result.ok:
        raise RuntimeError(f"Failed to create partition: {result.stderr}")

    # Re-read partition table
    runner.run(["partprobe", loop_device], timeout=15)

    part_device = f"{loop_device}p1"
    runner.run(["mkfs.ext4", "-F", part_device], timeout=30)


def _map_partition(runner: NodeRunner, loop_device: str) -> str:
    runner.run(["partprobe", loop_device], timeout=15)
    return f"{loop_device}p1"


def _mount_target(runner: NodeRunner, part_device: str, mount_point: str) -> None:
    runner.run(["mkdir", "-p", mount_point], timeout=10)
    result = runner.run(["mount", part_device, mount_point], timeout=15)
    if not result.ok:
        raise RuntimeError(f"Failed to mount target partition: {result.stderr}")


def _umount_target(runner: NodeRunner, mount_point: str) -> None:
    runner.run(["umount", "-R", mount_point], timeout=15)
    runner.run(["umount", "-l", mount_point], timeout=5)


def _rsync_rootfs(runner: NodeRunner, source_root: str, target_root: str) -> None:
    exclude = ["/proc", "/sys", "/dev", "/run", "/boot", "/tmp"]  # nosec: B108 - rsync rootfs exclude list, not a temp file
    result = runner.run(cmd.rsync_rootfs(source_root, target_root, exclude_paths=exclude), timeout=600)
    if not result.ok:
        raise RuntimeError(f"Failed to copy rootfs: {result.stderr}")


def _install_bootloader(runner: NodeRunner, mount_point: str, detected_os) -> None:
    """Install kernel and bootloader inside the target chroot."""
    packages = recommended_kernel_packages(detected_os.distro)
    if not packages:
        logging.warning("No kernel packages known for distro '%s'; skipping bootloader install", detected_os.distro)
        return

    distro = detected_os.distro
    if distro in ("debian", "ubuntu"):
        _chroot_cmd = (
            f"apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y {' '.join(packages)} && "
            f"grub-install /dev/loop0 && update-grub"
        )
    elif distro in ("rocky", "centos", "rhel", "almalinux", "fedora"):
        _chroot_cmd = (
            f"dnf install -y {' '.join(packages)} && grub2-install /dev/loop0 && grub2-mkconfig -o /boot/grub2/grub.cfg"
        )
    elif distro == "alpine":
        _chroot_cmd = f"apk add {' '.join(packages)} && extlinux --install /boot"
    elif distro == "arch":
        _chroot_cmd = (
            f"pacman -Sy --noconfirm {' '.join(packages)} && "
            f"grub-install /dev/loop0 && grub-mkconfig -o /boot/grub/grub.cfg"
        )
    else:
        # Generic GRUB2 fallback for distros not in the explicit allow-list
        logging.warning(
            "Bootloader installation for distro '%s' not explicitly supported; trying generic GRUB2", distro
        )
        _chroot_cmd = (
            "(grub2-install /dev/loop0 || grub-install /dev/loop0) && "
            "(grub2-mkconfig -o /boot/grub2/grub.cfg || update-grub)"
        )

    script = cmd.chroot_script(mount_point, _chroot_cmd)
    result = runner.run(["bash", "-c", script], timeout=300)
    if not result.ok:
        raise RuntimeError(f"Failed to install bootloader: {result.stderr}")


def _configure_network(runner: NodeRunner, mount_point: str, bridge: str, detected_os) -> None:
    """Write a basic network config for the VM (virtio / ens18 -> eth0)."""
    interfaces_path = f"{mount_point}/etc/network/interfaces"
    if detected_os.distro in ("debian", "ubuntu"):
        config = """auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp
"""
        runner.run(["bash", "-c", f"cat > {interfaces_path} <<'EOF'\n{config}\nEOF"], timeout=10)
    # For other distros the network stack is usually handled by NetworkManager/systemd;
    # DHCP on the primary interface is the default after conversion.


def _import_disk_to_vm(
    runner: NodeRunner,
    job: ConversionJob,
    image_path: str,
    storage: str,
    disk_format: str,
) -> None:
    if job.target is None:
        raise RuntimeError("Cannot import disk without a target VM")
    target_id = job.target.id
    result = runner.run(cmd.qm_importdisk(target_id, image_path, storage, disk_format), timeout=600)
    if not result.ok:
        raise RuntimeError(f"Failed to import disk: {result.stderr}")


def _create_vm(runner: NodeRunner, job: ConversionJob, bridge: str, bios: str) -> None:
    if job.target is None:
        raise RuntimeError("Cannot create VM without a target workload")
    target_id = job.target.id
    # Determine the imported disk volid from qm config
    config_result = runner.run(cmd.qm_config(target_id), timeout=15)
    if not config_result.ok:
        raise RuntimeError(f"Could not read new VM config: {config_result.stderr}")

    disk_volid = None
    for line in config_result.stdout.splitlines():
        if line.startswith("unused0:"):
            disk_volid = line.split(":", 1)[1].strip().split(",")[0].strip()
            break

    if not disk_volid:
        raise RuntimeError("Could not find imported disk in VM config")

    # Attach the imported disk as scsi0 and remove the placeholder
    result = runner.run(cmd.qm_set_disk(target_id, "scsi0", disk_volid), timeout=30)
    if not result.ok:
        raise RuntimeError(f"Failed to attach imported disk: {result.stderr}")

    # Set boot disk and network
    runner.run(
        ["qm", "set", str(target_id), "--boot", "order=scsi0", "--net0", f"virtio,bridge={bridge}", "--bios", bios],
        timeout=30,
    )
