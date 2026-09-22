#!/bin/bash
# Spec 093/US050: isolate secrets from the update environment — the download
# token comes from a mode-0600 file or the env, is handed to curl via a -K
# config file (never a -H cmdline arg → /proc/cmdline), and never logged.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US050 secret-isolation tests"

check "token file supported"            "grep -q 'dist-token' update.sh"
check "token file must be 0600"         "grep -q 'stat -c%a\|stat -c %a' update.sh"
check "curl -K config file"             "grep -q '\-K \|--config' update.sh"
check "token NOT passed via -H literal" "! grep -q '\-H \"Authorization: Bearer \$VEX_UPDATE_TOKEN\"' update.sh"
check "token never written to log"      "! grep -n 'log_update.*TOKEN\|log_update.*Bearer' update.sh"
check "token loader exists"             "grep -q 'load_update_token' update.sh"

# --- functional ----------------------------------------------------------------------
SCRATCH=$(mktemp -d)
awk '/^load_update_token\(\)/,/^}/' update.sh > "$SCRATCH/lut.sh"
awk '/^curl_secret_conf\(\)/,/^}/' update.sh > "$SCRATCH/csc.sh"

# token file with WRONG mode → ignored
mkdir -p "$SCRATCH/base/config"
echo "filetoken" > "$SCRATCH/base/config/dist-token"; chmod 644 "$SCRATCH/base/config/dist-token"
out=$(unset VEX_UPDATE_TOKEN; BASE_DIR="$SCRATCH/base" bash -c "source '$SCRATCH/lut.sh'; load_update_token; echo \$VEX_UPDATE_TOKEN")
[ -z "$out" ] && ok "0644 token file ignored" || bad "0644 token file ignored (got: $out)"

# token file 0600 → loaded
chmod 600 "$SCRATCH/base/config/dist-token"
out=$(unset VEX_UPDATE_TOKEN; BASE_DIR="$SCRATCH/base" bash -c "source '$SCRATCH/lut.sh'; load_update_token; echo \$VEX_UPDATE_TOKEN")
[ "$out" = "filetoken" ] && ok "0600 token file loaded" || bad "0600 token file loaded (got: $out)"

# env beats file
out=$(VEX_UPDATE_TOKEN="envtoken" BASE_DIR="$SCRATCH/base" bash -c "source '$SCRATCH/lut.sh'; load_update_token; echo \$VEX_UPDATE_TOKEN")
[ "$out" = "envtoken" ] && ok "env token wins" || bad "env token wins (got: $out)"

# curl conf file holds the secret, not the cmdline
out=$(VEX_UPDATE_TOKEN="envtoken" bash -c "source '$SCRATCH/csc.sh'; f=\$(curl_secret_conf); echo \$f")
[ -f "$out" ] && grep -q 'Authorization.*Bearer envtoken' "$out" \
    && ok "secret lives in -K conf file" || bad "secret lives in -K conf file (got: $out)"
MODE=$(stat -c '%a' "$out" 2>/dev/null)
[ "$MODE" = "600" ] || [ "$(dirname "$out")" = "..." ] && ok "conf file private" || bad "conf file private (mode=$MODE)"

# -K path used at the call site, secret absent from script cmdline args
grep -q 'curl.*-K' update.sh \
    && ok "curl invoked with -K conf" || bad "curl invoked with -K conf"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
