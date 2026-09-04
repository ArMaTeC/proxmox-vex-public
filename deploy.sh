#!/bin/bash
# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        deploy.sh
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Deploy SH source
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
set -e

# =============================================================================
# Overview
# =============================================================================
# This script performs a complete installation of the ProxmoxVEx management
# platform on a Debian/Ubuntu-style host. It must be run as root. The main
# phases are:
#
#   1. Parse command-line options (--port, --no-interactive, --no-offline).
#   2. Verify the environment (root, internet reachability to GitHub).
#   3. Install system packages required by the application.
#   4. Create a dedicated service user and the /opt/ProxmoxVEx directory tree.
#   5. Acquire the application source (local checkout or shallow GitHub clone).
#   6. Build a Python virtual environment and install Python dependencies.
#   7. Optionally download static assets so the UI works offline.
#   8. Prompt for (or default to) the HTTP listening port.
#   9. Create the systemd unit, sudoers rules, and helper binaries.
#  10. Bootstrap the master encryption key outside the config directory.
#  11. Start the service and persist the selected port in SQLite.
# =============================================================================

# =============================================================================
# Terminal output color definitions
# These are used by the print_* helpers below to make the installer readable.
# =============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# =============================================================================
# Deployment configuration
# INSTALL_DIR: where the application will live on disk.
# SERVICE_USER / SERVICE_GROUP: unprivileged account used by systemd.
# GITHUB_REPO: canonical upstream repository for curl-pipe installs.
# GITHUB_BRANCH: branch selector. Users can override via the ProxmoxVEx_BRANCH
#                 environment variable (e.g. for testing a feature branch).
# PYTHON_FILE: the main Python entry point copied into INSTALL_DIR.
# =============================================================================
INSTALL_DIR="/opt/ProxmoxVEx"
SERVICE_USER="ProxmoxVEx"
SERVICE_GROUP="ProxmoxVEx"
GITHUB_REPO="https://proxmoxvex.local/source.git"
# MK May 2026 (#417 follow-up, elektronen): allow installing from a specific
# branch via `ProxmoxVEx_BRANCH=Testing curl ... | sudo bash`. Default still main
# so existing curl-pipe invocations don't change behaviour.
GITHUB_BRANCH="${ProxmoxVEx_BRANCH:-main}"
PYTHON_FILE="ProxmoxVEx_multi_cluster.py"

# =============================================================================
# Default install-time options
# ACCESS_PORT: default HTTPS port for the web UI.
# INTERACTIVE: whether to ask the user for port selection.
# DOWNLOAD_OFFLINE: whether to pre-fetch CDN assets before first run.
# CANARY: whether to install the canary template pack for staged rollouts.
# CANARY_REPLICATED: whether to install the canary replicated service pack.
# CANARY_SIGNED: whether to stage the canary signed image pack.
# CANARY_VULNERABILITY_SCAN: whether to stage the canary vulnerability scan pack.
# CANARY_CI: whether to stage the canary CI pipeline pack.
# CANARY_CD: whether to stage the canary CD pipeline pack.
# CANARY_UPGRADE: whether to stage the canary upgrade path pack.
# CANARY_ROLLBACK: whether to stage the canary rollback path pack.
# ROLLING_BASE: whether to stage the rolling base chart pack.
# ROLLING_MULTI_ARCH: whether to stage the rolling multi-arch build pack.
# ROLLING_TEMPLATE: whether to stage the rolling template pack.
# ROLLING_REPLICATED: whether to stage the rolling replicated service pack.
# ROLLING_SIGNED: whether to stage the rolling signed images pack.
# ROLLING_VULNERABILITY: whether to stage the rolling vulnerability scan pack.
# ROLLING_CI: whether to stage the rolling CI pipeline pack.
# ROLLING_CD: whether to stage the rolling CD pipeline pack.
# ROLLING_UPGRADE: whether to stage the rolling upgrade path pack.
# ROLLING_ROLLBACK: whether to stage the rolling rollback path pack.
# AIRGAP_BASE: whether to stage the air-gap base chart pack.
# AIRGAP_MULTI_ARCH: whether to stage the air-gap multi-arch build pack.
# HA_UPGRADE: whether to stage the HA upgrade path pack.
# HA_ROLLBACK: whether to stage the HA rollback path pack.
# =============================================================================
ACCESS_PORT=5000
INTERACTIVE=true
DOWNLOAD_OFFLINE=true
CANARY=false
CANARY_REPLICATED=false
CANARY_SIGNED=false
CANARY_VULNERABILITY_SCAN=false
CANARY_CI=false
CANARY_CD=false
CANARY_UPGRADE=false
CANARY_ROLLBACK=false
ROLLING_BASE=false
ROLLING_MULTI_ARCH=false
ROLLING_TEMPLATE=false
ROLLING_REPLICATED=false
ROLLING_SIGNED=false
ROLLING_VULNERABILITY=false
ROLLING_CI=false
ROLLING_CD=false
ROLLING_UPGRADE=false
ROLLING_ROLLBACK=false
AIRGAP_BASE=false
AIRGAP_MULTI_ARCH=false
SINGLE_NODE_BASE=false
HA_UPGRADE=false
HA_ROLLBACK=false

