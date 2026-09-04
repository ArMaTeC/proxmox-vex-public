# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/converter/preflight.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Pre-flight validation checks for conversion/resize jobs.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Pre-flight validation checks for conversion/resize jobs.
"""

from __future__ import annotations

import json
import re

from ProxmoxVEx.converter.commands import pvesm_list, pvesm_path, pvesm_status
from ProxmoxVEx.converter.constants import (
    REQUIRED_CONVERSION_TOOLS,
    REQUIRED_RESIZE_TOOLS,
    JobOperation,
    WorkloadType,
)
from ProxmoxVEx.converter.models import PreFlightCheck, PreFlightReport, WorkloadRef
from ProxmoxVEx.converter.os_detect import is_distro_supported
from ProxmoxVEx.converter.runner import NodeRunner

# Map from the binary name the converter needs to the Debian/Ubuntu package
# that provides it, so the UI can show an exact install command.
_TOOL_PACKAGES = {
    "parted": "parted",
    "kpartx": "kpartx",
    "rsync": "rsync",
    "qemu-img": "qemu-utils",
    "e2fsck": "e2fsprogs",
    "resize2fs": "e2fsprogs",
}


def _packages_for_tools(missing: list[str]) -> list[str]:
    """Return the unique packages needed to provide a list of missing tools."""
    packages = []
    seen = set()
    for tool in missing:
        pkg = _TOOL_PACKAGES.get(tool, tool)
        if pkg and pkg not in seen:
            packages.append(pkg)
            seen.add(pkg)
    return packages


def run_preflight(job_id: str, runner: NodeRunner, payload: dict, dry_run: bool = True) -> PreFlightReport:
    """Run all pre-flight checks for a converter job.

    Args:
        job_id: UUID of the associated conversion job.
        runner: NodeRunner for the source node.
        payload: Normalized job payload from validators.validate_job_payload.
        dry_run: If True, no cluster mutations will be made.

    Returns:
        PreFlightReport containing all check results.
    """
    report = PreFlightReport(job_id=job_id)
    operation = payload["operation"]
    if isinstance(operation, str):
        operation = JobOperation(operation)
    source_type = payload["source_type"]
    if isinstance(source_type, str):
        source_type = WorkloadType(source_type)
    source = WorkloadRef(
        cluster_id=payload["source_cluster_id"],
        node=payload["source_node"],
        type=source_type,
        id=payload["source_id"],
    )
    target = None
    if "target_type" in payload and "target_id" in payload:
        target_type = payload["target_type"]
        if isinstance(target_type, str):
            target_type = WorkloadType(target_type)
        target = WorkloadRef(
            cluster_id=payload.get("target_cluster_id", source.cluster_id),
            node=payload.get("target_node", source.node),
            type=target_type,
            id=payload["target_id"],
        )

    report.checks.extend(_check_source_exists(runner, source))
    if target is not None:
        report.checks.extend(_check_target_collision(runner, target, payload.get("replace_target", False)))

    if "target_storage" in payload:
        report.checks.extend(_check_target_storage(runner, payload["target_storage"]))
        if not dry_run and target is not None and "target_disk_size_gb" in payload:
            report.checks.extend(
                _check_target_space(
                    runner,
                    payload["target_storage"],
                    payload["target_disk_size_gb"],
                    operation.value,
                )
            )

    report.checks.extend(_check_required_tools(runner, operation))

    if operation in (JobOperation.LXC_TO_VM, JobOperation.VM_TO_LXC):
        report.checks.extend(_check_os_support(runner, source, operation))

    return report


def _check_source_exists(runner: NodeRunner, source: WorkloadRef) -> list[PreFlightCheck]:
    from ProxmoxVEx.converter import commands as cmd

    config_cmd = cmd.pct_config(source.id) if source.type.value == "lxc" else cmd.qm_config(source.id)
    result = runner.run(config_cmd, timeout=15)
    if result.ok:
        return [
            PreFlightCheck(
                name="source_exists",
                category="id",
                passed=True,
                message=f"Source {source.type.value} {source.id} exists.",
            )
        ]
    if source.type.value == "lxc":
        verify_cmds = [
            f"pct config {source.id}",
            f"pct status {source.id}",
        ]
    else:
        verify_cmds = [
            f"qm config {source.id}",
            f"qm status {source.id}",
        ]
    return [
        PreFlightCheck(
            name="source_exists",
            category="id",
            passed=False,
            required=True,
            message=f"Source {source.type.value} {source.id} not found.",
            reason="The source workload does not exist or is unreachable.",
            fix=f"Verify the source ID and that the {source.type.value} is registered on node {source.node}.",
            fix_commands=verify_cmds,
        )
    ]


def _check_target_collision(runner: NodeRunner, target: WorkloadRef, replace_target: bool) -> list[PreFlightCheck]:
    from ProxmoxVEx.converter import commands as cmd

    config_cmd = cmd.pct_config(target.id) if target.type.value == "lxc" else cmd.qm_config(target.id)
    result = runner.run(config_cmd, timeout=15)
    exists = result.ok

    if not exists:
        return [
            PreFlightCheck(
                name="target_collision",
                category="id",
                passed=True,
                message=f"Target {target.type.value} {target.id} is available.",
            )
        ]

    if replace_target:
        return [
            PreFlightCheck(
                name="target_collision",
                category="id",
                passed=True,
                message=f"Target {target.type.value} {target.id} exists but will be replaced.",
            )
        ]

    if target.type.value == "lxc":
        remove_cmds = [
            f"pct stop {target.id}",
            f"pct destroy {target.id} --destroy-unreferenced-disks 1 --purge 1",
        ]
    else:
        remove_cmds = [
            f"qm stop {target.id}",
            f"qm destroy {target.id} --destroy-unreferenced-disks 1 --purge 1",
        ]
    return [
        PreFlightCheck(
            name="target_collision",
            category="id",
            passed=False,
            required=True,
            message=f"Target {target.type.value} {target.id} already exists.",
            reason="The target ID is already in use.",
            fix="Choose a different target ID, enable replace_target, or remove the existing workload.",
            fix_commands=remove_cmds,
        )
    ]


def _check_target_storage(runner: NodeRunner, storage: str) -> list[PreFlightCheck]:
    result = runner.run(pvesm_status(), timeout=15)
    if not result.ok:
        return [
            PreFlightCheck(
                name="target_storage_exists",
                category="storage",
                passed=False,
                required=True,
                message="Could not list storage backends.",
                reason="pvesm status failed on the node.",
                fix="Verify Proxmox storage services are running and accessible.",
                fix_commands=[
                    "systemctl status pvedaemon pvestatd",
                    "pvesm status",
                    "journalctl -u pvedaemon -n 50",
                ],
            )
        ]

    for line in result.stdout.splitlines()[1:]:
        parts = line.split()
        if parts and parts[0] == storage:
            return [
                PreFlightCheck(
                    name="target_storage_exists",
                    category="storage",
                    passed=True,
                    message=f"Storage '{storage}' is available.",
                )
            ]

    return [
        PreFlightCheck(
            name="target_storage_exists",
            category="storage",
            passed=False,
            required=True,
            message=f"Storage '{storage}' not found.",
            reason="The configured target storage does not exist on the node.",
            fix="Choose an existing storage backend from 'pvesm status'.",
            fix_commands=[
                "pvesm status",
                f"pvesm list {storage} --output-format json",
            ],
        )
    ]


def _check_target_space(runner: NodeRunner, storage: str, required_gb: int, operation: str) -> list[PreFlightCheck]:
    """Check that the target storage has enough free space."""
    result = runner.run(pvesm_status(), timeout=15)
    if not result.ok:
        return [
            PreFlightCheck(
                name="target_storage_space",
                category="storage",
                passed=False,
                required=True,
                message="Could not determine storage free space.",
                reason="pvesm status failed.",
                fix="Verify storage services are healthy.",
                fix_commands=[
                    "systemctl status pvedaemon pvestatd",
                    "pvesm status",
                ],
            )
        ]

    storage_type = ""
    for line in result.stdout.splitlines()[1:]:
        parts = line.split()
        if parts and parts[0] == storage and len(parts) >= 2:
            storage_type = parts[1]
            break

    free_gb = _get_storage_free_gb(runner, storage, storage_type)
    if free_gb is None:
        return [
            PreFlightCheck(
                name="target_storage_space",
                category="storage",
                passed=False,
                required=True,
                message=f"Could not determine free space for storage '{storage}'.",
                reason="Storage backend type could not be queried.",
                fix="Verify the storage backend is healthy and accessible.",
                fix_commands=[
                    f"pvesm list {storage} --output-format json",
                    "df -h",
                ],
            )
        ]

    if free_gb < required_gb:
        return [
            PreFlightCheck(
                name="target_storage_space",
                category="storage",
                passed=False,
                required=True,
                message=f"Insufficient free space on '{storage}': {free_gb}GB available, {required_gb}GB required.",
                reason="Target storage does not have enough free space.",
                fix="Free up space, choose a different storage, or reduce the target disk size.",
                fix_commands=[
                    "pvesm status",
                    "df -h",
                    "vgs",
                ],
            )
        ]

    return [
        PreFlightCheck(
            name="target_storage_space",
            category="storage",
            passed=True,
            message=f"Storage '{storage}' has {free_gb}GB free (required: {required_gb}GB).",
        )
    ]


def _get_storage_free_gb(runner: NodeRunner, storage: str, storage_type: str) -> int | None:
    from ProxmoxVEx.converter import commands as cmd

    if storage_type in ("lvm", "lvmthin"):
        # Derive VG from first volume on the storage
        volid = _get_first_volid(runner, storage)
        vg = None
        if volid:
            path_result = runner.run(pvesm_path(volid), timeout=10)
            if path_result.ok:
                parts = path_result.stdout.strip().split("/")
                if len(parts) >= 4:
                    vg = parts[3]
        if not vg:
            vgs_result = runner.run(["vgs", "--noheadings", "-o", "vg_name"], timeout=10)
            if vgs_result.ok:
                vg = vgs_result.stdout.strip().split("\n")[0].strip()
        if vg:
            free_result = runner.run(cmd.vgs_free(vg), timeout=10)
            if free_result.ok:
                try:
                    mb = float(re.sub(r"[^0-9.]", "", free_result.stdout.strip().split()[0]))
                    return int(mb / 1024)
                except (ValueError, IndexError):
                    pass
        return None

    if storage_type == "zfspool":
        volid = _get_first_volid(runner, storage)
        dataset = None
        if volid:
            path_result = runner.run(pvesm_path(volid), timeout=10)
            if path_result.ok:
                path = path_result.stdout.strip().replace("/dev/zd0", "")
                dataset = path.strip("/")
        if dataset:
            avail_result = runner.run(cmd.zfs_list_available(dataset), timeout=10)
            if avail_result.ok:
                try:
                    avail = avail_result.stdout.strip().split()[0]
                    # Convert human-readable ZFS size to GB
                    return _parse_size_to_gb(avail)
                except (ValueError, IndexError):
                    pass
        return None

    if storage_type in ("dir", "nfs", "cifs", "glusterfs"):
        volid = _get_first_volid(runner, storage)
        mount_path: str | None = None
        if volid:
            path_result = runner.run(pvesm_path(volid), timeout=10)
            if path_result.ok:
                mount_path = path_result.stdout.strip().rsplit("/", 1)[0]
        if not mount_path:
            for line in runner.run(pvesm_status(), timeout=10).stdout.splitlines()[1:]:
                parts = line.split()
                if parts and parts[0] == storage and len(parts) >= 7:
                    mount_path = parts[6]
                    break
        if mount_path:
            df_result = runner.run(cmd.df_free_kb(mount_path), timeout=10)
            if df_result.ok:
                lines = df_result.stdout.strip().splitlines()
                if len(lines) >= 2:
                    try:
                        kb = int(lines[1].split()[3])
                        return kb // 1024 // 1024
                    except (ValueError, IndexError):
                        pass
        return None

    return None


def _get_first_volid(runner: NodeRunner, storage: str) -> str | None:
    result = runner.run(pvesm_list(storage), timeout=15)
    if not result.ok or not result.stdout.strip():
        return None
    try:
        data = json.loads(result.stdout)
        if data:
            first = data[0]
            return first.get("volid") or first.get("volid", "")
    except json.JSONDecodeError:
        # Fallback for text output
        for line in result.stdout.splitlines()[1:]:
            parts = line.split()
            if parts and ":" in parts[0]:
                return parts[0]
    return None


def _parse_size_to_gb(size_str: str) -> int | None:
    """Parse a size string like '45.3G' or '1024M' into GB."""
    size_str = size_str.strip().replace(",", "")
    match = re.match(r"^([0-9.]+)([KMGTPE]?)(i?)(B?)$", size_str, re.IGNORECASE)
    if not match:
        return None
    value = float(match.group(1))
    unit = match.group(2).upper() or "B"
    multiplier = {
        "B": 1 / (1024**3),
        "K": 1 / (1024**2),
        "M": 1 / 1024,
        "G": 1,
        "T": 1024,
        "P": 1024**2,
        "E": 1024**3,
    }.get(unit, 1)
    return int(value * multiplier)


def _check_required_tools(runner: NodeRunner, operation: JobOperation) -> list[PreFlightCheck]:
    if operation in (JobOperation.LXC_TO_VM, JobOperation.VM_TO_LXC):
        tools = REQUIRED_CONVERSION_TOOLS
    else:
        tools = REQUIRED_RESIZE_TOOLS

    missing = []
    for tool in tools:
        result = runner.run(["command", "-v", tool], timeout=10)
        if not result.ok or not result.stdout.strip():
            missing.append(tool)

    if missing:
        packages = _packages_for_tools(missing)
        install_cmd = f"apt-get update && apt-get install -y {' '.join(packages)}"
        return [
            PreFlightCheck(
                name="required_tools",
                category="tools",
                passed=False,
                required=True,
                message=f"Missing required tools: {', '.join(missing)}.",
                reason="One or more required host tools are not installed.",
                fix=f"Install the missing packages on the Proxmox node: {', '.join(missing)}.",
                fix_commands=[install_cmd],
                auto_fix=True,
            )
        ]

    return [
        PreFlightCheck(
            name="required_tools",
            category="tools",
            passed=True,
            message="All required host tools are available.",
        )
    ]


def _check_os_support(runner: NodeRunner, source: WorkloadRef, operation: JobOperation) -> list[PreFlightCheck]:
    """Check that the detected guest OS is supported for conversion.

    For LXC->VM we inspect the container rootfs directly. For VM->LXC we
    inspect the primary VM disk. This is a lightweight check; the full OS
    detection happens during the running phase.
    """
    from ProxmoxVEx.converter import commands as cmd

    if source.type.value == "lxc":
        mount_result = runner.run(cmd.pct_mount(source.id), timeout=30)
        if not mount_result.ok:
            return [
                PreFlightCheck(
                    name="os_support",
                    category="tools",
                    passed=False,
                    required=True,
                    message="Could not mount source container for OS detection.",
                    reason="The container may be locked or its storage backend unavailable.",
                    fix="Run 'pct status' and 'pct unlock' on the source container, then retry.",
                    fix_commands=[
                        f"pct status {source.id}",
                        f"pct unlock {source.id}",
                    ],
                )
            ]
        rootfs = f"/var/lib/lxc/{source.id}/rootfs"
        os_release_path = f"{rootfs}/etc/os-release"
        result = runner.run(["cat", os_release_path], timeout=10)
        runner.run(cmd.pct_unmount(source.id), timeout=10)
        os_info = result.stdout if result.ok else ""
        distro = _parse_os_release(os_info)
    else:
        # VM: try to detect from the disk image.
        # We defer full detection to the running phase; here we just check
        # whether the disk is reachable.
        result = runner.run(cmd.qm_config(source.id), timeout=15)
        distro = "unknown"
        if result.ok:
            for line in result.stdout.splitlines():
                if line.startswith("scsi0:") or line.startswith("ide0:") or line.startswith("sata0:"):
                    # Disk exists; mark as detectable.
                    distro = "detectable"
                    break

    if operation.value == "vm_to_lxc" and distro == "windows":
        return [
            PreFlightCheck(
                name="os_support",
                category="tools",
                passed=False,
                required=True,
                message="Windows cannot be converted to an LXC container.",
                reason="LXC is Linux-only by design.",
                fix="Use VM disk shrink/expand or clone-replace operations for Windows workloads.",
                fix_commands=[
                    f"qm config {source.id}",
                    "pvesh get /nodes/localhost/qemu",
                ],
            )
        ]

    if distro == "unknown":
        if source.type.value == "lxc":
            inspect_cmds = [
                f"pct mount {source.id}",
                f"cat /var/lib/lxc/{source.id}/rootfs/etc/os-release",
            ]
        else:
            inspect_cmds = [f"qm config {source.id}"]
        return [
            PreFlightCheck(
                name="os_support",
                category="tools",
                passed=False,
                required=False,
                message="Could not detect guest OS; conversion will be attempted but may fail.",
                reason="OS detection requires a mounted rootfs or accessible boot disk.",
                fix="Ensure the container rootfs is readable or the VM disk is present.",
                fix_commands=inspect_cmds,
            )
        ]

    if operation.value in ("lxc_to_vm", "vm_to_lxc") and not is_distro_supported(distro, operation.value):
        return [
            PreFlightCheck(
                name="os_support",
                category="tools",
                passed=False,
                required=True,
                message=f"Detected distro '{distro}' is not supported for {operation.value}.",
                reason="The guest OS is not in the supported conversion list.",
                fix="Convert manually or contact support for this distro.",
                fix_commands=[
                    f"cat /var/lib/lxc/{source.id}/rootfs/etc/os-release",
                    f"qm config {source.id}",
                ],
            )
        ]

    return [
        PreFlightCheck(
            name="os_support",
            category="tools",
            passed=True,
            message=f"Detected distro '{distro}' is supported for {operation.value}.",
        )
    ]


def _parse_os_release(content: str) -> str:
    """Parse /etc/os-release content and return the distro ID."""
    for line in content.splitlines():
        if line.startswith("ID="):
            return line.split("=", 1)[1].strip().strip('"').lower()
    return "unknown"
