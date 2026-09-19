# Release channels & promotion policy

ProxmoxVEx publishes three channels. `update.sh` resolves the target release
from `version.json`'s `channels` map; the active channel comes from
`config/update-channel` (persistent) or `VEX_CHANNEL` (one-off override).

| Channel | Source                                | Soak before promotion   | Support window         |
|---------|---------------------------------------|-------------------------|------------------------|
| beta    | every merge train / nightly build     | 0 d (ships immediately) | until the next beta    |
| stable  | promoted from beta, no criticals open | 14 d on beta            | 90 days from promotion |
| lts     | quarterly pick from stable            | 30 d on stable          | 12 months              |

## Promotion criteria

- **beta → stable**: the beta has soaked ≥14 days with no open critical or
  high-severity defect against it, its signature/checksum/provenance chain
  verifies, and no rollback incidents were reported in the field.
- **stable → lts**: once per quarter a stable release is selected; it must
  additionally have soaked ≥30 days on stable and carry no known data-loss
  or security regressions. An LTS release keeps receiving backports until
  its 12-month support window ends.

## Hotfix path

A fix for a vulnerability scored CVSS ≥ 7 (or an active exploit) may ship
directly to stable without the 14-day soak, provided post-hoc review happens
within 7 days. Hotfixes are marked in `version.json` via the release's
`security` block (severity + advisory URL), which `update.sh` surfaces as a
`SECURITY UPDATE` banner.

## Operator usage

```bash
# see which channel this install follows
cat config/update-channel          # stable | beta | lts

# one-off switch without editing config
VEX_CHANNEL=beta ./update.sh
```

If the configured channel has no published pointer, the updater aborts with
`no release for channel '<name>' published` rather than silently falling
back — a channel that publishes nothing is a release-engineering bug, not a
client condition to hide.
