#!/bin/bash
# Spec 093/US082: SECURITY.md disclosure policy at repo root — contact,
# PGP key pointer, scope, and SLA commitments.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US082 SECURITY.md tests"

check "SECURITY.md exists"          "test -f SECURITY.md"
check "report contact"              "grep -qi 'security@' SECURITY.md"
check "PGP key pointer"             "grep -qi 'pgp\|pubkey' SECURITY.md"
check "acknowledgement SLA"         "grep -qi 'acknowledg\|48' SECURITY.md"
check "triage/fix SLA"              "grep -qi 'triage\|fix' SECURITY.md && grep -qi 'day\|critical' SECURITY.md"
check "scope stated"                "grep -qi 'scope' SECURITY.md"
check "safe harbor"                 "grep -qi 'safe harbor\|good.faith' SECURITY.md"
check "linked from README"          "grep -q 'SECURITY.md' README.md"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
