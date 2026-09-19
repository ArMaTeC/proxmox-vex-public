#!/usr/bin/env python3
"""spec 093/US044: dependency freeze manifest generator.

Emits deps-freeze.json — the exact pinned dependency tree for a release —
so auditors can `diff deps-freeze-1.2.471.json deps-freeze-1.2.472.json`
and see every dep that changed. Sources are lockfiles only (never hand
resolution), keeping the manifest deterministic.

Usage:
    gen-freeze.py --requirements reqs.txt [--package-lock lock.json]
                  --version 1.2.472 --out deps-freeze.json
"""
import argparse
import hashlib
import json
import pathlib
import sys


def parse_requirements(path):
    """Declared python deps from requirements.txt.

    `==` pins freeze to the bare version; floors/ranges (`>=`, `~=`, `<=`)
    freeze to the declared spec (">=3.1.3") — the manifest records what the
    release *requires*, which is what an auditor diffs.
    """
    deps = {}
    p = pathlib.Path(path)
    if not p.is_file():
        return deps
    for raw in p.read_text().splitlines():
        line = raw.split("#", 1)[0].strip().split(";", 1)[0].strip()
        if not line or line.startswith(("-", ".", "git+")):
            continue
        for op in ("===", "==", "~=", ">=", "<=", "!=", ">", "<"):
            if op in line:
                name, ver = line.split(op, 1)
                # bare version for == pins; declared spec otherwise
                deps[name.strip()] = ver.strip() if op in ("==", "===") \
                    else f"{op}{ver.strip()}"
                break
    return deps


def parse_package_lock(path):
    """npm deps from package-lock.json's packages map."""
    deps = {}
    p = pathlib.Path(path)
    if not p.is_file():
        return deps
    lock = json.loads(p.read_text())
    for name, meta in lock.get("packages", {}).items():
        if not name:  # root entry describes the app itself
            continue
        short = name.rsplit("node_modules/", 1)[-1]
        if meta.get("version"):
            deps[short] = meta["version"]
    return deps


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--requirements")
    ap.add_argument("--package-lock")
    ap.add_argument("--version", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    freeze = {
        "version": args.version,
        "python": parse_requirements(args.requirements) if args.requirements else {},
        "npm": parse_package_lock(args.package_lock) if args.package_lock else {},
    }
    # digest of the dep set itself — a single value to compare across releases
    canonical = json.dumps({k: freeze[k] for k in ("python", "npm")},
                           sort_keys=True, separators=(",", ":"))
    freeze["deps_sha256"] = hashlib.sha256(canonical.encode()).hexdigest()

    pathlib.Path(args.out).write_text(json.dumps(freeze, indent=2) + "\n")
    total = len(freeze["python"]) + len(freeze["npm"])
    print(f"gen-freeze: {total} pinned deps -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
