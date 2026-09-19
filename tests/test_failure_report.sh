#!/bin/bash
# Spec 093/US074: structured failure reports — on error the updater records
# {stage, error, from, to, ts} to logs/update-failure.json with paths and
# secrets stripped; opted-in telemetry POSTs it. The ERR trap feeds it.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US074 failure-report tests"

check "fail_record exists"              "grep -q 'fail_record()' update.sh"
check "ERR trap feeds fail_record"      "grep -q 'fail_record \"\${STAGE' update.sh"
check "stage markers set"               "grep -q 'STAGE=' update.sh"
check "failure file target"             "grep -q 'update-failure.json' update.sh"
check "path sanitization"               "grep -q 'sed' update.sh"
check "telemetry gate"                  "grep -q 'VEX_TELEMETRY' update.sh"

# --- functional: extract + run ----------------------------------------------
SCRATCH=$(mktemp -d)
awk '/^fail_record\(\)/,/^}/' update.sh > "$SCRATCH/fn.sh"

BASE="$SCRATCH/app"; mkdir -p "$BASE"
out=$(BASE_DIR="$BASE" CURRENT_VERSION=1.0.0 LATEST_VERSION=2.0.0 \
      bash -c "source '$SCRATCH/fn.sh'; fail_record download 'curl failed /tmp/secret/creds.pem badly'" 2>&1); rc=$?
[ $rc -eq 0 ] && ok "records without crashing" || bad "records without crashing (rc=$rc)"

F="$BASE/shared/logs/update-failure.json"
[ -f "$F" ] || F="$BASE/logs/update-failure.json"
[ -f "$F" ] && ok "failure json written" || bad "failure json written"
python3 -c "import json;d=json.load(open('$F'));print(d['stage'])" 2>/dev/null | grep -q download \
    && ok "stage recorded" || bad "stage recorded"
python3 -c "import json;print(json.load(open('$F'))['error'])" 2>/dev/null | grep -q 'creds.pem' \
    && bad "path stripped from error" || ok "path stripped from error"
python3 -c "import json;print(json.load(open('$F'))['from'])" 2>/dev/null | grep -q '1.0.0' \
    && ok "from version recorded" || bad "from version recorded"
python3 -c "import json;print(json.load(open('$F'))['ts'])" 2>/dev/null | grep -qE '20[0-9]{2}' \
    && ok "timestamp recorded" || bad "timestamp recorded"

# telemetry: opted in → POST fires; off → silent
mkdir -p "$SCRATCH/bin"
printf '#!/bin/sh\necho "$@" > "$SCRATCH_OUT/curl-args.txt"\nexit 0\n' > "$SCRATCH/bin/curl"
chmod +x "$SCRATCH/bin/curl"
SCRATCH_OUT="$SCRATCH" PATH="$SCRATCH/bin:$PATH" BASE_DIR="$BASE" \
    VEX_TELEMETRY=1 VEX_TELEMETRY_URL="https://t.example/x" \
    bash -c "source '$SCRATCH/fn.sh'; fail_record verify 'sig mismatch'" >/dev/null 2>&1
[ -f "$SCRATCH/curl-args.txt" ] && ok "POST fires when opted in" || bad "POST fires when opted in"
grep -q 'failure' "$SCRATCH/curl-args.txt" 2>/dev/null && ok "failure endpoint used" || bad "failure endpoint used"

rm -f "$SCRATCH/curl-args.txt"
SCRATCH_OUT="$SCRATCH" PATH="$SCRATCH/bin:$PATH" BASE_DIR="$BASE" \
    bash -c "source '$SCRATCH/fn.sh'; fail_record verify 'sig mismatch'" >/dev/null 2>&1
[ ! -f "$SCRATCH/curl-args.txt" ] && ok "no POST when opted out" || bad "no POST when opted out"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
