# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/api/settings.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: settings, updates, backup/restore & security routes -...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""settings, updates, backup/restore & security routes - split from monolith dec 2025"""

import contextlib
import json
import logging
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime

import requests
from flask import Blueprint, Response, jsonify, make_response, request, send_file, send_from_directory

from ProxmoxVEx.api.helpers import (
    acme_dns_config_from_settings,
    check_cluster_access,
    get_login_settings,
    get_session_timeout,
    load_server_settings,
    save_server_settings,
)
from ProxmoxVEx.app import add_allowed_origin, get_allowed_origins
from ProxmoxVEx.constants import (
    API_RATE_LIMIT,
    API_RATE_WINDOW,
    BRANDING_DIR,
    CONFIG_DIR,
    CONFIG_FILE_ENCRYPTED,
    GITHUB_ARCHIVE_URL,
    GITHUB_RAW_URL,
    GITHUB_REPO_URL,
    GITHUB_TOKEN,
    GITHUB_VERSION_URL,
    KEY_FILE,
    LOG_DIR,
    SESSION_TIMEOUT,
    SSL_CERT_FILE,
    SSL_KEY_FILE,
    WEB_DIR,
    Path,
    ProxmoxVEx_BUILD,
    ProxmoxVEx_VERSION,
)
from ProxmoxVEx.core.db import ENCRYPTION_AVAILABLE, get_db
from ProxmoxVEx.globals import (
    _auto_allowed_origins,
    _cors_origins_env,
    active_sessions,
    api_request_counts,
    cluster_managers,
    pbs_managers,
    sse_clients,
    sse_clients_lock,
)
from ProxmoxVEx.models.permissions import ROLE_ADMIN, ROLE_VIEWER
from ProxmoxVEx.updater.github import get_json, github_headers
from ProxmoxVEx.utils.audit import get_client_ip, log_audit
from ProxmoxVEx.utils.auth import (
    ARGON2_AVAILABLE,
    TOTP_AVAILABLE,
    _check_default_password_in_use,
    load_users,
    needs_password_rehash,
    require_auth,
    validate_session,
    verify_password,
)
from ProxmoxVEx.utils.concurrent import GEVENT_AVAILABLE
from ProxmoxVEx.utils.sanitization import sanitize_csv_field, sanitize_identifier, sanitize_int
from ProxmoxVEx.utils.sanitization import sanitize_log_message as _sl  # CWE-117 tainted-log sanitiser
from ProxmoxVEx.utils.ssh import get_ssh_connection_stats

bp = Blueprint("settings", __name__)

# In-memory store for ProxmoxVEx self-update jobs. Each job keeps a replay log
# and a small queue so the /api/ProxmoxVEx/update/feed SSE endpoint can deliver
# a live, detailed progress stream to the UI without blocking the Flask worker.
_update_jobs = {}
_update_jobs_lock = threading.Lock()


class _UpdateLogHandler(logging.Handler):
    """Capture log messages from the update worker thread and push them into
    the job's live feed so the end user can follow every step in detail."""

    def __init__(self, job_id: str):
        super().__init__()
        self.job_id = job_id
        self.tid = threading.current_thread().ident

    def emit(self, record):
        if record.thread != self.tid:
            return
        try:
            msg = record.getMessage()
        except Exception:
            msg = str(record.msg)
        _emit_update(self.job_id, "log", msg, extra={"level": record.levelname})


def _emit_update(job_id, step, message, percent=None, extra=None):
    """Append an event to a job's log and signal any listening SSE clients."""
    with _update_jobs_lock:
        job = _update_jobs.get(job_id)
        if not job:
            return
        payload = {
            "step": step,
            "message": message,
            "percent": percent,
            "timestamp": datetime.now().isoformat(),
        }
        if extra:
            payload.update(extra)
        job["logs"].append(payload)
        with contextlib.suppress(queue.Full):
            job["queue"].put_nowait(job_id)


def _start_update_job(user, force):
    """Create a new update job and return its id."""
    job_id = str(uuid.uuid4())
    with _update_jobs_lock:
        _update_jobs[job_id] = {
            "id": job_id,
            "user": user,
            "force": force,
            "queue": queue.Queue(maxsize=500),
            "logs": [],
            "closed": False,
            "started_at": datetime.now().isoformat(),
        }
    return job_id


def _close_update_job(job_id):
    """Mark a job as closed and wake up any waiting feed consumers."""
    with _update_jobs_lock:
        job = _update_jobs.get(job_id)
        if not job:
            return
        job["closed"] = True
        with contextlib.suppress(queue.Full):
            job["queue"].put_nowait(job_id)


def _update_feed_generator(job_id):
    """SSE generator that replays existing logs and waits for new ones."""
    with _update_jobs_lock:
        job = _update_jobs.get(job_id)
    if not job:
        yield f"data: {json.dumps({'step': 'error', 'message': 'Update job not found'})}\n\n"
        return

    q = job["queue"]
    last = 0
    while True:
        with _update_jobs_lock:
            logs = job["logs"]
            while last < len(logs):
                payload = logs[last]
                last += 1
                yield f"data: {json.dumps(payload)}\n\n"
                if payload.get("step") in ("done", "error"):
                    return
            if job.get("closed"):
                break
        try:
            q.get(timeout=10)
        except queue.Empty:
            yield ": keepalive\n\n"


def _sanitize_acme_dns_settings(settings, data):
    dns_provider = str(data.get("acme_dns_provider", settings.get("acme_dns_provider", "manual")) or "manual").strip()
    settings["acme_dns_provider"] = dns_provider if dns_provider in ("manual", "rfc2136") else "manual"
    settings["acme_dns_rfc2136_nameserver"] = str(
        data.get("acme_dns_rfc2136_nameserver", settings.get("acme_dns_rfc2136_nameserver", "")) or ""
    ).strip()
    settings["acme_dns_rfc2136_zone"] = str(
        data.get("acme_dns_rfc2136_zone", settings.get("acme_dns_rfc2136_zone", "")) or ""
    ).strip()
    settings["acme_dns_rfc2136_key_name"] = str(
        data.get("acme_dns_rfc2136_key_name", settings.get("acme_dns_rfc2136_key_name", "")) or ""
    ).strip()
    settings["acme_dns_rfc2136_algorithm"] = (
        str(
            data.get("acme_dns_rfc2136_algorithm", settings.get("acme_dns_rfc2136_algorithm", "hmac-sha512"))
            or "hmac-sha512"
        )
        .strip()
        .lower()
    )

    if "acme_dns_rfc2136_secret" in data:
        secret = str(data.get("acme_dns_rfc2136_secret", "") or "").strip()
        if secret != "********":
            settings["acme_dns_rfc2136_secret"] = get_db()._encrypt(secret) if secret else ""

    try:
        settings["acme_dns_rfc2136_port"] = max(
            1, min(65535, int(data.get("acme_dns_rfc2136_port", settings.get("acme_dns_rfc2136_port", 53)) or 53))
        )
    except (TypeError, ValueError):
        settings["acme_dns_rfc2136_port"] = 53
    try:
        settings["acme_dns_rfc2136_ttl"] = max(
            1, min(86400, int(data.get("acme_dns_rfc2136_ttl", settings.get("acme_dns_rfc2136_ttl", 60)) or 60))
        )
    except (TypeError, ValueError):
        settings["acme_dns_rfc2136_ttl"] = 60
    try:
        settings["acme_dns_propagation_seconds"] = max(
            0,
            min(
                600,
                int(data.get("acme_dns_propagation_seconds", settings.get("acme_dns_propagation_seconds", 30)) or 30),
            ),
        )
    except (TypeError, ValueError):
        settings["acme_dns_propagation_seconds"] = 30
    return settings


def _acme_dns_config(settings):
    return acme_dns_config_from_settings(settings)


@bp.route("/api/ProxmoxVEx/version", methods=["GET"])
@require_auth()
def get_ProxmoxVEx_version():
    """Get current ProxmoxVEx version"""
    return jsonify({
        "version": ProxmoxVEx_VERSION,
        "build": ProxmoxVEx_BUILD,
        "python_version": sys.version.split()[0],
        "gevent_available": GEVENT_AVAILABLE,
        "encryption_available": ENCRYPTION_AVAILABLE,
    })


# Military Grade Encryption Status & Migration
@bp.route("/api/ProxmoxVEx/security/status", methods=["GET"])
@require_auth(perms=["security.settings.manage"])
def get_security_status():
    """Get encryption and security status"""
    db = get_db()

    # Count items that need migration
    users_needing_migration = 0
    clusters_needing_migration = 0

    try:
        users_db = load_users()
        for user in users_db.values():
            if needs_password_rehash(user.get("password_salt", ""), user.get("password_hash", "")):
                users_needing_migration += 1
    except Exception:
        pass

    try:
        cursor = db.conn.cursor()
        cursor.execute("SELECT pass_encrypted, ssh_key_encrypted FROM clusters")
        for row in cursor.fetchall():
            if db._needs_reencrypt(row[0]) or row[1] and db._needs_reencrypt(row[1]):
                clusters_needing_migration += 1
    except Exception:
        pass

    # Get login rate limit settings
    login_settings = get_login_settings()

    return jsonify({
        "encryption": {
            "available": ENCRYPTION_AVAILABLE,
            "algorithm": "AES-256-GCM" if ENCRYPTION_AVAILABLE else "None",
            "key_size": "256-bit",
            "mode": "GCM (Authenticated Encryption)",
        },
        "password_hashing": {
            "available": ARGON2_AVAILABLE,
            "algorithm": "Argon2id" if ARGON2_AVAILABLE else "PBKDF2-SHA256",
            "memory_cost": "64 MB" if ARGON2_AVAILABLE else "N/A",
            "iterations": 3 if ARGON2_AVAILABLE else 600000,
        },
        "rate_limiting": {
            "login": {
                "enabled": True,
                "max_attempts": login_settings["max_attempts"],
                "lockout_time": login_settings["lockout_time"],
                "window": login_settings["attempt_window"],
            },
            "api": {
                "enabled": API_RATE_LIMIT > 0,
                "requests_per_window": API_RATE_LIMIT,
                "window_seconds": API_RATE_WINDOW,
                "active_clients": len(api_request_counts),
            },
        },
        "session_management": {
            "timeout_minutes": get_session_timeout() // 60,
            "active_sessions": len(active_sessions),
            "encrypted_storage": True,
            "secure_cookies": True,
        },
        "migration": {
            "users_pending": users_needing_migration,
            "clusters_pending": clusters_needing_migration,
            "total_pending": users_needing_migration + clusters_needing_migration,
            "auto_migration": True,
        },
        "features": {
            "aes_256_gcm": ENCRYPTION_AVAILABLE,
            "argon2id": ARGON2_AVAILABLE,
            "login_rate_limiting": True,
            "api_rate_limiting": API_RATE_LIMIT > 0,
            "secure_sessions": True,
            "csp_headers": True,
            "hsts": True,
        },
    })


@bp.route("/api/ProxmoxVEx/security/migrate-all", methods=["POST"])
@require_auth(perms=["security.settings.manage"])
def migrate_all_encryption():
    """Force migration of all data to latest encryption

    Migrates all passwords to Argon2id and all secrets to AES-256-GCM
    """
    if not ENCRYPTION_AVAILABLE:
        return jsonify({"error": "Encryption not available"}), 400

    db = get_db()
    results = {"users_migrated": 0, "clusters_migrated": 0, "errors": []}

    # Migrate clusters
    try:
        cursor = db.conn.cursor()
        cursor.execute("SELECT id, pass_encrypted, ssh_key_encrypted FROM clusters")

        for row in cursor.fetchall():
            cluster_id = row[0]
            pass_encrypted = row[1]
            ssh_key_encrypted = row[2] or ""

            needs_update = False
            new_pass = pass_encrypted
            new_ssh_key = ssh_key_encrypted

            if db._needs_reencrypt(pass_encrypted):
                decrypted = db._decrypt(pass_encrypted)
                new_pass = db._encrypt(decrypted)
                needs_update = True

            if ssh_key_encrypted and db._needs_reencrypt(ssh_key_encrypted):
                decrypted = db._decrypt(ssh_key_encrypted)
                new_ssh_key = db._encrypt(decrypted)
                needs_update = True

            if needs_update:
                cursor.execute(
                    """
                    UPDATE clusters SET pass_encrypted = ?, ssh_key_encrypted = ?, updated_at = ?
                    WHERE id = ?
                """,
                    (new_pass, new_ssh_key, datetime.now().isoformat(), cluster_id),
                )
                results["clusters_migrated"] += 1

        db.conn.commit()
    except Exception as e:
        results["errors"].append(f"Cluster migration error: {e}")

    # Note: User password migration happens automatically on login
    # We can't migrate passwords without the original password
    results["users_note"] = "User passwords will be migrated automatically on next login"

    user = request.session.get("user", "unknown")
    log_audit(user, "security.migration", f"Migrated {results['clusters_migrated']} clusters to AES-256-GCM")

    return jsonify({
        "success": True,
        "results": results,
        "message": f"Migrated {results['clusters_migrated']} clusters to AES-256-GCM",
    })


@bp.route("/api/ProxmoxVEx/check-update", methods=["GET"])
@require_auth(perms=["update.manage"])
def check_ProxmoxVEx_update():
    """Check for ProxmoxVEx updates (mirror + GitHub fallback).

    Short-circuited when air-gap mode is enabled. Returns the
    current version with a hint flag so the UI can render "Air-gap mode active
    update checks disabled" instead of a misleading "no updates available".
    """
    if load_server_settings().get("air_gap_mode", False):
        return jsonify({
            "current_version": ProxmoxVEx_VERSION,
            "current_build": ProxmoxVEx_BUILD,
            "update_available": False,
            "air_gap": True,
        }), 200
    try:
        # GitHub (get_json resolves raw.githubusercontent.com through the
        # GitHub Contents API so private repos work with GITHUB_TOKEN).
        remote_version = get_json(GITHUB_VERSION_URL, token=GITHUB_TOKEN, timeout=10)

        if not remote_version:
            logging.info("Update server is unreachable; skipping update check")
            return jsonify({
                "error": "Update server is unreachable",
                "current_version": ProxmoxVEx_VERSION,
                "current_build": ProxmoxVEx_BUILD,
                "update_available": False,
            }), 200

        current_version = ProxmoxVEx_VERSION.replace("Alpha ", "").replace("Beta ", "")
        latest_version = remote_version.get("version", "0.0")

        # Simple version comparison (works for semver-like versions)
        def parse_version(v):
            try:
                parts = str(v).replace("Alpha ", "").replace("Beta ", "").split(".")
                return tuple(int(p) for p in parts if p.isdigit())
            except Exception:
                return (0, 0)

        current_tuple = parse_version(current_version)
        latest_tuple = parse_version(latest_version)

        update_available = latest_tuple > current_tuple

        return jsonify({
            "current_version": ProxmoxVEx_VERSION,
            "current_build": ProxmoxVEx_BUILD,
            "latest_version": remote_version.get("version"),
            "latest_build": remote_version.get("build"),
            "release_date": remote_version.get("release_date"),
            "changelog": remote_version.get("changelog", []),
            "download_url": remote_version.get("download_url", GITHUB_REPO_URL),
            "update_available": update_available,
            "min_python": remote_version.get("min_python", "3.8"),
            "breaking_changes": remote_version.get("breaking_changes", []),
        })

    except requests.exceptions.Timeout:
        logging.warning("Timeout checking for updates")
        return jsonify({
            "error": "Timeout - GitHub not reachable",
            "current_version": ProxmoxVEx_VERSION,
            "current_build": ProxmoxVEx_BUILD,
            "update_available": False,
        }), 200
    except requests.exceptions.ConnectionError as e:
        logging.warning(f"Connection error checking updates: {e}", exc_info=True)
        return jsonify({
            "error": "Cannot connect to GitHub - check internet connection",
            "current_version": ProxmoxVEx_VERSION,
            "current_build": ProxmoxVEx_BUILD,
            "update_available": False,
        }), 200
    except requests.exceptions.RequestException as e:
        logging.warning(f"Request error checking updates: {e}", exc_info=True)
        return jsonify({
            "error": "Network error while checking for updates",
            "current_version": ProxmoxVEx_VERSION,
            "current_build": ProxmoxVEx_BUILD,
            "update_available": False,
        }), 200
    except Exception as e:
        logging.error(f"Error checking updates: {e}", exc_info=True)
        # snyk:ignore:Server Information Exposure
        return jsonify({
            "error": "Update check failed",
            "current_version": ProxmoxVEx_VERSION,
            "current_build": ProxmoxVEx_BUILD,
            "update_available": False,
        }), 200


@bp.route("/api/ProxmoxVEx/update", methods=["POST"])
@require_auth(perms=["update.manage"])
def perform_ProxmoxVEx_update():
    """Start an asynchronous ProxmoxVEx self-update and return a job id.

    The real work runs in a background thread; clients listen to
    /api/ProxmoxVEx/update/feed for a live, detailed progress stream.
    """
    data = request.json or {}
    force = data.get("force", False)
    user = request.session.get("user", "system")
    job_id = _start_update_job(user, force)
    threading.Thread(target=_perform_update_worker, args=(job_id, user, force), daemon=True).start()
    return jsonify({"success": True, "job_id": job_id, "status": "started"})


