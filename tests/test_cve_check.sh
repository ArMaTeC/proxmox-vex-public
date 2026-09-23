#!/bin/bash
# Spec 093/US045: CVE monitoring on released dependency sets — a scheduled
# job matches published freeze manifests against a vuln feed; a known-vuln
# dep produces an advisory naming the CVE id.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US045 cve-check tests"

check "cve-check script exists"         "[ -f scripts/cve-check.sh ]"
check "script is executable"            "[ -x scripts/cve-check.sh ]"
check "consumes freeze manifests"       "grep -q 'deps-freeze' scripts/cve-check.sh"
check "queries OSV feed"                "grep -qi 'osv\|vulns' scripts/cve-check.sh"
check "airgap feed-file override"       "grep -q 'feed-file\|FEED_FILE' scripts/cve-check.sh"
check "report artifact written"         "grep -q 'cve-report' scripts/cve-check.sh"

# --- functional: manifest with a known-vulnerable dep ---------------------------------
SCRATCH=$(mktemp -d)
cat > "$SCRATCH/deps-freeze.json" <<'JSON'
{"version": "9.9.9", "python": {"requests": "2.19.0", "flask": ">=3.1.3"},
 "npm": {}, "deps_sha256": "x"}
JSON

# stub feed: OSV-shaped response mapping a package to its advisories
cat > "$SCRATCH/feed.json" <<'JSON'
{"requests@2.19.0": [{"id": "CVE-2018-18074", "summary": "requests before 2.20.0 sends Authorization header on https->http redirect", "severity": "HIGH"}]}
JSON

out=$(bash scripts/cve-check.sh --feed-file "$SCRATCH/feed.json" \
      "$SCRATCH/deps-freeze.json" 2>&1)
[ -s cve-report.txt ] || out=$(bash scripts/cve-check.sh --feed-file "$SCRATCH/feed.json" \
      --report "$SCRATCH/cve-report.txt" "$SCRATCH/deps-freeze.json" 2>&1)
REPORT="${SCRATCH}/cve-report.txt"
[ -s "$REPORT" ] || REPORT="cve-report.txt"

[ -f "$REPORT" ] && grep -q 'CVE-2018-18074' "$REPORT" \
    && ok "known-vuln dep produces advisory" || bad "known-vuln dep produces advisory"
grep -q 'requests' "$REPORT" 2>/dev/null && ok "advisory names the package" || bad "advisory names the package"
grep -q '9.9.9' "$REPORT" 2>/dev/null && ok "advisory names the release" || bad "advisory names the release"
echo "$out" | grep -qi 'cve\|advisory\|vuln' && ok "stdout reports findings" || bad "stdout reports findings (got: $out)"

# clean manifest → empty report / clean exit
cat > "$SCRATCH/clean.json" <<'JSON'
{"version": "9.9.8", "python": {"requests": "2.31.0"}, "npm": {}, "deps_sha256": "x"}
JSON
bash scripts/cve-check.sh --feed-file "$SCRATCH/feed.json" \
     --report "$SCRATCH/clean-report.txt" "$SCRATCH/clean.json" >/dev/null 2>&1
[ ! -s "$SCRATCH/clean-report.txt" ] && ok "clean manifest → empty report" || bad "clean manifest → empty report"

rm -rf "$SCRATCH" cve-report.txt

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
