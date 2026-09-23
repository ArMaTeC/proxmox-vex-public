#!/bin/bash
# Spec 093/US051: automated release pipeline — pushing a v* tag triggers
# build → sign → stage → verify → promote with a production environment
# gate; repeatable and auditable, no manual steps.
set -u
cd "$(dirname "$0")/.." || exit

WF=".github/workflows/release.yml"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US051 release-pipeline tests"

check "tag trigger"                     "grep -A3 'push' $WF | grep -q 'tags'"
check "v* tags matched"                 "grep -q 'v\*' $WF"
check "build step runs builder"         "grep -q 'build-release.sh' $WF"
check "sign step runs signer"           "grep -q 'sign-release.sh' $WF"
check "key comes from secrets"          "grep -q 'secrets\.' $WF"
check "staging publish step"            "grep -q 'publish.sh' $WF"
check "verify job depends on build"     "grep -B2 'needs' $WF | grep -qi 'verify\|e2e\|staging'"
check "promote job exists"              "grep -qi 'promote' $WF"
check "production environment gate"     "grep -q 'environment' $WF"
check "promote runs promote.sh"         "grep -q 'promote.sh' $WF"
check "checksums regenerated"           "grep -q 'checksums' $WF"
check "artifact upload for audit"       "grep -q 'upload-artifact' $WF"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
