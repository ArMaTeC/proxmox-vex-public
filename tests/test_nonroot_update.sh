#!/bin/bash
# Spec 093/US092: update as the service user — a user-owned install
# updates to completion; a root-owned install fails fast with a clear
# fix message, not a mid-apply permission error.
set -u
cd "$(dirname "$0")/.." || exit 1

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US092 non-root-update tests"

check "writability preflight"       "grep -q 'write access to' update.sh"

command -v su >/dev/null || { echo "SKIP: su unavailable"; exit 0; }

SCRATCH=$(mktemp -d); trap 'rm -rf "$SCRATCH"' EXIT
chmod 755 "$SCRATCH"   # nobody must traverse the fixture root

build_fixture() {
    local S="$1"
    mkdir -p "$S/install/releases/1.0.0" "$S/install/config" "$S/dist" "$S/pkg/install"
    echo 'v1' > "$S/install/releases/1.0.0/app.txt"
    echo 'cfg' > "$S/install/config/app.conf"
    cp update.sh "$S/install/releases/1.0.0/"
    ln -sfn "$S/install/releases/1.0.0" "$S/install/current"
    echo '1.0.0' > "$S/install/.active-version"
    cp update.sh "$S/install/"
    echo 'v2' > "$S/pkg/install/app.txt"
    tar -czf "$S/dist/ProxmoxVEx-2.0.0.tar.gz" -C "$S/pkg" install
    cat > "$S/dist/version.json" <<JSON
{"version":"2.0.0","build":"x","release_date":"2026-01-01","min_python":"3.8",
 "changelog":[],"download_url":"file://$S/dist/ProxmoxVEx-2.0.0.tar.gz",
 "channels":{"stable":{"version":"2.0.0","archive":"ProxmoxVEx-2.0.0.tar.gz"}},
 "mirrors":["file://$S/dist"]}
JSON
}

as_nobody() { # as_nobody <install-dir> <dist-dir>
    su -s /bin/bash nobody -c \
        "cd '$1' && VEX_UPDATE_BASE='file://$2' VEX_I_ACCEPT_RISK=1 \
         HEALTH_URL='file:///dev/null' HEALTH_TIMEOUT=5 VEX_SKIP_POST_VERIFY=1 \
         bash update.sh --atomic --insecure --yes" 2>&1
}

# A: nobody-owned install — must complete
A="$SCRATCH/A"; build_fixture "$A"
chown -R nobody:nogroup "$A/install"
chmod -R a+rX "$A/dist"
out=$(as_nobody "$A/install" "$A/dist"); rc=$?
check "user-owned install updates"  "test $rc -eq 0"
check "activated as service user"   "readlink $A/install/current | grep -q 'releases/2.0.0$'"

# B: root-owned install — clear error, live release untouched
B="$SCRATCH/B"; build_fixture "$B"
chmod -R a+rX "$B/dist"
# shellcheck disable=SC2034
out=$(as_nobody "$B/install" "$B/dist"); rc=$?
check "root-owned run fails"        "test $rc -ne 0"
check "names the fix"               "echo \"\$out\" | grep -qi 'write access\|owner\|sudo'"
check "live release untouched"      "readlink $B/install/current | grep -q 'releases/1.0.0$'"
check "no partial staging"          "! test -d $B/install/releases/2.0.0 && ! test -d $B/install/releases/.stage-2.0.0"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
