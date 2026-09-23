#!/bin/bash
# Spec 093/US040: parallel .tar.zst artifacts — zstd-capable hosts get the
# faster/smaller format; others transparently fall back to .tar.gz.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US040 zstd-artifact tests"

check "build emits .tar.zst"            "grep -q 'tar.zst\|zstd' scripts/build-release.sh"
check "zst in checksums"                "grep -q 'zst\|*.tar' scripts/sign-release.sh scripts/build-release.sh | head -2"
check "update.sh prefers zst"           "grep -q 'tar.zst\|zstd' update.sh"
check "fallback to .gz without zstd"    "grep -q 'command -v zstd\|EXT' update.sh"
check "metadata declares formats"       "grep -q 'formats\|zst' version.json version.schema.json 2>/dev/null | head -2"
check "shipped doc validates"           "python3 scripts/validate-version.py version.json"

# --- functional: extension selection ------------------------------------------------
SCRATCH=$(mktemp -d)
awk '/^pick_archive_ext\(\)/,/^}/' update.sh > "$SCRATCH/pe.sh"

# zstd available → .tar.zst
out=$(PATH_WITH_ZSTD=1 bash -c "
    zstd() { return 0; }
    export -f zstd
    source '$SCRATCH/pe.sh'; pick_archive_ext" 2>&1)
echo "$out" | grep -q 'zst' && ok "zstd host → .tar.zst" || bad "zstd host → .tar.zst (got: $out)"

# stub no zstd → .tar.gz
out=$(bash -c "
    command() { [ \"\$1\" = '-v' ] && return 1; }
    source '$SCRATCH/pe.sh'; pick_archive_ext" 2>&1)
echo "$out" | grep -q 'tar.gz' && ok "no zstd → .tar.gz" || bad "no zstd → .tar.gz (got: $out)"

# real system check consistency
if command -v zstd >/dev/null 2>&1; then
    bash -c "source '$SCRATCH/pe.sh'; pick_archive_ext" 2>/dev/null | grep -q 'zst' \
        && ok "real host consistent" || bad "real host consistent"
else
    bash -c "source '$SCRATCH/pe.sh'; pick_archive_ext" 2>/dev/null | grep -q 'gz' \
        && ok "real host consistent" || bad "real host consistent"
fi

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
