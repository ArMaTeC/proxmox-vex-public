# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/utils/server_control.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Shared helpers for starting/stopping server processes.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Shared helpers for starting/stopping server processes."""

from __future__ import annotations

import logging
import os
import shutil
import signal
import subprocess
import time


def kill_existing_on_port(port: int, protocol: str = "tcp") -> None:
    """Kill any process already listening on ``port/protocol`` before we bind.

    Tries ``fuser -k <port>/<protocol>`` first, then falls back to ``lsof -t
    -i:<port>`` and terminates the returned PIDs with SIGTERM.  Any failure is
    swallowed and logged at debug level so that missing tools don't break
    startup.
    """
    port_spec = f"{port}/{protocol}"
    killed = False

    fuser = shutil.which("fuser")
    if fuser:
        try:
            fuser_result = subprocess.run([fuser, "-k", port_spec], capture_output=True, timeout=5)
            if fuser_result.returncode == 0:
                logging.info(f"Killed existing process on {port_spec}")
                killed = True
        except Exception as e:
            logging.debug(f"fuser -k {port_spec} failed: {e}")

    lsof = shutil.which("lsof")
    if lsof and not killed:
        try:
            lsof_result = subprocess.run([lsof, "-t", f"-i:{port}"], capture_output=True, text=True, timeout=5)
            pids = [p for p in lsof_result.stdout.strip().splitlines() if p]
            if pids:
                for pid in pids:
                    try:
                        os.kill(int(pid), signal.SIGTERM)
                        logging.info(f"Killed existing process {pid} on {port}")
                    except (ValueError, ProcessLookupError) as e:
                        logging.debug(f"Could not kill PID {pid}: {e}")
                killed = True
        except Exception as e:
            logging.debug(f"lsof cleanup for port {port} failed: {e}")

    if killed:
        time.sleep(0.5)
