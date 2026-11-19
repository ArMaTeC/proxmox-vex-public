# Changelog

## Unreleased

- Client-side release-metadata validation hardened (roadmap ID-0475): `update.sh`'s `validate_version_doc` previously checked only that `version`/`channels` existed — a signed-but-schema-breaking doc (missing `release_date`, non-semver channel version, non-object channel entry) still reached the resolver, EOL gate, and min_from gate. The inline check now mirrors `version.schema.json`'s load-bearing rules for every field the updater consumes: required keys (`version` semver, `release_date` date, `changelog` array), each `channels.*` entry an object with semver `version`, and `releases.*.{support_until,min_from}` shape-checked. The publish-side gate (`release.yml` → `scripts/validate-version.py` full-schema check) is unchanged — this closes the client half of the contract.

- Root-updater eval surface closed (roadmap ID-0176): every embedded python in `update.sh` now takes data only via argv/stdin — the three double-quoted `python3 -c "…"` bodies (the only spellings where a future `$` could interpolate into code run as root) were normalized to single-quoted bodies, and `tests/test_no_python_eval.sh` is the CI guard: it bans `eval`, double-quoted `-c` bodies, and unquoted heredocs so string-eval can never regress.

- Apply-path manifest verification is mandatory (roadmap ID-0177): `--verify-files` used to be the only drift check — opt-in only. The atomic path now verifies the staged tree against the embedded `MANIFEST.sha256` **before** the swap (drift deletes the stage — nothing was activated, so that is the rollback), and the classic path verifies the installed tree post-copy and restores the file backup on mismatch. Also fixed: `verify_installed_files` ignored `sha256sum -c`'s exit code, so a malformed manifest produced zero `: OK` lines and passed silently — rc is now the verdict. New `tests/test_apply_manifest_verify.sh` proves tampered members fail pre-swap, legacy manifest-less archives still apply, and matching manifests swap cleanly.

- Static-serving confinement hardened (roadmap ID-0181): `deploy/server.py` now rejects resolved targets outside the docroot with `is_relative_to` (the old `startswith` let a sibling sharing the prefix escape through an in-tree symlink), re-resolves `index.html` so a symlinked index can't leak outside, and no longer delegates misses to `SimpleHTTPRequestHandler.send_head` — its cwd-relative resolution was a second path that would escape ROOT the moment cwd and the docroot diverged. New `tests/test_traversal.sh` drives 16 confinement cases (encoded, absolute, dot-files, .py, symlink escapes) live against a scratch docroot.

- Signature-chain negative corpus completed (roadmap ID-0661): `test_forgery_rejection.sh` case D now proves a mirror serving validly-signed metadata but **withholding** the tarball `.asc` is refused (SEC-008 fail-closed), with the install untouched — alongside the existing forged-metadata, forged-archive-sig, and real-sig control cases.

- Tests: new `tests/test_no_introspect.sh` (ID-0134) — FR-012
  regression guard asserting `deploy/`, `scripts/` and `update.sh`
  never reference auth's `/v1/internal/introspect`, and that the
  `/v1/internal/ids/*` feeds remain the only internal surface this
  site touches. Audit confirmed zero introspect calls today;
  revocation rides the short access-TTL + optional
  `/v1/internal/ids/session-denylist` feed (site-integration.md §5).

- Security: `deploy/server.py` blocklist hardening (ID-0182,
  mirrors landing ID-0170) — feed entries are validated as real
  IPs/CIDRs, feeds larger than 50,000 entries are rejected outright
  (fail-open keeps the last good list), and any entry broader than
  IPv4 /8 or IPv6 /32 (e.g. `0.0.0.0/0`) is dropped rather than
  honoured, so a corrupted or hostile feed can no longer 403 the
  entire site. CIDR entries are now enforced via containment checks
  (previously stored as strings and never matched).

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
