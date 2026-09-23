#!/bin/bash
# Spec 093/US037: latency-based mirror selection — among reachable mirrors
# the updater picks the fastest (measured), not just the first listed.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US037 mirror-latency tests"

check "latency probe exists"            "grep -q 'pick_mirror_latency\|time_total' update.sh"
check "probes all mirrors"              "grep -q 'bestms\|best_ms\|for.*mirror' update.sh"
check "picks lowest latency"            "grep -q 'time_total' update.sh"
check "env override still wins"         "grep -q 'VEX_MIRROR' update.sh"
check "wired into update flow"          "grep -q 'pick_mirror_latency\|select_mirror' update.sh"

# --- functional: slow vs fast server -----------------------------------------------
SCRATCH=$(mktemp -d)
awk '/^pick_mirror_latency\(\)/,/^}/' update.sh > "$SCRATCH/pm.sh"

mkdir -p "$SCRATCH/fast" "$SCRATCH/slow"
echo '{"version":"1.0.0"}' > "$SCRATCH/fast/version.json"
cp "$SCRATCH/fast/version.json" "$SCRATCH/slow/version.json"

PORT_F=$((20000 + RANDOM % 15000)); PORT_S=$((30000 + RANDOM % 15000))
(cd "$SCRATCH/fast" && python3 -m http.server "$PORT_F" >/dev/null 2>&1) &
FSRV=$!
cat > "$SCRATCH/slowsrv.py" <<'PY'
import sys, time
from http.server import HTTPServer, SimpleHTTPRequestHandler
class H(SimpleHTTPRequestHandler):
    def _d(self): time.sleep(0.4)
    def do_GET(self): self._d(); super().do_GET()
    def do_HEAD(self): self._d(); super().do_HEAD()
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
(cd "$SCRATCH/slow" && python3 "$SCRATCH/slowsrv.py" "$PORT_S" >/dev/null 2>&1) &
SSRV=$!
sleep 1

# slow listed first — fastest should still win
cat > "$SCRATCH/vj.json" <<JSON
{"mirrors": ["http://127.0.0.1:$PORT_S", "http://127.0.0.1:$PORT_F"]}
JSON
# fixture uses http:// loopback mirrors — only reachable under the armed
# insecure mode (US041 scheme gate), so the extraction sets INSECURE=1.
out=$(bash -c "INSECURE=1; source '$SCRATCH/pm.sh'
      pick_mirror_latency '$SCRATCH/vj.json' 'http://127.0.0.1:1'" 2>&1)
echo "  info - picked: $out"
[ "$(echo "$out" | head -1)" = "http://127.0.0.1:$PORT_F" ] && ok "fastest mirror picked (not first-listed)" || bad "fastest mirror picked (got: $out)"
echo "$out" | grep -qi 'latency\|ms' && ok "pick is logged" || bad "pick is logged"

# env override wins regardless of latency
out=$(VEX_MIRROR="http://127.0.0.1:$PORT_S" bash -c "INSECURE=1; source '$SCRATCH/pm.sh'
      pick_mirror_latency '$SCRATCH/vj.json' 'x'" 2>&1)
[ "$out" = "http://127.0.0.1:$PORT_S" ] && ok "VEX_MIRROR still wins" || bad "VEX_MIRROR still wins (got: $out)"

# all dead → nonzero
cat > "$SCRATCH/vj2.json" <<'JSON'
{"mirrors": ["http://127.0.0.1:1", "http://127.0.0.1:2"]}
JSON
bash -c "source '$SCRATCH/pm.sh'
         pick_mirror_latency '$SCRATCH/vj2.json' 'http://127.0.0.1:3'" >/dev/null 2>&1
[ $? -ne 0 ] && ok "all dead → nonzero" || bad "all dead → nonzero"

kill $FSRV $SSRV 2>/dev/null
rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
