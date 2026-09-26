#!/bin/bash
# Spec 093/US054: E2E update test harness — install old → update → health →
# rollback, in one command. Runs locally against file:// artifacts; --docker
# uses a clean container when docker is available.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US054 e2e-harness tests"

check "harness exists"                  "[ -f scripts/e2e-update-test.sh ]"
check "harness executable"              "[ -x scripts/e2e-update-test.sh ]"
check "installs old version"            "grep -qi 'install\|old' scripts/e2e-update-test.sh"
check "runs the update"                 "grep -q 'update.sh' scripts/e2e-update-test.sh"
check "health verified post-update"     "grep -q 'healthz\|HEALTH' scripts/e2e-update-test.sh"
check "rollback exercised"              "grep -q 'rollback' scripts/e2e-update-test.sh"
check "docker path optional"            "grep -q 'docker' scripts/e2e-update-test.sh"
check "base URL overridable"            "grep -q 'VEX_UPDATE_BASE\|--base' scripts/e2e-update-test.sh update.sh"

# --- functional: harness against file:// fixtures ---------------------------------------
SCRATCH=$(mktemp -d)

# build an "old" atomic install + a "new" release the updater can see
mkdir -p "$SCRATCH/install/releases/1.0.0" "$SCRATCH/install/config" "$SCRATCH/dist"
echo 'v1' > "$SCRATCH/install/releases/1.0.0/app.txt"
echo 'cfg' > "$SCRATCH/install/config/app.conf"   # US063: installs carry state to snapshot
cp update.sh "$SCRATCH/install/releases/1.0.0/"
ln -sfn "$SCRATCH/install/releases/1.0.0" "$SCRATCH/install/current"
echo '1.0.0' > "$SCRATCH/install/.active-version"
cp update.sh "$SCRATCH/install/"
tar -czf "$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz" -C "$SCRATCH" install
# new version.json pointing at our archive
cat > "$SCRATCH/dist/version.json" <<JSON
{"version":"2.0.0","build":"x","release_date":"2026-01-01","min_python":"3.8",
 "changelog":[],"download_url":"file://$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz",
 "channels":{"stable":{"version":"2.0.0","archive":"ProxmoxVEx-2.0.0.tar.gz"}},
 "mirrors":["file://$SCRATCH/dist"]}
JSON

out=$(VEX_UPDATE_BASE="file://$SCRATCH/dist" bash scripts/e2e-update-test.sh \
      --workdir "$SCRATCH/install" 2>&1); rc=$?

[ $rc -eq 0 ] && ok "harness passes on good release" || bad "harness passes on good release (rc=$rc: $(echo "$out"|tail -2))"
echo "$out" | grep -qi 'update' && ok "reports update stage" || bad "reports update stage"
echo "$out" | grep -qi 'rollback\|E2E' && ok "reports rollback/e2e" || bad "reports rollback/e2e"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
