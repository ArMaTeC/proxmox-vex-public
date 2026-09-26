# Update troubleshooting

Symptom → cause → fix for the failures `update.sh` can hit. Every failure
also writes a structured record to `logs/update-failure.json` (stage,
sanitized command, from/to versions, timestamp) — start there when the
console output alone doesn't explain what happened.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `another update in progress` | A concurrent run holds the lock, or a previous run died and left `.update.lock.holder` behind | Check the pid inside `.update.lock.holder` — if it's dead, remove the file and retry; if it's alive, wait for that run |
| `checksum mismatch` | Corrupt download, truncated mirror response, or a poisoned cache/proxy | Re-run (downloads resume). If it persists, bypass any caching proxy (`VEX_MIRROR` a different mirror) and report the artifact to the maintainers — do NOT retry with `--insecure` |
| `signature verification failed` / GPG error | Tampered or truncated artifact, or the pinned `pubkey.asc` predates a key rotation | Fetch the current `pubkey.asc` per `docs/key-rotation.md`, verify the fingerprint, retry. Persistent failure = report it |
| `health check timed out` → auto-rollback | App failed to come up after the swap | Read `logs/update-failure.json` for the stage, check the app logs and `logs/update.log`, then file an issue with both attached |
| `unsupported platform` / `unsupported arch` | Release doesn't build for this OS/arch | Check the platform matrix in `docs/compatibility.md`; you need a build for your `uname -s`/`uname -m` pair |
| `python X.Y required` | Installed interpreter below `min_python` in `version.json` | Upgrade Python first (see `docs/compatibility.md`), or pin to an older release line via `config/update-pin` |
| `held back: min_from` | Release requires a minimum installed version — you're skipping too many releases | Upgrade via an intermediate release listed in the `via` field, or step through channel releases (`docs/channels.md`) |
| `end of support` | Installed version is past its `eol` date and the new release drops the line | Move to a supported line; `docs/channels.md` covers LTS |
| `disk space` / `need ~Nx` | Not enough free space for download + extract + state backup (needs ~2.5× archive size) | Free space or move the install; `backups/` retention is pruned automatically but check for manual copies |
| `hook <name> exited N` | A `hooks.d/` post-update hook failed | The update itself succeeded — fix the hook; its output is in `logs/update.log` |
| `no update sources` / mirror errors | All mirrors unreachable or `VEX_UPDATE_BASE`/`VEX_MIRROR` misconfigured | Check connectivity, DNS, and `HTTPS_PROXY`/`VEX_PROXY` env; for `file://` bases verify the path exists |
| `--insecure` refused | `VEX_I_ACCEPT_RISK=1` not set alongside `--insecure` | Both are required — this is deliberate. Prefer fixing verification instead |
| `no previous release` on `--rollback` | Non-atomic install, or `.previous-version` was cleaned up | Restore manually from `backups/pre-update-<ts>/` — see `docs/downgrading.md` |

## Reading the failure record

```bash
cat logs/update-failure.json
# {"ts":"...","stage":"verify","cmd":"gpg --verify ...","from":"1.2.472","to":"1.2.473"}
```

The `stage` field maps to a pipeline phase: `init`, `check`, `download`,
`verify`, `apply`, `post-verify`. The full event trail is in
`logs/update.log`. Attach both to a support ticket — and if telemetry is
enabled (`VEX_TELEMETRY=1`), a sanitized copy was already sent.

See also: `docs/upgrading.md` (normal flow), `docs/downgrading.md`
(retreat path), `docs/airgap.md` (offline updates).
