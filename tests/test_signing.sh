#!/bin/bash
# Spec 093/US001: release tarball signing + verify-before-install.
#
# Independent test: sign a release, verify it; tamper the tarball,
# confirm verification fails. Runs the real shipped signature + key
# against gpg in a scratch keyring — no repo state is touched.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
# eval inside a subshell so `exit` inside a checked command can't kill the suite
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US001 signing tests"

# --- static contract ---------------------------------------------------------
check "update.sh is bash-clean"            "bash -n update.sh"
check "update.sh fetches a signature"      "grep -Eq 'ARCHIVE.*\.(asc|minisig)|SIG_URL' update.sh"
check "update.sh verifies before extract"  "awk '/Verifying archive signature/,/Extracting archive/' update.sh | grep -Eq 'gpg|minisign'"
check "bad signature aborts (die/exit)"    "grep -Eq 'signature verification (failed|FAILED)' update.sh"
check "--verify flag exists"               "grep -q '\-\-verify' update.sh"
check "pubkey.asc published"               "test -f pubkey.asc"
check "sign-release.sh exists"             "test -x scripts/sign-release.sh"

# --- published artifacts verify ----------------------------------------------
if [ -f pubkey.asc ]; then
  GNUPGHOME_T=$(mktemp -d); export GNUPGHOME="$GNUPGHOME_T"
  check "pubkey.asc imports as a public key" "gpg --batch --import pubkey.asc"
  for tb in dist/ProxmoxVEx-latest.tar.gz dist/ProxmoxVEx-*.tar.gz; do
    [ -f "$tb" ] || continue
    base=$(basename "$tb")
    if [ -f "$tb.asc" ]; then
      check "signature verifies: $base" "gpg --batch --verify '$tb.asc' '$tb'"
    else
      bad "signature missing: $base.asc"
    fi
  done
  rm -rf "$GNUPGHOME_T"; unset GNUPGHOME
fi

# --- functional: --verify good vs tampered -----------------------------------
SCRATCH=$(mktemp -d)
if [ -f dist/ProxmoxVEx-latest.tar.gz ] && [ -f dist/ProxmoxVEx-latest.tar.gz.asc ]; then
  cp dist/ProxmoxVEx-latest.tar.gz dist/ProxmoxVEx-latest.tar.gz.asc "$SCRATCH/"
  check "--verify passes on shipped tarball" \
    "bash update.sh --verify --file '$SCRATCH/ProxmoxVEx-latest.tar.gz' >/dev/null"
  # tamper: flip a byte mid-archive — signature MUST fail
  python3 - "$SCRATCH/ProxmoxVEx-latest.tar.gz" <<'PY'
import sys
p = sys.argv[1]
d = bytearray(open(p, 'rb').read())
d[len(d)//2] ^= 0xFF
open(p, 'wb').write(bytes(d))
PY
  if bash update.sh --verify --file "$SCRATCH/ProxmoxVEx-latest.tar.gz" >/dev/null 2>&1; then
    bad "--verify REJECTS a tampered tarball"
  else
    ok "--verify REJECTS a tampered tarball"
  fi
else
  bad "shipped tarball + .asc present for --verify functional test"
fi
rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
