#!/bin/bash
# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        update.sh
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Update SH source
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
set -e

# =============================================================================
# Overview
# =============================================================================
# This script updates an existing ProxmoxVEx installation in place. It is
# normally run from the install directory (e.g. /opt/ProxmoxVEx). The workflow:
#
#   1. Detect the original file ownership for restoration after the update.
#   2. Read the currently installed version from version.json.
#   3. Fetch the latest version from GitHub.
#   4. Confirm with the operator unless this is a same-version re-sync.
#   5. Back up the current application files (not config/ssl/logs/backups).
#   6. Download the new code, preferring the branch archive, then a GitHub
#      Trees API fallback, then an essential-files fallback.
#   7. Verify the archive SHA256 (if a checksum file is published).
#   8. Extract and copy the new tree, preserving the original owner.
#   9. Re-apply restrictive permissions to config and ssl.
#  10. Reinstall Python packages from requirements.txt.
#  11. Restart the systemd service when running as root.
#
# It may be run as root (for auto-restart and ownership restore) or as a normal
# user for a manual update.
# =============================================================================

# Terminal output colors.
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# =============================================================================
# GitHub source selector
# Allow testing branches with:  ProxmoxVEx_BRANCH=Testing sudo ./update.sh
# Default remains main so existing workflows keep working.
# =============================================================================
# (#417 follow-up, elektronen): allow updating from a specific
# branch via `ProxmoxVEx_BRANCH=Testing sudo ./update.sh`. Default still main.
GITHUB_BRANCH="${ProxmoxVEx_BRANCH:-main}"

# Raw content and archive URLs for the selected branch.
GITHUB_RAW="https://raw.githubusercontent.com/ArMaTeC/proxmox-vex-public/${GITHUB_BRANCH}"
# Local release mirror placeholder (see speckit for endpoint implementation)
GITHUB_ARCHIVE="https://raw.githubusercontent.com/ArMaTeC/proxmox-vex-public/${GITHUB_BRANCH}/dist/ProxmoxVEx-latest.tar.gz"



# Locate the installation directory and move into it. update.sh is expected to
# live at the root of the installation tree.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Determine the owner of the existing install so we can restore it after the
# update. This matters because the update may be run with sudo and would
# otherwise leave files owned by root.
ORIGINAL_OWNER=""
if [ -d "config" ]; then
    ORIGINAL_OWNER=$(stat -c '%U:%G' config 2>/dev/null || stat -f '%Su:%Sg' config 2>/dev/null)
elif [ -f "cert.pem" ]; then
    ORIGINAL_OWNER=$(stat -c '%U:%G' cert.pem 2>/dev/null || stat -f '%Su:%Sg' cert.pem 2>/dev/null)
elif [ -d "ssl" ]; then
    ORIGINAL_OWNER=$(stat -c '%U:%G' ssl 2>/dev/null || stat -f '%Su:%Sg' ssl 2>/dev/null)
fi

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║               ProxmoxVEx Update Script                       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Warn about privileges and note that root is needed for service auto-restart.
if [ "$EUID" -eq 0 ]; then
    echo -e "${BLUE}Running as root${NC}"
    if [ -n "$ORIGINAL_OWNER" ]; then
        echo -e "  Will restore ownership to: ${GREEN}$ORIGINAL_OWNER${NC}"
    fi
    echo ""
else
    echo -e "${YELLOW}Tip: sudo ./update.sh for auto service restart${NC}"
    echo ""
fi

# Read the currently installed version from the local version.json.
CURRENT_VERSION="unknown"
if [ -f "version.json" ]; then
    CURRENT_VERSION=$(grep -o '"version": *"[^"]*"' version.json | cut -d'"' -f4)
fi
echo -e "Current version: ${BLUE}$CURRENT_VERSION${NC}"

# Fetch the latest version from the branch's version.json on GitHub.
echo -n "Checking for updates... "
LATEST_VERSION=$(curl -s "$GITHUB_RAW/version.json" 2>/dev/null | grep -o '"version": *"[^"]*"' | cut -d'"' -f4)

