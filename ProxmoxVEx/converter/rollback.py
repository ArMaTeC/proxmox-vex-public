# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/converter/rollback.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Rollback helpers for conversion jobs.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Rollback helpers for conversion jobs.
"""

from __future__ import annotations

import logging

from ProxmoxVEx.converter import commands as cmd
from ProxmoxVEx.converter.constants import WorkloadType
from ProxmoxVEx.converter.models import ConversionJob
from ProxmoxVEx.converter.runner import NodeRunner


def destroy_target_if_exists(job: ConversionJob, runner: NodeRunner) -> bool:
    """Stop and destroy a partially created target workload if it exists."""
    if job.target is None:
        return True

    target_id = job.target.id
    if job.target.type == WorkloadType.VM:
        # Stop then destroy
        runner.run(cmd.qm_stop(target_id), timeout=30)
        result = runner.run(
            cmd.qm_destroy(target_id, destroy_unreferenced_disks=True, purge=True),
            timeout=30,
        )
    else:
        runner.run(cmd.pct_stop(target_id), timeout=30)
        result = runner.run(
            cmd.pct_destroy(target_id, destroy_unreferenced_disks=True, purge=True),
            timeout=30,
        )

    if result.ok:
        logging.info("Destroyed partial target %s %s", job.target.type.value, target_id)
        return True
    logging.warning(
        "Could not destroy partial target %s %s: %s",
        job.target.type.value,
        target_id,
        result.stderr,
    )
    return False


def snapshot_source(job: ConversionJob, runner: NodeRunner, snapname: str) -> bool:
    """Create a snapshot of the source workload before conversion."""
    if not job.snapshot_source or job.source is None:
        return False
    if job.snapshot_source:
        source_id = job.source.id
        if job.source.type == WorkloadType.VM:
            result = runner.run(["qm", "snapshot", str(source_id), snapname], timeout=60)
        else:
            result = runner.run(["pct", "snapshot", str(source_id), snapname], timeout=60)
        if result.ok:
            logging.info("Snapshot created for source %s %s", job.source.type.value, source_id)
            return True
        logging.warning(
            "Failed to snapshot source %s %s: %s",
            job.source.type.value,
            source_id,
            result.stderr,
        )
    return False


def rollback_to_snapshot(job: ConversionJob, runner: NodeRunner, snapname: str) -> bool:
    """Rollback the source workload to a previously created snapshot."""
    if not job.snapshot_source or job.source is None:
        return False

    source_id = job.source.id
    if job.source.type == WorkloadType.VM:
        runner.run(cmd.qm_stop(source_id), timeout=30)
        result = runner.run(["qm", "rollback", str(source_id), snapname], timeout=120)
    else:
        runner.run(cmd.pct_stop(source_id), timeout=30)
        result = runner.run(["pct", "rollback", str(source_id), snapname], timeout=120)

    if result.ok:
        logging.info("Rolled back source %s %s to snapshot %s", job.source.type.value, source_id, snapname)
        return True
    logging.warning(
        "Failed to rollback source %s %s: %s",
        job.source.type.value,
        source_id,
        result.stderr,
    )
    return False


def delete_snapshot(job: ConversionJob, runner: NodeRunner, snapname: str) -> bool:
    """Delete a snapshot after a successful conversion."""
    if job.source is None:
        return False
    source_id = job.source.id
    if job.source.type == WorkloadType.VM:
        result = runner.run(["qm", "delsnapshot", str(source_id), snapname], timeout=60)
    else:
        result = runner.run(["pct", "delsnapshot", str(source_id), snapname], timeout=60)
    return result.ok
