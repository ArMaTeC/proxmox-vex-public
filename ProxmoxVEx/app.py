# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/app.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: ProxmoxVEx Flask App Factory - Layer 8
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
ProxmoxVEx Flask App Factory - Layer 8
Creates and configures the Flask application.
"""

import contextlib
import gc
import logging
import multiprocessing
import os
import signal
import socket
import ssl
import sys
import threading
import time
from pathlib import Path

from flask import Flask, jsonify, render_template_string, request
from flask_compress import Compress
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from ProxmoxVEx import globals as g
from ProxmoxVEx.api import register_blueprints
from ProxmoxVEx.constants import (
    API_RATE_LIMIT,
    API_RATE_WINDOW,
    SSH_MAX_CONCURRENT,
    SSL_CERT_FILE,
    SSL_KEY_FILE,
)
from ProxmoxVEx.utils.server_control import kill_existing_on_port


def get_allowed_origins():
    """Get list of allowed CORS origins (dynamic for Open Source)"""
    origins = set()

    # 1. Environment variable origins (highest priority)
    if g._cors_origins_env:
        for origin in g._cors_origins_env.split(","):
            origin = origin.strip()
            if origin and origin != "*":
                origins.add(origin)

    # 2. Auto-detected origins from successful logins
    origins.update(g._auto_allowed_origins)

    # 3. If nothing configured, allow requests without Origin header (same-origin)
    # This is safe because browsers always send Origin header for cross-origin requests
    if not origins:
        return None  # None = no CORS headers = same-origin only

    return list(origins)


def add_allowed_origin(origin: str):
    """Add an origin to the auto-allowed list (called on successful login)"""
    if origin and origin.startswith(("http://", "https://")) and origin != "*":
        g._auto_allowed_origins.add(origin)
        logging.info(f"Auto-allowed CORS origin: {origin}")


def create_app():
    """Flask application factory."""
    # root_path must point to the project root (parent of ProxmoxVEx/)
    # so that send_from_directory('web', ...) and other relative paths work
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app = Flask(__name__, root_path=project_root)

    # CORS Configuration - Only enable if origins are explicitly set
    if g._cors_origins_env:
        allowed_origins = [o.strip() for o in g._cors_origins_env.split(",") if o.strip() and o.strip() != "*"]
        if allowed_origins:
            CORS(
                app,
                supports_credentials=True,
                resources={
                    r"/api/*": {
                        "origins": allowed_origins,
                        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                        "allow_headers": ["Content-Type", "Authorization", "X-Username", "X-Session-Id"],
                        "expose_headers": ["Content-Type"],
                        "supports_credentials": True,
                    }
                },
            )
    # else: no CORS init = browser same-origin policy applies (safest default)

    # Gzip compression
    app.config["COMPRESS_MIMETYPES"] = [
        "text/html",
        "text/css",
        "text/xml",
        "text/plain",
        "application/json",
        "application/javascript",
        "application/xml",
    ]
    app.config["COMPRESS_LEVEL"] = 6
    app.config["COMPRESS_MIN_SIZE"] = 500
    Compress(app)

    # Max request size - Separate limit for file uploads
    _default_max = int(os.environ.get("PROXMOXVEX_MAX_REQUEST_SIZE", 10 * 1024 * 1024))  # 10 MB default for API
    _upload_max = int(os.environ.get("PROXMOXVEX_MAX_UPLOAD_SIZE", 100 * 1024 * 1024 * 1024))  # 100 GB for uploads
    app.config["MAX_CONTENT_LENGTH"] = _upload_max  # set high, we check per-route below

    # Request validation & rate limiting
    # ACME HTTP-01 challenge route, must be unauthenticated
    @app.route("/.well-known/acme-challenge/<token>")
    def acme_challenge(token):
        from ProxmoxVEx.core.acme import get_challenge_response

        response = get_challenge_response(token)
        if response:
            return response, 200, {"Content-Type": "text/plain"}
        return "", 404

    @app.before_request
    def validate_request():
        if request.path.startswith("/static/") or request.path.startswith("/images/"):
            return None
        if request.path.startswith("/ws"):
            return None
        # ACME challenges must bypass all security checks
        if request.path.startswith("/.well-known/"):
            return None

        # Per-route size limits: uploads get the big limit, everything else 10MB
        # Removed global config mutation, was causing 413s on subsequent uploads
        is_upload = request.path.endswith("/upload")
        max_size = _upload_max if is_upload else _default_max
        if request.content_length and request.content_length > max_size:
            return jsonify({"error": f"Request too large. Max {max_size // (1024 * 1024)} MB"}), 413
        # H-6 (security audit): a chunked Transfer-Encoding request carries NO
        # Content-Length, so the check above is skipped and an unauth client could
        # stream an unbounded body → OOM DoS. Pin werkzeug's per-request cap so the
        # limit is enforced when the body is actually read (counts real bytes,
        # works for chunked too). Per-request, not a global config mutation — so
        # uploads keep their big ceiling without the #119 cross-request race.
        with contextlib.suppress(Exception):
            request.max_content_length = max_size

        if request.path.startswith("/api/"):
            skip_paths = [
                "/api/auth/login",
                "/api/auth/check",
                "/api/events",
                "/api/health",
                "/api/sse",
                "/api/vmware/migrations",
            ]
            if not any(request.path.startswith(p) for p in skip_paths):
                # Use centralized get_client_ip, respects trusted_proxies
                from ProxmoxVEx.utils.audit import get_client_ip

                client_ip = get_client_ip()

                if not _check_api_rate_limit(client_ip):
                    logging.warning(f"Rate limit exceeded for {client_ip}")
                    return jsonify({
                        "error": "Rate limit exceeded. Please slow down.",
                        "retry_after": API_RATE_WINDOW,
                    }), 429

        if request.method in ["POST", "PUT", "PATCH"] and request.content_length:
            content_type = (request.content_type or "").split(";")[0].strip()
            allowed_types = {"application/json", "multipart/form-data", "application/x-www-form-urlencoded"}
            if content_type not in allowed_types or content_type == "text/plain":
                return jsonify({"error": f"Invalid Content-Type: {content_type}"}), 415

        # CSRF check for multipart uploads.
        # (audit fix H-1) - also enforced for application/JSON
        # POST/PUT/PATCH/DELETE. Earlier the assumption was "JSON triggers
        # CORS preflight which blocks cross-origin", which is true for the
        # browser path but doesn't help against subdomain takeover, mis-
        # configured trusted-proxy reflecting Origin, or non-browser tools
        # that already have a session cookie. So now: every state-changing
        # /api/* request must come with X-Requested-With or a matching Origin.
        # Exempt: unauth flows (login, OIDC redirects) where we have no
        # session yet to protect.
        _CSRF_EXEMPT = (
            "/api/auth/login",
            "/api/auth/setup",  # First-run wizard, no session yet
            "/api/auth/oidc/authorize",
            "/api/auth/oidc/callback",
            "/api/auth/oidc/config",
            "/api/auth/check",
            "/api/auth/validate",
            "/api/auth/logout",  # logout is idempotent + harmless
            "/api/health",
            "/api/webauthn/auth/begin",
            "/api/webauthn/auth/finish",
        )
        if (
            request.method in ("POST", "PUT", "PATCH", "DELETE")
            and request.path.startswith("/api/")
            and request.path not in _CSRF_EXEMPT
        ):
            # (CodeAnt CSRF) - the CSRF check must run for EVERY state-changing
            # non-exempt /api/* request, not only JSON/form bodies: a cross-site form with
            # enctype=text/plain is a browser "simple request" that previously skipped this gate.
            has_xhr = request.headers.get("X-Requested-With") == "XMLHttpRequest"
            origin = request.headers.get("Origin", "")
            referer = request.headers.get("Referer", "")
            allowed_origins = get_allowed_origins() or []
            fwd_host = request.headers.get("X-Forwarded-Host", "")

            # (#382 follow-up) - safer Origin matcher.
            # The previous version used `value.startswith(f"{scheme}://{host}")`
            # which (a) had a suffix-confusion bug — `https://proxmoxvex.certrunnerx.com`
            # would match an Origin of `https://proxmoxvex.certrunnerx.com.attacker.com`
            # because that string really does start with the substring —
            # and (b) was strict about scheme, which broke users behind
            # Apache/nginx reverse proxies that don't forward
            # X-Forwarded-Proto (cklabautermann's report).
            # New approach: parse the URL, compare *hostname* (and port
            # if both sides specify one). Scheme is irrelevant for CSRF;
            # the browser controls Origin and won't lie about hostname.
            # HTTPS enforcement happens elsewhere (HSTS, secure cookie flag).
            from urllib.parse import urlparse

            def _host_port(hp):
                # split request.host or fwd_host into (host, port|None)
                if not hp:
                    return ("", None)
                if ":" in hp:
                    h, _, p = hp.rpartition(":")
                    try:
                        return (h.lower(), int(p))
                    except ValueError:
                        return (hp.lower(), None)
                return (hp.lower(), None)

            req_host, req_port = _host_port(request.host)
            fwd_h, fwd_p = _host_port(fwd_host)

            def _origin_ok(value):
                if not value:
                    return False
                if value in allowed_origins:
                    return True
                # (pentest finding) - Python's urlparse silently
                # normalises tabs/whitespace inside the scheme: 'ht\ttp://x'
                # parses as scheme='http'. Browsers never produce that, but
                # an attacker with raw HTTP control could craft it. Lock the
                # scheme prefix down with a strict, byte-exact check before
                # parsing — only the two browser-realistic prefixes pass.
                if not (value.startswith("http://") or value.startswith("https://")):
                    return False
                try:
                    u = urlparse(value)
                    # May 2026: u.port can ValueError for malformed authority
                    # like "localhost:5000.attacker.com" — guard explicitly.
                    try:
                        cand_port = u.port
                    except (ValueError, TypeError):
                        return False
                except Exception as _e:
                    return False
                # Defensive: reject userinfo. RFC 6454 origins have no userinfo;
                # `http://evil.com:80@localhost` parses with hostname=localhost,
                # which would otherwise slip through.
                if u.username or u.password:
                    return False
                if u.scheme not in ("http", "https"):  # belt + braces
                    return False
                if not u.hostname:
                    return False
                cand_host = u.hostname.lower()
                # accept against request host or proxy-forwarded host
                targets = [(req_host, req_port)]
                if fwd_h:
                    targets.append((fwd_h, fwd_p))
                for t_host, t_port in targets:
                    if cand_host != t_host:
                        continue
                    # Port handling — strict by RFC 6454. If Origin has an
                    # explicit port, it must match the target. We accept a
                    # bit of slack only when the target port is unknown
                    # (Flask sometimes drops the port from request.host
                    # behind certain proxy setups), but only when Origin's
                    # port matches the *default* port for its scheme — so
                    # https://example.com:9999 is never accepted against
                    # an unknown-port target.
                    if cand_port is None and t_port is None:
                        return True
                    if cand_port == t_port:
                        return True
                    if t_port is None and cand_port in (80, 443):
                        return True
                    # any other combination is a port mismatch → reject
                return False

            # accept either a same-origin Origin/Referer OR XHR + same-origin
            # (XHR alone is not enough — fetch() lets attacker set X-R-W on
            # same-origin, but cross-origin requests can also set it freely
            # in non-browser contexts).
            # May 2026: Referer parses as a full URL - pass it directly to
            # _origin_ok which now uses urlparse, no manual splitting needed.
            ok_origin = _origin_ok(origin) or _origin_ok(referer)
            if not ok_origin:
                # If neither Origin nor Referer matches, only allow when XHR
                # marker is set AND there's no foreign Origin/Referer.
                if not has_xhr:
                    return jsonify({"error": "CSRF validation failed"}), 403
                if origin and not _origin_ok(origin):
                    return jsonify({"error": "CSRF validation failed"}), 403
                if referer and not _origin_ok(referer):
                    return jsonify({"error": "CSRF validation failed"}), 403

        return None

    # Security headers
    @app.after_request
    def add_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        # (#381) - relaxed from DENY to SAMEORIGIN so plugins
        # can ship a frontend UI that the dashboard embeds in an iframe tab.
        # Cross-origin clickjacking remains prevented; same-origin embedding
        # is the documented plugin-frontend contract.
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"

        # Tightened CSP, removed dead tailwindcss CDN ref
        # (#381) - frame-ancestors 'self' instead of 'none' to
        # match the X-Frame-Options switch above. This is the modern equivalent.
        csp = (
            "default-src 'self'; "
            "frame-src 'self'; "
            # (CodeAnt config) - 'unsafe-eval' dropped: Babel is pre-compiled at build
            # time (web/Dev/build.sh) and never runs in the browser, so nothing needs eval().
            "script-src 'self' 'unsafe-inline' "
            "https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' "
            "https://fonts.googleapis.com https://cdn.jsdelivr.net; "
            "font-src 'self' data: https://fonts.gstatic.com https://fonts.googleapis.com; "
            "img-src 'self' data: blob:; "
            "connect-src 'self' wss: ws: https://cdn.jsdelivr.net; "
            "frame-ancestors 'self'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        response.headers["Content-Security-Policy"] = csp

        # Only trust X-Forwarded-Proto from trusted proxies
        from ProxmoxVEx.utils.audit import _is_trusted_proxy

        is_https = request.is_secure or (
            _is_trusted_proxy(request.remote_addr) and request.headers.get("X-Forwarded-Proto") == "https"
        )
        if is_https:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        # Kein Cache fuer API/auth-stuff, sonst leakt session-state via shared
        # caches (browser-cache nach logout, reverse-proxy mit zu generouser
        # cache config, browser-back-button mit cred response). semgrep findung
        # vom 2026-05-06. /static/* darf weiter gecacht werden, das sind die
        # JS-libs.
        path = request.path or ""
        if (
            path.startswith("/api/") or path in ("/", "/portal", "/oidc/callback")
        ) and "Cache-Control" not in response.headers:
            # don't override if a route explicitly set its own Cache-Control
            response.headers["Cache-Control"] = "no-store, private"
            response.headers["Pragma"] = "no-cache"  # http/1.0 fallback, harmless

        return response

    # Register all API blueprints
    register_blueprints(app)

    # Load enabled plugins
    from ProxmoxVEx.api.plugins import load_enabled_plugins

    load_enabled_plugins(app)

    # Seed default IDS/IPS rule set if the rules table is empty
    from ProxmoxVEx.ids.rules import seed_default_rules
    from ProxmoxVEx.ids.scheduler import start_scheduler

    seed_default_rules()
    start_scheduler(app, enabled=False, interval_hours=24)

    _ERROR_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ code }} — {{ title }}</title>
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; background: #111827; color: #f9fafb; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
        .box { text-align: center; max-width: 480px; padding: 24px; }
        h1 { font-size: 4rem; margin: 0; color: #f97316; }
        p { color: #9ca3af; }
        a { color: #f97316; }
    </style>
</head>
<body>
    <div class="box" role="alert" aria-live="assertive">
        <h1>{{ code }}</h1>
        <p>{{ message }}</p>
        <p><a href="/">Back to ProxmoxVEx</a></p>
    </div>
</body>
</html>"""

    def _render_error(code: int, title: str, message: str):
        if request.path.startswith("/api/"):
            return jsonify({"error": title}), code
        return render_template_string(_ERROR_TEMPLATE, code=code, title=title, message=message), code

    # Global error handlers: JSON for /api/*, friendly HTML pages for browser requests
    @app.errorhandler(400)
    def _bad_request(_e):
        return _render_error(400, "Bad request", "The request could not be understood.")

    @app.errorhandler(403)
    def _forbidden(_e):
        return _render_error(403, "Forbidden", "You do not have permission to access this resource.")

    @app.errorhandler(404)
    def _not_found(_e):
        return _render_error(404, "Not found", "The requested page was not found.")

    @app.errorhandler(415)
    def _unsupported_media(_e):
        return _render_error(415, "Unsupported media type", "The request body format is not supported.")

    @app.errorhandler(429)
    def _too_many_requests(_e):
        if request.path.startswith("/api/"):
            return jsonify({"error": "Rate limit exceeded", "retry_after": API_RATE_WINDOW}), 429
        return _render_error(429, "Rate limit exceeded", "Too many requests. Please slow down.")

    @app.errorhandler(500)
    def _server_error(_e):
        logging.exception("Unhandled server error")
        return _render_error(500, "Internal server error", "Something went wrong. Please try again later.")

    @app.errorhandler(405)
    def _method_not_allowed(_e):
        return _render_error(405, "Method not allowed", "The request method is not allowed for this URL.")

    @app.errorhandler(Exception)
    def _uncaught(_e):
        if isinstance(_e, HTTPException):
            raise _e
        logging.exception("Uncaught exception")
        return _render_error(500, "Internal server error", "Something went wrong. Please try again later.")

    return app


