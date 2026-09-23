#!/bin/bash
# Spec 093/US095: fresh-install e2e — extract the shipped tarball on a
# clean debian container, install deps + postgres, boot the app, assert
# the health endpoint answers. Proves the released artifact is actually
# installable end-to-end (the same stack docker-compose assembles).
set -u
cd "$(dirname "$0")/.." || exit 1

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US095 fresh-install-e2e tests"

check "latest tarball exists"         "test -f dist/ProxmoxVEx-latest.tar.gz"
check "tarball has entrypoint"        "tar -tzf dist/ProxmoxVEx-latest.tar.gz | grep -q '^ProxmoxVEx_multi_cluster.py$'"
check "tarball has requirements"      "tar -tzf dist/ProxmoxVEx-latest.tar.gz | grep -q '^requirements.txt$'"

if ! docker info >/dev/null 2>&1; then
    echo "SKIP: docker daemon unavailable — container e2e skipped"
    echo "result: $PASS passed, $FAIL failed"
    exit 0
fi

# the real install path on a clean OS: extract → deps + postgres → boot → healthz
# shellcheck disable=SC2034
out=$(timeout 600 docker run --rm -v "$PWD:/src:ro" debian:stable-slim bash -c '
    set -e
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends \
        python3 python3-pip curl ca-certificates postgresql >/dev/null
    mkdir -p /opt/vex
    tar -xzf /src/dist/ProxmoxVEx-latest.tar.gz -C /opt/vex
    cd /opt/vex
    pip3 install --break-system-packages --no-cache-dir -q -r requirements.txt

    # postgres cluster (debian postinst creates "main"); start without systemd
    PGV=$(ls /etc/postgresql | head -1)
    pg_ctlcluster "$PGV" main start
    su postgres -c "psql -qc \"CREATE USER proxmoxvex PASSWORD '"'"'proxmoxvex'"'"';\""
    su postgres -c "psql -qc \"CREATE DATABASE proxmoxvex OWNER proxmoxvex;\""

    PROXMOXVEX_DATABASE_URL=postgresql://proxmoxvex:proxmoxvex@127.0.0.1:5432/proxmoxvex \
    PROXMOXVEX_BEHIND_PROXY=true PROXMOXVEX_HOST=127.0.0.1 \
        nohup python3 ProxmoxVEx_multi_cluster.py >/app.log 2>&1 &
    for i in $(seq 1 120); do
        curl -fsS http://127.0.0.1:5000/api/health >/dev/null 2>&1 && { echo HEALTHY; exit 0; }
        sleep 2
    done
    echo "--- app.log tail ---"; tail -25 /app.log; exit 1
' 2>&1); rc=$?

check "container install boots"       "test $rc -eq 0"
check "health endpoint green"         "echo \"\$out\" | grep -q HEALTHY"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
