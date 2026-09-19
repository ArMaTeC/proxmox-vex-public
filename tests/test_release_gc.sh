#!/bin/bash
# Spec 093/US069: garbage-collect releases/ — keep the RELEASES_KEEP newest
# (default 3) plus always the active + previous (rollback) release; the
# rest are pruned and logged. Stage dirs and non-release files untouched.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US069 release-GC tests"

check "gc function exists"              "grep -q 'gc_releases()' update.sh"
check "RELEASES_KEEP configurable"      "grep -q 'RELEASES_KEEP' update.sh"
check "previous release preserved"      "grep -q 'previous-version' update.sh"
check "prune logged"                    "grep -q 'pruned old release' update.sh"
check "wired into update flow"          "grep -q 'gc_releases$' update.sh"

# --- functional: scratch layout, 6 releases, keep=3 -------------------------
SCRATCH=$(mktemp -d)
printf 'die() { echo "die: $*" >&2; exit 1; }\n' > "$SCRATCH/fn.sh"
awk '/^gc_releases\(\)/,/^}/; /^log_update\(\)/,/^}/' update.sh >> "$SCRATCH/fn.sh"

BASE="$SCRATCH/app"
mkdir -p "$BASE/releases"
for v in 1.0.0 1.1.0 1.2.0 1.3.0 1.4.0 2.0.0; do
    mkdir -p "$BASE/releases/$v"
    sleep 0.05
done
mkdir -p "$BASE/releases/.stage-partial"
ln -sfn "$BASE/releases/2.0.0" "$BASE/current"
echo "2.0.0" > "$BASE/.active-version"
echo "1.4.0" > "$BASE/.previous-version"

BASE_DIR="$BASE" bash -c "source '$SCRATCH/fn.sh'; gc_releases" >/dev/null 2>&1

[ -d "$BASE/releases/2.0.0" ] && ok "current kept" || bad "current kept"
[ -d "$BASE/releases/1.4.0" ] && ok "rollback target kept" || bad "rollback target kept"
[ -d "$BASE/releases/.stage-partial" ] && ok "stage dir untouched" || bad "stage dir untouched"

n=$(ls -1d "$BASE"/releases/*/ 2>/dev/null | wc -l)
[ "$n" -le 5 ] && ok "kept <= keep+2 ($n)" || bad "kept <= keep+2 ($n)"
[ ! -d "$BASE/releases/1.0.0" ] && ok "oldest pruned" || bad "oldest pruned"

grep -q 'pruned old release' "$BASE/shared/logs/update.log" 2>/dev/null \
    && ok "prune logged to update.log" || bad "prune logged"

# keep=2 → tighter retention
BASE2="$SCRATCH/app2"; mkdir -p "$BASE2/releases"
for v in 1.0.0 1.1.0 1.2.0 2.0.0; do mkdir -p "$BASE2/releases/$v"; sleep 0.05; done
echo "2.0.0" > "$BASE2/.active-version"
RELEASES_KEEP=2 BASE_DIR="$BASE2" bash -c "source '$SCRATCH/fn.sh'; gc_releases" >/dev/null 2>&1
n2=$(ls -1d "$BASE2"/releases/*/ 2>/dev/null | wc -l)
[ "$n2" -le 3 ] && ok "RELEASES_KEEP=2 honored ($n2)" || bad "RELEASES_KEEP=2 honored ($n2)"
[ -d "$BASE2/releases/2.0.0" ] && ok "current always kept" || bad "current always kept"

# empty releases dir → no crash
mkdir -p "$SCRATCH/app3/releases"
BASE_DIR="$SCRATCH/app3" bash -c "source '$SCRATCH/fn.sh'; gc_releases" >/dev/null 2>&1; rc=$?
[ $rc -eq 0 ] && ok "empty releases dir safe" || bad "empty releases dir safe (rc=$rc)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
