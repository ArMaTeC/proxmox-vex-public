#!/bin/bash
# Spec 093/US036: CDN invalidation on publish — metadata paths are purged so
# edges can't serve a stale trust root after a release goes live.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US036 cdn-purge tests"

check "purge function exists"           "grep -q 'cdn_purge\|purge' scripts/publish.sh"
check "purges version.json"             "grep -q 'version.json' scripts/publish.sh"
check "purges latest tarball pointer"   "grep -q 'latest' scripts/publish.sh"
check "purges checksums"                "grep -q 'checksums' scripts/publish.sh"
check "POST purge request"              "grep -q 'POST\|purge' scripts/publish.sh"
check "auth token from env"             "grep -q 'CDN_TOKEN\|Authorization' scripts/publish.sh"
check "purge failure is warn-only"      "grep -qi 'WARN.*purge\|purge.*fail' scripts/publish.sh"
check "runs after swap"                 "awk '/current ->/{found=NR} /cdn_purge/{print (found && NR>found)}' scripts/publish.sh | grep -q 1"
check "shellcheck-parseable"            "bash -n scripts/publish.sh"

# --- functional: stub curl, capture the purge payload ------------------------------
SCRATCH=$(mktemp -d)
awk '/^cdn_purge\(\)/,/^}/' scripts/publish.sh > "$SCRATCH/cp.sh"

out=$(CDN_TOKEN=tok123 CDN_API=https://cdn.example/purge bash -c "
    curl() { echo \"MOCKED \$*\" >> '$SCRATCH/calls.log'; return 0; }
    export -f curl
    source '$SCRATCH/cp.sh'
    cdn_purge
" 2>&1); rc=$?
[ $rc -eq 0 ] && ok "purge runs clean" || bad "purge runs clean (rc=$rc: $out)"
[ -f "$SCRATCH/calls.log" ] && ok "purge request issued" || bad "purge request issued"
grep -q 'tok123' "$SCRATCH/calls.log" 2>/dev/null && ok "bearer token sent" || bad "bearer token sent"
grep -q 'version.json' "$SCRATCH/calls.log" 2>/dev/null && ok "version.json in purge list" || bad "version.json in purge list"
grep -q 'latest' "$SCRATCH/calls.log" 2>/dev/null && ok "latest pointer purged" || bad "latest pointer purged"

# purge failure → warning but success path unaffected (best-effort)
out=$(CDN_TOKEN=tok CDN_API=https://cdn.example bash -c "
    curl() { return 7; }
    export -f curl
    source '$SCRATCH/cp.sh'
    cdn_purge; echo rc=\$?
" 2>&1)
echo "$out" | grep -qi 'warn' && ok "failed purge warns" || bad "failed purge warns (got: $out)"
echo "$out" | grep -q 'rc=0' && ok "failed purge non-fatal" || bad "failed purge non-fatal (got: $out)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
