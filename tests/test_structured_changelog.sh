#!/bin/bash
# Spec 093/US026: changelog entries as structured objects {type, component,
# breaking, text} so clients can filter/group and flag breaking changes.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US026 structured-changelog tests"

check "changelog entries are objects"   "python3 -c 'import json; d=json.load(open(\"version.json\")); assert all(isinstance(e,dict) for e in d[\"changelog\"])'"
check "entries have type field"         "python3 -c 'import json; d=json.load(open(\"version.json\")); assert all(\"type\" in e for e in d[\"changelog\"])'"
check "entries have text field"         "python3 -c 'import json; d=json.load(open(\"version.json\")); assert all(\"text\" in e for e in d[\"changelog\"])'"
check "entries have breaking flag"      "python3 -c 'import json; d=json.load(open(\"version.json\")); assert all(\"breaking\" in e for e in d[\"changelog\"])'"
check "schema validates entries"        "python3 scripts/validate-version.py version.json"
check "breaking extractable"            "python3 -c 'import json; d=json.load(open(\"version.json\")); [e for e in d[\"changelog\"] if e.get(\"breaking\")]'"
check "updater surfaces breaking"       "grep -q 'warn_breaking\|breaking' update.sh"
check "version.json re-signed"          "[ -f version.json.asc ]"

# --- functional: updater flags breaking changes for the target -------------------
SCRATCH=$(mktemp -d)
awk '/^warn_breaking_changes\(\)/,/^}/' update.sh > "$SCRATCH/wb.sh"

cat > "$SCRATCH/vj.json" <<'JSON'
{"changelog": [
  {"type": "fix", "component": "api", "breaking": false, "text": "fix token persistence"},
  {"type": "breaking", "component": "auth", "breaking": true, "text": "scoped tokens required"}
]}
JSON

out=$(bash -c "source '$SCRATCH/wb.sh'; warn_breaking_changes '$SCRATCH/vj.json'" 2>&1)
echo "$out" | grep -q 'scoped tokens required' && ok "breaking entry surfaced" || bad "breaking entry surfaced (got: $out)"
echo "$out" | grep -qi 'BREAKING' && ok "breaking emphasis shown" || bad "breaking emphasis shown"
echo "$out" | grep -q 'fix token persistence' && bad "non-breaking not listed" || ok "non-breaking not listed"

# no breaking entries → silent
cat > "$SCRATCH/vj2.json" <<'JSON'
{"changelog": [{"type": "fix", "component": "api", "breaking": false, "text": "x"}]}
JSON
out=$(bash -c "source '$SCRATCH/wb.sh'; warn_breaking_changes '$SCRATCH/vj2.json'" 2>&1)
[ -z "$out" ] && ok "no breaking → silent" || bad "no breaking → silent (got: $out)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
