#!/bin/bash
# scripts/rotate-keys.sh — build a countersigned key-rotation document.
#
# spec 093/US004. Produces:
#   keys/rotation.json      — {rotation, old/new fingerprints, effective,
#                              reason, new_pubkey (armored, embedded)}
#   keys/rotation.json.asc  — detached signature made by the OLD key
#
# The OLD key signs the document, so clients that trust it today can
# authenticate its successor — a compromised host alone cannot forge the
# transition without the old private key.
#
# Usage:
#   GNUPGHOME=~/.gnupg scripts/rotate-keys.sh \
#       --old <old-key-fpr-or-email> --new <new-key-fpr-or-email> \
#       [--effective YYYY-MM-DD] [--reason "scheduled rotation"]
#
# After running, commit keys/ and have releases signed by the NEW key
# (scripts/sign-release.sh -u <new-key> ...).
set -euo pipefail

OLD_KEY=""
NEW_KEY=""
EFFECTIVE="$(date +%F)"
REASON="scheduled rotation"
OUT_DIR="keys"

while [ $# -gt 0 ]; do
    case "$1" in
        --old)       OLD_KEY="$2";   shift 2 ;;
        --new)       NEW_KEY="$2";   shift 2 ;;
        --effective) EFFECTIVE="$2"; shift 2 ;;
        --reason)    REASON="$2";    shift 2 ;;
        --out)       OUT_DIR="$2";   shift 2 ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

[ -n "$OLD_KEY" ] && [ -n "$NEW_KEY" ] || {
    echo "usage: $0 --old <keyid> --new <keyid> [--effective DATE] [--reason TEXT]" >&2
    exit 2
}
command -v gpg >/dev/null || { echo "gpg required" >&2; exit 2; }

fingerprint_of() {
    gpg --batch --with-colons -k "$1" | awk -F: '/^fpr/{print $10; exit}'
}

OLD_FPR=$(fingerprint_of "$OLD_KEY")
NEW_FPR=$(fingerprint_of "$NEW_KEY")
[ -n "$OLD_FPR" ] || { echo "old key not found: $OLD_KEY" >&2; exit 1; }
[ -n "$NEW_FPR" ] || { echo "new key not found: $NEW_KEY" >&2; exit 1; }

mkdir -p "$OUT_DIR"
TMP_NEW_PUB=$(mktemp)
gpg --batch --export -a "$NEW_FPR" > "$TMP_NEW_PUB"

python3 - "$OUT_DIR/rotation.json" "$OLD_FPR" "$NEW_FPR" \
        "$EFFECTIVE" "$REASON" "$TMP_NEW_PUB" <<'PY'
import json, sys
out, old, new, eff, reason, pubpath = sys.argv[1:]
doc = {
    "rotation": 1,
    "old_fingerprint": old,
    "new_fingerprint": new,
    "effective": eff,
    "reason": reason,
    "new_pubkey": open(pubpath).read(),
}
with open(out, "w") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
PY
rm -f "$TMP_NEW_PUB"

# The countersignature: the OLD key authenticates its successor.
gpg --batch --yes -u "$OLD_FPR" --detach-sign --armor \
    -o "$OUT_DIR/rotation.json.asc" "$OUT_DIR/rotation.json"

echo "wrote $OUT_DIR/rotation.json + .asc"
echo "  old: $OLD_FPR"
echo "  new: $NEW_FPR"
echo "next: commit keys/, then sign releases with the NEW key:"
echo "      scripts/sign-release.sh -u $NEW_FPR dist/*.tar.gz"
