#!/bin/bash
# Spec 093/US090: signature forgery rejection — adversarial proof that
# artifacts signed by a wrong key and tampered signed metadata are both
# refused before any mutation.
set -u
cd "$(dirname "$0")/.." || exit 1

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US090 forgery-rejection tests"

SCRATCH=$(mktemp -d); trap 'rm -rf "$SCRATCH"' EXIT

# attacker key in an isolated keyring (real release key stays in ~/.gnupg)
EVIL="$SCRATCH/gpg"; mkdir -p "$EVIL"; chmod 700 "$EVIL"
gpg --batch --quiet --homedir "$EVIL" --pinentry-mode loopback --passphrase '' \
    --quick-gen-key "Mallory <mallory@evil.example>" ed25519 sign never \
    || { echo "SKIP: gpg keygen unavailable"; exit 0; }

build_fixture() { # build_fixture <dir>: old install + dist tree
    local S="$1"
    mkdir -p "$S/install/releases/1.0.0" "$S/install/config" "$S/dist"
    echo 'v1' > "$S/install/releases/1.0.0/app.txt"
    echo 'cfg' > "$S/install/config/app.conf"
    cp update.sh "$S/install/releases/1.0.0/"
    ln -sfn "$S/install/releases/1.0.0" "$S/install/current"
    echo '1.0.0' > "$S/install/.active-version"
    cp update.sh "$S/install/"
    cp pubkey.asc "$S/install/"          # the trust root the updater pins
    mkdir -p "$S/pkg/install"
    echo 'v2' > "$S/pkg/install/app.txt"
    tar -czf "$S/dist/ProxmoxVEx-2.0.0.tar.gz" -C "$S/pkg" install
    cat > "$S/dist/version.json" <<JSON
{"version":"2.0.0","build":"x","release_date":"2026-01-01","min_python":"3.8",
 "changelog":[],"download_url":"file://$S/dist/ProxmoxVEx-2.0.0.tar.gz",
 "channels":{"stable":{"version":"2.0.0","archive":"ProxmoxVEx-2.0.0.tar.gz"}},
 "mirrors":["file://$S/dist"]}
JSON
}

canon() { python3 -c "
import json
d=json.load(open('$1'))
open('$1.canon','w').write(json.dumps(d,sort_keys=True,separators=(',',':'))+'\n')"; }

run_update() { # run_update <install-dir> <dist-dir>
    (cd "$1" && VEX_UPDATE_BASE="file://$2" \
        HEALTH_URL="file:///dev/null" HEALTH_TIMEOUT=5 VEX_SKIP_POST_VERIFY=1 \
        bash update.sh --atomic --yes 2>&1)
}

# --- A: version.json signed by the attacker's key -------------------------
A="$SCRATCH/A"; build_fixture "$A"
canon "$A/dist/version.json"
gpg --batch --quiet --homedir "$EVIL" --armor \
    --detach-sign -o "$A/dist/version.json.asc" "$A/dist/version.json.canon"
# shellcheck disable=SC2034
out=$(run_update "$A/install" "$A/dist"); rc=$?
check "forged metadata rejected"      "test $rc -ne 0"
check "untrusted metadata named"      "echo \"\$out\" | grep -qi 'untrusted\|signature FAILED'"
check "install untouched (A)"         "readlink $A/install/current | grep -q 'releases/1.0.0$'"

# --- B: good metadata, archive signed by the attacker's key ---------------
B="$SCRATCH/B"; build_fixture "$B"
env -u GNUPGHOME bash scripts/sign-version.sh "$B/dist/version.json" >/dev/null 2>&1
gpg --batch --quiet --homedir "$EVIL" --armor \
    --detach-sign -o "$B/dist/ProxmoxVEx-2.0.0.tar.gz.asc" "$B/dist/ProxmoxVEx-2.0.0.tar.gz"
# shellcheck disable=SC2034
out=$(run_update "$B/install" "$B/dist"); rc=$?
check "forged archive sig rejected"   "test $rc -ne 0"
check "archive sig failure named"     "echo \"\$out\" | grep -qi 'signature verification FAILED\|does not verify'"
check "install untouched (B)"         "readlink $B/install/current | grep -q 'releases/1.0.0$'"
check "no 2.0.0 staged (B)"           "! test -d $B/install/releases/2.0.0"

# --- C: control — the same fixture signed by the REAL key must pass -------
C="$SCRATCH/C"; build_fixture "$C"
env -u GNUPGHOME bash scripts/sign-version.sh "$C/dist/version.json" >/dev/null 2>&1
env -u GNUPGHOME gpg --batch --quiet --armor --detach-sign \
    -u "ProxmoxVEx Release Signing <releases@proxmoxvex.com>" \
    -o "$C/dist/ProxmoxVEx-2.0.0.tar.gz.asc" "$C/dist/ProxmoxVEx-2.0.0.tar.gz"
run_update "$C/install" "$C/dist" >/dev/null; rc=$?
check "control: real sig accepted"    "test $rc -eq 0"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
