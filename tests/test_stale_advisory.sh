#!/bin/bash
# Spec 093/US073: stale-version advisory — the update check reports how
# many published releases are newer than the installed version and how
# many of those carry security fixes.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US073 stale-advisory tests"

check "advisory function exists"        "grep -q 'warn_stale_version' update.sh"
check "counts releases"                 "grep -q 'releases' update.sh"
check "security count surfaced"         "grep -q 'security' update.sh"
check "wired into update flow"          "grep -q 'warn_stale_version \"\$VERSION_DOC\"' update.sh"

# --- functional: extract + run against a fixture doc ------------------------
SCRATCH=$(mktemp -d)
printf 'die() { echo "die: $*" >&2; exit 1; }\n' > "$SCRATCH/fn.sh"
awk '/^warn_stale_version\(\)/,/^}/' update.sh >> "$SCRATCH/fn.sh"

cat > "$SCRATCH/vj.json" <<'JSON'
{"releases": {
  "1.2.300": {"support_until": "2027-01-01"},
  "1.2.400": {"support_until": "2027-06-01"},
  "1.2.460": {"security": {"severity": "high", "advisory": "https://x/adv"}},
  "1.2.470": {"security": {"severity": "critical", "advisory": "https://x/adv2"}},
  "1.2.472": {"support_until": "2027-09-17"}
}}
JSON

# from 1.2.300 → 4 newer (400,460,470,472), 2 security
out=$(bash -c "source '$SCRATCH/fn.sh'; warn_stale_version '$SCRATCH/vj.json' '1.2.300'" 2>&1)
echo "$out" | grep -q '4 release' && ok "versions-behind count (got: $out)" || bad "versions-behind count (got: $out)"
echo "$out" | grep -q '2 security' && ok "security count" || bad "security count ($out)"

# from 1.2.460 → 2 newer, 1 security
out=$(bash -c "source '$SCRATCH/fn.sh'; warn_stale_version '$SCRATCH/vj.json' '1.2.460'" 2>&1)
echo "$out" | grep -q '2 release' && ok "smaller gap counts right" || bad "smaller gap ($out)"
echo "$out" | grep -q '1 security' && ok "security recount" || bad "security recount ($out)"

# current version → no advisory at all
out=$(bash -c "source '$SCRATCH/fn.sh'; warn_stale_version '$SCRATCH/vj.json' '1.2.472'" 2>&1)
[ -z "$out" ] && ok "up-to-date → silent" || bad "up-to-date → silent ($out)"

# missing releases key → silent no-op
echo '{}' > "$SCRATCH/vj2.json"
out=$(bash -c "source '$SCRATCH/fn.sh'; warn_stale_version '$SCRATCH/vj2.json' '1.0.0'" 2>&1)
[ -z "$out" ] && ok "no releases key → silent" || bad "no releases key ($out)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
