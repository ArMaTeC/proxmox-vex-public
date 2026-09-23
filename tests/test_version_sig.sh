#!/bin/bash
# Spec 093/US005: version.json ships a detached signature over canonical
# (sorted-key) JSON; update.sh verifies it before trusting the contents.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US005 signed version.json tests"

check "version.json.asc published"              "test -f version.json.asc"
check "update.sh fetches version.json.asc"      "grep -q 'version.json.asc' update.sh"
check "metadata signature verified"             "grep -q 'verify_version_metadata\|verify_metadata' update.sh"
check "bad metadata signature aborts"           "grep -qi 'untrusted version metadata\|version.*signature.*fail' update.sh"
check "canonical sorted-key signing"            "grep -q 'sort_keys\|canonical' update.sh scripts/sign-version.sh 2>/dev/null"
check "scripts/sign-version.sh exists"          "test -x scripts/sign-version.sh"

# --- functional: real verify path over canonicalization ------------------------
SCRATCH=$(mktemp -d)
awk '/^resolve_pubkey\(\)/,/^}/; /^canonical_json\(\)/,/^}/; /^verify_version_metadata\(\)/,/^}/' \
    update.sh > "$SCRATCH/meta.sh"
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh"

mkdir -p "$SCRATCH/kr"; chmod 700 "$SCRATCH/kr"
GNUPGHOME="$SCRATCH/kr" gpg --batch --gen-key >/dev/null 2>&1 <<EOF
Key-Type: eddsa
Key-Curve: ed25519
Name-Real: vtest
Expire-Date: 0
%no-protection
%commit
EOF
GNUPGHOME="$SCRATCH/kr" gpg --batch --export -a vtest > "$SCRATCH/pubkey.asc"

# sign the SHIPPED version.json canonically (mimics scripts/sign-version.sh)
python3 -c "
import json
d = json.load(open('version.json'))
open('$SCRATCH/version.canonical','w').write(
    json.dumps(d, sort_keys=True, separators=(',',':')) + '\n')
"
GNUPGHOME="$SCRATCH/kr" gpg --batch --yes -u vtest --detach-sign --armor \
    -o "$SCRATCH/version.json.asc" "$SCRATCH/version.canonical"

# verifier must accept the shipped file (whose formatting may differ from
# the canonical bytes that were signed)
PUBKEY_FILE="$SCRATCH/pubkey.asc" bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/meta.sh'
    verify_version_metadata 'version.json' '$SCRATCH/version.json.asc'
" 2>/dev/null
rc=$?
[ "$rc" -eq 0 ] && ok "shipped version.json verifies via canonical sig" \
                || bad "shipped version.json verifies via canonical sig (rc=$rc)"

# tampered content (bump the version field) must fail
python3 -c "
import json
d = json.load(open('version.json')); d['version'] = '9.9.9'
json.dump(d, open('$SCRATCH/tampered.json','w'), indent=2)
"
PUBKEY_FILE="$SCRATCH/pubkey.asc" bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/meta.sh'
    verify_version_metadata '$SCRATCH/tampered.json' '$SCRATCH/version.json.asc'
" 2>/dev/null
rc=$?
[ "$rc" -ne 0 ] && ok "tampered version.json rejected" \
                || bad "tampered version.json rejected"

# whitespace-only reformat of the same data still verifies (canonical form)
python3 -c "
import json
d = json.load(open('version.json'))
open('$SCRATCH/reformat.json','w').write(json.dumps(d, sort_keys=True))
"
PUBKEY_FILE="$SCRATCH/pubkey.asc" bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/meta.sh'
    verify_version_metadata '$SCRATCH/reformat.json' '$SCRATCH/version.json.asc'
" 2>/dev/null
rc=$?
[ "$rc" -eq 0 ] && ok "reformatted (same-data) metadata verifies" \
                || bad "reformatted (same-data) metadata verifies (rc=$rc)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
