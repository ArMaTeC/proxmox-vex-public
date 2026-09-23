#!/bin/bash
# Spec 093/US071: opt-in outcome telemetry — VEX_TELEMETRY=1 reports an
# anonymous outcome ping (from,to,result,ms) to the telemetry endpoint;
# unset/disabled sends nothing. Best-effort: a failed POST never aborts.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US071 telemetry tests"

check "report function exists"          "grep -q 'report_outcome()' update.sh"
check "opt-in gate (VEX_TELEMETRY)"     "grep -q 'VEX_TELEMETRY' update.sh"
check "endpoint configurable"           "grep -q 'VEX_TELEMETRY_URL\|TELEMETRY_URL' update.sh"
check "duration measured"               "grep -q 'date +%s' update.sh"
check "report wired into success path"  "grep -q 'report_outcome ' update.sh"
check "POST is best-effort"             "grep -q '|| true' update.sh"

# --- functional: stub curl, run extracted report_outcome --------------------
SCRATCH=$(mktemp -d)
awk '/^report_outcome\(\)/,/^}/' update.sh > "$SCRATCH/fn.sh"
mkdir -p "$SCRATCH/bin"
cat > "$SCRATCH/bin/curl" <<'SH'
#!/bin/sh
echo "$@" > "$SCRATCH_OUT/curl-args.txt"
for a in "$@"; do case "$a" in \{*) echo "$a" > "$SCRATCH_OUT/curl-body.txt";; esac; done
exit 0
SH
chmod +x "$SCRATCH/bin/curl"

# (a) opted IN → POST fires with anonymous fields
SCRATCH_OUT="$SCRATCH" PATH="$SCRATCH/bin:$PATH" \
      VEX_TELEMETRY=1 VEX_TELEMETRY_URL="https://t.example/x" \
      CURRENT_VERSION=1.0.0 LATEST_VERSION=2.0.0 \
      bash -c "source '$SCRATCH/fn.sh'; report_outcome ok 1234" >/dev/null 2>&1
[ -f "$SCRATCH/curl-body.txt" ] && ok "ping sent when opted in" || bad "ping sent when opted in"
grep -q '"from":"1.0.0"' "$SCRATCH/curl-body.txt" 2>/dev/null && ok "from version sent" || bad "from version sent"
grep -q '"to":"2.0.0"'   "$SCRATCH/curl-body.txt" 2>/dev/null && ok "to version sent"   || bad "to version sent"
grep -q '"result":"ok"'  "$SCRATCH/curl-body.txt" 2>/dev/null && ok "result sent"        || bad "result sent"
grep -q '"ms":1234'      "$SCRATCH/curl-body.txt" 2>/dev/null && ok "duration sent"      || bad "duration sent"
grep -q 'POST' "$SCRATCH/curl-args.txt" 2>/dev/null && ok "POST method" || bad "POST method"
# anonymity: no hostname/install-id fields
! grep -qE 'hostname|install_id|machine|uuid' "$SCRATCH/curl-body.txt" 2>/dev/null \
    && ok "no identifying fields" || bad "no identifying fields"

# (b) opted OUT → curl never invoked
rm -f "$SCRATCH/curl-args.txt" "$SCRATCH/curl-body.txt"
SCRATCH_OUT="$SCRATCH" PATH="$SCRATCH/bin:$PATH" \
    CURRENT_VERSION=1.0.0 LATEST_VERSION=2.0.0 \
    bash -c "source '$SCRATCH/fn.sh'; report_outcome ok 1" >/dev/null 2>&1
[ ! -f "$SCRATCH/curl-args.txt" ] && ok "nothing sent when opted out" || bad "nothing sent when opted out"

# (c) curl failure → still exits 0 (best-effort)
printf '#!/bin/sh\nexit 7\n' > "$SCRATCH/bin/curl"; chmod +x "$SCRATCH/bin/curl"
VEX_TELEMETRY=1 PATH="$SCRATCH/bin:$PATH" \
    bash -c "source '$SCRATCH/fn.sh'; report_outcome fail 5" >/dev/null 2>&1; rc=$?
[ $rc -eq 0 ] && ok "endpoint failure tolerated" || bad "endpoint failure tolerated (rc=$rc)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
