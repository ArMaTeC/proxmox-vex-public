# Changelog

## Unreleased

- Docs: README gained a "Serving the site" section covering
  `deploy/server.py` + `proxmoxvex-public.service`, the `IDS_*` env
  contract, and retirement of the ad-hoc `http.server`.

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

- Static-server hardening (SEC-034/036/038): `deploy/server.py`'s
  `_client_ip` honours forwarded headers only from peers inside
  `TRUSTED_PROXY_CIDRS` (default `127.0.0.0/8,::1` — cloudflared
  terminates on-host) — a direct LAN/VM/container hit can no longer
  forge the source IP reported to the central IDS or evade the
  blocklist. Requests for dot-paths (except `/.well-known/` — so
  `/.git/`, `/.github/` etc.) and `*.py` now 404, and index-less
  directories return 404 instead of a listing — the live git
  checkout's internals are no longer browsable. Security headers
  gained `X-Frame-Options: SAMEORIGIN`, HSTS, Permissions-Policy and a
  self-contained CSP.