def _perform_update_worker(job_id, user, force=False):
    """ProxmoxVEx auto-update from GitHub

    Rewritten feb 2026 - archive-based (no manual releases needed)
    PRIMARY: downloads GitHub source archive, extracts, copies.
    FALLBACK: expands update_files globs via GitHub API, downloads individually.

    Protected paths (NEVER overwritten):
    - config/, ssl/, certs/   (settings, encrypted data)
    - *.db, *.enc             (databases, encrypted files)
    - *.pem, *.key, *.crt    (certificates, private keys)
    """
    job = _update_jobs.get(job_id)
    if not job:
        return

    def _emit(step, message, percent=None, extra=None):
        _emit_update(job_id, step, message, percent, extra)

    _emit("status", "Starting update check", percent=0, extra={"status": "checking"})
    handler = _UpdateLogHandler(job_id)
    root = logging.getLogger()
    root.addHandler(handler)
    original_level = root.level
    if root.level > logging.INFO:
        root.setLevel(logging.INFO)

    try:
        # Protected paths - NEVER overwrite
        PROTECTED = [
            "config/",
            "ssl/",
            "certs/",
            "logs/",
            "backups/",
            "venv/",
            ".git/",
            ".db",
            ".enc",
            ".pem",
            ".key",
            ".crt",
            ".p12",
        ]

        def is_protected(path):
            p = path.lower()
            for pat in PROTECTED:
                if pat.endswith("/"):
                    if p.startswith(pat) or f"/{pat}" in p:
                        return True
                else:
                    if p.endswith(pat):
                        return True
            return False

        # Check for updates (get_json uses the GitHub Contents API for
        # version.json so private repos work with GITHUB_TOKEN).
        remote_version = get_json(GITHUB_VERSION_URL, token=GITHUB_TOKEN, timeout=10)

        if not remote_version:
            _emit(
                "error",
                "Cannot reach update server",
                extra={
                    "error": "Cannot reach update server",
                    "hint": "Check your internet connection or try again later",
                },
            )
            return

        new_version = remote_version.get("version", "0.0")

        # Version check
        resync = False
        if not force:
            current = ProxmoxVEx_VERSION.replace("Alpha ", "").replace("Beta ", "")

            def parse_ver(v):
                try:
                    parts = str(v).replace("Alpha ", "").replace("Beta ", "").split(".")
                    return tuple(int(p) for p in parts if p.isdigit())
                except Exception:
                    return (0, 0)

            if parse_ver(current) >= parse_ver(new_version):
                resync = True  # already on this version → re-apply the full tree anyway to heal any stale files

        _emit("status", "Checking remote version", percent=5, extra={"status": "checking"})
        user = user or "system"
        log_audit(user, "ProxmoxVEx.update_started", f"Update to version {new_version} initiated")

        # Install dir = project root (3 levels up from ProxmoxVEx/API/settings.py)
        install_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

        # Backup current state
        backup_base = os.path.join(CONFIG_DIR, "backups")
        os.makedirs(backup_base, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = os.path.join(backup_base, f"ProxmoxVEx_{ProxmoxVEx_VERSION.replace(' ', '_')}_{timestamp}")
        os.makedirs(backup_path, exist_ok=True)

        # Backup the stuff that matters, not everything
        for item in ["ProxmoxVEx", "web", "static"]:
            src = os.path.join(install_dir, item)
            if os.path.isdir(src):
                try:
                    shutil.copytree(
                        src, os.path.join(backup_path, item), ignore=shutil.ignore_patterns("__pycache__", "*.pyc")
                    )
                except Exception as e:
                    logging.warning(f"Backup {item}/: {e}", exc_info=True)
        for f in ["ProxmoxVEx_multi_cluster.py", "version.json", "requirements.txt"]:
            src = os.path.join(install_dir, f)
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(backup_path, f))

        logging.info(f"Backup saved to {backup_path}")

        downloaded_files = []
        failed_files = []
        skipped_protected = []
        update_method = "unknown"

        # ---- PRIMARY: Archive-based download ----
        archive_url = remote_version.get("update_archive", GITHUB_ARCHIVE_URL)

        try:
            import tarfile
            import tempfile

            _emit("status", "Downloading update archive", percent=20, extra={"status": "downloading"})
            logging.info(f"Trying archive: {archive_url}")
            resp = None
            with contextlib.suppress(requests.RequestException):
                resp = requests.get(archive_url, headers=github_headers(GITHUB_TOKEN), timeout=120, stream=True)

            if not resp or resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code if resp else 'unreachable'}")

            if not resp or resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code}")

            with tempfile.TemporaryDirectory() as tmpdir:
                archive_path = os.path.join(tmpdir, "repo.tar.gz")
                with open(archive_path, "wb") as f:
                    for chunk in resp.iter_content(8192):
                        f.write(chunk)

                # Extractall with a pre-filtered member list to block path
                # traversal, devices, symlinks and hardlinks. Symlinks in
                # GitHub tarballs (e.g. .test-venv/bin/python3 pointing to an
                # absolute path) cause tarfile's built-in 'data' filter to
                # raise on Python 3.12+, so we filter the members ourselves and
                # rely on the destination-path and type checks below.
                def _safe_members(_tar, _dest):
                    _dest_real = os.path.realpath(_dest) + os.sep
                    for _member in _tar.getmembers():
                        _target = os.path.realpath(os.path.join(_dest, _member.name))
                        if not _target.startswith(_dest_real):
                            continue
                        if _member.isdev() or _member.issym() or _member.islnk():
                            continue
                        yield _member

                with tarfile.open(archive_path, "r:gz") as tar:
                    # snyk:ignore:Arbitrary File Write via Archive Extraction (Tar Slip)
                    # lgtm[py/tarslip]
                    _safe = list(_safe_members(tar, tmpdir))
                    if sys.version_info >= (3, 12):
                        tar.extractall(tmpdir, members=_safe, filter="fully_trusted")  # nosec: B202 - _safe_members validates each path
                    else:
                        tar.extractall(tmpdir, members=_safe)  # nosec: B202 - _safe_members validates each path

                # GitHub archives have a subdirectory (project-ProxmoxVEx-main/)
                content_dir = None
                for item in os.listdir(tmpdir):
                    check = os.path.join(tmpdir, item)
                    if os.path.isdir(check) and os.path.exists(os.path.join(check, "ProxmoxVEx_multi_cluster.py")):
                        content_dir = check
                        break

                if not content_dir:
                    raise RuntimeError("Archive missing ProxmoxVEx_multi_cluster.py")

                # 2026-06-06 (C): GitHub serves archive/refs/heads/main.tar.gz through a
                # CDN that can hand back a STALE cached tarball for a few minutes after a
                # push — a 200 quietly carrying the OLD tree. Compare the version.json
                # INSIDE the extracted archive against the version we're updating TO; if it
                # lags, bail to the per-file fallback (raw + mirror) instead of "updating"
                # to old code. (This is one of the "update didn't catch everything" causes.)
                try:
                    with open(os.path.join(content_dir, "version.json")) as _vf:
                        _arch_ver = (json.load(_vf) or {}).get("version")
                except (OSError, ValueError) as _ve:
                    raise RuntimeError(f"archive version.json unreadable ({_ve}) — treating as stale") from None

                if new_version and _arch_ver and _arch_ver != new_version:
                    raise RuntimeError(f"stale archive: tarball is {_arch_ver}, expected {new_version}")

                # Walk archive and copy, skip protected paths + junk.
                # 2026-06-02: per-file try/except so one failed write
                # (permission, disk full, ENOSPC) doesn't kill the whole
                # archive copy. Real failures land in failed_files and
                # surface in the audit log + response payload.
                _emit("status", "Installing files", percent=60, extra={"status": "installing"})
                for root, dirs, files in os.walk(content_dir):
                    dirs[:] = [d for d in dirs if d not in ("__pycache__", ".git", "venv", "node_modules")]

                    rel_root = os.path.relpath(root, content_dir)
                    for fname in files:
                        if fname.endswith(".pyc"):
                            continue
                        rel_path = os.path.join(rel_root, fname) if rel_root != "." else fname
                        rel_path = rel_path.replace("\\", "/")

                        if is_protected(rel_path):
                            skipped_protected.append(rel_path)
                            continue

                        dst = os.path.join(install_dir, rel_path)
                        try:
                            os.makedirs(os.path.dirname(dst), exist_ok=True)
                            shutil.copy2(os.path.join(root, fname), dst)
                            downloaded_files.append(rel_path)
                        except Exception as copy_err:
                            failed_files.append((rel_path, str(copy_err)[:200]))
                            logging.warning(f"[update] copy failed for {rel_path}: {copy_err}")

            update_method = "archive"
            logging.info(f"Archive update: {len(downloaded_files)} files installed, {len(failed_files)} failed")

        except Exception as archive_err:
            logging.warning(f"Archive download failed ({archive_err}), trying individual files...")
            _emit("status", "Downloading files individually", percent=40, extra={"status": "downloading"})

            # ---- FALLBACK: individual file download ----
            # Expand globs from update_files via GitHub Trees API
            file_list = []

            # try GitHub API to get full file tree
            try:
                api_url = f"{GITHUB_REPO_URL.replace('github.com', 'api.github.com/repos')}/git/trees/main?recursive=1"
                api_resp = requests.get(api_url, timeout=15)
                if api_resp.status_code == 200:
                    all_repo_files = [
                        item["path"] for item in api_resp.json().get("tree", []) if item.get("type") == "blob"
                    ]
                else:
                    all_repo_files = None
            except Exception:
                all_repo_files = None

            patterns = remote_version.get("update_files", [])

            # 2026-06-06 (B): the fallback used to filter the repo tree down to
            # version.json's hand-maintained `update_files` list (which has zero globs),
            # i.e. it became "fetch exactly these 200-odd files". Any file NOT on that
            # list — most painfully a freshly-added sponsor logo under images/ — was
            # silently skipped on the fallback path. The archive path copies the WHOLE
            # tree, so this only bit installs that fell back to per-file, which is why a
            # sponsor reported their logo "never arrived". Mirror the archive: when the
            # Trees API gives us the full tree, fetch ALL of it (is_protected + .pyc skip
            # below still strips data/secrets/junk). update_files is only the degraded
            # last resort when the Trees API itself is unreachable.
            if all_repo_files:
                file_list = all_repo_files
            elif patterns:
                # Trees API down — use update_files as literal filenames (old-style compat)
                file_list = [p for p in patterns if "*" not in p and "?" not in p]
            else:
                # absolute fallback - at least get the essentials
                file_list = [
                    "ProxmoxVEx_multi_cluster.py",
                    "version.json",
                    "requirements.txt",
                    "deploy.sh",
                    "update.sh",
                    "web/index.html",
                    "web/index.html.original",
                ]

            for remote_path in file_list:
                remote_path = remote_path.replace("\\", "/").strip("/")
                if not remote_path or ".." in remote_path.split("/"):
                    continue
                if is_protected(remote_path):
                    skipped_protected.append(remote_path)
                    continue
                if remote_path.endswith(".pyc") or "/__pycache__/" in remote_path:
                    continue

                dst = os.path.normpath(os.path.join(install_dir, remote_path))
                if os.path.commonpath([install_dir, dst]) != install_dir:
                    skipped_protected.append(remote_path)
                    continue

                downloaded = False
                last_err = None
                got_404 = False
                try:
                    resp = requests.get(
                        f"{GITHUB_RAW_URL}/{remote_path}", headers=github_headers(GITHUB_TOKEN), timeout=60
                    )
                    if resp.status_code == 200:
                        os.makedirs(os.path.dirname(dst), exist_ok=True)
                        tmp = dst + ".new"
                        with open(tmp, "wb") as f:
                            f.write(resp.content)
                        os.replace(tmp, dst)
                        downloaded_files.append(remote_path)
                        downloaded = True
                    elif resp.status_code == 404:
                        got_404 = True
                    else:
                        last_err = f"HTTP {resp.status_code}"
                except Exception as e:
                    last_err = str(e)[:200]

                if not downloaded and not got_404:
                    # write- or network-error, not a missing-file 404 — record it
                    failed_files.append((remote_path, last_err or "unknown"))

            update_method = "individual"
            logging.info(f"Individual update: {len(downloaded_files)} files, {len(failed_files)} failed")

        # 2026-06-06 (B): one retry pass for files that failed to write the first time
        # (transient lock / momentary perm hiccup). Re-fetch each via raw GitHub;
        # whatever still fails stays in failed_files and is surfaced in the
        # response so a partial update can't masquerade as a clean one.
        if failed_files:
            _still = []
            for _rp, _err in failed_files:
                if is_protected(_rp) or _rp.endswith(".pyc"):
                    continue
                _dst = os.path.join(install_dir, _rp)
                _ok = False
                try:
                    _r = requests.get(f"{GITHUB_RAW_URL}/{_rp}", headers=github_headers(GITHUB_TOKEN), timeout=60)
                    if _r.status_code == 200:
                        os.makedirs(os.path.dirname(_dst), exist_ok=True)
                        _tmp = _dst + ".new"
                        with open(_tmp, "wb") as _fh:
                            _fh.write(_r.content)
                        os.replace(_tmp, _dst)
                        downloaded_files.append(_rp)
                        _ok = True
                    elif _r.status_code == 404:
                        _ok = True  # gone upstream — not a failure on our side
                except Exception as _e:
                    _err = str(_e)[:200]
                if not _ok:
                    _still.append((_rp, _err))
            if len(_still) != len(failed_files):
                logging.info(
                    f"[update] retry recovered {len(failed_files) - len(_still)} file(s), {len(_still)} still failing"
                )
            failed_files = _still

        # Make scripts executable
        for script in ["deploy.sh", "update.sh", "web/Dev/build.sh"]:
            spath = os.path.join(install_dir, script)
            if os.path.exists(spath):
                with contextlib.suppress(Exception):
                    os.chmod(spath, 0o755)  # nosec: B103 - installed helper scripts need execute

        # Install new Python packages
        pip_result = None
        requirements_path = os.path.join(install_dir, "requirements.txt")
        if os.path.exists(requirements_path):
            try:
                _emit("status", "Installing Python packages", percent=85, extra={"status": "installing"})
                logging.info("Installing Python packages...")

                # Try multiple pip methods - venv first, then system
                venv_pip = os.path.join(install_dir, "venv", "bin", "pip")
                venv_pip_win = os.path.join(install_dir, "venv", "Scripts", "pip.exe")

                is_root = os.geteuid() == 0 if hasattr(os, "geteuid") else False
                has_sudo = shutil.which("sudo") is not None

                if os.path.exists(venv_pip):
                    result = subprocess.run(
                        [venv_pip, "install", "-r", requirements_path, "--quiet"],
                        capture_output=True,
                        text=True,
                        timeout=120,
                    )
                    if result.returncode == 0:
                        pip_result = "success (venv)"

                elif os.path.exists(venv_pip_win):
                    result = subprocess.run(
                        [venv_pip_win, "install", "-r", requirements_path, "--quiet"],
                        capture_output=True,
                        text=True,
                        timeout=120,
                    )
                    if result.returncode == 0:
                        pip_result = "success (venv)"

                if not pip_result:
                    system_pip = shutil.which("pip3") or shutil.which("pip")
                    if system_pip:
                        pip_args = [
                            system_pip,
                            "install",
                            "-r",
                            requirements_path,
                            "--quiet",
                            "--break-system-packages",
                        ]

                        if is_root:
                            result = subprocess.run(pip_args, capture_output=True, text=True, timeout=120)
                        elif has_sudo:
                            result = subprocess.run(
                                ["sudo", "-n"] + pip_args, capture_output=True, text=True, timeout=120
                            )
                            if result.returncode != 0:
                                result = subprocess.run(
                                    [system_pip, "install", "-r", requirements_path, "--user", "--quiet"],
                                    capture_output=True,
                                    text=True,
                                    timeout=120,
                                )
                        else:
                            result = subprocess.run(
                                [system_pip, "install", "-r", requirements_path, "--user", "--quiet"],
                                capture_output=True,
                                text=True,
                                timeout=120,
                            )

                        pip_result = "success" if result.returncode == 0 else f"failed: {result.stderr[:100]}"
                    else:
                        pip_result = "skipped (pip not found)"

            except subprocess.TimeoutExpired:
                pip_result = "timeout"
            except Exception as e:
                pip_result = f"error: {str(e)}"

        # 2026-06-02: include real failure count in the audit line so post-
        # update reports surface "247 ok / 3 failed" instead of just "247 files"
        # while a handful silently stayed on the old version.
        audit_detail = f"Updated to {new_version} via {update_method}, {len(downloaded_files)} files"
        if failed_files:
            audit_detail += f", {len(failed_files)} failed: {', '.join(f[0] for f in failed_files[:5])}"
            if len(failed_files) > 5:
                audit_detail += f" (+{len(failed_files) - 5} more)"
        log_audit(user, "ProxmoxVEx.update_completed", audit_detail)

        # Schedule restart
        restart_delay = 3

        def restart_server():
            time.sleep(restart_delay)
            logging.info("Restarting ProxmoxVEx server...")

            is_root = os.geteuid() == 0 if hasattr(os, "geteuid") else False
            has_sudo = shutil.which("sudo") is not None

            try:
                result = subprocess.run(
                    ["systemctl", "is-active", "ProxmoxVEx"], capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    if is_root:
                        subprocess.run(["systemctl", "restart", "ProxmoxVEx"], timeout=30)
                        return
                    elif has_sudo:
                        result = subprocess.run(
                            ["sudo", "-n", "systemctl", "restart", "ProxmoxVEx"],
                            capture_output=True,
                            text=True,
                            timeout=30,
                        )
                        if result.returncode == 0:
                            return

                    # let systemd restart us
                    logging.info("Exiting for systemd restart (Restart=always)...")
                    os._exit(0)
            except Exception:
                pass

            # Fallback: restart via Python
            try:
                os.execv(sys.executable, [sys.executable] + sys.argv)
            except Exception:
                os._exit(0)

        threading.Thread(target=restart_server, daemon=True).start()

        # 2026-06-02: surface partial-success in the response so the UI can
        # show a warning instead of a green check when N files failed to write.
        # Before this, files_failed was always [] (the variable was never
        # appended to in the fallback path and the primary path had no
        # try/except at all), so 'success: true' meant "we tried" not
        # "everything landed". Now it actually reflects reality.
        # 2026-06-06 (D): post-copy sanity check - read the version.JSON now ON DISK
        # and confirm it matches what we meant to install. A mismatch means the tree
        # didn't fully land (stale source / mid-copy failure); surface it via `partial`
        # instead of flashing a green check.
        on_disk_version = None
        try:
            with open(os.path.join(install_dir, "version.json")) as _dvf:
                on_disk_version = (json.load(_dvf) or {}).get("version")
        except Exception as _dve:
            logging.warning(f"[update] post-copy version.json read failed: {_dve}")
        version_mismatch = bool(new_version and on_disk_version and on_disk_version != new_version)
        if version_mismatch:
            logging.warning(f"[update] post-copy version mismatch: on-disk {on_disk_version}, expected {new_version}")

        partial = len(failed_files) > 0 or version_mismatch
        _verb = "Re-synced all files for" if resync else "Update to"
        message = (
            f"{_verb} {new_version} complete! Restarting in {restart_delay}s..."
            if not partial
            else f"{_verb} {new_version} partially applied — "
            f"{len(failed_files)} file(s) failed to write"
            f"{', on-disk version mismatch' if version_mismatch else ''}. "
            f"Restarting in {restart_delay}s..."
        )
        _emit(
            "done",
            message,
            percent=100,
            extra={
                "success": True,
                "partial": partial,
                "resync": resync,
                "on_disk_version": on_disk_version,
                "version_mismatch": version_mismatch,
                "updated_version": new_version,
                "update_method": update_method,
                "backup_path": backup_path,
                "files_updated": downloaded_files,
                "files_failed": failed_files,
                "files_protected": skipped_protected,
                "pip_install": pip_result,
                "restarting": True,
                "restart_delay": restart_delay,
            },
        )
        _emit("status", "Restarting server", percent=100, extra={"status": "restarting"})
        threading.Thread(target=restart_server, daemon=True).start()

    except Exception as e:
        logging.error(f"Update error: {e}", exc_info=True)
        _emit("error", "Update failed", extra={"error": "Update failed"})
    finally:
        root.removeHandler(handler)
        if root.level != original_level:
            root.setLevel(original_level)
        _close_update_job(job_id)


@bp.route("/api/ProxmoxVEx/update/feed")
@require_auth(perms=["update.manage"])
def update_feed():
    """SSE endpoint that streams a live, detailed feed for an active update job."""
    job_id = request.args.get("job_id")
    if not job_id:
        return jsonify({"error": "job_id required"}), 400
    job = _update_jobs.get(job_id)
    if not job:
        return jsonify({"error": "Update job not found"}), 404
    response = Response(_update_feed_generator(job_id), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    return response


@bp.route("/api/ProxmoxVEx/update/rollback", methods=["POST"])
@require_auth(perms=["update.manage"])
def rollback_ProxmoxVEx_update():
    """Rollback to a previous ProxmoxVEx version from backup

    Rollback functionality
    """
    try:
        data = request.json or {}
        backup_name = data.get("backup")
        # Sanitize to prevent path traversal (../../../etc/passwd)
        if backup_name:
            backup_name = sanitize_identifier(backup_name, max_length=128)

        backup_dir = os.path.join(CONFIG_DIR, "backups")

        if not backup_name:
            # List available backups
            backups = []
            if os.path.exists(backup_dir):
                for name in sorted(os.listdir(backup_dir), reverse=True):
                    backup_path = os.path.join(backup_dir, name)
                    if os.path.isdir(backup_path):
                        # Get backup info
                        files = os.listdir(backup_path)
                        backups.append({
                            "name": name,
                            "path": backup_path,
                            "files": files,
                            "created": datetime.fromtimestamp(os.path.getctime(backup_path)).isoformat(),
                        })

            return jsonify({
                "backups": backups[:10],  # Last 10 backups
                "message": "Select a backup to restore",
            })

        # Restore specific backup
        backup_path = os.path.join(backup_dir, backup_name)
        # (CodeAnt CWE-22): sanitize_identifier strips '/' but keeps '.',
        # so a name of exactly '..'/'.' survives and resolves outside/at the backups
        # dir (one level up to CONFIG_DIR). Require the resolved path to sit STRICTLY
        # inside backup_dir before we os.listdir() + copy2() files out of it.
        _real_root = os.path.realpath(backup_dir)
        _real_backup = os.path.realpath(backup_path)
        if _real_backup == _real_root or os.path.commonpath([_real_backup, _real_root]) != _real_root:
            return jsonify({"error": "Invalid backup name"}), 400
        if not os.path.exists(backup_path):
            return jsonify({"error": "Backup not found"}), 404

        current_dir = os.path.dirname(os.path.abspath(__file__))
        current_backend = os.path.abspath(__file__)
        current_frontend = os.path.join(current_dir, "index.html")

        restored = []

        # Restore backend
        backup_backend = None
        for f in os.listdir(backup_path):
            if f.endswith(".py"):
                backup_backend = os.path.join(backup_path, f)
                break

        if backup_backend and os.path.exists(backup_backend):
            shutil.copy2(backup_backend, current_backend)
            restored.append("backend")
            logging.info(f"Restored backend from {backup_backend}")

        # Restore frontend
        backup_frontend = os.path.join(backup_path, "index.html")
        if os.path.exists(backup_frontend):
            shutil.copy2(backup_frontend, current_frontend)
            restored.append("frontend")
            logging.info(f"Restored frontend from {backup_frontend}")

        user = getattr(request, "session", {}).get("user", "system")
        log_audit(user, "ProxmoxVEx.rollback", f"Rolled back to backup: {backup_name}")

        # Schedule restart
        def restart_server():
            time.sleep(3)
            is_root = os.geteuid() == 0 if hasattr(os, "geteuid") else False
            has_sudo = shutil.which("sudo") is not None

            try:
                result = subprocess.run(
                    ["systemctl", "is-active", "ProxmoxVEx"], capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    if is_root:
                        subprocess.run(["systemctl", "restart", "ProxmoxVEx"], timeout=30)
                        return
                    elif has_sudo:
                        result = subprocess.run(
                            ["sudo", "-n", "systemctl", "restart", "ProxmoxVEx"],
                            capture_output=True,
                            text=True,
                            timeout=30,
                        )
                        if result.returncode == 0:
                            return
                    # Fallback: exit for systemd restart
                    logging.info("Exiting for systemd restart...")
                    os._exit(0)
            except Exception:
                pass
            try:
                os.execv(sys.executable, [sys.executable] + sys.argv)
            except Exception:
                os._exit(0)

        import threading

        threading.Thread(target=restart_server, daemon=True).start()

        return jsonify({
            "success": True,
            "message": f"Rolled back to {backup_name}. Server restarting...",
            "restored": restored,
            "restarting": True,
        })

    except Exception as e:
        logging.error(f"Rollback error: {e}", exc_info=True)
        # snyk:ignore:Server Information Exposure
        # lgtm[py/server-information-exposure]
        return jsonify({"error": "Rollback failed"}), 500


@bp.route("/api/ProxmoxVEx/changelog", methods=["GET"])
@require_auth()
def get_ProxmoxVEx_changelog():
    """Get ProxmoxVEx changelog from GitHub"""
    try:
        data = get_json(GITHUB_VERSION_URL, token=GITHUB_TOKEN, timeout=10)
        if data:
            return jsonify({
                "changelog": data.get("changelog", []),
                "version": data.get("version"),
                "release_date": data.get("release_date"),
            })
        return jsonify({"error": "Failed to fetch changelog"}), 500
    except Exception as e:
        logging.error(f"Changelog fetch error: {e}", exc_info=True)
        return jsonify({"error": "Changelog fetch failed"}), 500


# Serve static files (JS, CSS, fonts for offline mode)
STATIC_DIR = "static"
Path(STATIC_DIR).mkdir(exist_ok=True)
Path(os.path.join(STATIC_DIR, "js")).mkdir(exist_ok=True)
Path(os.path.join(STATIC_DIR, "css")).mkdir(exist_ok=True)


@bp.route("/static/<path:filename>")
def serve_static(filename):
    """Serve static files (JS, CSS, logo, etc.) for offline operation
    Returns 404 with matching content-type to avoid MIME errors in browser
    """
    # Determine MIME type based on extension
    mime_types = {
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".css": "text/css",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
        ".ttf": "font/ttf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".json": "application/json",
        ".map": "application/json",
    }
    ext = os.path.splitext(filename)[1].lower()
    mimetype = mime_types.get(ext, "application/octet-stream")

    # Check if file exists
    filepath = os.path.join(STATIC_DIR, filename)
    if not os.path.isfile(filepath):
        # Return 404 with correct MIME type - prevents "not executable" errors
        return Response("", status=404, mimetype=mimetype)

    return send_from_directory(STATIC_DIR, filename, mimetype=mimetype)


# SECURITY: Block access to config directory
@bp.route("/config/<path:filename>")
def block_config_access(filename):
    """Block any attempt to access config files via HTTP"""
    logging.warning(f"Blocked attempt to access config file: {_sl(filename)} from {request.remote_addr}")
    return jsonify({"error": "Access denied"}), 403


@bp.route("/config")
def block_config_dir():
    """Block any attempt to access config directory"""
    logging.warning(f"Blocked attempt to list config directory from {request.remote_addr}")
    return jsonify({"error": "Access denied"}), 403


# Serve images (logos, sponsors, etc.)
IMAGES_DIR = "images"
Path(IMAGES_DIR).mkdir(exist_ok=True)
# 2026-06-01 - customer-uploaded branding lives under BRANDING_DIR (in the
# config/ volume so it survives `docker compose pull`). The /images/ route
# below now serves login_bg from there first, falls back to the static
# images/ folder for everything else (logo, sponsors, etc.).


@bp.route("/favicon.ico")
def serve_favicon():
    """serve favicon from images or static folder"""
    # try images first, then static
    for folder in [IMAGES_DIR, STATIC_DIR]:
        favicon_path = os.path.join(folder, "favicon.ico")
        if os.path.exists(favicon_path):
            return send_from_directory(folder, "favicon.ico", mimetype="image/x-icon")
    # return empty response if no favicon (prevents 404 spam in logs)
    return "", 204


@bp.route("/images/<path:filename>")
def serve_images(filename):
    """
    Serve image files (ProxmoxVEx logo, login background).
    """
    if filename.startswith("login_bg."):
        branding_path = os.path.join(BRANDING_DIR, filename)
        if os.path.exists(branding_path):
            return send_from_directory(BRANDING_DIR, filename)
    return send_from_directory(IMAGES_DIR, filename)


# Bundled offline assets (currently only the world-countries SVG
# for the worldmap, but the route accepts any sub-file). Air-gap-safe: never
# fetches from a CDN, always served from disk next to the rest of the app.
@bp.route("/assets/<path:filename>")
def serve_web_assets(filename):
    web_assets_dir = os.path.join("web", "assets")
    resp = send_from_directory(web_assets_dir, filename)
    # The SVG is huge-ish (~140 KB) but completely static; let the browser cache
    # it for a day so the worldmap reloads are cheap.
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


# PWA: manifest + service worker. SW must live at root scope
# or it can only control its sub-path; same for the manifest URL.
@bp.route("/manifest.webmanifest")
def serve_manifest():
    resp = send_from_directory(WEB_DIR, "manifest.webmanifest", mimetype="application/manifest+json")
    resp.headers["Cache-Control"] = "public, max-age=300"
    return resp


@bp.route("/sw.js")
def serve_sw():
    """Service worker — never cache aggressively or updates won't roll out."""
    resp = send_from_directory(WEB_DIR, "sw.js", mimetype="application/javascript")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    # MUST allow root scope; some browsers want this header explicit
    resp.headers["Service-Worker-Allowed"] = "/"
    return resp


@bp.route("/app.bundle.js")
def serve_app_bundle_js():
    """Serve the main JS bundle extracted from index.html."""
    resp = send_from_directory(WEB_DIR, "app.bundle.js", mimetype="application/javascript")
    # Content is immutable per build; cache for a year
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


@bp.route("/app.bundle.css")
def serve_app_bundle_css():
    """Serve the main CSS bundle extracted from index.html."""
    resp = send_from_directory(WEB_DIR, "app.bundle.css", mimetype="text/css")
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


@bp.route("/lazy.bundle.js")
def serve_lazy_bundle_js():
    """Serve the lazy JS bundle for heavy features (VNC console, world map)."""
    resp = send_from_directory(WEB_DIR, "lazy.bundle.js", mimetype="application/javascript")
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


@bp.route("/app.bundle.js.map")
def serve_app_bundle_js_map():
    """Serve source map for the main JS bundle so browser dev tools stop 404ing."""
    resp = send_from_directory(WEB_DIR, "app.bundle.js.map", mimetype="application/json")
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


@bp.route("/lazy.bundle.js.map")
def serve_lazy_bundle_js_map():
    """Serve source map for the lazy JS bundle so browser dev tools stop 404ing."""
    resp = send_from_directory(WEB_DIR, "lazy.bundle.js.map", mimetype="application/json")
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


@bp.route("/i18n/locales/<namespace>/<filename>")
def serve_i18n_locale(namespace, filename):
    """Serve i18n locale JSON files for plugin namespaces.

    Plugins load their translations at runtime via:
      fetch('/i18n/locales/truenas/en.json')
    """
    # Validate namespace and filename to prevent path traversal.
    # Plugin namespaces can contain hyphens and underscores (e.g., storage-rebalancer).
    if not re.match(r"^[a-z0-9][a-z0-9_-]*$", namespace):
        return jsonify({"error": "Invalid namespace"}), 400
    if not re.match(r"^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)*\.json$", filename):
        return jsonify({"error": "Invalid locale filename"}), 400
    locale_dir = os.path.join(WEB_DIR, "i18n", "locales", namespace)
    if not os.path.isdir(locale_dir):
        return jsonify({"error": "Namespace not found"}), 404
    resp = send_from_directory(locale_dir, filename, mimetype="application/json")
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp


@bp.route("/api/settings/server", methods=["GET"])
@require_auth(perms=["admin.settings"])
def get_server_settings():
    """Get server settings (admin only)"""
    settings = load_server_settings()
    # Add info about existing cert/key files
    settings["ssl_cert_exists"] = os.path.exists(SSL_CERT_FILE)
    settings["ssl_key_exists"] = os.path.exists(SSL_KEY_FILE)
    # Include cert info for ACME status
    try:
        from pathlib import Path

        from ProxmoxVEx.core.acme import get_cert_info

        if Path("/usr/lib/ProxmoxVEx").exists():
            _ssl_dir = str(Path("/var/lib/ProxmoxVEx/ssl"))
        else:
            _ssl_dir = str(Path(__file__).resolve().parent.parent.parent / "ssl")
        settings["cert_info"] = get_cert_info(_ssl_dir)
    except Exception:
        settings["cert_info"] = None
    # Don't return actual cert/key content or sensitive passwords
    # Mask SMTP password if set
    if settings.get("smtp_password"):
        settings["smtp_password"] = "********"
    # Mask LDAP bind password - frontend doesn't need the encrypted value
    if settings.get("ldap_bind_password"):
        settings["ldap_bind_password"] = "********"
    # Mask OIDC client secret
    if settings.get("oidc_client_secret"):
        settings["oidc_client_secret"] = "********"
    if settings.get("acme_dns_rfc2136_secret"):
        settings["acme_dns_rfc2136_secret"] = "********"
    return jsonify(settings)


@bp.route("/api/password-policy", methods=["GET"])
def get_password_policy():
    """Get password policy settings (public - needed for password change forms)

    Returns only password-related settings, no auth required
    """
    settings = load_server_settings()
    return jsonify({
        "min_length": settings.get("password_min_length", 8),
        "require_uppercase": settings.get("password_require_uppercase", True),
        "require_lowercase": settings.get("password_require_lowercase", True),
        "require_numbers": settings.get("password_require_numbers", True),
        "require_special": settings.get("password_require_special", False),
        "expiry_days": settings.get("password_expiry_days", 0),
    })


_SERVER_SETTINGS_SCHEMA = {
    "domain": {"required": False, "type": str},
    "port": {"required": False, "type": int},
    "http_redirect_port": {"required": False, "type": int},
    "ssl_enabled": {"required": False, "type": bool},
    "acme_enabled": {"required": False, "type": bool},
    "acme_email": {"required": False, "type": str},
    "acme_staging": {"required": False, "type": bool},
    "acme_challenge_type": {"required": False, "type": str},
    "acme_provider": {"required": False, "type": str},
    "acme_directory_url": {"required": False, "type": str},
    "login_max_attempts": {"required": False, "type": int},
    "login_lockout_time": {"required": False, "type": int},
    "login_attempt_window": {"required": False, "type": int},
}


def _parse_settings_body():
    """Parse server settings from JSON, form-encoded, or multipart body.

    Converts string-encoded booleans sent by form controls and parses
    JSON-stringified list fields back into Python lists.
    """
    if request.is_json:
        return request.get_json(silent=True) or {}
    data = {}
    for key, value in request.form.items():
        data[key] = value
    for key, value in list(data.items()):
        if not isinstance(value, str):
            continue
        if value.lower() == "true":
            data[key] = True
        elif value.lower() == "false":
            data[key] = False
        elif key in ("alert_email_recipients", "ldap_group_mappings"):
            with contextlib.suppress(ValueError, TypeError):
                data[key] = json.loads(value)
    return data


@bp.route("/api/settings/server", methods=["POST"])
@require_auth(perms=["admin.settings"])
def update_server_settings():
    """Update server settings (admin only)

    Fixed Dec 2025 - now accepts both JSON and form-data
    """
    try:
        settings = load_server_settings()
        restart_required = False

        if request.is_json or request.form or request.files:
            data = _parse_settings_body()

            # server config
            if "domain" in data:
                # Auto-strip port from domain if present (user might accidentally include it)
                domain_value = data["domain"].strip()
                if domain_value and ":" in domain_value and not domain_value.startswith("["):
                    domain_value = domain_value.rsplit(":", 1)[0]
                settings["domain"] = domain_value
            if "port" in data:
                new_port = int(data["port"])
                if settings.get("port") != new_port:
                    restart_required = True
                settings["port"] = new_port
            if "http_redirect_port" in data:
                new_http_port = int(data["http_redirect_port"])
                if settings.get("http_redirect_port") != new_http_port:
                    restart_required = True
                settings["http_redirect_port"] = new_http_port
            if "ssl_enabled" in data:
                new_ssl = bool(data["ssl_enabled"])
                if settings.get("ssl_enabled") != new_ssl:
                    restart_required = True
                settings["ssl_enabled"] = new_ssl
            # ACME settings
            if "acme_enabled" in data:
                settings["acme_enabled"] = bool(data["acme_enabled"])
            if "acme_email" in data:
                settings["acme_email"] = str(data["acme_email"]).strip()
            if "acme_staging" in data:
                settings["acme_staging"] = bool(data["acme_staging"])
            if "acme_challenge_type" in data:
                challenge_type = str(data["acme_challenge_type"] or "http-01").strip()
                settings["acme_challenge_type"] = (
                    challenge_type if challenge_type in ("http-01", "dns-01") else "http-01"
                )
            if any(k.startswith("acme_dns_") for k in data):
                settings = _sanitize_acme_dns_settings(settings, data)
            if "acme_provider" in data:
                provider = str(data["acme_provider"] or "letsencrypt").strip()
                settings["acme_provider"] = provider if provider in ("letsencrypt", "custom") else "letsencrypt"
            if "acme_directory_url" in data:
                url = str(data["acme_directory_url"] or "").strip()
                # only allow https for security (prevent SSRF to metadata endpoints)
                if url and not url.startswith("https://"):
                    return jsonify({"error": "ACME directory URL must use HTTPS"}), 400
                settings["acme_directory_url"] = url
            if settings.get("acme_provider") != "custom":
                settings["acme_directory_url"] = ""

            # security/bruteforce settings
            if "login_max_attempts" in data:
                settings["login_max_attempts"] = max(1, min(50, int(data["login_max_attempts"])))
            if "login_lockout_time" in data:
                settings["login_lockout_time"] = max(30, min(86400, int(data["login_lockout_time"])))
            if "login_attempt_window" in data:
                settings["login_attempt_window"] = max(60, min(3600, int(data["login_attempt_window"])))

            # password policy
            if "password_min_length" in data:
                settings["password_min_length"] = max(4, min(64, int(data["password_min_length"])))
            if "password_require_uppercase" in data:
                settings["password_require_uppercase"] = bool(data["password_require_uppercase"])
            if "password_require_lowercase" in data:
                settings["password_require_lowercase"] = bool(data["password_require_lowercase"])
            if "password_require_numbers" in data:
                settings["password_require_numbers"] = bool(data["password_require_numbers"])
            if "password_require_special" in data:
                settings["password_require_special"] = bool(data["password_require_special"])

            # Password expiry settings
            if "password_expiry_enabled" in data:
                old_val = settings.get("password_expiry_enabled")
                settings["password_expiry_enabled"] = bool(data["password_expiry_enabled"])
                if old_val != settings["password_expiry_enabled"]:
                    log_audit(
                        request.session.get("user", "admin"),
                        "settings.password_expiry",
                        f"Password expiry {'enabled' if settings['password_expiry_enabled'] else 'disabled'}",
                    )
            if "password_expiry_days" in data:
                settings["password_expiry_days"] = max(7, min(365, int(data["password_expiry_days"])))
            if "password_expiry_warning_days" in data:
                settings["password_expiry_warning_days"] = max(1, min(30, int(data["password_expiry_warning_days"])))
            if "password_expiry_email_enabled" in data:
                settings["password_expiry_email_enabled"] = bool(data["password_expiry_email_enabled"])
            if "password_expiry_include_admins" in data:
                old_val = settings.get("password_expiry_include_admins")
                settings["password_expiry_include_admins"] = bool(data["password_expiry_include_admins"])
                if old_val != settings["password_expiry_include_admins"]:
                    log_audit(
                        request.session.get("user", "admin"),
                        "settings.password_expiry",
                        f"Admin password expiry {'enabled' if settings['password_expiry_include_admins'] else 'disabled'}",
                    )

            # Audit log retention (BSI Grundschutz: ≥ 6 Monate Empfehlung)
            if "audit_retention_days" in data:
                old_val = settings.get("audit_retention_days", 90)
                settings["audit_retention_days"] = max(30, min(3650, int(data["audit_retention_days"])))
                if old_val != settings["audit_retention_days"]:
                    log_audit(
                        request.session.get("user", "admin"),
                        "settings.audit_retention",
                        f"Audit retention changed: {old_val} -> {settings['audit_retention_days']} days",
                    )

            # Air-gap mode: disables update-mirror calls, external CVE
            # online lookups, OIDC discovery against public IdPs.
            # and sponsor logos stay visible — they don't fire outbound HTTP, just hyperlinks.
            # For BSI VS-NfD / restricted networks where outbound HTTP must not happen.
            if "air_gap_mode" in data:
                old_val = settings.get("air_gap_mode", False)
                settings["air_gap_mode"] = bool(data["air_gap_mode"])
                if old_val != settings["air_gap_mode"]:
                    log_audit(
                        request.session.get("user", "admin"),
                        "settings.air_gap",
                        f"Air-gap mode {'enabled' if settings['air_gap_mode'] else 'disabled'}",
                    )

            # Reverse proxy / nginx settings
            if "reverse_proxy_enabled" in data:
                new_rp = bool(data["reverse_proxy_enabled"])
                if settings.get("reverse_proxy_enabled") != new_rp:
                    restart_required = True
                    log_audit(
                        request.session.get("user", "admin"),
                        "settings.reverse_proxy",
                        f"Reverse proxy {'enabled' if new_rp else 'disabled'}",
                    )
                settings["reverse_proxy_enabled"] = new_rp
            if "trusted_proxies" in data:
                tp = str(data["trusted_proxies"] or "").strip()
                settings["trusted_proxies"] = tp
                # hot-reload the trusted proxy list so it takes effect immediately
                from ProxmoxVEx.utils.audit import load_trusted_proxies

                load_trusted_proxies(tp)
            if "proxy_bind_address" in data:
                new_bind = str(data["proxy_bind_address"] or "").strip()
                if settings.get("proxy_bind_address", "") != new_bind:
                    restart_required = True
                settings["proxy_bind_address"] = new_bind

            # Force 2FA for all users
            if "force_2fa" in data:
                old_val = settings.get("force_2fa")
                settings["force_2fa"] = bool(data["force_2fa"])
                if old_val != settings["force_2fa"]:
                    log_audit(
                        request.session.get("user", "admin"),
                        "settings.force_2fa",
                        f"Force 2FA {'enabled' if settings['force_2fa'] else 'disabled'}",
                    )
            if "force_2fa_exclude_admins" in data:
                settings["force_2fa_exclude_admins"] = bool(data["force_2fa_exclude_admins"])

            # session settings
            if "session_timeout" in data:
                settings["session_timeout"] = max(300, min(604800, int(data["session_timeout"])))

            # SMTP Settings
            if "smtp_enabled" in data:
                settings["smtp_enabled"] = bool(data["smtp_enabled"])
                logging.info(f"[Settings] Setting smtp_enabled = {settings['smtp_enabled']}")
            if "smtp_host" in data:
                settings["smtp_host"] = str(data["smtp_host"]).strip()
                logging.info(f"[Settings] Setting smtp_host = {settings['smtp_host']}")
            if "smtp_port" in data:
                settings["smtp_port"] = max(1, min(65535, int(data["smtp_port"] or 587)))
                logging.info(f"[Settings] Setting smtp_port = {settings['smtp_port']}")
            if "smtp_user" in data:
                settings["smtp_user"] = str(data["smtp_user"] or "").strip()
            if "smtp_password" in data:
                # Only update if not empty (don't overwrite with empty string)
                pwd = str(data["smtp_password"] or "")
                if pwd and pwd != "********":  # Don't save masked password
                    settings["smtp_password"] = get_db()._encrypt(pwd)  # SECURITY: encrypt like LDAP/OIDC
                    logging.info("[Settings] SMTP password updated (encrypted)")
            if "smtp_from_email" in data:
                settings["smtp_from_email"] = str(data["smtp_from_email"] or "").strip()
                logging.info(f"[Settings] Setting smtp_from_email = {settings['smtp_from_email']}")
            if "smtp_from_name" in data:
                settings["smtp_from_name"] = str(data["smtp_from_name"] or "").strip()
            if "smtp_tls" in data:
                settings["smtp_tls"] = bool(data["smtp_tls"])
            if "smtp_ssl" in data:
                settings["smtp_ssl"] = bool(data["smtp_ssl"])

            # Alert settings
            if "alert_email_recipients" in data:
                recipients = data["alert_email_recipients"]
                if isinstance(recipients, str):
                    # Parse comma-separated string
                    recipients = [r.strip() for r in recipients.split(",") if r.strip()]
                settings["alert_email_recipients"] = recipients
            if "alert_cooldown" in data:
                settings["alert_cooldown"] = max(60, min(86400, int(data["alert_cooldown"])))
            if "alert_update_available" in data:
                settings["alert_update_available"] = bool(data["alert_update_available"])
            if "metrics_public" in data:
                settings["metrics_public"] = bool(data["metrics_public"])
            if "syslog_filter_by_selected_cluster" in data:
                old_val = settings.get("syslog_filter_by_selected_cluster", False)
                settings["syslog_filter_by_selected_cluster"] = bool(data["syslog_filter_by_selected_cluster"])
                if old_val != settings["syslog_filter_by_selected_cluster"]:
                    log_audit(
                        request.session.get("user", "admin"),
                        "settings.syslog",
                        f"Syslog cluster hostname filter {'enabled' if settings['syslog_filter_by_selected_cluster'] else 'disabled'}",
                    )
            # 2026-06-05 - Settings → Syslog: enable/disable the receiver, applied live.
            if "syslog_enabled" in data:
                old_se = settings.get("syslog_enabled", True)
                settings["syslog_enabled"] = bool(data["syslog_enabled"])
                if old_se != settings["syslog_enabled"]:
                    save_server_settings(settings)  # persist before (re)start so the boot gate agrees
                    try:
                        from ProxmoxVEx.background.syslog_server import start_syslog_server, stop_syslog_server

                        start_syslog_server() if settings["syslog_enabled"] else stop_syslog_server()
                    except Exception as _se:
                        logging.warning(f"[Settings] syslog toggle apply failed: {_se}")
                    log_audit(
                        request.session.get("user", "admin"),
                        "settings.syslog",
                        f"Syslog receiver {'enabled' if settings['syslog_enabled'] else 'disabled'}",
                    )
            if "strict_session_ip" in data:
                settings["strict_session_ip"] = bool(data["strict_session_ip"])

            # Default theme for new users
            if "default_theme" in data:
                allowed_themes = [
                    "proxmoxDark",
                    "proxmoxLight",
                    "midnight",
                    "forest",
                    "rose",
                    "ocean",
                    "highContrast",
                    "dracula",
                    "nord",
                    "monokai",
                    "matrix",
                    "sunset",
                    "cyberpunk",
                    "github",
                    "solarizedDark",
                    "gruvbox",
                    "corporateDark",
                    "corporateLight",
                    "enterpriseBlue",  # Corporate themes
                ]
                if data["default_theme"] in allowed_themes:
                    settings["default_theme"] = data["default_theme"]

            # LDAP/Active Directory settings
            ldap_keys = {
                "ldap_enabled": lambda v: bool(v),
                "ldap_server": lambda v: str(v or "").strip(),
                "ldap_port": lambda v: max(1, min(65535, int(v or 389))),
                "ldap_use_ssl": lambda v: bool(v),
                "ldap_use_starttls": lambda v: bool(v),
                "ldap_bind_dn": lambda v: str(v or "").strip(),
                "ldap_base_dn": lambda v: str(v or "").strip(),
                "ldap_user_filter": lambda v: str(v or "(&(objectClass=person)(sAMAccountName={username}))").strip(),
                "ldap_username_attribute": lambda v: str(v or "sAMAccountName").strip(),
                "ldap_email_attribute": lambda v: str(v or "mail").strip(),
                "ldap_display_name_attribute": lambda v: str(v or "displayName").strip(),
                "ldap_group_base_dn": lambda v: str(v or "").strip(),
                "ldap_group_filter": lambda v: str(v or "(&(objectClass=group)(member={user_dn}))").strip(),
                "ldap_admin_group": lambda v: str(v or "").strip(),
                "ldap_user_group": lambda v: str(v or "").strip(),
                "ldap_viewer_group": lambda v: str(v or "").strip(),
                "ldap_default_role": lambda v: str(v).strip() if v else "viewer",  # Accept custom roles too
                "ldap_auto_create_users": lambda v: bool(v),
                "ldap_verify_tls": lambda v: bool(v),  # Persist TLS cert verification toggle
            }

            # Log incoming LDAP data for debugging save issues
            if any(k in data for k in ldap_keys):
                logging.info(
                    f"[LDAP] Incoming save data: server='{_sl(data.get('ldap_server', '<missing>'))}', "
                    f"base_dn='{_sl(data.get('ldap_base_dn', '<missing>'))}', "
                    f"enabled={_sl(data.get('ldap_enabled', '<missing>'))}, "
                    f"bind_dn='{_sl(data.get('ldap_bind_dn', '<missing>'))}'"
                )

            for key, transform in ldap_keys.items():
                if key in data:
                    settings[key] = transform(data[key])

            # Handle ldap_bind_password separately (not in the loop to avoid lambda issues)
            if "ldap_bind_password" in data:
                pwd = str(data["ldap_bind_password"] or "")
                if pwd and pwd != "********":
                    settings["ldap_bind_password"] = get_db()._encrypt(pwd)  # Encrypt bind credential

            # Custom group→role mappings (JSON array)
            # Simplified: just group_dn + role (including custom roles)
            # tenant/tenant_role kept for backwards compat but no longer in UI
            if "ldap_group_mappings" in data:
                mappings = data["ldap_group_mappings"]
                if isinstance(mappings, list):
                    # Validate each mapping
                    clean_mappings = []
                    for m in mappings:
                        if isinstance(m, dict) and m.get("group_dn"):
                            clean_mappings.append({
                                "group_dn": str(m.get("group_dn", "")).strip(),
                                "role": str(m.get("role", "viewer")).strip(),
                            })
                    settings["ldap_group_mappings"] = clean_mappings
                    # Clear old built-in group fields when unified mappings are saved
                    # Prevents priority conflicts (built-in checked before custom in auth)
                    if clean_mappings:
                        settings["ldap_admin_group"] = ""
                        settings["ldap_user_group"] = ""
                        settings["ldap_viewer_group"] = ""

            if any(k in data for k in ldap_keys):
                log_audit(
                    request.session.get("user", "admin"),
                    "settings.ldap",
                    f"LDAP settings updated (enabled={settings.get('ldap_enabled', False)})",
                )
                # Debug: confirm what was actually saved
                logging.info(
                    f"[LDAP] Settings saved: enabled={settings.get('ldap_enabled')}, "
                    f"server='{settings.get('ldap_server', '')}', "
                    f"base_dn='{settings.get('ldap_base_dn', '')}', "
                    f"bind_dn='{settings.get('ldap_bind_dn', '')}', "
                    f"password_set={bool(settings.get('ldap_bind_password'))}"
                )

                # Verify database actually persisted the value (catches write failures)
                try:
                    verify = load_server_settings()
                    v_server = verify.get("ldap_server", "")
                    v_base = verify.get("ldap_base_dn", "")
                    if settings.get("ldap_base_dn") and not v_base:
                        logging.error(
                            f"[LDAP] DB WRITE VERIFICATION FAILED! Saved base_dn='{settings.get('ldap_base_dn')}' but read back '{v_base}'"
                        )
                    elif settings.get("ldap_server") and not v_server:
                        logging.error(
                            f"[LDAP] DB WRITE VERIFICATION FAILED! Saved server='{settings.get('ldap_server')}' but read back '{v_server}'"
                        )
                except Exception as ve:
                    logging.warning(f"[LDAP] DB verification failed: {ve}")

            # OIDC / Entra ID settings
            oidc_keys = {
                "oidc_enabled": lambda v: bool(v),
                "oidc_provider": lambda v: str(v) if v in ("entra", "okta", "generic") else "entra",
                "oidc_cloud_environment": lambda v: (
                    str(v) if v in ("commercial", "gcc", "gcc_high", "dod") else "commercial"
                ),  # GCC High/DoD
                "oidc_client_id": lambda v: str(v).strip(),
                "oidc_tenant_id": lambda v: str(v).strip(),
                "oidc_authority": lambda v: str(v).strip(),
                "oidc_scopes": lambda v: (
                    str(v).strip()
                    or (
                        "openid profile email User.Read GroupMember.Read.All"
                        if settings.get("oidc_provider") == "entra"
                        else "openid profile email"
                    )
                ),
                "oidc_redirect_uri": lambda v: str(v).strip(),
                "oidc_admin_group_id": lambda v: str(v).strip(),
                "oidc_user_group_id": lambda v: str(v).strip(),
                "oidc_viewer_group_id": lambda v: str(v).strip(),
                "oidc_default_role": lambda v: str(v).strip() if v else ROLE_VIEWER,  # Accept custom roles too
                "oidc_auto_create_users": lambda v: bool(v),
                "oidc_button_text": lambda v: str(v).strip() or "Sign in with Microsoft",
                "oidc_skip_jwt_verification": lambda v: bool(v),
                # (#188) - opt-in TLS-skip for self-hosted IdPs with self-signed certs
                "oidc_skip_ssl_verify": lambda v: bool(v),
                # (#412) - opt-in private-IP allowlist for OIDC discovery URL
                "oidc_allow_private_ip": lambda v: bool(v),
                # (PVE 9.2 parity) - extra audiences accepted on
                # JWT verify, comma-separated. Empty = client_id only.
                "oidc_audiences": lambda v: str(v or "").strip(),
            }

            for key, transform in oidc_keys.items():
                if key in data:
                    settings[key] = transform(data[key])

            # Encrypt OIDC client secret
            if "oidc_client_secret" in data:
                secret = str(data["oidc_client_secret"] or "")
                if secret and secret != "********":
                    settings["oidc_client_secret"] = get_db()._encrypt(secret)

            # OIDC custom group mappings
            # Simplified: just group_id + role (including custom roles)
            if "oidc_group_mappings" in data:
                mappings = data["oidc_group_mappings"]
                if isinstance(mappings, list):
                    clean = []
                    for m in mappings:
                        if isinstance(m, dict) and (m.get("group_id") or m.get("group_dn")):
                            clean.append({
                                "group_id": str(m.get("group_id") or m.get("group_dn", "")).strip(),
                                "role": str(m.get("role", "viewer")).strip(),
                            })
                    settings["oidc_group_mappings"] = clean
                    # Clear old built-in group fields when unified mappings are saved
                    if clean:
                        settings["oidc_admin_group_id"] = ""
                        settings["oidc_user_group_id"] = ""
                        settings["oidc_viewer_group_id"] = ""

            if any(k in data for k in oidc_keys):
                log_audit(
                    request.session.get("user", "admin"),
                    "settings.oidc",
                    f"OIDC settings updated (enabled={settings.get('oidc_enabled', False)}, provider={settings.get('oidc_provider', 'entra')})",
                )

        else:
            # form-data (for file uploads)
            domain = request.form.get("domain", "")
            port = request.form.get("port", "5000")
            http_redirect_port = request.form.get("http_redirect_port", "0")
            ssl_enabled = request.form.get("ssl_enabled", "false").lower() == "true"
            default_theme = request.form.get("default_theme", "proxmoxDark")
            reverse_proxy = request.form.get("reverse_proxy_enabled", "false").lower() == "true"
            trusted_proxies = request.form.get("trusted_proxies", "").strip()
            proxy_bind = request.form.get("proxy_bind_address", "").strip()

            if settings.get("port") != int(port):
                restart_required = True
            if settings.get("http_redirect_port") != int(http_redirect_port):
                restart_required = True
            if settings.get("ssl_enabled") != ssl_enabled:
                restart_required = True
            if settings.get("reverse_proxy_enabled") != reverse_proxy:
                restart_required = True
            if settings.get("proxy_bind_address", "") != proxy_bind:
                restart_required = True

            settings["domain"] = domain
            settings["port"] = int(port)
            settings["http_redirect_port"] = int(http_redirect_port)
            settings["ssl_enabled"] = ssl_enabled
            settings["reverse_proxy_enabled"] = reverse_proxy
            settings["trusted_proxies"] = trusted_proxies
            settings["proxy_bind_address"] = proxy_bind
            # Compliance settings from form-data branch
            if "audit_retention_days" in request.form:
                old_ar = settings.get("audit_retention_days", 90)
                settings["audit_retention_days"] = max(30, min(3650, int(request.form.get("audit_retention_days", 90))))
                if old_ar != settings["audit_retention_days"]:
                    log_audit(
                        request.session.get("user", "admin"),
                        "settings.audit_retention",
                        f"Audit retention {old_ar} -> {settings['audit_retention_days']} days",
                    )
            if "air_gap_mode" in request.form:
                old_ag = settings.get("air_gap_mode", False)
                settings["air_gap_mode"] = request.form.get("air_gap_mode", "false").lower() == "true"
                if old_ag != settings["air_gap_mode"]:
                    log_audit(
                        request.session.get("user", "admin"),
                        "settings.air_gap",
                        f"Air-gap mode {'enabled' if settings['air_gap_mode'] else 'disabled'}",
                    )
            # ACME settings from multipart form
            settings["acme_enabled"] = (
                request.form.get("acme_enabled", str(settings.get("acme_enabled", "false"))).lower() == "true"
            )
            settings["acme_email"] = request.form.get("acme_email", settings.get("acme_email", "")).strip()
            settings["acme_staging"] = (
                request.form.get("acme_staging", str(settings.get("acme_staging", "false"))).lower() == "true"
            )
            acme_challenge_type = request.form.get(
                "acme_challenge_type", settings.get("acme_challenge_type", "http-01")
            ).strip()
            settings["acme_challenge_type"] = (
                acme_challenge_type if acme_challenge_type in ("http-01", "dns-01") else "http-01"
            )
            settings = _sanitize_acme_dns_settings(settings, request.form)
            acme_provider = request.form.get("acme_provider", settings.get("acme_provider", "letsencrypt")).strip()
            settings["acme_provider"] = acme_provider if acme_provider in ("letsencrypt", "custom") else "letsencrypt"
            settings["acme_directory_url"] = request.form.get(
                "acme_directory_url", settings.get("acme_directory_url", "")
            ).strip()
            if settings["acme_provider"] != "custom":
                settings["acme_directory_url"] = ""
            # hot-reload trusted proxies
            from ProxmoxVEx.utils.audit import load_trusted_proxies

            load_trusted_proxies(trusted_proxies)

            # Default theme for new users
            allowed_themes = [
                "proxmoxDark",
                "proxmoxLight",
                "midnight",
                "forest",
                "rose",
                "ocean",
                "highContrast",
                "dracula",
                "nord",
                "monokai",
                "matrix",
                "sunset",
                "cyberpunk",
                "github",
                "solarizedDark",
                "gruvbox",
                "corporateDark",
                "corporateLight",
                "enterpriseBlue",  # Corporate themes
            ]
            if default_theme in allowed_themes:
                settings["default_theme"] = default_theme

            # alert recipients from form-data (#131)
            if "alert_email_recipients" in request.form:
                try:
                    recipients = json.loads(request.form["alert_email_recipients"])
                    if isinstance(recipients, list):
                        settings["alert_email_recipients"] = [r.strip() for r in recipients if r.strip()]
                except (json.JSONDecodeError, TypeError):
                    pass
            if "alert_cooldown" in request.form:
                settings["alert_cooldown"] = max(60, min(86400, int(request.form["alert_cooldown"])))
            if "alert_update_available" in request.form:
                settings["alert_update_available"] = request.form["alert_update_available"] in ("true", "1", "on")
            if "syslog_filter_by_selected_cluster" in request.form:
                old_syslog_filter = settings.get("syslog_filter_by_selected_cluster", False)
                settings["syslog_filter_by_selected_cluster"] = request.form["syslog_filter_by_selected_cluster"] in (
                    "true",
                    "1",
                    "on",
                )
                if old_syslog_filter != settings["syslog_filter_by_selected_cluster"]:
                    log_audit(
                        request.session.get("user", "admin"),
                        "settings.syslog",
                        f"Syslog cluster hostname filter {'enabled' if settings['syslog_filter_by_selected_cluster'] else 'disabled'}",
                    )
            # 2026-06-05 - Settings → Syslog: enable/disable the receiver (port 1514).
            # Applied live so the toggle opens/closes the port without a restart.
            if "syslog_enabled" in request.form:
                old_syslog_enabled = settings.get("syslog_enabled", True)
                settings["syslog_enabled"] = request.form["syslog_enabled"] in ("true", "1", "on")
                if old_syslog_enabled != settings["syslog_enabled"]:
                    save_server_settings(settings)  # persist before (re)starting so the boot-time gate agrees
                    try:
                        from ProxmoxVEx.background.syslog_server import start_syslog_server, stop_syslog_server

                        if settings["syslog_enabled"]:
                            start_syslog_server()
                        else:
                            stop_syslog_server()
                    except Exception as _se:
                        logging.warning(f"[Settings] syslog toggle apply failed: {_se}")
                    log_audit(
                        request.session.get("user", "admin"),
                        "settings.syslog",
                        f"Syslog receiver {'enabled' if settings['syslog_enabled'] else 'disabled'}",
                    )

            # Handle certificate upload
            if "ssl_cert" in request.files:
                cert_file = request.files["ssl_cert"]
                if cert_file.filename:
                    cert_content = cert_file.read()
                    if b"-----BEGIN CERTIFICATE-----" in cert_content or b"-----BEGIN" in cert_content:
                        with open(SSL_CERT_FILE, "wb") as f:
                            f.write(cert_content)
                        os.chmod(SSL_CERT_FILE, 0o600)
                        restart_required = True
                    else:
                        return jsonify({"error": "Invalid certificate format"}), 400

            # Handle key upload
            if "ssl_key" in request.files:
                key_file = request.files["ssl_key"]
                if key_file.filename:
                    key_content = key_file.read()
                    if b"-----BEGIN" in key_content and b"KEY-----" in key_content:
                        with open(SSL_KEY_FILE, "wb") as f:
                            f.write(key_content)
                        os.chmod(SSL_KEY_FILE, 0o600)
                        restart_required = True
                    else:
                        return jsonify({"error": "Invalid key format"}), 400

            # Handle login background upload - Mar 2026
            # 2026-06-01: write into BRANDING_DIR (config/branding) so the
            # upload survives container recreate. The /images/login_bg.*
            # route at serve_images() checks BRANDING_DIR first.
            if "login_background" in request.files:
                bg_file = request.files["login_background"]
                if bg_file.filename:
                    bg_content = bg_file.read()
                    if len(bg_content) > 2 * 1024 * 1024:
                        return jsonify({"error": "Login background too large (max 2MB)"}), 400
                    ext = os.path.splitext(bg_file.filename)[1].lower()
                    if ext not in (".png", ".jpg", ".jpeg", ".webp", ".svg"):
                        return jsonify({"error": "Invalid image format"}), 400
                    # Validate magic bytes to prevent disguised executables
                    _magic = {".png": b"\x89PNG", ".jpg": b"\xff\xd8\xff", ".jpeg": b"\xff\xd8\xff", ".webp": b"RIFF"}
                    if ext in _magic and not bg_content[:4].startswith(_magic[ext]):
                        return jsonify({"error": "File content does not match extension"}), 400
                    from pathlib import Path as _Path

                    _Path(BRANDING_DIR).mkdir(parents=True, exist_ok=True)
                    bg_path = os.path.join(BRANDING_DIR, "login_bg" + ext)
                    # remove old bg files first — both locations (branding + legacy)
                    for old in _Path(BRANDING_DIR).glob("login_bg.*"):
                        old.unlink(missing_ok=True)
                    for old in _Path(IMAGES_DIR).glob("login_bg.*"):
                        old.unlink(missing_ok=True)
                    with open(bg_path, "wb") as f:
                        f.write(bg_content)
                    settings["login_background"] = "/images/login_bg" + ext

        # save
        logging.info(
            f"[Settings] Saving settings. SMTP enabled={settings.get('smtp_enabled')}, host={settings.get('smtp_host')}"
        )
        if save_server_settings(settings):
            logging.info("[Settings] Settings saved successfully")
            usr = getattr(request, "session", {}).get("user", "system")
            log_audit(usr, "settings.server_updated", f"Settings updated (restart_required={restart_required})")

            # Warn if LDAP enabled but critical fields missing
            warnings = []
            if settings.get("ldap_enabled"):
                if not settings.get("ldap_server"):
                    warnings.append("LDAP server is empty")
                if not settings.get("ldap_base_dn"):
                    warnings.append("LDAP base DN is empty - LDAP login will not work")
                if not settings.get("ldap_bind_dn"):
                    warnings.append("LDAP bind DN is empty - user search may fail")

            return jsonify({
                "success": True,
                "restart_required": restart_required,
                "message": "Settings saved",
                "warnings": warnings if warnings else None,
            })
        else:
            logging.error("[Settings] Failed to save settings")
            return jsonify({"error": "Failed to save settings"}), 500

    except Exception as e:
        logging.error(f"Error updating server settings: {e}", exc_info=True)
        # snyk:ignore:Server Information Exposure
        # lgtm[py/server-information-exposure]
        return jsonify({"error": "Settings update failed"}), 500


@bp.route("/api/settings/login-background", methods=["DELETE"])
@require_auth(perms=["admin.settings"])
def delete_login_background():
    """Remove custom login background — clean both locations (config/branding +
    legacy images/) in case an old install still has the file in the
    pre-2026-06-01 layout."""
    from pathlib import Path as _Path

    for d in (BRANDING_DIR, IMAGES_DIR):
        for old in _Path(d).glob("login_bg.*"):
            old.unlink(missing_ok=True)
    settings = load_server_settings()
    settings["login_background"] = ""
    save_server_settings(settings)
    return jsonify({"success": True})


@bp.route("/api/settings/server/restart", methods=["POST"])
@require_auth(perms=["admin.settings"])
def restart_server():
    """Restart the ProxmoxVEx server (admin only)"""
    try:
        # Audit log
        user = getattr(request, "session", {}).get("user", "system")
        log_audit(user, "settings.server_restart", "Server restart initiated")

        # Send response before restarting
        response = jsonify({"success": True, "message": "Server restart initiated"})

        # Schedule restart in a separate thread
        def do_restart():
            time.sleep(1)  # Give time for response to be sent
            logging.info("Server restart initiated by admin")

            is_root = os.geteuid() == 0 if hasattr(os, "geteuid") else False
            has_sudo = shutil.which("sudo") is not None

            try:
                result = subprocess.run(
                    ["systemctl", "is-active", "ProxmoxVEx"], capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    if is_root:
                        subprocess.run(["systemctl", "restart", "ProxmoxVEx"], capture_output=True, timeout=30)
                        return
                    elif has_sudo:
                        result = subprocess.run(
                            ["sudo", "-n", "systemctl", "restart", "ProxmoxVEx"],
                            capture_output=True,
                            text=True,
                            timeout=30,
                        )
                        if result.returncode == 0:
                            return
            except Exception:
                pass

            # Fallback: exit and let systemd restart
            logging.info("Exiting for systemd restart...")
            os._exit(0)

        restart_thread = threading.Thread(target=do_restart)
        restart_thread.daemon = True
        restart_thread.start()

        return response

    except Exception as e:
        logging.error(f"Error restarting server: {e}", exc_info=True)
        # snyk:ignore:Server Information Exposure
        # lgtm[py/server-information-exposure]
        return jsonify({"error": "Server restart failed"}), 500


# ACME / Let's Encrypt endpoints
@bp.route("/api/settings/acme/status", methods=["GET"])
@require_auth(perms=["node.certificate"])
def get_acme_status():
    """Get ACME certificate status and settings"""
    try:
        from pathlib import Path

        from ProxmoxVEx.core.acme import get_cert_info

        if Path("/usr/lib/ProxmoxVEx").exists():
            ssl_dir = str(Path("/var/lib/ProxmoxVEx/ssl"))
        else:
            ssl_dir = str(Path(__file__).resolve().parent.parent.parent / "ssl")

        settings = load_server_settings()
        cert_info = get_cert_info(ssl_dir)

        return jsonify({
            "acme_enabled": settings.get("acme_enabled", False),
            "acme_email": settings.get("acme_email", ""),
            "acme_staging": settings.get("acme_staging", False),
            "acme_challenge_type": settings.get("acme_challenge_type", "http-01"),
            "acme_dns_provider": settings.get("acme_dns_provider", "manual"),
            "acme_dns_rfc2136_nameserver": settings.get("acme_dns_rfc2136_nameserver", ""),
            "acme_dns_rfc2136_port": settings.get("acme_dns_rfc2136_port", 53),
            "acme_dns_rfc2136_zone": settings.get("acme_dns_rfc2136_zone", ""),
            "acme_dns_rfc2136_key_name": settings.get("acme_dns_rfc2136_key_name", ""),
            "acme_dns_rfc2136_secret": "********" if settings.get("acme_dns_rfc2136_secret") else "",
            "acme_dns_rfc2136_algorithm": settings.get("acme_dns_rfc2136_algorithm", "hmac-sha512"),
            "acme_dns_rfc2136_ttl": settings.get("acme_dns_rfc2136_ttl", 60),
            "acme_dns_propagation_seconds": settings.get("acme_dns_propagation_seconds", 30),
            "acme_provider": settings.get("acme_provider", "letsencrypt"),
            "acme_directory_url": settings.get("acme_directory_url", ""),
            "domain": settings.get("domain", ""),
            "cert": cert_info,
        })
    except Exception as e:
        logging.error(f"ACME status error: {e}", exc_info=True)
        return jsonify({"error": "Failed to get ACME status"}), 500


@bp.route("/api/settings/acme/request", methods=["POST"])
@require_auth(perms=["node.certificate"])
def request_acme_certificate():
    """Request a new ACME certificate — supports Let's Encrypt and custom CAs"""
    try:
        from pathlib import Path

        from ProxmoxVEx.core.acme import request_certificate

        if Path("/usr/lib/ProxmoxVEx").exists():
            ssl_dir = str(Path("/var/lib/ProxmoxVEx/ssl"))
        else:
            ssl_dir = str(Path(__file__).resolve().parent.parent.parent / "ssl")

        settings = load_server_settings()
        data = request.get_json() or {}

        domain = data.get("domain") or settings.get("domain", "")
        email = data.get("email") or settings.get("acme_email", "")
        staging = data.get("staging", settings.get("acme_staging", False))
        challenge_type = str(data.get("challenge_type") or settings.get("acme_challenge_type", "http-01")).strip()
        acme_provider = (
            str(data.get("provider") or settings.get("acme_provider", "letsencrypt")).strip() or "letsencrypt"
        )
        directory_url = str(data.get("directory_url") or settings.get("acme_directory_url", "")).strip()
        if data.get("dns_provider") and not data.get("acme_dns_provider"):
            data["acme_dns_provider"] = data.get("dns_provider")
        settings = _sanitize_acme_dns_settings(settings, data)
        dns_provider = settings.get("acme_dns_provider", "manual")

        if not domain:
            return jsonify({"error": "Domain is required"}), 400
        if acme_provider not in ("letsencrypt", "custom"):
            return jsonify({"error": "Invalid ACME provider"}), 400
        if challenge_type not in ("http-01", "dns-01"):
            return jsonify({"error": "Invalid ACME challenge type"}), 400
        if dns_provider not in ("manual", "rfc2136"):
            return jsonify({"error": "Invalid DNS-01 provider"}), 400
        if challenge_type == "dns-01" and dns_provider == "rfc2136":
            missing = [
                label
                for label, value in (
                    ("RFC 2136 nameserver", settings.get("acme_dns_rfc2136_nameserver")),
                    ("RFC 2136 zone", settings.get("acme_dns_rfc2136_zone")),
                    ("RFC 2136 key name", settings.get("acme_dns_rfc2136_key_name")),
                    ("RFC 2136 secret", settings.get("acme_dns_rfc2136_secret")),
                )
                if not value
            ]
            if missing:
                return jsonify({"error": ", ".join(missing) + " required"}), 400
        if acme_provider == "custom":
            if not directory_url:
                return jsonify({"error": "Custom ACME directory URL is required"}), 400
            if not directory_url.startswith("https://"):
                return jsonify({"error": "ACME directory URL must use HTTPS"}), 400
        else:
            directory_url = ""
        if acme_provider == "letsencrypt" and not email:
            return jsonify({"error": "Email is required for Let's Encrypt"}), 400

        # persist ACME settings
        settings["acme_enabled"] = True
        settings["acme_email"] = email
        settings["acme_staging"] = bool(staging)
        settings["acme_challenge_type"] = challenge_type
        settings["acme_dns_provider"] = dns_provider
        settings["acme_provider"] = acme_provider
        settings["acme_directory_url"] = directory_url
        settings["domain"] = domain
        save_server_settings(settings)

        usr = getattr(request, "session", {}).get("user", "admin")
        log_audit(
            usr,
            "settings.acme_request",
            f"ACME certificate requested for {domain} via {acme_provider} ({challenge_type}/{dns_provider})",
        )

        result = request_certificate(
            domain,
            email,
            ssl_dir,
            staging=staging,
            directory_url=directory_url,
            challenge_type=challenge_type,
            dns_provider=dns_provider,
            dns_config=_acme_dns_config(settings),
        )

        if result["success"]:
            # enable SSL automatically
            settings["ssl_enabled"] = True
            save_server_settings(settings)
            log_audit(
                usr, "settings.acme_issued", f"Certificate issued for {domain}, expires {result.get('expires', '?')}"
            )

        return jsonify(result)

    except Exception as e:
        logging.error(f"ACME request error: {e}", exc_info=True)
        # snyk:ignore:Server Information Exposure
        # lgtm[py/server-information-exposure]
        return jsonify({"error": "Certificate request failed"}), 500


@bp.route("/api/settings/acme/dns/complete", methods=["POST"])
@require_auth(perms=["node.certificate"])
def complete_acme_dns_challenge():
    """Complete a pending ACME DNS-01 certificate request."""
    try:
        from pathlib import Path

        from ProxmoxVEx.core.acme import complete_dns01_challenge

        if Path("/usr/lib/ProxmoxVEx").exists():
            ssl_dir = str(Path("/var/lib/ProxmoxVEx/ssl"))
        else:
            ssl_dir = str(Path(__file__).resolve().parent.parent.parent / "ssl")

        data = request.get_json() or {}
        challenge_id = str(data.get("challenge_id") or "").strip()
        if not challenge_id:
            return jsonify({"error": "DNS-01 challenge ID is required"}), 400

        result = complete_dns01_challenge(challenge_id, ssl_dir)

        if result.get("success"):
            settings = load_server_settings()
            settings["ssl_enabled"] = True
            save_server_settings(settings)
            usr = getattr(request, "session", {}).get("user", "admin")
            log_audit(
                usr, "settings.acme_issued", f"Certificate issued via DNS-01, expires {result.get('expires', '?')}"
            )

        return jsonify(result)
    except Exception as e:
        logging.error(f"ACME DNS-01 completion error: {e}", exc_info=True)
        # snyk:ignore:Server Information Exposure
        # lgtm[py/server-information-exposure]
        return jsonify({"error": "DNS-01 challenge completion failed"}), 500


# ============================================
# Config Backup/Restore API Routes
# Encrypted backups finally
# AES-256-GCM with PBKDF2 key derivation
# ============================================


@bp.route("/api/config/backup", methods=["POST"])
@require_auth(roles=[ROLE_ADMIN])
def backup_config():
    """Export full ProxmoxVEx configuration as encrypted backup (admin only)

    SECURITY: Requires user password confirmation and backup encryption password.
    Double password = prevents stolen sessions from exporting data

    Body:
    - user_password: Current user's password for confirmation
    - backup_password: Password to encrypt the backup file (min 8 chars)
    - include_secrets: Include encrypted passwords/keys (default: false)
    - include_users: Include user accounts (default: true)
    - include_audit: Include audit log (default: false)
    """
    try:
        logging.info("[Backup] Starting config backup...")
        data = request.json or {}

        # 1. Verify user password first
        # Prevents session hijacking from exporting everything
        user_password = data.get("user_password", "")
        if not user_password:
            logging.warning("[Backup] No user password provided")
            return jsonify({"error": "User password required for security verification"}), 400

        username = getattr(request, "session", {}).get("user")
        logging.info(f"[Backup] User from session: {username}")
        if not username:
            logging.warning("[Backup] No user in session")
            return jsonify({"error": "Not authenticated"}), 401

        users = load_users()

        # These type checks saved us hours of debugging
        logging.debug(f"[Backup] Users type: {type(users)}, count: {len(users) if isinstance(users, dict) else 'N/A'}")

        if not isinstance(users, dict):
            logging.error(f"[Backup] Users is not a dict: {type(users)}")
            return jsonify({"error": "User database error"}), 500

        user = users.get(username)

        logging.debug(f"[Backup] User data type: {type(user)}")

        if not user:
            logging.warning(f"[Backup] User {username} not found in database")
            return jsonify({"error": "User not found"}), 404

        # Happened once after a botched migration, better safe than sorry
        if isinstance(user, str):
            logging.error("[Backup] User data is string, not dict")
            return jsonify({"error": "User data format error - please re-login"}), 500

        # Verify password.
        # (#355) - LDAP/OIDC users have no local password_hash; they
        # authenticate against the upstream IdP each time. The old code only
        # checked the local hash, so AD-mapped admins always got "Incorrect
        # password" when creating a config backup. Branch on auth_source.
        auth_source = (user.get("auth_source") if isinstance(user, dict) else None) or "local"
        password_ok = False
        if auth_source == "ldap":
            try:
                from ProxmoxVEx.utils.ldap import ldap_authenticate

                ldap_res = ldap_authenticate(username, user_password)
                password_ok = bool(ldap_res and ldap_res.get("success"))
            except Exception as _ldap_err:
                logging.warning(f"[Backup] LDAP password verification failed for {username}: {_ldap_err}")
                password_ok = False
        else:
            password_salt = user.get("password_salt", "") if isinstance(user, dict) else ""
            password_hash = user.get("password_hash", "") if isinstance(user, dict) else ""
            password_ok = verify_password(user_password, password_salt, password_hash)

        if not password_ok:
            log_audit(username, "config.backup_failed", f"Password verification failed (auth_source={auth_source})")
            logging.warning(f"[Backup] Password verification failed for {username} (auth_source={auth_source})")
            return jsonify({"error": "Incorrect password"}), 401

        logging.debug(f"[Backup] Password verified for {username} via {auth_source}")

        # 2. Validate backup password
        backup_password = data.get("backup_password", "")
        if not backup_password or len(backup_password) < 8:
            logging.warning("[Backup] Backup password too short")
            return jsonify({"error": "Backup password must be at least 8 characters"}), 400

        include_secrets = data.get("include_secrets", False)
        include_users = data.get("include_users", True)
        include_audit = data.get("include_audit", False)

        database = get_db()

        backup_data = {
            "version": ProxmoxVEx_VERSION,
            "build": ProxmoxVEx_BUILD,
            "export_date": datetime.now().isoformat(),
            "exported_by": username,
            "encrypted": True,  # Mark as encrypted backup
        }

        # Server settings
        backup_data["server_settings"] = load_server_settings()
        # Remove sensitive data if not requested
        if not include_secrets:
            if "smtp_password" in backup_data["server_settings"]:
                backup_data["server_settings"]["smtp_password"] = ""
            if "acme_dns_rfc2136_secret" in backup_data["server_settings"]:
                backup_data["server_settings"]["acme_dns_rfc2136_secret"] = ""

        # Clusters
        clusters = database.get_all_clusters()
        if not include_secrets:
            # Remove passwords and keys - clusters is a dict: {'id': {data}}
            for _cluster_id, cluster_data in clusters.items():
                if isinstance(cluster_data, dict):
                    cluster_data.pop("password_encrypted", None)
                    cluster_data.pop("password", None)
                    cluster_data.pop("pass", None)
                    cluster_data.pop("ssh_key_encrypted", None)
                    cluster_data.pop("ssh_key", None)
                    cluster_data.pop("api_token_encrypted", None)
                    cluster_data.pop("api_token", None)
        backup_data["clusters"] = clusters

        # Users (optional)
        if include_users:
            users_data = database.get_all_users()
            if not include_secrets:
                # users_data is a dict: {'username': {data}}
                for _, user_data in users_data.items():
                    if isinstance(user_data, dict):
                        user_data.pop("password_hash", None)
                        user_data.pop("password_salt", None)
                        user_data.pop("totp_secret", None)
                        user_data.pop("totp_secret_encrypted", None)
            backup_data["users"] = users_data

        # Tenants
        backup_data["tenants"] = database.get_all_tenants()

        # VM ACLs
        backup_data["vm_acls"] = database.get_all_vm_acls()

        # Affinity Rules
        backup_data["affinity_rules"] = database.get_affinity_rules()

        # Cluster Groups
        try:
            cursor = database.conn.cursor()
            cursor.execute("SELECT * FROM cluster_groups")
            backup_data["cluster_groups"] = [dict(row) for row in cursor.fetchall()]
        except Exception:
            backup_data["cluster_groups"] = []

        # Custom Scripts
        try:
            cursor = database.conn.cursor()
            cursor.execute("SELECT * FROM custom_scripts WHERE deleted_at IS NULL")
            scripts = [dict(row) for row in cursor.fetchall()]
            # Don't include output in backup
            for script in scripts:
                script.pop("last_output", None)
            backup_data["custom_scripts"] = scripts
        except Exception:
            backup_data["custom_scripts"] = []

        # Audit Log (optional, can be large)
        if include_audit:
            backup_data["audit_log"] = database.get_audit_log(limit=10000)

        logging.debug("[Backup] Encrypting backup data...")
        # 3. Encrypt the backup with AES-256-GCM
        encrypted_backup = _encrypt_backup(json.dumps(backup_data, default=str), backup_password)
        logging.debug(f"[Backup] Encryption complete, size: {len(encrypted_backup)} bytes")

        # Log the backup action
        log_audit(
            username,
            "config.backup",
            f"Configuration exported (secrets={'included' if include_secrets else 'excluded'}, encrypted=True)",
        )

        # Return as downloadable encrypted file
        response = make_response(encrypted_backup)
        response.headers["Content-Type"] = "application/octet-stream"
        response.headers["Content-Disposition"] = (
            f"attachment; filename=ProxmoxVEx-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.proxmoxbackup"
        )

        logging.debug(f"[Backup] Sending response with {len(encrypted_backup)} bytes")
        return response

    except Exception as e:
        logging.exception(f"Config backup failed: {e}", exc_info=True)
        # snyk:ignore:Server Information Exposure
        # lgtm[py/server-information-exposure]
        return jsonify({"error": "Backup creation failed"}), 500


def _encrypt_backup(data: str, password: str) -> bytes:
    """Encrypt backup data with password using AES-256-GCM

    Uses PBKDF2 to derive key from password.
    Format: salt (16 bytes) + nonce (12 bytes) + ciphertext

    Same format as our cluster password encryption
    """
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    # Generate random salt
    salt = os.urandom(16)

    # Derive key from password using PBKDF2
    # 100k iterations is OWASP minimum, good enough for backups
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,  # 256 bits
        salt=salt,
        iterations=100000,  # OWASP recommended minimum
        backend=default_backend(),
    )
    key = kdf.derive(password.encode("utf-8"))

    # Encrypt with AES-256-GCM
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)  # 12 bytes is standard for GCM
    ciphertext = aesgcm.encrypt(nonce, data.encode("utf-8"), None)

    # Combine: salt + nonce + ciphertext
    return salt + nonce + ciphertext


def _decrypt_backup(encrypted_data: bytes, password: str) -> str:
    """Decrypt backup data with password

    Returns decrypted JSON string or raises exception on failure.
    Wrong password will throw InvalidTag exception
    """
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    logging.debug(f"[Decrypt] Input data size: {len(encrypted_data)} bytes")

    if len(encrypted_data) < 28:  # salt (16) + nonce (12)
        logging.error(f"[Decrypt] Data too short: {len(encrypted_data)} bytes (need at least 28)")
        raise ValueError("Invalid backup file format - file too short")

    # Extract components - format is: salt + nonce + ciphertext
    # Same format as our cluster password encryption
    salt = encrypted_data[:16]
    nonce = encrypted_data[16:28]
    ciphertext = encrypted_data[28:]

    logging.debug(f"[Decrypt] Salt: {len(salt)} bytes, Nonce: {len(nonce)} bytes, Ciphertext: {len(ciphertext)} bytes")

    # Derive key from password using PBKDF2
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=100000, backend=default_backend())
    key = kdf.derive(password.encode("utf-8"))

    # Decrypt with AES-256-GCM
    aesgcm = AESGCM(key)
    try:
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)
        logging.debug(f"[Decrypt] Decryption successful, plaintext size: {len(plaintext)} bytes")
        return plaintext.decode("utf-8")
    except Exception:
        # InvalidTag means wrong password, dont log the actual error (security)
        logging.error("[Decrypt] Decryption failed")
        raise ValueError("Incorrect backup password or corrupted file") from None


