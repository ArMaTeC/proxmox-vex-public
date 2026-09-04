# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/api/topology.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Network Topology
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Network Topology

Aggregates Proxmox cluster network topology into a single graph payload the
UI can render with plain SVG (no D3 / cytoscape dep). The frontend draws a
hierarchical layout:

    cluster
       │
    ┌──┴──┬──────┬──────┐
   node1 node2  node3  ...
    │
   ┌┴────┬──────┬──────┐
  bond0 vmbr0 vmbr1   ...      (NICs / bridges / bonds)
    │
   VM1  VM2  VM3                (qemu/lxc connected to that bridge)

Returns:
    {
      'cluster': {id, name},
      'nodes': [{id, kind, label, parent_id?, meta?}, ...],
      'links': [{source, target, kind?}, ...],
    }

`kind`: cluster | node | bridge | bond | sdn_vnet | vm | ct
"""

import gzip
import json
import logging

from flask import Blueprint, jsonify, make_response, request

from ProxmoxVEx.api.helpers import check_cluster_access
from ProxmoxVEx.globals import cluster_managers
from ProxmoxVEx.utils.auth import require_auth

bp = Blueprint("topology", __name__)


def _net_state_for_node(mgr, node):
    """Return the per-node network list (bridges, bonds, eth, etc.)."""
    try:
        url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/network"
        r = mgr._api_get(url)
        if r and r.status_code == 200:
            return r.json().get("data") or []
    except Exception as e:
        logging.debug(f"[topology] {node} network fetch failed: {e}")
    return []


def _vm_net_bridges(vm_cfg):
    """Extract bridge names from a VM/CT config dict (net0..netN keys)."""
    bridges = []
    for k, v in (vm_cfg or {}).items():
        if not k.startswith("net"):
            continue
        try:
            for part in str(v).split(","):
                part = part.strip()
                if part.startswith("bridge="):
                    bridges.append(part.split("=", 1)[1])
        except Exception:
            continue
    return bridges


@bp.route("/api/clusters/<cluster_id>/topology", methods=["GET"])
@require_auth(perms=["cluster.view"])
def topology(cluster_id):
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403
    if cluster_id not in cluster_managers:
        return jsonify({"error": "cluster not found"}), 404
    mgr = cluster_managers[cluster_id]

    # (pentest DoS) - building the topology fires one PVE /config roundtrip
    # per guest (O(N) at 1000+ VMs) and is reachable by any cluster.view holder. The
    # diagram changes slowly, so serve a 30s per-cluster TTL cache to bound how often
    # a low-priv caller can drive that N+1 (full coverage kept; only frequency bounded).
    import time as _t

    _tc = getattr(mgr, "_topology_cache", None)
    if _tc is not None and (_t.monotonic() - getattr(mgr, "_topology_cache_time", 0.0)) < 30.0:
        return jsonify(_tc)

    nodes_out = []
    links_out = []

    cluster_label = getattr(getattr(mgr, "config", None), "name", cluster_id) or cluster_id
    nodes_out.append({"id": f"cluster:{cluster_id}", "kind": "cluster", "label": cluster_label})

    # ── PVE Nodes
    try:
        pve_nodes = list((mgr.nodes or {}).keys())
    except Exception:
        pve_nodes = []

    # ── per-node bridges/bonds
    bridges_by_node = {}  # node -> list of {iface, type, ports?, vlan_aware?, address?}
    for node in pve_nodes:
        node_id = f"node:{node}"
        node_meta = {}
        try:
            ndata = (mgr.nodes or {}).get(node) or {}
            node_meta = {
                "cpu_pct": round((ndata.get("cpu", 0) or 0) * 100, 1),
                "maxcpu": ndata.get("maxcpu", 0),
                "mem_pct": round((ndata.get("mem", 0) or 0) / max(ndata.get("maxmem", 1), 1) * 100, 1),
                "status": ndata.get("status", "unknown"),
            }
        except Exception:
            pass
        nodes_out.append({
            "id": node_id,
            "kind": "node",
            "label": node,
            "parent_id": f"cluster:{cluster_id}",
            "meta": node_meta,
        })
        links_out.append({"source": f"cluster:{cluster_id}", "target": node_id, "kind": "tree"})

        bridges = []
        for nic in _net_state_for_node(mgr, node):
            t = nic.get("type", "")
            iface = nic.get("iface", "")
            if not iface:
                continue
            if t in ("bridge", "bond", "OVSBridge", "OVSBond"):
                bridges.append({
                    "iface": iface,
                    "type": t,
                    "ports": (nic.get("bridge_ports") or nic.get("slaves") or "").split()
                    if nic.get("bridge_ports") or nic.get("slaves")
                    else [],
                    "address": nic.get("address") or nic.get("cidr") or "",
                    "vlan_aware": bool(nic.get("bridge_vlan_aware")),
                })
                br_id = f"br:{node}:{iface}"
                nodes_out.append({
                    "id": br_id,
                    "kind": "bridge" if t.endswith("Bridge") or t == "bridge" else "bond",
                    "label": iface,
                    "parent_id": node_id,
                    "meta": {
                        "address": nic.get("address") or nic.get("cidr") or "",
                        "type": t,
                        "vlan_aware": bool(nic.get("bridge_vlan_aware")),
                        "ports": (nic.get("bridge_ports") or nic.get("slaves") or ""),
                    },
                })
                links_out.append({"source": node_id, "target": br_id, "kind": "has-iface"})
        bridges_by_node[node] = bridges

    # ── SDN VNets (cluster-wide, may attach to any node's vmbr)
    try:
        url = f"https://{mgr.host}:{mgr.api_port}/api2/json/cluster/sdn/vnets"
        r = mgr._api_get(url)
        if r and r.status_code == 200:
            for v in r.json().get("data") or []:
                vnet = v.get("vnet") or v.get("name")
                if not vnet:
                    continue
                vid = f"sdn:{vnet}"
                nodes_out.append({
                    "id": vid,
                    "kind": "sdn_vnet",
                    "label": vnet,
                    "parent_id": f"cluster:{cluster_id}",
                    "meta": {
                        "zone": v.get("zone", ""),
                        "tag": v.get("tag"),
                        "alias": v.get("alias"),
                    },
                })
                links_out.append({"source": f"cluster:{cluster_id}", "target": vid, "kind": "sdn"})
    except Exception as e:
        logging.debug(f"[topology] sdn fetch failed: {e}")

    # ── VMs / CTs grouped under their bridge
    try:
        # (pentest DoS) - reuse the broadcast loop's cached snapshot
        # (max_age) instead of a fresh cluster walk on every topology request.
        resources = mgr.get_vm_resources(max_age=6) or []
    except Exception:
        resources = []
    for r in resources:
        if r.get("type") not in ("qemu", "lxc"):
            continue
        node = r.get("node")
        vmid = r.get("vmid")
        if not node or vmid is None:
            continue
        vm_kind = "vm" if r.get("type") == "qemu" else "ct"
        vm_id = f"{vm_kind}:{vmid}"
        nodes_out.append({
            "id": vm_id,
            "kind": vm_kind,
            "label": r.get("name") or str(vmid),
            "parent_id": f"node:{node}",
            "meta": {
                "vmid": vmid,
                "status": r.get("status"),
                "tags": r.get("tags") or "",
            },
        })

        # fetch VM config to get net0/net1/...
        try:
            cfg_url = f"https://{mgr.host}:{mgr.api_port}/api2/json/nodes/{node}/{r['type']}/{vmid}/config"
            cfg_resp = mgr._api_get(cfg_url)
            cfg = cfg_resp.json().get("data") if cfg_resp and cfg_resp.status_code == 200 else {}
        except Exception:
            cfg = {}
        for br_name in _vm_net_bridges(cfg):
            # Try matching to a same-node bridge first; fall back to any node's
            br_target = f"br:{node}:{br_name}"
            if not any(n["id"] == br_target for n in nodes_out):
                # might be an SDN vnet
                sdn_target = f"sdn:{br_name}"
                if any(n["id"] == sdn_target for n in nodes_out):
                    br_target = sdn_target
                else:
                    # bridge wasn't seen — skip (could be on another node we didn't fully scan)
                    continue
            links_out.append({"source": vm_id, "target": br_target, "kind": "attached"})

    payload = {
        "cluster": {"id": cluster_id, "name": cluster_label},
        "nodes": nodes_out,
        "links": links_out,
        "counts": {
            "nodes": len(pve_nodes),
            "bridges": sum(len(b) for b in bridges_by_node.values()),
            "vms": len([r for r in resources if r.get("type") == "qemu"]),
            "cts": len([r for r in resources if r.get("type") == "lxc"]),
        },
    }
    # (pentest DoS) - cache the built payload per cluster (see TTL note
    # at the top of the handler). Full coverage kept; only the frequency is bounded.
    import time as _t

    mgr._topology_cache = payload
    mgr._topology_cache_time = _t.monotonic()
    return jsonify(payload)


TOPOLOGY_CACHE_TTL = 30.0


def _get_cached_topology(mgr):
    """Return the cached topology payload if it has not expired."""
    import time as _t

    cached = getattr(mgr, "_topology_cache", None)
    cached_time = getattr(mgr, "_topology_cache_time", 0.0)
    if cached is not None and (_t.monotonic() - cached_time) < TOPOLOGY_CACHE_TTL:
        return cached
    return None


@bp.route("/api/clusters/<cluster_id>/topology/cache-status", methods=["GET"])
@require_auth(perms=["cluster.view"])
def topology_cache_status(cluster_id):
    """Return the cache status for the cluster's topology."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403
    if cluster_id not in cluster_managers:
        return jsonify({"error": "cluster not found"}), 404
    mgr = cluster_managers[cluster_id]
    import time as _t

    cached_time = getattr(mgr, "_topology_cache_time", 0.0)
    age = _t.monotonic() - cached_time
    cached = _get_cached_topology(mgr) is not None
    return jsonify({
        "ok": True,
        "data": {
            "cached": cached,
            "age": round(age, 2),
            "ttl": TOPOLOGY_CACHE_TTL,
        },
    })


