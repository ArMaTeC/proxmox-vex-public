# Downgrading ProxmoxVEx

How to retreat to a previous release after a regression — what's
supported, what's not, and how to verify the retreat worked.

## Supported window

- **Same minor line** (`1.2.x -> 1.2.y`) is always supported via
  `--rollback` on atomic installs — the previous release tree is retained
  intact, so the swap back is exact.
- **Across minor lines** only when the target release's notes list a
  `downgrade_to` path or its `min_from` covers your installed version —
  see `releases.<v>.min_from` in `version.json` and `docs/channels.md`.
- **Anything older**: possible, but only via the manual file+state
  restore below, and only if no migration ran (see caveats).

## Preferred path — atomic rollback

Atomic installs keep `releases/<ver>` per release plus a
`.previous-version` marker:

```bash
sudo ./update.sh --rollback    # repoints `current` at .previous-version
cat .active-version            # confirm the version now live
```

`--rollback` writes an audit line to `logs/rollback.log`, refuses when no
previous release is recorded, and warns when the failed release ran a
database migration you must revert by hand (see caveats). Restart the
service to serve the reverted tree:

```bash
sudo systemctl restart proxmoxvex   # or your service manager unit
curl -fsS localhost:8080/api/healthz
```

## Fallback — manual restore

Non-atomic installs, or a rollback that refuses because
`.previous-version` is missing:

```bash
# 1. restore the pre-update application files
cp -r backups/backup_<ver>_<ts>/* .

# 2. restore config/ssl/data from the state snapshot (US063)
tar -xzf backups/pre-update-<ts>/state.tgz
```

Then restart and health-check as above.

## Data-compatibility caveats

The file swap is exact; **data is not**. If the release you are leaving
ran a schema/data migration, the old code may not read the new layout:

- `--rollback` runs the previous release's `install.sh --downgrade-db`
  hook when one ships, else restores the newest `backups/*.dump` when
  `pg_restore` is available. When neither exists it prints
  `revert DB manually` — treat that as a hard requirement, not a hint.
- `config/`, `ssl/`, `data/` were snapshotted *before* the update into
  `backups/pre-update-<ts>/state.tgz` — restoring that tarball returns
  application state to its pre-update content.
- Never downgrade past a migration you cannot revert. If unsure, restore
  the state snapshot AND a database dump together — mixing "old code,
  new data" is the failure mode this doc exists to prevent.

## Verify the downgrade

```bash
cat .active-version                          # the version now live
curl -fsS localhost:8080/api/healthz         # app answers healthy
tail -5 logs/rollback.log                    # audit trail
```

If the health check fails after rollback, check `logs/update.log` and
`logs/update-failure.json` — both record the failing stage. See
`docs/upgrading.md` for the forward path and `docs/channels.md` for
pinning a release (`config/update-pin`) so the updater does not pull the
bad version forward again.

---

See also: [documentation index](README.md) · [upgrading](upgrading.md) · [troubleshooting](troubleshooting.md)