@bp.route("/api/config/restore", methods=["POST"])
@require_auth(roles=[ROLE_ADMIN])
def restore_config():
    """Import ProxmoxVEx configuration from encrypted backup (admin only)

    SECURITY: Requires user password confirmation and backup decryption password.
    Merge mode is default because overwrite is scary

    Accepts multipart form with:
    - user_password: Current user's password for confirmation
    - backup_password: Password to decrypt the backup file
    - backup_file: The encrypted .proxmoxbackup file
    - mode: 'merge' (default) or 'overwrite'
    - restore_users: Restore user accounts (default: false for safety)
    - dry_run: Validate only, don't apply (default: false)
    """
    try:
        logging.info("[Restore] Starting config restore...")
        # These help when debugging upload issues
        logging.debug(f"[Restore] Content-Type: {request.content_type}")
        logging.debug(f"[Restore] Form keys: {list(request.form.keys())}")
        logging.debug(f"[Restore] Files keys: {list(request.files.keys())}")

        # Get form data
        user_password = request.form.get("user_password", "")
        backup_password = request.form.get("backup_password", "")
        mode = request.form.get("mode", "merge")
        restore_users_str = request.form.get("restore_users", "false")
        dry_run_str = request.form.get("dry_run", "false")

        # Form data comes as strings, need to convert
        restore_users = str(restore_users_str).lower() in ("true", "1", "yes")
        dry_run = str(dry_run_str).lower() in ("true", "1", "yes")

        logging.info(f"[Restore] Mode: {mode}, dry_run: {dry_run}, restore_users: {restore_users}")

        # 1. Verify user password first
        if not user_password:
            logging.warning("[Restore] No user password provided")
            return jsonify({"error": "User password required for security verification"}), 400

        username = getattr(request, "session", {}).get("user")
        logging.debug(f"[Restore] User from session: {username}")
        if not username:
            return jsonify({"error": "Not authenticated"}), 401

        users = load_users()

        # Copy-paste from backup_config, same validation
        logging.debug(f"[Restore] Users type: {type(users)}, count: {len(users) if isinstance(users, dict) else 'N/A'}")

        if not isinstance(users, dict):
            logging.error(f"[Restore] Users is not a dict: {type(users)}")
            return jsonify({"error": "User database error"}), 500

        user = users.get(username)

        logging.debug(f"[Restore] User data type: {type(user)}")
        if user:
            logging.debug(f"[Restore] User keys: {user.keys() if isinstance(user, dict) else 'NOT A DICT'}")

        if not user:
            return jsonify({"error": "User not found"}), 404

        # same legacy check as backup
        if isinstance(user, str):
            logging.error(f"[Restore] User data is string, not dict: {user[:50]}...")
            return jsonify({"error": "User data format error - please re-login"}), 500

        # Verify password (mirror of #355 fix in backup endpoint — LDAP users
        # have no local hash, so re-bind to the IdP for them).
        auth_source = (user.get("auth_source") if isinstance(user, dict) else None) or "local"
        password_ok = False
        if auth_source == "ldap":
            try:
                from ProxmoxVEx.utils.ldap import ldap_authenticate

                ldap_res = ldap_authenticate(username, user_password)
                password_ok = bool(ldap_res and ldap_res.get("success"))
            except Exception as _ldap_err:
                logging.warning(f"[Restore] LDAP password verification failed for {username}: {_ldap_err}")
                password_ok = False
        else:
            password_salt = user.get("password_salt", "") if isinstance(user, dict) else ""
            password_hash = user.get("password_hash", "") if isinstance(user, dict) else ""
            password_ok = verify_password(user_password, password_salt, password_hash)

        if not password_ok:
            log_audit(username, "config.restore_failed", f"Password verification failed (auth_source={auth_source})")
            logging.warning(f"[Restore] Password verification failed for {username} (auth_source={auth_source})")
            return jsonify({"error": "Incorrect password"}), 401

        logging.debug(f"[Restore] Password verified for {username} via {auth_source}")

        # 2. Validate backup password
        if not backup_password:
            return jsonify({"error": "Backup password required to decrypt file"}), 400

        # 3. Get backup file
        if "backup_file" not in request.files:
            logging.warning("[Restore] No backup_file in request.files")
            return jsonify({"error": "No backup file provided"}), 400

        backup_file = request.files["backup_file"]
        if not backup_file.filename:
            return jsonify({"error": "No backup file selected"}), 400

        logging.debug(f"[Restore] Processing file: {_sl(backup_file.filename)}")

        # Read and decrypt
        encrypted_data = backup_file.read()
        logging.debug(f"[Restore] Read {len(encrypted_data)} bytes from file")

        try:
            decrypted_json = _decrypt_backup(encrypted_data, backup_password)
            data = json.loads(decrypted_json)
        except ValueError as e:
            log_audit(username, "config.restore_failed", f"Decryption failed: {str(e)}")
            # snyk:ignore:Server Information Exposure
            # lgtm[py/server-information-exposure]
            return jsonify({"error": "Backup decryption failed"}), 400
        except json.JSONDecodeError:
            return jsonify({"error": "Invalid backup file format"}), 400

        # Validate backup format
        if "version" not in data or "export_date" not in data:
            return jsonify({"error": "Invalid backup format - missing required fields"}), 400

        database = get_db()
        results = {
            "mode": mode,
            "dry_run": dry_run,
            "backup_version": data.get("version"),
            "backup_date": data.get("export_date"),
            "backup_by": data.get("exported_by"),
            "restored": {},
            "skipped": {},
            "errors": [],
        }

        # Server Settings
        if "server_settings" in data:
            try:
                if not dry_run:
                    current = load_server_settings()
                    if mode == "merge":
                        # Only update non-empty values
                        for key, value in data["server_settings"].items():
                            if value not in [None, "", []]:
                                current[key] = value
                        save_server_settings(current)
                    else:
                        save_server_settings(data["server_settings"])
                results["restored"]["server_settings"] = True
            except Exception as e:
                results["errors"].append(f"Server settings: {str(e)}")

        # Clusters
        if "clusters" in data:
            cluster_count = 0
            clusters_data = data["clusters"]

            # Log types because old backups might have different formats
            logging.debug(f"[Restore] Clusters type: {type(clusters_data)}")
            if isinstance(clusters_data, list) and len(clusters_data) > 0:
                logging.debug(f"[Restore] First cluster type: {type(clusters_data[0])}")

            # Handle both list of dicts and dict of dicts formats
            # We changed the export format once, need to support both
            if isinstance(clusters_data, dict):
                # Format: {'cluster_id': {cluster_data}, ...}
                clusters_list = [{"id": k, **v} if isinstance(v, dict) else {"id": k} for k, v in clusters_data.items()]
            elif isinstance(clusters_data, list):
                clusters_list = clusters_data
            else:
                clusters_list = []
                results["errors"].append(
                    f"Clusters: Invalid format (expected list or dict, got {type(clusters_data).__name__})"
                )

            for cluster in clusters_list:
                try:
                    # Skip if not a dict
                    if not isinstance(cluster, dict):
                        logging.warning(f"[Restore] Skipping non-dict cluster: {type(cluster)}")
                        continue

                    cluster_id = cluster.get("id")
                    if not cluster_id:
                        logging.warning("[Restore] Skipping cluster without id")
                        continue

                    existing = database.get_cluster(cluster_id)

                    if existing and mode == "merge":
                        # Keep existing passwords if not in backup
                        if not cluster.get("password_encrypted") and existing.get("password_encrypted"):
                            cluster["password_encrypted"] = existing["password_encrypted"]
                        if not cluster.get("ssh_key_encrypted") and existing.get("ssh_key_encrypted"):
                            cluster["ssh_key_encrypted"] = existing["ssh_key_encrypted"]

                    if not dry_run:
                        database.save_cluster(cluster_id, cluster)
                    cluster_count += 1
                except Exception as e:
                    cluster_id_str = cluster.get("id", "unknown") if isinstance(cluster, dict) else str(cluster)[:20]
                    results["errors"].append(f"Cluster {cluster_id_str}: {str(e)}")
            results["restored"]["clusters"] = cluster_count

        # Users (only if explicitly requested)
        if restore_users and "users" in data:
            user_count = 0
            users_data = data["users"]

            # Handle both list and dict formats
            if isinstance(users_data, dict):
                # Format: {'username': {user_data}, ...}
                users_list = [
                    {"username": k, **v} if isinstance(v, dict) else {"username": k} for k, v in users_data.items()
                ]
            elif isinstance(users_data, list):
                users_list = users_data
            else:
                users_list = []
                results["errors"].append("Users: Invalid format")

            for u in users_list:
                try:
                    if not isinstance(u, dict):
                        continue
                    uname = u.get("username")
                    if not uname or uname == "admin" or uname == "ProxmoxVEx":  # Never overwrite admin
                        continue

                    if not dry_run:
                        database.save_user(uname, u)
                    user_count += 1
                except Exception as e:
                    uname_str = u.get("username", "unknown") if isinstance(u, dict) else str(u)[:20]
                    results["errors"].append(f"User {uname_str}: {str(e)}")
            results["restored"]["users"] = user_count
        else:
            results["skipped"]["users"] = "Not requested (safety)"

        # Tenants
        if "tenants" in data:
            tenant_count = 0
            tenants_data = data["tenants"]

            # Handle both list and dict formats
            if isinstance(tenants_data, dict):
                tenants_list = [{"id": k, **v} if isinstance(v, dict) else {"id": k} for k, v in tenants_data.items()]
            elif isinstance(tenants_data, list):
                tenants_list = tenants_data
            else:
                tenants_list = []

            for tenant in tenants_list:
                try:
                    if not isinstance(tenant, dict):
                        continue
                    if not dry_run:
                        database.save_tenant(tenant.get("id"), tenant)
                    tenant_count += 1
                except Exception as e:
                    results["errors"].append(f"Tenant: {str(e)}")
            results["restored"]["tenants"] = tenant_count

        # VM ACLs
        if "vm_acls" in data:
            try:
                if not dry_run:
                    if mode == "overwrite":
                        # Clear existing
                        database.conn.cursor().execute("DELETE FROM vm_acls")
                    database.save_all_vm_acls(data["vm_acls"])
                    # This path writes vm_acls directly (bypassing
                    # rbac.save_vm_acls), so drop the TTL-cached ACLs so the restore
                    # takes effect immediately for permission checks.
                    from ProxmoxVEx.utils.rbac import invalidate_vm_acls_cache

                    invalidate_vm_acls_cache()
                results["restored"]["vm_acls"] = len(data["vm_acls"])
            except Exception as e:
                results["errors"].append(f"VM ACLs: {str(e)}")

        # Affinity Rules
        if "affinity_rules" in data:
            rule_count = 0
            for cluster_id, rules in data["affinity_rules"].items():
                for rule in rules:
                    try:
                        if not dry_run:
                            database.save_affinity_rule(cluster_id, rule)
                        rule_count += 1
                    except Exception as e:
                        results["errors"].append(f"Affinity rule: {str(e)}")
            results["restored"]["affinity_rules"] = rule_count

        # Cluster Groups
        if "cluster_groups" in data:
            group_count = 0
            cursor = database.conn.cursor()
            for group in data["cluster_groups"]:
                try:
                    if not dry_run:
                        cursor.execute(
                            """
                            INSERT OR REPLACE INTO cluster_groups (id, name, tenant_id, description, created_at)
                            VALUES (?, ?, ?, ?, ?)
                        """,
                            (
                                group.get("id"),
                                group.get("name"),
                                group.get("tenant_id"),
                                group.get("description"),
                                group.get("created_at", datetime.now().isoformat()),
                            ),
                        )
                    group_count += 1
                except Exception as e:
                    results["errors"].append(f"Cluster group: {str(e)}")
            if not dry_run:
                database.conn.commit()
            results["restored"]["cluster_groups"] = group_count

        # Log the restore action
        if not dry_run:
            log_audit(username, "config.restore", f"Configuration restored from backup ({mode} mode)")
        else:
            log_audit(username, "config.restore_dryrun", f"Configuration restore dry-run ({mode} mode)")

        return jsonify(results)

    except Exception as e:
        logging.exception(f"Config restore failed: {e}", exc_info=True)
        # snyk:ignore:Server Information Exposure
        # lgtm[py/server-information-exposure]
        return jsonify({"error": "Config restore failed"}), 500


