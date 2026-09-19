#!/bin/bash
# Spec 093/US049: optional TLS public-key pinning — VEX_TLS_PIN pins the dist
# host's cert pubkey so a valid-CA MITM can't intercept; VEX_TLS_PIN_BACKUP
# keeps updates working through a cert rotation.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US049 tls-pin tests"

check "pin env var supported"           "grep -q 'VEX_TLS_PIN' update.sh"
check "pinnedpubkey flag used"          "grep -q 'pinnedpubkey' update.sh"
check "sha256 pin format"               "grep -q 'sha256//' update.sh"
check "backup pin supported"            "grep -q 'VEX_TLS_PIN_BACKUP' update.sh"
check "pin helper exists"               "grep -q 'curl_pin_args\|tls_pin' update.sh"
check "wired into downloads"            "grep -c 'pinnedpubkey\|PIN' update.sh"
check "documented"                      "grep -qi 'VEX_TLS_PIN\|pin' README.md"

# --- functional: pin arg construction --------------------------------------------------
SCRATCH=$(mktemp -d)
awk '/^curl_pin_args\(\)/,/^}/' update.sh > "$SCRATCH/pin.sh"

out=$(VEX_TLS_PIN="abc123" bash -c "source '$SCRATCH/pin.sh'; curl_pin_args")
echo "$out" | grep -q 'pinnedpubkey sha256//abc123' \
    && ok "pin → --pinnedpubkey arg" || bad "pin → --pinnedpubkey arg (got: $out)"

out=$(VEX_TLS_PIN="abc" VEX_TLS_PIN_BACKUP="def" bash -c "source '$SCRATCH/pin.sh'; curl_pin_args")
echo "$out" | grep -q 'abc' && echo "$out" | grep -q 'def' \
    && ok "backup pin joined" || bad "backup pin joined (got: $out)"

out=$(bash -c "source '$SCRATCH/pin.sh'; curl_pin_args")
[ -z "$out" ] && ok "no pin → no args" || bad "no pin → no args (got: $out)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
