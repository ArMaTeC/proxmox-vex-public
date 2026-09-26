# update.sh reference

Generated-style reference for the flags and environment `update.sh`
accepts. For the walkthrough see [upgrading.md](upgrading.md).

## Flags

| Flag | Effect |
|------|--------|
| `--help`, `-h` | print usage and exit |
| `--version` | print the updater's version and exit |
| `--yes` | skip the interactive confirm (automation) |
| `--dry-run` | print planned steps; mutate nothing |
| `--atomic` | stage to `releases/<v>` then swap `current` atomically |
| `--rollback` | repoint `current` at `.previous-version` and restart |
| `--verify` | verify a release archive (`--file PATH`) |
| `--verify-files` | check the installed tree against its manifest |
| `--bundle FILE` | apply an offline `.vexbundle` |
| `--insecure` | disable signature+TLS checks (needs `VEX_I_ACCEPT_RISK=1`) |
| `--quiet` | only warnings, errors and the final result |
| `--verbose` | extra trace output |
| `--json` | one JSON event per stage on stdout |

## Environment

| Variable | Effect |
|----------|--------|
| `ProxmoxVEx_BRANCH` | update from a non-main branch |
| `VEX_UPDATE_BASE` | repoint raw+archive endpoints at one base (staging/mirror) |
| `VEX_MIRROR` | pin a specific mirror |
| `VEX_UPDATE_TOKEN` | bearer token for the enterprise channel |
| `VEX_PROXY` / `VEX_NO_PROXY` | corporate proxy mapping |
| `VEX_CACERT` | private CA bundle for HTTPS checks |
| `VEX_UPDATE_HOLD` | `1` defers updates (also `config/update-hold`) |
| `VEX_UPDATE_LOG` | tee console output to this file |
| `VEX_CHANNEL` | one-off channel override |
| `VEX_SKIP_SIG_VERIFY` | opt out of signature verification |
| `VEX_SKIP_POST_VERIFY` | skip the post-update health window |
| `VEX_TELEMETRY` | opt-in anonymous outcome ping |
| `NO_COLOR` | disable ANSI colors (auto-off when piped) |

## Exit codes

`0` updated or nothing to do · `1` failure (see `logs/update-failure.json`) ·
`2` usage error.

See also: [verify.md](verify.md), [troubleshooting.md](troubleshooting.md).
