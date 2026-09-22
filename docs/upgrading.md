# Upgrading ProxmoxVEx

A first-time walkthrough: preflight, update, verify, rollback. Every step
uses only flags `update.sh` ships — nothing here requires extra tooling.

## 1. Preflight — see the plan before anything changes

```bash
./update.sh --dry-run        # shows target version, size, step list — changes nothing
df -h .                      # need ~2.5x the archive size free (download + extract + backup)
```

The dry-run resolves your channel's target release, prints the plan, runs
the read-only preflight checks (tools, disk space, app health), and exits.

Optional sanity checks:

```bash
uname -m                     # must match a release `platforms` entry (x86_64/aarch64)
python3 --version            # must satisfy the release's min_python
cat config/update-channel    # stable (default) / canary — see docs/channels.md
```

## 2. Update

```bash
sudo ./update.sh --yes --atomic
```

- `--yes` — non-interactive; omit it for the confirmation prompt.
- `--atomic` — stage to `releases/<ver>` and flip the `current` symlink
  (recommended; enables instant `--rollback`).

What happens, in order: the updater takes the update lock, snapshots
`config/`, `ssl/` and `data/` into `backups/pre-update-<ts>/state.tgz`,
downloads the archive (resumable), verifies the checksum and signature,
stages and swaps the release, restarts the service, and health-checks it.
Every stage lands a line in `logs/update.log` (or `shared/logs/`).

## 3. Verify

```bash
curl -fsS localhost:8080/api/healthz   # app answers healthy
cat .active-version                  # atomic installs: the live release
tail -5 logs/update.log              # audit trail for this run
```

## 4. If anything went wrong

```bash
sudo ./update.sh --rollback          # repoints `current` at .previous-version
```

The health check auto-rolls back once when it fails on an atomic install;
`--rollback` is the manual equivalent. Restore config/data from the state
snapshot if needed:

```bash
tar -xzf backups/pre-update-<ts>/state.tgz
```

## Common variations

| Need | Flag / env |
| --- | --- |
| Preview only | `--dry-run` |
| Cron/Ansible | `--yes` (required without a TTY) |
| Air-gapped | `--bundle <file>.vexbundle` |
| Verify an artifact first | `./update.sh --verify --file <archive>` |
| Enterprise endpoint | `VEX_UPDATE_TOKEN` or `config/dist-token` (0600) |
| Corporate proxy | `VEX_PROXY` / `VEX_NO_PROXY` |
| Throttle downloads | `VEX_DOWNLOAD_LIMIT=1m` |
| Maintenance window | `VEX_UPDATE_WINDOW=02:00-04:00` (see `--force` to override) |
| Hold updates | `config/update-hold` or `config/update-pin` (see docs/channels.md) |

Never pass `--insecure` without also understanding what it disables
(signature + TLS verification) — it requires `VEX_I_ACCEPT_RISK=1` and the
incident is logged.

## Scheduled updates (systemd timer / cron)

Shipped reference units live in `deploy/proxmoxvex-update.service` and
`deploy/proxmoxvex-update.timer`. Install and enable:

```bash
sudo install -m 0644 deploy/proxmoxvex-update.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now proxmoxvex-update.timer
systemctl list-timers proxmoxvex-update.timer   # confirm it is armed
```

The timer fires daily at 03:00 with up to 1h randomized delay (fleet
staggering); the service runs `update.sh --yes` inside
`VEX_UPDATE_WINDOW=02:00-04:00`. Tune with
`systemctl edit proxmoxvex-update.timer` (`OnCalendar=`) or drop site
settings into `/etc/proxmoxvex/update.env`. Runs log to journald
(`journalctl -u proxmoxvex-update`) plus the updater's own
`logs/update.log` and `logs/update-failure.json` on error.

Cron equivalent for non-systemd hosts:

```cron
# /etc/cron.d/proxmoxvex-update — daily check, randomized minute offset
17 3 * * * root VEX_UPDATE_WINDOW=02:00-04:00 /opt/vex/update.sh --yes >>/var/log/proxmoxvex-update.log 2>&1
```

Either way the run is a cheap no-op when already current, and a failed
run rolls back atomically with a structured failure record.

## Fleet updates (Ansible)

`deploy/ansible/update-fleet.yml` rolls the update across a
`[vex_installs]` inventory group one host at a time (`serial`), with a
health gate between hosts so a bad batch member halts the roll instead
of taking the fleet down with it:

```bash
ansible-playbook -i inventory.ini deploy/ansible/update-fleet.yml
# wider batch / different window:
ansible-playbook -i inventory.ini -e serial_batch=5 -e update_window=03:00-05:00 deploy/ansible/update-fleet.yml
```

Each host still runs `update.sh --yes` inside `VEX_UPDATE_WINDOW`, so the
same signature, atomic-swap and auto-rollback guarantees apply per host;
the gate only decides whether the *next* host proceeds.

---

See also: [documentation index](README.md) · [upgrading](upgrading.md) · [troubleshooting](troubleshooting.md)
