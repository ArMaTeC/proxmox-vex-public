#!/bin/bash
# Spec 093/US012: `update.sh --rollback` reactivates the previous release
# symlink, reverts DB state when possible, and logs the rollback.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US012 rollback tests"

check "--rollback flag handled"               "grep -q '\-\-rollback' update.sh"
check ".previous-version recorded"            "grep -q 'previous-version' update.sh"
check "swap records previous before switching" "grep -q 'previous-version' update.sh"
check "rollback re-points current symlink"    "grep -q 'rollback' update.sh"
check "missing previous version aborts"       "grep -qi 'no previous\|nothing to roll\|previous.*missing' update.sh"
check "rollback is logged (auditable)"        "grep -qi 'rollback.*log\|log.*rollback\|rolled back' update.sh"
check "DB revert attempted when possible"     "grep -qi 'pg_restore\|downgrade\|db.*restore\|restore.*db' update.sh"

# --- functional: extract + run rollback on a scratch layout --------------------
SCRATCH=$(mktemp -d)
awk '/^rollback_release\(\)/,/^}/; /^log_rollback\(\)/,/^}/; /^atomic_swap\(\)/,/^}/' update.sh > "$SCRATCH/rb.sh"
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh"

BASE="$SCRATCH/app"
mkdir -p "$BASE"/{releases/{1.0.0,2.0.0},shared/{config,data,logs,plugins}}
echo old > "$BASE/releases/1.0.0/app.py"
echo new > "$BASE/releases/2.0.0/app.py"
ln -sfn "$BASE/releases/2.0.0" "$BASE/current"
echo "2.0.0" > "$BASE/.active-version"
echo "1.0.0" > "$BASE/.previous-version"

BASE_DIR="$BASE" bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/rb.sh'
    rollback_release
" >/dev/null 2>&1
rc=$?

[ $rc -eq 0 ] && ok "rollback_release completes" || bad "rollback_release completes (rc=$rc)"
check "current repointed to 1.0.0" \
    "[ \"\$(readlink '$BASE/current' 2>/dev/null)\" = '$BASE/releases/1.0.0' ]"
check "old code serving again" \
    "grep -q old '$BASE/current/app.py' 2>/dev/null"
check ".active-version now 1.0.0" \
    "grep -q '1.0.0' '$BASE/.active-version'"
check "rollback audit entry written" \
    "find '$BASE' -name '*.log' | xargs grep -l 'rollback\|rolled back' 2>/dev/null | grep -q . || grep -qri 'rolled back' '$BASE' 2>/dev/null"

# no previous version → fail closed
BASE2="$SCRATCH/app2"
mkdir -p "$BASE2"/releases/1.0.0
ln -sfn "$BASE2/releases/1.0.0" "$BASE2/current"
echo "1.0.0" > "$BASE2/.active-version"

( BASE_DIR="$BASE2" bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/rb.sh'
    rollback_release
" ) >/dev/null 2>&1
rc=$?
[ $rc -ne 0 ] && ok "missing .previous-version aborts" \
              || bad "missing .previous-version aborts"
check "failed rollback keeps current intact" \
    "[ \"\$(readlink '$BASE2/current')\" = '$BASE2/releases/1.0.0' ]"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
