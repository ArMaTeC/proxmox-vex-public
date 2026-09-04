# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/lxc-template-marketplace/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: LXC Template Marketplace - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
LXC Template Marketplace - full UI management backend.
Manage and import LXC templates from a local catalog.
"""

import contextlib
import json
import logging
import re
import secrets
import shlex
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

import requests
from flask import Response, jsonify, request, send_file, stream_with_context

from ProxmoxVEx.api.helpers import check_cluster_access, get_connected_manager
from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.utils.url_security import SsrfError, sanitize_outbound_url

PLUGIN_ID = "lxc-template-marketplace"
PLUGIN_DIR = Path(__file__).parent
DATA_PATH = PLUGIN_DIR / "catalog.json"
CONFIG_PATH = PLUGIN_DIR / "config.json"
STATE_PATH = PLUGIN_DIR / "state.json"
_state_lock = threading.RLock()
_worker_started = False
log = logging.getLogger(f"plugin.{PLUGIN_ID}")


def _load():
    if not DATA_PATH.exists():
        return []
    try:
        return json.loads(DATA_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save(items):
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATA_PATH.write_text(json.dumps(items, indent=2), encoding="utf-8")


def _load_config():
    """Load plugin config.json, if present."""
    if not CONFIG_PATH.exists():
        return {}
    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _ensure_data_files():
    for p in (DATA_PATH, CONFIG_PATH):
        if not p.parent.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
    if not DATA_PATH.exists():
        DATA_PATH.write_text("[]", encoding="utf-8")
    if not STATE_PATH.exists():
        STATE_PATH.write_text(json.dumps({"jobs": [], "version": "1.1.0"}, indent=2), encoding="utf-8")


def _load_state():
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"jobs": [], "version": "1.1.0"}


def _save_state(data):
    data["version"] = "1.1.0"
    data["updated_at"] = datetime.now().isoformat()
    STATE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _public_lists():
    """Return configured public template list sources."""
    return {"public_lists": _load_config().get("public_lists", [])}


def _normalize_public_item(item):
    """Normalize a public list entry to the local catalog schema."""
    entry = {
        "id": str(item.get("id") or "").strip(),
        "name": str(item.get("name") or item.get("id") or "").strip(),
        "os": str(item.get("os") or "").strip(),
        "arch": str(item.get("arch") or "").strip(),
        "source": str(item.get("source") or item.get("url") or "").strip(),
        "source_type": "url",
        "description": str(item.get("description") or "").strip(),
        "version": str(item.get("version") or "").strip(),
    }
    meta = item.get("metadata")
    if meta:
        try:
            if isinstance(meta, str):
                meta = json.loads(meta)
            entry["metadata"] = meta
        except Exception:
            pass
    return entry


def _parse_aplinfo(text, base_url, link):
    """Parse a Proxmox .aplinfo file into a normalized catalog entry."""
    info = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        info[key.strip().lower()] = value.strip()

    package = info.get("package") or ""
    architecture = info.get("architecture") or ""
    version = info.get("version") or ""
    os_ = info.get("os") or ""
    description = info.get("description") or ""
    tar_filename = link.replace(".aplinfo", ".tar.xz")
    source = f"{base_url.rstrip('/')}/{tar_filename}"
    location = info.get("location") or ""
    if location:
        # Location is relative to the images root (one level above the listing dir)
        root_base = "/".join(base_url.rstrip("/").split("/")[:-1])
        source = f"{root_base.rstrip('/')}/{location.lstrip('/')}"

    return {
        "id": f"{package}-{version}-{architecture}".lower().replace(" ", "-") if package else "",
        "name": f"{package} {version} ({architecture})" if package else "",
        "os": os_,
        "arch": architecture,
        "source": source,
        "source_type": "url",
        "description": description,
        "version": version,
        "metadata": {
            "package": package,
            "sha512sum": info.get("sha512sum", ""),
            "md5sum": info.get("md5sum", ""),
            "maintainer": info.get("maintainer", ""),
            "infopage": info.get("infopage", ""),
            "location": location,
        },
    }


def _fetch_public_json(url):
    """Fetch and parse a JSON public template list URL."""
    safe_url = sanitize_outbound_url(url)
    resp = requests.get(safe_url, timeout=20)
    resp.raise_for_status()
    return resp.json()


def _fetch_public_proxmox(url):
    """Fetch the Proxmox system template directory listing and parse .aplinfo files."""
    safe_url = sanitize_outbound_url(url, allowed_schemes=("https", "http"))
    resp = requests.get(safe_url, timeout=30)
    resp.raise_for_status()
    base_url = safe_url if safe_url.endswith("/") else f"{safe_url}/"
    links = re.findall(r'href="([^"]+\.aplinfo)"', resp.text)
    items = []
    for link in links:
        try:
            info_url = sanitize_outbound_url(base_url + link, allowed_schemes=("https", "http"))
            info_resp = requests.get(info_url, timeout=20)
            info_resp.raise_for_status()
            entry = _parse_aplinfo(info_resp.text, base_url, link)
            if entry["id"] and entry["name"]:
                items.append(entry)
        except Exception as exc:
            log.warning("[lxc-template-marketplace] skipped %s: %s", link, exc)
    return items


def _pull_public_list():
    """Pull a public template list by configured list_id or direct URL.

    Streams NDJSON progress events so the UI can show each stage live.
    """
    data = request.get_json(silent=True) or {}
    list_id = (data.get("list_id") or "").strip()
    url = (data.get("url") or "").strip()
    fmt = "json"

    if not list_id and not url:
        return jsonify({"error": "list_id or url is required"}), 400

    if list_id:
        # Named list: use the configured URL and format so HTTP Proxmox listings work.
        cfg = _load_config()
        public = {p.get("id"): p for p in cfg.get("public_lists", []) if p.get("id")}
        entry = public.get(list_id)
        if not entry:
            return jsonify({"error": "public list not found"}), 404
        url = (entry.get("url") or "").strip()
        fmt = (entry.get("format") or "json").strip().lower()
        if not url:
            return jsonify({"error": "public list has no url"}), 400
    elif not url:
        return jsonify({"error": "url is required"}), 400

    def _progress(stage, message, extra=None):
        payload = {"stage": stage, "message": message}
        if extra:
            payload.update(extra)
        return (json.dumps(payload) + "\n").encode("utf-8")

    @stream_with_context
    def _generate():
        try:
            yield _progress("start", "Resolving public list source")
            if fmt == "proxmox":
                yield _progress("connect", f"Fetching Proxmox listing from {url}")
                safe_url = sanitize_outbound_url(url, allowed_schemes=("https", "http"))
                listing = requests.get(safe_url, timeout=30)
                listing.raise_for_status()
                base_url = safe_url if safe_url.endswith("/") else f"{safe_url}/"
                links = re.findall(r'href="([^"]+\.aplinfo)"', listing.text)
                yield _progress("listing", f"Found {len(links)} .aplinfo files", {"total": len(links)})
                items = []
                for idx, link in enumerate(links, start=1):
                    yield _progress("fetch", f"Fetching {link}", {"index": idx, "total": len(links)})
                    try:
                        info_url = sanitize_outbound_url(base_url + link, allowed_schemes=("https", "http"))
                        info_resp = requests.get(info_url, timeout=20)
                        info_resp.raise_for_status()
                        entry = _parse_aplinfo(info_resp.text, base_url, link)
                        if entry["id"] and entry["name"]:
                            items.append(entry)
                            yield _progress(
                                "parsed",
                                f"Parsed {entry['name']}",
                                {"index": idx, "total": len(links), "name": entry["name"]},
                            )
                        else:
                            yield _progress("skipped", f"Skipped {link}", {"index": idx, "total": len(links)})
                    except Exception as exc:
                        log.warning("[lxc-template-marketplace] skipped %s: %s", link, exc)
                        yield _progress("skipped", f"Skipped {link}: {exc}", {"index": idx, "total": len(links)})
            else:
                yield _progress("connect", f"Fetching public list from {url}")
                safe_url = sanitize_outbound_url(url)
                resp = requests.get(safe_url, timeout=20)
                resp.raise_for_status()
                payload = resp.json()
                items = payload
                if isinstance(payload, dict):
                    items = payload.get("templates") or payload.get("items") or []
                yield _progress("fetched", f"Received {len(items)} template records", {"total": len(items)})

            if not isinstance(items, list):
                yield _progress("error", "public list format not recognized")
                return

            yield _progress("merge", f"Merging {len(items)} templates into local catalog")
            catalog = _load()
            existing = {t.get("id"): t for t in catalog}
            added = 0
            updated = 0
            for item in items:
                if not isinstance(item, dict):
                    continue
                entry = _normalize_public_item(item)
                if not entry["id"] or not entry["name"] or not entry["source"]:
                    continue
                if entry["id"] in existing:
                    existing[entry["id"]].update(entry)
                    updated += 1
                else:
                    catalog.append(entry)
                    existing[entry["id"]] = entry
                    added += 1
            _save(catalog)
            yield _progress(
                "complete", "Pull complete", {"pulled": True, "added": added, "updated": updated, "count": len(catalog)}
            )
        except SsrfError as exc:
            yield _progress("error", f"Unsafe URL: {exc}")
        except Exception as exc:
            log.exception("[lxc-template-marketplace] pull failed")
            yield _progress("error", f"Pull failed: {exc}")

    return Response(_generate(), mimetype="application/x-ndjson")


def _get_status():
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "templates_count": len(_load()),
    }


def _get_clusters():
    from ProxmoxVEx.globals import cluster_managers

    try:
        return {"clusters": [{"id": c, "name": c} for c in (cluster_managers or {})]}
    except Exception:
        return {"clusters": []}


def _validate_template(data):
    tid = (data.get("id") or "").strip()
    name = (data.get("name") or "").strip()
    if not tid or not name:
        return {"error": "id and name are required"}, 400
    meta = data.get("metadata")
    if meta:
        try:
            if isinstance(meta, str):
                json.loads(meta)
        except json.JSONDecodeError as e:
            return {"error": f"Invalid metadata JSON: {e}"}, 400
    return None


def _templates():
    if request.method == "GET":
        catalog = _load()
        search = (request.args.get("search") or "").strip().lower()
        os_filter = (request.args.get("os") or "").strip()
        arch = (request.args.get("arch") or "").strip()
        source_type = (request.args.get("source_type") or "").strip()
        if search:
            catalog = [
                t
                for t in catalog
                if search in (t.get("id") or "").lower()
                or search in (t.get("name") or "").lower()
                or search in (t.get("os") or "").lower()
            ]
        if os_filter:
            catalog = [t for t in catalog if (t.get("os") or "").lower() == os_filter.lower()]
        if arch:
            catalog = [t for t in catalog if (t.get("arch") or "").lower() == arch.lower()]
        if source_type:
            catalog = [t for t in catalog if (t.get("source_type") or "").lower() == source_type.lower()]
        sort = request.args.get("sort") or "name"
        order = (request.args.get("order") or "asc").strip()
        rev = order == "desc"
        catalog.sort(key=lambda t: (t.get(sort) or "").lower(), reverse=rev)
        return {"templates": catalog}

    if request.method == "DELETE":
        tid = request.args.get("id") or (request.get_json(silent=True) or {}).get("id")
        if not tid:
            return jsonify({"error": "id is required"}), 400
        catalog = [t for t in _load() if t.get("id") != tid]
        _save(catalog)
        return {"deleted": tid}

    data = request.get_json(silent=True) or {}
    err = _validate_template(data)
    if err:
        return err
    catalog = _load()
    existing = next((t for t in catalog if t.get("id") == data["id"]), None)
    entry = {
        "id": data["id"].strip(),
        "name": (data.get("name") or "").strip(),
        "os": (data.get("os") or "").strip(),
        "arch": (data.get("arch") or "").strip(),
        "source": (data.get("source") or "").strip(),
        "source_type": (data.get("source_type") or "").strip()
        or (
            "local"
            if (
                (data.get("source") or "").strip().startswith("local:")
                or (data.get("source") or "").strip().startswith("/")
            )
            else "url"
        ),
        "description": (data.get("description") or "").strip(),
        "version": (data.get("version") or "").strip(),
    }
    meta = data.get("metadata")
    if meta:
        if isinstance(meta, str):
            meta = json.loads(meta)
        entry["metadata"] = meta
    if existing:
        existing.update(entry)
    else:
        catalog.append(entry)
    _save(catalog)
    return {"template": entry, "saved": True}


def _find_lxc_source(manager, source):
    try:
        source_vmid = int(source)
    except (TypeError, ValueError):
        return None
    for v in manager.get_vms() or []:
        if v.get("type") == "lxc" and v.get("vmid") == source_vmid:
            return v
    return None


def _ssh_run(ssh, command, timeout=900):
    stdin, stdout, stderr = ssh.exec_command(command, get_pty=False, timeout=timeout)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    return rc, out, err


def _ssh_exec(ssh, command, label, timeout=900):
    rc, out, err = _ssh_run(ssh, command, timeout)
    if rc != 0:
        raise RuntimeError(f"{label} failed (rc={rc}): {err or out}")
    return out


def _sanitize_hostname(name, default="ct"):
    name = str(name or default).strip().lower()
    name = re.sub(r"[^a-z0-9-]+", "-", name)
    name = re.sub(r"-+", "-", name).strip("-")
    return (name or default)[:64]


def _safe_basename(url):
    basename = str(url or "").rsplit("/", 1)[-1]
    basename = re.sub(r"[^a-zA-Z0-9._-]+", "-", basename)
    return basename or "template"


def _select_target_node(manager):
    try:
        nodes = manager.api_request("GET", "/nodes") or []
    except Exception:
        return None
    for n in nodes:
        if n.get("status") == "online":
            return n.get("node")
    if nodes:
        return nodes[0].get("node")
    return None


def _select_storage(manager, node, content_type):
    try:
        stores = manager.get_storage_list(node) or []
    except Exception:
        return None
    for s in stores:
        if content_type in (s.get("content") or ""):
            return s.get("storage")
    return None


def _select_bridge(manager, node):
    try:
        bridges = manager.get_network_list(node) or []
    except Exception:
        return None
    ifaces = [b.get("iface") for b in bridges if b.get("iface")]
    if "vmbr0" in ifaces:
        return "vmbr0"
    return ifaces[0] if ifaces else None


def _import_lxc_template(job, item, manager, source_str):
    job["status"] = "running"
    job["started"] = datetime.now().isoformat()

    if source_str.startswith(("http://", "https://")):
        try:
            safe_url = sanitize_outbound_url(source_str, allowed_schemes=("https", "http"))
        except SsrfError as exc:
            job["status"] = "failed"
            job["error"] = f"unsafe template URL: {exc}"
            job["finished"] = datetime.now().isoformat()
            return
    else:
        safe_url = source_str

    node_name = _select_target_node(manager)
    if not node_name:
        job["status"] = "failed"
        job["error"] = "no Proxmox node available"
        job["finished"] = datetime.now().isoformat()
        return

    tmpl_storage = _select_storage(manager, node_name, "vztmpl")
    if not tmpl_storage:
        job["status"] = "failed"
        job["error"] = "no storage with vztmpl content available"
        job["finished"] = datetime.now().isoformat()
        return

    root_storage = _select_storage(manager, node_name, "rootdir") or "local-lvm"
    bridge = _select_bridge(manager, node_name) or "vmbr0"

    target_host = manager._get_node_ip(node_name) or manager.host
    ssh = manager._ssh_connect(target_host)
    if not ssh:
        job["status"] = "failed"
        job["error"] = f"SSH connect failed for {node_name}"
        job["finished"] = datetime.now().isoformat()
        return

    try:
        # Determine the on-disk path for the chosen template storage.
        rc, store_path, _ = _ssh_run(ssh, f"pvesm path {shlex.quote(tmpl_storage)}")
        if rc != 0:
            raise RuntimeError(f"pvesm path {tmpl_storage} failed")
        store_path = store_path.strip()

        # For URL-backed templates, download the tar archive to the vztmpl directory.
        if safe_url.startswith(("http://", "https://")):
            basename = _safe_basename(safe_url)
            if "." not in basename:
                basename = f"{_safe_basename(item.get('id') or 'template')}.tar.xz"
            tmpl_path = f"{store_path}/vztmpl/{basename}"
            _ssh_exec(ssh, f"mkdir -p {shlex.quote(f'{store_path}/vztmpl')}", "mkdir")
            _ssh_exec(ssh, f"wget -q -O {shlex.quote(tmpl_path)} {shlex.quote(safe_url)}", "download")
            ostemplate = f"{tmpl_storage}:vztmpl/{basename}"
        else:
            # Treat a non-URL source as an already-resolved ostemplate reference.
            ostemplate = safe_url

        vmid = int(job.get("target_vmid"))
        password = secrets.token_urlsafe(16)
        hostname = _sanitize_hostname(item.get("name") or item.get("id"), f"ct-{vmid}")

        result = manager.create_container(
            node_name,
            {
                "vmid": vmid,
                "hostname": hostname,
                "template": ostemplate,
                "password": password,
                "storage": root_storage,
                "net_bridge": bridge,
                "memory": 512,
                "swap": 512,
                "cores": 1,
                "disk_size": "8",
                "unprivileged": True,
            },
        )
        if not result or not result.get("success"):
            raise RuntimeError(str(result.get("error") if result else "pct create failed"))
        upid = result.get("task")
        if isinstance(upid, str) and not manager._wait_for_task(node_name, upid, timeout=600):
            raise RuntimeError("pct create task did not complete")
        job["status"] = "completed"
    except Exception as exc:
        log.exception("[%s] LXC template import failed", PLUGIN_ID)
        job["status"] = "failed"
        job["error"] = str(exc)
    finally:
        with contextlib.suppress(Exception):
            ssh.close()
    job["finished"] = datetime.now().isoformat()


def _process_job(job, state):
    catalog = _load()
    item = next((t for t in catalog if t.get("id") == job.get("template_id")), None)
    if not item:
        job["status"] = "failed"
        job["error"] = "template not found in catalog"
        job["finished"] = datetime.now().isoformat()
        return

    manager, _ = get_connected_manager(job.get("cluster_id"))
    if not manager:
        job["status"] = "failed"
        job["error"] = "cluster not connected"
        job["finished"] = datetime.now().isoformat()
        return

    source_str = str(item.get("source", "")).strip()
    if not source_str:
        job["status"] = "failed"
        job["error"] = "template has no source"
        job["finished"] = datetime.now().isoformat()
        return

    if source_str.isdigit():
        source = int(source_str)
        source_vm = _find_lxc_source(manager, source)
        if not source_vm:
            job["status"] = "failed"
            job["error"] = f"source LXC {source} not found in cluster"
            job["finished"] = datetime.now().isoformat()
            return

        job["status"] = "running"
        job["started"] = datetime.now().isoformat()
        result = manager.clone_vm(
            node=source_vm.get("node"),
            vmid=source,
            vm_type="lxc",
            newid=job.get("target_vmid"),
            name=item.get("name"),
            full=True,
            target_node=source_vm.get("node"),
        )
        if not result or not result.get("success"):
            job["status"] = "failed"
            job["error"] = str(result.get("error") if result else "clone failed")
            job["finished"] = datetime.now().isoformat()
            return

        upid = result.get("data")
        if isinstance(upid, str):
            if manager._wait_for_task(source_vm.get("node"), upid, timeout=300):
                job["status"] = "completed"
            else:
                job["status"] = "failed"
                job["error"] = "clone task did not complete"
        else:
            job["status"] = "completed"
        job["finished"] = datetime.now().isoformat()
        return

    _import_lxc_template(job, item, manager, source_str)


def _run_queued_jobs():
    with _state_lock:
        state = _load_state()
        changed = False
        for job in list(state.get("jobs", [])):
            if job.get("status") == "queued":
                _process_job(job, state)
                changed = True
        if changed:
            _save_state(state)


def _job_worker():
    while True:
        try:
            _run_queued_jobs()
        except Exception:
            log.exception("[%s] worker error", PLUGIN_ID)
        try:
            time.sleep(5)
        except Exception:
            break


def start_background_tasks(app=None):
    global _worker_started
    with _state_lock:
        if _worker_started:
            return
        _worker_started = True
    t = threading.Thread(target=_job_worker, daemon=True, name=f"{PLUGIN_ID}-worker")
    t.start()
    log.info("[%s] background worker started", PLUGIN_ID)


def _import_template():
    data = request.get_json(silent=True) or {}
    tid = data.get("template_id")
    cluster_id = (data.get("cluster_id") or "").strip()
    if not tid:
        return jsonify({"error": "template_id is required"}), 400
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    allowed, err = check_cluster_access(cluster_id)
    if not allowed:
        return err
    catalog = _load()
    item = next((t for t in catalog if t.get("id") == tid), None)
    if not item:
        return jsonify({"error": "template not found"}), 404
    manager, _ = get_connected_manager(cluster_id)
    target_vmid = None
    if manager:
        next_id = manager.get_next_vmid()
        if next_id and next_id.get("success"):
            target_vmid = next_id.get("vmid")
    if target_vmid is None:
        state = _load_state()
        target_vmid = 9000 + len(state.get("jobs", []))
    job = {
        "job_id": f"import-{uuid.uuid4().hex[:8]}",
        "template_id": tid,
        "template_name": item.get("name"),
        "cluster_id": cluster_id,
        "target_vmid": target_vmid,
        "status": "queued",
        "container": True,
        "created": datetime.now().isoformat(),
    }
    with _state_lock:
        state = _load_state()
        state.setdefault("jobs", []).append(job)
        _save_state(state)
    return job


def _get_jobs():
    state = _load_state()
    return {"data": state.get("jobs", [])[::-1]}


def _get_ui():
    """Serve the LXC Template Marketplace HTML interface"""
    _ensure_data_files()
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    _ensure_data_files()
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "public-lists", _public_lists)
    register_plugin_route(PLUGIN_ID, "pull", _pull_public_list)
    register_plugin_route(PLUGIN_ID, "templates", _templates)
    register_plugin_route(PLUGIN_ID, "import", _import_template)
    register_plugin_route(PLUGIN_ID, "jobs", _get_jobs)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    start_background_tasks()
    log.info("[PLUGINS] %s plugin registered", PLUGIN_ID)
