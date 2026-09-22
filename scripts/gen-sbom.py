#!/usr/bin/env python3
# scripts/gen-sbom.py — emit a CycloneDX 1.5 SBOM from the project's
# lockfiles. spec 093/US009.
#
# FR-026: components are parsed from requirements.txt and
# package-lock.json — never hand-edited — so the SBOM always reflects
# the shipped dependency set.
#
# Usage:
#   scripts/gen-sbom.py --requirements requirements.txt \
#       --package-lock web/package-lock.json --out dist/sbom.json
#   scripts/gen-sbom.py --out dist/sbom.json   # lockfiles auto-probed
import argparse
import json
import re
import sys


def parse_requirements(path):
    comps = []
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except OSError:
        return comps
    for line in lines:
        line = line.strip()
        if not line or line.startswith(("#", "-")):
            continue
        m = re.match(r"^([A-Za-z0-9_.\-]+)\s*([=<>!~].*)?$", line)
        if not m:
            continue
        name, spec = m.group(1), m.group(2) or ""
        ver = spec[2:].strip() if spec.startswith("==") else None
        comp = {"type": "library", "name": name,
                "purl": f"pkg:pypi/{name.lower()}" + (f"@{ver}" if ver else ""),
                "properties": [{"name": "source", "value": "requirements.txt"}]}
        if ver:
            comp["version"] = ver
            comp["properties"].append({"name": "pinned", "value": "true"})
        else:
            comp["properties"].append({"name": "spec", "value": spec or "any"})
        comps.append(comp)
    return comps


def parse_package_lock(path):
    comps = []
    try:
        data = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        return comps
    for key, meta in (data.get("packages") or {}).items():
        if not key.startswith("node_modules/") or key.count("/") > 1:
            continue  # only top-level deps; nested paths are transitive noise
        name = key.split("node_modules/")[-1]
        ver = (meta or {}).get("version")
        comp = {"type": "library", "name": name,
                "purl": f"pkg:npm/{name}" + (f"@{ver}" if ver else ""),
                "properties": [{"name": "source", "value": "package-lock.json"}]}
        if ver:
            comp["version"] = ver
        comps.append(comp)
    return comps


def main():
    ap = argparse.ArgumentParser(description="CycloneDX SBOM from lockfiles")
    ap.add_argument("--requirements", default="requirements.txt")
    ap.add_argument("--package-lock", default="package-lock.json")
    ap.add_argument("--name", default="ProxmoxVEx")
    ap.add_argument("--version", default=None)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    components = (parse_requirements(args.requirements)
                  + parse_package_lock(args.package_lock))
    components.sort(key=lambda c: (c["name"].lower(), c.get("version", "")))

    bom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {
            "component": {"type": "application", "name": args.name,
                          **({"version": args.version} if args.version else {})},
            "tools": [{"vendor": "ProxmoxVEx", "name": "gen-sbom.py"}],
        },
        "components": components,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(bom, f, indent=2)
        f.write("\n")
    print(f"gen-sbom: {args.out} ({len(components)} components)")


if __name__ == "__main__":
    sys.exit(main())
