# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/globals.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: ProxmoxVEx Globals - Layer 1
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
ProxmoxVEx Globals - Layer 1
Shared mutable state containers. Only plain Python, no ProxmoxVEx imports.
"""

import os
import threading

# All the global state was scattered across 51k lines before, at least now its in one place

# Global cluster managers: cluster_id -> ProxmoxVExManager
cluster_managers = {}

# PBS managers: pbs_id -> PBSManager
pbs_managers = {}

# VMware managers: vmware_id -> VMwareManager
vmware_managers = {}

# Active sessions: session_id -> {user, created_at, last_activity, role}
active_sessions = {}
sessions_lock = threading.Lock()  # SECURITY: protect session dict mutations

# User database (in-memory)
users_db = {}

# Audit log (in-memory cache)
audit_log = []

# Login brute force tracking
login_attempts_by_ip = {}
login_attempts_by_user = {}

# Auth action rate limiting
_auth_action_attempts = {}
_auth_action_lock = threading.Lock()

# Session secret
SESSION_SECRET = None

# API rate limiting state
api_request_counts = {}
api_rate_limit_lock = threading.Lock()

# SSH connection management
# Was 'BoundedSemaphore' because regular Semaphore doesn't raise on over-release
_ssh_semaphore = None  # Initialized in init_ssh_semaphore()
_ssh_active_connections = {"normal": 0, "ha": 0}
_ssh_connection_lock = threading.Lock()


def init_ssh_semaphore(max_concurrent):
    global _ssh_semaphore
    _ssh_semaphore = threading.BoundedSemaphore(max_concurrent)


# Task user tracking
task_ProxmoxVEx_users_cache = {}
task_ProxmoxVEx_users_lock = threading.Lock()

# CORS
_cors_origins_env = os.environ.get("PROXMOXVEX_ALLOWED_ORIGINS", "")
_auto_allowed_origins = set()

# WebSocket clients
ws_clients = {}
ws_clients_lock = threading.Lock()

# SSE tokens and clients
sse_tokens = {}
sse_tokens_lock = threading.Lock()

# WebSocket tokens (single-use, short-lived, replaces session in URL)
ws_tokens = {}
ws_tokens_lock = threading.Lock()
sse_clients = {}
sse_clients_lock = threading.Lock()

# Storage balancing
storage_clusters_config = {}
_storage_config_lock = threading.RLock()
_migration_lock = threading.Lock()
_cache_lock = threading.Lock()
active_auto_migrations = {}

# ESXi storages
esxi_storages = {}

# IP whitelisting
_ip_whitelist_enabled = False
_ip_whitelist = set()
_ip_blacklist = set()

# Custom roles cache
_custom_roles_cache = None
_custom_roles_cache_time = 0

# VM ACLs cache
_vm_acls_cache = None
_vm_acls_cache_time = 0

# Pool membership cache
_pool_cache = {}
_pool_cache_lock = threading.Lock()
_pool_cache_time = {}

# Background thread references
_broadcast_thread = None
_alert_thread = None
_alert_running = False
_alert_last_sent = {}
_notification_handlers = []  # Plugins can register alert handlers here
_password_expiry_thread = None
_password_expiry_running = False
_password_expiry_last_check = {}
_scheduler_thread = None
_scheduler_running = False
_xclb_thread = None
_xclb_running = False

# URL download tracking
_url_downloads = {}

# V2P migrations
_v2p_migrations = {}
