#!/bin/bash
# Spec 093/US048: enforce installed file permissions — a tarball built on a
# permissive host must not land world-writable or over-open modes: dirs 755,
# files 644, executables 755, config secrets 600.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US048 file-perms tests"

check "normalize function exists"       "grep -q 'normalize_modes' update.sh"
check "dirs forced 755"                 "grep -q 'chmod 755' update.sh"
check "files forced 644"                "grep -q 'chmod 644' update.sh"
check "secrets forced 600"              "grep -q 'chmod 600' update.sh"
check "wired into apply path"           "[ \$(grep -c 'normalize_modes' update.sh) -ge 3 ]"
check "world-writable swept"            "grep -q 'perm.*077\|world.writable\|-perm' update.sh"

# --- functional: a sloppy tree gets normalized -----------------------------------------
SCRATCH=$(mktemp -d)
awk '/^normalize_modes\(\)/,/^}/' update.sh > "$SCRATCH/nm.sh"

mkdir -p "$SCRATCH/tree/bin" "$SCRATCH/tree/config" "$SCRATCH/tree/sub"
echo 'x=1'                          > "$SCRATCH/tree/app.py";      chmod 666 "$SCRATCH/tree/app.py"
echo '#!/bin/sh'                    > "$SCRATCH/tree/bin/tool.sh"; chmod 666 "$SCRATCH/tree/bin/tool.sh"
echo 'secret'                       > "$SCRATCH/tree/config/key.pem"; chmod 644 "$SCRATCH/tree/config/key.pem"
echo 'SECRET=x'                     > "$SCRATCH/tree/config/.env"; chmod 644 "$SCRATCH/tree/config/.env"
chmod 777 "$SCRATCH/tree/sub"
echo 'x' > "$SCRATCH/tree/data.txt"; chmod 777 "$SCRATCH/tree/data.txt"

bash -c "source '$SCRATCH/nm.sh'; normalize_modes '$SCRATCH/tree'"

m(){ stat -c '%a' "$1"; }
[ "$(m "$SCRATCH/tree/sub")" = "755" ]        && ok "world-writable dir → 755" || bad "world-writable dir → 755 ($(m "$SCRATCH/tree/sub"))"
[ "$(m "$SCRATCH/tree/app.py")" = "644" ]     && ok "world-writable file → 644" || bad "world-writable file → 644 ($(m "$SCRATCH/tree/app.py"))"
[ "$(m "$SCRATCH/tree/data.txt")" = "644" ]   && ok "777 file → 644" || bad "777 file → 644 ($(m "$SCRATCH/tree/data.txt"))"
[ "$(m "$SCRATCH/tree/bin/tool.sh")" = "755" ] && ok "bin script → 755" || bad "bin script → 755 ($(m "$SCRATCH/tree/bin/tool.sh"))"
[ "$(m "$SCRATCH/tree/config/key.pem")" = "600" ] && ok "key.pem → 600" || bad "key.pem → 600 ($(m "$SCRATCH/tree/config/key.pem"))"
[ "$(m "$SCRATCH/tree/config/.env")" = "600" ]   && ok ".env → 600" || bad ".env → 600 ($(m "$SCRATCH/tree/config/.env"))"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