def _check_api_rate_limit(client_ip: str) -> bool:
    """Simple sliding window rate limiter."""
    if API_RATE_LIMIT <= 0:
        return True

    current_time = time.time()

    with g.api_rate_limit_lock:
        if client_ip not in g.api_request_counts:
            g.api_request_counts[client_ip] = {"count": 1, "window_start": current_time}
            return True

        info = g.api_request_counts[client_ip]

        if current_time - info["window_start"] > API_RATE_WINDOW:
            info["count"] = 1
            info["window_start"] = current_time
            return True

        if info["count"] >= API_RATE_LIMIT:
            return False

        info["count"] += 1
        return True


def download_static_files():
    """Download all required static files for offline operation."""
    import re as _re
    import urllib.request

    print("=" * 60)
    print("ProxmoxVEx Static Files Downloader")
    print("=" * 60)
    print()

    static_files = {
        "js": [
            ("react.production.min.js", "https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"),
            (
                "react-dom.production.min.js",
                "https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js",
            ),
            ("babel.min.js", "https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"),
            ("chart.umd.min.js", "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"),
            ("xterm.min.js", "https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js"),
            ("xterm-addon-fit.min.js", "https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js"),
        ],
        "css": [
            ("xterm.min.css", "https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css"),
        ],
    }

    os.makedirs("static/js", exist_ok=True)
    os.makedirs("static/css", exist_ok=True)

    ctx = ssl.create_default_context()  # Use default SSL verification for downloads

    success = 0
    failed = 0

    for subdir, files in static_files.items():
        print(f"Downloading {subdir} files...")
        for filename, url in files:
            dest = f"static/{subdir}/{filename}"
            print(f"  {filename}...", end=" ")
            try:
                req = urllib.request.Request(
                    url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
                )
                with urllib.request.urlopen(req, timeout=30, context=ctx) as response:  # nosec: B310 - hardcoded public asset URLs
                    data = response.read()
                with open(dest, "wb") as f:
                    f.write(data)
                print(f"OK ({len(data):,} bytes)")
                success += 1
            except Exception as e:
                print(f"FAILED: {e}")
                failed += 1

    # Tailwind.min.css is now a full CLI build, don't overwrite it
    if os.path.exists("static/css/tailwind.min.css"):
        sz = os.path.getsize("static/css/tailwind.min.css")
        print(f"\n  tailwind.min.css already exists ({sz:,} bytes), skipping")
        print("  (rebuild with: npx tailwindcss -i input.css -o static/css/tailwind.min.css --minify)")
    else:
        print("\n  WARNING: static/css/tailwind.min.css missing!")
        print("  Run: npx tailwindcss -i input.css -o static/css/tailwind.min.css --minify")
        failed += 1

    # Download Google Fonts for offline
    print("\nDownloading Google Fonts for offline use...")
    os.makedirs("static/fonts", exist_ok=True)

    _gfonts = {
        "plus-jakarta-sans": {
            "family": "Plus Jakarta Sans",
            "weights": {
                "400": "https://fonts.gstatic.com/s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko20yw.woff2",
                "500": "https://fonts.gstatic.com/s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko20yw.woff2",
                "600": "https://fonts.gstatic.com/s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko20yw.woff2",
                "700": "https://fonts.gstatic.com/s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko20yw.woff2",
                "800": "https://fonts.gstatic.com/s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko20yw.woff2",
            },
        },
        "jetbrains-mono": {
            "family": "JetBrains Mono",
            "weights": {
                "400": "https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2",
                "500": "https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2",
                "600": "https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2",
                "700": "https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2",
            },
        },
    }

    font_css = "/* Local Google Fonts for offline mode */\n"
    for font_id, font_info in _gfonts.items():
        for weight, url in font_info["weights"].items():
            fname = f"{font_id}-{weight}.woff2"
            dest = f"static/fonts/{fname}"
            print(f"  {fname}...", end=" ")
            try:
                req = urllib.request.Request(
                    url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
                )
                with urllib.request.urlopen(req, timeout=30, context=ctx) as response:  # nosec: B310 - hardcoded public asset URLs
                    data = response.read()
                with open(dest, "wb") as f:
                    f.write(data)
                print(f"OK ({len(data):,} bytes)")
                success += 1
            except Exception as e:
                print(f"FAILED: {e}")
                failed += 1

            font_css += f"""@font-face {{
  font-family: '{font_info["family"]}';
  font-style: normal;
  font-weight: {weight};
  font-display: swap;
  src: url('/static/fonts/{fname}') format('woff2');
}}
"""

    try:
        with open("static/css/fonts.css", "w") as f:
            f.write(font_css)
        print("  fonts.css... OK")
        success += 1
    except Exception as e:
        print(f"  fonts.css... FAILED: {e}")
        failed += 1

    # Download noVNC for offline VNC console
    print("\nDownloading noVNC for offline VNC console...")
    novnc_base = "https://cdn.jsdelivr.net/npm/@novnc/novnc@1.4.0"
    novnc_files = [
        "core/rfb.js",
        "core/display.js",
        "core/inflator.js",
        "core/deflator.js",
        "core/websock.js",
        "core/encodings.js",
        "core/des.js",
        "core/ra2.js",
        "core/base64.js",
        "core/decoders/copyrect.js",
        "core/decoders/hextile.js",
        "core/decoders/raw.js",
        "core/decoders/rre.js",
        "core/decoders/tight.js",
        "core/decoders/tightpng.js",
        "core/decoders/zrle.js",
        "core/decoders/jpeg.js",
        "core/input/keyboard.js",
        "core/input/keysym.js",
        "core/input/keysymdef.js",
        "core/input/gesturehandler.js",
        "core/input/domkeytable.js",
        "core/input/util.js",
        "core/input/vkeys.js",
        "core/input/xtscancodes.js",
        "core/input/fixedkeys.js",
        "core/util/browser.js",
        "core/util/cursor.js",
        "core/util/element.js",
        "core/util/events.js",
        "core/util/eventtarget.js",
        "core/util/int.js",
        "core/util/logging.js",
        "core/util/strings.js",
        "core/util/md5.js",
        "vendor/pako/lib/zlib/inflate.js",
        "vendor/pako/lib/zlib/zstream.js",
        "vendor/pako/lib/zlib/deflate.js",
        "vendor/pako/lib/zlib/messages.js",
        "vendor/pako/lib/zlib/trees.js",
        "vendor/pako/lib/zlib/adler32.js",
        "vendor/pako/lib/zlib/crc32.js",
        "vendor/pako/lib/zlib/inffast.js",
        "vendor/pako/lib/zlib/inftrees.js",
        "vendor/pako/lib/utils/common.js",
    ]

    for subdir in ["core", "core/decoders", "core/input", "core/util", "vendor/pako/lib/zlib", "vendor/pako/lib/utils"]:
        os.makedirs(f"static/js/novnc/{subdir}", exist_ok=True)

    novnc_success = 0
    novnc_failed = 0

    for filepath in novnc_files:
        url = f"{novnc_base}/{filepath}"
        dest = f"static/js/novnc/{filepath}"
        filename = filepath.split("/")[-1]
        print(f"  {filename}...", end=" ")
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            )
            with urllib.request.urlopen(req, timeout=30, context=ctx) as response:  # nosec: B310 - hardcoded public asset URLs
                content = response.read().decode("utf-8")

            file_dir = "/".join(filepath.split("/")[:-1])
            pattern = r"""from\s+(['"])(\.{1,2}/[^'"]+)\1"""

            def rewrite_import(match, file_dir=file_dir):
                quote = match.group(1)
                rel_path = match.group(2)
                if rel_path.startswith("./"):
                    resolved = f"/static/js/novnc/{file_dir}/{rel_path[2:]}"
                elif rel_path.startswith("../"):
                    parts = file_dir.split("/") if file_dir else []
                    rest = rel_path
                    while rest.startswith("../"):
                        if parts:
                            parts.pop()
                        rest = rest[3:]
                    parent = "/".join(parts)
                    resolved = f"/static/js/novnc/{parent}/{rest}" if parent else f"/static/js/novnc/{rest}"
                else:
                    resolved = rel_path
                while "//" in resolved:
                    resolved = resolved.replace("//", "/")
                return f"from {quote}{resolved}{quote}"

            content = _re.sub(pattern, rewrite_import, content)

            with open(dest, "w") as f:
                f.write(content)
            print("OK")
            novnc_success += 1
            success += 1
        except Exception as e:
            print(f"FAILED: {e}")
            novnc_failed += 1
            failed += 1

    rfb_entry = """// noVNC entry point for ProxmoxVEx offline mode
// Auto-generated by --download-static
export { default } from '/static/js/novnc/core/rfb.js';
export * from '/static/js/novnc/core/rfb.js';
"""
    try:
        with open("static/js/novnc/rfb.min.js", "w") as f:
            f.write(rfb_entry)
        print("  rfb.min.js (entry point)... OK")
        success += 1
    except Exception as e:
        print(f"  rfb.min.js... FAILED: {e}")
        failed += 1

    print(f"\n  noVNC: {novnc_success}/{len(novnc_files)} files downloaded")
    print()
    print("=" * 60)
    print(f"Done: {success} succeeded, {failed} failed")
    print("=" * 60)

    if failed == 0:
        print("\nAll static files downloaded!")
        print("  ProxmoxVEx can run fully offline now (including VNC console)")
    else:
        print("\nSome downloads failed, will use CDN fallback")

    return failed == 0


