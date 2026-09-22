#!/bin/bash
# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        update.sh
# Project:     ProxmoxVEx
# Version:     1.2.453
# Build:       2026.09.14
# Description: Update SH source
# Docs:        https://proxmoxvex.com/docs
# Generated:   2026-09-14
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
# spec 093/US062: abort on any unhandled failure — a mid-pipe error or an
# unbound variable must not let the updater continue on broken state.
# Expected-failure sites carry an explicit `|| true`.
set -euo pipefail
set -o errtrace   # report failures inside command substitutions too

# spec 093/US074: structured failure reports — on an unhandled error the
# ERR trap records {stage,error,from,to,ts} to logs/update-failure.json,
# paths and secrets stripped, and POSTs it only when telemetry is opted in.
fail_record() {
    local stage="${1:-unknown}"
    local err
    err=$(printf '%s' "${2:-}" | sed 's|/[^ "]*||g; s|[A-Za-z0-9_-]\{32,\}||g' | head -c 300)
    local dir="${BASE_DIR:-.}/shared/logs"
    mkdir -p "$dir" 2>/dev/null || dir="${BASE_DIR:-.}/logs"
    mkdir -p "$dir" 2>/dev/null || return 0
    local f="$dir/update-failure.json"
    python3 - "$f" "$stage" "$err" "${CURRENT_VERSION:-?}" "${LATEST_VERSION:-?}" <<'PY' 2>/dev/null || true
import json, sys, datetime
f, stage, err, frm, to = sys.argv[1:6]
json.dump({"stage": stage, "error": err, "from": frm, "to": to,
           "ts": datetime.datetime.now(datetime.timezone.utc).isoformat()},
          open(f, "w"))
PY
    [ "${VEX_TELEMETRY:-0}" = "1" ] || return 0
    curl -fsS --max-time 5 -d @"$f" -H "Content-Type: application/json" \
        "${VEX_TELEMETRY_URL:-https://telemetry.proxmoxvex.com/v1/update-outcome}/failure" \
        >/dev/null 2>&1 || true
}

# spec 093/US097: machine-readable update status — every run outcome lands
# in ${BASE_DIR}/data/update-status.json as {result,from,to,ts,pid} so the
# app UI (and fleet tooling) can poll state instead of parsing logs. The
# write is atomic (tmp + mv) so readers never see a torn file.
write_status() {
    local result="${1:-unknown}"
    [ -n "${BASE_DIR:-}" ] || return 0
    local dir="${BASE_DIR}/data"
    mkdir -p "$dir" 2>/dev/null || return 0
    local tmp="$dir/update-status.json.tmp" f="$dir/update-status.json"
    python3 - "$tmp" "$result" "${CURRENT_VERSION:-?}" "${LATEST_VERSION:-}" "$$" <<'PY' 2>/dev/null || return 0
import json, sys, datetime
tmp, result, frm, to, pid = sys.argv[1:6]
json.dump({"result": result, "from": frm, "to": to, "pid": int(pid),
           "ts": datetime.datetime.now(datetime.timezone.utc).isoformat()},
          open(tmp, "w"))
PY
    mv "$tmp" "$f" 2>/dev/null || true
}

trap 'echo "update.sh FAILED at line $LINENO: $BASH_COMMAND" >&2; \
      fail_record "${STAGE:-unknown}" "$BASH_COMMAND"; \
      write_status "error"' ERR
STAGE="init"

# =============================================================================
# Overview
# =============================================================================
# This script updates an existing ProxmoxVEx installation in place. It is
# normally run from the install directory (e.g. /opt/ProxmoxVEx). The workflow:
#
#   1. Detect the original file ownership for restoration after the update.
#   2. Read the currently installed version from version.json.
#   3. Fetch the latest version from GitHub.
#   4. Confirm with the operator unless this is a same-version re-sync.
#   5. Back up the current application files (not config/ssl/logs/backups).
#   6. Download the new code, preferring the branch archive, then a GitHub
#      Trees API fallback, then an essential-files fallback.
#   7. Verify the archive SHA256 (if a checksum file is published).
#   8. Extract and copy the new tree, preserving the original owner.
#   9. Re-apply restrictive permissions to config and ssl.
#  10. Reinstall Python packages from requirements.txt.
#  11. Restart the systemd service when running as root.
#
# It may be run as root (for auto-restart and ownership restore) or as a normal
# user for a manual update.
# =============================================================================

# Terminal output colors.
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# =============================================================================
# spec 101: operator-facing output layer.
# NO_COLOR / non-tty / dumb TERM all disable ANSI so piped logs stay clean
# (US002/US016/US017). --quiet prints only warnings+errors (US003), --verbose
# adds trace lines (US004), --json emits one JSON object per event (US007).
# =============================================================================
QUIET=0; VERBOSE=0; JSON_OUT=0
if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ] || [ "${TERM:-dumb}" = "dumb" ]; then
    RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
    SYM_OK="OK"; SYM_ERR="FAIL"; SYM_WARN="WARN"
else
    SYM_OK="✓"; SYM_ERR="✗"; SYM_WARN="⚠"
fi

# US027: single point for future i18n of operator strings.
_() { printf '%s' "$1"; }

# US015: VEX_UPDATE_LOG mirrors console output into an operator-named file —
# the built-in update.log is an audit trail, this is a human-readable capture.
if [ -n "${VEX_UPDATE_LOG:-}" ]; then
    exec > >(tee -a "$VEX_UPDATE_LOG") 2>&1
fi

# US026: CI runners get no prompts and collapsible log groups where supported.
CI_MODE=0
if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
    CI_MODE=1
    ASSUME_YES="${ASSUME_YES:-1}"
fi
ci_group() { [ "${GITHUB_ACTIONS:-}" ] && printf '::group::%s\n' "$1"; return 0; }
ci_end()   { [ "${GITHUB_ACTIONS:-}" ] && printf '::endgroup::\n'; return 0; }

_stage_start=0
_json_event() { # US007 — machine-readable stage events for fleet tooling
    [ "$JSON_OUT" = "1" ] || return 0
    printf '{"type":"%s","stage":"%s","msg":"%s","ts":"%s"}\n' \
        "$1" "${STAGE:-init}" "$(printf '%s' "$2" | sed 's/"/\\"/g')" \
        "$(date -u +%FT%TZ)"
}

info()  { [ "$QUIET" = "1" ] && return 0; printf '%s[i]%s %s\n' "$BLUE" "$NC" "$(_ "$1")"; _json_event info "$1"; }
ok()    { [ "$QUIET" = "1" ] && return 0; printf '%s%s%s %s\n' "$GREEN" "$SYM_OK" "$NC" "$(_ "$1")"; _json_event ok "$1"; }
warn()  { printf '%s%s%s %s\n' "$YELLOW" "$SYM_WARN" "$NC" "$(_ "$1")" >&2; _json_event warn "$1"; }
err()   { printf '%s%s%s %s\n' "$RED" "$SYM_ERR" "$NC" "$(_ "$1")" >&2; _json_event error "$1"; }
# US008/US009: stage banners bracket long sections and carry elapsed time.
step()  {
    _elapsed=""
    [ "$_stage_start" != "0" ] && _elapsed=" (+$(( $(date +%s) - _stage_start ))s)"
    _stage_start=$(date +%s)
    [ "$QUIET" = "1" ] && return 0
    [ "$CI_MODE" = "1" ] && ci_group "$1"
    printf '\n%s==>%s %s%s\n' "$BLUE" "$NC" "$(_ "$1")" "$_elapsed"
    _json_event stage "$1"
}
vlog()  { [ "$VERBOSE" = "1" ] && printf '    %s\n' "$1"; return 0; }

usage() { # US005/US029 — self-documenting flags; exits 0 on --help.
    cat <<'USAGE'
update.sh — in-place updater for an existing ProxmoxVEx install.

Usage: ./update.sh [flags]

Flags:
  --help, -h      this text
  --version       print the updater version
  --yes           non-interactive (skip the confirm prompt)
  --dry-run       print what would change; touch nothing
  --atomic        stage into releases/<v> then swap `current` atomically
  --rollback      repoint `current` at the previous release and restart
  --verify        verify a release archive (see --file)
  --verify-files  check the installed tree against its file manifest
  --bundle FILE   update from an offline .vexbundle
  --insecure      disable signature/TLS checks (requires VEX_I_ACCEPT_RISK=1)
  --quiet         only warnings, errors and the final result
  --verbose       extra trace output (commands, byte counts)
  --json          emit one JSON event per stage on stdout

Env:  ProxmoxVEx_BRANCH, VEX_UPDATE_BASE, VEX_MIRROR, VEX_UPDATE_TOKEN,
      VEX_PROXY/VEX_NO_PROXY, VEX_CACERT, VEX_UPDATE_HOLD, NO_COLOR

Exit: 0 updated/nothing-to-do · 1 failure · 2 usage error
USAGE
}
# --help/--version short-circuit before any state is touched.
for _a in "$@"; do
    [ "$_a" = "--help" ] || [ "$_a" = "-h" ] && { usage; exit 0; }
    [ "$_a" = "--version" ] && { echo "update.sh (ProxmoxVEx $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$(dirname "${BASH_SOURCE[0]}")/version.json" 2>/dev/null | head -1 || echo '?'))"; exit 0; }
done

# =============================================================================
# GitHub source selector
# Allow testing branches with:  ProxmoxVEx_BRANCH=Testing sudo ./update.sh
# Default remains main so existing workflows keep working.
# =============================================================================
# (#417 follow-up, elektronen): allow updating from a specific
# branch via `ProxmoxVEx_BRANCH=Testing sudo ./update.sh`. Default still main.
GITHUB_BRANCH="${ProxmoxVEx_BRANCH:-main}"

# Raw content and archive URLs for the selected branch.
# Raw files come from the public GitHub mirror repo; the release archive is
# served by the main site (proxmoxvex.com/downloads).
GITHUB_RAW="https://raw.githubusercontent.com/ArMaTeC/proxmox-vex-public/${GITHUB_BRANCH}"
GITHUB_ARCHIVE="https://proxmoxvex.com/downloads/ProxmoxVEx-latest.tar.gz"

# spec 093/US054: VEX_UPDATE_BASE repoints BOTH endpoints at one base —
# the e2e harness uses it to drive a real update from a local dist/ tree
# (file://) or a staging mirror without editing the script.
if [ -n "${VEX_UPDATE_BASE:-}" ]; then
    GITHUB_RAW="$VEX_UPDATE_BASE"
    GITHUB_ARCHIVE="$VEX_UPDATE_BASE/ProxmoxVEx-latest.tar.gz"
fi

# spec 101/US013/US018/US030: failures name the stage and point at the doc
# section most likely to unblock the operator — not just a bare message.
# NOTE: kept to a single line — tests extract die() with `grep -A2 '^die()'`
# and source it standalone, so the fallback echo keeps it working there.
die() { if command -v err >/dev/null 2>&1; then err "$1"; [ "${STAGE:-init}" != "init" ] && err "  (stage: $STAGE)"; err "  see docs/troubleshooting.md for common fixes"; else echo -e "${RED:-}$1${NC:-}" >&2; fi; [ -n "${BASE_DIR:-}" ] && { fail_record "${STAGE:-unknown}" "$1"; write_status "error"; }; exit 1; }

# =============================================================================
# spec 093/US001: release signature verification.
#
# Every published tarball carries a detached armored GPG signature
# (<file>.asc) made by the release-signing key. The public half ships in
# this repo as pubkey.asc; verification runs in a scratch keyring so an
# operator's own keyring is never touched. A BAD signature is fatal —
# a missing signature/tooling warns and proceeds (same posture as the
# SHA256SUMS check) so pre-signing-era installs keep working.
# VEX_SKIP_SIG_VERIFY=1 opts out explicitly.
# =============================================================================
# SCRIPT_DIR is resolved again below for the install path; it is computed
# here too because --verify can exit before that point is reached.
PUBKEY_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pubkey.asc"
# spec 093/US010: the trust root may live in several places — the shipped
# pubkey.asc beside this script, a key bundled inside a previously
# extracted release (dist/keys/release.pub), or a system-installed copy.
# resolve_pubkey walks that fallback chain so verification still works
# when the repo file is absent (e.g. bare update.sh fetched alone).
INSTALL_DIR="${INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
ETC_DIR="${ETC_DIR:-/etc/proxmoxvex}"
resolve_pubkey() {
    local cand
    for cand in "$PUBKEY_FILE" \
                "${INSTALL_DIR}/dist/keys/release.pub" \
                "${ETC_DIR}/vex-release.pub" \
                "/etc/vex-release.pub"; do
        if [ -f "$cand" ]; then echo "$cand"; return 0; fi
    done
    return 1
}

# verify_signature <archive> <sig>: returns 0 good / 1 bad / 2 unavailable.
verify_signature() {
    local archive="$1" sig="$2"
    if [ "${VEX_SKIP_SIG_VERIFY:-0}" = "1" ]; then
        return 2
    fi
    if ! command -v gpg >/dev/null 2>&1 || [ ! -f "$sig" ]; then
        return 2
    fi
    local KEYFILE
    KEYFILE=$(resolve_pubkey) || return 2
    local KR
    KR=$(mktemp -d)
    gpg --batch --quiet --homedir "$KR" --import "$KEYFILE" >/dev/null 2>&1
    local rc=1
    if gpg --batch --homedir "$KR" --verify "$sig" "$archive" >/dev/null 2>&1; then
        rc=0
    fi
    rm -rf "$KR"
    return $rc
}

