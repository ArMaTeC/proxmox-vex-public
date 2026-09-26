# Versioning and release cadence

## Numbering

`MAJOR.MINOR.PATCH` — e.g. `1.2.472`.

- **PATCH** — fixes and small, backwards-compatible features. Ships to
  `stable` roughly weekly as work lands. Safe to apply unattended.
- **MINOR** — a quarterly rollup of everything since the last minor.
  May change behavior; every change is noted in the `changelog` array in
  `version.json` (and surfaced by `warn_breaking_changes` when a change
  is flagged `breaking`).
- **MAJOR** — rare. Breaking changes only, always with a migration
  guide and a `min_from`/`via` path so the updater walks you through
  intermediate releases rather than jumping the gap.

## Channels and cadence

| Channel | Cadence | Audience |
| --- | --- | --- |
| `canary` | Every merge that cuts a release — fastest, least soaked | Opt-in cohort (`config/update-channel: canary`, `cohort: opt-in`) |
| `beta` | Weekly, promoted from canary after ~1 week of soak | Early adopters |
| `stable` | Weekly-ish PATCH; quarterly MINOR | Default |
| `lts` | Quarterly pick from stable | Sites wanting minimal churn |

Promotion between channels is `scripts/promote.sh --channel-promote` —
the full policy is in `docs/channels.md`.

## Support windows

- **stable** — supported until the next MINOR ships plus 30 days; a
  release's `eol`/`support_until` in `version.json` is the authoritative
  date (`check_eol` enforces it at update time).
- **LTS** — each quarterly LTS pick is supported for **12 months**
  (security fixes only).
- Security fixes land on all supported lines; `releases.<ver>.security`
  in `version.json` marks them, and the updater surfaces how many
  security releases you're behind via the stale-version advisory.

## Predicting update pressure

- Stable: expect ~1 update/week, all PATCH-weight.
- LTS: expect ~1/quarter plus occasional security patches.
- Pin/hold (`config/update-pin`, `config/update-hold`) freezes you at a
  version regardless of channel — see `docs/channels.md`.

See also `docs/compatibility.md` for per-version platform/Python support
and `docs/upgrading.md` for the upgrade procedure itself.
