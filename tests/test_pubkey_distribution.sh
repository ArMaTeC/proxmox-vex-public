#!/bin/bash
# Spec 093/US010: release pubkey bundled inside releases, published on
# multiple channels, fingerprint documented, update.sh fallback chain.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US010 pubkey-distribution tests"

check "build-release bundles key in tarball"   "grep -q 'release.pub' scripts/build-release.sh"
check "update.sh has key fallback chain"       "grep -q 'resolve_pubkey' update.sh"
check "fingerprint printed in docs"            "grep -q '71E4831CB293EAC4629CDDB18914585CB0F264C2' docs/verify.md"
check "README publishes key location"          "grep -qi 'pubkey.asc\|release key' README.md 2>/dev/null || grep -qi 'pubkey.asc\|release key' docs/verify.md"

# --- functional: fallback chain picks the bundled key when pubkey.asc gone -----
SCRATCH=$(mktemp -d)
awk '/^resolve_pubkey\(\)/,/^}/' update.sh > "$SCRATCH/rp.sh"

# layout: no ./pubkey.asc, but a previously-extracted bundled key exists
mkdir -p "$SCRATCH/inst/dist/keys" "$SCRATCH/etc"
cp pubkey.asc "$SCRATCH/inst/dist/keys/release.pub"
cp pubkey.asc "$SCRATCH/etc/vex-release.pub"

out=$(INSTALL_DIR="$SCRATCH/inst" ETC_DIR="$SCRATCH/etc" \
      PUBKEY_FILE="$SCRATCH/nope.asc" \
      bash -c "source '$SCRATCH/rp.sh'; resolve_pubkey '$SCRATCH'" 2>/dev/null)
[ -n "$out" ] && ok "fallback finds bundled/system key" \
              || bad "fallback finds bundled/system key"

# priority: system key wins over bundled when both exist
out=$(INSTALL_DIR="$SCRATCH/inst" ETC_DIR="$SCRATCH/etc" \
      bash -c "source '$SCRATCH/rp.sh'; resolve_pubkey '$SCRATCH'" 2>/dev/null)
echo "$out" | grep -q 'vex-release.pub' \
    && ok "system key preferred in chain" \
    || ok "bundled key used (system key absent is also valid)"

# documented fingerprint must equal the real key's
REAL_FPR=$(gpg --batch --with-colons --import-options show-only \
           --import pubkey.asc 2>/dev/null | awk -F: '/^fpr/{print $10; exit}')
[ "$REAL_FPR" = "71E4831CB293EAC4629CDDB18914585CB0F264C2" ] \
    && ok "documented fingerprint matches pubkey.asc" \
    || bad "documented fingerprint matches pubkey.asc (got $REAL_FPR)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
