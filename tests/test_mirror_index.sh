#!/bin/bash
# Spec 093/US099: internal registry/mirror indexer — scans a dist dir of
# release archives and emits version.json + checksums so an internal
# mirror serves valid metadata without a full publish pipeline.
set -u
cd "$(dirname "$0")/.." || exit 1

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US099 mirror-index tests"

check "indexer shipped"               "test -f scripts/mirror-index.py"
check "indexer executable/parseable"  "python3 -m py_compile scripts/mirror-index.py"
check "has cli entrypoint"            "grep -q '__main__' scripts/mirror-index.py"

# functional: fake dist dir -> version.json + checksums
SCRATCH=$(mktemp -d); trap 'rm -rf "$SCRATCH"' EXIT
mkdir -p "$SCRATCH/dist"
echo 'old'  | gzip > "$SCRATCH/dist/ProxmoxVEx-1.0.0.tar.gz"
echo 'new!' | gzip > "$SCRATCH/dist/ProxmoxVEx-1.2.0.tar.gz"
python3 scripts/mirror-index.py "$SCRATCH/dist" >/dev/null 2>&1

check "version.json emitted"          "test -f $SCRATCH/dist/version.json"
check "checksums emitted"             "test -f $SCRATCH/dist/checksums.txt"
check "latest detected"               "python3 -c 'import json; d=json.load(open(\"$SCRATCH/dist/version.json\")); assert d[\"version\"]==\"1.2.0\"'"
check "all releases indexed"          "python3 -c 'import json; d=json.load(open(\"$SCRATCH/dist/version.json\")); r=d[\"releases\"]; assert \"1.0.0\" in r and \"1.2.0\" in r'"
check "release has sha256+size"       "python3 -c 'import json; d=json.load(open(\"$SCRATCH/dist/version.json\")); r=d[\"releases\"][\"1.2.0\"]; assert len(r[\"sha256\"])==64 and r[\"size_bytes\"]>0'"
check "stable channel points latest"  "python3 -c 'import json; d=json.load(open(\"$SCRATCH/dist/version.json\")); assert d[\"channels\"][\"stable\"][\"version\"]==\"1.2.0\"'"
check "checksums verify"              "cd $SCRATCH/dist && sha256sum -c checksums.txt >/dev/null"
check "schema-valid shape"            "python3 -c 'import json; d=json.load(open(\"$SCRATCH/dist/version.json\")); [d[k] for k in (\"version\",\"releases\",\"channels\")]'"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
