#!/bin/bash
# Spec 093/US008: standalone verify-release.sh — signature + checksum +
# manifest consistency, scriptable exit codes, human-readable output.
# Exit codes: 0 ok, 1 sig fail, 2 checksum fail, 3 missing files.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US008 standalone-verifier tests"

check "verify-release.sh exists + executable"   "test -x verify-release.sh"
check "POSIX shell (works on minimal systems)"  "head -1 verify-release.sh | grep -q 'sh'"
check "documents gpg requirement/fallback"      "grep -qi 'gpg\|gnupg' verify-release.sh"
check "exit 1 = signature failure"              "grep -q 'fail .* 1\|exit 1' verify-release.sh"
check "exit 2 = checksum failure"               "grep -q 'exit 2\|exit \"\?2' verify-release.sh"
check "exit 3 = missing files"                  "grep -q 'exit 3\|exit \"\?3' verify-release.sh"
check "human-readable PASS/FAIL output"         "grep -q 'OK\|FAIL' verify-release.sh"
check "airgap verification documented"          "grep -qi 'airgap\|offline' docs/verify.md verify-release.sh 2>/dev/null"

# --- functional: real exit codes on the shipped artifacts ----------------------
SCRATCH=$(mktemp -d)
cp dist/ProxmoxVEx-latest.tar.gz dist/ProxmoxVEx-latest.tar.gz.asc \
   dist/checksums.txt pubkey.asc "$SCRATCH/" 2>/dev/null || true

# 0: good artifact (checksum path always runs; sig needs gpg)
./verify-release.sh "$SCRATCH/ProxmoxVEx-latest.tar.gz" \
    --checksums "$SCRATCH/checksums.txt" --pubkey "$SCRATCH/pubkey.asc" \
    >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then ok "valid artifact → exit 0"; else bad "valid artifact → exit 0 (got $rc)"; fi

# 1: tampered archive still named the same → sig mismatch
cp "$SCRATCH/ProxmoxVEx-latest.tar.gz" "$SCRATCH/tampered.tar.gz"
echo "evil" >> "$SCRATCH/tampered.tar.gz"
cp "$SCRATCH/ProxmoxVEx-latest.tar.gz.asc" "$SCRATCH/tampered.tar.gz.asc"
./verify-release.sh "$SCRATCH/tampered.tar.gz" \
    --checksums /dev/null --pubkey "$SCRATCH/pubkey.asc" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 1 ] && ok "bad signature → exit 1" || bad "bad signature → exit 1 (got $rc)"

# 2: checksum mismatch (sig skipped via --checksum-only)
./verify-release.sh "$SCRATCH/tampered.tar.gz" --checksum-only \
    --checksums "$SCRATCH/checksums.txt" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 2 ] && ok "checksum mismatch → exit 2" || bad "checksum mismatch → exit 2 (got $rc)"

# 3: missing signature file
rm -f "$SCRATCH/tampered.tar.gz.asc"
./verify-release.sh "$SCRATCH/tampered.tar.gz" \
    --checksums /dev/null --pubkey "$SCRATCH/pubkey.asc" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 3 ] && ok "missing signature → exit 3" || bad "missing signature → exit 3 (got $rc)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
