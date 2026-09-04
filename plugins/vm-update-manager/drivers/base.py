# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-update-manager/drivers/base.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Base PY source
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
from abc import ABC, abstractmethod


class PackageUpdate:
    def __init__(self, name, current_version, available_version, is_security=False):
        self.name = name
        self.current_version = current_version
        self.available_version = available_version
        self.is_security = is_security

    def to_dict(self):
        return {
            "name": self.name,
            "current_version": self.current_version,
            "available_version": self.available_version,
            "is_security": self.is_security,
        }


class UpdateDriver(ABC):
    # `private_key` is optional and defaults to None everywhere so existing
    # password-only callers/drivers (e.g. WindowsDriver) are unaffected; only
    # SSHDriver currently acts on it to support SSH-key authenticated guests.
    @abstractmethod
    def connect(self, host, port, username, password, timeout=10, private_key=None):
        pass

    @abstractmethod
    def discover(self, host, port, username, password, timeout=120, private_key=None):
        pass

    @abstractmethod
    def apply(self, host, port, username, password, dry_run=False, timeout=600, private_key=None):
        pass
