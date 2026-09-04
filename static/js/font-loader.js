/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        static/js/font-loader.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Font Loader JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
(function () {
    // Use the bundled offline font CSS instead of the Google Fonts API.
    // Google Fonts CSS can reference .woff2 URLs that 404 in CI, causing
    // deterministic Playwright smoke-test failures.
    var fontHref = '/static/css/fonts.css';
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = fontHref;
    l.media = 'print';
    l.onload = function () { this.media = 'all'; };
    l.onerror = function () { this.remove(); };
    setTimeout(function () { if (l.media !== 'all') l.media = 'all'; }, 3000);
    document.head.appendChild(l);
})();
