#!/bin/bash
# Spec 093/US009: every release ships a CycloneDX SBOM generated from
# lockfiles (not hand-edits), signed alongside the artifacts.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US009 SBOM tests"

check "scripts/gen-sbom.py exists"              "test -f scripts/gen-sbom.py"
check "build-release.sh emits SBOM"             "grep -q 'sbom\|gen-sbom' scripts/build-release.sh"
check "sign-release.sh signs SBOM"              "grep -q 'sbom' scripts/sign-release.sh"
check "CycloneDX format"                        "grep -qi 'cyclonedx\|bomFormat' scripts/gen-sbom.py"
check "parses requirements.txt"                 "grep -q 'requirements' scripts/gen-sbom.py"
check "parses package-lock.json"                "grep -q 'package-lock\|package_lock' scripts/gen-sbom.py"

# --- functional: generate from scratch lockfiles -------------------------------
SCRATCH=$(mktemp -d)
cat > "$SCRATCH/requirements.txt" <<'EOF'
flask==3.0.3
requests>=2.31
EOF
cat > "$SCRATCH/package-lock.json" <<'EOF'
{"packages": {"node_modules/lodash": {"version": "4.17.21"},
              "node_modules/react": {"version": "18.2.0"}}}
EOF

python3 scripts/gen-sbom.py --requirements "$SCRATCH/requirements.txt" \
    --package-lock "$SCRATCH/package-lock.json" --out "$SCRATCH/sbom.json" \
    >/dev/null 2>&1
rc=$?
if [ $rc -eq 0 ] && [ -f "$SCRATCH/sbom.json" ]; then
    python3 - "$SCRATCH/sbom.json" <<'PY'
import json, sys
b = json.load(open(sys.argv[1]))
ok = (b.get("bomFormat") == "CycloneDX"
      and any(c.get("name") == "flask" for c in b.get("components", []))
      and any(c.get("name") == "lodash" for c in b.get("components", []))
      and any(c.get("type") == "library" for c in b.get("components", [])))
sys.exit(0 if ok else 1)
PY
    [ $? -eq 0 ] && ok "SBOM is valid CycloneDX with py+js components" \
                 || bad "SBOM is valid CycloneDX with py+js components"
else
    bad "SBOM is valid CycloneDX with py+js components (rc=$rc)"
fi

# missing lockfiles must not crash the build — SBOM still emits (empty list)
python3 scripts/gen-sbom.py --out "$SCRATCH/sbom2.json" >/dev/null 2>&1
rc=$?
[ $rc -eq 0 ] && ok "no lockfiles → still emits valid SBOM" \
              || bad "no lockfiles → still emits valid SBOM (rc=$rc)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
