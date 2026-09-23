#!/bin/bash
# Spec 093/US088: SIGKILL-during-update recovery — kill the real updater
# at the staged-not-swapped point; the live release must be untouched and
# a rerun must complete (leftover stage dir + lock must not wedge it).
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US088 sigkill-recovery tests"

check "pause hook exists"          "grep -q 'VEX_PAUSE_AFTER_STAGE' update.sh"

SCRATCH=$(mktemp -d); trap 'rm -rf "$SCRATCH"' EXIT

mkdir -p "$SCRATCH/install/releases/1.0.0" "$SCRATCH/install/config" "$SCRATCH/dist"
echo 'v1' > "$SCRATCH/install/releases/1.0.0/app.txt"
echo 'cfg' > "$SCRATCH/install/config/app.conf"
cp update.sh "$SCRATCH/install/releases/1.0.0/"
ln -sfn "$SCRATCH/install/releases/1.0.0" "$SCRATCH/install/current"
echo '1.0.0' > "$SCRATCH/install/.active-version"
cp update.sh "$SCRATCH/install/"
tar -czf "$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz" -C "$SCRATCH" install
cat > "$SCRATCH/dist/version.json" <<JSON
{"version":"2.0.0","build":"x","release_date":"2026-01-01","min_python":"3.8",
 "changelog":[],"download_url":"file://$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz",
 "channels":{"stable":{"version":"2.0.0","archive":"ProxmoxVEx-2.0.0.tar.gz"}},
 "mirrors":["file://$SCRATCH/dist"]}
JSON

# run 1: pause after staging, SIGKILL before the swap. The bash -c must be
# spawned directly — not inside a function — so `exec` keeps $! == the
# update.sh pid and kill -9 hits the real updater, not a wrapper subshell.
bash -c 'cd "$1" && shift && exec env VEX_UPDATE_BASE="file://'"$SCRATCH"'/dist" \
    VEX_I_ACCEPT_RISK=1 HEALTH_URL="file:///dev/null" HEALTH_TIMEOUT=5 \
    VEX_SKIP_POST_VERIFY=1 "$@" bash update.sh --atomic --insecure --yes' \
    _ "$SCRATCH/install" VEX_PAUSE_AFTER_STAGE=30 >"$SCRATCH/killed.log" 2>&1 &
KPID=$!
for _ in $(seq 1 200); do
    [ -d "$SCRATCH/install/releases/2.0.0" ] && break
    sleep 0.1
done
[ -d "$SCRATCH/install/releases/2.0.0" ] && ok "reached staged-not-swapped" || bad "reached staged-not-swapped"
kill -9 "$KPID" 2>/dev/null
wait "$KPID" 2>/dev/null

check "live release untouched"      "readlink $SCRATCH/install/current | grep -q 'releases/1.0.0$'"
check "active version unchanged"    "grep -q '^1.0.0$' $SCRATCH/install/.active-version"
check "staged dir left behind"      "test -d $SCRATCH/install/releases/2.0.0 || test -d $SCRATCH/install/releases/.stage-2.0.0"

# run 2: rerun must complete — flock is kernel-held, the kill released it
bash -c 'cd "$1" && exec env VEX_UPDATE_BASE="file://'"$SCRATCH"'/dist" \
    VEX_I_ACCEPT_RISK=1 HEALTH_URL="file:///dev/null" HEALTH_TIMEOUT=5 \
    VEX_SKIP_POST_VERIFY=1 bash update.sh --atomic --insecure --yes' \
    _ "$SCRATCH/install" >"$SCRATCH/rerun.log" 2>&1; rc=$?
check "rerun completes"             "test $rc -eq 0"
check "new release activated"       "readlink $SCRATCH/install/current | grep -q 'releases/2.0.0$'"
check "active version updated"      "grep -q '^2.0.0$' $SCRATCH/install/.active-version"
check "old release retained"        "test -d $SCRATCH/install/releases/1.0.0"
check "rollback marker set"         "grep -q '^1.0.0$' $SCRATCH/install/.previous-version"
check "no stale stage dirs"         "! test -d $SCRATCH/install/releases/.stage-2.0.0"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
