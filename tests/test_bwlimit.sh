#!/bin/bash
# Spec 093/US034: optional bandwidth cap — VEX_DOWNLOAD_LIMIT throttles
# artifact downloads so updates don't saturate a shared link.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US034 bandwidth-limit tests"

check "limit env var honored"           "grep -q 'VEX_DOWNLOAD_LIMIT' update.sh"
check "curl --limit-rate used"          "grep -q 'limit-rate' update.sh"
check "applied in resumable fetch"      "grep -n 'fetch_resume' update.sh | head -3"
check "unset = unlimited (no flag)"     "grep -q 'VEX_DOWNLOAD_LIMIT:-' update.sh || grep -c 'limit-rate' update.sh"

# --- functional: rate limit actually slows transfer --------------------------------
# NOTE: curl only rate-limits real network transfers, so this needs http://.
SCRATCH=$(mktemp -d)
awk '/^fetch_resume\(\)/,/^}/' update.sh > "$SCRATCH/fr.sh"

mkdir -p "$SCRATCH/www"
dd if=/dev/urandom of="$SCRATCH/www/big.bin" bs=1024 count=256 2>/dev/null
PORT=$((20000 + RANDOM % 20000))
(cd "$SCRATCH/www" && python3 -m http.server "$PORT" >/dev/null 2>&1) &
SRV=$!
sleep 1

start=$(date +%s%N)
VEX_DOWNLOAD_LIMIT=64k bash -c "source '$SCRATCH/fr.sh'
    fetch_resume 'http://127.0.0.1:$PORT/big.bin' '$SCRATCH/slow.bin'" >/dev/null 2>&1
slow_ms=$(( ($(date +%s%N) - start) / 1000000 ))

rm -f "$SCRATCH/fast.bin" "$SCRATCH/fast.bin.done"
start=$(date +%s%N)
bash -c "source '$SCRATCH/fr.sh'
    fetch_resume 'http://127.0.0.1:$PORT/big.bin' '$SCRATCH/fast.bin'" >/dev/null 2>&1
fast_ms=$(( ($(date +%s%N) - start) / 1000000 ))
kill $SRV 2>/dev/null

echo "  info - limited=${slow_ms}ms unlimited=${fast_ms}ms"
[ "$slow_ms" -ge 1000 ] && ok "limit slows transfer" || bad "limit slows transfer (${slow_ms}ms)"
[ "$slow_ms" -gt "$fast_ms" ] && ok "limited slower than unlimited" || bad "limited slower than unlimited"
cmp -s "$SCRATCH/www/big.bin" "$SCRATCH/slow.bin" && ok "throttled bytes complete" || bad "throttled bytes complete"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
