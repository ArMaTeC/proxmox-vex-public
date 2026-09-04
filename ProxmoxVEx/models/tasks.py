# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/models/tasks.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: ProxmoxVEx Task Models - Layer 0
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
ProxmoxVEx Task Models - Layer 0
No ProxmoxVEx imports allowed.
"""

import uuid
from datetime import datetime


class MaintenanceTask:
    """Tracks a node evacuation/maintenance task"""

    def __init__(self, node: str):
        self.node = node
        self.started_at = datetime.now()
        self.total_vms = 0
        self.migrated_vms = 0
        self.failed_vms = []
        self.pending_vms = []
        self.status = "starting"
        self.current_vm: dict | None = None
        self.error: str | None = None
        self.acknowledged = False
        self.native_ha = False  # Tracks if Proxmox native HA maintenance was used
        self._discovered_by_refresh = False
        self.note: str | None = None  # Informational note (e.g. single-node: no evacuation target)

    def to_dict(self):
        return {
            "node": self.node,
            "started_at": self.started_at.isoformat(),
            "total_vms": self.total_vms,
            "migrated_vms": self.migrated_vms,
            "failed_vms": self.failed_vms,
            "pending_vms": [{"vmid": vm.get("vmid"), "name": vm.get("name", "unnamed")} for vm in self.pending_vms],
            "status": self.status,
            "current_vm": self.current_vm,
            "progress_percent": round((self.migrated_vms / self.total_vms * 100) if self.total_vms > 0 else 0, 1),
            "error": self.error,
            "acknowledged": self.acknowledged,
            "native_ha": self.native_ha,
            "note": self.note,
        }


class UpdateTask:
    """Tracks node update progress"""

    def __init__(self, node: str, reboot: bool = True):
        self.node = node
        self.reboot = reboot
        self.started_at = datetime.now()
        self.status = "starting"
        self.phase = "init"
        self.output_lines = []
        self.error = None
        self.packages_upgraded = 0
        self.completed_at = None

    def add_output(self, line: str):
        self.output_lines.append({"timestamp": datetime.now().isoformat(), "text": line})
        # Keep only last 100 lines
        if len(self.output_lines) > 100:
            self.output_lines = self.output_lines[-100:]

    def to_dict(self):
        return {
            "node": self.node,
            "reboot": self.reboot,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "status": self.status,
            "phase": self.phase,
            "output_lines": self.output_lines[-20:],  # Last 20 lines for UI
            "error": self.error,
            "packages_upgraded": self.packages_upgraded,
            "duration_seconds": (datetime.now() - self.started_at).total_seconds(),
        }


class BulkActionTask:
    """Tracks a bulk start/stop/restart/snapshot job across multiple guests."""

    def __init__(self, cluster_id, action, guests, params=None):
        self.id = str(uuid.uuid4())
        self.cluster_id = cluster_id
        self.action = action
        self.guests = guests
        self.params = params or {}
        self.started_at = datetime.now()
        self.completed_at = None
        self.status = "starting"
        self.total = len(guests)
        self.completed = 0
        self.failed = 0
        self.results = []
        self.error = None

    def add_result(self, vmid, success, error=None, data=None):
        self.results.append({
            "vmid": vmid,
            "success": success,
            "error": error,
            "data": data,
            "timestamp": datetime.now().isoformat(),
        })
        if success:
            self.completed += 1
        else:
            self.failed += 1

    def set_status(self, status):
        self.status = status
        if status in ("completed", "failed", "completed_with_errors"):
            self.completed_at = datetime.now()

    def to_dict(self):
        return {
            "id": self.id,
            "cluster_id": self.cluster_id,
            "action": self.action,
            "status": self.status,
            "total": self.total,
            "completed": self.completed,
            "failed": self.failed,
            "results": self.results,
            "error": self.error,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "progress_percent": round(((self.completed + self.failed) / self.total * 100) if self.total > 0 else 0, 1),
        }


class ProxmoxVExConfig:
    """Configuration for a single Proxmox cluster"""

    def __init__(self, cluster_data):
        self.name = cluster_data["name"]
        self.host = cluster_data["host"]
        self.user = cluster_data["user"]
        self.pass_ = cluster_data.get("pass", "")
        self.ssl_verification = cluster_data.get("ssl_verification", True)
        self.migration_threshold = cluster_data.get("migration_threshold", 20)
        self.migration_tolerance = cluster_data.get("migration_tolerance", 10)
        self.check_interval = cluster_data.get("check_interval", 300)
        self.auto_migrate = cluster_data.get("auto_migrate", False)
        self.balance_containers = cluster_data.get("balance_containers", False)
        self.balance_local_disks = cluster_data.get("balance_local_disks", False)
        # (#426) - opt-in: derive affinity/anti-affinity/ignore/pin
        # placement rules from ProxLB-convention VM tags. Off = zero change.
        self.proxlb_tags_enabled = cluster_data.get("proxlb_tags_enabled", False)
        self.dry_run = cluster_data.get("dry_run", False)
        self.enabled = cluster_data.get("enabled", True)
        self.ha_enabled = cluster_data.get("ha_enabled", False)
        self.fallback_hosts = cluster_data.get("fallback_hosts", [])
        self.ssh_user = cluster_data.get("ssh_user", "")
        self.ssh_key = cluster_data.get("ssh_key", "")
        self.ssh_port = cluster_data.get("ssh_port", 22)
        # Proxmox API port. Default :8006 covers ~all installs,
        # but ops running PVE on a non-standard port (firewall constraint,
        # multi-tenant single-IP, hardened jumpbox) need to override this.
        # NOTE: We do NOT support reverse-proxied PVE — direct TLS to PVE is
        # the only supported path, by design (no MitM-able intermediate hop).
        try:
            self.api_port = int(cluster_data.get("api_port", 8006) or 8006)
            if not (1 <= self.api_port <= 65535):
                self.api_port = 8006
        except (TypeError, ValueError):
            self.api_port = 8006
        self.ha_settings = cluster_data.get("ha_settings", {})
        self.excluded_nodes = cluster_data.get("excluded_nodes", [])
        self.smbios_autoconfig = cluster_data.get("smbios_autoconfig", {})
        self.api_token_user = cluster_data.get("api_token_user", "")  # E.g. "root@pam!ProxmoxVEx"
        self.api_token_secret = cluster_data.get("api_token_secret", "")
        # VNC SSH-Tunnel-Mode. When True, the VNC websocket from
        # ProxmoxVEx to PVE is routed through the cluster's existing SSH connection
        # (same creds as ssh_user/ssh_key/pass_) instead of going direct to
        # https://pve:8006. Defeats TLS-inspection middleboxes that re-encrypt
        # the second leg and modify binary RFB bytes. Customer-side opt-in.
        self.vnc_tunnel = cluster_data.get("vnc_tunnel", False)
        # Worldmap location. Both None until the operator sets it
        # via the Cluster Edit dialog. location_label is a free-text hint
        # ("Frankfurt DC1") shown in tooltips next to the dot.
        self.latitude = cluster_data.get("latitude")
        self.longitude = cluster_data.get("longitude")
        self.location_label = cluster_data.get("location_label", "") or ""
        # (#364) - load-balancer settings finally hydrated from database.
        # Were API-settable but never persisted before, so users saw "saved"
        # toasts that reverted within seconds.
        self.predictive_balancing = cluster_data.get("predictive_balancing", False)
        self.predictive_threshold = cluster_data.get("predictive_threshold", 0.0)
        self.balance_cpu_weight = cluster_data.get("balance_cpu_weight", 1.0)
        self.balance_mem_weight = cluster_data.get("balance_mem_weight", 1.0)
        self.balance_io_weight = cluster_data.get("balance_io_weight", 1.0)
        self.cpu_baseline = cluster_data.get("cpu_baseline", "")
        # Backup SLA tracking. Hours since last backup beyond which
        # a VM is flagged as breached. 0 = SLA tracking disabled. Warning band is
        # 80% of the limit (hardcoded for now, could be its own setting later).
        self.backup_sla_max_age_hours = int(cluster_data.get("backup_sla_max_age_hours", 0) or 0)
