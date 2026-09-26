#!/bin/bash
# Spec 093/US072: fleet version distribution — update checks carry
# ?from=<version> on the version.json fetch; deploy/metrics.sh aggregates
# them into vex_installs{version="x"} N for the textfile collector.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US072 fleet-stats tests"

check "client sends ?from="             "grep -q 'from=' update.sh"
check "from uses current version"       "grep -q 'from=\$CURRENT_VERSION\|from=\${CURRENT_VERSION' update.sh"
check "metrics parses from="            "grep -q 'from=' deploy/metrics.sh"
check "vex_installs metric"             "grep -q 'vex_installs' deploy/metrics.sh"

# --- functional: metrics rollup on a sample JSON log ------------------------
SCRATCH=$(mktemp -d)
cat > "$SCRATCH/vexdl.json" <<'LOG'
{"uri":"/version.json?from=1.2.300","status":200,"bytes":812}
{"uri":"/version.json?from=1.2.300","status":200,"bytes":812}
{"uri":"/version.json?from=1.2.460","status":200,"bytes":812}
{"uri":"/dist/ProxmoxVEx-1.2.460.tar.gz","status":200,"bytes":990001}
{"uri":"/version.json","status":200,"bytes":812}
LOG

bash deploy/metrics.sh "$SCRATCH/vexdl.json" > "$SCRATCH/out.prom" 2>/dev/null

grep -q 'vex_installs{version="1.2.300"} 2' "$SCRATCH/out.prom" \
    && ok "version counted twice" || bad "version counted twice ($(grep vex_installs "$SCRATCH/out.prom"))"
grep -q 'vex_installs{version="1.2.460"} 1' "$SCRATCH/out.prom" \
    && ok "second version counted" || bad "second version counted"
grep -q 'HELP vex_installs' "$SCRATCH/out.prom" \
    && ok "metric documented" || bad "metric documented"
! grep -q 'vex_installs{version=""}' "$SCRATCH/out.prom" \
    && ok "bare check yields no bogus version" || bad "bare check bogus version"
grep -q 'vex_downloads_total{version="1.2.460"} 1' "$SCRATCH/out.prom" \
    && ok "downloads metric intact" || bad "downloads metric intact"

# empty/missing log → still emits valid (zero) metrics
bash deploy/metrics.sh "$SCRATCH/missing.json" > "$SCRATCH/empty.prom" 2>/dev/null
grep -q 'vex_requests_total 0' "$SCRATCH/empty.prom" \
    && ok "missing log → zero metrics" || bad "missing log → zero metrics"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
