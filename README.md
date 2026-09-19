# proxmox-vex-public

Public distribution endpoint for ProxmoxVEx: release tarballs, update
metadata, and the release-signing trust root.

## Contents

- `update.sh` — the in-place updater; verifies signature → checksum →
  transparency log before extracting anything.
- `version.json` + `version.json.asc` — latest-version metadata with a
  detached signature over canonical JSON.
- `dist/` — release tarballs (`*.tar.gz`), detached signatures
  (`*.asc`), `checksums.txt`, and the CycloneDX `sbom.json`.
- `pubkey.asc` — the release-signing public key.
- `transparency.log` + `.asc` — append-only record of every published
  artifact hash.
- `verify-release.sh` — standalone verifier for airgapped installs.
- `docs/` — verification and key-rotation runbooks.

## Release-signing key

All release artifacts are signed by:

```text
fingerprint: 71E4831CB293EAC4629CDDB18914585CB0F264C2
uid:         ProxmoxVEx Release Signing <releases@proxmoxvex.com>
key file:    pubkey.asc (also bundled inside each release at
             dist/keys/release.pub)
```

The same fingerprint is published in `docs/verify.md` and on
proxmoxvex.com — compare out-of-band before first use.

## Verifying a release

```bash
./verify-release.sh dist/ProxmoxVEx-latest.tar.gz \
    --checksums dist/checksums.txt --pubkey pubkey.asc
# exit 0 verified · 1 bad signature · 2 bad checksum · 3 missing files
```

See `docs/verify.md` for SLSA provenance, metadata, and airgap details,
`docs/key-rotation.md` for the signing-key rotation procedure, and
`docs/channels.md` for the beta/stable/LTS promotion policy. The reference
web-server config with the required Cache-Control rules (no-cache metadata,
immutable versioned artifacts) lives in `deploy/nginx.conf`, alongside
`deploy/metrics.sh`, which rolls the JSON access log into a Prometheus
textfile (per-version downloads, error counts) for node_exporter.
