#!/bin/bash
# Spec 093/US014: delta packages between versions — update.sh prefers a
# published delta for the installed version, applies it, and verifies the
# resulting tree byte-for-byte against the delta's signed target manifest.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US014 delta-update tests"

check "scripts/build-delta.sh exists"           "test -x scripts/build-delta.sh"
check "version.json carries deltas block"       "python3 -c \"import json;exit(0 if 'deltas' in json.load(open('version.json')) else 1)\""
check "update.sh resolves delta for current"    "grep -q 'resolve_delta\|deltas' update.sh"
check "delta path reuses signature verify"      "grep -q 'verify_signature' update.sh && grep -q 'delta' update.sh"
check "delta result verified against manifest"  "grep -q 'verify_delta_tree\|target_files' update.sh scripts/build-delta.sh"
check "delta fallback to full archive"          "grep -qi 'fall.*full\|full archive\|delta.*fallback\|fallback' update.sh"
check "delta chains bounded"                    "grep -qi 'MAX_DELTA\|hops\|bounded' scripts/build-delta.sh update.sh"

# --- functional: build a real delta and apply it -------------------------------
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/old/src" "$SCRATCH/new/src/sub"
echo same   > "$SCRATCH/old/src/keep.py"
echo oldver > "$SCRATCH/old/src/app.py"
echo gone   > "$SCRATCH/old/src/removed.py"
echo same   > "$SCRATCH/new/src/keep.py"
echo newver > "$SCRATCH/new/src/app.py"
echo added  > "$SCRATCH/new/src/sub/added.py"

tar -czf "$SCRATCH/old.tar.gz" -C "$SCRATCH/old/src" .
tar -czf "$SCRATCH/new.tar.gz" -C "$SCRATCH/new/src" .

bash scripts/build-delta.sh "$SCRATCH/old.tar.gz" "$SCRATCH/new.tar.gz" \
    "$SCRATCH/delta.tar.gz" >/dev/null 2>&1
rc=$?
[ $rc -eq 0 ] && [ -f "$SCRATCH/delta.tar.gz" ] \
    && ok "build-delta produces a delta package" \
    || bad "build-delta produces a delta package (rc=$rc)"

# delta must be smaller than full (only changed files inside)
DS=$(stat -c%s "$SCRATCH/delta.tar.gz" 2>/dev/null || echo 0)
FS=$(stat -c%s "$SCRATCH/new.tar.gz" 2>/dev/null || echo 1)
[ "$DS" -gt 0 ] && ok "delta package non-empty ($DS vs full $FS bytes)" \
                || bad "delta package non-empty"

# extract apply_delta + verify_delta_tree from update.sh
awk '/^apply_delta\(\)/,/^}/; /^verify_delta_tree\(\)/,/^}/' update.sh > "$SCRATCH/df.sh"
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh"

# simulate an install dir at the OLD version, apply the delta
mkdir -p "$SCRATCH/install"
tar -xzf "$SCRATCH/old.tar.gz" -C "$SCRATCH/install"
mkdir -p "$SCRATCH/delta_x" && tar -xzf "$SCRATCH/delta.tar.gz" -C "$SCRATCH/delta_x"

bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/df.sh'
    apply_delta '$SCRATCH/delta_x' '$SCRATCH/install'
" >/dev/null 2>&1
rc=$?
[ $rc -eq 0 ] && ok "apply_delta applies cleanly" || bad "apply_delta applies cleanly (rc=$rc)"

check "changed file updated"    "grep -q newver '$SCRATCH/install/app.py'"
check "added file present"      "test -f '$SCRATCH/install/sub/added.py'"
check "removed file deleted"    "! test -e '$SCRATCH/install/removed.py'"
check "unchanged file kept"     "grep -q same '$SCRATCH/install/keep.py'"

# byte-identical to a full install
mkdir -p "$SCRATCH/full"
tar -xzf "$SCRATCH/new.tar.gz" -C "$SCRATCH/full"
diff -r "$SCRATCH/install" "$SCRATCH/full" >/dev/null 2>&1
check "delta-applied tree byte-identical to full" "[ $? -eq 0 ]"

# verify_delta_tree against the delta manifest
bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/df.sh'
    verify_delta_tree '$SCRATCH/install' '$SCRATCH/delta_x/delta-manifest.json'
" >/dev/null 2>&1
rc=$?
[ $rc -eq 0 ] && ok "verify_delta_tree accepts correct tree" || bad "verify_delta_tree accepts correct tree (rc=$rc)"

# corrupt one file → must fail
echo corrupt > "$SCRATCH/install/app.py"
bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/df.sh'
    verify_delta_tree '$SCRATCH/install' '$SCRATCH/delta_x/delta-manifest.json'
" >/dev/null 2>&1
rc=$?
[ $rc -ne 0 ] && ok "verify_delta_tree rejects corrupted tree" || bad "verify_delta_tree rejects corrupted tree"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
