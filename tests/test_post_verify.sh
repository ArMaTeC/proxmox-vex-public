#!/bin/bash
# Spec 093/US016: post-update verification — restart, poll health for a
# bounded window, auto-rollback + logged incident on failure. The
# auto-rollback itself is guarded (max attempts → alert, don't loop).
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US016 post-update verify tests"

check "health poll loop with deadline"       "grep -q 'DEADLINE\|HEALTH_TIMEOUT' update.sh"
check "health failure auto-rolls back"       "grep -q 'rollback_release\|--rollback' update.sh && grep -qi 'auto.*rollback\|rollback.*auto\|health.*rollback\|rollback.*health' update.sh"
check "incident logged with versions"        "grep -qi 'log_update\|rollback.log\|incident' update.sh"
check "rollback attempt guard (no loop)"     "grep -qi 'rollback.*attempt\|max.*rollback\|AUTO_ROLLBACK' update.sh"
check "generous health window (migrations)"  "grep -q 'HEALTH_TIMEOUT' update.sh"

# --- functional: wait_for_health + guarded auto-rollback -------------------------
SCRATCH=$(mktemp -d)
awk '/^wait_for_health\(\)/,/^}/; /^auto_rollback\(\)/,/^}/; /^log_update\(\)/,/^}/;
     /^rollback_release\(\)/,/^}/; /^log_rollback\(\)/,/^}/; /^atomic_swap\(\)/,/^}/' \
    update.sh > "$SCRATCH/pv.sh"
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh"

# healthy endpoint: serve an ok JSON via python http.server (random port —
# a fixed port can collide with a stale server from an aborted run)
PORT=$((20000 + RANDOM % 20000))
mkdir -p "$SCRATCH/www" && echo '{"ok":true}' > "$SCRATCH/www/healthz"
(cd "$SCRATCH/www" && python3 -m http.server "$PORT" >/dev/null 2>&1) &
SRV=$!
sleep 1

bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/pv.sh'
         wait_for_health 'http://127.0.0.1:$PORT/healthz' 10" >/dev/null 2>&1
rc=$?
[ $rc -eq 0 ] && ok "wait_for_health passes on healthy app" || bad "wait_for_health passes on healthy app (rc=$rc)"

kill $SRV 2>/dev/null; wait $SRV 2>/dev/null

# unhealthy endpoint → nonzero within the window
start=$(date +%s)
bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/pv.sh'
         wait_for_health 'http://127.0.0.1:1/none' 3" >/dev/null 2>&1
rc=$?
elapsed=$(( $(date +%s) - start ))
[ $rc -ne 0 ] && [ $elapsed -le 8 ] && ok "wait_for_health times out → nonzero" \
              || bad "wait_for_health times out → nonzero (rc=$rc ${elapsed}s)"

# auto_rollback: releases layout present → swap happens, incident logged
BASE="$SCRATCH/app"
mkdir -p "$BASE"/{releases/{1.0.0,2.0.0},shared/logs}
echo old > "$BASE/releases/1.0.0/app.py"
echo new > "$BASE/releases/2.0.0/app.py"
ln -sfn "$BASE/releases/2.0.0" "$BASE/current"
echo "2.0.0" > "$BASE/.active-version"
echo "1.0.0" > "$BASE/.previous-version"

BASE_DIR="$BASE" bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/pv.sh'
    auto_rollback '2.0.0' 'health check failed'" >/dev/null 2>&1
rc=$?
[ $rc -eq 0 ] && ok "auto_rollback completes" || bad "auto_rollback completes (rc=$rc)"
check "current repointed to previous" \
    "[ \"\$(readlink '$BASE/current' 2>/dev/null)\" = '$BASE/releases/1.0.0' ]"
check "incident logged with both versions" \
    "find '$BASE' -name '*.log' -exec cat {} + | grep -q '2.0.0' "

# guard: second auto_rollback in same incident must refuse
BASE_DIR="$BASE" bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/pv.sh'
    auto_rollback '2.0.0' 'health check failed again'" >/dev/null 2>&1
rc=$?
[ $rc -ne 0 ] && ok "repeat auto-rollback is guarded" || bad "repeat auto-rollback is guarded"
check "current still on 1.0.0 (no ping-pong)" \
    "[ \"\$(readlink '$BASE/current' 2>/dev/null)\" = '$BASE/releases/1.0.0' ]"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
