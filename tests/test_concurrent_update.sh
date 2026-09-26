#!/bin/bash
# Spec 093/US093: concurrent update contention — two simultaneous updaters,
# exactly one wins via the flock; the loser exits cleanly with the
# lock-held message and the install ends consistent.
set -u
cd "$(dirname "$0")/.." || exit 1

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US093 concurrent-update tests"

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

spawn() { # spawn <extra-env...> <logfile> — direct bash -c so $! is update.sh
    bash -c 'cd "$1" && shift && exec env VEX_UPDATE_BASE="file://'"$SCRATCH"'/dist" \
        VEX_I_ACCEPT_RISK=1 HEALTH_URL="file:///dev/null" HEALTH_TIMEOUT=5 \
        VEX_SKIP_POST_VERIFY=1 "$@" bash update.sh --atomic --insecure --yes' \
        _ "$SCRATCH/install" "$@"
}

# run 1 holds the lock through a post-stage pause; run 2 must lose.
spawn VEX_PAUSE_AFTER_STAGE=4 >"$SCRATCH/one.log" 2>&1 &
P1=$!
for _ in $(seq 1 100); do
    grep -q 'Staging release' "$SCRATCH/one.log" 2>/dev/null && break
    sleep 0.1
done
spawn >"$SCRATCH/two.log" 2>&1 &
P2=$!
wait "$P2"; S2=$?
wait "$P1"; S1=$?

check "winner exits 0"              "test $S1 -eq 0"
check "loser exits nonzero"         "test $S2 -ne 0"
check "lock-held message"           "grep -qi 'in progress\|lock' $SCRATCH/two.log"
check "holder pid named"            "grep -qi 'pid\|holder' $SCRATCH/two.log"
check "winner applied 2.0.0"        "readlink $SCRATCH/install/current | grep -q 'releases/2.0.0$'"
check "active version consistent"   "grep -q '^2.0.0$' $SCRATCH/install/.active-version"
check "no double-stage litter"      "! test -d $SCRATCH/install/releases/.stage-2.0.0"
check "lock file freed after"       "spawn >$SCRATCH/three.log 2>&1; test $? -eq 0 || grep -qi 'in progress\|already' $SCRATCH/three.log"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
