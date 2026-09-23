#!/bin/bash
# Spec 093/US089: low-disk-space update — a nearly-full install filesystem
# must abort cleanly in preflight/staging, leaving the live release intact.
set -u
cd "$(dirname "$0")/.." || exit 1

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US089 low-disk tests"

check "disk gate exists"            "grep -q 'check_disk_space' update.sh"

SCRATCH=$(mktemp -d); trap 'umount "$SCRATCH/install" 2>/dev/null; rm -rf "$SCRATCH"' EXIT

# install lives on an 8MB tmpfs — under the ~200MB preflight floor;
# dist lives on the normal fs so the artifact itself is reachable.
mkdir -p "$SCRATCH/install" "$SCRATCH/dist"
mount -t tmpfs -o size=8M tmpfs "$SCRATCH/install" || { echo "SKIP: tmpfs mount unavailable"; exit 0; }

mkdir -p "$SCRATCH/install/releases/1.0.0" "$SCRATCH/install/config"
echo 'v1' > "$SCRATCH/install/releases/1.0.0/app.txt"
echo 'cfg' > "$SCRATCH/install/config/app.conf"
cp update.sh "$SCRATCH/install/releases/1.0.0/"
ln -sfn "$SCRATCH/install/releases/1.0.0" "$SCRATCH/install/current"
echo '1.0.0' > "$SCRATCH/install/.active-version"
cp update.sh "$SCRATCH/install/"

mkdir -p "$SCRATCH/pkg/install"
echo 'v2' > "$SCRATCH/pkg/install/app.txt"
tar -czf "$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz" -C "$SCRATCH/pkg" install
cat > "$SCRATCH/dist/version.json" <<JSON
{"version":"2.0.0","build":"x","release_date":"2026-01-01","min_python":"3.8",
 "changelog":[],"download_url":"file://$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz",
 "channels":{"stable":{"version":"2.0.0","archive":"ProxmoxVEx-2.0.0.tar.gz"}},
 "mirrors":["file://$SCRATCH/dist"]}
JSON

# shellcheck disable=SC2034
out=$(cd "$SCRATCH/install" && \
      VEX_UPDATE_BASE="file://$SCRATCH/dist" \
      VEX_I_ACCEPT_RISK=1 HEALTH_URL="file:///dev/null" HEALTH_TIMEOUT=5 \
      VEX_SKIP_POST_VERIFY=1 \
      bash update.sh --atomic --insecure --yes 2>&1); rc=$?

check "update aborts nonzero"       "test $rc -ne 0"
check "disk space named"            "echo \"\$out\" | grep -qi 'disk space\|insufficient\|space'"
check "live release untouched"      "readlink $SCRATCH/install/current | grep -q 'releases/1.0.0$'"
check "active version unchanged"    "grep -q '^1.0.0$' $SCRATCH/install/.active-version"
check "no 2.0.0 staged"             "! test -d $SCRATCH/install/releases/2.0.0"

umount "$SCRATCH/install" 2>/dev/null || true

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
