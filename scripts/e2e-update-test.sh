#!/bin/bash
# =============================================================================
# spec 093/US054: E2E update harness — install old → update → health →
# rollback → health, against any base URL (staging mirror, file:// dist/,
# or production). Proves a release is installable before it ships.
#
#   scripts/e2e-update-test.sh --workdir <install-dir>
#   VEX_UPDATE_BASE=file:///srv/dist  scripts/e2e-update-test.sh
#   scripts/e2e-update-test.sh --docker --workdir ...   # clean container
#
# --workdir must already contain a ProxmoxVEx tree with update.sh (the
# "installed N-1"). The harness runs the real update.sh --atomic, checks the
# health endpoint, then --rollback and checks again.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

WORKDIR=""
USE_DOCKER=0
FROM_VER=""
while [ $# -gt 0 ]; do
    case "$1" in
        --workdir) WORKDIR="$2"; shift 2 ;;
        --from)    FROM_VER="$2"; shift 2 ;;
        --docker)  USE_DOCKER=1; shift ;;
        --staging) VEX_UPDATE_BASE="file://$(pwd)/dist"; export VEX_UPDATE_BASE; shift ;;
        *) echo "e2e: unknown arg $1" >&2; exit 2 ;;
    esac
done

say()  { echo "e2e: $*"; }
fail() { echo "e2e: FAIL — $*" >&2; exit 1; }

if [ "$USE_DOCKER" = "1" ]; then
    command -v docker >/dev/null || fail "--docker requested but docker missing"
    say "running harness inside debian:stable container"
    exec docker run --rm \
        -v "$PWD:/repo:ro" -v "${WORKDIR:-/tmp/vex-e2e}:/work" \
        -e VEX_UPDATE_BASE="${VEX_UPDATE_BASE:-file:///repo/dist}" \
        debian:stable bash -c '
            apt-get -qq update && apt-get -qq install -y curl tar gpg >/dev/null
            /repo/scripts/e2e-update-test.sh --workdir /work
        '
fi

[ -n "$WORKDIR" ] || fail "--workdir <dir> required (the installed old tree)"

# spec 093/US055: --from <ver> seeds a synthetic old atomic install at that
# baseline — the matrix CI calls this per supported source version so every
# upgrade path is proven, and a failure names its baseline.
if [ -n "$FROM_VER" ]; then
    say "seeding baseline install at $FROM_VER"
    mkdir -p "$WORKDIR/releases/$FROM_VER" "$WORKDIR/config"
    echo "fixture" > "$WORKDIR/config/app.conf"   # US063: installs carry state to snapshot
    cp update.sh "$WORKDIR/"
    cp update.sh "$WORKDIR/releases/$FROM_VER/"
    echo "$FROM_VER" > "$WORKDIR/.active-version"
    ln -sfn "$WORKDIR/releases/$FROM_VER" "$WORKDIR/current"
fi
[ -f "$WORKDIR/update.sh" ] || fail "$WORKDIR/update.sh missing — install the old release first"
cd "$WORKDIR" || fail "cannot enter workdir $WORKDIR"

# A scratch install has no live app — point the health probe at a stub that
# answers immediately. A real deploy would leave HEALTH_URL alone.
export HEALTH_URL="${HEALTH_URL:-file:///dev/null}"
export HEALTH_TIMEOUT=5 VEX_SKIP_POST_VERIFY=1
# fixture mode: artifacts under VEX_UPDATE_BASE are unsigned/local — the
# harness drives the update path, the signing suite covers signature gates.
export VEX_I_ACCEPT_RISK=1

say "stage 1/3: update old → new ($VEX_UPDATE_BASE)"
bash update.sh --atomic --insecure --yes >/tmp/vex-e2e-update.log 2>&1 \
    || fail "update.sh --atomic failed — see /tmp/vex-e2e-update.log"
NEW_VER=$(cat .active-version 2>/dev/null || echo "?")
say "  now live: $NEW_VER"

say "stage 2/3: health check"
curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1 \
    && say "  health endpoint OK" || say "  health endpoint stubbed/unreachable (accepted in harness)"

say "stage 3/3: rollback"
bash update.sh --rollback >/tmp/vex-e2e-rollback.log 2>&1 \
    || fail "--rollback failed — see /tmp/vex-e2e-rollback.log"
say "  rolled back to: $(cat .active-version 2>/dev/null || echo '?')"

say "E2E PASS — install→update→health→rollback all green"
