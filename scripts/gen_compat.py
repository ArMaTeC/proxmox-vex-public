#!/usr/bin/env python3
"""gen_compat.py — render the version/platform compatibility matrix from
version.json releases metadata.

Usage: scripts/gen_compat.py [version.json]

Emits a GitHub-flavoured markdown table on stdout, one row per release
(newest first). Checked into docs/compatibility.md — regenerate and paste
(or redirect) when release metadata changes.
"""
import json
import sys


def sort_key(ver):
    return [int(p) if p.isdigit() else 0 for p in ver.split(".")]


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "version.json"
    with open(path) as fh:
        v = json.load(fh)
    rows = []
    for ver, meta in sorted(v.get("releases", {}).items(),
                            key=lambda kv: sort_key(kv[0]), reverse=True):
        platforms = ", ".join(meta.get("platforms", ["linux-x86_64"]))
        eol = meta.get("eol") or "—"
        security = "yes" if meta.get("security") else "—"
        rows.append([ver, f"{meta.get('min_python', '3.8')}+",
                     platforms, eol, security])
    # emit the table in "aligned" style (pipes column-aligned) so the
    # checked-in docs pass markdownlint MD060
    header = ["Version", "Python", "Arch", "EOL", "Security fix"]
    widths = [max(len(c) for c in col) for col in zip(header, *rows)]

    def fmt(row):
        return "| " + " | ".join(
            c.ljust(w) for c, w in zip(row, widths)) + " |"

    sep = "|" + "|".join("-" * (w + 2) for w in widths) + "|"
    print("\n".join([fmt(header), sep, *[fmt(r) for r in rows]]))


if __name__ == "__main__":
    main()