# =============================================================================
# spec 093/US004: signing-key rotation.
#
# keys/rotation.json on the downloads host carries the NEXT release pubkey
# embedded inline and is itself signed by the CURRENT trusted key — the old
# key vouches for its successor, so a compromised host can't substitute a
# key it doesn't hold. A forged/unsigned rotation doc is fatal; an absent
# doc means no rotation is in flight and is ignored.
# =============================================================================

# verify_rotation_doc <doc> <sig>: 0 valid+trusted / 1 bad sig / 2 unavailable.
verify_rotation_doc() {
    local doc="$1" sig="$2"
    if ! command -v gpg >/dev/null 2>&1; then
        return 2
    fi
    local KEYFILE
    KEYFILE=$(resolve_pubkey) || return 2
    local KR
    KR=$(mktemp -d)
    gpg --batch --quiet --homedir "$KR" --import "$KEYFILE" >/dev/null 2>&1
    local rc=1
    if gpg --batch --homedir "$KR" --verify "$sig" "$doc" >/dev/null 2>&1; then
        rc=0
    fi
    rm -rf "$KR"
    return $rc
}

# process_key_rotation <base_url> <workdir>: fetch + verify + apply a
# pending rotation. On success the embedded new pubkey replaces pubkey.asc
# on disk (trust persists for the next update too).
process_key_rotation() {
    local base="$1" work="$2"
    local doc="$work/rotation.json" sig="$work/rotation.json.asc"
    curl -sfL "$base/keys/rotation.json" -o "$doc" 2>/dev/null || return 0
    curl -sfL "$base/keys/rotation.json.asc" -o "$sig" 2>/dev/null \
        || die "rotation doc published without a signature — refusing to continue"
    verify_rotation_doc "$doc" "$sig"
    case $? in
        0) ;;
        2) echo -e "${YELLOW}rotation doc present but gpg/pubkey unavailable — ignoring${NC}"; return 0 ;;
        *) die "rotation doc signature FAILED — a forged key rotation was attempted" ;;
    esac
    # Extract the embedded new pubkey to a scratch file first.
    python3 - "$doc" "$work/new-pubkey.asc" <<'PY' || die "rotation doc malformed (no new_pubkey)"
import json, sys
doc, out = sys.argv[1], sys.argv[2]
d = json.load(open(doc))
pub = d.get("new_pubkey", "")
if "BEGIN PGP PUBLIC KEY BLOCK" not in pub:
    sys.exit(1)
with open(out, "w") as f:
    f.write(pub)
PY
    # Confirm the embedded key's real fingerprint matches the doc's claim —
    # a mismatched doc is malformed even when signed, so fail closed.
    local KR2 ACTUAL_FPR CLAIMED_FPR
    KR2=$(mktemp -d)
    gpg --batch --quiet --homedir "$KR2" --import "$work/new-pubkey.asc" >/dev/null 2>&1
    ACTUAL_FPR=$(gpg --batch --homedir "$KR2" --with-colons -k | awk -F: '/^fpr/{print $10; exit}')
    rm -rf "$KR2"
    CLAIMED_FPR=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("new_fingerprint",""))' "$doc")
    [ -n "$ACTUAL_FPR" ] && [ "$ACTUAL_FPR" = "$CLAIMED_FPR" ] \
        || die "rotation doc fingerprint mismatch — refusing new key"
    chmod 600 "$work/new-pubkey.asc"
    mv "$work/new-pubkey.asc" "$PUBKEY_FILE"
    echo -e "${GREEN}✓ key rotation applied${NC} — trust moved to key $ACTUAL_FPR"
}

# =============================================================================
# spec 093/US005: signed version.json. The detached signature covers the
# CANONICAL (sorted-key) serialization, so whitespace/formatting differences
# between publisher and file don't break verification — content does.
# =============================================================================

# canonical_json <in> <out>: sorted-key, compact serialization.
canonical_json() {
    python3 - "$1" "$2" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
with open(sys.argv[2], "w") as f:
    f.write(json.dumps(d, sort_keys=True, separators=(",", ":")) + "\n")
PY
}

# verify_version_metadata <json> <sig>: 0 valid / 1 bad / 2 unavailable.
verify_version_metadata() {
    local doc="$1" sig="$2"
    if ! command -v gpg >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
        return 2
    fi
    local KEYFILE
    KEYFILE=$(resolve_pubkey) || return 2
    local KR CANON rc=1
    KR=$(mktemp -d); CANON="$KR/canonical.json"
    if canonical_json "$doc" "$CANON" 2>/dev/null; then
        gpg --batch --quiet --homedir "$KR" --import "$KEYFILE" >/dev/null 2>&1
        gpg --batch --homedir "$KR" --verify "$sig" "$CANON" >/dev/null 2>&1 && rc=0
    fi
    rm -rf "$KR"
    return $rc
}

# =============================================================================
# spec 093/US007: release transparency log. Every published release appends
# {version, sha256, ts} to transparency.log (signed as transparency.log.asc).
# Divergence is ADVISORY — a swapped artifact is already caught by the
# signature/checksum gates; the log exists so silent post-publish
# replacement is detectable, so we warn but never block the update.
# =============================================================================

# =============================================================================
# spec 093/US013: release channels (stable/beta/lts).
#
# version.json may carry a per-channel pointer table:
#   "channels": {"stable": {"version": ..., "archive": ...}, ...}
# The subscribed channel comes from config/update-channel (persists across
# updates — config/ is never overwritten) or VEX_CHANNEL; default "stable".
# When a channels table exists but the channel is absent we fail closed —
# silently falling back to stable would push non-lts builds at lts users.
# =============================================================================

# resolve_channel_release <doc> <channel>: prints "<version>\t<archive>".
resolve_channel_release() {
    python3 - "$1" "$2" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
ch = sys.argv[2] or "stable"
channels = d.get("channels")
if channels:
    ptr = channels.get(ch)
    if not ptr or not ptr.get("version"):
        sys.exit(1)
    print(f"{ptr['version']}\t{ptr.get('archive', '')}")
    sys.exit(0)
ver = d.get("version")
if not ver:
    sys.exit(1)
print(f"{ver}\t{d.get('archive', '')}")
PY
}

# =============================================================================
# spec 093/US018: version pinning & update hold.
#
# config/update-hold (or VEX_UPDATE_HOLD=1) freezes all updates — clean exit.
# config/update-pin (or VEX_PIN_VERSION) pins the target to an exact version,
# overriding the channel pointer. Pins always install the FULL archive (a
# delta to a non-sequential target may not exist).
# =============================================================================

# resolve_update_target: hold → clean exit; pin → VERSION/ARCHIVE_NAME set.
resolve_update_target() {
    BASE_DIR="${BASE_DIR:-${SCRIPT_DIR:-.}}"
    local hold pin
    hold="${VEX_UPDATE_HOLD:-$(cat "$BASE_DIR/config/update-hold" 2>/dev/null || echo 0)}"
    if [ "$hold" = "1" ] || [ "$hold" = "true" ]; then
        echo "updates held (update-hold) — exiting without changes"
        exit 0
    fi
    PINNED=0
    pin="${VEX_PIN_VERSION:-$(cat "$BASE_DIR/config/update-pin" 2>/dev/null || true)}"
    if [ -n "$pin" ]; then
        VERSION="$pin"
        ARCHIVE_NAME="ProxmoxVEx-$pin.tar.gz"
        DELTA_NAME=""
        PINNED=1
    fi
}

# =============================================================================
# spec 093/US019: maintenance-window gate.
#
# config/update-window or VEX_UPDATE_WINDOW restricts updates to HH:MM-HH:MM.
# Overnight windows (22:00-02:00) are handled; --force bypasses with a log.
# =============================================================================

# in_window: 0 inside/no window configured, 1 outside the window.
in_window() {
    BASE_DIR="${BASE_DIR:-${SCRIPT_DIR:-.}}"
    local window now start end
    window="${UPDATE_WINDOW:-${VEX_UPDATE_WINDOW:-$(cat "$BASE_DIR/config/update-window" 2>/dev/null || true)}}"
    [ -z "$window" ] && return 0
    now="${NOW_OVERRIDE:-$(date +%H:%M)}"
    start="${window%%-*}"; end="${window##*-}"
    if [ "$start" \< "$end" ] || [ "$start" = "$end" ]; then
        [ "$now" \> "$start" ] && [ "$now" \< "$end" ]
    else
        # overnight window: inside if past start OR before end
        [ "$now" \> "$start" ] || [ "$now" \< "$end" ]
    fi
}

# =============================================================================
# spec 093/US024: minimum-source-version gate.
#
# Releases declare min_from — the oldest version they can safely upgrade.
# Clients below it get a named stepping stone (releases.<t>.via) instead of
# a broken jump. Comparison is real semver, not lexicographic (1.10 > 1.9).
# =============================================================================

# version_ge <a> <b>: 0 when a >= b (semver).
version_ge() {
    python3 -c "
import sys
pa = [int(x) for x in '$1'.split('.')]
pb = [int(x) for x in '$2'.split('.')]
n = max(len(pa), len(pb)); pa += [0]*(n-len(pa)); pb += [0]*(n-len(pb))
sys.exit(0 if pa >= pb else 1)
" 2>/dev/null
}

# check_min_from <current> <target> <version.json>: refuse when current is
# below the target's declared minimum; name the stepping stone if provided.
check_min_from() {
    local cur="$1" target="$2" doc="$3"
    [ -f "$doc" ] || return 0
    local min via
    min=$(python3 -c "
import json
r = json.load(open('$doc')).get('releases', {})
print(r.get('$target', {}).get('min_from', ''))
" 2>/dev/null || echo "")
    [ -n "$min" ] || return 0   # no constraint declared → nothing to gate
    version_ge "$cur" "$min" && return 0
    via=$(python3 -c "
import json
r = json.load(open('$doc')).get('releases', {})
print(r.get('$target', {}).get('via', ''))
" 2>/dev/null || true)
    die "cannot jump $cur -> $target; update to ${via:-$min} first"
}

# =============================================================================
# spec 093/US025: security advisory surfacing.
#
# Releases that fix vulnerabilities carry releases.<v>.security{severity,
# advisory}; the updater must flag those distinctly so admins notice urgent
# patches instead of treating them as routine version bumps.
# =============================================================================

# check_security_advisory <target> <version.json>: prints a SECURITY UPDATE
# banner (severity + advisory URL) when the target release fixes vulns.
check_security_advisory() {
    local target="$1" doc="$2"
    [ -f "$doc" ] || return 0
    local sec
    sec=$(python3 -c "
import json
s = json.load(open('$doc')).get('releases', {}).get('$target', {}).get('security') or {}
if s:
    print(s.get('severity', '') + '\t' + s.get('advisory', ''))
" 2>/dev/null || true)
    [ -n "$sec" ] || return 0
    local sev="${sec%%	*}" adv="${sec##*	}"
    echo "*** SECURITY UPDATE ($sev) — $adv ***" >&2
}

# spec 093/US073: stale-version advisory — count published releases newer
# than the installed one and how many of them carry security fixes, so
# admins see at a glance how far behind they are.
warn_stale_version() {
    local doc="$1" cur="$2"
    [ -f "$doc" ] || return 0
    python3 - "$doc" "$cur" <<'PY' 2>/dev/null || true
import json, sys, re
doc, cur = sys.argv[1], sys.argv[2]
def vt(v):
    return [int(x) for x in re.findall(r"\d+", v)[:3]]
try:
    rels = json.load(open(doc)).get("releases", {})
except Exception:
    sys.exit(0)
newer = [v for v in rels
         if re.match(r"^\d+\.\d+", v) and vt(v) > vt(cur)]
sec = sum(1 for v in newer if rels[v].get("security"))
if newer:
    print(f"  note: you are {len(newer)} release(s) behind "
          f"({sec} security-relevant)")
PY
}

# =============================================================================
# spec 093/US041: transport security.
#
# Update endpoints must be https:// — a plaintext http:// base would let any
# on-path attacker serve a forged release before signature checks even run.
# file:// is allowed for airgap/bundle mode (already verified locally).
# VEX_CACERT supplies a private CA bundle via CURL_CA_BUNDLE (libcurl env).
# =============================================================================

# assert_update_scheme <url>: die unless https:// or file://.
assert_update_scheme() {
    case "$1" in
        https://*|file://*) return 0 ;;
        *) die "update endpoint must be https:// (got $1)" ;;
    esac
}

# =============================================================================
# spec 093/US042: --insecure double-gate.
#
# Disabling signature+TLS verification is catastrophic if it happens by
# accident (a copied command, a stale comment). The flag alone is never
# enough: VEX_I_ACCEPT_RISK=1 must be set deliberately in the environment,
# the run is announced loudly, and the incident log records it.
# =============================================================================

# enforce_insecure_gate: called early when --insecure was passed.
enforce_insecure_gate() {
    [ "${INSECURE:-}" = "1" ] || return 0
    [ "${VEX_I_ACCEPT_RISK:-}" = "1" ] || die \
        "--insecure requires VEX_I_ACCEPT_RISK=1 in the environment (disables signature+TLS verification)"
    echo "!!! WARNING: update verification DISABLED by --insecure + VEX_I_ACCEPT_RISK=1 !!!" >&2
    log_update "INSECURE update initiated — signature+TLS verification disabled"
    export VEX_SKIP_SIG_VERIFY=1
}

# =============================================================================
# spec 093/US040: parallel .tar.zst artifacts.
#
# Releases ship both gzip and zstd tarballs; zstd decompresses ~4x faster at
# smaller size. Hosts with zstd prefer .tar.zst, everyone else gets .tar.gz.
# =============================================================================

# pick_archive_ext: echoes ".tar.zst" or ".tar.gz" by tool availability.
pick_archive_ext() {
    if command -v zstd >/dev/null 2>&1; then
        echo ".tar.zst"
    else
        echo ".tar.gz"
    fi
}

# untar_release <archive> <dest>: extract .tar.gz or .tar.zst transparently.
untar_release() {
    local archive="$1" dest="$2"
    case "$archive" in
        *.tar.zst|*.tzst) zstd -dc "$archive" 2>/dev/null | tar -x -C "$dest" ;;
        *)                tar -xzf "$archive" -C "$dest" ;;
    esac
}