if [ -z "$LATEST_VERSION" ]; then
    echo -e "${RED}Failed${NC}"
    echo "Could not reach GitHub. Check your internet connection."
    exit 1
fi

echo -e "${GREEN}OK${NC}"
echo -e "Latest version:  ${GREEN}$LATEST_VERSION${NC}"
echo ""

# 2026-06-07: never skip on version-equality. A prior interrupted/partial
# update can leave version.json bumped while some code files stayed stale — and
# the old "already on latest → exit" path then meant `./update.sh` could NEVER
# heal it (you had to know about --force). We now ALWAYS download the archive and
# re-apply the FULL tree, so every run guarantees every file is actually in sync.
RESYNC=0
if [ "$CURRENT_VERSION" == "$LATEST_VERSION" ]; then
    RESYNC=1
    echo -e "${GREEN}✓ Already on $LATEST_VERSION${NC} — re-syncing all files anyway so nothing can be left stale."
    echo ""
fi

# Confirm only for an actual version change. A same-version re-sync just proceeds
# (you explicitly ran the updater and re-applying the full tree is idempotent).
if [ "$RESYNC" -eq 0 ]; then
    echo -e "${YELLOW}Ready to update from $CURRENT_VERSION to $LATEST_VERSION${NC}"
    echo ""
    read -p "Continue? [y/N] " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Update cancelled."
        exit 0
    fi
fi

echo ""
echo -e "${YELLOW}Updating...${NC}"

# Back up the current application files before touching them. User data under
# config/, ssl/, logs/, and backups/ is intentionally left out of the backup.
BACKUP_DIR="${SCRIPT_DIR}/backups/backup_${CURRENT_VERSION}_$(date +%Y%m%d_%H%M%S)"
echo -n "Creating backup in $BACKUP_DIR... "
mkdir -p "$BACKUP_DIR"

# Backup important files (not config - that stays)
[ -f "ProxmoxVEx_multi_cluster.py" ] && cp ProxmoxVEx_multi_cluster.py "$BACKUP_DIR/"
[ -d "ProxmoxVEx" ] && cp -r ProxmoxVEx "$BACKUP_DIR/"
[ -f "web/index.html" ] && mkdir -p "$BACKUP_DIR/web" && cp web/index.html "$BACKUP_DIR/web/"
[ -f "web/index.html.original" ] && cp web/index.html.original "$BACKUP_DIR/web/"
[ -f "version.json" ] && cp version.json "$BACKUP_DIR/"
[ -f "requirements.txt" ] && cp requirements.txt "$BACKUP_DIR/"

echo -e "${GREEN}OK${NC}"

# =============================================================================
# Download the new release
# The primary path is the branch .tar.gz archive from GitHub. If that is not
# available, we fall back to the GitHub Trees API to enumerate every blob in the
# branch and then fetch each file individually. If the Trees API is also
# unreachable, we fall back to a hard-coded list of essential files.
# =============================================================================
echo ""
echo -n "Downloading release archive... "
TMPDIR=$(mktemp -d)
ARCHIVE="$TMPDIR/ProxmoxVEx.tar.gz"

if curl -sfL "$GITHUB_ARCHIVE" -o "$ARCHIVE" 2>/dev/null; then
    echo -e "${GREEN}OK (GitHub)${NC}"
