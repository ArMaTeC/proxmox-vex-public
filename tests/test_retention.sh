#!/bin/bash
# Spec 093/US057: retention policy — keep last N stable + all LTS + the
# current/previous rollback targets; everything else pruned. Dry-run by
# default, --apply deletes.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US057 retention tests"

check "prune script exists"             "[ -f scripts/prune-releases.sh ]"
check "script executable"               "[ -x scripts/prune-releases.sh ]"
check "dry-run by default"              "grep -q 'apply\|dry' scripts/prune-releases.sh"
check "keep-N configurable"             "grep -q 'KEEP_STABLE\|KEEP=' scripts/prune-releases.sh"
check "lts always kept"                 "grep -qi 'lts' scripts/prune-releases.sh"
check "rollback targets kept"           "grep -q 'previous\|current' scripts/prune-releases.sh"
check "documented"                      "grep -qi 'retention' docs/channels.md README.md 2>/dev/null"

# --- functional: 12 stables + 1 lts + rollback pair --------------------------------------
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/releases"
for v in 1.0.{1..12}; do mkdir -p "$SCRATCH/releases/$v"; done
mkdir -p "$SCRATCH/releases/1.0.0-lts"
# rollback pair must survive regardless of rank
echo '1.0.3' > "$SCRATCH/.active-version"
echo '1.0.2' > "$SCRATCH/.previous-version"

# dry-run: reports prunes but removes nothing
out=$(KEEP_STABLE=10 bash scripts/prune-releases.sh --root "$SCRATCH" 2>&1)
echo "$out" | grep -q '1.0.1' && ok "dry-run names oldest prune" || bad "dry-run names oldest prune (got: $(echo "$out"|tail -2))"
[ -d "$SCRATCH/releases/1.0.1" ] && ok "dry-run removes nothing" || bad "dry-run removes nothing"

# apply: prunes to policy
KEEP_STABLE=10 bash scripts/prune-releases.sh --root "$SCRATCH" --apply >/dev/null 2>&1
[ ! -d "$SCRATCH/releases/1.0.1" ] && ok "oldest pruned" || bad "oldest pruned"
[ -d "$SCRATCH/releases/1.0.12" ] && ok "newest kept" || bad "newest kept"
[ -d "$SCRATCH/releases/1.0.0-lts" ] && ok "lts kept regardless of rank" || bad "lts kept regardless of rank"
[ -d "$SCRATCH/releases/1.0.3" ] && ok "current kept" || bad "current kept"
[ -d "$SCRATCH/releases/1.0.2" ] && ok "previous kept" || bad "previous kept"
COUNT=$(ls "$SCRATCH/releases" | wc -l)
[ "$COUNT" -le 12 ] && ok "bounded set remains ($COUNT)" || bad "bounded set remains ($COUNT)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
