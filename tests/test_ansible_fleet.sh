#!/bin/bash
# Spec 093/US098: shipped Ansible playbook orchestrates rolling fleet
# updates — serial batches, update.sh --yes, health gate between hosts.
set -u
cd "$(dirname "$0")/.." || exit 1

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

PB=deploy/ansible/update-fleet.yml

echo "US098 ansible-fleet tests"

check "playbook shipped"              "test -f $PB"
check "valid yaml"                    "python3 -c 'import yaml; yaml.safe_load(open(\"$PB\"))'"
check "targets install group"         "grep -qE 'hosts: *vex' $PB"
check "serial batching"               "grep -qE 'serial: *\"?([0-9]|\{\{)' $PB"
check "runs update.sh --yes"          "grep -E 'command:.*update' $PB | grep -q -- '--yes'"
check "nonzero rc tolerated for noop" "grep -q 'failed_when' $PB"
check "health gate present"           "grep -q 'health' $PB"
check "health gate retries"           "grep -A5 'health' $PB | grep -q 'retries'"
check "health gate until"             "grep -A6 'health' $PB | grep -q 'until'"
check "maintenance window honored"    "grep -q 'VEX_UPDATE_WINDOW\|update-window\|Environment' $PB"
check "documented in upgrading.md"    "grep -q 'ansible\|update-fleet' docs/upgrading.md"

# structural: one play, serial int, at least one health task
check "serial is int or batch expr"   "python3 -c 'import yaml; s=yaml.safe_load(open(\"$PB\"))[0].get(\"serial\"); assert isinstance(s, int) or (isinstance(s, str) and s.strip())'"
check "update task + health task"     "python3 -c 'import yaml; d=yaml.safe_load(open(\"$PB\")); t=[str(x) for x in d[0][\"tasks\"]]; assert any(\"update\" in x and \"--yes\" in x for x in t) and any(\"health\" in x.lower() and \"uri\" in x for x in t)'"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
