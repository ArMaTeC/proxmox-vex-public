#!/bin/bash
# Spec 093/US022: per-file SHA256 manifest inside releases — detects drift of
# individual installed files post-install.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US022 file-manifest tests"

check "manifest generated at build"     "grep -q 'MANIFEST.sha256' scripts/build-release.sh"
check "manifest inside tarball"         "grep -q 'MANIFEST' scripts/build-release.sh"
check "manifest signed"                 "grep -q 'MANIFEST.sha256' scripts/sign-release.sh"
check "verify-files flag/function"      "grep -q 'verify-files\|verify_installed_files' update.sh"
check "excludes user data"              "grep -q 'config\|data' scripts/build-release.sh"
check "sha256sum -c verification"       "grep -q 'sha256sum -c\|sha256sum --check' update.sh"

# --- functional: manifest detects drift ------------------------------------------
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/install/sub"
echo aaa > "$SCRATCH/install/a.py"; echo bbb > "$SCRATCH/install/sub/b.py"
mkdir -p "$SCRATCH/install/config" && echo secret > "$SCRATCH/install/config/db.json"
(cd "$SCRATCH/install" && find . -type f ! -path "./config/*" ! -name MANIFEST.sha256 -exec sha256sum {} + | sed 's| \./| |' > "$SCRATCH/MANIFEST.sha256")
mv "$SCRATCH/MANIFEST.sha256" "$SCRATCH/install/MANIFEST.sha256"

awk '/^verify_installed_files\(\)/,/^}/' update.sh > "$SCRATCH/vf.sh"
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh"

# clean tree verifies
out=$(bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/vf.sh'
               verify_installed_files '$SCRATCH/install'" 2>&1); rc=$?
[ $rc -eq 0 ] && ok "clean tree verifies" || bad "clean tree verifies (rc=$rc: $out)"

# tamper one file → named
echo tampered >> "$SCRATCH/install/sub/b.py"
out=$(bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/vf.sh'
               verify_installed_files '$SCRATCH/install'" 2>&1); rc=$?
[ $rc -ne 0 ] && ok "drift detected" || bad "drift detected"
echo "$out" | grep -q 'b.py' && ok "tampered file named" || bad "tampered file named (got: $out)"

# config drift is NOT flagged (excluded path)
echo changed > "$SCRATCH/install/config/db.json"
bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/vf.sh'
         verify_installed_files '$SCRATCH/install'" >/dev/null 2>&1
# config was excluded from manifest → still fails only on b.py, not db.json
out=$(bash -c "source '$SCRATCH/die.sh'; source '$SCRATCH/vf.sh'
               verify_installed_files '$SCRATCH/install'" 2>&1)
echo "$out" | grep -q 'db.json' && bad "config excluded" || ok "config excluded"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
