#!/bin/bash
# Spec 093/US086: bats unit tests for update.sh functions —
# tests/update.bats exercises the pure helpers (version_ge, in_window,
# pick_archive_ext, assert_update_scheme, ...) via awk extraction.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US086 bats-suite tests"

check "bats available"              "command -v bats"
check "bats suite exists"           "test -f tests/update.bats"
check "covers version_ge"           "grep -q 'version_ge' tests/update.bats"
check "covers in_window"            "grep -q 'in_window' tests/update.bats"
check "covers pick_archive_ext"     "grep -q 'pick_archive_ext' tests/update.bats"
check "covers scheme gate"          "grep -q 'assert_update_scheme' tests/update.bats"
check "at least 8 @test cases"      "test \$(grep -c '@test' tests/update.bats) -ge 8"

if command -v bats >/dev/null && [ -f tests/update.bats ]; then
  if bats tests/update.bats >/dev/null 2>&1; then
    ok "bats suite green"
  else
    bad "bats suite green"
  fi
else
  bad "bats suite green"
fi

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
