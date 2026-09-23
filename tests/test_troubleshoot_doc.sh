#!/bin/bash
# Spec 093/US079: update troubleshooting runbook — docs/troubleshooting.md
# maps the real failure symptoms the updater emits to causes and fixes.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US079 troubleshooting-doc tests"

check "doc exists"                        "test -f docs/troubleshooting.md"
check "lock-held symptom mapped"          "grep -qi 'lock' docs/troubleshooting.md"
check "checksum symptom mapped"           "grep -qi 'checksum' docs/troubleshooting.md"
check "health-timeout symptom mapped"     "grep -qi 'health' docs/troubleshooting.md"
check "signature symptom mapped"          "grep -qi 'signature\|gpg' docs/troubleshooting.md"
check "cause+fix structure"               "grep -qi 'cause' docs/troubleshooting.md && grep -qi 'fix\|resolut' docs/troubleshooting.md"
check "failure-report pointer"            "grep -q 'update-failure.json' docs/troubleshooting.md"
check "linked from README"                "grep -q 'troubleshooting.md' README.md"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
