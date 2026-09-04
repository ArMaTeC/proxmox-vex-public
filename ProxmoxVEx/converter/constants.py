# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/converter/constants.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Constants for the converter module.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Constants for the converter module.
No ProxmoxVEx imports allowed in this file.
"""

from enum import Enum

# Error codes aligned with the original lxc-to-vm shell scripts


class ConverterErrorCode(str, Enum):
    INVALID_ARG = "E_INVALID_ARG"
    NOT_FOUND = "E_NOT_FOUND"
    DISK_FULL = "E_DISK_FULL"
    PERMISSION = "E_PERMISSION"
    MIGRATION = "E_MIGRATION"
    CONVERSION = "E_CONVERSION"
    SHRINK_FAILED = "E_SHRINK_FAILED"
    EXPAND_FAILED = "E_EXPAND_FAILED"
    NO_SPACE = "E_NO_SPACE"
    NOT_SUPPORTED = "E_NOT_SUPPORTED"


class JobStatus(str, Enum):
    PENDING = "pending"
    VALIDATING = "validating"
    PREFLIGHT = "preflight"
    RUNNING = "running"
    PAUSED = "paused"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"
    CANCELLED = "cancelled"


class JobOperation(str, Enum):
    LXC_TO_VM = "lxc_to_vm"
    VM_TO_LXC = "vm_to_lxc"
    SHRINK_LXC = "shrink_lxc"
    EXPAND_LXC = "expand_lxc"
    SHRINK_VM = "shrink_vm"
    EXPAND_VM = "expand_vm"
    CLONE_REPLACE_DISK = "clone_replace_disk"


class WorkloadType(str, Enum):
    LXC = "lxc"
    VM = "vm"


class StorageBackend(str, Enum):
    LVM = "lvm"
    LVM_THIN = "lvmthin"
    ZFS = "zfspool"
    DIR = "dir"
    NFS = "nfs"
    CIFS = "cifs"
    GLUSTERFS = "glusterfs"


# Defaults
MIN_DISK_GB = 2
DEFAULT_HEADROOM_GB = 1
DEFAULT_BRIDGE = "vmbr0"
DEFAULT_DISK_FORMAT = "qcow2"
DEFAULT_BIOS = "seabios"

# Required host-side tools checked by pre-flight, grouped by operation category
REQUIRED_CONVERSION_TOOLS = ["parted", "kpartx", "rsync", "qemu-img"]
REQUIRED_RESIZE_TOOLS = ["e2fsck", "resize2fs"]

# Guest OS support matrix
SUPPORTED_LXC_TO_VM_DISTROS = {
    "debian",
    "ubuntu",
    "alpine",
    "rocky",
    "centos",
    "rhel",
    "almalinux",
    "fedora",
    "arch",
}

SUPPORTED_VM_TO_LXC_DISTROS = {
    "debian",
    "ubuntu",
    "alpine",
    "rocky",
    "centos",
    "rhel",
    "almalinux",
    "fedora",
    "arch",
}

# Valid Proxmox VM/CT ID range
MIN_PROXMOX_ID = 100
MAX_PROXMOX_ID = 999999999
