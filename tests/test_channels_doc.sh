#!/bin/bash
# Spec 093/US030: documented channel promotion policy — beta/stable/lts
# criteria, soak times, support windows, hotfix path.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US030 channels-doc tests"

check "channels doc exists"             "[ -f docs/channels.md ]"
check "beta defined"                    "grep -qi 'beta' docs/channels.md"
check "stable defined"                  "grep -qi 'stable' docs/channels.md"
check "lts defined"                     "grep -qi 'lts' docs/channels.md"
check "soak time documented"            "grep -qi 'soak' docs/channels.md"
check "support window documented"       "grep -qi 'support' docs/channels.md"
check "promotion criteria"              "grep -qi 'promot' docs/channels.md"
check "hotfix path documented"          "grep -qi 'hotfix' docs/channels.md"
check "links to update-channel usage"   "grep -q 'update-channel\|VEX_CHANNEL' docs/channels.md"
check "referenced from README/docs"     "grep -rqi 'channels.md' README.md docs/ update.sh 2>/dev/null"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
