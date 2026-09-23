#!/bin/bash
# Spec 093/US027: mirror list in release metadata — when the primary host is
# unreachable, the updater tries listed mirrors in order.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US027 mirror-failover tests"

check "mirrors list in version.json"    "python3 -c 'import json; assert json.load(open(\"version.json\")).get(\"mirrors\")'"
check "mirror selection in update.sh"   "grep -q 'select_mirror\|mirrors' update.sh"
check "preferred mirror env"            "grep -q 'VEX_MIRROR\|PREFERRED_MIRROR' update.sh"
check "tries mirrors in order"          "grep -q 'for.*mirror\|for base\|for B' update.sh"
check "fails when none reachable"       "grep -qi 'no reachable mirror' update.sh"
check "schema allows mirrors"           "grep -q 'mirrors' version.schema.json"
check "shipped doc validates"           "python3 scripts/validate-version.py version.json"

# --- functional: failover order ---------------------------------------------------
SCRATCH=$(mktemp -d)
awk '/^select_mirror\(\)/,/^}/' update.sh > "$SCRATCH/sm.sh"
awk '/^curl_secret_conf\(\)/,/^}/' update.sh >> "$SCRATCH/sm.sh"

# two fake mirrors: m1 dead (no file), m2 has the archive
mkdir -p "$SCRATCH/m1" "$SCRATCH/m2" "$SCRATCH/primary"
echo x > "$SCRATCH/m2/ProxmoxVEx-1.0.0.tar.gz"
cat > "$SCRATCH/vj.json" <<JSON
{"mirrors": ["file://$SCRATCH/m1", "file://$SCRATCH/m2"]}
JSON

out=$(bash -c "source '$SCRATCH/sm.sh'
      select_mirror '$SCRATCH/vj.json' 'ProxmoxVEx-1.0.0.tar.gz' 'file://$SCRATCH/primary'" 2>&1)
[ "$out" = "file://$SCRATCH/m2" ] && ok "falls through to reachable mirror" || bad "falls through to reachable mirror (got: $out)"

# preferred mirror env wins even when listed mirrors exist
mkdir -p "$SCRATCH/pref" && echo x > "$SCRATCH/pref/ProxmoxVEx-1.0.0.tar.gz"
out=$(VEX_MIRROR="file://$SCRATCH/pref" bash -c "source '$SCRATCH/sm.sh'
      select_mirror '$SCRATCH/vj.json' 'ProxmoxVEx-1.0.0.tar.gz' 'file://$SCRATCH/primary'" 2>&1)
[ "$out" = "file://$SCRATCH/pref" ] && ok "VEX_MIRROR preferred" || bad "VEX_MIRROR preferred (got: $out)"

# primary reachable → used (after listed mirrors? no—primary is the default base)
echo x > "$SCRATCH/primary/ProxmoxVEx-1.0.0.tar.gz"
out=$(bash -c "source '$SCRATCH/sm.sh'
      select_mirror '$SCRATCH/vj.json' 'ProxmoxVEx-1.0.0.tar.gz' 'file://$SCRATCH/primary'" 2>&1)
[ -n "$out" ] && ok "a reachable base selected" || bad "a reachable base selected"

# none reachable → nonzero
cat > "$SCRATCH/vj2.json" <<JSON
{"mirrors": ["file://$SCRATCH/m1", "file://$SCRATCH/none"]}
JSON
bash -c "source '$SCRATCH/sm.sh'
         select_mirror '$SCRATCH/vj2.json' 'nope.tar.gz' 'file://$SCRATCH/nowhere'" >/dev/null 2>&1
[ $? -ne 0 ] && ok "no reachable mirror → nonzero" || bad "no reachable mirror → nonzero"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
