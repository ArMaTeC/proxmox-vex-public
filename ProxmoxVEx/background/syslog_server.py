# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/background/syslog_server.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: ProxmoxVEx Syslog Server — receives syslog messages via...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
ProxmoxVEx Syslog Server — receives syslog messages via UDP/TCP
Stores events in SQLite for the integrated log viewer.

Rewritten for gevent compatibility (no asyncio, no multiprocessing)
Original PR by gyptazy, adapted to fit ProxmoxVEx architecture.
"""

import contextlib
import logging
import os
import queue as _queue
import threading
import time
from datetime import datetime

from ProxmoxVEx.core.db_pg import PGConnection, _pg_dsn
from ProxmoxVEx.utils.server_control import kill_existing_on_port

SEVERITY_MAP = {0: "emergency", 1: "alert", 2: "critical", 3: "error", 4: "warning", 5: "notice", 6: "info", 7: "debug"}

_syslog_thread = None

# 2026-06-05 (audit N1): the listener used to do a full SQLCipher open+keying
# + INSERT + commit + close PER PACKET on the gevent hub — an unauthenticated
# UDP/1514 flood = hundreds of keyings/sec = the whole web process wedges.
# Now the packet path only enqueues (no DB work) onto a BOUNDED queue (floods
# drop instead of buffering), and a single drain greenlet writes batches OFF the
# hub via the gevent threadpool (one keying per batch, ~2/sec max under load).

_LOG_QUEUE = _queue.Queue(maxsize=20000)
_DROPPED = 0

# Runtime start/stop so the Settings → Syslog toggle can open/close the port live
# (not only on restart). The listeners track their socket here so stop can close it.
_stop_event = threading.Event()
_udp_sock = None
_tcp_sock = None


def _enqueue_log(entry):
    global _DROPPED
    try:
        _LOG_QUEUE.put_nowait(entry)
    except _queue.Full:
        _DROPPED += 1
        if _DROPPED % 1000 == 1:
            logging.warning(f"[Syslog] ingest queue full — dropped {_DROPPED} messages (flood / slow disk?)")


def _flush_batch(batch):
    """Write a batch on a fresh PostgreSQL connection. Runs inside the gevent
    threadpool (see _drain_loop) so the insert stays off the hub."""
    conn = _open_db(timeout=30)
    try:
        cur = conn.cursor()
        cur.executemany(
            "INSERT INTO logs (timestamp, source_ip, hostname, facility, severity, severity_text, message, protocol) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            batch,
        )
        conn.commit()
    finally:
        with contextlib.suppress(Exception):
            conn.close()


def _prune_old_logs():
    """S1: delete syslog rows older than the retention window (off-hub)."""
    try:
        days = 30
        try:
            from ProxmoxVEx.api.helpers import load_server_settings

            days = max(1, min(3650, int(load_server_settings().get("syslog_retention_days", 30) or 30)))
        except Exception:
            pass
        from datetime import timedelta

        cutoff = (datetime.now() - timedelta(days=days)).isoformat()
        conn = _open_db(timeout=30)
        try:
            cur = conn.cursor()
            cur.execute("DELETE FROM logs WHERE timestamp < ?", (cutoff,))
            n = cur.rowcount
            conn.commit()
            if n and n > 0:
                logging.info(f"[Syslog] retention prune: deleted {n} rows older than {days}d")
        finally:
            with contextlib.suppress(Exception):
                conn.close()
    except Exception as e:
        logging.debug(f"[Syslog] retention prune failed: {e}")


def _drain_loop():
    """Batch queued syslog entries + flush them off the hub. Stop-aware (S5) so it
    exits within ~1s of stop_syslog_server (no leaked greenlet per OFF→ON toggle),
    and runs a periodic retention prune (S1)."""
    try:
        from gevent import get_hub
    except Exception:
        get_hub = None

    def _offhub(fn, args=()):
        if get_hub is not None:
            get_hub().threadpool.apply(fn, args)
        else:
            fn(*args)

    last_prune = 0.0  # 0 → prune shortly after start, then hourly
    while not _stop_event.is_set():
        batch = []
        try:
            try:
                batch = [_LOG_QUEUE.get(timeout=1.0)]  # timed so we can notice _stop_event
            except _queue.Empty:
                batch = []
            if batch:
                for _ in range(999):
                    try:
                        batch.append(_LOG_QUEUE.get_nowait())
                    except _queue.Empty:
                        break
                _offhub(_flush_batch, (batch,))
            if time.monotonic() - last_prune > 3600:
                last_prune = time.monotonic()
                _offhub(_prune_old_logs)
        except Exception as e:
            logging.debug(f"[Syslog] drain error: {e}")
            time.sleep(0.5)
        if batch:
            time.sleep(0.5)  # coalesce under load → ~2 writes/sec


def _open_db(timeout=30):
    """Open a fresh PostgreSQL connection for this syslog batch."""
    # timeout is retained for API compatibility but unused with PostgreSQL.
    return PGConnection(_pg_dsn())


def _init_indexes(cur):
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_logs_timestamp_id
        ON logs(timestamp DESC, id DESC)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_logs_severity_timestamp_id
        ON logs(severity, timestamp DESC, id DESC)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_logs_protocol_timestamp_id
        ON logs(protocol, timestamp DESC, id DESC)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_logs_facility_timestamp_id
        ON logs(facility, timestamp DESC, id DESC)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_logs_hostname_timestamp_id
        ON logs(hostname, timestamp DESC, id DESC)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_logs_source_ip_timestamp_id
        ON logs(source_ip, timestamp DESC, id DESC)
    """)


