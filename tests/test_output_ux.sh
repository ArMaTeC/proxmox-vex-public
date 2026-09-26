#!/bin/bash
# Spec 101: operator-facing output — --help/--version exit 0, NO_COLOR and
# non-tty strip ANSI, --quiet suppresses info lines, verify-release.sh
# supports --version/--strict/--json.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }

OUT=$(./update.sh --help 2>&1); RC=$?
[ $RC -eq 0 ] && ok "update.sh --help exits 0" || bad "--help exit $RC"
printf '%s' "$OUT" | grep -q "Usage:" && ok "help shows usage" || bad "no usage"
printf '%s' "$OUT" | grep -q "Exit:" && ok "help lists exit codes" || bad "no exit table"
printf '%s' "$OUT" | grep -q -- "--quiet" && ok "help lists --quiet" || bad "--quiet undocumented"

VOUT=$(./update.sh --version 2>&1); RC=$?
[ $RC -eq 0 ] && printf '%s' "$VOUT" | grep -q "1\.2\." && ok "--version prints version" || bad "--version: $VOUT"

# NO_COLOR / piped output must not contain escape sequences.
HOUT=$(NO_COLOR=1 ./update.sh --help 2>&1)
printf '%s' "$HOUT" | grep -q $'\033' && bad "NO_COLOR still emits ANSI" || ok "NO_COLOR strips ANSI"
POUT=$(./update.sh --help | cat)
printf '%s' "$POUT" | grep -q $'\033' && bad "piped output has ANSI" || ok "non-tty strips ANSI"

# verify-release.sh flags
V=$(./verify-release.sh --version 2>&1); RC=$?
[ $RC -eq 0 ] && ok "verify --version" || bad "verify --version rc=$RC"
./verify-release.sh 2>/dev/null; RC=$?
[ $RC -eq 3 ] && ok "verify no-args exits 3" || bad "verify no-args rc=$RC"
# checksum-only run against the real dist/ artifact
(cd dist && ../verify-release.sh --quiet ProxmoxVEx-latest.tar.gz --checksum-only >/dev/null 2>&1); RC=$?
[ $RC -eq 0 ] && ok "verify checksum-only PASS" || bad "verify checksum-only rc=$RC"
# strict must refuse the skipped signature
(cd dist && ../verify-release.sh --strict --checksum-only ProxmoxVEx-latest.tar.gz >/dev/null 2>&1); RC=$?
[ $RC -eq 4 ] && ok "--strict fails on skipped sig (rc4)" || bad "--strict rc=$RC"
# json mode emits parseable lines
J=$(cd dist && ../verify-release.sh --json --checksum-only ProxmoxVEx-latest.tar.gz 2>/dev/null | head -1)
printf '%s' "$J" | grep -q '^{"' && ok "--json emits JSON" || bad "--json: $J"
# errors on stderr, not stdout
E=$(cd dist && ../verify-release.sh /nonexistent.tgz 2>/dev/null); [ -z "$E" ] && ok "errors stay on stderr" || bad "stdout polluted: $E"

echo "output-ux: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
