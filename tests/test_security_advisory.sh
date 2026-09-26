#!/bin/bash
# Spec 093/US025: security advisory flag in release metadata — releases that
# fix vulnerabilities surface a distinct SECURITY UPDATE notice with the
# advisory URL/severity.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US025 security-advisory tests"

check "security flag in update.sh"      "grep -q 'security' update.sh"
check "advisory URL surfaced"           "grep -qi 'advisory' update.sh"
check "SECURITY UPDATE emphasis"        "grep -q 'SECURITY UPDATE' update.sh"
check "security in schema"              "grep -q 'security' version.schema.json"
check "advisory in schema"              "grep -q 'advisory' version.schema.json"
check "severity in schema"              "grep -q 'severity' version.schema.json"
check "shipped doc validates"           "python3 scripts/validate-version.py version.json"

# --- functional -------------------------------------------------------------------
SCRATCH=$(mktemp -d)
awk '/^check_security_advisory\(\)/,/^}/' update.sh > "$SCRATCH/sa.sh"

cat > "$SCRATCH/vj.json" <<'JSON'
{"releases": {
  "2.0.0": {"security": {"severity": "critical", "advisory": "https://example.com/adv-1"}},
  "1.5.0": {"min_from": "0.0.0"}}}
JSON

# security release → SECURITY UPDATE notice with severity + advisory URL
out=$(bash -c "source '$SCRATCH/sa.sh'; check_security_advisory 2.0.0 '$SCRATCH/vj.json'" 2>&1)
echo "$out" | grep -q 'SECURITY UPDATE' && ok "security release flagged" || bad "security release flagged (got: $out)"
echo "$out" | grep -q 'critical' && ok "severity shown" || bad "severity shown (got: $out)"
echo "$out" | grep -q 'example.com/adv-1' && ok "advisory URL shown" || bad "advisory URL shown (got: $out)"

# non-security release → silent
out=$(bash -c "source '$SCRATCH/sa.sh'; check_security_advisory 1.5.0 '$SCRATCH/vj.json'" 2>&1)
echo "$out" | grep -q 'SECURITY' && bad "non-security release quiet" || ok "non-security release quiet"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
