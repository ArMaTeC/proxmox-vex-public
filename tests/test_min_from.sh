#!/bin/bash
# Spec 093/US024: minimum-source-version — releases declare the oldest
# version they can upgrade from; ancient installs get a stepping-stone.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US024 min-from tests"

check "min_from in version.json"        "grep -q 'min_from' version.json"
check "version compare helper"          "grep -q 'version_ge\|version_lt' update.sh"
check "min_from check exists"           "grep -q 'check_min_from\|min_from' update.sh"
check "refusal names intermediate"      "grep -qi 'first\|stepping\|intermediate\|via' update.sh"
check "schema allows min_from"          "grep -q 'min_from' version.schema.json"
check "shipped doc validates"           "python3 scripts/validate-version.py version.json"

# --- functional -------------------------------------------------------------------
SCRATCH=$(mktemp -d)
awk '/^check_min_from\(\)/,/^}/' update.sh > "$SCRATCH/mf.sh"
awk '/^version_ge\(\)/,/^}/' update.sh >> "$SCRATCH/mf.sh"
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh"

cat > "$SCRATCH/vj.json" <<'JSON'
{"releases": {"2.0.0": {"min_from": "1.5.0", "via": "1.5.0"},
              "1.5.0": {"min_from": "0.0.0"}}}
JSON

# current below min_from → refused, names the stepping stone
out=$(bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/mf.sh'
      check_min_from 1.0.0 2.0.0 '$SCRATCH/vj.json'" 2>&1); rc=$?
[ $rc -ne 0 ] && ok "below min_from refused" || bad "below min_from refused (rc=$rc)"
echo "$out" | grep -q '1.5.0' && ok "stepping stone named" || bad "stepping stone named (got: $out)"

# current meets min_from → passes silently
bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/mf.sh'
         check_min_from 1.6.0 2.0.0 '$SCRATCH/vj.json'" >/dev/null 2>&1
[ $? -eq 0 ] && ok "meets min_from passes" || bad "meets min_from passes"

# target with no constraint → passes
bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/mf.sh'
         check_min_from 1.0.0 1.5.0 '$SCRATCH/vj.json'" >/dev/null 2>&1
[ $? -eq 0 ] && ok "unconstrained target passes" || bad "unconstrained target passes"

# semver correctness: 1.10.0 > 1.9.0 (not lexicographic)
cat > "$SCRATCH/vj2.json" <<'JSON'
{"releases": {"2.0.0": {"min_from": "1.9.0"}}}
JSON
bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/mf.sh'
         check_min_from 1.10.0 2.0.0 '$SCRATCH/vj2.json'" >/dev/null 2>&1
[ $? -eq 0 ] && ok "semver: 1.10.0 >= 1.9.0" || bad "semver: 1.10.0 >= 1.9.0"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