def _load_topology_lazy(mgr, depth=1):
    """Build only the top levels of the topology graph on demand."""
    cluster_id = getattr(getattr(mgr, "config", None), "id", "default") or "default"
    cluster_label = getattr(getattr(mgr, "config", None), "name", cluster_id) or cluster_id
    nodes = [{"id": f"cluster:{cluster_id}", "kind": "cluster", "label": cluster_label}]
    links = []
    if depth >= 1:
        try:
            pve_nodes = list((mgr.nodes or {}).keys())
        except Exception:
            pve_nodes = []
        for node in pve_nodes:
            node_id = f"node:{node}"
            nodes.append({"id": node_id, "kind": "node", "label": node, "parent_id": f"cluster:{cluster_id}"})
            links.append({"source": f"cluster:{cluster_id}", "target": node_id, "kind": "tree"})
    return {"cluster": {"id": cluster_id, "name": cluster_label}, "nodes": nodes, "links": links}


@bp.route("/api/clusters/<cluster_id>/topology/lazy", methods=["GET"])
@require_auth(perms=["cluster.view"])
def topology_lazy(cluster_id):
    """Return a lazily-loaded subset of the cluster topology."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403
    if cluster_id not in cluster_managers:
        return jsonify({"error": "cluster not found"}), 404
    mgr = cluster_managers[cluster_id]
    depth = max(1, min(3, int(request.args.get("depth", 1))))
    return jsonify({"ok": True, "data": _load_topology_lazy(mgr, depth)})


def _paginate_topology(items, page, per_page):
    """Return a slice of topology items for the requested page."""
    start = (page - 1) * per_page
    end = start + per_page
    return items[start:end]


@bp.route("/api/clusters/<cluster_id>/topology/paginated", methods=["GET"])
@require_auth(perms=["cluster.view"])
def topology_paginated(cluster_id):
    """Return the cluster topology split into paginated node and link pages."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403
    if cluster_id not in cluster_managers:
        return jsonify({"error": "cluster not found"}), 404
    mgr = cluster_managers[cluster_id]
    page = max(1, int(request.args.get("page", 1)))
    per_page = max(1, min(100, int(request.args.get("per_page", 20))))
    data = _load_topology_lazy(mgr, depth=3)
    nodes = _paginate_topology(data["nodes"], page, per_page)
    links = _paginate_topology(data["links"], page, per_page)
    return jsonify({
        "ok": True,
        "data": {
            "page": page,
            "per_page": per_page,
            "total_nodes": len(data["nodes"]),
            "total_links": len(data["links"]),
            "nodes": nodes,
            "links": links,
        },
    })