# ============================================
# IP Whitelisting API Routes
# Enterprise feature request
# ============================================

# IP Whitelist storage (loaded from settings)
_ip_whitelist_enabled = False
_ip_whitelist = set()
_ip_blacklist = set()  # Blacklist always wins over whitelist


def load_ip_whitelist():
    """Load IP whitelist from server settings"""
    global _ip_whitelist_enabled, _ip_whitelist, _ip_blacklist

    try:
        settings = load_server_settings()
        _ip_whitelist_enabled = settings.get("ip_whitelist_enabled", False)

        # 'or' handles None values from old configs
        whitelist_str = settings.get("ip_whitelist") or ""
        _ip_whitelist = {ip.strip() for ip in whitelist_str.split(",") if ip.strip()}

        blacklist_str = settings.get("ip_blacklist") or ""
        _ip_blacklist = {ip.strip() for ip in blacklist_str.split(",") if ip.strip()}
    except Exception as e:
        logging.warning(f"Could not load IP whitelist: {e}", exc_info=True)
        _ip_whitelist_enabled = False
        _ip_whitelist = set()
        _ip_blacklist = set()


def check_ip_allowed(client_ip: str) -> tuple:
    """check if client IP is allowed, returns (allowed, reason)"""
    if not _ip_whitelist_enabled:
        return True, "Whitelist disabled"

    if not client_ip:
        return False, "No IP detected"

    # Normalize here too so log messages show clean IPv4
    client_ip = _normalize_ip(client_ip)

    # Check blacklist first (always blocks)
    # Blacklist is checked before whitelist, security first
    if _ip_blacklist:
        for blocked in _ip_blacklist:
            if _ip_matches(client_ip, blocked):
                return False, f"IP blacklisted: {blocked}"

    # If whitelist is empty, allow all (only blacklist applies)
    if not _ip_whitelist:
        return True, "No whitelist configured"

    # Check whitelist
    for allowed in _ip_whitelist:
        if _ip_matches(client_ip, allowed):
            return True, f"IP allowed: {allowed}"

    return False, "IP not in whitelist"


