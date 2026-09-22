#!/bin/bash
# scripts/sign-version.sh — detached-sign version.json over its canonical
# (sorted-key, compact) serialization.
#
# spec 093/US005. Produces version.json.asc. The signature covers canonical
# bytes, not the file's literal formatting, so publishers and verifiers can
# disagree on whitespace without breaking the signature.
#
# Usage:
#   scripts/sign-version.sh [version.json]          # default: ./version.json
#   KEY=<fpr-or-uid> scripts/sign-version.sh        # pick the signing key
set -euo pipefail

DOC="${1:-version.json}"
KEY="${KEY:-ProxmoxVEx Release Signing <releases@proxmoxvex.com>}"

[ -f "$DOC" ] || { echo "sign-version: missing $DOC" >&2; exit 1; }
command -v gpg >/dev/null || { echo "sign-version: gpg required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "sign-version: python3 required" >&2; exit 1; }

CANON=$(mktemp)
trap 'rm -f "$CANON"' EXIT
python3 - "$DOC" "$CANON" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
with open(sys.argv[2], "w") as f:
    f.write(json.dumps(d, sort_keys=True, separators=(",", ":")) + "\n")
PY

gpg --batch --yes -u "$KEY" --detach-sign --armor -o "$DOC.asc" "$CANON"
echo "wrote $DOC.asc (canonical signature by '$KEY')"
