#!/bin/bash
# Spec 093/US056: canary cohort — a canary channel serves an opt-in cohort
# first; only canary-subscribed installs see it, and promote.sh moves a
# soaked canary to stable.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US056 canary-channel tests"

check "canary channel in version.json"  "python3 -c \"import json;assert 'canary' in json.load(open('version.json'))['channels']\""
check "canary marks cohort opt-in"      "python3 -c \"import json;c=json.load(open('version.json'))['channels']['canary'];assert c.get('cohort')=='opt-in'\""
check "channels doc exists"             "[ -f docs/channels.md ]"
check "doc describes soak→promote"      "grep -qi 'soak\|promote' docs/channels.md"
check "schema allows cohort field"      "grep -q 'cohort' version.schema.json"
check "promote.sh canary→stable"        "grep -q 'canary' scripts/promote.sh"
check "updater honors channel file"     "grep -q 'update-channel' update.sh"

# --- functional: canary subscribers get canary, stable gets stable ---------------------
SCRATCH=$(mktemp -d)
cat > "$SCRATCH/version.json" <<'JSON'
{"channels":{"canary":{"version":"2.0.0b1","archive":"a.tar.gz","cohort":"opt-in"},
             "stable":{"version":"1.9.9","archive":"b.tar.gz"}}}
JSON
awk '/^resolve_channel_release\(\)/,/^}/' update.sh > "$SCRATCH/rc.sh"

out=$(bash -c "source '$SCRATCH/rc.sh'; resolve_channel_release '$SCRATCH/version.json' canary")
echo "$out" | grep -q '2.0.0b1' && ok "canary sub → canary version" || bad "canary sub → canary version (got: $out)"

out=$(bash -c "source '$SCRATCH/rc.sh'; resolve_channel_release '$SCRATCH/version.json' stable")
echo "$out" | grep -q '1.9.9' && ok "stable sub → stable version" || bad "stable sub → stable version (got: $out)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
