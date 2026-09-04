# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/converter/db.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Database schema helpers for the converter module.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Database schema helpers for the converter module.
Called from ProxmoxVEx.core.db during initialization.
"""

import logging


def ensure_converter_tables(conn):
    """Create converter-related tables if they do not exist."""
    cursor = conn.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS conversion_jobs (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            created_by TEXT NOT NULL,
            operation TEXT NOT NULL,
            status TEXT NOT NULL,
            progress_pct INTEGER DEFAULT 0,
            phase TEXT DEFAULT '',
            source_cluster_id TEXT,
            source_node TEXT,
            source_type TEXT,
            source_id INTEGER,
            target_cluster_id TEXT,
            target_node TEXT,
            target_type TEXT,
            target_id INTEGER,
            target_storage TEXT,
            target_disk_size_gb INTEGER,
            target_disk_format TEXT,
            target_bridge TEXT,
            target_bios TEXT,
            dry_run INTEGER DEFAULT 0,
            replace_target INTEGER DEFAULT 0,
            snapshot_source INTEGER DEFAULT 0,
            rollback_on_failure INTEGER DEFAULT 1,
            destroy_source INTEGER DEFAULT 0,
            headroom_gb INTEGER DEFAULT 1,
            preserve_network INTEGER DEFAULT 0,
            auto_start INTEGER DEFAULT 0,
            detected_os_type TEXT,
            detected_os_distro TEXT,
            detected_os_version TEXT,
            detected_boot_mode TEXT,
            detected_partition_table TEXT,
            detected_has_esp INTEGER DEFAULT 0,
            error_code TEXT,
            error_reason TEXT,
            error_fix TEXT,
            log_tail TEXT,
            full_log_path TEXT,
            started_at TEXT,
            completed_at TEXT,
            depends_on_job_id TEXT
        )
    """
    )

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_conversion_jobs_status ON conversion_jobs(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_conversion_jobs_created_by ON conversion_jobs(created_by)")

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS conversion_presets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            owner TEXT NOT NULL,
            operation TEXT NOT NULL,
            target_storage TEXT,
            target_disk_format TEXT,
            target_bridge TEXT,
            target_bios TEXT,
            headroom_gb INTEGER DEFAULT 1,
            snapshot_source INTEGER DEFAULT 0,
            rollback_on_failure INTEGER DEFAULT 1
        )
    """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS conversion_hooks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            stage TEXT NOT NULL,
            path TEXT NOT NULL,
            enabled INTEGER DEFAULT 1
        )
    """
    )

    logging.info("Converter tables ensured")


# ---------------------------------------------------------------------------
# Preset CRUD helpers
# ---------------------------------------------------------------------------