# =============================================================================
# spec 093/US037: latency-based mirror selection.
#
# Among reachable mirrors, pick the fastest measured — listed order is a
# preference hint, not a performance guarantee. VEX_MIRROR still wins.
# =============================================================================

# pick_mirror_latency <version.json> <default_base>: echoes lowest-latency
# reachable base; nonzero if none respond.
pick_mirror_latency() {
    local doc="$1" default="$2"
    # explicit operator choice always wins, no probing needed
    if [ -n "${VEX_MIRROR:-}" ]; then
        echo "$VEX_MIRROR"
        return 0
    fi
    local mirrors base ms best="" bestms=999999
    mirrors=$(python3 -c "
import json
try:
    for m in json.load(open('$doc')).get('mirrors', []): print(m)
except Exception: pass
" 2>/dev/null)
    for base in $mirrors "$default"; do
        [ -n "$base" ] || continue
        # US041: https/file only — http mirrors allowed solely under the
        # confirmed --insecure mode (internal networks, test fixtures).
        case "$base" in
            https://*|file://*) ;;
            http://*) [ "${INSECURE:-}" = "1" ] || continue ;;
            *) continue ;;
        esac
        # NOTE: -w prints even on failure — only trust the timing on rc 0
        ms=$(curl -o /dev/null -fsS --max-time 5 -w '%{time_total}' \
                "$base/version.json" 2>/dev/null) || continue
        [ -n "$ms" ] || continue
        ms=$(awk "BEGIN{print int($ms*1000)}")
        if [ "$ms" -lt "$bestms" ]; then
            bestms=$ms; best=$base
        fi
    done
    [ -n "$best" ] || return 1
    echo "$best"
    echo "mirror latency pick: $best (${bestms}ms)" >&2
    return 0
}

# =============================================================================
# spec 093/US032: resumable downloads.
#
# A 200MB+ tarball on a flaky link must not restart at byte 0 after a drop.
# curl -C - resumes from the partial file's size; the .done marker prevents
# re-validating an already-complete fetch on retry runs.
# =============================================================================

# spec 093/US049: optional TLS public-key pinning. VEX_TLS_PIN pins the dist
# host's cert pubkey — a valid-CA MITM (compromised or coerced CA) then can't
# intercept update traffic. VEX_TLS_PIN_BACKUP keeps the pin valid through
# the operator's next cert rotation.
curl_pin_args() {
    [ -n "${VEX_TLS_PIN:-}" ] || return 0
    if [ -n "${VEX_TLS_PIN_BACKUP:-}" ]; then
        printf '%s\n' "--pinnedpubkey sha256//${VEX_TLS_PIN},sha256//${VEX_TLS_PIN_BACKUP}"
    else
        printf '%s\n' "--pinnedpubkey sha256//${VEX_TLS_PIN}"
    fi
}

# spec 093/US046: VEX_UPDATE_TOKEN authenticates artifact downloads — the
# enterprise channel (deploy/nginx.conf /downloads/enterprise/) 401s without
# it. Empty when unset so plain public fetches carry no header.
# spec 093/US050: the token may also live in config/dist-token (mode 0600)
# instead of the environment — env vars leak into /proc/<pid>/environ and
# crash dumps; a root-owned 0600 file doesn't.
load_update_token() {
    [ -n "${VEX_UPDATE_TOKEN:-}" ] && return 0   # env wins
    local f="${BASE_DIR:-.}/config/dist-token"
    [ -f "$f" ] || return 0
    [ "$(stat -c%a "$f" 2>/dev/null)" = "600" ] || {
        echo "warn: $f must be mode 0600 — ignoring" >&2; return 0; }
    VEX_UPDATE_TOKEN=$(cat "$f")
}
# curl_secret_conf: the bearer token must never appear on a command line —
# /proc/<pid>/cmdline is readable by every local user. We hand it to curl
# via a -K config file (mode 0600, in our 0700 temp dir) instead.
curl_secret_conf() {
    [ -n "${VEX_UPDATE_TOKEN:-}" ] || return 0
    [ -n "${_CURL_CONF:-}" ] && { printf '%s\n' "$_CURL_CONF"; return 0; }
    _CURL_CONF=$(mktemp "${TMPDIR:-/tmp}/curl-conf.XXXXXX")
    chmod 600 "$_CURL_CONF"
    printf 'header = "Authorization: Bearer %s"\n' "$VEX_UPDATE_TOKEN" > "$_CURL_CONF"
    printf '%s\n' "$_CURL_CONF"
}

# fetch_resume <url> <out>: resume partial downloads; retries transient
# failures; touches <out>.done only after a complete transfer.
fetch_resume() {
    local url="$1" out="$2"
    if [ -f "$out.done" ] && [ -f "$out" ]; then
        return 0
    fi
    # US034: optional bandwidth cap for shared links (e.g. VEX_DOWNLOAD_LIMIT=1m).
    local rate=()
    [ -n "${VEX_DOWNLOAD_LIMIT:-}" ] && rate=(--limit-rate "$VEX_DOWNLOAD_LIMIT")
    # US046/US050: bearer token via -K conf file — never on the cmdline.
    local auth=()
    local _conf; _conf=$(curl_secret_conf)
    [ -n "$_conf" ] && auth=(-K "$_conf")
    # US049: TLS pubkey pin for high-security installs.
    local pin=()
    [ -n "${VEX_TLS_PIN:-}" ] && \
        pin=(--pinnedpubkey "sha256//${VEX_TLS_PIN}${VEX_TLS_PIN_BACKUP:+,sha256//${VEX_TLS_PIN_BACKUP}}")
    if curl -fSL -C - --retry 3 --retry-delay 2 --retry-all-errors \
            "${rate[@]}" "${auth[@]}" "${pin[@]}" -o "$out" "$url" 2>/dev/null; then
        touch "$out.done"
        return 0
    fi
    return 1
}

# =============================================================================
# spec 093/US029: python compatibility gate.
#
# Releases declare min_python (and optionally max_python); the updater checks
# the interpreter that would run the app BEFORE downloading — a refused
# upgrade is cheap here and expensive after a half-applied install.
# =============================================================================

