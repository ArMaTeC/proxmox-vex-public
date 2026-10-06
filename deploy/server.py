#!/usr/bin/env python3
"""Static server for the ProxmoxVEx public download site (:8099).

Drop-in replacement for `python3 -m http.server` that adds the central
IDS (proxmoxvex-auth) report+enforce loop:

- enforce: a daemon thread polls IDS_BLOCKLIST_URL (auth's
  /v1/internal/ids/blocklist); requests from listed IPs get an early
  403. Fail-open — a dead IDS keeps the last good list (or none).
- report: every served request is queued and flushed in batches to
  IDS_EVENTS_URL (auth's /v1/internal/ids/events) so the central
  engine can detect download-scrape storms and probes.

Configuration (env):
  PORT (8099), HOST (0.0.0.0)
  IDS_EVENTS_URL      e.g. https://auth.proxmoxvex.com/v1/internal/ids/events
  IDS_BLOCKLIST_URL   e.g. https://auth.proxmoxvex.com/v1/internal/ids/blocklist
  IDS_KEY             shared secret = auth's AUTH_INTERNAL_KEY
  IDS_SITE_ID         "public" by default
"""

import io
import ipaddress
import json
import mimetypes
import os
import sys
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(os.getcwd()).resolve()
PORT = int(os.environ.get("PORT", "8099"))
HOST = os.environ.get("HOST", "0.0.0.0")


def _parse_nets(raw_list: str):
    """CIDR set allowed to carry forwarded-client headers (SEC-034)."""
    nets = []
    for raw in raw_list.split(","):
        raw = raw.strip()
        if not raw:
            continue
        try:
            nets.append(ipaddress.ip_network(raw, strict=False))
        except ValueError:
            continue
    return tuple(nets)


# Socket peers inside these ranges may speak for a client IP via
# CF-Connecting-IP / True-Client-IP / X-Forwarded-For. Default is loopback
# only — cloudflared terminates on this host. A peer outside the set (LAN
# host, VM, docker container) IS the client; honouring forwarded headers
# from it would enable source-IP spoofing for blocklist evasion and IDS
# framing (SEC-034).
TRUSTED_PROXY_CIDRS = os.environ.get("TRUSTED_PROXY_CIDRS", "127.0.0.0/8,::1")
_TRUSTED_PROXY_NETS = _parse_nets(TRUSTED_PROXY_CIDRS)

IDS_EVENTS_URL = os.environ.get("IDS_EVENTS_URL", "").strip()
IDS_BLOCKLIST_URL = os.environ.get("IDS_BLOCKLIST_URL", "").strip()
IDS_KEY = os.environ.get("IDS_KEY", "").strip()
IDS_SITE_ID = os.environ.get("IDS_SITE_ID", "public").strip()[:60]
IDS_REPORT_ENABLED = bool(IDS_EVENTS_URL and IDS_KEY)


