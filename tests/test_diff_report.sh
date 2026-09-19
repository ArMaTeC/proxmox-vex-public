#!/bin/bash
# Spec 093/US100: per-release file-diff report — dist/diff-<prev>-to-<ver>.txt
# categorizes files ADDED/CHANGED/REMOVED vs the previous tarball so change
# review doesn't require extracting two archives.
set -u
cd "$(dirname "$0")/.." || exit 1

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US100 diff-report tests"

check "diff generator shipped"        "test -f scripts/gen-diff.sh"
check "wired into build-release"      "grep -q 'gen-diff' scripts/build-release.sh"
check "output naming"                 "grep -q 'diff-' scripts/build-release.sh"

# functional: two scratch releases -> categorized diff
SCRATCH=$(mktemp -d); trap 'rm -rf "$SCRATCH"' EXIT
mkdir -p "$SCRATCH/old/install" "$SCRATCH/new/install" "$SCRATCH/dist"
echo same   > "$SCRATCH/old/install/kept.txt"
echo old    > "$SCRATCH/old/install/changed.txt"
echo gone   > "$SCRATCH/old/install/removed.txt"
echo same   > "$SCRATCH/new/install/kept.txt"
echo NEW    > "$SCRATCH/new/install/changed.txt"
echo fresh  > "$SCRATCH/new/install/added.txt"
tar -czf "$SCRATCH/dist/ProxmoxVEx-1.0.0.tar.gz" -C "$SCRATCH/old" install
tar -czf "$SCRATCH/dist/ProxmoxVEx-1.1.0.tar.gz" -C "$SCRATCH/new" install

bash scripts/gen-diff.sh "$SCRATCH/dist/ProxmoxVEx-1.0.0.tar.gz" \
    "$SCRATCH/dist/ProxmoxVEx-1.1.0.tar.gz" "$SCRATCH/dist/diff-1.0.0-to-1.1.0.txt" >/dev/null 2>&1

R="$SCRATCH/dist/diff-1.0.0-to-1.1.0.txt"
check "report emitted"                "test -f '$R'"
check "CHANGED categorized"           "grep -q '^CHANGED.*changed.txt' '$R'"
check "ADDED categorized"             "grep -q '^ADDED.*added.txt' '$R'"
check "REMOVED categorized"           "grep -q '^REMOVED.*removed.txt' '$R'"
check "unchanged not listed"          "! grep -q 'kept.txt' '$R'"
check "header names both versions"    "grep -q '1.0.0' '$R' && grep -q '1.1.0' '$R'"
check "documented in verify.md"       "grep -q 'diff' docs/verify.md"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
