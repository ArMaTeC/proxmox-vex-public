#!/bin/bash
# Spec 093/US020: airgap bundle — a single .vexbundle carries archive+sig+
# metadata+verifier; update.sh --bundle applies it with the full verify path.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US020 airgap-bundle tests"

check "bundle flag parsed"              "grep -q -- '--bundle' update.sh"
check "bundle extracted before use"     "grep -q 'vexbundle\|BUNDLE' update.sh"
check "verified before apply"           "grep -q 'verify-release' update.sh"
check "file:// pipeline (offline)"      "grep -q 'file://' update.sh"
check "bundle build in build-release"   "grep -q 'vexbundle' scripts/build-release.sh"
check "bundle carries verifier"         "grep -q 'verify-release' scripts/build-release.sh"
check "bundle carries signature"        "grep -q 'asc\|\.sig' scripts/build-release.sh"

# --- functional: build a bundle, apply it ----------------------------------------
SCRATCH=$(mktemp -d)
awk '/^apply_bundle\(\)/,/^}/' update.sh > "$SCRATCH/ab.sh"
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh"

# fake bundle: tarball + checksums + version.json + verify-release.sh
mkdir -p "$SCRATCH/rel" && echo fakeapp > "$SCRATCH/rel/app.txt"
(cd "$SCRATCH/rel" && tar -czf "$SCRATCH/parts/ProxmoxVEx-9.9.9.tar.gz" . 2>/dev/null) || {
    mkdir -p "$SCRATCH/parts"; (cd "$SCRATCH/rel" && tar -czf "$SCRATCH/parts/ProxmoxVEx-9.9.9.tar.gz" .)
}
(cd "$SCRATCH/parts" && sha256sum ProxmoxVEx-9.9.9.tar.gz > checksums.txt)
echo '{"version":"9.9.9"}' > "$SCRATCH/parts/version.json"
cp verify-release.sh "$SCRATCH/parts/"
(cd "$SCRATCH/parts" && tar -czf "$SCRATCH/test.vexbundle" .)

out=$(bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/ab.sh'
    apply_bundle '$SCRATCH/test.vexbundle' '$SCRATCH/out'
    echo \"ARCHIVE=\$ARCHIVE VER=\$LATEST_VERSION DIR=\$BUNDLE_DIR\"
" 2>&1); rc=$?
[ $rc -eq 0 ] && ok "bundle applies (rc 0)" || bad "bundle applies (rc=$rc: $out)"
echo "$out" | grep -q 'VER=9.9.9' && ok "version read from bundle metadata" || bad "version read (got $out)"
echo "$out" | grep -q 'ARCHIVE=.*9.9.9.tar.gz' && ok "archive resolved from bundle" || bad "archive resolved (got $out)"

# tampered bundle → verify fails
mkdir -p "$SCRATCH/bad" && tar -xzf "$SCRATCH/test.vexbundle" -C "$SCRATCH/bad"
echo tampered >> "$SCRATCH/bad/ProxmoxVEx-9.9.9.tar.gz"
(cd "$SCRATCH/bad" && tar -czf "$SCRATCH/tampered.vexbundle" .)
bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/ab.sh'
    apply_bundle '$SCRATCH/tampered.vexbundle' '$SCRATCH/out2'
" >/dev/null 2>&1
[ $? -ne 0 ] && ok "tampered bundle rejected" || bad "tampered bundle rejected"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
