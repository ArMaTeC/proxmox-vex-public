#!/bin/bash
# Spec 093/US019: maintenance-window gate — updates only apply inside the
# configured window; outside, defer cleanly with the window info.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US019 maintenance-window tests"

check "window check implemented"        "grep -q 'in_window' update.sh"
check "config file supported"           "grep -q 'update-window' update.sh"
check "env override"                    "grep -q 'VEX_UPDATE_WINDOW\|UPDATE_WINDOW' update.sh"
check "outside-window defer message"    "grep -qi 'outside.*window\|deferred' update.sh"
check "force bypasses window"           "grep -qi 'force' update.sh"
check "overnight window handled"        "grep -q 'START.*END\|start.*end' update.sh"

# --- functional: in_window truth table ------------------------------------------
SCRATCH=$(mktemp -d)
awk '/^in_window\(\)/,/^}/' update.sh > "$SCRATCH/iw.sh"

run() {  # run <window> <now>
    UPDATE_WINDOW="$1" NOW_OVERRIDE="$2" bash -c "
        source '$SCRATCH/iw.sh'; in_window
    " >/dev/null 2>&1
}

run "02:00-04:00" "03:00"; [ $? -eq 0 ] && ok "inside window"              || bad "inside window"
run "02:00-04:00" "14:00"; [ $? -ne 0 ] && ok "outside window"             || bad "outside window"
run "22:00-02:00" "23:30"; [ $? -eq 0 ] && ok "overnight: late side"       || bad "overnight: late side"
run "22:00-02:00" "01:00"; [ $? -eq 0 ] && ok "overnight: early side"      || bad "overnight: early side"
run "22:00-02:00" "12:00"; [ $? -ne 0 ] && ok "overnight: midday rejected" || bad "overnight: midday rejected"
run ""            "12:00"; [ $? -eq 0 ] && ok "no window → always allowed" || bad "no window → always allowed"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
