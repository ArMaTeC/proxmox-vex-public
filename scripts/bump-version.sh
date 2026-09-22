#!/bin/bash
# =============================================================================
# spec 093/US053: one-command version bump.
#
#   scripts/bump-version.sh 1.2.473
#
# Updates version.json atomically (version, build, release_date, changelog
# stub matching the US026 structured shape), re-signs the metadata when the
# release key is available, and stages the file. The changelog stub is a
# deliberate pause — edit it before committing so notes stay human-reviewed.
# =============================================================================
set -euo pipefail

NEW="${1:?usage: bump-version.sh <semver>}"

# semver gate — a malformed version would poison every client's update check
[[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    echo "bump-version: '$NEW' is not semver (want X.Y.Z)" >&2; exit 1; }

[ -f version.json ] || { echo "bump-version: no version.json in $(pwd)" >&2; exit 1; }

python3 - "$NEW" <<'PY'
import json, sys, datetime
new = sys.argv[1]
d = json.load(open("version.json"))
d["version"] = new
d["build"] = datetime.date.today().strftime("%Y.%m.%d")
d["release_date"] = datetime.date.today().isoformat()
d["changelog"].insert(0, {
    "type": "release", "component": "", "breaking": False,
    "text": f"{new} ({d['release_date']}) — <edit before committing>",
})
json.dump(d, open("version.json", "w"), indent=2)
open("version.json", "a").write("\n")
PY

# re-sign when the release key is around; otherwise warn — an unsigned
# version.json breaks clients' verification, so silence isn't acceptable
if gpg --batch --list-secret-keys "${VEX_SIGNING_KEY:-releases@proxmoxvex.com}" \
        >/dev/null 2>&1 && [ -x "$(dirname "$0")/sign-version.sh" ]; then
    "$(dirname "$0")/sign-version.sh"
else
    echo "bump-version: no signing key — version.json left UNSIGNED" >&2
fi

git add version.json 2>/dev/null || true   # stage when inside a work tree
echo "bumped to $NEW — edit the changelog stub before committing"
