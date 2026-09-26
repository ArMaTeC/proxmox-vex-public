#!/bin/bash
# Spec 093/US053: one-command version bump — version.json's version/build/
# release_date update atomically, a changelog stub is added, the metadata is
# re-signed, and the file is staged for commit.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US053 bump-version tests"

check "bump script exists"              "[ -f scripts/bump-version.sh ]"
check "script is executable"            "[ -x scripts/bump-version.sh ]"
check "updates version field"           "grep -q 'version' scripts/bump-version.sh"
check "updates release_date"            "grep -q 'release_date' scripts/bump-version.sh"
check "changelog stub added"            "grep -q 'changelog' scripts/bump-version.sh"
check "re-signs metadata"               "grep -q 'sign-version' scripts/bump-version.sh"
check "stages the file"                 "grep -q 'git add' scripts/bump-version.sh"
check "semver validated"                "grep -q '[0-9]\\\\+\|semver\|validate' scripts/bump-version.sh"

# --- functional: bump in a scratch copy ------------------------------------------------
SCRATCH=$(mktemp -d)
cp version.json "$SCRATCH/"
cat > "$SCRATCH/run.sh" <<EOS
cd "$SCRATCH"
bash "$PWD/scripts/bump-version.sh" 9.9.9
EOS
bash "$SCRATCH/run.sh" >/dev/null 2>&1; rc=$?

python3 -c "import json;d=json.load(open('$SCRATCH/version.json'));assert d['version']=='9.9.9'" \
    && ok "version bumped" || bad "version bumped (rc=$rc)"
python3 -c "import json;d=json.load(open('$SCRATCH/version.json'));import re;assert re.match(r'\d{4}-\d{2}-\d{2}', d['release_date'])" \
    && ok "release_date updated" || bad "release_date updated"
python3 -c "import json;d=json.load(open('$SCRATCH/version.json'));assert any('9.9.9' in (e.get('text','') if isinstance(e,dict) else e) for e in d['changelog'])" \
    && ok "changelog stub inserted" || bad "changelog stub inserted"

# invalid semver rejected
cp version.json "$SCRATCH/bad.json"
bash -c "cd '$SCRATCH'; cp bad.json version.json
  bash '$PWD/scripts/bump-version.sh' notaversion" >/dev/null 2>&1
[ $? -ne 0 ] && ok "non-semver rejected" || bad "non-semver rejected"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
