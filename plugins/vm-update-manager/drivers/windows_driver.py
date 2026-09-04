# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        plugins/vm-update-manager/drivers/windows_driver.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Windows WinRM driver for vm-update-manager.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Windows WinRM driver for vm-update-manager.

Uses pywinrm to execute PowerShell remotely.  Lazy-imports `winrm` so the
plugin can still be loaded when pywinrm is not installed (the driver will
return a clear "not available" error at connection time).
"""

import logging
from datetime import datetime, timezone

from defusedxml import ElementTree as ET

from .base import PackageUpdate, UpdateDriver

WINRM_HTTP_PORT = 5985
WINRM_HTTPS_PORT = 5986


def _now():
    return datetime.now(timezone.utc).isoformat()


def _log(log, level, message):
    if log is not None:
        log.append({"level": level, "message": message, "at": _now()})


class WindowsDriver(UpdateDriver):
    """Windows update driver using WinRM and the Windows Update Agent COM API."""

    def _winrm_session(self, host, port, username, password, private_key=None):
        """Create and return a pywinrm Session, or raise a clear error."""
        # Lazy import so missing pywinrm only breaks at runtime, not import.
        try:
            import winrm
        except Exception as exc:
            raise Exception("Windows driver requires pywinrm. Install it with: pip install pywinrm") from exc

        if not port:
            port = WINRM_HTTPS_PORT

        if port == WINRM_HTTPS_PORT:
            protocol = winrm.Protocol(
                endpoint=f"https://{host}:{port}/wsman",
                transport="ntlm",
                username=username,
                password=password,
                server_cert_validation="ignore",
                message_ttl="PT60S",
            )
        else:
            protocol = winrm.Protocol(
                endpoint=f"http://{host}:{port}/wsman",
                transport="ntlm",
                username=username,
                password=password,
                message_ttl="PT60S",
            )
        return winrm.Session(host, auth=(username, password), protocol=protocol)

    def _run_ps(self, session, script, log=None, timeout=120):
        """Run a PowerShell script and return (ok, stdout, stderr)."""
        _log(log, "cmd", script[:200])
        try:
            session.protocol.set_timeout(timeout)
            r = session.run_ps(script)
            out = r.std_out or ""
            err = r.std_err or ""
            # pywinrm's run_ps may capture encoded output; try to decode.
            if isinstance(out, bytes):
                out = out.decode("utf-8", "ignore")
            if isinstance(err, bytes):
                err = err.decode("utf-8", "ignore")
            if r.status_code != 0:
                _log(log, "error", err or out or f"PowerShell exit {r.status_code}")
                return False, out, err or out
            _log(log, "info", out[:500])
            return True, out, err
        except Exception as e:
            logging.error(f"[vm-update-manager] WinRM run_ps error: {e}")
            _log(log, "error", str(e))
            return False, "", str(e)

    def _search_updates_script(self):
        """PowerShell that lists pending important/optional updates."""
        return """
            $ErrorActionPreference = 'Stop';
            try {
                $Session = New-Object -ComObject Microsoft.Update.Session;
                $Searcher = $Session.CreateUpdateSearcher();
                $Criteria = 'IsInstalled=0 and Type="Software" and IsHidden=0';
                $Result = $Searcher.Search($Criteria);
                $Updates = $Result.Updates;
                $Xml = @('<updates>');
                for ($i = 0; $i -lt $Updates.Count; $i++) {
                    $u = $Updates.Item($i);
                    $kb = '';
                    if ($u.KBArticleIDs -ne $null) {
                        $kb = ($u.KBArticleIDs | ForEach-Object { 'KB' + $_ }) -join ' ';
                    }
                    $severity = $u.MsrcSeverity;
                    $title = [System.Security.SecurityElement]::Escape($u.Title);
                    $Xml += '<update>';
                    $Xml += '<title>' + $title + '</title>';
                    $Xml += '<kb>' + $kb + '</kb>';
                    $Xml += '<severity>' + [System.Security.SecurityElement]::Escape($severity) + '</severity>';
                    $Xml += '</update>';
                }
                $Xml += '</updates>';
                $Xml -join '';
            } catch {
                Write-Output $_.Exception.Message;
                exit 1;
            }
        """

    def _install_updates_script(self):
        """PowerShell that downloads and installs pending updates."""
        return """
            $ErrorActionPreference = 'Stop';
            try {
                $Session = New-Object -ComObject Microsoft.Update.Session;
                $Searcher = $Session.CreateUpdateSearcher();
                $Criteria = 'IsInstalled=0 and Type="Software" and IsHidden=0';
                $Result = $Searcher.Search($Criteria);
                $Updates = $Result.Updates;
                $Count = 0;
                for ($i = 0; $i -lt $Updates.Count; $i++) {
                    $u = $Updates.Item($i);
                    if ($u.EulaAccepted -eq $false) { $u.AcceptEula(); }
                    if ($u.IsDownloaded -eq $false) {
                        $Downloader = $Session.CreateUpdateDownloader();
                        $Downloader.Updates = $u;
                        $Download = $Downloader.Download();
                        if ($Download.ResultCode -ne 2) { continue; }
                    }
                    $Installer = New-Object -ComObject Microsoft.Update.Installer;
                    $Installer.Updates = $u;
                    $Installation = $Installer.Install();
                    if ($Installation.ResultCode -in 2, 3) { $Count++; }
                }
                $Count;
            } catch {
                Write-Output $_.Exception.Message;
                exit 1;
            }
        """

    def connect(self, host, port, username, password, timeout=10, private_key=None):
        log = []
        try:
            session = self._winrm_session(host, port, username, password, private_key)
            # Allow WinRM + NTLM negotiation to take a few seconds.
            session.protocol.set_timeout(timeout)
            ok, out, err = self._run_ps(session, "whoami", log=log, timeout=timeout)
            if not ok:
                return {"ok": False, "error": err or "WinRM connection failed"}
            return {"ok": True, "user": out.strip()}
        except Exception as e:
            logging.error(f"[vm-update-manager] Windows connect error: {e}")
            return {"ok": False, "error": str(e)}

    def discover(self, host, port, username, password, timeout=120, private_key=None):
        log = []
        try:
            session = self._winrm_session(host, port, username, password, private_key)
            ok, out, err = self._run_ps(
                session,
                self._search_updates_script(),
                log=log,
                timeout=timeout,
            )
            if not ok:
                return {
                    "ok": False,
                    "error": err or "Failed to query Windows updates",
                    "packages": [],
                    "log": log,
                }
            packages = self._parse_updates(out)
            return {"ok": True, "packages": [p.to_dict() for p in packages], "log": log}
        except Exception as e:
            logging.error(f"[vm-update-manager] Windows discover error: {e}")
            _log(log, "error", str(e))
            return {"ok": False, "error": str(e), "packages": [], "log": log}

    def _parse_updates(self, xml_out):
        """Parse the XML returned by the Windows Update search."""
        packages = []
        try:
            root = ET.fromstring(xml_out.strip())
            for child in root.findall(".//update"):
                title = child.findtext("title", default="").strip()
                kb = child.findtext("kb", default="").strip()
                severity = child.findtext("severity", default="").strip()
                is_security = bool(severity) and "critical" in severity.lower()
                packages.append(
                    PackageUpdate(
                        name=title or "Unknown update",
                        current_version="",
                        available_version=kb,
                        is_security=is_security,
                    )
                )
        except ET.ParseError as e:
            logging.warning(f"[vm-update-manager] failed to parse Windows update XML: {e}")
        return packages

    def apply(self, host, port, username, password, dry_run=False, timeout=600, private_key=None):
        log = []
        try:
            session = self._winrm_session(host, port, username, password, private_key)
            ok, out, err = self._run_ps(
                session,
                self._search_updates_script(),
                log=log,
                timeout=timeout,
            )
            if not ok:
                return {
                    "ok": False,
                    "error": err or "Failed to query Windows updates before apply",
                    "packages_applied": 0,
                    "log": log,
                }
            pending = self._parse_updates(out)
            if not pending:
                return {"ok": True, "packages_applied": 0, "output": ["No pending updates"], "log": log}

            if dry_run:
                _log(log, "info", f"Dry run: {len(pending)} update(s) would be applied")
                return {
                    "ok": True,
                    "packages_applied": 0,
                    "output": [f"{len(pending)} update(s) would be applied"],
                    "log": log,
                }

            ok, out, err = self._run_ps(
                session,
                self._install_updates_script(),
                log=log,
                timeout=timeout,
            )
            if not ok:
                return {
                    "ok": False,
                    "error": err or "Failed to install Windows updates",
                    "packages_applied": 0,
                    "log": log,
                }
            count = 0
            try:
                count = int(out.strip())
            except ValueError:
                count = len(pending)
            return {
                "ok": True,
                "packages_applied": count,
                "output": [f"Installed {count} update(s)"],
                "log": log,
            }
        except Exception as e:
            logging.error(f"[vm-update-manager] Windows apply error: {e}")
            _log(log, "error", str(e))
            return {"ok": False, "error": str(e), "packages_applied": 0, "log": log}