# check_python_compat <version.json> [pyver]: die unless local python satisfies
# min_python/max_python. pyver defaults to the python3 on PATH.
check_python_compat() {
    local doc="$1" pyv="${2:-}"
    [ -f "$doc" ] || return 0
    if [ -z "$pyv" ]; then
        pyv=$(python3 -c "import sys;print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo 0.0)
    fi
    python3 - "$doc" "$pyv" <<'PY'
import json, sys
def t(v):
    try: return tuple(int(x) for x in str(v).split(".")[:3])
    except Exception: return (0,)
doc, pyv = sys.argv[1], t(sys.argv[2])
d = json.load(open(doc))
lo, hi = d.get("min_python"), d.get("max_python")
if lo and pyv < t(lo):
    print(f"FAIL: requires python >= {lo}, have {sys.argv[2]}"); sys.exit(1)
if hi and pyv > t(hi):
    print(f"FAIL: requires python <= {hi}, have {sys.argv[2]}"); sys.exit(1)
sys.exit(0)
PY
    [ $? -eq 0 ] || die "python version incompatible with this release (see above)"
}

# =============================================================================
# spec 093/US028: declared artifact sizes.
#
# releases.<v>.size_bytes (and channels.<c>.size_bytes) let preflight size the
# download without a network HEAD probe — important for airgapped/bundle mode
# and for refusing early when disk space is short.
# =============================================================================

# declared_size <version.json> <version>: echoes byte size or empty.
declared_size() {
    local doc="$1" ver="$2"
    [ -f "$doc" ] || return 0
    python3 -c "
import json
d = json.load(open('$doc'))
rel = d.get('releases', {}).get('$ver', {})
ch = next((c for c in d.get('channels', {}).values() if c.get('version') == '$ver'), {})
sz = rel.get('size_bytes') or ch.get('size_bytes') or ''
print(sz)
" 2>/dev/null || true
}

# =============================================================================
# spec 093/US027: mirror failover.
#
# version.json may list mirror base URLs; VEX_MIRROR env takes top priority.
# Each candidate is HEAD-probed for the archive before use — a dead primary
# must not kill the update when a mirror has the bits.
# =============================================================================

# select_mirror <version.json> <archive_name> <default_base>: echoes the
# first reachable base URL (preferred env → listed mirrors → default).
select_mirror() {
    local doc="$1" archive="$2" default_base="$3"
    local mirrors base
    mirrors=$(python3 -c "
import json
try:
    for m in json.load(open('$doc')).get('mirrors', []): print(m)
except Exception: pass
" 2>/dev/null)
    for base in ${VEX_MIRROR:-} $mirrors "$default_base"; do
        [ -n "$base" ] || continue
        # US041: https/file only — http mirrors allowed solely under the
        # confirmed --insecure mode (internal networks, test fixtures).
        case "$base" in
            https://*|file://*) ;;
            http://*) [ "${INSECURE:-}" = "1" ] || continue ;;
            *) continue ;;
        esac
        local _auth=() _conf
        _conf=$(curl_secret_conf); [ -n "$_conf" ] && _auth=(-K "$_conf")
        if curl -fsSI --max-time 10 "${_auth[@]}" "$base/$archive" -o /dev/null 2>/dev/null; then
            echo "$base"
            return 0
        fi
    done
    return 1
}

# =============================================================================
# spec 093/US026: structured changelog surfacing.
#
# changelog entries are objects {type, component, breaking, text}; the updater
# scans them so breaking changes are shown BEFORE the admin commits to the
# install, not discovered after.
# =============================================================================

# warn_breaking_changes <version.json>: list entries flagged breaking:true.
warn_breaking_changes() {
    local doc="$1"
    [ -f "$doc" ] || return 0
    python3 - "$doc" <<'PY' >&2
import json, sys
try:
    entries = json.load(open(sys.argv[1])).get("changelog", [])
except Exception:
    sys.exit(0)
breaking = [e for e in entries if isinstance(e, dict) and e.get("breaking")]
if breaking:
    print("*** BREAKING CHANGES in this release ***")
    for e in breaking:
        comp = e.get("component", "core")
        print(f"  - [{comp}] {e.get('text', '')}")
PY
    return 0
}

# spec 093/US083: 'changes since your version' preview before the confirm.
#
# changelog entries embed their release at the head of `text`
# ("1.2.472 (2026-09-19) - ..."); show only entries newer than the installed
# version so the admin sees exactly what this update brings — breaking ones
# flagged. Silent when the changelog carries nothing newer or is absent.
#
# show_changelog <version.json> <current_version>
show_changelog() {
    local doc="$1" cur="${2:-}"
    [ -f "$doc" ] || return 0
    python3 - "$doc" "$cur" <<'PY' >&2
import json, re, sys

def key(v):
    return [int(p) if p.isdigit() else 0 for p in v.split(".")]

try:
    entries = json.load(open(sys.argv[1])).get("changelog", [])
except Exception:
    sys.exit(0)
cur = sys.argv[2]
newer = []
for e in entries:
    if not isinstance(e, dict):
        continue
    text = e.get("text", "")
    m = re.match(r"\s*(\d+(?:\.\d+)+)", text)
    if m and cur and key(m.group(1)) <= key(cur):
        continue
    flag = "!! BREAKING " if e.get("breaking") else "   "
    newer.append(f"{flag}{text}")
if newer:
    print("Changes since your version:")
    for line in newer[:40]:
        print(f"  {line}")
    if len(newer) > 40:
        print(f"  ... and {len(newer) - 40} more")
PY
    return 0
}

# =============================================================================
# spec 093/US094: defensive metadata parse.
#
# A truncated mirror reply, a hostile doc, or a junk payload must abort
# with a named parse/validation failure — not a python traceback into a
# misleading "no release" die. Bounded size + required-keys check, run
# before any consumer parses the doc.
#
# validate_version_doc <version.json>
validate_version_doc() {
    local doc="$1"
    [ -f "$doc" ] || return 0
    local size
    size=$(stat -c %s "$doc" 2>/dev/null || stat -f %z "$doc" 2>/dev/null || echo 0)
    [ "${size:-0}" -lt 1048576 ] || die "version.json too large (${size} bytes) — refusing untrusted metadata"
    python3 - "$doc" <<'PY' || die "version.json malformed or missing required keys"
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    assert isinstance(d, dict), "not an object"
    assert isinstance(d.get("version"), str) and d["version"], "version"
    assert isinstance(d.get("channels"), dict), "channels"
except SystemExit:
    raise
except Exception as e:
    print(f"version.json invalid: {e}", file=sys.stderr)
    sys.exit(1)
PY
}

# =============================================================================
# spec 093/US023: EOL advisory.
#
# version.json's releases map carries support_until per release; when the
# INSTALLED version has passed that date, warn — running EOL software is a
# security posture problem, but the update should still proceed (advisory).
# =============================================================================

# check_eol <version> <version.json>: warn when version's support window ended.
check_eol() {
    local ver="$1" doc="$2"
    [ -f "$doc" ] || return 0
    local eol
    eol=$(python3 -c "
import json, sys
r = json.load(open('$doc')).get('releases', {})
print(r.get('$ver', {}).get('support_until', ''))
" 2>/dev/null || true)
    [ -n "$eol" ] || return 0
    local today="${TODAY_OVERRIDE:-$(date +%F)}"
    if [ "$today" \> "$eol" ]; then
        echo "WARNING: installed version $ver left support on $eol — upgrade recommended" >&2
    fi
}

# =============================================================================
# spec 093/US022: per-file drift detection.
#
# Each release embeds MANIFEST.sha256 (every shipped file, minus config/data
# operator paths). --verify-files checks the installed tree against it and
# names any file that drifted — post-install tamper detection for auditors.
# =============================================================================

# verify_installed_files <dir>: sha256sum -c the release manifest; nonzero
# and prints the drifted paths when any file fails.
verify_installed_files() {
    local dir="${1:-${SCRIPT_DIR:-.}}"
    local manifest="$dir/MANIFEST.sha256"
    [ -f "$manifest" ] || die "no MANIFEST.sha256 in $dir — release predates manifests"
    local bad
    bad=$(cd "$dir" && sha256sum -c MANIFEST.sha256 2>/dev/null | grep -v ': OK$' || true)
    if [ -n "$bad" ]; then
        echo "DRIFTED FILES:"
        echo "$bad"
        return 1
    fi
    echo "all files verified against MANIFEST.sha256"
    return 0
}

# =============================================================================
# spec 093/US020: airgap bundle.
#
# A .vexbundle carries the tarball, its signature, checksums, version.json and
# the standalone verifier — everything needed to update with zero network.
# apply_bundle verifies the tarball with the bundled verify-release.sh, then
# points the normal download pipeline at file:// URLs so signature, checksum
# and metadata verification all run unchanged, fully offline.
# =============================================================================

# apply_bundle <bundle.vexbundle> <workdir>: extract → verify → set
# BUNDLE_DIR, ARCHIVE, LATEST_VERSION; repoint GITHUB_RAW/GITHUB_ARCHIVE.
apply_bundle() {
    local bundle="$1" work="${2:-$(mktemp -d)}"
    BUNDLE_DIR="$work/bundle"
    mkdir -p "$BUNDLE_DIR"
    tar -xzf "$bundle" -C "$BUNDLE_DIR" 2>/dev/null || die "cannot extract bundle: $bundle"

    local tarball=""
    for tarball in "$BUNDLE_DIR"/*.tar.gz; do
        [ -e "$tarball" ] || { tarball=""; break; }
        case "$tarball" in *vexbundle*) continue ;; esac
        break
    done
    [ -n "$tarball" ] || die "bundle contains no release tarball"

    # Verify with the bundled verifier; --checksum-only when the bundle
    # carries no detached signature (unsigned/airgapped builds).
    if [ -x "$BUNDLE_DIR/verify-release.sh" ]; then
        local vargs=""
        [ -f "$tarball.asc" ] || vargs="--checksum-only"
        (cd "$BUNDLE_DIR" && ./verify-release.sh "$(basename "$tarball")" $vargs) \
            || die "bundle verification failed"
    else
        (cd "$BUNDLE_DIR" && sha256sum -c checksums.txt) >/dev/null 2>&1 \
            || die "bundle checksum verification failed"
    fi

    # Hand the verified artifacts to the normal pipeline via file:// — the
    # signature/checksum/metadata checks then run unchanged, offline.
    GITHUB_RAW="file://$BUNDLE_DIR"
    GITHUB_ARCHIVE="file://$tarball"
    ARCHIVE="$tarball"
    LATEST_VERSION=$(python3 -c "import json;print(json.load(open('$BUNDLE_DIR/version.json'))['version'])" 2>/dev/null || true)
    [ -n "$LATEST_VERSION" ] || die "bundle version.json unreadable"
    DECLARED_SIZE=$(declared_size "$BUNDLE_DIR/version.json" "$LATEST_VERSION")
}

# check_transparency <log> <sha256>: 0 listed / 1 not listed / 2 unusable.
check_transparency() {
    local log="$1" hash="$2"
    [ -f "$log" ] && [ -n "$hash" ] || return 2
    grep -q "\"$hash\"" "$log" && return 0
    return 1
}

# =============================================================================
# spec 093/US011: atomic update application.
#
# --atomic switches to a releases/<version> layout: the archive extracts to
# a STAGING dir (never over the live tree), shared mutable state is
# symlinked in from shared/, and activation is a single atomic symlink
# rename (current.tmp → current). An interrupted run leaves either the old
# release live or an orphaned stage — never a half-copied tree.
# =============================================================================

# check_disk_space [needed_kb]: is there room to stage a second tree?
# shellcheck disable=SC2120  # arg is optional — defaults to 200MB
check_disk_space() {
    local need_kb="${1:-204800}" avail
    avail=$(df -Pk "$BASE_DIR" 2>/dev/null | awk 'NR==2{print $4}')
    [ -n "$avail" ] && [ "$avail" -ge "$need_kb" ]
}

# atomic_stage <archive> <version>: extract into releases/<ver> via a
# temp sibling — the release dir appears fully-formed or not at all.
atomic_stage() {
    local archive="$1" version="$2"
    local dest="$BASE_DIR/releases/$version"
    local tmp="$BASE_DIR/releases/.stage-$version"
    mkdir -p "$BASE_DIR/releases"
    rm -rf "$tmp" "$dest"
    mkdir -p "$tmp"
    if ! untar_release "$archive" "$tmp" 2>/dev/null; then
        rm -rf "$tmp"; return 1
    fi
    # GitHub-style archives wrap everything in one top dir — flatten it so
    # the release root holds the tree directly.
    local n single=""
    n=$(find "$tmp" -mindepth 1 -maxdepth 1 | wc -l)
    if [ "$n" -eq 1 ]; then
        for single in "$tmp"/*; do break; done
        if [ -d "$single" ]; then
            # flatten the wrapper dir: move its contents (incl. dotfiles)
            # up to the stage root, then drop the empty wrapper.
            find "$single" -mindepth 1 -maxdepth 1 -exec mv -t "$tmp" {} +
            rmdir "$single"
        fi
    fi
    normalize_modes "$tmp"
    mv "$tmp" "$dest"
}

# spec 093/US048: normalize_modes <dir> — a tarball built on a permissive
# host (or hand-rolled) must not land world-writable or over-open modes on
# the install: dirs 755, files 644, executables 755, secrets 600.
normalize_modes() {
    local dir="$1"
    # world-writable / over-open dirs and files get swept to safe baselines
    find "$dir" -type d -exec chmod 755 {} + 2>/dev/null
    find "$dir" -type f -exec chmod 644 {} + 2>/dev/null
    # executables get their bit back: anything in bin/ or with a shebang
    find "$dir" -type f \( -path '*/bin/*' -o -name '*.sh' \) \
        -exec chmod 755 {} + 2>/dev/null
    # secrets tighten past the 644 baseline
    find "$dir" -type f \( -name '*.key' -o -name '*.pem' -o -name '.env' \
        -o -name '*.env' \) -path '*/config/*' -exec chmod 600 {} + 2>/dev/null
}

# wire_shared_state <release_dir>: mutable state lives in shared/, the
# release sees it through symlinks — a swap never moves operator data.
wire_shared_state() {
    local rel="$1" d
    # List inlined (not $SHARED_DIRS) so the function is self-contained —
    # runbooks/tests extract it standalone from this script.
    for d in config data logs plugins; do
        mkdir -p "$BASE_DIR/shared/$d"
        # first atomic install: seed shared/ from the release's shipped
        # defaults instead of clobbering them with an empty dir.
        if [ -d "$rel/$d" ] && [ -z "$(ls -A "$BASE_DIR/shared/$d" 2>/dev/null)" ]; then
            cp -a "$rel/$d/." "$BASE_DIR/shared/$d/" 2>/dev/null || true
        fi
        rm -rf "${rel:?}/$d"
        ln -sfn "$BASE_DIR/shared/$d" "$rel/$d"
    done
}

# atomic_swap <version>: the only live mutation — build the new symlink
# under a temp name, then rename over `current` in one atomic step.
atomic_swap() {
    local version="$1"
    local target="$BASE_DIR/releases/$version"
    [ -d "$target" ] || return 1
    # spec 093/US012: remember who was live so --rollback can repoint
    # `current` without guessing from directory contents.
    if [ -f "$BASE_DIR/.active-version" ]; then
        cp "$BASE_DIR/.active-version" "$BASE_DIR/.previous-version"
    fi
    ln -sfn "$target" "$BASE_DIR/current.tmp"
    mv -T "$BASE_DIR/current.tmp" "$BASE_DIR/current"
    echo "$version" > "$BASE_DIR/.active-version"
    # US064: the swap is the commit point — audit it (manual rollback also
    # funnels through here, so both directions get logged).
    log_update "swap: activated $version"
}

# atomic_update <archive> <version>: stage → wire → swap, fail-closed at
# each step so a failure mid-way leaves the old release serving.
atomic_update() {
    local archive="$1" version="$2"
    # BASE_DIR defaults to the install root (SCRIPT_DIR), overridable for tests.
    BASE_DIR="${BASE_DIR:-$SCRIPT_DIR}"
    check_disk_space || die "insufficient disk space to stage $version (need ~200MB free)"
    echo -n "Staging release $version... "
    atomic_stage "$archive" "$version" || die "failed to stage $version"
    echo -e "${GREEN}OK${NC}"
    wire_shared_state "$BASE_DIR/releases/$version"
    # spec 093/US088: fault-injection hook — pause between staging and the
    # swap so tests can SIGKILL at exactly the staged-not-swapped point.
    # 9>&-: the child must NOT inherit the update-lock fd — a killed -9
    # updater must release the flock, not leave it pinned by a stray child.
    sleep "${VEX_PAUSE_AFTER_STAGE:-0}" 9>&-
    atomic_swap "$version" || die "activation failed"
    echo -e "${GREEN}✓ activated $version${NC} (atomic swap — previous release retained in releases/)"
}

# =============================================================================
# spec 093/US017: concurrent-update prevention.
#
# flock (not a pidfile): the lock lives in the kernel's open-file table, so
# a killed -9 updater releases automatically and the next run can reclaim.
# The .holder sidecar records pid+start time for humans diagnosing a stall.
# Defined BEFORE the --rollback dispatch so rollback paths can take it too.
# =============================================================================

# acquire_update_lock: exclusive flock on .update.lock; aborts with the
# holder's pid/started info when another update is in progress.
acquire_update_lock() {
    BASE_DIR="${BASE_DIR:-${SCRIPT_DIR:-.}}"
    exec 9>"$BASE_DIR/.update.lock"
    if ! flock -n 9; then
        local holder
        holder=$(cat "$BASE_DIR/.update.lock.holder" 2>/dev/null || echo unknown)
        die "another update in progress ($holder)"
    fi
    echo "pid=$$ started=$(date -Is)" > "$BASE_DIR/.update.lock.holder"
    trap 'rm -f "$BASE_DIR/.update.lock.holder" 2>/dev/null' EXIT
}

# =============================================================================
# spec 093/US012: one-command rollback.
#
# `update.sh --rollback` repoints `current` at .previous-version's release
# dir. Every rollback appends an audit line to shared/logs/rollback.log.
# DB state: if the previous release ships a downgrade hook we run it,
# otherwise we restore the newest pre-update pg dump under backups/ when
# pg_restore is available; when neither exists the operator is told to
# restore the database manually — the file swap still completes.
# =============================================================================

# log_update <msg>: append-only audit trail (US064) next to rollback.log —
# every update stage (check/download/verify/swap/rollback) lands one
# timestamped line with the version transition. Rotates at >1MB so the
# log can never fill the disk. Best-effort: never blocks the update.
# Defined BEFORE the --rollback dispatch so rollback paths can log too.
log_update() {
    local msg="$1" dir="$BASE_DIR/shared/logs"
    mkdir -p "$dir" 2>/dev/null || dir="$BASE_DIR/logs"
    mkdir -p "$dir" 2>/dev/null || return 0
    local ulog="$dir/update.log"
    if [ -f "$ulog" ] && [ "$(stat -c%s "$ulog" 2>/dev/null || echo 0)" -gt 1048576 ]; then
        mv "$ulog" "$ulog.1" 2>/dev/null || true
    fi
    printf '%s v%s->%s update %s\n' "$(date -u +%FT%TZ)" \
        "${CURRENT_VERSION:-?}" "${LATEST_VERSION:-?}" "$msg" >> "$ulog" 2>/dev/null || true
}

# spec 093/US071: opt-in outcome telemetry. Anonymous (versions+result+ms
# only — no hostnames, ids, or paths), POSTed best-effort so a failed ping
# can never break an update. Off unless VEX_TELEMETRY=1 is set explicitly.
report_outcome() {
    [ "${VEX_TELEMETRY:-0}" = "1" ] || return 0
    local url="${VEX_TELEMETRY_URL:-https://telemetry.proxmoxvex.com/v1/update-outcome}"
    curl -fsS --max-time 5 -X POST "$url" \
        -H "Content-Type: application/json" \
        -d "{\"from\":\"${CURRENT_VERSION:-?}\",\"to\":\"${LATEST_VERSION:-?}\",\"result\":\"$1\",\"ms\":${2:-0}}" \
        >/dev/null 2>&1 || true
}

# log_rollback <message>: audit trail, best-effort (never blocks rollback).
log_rollback() {
    local msg="$1" dir="$BASE_DIR/shared/logs"
    mkdir -p "$dir" 2>/dev/null || dir="$BASE_DIR/logs"
    mkdir -p "$dir" 2>/dev/null || return 0
    printf '%s rollback %s\n' "$(date -u +%FT%TZ)" "$msg" >> "$dir/rollback.log" 2>/dev/null || true
}

rollback_release() {
    # SCRIPT_DIR isn't assigned yet on the early --rollback dispatch —
    # resolve the install root from our own path instead (US062 -u safe).
    BASE_DIR="${BASE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
    acquire_update_lock   # US017: rollback mutates state — serialize it too
    local prev
    prev=$(cat "$BASE_DIR/.previous-version" 2>/dev/null || true)
    [ -n "$prev" ] || die "no previous version recorded — nothing to roll back to"
    local target="$BASE_DIR/releases/$prev"
    [ -d "$target" ] || die "release directory missing: $target"

    # DB revert, best-effort per FR-034: prefer the release's own downgrade
    # hook, else the newest pre-update dump under backups/.
    if [ -x "$target/install.sh" ]; then
        "$target/install.sh" --downgrade-db \
            || echo -e "${YELLOW}db downgrade hook failed — verify database state manually${NC}"
    else
        local dump
        # || true: no backups dir / no dumps is expected — dump stays empty
        # and the else-branch tells the operator to restore manually.
        dump=$(ls -1t "$BASE_DIR"/backups/*.dump "$BASE_DIR"/backups/**/*.dump 2>/dev/null | head -1 || true)
        if [ -n "$dump" ] && command -v pg_restore >/dev/null 2>&1; then
            echo -e "${YELLOW}restoring pre-update database dump: $dump${NC}"
            pg_restore --clean --if-exists -d "${VEX_DB_URL:-proxmoxvex}" "$dump" \
                || echo -e "${YELLOW}pg_restore failed — verify database state manually${NC}"
        else
            echo -e "${YELLOW}no db downgrade hook or restorable dump — revert DB manually if the update ran migrations${NC}"
        fi
    fi

    local from_ver
    from_ver=$(cat "$BASE_DIR/.active-version" 2>/dev/null || echo unknown)
    atomic_swap "$prev" || die "rollback swap failed for $prev"
    log_rollback "to=$prev from=$from_ver"
    CURRENT_VERSION="$from_ver" LATEST_VERSION="$prev" write_status "rolled-back"
    echo -e "${GREEN}✓ rolled back to $prev${NC} — restart services to serve it"
}

# --rollback mode: reactivate the previous release and exit.
if [ "${1:-}" = "--rollback" ]; then
    rollback_release
    exit $?
fi

# =============================================================================
# spec 093/US016: post-update verification + auto-rollback.
#
# After the service restarts, poll health for a bounded window (default
# 300s — DB migrations may take minutes). A failed window rolls back
# automatically, guarded by a marker file so one incident can trigger at
# most ONE auto-rollback (no ping-pong if the rollback also comes up bad).
# =============================================================================

# wait_for_health <url> [timeout_s]: poll until healthy or deadline.
wait_for_health() {
    local url="$1" timeout="${2:-${HEALTH_TIMEOUT:-300}}" deadline
    deadline=$(( $(date +%s) + timeout ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        # 9>&-: probe children must not inherit the update-lock fd, or a
        # SIGKILL during the health wait leaves the flock pinned by strays.
        if curl -fsS --max-time 5 "$url" 2>/dev/null 9>&- | grep -q 'ok'; then
            return 0
        fi
        sleep 5 9>&-
    done
    return 1
}

# auto_rollback <failed_version> <reason>: guarded auto-rollback — the
# marker refuses a second attempt in the same incident and the refusal is
# itself logged for the audit trail.
auto_rollback() {
    BASE_DIR="${BASE_DIR:-$SCRIPT_DIR}"
    local failed="$1" reason="$2"
    local marker="$BASE_DIR/shared/.auto-rollback-done"
    if [ -f "$marker" ]; then
        log_update "auto-rollback REFUSED (already attempted): failed=$failed reason=$reason"
        echo -e "${RED}auto-rollback already attempted — manual intervention required${NC}"
        return 1
    fi
    mkdir -p "$BASE_DIR/shared" 2>/dev/null || true
    echo "$failed" > "$marker" 2>/dev/null || true
    log_update "auto-rollback: failed=$failed reason=$reason"
    report_outcome fail "$(( $(date +%s%3N 2>/dev/null || echo 0) - ${UPDATE_T0:-0} ))"
    rollback_release
}

# =============================================================================
# spec 093/US014: delta packages. version.json may map an installed version
# to a smaller delta archive ("deltas": {"<from>": {"archive": ...}}). The
# delta artifact goes through the SAME signature+checksum gates as a full
# release; after applying, the whole tree is re-verified against the
# manifest's target file map. Any failure falls back to the full archive.
# =============================================================================

# resolve_delta <doc> <from_version>: prints the delta archive basename.
resolve_delta() {
    python3 - "$1" "$2" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
ptr = (d.get("deltas") or {}).get(sys.argv[2])
if not ptr or not ptr.get("archive"):
    sys.exit(1)
print(ptr["archive"])
PY
}

# apply_delta <delta_dir> <install_dir>: copy changed files, delete
# removed. Operator-data paths get the same exclusions as the file copy
# path — a delta must never touch config/, ssl/, logs/ or secrets.
apply_delta() {
    local ddir="$1" dest="$2"
    python3 - "$ddir" "$dest" <<'PY'
import fnmatch, json, os, shutil, sys
ddir, dest = sys.argv[1], sys.argv[2]
meta = json.load(open(os.path.join(ddir, "delta-manifest.json")))
SKIP = ("config/*", "ssl/*", "logs/*", "backups/*", ".git/*",
        "*.db", "*.pem", "*.key", "*.crt", "*.enc")
def skip(rel):
    return any(fnmatch.fnmatchcase(rel, pat) for pat in SKIP)
for rel in meta.get("changed", []):
    if skip(rel):
        continue
    src = os.path.join(ddir, rel)
    dst = os.path.join(dest, rel)
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    shutil.copyfile(src, dst)
for rel in meta.get("removed", []):
    if skip(rel):
        continue
    p = os.path.join(dest, rel)
    if os.path.isfile(p) or os.path.islink(p):
        os.remove(p)
PY
}

# verify_delta_tree <install_dir> <manifest>: every manifest file must
# hash-match — skipped operator paths are exempt by the same filter.
verify_delta_tree() {
    python3 - "$1" "$2" <<'PY'
import fnmatch, hashlib, json, os, sys
root, mpath = sys.argv[1], sys.argv[2]
meta = json.load(open(mpath))
SKIP = ("config/*", "ssl/*", "logs/*", "backups/*", ".git/*",
        "*.db", "*.pem", "*.key", "*.crt", "*.enc")
def skip(rel):
    return any(fnmatch.fnmatchcase(rel, pat) for pat in SKIP)
for rel, want in meta.get("files", {}).items():
    if skip(rel):
        continue
    p = os.path.join(root, rel)
    if not os.path.isfile(p):
        sys.exit(1)
    with open(p, "rb") as f:
        if hashlib.sha256(f.read()).hexdigest() != want:
            sys.exit(1)
sys.exit(0)
PY
}

# =============================================================================
# spec 093/US068: platform/arch gate — version.json may declare a
# `platforms` allowlist (default x86_64+aarch64). An unsupported `uname -m`
# is refused before any download, naming the supported list.
check_platform() {
    local doc="$1" arch supported
    arch=$(uname -m)
    supported=$(python3 -c "
import json
try:
    d = json.load(open('$doc'))
    for p in d.get('platforms', ['x86_64', 'aarch64']): print(p)
except Exception:
    print('x86_64'); print('aarch64')
" 2>/dev/null)
    if ! echo "$supported" | grep -qx "$arch"; then
        die "unsupported architecture $arch (supported: $(echo $supported | tr '\n' ' '))"
    fi
    # musl vs glibc: optional platforms_<libc> metadata — absence is a note,
    # not a refusal.
    local libc=glibc
    [ -f /etc/alpine-release ] && libc=musl
    python3 -c "
import json,sys
d=json.load(open('$doc'))
sys.exit(0 if d.get('platforms_$libc') else 1)
" 2>/dev/null || echo "  note: no ${libc}-specific build metadata; assuming compatible"
}

# spec 093/US015: pre-update preflight — runs BEFORE any artifact download.
# Disk space (2.5x the archive: download+extract+backup), current app
# health, and required tools. --force overrides health/disk failures but
# logs a warning; tool absence always aborts (nothing can proceed).
# =============================================================================

preflight_tools() {
    local missing="" t
    for t in curl tar sha256sum python3; do
        command -v "$t" >/dev/null 2>&1 || missing="$missing $t"
    done
    [ -z "$missing" ] || die "missing required tools:$missing"
}

# preflight_diskspace <needed_bytes>: free space under the install dir.
preflight_diskspace() {
    local need_b="$1" avail_kb
    avail_kb=$(df -Pk "${BASE_DIR:-${SCRIPT_DIR:-.}}" 2>/dev/null | awk 'NR==2{print $4}')
    [ -n "$avail_kb" ] || return 0   # can't measure → don't block
    [ $((avail_kb * 1024)) -ge "$need_b" ]
}

preflight_health() {
    local url="${HEALTH_URL:-http://localhost:8080/api/healthz}"
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
        return 0
    fi
    if [ "${FORCE:-0}" = "1" ]; then
        echo -e "${YELLOW}preflight warn: app health check failed — continuing because --force was given${NC}"
        return 0
    fi
    return 1
}

preflight_update() {
    preflight_tools
    # Size the download: prefer the metadata-declared size_bytes (US028 —
    # captured into DECLARED_SIZE before the metadata doc is discarded);
    # fall back to a HEAD probe.
    local size need
    size="${DECLARED_SIZE:-}"
    if [ -z "$size" ]; then
        size=$(curl -fsSI "$GITHUB_ARCHIVE" 2>/dev/null | awk 'tolower($1)=="content-length:"{print $2}' | tr -d '\r' | tail -1)
    fi
    need=$(( ${size:-0} * 5 / 2 ))
    [ "$need" -le 0 ] && need=524288000
    if ! preflight_diskspace "$need"; then
        if [ "${FORCE:-0}" = "1" ]; then
            echo -e "${YELLOW}preflight warn: low disk space — continuing because --force was given${NC}"
        else
            die "insufficient disk space: need ~$((need / 1024 / 1024))MB free (download+extract+backup); re-run with --force to override"
        fi
    fi
    preflight_health || die "app health check failed — fix the service or re-run with --force"
}

# --verify mode: `update.sh --verify [--file archive.tgz]` validates a
# release artifact against its published signature and exits — the
# operator's independent check without running the updater.
if [ "${1:-}" = "--verify" ]; then
    VERIFY_FILE=""
    while [ $# -gt 1 ]; do
        case "$2" in
            --file) VERIFY_FILE="$3"; shift 2 ;;
            *) shift ;;
        esac
    done
    if [ -z "$VERIFY_FILE" ]; then
        # relative to this script's directory — the dist host layout
        VERIFY_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dist/ProxmoxVEx-latest.tar.gz"
    fi
    [ -f "$VERIFY_FILE" ] || die "verify: no such archive: $VERIFY_FILE"
    [ -f "$VERIFY_FILE.asc" ] || die "verify: no signature: $VERIFY_FILE.asc"
    verify_signature "$VERIFY_FILE" "$VERIFY_FILE.asc"
    case $? in
        0) echo -e "${GREEN}signature OK${NC}: $VERIFY_FILE"; exit 0 ;;
        2) die "verify: gpg or pubkey.asc unavailable (VEX_SKIP_SIG_VERIFY set?)" ;;
        *) die "signature verification FAILED: $VERIFY_FILE" ;;
    esac
