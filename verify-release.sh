#!/bin/sh
# verify-release.sh — standalone release verifier for runbooks/airgapped
# installs. spec 093/US008; output layer: spec 101 (US031–US050).
#
# Checks, in order:
#   1. artifact + signature + checksum manifest are present
#   2. detached GPG signature verifies against pubkey.asc
#   3. sha256 matches the published checksums manifest
#
# Exit codes:  0 verified · 1 signature failed · 2 checksum failed ·
#              3 missing files/tools · 4 strict-mode skip
#
# Requirements: coreutils (sha256sum) always; gnupg for the signature
# check. On minimal systems without gpg, --checksum-only still verifies
# integrity — authenticity then rests on having fetched checksums.txt
# from a trusted source out-of-band (airgap runbook: copy the artifact,
# checksums.txt, and pubkey.asc together).
#
# Usage:
#   verify-release.sh ARCHIVE [ARCHIVE...] [--checksums FILE] [--pubkey FILE]
#                     [--checksum-only|--offline] [--strict] [--quiet]
#                     [--verbose] [--json] [--version]
set -u
# spec 101/US049: parse-stable tool output regardless of operator locale.
LC_ALL=C; export LC_ALL

CHECKSUMS="checksums.txt"; PUBKEY="pubkey.asc"
SIG_ONLY_SKIP=0; QUIET=0; VERBOSE=0; JSON_OUT=0; STRICT=0
VR_VERSION="1.1.0"

# spec 101/US031: NO_COLOR + non-tty both disable ANSI; errors always go to
# stderr so stdout stays machine-grepable (US048).
if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then
    C_G=''; C_R=''; C_Y=''; C_B=''; C_0=''
else
    C_G='\033[0;32m'; C_R='\033[0;31m'; C_Y='\033[1;33m'; C_B='\033[0;34m'; C_0='\033[0m'
fi
# spec 101/US036: --json suppresses human lines so stdout is pure events.
say()  { [ "$QUIET" -eq 0 ] && [ "$JSON_OUT" -eq 0 ] && printf '%s\n' "$*"; return 0; }
step() { [ "$QUIET" -eq 0 ] && [ "$JSON_OUT" -eq 0 ] && printf "${C_B}[%s]${C_0} %s\n" "$1" "$2"; return 0; }
vlog() { [ "$VERBOSE" -eq 1 ] && printf '    %s\n' "$*"; return 0; }
jevt() { [ "$JSON_OUT" -eq 1 ] && printf '{"check":"%s","result":"%s","detail":"%s"}\n' "$1" "$2" "$(printf '%s' "$3" | sed 's/"/\\"/g')"; return 0; }
fail() {
    printf "${C_R}FAIL:${C_0} %s\n" "$1" >&2
    jevt "$2" fail "$1"
    exit "$3"
}
# US046: human-readable size for the summary line.
humansize() {
    _b=$(wc -c < "$1" 2>/dev/null || echo 0)
    if [ "$_b" -ge 1048576 ]; then printf '%s MB' "$((_b / 1048576))";
    elif [ "$_b" -ge 1024 ]; then printf '%s KB' "$((_b / 1024))";
    else printf '%s B' "$_b"; fi
}

usage() { # US033/US037 — full flag + exit-code reference.
    sed -n '2,26p' "$0"
    cat <<'USAGE'
Additional flags:
  --strict          fail (exit 4) if any check is skipped instead of passing
  --verbose         show gpg/sha256sum output and per-step detail
  --json            one JSON object per check on stdout
  --offline         alias for --checksum-only (airgap readability)
  --version         print verify-release.sh version
  -h, --help        this text
Exit: 0 verified · 1 signature failed · 2 checksum failed · 3 missing/tools · 4 strict skip
USAGE
    exit 0
}

ARCHIVES=""
while [ $# -gt 0 ]; do
    case "$1" in
        --checksums)     CHECKSUMS="$2"; shift 2 ;;
        --pubkey)        PUBKEY="$2";    shift 2 ;;
        --checksum-only|--offline) SIG_ONLY_SKIP=1; shift ;;
        --strict)        STRICT=1;       shift ;;
        --quiet)         QUIET=1;        shift ;;
        --verbose)       VERBOSE=1;      shift ;;
        --json)          JSON_OUT=1;     shift ;;
        --version)       echo "verify-release.sh $VR_VERSION"; exit 0 ;;
        -h|--help)       usage ;;
        -*)              echo "verify-release: unknown flag $1" >&2; usage ;;
        *)               ARCHIVES="$ARCHIVES