def _init_fts(cur):
    """FTS5 full-text search was SQLite-only and is disabled now that the
    syslog store lives in PostgreSQL. The logs table is still queryable via
    the regular indexes and ILIKE in the API layer."""
    return False


def _init_db():
    conn = _open_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                source_ip TEXT,
                hostname TEXT,
                facility INTEGER,
                severity INTEGER,
                severity_text TEXT,
                message TEXT,
                protocol TEXT
            )
        """)
        _init_indexes(cur)
        _init_fts(cur)
        conn.commit()
    finally:
        conn.close()
    logging.info("[Syslog] PostgreSQL logs table initialized")


def _insert_log(entry):
    try:
        conn = _open_db(timeout=5)
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO logs (timestamp, source_ip, hostname, facility, severity, severity_text, message, protocol)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
                entry,
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        logging.debug(f"[Syslog] Insert failed: {e}")


def parse_syslog(message):
    hostname = "unknown"
    facility = None
    severity = None
    severity_text = "unknown"
    msg = message

    try:
        if message.startswith("<"):
            pri_end = message.find(">")
            pri = int(message[1:pri_end])
            facility = pri // 8
            severity = pri % 8
            severity_text = SEVERITY_MAP.get(severity, "unknown")
            rest = message[pri_end + 1 :].strip()
            parts = rest.split()
            if len(parts) >= 4:
                hostname = parts[3]
                msg = " ".join(parts[4:])
            else:
                msg = rest
    except Exception:
        pass

    return hostname, facility, severity, severity_text, msg


def _udp_listener(host, port):
    """UDP syslog listener using plain sockets (gevent-compatible)"""
    import socket

    global _udp_sock
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind((host, port))
        _udp_sock = sock
        logging.info(f"[Syslog] UDP listening on {host}:{port}")
    except OSError as e:
        logging.warning(f"[Syslog] UDP bind failed on {host}:{port}: {e}")
        return

    while not _stop_event.is_set():
        try:
            data, addr = sock.recvfrom(8192)
            message = data.decode(errors="ignore").strip()
            if not message:
                continue
            hostname, facility, severity, severity_text, msg = parse_syslog(message)
            entry = (datetime.now().isoformat(), addr[0], hostname, facility, severity, severity_text, msg, "UDP")
            _enqueue_log(entry)
        except Exception as e:
            if _stop_event.is_set():
                break  # socket closed by stop_syslog_server
            logging.debug(f"[Syslog] UDP error: {e}")
            time.sleep(0.1)


def _tcp_listener(host, port):
    """TCP syslog listener using plain sockets (gevent-compatible)"""
    import socket

    import gevent
    from gevent import socket as gsocket

    global _tcp_sock
    srv = gsocket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        srv.bind((host, port))
        srv.listen(256)  # Jul 2026: larger accept backlog for reconnect bursts at scale
        _tcp_sock = srv
        logging.info(f"[Syslog] TCP listening on {host}:{port}")
    except OSError as e:
        logging.warning(f"[Syslog] TCP bind failed on {host}:{port}: {e}")
        return

    def handle_client(client_sock, addr):
        try:
            buf = b""
            while True:
                data = client_sock.recv(4096)
                if not data:
                    break
                buf += data
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    message = line.decode(errors="ignore").strip()
                    if message:
                        hostname, facility, severity, severity_text, msg = parse_syslog(message)
                        entry = (
                            datetime.now().isoformat(),
                            addr[0],
                            hostname,
                            facility,
                            severity,
                            severity_text,
                            msg,
                            "TCP",
                        )
                        _enqueue_log(entry)
        except Exception:
            pass
        finally:
            client_sock.close()
            _tcp_conns["n"] -= 1

    # (scale/DoS): cap concurrent TCP handler greenlets. Without this
    # a remote peer could open unbounded connections and spawn one greenlet each,
    # exhausting the hub. Cooperative-safe counter (gevent has no preemption between
    # the check and the increment). Env-tunable; excess connections are dropped.
    _tcp_conns = {"n": 0}
    try:
        # Generous default for large estates (100+ nodes, plus per-app forwarders):
        # 1024 concurrent handlers still bounds the greenlet explosion but never
        # throttles legitimate senders. Tune up further via the env var if needed.
        _tcp_max = int(os.environ.get("PROXMOXVEX_SYSLOG_TCP_MAX", "1024"))
    except (TypeError, ValueError):
        _tcp_max = 1024

    while not _stop_event.is_set():
        try:
            client, addr = srv.accept()
            if _tcp_conns["n"] >= _tcp_max:
                logging.warning(f"[Syslog] TCP connection cap ({_tcp_max}) reached — dropping {addr[0]}")
                with contextlib.suppress(Exception):
                    client.close()
                continue
            _tcp_conns["n"] += 1
            gevent.spawn(handle_client, client, addr)
        except Exception as e:
            if _stop_event.is_set():
                break  # socket closed by stop_syslog_server
            logging.debug(f"[Syslog] TCP accept error: {e}")
            time.sleep(0.1)


def _syslog_loop():
    """Main syslog server loop — runs UDP + TCP in gevent greenlets"""
    import gevent

    # 2026-06-05 (audit N1): only open the network port when the feature is
    # enabled. Default True keeps existing behaviour (the receiver has always
    # been on); operators who don't ingest syslog can close the port. The
    # per-packet DoS is fixed regardless by the queue+batched-drain above.
    try:
        from ProxmoxVEx.api.helpers import load_server_settings

        if not load_server_settings().get("syslog_enabled", True):
            logging.info("[Syslog] disabled (syslog_enabled=false) — not binding 1514")
            return
    except Exception:
        pass  # settings unreadable at boot → fall through to default-on

    _init_db()

    port = 1514
    kill_existing_on_port(port, "tcp")
    kill_existing_on_port(port, "udp")
    host = (
        "0.0.0.0"  # nosec: B104 - operator opt-in via PROXMOXVEX_SYSLOG_BIND_ALL
        if os.environ.get("PROXMOXVEX_SYSLOG_BIND_ALL", "").lower() in ("1", "true", "yes")
        else os.environ.get("PROXMOXVEX_SYSLOG_BIND", "127.0.0.1")
    )

    gevent.spawn(_drain_loop)  # off-hub batched writer
    udp = gevent.spawn(_udp_listener, host, port)
    tcp = gevent.spawn(_tcp_listener, host, port)

    logging.info(f"[Syslog] Server started on port {port} (UDP+TCP)")
    gevent.joinall([udp, tcp])


def start_syslog_server():
    """Start syslog server in a background thread"""
    global _syslog_thread
    if _syslog_thread is not None:
        return
    _stop_event.clear()  # in case we were stopped earlier via the settings toggle
    _syslog_thread = threading.Thread(target=_syslog_loop, daemon=True, name="syslog-server")
    _syslog_thread.start()
    logging.info("[Syslog] Background thread started")


def stop_syslog_server():
    """Stop the syslog receiver and free port 1514 (Settings → Syslog toggle off).

    Sets the stop flag and closes the listening sockets, which unblocks the
    recvfrom()/accept() loops so they exit. Idempotent.  2026-06-05."""
    global _syslog_thread, _udp_sock, _tcp_sock
    if _syslog_thread is None:
        return
    _stop_event.set()
    for s in (_udp_sock, _tcp_sock):
        try:
            if s is not None:
                s.close()
        except Exception:
            pass
    _udp_sock = None
    _tcp_sock = None
    _syslog_thread = None
    logging.info("[Syslog] receiver stopped — port 1514 released (syslog_enabled=false)")


def is_syslog_running():
    return _syslog_thread is not None
