/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        ProxmoxVEx/native/pfsense/pfsense.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Pfsense JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
(async function () {
  // i18n setup: use the parent i18n system if available, otherwise fall back to
  // the original English labels. Translations are loaded from the native i18n path.
  let _parentI18n = null;
  try { _parentI18n = window.parent.ProxmoxVExI18n; } catch (e) { }
  function t(key) {
    if (_parentI18n) return _parentI18n.t(key, { ns: 'pfsense' });
    return key;
  }
  function tf(key) {
    let s = t(key);
    for (let i = 1; i < arguments.length; i++) {
      s = s.replace('%s', String(arguments[i])).replace('%d', String(arguments[i]));
    }
    return s;
  }
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.getAttribute('data-i18n');
      const translated = t(key);
      if (translated !== key) el.textContent = translated;
    });
  }

  if (_parentI18n) {
    await _parentI18n.loadPluginNamespaceFull('pfsense', '/api/native/pfsense/i18n');
  }
  applyI18n();
  document.title = t('title') + ' - ProxmoxVEx';

  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');
  const cache = {};

  function showPanel(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    panels.forEach(p => p.classList.toggle('active', p.id === name));
    const endpoint = document.querySelector('.tab.active').dataset.endpoint;
    const panelName = name;
    if (!cache[panelName]) {
      loadData(panelName, endpoint);
    }
  }

  function setStatus(name, text, isError) {
    const el = document.getElementById('status-' + name);
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  function setContent(name, obj) {
    document.getElementById('content-' + name).textContent = JSON.stringify(obj, null, 2);
  }

  function loadData(name, endpoint) {
    setStatus(name, t('loading'), false);
    fetch(endpoint)
      .then(resp => resp.json().then(data => ({ resp, data })))
      .then(({ resp, data }) => {
        cache[name] = data;
        if (!resp.ok || !data.ok) {
          setStatus(name, tf('error', data.error || resp.statusText), true);
        } else {
          setStatus(name, tf('loaded', endpoint), false);
        }
        setContent(name, data);
      })
      .catch(err => {
        setStatus(name, tf('request_failed', err.message), true);
        setContent(name, { ok: false, error: err.message });
      });
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => showPanel(tab.dataset.tab));
  });

  // Load initial tab.
  loadData('overview', '/api/pfsense/overview');
})();
