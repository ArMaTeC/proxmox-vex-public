#!/usr/bin/env python3
# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx_multi_cluster.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Proxmoxvex Multi Cluster PY source
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
import os
import sys
import warnings

# Gevent can be disabled with PROXMOXVEX_NO_GEVENT=1 for debugging or when it is
# not installed. When enabled, it patches the standard library to be async and
# raises file-descriptor and thread-pool limits for large-scale use.
USE_GEVENT = os.environ.get("PROXMOXVEX_NO_GEVENT", "").lower() not in ("1", "true", "yes")

if USE_GEVENT:
    try:
        from gevent import monkey

        monkey.patch_all()
        print("Gevent monkey-patching applied")
        # 2026-06-05 - scale runtime limits for large fleets (30+ clusters /
        # 100+ nodes). The node-status fan-out pools + keep-alive sessions need
        # fd headroom, and gevent's default 10-thread pool (used by the DNS
        # resolver AND off-hub DB reads) contends under that load — see #528.
        # All env-overridable.
        try:
            import resource as _res

            _soft, _hard = _res.getrlimit(_res.RLIMIT_NOFILE)
            _cap = 65536 if _hard == _res.RLIM_INFINITY else _hard
            _want = int(os.environ.get("PROXMOXVEX_NOFILE") or str(_cap))
            _newsoft = _want if _hard == _res.RLIM_INFINITY else min(_want, _hard)
            _res.setrlimit(_res.RLIMIT_NOFILE, (_newsoft, _hard))
            _eff = _res.getrlimit(_res.RLIMIT_NOFILE)[0]
            print(f"File-descriptor limit: {_eff}")
            if _eff < 8192:
                print(f"WARNING: low fd limit ({_eff}) — for 20+ clusters set LimitNOFILE=65536 in the systemd unit")
        except Exception as _e:
            print(f"Could not raise fd limit: {_e}")
        try:
            from gevent import get_hub as _ghub

            _tp = int(os.environ.get("PROXMOXVEX_THREADPOOL_SIZE") or "50")
            _ghub().threadpool.maxsize = _tp
            print(f"Gevent threadpool size: {_tp}")
        except Exception as _e:
            print(f"Could not set gevent threadpool size: {_e}")
    except ImportError:
        pass

warnings.filterwarnings("ignore", message="coroutine.*was never awaited")
warnings.filterwarnings("ignore", category=RuntimeWarning, module="asyncio")


def _disable_simple_websocket_deflate():
    """Patch simple-websocket to suppress the PerMessageDeflate extension.

    The library hard-codes the extension on AcceptConnection which causes it to
    send RSV1=1 frames even when negotiation did not take place. Strict RFC-6455
    clients then reject every frame. We replace the AcceptConnection class so
    the extensions list is always empty.
    """
    try:
        import simple_websocket.ws as _swws
        from wsproto.events import AcceptConnection as _Accept

        _orig = _swws.Server._handle_events

        # Replace the hard-coded extension with no extensions on the
        # AcceptConnection emission. We monkey-patch by overriding the
        # AcceptConnection class so any kw passed gets stripped.
        class _NoExtAccept(_Accept):
            def __init__(self, *a, **kw):
                kw.pop("extensions", None)
                super().__init__(*a, **kw)

        _swws.AcceptConnection = _NoExtAccept
        print("[ws-patch] simple-websocket PerMessageDeflate disabled")
    except Exception as _e:
        print(f"[ws-patch] could not disable deflate: {_e}")


_disable_simple_websocket_deflate()


def print_system_requirements():
    """Print the recommended hardware and network requirements guide."""
    print("""
╔══════════════════════════════════════════════════════════════════════════════╗
║                    ProxmoxVEx System Requirements Guide                         ║
║                           Version 0.7.0 Beta - Feb 2026                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Clusters │ Concurrent │  CPU    │  RAM   │  Disk  │  Notes                  ║
║           │   Users    │ Cores   │        │        │                         ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  1-5      │  1-5       │ 1 core  │  1 GB  │  1 GB  │  Testing/Home Lab       ║
║  5-20     │  5-10      │ 2 cores │  2 GB  │  5 GB  │  Small Production       ║
║  20-50    │  10-25     │ 4 cores │  4 GB  │ 10 GB  │  Medium Production      ║
║  50-100   │  25-50     │ 4 cores │  8 GB  │ 20 GB  │  Large Production       ║
║  100-200  │  50-100    │ 8 cores │ 16 GB  │ 50 GB  │  Enterprise             ║
║  200+     │  100+      │ 16 cores│ 32 GB  │100 GB  │  Large Enterprise       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Performance Tips:                                                            ║
║  • Install gevent: pip install gevent (2-3x better concurrency)              ║
║  • Set workers: ProxmoxVEx_WORKERS=<cpu_count>                                 ║
║  • Use SSD for config storage (faster JSON read/write)                       ║
║  • Place behind nginx/haproxy for SSL termination & load balancing           ║
║  • Enable gzip compression in reverse proxy                                  ║
║  • Use Redis for session storage in multi-node setups (future)               ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Network Requirements:                                                        ║
║  • Port 5000: Main API & Web UI (configurable via ProxmoxVEx_PORT)             ║
║  • Port 5001: VNC WebSocket (noVNC console) - auto: main_port + 1            ║
║  • Port 5002: SSH WebSocket (Node shell) - auto: main_port + 2               ║
║  • HTTPS recommended (--ssl-cert/--ssl-key or auto-generated)                ║
║  • Access to all Proxmox nodes on port 8006                                  ║
║  • Self-signed certs: Users must accept cert on ports 5001/5002 separately   ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Dependencies:                                                                ║
║  • Python 3.8+ (3.10+ recommended)                                           ║
║  • Flask, flask-sock, requests, urllib3                                      ║
║  • paramiko (for SSH shell)                                                  ║
║  • websockets (for VNC and SSH WebSocket servers)                            ║
║  • gevent (optional, for better performance)                                 ║
║  • websocket-client (for Proxmox VNC proxy)                                  ║
╚══════════════════════════════════════════════════════════════════════════════╝
""")