else
    echo -e "${YELLOW}Archive not found, falling back to individual files...${NC}"
    # Fallback: download individual files (for repos without releases)
    download_file() {
        local file=$1
        # never overwrite user data / secrets, even if they show up in the tree
        case "$file" in
            config/*|ssl/*|logs/*|backups/*|.git/*|*.db|*.pem|*.key|*.crt|*.enc) return 0 ;;
        esac
        local dir=$(dirname "$file")
        [ "$dir" != "." ] && mkdir -p "$dir"
        echo -n "  $file... "
        if curl -sfL "$GITHUB_RAW/$file" -o "$file.tmp" 2>/dev/null; then
            mv "$file.tmp" "$file"
            echo -e "${GREEN}OK (GitHub)${NC}"
            return 0
        else
            rm -f "$file.tmp"
            echo -e "${RED}FAILED${NC}"
            return 1
        fi
    }

    # 2026-06-07: fetch the FULL repo tree (GitHub Trees API) so the fallback
    # misses nothing — same completeness as the archive path. version.json's
    # hand-maintained update_files list (no globs) used to drop any file not on
    # it (e.g. a freshly-added sponsor logo). update_files is now only the
    # degraded-degraded path when the Trees API itself is unreachable.
    echo "Fetching file list (full tree)..."
    PACKAGE_FILES=$(curl -s "https://proxmoxvex.local/api/trees/${GITHUB_BRANCH}?recursive=1" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for it in data.get('tree', []):
        if it.get('type') == 'blob':
            print(it['path'])
except:
    pass
" 2>/dev/null)

    if [ -z "$PACKAGE_FILES" ]; then
        # Trees API unreachable → fall back to version.json's update_files list
        PACKAGE_FILES=$(curl -s "$GITHUB_RAW/version.json" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for f in data.get('update_files', []):
        print(f)
except:
    pass
" 2>/dev/null)
    fi

    # Track fallback-download failures so a partial/mixed update aborts and
    # restores from the backup instead of silently leaving a half-written tree
    # (#168, thanks @x86txt). Only the per-file fallback path — the rsync/tar
    # archive path stays as-is (no --delete; it would wipe offline fonts + plugins).
    DOWNLOAD_FAILURES=0

    if [ -n "$PACKAGE_FILES" ]; then
        echo "Downloading file list from manifest..."
        while IFS= read -r pfile; do
            [ -z "$pfile" ] && continue
            if ! download_file "$pfile"; then
                DOWNLOAD_FAILURES=$((DOWNLOAD_FAILURES + 1))
            fi
        done <<< "$PACKAGE_FILES"
    else
        # absolute fallback - at least get the essentials
        echo "No file list found, downloading essentials..."
        for _ess in ProxmoxVEx_multi_cluster.py version.json requirements.txt deploy.sh update.sh web/index.html web/index.html.original; do
            if ! download_file "$_ess"; then
                DOWNLOAD_FAILURES=$((DOWNLOAD_FAILURES + 1))
            fi
        done
    fi

    if [ "$DOWNLOAD_FAILURES" -gt 0 ]; then
        echo -e "${RED}Update aborted: $DOWNLOAD_FAILURES file(s) failed to download.${NC}"
        echo "Restoring from backup..."
        [ -f "$BACKUP_DIR/ProxmoxVEx_multi_cluster.py" ] && cp "$BACKUP_DIR/ProxmoxVEx_multi_cluster.py" . 2>/dev/null || true
        [ -d "$BACKUP_DIR/ProxmoxVEx" ] && cp -r "$BACKUP_DIR/ProxmoxVEx" . 2>/dev/null || true
        [ -d "$BACKUP_DIR/web" ] && { mkdir -p web && cp "$BACKUP_DIR/web/"* web/ 2>/dev/null; } || true
        [ -f "$BACKUP_DIR/version.json" ] && cp "$BACKUP_DIR/version.json" . 2>/dev/null || true
        [ -f "$BACKUP_DIR/requirements.txt" ] && cp "$BACKUP_DIR/requirements.txt" . 2>/dev/null || true
        rm -rf "$TMPDIR"
        exit 1
    fi

    rm -rf "$TMPDIR"

    # Skip to pip install
    ARCHIVE=""
fi

# If an archive was downloaded, verify its SHA256 checksum against the published
# SHA256SUMS file (if any). Missing checksums are treated as a soft warning.
if [ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ]; then
    echo -n "Verifying archive integrity... "
    SHA_FILE="$TMPDIR/SHA256SUMS"
    SHA_VERIFIED=false
    if curl -sfL "$GITHUB_RAW/SHA256SUMS" -o "$SHA_FILE" 2>/dev/null; then
        # SHA256SUMS contains lines like: <hash>  <filename>
        EXPECTED=$(grep -E "${GITHUB_BRANCH}\\.tar\\.gz\$" "$SHA_FILE" 2>/dev/null | awk '{print $1}')
        if [ -n "$EXPECTED" ]; then
            ACTUAL=$(sha256sum "$ARCHIVE" | awk '{print $1}')
            if [ "$EXPECTED" = "$ACTUAL" ]; then
                echo -e "${GREEN}OK (SHA256 verified)${NC}"
                SHA_VERIFIED=true
            else
                echo -e "${RED}CHECKSUM MISMATCH${NC}"
                echo -e "${RED}Expected: $EXPECTED${NC}"
                echo -e "${RED}Got:      $ACTUAL${NC}"
                echo -e "${RED}Archive may be corrupted or tampered with. Aborting.${NC}"
                rm -rf "$TMPDIR"
                exit 1
            fi
        else
            echo -e "${YELLOW}no matching entry in SHA256SUMS${NC}"
        fi
    else
        echo -e "${YELLOW}SHA256SUMS not available (skipping verification)${NC}"
    fi
fi

# Extract the archive to a temp directory, locate the actual source tree (GitHub
# archives often wrap everything in a subdirectory), then copy it over using
# rsync if available, falling back to a tar-pipe.
if [ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ]; then
    echo -n "Extracting archive... "
    # Extract to temp dir first, then copy (safer)
    EXTRACT_DIR="$TMPDIR/extracted"
    mkdir -p "$EXTRACT_DIR"
    tar xzf "$ARCHIVE" -C "$EXTRACT_DIR" 2>/dev/null

    # Find the actual content (might be in a subdirectory)
    CONTENT_DIR="$EXTRACT_DIR"
    if [ ! -f "$CONTENT_DIR/ProxmoxVEx_multi_cluster.py" ]; then
        # Check one level down (GitHub archives often have a subdirectory)
        for subdir in "$EXTRACT_DIR"/*/; do
            if [ -f "${subdir}ProxmoxVEx_multi_cluster.py" ]; then
                CONTENT_DIR="$subdir"
                break
            fi
        done
    fi

    if [ -f "$CONTENT_DIR/ProxmoxVEx_multi_cluster.py" ]; then
        # Copy files, preserving directory structure
        # Skip: config/, ssl/, logs/, backups/, cert.pem, key.pem, .git/
        if command -v rsync &> /dev/null; then
            rsync -a --exclude='config/' --exclude='ssl/' --exclude='logs/' \
                  --exclude='backups/' --exclude='cert.pem' --exclude='key.pem' \
                  --exclude='.git/' --exclude='.gitignore' \
                  "$CONTENT_DIR/" "$SCRIPT_DIR/"
        else
            # Fallback: cp + tar (works without rsync)
            cd "$CONTENT_DIR"
            tar cf - --exclude='config' --exclude='ssl' --exclude='logs' \
                     --exclude='backups' --exclude='cert.pem' --exclude='key.pem' \
                     --exclude='.git' --exclude='.gitignore' \
                     . | tar xf - -C "$SCRIPT_DIR"
            cd "$SCRIPT_DIR"
        fi
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${RED}FAILED${NC}"
        echo "Archive does not contain ProxmoxVEx_multi_cluster.py"
        echo "Restoring from backup..."
        cp "$BACKUP_DIR/ProxmoxVEx_multi_cluster.py" . 2>/dev/null || true
        rm -rf "$TMPDIR"
        exit 1
    fi

    rm -rf "$TMPDIR"
fi

# 2026-06-07: post-copy sanity check - confirm the new version.JSON actually
# landed on disk. Catches a half-applied copy AND a stale CDN tarball (GitHub can
# serve an old cached <branch>.tar.gz as a 200 right after a push).
APPLIED=$(grep -o '"version": *"[^"]*"' version.json 2>/dev/null | cut -d'"' -f4)
if [ -n "$LATEST_VERSION" ] && [ "$APPLIED" != "$LATEST_VERSION" ]; then
    echo -e "${YELLOW}⚠ Post-update check: version.json says '$APPLIED' but expected '$LATEST_VERSION'.${NC}"
    echo -e "${YELLOW}  The download may be incomplete or a stale cache — re-run ./update.sh --force in a minute.${NC}"
fi

# Make scripts executable again after the copy.
chmod +x deploy.sh update.sh 2>/dev/null || true
chmod +x web/Dev/build.sh 2>/dev/null || true

# Fix ownership if running as root so the install goes back to the original user.
if [ "$EUID" -eq 0 ] && [ -n "$ORIGINAL_OWNER" ] && [ "$ORIGINAL_OWNER" != "root:root" ]; then
    echo -n "Fixing file ownership ($ORIGINAL_OWNER)... "
    chown -R "$ORIGINAL_OWNER" ProxmoxVEx_multi_cluster.py version.json requirements.txt 2>/dev/null
    chown -R "$ORIGINAL_OWNER" deploy.sh update.sh 2>/dev/null
    chown -R "$ORIGINAL_OWNER" web/ 2>/dev/null
    [ -d "ProxmoxVEx" ] && chown -R "$ORIGINAL_OWNER" ProxmoxVEx/ 2>/dev/null
    chown -R "$ORIGINAL_OWNER" backups/ 2>/dev/null
    echo -e "${GREEN}OK${NC}"
fi

# Restore restrictive permissions on config and ssl directories.
# These must be 0700 so that only the service user can read the encrypted
# database and SSL private keys. An update that runs as root via sudo can
# inadvertently leave them world-readable if umask is permissive.
if [ -d "config" ]; then
    chmod 700 config 2>/dev/null || true
fi
if [ -d "config/ssl" ]; then
    chmod 700 config/ssl 2>/dev/null || true
elif [ -d "ssl" ]; then
    chmod 700 ssl 2>/dev/null || true
fi

# Install/update Python packages from the new requirements.txt, trying the
# project venv first, then pip3, then user pip.
echo ""
echo -n "Installing Python packages... "

PIP_SUCCESS=false

if [ -f "venv/bin/python" ] && [ "$PIP_SUCCESS" = false ]; then
    ./venv/bin/python -m pip install -q -r requirements.txt 2>/dev/null && PIP_SUCCESS=true
fi

if [ -f "venv/bin/pip" ] && [ "$PIP_SUCCESS" = false ]; then
    ./venv/bin/pip install -q -r requirements.txt 2>/dev/null && PIP_SUCCESS=true
fi

if [ "$EUID" -eq 0 ] && command -v pip3 &> /dev/null && [ "$PIP_SUCCESS" = false ]; then
    pip3 install -q -r requirements.txt 2>/dev/null && PIP_SUCCESS=true
fi

if command -v pip3 &> /dev/null && [ "$PIP_SUCCESS" = false ]; then
    pip3 install -q --user -r requirements.txt 2>/dev/null && PIP_SUCCESS=true
fi

if command -v python3 &> /dev/null && [ "$PIP_SUCCESS" = false ]; then
    python3 -m pip install -q --user -r requirements.txt 2>/dev/null && PIP_SUCCESS=true
fi

if [ "$PIP_SUCCESS" = true ]; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}Couldn't install - run: pip install -r requirements.txt${NC}"
fi

# Restart the systemd service when running as root so the new code takes effect.
echo ""
echo -n "Restarting ProxmoxVEx service... "

if systemctl is-active --quiet ProxmoxVEx 2>/dev/null; then
    if systemctl restart ProxmoxVEx 2>/dev/null; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${YELLOW}Failed - restart manually${NC}"
    fi
elif systemctl is-active --quiet ProxmoxVEx.service 2>/dev/null; then
    if systemctl restart ProxmoxVEx.service 2>/dev/null; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${YELLOW}Failed - restart manually${NC}"
    fi
else
    echo -e "${YELLOW}No systemd service found${NC}"
    echo "  If running manually, restart with: python3 ProxmoxVEx_multi_cluster.py"
fi

# Done!
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Update Complete! ✓                            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Updated to version: ${GREEN}$LATEST_VERSION${NC}"
echo -e "  Backup saved to:    ${BLUE}$BACKUP_DIR${NC}"
echo ""
echo "If something went wrong, restore with:"
echo "  cp -r $BACKUP_DIR/* ."
echo ""
