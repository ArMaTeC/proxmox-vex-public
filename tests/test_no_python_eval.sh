#!/bin/bash
# Roadmap ID-0176: update.sh runs as root — every embedded python must
# take data via argv/stdin, never via shell interpolation into code.
# Bans: eval, python3 -c with a double-quoted body ($ can interpolate),
# python3 - <<PY (unquoted heredoc interpolates).
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "ID-0176 no-interpolated-python tests"

check "no eval in update.sh" \
    "! grep -nE '(^|[^[:alnum:]_])eval[[:space:]]' update.sh"
check "no double-quoted python3 -c bodies" \
    "! grep -n 'python3 -c \"' update.sh"
check "no unquoted python heredocs" \
    "! grep -nE 'python3[[:space:]]+-?[[:space:]]*<<[[:space:]]*PY' update.sh | grep -v \"<<'PY'\""
# single-quoted -c bodies cannot interpolate by definition; the only
# dangerous spellings were the three above.

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
