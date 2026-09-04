# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/constants.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: ProxmoxVEx Constants - Layer 0
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
ProxmoxVEx Constants - Layer 0
No ProxmoxVEx imports allowed in this file.
"""

import contextlib
import logging as _logging
import os
from pathlib import Path

# Version
ProxmoxVEx_VERSION = "1.2.303"
ProxmoxVEx_BUILD = "2026.09.04"

# File Paths & Directories
CONFIG_DIR = "config"
Path(CONFIG_DIR).mkdir(exist_ok=True)
with contextlib.suppress(Exception):
    os.chmod(CONFIG_DIR, 0o700)

DATABASE_FILE = os.path.join(CONFIG_DIR, "ProxmoxVEx.db")

# Legacy configuration files (kept for migration)
CONFIG_FILE = os.path.join(CONFIG_DIR, "clusters.json")
CONFIG_FILE_ENCRYPTED = os.path.join(CONFIG_DIR, "clusters.enc")
KEY_FILE = os.path.join(CONFIG_DIR, ".ProxmoxVEx.key")
USERS_FILE_ENCRYPTED = os.path.join(CONFIG_DIR, "users.enc")
AUDIT_LOG_FILE = os.path.join(CONFIG_DIR, "audit.log")
AUDIT_LOG_FILE_ENCRYPTED = os.path.join(CONFIG_DIR, "audit.log.enc")
SESSIONS_FILE = os.path.join(CONFIG_DIR, "sessions.json")
SESSIONS_FILE_ENCRYPTED = os.path.join(CONFIG_DIR, "sessions.enc")
SERVER_SETTINGS_FILE = os.path.join(CONFIG_DIR, "server_settings.json")
ADMIN_INITIALIZED_FILE = os.path.join(CONFIG_DIR, ".admin_initialized")
ALERTS_CONFIG_FILE = os.path.join(CONFIG_DIR, "alerts.json")
SCHEDULED_TASKS_FILE = os.path.join(CONFIG_DIR, "scheduled_tasks.json")
VM_TAGS_FILE = os.path.join(CONFIG_DIR, "vm_tags.json")
AFFINITY_RULES_FILE = os.path.join(CONFIG_DIR, "affinity_rules.json")
MIGRATION_HISTORY_FILE = os.path.join(CONFIG_DIR, "migration_history.json")
CUSTOM_ROLES_FILE = os.path.join(CONFIG_DIR, "custom_roles.json")
ESXI_CONFIG_FILE = os.path.join(CONFIG_DIR, "esxi_storages.json")
STORAGE_CLUSTERS_FILE = os.path.join(CONFIG_DIR, "storage_clusters.json")

# SSL Certs and Branding Assets
SSL_CERT_FILE = os.path.join(CONFIG_DIR, "ssl", "cert.pem")
SSL_KEY_FILE = os.path.join(CONFIG_DIR, "ssl", "key.pem")
SSL_CERT_FILE_LEGACY = "ssl/cert.pem"
SSL_KEY_FILE_LEGACY = "ssl/key.pem"

# TLS verification for outbound cluster API calls.
# Defaults to True (verify). Set PROXMOXVEX_VERIFY_SSL=0 to disable explicitly.
VERIFY_SSL = os.environ.get("PROXMOXVEX_VERIFY_SSL", "1").strip().lower() not in ("0", "false", "no", "off")
BRANDING_DIR = os.path.join(CONFIG_DIR, "branding")
LOG_DIR = "logs"

# Logging Configuration


def _parse_log_level(s: str, default):
    if not isinstance(s, str) or not s.strip():
        return default
    lvl = getattr(_logging, s.strip().upper(), None)
    return lvl if isinstance(lvl, int) else default


LOG_LEVEL = _parse_log_level(os.environ.get("PROXMOXVEX_LOG_LEVEL", ""), None)
FILE_LOG_LEVEL = _parse_log_level(os.environ.get("PROXMOXVEX_FILE_LOG_LEVEL", ""), _logging.DEBUG)
FILE_LOG_DISABLED = os.environ.get("PROXMOXVEX_DISABLE_FILE_LOG", "").strip().lower() in ("1", "true", "yes", "on")

# Reserved / system identities (overridable via environment)
# snyk:ignore:Use of Hardcoded Credentials - public default usernames, not secrets
RESERVED_ADMIN_USERNAME = os.environ.get("PROXMOXVEX_RESERVED_ADMIN", "ProxmoxVEx")
# snyk:ignore:Use of Hardcoded Credentials - public default actor name, not a secret
SYSTEM_ACTOR = os.environ.get("PROXMOXVEX_SYSTEM_ACTOR", "system")

# Directories
WEB_DIR = "web"
SSL_DIR = os.path.join(CONFIG_DIR, "ssl")
SSL_DIR_LEGACY = "ssl"
STATIC_DIR = "static"
IMAGES_DIR = "images"
PLUGINS_DIR = "plugins"

# Ensure directories exist
Path(LOG_DIR).mkdir(exist_ok=True)
Path(PLUGINS_DIR).mkdir(exist_ok=True)
Path(WEB_DIR).mkdir(exist_ok=True)
Path(SSL_DIR).mkdir(parents=True, exist_ok=True)
Path(BRANDING_DIR).mkdir(parents=True, exist_ok=True)
with contextlib.suppress(Exception):
    os.chmod(SSL_DIR, 0o700)


# One-time migration: legacy 'ssl/cert.pem' / 'images/login_bg.*' → config/
def _migrate_to_config():
    import shutil

    try:
        for src, dst in ((SSL_CERT_FILE_LEGACY, SSL_CERT_FILE), (SSL_KEY_FILE_LEGACY, SSL_KEY_FILE)):
            if os.path.exists(src) and not os.path.exists(dst):
                shutil.copy2(src, dst)
                with contextlib.suppress(Exception):
                    os.chmod(dst, 0o600)
        # login background: images/login_bg.<ext> → config/branding/login_bg.<ext>
        for ext in (".png", ".jpg", ".jpeg", ".webp", ".svg"):
            src = os.path.join("images", "login_bg" + ext)
            dst = os.path.join(BRANDING_DIR, "login_bg" + ext)
            if os.path.exists(src) and not os.path.exists(dst):
                shutil.copy2(src, dst)
    except Exception:
        pass


_migrate_to_config()

# Session Configuration
SESSION_TIMEOUT = 28800  # 8 hours

# Brute Force Protection
LOGIN_MAX_ATTEMPTS = 5
LOGIN_LOCKOUT_TIME = 300  # 5 minutes
LOGIN_ATTEMPT_WINDOW = 600  # 10 minutes

# Audit
AUDIT_RETENTION_DAYS = 90

# Rate Limiting
API_RATE_LIMIT = int(os.environ.get("PROXMOXVEX_API_RATE_LIMIT", 1200))
API_RATE_WINDOW = int(os.environ.get("PROXMOXVEX_API_RATE_WINDOW", 60))

# SSH
SSH_MAX_CONCURRENT = int(os.environ.get("PROXMOXVEX_SSH_MAX_CONCURRENT", 25))

# Task User Cache TTL
TASK_USER_CACHE_TTL = 86400

# Max Audit Log Size
MAX_AUDIT_LOG_SIZE = 10000

# SSE Token TTL
SSE_TOKEN_TTL = 600

# Update / distribution URLs (local mirror; see speckit for endpoint implementation)
GITHUB_VERSION_URL = "https://raw.githubusercontent.com/ArMaTeC/proxmox-vex-public/main/version.json"
GITHUB_REPO_URL = "https://github.com/ArMaTeC/proxmox-vex-public"
GITHUB_RAW_URL = "https://raw.githubusercontent.com/ArMaTeC/proxmox-vex-public/main"
# Local tarball endpoint placeholder until self-hosted release mirror is built.
GITHUB_ARCHIVE_URL = "https://github.com/ArMaTeC/proxmox-vex-public/archive/refs/heads/main.tar.gz"


def _github_token_from_git() -> str:
    """Return the token embedded in the configured Git origin remote URL, if any."""
    import subprocess
    import urllib.parse

    try:
        project_root = Path(__file__).resolve().parent.parent
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=str(project_root),
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        url = result.stdout.strip()
        if not url or result.returncode != 0:
            return ""
        parsed = urllib.parse.urlparse(url)
        for value in (parsed.username, parsed.password):
            if value and value not in {"git", "x-oauth-basic", "x-access-token"}:
                return value
    except Exception:
        pass
    return ""


# GitHub access token for private-repo update checks and archive downloads.
# Uses the GITHUB_TOKEN env var, then falls back to a token in the git origin remote.
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "") or _github_token_from_git()


# Predictive Engine Tuning - Mar 2026
PREDICTIVE_WMA_DECAY = 0.7
PREDICTIVE_COMPOSITE_WEIGHT = (0.6, 0.4)  # cpu, mem
PREDICTIVE_OVERSHOOT_FACTOR = 1.15  # compensate for bursty workloads
PREDICTIVE_ENGINE_TAG = "proxmox-wma-v2"
