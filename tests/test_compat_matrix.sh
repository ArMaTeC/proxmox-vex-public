#!/bin/bash
# Spec 093/US080: version/platform compatibility matrix — a generator
# renders the matrix from version.json releases metadata and
# docs/compatibility.md publishes it.
set -u
cd "$(dirname "$0")/.." || exit
source tests/lib.sh 2>/dev/null || true

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US080 compatibility-matrix tests"

check "generator exists"           "test -x scripts/gen_compat.py"
check "doc exists"                 "test -f docs/compatibility.md"
check "doc has matrix table"       "grep -q '| Version |' docs/compatibility.md"
check "doc covers python range"    "grep -qi 'python' docs/compatibility.md"
check "doc covers arch"            "grep -qi 'arch\|x86_64\|aarch64' docs/compatibility.md"
check "doc covers platform gate"   "grep -qi 'platform' docs/compatibility.md"

# functional: generator emits a row per release with real metadata
SCRATCH=$(mktemp -d); trap 'rm -rf "$SCRATCH"' EXIT
cat > "$SCRATCH/version.json" <<'EOF'
{"version":"1.2.473",
 "releases":{
   "1.2.473":{"min_python":"3.9","platforms":["linux-x86_64","linux-aarch64"]},
   "1.2.472":{"min_python":"3.8","platforms":["linux-x86_64"]}}}
EOF
if out=$(python3 scripts/gen_compat.py "$SCRATCH/version.json" 2>/dev/null); then
  check "emits header"            "echo \"\$out\" | grep -q '| Version |'"
  check "emits both releases"     "echo \"\$out\" | grep -q '1.2.473' && echo \"\$out\" | grep -q '1.2.472'"
  check "emits min_python"        "echo \"\$out\" | grep -q '3.9'"
  check "emits platforms"         "echo \"\$out\" | grep -q 'aarch64'"
else
  bad "generator runs"; bad "emits header"; bad "emits both releases"
  bad "emits min_python"; bad "emits platforms"
fi

# generated matrix must match what's checked into the doc
if out=$(python3 scripts/gen_compat.py version.json 2>/dev/null); then
  while read -r line; do
    [[ "$line" == \|* ]] || continue
    grep -qF "$line" docs/compatibility.md || { bad "doc matches generated matrix (stale: $line)"; break; }
  done <<< "$out"
  ok "doc matches generated matrix"
else
  bad "doc matches generated matrix"
fi

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