def _normalize_ip(ip_str: str) -> str:
    """Strip IPv6-mapped prefix so ::ffff:192.168.1.1 becomes 192.168.1.1

    Dual-stack sockets report IPv4 clients as ::ffff:x.x.x.x
    Fixes #95: IP whitelist didn't match after IPv6 bind change
    """
    if ip_str and ip_str.startswith("::ffff:"):
        return ip_str[7:]
    return ip_str


def _ip_matches(client_ip: str, pattern: str) -> bool:
    """Check if IP matches pattern (supports CIDR and wildcards)

    Supports 192.168.1.100, 192.168.1.0/24, 192.168.1.*
    """
    try:
        # Normalize IPv6-mapped addresses for comparison
        client_ip = _normalize_ip(client_ip)

        # Exact match
        if client_ip == pattern:
            return True

        # Wildcard match (e.g., 192.168.1.*)
        if "*" in pattern:
            import fnmatch

            return fnmatch.fnmatch(client_ip, pattern)

        # CIDR match (e.g., 192.168.1.0/24)
        if "/" in pattern:
            import ipaddress

            network = ipaddress.ip_network(pattern, strict=False)
            return ipaddress.ip_address(client_ip) in network

        return False
    except Exception:
        return False


# Load whitelist on startup
with contextlib.suppress(Exception):
    load_ip_whitelist()  # Settings might not exist yet


@bp.before_app_request
def check_ip_whitelist():
    """Check IP whitelist before processing request"""
    # Skip for static files
    if request.path.startswith("/static"):
        return None
    # LE validation servers need access to challenge endpoint
    if request.path.startswith("/.well-known/"):
        return None

    # Skip if whitelist not enabled
    if not _ip_whitelist_enabled:
        return None

    client_ip = get_client_ip()
    allowed, reason = check_ip_allowed(client_ip)

    if not allowed:
        logging.warning(f"IP blocked: {client_ip} - {reason}")
        return jsonify({
            "error": "Access denied",
            "message": "Your IP address is not allowed to access this service",
            "ip": client_ip,
        }), 403


@bp.route("/api/security/ip-whitelist", methods=["GET"])
@require_auth(perms=["security.settings.manage"])
def get_ip_whitelist():
    """Get IP whitelist configuration (admin only)"""
    try:
        settings = load_server_settings()

        whitelist_str = settings.get("ip_whitelist") or ""
        blacklist_str = settings.get("ip_blacklist") or ""

        return jsonify({
            "enabled": settings.get("ip_whitelist_enabled", False),
            "whitelist": [ip.strip() for ip in whitelist_str.split(",") if ip.strip()],
            "blacklist": [ip.strip() for ip in blacklist_str.split(",") if ip.strip()],
            "your_ip": get_client_ip(),
            "formats_supported": ["Single IP (192.168.1.100)", "CIDR (192.168.1.0/24)", "Wildcard (192.168.1.*)"],
        })
    except Exception as e:
        logging.error(f"Error getting IP whitelist: {e}", exc_info=True)
        # snyk:ignore:Server Information Exposure
        # lgtm[py/server-information-exposure]
        return jsonify({"error": "IP whitelist load failed"}), 500


@bp.route("/api/security/ip-whitelist", methods=["POST"])
@require_auth(perms=["security.settings.manage"])
def update_ip_whitelist():
    """Update IP whitelist configuration (admin only)

    Body:
    - enabled: bool
    - whitelist: list of IPs/CIDRs
    - blacklist: list of IPs/CIDRs
    """
    try:
        data = request.json or {}
        settings = load_server_settings()
        current_ip = get_client_ip()

        # Validate that admin's current IP would still be allowed
        if data.get("enabled", False):
            new_whitelist = set(data.get("whitelist", []))
            new_blacklist = set(data.get("blacklist", []))

            # Check if current IP would be blocked
            if new_whitelist:
                allowed = False
                for pattern in new_whitelist:
                    if _ip_matches(current_ip, pattern):
                        allowed = True
                        break

                if not allowed:
                    return jsonify({
                        "error": "Your current IP would be blocked",
                        "message": f"Add {current_ip} to the whitelist before enabling",
                        "your_ip": current_ip,
                    }), 400

            # Check blacklist doesn't include current IP
            for pattern in new_blacklist:
                if _ip_matches(current_ip, pattern):
                    return jsonify({
                        "error": "Your current IP is in the blacklist",
                        "message": f"Remove {current_ip} from the blacklist",
                        "your_ip": current_ip,
                    }), 400

        # Update settings
        if "enabled" in data:
            settings["ip_whitelist_enabled"] = bool(data["enabled"])

        if "whitelist" in data:
            settings["ip_whitelist"] = ",".join(data["whitelist"])

        if "blacklist" in data:
            settings["ip_blacklist"] = ",".join(data["blacklist"])

        save_server_settings(settings)

        # Reload whitelist
        load_ip_whitelist()

        # Audit log
        usr = getattr(request, "session", {}).get("user", "system")
        log_audit(
            usr,
            "security.ip_whitelist_updated",
            f"IP whitelist {'enabled' if settings.get('ip_whitelist_enabled') else 'disabled'}, "
            f"{len(_ip_whitelist)} IPs whitelisted, {len(_ip_blacklist)} IPs blacklisted",
        )

        return jsonify({
            "success": True,
            "enabled": settings.get("ip_whitelist_enabled", False),
            "whitelist_count": len(_ip_whitelist),
            "blacklist_count": len(_ip_blacklist),
        })

    except Exception as e:
        logging.error(f"IP whitelist update failed: {e}", exc_info=True)
        # snyk:ignore:Server Information Exposure
        # lgtm[py/server-information-exposure]
        return jsonify({"error": "IP whitelist update failed"}), 500


@bp.route("/api/security/ip-whitelist/test", methods=["POST"])
@require_auth(perms=["security.settings.manage"])
def test_ip_whitelist():
    """Test if an IP would be allowed (admin only)

    Body:
    - ip: IP address to test
    """
    try:
        data = request.json or {}
        test_ip = data.get("ip", get_client_ip())

        allowed, reason = check_ip_allowed(test_ip)

        return jsonify({
            "ip": test_ip,
            "allowed": allowed,
            "reason": reason,
            "whitelist_enabled": _ip_whitelist_enabled,
        })

    except Exception as e:
        logging.error(f"IP whitelist test error: {e}", exc_info=True)
        return jsonify({"error": "IP whitelist test failed"}), 500


# ============================================
# Audit Log API Route
# ============================================


@bp.route("/api/audit", methods=["GET"])
@require_auth(perms=["admin.audit"])
def get_audit_log_api():
    """Get audit log entries (admin only). ?format=csv streams CSV for compliance export."""
    # Optional filters
    user_filter = request.args.get("user")
    action_filter = request.args.get("action")
    limit = max(1, min(10000, sanitize_int(request.args.get("limit", 500), default=500)))
    verify = request.args.get("verify", "").lower() == "true"
    fmt = (request.args.get("format") or "json").lower()

    # Get from database with optional integrity verification
    database = get_db()
    entries = database.get_audit_log(limit=limit, user=user_filter, action=action_filter, verify_integrity=verify)

    if fmt == "csv":
        # Compliance-ready CSV. Streamed to avoid holding the
        # full serialized blob in memory for a 10k-entry export.
        import csv
        import io

        buf = io.StringIO()
        # union of keys across returned rows (safer than hard-coding; rows may have extras)
        cols = ["timestamp", "user", "action", "details", "ip_address", "cluster", "severity"]
        if entries:
            extra = sorted({k for e in entries for k in e} - set(cols) - {"signature"})
            cols += extra
        writer = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore", quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        for row in entries:
            # Sanitize all fields to prevent CSV formula injection (CWE-1236)
            # Neutralizes leading =, +, -, @, tab, CR that trigger formula evaluation
            sanitized_row = {c: sanitize_csv_field(row.get(c, "")) for c in cols}
            writer.writerow(sanitized_row)
        ts = time.strftime("%Y%m%d_%H%M%S")
        resp = Response(buf.getvalue(), mimetype="text/csv; charset=utf-8")
        resp.headers["Content-Disposition"] = f"attachment; filename=ProxmoxVEx_audit_{ts}.csv"
        return resp

    return jsonify(entries)


