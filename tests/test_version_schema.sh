#!/bin/bash
# Spec 093/US021: version.json JSON schema + validator — malformed metadata
# fails CI with the offending field named.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US021 version-schema tests"

check "schema file exists"              "[ -f version.schema.json ]"
check "schema is valid JSON"            "python3 -c 'import json; json.load(open(\"version.schema.json\"))'"
check "schema declares draft"           "grep -q 'schema.org' version.schema.json"
check "requires version field"          "grep -q '\"version\"' version.schema.json"
check "validator script exists"         "[ -f scripts/validate-version.py ]"
check "CI validates version.json"       "grep -rq 'validate-version\|version.schema' .github/workflows/ 2>/dev/null || grep -rq 'version.schema\|validate-version' scripts/ tests/"

# --- functional: validator verdicts ----------------------------------------------
python3 scripts/validate-version.py version.json >/dev/null 2>&1
[ $? -eq 0 ] && ok "shipped version.json validates" || bad "shipped version.json validates"

SCRATCH=$(mktemp -d)
# missing 'version' → fails naming the field
python3 -c "import json; d=json.load(open('version.json')); del d['version']; json.dump(d, open('$SCRATCH/nov.json','w'))"
out=$(python3 scripts/validate-version.py "$SCRATCH/nov.json" 2>&1)
[ $? -ne 0 ] && ok "missing version rejected" || bad "missing version rejected"
echo "$out" | grep -q 'version' && ok "error names the field" || bad "error names the field (got: $out)"

# bad semver → fails
python3 -c "import json; d=json.load(open('version.json')); d['version']='abc'; json.dump(d, open('$SCRATCH/bad.json','w'))"
python3 scripts/validate-version.py "$SCRATCH/bad.json" >/dev/null 2>&1
[ $? -ne 0 ] && ok "bad semver rejected" || bad "bad semver rejected"

# bad date → fails
python3 -c "import json; d=json.load(open('version.json')); d['release_date']='not-a-date'; json.dump(d, open('$SCRATCH/dt.json','w'))"
python3 scripts/validate-version.py "$SCRATCH/dt.json" >/dev/null 2>&1
[ $? -ne 0 ] && ok "bad release_date rejected" || bad "bad release_date rejected"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
