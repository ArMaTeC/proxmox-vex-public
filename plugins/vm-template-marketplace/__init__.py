# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-template-marketplace/__init__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: VM Template Marketplace - full UI management backend.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""VM Template Marketplace - full UI management backend."""

import contextlib
import json
import logging
import re
import shlex
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import requests
from flask import jsonify, request, send_file

from ProxmoxVEx.api.helpers import get_connected_manager, safe_error
from ProxmoxVEx.api.plugin_data_bridge import get_clusters
from ProxmoxVEx.api.plugins import register_plugin_route
from ProxmoxVEx.api.templates_lib import CATALOG
from ProxmoxVEx.utils.url_security import SsrfError, sanitize_outbound_url

PLUGIN_ID = "vm-template-marketplace"
log = logging.getLogger(f"plugin.{PLUGIN_ID}")
PLUGIN_DIR = Path(__file__).parent
DATA_PATH = PLUGIN_DIR / "catalog.json"
CONFIG_PATH = PLUGIN_DIR / "config.json"
STATE_PATH = PLUGIN_DIR / "state.json"
_state_lock = threading.RLock()
_worker_started = False


def _now():
    return datetime.now(timezone.utc)


def _load_config():
    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _ensure_data_files():
    if not DATA_PATH.exists():
        DATA_PATH.write_text("[]")
    if not STATE_PATH.exists():
        STATE_PATH.write_text(json.dumps({"jobs": [], "version": "1.1.0"}, indent=2))
    # Seed from configured public lists if the catalog is empty so the
    # marketplace starts with a useful template list.
    if not _load():
        _seed_builtin_catalog()


def _load():
    try:
        return json.loads(DATA_PATH.read_text())
    except Exception:
        return []


def _save(items):
    DATA_PATH.write_text(json.dumps(items, indent=2))


def _load_state():
    try:
        return json.loads(STATE_PATH.read_text())
    except Exception:
        return {"jobs": [], "version": "1.1.0"}


def _save_state(data):
    data["version"] = "1.1.0"
    data["updated_at"] = _now().isoformat()
    STATE_PATH.write_text(json.dumps(data, indent=2))


def _sanitize_vm_name(name, default="template"):
    """Convert an arbitrary template name into a qm-compatible DNS name."""
    name = str(name or default).strip().lower()
    # qm names must be valid DNS labels: letters, digits, hyphens, not starting/ending with a hyphen.
    name = re.sub(r"[^a-z0-9-]+", "-", name)
    name = re.sub(r"-+", "-", name).strip("-")
    if not name:
        return default
    return name[:64]


def _safe_basename(url):
    """Return the last path segment of a URL as a safe filename fallback."""
    basename = str(url or "").rsplit("/", 1)[-1]
    basename = re.sub(r"[^a-zA-Z0-9._-]+", "-", basename)
    return basename or "image"


def _normalize_public_item(item):
    """Convert a public template list entry into the local catalog schema."""
    if not isinstance(item, dict):
        return None
    tid = str(item.get("id") or "").strip()
    name = str(item.get("name") or "").strip()
    if not tid or not name:
        return None
    source = str(item.get("source") or item.get("url") or item.get("image_url") or "").strip()
    tags = item.get("tags")
    if isinstance(tags, list):
        tag_list = [str(x).strip() for x in tags if str(x).strip()]
    elif isinstance(tags, str):
        tag_list = [x.strip() for x in tags.split(",") if x.strip()]
    else:
        tag_list = []
    return {
        "id": tid,
        "name": name,
        "source": source,
        "source_type": "url" if not (source and source.isdigit()) else "local",
        "description": str(item.get("description") or "").strip(),
        "category": str(item.get("category") or item.get("distro") or "").strip().lower(),
        "tags": tag_list,
        "distro": str(item.get("distro") or "").strip(),
        "version": str(item.get("version") or "").strip(),
        "image_url": str(item.get("image_url") or source).strip(),
        "default_user": str(item.get("default_user") or "").strip(),
        "cores": item.get("cores", 2),
        "memory": item.get("memory", 2048),
        "disk_gb": item.get("disk_gb", 10),
    }


