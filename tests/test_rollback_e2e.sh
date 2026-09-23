#!/bin/bash
# Spec 093/US091: update→marker→rollback e2e — proves a rollback restores
# the prior version AND preserves operator state written post-update.
set -u
cd "$(dirname "$0")/.." || exit 1

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US091 rollback-e2e tests"

SCRATCH=$(mktemp -d); trap 'rm -rf "$SCRATCH"' EXIT

mkdir -p "$SCRATCH/install/releases/1.0.0" "$SCRATCH/install/config" "$SCRATCH/dist" "$SCRATCH/pkg/install"
echo 'v1' > "$SCRATCH/install/releases/1.0.0/app.txt"
echo 'cfg' > "$SCRATCH/install/config/app.conf"
cp update.sh "$SCRATCH/install/releases/1.0.0/"
ln -sfn "$SCRATCH/install/releases/1.0.0" "$SCRATCH/install/current"
echo '1.0.0' > "$SCRATCH/install/.active-version"
cp update.sh "$SCRATCH/install/"
echo 'v2' > "$SCRATCH/pkg/install/app.txt"
tar -czf "$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz" -C "$SCRATCH/pkg" install
cat > "$SCRATCH/dist/version.json" <<JSON
{"version":"2.0.0","build":"x","release_date":"2026-01-01","min_python":"3.8",
 "changelog":[],"download_url":"file://$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz",
 "channels":{"stable":{"version":"2.0.0","archive":"ProxmoxVEx-2.0.0.tar.gz"}},
 "mirrors":["file://$SCRATCH/dist"]}
JSON

UPD_ENV="VEX_UPDATE_BASE=file://$SCRATCH/dist VEX_I_ACCEPT_RISK=1 HEALTH_URL=file:///dev/null HEALTH_TIMEOUT=5 VEX_SKIP_POST_VERIFY=1"

# 1. update 1.0.0 -> 2.0.0
(cd "$SCRATCH/install" && eval "$UPD_ENV bash update.sh --atomic --insecure --yes" >/dev/null 2>&1)
check "update applied"                "readlink $SCRATCH/install/current | grep -q 'releases/2.0.0$'"

# 2. write marker state — what a user creates post-update (data + config)
mkdir -p "$SCRATCH/install/shared/data" 2>/dev/null || true
echo 'marker-rb' > "$SCRATCH/install/shared/data/marker.txt" 2>/dev/null \
    || { mkdir -p "$SCRATCH/install/data"; echo 'marker-rb' > "$SCRATCH/install/data/marker.txt"; }
echo 'post-update' >> "$SCRATCH/install/config/app.conf"

# 3. rollback
(cd "$SCRATCH/install" && bash update.sh --rollback) >/dev/null 2>&1; rc=$?
check "rollback exits clean"          "test $rc -eq 0"
check "prior version serving"         "readlink $SCRATCH/install/current | grep -q 'releases/1.0.0$'"
check "active version reverted"       "grep -q '^1.0.0$' $SCRATCH/install/.active-version"
check "marker preserved"              "cat $SCRATCH/install/shared/data/marker.txt $SCRATCH/install/data/marker.txt 2>/dev/null | grep -q 'marker-rb'"
check "config edits preserved"        "grep -q 'post-update' $SCRATCH/install/config/app.conf"
check "rollback logged"               "grep -qi 'rollback\|swap' $SCRATCH/install/shared/logs/update.log $SCRATCH/install/logs/update.log $SCRATCH/install/shared/logs/rollback.log 2>/dev/null"
check "2.0.0 dir retained for fwd"    "test -d $SCRATCH/install/releases/2.0.0"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