fi

# spec 093/US022: --verify-files checks the installed tree against the
# release's per-file manifest — catches post-install drift/tampering.
if [ "${1:-}" = "--verify-files" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    verify_installed_files "$SCRIPT_DIR"
    exit $?
fi

# spec 093/US011: --atomic opts into the releases/<ver> + current-symlink
# layout instead of copying files over the live tree.
ATOMIC=0
FORCE=0
BUNDLE_MODE=0
BUNDLE_FILE=""
DRY_RUN=0
_prev=""
for _arg in "$@"; do
    [ "$_arg" = "--atomic" ] && ATOMIC=1
    [ "$_arg" = "--force" ]  && FORCE=1
    [ "$_arg" = "--yes" ]    && ASSUME_YES=1
    [ "$_arg" = "--insecure" ] && INSECURE=1
    [ "$_arg" = "--dry-run" ]  && DRY_RUN=1
    [ "$_arg" = "--quiet" ]    && QUIET=1
    [ "$_arg" = "--verbose" ]  && VERBOSE=1
    [ "$_arg" = "--json" ]     && JSON_OUT=1
    [ "$_arg" = "--bundle" ] && BUNDLE_MODE=1
    [ "$_prev" = "--bundle" ] && BUNDLE_FILE="$_arg"
    _prev="$_arg"
done

# US071: outcome duration baseline (opt-in telemetry reports elapsed ms).
UPDATE_T0=$(date +%s%3N 2>/dev/null || date +%s000)

# Locate the installation directory and move into it. update.sh is expected to
# live at the root of the installation tree.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || { echo "cannot enter install dir $SCRIPT_DIR" >&2; exit 1; }
BASE_DIR="$SCRIPT_DIR"

# US041: refuse plaintext endpoints and honor a private CA bundle BEFORE any
# network request is made.
assert_update_scheme "$GITHUB_RAW"
assert_update_scheme "$GITHUB_ARCHIVE"
[ -n "${VEX_CACERT:-}" ] && export CURL_CA_BUNDLE="$VEX_CACERT"

# spec 093/US067: corporate proxy support. curl honors HTTPS_PROXY/NO_PROXY
# natively — we only map the operator-facing VEX_* names onto them and make
# sure localhost always bypasses. The proxy VALUE is never logged: proxy
# URLs routinely embed credentials.
if [ -n "${VEX_PROXY:-}" ]; then
    export HTTPS_PROXY="$VEX_PROXY"
fi
export NO_PROXY="${VEX_NO_PROXY:-${NO_PROXY:-localhost,127.0.0.1}}"
[ -n "${HTTPS_PROXY:-}" ] && echo "  (routing update traffic via configured proxy)"

# US042: --insecure needs an explicit env confirmation; armed here so the
# incident is logged before any verification is skipped.
enforce_insecure_gate

# US050: resolve the download token — env wins; config/dist-token (0600)
# fills in for operators who don't want secrets in the environment.
load_update_token

# US092: a non-root run on a root-owned install must fail up front naming
# the fix — not die mid-apply on a permission error.
if [ "$DRY_RUN" != "1" ] && [ ! -w "$BASE_DIR" ]; then
    die "no write access to $BASE_DIR — run as the install owner or with sudo"
fi

# US017: take the exclusive lock before doing anything mutating — a second
# updater bails out here with the holder's pid instead of racing us.
# US065: --dry-run mutates nothing, so it takes no lock.
[ "$DRY_RUN" != "1" ] && acquire_update_lock

# US019: outside the maintenance window, defer cleanly (force bypasses).
if ! in_window; then
    if [ "$FORCE" = "1" ]; then
        echo "⚠ --force: bypassing maintenance window ($(date +%H:%M))"
    else
        echo "outside update window — update deferred (use --force to override)"
        exit 0
    fi
fi

# US020: airgap bundle — extract+verify the bundle, then let the normal
# pipeline run against its contents via file:// (fully offline).
if [ "$BUNDLE_MODE" = "1" ]; then
    [ -f "$BUNDLE_FILE" ] || die "--bundle requires a .vexbundle file path"
    apply_bundle "$BUNDLE_FILE" "$(mktemp -d)"
fi

# Determine the owner of the existing install so we can restore it after the
# update. This matters because the update may be run with sudo and would
# otherwise leave files owned by root.
ORIGINAL_OWNER=""
if [ -d "config" ]; then
    ORIGINAL_OWNER=$(stat -c '%U:%G' config 2>/dev/null || stat -f '%Su:%Sg' config 2>/dev/null)
elif [ -f "cert.pem" ]; then
    ORIGINAL_OWNER=$(stat -c '%U:%G' cert.pem 2>/dev/null || stat -f '%Su:%Sg' cert.pem 2>/dev/null)
elif [ -d "ssl" ]; then
    ORIGINAL_OWNER=$(stat -c '%U:%G' ssl 2>/dev/null || stat -f '%Su:%Sg' ssl 2>/dev/null)
fi

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║               ProxmoxVEx Update Script                       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Warn about privileges and note that root is needed for service auto-restart.
if [ "$EUID" -eq 0 ]; then
    echo -e "${BLUE}Running as root${NC}"
    if [ -n "$ORIGINAL_OWNER" ]; then
        echo -e "  Will restore ownership to: ${GREEN}$ORIGINAL_OWNER${NC}"
    fi
    echo ""
else
    echo -e "${YELLOW}Tip: sudo ./update.sh for auto service restart${NC}"
    echo ""
fi

# Read the currently installed version from the local version.json.
CURRENT_VERSION="unknown"
if [ -f "version.json" ]; then
    CURRENT_VERSION=$(grep -o '"version": *"[^"]*"' version.json | cut -d'"' -f4)
fi
# atomic installs may not carry a version.json at the root — the
# .active-version marker is the ground truth there.
if [ "$CURRENT_VERSION" = "unknown" ] && [ -f ".active-version" ]; then
    CURRENT_VERSION=$(cat .active-version)
fi
echo -e "Current version: ${BLUE}$CURRENT_VERSION${NC}"

# Fetch the latest version from the branch's version.json on GitHub.
STAGE="check"
step "Check for updates"
echo -n "Checking for updates... "
VERSION_DOC=$(mktemp)
VERSION_SIG=$(mktemp)
# spec 093/US072: report the installed version on the check so the dist
# host can aggregate fleet distribution. http(s) only — file:// treats a
# query string as a literal path and the fetch would fail.
FROM_QS=""
case "$GITHUB_RAW" in https://*|http://*) FROM_QS="?from=$CURRENT_VERSION" ;; esac
curl -sfL "$GITHUB_RAW/version.json$FROM_QS" -o "$VERSION_DOC" 2>/dev/null || true
# spec 093/US005: verify the detached signature over the canonical doc
# BEFORE parsing — untrusted metadata must not drive the update decision.
if curl -sfL "$GITHUB_RAW/version.json.asc" -o "$VERSION_SIG" 2>/dev/null; then
    vmd_rc=0; verify_version_metadata "$VERSION_DOC" "$VERSION_SIG" || vmd_rc=$?
    case $vmd_rc in
        0) ;;
        2) echo -e "${YELLOW}(metadata signature unverifiable — gpg/pubkey missing)${NC} " ;;
        *) rm -f "$VERSION_DOC" "$VERSION_SIG"
           die "untrusted version metadata — version.json signature FAILED" ;;
    esac
