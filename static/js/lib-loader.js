/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        static/js/lib-loader.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Global flag to know when libs are ready
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
// Global flag to know when libs are ready
window.ProxmoxVExLibsReady = false;

// SRI Hashes for supply chain security - verify CDN scripts haven't been tampered with
// IMPORTANT: Update these hashes when upgrading library versions!
// Generate hashes at: https://www.srihash.org/ or use jsDelivr's ?integrity query
// Example: curl -s https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js | openssl dgst -sha384 -binary | openssl base64 -A
// Empty string = skip SRI check (use during development, fill in for production)
// Populated SRI hashes for supply chain protection
// Pinned to exact versions so SRI hashes stay stable
const SRI_HASHES = {
    'react@18.3.1': 'sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z',
    'react-dom@18.3.1': 'sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1',
    'babel@7.29.2': 'sha384-dqDn4UOhYWNxmtwnMX6yC3WtZZ6Li8rF6rLB7cu0i/R7btvb+p+kObgEHto7VsJK',
    'chart.js@4.5.1': 'sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ',
    'novnc@1.4.0': '',  // loaded as ES module, SRI not supported for dynamic import
    'xterm@5.3.0': 'sha384-xjfWUeCWdMtvpAb/SmM6lMzS6pQGcQa0loOl1d97j6Odw0vjK9nW3+dTb/bn/mwH',
    'xterm-addon-fit@0.8.0': 'sha384-dpjGwSSISUTz2taP54Bor7qkyMR20sSO9oe11UVYnGs2/YdUBf7HW30XKQx9PCzn',
    'marked@15.0.7': 'sha384-H+hy9ULve6xfxRkWIh/YOtvDdpXgV2fmAGQkIDTxIgZwNoaoBal14Di2YTMR6MzR',
    'dompurify@3.2.4': 'sha384-eEu5CTj3qGvu9PdJuS+YlkNi7d2XxQROAFYOr59zgObtlcux1ae1Il3u7jvdCSWu'
};

// Local-first. Air-gapped customers were watching the
// browser hang on CDN timeouts before the offline fallback kicked in,
// because navigator.onLine returns true on isolated LANs. Now we
// always try /static first; CDN only fires if local 404s AND the
// air-gap flag isn't set. The flag is persisted to localStorage by
// the auth-check handler in contexts.js.
var _isAirGapped = function () {
    // (offline): also honour a SESSION-only auto-latch set when
    // the browser turns out to have no internet (navigator.onLine lies on
    // isolated LANs). The backend still injects the persisted flag when
    // air_gap_mode is enabled; this window flag catches "no internet but
    // air-gap not enabled" so lazy modal loaders skip dead CDN fallbacks.
    try { if (window.__ProxmoxVExAirGap === true) return true; } catch (_) { }
    try { return localStorage.getItem('ProxmoxVEx-air-gap') === '1'; }
    catch (_) { return false; }
};
function loadScriptWithFallback(cdnUrl, localUrl, integrityKey) {
    return new Promise(function (resolve) {
        var local = document.createElement('script');
        local.src = localUrl;
        local.onload = resolve;
        local.onerror = function () {
            if (_isAirGapped()) {
                console.error('[air-gap] local asset missing, refusing CDN fetch:', localUrl);
                resolve();
                return;
            }
            console.warn('Local asset missing, falling back to CDN:', cdnUrl);
            var cdn = document.createElement('script');
            cdn.src = cdnUrl;
            if (integrityKey && SRI_HASHES[integrityKey]) {
                cdn.integrity = SRI_HASHES[integrityKey];
                cdn.crossOrigin = 'anonymous';
            }
            cdn.onload = resolve;
            cdn.onerror = function () {
                console.error('Both local and CDN failed for', localUrl);
                resolve();
            };
            document.head.appendChild(cdn);
        };
        document.head.appendChild(local);
    });
}

// Load in sequence - using jsdelivr instead of unpkg (faster + better caching)
loadScriptWithFallback(
    'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
    '/static/js/react.production.min.js',
    'react@18.3.1'
).then(function () {
    return loadScriptWithFallback(
        'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js',
        '/static/js/react-dom.production.min.js',
        'react-dom@18.3.1'
    );
}).then(function () {
    return loadScriptWithFallback(
        'https://cdn.jsdelivr.net/npm/@babel/standalone@7.29.2/babel.min.js',
        '/static/js/babel.min.js',
        'babel@7.29.2'
    );
}).then(function () {
    return loadScriptWithFallback(
        'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
        '/static/js/chart.umd.min.js',
        'chart.js@4.5.1'
    );
}).then(function () {
    return loadScriptWithFallback(
        'https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js',
        '/static/js/marked.min.js',
        'marked@15.0.7'
    );
}).then(function () {
    return loadScriptWithFallback(
        'https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js',
        '/static/js/purify.min.js',
        'dompurify@3.2.4'
    );
}).then(function () {
    return loadScriptWithFallback(
        'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
        '/static/js/jspdf.umd.min.js',
        'jspdf@2.5.2'
    );
}).then(function () {
    return loadScriptWithFallback(
        'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js',
        '/static/js/jspdf.plugin.autotable.min.js',
        'jspdf-autotable@3.8.4'
    );
}).then(function () {
    // All libs loaded - transform babel scripts
    window.ProxmoxVExLibsReady = true;
    if (window.Babel) {
        Babel.transformScriptTags();
    }
});
