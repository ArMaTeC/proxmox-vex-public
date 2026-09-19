#!/bin/bash
# Spec 093/US096: shipped systemd timer + service for scheduled update
# checks — units must exist, be systemd-analyze valid, run update.sh in
# the maintenance window, and be documented with a cron alternative.
set -u
cd "$(dirname "$0")/.." || exit 1

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US096 systemd-timer tests"

check "timer unit shipped"            "test -f deploy/proxmoxvex-update.timer"
check "service unit shipped"          "test -f deploy/proxmoxvex-update.service"
check "timer has OnCalendar"          "grep -q '^OnCalendar=' deploy/proxmoxvex-update.timer"
check "timer randomized delay"        "grep -q '^RandomizedDelaySec=' deploy/proxmoxvex-update.timer"
check "timer persistent"              "grep -q '^Persistent=true' deploy/proxmoxvex-update.timer"
check "timer wantedby timers.target"  "grep -q 'WantedBy=timers.target' deploy/proxmoxvex-update.timer"
check "service oneshot"               "grep -q 'Type=oneshot' deploy/proxmoxvex-update.service"
check "service runs update.sh --yes"  "grep -E '^ExecStart=.*/update\.sh' deploy/proxmoxvex-update.service | grep -q -- '--yes'"
check "service sets update window"    "grep -q 'Environment=.*VEX_UPDATE_WINDOW\|EnvironmentFile' deploy/proxmoxvex-update.service"
check "service hardening"             "grep -q '^ProtectSystem=' deploy/proxmoxvex-update.service"
check "cron example documented"       "grep -qE '[0-9*,/]+[[:space:]]+[0-9*,/]+[[:space:]]+[0-9*,/]+[[:space:]]+[0-9*,/]+[[:space:]]+[0-9*,/]+.*update\.sh' docs/upgrading.md docs/faq-updates.md 2>/dev/null"

# functional: systemd-analyze verifies both units parse cleanly. ExecStart
# targets /opt/vex (the deployed path, absent on a dev host) — verify a copy
# pointed at the repo's real update.sh so the resolve check is meaningful.
if command -v systemd-analyze >/dev/null 2>&1; then
    VDIR=$(mktemp -d); trap 'rm -rf "$VDIR"' EXIT
    sed "s|ExecStart=/opt/vex/update.sh|ExecStart=$PWD/update.sh|" \
        deploy/proxmoxvex-update.service > "$VDIR/proxmoxvex-update.service"
    cp deploy/proxmoxvex-update.timer "$VDIR/"
    check "systemd-analyze verify"    "systemd-analyze verify '$VDIR/proxmoxvex-update.service' '$VDIR/proxmoxvex-update.timer' 2>/dev/null"
    check "OnCalendar parses"         "systemd-analyze calendar \"\$(grep '^OnCalendar=' deploy/proxmoxvex-update.timer | cut -d= -f2-)\" | grep -q 'Next elapse'"
else
    echo "SKIP: systemd-analyze unavailable — unit-verify skipped"
fi

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
