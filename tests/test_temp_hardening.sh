#!/bin/bash
# Spec 093/US047: hardened temp handling — the updater's temp dir holds a
# signed release archive + trust material; it must be 0700 from creation,
# created under a pinned umask, and removed on exit/failure/signal.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US047 temp-hardening tests"

check "restrictive umask set"           "grep -q 'umask 077\|umask 0077' update.sh"
check "mktemp -d used"                  "grep -q 'mktemp -d' update.sh"
check "cleanup function exists"         "grep -q 'cleanup()' update.sh"
check "EXIT trap removes temp"          "grep -q 'trap.*EXIT' update.sh"
check "INT/TERM trapped"                "grep -q 'trap.*INT\|trap.*TERM' update.sh"
check "temp mode enforced"              "grep -q 'chmod 700.*TMPDIR\|mktemp -d' update.sh"

# --- functional: the temp dir is created 0700 and cleaned on exit --------------------
SCRATCH=$(mktemp -d)

# Extract the temp-setup block: umask + TMPDIR creation + cleanup trap, run
# it in a subshell that exits, then assert the dir is gone.
awk '/^# spec 093\/US047/,/trap.*EXIT/' update.sh > "$SCRATCH/setup.sh"

# The block must create a 0700 dir
bash -c "source '$SCRATCH/setup.sh'; stat -c '%a' \"\$TMPDIR\"" 2>/dev/null > "$SCRATCH/mode.txt"
MODE=$(cat "$SCRATCH/mode.txt")
[ "$MODE" = "700" ] && ok "temp dir created 0700" || bad "temp dir created 0700 (mode=$MODE)"

# dir is gone after the shell exits (EXIT trap)
TD=$(bash -c "source '$SCRATCH/setup.sh'; echo \"\$TMPDIR\"; sleep 0.05" 2>/dev/null | head -1)
sleep 0.1
[ -n "$TD" ] && [ ! -d "$TD" ] && ok "temp removed on exit" || bad "temp removed on exit ($TD)"

# INT signal also cleans up
TD2=$(bash -c "source '$SCRATCH/setup.sh'; echo \"\$TMPDIR\"; kill -INT \$\$ 2>/dev/null; sleep 5" 2>/dev/null | head -1)
sleep 0.1
[ -n "$TD2" ] && [ ! -d "$TD2" ] && ok "temp removed on SIGINT" || bad "temp removed on SIGINT ($TD2)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
