#!/bin/bash
# scripts/build-delta.sh — file-level delta package between two release
# tarballs. spec 093/US014.
#
#   build-delta.sh OLD_TARBALL NEW_TARBALL OUT_DELTA_TAR_GZ
#
# The payload contains only added/changed files plus delta-manifest.json:
#   {"from": <old-tar-sha256>, "to": <new-tar-sha256>,
#    "files":   {relpath: sha256}   # full target-tree fingerprint
#    "changed": [relpath...], "removed": [relpath...]}
#
# The delta is published next to full archives, gets its own .asc signature
# and a checksums.txt entry — update.sh verifies it through the exact same
# signature+checksum path as a full release (FR-041), then verifies the
# applied tree against the manifest's full file map.
#
# Delta chains stay bounded (MAX_DELTA_HOPS): build deltas only between
# consecutive / last-N releases — beyond that the client downloads the
# full archive.
set -euo pipefail

MAX_DELTA_HOPS=3
OLD="${1:?usage: build-delta.sh OLD_TAR NEW_TAR OUT_DELTA}"
NEW="${2:?usage: build-delta.sh OLD_TAR NEW_TAR OUT_DELTA}"
OUT="${3:?usage: build-delta.sh OLD_TAR NEW_TAR OUT_DELTA}"

command -v python3 >/dev/null || { echo "build-delta: python3 required" >&2; exit 1; }

W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
mkdir -p "$W/old" "$W/new" "$W/payload"
tar -xzf "$OLD" -C "$W/old"
tar -xzf "$NEW" -C "$W/new"

python3 - "$W/old" "$W/new" "$W/payload" "$OLD" "$NEW" <<'PY'
import hashlib, json, os, shutil, sys
old, new, payload, old_tar, new_tar = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]

def manifest(root):
    m = {}
    for dp, dns, fns in os.walk(root):
        dns.sort()
        for fn in sorted(fns):
            p = os.path.join(dp, fn)
            rel = os.path.relpath(p, root)
            with open(p, "rb") as fh:
                m[rel] = hashlib.sha256(fh.read()).hexdigest()
    return m

def digest(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()

om, nm = manifest(old), manifest(new)
removed = sorted(set(om) - set(nm))
changed = sorted(p for p in nm if om.get(p) != nm[p])
for rel in changed:
    src = os.path.join(new, rel)
    dst = os.path.join(payload, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, dst)

meta = {
    "from": digest(old_tar),
    "to": digest(new_tar),
    "files": nm,
    "changed": changed,
    "removed": removed,
}
with open(os.path.join(payload, "delta-manifest.json"), "w") as f:
    json.dump(meta, f, sort_keys=True)
print(f"build-delta: {len(changed)} changed, {len(removed)} removed", file=sys.stderr)
PY

# deterministic package — same normalization as build-release.sh
tar --sort=name --format=ustar \
    --owner=0 --group=0 --numeric-owner \
    --mtime="@${SOURCE_DATE_EPOCH:-0}" \
    -cf - -C "$W/payload" . | gzip -n > "$OUT"
echo "build-delta: $OUT (bounded chains: MAX_DELTA_HOPS=$MAX_DELTA_HOPS)"
