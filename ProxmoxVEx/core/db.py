# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/core/db.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: ProxmoxVEx Database - Layer 2
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
ProxmoxVEx Database - Layer 2
SQLite database wrapper with encryption support.
"""
# The database stuff was the worst part of the monolith, everything was just inline sql

import base64
import contextlib
import gzip
import hashlib
import hmac
import json
import logging
import os
import shutil

# Database connections now go through `dbcrypto.connect()` so
# SQLCipher kicks in automatically when available.  The legacy `sqlite3`
# alias is kept for the Row / IntegrityError types we use in queries below.
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List

from ProxmoxVEx.constants import (
    AFFINITY_RULES_FILE,
    ALERTS_CONFIG_FILE,
    AUDIT_LOG_FILE,
    AUDIT_LOG_FILE_ENCRYPTED,
    CONFIG_DIR,
    CONFIG_FILE,
    CONFIG_FILE_ENCRYPTED,
    CUSTOM_ROLES_FILE,
    ESXI_CONFIG_FILE,
    KEY_FILE,
    MIGRATION_HISTORY_FILE,
    SCHEDULED_TASKS_FILE,
    SERVER_SETTINGS_FILE,
    SESSIONS_FILE,
    SESSIONS_FILE_ENCRYPTED,
    STORAGE_CLUSTERS_FILE,
    USERS_FILE_ENCRYPTED,
    VM_TAGS_FILE,
)
from ProxmoxVEx.core import dbcrypto

# In-memory query result cache for database layer.
_QUERY_CACHE = {}
_QUERY_CACHE_TTL = 30


def _query_cache_key(query, params=None):
    """Build a cache key from a SQL query and parameters."""
    return f"{hash(query)}:{hash(str(params))}"


def _get_cached_query(query, params=None):
    """Return a cached query result if it has not expired."""
    key = _query_cache_key(query, params)
    entry = _QUERY_CACHE.get(key)
    if entry is None or (datetime.utcnow() - entry["ts"]).total_seconds() > _QUERY_CACHE_TTL:
        return None
    return entry["data"]


def _cache_query_result(query, params=None, data=None):
    """Store a database query result in the in-memory cache."""
    _QUERY_CACHE[_query_cache_key(query, params)] = {"ts": datetime.utcnow(), "data": data}


# Lazy-loaded / deferred columns for database queries.
_LAZY_QUERY_COLUMNS = {
    "metadata",
    "history",
    "extended",
}


def _prune_lazy_query_columns(row):
    """Remove lazy/deferred columns from a database query row."""
    if not isinstance(row, dict):
        return row
    return {k: v for k, v in row.items() if k not in _LAZY_QUERY_COLUMNS}


# Pagination defaults and helper for database queries.
_PAGINATION_DEFAULT = 50


def _paginate_query(query, params=None, page=1, per_page=None):
    """Apply LIMIT/OFFSET pagination to a database query and its parameters."""
    if per_page is None:
        per_page = _PAGINATION_DEFAULT
    if page is None or page < 1:
        page = 1
    per_page = max(1, per_page)
    offset = (page - 1) * per_page
    paginated = f"{query.rstrip(';').strip()} LIMIT ? OFFSET ?"
    params = list(params or [])
    params.extend([per_page, offset])
    return paginated, params


# Batch size default and helper for chunking database operations.
_BATCH_SIZE = 100


def _batch_query(items, batch_size=None):
    """Split a list of query parameters into fixed-size batches."""
    if batch_size is None:
        batch_size = _BATCH_SIZE
    batch_size = max(1, batch_size)
    for i in range(0, len(items), batch_size):
        yield items[i : i + batch_size]


# Indexing helper for fast query result lookups.
_QUERY_INDEX_KEYS = ("id",)


def _index_query_results(rows, key="id"):
    """Build a lookup index for query results by a key field."""
    if not rows:
        return {}
    return {row[key]: row for row in rows if isinstance(row, dict) and key in row}


# Compression helpers for database query results.
def _compress_query_result(data):
    """Compress a query result using gzip and base64."""
    raw = json.dumps(data, default=str).encode("utf-8")
    return base64.b64encode(gzip.compress(raw)).decode("ascii")


def _decompress_query_result(payload):
    """Decompress a gzip/base64 query result payload."""
    raw = base64.b64decode(payload.encode("ascii"))
    return json.loads(gzip.decompress(raw).decode("utf-8"))


# Connection pool for database queries.
_DB_CONNECTION_POOL = {}
_DB_POOL_MAX_SIZE = 10


def _get_db_connection(db_path):
    """Retrieve or create a pooled database connection for a given database path."""
    if db_path in _DB_CONNECTION_POOL:
        return _DB_CONNECTION_POOL[db_path]
    if len(_DB_CONNECTION_POOL) >= _DB_POOL_MAX_SIZE:
        _DB_CONNECTION_POOL.popitem(last=False)
    conn = dbcrypto.connect(db_path)
    _DB_CONNECTION_POOL[db_path] = conn
    return conn


# Async worker registry for database queries.
_ASYNC_DB_WORKERS = {}


def _start_async_db_worker(name, target, args=()):
    """Start a named background thread for a database worker task."""
    if name in _ASYNC_DB_WORKERS:
        return _ASYNC_DB_WORKERS[name]
    thread = threading.Thread(target=target, args=args, daemon=True)
    thread.start()
    _ASYNC_DB_WORKERS[name] = thread
    return thread


# Memory-optimised query response helpers.
_QUERY_ESSENTIAL_FIELDS = ("id", "name", "status")


def _memory_optimise_query_payload(payload, fields=None):
    """Return a memory-optimised query result with only essential fields."""
    if fields is None:
        fields = _QUERY_ESSENTIAL_FIELDS
    if isinstance(payload, dict):
        return {k: v for k, v in payload.items() if k in fields}
    if isinstance(payload, list):
        return [{k: v for k, v in item.items() if k in fields} for item in payload if isinstance(item, dict)]
    return payload


# Incremental updates helper for database query results.
_QUERY_INCREMENTAL_TIMESTAMP_KEY = "updated_at"


def _incremental_query_updates(rows, since=None, timestamp_key=None):
    """Filter query result rows to only those updated since a given timestamp."""
    if timestamp_key is None:
        timestamp_key = _QUERY_INCREMENTAL_TIMESTAMP_KEY
    if since is None:
        return rows
    return [row for row in rows if isinstance(row, dict) and row.get(timestamp_key, "") >= since]


def _load_dotenv():
    """Load a project-root .env file into os.environ if one exists.

    Uses setdefault so an already-exported environment variable wins over the file.
    """
    dotenv = Path(__file__).resolve().parents[2] / ".env"
    if dotenv.exists():
        for line in dotenv.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip("\"' ")
            if key:
                os.environ.setdefault(key, val)


_load_dotenv()


# Fallback tenant ID for existing users (mirrors ProxmoxVEx.utils.rbac.DEFAULT_TENANT_ID)
# Defined here to avoid circular import: rbac imports from db
DEFAULT_TENANT_ID = "default"

# Encryption imports
ENCRYPTION_AVAILABLE = False
LEGACY_ENCRYPTION = False
try:
    from cryptography.fernet import Fernet
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    ENCRYPTION_AVAILABLE = True
    LEGACY_ENCRYPTION = True
except ImportError:
    pass


class ProxmoxVExDB:
    """
    PostgreSQL-backed database base class.

    The old SQLite/SQLCipher initializer has been removed; production uses
    the ``ProxmoxVExPGDB`` subclass which connects to PostgreSQL. This base
    still holds the shared CRUD helpers so both implementations can share a
    single method set.
    """

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        # singleton - only one db connection
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        raise NotImplementedError(
            "The SQLite/SQLCipher backend has been removed. Use ProxmoxVExPGDB (PostgreSQL) via get_db()."
        )

    def _init_encryption(self):
        """setup encryption keys"""
        if not ENCRYPTION_AVAILABLE:
            logging.warning("no encryption available!")
            return

        # Ensure config directory exists before writing key file
        os.makedirs(CONFIG_DIR, mode=0o700, exist_ok=True)

        # AES-256 key file (canonical casing)
        aes_key_file = os.path.join(CONFIG_DIR, ".ProxmoxVEx_aes256.key")
        # Legacy casing used by earlier builds; keep as a fallback for data
        # encrypted before the key filename was standardised.
        legacy_aes_key_file = os.path.join(CONFIG_DIR, ".proxmoxVEx_aes256.key")

        def _read_key(path):
            try:
                with open(path, "rb") as f:
                    return f.read()
            except Exception:
                return None

        def _write_key(path, key):
            with open(path, "wb") as f:
                f.write(key)
            try:
                os.chmod(path, 0o600)
            except Exception as e:
                logging.warning(f"Could not set key file permissions on {path}: {e}")

        def _fix_perms(path):
            try:
                mode = os.stat(path).st_mode & 0o777
                if mode != 0o600:
                    logging.warning(f"[SECURITY] Fixing key file permissions: {oct(mode)} → 0o600")
                    os.chmod(path, 0o600)
            except (OSError, ValueError) as e:
                logging.warning(f"[SECURITY] Could not verify/repair key file permissions: {e}")

        # Load or generate canonical AES-256 key
        aes_key = None
        if os.path.exists(aes_key_file):
            _fix_perms(aes_key_file)
            aes_key = _read_key(aes_key_file)
            if len(aes_key) != 32:
                logging.warning(f"Invalid AES key length in {aes_key_file}, discarding")
                aes_key = None

        # Promote the legacy-cased key if the canonical one is missing or
        # invalid. This preserves decryption of data written by older builds.
        if aes_key is None and os.path.exists(legacy_aes_key_file):
            legacy_key = _read_key(legacy_aes_key_file)
            if len(legacy_key) == 32:
                logging.info("Promoting legacy AES key file to canonical location")
                _write_key(aes_key_file, legacy_key)
                aes_key = legacy_key
            else:
                logging.warning(f"Invalid legacy AES key length in {legacy_aes_key_file}")

        if aes_key is None:
            # No usable key found - generate a fresh one. Old data encrypted
            # with a lost key is unrecoverable, but new writes will be safe.
            aes_key = os.urandom(32)
            _write_key(aes_key_file, aes_key)
            logging.info("Generated new AES-256-GCM encryption key")

        self.aesgcm = AESGCM(aes_key)
        self.aes_key = aes_key  # Store raw key for HMAC signing

        # Load any additional legacy keys as read-only fallbacks so rows
        # encrypted before a key rotation/casing change can still be read.
        self._aesgcm_fallbacks = []
        if os.path.exists(legacy_aes_key_file):
            legacy_key = _read_key(legacy_aes_key_file)
            if legacy_key and len(legacy_key) == 32 and legacy_key != aes_key:
                self._aesgcm_fallbacks.append(AESGCM(legacy_key))
                logging.info(f"Loaded fallback AES key from {legacy_aes_key_file}")

        # Load legacy Fernet key for backwards compatibility
        if os.path.exists(KEY_FILE):
            try:
                with open(KEY_FILE, "rb") as f:
                    fernet_key = f.read()
                self.fernet = Fernet(fernet_key)
                logging.debug("Loaded legacy Fernet key for migration support")
            except Exception as e:
                logging.warning(f"Could not load legacy Fernet key: {e}")
        else:
            # Generate Fernet key for potential fallback
            fernet_key = Fernet.generate_key()
            with open(KEY_FILE, "wb") as f:
                f.write(fernet_key)
            try:
                os.chmod(KEY_FILE, 0o600)
            except Exception as e:
                logging.warning(f"Could not set Fernet key file permissions: {e}")
            self.fernet = Fernet(fernet_key)
            logging.info("Generated legacy Fernet key (for compatibility)")

        # Refuse to start without encryption
        if not self.aesgcm and not self.fernet:
            raise RuntimeError("FATAL: No encryption backend available. Cannot start safely.")

    @property
    def conn(self):
        """Concrete subclasses override this to return their connection."""
        raise NotImplementedError()

    def _init_db(self):
        """Initialize database schema

        Also sets restrictive file permissions (0600) on the database file.
        This prevents other users on the system from reading the DB.
        """
        conn = self.conn
        cursor = conn.cursor()

        # Set restrictive permissions on database file - only owner can read/write
        # This is critical security - DB contains encrypted secrets and session data.
        # PostgreSQL has no local file to chmod; db_path is None in that mode.
        try:
            if self.db_path and os.path.exists(self.db_path):
                os.chmod(self.db_path, 0o600)
                logging.debug("Set database file permissions to 0600")
        except Exception as e:
            logging.warning(f"Could not set database file permissions: {e}")

        # Clusters table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS clusters (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                user TEXT NOT NULL,
                pass_encrypted TEXT NOT NULL,
                ssl_verification INTEGER DEFAULT 1,
                migration_threshold INTEGER DEFAULT 30,
                migration_tolerance INTEGER DEFAULT 10,
                check_interval INTEGER DEFAULT 300,
                auto_migrate INTEGER DEFAULT 0,
                balance_containers INTEGER DEFAULT 0,
                balance_local_disks INTEGER DEFAULT 0,
                proxlb_tags_enabled INTEGER DEFAULT 0,
                dry_run INTEGER DEFAULT 1,
                enabled INTEGER DEFAULT 1,
                ha_enabled INTEGER DEFAULT 0,
                fallback_hosts TEXT DEFAULT '[]',
                ssh_user TEXT DEFAULT '',
                ssh_key_encrypted TEXT DEFAULT '',
                ssh_port INTEGER DEFAULT 22,
                api_port INTEGER DEFAULT 8006,
                ha_settings TEXT DEFAULT '{}',
                created_at TEXT,
                updated_at TEXT
            )
        """)

        # Users table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT DEFAULT 'viewer',
                permissions TEXT DEFAULT '[]',
                tenant TEXT,
                created_at TEXT,
                last_login TEXT,
                password_expiry TEXT,
                totp_secret_encrypted TEXT,
                totp_pending_secret_encrypted TEXT,
                totp_enabled INTEGER DEFAULT 0,
                force_password_change INTEGER DEFAULT 0,
                enabled INTEGER DEFAULT 1,
                theme TEXT DEFAULT '',
                language TEXT DEFAULT '',
                ui_layout TEXT DEFAULT 'modern',
                taskbar_auto_expand INTEGER DEFAULT 1,
                auth_source TEXT DEFAULT 'local',
                display_name TEXT DEFAULT '',
                email TEXT DEFAULT '',
                avatar_mime TEXT DEFAULT '',
                avatar_data TEXT DEFAULT '',
                ldap_dn TEXT DEFAULT '',
                last_ldap_sync TEXT DEFAULT '',
                tenant_permissions TEXT DEFAULT '{}',
                denied_permissions TEXT DEFAULT '[]',
                oidc_sub TEXT DEFAULT '',
                last_oidc_sync TEXT DEFAULT '',
                layout_chosen INTEGER DEFAULT 0,
                taskbar_visible INTEGER DEFAULT 1,
                taskbar_expanded INTEGER DEFAULT 0
            )
        """)

        # Sessions table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                created_at TEXT,
                expires_at TEXT,
                ip_address TEXT,
                user_agent TEXT
            )
        """)

        # Audit log table with HMAC integrity verification
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                user TEXT,
                action TEXT NOT NULL,
                details TEXT,
                ip_address TEXT,
                hmac_signature TEXT
            )
        """)

        # Create index for audit log queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user)
        """)

        # Task-User mapping table for tracking who initiated tasks
        # This persists across server restarts and is visible to all users
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS task_users (
                upid TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                cluster_id TEXT,
                created_at TEXT NOT NULL
            )
        """)

        # Cleanup old task_users entries (older than 24 hours)
        cursor.execute("""
            DELETE FROM task_users
            WHERE datetime(created_at) < datetime('now', '-24 hours')
        """)

        # Alerts table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS alerts (
                id TEXT PRIMARY KEY,
                cluster_id TEXT,
                node TEXT,
                vmid INTEGER,
                type TEXT NOT NULL,
                threshold REAL,
                enabled INTEGER DEFAULT 1,
                notify_methods TEXT DEFAULT '[]',
                cooldown INTEGER DEFAULT 300,
                last_triggered TEXT,
                created_at TEXT
            )
        """)

        # VM ACLs table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS vm_acls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cluster_id TEXT NOT NULL,
                vmid TEXT NOT NULL,
                users TEXT DEFAULT '[]',
                permissions TEXT DEFAULT '[]',
                inherit_role INTEGER DEFAULT 1,
                UNIQUE(cluster_id, vmid)
            )
        """)
        # Inherit_role was never persisted before (no column), so an
        # ACL saved with inherit_role=False (UI "custom permissions" mode) silently
        # became full access in user_can_access_vm. Add the column for existing DBs;
        # default 1 (True) preserves the historical effective behaviour for rows that
        # predate the fix — they always acted as inherit_role=True anyway.
        try:
            cursor.execute("PRAGMA table_info(vm_acls)")
            _acl_cols = [c[1] for c in cursor.fetchall()]
            if "inherit_role" not in _acl_cols:
                cursor.execute("ALTER TABLE vm_acls ADD COLUMN inherit_role INTEGER DEFAULT 1")
                logging.info("Added inherit_role column to vm_acls table")
        except Exception as _ae:
            logging.error(f"vm_acls inherit_role column migration failed: {_ae}")

        # Affinity rules table
        # Added enforce column Feb 2026 - was losing this value on every restart
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS affinity_rules (
                id TEXT PRIMARY KEY,
                cluster_id TEXT NOT NULL,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                vms TEXT NOT NULL DEFAULT '[]',
                enabled INTEGER DEFAULT 1,
                enforce INTEGER DEFAULT 0,
                created_at TEXT
            )
        """)

        # Tenants - requested on reddit
        # Someone on Reddit asked for multi-tenancy support, turns out its
        # pretty useful for MSPs managing multiple customers
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tenants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                clusters TEXT DEFAULT '[]',
                created_at TEXT,
                quota_max_vms INTEGER DEFAULT 0,
                quota_max_cores INTEGER DEFAULT 0,
                quota_max_memory_gb INTEGER DEFAULT 0,
                quota_enforcement TEXT DEFAULT 'block'
            )
        """)
        # #502 - per-tenant quota columns for existing tenants tables (0 = unlimited)
        try:
            cursor.execute("PRAGMA table_info(tenants)")
            _tcols = [c[1] for c in cursor.fetchall()]
            for _cn, _cd in (
                ("quota_max_vms", "INTEGER DEFAULT 0"),
                ("quota_max_cores", "INTEGER DEFAULT 0"),
                ("quota_max_memory_gb", "INTEGER DEFAULT 0"),
                ("quota_enforcement", "TEXT DEFAULT 'block'"),
            ):
                if _cn not in _tcols:
                    cursor.execute(f"ALTER TABLE tenants ADD COLUMN {_cn} {_cd}")  # nosec: B608 - column names/definitions from internal hardcoded migration allowlist
                    logging.info(f"Added {_cn} column to tenants table")
        except Exception as _qe:
            logging.error(f"tenant quota column migration failed: {_qe}")

        # Cluster Groups - organize clusters into collapsible groups with tenant assignment
        # Requested by user for better organization
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS cluster_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                color TEXT DEFAULT '#E86F2D',
                tenant_id TEXT,
                sort_order INTEGER DEFAULT 0,
                collapsed INTEGER DEFAULT 0,
                created_at TEXT,
                updated_at TEXT,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id)
            )
        """)

        # Custom roles table - need composite key for name + tenant_id
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS custom_roles (
                name TEXT NOT NULL,
                permissions TEXT NOT NULL DEFAULT '[]',
                description TEXT,
                tenant_id TEXT,
                created_at TEXT,
                PRIMARY KEY (name, tenant_id)
            )
        """)

        # Migration: Recreate table with correct schema if needed
        try:
            cursor.execute("SELECT tenant_id FROM custom_roles LIMIT 1")
        except Exception:
            # Old table without tenant_id - recreate
            cursor.execute("DROP TABLE IF EXISTS custom_roles")
            cursor.execute("""
                CREATE TABLE custom_roles (
                    name TEXT NOT NULL,
                    permissions TEXT NOT NULL DEFAULT '[]',
                    description TEXT,
                    tenant_id TEXT,
                    created_at TEXT,
                    PRIMARY KEY (name, tenant_id)
                )
            """)

        # Scheduled tasks table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS scheduled_tasks (
                id TEXT PRIMARY KEY,
                cluster_id TEXT,
                name TEXT NOT NULL,
                task_type TEXT NOT NULL,
                schedule TEXT NOT NULL,
                config TEXT DEFAULT '{}',
                enabled INTEGER DEFAULT 1,
                last_run TEXT,
                next_run TEXT,
                created_at TEXT
            )
        """)

        # Scheduled task run history
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS scheduled_task_runs (
                run_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                started_at TEXT,
                ended_at TEXT,
                duration REAL,
                status TEXT,
                output TEXT,
                error TEXT
            )
        """)

        # VM Tags table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS vm_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cluster_id TEXT NOT NULL,
                vmid INTEGER NOT NULL,
                tag_name TEXT NOT NULL,
                tag_color TEXT,
                UNIQUE(cluster_id, vmid, tag_name)
            )
        """)

        # Balancing excluded VMs table
        # VMs that should not be automatically migrated during load balancing
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS balancing_excluded_vms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cluster_id TEXT NOT NULL,
                vmid INTEGER NOT NULL,
                reason TEXT,
                created_by TEXT,
                created_at TEXT,
                UNIQUE(cluster_id, vmid)
            )
        """)

        # Migration history table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS migration_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cluster_id TEXT NOT NULL,
                vmid INTEGER NOT NULL,
                vm_name TEXT,
                source_node TEXT NOT NULL,
                target_node TEXT NOT NULL,
                reason TEXT,
                status TEXT,
                duration_seconds REAL,
                timestamp TEXT NOT NULL
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_migration_timestamp ON migration_history(timestamp DESC)
        """)

        # Server settings table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS server_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)

        # User favorites table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_favorites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                cluster_id TEXT,
                vmid INTEGER,
                vm_type TEXT,
                vm_name TEXT,
                added_at TEXT
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_favorites_user ON user_favorites(username)
        """)

        # Scheduled actions table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS scheduled_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cluster_id TEXT,
                vmid INTEGER,
                vm_type TEXT DEFAULT 'qemu',
                action TEXT NOT NULL,
                schedule_type TEXT NOT NULL,
                schedule_time TEXT,
                schedule_days TEXT,
                schedule_date TEXT,
                enabled INTEGER DEFAULT 1,
                last_run TEXT,
                name TEXT,
                created_by TEXT,
                created_at TEXT
            )
        """)
        # (#337): existing deployments are missing name + vm_type columns.
        # Both were in the Python in-memory model but never persisted, so edits
        # dropped both back to defaults on reload. Migrate in-place.
        try:
            cursor.execute("PRAGMA table_info(scheduled_actions)")
            cols = {row["name"] for row in cursor.fetchall()}
            if "name" not in cols:
                cursor.execute("ALTER TABLE scheduled_actions ADD COLUMN name TEXT")
            if "vm_type" not in cols:
                cursor.execute("ALTER TABLE scheduled_actions ADD COLUMN vm_type TEXT DEFAULT 'qemu'")
        except Exception as _migr_e:
            logging.warning(f"scheduled_actions migration skipped: {_migr_e}")

        # Update schedules table
        # For automatic rolling updates
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS update_schedules (
                cluster_id TEXT PRIMARY KEY,
                enabled INTEGER DEFAULT 0,
                schedule_type TEXT DEFAULT 'recurring',
                day TEXT DEFAULT 'sunday',
                time TEXT DEFAULT '03:00',
                include_reboot INTEGER DEFAULT 1,
                skip_evacuation INTEGER DEFAULT 0,
                skip_up_to_date INTEGER DEFAULT 1,
                evacuation_timeout INTEGER DEFAULT 1800,
                last_run TEXT,
                next_run TEXT,
                created_by TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """)

        # Metrics history table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS metrics_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                data TEXT NOT NULL
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics_history(timestamp DESC)
        """)

        # Custom Scripts table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS custom_scripts (
                id TEXT PRIMARY KEY,
                cluster_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                type TEXT DEFAULT 'bash',
                content TEXT NOT NULL,
                target_nodes TEXT DEFAULT 'all',
                enabled INTEGER DEFAULT 1,
                last_run TEXT,
                last_status TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_scripts_cluster ON custom_scripts(cluster_id)
        """)

        # Additional tables for full JSON migration
        # Migrated scattered JSON files into SQLite
        # took way longer than expected but now everything is in one place
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS cluster_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cluster_id TEXT NOT NULL,
                alert_type TEXT NOT NULL,
                config TEXT DEFAULT '{}',
                enabled INTEGER DEFAULT 1,
                created_at TEXT,
                updated_at TEXT,
                UNIQUE(cluster_id, alert_type)
            )
        """)

        # #501 Jun 2026 - persisted active (fired) alert instances for ack +
        # escalation tracking. The in-memory cooldown map only deduped sends; this
        # records each ongoing incident so the UI can acknowledge it and the loop
        # can escalate unacked ones. last_fired_at is refreshed on every fire → a
        # row that stops getting refreshed (~2x cooldown) is auto-resolved.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS active_alerts (
                id TEXT PRIMARY KEY,
                alert_key TEXT NOT NULL,
                alert_id TEXT,
                cluster_id TEXT,
                metric TEXT,
                target_type TEXT,
                target_id TEXT,
                target_name TEXT,
                severity TEXT DEFAULT 'warning',
                message TEXT,
                current_value REAL,
                threshold REAL,
                operator TEXT,
                triggered_at TEXT,
                last_fired_at TEXT,
                acked_at TEXT,
                acked_by TEXT,
                escalation_step INTEGER DEFAULT 0,
                last_escalated_at TEXT,
                resolved_at TEXT,
                resolved_by TEXT
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_active_alerts_unresolved ON active_alerts(resolved_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_active_alerts_key ON active_alerts(alert_key)")

        # ESXi integration was a pain, but people kept asking for it
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS esxi_storages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                host TEXT NOT NULL,
                username TEXT,
                password_encrypted TEXT,
                datastore TEXT,
                enabled INTEGER DEFAULT 1,
                last_sync TEXT,
                config TEXT DEFAULT '{}'
            )
        """)

        # Storage clusters for ceph/gluster/zfs pools shared across nodes
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS storage_clusters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cluster_id TEXT NOT NULL,
                name TEXT NOT NULL,
                storage_type TEXT DEFAULT 'ceph',
                nodes TEXT DEFAULT '[]',
                config TEXT DEFAULT '{}',
                enabled INTEGER DEFAULT 1,
                UNIQUE(cluster_id, name)
            )
        """)

        # Pool Permissions
        # Store permissions for Proxmox resource pools
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS pool_permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cluster_id TEXT NOT NULL,
                pool_id TEXT NOT NULL,
                subject_type TEXT NOT NULL,
                subject_id TEXT NOT NULL,
                permissions TEXT DEFAULT '[]',
                created_at TEXT,
                updated_at TEXT,
                UNIQUE(cluster_id, pool_id, subject_type, subject_id)
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_pool_perms_cluster ON pool_permissions(cluster_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_pool_perms_pool ON pool_permissions(cluster_id, pool_id)
        """)
        # Proxmox Backup Server connections
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS pbs_servers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER DEFAULT 8007,
                user TEXT NOT NULL,
                pass_encrypted TEXT DEFAULT '',
                api_token_id TEXT DEFAULT '',
                api_token_secret_encrypted TEXT DEFAULT '',
                fingerprint TEXT DEFAULT '',
                ssl_verify INTEGER DEFAULT 0,
                enabled INTEGER DEFAULT 1,
                linked_clusters TEXT DEFAULT '[]',
                notes TEXT DEFAULT '',
                created_at TEXT,
                updated_at TEXT
            )
        """)
        # VMware/vCenter integration
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS vmware_servers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER DEFAULT 443,
                username TEXT NOT NULL,
                pass_encrypted TEXT DEFAULT '',
                server_type TEXT DEFAULT 'vcenter',
                ssl_verify INTEGER DEFAULT 0,
                enabled INTEGER DEFAULT 1,
                linked_clusters TEXT DEFAULT '[]',
                notes TEXT DEFAULT '',
                created_at TEXT,
                updated_at TEXT
            )
        """)
        # API Tokens for programmatic access without sessions
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS api_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_hash TEXT NOT NULL UNIQUE,
                token_prefix TEXT NOT NULL,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
                role TEXT DEFAULT 'viewer',
                permissions TEXT DEFAULT '[]',
                expires_at TEXT,
                last_used_at TEXT,
                last_used_ip TEXT,
                created_at TEXT NOT NULL,
                revoked INTEGER DEFAULT 0
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(username)
        """)

        # WebAuthn / FIDO2 hardware token credentials
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS webauthn_credentials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                credential_id BLOB NOT NULL UNIQUE,
                public_key BLOB NOT NULL,
                sign_count INTEGER DEFAULT 0,
                transports TEXT DEFAULT '',
                aaguid TEXT DEFAULT '',
                name TEXT NOT NULL,
                user_handle BLOB NOT NULL,
                created_at TEXT NOT NULL,
                last_used_at TEXT,
                last_used_ip TEXT
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(username)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_webauthn_cred ON webauthn_credentials(credential_id)")

        # Schema migrations for existing databases
        # Add password_salt column if it doesn't exist (for databases created before this fix)
        try:
            cursor.execute("PRAGMA table_info(users)")
            columns = [col[1] for col in cursor.fetchall()]

            if "password_salt" not in columns:
                logging.info("Adding password_salt column to users table...")
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN password_salt TEXT DEFAULT ''")
                    logging.info("Added password_salt column to users table")

                    # Force re-migration of users to populate password_salt
                    logging.info("Will re-migrate users from legacy files...")
                    conn.commit()
                    self._force_remigrate_users = True
                except Exception as e:
                    logging.error(f"Failed to add password_salt column: {e}")

            # user prefs columns
            if "theme" not in columns:
                logging.info("Adding theme column to users table...")
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN theme TEXT DEFAULT ''")
                    logging.info("Added theme column to users table")
                except Exception as e:
                    logging.error(f"Failed to add theme column: {e}")

            if "language" not in columns:
                logging.info("Adding language column to users table...")
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN language TEXT DEFAULT ''")
                    logging.info("Added language column to users table")
                except Exception as e:
                    logging.error(f"Failed to add language column: {e}")

            if "ui_layout" not in columns:
                logging.info("Adding ui_layout column to users table...")
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN ui_layout TEXT DEFAULT 'modern'")
                    logging.info("Added ui_layout column to users table")
                except Exception as e:
                    logging.error(f"Failed to add ui_layout column: {e}")

            # Add enabled column if missing (user disable feature)
            if "enabled" not in columns:
                logging.info("Adding enabled column to users table...")
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN enabled INTEGER DEFAULT 1")
                    logging.info("Added enabled column to users table")
                except Exception as e:
                    logging.error(f"Failed to add enabled column: {e}")

            # Add totp_pending_secret_encrypted column for 2FA setup
            if "totp_pending_secret_encrypted" not in columns:
                logging.info("Adding totp_pending_secret_encrypted column to users table...")
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN totp_pending_secret_encrypted TEXT DEFAULT ''")
                    logging.info("Added totp_pending_secret_encrypted column to users table")
                except Exception as e:
                    logging.error(f"Failed to add totp_pending_secret_encrypted column: {e}")

            # Add taskbar_auto_expand column for user preferences
            if "taskbar_auto_expand" not in columns:
                logging.info("Adding taskbar_auto_expand column to users table...")
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN taskbar_auto_expand INTEGER DEFAULT 1")
                    logging.info("Added taskbar_auto_expand column to users table")
                except Exception as e:
                    logging.error(f"Failed to add taskbar_auto_expand column: {e}")

            # LDAP auth fields
            if "auth_source" not in columns:
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN auth_source TEXT DEFAULT 'local'")
                    logging.info("Added auth_source column to users table")
                except Exception as e:
                    logging.error(f"Failed to add auth_source column: {e}")

            if "display_name" not in columns:
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT ''")
                    logging.info("Added display_name column to users table")
                except Exception as e:
                    logging.error(f"Failed to add display_name column: {e}")

            if "email" not in columns:
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''")
                    logging.info("Added email column to users table")
                except Exception as e:
                    logging.error(f"Failed to add email column: {e}")

            if "avatar_mime" not in columns:
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN avatar_mime TEXT DEFAULT ''")
                    logging.info("Added avatar_mime column to users table")
                except Exception as e:
                    logging.error(f"Failed to add avatar_mime column: {e}")

            if "avatar_data" not in columns:
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN avatar_data TEXT DEFAULT ''")
                    logging.info("Added avatar_data column to users table")
                except Exception as e:
                    logging.error(f"Failed to add avatar_data column: {e}")

            if "ldap_dn" not in columns:
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN ldap_dn TEXT DEFAULT ''")
                    logging.info("Added ldap_dn column to users table")
                except Exception as e:
                    logging.error(f"Failed to add ldap_dn column: {e}")

            if "last_ldap_sync" not in columns:
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN last_ldap_sync TEXT DEFAULT ''")
                    logging.info("Added last_ldap_sync column to users table")
                except Exception as e:
                    logging.error(f"Failed to add last_ldap_sync column: {e}")

            # OIDC and tenant permission fields
            if "tenant_permissions" not in columns:
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN tenant_permissions TEXT DEFAULT '{}'")
                    logging.info("Added tenant_permissions column to users table")
                except Exception as e:
                    logging.error(f"Failed to add tenant_permissions column: {e}")

            if "denied_permissions" not in columns:
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN denied_permissions TEXT DEFAULT '[]'")
                    logging.info("Added denied_permissions column to users table")
                except Exception as e:
                    logging.error(f"Failed to add denied_permissions column: {e}")

            if "oidc_sub" not in columns:
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN oidc_sub TEXT DEFAULT ''")
                    logging.info("Added oidc_sub column to users table")
                except Exception as e:
                    logging.error(f"Failed to add oidc_sub column: {e}")

            if "last_oidc_sync" not in columns:
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN last_oidc_sync TEXT DEFAULT ''")
                    logging.info("Added last_oidc_sync column to users table")
                except Exception as e:
                    logging.error(f"Failed to add last_oidc_sync column: {e}")

            if "layout_chosen" not in columns:
                try:
                    cursor.execute("ALTER TABLE users ADD COLUMN layout_chosen INTEGER DEFAULT 0")
                    logging.info("Added layout_chosen column to users table")
                except Exception as e:
                    logging.error(f"Failed to add layout_chosen column: {e}")

        except Exception as e:
            logging.error(f"Error checking users schema: {e}")

        # Schema migration for clusters table - add group_id
        try:
            cursor.execute("PRAGMA table_info(clusters)")
            cluster_columns = [col[1] for col in cursor.fetchall()]

            if "group_id" not in cluster_columns:
                logging.info("Adding group_id column to clusters table...")
                try:
                    cursor.execute("ALTER TABLE clusters ADD COLUMN group_id TEXT DEFAULT NULL")
                    logging.info("Added group_id column to clusters table")
                except Exception as e:
                    logging.error(f"Failed to add group_id column: {e}")

            if "display_name" not in cluster_columns:
                logging.info("Adding display_name column to clusters table...")
                try:
                    cursor.execute("ALTER TABLE clusters ADD COLUMN display_name TEXT DEFAULT ''")
                    logging.info("Added display_name column to clusters table for custom naming")
                except Exception as e:
                    logging.error(f"Failed to add display_name column: {e}")

            # Add sort_order for consistent cluster ordering in sidebar
            if "sort_order" not in cluster_columns:
                logging.info("Adding sort_order column to clusters table...")
                try:
                    cursor.execute("ALTER TABLE clusters ADD COLUMN sort_order INTEGER DEFAULT 0")
                    logging.info("Added sort_order column to clusters table")
                except Exception as e:
                    logging.error(f"Failed to add sort_order column: {e}")

            # Add excluded_nodes for node exclusion from balancing (like ProxLB)
            if "excluded_nodes" not in cluster_columns:
                logging.info("Adding excluded_nodes column to clusters table...")
                try:
                    cursor.execute("ALTER TABLE clusters ADD COLUMN excluded_nodes TEXT DEFAULT '[]'")
                    logging.info("Added excluded_nodes column to clusters table")
                except Exception as e:
                    logging.error(f"Failed to add excluded_nodes column: {e}")

            # (#426) - opt-in gate for driving placement/affinity from
            # ProxLB-convention VM tags (plb_affinity_*, plb_anti_affinity_*,
            # plb_ignore_*, plb_pin_*). Off by default = zero behaviour change.
            if "proxlb_tags_enabled" not in cluster_columns:
                logging.info("Adding proxlb_tags_enabled column to clusters table...")
                try:
                    cursor.execute("ALTER TABLE clusters ADD COLUMN proxlb_tags_enabled INTEGER DEFAULT 0")
                    logging.info("Added proxlb_tags_enabled column to clusters table")
                except Exception as e:
                    logging.error(f"Failed to add proxlb_tags_enabled column: {e}")

            # Feb 2026: Add smbios_autoconfig for per-cluster SMBIOS settings
            if "smbios_autoconfig" not in cluster_columns:
                logging.info("Adding smbios_autoconfig column to clusters table...")
                try:
                    cursor.execute("ALTER TABLE clusters ADD COLUMN smbios_autoconfig TEXT DEFAULT '{}'")
                    logging.info("Added smbios_autoconfig column to clusters table")
                except Exception as e:
                    logging.error(f"Failed to add smbios_autoconfig column: {e}")

            # Mar 2026: API token fields for 2FA-safe REST auth
            if "api_token_user" not in cluster_columns:
                try:
                    cursor.execute("ALTER TABLE clusters ADD COLUMN api_token_user TEXT DEFAULT ''")
                    cursor.execute("ALTER TABLE clusters ADD COLUMN api_token_secret_encrypted TEXT DEFAULT ''")
                    logging.info("Added api_token columns to clusters table")
                except Exception as e:
                    logging.error(f"Failed to add api_token columns: {e}")

            # Mar 2026: cluster_type
            if "cluster_type" not in cluster_columns:
                try:
                    cursor.execute("ALTER TABLE clusters ADD COLUMN cluster_type TEXT DEFAULT 'proxmox'")
                    logging.info("Added cluster_type column to clusters table")
                except Exception as e:
                    logging.error(f"Failed to add cluster_type column: {e}")

            if "migration_tolerance" not in cluster_columns:
                with contextlib.suppress(Exception):
                    cursor.execute("ALTER TABLE clusters ADD COLUMN migration_tolerance INTEGER DEFAULT 10")

            # (#364) - these load-balancer settings were settable via
            # the API but never persisted to the DB, so they reverted to default
            # within seconds of a save. Adding the columns + including them in
            # save_cluster / get_all_clusters fixes the revert behaviour.
            for col_name, col_def in [
                ("predictive_balancing", "INTEGER DEFAULT 0"),
                ("predictive_threshold", "REAL DEFAULT 0.0"),
                ("balance_cpu_weight", "REAL DEFAULT 1.0"),
                ("balance_mem_weight", "REAL DEFAULT 1.0"),
                ("balance_io_weight", "REAL DEFAULT 1.0"),
                ("cpu_baseline", "TEXT DEFAULT ''"),
                ("vnc_tunnel", "INTEGER DEFAULT 0"),
                ("backup_sla_max_age_hours", "INTEGER DEFAULT 0"),
                # Proxmox API port override (default 8006). Direct
                # TLS only — we don't support reverse-proxied PVE by design.
                ("api_port", "INTEGER DEFAULT 8006"),
                # Worldmap location (per-cluster). NULL lat/lon
                # means "not configured" → cluster won't be plotted on the map.
                # location_label is a human-readable hint ("Frankfurt DC1").
                ("latitude", "REAL DEFAULT NULL"),
                ("longitude", "REAL DEFAULT NULL"),
                ("location_label", "TEXT DEFAULT ''"),
            ]:
                if col_name not in cluster_columns:
                    try:
                        cursor.execute(f"ALTER TABLE clusters ADD COLUMN {col_name} {col_def}")  # nosec: B608 - column names/definitions from internal hardcoded migration allowlist
                        logging.info(f"Added {col_name} column to clusters table")
                    except Exception as e:
                        logging.error(f"Failed to add {col_name} column: {e}")

        except Exception as e:
            logging.error(f"Error checking clusters schema: {e}")

        # Apr 2026: SSH creds for PBS - needed for running apt-get upgrade on PBS host
        try:
            cursor.execute("PRAGMA table_info(pbs_servers)")
            pbs_cols = [c[1] for c in cursor.fetchall()]
            for col_name, col_def in [
                ("ssh_user", "TEXT DEFAULT ''"),
                ("ssh_port", "INTEGER DEFAULT 22"),
                ("ssh_key_encrypted", "TEXT DEFAULT ''"),
            ]:
                if col_name not in pbs_cols:
                    try:
                        cursor.execute(f"ALTER TABLE pbs_servers ADD COLUMN {col_name} {col_def}")  # nosec: B608 - column names/definitions from internal hardcoded migration allowlist
                        logging.info(f"Added {col_name} column to pbs_servers")
                    except Exception as e:
                        logging.debug(f"Could not add {col_name}: {e}")
        except Exception as e:
            logging.debug(f"PBS schema migration skipped: {e}")

        try:
            cursor.execute("PRAGMA table_info(audit_log)")
            audit_columns = [col[1] for col in cursor.fetchall()]

            if "hmac_signature" not in audit_columns:
                logging.info("Adding hmac_signature column to audit_log table for integrity verification...")
                try:
                    cursor.execute("ALTER TABLE audit_log ADD COLUMN hmac_signature TEXT DEFAULT ''")
                    logging.info("Added hmac_signature column to audit_log table")
                except Exception as e:
                    logging.error(f"Failed to add hmac_signature column: {e}")
        except Exception as e:
            logging.error(f"Error checking audit_log schema: {e}")

        # Enforce was never persisted, value got lost on every restart
        try:
            cursor.execute("PRAGMA table_info(affinity_rules)")
            affinity_columns = [col[1] for col in cursor.fetchall()]

            if "enforce" not in affinity_columns:
                logging.info("Adding enforce column to affinity_rules table...")
                try:
                    cursor.execute("ALTER TABLE affinity_rules ADD COLUMN enforce INTEGER DEFAULT 0")
                    logging.info("Added enforce column to affinity_rules table")
                except Exception as e:
                    logging.error(f"Failed to add enforce column: {e}")
        except Exception as e:
            logging.error(f"Error checking affinity_rules schema: {e}")

        # Migration - create balancing_excluded_vms table if not exists
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS balancing_excluded_vms (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cluster_id TEXT NOT NULL,
                    vmid INTEGER NOT NULL,
                    reason TEXT,
                    created_by TEXT,
                    created_at TEXT,
                    UNIQUE(cluster_id, vmid)
                )
            """)
            logging.info("Ensured balancing_excluded_vms table exists")
        except Exception as e:
            logging.error(f"Error creating balancing_excluded_vms table: {e}")

        # Pool exclusion from auto-balancing
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS balancing_excluded_pools (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cluster_id TEXT NOT NULL,
                    pool_name TEXT NOT NULL,
                    reason TEXT,
                    created_by TEXT,
                    created_at TEXT,
                    UNIQUE(cluster_id, pool_name)
                )
            """)
        except Exception as e:
            logging.error(f"Error creating balancing_excluded_pools table: {e}")

        # Migration - create update_schedules table if not exists
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS update_schedules (
                    cluster_id TEXT PRIMARY KEY,
                    enabled INTEGER DEFAULT 0,
                    schedule_type TEXT DEFAULT 'recurring',
                    day TEXT DEFAULT 'sunday',
                    time TEXT DEFAULT '03:00',
                    include_reboot INTEGER DEFAULT 1,
                    skip_evacuation INTEGER DEFAULT 0,
                    skip_up_to_date INTEGER DEFAULT 1,
                    evacuation_timeout INTEGER DEFAULT 1800,
                    last_run TEXT,
                    next_run TEXT,
                    created_by TEXT,
                    created_at TEXT,
                    updated_at TEXT
                )
            """)
            logging.info("Ensured update_schedules table exists")
        except Exception as e:
            logging.error(f"Error creating update_schedules table: {e}")

        # Cross-cluster LB settings for cluster groups
        # allows automatic VM migration between clusters in the same group
        try:
            cursor.execute("PRAGMA table_info(cluster_groups)")
            group_cols = [col[1] for col in cursor.fetchall()]

            if "cross_cluster_lb_enabled" not in group_cols:
                logging.info("Adding cross-cluster LB columns to cluster_groups...")
                for col_def in [
                    "cross_cluster_lb_enabled INTEGER DEFAULT 0",
                    "cross_cluster_threshold INTEGER DEFAULT 30",
                    "cross_cluster_interval INTEGER DEFAULT 600",
                    "cross_cluster_dry_run INTEGER DEFAULT 1",
                    "cross_cluster_target_storage TEXT DEFAULT ''",
                    "cross_cluster_target_bridge TEXT DEFAULT 'vmbr0'",
                    "cross_cluster_max_migrations INTEGER DEFAULT 1",
                    "cross_cluster_last_run TEXT DEFAULT ''",
                ]:
                    with contextlib.suppress(Exception):
                        cursor.execute(
                            f"ALTER TABLE cluster_groups ADD COLUMN {col_def}"
                        )  # column might already exist from partial migration
                logging.info("Added cross-cluster LB columns to cluster_groups")

            # Container balancing toggle for cross-cluster LB
            if "cross_cluster_include_containers" not in group_cols:
                with contextlib.suppress(Exception):
                    cursor.execute(
                        "ALTER TABLE cluster_groups ADD COLUMN cross_cluster_include_containers INTEGER DEFAULT 0"
                    )
                    logging.info("Added cross_cluster_include_containers column to cluster_groups")
        except Exception as e:
            logging.error(f"Error adding cross-cluster LB columns: {e}")

        # Cross-cluster replication jobs (snapshot-based DR)
        # native Proxmox replication only works within a cluster, this bridges clusters
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS cross_cluster_replications (
                    id TEXT PRIMARY KEY,
                    source_cluster TEXT NOT NULL,
                    target_cluster TEXT NOT NULL,
                    vmid INTEGER NOT NULL,
                    vm_type TEXT DEFAULT 'qemu',
                    schedule TEXT DEFAULT '0 */6 * * *',
                    retention INTEGER DEFAULT 3,
                    target_storage TEXT DEFAULT '',
                    target_bridge TEXT DEFAULT 'vmbr0',
                    target_node TEXT DEFAULT '',
                    enabled INTEGER DEFAULT 1,
                    last_run TEXT,
                    last_status TEXT DEFAULT '',
                    last_error TEXT DEFAULT '',
                    created_by TEXT DEFAULT '',
                    created_at TEXT,
                    updated_at TEXT
                )
            """)
            logging.info("Ensured cross_cluster_replications table exists")
        except Exception as e:
            logging.error(f"Error creating cross_cluster_replications table: {e}")

        # Add target_node col for same-cluster snapshot replication
        try:
            cols = [row[1] for row in cursor.execute("PRAGMA table_info(cross_cluster_replications)").fetchall()]
            if "target_node" not in cols:
                cursor.execute("ALTER TABLE cross_cluster_replications ADD COLUMN target_node TEXT DEFAULT ''")
                logging.info("Added target_node column to cross_cluster_replications")
            # (#552 @helppp) - let the operator pin the replica's VMID
            # (keeps src/replica IDs in sync) and optionally tear the replica VM down
            # when the job is removed, instead of orphaning a fresh VMID every recreate.
            if "target_vmid" not in cols:
                cursor.execute("ALTER TABLE cross_cluster_replications ADD COLUMN target_vmid INTEGER")
                logging.info("Added target_vmid column to cross_cluster_replications")
            if "delete_target" not in cols:
                cursor.execute("ALTER TABLE cross_cluster_replications ADD COLUMN delete_target INTEGER DEFAULT 0")
                logging.info("Added delete_target column to cross_cluster_replications")
        except Exception:
            pass

        # Space-efficient LVM COW snapshots managed by ProxmoxVEx
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS efficient_snapshots (
                    id TEXT PRIMARY KEY,
                    cluster_id TEXT NOT NULL,
                    node TEXT NOT NULL,
                    vmid INTEGER NOT NULL,
                    vm_type TEXT NOT NULL DEFAULT 'qemu',
                    snapname TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    vg_name TEXT NOT NULL,
                    disks TEXT NOT NULL DEFAULT '[]',
                    total_disk_size_gb REAL DEFAULT 0,
                    total_snap_alloc_gb REAL DEFAULT 0,
                    fs_frozen INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'active',
                    error_message TEXT DEFAULT '',
                    created_by TEXT DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT,
                    UNIQUE(cluster_id, vmid, snapname)
                )
            """)
            logging.info("Ensured efficient_snapshots table exists")
        except Exception as e:
            logging.error(f"Error creating efficient_snapshots table: {e}")

        # Site Recovery Plans
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_recovery_plans (
                    id TEXT PRIMARY KEY,
                    group_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    source_cluster TEXT NOT NULL,
                    target_cluster TEXT NOT NULL,
                    network_mappings TEXT DEFAULT '{}',
                    storage_mappings TEXT DEFAULT '{}',
                    auto_failover INTEGER DEFAULT 0,
                    failover_timeout INTEGER DEFAULT 120,
                    pre_failover_webhook TEXT DEFAULT '',
                    post_failover_webhook TEXT DEFAULT '',
                    test_disconnect_nics INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'ready',
                    last_test TEXT,
                    last_failover TEXT,
                    last_readiness_check TEXT,
                    created_by TEXT DEFAULT '',
                    created_at TEXT,
                    updated_at TEXT
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_recovery_vms (
                    id TEXT PRIMARY KEY,
                    plan_id TEXT NOT NULL,
                    vmid INTEGER NOT NULL,
                    vm_name TEXT DEFAULT '',
                    vm_type TEXT DEFAULT 'qemu',
                    boot_group INTEGER DEFAULT 0,
                    boot_delay INTEGER DEFAULT 30,
                    replication_job_id TEXT DEFAULT '',
                    target_vmid INTEGER,
                    notes TEXT DEFAULT ''
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS site_recovery_events (
                    id TEXT PRIMARY KEY,
                    plan_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'running',
                    started_at TEXT,
                    completed_at TEXT,
                    details TEXT DEFAULT '{}',
                    triggered_by TEXT DEFAULT ''
                )
            """)
            # indexes for common queries
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_sr_vms_plan ON site_recovery_vms(plan_id, vmid)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_sr_events_plan ON site_recovery_events(plan_id, started_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_sr_plans_status ON site_recovery_plans(status)")
            # (#413) - per-plan option: bring Test-Failover clones up with
            # NICs disconnected (link_down) so a DR test can't collide with production
            # IPs on the network. Migrate existing DBs that predate the column.
            try:
                sr_cols = [row[1] for row in cursor.execute("PRAGMA table_info(site_recovery_plans)").fetchall()]
                if "test_disconnect_nics" not in sr_cols:
                    cursor.execute("ALTER TABLE site_recovery_plans ADD COLUMN test_disconnect_nics INTEGER DEFAULT 0")
                    logging.info("Added test_disconnect_nics column to site_recovery_plans")
            except Exception as e:
                logging.error(f"Failed to add test_disconnect_nics column: {e}")
            logging.info("Ensured site_recovery tables exist")
        except Exception as e:
            logging.error(f"Error creating site_recovery tables: {e}")

        # cve history - Mar 2026
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS cve_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cluster_id TEXT NOT NULL,
                    node TEXT NOT NULL,
                    cve_id TEXT NOT NULL,
                    package TEXT,
                    severity TEXT,
                    first_seen TEXT NOT NULL,
                    last_seen TEXT NOT NULL,
                    resolved_at TEXT,
                    UNIQUE(cluster_id, node, cve_id)
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_cve_history_cluster_node ON cve_history(cluster_id, node)")
            logging.info("Ensured cve_history table exists")
        except Exception as e:
            logging.error(f"Error creating cve_history table: {e}")

        # Plugin state tracking
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS plugin_state (
                    plugin_id TEXT PRIMARY KEY,
                    enabled INTEGER DEFAULT 0,
                    loaded_at TEXT,
                    error TEXT DEFAULT ''
                )
            """)
            logging.info("Ensured plugin_state table exists")
        except Exception as e:
            logging.error(f"Error creating plugin_state table: {e}")

        # Backup verification results
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS backup_verifications (
                    id TEXT PRIMARY KEY,
                    cluster_id TEXT NOT NULL,
                    pbs_id TEXT,
                    vmid INTEGER NOT NULL,
                    vm_name TEXT DEFAULT '',
                    backup_time TEXT,
                    node TEXT,
                    test_vmid INTEGER,
                    started_at TEXT,
                    completed_at TEXT,
                    status TEXT DEFAULT 'running',
                    phase TEXT DEFAULT 'init',
                    restore_ok INTEGER DEFAULT 0,
                    boot_ok INTEGER DEFAULT 0,
                    agent_ok INTEGER DEFAULT 0,
                    cleanup_ok INTEGER DEFAULT 0,
                    duration_seconds REAL DEFAULT 0,
                    error TEXT DEFAULT '',
                    details TEXT DEFAULT '{}'
                )
            """)
            logging.info("Ensured backup_verifications table exists")
        except Exception as e:
            logging.error(f"Error creating backup_verifications table: {e}")

        # Portal_only column for client portal
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(users)").fetchall()]
            if "portal_only" not in cols:
                cursor.execute("ALTER TABLE users ADD COLUMN portal_only INTEGER DEFAULT 0")
                logging.info("Added portal_only column to users table")
        except Exception:
            pass
        # Opt-in "show VMIDs in the corporate sidebar" user preference
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(users)").fetchall()]
            if "sidebar_show_vmid" not in cols:
                cursor.execute("ALTER TABLE users ADD COLUMN sidebar_show_vmid INTEGER DEFAULT 0")
                logging.info("Added sidebar_show_vmid column to users table")
        except Exception:
            pass

        # Persistent taskbar visibility/expanded state (restored on login)
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(users)").fetchall()]
            if "taskbar_visible" not in cols:
                cursor.execute("ALTER TABLE users ADD COLUMN taskbar_visible INTEGER DEFAULT 1")
                logging.info("Added taskbar_visible column to users table")
            if "taskbar_expanded" not in cols:
                cursor.execute("ALTER TABLE users ADD COLUMN taskbar_expanded INTEGER DEFAULT 0")
                logging.info("Added taskbar_expanded column to users table")
        except Exception:
            pass

        # Status page incident tracking + uptime history
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS status_incidents (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    status TEXT DEFAULT 'investigating',
                    severity TEXT DEFAULT 'minor',
                    message TEXT DEFAULT '',
                    components TEXT DEFAULT '[]',
                    started_at TEXT NOT NULL,
                    resolved_at TEXT,
                    created_by TEXT DEFAULT 'system',
                    updated_at TEXT
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS status_uptime (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cluster_id TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    status TEXT NOT NULL,
                    nodes_online INTEGER DEFAULT 0,
                    nodes_total INTEGER DEFAULT 0
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_uptime_cluster ON status_uptime(cluster_id, timestamp DESC)")
            logging.info("Ensured status_incidents + status_uptime tables exist")
        except Exception as e:
            logging.error(f"Error creating status tables: {e}")

        # User folders for organizing users in the management UI
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS user_folders (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    color TEXT DEFAULT '#6b7280',
                    sort_order INTEGER DEFAULT 0,
                    created_at TEXT
                )
            """)
            logging.info("Ensured user_folders table exists")
        except Exception as e:
            logging.error(f"Error creating user_folders table: {e}")

        # add user_folder column to users if missing
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(users)").fetchall()]
            if "user_folder" not in cols:
                cursor.execute("ALTER TABLE users ADD COLUMN user_folder TEXT DEFAULT ''")
                logging.info("Added user_folder column to users table")
        except Exception:
            pass

        # Cloud-init template library deployments
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS cloud_init_deployments (
                    id TEXT PRIMARY KEY,
                    cluster_id TEXT NOT NULL,
                    node TEXT NOT NULL,
                    template_id TEXT NOT NULL,
                    template_name TEXT,
                    vmid INTEGER,
                    storage TEXT,
                    status TEXT NOT NULL DEFAULT 'queued',
                    progress INTEGER DEFAULT 0,
                    log TEXT DEFAULT '',
                    error TEXT DEFAULT '',
                    started_by TEXT DEFAULT '',
                    started_at TEXT,
                    finished_at TEXT
                )
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_ci_dep_cluster ON cloud_init_deployments(cluster_id, started_at DESC)"
            )
            logging.info("Ensured cloud_init_deployments table exists")
        except Exception as e:
            logging.error(f"Error creating cloud_init_deployments table: {e}")

        # User-defined cloud-init templates added on top of the
        # curated catalog in api/templates_lib.py
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS custom_cloud_templates (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    distro TEXT DEFAULT 'custom',
                    version TEXT DEFAULT '',
                    image_url TEXT NOT NULL,
                    default_user TEXT DEFAULT 'root',
                    cores INTEGER DEFAULT 2,
                    memory INTEGER DEFAULT 2048,
                    disk_gb INTEGER DEFAULT 10,
                    tags TEXT DEFAULT '',
                    created_by TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                )
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_custom_tpl_created ON custom_cloud_templates(created_at DESC)"
            )
            logging.info("Ensured custom_cloud_templates table exists")
        except Exception as e:
            logging.error(f"Error creating custom_cloud_templates table: {e}")

        # Extend audit_log with cluster + severity columns for richer filtering
        try:
            cols = [r[1] for r in cursor.execute("PRAGMA table_info(audit_log)").fetchall()]
            if "cluster" not in cols:
                cursor.execute("ALTER TABLE audit_log ADD COLUMN cluster TEXT DEFAULT ''")
                logging.info("Added cluster column to audit_log")
            if "severity" not in cols:
                cursor.execute("ALTER TABLE audit_log ADD COLUMN severity TEXT DEFAULT 'info'")
                logging.info("Added severity column to audit_log")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_cluster ON audit_log(cluster)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_log(severity)")
            # Composite index for the plugin's most common date-range + cluster filter path.
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_timestamp_cluster ON audit_log(timestamp, cluster)")
        except Exception as e:
            logging.error(f"Error extending audit_log schema: {e}")

        # SIEM forwarder targets
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS siem_targets (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    endpoint TEXT NOT NULL,
                    format TEXT DEFAULT 'json',
                    enabled INTEGER DEFAULT 1,
                    settings TEXT DEFAULT '{}',
                    last_status TEXT DEFAULT '',
                    last_ok_at TEXT,
                    last_error_at TEXT,
                    last_error TEXT DEFAULT '',
                    sent_count INTEGER DEFAULT 0,
                    error_count INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    created_by TEXT DEFAULT ''
                )
            """)
            logging.info("Ensured siem_targets table exists")
        except Exception as e:
            logging.error(f"Error creating siem_targets table: {e}")

        # Disaster Recovery: structured dry-run of a Site Recovery plan,
        # produces compliance-ready evidence.
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS disaster_recovery_drills (
                    id TEXT PRIMARY KEY,
                    plan_id TEXT NOT NULL,
                    plan_name TEXT DEFAULT '',
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    status TEXT NOT NULL DEFAULT 'running',
                    summary TEXT DEFAULT '',
                    started_by TEXT DEFAULT '',
                    pass_count INTEGER DEFAULT 0,
                    warn_count INTEGER DEFAULT 0,
                    fail_count INTEGER DEFAULT 0,
                    rpo_breach_seconds INTEGER DEFAULT 0,
                    estimated_rto_seconds INTEGER DEFAULT 0
                )
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_disaster_recovery_drills_plan ON disaster_recovery_drills(plan_id, started_at DESC)"
            )
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS disaster_recovery_drill_checks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    drill_id TEXT NOT NULL,
                    category TEXT NOT NULL,
                    name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    message TEXT DEFAULT '',
                    detail TEXT DEFAULT '',
                    duration_ms INTEGER DEFAULT 0,
                    sequence INTEGER DEFAULT 0
                )
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_disaster_recovery_drill_checks_drill ON disaster_recovery_drill_checks(drill_id, sequence)"
            )
            logging.info("Ensured disaster_recovery_drills + disaster_recovery_drill_checks tables exist")
        except Exception as e:
            logging.error(f"Error creating disaster_recovery_drills tables: {e}")

        # Snapshot scheduling policies
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS snapshot_policies (
                    id TEXT PRIMARY KEY,
                    cluster_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    target_type TEXT NOT NULL DEFAULT 'tag',
                    target_value TEXT NOT NULL,
                    schedule TEXT NOT NULL DEFAULT 'daily',
                    schedule_at TEXT DEFAULT '03:00',
                    retention_count INTEGER DEFAULT 7,
                    retention_days INTEGER DEFAULT 0,
                    include_ram INTEGER DEFAULT 0,
                    enabled INTEGER DEFAULT 1,
                    last_run_at TEXT,
                    last_run_status TEXT DEFAULT '',
                    notes TEXT DEFAULT '',
                    created_by TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_snap_pol_cluster ON snapshot_policies(cluster_id)")
            # #586 - richer schedules (cron / monthly / once) + prune-only mode.
            # additive on existing installs, hence the PRAGMA guard.
            cursor.execute("PRAGMA table_info(snapshot_policies)")
            _spcols = {row[1] for row in cursor.fetchall()}
            for _cn, _cd in (
                ("schedule_cron", "TEXT DEFAULT ''"),
                ("schedule_day", "INTEGER DEFAULT 1"),
                ("run_once_at", "TEXT DEFAULT ''"),
                ("prune_only", "INTEGER DEFAULT 0"),
            ):
                if _cn not in _spcols:
                    cursor.execute(f"ALTER TABLE snapshot_policies ADD COLUMN {_cn} {_cd}")  # nosec: B608 - column names/definitions from internal hardcoded migration allowlist
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS snapshot_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    policy_id TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    status TEXT NOT NULL DEFAULT 'running',
                    summary TEXT DEFAULT '',
                    log TEXT DEFAULT '',
                    snapshots_created INTEGER DEFAULT 0,
                    snapshots_failed INTEGER DEFAULT 0,
                    snapshots_pruned INTEGER DEFAULT 0
                )
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_snap_runs_policy ON snapshot_runs(policy_id, started_at DESC)"
            )
            logging.info("Ensured snapshot_policies + snapshot_runs tables exist")
        except Exception as e:
            logging.error(f"Error creating snapshot_policies tables: {e}")

        # Power & Carbon tracking rates
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS power_rates (
                    cluster_id TEXT PRIMARY KEY,
                    node_idle_w REAL DEFAULT 80,
                    node_max_w REAL DEFAULT 300,
                    mem_w_per_gb REAL DEFAULT 0.3,
                    pue REAL DEFAULT 1.5,
                    kwh_price REAL DEFAULT 0.30,
                    kg_co2_per_kwh REAL DEFAULT 0.4,
                    currency TEXT DEFAULT 'EUR',
                    notes TEXT DEFAULT '',
                    updated_at TEXT,
                    updated_by TEXT DEFAULT ''
                )
            """)
            cursor.execute(
                """
                INSERT OR IGNORE INTO power_rates (cluster_id, updated_at) VALUES ('__default__', ?)
            """,
                (datetime.now().isoformat(),),
            )
            logging.info("Ensured power_rates table exists")
        except Exception as e:
            logging.error(f"Error creating power_rates table: {e}")

        # Cost dashboard rates (global default + optional per-cluster overrides)
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS cost_rates (
                    cluster_id TEXT PRIMARY KEY,
                    cpu_per_core_h REAL DEFAULT 0.012,
                    mem_per_gb_h REAL DEFAULT 0.0035,
                    storage_per_gb_month REAL DEFAULT 0.10,
                    currency TEXT DEFAULT 'EUR',
                    notes TEXT DEFAULT '',
                    updated_at TEXT,
                    updated_by TEXT DEFAULT ''
                )
            """)
            # ensure a global default row exists (cluster_id = '__default__')
            cursor.execute(
                """
                INSERT OR IGNORE INTO cost_rates (cluster_id, updated_at) VALUES ('__default__', ?)
            """,
                (datetime.now().isoformat(),),
            )
            logging.info("Ensured cost_rates table exists")
        except Exception as e:
            logging.error(f"Error creating cost_rates table: {e}")

        # Config drift detection: store baselines + change events
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS drift_baselines (
                    id TEXT PRIMARY KEY,
                    cluster_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    snapshot TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    created_by TEXT DEFAULT ''
                )
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_drift_baseline_lookup ON drift_baselines(cluster_id, kind, scope)"
            )
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS drift_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cluster_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    severity TEXT DEFAULT 'info',
                    summary TEXT DEFAULT '',
                    diff TEXT NOT NULL,
                    detected_at TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'open',
                    acknowledged_at TEXT,
                    acknowledged_by TEXT DEFAULT ''
                )
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_drift_events_cluster ON drift_events(cluster_id, detected_at DESC)"
            )
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_drift_events_status ON drift_events(status, cluster_id)")
            logging.info("Ensured drift_baselines + drift_events tables exist")
        except Exception as e:
            logging.error(f"Error creating drift tables: {e}")

        # Web Push subscriptions for browser notifications
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS push_subscriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    endpoint TEXT NOT NULL UNIQUE,
                    p256dh TEXT NOT NULL,
                    auth TEXT NOT NULL,
                    user_agent TEXT DEFAULT '',
                    created_at TEXT NOT NULL,
                    last_used_at TEXT,
                    failures INTEGER DEFAULT 0
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(username)")
            logging.info("Ensured push_subscriptions table exists")
        except Exception as e:
            logging.error(f"Error creating push_subscriptions table: {e}")

        conn.commit()
        logging.info("DB schema initialized")

    def _ensure_converter_tables(self):
        """Ensure converter module tables exist (idempotent)."""
        from ProxmoxVEx.converter.db import ensure_converter_tables

        try:
            ensure_converter_tables(self.conn)
            self.conn.commit()
        except Exception as e:
            logging.error(f"Failed to ensure converter tables: {e}")

    def _ensure_ids_tables(self):
        """Ensure IDS/IPS module tables exist (idempotent)."""
        from ProxmoxVEx.ids.db import ensure_ids_tables

        try:
            ensure_ids_tables(self.conn)
            self.conn.commit()
        except Exception as e:
            logging.error(f"Failed to ensure IDS tables: {e}")

    def _ensure_license_context_table(self):
        """Ensure license context table exists (idempotent)."""
        from ProxmoxVEx.models.license_context import ensure_license_context_table

        try:
            ensure_license_context_table(self.conn)
            self.conn.commit()
        except Exception as e:
            logging.error(f"Failed to ensure license context table: {e}")

    def _ensure_tier_plugins_table(self):
        """Ensure tier plugin allow-list table exists (idempotent)."""
        from ProxmoxVEx.models.tier_plugins import ensure_tier_plugins_table

        try:
            ensure_tier_plugins_table(self.conn)
            self.conn.commit()
        except Exception as e:
            logging.error(f"Failed to ensure tier plugins table: {e}")

    def _ensure_server_access_tables(self):
        """Ensure server access group tables exist (idempotent)."""
        from ProxmoxVEx.models.server_access import ensure_server_access_tables

        try:
            ensure_server_access_tables(self.conn)
            self.conn.commit()
        except Exception as e:
            logging.error(f"Failed to ensure server access tables: {e}")

    def _encrypt(self, data: str) -> str:
        """encrypt sensitive stuff"""
        if not data:
            return data

        # try aes256 first (new way)
        if self.aesgcm:
            try:
                nonce = os.urandom(12)
                ciphertext = self.aesgcm.encrypt(nonce, data.encode("utf-8"), None)
                encrypted = base64.b64encode(nonce + ciphertext).decode("utf-8")
                return f"aes256:{encrypted}"
            except Exception as e:
                logging.error(f"aes encrypt failed: {e}")

        # fallback to old fernet
        if self.fernet:
            try:
                return self.fernet.encrypt(data.encode()).decode()
            except Exception as e:
                logging.error(f"fernet failed: {e}")

        # Never store plaintext, fail safely
        raise RuntimeError(
            "No encryption backend available (neither AES-256-GCM nor Fernet). Cannot store sensitive data."
        )

    def _decrypt(self, data: str) -> str:
        """decrypt - handles both old and new format, including legacy keys"""
        # Handles aes256 and old fernet
        if not data:
            return data

        # Check for AES-256-GCM format
        if data.startswith("aes256:"):
            if not self.aesgcm:
                # Don't return ciphertext as if it were plaintext
                raise RuntimeError("AES-256-GCM data found but encryption not initialized")
            try:
                encrypted = base64.b64decode(data[7:])  # Remove "aes256:" prefix
            except Exception as e:
                raise RuntimeError(f"AES-256-GCM decode failed: {e}") from None

            nonce = encrypted[:12]  # First 12 bytes are nonce
            ciphertext = encrypted[12:]  # Rest is ciphertext + tag

            # Try the primary key first, then any fallback keys (e.g. legacy
            # cased key files from earlier builds) so rows encrypted before a
            # key rotation or filename change can still be recovered.
            last_exc = None
            for aes in [self.aesgcm, *getattr(self, "_aesgcm_fallbacks", [])]:
                try:
                    plaintext = aes.decrypt(nonce, ciphertext, None)
                    return plaintext.decode("utf-8")
                except Exception as e:
                    last_exc = e
                    continue

            # Returning garbled aes256: data would be used as a password/secret downstream
            raise RuntimeError(f"AES-256-GCM decryption failed: {last_exc}") from None

        # Try Fernet (legacy)
        if self.fernet:
            try:
                # Fernet tokens start with 'gAAA' when base64 encoded
                return self.fernet.decrypt(data.encode()).decode()
            except Exception as e:
                # Not a valid Fernet token - probably pre-encryption plaintext
                logging.warning(f"Fernet decryption failed (treating as plaintext): {e}")
                return data

        # Return as-is (probably plain text)
        return data

    def _needs_reencrypt(self, data: str) -> bool:
        """Check if data needs to be re-encrypted with the canonical AES key.

        Returns True for legacy Fernet data, or for AES-256-GCM data that the
        primary key cannot decrypt but a fallback key can (so it gets migrated
        to the canonical key on the next write).
        """
        if not data or not self.aesgcm:
            return False
        # If it's not AES-256-GCM, it needs re-encryption
        if not data.startswith("aes256:"):
            return True

        try:
            encrypted = base64.b64decode(data[7:])
            nonce = encrypted[:12]
            ciphertext = encrypted[12:]
            self.aesgcm.decrypt(nonce, ciphertext, None)
            return False
        except Exception:
            pass

        # Primary key couldn't decrypt it - if a fallback can, migrate it.
        try:
            encrypted = base64.b64decode(data[7:])
            nonce = encrypted[:12]
            ciphertext = encrypted[12:]
            for aes in getattr(self, "_aesgcm_fallbacks", []):
                try:
                    aes.decrypt(nonce, ciphertext, None)
                    return True
                except Exception:
                    continue
        except Exception:
            pass

        # Not decryptable by any key we have; don't attempt destructive migration.
        return False

    def _archive_legacy_files(self):
        """Move successfully-migrated legacy JSON and encrypted files to a
        dated archive directory so they are no longer consulted but remain
        recoverable."""
        legacy_dir = os.path.join(CONFIG_DIR, "legacy", datetime.now().strftime("%Y%m%d%H%M%S"))
        legacy_files = [
            CONFIG_FILE,
            CONFIG_FILE_ENCRYPTED,
            USERS_FILE_ENCRYPTED,
            AUDIT_LOG_FILE,
            AUDIT_LOG_FILE_ENCRYPTED,
            SESSIONS_FILE,
            SESSIONS_FILE_ENCRYPTED,
            SERVER_SETTINGS_FILE,
            ALERTS_CONFIG_FILE,
            SCHEDULED_TASKS_FILE,
            VM_TAGS_FILE,
            MIGRATION_HISTORY_FILE,
            AFFINITY_RULES_FILE,
            CUSTOM_ROLES_FILE,
            ESXI_CONFIG_FILE,
            STORAGE_CLUSTERS_FILE,
        ]
        archived = 0
        try:
            os.makedirs(legacy_dir, mode=0o700, exist_ok=True)
        except Exception as e:
            logging.warning(f"Could not create legacy archive dir {legacy_dir}: {e}")
            return

        for src in legacy_files:
            if os.path.exists(src):
                try:
                    dst = os.path.join(legacy_dir, os.path.basename(src))
                    shutil.move(src, dst)
                    archived += 1
                    logging.info(f"Archived legacy file {src} -> {dst}")
                except Exception as e:
                    logging.warning(f"Could not archive legacy file {src}: {e}")

        if archived:
            logging.info(f"Archived {archived} legacy file(s) to {legacy_dir}")

    def _migrate_from_legacy(self):
        """Migrate data from legacy JSON/encrypted files to SQLite"""

        # Check if already migrated
        cursor = self.conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM clusters")
        cluster_count = cursor.fetchone()[0]

        # Check if users have proper password_salt (fix for schema migration)
        needs_user_remigration = getattr(self, "_force_remigrate_users", False)

        if not needs_user_remigration:
            try:
                # #224: only check local users — OIDC/LDAP users have no salt by design
                cursor.execute(
                    "SELECT username, password_salt FROM users WHERE auth_source = 'local' OR auth_source IS NULL LIMIT 1"
                )
                row = cursor.fetchone()
                if row:
                    salt = row[1] if len(row) > 1 else None
                    if not salt or salt == "":  # password_salt is empty or missing
                        logging.warning("Users have empty password_salt - will re-migrate from legacy files")
                        needs_user_remigration = True
            except dbcrypto.OperationalError as e:
                # Column might not exist
                logging.warning(f"Could not check password_salt: {e} - will re-migrate")
                needs_user_remigration = True
            except Exception as e:
                logging.error(f"Error checking users: {e}")

        if cluster_count > 0 and not needs_user_remigration:
            logging.info("Database already has data, skipping legacy migration")
            return

        # Migrate clusters (only if no clusters exist)
        if cluster_count == 0 and self._migrate_clusters():
            pass

        # Migrate users (always if needs_user_remigration or no users)
        if needs_user_remigration or cluster_count == 0:
            # Clear existing users if re-migrating
            if needs_user_remigration:
                try:
                    cursor.execute("DELETE FROM users")
                    self.conn.commit()
                    logging.info("Cleared users table for re-migration")
                except Exception as e:
                    logging.error(f"Error clearing users: {e}")

            if self._migrate_users():
                pass

        # Migrate sessions
        if self._migrate_sessions():
            pass

        # Migrate audit log
        if self._migrate_audit_log():
            pass

        # Migrate alerts
        if self._migrate_alerts():
            pass

        # Migrate VM ACLs
        if self._migrate_vm_acls():
            pass

        # Migrate affinity rules
        if self._migrate_affinity_rules():
            pass

        # Migrate tenants
        if self._migrate_tenants():
            pass

        # Migrate scheduled tasks
        if self._migrate_scheduled_tasks():
            pass

        # Migrate VM tags
        if self._migrate_vm_tags():
            pass

        # Migrate migration history
        if self._migrate_migration_history():
            pass

        # Migrate server settings
        if self._migrate_server_settings():
            pass

        # Migrate custom roles
        if self._migrate_custom_roles():
            pass

        # Migrate remaining JSON files - these were scattered everywhere
        # Should have done this from the start but
        if self._migrate_cluster_alerts():
            pass

        if self._migrate_esxi_storages():
            pass

        if self._migrate_storage_clusters():
            pass

        if self._migrate_cluster_affinity_rules():
            self._archive_legacy_files()
            logging.info("✓ Legacy data migration completed!")
            self.conn.commit()

    def _migrate_clusters(self) -> bool:
        """Migrate clusters from encrypted JSON"""
        from ProxmoxVEx.core.config import get_fernet

        fernet = get_fernet()
        data = None

        # Try encrypted file first
        if fernet and os.path.exists(CONFIG_FILE_ENCRYPTED):
            try:
                with open(CONFIG_FILE_ENCRYPTED, "rb") as f:
                    encrypted_data = f.read()
                decrypted = fernet.decrypt(encrypted_data)
                data = json.loads(decrypted.decode("utf-8"))
            except Exception as e:
                logging.error(f"Failed to load encrypted clusters: {e}")

        # Try unencrypted
        if not data and os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE) as f:
                    data = json.load(f)
            except Exception as e:
                logging.error(f"Failed to load clusters.json: {e}")

        if not data:
            return False

        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        for cluster_id, cluster in data.items():
            try:
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO clusters
                    (id, name, host, user, pass_encrypted, ssl_verification,
                     migration_threshold, check_interval, auto_migrate,
                     balance_containers, balance_local_disks, dry_run, enabled,
                     ha_enabled, fallback_hosts, ssh_user, ssh_key_encrypted,
                     ssh_port, ha_settings, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        cluster_id,
                        cluster.get("name", ""),
                        cluster.get("host", ""),
                        cluster.get("user", ""),
                        self._encrypt(cluster.get("pass", "")),
                        1 if cluster.get("ssl_verification", True) else 0,
                        cluster.get("migration_threshold", 30),
                        cluster.get("check_interval", 300),
                        1 if cluster.get("auto_migrate", False) else 0,
                        1 if cluster.get("balance_containers", False) else 0,
                        1 if cluster.get("balance_local_disks", False) else 0,
                        1 if cluster.get("dry_run", True) else 0,
                        1 if cluster.get("enabled", True) else 0,
                        1 if cluster.get("ha_enabled", False) else 0,
                        json.dumps(cluster.get("fallback_hosts", [])),
                        cluster.get("ssh_user", ""),
                        self._encrypt(cluster.get("ssh_key", "")),
                        cluster.get("ssh_port", 22),
                        json.dumps(cluster.get("ha_settings", {})),
                        now,
                        now,
                    ),
                )
            except Exception as e:
                logging.error(f"Failed to migrate cluster {cluster_id}: {e}")

        logging.info(f"Migrated {len(data)} clusters to SQLite")
        return True

    def _migrate_users(self) -> bool:
        """Migrate users from encrypted file"""
        from ProxmoxVEx.core.config import get_fernet

        fernet = get_fernet()
        if not fernet or not os.path.exists(USERS_FILE_ENCRYPTED):
            return False

        try:
            with open(USERS_FILE_ENCRYPTED, "rb") as f:
                encrypted_data = f.read()
            decrypted = fernet.decrypt(encrypted_data)
            data = json.loads(decrypted.decode("utf-8"))
        except Exception as e:
            logging.error(f"Failed to load users: {e}")
            return False

        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        for username, user in data.items():
            try:
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO users
                    (username, password_salt, password_hash, role, permissions, tenant,
                     created_at, last_login, password_expiry,
                     totp_secret_encrypted, totp_enabled, force_password_change)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        username,
                        user.get("password_salt", ""),
                        user.get("password_hash", user.get("password", "")),
                        user.get("role", "viewer"),
                        json.dumps(user.get("permissions", [])),
                        user.get("tenant"),
                        user.get("created_at", now),
                        user.get("last_login"),
                        user.get("password_expiry"),
                        self._encrypt(user.get("totp_secret", "")),
                        1 if user.get("totp_enabled", False) else 0,
                        1 if user.get("force_password_change", False) else 0,
                    ),
                )
            except Exception as e:
                logging.error(f"Failed to migrate user {username}: {e}")

        logging.info(f"Migrated {len(data)} users to SQLite")
        return True

    def _migrate_sessions(self) -> bool:
        """Migrate sessions from encrypted file"""
        from ProxmoxVEx.core.config import get_fernet

        fernet = get_fernet()
        data = None

        if fernet and os.path.exists(SESSIONS_FILE_ENCRYPTED):
            try:
                with open(SESSIONS_FILE_ENCRYPTED, "rb") as f:
                    encrypted_data = f.read()
                decrypted = fernet.decrypt(encrypted_data)
                data = json.loads(decrypted.decode("utf-8"))
            except Exception:
                pass

        if not data and os.path.exists(SESSIONS_FILE):
            try:
                with open(SESSIONS_FILE) as f:
                    data = json.load(f)
            except Exception:
                pass

        if not data:
            return False

        cursor = self.conn.cursor()

        for token, session in data.items():
            with contextlib.suppress(Exception):
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO sessions
                    (token, username, created_at, expires_at, ip_address, user_agent)
                    VALUES (?, ?, ?, ?, ?, ?)
                """,
                    (
                        token,
                        session.get("user", ""),
                        session.get("created", ""),
                        session.get("expires", ""),
                        session.get("ip", ""),
                        session.get("user_agent", ""),
                    ),
                )

        logging.info(f"Migrated {len(data)} sessions to SQLite")
        return True

    def _migrate_audit_log(self) -> bool:
        """Migrate audit log from encrypted file"""
        from ProxmoxVEx.core.config import get_fernet

        fernet = get_fernet()
        data = None

        if fernet and os.path.exists(AUDIT_LOG_FILE_ENCRYPTED):
            try:
                with open(AUDIT_LOG_FILE_ENCRYPTED, "rb") as f:
                    encrypted_data = f.read()
                decrypted = fernet.decrypt(encrypted_data)
                data = json.loads(decrypted.decode("utf-8"))
            except Exception:
                pass

        if not data and os.path.exists(AUDIT_LOG_FILE):
            try:
                with open(AUDIT_LOG_FILE) as f:
                    data = json.load(f)
            except Exception:
                pass

        if not data:
            return False

        cursor = self.conn.cursor()

        for entry in data:
            with contextlib.suppress(Exception):
                cursor.execute(
                    """
                    INSERT INTO audit_log (timestamp, user, action, details, ip_address)
                    VALUES (?, ?, ?, ?, ?)
                """,
                    (
                        entry.get("timestamp", ""),
                        entry.get("user", ""),
                        entry.get("action", ""),
                        entry.get("details", ""),
                        entry.get("ip", ""),
                    ),
                )

        logging.info(f"Migrated {len(data)} audit entries to SQLite")
        return True

    def _migrate_alerts(self) -> bool:
        """Migrate alerts from JSON"""
        if not os.path.exists(ALERTS_CONFIG_FILE):
            return False

        try:
            with open(ALERTS_CONFIG_FILE) as f:
                data = json.load(f)
        except Exception:
            return False

        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        for alert_id, alert in data.items():
            with contextlib.suppress(Exception):
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO alerts
                    (id, cluster_id, node, vmid, type, threshold, enabled,
                     notify_methods, cooldown, last_triggered, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        alert_id,
                        alert.get("cluster_id"),
                        alert.get("node"),
                        alert.get("vmid"),
                        alert.get("type", ""),
                        alert.get("threshold"),
                        1 if alert.get("enabled", True) else 0,
                        json.dumps(alert.get("notify_methods", [])),
                        alert.get("cooldown", 300),
                        alert.get("last_triggered"),
                        now,
                    ),
                )

        logging.info(f"Migrated {len(data)} alerts to SQLite")
        return True

    def _migrate_vm_acls(self) -> bool:
        """Migrate VM ACLs from JSON"""
        vm_acls_file = os.path.join(CONFIG_DIR, "vm_acls.json")
        if not os.path.exists(vm_acls_file):
            return False

        try:
            with open(vm_acls_file) as f:
                data = json.load(f)
        except Exception:
            return False

        cursor = self.conn.cursor()

        for cluster_id, vms in data.items():
            for vmid, acl in vms.items():
                with contextlib.suppress(Exception):
                    cursor.execute(
                        """
                        INSERT OR REPLACE INTO vm_acls (cluster_id, vmid, users, permissions, inherit_role)
                        VALUES (?, ?, ?, ?, ?)
                    """,
                        (
                            cluster_id,
                            vmid,
                            json.dumps(acl.get("users", [])),
                            json.dumps(acl.get("permissions", [])),
                            (
                                0
                                if str(acl.get("inherit_role", True)).strip().lower()
                                in ("false", "0", "no", "off", "none", "")
                                else 1
                            ),
                        ),
                    )

        logging.info("Migrated VM ACLs to SQLite")
        return True

    def _migrate_affinity_rules(self) -> bool:
        """Migrate affinity rules from JSON"""
        if not os.path.exists(AFFINITY_RULES_FILE):
            return False

        try:
            with open(AFFINITY_RULES_FILE) as f:
                data = json.load(f)
        except Exception:
            return False

        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        for cluster_id, rules in data.items():
            for rule in rules:
                with contextlib.suppress(Exception):
                    cursor.execute(
                        """
                        INSERT OR REPLACE INTO affinity_rules
                        (id, cluster_id, name, type, vms, enabled, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                        (
                            rule.get("id", str(uuid.uuid4())[:8]),
                            cluster_id,
                            rule.get("name", ""),
                            rule.get("type", "affinity"),
                            json.dumps(rule.get("vms", [])),
                            1 if rule.get("enabled", True) else 0,
                            now,
                        ),
                    )

        logging.info("Migrated affinity rules to SQLite")
        return True

    def _migrate_tenants(self) -> bool:
        """Migrate tenants from JSON"""
        tenants_file = os.path.join(CONFIG_DIR, "tenants.json")
        if not os.path.exists(tenants_file):
            return False

        try:
            with open(tenants_file) as f:
                data = json.load(f)
        except Exception:
            return False

        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        for tenant in data:
            with contextlib.suppress(Exception):
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO tenants (id, name, clusters, created_at)
                    VALUES (?, ?, ?, ?)
                """,
                    (
                        tenant.get("id", str(uuid.uuid4())[:8]),
                        tenant.get("name", ""),
                        json.dumps(tenant.get("clusters", [])),
                        now,
                    ),
                )

        logging.info(f"Migrated {len(data)} tenants to SQLite")
        return True

    def _migrate_scheduled_tasks(self) -> bool:
        """Migrate scheduled tasks from JSON"""
        if not os.path.exists(SCHEDULED_TASKS_FILE):
            return False

        try:
            with open(SCHEDULED_TASKS_FILE) as f:
                data = json.load(f)
        except Exception:
            return False

        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        for task_id, task in data.items():
            with contextlib.suppress(Exception):
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO scheduled_tasks
                    (id, cluster_id, name, task_type, schedule, config,
                     enabled, last_run, next_run, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        task_id,
                        task.get("cluster_id"),
                        task.get("name", ""),
                        task.get("task_type", ""),
                        task.get("schedule", ""),
                        json.dumps(task.get("config", {})),
                        1 if task.get("enabled", True) else 0,
                        task.get("last_run"),
                        task.get("next_run"),
                        now,
                    ),
                )

        logging.info(f"Migrated {len(data)} scheduled tasks to SQLite")
        return True

    def _migrate_vm_tags(self) -> bool:
        """Migrate VM tags from JSON"""
        if not os.path.exists(VM_TAGS_FILE):
            return False

        try:
            with open(VM_TAGS_FILE) as f:
                data = json.load(f)
        except Exception:
            return False

        cursor = self.conn.cursor()

        for key, tags in data.items():
            try:
                parts = key.split(":")
                if len(parts) == 2:
                    cluster_id, vmid = parts
                    for tag in tags:
                        tag_name = tag if isinstance(tag, str) else tag.get("name", "")
                        tag_color = tag.get("color", "") if isinstance(tag, dict) else ""
                        cursor.execute(
                            """
                            INSERT OR IGNORE INTO vm_tags (cluster_id, vmid, tag_name, tag_color)
                            VALUES (?, ?, ?, ?)
                        """,
                            (cluster_id, int(vmid), tag_name, tag_color),
                        )
            except Exception:
                pass

        logging.info("Migrated VM tags to SQLite")
        return True

    def _migrate_migration_history(self) -> bool:
        """Migrate migration history from JSON"""
        if not os.path.exists(MIGRATION_HISTORY_FILE):
            return False

        try:
            with open(MIGRATION_HISTORY_FILE) as f:
                data = json.load(f)
        except Exception:
            return False

        cursor = self.conn.cursor()

        for entry in data:
            with contextlib.suppress(Exception):
                cursor.execute(
                    """
                    INSERT INTO migration_history
                    (cluster_id, vmid, vm_name, source_node, target_node,
                     reason, status, duration_seconds, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        entry.get("cluster_id", ""),
                        entry.get("vmid", 0),
                        entry.get("vm_name", ""),
                        entry.get("source_node", ""),
                        entry.get("target_node", ""),
                        entry.get("reason", ""),
                        entry.get("status", ""),
                        entry.get("duration", 0),
                        entry.get("timestamp", ""),
                    ),
                )

        logging.info(f"Migrated {len(data)} migration history entries to SQLite")
        return True

    def _migrate_server_settings(self) -> bool:
        """Migrate server settings from JSON"""
        if not os.path.exists(SERVER_SETTINGS_FILE):
            return False

        try:
            with open(SERVER_SETTINGS_FILE) as f:
                data = json.load(f)
        except Exception:
            return False

        cursor = self.conn.cursor()

        for key, value in data.items():
            with contextlib.suppress(Exception):
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO server_settings (key, value)
                    VALUES (?, ?)
                """,
                    (key, json.dumps(value) if not isinstance(value, str) else value),
                )

        logging.info("Migrated server settings to SQLite")
        return True

    def _migrate_custom_roles(self) -> bool:
        """Migrate custom roles from JSON"""
        roles_file = os.path.join(CONFIG_DIR, "custom_roles.json")
        if not os.path.exists(roles_file):
            return False

        try:
            with open(roles_file) as f:
                data = json.load(f)
        except Exception:
            return False

        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        for role_name, role_data in data.items():
            with contextlib.suppress(Exception):
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO custom_roles (name, permissions, description, created_at)
                    VALUES (?, ?, ?, ?)
                """,
                    (role_name, json.dumps(role_data.get("permissions", [])), role_data.get("description", ""), now),
                )

        logging.info("Migrated custom roles to SQLite")
        return True

    def _migrate_cluster_alerts(self) -> bool:
        """Migrate cluster alerts from JSON to SQLite

        These were in cluster_alerts.JSON before, now in database
        Handles both old dict format and new list format
        """
        alerts_file = os.path.join(CONFIG_DIR, "cluster_alerts.json")
        if not os.path.exists(alerts_file):
            return False

        try:
            with open(alerts_file) as f:
                data = json.load(f)
        except Exception:
            return False

        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        migrated = 0

        for cluster_id, alerts in data.items():
            # Handle list format (new style)
            if isinstance(alerts, list):
                for alert in alerts:
                    try:
                        alert_id = alert.get("id", str(uuid.uuid4())[:8])
                        cursor.execute(
                            """
                            INSERT OR REPLACE INTO cluster_alerts
                            (cluster_id, alert_type, config, enabled, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                        """,
                            (cluster_id, alert_id, json.dumps(alert), 1 if alert.get("enabled", True) else 0, now, now),
                        )
                        migrated += 1
                    except Exception:
                        pass
            # Handle dict format (old style)
            elif isinstance(alerts, dict):
                for alert_type, config in alerts.items():
                    try:
                        cursor.execute(
                            """
                            INSERT OR REPLACE INTO cluster_alerts
                            (cluster_id, alert_type, config, enabled, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                        """,
                            (
                                cluster_id,
                                alert_type,
                                json.dumps(config) if isinstance(config, dict) else str(config),
                                1,
                                now,
                                now,
                            ),
                        )
                        migrated += 1
                    except Exception:
                        pass

        logging.info(f"Migrated {migrated} cluster alerts to SQLite")
        return True

    def _migrate_esxi_storages(self) -> bool:
        """Migrate ESXi storage config from JSON to SQLite

        This esxi stuff was added for vmware migration support
        but those who do really need it for vmware migrations
        """
        esxi_file = os.path.join(CONFIG_DIR, "esxi_storages.json")
        if not os.path.exists(esxi_file):
            return False

        try:
            with open(esxi_file) as f:
                data = json.load(f)
        except Exception:
            return False

        cursor = self.conn.cursor()

        storages = data.get("storages", [])
        for storage in storages:
            with contextlib.suppress(Exception):
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO esxi_storages
                    (name, host, username, password_encrypted, datastore, enabled, config)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        storage.get("name", ""),
                        storage.get("host", ""),
                        storage.get("username", ""),
                        storage.get("password", ""),  # Already encrypted in JSON
                        storage.get("datastore", ""),
                        1 if storage.get("enabled", True) else 0,
                        json.dumps(storage.get("config", {})),
                    ),
                )  # old configs might have weird formats

        logging.info(f"Migrated {len(storages)} ESXi storages to SQLite")
        return True

    def _migrate_storage_clusters(self) -> bool:
        """Migrate storage clusters from JSON to SQLite

        This file was in the wrong place for a while (root dir instead of config)
        so we check both locations just in case
        """
        storage_file = os.path.join(CONFIG_DIR, "storage_clusters.json")
        if not os.path.exists(storage_file):
            storage_file = "storage_clusters.json"  # Legacy location oops
        if not os.path.exists(storage_file):
            return False

        try:
            with open(storage_file) as f:
                data = json.load(f)
        except Exception:
            return False

        cursor = self.conn.cursor()
        migrated = 0

        for cluster_id, config in data.items():
            clusters = config.get("clusters", [])
            for sc in clusters:
                try:
                    cursor.execute(
                        """
                        INSERT OR REPLACE INTO storage_clusters
                        (cluster_id, name, storage_type, nodes, config, enabled)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """,
                        (
                            cluster_id,
                            sc.get("name", ""),
                            sc.get("type", "ceph"),
                            json.dumps(sc.get("nodes", [])),
                            json.dumps(sc.get("config", {})),
                            1 if sc.get("enabled", True) else 0,
                        ),
                    )
                    migrated += 1
                except Exception:
                    pass

        logging.info(f"Migrated {migrated} storage clusters to SQLite")
        return True

    def _migrate_cluster_affinity_rules(self) -> bool:
        """Migrate cluster affinity rules from JSON to SQLite

        Affinity rules keep VMs together or apart on hosts
        useful for HA setups where you dont want both replicas on same node
        """
        rules_file = os.path.join(CONFIG_DIR, "cluster_affinity_rules.json")
        if not os.path.exists(rules_file):
            return False

        try:
            with open(rules_file) as f:
                data = json.load(f)
        except Exception:
            return False

        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        migrated = 0

        for cluster_id, rules in data.items():
            for rule in rules:
                try:
                    # some old rules might not have an id, generate one
                    rule_id = rule.get("id", str(uuid.uuid4()))
                    # Handle both 'vms' and 'vm_ids' field names
                    vms_data = rule.get("vms") or rule.get("vm_ids") or []
                    cursor.execute(
                        """
                        INSERT OR REPLACE INTO affinity_rules
                        (id, cluster_id, name, type, vms, enabled, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                        (
                            rule_id,
                            cluster_id,
                            rule.get("name", ""),
                            rule.get("type", "affinity"),
                            json.dumps(vms_data),
                            1 if rule.get("enabled", True) else 0,
                            rule.get("created_at", now),
                        ),
                    )
                    migrated += 1
                except Exception:
                    pass

        logging.info(f"Migrated {migrated} cluster affinity rules to SQLite")
        return True

    # ========================================
    # CLUSTER OPERATIONS
    # ========================================

    def get_all_clusters(self) -> dict:
        """Get all clusters (returns dict like legacy format)"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM clusters")

        clusters = {}
        for row in cursor.fetchall():
            # sqlcipher3/sqlite3 Row objects don't support .get(); convert to dict.
            row = dict(row)
            cluster_id = row["id"]
            try:
                clusters[cluster_id] = {
                    "name": row["name"],
                    "host": row["host"],
                    "user": row["user"],
                    "pass": self._decrypt(row["pass_encrypted"]),
                    "ssl_verification": bool(row["ssl_verification"]),
                    "migration_threshold": row["migration_threshold"],
                    "migration_tolerance": row.get("migration_tolerance", 10),
                    "check_interval": row["check_interval"],
                    "auto_migrate": bool(row["auto_migrate"]),
                    "balance_containers": bool(row["balance_containers"]),
                    "balance_local_disks": bool(row["balance_local_disks"]),
                    "proxlb_tags_enabled": bool(row["proxlb_tags_enabled"]) if "proxlb_tags_enabled" in row else False,
                    "dry_run": bool(row["dry_run"]),
                    "enabled": bool(row["enabled"]),
                    "ha_enabled": bool(row["ha_enabled"]),
                    "fallback_hosts": json.loads(row["fallback_hosts"] or "[]"),
                    "ssh_user": row["ssh_user"] or "",
                    "ssh_key": self._decrypt(row["ssh_key_encrypted"] or ""),
                    "ssh_port": row["ssh_port"] or 22,
                    "ha_settings": json.loads(row["ha_settings"] or "{}"),
                    "excluded_nodes": json.loads(row["excluded_nodes"] or "[]"),
                    "smbios_autoconfig": json.loads(row["smbios_autoconfig"] or "{}"),
                    "api_token_user": row.get("api_token_user", ""),
                    "api_token_secret": self._decrypt(row["api_token_secret_encrypted"])
                    if "api_token_secret_encrypted" in row and row["api_token_secret_encrypted"]
                    else "",
                    "cluster_type": row.get("cluster_type", "proxmox"),
                    "predictive_balancing": bool(row["predictive_balancing"]) if "predictive_balancing" in row else False,
                    "predictive_threshold": row.get("predictive_threshold", 0.0),
                    "balance_cpu_weight": row.get("balance_cpu_weight", 1.0),
                    "balance_mem_weight": row.get("balance_mem_weight", 1.0),
                    "balance_io_weight": row.get("balance_io_weight", 1.0),
                    "cpu_baseline": row.get("cpu_baseline", ""),
                    "vnc_tunnel": bool(row["vnc_tunnel"]) if "vnc_tunnel" in row else False,
                    "backup_sla_max_age_hours": int(row["backup_sla_max_age_hours"])
                    if "backup_sla_max_age_hours" in row and row["backup_sla_max_age_hours"] is not None
                    else 0,
                    "api_port": int(row["api_port"]) if "api_port" in row and row["api_port"] is not None else 8006,
                    # Worldmap fields (per-cluster)
                    "latitude": float(row["latitude"]) if "latitude" in row and row["latitude"] is not None else None,
                    "longitude": float(row["longitude"]) if "longitude" in row and row["longitude"] is not None else None,
                    "location_label": row["location_label"] if "location_label" in row and row["location_label"] else "",
                }
            except Exception as e:
                # One corrupt/unreadable row should not hide every cluster in the UI.
                logging.warning(f"Skipping cluster '{cluster_id}' during load due to decryption error: {e}")

        return clusters

    def get_cluster(self, cluster_id: str) -> dict | None:
        """Get single cluster"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM clusters WHERE id = ?", (cluster_id,))
        row = cursor.fetchone()

        if not row:
            return None

        row = dict(row)

        # Auto-migrate encrypted fields to AES-256-GCM if needed
        pass_encrypted = row["pass_encrypted"]
        ssh_key_encrypted = row["ssh_key_encrypted"] or ""
        api_token_secret_encrypted = row.get("api_token_secret_encrypted") or ""
        needs_migration = False

        if self._needs_reencrypt(pass_encrypted):
            needs_migration = True
        if ssh_key_encrypted and self._needs_reencrypt(ssh_key_encrypted):
            needs_migration = True
        if api_token_secret_encrypted and self._needs_reencrypt(api_token_secret_encrypted):
            needs_migration = True

        # Decrypt values
        decrypted_pass = self._decrypt(pass_encrypted)
        decrypted_ssh_key = self._decrypt(ssh_key_encrypted) if ssh_key_encrypted else ""
        decrypted_api_token_secret = self._decrypt(api_token_secret_encrypted) if api_token_secret_encrypted else ""

        # If migration needed, re-encrypt and save
        if needs_migration and self.aesgcm:
            try:
                cursor.execute(
                    """
                    UPDATE clusters SET
                        pass_encrypted = ?,
                        ssh_key_encrypted = ?,
                        api_token_secret_encrypted = ?,
                        updated_at = ?
                    WHERE id = ?
                """,
                    (
                        self._encrypt(decrypted_pass),
                        self._encrypt(decrypted_ssh_key) if decrypted_ssh_key else "",
                        self._encrypt(decrypted_api_token_secret) if decrypted_api_token_secret else "",
                        datetime.now().isoformat(),
                        cluster_id,
                    ),
                )
                self.conn.commit()
                logging.info(f"Migrated cluster '{cluster_id}' encryption to AES-256-GCM (Military Grade)")
            except Exception as e:
                logging.warning(f"Failed to migrate cluster encryption: {e}")

        return {
            "name": row["name"],
            "host": row["host"],
            "user": row["user"],
            "pass": decrypted_pass,
            "ssl_verification": bool(row["ssl_verification"]),
            "migration_threshold": row["migration_threshold"],
            "migration_tolerance": row.get("migration_tolerance", 10),
            "check_interval": row["check_interval"],
            "auto_migrate": bool(row["auto_migrate"]),
            "balance_containers": bool(row["balance_containers"]),
            "balance_local_disks": bool(row["balance_local_disks"]),
            "proxlb_tags_enabled": bool(row["proxlb_tags_enabled"]) if "proxlb_tags_enabled" in row else False,
            "dry_run": bool(row["dry_run"]),
            "enabled": bool(row["enabled"]),
            "ha_enabled": bool(row["ha_enabled"]),
            "fallback_hosts": json.loads(row["fallback_hosts"] or "[]"),
            "ssh_user": row["ssh_user"] or "",
            "ssh_key": decrypted_ssh_key,
            "ssh_port": row["ssh_port"] or 22,
            "ha_settings": json.loads(row["ha_settings"] or "{}"),
            "excluded_nodes": json.loads(row["excluded_nodes"] or "[]"),
            "smbios_autoconfig": json.loads(row["smbios_autoconfig"] or "{}"),
            "api_token_user": row.get("api_token_user", ""),
            "api_token_secret": decrypted_api_token_secret,
            "cluster_type": row.get("cluster_type", "proxmox"),
            "predictive_balancing": bool(row["predictive_balancing"]) if "predictive_balancing" in row else False,
            "predictive_threshold": row.get("predictive_threshold", 0.0),
            "balance_cpu_weight": row.get("balance_cpu_weight", 1.0),
            "balance_mem_weight": row.get("balance_mem_weight", 1.0),
            "balance_io_weight": row.get("balance_io_weight", 1.0),
            "cpu_baseline": row.get("cpu_baseline", ""),
            "vnc_tunnel": bool(row["vnc_tunnel"]) if "vnc_tunnel" in row else False,
            "backup_sla_max_age_hours": int(row["backup_sla_max_age_hours"])
            if "backup_sla_max_age_hours" in row and row["backup_sla_max_age_hours"] is not None
            else 0,
            # Proxmox API port override (default 8006). Direct-TLS only, never proxied.
            "api_port": int(row["api_port"]) if "api_port" in row and row["api_port"] is not None else 8006,
            # Worldmap fields (per-cluster, NULL = not plotted)
            "latitude": float(row["latitude"]) if "latitude" in row and row["latitude"] is not None else None,
            "longitude": float(row["longitude"]) if "longitude" in row and row["longitude"] is not None else None,
            "location_label": row["location_label"] if "location_label" in row and row["location_label"] else "",
        }

    def save_cluster(self, cluster_id: str, data: dict):
        """Save or update cluster"""
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        # Preserve group_id/display_name/sort_order that aren't in config data
        cursor.execute(
            "SELECT group_id, display_name, sort_order, created_at FROM clusters WHERE id = ?", (cluster_id,)
        )
        existing = cursor.fetchone()

        # Preserve previously-set worldmap location across save_cluster
        # round-trips. The cluster-edit UI only sends location when the operator
        # actually opens the location panel; without this preserve, every other
        # edit (rename, password rotation, etc.) would wipe the dot off the map.
        existing_lat = existing_lon = existing_loc_label = None
        if existing:
            try:
                cursor.execute("SELECT latitude, longitude, location_label FROM clusters WHERE id = ?", (cluster_id,))
                _loc = cursor.fetchone()
                if _loc:
                    existing_lat = _loc["latitude"]
                    existing_lon = _loc["longitude"]
                    existing_loc_label = _loc["location_label"]
            except Exception:
                pass

        cursor.execute(
            """
            INSERT OR REPLACE INTO clusters
            (id, name, host, user, pass_encrypted, ssl_verification,
             migration_threshold, migration_tolerance, check_interval, auto_migrate,
             balance_containers, balance_local_disks, dry_run, enabled,
             ha_enabled, fallback_hosts, ssh_user, ssh_key_encrypted,
             ssh_port, ha_settings, excluded_nodes, smbios_autoconfig,
             api_token_user, api_token_secret_encrypted,
             group_id, display_name, sort_order,
             cluster_type,
             predictive_balancing, predictive_threshold,
             balance_cpu_weight, balance_mem_weight, balance_io_weight,
             cpu_baseline, vnc_tunnel,
             backup_sla_max_age_hours,
             api_port,
             latitude, longitude, location_label,
             proxlb_tags_enabled,
             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                cluster_id,
                data.get("name", ""),
                data.get("host", ""),
                data.get("user", ""),
                self._encrypt(data.get("pass", "")),
                1 if data.get("ssl_verification", True) else 0,
                data.get("migration_threshold", 30),
                data.get("migration_tolerance", 10),
                data.get("check_interval", 300),
                1 if data.get("auto_migrate", False) else 0,
                1 if data.get("balance_containers", False) else 0,
                1 if data.get("balance_local_disks", False) else 0,
                1 if data.get("dry_run", True) else 0,
                1 if data.get("enabled", True) else 0,
                1 if data.get("ha_enabled", False) else 0,
                json.dumps(data.get("fallback_hosts", [])),
                data.get("ssh_user", ""),
                self._encrypt(data.get("ssh_key", "")),
                data.get("ssh_port", 22),
                json.dumps(data.get("ha_settings", {})),
                json.dumps(data.get("excluded_nodes", [])),
                json.dumps(data.get("smbios_autoconfig", {})),
                data.get("api_token_user", ""),
                self._encrypt(data.get("api_token_secret", "")) if data.get("api_token_secret") else "",
                data.get("group_id", existing["group_id"] if existing else None),
                data.get("display_name", existing["display_name"] if existing else None),
                data.get("sort_order", existing["sort_order"] if existing else None),
                data.get("cluster_type", "proxmox"),
                1 if data.get("predictive_balancing", False) else 0,
                float(data.get("predictive_threshold", 0.0) or 0.0),
                float(data.get("balance_cpu_weight", 1.0) or 1.0),
                float(data.get("balance_mem_weight", 1.0) or 1.0),
                float(data.get("balance_io_weight", 1.0) or 1.0),
                data.get("cpu_baseline", "") or "",
                1 if data.get("vnc_tunnel", False) else 0,
                int(data.get("backup_sla_max_age_hours", 0) or 0),
                int(data.get("api_port", 8006) or 8006),
                data.get("latitude", existing_lat),
                data.get("longitude", existing_lon),
                data.get("location_label", existing_loc_label) or "",
                1 if data.get("proxlb_tags_enabled", False) else 0,
                existing["created_at"] if existing else now,
                now,
            ),
        )
        self.conn.commit()

    # Whitelist for update_cluster to prevent SQL injection via dict keys
    _CLUSTER_FIELDS = frozenset({
        "name",
        "host",
        "port",
        "user",
        "password_encrypted",
        "cluster_type",
        "auto_balance",
        "balance_threshold",
        "balance_local_disks",
        "migration_tolerance",
        "ha_enabled",
        "ha_check_interval",
        "smbios_autoconfig",
        "max_migrations_per_cycle",
        # Worldmap (per-cluster location).
        "latitude",
        "longitude",
        "location_label",
    })

    def update_cluster(self, cluster_id: str, fields: dict):
        """Partial update of cluster fields - Feb 2026"""
        if not fields:
            return
        cursor = self.conn.cursor()
        sets = []
        vals = []
        for key, value in fields.items():
            if key not in self._CLUSTER_FIELDS:
                logging.warning(f"[DB] update_cluster: rejected unknown field '{key}'")
                continue
            sets.append(f"{key} = ?")
            vals.append(value)
        if not sets:
            return
        sets.append("updated_at = ?")
        vals.append(datetime.now().isoformat())
        vals.append(cluster_id)
        query = f"UPDATE clusters SET {', '.join(sets)} WHERE id = ?"  # nosec: B608 - column names are from a hardcoded allowlist and values use ? placeholders
        cursor.execute(query, vals)
        self.conn.commit()

    def delete_cluster(self, cluster_id: str):
        """Delete cluster"""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM clusters WHERE id = ?", (cluster_id,))
        self.conn.commit()

    # ========================================
    # USER OPERATIONS
    # ========================================

    def get_all_users(self) -> dict:
        """Get all users"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM users")

        def build_avatar_url(row_data: dict) -> str:
            avatar_mime = row_data.get("avatar_mime", "") or ""
            avatar_data = row_data.get("avatar_data", "") or ""
            if avatar_mime and avatar_data:
                return f"data:{avatar_mime};base64,{avatar_data}"
            return ""

        users = {}
        for row in cursor.fetchall():
            # Handle both old schema (no password_salt) and new schema
            row_dict = dict(row)
            password_salt = row_dict.get("password_salt", "")
            password_hash = row_dict.get("password_hash", "")

            # If password_salt is missing or empty, check if there's a combined 'password' field
            # This handles migration edge cases
            if not password_salt and "password" in row_dict:
                # Old format might have combined salt:hash
                combined = row_dict.get("password", "")
                if ":" in combined:
                    password_salt, password_hash = combined.split(":", 1)

            users[row["username"]] = {
                "password_salt": password_salt,
                "password_hash": password_hash,
                "role": row["role"],
                "permissions": json.loads(row_dict.get("permissions") or "[]"),
                "tenant_id": row_dict.get("tenant")
                or DEFAULT_TENANT_ID,  # Database stores 'tenant', code uses 'tenant_id'
                "created_at": row_dict.get("created_at"),
                "last_login": row_dict.get("last_login"),
                "password_expiry": row_dict.get("password_expiry"),
                "totp_secret": self._decrypt(row_dict.get("totp_secret_encrypted") or ""),
                "totp_pending_secret": self._decrypt(
                    row_dict.get("totp_pending_secret_encrypted") or ""
                ),  # Load the pending 2FA secret
                "totp_enabled": bool(row_dict.get("totp_enabled", 0)),
                "force_password_change": bool(row_dict.get("force_password_change", 0)),
                "enabled": bool(row_dict.get("enabled", 1)),
                # User preferences - these were missing!
                "theme": row_dict.get("theme", ""),
                "language": row_dict.get("language", ""),
                "ui_layout": row_dict.get("ui_layout", "modern"),
                "taskbar_auto_expand": bool(row_dict.get("taskbar_auto_expand", 1)),
                # LDAP fields
                "auth_source": row_dict.get("auth_source", "local"),
                "display_name": row_dict.get("display_name", ""),
                "email": row_dict.get("email", ""),
                "avatar_mime": row_dict.get("avatar_mime", ""),
                "avatar_data": row_dict.get("avatar_data", ""),
                "avatar_url": build_avatar_url(row_dict),
                "ldap_dn": row_dict.get("ldap_dn", ""),
                "last_ldap_sync": row_dict.get("last_ldap_sync", ""),
                # OIDC and tenant permission fields
                "tenant_permissions": json.loads(row_dict.get("tenant_permissions") or "{}"),
                "denied_permissions": json.loads(row_dict.get("denied_permissions") or "[]"),
                "oidc_sub": row_dict.get("oidc_sub", ""),
                "last_oidc_sync": row_dict.get("last_oidc_sync", ""),
                "layout_chosen": bool(row_dict.get("layout_chosen", 0)),
                "portal_only": bool(row_dict.get("portal_only", 0)),
                "sidebar_show_vmid": bool(row_dict.get("sidebar_show_vmid", 0)),
                "user_folder": row_dict.get("user_folder", ""),
                "taskbar_visible": bool(row_dict.get("taskbar_visible", 1)),
                "taskbar_expanded": bool(row_dict.get("taskbar_expanded", 0)),
            }

        return users

    def get_user(self, username: str) -> dict | None:
        """Get single user"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
        row = cursor.fetchone()

        if not row:
            return None

        # Handle both old schema (no password_salt) and new schema
        row_dict = dict(row)
        password_salt = row_dict.get("password_salt", "")
        password_hash = row_dict.get("password_hash", "")

        # If password_salt is missing or empty, check if there's a combined 'password' field
        if not password_salt and "password" in row_dict:
            combined = row_dict.get("password", "")
            if ":" in combined:
                password_salt, password_hash = combined.split(":", 1)

        def build_avatar_url(row_data: dict) -> str:
            avatar_mime = row_data.get("avatar_mime", "") or ""
            avatar_data = row_data.get("avatar_data", "") or ""
            if avatar_mime and avatar_data:
                return f"data:{avatar_mime};base64,{avatar_data}"
            return ""

        return {
            "password_salt": password_salt,
            "password_hash": password_hash,
            "role": row_dict.get("role", "viewer"),
            "permissions": json.loads(row_dict.get("permissions") or "[]"),
            "tenant_id": row_dict.get("tenant") or DEFAULT_TENANT_ID,  # Database stores 'tenant', code uses 'tenant_id'
            "created_at": row_dict.get("created_at"),
            "last_login": row_dict.get("last_login"),
            "password_expiry": row_dict.get("password_expiry"),
            "totp_secret": self._decrypt(row_dict.get("totp_secret_encrypted") or ""),
            "totp_pending_secret": self._decrypt(
                row_dict.get("totp_pending_secret_encrypted") or ""
            ),  # Load the pending 2FA secret
            "totp_enabled": bool(row_dict.get("totp_enabled", 0)),
            "force_password_change": bool(row_dict.get("force_password_change", 0)),
            "enabled": bool(row_dict.get("enabled", 1)),
            "theme": row_dict.get("theme", ""),
            "language": row_dict.get("language", ""),
            "ui_layout": row_dict.get("ui_layout", "modern"),
            "taskbar_auto_expand": bool(row_dict.get("taskbar_auto_expand", 1)),  # Feb 2026
            "auth_source": row_dict.get("auth_source", "local"),
            "display_name": row_dict.get("display_name", ""),
            "email": row_dict.get("email", ""),
            "avatar_mime": row_dict.get("avatar_mime", ""),
            "avatar_data": row_dict.get("avatar_data", ""),
            "avatar_url": build_avatar_url(row_dict),
            "ldap_dn": row_dict.get("ldap_dn", ""),
            "last_ldap_sync": row_dict.get("last_ldap_sync", ""),
            # OIDC and tenant permission fields
            "tenant_permissions": json.loads(row_dict.get("tenant_permissions") or "{}"),
            "denied_permissions": json.loads(row_dict.get("denied_permissions") or "[]"),
            "oidc_sub": row_dict.get("oidc_sub", ""),
            "last_oidc_sync": row_dict.get("last_oidc_sync", ""),
            "layout_chosen": bool(row_dict.get("layout_chosen", 0)),
            "portal_only": bool(row_dict.get("portal_only", 0)),
            "sidebar_show_vmid": bool(row_dict.get("sidebar_show_vmid", 0)),
            "user_folder": row_dict.get("user_folder", ""),
            "taskbar_visible": bool(row_dict.get("taskbar_visible", 1)),
            "taskbar_expanded": bool(row_dict.get("taskbar_expanded", 0)),
        }

    def save_user(self, username: str, data: dict):
        """Save or update user"""
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        cursor.execute(
            """
            INSERT OR REPLACE INTO users
            (username, password_salt, password_hash, role, permissions, tenant,
             created_at, last_login, password_expiry,
             totp_secret_encrypted, totp_pending_secret_encrypted, totp_enabled, force_password_change,
            enabled, theme, language, ui_layout, taskbar_auto_expand,
             auth_source, display_name, email, avatar_mime, avatar_data, ldap_dn, last_ldap_sync,
             tenant_permissions, denied_permissions, oidc_sub, last_oidc_sync,
             layout_chosen, portal_only, sidebar_show_vmid, user_folder,
             taskbar_visible, taskbar_expanded)
            VALUES (?, ?, ?, ?, ?, ?,
                    COALESCE((SELECT created_at FROM users WHERE username = ?), ?),
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?)
        """,
            (
                username,
                data.get("password_salt", ""),
                data.get("password_hash", ""),
                data.get("role", "viewer"),
                json.dumps(data.get("permissions", [])),
                data.get("tenant_id") or data.get("tenant"),  # Accept both key names
                username,
                now,
                data.get("last_login"),
                data.get("password_expiry"),
                self._encrypt(data.get("totp_secret", "")),
                self._encrypt(data.get("totp_pending_secret", "")),  # Save the pending 2FA secret
                1 if data.get("totp_enabled", False) else 0,
                1 if data.get("force_password_change", False) else 0,
                1 if data.get("enabled", True) else 0,
                data.get("theme", ""),
                data.get("language", ""),
                data.get("ui_layout", "modern"),
                1 if data.get("taskbar_auto_expand", True) else 0,  # Feb 2026
                data.get("auth_source", "local"),  # LDAP
                data.get("display_name", ""),
                data.get("email", ""),
                data.get("avatar_mime", ""),
                data.get("avatar_data", ""),
                data.get("ldap_dn", ""),
                data.get("last_ldap_sync", ""),
                # OIDC and tenant permission fields
                json.dumps(data.get("tenant_permissions", {})),
                json.dumps(data.get("denied_permissions", [])),
                data.get("oidc_sub", ""),
                data.get("last_oidc_sync", ""),
                1 if data.get("layout_chosen", False) else 0,
                1 if data.get("portal_only", False) else 0,
                1 if data.get("sidebar_show_vmid", False) else 0,
                data.get("user_folder", ""),
                1 if data.get("taskbar_visible", True) else 0,
                1 if data.get("taskbar_expanded", False) else 0,
            ),
        )
        self.conn.commit()

    def save_all_users(self, users: dict):
        """Save all users (for bulk operations)"""
        for username, data in users.items():
            self.save_user(username, data)

    def delete_user(self, username: str):
        """Delete user"""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM users WHERE username = ?", (username,))
        self.conn.commit()

    # ========================================
    # SESSION OPERATIONS
    # ========================================

    def get_all_sessions(self) -> dict:
        """Get all sessions from database

        NOTE: Since v0.6.1, session tokens are stored as SHA-256 hashes.
        This means sessions loaded from DB cannot be validated against
        plaintext tokens - users must re-login after server restart.
        This is a SECURITY FEATURE, not a bug!
        """
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM sessions")

        # Return empty dict - old hashed sessions can't be used anyway
        # This forces re-login after restart (more secure)
        sessions = {}
        # Note: We could load the hashes, but they're useless for validation
        # since we can't reverse SHA-256. Just return empty.
        logging.debug("Sessions in DB will be cleared (tokens are hashed, can't validate)")

        # Clean up old sessions from DB
        cursor.execute("DELETE FROM sessions")
        self.conn.commit()

        return sessions

    def get_session(self, token: str) -> dict | None:
        """Get single session"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM sessions WHERE token = ?", (token,))
        row = cursor.fetchone()

        if not row:
            return None

        return {
            "user": row["username"],
            "created": row["created_at"],
            "expires": row["expires_at"],
            "ip": row["ip_address"],
            "user_agent": row["user_agent"],
        }

    def save_session(self, token: str, data: dict):
        """Save session

        Session tokens are hashed before storing in database for security!
        If someone steals the DB, they can't hijack sessions.
        Trade-off: Sessions don't survive server restarts (users must re-login)
        """
        cursor = self.conn.cursor()

        # Hash the token - even if DB is stolen, tokens can't be used
        token_hash = hashlib.sha256(token.encode()).hexdigest()

        cursor.execute(
            """
            INSERT OR REPLACE INTO sessions
            (token, username, created_at, expires_at, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?)
        """,
            (
                token_hash,  # Store hash, not plaintext token!
                data.get("user", ""),
                data.get("created", ""),
                data.get("expires", ""),
                data.get("ip", ""),
                data.get("user_agent", ""),
            ),
        )
        self.conn.commit()

    def delete_session(self, token: str):
        """Delete session"""
        cursor = self.conn.cursor()
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        cursor.execute("DELETE FROM sessions WHERE token = ?", (token_hash,))
        self.conn.commit()

    def delete_expired_sessions(self):
        """Delete expired sessions"""
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        self.conn.commit()

    def save_all_sessions(self, sessions: dict):
        """Save all sessions"""
        for token, data in sessions.items():
            self.save_session(token, data)

    # ========================================
    # AUDIT LOG OPERATIONS (with HMAC Integrity)
    # ========================================

    def _generate_audit_hmac(
        self, timestamp: str, user: str, action: str, details: str, ip: str, cluster: str = "", severity: str = ""
    ) -> str:
        """Generate HMAC signature for audit entry (tamper detection).

        (audit fix M-2) - added cluster + severity to the canonical
        string. Old entries (signed before May 2026) won't have those fields
        in their HMAC; the verify path tries the new format first, then
        falls back to the legacy format for backward compat.
        """
        if not self.aes_key:
            return ""
        # Canonical: timestamp|user|action|details|ip|cluster|severity
        data = f"{timestamp}|{user or ''}|{action}|{details or ''}|{ip or ''}|{cluster or ''}|{severity or ''}"
        signature = hmac.new(self.aes_key, data.encode("utf-8"), hashlib.sha256).hexdigest()
        return signature

    def _verify_audit_hmac(self, entry: dict) -> bool:
        """Verify HMAC signature of an audit entry.  fail-closed:
        if there's no key we cannot trust the entry, so report unverified
        rather than 'OK'."""
        if not self.aes_key:
            return False  # fail-closed (was: True / fail-open)

        stored_sig = entry.get("hmac_signature", "")
        if not stored_sig:
            return False  # No signature = potentially tampered or old entry

        # Try new format (with cluster + severity).
        expected_new = self._generate_audit_hmac(
            entry.get("timestamp", ""),
            entry.get("user", ""),
            entry.get("action", ""),
            entry.get("details", ""),
            entry.get("ip_address", ""),
            entry.get("cluster", ""),
            entry.get("severity", ""),
        )
        if hmac.compare_digest(stored_sig, expected_new):
            return True

        # Backward-compat: pre-May-2026 entries didn't include cluster/severity
        # in the canonical string. Try the legacy 5-field form.
        legacy_data = (
            f"{entry.get('timestamp', '')}|{entry.get('user', '') or ''}|"
            f"{entry.get('action', '')}|{entry.get('details', '') or ''}|"
            f"{entry.get('ip_address', '') or ''}"
        )
        legacy_sig = hmac.new(self.aes_key, legacy_data.encode("utf-8"), hashlib.sha256).hexdigest()
        return hmac.compare_digest(stored_sig, legacy_sig)

    def add_audit_entry(
        self, user: str, action: str, details: str = "", ip: str = "", cluster: str = "", severity: str = None
    ):
        """Add audit log entry with HMAC signature for integrity verification.

        cluster/severity added  keep optional so existing callers
        keep working unchanged.
        """
        cursor = self.conn.cursor()
        timestamp = datetime.now().isoformat()

        # Auto-derive severity from action prefix when caller didn't pass one
        if severity is None:
            a = (action or "").lower()
            if "delete" in a or "remove" in a or "destroy" in a:
                severity = "warning"
            elif "fail" in a or "denied" in a or "tampered" in a or "security" in a:
                severity = "critical"
            elif "login" in a or "logout" in a:
                severity = "info"
            else:
                severity = "info"

        signature = self._generate_audit_hmac(timestamp, user, action, details, ip, cluster or "", severity)

        cursor.execute(
            """
            INSERT INTO audit_log (timestamp, user, action, details, ip_address,
                                   hmac_signature, cluster, severity)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (timestamp, user, action, details, ip, signature, cluster or "", severity),
        )
        last_id = cursor.lastrowid
        self.conn.commit()

        # Hand off to SIEM forwarder if anyone has plugged into the queue.
        # Late import to avoid import cycles at module load.
        try:
            from ProxmoxVEx.api import siem as _siem_mod

            _siem_mod.enqueue({
                "id": last_id,
                "timestamp": timestamp,
                "user": user,
                "action": action,
                "details": details,
                "ip_address": ip,
                "cluster": cluster or "",
                "severity": severity,
            })
        except Exception:
            # silently swallow — SIEM is optional and shouldn't break audit writes
            pass

    def search_audit_log(
        self,
        q: str = "",
        user: str = "",
        action: str = "",
        cluster: str = "",
        severity: str = "",
        ip: str = "",
        date_from: str = "",
        date_to: str = "",
        offset: int = 0,
        limit: int = 100,
    ) -> tuple[list[dict[str, Any]], int]:
        """Search audit log with rich filters + pagination.
        Returns (entries, total) where total is the un-paginated row count."""
        cursor = self.conn.cursor()
        conds = []
        params: list[Any] = []
        if q:
            # search across user, action, details, cluster
            conds.append("(user LIKE ? OR action LIKE ? OR details LIKE ? OR cluster LIKE ?)")
            wild = f"%{q}%"
            params.extend([wild, wild, wild, wild])
        if user:
            conds.append("user = ?")
            params.append(user)
        if action:
            conds.append("action LIKE ?")
            params.append(f"%{action}%")
        if cluster:
            conds.append("cluster = ?")
            params.append(cluster)
        if severity:
            conds.append("severity = ?")
            params.append(severity)
        if ip:
            conds.append("ip_address LIKE ?")
            params.append(f"%{ip}%")
        if date_from:
            conds.append("timestamp >= ?")
            params.append(date_from)
        if date_to:
            conds.append("timestamp <= ?")
            params.append(date_to)
        where = (" WHERE " + " AND ".join(conds)) if conds else ""

        # total
        query = f"SELECT COUNT(*) AS n FROM audit_log{where}"  # nosec: B608 - where clauses built from hardcoded columns with ? placeholders
        cursor.execute(query, params)
        total = cursor.fetchone()["n"]

        # page
        query = f"SELECT * FROM audit_log{where} ORDER BY timestamp DESC LIMIT ? OFFSET ?"  # nosec: B608 - where clauses built from hardcoded columns with ? placeholders
        cursor.execute(
            query,
            params + [int(limit), int(offset)],
        )
        rows = [dict(r) for r in cursor.fetchall()]
        return rows, total

    def audit_facets(self, days=7):
        """Return top users/actions for the audit search UI dropdowns."""
        cursor = self.conn.cursor()
        cutoff = (datetime.now() - timedelta(days=days)).isoformat()
        out = {"users": [], "actions": [], "clusters": []}
        try:
            cursor.execute(
                'SELECT user, COUNT(*) AS n FROM audit_log WHERE timestamp >= ? AND user != "" GROUP BY user ORDER BY n DESC LIMIT 30',
                (cutoff,),
            )
            out["users"] = [{"user": r["user"], "count": r["n"]} for r in cursor.fetchall()]
            cursor.execute(
                "SELECT action, COUNT(*) AS n FROM audit_log WHERE timestamp >= ? GROUP BY action ORDER BY n DESC LIMIT 50",
                (cutoff,),
            )
            out["actions"] = [{"action": r["action"], "count": r["n"]} for r in cursor.fetchall()]
            cursor.execute(
                'SELECT cluster, COUNT(*) AS n FROM audit_log WHERE timestamp >= ? AND cluster != "" GROUP BY cluster ORDER BY n DESC LIMIT 30',
                (cutoff,),
            )
            out["clusters"] = [{"cluster": r["cluster"], "count": r["n"]} for r in cursor.fetchall()]
        except Exception as e:
            logging.warning(f"audit_facets failed: {e}")
        return out

    def get_audit_log(
        self, limit: int = 1000, user: str = None, action: str = None, verify_integrity: bool = False
    ) -> list:
        """Get audit log entries, optionally verifying HMAC integrity"""
        cursor = self.conn.cursor()

        query = "SELECT * FROM audit_log"
        params: list[Any] = []
        conditions = []

        if user:
            conditions.append("user = ?")
            params.append(user)
        if action:
            conditions.append("action LIKE ?")
            params.append(f"%{action}%")

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)

        cursor.execute(query, params)

        entries = [dict(row) for row in cursor.fetchall()]

        # Optionally verify integrity
        if verify_integrity:
            for entry in entries:
                entry["integrity_verified"] = self._verify_audit_hmac(entry)

        return entries

    def verify_audit_log_integrity(self, limit: int = None) -> dict:
        """Verify integrity of the audit log — returns statistics.

        (scale): runs FULLY off the gevent hub via run_heavy_read - the
        SELECT *and* the per-row SQLCipher decrypt + HMAC verify happen in a worker
        thread on a fresh connection, so the UI never freezes even when the audit_log
        holds hundreds of thousands of rows (100 nodes / 1000+ VMs). Coverage is NOT
        reduced — the full log is verified by default (the HMAC verify is pure CPU,
        no DB access, so it is safe in the worker). Pass limit=N for a bounded
        spot-check; omit for the complete off-hub scan.
        """

        def _verify_rows(rows):
            total = 0
            verified = 0
            unsigned = 0
            tampered = 0
            for row in rows:
                entry = dict(row)
                total += 1
                if not entry.get("hmac_signature"):
                    unsigned += 1  # Old entry without signature
                elif self._verify_audit_hmac(entry):
                    verified += 1
                else:
                    tampered += 1
                    logging.warning(
                        f"AUDIT LOG INTEGRITY VIOLATION: Entry ID {entry.get('id')} may have been tampered!"
                    )
            return {
                "total_entries": total,
                "verified": verified,
                "unsigned": unsigned,
                "potentially_tampered": tampered,
                "integrity_percentage": round((verified / total * 100) if total > 0 else 100, 2),
                "scanned_limit": (limit if limit and limit > 0 else None),  # None = full scan
            }

        params: tuple = ()
        if limit and limit > 0:
            sql = "SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?"
            params = (limit,)
        else:
            sql = "SELECT * FROM audit_log ORDER BY timestamp DESC"

        try:
            from ProxmoxVEx.core.dbcrypto import run_heavy_read

            # transform runs INSIDE the worker thread → verify stays off the hub too.
            return run_heavy_read(sql, params, transform=_verify_rows)
        except Exception:
            # Fallback: gevent/off-hub path unavailable (CLI/test) — run in-thread.
            cursor = self.conn.cursor()
            cursor.execute(sql, params)
            return _verify_rows(cursor.fetchall())

    def cleanup_audit_log(self, days: int = 90):
        """Remove audit entries older than specified days"""
        cursor = self.conn.cursor()
        cutoff = (datetime.now() - timedelta(days=days)).isoformat()
        cursor.execute("DELETE FROM audit_log WHERE timestamp < ?", (cutoff,))
        deleted = cursor.rowcount
        self.conn.commit()
        return deleted

    # ========================================
    # ALERT OPERATIONS
    # ========================================

    def get_all_alerts(self) -> dict:
        """Get all alerts"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM alerts")

        alerts = {}
        for row in cursor.fetchall():
            alerts[row["id"]] = {
                "id": row["id"],
                "cluster_id": row["cluster_id"],
                "node": row["node"],
                "vmid": row["vmid"],
                "type": row["type"],
                "threshold": row["threshold"],
                "enabled": bool(row["enabled"]),
                "notify_methods": json.loads(row["notify_methods"] or "[]"),
                "cooldown": row["cooldown"],
                "last_triggered": row["last_triggered"],
            }

        return alerts

    def save_alert(self, alert_id: str, data: dict):
        """Save alert"""
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        cursor.execute(
            """
            INSERT OR REPLACE INTO alerts
            (id, cluster_id, node, vmid, type, threshold, enabled,
             notify_methods, cooldown, last_triggered, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    COALESCE((SELECT created_at FROM alerts WHERE id = ?), ?))
        """,
            (
                alert_id,
                data.get("cluster_id"),
                data.get("node"),
                data.get("vmid"),
                data.get("type", ""),
                data.get("threshold"),
                1 if data.get("enabled", True) else 0,
                json.dumps(data.get("notify_methods", [])),
                data.get("cooldown", 300),
                data.get("last_triggered"),
                alert_id,
                now,
            ),
        )
        self.conn.commit()

    def delete_alert(self, alert_id: str):
        """Delete alert"""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
        self.conn.commit()

    def save_all_alerts(self, alerts: dict):
        """Save all alerts"""
        for alert_id, data in alerts.items():
            self.save_alert(alert_id, data)

    # ========================================
    # VM ACL OPERATIONS
    # ========================================

    def get_all_vm_acls(self) -> dict:
        """Get all VM ACLs"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM vm_acls")

        acls = {}
        for row in cursor.fetchall():
            cluster_id = row["cluster_id"]
            if cluster_id not in acls:
                acls[cluster_id] = {}
            acls[cluster_id][row["vmid"]] = acls[cluster_id][row["vmid"]] = {
                "users": json.loads(row["users"] or "[]"),
                "permissions": json.loads(row["permissions"] or "[]"),
                # default True for legacy rows (pre-column) to preserve behaviour
                "inherit_role": bool(int(row["inherit_role"])) if row["inherit_role"] is not None else True,
            }

        return acls

    def save_vm_acl(self, cluster_id: str, vmid: str, data: dict):
        """Save VM ACL"""
        cursor = self.conn.cursor()
        cursor.execute(
            """
            INSERT OR REPLACE INTO vm_acls (cluster_id, vmid, users, permissions, inherit_role)
            VALUES (?, ?, ?, ?, ?)
        """,
            (
                cluster_id,
                vmid,
                json.dumps(data.get("users", [])),
                json.dumps(data.get("permissions", [])),
                (
                    0
                    if str(data.get("inherit_role", True)).strip().lower() in ("false", "0", "no", "off", "none", "")
                    else 1
                ),
            ),
        )
        self.conn.commit()

    def save_all_vm_acls(self, acls: dict):
        """Save all VM ACLs"""
        for cluster_id, vms in acls.items():
            for vmid, data in vms.items():
                self.save_vm_acl(cluster_id, vmid, data)

    def delete_vm_acl(self, cluster_id: str, vmid: int) -> bool:
        """Delete a VM ACL entry from the database

        This was missing! save_all_vm_acls only adds/updates, never deletes.
        """
        try:
            cursor = self.conn.cursor()
            cursor.execute("DELETE FROM vm_acls WHERE cluster_id = ? AND vmid = ?", (cluster_id, str(vmid)))
            self.conn.commit()
            return cursor.rowcount > 0
        except Exception as e:
            logging.error(f"Failed to delete VM ACL: {e}")
            return False

    # ========================================
    # POOL PERMISSIONS
    # ========================================

    def get_pool_permissions(self, cluster_id: str, pool_id: str = None) -> List[Dict]:
        """Get pool permissions, optionally filtered by pool_id"""
        cursor = self.conn.cursor()
        if pool_id:
            cursor.execute(
                """
                SELECT * FROM pool_permissions
                WHERE cluster_id = ? AND pool_id = ?
            """,
                (cluster_id, pool_id),
            )
        else:
            cursor.execute(
                """
                SELECT * FROM pool_permissions WHERE cluster_id = ?
            """,
                (cluster_id,),
            )

        rows = cursor.fetchall()
        result = []
        for row in rows:
            result.append({
                "id": row[0],
                "cluster_id": row[1],
                "pool_id": row[2],
                "subject_type": row[3],  # 'user' or 'group'
                "subject_id": row[4],  # username or group name
                "permissions": json.loads(row[5]) if row[5] else [],
                "created_at": row[6],
                "updated_at": row[7],
            })
        return result

    def save_pool_permission(
        self, cluster_id: str, pool_id: str, subject_type: str, subject_id: str, permissions: List[str]
    ) -> bool:
        """Save or update pool permission"""
        try:
            cursor = self.conn.cursor()
            now = datetime.now().isoformat()
            cursor.execute(
                """
                INSERT INTO pool_permissions (cluster_id, pool_id, subject_type, subject_id, permissions, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(cluster_id, pool_id, subject_type, subject_id)
                DO UPDATE SET permissions = ?, updated_at = ?
            """,
                (
                    cluster_id,
                    pool_id,
                    subject_type,
                    subject_id,
                    json.dumps(permissions),
                    now,
                    now,
                    json.dumps(permissions),
                    now,
                ),
            )
            self.conn.commit()
            return True
        except Exception as e:
            logging.error(f"Failed to save pool permission: {e}")
            return False

    def delete_pool_permission(self, cluster_id: str, pool_id: str, subject_type: str, subject_id: str) -> bool:
        """Delete a pool permission"""
        try:
            cursor = self.conn.cursor()
            cursor.execute(
                """
                DELETE FROM pool_permissions
                WHERE cluster_id = ? AND pool_id = ? AND subject_type = ? AND subject_id = ?
            """,
                (cluster_id, pool_id, subject_type, subject_id),
            )
            self.conn.commit()
            return cursor.rowcount > 0
        except Exception as e:
            logging.error(f"Failed to delete pool permission: {e}")
            return False

    def get_user_pool_permissions(
        self, cluster_id: str, username: str, groups: List[str] = None
    ) -> Dict[str, List[str]]:
        """Get all pool permissions for a user (including via group membership)
        Returns: {pool_id: [permissions]}
        """
        cursor = self.conn.cursor()

        # Get direct user permissions
        cursor.execute(
            """
            SELECT pool_id, permissions FROM pool_permissions
            WHERE cluster_id = ? AND subject_type = 'user' AND subject_id = ?
        """,
            (cluster_id, username),
        )

        result = {}
        for row in cursor.fetchall():
            pool_id = row[0]
            perms = json.loads(row[1]) if row[1] else []
            result[pool_id] = perms

        # Get group permissions.
        # #555 - match the group name case-INSENSITIVELY. LDAP/AD (and PVE realms)
        # hand group names back in varying case vs how the grant was typed in the UI, so
        # an exact match silently missed and the pool user saw zero VMs. User grants stay
        # case-sensitive (usernames are). Caveat: two groups differing only by case would
        # collide here — realm group names are unique case-wise in practice.
        if groups:
            for group in groups:
                cursor.execute(
                    """
                    SELECT pool_id, permissions FROM pool_permissions
                    WHERE cluster_id = ? AND subject_type = 'group' AND LOWER(subject_id) = LOWER(?)
                """,
                    (cluster_id, group),
                )

                for row in cursor.fetchall():
                    pool_id = row[0]
                    perms = json.loads(row[1]) if row[1] else []
                    if pool_id in result:
                        # Merge permissions (union)
                        result[pool_id] = list(set(result[pool_id] + perms))
                    else:
                        result[pool_id] = perms

        return result

    def get_user_pool_clusters(self, username: str, groups: List[str] = None) -> List[str]:
        """#555 — distinct cluster_ids where this user (or their groups) holds ANY pool
        permission. Cheap: one indexed SELECT per subject on pool_permissions
        (idx_pool_perms_cluster). Used by the cluster-list + get_user_clusters gates."""
        cursor = self.conn.cursor()
        subjects = [("user", username)]
        for g in groups or []:
            subjects.append(("group", g))
        out = set()
        for stype, sid in subjects:
            # #555 - group names match case-insensitively (see get_user_pool_permissions),
            # users stay exact.
            if stype == "group":
                cursor.execute(
                    "SELECT DISTINCT cluster_id FROM pool_permissions WHERE subject_type = 'group' AND LOWER(subject_id) = LOWER(?)",
                    (sid,),
                )
            else:
                cursor.execute(
                    "SELECT DISTINCT cluster_id FROM pool_permissions WHERE subject_type = ? AND subject_id = ?",
                    (stype, sid),
                )
            for row in cursor.fetchall():
                out.add(row[0])
        return list(out)

    # ========================================
    # KEY ROTATION (HIPAA/ISO Compliance)
    # ========================================

    def rotate_encryption_key(self) -> dict:
        """Rotate the AES-256 encryption key and re-encrypt all data

        This is required for HIPAA/ISO 27001 compliance (periodic key rotation).
        Process:
        1. Generate new AES-256 key
        2. Decrypt all encrypted data with old key
        3. Re-encrypt with new key
        4. Replace old key file

        Returns statistics about the rotation.
        """
        if not ENCRYPTION_AVAILABLE or not self.aesgcm:
            return {"error": "Encryption not available"}

        aes_key_file = os.path.join(CONFIG_DIR, ".ProxmoxVEx_aes256.key")

        # Load old key
        with open(aes_key_file, "rb") as f:
            old_key = f.read()
        old_aesgcm = AESGCM(old_key)

        # Generate new key
        new_key = os.urandom(32)  # 256 bits
        new_aesgcm = AESGCM(new_key)

        stats: dict[str, Any] = {"users_rotated": 0, "clusters_rotated": 0, "sessions_rotated": 0, "errors": []}

        try:
            cursor = self.conn.cursor()

            # 1. Rotate user secrets (totp_secret_encrypted)
            cursor.execute(
                'SELECT username, totp_secret_encrypted FROM users WHERE totp_secret_encrypted IS NOT NULL AND totp_secret_encrypted != ""'
            )
            for row in cursor.fetchall():
                try:
                    encrypted = row["totp_secret_encrypted"]
                    if encrypted and encrypted.startswith("aes256:"):
                        # Decrypt with old key
                        decrypted = self._decrypt_with_key(encrypted, old_aesgcm)
                        # Re-encrypt with new key
                        new_encrypted = self._encrypt_with_key(decrypted, new_aesgcm)
                        # Update
                        cursor.execute(
                            "UPDATE users SET totp_secret_encrypted = ? WHERE username = ?",
                            (new_encrypted, row["username"]),
                        )
                        stats["users_rotated"] += 1
                except Exception as e:
                    stats["errors"].append(f"User {row['username']}: {str(e)}")

            # 2. Rotate cluster credentials
            # (#446 @hugobugomugo) - column was named
            # `password_encrypted` in an early schema, renamed to
            # `pass_encrypted` later, but this rotation code never got the
            # memo and 500'd at the first SELECT with
            # "no such column: password_encrypted". That tanked the entire
            # rotation. Same story for the API-token-secret column.
            cursor.execute(
                'SELECT id, pass_encrypted FROM clusters WHERE pass_encrypted IS NOT NULL AND pass_encrypted != ""'
            )
            for row in cursor.fetchall():
                try:
                    encrypted = row["pass_encrypted"]
                    if encrypted and encrypted.startswith("aes256:"):
                        decrypted = self._decrypt_with_key(encrypted, old_aesgcm)
                        new_encrypted = self._encrypt_with_key(decrypted, new_aesgcm)
                        cursor.execute(
                            "UPDATE clusters SET pass_encrypted = ? WHERE id = ?", (new_encrypted, row["id"])
                        )
                        stats["clusters_rotated"] += 1
                except Exception as e:
                    stats["errors"].append(f"Cluster {row['id']}: {str(e)}")

            # Also rotate SSH keys and API token secrets if present.
            cursor.execute("SELECT id, ssh_key_encrypted, api_token_secret_encrypted FROM clusters")
            for row in cursor.fetchall():
                try:
                    ssh_key = row["ssh_key_encrypted"]
                    api_token = row["api_token_secret_encrypted"]

                    if ssh_key and ssh_key.startswith("aes256:"):
                        decrypted = self._decrypt_with_key(ssh_key, old_aesgcm)
                        new_encrypted = self._encrypt_with_key(decrypted, new_aesgcm)
                        cursor.execute(
                            "UPDATE clusters SET ssh_key_encrypted = ? WHERE id = ?", (new_encrypted, row["id"])
                        )

                    if api_token and api_token.startswith("aes256:"):
                        decrypted = self._decrypt_with_key(api_token, old_aesgcm)
                        new_encrypted = self._encrypt_with_key(decrypted, new_aesgcm)
                        cursor.execute(
                            "UPDATE clusters SET api_token_secret_encrypted = ? WHERE id = ?",
                            (new_encrypted, row["id"]),
                        )
                except Exception as e:
                    stats["errors"].append(f"Cluster secrets {row['id']}: {str(e)}")

            # 3. Rotate pending TOTP secrets — mid-enrollment users (clicked
            # "Setup 2FA" but haven't confirmed) had their column missed by
            # the original rotation. Same shape as the live secret.
            cursor.execute(
                'SELECT username, totp_pending_secret_encrypted FROM users WHERE totp_pending_secret_encrypted IS NOT NULL AND totp_pending_secret_encrypted != ""'
            )
            for row in cursor.fetchall():
                try:
                    encrypted = row["totp_pending_secret_encrypted"]
                    if encrypted and encrypted.startswith("aes256:"):
                        decrypted = self._decrypt_with_key(encrypted, old_aesgcm)
                        new_encrypted = self._encrypt_with_key(decrypted, new_aesgcm)
                        cursor.execute(
                            "UPDATE users SET totp_pending_secret_encrypted = ? WHERE username = ?",
                            (new_encrypted, row["username"]),
                        )
                        stats["users_rotated"] += 1
                except Exception as e:
                    stats["errors"].append(f"User {row['username']} (pending TOTP): {str(e)}")

            # 4. Rotate ESXi storage passwords if any registered. Column on
            # esxi_storages is in fact named `password_encrypted` (cf. schema
            # at db.py:619) — that name matches its own table, unlike the
            # mis-named cluster column above. Table may not exist on older
            # installs, so swallow the OperationalError quietly.
            try:
                cursor.execute(
                    'SELECT id, password_encrypted FROM esxi_storages WHERE password_encrypted IS NOT NULL AND password_encrypted != ""'
                )
                for row in cursor.fetchall():
                    try:
                        encrypted = row["password_encrypted"]
                        if encrypted and encrypted.startswith("aes256:"):
                            decrypted = self._decrypt_with_key(encrypted, old_aesgcm)
                            new_encrypted = self._encrypt_with_key(decrypted, new_aesgcm)
                            cursor.execute(
                                "UPDATE esxi_storages SET password_encrypted = ? WHERE id = ?",
                                (new_encrypted, row["id"]),
                            )
                    except Exception as e:
                        stats["errors"].append(f"ESXi storage {row['id']}: {str(e)}")
            except Exception:
                # esxi_storages may not exist on older installs
                pass

            # Sessions block removed — the `sessions` table tracks
            # (token, username, created_at, expires_at, ip_address, user_agent)
            # and has no encrypted data column on the current schema. The old
            # `data_encrypted` SELECT would also have failed with "no such
            # column" if rotation had ever reached that step (it never did
            # because clusters failed first). stats['sessions_rotated'] stays
            # at 0 for backwards-compat with the UI counter.

            self.conn.commit()

            # 4. Save new key (backup old key first)
            backup_file = aes_key_file + f".backup.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            with open(backup_file, "wb") as f:
                f.write(old_key)
            os.chmod(backup_file, 0o600)

            with open(aes_key_file, "wb") as f:
                f.write(new_key)
            os.chmod(aes_key_file, 0o600)

            # 5. Update in-memory key
            self.aes_key = new_key
            self.aesgcm = new_aesgcm

            stats["success"] = True
            stats["key_backup"] = backup_file
            stats["rotated_at"] = datetime.now().isoformat()

            logging.info(
                f"Key rotation completed: {stats['users_rotated']} users, {stats['clusters_rotated']} clusters, {stats['sessions_rotated']} sessions"
            )

        except Exception as e:
            stats["success"] = False
            stats["error"] = str(e)
            logging.error(f"Key rotation failed: {e}")
            self.conn.rollback()

        return stats

    def _encrypt_with_key(self, data: str, aesgcm) -> str:
        """Encrypt data with specific AESGCM key"""
        if not data:
            return data
        nonce = os.urandom(12)
        ciphertext = aesgcm.encrypt(nonce, data.encode("utf-8"), None)
        encrypted = base64.b64encode(nonce + ciphertext).decode("utf-8")
        return f"aes256:{encrypted}"

    def _decrypt_with_key(self, data: str, aesgcm) -> str:
        """Decrypt data with specific AESGCM key"""
        if not data:
            return data
        if data.startswith("aes256:"):
            encrypted_data = base64.b64decode(data[7:])
            nonce = encrypted_data[:12]
            ciphertext = encrypted_data[12:]
            return aesgcm.decrypt(nonce, ciphertext, None).decode("utf-8")
        return data

    def get_key_info(self) -> dict:
        """Get information about the current encryption key"""
        aes_key_file = os.path.join(CONFIG_DIR, ".ProxmoxVEx_aes256.key")

        if not os.path.exists(aes_key_file):
            return {"exists": False}

        stat = os.stat(aes_key_file)

        # Find backup files
        backups = []
        for f in os.listdir(CONFIG_DIR):
            if f.startswith(".ProxmoxVEx_aes256.key.backup"):
                backup_path = os.path.join(CONFIG_DIR, f)
                backup_stat = os.stat(backup_path)
                backups.append({"filename": f, "created": datetime.fromtimestamp(backup_stat.st_mtime).isoformat()})

        return {
            "exists": True,
            "created": datetime.fromtimestamp(stat.st_ctime).isoformat(),
            "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "algorithm": "AES-256-GCM",
            "key_size_bits": 256,
            "backups": sorted(backups, key=lambda x: x["created"], reverse=True),
        }

    # ========================================
    # AFFINITY RULES OPERATIONS
    # ========================================

    def get_affinity_rules(self, cluster_id: str = None) -> dict:
        """Get affinity rules"""
        cursor = self.conn.cursor()

        if cluster_id:
            cursor.execute("SELECT * FROM affinity_rules WHERE cluster_id = ?", (cluster_id,))
        else:
            cursor.execute("SELECT * FROM affinity_rules")

        rules = {}
        for row in cursor.fetchall():
            cid = row["cluster_id"]
            if cid not in rules:
                rules[cid] = []
            vms_list = json.loads(row["vms"] or "[]")
            rules[cid].append({
                "id": row["id"],
                "name": row["name"],
                "type": row["type"],
                "vms": vms_list,
                "vm_ids": vms_list,  # Frontend expects vm_ids
                "enabled": bool(row["enabled"]),
                "enforce": bool(row["enforce"]) if "enforce" in row else False,
            })

        return rules

    def save_affinity_rule(self, rule_id: str, cluster_id: str, data: dict):
        """Save affinity rule"""
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        vms_data = data.get("vms") or data.get("vm_ids", [])  # handle both field names

        cursor.execute(
            """
            INSERT OR REPLACE INTO affinity_rules
            (id, cluster_id, name, type, vms, enabled, enforce, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM affinity_rules WHERE id = ?), ?))
        """,
            (
                rule_id,
                cluster_id,
                data.get("name", ""),
                data.get("type", "affinity"),
                json.dumps(vms_data),
                1 if data.get("enabled", True) else 0,
                1 if data.get("enforce", False) else 0,
                rule_id,
                now,
            ),
        )
        self.conn.commit()

    def delete_affinity_rule(self, rule_id: str):
        """Delete affinity rule"""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM affinity_rules WHERE id = ?", (rule_id,))
        self.conn.commit()

    def save_all_affinity_rules(self, rules: dict):
        """Save all affinity rules"""
        for cluster_id, cluster_rules in rules.items():
            for rule in cluster_rules:
                self.save_affinity_rule(rule.get("id", str(uuid.uuid4())[:8]), cluster_id, rule)

    # ========================================
    # SERVER SETTINGS OPERATIONS
    # ========================================

    def get_server_settings(self) -> dict:
        """Get all server settings"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM server_settings")

        settings = {}
        for row in cursor.fetchall():
            try:
                settings[row["key"]] = json.loads(row["value"])
            except Exception:
                settings[row["key"]] = row["value"]

        return settings

    def get_server_setting(self, key: str, default=None):
        """Get single server setting"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT value FROM server_settings WHERE key = ?", (key,))
        row = cursor.fetchone()

        if not row:
            return default

        try:
            return json.loads(row["value"])
        except Exception:
            return row["value"]

    def save_server_setting(self, key: str, value):
        """Save server setting - always JSON encode to ensure consistent retrieval"""
        cursor = self.conn.cursor()
        if key == "acme_dns_rfc2136_secret" and value and value != "********":
            value = str(value)
            if not value.startswith(("aes256:", "gAAAA")):
                value = self._encrypt(value)
        # Always JSON encode the value for consistent storage and retrieval
        json_value = json.dumps(value)
        cursor.execute(
            """
            INSERT OR REPLACE INTO server_settings (key, value)
            VALUES (?, ?)
        """,
            (key, json_value),
        )
        self.conn.commit()

    def save_server_settings(self, settings: dict):
        """Save all server settings"""
        for key, value in settings.items():
            self.save_server_setting(key, value)

    # ========================================
    # TENANTS OPERATIONS
    # ========================================

    def get_all_tenants(self) -> list:
        """Get all tenants"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM tenants")

        def _q(row, k, d):
            try:
                v = row[k]
                return v if v is not None else d
            except (IndexError, KeyError):
                return d

        return [
            {
                "id": row["id"],
                "name": row["name"],
                "clusters": json.loads(row["clusters"] or "[]"),
                "quota_max_vms": _q(row, "quota_max_vms", 0),
                "quota_max_cores": _q(row, "quota_max_cores", 0),
                "quota_max_memory_gb": _q(row, "quota_max_memory_gb", 0),
                "quota_enforcement": _q(row, "quota_enforcement", "block") or "block",
            }
            for row in cursor.fetchall()
        ]

    def save_tenant(self, tenant_id: str, data: dict):
        """Save tenant"""
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()

        cursor.execute(
            """
            INSERT OR REPLACE INTO tenants (id, name, clusters, created_at,
                quota_max_vms, quota_max_cores, quota_max_memory_gb, quota_enforcement)
            VALUES (?, ?, ?, COALESCE((SELECT created_at FROM tenants WHERE id = ?), ?),
                ?, ?, ?, ?)
        """,
            (
                tenant_id,
                data.get("name", ""),
                json.dumps(data.get("clusters", [])),
                tenant_id,
                now,
                int(data.get("quota_max_vms", 0) or 0),
                int(data.get("quota_max_cores", 0) or 0),
                int(data.get("quota_max_memory_gb", 0) or 0),
                (data.get("quota_enforcement") or "block"),
            ),
        )
        self.conn.commit()

    def delete_tenant(self, tenant_id: str):
        """Delete tenant"""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM tenants WHERE id = ?", (tenant_id,))
        self.conn.commit()

    def save_all_tenants(self, tenants: list):
        """Save all tenants"""
        for tenant in tenants:
            self.save_tenant(tenant.get("id", str(uuid.uuid4())[:8]), tenant)

    # Generic query methods for custom tables like scripts
    def execute(self, sql: str, params: tuple = ()):
        """Execute SQL statement (CREATE, INSERT, UPDATE, DELETE)"""
        cursor = self.conn.cursor()
        cursor.execute(sql, params)
        self.conn.commit()

    def query(self, sql: str, params: tuple = ()) -> list:
        """Execute SQL query and return all results as list of Row objects"""
        cursor = self.conn.cursor()
        cursor.row_factory = dbcrypto.Row
        cursor.execute(sql, params)
        return cursor.fetchall()

    def query_one(self, sql: str, params: tuple = ()):
        """Execute SQL query and return first result or None"""
        cursor = self.conn.cursor()
        cursor.row_factory = dbcrypto.Row
        cursor.execute(sql, params)
        return cursor.fetchone()

    # Efficient snapshot CRUD (was part of the manager before the split)
    def save_efficient_snapshot(self, snap_data: dict):
        """Save a new efficient snapshot record to the database."""
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute(
            """
            INSERT INTO efficient_snapshots
            (id, cluster_id, node, vmid, vm_type, snapname, description, vg_name,
             disks, total_disk_size_gb, total_snap_alloc_gb, fs_frozen, status,
             error_message, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                snap_data["id"],
                snap_data["cluster_id"],
                snap_data["node"],
                snap_data["vmid"],
                snap_data.get("vm_type", "qemu"),
                snap_data["snapname"],
                snap_data.get("description", ""),
                snap_data["vg_name"],
                json.dumps(snap_data.get("disks", [])),
                snap_data.get("total_disk_size_gb", 0),
                snap_data.get("total_snap_alloc_gb", 0),
                1 if snap_data.get("fs_frozen") else 0,
                snap_data.get("status", "active"),
                snap_data.get("error_message", ""),
                snap_data.get("created_by", ""),
                now,
                now,
            ),
        )
        self.conn.commit()

    def get_efficient_snapshots(self, cluster_id: str, vmid: int) -> list:
        cursor = self.conn.cursor()
        cursor.row_factory = dbcrypto.Row
        cursor.execute(
            "SELECT * FROM efficient_snapshots WHERE cluster_id = ? AND vmid = ? ORDER BY created_at DESC",
            (cluster_id, vmid),
        )
        rows = cursor.fetchall()
        return [self._row_to_efficient_snapshot(row) for row in rows]

    def get_efficient_snapshot(self, snap_id: str) -> dict | None:
        # Return None when the snapshot is not found
        cursor = self.conn.cursor()
        cursor.row_factory = dbcrypto.Row
        cursor.execute("SELECT * FROM efficient_snapshots WHERE id = ?", (snap_id,))
        row = cursor.fetchone()
        return self._row_to_efficient_snapshot(row) if row else None

    def delete_efficient_snapshot(self, snap_id: str):
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM efficient_snapshots WHERE id = ?", (snap_id,))
        self.conn.commit()

    def update_efficient_snapshot_status(self, snap_id: str, status: str, error_message: str = ""):
        # Status can be active/merging/invalidated/error
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        cursor.execute(
            "UPDATE efficient_snapshots SET status = ?, error_message = ?, updated_at = ? WHERE id = ?",
            (status, error_message, now, snap_id),
        )
        self.conn.commit()

    def update_efficient_snapshot_disks(self, snap_id: str, disks: list, total_snap_alloc_gb: float = None):
        cursor = self.conn.cursor()
        now = datetime.now().isoformat()
        if total_snap_alloc_gb is not None:
            cursor.execute(
                "UPDATE efficient_snapshots SET disks = ?, total_snap_alloc_gb = ?, updated_at = ? WHERE id = ?",
                (json.dumps(disks), total_snap_alloc_gb, now, snap_id),
            )
        else:
            cursor.execute(
                "UPDATE efficient_snapshots SET disks = ?, updated_at = ? WHERE id = ?",
                (json.dumps(disks), now, snap_id),
            )
        self.conn.commit()

    def get_all_efficient_snapshots(self, cluster_id: str) -> list:
        """Get all efficient snapshots for a given cluster, ordered by creation date."""
        cursor = self.conn.cursor()
        cursor.row_factory = dbcrypto.Row
        cursor.execute("SELECT * FROM efficient_snapshots WHERE cluster_id = ? ORDER BY created_at DESC", (cluster_id,))
        rows = cursor.fetchall()
        return [self._row_to_efficient_snapshot(row) for row in rows]

    # CVE tracking for scanner improvements
    def upsert_cve(self, cluster_id, node, cve_id, package, severity):
        now = datetime.now().isoformat()
        self.execute(
            """INSERT INTO cve_history (cluster_id, node, cve_id, package, severity, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cluster_id, node, cve_id) DO UPDATE SET
            last_seen = ?, package = ?, severity = ?""",
            (cluster_id, node, cve_id, package, severity, now, now, now, package, severity),
        )

    def get_cve_first_seen(self, cluster_id, node, cve_id):
        row = self.query_one(
            "SELECT first_seen FROM cve_history WHERE cluster_id = ? AND node = ? AND cve_id = ?",
            (cluster_id, node, cve_id),
        )
        return row["first_seen"] if row else None

    def mark_cves_resolved(self, cluster_id, node, active_cve_ids):
        """Mark CVEs as resolved if they no longer show up in scan."""
        now = datetime.now().isoformat()
        if active_cve_ids:
            placeholders = ",".join(["?"] * len(active_cve_ids))
            query = f"UPDATE cve_history SET resolved_at = ? WHERE cluster_id = ? AND node = ? AND resolved_at IS NULL AND cve_id NOT IN ({placeholders})"  # nosec: B608 - only ? placeholders are interpolated
            self.execute(query, [now, cluster_id, node] + list(active_cve_ids))
        else:
            self.execute(
                "UPDATE cve_history SET resolved_at = ? WHERE cluster_id = ? AND node = ? AND resolved_at IS NULL",
                (now, cluster_id, node),
            )

    def _row_to_efficient_snapshot(self, row) -> dict:
        return {
            "id": row["id"],
            "cluster_id": row["cluster_id"],
            "node": row["node"],
            "vmid": row["vmid"],
            "vm_type": row["vm_type"],
            "snapname": row["snapname"],
            "description": row["description"],
            "vg_name": row["vg_name"],
            "disks": json.loads(row["disks"] or "[]"),
            "total_disk_size_gb": row["total_disk_size_gb"],
            "total_snap_alloc_gb": row["total_snap_alloc_gb"],
            "fs_frozen": bool(row["fs_frozen"]),
            "status": row["status"],
            "error_message": row["error_message"],
            "created_by": row["created_by"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }


class ProxmoxVExPGDB(ProxmoxVExDB):
    """ProxmoxVExDB backed by PostgreSQL instead of SQLite/SQLCipher.

    This reuses the same method bodies, but `self.conn` is a
    psycopg2-based connection whose cursor translates SQLite SQL
    to PostgreSQL SQL on the fly. Enable with:
        PROXMOXVEX_DATABASE_URL=postgresql://...  # or PG* env vars
    """

    def __init__(self):
        if self._initialized:
            return
        self.fernet = None
        self.aesgcm = None
        self.aes_key = None
        self._use_pg = True
        self._init_encryption()
        from .db_pg import PGConnection

        dsn = os.environ.get(
            "PROXMOXVEX_DATABASE_URL",
            f"postgresql://{os.environ.get('PGUSER', 'proxmoxvex')}:{os.environ.get('PGPASSWORD', 'proxmoxvex')}"
            f"@{os.environ.get('PGHOST', 'localhost')}:{os.environ.get('PGPORT', '5432')}"
            f"/{os.environ.get('PGDATABASE', 'proxmoxvex')}",
        )
        self._pg_conn = PGConnection(dsn)
        self.db_path = None
        self._init_db()
        self._ensure_converter_tables()
        self._ensure_ids_tables()
        self._ensure_license_context_table()
        self._ensure_tier_plugins_table()
        self._ensure_server_access_tables()
        self._initialized = True
        logging.info("DB initialized (PostgreSQL)")

    @property
    def conn(self):
        return self._pg_conn


# Global database instance
_db = None


def get_db() -> ProxmoxVExPGDB:
    """Get the database instance (singleton).

    PostgreSQL is the only supported backend."""
    global _db
    if _db is None:
        _db = ProxmoxVExPGDB()
    return _db
