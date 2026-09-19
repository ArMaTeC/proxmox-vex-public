#!/bin/bash
# Spec 093/US043: pre-publish secret scan — a planted credential in the build
# tree or the packaged tarball must abort the release, naming the file.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US043 secret-scan tests"

check "scanner script exists"           "[ -f scripts/scan-secrets.sh ]"
check "scanner is executable"           "[ -x scripts/scan-secrets.sh ]"
check "wired into build-release"        "grep -q 'scan-secrets' scripts/build-release.sh"
check "private-key pattern covered"     "grep -q 'PRIVATE KEY' scripts/scan-secrets.sh"
check "aws-key pattern covered"         "grep -q 'AKIA' scripts/scan-secrets.sh"
check "failure names the file"          "grep -q 'secrets detected' scripts/scan-secrets.sh"

# --- functional: planted secret in a tree aborts -------------------------------------
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/clean" "$SCRATCH/dirty/deploy"
echo 'print("hello")' > "$SCRATCH/clean/app.py"
echo 'print("hello")' > "$SCRATCH/dirty/app.py"
printf '%s\n' '-----BEGIN RSA PRIVATE KEY-----' 'MIIEowIBAAKCAQEAfake' '-----END RSA PRIVATE KEY-----' \
    > "$SCRATCH/dirty/deploy/key.pem"
echo 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE' > "$SCRATCH/dirty/creds.ini"

# clean tree passes
if bash scripts/scan-secrets.sh "$SCRATCH/clean" >/dev/null 2>&1; then
    ok "clean tree passes"
else
    bad "clean tree passes"
fi

# dirty tree aborts naming the file
out=$(bash scripts/scan-secrets.sh "$SCRATCH/dirty" 2>&1); rc=$?
[ $rc -ne 0 ] && ok "planted secret aborts" || bad "planted secret aborts (rc=$rc)"
echo "$out" | grep -q 'key.pem\|creds.ini' && ok "names the offending file" || bad "names the offending file (got: $out)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
