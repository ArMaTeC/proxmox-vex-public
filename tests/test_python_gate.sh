#!/bin/bash
# Spec 093/US029: python version gate — releases declare min/max python and
# the updater refuses incompatible targets before downloading.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US029 python-gate tests"

check "min_python in metadata"          "python3 -c 'import json; assert json.load(open(\"version.json\")).get(\"min_python\")'"
check "gate function exists"            "grep -q 'check_python_compat\|min_python' update.sh"
check "refusal names version"           "grep -qi 'python.*>=\|need python\|requires python' update.sh"
check "max_python supported"            "grep -q 'max_python' update.sh || grep -q 'max_python' version.schema.json"
check "schema allows min_python"        "grep -q 'min_python' version.schema.json"
check "shipped doc validates"           "python3 scripts/validate-version.py version.json"

# --- functional -------------------------------------------------------------------
SCRATCH=$(mktemp -d)
awk '/^check_python_compat\(\)/,/^}/' update.sh > "$SCRATCH/pc.sh"
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh"
PYV=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")

# current python meets min → pass
cat > "$SCRATCH/vj.json" <<JSON
{"min_python": "3.8"}
JSON
bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/pc.sh'
         check_python_compat '$SCRATCH/vj.json' '$PYV'" >/dev/null 2>&1
[ $? -eq 0 ] && ok "compatible python passes" || bad "compatible python passes"

# absurd min → refuse naming required version
cat > "$SCRATCH/vj.json" <<JSON
{"min_python": "9.9"}
JSON
out=$(bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/pc.sh'
      check_python_compat '$SCRATCH/vj.json' '3.11'" 2>&1); rc=$?
[ $rc -ne 0 ] && ok "old python refused" || bad "old python refused (rc=$rc)"
echo "$out" | grep -q '9.9' && ok "required version named" || bad "required version named (got: $out)"

# above max_python → refuse
cat > "$SCRATCH/vj.json" <<JSON
{"min_python": "3.8", "max_python": "3.11"}
JSON
out=$(bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/pc.sh'
      check_python_compat '$SCRATCH/vj.json' '3.12'" 2>&1); rc=$?
[ $rc -ne 0 ] && ok "above max refused" || bad "above max refused (rc=$rc out=$out)"

# no constraint → pass
cat > "$SCRATCH/vj.json" <<JSON
{"version": "1.0.0"}
JSON
bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/pc.sh'
         check_python_compat '$SCRATCH/vj.json' '3.9'" >/dev/null 2>&1
[ $? -eq 0 ] && ok "no constraint passes" || bad "no constraint passes"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
