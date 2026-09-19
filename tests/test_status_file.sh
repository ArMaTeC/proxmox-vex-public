#!/bin/bash
# Spec 093/US097: machine-readable update-status.json — the app UI polls
# a structured {result,from,to,ts,pid} file the updater writes on every
# run outcome (ok / error), atomically.
set -u
cd "$(dirname "$0")/.." || exit 1

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US097 update-status tests"

check "write_status implemented"      "grep -q '^write_status()' update.sh"
check "atomic tmp+mv write"           "grep -A15 '^write_status()' update.sh | grep -q 'update-status.json.tmp' && grep -A15 '^write_status()' update.sh | grep -q 'mv '"
check "status written on failure"     "grep -A6 '^fail_record()' update.sh | grep -q 'write_status\|update-status' || grep -q 'write_status' update.sh"

# functional: success path writes {result:ok,from,to}
SCRATCH=$(mktemp -d); trap 'rm -rf "$SCRATCH"' EXIT
mkdir -p "$SCRATCH/install/releases/1.0.0" "$SCRATCH/install/config" "$SCRATCH/dist" "$SCRATCH/pkg/install"
echo 'v1' > "$SCRATCH/install/releases/1.0.0/app.txt"
cp update.sh "$SCRATCH/install/releases/1.0.0/"
ln -sfn "$SCRATCH/install/releases/1.0.0" "$SCRATCH/install/current"
echo '1.0.0' > "$SCRATCH/install/.active-version"
cp update.sh "$SCRATCH/install/"
echo 'v2' > "$SCRATCH/pkg/install/app.txt"
tar -czf "$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz" -C "$SCRATCH/pkg" install
cat > "$SCRATCH/dist/version.json" <<JSON
{"version":"2.0.0","build":"x","release_date":"2026-01-01","min_python":"3.8",
 "changelog":[],"download_url":"file://$SCRATCH/dist/ProxmoxVEx-2.0.0.tar.gz",
 "channels":{"stable":{"version":"2.0.0","archive":"ProxmoxVEx-2.0.0.tar.gz"}},
 "mirrors":["file://$SCRATCH/dist"]}
JSON

UPD_ENV="VEX_UPDATE_BASE=file://$SCRATCH/dist VEX_I_ACCEPT_RISK=1 HEALTH_URL=file:///dev/null HEALTH_TIMEOUT=5 VEX_SKIP_POST_VERIFY=1"
(cd "$SCRATCH/install" && eval "$UPD_ENV bash update.sh --atomic --insecure --yes" >/dev/null 2>&1)

SF="$SCRATCH/install/data/update-status.json"
check "status file exists"            "test -f '$SF'"
check "result ok"                     "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d[\"result\"]==\"ok\"' '$SF'"
check "from/to recorded"              "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d[\"from\"]==\"1.0.0\" and d[\"to\"]==\"2.0.0\"' '$SF'"
check "has ts + pid"                  "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d[\"ts\"] and d[\"pid\"]' '$SF'"

# functional: failure path writes result=error (missing archive forces die)
SCRATCH2="$SCRATCH/fail"
mkdir -p "$SCRATCH2/install/releases/1.0.0" "$SCRATCH2/install/config" "$SCRATCH2/dist"
echo 'v1' > "$SCRATCH2/install/releases/1.0.0/app.txt"
cp update.sh "$SCRATCH2/install/releases/1.0.0/"
ln -sfn "$SCRATCH2/install/releases/1.0.0" "$SCRATCH2/install/current"
echo '1.0.0' > "$SCRATCH2/install/.active-version"
cp update.sh "$SCRATCH2/install/"
# metadata references an archive that does not exist -> download fails -> die
cat > "$SCRATCH2/dist/version.json" <<JSON
{"version":"2.0.0","build":"x","release_date":"2026-01-01","min_python":"3.8",
 "changelog":[],"download_url":"file://$SCRATCH2/dist/missing.tar.gz",
 "channels":{"stable":{"version":"2.0.0","archive":"missing.tar.gz"}},
 "mirrors":["file://$SCRATCH2/dist"]}
JSON
(cd "$SCRATCH2/install" && eval "VEX_UPDATE_BASE=file://$SCRATCH2/dist VEX_I_ACCEPT_RISK=1 HEALTH_URL=file:///dev/null VEX_SKIP_POST_VERIFY=1 bash update.sh --atomic --insecure --yes" >/dev/null 2>&1) || true
check "error status written"          "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d[\"result\"]==\"error\"' '$SCRATCH2/install/data/update-status.json' 2>/dev/null"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
