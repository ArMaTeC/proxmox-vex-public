#!/bin/bash
# Spec 093/US059: publish --dry-run — lists the planned uploads/swaps and
# makes ZERO changes (no ssh, no rsync, no symlink writes).
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US059 publish-dryrun tests"

check "--dry-run flag"                  "grep -q 'dry-run\|DRY' scripts/publish.sh"
check "plan function"                   "grep -q 'plan()' scripts/publish.sh"
check "dry-run exits before mutate"     "grep -q 'dry-run complete\|DRY.*exit' scripts/publish.sh"

# --- functional: dry-run produces a plan, no side effects -------------------------------
SCRATCH=$(mktemp -d)
# sandbox ssh/rsync/scp so ANY attempted contact would be loud
mkdir -p "$SCRATCH/bin"
for c in ssh rsync scp; do
    printf '#!/bin/sh\necho "SIDE-EFFECT: %s called" >&2; exit 99\n' "$c" > "$SCRATCH/bin/$c"
    chmod +x "$SCRATCH/bin/$c"
done

out=$(PATH="$SCRATCH/bin:$PATH" PUBLISH_HOST=host bash scripts/publish.sh \
      --dry-run 2>&1); rc=$?

[ $rc -eq 0 ] && ok "dry-run exits 0" || bad "dry-run exits 0 (rc=$rc: $(echo "$out"|tail -2))"
echo "$out" | grep -q 'SIDE-EFFECT' && bad "no remote calls made" || ok "no remote calls made"
echo "$out" | grep -qi 'dry-run\|plan' && ok "prints plan" || bad "prints plan (got: $(echo "$out"|tail -2))"
echo "$out" | grep -qi 'upload\|tar.gz\|rsync' && ok "plan lists uploads" || bad "plan lists uploads"
echo "$out" | grep -qi 'swap\|current\|version.json' && ok "plan lists swap/metadata" || bad "plan lists swap/metadata"

# local docroot mode also no-ops
out=$(bash scripts/publish.sh --dry-run --local "$SCRATCH/root" 2>&1); rc=$?
[ ! -d "$SCRATCH/root/releases" ] 2>/dev/null || [ -z "$(ls -A "$SCRATCH/root" 2>/dev/null)" ] \
    && ok "no docroot writes" || bad "no docroot writes"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