$1"; shift ;;
    esac
done
# US040: batch mode — every positional arg is an archive.
ARCHIVES=$(printf '%s\n' "$ARCHIVES" | sed '/^$/d')
[ -n "$ARCHIVES" ] || { echo "verify-release: usage: verify-release.sh ARCHIVE [options]" >&2; exit 3; }

OVERALL=0
for ARCHIVE in $ARCHIVES; do
    [ -f "$ARCHIVE" ] || { printf "${C_R}FAIL:${C_0} missing archive: %s\n" "$ARCHIVE" >&2; OVERALL=3; continue; }
    say "${C_B}== verifying ${C_0}$ARCHIVE ($(humansize "$ARCHIVE"))"

    # --- signature -------------------------------------------------------------
    step 1/3 "GPG signature"
    if [ "$SIG_ONLY_SKIP" -eq 0 ]; then
        if ! command -v gpg >/dev/null 2>&1; then
            # US038/US045: name the fixable cause; strict refuses the skip.
            if [ "$STRICT" -eq 1 ]; then fail "gnupg not installed (strict)" sig 4; fi
            fail "gnupg not installed — rerun with --checksum-only for integrity-only verification" sig 3
        fi
        [ -f "$ARCHIVE.asc" ] || { [ "$STRICT" -eq 1 ] && fail "missing signature $ARCHIVE.asc (strict)" sig 4;
                                   fail "missing signature: $ARCHIVE.asc" sig 3; }
        [ -f "$PUBKEY" ] || { say "  hint: fetch pubkey.asc from the release host or a keyserver";
                              fail "missing public key: $PUBKEY" sig 3; }
        KR=$(mktemp -d); trap 'rm -rf "$KR"' EXIT
        vlog "importing $PUBKEY into scratch keyring"
        gpg --batch --quiet --homedir "$KR" --import "$PUBKEY" >/dev/null 2>&1
        [ "$VERBOSE" -eq 1 ] && gpg --batch --homedir "$KR" --verify "$ARCHIVE.asc" "$ARCHIVE" 2>&1 | sed 's/^/    /'
        if gpg --batch --homedir "$KR" --verify "$ARCHIVE.asc" "$ARCHIVE" >/dev/null 2>&1; then
            say "  ${C_G}signature OK${C_0} ($ARCHIVE.asc)"; jevt sig pass "$ARCHIVE.asc"
        else
            fail "signature does not verify — artifact may be tampered with" sig 1
        fi
        rm -rf "$KR"; trap - EXIT
    else
        if [ "$STRICT" -eq 1 ]; then fail "signature skipped (strict)" sig 4; fi
        say "  ${C_Y}signature SKIPPED${C_0} (--checksum-only)"; jevt sig skip "--checksum-only"
    fi

    # --- checksum ----------------------------------------------------------------
    step 2/3 "SHA-256 checksum"
    if [ -f "$CHECKSUMS" ] && [ -s "$CHECKSUMS" ]; then
        BASE=$(basename "$ARCHIVE")
        EXPECTED=$(awk -v f="$BASE" '$2 == f {print $1}' "$CHECKSUMS" | head -1)
        if [ -z "$EXPECTED" ]; then
            fail "no manifest entry for $BASE — checksum cannot be confirmed" checksum 2
        fi
        _t0=$(date +%s)
        ACTUAL=$(sha256sum "$ARCHIVE" | awk '{print $1}')
        _dt=$(( $(date +%s) - _t0 ))
        if [ "$EXPECTED" = "$ACTUAL" ]; then
            say "  ${C_G}checksum OK${C_0} ($BASE, ${_dt}s)"; jevt checksum pass "$BASE"
        else
            say "  FAIL: checksum mismatch" >&2
            say "    expected: $EXPECTED" >&2
            say "    actual:   $ACTUAL" >&2
            jevt checksum fail "$BASE"
            OVERALL=2; continue
        fi
    else
        if [ "$STRICT" -eq 1 ]; then fail "checksum skipped (strict)" checksum 4; fi
        say "  ${C_Y}checksum SKIPPED${C_0} (no manifest)"; jevt checksum skip "no-manifest"
    fi

    # --- done -------------------------------------------------------------------
    step 3/3 "Result"
    say "${C_G}PASS:${C_0} $ARCHIVE verified"
    jevt result pass "$ARCHIVE"
done
# Exit codes: 0 ok · 1 signature failed · 2 checksum failed · 3 missing/tools · 4 strict skip
case "$OVERALL" in 2) exit 2 ;; *) exit "$OVERALL" ;; esac
