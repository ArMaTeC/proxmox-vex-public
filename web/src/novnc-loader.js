/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        web/src/novnc-loader.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Novnc Loader JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
window.loadNoVNC = function () {
    return new Promise((resolve, reject) => {
        if (window.RFB) { resolve(); return; }
        var script = document.createElement('script');
        script.type = 'module';
        script.src = '/static/js/rfb.js';
        script.onerror = function () {
            if (_isAirGapped && _isAirGapped()) {
                console.error('[air-gap] /static/js/rfb.js missing; not falling back to CDN');
                resolve();
                return;
            }
            this.src = 'https://cdn.jsdelivr.net/npm/@novnc/novnc@1.4.0/core/rfb.js';
            if (SRI_HASHES['novnc@1.4.0']) {
                this.integrity = SRI_HASHES['novnc@1.4.0'];
                this.crossOrigin = 'anonymous';
            }
        };
        script.onload = resolve;
        document.head.appendChild(script);
    });
};