def _fetch_public_json(url):
    safe_url = sanitize_outbound_url(url, allowed_schemes=("https", "http"))
    resp = requests.get(safe_url, timeout=20)
    resp.raise_for_status()
    payload = resp.json()
    if isinstance(payload, dict):
        return payload.get("templates") or payload.get("items") or []
    return payload


def _fetch_public_builtin():
    """Return the ProxmoxVEx built-in curated VM cloud-image catalog."""
    return CATALOG


def _seed_builtin_catalog():
    """Merge built-in/public templates into an empty catalog.json."""
    cfg = _load_config()
    public_lists = cfg.get("public_lists", [])
    if not public_lists:
        return
    catalog = _load()
    existing = {t.get("id"): t for t in catalog}
    added = 0
    for entry in public_lists:
        fmt = (entry.get("format") or "").strip().lower()
        if fmt != "builtin":
            continue
        for item in _fetch_public_builtin():
            normalized = _normalize_public_item(item)
            if not normalized:
                continue
            if normalized["id"] in existing:
                existing[normalized["id"]].update(normalized)
            else:
                catalog.append(normalized)
                existing[normalized["id"]] = normalized
                added += 1
    if added:
        _save(catalog)
        log.info("[%s] seeded %s built-in public templates", PLUGIN_ID, added)


def _pull_public_list():
    """Fetch a public template list and merge it into the local catalog."""
    data = request.get_json(silent=True) or {}
    list_id = (data.get("list_id") or "").strip()
    url = (data.get("url") or "").strip()
    fmt = (data.get("format") or "json").strip().lower()
    cfg = _load_config()
    public = {p.get("id"): p for p in cfg.get("public_lists", []) if p.get("id")}
    if list_id:
        entry = public.get(list_id)
        if not entry:
            return jsonify({"error": "public list not found"}), 404
        url = (entry.get("url") or "").strip()
        fmt = (entry.get("format") or "json").strip().lower()
    if not list_id and not url:
        return jsonify({"error": "list_id or url is required"}), 400
    if not url:
        return jsonify({"error": "public list has no url"}), 400

    try:
        if fmt == "builtin":
            items = _fetch_public_builtin()
        elif fmt == "json":
            items = _fetch_public_json(url)
        else:
            return jsonify({"error": f"unsupported format: {fmt}"}), 400
    except SsrfError as exc:
        return jsonify({"error": f"unsafe URL: {exc}"}), 400
    except Exception as exc:
        log.exception("[%s] public list pull failed", PLUGIN_ID)
        return jsonify({"error": f"pull failed: {exc}"}), 500

    catalog = _load()
    existing = {t.get("id"): t for t in catalog}
    added = 0
    updated = 0
    for item in items:
        normalized = _normalize_public_item(item)
        if not normalized:
            continue
        if normalized["id"] in existing:
            existing[normalized["id"]].update(normalized)
            updated += 1
        else:
            catalog.append(normalized)
            existing[normalized["id"]] = normalized
            added += 1
    _save(catalog)
    return {"pulled": True, "added": added, "updated": updated, "count": len(catalog)}


def _get_status():
    state = _load_state()
    return {
        "plugin": PLUGIN_ID,
        "status": "running",
        "version": "1.1.0",
        "template_count": len(_load()),
        "job_count": len(state.get("jobs", [])),
    }


def _get_clusters():
    try:
        return {
            "data": [{"id": c.get("id"), "display_name": c.get("name")} for c in get_clusters().get("clusters", [])]
        }
    except Exception as e:
        log.error(safe_error(e, "cluster list failed"))
    return {"data": []}


