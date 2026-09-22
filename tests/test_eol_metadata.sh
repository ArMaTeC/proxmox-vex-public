#!/bin/bash
# Spec 093/US023: support-until dates in release metadata — admins get warned
# when their installed version has left support.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US023 EOL-metadata tests"

check "releases map in version.json"    "python3 -c 'import json; json.load(open(\"version.json\"))[\"releases\"]'"
check "support_until present"           "grep -q 'support_until' version.json"
check "EOL check in update.sh"          "grep -q 'check_eol\|support_until' update.sh"
check "warns past EOL"                  "grep -qi 'EOL\|left support\|end of life' update.sh"
check "schema allows releases"          "grep -q 'releases\|support_until' version.schema.json"
check "shipped doc still validates"     "python3 scripts/validate-version.py version.json"

# --- functional: EOL verdicts -----------------------------------------------------
SCRATCH=$(mktemp -d)
awk '/^check_eol\(\)/,/^}/' update.sh > "$SCRATCH/eol.sh"

cat > "$SCRATCH/vj.json" <<'JSON'
{"releases": {"1.0.0": {"support_until": "2020-01-01"},
              "9.9.9": {"support_until": "2999-01-01"}}}
JSON

# past EOL → warns, rc 0 (advisory)
out=$(TODAY_OVERRIDE=2026-01-01 bash -c "source '$SCRATCH/eol.sh'
      check_eol 1.0.0 '$SCRATCH/vj.json'" 2>&1); rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -qi 'EOL\|support' \
    && ok "past-EOL warns (advisory)" || bad "past-EOL warns (rc=$rc out=$out)"

# within support → silent
out=$(TODAY_OVERRIDE=2026-01-01 bash -c "source '$SCRATCH/eol.sh'
      check_eol 9.9.9 '$SCRATCH/vj.json'" 2>&1)
[ -z "$out" ] && ok "in-support stays quiet" || bad "in-support stays quiet (got: $out)"

# unknown version → silent (no data, no false alarm)
out=$(TODAY_OVERRIDE=2026-01-01 bash -c "source '$SCRATCH/eol.sh'
      check_eol 5.5.5 '$SCRATCH/vj.json'" 2>&1)
[ -z "$out" ] && ok "unknown version silent" || bad "unknown version silent (got: $out)"

# missing metadata file → silent
out=$(bash -c "source '$SCRATCH/eol.sh'
      check_eol 1.0.0 '$SCRATCH/nonexistent.json'" 2>&1)
[ -z "$out" ] && ok "missing doc silent" || bad "missing doc silent (got: $out)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
