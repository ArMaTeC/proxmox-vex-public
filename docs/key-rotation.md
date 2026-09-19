# Signing-key rotation

ProxmoxVEx release tarballs are signed with the project's GPG release key
(see `verify.md`). If the key is retired — scheduled rotation, expiry, or
suspected compromise — this procedure hands trust to a successor key
without breaking already-deployed updaters.

## Trust model

A client trusts exactly one key at a time: `pubkey.asc`, fetched at update
time. To rotate, we publish a **rotation document** at
`keys/rotation.json` that:

1. embeds the armored **new** public key inline, and
2. is **countersigned by the old key** (`keys/rotation.json.asc`).

The updater downloads the document, verifies its signature against the
*currently trusted* key, and only then installs the embedded key as the
new `pubkey.asc`. A forged document — including one made by an attacker
key — fails verification and aborts the update. The document is never
trusted merely because it arrived over HTTPS.

```text
client pubkey.asc (old)
        │  gpg --verify rotation.json.asc
        ▼
keys/rotation.json ──► signed by OLD key ──► carries NEW key
        │
        ▼
client pubkey.asc (new) ──► verifies next and future releases
```

## Rotating (release maintainer)

1. **Generate the successor key** (hardware-backed storage preferred):

   ```bash
   gpg --full-generate-key          # ed25519, "ProxmoxVEx Release Signing"
   NEW_FPR=$(gpg --with-colons -k releases@proxmoxvex.com | awk -F: '/^fpr/{print $10; exit}')
   ```

   Keep the private key out of the repository — only `*.asc` files are
   ever committed.

2. **Build the countersigned rotation document:**

   ```bash
   scripts/rotate-keys.sh --old <old-fpr> --new "$NEW_FPR" \
       --effective "$(date +%F)" --reason "scheduled rotation"
   ```

   This writes `keys/rotation.json` (with the new key embedded) and
   `keys/rotation.json.asc` signed by the **old** key.

3. **Sign the next release with the new key:**

   ```bash
   scripts/sign-release.sh -u "$NEW_FPR" dist/ProxmoxVEx-<ver>.tar.gz
   ```

   Clients that rotate mid-update verify this release with the new key;
   clients that haven't fetched the rotation doc yet still verify older
   signatures with the old key.

4. **Publish:** commit `keys/` and the new `.asc` release signatures.

5. **Retire:** once all supported releases carry new-key signatures,
   remove `keys/rotation.json*` so updaters stop checking for rotation.

## Failure and recovery

- **Missing `rotation.json`** → no rotation in flight; update proceeds
  with the current key.
- **`rotation.json` present but unsigned or badly signed** → the update
  aborts. This is the fail-closed path: someone is presenting a rotation
  that the trusted key did not authorize.
- **New key installed but release signature fails** → the release is
  rejected; the admin can restore the previous `pubkey.asc` from the
  repo history and re-run the update.
- **Old private key compromised before rotation** → publish a revocation
  certificate, rotate immediately, and tell operators to re-verify
  `pubkey.asc` out-of-band (e.g. fingerprint published on
  proxmoxvex.com).

## Independent test

`tests/test_key_rotation.sh` builds ephemeral old/new/attacker keyrings,
extracts the shipped `verify_rotation_doc`/`process_key_rotation`
functions from `update.sh`, and confirms a countersigned rotation is
accepted while an attacker-signed one is rejected.
