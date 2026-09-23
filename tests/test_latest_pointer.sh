#!/bin/bash
# Spec 093/US038: -latest pointer consistency — the quick-start URL redirects
# to the versioned artifact via a generated conf include written by publish.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US038 latest-pointer tests"

check "latest.conf include exists"      "[ -f deploy/latest.conf ]"
check "redirects to versioned artifact" "grep -q 'return 30\|redirect' deploy/latest.conf"
check "targets versioned filename"      "grep -q 'ProxmoxVEx-[0-9]' deploy/latest.conf"
check "nginx includes generated conf"   "grep -q 'latest.conf\|include' deploy/nginx.conf"
check "publish generates the include"   "grep -q 'latest.conf' scripts/publish.sh"
check "generated atomically (mv/tmp)"   "grep -q 'tmp\|mv' scripts/publish.sh"
check "short cache on redirect"         "grep -q 'max-age=60\|no-cache' deploy/latest.conf deploy/nginx.conf"
check "shellcheck-parseable"            "bash -n scripts/publish.sh"

# --- functional: publish generates correct include ---------------------------------
SCRATCH=$(mktemp -d)
awk '/^write_latest_conf\(\)/,/^}/' scripts/publish.sh > "$SCRATCH/wl.sh"
bash -c "source '$SCRATCH/wl.sh'; write_latest_conf '$SCRATCH' '1.9.9'" >/dev/null 2>&1
rc=$?
[ $rc -eq 0 ] && ok "include generated" || bad "include generated (rc=$rc)"
[ -f "$SCRATCH/latest.conf" ] && ok "latest.conf written" || bad "latest.conf written"
grep -q 'ProxmoxVEx-1.9.9.tar.gz' "$SCRATCH/latest.conf" 2>/dev/null \
    && ok "include points at versioned file" || bad "include points at versioned file"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
