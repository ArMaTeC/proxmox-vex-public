#!/bin/bash
# Spec 093/US087: corrupted download detection — publish a real checksum
# for the fixture archive, flip one byte in the download, and prove the
# updater rejects it at the verify stage with the live release untouched.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US087 corrupt-download tests"

SCRATCH=$(mktemp -d); trap 'rm -rf "$SCRATCH"' EXIT

# same fixture as the e2e harness: old atomic install + dist tree
mkdir -p "$SCRATCH/install/releases/1.0.0" "$SCRATCH/install/config" "$SCRATCH/dist"
echo 'v1' > "$SCRATCH/install/releases/1.0.0/app.txt"
echo 'cfg' > "$SCRATCH/install/config/app.conf"
cp update.sh "$SCRATCH/install/releases/1.0.0/"
ln -sfn "$SCRATCH/install/releases/1.0.0" "$SCRATCH/install/current"
echo '1.0.0' > "$SCRATCH/install/.active-version"
cp update.sh "$SCRATCH/install/"
tar -czf "$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz" -C "$SCRATCH" install

# publish the GOOD checksum — the corruption must not reach the metadata
( cd "$SCRATCH/dist" && sha256sum ProxmoxVEx-2.0.0.tar.gz ) > "$SCRATCH/dist/checksums.txt"

cat > "$SCRATCH/dist/version.json" <<JSON
{"version":"2.0.0","build":"x","release_date":"2026-01-01","min_python":"3.8",
 "changelog":[],"download_url":"file://$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz",
 "channels":{"stable":{"version":"2.0.0","archive":"ProxmoxVEx-2.0.0.tar.gz"}},
 "mirrors":["file://$SCRATCH/dist"]}
JSON

# flip one byte mid-archive — a truncated/corrupted transfer
printf 'X' | dd of="$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz" bs=1 seek=1024 conv=notrunc 2>/dev/null

out=$(cd "$SCRATCH/install" && \
      VEX_UPDATE_BASE="file://$SCRATCH/dist" \
      VEX_I_ACCEPT_RISK=1 HEALTH_URL="file:///dev/null" HEALTH_TIMEOUT=5 \
      VEX_SKIP_POST_VERIFY=1 \
      bash update.sh --atomic --insecure --yes 2>&1); rc=$?

check "update run exits nonzero"      "test $rc -ne 0"
check "checksum mismatch reported"    "echo \"\$out\" | grep -q 'CHECKSUM MISMATCH'"
check "failure stage is verify"       "grep -q '\"stage\":\"verify\"\|\"stage\": \"verify\"' $SCRATCH/install/logs/update-failure.json $SCRATCH/install/shared/logs/update-failure.json 2>/dev/null"
check "live release untouched"        "readlink $SCRATCH/install/current | grep -q 'releases/1.0.0$'"
check "active version unchanged"      "grep -q '^1.0.0$' $SCRATCH/install/.active-version"
check "no staged 2.0.0 activated"     "! test -d $SCRATCH/install/releases/2.0.0"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
