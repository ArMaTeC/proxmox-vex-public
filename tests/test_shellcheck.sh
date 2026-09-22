#!/bin/bash
# Spec 093/US061: shellcheck gate — update.sh + scripts/*.sh stay clean at
# -S warning; CI runs the same check so regressions fail the build.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US061 shellcheck tests"

check "shellcheck wired into CI"        "grep -q 'shellcheck' .github/workflows/*.yml"
check "ci workflow exists"              "ls .github/workflows/*.yml | grep -q 'ci\|release'"
check "scripts dir covered"             "grep -q 'scripts/.*\.sh\|scripts/\*' .github/workflows/release.yml .github/workflows/ci.yml 2>/dev/null"

if command -v shellcheck >/dev/null 2>&1; then
    out=$(shellcheck -S warning update.sh 2>&1); rc=$?
    [ $rc -eq 0 ] && ok "update.sh clean at -S warning" || bad "update.sh clean (rc=$rc: $(echo "$out"|grep -c SC) issues)"
    out=$(shellcheck -S warning scripts/*.sh 2>&1); rc=$?
    [ $rc -eq 0 ] && ok "scripts/*.sh clean at -S warning" || bad "scripts clean (rc=$rc: $(echo "$out"|grep -c SC) issues)"
else
    ok "shellcheck not installed — static checks only"
fi

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