else
    echo -e "${YELLOW}(no version.json.asc published — unverified)${NC} "
fi
# spec 093/US094: parse+shape check before any consumer reads the doc —
# a hostile or truncated payload dies here with a named validation error.
validate_version_doc "$VERSION_DOC"

# spec 093/US013: pick the subscribed channel's pointer. config/update-
# channel lives in config/ so it survives every update; VEX_CHANNEL env
# overrides for one-off switches.
# || true: a missing update-channel file is expected — channel falls back
# to stable; under pipefail the cat failure would otherwise abort here.
CHANNEL="${VEX_CHANNEL:-$(cat config/update-channel 2>/dev/null | tr -d '[:space:]' || true)}"
CHANNEL="${CHANNEL:-stable}"
RESOLVED=$(resolve_channel_release "$VERSION_DOC" "$CHANNEL") \
    || { rm -f "$VERSION_DOC" "$VERSION_SIG"; die "no release for channel '$CHANNEL' published"; }
LATEST_VERSION="${RESOLVED%%	*}"
CHANNEL_ARCHIVE="${RESOLVED##*	}"
if [ -n "$CHANNEL_ARCHIVE" ]; then
    GITHUB_ARCHIVE="${GITHUB_ARCHIVE%/*}/$CHANNEL_ARCHIVE"
fi
# spec 093/US014: is there a published delta for the installed version?
DELTA_NAME=$(resolve_delta "$VERSION_DOC" "$CURRENT_VERSION" 2>/dev/null || true)

# spec 093/US023: warn if the installed release is past its support window.
check_eol "$CURRENT_VERSION" "$VERSION_DOC"

# spec 093/US018: pin/hold overrides the channel-resolved target. Resolve
# this BEFORE the min_from gate so a pin is checked against its own floor.
VERSION="$LATEST_VERSION"; ARCHIVE_NAME="$CHANNEL_ARCHIVE"
resolve_update_target   # exits cleanly on hold; sets VERSION/ARCHIVE_NAME on pin
if [ "$PINNED" = "1" ]; then
    LATEST_VERSION="$VERSION"
    GITHUB_ARCHIVE="${GITHUB_ARCHIVE%/*}/$ARCHIVE_NAME"
fi

# spec 093/US024: refuse jumps from below the target's declared min_from.
check_min_from "$CURRENT_VERSION" "$LATEST_VERSION" "$VERSION_DOC"
# spec 093/US029: refuse targets the local interpreter can't run.
check_python_compat "$VERSION_DOC"
# spec 093/US068: refuse targets the local arch isn't built for.
check_platform "$VERSION_DOC"
# spec 093/US025: flag security releases distinctly before proceeding.
check_security_advisory "$LATEST_VERSION" "$VERSION_DOC"
# spec 093/US026: surface breaking changes before the admin commits.
warn_breaking_changes "$VERSION_DOC"
# spec 093/US083: 'changes since your version' preview before the confirm.
show_changelog "$VERSION_DOC" "$CURRENT_VERSION"
# spec 093/US073: tell the admin how far behind the installed release is.
warn_stale_version "$VERSION_DOC" "$CURRENT_VERSION"
# spec 093/US064: audit the check stage — every update run leaves a
# timestamped trail even when it stops before downloading.
log_update "check: current=$CURRENT_VERSION target=$LATEST_VERSION channel=$CHANNEL"
# spec 093/US028: capture declared size before the doc is discarded; preflight
# uses it instead of a network HEAD probe.
DECLARED_SIZE=$(declared_size "$VERSION_DOC" "$LATEST_VERSION")
# spec 093/US040: prefer .tar.zst when the host has zstd AND the release
# advertises one; otherwise stay on .tar.gz.
if [ "$BUNDLE_MODE" != "1" ] && [ "$(pick_archive_ext)" = ".tar.zst" ] \
        && python3 -c "
import json,sys
d=json.load(open('$VERSION_DOC'))
fmts=d.get('formats',[])
sys.exit(0 if any('zst' in f for f in fmts) else 1)
" 2>/dev/null; then
    GITHUB_ARCHIVE="${GITHUB_ARCHIVE%.tar.gz}.tar.zst"
    ARCHIVE_NAME="${ARCHIVE_NAME%.tar.gz}.tar.zst"
fi

# spec 093/US027+US037: pick the lowest-latency reachable mirror, then sanity
# check the archive is actually there; fall back to the ordered probe.
# probe_mirror_archive <base> <basename>: is the archive reachable on this
# mirror? Bearer token (if any) goes via -K conf, never on the cmdline.
probe_mirror_archive() {
    local base="$1" name="$2"
    local _conf; _conf=$(curl_secret_conf)
    local auth=()
    [ -n "$_conf" ] && auth=(-K "$_conf")
    curl -fsSI --max-time 10 "${auth[@]}" "$base/$name" -o /dev/null 2>/dev/null
}

if [ "$BUNDLE_MODE" != "1" ]; then
    ARCHIVE_BASENAME=$(basename "$GITHUB_ARCHIVE")
    MIRROR_BASE=$(pick_mirror_latency "$VERSION_DOC" "${GITHUB_ARCHIVE%/*}") \
        && probe_mirror_archive "$MIRROR_BASE" "$ARCHIVE_BASENAME" \
        || MIRROR_BASE=$(select_mirror "$VERSION_DOC" "$ARCHIVE_BASENAME" "${GITHUB_ARCHIVE%/*}") \
        || { rm -f "$VERSION_DOC" "$VERSION_SIG"; die "no reachable mirror for $ARCHIVE_BASENAME"; }
    GITHUB_ARCHIVE="$MIRROR_BASE/$ARCHIVE_BASENAME"
fi
rm -f "$VERSION_DOC" "$VERSION_SIG"

# spec 093/US065: --dry-run prints the resolved plan and exits before any
# mutation — no lock, no backup, no staging dir, no download. Preflight
# still runs because it is read-only and validates the environment.
if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] would update $CURRENT_VERSION -> $LATEST_VERSION"
    echo "[dry-run] archive: $(basename "$GITHUB_ARCHIVE") (${DECLARED_SIZE:-unknown} bytes)"
    echo "[dry-run] steps: fetch, verify, stage to releases/$LATEST_VERSION, swap, restart, health-check"
    preflight_update
    echo "[dry-run] preflight passed — no changes made"
    exit 0
fi

if [ -z "$LATEST_VERSION" ]; then
    echo -e "${RED}Failed${NC}"
    die "could not reach the update server — check the ProxmoxVEx mirror"
fi

echo -e "${GREEN}OK${NC}"
echo -e "Latest version:  ${GREEN}$LATEST_VERSION${NC}"
echo ""

# 2026-06-07: never skip on version-equality. A prior interrupted/partial
# update can leave version.json bumped while some code files stayed stale — and
# the old "already on latest → exit" path then meant `./update.sh` could NEVER
# heal it (you had to know about --force). We now ALWAYS download the archive and
# re-apply the FULL tree, so every run guarantees every file is actually in sync.
RESYNC=0
if [ "$CURRENT_VERSION" == "$LATEST_VERSION" ]; then
    RESYNC=1
    echo -e "${GREEN}✓ Already on $LATEST_VERSION${NC} — re-syncing all files anyway so nothing can be left stale."
    echo ""
fi

# Confirm only for an actual version change. A same-version re-sync just proceeds
# (you explicitly ran the updater and re-applying the full tree is idempotent).
if [ "$RESYNC" -eq 0 ]; then
    echo -e "${YELLOW}Ready to update from $CURRENT_VERSION to $LATEST_VERSION${NC}"
    echo ""
    if [ "${ASSUME_YES:-0}" = "1" ]; then
        echo "Continuing (--yes)"
    else
        # US066: automation runs without a TTY must fail loudly — a silent
        # EOF-cancel looks identical to "user said no" otherwise.
        [ -t 0 ] || die "interactive confirmation required; pass --yes for automation"
        read -p "Continue? [y/N] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Update cancelled."
            exit 2
        fi
    fi
