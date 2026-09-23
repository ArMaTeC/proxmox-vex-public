#!/bin/bash
# Spec 093/US070: user-defined post-update hooks — executable scripts in
# hooks.d/ run after the swap with (old,new) version args; a failing hook
# warns but never aborts the update; non-executables are skipped.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US070 post-update hooks tests"

check "hooks runner exists"             "grep -q 'run_post_hooks()' update.sh"
check "hooks.d consulted"               "grep -q 'hooks.d' update.sh"
check "executable bit required"         "grep -q '\-x \"\$h\"\|\[ -x' update.sh"
check "hook failure warns not aborts"   "grep -q 'hook.*failed\|WARN.*hook' update.sh"
check "wired post-swap"                 "grep -q 'run_post_hooks$' update.sh"

# --- functional ---------------------------------------------------------
SCRATCH=$(mktemp -d)
printf 'die() { echo "die: $*" >&2; exit 1; }\n' > "$SCRATCH/fn.sh"
awk '/^run_post_hooks\(\)/,/^}/; /^log_update\(\)/,/^}/' update.sh >> "$SCRATCH/fn.sh"

BASE="$SCRATCH/app"; mkdir -p "$BASE/hooks.d"
cat > "$BASE/hooks.d/10-record.sh" <<'H'
#!/bin/bash
echo "hook args: $1 -> $2" > "$(dirname "$0")/../hook-ran.txt"
echo "hook output line"
H
cat > "$BASE/hooks.d/20-fail.sh" <<'H'
#!/bin/bash
exit 3
H
echo "not executable" > "$BASE/hooks.d/30-skip.sh"
chmod +x "$BASE/hooks.d/10-record.sh" "$BASE/hooks.d/20-fail.sh"

out=$(BASE_DIR="$BASE" CURRENT_VERSION=1.0.0 LATEST_VERSION=2.0.0 \
      bash -c "source '$SCRATCH/fn.sh'; run_post_hooks" 2>&1); rc=$?

[ -f "$BASE/hook-ran.txt" ] && ok "hook executed" || bad "hook executed"
grep -q '1.0.0 -> 2.0.0' "$BASE/hook-ran.txt" 2>/dev/null \
    && ok "version args passed" || bad "version args passed"
[ $rc -eq 0 ] && ok "failing hook did not abort" || bad "failing hook did not abort (rc=$rc)"
echo "$out" | grep -qi 'warn\|failed' && ok "failure warned" || bad "failure warned"
{ grep -q 'hook output line' "$BASE/shared/logs/update.log" 2>/dev/null \
  || grep -q 'hook output line' "$BASE/logs/update.log" 2>/dev/null; } \
    && ok "hook output captured to update.log" || bad "hook output captured"

BASE2="$SCRATCH/app2"; mkdir -p "$BASE2"
BASE_DIR="$BASE2" bash -c "source '$SCRATCH/fn.sh'; run_post_hooks" >/dev/null 2>&1; rc=$?
[ $rc -eq 0 ] && ok "absent hooks.d is a no-op" || bad "absent hooks.d no-op (rc=$rc)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
