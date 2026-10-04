# Changelog

## Unreleased

- Central IDS wiring (proxmoxvex-auth): new `deploy/server.py` — a
  `ThreadingHTTPServer` static file server that replaces the ad-hoc
  `python3 -m http.server` on :8099 and adds the report+enforce loop:
  every served response (200/404) and early-403 is queued to
  `IDS_EVENTS_URL` (`{site_id: public, events[]}`, Bearer `IDS_KEY`),
  and a daemon thread polls `IDS_BLOCKLIST_URL` for centrally-blocked
  IPs. Fail-open — unset env vars mean plain static serving, and a dead
  IDS keeps the last good blocklist. New
  `deploy/proxmoxvex-public.service` systemd unit with the env contract
  documented (`IDS_EVENTS_URL`, `IDS_BLOCKLIST_URL`, `IDS_KEY`,
  `IDS_SITE_ID`).