fi

echo ""
echo -e "${YELLOW}Updating...${NC}"

# Back up the current application files before touching them. User data under
# config/, ssl/, logs/, and backups/ is intentionally left out of the backup.
BACKUP_DIR="${SCRIPT_DIR}/backups/backup_${CURRENT_VERSION}_$(date +%Y%m%d_%H%M%S)"
echo -n "Creating backup in $BACKUP_DIR... "
mkdir -p "$BACKUP_DIR"

# Backup important files (not config - that stays)
[ -f "ProxmoxVEx_multi_cluster.py" ] && cp ProxmoxVEx_multi_cluster.py "$BACKUP_DIR/"
[ -d "ProxmoxVEx" ] && cp -r ProxmoxVEx "$BACKUP_DIR/"
[ -f "web/index.html" ] && mkdir -p "$BACKUP_DIR/web" && cp web/index.html "$BACKUP_DIR/web/"
[ -f "web/index.html.original" ] && cp web/index.html.original "$BACKUP_DIR/web/"
[ -f "version.json" ] && cp version.json "$BACKUP_DIR/"
[ -f "requirements.txt" ] && cp requirements.txt "$BACKUP_DIR/"

echo -e "${GREEN}OK${NC}"

# spec 093/US063: the file backup above deliberately excludes mutable state
# (config/, ssl/, data/) — those dirs are exactly what a rollback needs, so
# snapshot them separately into a timestamped pre-update tarball. Kept to
# the last 5 so state backups can't grow without bound.
backup_state() {
    local bk
    bk="$BASE_DIR/backups/pre-update-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$bk"
    tar -czf "$bk/state.tgz" -C "$BASE_DIR" \
        config ssl data 2>/dev/null || true
    # a memberless tarball (all paths missing) is still a valid gzip, so
    # -s alone can't catch it — require at least one archived entry.
    tar -tzf "$bk/state.tgz" 2>/dev/null | grep -q . \
        || die "state backup failed: no config/ssl/data to snapshot"
    # || true: nothing to prune yet is expected; ls fails under pipefail.
    ls -1dt "$BASE_DIR"/backups/pre-update-* 2>/dev/null | tail -n +6 | xargs -r rm -rf || true
}
backup_state
echo -e "  State snapshot:  ${BLUE}$(ls -1dt "$BASE_DIR"/backups/pre-update-* | head -1)/state.tgz${NC}"

# spec 093/US069: garbage-collect releases/ after a successful swap. Keep
# the RELEASES_KEEP newest (default 3) plus always the active release and
# the one-step rollback target — the prune can never strand the install.
gc_releases() {
    local keep="${RELEASES_KEEP:-3}" base="$BASE_DIR/releases"
    [ -d "$base" ] || return 0
    local current="" prev=""
    current=$(cat "$BASE_DIR/.active-version" 2>/dev/null || true)
    prev=$(cat "$BASE_DIR/.previous-version" 2>/dev/null || true)
    # || true: empty releases/ is fine; ls fails under pipefail otherwise.
    ls -1dt "$base"/*/ 2>/dev/null | tail -n "+$((keep+1))" | while read -r d; do
        v=$(basename "$d")
        { [ "$v" = "$current" ] || [ "$v" = "$prev" ]; } && continue
        rm -rf "${d:?}" && log_update "pruned old release $v"
    done || true
}

# spec 093/US070: operator hooks — executable scripts in hooks.d/ run after
# the swap with (old,new) version args. A failing hook warns but never
# aborts; output is captured into the update log for the audit trail.
run_post_hooks() {
    local hooks="$BASE_DIR/hooks.d"
    [ -d "$hooks" ] || return 0
    local dir="$BASE_DIR/shared/logs"
    [ -d "$dir" ] || dir="$BASE_DIR/logs"
    mkdir -p "$dir" 2>/dev/null || dir=""
    local h
    for h in "$hooks"/*; do
        [ -x "$h" ] || continue
        # 9>&-: hooks must not inherit the update-lock fd — a hook that
        # daemonizes would pin the flock forever.
        if [ -n "$dir" ]; then
            "$h" "$CURRENT_VERSION" "$LATEST_VERSION" >>"$dir/update.log" 2>&1 9>&- \
                || echo "WARN: hook $h failed (rc=$?)" >&2
        else
            "$h" "$CURRENT_VERSION" "$LATEST_VERSION" >/dev/null 2>&1 9>&- \
                || echo "WARN: hook $h failed (rc=$?)" >&2
        fi
    done
}

# =============================================================================
STAGE="download"
step "Download release"
# Download the new release
# The primary path is the branch .tar.gz archive from GitHub. If that is not
# available, we fall back to the GitHub Trees API to enumerate every blob in the
# branch and then fetch each file individually. If the Trees API is also
# unreachable, we fall back to a hard-coded list of essential files.
# =============================================================================
echo ""

# spec 093/US047: hardened temp handling. The temp dir carries a signed
# release archive plus trust material (pubkey, version doc, signatures) —
# it must be private from creation (pinned umask, 0700 mode) and always
# removed, including on failure and signal paths.
OLD_UMASK=$(umask); umask 077
TMPDIR=$(mktemp -d /tmp/vex-update.XXXXXX) || die "cannot create temp dir"
umask "$OLD_UMASK"
chmod 700 "$TMPDIR"
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT
trap 'exit 130' INT TERM
ARCHIVE="$TMPDIR/ProxmoxVEx.tar.gz"

# spec 093/US015: preflight BEFORE any artifact download — disk space,
# app health, required tools. --force overrides with a logged warning.
preflight_update

# spec 093/US014: when a signed delta exists for the installed version,
# apply it instead of downloading the full archive. The delta passes the
# same signature+checksum gates; the applied tree is re-verified against
# the manifest's full file map. Any failure → clean fallback to full.
DELTA_APPLIED=0
if [ -n "$DELTA_NAME" ]; then
    echo -n "Trying delta package $DELTA_NAME... "
    DELTA_FILE="$TMPDIR/delta.tar.gz"
    DELTA_DIR="$TMPDIR/delta-x"
    # US032: delta archives are large too — resumable fetch.
    fetch_resume "${GITHUB_ARCHIVE%/*}/$DELTA_NAME" "$DELTA_FILE" || true
    if [ -s "$DELTA_FILE" ] \
        && curl -sfL "${GITHUB_ARCHIVE%/*}/$DELTA_NAME.asc" -o "$DELTA_FILE.asc" 2>/dev/null \
        && curl -sfL "${GITHUB_ARCHIVE%/*}/checksums.txt" -o "$TMPDIR/checksums.txt" 2>/dev/null; then
        DELTA_OK=0
        verify_signature "$DELTA_FILE" "$DELTA_FILE.asc" && {
            EXPECTED_D=$(awk -v f="$DELTA_NAME" '$2 == f {print $1}' "$TMPDIR/checksums.txt" 2>/dev/null)
            ACTUAL_D=$(sha256sum "$DELTA_FILE" | awk '{print $1}')
            [ -n "$EXPECTED_D" ] && [ "$EXPECTED_D" = "$ACTUAL_D" ] && DELTA_OK=1
        }
        if [ "$DELTA_OK" = "1" ]; then
            rm -rf "$DELTA_DIR"; mkdir -p "$DELTA_DIR"
            if tar -xzf "$DELTA_FILE" -C "$DELTA_DIR" 2>/dev/null \
                && [ -f "$DELTA_DIR/delta-manifest.json" ] \
                && apply_delta "$DELTA_DIR" "$SCRIPT_DIR" \
                && verify_delta_tree "$SCRIPT_DIR" "$DELTA_DIR/delta-manifest.json"; then
                DELTA_APPLIED=1
                echo -e "${GREEN}delta applied + verified${NC} (full tree hash-checked)"
            else
                echo -e "${YELLOW}delta apply/verify failed — falling back to full archive${NC}"
            fi
        else
            echo -e "${YELLOW}delta failed signature/checksum — falling back to full archive${NC}"
        fi
    else
        echo -e "${YELLOW}delta unavailable — falling back to full archive${NC}"
    fi
fi

# US020: bundle mode already holds the verified archive — skip the download
# and the (network-dependent) individual-file fallback entirely.
if [ "$DELTA_APPLIED" = "0" ] && [ "$BUNDLE_MODE" != "1" ]; then
echo -n "Downloading release archive... "
# US032: resume partial downloads; a dropped 200MB transfer continues from
# its offset instead of restarting.
if fetch_resume "$GITHUB_ARCHIVE" "$ARCHIVE"; then
    echo -e "${GREEN}OK (mirror)${NC}"
    log_update "download: $(basename "$ARCHIVE") from $GITHUB_ARCHIVE"
else
    echo -e "${YELLOW}Archive not found, falling back to individual files...${NC}"
    # Fallback: download individual files (for repos without releases)
    download_file() {
        local file=$1
        # never overwrite user data / secrets, even if they show up in the tree
        case "$file" in
            config/*|ssl/*|logs/*|backups/*|.git/*|*.db|*.pem|*.key|*.crt|*.enc) return 0 ;;
        esac
        local dir
        dir=$(dirname "$file")
        [ "$dir" != "." ] && mkdir -p "$dir"
        echo -n "  $file... "
        if curl -sfL "$GITHUB_RAW/$file" -o "$file.tmp" 2>/dev/null; then
            mv "$file.tmp" "$file"
            echo -e "${GREEN}OK (mirror)${NC}"
            return 0
        else
            rm -f "$file.tmp"
            echo -e "${RED}FAILED${NC}"
            return 1
        fi
    }

    # 2026-06-07: fetch the FULL repo tree (GitHub Trees API) so the fallback
    # misses nothing — same completeness as the archive path. version.json's
    # hand-maintained update_files list (no globs) used to drop any file not on
    # it (e.g. a freshly-added sponsor logo). update_files is now only the
    # degraded-degraded path when the Trees API itself is unreachable.
    echo "Fetching file list (full tree)..."
    PACKAGE_FILES=$(curl -s "https://api.github.com/repos/ArMaTeC/proxmox-vex-public/git/trees/${GITHUB_BRANCH}?recursive=1" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for it in data.get('tree', []):
        if it.get('type') == 'blob':
            print(it['path'])
except:
    pass
" 2>/dev/null)

    if [ -z "$PACKAGE_FILES" ]; then
        # Trees API unreachable → fall back to version.json's update_files list
        PACKAGE_FILES=$(curl -s "$GITHUB_RAW/version.json" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for f in data.get('update_files', []):
        print(f)
except:
    pass
" 2>/dev/null)
    fi

    # Track fallback-download failures so a partial/mixed update aborts and
    # restores from the backup instead of silently leaving a half-written tree
    # (#168, thanks @x86txt). Only the per-file fallback path — the rsync/tar
    # archive path stays as-is (no --delete; it would wipe offline fonts + plugins).
    DOWNLOAD_FAILURES=0

    if [ -n "$PACKAGE_FILES" ]; then
        echo "Downloading file list from manifest..."
        while IFS= read -r pfile; do
            [ -z "$pfile" ] && continue
            if ! download_file "$pfile"; then
                DOWNLOAD_FAILURES=$((DOWNLOAD_FAILURES + 1))
            fi
        done <<< "$PACKAGE_FILES"
    else
        # absolute fallback - at least get the essentials
        echo "No file list found, downloading essentials..."
        for _ess in ProxmoxVEx_multi_cluster.py version.json requirements.txt deploy.sh update.sh web/index.html web/index.html.original; do
            if ! download_file "$_ess"; then
                DOWNLOAD_FAILURES=$((DOWNLOAD_FAILURES + 1))
            fi
        done
    fi

    if [ "$DOWNLOAD_FAILURES" -gt 0 ]; then
        echo -e "${RED}Update aborted: $DOWNLOAD_FAILURES file(s) failed to download.${NC}"
        echo "Restoring from backup..."
        [ -f "$BACKUP_DIR/ProxmoxVEx_multi_cluster.py" ] && cp "$BACKUP_DIR/ProxmoxVEx_multi_cluster.py" . 2>/dev/null || true
        [ -d "$BACKUP_DIR/ProxmoxVEx" ] && cp -r "$BACKUP_DIR/ProxmoxVEx" . 2>/dev/null || true
        [ -d "$BACKUP_DIR/web" ] && { mkdir -p web && cp "$BACKUP_DIR/web/"* web/ 2>/dev/null; } || true
        [ -f "$BACKUP_DIR/version.json" ] && cp "$BACKUP_DIR/version.json" . 2>/dev/null || true
        [ -f "$BACKUP_DIR/requirements.txt" ] && cp "$BACKUP_DIR/requirements.txt" . 2>/dev/null || true
        die "$DOWNLOAD_FAILURES file(s) failed to download — backup restored"
    fi

    rm -rf "$TMPDIR"

    # Skip to pip install
    ARCHIVE=""
fi

# spec 093/US004: process any pending key rotation BEFORE archive signature
# verification — the old trusted key countersigns its successor, and the new
# key then verifies this release. Fail closed on forged rotation docs.
process_key_rotation "${GITHUB_RAW}" "$TMPDIR"

# spec 093/US001: verify the detached GPG signature BEFORE the checksum or
# extraction — the checksum guards corruption, the signature guards
# authenticity (a tampered tarball fails closed here).
if [ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ]; then
    echo -n "Verifying archive signature... "
    SIG_FILE="$TMPDIR/archive.asc"
    SIG_URL="${GITHUB_ARCHIVE}.asc"
    if curl -sfL "$SIG_URL" -o "$SIG_FILE" 2>/dev/null; then
        vsig_rc=0; verify_signature "$ARCHIVE" "$SIG_FILE" || vsig_rc=$?
        case $vsig_rc in
            0)
                echo -e "${GREEN}OK (signature verified)${NC}"
                ;;
            2)
                echo -e "${YELLOW}skipped (gpg/pubkey.asc unavailable or VEX_SKIP_SIG_VERIFY=1)${NC}"
                ;;
            *)
                echo -e "${RED}signature verification FAILED${NC}"
                die "Archive signature does not verify — aborting; the download may be tampered with."
                ;;
        esac
    else
        echo -e "${YELLOW}no signature published at $SIG_URL (skipping)${NC}"
    fi
fi

# If an archive was downloaded, verify its SHA256 checksum against the published
# SHA256SUMS file (if any). Missing checksums are treated as a soft warning.
if [ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ]; then
    STAGE="verify"
    step "Verify archive"
    echo -n "Verifying archive integrity... "
    SHA_FILE="$TMPDIR/checksums.txt"
    # spec 093/US002: checksums.txt lives beside the archive on the
    # downloads host and is keyed by the archive's real basename — the old
    # lookup fetched SHA256SUMS and grepped <branch>.tar.gz, which could
    # never match ProxmoxVEx-latest.tar.gz and always skipped.
    ARCHIVE_BASENAME=$(basename "$GITHUB_ARCHIVE")
    CHECKSUMS_URL="${GITHUB_ARCHIVE%/*}/checksums.txt"
    if curl -sfL "$CHECKSUMS_URL" -o "$SHA_FILE" 2>/dev/null; then
        EXPECTED=$(awk -v f="$ARCHIVE_BASENAME" '$2 == f {print $1}' "$SHA_FILE" 2>/dev/null)
        if [ -n "$EXPECTED" ]; then
            ACTUAL=$(sha256sum "$ARCHIVE" | awk '{print $1}')
            if [ "$EXPECTED" = "$ACTUAL" ]; then
                echo -e "${GREEN}OK (SHA256 verified)${NC}"
            else
                echo -e "${RED}CHECKSUM MISMATCH${NC}"
                echo -e "${RED}Expected: $EXPECTED${NC}"
                echo -e "${RED}Got:      $ACTUAL${NC}"
                echo -e "${RED}Archive may be corrupted or tampered with. Aborting.${NC}"
                die "checksum mismatch on $ARCHIVE_BASENAME"
            fi
        else
            echo -e "${YELLOW}no matching entry in SHA256SUMS${NC}"
        fi
    else
        echo -e "${YELLOW}SHA256SUMS not available (skipping verification)${NC}"
    fi

    # spec 093/US007: advisory transparency-log check — an artifact whose
    # hash never entered the public log may have been swapped post-publish.
    # Warn loudly but don't block: the sig/checksum gates already failed
    # closed on tampering.
    TLOG="$TMPDIR/transparency.log"
    if curl -sfL "$GITHUB_RAW/transparency.log" -o "$TLOG" 2>/dev/null; then
        ACTUAL_HASH=$(sha256sum "$ARCHIVE" | awk '{print $1}')
        if check_transparency "$TLOG" "$ACTUAL_HASH"; then
            echo -e "${GREEN}✓ artifact listed in transparency log${NC}"
        else
            echo -e "${YELLOW}transparency warn: artifact hash not in the published log${NC}"
            echo -e "${YELLOW}  (possible post-publish replacement — verify out-of-band)${NC}"
        fi
    fi
fi

# Extract the archive to a temp directory, locate the actual source tree (GitHub
# archives often wrap everything in a subdirectory), then copy it over using
# rsync if available, falling back to a tar-pipe.
# spec 093/US011: --atomic applies via releases/<ver> + symlink swap instead
# of copying over the live tree.
if [ "$ATOMIC" = "1" ] && [ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ]; then
    STAGE="apply"
    step "Apply release"
    atomic_update "$ARCHIVE" "$LATEST_VERSION"
    # US069: post-swap GC — only after the new release is live can old
    # ones be pruned without risking the rollback pair.
    gc_releases
    # US070: operator hooks fire post-swap with the version transition.
    run_post_hooks
elif [ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ]; then
    echo -n "Extracting archive... "
    # Extract to temp dir first, then copy (safer)
    EXTRACT_DIR="$TMPDIR/extracted"
    mkdir -p "$EXTRACT_DIR"
    untar_release "$ARCHIVE" "$EXTRACT_DIR" 2>/dev/null

    # Find the actual content (might be in a subdirectory)
    CONTENT_DIR="$EXTRACT_DIR"
    if [ ! -f "$CONTENT_DIR/ProxmoxVEx_multi_cluster.py" ]; then
        # Check one level down (GitHub archives often have a subdirectory)
        for subdir in "$EXTRACT_DIR"/*/; do
            if [ -f "${subdir}ProxmoxVEx_multi_cluster.py" ]; then
                CONTENT_DIR="$subdir"
                break
            fi
        done
    fi

    if [ -f "$CONTENT_DIR/ProxmoxVEx_multi_cluster.py" ]; then
        # US048: normalize modes on the extracted tree before anything lands
        # in the live install — a permissive-host tarball must not carry
        # world-writable or over-open modes onto the target.
        normalize_modes "$CONTENT_DIR"
        # Copy files, preserving directory structure
        # Skip: config/, ssl/, logs/, backups/, cert.pem, key.pem, .git/
        if command -v rsync &> /dev/null; then
            rsync -a --exclude='config/' --exclude='ssl/' --exclude='logs/' \
                  --exclude='backups/' --exclude='cert.pem' --exclude='key.pem' \
                  --exclude='.git/' --exclude='.gitignore' \
                  "$CONTENT_DIR/" "$SCRIPT_DIR/"
        else
            # Fallback: cp + tar (works without rsync)
            cd "$CONTENT_DIR" || die "cannot enter extracted content dir"
            tar cf - --exclude='config' --exclude='ssl' --exclude='logs' \
                     --exclude='backups' --exclude='cert.pem' --exclude='key.pem' \
                     --exclude='.git' --exclude='.gitignore' \
                     . | tar xf - -C "$SCRIPT_DIR"
            cd "$SCRIPT_DIR" || die "cannot return to install dir"
        fi
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${RED}FAILED${NC}"
        echo "Archive does not contain ProxmoxVEx_multi_cluster.py"
        echo "Restoring from backup..."
        cp "$BACKUP_DIR/ProxmoxVEx_multi_cluster.py" . 2>/dev/null || true
        die "archive missing ProxmoxVEx_multi_cluster.py — backup restored"
    fi

    rm -rf "$TMPDIR"
fi
fi  # end DELTA_APPLIED=0 full-archive path (US014)

# 2026-06-07: post-copy sanity check - confirm the new version.JSON actually
# landed on disk. Catches a half-applied copy AND a stale CDN tarball (GitHub can
# serve an old cached <branch>.tar.gz as a 200 right after a push).
# || true: atomic layouts have no root version.json — the check is a soft
# warning anyway (APPLIED empty → the warning below just reports it).
APPLIED=$(grep -o '"version": *"[^"]*"' version.json 2>/dev/null | cut -d'"' -f4 || true)
if [ -n "$LATEST_VERSION" ] && [ "$APPLIED" != "$LATEST_VERSION" ]; then
    echo -e "${YELLOW}⚠ Post-update check: version.json says '$APPLIED' but expected '$LATEST_VERSION'.${NC}"
    echo -e "${YELLOW}  The download may be incomplete or a stale cache — re-run ./update.sh --force in a minute.${NC}"
fi

# Make scripts executable again after the copy.
chmod +x deploy.sh update.sh 2>/dev/null || true
chmod +x web/Dev/build.sh 2>/dev/null || true

# Fix ownership if running as root so the install goes back to the original user.
if [ "$EUID" -eq 0 ] && [ -n "$ORIGINAL_OWNER" ] && [ "$ORIGINAL_OWNER" != "root:root" ]; then
    echo -n "Fixing file ownership ($ORIGINAL_OWNER)... "
    chown -R "$ORIGINAL_OWNER" ProxmoxVEx_multi_cluster.py version.json requirements.txt 2>/dev/null
    chown -R "$ORIGINAL_OWNER" deploy.sh update.sh 2>/dev/null
    chown -R "$ORIGINAL_OWNER" web/ 2>/dev/null
    [ -d "ProxmoxVEx" ] && chown -R "$ORIGINAL_OWNER" ProxmoxVEx/ 2>/dev/null
    chown -R "$ORIGINAL_OWNER" backups/ 2>/dev/null
    echo -e "${GREEN}OK${NC}"
fi

# Restore restrictive permissions on config and ssl directories.
# These must be 0700 so that only the service user can read the encrypted
# database and SSL private keys. An update that runs as root via sudo can
# inadvertently leave them world-readable if umask is permissive.
if [ -d "config" ]; then
    chmod 700 config 2>/dev/null || true
fi
if [ -d "config/ssl" ]; then
    chmod 700 config/ssl 2>/dev/null || true
elif [ -d "ssl" ]; then
    chmod 700 ssl 2>/dev/null || true
fi

# Install/update Python packages from the new requirements.txt, trying the
# project venv first, then pip3, then user pip.
echo ""
echo -n "Installing Python packages... "

PIP_SUCCESS=false

if [ -f "venv/bin/python" ] && [ "$PIP_SUCCESS" = false ]; then
    ./venv/bin/python -m pip install -q -r requirements.txt 2>/dev/null && PIP_SUCCESS=true
fi

if [ -f "venv/bin/pip" ] && [ "$PIP_SUCCESS" = false ]; then
    ./venv/bin/pip install -q -r requirements.txt 2>/dev/null && PIP_SUCCESS=true
fi

if [ "$EUID" -eq 0 ] && command -v pip3 &> /dev/null && [ "$PIP_SUCCESS" = false ]; then
    pip3 install -q -r requirements.txt 2>/dev/null && PIP_SUCCESS=true
fi

if command -v pip3 &> /dev/null && [ "$PIP_SUCCESS" = false ]; then
    pip3 install -q --user -r requirements.txt 2>/dev/null && PIP_SUCCESS=true
fi

if command -v python3 &> /dev/null && [ "$PIP_SUCCESS" = false ]; then
    python3 -m pip install -q --user -r requirements.txt 2>/dev/null && PIP_SUCCESS=true
fi

if [ "$PIP_SUCCESS" = true ]; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}Couldn't install - run: pip install -r requirements.txt${NC}"
fi