def _templates():
    if request.method == "GET":
        return {"templates": _load()}
    data = request.get_json(silent=True) or {}
    tid = data.get("id")
    if not tid:
        return jsonify({"error": "id is required"}), 400
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    catalog = _load()
    existing = next((t for t in catalog if t.get("id") == tid), None)
    entry = {
        "id": tid,
        "name": name,
        "source": data.get("source", ""),
        "description": data.get("description", ""),
        "category": data.get("category", ""),
        "tags": [x.strip() for x in (data.get("tags") or "").split(",") if x.strip()],
    }
    if existing:
        existing.update(entry)
    else:
        catalog.append(entry)
    _save(catalog)
    return {"template": entry, "saved": True}


def _delete_template():
    tid = (request.get_json(silent=True) or {}).get("id") or request.args.get("id")
    if not tid:
        return jsonify({"error": "id is required"}), 400
    catalog = _load()
    catalog = [t for t in catalog if t.get("id") != tid]
    _save(catalog)
    return {"deleted": tid, "count": len(catalog)}


def _import_template():
    data = request.get_json(silent=True) or {}
    tid = data.get("template_id")
    if not tid:
        return jsonify({"error": "template_id is required"}), 400
    catalog = _load()
    item = next((t for t in catalog if t.get("id") == tid), None)
    if not item:
        return jsonify({"error": "template not found"}), 404
    cluster_id = str(data.get("cluster_id") or "").strip()
    if not cluster_id:
        return jsonify({"error": "cluster_id is required"}), 400
    state = _load_state()
    job = {
        "job_id": f"import-{uuid.uuid4().hex[:8]}",
        "template_id": tid,
        "template_name": item.get("name"),
        "cluster_id": cluster_id,
        "target_vmid": 9000 + len(state.get("jobs", [])),
        "status": "queued",
        "created": _now().isoformat(),
    }
    state.setdefault("jobs", []).append(job)
    _save_state(state)
    return job


def _get_jobs():
    state = _load_state()
    return {"data": state.get("jobs", [])[::-1]}


def _get_export():
    return jsonify({"templates": _load()})


def _find_source_vm(manager, source):
    """Locate the source VM/template in the cluster by VMID."""
    try:
        for v in manager.get_vms() or []:
            if str(v.get("vmid")) == str(source):
                return v
    except Exception:
        pass
    return None


def _ssh_run(ssh, command, timeout=900):
    """Run a single SSH command and return its exit code and outputs."""
    stdin, stdout, stderr = ssh.exec_command(command, get_pty=False, timeout=timeout)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    return rc, out, err


def _ssh_exec(ssh, command, label, timeout=900):
    """Run an SSH command and raise a descriptive RuntimeError on failure."""
    rc, out, err = _ssh_run(ssh, command, timeout)
    if rc != 0:
        raise RuntimeError(f"{label} failed (rc={rc}): {err or out}")
    return out


def _get_imported_volid(ssh, vmid, storage):
    """Return the volume ID of the disk qm importdisk just added.

    qm importdisk registers the new disk as an unused device. The exact
    volume name depends on the storage type: LVM uses ``vm-<vmid>-disk-0``
    while directory-backed storage may use ``<storage>:<vmid>/vm-<vmid>-disk-0.qcow2``.
    We read ``qm config`` to get the real volid instead of guessing.
    """
    rc, out, _ = _ssh_run(ssh, f"qm config {int(vmid)}", timeout=30)
    if rc == 0:
        for line in (out or "").splitlines():
            if line.startswith("unused"):
                # 'unused0: local-lvm:vm-128-disk-0' or
                # 'unused0: local:128/vm-128-disk-0.qcow2'
                volid = line.split(":", 1)[-1].strip()
                if volid:
                    return volid
    # Fallback for storage types that expose the predictable LVM-style name.
    return f"{storage}:vm-{vmid}-disk-0"


def _select_target_node(manager):
    """Pick the first online PVE node, or the first node if none report status."""
    nodes = manager.api_request("GET", "/nodes") or []
    for n in nodes:
        if n.get("status") == "online":
            return n.get("node")
    if nodes:
        return nodes[0].get("node")
    return None


