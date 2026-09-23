#!/bin/bash
# Spec 093/US013: release channels — version.json carries per-channel
# latest pointers; update.sh selects candidates by configured channel;
# channel config persists across updates.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US013 release-channel tests"

check "version.json has channels block"         "python3 -c \"import json;d=json.load(open('version.json'));exit(0 if 'channels' in d else 1)\""
check "channels carry version+archive"          "python3 -c \"import json;c=json.load(open('version.json'))['channels'];exit(0 if all('version' in v and 'archive' in v for v in c.values()) else 1)\""
check "update.sh reads channel config"          "grep -q 'update-channel\|CHANNEL' update.sh"
check "channel resolver function"               "grep -q 'resolve_channel\|channel_release' update.sh"
check "missing channel fails closed (no stable fallback)" "grep -qi 'no release for channel\|channel.*not.*publish\|channel.*unknown' update.sh"

# --- functional: resolution semantics on scratch docs ---------------------------
SCRATCH=$(mktemp -d)
awk '/^resolve_channel_release\(\)/,/^}/' update.sh > "$SCRATCH/rc.sh"

cat > "$SCRATCH/version.json" <<'EOF'
{"version": "1.2.472",
 "archive": "ProxmoxVEx-latest.tar.gz",
 "channels": {
   "stable": {"version": "1.2.472", "archive": "ProxmoxVEx-1.2.472.tar.gz"},
   "beta":   {"version": "1.3.0b2", "archive": "ProxmoxVEx-1.3.0b2.tar.gz"}
 }}
EOF

out=$(bash -c "source '$SCRATCH/rc.sh'; resolve_channel_release '$SCRATCH/version.json' stable" 2>/dev/null)
echo "$out" | grep -q '1.2.472' && ok "stable resolves to stable version" || bad "stable resolves to stable version (got: $out)"
echo "$out" | grep -q 'ProxmoxVEx-1.2.472.tar.gz' && ok "stable resolves archive" || bad "stable resolves archive (got: $out)"

out=$(bash -c "source '$SCRATCH/rc.sh'; resolve_channel_release '$SCRATCH/version.json' beta" 2>/dev/null)
echo "$out" | grep -q '1.3.0b2' && ok "beta resolves to beta version" || bad "beta resolves to beta version (got: $out)"

bash -c "source '$SCRATCH/rc.sh'; resolve_channel_release '$SCRATCH/version.json' lts" >/dev/null 2>&1
rc=$?
[ $rc -ne 0 ] && ok "lts missing → error, never offered stable" || bad "lts missing → error, never offered stable"

# legacy metadata without channels → top-level fallback
cat > "$SCRATCH/legacy.json" <<'EOF'
{"version": "1.2.472", "archive": "ProxmoxVEx-latest.tar.gz"}
EOF
out=$(bash -c "source '$SCRATCH/rc.sh'; resolve_channel_release '$SCRATCH/legacy.json' lts" 2>/dev/null)
echo "$out" | grep -q '1.2.472' && ok "no channels block → legacy top-level fallback" || bad "no channels block → legacy fallback (got: $out)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
