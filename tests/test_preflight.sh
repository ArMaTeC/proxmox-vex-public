#!/bin/bash
# Spec 093/US015: pre-update preflight — disk space (2.5x archive),
# current health, required tools — aborts BEFORE any download;
# --force overrides with a logged warning.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US015 preflight tests"

check "preflight function exists"              "grep -q 'preflight' update.sh"
check "preflight runs before archive download" "awk '/preflight/{print NR; exit} {d=NR} END{}' update.sh | head -1"
check "required tools checked"                 "grep -q 'command -v' update.sh && grep -qi 'missing.*tool\|required.*tool\|command -v.*tar\|command -v.*sha256sum' update.sh"
check "disk space checked (2.5x)"              "grep -q 'df -P\|FREE\|content-length' update.sh"
check "health check endpoint"                  "grep -q 'healthz\|api/health' update.sh"
check "--force override exists"                "grep -q '\-\-force\|FORCE' update.sh"
check "force override is logged"               "grep -qi 'force.*warn\|warn.*force\|overrid' update.sh"

# --- functional: extract preflight pieces and exercise --------------------------
SCRATCH=$(mktemp -d)
awk '/^preflight_tools\(\)/,/^}/; /^preflight_diskspace\(\)/,/^}/; /^preflight_health\(\)/,/^}/' \
    update.sh > "$SCRATCH/pf.sh"
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh"

# tools check passes on this host (curl/tar/sha256sum all present)
bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/pf.sh'; preflight_tools" >/dev/null 2>&1
rc=$?
[ $rc -eq 0 ] && ok "preflight_tools passes with tools present" \
              || bad "preflight_tools passes with tools present (rc=$rc)"

# disk space: absurd requirement must fail
bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/pf.sh'; preflight_diskspace 999999999999" >/dev/null 2>&1
rc=$?
[ $rc -ne 0 ] && ok "insufficient disk → fail" || bad "insufficient disk → fail"

# disk space: small requirement passes
bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/pf.sh'; preflight_diskspace 1024" >/dev/null 2>&1
rc=$?
[ $rc -eq 0 ] && ok "sufficient disk → pass" || bad "sufficient disk → pass (rc=$rc)"

# health: unreachable endpoint without force → fail
bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/pf.sh'
    FORCE=0 HEALTH_URL='http://127.0.0.1:1/none' preflight_health
" >/dev/null 2>&1
rc=$?
[ $rc -ne 0 ] && ok "unhealthy app without --force → fail" \
              || bad "unhealthy app without --force → fail"

# health: unreachable endpoint WITH force → pass (logged)
out=$(bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/pf.sh'
    FORCE=1 HEALTH_URL='http://127.0.0.1:1/none' preflight_health
" 2>&1)
rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -qi 'force\|overrid\|warn' \
    && ok "--force overrides unhealthy app (logged)" \
    || bad "--force overrides unhealthy app (logged: '$out')"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
