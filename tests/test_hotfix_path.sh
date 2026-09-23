#!/bin/bash
# Spec 093/US060: expedited security hotfix path — documented drill +
# a workflow that ships a critical fix with reduced gates but keeps human
# approval and mandates post-review.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

HF=".github/workflows/hotfix.yml"

echo "US060 hotfix-path tests"

check "hotfix doc exists"               "[ -f docs/hotfix.md ]"
check "doc names qualifying criteria"   "grep -qi 'CVSS\|critical\|severity' docs/hotfix.md"
check "doc covers reduced gates"        "grep -qi 'skip\|reduced\|bypass' docs/hotfix.md"
check "doc mandates post-review"        "grep -qi 'post-review\|posthoc\|7 day' docs/hotfix.md"
check "workflow exists"                 "[ -f $HF ]"
check "manual dispatch only"            "grep -q 'workflow_dispatch' $HF"
check "cve input required"              "grep -A2 'cve' $HF | grep -q 'required: true'"
check "justification required"          "grep -A2 'justification' $HF | grep -q 'required: true'"
check "production approval kept"        "grep -q 'environment.*production' $HF"
check "smoke gate still runs"           "grep -q 'e2e-update-test\|smoke' $HF"
check "post-review issue filed"         "grep -q 'issue create\|POST_REVIEW' $HF"
check "publishes direct to stable"      "grep -q 'publish\|stable' $HF"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
