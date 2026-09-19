#!/bin/bash
# spec 093/US100: file-diff report between two release tarballs.
# Emits a categorized ADDED/CHANGED/REMOVED listing so release review
# doesn't require extracting both archives by hand. Called by
# scripts/build-release.sh for prev->current; also usable standalone:
#
#   scripts/gen-diff.sh <prev.tar.gz> <new.tar.gz> <out.txt>
set -euo pipefail

PREV="${1:?usage: gen-diff.sh <prev.tar> <new.tar> <out>}"
NEW="${2:?usage: gen-diff.sh <prev.tar> <new.tar> <out>}"
OUT="${3:?usage: gen-diff.sh <prev.tar> <new.tar> <out>}"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/a" "$TMP/b"

untar() {  # handle .gz/.zst/.xz transparently, strip the top-level dir
    case "$1" in
        *.zst) tar --zstd -xf "$1" -C "$2" ;;
        *.xz)  tar --xz   -xf "$1" -C "$2" ;;
        *)     tar -xzf        "$1" -C "$2" ;;
    esac
    # flatten a single top-level wrapper dir (install/ or ProxmoxVEx-*/)
    local inner
    inner=$(find "$2" -mindepth 1 -maxdepth 1 -type d | head -1)
    if [ -n "$inner" ] && [ "$(find "$2" -mindepth 1 -maxdepth 1 | wc -l)" = "1" ]; then
        mv "$inner" "$2.root" && mv "$2.root"/* "$2/" && mv "$2.root"/.[!.]* "$2/" 2>/dev/null || true
        rmdir "$2.root" 2>/dev/null || true
    fi
}
untar "$PREV" "$TMP/a"
untar "$NEW"  "$TMP/b"

prev_v=$(basename "$PREV" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
new_v=$(basename "$NEW"  | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)

{
    echo "# File diff: $prev_v -> $new_v"
    echo "# generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by scripts/gen-diff.sh"
    echo "# categories: ADDED (new file), CHANGED (content differs), REMOVED (deleted)"
    echo ""
    cd "$TMP/a" && find . -type f | sort | while read -r f; do
        rel="${f#./}"
        if [ ! -e "$TMP/b/$rel" ]; then
            echo "REMOVED $rel"
        elif ! cmp -s "$TMP/a/$rel" "$TMP/b/$rel"; then
            echo "CHANGED $rel"
        fi
    done
    cd "$TMP/b" && find . -type f | sort | while read -r f; do
        rel="${f#./}"
        [ -e "$TMP/a/$rel" ] || echo "ADDED $rel"
    done
} > "$OUT"

echo "gen-diff: $OUT ($(grep -c '^ADDED\|^CHANGED\|^REMOVED' "$OUT" 2>/dev/null || echo 0) entries)"
