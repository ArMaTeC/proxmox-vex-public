#!/bin/bash
# Spec 093/US081: release cadence & versioning policy — docs/versioning.md
# states the numbering scheme, per-channel cadence, and support windows.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US081 versioning-doc tests"

check "doc exists"                  "test -f docs/versioning.md"
check "numbering scheme stated"     "grep -q 'MAJOR.MINOR.PATCH\|MAJOR\.MINOR' docs/versioning.md"
check "patch cadence"               "grep -qi 'patch' docs/versioning.md"
check "minor cadence"               "grep -qi 'minor' docs/versioning.md"
check "major cadence"               "grep -qi 'major' docs/versioning.md"
check "lts policy"                  "grep -qi 'LTS' docs/versioning.md"
check "channel cadence"             "grep -qi 'canary\|beta\|stable' docs/versioning.md"
check "channels doc referenced"     "grep -q 'channels.md' docs/versioning.md"
check "linked from README"          "grep -q 'versioning.md' README.md"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
