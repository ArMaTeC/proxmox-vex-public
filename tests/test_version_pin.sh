#!/bin/bash
# Spec 093/US018: version pinning & update hold — operators can freeze the
# install on an exact version or hold all updates during change freezes.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US018 version-pin/hold tests"

check "pin config file honored"      "grep -q 'update-pin\|PIN_VERSION' update.sh"
check "hold flag honored"            "grep -q 'UPDATE_HOLD\|update-hold' update.sh"
check "env override for pin"         "grep -q 'VEX_PIN_VERSION' update.sh"
check "env override for hold"        "grep -q 'VEX_UPDATE_HOLD' update.sh"
check "hold exits cleanly (0)"       "grep -q 'updates held\|update hold' update.sh"
check "pin overrides channel"        "grep -q 'resolve_update_target' update.sh"
check "already-at-pin message"       "grep -q 'already.*pinned\|already at\|up to date' update.sh"

# --- functional: resolution precedence ------------------------------------------
SCRATCH=$(mktemp -d)
awk '/^resolve_update_target\(\)/,/^}/' update.sh > "$SCRATCH/rt.sh"
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh"

# hold active → prints 'held', rc 0
mkdir -p "$SCRATCH/config" && echo 1 > "$SCRATCH/config/update-hold"
out=$(BASE_DIR="$SCRATCH" bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/rt.sh'
    resolve_update_target
" 2>&1); rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -qi 'held' \
    && ok "hold → rc 0 + held message" || bad "hold → rc 0 + held message (rc=$rc out=$out)"

# pin set → VERSION = pin
rm -f "$SCRATCH/config/update-hold"; echo 1.2.460 > "$SCRATCH/config/update-pin"
out=$(BASE_DIR="$SCRATCH" bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/rt.sh'
    resolve_update_target; echo \"\$VERSION|\$PINNED\"
" 2>&1)
echo "$out" | grep -q '1.2.460' && ok "pin → target version" || bad "pin → target version (got $out)"

# env pin beats file pin
echo 1.2.460 > "$SCRATCH/config/update-pin"
out=$(BASE_DIR="$SCRATCH" VEX_PIN_VERSION=9.9.9 bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/rt.sh'
    resolve_update_target; echo \"\$VERSION\"
" 2>&1)
echo "$out" | grep -q '9.9.9' && ok "env pin overrides file pin" || bad "env pin overrides file pin (got $out)"

# no pin, no hold → falls through to channel resolution (VERSION untouched)
rm -f "$SCRATCH/config/update-pin"
out=$(BASE_DIR="$SCRATCH" UPDATE_CHANNEL=beta bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/rt.sh'
    resolve_update_target; echo \"ch=\$UPDATE_CHANNEL pin=\${PINNED:-0}\"
" 2>&1)
echo "$out" | grep -q 'ch=beta' && echo "$out" | grep -q 'pin=0' \
    && ok "no pin → channel resolution proceeds" || bad "no pin → channel resolution (got $out)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
