#!/bin/bash
# Spec 093/US083: changelog preview before update — update.sh prints the
# changelog entries newer than the installed version before the confirm
# prompt, flagging breaking ones.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US083 changelog-preview tests"

check "show_changelog defined"    "grep -q 'show_changelog()' update.sh"
check "wired before confirm"      "test \$(grep -c 'show_changelog \"\$VERSION_DOC\"' update.sh) -ge 1"

SCRATCH=$(mktemp -d); trap 'rm -rf "$SCRATCH"' EXIT
cat > "$SCRATCH/v.json" <<'EOF'
{"changelog":[
  {"type":"feat","component":"ui","breaking":false,
   "text":"1.2.475 (2026-09-25) - New dashboard widgets"},
  {"type":"fix","component":"api","breaking":true,
   "text":"1.2.474 (2026-09-21) - Drop legacy auth endpoint (BREAKING)"},
  {"type":"fix","component":"api","breaking":false,
   "text":"1.2.473 (2026-09-20) - Fix token refresh"},
  {"type":"fix","component":"api","breaking":false,
   "text":"1.2.472 (2026-09-19) - Older change"}
]}
EOF

awk '/^show_changelog\(\)/,/^}/' update.sh > "$SCRATCH/fn.sh"
check "extraction non-empty"      "test -s $SCRATCH/fn.sh"

OUT=$(bash -c ". $SCRATCH/fn.sh; show_changelog $SCRATCH/v.json 1.2.472" 2>&1)
check "shows newer entries"       "echo \"\$OUT\" | grep -q '1.2.475'"
check "includes all newer"        "echo \"\$OUT\" | grep -q '1.2.474' && echo \"\$OUT\" | grep -q '1.2.473'"
check "omits installed+older"     "! echo \"\$OUT\" | grep -q 'Older change'"
check "flags breaking"            "echo \"\$OUT\" | grep -qi 'BREAKING'"
check "silent when up to date"    "test -z \"\$(bash -c '. $SCRATCH/fn.sh; show_changelog $SCRATCH/v.json 1.2.475' 2>&1)\""
check "missing doc no-op"         "bash -c '. $SCRATCH/fn.sh; show_changelog /nonexistent 1.2.472' >/dev/null 2>&1"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
