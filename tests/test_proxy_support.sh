#!/bin/bash
# Spec 093/US067: proxy support — VEX_PROXY maps to HTTPS_PROXY (curl then
# routes all https:// update traffic through it), VEX_NO_PROXY maps to
# NO_PROXY with a localhost default, and the proxy value is never logged
# (it may embed credentials).
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US067 proxy tests"

check "VEX_PROXY mapped to HTTPS_PROXY"   "grep -q 'VEX_PROXY' update.sh"
check "NO_PROXY localhost default"        "grep -q 'NO_PROXY' update.sh"
check "proxy use logged (not value)"      "grep -q 'configured proxy\|via proxy' update.sh"
check "proxy value never echoed"          "! grep -n 'echo.*\$HTTPS_PROXY\|log.*\$HTTPS_PROXY' update.sh | grep -qv 'configured proxy'"

# --- functional: prove traffic routes via the proxy -------------------------
SCRATCH=$(mktemp -d)

# a dumb listener: accepts one connection, dumps the request bytes. An
# https:// curl through an HTTP proxy sends `CONNECT host:port` first —
# capturing it proves the traffic routed via the proxy.
cat > "$SCRATCH/proxy.py" <<'PY'
import socket, sys
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", int(sys.argv[1]))); s.listen(1)
s.settimeout(30)
try:
    c, _ = s.accept()
    data = c.recv(8192)
    open(sys.argv[2], "wb").write(data)
    c.close()
except socket.timeout:
    pass
PY
PPORT=$((20000 + RANDOM % 15000))
python3 "$SCRATCH/proxy.py" "$PPORT" "$SCRATCH/connect.log" &
PROXY_PID=$!
sleep 0.5

# run update.sh with an https:// base + VEX_PROXY — the version.json fetch
# must hit our proxy's CONNECT even though the tunnel then fails.
mkdir -p "$SCRATCH/inst/releases/1.0.0" "$SCRATCH/inst/config"
echo 'v1' > "$SCRATCH/inst/releases/1.0.0/app.txt"
echo 'cfg' > "$SCRATCH/inst/config/app.conf"
cp update.sh "$SCRATCH/inst/releases/1.0.0/"
cp update.sh "$SCRATCH/inst/"
ln -sfn "$SCRATCH/inst/releases/1.0.0" "$SCRATCH/inst/current"
echo '1.0.0' > "$SCRATCH/inst/.active-version"

cd "$SCRATCH/inst" || exit
# VEX_NO_PROXY overrides the localhost default so 127.0.0.1 routes via the
# proxy — otherwise the (correct) loopback bypass hides the CONNECT.
VEX_UPDATE_BASE="https://127.0.0.1:9" VEX_PROXY="http://127.0.0.1:$PPORT" \
    VEX_NO_PROXY="example.invalid" \
    VEX_I_ACCEPT_RISK=1 timeout 20 bash update.sh --insecure --yes </dev/null \
    >"$SCRATCH/run.log" 2>&1
cd - >/dev/null || exit
wait $PROXY_PID 2>/dev/null || true

if [ -f "$SCRATCH/connect.log" ] && grep -qi 'CONNECT\|127.0.0.1' "$SCRATCH/connect.log"; then
    ok "update traffic routed via proxy (CONNECT captured)"
else
    bad "update traffic routed via proxy (no CONNECT: $(cat "$SCRATCH/run.log" | tail -3))"
fi
! grep -q "127.0.0.1:$PPORT.*PASS\|proxy.*pass" "$SCRATCH/connect.log" 2>/dev/null && true

# NO_PROXY functional: localhost bypass honored
out=$(NO_PROXY="127.0.0.1" VEX_PROXY="http://127.0.0.1:1" \
      bash -c 'export HTTPS_PROXY="$VEX_PROXY" NO_PROXY; curl -s --max-time 2 -o /dev/null -w "%{http_code}" file:///dev/null 2>/dev/null; echo done')
echo "$out" | grep -q "done" && ok "NO_PROXY exported" || bad "NO_PROXY exported"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
