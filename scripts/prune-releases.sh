#!/bin/bash
# =============================================================================
# spec 093/US057: release retention policy.
#
#   scripts/prune-releases.sh [--root <install-root>] [--apply]
#
# Policy (docs/channels.md): keep the last KEEP_STABLE stable releases
# (default 10), every LTS release, and the rollback pair — .active-version
# (current) + .previous-version (one-step rollback target). Everything
# else is reported for pruning; nothing is deleted without --apply.
# =============================================================================
set -euo pipefail

ROOT="."
APPLY=0
KEEP_STABLE="${KEEP_STABLE:-10}"
while [ $# -gt 0 ]; do
    case "$1" in
        --root)  ROOT="$2"; shift 2 ;;
        --apply) APPLY=1; shift ;;
        *) echo "prune-releases: unknown arg $1" >&2; exit 2 ;;
    esac
done

REL="$ROOT/releases"
[ -d "$REL" ] || { echo "prune-releases: no releases/ under $ROOT" >&2; exit 1; }

CURRENT="$(cat "$ROOT/.active-version" 2>/dev/null || true)"
PREVIOUS="$(cat "$ROOT/.previous-version" 2>/dev/null || true)"

# rank versions newest-first; position > KEEP_STABLE becomes a candidate
mapfile -t VERSIONS < <(ls "$REL" | sort -Vr)

pruned=0; idx=0
for v in "${VERSIONS[@]}"; do
    idx=$((idx+1))
    case "$v" in
        *-lts|*lts*) echo "keep  $v (lts)"; continue ;;
    esac
    if [ "$v" = "$CURRENT" ];   then echo "keep  $v (current)";  continue; fi
    if [ "$v" = "$PREVIOUS" ];  then echo "keep  $v (rollback target)"; continue; fi
    if [ "$idx" -le "$KEEP_STABLE" ]; then
        echo "keep  $v (rank $idx <= $KEEP_STABLE)"
        continue
    fi
    echo "prune $v (rank $idx > keep $KEEP_STABLE stables)"
    if [ "$APPLY" = "1" ]; then
        rm -rf "${REL:?}/${v:?}"
        echo "  removed $REL/$v"
    fi
    pruned=$((pruned+1))
done

if [ "$APPLY" = "1" ]; then
    echo "prune-releases: $pruned release(s) removed"
else
    echo "prune-releases: dry-run — $pruned release(s) would be pruned (--apply to delete)"
fi