def main(debug_mode=False):
    """Main entry point - starts ProxmoxVEx server."""
    from ProxmoxVEx.api.helpers import acme_dns_config_from_settings, load_server_settings
    from ProxmoxVEx.api.schedules import start_scheduler as start_actions_scheduler
    from ProxmoxVEx.background.alerts import start_alert_thread
    from ProxmoxVEx.background.broadcast import start_broadcast_thread
    from ProxmoxVEx.background.cross_cluster_lb import start_cross_cluster_lb_thread
    from ProxmoxVEx.background.cross_cluster_replication import start_cross_cluster_replication_thread
    from ProxmoxVEx.background.password_expiry import start_password_expiry_thread
    from ProxmoxVEx.background.scheduler import start_scheduler_thread
    from ProxmoxVEx.background.syslog_server import start_syslog_server
    from ProxmoxVEx.constants import AUDIT_RETENTION_DAYS
    from ProxmoxVEx.core.config import load_config
    from ProxmoxVEx.core.manager import ProxmoxVExManager
    from ProxmoxVEx.core.pbs import load_pbs_servers
    from ProxmoxVEx.core.vmware import load_vmware_servers
    from ProxmoxVEx.models.tasks import ProxmoxVExConfig
    from ProxmoxVEx.utils.audit import load_audit_log
    from ProxmoxVEx.utils.auth import backfill_initialized_marker, is_initialized, load_sessions, load_users
    from ProxmoxVEx.utils.rbac import get_pool_membership_cache

    # Initialize SSH semaphore
    g.init_ssh_semaphore(SSH_MAX_CONCURRENT)

    # Configure logging
    # (#357): env-var override (ProxmoxVEx_LOG_LEVEL) wins over default
    # but --debug still forces DEBUG so the troubleshooting path doesn't need an
    # extra knob. Unset env + no --debug → previous WARNING default.
    from ProxmoxVEx.constants import LOG_LEVEL as _ENV_LOG_LEVEL

    if debug_mode:
        log_level = logging.DEBUG
    elif _ENV_LOG_LEVEL is not None:
        log_level = _ENV_LOG_LEVEL
    else:
        log_level = logging.WARNING
    # Persistent dev-server log: rotate at 10 MB, keep 5 backups so the
    # long-running debug server doesn't fill the disk.
    from logging.handlers import RotatingFileHandler

    _project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    _log_dir = os.path.join(_project_root, "logs")
    os.makedirs(_log_dir, exist_ok=True)
    _log_format = "%(asctime)s [%(name)s] %(levelname)s: %(message)s" if debug_mode else "%(message)s"
    _rot = RotatingFileHandler(
        os.path.join(_log_dir, "dev-server-debug.log"),
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
    )
    logging.basicConfig(
        level=log_level,
        format=_log_format,
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[_rot],
    )

    # Redirect stdout/stderr through the same handler so print() output
    # (startup banners, stack traces, etc.) rotates with the logs.
    class _StreamToLogger:
        def __init__(self, logger, level):
            self.logger = logger
            self.level = level
            self._buf = ""

        def write(self, text):
            self._buf += text
            while "\n" in self._buf:
                line, self._buf = self._buf.split("\n", 1)
                self.logger.log(self.level, line)

        def flush(self):
            if self._buf:
                self.logger.log(self.level, self._buf)
                self._buf = ""

        def isatty(self):
            return False

    sys.stdout = _StreamToLogger(logging.getLogger("stdout"), logging.INFO)
    sys.stderr = _StreamToLogger(logging.getLogger("stderr"), logging.ERROR)

    if debug_mode:
        # Keep application DEBUG output usable by quieting extremely chatty
        # third-party libraries that otherwise drown the dev-server log.
        logging.getLogger("urllib3").setLevel(logging.INFO)
        logging.getLogger("geventwebsocket").setLevel(logging.INFO)

    if not debug_mode:
        logging.getLogger("werkzeug").setLevel(logging.ERROR)
        logging.getLogger("gevent").setLevel(logging.ERROR)
        logging.getLogger("urllib3").setLevel(logging.ERROR)

    if debug_mode:
        print("=" * 50)
        print("DEBUG MODE ENABLED")
        print("=" * 50)

    # Check optional libraries
    print("\nChecking optional libraries...")
    missing_libs = []
    try:
        print("  ✓ websockets (VNC/SSH console)")
    except ImportError:
        missing_libs.append("websockets")
        print("  ✗ websockets - VNC/SSH console will NOT work!")

    try:
        print("  ✓ paramiko (SSH features)")
    except ImportError:
        missing_libs.append("paramiko")
        print("  ✗ paramiko - SSH features disabled")

    GEVENT_AVAILABLE = False
    try:
        GEVENT_AVAILABLE = True
        print("  ✓ gevent (high performance)")
    except ImportError:
        print("  ✗ gevent - using Flask dev server (slower)")

    try:
        print("  ✓ argon2-cffi (secure password hashing)")
    except ImportError:
        print("  ⚠ argon2-cffi - using PBKDF2 fallback")

    if missing_libs:
        print(f"\n  Install missing: pip install {' '.join(missing_libs)}")
    print()

    # Create Flask app (plugins + push inbox will hit the DB here)
    app = create_app()

    # Init user system
    print("Initializing user system...")
    g.users_db = load_users()
    print(f"Loaded {len(g.users_db)} users")

    # Init audit log
    print("Initializing audit log...")
    load_audit_log()
    print(f"Loaded {len(g.audit_log)} audit entries (retention: {AUDIT_RETENTION_DAYS} days)")

    # Load sessions
    print("Loading sessions...")
    load_sessions()
    print(f"Loaded {len(g.active_sessions)} active sessions")

    # Backfill initialized marker for upgrades from pre-setup-wizard
    # builds (pre-init installs already had users; we just stamp the marker so the
    # /login path's is_initialized() doesn't fall through to NOT_INITIALIZED).
    backfill_initialized_marker()

    if not is_initialized():
        print("\n" + "=" * 50)
        print("FIRST-RUN SETUP REQUIRED")
        print("  No admin account exists yet — open the ProxmoxVEx URL")
        print("  in a browser to create the first administrator via the")
        print("  setup wizard. /api/auth/login is disabled until that")
        print("  is done.")
        print("=" * 50 + "\n")

    # Load existing configuration
    config = load_config()

    # Start managers for existing clusters
    for cluster_id, cluster_data in config.items():
        config_obj = ProxmoxVExConfig(cluster_data)
        manager = ProxmoxVExManager(cluster_id, config_obj)
        manager.start()
        g.cluster_managers[cluster_id] = manager
        print(f"Started ProxmoxVEx manager for cluster: {cluster_data['name']}")

    # Start background threads
    start_broadcast_thread()
    print("Started WebSocket live updates broadcast thread")

    try:
        load_pbs_servers()
    except Exception as e:
        logging.warning(f"Failed to load PBS servers at startup: {e}")

    try:
        load_vmware_servers()
        # Register ESXi hosts as migration-capable clusters
        from ProxmoxVEx.core.esxi_cluster import ESXiClusterManager

        for vmw_id, vmw_mgr in g.vmware_managers.items():
            if getattr(vmw_mgr, "server_type", "") == "esxi":
                g.cluster_managers[vmw_id] = ESXiClusterManager(vmw_id, vmw_mgr)
                logging.info(f"Registered ESXi host '{vmw_mgr.name}' as migration cluster {vmw_id}")
    except Exception as e:
        logging.warning(f"Failed to load VMware servers at startup: {e}")

    start_alert_thread()
    print("Started alert monitoring thread")

    start_scheduler_thread()
    print("Started task scheduler thread")

    # The scheduled_actions scheduler (UI-created schedules,
    # background/scheduler.py only handles the old scheduled_tasks table
    start_actions_scheduler()
    print("Started scheduled actions thread")

    start_password_expiry_thread()
    print("Started password expiry check thread")

    start_cross_cluster_lb_thread()
    print("Started cross-cluster load balancer thread")

    start_cross_cluster_replication_thread()
    print("Started cross-cluster replication scheduler thread")

    try:
        start_syslog_server()
        print("Started integrated syslog server")
    except Exception as e:
        logging.warning(f"Syslog server failed to start: {e}")

    # #238: reset stuck DR plans from a previous crash/restart
    try:
        from datetime import datetime as _dt

        from ProxmoxVEx.core.db import get_db

        _db = get_db()
        stuck = _db.query("SELECT id, name FROM site_recovery_plans WHERE status IN ('running', 'testing')")
        for p in stuck or []:
            _db.execute(
                "UPDATE site_recovery_plans SET status = 'failed', updated_at = ? WHERE id = ?",
                (_dt.now().isoformat(), p["id"]),
            )
            print(f"  Reset stuck DR plan '{p['name']}' → failed")
    except Exception as e:
        print(f"  DR plan reset check failed: {e}")

    from ProxmoxVEx.background.site_recovery import start_heartbeat

    start_heartbeat()
    print("Started site recovery heartbeat monitor")

    # Start plugin background tasks
    from ProxmoxVEx.api.plugins import start_plugin_backgrounds

    start_plugin_backgrounds()

    # Warm up pool cache
    def warmup_pool_cache():
        time.sleep(5)
        for cluster_id in g.cluster_managers:
            try:
                get_pool_membership_cache(cluster_id)
                print(f"  Pool cache warmed for cluster: {cluster_id}")
            except Exception as e:
                print(f"  Warning: Could not warm pool cache for {cluster_id}: {e}")

    threading.Thread(target=warmup_pool_cache, daemon=True).start()
    print("Started pool cache warmup thread")

    # ACME auto-renewal thread
    def acme_renewal_loop():
        time.sleep(30)  # wait for server to fully start
        while True:
            try:
                _settings = load_server_settings()
                if _settings.get("acme_enabled") and _settings.get("domain"):
                    from ProxmoxVEx.core.acme import check_and_renew

                    if Path("/usr/lib/ProxmoxVEx").exists():
                        _ssl = str(Path("/var/lib/ProxmoxVEx/ssl"))
                    else:
                        _ssl = str(Path(__file__).resolve().parent.parent / "ssl")
                    _challenge_type = _settings.get("acme_challenge_type") or "http-01"
                    _dns_provider = _settings.get("acme_dns_provider") or "manual"
                    renewed = check_and_renew(
                        _settings["domain"],
                        _settings.get("acme_email", ""),
                        _ssl,
                        staging=_settings.get("acme_staging", False),
                        directory_url=_settings.get("acme_directory_url", ""),
                        challenge_type=_challenge_type,
                        dns_provider=_dns_provider,
                        dns_config=acme_dns_config_from_settings(_settings),
                    )
                    if renewed:
                        logging.info("[ACME] Certificate renewed, restart required for new cert")
            except Exception as e:
                logging.debug(f"[ACME] Renewal check error: {e}")
            time.sleep(86400)  # check once per day

    threading.Thread(target=acme_renewal_loop, daemon=True).start()
    print("Started ACME auto-renewal thread")

    # Load server settings
    server_settings = load_server_settings()
    port = server_settings.get("port", 5000)
    bind_host = os.environ.get("PROXMOXVEX_HOST")

    # Reverse proxy mode: skip SSL, bind localhost, trust proxy headers
    reverse_proxy = server_settings.get("reverse_proxy_enabled", False)
    if os.environ.get("PROXMOXVEX_BEHIND_PROXY", "").lower() in ("1", "true", "yes"):
        reverse_proxy = True

    # load trusted proxy IPs for X-Forwarded-For (loopback always trusted)
    from ProxmoxVEx.utils.audit import load_trusted_proxies

    trusted = os.environ.get("PROXMOXVEX_TRUSTED_PROXIES", "") or server_settings.get("trusted_proxies", "")
    load_trusted_proxies(trusted)
    if trusted:
        print(f"Trusted proxies: {trusted}")

    if not bind_host:
        if reverse_proxy:
            custom_bind = server_settings.get("proxy_bind_address", "").strip()
            if custom_bind:
                bind_host = custom_bind
                print(f"Reverse proxy mode — custom bind: {bind_host}")
            else:
                bind_host = "127.0.0.1"
                print("Reverse proxy mode — binding to 127.0.0.1 only")
        elif os.environ.get("PROXMOXVEX_BIND_ALL", "").lower() not in ("1", "true", "yes"):
            bind_host = "127.0.0.1"
            print("PROXMOXVEX_BIND_ALL not set — binding to 127.0.0.1 only")
        elif _test_ipv6_available():
            bind_host = "::"
            print("IPv6 available — binding dual-stack (::)")
        else:
            bind_host = "0.0.0.0"  # nosec: B104 - fallback when IPv6 unavailable
            print("IPv6 not available — binding IPv4 only (0.0.0.0)")
    else:
        if ":" in bind_host and not _test_ipv6_available():
            print(f"WARNING: IPv6 bind address '{bind_host}' requested but IPv6 not available")
            print("Falling back to 0.0.0.0")
            bind_host = "0.0.0.0"  # nosec: B104 - operator-configured fallback

    # When behind proxy, SSL is handled by nginx/haproxy - we run plain HTTP
    ssl_enabled = server_settings.get("ssl_enabled", False) and not reverse_proxy
    domain = server_settings.get("domain", "")
    app_name = server_settings.get("app_name", "ProxmoxVEx")
    if reverse_proxy:
        print("SSL disabled (handled by reverse proxy)")

    # Check for SSL certificates (skip entirely behind reverse proxy)
    ssl_context = None
    if reverse_proxy:
        pass  # nginx handles SSL
    elif ssl_enabled and os.path.exists(SSL_CERT_FILE) and os.path.exists(SSL_KEY_FILE):
        ssl_context = (SSL_CERT_FILE, SSL_KEY_FILE)
        print("Custom SSL certificates found - starting with HTTPS")
    else:
        # We validate this path for the Debian package
        if Path("/usr/lib/ProxmoxVEx").exists():
            DATA_DIR = Path("/var/lib/ProxmoxVEx")
        else:
            DATA_DIR = Path(__file__).resolve().parent.parent

        DATA_DIR / "ssl"

        # 2026-06-08 (#531): generate the self-signed cert into the persisted
        # config/ssl dir (the same path the custom-cert check above uses + the one
        # that survives a `docker compose pull`) AND create it first. On a fresh
        # container the old /app/ssl target didn't exist, so generation failed with
        # ENOENT, ProxmoxVEx fell back to plain HTTP, and a browser hitting it over
        # HTTPS got a TLS-to-HTTP "connection error" — login was impossible.
        cert_file = SSL_CERT_FILE
        key_file = SSL_KEY_FILE
        with contextlib.suppress(Exception):
            os.makedirs(os.path.dirname(cert_file), exist_ok=True)

        if os.path.exists(cert_file) and os.path.exists(key_file):
            ssl_context = (cert_file, key_file)
            print("SSL certificates found - starting with HTTPS")
        else:
            print("No SSL certificates found. Generating self-signed certificate...")
            try:
                from OpenSSL import crypto

                key = crypto.PKey()
                key.generate_key(crypto.TYPE_RSA, 2048)
                cert = crypto.X509()
                cert.get_subject().C = "DE"
                cert.get_subject().ST = "State"
                cert.get_subject().L = "City"
                cert.get_subject().O = app_name or "ProxmoxVEx"
                cert.get_subject().OU = app_name or "ProxmoxVEx"
                cert.get_subject().CN = domain or app_name or "ProxmoxVEx"
                cert.set_serial_number(1000)
                cert.gmtime_adj_notBefore(0)
                cert.gmtime_adj_notAfter(365 * 24 * 60 * 60)
                cert.set_issuer(cert.get_subject())
                cert.set_pubkey(key)
                cert.sign(key, "sha256")
                with open(cert_file, "wb") as f:
                    f.write(crypto.dump_certificate(crypto.FILETYPE_PEM, cert))
                with open(key_file, "wb") as f:
                    f.write(crypto.dump_privatekey(crypto.FILETYPE_PEM, key))
                os.chmod(key_file, 0o600)
                ssl_context = (cert_file, key_file)
                print(f"Self-signed certificate generated: {cert_file}")
            except ImportError:
                print("WARNING: pyOpenSSL not installed. Run: pip install pyOpenSSL")
                print("Starting without HTTPS (noVNC may not work)")
            except Exception as e:
                print(f"WARNING: Could not generate SSL certificate: {e}")
                print("Starting without HTTPS (noVNC may not work)")

    # Start HTTP redirect server if SSL is enabled (not needed behind reverse proxy)
    http_redirect_port = server_settings.get("http_redirect_port", 0)
    if http_redirect_port == 0:
        http_redirect_port = 80 if os.geteuid() == 0 else -1
    http_redirect_port = int(os.environ.get("PROXMOXVEX_HTTP_PORT", http_redirect_port))

    if ssl_context and http_redirect_port > 0 and not reverse_proxy:
        redirect_thread = threading.Thread(
            target=_start_http_redirect, args=(bind_host, http_redirect_port, port, domain), daemon=True
        )
        redirect_thread.start()
        print(f"Started additional HTTP -> HTTPS redirect on port {http_redirect_port}")

    # Determine workers
    # 2026-05-31 (v2) - auto-scale with CPU, no hardcoded cap.
    # Two-part fix:
    #   (1) `workers` was previously just a log-label — _start_gevent_server
    #       prints "(N greenlets)" but never passed `spawn=Pool(N)` to
    #       WSGIServer, so the server actually spawned UNLIMITED greenlets.
    #       Now plumbed through (see _start_gevent_server below).
    #   (2) Formula changed: `min(cpu_count*2, 16)` capped huge customer
    #       boxes at 16. `max(8, cpu_count * 4)` gives:
    #           1c VM:   8 workers
    #           4c:     16 workers (same as old default)
    #           8c:     32 workers
    #           32c:   128 workers
    #       gevent greenlets are extremely cheap (a few KB stack) so 100s
    #       per request handler are fine; the I/O-bound workload benefits
    #       from a generous pool when /health + /vms-backup-status + a
    #       dashboard refresh all fire at the same time.
    # 2026-06-05 - raised floor + multiplier: EACH live SSE/WebSocket stream
    # holds a pool slot for its whole lifetime, so max(8, cpu*4) (=16 on a 4c
    # box) could be consumed by ~16 open dashboard tabs and starve all other API
    # traffic (root of #526's "health spammed, absurdly large time"). Greenlets
    # are cheap so a big pool is fine. Still PROXMOXVEX_WORKERS-overridable.
    #           1c VM: 32    4c: 64    8c: 128    32c: 512
    cpu_count = multiprocessing.cpu_count()
    workers = int(os.environ.get("PROXMOXVEX_WORKERS", max(32, cpu_count * 16)))

    print(f"System: {cpu_count} CPU cores detected")
    print(f"Memory optimization: Garbage collection tuned for {workers} workers")
    gc.set_threshold(700, 10, 10)

    # Start with Gevent if available
    use_gevent = os.environ.get("PROXMOXVEX_SERVER", "auto").lower()

    if (use_gevent == "gevent" or (use_gevent == "auto" and GEVENT_AVAILABLE)) and GEVENT_AVAILABLE:
        _start_gevent_server(app, bind_host, port, ssl_context, domain, workers, http_redirect_port)
        return

    # Fallback to Flask development server
    print("Starting ProxmoxVEx with Flask development server")
    print("WARNING: Not recommended for production!")
    print("Install gevent for better performance: pip install gevent")

    port + 1
    port + 2

    kill_existing_on_port(port, "tcp")

    # Start VNC/SSH WebSocket servers
    _start_console_servers(bind_host, port, ssl_context)

    if ssl_context:
        print(f"HTTPS on https://{bind_host}:{port}")
        app.run(host=bind_host, port=port, debug=False, ssl_context=ssl_context, threaded=True)
    else:
        print(f"HTTP on http://{bind_host}:{port}")
        app.run(host=bind_host, port=port, debug=False, threaded=True)