def create_preset(data: dict) -> str:
    import uuid

    from ProxmoxVEx.core.db import get_db

    db = get_db()
    cursor = db.conn.cursor()
    preset_id = data.get("id") or str(uuid.uuid4())
    cursor.execute(
        """
        INSERT INTO conversion_presets
        (id, name, owner, operation, target_storage, target_disk_format,
         target_bridge, target_bios, headroom_gb, snapshot_source, rollback_on_failure)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            preset_id,
            data.get("name", ""),
            data.get("owner", ""),
            data.get("operation", ""),
            data.get("target_storage", ""),
            data.get("target_disk_format", ""),
            data.get("target_bridge", ""),
            data.get("target_bios", ""),
            data.get("headroom_gb", 1),
            int(bool(data.get("snapshot_source"))),
            int(bool(data.get("rollback_on_failure", True))),
        ),
    )
    db.conn.commit()
    return preset_id


def get_preset(preset_id: str) -> dict | None:
    from ProxmoxVEx.core.db import get_db

    db = get_db()
    cursor = db.conn.cursor()
    cursor.execute("SELECT * FROM conversion_presets WHERE id = ?", (preset_id,))
    row = cursor.fetchone()
    return _preset_row_to_dict(row) if row else None


def list_presets(owner: str | None = None) -> list[dict]:
    from ProxmoxVEx.core.db import get_db

    db = get_db()
    cursor = db.conn.cursor()
    if owner:
        cursor.execute("SELECT * FROM conversion_presets WHERE owner = ? ORDER BY name", (owner,))
    else:
        cursor.execute("SELECT * FROM conversion_presets ORDER BY name")
    return [_preset_row_to_dict(row) for row in cursor.fetchall()]


def update_preset(preset_id: str, data: dict) -> bool:
    from ProxmoxVEx.core.db import get_db

    db = get_db()
    cursor = db.conn.cursor()
    allowed = {
        "name": data.get("name"),
        "operation": data.get("operation"),
        "target_storage": data.get("target_storage"),
        "target_disk_format": data.get("target_disk_format"),
        "target_bridge": data.get("target_bridge"),
        "target_bios": data.get("target_bios"),
        "headroom_gb": data.get("headroom_gb"),
        "snapshot_source": int(bool(data.get("snapshot_source"))) if "snapshot_source" in data else None,
        "rollback_on_failure": int(bool(data.get("rollback_on_failure"))) if "rollback_on_failure" in data else None,
    }
    fields = [(k, v) for k, v in allowed.items() if v is not None]
    if not fields:
        return False
    sets = ", ".join(f"{k} = ?" for k, _ in fields)
    values = [v for _, v in fields] + [preset_id]
    query = f"UPDATE conversion_presets SET {sets} WHERE id = ?"  # nosec: B608 - column names come from a hardcoded allowlist and values use ? placeholders
    cursor.execute(query, values)
    db.conn.commit()
    return cursor.rowcount > 0


def delete_preset(preset_id: str) -> bool:
    from ProxmoxVEx.core.db import get_db

    db = get_db()
    cursor = db.conn.cursor()
    cursor.execute("DELETE FROM conversion_presets WHERE id = ?", (preset_id,))
    db.conn.commit()
    return cursor.rowcount > 0


def _preset_row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "owner": row["owner"],
        "operation": row["operation"],
        "target_storage": row["target_storage"],
        "target_disk_format": row["target_disk_format"],
        "target_bridge": row["target_bridge"],
        "target_bios": row["target_bios"],
        "headroom_gb": row["headroom_gb"],
        "snapshot_source": bool(row["snapshot_source"]),
        "rollback_on_failure": bool(row["rollback_on_failure"]),
    }


# ---------------------------------------------------------------------------
# Hook CRUD helpers
# ---------------------------------------------------------------------------


def create_hook(data: dict) -> str:
    import uuid

    from ProxmoxVEx.core.db import get_db

    db = get_db()
    cursor = db.conn.cursor()
    hook_id = data.get("id") or str(uuid.uuid4())
    cursor.execute(
        "INSERT INTO conversion_hooks (id, name, stage, path, enabled) VALUES (?, ?, ?, ?, ?)",
        (
            hook_id,
            data.get("name", ""),
            data.get("stage", ""),
            data.get("path", ""),
            int(bool(data.get("enabled", True))),
        ),
    )
    db.conn.commit()
    return hook_id


def get_hook(hook_id: str) -> dict | None:
    from ProxmoxVEx.core.db import get_db

    db = get_db()
    cursor = db.conn.cursor()
    cursor.execute("SELECT * FROM conversion_hooks WHERE id = ?", (hook_id,))
    row = cursor.fetchone()
    return _hook_row_to_dict(row) if row else None


def list_hooks(enabled_only: bool = False) -> list[dict]:
    from ProxmoxVEx.core.db import get_db

    db = get_db()
    cursor = db.conn.cursor()
    if enabled_only:
        cursor.execute("SELECT * FROM conversion_hooks WHERE enabled = 1 ORDER BY stage, name")
    else:
        cursor.execute("SELECT * FROM conversion_hooks ORDER BY stage, name")
    return [_hook_row_to_dict(row) for row in cursor.fetchall()]


def update_hook(hook_id: str, data: dict) -> bool:
    from ProxmoxVEx.core.db import get_db

    db = get_db()
    cursor = db.conn.cursor()
    # Static SQL with bound parameters only; COALESCE preserves existing values
    # when a field is not supplied, so the query string is never built from user input.
    name = data.get("name") if "name" in data else None
    stage = data.get("stage") if "stage" in data else None
    path = data.get("path") if "path" in data else None
    enabled = int(bool(data["enabled"])) if "enabled" in data else None

    if all(v is None for v in (name, stage, path, enabled)):
        return False

    cursor.execute(
        "UPDATE conversion_hooks SET "
        "name = COALESCE(?, name), "
        "stage = COALESCE(?, stage), "
        "path = COALESCE(?, path), "
        "enabled = COALESCE(?, enabled) "
        "WHERE id = ?",
        (name, stage, path, enabled, hook_id),
    )
    db.conn.commit()
    return cursor.rowcount > 0


def delete_hook(hook_id: str) -> bool:
    from ProxmoxVEx.core.db import get_db

    db = get_db()
    cursor = db.conn.cursor()
    cursor.execute("DELETE FROM conversion_hooks WHERE id = ?", (hook_id,))
    db.conn.commit()
    return cursor.rowcount > 0


def _hook_row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "stage": row["stage"],
        "path": row["path"],
        "enabled": bool(row["enabled"]),
    }
