# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-update-manager/utils.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Utils PY source
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
from flask import request

from ProxmoxVEx.core.db import get_db
from ProxmoxVEx.utils.sanitization import (
    sanitize_bool,
    sanitize_int,
    sanitize_string,
    sanitize_username,
    validate_hostname,
)


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a secret using the database's master key."""
    if not plaintext:
        return ""
    return get_db()._encrypt(plaintext)


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a secret previously encrypted with encrypt_secret."""
    if not ciphertext:
        return ""
    return get_db()._decrypt(ciphertext)


def resolve_credential_secret(cred):
    """Return (password, private_key) for a Credential, based on auth_type.

    `vm_update_credentials` already has separate `password_enc`/`ssh_key_enc`
    columns; this picks the right one and decrypts it so driver calls can
    pass the correct kwarg without every call site needing to know about
    auth_type.
    """
    if getattr(cred, "auth_type", "password") == "ssh_key":
        key = decrypt_secret(cred.ssh_key_enc) if cred.ssh_key_enc else ""
        return None, key
    password = decrypt_secret(cred.password_enc) if cred.password_enc else ""
    return password, None


def validate_ssh_private_key(value: str):
    """Basic sanity check for a pasted SSH private key. Returns (ok, error)."""
    if not value or not value.strip():
        return False, "SSH private key is required"
    v = value.strip()
    if "PRIVATE KEY" not in v or "BEGIN" not in v:
        return False, "SSH private key must be a PEM-formatted key (-----BEGIN ... PRIVATE KEY-----)"
    return True, ""


def get_json_body():
    return request.get_json(silent=True) or {}


def sanitize_guest_payload(data):
    """Return a sanitized dict for a guest create/update request."""
    guest_type = data.get("guest_type", "vm")
    if guest_type not in ("vm", "lxc"):
        guest_type = "vm"
    return {
        "cluster_id": sanitize_string(data.get("cluster_id", ""), 128),
        "guest_type": guest_type,
        "vmid": sanitize_int(data.get("vmid"), 0, 1, 999999),
        "name": sanitize_string(data.get("name", ""), 128),
        "ip_host": data.get("ip_host", "").strip()[:253],
        "ssh_port": sanitize_int(data.get("ssh_port"), 22, 1, 65535),
        "os_family": sanitize_string(data.get("os_family", "unknown"), 32),
        "enabled": 1 if sanitize_bool(data.get("enabled", True)) else 0,
        "username": sanitize_username(data.get("username", ""), 128),
        "password": data.get("password") if isinstance(data.get("password"), str) else "",
        "auth_type": "ssh_key" if data.get("auth_type") == "ssh_key" else "password",
        "ssh_private_key": data.get("ssh_private_key") if isinstance(data.get("ssh_private_key"), str) else "",
        "schedule_enabled": 1 if sanitize_bool(data.get("schedule_enabled", False)) else 0,
        "schedule_cron": sanitize_string(data.get("schedule_cron", ""), 256),
        "auto_apply": 1 if sanitize_bool(data.get("auto_apply", False)) else 0,
        "dry_run": 1 if sanitize_bool(data.get("dry_run", True)) else 0,
        "notify_on_failure": 1 if sanitize_bool(data.get("notify_on_failure", True)) else 0,
    }


def validate_guest_base(data):
    """Validate base required fields. Returns (ok, error)."""
    if not data["cluster_id"]:
        return False, "cluster_id is required"
    if data["vmid"] <= 0:
        return False, "vmid must be a positive integer"
    if not data["name"]:
        return False, "name is required"
    if not data["ip_host"]:
        return False, "ip_host is required"
    if not validate_hostname(data["ip_host"]):
        return False, "ip_host must be a valid IP or hostname"
    if not data["username"]:
        return False, "username is required"
    return True, ""