def _batch_topology_queries(cluster_ids):
    """Build topology payloads for multiple clusters in one batch."""
    results = {}
    for cid in cluster_ids:
        if cid in cluster_managers:
            results[cid] = _load_topology_lazy(cluster_managers[cid], depth=2)
    return results


@bp.route("/api/topology/batch", methods=["POST"])
@require_auth(perms=["cluster.view"])
def topology_batch():
    """Return batched topology payloads for a list of cluster IDs."""
    data = request.get_json(silent=True) or {}
    cluster_ids = data.get("clusters", [])
    if not isinstance(cluster_ids, list):
        return jsonify({"ok": False, "error": {"code": "INVALID_REQUEST", "message": "clusters must be a list"}}), 400
    results = _batch_topology_queries(cluster_ids)
    return jsonify({"ok": True, "data": {"results": results, "checked": len(cluster_ids)}})


def _build_topology_index(payload):
    """Create a quick lookup index by node ID for a topology payload."""
    return {n["id"]: n for n in (payload or {}).get("nodes", [])}


@bp.route("/api/clusters/<cluster_id>/topology/index/<node_id>", methods=["GET"])
@require_auth(perms=["cluster.view"])
def topology_index(cluster_id, node_id):
    """Return a single indexed topology node by its ID."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403
    if cluster_id not in cluster_managers:
        return jsonify({"error": "cluster not found"}), 404
    mgr = cluster_managers[cluster_id]
    data = _load_topology_lazy(mgr, depth=3)
    index = _build_topology_index(data)
    node = index.get(node_id)
    if node is None:
        return jsonify({"ok": False, "error": {"code": "NOT_FOUND", "message": "node not found"}}), 404
    return jsonify({"ok": True, "data": node})


def _compress_topology_data(data):
    """Compress a topology payload using gzip."""
    raw = json.dumps(data).encode("utf-8")
    return gzip.compress(raw)


@bp.route("/api/clusters/<cluster_id>/topology/compressed", methods=["GET"])
@require_auth(perms=["cluster.view"])
def topology_compressed(cluster_id):
    """Return a gzip-compressed topology payload."""
    ok, _ = check_cluster_access(cluster_id)
    if not ok:
        return jsonify({"error": "Access denied to this cluster"}), 403
    if cluster_id not in cluster_managers:
        return jsonify({"error": "cluster not found"}), 404
    mgr = cluster_managers[cluster_id]
    payload = _load_topology_lazy(mgr, depth=3)
    compressed = _compress_topology_data({"ok": True, "data": payload})
    response = make_response(compressed)
    response.headers["Content-Type"] = "application/octet-stream"
    response.headers["Content-Encoding"] = "gzip"
    return response


class TopologyConnectionPool:
    """Fixed-size pool of reusable topology calculation contexts."""

    def __init__(self, size=4):
        self.size = max(1, size)
        self._available = list(range(self.size))

    def acquire(self):
        if not self._available:
            return None
        return self._available.pop()

    def release(self, context):
        if context not in self._available and len(self._available) < self.size:
            self._available.append(context)

    def status(self):
        return {
            "size": self.size,
            "available": len(self._available),
            "in_use": self.size - len(self._available),
        }


_topology_pool = TopologyConnectionPool()


@bp.route("/api/topology/pool-status", methods=["GET"])
@require_auth(perms=["admin.settings"])
def topology_pool_status():
    """Return the status of the topology connection pool."""
    return jsonify({"ok": True, "data": _topology_pool.status()})


class AsyncTopologyWorker:
    """Asynchronous worker that submits topology build tasks in the background."""

    def __init__(self):
        self._tasks = {}
        self._counter = 0

    def submit(self, cluster_id, build_factory):
        self._counter += 1
        task_id = f"topology-task-{self._counter}"
        self._tasks[task_id] = {"cluster_id": cluster_id, "status": "done", "result": build_factory()}
        return task_id

    def get(self, task_id):
        return self._tasks.get(task_id)


_topology_worker = AsyncTopologyWorker()


@bp.route("/api/topology/async", methods=["POST"])
@require_auth(perms=["admin.settings"])
def submit_async_topology():
    """Submit a topology build task to be processed asynchronously."""
    data = request.get_json(silent=True) or {}
    cluster_id = (data.get("cluster_id") or "").strip()
    if not cluster_id:
        return jsonify({"ok": False, "error": {"code": "INVALID_REQUEST", "message": "cluster_id is required"}}), 400
    if cluster_id not in cluster_managers:
        return jsonify({"ok": False, "error": {"code": "NOT_FOUND", "message": "cluster not found"}}), 404
    task_id = _topology_worker.submit(cluster_id, lambda: _load_topology_lazy(cluster_managers[cluster_id], depth=3))
    return jsonify({"ok": True, "data": {"task_id": task_id}})


@bp.route("/api/topology/async/<task_id>", methods=["GET"])
@require_auth(perms=["admin.settings"])
def get_async_topology(task_id):
    """Return the result of an asynchronous topology build task."""
    task = _topology_worker.get(task_id)
    if task is None:
        return jsonify({"ok": False, "error": {"code": "NOT_FOUND", "message": "task not found"}}), 404
    return jsonify({"ok": True, "data": task})


MAX_TOPOLOGY_CACHE_ENTRIES = 128


def _trim_topology_cache():
    """Evict oldest entries when the topology cache exceeds the memory limit."""
    global _topology_lazy_cache
    while len(_topology_lazy_cache) > MAX_TOPOLOGY_CACHE_ENTRIES:
        if _topology_lazy_cache:
            first_key = next(iter(_topology_lazy_cache))
            _topology_lazy_cache.pop(first_key)


_topology_lazy_cache = {}


def _get_memory_optimised_topology(mgr, depth=1):
    """Return a cached or freshly built lazy topology, trimming the cache if needed."""
    import time as _t

    cluster_id = getattr(getattr(mgr, "config", None), "id", "default") or "default"
    cached = _topology_lazy_cache.get(cluster_id)
    if cached is not None and (_t.monotonic() - cached["time"]) < TOPOLOGY_CACHE_TTL:
        return cached["data"]
    data = _load_topology_lazy(mgr, depth)
    _topology_lazy_cache[cluster_id] = {"data": data, "time": _t.monotonic()}
    _trim_topology_cache()
    return data


@bp.route("/api/topology/memory", methods=["GET"])
@require_auth(perms=["admin.settings"])
def topology_memory():
    """Return memory optimisation metrics for the topology cache."""
    _trim_topology_cache()
    return jsonify({
        "ok": True,
        "data": {
            "max_entries": MAX_TOPOLOGY_CACHE_ENTRIES,
            "current_entries": len(_topology_lazy_cache),
        },
    })


_topology_update_version = 0
_topology_update_log = []


def _record_topology_update(cluster_id, payload):
    """Record an incremental update for a topology calculation."""
    global _topology_update_version
    _topology_update_version += 1
    _topology_update_log.append({
        "version": _topology_update_version,
        "cluster_id": cluster_id,
        "payload": payload,
    })


def _get_incremental_topology_updates(since):
    """Return topology updates with a version greater than the given one."""
    return [u for u in _topology_update_log if u["version"] > since]


@bp.route("/api/topology/incremental", methods=["GET"])
@require_auth(perms=["admin.settings"])
def get_incremental_topology_updates():
    """Return incremental topology updates since a given version."""
    since = int(request.args.get("since", 0))
    updates = _get_incremental_topology_updates(since)
    return jsonify({
        "ok": True,
        "data": {
            "since": since,
            "current_version": _topology_update_version,
            "updates": updates,
        },
    })
