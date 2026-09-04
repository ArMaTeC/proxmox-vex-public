#!/usr/bin/env bash
# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        web/Dev/build-and-serve.sh
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Build And Serve SH source
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

# Load the local .env so the dev server uses PostgreSQL by default.
# This mirrors the runtime .env loader in ProxmoxVEx/core/db.py.
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    # shellcheck source=.env
    source "$PROJECT_ROOT/.env"
    set +a
fi
# Ensure a PostgreSQL DSN is exported even when .env is missing.
export PROXMOXVEX_DATABASE_URL="${PROXMOXVEX_DATABASE_URL:-postgresql://proxmoxvex:proxmoxvex@localhost:5432/proxmoxvex}"

# Options
BUMP=0
COMMIT=0
CLEAN=0
CLEANUP=0
YES=0
MESSAGE="Build and serve"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
    cat << EOF
Build the ProxmoxVEx frontend bundle and start the debug server.

Usage: $0 [options]

Options:
  --bump          Bump the project version before building
  --commit        Commit the version/changelog files after bumping
  --clean         Clean build artifacts before building
  --cleanup       Clean build artifacts and container runtime leftovers before building
  --yes           Skip confirmation prompts
  --message="..." Changelog message when bumping (default: "$MESSAGE")
  -h, --help      Show this help

Examples:
  $0                          # build and serve
  $0 --bump                   # bump version, build and serve
  $0 --yes --bump --commit    # bump, commit, build and serve
EOF
}

for arg in "$@"; do
    case "$arg" in
        --bump) BUMP=1 ;;
        --commit) COMMIT=1 ;;
        --clean) CLEAN=1 ;;
        --cleanup) CLEANUP=1 ;;
        --yes) YES=1 ;;
        --message=*) MESSAGE="${arg#*=}" ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $arg"; usage; exit 1 ;;
    esac
done

confirm() {
    [ "$YES" -eq 1 ] && return 0
    echo -n "$1 [y/N] "
    read -r REPLY
    [[ "$REPLY" =~ ^[Yy]$ ]]
}

if [ -x "$PROJECT_ROOT/.venv/bin/python" ]; then
    PYTHON="$PROJECT_ROOT/.venv/bin/python"
elif [ -x "$PROJECT_ROOT/venv/bin/python" ]; then
    PYTHON="$PROJECT_ROOT/venv/bin/python"
else
    PYTHON=python3
fi

# Stop any already-running *dev* server so the new build can take the port.
# This pattern deliberately matches --debug only, so it does not kill a
# production/Docker instance (which runs without the --debug flag).
echo -e "${BLUE}→ Stopping any running ProxmoxVEx dev server...${NC}"
pkill -9 -f "ProxmoxVEx_multi_cluster.py --debug" 2>/dev/null || true
sleep 1

# Optionally bump the version before building.
# This follows the project rule: bump before build, commit if requested.
if [ "$BUMP" -eq 1 ]; then
    echo -e "${BLUE}→ Bumping version...${NC}"
    BUMP_ARGS=(--bump patch --message "$MESSAGE")
    [ "$YES" -eq 1 ] && BUMP_ARGS+=(--yes)
    "$PYTHON" scripts/bump-version.py "${BUMP_ARGS[@]}"

    if [ "$COMMIT" -eq 1 ]; then
        echo -e "${BLUE}→ Committing version files...${NC}"
        git add version.json pyproject.toml ProxmoxVEx/constants.py web/src/constants.js CHANGELOG.md
        git commit -m "$(cat <<'EOF'
Bump version and update changelog.

Version bump before build-and-serve run.

EOF
)"
    fi
fi

# Optionally clean build artifacts or container runtime leftovers before building.
# This ensures a full build starts from a clean state and can reclaim disk space.
if [ "$CLEANUP" -eq 1 ]; then
    echo -e "${BLUE}→ Running full cleanup (build + containers)...${NC}"
    CLEANUP_ARGS=("--all")
    [ "$YES" -eq 1 ] && CLEANUP_ARGS+=("--yes")
    bash "$SCRIPT_DIR/cleanup.sh" "${CLEANUP_ARGS[@]}"
elif [ "$CLEAN" -eq 1 ]; then
    echo -e "${BLUE}→ Cleaning build artifacts...${NC}"
    bash "$SCRIPT_DIR/cleanup.sh" --build --yes
fi

# Build the frontend bundle.
echo -e "${BLUE}→ Building frontend bundle...${NC}"
bash web/Dev/build.sh

# Start the debug server in the background so the build completes and the
# caller is not left to start the server manually.
mkdir -p logs
LOG_FILE="$PROJECT_ROOT/logs/dev-server.log"
echo -e "${GREEN}→ Starting debug server on http://127.0.0.1:5000${NC}"
nohup "$PYTHON" ProxmoxVEx_multi_cluster.py --debug > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
disown -h 2>/dev/null || true
# Give the server a moment to either boot or hit an import/port error.
sleep 3
if kill -0 "$SERVER_PID" 2>/dev/null; then
    echo -e "${GREEN}✓ Debug server started (PID $SERVER_PID, logs: $LOG_FILE)${NC}"
else
    echo -e "${RED}✗ Debug server failed to start; see $LOG_FILE${NC}"
    if [ -f "$LOG_FILE" ]; then
        echo "--- last 30 lines of $LOG_FILE ---"
        tail -n 30 "$LOG_FILE"
    fi
    exit 1
fi
