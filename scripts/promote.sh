#!/usr/bin/env bash
# promote.sh — staging → public promotion gate (spec 093/US035).
#
# Flow: publish.sh lands a release in staging/releases/<ver> (inert, not
# client-visible). promote.sh then (1) verifies the staged set end-to-end
# (metadata shape + artifact checksums), and only then (2) moves it into
# releases/<ver> and repoints `current`. A broken release dies in staging
# and never reaches a client.
#
# Usage:
#   PUBLISH_HOST=user@host ./scripts/promote.sh <version>        # real host
#   ./scripts/promote.sh <version> --local /path/to/docroot      # local/test

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:?usage: promote.sh <version> [--local <docroot>]}"
HOST="${PUBLISH_HOST:-}"
ROOT="${PUBLISH_ROOT:-/var/www/proxmoxvex-dist}"
LOCAL_ROOT=""
[ "${2:-}" = "--local" ] && LOCAL_ROOT="${3:?--local needs a docroot path}"

die() { echo "promote: FAIL: $*" >&2; exit 1; }

# staging_verify <base-url-or-path> <version>: confirm the staged release is
# internally consistent — version.json parses, checksums match payloads.
# Works over file:// (local/test) or https:// (real staging host).
staging_verify() {
    local base="$1" ver="$2" work
    work=$(mktemp -d)
    # pull the staged metadata + manifest
    curl -fsSL "$base/version.json" -o "$work/version.json" 2>/dev/null \
        || { rm -rf "$work"; echo "no staged version.json" >&2; return 1; }
    local docver
    docver=$(python3 -c "import json;print(json.load(open('$work/version.json'))['version'])" 2>/dev/null)
    [ "$docver" = "$ver" ] || { rm -rf "$work"; echo "staged version.json is '$docver', expected '$ver'" >&2; return 1; }
    # verify every artifact listed in checksums.txt
    curl -fsSL "$base/checksums.txt" -o "$work/checksums.txt" 2>/dev/null \
        || { rm -rf "$work"; echo "no staged checksums.txt" >&2; return 1; }
    local name rc=0
    while read -r _hash name; do
        [ -n "$name" ] || continue
        curl -fsSL "$base/$name" -o "$work/$name" 2>/dev/null \
            || { echo "missing staged artifact: $name" >&2; rc=1; break; }
    done < "$work/checksums.txt"
    if [ $rc -eq 0 ]; then
        (cd "$work" && sha256sum -c checksums.txt) >/dev/null 2>&1 \
            || { echo "staged checksum mismatch" >&2; rc=1; }
    fi
    rm -rf "$work"
    [ $rc -eq 0 ] && echo "staging verify OK: $ver" || echo "staging verify FAILED: $ver" >&2
    return $rc
}

# promote_swap <docroot> <version>: move staged release into releases/ and
# repoint `current` atomically. Old release retained for instant rollback.
promote_swap() {
    local root="$1" ver="$2"
    [ -d "$root/staging/releases/$ver" ] || { echo "no staged release: $root/staging/releases/$ver" >&2; return 1; }
    mv "$root/staging/releases/$ver" "$root/releases/$ver"
    ln -sfn "releases/$ver" "$root/current.tmp"
    mv -T "$root/current.tmp" "$root/current"
    # staged metadata becomes the live pointer, LAST
    cp "$root/releases/$ver/version.json" "$root/version.json" 2>/dev/null || true
    [ -f "$root/releases/$ver/version.json.asc" ] && \
        cp "$root/releases/$ver/version.json.asc" "$root/version.json.asc"
    return 0
}

main() {
    if [ -n "$LOCAL_ROOT" ]; then
        staging_verify "file://$LOCAL_ROOT/staging/releases/$VERSION" "$VERSION" \
            || die "staging verification failed; not promoting"
        promote_swap "$LOCAL_ROOT" "$VERSION"
        echo "promote: $VERSION live under $LOCAL_ROOT"
        return 0
    fi
    [ -n "$HOST" ] || die "set PUBLISH_HOST or use --local"
    staging_verify "https://staging.proxmoxvex.com/releases/$VERSION" "$VERSION" \
        || die "staging verification failed; not promoting"
    ssh "$HOST" "mv '$ROOT/staging/releases/$VERSION' '$ROOT/releases/$VERSION' \
        && ln -sfn 'releases/$VERSION' '$ROOT/current.tmp' \
        && mv -T '$ROOT/current.tmp' '$ROOT/current' \
        && cp '$ROOT/releases/$VERSION/version.json' '$ROOT/version.json' \
        && cp '$ROOT/releases/$VERSION/version.json.asc' '$ROOT/version.json.asc' 2>/dev/null || true"
    echo "promote: $VERSION live on $HOST"
}

main "$@"
