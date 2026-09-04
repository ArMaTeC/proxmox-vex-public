/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        web/src/i18n_bridge.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: I18N Bridge JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
(function () {
    // Auto-discover every inlined core locale, converting the safe JS variable
    // name (e.g. _i18n_core_zh_hans) back to the original language code.
    var coreLangs = {};
    var _i18nPrefix = '_i18n_core_';
    for (var _k in window) {
        if (_k.indexOf(_i18nPrefix) === 0 && typeof window[_k] === 'object' && window[_k] !== null) {
            var _code = _k.substring(_i18nPrefix.length).replace(/_/g, '-');
            coreLangs[_code] = window[_k];
        }
    }

    ProxmoxVExI18n.registerNamespaceBulk('core', coreLangs);

    // Backward-compatible `translations` object for contexts.js
    // contexts.js does: translations[language]?.[key]
    window.translations = coreLangs;
})();

// Legacy alias — the variable name contexts.js references directly.
var translations = window.translations;
