# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-update-manager/models.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Models PY source
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
from dataclasses import asdict, dataclass


@dataclass
class Guest:
    id: int = 0
    cluster_id: str = ""
    guest_type: str = "vm"
    vmid: int = 0
    name: str = ""
    ip_host: str = ""
    ssh_port: int = 22
    os_family: str = "unknown"
    driver: str = "ssh"
    enabled: bool = True
    created_at: str = ""
    updated_at: str = ""
    last_check_at: str = ""
    last_status: str = ""

    def to_dict(self):
        return {
            "id": self.id,
            "cluster_id": self.cluster_id,
            "guest_type": self.guest_type,
            "vmid": self.vmid,
            "name": self.name,
            "ip_host": self.ip_host,
            "ssh_port": self.ssh_port,
            "os_family": self.os_family,
            "driver": self.driver,
            "enabled": self.enabled,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_check_at": self.last_check_at,
            "last_status": self.last_status,
        }


@dataclass
class Credential:
    guest_id: int = 0
    username: str = ""
    password_enc: str = ""
    auth_type: str = "password"
    ssh_key_enc: str = ""
    updated_at: str = ""

    def to_dict(self, include_secret=False):
        return {
            "guest_id": self.guest_id,
            "username": self.username,
            "auth_type": self.auth_type,
            "updated_at": self.updated_at,
        }


@dataclass
class Policy:
    guest_id: int = 0
    schedule_enabled: bool = False
    schedule_cron: str = ""
    auto_apply: bool = False
    dry_run: bool = True
    notify_on_failure: bool = True
    updated_at: str = ""

    def to_dict(self):
        return {
            "guest_id": self.guest_id,
            "schedule_enabled": self.schedule_enabled,
            "schedule_cron": self.schedule_cron,
            "auto_apply": self.auto_apply,
            "dry_run": self.dry_run,
            "notify_on_failure": self.notify_on_failure,
            "updated_at": self.updated_at,
        }


@dataclass
class Job:
    id: int = 0
    guest_id: int = 0
    job_type: str = ""
    status: str = ""
    started_at: str = ""
    completed_at: str = ""
    error: str = ""
    output: str = ""
    packages_found: int = 0
    packages_applied: int = 0

    def to_dict(self):
        return asdict(self)


@dataclass
class Package:
    id: int = 0
    job_id: int = 0
    name: str = ""
    current_version: str = ""
    available_version: str = ""
    is_security: bool = False

    def to_dict(self):
        return asdict(self)
