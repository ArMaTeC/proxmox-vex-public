#!/bin/bash
# Spec 093/US068: platform/architecture compatibility — version.json may
# declare a `platforms` allowlist; an unsupported `uname -m` is refused
# BEFORE download with the supported list named. Absent metadata defaults
# to x86_64+aarch64.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US068 platform-gate tests"

check "platform gate function"          "grep -q 'check_platform' update.sh"
check "uname -m consulted"              "grep -q 'uname -m' update.sh"
check "supported list named in die"     "grep -q 'unsupported' update.sh"
check "platforms in version.json"       "grep -q '\"platforms\"' version.json"
check "platforms in schema"             "grep -q 'platforms' version.schema.json"
check "wired into update flow"          "grep -q 'check_platform' update.sh"

# --- functional: stub uname to fake an unsupported arch ---------------------
SCRATCH=$(mktemp -d)
printf 'die() { echo "die: $*" >&2; exit 1; }\n' > "$SCRATCH/fn.sh"
awk '/^check_platform\(\)/,/^}/' update.sh >> "$SCRATCH/fn.sh"
mkdir -p "$SCRATCH/bin"
printf '#!/bin/sh\necho riscv64\n' > "$SCRATCH/bin/uname"   # fake arch
chmod +x "$SCRATCH/bin/uname"

cat > "$SCRATCH/vj.json" <<'JSON'
{"platforms": ["x86_64", "aarch64"]}
JSON

out=$(PATH="$SCRATCH/bin:$PATH" bash -c "source '$SCRATCH/fn.sh'; check_platform '$SCRATCH/vj.json'" 2>&1); rc=$?
[ $rc -ne 0 ] && ok "unsupported arch refused" || bad "unsupported arch refused"
echo "$out" | grep -q 'riscv64' && ok "arch named in refusal" || bad "arch named in refusal ($out)"
echo "$out" | grep -q 'x86_64'  && ok "supported list named" || bad "supported list named ($out)"

# supported arch passes
out=$(bash -c "source '$SCRATCH/fn.sh'; check_platform '$SCRATCH/vj.json'" 2>&1); rc=$?
[ $rc -eq 0 ] && ok "supported arch passes" || bad "supported arch passes ($out)"

# absent platforms metadata → default allowlist (x86_64/aarch64)
echo '{}' > "$SCRATCH/vj2.json"
out=$(PATH="$SCRATCH/bin:$PATH" bash -c "source '$SCRATCH/fn.sh'; check_platform '$SCRATCH/vj2.json'" 2>&1); rc=$?
[ $rc -ne 0 ] && ok "absent platforms → default still enforced" || bad "absent platforms → default enforced"
out=$(bash -c "source '$SCRATCH/fn.sh'; check_platform '$SCRATCH/vj2.json'" 2>&1); rc=$?
[ $rc -eq 0 ] && ok "real arch passes default list" || bad "real arch passes default list ($out)"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
