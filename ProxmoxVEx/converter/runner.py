# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/converter/runner.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Execute commands on a Proxmox node through the existing...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
Execute commands on a Proxmox node through the existing ProxmoxVEx cluster manager.
This keeps credential handling inside the audited cluster manager.
"""

from __future__ import annotations

from dataclasses import dataclass

from ProxmoxVEx.globals import cluster_managers


@dataclass
class RunResult:
    """Result of a command executed on a Proxmox node."""

    returncode: int
    stdout: str
    stderr: str
    command: str

    @property
    def ok(self) -> bool:
        return self.returncode == 0


class NodeRunner:
    """Run commands on a Proxmox node using the ProxmoxVEx cluster manager."""

    def __init__(self, cluster_id: str, node: str):
        self.cluster_id = cluster_id
        self.node = node
        manager = cluster_managers.get(cluster_id)
        if manager is None:
            raise RuntimeError(f"Cluster '{cluster_id}' is not connected")
        self.manager = manager

    def run(self, command: list[str] | str, timeout: int = 300) -> RunResult:
        """Execute a command on the node and return stdout/stderr/exit code.

        Args:
            command: Either a list of arguments (preferred) or a shell string.
            timeout: Maximum seconds to wait for the command.
        """
        import shlex

        command_str = " ".join(shlex.quote(str(arg)) for arg in command) if isinstance(command, list) else command

        if not (self.manager is not None):
            raise AssertionError("invariant failed")
        ssh_user = getattr(self.manager.config, "ssh_user", "root") or "root"
        ssh_key = getattr(self.manager.config, "ssh_key", "")
        ssh_password = getattr(self.manager.config, "pass_", "")
        node_ip = self._resolve_node_ip()

        output = None
        if ssh_key:
            output = self.manager._ssh_run_command_with_key_output(
                node_ip, ssh_user, command_str, ssh_key, timeout=timeout
            )
        if output is None:
            output = self.manager._ssh_run_command_output(node_ip, ssh_user, command_str, timeout=timeout)
        if output is None and ssh_password:
            output = self.manager._ssh_run_command_with_password_output(
                node_ip, ssh_user, command_str, ssh_password, timeout=timeout
            )

        if output is None:
            return RunResult(
                returncode=-1,
                stdout="",
                stderr="Command could not be executed (SSH connection failed)",
                command=command_str,
            )

        # The SSH helpers return stdout only and log stderr. We surface a
        # generic success here; callers that need exit codes can run
        # `command; echo EXIT:$?` if required.
        return RunResult(
            returncode=0,
            stdout=output,
            stderr="",
            command=command_str,
        )

    def run_with_status(self, command: list[str] | str, timeout: int = 300) -> RunResult:
        """Execute a command and capture both exit code and output.

        Wraps the command in a shell that emits `EXIT:<code>`.
        """
        import shlex

        command_str = " ".join(shlex.quote(str(arg)) for arg in command) if isinstance(command, list) else command

        wrapped = f"{{ {command_str}; }}; echo EXIT:$?"
        result = self.run(wrapped, timeout=timeout)
        stdout = result.stdout.strip()
        if "\nEXIT:" in stdout:
            *body, last = stdout.rsplit("\nEXIT:", 1)
            try:
                rc = int(last.strip().split()[0])
            except (ValueError, IndexError):
                rc = result.returncode
            result = RunResult(
                returncode=rc,
                stdout="\n".join(body).strip(),
                stderr=result.stderr,
                command=command_str,
            )
        return result

    def _resolve_node_ip(self) -> str:
        """Resolve the node's management IP through the cluster manager."""
        if not (self.manager is not None):
            raise AssertionError("invariant failed")
        nodes = getattr(self.manager, "nodes", {})
        node_info = nodes.get(self.node, {})
        ip = node_info.get("ip") or node_info.get("host")
        if ip:
            return ip
        # Fallback: use the configured cluster host if node name matches.
        cluster_host = getattr(self.manager.config, "host", "")
        if cluster_host and self.node in (cluster_host, "localhost"):
            return cluster_host
        return self.node


def get_runner(cluster_id: str, node: str) -> NodeRunner:
    return NodeRunner(cluster_id, node)
