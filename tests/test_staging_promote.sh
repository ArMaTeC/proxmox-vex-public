#!/bin/bash
# Spec 093/US035: staging area + promote workflow — releases land in
# staging/, pass an e2e verification, then promote to public.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US035 staging-promote tests"

check "promote script exists"           "[ -f scripts/promote.sh ]"
check "staging path used"               "grep -q 'staging' scripts/promote.sh"
check "verification before promote"     "grep -qi 'verify\|e2e\|checksum\|signature' scripts/promote.sh"
check "aborts on failed verification"   "grep -qi 'not promoting\|failed\|die' scripts/promote.sh"
check "atomic move to public"           "grep -q 'releases/' scripts/promote.sh"
check "publish.sh can target staging"   "grep -qi 'staging' scripts/publish.sh"
check "shellcheck-parseable"            "bash -n scripts/promote.sh"
check "documented"                      "grep -rqi 'staging\|promote' README.md docs/ scripts/publish.sh 2>/dev/null"

# --- functional: staging verify + promote swap -------------------------------------
SCRATCH=$(mktemp -d)
awk '/^staging_verify\(\)/,/^}/' scripts/promote.sh > "$SCRATCH/sv.sh"
awk '/^promote_swap\(\)/,/^}/' scripts/promote.sh >> "$SCRATCH/sv.sh"

# staging layout: staging/releases/<ver>/ + staged version.json
mkdir -p "$SCRATCH/host/staging/releases/3.0.0" "$SCRATCH/host/releases"
echo fakepayload > "$SCRATCH/host/staging/releases/3.0.0/app.bin"
(cd "$SCRATCH/host/staging/releases/3.0.0" && sha256sum app.bin > checksums.txt)
echo '{"version":"3.0.0"}' > "$SCRATCH/host/staging/releases/3.0.0/version.json"

# local staging_verify over file:// layout
out=$(bash -c "source '$SCRATCH/sv.sh'
      staging_verify 'file://$SCRATCH/host/staging/releases/3.0.0' '3.0.0'" 2>&1); rc=$?
[ $rc -eq 0 ] && ok "staging verify passes" || bad "staging verify passes (rc=$rc: $out)"

# corrupt staged artifact → verify fails → no promote
echo corrupt >> "$SCRATCH/host/staging/releases/3.0.0/app.bin"
bash -c "source '$SCRATCH/sv.sh'
         staging_verify 'file://$SCRATCH/host/staging/releases/3.0.0' '3.0.0'" >/dev/null 2>&1
[ $? -ne 0 ] && ok "corrupt staging rejected" || bad "corrupt staging rejected"

# restore + promote swap locally
(cd "$SCRATCH/host/staging/releases/3.0.0" && sha256sum app.bin > checksums.txt)
bash -c "source '$SCRATCH/sv.sh'
         promote_swap '$SCRATCH/host' '3.0.0'" >/dev/null 2>&1
[ $? -eq 0 ] && ok "promote swap executed" || bad "promote swap executed"
[ -d "$SCRATCH/host/releases/3.0.0" ] && ok "release moved to public" || bad "release moved to public"
[ ! -d "$SCRATCH/host/staging/releases/3.0.0" ] && ok "staging cleared" || bad "staging cleared"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
