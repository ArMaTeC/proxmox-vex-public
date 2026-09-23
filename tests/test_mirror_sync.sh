#!/bin/bash
# Spec 093/US084: self-hosted mirror — scripts/mirror-sync.sh mirrors the
# upstream distribution tree (metadata, signatures, archives) into a local
# docroot; docs/mirroring.md documents setup + client config.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US084 mirror-sync tests"

check "sync script exists"          "test -x scripts/mirror-sync.sh"
check "doc exists"                  "test -f docs/mirroring.md"
check "doc covers sync"             "grep -q 'mirror-sync' docs/mirroring.md"
check "doc covers client config"    "grep -q 'VEX_UPDATE_BASE' docs/mirroring.md"
check "doc covers nginx"            "grep -qi 'nginx' docs/mirroring.md"
check "linked from README"          "grep -q 'mirroring.md' README.md"

# functional: sync a file:// upstream fixture into a docroot
SCRATCH=$(mktemp -d); trap 'rm -rf "$SCRATCH"' EXIT
UP="$SCRATCH/upstream"; DEST="$SCRATCH/docroot"
mkdir -p "$UP"
cat > "$UP/version.json" <<'EOF'
{"version":"1.2.472",
 "channels":{"stable":{"version":"1.2.472","archive":"ProxmoxVEx-1.2.472.tar.gz"}},
 "releases":{"1.2.472":{"archive":"ProxmoxVEx-1.2.472.tar.gz"}},
 "deltas":{}}
EOF
echo "fake-sig" > "$UP/version.json.asc"
echo "fake-pubkey" > "$UP/pubkey.asc"
echo "abc123  ProxmoxVEx-1.2.472.tar.gz" > "$UP/checksums.txt"
echo "archive-bytes" > "$UP/ProxmoxVEx-1.2.472.tar.gz"
echo "archive-sig" > "$UP/ProxmoxVEx-1.2.472.tar.gz.asc"
echo "latest-bytes" > "$UP/ProxmoxVEx-latest.tar.gz"
echo "latest-sig" > "$UP/ProxmoxVEx-latest.tar.gz.asc"

if bash scripts/mirror-sync.sh --src "file://$UP" --dest "$DEST" >/dev/null 2>&1; then
  ok "sync runs"
else
  bad "sync runs"
fi
check "version.json mirrored"     "test -f $DEST/current/version.json"
check "sig mirrored"              "test -f $DEST/current/version.json.asc"
check "pubkey mirrored"           "test -f $DEST/current/pubkey.asc"
check "checksums mirrored"        "test -f $DEST/current/checksums.txt"
check "archive mirrored"          "test -f $DEST/current/ProxmoxVEx-1.2.472.tar.gz"
check "archive sig mirrored"      "test -f $DEST/current/ProxmoxVEx-1.2.472.tar.gz.asc"
check "latest mirrored"           "test -f $DEST/current/ProxmoxVEx-latest.tar.gz"
check "no partial files"          "! ls $DEST/current | grep -q '.part\|.tmp'"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