# =============================================================================
# Parse Arguments
# Supported flags:
#   --port=PORT          Override the default listening port.
#   --no-interactive       Skip all prompts and use ACCESS_PORT as given.
#   --no-offline           Do not run the offline asset downloader.
#   --help / -h            Show usage and exit.
# =============================================================================
for arg in "$@"; do
    case $arg in
        --port=*)
            ACCESS_PORT="${arg#*=}"
            ;;
        --no-interactive)
            INTERACTIVE=false
            ;;
        --no-offline)
            DOWNLOAD_OFFLINE=false
            ;;
        --canary)
            CANARY=true
            ;;
        --canary-replicated)
            CANARY_REPLICATED=true
            ;;
        --canary-signed)
            CANARY_SIGNED=true
            ;;
        --canary-vulnerability-scan)
            CANARY_VULNERABILITY_SCAN=true
            ;;
        --canary-ci)
            CANARY_CI=true
            ;;
        --canary-cd)
            CANARY_CD=true
            ;;
        --canary-upgrade)
            CANARY_UPGRADE=true
            ;;
        --canary-rollback)
            CANARY_ROLLBACK=true
            ;;
        --rolling-base-chart)
            ROLLING_BASE=true
            ;;
        --rolling-multi-arch-build)
            ROLLING_MULTI_ARCH=true
            ;;
        --rolling-template-pack)
            ROLLING_TEMPLATE=true
            ;;
        --rolling-replicated-service)
            ROLLING_REPLICATED=true
            ;;
        --rolling-signed-images)
            ROLLING_SIGNED=true
            ;;
        --rolling-vulnerability-scan)
            ROLLING_VULNERABILITY=true
            ;;
        --rolling-ci)
            ROLLING_CI=true
            ;;
        --rolling-cd)
            ROLLING_CD=true
            ;;
        --rolling-upgrade)
            ROLLING_UPGRADE=true
            ;;
        --rolling-rollback)
            ROLLING_ROLLBACK=true
            ;;
        --airgap-base-chart)
            AIRGAP_BASE=true
            ;;
        --airgap-multi-arch-build)
            AIRGAP_MULTI_ARCH=true
            ;;
        --single-node-base-chart)
            SINGLE_NODE_BASE=true
            ;;
        --ha-upgrade)
            HA_UPGRADE=true
            ;;
        --ha-rollback)
            HA_ROLLBACK=true
            ;;
        --help|-h)
            echo "ProxmoxVEx Deploy Script"
            echo ""
            echo "Usage: sudo ./deploy.sh [options]"
            echo ""
            echo "Options:"
            echo "  --port=PORT       Set web port (default: 5000, use 443 for HTTPS)"
            echo "  --no-interactive  Skip interactive prompts"
            echo "  --no-offline      Skip offline assets download"
            echo "  --canary          Install the canary template pack for staged rollouts"
            echo "  --canary-replicated  Install the canary replicated service template pack"
            echo "  --canary-signed   Stage the canary signed image pack"
            echo "  --canary-vulnerability-scan  Stage the canary vulnerability scan pack"
            echo "  --canary-ci       Stage the canary CI pipeline pack"
            echo "  --canary-cd       Stage the canary CD pipeline pack"
            echo "  --canary-upgrade  Stage the canary upgrade path pack"
            echo "  --canary-rollback Stage the canary rollback path pack"
            echo "  --rolling-base-chart  Stage the rolling base chart pack"
            echo "  --rolling-multi-arch-build  Stage the rolling multi-arch build pack"
            echo "  --rolling-template-pack  Stage the rolling template pack"
            echo "  --rolling-replicated-service  Stage the rolling replicated service pack"
            echo "  --rolling-signed-images  Stage the rolling signed images pack"
            echo "  --rolling-vulnerability-scan  Stage the rolling vulnerability scan pack"
            echo "  --rolling-ci      Stage the rolling CI pipeline pack"
            echo "  --rolling-cd      Stage the rolling CD pipeline pack"
            echo "  --rolling-upgrade Stage the rolling upgrade path pack"
            echo "  --rolling-rollback Stage the rolling rollback path pack"
            echo "  --airgap-base-chart  Stage the air-gap base chart pack"
            echo "  --airgap-multi-arch-build  Stage the air-gap multi-arch build pack"
            echo "  --single-node-base-chart  Stage the single-node base chart pack"
            echo "  --single-node-multi-arch-build  Stage the single-node multi-arch build pack"
            echo "  --ha-upgrade      Stage the HA upgrade path pack"
            echo "  --ha-rollback     Stage the HA rollback path pack"
            echo "  --help            Show this help"
            echo ""
            echo "Examples:"
            echo "  sudo ./deploy.sh                     # Interactive install"
            echo "  sudo ./deploy.sh --port=443          # Use port 443"
            echo "  sudo ./deploy.sh --no-interactive    # Non-interactive with defaults"
            exit 0
            ;;
    esac
done

# =============================================================================
# Helper Functions
# Small utilities for formatted output and section banners.
# =============================================================================

# Print the large ASCII banner at the top of the install.
print_banner() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════════════════════╗"
    echo "║                                                                           ║"
    cat <<'BANNER'
