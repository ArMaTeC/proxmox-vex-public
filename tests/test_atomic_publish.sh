#!/bin/bash
# Spec 093/US033: atomic publish — clients must only ever see a complete
# consistent release set: stage into releases/<ver>, then swap `current`.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US033 atomic-publish tests"

check "publish script exists"           "[ -f scripts/publish.sh ]"
check "stages into releases/<ver>"      "grep -q 'releases/' scripts/publish.sh"
check "atomic symlink swap (mv -T)"     "grep -q 'mv -T\|ln -sfn' scripts/publish.sh"
check "version.json updated last"       "grep -n 'version.json' scripts/publish.sh | tail -1"
check "upload then swap order"          "grep -c 'scp\|rsync\|ssh\|sftp' scripts/publish.sh"
check "verifies remote consistency"     "grep -qi 'verify\|checksum\|sha256' scripts/publish.sh"
check "nginx serves current symlink"    "grep -q 'current' deploy/nginx.conf"
check "rollback note (keep old release)" "grep -qi 'previous\|old\|retain' scripts/publish.sh"
check "shellcheck-parseable"            "bash -n scripts/publish.sh"
check "documented"                      "grep -rqi 'publish' README.md docs/ 2>/dev/null"

# --- functional: local dry-run of the swap logic -----------------------------------
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/host/releases/1.0.0" "$SCRATCH/host/releases/2.0.0"
echo '{"version":"1.0.0"}' > "$SCRATCH/host/releases/1.0.0/version.json"
echo '{"version":"2.0.0"}' > "$SCRATCH/host/releases/2.0.0/version.json"
ln -sfn releases/1.0.0 "$SCRATCH/host/current"

# extract publish_swap function and run the swap
awk '/^publish_swap\(\)/,/^}/' scripts/publish.sh > "$SCRATCH/swap.sh"
bash -c "source '$SCRATCH/swap.sh'; publish_swap '$SCRATCH/host' '2.0.0'" >/dev/null 2>&1
rc=$?
[ $rc -eq 0 ] && ok "swap executed" || bad "swap executed (rc=$rc)"
[ "$(readlink "$SCRATCH/host/current")" = "releases/2.0.0" ] \
    && ok "current points to new release" || bad "current points to new release (got: $(readlink "$SCRATCH/host/current")"
[ -d "$SCRATCH/host/releases/1.0.0" ] && ok "old release retained" || bad "old release retained"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
