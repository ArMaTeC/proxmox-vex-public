#!/usr/bin/env bash
# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        misc/proxmox-lxc-appliance-creator.sh
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Proxmox Lxc Appliance Creator SH source
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
set -euo pipefail

###############################################################################
# ProxmoxVEx Proxmox VE Appliance Creator
#
# Create a Proxmox VE LXC template with ProxmoxVEx pre-installed and configured
# for automated and quicker deployments.
#
# (C) 2026 Karl Lawrence
# License: AGPL-3.0-or-later
#
# Usage:
#   SNAPSHOT build:
#     ./proxmox-lxc-appliance-creator.sh
#
#   Release build:
#     ./proxmox-lxc-appliance-creator.sh --release v0.6.2
#
###############################################################################

# Default LXC container configuration.
CTID=999
HOSTNAME=ProxmoxVEx-dev999
TEMPLATE="local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst"
STORAGE="local-lvm"
PASSWORD="admin123"
CORES=2
MEMORY=4096
DISK=30
BRIDGE="vmbr0"
ARTIFACT_DIR="/opt/ProxmoxVEx-templates/"
TODAY=$(date +%F)
RELEASE="SNAPSHOT"

# Parse command-line options.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release)
      RELEASE="$2"
      shift 2
      ;;
    --release=*)
      RELEASE="${1#*=}"
      shift
      ;;
    --artifact-dir=*)
      ARTIFACT_DIR="${1#*=}"
      shift
      ;;
    --TEMPLATE=*)
      TEMPLATE="${1#*=}"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--release v0.6.2] [--artifact-dir /path/to/artifacts] [--TEMPLATE template-name]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo "Creating ProxmoxVEx LXC template..."
echo "Using release: $RELEASE"

# Ensure the artifact directory is empty so templates do not overwrite or mix.
shopt -s nullglob dotglob
files=(/opt/ProxmoxVEx-templates/*)
if [ ${#files[@]} -eq 0 ]; then
  echo "Directory $ARTIFACT_DIR is empty - continuing..."
else
  echo "Directory $ARTIFACT_DIR is not empty!"
  exit 1
fi

# Create the unprivileged LXC container with nesting and keyctl enabled.
echo "Container $CTID ($HOSTNAME) will be created using template $TEMPLATE."
pct create $CTID $TEMPLATE \
  --hostname $HOSTNAME \
  --password $PASSWORD \
  --cores $CORES \
  --memory $MEMORY \
  --rootfs $STORAGE:${DISK} \
  --net0 name=eth0,bridge=$BRIDGE,ip=dhcp \
  --unprivileged 1 \
  --features keyctl=1,nesting=1

# Start the newly created container.
echo "Starting container $CTID ($HOSTNAME)."
pct start $CTID
echo "Container $CTID ($HOSTNAME) created and started."

# Install ProxmoxVEx inside the container. For a tagged release, checkout that
# tag before running deploy.sh.
echo "Installing ProxmoxVEx in container $CTID ($HOSTNAME)."
pct exec $CTID -- bash -c "apt-get update && apt-get -y upgrade && apt-get -y install sudo curl git"
if [[ "$RELEASE" == "SNAPSHOT" ]]; then
  pct exec $CTID -- bash -c "cd /opt/ && git clone https://proxmoxvex.local/source.git && cd ProxmoxVEx && bash deploy.sh --port=5000"
else
  pct exec $CTID -- bash -c "cd /opt/ && git clone https://proxmoxvex.local/source.git && cd ProxmoxVEx && git checkout $RELEASE && bash deploy.sh --port=5000"
fi
echo "ProxmoxVEx installation in container $CTID ($HOSTNAME) completed."

# Clean up the container before converting it to a template.
echo "Cleaning up container $CTID ($HOSTNAME) before creating template."
pct exec $CTID -- bash -c "apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && history -c"
pct stop $CTID

# Convert the container to a template and dump it to the artifact directory.
echo "Creating LXC template from container $CTID ($HOSTNAME)."
pct template $CTID
mkdir -p $ARTIFACT_DIR
vzdump $CTID --mode stop --compress zstd --dumpdir $ARTIFACT_DIR
echo "LXC template created and stored in $ARTIFACT_DIR."

# Rename the artifact to include the release/SNAPSHOT name and date.
if [[ "$RELEASE" == "SNAPSHOT" ]]; then
  mv "$ARTIFACT_DIR"/*.tar.zst \
     "$ARTIFACT_DIR/ProxmoxVEx-template-SNAPSHOT-$TODAY.tar.zst"
  echo "Template created at:  $ARTIFACT_DIR/ProxmoxVEx-template-SNAPSHOT-$TODAY.tar.zst"
else
  mv "$ARTIFACT_DIR"/*.tar.zst \
     "$ARTIFACT_DIR/ProxmoxVEx-template-$RELEASE.tar.zst"
  echo "Template created at:  $ARTIFACT_DIR/ProxmoxVEx-template-$RELEASE.tar.zst"
fi

# Destroy the source container now that the template has been exported.
echo "Cleaning up: destroying container $CTID ($HOSTNAME)."
pct destroy "$CTID"
echo "Process completed successfully."
