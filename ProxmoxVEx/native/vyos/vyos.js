/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        ProxmoxVEx/native/vyos/vyos.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Vyos JS source
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
    if (_parentI18n) return _parentI18n.t(key, { ns: 'vyos' });
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
    await _parentI18n.loadPluginNamespaceFull('vyos', '/api/native/vyos/i18n');
  }
  applyI18n();
  document.title = t('title') + ' - ProxmoxVEx';

  const endpoints = ['overview', 'interfaces', 'routes'];

  function showPanel(name) {
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.target === name);
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('active', p.id === name);
    });
  }

  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      showPanel(btn.dataset.target);
    });
  });

  async function loadEndpoint(name) {
    const statusEl = document.getElementById('status-' + name);
    const jsonEl = document.getElementById('json-' + name);
    statusEl.textContent = t('loading');
    try {
      const res = await fetch(name);
      const data = await res.json();
      jsonEl.textContent = JSON.stringify(data, null, 2);
      if (data.ok) {
        statusEl.textContent = tf('loaded_status', name, res.status);
        statusEl.classList.remove('error');
      } else {
        statusEl.textContent = tf('failed_to_load', name, data.error || t('unknown_error'));
        statusEl.classList.add('error');
      }
    } catch (err) {
      statusEl.textContent = tf('error_loading', name, err.message);
      statusEl.classList.add('error');
      jsonEl.textContent = '';
    }
  }

  endpoints.forEach(loadEndpoint);
})();
