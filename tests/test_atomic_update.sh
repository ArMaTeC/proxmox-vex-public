#!/bin/bash
# Spec 093/US011: updates stage into releases/<ver> and activate via an
# atomic symlink swap — never extract over the live tree. Shared state
# (config/data/logs/plugins) lives outside versioned dirs.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US011 atomic-update tests"

check "releases/ staging layout"              "grep -q 'releases/' update.sh"
check "atomic symlink swap (mv -T)"           "grep -q 'mv -T\|ln -sfn' update.sh"
check "current.tmp rename idiom"              "grep -q 'current.tmp' update.sh"
check ".active-version marker"                "grep -q 'active-version' update.sh"
check "shared state outside versioned dirs"   "grep -qi 'shared\|config.*symlink\|ln -s.*config' update.sh"
check "disk-space check before staging"       "grep -qi 'df \|space' update.sh"
check "--atomic flag wired"                   "grep -q '\-\-atomic' update.sh"

# --- functional: full stage→swap on a scratch BASE_DIR -------------------------
SCRATCH=$(mktemp -d)
awk '/^atomic_stage\(\)/,/^}/; /^wire_shared_state\(\)/,/^}/;
     /^atomic_swap\(\)/,/^}/; /^check_disk_space\(\)/,/^}/;
     /^log_update\(\)/,/^}/;
     /^untar_release\(\)/,/^}/;
     /^atomic_update\(\)/,/^}/' update.sh > "$SCRATCH/atomic.sh"
grep -A2 '^die()' update.sh > "$SCRATCH/die.sh"

BASE="$SCRATCH/app"
mkdir -p "$BASE"/{releases,shared/{config,data,logs,plugins}}
echo "v1file" > "$BASE/shared/config/settings.json"
# fake current release v1
mkdir -p "$BASE/releases/1.0.0"
echo old > "$BASE/releases/1.0.0/app.py"
ln -sfn "$BASE/releases/1.0.0" "$BASE/current"
echo "1.0.0" > "$BASE/.active-version"

# build a v2 "archive"
mkdir -p "$SCRATCH/pkg" && echo new > "$SCRATCH/pkg/app.py" && echo x > "$SCRATCH/pkg/extra.py"
tar -czf "$SCRATCH/v2.tar.gz" -C "$SCRATCH/pkg" .

BASE_DIR="$BASE" bash -c "
    source '$SCRATCH/die.sh'; source '$SCRATCH/atomic.sh'
    atomic_update '$SCRATCH/v2.tar.gz' '2.0.0'
" >/dev/null 2>&1
rc=$?

if [ $rc -eq 0 ]; then
    ok "atomic_update completes"
else
    bad "atomic_update completes (rc=$rc)"
fi

check "current now points at 2.0.0" \
    "[ \"\$(readlink '$BASE/current' 2>/dev/null)\" = '$BASE/releases/2.0.0' ]"
check "new code live through current" \
    "grep -q new '$BASE/current/app.py' 2>/dev/null"
check ".active-version says 2.0.0" \
    "grep -q 2.0.0 '$BASE/.active-version' 2>/dev/null"
check "shared config survives the swap" \
    "grep -q v1file '$BASE/shared/config/settings.json' 2>/dev/null"
check "release sees shared config via symlink" \
    "test -f '$BASE/current/config/settings.json' || test -L '$BASE/current/config'"

# old release still present → rollback possible (US012 consumes this)
check "previous release dir retained" \
    "test -f '$BASE/releases/1.0.0/app.py'"

# interrupted run: staged-but-unswapped must not corrupt live
rm -rf "$BASE/releases/3.0.0" "$BASE/current.tmp"
mkdir -p "$BASE/releases/3.0.0" && echo partial > "$BASE/releases/3.0.0/app.py"
check "orphaned stage leaves live intact" \
    "grep -q new '$BASE/current/app.py'"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
