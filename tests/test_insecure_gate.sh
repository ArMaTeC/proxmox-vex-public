#!/bin/bash
# Spec 093/US042: --insecure requires VEX_I_ACCEPT_RISK=1 — a copied command
# line alone can never disable signature/TLS verification.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US042 insecure-gate tests"

check "--insecure flag parsed"          "grep -q -- 'insecure' update.sh"
check "env confirmation required"       "grep -q 'VEX_I_ACCEPT_RISK' update.sh"
check "refusal names the env var"       "grep -q 'VEX_I_ACCEPT_RISK=1' update.sh"
check "loud warning on accept"          "grep -qi 'WARNING.*DISABLED\|!!!.*WARNING' update.sh"
check "incident logged"                 "grep -qi 'INSECURE' update.sh"
check "activates skip path"             "grep -q 'VEX_SKIP_SIG_VERIFY' update.sh"

# --- functional: gate behavior via extracted block -----------------------------------
SCRATCH=$(mktemp -d)
# extract the gate block (between the marker comments or a function)
awk '/^enforce_insecure_gate\(\)/,/^}/' update.sh > "$SCRATCH/gate.sh"
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh"
awk '/^log_update\(\)/,/^}/' update.sh > "$SCRATCH/log.sh"

# --insecure WITHOUT the env var → dies naming VEX_I_ACCEPT_RISK
out=$(INSECURE=1 bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/log.sh'; source '$SCRATCH/gate.sh'
      enforce_insecure_gate" 2>&1); rc=$?
[ $rc -ne 0 ] && ok "bare --insecure refused" || bad "bare --insecure refused (rc=$rc)"
echo "$out" | grep -q 'VEX_I_ACCEPT_RISK' && ok "names required env var" || bad "names required env var (got: $out)"

# with env var → proceeds, loud warning
out=$(INSECURE=1 VEX_I_ACCEPT_RISK=1 BASE_DIR="$SCRATCH" bash -c "
      source '$SCRATCH/die.sh'; source '$SCRATCH/log.sh'; source '$SCRATCH/gate.sh'
      enforce_insecure_gate" 2>&1); rc=$?
[ $rc -eq 0 ] && ok "confirmed insecure proceeds" || bad "confirmed insecure proceeds (rc=$rc)"
echo "$out" | grep -qi 'WARNING\|DISABLED' && ok "loud warning emitted" || bad "loud warning emitted (got: $out)"

# env=1 activates the existing skip-verify plumbing
out=$(INSECURE=1 VEX_I_ACCEPT_RISK=1 BASE_DIR="$SCRATCH" bash -c "
      source '$SCRATCH/die.sh'; source '$SCRATCH/log.sh'; source '$SCRATCH/gate.sh'
      enforce_insecure_gate; echo \"skip=\$VEX_SKIP_SIG_VERIFY\"" 2>&1)
echo "$out" | grep -q 'skip=1' && ok "VEX_SKIP_SIG_VERIFY armed" || bad "VEX_SKIP_SIG_VERIFY armed (got: $out)"

# wrong env value still refuses
INSECURE=1 VEX_I_ACCEPT_RISK=yes bash -c "
      source '$SCRATCH/die.sh'; source '$SCRATCH/log.sh'; source '$SCRATCH/gate.sh'
      enforce_insecure_gate" >/dev/null 2>&1
[ $? -ne 0 ] && ok "env var must be exactly 1" || bad "env var must be exactly 1"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
