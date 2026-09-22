#!/bin/bash
# Spec 093/US002: published SHA256 checksums manifest.
#
# Independent test: sha256sum -c dist/checksums.txt must pass, and
# update.sh must verify the downloaded archive against the published
# manifest (matching the real archive name, not a placeholder).
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
# eval inside a subshell so `exit` inside a checked command can't kill the suite
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US002 checksum tests"

check "dist/checksums.txt exists"            "test -f dist/checksums.txt"
check "every tarball appears in manifest"    "for t in dist/*.tar.gz; do grep -q \"\$(basename \$t)\" dist/checksums.txt || exit 1; done"
check "manifest lines are sha256 format"     "grep -Eq '^[0-9a-f]{64}  ' dist/checksums.txt"
check "generator in scripts/"                "grep -rl 'checksums.txt' scripts/ | grep -q ."

# Independent test: the manifest verifies against the real artifacts.
check "sha256sum -c verifies all artifacts" \
  "(cd dist && sha256sum -c --quiet checksums.txt)"

# update.sh wiring: the checksum lookup must name the downloaded archive
# (ProxmoxVEx-latest.tar.gz), and mismatch must be fatal.
check "update.sh fetches checksums.txt"      "grep -q 'checksums.txt' update.sh"
check "lookup keys on the archive basename"  "grep -Eq 'basename.*ARCHIVE|ARCHIVE_BASENAME' update.sh"
check "checksum mismatch aborts"             "grep -Eq 'CHECKSUM MISMATCH|checksum.*(mismatch|FAILED)' update.sh"

# Functional: manifest correctness is provable — recompute and compare.
check "recomputed manifest matches published" \
  "(cd dist && sha256sum *.tar.gz *.tar.zst 2>/dev/null | diff - checksums.txt)"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
