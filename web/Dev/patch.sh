#!/bin/bash
# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        web/Dev/patch.sh
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Fail fast so a half-applied patch cannot leave the...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---

# Fail fast so a half-applied patch cannot leave the install in a broken state.
set -e

# =============================================================================
# Overview
# =============================================================================
# This script patches an existing ProxmoxVEx installation to bring it up to
# the expected systemd/venv/sudoers layout. It is normally run as root. The
# operations are idempotent, so running patch.sh more than once is safe:
#
#   1. Parse optional --dir, --port, --force, and --help flags.
#   2. Ask for the installation directory (or use --dir).
#   3. Install python3-venv, sqlite3, and sudo if missing.
#   4. Ensure the ProxmoxVEx service user exists.
#   5. Create or update a Python virtual environment.
#   6. Install the systemctl and sudo wrapper scripts used by auto-update.
#   7. Rewrite the systemd unit with CAP_NET_BIND_SERVICE and wrapper PATH.
#   8. Install password-less sudoers rules for the service user.
#   9. Optionally set the listening port in the SQLite settings table.
#  10. Print the final status and access URL.
# =============================================================================

# Terminal output colors.
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Deployment defaults.
INSTALL_DIR="/opt/ProxmoxVEx"
SERVICE_USER="ProxmoxVEx"
SERVICE_GROUP="ProxmoxVEx"
PYTHON_FILE="ProxmoxVEx_multi_cluster.py"

# Runtime options.
NEW_PORT=""
FORCE=false
DIR_SET=false

# ============================================================================
# Parse Arguments
# ============================================================================
for arg in "$@"; do
    case $arg in
        --port=*)
            NEW_PORT="${arg#*=}"
            ;;
        --dir=*|--install-dir=*)
            INSTALL_DIR="${arg#*=}"
            DIR_SET=true
            ;;
        --force|-f)
            FORCE=true
            ;;
        --help|-h)
            echo "ProxmoxVEx Patch Script"
            echo ""
            echo "Usage: sudo ./patch.sh [options]"
            echo ""
            echo "Options:"
            echo "  --dir=PATH    Set installation directory (skips prompt)"
            echo "  --port=PORT   Also change port (e.g., --port=443)"
            echo "  --force       Skip all confirmation prompts"
            echo "  --help        Show this help"
            echo ""
            echo "Interactive mode (default):"
            echo "  - Asks for installation directory"
            echo "  - Shows current status"
            echo "  - Confirms before patching"
            echo ""
            echo "Examples:"
            echo "  sudo ./patch.sh                          # Interactive"
            echo "  sudo ./patch.sh --dir=/opt/ProxmoxVEx      # Skip dir prompt"
            echo "  sudo ./patch.sh --force --port=443       # Fully automated"
            echo ""
            echo "What this patch does:"
            echo "  ✓ Creates Python venv (fixes pip issues)"
            echo "  ✓ Installs systemctl wrapper (fixes auto-update)"
            echo "  ✓ Adds CAP_NET_BIND_SERVICE (enables port 443)"
            echo "  ✓ Configures sudoers (service restart without password)"
            echo "  ✓ Installs sqlite3 (port configuration)"
            echo ""
            exit 0
            ;;
    esac
done

