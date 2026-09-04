/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        ProxmoxVEx/native/vmware_vcenter/vmware_vcenter.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Vmware Vcenter JS source
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
    if (_parentI18n) return _parentI18n.t(key, { ns: 'vmware_vcenter' });
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
    await _parentI18n.loadPluginNamespaceFull('vmware_vcenter', '/api/native/vmware_vcenter/i18n');
  }
  applyI18n();
  document.title = t('title') + ' - ProxmoxVEx';

  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');
  const cache = {};

  function showPanel(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    panels.forEach(p => p.classList.toggle('active', p.id === name));
    const active = document.querySelector('.tab.active');
    const endpoint = active ? active.dataset.endpoint : '';
    if (!cache[name]) {
      loadData(name, endpoint);
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
    // Read the response as text before trying JSON.parse.  An intermediate
    // proxy, CDN, or a missing-route HTML page can return a non-JSON body,
    // and calling response.json() directly on that produces the cryptic
    // "Unexpected token '<'" error.  Falling back to a synthetic {ok:false}
    // payload keeps the tab informative.
    fetch(endpoint, { credentials: 'same-origin' })
      .then(function (resp) {
        return resp.text().then(function (raw) {
          var data;
          try {
            data = raw ? JSON.parse(raw) : { ok: false, error: 'Empty response' };
          } catch (e) {
            data = {
              ok: false,
              error: 'Non-JSON response (HTTP ' + resp.status + ')' +
                (raw ? ': ' + raw.trim().slice(0, 120) : '')
            };
          }
          return { resp: resp, data: data };
        });
      })
      .then(function (result) {
        var resp = result.resp;
        var data = result.data;
        if (resp.ok && data && data.ok) {
          cache[name] = data;
          setStatus(name, tf('loaded', endpoint), false);
        } else {
          setStatus(name, tf('error', (data && data.error) || resp.statusText), true);
        }
        setContent(name, data);
      })
      .catch(function (err) {
        setStatus(name, tf('request_failed', err.message), true);
        setContent(name, { ok: false, error: err.message });
      });
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => showPanel(tab.dataset.tab));
  });

  // Load initial tab.
  loadData('overview', '/api/vmware_vcenter/overview');
})();
