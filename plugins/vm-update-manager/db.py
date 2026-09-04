# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-update-manager/db.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Db PY source
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
import logging
from datetime import datetime, timezone

from ProxmoxVEx.core.db import get_db

from . import models


def _now():
    # Use timezone-aware UTC so timestamps match engine.py/routes.py and sort
    # consistently whether the backend is SQLite or PostgreSQL.
    return datetime.now(timezone.utc).isoformat()


def ensure_tables(conn):
    """Create all plugin tables if they do not exist."""
    cursor = conn.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS vm_update_guests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cluster_id TEXT NOT NULL,
            guest_type TEXT NOT NULL DEFAULT 'vm',
            vmid INTEGER NOT NULL,
            name TEXT NOT NULL,
            ip_host TEXT NOT NULL,
            ssh_port INTEGER NOT NULL DEFAULT 22,
            os_family TEXT NOT NULL DEFAULT 'unknown',
            driver TEXT NOT NULL DEFAULT 'ssh',
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_check_at TEXT DEFAULT '',
            last_status TEXT DEFAULT '',
            UNIQUE(cluster_id, vmid)
        )
    """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_vm_update_guests_cluster ON vm_update_guests(cluster_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_vm_update_guests_vmid ON vm_update_guests(vmid)")

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS vm_update_credentials (
            guest_id BIGINT PRIMARY KEY,
            username TEXT NOT NULL,
            password_enc TEXT NOT NULL,
            auth_type TEXT NOT NULL DEFAULT 'password',
            ssh_key_enc TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
        )
    """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_vm_update_credentials_guest ON vm_update_credentials(guest_id)")

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS vm_update_policies (
            guest_id BIGINT PRIMARY KEY,
            schedule_enabled INTEGER NOT NULL DEFAULT 0,
            schedule_cron TEXT NOT NULL DEFAULT '',
            auto_apply INTEGER NOT NULL DEFAULT 0,
            dry_run INTEGER NOT NULL DEFAULT 1,
            notify_on_failure INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
        )
    """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS vm_update_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guest_id INTEGER NOT NULL,
            job_type TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            error TEXT,
            output TEXT,
            packages_found INTEGER NOT NULL DEFAULT 0,
            packages_applied INTEGER NOT NULL DEFAULT 0
        )
    """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_vm_update_jobs_guest ON vm_update_jobs(guest_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_vm_update_jobs_started ON vm_update_jobs(started_at)")

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS vm_update_packages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            current_version TEXT NOT NULL,
            available_version TEXT NOT NULL,
            is_security INTEGER NOT NULL DEFAULT 0
        )
    """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_vm_update_packages_job ON vm_update_packages(job_id)")

    # Add last-status columns to older installs that do not already have them.
    # Fresh installs have the columns in the CREATE TABLE above, so check first
    # to avoid a failed ALTER TABLE aborting the PostgreSQL transaction.
    cursor.execute("PRAGMA table_info(vm_update_guests)")
    _guest_cols = {c[1] for c in cursor.fetchall()}
    if "last_check_at" not in _guest_cols:
        cursor.execute("ALTER TABLE vm_update_guests ADD COLUMN last_check_at TEXT DEFAULT ''")
    if "last_status" not in _guest_cols:
        cursor.execute("ALTER TABLE vm_update_guests ADD COLUMN last_status TEXT DEFAULT ''")

    conn.commit()
    logging.info("[vm-update-manager] tables ensured")


def _row_to_guest(row):
    return models.Guest(
        id=row["id"],
        cluster_id=row["cluster_id"],
        guest_type=row["guest_type"],
        vmid=row["vmid"],
        name=row["name"],
        ip_host=row["ip_host"],
        ssh_port=row["ssh_port"],
        os_family=row["os_family"],
        driver=row["driver"],
        enabled=bool(row["enabled"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        last_check_at=dict(row).get("last_check_at") or "",
        last_status=dict(row).get("last_status") or "",
    )


def _row_to_credential(row):
    return models.Credential(
        guest_id=row["guest_id"],
        username=row["username"],
        password_enc=row["password_enc"],
        auth_type=row["auth_type"],
        ssh_key_enc=row["ssh_key_enc"],
        updated_at=row["updated_at"],
    )


def _row_to_policy(row):
    return models.Policy(
        guest_id=row["guest_id"],
        schedule_enabled=bool(row["schedule_enabled"]),
        schedule_cron=row["schedule_cron"],
        auto_apply=bool(row["auto_apply"]),
        dry_run=bool(row["dry_run"]),
        notify_on_failure=bool(row["notify_on_failure"]),
        updated_at=row["updated_at"],
    )


def list_guests(cluster_id=None):
    db = get_db()
    if cluster_id:
        rows = db.query(
            "SELECT * FROM vm_update_guests WHERE cluster_id = ? ORDER BY name",
            (cluster_id,),
        )
    else:
        rows = db.query("SELECT * FROM vm_update_guests ORDER BY name", ())
    return [_row_to_guest(row) for row in rows]


def get_guest(guest_id):
    db = get_db()
    row = db.query_one("SELECT * FROM vm_update_guests WHERE id = ?", (guest_id,))
    return _row_to_guest(row) if row else None


def _guest_exists(cluster_id, vmid, exclude_id=None):
    db = get_db()
    if exclude_id:
        row = db.query_one(
            "SELECT id FROM vm_update_guests WHERE cluster_id = ? AND vmid = ? AND id != ?",
            (cluster_id, vmid, exclude_id),
        )
    else:
        row = db.query_one(
            "SELECT id FROM vm_update_guests WHERE cluster_id = ? AND vmid = ?",
            (cluster_id, vmid),
        )
    return row is not None


def create_guest(data, username, password_enc, auth_type="password", ssh_key_enc=""):
    db = get_db()
    cursor = db.conn.cursor()
    now = _now()
    try:
        cursor.execute(
            """
            INSERT INTO vm_update_guests
            (cluster_id, guest_type, vmid, name, ip_host, ssh_port, os_family, driver, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                data["cluster_id"],
                data["guest_type"],
                data["vmid"],
                data["name"],
                data["ip_host"],
                data["ssh_port"],
                data["os_family"],
                "ssh",
                data["enabled"],
                now,
                now,
            ),
        )
        guest_id = cursor.lastrowid
        cursor.execute(
            """
            INSERT INTO vm_update_credentials
            (guest_id, username, password_enc, auth_type, ssh_key_enc, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """,
            (guest_id, username, password_enc or "", auth_type, ssh_key_enc or "", now),
        )
        cursor.execute(
            """
            INSERT INTO vm_update_policies
            (guest_id, schedule_enabled, schedule_cron, auto_apply, dry_run, notify_on_failure, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
            (
                guest_id,
                data["schedule_enabled"],
                data["schedule_cron"],
                data["auto_apply"],
                data["dry_run"],
                data["notify_on_failure"],
                now,
            ),
        )
        db.conn.commit()
        return guest_id
    except Exception:
        db.conn.rollback()
        raise


def update_guest(guest_id, data, username, password_enc=None, auth_type=None, ssh_key_enc=None):
    db = get_db()
    cursor = db.conn.cursor()
    now = _now()
    try:
        cursor.execute(
            """
            UPDATE vm_update_guests
            SET cluster_id = ?, guest_type = ?, vmid = ?, name = ?, ip_host = ?, ssh_port = ?,
                os_family = ?, enabled = ?, updated_at = ?
            WHERE id = ?
        """,
            (
                data["cluster_id"],
                data["guest_type"],
                data["vmid"],
                data["name"],
                data["ip_host"],
                data["ssh_port"],
                data["os_family"],
                data["enabled"],
                now,
                guest_id,
            ),
        )
        cred_sets = ["username = ?", "updated_at = ?"]
        cred_values = [username, now]
        if auth_type:
            cred_sets.append("auth_type = ?")
            cred_values.append(auth_type)
        if password_enc:
            cred_sets.append("password_enc = ?")
            cred_values.append(password_enc)
        if ssh_key_enc:
            cred_sets.append("ssh_key_enc = ?")
            cred_values.append(ssh_key_enc)
        cred_values.append(guest_id)
        query = f"UPDATE vm_update_credentials SET {', '.join(cred_sets)} WHERE guest_id = ?"  # nosec: B608 - fields from allowlist
        cursor.execute(query, cred_values)
        cursor.execute(
            """
            UPDATE vm_update_policies
            SET schedule_enabled = ?, schedule_cron = ?, auto_apply = ?, dry_run = ?, notify_on_failure = ?, updated_at = ?
            WHERE guest_id = ?
        """,
            (
                data["schedule_enabled"],
                data["schedule_cron"],
                data["auto_apply"],
                data["dry_run"],
                data["notify_on_failure"],
                now,
                guest_id,
            ),
        )
        db.conn.commit()
        return cursor.rowcount > 0
    except Exception:
        db.conn.rollback()
        raise


def update_guest_status(guest_id, last_status, last_check_at=None):
    db = get_db()
    try:
        if last_check_at:
            db.execute(
                "UPDATE vm_update_guests SET last_status = ?, last_check_at = ? WHERE id = ?",
                (last_status, last_check_at, guest_id),
            )
        else:
            db.execute(
                "UPDATE vm_update_guests SET last_status = ? WHERE id = ?",
                (last_status, guest_id),
            )
        db.conn.commit()
    except Exception:
        db.conn.rollback()
        raise


def delete_guest(guest_id):
    db = get_db()
    cursor = db.conn.cursor()
    try:
        cursor.execute(
            "DELETE FROM vm_update_packages WHERE job_id IN (SELECT id FROM vm_update_jobs WHERE guest_id = ?)",
            (guest_id,),
        )
        cursor.execute("DELETE FROM vm_update_jobs WHERE guest_id = ?", (guest_id,))
        cursor.execute("DELETE FROM vm_update_credentials WHERE guest_id = ?", (guest_id,))
        cursor.execute("DELETE FROM vm_update_policies WHERE guest_id = ?", (guest_id,))
        cursor.execute("DELETE FROM vm_update_guests WHERE id = ?", (guest_id,))
        db.conn.commit()
        return cursor.rowcount > 0
    except Exception:
        db.conn.rollback()
        raise


def get_credential(guest_id):
    db = get_db()
    row = db.query_one("SELECT * FROM vm_update_credentials WHERE guest_id = ?", (guest_id,))
    return _row_to_credential(row) if row else None


def get_policy(guest_id):
    db = get_db()
    row = db.query_one("SELECT * FROM vm_update_policies WHERE guest_id = ?", (guest_id,))
    return _row_to_policy(row) if row else None


def get_credentials_for_guests(guest_ids):
    """Return a dict mapping guest_id -> Credential for the given IDs."""
    if not guest_ids:
        return {}
    db = get_db()
    placeholders = ",".join("?" * len(guest_ids))
    # nosec: B608 - placeholders are generated from the input list length, not user-controlled identifiers.
    rows = db.query(
        f"SELECT * FROM vm_update_credentials WHERE guest_id IN ({placeholders})",
        tuple(guest_ids),
    )
    return {row["guest_id"]: _row_to_credential(row) for row in rows}


def get_policies_for_guests(guest_ids):
    """Return a dict mapping guest_id -> Policy for the given IDs."""
    if not guest_ids:
        return {}
    db = get_db()
    placeholders = ",".join("?" * len(guest_ids))
    # nosec: B608 - placeholders are generated from the input list length, not user-controlled identifiers.
    rows = db.query(
        f"SELECT * FROM vm_update_policies WHERE guest_id IN ({placeholders})",
        tuple(guest_ids),
    )
    return {row["guest_id"]: _row_to_policy(row) for row in rows}


def get_last_checks_for_guests(guest_ids):
    """Return a dict mapping guest_id -> MAX(completed_at) for completed jobs."""
    if not guest_ids:
        return {}
    db = get_db()
    placeholders = ",".join("?" * len(guest_ids))
    # nosec: B608 - placeholders are generated from the input list length, not user-controlled identifiers.
    rows = db.query(
        f"SELECT guest_id, MAX(completed_at) AS last_run FROM vm_update_jobs "
        f"WHERE guest_id IN ({placeholders}) AND status = 'completed' GROUP BY guest_id",
        tuple(guest_ids),
    )
    return {row["guest_id"]: (row["last_run"] or "") for row in rows}


def get_guest_with_credential(guest_id):
    """Return (guest, credential) for internal driver use."""
    guest = get_guest(guest_id)
    if not guest:
        return None, None
    return guest, get_credential(guest_id)


def _row_to_job(row):
    return models.Job(
        id=row["id"],
        guest_id=row["guest_id"],
        job_type=row["job_type"],
        status=row["status"],
        started_at=row["started_at"] or "",
        completed_at=row["completed_at"] or "",
        error=row["error"] or "",
        output=row["output"] or "",
        packages_found=row["packages_found"] or 0,
        packages_applied=row["packages_applied"] or 0,
    )


def _row_to_package(row):
    return models.Package(
        id=row["id"],
        job_id=row["job_id"],
        name=row["name"],
        current_version=row["current_version"],
        available_version=row["available_version"],
        is_security=bool(row["is_security"]),
    )


def create_job(guest_id, job_type, status="pending"):
    db = get_db()
    cursor = db.conn.cursor()
    now = _now()
    cursor.execute(
        """
        INSERT INTO vm_update_jobs (guest_id, job_type, status, started_at, completed_at, error, output, packages_found, packages_applied)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (guest_id, job_type, status, now, "", "", "", 0, 0),
    )
    db.conn.commit()
    return cursor.lastrowid


