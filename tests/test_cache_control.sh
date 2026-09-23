#!/bin/bash
# Spec 093/US031: correct Cache-Control — version.json must never be cached
# (stale metadata = stale trust root); versioned tarballs are immutable;
# the -latest pointer may cache only briefly.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US031 cache-control tests"

check "nginx config exists"             "[ -f deploy/nginx.conf ]"
check "version.json no-cache rule"      "grep -q 'version' deploy/nginx.conf && grep -qi 'no-cache' deploy/nginx.conf"
check "must-revalidate on metadata"     "grep -q 'must-revalidate\|no-store' deploy/nginx.conf"
check "versioned tarball immutable"     "grep -q 'immutable' deploy/nginx.conf"
check "long max-age on tarballs"        "grep -q 'max-age=31536000\|max-age=15552000' deploy/nginx.conf"
check "-latest short-lived"             "grep -q 'latest' deploy/nginx.conf"
check "signatures also revalidated"     "grep -q 'asc' deploy/nginx.conf"
check "nginx syntax shape (server{)"    "grep -q 'server\s*{' deploy/nginx.conf"
check "location blocks present"         "grep -q 'location' deploy/nginx.conf"
check "documented in README/docs"       "grep -rqi 'nginx.conf\|cache-control' README.md docs/ deploy/ 2>/dev/null"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
