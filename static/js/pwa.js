/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        static/js/pwa.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Register service worker as soon as possible. SW handles...
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
// Register service worker as soon as possible. SW handles offline shell + push.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(function (reg) { console.log('[PWA] SW registered, scope:', reg.scope); })
            .catch(function (err) { console.warn('[PWA] SW registration failed:', err); });
    });
}
