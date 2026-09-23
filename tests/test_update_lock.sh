#!/bin/bash
# Spec 093/US017: exclusive update lock via flock — concurrent runs abort
# with the holder's info; killed holders release automatically (kernel).
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US017 update-lock tests"

check "flock used (kernel-tracked)"           "grep -q 'flock' update.sh"
check "lock acquired before acting"           "grep -q 'acquire_update_lock\|update.lock' update.sh"
check "holder info recorded (pid, started)"   "grep -q 'holder\|pid=\|started=' update.sh"
check "concurrent run aborts with message"    "grep -qi 'another update\|in progress' update.sh"
check "lock released via trap"                "grep -q 'trap' update.sh && grep -q 'holder' update.sh"

# --- functional: real flock contention ------------------------------------------
SCRATCH=$(mktemp -d)
awk '/^acquire_update_lock\(\)/,/^}/' update.sh > "$SCRATCH/lk.sh"
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh"

# first acquirer holds the lock in background
BASE_DIR="$SCRATCH" bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/lk.sh'
    acquire_update_lock && sleep 5
" >/dev/null 2>&1 &
sleep 0.5

# second attempt must fail fast with holder info
out=$(BASE_DIR="$SCRATCH" bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/lk.sh'
    acquire_update_lock
" 2>&1)
rc=$?
[ $rc -ne 0 ] && ok "concurrent acquire fails" || bad "concurrent acquire fails (rc=$rc)"
echo "$out" | grep -qi 'pid=\|in progress\|another' \
    && ok "failure shows holder info" || bad "failure shows holder info (got: $out)"

# holder file written with pid+started
[ -f "$SCRATCH/.update.lock.holder" ] \
    && ok "holder file written" || bad "holder file written"
grep -q 'pid=' "$SCRATCH/.update.lock.holder" 2>/dev/null \
    && ok "holder file has pid" || bad "holder file has pid"

wait
# after the holder exits, the lock is free again (kernel releases on death)
BASE_DIR="$SCRATCH" bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/lk.sh'
    acquire_update_lock
" >/dev/null 2>&1
rc=$?
[ $rc -eq 0 ] && ok "lock reclaimable after holder exits" || bad "lock reclaimable after holder exits (rc=$rc)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
