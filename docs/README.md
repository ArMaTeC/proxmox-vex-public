# ProxmoxVEx update & distribution docs

Operator-facing documentation for `update.sh`, `verify-release.sh`, and the
release distribution tree (`dist/`, `version.json`, `transparency.log`).

| Doc | Covers |
|-----|--------|
| [upgrading.md](upgrading.md) | First-time walkthrough: preflight, update, verify, rollback |
| [update-sh.md](update-sh.md) | `update.sh` flag + env-var reference |
| [verify.md](verify.md) | Verifying release artifacts (signature, checksum, provenance) |
| [channels.md](channels.md) | Release channels & promotion policy |
| [downgrading.md](downgrading.md) | Retreating to a previous release |
| [hotfix.md](hotfix.md) | Expedited security-hotfix path |
| [key-rotation.md](key-rotation.md) | Signing-key rotation procedure |
| [mirroring.md](mirroring.md) | Running a self-hosted mirror |
| [airgap.md](airgap.md) | Fully offline `.vexbundle` updates |
| [compatibility.md](compatibility.md) | Release × platform matrix |
| [versioning.md](versioning.md) | Numbering and release cadence |
| [troubleshooting.md](troubleshooting.md) | Symptom → cause → fix |
| [faq-updates.md](faq-updates.md) | Update FAQ |

## Quick reference

```console
$ ./update.sh --help          # flags
$ ./verify-release.sh --help  # verification options
$ ./update.sh --dry-run       # preview without touching anything
$ ./update.sh --rollback      # revert to the previous release
```
