/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        web/i18n/i18n.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: I18N JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
const ProxmoxVExI18n = (function () {
  'use strict';

  // ─── State ───────────────────────────────────────────────────────────────
  const _namespaces = {};  // { ns: { lang: { key: value } } }
  let _currentLang = 'en';
  let _supportedLangs = ['de', 'en', 'it', 'fr', 'es', 'pt', 'ko', 'ja', 'zh-hans', 'ar', 'hi', 'ru', 'id', 'tr'];
  let _fallbackLang = 'en';

  // Base URL for loading locale JSON files. Auto-detected from script location
  // or set explicitly via configure(). Default assumes served from /i18n/locales/.
  let _baseUrl = '/i18n/locales';

  // ─── Internal Helpers ────────────────────────────────────────────────────

  /**
   * Resolve a translation key in a namespace with fallback chain.
   */
  function _resolve(ns, key) {
    const nsData = _namespaces[ns];
    if (!nsData) return undefined;

    // Try current language
    const langDict = nsData[_currentLang];
    if (langDict && langDict[key] !== undefined) return langDict[key];

    // Try fallback language
    if (_currentLang !== _fallbackLang) {
      const fbDict = nsData[_fallbackLang];
      if (fbDict && fbDict[key] !== undefined) return fbDict[key];
    }

    return undefined;
  }

  /**
   * The main translation function.
   * @param {string} key - Translation key, optionally "namespace.key" format
   * @param {object} [opts] - Options: { ns: 'namespace', params: { var: val } }
   * @returns {string}
   */
  function t(key, opts) {
    if (key == null) return '';

    let ns = 'core';
    let lookupKey = String(key);

    // Support namespace prefix: "truenas.replication"
    if (opts && opts.ns) {
      ns = opts.ns;
    } else {
      const dotIdx = lookupKey.indexOf('.');
      if (dotIdx > 0 && _namespaces[lookupKey.slice(0, dotIdx)]) {
        ns = lookupKey.slice(0, dotIdx);
        lookupKey = lookupKey.slice(dotIdx + 1);
      }
    }

    let result = _resolve(ns, lookupKey);

    // If not found in specified namespace, try core as ultimate fallback
    if (result === undefined && ns !== 'core') {
      result = _resolve('core', lookupKey);
    }

    // If still not found, return the key itself
    if (result === undefined) return lookupKey;

    // Interpolation: replace {varName} with params
    if (opts && opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        result = result.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
      }
    }

    return result;
  }

  // ─── Namespace Management ────────────────────────────────────────────────

  /**
   * Register translations for a namespace synchronously.
   * Used during initial bundle load (core) or when JSON is already available.
   */
  function registerNamespace(ns, lang, translations) {
    if (!_namespaces[ns]) _namespaces[ns] = {};
    _namespaces[ns][lang] = translations;
  }

  /**
   * Register an entire namespace with all languages at once.
   * @param {string} ns - Namespace name
   * @param {object} allLangs - { lang: { key: value } }
   */
  function registerNamespaceBulk(ns, allLangs) {
    _namespaces[ns] = {};
    for (const [lang, dict] of Object.entries(allLangs)) {
      _namespaces[ns][lang] = dict;
    }
  }

  /**
   * Load a namespace's translation file for the current language via fetch.
   * Returns a Promise that resolves when the namespace is ready.
   */
  async function loadNamespace(ns, opts) {
    const lang = (opts && opts.lang) || _currentLang;
    if (_namespaces[ns] && _namespaces[ns][lang]) {
      return _namespaces[ns][lang]; // already loaded
    }

    const url = _baseUrl + '/' + ns + '/' + lang + '.json';
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        // Try fallback language
        if (lang !== _fallbackLang) {
          const fbUrl = _baseUrl + '/' + ns + '/' + _fallbackLang + '.json';
          const fbResp = await fetch(fbUrl);
          if (fbResp.ok) {
            const data = await fbResp.json();
            registerNamespace(ns, _fallbackLang, data);
            return data;
          }
        }
        console.warn('[i18n] Failed to load ' + url + ': ' + resp.status);
        return null;
      }
      const data = await resp.json();
      registerNamespace(ns, lang, data);
      return data;
    } catch (e) {
      console.warn('[i18n] Error loading ' + url + ':', e.message);
      return null;
    }
  }

  /**
   * Load a namespace for all required languages (current + fallback).
   */
  async function loadNamespaceFull(ns) {
    const loads = [loadNamespace(ns, { lang: _currentLang })];
    if (_currentLang !== _fallbackLang) {
      loads.push(loadNamespace(ns, { lang: _fallbackLang }));
    }
    await Promise.all(loads);
  }

  /**
   * Load a namespace from a custom base URL (e.g., plugin i18n files).
   */
  async function loadPluginNamespace(ns, baseUrl, opts) {
    const lang = (opts && opts.lang) || _currentLang;
    if (_namespaces[ns] && _namespaces[ns][lang]) {
      return _namespaces[ns][lang];
    }
    const url = (baseUrl || '').replace(/\/$/, '') + '/' + lang + '.json';
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        if (lang !== _fallbackLang) {
          const fbUrl = (baseUrl || '').replace(/\/$/, '') + '/' + _fallbackLang + '.json';
          const fbResp = await fetch(fbUrl);
          if (fbResp.ok) {
            const data = await fbResp.json();
            registerNamespace(ns, _fallbackLang, data);
            return data;
          }
        }
        console.warn('[i18n] Failed to load ' + url + ': ' + resp.status);
        return null;
      }
      const data = await resp.json();
      registerNamespace(ns, lang, data);
      return data;
    } catch (e) {
      console.warn('[i18n] Error loading ' + url + ':', e.message);
      return null;
    }
  }

  /**
   * Load a plugin namespace for current language and fallback.
   */
  async function loadPluginNamespaceFull(ns, baseUrl) {
    const loads = [loadPluginNamespace(ns, baseUrl, { lang: _currentLang })];
    if (_currentLang !== _fallbackLang) {
      loads.push(loadPluginNamespace(ns, baseUrl, { lang: _fallbackLang }));
    }
    await Promise.all(loads);
  }

  // ─── Configuration ───────────────────────────────────────────────────────

  function configure(opts) {
    if (opts.lang) _currentLang = opts.lang;
    if (opts.supportedLangs) _supportedLangs = opts.supportedLangs;
    if (opts.fallbackLang) _fallbackLang = opts.fallbackLang;
    if (opts.baseUrl) _baseUrl = opts.baseUrl;
  }

  function setLanguage(lang) {
    if (_supportedLangs.includes(lang)) {
      _currentLang = lang;
    }
  }

  function getLanguage() {
    return _currentLang;
  }

  function getSupportedLangs() {
    return [..._supportedLangs];
  }

  /**
   * Get a bound translation function for a specific namespace.
   * Useful in plugins that only need their own namespace.
   */
  function getT(ns) {
    return function (key, opts2) {
      return t(key, Object.assign({ ns: ns }, opts2 || {}));
    };
  }

  /**
   * Check if a namespace is loaded for the current language.
   */
  function isNamespaceLoaded(ns) {
    return !!(_namespaces[ns] && _namespaces[ns][_currentLang]);
  }

  /**
   * Get all registered namespaces.
   */
  function getNamespaces() {
    return Object.keys(_namespaces);
  }

  /**
   * Get all keys for a namespace+language (useful for validation).
   */
  function getKeys(ns, lang) {
    lang = lang || _currentLang;
    if (!_namespaces[ns] || !_namespaces[ns][lang]) return [];
    return Object.keys(_namespaces[ns][lang]);
  }

  // ─── Public API ──────────────────────────────────────────────────────────
  return {
    t: t,
    configure: configure,
    setLanguage: setLanguage,
    getLanguage: getLanguage,
    getSupportedLangs: getSupportedLangs,
    registerNamespace: registerNamespace,
    registerNamespaceBulk: registerNamespaceBulk,
    loadNamespace: loadNamespace,
    loadNamespaceFull: loadNamespaceFull,
    loadPluginNamespace: loadPluginNamespace,
    loadPluginNamespaceFull: loadPluginNamespaceFull,
    getT: getT,
    isNamespaceLoaded: isNamespaceLoaded,
    getNamespaces: getNamespaces,
    getKeys: getKeys
  };
})();

// Make available globally for iframe plugins
if (typeof window !== 'undefined') {
  window.ProxmoxVExI18n = ProxmoxVExI18n;
}
