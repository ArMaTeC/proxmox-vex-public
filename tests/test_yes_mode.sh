#!/bin/bash
# Spec 093/US066: non-interactive --yes mode — updates run end-to-end in a
# pipeless shell; without --yes and without a TTY the updater refuses with
# a message naming --yes instead of silently cancelling.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US066 --yes automation tests"

check "--yes flag parsed"               "grep -q '\-\-yes' update.sh"
check "TTY check gates prompt"          "grep -q '\[ -t 0 \]\|\-t 0' update.sh"
check "no-TTY refusal names --yes"      "grep -q 'interactive confirmation required' update.sh"

# --- functional fixtures ---------------------------------------------------
SCRATCH=$(mktemp -d)
mk_inst() {
    mkdir -p "$1/releases/1.0.0" "$1/config" "$SCRATCH/dist-$2"
    echo 'v1' > "$1/releases/1.0.0/app.txt"
    echo 'cfg' > "$1/config/app.conf"
    cp update.sh "$1/releases/1.0.0/"; cp update.sh "$1/"
    ln -sfn "$1/releases/1.0.0" "$1/current"
    echo '1.0.0' > "$1/.active-version"
    tar -czf "$SCRATCH/dist-$2/ProxmoxVEx-2.0.0.tar.gz" -C "$SCRATCH" "inst-$2"
    cat > "$SCRATCH/dist-$2/version.json" <<JSON
{"version":"2.0.0","build":"x","release_date":"2026-01-01","min_python":"3.8",
 "changelog":[],"download_url":"file://$SCRATCH/dist-$2/ProxmoxVEx-2.0.0.tar.gz",
 "channels":{"stable":{"version":"2.0.0","archive":"ProxmoxVEx-2.0.0.tar.gz"}},
 "mirrors":["file://$SCRATCH/dist-$2"]}
JSON
}

# (a) pipeless shell WITHOUT --yes → refuses, names --yes, changes nothing
mk_inst "$SCRATCH/inst-a" a
cd "$SCRATCH/inst-a"
out=$(VEX_UPDATE_BASE="file://$SCRATCH/dist-a" VEX_I_ACCEPT_RISK=1 \
      HEALTH_URL="file:///dev/null" \
      bash update.sh --insecure --atomic </dev/null 2>&1); rc=$?
cd - >/dev/null
[ $rc -ne 0 ] && ok "no-TTY without --yes refuses" || bad "no-TTY without --yes refuses (rc=$rc)"
echo "$out" | grep -q '\-\-yes' && ok "refusal names --yes" || bad "refusal names --yes"
[ "$(cat "$SCRATCH/inst-a/.active-version")" = "1.0.0" ] \
    && ok "refused run changed nothing" || bad "refused run changed nothing"

# (b) pipeless shell WITH --yes → full update completes, no prompt
mk_inst "$SCRATCH/inst-b" b
cd "$SCRATCH/inst-b"
out=$(VEX_UPDATE_BASE="file://$SCRATCH/dist-b" VEX_I_ACCEPT_RISK=1 \
      HEALTH_URL="file:///dev/null" VEX_SKIP_POST_VERIFY=1 \
      bash update.sh --insecure --atomic --yes </dev/null 2>&1); rc=$?
cd - >/dev/null
[ $rc -eq 0 ] && ok "--yes completes without TTY" || bad "--yes completes without TTY (rc=$rc: $(echo "$out"|tail -3))"
[ "$(cat "$SCRATCH/inst-b/.active-version")" = "2.0.0" ] \
    && ok "update applied (2.0.0 active)" || bad "update applied"
! echo "$out" | grep -q 'Continue?' && ok "no prompt emitted" || bad "no prompt emitted"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
