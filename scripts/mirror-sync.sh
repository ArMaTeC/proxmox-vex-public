#!/usr/bin/env bash
# spec 093/US084: internal mirror sync — pull the upstream distribution
# tree (metadata, signatures, checksums, archives) into a local docroot
# served by nginx. Clients then point at the mirror via VEX_UPDATE_BASE.
#
# Usage:
#   scripts/mirror-sync.sh --src https://proxmoxvex.com/dl --dest /srv/mirror
#   scripts/mirror-sync.sh                      # defaults above
#
# --src accepts http(s):// or file:// bases (file:// for tests/airgap
# seeding). Everything is downloaded to a staging dir and swapped in, so
# the docroot is never left half-synced; failures leave the last good
# tree untouched.
set -euo pipefail
shopt -s inherit_errexit

SRC="https://proxmoxvex.com/dl"
DEST="/srv/mirror"

while [ $# -gt 0 ]; do
    case "$1" in
        --src)  SRC="${2:?--src needs a base URL}"; shift 2 ;;
        --dest) DEST="${2:?--dest needs a directory}"; shift 2 ;;
        -h|--help)
            sed -n '2,14p' "$0"; exit 0 ;;
        *) echo "unknown arg: $1" >&2; exit 64 ;;
    esac
done

STAGE="$DEST/.sync-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
trap 'rm -rf "$STAGE"' EXIT

fetch() { # fetch <name> — required; missing upstream file aborts the sync
    local name="$1"
    curl -fsSL "$SRC/$name" -o "$STAGE/$name" \
        || { echo "mirror-sync: failed to fetch $name" >&2; exit 1; }
}

fetch_opt() { # fetch_opt <name> — optional; absence is not fatal
    local name="$1"
    curl -fsSL "$SRC/$name" -o "$STAGE/$name" 2>/dev/null || true
}

# Metadata first — its releases/channels/deltas maps tell us which
# artifacts the mirror must carry.
fetch version.json
fetch_opt version.json.asc
fetch_opt pubkey.asc
fetch_opt checksums.txt
fetch_opt transparency.log
fetch_opt transparency.log.asc
fetch_opt MANIFEST.sha256
fetch_opt MANIFEST.sha256.asc
fetch_opt sbom.json
fetch_opt sbom.json.asc
fetch_opt deps-freeze.json
fetch_opt deps-freeze.json.asc

# Collect every artifact name the metadata references: channel targets,
# per-release archives, delta packages, and the airgap bundle. Basenames
# only — the tree is flat.
mapfile -t ARTIFACTS < <(python3 - "$STAGE/version.json" <<'PY'
import json, os, sys
try:
    v = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
names = set()
def add(x):
    if isinstance(x, str) and x:
        names.add(os.path.basename(x))
for ch in v.get("channels", {}).values():
    if isinstance(ch, dict):
        add(ch.get("archive"))
for rel in v.get("releases", {}).values():
    if isinstance(rel, dict):
        add(rel.get("archive"))
for d in v.get("deltas", {}).values():
    if isinstance(d, dict):
        add(d.get("file") or d.get("archive"))
    elif isinstance(d, str):
        add(d)
ver = v.get("version", "")
if ver:
    add(f"ProxmoxVEx-{ver}.tar.gz")
    add(f"ProxmoxVEx-{ver}.tar.zst")
    add(f"ProxmoxVEx-{ver}.vexbundle")
for f in v.get("formats", []):
    if ver:
        add(f"ProxmoxVEx-{ver}.{f}")
add("ProxmoxVEx-latest.tar.gz")
for n in sorted(names):
    print(n)
PY
)

for a in ${ARTIFACTS[@]+"${ARTIFACTS[@]}"}; do
    [ -n "$a" ] || continue
    fetch_opt "$a"
    fetch_opt "$a.asc"
done

# Atomic-ish swap: keep the last good tree in .prev, move the fresh stage
# into place. Readers between the two mv's see either old or new, never a
# mix of both.
rm -rf "$DEST/.prev"
[ -d "$DEST/current" ] && mv "$DEST/current" "$DEST/.prev"
mv "$STAGE" "$DEST/current"
trap - EXIT

COUNT=$(find "$DEST/current" -type f | wc -l)
echo "mirror-sync: $COUNT artifacts -> $DEST/current"