class _IdsQueue:
    """Bounded queue flushed to the central auth-IDS events endpoint.
    Reporting must never slow down or break serving: failures drop the
    batch and the queue sheds the oldest events when full."""

    BATCH_MAX = 100
    QUEUE_MAX = 5000
    FLUSH_INTERVAL = 5.0

    def __init__(self):
        self._lock = threading.Lock()
        self._queue: list[dict] = []
        self._thread = None

    def enqueue(self, event: dict) -> None:
        if not IDS_REPORT_ENABLED:
            return
        with self._lock:
            if len(self._queue) >= self.QUEUE_MAX:
                self._queue.pop(0)
            self._queue.append(event)
        self._ensure_thread()

    def _ensure_thread(self) -> None:
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()

    def _loop(self) -> None:
        while True:
            time.sleep(self.FLUSH_INTERVAL)
            with self._lock:
                if not self._queue:
                    return
                batch = self._queue[: self.BATCH_MAX]
                del self._queue[: len(batch)]
            self._send(batch)

    def _send(self, batch: list[dict]) -> bool:
        body = json.dumps({"site_id": IDS_SITE_ID, "events": batch}).encode("utf-8")
        req = urllib.request.Request(
            IDS_EVENTS_URL,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {IDS_KEY}",
                "User-Agent": "proxmoxvex-public-ids/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return 200 <= resp.status < 300
        except Exception:
            return False


_ids = _IdsQueue()


class _Blocklist:
    """Polls the central IDS blocklist for early-403 checks."""

    INTERVAL = 60.0

    def __init__(self):
        self._lock = threading.Lock()
        self._ips = frozenset()
        self._thread = None

    def contains(self, ip) -> bool:
        with self._lock:
            return ip in self._ips

    def _loop(self):
        while True:
            try:
                req = urllib.request.Request(
                    IDS_BLOCKLIST_URL,
                    headers={"Authorization": f"Bearer {IDS_KEY}"},
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read() or b"{}")
                ips = data.get("data", {}).get("ips", [])
                with self._lock:
                    self._ips = frozenset(str(i) for i in ips)
            except Exception:
                pass  # keep the last good list
            time.sleep(self.INTERVAL)

    def start(self):
        if not IDS_BLOCKLIST_URL or not IDS_KEY:
            return
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()


_blocklist = _Blocklist()
_blocklist.start()


class PublicHandler(SimpleHTTPRequestHandler):
    server_version = "ProxmoxVEx-Public/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        pass

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header(
            "Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload"
        )
        self.send_header(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()"
        )
        # SEC-038: parity with the landing host — the mirror serves only
        # static docs/artifacts, so a self-contained CSP suffices.
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "font-src 'self'; "
            "connect-src 'self'; "
            "frame-ancestors 'self'; "
            "base-uri 'self'; "
            "form-action 'self'",
        )
        super().end_headers()

    def _client_ip(self):
        # Forwarded headers are honoured only from a trusted proxy peer
        # (loopback by default — cloudflared terminates on this host).
        # A direct LAN/VM/container peer is the client itself and may not
        # forge an IP via headers (SEC-034).
        peer = self.client_address[0] if self.client_address else ""
        try:
            peer_ip = ipaddress.ip_address(peer) if peer else None
        except ValueError:
            peer_ip = None
        if peer_ip is not None and not any(
            peer_ip in net for net in _TRUSTED_PROXY_NETS
        ):
            return peer
        # Same trust order as the landing server: the CDN-stamped headers
        # win; the LAST X-Forwarded-For hop is the one our edge appended.
        for header in ("CF-Connecting-IP", "True-Client-IP"):
            value = self.headers.get(header)
            if value:
                return value.strip()[:45]
        fwd = self.headers.get("X-Forwarded-For")
        if fwd:
            hops = [h.strip() for h in fwd.split(",") if h.strip()]
            if hops:
                return hops[-1][:45]
        return peer

    def _ids_report(self, status):
        if not IDS_REPORT_ENABLED:
            return
        _ids.enqueue(
            {
                "ip": self._client_ip(),
                "method": self.command,
                "path": unquote(self.path.split("?", 1)[0])[:500],
                "status": int(status),
                "user_agent": (self.headers.get("User-Agent") or "")[:400],
            }
        )

    def _blocked(self):
        ip = self._client_ip()
        if not ip or not _blocklist.contains(ip):
            return False
        self._ids_report(403)
        body = b"Forbidden"
        self.send_response(403)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
        return True

    def _not_found(self):
        """Local 404 — SimpleHTTPRequestHandler.list_directory must never
        run on this docroot (it is a live git checkout; SEC-036)."""
        body = b"Not found"
        self.send_response(404)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        return io.BytesIO(body)

    def send_head(self):
        # Translate to a path under ROOT first — SimpleHTTPRequestHandler's
        # send_head returns the 404 body itself on misses, which we can't
        # observe to report, so pre-check existence like the landing server.
        path = unquote(self.path.split("?", 1)[0].split("#", 1)[0])
        raw_words = [w for w in path.split("/") if w]
        # Deny dot-paths (except .well-known) and interpreter source: the
        # docroot is a live git checkout exposing .git/, .github/, and
        # deploy/server.py if requested directly (SEC-036).
        if any(
            (w.startswith(".") and w != ".well-known") or w.endswith(".py")
            for w in raw_words
        ):
            self._ids_report(404)
            return self._not_found()
        words = [w for w in raw_words if not w.startswith("..")]
        target = (ROOT / Path(*words)).resolve() if words else ROOT
        if not str(target).startswith(str(ROOT)):
            target = ROOT
        if target.is_dir():
            index = target / "index.html"
            if index.exists():
                target = index
            else:
                # No directory listing — index-less dirs 404 (SEC-036).
                self._ids_report(404)
                return self._not_found()
        if not target.exists():
            self._ids_report(404)
            return super().send_head()
        self._ids_report(200)
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        return io.BytesIO(data)

    def do_GET(self):
        try:
            if self._blocked():
                return
            body = self.send_head()
            if body is None:
                return
            try:
                while True:
                    chunk = body.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            finally:
                body.close()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.send_error(500)

    def do_HEAD(self):
        try:
            if self._blocked():
                return
            body = self.send_head()
            if body is not None:
                body.close()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            pass


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), PublicHandler)
    print(f"Serving {ROOT} on {HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
