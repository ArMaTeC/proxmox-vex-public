#!/bin/bash
# scripts/build-release.sh — deterministic release tarball builder.
#
# spec 093/US006. Every byte of the output is a pure function of the
# source tree + SOURCE_DATE_EPOCH: sorted entry order, pinned mtimes,
# root:root ownership, no .pyc/bytecode, fixed gzip header (via -n).
#
# Usage:
#   scripts/build-release.sh                 # builds dist/ProxmoxVEx-<ver>.tar.gz
#   BUILD_DIR=<tree> OUT_DIR=<out> VERSION=<v> SOURCE_DATE_EPOCH=<ts> \
#       scripts/build-release.sh
#
# SOURCE_DATE_EPOCH defaults to the HEAD commit timestamp (the
# reproducible-builds convention) so rebuilds of one commit agree.
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

# Pinned clock: the commit timestamp, not the wall clock — that's what
# makes an independent rebuild of the same commit byte-identical.
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct 2>/dev/null || echo 0)}"
export SOURCE_DATE_EPOCH

BUILD_DIR="${BUILD_DIR:-$(pwd)}"
OUT_DIR="${OUT_DIR:-dist}"
VERSION="${VERSION:-$(python3 -c 'import json;print(json.load(open("version.json"))["version"])' 2>/dev/null || echo dev)}"

mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/ProxmoxVEx-${VERSION}.tar.gz"

# PYTHONHASHSEED pins any .pyc written during a build step; we also strip
# bytecode outright — compiled caches are machine/time-dependent and have
# no place in a source release.
export PYTHONHASHSEED=0
find "$BUILD_DIR" -name '__pycache__' -prune -o -name '*.pyc' -print -delete 2>/dev/null | \
    sed 's/^/build-release: stripped /' >&2 || true

# spec 093/US010, FR-027: bundle the release pubkey inside the tarball
# (dist/keys/release.pub) so a previously-installed tree always carries a
# copy of the trust root — airgap installs never need the network for it.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/dist/keys"
[ -f pubkey.asc ] && cp pubkey.asc "$STAGE/dist/keys/release.pub"

# spec 093/US022: per-file manifest baked into the release — auditors can run
# update.sh --verify-files post-install to catch file-level drift. Operator
# paths (config/data/secrets) are excluded: they legitimately change.
(cd "$BUILD_DIR" && find . -type f \
    ! -path "./config/*" ! -path "./data/*" ! -path "./ssl/*" \
    ! -path "./logs/*" ! -path "./backups/*" ! -path "./.git/*" \
    -exec sha256sum {} + | sed 's| \./| |' | sort > "$STAGE/MANIFEST.sha256")
cp "$STAGE/MANIFEST.sha256" "$OUT_DIR/MANIFEST.sha256" 2>/dev/null || \
    mkdir -p "$OUT_DIR" && cp "$STAGE/MANIFEST.sha256" "$OUT_DIR/MANIFEST.sha256"

# spec 093/US043: pre-publish secret scan — a leaked credential in a shipped
# tarball lands on every install. Scan the build tree AND the staged extras;
# any hit aborts the release, naming the file.
if [ -z "${VEX_SKIP_SECRET_SCAN:-}" ]; then
    scripts/scan-secrets.sh "$BUILD_DIR" || {
        echo "build-release: secrets detected in build tree — aborting" >&2
        exit 1
    }
fi

# --sort=name      : entry order independent of filesystem readdir order
# --format=ustar   : fixed header layout (pax headers embed variable data)
# --owner/group    : never leak the builder's uid/gid
# --mtime=@epoch   : all entries share the pinned timestamp
# --numeric-owner  : write uid 0, not a host-specific name
# gzip -n          : drop the embedded timestamp+filename from the stream
# spec 093/US040: one tar stream feeds BOTH compressors — same deterministic
# payload in .tar.gz (universal) and .tar.zst (faster/smaller for hosts with
# zstd). update.sh picks by tool availability.
if command -v zstd >/dev/null 2>&1; then
    tar --sort=name --format=ustar \
        --owner=0 --group=0 --numeric-owner \
        --mtime="@${SOURCE_DATE_EPOCH}" \
        --exclude='__pycache__' --exclude='*.pyc' \
        -cf - -C "$BUILD_DIR" . -C "$STAGE" . \
        | tee >(gzip -n > "$OUT") \
        | zstd -19 -T0 -q -o "${OUT%.tar.gz}.tar.zst" -
else
    tar --sort=name --format=ustar \
        --owner=0 --group=0 --numeric-owner \
        --mtime="@${SOURCE_DATE_EPOCH}" \
        --exclude='__pycache__' --exclude='*.pyc' \
        -cf - -C "$BUILD_DIR" . -C "$STAGE" . | gzip -n > "$OUT"
fi

sha256sum "$OUT"
[ -f "${OUT%.tar.gz}.tar.zst" ] && sha256sum "${OUT%.tar.gz}.tar.zst"