# Cluster-specific audit endpoint with vmid filter
@bp.route("/api/clusters/<cluster_id>/audit", methods=["GET"])
@require_auth(perms=["cluster.view"])
def get_cluster_audit_log_api(cluster_id):
    """Get audit log entries for a specific cluster, optionally filtered by vmid"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403

    # Get cluster name for filtering
    cluster_name = None
    if cluster_id in cluster_managers:
        cluster_name = cluster_managers[cluster_id].config.name

    # Check if we're in multi-cluster mode
    multi_cluster = len(cluster_managers) > 1

    # Optional filters
    vmid = request.args.get("vmid")
    limit = max(1, min(10000, sanitize_int(request.args.get("limit", 100), default=100)))

    # Get from database
    database = get_db()
    entries = database.get_audit_log(limit=limit * 10)  # Get more to filter

    # Filter by cluster and vmid
    filtered = []
    for entry in entries:
        entry_cluster = entry.get("cluster", "")
        details = entry.get("details", "")

        # Cluster filter
        if cluster_name:
            detected_cluster = None

            # First check the cluster field
            if entry_cluster:
                detected_cluster = entry_cluster
            else:
                # Try to detect cluster from details text
                import re

                # Look for [SomeCluster] pattern at end
                bracket_match = re.search(r"\[([^\]]+)\]\s*$", details)
                if bracket_match:
                    detected_cluster = bracket_match.group(1)
                else:
                    # Look for "for cluster X" or "cluster X" pattern
                    cluster_match = re.search(r"(?:for )?cluster\s+(\S+)", details, re.IGNORECASE)
                    if cluster_match:
                        detected_cluster = cluster_match.group(1)

            # If we detected a cluster, it must match
            if detected_cluster:
                if detected_cluster != cluster_name:
                    continue
            else:
                # No cluster info at all - skip in multi-cluster mode
                if multi_cluster:
                    continue

        # Check vmid filter
        if vmid:
            vmid_str = str(vmid)
            vmid_found = False

            # Check for patterns in details
            patterns = [
                f"VM {vmid_str} ",
                f"VM {vmid_str}-",
                f"VM {vmid_str})",
                f"CT {vmid_str} ",
                f"CT {vmid_str}-",
                f"CT {vmid_str})",
                f"QEMU {vmid_str} ",
                f"QEMU {vmid_str}-",
                f"QEMU {vmid_str})",
                f"LXC {vmid_str} ",
                f"LXC {vmid_str}-",
                f"/{vmid_str} ",
                f"/{vmid_str})",
                f"qemu/{vmid_str}",
                f"lxc/{vmid_str}",
            ]

            for pattern in patterns:
                if pattern in details:
                    vmid_found = True
                    break

            # Also check if details ends with the vmid pattern
            if not vmid_found:
                for ending in [f"VM {vmid_str}", f"CT {vmid_str}", f"QEMU {vmid_str}", f"LXC {vmid_str}"]:
                    if details.endswith(ending):
                        vmid_found = True
                        break

            if not vmid_found:
                continue

        filtered.append(entry)
        if len(filtered) >= limit:
            break

    # snyk:ignore:Cross-site Scripting (XSS)
    # lgtm[py/reflected-xss]
    return jsonify(filtered)


@bp.route("/api/audit/integrity", methods=["GET"])
@require_auth(perms=["admin.audit"])
def verify_audit_integrity():
    """Verify integrity of audit log using HMAC signatures (admin only)

    Returns statistics about log integrity:
    - total_entries: Total number of entries
    - verified: Entries with valid HMAC signature
    - unsigned: Old entries without signature (pre-upgrade)
    - potentially_tampered: Entries with invalid signature (WARNING!)
    - integrity_percentage: Percentage of verified entries
    """
    database = get_db()
    result = database.verify_audit_log_integrity()

    # Log this check itself
    usr = getattr(request, "session", {}).get("user", "system")
    log_audit(
        usr,
        "audit.integrity_check",
        f"Audit integrity check: {result['verified']}/{result['total_entries']} verified, {result['potentially_tampered']} potentially tampered",
    )

    return jsonify(result)


@bp.route("/api/security/key-info", methods=["GET"])
@require_auth(perms=["security.settings.manage"])
def get_encryption_key_info():
    """get info about current encryption key (exists, created, algorithm, backups)"""
    database = get_db()
    return jsonify(database.get_key_info())


@bp.route("/api/security/key-rotate", methods=["POST"])
@require_auth(perms=["security.settings.manage"])
def rotate_encryption_key():
    """Rotate the encryption key (admin only)

    IMPORTANT: This re-encrypts all sensitive data with a new key.
    Required for HIPAA/ISO 27001 compliance (periodic key rotation).

    The old key is backed up before rotation.
    """
    usr = getattr(request, "session", {}).get("user", "system")

    # Confirm action
    data = request.json or {}
    if not data.get("confirm"):
        return jsonify({
            "error": "Key rotation requires confirmation",
            "message": 'Send {"confirm": true} to proceed. This will re-encrypt all data.',
        }), 400

    log_audit(usr, "security.key_rotation_started", "Encryption key rotation initiated")

    database = get_db()
    result = database.rotate_encryption_key()

    if result.get("success"):
        log_audit(
            usr,
            "security.key_rotation_completed",
            f"Key rotation completed: {result.get('users_rotated', 0)} users, "
            f"{result.get('clusters_rotated', 0)} clusters rotated",
        )
        return jsonify(result)
    else:
        log_audit(usr, "security.key_rotation_failed", f"Key rotation failed: {result.get('error', 'Unknown error')}")
        return jsonify(result), 500


@bp.route("/api/security/compliance", methods=["GET"])
@require_auth(perms=["security.settings.manage"])
def get_compliance_status():
    """Get security compliance status (admin only)

    Returns overview of security features for HIPAA/ISO 27001 compliance.
    """
    try:
        settings = load_server_settings()
        database = get_db()
        key_info = database.get_key_info()

        # Calculate compliance score
        # Each check is worth the same, simple but effective
        checks = {
            "encryption_enabled": ENCRYPTION_AVAILABLE and key_info.get("exists", False),
            # Behind reverse proxy, HTTPS is handled by the proxy
            "https_enabled": os.path.exists(SSL_CERT_FILE)
            and os.path.exists(SSL_KEY_FILE)
            or settings.get("reverse_proxy_enabled", False)
            or request.headers.get("X-Forwarded-Proto") == "https",
            "password_policy_enabled": settings.get("password_min_length", 8) >= 8,
            "session_timeout_compliant": settings.get("session_timeout", SESSION_TIMEOUT) <= 28800,  # 8h max for HIPAA
            "2fa_available": TOTP_AVAILABLE,
            "audit_logging_enabled": True,  # Always enabled
            "rate_limiting_enabled": API_RATE_LIMIT > 0,
            "brute_force_protection": True,  # Always enabled
        }

        score = sum(1 for v in checks.values() if v) / len(checks) * 100

        return jsonify({
            "compliance_score": round(score, 1),
            "checks": checks,
            "encryption": {
                "algorithm": "AES-256-GCM",
                "key_exists": key_info.get("exists", False),
                "key_created": key_info.get("created"),
                "last_rotation": key_info.get("last_modified"),
                "backups_count": len(key_info.get("backups", [])),
            },
            "session": {
                "timeout_seconds": settings.get("session_timeout", SESSION_TIMEOUT),
                "timeout_hours": settings.get("session_timeout", SESSION_TIMEOUT) / 3600,
            },
            "password_policy": {
                "min_length": settings.get("password_min_length", 8),
                "require_uppercase": settings.get("password_require_uppercase", True),
                "require_lowercase": settings.get("password_require_lowercase", True),
                "require_numbers": settings.get("password_require_numbers", True),
                "require_special": settings.get("password_require_special", False),
                "expiry_enabled": settings.get("password_expiry_enabled", False),
                "expiry_days": settings.get("password_expiry_days", 90),
            },
            "recommendations": [
                r
                for r in [
                    None
                    if checks["https_enabled"]
                    else "Enable HTTPS with valid certificates (or enable reverse proxy mode if using nginx/Traefik)",
                    None if checks["session_timeout_compliant"] else "Reduce session timeout to 8 hours or less",
                    None
                    if settings.get("password_require_special")
                    else "Consider requiring special characters in passwords",
                    None if settings.get("password_expiry_enabled") else "Consider enabling password expiry",
                    None if key_info.get("backups") else "Perform initial key rotation to create backup",
                    None
                    if not _check_default_password_in_use()
                    else "CRITICAL: Default admin password is still in use! Change it immediately.",
                ]
                if r is not None
            ],
            "default_password_warning": _check_default_password_in_use(),
        })
    except Exception as e:
        logging.exception(f"Error getting compliance status: {e}", exc_info=True)
        # snyk:ignore:Server Information Exposure
        # lgtm[py/server-information-exposure]
        return jsonify({"error": "Compliance check failed"}), 500


@bp.route("/api/security/cors", methods=["GET"])
@require_auth(perms=["security.settings.manage"])
def get_cors_origins():
    """Get configured CORS origins (admin only)"""
    env_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()] if _cors_origins_env else []

    return jsonify({
        "mode": "same-origin" if not env_origins and not _auto_allowed_origins else "configured",
        "environment_origins": env_origins,
        "auto_allowed_origins": list(_auto_allowed_origins),
        "all_allowed": get_allowed_origins() or [],
        "help": {
            "same-origin": "Only requests from the same host are allowed (most secure)",
            "configured": "Specific origins are allowed",
            "env_variable": "PROXMOXVEX_ALLOWED_ORIGINS",
            "example": 'export PROXMOXVEX_ALLOWED_ORIGINS="https://ProxmoxVEx.example.com"',
        },
    })


@bp.route("/api/security/cors", methods=["POST"])
@require_auth(perms=["security.settings.manage"])
def add_cors_origin():
    """Manually add a CORS origin (admin only)

    Note: This is temporary (until server restart). For permanent origins,
    use the PROXMOXVEX_ALLOWED_ORIGINS environment variable.
    """
    data = request.json or {}
    origin = data.get("origin", "").strip()

    if not origin:
        return jsonify({"error": "Origin required"}), 400

    if not origin.startswith(("http://", "https://")):
        return jsonify({"error": "Origin must start with http:// or https://"}), 400

    if origin == "*":
        return jsonify({"error": "Wildcard (*) not allowed for security reasons"}), 400

    add_allowed_origin(origin)

    usr = getattr(request, "session", {}).get("user", "system")
    log_audit(usr, "security.cors_origin_added", f"Added CORS origin: {origin}")

    return jsonify({
        "success": True,
        "message": f"Origin {origin} added",
        "note": "This is temporary until server restart. Set PROXMOXVEX_ALLOWED_ORIGINS env var for permanent configuration.",
    })


def _serve_index():
    """Serve the web interface (shared by / and /<path>)."""
    import os as _os

    air_gap = bool(load_server_settings().get("air_gap_mode", False))
    index_path = _os.path.join(WEB_DIR, "index.html")
    if not air_gap:
        resp = send_from_directory(WEB_DIR, "index.html")
        # Ensure the shell is never cached, so new bundle URLs are picked up on rebuild.
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp
    try:
        with open(index_path, encoding="utf-8") as f:
            html = f.read()
        prelude = (
            "<script>"
            "try{localStorage.setItem('ProxmoxVEx-air-gap','1');}catch(_){}"
            "window.__ProxmoxVExAirGap=true;"
            "</script>"
        )
        # inject right after <head> open tag so it precedes everything
        html = html.replace("<head>", "<head>" + prelude, 1) if "<head>" in html else prelude + html
        resp = make_response(html)
        resp.headers["Content-Type"] = "text/html; charset=utf-8"
        # don't let proxies cache an air-gapped response — toggling the flag
        # off must take effect on the next reload, not whenever the cache decides
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp
    except Exception:
        logging.exception("[index] air-gap prelude injection failed; falling back to plain index.html")
        return send_from_directory(WEB_DIR, "index.html")


# API Routes
@bp.route("/")
def index():
    """Serve the SPA root."""
    return _serve_index()


@bp.route("/<path:subpath>")
def spa_catch_all(subpath):
    """Serve the SPA for any client-side route (e.g. /settings)."""
    return _serve_index()


@bp.route("/status")
def status_page():
    """Serve public status page — only if plugin is enabled"""
    from ProxmoxVEx.api.plugins import _loaded_plugins

    if "status_page" not in _loaded_plugins:
        return "<h1>Status Page not available</h1><p>The Status Page plugin is not enabled.</p>", 404
    import os

    path = os.path.join(os.path.dirname(__file__), "..", "..", "plugins", "status_page", "status.html")
    if os.path.exists(path):
        return send_file(path)
    return "<h1>Status Page not installed</h1>", 404


@bp.route("/api/public/status-page", methods=["GET"])
def public_status_api():
    """Public status endpoint, auth via URL key (no session)."""
    from ProxmoxVEx.api.plugins import _loaded_plugins

    if "status_page" not in _loaded_plugins:
        return jsonify({"error": "Status Page plugin not enabled"}), 404
    try:
        from plugins.status_page import _public_status

        result = _public_status()
        if isinstance(result, tuple):
            return jsonify(result[0]), result[1]
        return jsonify(result)
    except ImportError:
        return jsonify({"error": "Status Page plugin not loaded"}), 404
    except Exception as e:
        logging.error(f"Status check failed: {e}", exc_info=True)
        return jsonify({"error": "An internal error occurred"}), 500


@bp.route("/portal")
@bp.route("/portal/<path:subpath>")
def client_portal_page(subpath=None):
    """Serve client portal — only if plugin is enabled"""
    from ProxmoxVEx.api.plugins import _loaded_plugins

    if "client_portal" not in _loaded_plugins:
        return "<h1>Client Portal not available</h1><p>The Client Portal plugin is not enabled.</p>", 404
    import os

    portal_path = os.path.join(os.path.dirname(__file__), "..", "..", "plugins", "client_portal", "portal.html")
    if os.path.exists(portal_path):
        return send_file(portal_path)
    return "<h1>Client Portal not installed</h1>", 404


@bp.route("/oidc/callback")
def oidc_callback_page():
    """Serve SPA for OIDC redirect callback

    Identity providers redirect here with ?code=xxx&state=yyy
    The frontend JS picks up the params and calls the API callback endpoint
    """
    return send_from_directory(WEB_DIR, "index.html")


@bp.route("/api/status", methods=["GET"])
def get_status():
    """Get ProxmoxVEx system status - includes version info

    Unauthenticated users only get version + build, no cluster details
    """
    basic_status = {
        "version": ProxmoxVEx_VERSION,
        "build": ProxmoxVEx_BUILD,
        "totp_available": TOTP_AVAILABLE,
    }

    # Don't show cluster details to unauthenticated users (was leaking infra info)
    session_id = request.headers.get("X-Session-ID") or request.cookies.get("session_id")
    session = validate_session(session_id) if session_id else None
    if session:
        basic_status.update({
            "encryption": {
                "available": ENCRYPTION_AVAILABLE,
                "enabled": ENCRYPTION_AVAILABLE and os.path.exists(KEY_FILE),
                "config_encrypted": os.path.exists(CONFIG_FILE_ENCRYPTED),
            },
            "clusters_count": len(cluster_managers),
            "gevent_available": GEVENT_AVAILABLE,
            "ssh": get_ssh_connection_stats(),
        })

    return jsonify(basic_status)


@bp.route("/api/support-bundle", methods=["GET"])
@require_auth(perms=["admin.settings"])
def generate_support_bundle():
    """Generate a support bundle with logs and system info for troubleshooting

    Like VMware's support bundle feature
    Collects all relevant diagnostic information into a ZIP file
    Sensitive data (passwords, tokens, secrets) are automatically redacted
    """
    import io
    import platform
    import socket
    import zipfile

    try:
        username = request.session.get("user", "unknown")
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        bundle_prefix = f"ProxmoxVEx_support_{timestamp}"

        log_audit(username, "support.bundle_generated", "Generated support bundle for troubleshooting")

        # Create in-memory ZIP file
        zip_buffer = io.BytesIO()

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            # 1. System Information
            try:
                import flask as flask_module

                flask_ver = flask_module.__version__
            except Exception:
                flask_ver = "unknown"

            system_info = {
                "generated_at": datetime.now().isoformat(),
                "ProxmoxVEx_version": ProxmoxVEx_VERSION,
                "ProxmoxVEx_build": ProxmoxVEx_BUILD,
                "python_version": platform.python_version(),
                "platform": platform.platform(),
                "hostname": socket.gethostname(),
                "architecture": platform.machine(),
                "processor": platform.processor(),
                "encryption_available": ENCRYPTION_AVAILABLE,
                "encryption_enabled": ENCRYPTION_AVAILABLE and os.path.exists(KEY_FILE),
                "totp_available": TOTP_AVAILABLE,
                "gevent_available": GEVENT_AVAILABLE,
                "flask_version": flask_ver,
            }
            zf.writestr(f"{bundle_prefix}/system_info.json", json.dumps(system_info, indent=2))

            # 2. Cluster Status (sanitized)
            cluster_status = []
            for cluster_id, mgr in cluster_managers.items():
                cluster_status.append({
                    "id": cluster_id,
                    "name": mgr.config.name,
                    "host": mgr.config.host,
                    "status": "running" if mgr.running else "stopped",
                    "connected": mgr.is_connected,
                    "connection_error": mgr.connection_error,
                    "ha_enabled": mgr.config.ha_enabled,
                    "auto_migrate": mgr.config.auto_migrate,
                    "dry_run": mgr.config.dry_run,
                    "last_run": mgr.last_run.isoformat() if mgr.last_run else None,
                    "current_host": getattr(mgr, "current_host", None),
                    "fallback_hosts_count": len(mgr.config.fallback_hosts) if mgr.config.fallback_hosts else 0,
                })
            zf.writestr(f"{bundle_prefix}/cluster_status.json", json.dumps(cluster_status, indent=2))

            # 3. SSH Connection Stats
            try:
                ssh_stats = get_ssh_connection_stats()
                zf.writestr(f"{bundle_prefix}/ssh_stats.json", json.dumps(ssh_stats, indent=2))
            except Exception as e:
                zf.writestr(f"{bundle_prefix}/ssh_stats_error.txt", f"Failed: {str(e)}")

            # 4. SSE Connection Info
            sse_info = {"active_clients": len(sse_clients), "clients": []}
            try:
                with sse_clients_lock:
                    for _client_id, client_data in list(sse_clients.items())[:50]:
                        sse_info["clients"].append({
                            "user": client_data.get("user", "unknown"),
                            "clusters": client_data.get("clusters", []),
                            "connected_at": client_data.get("connected_at"),
                            "auth_method": client_data.get("auth_method"),
                        })
            except Exception as e:
                sse_info["error"] = str(e)
            zf.writestr(f"{bundle_prefix}/sse_connections.json", json.dumps(sse_info, indent=2))

            # 5. Active Sessions (anonymized)
            sessions_info = {"total_active": len(active_sessions), "sessions": []}
            for _sid, sess in list(active_sessions.items())[:50]:
                sessions_info["sessions"].append({
                    "user": sess.get("user", "unknown"),
                    "role": sess.get("role", "unknown"),
                    "created_at": sess.get("created_at"),
                    "last_activity": sess.get("last_activity"),
                })
            zf.writestr(f"{bundle_prefix}/sessions_info.json", json.dumps(sessions_info, indent=2))

            # 6. Recent Audit Logs (last 500 entries)
            try:
                db = get_db()
                cursor = db.conn.cursor()
                cursor.execute(
                    "SELECT timestamp, user, action, details, ip_address FROM audit_log ORDER BY timestamp DESC LIMIT 500"
                )
                audit_entries = []
                for row in cursor.fetchall():
                    audit_entries.append({
                        "timestamp": row[0],
                        "user": row[1],
                        "action": row[2],
                        "details": row[3],
                        "ip": (row[4][:10] + "...") if row[4] and len(row[4]) > 10 else row[4],
                    })
                zf.writestr(f"{bundle_prefix}/audit_log.json", json.dumps(audit_entries, indent=2))
            except Exception as e:
                zf.writestr(f"{bundle_prefix}/audit_log_error.txt", f"Failed: {str(e)}")

            # 7. Database Schema Info
            try:
                db = get_db()
                cursor = db.conn.cursor()
                schema_info = {}
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
                tables = [row[0] for row in cursor.fetchall()]
                for table in tables:
                    # validate table name is a safe SQL identifier before string interpolation
                    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", table):
                        continue
                    cursor.execute(f"PRAGMA table_info({table})")  # nosec: B608 - table validated as SQL identifier
                    columns = [{"name": col[1], "type": col[2]} for col in cursor.fetchall()]
                    cursor.execute(f"SELECT COUNT(*) FROM {table}")  # nosec: B608 - table validated as SQL identifier
                    count = cursor.fetchone()[0]
                    schema_info[table] = {"columns": columns, "row_count": count}
                zf.writestr(f"{bundle_prefix}/database_schema.json", json.dumps(schema_info, indent=2))
            except Exception as e:
                zf.writestr(f"{bundle_prefix}/database_schema_error.txt", f"Failed: {str(e)}")

            # 8. Server Settings (sanitized)
            try:
                settings = load_server_settings()
                safe_settings = {}
                sensitive_keys = ["smtp_password", "ssl_key", "password", "secret", "token", "api_key"]
                for key, value in settings.items():
                    if any(s in key.lower() for s in sensitive_keys):
                        safe_settings[key] = "[REDACTED]" if value else ""
                    else:
                        safe_settings[key] = value
                zf.writestr(f"{bundle_prefix}/server_settings.json", json.dumps(safe_settings, indent=2))
            except Exception as e:
                zf.writestr(f"{bundle_prefix}/server_settings_error.txt", f"Failed: {str(e)}")

            # 9. User List (no sensitive data)
            try:
                users = load_users()
                user_list = []
                for uname, udata in users.items():
                    user_list.append({
                        "username": uname,
                        "role": udata.get("role"),
                        "enabled": udata.get("enabled", True),
                        "totp_enabled": udata.get("totp_enabled", False),
                        "tenant": udata.get("tenant"),
                        "last_login": udata.get("last_login"),
                    })
                zf.writestr(f"{bundle_prefix}/users_list.json", json.dumps(user_list, indent=2))
            except Exception as e:
                zf.writestr(f"{bundle_prefix}/users_list_error.txt", f"Failed: {str(e)}")

            # 10. Application + Cluster Logs
            # Redact sensitive data from all log output
            def _redact_log(line):
                line = re.sub(r'(password["\']?\s*[:=]\s*["\']?)[^"\'&\s]+', r"\1[REDACTED]", line, flags=re.IGNORECASE)
                line = re.sub(r'(token["\']?\s*[:=]\s*["\']?)[^"\'&\s]+', r"\1[REDACTED]", line, flags=re.IGNORECASE)
                line = re.sub(r'(secret["\']?\s*[:=]\s*["\']?)[^"\'&\s]+', r"\1[REDACTED]", line, flags=re.IGNORECASE)
                # redact IPs: 192.168.1.100 -> 192.x.x.x
                line = re.sub(r"(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}", r"\1.x.x.x", line)
                return line

            possible_log_files = [
                os.path.join(LOG_DIR, "ProxmoxVEx.log"),
                os.path.join(CONFIG_DIR, "ProxmoxVEx.log"),
                "/var/log/ProxmoxVEx.log",
                "ProxmoxVEx.log",
            ]
            log_file = None
            for lf in possible_log_files:
                if os.path.exists(lf):
                    log_file = lf
                    break

            from collections import deque as _deque

            if log_file:
                try:
                    with open(log_file, encoding="utf-8", errors="replace") as f:
                        last_lines = list(_deque(f, maxlen=1000))
                        zf.writestr(f"{bundle_prefix}/ProxmoxVEx.log", "".join(_redact_log(_l) for _l in last_lines))
                except Exception as e:
                    zf.writestr(f"{bundle_prefix}/ProxmoxVEx_log_error.txt", f"Failed: {str(e)}")
            else:
                journal_text = None
                journal_err = None
                try:
                    cp = subprocess.run(
                        [
                            "journalctl",
                            "-u",
                            "ProxmoxVEx",
                            "--since",
                            "24 hours ago",
                            "-n",
                            "1000",
                            "--no-pager",
                            "--output=short",
                        ],
                        capture_output=True,
                        text=True,
                        timeout=20,
                        check=False,
                    )
                    stdout = cp.stdout or ""
                    stderr = cp.stderr or ""
                    # (v0.9.10.3 follow-up, from blackshocks #413 bundle):
                    # when the ProxmoxVEx service user isn't in `adm` or `systemd-journal`
                    # group, journalctl exits rc=0 but stdout contains the permission
                    # hint instead of real journal entries. Detect that pattern and
                    # treat as a failure so we don't ship hint-text as if it were logs.
                    permission_sentinels = (
                        "no journal files were opened",
                        "insufficient permissions",
                        "not currently seeing messages from other users",
                        "users in groups",
                    )
                    looks_like_permission_block = any(s in stdout.lower() for s in permission_sentinels)
                    if cp.returncode == 0 and stdout.strip() and not looks_like_permission_block:
                        # Cap at last 1000 lines (in case --since-window had more)
                        lines = stdout.splitlines(keepends=True)[-1000:]
                        journal_text = "".join(_redact_log(_l) for _l in lines)
                    elif looks_like_permission_block:
                        journal_err = (
                            "journalctl reports insufficient permissions — the ProxmoxVEx "
                            "service user is not in the `systemd-journal` (or `adm`) group. "
                            "Run `sudo usermod -a -G systemd-journal ProxmoxVEx && sudo systemctl "
                            "restart ProxmoxVEx` on the host, then re-generate the bundle."
                        )
                    else:
                        journal_err = stderr.strip()[:300] or f"rc={cp.returncode}, empty output"
                except FileNotFoundError:
                    journal_err = "journalctl binary not present (not a systemd host)"
                except subprocess.TimeoutExpired:
                    journal_err = "journalctl timed out after 20s"
                except Exception as e:
                    journal_err = f"{type(e).__name__}: {e}"

                if journal_text:
                    zf.writestr(
                        f"{bundle_prefix}/ProxmoxVEx.log",
                        "# Source: journalctl -u ProxmoxVEx --since '24 hours ago' (no log file on disk)\n"
                        + journal_text,
                    )
                else:
                    zf.writestr(
                        f"{bundle_prefix}/ProxmoxVEx.log",
                        "Log file not found. Checked paths: "
                        + ", ".join(possible_log_files)
                        + (f"\nJournald fallback also failed: {journal_err}" if journal_err else ""),
                    )

            # collect per-cluster logs (top 10 most recent, skip huge reads)
            import glob as _glob

            cluster_logs = _glob.glob(os.path.join(LOG_DIR, "*.log"))
            cluster_logs.sort(key=lambda f: os.path.getmtime(f), reverse=True)
            for cl_log in cluster_logs[:10]:
                fname = os.path.basename(cl_log)
                if fname == "ProxmoxVEx.log":
                    continue
                try:
                    with open(cl_log, encoding="utf-8", errors="replace") as f:
                        last_lines = list(_deque(f, maxlen=500))
                        zf.writestr(f"{bundle_prefix}/logs/{fname}", "".join(_redact_log(_l) for _l in last_lines))
                except Exception:
                    pass

            # 11. Recent Tasks
            try:
                recent_tasks = []
                for cluster_id, mgr in cluster_managers.items():
                    if mgr.is_connected:
                        try:
                            tasks = mgr.get_tasks(limit=50)
                            if tasks:
                                for task in tasks:
                                    task["cluster_id"] = cluster_id
                                    recent_tasks.append(task)
                        except Exception:
                            pass
                recent_tasks.sort(key=lambda x: x.get("starttime", 0), reverse=True)
                zf.writestr(f"{bundle_prefix}/recent_tasks.json", json.dumps(recent_tasks[:100], indent=2))
            except Exception as e:
                zf.writestr(f"{bundle_prefix}/recent_tasks_error.txt", f"Failed: {str(e)}")

            # 12. Environment Variables (safe ones only)
            safe_env_vars = {}
            safe_prefixes = ["ProxmoxVEx_", "FLASK_", "PYTHON"]
            for key, value in os.environ.items():
                if any(key.startswith(p) for p in safe_prefixes):
                    if "password" in key.lower() or "secret" in key.lower() or "key" in key.lower():
                        safe_env_vars[key] = "[REDACTED]"
                    else:
                        safe_env_vars[key] = value
            zf.writestr(f"{bundle_prefix}/environment.json", json.dumps(safe_env_vars, indent=2))

            # 13. ProxmoxVEx SSH Session Log (last 100 entries)
            # Track SSH sessions opened through ProxmoxVEx WebSocket terminal
            try:
                db = get_db()
                cursor = db.conn.cursor()
                cursor.execute("""
                    SELECT timestamp, user, action, details, ip_address
                    FROM audit_log
                    WHERE action LIKE 'ssh.%' OR action LIKE 'node.shell%'
                    ORDER BY timestamp DESC LIMIT 100
                """)
                ssh_entries = []
                for row in cursor.fetchall():
                    ssh_entries.append({
                        "timestamp": row[0],
                        "user": row[1],
                        "action": row[2],
                        "details": row[3],
                        "ip": row[4],
                    })
                zf.writestr(f"{bundle_prefix}/ssh_sessions.json", json.dumps(ssh_entries, indent=2))
            except Exception as e:
                zf.writestr(f"{bundle_prefix}/ssh_sessions_error.txt", f"Failed: {str(e)}")

            # 14. README
            readme = f"""ProxmoxVEx Support Bundle
========================
Generated: {datetime.now().isoformat()}
Version: {ProxmoxVEx_VERSION} (Build {ProxmoxVEx_BUILD})

Contents:
- system_info.json: System and environment information
- cluster_status.json: Status of all configured clusters
- ssh_stats.json: SSH connection pool statistics
- sse_connections.json: Server-Sent Events connection info
- sessions_info.json: Active session information (anonymized)
- audit_log.json: Recent audit log entries (last 500)
- database_schema.json: Database table structure and row counts
- server_settings.json: Server configuration (passwords redacted)
- users_list.json: User list (no passwords)
- ProxmoxVEx.log: Application log (last 1000 lines, sensitive data redacted)
- recent_tasks.json: Recent Proxmox tasks from all clusters
- environment.json: Relevant environment variables
- ssh_sessions.json: Last 100 ProxmoxVEx SSH terminal sessions (connects, disconnects, failures)

Privacy Note:
Sensitive information (passwords, tokens, secrets, API keys) has been
automatically redacted. Please review contents before sharing.

