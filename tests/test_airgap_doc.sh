#!/bin/bash
# Spec 093/US078: airgap/offline update guide — docs/airgap.md covers the
# full runbook: fetch the .vexbundle on a connected machine, checksum it,
# transfer, verify, apply with --bundle, all offline.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US078 airgap-doc tests"

check "doc exists"                      "test -f docs/airgap.md"
check "bundle fetch covered"            "grep -q 'vexbundle' docs/airgap.md"
check "checksum compare covered"        "grep -q 'sha256sum' docs/airgap.md"
check "--bundle apply covered"          "grep -q '\-\-bundle' docs/airgap.md"
check "transfer step"                   "grep -qi 'transfer\|media\|usb\|sneaker' docs/airgap.md"
check "offline verification"            "grep -qi 'verify\|signature' docs/airgap.md"
check "--bundle flag exists in updater" "grep -q '\-\-bundle' update.sh"
check "linked from README"              "grep -q 'airgap.md' README.md"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
