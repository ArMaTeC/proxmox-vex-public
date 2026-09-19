# Security Policy

## Reporting a vulnerability

Email: **<security@proxmoxvex.com>**

Encrypt sensitive reports with the release-signing PGP key published at
`pubkey.asc` (fingerprint also in `docs/verify.md`).

Please do **not** open a public issue for a suspected vulnerability.

## Response commitments

| Step | Commitment |
| --- | --- |
| Acknowledgement | Within **48 hours** |
| Triage + severity assignment | Within **7 days** |
| Fix target — critical | **14 days** |
| Fix target — high | **30 days** |
| Fix target — medium/low | Next scheduled release |

We will keep you informed of progress and credit you in the release
notes unless you prefer to remain anonymous.

## Scope

In scope:

- The update mechanism (`update.sh`) — signature/checksum bypass,
  downgrade attacks, lock/rollback abuse
- Release signing and key handling (`scripts/sign-*.sh`,
  `scripts/rotate-keys.sh`, `pubkey.asc`)
- Distribution infrastructure (`deploy/nginx.conf`, publish/promote
  pipelines, channel metadata)
- The ProxmoxVEx application itself

Out of scope: vulnerabilities in third-party dependencies without a
demonstrated impact path through ProxmoxVEx (report these to
<security@proxmoxvex.com> anyway — our `scripts/cve-check.sh` monitoring
may not have caught them yet).

## Safe harbor

We support good-faith security research. We will not pursue legal action
against researchers who:

- report findings to us in confidence before public disclosure,
- make a good-faith effort to avoid privacy violations, data
  destruction, and service disruption,
- give us a reasonable window to remediate before disclosure.

## Verifying releases

All release artifacts are GPG-signed and checksummed — see
`docs/verify.md` for the verification procedure and `docs/key-rotation.md`
for the signing-key rotation policy. Never install unsigned artifacts;
`update.sh --insecure` exists only for controlled testing and requires
`VEX_I_ACCEPT_RISK=1`.
