#!/bin/bash
# Spec 093/US032: resumable downloads — interrupted transfers resume from
# byte offset via Range, not from scratch; a .done marker seals completion.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US032 resumable-download tests"

check "resume flag (-C -) used"         "grep -q 'C -\|continue-at' update.sh"
check "fetch helper exists"             "grep -q 'fetch_resume\|fetch()' update.sh"
check "done marker used"                "grep -q '.done' update.sh"
check "retry logic"                     "grep -q 'retry' update.sh"
check "archive uses resumable fetch"    "grep -n 'curl.*GITHUB_ARCHIVE.*ARCHIVE\|fetch_resume' update.sh | grep -c 'GITHUB_ARCHIVE'"

# --- functional -------------------------------------------------------------------
SCRATCH=$(mktemp -d)
awk '/^fetch_resume\(\)/,/^}/' update.sh > "$SCRATCH/fr.sh"

# build a source file and a half-downloaded partial
dd if=/dev/urandom of="$SCRATCH/src.bin" bs=1024 count=64 2>/dev/null
head -c 32768 "$SCRATCH/src.bin" > "$SCRATCH/part.bin"   # 50% partial

# resume must complete the file, not restart
bash -c "source '$SCRATCH/fr.sh'
         fetch_resume 'file://$SCRATCH/src.bin' '$SCRATCH/part.bin'" >/dev/null 2>&1
rc=$?
[ $rc -eq 0 ] && ok "resume completed" || bad "resume completed (rc=$rc)"
[ -f "$SCRATCH/part.bin.done" ] && ok "done marker written" || bad "done marker written"
cmp -s "$SCRATCH/src.bin" "$SCRATCH/part.bin" && ok "resumed bytes identical" || bad "resumed bytes identical"

# already-done file is not refetched (mtime stable)
sleep 1.1
before=$(stat -c%Y "$SCRATCH/part.bin")
bash -c "source '$SCRATCH/fr.sh'
         fetch_resume 'file://$SCRATCH/src.bin' '$SCRATCH/part.bin'" >/dev/null 2>&1
after=$(stat -c%Y "$SCRATCH/part.bin")
[ "$before" = "$after" ] && ok "done file not refetched" || bad "done file not refetched"

# dead URL → nonzero, no .done marker
bash -c "source '$SCRATCH/fr.sh'
         fetch_resume 'file://$SCRATCH/nope.bin' '$SCRATCH/x.bin'" >/dev/null 2>&1
[ $? -ne 0 ] && [ ! -f "$SCRATCH/x.bin.done" ] && ok "dead URL fails clean" || bad "dead URL fails clean"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
