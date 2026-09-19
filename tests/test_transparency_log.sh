#!/bin/bash
# Spec 093/US007: append-only release transparency log — every release
# appends {version,sha256,ts}; the log is detached-signed; update.sh
# warns (not blocks) when an artifact diverges from the log.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US007 transparency-log tests"

check "transparency.log exists"                    "test -f transparency.log"
check "transparency.log is signed (.asc)"          "test -f transparency.log.asc"
check "build-release.sh appends log entry"         "grep -q 'transparency.log' scripts/build-release.sh"
check "sign-release.sh signs the log"              "grep -q 'transparency.log' scripts/sign-release.sh"
check "update.sh checks artifact against log"      "grep -q 'transparency.log' update.sh"
check "divergence warns not aborts"                "grep -qi 'transparency.*warn\|warn.*transparency' update.sh"
check "log entries carry version+sha256+ts"        "grep -q '\"sha256\"' transparency.log && grep -q '\"version\"' transparency.log"

# --- functional: append + verify semantics on a scratch log --------------------
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/kr"; chmod 700 "$SCRATCH/kr"
GNUPGHOME="$SCRATCH/kr" gpg --batch --gen-key >/dev/null 2>&1 <<EOF
Key-Type: eddsa
Key-Curve: ed25519
Name-Real: tlog
Expire-Date: 0
%no-protection
%commit
EOF
GNUPGHOME="$SCRATCH/kr" gpg --batch --export -a tlog > "$SCRATCH/pubkey.asc"

# shipped log must be valid JSONL with plausible hashes
python3 - <<PY
import json, sys
ok = True
for i, line in enumerate(open("transparency.log")):
    line = line.strip()
    if not line:
        continue
    try:
        e = json.loads(line)
        ok &= len(e.get("sha256","")) == 64 and bool(e.get("version"))
    except Exception:
        ok = False
sys.exit(0 if ok else 1)
PY
check "shipped log is valid JSONL" "[ \$? -eq 0 ]"

# extract the shipped checker function and run it on scratch cases
awk '/^check_transparency\(\)/,/^}/' update.sh > "$SCRATCH/chk.sh"
grep -A2 '^warn\|^die()' update.sh > "$SCRATCH/die.sh" || true

# artifact hash present in log → ok; absent → warn+nonzero advisory rc
H=$(sha256sum dist/ProxmoxVEx-latest.tar.gz | awk '{print $1}')
cp transparency.log "$SCRATCH/log"

PUBKEY_FILE="$SCRATCH/pubkey.asc" bash -c "
    source '$SCRATCH/chk.sh'
    check_transparency '$SCRATCH/log' '$H'
" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 0 ] && ok "artifact present in log → accepted" \
                || bad "artifact present in log → accepted (rc=$rc)"

PUBKEY_FILE="$SCRATCH/pubkey.asc" bash -c "
    source '$SCRATCH/chk.sh'
    check_transparency '$SCRATCH/log' 'deadbeef0000000000000000000000000000000000000000000000000000cafe'
" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && ok "unknown hash → advisory failure (warn path)" \
                || bad "unknown hash → advisory failure (warn path)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