Generated by: {username}
"""
            zf.writestr(f"{bundle_prefix}/README.txt", readme)

        # Prepare response
        zip_buffer.seek(0)

        response = make_response(zip_buffer.getvalue())
        response.headers["Content-Type"] = "application/zip"
        response.headers["Content-Disposition"] = f"attachment; filename=ProxmoxVEx_support_{timestamp}.zip"

        return response

    except Exception as e:
        logging.exception(f"Support bundle generation failed: {e}", exc_info=True)
        return jsonify({"error": "Failed to generate support bundle"}), 500


# ==================== UPDATE MANAGER ====================

# 2026-04-24 - server-side throttle for node update checks.
# Keyed by cluster_id: {'at': epoch, 'payload': dict}. Frontend caches in localStorage,
# but that's per-browser/per-user; this guarantees we only poll the Proxmox API once
# per cluster per day even if five admins open the Security tab in parallel.
# `force=true` in the request body bypasses the cache for manual refresh.
_UPDATE_CHECK_TTL = 24 * 60 * 60  # 24h
_update_check_cache = {}


@bp.route("/api/clusters/<cluster_id>/updates/check", methods=["POST"])
@require_auth(perms=["node.update"])
def check_cluster_updates(cluster_id):
    """Check for updates on all nodes in the cluster"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404

    # Serve cached result if < 24h old and caller didn't ask for force
    force = False
    try:
        body = request.get_json(silent=True) or {}
        force = bool(body.get("force")) or request.args.get("force", "").lower() in ("1", "true", "yes")
    except Exception:
        pass
    cached = _update_check_cache.get(cluster_id)
    if cached and not force and (time.time() - cached.get("at", 0)) < _UPDATE_CHECK_TTL:
        payload = dict(cached.get("payload") or {})
        payload["cached"] = True
        payload["cached_age_sec"] = int(time.time() - cached["at"])
        return jsonify(payload)

    mgr = cluster_managers[cluster_id]
    results = {}

    try:
        host, port = mgr.host, mgr.api_port
        url = f"https://{host}:{port}/api2/json/nodes"
        r = mgr._create_session().get(url, timeout=10)
        if r.status_code != 200:
            return jsonify({"error": "Failed: nodes from cluster"}), 500
        nodes_data = r.json().get("data", [])
        node_names = [n.get("node") for n in nodes_data if n.get("node") and n.get("status") == "online"]
    except Exception as e:
        logging.error(f"[API] Failed to connect to cluster: {e}", exc_info=True)
        return jsonify({"error": "Failed to connect to cluster"}), 500

    if not node_names:
        return jsonify({
            "success": True,
            "nodes": {},
            "summary": {
                "total_updates": 0,
                "nodes_with_updates": 0,
                "total_nodes": 0,
                "checked_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            },
        })

    for node_name in node_names:
        # Retry up to 2 times on failure, with clear error reporting
        max_retries = 2
        last_error = None
        for attempt in range(max_retries + 1):
            try:
                updates = mgr.get_node_apt_updates(node_name)

                if isinstance(updates, list):
                    update_list = updates
                elif isinstance(updates, dict):
                    update_list = updates.get("data", [])
                else:
                    update_list = []

                results[node_name] = {
                    "success": True,
                    "updates": update_list,
                    "count": len(update_list),
                    "retries": attempt,
                }
                last_error = None
                break  # Success, no more retries
            except Exception as e:
                last_error = str(e)
                if attempt < max_retries:
                    logging.warning(f"[UpdateCheck] {node_name} attempt {attempt + 1} failed: {e}, retrying...")
                    time.sleep(2)

        # If all retries failed, show clear error state
        if last_error:
            logging.error(f"[UpdateCheck] {node_name} failed after {max_retries + 1} attempts: {last_error}")
            results[node_name] = {
                "success": False,
                "error": last_error,
                "updates": [],
                "count": -1,  # 1 signals "check failed" vs 0 which means "no updates"
            }

    # Count > 0 for updates, ignore -1 (failed checks)
    total_updates = sum(max(r.get("count", 0), 0) for r in results.values())
    nodes_with_updates = sum(1 for r in results.values() if r.get("count", 0) > 0)
    nodes_failed = sum(1 for r in results.values() if not r.get("success", True))

    # Also check PBS servers
    # May 2026 (#376) - respect PBSManager.linked_clusters so a global PBS
    # set across multiple clusters doesn't bleed into every cluster's update
    # manager. PBS without linked_clusters set is treated as cluster-agnostic
    # and still shows everywhere (no breaking change for existing setups).
    pbs_results = {}
    try:
        for pid, pmgr in pbs_managers.items():
            if not pmgr.connected:
                continue
            linked = getattr(pmgr, "linked_clusters", None) or []
            if linked and cluster_id not in linked:
                continue
            try:
                pbs_upd = pmgr.get_apt_updates()
                upd_list = pbs_upd.get("data", []) if "error" not in pbs_upd else []
                pbs_results[pmgr.name or pid] = {
                    "success": "error" not in pbs_upd,
                    "pbs_id": pid,
                    "updates": upd_list,
                    "count": len(upd_list),
                }
            except Exception as pe:
                pbs_results[pmgr.name or pid] = {
                    "success": False,
                    "pbs_id": pid,
                    "error": str(pe),
                    "updates": [],
                    "count": -1,
                }
    except Exception:
        pass  # pbs_managers might not exist

    pbs_total = sum(max(r.get("count", 0), 0) for r in pbs_results.values())

    # Store timestamp so we can show when last checked
    mgr._last_update_check = time.strftime("%Y-%m-%d %H:%M:%S")

    payload = {
        "success": True,
        "nodes": results,
        "pbs": pbs_results,
        "summary": {
            "total_updates": total_updates + pbs_total,
            "nodes_with_updates": nodes_with_updates,
            "nodes_failed": nodes_failed,
            "total_nodes": len(results),
            "pbs_with_updates": sum(1 for r in pbs_results.values() if r.get("count", 0) > 0),
            "total_pbs": len(pbs_results),
            "checked_at": mgr._last_update_check,
        },
        "cached": False,
    }
    # stash for subsequent callers within the TTL window
    _update_check_cache[cluster_id] = {"at": time.time(), "payload": payload}
    # snyk:ignore:Cross-site Scripting (XSS)
    # lgtm[py/reflected-xss]
    return jsonify(payload)


@bp.route("/api/clusters/<cluster_id>/updates/status", methods=["GET"])
@require_auth(perms=["node.view"])
def get_cluster_update_status(cluster_id):
    """Get cached update status for cluster"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    rolling_update = getattr(mgr, "_rolling_update", None)

    # Auto-clear completed/failed/cancelled status
    if rolling_update and rolling_update.get("status") in ["completed", "failed", "cancelled"]:
        completed_at = rolling_update.get("completed_at", "")
        if completed_at:
            try:
                from datetime import datetime

                completed_time = datetime.strptime(completed_at, "%Y-%m-%d %H:%M:%S")
                age_seconds = (datetime.now() - completed_time).total_seconds()
                # Auto-clear after 5 minutes for completed, 30 minutes for failed
                clear_after = 1800 if rolling_update.get("status") == "failed" else 300
                if age_seconds > clear_after:
                    mgr._rolling_update = None
                    rolling_update = None
            except Exception:
                # Invalid timestamp - clear it
                mgr._rolling_update = None
                rolling_update = None
        else:
            # No completed_at timestamp - this is legacy or broken data, clear it
            mgr._rolling_update = None
            rolling_update = None

    # snyk:ignore:Cross-site Scripting (XSS)
    # lgtm[py/reflected-xss]
    return jsonify({
        "success": True,
        "rolling_update": rolling_update,
        "last_check": getattr(mgr, "_last_update_check", None),
    })


@bp.route("/api/clusters/<cluster_id>/updates/rolling", methods=["POST"])
@require_auth(perms=["node.update"])
def start_rolling_update(cluster_id):
    """Start a rolling update across all cluster nodes and linked PBS servers.

    Fixed GitHub Issue - skip up-to-date nodes and configurable timeout.
    PBS servers linked to the cluster are now included in the rolling update.

    Parameters (via JSON body):
    - include_reboot: bool - Whether to reboot nodes/PBS after update (default: False)
    - node_order: list - Custom order of nodes to update
    - pbs_order: list - Custom order of PBS server IDs to update
    - skip_up_to_date: bool - Skip nodes/PBS that have no updates available (default: True)
    - force_all: bool - Force update all nodes/PBS even if up-to-date (default: False)
    - evacuation_timeout: int - Timeout in seconds for VM evacuation (default: 1800 = 30 min)
    - update_timeout: int - Timeout in seconds for apt upgrade (default: 900 = 15 min)
    - reboot_timeout: int - Timeout in seconds for node/PBS reboot (default: 600 = 10 min)
    """
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]
    data = request.get_json() or {}

    # Configuration options
    include_reboot = data.get("include_reboot", False)
    node_order = data.get("node_order", None)
    pbs_order = data.get("pbs_order", None)
    skip_up_to_date = data.get("skip_up_to_date", True)
    force_all = data.get("force_all", False)
    skip_evacuation = data.get("skip_evacuation", False)  # Issue #22 - skip VM evacuation (NOT RECOMMENDED)
    wait_for_reboot = data.get("wait_for_reboot", True)  # GitHub
    pause_on_evacuation_error = data.get("pause_on_evacuation_error", True)  # GitHub
    # (#330): lets evacuation migrate local-disk VMs via --with-local-disks
    # instead of skipping them outright. Off by default — it copies blocks over the
    # cluster network and can take ages on bigger VMs.
    allow_local_disks = bool(data.get("allow_local_disks", False))

    # Configurable timeouts (GitHub Issue fix)
    evacuation_timeout = data.get("evacuation_timeout", 1800)  # 30 minutes default (was 5 min!)
    update_timeout = data.get("update_timeout", 900)  # 15 minutes default
    reboot_timeout = data.get("reboot_timeout", 600)  # 10 minutes default

    # Validate timeouts (min 60s, max 2 hours)
    evacuation_timeout = max(60, min(7200, int(evacuation_timeout)))
    update_timeout = max(60, min(7200, int(update_timeout)))
    reboot_timeout = max(60, min(7200, int(reboot_timeout)))

    # check already running
    if hasattr(mgr, "_rolling_update") and mgr._rolling_update and mgr._rolling_update.get("status") == "running":
        return jsonify({"error": "Rolling update already in progress"}), 400

    # Get nodes from cluster status
    try:
        node_status = mgr.get_node_status()
        available_nodes = list(node_status.keys()) if node_status else []
    except Exception as e:
        logging.error(f"[API] Failed to get cluster nodes: {e}", exc_info=True)
        return jsonify({"error": "Failed to get cluster nodes"}), 500

    if not available_nodes:
        return jsonify({"error": "No nodes available for update"}), 400

    # Get nodes to update (use custom order or default)
    nodes_to_update = [n for n in node_order if n in available_nodes] if node_order else available_nodes

    if not nodes_to_update:
        return jsonify({"error": "No nodes available for update"}), 400

    # Discover linked PBS servers for this cluster
    pbs_names = {}
    pbs_to_update = []
    try:
        for pid, pmgr in pbs_managers.items():
            if not pmgr.connected:
                continue
            linked = getattr(pmgr, "linked_clusters", None) or []
            if linked and cluster_id not in linked:
                continue
            pbs_names[pid] = pmgr.name or pid
        pbs_to_update = [pid for pid in pbs_order if pid in pbs_names] if pbs_order else list(pbs_names.keys())
    except Exception:
        pass

    # init rolling update state
    all_targets = list(nodes_to_update) + [pbs_names[pid] for pid in pbs_to_update]
    mgr._rolling_update = {
        "status": "running",
        "started_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "include_reboot": include_reboot,
        "skip_up_to_date": skip_up_to_date,
        "skip_evacuation": skip_evacuation,  # Issue
        "wait_for_reboot": wait_for_reboot,  # GitHub
        "pause_on_evacuation_error": pause_on_evacuation_error,  # GitHub
        "allow_local_disks": allow_local_disks,  #
        "force_all": force_all,
        "evacuation_timeout": evacuation_timeout,
        "update_timeout": update_timeout,
        "reboot_timeout": reboot_timeout,
        "nodes": all_targets,
        "node_count": len(nodes_to_update),
        "pbs_to_update": pbs_to_update,
        "pbs_names": pbs_names,
        "current_index": 0,
        "current_node": all_targets[0],
        "current_step": "starting",
        "completed_nodes": [],
        "skipped_nodes": [],  # Track skipped nodes
        "failed_nodes": [],
        "rebooting_nodes": [],
        "paused_reason": None,
        "paused_details": None,
        "logs": [],
    }

    # helper: one-line log with a timestamp prefix
    def _log(msg):
        with contextlib.suppress(Exception):
            mgr._rolling_update["logs"].append(f"[{time.strftime('%H:%M:%S')}] {msg}")

    # Start the rolling update in a background thread
    def run_rolling_update():
        try:
            logging.info(f"[RollingUpdate] Starting rolling update for cluster, nodes: {nodes_to_update}")
            _log("Rolling update started")
            _log(
                f"Settings: skip_up_to_date={skip_up_to_date}, skip_evacuation={skip_evacuation}, evacuation_timeout={evacuation_timeout}s"
            )

            if skip_evacuation:
                _log("⚠️ WARNING: VM evacuation disabled - VMs may be affected if update fails!")

            # #181 - pre-flight summary so admins see cluster-wide safety state up front,
            # not just per-node ticks.
            try:
                ns = mgr.get_node_status() or {}
                online_nodes = [n for n, i in ns.items() if i.get("status") == "online"]
                total_nodes = len(ns)
                quorum_ok = len(online_nodes) * 2 > total_nodes if total_nodes else True
                _log(
                    f"Cluster state: {len(online_nodes)}/{total_nodes} nodes online · quorum {'HELD' if quorum_ok else 'AT RISK'}"
                )
            except Exception as e:
                _log(f"Cluster state check skipped: {e}", exc_info=True)

            # Ceph snapshot up front
            try:
                ceph = mgr.get_ceph_health_summary()
                if ceph is None:
                    _log("Ceph: not deployed on this cluster")
                else:
                    status = ceph.get("status", "unknown")
                    badge = "✓" if status == "HEALTH_OK" else ("⚠" if status == "HEALTH_WARN" else "✗")
                    _log(
                        f"Ceph: {badge} {status} · {ceph.get('osd_up', 0)}/{ceph.get('osd_in', 0)} OSDs up"
                        + (f" · {ceph['pgs']}" if ceph.get("pgs") else "")
                    )
                    if ceph.get("warnings"):
                        _log(f"Ceph warnings: {', '.join(ceph['warnings'])}")
                    if status == "HEALTH_ERR":
                        _log(
                            "⚠️ Ceph is in HEALTH_ERR. Proceeding may put replicas at further risk — consider aborting."
                        )
            except Exception as e:
                _log(f"Ceph health check skipped: {e}", exc_info=True)

            for idx, node_name in enumerate(nodes_to_update):
                if not hasattr(mgr, "_rolling_update") or mgr._rolling_update.get("status") != "running":
                    logging.info("[RollingUpdate] Update cancelled or stopped")
                    break

                mgr._rolling_update["current_index"] = idx
                mgr._rolling_update["current_node"] = node_name
                mgr._rolling_update["current_step"] = "checking"
                mgr._rolling_update["logs"].append(
                    f"[{time.strftime('%H:%M:%S')}] === Processing {node_name} ({idx + 1}/{len(nodes_to_update)}) ==="
                )
                logging.info(f"[RollingUpdate] Processing node: {node_name}")

                try:
                    # Step 0 - Check if node has updates available (GitHub Issue fix)
                    if skip_up_to_date and not force_all:
                        mgr._rolling_update["logs"].append(
                            f"[{time.strftime('%H:%M:%S')}] Checking for available updates on {node_name}..."
                        )

                        # First refresh apt/yum cache
                        try:
                            mgr.refresh_node_apt(node_name)
                            # Yum makecache takes way longer than apt update
                            time.sleep(3)
                        except Exception:
                            pass

                        check_failed = False
                        try:
                            available_updates = mgr.get_node_apt_updates(node_name)
                        except Exception as e:
                            mgr._rolling_update["logs"].append(
                                f"[{time.strftime('%H:%M:%S')}] ⚠ Failed to check updates on {node_name}: {e}"
                            )
                            logging.warning(f"[RollingUpdate] Update check failed for {node_name}: {e}", exc_info=True)
                            available_updates = []
                            check_failed = True
                        update_count = len(available_updates) if available_updates else 0

                        if update_count == 0 and not check_failed:
                            mgr._rolling_update["logs"].append(
                                f"[{time.strftime('%H:%M:%S')}] ⏭ {node_name} is already up-to-date - SKIPPING"
                            )
                            mgr._rolling_update["skipped_nodes"].append(node_name)
                            logging.info(f"[RollingUpdate] Node {node_name} is up-to-date, skipping")
                            continue
                        elif check_failed:
                            mgr._rolling_update["logs"].append(
                                f"[{time.strftime('%H:%M:%S')}] Check failed, proceeding with update anyway"
                            )
                        else:
                            mgr._rolling_update["logs"].append(
                                f"[{time.strftime('%H:%M:%S')}] Found {update_count} updates available on {node_name}"
                            )
                            logging.info(f"[RollingUpdate] Node {node_name} has {update_count} updates available")

                    # Force-refresh maintenance state from PVE before each node
                    mgr.refresh_maintenance_status()

                    # #181 - list the VMs about to move. Nothing is more reassuring to an admin
                    # at 02:00 than seeing the names roll past before evacuation kicks off.
                    if not skip_evacuation:
                        try:
                            vms_here = mgr.get_node_vms(node_name) or []
                        except Exception:
                            try:
                                all_r = mgr.get_cluster_resources() or []
                                vms_here = [
                                    r for r in all_r if r.get("node") == node_name and r.get("type") in ("qemu", "lxc")
                                ]
                            except Exception:
                                vms_here = []
                        running = [v for v in vms_here if (v.get("status") or "").lower() == "running"]
                        _log(
                            f"{node_name}: {len(vms_here)} guests present ({len(running)} running, {len(vms_here) - len(running)} stopped)"
                        )
                        for vm in running[:8]:
                            label = vm.get("name") or f"{vm.get('type', 'vm')} {vm.get('vmid', '?')}"
                            _log(f"  → will evacuate: {label} (VMID {vm.get('vmid', '?')}, {vm.get('type', '?')})")
                        if len(running) > 8:
                            _log(f"  → …and {len(running) - 8} more")

                    # Step 1: Enable maintenance mode (evacuate VMs unless skip_evacuation is set)
                    # enter_maintenance_mode() internally calls _set_ceph_maintenance_flags()
                    # — we only log the intent here so the user sees it in the task view.
                    mgr._rolling_update["current_step"] = "maintenance"
                    if skip_evacuation:
                        _log(f"Enabling maintenance mode on {node_name} (SKIP EVACUATION)")
                        logging.info(f"[RollingUpdate] Enabling maintenance mode on {node_name} (skip_evacuation=True)")
                    else:
                        _log(f"Enabling maintenance mode on {node_name}")
                        _log(
                            f"  → Ceph (if present): noout + norebalance will be set on {node_name} to prevent rebalancing"
                        )
                        logging.info(f"[RollingUpdate] Enabling maintenance mode on {node_name}")

                    maintenance_task = mgr.enter_maintenance_mode(
                        node_name,
                        skip_evacuation=skip_evacuation,
                        allow_local_disks=allow_local_disks,  #
                    )

                    if not maintenance_task:
                        logging.error(f"[RollingUpdate] Failed to start maintenance mode on {node_name}")
                        raise Exception("Failed to start maintenance mode")

                    # Wait for evacuation to complete (unless skipped)
                    if skip_evacuation:
                        mgr._rolling_update["current_step"] = "updating"
                        mgr._rolling_update["logs"].append(
                            f"[{time.strftime('%H:%M:%S')}] ⚠️ Skipping VM evacuation - VMs remain on node"
                        )
                        evacuation_completed = True
                    else:
                        mgr._rolling_update["current_step"] = "evacuating"
                        mgr._rolling_update["logs"].append(
                            f"[{time.strftime('%H:%M:%S')}] Waiting for VM evacuation (timeout: {evacuation_timeout}s)..."
                        )
                        waited = 0
                        evacuation_completed = False
                        last_progress_log = 0

                        while waited < evacuation_timeout:
                            if mgr._rolling_update.get("status") not in ["running", "paused"]:
                                break
                            if node_name in mgr.nodes_in_maintenance:
                                maintenance_task = mgr.nodes_in_maintenance[node_name]
                                if maintenance_task.status == "completed":
                                    mgr._rolling_update["logs"].append(
                                        f"[{time.strftime('%H:%M:%S')}] ✓ Evacuation completed - all VMs migrated"
                                    )
                                    evacuation_completed = True
                                    break
                                elif maintenance_task.status == "completed_with_errors":
                                    failed_vm_list = getattr(maintenance_task, "failed_vms", [])
                                    failed_names = [
                                        f"{v.get('name', 'VM')} (VMID: {v.get('vmid', '?')})" for v in failed_vm_list
                                    ]
                                    migrated = getattr(maintenance_task, "migrated_vms", 0)
                                    total = getattr(maintenance_task, "total_vms", 0)
                                    mgr._rolling_update["logs"].append(
                                        f"[{time.strftime('%H:%M:%S')}] ⚠️ Evacuation: {migrated}/{total} migrated, {len(failed_vm_list)} failed"
                                    )
                                    for fn in failed_names:
                                        mgr._rolling_update["logs"].append(
                                            f"[{time.strftime('%H:%M:%S')}]   ✗ Failed: {fn}"
                                        )

                                    if pause_on_evacuation_error:
                                        mgr._rolling_update["status"] = "paused"
                                        mgr._rolling_update["current_step"] = "paused_evacuation"
                                        mgr._rolling_update["paused_reason"] = "evacuation_failures"
                                        mgr._rolling_update["paused_details"] = {
                                            "node": node_name,
                                            "migrated": migrated,
                                            "total": total,
                                            "failed_vms": [
                                                {
                                                    "vmid": v.get("vmid"),
                                                    "name": v.get("name", "VM"),
                                                    "error": v.get("error", ""),
                                                }
                                                for v in failed_vm_list
                                            ],
                                            "message": f"{len(failed_vm_list)} VM(s) failed to migrate from {node_name}. Manually migrate/shutdown these VMs, then click Continue or Cancel.",
                                        }
                                        mgr._rolling_update["logs"].append(
                                            f"[{time.strftime('%H:%M:%S')}] ⏸ PAUSED - Waiting for user action."
                                        )
                                        logging.warning(
                                            f"[RollingUpdate] Paused on {node_name}: {len(failed_vm_list)} VMs failed to migrate"
                                        )
                                        while mgr._rolling_update.get("status") == "paused":
                                            time.sleep(2)
                                        if mgr._rolling_update.get("status") == "cancelled":
                                            mgr._rolling_update["logs"].append(
                                                f"[{time.strftime('%H:%M:%S')}] Rolling update cancelled by user during pause"
                                            )
                                            break
                                        elif mgr._rolling_update.get("status") == "running":
                                            mgr._rolling_update["logs"].append(
                                                f"[{time.strftime('%H:%M:%S')}] ▶ Resumed by user - continuing update on {node_name}"
                                            )
                                            mgr._rolling_update["paused_reason"] = None
                                            mgr._rolling_update["paused_details"] = None
                                            evacuation_completed = True
                                            break
                                    else:
                                        mgr._rolling_update["logs"].append(
                                            f"[{time.strftime('%H:%M:%S')}] ⚠️ Continuing despite failures (pause_on_evacuation_error=False)"
                                        )
                                        evacuation_completed = True
                                        break
                                elif maintenance_task.status == "failed":
                                    error_msg = getattr(maintenance_task, "error", "Unknown error")
                                    mgr._rolling_update["logs"].append(
                                        f"[{time.strftime('%H:%M:%S')}] ✗ Evacuation failed: {error_msg}"
                                    )
                                    raise Exception(f"Evacuation failed: {error_msg}")
                                else:
                                    if waited - last_progress_log >= 30:
                                        if hasattr(maintenance_task, "migrated_vms") and hasattr(
                                            maintenance_task, "total_vms"
                                        ):
                                            mgr._rolling_update["logs"].append(
                                                f"[{time.strftime('%H:%M:%S')}] Evacuating: {maintenance_task.migrated_vms}/{maintenance_task.total_vms} VMs ({waited}s)"
                                            )
                                        else:
                                            mgr._rolling_update["logs"].append(
                                                f"[{time.strftime('%H:%M:%S')}] Evacuation in progress... ({waited}s)"
                                            )
                                        last_progress_log = waited
                            time.sleep(5)
                            waited += 5
                        if mgr._rolling_update.get("status") == "cancelled":
                            break
                        if not evacuation_completed:
                            raise Exception(f"Evacuation timed out after {evacuation_timeout}s")

                    # Step 2: Run apt update/upgrade
                    mgr._rolling_update["current_step"] = "updating"
                    mgr._rolling_update["logs"].append(
                        f"[{time.strftime('%H:%M:%S')}] Installing updates on {node_name}"
                    )
                    logging.info(f"[RollingUpdate] Installing updates on {node_name}")

                    update_task = mgr.start_node_update(node_name, reboot=include_reboot)

                    if not update_task:
                        logging.error(f"[RollingUpdate] start_node_update returned None for {node_name}")
                        raise Exception("Update failed: Could not start update task")

                    # Step 3: Wait for update task to complete
                    mgr._rolling_update["logs"].append(
                        f"[{time.strftime('%H:%M:%S')}] Waiting for update task (timeout: {update_timeout}s)..."
                    )
                    update_waited = 0
                    last_phase = None
                    while update_waited < update_timeout:
                        if update_task.status in ["completed", "failed"]:
                            break
                        # Log phase changes
                        if hasattr(update_task, "phase") and update_task.phase != last_phase:
                            last_phase = update_task.phase
                            mgr._rolling_update["logs"].append(
                                f"[{time.strftime('%H:%M:%S')}] Update phase: {last_phase}"
                            )
                        time.sleep(10)
                        update_waited += 10

                    if update_task.status == "failed":
                        raise Exception(f"Update failed: {update_task.error or 'Unknown error'}")

                    if update_task.status != "completed":
                        raise Exception(f"Update timed out after {update_timeout}s (status: {update_task.status})")

                    mgr._rolling_update["logs"].append(f"[{time.strftime('%H:%M:%S')}] ✓ Updates installed")

                    # Step 4: If reboot was included, wait for node to come back
                    if include_reboot:
                        mgr._rolling_update["current_step"] = "rebooting"
                        mgr._rolling_update["logs"].append(
                            f"[{time.strftime('%H:%M:%S')}] Node {node_name} rebooting (timeout: {reboot_timeout}s)..."
                        )
                        if "rebooting_nodes" not in mgr._rolling_update:
                            mgr._rolling_update["rebooting_nodes"] = []
                        mgr._rolling_update["rebooting_nodes"].append(node_name)

                        # Phase 1: Wait for offline
                        offline_waited = 0
                        node_went_offline = False
                        while offline_waited < 120:
                            try:
                                ns = mgr.get_node_status()
                                if node_name not in ns or ns[node_name].get("status") != "online":
                                    node_went_offline = True
                                    mgr._rolling_update["logs"].append(
                                        f"[{time.strftime('%H:%M:%S')}] {node_name} is now offline"
                                    )
                                    break
                            except Exception:
                                node_went_offline = True
                                break
                            time.sleep(5)
                            offline_waited += 5

                        if not node_went_offline:
                            mgr._rolling_update["logs"].append(
                                f"[{time.strftime('%H:%M:%S')}] ⚠️ {node_name} did not go offline within 120s"
                            )

                        if wait_for_reboot:
                            # Phase 2: Wait for online
                            mgr._rolling_update["logs"].append(
                                f"[{time.strftime('%H:%M:%S')}] Waiting for {node_name} to come back online..."
                            )
                            waited = 0
                            node_back_online = False
                            while waited < reboot_timeout:
                                if mgr._rolling_update.get("status") == "cancelled":
                                    break
                                try:
                                    ns = mgr.get_node_status()
                                    if node_name in ns and ns[node_name].get("status") == "online":
                                        node_back_online = True
                                        mgr._rolling_update["logs"].append(
                                            f"[{time.strftime('%H:%M:%S')}] ✓ {node_name} back online ({waited}s)"
                                        )
                                        if node_name in mgr._rolling_update.get("rebooting_nodes", []):
                                            mgr._rolling_update["rebooting_nodes"].remove(node_name)
                                        time.sleep(10)
                                        break
                                except Exception:
                                    pass
                                time.sleep(10)
                                waited += 10
                                if waited % 60 == 0:
                                    mgr._rolling_update["logs"].append(
                                        f"[{time.strftime('%H:%M:%S')}] Still waiting for {node_name} ({waited}s/{reboot_timeout}s)..."
                                    )

                            if not node_back_online and mgr._rolling_update.get("status") != "cancelled":
                                mgr._rolling_update["logs"].append(
                                    f"[{time.strftime('%H:%M:%S')}] ✗ {node_name} reboot timeout ({reboot_timeout}s). Pausing."
                                )
                                mgr._rolling_update["status"] = "paused"
                                mgr._rolling_update["current_step"] = "paused_reboot"
                                mgr._rolling_update["paused_reason"] = "reboot_timeout"
                                mgr._rolling_update["paused_details"] = {
                                    "node": node_name,
                                    "timeout": reboot_timeout,
                                    "message": f"{node_name} did not come back online within {reboot_timeout}s. Check manually, then Continue or Cancel.",
                                }
                                while mgr._rolling_update.get("status") == "paused":
                                    time.sleep(2)
                                if mgr._rolling_update.get("status") == "cancelled":
                                    break
                                elif mgr._rolling_update.get("status") == "running":
                                    mgr._rolling_update["logs"].append(
                                        f"[{time.strftime('%H:%M:%S')}] ▶ Resumed after reboot timeout"
                                    )
                                    mgr._rolling_update["paused_reason"] = None
                                    mgr._rolling_update["paused_details"] = None
                                    if node_name in mgr._rolling_update.get("rebooting_nodes", []):
                                        mgr._rolling_update["rebooting_nodes"].remove(node_name)
                        else:
                            mgr._rolling_update["logs"].append(
                                f"[{time.strftime('%H:%M:%S')}] Not waiting for {node_name} (wait_for_reboot=False)"
                            )

                    if mgr._rolling_update.get("status") == "cancelled":
                        break

                    # Step 5: Disable maintenance mode
                    mgr._rolling_update["current_step"] = "finishing"
                    _log(f"Disabling maintenance mode on {node_name}")
                    # Give HA services 30s to come back after reboot
                    # before we try to disable maintenance. Otherwise ha-manager
                    # rejects the call and the node stays stuck.
                    if include_reboot:
                        time.sleep(30)
                    if not mgr.exit_maintenance_mode(node_name):
                        _log(f"⚠ {node_name} maintenance exit failed (will retry at end of run)")
                    _log(f"  → Ceph (if present): noout + norebalance cleared for {node_name}")

                    # #181 - wait for Ceph to finish rebalancing/peering before we pull the
                    # next node. This is the bit that stops a rolling update from becoming a
                    # rolling outage on HCI clusters.
                    try:
                        ceph_after = mgr.get_ceph_health_summary()
                    except Exception:
                        ceph_after = None
                    if ceph_after is not None:
                        status = ceph_after.get("status", "unknown")
                        badge = "✓" if status == "HEALTH_OK" else ("⚠" if status == "HEALTH_WARN" else "✗")
                        _log(
                            f"Ceph after {node_name}: {badge} {status} · {ceph_after.get('osd_up', 0)}/{ceph_after.get('osd_in', 0)} OSDs up"
                        )
                        if status != "HEALTH_OK" and idx < len(nodes_to_update) - 1:
                            _log("Waiting up to 120s for Ceph to return to HEALTH_OK before next node…")
                            ceph_waited = 0
                            while ceph_waited < 120 and status != "HEALTH_OK":
                                time.sleep(10)
                                ceph_waited += 10
                                try:
                                    ceph_after = mgr.get_ceph_health_summary() or {}
                                    status = ceph_after.get("status", "unknown")
                                except Exception:
                                    break
                            if status == "HEALTH_OK":
                                _log(f"Ceph recovered to HEALTH_OK after {ceph_waited}s")
                            else:
                                _log(
                                    f"⚠ Ceph still {status} after {ceph_waited}s — continuing, but verify cluster health after completion"
                                )

                    mgr._rolling_update["completed_nodes"].append(node_name)
                    _log(f"✓ {node_name} updated successfully")
                    logging.info(f"[RollingUpdate] Node {node_name} updated successfully")

                except Exception as e:
                    logging.error(f"[RollingUpdate] Error updating {node_name}: {e}", exc_info=True)
                    mgr._rolling_update["failed_nodes"].append({
                        "node": node_name,
                        "error": "Node update failed",
                    })
                    mgr._rolling_update["logs"].append(
                        f"[{time.strftime('%H:%M:%S')}] ✗ ERROR on {node_name}: {e}", exc_info=True
                    )
                    # always try to exit maintenance + clear ceph flags on failure (#141)
                    try:
                        exited = mgr.exit_maintenance_mode(node_name)
                        if exited:
                            mgr._rolling_update["logs"].append(
                                f"[{time.strftime('%H:%M:%S')}] Maintenance mode disabled for {node_name} after failure"
                            )
                        else:
                            mgr._rolling_update["logs"].append(
                                f"[{time.strftime('%H:%M:%S')}] ⚠ Could not disable maintenance for {node_name} - check manually"
                            )
                    except Exception as maint_err:
                        logging.error(f"[RollingUpdate] Failed to exit maintenance on {node_name}: {maint_err}")
                        mgr._rolling_update["logs"].append(
                            f"[{time.strftime('%H:%M:%S')}] ⚠ Failed to exit maintenance on {node_name}: {maint_err}"
                        )

                    # #141: STOP the rolling update on node failure.
                    # continuing to the next node is dangerous for HCI (Ceph, etc.)
                    # because we'd pull a second node out while the first may still be down
                    mgr._rolling_update["status"] = "paused"
                    mgr._rolling_update["current_step"] = "paused_failure"
                    mgr._rolling_update["paused_reason"] = "node_failure"
                    mgr._rolling_update["paused_details"] = {
                        "node": node_name,
                        "error": "Node update failed",
                        "message": f"Update failed on {node_name}. Verify the node is healthy before continuing. For HCI clusters, proceeding with a degraded node can cause data loss.",
                    }
                    mgr._rolling_update["logs"].append(
                        f"[{time.strftime('%H:%M:%S')}] ⏸ PAUSED — node failure is unsafe to continue. Check {node_name} manually, then Continue or Cancel."
                    )
                    logging.warning(f"[RollingUpdate] Paused after failure on {node_name} - waiting for user")
                    while mgr._rolling_update.get("status") == "paused":
                        time.sleep(2)
                    if mgr._rolling_update.get("status") == "cancelled":
                        mgr._rolling_update["logs"].append(
                            f"[{time.strftime('%H:%M:%S')}] Rolling update cancelled by user after failure on {node_name}"
                        )
                        break
                    elif mgr._rolling_update.get("status") == "running":
                        mgr._rolling_update["logs"].append(
                            f"[{time.strftime('%H:%M:%S')}] ▶ Resumed by user after failure on {node_name}"
                        )
                        mgr._rolling_update["paused_reason"] = None
                        mgr._rolling_update["paused_details"] = None

            # Process linked PBS servers after the cluster nodes
            pbs_to_update = mgr._rolling_update.get("pbs_to_update", [])
            pbs_names = mgr._rolling_update.get("pbs_names", {})
            for pbs_idx, pbs_id in enumerate(pbs_to_update):
                if not hasattr(mgr, "_rolling_update") or mgr._rolling_update.get("status") != "running":
                    logging.info("[RollingUpdate] Update cancelled or stopped before PBS")
                    break

                pbs_name = pbs_names.get(pbs_id, pbs_id)
                base_index = mgr._rolling_update.get("node_count", len(nodes_to_update))
                mgr._rolling_update["current_index"] = base_index + pbs_idx
                mgr._rolling_update["current_node"] = pbs_name
                mgr._rolling_update["current_step"] = "checking"
                mgr._rolling_update["logs"].append(
                    f"[{time.strftime('%H:%M:%S')}] === Processing PBS {pbs_name} ({pbs_idx + 1}/{len(pbs_to_update)}) ==="
                )
                logging.info(f"[RollingUpdate] Processing PBS: {pbs_name}")

                pmgr = pbs_managers.get(pbs_id)
                if not pmgr or not pmgr.connected:
                    _log(f"PBS {pbs_name} is not connected - skipping")
                    mgr._rolling_update["skipped_nodes"].append(pbs_name)
                    continue

                # Skip up-to-date PBS servers unless forced
                try:
                    if skip_up_to_date and not force_all:
                        pbs_upd = pmgr.get_apt_updates()
                        pbs_count = (
                            len(pbs_upd.get("data", [])) if isinstance(pbs_upd, dict) and "error" not in pbs_upd else -1
                        )
                        if pbs_count == 0:
                            _log(f"PBS {pbs_name} is already up-to-date - SKIPPING")
                            mgr._rolling_update["skipped_nodes"].append(pbs_name)
                            continue
                        if pbs_count == -1:
                            _log(f"PBS {pbs_name} update check failed - proceeding anyway")
                        else:
                            _log(f"PBS {pbs_name} has {pbs_count} updates available")
                except Exception as e:
                    _log(f"PBS {pbs_name} update check failed: {e}")

                mgr._rolling_update["current_step"] = "updating"
                _log(f"Installing updates on PBS {pbs_name}")
                logging.info(f"[RollingUpdate] Installing updates on PBS {pbs_name}")
                try:
                    pbs_task = pmgr.start_update(reboot=include_reboot)
                    if not pbs_task:
                        raise Exception("Could not start PBS update task")
                except Exception as e:
                    _log(f"✗ Failed to start PBS {pbs_name} update: {e}")
                    mgr._rolling_update["failed_nodes"].append({"node": pbs_name, "error": str(e)})
                    continue

                # PBS update timeout includes the optional reboot window
                pbs_timeout = update_timeout
                if include_reboot:
                    pbs_timeout += reboot_timeout
                pbs_waited = 0
                last_phase = None
                while pbs_waited < pbs_timeout:
                    if pbs_task.status in ["completed", "failed"]:
                        break
                    if hasattr(pbs_task, "phase") and pbs_task.phase != last_phase:
                        last_phase = pbs_task.phase
                        _log(f"PBS {pbs_name} phase: {last_phase}")
                    time.sleep(10)
                    pbs_waited += 10

                if pbs_task.status == "failed":
                    _log(f"✗ PBS {pbs_name} update failed: {pbs_task.error or 'Unknown error'}")
                    mgr._rolling_update["failed_nodes"].append({
                        "node": pbs_name,
                        "error": pbs_task.error or "PBS update failed",
                    })
                elif pbs_task.status != "completed":
                    _log(f"✗ PBS {pbs_name} update timed out after {pbs_timeout}s")
                    mgr._rolling_update["failed_nodes"].append({
                        "node": pbs_name,
                        "error": f"PBS update timed out after {pbs_timeout}s",
                    })
                else:
                    _log(f"✓ PBS {pbs_name} updated successfully")
                    mgr._rolling_update["completed_nodes"].append(pbs_name)

            # Final sweep: any node still flagged as in maintenance
            # gets one more attempt with extra settle time. Catches the slow-reboot
            # case where ha-manager wasn't ready when we tried to disable.
            try:
                with mgr.maintenance_lock:
                    stuck = list(mgr.nodes_in_maintenance.keys())
            except Exception:
                stuck = []
            if stuck:
                mgr._rolling_update["logs"].append(
                    f"[{time.strftime('%H:%M:%S')}] Cleanup: {len(stuck)} node(s) still in maintenance, retrying after 15s settle..."
                )
                time.sleep(15)
                for nn in stuck:
                    if mgr.exit_maintenance_mode(nn):
                        mgr._rolling_update["logs"].append(
                            f"[{time.strftime('%H:%M:%S')}] ✓ {nn} maintenance cleared on retry"
                        )
                    else:
                        mgr._rolling_update["logs"].append(
                            f"[{time.strftime('%H:%M:%S')}] ✗ {nn} STILL stuck — run `ha-manager crm-command node-maintenance disable {nn}` manually"
                        )
                        mgr._rolling_update["failed_nodes"].append({
                            "node": nn,
                            "error": "Stuck in maintenance after rolling update",
                        })

            # Final summary
            completed = len(mgr._rolling_update["completed_nodes"])
            skipped = len(mgr._rolling_update["skipped_nodes"])
            failed = len(mgr._rolling_update["failed_nodes"])

            mgr._rolling_update["status"] = "completed"
            mgr._rolling_update["completed_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
            mgr._rolling_update["logs"].append(f"[{time.strftime('%H:%M:%S')}] === Rolling update completed ===")
            mgr._rolling_update["logs"].append(
                f"[{time.strftime('%H:%M:%S')}] Summary: {completed} updated, {skipped} skipped (up-to-date), {failed} failed"
            )
            logging.info(
                f"[RollingUpdate] Rolling update completed: {completed} updated, {skipped} skipped, {failed} failed"
            )

        except Exception as e:
            logging.error(f"[RollingUpdate] Rolling update failed with exception: {e}", exc_info=True)
            mgr._rolling_update["status"] = "failed"
            mgr._rolling_update["completed_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
            mgr._rolling_update["error"] = str(e)
            mgr._rolling_update["logs"].append(
                f"[{time.strftime('%H:%M:%S')}] Rolling update failed: {e}", exc_info=True
            )

    import threading

    update_thread = threading.Thread(target=run_rolling_update, daemon=True)
    update_thread.start()

    # snyk:ignore:Cross-site Scripting (XSS)
    # lgtm[py/reflected-xss]
    return jsonify({
        "success": True,
        "message": "Rolling update started",
        "nodes": nodes_to_update,
        "include_reboot": include_reboot,
        "skip_up_to_date": skip_up_to_date,
        "evacuation_timeout": evacuation_timeout,
        "update_timeout": update_timeout,
        "reboot_timeout": reboot_timeout,
    })


@bp.route("/api/clusters/<cluster_id>/updates/rolling", methods=["DELETE"])
@require_auth(perms=["node.update"])
def cancel_rolling_update(cluster_id):
    """Cancel a running rolling update"""
    # (CodeAnt re-scan auth-bypass/IDOR) - cluster-scoped route was missing the tenant gate
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]

    if not hasattr(manager, "_rolling_update") or not manager._rolling_update:
        return jsonify({"error": "No rolling update in progress"}), 400

    manager._rolling_update["status"] = "cancelled"
    manager._rolling_update["completed_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    manager._rolling_update["logs"].append(f"[{time.strftime('%H:%M:%S')}] Rolling update cancelled by user")

    # Try to exit maintenance mode on current node
    current_node = manager._rolling_update.get("current_node")
    if current_node:
        with contextlib.suppress(Exception):
            manager.exit_maintenance_mode(current_node)

    # snyk:ignore:Cross-site Scripting (XSS)
    # lgtm[py/reflected-xss]
    return jsonify({"success": True, "message": "Rolling update cancelled"})


@bp.route("/api/clusters/<cluster_id>/updates/rolling/resume", methods=["POST"])
@require_auth(perms=["node.update"])
def resume_rolling_update(cluster_id):
    # (CodeAnt re-scan auth-bypass/IDOR) - cluster-scoped route was missing the tenant gate
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404
    manager = cluster_managers[cluster_id]
    if not hasattr(manager, "_rolling_update") or not manager._rolling_update:
        return jsonify({"error": "No rolling update in progress"}), 400
    if manager._rolling_update.get("status") != "paused":
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({"error": f"Not paused (status: {manager._rolling_update.get('status')})"}), 400
    paused_reason = manager._rolling_update.get("paused_reason", "unknown")
    manager._rolling_update["status"] = "running"
    manager._rolling_update["logs"].append(f"[{time.strftime('%H:%M:%S')}] ▶ Resumed (was: {paused_reason})")
    return jsonify({"success": True, "message": "Resumed", "was_paused_for": paused_reason})


@bp.route("/api/clusters/<cluster_id>/updates/rolling/clear", methods=["POST"])
@require_auth(perms=["node.update"])
def clear_rolling_update_status(cluster_id):
    """Clear completed/cancelled rolling update status (dismiss notification)"""
    # (CodeAnt re-scan auth-bypass/IDOR) - cluster-scoped route was missing the tenant gate
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403
    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404

    manager = cluster_managers[cluster_id]

    if hasattr(manager, "_rolling_update") and manager._rolling_update:
        status = manager._rolling_update.get("status", "")
        # Only clear if not currently running
        if status in ["completed", "cancelled", "failed"]:
            manager._rolling_update = None
            return jsonify({"success": True, "message": "Status cleared"})
        else:
            return jsonify({"error": "Cannot clear running update"}), 400

    return jsonify({"success": True, "message": "Nothing to clear"})


# ============================================
# APT Repository Management
# APT repo management per node
# ============================================

# Standard Proxmox repositories
# Note: Proxmox 8.x uses .sources files (DEB822 format) instead of .list
# The API handles both formats, we match by URI
PROXMOX_REPOS = {
    "pve-enterprise": {
        "name": "Proxmox VE Enterprise",
        "file": "/etc/apt/sources.list.d/pve-enterprise.list",  # Legacy
        "sources_file": "/etc/apt/sources.list.d/pve-enterprise.sources",  # New format
        "line": "deb https://enterprise.proxmox.com/debian/pve bookworm pve-enterprise",
        "description": "Stable enterprise repository (requires subscription)",
        "requires_subscription": True,
        "match_uri": "enterprise.proxmox.com/debian/pve",
    },
    "pve-no-subscription": {
        "name": "Proxmox VE No-Subscription",
        "file": "/etc/apt/sources.list.d/pve-no-subscription.list",
        "sources_file": "/etc/apt/sources.list.d/pve-no-subscription.sources",
        "line": "deb http://download.proxmox.com/debian/pve bookworm pve-no-subscription",
        "description": "Testing/community repository (no subscription required)",
        "requires_subscription": False,
        "match_uri": "download.proxmox.com/debian/pve",
    },
    "ceph-squid": {
        "name": "Ceph Squid (19.x)",
        "file": "/etc/apt/sources.list.d/ceph.list",
        "sources_file": "/etc/apt/sources.list.d/ceph.sources",
        "line": "deb http://download.proxmox.com/debian/ceph-squid bookworm no-subscription",
        "description": "Ceph Squid storage repository (newest)",
        "requires_subscription": False,
        "match_uri": "ceph-squid",
    },
    "ceph-reef": {
        "name": "Ceph Reef (18.x)",
        "file": "/etc/apt/sources.list.d/ceph.list",
        "sources_file": "/etc/apt/sources.list.d/ceph.sources",
        "line": "deb http://download.proxmox.com/debian/ceph-reef bookworm no-subscription",
        "description": "Ceph Reef storage repository",
        "requires_subscription": False,
        "match_uri": "ceph-reef",
    },
    "ceph-quincy": {
        "name": "Ceph Quincy (17.x)",
        "file": "/etc/apt/sources.list.d/ceph.list",
        "sources_file": "/etc/apt/sources.list.d/ceph.sources",
        "line": "deb http://download.proxmox.com/debian/ceph-quincy bookworm no-subscription",
        "description": "Ceph Quincy storage repository (older)",
        "requires_subscription": False,
        "match_uri": "ceph-quincy",
    },
    "ceph-enterprise": {
        "name": "Ceph Enterprise",
        "file": "/etc/apt/sources.list.d/ceph.list",
        "sources_file": "/etc/apt/sources.list.d/ceph.sources",
        "line": "deb https://enterprise.proxmox.com/debian/ceph-squid bookworm enterprise",
        "description": "Ceph Enterprise repository (requires subscription)",
        "requires_subscription": True,
        "match_uri": "enterprise.proxmox.com/debian/ceph",
    },
}


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/repos", methods=["GET"])
@require_auth(perms=["node.view"])
def get_node_repos(cluster_id, node):
    """Get APT repository configuration for a node

    Fixed to match by full URI path, not just domain
    e.g. /debian/pve vs /debian/ceph-reef
    """
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]

    try:
        host, port = mgr.host, mgr.api_port

        # Get all repos via Proxmox API
        file_url = f"https://{host}:{port}/api2/json/nodes/{node}/apt/repositories"
        r = mgr._create_session().get(file_url, timeout=10)

        if r.status_code != 200:
            return jsonify({"error": "Failed to get repositories from Proxmox API"}), 500

        api_data = r.json().get("data", {})
        api_files = api_data.get("files", [])

        logging.debug(f"[REPOS] Got {len(api_files)} files from Proxmox API for node {node}")
        for f in api_files:
            logging.debug(f"[REPOS] File: {f.get('path')} with {len(f.get('repositories', []))} repos")

        repos = []

        # Check each known repo
        for repo_id, repo_info in PROXMOX_REPOS.items():
            repo_data = {
                "id": repo_id,
                "name": repo_info["name"],
                "description": repo_info["description"],
                "file": repo_info["file"],  # Expected file (may differ from actual)
                "actual_file": None,  # Where we actually found it
                "expected_line": repo_info["line"],
                "requires_subscription": repo_info.get("requires_subscription", False),
                "enabled": False,
                "exists": False,
                "content": None,
                "index": None,  # Index within the file for toggle
            }

            # Use the match_uri if defined, otherwise parse from line
            match_uri = repo_info.get("match_uri", "")
            if not match_uri:
                expected_parts = repo_info["line"].split()
                expected_url = expected_parts[1] if len(expected_parts) > 1 else ""
                url_without_proto = expected_url.replace("https://", "").replace("http://", "")
                url_parts = url_without_proto.split("/")
                match_uri = "/".join(url_parts[:3]) if len(url_parts) >= 3 else url_without_proto

            logging.debug(f"[REPOS] Looking for {repo_id}: match_uri={match_uri}")

            # Search in ALL files
            for file_info in api_files:
                file_path = file_info.get("path", "")

                for idx, repo_entry in enumerate(file_info.get("repositories", [])):
                    repo_uris = repo_entry.get("URIs", [])

                    for uri in repo_uris:
                        uri_clean = uri.replace("https://", "").replace("http://", "")

                        # Match by the match_uri string
                        if match_uri in uri_clean:
                            repo_data["exists"] = True
                            repo_data["actual_file"] = file_path
                            repo_data["index"] = idx

                            # Proxmox API: Enabled is 1 for enabled, 0 for disabled
                            enabled_val = repo_entry.get("Enabled")
                            if enabled_val is None:
                                repo_data["enabled"] = True
                            else:
                                repo_data["enabled"] = enabled_val == 1

                            repo_data["content"] = repo_entry
                            repo_data["file"] = file_path
                            logging.info(
                                f"[REPOS] Found {repo_id} in {file_path}[{idx}]: enabled={repo_data['enabled']}, uri={uri}"
                            )
                            break

                    if repo_data["exists"]:
                        break

                if repo_data["exists"]:
                    break

            repos.append(repo_data)

        # Also add any other Proxmox-related repos found that we don't have defined
        # This helps when Proxmox adds new repos
        known_uris = set()
        for repo_info in PROXMOX_REPOS.values():
            known_uris.add(repo_info.get("match_uri", ""))

        for file_info in api_files:
            file_path = file_info.get("path", "")

            for idx, repo_entry in enumerate(file_info.get("repositories", [])):
                repo_uris = repo_entry.get("URIs", [])

                for uri in repo_uris:
                    uri_clean = uri.replace("https://", "").replace("http://", "")

                    # Only show Proxmox-related repos that aren't already in our list
                    if "proxmox.com" in uri_clean or "download.proxmox" in uri_clean:
                        # Check if this is already covered by known repos
                        already_known = any(known_uri in uri_clean for known_uri in known_uris if known_uri)

                        if not already_known:
                            # This is an unknown Proxmox repo - show it
                            enabled_val = repo_entry.get("Enabled")
                            is_enabled = enabled_val == 1 if enabled_val is not None else True

                            # Generate a unique ID
                            repo_id_other = f"other-{hash(uri) % 10000}"

                            repos.append({
                                "id": repo_id_other,
                                "name": uri_clean.split("/")[0],  # Domain as name
                                "description": f"Found in {file_path}",
                                "file": file_path,
                                "actual_file": file_path,
                                "expected_line": f"deb {uri}",
                                "requires_subscription": "enterprise" in uri_clean.lower(),
                                "enabled": is_enabled,
                                "exists": True,
                                "content": repo_entry,
                                "index": idx,
                                "uri": uri,
                                "is_other": True,  # Flag for UI
                            })

        return jsonify({"success": True, "node": node, "repositories": repos})

    except Exception as e:
        logging.error(f"Failed to get repositories: {e}", exc_info=True)
        return jsonify({"error": "Failed to get repositories"}), 500


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/repos/<repo_id>", methods=["PUT"])
@require_auth(perms=["node.update"])
def update_node_repo(cluster_id, node, repo_id):
    """Enable or disable a repository on a node

    Fixed to match by full URI path, not just domain
    Extended to support "other" repos by file path and index
    """
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]

    data = request.get_json() or {}
    enabled = data.get("enabled", True)

    # Check if this is a known repo or an "other" repo
    if repo_id.startswith("other-"):
        # For "other" repos, we need the file path and index from the request
        file_path = data.get("file")
        repo_index = data.get("index")

        if file_path is None or repo_index is None:
            return jsonify({"error": "file and index required for custom repository toggle"}), 400

        repo_name = data.get("name", repo_id)
    elif repo_id not in PROXMOX_REPOS:
        # snyk:ignore:Cross-site Scripting (XSS)
        return jsonify({"error": f"Unknown repository: {repo_id}"}), 400
    else:
        repo_info = PROXMOX_REPOS[repo_id]
        repo_name = repo_info["name"]

    try:
        host, port = mgr.host, mgr.api_port

        # Use Proxmox API to modify repository
        url = f"https://{host}:{port}/api2/json/nodes/{node}/apt/repositories"

        # For known repos, we need to find them first
        if not repo_id.startswith("other-"):
            # First get current repos to find the index
            r = mgr._create_session().get(url, timeout=10)
            if r.status_code != 200:
                return jsonify({"error": "Failed to get current repositories"}), 500

            api_repos = r.json().get("data", {})

            # Use match_uri for consistent matching
            match_uri = repo_info.get("match_uri", "")
            if not match_uri:
                expected_parts = repo_info["line"].split()
                expected_url = expected_parts[1] if len(expected_parts) > 1 else ""
                url_without_proto = expected_url.replace("https://", "").replace("http://", "")
                url_parts = url_without_proto.split("/")
                match_uri = "/".join(url_parts[:3]) if len(url_parts) >= 3 else url_without_proto

            # Find the repo in ANY file
            repo_index = None
            found_file_path = None

            for file_info in api_repos.get("files", []):
                current_path = file_info.get("path", "")

                for idx, repo_entry in enumerate(file_info.get("repositories", [])):
                    repo_uris = repo_entry.get("URIs", [])
                    for uri in repo_uris:
                        uri_clean = uri.replace("https://", "").replace("http://", "")
                        # Match by match_uri
                        if match_uri in uri_clean:
                            repo_index = idx
                            found_file_path = current_path
                            logging.info(f"[REPOS] Found {repo_id} at index {idx} in {current_path}")
                            break
                    if repo_index is not None:
                        break
                if repo_index is not None:
                    break

            if repo_index is None:
                return jsonify({
                    "error": "Repository not found. Manual setup required.",
                    "hint": f"Add the repository to /etc/apt/sources.list or create {repo_info['file']}",
                }), 400
        else:
            # For "other" repos, we already have file_path and repo_index from the request
            found_file_path = file_path

        # Toggle the repo
        toggle_url = f"https://{host}:{port}/api2/json/nodes/{node}/apt/repositories"
        payload = {"path": found_file_path, "index": repo_index, "enabled": 1 if enabled else 0}

        logging.info(f"[REPOS] Toggling {repo_id}: path={found_file_path}, index={repo_index}, enabled={enabled}")

        r = mgr._create_session().post(toggle_url, data=payload, timeout=10)

        if r.status_code in [200, 204]:
            action = "enabled" if enabled else "disabled"
            log_audit(request.session["user"], "node.repo.updated", f"Repository {repo_name} {action} on {node}")

            return jsonify({
                "success": True,
                "message": f"Repository {repo_name} {action}",
                "repo": repo_id,
                "enabled": enabled,
            })
        else:
            # snyk:ignore:Cross-site Scripting (XSS)
            return jsonify({"error": f"Failed to update repository: {r.status_code}", "details": r.text}), 500

    except Exception as e:
        logging.error(f"[API] Failed to update repository: {e}", exc_info=True)
        return jsonify({"error": "Failed to update repository"}), 500


@bp.route("/api/clusters/<cluster_id>/nodes/<node>/repos/refresh", methods=["POST"])
@require_auth(perms=["node.update"])
def refresh_node_repos(cluster_id, node):
    """Run apt update on a node to refresh package lists"""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403

    if cluster_id not in cluster_managers:
        return jsonify({"error": "Cluster not found"}), 404

    mgr = cluster_managers[cluster_id]

    try:
        host, port = mgr.host, mgr.api_port
        url = f"https://{host}:{port}/api2/json/nodes/{node}/apt/update"

        r = mgr._create_session().post(url, timeout=30)

        if r.status_code == 200:
            task_id = r.json().get("data")
            return jsonify({"success": True, "message": "Package list refresh started", "task_id": task_id})
        else:
            # snyk:ignore:Cross-site Scripting (XSS)
            return jsonify({"error": f"Failed to refresh: {r.status_code}"}), 500

    except Exception as e:
        logging.error(f"[API] Failed to refresh repositories: {e}", exc_info=True)
        return jsonify({"error": "Failed to refresh repositories"}), 500


@bp.route("/api/timezones", methods=["GET"])
def get_timezones_api():
    """Get list of available timezones"""
    # Return a static list - works for any cluster
    return jsonify([
        "UTC",
        "Europe/Berlin",
        "Europe/Vienna",
        "Europe/Zurich",
        "Europe/London",
        "Europe/Paris",
        "Europe/Amsterdam",
        "Europe/Brussels",
        "Europe/Rome",
        "Europe/Madrid",
        "Europe/Warsaw",
        "Europe/Prague",
        "Europe/Budapest",
        "America/New_York",
        "America/Chicago",
        "America/Los_Angeles",
        "Asia/Tokyo",
        "Asia/Shanghai",
        "Asia/Singapore",
        "Australia/Sydney",
        "Pacific/Auckland",
    ])


# ==================== END NODE MANAGEMENT API ENDPOINTS ====================

# ============================================
# WebSocket Live Updates
# ============================================

# =====================================================
# LDAP Test Connection
# =====================================================


@bp.route("/api/settings/ldap/test", methods=["POST"])
@require_auth(perms=["admin.settings"])
def test_ldap():
    """Test LDAP connection and optionally test user authentication"""
    data = request.json or {}

    # Build config from request data (for testing before save)
    saved = load_server_settings()

    config = {
        "enabled": True,  # Force enabled for test
        "server": data.get("ldap_server", saved.get("ldap_server", "")),
        "port": sanitize_int(data.get("ldap_port", saved.get("ldap_port", 389)), default=389, min_val=1, max_val=65535),
        "use_ssl": data.get("ldap_use_ssl", saved.get("ldap_use_ssl", False)),
        "use_starttls": data.get("ldap_use_starttls", saved.get("ldap_use_starttls", False)),
        "bind_dn": data.get("ldap_bind_dn", saved.get("ldap_bind_dn", "")),
        "bind_password": data.get("ldap_bind_password", ""),
        "base_dn": data.get("ldap_base_dn", saved.get("ldap_base_dn", "")),
        "user_filter": data.get(
            "ldap_user_filter", saved.get("ldap_user_filter", "(&(objectClass=person)(sAMAccountName={username}))")
        ),
        "username_attribute": data.get(
            "ldap_username_attribute", saved.get("ldap_username_attribute", "sAMAccountName")
        ),
        "email_attribute": data.get("ldap_email_attribute", saved.get("ldap_email_attribute", "mail")),
        "display_name_attribute": data.get(
            "ldap_display_name_attribute", saved.get("ldap_display_name_attribute", "displayName")
        ),
        "verify_tls": data.get("ldap_verify_tls", saved.get("ldap_verify_tls", False)),
    }

    # Use saved password if masked
    if not config["bind_password"] or config["bind_password"] == "********":
        config["bind_password"] = get_db()._decrypt(saved.get("ldap_bind_password", ""))  # Decrypt stored credential

    if not config["server"]:
        return jsonify({"error": "LDAP server is required"}), 400

    try:
        import ssl as ssl_module

        from ldap3 import ALL, SUBTREE, Connection, Server, Tls
        from ldap3.utils.conv import escape_filter_chars
    except ImportError:
        return jsonify({"error": "ldap3 module not installed. Run: pip install ldap3"}), 500

    results = {"steps": []}

    try:
        # Step 1: Connect to server
        # Use verify_tls from config instead of hardcoded CERT_NONE
        tls_config = None
        if config["use_ssl"] or config["use_starttls"]:
            validate = ssl_module.CERT_REQUIRED if config["verify_tls"] else ssl_module.CERT_NONE
            tls_config = Tls(validate=validate)

        server = Server(
            config["server"],
            port=config["port"],
            use_ssl=config["use_ssl"],
            tls=tls_config,
            get_info=ALL,
            connect_timeout=10,
        )

        # Step 2: Bind with service account
        # Same fix as ldap_authenticate - starttls before bind!!
        use_starttls = config["use_starttls"] and not config["use_ssl"]

        if config["bind_dn"] and config["bind_password"]:
            conn = Connection(server, user=config["bind_dn"], password=config["bind_password"], raise_exceptions=True)
        else:
            conn = Connection(server, raise_exceptions=True)

        try:
            conn.open()
            # Issue #70: Report "Server connection" AFTER conn.open() -- Server() doesn't actually connect
            results["steps"].append({
                "step": "Server connection",
                "status": "ok",
                "detail": f"{config['server']}:{config['port']}",
            })

            if use_starttls:
                conn.start_tls()
                results["steps"].append({"step": "STARTTLS", "status": "ok"})

            conn.bind()

            if config["bind_dn"] and config["bind_password"]:
                results["steps"].append({"step": "Service account bind", "status": "ok", "detail": config["bind_dn"]})
            else:
                results["steps"].append({"step": "Anonymous bind", "status": "ok"})

            # Step 3: Search base DN
            if config["base_dn"]:
                conn.search(
                    config["base_dn"], "(objectClass=*)", search_scope="BASE", attributes=["objectClass"]
                )  # Issue #70: 'dn' is not a valid attribute
                results["steps"].append({"step": "Base DN accessible", "status": "ok", "detail": config["base_dn"]})

            # Step 4: Optional - test user search
            test_username = data.get("test_username", "")
            if test_username and config["base_dn"]:
                user_filter = config["user_filter"].replace("{username}", escape_filter_chars(test_username))
                conn.search(
                    config["base_dn"],
                    user_filter,
                    search_scope=SUBTREE,
                    attributes=[
                        config["username_attribute"],
                        config["email_attribute"],
                        config["display_name_attribute"],
                        "memberOf",
                    ],
                )

                if conn.entries:
                    entry = conn.entries[0]
                    user_info = {
                        "dn": str(entry.entry_dn),
                        "email": str(entry[config["email_attribute"]]) if config["email_attribute"] in entry else "",
                        "display_name": str(entry[config["display_name_attribute"]])
                        if config["display_name_attribute"] in entry
                        else "",
                        "groups": len(entry["memberOf"]) if "memberOf" in entry else 0,
                    }
                    results["steps"].append({
                        "step": f"User search: {test_username}",
                        "status": "ok",
                        "detail": user_info,
                    })
                else:
                    results["steps"].append({
                        "step": f"User search: {test_username}",
                        "status": "warning",
                        "detail": "User not found",
                    })

            # Get server info
            results["server_info"] = {
                "vendor": str(server.info.vendor_name) if server.info and server.info.vendor_name else "Unknown",
                "naming_contexts": [str(nc) for nc in (server.info.naming_contexts or [])] if server.info else [],
            }

            results["success"] = True
            results["message"] = "LDAP connection successful"

        finally:
            # Issue #70: Always clean up connection, even on error
            with contextlib.suppress(Exception):
                conn.unbind()

    except Exception as e:
        results["success"] = False
        results["error"] = str(e)
        # Issue #70: Identify which step failed based on what succeeded so far
        completed = [s["step"] for s in results["steps"]]
        if "Server connection" not in completed:
            failed_step = "Server connection"
        elif not any("bind" in s.lower() for s in completed):
            failed_step = "Bind"
        elif "Base DN accessible" not in completed and config.get("base_dn"):
            failed_step = "Base DN search"
        else:
            failed_step = "Connection"
        results["steps"].append({"step": failed_step, "status": "error", "detail": str(e)})

    return jsonify(results)


# =====================================================
# User Theme Preference (002-ui-dark-mode)
# =====================================================


@bp.route("/api/settings", methods=["GET", "PUT"])
@require_auth()
def user_theme_settings():
    """Get or update the authenticated user's light/dark/system theme preference."""
    username = request.session.get("user") if request.session else None
    if not username:
        return jsonify({"error": "Not authenticated"}), 401

    db = get_db()
    cursor = db.conn.cursor()

    if request.method == "GET":
        try:
            cursor.execute("SELECT theme FROM users WHERE username = ?", (username,))
            row = cursor.fetchone()
            theme = (row[0] if row and row[0] is not None else "").strip() or "system"
            return jsonify({"theme": theme})
        except Exception as e:
            logging.error(f"Error reading theme for {username}: {e}")
            return jsonify({"error": "Database error"}), 500

    # PUT
    data = request.json or {}
    theme = str(data.get("theme", "")).strip().lower()
    if theme not in ("light", "dark", "system"):
        return jsonify({"error": "Invalid theme value; must be light, dark, or system"}), 400

    try:
        cursor.execute("UPDATE users SET theme = ? WHERE username = ?", (theme, username))
        db.conn.commit()
        return jsonify({"theme": theme})
    except Exception as e:
        logging.error(f"Error saving theme for {username}: {e}")
        return jsonify({"error": "Database error"}), 500