def _start_console_servers(bind_host, port, ssl_context):
    """Start VNC and SSH WebSocket servers on port+1 and port+2."""
    vnc_ws_port = port + 1
    ssh_ws_port = port + 2

    try:
        from ProxmoxVEx.api.vms import start_ssh_websocket_server, start_vnc_websocket_server
    except ImportError as e:
        print(f"WARNING: Console WebSocket servers not available: {e}")
        return

    # Asyncio/websockets creates IPv6-only socket for '::'
    # Use '' so asyncio binds to ALL interfaces (creates both IPv4 + IPv6 listeners)
    console_host = "" if bind_host == "::" else bind_host

    # Start each server independently so one failure doesn't block the other
    for name, start_fn, ws_port in [
        ("VNC", start_vnc_websocket_server, vnc_ws_port),
        ("SSH", start_ssh_websocket_server, ssh_ws_port),
    ]:
        try:
            if ssl_context:
                start_fn(ws_port, ssl_cert=ssl_context[0], ssl_key=ssl_context[1], host=console_host)
            else:
                start_fn(ws_port, host=console_host)
        except Exception as e:
            print(f"ERROR: {name} WebSocket server (port {ws_port}) failed to start: {e}")
            logging.error(f"{name} WebSocket server startup failed: {e}", exc_info=True)