def _select_storage(manager, node):
    """Choose the first storage that advertises VM image support, or the first listed."""
    stores = manager.get_storage_list(node) or []
    for s in stores:
        content = s.get("content") or ""
        if "images" in content:
            return s.get("storage")
    if stores:
        return stores[0].get("storage")
    return None


def _select_bridge(manager, node):
    """Choose an available bridge for the new VM, preferring vmbr0 if present."""
    bridges = manager.get_network_list(node) or []
    ifaces = [b.get("iface") for b in bridges if b.get("iface")]
    if "vmbr0" in ifaces:
        return "vmbr0"
    return ifaces[0] if ifaces else None


def _import_cloud_image(job, item, manager, image_url):
    """Import a URL-backed cloud image by SSHing into the cluster and running qm."""
    job["status"] = "running"
    job["started"] = _now().isoformat()

    try:
        safe_url = sanitize_outbound_url(image_url, allowed_schemes=("https", "http"))
    except SsrfError as exc:
        job["status"] = "failed"
        job["error"] = f"unsafe image URL: {exc}"
        job["finished"] = _now().isoformat()
        return

    next_vmid = manager.get_next_vmid()
    if not next_vmid.get("success"):
        job["status"] = "failed"
        job["error"] = str(next_vmid.get("error", "could not determine next VMID"))
        job["finished"] = _now().isoformat()
        return
    vmid = int(next_vmid["vmid"])
    job["target_vmid"] = vmid

    node_name = _select_target_node(manager)
    if not node_name:
        job["status"] = "failed"
        job["error"] = "no Proxmox node available"
        job["finished"] = _now().isoformat()
        return

    storage = _select_storage(manager, node_name)
    if not storage:
        job["status"] = "failed"
        job["error"] = "no suitable storage for image import"
        job["finished"] = _now().isoformat()
        return

    bridge = _select_bridge(manager, node_name)
    if not bridge:
        job["status"] = "failed"
        job["error"] = "no network bridge available on node"
        job["finished"] = _now().isoformat()
        return

    target_host = manager._get_node_ip(node_name) or manager.host
    ssh = manager._ssh_connect(target_host)
    if not ssh:
        job["status"] = "failed"
        job["error"] = f"SSH connect failed for {node_name}"
        job["finished"] = _now().isoformat()
        return

    img_basename = _safe_basename(safe_url)
    img_path = f"/tmp/ProxmoxVEx-market-{job['job_id']}-{img_basename}"
    q_img_path = shlex.quote(img_path)
    q_url = shlex.quote(safe_url)
    q_vm_name = shlex.quote(_sanitize_vm_name(item.get("name") or item.get("id"), f"tpl-{vmid}"))
    q_storage = shlex.quote(storage)
    q_ide = shlex.quote(f"{storage}:cloudinit")
    q_net = shlex.quote(f"virtio,bridge={bridge}")

    cores = int(item.get("cores", 2))
    memory = int(item.get("memory", 2048))

    try:
        _ssh_exec(ssh, f"wget -q -O {q_img_path} {q_url}", "download")
        _ssh_exec(
            ssh,
            f"qm create {vmid} --name {q_vm_name} --memory {memory} --cores {cores} "
            f"--net0 {q_net} --ostype l26 --agent 1 --serial0 socket --vga serial0",
            "qm create",
        )
        _ssh_exec(ssh, f"qm importdisk {vmid} {q_img_path} {q_storage}", "qm importdisk")
        q_scsi = shlex.quote(_get_imported_volid(ssh, vmid, storage))
        _ssh_exec(
            ssh,
            f"qm set {vmid} --scsihw virtio-scsi-pci --scsi0 {q_scsi} --ide2 {q_ide} --boot c --bootdisk scsi0",
            "qm set",
        )
        _ssh_exec(ssh, f"qm template {vmid}", "qm template")
        job["status"] = "completed"
    except Exception as exc:
        log.exception("[%s] cloud image import failed", PLUGIN_ID)
        job["status"] = "failed"
        job["error"] = str(exc)
    finally:
        with contextlib.suppress(Exception):
            _ssh_exec(ssh, f"rm -f {q_img_path}", "cleanup")
        with contextlib.suppress(Exception):
            ssh.close()
        job["finished"] = _now().isoformat()