def download_static_files():
    """Download all required static files for offline operation."""
    # Import from the package
    from ProxmoxVEx.app import download_static_files as _download

    return _download()


if __name__ == "__main__":
    # CLI dispatch. Server startup is the default; the other branches are
    # short-lived administrative commands that should not start gevent etc.
    if "--requirements" in sys.argv:
        print_system_requirements()
    elif "--download-static" in sys.argv:
        download_static_files()
    # Key-management CLI subcommands. These short-circuit the normal
    # server startup so an admin can run them on a stopped instance
    # without --debug spinning up gevent etc.
    elif "--print-key" in sys.argv:
        # Print the resolved master key (base64) — for use by `systemd-creds
        # encrypt`, secret-manager handoff, or `.env` setup.  Output goes to
        # stdout only; stderr gets a one-line provenance note.
        from ProxmoxVEx.core.keystore import load_master_key

        mk = load_master_key()
        sys.stderr.write(
            f"[KEYSTORE] master key source: {mk.source}{' (' + mk.source_path + ')' if mk.source_path else ''}\n"
        )
        sys.stdout.buffer.write(mk.key_b64)
        sys.stdout.flush()
        sys.exit(0)
    elif "--keystore-status" in sys.argv:
        # Human-readable status of the current key + DB-backend.
        import json as _json

        from ProxmoxVEx.core.dbcrypto import backend_status as _db_status
        from ProxmoxVEx.core.keystore import health_status as _ks_health

        print(_json.dumps({"keystore": _ks_health(), "db": _db_status()}, indent=2))
        sys.exit(0)
    elif "--help" in sys.argv or "-h" in sys.argv:
        print("""
ProxmoxVEx Server

Usage:
  python ProxmoxVEx_multi_cluster.py [options]

Options:
  --debug           verbose logging
  --requirements    show requirements
  --download-static download js libs for offline mode
  --print-key       print the resolved master key (base64) to stdout
  --keystore-status JSON dump of key-source + DB-backend status
  --help, -h        this message

Env vars:
  ProxmoxVEx_DB_KEY            master key (urlsafe-base64 or hex)
  ProxmoxVEx_KEY_FILE          path to key file (overrides default lookup chain)
  CREDENTIALS_DIRECTORY      systemd LoadCredentialEncrypted directory
  ProxmoxVEx_ALLOWED_ORIGINS   cors origins
  ProxmoxVEx_MAX_REQUEST_SIZE  max API request size (default 10MB)
  ProxmoxVEx_MAX_UPLOAD_SIZE   max file upload size (default 4GB)
  ProxmoxVEx_HTTP_PORT         http port for redirect (default 80)
        """)
    else:
        debug_mode = "--debug" in sys.argv
        import faulthandler
        import signal

        faulthandler.enable()
        faulthandler.register(signal.SIGUSR1)
        try:
            from ProxmoxVEx.app import main
        except ImportError as e:
            # Distinguish missing package from missing dependencies
            script_dir = os.path.dirname(os.path.abspath(__file__))
            pkg_dir = os.path.join(script_dir, "ProxmoxVEx")
            venv_python = os.path.join(script_dir, "venv", "bin", "python3")
            venv_python2 = os.path.join(script_dir, "venv", "bin", "python")

            if not os.path.isdir(pkg_dir) or not os.path.isfile(os.path.join(pkg_dir, "__init__.py")):
                print("\n  ProxmoxVEx/ package not found - incomplete update?")
                print("  Run ./update.sh to finish the update.\n")
            elif os.path.exists(venv_python) or os.path.exists(venv_python2):
                venv_bin = venv_python if os.path.exists(venv_python) else venv_python2
                print(f"\n  Missing dependency: {e}")
                print("\n  A virtual environment exists. Use it to start ProxmoxVEx:")
                print(f"    {venv_bin} {os.path.abspath(__file__)}")
                print("\n  Or via systemd:")
                print("    systemctl start ProxmoxVEx\n")
            else:
                print(f"\n  Missing dependency: {e}")
                print("\n  Install requirements first:")
                print("    pip install -r requirements.txt")
                print("\n  Or create a venv:")
                print(f"    python3 -m venv {os.path.join(script_dir, 'venv')}")
                print(f"    {venv_python} -m pip install -r requirements.txt")
                print(f"    {venv_python} {os.path.abspath(__file__)}\n")
            sys.exit(1)
        main(debug_mode=debug_mode)
