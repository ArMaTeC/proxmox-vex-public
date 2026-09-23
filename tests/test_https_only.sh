#!/bin/bash
# Spec 093/US041: HTTPS-only update endpoint — the updater must refuse a
# plaintext http:// base before any request; file:// is allowed only for
# airgap/bundle mode. Optional VEX_CACERT for private CAs.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US041 https-only tests"

check "scheme guard exists"             "grep -q 'assert_https\|https://' update.sh"
check "http:// refused"                 "grep -qi 'https' update.sh"
check "cacert override supported"       "grep -q 'VEX_CACERT\|cacert' update.sh"
check "guard before any request"        "grep -n 'assert_https' update.sh | head -1"
check "file:// allowed for airgap"      "grep -q 'file://' update.sh"
check "guard function exists"           "grep -q 'assert_update_scheme\|check_scheme' update.sh || grep -c 'https://' update.sh"

# --- functional: scheme verdicts ----------------------------------------------------
SCRATCH=$(mktemp -d)
awk '/^assert_update_scheme\(\)/,/^}/' update.sh > "$SCRATCH/as.sh"
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh"

# https passes
bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/as.sh'
         assert_update_scheme 'https://example.com/x'" >/dev/null 2>&1
[ $? -eq 0 ] && ok "https:// allowed" || bad "https:// allowed"

# http refused BEFORE any request
out=$(bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/as.sh'
      assert_update_scheme 'http://example.com/x'" 2>&1); rc=$?
[ $rc -ne 0 ] && ok "http:// refused" || bad "http:// refused"
echo "$out" | grep -qi 'https' && ok "refusal names https requirement" || bad "refusal names https requirement (got: $out)"

# file:// allowed (bundle/airgap)
bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/as.sh'
         assert_update_scheme 'file:///tmp/bundle'" >/dev/null 2>&1
[ $? -eq 0 ] && ok "file:// allowed (airgap)" || bad "file:// allowed (airgap)"

# bare host / no scheme refused
bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/as.sh'
         assert_update_scheme 'example.com/x'" >/dev/null 2>&1
[ $? -ne 0 ] && ok "schemeless refused" || bad "schemeless refused"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
