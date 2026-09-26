# Self-hosted mirror

Run an internal mirror of the ProxmoxVEx distribution tree so fleet
updates don't depend on the public endpoint — or any internet access at
all once synced.

## How it works

`scripts/mirror-sync.sh` pulls the upstream tree (metadata, signatures,
checksums, and every artifact the metadata references) into a local
docroot, staging the download and swapping it into `<dest>/current`
atomically — clients never see a half-synced tree.

```bash
scripts/mirror-sync.sh \
    --src https://proxmoxvex.com/dl \
    --dest /srv/mirror
```

Run it from cron or a systemd timer for a self-updating mirror:

```cron
*/30 * * * * /opt/proxmox-vex-public/scripts/mirror-sync.sh --dest /srv/mirror
```

## Serve it with nginx

Point the docroot at the `current` directory the sync maintains:

```nginx
server {
    listen 443 ssl;
    server_name mirror.corp.example;
    root /srv/mirror/current;

    # metadata must never be cached — clients poll it every check
    location ~ ^/(version\.json|transparency\.log|checksums\.txt|MANIFEST) {
        add_header Cache-Control "no-cache";
    }
    # versioned artifacts are immutable
    location ~ ^/ProxmoxVEx-.+\.(tar\.(gz|zst)|vexbundle|json|asc|sha256)$ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
```

## Point clients at it

`VEX_UPDATE_BASE` repoints both the metadata and archive endpoints:

```bash
VEX_UPDATE_BASE=https://mirror.corp.example ./update.sh
```

Make it permanent by exporting it in the service's environment (e.g. a
systemd drop-in `Environment=VEX_UPDATE_BASE=https://mirror.corp.example`).

Verification still applies end-to-end: the updater fetches `version.json`
and `version.json.asc` from the mirror and verifies the GPG signature
against the pinned `pubkey.asc`, then verifies the archive checksum and
signature before extracting. A compromised mirror can't push unsigned
artifacts — HTTPS is still required for the mirror URL (`http://` is
rejected unless the explicit `--insecure` + `VEX_I_ACCEPT_RISK=1` double
gate is armed).

For one-off overrides of just the archive mirror (metadata still from
upstream), `VEX_MIRROR` takes top priority in the mirror-selection
order — see `docs/channels.md`.

## Seeding an airgapped mirror

On a connected machine, sync to a portable docroot:

```bash
scripts/mirror-sync.sh --src https://proxmoxvex.com/dl --dest ./mirror-out
```

Transfer `./mirror-out/current/` onto the airgapped network, serve it
(or use `VEX_UPDATE_BASE=file:///path/to/current` directly), and clients
update offline with full verification. See `docs/airgap.md` for the
single-bundle alternative.

## Indexing a hand-curated mirror

If you stage archives yourself (imported bundles, approved subsets),
`scripts/mirror-index.py` rebuilds the metadata so the docroot serves a
valid `version.json` + `checksums.txt` without a publish pipeline:

```bash
scripts/mirror-index.py /srv/vex-dist --channel stable
# -> /srv/vex-dist/version.json, checksums.txt
scripts/sign-version.sh /srv/vex-dist/version.json   # optional: sign it
```

The indexer hashes every `ProxmoxVEx-*.tar.*` in the directory, marks the
highest semver as latest, and points the channel at it. Clients still
verify `version.json.asc` when signatures are published — sign the output
with the release key (or run an unsigned internal mirror and accept the
unsigned-metadata warning).

---

See also: [documentation index](README.md) · [upgrading](upgrading.md) · [troubleshooting](troubleshooting.md)
