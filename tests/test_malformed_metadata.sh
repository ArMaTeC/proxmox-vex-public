#!/bin/bash
# Spec 093/US094: malformed version.json handling — truncated, wrong-typed,
# missing-key, and oversized metadata must each abort cleanly naming the
# parse/validation failure, never a python traceback or silent misparse.
set -u
cd "$(dirname "$0")/.." || exit 1

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US094 malformed-metadata tests"

check "validate function exists"     "grep -q 'validate_version_doc' update.sh"
check "size cap"                     "grep -q '1048576\|too large' update.sh"
check "required-keys check"          "grep -q 'malformed or missing required' update.sh"

SCRATCH=$(mktemp -d); trap 'rm -rf "$SCRATCH"' EXIT

build_install() {
    local S="$1"
    mkdir -p "$S/install/releases/1.0.0" "$S/install/config" "$S/dist"
    echo 'v1' > "$S/install/releases/1.0.0/app.txt"
    echo 'cfg' > "$S/install/config/app.conf"
    cp update.sh "$S/install/releases/1.0.0/"
    ln -sfn "$S/install/releases/1.0.0" "$S/install/current"
    echo '1.0.0' > "$S/install/.active-version"
    cp update.sh "$S/install/"
}

run_update() {
    (cd "$1" && VEX_UPDATE_BASE="file://$2" VEX_I_ACCEPT_RISK=1 \
        HEALTH_URL="file:///dev/null" HEALTH_TIMEOUT=5 VEX_SKIP_POST_VERIFY=1 \
        bash update.sh --atomic --insecure --yes 2>&1)
}

# case 1: truncated JSON
A="$SCRATCH/A"; build_install "$A"
echo '{"version":"2.0.0","channels":{"stable":{"vers' > "$A/dist/version.json"
# shellcheck disable=SC2034
out=$(run_update "$A/install" "$A/dist"); rc=$?
check "truncated aborts"              "test $rc -ne 0"
check "parse failure named"           "echo \"\$out\" | grep -qi 'malformed\|invalid\|required keys'"
check "no traceback leaked"           "! echo \"\$out\" | grep -q 'Traceback'"
check "install untouched (truncated)" "readlink $A/install/current | grep -q 'releases/1.0.0$'"

# case 2: wrong types (version is an array)
B="$SCRATCH/B"; build_install "$B"
echo '{"version":[2,0,0],"channels":{}}' > "$B/dist/version.json"
# shellcheck disable=SC2034
out=$(run_update "$B/install" "$B/dist"); rc=$?
check "wrong-typed aborts"            "test $rc -ne 0"
check "type failure named"            "echo \"\$out\" | grep -qi 'malformed\|invalid\|required keys\|version'"

# case 3: missing channels
C="$SCRATCH/C"; build_install "$C"
echo '{"version":"2.0.0"}' > "$C/dist/version.json"
# shellcheck disable=SC2034
out=$(run_update "$C/install" "$C/dist"); rc=$?
check "missing-keys aborts"           "test $rc -ne 0"
check "missing keys named"            "echo \"\$out\" | grep -qi 'malformed\|missing\|required keys\|channels'"

# case 4: oversized junk (2MB)
D="$SCRATCH/D"; build_install "$D"
{ echo '{"version":"2.0.0","channels":{},"pad":"'; head -c 2200000 /dev/zero | tr '\0' 'x'; echo '"}'; } \
    > "$D/dist/version.json"
# shellcheck disable=SC2034
out=$(run_update "$D/install" "$D/dist"); rc=$?
check "oversized aborts"              "test $rc -ne 0"
check "size named"                    "echo \"\$out\" | grep -qi 'too large\|size'"

# case 5: valid doc still works (control)
E="$SCRATCH/E"; build_install "$E"
mkdir -p "$E/pkg/install"; echo 'v2' > "$E/pkg/install/app.txt"
tar -czf "$E/dist/ProxmoxVEx-2.0.0.tar.gz" -C "$E/pkg" install
cat > "$E/dist/version.json" <<JSON
{"version":"2.0.0","build":"x","release_date":"2026-01-01","min_python":"3.8",
 "changelog":[],"download_url":"file://$E/dist/ProxmoxVEx-2.0.0.tar.gz",
 "channels":{"stable":{"version":"2.0.0","archive":"ProxmoxVEx-2.0.0.tar.gz"}},
 "mirrors":["file://$E/dist"]}
JSON
run_update "$E/install" "$E/dist" >/dev/null; rc=$?
check "valid doc accepted"            "test $rc -eq 0"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
