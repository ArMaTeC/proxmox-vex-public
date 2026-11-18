#!/bin/bash
# Roadmap ID-0134: FR-012 regression guard — the public download site's
# only calls into auth are the IDS feeds (/v1/internal/ids/*). It must
# never call /v1/internal/introspect per-request: verification there is
# irrelevant (public serves no authenticated API) and per-request
# introspection is banned ecosystem-wide so request floods can't
# translate into auth load. Revocation rides the short access-TTL +
# the optional /v1/internal/ids/session-denylist feed
# (site-integration.md §5).
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "ID-0134 no-per-request-introspect tests"

check "deploy/server.py free of introspect calls" \
      "! grep -rn 'internal/introspect' deploy/"
check "scripts/ free of introspect calls" \
      "! grep -rn 'internal/introspect' scripts/"
check "update.sh free of introspect calls" \
      "! grep -q 'internal/introspect' update.sh"
check "IDS feeds still the only internal surface" \
      "grep -rn 'v1/internal' deploy/ | grep -v 'internal/ids/' | wc -l | grep -q '^0$'"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