def update_job(
    job_id, status=None, completed_at=None, error=None, output=None, packages_found=None, packages_applied=None
):
    db = get_db()
    cursor = db.conn.cursor()
    sets = []
    values = []
    if status is not None:
        sets.append("status = ?")
        values.append(status)
    if completed_at is not None:
        sets.append("completed_at = ?")
        values.append(completed_at)
    if error is not None:
        sets.append("error = ?")
        values.append(error)
    if output is not None:
        sets.append("output = ?")
        values.append(output)
    if packages_found is not None:
        sets.append("packages_found = ?")
        values.append(packages_found)
    if packages_applied is not None:
        sets.append("packages_applied = ?")
        values.append(packages_applied)
    if not sets:
        return False
    values.append(job_id)
    query = f"UPDATE vm_update_jobs SET {', '.join(sets)} WHERE id = ?"  # nosec: B608 - fields from allowlist
    cursor.execute(query, values)
    db.conn.commit()
    return cursor.rowcount > 0


def get_job(job_id):
    db = get_db()
    row = db.query_one("SELECT * FROM vm_update_jobs WHERE id = ?", (job_id,))
    return _row_to_job(row) if row else None


def list_jobs(guest_id=None, limit=50, offset=0):
    db = get_db()
    if guest_id:
        rows = db.query(
            "SELECT * FROM vm_update_jobs WHERE guest_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?",
            (guest_id, limit, offset),
        )
    else:
        rows = db.query(
            "SELECT * FROM vm_update_jobs ORDER BY started_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
    return [_row_to_job(row) for row in rows]


def save_packages(job_id, packages):
    db = get_db()
    cursor = db.conn.cursor()
    try:
        for pkg in packages:
            cursor.execute(
                """
                INSERT INTO vm_update_packages (job_id, name, current_version, available_version, is_security)
                VALUES (?, ?, ?, ?, ?)
            """,
                (job_id, pkg.name, pkg.current_version, pkg.available_version, 1 if pkg.is_security else 0),
            )
        db.conn.commit()
    except Exception:
        db.conn.rollback()
        raise


def list_packages(job_id):
    db = get_db()
    rows = db.query(
        "SELECT * FROM vm_update_packages WHERE job_id = ? ORDER BY name",
        (job_id,),
    )
    return [_row_to_package(row) for row in rows]


def list_enabled_schedules():
    db = get_db()
    rows = db.query(
        """
        SELECT p.* FROM vm_update_policies p
        JOIN vm_update_guests g ON p.guest_id = g.id
        WHERE p.schedule_enabled = 1 AND g.enabled = 1
    """,
        (),
    )
    return [_row_to_policy(row) for row in rows]


def get_last_check(guest_id):
    db = get_db()
    row = db.query_one(
        """
        SELECT MAX(completed_at) AS last_run
        FROM vm_update_jobs
        WHERE guest_id = ? AND job_type = 'check' AND status = 'completed'
    """,
        (guest_id,),
    )
    return row["last_run"] if row and row["last_run"] else None
