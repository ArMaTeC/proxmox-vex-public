# Verifying ProxmoxVEx release artifacts

Every release tarball in `dist/` ships three layers of verification:

| Layer      | File                            | Proves                                                      |
|------------|---------------------------------|-------------------------------------------------------------|
| Signature  | `<artifact>.asc` + `pubkey.asc` | the artifact was produced by the release key — authenticity |
| Checksums  | `dist/checksums.txt`            | bytes in transit weren't corrupted — integrity              |
| Provenance | `*.intoto.jsonl` release asset  | which repo/workflow/commit built it — SLSA3                 |

## 1. Signature (GPG)

Release-signing key fingerprint (compare out-of-band — e.g. against the
README or proxmoxvex.com — before first use):

```text
71E4831CB293EAC4629CDDB18914585CB0F264C2
ProxmoxVEx Release Signing <releases@proxmoxvex.com>
```

```bash
# one-time: import the published release key and confirm the fingerprint
gpg --import pubkey.asc
gpg --fingerprint 71E4831CB293EAC4629CDDB18914585CB0F264C2

# then verify any artifact
gpg --verify dist/ProxmoxVEx-latest.tar.gz.asc dist/ProxmoxVEx-latest.tar.gz
# expect: Good signature from "ProxmoxVEx Release Signing <releases@proxmoxvex.com>"
```

`update.sh` runs this automatically before extracting — a bad signature
aborts the update. Check a downloaded archive yourself without updating:

```bash
./update.sh --verify --file dist/ProxmoxVEx-latest.tar.gz
```

## 2. Checksums

```bash
cd dist && sha256sum -c checksums.txt
```

## 3. SLSA provenance

Each release carries a `multiple.intoto.jsonl` provenance asset minted by
`.github/workflows/release.yml` (slsa-github-generator, sigstore OIDC).
Verify the artifact traces to this repo and release workflow:

```bash
slsa-verifier verify-artifact \
    dist/ProxmoxVEx-latest.tar.gz \
    --provenance-path multiple.intoto.jsonl \
    --source-uri github.com/ArMaTeC/proxmox-vex-public \
    --source-tag <release-tag>
```

Expected: `PASSED: SLSA verification passed`. A `source-uri` that is not
`github.com/ArMaTeC/proxmox-vex-public` means the artifact did not come
from this repository — do not install it.

## Verifying version metadata

`version.json` ships a detached signature (`version.json.asc`) over its
canonical sorted-key serialization. `update.sh` verifies it before
trusting the contents — a tampered version field aborts the update. To
check it by hand:

```bash
python3 -c "import json; print(json.dumps(json.load(open('version.json')),
    sort_keys=True, separators=(',',':')))" > canonical.json
gpg --verify version.json.asc canonical.json
```

`update.sh` also processes `keys/rotation.json` before archive
verification — a countersigned key-rotation document moves trust to the
successor key (see `key-rotation.md`).

## Airgapped / minimal systems

`verify-release.sh` is a standalone POSIX verifier — copy it plus the
artifact, its `.asc`, `checksums.txt`, and `pubkey.asc` to the target:

```bash
./verify-release.sh ProxmoxVEx-latest.tar.gz --checksums checksums.txt --pubkey pubkey.asc
```

Exit codes: `0` verified · `1` signature failed · `2` checksum failed ·
`3` missing files/tools. Without gnupg, `--checksum-only` verifies
integrity only (fetch `checksums.txt` over a trusted channel in that
case).
