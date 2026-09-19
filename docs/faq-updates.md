# Update FAQ

Quick answers to the questions that come up most. Each links to the
detailed runbook.

**Can I skip versions?**
Yes — the updater goes straight to the latest release in your channel
unless the target declares `min_from`, in which case it tells you the
stepping-stone release (or `via` path) to take first. See
`docs/channels.md`.

**Does it need internet access?**
For downloads, yes — unless you airgap. Offline sites apply
`.vexbundle` files with `./update.sh --bundle` (full verification, no
network), or point clients at an internal mirror via `VEX_UPDATE_BASE`.
See `docs/airgap.md` and `docs/mirroring.md`.

**What happens if it fails mid-update?**
On `--atomic` installs, the new release is staged under
`releases/<ver>/` and only goes live when the `current` symlink flips —
a failure before the swap leaves the old release running untouched. A
failed post-swap health check triggers automatic rollback. Every failure
writes `logs/update-failure.json` and the stage trail is in
`logs/update.log`. See `docs/troubleshooting.md`.

**How do I stop or delay updates?**
`config/update-hold` pauses the updater entirely; `config/update-pin`
freezes you at a specific version; `config/update-window` (or
`VEX_UPDATE_WINDOW`) restricts updates to a maintenance window like
`02:00-04:00`. See `docs/channels.md`.

**How do I roll back?**
`sudo ./update.sh --rollback` repoints `current` at the previous release
— the preferred path on atomic installs. Manual restore from
`backups/pre-update-<ts>/state.tgz` is the fallback. Limits and
data-compatibility caveats: `docs/downgrading.md`.

**How do I switch channels (stable ↔ beta ↔ canary)?**
Write the channel name to `config/update-channel` (or set
`VEX_CHANNEL` for a one-off). Canary is opt-in cohort only. Promotion
policy and per-channel cadence: `docs/channels.md` and
`docs/versioning.md`.

**Can I schedule updates for a maintenance window?**
Yes — `config/update-window` accepts `HH:MM-HH:MM`; outside the window
the updater exits cleanly and retries next run. Combine with a cron
entry running `./update.sh --yes` nightly.

**Is it safe? How are releases verified?**
Every update verifies `version.json`'s GPG signature, then the
archive's SHA256 checksum and detached signature against the pinned
`pubkey.asc` before anything is extracted. `MANIFEST.sha256` re-verifies
each installed file post-extraction. The chain of trust:
`docs/verify.md`; key handling: `docs/key-rotation.md`.

**Does it phone home?**
Only to check `version.json` and download the archive — and it sends
your current version as `?from=` so fleet stats work. Payload telemetry
is strictly opt-in (`VEX_TELEMETRY=1`) and contains no identifiers.
See `docs/upgrading.md`.

**What does `--dry-run` do?**
Everything except mutation: metadata fetch, verification, compat
gates, mirror selection, and the disk-space preflight — then prints the
plan and stops. Good for change-window rehearsals:
`./update.sh --dry-run`.

**Where's the audit trail?**
`logs/update.log` (or `shared/logs/update.log`) records check, download,
verify, swap, and post-verify events with ISO timestamps and
from→to versions; `logs/update-failure.json` records the failing stage
when something dies. Rotation keeps the log bounded.

**My install is a bundle/airgap — do channels still apply?**
`--bundle` is explicit-target: the bundle file wins over channel
resolution. Pins/holds don't block it. See `docs/airgap.md`.

Deeper detail lives in `docs/upgrading.md` (the walkthrough),
`docs/troubleshooting.md` (symptom→fix), and `docs/channels.md`
(channels, pins, windows).
