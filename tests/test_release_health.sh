#!/bin/bash
# Spec 093/US075: release-health dashboard feed — one JSON document
# combining download counts, telemetry outcomes, and failure stages,
# emitted by deploy/metrics.sh --dashboard for the internal vhost.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US075 release-health tests"

check "dashboard mode exists"           "grep -q 'dashboard' deploy/metrics.sh"
check "combines downloads"              "grep -q 'downloads' deploy/metrics.sh"
check "combines outcomes"               "grep -q 'outcomes\|telemetry' deploy/metrics.sh"
check "combines failures"               "grep -q 'failures' deploy/metrics.sh"
check "timestamp emitted"               "grep -q 'ts' deploy/metrics.sh"

# --- functional: fixture inputs → consolidated feed -------------------------
SCRATCH=$(mktemp -d)
cat > "$SCRATCH/vexdl.json" <<'LOG'
{"uri":"/version.json?from=1.2.300","status":200,"bytes":812}
{"uri":"/dist/ProxmoxVEx-1.2.460.tar.gz","status":200,"bytes":990001}
{"uri":"/dist/ProxmoxVEx-1.2.460.tar.gz","status":200,"bytes":990001}
{"uri":"/dist/ProxmoxVEx-1.2.470.tar.gz","status":200,"bytes":980001}
LOG
echo '{"ok": 19, "fail": 3}' > "$SCRATCH/telemetry-rollup.json"
echo '{"download": 2, "verify": 1}' > "$SCRATCH/failures-rollup.json"

bash deploy/metrics.sh --dashboard "$SCRATCH/health.json" \
    --log "$SCRATCH/vexdl.json" \
    --telemetry "$SCRATCH/telemetry-rollup.json" \
    --failures "$SCRATCH/failures-rollup.json" 2>/dev/null

[ -f "$SCRATCH/health.json" ] && ok "feed written" || bad "feed written"

j() { python3 -c "import json,sys;d=json.load(open('$SCRATCH/health.json'));print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

[ "$(j "d['downloads']['1.2.460']")" = "2" ] && ok "download counts merged" || bad "download counts merged"
[ "$(j "d['outcomes']['ok']")" = "19" ]   && ok "outcomes merged" || bad "outcomes merged"
[ "$(j "d['outcomes']['fail']")" = "3" ]  && ok "failures counted" || bad "failures counted"
[ "$(j "d['failures']['download']")" = "2" ] && ok "failure stages merged" || bad "failure stages merged"
j "d['ts']" | grep -qE '20[0-9]{2}|^[0-9.]+$' && ok "timestamp present" || bad "timestamp present"

rate=$(python3 -c "import json;d=json.load(open('$SCRATCH/health.json'));o=d['outcomes'];print(round(o['ok']/(o['ok']+o['fail'])*100,1))" 2>/dev/null)
[ "$rate" = "86.4" ] && ok "success rate derivable ($rate%)" || bad "success rate derivable ($rate)"

top=$(python3 -c "import json;d=json.load(open('$SCRATCH/health.json'));print(max(d['failures'],key=d['failures'].get))" 2>/dev/null)
[ "$top" = "download" ] && ok "top failure stage derivable" || bad "top failure stage ($top)"

bash deploy/metrics.sh --dashboard "$SCRATCH/h2.json" --log "$SCRATCH/missing.json" 2>/dev/null
python3 -c "import json;d=json.load(open('$SCRATCH/h2.json'));assert isinstance(d,dict)" 2>/dev/null \
    && ok "missing inputs → valid empty feed" || bad "missing inputs → valid empty feed"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
