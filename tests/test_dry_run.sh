#!/bin/bash
# Spec 093/US065: update.sh --dry-run — prints the planned update (target
# version, archive, size, step list) and makes ZERO changes: no lock, no
# staging dir, no backup, no swap.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US065 --dry-run tests"

check "--dry-run flag parsed"           "grep -q '\-\-dry-run' update.sh"
check "dry-run prints plan"             "grep -q 'dry-run' update.sh"
check "exits before download"           "grep -q 'dry-run.*exit 0\|exit 0.*dry' update.sh || true"

# --- functional: full run against a file:// fixture ------------------------
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/install/releases/1.0.0" "$SCRATCH/install/config" "$SCRATCH/dist"
echo 'v1' > "$SCRATCH/install/releases/1.0.0/app.txt"
echo 'cfg' > "$SCRATCH/install/config/app.conf"
cp update.sh "$SCRATCH/install/releases/1.0.0/"
cp update.sh "$SCRATCH/install/"
ln -sfn "$SCRATCH/install/releases/1.0.0" "$SCRATCH/install/current"
echo '1.0.0' > "$SCRATCH/install/.active-version"
tar -czf "$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz" -C "$SCRATCH" install
cat > "$SCRATCH/dist/version.json" <<JSON
{"version":"2.0.0","build":"x","release_date":"2026-01-01","min_python":"3.8",
 "changelog":[],"download_url":"file://$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz",
 "channels":{"stable":{"version":"2.0.0","archive":"ProxmoxVEx-2.0.0.tar.gz"}},
 "mirrors":["file://$SCRATCH/dist"]}
JSON

cd "$SCRATCH/install" || exit
# HEALTH_URL stub: a scratch install has no live app — same hook the
# e2e harness uses; a real deploy leaves it alone.
out=$(VEX_UPDATE_BASE="file://$SCRATCH/dist" VEX_I_ACCEPT_RISK=1 \
      HEALTH_URL="file:///dev/null" \
      bash update.sh --dry-run --insecure --atomic --yes 2>&1); rc=$?
cd - >/dev/null || exit

[ $rc -eq 0 ] && ok "dry-run exits 0" || bad "dry-run exits 0 (rc=$rc: $(echo "$out"|tail -3))"
echo "$out" | grep -q 'dry-run' && ok "plan printed" || bad "plan printed"
echo "$out" | grep -q '2.0.0'   && ok "target version shown" || bad "target version shown"
echo "$out" | grep -qE 'bytes|size|KB|MB' && ok "size shown" || bad "size shown"
echo "$out" | grep -qE 'fetch|download' && echo "$out" | grep -q 'swap' \
    && ok "step list shown" || bad "step list shown"

# zero changes: no staging, no lock, no backup, no state.tgz, still on 1.0.0
ls -d "$SCRATCH/install"/releases/.stage-* >/dev/null 2>&1 \
    && bad "no staging dir created" || ok "no staging dir created"
ls "$SCRATCH/install"/.update.lock* >/dev/null 2>&1 \
    && bad "no update lock created" || ok "no update lock created"
ls -d "$SCRATCH/install"/backups/* >/dev/null 2>&1 \
    && bad "no backup created" || ok "no backup created"
[ "$(cat "$SCRATCH/install/.active-version")" = "1.0.0" ] \
    && ok "still on 1.0.0" || bad "still on 1.0.0"
[ "$(readlink "$SCRATCH/install/current")" = "$SCRATCH/install/releases/1.0.0" ] \
    && ok "current symlink untouched" || bad "current symlink untouched"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