# ============================================================================
# Helper Functions
# ============================================================================
print_banner() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║           ProxmoxVEx Patch Script v1.0                          ║"
    echo "║           Updates existing installations                       ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_step() { echo -e "\n${BLUE}══════════════════════════════════════════════════════════════${NC}\n${BOLD}$1${NC}\n"; }
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_info() { echo -e "${CYAN}ℹ${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }

# ============================================================================
# Main Patching Routine
# ============================================================================
main() {
    print_banner

    # The patch needs root to install packages, write to /etc, and restart services.
    if [ "$EUID" -ne 0 ]; then
        print_error "Please run as root: sudo $0"
        exit 1
    fi

    # =========================================================================
    # Ask for Installation Directory
    # =========================================================================
    if [ "$DIR_SET" = false ] && [ "$FORCE" = false ]; then
        echo -e "${YELLOW}Installation Directory${NC}"
        read -p "Enter path [/opt/ProxmoxVEx]: " INPUT_DIR
        [ -n "$INPUT_DIR" ] && INSTALL_DIR="$INPUT_DIR"
    fi
    
    echo -e "Using: ${CYAN}$INSTALL_DIR${NC}\n"

    # Validate the install directory.
    if [ ! -d "$INSTALL_DIR" ]; then
        print_error "ProxmoxVEx not found at $INSTALL_DIR"
        print_info "Use deploy.sh for fresh installation"
        exit 1
    fi

    if [ ! -f "$INSTALL_DIR/$PYTHON_FILE" ]; then
        print_error "ProxmoxVEx main file not found: $INSTALL_DIR/$PYTHON_FILE"
        exit 1
    fi

    # Show current status
    echo -e "${YELLOW}Current Installation:${NC}"
    echo -e "  Location: ${CYAN}$INSTALL_DIR${NC}"
    
    if [ -d "$INSTALL_DIR/venv" ]; then
        echo -e "  Python: ${GREEN}venv (already patched)${NC}"
    else
        echo -e "  Python: ${YELLOW}system (will be patched)${NC}"
    fi
    
    if [ -f "$INSTALL_DIR/bin/systemctl" ]; then
        echo -e "  Wrapper: ${GREEN}installed${NC}"
    else
        echo -e "  Wrapper: ${YELLOW}missing (will be installed)${NC}"
    fi
    
    if systemctl is-active --quiet ProxmoxVEx 2>/dev/null; then
        echo -e "  Service: ${GREEN}running${NC}"
    else
        echo -e "  Service: ${YELLOW}stopped${NC}"
    fi
    echo ""

    # Confirm
    if [ "$FORCE" = false ]; then
        read -p "Apply patch? [Y/n]: " CONFIRM
        case "${CONFIRM:-y}" in
            [Yy]|[Yy][Ee][Ss]|"") ;;
            *) echo "Aborted."; exit 0 ;;
        esac
    fi

    # =========================================================================
    # Step 1: Install Dependencies
    # =========================================================================
    print_step "Step 1/6: Installing Dependencies"

    apt-get update -qq
    apt-get install -y -qq python3-venv sqlite3 sudo > /dev/null 2>&1
    print_success "Dependencies installed (python3-venv, sqlite3, sudo)"

    # =========================================================================
    # Step 2: Create Service User (if missing)
    # =========================================================================
    print_step "Step 2/6: Checking Service User"

    if id "$SERVICE_USER" &>/dev/null; then
        print_success "Service user '$SERVICE_USER' exists"
    else
        useradd --system --no-create-home --shell /bin/false "$SERVICE_USER"
        print_success "Service user '$SERVICE_USER' created"
    fi

    # =========================================================================
    # Step 3: Create Python venv
    # =========================================================================
    print_step "Step 3/6: Setting up Python Virtual Environment"

    if [ -d "$INSTALL_DIR/venv" ]; then
        print_info "venv already exists, updating..."
    else
        print_info "Creating new venv..."
        python3 -m venv "$INSTALL_DIR/venv"
    fi

    print_info "Installing/updating Python packages..."
    "$INSTALL_DIR/venv/bin/pip" install --upgrade pip -q 2>/dev/null

    # Use requirements.txt if exists
    if [ -f "$INSTALL_DIR/requirements.txt" ]; then
        "$INSTALL_DIR/venv/bin/pip" install -q -r "$INSTALL_DIR/requirements.txt" 2>/dev/null
        print_success "Packages installed from requirements.txt"
    else
        "$INSTALL_DIR/venv/bin/pip" install -q \
            flask flask-cors flask-sock flask-compress \
            requests urllib3 cryptography pyopenssl \
            argon2-cffi paramiko websockets websocket-client \
            gevent gevent-websocket pyotp "qrcode[pil]" 2>/dev/null
        print_success "Packages installed (default list)"
    fi

    # =========================================================================
    # Step 4: Create Wrapper Scripts
    # =========================================================================
    print_step "Step 4/6: Installing Wrapper Scripts"

    mkdir -p "$INSTALL_DIR/bin"

    # systemctl wrapper
    cat > "$INSTALL_DIR/bin/systemctl" << 'WRAPPEREOF'
