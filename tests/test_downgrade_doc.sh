#!/bin/bash
# Spec 093/US077: documented downgrade procedure — docs/downgrading.md
# states the supported window, the preferred --rollback path, the
# backup/state restore fallback, and data-compat caveats.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US077 downgrade-doc tests"

check "doc exists"                      "test -f docs/downgrading.md"
check "supported window stated"         "grep -qi 'supported.*window\|same minor' docs/downgrading.md"
check "--rollback preferred"            "grep -q '\-\-rollback' docs/downgrading.md"
check "state/backup restore covered"    "grep -qi 'state.tgz\|backup' docs/downgrading.md"
check "data-compat caveat"              "grep -qi 'migration\|schema\|database\|data compat' docs/downgrading.md"
check "verify step"                     "grep -qi 'healthz\|health' docs/downgrading.md"
check "linked from README"              "grep -q 'downgrading.md' README.md"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
