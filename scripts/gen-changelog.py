#!/usr/bin/env python3
"""spec 093/US052: auto-generated changelog from conventional commits.

Parses `git log` between two refs for conventional-commit subjects and
emits structured changelog entries matching version.json's object shape
(US026): {"type","component","breaking","text"}.

    feat(api): add delta endpoint
      -> {"type":"feature","component":"api","breaking":false,
          "text":"add delta endpoint"}
    feat!: drop legacy config
      -> same + "breaking": true
    BREAKING CHANGE: footer   -> "breaking": true
    docs:/chore:/ci:/style:/test:/build:  -> excluded

Usage:
    gen-changelog.py --repo . --from v1.2.471 --to HEAD
                     --version 1.2.472 --out cl.json
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys

TYPE_MAP = {
    "feat": "feature", "feature": "feature",
    "fix": "fix", "bugfix": "fix",
    "perf": "performance",
    "refactor": "refactor",
    "revert": "fix",
    "security": "security",
}
# types that never ship in release notes
EXCLUDED = {"docs", "chore", "ci", "style", "test", "build", "merge"}

SUBJECT_RE = re.compile(
    r"^(?P<type>[a-zA-Z]+)(?:\((?P<scope>[^)]*)\))?(?P<bang>!)?:\s*(?P<text>.+)$")


def commits(repo, frm, to):
    rng = f"{frm}..{to}" if frm else to
    out = subprocess.run(
        ["git", "-C", repo, "log", "--format=%s%n%b%x00", rng],
        capture_output=True, text=True)
    if out.returncode != 0:
        print(f"gen-changelog: git log failed: {out.stderr.strip()}",
              file=sys.stderr)
        sys.exit(1)
    return [b for b in out.stdout.split("\x00") if b.strip()]


def parse(subject, body):
    m = SUBJECT_RE.match(subject.strip())
    if not m:
        return None
    t = m.group("type").lower()
    if t in EXCLUDED:
        return None
    breaking = bool(m.group("bang")) or "BREAKING CHANGE" in body \
        or "BREAKING-CHANGE" in body
    return {
        "type": TYPE_MAP.get(t, t),
        "component": m.group("scope") or "",
        "breaking": breaking,
        "text": m.group("text").strip(),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--from", dest="frm", default="")
    ap.add_argument("--to", default="HEAD")
    ap.add_argument("--version", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    entries = []
    for block in commits(args.repo, args.frm, args.to):
        # \x00\n between commits leaves a leading newline — strip first or
        # partition sees an empty subject and drops every commit after the first
        subject, _, body = block.strip().partition("\n")
        e = parse(subject, body)
        if e:
            entries.append(e)

    doc = {"version": args.version, "changelog": entries}
    pathlib.Path(args.out).write_text(json.dumps(doc, indent=2) + "\n")
    print(f"gen-changelog: {len(entries)} entries -> {args.out}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
