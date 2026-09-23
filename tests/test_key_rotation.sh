#!/bin/bash
# Spec 093/US004: signing-key rotation with old-key countersignature.
#
# Independent test: build a scratch old/new/attacker key scenario, run
# the SHIPPED rotation logic (extracted from update.sh), confirm a
# properly countersigned rotation installs the new key and a forged
# rotation is rejected.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US004 key-rotation tests"

check "update.sh fetches keys/rotation.json"     "grep -q 'keys/rotation.json' update.sh"
check "rotation doc signature is verified"       "grep -q 'verify_rotation_doc' update.sh"
check "bad rotation signature aborts"            "grep -Eq 'rotation.*(signature|sig).*(FAILED|fail)' update.sh"
check "new pubkey embedded in rotation doc"      "grep -q 'new_pubkey' update.sh"
check "docs/key-rotation.md exists"              "test -f docs/key-rotation.md"
check "doc covers countersign + publish steps"   "grep -qi 'countersign\|sign.*old.*key' docs/key-rotation.md"
check "scripts/rotate-keys.sh exists"            "test -x scripts/rotate-keys.sh"

# --- functional: run the shipped functions on a scratch scenario ---------------
SCRATCH=$(mktemp -d)
# Extract the real shipped functions out of update.sh — tests exercise the
# same logic the updater runs, not a copy.
awk '/^resolve_pubkey\(\)/,/^}/; /^verify_rotation_doc\(\)/,/^}/; /^process_key_rotation\(\)/,/^}/' \
    update.sh > "$SCRATCH/rot.sh"
# extract die() too (used on forged docs)
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh" || true

# three ephemeral keypairs: current (old), next, attacker
mkkey() {
    mkdir -p "$SCRATCH/$1"; chmod 700 "$SCRATCH/$1"
    GNUPGHOME="$SCRATCH/$1" gpg --batch --gen-key >/dev/null 2>&1 <<EOF
Key-Type: eddsa
Key-Curve: ed25519
Name-Real: $1
Expire-Date: 0
%no-protection
%commit
EOF
}
mkkey oldkey; mkkey newkey; mkkey attacker

# current trust root = old pubkey
GNUPGHOME="$SCRATCH/oldkey" gpg --batch --export -a oldkey > "$SCRATCH/pubkey.asc"
GNUPGHOME="$SCRATCH/newkey" gpg --batch --export -a newkey > "$SCRATCH/newpub.asc"
NEWFP=$(GNUPGHOME="$SCRATCH/newkey" gpg --batch --with-colons -k newkey | awk -F: '/^fpr/{print $10; exit}')

# legit rotation doc signed by OLD key
python3 - "$SCRATCH" "$NEWFP" > "$SCRATCH/rotation.json" <<'PY'
import json, sys
s, fp = sys.argv[1], sys.argv[2]
newpub = open(f"{s}/newpub.asc").read()
print(json.dumps({"rotation": 1, "new_fingerprint": fp,
                  "effective": "2026-09-19", "reason": "test rotation",
                  "new_pubkey": newpub}, indent=2))
PY
GNUPGHOME="$SCRATCH/oldkey" gpg --batch --yes -u oldkey --detach-sign --armor \
    -o "$SCRATCH/rotation.json.asc" "$SCRATCH/rotation.json"

# forged doc signed by ATTACKER
GNUPGHOME="$SCRATCH/attacker" gpg --batch --yes -u attacker --detach-sign --armor \
    -o "$SCRATCH/forged.asc" "$SCRATCH/rotation.json"

# Run the shipped verify_rotation_doc against each doc
export GNUPGHOME="$SCRATCH/run"; mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"
PUBKEY_FILE="$SCRATCH/pubkey.asc" bash -c "
    source '$SCRATCH/die.sh'
    source '$SCRATCH/rot.sh'
    verify_rotation_doc '$SCRATCH/rotation.json' '$SCRATCH/rotation.json.asc'
"
rc=$?
if [ "$rc" -eq 0 ]; then
    ok "valid countersigned rotation verifies"
else
    bad "valid countersigned rotation verifies (rc=$rc)"
fi

PUBKEY_FILE="$SCRATCH/pubkey.asc" bash -c "
    source '$SCRATCH/die.sh'
    source '$SCRATCH/rot.sh'
    verify_rotation_doc '$SCRATCH/rotation.json' '$SCRATCH/forged.asc'
" 2>/dev/null
rc=$?
if [ "$rc" -eq 0 ]; then
    bad "forged (attacker-signed) rotation is REJECTED"
else
    ok "forged (attacker-signed) rotation is REJECTED"
fi

# End-to-end: a "server" dir serving keys/ over file://; process_key_rotation
# must install the new pubkey as the client trust root.
mkdir -p "$SCRATCH/server/keys" "$SCRATCH/client"
cp "$SCRATCH/rotation.json" "$SCRATCH/rotation.json.asc" "$SCRATCH/server/keys/"
cp "$SCRATCH/pubkey.asc" "$SCRATCH/client/pubkey.asc"

PUBKEY_FILE="$SCRATCH/client/pubkey.asc" TMPDIR="$SCRATCH/work" bash -c "
    mkdir -p '$SCRATCH/work'
    source '$SCRATCH/die.sh'
    source '$SCRATCH/rot.sh'
    process_key_rotation 'file://$SCRATCH/server' '$SCRATCH/work'
" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ] && cmp -s "$SCRATCH/newpub.asc" "$SCRATCH/client/pubkey.asc"; then
    ok "process_key_rotation installs the successor key"
else
    bad "process_key_rotation installs the successor key (rc=$rc)"
fi

# Forged doc on the server → abort, trust root untouched.
cp "$SCRATCH/forged.asc" "$SCRATCH/server/keys/rotation.json.asc"
cp "$SCRATCH/pubkey.asc" "$SCRATCH/client/pubkey.asc"   # reset to old key
( PUBKEY_FILE="$SCRATCH/client/pubkey.asc" bash -c "
    source '$SCRATCH/die.sh'
    source '$SCRATCH/rot.sh'
    process_key_rotation 'file://$SCRATCH/server' '$SCRATCH/work'
" ) >/dev/null 2>&1
rc=$?
if [ "$rc" -ne 0 ] && cmp -s "$SCRATCH/pubkey.asc" "$SCRATCH/client/pubkey.asc"; then
    ok "forged rotation aborts and leaves trust root intact"
else
    bad "forged rotation aborts and leaves trust root intact (rc=$rc)"
fi

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
