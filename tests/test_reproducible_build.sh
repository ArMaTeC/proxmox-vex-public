#!/bin/bash
# Spec 093/US006: deterministic release tarballs — normalized mtimes,
# ordering, ownership; two builds of one tree produce identical sha256.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US006 reproducible-build tests"

check "scripts/build-release.sh exists"           "test -x scripts/build-release.sh"
check "SOURCE_DATE_EPOCH set from git commit"     "grep -q 'SOURCE_DATE_EPOCH' scripts/build-release.sh"
check "tar sorts entries by name"                 "grep -q 'sort=name' scripts/build-release.sh"
check "tar normalizes owner/group"                "grep -q 'owner=0' scripts/build-release.sh"
check "tar pins mtime to epoch"                   "grep -q 'mtime=' scripts/build-release.sh"
check "pyc/bytecode handled"                      "grep -q 'pyc\|PYTHONHASHSEED' scripts/build-release.sh"
check "CI verifies reproducibility"               "grep -q 'reproducib\|rebuild' .github/workflows/release.yml"

# --- functional: two builds of the same tree must be byte-identical ------------
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/src/sub"
echo "hello" > "$SCRATCH/src/a.txt"
echo "world" > "$SCRATCH/src/sub/b.txt"
# poison mtimes + a bytecode artifact that must not leak into the tarball
touch -d '2030-01-01' "$SCRATCH/src/a.txt"
touch -d '1999-06-15' "$SCRATCH/src/sub/b.txt"
echo "bytecode" > "$SCRATCH/src/mod.pyc"
chmod 777 "$SCRATCH/src/sub/b.txt"

EPOCH=1700000000
OUT1="$SCRATCH/out1"; OUT2="$SCRATCH/out2"
SOURCE_DATE_EPOCH=$EPOCH BUILD_DIR="$SCRATCH/src" OUT_DIR="$OUT1" VERSION=t \
    bash scripts/build-release.sh >/dev/null 2>&1
rc1=$?
SOURCE_DATE_EPOCH=$EPOCH BUILD_DIR="$SCRATCH/src" OUT_DIR="$OUT2" VERSION=t \
    bash scripts/build-release.sh >/dev/null 2>&1
rc2=$?

if [ $rc1 -eq 0 ] && [ $rc2 -eq 0 ]; then
    T1=$(find "$OUT1" -name '*.tar.gz' | head -1)
    T2=$(find "$OUT2" -name '*.tar.gz' | head -1)
    if [ -n "$T1" ] && cmp -s "$T1" "$T2"; then
        ok "two builds of the same tree are byte-identical"
    else
        bad "two builds of the same tree are byte-identical"
    fi
    check "poisoned mtimes normalized" \
        "! tar -tzvf '$T1' 2>/dev/null | grep -q '2030\|1999'"
    check "no .pyc in tarball" \
        "! tar -tzf '$T1' | grep -q 'pyc'"
    check "ownership normalized to root:root" \
        "tar -tzvf '$T1' | grep -q 'root/root\|0/0'"
else
    bad "two builds of the same tree are byte-identical (rc=$rc1/$rc2)"
    bad "poisoned mtimes normalized"
    bad "no .pyc in tarball"
    bad "ownership normalized to root:root"
fi

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
