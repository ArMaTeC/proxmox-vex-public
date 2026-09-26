#!/bin/bash
# Spec 093/US063: config+data backup before update — a timestamped
# backups/pre-update-*/state.tgz captures config/, ssl/ and data/ before
# the swap; the last 5 state backups are retained.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US063 state-backup tests"

check "state backup helper exists"      "grep -q 'backup_state()' update.sh"
check "timestamped pre-update dir"      "grep -q 'pre-update-' update.sh"
check "tarball written"                 "grep -q 'state.tgz' update.sh"
check "retention prune (keep 5)"        "grep -q 'tail -n +6' update.sh"
check "wired into update flow"          "grep -q 'backup_state$' update.sh"

# --- functional: run the helper on a scratch tree -------------------------
SCRATCH=$(mktemp -d)
# die lives elsewhere in update.sh — stub it so `|| die` aborts as designed.
printf 'die() { echo "die: $*" >&2; exit 1; }\n' > "$SCRATCH/fn.sh"
awk '/^backup_state\(\)/,/^}/' update.sh >> "$SCRATCH/fn.sh"
mkdir -p "$SCRATCH/inst/config" "$SCRATCH/inst/ssl" "$SCRATCH/inst/data/keys"
echo "cfg" > "$SCRATCH/inst/config/app.conf"
echo "key" > "$SCRATCH/inst/ssl/key.pem"
echo "k1"  > "$SCRATCH/inst/data/keys/k1"

out=$(BASE_DIR="$SCRATCH/inst" bash -c "source '$SCRATCH/fn.sh'; backup_state" 2>&1)
ls -d "$SCRATCH/inst"/backups/pre-update-*/state.tgz >/dev/null 2>&1 \
    && ok "state.tgz produced" || bad "state.tgz produced ($out)"

tar -tzf "$SCRATCH/inst"/backups/pre-update-*/state.tgz 2>/dev/null | grep -q 'config/app.conf' \
    && ok "config captured" || bad "config captured"
tar -tzf "$SCRATCH/inst"/backups/pre-update-*/state.tgz 2>/dev/null | grep -q 'ssl/key.pem' \
    && ok "ssl keys captured" || bad "ssl keys captured"

# retention: 7 runs (sleep for distinct timestamps) → at most 5 dirs
for i in 1 2 3 4 5 6 7; do
    BASE_DIR="$SCRATCH/inst" bash -c "source '$SCRATCH/fn.sh'; backup_state" >/dev/null 2>&1
    sleep 1.1
done
n=$(ls -1d "$SCRATCH/inst"/backups/pre-update-* 2>/dev/null | wc -l)
[ "$n" -le 5 ] && ok "retention keeps <=5 ($n kept)" || bad "retention keeps <=5 ($n kept)"

# empty tree → backup must fail, not produce a silent empty tarball
mkdir -p "$SCRATCH/empty"
out=$(BASE_DIR="$SCRATCH/empty" bash -c "source '$SCRATCH/fn.sh'; backup_state" 2>&1); rc=$?
[ $rc -ne 0 ] && ok "empty tree → backup fails" || bad "empty tree → backup fails"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
