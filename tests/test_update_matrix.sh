#!/bin/bash
# Spec 093/US055: version-to-version matrix — CI runs update from each of
# the last N supported versions to the new release; failures name the
# source version.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US055 update-matrix tests"

check "--from flag supported"           "grep -q '\--from' scripts/e2e-update-test.sh"
check "matrix workflow exists"          "[ -f .github/workflows/matrix.yml ]"
check "matrix lists source versions"    "grep -q 'matrix' .github/workflows/matrix.yml"
check "matrix runs the harness"         "grep -q 'e2e-update-test' .github/workflows/matrix.yml"
check "failures name source version"    "grep -q 'from.*version\|{{ matrix' .github/workflows/matrix.yml"
check "matrix derives recent versions"  "grep -qi 'tags\|supported\|versions' .github/workflows/matrix.yml"

# --- functional: harness --from seeds that exact baseline --------------------------------
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/dist"
# release 2.0.0 fixture
mkdir -p "$SCRATCH/tree" && echo 'v2' > "$SCRATCH/tree/app.txt"
cp update.sh "$SCRATCH/tree/"
tar -czf "$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz" -C "$SCRATCH" tree
cat > "$SCRATCH/dist/version.json" <<JSON
{"version":"2.0.0","build":"x","release_date":"2026-01-01","min_python":"3.8",
 "changelog":[],"download_url":"file://$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz",
 "channels":{"stable":{"version":"2.0.0","archive":"ProxmoxVEx-2.0.0.tar.gz"}},
 "mirrors":["file://$SCRATCH/dist"]}
JSON

out=$(VEX_UPDATE_BASE="file://$SCRATCH/dist" bash scripts/e2e-update-test.sh \
      --from 1.1.48 --workdir "$SCRATCH/install" 2>&1); rc=$?

[ $rc -eq 0 ] && ok "update from 1.1.48 passes" || bad "update from 1.1.48 passes (rc=$rc: $(echo "$out"|tail -2))"
# the harness ends on a successful rollback — the baseline must be live again
[ -f "$SCRATCH/install/.active-version" ] && \
    grep -q '1.1.48' "$SCRATCH/install/.active-version" \
    && ok "rollback restored baseline" || bad "rollback restored baseline"
grep -q '2.0.0' "$SCRATCH/install/.previous-version" 2>/dev/null \
    && ok "target was live before rollback" || bad "target was live before rollback"

# a second baseline also works (matrix cell independence)
out=$(VEX_UPDATE_BASE="file://$SCRATCH/dist" bash scripts/e2e-update-test.sh \
      --from 1.2.300 --workdir "$SCRATCH/install2" 2>&1)
[ $? -eq 0 ] && ok "update from 1.2.300 passes" || bad "update from 1.2.300 passes"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
