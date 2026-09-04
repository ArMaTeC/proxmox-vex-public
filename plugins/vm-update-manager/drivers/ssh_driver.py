# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-update-manager/drivers/ssh_driver.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Ssh Driver PY source
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
import logging
import re
from datetime import datetime, timezone

from ProxmoxVEx.utils.sanitization import sanitize_console_message, sanitize_log_message
from ProxmoxVEx.utils.ssh import _ssh_exec

from .base import PackageUpdate, UpdateDriver


def _now():
    return datetime.now(timezone.utc).isoformat()


def _log(log, level, message):
    # Use the newline-preserving console sanitizer here (not
    # sanitize_log_message) because this feeds a structured per-line JSON
    # log rendered by the plugin UI with `white-space: pre-wrap`; flattening
    # `\n` to spaces made multi-line command output unreadable.
    if log is not None:
        log.append({"level": level, "message": sanitize_console_message(message), "at": _now()})


_APT_RE = re.compile(r"^(\S+)/(\S+)\s+(\S+)\s+(\S+)\s+\[upgradable from:\s+([^\]]+)\]")
_DNF_RE = re.compile(r"^(\S+)\s+(\S+)\s+(\S+)")
_APK_INSTALLED = re.compile(r"installed:\s+(\S+)")


class SSHDriver(UpdateDriver):
    """Linux update driver using the existing ProxmoxVEx SSH helper."""

    def connect(self, host, port, username, password, timeout=10, private_key=None):
        try:
            connect_timeout = min(timeout, 8)
            rc, out, err = _ssh_exec(
                host,
                username,
                password,
                "whoami",
                timeout=timeout,
                connect_timeout=connect_timeout,
                port=port,
                private_key=private_key,
            )
            if rc != 0:
                return {
                    "ok": False,
                    "error": sanitize_log_message(err or "SSH connection failed"),
                }
            return {"ok": True, "user": out.strip()}
        except Exception as e:
            logging.error(f"[vm-update-manager] SSH connect error: {e}")
            return {"ok": False, "error": sanitize_log_message(str(e))}

    def _run(self, host, port, username, password, cmd, timeout, log=None, private_key=None):
        _log(log, "cmd", cmd)
        rc, out, err = _ssh_exec(
            host,
            username,
            password,
            cmd,
            timeout=timeout,
            connect_timeout=min(timeout, 8),
            port=port,
            private_key=private_key,
        )
        if rc != 0:
            msg = sanitize_log_message(err or out or "SSH command failed")
            _log(log, "error", msg)
            raise Exception(msg)
        _log(log, "info", out)
        return out

    def _detect_os(self, host, port, username, password, timeout, log=None, private_key=None):
        try:
            out = self._run(host, port, username, password, "cat /etc/os-release", 15, log=log, private_key=private_key)
            data = {}
            for line in out.splitlines():
                if "=" not in line:
                    continue
                key, _, value = line.partition("=")
                data[key.lower()] = value.strip().strip('"')
            os_id = data.get("id", "unknown").lower()
            id_like = data.get("id_like", "").lower()
            if os_id == "ubuntu":
                return "ubuntu"
            if os_id == "debian" or "debian" in id_like:
                return "debian"
            if os_id == "alpine":
                return "alpine"
            if os_id in ("centos", "rhel", "rocky", "almalinux") or "rhel" in id_like or "centos" in id_like:
                return "centos"
            return "unknown"
        except Exception as e:
            logging.warning(f"[vm-update-manager] OS detection failed: {e}")
            return "unknown"

    def discover(self, host, port, username, password, timeout=120, private_key=None):
        log = []
        try:
            os_family = self._detect_os(host, port, username, password, timeout, log=log, private_key=private_key)
            if os_family == "unknown":
                _log(log, "error", "Could not detect OS family from /etc/os-release")
                return {
                    "ok": False,
                    "error": "Could not detect OS family from /etc/os-release",
                    "packages": [],
                    "log": log,
                }
            if os_family in ("debian", "ubuntu"):
                result = self._discover_apt(host, port, username, password, timeout, log=log, private_key=private_key)
                result["log"] = log
                return result
            if os_family == "alpine":
                result = self._discover_apk(host, port, username, password, timeout, log=log, private_key=private_key)
                result["log"] = log
                return result
            if os_family == "centos":
                result = self._discover_yum_dnf(
                    host, port, username, password, timeout, log=log, private_key=private_key
                )
                result["log"] = log
                return result
            _log(log, "error", f"OS family '{os_family}' is not supported")
            return {
                "ok": False,
                "error": f"OS family '{os_family}' is not supported",
                "packages": [],
                "log": log,
            }
        except Exception as e:
            logging.error(f"[vm-update-manager] discover error: {e}")
            _log(log, "error", str(e))
            return {
                "ok": False,
                "error": sanitize_log_message(str(e)),
                "packages": [],
                "log": log,
            }

    def _discover_apt(self, host, port, username, password, timeout, log=None, private_key=None):
        out = self._run(
            host,
            port,
            username,
            password,
            "apt list --upgradable 2>/dev/null",
            timeout,
            log=log,
            private_key=private_key,
        )
        packages = []
        for line in out.splitlines():
            m = _APT_RE.match(line)
            if not m:
                continue
            repo = m.group(2) or ""
            is_security = "security" in repo.lower()
            packages.append(
                PackageUpdate(
                    name=m.group(1),
                    current_version=m.group(5).strip(),
                    available_version=m.group(3),
                    is_security=is_security,
                )
            )
        return {"ok": True, "packages": [p.to_dict() for p in packages], "log": log}

    def _discover_apk(self, host, port, username, password, timeout, log=None, private_key=None):
        out = self._run(
            host,
            port,
            username,
            password,
            "apk -v list --upgradable 2>/dev/null",
            timeout,
            log=log,
            private_key=private_key,
        )
        packages = []
        for line in out.splitlines():
            parts = line.split()
            if not parts:
                continue
            name = parts[0]
            available = parts[1] if len(parts) > 1 else ""
            installed = ""
            m = _APK_INSTALLED.search(line)
            if m:
                installed = m.group(1)
            packages.append(
                PackageUpdate(
                    name=name,
                    current_version=installed,
                    available_version=available,
                )
            )
        return {"ok": True, "packages": [p.to_dict() for p in packages], "log": log}

    def _discover_yum_dnf(self, host, port, username, password, timeout, log=None, private_key=None):
        # Prefer dnf; older CentOS uses yum. Fall back gracefully.
        for tool in ("dnf", "yum"):
            try:
                out = self._run(
                    host,
                    port,
                    username,
                    password,
                    f"{tool} list updates 2>/dev/null",
                    timeout,
                    log=log,
                    private_key=private_key,
                )
                break
            except Exception:
                continue
        else:
            raise Exception("Neither dnf nor yum is available")

        packages = []
        started = False
        for line in out.splitlines():
            if not started:
                if (
                    "available" in line.lower()
                    and "upgrades" in line.lower()
                    or line.strip().lower().startswith("available")
                ):
                    started = True
                continue
            m = _DNF_RE.match(line)
            if not m:
                continue
            full_name = m.group(1)
            name = full_name.rsplit(".", 1)[0] if "." in full_name else full_name
            repo = m.group(3) or ""
            is_security = "security" in repo.lower()
            packages.append(
                PackageUpdate(
                    name=name,
                    current_version="",
                    available_version=m.group(2),
                    is_security=is_security,
                )
            )
        return {"ok": True, "packages": [p.to_dict() for p in packages], "log": log}

    def apply(self, host, port, username, password, dry_run=False, timeout=600, private_key=None):
        log = []
        try:
            os_family = self._detect_os(host, port, username, password, 30, log=log, private_key=private_key)
            if os_family == "unknown":
                _log(log, "error", "Could not detect OS family from /etc/os-release")
                return {
                    "ok": False,
                    "error": "Could not detect OS family from /etc/os-release",
                    "packages_applied": 0,
                    "log": log,
                }
            if os_family in ("debian", "ubuntu"):
                result = self._apply_apt(
                    host, port, username, password, dry_run, timeout, log=log, private_key=private_key
                )
                result["log"] = log
                return result
            if os_family == "alpine":
                result = self._apply_apk(
                    host, port, username, password, dry_run, timeout, log=log, private_key=private_key
                )
                result["log"] = log
                return result
            if os_family == "centos":
                result = self._apply_yum_dnf(
                    host, port, username, password, dry_run, timeout, log=log, private_key=private_key
                )
                result["log"] = log
                return result
            _log(log, "error", f"OS family '{os_family}' is not supported")
            return {
                "ok": False,
                "error": f"OS family '{os_family}' is not supported",
                "packages_applied": 0,
                "log": log,
            }
        except Exception as e:
            logging.error(f"[vm-update-manager] apply error: {e}")
            _log(log, "error", str(e))
            return {
                "ok": False,
                "error": sanitize_log_message(str(e)),
                "packages_applied": 0,
                "log": log,
            }

    def _apply_apt(self, host, port, username, password, dry_run, timeout, log=None, private_key=None):
        flags = '-o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"'
        if dry_run:
            cmd = f"DEBIAN_FRONTEND=noninteractive apt-get -s -y {flags} upgrade"
        else:
            cmd = f"DEBIAN_FRONTEND=noninteractive apt-get -y {flags} upgrade"
        out = self._run(host, port, username, password, cmd, timeout, log=log, private_key=private_key)
        output = [sanitize_log_message(line) for line in out.splitlines() if line.strip()]
        count = 0
        if dry_run:
            count = len([line for line in output if line.startswith("Inst ")])
        else:
            count = len(re.findall(r"^Setting up\s+(\S+)", out, re.MULTILINE))
        return {"ok": True, "packages_applied": count, "output": output, "log": log}

    def _apply_apk(self, host, port, username, password, dry_run, timeout, log=None, private_key=None):
        cmd = "apk upgrade -s" if dry_run else "apk upgrade"
        out = self._run(host, port, username, password, cmd, timeout, log=log, private_key=private_key)
        output = [sanitize_log_message(line) for line in out.splitlines() if line.strip()]
        count = 0
        if dry_run:
            count = len(re.findall(r"^\S+\s+\S+\s+installed:", out, re.MULTILINE))
        else:
            count = len(re.findall(r"^Upgrading\s+(\S+)", out, re.MULTILINE))
        return {"ok": True, "packages_applied": count, "output": output, "log": log}

    def _apply_yum_dnf(self, host, port, username, password, dry_run, timeout, log=None, private_key=None):
        for tool in ("dnf", "yum"):
            try:
                cmd = f"{tool} -y --setopt=tsflags=test update" if dry_run else f"{tool} -y update"
                out = self._run(host, port, username, password, cmd, timeout, log=log, private_key=private_key)
                break
            except Exception:
                continue
        else:
            raise Exception("Neither dnf nor yum is available")
        output = [sanitize_log_message(line) for line in out.splitlines() if line.strip()]
        count = 0
        if dry_run:
            count = len(re.findall(r"^\S+\s+\S+\s+\S+", out, re.MULTILINE))
        else:
            count = len(re.findall(r"^\s*Updating\s+:\s+(\S+)", out, re.MULTILINE))
        return {"ok": True, "packages_applied": count, "output": output, "log": log}