def _test_ipv6_available():
    """Test if the system supports IPv6 sockets - Issue #71"""
    try:
        s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("::", 0))
        s.close()
        return True
    except OSError:
        return False


def _start_http_redirect(bind_host, http_redirect_port, https_port, domain):
    """Start a simple HTTP server that redirects to HTTPS using raw sockets"""
    try:
        kill_existing_on_port(http_redirect_port, "tcp")
        use_ipv6 = ":" in bind_host
        af = socket.AF_INET6 if use_ipv6 else socket.AF_INET
        sock = socket.socket(af, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if use_ipv6:
            sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        sock.bind((bind_host, http_redirect_port))
        sock.listen(100)
        sock.settimeout(1.0)

        print(f"HTTP redirect server listening on port {http_redirect_port}")

        while True:
            try:
                client, addr = sock.accept()
                client.settimeout(5.0)
                try:
                    request = client.recv(4096).decode("utf-8", errors="ignore")
                    path = "/"
                    if request:
                        first_line = request.split("\r\n")[0]
                        parts = first_line.split(" ")
                        if len(parts) >= 2:
                            path = parts[1].replace("\r", "").replace("\n", "")

                    # Serve ACME challenges on port 80 instead of redirecting
                    if path.startswith("/.well-known/acme-challenge/"):
                        acme_token = path.split("/")[-1]
                        from ProxmoxVEx.core.acme import get_challenge_response

                        challenge_resp = get_challenge_response(acme_token)
                        if challenge_resp:
                            http_resp = (
                                f"HTTP/1.1 200 OK\r\n"
                                f"Content-Type: text/plain\r\n"
                                f"Content-Length: {len(challenge_resp)}\r\n"
                                f"Connection: close\r\n"
                                f"\r\n"
                                f"{challenge_resp}"
                            )
                            client.sendall(http_resp.encode())
                            client.close()
                            continue

                    host_header = ""
                    fwd_proto = ""
                    fwd_port = ""
                    for line in request.split("\r\n"):
                        low = line.lower()
                        if low.startswith("host:"):
                            host_value = line.split(":", 1)[1].strip()
                            host_header = host_value.rsplit(":", 1)[0] if ":" in host_value else host_value
                        elif low.startswith("x-forwarded-proto:"):
                            fwd_proto = line.split(":", 1)[1].strip().lower()
                        elif low.startswith("x-forwarded-port:"):
                            fwd_port = line.split(":", 1)[1].strip()

                    # behind reverse proxy with SSL termination? skip redirect (#125)
                    from ProxmoxVEx.utils.audit import _is_trusted_proxy

                    if fwd_proto == "https" and _is_trusted_proxy(addr[0]):
                        continue

                    # (CodeAnt http-response-splitting) - host_header is untrusted;
                    # strip CR/LF + reject non-hostname chars before it can reach the Location header.
                    import re as _re

                    redirect_host = (host_header or "localhost").split("/")[0].strip()
                    if not _re.match(r"^[A-Za-z0-9._\-\[\]:]+$", redirect_host):
                        redirect_host = "localhost"
                    if domain:
                        if ":" in domain and not domain.startswith("["):
                            redirect_host = domain.rsplit(":", 1)[0]
                        else:
                            redirect_host = domain

                    port = int(fwd_port) if fwd_port else https_port
                    if port == 443:
                        redirect_url = f"https://{redirect_host}{path}"
                    else:
                        redirect_url = f"https://{redirect_host}:{port}{path}"

                    response = (
                        f"HTTP/1.1 301 Moved Permanently\r\n"
                        f"Location: {redirect_url}\r\n"
                        f"Content-Length: 0\r\n"
                        f"Connection: close\r\n"
                        f"\r\n"
                    )
                    client.sendall(response.encode())
                except Exception as _e:
                    pass
                finally:
                    with contextlib.suppress(Exception):
                        client.close()
            except socket.timeout:
                continue
            except Exception as e:
                if "Bad file descriptor" not in str(e):
                    logging.debug(f"HTTP redirect accept error: {e}")
                continue
    except PermissionError:
        print(f"WARNING: Cannot bind to port {http_redirect_port} (requires root). HTTP redirect not available.")
    except OSError as e:
        if "Address already in use" in str(e):
            print(f"WARNING: Port {http_redirect_port} already in use. HTTP redirect not available.")
        else:
            print(f"WARNING: HTTP redirect server failed: {e}")
    except Exception as e:
        print(f"WARNING: HTTP redirect server failed: {e}")


def _create_listener(bind_host, port_num):
    """Create a listener socket, IPv6 dual-stack if needed - Issue #71"""
    is_ipv6 = ":" in bind_host
    if is_ipv6:
        try:
            listener = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            listener.bind((bind_host, port_num))
            listener.listen(128)
            listener.setblocking(False)
            return listener
        except OSError as e:
            print(f"WARNING: IPv6 listener on port {port_num} failed ({e}), using IPv4")
            return ("0.0.0.0", port_num)  # nosec: B104 - IPv4 fallback after IPv6 failure
    else:
        return (bind_host, port_num)


def _start_gevent_server(app, bind_host, port, ssl_context, domain, workers, http_redirect_port=-1):
    """Start production server with Gevent."""
    import gevent
    from gevent.pywsgi import WSGIServer

    print(f"Starting ProxmoxVEx with Gevent WSGIServer ({workers} greenlets)", flush=True)
    print("Mode: Production (async I/O optimized)", flush=True)

    kill_existing_on_port(port, "tcp")

    # Suppress noisy errors from bots/scanners/disconnects
    import logging as log_module

    log_module.getLogger("gevent").setLevel(log_module.CRITICAL)
    log_module.getLogger("gevent.pywsgi").setLevel(log_module.CRITICAL)
    log_module.getLogger("websockets").setLevel(log_module.CRITICAL)
    log_module.getLogger("websockets.server").setLevel(log_module.CRITICAL)
    log_module.getLogger("websockets.asyncio").setLevel(log_module.CRITICAL)

    # Monkey-patch traceback to suppress SSL errors
    # gevent uses traceback.print_exception directly, bypassing logging
    import traceback as tb_module

    _original_print_exception = tb_module.print_exception
    _original_print_exc = tb_module.print_exc
    _original_format_exception = tb_module.format_exception

    def quiet_print_exception(exc, value=None, tb=None, limit=None, file=None, chain=True):
        exc_type = exc if isinstance(exc, type) else type(exc)
        if exc_type and "ssl" in exc_type.__name__.lower():
            return
        if value and "ssl" in str(value).lower():
            return
        _original_print_exception(exc, value, tb, limit, file, chain)

    def quiet_print_exc(limit=None, file=None, chain=True):
        exc_type, exc_value, exc_tb = sys.exc_info()
        if exc_type and "ssl" in exc_type.__name__.lower():
            return
        _original_print_exc(limit, file, chain)

    def quiet_format_exception(exc, value=None, tb=None, limit=None, chain=True):
        exc_type = exc if isinstance(exc, type) else type(exc)
        if exc_type and "ssl" in exc_type.__name__.lower():
            return []
        return _original_format_exception(exc, value, tb, limit, chain)

    tb_module.print_exception = quiet_print_exception
    tb_module.print_exc = quiet_print_exc
    tb_module.format_exception = quiet_format_exception

    # Also filter stderr directly as last resort
    class SSLFilteredStderr:
        def __init__(self, original):
            self._original = original
            self._buffer = []
            self._in_ssl_traceback = False

        def write(self, text):
            if "Traceback (most recent call last):" in text:
                self._in_ssl_traceback = False
                self._buffer = [text]
                return len(text)
            if self._buffer:
                self._buffer.append(text)
                full_text = "".join(self._buffer)
                if "SSLEOFError" in full_text or "ssl.SSL" in full_text:
                    self._in_ssl_traceback = True
                if text.strip() and not text.startswith(" ") and not text.startswith("Traceback"):
                    if self._in_ssl_traceback:
                        self._buffer = []
                        self._in_ssl_traceback = False
                        return len(text)
                    else:
                        for line in self._buffer:
                            self._original.write(line)
                        self._buffer = []
                return len(text)
            return self._original.write(text)

        def flush(self):
            if self._buffer and not self._in_ssl_traceback:
                for line in self._buffer:
                    self._original.write(line)
            self._buffer = []
            self._original.flush()

        def __getattr__(self, name):
            return getattr(self._original, name)

    sys.stderr = SSLFilteredStderr(sys.stderr)

    os.environ["GEVENT_DEBUG"] = "off"

    # WebSocket handler
    use_websocket_handler = False
    try:
        from geventwebsocket.handler import WebSocketHandler

        use_websocket_handler = True
        print("WebSocket support: geventwebsocket enabled")
    except ImportError:
        use_websocket_handler = False
        print("WebSocket support: geventwebsocket NOT installed")
        print("  Install with: pip install gevent-websocket")

    # Custom handler to suppress SSL error tracebacks completely
    # These happen when users close browser tabs - totally normal
    if use_websocket_handler:

        class QuietWebSocketHandler(WebSocketHandler):
            def run_application(self):
                # Only run the WebSocket upgrade handshake for real WebSocket
                # routes (/api/ws/*). SSE and REST POSTs skip it entirely and
                # go straight to the Flask WSGI app.
                path = self.environ.get("PATH_INFO", "")
                if not path.startswith("/api/ws/"):
                    return super(WebSocketHandler, self).run_application()
                return super().run_application()

            def handle_one_response(self):
                try:
                    return super().handle_one_response()
                except Exception as e:
                    if "ssl" in type(e).__name__.lower() or "ssl" in str(e).lower():
                        return
                    raise

            def log_error(self, msg, *args):
                if "ssl" in str(msg).lower() or "eof" in str(msg).lower():
                    return
                super().log_error(msg, *args)

    else:
        QuietWebSocketHandler = None

    # Custom error handler to suppress SSL errors (from bots/scanners/disconnects)
    class QuietWSGIServer(WSGIServer):
        def wrap_socket_and_handle(self, client_socket, address):
            """Override to catch SSL errors during handshake"""
            try:
                return super().wrap_socket_and_handle(client_socket, address)
            except Exception as e:
                if "ssl" in str(type(e).__name__).lower() or "ssl" in str(e).lower():
                    pass
                else:
                    raise

        def handle_error(self, *args):
            """Suppress SSL errors - they're normal with self-signed certs"""
            exc_info = sys.exc_info()
            exc_type = exc_info[0]
            if exc_type is not None and "ssl" in exc_type.__name__.lower():
                return
            pass

        def log_error(self, msg, *args):
            """Suppress SSL error logging"""
            msg_lower = str(msg).lower()
            if "ssl" in msg_lower or "eof" in msg_lower or "broken pipe" in msg_lower:
                return
            print(f"[Server Error] {msg % args if args else msg}")

    # DualProtocolWSGIServer - HTTP and HTTPS on same port
    # If someone visits http://server:5000, they get redirected to https://server:5000
    class DualProtocolWSGIServer(QuietWSGIServer):
        """WSGI Server that detects HTTP vs HTTPS and redirects HTTP to HTTPS"""

        def __init__(self, *args, redirect_domain=None, **kwargs):
            self._redirect_domain = redirect_domain
            super().__init__(*args, **kwargs)

        def wrap_socket_and_handle(self, client_socket, address):
            """Peek at first bytes to detect protocol"""
            if not self.ssl_args:
                return super().wrap_socket_and_handle(client_socket, address)
            try:
                first_byte = client_socket.recv(1, socket.MSG_PEEK)
                if not first_byte:
                    client_socket.close()
                    return
                if first_byte[0] == 0x16 or first_byte[0] == 0x80:
                    return super().wrap_socket_and_handle(client_socket, address)
                else:
                    # #125 - reverse proxy with SSL termination? serve as plain HTTP
                    # only trust forwarded headers from loopback / configured trusted proxies
                    from ProxmoxVEx.utils.audit import _is_trusted_proxy

                    if _is_trusted_proxy(address[0]):
                        try:
                            peek = client_socket.recv(8192, socket.MSG_PEEK)
                            if b"x-forwarded-proto" in peek.lower():
                                for hdr in peek.decode("utf-8", errors="ignore").split("\r\n"):
                                    if hdr.lower().startswith("x-forwarded-proto:"):
                                        if hdr.split(":", 1)[1].strip().lower() == "https":
                                            return self.handle(client_socket, address)
                                        break
                        except Exception as _e:
                            pass
                    self._handle_http_redirect(client_socket, address)
                    return
            except Exception as e:
                if "ssl" in str(type(e).__name__).lower():
                    return
                try:
                    return super().wrap_socket_and_handle(client_socket, address)
                except Exception as _e:
                    pass

        def _handle_http_redirect(self, client_socket, address):
            """Send HTTP 301 redirect to HTTPS version"""
            try:
                client_socket.settimeout(5.0)
                request_data = b""
                while b"\r\n\r\n" not in request_data and len(request_data) < 8192:
                    chunk = client_socket.recv(1024)
                    if not chunk:
                        break
                    request_data += chunk

                request = request_data.decode("utf-8", errors="ignore")
                path = "/"
                if request:
                    first_line = request.split("\r\n")[0]
                    parts = first_line.split(" ")
                    if len(parts) >= 2:
                        path = parts[1].replace("\r", "").replace("\n", "")

                host = self._redirect_domain or "localhost"
                for line in request.split("\r\n"):
                    if line.lower().startswith("host:"):
                        host_value = line.split(":", 1)[1].strip()
                        if host_value.startswith("["):
                            host = host_value.rsplit(":", 1)[0] if "]:" in host_value else host_value
                        elif ":" in host_value:
                            host = host_value.rsplit(":", 1)[0]
                        else:
                            host = host_value
                        break

                # (CodeAnt http-response-splitting) - the Host header is untrusted;
                # reject non-hostname chars before it can reach the Location header (open-redirect
                # / header injection). A configured _redirect_domain (below) always wins.
                import re as _re

                if not _re.match(r"^[A-Za-z0-9._\-\[\]:]+$", host or ""):
                    host = "localhost"

                if self._redirect_domain:
                    d = self._redirect_domain
                    host = d.rsplit(":", 1)[0] if ":" in d and not d.startswith("[") else d

                # #125 - respect proxy headers so we don't redirect to internal port
                fwd_proto = ""
                fwd_port = ""
                for line in request.split("\r\n"):
                    lower = line.lower()
                    if lower.startswith("x-forwarded-proto:"):
                        fwd_proto = line.split(":", 1)[1].strip().lower()
                    elif lower.startswith("x-forwarded-port:"):
                        fwd_port = line.split(":", 1)[1].strip()

                if fwd_proto == "https":
                    # already behind SSL-terminating proxy, don't redirect
                    return

                port = int(fwd_port) if fwd_port else self.server_port
                redirect_url = f"https://{host}{path}" if port == 443 else f"https://{host}:{port}{path}"

                response = (
                    f"HTTP/1.1 301 Moved Permanently\r\n"
                    f"Location: {redirect_url}\r\n"
                    f"Content-Type: text/html\r\n"
                    f"Content-Length: 0\r\n"
                    f"Connection: close\r\n"
                    f"\r\n"
                )
                client_socket.sendall(response.encode())
            except Exception as _e:
                pass
            finally:
                with contextlib.suppress(Exception):
                    client_socket.close()

    # Server args - add WebSocket handler if available
    # 2026-05-31 - actually wire `workers` into the request-handler pool.
    # gevent.pywsgi.WSGIServer defaults to `spawn=None` which spawns an
    # unlimited greenlet per request. PROXMOXVEX_WORKERS was a startup-log
    # label only — never enforced. Now caps the request-handling pool at
    # `workers`; per-request fanouts (storage scan, PBS scan, SSH calls)
    # still spawn inside their own request handler.
    from gevent.pool import Pool as _RequestPool

    server_kwargs = {"log": None, "spawn": _RequestPool(workers)}
    if use_websocket_handler and QuietWebSocketHandler is not None:
        server_kwargs["handler_class"] = QuietWebSocketHandler

    if ssl_context:
        print(f"HTTPS on https://{bind_host}:{port}", flush=True)
        ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ssl_ctx.load_cert_chain(ssl_context[0], ssl_context[1])
        # Http_redirect_port == -1 disables ALL http→https redirect
        # including the dual-protocol detection on the main port
        if http_redirect_port < 0:
            http_server = QuietWSGIServer(_create_listener(bind_host, port), app, ssl_context=ssl_ctx, **server_kwargs)
        else:
            http_server = DualProtocolWSGIServer(
                _create_listener(bind_host, port), app, ssl_context=ssl_ctx, redirect_domain=domain, **server_kwargs
            )
    else:
        print(f"HTTP on http://{bind_host}:{port}", flush=True)
        print("WARNING: Running without HTTPS - noVNC console may not work!", flush=True)
        http_server = QuietWSGIServer(_create_listener(bind_host, port), app, **server_kwargs)

    # Start VNC/SSH WebSocket servers
    _start_console_servers(bind_host, port, ssl_context)

    # Handle graceful shutdown
    def signal_handler(signum, frame):
        print("\nShutting down gracefully...")
        gevent.spawn(http_server.stop)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    print("SSL/WebSocket errors (bots, scanners, disconnects) are suppressed")
    http_server.serve_forever()
