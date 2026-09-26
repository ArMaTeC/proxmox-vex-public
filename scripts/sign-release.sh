#!/bin/bash
# Spec 093/US001: sign every release tarball so update.sh can verify
# integrity+authenticity before install. Produces a detached armored
# signature (<file>.asc) next to each artifact.
#
# Usage:
#   scripts/sign-release.sh [dist/ProxmoxVEx-X.Y.Z.tar.gz ...]
#   scripts/sign-release.sh            # signs every dist/*.tar.gz
#
# The signing key lives in the release operator's GnuPG home — never in
# this repo. Override the identity with VEX_SIGNING_KEY (fingerprint or
# uid); default is the project's release-signing uid.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

KEY="${VEX_SIGNING_KEY:-releases@proxmoxvex.com}"

if ! gpg --batch --list-secret-keys "$KEY" >/dev/null 2>&1; then
    echo "sign-release: no secret key for '$KEY'" >&2
    echo "  set VEX_SIGNING_KEY to the release key fingerprint/uid" >&2
    exit 1
fi

targets=("$@")
if [ "${#targets[@]}" -eq 0 ]; then
    shopt -s nullglob
    # US040: sign every artifact format — .tar.zst ships alongside .tar.gz.
    targets=(dist/*.tar.gz dist/*.tar.zst)
fi

if [ "${#targets[@]}" -eq 0 ]; then
    echo "sign-release: nothing to sign (no dist/*.tar.gz, none given)" >&2
    exit 1
fi

for f in "${targets[@]}"; do
    [ -f "$f" ] || { echo "sign-release: missing $f" >&2; exit 1; }
    gpg --batch --yes -u "$KEY" --detach-sign --armor -o "$f.asc" "$f"
    echo "signed: $f.asc"
done

# spec 093/US002: the publish step also refreshes dist/checksums.txt —
# update.sh verifies the downloaded archive against this manifest, so it
# must never lag the artifacts.
if [ -d dist ]; then
    # US040: manifest covers both compression formats.
    (cd dist && sha256sum *.tar.gz *.tar.zst 2>/dev/null > checksums.txt \
        || sha256sum *.tar.gz > checksums.txt)
    echo "refreshed: dist/checksums.txt"
fi

# spec 093/US009: the SBOM is a published artifact — it gets the same
# detached signature so consumers can trust the dependency inventory.
shopt -s nullglob
for f in dist/sbom*.json; do
    gpg --batch --yes -u "$KEY" --detach-sign --armor -o "$f.asc" "$f"
    echo "signed: $f.asc"
done

# spec 093/US022: sign the standalone per-file manifest too — the copy inside
# the tarball is already covered by the archive signature.
f=dist/MANIFEST.sha256
if [ -f "$f" ]; then
    gpg --batch --yes -u "$KEY" --detach-sign --armor -o "$f.asc" "$f"
    echo "signed: $f.asc"
fi

# spec 093/US044: sign the dependency freeze manifest — auditors trust the
# dep-diff only if the manifest itself is authenticated.
f=dist/deps-freeze.json
if [ -f "$f" ]; then
    gpg --batch --yes -u "$KEY" --detach-sign --armor -o "$f.asc" "$f"
    echo "signed: $f.asc"
fi

# spec 093/US007: re-sign the transparency log after any appends — the
# log's value is that it's signed history, so an unsigned or stale
# signature would let an attacker truncate it undetected.
if [ -f transparency.log ]; then
    gpg --batch --yes -u "$KEY" --detach-sign --armor \
        -o transparency.log.asc transparency.log
    echo "signed: transparency.log.asc"
fi
