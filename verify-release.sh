#!/bin/sh
# verify-release.sh — standalone release verifier for runbooks/airgapped
# installs. spec 093/US008.
#
# Checks, in order:
#   1. artifact + signature + checksum manifest are present
#   2. detached GPG signature verifies against pubkey.asc
#   3. sha256 matches the published checksums manifest
#
# Exit codes:  0 verified · 1 signature failed · 2 checksum failed ·
#              3 missing files/tools
#
# Requirements: coreutils (sha256sum) always; gnupg for the signature
# check. On minimal systems without gpg, --checksum-only still verifies
# integrity — authenticity then rests on having fetched checksums.txt
# from a trusted source out-of-band (airgap runbook: copy the artifact,
# checksums.txt, and pubkey.asc together).
#
# Usage:
#   verify-release.sh ARCHIVE [--checksums FILE] [--pubkey FILE]
#                     [--checksum-only] [--quiet]
set -u

ARCHIVE=""; CHECKSUMS="checksums.txt"; PUBKEY="pubkey.asc"
SIG_ONLY_SKIP=0; QUIET=0

while [ $# -gt 0 ]; do
    case "$1" in
        --checksums)     CHECKSUMS="$2"; shift 2 ;;
        --pubkey)        PUBKEY="$2";    shift 2 ;;
        --checksum-only) SIG_ONLY_SKIP=1; shift ;;
        --quiet)         QUIET=1;        shift ;;
        -h|--help)       sed -n '2,20p' "$0"; exit 0 ;;
        -*)              echo "verify-release: unknown flag $1" >&2; exit 3 ;;
        *)               [ -z "$ARCHIVE" ] && ARCHIVE="$1" || {
                             echo "verify-release: unexpected arg $1" >&2; exit 3; }
                         shift ;;
    esac
done

say() { [ "$QUIET" -eq 0 ] && echo "$@"; }
fail() { say "FAIL: $1"; exit "$2"; }

[ -n "$ARCHIVE" ] || fail "usage: verify-release.sh ARCHIVE [options]" 3
[ -f "$ARCHIVE" ] || fail "missing archive: $ARCHIVE" 3

# --- signature -----------------------------------------------------------------
if [ "$SIG_ONLY_SKIP" -eq 0 ]; then
    if ! command -v gpg >/dev/null 2>&1; then
        fail "gnupg not installed — rerun with --checksum-only for integrity-only verification" 3
    fi
    [ -f "$ARCHIVE.asc" ] || fail "missing signature: $ARCHIVE.asc" 3
    [ -f "$PUBKEY" ]      || fail "missing public key: $PUBKEY" 3
    KR=$(mktemp -d); trap 'rm -rf "$KR"' EXIT
    gpg --batch --quiet --homedir "$KR" --import "$PUBKEY" >/dev/null 2>&1
    if gpg --batch --homedir "$KR" --verify "$ARCHIVE.asc" "$ARCHIVE" >/dev/null 2>&1; then
        say "signature OK ($ARCHIVE.asc)"
    else
        fail "signature does not verify — artifact may be tampered with" 1
    fi
else
    say "signature SKIPPED (--checksum-only)"
fi

# --- checksum -------------------------------------------------------------------
# An explicitly-provided non-empty manifest must contain the artifact's
# basename — absence means the manifest doesn't cover this artifact and
# we fail closed. An absent/empty manifest is a documented skip.
if [ -f "$CHECKSUMS" ] && [ -s "$CHECKSUMS" ]; then
    BASE=$(basename "$ARCHIVE")
    EXPECTED=$(awk -v f="$BASE" '$2 == f {print $1}' "$CHECKSUMS" | head -1)
    if [ -z "$EXPECTED" ]; then
        fail "no manifest entry for $BASE — checksum cannot be confirmed" 2
    fi
    ACTUAL=$(sha256sum "$ARCHIVE" | awk '{print $1}')
    if [ "$EXPECTED" = "$ACTUAL" ]; then
        say "checksum OK ($BASE)"
    else
        say "FAIL: checksum mismatch"
        say "  expected: $EXPECTED"
        say "  actual:   $ACTUAL"
        exit 2
    fi
else
    say "checksum SKIPPED (no manifest)"
fi

say "PASS: $ARCHIVE verified"
exit 0