# spec 093/US028: inject the real byte size into release metadata — clients
# can then size downloads/preflight without a network probe.
python3 - "$OUT" "$VERSION" <<'PY'
import json, os, sys
path, ver = sys.argv[1], sys.argv[2]
size = os.path.getsize(path)
d = json.load(open("version.json"))
d.setdefault("releases", {}).setdefault(ver, {})["size_bytes"] = size
for c in d.get("channels", {}).values():
    if c.get("version") == ver:
        c["size_bytes"] = size
json.dump(d, open("version.json", "w"), indent=2)
PY

# spec 093/US007: append-only transparency log — every build's hash is a
# public record, so a silently replaced artifact diverges from history.
# sign-release.sh re-signs the log after appends.
python3 - "$OUT" "$VERSION" <<'PY'
import hashlib, json, sys, datetime
path, version = sys.argv[1], sys.argv[2]
h = hashlib.sha256(open(path, "rb").read()).hexdigest()
entry = {"version": version, "artifact": path.split("/")[-1],
         "sha256": h, "ts": datetime.datetime.now(datetime.timezone.utc)
                             .strftime("%Y-%m-%dT%H:%M:%SZ")}
with open("transparency.log", "a") as f:
    f.write(json.dumps(entry, separators=(",", ":")) + "\n")
PY

# spec 093/US009: CycloneDX SBOM alongside the tarball — generated from
# the source tree's lockfiles (never hand-edited), signed at publish.
if command -v python3 >/dev/null 2>&1; then
    python3 scripts/gen-sbom.py \
        --requirements "$BUILD_DIR/requirements.txt" \
        --package-lock "$BUILD_DIR/package-lock.json" \
        --version "$VERSION" --out "$OUT_DIR/sbom.json" || \
        echo "build-release: SBOM generation skipped" >&2
fi

# spec 093/US052: auto-generated changelog — conventional commits since the
# previous tag become structured release notes alongside the artifacts.
if command -v python3 >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
    PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
    python3 scripts/gen-changelog.py --repo . ${PREV_TAG:+--from "$PREV_TAG"} \
        --to HEAD --version "$VERSION" \
        --out "$OUT_DIR/changelog.generated.json" || \
        echo "build-release: changelog generation skipped" >&2
fi

# spec 093/US044: per-release dependency freeze manifest — auditors diff
# deps-freeze.json between releases to see exactly which deps changed.
if command -v python3 >/dev/null 2>&1; then
    python3 scripts/gen-freeze.py \
        --requirements "$BUILD_DIR/requirements.txt" \
        --package-lock "$BUILD_DIR/package-lock.json" \
        --version "$VERSION" --out "$OUT_DIR/deps-freeze.json" || \
        echo "build-release: freeze manifest generation skipped" >&2
fi

# spec 093/US100: published file-diff report — if a previous release
# tarball sits alongside in OUT_DIR, emit dist/diff-<prev>-to-<ver>.txt
# with ADDED/CHANGED/REMOVED categories so auditors review without
# extracting two archives. Best-effort: no prior tarball -> skip.
PREV_TAR=""
for _cand in "$OUT_DIR"/ProxmoxVEx-*.tar.gz; do
    [ -e "$_cand" ] || continue
    case "$_cand" in *-"${VERSION}".tar.gz) continue ;; esac
    if [ -z "$PREV_TAR" ] || [ "$_cand" -nt "$PREV_TAR" ]; then PREV_TAR="$_cand"; fi
done
if [ -n "$PREV_TAR" ]; then
    PREV_VER=$(basename "$PREV_TAR" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    bash scripts/gen-diff.sh "$PREV_TAR" "$OUT" \
        "$OUT_DIR/diff-${PREV_VER}-to-${VERSION}.txt" || \
        echo "build-release: diff report skipped" >&2
fi

# spec 093/US020: airgap bundle — one .vexbundle carrying everything an
# offline host needs: tarball + detached sig + checksums + signed metadata +
# the standalone verifier + the release pubkey. update.sh --bundle applies it.
BUNDLE_STAGE=$(mktemp -d)
cp "$OUT" "$BUNDLE_STAGE/"
[ -f "$OUT.asc" ]        && cp "$OUT.asc" "$BUNDLE_STAGE/"
[ -f "$OUT_DIR/checksums.txt" ] && cp "$OUT_DIR/checksums.txt" "$BUNDLE_STAGE/"
cp version.json "$BUNDLE_STAGE/" 2>/dev/null || true
[ -f version.json.asc ]  && cp version.json.asc "$BUNDLE_STAGE/"
cp verify-release.sh "$BUNDLE_STAGE/"
cp pubkey.asc "$BUNDLE_STAGE/" 2>/dev/null || true
tar -czf "$OUT_DIR/ProxmoxVEx-${VERSION}.vexbundle" -C "$BUNDLE_STAGE" .
rm -rf "$BUNDLE_STAGE"

echo "build-release: $OUT (SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH)"
echo "build-release: $OUT_DIR/ProxmoxVEx-${VERSION}.vexbundle (airgap bundle)"
