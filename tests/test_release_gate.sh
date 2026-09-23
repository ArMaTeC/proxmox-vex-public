#!/bin/bash
# Spec 093/US058: release gating — the pipeline runs the app repo's lint +
# test suite + frontend build BEFORE any artifact is built; a red upstream
# gate kills the release.
set -u
cd "$(dirname "$0")/.." || exit

WF=".github/workflows/release.yml"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US058 release-gate tests"

check "gate job exists"                 "grep -q '^  gate:' $WF"
check "checks out app repo"             "grep -q 'repository.*ProxmoxVEx\|ArMaTeC' $WF"
check "lint runs"                       "grep -q 'ruff' $WF"
check "pytest runs"                     "grep -q 'pytest' $WF"
check "frontend build runs"             "grep -q 'build.sh' $WF"
check "build depends on gate"           "grep -A3 'name: Build, sign, and stage' $WF | grep -q 'needs.*gate\|needs:.*gate'"
check "gate is a hard dependency"       "grep -qE 'needs: *\[*[^]]*\bgate\b' $WF"
check "python setup for tests"          "grep -q 'setup-python\|python' $WF"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
