# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/native/truenas/truenas_src/subsystems/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Subsystem collectors (pools, datasets, snapshots,...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Subsystem collectors (pools, datasets, snapshots, shares, replication,
apps_vms, system) implementing the ``Subsystem`` contract from
``core/subsystem.py`` (brief §2).

F1 (this phase): every module is READ-ONLY — ``list``/``read``/``health``
only. Writers (create/update/delete) land per-subsystem starting F2, behind
the dry-run/confirm/audit write-path (brief §5). See
ProxmoxVEx_PLUGIN_TRUENAS_BRIEF.md §1/§2/§4.2 for the phase table and the
TrueNAS method list each module wraps.
"""
