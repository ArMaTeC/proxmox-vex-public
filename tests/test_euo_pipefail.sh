#!/bin/bash
# Spec 093/US062: set -euo pipefail safety audit — the updater must abort
# immediately on mid-pipe failures and unbound variables, not continue on
# half-broken state. Expected-failure sites carry explicit `|| true`.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US062 set -euo pipefail tests"

check "pipefail + nounset enabled"      "grep -q 'set -euo pipefail' update.sh"
check "ERR trap reports line"           "grep -q 'LINENO.*BASH_COMMAND' update.sh && grep -q 'ERR$' update.sh"
check "die helper present"              "grep -q 'die()' update.sh"
check "parses cleanly"                  "bash -n update.sh"

# --- functional: unbound variable must abort, not silently continue ------
SCRATCH=$(mktemp -d)
cat > "$SCRATCH/probe.sh" <<'EOS'
set -euo pipefail
echo "before"
echo "$DEFINITELY_UNSET_VAR"
echo "after"
EOS
out=$(bash "$SCRATCH/probe.sh" 2>&1); rc=$?
{ [ $rc -ne 0 ] && echo "$out" | grep -q 'unbound variable'; } \
    && ok "nounset aborts on unbound var (sanity)" \
    || bad "nounset sanity check"

# --- functional: mid-pipe failure must abort under pipefail ---------------
cat > "$SCRATCH/pipe.sh" <<'EOS'
set -euo pipefail
echo "start"
false | cat >/dev/null
echo "REACHED AFTER FAILED PIPE"
EOS
out=$(bash "$SCRATCH/pipe.sh" 2>&1); rc=$?
{ [ $rc -ne 0 ] && ! echo "$out" | grep -q 'REACHED AFTER'; } \
    && ok "pipefail aborts mid-pipeline (sanity)" \
    || bad "pipefail sanity check"

# --- functional: expected-failure sites stay tolerated --------------------
# run update.sh's early preamble under -u by feeding --verify a missing
# archive: it should die with the verify message, NOT an unbound-var crash.
out=$(bash update.sh --verify --file "$SCRATCH/nope.tar.gz" 2>&1); rc=$?
[ $rc -ne 0 ] && ok "--verify missing archive exits nonzero" \
              || bad "--verify missing archive exits nonzero"
echo "$out" | grep -qi 'unbound variable' \
    && bad "no unbound-variable crash in preamble" \
    || ok  "no unbound-variable crash in preamble"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
