#!/bin/bash
# Spec 093/US046: optional authenticated distribution — an enterprise channel
# requires a bearer token; unauthenticated fetches 401, token fetches pass.
# update.sh forwards VEX_UPDATE_TOKEN as the Authorization header.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US046 auth-endpoint tests"

check "gated location exists"           "grep -q 'downloads/enterprise' deploy/nginx.conf"
check "auth_request subrequest"         "grep -q 'auth_request' deploy/nginx.conf"
check "verify endpoint internal"        "grep -A3 '_verify-token' deploy/nginx.conf | grep -q internal"
check "401 without token"               "grep -q 'return 401\|401' deploy/nginx.conf"
check "forwards auth header"            "grep -q 'http_authorization' deploy/nginx.conf"
check "verify calls licensing"          "grep -q 'licensing' deploy/nginx.conf"
check "updater sends token"             "grep -q 'VEX_UPDATE_TOKEN' update.sh"
check "token becomes auth header"       "grep -q 'Authorization.*Bearer\|Bearer.*VEX_UPDATE_TOKEN' update.sh"
check "documented"                      "grep -qi 'VEX_UPDATE_TOKEN\|authenticated' README.md"

# --- functional: extracted auth plumbing from update.sh ------------------------------
# US050 moved the token off the cmdline into a curl -K conf file — the
# functional check now asserts the conf file carries the Bearer header.
SCRATCH=$(mktemp -d)
awk '/^curl_secret_conf\(\)/,/^}/' update.sh > "$SCRATCH/ca.sh"

out=$(VEX_UPDATE_TOKEN="s3cret" bash -c "source '$SCRATCH/ca.sh'; f=\$(curl_secret_conf); cat \$f")
echo "$out" | grep -q 'Bearer s3cret' && ok "token → Bearer header" || bad "token → Bearer header (got: $out)"

out=$(bash -c "source '$SCRATCH/ca.sh'; curl_secret_conf")
[ -z "$out" ] && ok "no token → no header" || bad "no token → no header (got: $out)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