#!/bin/bash
# Intelligent systemctl wrapper for ProxmoxVEx auto-update
# Handles both: "systemctl restart ProxmoxVEx" and "sudo systemctl restart ProxmoxVEx"
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
    print_success "systemctl wrapper installed"

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
    print_success "sudo wrapper installed"

    # =========================================================================
    # Step 5: Update Systemd Service
    # =========================================================================
    print_step "Step 5/6: Updating Systemd Service"

    # Stop service
    systemctl stop ProxmoxVEx 2>/dev/null || true

    # Create new service file
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
    print_success "Systemd service updated"

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
    print_success "Sudoers rules configured"

    # Set ownership
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
    print_success "Ownership set"

    # Reload and start
    systemctl daemon-reload
    systemctl enable ProxmoxVEx
    systemctl start ProxmoxVEx
    print_success "Service restarted"

    # =========================================================================
    # Step 6: Optional Port Change
    # =========================================================================
    print_step "Step 6/6: Port Configuration"

    # Wait for DB to be ready
    sleep 5

    ProxmoxVEx_DB="$INSTALL_DIR/config/ProxmoxVEx.db"

    if [ -n "$NEW_PORT" ]; then
        print_info "Changing port to $NEW_PORT..."
        
        if [ -f "$ProxmoxVEx_DB" ]; then
            sqlite3 "$ProxmoxVEx_DB" "INSERT OR REPLACE INTO server_settings (key, value) VALUES ('port', '$NEW_PORT');" 2>/dev/null && {
                systemctl restart ProxmoxVEx
                sleep 3
                print_success "Port changed to $NEW_PORT"
            } || print_warning "Could not set port - change in Settings > Server"
        else
            print_warning "Database not found yet - change port in Settings > Server"
        fi
    else
        # Show current port
        if [ -f "$ProxmoxVEx_DB" ]; then
            CURRENT_PORT=$(sqlite3 "$ProxmoxVEx_DB" "SELECT value FROM server_settings WHERE key='port';" 2>/dev/null || echo "5000")
            print_info "Current port: $CURRENT_PORT"
            print_info "To change: sudo ./patch.sh --port=443"
        else
            print_info "Port: 5000 (default)"
        fi
    fi

    # =========================================================================
    # Done!
    # =========================================================================
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    Patch Complete! 🎉                          ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Check status
    if systemctl is-active --quiet ProxmoxVEx; then
        print_success "ProxmoxVEx is running!"
        
        # Get current IP
        CURRENT_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
        [ -z "$CURRENT_IP" ] && CURRENT_IP="<your-ip>"
        
        if [ -f "$ProxmoxVEx_DB" ]; then
            PORT=$(sqlite3 "$ProxmoxVEx_DB" "SELECT value FROM server_settings WHERE key='port';" 2>/dev/null || echo "5000")
        else
            PORT="5000"
        fi
        
        if [ "$PORT" = "443" ]; then
            echo -e "\n  Web Interface: ${CYAN}${BOLD}https://${CURRENT_IP}${NC}"
        else
            echo -e "\n  Web Interface: ${CYAN}${BOLD}https://${CURRENT_IP}:${PORT}${NC}"
        fi
    else
        print_error "Service not running - check: journalctl -u ProxmoxVEx"
    fi

    echo ""
    echo -e "${YELLOW}What was patched:${NC}"
    echo -e "  ${GREEN}✓${NC} Python venv created (no more pip issues)"
    echo -e "  ${GREEN}✓${NC} systemctl wrapper (auto-update works)"
    echo -e "  ${GREEN}✓${NC} CAP_NET_BIND_SERVICE (port 443 possible)"
    echo -e "  ${GREEN}✓${NC} Sudoers rules (service management)"
    echo ""
    echo -e "Commands:"
    echo -e "  ${CYAN}systemctl status ProxmoxVEx${NC}    - Check status"
    echo -e "  ${CYAN}journalctl -u ProxmoxVEx -f${NC}    - View logs"
    echo ""
}

# Start the patch.
main "$@"
