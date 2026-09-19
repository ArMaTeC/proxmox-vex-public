#!/bin/bash
# Spec 093/US064: dedicated append-only update log — every update stage
# (check, download, verify, swap, rollback) lands a timestamped line in
# logs/update.log (or shared/logs/), rotated at >1MB.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US064 update-log tests"

check "update.log target"               "grep -q 'update.log' update.sh"
check "rotation at >1MB"                "grep -q '1048576' update.sh"
check "check stage logged"              "grep -q 'log_update \"check' update.sh"
check "download stage logged"           "grep -q 'log_update \"download' update.sh"
check "verify stage logged"             "grep -q 'log_update \"verif' update.sh"
check "swap stage logged"               "grep -qE 'log_update \"(swap|activat)' update.sh"
check "rollback stage logged"           "grep -q 'log_update.*rollback' update.sh"

# --- functional: extract log_update, emit entries, rotate -----------------
SCRATCH=$(mktemp -d)
awk '/^log_update\(\)/,/^}/' update.sh > "$SCRATCH/fn.sh"

out=$(BASE_DIR="$SCRATCH" CURRENT_VERSION=1.0.0 LATEST_VERSION=2.0.0 \
      bash -c "source '$SCRATCH/fn.sh'; log_update 'swap done'" 2>&1)
LOG=""
for d in "$SCRATCH/shared/logs" "$SCRATCH/logs"; do [ -f "$d/update.log" ] && LOG="$d/update.log"; done
[ -n "$LOG" ] && ok "update.log created" || bad "update.log created ($out)"

grep -q '1.0.0' "$LOG" 2>/dev/null && grep -q '2.0.0' "$LOG" 2>/dev/null \
    && ok "version transition recorded" || bad "version transition recorded"
grep -q 'swap done' "$LOG" 2>/dev/null \
    && ok "message recorded" || bad "message recorded"
grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' "$LOG" 2>/dev/null \
    && ok "ISO timestamped" || bad "ISO timestamped"

# rotation: >1MB existing log gets moved to .1
head -c 1100000 /dev/zero > "$LOG"
BASE_DIR="$SCRATCH" bash -c "source '$SCRATCH/fn.sh'; log_update 'after-rotate'" >/dev/null 2>&1
[ -f "$LOG.1" ] && ok "rotated to update.log.1" || bad "rotated to update.log.1"
sz=$(stat -c%s "$LOG" 2>/dev/null || echo 9)
[ "$sz" -lt 1048576 ] \
    && ok "fresh log small after rotate" || bad "fresh log small after rotate"
grep -q 'after-rotate' "$LOG" && ok "append continued after rotate" || bad "append continued after rotate"

# append-only: second write appends, doesn't truncate
BASE_DIR="$SCRATCH" bash -c "source '$SCRATCH/fn.sh'; log_update 'line-two'" >/dev/null 2>&1
n=$(grep -c . "$LOG")
[ "$n" -ge 2 ] && ok "appends (n=$n)" || bad "appends (n=$n)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
