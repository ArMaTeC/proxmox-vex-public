#!/bin/bash
# Spec 093/US085: update-mechanism FAQ — docs/faq-updates.md answers the
# recurring admin questions and links to the detailed docs.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US085 update-FAQ tests"

check "doc exists"                    "test -f docs/faq-updates.md"
check "skip-versions Q"               "grep -qi 'skip.*version' docs/faq-updates.md"
check "internet/airgap Q"             "grep -qi 'internet\|offline\|airgap' docs/faq-updates.md"
check "failure Q"                     "grep -qi 'fail' docs/faq-updates.md"
check "pin/hold Q"                    "grep -qi 'pin\|hold' docs/faq-updates.md"
check "rollback Q"                    "grep -qi 'rollback\|downgrade' docs/faq-updates.md"
check "channel Q"                     "grep -qi 'channel\|beta\|canary' docs/faq-updates.md"
check "schedule/window Q"             "grep -qi 'window\|schedule\|when' docs/faq-updates.md"
check "verify/safety Q"               "grep -qi 'signature\|verify\|safe' docs/faq-updates.md"
check "deep-links to docs"            "grep -q 'upgrading.md' docs/faq-updates.md && grep -q 'airgap.md' docs/faq-updates.md"
check "links troubleshooting"         "grep -q 'troubleshooting.md' docs/faq-updates.md"
check "at least 8 questions"          "test \$(grep -c '?\*\*\|?\*$\|?$\|?' docs/faq-updates.md) -ge 8"
check "linked from README"            "grep -q 'faq-updates.md' README.md"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
