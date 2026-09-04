/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        web/src/logging.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Logging JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
window.ProxmoxVExLog = window.ProxmoxVExLog || {
    debug: function () { if (localStorage.getItem('ProxmoxVEx-debug') === '1') { console.log.apply(console, arguments); } },
    warn: function () { console.warn.apply(console, arguments); },
    error: function () { console.error.apply(console, arguments); },
    info: function () { console.info.apply(console, arguments); }
};