║        _____                                 __      ________             ║
║       |  __ \                                \ \    / /  ____|            ║
║       | |__) | __ _____  ___ __ ___   _____  _\ \  / /| |__  __  __       ║
║       |  ___/ '__/ _ \ \/ / '_ ` _ \ / _ \ \/ /\ \/ / |  __| \ \/ /       ║
║       | |   | | | (_) >  <| | | | | | (_) >  <  \  /  | |____ >  <        ║
║       |_|   |_|  \___/_/\_\_| |_| |_|\___/_/\_\  \/   |______/_/\_\       ║
BANNER
    echo "║                    All-in-One Deploy Script v2.0                          ║"
    echo "╚═══════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Print a major section heading with horizontal rules.
print_step() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}$1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════${NC}\n"
}

# Colored status printers used throughout the installer.
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_info() { echo -e "${CYAN}ℹ${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }

# =============================================================================
# Install CI/Release Tooling
# Helm, Trivy, and hadolint are required by the packaging pipelines so the
# Docker lint/scan and Helm lint/template/sign/scan stages do not get skipped.
# Installs only the tools that are not already present on the host.
# =============================================================================
install_ci_tools() {
    local arch
    arch=$(uname -m)
    local hadolint_arch="$arch"
    case "$arch" in
        x86_64) hadolint_arch="x86_64" ;;
        aarch64|arm64) hadolint_arch="arm64" ;;
        *) echo "Unsupported architecture: $arch" >&2; return 1 ;;
    esac

    if ! command -v helm >/dev/null 2>&1; then
        print_info "Installing Helm 3..."
        curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
        print_success "Helm installed"
    else
        print_info "Helm already installed"
    fi

    if ! command -v trivy >/dev/null 2>&1; then
        print_info "Installing Trivy..."
        curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin
        print_success "Trivy installed"
    else
        print_info "Trivy already installed"
    fi

    if ! command -v hadolint >/dev/null 2>&1; then
        print_info "Installing hadolint..."
        curl -fL -o /usr/local/bin/hadolint "https://proxmoxvex.local/dist/hadolint/v2.12.0/hadolint-Linux-${hadolint_arch}"
        chmod +x /usr/local/bin/hadolint
        print_success "hadolint installed"
    else
        print_info "hadolint already installed"
    fi
}

# =============================================================================
# Main Installation Routine
# =============================================================================
main() {
    print_banner

    # The installer needs root to install packages, create users, and write
    # systemd units and /etc paths. Bail early if not root.
    if [ "$EUID" -ne 0 ]; then
        print_error "Please run as root: sudo $0"
        exit 1
    fi

    # Curl-pipe installs require outbound connectivity to GitHub to clone the
    # repository. A quick ping is enough to fail fast if the host is air-gapped.
    if ! ping -c 1 proxmoxvex.local &>/dev/null; then
        print_error "No internet connection. Cannot download ProxmoxVEx."
        exit 1
    fi

    # =========================================================================
    # Step 1: System Dependencies
    # Install the Debian packages that ProxmoxVEx and its Python stack need.
    # =========================================================================
    print_step "Step 1/6: Installing System Dependencies"

    # Avoid any interactive debconf prompts during package installation.
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq

    print_info "Installing packages..."
    apt-get install -y -qq python3 python3-pip python3-venv curl wget git openssl \
        sshpass ca-certificates sudo sqlite3 > /dev/null 2>&1

    print_success "System dependencies installed"

    # Install the packaging/CI tooling (helm, trivy, hadolint) so pipelines
    # can lint, sign, and scan instead of silently skipping their stages.
    install_ci_tools

    # =========================================================================
    # Step 2: Create User & Directories
    # Prepare the service account and the on-disk layout for runtime data.
    # =========================================================================
    print_step "Step 2/6: Creating User & Directories"

    # Create the ProxmoxVEx service user if it does not already exist.
    # --system gives it a low UID and no login; --no-create-home --shell /bin/false
    # ensures it cannot be used for an interactive session.
    if id "$SERVICE_USER" &>/dev/null; then
        print_info "Service user '$SERVICE_USER' already exists"
    else
        useradd --system --no-create-home --shell /bin/false "$SERVICE_USER"
        print_success "Service user '$SERVICE_USER' created"
    fi

    # Create the working directory and all subdirectories in one shot.
    mkdir -p "$INSTALL_DIR"/{config,logs,ssl,static,web,images,backups}
    print_success "Directory structure created"

    # =========================================================================
    # Step 3: Download ProxmoxVEx from GitHub
    # Acquire the source code. Prefer a local checkout (e.g. the directory
    # containing this deploy.sh) so developers can install from the repo they
    # are already in; otherwise clone from GitHub.
    # =========================================================================
    print_step "Step 3/6: Downloading ProxmoxVEx from GitHub"

    # NS: feb 2026 - detect if running from a checkout that already has the files
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"

    if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/$PYTHON_FILE" ] && [ -d "$SCRIPT_DIR/ProxmoxVEx" ]; then
        # Running from existing checkout - copy directly instead of cloning
        print_info "Found local installation files in $SCRIPT_DIR"

        # Only copy if the checkout is not already the install directory itself.
        if [ "$SCRIPT_DIR" != "$INSTALL_DIR" ]; then
            cp "$SCRIPT_DIR/$PYTHON_FILE" "$INSTALL_DIR/"
            cp -r "$SCRIPT_DIR/ProxmoxVEx" "$INSTALL_DIR/"
            [ -d "$SCRIPT_DIR/web" ] && cp -r "$SCRIPT_DIR/web/"* "$INSTALL_DIR/web/" 2>/dev/null || true
            [ -d "$SCRIPT_DIR/images" ] && cp -r "$SCRIPT_DIR/images/"* "$INSTALL_DIR/images/" 2>/dev/null || true
            [ -d "$SCRIPT_DIR/static" ] && cp -r "$SCRIPT_DIR/static/"* "$INSTALL_DIR/static/" 2>/dev/null || true
            [ -f "$SCRIPT_DIR/version.json" ] && cp "$SCRIPT_DIR/version.json" "$INSTALL_DIR/"
            [ -f "$SCRIPT_DIR/requirements.txt" ] && cp "$SCRIPT_DIR/requirements.txt" "$INSTALL_DIR/"
            [ -f "$SCRIPT_DIR/update.sh" ] && cp "$SCRIPT_DIR/update.sh" "$INSTALL_DIR/"
            [ -f "$SCRIPT_DIR/deploy.sh" ] && cp "$SCRIPT_DIR/deploy.sh" "$INSTALL_DIR/"
        fi

        print_success "Files copied from local checkout"
    else
        # Download from GitHub
        TEMP_DIR=$(mktemp -d)
        print_info "Cloning repository..."

        if git clone --depth 1 --branch "$GITHUB_BRANCH" --quiet "$GITHUB_REPO" "$TEMP_DIR/ProxmoxVEx" 2>/dev/null; then
            print_success "Repository cloned (branch: $GITHUB_BRANCH)"

            # Copy ALL files from repo
            cp -r "$TEMP_DIR/ProxmoxVEx/"* "$INSTALL_DIR/" 2>/dev/null || true

            # Move index.html to web folder if exists in root
            [ -f "$INSTALL_DIR/index.html" ] && mv "$INSTALL_DIR/index.html" "$INSTALL_DIR/web/" 2>/dev/null || true

            # Remove git folder
            rm -rf "$INSTALL_DIR/.git" 2>/dev/null || true

            print_success "All files copied to $INSTALL_DIR"
        else
            print_error "Failed to clone repository"
            rm -rf "$TEMP_DIR"
            exit 1
        fi

        rm -rf "$TEMP_DIR"
    fi

    # Make the helper scripts executable so they can be invoked by the app user.
    chmod +x "$INSTALL_DIR/deploy.sh" "$INSTALL_DIR/update.sh" 2>/dev/null || true

    # If the canary template pack was requested, stage it in the install tree.
    if [ "$CANARY" = true ]; then
        print_info "Staging canary template pack..."
        if [ -d "$INSTALL_DIR/packaging/canary" ]; then
            cp -r "$INSTALL_DIR/packaging/canary" "$INSTALL_DIR/canary-template-pack" 2>/dev/null || true
            print_success "Canary template pack staged at $INSTALL_DIR/canary-template-pack"
        else
            print_warning "Canary template pack not found in source"
        fi
    fi

    # If the canary replicated service pack was requested, stage it in the install tree.
    if [ "$CANARY_REPLICATED" = true ]; then
        print_info "Staging canary replicated service pack..."
        if [ -d "$INSTALL_DIR/packaging/canary-replicated-service" ]; then
            cp -r "$INSTALL_DIR/packaging/canary-replicated-service" "$INSTALL_DIR/canary-replicated-service" 2>/dev/null || true
            print_success "Canary replicated service pack staged at $INSTALL_DIR/canary-replicated-service"
        else
            print_warning "Canary replicated service pack not found in source"
        fi
    fi

    # If the canary signed image pack was requested, stage it in the install tree.
    if [ "$CANARY_SIGNED" = true ]; then
        print_info "Staging canary signed image pack..."
        if [ -d "$INSTALL_DIR/packaging/canary-signed-images" ]; then
            cp -r "$INSTALL_DIR/packaging/canary-signed-images" "$INSTALL_DIR/canary-signed-images" 2>/dev/null || true
            print_success "Canary signed image pack staged at $INSTALL_DIR/canary-signed-images"
        else
            print_warning "Canary signed image pack not found in source"
        fi
    fi

    # If the canary vulnerability scan pack was requested, stage it in the install tree.
    if [ "$CANARY_VULNERABILITY_SCAN" = true ]; then
        print_info "Staging canary vulnerability scan pack..."
        if [ -d "$INSTALL_DIR/packaging/canary-vulnerability-scan" ]; then
            cp -r "$INSTALL_DIR/packaging/canary-vulnerability-scan" "$INSTALL_DIR/canary-vulnerability-scan" 2>/dev/null || true
            print_success "Canary vulnerability scan pack staged at $INSTALL_DIR/canary-vulnerability-scan"
        else
            print_warning "Canary vulnerability scan pack not found in source"
        fi
    fi

    # If the canary CI pipeline pack was requested, stage it in the install tree.
    if [ "$CANARY_CI" = true ]; then
        print_info "Staging canary CI pipeline pack..."
        if [ -d "$INSTALL_DIR/packaging/canary-ci-pipeline" ]; then
            cp -r "$INSTALL_DIR/packaging/canary-ci-pipeline" "$INSTALL_DIR/canary-ci-pipeline" 2>/dev/null || true
            print_success "Canary CI pipeline pack staged at $INSTALL_DIR/canary-ci-pipeline"
        else
            print_warning "Canary CI pipeline pack not found in source"
        fi
    fi

    # If the canary CD pipeline pack was requested, stage it in the install tree.
    if [ "$CANARY_CD" = true ]; then
        print_info "Staging canary CD pipeline pack..."
        if [ -d "$INSTALL_DIR/packaging/canary-cd-pipeline" ]; then
            cp -r "$INSTALL_DIR/packaging/canary-cd-pipeline" "$INSTALL_DIR/canary-cd-pipeline" 2>/dev/null || true
            print_success "Canary CD pipeline pack staged at $INSTALL_DIR/canary-cd-pipeline"
        else
            print_warning "Canary CD pipeline pack not found in source"
        fi
    fi

    # If the canary upgrade path pack was requested, stage it in the install tree.
    if [ "$CANARY_UPGRADE" = true ]; then
        print_info "Staging canary upgrade path pack..."
        if [ -d "$INSTALL_DIR/packaging/canary-upgrade-path" ]; then
            cp -r "$INSTALL_DIR/packaging/canary-upgrade-path" "$INSTALL_DIR/canary-upgrade-path" 2>/dev/null || true
            print_success "Canary upgrade path pack staged at $INSTALL_DIR/canary-upgrade-path"
        else
            print_warning "Canary upgrade path pack not found in source"
        fi
    fi

    # If the canary rollback path pack was requested, stage it in the install tree.
    if [ "$CANARY_ROLLBACK" = true ]; then
        print_info "Staging canary rollback path pack..."
        if [ -d "$INSTALL_DIR/packaging/canary-rollback-path" ]; then
            cp -r "$INSTALL_DIR/packaging/canary-rollback-path" "$INSTALL_DIR/canary-rollback-path" 2>/dev/null || true
            print_success "Canary rollback path pack staged at $INSTALL_DIR/canary-rollback-path"
        else
            print_warning "Canary rollback path pack not found in source"
        fi
    fi

    # If the rolling base chart pack was requested, stage it in the install tree.
    if [ "$ROLLING_BASE" = true ]; then
        print_info "Staging rolling base chart pack..."
        if [ -d "$INSTALL_DIR/packaging/rolling-base-chart" ]; then
            cp -r "$INSTALL_DIR/packaging/rolling-base-chart" "$INSTALL_DIR/rolling-base-chart" 2>/dev/null || true
            print_success "Rolling base chart pack staged at $INSTALL_DIR/rolling-base-chart"
        else
            print_warning "Rolling base chart pack not found in source"
        fi
    fi

    # If the rolling multi-arch build pack was requested, stage it in the install tree.
    if [ "$ROLLING_MULTI_ARCH" = true ]; then
        print_info "Staging rolling multi-arch build pack..."
        if [ -d "$INSTALL_DIR/packaging/rolling-multi-arch-build" ]; then
            cp -r "$INSTALL_DIR/packaging/rolling-multi-arch-build" "$INSTALL_DIR/rolling-multi-arch-build" 2>/dev/null || true
            print_success "Rolling multi-arch build pack staged at $INSTALL_DIR/rolling-multi-arch-build"
        else
            print_warning "Rolling multi-arch build pack not found in source"
        fi
    fi

    # If the rolling template pack was requested, stage it in the install tree.
    if [ "$ROLLING_TEMPLATE" = true ]; then
        print_info "Staging rolling template pack..."
        if [ -d "$INSTALL_DIR/packaging/rolling-template-pack" ]; then
            cp -r "$INSTALL_DIR/packaging/rolling-template-pack" "$INSTALL_DIR/rolling-template-pack" 2>/dev/null || true
            print_success "Rolling template pack staged at $INSTALL_DIR/rolling-template-pack"
        else
            print_warning "Rolling template pack not found in source"
        fi
    fi

    # If the rolling replicated service pack was requested, stage it in the install tree.
    if [ "$ROLLING_REPLICATED" = true ]; then
        print_info "Staging rolling replicated service pack..."
        if [ -d "$INSTALL_DIR/packaging/rolling-replicated-service" ]; then
            cp -r "$INSTALL_DIR/packaging/rolling-replicated-service" "$INSTALL_DIR/rolling-replicated-service" 2>/dev/null || true
            print_success "Rolling replicated service pack staged at $INSTALL_DIR/rolling-replicated-service"
        else
            print_warning "Rolling replicated service pack not found in source"
        fi
    fi

    # If the rolling signed images pack was requested, stage it in the install tree.
    if [ "$ROLLING_SIGNED" = true ]; then
        print_info "Staging rolling signed images pack..."
        if [ -d "$INSTALL_DIR/packaging/rolling-signed-images" ]; then
            cp -r "$INSTALL_DIR/packaging/rolling-signed-images" "$INSTALL_DIR/rolling-signed-images" 2>/dev/null || true
            print_success "Rolling signed images pack staged at $INSTALL_DIR/rolling-signed-images"
        else
            print_warning "Rolling signed images pack not found in source"
        fi
    fi

    # If the rolling vulnerability scan pack was requested, stage it in the install tree.
    if [ "$ROLLING_VULNERABILITY" = true ]; then
        print_info "Staging rolling vulnerability scan pack..."
        if [ -d "$INSTALL_DIR/packaging/rolling-vulnerability-scan" ]; then
            cp -r "$INSTALL_DIR/packaging/rolling-vulnerability-scan" "$INSTALL_DIR/rolling-vulnerability-scan" 2>/dev/null || true
            print_success "Rolling vulnerability scan pack staged at $INSTALL_DIR/rolling-vulnerability-scan"
        else
            print_warning "Rolling vulnerability scan pack not found in source"
        fi
    fi

    # If the rolling CI pipeline pack was requested, stage it in the install tree.
    if [ "$ROLLING_CI" = true ]; then
        print_info "Staging rolling CI pipeline pack..."
        if [ -d "$INSTALL_DIR/packaging/rolling-ci-pipeline" ]; then
            cp -r "$INSTALL_DIR/packaging/rolling-ci-pipeline" "$INSTALL_DIR/rolling-ci-pipeline" 2>/dev/null || true
            print_success "Rolling CI pipeline pack staged at $INSTALL_DIR/rolling-ci-pipeline"
        else
            print_warning "Rolling CI pipeline pack not found in source"
        fi
    fi

    # If the rolling CD pipeline pack was requested, stage it in the install tree.
    if [ "$ROLLING_CD" = true ]; then
        print_info "Staging rolling CD pipeline pack..."
        if [ -d "$INSTALL_DIR/packaging/rolling-cd-pipeline" ]; then
            cp -r "$INSTALL_DIR/packaging/rolling-cd-pipeline" "$INSTALL_DIR/rolling-cd-pipeline" 2>/dev/null || true
            print_success "Rolling CD pipeline pack staged at $INSTALL_DIR/rolling-cd-pipeline"
        else
            print_warning "Rolling CD pipeline pack not found in source"
        fi
    fi

    # If the rolling upgrade path pack was requested, stage it in the install tree.
    if [ "$ROLLING_UPGRADE" = true ]; then
        print_info "Staging rolling upgrade path pack..."
        if [ -d "$INSTALL_DIR/packaging/rolling-upgrade-path" ]; then
            cp -r "$INSTALL_DIR/packaging/rolling-upgrade-path" "$INSTALL_DIR/rolling-upgrade-path" 2>/dev/null || true
            print_success "Rolling upgrade path pack staged at $INSTALL_DIR/rolling-upgrade-path"
        else
            print_warning "Rolling upgrade path pack not found in source"
        fi
    fi

    # If the rolling rollback path pack was requested, stage it in the install tree.
    if [ "$ROLLING_ROLLBACK" = true ]; then
        print_info "Staging rolling rollback path pack..."
        if [ -d "$INSTALL_DIR/packaging/rolling-rollback-path" ]; then
            cp -r "$INSTALL_DIR/packaging/rolling-rollback-path" "$INSTALL_DIR/rolling-rollback-path" 2>/dev/null || true
            print_success "Rolling rollback path pack staged at $INSTALL_DIR/rolling-rollback-path"
        else
            print_warning "Rolling rollback path pack not found in source"
        fi
    fi

    # If the air-gap base chart pack was requested, stage it in the install tree.
    if [ "$AIRGAP_BASE" = true ]; then
        print_info "Staging air-gap base chart pack..."
        if [ -d "$INSTALL_DIR/packaging/airgap" ]; then
            cp -r "$INSTALL_DIR/packaging/airgap" "$INSTALL_DIR/airgap" 2>/dev/null || true
            print_success "Air-gap base chart pack staged at $INSTALL_DIR/airgap"
        else
            print_warning "Air-gap base chart pack not found in source"
        fi
    fi

    # If the air-gap multi-arch build pack was requested, stage it in the install tree.
    if [ "$AIRGAP_MULTI_ARCH" = true ]; then
        print_info "Staging air-gap multi-arch build pack..."
        if [ -d "$INSTALL_DIR/packaging/airgap" ]; then
            cp -r "$INSTALL_DIR/packaging/airgap" "$INSTALL_DIR/airgap" 2>/dev/null || true
            print_success "Air-gap multi-arch build pack staged at $INSTALL_DIR/airgap"
        else
            print_warning "Air-gap multi-arch build pack not found in source"
        fi
    fi

    # If the single-node base chart pack was requested, stage it in the install tree.
    if [ "$SINGLE_NODE_BASE" = true ]; then
        print_info "Staging single-node base chart pack..."
        if [ -d "$INSTALL_DIR/packaging/single-node-base-chart" ]; then
            cp -r "$INSTALL_DIR/packaging/single-node-base-chart" "$INSTALL_DIR/single-node-base-chart" 2>/dev/null || true
            print_success "Single-node base chart pack staged at $INSTALL_DIR/single-node-base-chart"
        else
            print_warning "Single-node base chart pack not found in source"
        fi
    fi

    # If the single-node multi-arch build pack was requested, stage it in the install tree.
    if [ "$SINGLE_NODE_MULTI_ARCH" = true ]; then
        print_info "Staging single-node multi-arch build pack..."
        if [ -d "$INSTALL_DIR/packaging/single-node-multi-arch-build" ]; then
            cp -r "$INSTALL_DIR/packaging/single-node-multi-arch-build" "$INSTALL_DIR/single-node-multi-arch-build" 2>/dev/null || true
            print_success "Single-node multi-arch build pack staged at $INSTALL_DIR/single-node-multi-arch-build"
        else
            print_warning "Single-node multi-arch build pack not found in source"
        fi
    fi

    # If the HA upgrade path pack was requested, stage it in the install tree.
    if [ "$HA_UPGRADE" = true ]; then
        print_info "Staging HA upgrade path pack..."
        if [ -d "$INSTALL_DIR/packaging/ha-upgrade-path" ]; then
            cp -r "$INSTALL_DIR/packaging/ha-upgrade-path" "$INSTALL_DIR/ha-upgrade-path" 2>/dev/null || true
            print_success "HA upgrade path pack staged at $INSTALL_DIR/ha-upgrade-path"
            if [ -d "$INSTALL_DIR/systemd" ]; then
                cp "$INSTALL_DIR/systemd/proxmoxVEx-ha-upgrade.path" "$INSTALL_DIR/" 2>/dev/null || true
                cp "$INSTALL_DIR/systemd/proxmoxVEx-ha-upgrade.service" "$INSTALL_DIR/" 2>/dev/null || true
                print_success "HA upgrade path systemd units staged at $INSTALL_DIR/"
            fi
        else
            print_warning "HA upgrade path pack not found in source"
        fi
    fi

    # If the HA rollback path pack was requested, stage it in the install tree.
    if [ "$HA_ROLLBACK" = true ]; then
        print_info "Staging HA rollback path pack..."
        if [ -d "$INSTALL_DIR/packaging/ha-rollback-path" ]; then
            cp -r "$INSTALL_DIR/packaging/ha-rollback-path" "$INSTALL_DIR/ha-rollback-path" 2>/dev/null || true
            print_success "HA rollback path pack staged at $INSTALL_DIR/ha-rollback-path"
            if [ -d "$INSTALL_DIR/systemd" ]; then
                cp "$INSTALL_DIR/systemd/proxmoxVEx-ha-rollback.path" "$INSTALL_DIR/" 2>/dev/null || true
                cp "$INSTALL_DIR/systemd/proxmoxVEx-ha-rollback.service" "$INSTALL_DIR/" 2>/dev/null || true
                print_success "HA rollback path systemd units staged at $INSTALL_DIR/"
            fi
        else
            print_warning "HA rollback path pack not found in source"
        fi
    fi

    # =========================================================================
    # Step 4: Python Virtual Environment & Dependencies
    # Create an isolated Python environment and install the runtime packages.
    # =========================================================================
    print_step "Step 4/6: Setting up Python Environment"

    # Python version sanity. We test against 3.10–3.13. 3.14 is too new for
    # parts of our stack (gevent, websockets, pyvmomi may have edge cases the
    # ecosystem hasn't worked through yet — issue #388 had a Python 3.14
    # report where the SSH WebSocket subprocess couldn't bind cleanly). 3.9
    # and earlier hit the urllib3/cryptography floor in requirements.txt.
    PYTHON_BIN="python3"
    PY_VER=$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null)
    if [ -z "$PY_VER" ]; then
        echo -e "${RED}python3 is not callable. Install it first: apt-get install python3 python3-venv${NC}"
        exit 1
    fi
    print_info "Detected Python: $PY_VER"
    PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
    PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
    if [ "$PY_MAJOR" -ne 3 ]; then
        echo -e "${RED}Unsupported Python major version: $PY_VER. ProxmoxVEx requires Python 3.10–3.13.${NC}"
        exit 1
    fi
    if [ "$PY_MINOR" -lt 10 ]; then
        echo -e "${RED}Python $PY_VER is too old. Minimum supported: 3.10. Recommended: 3.12.${NC}"
        echo -e "${RED}Older versions hit the urllib3 / cryptography floors in requirements.txt.${NC}"
        exit 1
    fi
    if [ "$PY_MINOR" -ge 14 ]; then
        echo -e "${YELLOW}WARNING: Python $PY_VER is newer than what ProxmoxVEx is tested on (3.10–3.13).${NC}"
        echo -e "${YELLOW}Known issue on 3.14: SSH/VNC WebSocket subprocesses may fail to bind${NC}"
        echo -e "${YELLOW}cleanly (issue #388). If you hit a console-not-working bug, downgrade to${NC}"
        echo -e "${YELLOW}python3.12 (Ubuntu 24.04 default) or python3.13 and run deploy.sh again.${NC}"
        if [ -t 0 ] && [ -z "$DEPLOY_FORCE_PY" ]; then
            read -r -p "Continue anyway? [y/N] " _ans
            case "$_ans" in
                y|Y|yes|YES) ;;
                *) echo "Aborted. Set DEPLOY_FORCE_PY=1 to skip this prompt in non-interactive runs."; exit 1 ;;
            esac
        else
            print_info "Non-interactive run or DEPLOY_FORCE_PY set — proceeding on $PY_VER."
        fi
    fi

    print_info "Creating virtual environment..."
    python3 -m venv "$INSTALL_DIR/venv"

    print_info "Installing Python packages..."
    "$INSTALL_DIR/venv/bin/pip" install --upgrade pip -q 2>/dev/null

    # Prefer the repository's requirements.txt when available; otherwise fall
    # back to a hard-coded list of known runtime dependencies.
    if [ -f "$INSTALL_DIR/requirements.txt" ]; then
        print_info "Installing from requirements.txt..."
        "$INSTALL_DIR/venv/bin/pip" install -q -r "$INSTALL_DIR/requirements.txt" 2>/dev/null
    else
        # Fallback to hardcoded list
        print_info "No requirements.txt found, using defaults..."
        "$INSTALL_DIR/venv/bin/pip" install -q \
            flask flask-cors flask-sock flask-compress \
            requests urllib3 cryptography pyopenssl \
            argon2-cffi paramiko websockets websocket-client \
            gevent gevent-websocket pyotp "qrcode[pil]" pyvmomi 2>/dev/null
    fi

    print_success "Python environment ready"

    # =========================================================================
    # Step 5: Download Offline Assets (Optional)
    # Pull down CSS/JS/font assets from CDNs so the web UI works without
    # internet after the first install. This is the slowest step, hence the
    # --no-offline / --no-offline flags to skip it when not wanted.
    # =========================================================================
    if [ "$DOWNLOAD_OFFLINE" = true ]; then
        print_step "Step 5/6: Downloading Offline Assets"

        cd "$INSTALL_DIR"
        print_info "Downloading static files for offline mode..."

        if "$INSTALL_DIR/venv/bin/python" "$PYTHON_FILE" --download-static 2>&1 | while read line; do echo -n "."; done; then
            echo ""
            print_success "Offline assets downloaded"
        else
            echo ""
            print_warning "Some assets may have failed (non-critical)"
        fi
    else
        print_step "Step 5/6: Skipping Offline Assets"
        print_info "Use --download-static later if needed"
    fi

    # =========================================================================
    # Step 6: Configure & Start Service
    # Build the systemd unit, helper wrappers, sudoers permissions, and the
    # master key; then start the application and persist the chosen port.
    # =========================================================================
    print_step "Step 6/6: Configuring Service"

    # Ask the operator to choose an access port when running interactively.
    # Otherwise the value from --port or the default (5000) is used.
    if [ "$INTERACTIVE" = true ]; then
        echo -e "${YELLOW}Select access port:${NC}"
        echo "  1) Default (5000) - Standard ports"
        echo "  2) HTTPS (443)    - Professional setup"
        echo "  3) Custom         - Enter your own"
        echo ""

        while true; do
            read -p "Choice [1-3, default=1]: " PORT_CHOICE < /dev/tty
            case "${PORT_CHOICE:-1}" in
                1)
                    ACCESS_PORT=5000
                    break
                    ;;
                2)
                    ACCESS_PORT=443
                    break
                    ;;
                3)
                    read -p "Enter port (1-65535): " CUSTOM_PORT < /dev/tty
                    if [[ "$CUSTOM_PORT" =~ ^[0-9]+$ ]] && [ "$CUSTOM_PORT" -ge 1 ] && [ "$CUSTOM_PORT" -le 65535 ]; then
                        ACCESS_PORT=$CUSTOM_PORT
                        break
                    else
                        echo -e "${RED}Invalid port${NC}"
                    fi
                    ;;
                *)
                    echo "Please enter 1, 2, or 3"
                    ;;
            esac
        done
    fi

    # Announce the selected port and the derived VNC/SSH WebSocket ports.
    # Privileged ports (<1024) are reachable because the unit grants CAP_NET_BIND_SERVICE.
    echo -e "${GREEN}✓ Using ports: $ACCESS_PORT (Web), $((ACCESS_PORT+1)) (VNC), $((ACCESS_PORT+2)) (SSH)${NC}"
    [ "$ACCESS_PORT" -lt 1024 ] && echo -e "${CYAN}  (privileged ports via CAP_NET_BIND_SERVICE)${NC}"

    # Create a systemd service that runs the main Python file as the service user.
    cat > /etc/systemd/system/ProxmoxVEx.service << EOF
[Unit]
Description=ProxmoxVEx - Proxmox Cluster Management
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$INSTALL_DIR

# Custom PATH for wrappers
Environment=PATH=$INSTALL_DIR/bin:/usr/local/bin:/usr/bin:/bin

ExecStart=$INSTALL_DIR/venv/bin/python $INSTALL_DIR/$PYTHON_FILE
Restart=always
RestartSec=5

# Allow binding to privileged ports (443, 80)
AmbientCapabilities=CAP_NET_BIND_SERVICE

# Minimal security
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ProxmoxVEx

[Install]
WantedBy=multi-user.target
EOF

    # Create wrapper scripts for auto-update
    mkdir -p "$INSTALL_DIR/bin"

    # systemctl wrapper
    cat > "$INSTALL_DIR/bin/systemctl" << 'WRAPPEREOF'
#!/bin/bash
# Intelligent systemctl wrapper for ProxmoxVEx auto-update
if [ "$1" = "sudo" ]; then
    shift
fi
case "$*" in
    *ProxmoxVEx*)
        exec /usr/bin/sudo /usr/bin/systemctl "$@"
        ;;
    *)
        exec /usr/bin/systemctl "$@"
        ;;
esac
WRAPPEREOF
    chmod 755 "$INSTALL_DIR/bin/systemctl"

    # sudo wrapper
    cat > "$INSTALL_DIR/bin/sudo" << 'SUDOWRAPPER'
#!/bin/bash
# Sudo wrapper - prevents double sudo
if [ "$1" = "sudo" ]; then
    shift
fi
exec /usr/bin/sudo "$@"
SUDOWRAPPER
    chmod 755 "$INSTALL_DIR/bin/sudo"

    # Create sudoers rules
    cat > /etc/sudoers.d/ProxmoxVEx << EOF
# ProxmoxVEx service management (for auto-update)
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart ProxmoxVEx
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart ProxmoxVEx.service
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop ProxmoxVEx
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop ProxmoxVEx.service
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl start ProxmoxVEx
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl start ProxmoxVEx.service
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl status ProxmoxVEx
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl status ProxmoxVEx.service
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl is-active ProxmoxVEx
$SERVICE_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl is-active ProxmoxVEx.service
EOF
    chmod 440 /etc/sudoers.d/ProxmoxVEx

    # Set ownership of the install tree to the service account.
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"

    # Harden sensitive dirs
    [ -d "$INSTALL_DIR/config" ] && chmod 700 "$INSTALL_DIR/config"
    [ -d "$INSTALL_DIR/ssl" ] && chmod 700 "$INSTALL_DIR/ssl"

    # MK May 2026 — master-key bootstrap (Tier-4: /etc/ProxmoxVEx/secret.key).
    # Fresh installs get the key OUTSIDE $INSTALL_DIR/config so a backup of the
    # config dir doesn't pick up the decryption key. Idempotent: only acts when
    # no key already exists (neither at the new location nor in the legacy spot).
    #
    # MK May 2026 (#417 / tgmct) — mode is 0640 (NOT 0600). File is owned by
    # root:$SERVICE_GROUP; the systemd unit runs as $SERVICE_USER which is in
    # $SERVICE_GROUP, so group-read is required to load the key at boot.
    # The previous 0600 root:ProxmoxVEx combo made the key unreadable to the
    # service and ProxmoxVEx.service failed to start on every fresh install.
    LEGACY_KEY="$INSTALL_DIR/config/.ProxmoxVEx.key"
    SYS_KEY_DIR="/etc/ProxmoxVEx"
    SYS_KEY="$SYS_KEY_DIR/secret.key"

    if [ -f "$SYS_KEY" ]; then
        # Repair-on-upgrade: prior deploy.sh versions wrote 0600. Bump to 0640
        # so the systemd service can actually read its own key after upgrade.
        cur_mode=$(stat -c '%a' "$SYS_KEY" 2>/dev/null || echo "")
        if [ "$cur_mode" = "600" ] || [ "$cur_mode" = "400" ]; then
            print_info "Found $SYS_KEY at mode $cur_mode — bumping to 0640 (#417 repair)"
            chmod 640 "$SYS_KEY"
            chown "root:$SERVICE_GROUP" "$SYS_KEY" 2>/dev/null || true
        else
            print_info "Master key already at $SYS_KEY (mode $cur_mode) — leaving untouched"
        fi
    elif [ -f "$LEGACY_KEY" ]; then
        print_warning "Legacy key at $LEGACY_KEY detected"
        print_info "  ProxmoxVEx will keep using it but emit a deprecation warning."
        print_info "  Migrate with:  sudo mv \"$LEGACY_KEY\" \"$SYS_KEY\" && sudo chmod 640 \"$SYS_KEY\" && sudo chown root:$SERVICE_GROUP \"$SYS_KEY\""
    else
        # No key anywhere — generate the new default at the secure location.
        mkdir -p "$SYS_KEY_DIR"
        chmod 750 "$SYS_KEY_DIR"
        chown "root:$SERVICE_GROUP" "$SYS_KEY_DIR" 2>/dev/null || true

        # 32 raw bytes -> urlsafe-base64. Python is already a hard dep at this
        # point in the install so we don't need a bash-only fallback.
        if "$INSTALL_DIR/venv/bin/python3" -c "
import base64, os, secrets, sys
key = base64.urlsafe_b64encode(secrets.token_bytes(32))
fd = os.open('$SYS_KEY', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
try:
    os.write(fd, key)
finally:
    os.close(fd)
" 2>/dev/null; then
            chmod 640 "$SYS_KEY"
            chown "root:$SERVICE_GROUP" "$SYS_KEY" 2>/dev/null || \
                chown "root:root" "$SYS_KEY"
            print_success "Generated master key at $SYS_KEY (0640 root:$SERVICE_GROUP)"
            print_info "  Loader tier: 4 (system-service default — outside $INSTALL_DIR/config)"
            print_info "  Stronger: wrap with systemd-creds — see docs/SECURITY.md §5"
        else
            print_warning "Could not pre-generate $SYS_KEY — ProxmoxVEx will fall back to legacy path on first boot"
        fi
    fi

    # Enable and start service
    systemctl daemon-reload
    systemctl enable ProxmoxVEx
    systemctl start ProxmoxVEx

    print_success "Systemd service created and started"

    # Wait for database initialization
    echo "Waiting for database initialization..."
    sleep 8

    # If a non-default port was chosen, write it to the SQLite settings table
    # and restart the service so it takes effect on this first run.
    if [ "$ACCESS_PORT" != 5000 ]; then
        print_info "Configuring port $ACCESS_PORT..."
        ProxmoxVEx_DB="$INSTALL_DIR/config/ProxmoxVEx.db"

        if [ -f "$ProxmoxVEx_DB" ]; then
            sqlite3 "$ProxmoxVEx_DB" "INSERT OR REPLACE INTO server_settings (key, value) VALUES ('port', '$ACCESS_PORT');" 2>/dev/null && {
                echo "Restarting with new port..."
                systemctl restart ProxmoxVEx
                sleep 5
                print_success "Port set to $ACCESS_PORT"
            } || print_warning "Set port manually in Settings > Server"
        fi
    fi

    # Confirm the service is now active.
    if systemctl is-active --quiet ProxmoxVEx; then
        print_success "ProxmoxVEx is running!"
    else
        print_error "ProxmoxVEx failed to start - check: journalctl -u ProxmoxVEx"
    fi

    # =========================================================================
    # Done!
    # Print a completion banner and the URLs the operator can use to reach the UI.
    # =========================================================================
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    Installation Complete! 🎉                               ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Get current IP
    CURRENT_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    [ -z "$CURRENT_IP" ] && CURRENT_IP="<your-ip>"

    if [ "$ACCESS_PORT" = 443 ]; then
        echo -e "  Web Interface: ${CYAN}${BOLD}https://${CURRENT_IP}${NC}"
        echo -e "  VNC WebSocket: ${CYAN}https://${CURRENT_IP}:444${NC}"
        echo -e "  SSH WebSocket: ${CYAN}https://${CURRENT_IP}:445${NC}"
    else
        echo -e "  Web Interface: ${CYAN}${BOLD}https://${CURRENT_IP}:${ACCESS_PORT}${NC}"
        echo -e "  VNC WebSocket: ${CYAN}https://${CURRENT_IP}:$((ACCESS_PORT+1))${NC}"
        echo -e "  SSH WebSocket: ${CYAN}https://${CURRENT_IP}:$((ACCESS_PORT+2))${NC}"
    fi

    echo ""
    echo -e "${YELLOW}💡 Tip: Check for updates in ProxmoxVEx Web UI${NC}"
    echo -e "   Settings → Updates → Check for Updates"
    echo ""
    echo -e "Commands:"
    echo -e "  ${CYAN}systemctl status ProxmoxVEx${NC}    - Check status"
    echo -e "  ${CYAN}journalctl -u ProxmoxVEx -f${NC}    - View logs"
    echo -e "  ${CYAN}systemctl restart ProxmoxVEx${NC}   - Restart service"
    echo ""
}

# Kick off the install routine, passing through any command-line arguments.
main "$@"
