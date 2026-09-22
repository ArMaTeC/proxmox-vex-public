#!/usr/bin/env python3
"""Mirror indexer — spec 093/US099.

Scans a dist/ directory of release archives and emits version.json +
checksums.txt so an internal registry/mirror serves valid metadata without
running the full release pipeline. Pair with scripts/mirror-sync.sh on the
client side and sign the output with scripts/sign-version.sh if the mirror
serves GPG-verified clients.

Usage:
    mirror-index.py <dist_dir> [--min-python 3.8] [--channel stable]
"""
import argparse
import hashlib
import json
import pathlib
import re
import sys
import datetime

ARCHIVE_RE = re.compile(r"^ProxmoxVEx-(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\.tar\.(?:gz|zst|xz)$")


def sha256(p: pathlib.Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verkey(v: str):
    return [int(x) for x in re.findall(r"\d+", v)]


def index(dist_dir: pathlib.Path, min_python: str, channel: str) -> dict:
    rel = {}
    for p in sorted(dist_dir.iterdir()):
        m = ARCHIVE_RE.match(p.name)
        if m:
            rel[m.group(1)] = {"archive": p.name, "sha256": sha256(p),
                               "size_bytes": p.stat().st_size}
    if not rel:
        raise SystemExit(f"no ProxmoxVEx-*.tar.* archives found in {dist_dir}")
    latest = sorted(rel, key=verkey)[-1]
    return {
        "version": latest,
        "build": "mirror-index",
        "release_date": datetime.date.today().isoformat(),
        "min_python": min_python,
        "generated_by": "scripts/mirror-index.py",
        "releases": rel,
        "channels": {channel: {"version": latest, "archive": rel[latest]["archive"]}},
        "mirrors": [],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("dist_dir", type=pathlib.Path)
    ap.add_argument("--min-python", default="3.8")
    ap.add_argument("--channel", default="stable")
    args = ap.parse_args()

    doc = index(args.dist_dir, args.min_python, args.channel)
    (args.dist_dir / "version.json").write_text(json.dumps(doc, indent=2) + "\n")

    # checksums.txt in sha256sum -c format so clients verify with coreutils
    lines = [f"{r['sha256']}  {r['archive']}" for r in doc["releases"].values()]
    (args.dist_dir / "checksums.txt").write_text("\n".join(lines) + "\n")

    print(f"indexed {len(doc['releases'])} release(s), latest {doc['version']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
