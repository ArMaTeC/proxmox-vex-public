# Compatibility matrix

Which ProxmoxVEx releases run where. The matrix is generated from
`version.json` — regenerate with:

```bash
python3 scripts/gen_compat.py version.json
```

| Version | Python | Arch                        | EOL | Security fix |
|---------|--------|-----------------------------|-----|--------------|
| 1.2.472 | 3.8+   | linux-x86_64, linux-aarch64 | —   | —            |
| t       | 3.8+   | linux-x86_64                | —   | —            |

## How the gates apply

`update.sh` enforces this metadata before downloading anything:

- **Python** — `min_python` (and `max_python` when set) is checked
  against `python3 --version` on the target.
- **Platform** — `platforms` entries are `<os>-<arch>`; the updater
  compares `uname -s`/`uname -m` and refuses unsupported builds.
- **EOL** — `eol` / `support_until` dates warn (and `check_eol` refuses)
  when a release line is past its support window.
- **`min_from`** — releases may require a minimum installed version;
  see `docs/channels.md` for stepping through intermediate releases.

The per-release `releases` map in `version.json` is the source of truth;
this table is a rendering of it. See `docs/versioning.md` for the
numbering and support policy.

---

See also: [documentation index](README.md) · [upgrading](upgrading.md) · [troubleshooting](troubleshooting.md)