def _process_local_clone(job, item, manager, source_str):
    """Clone an existing local VM/template by VMID into the target VMID."""
    source = int(source_str)
    source_vm = _find_source_vm(manager, source)
    if not source_vm:
        job["status"] = "failed"
        job["error"] = f"source VM {source} not found in cluster"
        job["finished"] = _now().isoformat()
        return

    next_vmid = manager.get_next_vmid()
    if not next_vmid.get("success"):
        job["status"] = "failed"
        job["error"] = str(next_vmid.get("error", "could not determine next VMID"))
        job["finished"] = _now().isoformat()
        return
    newid = int(next_vmid["vmid"])
    job["target_vmid"] = newid

    job["status"] = "running"
    job["started"] = _now().isoformat()

    result = manager.clone_vm(
        node=source_vm.get("node"),
        vmid=source,
        vm_type=source_vm.get("type", "qemu"),
        newid=newid,
        name=_sanitize_vm_name(item.get("name") or item.get("id")),
        full=True,
        target_node=source_vm.get("node"),
    )

    if not result or not result.get("success"):
        job["status"] = "failed"
        job["error"] = str(result.get("error") if result else "clone failed")
        job["finished"] = _now().isoformat()
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
    job["finished"] = _now().isoformat()


def _process_job(job, state):
    """Execute one queued template import, cloning a local VM or importing a cloud image."""
    catalog = _load()
    item = next((t for t in catalog if t.get("id") == job.get("template_id")), None)
    if not item:
        job["status"] = "failed"
        job["error"] = "template not found in catalog"
        job["finished"] = _now().isoformat()
        return

    manager, conn_err = get_connected_manager(job.get("cluster_id"))
    if not manager:
        job["status"] = "failed"
        job["error"] = str(conn_err) if conn_err else "cluster not connected"
        job["finished"] = _now().isoformat()
        return

    source_str = str(item.get("source", "")).strip()
    if not source_str:
        job["status"] = "failed"
        job["error"] = "template source is missing"
        job["finished"] = _now().isoformat()
        return

    if source_str.isdigit():
        _process_local_clone(job, item, manager, source_str)
    else:
        _import_cloud_image(job, item, manager, source_str)


def _run_queued_jobs():
    """Drain any queued template import jobs."""
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
    """Background daemon that repeatedly polls and runs queued imports."""
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
    """Start the import job runner; called by the ProxmoxVEx plugin loader."""
    global _worker_started
    with _state_lock:
        if _worker_started:
            return
        _worker_started = True
    t = threading.Thread(target=_job_worker, daemon=True, name=f"{PLUGIN_ID}-worker")
    t.start()
    log.info("[%s] background worker started", PLUGIN_ID)


def _get_ui():
    _ensure_data_files()
    return send_file(PLUGIN_DIR / "ui.html", mimetype="text/html")


def register(app):
    _ensure_data_files()
    register_plugin_route(PLUGIN_ID, "status", _get_status)
    register_plugin_route(PLUGIN_ID, "clusters", _get_clusters)
    register_plugin_route(PLUGIN_ID, "templates", _templates)
    register_plugin_route(PLUGIN_ID, "template", _delete_template)
    register_plugin_route(PLUGIN_ID, "import", _import_template)
    register_plugin_route(PLUGIN_ID, "jobs", _get_jobs)
    register_plugin_route(PLUGIN_ID, "export", _get_export)
    register_plugin_route(PLUGIN_ID, "pull", _pull_public_list)
    register_plugin_route(PLUGIN_ID, "ui", _get_ui)
    start_background_tasks()
    log.info(f"[PLUGINS] {PLUGIN_ID} registered")
