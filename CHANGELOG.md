# Changelog

## Unreleased

- Security (codebase audit 2026-11-06, spec 130): hardened the update
  trust chain end to end.
  - SEC-001 (P0): all `python3 -c` call sites in `update.sh` now pass
    metadata values via argv/stdin instead of interpolating them into
    program text; every version token read from remote `version.json`,
    `config/update-pin`, or the local install is semver-gated
    (`assert_semver`) and archive/delta names basename-gated
    (`assert_safe_name`) before use — closes a root code-execution sink
    on every update client.
  - SEC-002: a missing `version.json.asc` or unavailable gpg/pubkey is
    now fatal (same posture as the archive signature gate) unless
    `VEX_ALLOW_UNSIGNED=1`/`VEX_SKIP_SIG_VERIFY=1` is set; bad signatures
    remain unconditional `die`.
  - SEC-003: `.vexbundle` updates no longer execute the bundled
    `verify-release.sh` — the bundle is untrusted until its payload
    signature passes; the repo's own `verify-release.sh` (or
    `verify_signature` fallback) verifies instead.
  - SEC-010: `LATEST < CURRENT` is refused as a downgrade unless pinned
    or `--force` — a mirror can no longer replay older signed releases
    onto clients.
  - SEC-028: the per-file fallback path requires a signed
    `MANIFEST.sha256` + `.asc` beside the archive and hash-verifies every
    file before apply; without a verified manifest only
    `VEX_ALLOW_UNSIGNED`/`VEX_SKIP_SIG_VERIFY` proceeds.
  - SEC-037: `publish.sh`/`promote.sh` quote remote ssh arguments with
    `printf %q`, semver-gate `$VERSION`, and reject `..`/absolute paths
    in staged manifest filenames.
  - NC-010: `/downloads/enterprise/` nginx block now uses `^~` so
    versioned-artifact regex locations can't bypass the token gate.
- Fix (SEC-008 regression): `--insecure` + `VEX_I_ACCEPT_RISK=1` did not
  actually waive a missing archive/bundle signature — `update.sh` still
  died on the SEC-008 "no signature published" / "bundle carries no
  signature" paths, breaking every unsigned-fixture update. The
  confirmed insecure gate (`VEX_SKIP_SIG_VERIFY`, exported by
  `enforce_insecure_gate`) is now honoured alongside
  `VEX_ALLOW_UNSIGNED`.
- Restored publish metadata in `version.json` that release syncs had
  dropped: `channels` (stable + `cohort: opt-in` canary), `deltas`,
  `mirrors`, `platforms`, `formats`, and a real `releases` entry for
  1.2.677 (`min_from`, `support_until`/`eol`, `size_bytes`,
  `min_python`, `platforms`) replacing the leftover `"t"` stub.
  `docs/compatibility.md` regenerated from `scripts/gen_compat.py`.
- `tests/test_airgap_bundle.sh` updated for SEC-008: an unsigned bundle
  is now refused unless `VEX_ALLOW_UNSIGNED=1` — the test asserts both
  the refusal and the waived apply path.
- Docs: README gained a "Serving the site" section covering
  `deploy/server.py` + `proxmoxvex-public.service`, the `IDS_*` env
  contract, and retirement of the ad-hoc `http.server`.

- Central IDS wiring (proxmoxvex-auth): new `deploy/server.py` — a
  `ThreadingHTTPServer` static file server that replaces the ad-hoc
  `python3 -m http.server` on :8099 and adds the report+enforce loop:
  every served response (200/404) and early-403 is queued to
  `IDS_EVENTS_URL` (`{site_id: public, events[]}`, Bearer `IDS_KEY`),
  and a daemon thread polls `IDS_BLOCKLIST_URL` for centrally-blocked
  IPs. Fail-open — unset env vars mean plain static serving, and a dead
  IDS keeps the last good blocklist. New
  `deploy/proxmoxvex-public.service` systemd unit with the env contract
  documented (`IDS_EVENTS_URL`, `IDS_BLOCKLIST_URL`, `IDS_KEY`,
  `IDS_SITE_ID`).

- Static-server hardening (SEC-034/036/038): `deploy/server.py`'s
  `_client_ip` honours forwarded headers only from peers inside
  `TRUSTED_PROXY_CIDRS` (default `127.0.0.0/8,::1` — cloudflared
  terminates on-host) — a direct LAN/VM/container hit can no longer
  forge the source IP reported to the central IDS or evade the
  blocklist. Requests for dot-paths (except `/.well-known/` — so
  `/.git/`, `/.github/` etc.) and `*.py` now 404, and index-less
  directories return 404 instead of a listing — the live git
  checkout's internals are no longer browsable. Security headers
  gained `X-Frame-Options: SAMEORIGIN`, HSTS, Permissions-Policy and a
  self-contained CSP.
