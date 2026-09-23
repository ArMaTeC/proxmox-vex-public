#!/bin/bash
# Spec 093/US003: SLSA build provenance for release tarballs.
#
# The release workflow must emit SLSA3 provenance via the official
# generator, and docs/verify.md must tell operators how to verify it.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

WF=.github/workflows/release.yml

echo "US003 provenance tests"

check "release workflow exists"              "test -f $WF"
check "workflow parses as YAML"              "python3 -c 'import yaml,sys; yaml.safe_load(open(\"$WF\"))' 2>/dev/null || python3 - <<'PY'
import sys
try:
    import yaml; yaml.safe_load(open('$WF')); sys.exit(0)
except ImportError:
    # no pyyaml — structural grep instead
    sys.exit(0 if open('$WF').read().count('jobs:') else 1)
PY"
check "id-token: write for OIDC/sigstore"    "grep -Eq 'id-token:\s*write' $WF"
check "contents: write for asset upload"     "grep -Eq 'contents:\s*write' $WF"
check "uses the slsa3 generic generator"     "grep -q 'slsa-github-generator/.github/workflows/generator_generic_slsa3.yml' $WF"
check "generator version pinned"             "grep -Eq 'generator_generic_slsa3.yml@v[0-9]' $WF"
check "passes base64-subjects"               "grep -q 'base64-subjects' $WF"
check "upload-assets enabled"                "grep -Eq 'upload-assets:\s*true' $WF"
check "subjects come from real sha256 digests" "grep -Eq 'sha256sum|sha256sum.*tar.gz' $WF"

check "docs/verify.md exists"                "test -f docs/verify.md"
check "verify doc covers slsa-verifier"      "grep -q 'slsa-verifier' docs/verify.md"
check "verify doc covers gpg signature check" "grep -Eq 'gpg.*--verify|--verify.*asc' docs/verify.md"
check "verify doc names expected repo"       "grep -q 'proxmox-vex-public' docs/verify.md"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
