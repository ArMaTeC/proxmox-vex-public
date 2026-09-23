#!/bin/bash
# Spec 093/US044: per-release dependency freeze manifest — build-release
# emits dist/deps-freeze.json with every pinned dep + hash; auditors diff
# manifests between releases to see exactly what changed.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US044 deps-freeze tests"

check "freeze generator exists"         "[ -f scripts/gen-freeze.py ]"
check "wired into build-release"        "grep -q 'gen-freeze' scripts/build-release.sh"
check "signed at publish"               "grep -q 'deps-freeze' scripts/sign-release.sh"
check "json shape documented"           "grep -q 'deps-freeze' README.md"
check "requirements parsed"             "grep -q 'requirements' scripts/gen-freeze.py"
check "package-lock parsed"             "grep -q 'package-lock' scripts/gen-freeze.py"

# --- functional: freeze a scratch tree ------------------------------------------------
SCRATCH=$(mktemp -d)
printf 'flask==3.0.0\nrequests==2.31.0\n# comment\npytest ; extra\n' > "$SCRATCH/requirements.txt"
cat > "$SCRATCH/package-lock.json" <<'JSON'
{"packages": {"": {"version": "1.0.0"}, "node_modules/vite": {"version": "5.0.0"}, "node_modules/react": {"version": "18.2.0"}}}
JSON

python3 scripts/gen-freeze.py --requirements "$SCRATCH/requirements.txt" \
    --package-lock "$SCRATCH/package-lock.json" \
    --version 9.9.9 --out "$SCRATCH/deps-freeze.json" >/dev/null 2>&1
[ $? -eq 0 ] && ok "generator runs" || bad "generator runs"
[ -f "$SCRATCH/deps-freeze.json" ] && ok "manifest emitted" || bad "manifest emitted"
python3 -c "import json;d=json.load(open('$SCRATCH/deps-freeze.json'))
assert d['python']['flask']=='3.0.0'; assert d['python']['requests']=='2.31.0'" \
    && ok "python pins captured" || bad "python pins captured"
python3 -c "import json;d=json.load(open('$SCRATCH/deps-freeze.json'))
assert d['npm']['vite']=='5.0.0'; assert d['npm']['react']=='18.2.0'" \
    && ok "npm pins captured" || bad "npm pins captured"
python3 -c "import json;d=json.load(open('$SCRATCH/deps-freeze.json'))
assert d.get('version')=='9.9.9'" && ok "release version recorded" || bad "release version recorded"
python3 -c "import json;d=json.load(open('$SCRATCH/deps-freeze.json'))
assert 'pytest' not in d['python']" && ok "unpinned lines skipped" || bad "unpinned lines skipped"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
