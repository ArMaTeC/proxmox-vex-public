#!/usr/bin/env bash
# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        web/Dev/full-build.sh
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Full Build SH source
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Delegate to the build-and-serve helper so all flags (e.g. --bump) are passed through.
exec "$SCRIPT_DIR/build-and-serve.sh" "$@"
