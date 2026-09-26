#!/bin/bash
# Spec 093/US039: dist-host download metrics — structured access log +
# rollup to Prometheus textfile: per-version downloads and error rates.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US039 dist-metrics tests"

check "json access log format"          "grep -q 'log_format' deploy/nginx.conf"
check "access_log enabled"              "grep -q 'access_log' deploy/nginx.conf"
check "metrics script exists"           "[ -f deploy/metrics.sh ]"
check "emits prometheus textfile"       "grep -q 'vex_\|# TYPE\|# HELP' deploy/metrics.sh"
check "per-version counter"             "grep -qi 'version' deploy/metrics.sh"
check "error rate tracked"              "grep -qi 'error\|status\|5..\|404' deploy/metrics.sh"
check "shellcheck-parseable"            "bash -n deploy/metrics.sh"
check "documented"                      "grep -rqi 'metrics\|node_exporter' README.md docs/ deploy/ 2>/dev/null"

# --- functional: rollup produces correct counters ----------------------------------
SCRATCH=$(mktemp -d)
cat > "$SCRATCH/access.jsonl" <<'LOG'
{"uri":"/downloads/ProxmoxVEx-1.2.470.tar.gz","status":200,"bytes":18400000}
{"uri":"/downloads/ProxmoxVEx-1.2.470.tar.gz","status":200,"bytes":18400000}
{"uri":"/downloads/ProxmoxVEx-1.2.472.tar.gz","status":200,"bytes":18413275}
{"uri":"/downloads/ProxmoxVEx-1.2.472.tar.gz","status":404,"bytes":0}
{"uri":"/version.json","status":200,"bytes":2400}
LOG

awk '/^#?( *)?(rollup|main|generate_metrics)/,0' deploy/metrics.sh > /dev/null 2>&1 || true
out=$(bash deploy/metrics.sh "$SCRATCH/access.jsonl" 2>/dev/null); rc=$?
[ $rc -eq 0 ] && ok "rollup runs" || bad "rollup runs (rc=$rc)"
echo "$out" | grep -q '1.2.470' && ok "version label emitted" || bad "version label emitted (got: $(echo "$out" | head -3))"
echo "$out" | grep -q '1.2.470"} 2' && ok "470 count = 2" || bad "470 count = 2 (got: $out)"
echo "$out" | grep -qi 'error\|404\|status' && ok "errors tracked" || bad "errors tracked"
echo "$out" | grep -q '# TYPE\|# HELP' && ok "prometheus format" || bad "prometheus format"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
