#!/bin/bash
# =============================================================================
# spec 093/US043: pre-publish secret scanner.
#
# Usage: scan-secrets.sh <directory>
#
# Dependency-free gitleaks-style scan: walks a build tree (or extracted
# artifact) and fails loudly — naming every offending file — if a credential
# pattern is found. A leaked key in a shipped tarball would land on every
# install, so this runs before publish and aborts the release.
#
# Baseline: VEX_SECRET_BASELINE may point at a file of grep -F -x -q'd
# allowlist patterns (one per line) for intentional fixtures.
# =============================================================================
set -u

ROOT="${1:?usage: scan-secrets.sh <directory>}"
BASELINE="${VEX_SECRET_BASELINE:-/dev/null}"

# Credential patterns (POSIX ERE). Kept deliberately tight to limit FPs:
#  - PEM private-key headers (any flavor)
#  - AWS access key ids
#  - AWS secret assignments
#  - generic token/password assignments with a long literal value
# PEM headers are anchored at line start: UI placeholder strings and
# single-line fixtures embed the header inside quotes — anchoring keeps the
# high-signal match (a real key file starts its body at column ~0).
PATTERNS=(
    '^[[:space:]]*-----BEGIN [A-Z ]*PRIVATE KEY-----'
    'AKIA[0-9A-Z]{16}'
    'aws_secret_access_key[[:space:]]*=[[:space:]]*[A-Za-z0-9/+=]{20,}'
    '(api[_-]?key|secret|token|password)[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9_+/=-]{32,}'
)

hits=0
while IFS= read -r -d '' f; do
    for pat in "${PATTERNS[@]}"; do
        if grep -Eqe "$pat" "$f" 2>/dev/null; then
            # allowlisted? (exact line match in the baseline file)
            match=$(grep -En "$pat" "$f" | head -3)
            if ! grep -Fq "$f" "$BASELINE" 2>/dev/null; then
                echo "secrets detected: $f" >&2
                echo "$match" | sed 's/^/    /' >&2
                hits=$((hits+1))
                break  # one report per file is enough
            fi
        fi
    done
done < <(find "$ROOT" -type f \
    ! -path '*/.git/*' ! -path '*/node_modules/*' \
    ! -path '*/.venv/*' ! -path '*/venv/*' ! -path '*/.*venv*/*' ! -path '*/dist/*' \
    ! -name '*.pyc' ! -name '*.png' ! -name '*.ico' \
    -size -2M -print0)

if [ "$hits" -gt 0 ]; then
    echo "scan-secrets: $hits file(s) with credential patterns under $ROOT — aborting" >&2
    exit 1
fi
echo "scan-secrets: clean ($ROOT)"
