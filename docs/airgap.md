# Airgapped / offline updates

`update.sh --bundle` applies a fully offline update from a single
`.vexbundle` file. The bundle carries the release tarball, its
signature, checksums, `version.json`, `pubkey.asc`, and the
`verify-release.sh` verifier — everything verification needs, nothing
network-dependent.

## 1. On a connected machine

Fetch the bundle and record its checksum:

```bash
curl -LO https://proxmoxvex.com/dl/ProxmoxVEx-1.2.473.vexbundle
sha256sum ProxmoxVEx-1.2.473.vexbundle | tee bundle.sha256
```

Optionally pull `pubkey.asc` too if the target's pinned key may be stale
(see `docs/key-rotation.md`).

## 2. Transfer

Move `ProxmoxVEx-*.vexbundle` (and `bundle.sha256` if you kept it) onto
the airgapped network by whatever media your site policy allows — USB,
SCP through a bastion, tape archive, etc.

## 3. On the target — verify the transfer

Compare the checksum before trusting the file:

```bash
sha256sum ProxmoxVEx-1.2.473.vexbundle
# must match the value recorded on the connected machine
```

A mismatch means the transfer corrupted the file — do not proceed.

## 4. Apply offline

```bash
sudo ./update.sh --bundle ProxmoxVEx-1.2.473.vexbundle
```

The updater then runs its normal pipeline with no network access:

1. extracts the bundle into a private temp dir,
2. verifies the release tarball's checksum AND GPG signature against the
   bundled `pubkey.asc` — the same trust chain as an online update,
3. stages `releases/<ver>/`, flips `current`, restarts, health-checks,
4. auto-rolls back on health failure (see `docs/upgrading.md`).

`--dry-run` and `--atomic` compose with `--bundle` exactly as with the
online path:

```bash
./update.sh --bundle ProxmoxVEx-1.2.473.vexbundle --dry-run   # plan only
```

## Notes

- Bundles are produced by `scripts/build-release.sh` next to the normal
  artifacts, so every published version has one.
- Pin/hold state still applies: a `config/update-pin` naming a different
  version does not block `--bundle` — the bundle file itself is the
  explicit target.
- Rollback after an airgap update is the same `sudo ./update.sh
  --rollback` path documented in `docs/downgrading.md`.
