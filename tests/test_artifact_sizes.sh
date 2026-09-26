#!/bin/bash
# Spec 093/US028: artifact sizes in version.json — preflight can size the
# download without a network HEAD probe.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US028 artifact-size tests"

check "size_bytes in version.json"      "python3 -c 'import json; d=json.load(open(\"version.json\")); assert any(\"size_bytes\" in v for v in d.get(\"releases\",{}).values()) or \"size_bytes\" in d'"
check "size injection in build script"  "grep -q 'size_bytes' scripts/build-release.sh"
check "update.sh reads declared size"   "grep -q 'size_bytes' update.sh"
check "schema allows size_bytes"        "grep -q 'size_bytes' version.schema.json"
check "shipped doc validates"           "python3 scripts/validate-version.py version.json"
check "declared size is an integer"     "python3 -c 'import json; d=json.load(open(\"version.json\")); v=d[\"releases\"][d[\"version\"]]; assert isinstance(v[\"size_bytes\"], int)'"

# --- functional: declared size matches real file ----------------------------------
SCRATCH=$(mktemp -d)
dd if=/dev/urandom of="$SCRATCH/ProxmoxVEx-1.0.0.tar.gz" bs=1024 count=17 2>/dev/null
REAL=$(stat -c%s "$SCRATCH/ProxmoxVEx-1.0.0.tar.gz")
cat > "$SCRATCH/vj.json" <<JSON
{"releases": {"1.0.0": {"size_bytes": $REAL}}}
JSON

awk '/^declared_size\(\)/,/^}/' update.sh > "$SCRATCH/ds.sh"
out=$(bash -c "source '$SCRATCH/ds.sh'; declared_size '$SCRATCH/vj.json' 1.0.0" 2>&1)
[ "$out" = "$REAL" ] && ok "declared size returned" || bad "declared size returned (got: $out, want $REAL)"

# channel pointer size
cat > "$SCRATCH/vj2.json" <<JSON
{"channels": {"beta": {"version": "2.0.0", "archive": "b.tar.gz", "size_bytes": 4242}}}
JSON
out=$(bash -c "source '$SCRATCH/ds.sh'; declared_size '$SCRATCH/vj2.json' 2.0.0" 2>&1)
[ "$out" = "4242" ] && ok "channel-level size found" || bad "channel-level size found (got: $out)"

# unknown version → empty, not an error
out=$(bash -c "source '$SCRATCH/ds.sh'; declared_size '$SCRATCH/vj.json' 9.9.9; echo rc=\$?" 2>&1)
echo "$out" | grep -q 'rc=0' && ok "unknown version → empty+ok" || bad "unknown version → empty+ok (got: $out)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
