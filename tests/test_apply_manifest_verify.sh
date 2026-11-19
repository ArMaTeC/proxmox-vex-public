#!/bin/bash
# Roadmap ID-0177: the apply path must verify installed files against
# the release manifest automatically — not only via opt-in
# --verify-files. A tampered/corrupt stage must fail BEFORE the swap,
# and a drifted in-place apply restores the backup.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "ID-0177 apply-path manifest verification tests"

# --- source-level: both apply paths call the verifier --------------------
check "atomic apply verifies stage"  \
    "grep -q 'verify_installed_files \"\$BASE_DIR/releases/\$version\"' update.sh"
check "classic apply verifies tree"  \
    "grep -q 'verify_installed_files \"\$SCRIPT_DIR\"' update.sh"
check "drift kills the swap"         \
    "grep -q 'fails manifest verification' update.sh"

# --- functional: stage→verify→swap on a scratch BASE_DIR -------------------
SCRATCH=$(mktemp -d); trap 'rm -rf "$SCRATCH"' EXIT
awk '/^verify_installed_files\(\)/,/^}/;
     /^atomic_stage\(\)/,/^}/; /^wire_shared_state\(\)/,/^}/;
     /^atomic_swap\(\)/,/^}/; /^check_disk_space\(\)/,/^}/;
     /^log_update\(\)/,/^}/; /^untar_release\(\)/,/^}/;
     /^atomic_update\(\)/,/^}/' update.sh > "$SCRATCH/fns.sh"
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh"

BASE="$SCRATCH/app"
mkdir -p "$BASE"/{releases,shared/{config,data,logs,plugins}}
mkdir -p "$BASE/releases/1.0.0"
echo old > "$BASE/releases/1.0.0/app.py"
ln -sfn "$BASE/releases/1.0.0" "$BASE/current"
echo "1.0.0" > "$BASE/.active-version"

# good archive: files + matching MANIFEST.sha256
mkdir -p "$SCRATCH/pkg"
echo "new-app" > "$SCRATCH/pkg/app.py"
echo "extra" > "$SCRATCH/pkg/extra.py"
(cd "$SCRATCH/pkg" && sha256sum app.py extra.py > MANIFEST.sha256)
tar -czf "$SCRATCH/good.tar.gz" -C "$SCRATCH/pkg" .

BASE_DIR="$BASE" bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/fns.sh'
    atomic_update '$SCRATCH/good.tar.gz' '2.0.0'
" >/dev/null 2>&1
check "matching manifest: update completes" "[ $? -eq 0 ]"
check "matching manifest: swapped to 2.0.0" \
    "[ \"\$(readlink '$BASE/current')\" = '$BASE/releases/2.0.0' ]"

# tampered archive: manifest lists app.py but the shipped bytes differ
mkdir -p "$SCRATCH/evil"
echo "REAL" > "$SCRATCH/evil/app.py"
(cd "$SCRATCH/evil" && echo "deadbeefdeadbeef  app.py" > MANIFEST.sha256)
tar -czf "$SCRATCH/evil.tar.gz" -C "$SCRATCH/evil" .

BASE_DIR="$BASE" bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/fns.sh'
    atomic_update '$SCRATCH/evil.tar.gz' '3.0.0'
" >/dev/null 2>&1
check "tampered member: update FAILS"      "[ $? -ne 0 ]"
check "tampered member: stage removed"     "[ ! -d '$BASE/releases/3.0.0' ]"
check "tampered member: still on 2.0.0"    \
    "[ \"\$(readlink '$BASE/current')\" = '$BASE/releases/2.0.0' ]"
check "tampered member: nothing activated" \
    "grep -q 'new-app' '$BASE/current/app.py'"

# legacy archive without a manifest still applies (predates manifests)
mkdir -p "$SCRATCH/oldpkg" && echo "legacy" > "$SCRATCH/oldpkg/app.py"
tar -czf "$SCRATCH/legacy.tar.gz" -C "$SCRATCH/oldpkg" .
BASE_DIR="$BASE" bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/fns.sh'
    atomic_update '$SCRATCH/legacy.tar.gz' '3.0.0'
" >/dev/null 2>&1
check "no manifest (legacy): update completes" "[ $? -eq 0 ]"
check "legacy swap happened" \
    "[ \"\$(readlink '$BASE/current')\" = '$BASE/releases/3.0.0' ]"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
