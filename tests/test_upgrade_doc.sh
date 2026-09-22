#!/bin/bash
# Spec 093/US076: step-by-step upgrade guide — docs/upgrading.md walks a
# first-time admin through preflight, update, verify, and rollback using
# the real flags the updater supports.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US076 upgrade-guide tests"

check "guide exists"                    "test -f docs/upgrading.md"
check "preflight section"               "grep -qi 'preflight' docs/upgrading.md"
check "--dry-run documented"            "grep -q '\-\-dry-run' docs/upgrading.md"
check "--yes documented"                "grep -q '\-\-yes' docs/upgrading.md"
check "update step"                     "grep -qi 'update.sh' docs/upgrading.md"
check "verify step"                     "grep -qi 'healthz\|health' docs/upgrading.md"
check "rollback step"                   "grep -q '\-\-rollback' docs/upgrading.md"
check "disk space guidance"             "grep -qi 'df -h\|disk' docs/upgrading.md"
check "linked from README"              "grep -q 'upgrading.md' README.md"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