# Restart the systemd service when running as root so the new code takes effect.
echo ""
echo -n "Restarting ProxmoxVEx service... "

if systemctl is-active --quiet ProxmoxVEx 2>/dev/null; then
    if systemctl restart ProxmoxVEx 2>/dev/null; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${YELLOW}Failed - restart manually${NC}"
    fi
elif systemctl is-active --quiet ProxmoxVEx.service 2>/dev/null; then
    if systemctl restart ProxmoxVEx.service 2>/dev/null; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${YELLOW}Failed - restart manually${NC}"
    fi
else
    echo -e "${YELLOW}No systemd service found${NC}"
    echo "  If running manually, restart with: python3 ProxmoxVEx_multi_cluster.py"
fi

# spec 093/US016: post-update verification — bounded health window after
# restart; atomic-mode installs auto-roll back (guarded, logged) when the
# new release never comes up. VEX_SKIP_POST_VERIFY=1 skips for runbooks.
if [ "${VEX_SKIP_POST_VERIFY:-0}" != "1" ]; then
    STAGE="post-verify"
    step "Verify service health"
    echo -n "Verifying service health (window ${HEALTH_TIMEOUT:-300}s)... "
    if wait_for_health "${HEALTH_URL:-http://localhost:8080/api/healthz}" "${HEALTH_TIMEOUT:-300}"; then
        echo -e "${GREEN}healthy${NC}"
        log_update "verified $LATEST_VERSION"
    elif [ "$ATOMIC" = "1" ]; then
        echo -e "${RED}unhealthy — auto-rolling back${NC}"
        auto_rollback "$LATEST_VERSION" "post-update health check failed" || true
    else
        echo -e "${YELLOW}health check failed — investigate before relying on this install${NC}"
        log_update "health-failed $LATEST_VERSION (non-atomic install, manual rollback)"
    fi
fi

# Done!
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
# spec 101/US012/US019/US025: the end-of-run box doubles as the runbook —
# version delta, elapsed time, backup path, rollback + next-step commands.
_TOTAL=$(( $(date +%s) - ${UPDATE_T0%???} ))
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Update Complete! ✓                            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Updated to version: ${GREEN}$LATEST_VERSION${NC}"
echo -e "  Took:               ${_TOTAL}s"
echo -e "  Backup saved to:    ${BLUE}$BACKUP_DIR${NC}"
echo ""
echo "Next steps:"
echo "  • check the version:   curl -sk https://localhost:5000/api/version"
echo "  • watch the logs:      journalctl -u ProxmoxVEx -f"
echo "If something went wrong, restore with:"
echo "  cp -r $BACKUP_DIR/* .          # or: ./update.sh --rollback"
echo ""

# US071: successful outcome ping — anonymous, opt-in only, best-effort.
report_outcome ok "$(( $(date +%s%3N 2>/dev/null || echo 0) - ${UPDATE_T0:-0} ))"
write_status "ok"
