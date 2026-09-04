/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        ProxmoxVEx/native/netapp_storage/ui.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Ui JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
(function () {
  const supported = (window.parent.ProxmoxVExSupportedLangs) || ['de', 'en', 'it', 'fr', 'es', 'pt', 'ko'];
  const lang = (() => {
    try {
      const p = window.parent.ProxmoxVExLanguage;
      if (p && supported.includes(p)) return p;
    } catch (e) { }
    const q = new URLSearchParams(location.search).get('lang') || '';
    const base = q.split(/[-_]/)[0].toLowerCase();
    if (supported.includes(base)) return base;
    return 'en';
  })();
  document.documentElement.lang = lang;
  window.t = (key) => (window.parent.ProxmoxVExT ? window.parent.ProxmoxVExT(key) : key);
})();
(function () {
  // Sync with the parent application theme. The parent sets its own
  // --color-* CSS variables on <html>, so we read those and map them to
  // this page's variable names. Falls back to the ?theme= query string
  // if the parent is unreachable (e.g. opened standalone).
  function applyParentTheme() {
    try {
      const parent = window.parent;
      if (!parent || parent === window) return false;
      const parentStyle = parent.getComputedStyle(parent.document.documentElement);
      const root = document.documentElement;
      const map = {
        '--bg': '--color-darker',
        '--card': '--color-card',
        '--border': '--color-border',
        '--hover': '--color-hover',
        '--primary': '--color-primary',
        '--accent': '--color-primaryHover',
        '--text': '--color-text',
        '--muted': '--color-textMuted',
        '--success': '--color-success',
        '--warning': '--color-warning',
        '--error': '--color-error',
        '--info': '--color-info'
      };
      let applied = 0;
      for (const [localKey, parentKey] of Object.entries(map)) {
        const value = parentStyle.getPropertyValue(parentKey).trim();
        if (value) { root.style.setProperty(localKey, value); applied++; }
      }
      return applied >= 4;
    } catch (e) { return false; }
  }

  function applyQueryTheme() {
    const theme = new URLSearchParams(location.search).get('theme') || 'modern-dark';
    document.documentElement.setAttribute('data-theme', theme);
  }

  // Listen for live theme changes broadcast by the parent dashboard.
  // snyk:ignore:Insufficient postMessage Validation
  // lgtm[js/missing-origin-check]
  window.addEventListener('message', function (e) {
    if (e.origin !== window.location.origin) return;
    if (e.data && e.data.type === 'theme') {
      if (!applyParentTheme()) applyQueryTheme();
    }
  });

  if (!applyParentTheme()) {
    applyQueryTheme();
  }
})();
// ─── i18n (v2.0 — namespace-aware) ───────────────────────────────────────
var _parentI18n = null;
try { _parentI18n = window.parent.ProxmoxVExI18n; } catch (e) { }

var _LANG = (function () {
  try { var p = window.parent.ProxmoxVExLanguage; if (p) return p; } catch (e) { }
  try { return localStorage.getItem('ProxmoxVEx-language') || 'en'; } catch (e) { return 'en'; }
})();

function t(key) {
  if (_parentI18n) {
    return _parentI18n.t(key, { ns: 'netapp_storage' });
  }
  return key;
}
function tf(key) {
  var s = t(key);
  for (var i = 1; i < arguments.length; i++) {
    s = s.replace('%s', arguments[i]).replace('%d', arguments[i]);
  }
  return s;
}
function captureI18nDefaults() {
  // Keep the original visible text as a fallback so the UI never shows raw
  // i18n keys (e.g. "btn_start_snapshot") when a translation is missing or
  // the namespace has not loaded yet.
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    if (!el.dataset.i18nDefault) el.dataset.i18nDefault = el.textContent;
  });
  document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
    if (!el.dataset.i18nHtmlDefault) el.dataset.i18nHtmlDefault = el.innerHTML;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
    if (!el.dataset.i18nPlaceholderDefault) el.dataset.i18nPlaceholderDefault = el.placeholder;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
    if (!el.dataset.i18nTitleDefault) el.dataset.i18nTitleDefault = el.title;
  });
}
function applyI18n() {
  document.documentElement.lang = _LANG;
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    var key = el.getAttribute('data-i18n');
    var translated = t(key);
    var fallback = el.dataset.i18nDefault || el.textContent || key;
    el.textContent = (translated === key) ? fallback : translated;
  });
  document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
    var key = el.getAttribute('data-i18n-html');
    var translated = t(key);
    var fallback = el.dataset.i18nHtmlDefault || el.innerHTML || key;
    el.innerHTML = (translated === key) ? fallback : translated;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
    var key = el.getAttribute('data-i18n-placeholder');
    var translated = t(key);
    var fallback = el.dataset.i18nPlaceholderDefault || el.placeholder || key;
    el.placeholder = (translated === key) ? fallback : translated;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
    var key = el.getAttribute('data-i18n-title');
    var translated = t(key);
    var fallback = el.dataset.i18nTitleDefault || el.title || key;
    el.title = (translated === key) ? fallback : translated;
  });
}

async function initNetApp() {
  captureI18nDefaults();
  if (_parentI18n) {
    await _parentI18n.loadPluginNamespaceFull('netapp_storage', '/api/native/netapp_storage/i18n');
    _parentI18n.setLanguage(_LANG);
  }
  applyI18n();
  loadSnapshots();
}
const API = '/api/netapp_storage';
let _mappingsCache = [];
let _allSnapshots = [];   // cached snapshot list (for pagination + restore)
let _snapPage = 0;
const _snapPageSize = 25;
var _snapSortCol = 'created_at';
var _snapSortDir = -1;
var _vsAllFiltered = [];
var _vsRowH = 46;
var _vsScrollAttached = false;
var _vsSelectedKeys = new Set();
let _selectedRestoreSnap = null;  // active snapshot in the restore form

// ── Toast ──────────────────────────────────────────────────────────────────
let _toastTimer;
function _toastHide() {
  var el = document.getElementById('toast');
  el.style.display = 'none';
  if (_uiDialogDepth === 0) {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }
}
function toast(msg, type, detail) {
  type = type || 'info';
  var el = document.getElementById('toast');
  el.className = 'toast ' + type;
  var isErr = type === 'error';
  var detailHtml = '';
  if (isErr && detail) {
    var detailId = 'toast_detail_' + Date.now();
    detailHtml = '<div style="margin-top:8px">'
      + '<button onclick="var d=document.getElementById(\'' + detailId + '\');d.style.display=d.style.display===\'none\'?\'block\':\'none\'" style="background:none;border:none;padding:0;font-size:11px;color:inherit;opacity:.7;cursor:pointer;text-decoration:underline">Show details</button>'
      + '<pre id="' + detailId + '" style="display:none;margin:6px 0 0;padding:6px 8px;background:rgba(0,0,0,.35);border-radius:4px;font-size:10px;font-family:var(--mono,monospace);white-space:pre-wrap;word-break:break-all;max-height:140px;overflow-y:auto">' + esc(String(detail)) + '</pre>'
      + '</div>';
  }
  el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">'
    + '<span>' + esc(msg) + detailHtml + '</span>'
    + '<button onclick="_toastHide()" style="background:none;border:none;padding:0;cursor:pointer;font-size:15px;line-height:1;opacity:.6;flex-shrink:0;margin-top:-1px">✕</button>'
    + '</div>';
  document.documentElement.style.overflow = 'visible';
  document.body.style.overflow = 'visible';
  el.style.display = 'block';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(_toastHide, isErr ? 12000 : 4500);
}

// ── API helpers ────────────────────────────────────────────────────────────
async function apiFetch(path, opts) {
  var r = await fetch(API + '/' + path, Object.assign({ credentials: 'include' }, opts || {}));
  if (!r.ok) {
    var e = await r.json().catch(function () { return {}; });
    var err = new Error(e.error || 'HTTP ' + r.status);
    err.data = e;
    var extras = Object.keys(e).filter(function (k) { return k !== 'error'; });
    err.detail = extras.length ? JSON.stringify(e, null, 2) : (e.error || null);
    throw err;
  }
  return r.json();
}
async function apiPost(path, body) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}
async function api(method, path, body) {
  if (method === 'POST') return apiPost(path, body);
  return apiFetch(path);
}

// confirm() and alert() are blocked in iframe context — use inline modals instead.
var _uiDialogDepth = 0;
function _uiOverlayShow(overlay) {
  if (_uiDialogDepth++ === 0) {
    document.documentElement.style.overflow = 'visible';
    document.body.style.overflow = 'visible';
  }
  document.body.appendChild(overlay);
}
function _uiOverlayHide(overlay) {
  document.body.removeChild(overlay);
  if (--_uiDialogDepth === 0) {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }
}
function uiConfirm(msg, okLabel, okClass) {
  return new Promise(function (resolve) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.45);z-index:9500;display:flex;align-items:center;justify-content:center';
    var box = document.createElement('div');
    box.style.cssText = 'background:var(--card);border:1px solid var(--border);border-radius:8px;padding:24px;min-width:280px;max-width:460px;word-break:break-word';
    box.innerHTML = '<div style="margin-bottom:16px;white-space:pre-line">' + esc(msg) + '</div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end">'
      + '<button class="_uc-cancel btn btn-ghost">Cancel</button>'
      + '<button class="_uc-ok btn ' + (okClass || 'btn-danger') + '">' + (okLabel || 'OK') + '</button></div>';
    overlay.appendChild(box);
    _uiOverlayShow(overlay);
    function done(v) { _uiOverlayHide(overlay); resolve(v); }
    box.querySelector('._uc-cancel').onclick = function () { done(false); };
    box.querySelector('._uc-ok').onclick = function () { done(true); };
    overlay.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') done(false); });
    setTimeout(function () { box.querySelector('._uc-ok').focus(); }, 50);
  });
}
function uiConfirmDanger(msg, confirmLabel) {
  return new Promise(function (resolve) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.45);z-index:9500;display:flex;align-items:center;justify-content:center';
    var box = document.createElement('div');
    box.style.cssText = 'background:var(--card);border:1px solid var(--border);border-radius:8px;padding:24px;min-width:300px;max-width:480px;word-break:break-word';
    var cbId = 'uiCd_' + Math.random().toString(36).slice(2);
    box.innerHTML = '<div style="margin-bottom:16px;white-space:pre-line">' + esc(msg) + '</div>'
      + '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:18px;color:var(--warning);text-transform:none;letter-spacing:0;font-weight:400">'
      + '<input type="checkbox" id="' + cbId + '" onchange="document.getElementById(\'' + cbId + 'ok\').disabled=!this.checked"> '
      + esc(confirmLabel || 'I understand this action is irreversible')
      + '</label>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end">'
      + '<button class="_ucd-no btn btn-ghost">No</button>'
      + '<button class="_ucd-yes btn btn-danger" id="' + cbId + 'ok" disabled>Yes</button></div>';
    overlay.appendChild(box);
    _uiOverlayShow(overlay);
    function done(v) { _uiOverlayHide(overlay); resolve(v); }
    box.querySelector('._ucd-no').onclick = function () { done(false); };
    box.querySelector('._ucd-yes').onclick = function () { done(true); };
    overlay.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') done(false); });
  });
}
function uiAlert(msg) {
  return new Promise(function (resolve) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.45);z-index:9500;display:flex;align-items:center;justify-content:center';
    var box = document.createElement('div');
    box.style.cssText = 'background:var(--card);border:1px solid var(--border);border-radius:8px;padding:24px;min-width:280px;max-width:460px;word-break:break-word';
    box.innerHTML = '<div style="margin-bottom:16px;white-space:pre-line">' + esc(msg) + '</div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end">'
      + '<button class="_ua-ok btn btn-primary">OK</button></div>';
    overlay.appendChild(box);
    _uiOverlayShow(overlay);
    function done() { _uiOverlayHide(overlay); resolve(); }
    box.querySelector('._ua-ok').onclick = done;
    overlay.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' || ev.key === 'Enter') done(); });
    setTimeout(function () { box.querySelector('._ua-ok').focus(); }, 50);
  });
}

// ── Focus trap + keyboard helpers ──────────────────────────────────────────
var _FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function trapFocus(el) {
  var nodes = Array.from(el.querySelectorAll(_FOCUSABLE)).filter(function (n) { return n.offsetParent !== null; });
  if (!nodes.length) return;
  nodes[0].focus();
  el.addEventListener('keydown', function handler(ev) {
    if (ev.key !== 'Tab') return;
    var visible = Array.from(el.querySelectorAll(_FOCUSABLE)).filter(function (n) { return n.offsetParent !== null; });
    if (!visible.length) return;
    var first = visible[0], last = visible[visible.length - 1];
    if (ev.shiftKey) {
      if (document.activeElement === first) { last.focus(); ev.preventDefault(); }
    } else {
      if (document.activeElement === last) { first.focus(); ev.preventDefault(); }
    }
  });
}

document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Escape') return;
  var order = [
    { id: 'logViewModal', fn: function () { hideJobLog(); } },
    { id: 'deleteConfirmModal', fn: function () { var b = document.querySelector('#deleteConfirmModal ._cancel-btn'); if (b) b.click(); } },
    { id: 'rwModal', fn: function () { closeRestoreWizard(); } },
    { id: 'cwModal', fn: function () { closeCloneWizard(); } },
    { id: 'addScheduleForm', fn: function () { hideForm('addScheduleForm'); } }
  ];
  for (var i = 0; i < order.length; i++) {
    var el = document.getElementById(order[i].id);
    if (el && el.style.display !== 'none') { order[i].fn(); break; }
  }
});

// ── Tabs ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.subtab').forEach(function (t) {
  t.addEventListener('click', function () {
    if (t.dataset.drTab) return; // DR plan sub-tabs handle themselves via drShowSubTab()
    document.querySelectorAll('.subtab').forEach(function (x) { if (!x.dataset.drTab) x.classList.remove('active'); });
    document.querySelectorAll('.tab-panel').forEach(function (x) { x.style.display = 'none'; });
    if (typeof drCloseAllModals === 'function') drCloseAllModals();
    t.classList.add('active');
    document.getElementById('tab-' + t.dataset.tab).style.display = 'block';
    var loaders = {
      snapshots: loadSnapshots,
      schedules: loadSchedules,
      restore: function () { loadRcVmList(); },
      storage: loadStorageUnified,
      jobs: loadAllJobs,
      settings: function () { loadEndpoints(); loadPveHosts(); loadSmtp(); },
      dr: drInit
    };
    if (loaders[t.dataset.tab]) loaders[t.dataset.tab]();
  });
});

function hideForm(id) { document.getElementById(id).style.display = 'none'; document.body.style.overflow = ''; }

// ═══════════════════════════ ENDPOINTS ════════════════════════════════════

function showAddEndpointForm() {
  ['ep_name', 'ep_host', 'ep_admin_pass', 'ep_pass'].forEach(function (id) { document.getElementById(id).value = ''; });
  document.getElementById('ep_admin_user').value = 'admin';
  document.getElementById('ep_user').value = 'ProxmoxVEx';
  document.getElementById('ep_ssl').checked = false;
  document.getElementById('ep_skip_nfs').checked = false;
  document.getElementById('addEpResult').textContent = '';
  document.getElementById('addEndpointForm').style.display = '';
  document.body.style.overflow = 'hidden';
}

var _endpointCache = {};

async function loadEndpoints() {
  try {
    var rows = await apiFetch('endpoints');
    var tbody = document.getElementById('endpointsBody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">' + t('empty_endpoints') + '</td></tr>';
      return;
    }
    _endpointCache = {};
    rows.forEach(function (ep) { _endpointCache[ep.id] = ep; });
    tbody.innerHTML = rows.map(function (ep) {
      return '<tr>' +
        '<td><strong>' + esc(ep.name) + '</strong></td>' +
        '<td>' + esc(ep.host) + '</td>' +
        '<td>' + esc(ep.username) + '</td>' +
        '<td>' + (ep.ssl_verify ? '<span class="badge badge-green">' + t('opt_ssl_yes_s') + '</span>' : '<span class="badge badge-orange">' + t('opt_ssl_no') + '</span>') + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="btn btn-ghost btn-sm" onclick="testEndpoint(\'' + ep.id + '\',\'' + esc(ep.name) + '\')">' + t('btn_test') + '</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="discoverOne(\'' + ep.id + '\')">' + t('btn_detect') + '</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="showEditEndpointForm(\'' + ep.id + '\')">' + t('act_edit') + '</button>' +
        '<button class="btn btn-danger btn-sm" onclick="deleteEndpoint(\'' + ep.id + '\',\'' + esc(ep.name) + '\')">' + t('act_delete') + '</button>' +
        '</div></td></tr>';
    }).join('');
  } catch (e) { toast(e.message, 'error'); }
}

async function addEndpoint() {
  var name = document.getElementById('ep_name').value.trim();
  var host = document.getElementById('ep_host').value.trim();
  var adminUser = document.getElementById('ep_admin_user').value.trim();
  var adminPass = document.getElementById('ep_admin_pass').value;
  var newUser = document.getElementById('ep_user').value.trim() || 'ProxmoxVEx';
  var newPass = document.getElementById('ep_pass').value;
  var role = document.getElementById('ep_role').value;
  var ssl_verify = document.getElementById('ep_ssl').checked;
  var skip_nfs = document.getElementById('ep_skip_nfs').checked;

  if (!name || !host || !adminPass || !newPass) {
    toast(t('msg_please_fill_in_all_required_fields'), 'error'); return;
  }

  var sp = document.getElementById('addEpSpinner');
  var res = document.getElementById('addEpResult');
  sp.style.display = '';
  res.textContent = '';

  try {
    var r = await apiPost('setup/add-ontap-system', {
      name, host,
      admin_user: adminUser, admin_password: adminPass,
      new_username: newUser, new_password: newPass,
      role, ssl_verify, skip_nfs
    });
    sp.style.display = 'none';
    document.getElementById('ep_admin_pass').value = '';  // clear admin password
    var steps = (r.steps || []).map(function (s) { return (s.ok ? '✅' : '⚠️') + ' ' + esc(s.msg); }).join('<br>');
    res.innerHTML = steps;
    toast(t('msg_system_registered') + esc(name), 'success');
    setTimeout(function () { hideForm('addEndpointForm'); }, 1200);
    loadEndpoints();
  } catch (e) {
    sp.style.display = 'none';
    res.innerHTML = '<span style="color:var(--danger)">❌ ' + esc(e.message) + '</span>';
    toast(e.message, 'error', e.detail);
  }
}

async function testEndpoint(id, name) {
  toast(tf('msg_testing', name));
  try {
    var d = await apiPost('endpoints/test', { id: id });
    if (d.success) toast('✓ ' + d.cluster_name + ' – ONTAP ' + d.ontap_version, 'success');
    else toast(d.error, 'error');
  } catch (e) { toast(e.message, 'error'); }
}

function showEditEndpointForm(id) {
  var ep = _endpointCache[id];
  if (!ep) { toast(t('msg_endpoint_not_found'), 'error'); return; }
  document.getElementById('edit_ep_id').value = ep.id;
  document.getElementById('edit_ep_name').value = ep.name || '';
  document.getElementById('edit_ep_host').value = ep.host || '';
  document.getElementById('edit_ep_user').value = ep.username || '';
  document.getElementById('edit_ep_pass').value = '';
  document.getElementById('edit_ep_ssl').checked = !!ep.ssl_verify;
  document.getElementById('edit_ep_skip_nfs').checked = !!ep.skip_nfs;
  document.getElementById('editEpResult').textContent = '';
  document.getElementById('editEndpointForm').style.display = '';
  document.body.style.overflow = 'hidden';
}

async function saveEditEndpoint() {
  var id = document.getElementById('edit_ep_id').value;
  var name = document.getElementById('edit_ep_name').value.trim();
  var host = document.getElementById('edit_ep_host').value.trim();
  var username = document.getElementById('edit_ep_user').value.trim();
  var password = document.getElementById('edit_ep_pass').value;
  var ssl_verify = document.getElementById('edit_ep_ssl').checked;
  var skip_nfs = document.getElementById('edit_ep_skip_nfs').checked;
  if (!name || !host || !username) { toast(t('msg_name_host_and_username_are_required'), 'error'); return; }
  var sp = document.getElementById('editEpSpinner');
  var res = document.getElementById('editEpResult');
  sp.style.display = '';
  res.textContent = '';
  try {
    await apiPost('endpoints/update', { id, name, host, username, password, ssl_verify, skip_nfs });
    sp.style.display = 'none';
    toast(t('msg_ep_saved'), 'success');
    hideForm('editEndpointForm');
    loadEndpoints();
  } catch (e) {
    sp.style.display = 'none';
    res.innerHTML = '<span style="color:var(--danger)">❌ ' + esc(e.message) + '</span>';
    toast(e.message, 'error', e.detail);
  }
}

async function discoverOne(id) {
  document.querySelectorAll('.subtab').forEach(function (x) { x.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function (x) { x.style.display = 'none'; });
  document.querySelector('[data-tab="storage"]').classList.add('active');
  document.getElementById('tab-storage').style.display = 'block';
  runDiscovery(id);
}

async function deleteEndpoint(id, name) {
  if (!await uiConfirm(tf('confirm_delete_ep', name))) return;
  try {
    await apiPost('endpoints/delete', { id: id });
    toast(t('msg_ep_deleted'), 'success');
    loadEndpoints();
  } catch (e) {
    var d = e.data || {};
    if (d.has_datastores) {
      var msg = esc(e.message) + '\n\n⚠️ Force-delete will also remove ' + d.datastore_count + ' managed datastore record(s) from the plugin database (ONTAP data is NOT deleted).';
      if (!await uiConfirm(msg, 'Force Delete', 'btn-danger')) return;
      try {
        await apiPost('endpoints/delete', { id: id, force: true });
        toast(t('msg_ep_deleted'), 'success');
        loadEndpoints(); loadStorageUnified();
      } catch (e2) { toast(e2.message, 'error'); }
    } else {
      toast(e.message, 'error', e.detail);
    }
  }
}

// ═══════════════════════════ PVE-HOSTS ════════════════════════════════════

function showAddPveHostForm() {
  ['pve_name', 'pve_host', 'pve_pass', 'pve_nfs_ip'].forEach(function (id) { document.getElementById(id).value = ''; });
  document.getElementById('pve_port').value = '8006';
  document.getElementById('pve_user').value = 'root@pam';
  document.getElementById('pve_ssl').value = '0';
  document.getElementById('addPveHostForm').style.display = '';
  document.body.style.overflow = 'hidden';
}

async function loadPveHosts() {
  try {
    var rows = await apiFetch('pve-hosts');
    var tbody = document.getElementById('pveHostsBody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">' + t('empty_pve') + '</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (h) {
      return '<tr>' +
        '<td><strong>' + esc(h.name) + '</strong></td>' +
        '<td>' + esc(h.host) + '</td>' +
        '<td>' + esc(h.port) + '</td>' +
        '<td>' + esc(h.username) + '</td>' +
        '<td>' + (h.nfs_ip ? esc(h.nfs_ip) : '<span style="color:var(--muted)">—</span>') + '</td>' +
        '<td>' + (h.ssl_verify ? '<span class="badge badge-green">' + t('opt_ssl_yes_s') + '</span>' : '<span class="badge badge-orange">' + t('opt_ssl_no') + '</span>') + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="btn btn-ghost btn-sm" onclick="testPveHost(\'' + h.id + '\',\'' + esc(h.name) + '\')">' + t('btn_test') + '</button>' +
        '<button class="btn btn-danger btn-sm" onclick="deletePveHost(\'' + h.id + '\',\'' + esc(h.name) + '\')">' + t('act_delete') + '</button>' +
        '</div></td></tr>';
    }).join('');
  } catch (e) { toast(e.message, 'error'); }
}

async function addPveHost() {
  var name = document.getElementById('pve_name').value.trim();
  var host = document.getElementById('pve_host').value.trim();
  var port = parseInt(document.getElementById('pve_port').value) || 8006;
  var username = document.getElementById('pve_user').value.trim();
  var password = document.getElementById('pve_pass').value;
  var ssl_verify = document.getElementById('pve_ssl').value === '1';
  var nfs_ip = document.getElementById('pve_nfs_ip').value.trim();
  if (!name || !host || !username || !password) { toast(t('msg_all_fields'), 'error'); return; }
  try {
    await apiPost('pve-hosts/add', { name, host, port, username, password, ssl_verify, nfs_ip });
    toast(t('msg_pve_saved'), 'success');
    hideForm('addPveHostForm');
    loadPveHosts();
  } catch (e) { toast(e.message, 'error'); }
}

async function testPveHost(id, name) {
  toast(tf('msg_testing', name));
  try {
    var d = await apiPost('pve-hosts/test', { id: id });
    if (d.success) toast(t('msg_pve') + d.pve_version + ' – Nodes: ' + d.nodes.join(', '), 'success');
    else toast(d.error, 'error');
  } catch (e) { toast(e.message, 'error'); }
}

async function deletePveHost(id, name) {
  if (!await uiConfirm(tf('confirm_delete_pve', name))) return;
  try {
    await apiPost('pve-hosts/delete', { id: id });
    toast(t('msg_pve_deleted'), 'success');
    loadPveHosts();
  } catch (e) { toast(e.message, 'error'); }
}

// ═══════════════════════════ DISCOVERY ════════════════════════════════════

async function loadMappings() {
  try {
    var rows = await apiFetch('volume-mappings');
    _mappingsCache = rows;
    var tbody = document.getElementById('mappingsBody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">' + t('empty_mappings') + '</td></tr>';
      return;
    }
    // Track which pve_storage_ids are already in the provisioning tab
    var provIds = {};
    try {
      var provData = await apiFetch('provisioning/datastores');
      (provData.datastores || []).forEach(function (d) { provIds[d.pve_storage_id] = true; });
    } catch (e) { }
    var volumeMap = {};
    rows.forEach(function (m) {
      var key = m.volume_uuid || m.volume_name;
      if (!volumeMap[key]) { volumeMap[key] = Object.assign({}, m, { _hosts: [] }); }
      volumeMap[key]._hosts.push(m.pve_host_name || m.pve_cluster_id);
    });
    tbody.innerHTML = Object.values(volumeMap).map(function (m) {
      var hostsHtml = m._hosts.map(function (h) {
        return '<span class="badge badge-blue" style="font-size:10px">' + esc(h) + '</span>';
      }).join(' ');
      var isSan = m.storage_protocol && m.storage_protocol !== 'nfs';
      var proto = (m.storage_protocol || 'nfs').toLowerCase();
      var badgeBg = { nfs: '#0ea5e9', iscsi: '#f97316', nvme: '#a855f7' }[proto] || 'var(--info)';
      var asaLabel = (m.san_optimized && isSan) ? ' ASA' : '';
      var protoBadge = '<span class="badge" style="background:' + badgeBg + ';color:#fff;font-size:10px">' + proto.toUpperCase() + asaLabel + '</span> ';
      // col5: protocol badge + junction path (NFS) or VG name (SAN)
      var col5 = isSan
        ? protoBadge + '<span style="color:var(--muted);font-size:11px">VG: ' + esc(m.lvm_vg_name || '') + '</span>'
        : protoBadge + '<code>' + esc(m.junction_path || '') + '</code>';
      // col6: NFS server IP (NFS) or snapmanifest status (SAN)
      var snapBtn = '';
      if (isSan) {
        if (m.snapinfo_initialized) {
          snapBtn = '<button class="btn btn-sm" style="font-size:11px;padding:2px 8px;background:var(--success);color:#000;border:none;cursor:pointer" '
            + 'onclick="snapmanifestCheck(\'' + esc(m.id) + '\',\'' + esc(m.pve_storage_id) + '\')" title="Re-check snapmanifest LV (click to verify)">'
            + 'snapmanifest ✓ ready</button>';
        } else {
          snapBtn = '<button class="btn btn-sm" style="font-size:11px;padding:2px 8px;background:var(--warning);color:#000" '
            + 'onclick="snapmanifestInit(\'' + esc(m.id) + '\',\'' + esc(m.pve_storage_id) + '\')" title="Initialize snapmanifest LV">'
            + 'Setup snapmanifest</button>';
        }
      }
      var col6 = isSan ? snapBtn : esc(m.nfs_export_ip || '');
      var delBtn = '<button class="btn btn-sm" style="font-size:11px;padding:2px 6px;background:none;border:1px solid var(--error);color:var(--error);cursor:pointer" '
        + 'onclick="deleteMapping(\'' + esc(m.id) + '\',\'' + esc(m.pve_storage_id) + '\')" title="Remove mapping from database">✕</button>';
      var importBtn = '';
      if (!provIds[m.pve_storage_id]) {
        importBtn = ' <button class="btn btn-sm" style="font-size:11px;padding:2px 6px;background:none;border:1px solid var(--info);color:var(--info);cursor:pointer" '
          + 'onclick="importToProvisioning(\'' + esc(m.id) + '\',\'' + esc(m.pve_storage_id) + '\')" title="Add to Provisioning tab">+ Prov</button>';
      }
      return '<tr>' +
        '<td>' + hostsHtml + '</td>' +
        '<td><strong>' + esc(m.pve_storage_id) + '</strong></td>' +
        '<td><code style="font-size:11px">' + esc(m.svm_name) + '</code></td>' +
        '<td><code style="font-size:11px">' + esc(m.volume_name) + '</code></td>' +
        '<td>' + col5 + '</td>' +
        '<td>' + col6 + '</td>' +
        '<td><code style="font-size:11px">' + esc(m.endpoint_name || '') + '</code></td>' +
        '<td style="color:var(--muted)">' + fmtDateRel(m.discovered_at) + '</td>' +
        '<td>' + delBtn + importBtn + '</td></tr>';
    }).join('');
  } catch (e) { toast(e.message, 'error'); }
}

async function snapmanifestCheck(mappingId, storageId) {
  try {
    var r = await apiPost('san/snapmanifest-check', { mapping_id: mappingId });
    if (!r.success) { toast(r.error || 'Check failed', 'error'); return; }
    if (r.exists) {
      toast(t('msg_snapmanifest_lv') + r.lv + ' OK', 'success');
    } else {
      toast(t('msg_snapmanifest_lv_1') + r.lv + ' not found — resetting status', 'warning');
      loadStorageUnified();
    }
  } catch (e) { toast(e.message, 'error', e.detail); }
}

async function snapmanifestInit(mappingId, storageId) {
  if (!await uiConfirm(t('msg_initialize_netapp_snapmanifest_lv_for') + storageId + '"?\n\nCreates a small 64 MB ext4 LV on the VG to store VM configs inside every ONTAP snapshot.', 'Initialize', 'btn-primary')) return;
  try {
    var r = await apiPost('san/snapmanifest-init', { mapping_id: mappingId });
    if (r.success) {
      toast(r.message || 'snapmanifest initialized', 'success');
      loadStorageUnified();
    } else {
      toast(r.error || 'Error', 'error');
    }
  } catch (e) { toast(e.message, 'error', e.detail); }
}

async function deleteMapping(mappingId, storageId) {
  if (!await uiConfirm(t('msg_remove_mapping') + storageId + '" from the database?\n\nThis only removes the discovery record — no data on ONTAP or Proxmox is changed.')) return;
  try {
    var r = await apiPost('volume-mappings/delete', { mapping_id: mappingId });
    if (r.success) {
      toast(t('msg_mapping') + storageId + '" removed', 'success');
      loadStorageUnified();
    } else {
      toast(r.error || 'Delete failed', 'error');
    }
  } catch (e) { toast(e.message, 'error', e.detail); }
}

async function importToProvisioning(mappingId, storageId) {
  if (!await uiConfirm(t('msg_add') + storageId + '" to the managed datastores?\n\n' +
    'The plugin will register this volume as managed. ' +
    'It will then appear as "managed" and can be extended or removed.',
    'Add to managed', 'btn-primary')) return;
  try {
    var r = await apiPost('provisioning/datastores/import', { mapping_id: mappingId });
    if (r.success) {
      toast('"' + r.name + '" is now managed', 'success');
      loadStorageUnified();
    } else {
      toast(r.error || 'Import failed', 'error');
    }
  } catch (e) { toast(e.message, 'error', e.detail); }
}

async function runDiscovery(endpointId) {
  var sp = document.getElementById('discoverSpinner');
  if (sp) sp.style.display = 'inline-block';
  try {
    var body = endpointId ? { endpoint_id: endpointId } : {};
    var d = await apiPost('discover', body);
    if (d.count > 0) {
      var seen = {};
      (d.mappings || []).forEach(function (m) { seen[m.volume_uuid || m.volume_name || m.id] = 1; });
      var dispCount = Object.keys(seen).length || d.count;
      toast(tf('msg_discovery_found', dispCount), 'success');
    } else {
      toast(t('msg_discovery_none'), 'info');
    }
    loadStorageUnified();
  } catch (e) { toast(e.message, 'error'); }
  finally { if (sp) sp.style.display = 'none'; }
}

// ═══════════════════════════ SNAPSHOTS ════════════════════════════════════

async function populateMappingSelect(selId) {
  if (!_mappingsCache.length) {
    try { _mappingsCache = await apiFetch('volume-mappings'); } catch (e) { }
  }
  var seen = new Set();
  var unique = _mappingsCache.filter(function (m) {
    var key = m.volume_uuid || m.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  document.getElementById(selId).innerHTML = unique.map(function (m) {
    return '<option value="' + m.id + '">' + esc(m.pve_storage_id) + ' → ' + esc(m.volume_name) + ' (' + esc(m.svm_name) + ')</option>';
  }).join('');
}

async function showCreateSnapshotForm() {
  document.getElementById('createSnapshotForm').style.display = '';
  document.body.style.overflow = 'hidden';
  document.getElementById('snap_sm_section').style.display = 'none';
  await populateMappingSelect('snap_mapping');
  updateSnapMapping();
}

function _smInfoHtml(data) {
  var src = esc((data.source_svm || '') + ':' + (data.source_volume || ''));
  var dst = esc((data.dest_cluster || data.dest_svm || '') + (data.dest_volume ? ':' + data.dest_volume : ''));
  var pt = data.policy_type ? ' <span style="opacity:.6">(' + esc(data.policy_type) + ')</span>' : '';
  var ok = data.healthy !== false;
  var col = ok ? '#22c55e' : '#f59e0b';
  return '<span style="background:' + col + '22;color:' + col + ';border:1px solid ' + col + '44;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;letter-spacing:.03em;margin-right:8px">SnapMirror®</span>'
    + src + ' → ' + dst + pt;
}

async function updateSnapMapping() {
  var selId = document.getElementById('snap_mapping').value;
  await loadVmsForMapping(selId);

  // Update blast-radius panel
  var blastDiv = document.getElementById('snap_blast_radius');
  if (selId) {
    var vmSel = document.getElementById('snap_vmids_select');
    var vms = Array.from(vmSel.options).filter(function (o) { return !o.disabled; });
    if (vms.length) {
      document.getElementById('snap_blast_count').textContent = vms.length;
      document.getElementById('snap_blast_list').innerHTML = vms.map(function (o) {
        return '<span style="display:inline-flex;align-items:center;padding:2px 8px;background:rgba(217,83,79,.12);border:1px solid rgba(217,83,79,.3);border-radius:4px;font-family:monospace;font-size:12px">' + esc(o.text) + '</span>';
      }).join(' ');
      blastDiv.style.display = '';
    } else {
      blastDiv.style.display = 'none';
    }
  } else {
    blastDiv.style.display = 'none';
  }

  var smSection = document.getElementById('snap_sm_section');
  if (!selId) { smSection.style.display = 'none'; return; }
  try {
    var data = await apiFetch('snapmirror/policy-labels?mapping_id=' + encodeURIComponent(selId));
    if (data.has_relationship) {
      document.getElementById('snap_sm_info').innerHTML = _smInfoHtml(data);
      var labels = data.labels || [];
      var labelSel = document.getElementById('snap_label');
      labelSel.innerHTML = '<option value="">— no label —</option>' +
        labels.map(function (l) { return '<option value="' + esc(l) + '">' + esc(l) + '</option>'; }).join('');
      smSection.style.display = 'flex';
    } else {
      smSection.style.display = 'none';
    }
  } catch (e) {
    smSection.style.display = 'none';
  }
}

async function updateSchedMapping(mappingId) {
  await loadVmsForSchedule(mappingId);
  await updateSchedSMSection(mappingId, '');
}

async function updateSchedSMSection(mappingId, preselectedLabel) {
  _schedWizHasSM = false;
  schedWizUpdateSMPill();
  if (!mappingId) return;
  try {
    var data = await apiFetch('snapmirror/policy-labels?mapping_id=' + encodeURIComponent(mappingId));
    if (data.has_relationship) {
      _schedWizHasSM = true;
      document.getElementById('sched_sm_info').innerHTML = _smInfoHtml(data);
      var labels = data.labels || [];
      var labelSel = document.getElementById('sched_label');
      labelSel.innerHTML = '<option value="">— no label —</option>' +
        labels.map(function (l) {
          return '<option value="' + esc(l) + '"' + (l === preselectedLabel ? ' selected' : '') + '>' + esc(l) + '</option>';
        }).join('');
      if (preselectedLabel && labels.indexOf(preselectedLabel) === -1 && preselectedLabel !== '') {
        labelSel.innerHTML += '<option value="' + esc(preselectedLabel) + '" selected>' + esc(preselectedLabel) + '</option>';
      }
    } else {
      document.getElementById('sched_label').innerHTML = '<option value="">— no label —</option>';
    }
  } catch (e) { /* silent */ }
  schedWizUpdateSMPill();
}

async function loadVmsForMapping(mappingId) {
  var sel = document.getElementById('snap_vmids_select');
  if (!mappingId) { sel.innerHTML = '<option disabled>' + t('hint_mapping_first') + '</option>'; return; }
  sel.innerHTML = '<option disabled>' + t('hint_loading') + '</option>';
  try {
    var d = await apiFetch('snapshots/vms-for-mapping?mapping_id=' + encodeURIComponent(mappingId));
    var vms = d.vms || [];
    if (!vms.length) { sel.innerHTML = '<option disabled>' + t('hint_no_vms') + '</option>'; return; }
    sel.innerHTML = vms.map(function (v) {
      return '<option value="' + v.vmid + '" selected>' + v.vmid + ' – ' + esc(v.name || '') + (v.node ? ' (' + esc(v.node) + ')' : '') + '</option>';
    }).join('');
  } catch (e) {
    sel.innerHTML = '<option disabled>' + esc(e.message) + '</option>';
  }
}

function selectAllVms() {
  var sel = document.getElementById('snap_vmids_select');
  for (var i = 0; i < sel.options.length; i++) sel.options[i].selected = true;
}

async function loadSnapshots() {
  try {
    _allSnapshots = await apiFetch('snapshots');
    _snapPage = 0;
    // Populate datastore filter
    var dsSel = document.getElementById('snap_filter_datastore');
    var dss = {};
    _allSnapshots.forEach(function (s) { var v = s.pve_storage_id || s.volume_name; if (v) dss[v] = 1; });
    var curDs = dsSel.value;
    dsSel.innerHTML = '<option value="">' + t('opt_all_datastores') + '</option>' +
      Object.keys(dss).sort().map(function (v) { return '<option value="' + esc(v) + '"' + (v === curDs ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
    renderSnapshots();
  } catch (e) { toast(e.message, 'error'); }
}

function filterSnapshots() { renderSnapshots(); }
function snapSort(col) {
  if (_snapSortCol === col) { _snapSortDir = -_snapSortDir; }
  else { _snapSortCol = col; _snapSortDir = col === 'created_at' ? -1 : 1; }
  renderSnapshots();
}

function _snapRowHtml(s) {
  var isNative = s.source === 'ontap_native';
  var vmsHtml = isNative
    ? '<span style="color:var(--muted)">–</span>'
    : '<div class="vm-bubble-box">' + (s.vmids || []).map(function (id) {
      return vmBadge(id, (s.vm_names || {})[String(id)]);
    }).join('') + '</div>';
  var actions = '';
  if (s.status === 'done') {
    actions += '<button class="btn btn-ghost btn-sm" onclick="prepareRestore(\'' + s.id + '\')">' + t('act_restore') + '</button>';
    if (!isNative) actions += '<button class="btn btn-ghost btn-sm" onclick="prepareClone(\'' + s.id + '\')">' + t('act_clone') + '</button>';
  }
  var delCall = isNative
    ? 'deleteSnapshotNative(\'' + esc(s.ontap_snap_uuid) + '\',\'' + esc(s.mapping_id) + '\',\'' + esc(s.snap_name) + '\')'
    : 'deleteSnapshot(\'' + s.id + '\',\'' + esc(s.snap_name) + '\')';
  actions += '<button class="btn btn-danger btn-sm" onclick="' + delCall + '">' + t('act_delete') + '</button>';
  var sourceBadge = isNative
    ? '<span class="corp-badge corp-badge-stopped">' + t('badge_ontap') + '</span>'
    : (s.schedule_id ? '<span class="corp-badge corp-badge-ha">' + t('badge_schedule') + '</span>' : '<span style="color:var(--muted)">–</span>');
  var cbData = isNative
    ? 'data-native="1" data-uuid="' + esc(s.ontap_snap_uuid || '') + '" data-mid="' + esc(s.mapping_id || '') + '" data-name="' + esc(s.snap_name || '') + '"'
    : 'data-native="0" data-id="' + esc(s.id || '') + '"';
  var snapKey = isNative
    ? ('n_' + (s.ontap_snap_uuid || '') + '_' + (s.mapping_id || ''))
    : ('p_' + String(s.id || ''));
  var isSel = _vsSelectedKeys.has(snapKey);
  return '<tr data-snap-key="' + snapKey + '"' + (isNative ? ' style="opacity:.85"' : '') + '>'
    + '<td style="padding:4px 8px"><input type="checkbox" class="snap-cb"' + (isSel ? ' checked' : '')
    + ' onchange="snapCbChange(\'' + snapKey + '\',this)" ' + cbData + '></td>'
    + '<td data-label="Name"><code>' + esc(s.snap_name) + '</code></td>'
    + '<td data-label="Datastore"><strong>' + esc(s.pve_storage_id || s.volume_name || '') + '</strong>'
    + (s.pve_storage_id && s.volume_name && s.volume_name !== s.pve_storage_id ? '<br><code style="font-size:11px;opacity:.7">' + esc(s.volume_name) + '</code>' : '')
    + (s.svm_name || s.endpoint_name ? '<br><span style="font-size:.75rem;color:var(--muted);font-family:monospace">' + esc(s.svm_name || '') + (s.svm_name && s.endpoint_name ? ' · ' : '') + esc(s.endpoint_name || '') + '</span>' : '')
    + '</td>'
    + '<td data-label="VMs" style="max-width:200px;word-break:break-word">' + vmsHtml + '</td>'
    + '<td data-label="Consistency">' + (isNative ? '<span style="color:var(--muted)">–</span>' : esc(s.consistency)) + '</td>'
    + '<td data-label="Label">' + (s.label ? '<span class="corp-badge corp-badge-ha">' + esc(s.label) + '</span>' : '<span style="color:var(--muted)">–</span>') + '</td>'
    + '<td data-label="Status">' + statusBadge(s.status) + '</td>'
    + '<td data-label="Source">' + sourceBadge + '</td>'
    + '<td data-label="Created" style="color:var(--muted)">' + fmtDateRel(s.created_at) + '</td>'
    + '<td data-label="Actions"><div class="row-actions">' + actions + '</div></td></tr>';
}

var _VS_THRESHOLD = 80;
var _vsScrollTid;

function _vsAttachScroll() {
  if (_vsScrollAttached) return;
  var sc = document.getElementById('snapTableScroller');
  if (!sc) return;
  sc.addEventListener('scroll', function () {
    clearTimeout(_vsScrollTid);
    _vsScrollTid = setTimeout(_vsRenderRows, 20);
  });
  _vsScrollAttached = true;
}

function _vsRenderRows() {
  var sc = document.getElementById('snapTableScroller');
  var tbody = document.getElementById('snapshotsBody');
  if (!tbody) return;
  var total = _vsAllFiltered.length;
  if (!total) return;
  var BUFFER = 10;
  var first, last;
  if (total <= _VS_THRESHOLD || !sc) {
    first = 0; last = total - 1;
  } else {
    var rowH = _vsRowH;
    var scrollTop = sc.scrollTop;
    var viewH = sc.clientHeight || 500;
    first = Math.max(0, Math.floor(scrollTop / rowH) - BUFFER);
    last = Math.min(total - 1, Math.ceil((scrollTop + viewH) / rowH) + BUFFER);
  }
  var topPad = first * _vsRowH;
  var bottomPad = Math.max(0, (total - last - 1) * _vsRowH);
  var html = '';
  if (topPad > 0) html += '<tr style="height:' + topPad + 'px"><td colspan="10" style="padding:0;border:none"></td></tr>';
  for (var i = first; i <= last; i++) html += _snapRowHtml(_vsAllFiltered[i]);
  if (bottomPad > 0) html += '<tr style="height:' + bottomPad + 'px"><td colspan="10" style="padding:0;border:none"></td></tr>';
  tbody.innerHTML = html;
  if (total > _VS_THRESHOLD) {
    var sample = tbody.querySelector('tr[data-snap-key]');
    if (sample && sample.offsetHeight > 10) _vsRowH = sample.offsetHeight;
  }
  _vsUpdateSelectAll();
}

function _vsUpdateSelectAll() {
  var sa = document.getElementById('snap_select_all');
  if (!sa) return;
  var total = _vsAllFiltered.length;
  var sel = _vsSelectedKeys.size;
  sa.checked = sel > 0 && sel >= total;
  sa.indeterminate = sel > 0 && sel < total;
}

function renderSnapshots() {
  var text = (document.getElementById('snap_filter_text').value || '').toLowerCase();
  var source = document.getElementById('snap_filter_source').value;
  var ds = document.getElementById('snap_filter_datastore').value;

  var filtered = _allSnapshots.filter(function (s) {
    if (source && s.source !== source) return false;
    var sDs = s.pve_storage_id || s.volume_name || '';
    if (ds && sDs !== ds) return false;
    if (text && s.snap_name.toLowerCase().indexOf(text) < 0 &&
      sDs.toLowerCase().indexOf(text) < 0 &&
      (s.label || '').toLowerCase().indexOf(text) < 0 &&
      !Object.values(s.vm_names || {}).some(function (n) { return (n || '').toLowerCase().indexOf(text) >= 0; })) return false;
    return true;
  });

  filtered.sort(function (a, b) {
    if (_snapSortCol === 'created_at') {
      var ta = a.created_at ? Date.parse(a.created_at) : 0;
      var tb = b.created_at ? Date.parse(b.created_at) : 0;
      return (tb - ta) * -_snapSortDir;
    }
    var va = (a[_snapSortCol] == null ? '' : a[_snapSortCol]).toString().toLowerCase();
    var vb = (b[_snapSortCol] == null ? '' : b[_snapSortCol]).toString().toLowerCase();
    return va < vb ? -_snapSortDir : va > vb ? _snapSortDir : 0;
  });

  ['snap_name', 'pve_storage_id', 'consistency', 'label', 'status', 'source', 'created_at'].forEach(function (c) {
    var span = document.getElementById('ss_' + c);
    var th = span && span.parentElement;
    if (!span) return;
    if (c === _snapSortCol) {
      span.textContent = _snapSortDir === 1 ? '↑' : '↓';
      if (th) th.classList.add('sort-active');
    } else {
      span.textContent = '⇅';
      if (th) th.classList.remove('sort-active');
    }
  });

  _vsAllFiltered = filtered;
  _vsSelectedKeys.clear();
  document.getElementById('snap_bulk_bar').style.display = 'none';

  var total = filtered.length;
  var pi = document.getElementById('snap_page_info');
  if (pi) pi.textContent = total + ' snapshot' + (total !== 1 ? 's' : '');

  var tbody = document.getElementById('snapshotsBody');
  if (!total) {
    tbody.innerHTML = _emptyRow(10, _svgCamera, 'No snapshots yet', 'Start protecting your VMs with on-demand or scheduled NetApp Snapshots.', '+ Create Snapshot', 'showCreateSnapshotForm()');
    _vsUpdateSelectAll();
    renderTimeline(filtered);
    return;
  }

  _vsAttachScroll();
  _vsRenderRows();
  renderTimeline(filtered);
}

async function createSnapshot() {
  var mapping_id = document.getElementById('snap_mapping').value;
  var sel = document.getElementById('snap_vmids_select');
  var vmids = Array.from(sel.options).filter(function (o) { return !o.disabled && o.value; }).map(function (o) { return parseInt(o.value); }).filter(function (v) { return !isNaN(v); });
  var consistency = document.getElementById('snap_consistency').value;
  var labelEl = document.getElementById('snap_label');
  var label = labelEl ? labelEl.value : '';
  var name = document.getElementById('snap_name').value.trim();
  var smUpdEl = document.getElementById('snap_sm_update');
  var sm_update = smUpdEl ? smUpdEl.checked : false;
  if (!mapping_id) { toast(t('msg_snap_mapping_req'), 'error'); return; }
  if (!name) { toast(t('msg_snap_name_req'), 'error'); return; }
  try {
    await apiPost('snapshots/create', { mapping_id, vmids, consistency, label, name, snapmirror_update: sm_update });
    toast(t('msg_snap_started'), 'success');
    hideForm('createSnapshotForm');
    document.getElementById('snap_name').value = '';
    setTimeout(loadSnapshots, 2500);
  } catch (e) { toast(e.message, 'error'); }
}

function snapCbChange(key, cb) {
  if (cb.checked) _vsSelectedKeys.add(key);
  else _vsSelectedKeys.delete(key);
  snapUpdateBulkBar();
  _vsUpdateSelectAll();
}

function snapToggleAll(cb) {
  if (cb.checked) {
    _vsAllFiltered.forEach(function (s) {
      var isNative = s.source === 'ontap_native';
      var k = isNative
        ? ('n_' + (s.ontap_snap_uuid || '') + '_' + (s.mapping_id || ''))
        : ('p_' + String(s.id || ''));
      _vsSelectedKeys.add(k);
    });
  } else {
    _vsSelectedKeys.clear();
  }
  _vsRenderRows();
  snapUpdateBulkBar();
}

function snapUpdateBulkBar() {
  var n = _vsSelectedKeys.size;
  var bar = document.getElementById('snap_bulk_bar');
  if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
  var cnt = document.getElementById('snap_bulk_count');
  if (cnt) cnt.textContent = n + ' snapshot' + (n !== 1 ? 's' : '') + ' selected';
}

function snapClearSelection() {
  _vsSelectedKeys.clear();
  _vsRenderRows();
  snapUpdateBulkBar();
}

async function deleteSelectedSnapshots() {
  if (!_vsSelectedKeys.size) return;
  var toDelete = _vsAllFiltered.filter(function (s) {
    var isNative = s.source === 'ontap_native';
    var k = isNative
      ? ('n_' + (s.ontap_snap_uuid || '') + '_' + (s.mapping_id || ''))
      : ('p_' + String(s.id || ''));
    return _vsSelectedKeys.has(k);
  });
  if (!toDelete.length) return;
  if (!await uiConfirm(t('msg_delete') + toDelete.length + ' snapshot' + (toDelete.length !== 1 ? 's' : '') + '?')) return;
  var errors = 0;
  for (var i = 0; i < toDelete.length; i++) {
    var s = toDelete[i];
    try {
      if (s.source === 'ontap_native') {
        await apiPost('snapshots/delete', { native: true, ontap_snap_uuid: s.ontap_snap_uuid, mapping_id: s.mapping_id, snap_name: s.snap_name });
      } else {
        await apiPost('snapshots/delete', { id: s.id });
      }
    } catch (e) { errors++; }
  }
  if (errors) toast(errors + ' deletion(s) failed', 'error');
  else toast(toDelete.length + ' snapshot' + (toDelete.length !== 1 ? 's' : '') + ' deleted', 'success');
  loadSnapshots();
}

async function deleteSnapshot(id, name) {
  showDeleteConfirm(id, name, false, null, null);
}

async function deleteSnapshotNative(ontap_snap_uuid, mapping_id, name) {
  showDeleteConfirm(null, name, true, ontap_snap_uuid, mapping_id);
}

// ── Danger Modals: Restore Confirm ────────────────────────────────────────

var _restoreConfirmData = null;
var _currentLogJobId = null;

// ══════════════════════════════════════════════════════════════════════════
// RESTORE & CLONE — VM-centric list + wizard
// ══════════════════════════════════════════════════════════════════════════

var _rcVms = [];
var _rcSearch = '';
var _rcSortCol = 'lastSnap';
var _rcSortDir = -1;
var _rcSource = 'primary';
var _rcDrRelId = '';
var _rcDrMappingId = '';

function loadRcVmList() {
  apiFetch('snapshots').then(function (snaps) {
    _allSnapshots = snaps;
    renderRcVmList();
  }).catch(function (e) { toast(e.message, 'error'); });
}

function renderRcVmList() {
  var done = _allSnapshots.filter(function (s) { return s.status === 'done'; });
  var vmMap = {};
  done.forEach(function (s) {
    var vmids = s.vmids || [];
    var vmNames = s.vm_names || {};
    vmids.forEach(function (vid) {
      var key = String(vid);
      if (!vmMap[key]) {
        vmMap[key] = {
          vmid: vid, name: vmNames[key] || '',
          mappingId: s.mapping_id, relId: '', isDR: false,
          dsName: s.pve_storage_id || s.volume_name || s.mapping_id,
          protocol: _snapProtoLabel(s), isSan: _snapIsSan(s),
          sanOpt: !!s.san_optimized, pveClusterId: s.pve_cluster_id || '',
          snapCount: 0, lastSnap: null, lastSnapId: null,
        };
      }
      vmMap[key].snapCount++;
      if (!vmMap[key].lastSnap || (s.created_at || '') > vmMap[key].lastSnap) {
        vmMap[key].lastSnap = s.created_at;
        vmMap[key].lastSnapId = s.id;
        if (vmNames[key]) vmMap[key].name = vmNames[key];
      }
    });
  });
  _rcVms = Object.values(vmMap);
  _renderRcRows();
}

function rcColSort(col) {
  if (_rcSortCol === col) { _rcSortDir = -_rcSortDir; }
  else { _rcSortCol = col; _rcSortDir = col === 'lastSnap' ? -1 : 1; }
  _renderRcRows();
}

function _rcSorted(rows) {
  var col = _rcSortCol, dir = _rcSortDir;
  return rows.slice().sort(function (a, b) {
    var av, bv;
    if (col === 'lastSnap') { av = a.lastSnap || ''; bv = b.lastSnap || ''; return dir * av.localeCompare(bv); }
    if (col === 'name') {
      av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase();
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return dir * av.localeCompare(bv);
    }
    if (col === 'vmid') return dir * (a.vmid - b.vmid);
    if (col === 'count') return dir * (a.snapCount - b.snapCount);
    if (col === 'dsName') { av = (a.dsName || '').toLowerCase(); bv = (b.dsName || '').toLowerCase(); return dir * av.localeCompare(bv); }
    if (col === 'proto') { av = (a.protocol || '').toLowerCase(); bv = (b.protocol || '').toLowerCase(); return dir * av.localeCompare(bv); }
    return 0;
  });
}

function _renderRcRows() {
  var tbody = document.getElementById('rcVmTbody');
  if (!tbody) return;
  var q = (_rcSearch || '').toLowerCase();
  var rows = _rcVms.filter(function (v) {
    if (!q) return true;
    return String(v.vmid).indexOf(q) >= 0
      || (v.name || '').toLowerCase().indexOf(q) >= 0
      || (v.dsName || '').toLowerCase().indexOf(q) >= 0;
  });
  rows = _rcSorted(rows);
  if (!rows.length) {
    var svgVm = '<svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>';
    var msg = q ? 'No VMs match "' + esc(q) + '".' : (_rcSource === 'secondary' ? 'Select a SnapMirror relationship to load VMs.' : 'No snapshots found.');
    var sub = (!q && _rcSource === 'primary') ? 'Create a snapshot first — all VMs that have been snapshotted will appear here.' : '';
    tbody.innerHTML = _emptyRow(7, svgVm, msg, sub, (!q && _rcSource === 'primary') ? 'Go to Snapshots' : null, (!q && _rcSource === 'primary') ? "document.querySelector('[data-tab=\"snapshots\"]').click()" : null);
    return;
  }
  var _rcProtoBg = { NFS: '#0ea5e9', ISCSI: '#f97316', NVME: '#a855f7' };
  tbody.innerHTML = rows.map(function (v) {
    var cnt = v.snapCount === 1 ? '1 snapshot' : v.snapCount + ' snapshots';
    var drBadge = v.isDR ? '<span style="display:inline-block;font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(88,166,255,.15);color:#58A6FF;border:1px solid rgba(88,166,255,.3);margin-right:4px">DR</span>' : '';
    var protoBg = _rcProtoBg[v.protocol] || '#888';
    var protoBadge = '<span class="badge" style="background:' + protoBg + ';color:#fff;font-size:10px">' + esc(v.protocol) + '</span>';
    return '<tr>' +
      '<td><code style="font-size:12px">' + v.vmid + '</code></td>' +
      '<td>' + drBadge + (v.name ? esc(v.name) : '<span style="opacity:.4">—</span>') + '</td>' +
      '<td><code style="font-size:11px">' + esc(v.dsName) + '</code></td>' +
      '<td>' + protoBadge + '</td>' +
      '<td style="color:var(--muted)">' + cnt + '</td>' +
      '<td style="color:var(--muted)">' + fmtDateRel(v.lastSnap) + '</td>' +
      '<td><div class="row-actions">' +
      '<button class="btn btn-secondary btn-sm" onclick="openRestoreWizard(' + v.vmid + ')">' +
      '<svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:3px"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>Restore</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="openCloneWizard(' + v.vmid + ')">' +
      '<svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:3px"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>Clone</button>' +
      '</div></td>' +
      '</tr>';
  }).join('');
  ['vmid', 'name', 'dsName', 'proto', 'count', 'lastSnap'].forEach(function (c) {
    var span = document.getElementById('rcs_' + c);
    var th = span && span.parentElement;
    if (!span) return;
    if (c === _rcSortCol) {
      span.textContent = _rcSortDir === 1 ? '↑' : '↓';
      if (th) th.classList.add('sort-active');
    } else {
      span.textContent = '⇅';
      if (th) th.classList.remove('sort-active');
    }
  });
}

function rcFilterChanged() {
  _rcSearch = (document.getElementById('rcSearch') || {}).value || '';
  _renderRcRows();
}

function rcSetSource(src) {
  _rcSource = src;
  document.getElementById('rcSrcPrimary').className = src === 'primary' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  document.getElementById('rcSrcSecondary').className = src === 'secondary' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  document.getElementById('rcDrRow').style.display = src === 'secondary' ? 'flex' : 'none';
  if (src === 'primary') { loadRcVmList(); }
  else { _rcVms = []; _renderRcRows(); loadRcDrRelationships(); }
}

async function loadRcDrRelationships() {
  var sel = document.getElementById('rcDrRelSel');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select relationship —</option>';
  try {
    var rels = await apiFetch('snapmirror/relationships');
    var matched = rels.filter(function (r) { return r.dest_endpoint_id; });
    sel.innerHTML = '<option value="">— Select relationship —</option>' +
      matched.map(function (r) {
        return '<option value="' + r.id + '">' + esc(r.source_volume) + ' → ' + esc(r.dest_cluster_name || '?') + ':' + esc(r.dest_volume || '?') + '</option>';
      }).join('');
    if (!matched.length) toast(t('msg_no_snapmirror_relationships_with_secondary_endpoin'), 'error');
  } catch (e) { toast(e.message, 'error'); }
}

async function rcDrRelChanged() {
  var relId = (document.getElementById('rcDrRelSel') || {}).value || '';
  _rcDrRelId = relId; _rcVms = []; _renderRcRows();
  if (!relId) return;
  var tbody = document.getElementById('rcVmTbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="empty"><span class="spinner"></span></td></tr>';
  try {
    var rels = await apiFetch('snapmirror/relationships');
    var mappings = await apiFetch('volume-mappings');
    var rel = (rels || []).find(function (r) { return r.id === relId; });
    var mapping = rel ? (mappings || []).find(function (m) { return m.volume_uuid === rel.source_volume_uuid; }) : null;
    _rcDrMappingId = mapping ? mapping.id : '';
    var vmData = mapping ? await apiFetch('snapshots/vms-for-mapping?mapping_id=' + encodeURIComponent(mapping.id)) : { vms: [] };
    var snapsData = await apiFetch('snapmirror/secondary-snapshots?relationship_id=' + encodeURIComponent(relId));
    var snapCount = (snapsData.snapshots || []).length;
    var lastSnap = snapCount ? ((snapsData.snapshots || [])[0].created_at || null) : null;
    _rcVms = (vmData.vms || []).map(function (v) {
      return {
        vmid: v.vmid, name: v.name || '', relId: relId, isDR: true,
        mappingId: _rcDrMappingId, pveClusterId: mapping ? mapping.pve_cluster_id : '',
        dsName: rel ? (rel.source_volume || '') : '', protocol: 'NFS',
        isSan: false, sanOpt: false, snapCount: snapCount, lastSnap: lastSnap, lastSnapId: null
      };
    });
    _renderRcRows();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Restore Wizard ────────────────────────────────────────────────────────

var _rwState = { vmid: null, name: '', mappingId: '', relId: '', isDR: false, isSan: false, sanOpt: false, pveClusterId: '', snap: null, snapName: '', step: 1 };

function openRestoreWizard(vmid, preSnapId) {
  var vm = _rcVms.find(function (v) { return v.vmid === vmid; });
  if (!vm) { toast(t('msg_vm_not_found_in_snapshot_history'), 'error'); return; }
  _rwState = {
    vmid: vmid, name: vm.name, mappingId: vm.mappingId, relId: vm.relId || '', isDR: !!vm.isDR,
    isSan: vm.isSan, sanOpt: vm.sanOpt || false, pveClusterId: vm.pveClusterId, snap: null, snapName: '', step: 1
  };
  document.getElementById('rw_vm_hdr').textContent = (vm.name || 'VM') + ' (ID: ' + vmid + (vm.isDR ? ' · DR Secondary' : '') + ')';
  rwPopulateSnaps(preSnapId);
  rwUpdateStep(1);
  var modal = document.getElementById('rwModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(function () { trapFocus(modal); }, 80);
}

function closeRestoreWizard() {
  document.getElementById('rwModal').style.display = 'none';
  document.body.style.overflow = '';
}

async function rwPopulateSnaps(preSnapId) {
  var sel = document.getElementById('rw_snap');
  sel.innerHTML = '<option value="">Loading…</option>';
  if (_rwState.isDR) {
    try {
      var data = await apiFetch('snapmirror/secondary-snapshots?relationship_id=' + encodeURIComponent(_rwState.relId));
      var snaps = data.snapshots || [];
      sel.innerHTML = snaps.length
        ? snaps.map(function (s) { return '<option value="' + esc(s.name) + '">' + esc(s.name) + (s.created_at ? ' (' + fmtDate(s.created_at) + ')' : '') + '</option>'; }).join('')
        : '<option value="">— no secondary snapshots —</option>';
    } catch (e) { sel.innerHTML = '<option value="">— error loading —</option>'; }
    _rwState.snapName = sel.value;
    document.getElementById('rw_snap_info').textContent = 'SnapMirror® secondary snapshot';
    rwRebuildMethod();
    return;
  }
  var done = _allSnapshots.filter(function (s) {
    return s.status === 'done' && s.mapping_id === _rwState.mappingId &&
      s.vmids && s.vmids.indexOf(_rwState.vmid) >= 0;
  });
  var plugin = done.filter(function (s) { return s.source !== 'ontap_native'; });
  var native = done.filter(function (s) { return s.source === 'ontap_native'; });
  var all = plugin.concat(native);
  sel.innerHTML = all.length
    ? all.map(function (s) {
      var pfx = s.source === 'ontap_native' ? '[ONTAP] ' : '';
      return '<option value="' + s.id + '">' + pfx + esc(s.snap_name) + ' (' + fmtDate(s.created_at) + ')</option>';
    }).join('')
    : '<option value="">— no snapshots —</option>';
  if (preSnapId) sel.value = String(preSnapId);
  rwSnapChanged();
}

function rwSnapChanged() {
  if (_rwState.isDR) { _rwState.snapName = document.getElementById('rw_snap').value; return; }
  var sid = document.getElementById('rw_snap').value;
  _rwState.snap = _allSnapshots.find(function (s) { return String(s.id) === sid; }) || null;
  var info = document.getElementById('rw_snap_info');
  if (!_rwState.snap) { info.textContent = ''; rwRebuildMethod(); return; }
  info.textContent = (_rwState.snap.vmids || []).length + ' VM(s) in snapshot — ' + (_rwState.snap.volume_name || '');
  rwRebuildMethod();
}

function rwRebuildMethod() {
  var sel = document.getElementById('rw_method');
  if (_rwState.isDR) {
    sel.innerHTML = '<option value="dr_restore">DR Restore (from SnapMirror® secondary)</option>';
    document.getElementById('rw_method_hint').textContent = 'Restores the VM using the SnapMirror® secondary snapshot. Primary volume is not affected.';
    return;
  }
  if (_rwState.isSan) {
    sel.innerHTML =
      '<option value="san_single">Single VM restore (LV-copy — target VM only)</option>' +
      '<option value="san">Volume Revert — ALL VMs on datastore ⚠ destructive</option>';
  } else {
    sel.innerHTML = '<option value="sfsr">SFSR — in-place, fast (NFS)</option>';
  }
  rwMethodChanged();
}

function rwMethodChanged() {
  var method = document.getElementById('rw_method').value;
  var hint = document.getElementById('rw_method_hint');
  var msgs = {
    sfsr: 'Individual disk files restored in-place. VM is stopped during restore.',
    san_single: 'Only the target VM\'s LVs are overwritten. Other VMs on this datastore keep running.',
    san: '⚠ Volume Revert: all VMs on this datastore are rolled back. All data written after the snapshot is permanently lost.',
    dr_restore: 'Restores the VM using the SnapMirror® secondary snapshot.',
  };
  hint.textContent = msgs[method] || '';
  hint.style.color = method === 'san' ? 'var(--error)' : '';
}

function rwUpdateStep(n) {
  _rwState.step = n;
  [1, 2, 3].forEach(function (i) {
    document.getElementById('rwStep' + i).style.display = (i === n) ? '' : 'none';
    var pill = document.getElementById('rwPill' + i);
    pill.classList.toggle('active', i === n);
    pill.classList.toggle('done', i < n);
  });
  document.getElementById('rwBackBtn').style.display = n > 1 ? '' : 'none';
  document.getElementById('rwNextBtn').style.display = n < 3 ? '' : 'none';
  document.getElementById('rwSubmitBtn').style.display = n === 3 ? '' : 'none';
  if (n === 2) {
    document.getElementById('rw_safety_row').style.display = _rwState.isDR ? 'none' : '';
    document.getElementById('rw_node_row').style.display = _rwState.isDR ? 'none' : '';
    if (!_rwState.isDR) rwLoadNodes();
  }
  if (n === 3) rwBuildSummary();
}

async function rwLoadNodes() {
  var sel = document.getElementById('rw_target_node');
  sel.innerHTML = '<option value="">Auto (any host in cluster)</option>';
  if (!_rwState.pveClusterId) return;
  try {
    var d = await apiFetch('clone/nodes?pve_cluster_id=' + encodeURIComponent(_rwState.pveClusterId));
    (d.nodes || []).forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
  } catch (e) { }
}

function rwBuildSummary() {
  var snapDisplay = _rwState.isDR ? _rwState.snapName : (_rwState.snap ? _rwState.snap.snap_name : '—');
  if (!snapDisplay) { rwUpdateStep(1); return; }
  var method = document.getElementById('rw_method').value;
  var node = _rwState.isDR ? 'DR (automatic)' : (document.getElementById('rw_target_node').value || 'auto');
  var startA = document.getElementById('rw_start_after').checked;
  document.getElementById('rw_sum_snap').textContent = snapDisplay;
  document.getElementById('rw_sum_vmid').textContent = _rwState.vmid + (_rwState.name ? ' – ' + _rwState.name : '');
  document.getElementById('rw_sum_method').textContent = method;
  document.getElementById('rw_sum_node').textContent = node;
  document.getElementById('rw_sum_start').textContent = startA ? 'Yes' : 'No';
  document.getElementById('rw_sum_expected').textContent = snapDisplay;
  document.getElementById('rw_confirm_input').value = '';
  document.getElementById('rwSubmitBtn').disabled = true;
  var blastRow = document.getElementById('rw_blast_row');
  var safetyRow = document.getElementById('rw_sum_safety_row');
  if (blastRow) blastRow.style.display = _rwState.isDR ? 'none' : '';
  if (safetyRow) safetyRow.style.display = _rwState.isDR ? 'none' : '';
  if (!_rwState.isDR) {
    document.getElementById('rw_sum_safety').checked = document.getElementById('rw_safety').checked;
    if (_rwState.snap) document.getElementById('rw_sum_blast').innerHTML = _blastRadiusHtml(_rwState.snap.vmids || [], _rwState.snap.vm_names || {});
  }
}

function rwCheckConfirm() {
  var exp = document.getElementById('rw_sum_expected').textContent;
  document.getElementById('rwSubmitBtn').disabled = (document.getElementById('rw_confirm_input').value !== exp);
}

function rwNext() {
  if (_rwState.step === 1) {
    if (_rwState.isDR && !_rwState.snapName) { toast(t('msg_please_select_a_snapshot'), 'error'); return; }
    if (!_rwState.isDR && !_rwState.snap) { toast(t('msg_please_select_a_snapshot_1'), 'error'); return; }
  }
  if (_rwState.step < 3) rwUpdateStep(_rwState.step + 1);
}
function rwBack() { if (_rwState.step > 1) rwUpdateStep(_rwState.step - 1); }

async function doRestore() {
  var vmid = _rwState.vmid;
  var node = document.getElementById('rw_target_node').value;
  var startA = document.getElementById('rw_start_after').checked;
  if (!vmid) return;
  var btn = document.getElementById('rwSubmitBtn');
  btn.disabled = true; btn.textContent = 'Running…';

  if (_rwState.isDR) {
    if (!_rwState.snapName || !_rwState.relId || !_rwState.mappingId) {
      toast(t('msg_missing_dr_restore_parameters'), 'error'); btn.disabled = false; btn.textContent = 'Start Restore'; return;
    }
    try {
      var r = await apiPost('restore/dr-start', { relationship_id: _rwState.relId, snap_name: _rwState.snapName, vmid: vmid, mapping_id: _rwState.mappingId });
      toast(t('msg_dr_restore_started_job') + r.job_id, 'success');
      closeRestoreWizard();
      setTimeout(function () { document.querySelector('[data-tab="jobs"]').click(); setTimeout(loadAllJobs, 800); }, 300);
    } catch (e) { toast(e.message, 'error', e.detail); btn.disabled = false; btn.textContent = 'Start Restore'; }
    return;
  }

  var snap = _rwState.snap;
  var method = document.getElementById('rw_method').value;
  var safety = document.getElementById('rw_sum_safety').checked;
  if (!snap) return;
  if (safety) {
    try {
      var today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      await apiPost('snapshots/create', { mapping_id: snap.mapping_id, name: 'safety_pre_restore_' + today, consistency: 'crash', vmids: [] });
    } catch (e) {
      var cont = await uiConfirm(t('msg_safety_snapshot_failed') + (e.message || e) + '\n\nProceed anyway?', 'Proceed', 'btn-danger');
      if (!cont) { btn.disabled = false; btn.textContent = 'Start Restore'; return; }
    }
  }
  var isNative = snap.source === 'ontap_native';
  var payload = isNative
    ? { native: true, mapping_id: snap.mapping_id, snap_name: snap.snap_name, vmid: vmid, method: method, node: node || '', start_after: startA }
    : { snapshot_id: snap.id, vmid: vmid, method: method, node: node || '', start_after: startA };
  try {
    var r = await apiPost('restore/start', payload);
    toast(t('msg_restore_started_job') + r.job_id, 'success');
    closeRestoreWizard();
    setTimeout(function () { document.querySelector('[data-tab="jobs"]').click(); setTimeout(loadAllJobs, 800); }, 300);
  } catch (e) { toast(e.message, 'error', e.detail); btn.disabled = false; btn.textContent = 'Start Restore'; }
}

// ── Clone Wizard ──────────────────────────────────────────────────────────

var _cwState = { vmid: null, name: '', mappingId: '', relId: '', isDR: false, isSan: false, pveClusterId: '', snap: null, snapName: '', step: 1 };

function openCloneWizard(vmid, preSnapId) {
  var vm = _rcVms.find(function (v) { return v.vmid === vmid; });
  if (!vm) { toast(t('msg_vm_not_found_in_snapshot_history_1'), 'error'); return; }
  _cwState = {
    vmid: vmid, name: vm.name, mappingId: vm.mappingId, relId: vm.relId || '', isDR: !!vm.isDR,
    isSan: vm.isSan, pveClusterId: vm.pveClusterId, snap: null, snapName: '', step: 1
  };
  document.getElementById('cw_vm_hdr').textContent = (vm.name || 'VM') + ' (ID: ' + vmid + (vm.isDR ? ' · DR Secondary' : '') + ')';
  cwPopulateSnaps(preSnapId);
  cwUpdateStep(1);
  var modal = document.getElementById('cwModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(function () { trapFocus(modal); }, 80);
}

function closeCloneWizard() {
  document.getElementById('cwModal').style.display = 'none';
  document.body.style.overflow = '';
}

async function cwPopulateSnaps(preSnapId) {
  var sel = document.getElementById('cw_snap');
  sel.innerHTML = '<option value="">Loading…</option>';
  if (_cwState.isDR) {
    try {
      var data = await apiFetch('snapmirror/secondary-snapshots?relationship_id=' + encodeURIComponent(_cwState.relId));
      var snaps = data.snapshots || [];
      sel.innerHTML = snaps.length
        ? snaps.map(function (s) { return '<option value="' + esc(s.name) + '">' + esc(s.name) + (s.created_at ? ' (' + fmtDate(s.created_at) + ')' : '') + '</option>'; }).join('')
        : '<option value="">— no secondary snapshots —</option>';
    } catch (e) { sel.innerHTML = '<option value="">— error loading —</option>'; }
    _cwState.snapName = sel.value;
    document.getElementById('cw_snap_info').textContent = 'SnapMirror® secondary snapshot · DR Clone';
    return;
  }
  var done = _allSnapshots.filter(function (s) {
    return s.status === 'done' && s.mapping_id === _cwState.mappingId &&
      s.vmids && s.vmids.indexOf(_cwState.vmid) >= 0;
  });
  var plugin = done.filter(function (s) { return s.source !== 'ontap_native'; });
  var native = done.filter(function (s) { return s.source === 'ontap_native'; });
  var all = plugin.concat(native);
  sel.innerHTML = all.length
    ? all.map(function (s) {
      var pfx = s.source === 'ontap_native' ? '[ONTAP] ' : '';
      return '<option value="' + s.id + '">' + pfx + esc(s.snap_name) + ' (' + fmtDate(s.created_at) + ')</option>';
    }).join('')
    : '<option value="">— no snapshots —</option>';
  if (preSnapId) sel.value = String(preSnapId);
  cwSnapChanged();
}

function cwSnapChanged() {
  if (_cwState.isDR) { _cwState.snapName = document.getElementById('cw_snap').value; return; }
  var sid = document.getElementById('cw_snap').value;
  _cwState.snap = _allSnapshots.find(function (s) { return String(s.id) === sid; }) || null;
  var info = document.getElementById('cw_snap_info');
  if (!_cwState.snap) { info.textContent = ''; return; }
  var proto = (_cwState.snap.storage_protocol || 'nfs').toLowerCase();
  var label = { nvme: 'NVMe — LV-copy', iscsi: 'iSCSI — LV-copy', nfs: 'NFS — file clone (CoW)' }[proto] || '';
  info.textContent = label + ' · ' + (_cwState.snap.vmids || []).length + ' VM(s) in snapshot';
}

function cwUpdateStep(n) {
  _cwState.step = n;
  [1, 2, 3].forEach(function (i) {
    document.getElementById('cwStep' + i).style.display = (i === n) ? '' : 'none';
    var pill = document.getElementById('cwPill' + i);
    pill.classList.toggle('active', i === n);
    pill.classList.toggle('done', i < n);
  });
  document.getElementById('cwBackBtn').style.display = n > 1 ? '' : 'none';
  document.getElementById('cwNextBtn').style.display = n < 3 ? '' : 'none';
  document.getElementById('cwSubmitBtn').style.display = n === 3 ? '' : 'none';
  if (n === 2) {
    document.getElementById('cw_node_row').style.display = _cwState.isDR ? 'none' : '';
    if (!_cwState.isDR) cwLoadNodes();
    cwSuggestId();
  }
  if (n === 3) cwBuildSummary();
}

async function cwLoadNodes() {
  var sel = document.getElementById('cw_target_node');
  sel.innerHTML = '<option value="">Auto (any host in cluster)</option>';
  if (!_cwState.pveClusterId || _cwState.isDR) return;
  try {
    var d = await apiFetch('clone/nodes?pve_cluster_id=' + encodeURIComponent(_cwState.pveClusterId));
    (d.nodes || []).forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
  } catch (e) { }
}

async function cwSuggestId() {
  if (!_cwState.pveClusterId) return;
  try {
    var d = await apiFetch('clone/nextid?pve_cluster_id=' + encodeURIComponent(_cwState.pveClusterId));
    if (d.vmid) document.getElementById('cw_new_vmid').value = d.vmid;
  } catch (e) { }
}

function cwBuildSummary() {
  var snapDisplay = _cwState.isDR ? _cwState.snapName : (_cwState.snap ? _cwState.snap.snap_name : '—');
  var newName = document.getElementById('cw_new_name').value.trim();
  var newVmid = document.getElementById('cw_new_vmid').value;
  var node = _cwState.isDR ? 'auto (DR)' : (document.getElementById('cw_target_node').value || 'auto');
  var netIso = document.getElementById('cw_network_isolated').checked;
  var startA = document.getElementById('cw_start_after').checked;
  document.getElementById('cw_sum_src').textContent = _cwState.vmid + (_cwState.name ? ' – ' + _cwState.name : '');
  document.getElementById('cw_sum_snap').textContent = snapDisplay;
  document.getElementById('cw_sum_vmid').textContent = newVmid || '—';
  document.getElementById('cw_sum_name').textContent = newName || '(auto)';
  document.getElementById('cw_sum_node').textContent = node;
  document.getElementById('cw_sum_net').textContent = netIso ? 'Disconnected (link_down=1)' : 'Connected';
  document.getElementById('cw_sum_start').textContent = startA ? 'Yes' : 'No';
  document.getElementById('cwSubmitBtn').disabled = !newVmid;
}

function cwNext() {
  if (_cwState.step === 1) {
    if (_cwState.isDR && !_cwState.snapName) { toast(t('msg_please_select_a_snapshot_2'), 'error'); return; }
    if (!_cwState.isDR && !_cwState.snap) { toast(t('msg_please_select_a_snapshot_3'), 'error'); return; }
  }
  if (_cwState.step === 2 && !document.getElementById('cw_new_vmid').value) { toast(t('msg_please_enter_a_new_vm_id'), 'error'); return; }
  if (_cwState.step < 3) cwUpdateStep(_cwState.step + 1);
}
function cwBack() { if (_cwState.step > 1) cwUpdateStep(_cwState.step - 1); }

async function doClone() {
  var srcVmid = _cwState.vmid;
  var newVmid = parseInt(document.getElementById('cw_new_vmid').value);
  var newName = document.getElementById('cw_new_name').value.trim();
  var netIso = document.getElementById('cw_network_isolated').checked;
  var startA = document.getElementById('cw_start_after').checked;
  if (!srcVmid || !newVmid) return;
  var btn = document.getElementById('cwSubmitBtn');
  btn.disabled = true; btn.textContent = 'Starting…';

  if (_cwState.isDR) {
    if (!_cwState.snapName || !_cwState.relId || !_cwState.mappingId) {
      toast(t('msg_missing_dr_clone_parameters'), 'error'); btn.disabled = false; btn.textContent = 'Start Clone'; return;
    }
    try {
      var r = await apiPost('clone/dr-start', {
        relationship_id: _cwState.relId, snap_name: _cwState.snapName,
        src_vmid: srcVmid, new_vmid: newVmid, new_name: newName, mapping_id: _cwState.mappingId, start_after: startA
      });
      toast(t('msg_dr_clone_started_job') + r.job_id, 'success');
      closeCloneWizard();
      setTimeout(function () { document.querySelector('[data-tab="jobs"]').click(); setTimeout(loadAllJobs, 800); }, 300);
    } catch (e) { toast(e.message, 'error', e.detail); btn.disabled = false; btn.textContent = 'Start Clone'; }
    return;
  }

  var snap = _cwState.snap;
  var node = document.getElementById('cw_target_node').value;
  if (!snap) return;
  var isNative = snap.source === 'ontap_native';
  var payload = isNative
    ? {
      native: true, mapping_id: snap.mapping_id, snap_name: snap.snap_name,
      src_vmid: srcVmid, new_vmid: newVmid, target_node: node, new_name: newName, start_after: startA, network_isolated: netIso
    }
    : {
      snapshot_id: snap.id, src_vmid: srcVmid, new_vmid: newVmid, target_node: node,
      new_name: newName, start_after: startA, network_isolated: netIso
    };
  try {
    var r = await apiPost('clone/start', payload);
    toast(t('msg_clone_started_job') + r.job_id, 'success');
    closeCloneWizard();
    setTimeout(function () { document.querySelector('[data-tab="jobs"]').click(); setTimeout(loadAllJobs, 800); }, 300);
  } catch (e) { toast(e.message, 'error', e.detail); btn.disabled = false; btn.textContent = 'Start Clone'; }
}

// ── Navigate from snapshot table ─────────────────────────────────────────

function _blastRadiusHtml(vmids, vmNames) {
  if (!vmids || !vmids.length) return '<span style="opacity:.5;font-size:12px">— no VM information available —</span>';
  return vmids.map(function (v) {
    var n = vmNames && vmNames[String(v)];
    return '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:rgba(217,83,79,.12);border:1px solid rgba(217,83,79,.3);border-radius:4px;font-family:monospace;font-size:12px">'
      + esc(String(v)) + (n ? ' <span style="font-family:sans-serif;opacity:.65">– ' + esc(n) + '</span>' : '')
      + '</span>';
  }).join(' ');
}

function showRestoreConfirm() {
  var snap = _selectedRestoreSnap;
  if (!snap) return;
  var txtVisible = document.getElementById('restore_vmid_text').style.display !== 'none';
  var vmid = txtVisible
    ? parseInt(document.getElementById('restore_vmid_text').value)
    : parseInt(document.getElementById('restore_vmid').value);
  var method = document.getElementById('restore_method').value;
  var dsSel = document.getElementById('restore_datastore');
  var dsText = dsSel && dsSel.options[dsSel.selectedIndex] ? dsSel.options[dsSel.selectedIndex].text : snap.mapping_id;

  _restoreConfirmData = { snap: snap, vmid: vmid, method: method };

  var vmids = snap.vmids || [];
  var vmNames = snap.vm_names || {};

  document.getElementById('rcm_snap_name').textContent = snap.snap_name;
  document.getElementById('rcm_datastore').textContent = dsText;
  document.getElementById('rcm_method').textContent = method;
  document.getElementById('rcm_vmid').textContent = vmid + (vmNames[String(vmid)] ? ' – ' + vmNames[String(vmid)] : '');
  document.getElementById('rcm_blast_vms').innerHTML = _blastRadiusHtml(vmids, vmNames);
  document.getElementById('rcm_expected').textContent = snap.snap_name;
  document.getElementById('rcm_confirm_input').value = '';
  document.getElementById('rcm_submit').disabled = true;
  document.getElementById('rcm_safety').checked = true;

  var modal = document.getElementById('restoreConfirmModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(function () { trapFocus(modal); document.getElementById('rcm_confirm_input').focus(); }, 80);
}

function hideRestoreConfirm() {
  document.getElementById('restoreConfirmModal').style.display = 'none';
  document.body.style.overflow = '';
  _restoreConfirmData = null;
}

function rcmCheckInput() {
  var expected = document.getElementById('rcm_expected').textContent;
  var val = document.getElementById('rcm_confirm_input').value;
  document.getElementById('rcm_submit').disabled = (val !== expected);
}

async function doRestoreConfirmed() {
  if (!_restoreConfirmData) return;
  var snap = _restoreConfirmData.snap;
  var vmid = _restoreConfirmData.vmid;
  var method = _restoreConfirmData.method;
  var safety = document.getElementById('rcm_safety').checked;

  var btn = document.getElementById('rcm_submit');
  btn.disabled = true;
  btn.textContent = 'Running…';

  if (safety) {
    try {
      var today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      await apiPost('snapshots/create', {
        mapping_id: snap.mapping_id,
        name: 'safety_pre_restore_' + today,
        consistency: 'crash',
        vmids: [],
      });
    } catch (e) {
      var cont = await uiConfirm(
        'Safety snapshot could not be created:\n' + (e.message || e) +
        '\n\nProceed with restore anyway?',
        'Proceed', 'btn-danger'
      );
      if (!cont) {
        btn.disabled = false;
        btn.textContent = 'Start VM Restore';
        return;
      }
    }
  }

  var isNative = snap.source === 'ontap_native';
  var payload = isNative
    ? { native: true, mapping_id: snap.mapping_id, snap_name: snap.snap_name, vmid: vmid, method: method }
    : { snapshot_id: snap.id, vmid: vmid, method: method };

  try {
    var d = await apiPost('restore/start', payload);
    hideRestoreConfirm();
    toast(tf('msg_restore_started', d.job_id), 'success');
    setTimeout(function () { document.querySelector('[data-tab="jobs"]').click(); }, 800);
  } catch (e) {
    toast(e.message, 'error', e.detail);
    btn.disabled = false;
    btn.textContent = 'Start VM Restore';
  }
}

// ── Danger Modals: Delete Confirm ────────────────────────────────────────

var _deleteConfirmData = null;

function showDeleteConfirm(id, name, isNative, ontap_snap_uuid, mapping_id) {
  var snap = id ? _allSnapshots.find(function (s) { return String(s.id) === String(id); }) : null;
  var vmids = snap ? (snap.vmids || []) : [];
  var vmNames = snap ? (snap.vm_names || {}) : {};

  _deleteConfirmData = { id: id, name: name, isNative: isNative, ontap_snap_uuid: ontap_snap_uuid, mapping_id: mapping_id };

  document.getElementById('dcm_snap_name').textContent = name;
  document.getElementById('dcm_expected').textContent = name;
  document.getElementById('dcm_blast_vms').innerHTML = _blastRadiusHtml(vmids, vmNames);
  document.getElementById('dcm_blast_wrap').style.display = vmids.length ? '' : 'none';
  document.getElementById('dcm_confirm_input').value = '';
  document.getElementById('dcm_submit').disabled = true;

  var modal = document.getElementById('deleteConfirmModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(function () { trapFocus(modal); document.getElementById('dcm_confirm_input').focus(); }, 80);
}

function hideDeleteConfirm() {
  document.getElementById('deleteConfirmModal').style.display = 'none';
  document.body.style.overflow = '';
  _deleteConfirmData = null;
}

function dcmCheckInput() {
  var expected = document.getElementById('dcm_expected').textContent;
  var val = document.getElementById('dcm_confirm_input').value;
  document.getElementById('dcm_submit').disabled = (val !== expected);
}

async function doDeleteConfirmed() {
  if (!_deleteConfirmData) return;
  var id = _deleteConfirmData.id;
  var name = _deleteConfirmData.name;
  var isNative = _deleteConfirmData.isNative;
  var snap_uuid = _deleteConfirmData.ontap_snap_uuid;
  var mapping_id = _deleteConfirmData.mapping_id;

  var btn = document.getElementById('dcm_submit');
  btn.disabled = true;
  btn.textContent = 'Deleting…';

  if (isNative) {
    var payload = { native: true, ontap_snap_uuid: snap_uuid, mapping_id: mapping_id, snap_name: name };
    try {
      await apiPost('snapshots/delete', payload);
      toast(t('msg_snap_deleted'), 'success');
      hideDeleteConfirm();
      loadSnapshots();
    } catch (e) {
      var msg = e.message || String(e);
      btn.disabled = false;
      btn.textContent = 'Delete Snapshot';
      var forceOk = await uiConfirm(
        'Delete failed:\n' + msg + '\n\nRetry with force=true?\n(removes auto-managed snapshots; does not break SnapMirror relationships)',
        'Force Delete', 'btn-danger'
      );
      if (!forceOk) return;
      try {
        await apiPost('snapshots/delete', Object.assign({}, payload, { force: true }));
        toast(t('msg_snap_deleted'), 'success');
        hideDeleteConfirm();
        loadSnapshots();
      } catch (e2) { toast(e2.message, 'error'); }
    }
  } else {
    try {
      await apiPost('snapshots/delete', { id: id });
      toast(t('msg_snap_deleted'), 'success');
      hideDeleteConfirm();
      loadSnapshots();
    } catch (e) {
      toast(e.message, 'error', e.detail);
      btn.disabled = false;
      btn.textContent = 'Delete Snapshot';
    }
  }
}

// ═══════════════════════════ CLONE ════════════════════════════════════════

var _cloneSnap = null;

async function loadCloneSnapshots() {
  try { _allSnapshots = await apiFetch('snapshots'); } catch (e) { }
  var done = _allSnapshots.filter(function (s) { return s.status === 'done'; });

  var datastores = {};
  done.forEach(function (s) {
    var key = s.mapping_id;
    if (!datastores[key]) {
      datastores[key] = {
        mapping_id: key,
        label: (s.pve_storage_id || s.volume_name || key) + ' [' + _snapProtoLabel(s) + ']',
      };
    }
  });

  var dsSel = document.getElementById('clone_datastore');
  var cur = dsSel ? dsSel.value : '';
  if (dsSel) {
    dsSel.innerHTML = '<option value="">— Select datastore —</option>' +
      Object.values(datastores).map(function (d) {
        return '<option value="' + esc(d.mapping_id) + '">' + esc(d.label) + '</option>';
      }).join('');
    if (cur && datastores[cur]) {
      dsSel.value = cur;
      onCloneDatastoreChange();
    } else {
      var snapSel = document.getElementById('clone_snap');
      snapSel.innerHTML = '<option value="">— select datastore first —</option>';
      snapSel.disabled = true;
    }
  }
}

function onCloneDatastoreChange() {
  var mappingId = document.getElementById('clone_datastore').value;
  var snapSel = document.getElementById('clone_snap');

  if (!mappingId) {
    snapSel.innerHTML = '<option value="">— select datastore first —</option>';
    snapSel.disabled = true;
    document.getElementById('cloneFormInfo').textContent = '';
    return;
  }

  var done = _allSnapshots.filter(function (s) {
    return s.status === 'done' && s.mapping_id === mappingId;
  });
  // Plugin-managed first, native at the end (they carry an older manifest)
  var pluginSnaps = done.filter(function (s) { return s.source !== 'ontap_native'; });
  var nativeSnaps = done.filter(function (s) { return s.source === 'ontap_native'; });
  var sorted = pluginSnaps.concat(nativeSnaps);
  snapSel.innerHTML = sorted.length
    ? '<option value="">' + t('snap_choose') + '</option>' +
    sorted.map(function (s) {
      var prefix = s.source === 'ontap_native' ? '[ONTAP] ' : '';
      return '<option value="' + s.id + '">' + prefix + esc(s.snap_name) +
        ' &nbsp;(' + fmtDate(s.created_at) + ')</option>';
    }).join('')
    : '<option value="">— no snapshots —</option>';
  snapSel.disabled = false;
  document.getElementById('cloneFormInfo').textContent = '';
}

async function prepareCloneFromSelect() {
  var snapId = document.getElementById('clone_snap').value;
  if (!snapId) { _cloneSnap = null; document.getElementById('cloneFormInfo').textContent = ''; return; }
  var snap = _allSnapshots.find(function (s) { return String(s.id) === String(snapId); });
  if (!snap) return;
  await _fillCloneForm(snap);
}

async function _fillCloneForm(snap) {
  _cloneSnap = snap;
  var proto = (snap.storage_protocol || 'nfs').toLowerCase();
  var methodDesc = {
    nvme: 'NVMe Clone: namespace clone → vgimportclone → LV-copy + new VMID + new MAC',
    iscsi: 'iSCSI Clone: LUN clone → vgimportclone → LV-copy + new VMID + new MAC',
    nfs: 'NFS Clone: ONTAP file clone (CoW) → new VMID + new MAC',
  }[proto] || '';
  document.getElementById('cloneFormInfo').textContent =
    snap.snap_name + ' (' + (snap.volume_name || '') + ') — ' + methodDesc;
  document.getElementById('clone_new_name').value = '';
  document.getElementById('clone_new_vmid').value = '';
  document.getElementById('clone_start_after').checked = false;

  var srcSel = document.getElementById('clone_src_vmid');
  var txtSel = document.getElementById('clone_src_vmid_text');
  var hint = document.getElementById('clone_manifest_hint');
  txtSel.style.display = 'none';
  hint.style.display = 'none';
  srcSel.style.display = '';
  srcSel.innerHTML = '<option value="">' + t('hint_loading') + '</option>';

  var vmids = snap.vmids || [];
  var vmNames = snap.vm_names || {};

  if (snap.source === 'ontap_native' || !vmids.length) {
    try {
      var m = await apiFetch(
        'snapshots/manifest?snap_name=' + encodeURIComponent(snap.snap_name) +
        '&mapping_id=' + encodeURIComponent(snap.mapping_id)
      );
      vmids = m.vmids || [];
      vmNames = m.vm_names || {};
      if (m.manifest_snap_name && m.manifest_snap_name !== snap.snap_name) {
        hint.textContent = 'Manifest from "' + esc(m.manifest_snap_name) + '" used (most recent ProxmoxVEx snapshot in this ONTAP snapshot).';
        hint.style.display = '';
      }
    } catch (e) {
      // Manifest not available (e.g. native SAN snapshot) — fall back to manual input
      vmids = [];
    }
  }

  if (vmids.length) {
    srcSel.innerHTML = vmids.map(function (v) {
      var n = (vmNames || {})[String(v)];
      return '<option value="' + v + '">' + v + (n ? ' – ' + esc(n) : '') + '</option>';
    }).join('');
  } else {
    srcSel.style.display = 'none';
    txtSel.style.display = '';
    hint.textContent = t('msg_no_manifest');
    hint.style.display = '';
  }

  await _loadCloneNodes(snap.pve_cluster_id);
  suggestNextId();
}

async function _loadCloneNodes(pveClusterId) {
  var sel = document.getElementById('clone_target_node');
  var txt = document.getElementById('clone_target_node_text');
  sel.style.display = '';
  txt.style.display = 'none';
  sel.innerHTML = '<option value="">' + t('hint_loading') + '</option>';
  var nodes = [];
  try {
    var d = await apiFetch('clone/nodes?pve_cluster_id=' + encodeURIComponent(pveClusterId));
    nodes = d.nodes || [];
  } catch (e) { }
  if (nodes.length) {
    sel.innerHTML = nodes.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    txt.style.display = 'none';
  } else {
    sel.style.display = 'none';
    txt.style.display = '';
    txt.value = '';
  }
}
function _syncNodeText(v) {
  /* keeps the hidden select in sync so startClone() reads the right value */
  var sel = document.getElementById('clone_target_node');
  var opt = sel.querySelector('option[value="' + v + '"]');
  if (!opt) {
    opt = document.createElement('option');
    opt.value = v;
    sel.appendChild(opt);
  }
  sel.value = v;
}

async function suggestNextId() {
  if (!_cloneSnap) return;
  try {
    var d = await apiFetch('clone/nextid?pve_cluster_id=' + encodeURIComponent(_cloneSnap.pve_cluster_id));
    if (d.vmid) document.getElementById('clone_new_vmid').value = d.vmid;
  } catch (e) { }
}

function onCloneSrcChange() { /* placeholder for future extensions */ }

async function startClone() {
  try {
    if (!_cloneSnap) { toast(t('msg_no_snap'), 'error'); return; }
    var txtVisible = document.getElementById('clone_src_vmid_text').style.display !== 'none';
    var src_vmid = txtVisible
      ? parseInt(document.getElementById('clone_src_vmid_text').value)
      : parseInt(document.getElementById('clone_src_vmid').value);
    var new_vmid = parseInt(document.getElementById('clone_new_vmid').value);
    var target_node = document.getElementById('clone_target_node').value;
    var new_name = document.getElementById('clone_new_name').value.trim();
    var start_after = document.getElementById('clone_start_after').checked;

    if (!src_vmid) { toast(t('msg_src_vm_req'), 'error'); return; }
    if (!new_vmid) { toast(t('msg_vmid_req'), 'error'); return; }
    if (!target_node) { toast(t('msg_node_req'), 'error'); return; }

    var isNative = _cloneSnap.source === 'ontap_native';
    var payload = isNative
      ? {
        native: true, mapping_id: _cloneSnap.mapping_id, snap_name: _cloneSnap.snap_name,
        src_vmid, new_vmid, target_node, new_name, start_after
      }
      : { snapshot_id: _cloneSnap.id, src_vmid, new_vmid, target_node, new_name, start_after };
    var d = await apiPost('clone/start', payload);
    toast(tf('msg_clone_started', d.job_id), 'success');
    _cloneSnap = null;
    setTimeout(function () {
      document.querySelector('[data-tab="jobs"]').click();
    }, 800);
  } catch (e) { toast(t('msg_clone') + (e.message || e), 'error'); }
}

// ═══════════════════════════ SCHEDULES ════════════════════════════════════

var _schedulesCache = [];
var _schedVmNameMap = {};
var _schedSearch = '';
var _schedSortCol = 'name';
var _schedSortDir = 1;
var _schedWizStep = 1;
var _schedWizHasSM = false;

async function loadSchedules() {
  try {
    var rows = await apiFetch('schedules');
    _schedulesCache = rows;
    _schedVmNameMap = {};
    var uniqueMids = rows.map(function (r) { return r.mapping_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    await Promise.all(uniqueMids.map(async function (mid) {
      try {
        var d = await apiFetch('snapshots/vms-for-mapping?mapping_id=' + encodeURIComponent(mid));
        (d.vms || []).forEach(function (v) { _schedVmNameMap[v.vmid] = v.name || ''; });
      } catch (e) { }
    }));
    _renderSchedules();
  } catch (e) { toast(e.message, 'error'); }
}

function schedFilterChanged() {
  _schedSearch = (document.getElementById('schedSearch') || {}).value || '';
  _renderSchedules();
}

function schedColSort(col) {
  if (_schedSortCol === col) { _schedSortDir = -_schedSortDir; }
  else { _schedSortCol = col; _schedSortDir = col === 'lastRun' ? -1 : 1; }
  _renderSchedules();
}

function _renderSchedules() {
  var tbody = document.getElementById('schedulesBody');
  if (!tbody) return;
  var q = (_schedSearch || '').toLowerCase();
  var rows = _schedulesCache.filter(function (s) {
    if (!q) return true;
    return (s.name || '').toLowerCase().indexOf(q) >= 0
      || (s.pve_storage_id || '').toLowerCase().indexOf(q) >= 0
      || (s.volume_name || '').toLowerCase().indexOf(q) >= 0
      || (s.label || '').toLowerCase().indexOf(q) >= 0;
  });
  var col = _schedSortCol, dir = _schedSortDir;
  rows = rows.slice().sort(function (a, b) {
    var av, bv;
    if (col === 'name') { av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); return dir * av.localeCompare(bv); }
    if (col === 'volume') { av = (a.pve_storage_id || '').toLowerCase(); bv = (b.pve_storage_id || '').toLowerCase(); return dir * av.localeCompare(bv); }
    if (col === 'retention') return dir * (a.retention_count - b.retention_count);
    if (col === 'status') return dir * ((a.enabled ? 1 : 0) - (b.enabled ? 1 : 0));
    if (col === 'lastRun') { av = a.last_run_at || ''; bv = b.last_run_at || ''; return dir * av.localeCompare(bv); }
    return 0;
  });
  if (!rows.length) {
    tbody.innerHTML = q
      ? _emptyRow(10, _svgClock, 'No schedules match "' + esc(q) + '".')
      : _emptyRow(10, _svgClock, 'No schedules configured', 'Without a schedule, snapshots must be created manually. Add a schedule to automate protection.', '+ Add Schedule', 'showAddScheduleForm()');
    return;
  }
  tbody.innerHTML = rows.map(function (s) {
    var lastRun = s.last_run_at ? fmtDate(s.last_run_at) + ' ' + statusBadge(s.last_run_status) : '–';
    var vmDisplay = '<div class="vm-bubble-box">';
    if (s.sync_vmids) {
      vmDisplay += '<span class="badge" style="background:var(--primary);color:#fff;margin-right:4px" title="VMs are fetched from the datastore before each run">Auto</span>';
    }
    vmDisplay += (s.vmids || []).map(function (id) {
      return vmBadge(id, _schedVmNameMap[id]);
    }).join('');
    if (s.sync_vmids && !(s.vmids || []).length) {
      vmDisplay += '<span style="color:var(--muted);font-size:11px">will be populated on first run</span>';
    }
    vmDisplay += '</div>';
    return '<tr>' +
      '<td><strong>' + esc(s.name) + '</strong></td>' +
      '<td><code style="font-size:11px">' + esc(s.pve_storage_id || '') + '</code>' + (s.volume_name && s.volume_name !== s.pve_storage_id ? '<br><code style="font-size:10px;opacity:.6">' + esc(s.volume_name) + '</code>' : '') + '</td>' +
      '<td>' + vmDisplay + '</td>' +
      '<td>' + esc(cronHuman(s.cron_expr)) + '</td>' +
      '<td>' + (s.label ? '<span class="corp-badge corp-badge-ha">' + esc(s.label) + '</span>' : '<span style="color:var(--muted)">–</span>') + '</td>' +
      '<td>' + s.retention_count + '×</td>' +
      '<td>' + (s.enabled ? '<span class="corp-badge corp-badge-online">' + t('badge_active') + '</span>' : '<span class="corp-badge corp-badge-stopped">' + t('badge_inactive') + '</span>') + '</td>' +
      '<td style="color:var(--muted)">' + lastRun + '</td>' +
      '<td>' + schedSmBadge(s.snapmirror) + '</td>' +
      '<td><div class="row-actions">' +
      '<button class="btn btn-ghost btn-sm" onclick="toggleSchedule(\'' + s.id + '\',' + s.enabled + ')">' + (s.enabled ? t('act_deactivate') : t('act_activate')) + '</button>' +
      '<button class="btn btn-primary btn-sm" onclick="runNow(\'' + s.id + '\',\'' + esc(s.name) + '\')">' + t('act_run_now') + '</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="editSchedule(\'' + s.id + '\')">' + t('act_edit') + '</button>' +
      '<button class="btn btn-danger btn-sm" onclick="deleteSchedule(\'' + s.id + '\',\'' + esc(s.name) + '\')">' + t('act_delete') + '</button>' +
      '</div></td></tr>';
  }).join('');
  ['name', 'volume', 'retention', 'status', 'lastRun'].forEach(function (c) {
    var span = document.getElementById('schs_' + c);
    var th = span && span.parentElement;
    if (!span) return;
    if (c === _schedSortCol) {
      span.textContent = _schedSortDir === 1 ? '↑' : '↓';
      if (th) th.classList.add('sort-active');
    } else {
      span.textContent = '⇅';
      if (th) th.classList.remove('sort-active');
    }
  });
}

function cronHuman(expr) {
  var dayKeys = [t('day_sun_s'), t('day_mon_s'), t('day_tue_s'), t('day_wed_s'), t('day_thu_s'), t('day_fri_s'), t('day_sat_s')];
  var al = {
    '@daily': tf('cron_daily', '00:00'),
    '@midnight': tf('cron_daily', '00:00'),
    '@weekly': tf('cron_weekly', t('day_mon_s'), '00:00'),
    '@monthly': tf('cron_monthly', '1', '00:00'),
    '@hourly': t('cron_hourly'),
  };
  if (al[expr]) return al[expr];
  var p = (expr || '').split(' ');
  if (p.length !== 5) return expr;
  var m = p[0], h = p[1], dom = p[2], mon = p[3], dow = p[4];
  var pad = function (n) { return ('0' + n).slice(-2); };
  if (dom === '*' && mon === '*') {
    if (dow === '*') {
      if (h === '*') return tf('cron_hourly_min', m);
      if (h.indexOf('/') === 1) return tf('cron_every_n_h', h.slice(2));
      return tf('cron_daily', pad(h) + ':' + pad(m));
    }
    return tf('cron_weekly', (dayKeys[parseInt(dow)] || dow), pad(h) + ':' + pad(m));
  }
  if (dom !== '*' && mon === '*' && dow === '*') return tf('cron_monthly', dom, pad(h) + ':' + pad(m));
  return expr;
}

function updateSchedCron() {
  var freq = document.getElementById('sched_freq').value;
  var timeEl = document.getElementById('sched_time');
  var parts = (timeEl.value || '02:00').split(':');
  var h = parseInt(parts[0]) || 0, m = parseInt(parts[1]) || 0;
  document.getElementById('sched_time_group').style.display = freq === 'interval' ? 'none' : '';
  document.getElementById('sched_dow_group').style.display = freq === 'weekly' ? '' : 'none';
  document.getElementById('sched_dom_group').style.display = freq === 'monthly' ? '' : 'none';
  document.getElementById('sched_interval_group').style.display = freq === 'interval' ? '' : 'none';
  var cron;
  if (freq === 'hourly') cron = m + ' * * * *';
  else if (freq === 'daily') cron = m + ' ' + h + ' * * *';
  else if (freq === 'weekly') cron = m + ' ' + h + ' * * ' + document.getElementById('sched_dow').value;
  else if (freq === 'monthly') cron = m + ' ' + h + ' ' + document.getElementById('sched_dom').value + ' * *';
  else cron = '0 */' + document.getElementById('sched_interval_val').value + ' * * *';
  document.getElementById('sched_cron').value = cron;
  document.getElementById('sched_cron_human').textContent = cronHuman(cron);
  schedUpdateNextRuns();
}

function _computeNextRunsFromCron(cron, count) {
  var pts = (cron || '').trim().split(/\s+/);
  if (pts.length !== 5) return [];
  var pMin = pts[0], pHour = pts[1], pDom = pts[2], pDow = pts[4];
  var results = [], lim = 0, now = new Date();
  if (pHour === '*') {
    var m = parseInt(pMin), d = new Date(now);
    d.setSeconds(0); d.setMilliseconds(0); d.setMinutes(m);
    if (d <= now) d.setHours(d.getHours() + 1);
    while (results.length < count && lim++ < 300) { results.push(new Date(d)); d = new Date(d); d.setHours(d.getHours() + 1); }
  } else if (pHour.indexOf('/') !== -1) {
    var step = parseInt(pHour.split('/')[1]), d = new Date(now);
    d.setSeconds(0); d.setMilliseconds(0); d.setMinutes(0); d.setHours(d.getHours() + 1);
    while (d.getHours() % step !== 0) d.setHours(d.getHours() + 1);
    while (results.length < count && lim++ < 300) { results.push(new Date(d)); d = new Date(d); d.setHours(d.getHours() + step); }
  } else {
    var h = parseInt(pHour), m2 = parseInt(pMin);
    if (pDow !== '*') {
      var dow = parseInt(pDow), d = new Date(now);
      d.setHours(h); d.setMinutes(m2); d.setSeconds(0); d.setMilliseconds(0);
      if (d <= now) d.setDate(d.getDate() + 1);
      while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
      while (results.length < count && lim++ < 300) { results.push(new Date(d)); d = new Date(d); d.setDate(d.getDate() + 7); }
    } else if (pDom !== '*') {
      var dom = parseInt(pDom), d = new Date(now);
      d.setDate(dom); d.setHours(h); d.setMinutes(m2); d.setSeconds(0); d.setMilliseconds(0);
      if (d <= now) { d.setMonth(d.getMonth() + 1); d.setDate(dom); }
      while (results.length < count && lim++ < 300) { results.push(new Date(d)); d = new Date(d); d.setMonth(d.getMonth() + 1); d.setDate(dom); }
    } else {
      var d = new Date(now);
      d.setHours(h); d.setMinutes(m2); d.setSeconds(0); d.setMilliseconds(0);
      if (d <= now) d.setDate(d.getDate() + 1);
      while (results.length < count && lim++ < 300) { results.push(new Date(d)); d = new Date(d); d.setDate(d.getDate() + 1); }
    }
  }
  return results;
}

function _schedNextRuns(count) {
  var cron = (document.getElementById('sched_cron') || {}).value || '';
  return _computeNextRunsFromCron(cron, count);
}

function schedUpdateNextRuns() {
  var panel = document.getElementById('sched_next_runs');
  if (!panel) return;
  var runs = _schedNextRuns(10);
  if (!runs.length) { panel.innerHTML = '<span style="opacity:.5">—</span>'; return; }
  panel.innerHTML = runs.map(function (d, i) {
    var fmt = d.toLocaleString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return '<div style="display:flex;align-items:center;gap:10px;padding:4px 8px;border-bottom:1px solid var(--border)'
      + (i === 0 ? ';background:rgba(var(--accent-rgb,200,120,40),.06)' : '') + '">'
      + '<span style="font-family:monospace;font-size:11px;min-width:18px;text-align:right;opacity:.35">' + (i + 1) + '</span>'
      + '<span style="font-size:12px' + (i === 0 ? ';font-weight:600' : ';opacity:.7') + '">' + esc(fmt) + '</span>'
      + '</div>';
  }).join('');
}

function schedRetentionWarn() {
  var warnDiv = document.getElementById('sched_retention_warn');
  var warnMsg = document.getElementById('sched_retention_warn_msg');
  if (!warnDiv || !warnMsg) return;
  var newRet = parseInt((document.getElementById('sched_retention') || {}).value) || 0;
  var editId = (document.getElementById('sched_edit_id') || {}).value || '';
  var mid = (document.getElementById('sched_mapping') || {}).value || '';
  if (!editId || !newRet || !mid) { warnDiv.style.display = 'none'; return; }
  var existing = _schedulesCache.find(function (s) { return s.id === editId; });
  var oldRet = existing ? (parseInt(existing.retention_count) || 0) : 0;
  var snapCount = _allSnapshots.filter(function (s) {
    return s.mapping_id === mid && s.status === 'done';
  }).length;
  var excess = snapCount - newRet;
  if (excess > 0) {
    warnDiv.style.display = 'flex';
    warnMsg.textContent = excess + ' existing snapshot' + (excess !== 1 ? 's' : '')
      + ' exceed' + (excess === 1 ? 's' : '') + ' the new retention limit and will be purged on the next scheduled run.';
  } else {
    warnDiv.style.display = 'none';
  }
}

// ── Timeline Ribbon ────────────────────────────────────────────────────────
var _tlZoom = 'month';
var _tlSnapMap = {};
var _tlLastFiltered = [];

function tlSetZoom(z) {
  _tlZoom = z;
  document.querySelectorAll('#tl_zoom_btns button').forEach(function (b) {
    var active = b.getAttribute('data-zoom') === z;
    b.className = 'btn btn-sm ' + (active ? 'btn-primary' : 'btn-ghost');
  });
  renderTimeline(_tlLastFiltered);
}

function renderTimeline(filtered) {
  _tlLastFiltered = filtered;
  var container = document.getElementById('snap_timeline');
  if (!container) return;
  var W = container.getBoundingClientRect().width;
  if (W < 80) { requestAnimationFrame(function () { renderTimeline(filtered); }); return; }

  var padL = 10, padR = 10, padT = 8, axisY = 52, H = 72;
  var plotW = W - padL - padR;

  var now = Date.now();
  var zoomMs = { day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };
  var futureMs = { day: 864e5 / 4, week: 864e5, month: 864e5 * 7, year: 864e5 * 45 };
  var tStart = now - (zoomMs[_tlZoom] || 2592e6);
  var tEnd = now + (futureMs[_tlZoom] || 864e5 * 7);

  function toX(ts) { return padL + (ts - tStart) / (tEnd - tStart) * plotW; }

  var svgParts = [];

  // Axis line
  svgParts.push('<line x1="' + padL + '" y1="' + axisY + '" x2="' + (padL + plotW) + '" y2="' + axisY + '" stroke="var(--border)" stroke-width="1"/>');

  // Tick marks + labels
  var tickSteps = { day: 6 * 3600e3, week: 864e5, month: 5 * 864e5, year: 60 * 864e5 };
  var tickStep = tickSteps[_tlZoom] || 5 * 864e5;
  var firstTick = Math.ceil(tStart / tickStep) * tickStep;
  for (var tk = firstTick; tk <= tEnd; tk += tickStep) {
    var tx = toX(tk);
    if (tx < padL || tx > padL + plotW) continue;
    var txS = tx.toFixed(1);
    var td = new Date(tk);
    var lbl = _tlZoom === 'day'
      ? td.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : td.toLocaleDateString([], { month: 'short', day: 'numeric' });
    svgParts.push('<line x1="' + txS + '" y1="' + axisY + '" x2="' + txS + '" y2="' + (axisY + 4) + '" stroke="var(--border)" stroke-width="1"/>');
    svgParts.push('<text x="' + txS + '" y="' + (axisY + 14) + '" text-anchor="middle" font-size="9" fill="var(--muted)" font-family="sans-serif">' + esc(lbl) + '</text>');
  }

  // "Now" marker
  var nowX = toX(now);
  if (nowX >= padL && nowX <= padL + plotW) {
    var nowXS = nowX.toFixed(1);
    svgParts.push('<line x1="' + nowXS + '" y1="' + padT + '" x2="' + nowXS + '" y2="' + (axisY + 4) + '" stroke="var(--accent,#e07800)" stroke-width="1.5" stroke-dasharray="3,3"/>');
    svgParts.push('<text x="' + nowXS + '" y="' + (axisY + 14) + '" text-anchor="middle" font-size="9" fill="var(--accent,#e07800)" font-weight="600" font-family="sans-serif">now</text>');
  }

  // Retention band + future dots (single datastore filter only)
  var dsFilter = (document.getElementById('snap_filter_datastore') || {}).value || '';
  var matchSched = null;
  if (dsFilter && _schedulesCache && _schedulesCache.length) {
    var samp = _allSnapshots.find(function (s) { return (s.pve_storage_id || s.volume_name) === dsFilter; });
    if (samp && samp.mapping_id) {
      matchSched = _schedulesCache.find(function (sc) { return sc.mapping_id === samp.mapping_id; });
    }
  }

  var doneSnaps = filtered.filter(function (s) { return s.status === 'done' && s.created_at; });
  doneSnaps.sort(function (a, b) { return Date.parse(a.created_at) - Date.parse(b.created_at); });

  if (matchSched) {
    var ret = parseInt(matchSched.retention_count) || 7;
    var oldest = doneSnaps.length >= ret
      ? Date.parse(doneSnaps[doneSnaps.length - ret].created_at)
      : (doneSnaps.length ? Date.parse(doneSnaps[0].created_at) : tStart);
    var bx1 = Math.max(toX(oldest), padL);
    var bx2 = Math.min(toX(now), padL + plotW);
    if (bx2 > bx1) {
      svgParts.push('<rect x="' + bx1.toFixed(1) + '" y="' + padT + '" width="' + (bx2 - bx1).toFixed(1) + '" height="' + (axisY - padT + 3) + '" fill="rgba(34,197,94,.1)" rx="2"/>');
      svgParts.push('<text x="' + ((bx1 + bx2) / 2).toFixed(1) + '" y="' + (padT + 9) + '" text-anchor="middle" font-size="9" fill="rgba(34,197,94,.7)" font-family="sans-serif">retention</text>');
    }
    // Future scheduled triangles
    if (matchSched.cron_expr) {
      var futureRuns = _computeNextRunsFromCron(matchSched.cron_expr, 10);
      futureRuns.forEach(function (fd) {
        var fts = fd.getTime();
        if (fts > tEnd) return;
        var fx = toX(fts);
        if (fx < padL || fx > padL + plotW) return;
        var fxS = fx.toFixed(1), fy = axisY - 12, s = 5;
        var fmtFd = fd.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        svgParts.push('<polygon points="' + fxS + ',' + (fy - s) + ' ' + (fx - s).toFixed(1) + ',' + (fy + s) + ' ' + (fx + s).toFixed(1) + ',' + (fy + s) + '" fill="none" stroke="var(--accent,#e07800)" stroke-width="1.5" opacity="0.5"/>');
        svgParts.push('<rect x="' + (fx - 8).toFixed(1) + '" y="' + (fy - s - 2) + '" width="16" height="' + (s * 2 + 4) + '" fill="transparent" onmouseenter="tlHoverFuture(\'' + esc(fmtFd) + '\',event)" onmouseleave="tlUnhover()" style="cursor:default"/>');
      });
    }
  }

  // Snapshot dots
  _tlSnapMap = {};
  var dotsHtml = [];
  var leftClipped = 0;
  doneSnaps.forEach(function (s) {
    var ts = Date.parse(s.created_at);
    if (ts < tStart) { leftClipped++; return; }
    if (ts > now) return;
    var x = toX(ts);
    if (x < padL - 4 || x > padL + plotW + 4) return;
    var isNative = s.source === 'ontap_native';
    var key = isNative
      ? ('n_' + (s.ontap_snap_uuid || '') + '_' + (s.mapping_id || ''))
      : ('p_' + String(s.id));
    _tlSnapMap[key] = s;
    var cx = x.toFixed(1), cy = (axisY - 12).toFixed(1);
    var fill = isNative ? 'var(--muted)' : 'var(--accent,#e07800)';
    dotsHtml.push(
      '<circle cx="' + cx + '" cy="' + cy + '" r="4.5"'
      + ' fill="' + fill + '" stroke="var(--bg-card,#fff)" stroke-width="1.5"'
      + ' onmouseenter="tlHoverKey(\'' + key + '\',event)"'
      + ' onmouseleave="tlUnhover()"'
      + ' onclick="tlClick(\'' + key + '\')"'
      + ' style="cursor:pointer"/>'
    );
  });

  // Overflow indicator
  if (leftClipped > 0) {
    svgParts.push('<text x="' + (padL + 2) + '" y="' + (axisY - 14) + '" font-size="9" fill="var(--muted)" font-family="sans-serif">+' + leftClipped + ' earlier</text>');
  }
  if (!doneSnaps.length) {
    svgParts.push('<text x="' + (padL + plotW / 2).toFixed(1) + '" y="' + (axisY - 14) + '" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="sans-serif">No snapshots in this range</text>');
  }

  svgParts.push(dotsHtml.join(''));
  container.innerHTML = '<svg width="' + W + '" height="' + H + '" style="display:block;overflow:visible">'
    + svgParts.join('') + '</svg>';
}

function tlHoverKey(key, evt) {
  var s = _tlSnapMap[key];
  if (!s) return;
  var tt = document.getElementById('tlTooltip');
  if (!tt) return;
  var isNative = s.source === 'ontap_native';
  var vmHtml = (!isNative && s.vmids && s.vmids.length)
    ? '<div style="margin-top:3px;color:#94a3b8">VMs: ' + s.vmids.map(String).join(', ') + '</div>'
    : '';
  tt.innerHTML = '<div style="font-weight:600;font-family:monospace;font-size:11px;word-break:break-all">' + esc(s.snap_name) + '</div>'
    + '<div style="color:#94a3b8;margin-top:2px">' + esc(s.pve_storage_id || s.volume_name || '') + '</div>'
    + '<div style="margin-top:2px">' + fmtDateRel(s.created_at) + '</div>'
    + (isNative ? '<div style="color:#94a3b8;font-size:11px;margin-top:2px">ONTAP native</div>' : '')
    + vmHtml;
  _tlPositionTooltip(evt);
}

function tlHoverFuture(dateStr, evt) {
  var tt = document.getElementById('tlTooltip');
  if (!tt) return;
  tt.innerHTML = '<div style="font-size:11px;color:#94a3b8">Scheduled</div>'
    + '<div style="font-weight:600;font-size:12px;margin-top:2px">' + esc(dateStr) + '</div>';
  _tlPositionTooltip(evt);
}

function _tlPositionTooltip(evt) {
  var tt = document.getElementById('tlTooltip');
  if (!tt) return;
  tt.style.display = 'block';
  var x = evt.clientX + 14, y = evt.clientY - 10;
  var tw = tt.offsetWidth || 200, th = tt.offsetHeight || 80;
  if (x + tw > window.innerWidth - 8) x = evt.clientX - tw - 14;
  if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
  tt.style.left = x + 'px';
  tt.style.top = y + 'px';
}

function tlUnhover() {
  var tt = document.getElementById('tlTooltip');
  if (tt) tt.style.display = 'none';
}

function tlClick(key) {
  var idx = _vsAllFiltered.findIndex(function (s) {
    var isNative = s.source === 'ontap_native';
    var k = isNative
      ? ('n_' + (s.ontap_snap_uuid || '') + '_' + (s.mapping_id || ''))
      : ('p_' + String(s.id || ''));
    return k === key;
  });
  if (idx < 0) return;
  var sc = document.getElementById('snapTableScroller');
  if (sc && _vsAllFiltered.length > _VS_THRESHOLD) {
    sc.scrollTop = Math.max(0, idx * _vsRowH - sc.clientHeight / 2);
    setTimeout(function () {
      _vsRenderRows();
      var tr = document.querySelector('tr[data-snap-key="' + key + '"]');
      if (tr) { tr.classList.add('tl-highlight'); setTimeout(function () { tr.classList.remove('tl-highlight'); }, 2000); }
    }, 40);
  } else {
    var tr = document.querySelector('tr[data-snap-key="' + key + '"]');
    if (!tr) return;
    tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    tr.classList.add('tl-highlight');
    setTimeout(function () { tr.classList.remove('tl-highlight'); }, 2000);
  }
}

async function loadVmsForSchedule(mappingId, preselect) {
  var sel = document.getElementById('sched_vmids_select');
  if (!mappingId) { sel.innerHTML = '<option disabled>' + t('hint_select_mapping') + '</option>'; return; }
  sel.innerHTML = '<option disabled>' + t('hint_loading') + '</option>';
  try {
    var d = await apiFetch('snapshots/vms-for-mapping?mapping_id=' + encodeURIComponent(mappingId));
    var vms = d.vms || [];
    if (!vms.length) { sel.innerHTML = '<option disabled>' + t('hint_no_vms') + '</option>'; return; }
    var preselectIds = (preselect && preselect.length) ? preselect.map(String) : null;
    sel.innerHTML = vms.map(function (v) {
      var isSelected = preselectIds ? preselectIds.indexOf(String(v.vmid)) !== -1 : true;
      return '<option value="' + v.vmid + '"' + (isSelected ? ' selected' : '') + '>' + v.vmid + ' – ' + esc(v.name || '') + (v.node ? ' (' + esc(v.node) + ')' : '') + '</option>';
    }).join('');
  } catch (e) { sel.innerHTML = '<option disabled>' + esc(e.message) + '</option>'; }
}

function schedSelectAll() { var s = document.getElementById('sched_vmids_select'); for (var i = 0; i < s.options.length; i++) s.options[i].selected = true; }
function schedSelectNone() { var s = document.getElementById('sched_vmids_select'); for (var i = 0; i < s.options.length; i++) s.options[i].selected = false; }

async function showAddScheduleForm() {
  var domSel = document.getElementById('sched_dom');
  if (!domSel.options.length) {
    for (var d = 1; d <= 28; d++) domSel.add(new Option(d + '.', d, d === 1, d === 1));
  }
  document.getElementById('sched_edit_id').value = '';
  document.getElementById('sched_form_title').textContent = t('ct_new_schedule');
  document.getElementById('sched_name').value = '';
  document.getElementById('sched_retention').value = 7;
  var _rw = document.getElementById('sched_retention_warn'); if (_rw) _rw.style.display = 'none';
  document.getElementById('sched_consistency').value = 'crash';
  document.getElementById('sched_pre_script').value = '';
  document.getElementById('sched_post_script').value = '';
  _schedWizHasSM = false;
  if (document.getElementById('sched_sm_update')) document.getElementById('sched_sm_update').checked = false;
  if (document.getElementById('sched_sync_vmids')) {
    document.getElementById('sched_sync_vmids').checked = false;
    document.getElementById('sched_vmids_manual').style.display = 'block';
  }
  if (document.getElementById('sched_notify_enabled')) {
    document.getElementById('sched_notify_enabled').checked = false;
    document.getElementById('sched_notify_on').value = 'all';
    document.getElementById('sched_notify_recipients').value = '';
    document.getElementById('sched_notify_fields').style.display = 'none';
  }
  document.getElementById('sched_freq').value = 'daily';
  document.getElementById('sched_time').value = '02:00';
  document.getElementById('schedWizSaveBtn').textContent = t('sched_save');
  updateSchedCron();
  document.getElementById('addScheduleForm').style.display = '';
  document.body.style.overflow = 'hidden';
  schedWizShowStep(1);
  await populateMappingSelect('sched_mapping');
  var mid = document.getElementById('sched_mapping').value;
  if (mid) {
    await loadVmsForSchedule(mid);
    await updateSchedSMSection(mid, '');
  }
}

function editSchedule(id) {
  var s = _schedulesCache.find(function (x) { return x.id === id; });
  if (!s) { toast(t('empty_schedules'), 'error'); return; }
  showEditScheduleForm(s);
}

async function showEditScheduleForm(s) {
  var domSel = document.getElementById('sched_dom');
  if (!domSel.options.length) {
    for (var d = 1; d <= 28; d++) domSel.add(new Option(d + '.', d, d === 1, d === 1));
  }
  document.getElementById('sched_edit_id').value = s.id;
  document.getElementById('sched_form_title').textContent = t('ct_edit_schedule');
  document.getElementById('sched_name').value = s.name || '';
  document.getElementById('sched_retention').value = s.retention_count || 7;
  schedRetentionWarn();
  document.getElementById('sched_consistency').value = s.consistency || 'crash';
  document.getElementById('sched_pre_script').value = s.pre_script || '';
  document.getElementById('sched_post_script').value = s.post_script || '';
  _schedWizHasSM = false;
  if (document.getElementById('sched_sm_update')) document.getElementById('sched_sm_update').checked = !!s.snapmirror_update;
  if (document.getElementById('sched_sync_vmids')) {
    document.getElementById('sched_sync_vmids').checked = !!s.sync_vmids;
    document.getElementById('sched_vmids_manual').style.display = s.sync_vmids ? 'none' : 'block';
  }
  if (document.getElementById('sched_notify_enabled')) {
    var notifyOn = !!s.notify_enabled;
    document.getElementById('sched_notify_enabled').checked = notifyOn;
    document.getElementById('sched_notify_on').value = s.notify_on || 'all';
    document.getElementById('sched_notify_recipients').value = s.notify_recipients || '';
    document.getElementById('sched_notify_fields').style.display = notifyOn ? 'flex' : 'none';
  }
  parseCronToForm(s.cron_expr);
  document.getElementById('schedWizSaveBtn').textContent = t('sched_update');
  document.getElementById('addScheduleForm').style.display = '';
  document.body.style.overflow = 'hidden';
  schedWizShowStep(1);
  await populateMappingSelect('sched_mapping');
  document.getElementById('sched_mapping').value = s.mapping_id;
  if (s.mapping_id) {
    await loadVmsForSchedule(s.mapping_id, s.vmids || []);
    await updateSchedSMSection(s.mapping_id, s.label || '');
  }
}

function parseCronToForm(expr) {
  var p = (expr || '').split(' ');
  if (p.length !== 5) return;
  var m = p[0], h = p[1], dom = p[2], mon = p[3], dow = p[4];
  var freq, hv = 0, mv = parseInt(m) || 0;
  var pad = function (n) { return ('0' + n).slice(-2); };
  if (h === '*') {
    freq = 'hourly';
  } else if (h.indexOf('/') === 1) {
    freq = 'interval';
    document.getElementById('sched_interval_val').value = h.slice(2);
  } else if (dow !== '*') {
    freq = 'weekly';
    document.getElementById('sched_dow').value = dow;
    hv = parseInt(h) || 0;
  } else if (dom !== '*') {
    freq = 'monthly';
    document.getElementById('sched_dom').value = dom;
    hv = parseInt(h) || 0;
  } else {
    freq = 'daily';
    hv = parseInt(h) || 0;
  }
  document.getElementById('sched_freq').value = freq;
  if (freq !== 'interval') {
    document.getElementById('sched_time').value = pad(hv) + ':' + pad(mv);
  }
  updateSchedCron();
}

async function saveSchedule() {
  // Re-validate step 1 in case the user bypassed it
  var name = (document.getElementById('sched_name').value || '').trim();
  var mid = document.getElementById('sched_mapping').value;
  if (!name || !mid) {
    schedWizShowStep(1);
    toast(t('msg_fill_required'), 'error');
    return;
  }
  var editId = document.getElementById('sched_edit_id').value;
  var btn = document.getElementById('schedWizSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    if (editId) { await updateSchedule(editId); } else { await addSchedule(); }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = editId ? t('sched_update') : t('sched_save'); }
  }
}

function _schedNotifyPayload() {
  return {
    notify_enabled: !!(document.getElementById('sched_notify_enabled') && document.getElementById('sched_notify_enabled').checked),
    notify_on: (document.getElementById('sched_notify_on') || { value: 'all' }).value,
    notify_recipients: ((document.getElementById('sched_notify_recipients') || { value: '' }).value || '').trim(),
  };
}

function toggleNotifyFields() {
  var on = document.getElementById('sched_notify_enabled').checked;
  document.getElementById('sched_notify_fields').style.display = on ? 'flex' : 'none';
}

// ── Schedule Wizard ───────────────────────────────────────────────────────────

function schedWizUpdateSMPill() {
  var pill = document.getElementById('swpill4');
  if (!pill) return;
  if (_schedWizHasSM) {
    pill.style.opacity = '';
    pill.style.cursor = '';
    pill.style.pointerEvents = '';
    pill.title = '';
  } else {
    pill.style.opacity = '0.4';
    pill.style.cursor = 'not-allowed';
    pill.style.pointerEvents = 'none';
    pill.title = 'No SnapMirror relationship for this datastore';
  }
}

function schedWizShowStep(n) {
  _schedWizStep = n;
  for (var i = 1; i <= 6; i++) {
    var card = document.getElementById('schedStep' + i);
    var pill = document.getElementById('swpill' + i);
    if (card) card.style.display = (i === n) ? '' : 'none';
    if (pill) {
      pill.classList.remove('active', 'done');
      if (i === n) pill.classList.add('active');
      else if (i < n) pill.classList.add('done');
    }
  }
  if (n === 2) schedUpdateNextRuns();
  if (n === 6) schedWizUpdateSummary();
  schedWizUpdateSMPill();
}

function schedWizGoStep(n) {
  if (n === 4 && !_schedWizHasSM) return;
  // Pills only navigate backward (already-visited steps).
  // Forward navigation goes through schedWizNext() which validates each step.
  if (n > _schedWizStep) return;
  schedWizShowStep(n);
}

function schedWizNext() {
  var next = _schedWizStep + 1;
  if (_schedWizStep === 1) {
    var name = (document.getElementById('sched_name').value || '').trim();
    var mid = document.getElementById('sched_mapping').value;
    if (!name || !mid) { toast(t('msg_fill_required'), 'error'); return; }
  }
  if (_schedWizStep === 3 && !_schedWizHasSM) next = 5;
  if (next > 6) { saveSchedule(); return; }
  schedWizShowStep(next);
}

function schedWizPrev() {
  var prev = _schedWizStep - 1;
  if (_schedWizStep === 5 && !_schedWizHasSM) prev = 3;
  if (prev < 1) return;
  schedWizShowStep(prev);
}

function schedWizUpdateSummary() {
  var name = document.getElementById('sched_name').value || '—';
  var mappingSel = document.getElementById('sched_mapping');
  var mappingText = mappingSel.options[mappingSel.selectedIndex] ? mappingSel.options[mappingSel.selectedIndex].text : '—';
  var cronHuman = document.getElementById('sched_cron_human').textContent || '—';
  var retention = document.getElementById('sched_retention').value || '7';
  var consistencyVal = document.getElementById('sched_consistency').value;
  var consistency = consistencyVal === 'app' ? 'App-consistent (QEMU Guest Agent)' : 'Crash-consistent';
  var syncVmids = document.getElementById('sched_sync_vmids').checked;
  var vmSel = document.getElementById('sched_vmids_select');
  var selectedVmNames = Array.from(vmSel.selectedOptions).map(function (o) { return o.text; });
  var vmsText = syncVmids ? 'All (auto-sync)' : (selectedVmNames.length ? selectedVmNames.join(', ') : 'All');
  var preScript = (document.getElementById('sched_pre_script').value || '').trim();
  var postScript = (document.getElementById('sched_post_script').value || '').trim();
  var notifyEnabled = document.getElementById('sched_notify_enabled').checked;
  var notifyOn = document.getElementById('sched_notify_on').value;
  var notifyMap = { all: 'All events', failed: 'Failures only', success: 'Success only' };
  var notifyRecipients = (document.getElementById('sched_notify_recipients').value || '').trim();

  function row(label, valueHtml) {
    return '<tr style="border-bottom:1px solid var(--border)">'
      + '<td style="padding:8px 12px 8px 0;font-size:12px;font-weight:600;color:var(--muted);white-space:nowrap;vertical-align:top;width:150px">' + esc(label) + '</td>'
      + '<td style="padding:8px 0;font-size:13px;color:var(--text)">' + valueHtml + '</td>'
      + '</tr>';
  }

  var html = '<table style="width:100%;border-collapse:collapse">';
  html += row('Name', esc(name));
  html += row('Datastore', esc(mappingText));
  html += row('Schedule', esc(cronHuman));
  html += row('Retention', esc(retention) + ' snapshots');
  html += row('Consistency', esc(consistency));
  html += row('VMs', esc(vmsText));
  if (preScript) html += row('Pre-Script', '<code style="font-size:11px;word-break:break-all">' + esc(preScript) + '</code>');
  if (postScript) html += row('Post-Script', '<code style="font-size:11px;word-break:break-all">' + esc(postScript) + '</code>');
  if (_schedWizHasSM) {
    html += row('SnapMirror', document.getElementById('sched_sm_info').innerHTML || '<span style="opacity:.5">—</span>');
    var smLabel = document.getElementById('sched_label').value || '— no label —';
    html += row('SM Label', esc(smLabel));
    var smUpdate = document.getElementById('sched_sm_update').checked;
    html += row('SM Update', smUpdate ? '<span style="color:var(--success)">✓ Yes — transfer after snapshot</span>' : '<span style="opacity:.5">✗ No</span>');
  } else {
    html += row('SnapMirror', '<span style="opacity:.5">No relationship configured</span>');
  }
  if (notifyEnabled) {
    html += row('Notifications', esc(notifyMap[notifyOn] || notifyOn) + (notifyRecipients ? ' → <span style="font-family:monospace;font-size:12px">' + esc(notifyRecipients) + '</span>' : ''));
  } else {
    html += row('Notifications', '<span style="opacity:.5">Disabled</span>');
  }
  html += '</table>';
  document.getElementById('schedWizSummary').innerHTML = html;
}

function toggleSchedSyncVmids() {
  var on = document.getElementById('sched_sync_vmids').checked;
  document.getElementById('sched_vmids_manual').style.display = on ? 'none' : 'block';
}

async function testScheduleNotification() {
  var recipients = document.getElementById('sched_notify_recipients').value.trim();
  if (!recipients) { toast(t('msg_notify_no_recipients'), 'error'); return; }
  try {
    await apiPost('settings/notify-test', { recipients });
    toast(t('msg_notify_test_sent'), 'success');
  } catch (e) { toast(e.message, 'error', e.detail); }
}

async function updateSchedule(id) {
  var name = document.getElementById('sched_name').value.trim();
  var mapping_id = document.getElementById('sched_mapping').value;
  var cron_expr = document.getElementById('sched_cron').value.trim();
  var retention_count = parseInt(document.getElementById('sched_retention').value) || 7;
  var consistency = document.getElementById('sched_consistency').value;
  var label = document.getElementById('sched_label').value.trim();
  var pre_script = document.getElementById('sched_pre_script').value;
  var post_script = document.getElementById('sched_post_script').value;
  var snapmirror_update = !!(document.getElementById('sched_sm_update') && document.getElementById('sched_sm_update').checked);
  var sync_vmids = !!(document.getElementById('sched_sync_vmids') && document.getElementById('sched_sync_vmids').checked);
  var sel = document.getElementById('sched_vmids_select');
  var vmids = sync_vmids ? [] : Array.from(sel.selectedOptions).map(function (o) { return parseInt(o.value); }).filter(function (v) { return !isNaN(v); });
  if (!name || !mapping_id || !cron_expr) { toast(t('msg_fill_required'), 'error'); return; }
  try {
    await apiPost('schedules/update', Object.assign({ id, name, mapping_id, vmids, cron_expr, retention_count, consistency, label, pre_script, post_script, snapmirror_update, sync_vmids }, _schedNotifyPayload()));
    toast(t('msg_sched_updated'), 'success');
    hideForm('addScheduleForm');
    var _c = document.querySelector('.content'); if (_c) _c.scrollTop = 0;
    loadSchedules();
  } catch (e) { toast(e.message, 'error'); }
}

async function addSchedule() {
  var name = document.getElementById('sched_name').value.trim();
  var mapping_id = document.getElementById('sched_mapping').value;
  var cron_expr = document.getElementById('sched_cron').value.trim();
  var retention_count = parseInt(document.getElementById('sched_retention').value) || 7;
  var consistency = document.getElementById('sched_consistency').value;
  var label = document.getElementById('sched_label').value.trim();
  var pre_script = document.getElementById('sched_pre_script').value;
  var post_script = document.getElementById('sched_post_script').value;
  var snapmirror_update = !!(document.getElementById('sched_sm_update') && document.getElementById('sched_sm_update').checked);
  var sync_vmids = !!(document.getElementById('sched_sync_vmids') && document.getElementById('sched_sync_vmids').checked);
  var sel = document.getElementById('sched_vmids_select');
  var vmids = sync_vmids ? [] : Array.from(sel.selectedOptions).map(function (o) { return parseInt(o.value); }).filter(function (v) { return !isNaN(v); });
  if (!name || !mapping_id || !cron_expr) { toast(t('msg_fill_required'), 'error'); return; }
  try {
    await apiPost('schedules/add', Object.assign({ name, mapping_id, vmids, cron_expr, retention_count, consistency, label, pre_script, post_script, snapmirror_update, sync_vmids }, _schedNotifyPayload()));
    toast(t('msg_sched_saved'), 'success');
    hideForm('addScheduleForm');
    var _c = document.querySelector('.content'); if (_c) _c.scrollTop = 0;
    loadSchedules();
  } catch (e) { toast(e.message, 'error'); }
}

async function toggleSchedule(id, enabled) {
  try {
    await apiPost('schedules/update', { id: id, enabled: enabled ? 0 : 1 });
    toast(enabled ? t('msg_sched_disabled') : t('msg_sched_enabled'), 'success');
    loadSchedules();
  } catch (e) { toast(e.message, 'error'); }
}

async function runNow(id, name) {
  if (!await uiConfirm(tf('confirm_run_now', name), 'Run Now', 'btn-primary')) return;
  try {
    await apiPost('schedules/run-now', { id: id });
    toast(t('msg_sched_running'), 'success');
    setTimeout(loadAllJobs, 1500);
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteSchedule(id, name) {
  if (!await uiConfirm(tf('confirm_delete_sched', name))) return;
  try {
    await apiPost('schedules/delete', { id: id });
    toast(t('msg_sched_deleted'), 'success');
    loadSchedules();
  } catch (e) { toast(e.message, 'error'); }
}

// ═══════════════════════════ JOBS & RESTORE ═══════════════════════════════

// Returns true if a snapshot belongs to a SAN (iSCSI/NVMe) datastore.
// manifest_path is checked first — it's definitive and overrides a stale
// storage_protocol='nfs' default that old mappings may carry.
function _snapIsSan(s) {
  var mp = s.manifest_path || '';
  if (mp.startsWith('snapmanifest:') || mp.startsWith('snapmeta:') || mp.startsWith('snapinfo:'))
    return true;
  var proto = (s.storage_protocol || '').toLowerCase();
  if (proto === 'nvme' || proto === 'iscsi') return true;
  if (proto === 'nfs') return false;
  return !!(s.lvm_vg_name);
}

function _snapProtoLabel(s) {
  var proto = (s.storage_protocol || '').toLowerCase();
  if (proto) return proto.toUpperCase();
  return _snapIsSan(s) ? 'SAN' : 'NFS';
}

async function loadSnapshotsForRestore() {
  try { _allSnapshots = await apiFetch('snapshots'); } catch (e) { }
  var done = _allSnapshots.filter(function (s) { return s.status === 'done'; });

  var datastores = {};
  done.forEach(function (s) {
    var key = s.mapping_id;
    if (!datastores[key]) {
      var proto = _snapProtoLabel(s);
      var asaTag = (s.san_optimized && _snapIsSan(s)) ? ' ASA' : '';
      datastores[key] = {
        mapping_id: key,
        label: (s.pve_storage_id || s.volume_name || key) + ' [' + proto + asaTag + ']',
        isSan: _snapIsSan(s),
      };
    }
  });

  var dsSel = document.getElementById('restore_datastore');
  var cur = dsSel.value;
  dsSel.innerHTML = '<option value="">— Select datastore —</option>' +
    Object.values(datastores).map(function (d) {
      return '<option value="' + esc(d.mapping_id) + '">' + esc(d.label) + '</option>';
    }).join('');
  if (cur && datastores[cur]) {
    dsSel.value = cur;
    onRestoreDatastoreChange();
  } else {
    document.getElementById('restore_snap').innerHTML = '<option value="">— select datastore first —</option>';
    document.getElementById('restore_snap').disabled = true;
    document.getElementById('restore_vmid').innerHTML = '<option value="">—</option>';
    document.getElementById('restore_vmid').disabled = true;
  }
}

function onRestoreDatastoreChange() {
  var mappingId = document.getElementById('restore_datastore').value;
  var snapSel = document.getElementById('restore_snap');
  var vmSel = document.getElementById('restore_vmid');

  if (!mappingId) {
    snapSel.innerHTML = '<option value="">— select datastore first —</option>';
    snapSel.disabled = true;
    vmSel.innerHTML = '<option value="">—</option>';
    vmSel.disabled = true;
    document.getElementById('restore_method_hint').style.display = 'none';
    return;
  }

  var done = _allSnapshots.filter(function (s) {
    return s.status === 'done' && s.mapping_id === mappingId;
  });

  // Rebuild method options based on protocol + platform of this datastore
  var sample = done[0] || _allSnapshots.find(function (s) { return s.mapping_id === mappingId; });
  var isSanDs = sample ? _snapIsSan(sample) : false;
  var isNvme = sample ? (sample.storage_protocol || '').toLowerCase() === 'nvme' : false;
  var isAsa = sample ? !!sample.san_optimized : false;
  var canSingleVm = true; // ASA NVMe supported via volume clone CLI bridge

  // Plugin-managed snaps first (they have manifests); ONTAP-native at the end.
  // For SAN datastores, omit ONTAP-native entirely (no accessible manifest).
  var pluginSnaps = done.filter(function (s) { return s.source !== 'ontap_native'; });
  var nativeSnaps = isSanDs ? [] : done.filter(function (s) { return s.source === 'ontap_native'; });
  var sorted = pluginSnaps.concat(nativeSnaps);

  snapSel.innerHTML = sorted.length
    ? sorted.map(function (s) {
      var prefix = s.source === 'ontap_native' ? '[ONTAP] ' : '';
      return '<option value="' + s.id + '">' + prefix + esc(s.snap_name) +
        ' &nbsp;(' + fmtDate(s.created_at) + ')</option>';
    }).join('')
    : '<option value="">— no snapshots —</option>';
  snapSel.disabled = false;
  var methodSel = document.getElementById('restore_method');
  if (isSanDs) {
    methodSel.innerHTML =
      (canSingleVm ? '<option value="san_single">SAN – Single VM restore (LV-copy, target VM only)</option>' : '') +
      '<option value="san">SAN – Volume Revert (all VMs, destructive)</option>';
  } else {
    methodSel.innerHTML =
      '<option value="sfsr">SFSR – in-place (fast)</option>';
  }
  onRestoreMethodChange();
  updateRestoreVmList();
}

function onRestoreMethodChange() {
  var method = document.getElementById('restore_method').value;
  var hint = document.getElementById('restore_method_hint');
  var msgs = {
    san: '⚠ Volume Revert: all VMs on this datastore are rolled back to the snapshot. All data written after the snapshot is permanently lost.',
    san_single: 'LV-Copy: only the selected VM is restored. Other VMs on the same datastore keep running.',
    sfsr: 'SFSR: individual disk images are restored in-place (fast, NFS only).',
  };
  if (msgs[method]) {
    hint.textContent = msgs[method];
    hint.style.display = '';
  } else {
    hint.style.display = 'none';
  }
}

async function updateRestoreVmList() {
  var snapId = document.getElementById('restore_snap').value;
  var snap = _allSnapshots.find(function (s) { return String(s.id) === String(snapId); });
  _selectedRestoreSnap = snap || null;
  var sel = document.getElementById('restore_vmid');
  var txt = document.getElementById('restore_vmid_text');
  var hint = document.getElementById('restore_native_hint');
  var isNative = snap && snap.source === 'ontap_native';

  // Text input only as last fallback (no manifest found)
  txt.style.display = 'none';
  hint.style.display = 'none';
  sel.style.display = '';
  sel.disabled = false;

  if (!snap) { sel.innerHTML = '<option value="">–</option>'; sel.disabled = true; return; }

  if (!isNative) {
    // Plugin snapshot: VMIDs from cached entry
    if (snap.vmids && snap.vmids.length) {
      sel.innerHTML = snap.vmids.map(function (v) {
        var n = (snap.vm_names || {})[String(v)];
        return '<option value="' + v + '">' + v + (n ? ' – ' + esc(n) : '') + '</option>';
      }).join('');
    } else {
      sel.innerHTML = '<option value="">–</option>';
    }
    return;
  }

  // Native snapshot: read manifest on-demand from server
  sel.innerHTML = '<option value="">' + t('hint_loading') + '</option>';
  try {
    var m = await apiFetch(
      'snapshots/manifest?snap_name=' + encodeURIComponent(snap.snap_name) +
      '&mapping_id=' + encodeURIComponent(snap.mapping_id)
    );
    // Merge manifest data into _selectedRestoreSnap (for startRestore)
    _selectedRestoreSnap = Object.assign({}, snap, {
      vmids: m.vmids || [],
      vm_names: m.vm_names || {},
      _manifest_snap_name: m.manifest_snap_name,
    });
    if (m.vmids && m.vmids.length) {
      sel.innerHTML = m.vmids.map(function (v) {
        var n = (m.vm_names || {})[String(v)];
        return '<option value="' + v + '">' + v + (n ? ' – ' + esc(n) : '') + '</option>';
      }).join('');
      if (m.manifest_snap_name && m.manifest_snap_name !== snap.snap_name) {
        hint.textContent = 'Manifest from "' + esc(m.manifest_snap_name) + '" used (most recent ProxmoxVEx snapshot in this ONTAP snapshot).';
        hint.style.display = '';
      }
    } else {
      sel.innerHTML = '<option value="">–</option>';
      txt.style.display = '';
      hint.textContent = t('msg_no_manifest');
      hint.style.display = '';
    }
  } catch (e) {
    sel.innerHTML = '<option value="">–</option>';
    txt.style.display = '';
    hint.textContent = t('msg_no_manifest');
    hint.style.display = '';
  }
}

async function startRestore() {
  var txtVisible = document.getElementById('restore_vmid_text').style.display !== 'none';
  var vmid = txtVisible
    ? parseInt(document.getElementById('restore_vmid_text').value)
    : parseInt(document.getElementById('restore_vmid').value);

  if (!_selectedRestoreSnap) { toast(t('msg_snap_req'), 'error'); return; }
  if (!vmid) { toast(t('msg_vmid_req2'), 'error'); return; }
  showRestoreConfirm();
}

var _allJobsCache = [];
var _jobPage = 0;
var _JOB_PAGE_SIZE = 20;

async function loadAllJobs() {
  try {
    var results = await Promise.all([
      apiFetch('jobs/status').catch(function () { return []; }),
      apiFetch('restore/jobs').catch(function () { return []; })
    ]);
    var combined = results[1].concat(results[0]);
    combined.sort(function (a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });
    // Deduplicate (restore/jobs and jobs/status may contain the same jobs)
    var seen = {};
    _allJobsCache = combined.filter(function (j) {
      if (seen[j.id]) return false;
      seen[j.id] = true;
      return true;
    });
    _jobPage = 0;
    renderJobsPage();
  } catch (e) { toast(e.message, 'error'); }
}

function renderJobsPage() {
  var total = _allJobsCache.length;
  var pages = Math.max(1, Math.ceil(total / _JOB_PAGE_SIZE));
  if (_jobPage >= pages) _jobPage = pages - 1;
  var page = _allJobsCache.slice(_jobPage * _JOB_PAGE_SIZE, (_jobPage + 1) * _JOB_PAGE_SIZE);

  document.getElementById('jobs_page_info').textContent =
    total ? tf('jobs_page', _jobPage + 1, pages, total) : '';
  document.getElementById('jobs_prev').disabled = _jobPage === 0;
  document.getElementById('jobs_next').disabled = _jobPage >= pages - 1;

  var tbody = document.getElementById('jobsBody');
  if (!page.length) {
    tbody.innerHTML = _emptyRow(8, _svgCog, 'No jobs yet', 'Job history appears here after a snapshot, restore, or clone operation runs.', null, null);
    return;
  }
  tbody.innerHTML = page.map(function (j) {
    var logHtml = '';
    if (j.log && j.log.length) {
      var jidEsc = esc(j.id);
      logHtml = '<button class="btn btn-ghost btn-sm" onclick="showJobLog(\'' + jidEsc + '\')">'
        + '<svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:3px"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>'
        + 'Logs (' + j.log.length + ')</button>';
    } else if (j.error) {
      logHtml = '<span style="color:var(--error);font-size:11px">' + esc(j.error) + '</span>';
    } else {
      logHtml = '<span style="color:var(--muted)">–</span>';
    }
    var isActive = j.status === 'running' || j.status === 'cancelling';
    var actionsHtml = isActive
      ? (j.status === 'cancelling'
        ? '<span style="color:var(--muted);font-size:11px">' + t('badge_cancelling') + '…</span>'
        : '<button class="btn btn-warning btn-sm" onclick="cancelJob(\'' + j.id + '\')">' + t('act_cancel_job') + '</button>')
      : '<button class="btn btn-danger btn-sm" onclick="deleteJob(\'' + j.id + '\')">' + t('act_delete') + '</button>';
    return '<tr>' +
      '<td><span class="corp-badge corp-badge-ha">' + esc(j.job_type || '') + '</span></td>' +
      '<td><code style="font-size:12px">' + esc(String(j.vmid || '–')) + '</code></td>' +
      '<td><code style="font-size:12px">' + esc(j.node || '–') + '</code></td>' +
      '<td>' + statusBadge(j.status) + '</td>' +
      '<td style="color:var(--muted)">' + esc(j.created_by || '') + '</td>' +
      '<td style="color:var(--muted)">' + fmtDateRel(j.created_at) + '</td>' +
      '<td>' + logHtml + '</td>' +
      '<td><div class="row-actions">' + actionsHtml + '</div></td></tr>';
  }).join('');
}

function jobChangePage(delta) {
  _jobPage += delta;
  renderJobsPage();
}

async function deleteJob(id) {
  if (!await uiConfirm(t('confirm_delete_job'))) return;
  try {
    await apiPost('jobs/delete', { id: id });
    toast(t('msg_job_deleted'), 'success');
    _allJobsCache = _allJobsCache.filter(function (j) { return j.id !== id; });
    renderJobsPage();
  } catch (e) { toast(e.message, 'error'); }
}

async function cancelJob(id) {
  if (!await uiConfirm(t('confirm_cancel_job'), 'Cancel Job')) return;
  try {
    var r = await apiPost('jobs/cancel', { id: id });
    toast(r.message || t('msg_job_cancelled'), 'success');
    var j = _allJobsCache.find(function (x) { return x.id === id; });
    if (j) j.status = 'cancelling';
    renderJobsPage();
  } catch (e) { toast(e.message, 'error'); }
}

async function cleanupJobs() {
  var count = _allJobsCache.filter(function (j) { return j.status === 'done' || j.status === 'failed'; }).length;
  if (!count) { toast(t('msg_no_done_jobs'), 'error'); return; }
  if (!await uiConfirm(tf('confirm_cleanup', count), 'Clean Up')) return;
  try {
    var d = await apiPost('jobs/cleanup', {});
    toast(tf('msg_jobs_cleaned', d.deleted), 'success');
    loadAllJobs();
  } catch (e) { toast(e.message, 'error'); }
}

var _svgShieldCheck = '<svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>';

var _auditActionLabels = {
  snapshot_delete: 'Delete Snapshot',
  snapshot_delete_native: 'Delete Native Snapshot',
  restore_sfsr: 'Restore (SFSR)',
  restore_flexclone: 'Restore (FlexClone)',
  restore_san: 'Restore (SAN)',
  restore_san_single: 'Restore (SAN Single)',
  restore_dr: 'Restore (DR)'
};

async function loadAuditLog() {
  try {
    var rows = await apiGet('audit/list?limit=200');
    renderAuditLog(Array.isArray(rows) ? rows : []);
  } catch (e) {
    // snyk:ignore:DOM-based Cross-site Scripting (XSS)
    // lgtm[js/xss]
    document.getElementById('auditBody').innerHTML =
      _emptyRow(6, _svgShieldCheck, 'Audit log unavailable', e.message, null, null);
  }
}

function renderAuditLog(rows) {
  var tbody = document.getElementById('auditBody');
  var count = document.getElementById('audit_count');
  if (count) count.textContent = rows.length ? rows.length + ' entries' : '';
  if (!rows.length) {
    tbody.innerHTML = _emptyRow(6, _svgShieldCheck,
      'No audit entries yet',
      'Delete and Restore operations will appear here.',
      null, null);
    return;
  }
  tbody.innerHTML = rows.map(function (r) {
    var label = _auditActionLabels[r.action] || esc(r.action);
    var isOk = r.result === 'success';
    var badge = isOk
      ? '<span class="corp-badge corp-badge-online">Success</span>'
      : '<span class="corp-badge corp-badge-offline">Failed</span>';
    var vmHtml = (r.vmids && r.vmids.length)
      ? r.vmids.map(function (v) { return '<code style="font-size:11px;margin-right:3px">' + esc(String(v)) + '</code>'; }).join('')
      : '<span style="color:var(--muted)">–</span>';
    var target = r.target_name
      ? '<code style="font-size:11px">' + esc(r.target_name) + '</code>'
      + (r.volume_name ? '<br><span style="font-size:11px;color:var(--muted)">' + esc(r.volume_name) + '</span>' : '')
      : '<span style="color:var(--muted)">–</span>';
    var errorTip = (!isOk && r.error_msg)
      ? ' <span title="' + esc(r.error_msg) + '" style="cursor:help;color:var(--error)">ⓘ</span>' : '';
    return '<tr>'
      + '<td style="white-space:nowrap">' + fmtDateRel(r.timestamp) + '</td>'
      + '<td><code style="font-size:11px">' + esc(r.user) + '</code></td>'
      + '<td><span class="corp-badge corp-badge-ha" style="white-space:nowrap">' + label + '</span></td>'
      + '<td>' + target + '</td>'
      + '<td>' + vmHtml + '</td>'
      + '<td>' + badge + errorTip + '</td>'
      + '</tr>';
  }).join('');
}

function _colorizeLog(escapedLine) {
  return escapedLine
    .replace(/\[INFO\]/g, '<span style="color:#16a34a;font-weight:600">[INFO]</span>')
    .replace(/\[WARN\]/g, '<span style="color:#d97706;font-weight:600">[WARN]</span>')
    .replace(/\[ERROR\]/g, '<span style="color:#dc2626;font-weight:600">[ERROR]</span>')
    .replace(/\[ERR\]/g, '<span style="color:#dc2626;font-weight:600">[ERR]</span>');
}

function showJobLog(id) {
  var j = _allJobsCache.find(function (x) { return x.id === id; });
  if (!j) return;
  _currentLogJobId = id;

  document.getElementById('lvm_title').innerHTML =
    '<span class="corp-badge corp-badge-ha" style="margin-right:8px">' + esc(j.job_type || 'Job') + '</span>'
    + statusBadge(j.status);

  document.getElementById('lvm_meta').innerHTML =
    '<code style="font-size:11px">' + esc(String(j.vmid || '–')) + '</code>'
    + (j.node ? ' &nbsp;·&nbsp; <code style="font-size:11px">' + esc(j.node) + '</code>' : '')
    + (j.created_by ? ' &nbsp;·&nbsp; ' + esc(j.created_by) : '')
    + ' &nbsp;·&nbsp; ' + fmtDateRel(j.created_at);

  var lines = (j.log || []).map(function (l) {
    var ts = esc(l.ts || '');
    var msg = esc(l.msg || l);
    return '<div class="log-entry">'
      + (ts ? '<span style="color:var(--muted);user-select:none">' + ts + '</span> ' : '')
      + _colorizeLog(msg)
      + '</div>';
  });
  document.getElementById('lvm_log').innerHTML = lines.join('') || '<span style="color:var(--muted)">No log entries.</span>';

  var errDiv = document.getElementById('lvm_error');
  errDiv.textContent = j.error || '';
  errDiv.style.display = j.error ? '' : 'none';

  var lvm = document.getElementById('logViewModal');
  lvm.style.display = 'flex';
  setTimeout(function () { trapFocus(lvm); }, 60);
}

function hideJobLog() {
  document.getElementById('logViewModal').style.display = 'none';
  _currentLogJobId = null;
}

function downloadJobLog() {
  var j = _currentLogJobId && _allJobsCache.find(function (x) { return x.id === _currentLogJobId; });
  if (!j) return;
  var lines = (j.log || []).map(function (l) {
    return (l.ts ? l.ts + '  ' : '') + (l.msg || l);
  });
  if (j.error) lines.push('[ERROR] ' + j.error);
  var text = lines.join('\n');
  var blob = new Blob([text], { type: 'text/plain' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'netapp-job-' + (j.job_type || 'log').replace(/\s+/g, '-').toLowerCase()
    + '-' + (j.id || '').slice(0, 8) + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function prepareRestore(snapId) {
  var snap = _allSnapshots.find(function (s) { return String(s.id) === String(snapId); });
  var vmid = snap && snap.vmids && snap.vmids.length ? snap.vmids[0] : null;
  document.querySelectorAll('.subtab').forEach(function (x) { x.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function (x) { x.style.display = 'none'; });
  document.querySelector('[data-tab="restore"]').classList.add('active');
  document.getElementById('tab-restore').style.display = 'block';
  if (!vmid) { toast(t('msg_snapshot_has_no_vm_entries'), 'error'); return; }
  if (!_rcVms.length) {
    loadRcVmList();
    setTimeout(function () { openRestoreWizard(vmid, snapId); }, 600);
  } else {
    openRestoreWizard(vmid, snapId);
  }
}

function prepareClone(snapId) {
  var snap = _allSnapshots.find(function (s) { return String(s.id) === String(snapId); });
  var vmid = snap && snap.vmids && snap.vmids.length ? snap.vmids[0] : null;
  document.querySelectorAll('.subtab').forEach(function (x) { x.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function (x) { x.style.display = 'none'; });
  document.querySelector('[data-tab="restore"]').classList.add('active');
  document.getElementById('tab-restore').style.display = 'block';
  if (!vmid) { toast(t('msg_snapshot_has_no_vm_entries_1'), 'error'); return; }
  if (!_rcVms.length) {
    loadRcVmList();
    setTimeout(function () { openCloneWizard(vmid, snapId); }, 600);
  } else {
    openCloneWizard(vmid, snapId);
  }
}

// ═══════════════════════════ HELPERS ══════════════════════════════════════

function formatLag(s) {
  if (!s) return '–';
  var m = s.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!m) return s;
  var parts = [];
  if (m[1]) parts.push(m[1] + 'd');
  if (m[2]) parts.push(m[2] + 'h');
  if (m[3]) parts.push(m[3] + 'm');
  if (m[4]) parts.push(Math.floor(parseFloat(m[4])) + 's');
  return parts.length ? parts.join(' ') : '0s';
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtBytes(b) {
  if (!b) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return (i === 0 ? b : b.toFixed(1)) + ' ' + units[i];
}

function fmtDate(iso) {
  if (!iso) return '–';
  try {
    var locales = { de: 'de-DE', en: 'en-US', fr: 'fr-FR', es: 'es-ES', pt: 'pt-BR', ko: 'ko-KR', it: 'it-IT' };
    var loc = locales[_LANG] || 'de-DE';
    var d = new Date(iso);
    return d.toLocaleDateString(loc) + ' ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return iso; }
}

function _emptyRow(cols, svgIcon, title, subtitle, btnLabel, btnOnclick) {
  var safeTitle = esc(title);
  var safeSubtitle = esc(subtitle);
  var safeBtnLabel = btnLabel ? esc(btnLabel) : '';
  var btn = safeBtnLabel
    ? '<button class="btn btn-primary btn-sm" onclick="' + btnOnclick + '" style="margin-top:12px">' + safeBtnLabel + '</button>'
    : '';
  return '<tr><td colspan="' + cols + '" style="padding:40px 20px;text-align:center;color:var(--muted)">'
    + '<div style="margin:0 auto 10px;width:32px;height:32px;opacity:.25">' + svgIcon + '</div>'
    + '<div style="font-size:14px;font-weight:600;margin-bottom:4px;color:var(--text)">' + safeTitle + '</div>'
    + '<div style="font-size:12px">' + safeSubtitle + '</div>'
    + btn + '</td></tr>';
}

var _svgCamera = '<svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>';
var _svgClock = '<svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
var _svgCog = '<svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>';

function fmtRelative(iso) {
  if (!iso) return '–';
  try {
    var ms = Date.now() - new Date(iso).getTime();
    var a = Math.abs(ms);
    if (a < 60000) return 'just now';
    if (a < 3600000) return Math.round(a / 60000) + ' min ago';
    if (a < 86400000) return Math.round(a / 3600000) + ' hr ago';
    if (a < 604800000) return Math.round(a / 86400000) + ' d ago';
    if (a < 2592000000) return Math.round(a / 604800000) + ' wk ago';
    return Math.round(a / 2592000000) + ' mo ago';
  } catch (e) { return iso; }
}

function fmtDateRel(iso) {
  if (!iso) return '–';
  return '<span title="' + esc(fmtDate(iso)) + '" style="cursor:default;border-bottom:1px dotted var(--muted)">'
    + esc(fmtRelative(iso)) + '</span>';
}

function statusBadge(s) {
  var cls = {
    done: 'corp-badge-online',
    running: 'corp-badge-running',
    pending: 'corp-badge-stopped',
    failed: 'corp-badge-offline',
    error: 'corp-badge-offline',
    cancelling: 'corp-badge-maintenance',
    cancelled: 'corp-badge-stopped',
  };
  var labels = {
    done: t('badge_done'),
    running: t('badge_running'),
    pending: t('badge_pending'),
    failed: t('badge_failed'),
    error: t('badge_failed'),
    cancelling: t('badge_cancelling'),
    cancelled: t('badge_cancelled'),
  };
  return '<span class="corp-badge ' + (cls[s] || 'corp-badge-stopped') + '">' + (labels[s] || esc(s || '–')) + '</span>';
}

function vmBadge(id, name) {
  var cls = 'badge badge-vm badge-vm-' + (parseInt(id) % 6);
  return '<span class="' + cls + '">' + esc(String(id)) + (name ? ' – ' + esc(name) : '') + '</span>';
}

function schedSmBadge(sm) {
  if (!sm || !sm.exists) return '<span style="color:var(--muted)">–</span>';
  var dest = esc(sm.dest_cluster || sm.dest_svm || '?');
  var lag = formatLag(sm.lag_time);
  var tip = 'State: ' + esc(sm.state || '?') + ' | Lag: ' + lag;
  if (sm.last_transfer_time) {
    tip += ' | Last: ' + esc((sm.last_transfer_time || '').slice(0, 16).replace('T', ' '));
  }
  var color, icon;
  if (!sm.healthy || sm.state === 'broken_off' || sm.state === 'broken-off') {
    color = 'red'; icon = '✗';
  } else if (sm.state === 'snapmirrored') {
    color = 'green'; icon = '⟳';
  } else {
    color = 'orange'; icon = '⚠';
  }
  return '<span class="badge badge-' + color + '" title="' + tip + '" style="cursor:default">'
    + icon + ' ' + dest + '</span>'
    + '<div style="font-size:10px;color:var(--muted);margin-top:2px">Lag: ' + lag + '</div>';
}

// ═══════════════════════════ SNAPMIRROR® ══════════════════════════════════════

// loadSnapMirrorRelationships() removed — SnapMirror status is now
// shown inline in the Storage tab via loadStorageUnified().

async function runDetectAndScan() {
  var sp = document.getElementById('discoverSpinner');
  if (sp) sp.style.display = 'inline-block';
  try {
    var [disc, sm] = await Promise.allSettled([
      apiPost('discover', {}),
      apiPost('snapmirror/scan', {}),
    ]);
    var msgs = [];
    if (disc.status === 'fulfilled') {
      var n = Object.keys((disc.value.mappings || []).reduce(function (a, m) { a[m.volume_uuid || m.id] = 1; return a; }, {})).length || disc.value.count || 0;
      msgs.push(n + ' datastore(s) found');
    } else { msgs.push('Detect: ' + disc.reason.message); }
    if (sm.status === 'fulfilled') {
      msgs.push(sm.value.found + ' SnapMirror relationship(s)');
    } else { msgs.push('SnapMirror: ' + sm.reason.message); }
    var hasError = disc.status === 'rejected' || sm.status === 'rejected';
    toast(msgs.join(' · '), hasError ? 'error' : 'success');
    loadStorageUnified();
  } finally {
    if (sp) sp.style.display = 'none';
  }
}

async function scanSnapMirror() {
  try {
    var r = await apiPost('snapmirror/scan', {});
    toast(r.found + ' relationship(s) found' + (r.errors.length ? ' (' + r.errors.length + ' error(s))' : ''), 'success');
    loadStorageUnified();
  } catch (e) { toast(e.message, 'error', e.detail); }
}

async function smUpdateNow(relId) {
  try {
    await apiPost('snapmirror/update', { relationship_id: relId });
    toast(t('sm_update_now'), 'success');
  } catch (e) { toast(e.message, 'error', e.detail); }
}

// ═══════════════════════════ SMTP ═════════════════════════════════════════

function smtpAutoPort() {
  var enc = document.getElementById('smtp_encryption').value;
  var portMap = { starttls: 587, ssl: 465, none: 25 };
  if (portMap[enc]) document.getElementById('smtp_port').value = portMap[enc];
}

async function loadSmtp() {
  try {
    var d = await apiFetch('settings/smtp');
    document.getElementById('smtp_host').value = d.host || '';
    document.getElementById('smtp_port').value = d.port || 587;
    document.getElementById('smtp_user').value = d.username || '';
    document.getElementById('smtp_from').value = d.from_address || '';
    document.getElementById('smtp_encryption').value = d.encryption || 'starttls';
    // password placeholder only — never send back plaintext
    document.getElementById('smtp_pass').placeholder = d.has_password ? '••••••••' : '';
  } catch (e) { }
}

async function saveSmtp() {
  var payload = {
    host: document.getElementById('smtp_host').value.trim(),
    port: parseInt(document.getElementById('smtp_port').value) || 587,
    username: document.getElementById('smtp_user').value.trim(),
    from_address: document.getElementById('smtp_from').value.trim(),
    encryption: document.getElementById('smtp_encryption').value,
    enabled: true,
  };
  var pw = document.getElementById('smtp_pass').value;
  if (pw) payload.password = pw;
  try {
    await apiPost('settings/smtp/save', payload);
    toast(t('msg_smtp_saved'), 'success');
    document.getElementById('smtp_pass').value = '';
    loadSmtp();
  } catch (e) { toast(e.message, 'error', e.detail); }
}

async function testSmtp() {
  toast(t('msg_testing').replace('%s', document.getElementById('smtp_host').value || 'SMTP'));
  try {
    var d = await apiPost('settings/smtp/test', {});
    if (d.success) toast(t('msg_smtp_test_ok'), 'success');
    else toast(d.error || 'Test failed', 'error');
  } catch (e) { toast(e.message, 'error', e.detail); }
}

// ═══════════════════════════ PROVISIONING ═════════════════════════════════

var _provPveHosts = [];
var _provOntapRes = { volumes: [], luns: [], igroups: [] };

async function loadStorageUnified() {
  try {
    var d = await apiFetch('storage/unified');
    var items = d.items || [];
    var tbody = document.getElementById('storageTbody');
    var empty = document.getElementById('storageEmpty');
    if (!items.length) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    tbody.innerHTML = items.map(function (ds) {
      var _protoBg = { nfs: '#0ea5e9', iscsi: '#f97316', nvme: '#a855f7' }[ds.protocol];
      var _protoBadge = '<span class="badge" style="background:' + (_protoBg || '#888') + ';color:#fff">'
        + esc((ds.protocol || '').toUpperCase()) + '</span>';
      var _srcBadge = ds.source === 'provisioned'
        ? '<span class="badge badge-blue" style="font-size:9px;padding:1px 5px">managed</span>'
        : '<span class="badge badge-gray" style="font-size:9px;padding:1px 5px">discovered</span>';
      var sc = {
        active: 'badge-green', provisioning: 'badge-orange', error: 'badge-red',
        removing: 'badge-orange'
      }[ds.status] || 'badge-gray';
      // SnapMirror cell
      var smCell;
      if (ds.snapmirror) {
        var sm = ds.snapmirror;
        var smColor = sm.state === 'snapmirrored' ? 'green'
          : sm.state === 'broken_off' ? 'red' : 'gray';
        smCell = '<span class="badge badge-' + smColor + '" style="font-size:10px">'
          + esc(sm.state || '–') + '</span>';
        if (sm.lag_time)
          smCell += '<br><span style="color:var(--muted);font-size:10px">' + formatLag(sm.lag_time) + '</span>';
        smCell += ' <button class="btn btn-ghost btn-sm"'
          + ' style="padding:1px 5px;font-size:10px;vertical-align:middle"'
          + ' onclick="smUpdateNow(\'' + sm.id + '\')" title="Trigger SnapMirror update">↻</button>';
      } else {
        smCell = '<span style="color:var(--muted)">—</span>';
      }
      // Hosts
      var hosts = (ds.pve_host_ids || []).length;
      var hostsCell = hosts > 0 ? hosts + ' host' + (hosts === 1 ? '' : 's')
        : '<span style="color:var(--muted)">—</span>';
      // Actions per source type
      var actions;
      if (ds.source === 'provisioned') {
        actions =
          '<button class="btn btn-success btn-sm" onclick="showAddHostDialog(\'' + ds.id + '\',\'' + esc(ds.name) + '\','
          + JSON.stringify(ds.pve_host_ids || []).replace(/"/g, '&quot;') + ')">+ Host</button> '
          + '<button class="btn btn-success btn-sm" onclick="showResizeDialog(\'' + ds.id + '\',\'' + esc(ds.name) + '\','
          + (ds.size_bytes || 0) + ',\'' + esc(ds.protocol || '') + '\')">Resize</button> '
          + '<button class="btn btn-danger btn-sm" onclick="confirmRemoveDatastore(\'' + ds.id + '\',\'' + esc(ds.name) + '\')">Remove</button>';
      } else {
        var _isSan = ds.protocol && ds.protocol !== 'nfs';
        var smBtn = '';
        if (_isSan) {
          smBtn = ds.snapinfo_initialized
            ? '<button class="btn btn-sm" style="font-size:10px;padding:2px 7px;background:var(--success);color:#000;border:none"'
            + ' onclick="snapmanifestCheck(\'' + esc(ds.mapping_id) + '\',\'' + esc(ds.name) + '\')" title="Check snapmanifest">snapmanifest ✓</button> '
            : '<button class="btn btn-sm" style="font-size:10px;padding:2px 7px;background:var(--warning);color:#000;border:none"'
            + ' onclick="snapmanifestInit(\'' + esc(ds.mapping_id) + '\',\'' + esc(ds.name) + '\')" title="Setup snapmanifest">Setup snapmanifest</button> ';
        }
        actions = smBtn
          + '<button class="btn btn-ghost btn-sm"'
          + ' onclick="importToProvisioning(\'' + esc(ds.mapping_id) + '\',\'' + esc(ds.name) + '\')"'
          + ' title="Add to managed datastores">+ Manage</button> '
          + '<button class="btn btn-danger btn-sm"'
          + ' onclick="deleteMapping(\'' + esc(ds.mapping_id) + '\',\'' + esc(ds.name) + '\')" title="Remove from database">✕</button>';
      }
      var _svmEp = [ds.svm_name, ds.endpoint_name].filter(Boolean).join(' · ');
      return '<tr>'
        + '<td><strong>' + esc(ds.name) + '</strong> ' + _srcBadge
        + (_svmEp ? '<br><span style="font-size:.75rem;color:var(--muted)">' + esc(_svmEp) + '</span>' : '')
        + '</td>'
        + '<td>' + _protoBadge + '</td>'
        + '<td style="font-family:var(--mono);font-size:11px">' + esc(ds.volume_name || '–') + '</td>'
        + '<td style="font-family:var(--mono);font-size:11px">' + esc(ds.vg_name || ds.nfs_junction_path || '–') + '</td>'
        + '<td>' + hostsCell + '</td>'
        + '<td>' + (ds.size_bytes ? fmtBytes(ds.size_bytes) : '—') + '</td>'
        + '<td>' + smCell + '</td>'
        + '<td><span class="badge ' + sc + '">' + esc(ds.status) + '</span>'
        + (ds.error_message ? '<br><span style="color:var(--error);font-size:10px">'
          + esc(ds.error_message.slice(0, 60)) + '</span>' : '') + '</td>'
        + '<td><div class="row-actions">' + actions + '</div></td>'
        + '</tr>';
    }).join('');
  } catch (e) { toast(e.message, 'error'); }
}

// kept for any remaining internal callers
function loadProvDatastores() { loadStorageUnified(); }

function showProvWizard() {
  provWizShowStep(1);
  ['provWizName', 'provWizSvm', 'provWizVolName', 'provWizLunName', 'provWizVgName', 'provWizStorageId',
    'provWizNsName', 'provWizSubsystemName', 'provWizNfsJunction'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
  var lsz = document.getElementById('provWizLunSize'); if (lsz) lsz.value = '100';
  var nsz = document.getElementById('provWizNsSize'); if (nsz) nsz.value = '100';
  var fsz = document.getElementById('provWizNfsSize'); if (fsz) fsz.value = '500';
  provWizUpdateSanVolHint('provWizLunSize', 'provWizLunSizeUnit', 'provWizLunVolHint', 'LUN');
  provWizUpdateSanVolHint('provWizNsSize', 'provWizNsSizeUnit', 'provWizNsVolHint', 'namespace');
  document.getElementById('provOntapLoadErr').textContent = '';
  var r = document.querySelector('input[name="provProto"][value="iscsi"]');
  if (r) r.checked = true;
  provProtoChange();
  document.getElementById('provWizModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  loadProvEndpoints();
}

function provProtoChange() {
  var proto = (document.querySelector('input[name="provProto"]:checked') || {}).value || 'iscsi';
  var isSan = proto === 'iscsi' || proto === 'nvme';
  document.getElementById('provWizIscsiSection').style.display = proto === 'iscsi' ? 'block' : 'none';
  document.getElementById('provWizNvmeSection').style.display = proto === 'nvme' ? 'block' : 'none';
  document.getElementById('provWizNfsSection').style.display = proto === 'nfs' ? 'block' : 'none';
  document.querySelectorAll('.prov-san-only').forEach(function (el) {
    el.style.display = isSan ? '' : 'none';
  });
}

function hideProvWizard() {
  document.getElementById('provWizModal').style.display = 'none';
  document.body.style.overflow = '';
}

function provWizShowStep(n) {
  [1, 2, 3].forEach(function (i) {
    var s = document.getElementById('provWizStep' + i);
    var tb = document.getElementById('provWizStepTab' + i);
    if (s) s.style.display = i === n ? 'block' : 'none';
    if (tb) {
      tb.style.color = i === n ? 'var(--primary)' : (i < n ? 'var(--success)' : 'var(--muted)');
      tb.style.fontWeight = i === n ? '600' : '400';
    }
  });
}

async function loadProvEndpoints() {
  try {
    var eps = await apiFetch('endpoints');
    var sel = document.getElementById('provWizEndpoint');
    sel.innerHTML = '<option value="">— select endpoint —</option>' +
      eps.map(function (ep) { return '<option value="' + esc(ep.id) + '">' + esc(ep.name) + ' (' + esc(ep.host) + ')</option>'; }).join('');
  } catch (e) { toast(e.message, 'error'); }
}

async function loadProvSvms() {
  var epId = document.getElementById('provWizEndpoint').value;
  var sel = document.getElementById('provWizSvm');
  if (!epId) { sel.innerHTML = '<option value="">— select endpoint first —</option>'; return; }
  sel.innerHTML = '<option value="">— loading… —</option>';
  try {
    var data = await apiFetch('provisioning/svms?endpoint_id=' + encodeURIComponent(epId));
    sel.innerHTML = '<option value="">— select SVM —</option>' +
      (data.svms || []).map(function (s) { return '<option value="' + esc(s.name) + '">' + esc(s.name) + '</option>'; }).join('');
  } catch (e) { sel.innerHTML = '<option value="">— error loading SVMs —</option>'; toast(e.message, 'error'); }
}

async function provWizNext1() {
  var proto = document.querySelector('input[name="provProto"]:checked');
  if (!proto) return toast(t('msg_select_a_protocol'), 'error');
  var epId = document.getElementById('provWizEndpoint').value;
  if (!epId) return toast(t('msg_select_an_ontap_endpoint'), 'error');
  var svm = document.getElementById('provWizSvm').value.trim();
  if (!svm) return toast(t('msg_select_an_svm'), 'error');
  var name = document.getElementById('provWizName').value.trim();
  if (!name) return toast(t('msg_enter_datastore_name'), 'error');
  var vg = document.getElementById('provWizVgName');
  if (vg && !vg.value) vg.value = 'vg' + name.replace(/[^a-z0-9]/gi, '').toLowerCase();
  var sid = document.getElementById('provWizStorageId');
  if (sid && !sid.value) sid.value = name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  var spin = document.getElementById('provOntapLoading');
  var err = document.getElementById('provOntapLoadErr');
  spin.style.display = 'inline-block'; err.textContent = '';
  try {
    _provOntapRes = await apiFetch('provisioning/ontap-resources?endpoint_id=' + encodeURIComponent(epId) + '&svm_name=' + encodeURIComponent(svm));
    renderProvOntapRes();
    provWizShowStep(2);
  } catch (e) { err.textContent = e.message; }
  finally { spin.style.display = 'none'; }
}

function renderProvOntapRes() {
  var proto = (document.querySelector('input[name="provProto"]:checked') || {}).value || 'iscsi';
  var volSel = document.getElementById('provWizVolume');
  volSel.innerHTML = '<option value="__new__">— create new volume —</option>' +
    (_provOntapRes.volumes || []).map(function (v) {
      return '<option value="' + esc(v.uuid) + '">' + esc(v.name) + '</option>';
    }).join('');
  var agSel = document.getElementById('provWizAggregate');
  var aggs = _provOntapRes.aggregates || [];
  if (aggs.length) {
    agSel.innerHTML = aggs.map(function (a) {
      var free = a.available_bytes ? ' — ' + fmtBytes(a.available_bytes) + ' free' : '';
      return '<option value="' + esc(a.name) + '">' + esc(a.name) + (a.node ? ' (' + esc(a.node) + ')' : '') + free + '</option>';
    }).join('');
  } else {
    agSel.innerHTML = '<option value="">— no aggregates found —</option>';
  }
  if (proto === 'iscsi') {
    var igSel = document.getElementById('provWizIgroup');
    igSel.innerHTML = '<option value="__new__">— create new igroup —</option>' +
      (_provOntapRes.igroups || []).map(function (ig) {
        return '<option value="' + esc(ig.uuid) + '">' + esc(ig.name) + ' (' + ig.initiators.length + ' init.)</option>';
      }).join('');
  } else if (proto === 'nvme') {
    var subSel = document.getElementById('provWizSubsystem');
    subSel.innerHTML = '<option value="__new__">— create new subsystem —</option>' +
      (_provOntapRes.nvme_subsystems || []).map(function (s) {
        return '<option value="' + esc(s.uuid) + '">' + esc(s.name) + ' (' + s.hosts.length + ' hosts)</option>';
      }).join('');
    provWizSubsystemChange();
  } else if (proto === 'nfs') {
    var lifSel = document.getElementById('provWizNfsLif');
    var lifs = _provOntapRes.nfs_lifs || [];
    if (lifs.length) {
      lifSel.innerHTML = lifs.map(function (l) {
        return '<option value="' + esc(l.ip) + '">' + esc(l.name) + ' — ' + esc(l.ip) + '</option>';
      }).join('');
    } else {
      lifSel.innerHTML = '<option value="">— no NFS LIFs found —</option>';
    }
  }
  provWizVolumeChange();
}

function provWizNfsLifChange() {
  // reserved for future use (e.g. show subnet hint)
}

function provWizVolumeChange() {
  var proto = (document.querySelector('input[name="provProto"]:checked') || {}).value || 'iscsi';
  var volId = document.getElementById('provWizVolume').value;
  var isNew = volId === '__new__';
  document.getElementById('provWizNewVolRow').style.display = isNew ? '' : 'none';
  document.getElementById('provWizAggRow').style.display = isNew ? '' : 'none';
  if (proto === 'iscsi') {
    var lunSel = document.getElementById('provWizLun');
    lunSel.innerHTML = '<option value="__new__">— create new LUN —</option>' +
      (isNew ? [] : (_provOntapRes.luns || []).filter(function (l) { return l.volume_uuid === volId; }))
        .map(function (l) { return '<option value="' + esc(l.uuid) + '">' + esc(l.name) + ' (' + fmtBytes(l.size_bytes) + ')</option>'; }).join('');
    provWizLunChange();
  } else if (proto === 'nvme') {
    var nsSel = document.getElementById('provWizNs');
    nsSel.innerHTML = '<option value="__new__">— create new namespace —</option>' +
      (isNew ? [] : (_provOntapRes.nvme_namespaces || []).filter(function (n) { return n.volume_uuid === volId; }))
        .map(function (n) { return '<option value="' + esc(n.uuid) + '">' + esc(n.name) + ' (' + fmtBytes(n.size_bytes) + ')</option>'; }).join('');
    provWizNsChange();
  } else if (proto === 'nfs') {
    document.getElementById('provWizNfsSizeRow').style.display = isNew ? '' : 'none';
  }
}

function provWizLunChange() {
  var isNew = document.getElementById('provWizLun').value === '__new__';
  document.getElementById('provWizNewLunRow').style.display = isNew ? 'grid' : 'none';
  provWizIgroupChange();
}

function provWizIgroupChange() {
  var isNew = document.getElementById('provWizIgroup').value === '__new__';
  document.getElementById('provWizNewIgroupRow').style.display = isNew ? '' : 'none';
}

function provWizNsChange() {
  var isNew = document.getElementById('provWizNs').value === '__new__';
  document.getElementById('provWizNewNsRow').style.display = isNew ? 'grid' : 'none';
}

function provWizSubsystemChange() {
  var isNew = document.getElementById('provWizSubsystem').value === '__new__';
  document.getElementById('provWizNewSubsystemRow').style.display = isNew ? '' : 'none';
}

function provWizUpdateSanVolHint(sizeId, unitId, hintId, label) {
  var UNITS = { 'GiB': 1073741824, 'TiB': 1099511627776, 'MiB': 1048576 };
  var SAN_VOL_MULTIPLIER = 2.5;
  var hint = document.getElementById(hintId);
  if (!hint) return;
  var sz = parseFloat(document.getElementById(sizeId).value) || 0;
  var unit = document.getElementById(unitId).value;
  if (!sz || !UNITS[unit]) { hint.textContent = ''; return; }
  var volBytes = sz * UNITS[unit] * SAN_VOL_MULTIPLIER;
  hint.textContent = 'ONTAP volume: ~' + fmtBytes(volBytes) + ' (' + SAN_VOL_MULTIPLIER + '× ' + label + ' size — headroom for snapshots)';
}

async function provWizNext2() {
  var proto = (document.querySelector('input[name="provProto"]:checked') || {}).value || 'iscsi';
  var volId = document.getElementById('provWizVolume').value;
  if (volId === '__new__') {
    if (!document.getElementById('provWizVolName').value.trim()) return toast(t('msg_enter_new_volume_name'), 'error');
  }
  if (proto === 'iscsi') {
    var lunId = document.getElementById('provWizLun').value;
    if (lunId === '__new__') {
      if (!document.getElementById('provWizLunName').value.trim()) return toast(t('msg_enter_new_lun_name'), 'error');
      if (!parseInt(document.getElementById('provWizLunSize').value)) return toast(t('msg_enter_a_valid_lun_size'), 'error');
    }
  } else if (proto === 'nvme') {
    var nsId = document.getElementById('provWizNs').value;
    if (nsId === '__new__') {
      if (!document.getElementById('provWizNsName').value.trim()) return toast(t('msg_enter_new_namespace_name'), 'error');
      if (!parseInt(document.getElementById('provWizNsSize').value)) return toast(t('msg_enter_a_valid_namespace_size'), 'error');
    }
  } else if (proto === 'nfs') {
    if (!document.getElementById('provWizNfsLif').value) return toast(t('msg_select_an_nfs_lif'), 'error');
    if (!document.getElementById('provWizNfsJunction').value.trim()) return toast(t('msg_enter_a_junction_path'), 'error');
    if (volId === '__new__') {
      if (!parseInt(document.getElementById('provWizNfsSize').value)) return toast(t('msg_enter_a_valid_volume_size'), 'error');
    }
  }
  try {
    _provPveHosts = (await apiFetch('provisioning/pve-hosts')).hosts || [];
    var c = document.getElementById('provWizHostList');
    if (!_provPveHosts.length) {
      c.innerHTML = '<span style="color:var(--muted)">No PVE hosts configured in Settings.</span>';
    } else {
      c.innerHTML = _provPveHosts.map(function (h) {
        return '<label style="display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer;font-size:12px;text-transform:none;letter-spacing:0">' +
          '<input type="checkbox" value="' + esc(h.id) + '" checked> ' + esc(h.name) + ' (' + esc(h.host) + ')' +
          '</label>';
      }).join('');
    }
    provWizShowStep(3);
  } catch (e) { toast(e.message, 'error'); }
}

async function submitProvWizard() {
  var proto = (document.querySelector('input[name="provProto"]:checked') || {}).value;
  var epId = document.getElementById('provWizEndpoint').value;
  var svm = document.getElementById('provWizSvm').value.trim();
  var name = document.getElementById('provWizName').value.trim();
  var volId = document.getElementById('provWizVolume').value;
  var storageId = document.getElementById('provWizStorageId').value.trim();
  if (!storageId) return toast(t('msg_enter_storage_id'), 'error');
  var hostIds = [];
  document.querySelectorAll('#provWizHostList input[type=checkbox]:checked').forEach(function (cb) { hostIds.push(cb.value); });
  if (!hostIds.length) return toast(t('msg_select_at_least_one_host'), 'error');
  var UNITS = { 'GiB': 1073741824, 'TiB': 1099511627776, 'MiB': 1048576 };
  var body = {
    name: name, endpoint_id: epId, svm_name: svm, protocol: proto,
    volume_uuid: volId !== '__new__' ? volId : '',
    volume_name: volId === '__new__' ? document.getElementById('provWizVolName').value.trim() : '',
    aggregate_name: volId === '__new__' ? (document.getElementById('provWizAggregate').value || '') : '',
    pve_storage_id: storageId, pve_host_ids: hostIds
  };
  if (proto === 'iscsi') {
    var lunId = document.getElementById('provWizLun').value;
    var igId = document.getElementById('provWizIgroup').value;
    var vgName = document.getElementById('provWizVgName').value.trim();
    var lvmType = document.getElementById('provWizLvmType').value;
    if (!vgName) return toast(t('msg_enter_vg_name'), 'error');
    var sizeBytes = 0;
    if (lunId === '__new__') {
      var sz = parseInt(document.getElementById('provWizLunSize').value) || 0;
      sizeBytes = sz * (UNITS[document.getElementById('provWizLunSizeUnit').value] || 0);
    }
    Object.assign(body, {
      lun_uuid: lunId !== '__new__' ? lunId : '',
      lun_name: lunId === '__new__' ? document.getElementById('provWizLunName').value.trim() : '',
      igroup_uuid: igId !== '__new__' ? igId : '',
      igroup_name: igId === '__new__' ? (document.getElementById('provWizIgroupName').value.trim() || ('igr-' + name.replace(/[^a-z0-9]/gi, '').toLowerCase())) : '',
      vg_name: vgName, lvm_type: lvmType, size_bytes: sizeBytes
    });
  } else if (proto === 'nvme') {
    var nsId = document.getElementById('provWizNs').value;
    var subId = document.getElementById('provWizSubsystem').value;
    var vgName = document.getElementById('provWizVgName').value.trim();
    var lvmType = document.getElementById('provWizLvmType').value;
    if (!vgName) return toast(t('msg_enter_vg_name_1'), 'error');
    var sizeBytes = 0;
    if (nsId === '__new__') {
      var sz = parseInt(document.getElementById('provWizNsSize').value) || 0;
      sizeBytes = sz * (UNITS[document.getElementById('provWizNsSizeUnit').value] || 0);
    }
    Object.assign(body, {
      ns_uuid: nsId !== '__new__' ? nsId : '',
      ns_name: nsId === '__new__' ? document.getElementById('provWizNsName').value.trim() : '',
      subsystem_uuid: subId !== '__new__' ? subId : '',
      subsystem_name: subId === '__new__' ? (document.getElementById('provWizSubsystemName').value.trim() || ('sub-' + name.replace(/[^a-z0-9]/gi, '').toLowerCase())) : '',
      vg_name: vgName, lvm_type: lvmType, size_bytes: sizeBytes
    });
  } else if (proto === 'nfs') {
    var junction = document.getElementById('provWizNfsJunction').value.trim();
    var nfsLifIp = document.getElementById('provWizNfsLif').value;
    var sizeBytes = 0;
    if (volId === '__new__') {
      var sz = parseInt(document.getElementById('provWizNfsSize').value) || 0;
      sizeBytes = sz * (UNITS[document.getElementById('provWizNfsSizeUnit').value] || 0);
    }
    Object.assign(body, { nfs_junction_path: junction, nfs_lif_ip: nfsLifIp, size_bytes: sizeBytes });
  }
  var btn = document.getElementById('provSubmitBtn');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    var r = await apiPost('provisioning/datastores', body);
    hideProvWizard();
    toast(t('msg_provisioning_job_started'), 'success');
    loadProvDatastores();
    setTimeout(function () { document.querySelector('[data-tab="jobs"]').click(); }, 800);
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false; btn.textContent = 'Create Datastore';
  }
}

function showResizeDialog(dsId, dsName, currentBytes, protocol) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:center;justify-content:center';
  var box = document.createElement('div');
  box.style.cssText = 'background:var(--card);border:1px solid var(--border);border-radius:8px;padding:24px;min-width:320px;max-width:420px';
  var unitOpts = '<option value="GiB">GiB</option><option value="TiB">TiB</option><option value="MiB">MiB</option>';
  var shrinkNote = protocol === 'nfs' ? '<p style="font-size:11px;color:var(--muted);margin-top:4px">Shrink is only supported for NFS volumes.</p>' : '';
  var sanHint = protocol !== 'nfs' ? '<div id="resizeDlgVolHint" class="hint" style="margin-top:4px"></div>' : '';
  box.innerHTML =
    '<div style="font-weight:600;margin-bottom:12px">Resize "' + esc(dsName) + '"</div>' +
    '<p style="font-size:12px;color:var(--muted);margin-bottom:12px">Current size: ' + fmtBytes(currentBytes) + '</p>' +
    '<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">' +
    '<input type="number" id="resizeDlgSize" min="1" value="' + (Math.ceil(currentBytes / 1073741824)) + '" style="width:90px;padding:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)">' +
    '<select id="resizeDlgUnit" style="padding:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)">' + unitOpts + '</select>' +
    '</div>' +
    sanHint +
    shrinkNote +
    '<div style="display:flex;gap:8px;margin-top:16px">' +
    '<button class="btn btn-primary" id="resizeDlgOk">Resize</button>' +
    '<button class="btn btn-ghost" id="resizeDlgCancel">Cancel</button>' +
    '<span id="resizeDlgErr" style="color:var(--error);font-size:12px;align-self:center"></span>' +
    '</div>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  if (protocol !== 'nfs') {
    var sanLabel = protocol === 'nvme' ? 'namespace' : 'LUN';
    var _upd = function () { provWizUpdateSanVolHint('resizeDlgSize', 'resizeDlgUnit', 'resizeDlgVolHint', sanLabel); };
    document.getElementById('resizeDlgSize').addEventListener('input', _upd);
    document.getElementById('resizeDlgUnit').addEventListener('change', _upd);
    _upd();
  }
  document.getElementById('resizeDlgCancel').onclick = function () { document.body.removeChild(overlay); };
  document.getElementById('resizeDlgOk').onclick = async function () {
    var sz = parseInt(document.getElementById('resizeDlgSize').value) || 0;
    var UNITS = { 'GiB': 1073741824, 'TiB': 1099511627776, 'MiB': 1048576 };
    var sizeBytes = sz * (UNITS[document.getElementById('resizeDlgUnit').value] || 0);
    var errEl = document.getElementById('resizeDlgErr');
    if (!sizeBytes) { errEl.textContent = 'Enter a valid size'; return; }
    if (sizeBytes < currentBytes) {
      if (protocol !== 'nfs') {
        errEl.textContent = 'Shrink is not supported for ' + protocol.toUpperCase() + ' datastores.';
        return;
      }
      if (!confirm(t('msg_the_new_size') + fmtBytes(sizeBytes) + ') is smaller than the current size (' + fmtBytes(currentBytes) + ').\n\nPlease verify that the VMs on this datastore have enough free space before continuing.\n\nProceed with shrink?'))
        return;
    }
    var btn = document.getElementById('resizeDlgOk');
    btn.disabled = true; btn.textContent = 'Resizing…';
    try {
      await apiPost('provisioning/datastores/resize', { id: dsId, size_bytes: sizeBytes });
      document.body.removeChild(overlay);
      toast(t('msg_resize_job_started'), 'success');
      loadProvDatastores();
      setTimeout(function () { document.querySelector('[data-tab="jobs"]').click(); }, 800);
    } catch (e) {
      errEl.textContent = e.message;
      btn.disabled = false; btn.textContent = 'Resize';
    }
  };
}


async function showAddHostDialog(dsId, dsName, existingHostIds) {
  var allHosts;
  try { allHosts = (await apiFetch('provisioning/pve-hosts')).hosts || []; }
  catch (e) { toast(e.message, 'error'); return; }
  var available = allHosts.filter(function (h) { return existingHostIds.indexOf(h.id) === -1; });
  if (!available.length) { await uiAlert('All registered PVE hosts are already connected to "' + dsName + '".'); return; }

  // Build inline modal
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:center;justify-content:center';
  var box = document.createElement('div');
  box.style.cssText = 'background:var(--card);border:1px solid var(--border);border-radius:8px;padding:24px;min-width:320px;max-width:420px';
  var selOpts = available.map(function (h) {
    return '<option value="' + esc(h.id) + '">' + esc(h.name) + ' (' + esc(h.host) + ')</option>';
  }).join('');
  box.innerHTML = '<div style="font-weight:600;margin-bottom:12px">Add Host to "' + esc(dsName) + '"</div>' +
    '<select id="_addHostSel" class="form-control" style="margin-bottom:16px">' + selOpts + '</select>' +
    '<div style="display:flex;gap:8px">' +
    '<button id="_addHostOk" class="btn btn-primary">Add Host</button>' +
    '<button id="_addHostCancel" class="btn btn-ghost">Cancel</button></div>';
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function cleanup() { document.body.removeChild(overlay); }
  box.querySelector('#_addHostCancel').onclick = cleanup;
  box.querySelector('#_addHostOk').onclick = async function () {
    var hid = box.querySelector('#_addHostSel').value;
    cleanup();
    try {
      await apiPost('provisioning/datastores/add-host', { id: dsId, pve_host_id: hid });
      toast(t('msg_add_host_job_started'), 'success');
      loadProvDatastores();
      setTimeout(function () { document.querySelector('[data-tab="jobs"]').click(); }, 800);
    } catch (e) { toast(e.message, 'error'); }
  };
}

async function confirmRemoveDatastore(id, name) {
  if (!await uiConfirm(t('msg_remove_datastore') + name + '"?\n\nThis disconnects all hosts and removes the PVE storage entry.')) return;
  var delOntap = await uiConfirmDanger(
    'Also permanently delete the ONTAP volume, LUNs / namespaces and iGroups on the NetApp?\n\n'
    + 'This cannot be undone. The volume and all its snapshots will be destroyed.',
    'I understand this will permanently delete data on the NetApp'
  );
  try {
    await apiPost('provisioning/datastores/remove', { id: id, delete_ontap_objects: delOntap });
    toast(t('msg_removal_job_started'), 'success');
    loadProvDatastores();
    setTimeout(function () { document.querySelector('[data-tab="jobs"]').click(); }, 800);
  } catch (e) {
    var data = e.data || {};
    if (data.volumes && data.volumes.length) {
      await uiAlert('Cannot remove "' + name + '" — VM disks are still present in the VG:\n\n'
        + data.volumes.join('\n')
        + '\n\nDelete or migrate these VMs before removing the datastore.');
    } else {
      toast(e.message || String(e), 'error');
    }
  }
}

// ═══════════════════════════ DATA BACKUP / RESTORE ════════════════════════

async function triggerExport(ev) {
  ev.preventDefault();
  // Fetch as blob so the browser can trigger a download while staying authenticated
  try {
    var r = await fetch(API + '/settings/export', { credentials: 'include' });
    if (!r.ok) { var e = await r.json().catch(function () { return {}; }); throw new Error(e.error || 'HTTP ' + r.status); }
    var blob = await r.blob();
    var cd = r.headers.get('Content-Disposition') || '';
    var m = cd.match(/filename="([^"]+)"/);
    var fname = m ? m[1] : 'netapp_storage_backup.json';
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(t('msg_export_downloaded') + fname, 'success');
  } catch (e) {
    // snyk:ignore:DOM-based Cross-site Scripting (XSS)
    // lgtm[js/xss]
    toast(e.message, 'error', e.detail);
  }
}

async function importPluginData(input) {
  var file = input.files[0];
  if (!file) return;
  input.value = '';
  var status = document.getElementById('importStatus');
  status.textContent = 'Importing…';
  status.style.color = 'var(--muted)';
  try {
    var fd = new FormData();
    fd.append('file', file);
    var r = await fetch(API + '/settings/import', {
      method: 'POST', credentials: 'include', body: fd
    });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
    status.textContent = 'Imported ' + data.rows_imported + ' rows.';
    status.style.color = 'var(--success, green)';
    toast(t('msg_import_complete') + data.rows_imported + ' rows restored', 'success');
    // reload settings data so the UI reflects the restored state
    loadEndpoints(); loadPveHosts(); loadSmtp(); loadStorageUnified();
  } catch (e) {
    status.textContent = 'Import failed: ' + e.message;
    status.style.color = 'var(--error, red)';
    toast(e.message, 'error', e.detail);
  }
}

// ═══════════════════════ RECOVERY WIZARD ════════════════════════════════════

var rcvState = {
  endpoint_id: '', svm_name: '', protocol: 'nfs',
  volume_uuid: '', volume_name: '', volume_type: 'rw',
  sm_rel_uuid: '', has_sm: false,
  vg_name: '', lvm_type: 'linear', pool_name: 'data',
  storage_id: '', nfs_ip: '', junction_override: '',
  pve_host_ids: []
};

async function rcvLoadEndpoints() {
  var sel = document.getElementById('rcvEndpoint');
  if (sel.options.length > 1) return; // already loaded
  try {
    var eps = await apiFetch('endpoints');
    (Array.isArray(eps) ? eps : []).forEach(function (ep) {
      var o = document.createElement('option');
      o.value = ep.id; o.textContent = ep.name;
      sel.appendChild(o);
    });
  } catch (e) { console.error('rcvLoadEndpoints:', e); }
  rcvLoadHosts();
}

function rcvOnSvmChange() {
  var proto = document.querySelector('input[name="rcvProto"]:checked').value;
  var svm = document.getElementById('rcvSvm').value;
  var row = document.getElementById('rcvNfsLifRow');
  if (proto === 'nfs' && svm) {
    row.style.display = '';
    rcvLoadNfsLifs();
  } else {
    row.style.display = 'none';
  }
}

async function rcvLoadSvms() {
  var epId = document.getElementById('rcvEndpoint').value;
  var sel = document.getElementById('rcvSvm');
  sel.innerHTML = '<option value="">Loading…</option>';
  if (!epId) { sel.innerHTML = '<option value="">— select endpoint first —</option>'; return; }
  try {
    var r = await apiFetch('provisioning/svms?endpoint_id=' + encodeURIComponent(epId));
    sel.innerHTML = '<option value="">— select SVM —</option>';
    (r.svms || []).forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.name; o.textContent = s.name;
      sel.appendChild(o);
    });
  } catch (e) { sel.innerHTML = '<option value="">Error loading SVMs</option>'; }
}

async function rcvLoadHosts() {
  var wrap = document.getElementById('rcvHostCheckboxes');
  if (!wrap) return;
  try {
    var r = await apiFetch('provisioning/pve-hosts');
    wrap.innerHTML = (r.hosts || []).map(function (h) {
      return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;text-transform:none;letter-spacing:0;cursor:pointer">'
        + '<input type="checkbox" class="rcvHostCb" value="' + esc(h.id) + '" checked> '
        + esc(h.name) + ' <span style="color:var(--muted);font-size:11px">(' + esc(h.host) + ')</span></label>';
    }).join('') || '<span style="color:var(--muted);font-size:12px">No PVE hosts configured</span>';
  } catch (e) { }
}

function rcvSelectAllHosts(checked) {
  document.querySelectorAll('.rcvHostCb').forEach(function (cb) { cb.checked = checked; });
}

async function rcvLoadNfsLifs() {
  var sel = document.getElementById('rcvNfsLif');
  var errEl = document.getElementById('rcvNfsLifErr');
  var epId = document.getElementById('rcvEndpoint').value;
  var svm = document.getElementById('rcvSvm').value;
  if (errEl) errEl.textContent = '';
  if (!epId || !svm) {
    sel.innerHTML = '<option value="">— select endpoint/SVM first —</option>';
    return;
  }
  sel.innerHTML = '<option value="">— loading… —</option>';
  try {
    var r = await apiFetch('provisioning/nfs-lifs?endpoint_id='
      + encodeURIComponent(epId) + '&svm_name=' + encodeURIComponent(svm));
    var lifs = r.lifs || [];
    if (lifs.length) {
      sel.innerHTML = lifs.map(function (l) {
        return '<option value="' + esc(l.ip) + '">' + esc(l.name) + ' — ' + esc(l.ip) + '</option>';
      }).join('');
    } else {
      sel.innerHTML = '<option value="">— no NFS LIFs found —</option>';
      if (errEl) errEl.textContent = 'No NFS data LIFs found on SVM "' + svm + '". Check ONTAP LIF config.';
    }
  } catch (e) {
    sel.innerHTML = '<option value="">— error —</option>';
    if (errEl) errEl.textContent = 'Error: ' + e.message;
    console.error('rcvLoadNfsLifs:', e);
  }
}

async function rcvScanVolumes() {
  var epId = document.getElementById('rcvEndpoint').value;
  var svm = document.getElementById('rcvSvm').value;
  var errEl = document.getElementById('rcvScanErr');
  errEl.textContent = '';
  if (!epId || !svm) { errEl.textContent = 'Select endpoint and SVM first'; return; }
  var proto = document.querySelector('input[name="rcvProto"]:checked').value;
  document.getElementById('rcvScanSpinner').style.display = 'inline-block';
  try {
    var r = await api('GET', 'provisioning/recovery/scan-volumes?endpoint_id='
      + encodeURIComponent(epId) + '&svm_name=' + encodeURIComponent(svm));
    var vols = (r.volumes || []).filter(function (v) {
      // Filter by protocol hint: NFS=has junction, SAN=no junction
      if (proto === 'nfs') return v.junction || v.type === 'rw' || v.type === 'dp';
      if (proto === 'iscsi' || proto === 'nvme') return true; // can't filter without LUN scan
      return true;
    });
    rcvRenderVolumes(vols, proto);
    rcvState.endpoint_id = epId;
    rcvState.svm_name = svm;
    rcvState.protocol = proto;
  } catch (e) { errEl.textContent = e.message; }
  document.getElementById('rcvScanSpinner').style.display = 'none';
}

function rcvRenderVolumes(vols, proto) {
  var wrap = document.getElementById('rcvVolumeTableWrap');
  var tbody = document.getElementById('rcvVolumesTbody');
  if (!vols.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No volumes found</td></tr>';
    wrap.style.display = 'block';
    return;
  }
  tbody.innerHTML = vols.map(function (v) {
    var sm = v.snapmirror || {};
    var typeBadge = v.type === 'dp'
      ? '<span class="badge badge-orange">DP · SnapMirror®</span>'
      : '<span class="badge badge-green">RW · Primary</span>';
    var smCell = v.snapmirror
      ? '<span style="color:' + (sm.healthy ? 'var(--success)' : 'var(--error)') + ';font-size:12px">'
      + '⟳ ' + esc(sm.source_path || sm.state) + '</span>'
      : '<span style="color:var(--muted);font-size:11px">–</span>';
    var smRelUuid = encodeURIComponent(sm.relationship_uuid || '');
    var hasSmStr = v.snapmirror ? 'true' : 'false';
    return '<tr>'
      + '<td style="font-family:var(--mono);font-size:12px">' + esc(v.name) + '</td>'
      + '<td>' + typeBadge + '</td>'
      + '<td>' + fmtBytes(v.size_bytes || 0) + '</td>'
      + '<td>' + smCell + '</td>'
      + '<td><button class="btn btn-primary btn-sm" onclick="rcvSelectVolume(\''
      + esc(v.uuid) + '\',\'' + esc(v.name) + '\',\'' + esc(v.type) + '\',decodeURIComponent(\'' + smRelUuid + '\'),' + hasSmStr + ')">Select</button></td>'
      + '</tr>';
  }).join('');
  wrap.style.display = 'block';
}

function rcvSelectVolume(uuid, name, type, smRelUuid, hasSm) {
  rcvState.volume_uuid = uuid;
  rcvState.volume_name = name;
  rcvState.volume_type = type;
  rcvState.sm_rel_uuid = smRelUuid || '';
  rcvState.has_sm = !!hasSm;
  rcvShowStep(2);
  // Update summary display
  document.getElementById('rcvSelVolumeName').textContent = name;
  var badge = type === 'dp'
    ? '<span class="badge badge-orange">DP · SnapMirror®</span>'
    : '<span class="badge badge-green">RW · Primary</span>';
  document.getElementById('rcvSelVolumeBadge').innerHTML = badge;
  // Show SM break option for DP volumes
  document.getElementById('rcvSmBreakRow').style.display = (type === 'dp') ? 'block' : 'none';
  // Show/hide SAN-specific fields
  var proto = rcvState.protocol;
  var isSan = proto === 'iscsi' || proto === 'nvme';
  document.getElementById('rcvVgRow').style.display = isSan ? '' : 'none';
  document.getElementById('rcvLvmTypeRow').style.display = isSan ? '' : 'none';
  document.getElementById('rcvJunctionRow').style.display = proto === 'nfs' ? '' : 'none';
  rcvLvmTypeChange();
}

function rcvShowStep(n) {
  [1, 2, 3].forEach(function (i) {
    document.getElementById('rcvStep' + i).style.display = (i === n) ? '' : 'none';
    var tab = document.getElementById('rcvStepTab' + i);
    if (tab) {
      tab.style.color = (i === n) ? 'var(--primary)' : 'var(--muted)';
      tab.style.fontWeight = (i === n) ? '600' : '400';
    }
  });
}

function rcvLvmTypeChange() {
  var t = document.getElementById('rcvLvmType');
  if (!t) return;
  document.getElementById('rcvPoolRow').style.display = (t.value === 'thin') ? '' : 'none';
}

function rcvNext2() {
  var sid = document.getElementById('rcvStorageId').value.trim();
  if (!sid) { alert('Please enter a Storage Name.'); return; }
  var hosts = Array.from(document.querySelectorAll('.rcvHostCb:checked')).map(function (c) { return c.value; });
  if (!hosts.length) { alert('Select at least one PVE host.'); return; }
  var isSan = rcvState.protocol === 'iscsi' || rcvState.protocol === 'nvme';
  if (isSan) {
    rcvState.vg_name = document.getElementById('rcvVgName').value.trim();
    rcvState.lvm_type = document.getElementById('rcvLvmType').value;
    rcvState.pool_name = document.getElementById('rcvPoolName').value.trim() || 'data';
  }
  rcvState.ds_name = sid;  // use storage ID as name
  rcvState.storage_id = sid;
  rcvState.junction_override = (document.getElementById('rcvJunctionPath') || {}).value || '';
  rcvState.pve_host_ids = hosts;
  if (rcvState.protocol === 'nfs') {
    var lifSel = document.getElementById('rcvNfsLif');
    rcvState.nfs_ip = lifSel ? lifSel.value : '';
    if (!rcvState.nfs_ip) { alert('Please select an NFS LIF.'); return; }
  }

  // Build summary
  var smBreak = rcvState.has_sm && document.getElementById('rcvSmBreak').checked;
  var lines = [
    '📦 Volume: <strong>' + esc(rcvState.volume_name) + '</strong> (' + esc(rcvState.protocol.toUpperCase()) + ')',
    '💾 Storage Name: <strong>' + esc(rcvState.storage_id) + '</strong>',
  ];
  if (rcvState.protocol === 'nfs') {
    lines.push('🌐 NFS LIF: <strong>' + esc(rcvState.nfs_ip) + '</strong>');
  }
  if (isSan) {
    lines.push('🗄️  VG: <strong>' + (rcvState.vg_name || '<em style="color:var(--muted)">auto-detect</em>') + '</strong> (' + esc(rcvState.lvm_type) + ')');
    if (rcvState.lvm_type === 'thin') lines.push('📊 Thin pool: <strong>' + esc(rcvState.pool_name) + '</strong>');
  }
  if (rcvState.junction_override) {
    lines.push('🔗 Junction override: <strong>' + esc(rcvState.junction_override) + '</strong>');
  }
  lines.push('🖥️  PVE hosts: <strong>' + rcvState.pve_host_ids.length + '</strong> selected');
  if (smBreak) lines.push('⚡ SnapMirror® will be broken before mounting');
  document.getElementById('rcvSummary').innerHTML = lines.join('<br>');
  rcvShowStep(3);
}

async function rcvBind() {
  var smBreak = rcvState.has_sm && document.getElementById('rcvSmBreak').checked;
  var body = {
    name: rcvState.ds_name,
    endpoint_id: rcvState.endpoint_id,
    svm_name: rcvState.svm_name,
    volume_uuid: rcvState.volume_uuid,
    volume_name: rcvState.volume_name,
    protocol: rcvState.protocol,
    pve_storage_id: rcvState.storage_id,
    pve_host_ids: rcvState.pve_host_ids,
    vg_name: rcvState.vg_name || '',
    lvm_type: rcvState.lvm_type || 'linear',
    lvm_pool_name: rcvState.pool_name || 'data',
    junction_path_override: rcvState.junction_override || '',
    nfs_ip: rcvState.nfs_ip || '',
    snapmirror_break: smBreak,
    snapmirror_relationship_uuid: rcvState.sm_rel_uuid || '',
    size_bytes: 0,
  };
  document.getElementById('rcvBindSpinner').style.display = 'inline-block';
  document.getElementById('rcvBindErr').textContent = '';
  try {
    var r = await api('POST', 'provisioning/recovery/bind', body);
    toast(t('msg_bind_job_started_see_jobs_tab_for_progress'), 'success');
    hideBindWizard();
    setTimeout(function () { document.querySelector('[data-tab="jobs"]').click(); }, 800);
  } catch (e) {
    document.getElementById('rcvBindErr').textContent = e.message || String(e);
  }
  document.getElementById('rcvBindSpinner').style.display = 'none';
}


// ── Provisioning Tab — Bind Wizard toggle ────────────────────────────────────

function showBindWizard() {
  document.getElementById('bindWizModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  rcvLoadEndpoints();
}
function hideBindWizard() {
  document.getElementById('bindWizModal').style.display = 'none';
  document.body.style.overflow = '';
  rcvShowStep(1);
  document.getElementById('rcvVolumeTableWrap').style.display = 'none';
}

// ── Recovery Tab — VM Import ──────────────────────────────────────────────────

var _impState = { ds: null, snapName: '', vms: [], usedVmids: [], allDs: [] };

async function impLoadDatastores() {
  var sel = document.getElementById('impDs');
  if (!sel) return;
  sel.innerHTML = '<option value="">— loading… —</option>';
  try {
    var d = await apiFetch('provisioning/datastores');
    var rows = (d.datastores || []).filter(function (ds) { return ds.status === 'active'; });
    _impState.allDs = rows; // cache for storage ID dropdown
    sel.innerHTML = '<option value="">— select datastore —</option>';
    rows.forEach(function (ds) {
      var o = document.createElement('option');
      o.value = ds.id;
      o.dataset.proto = ds.protocol || 'nfs';
      o.dataset.sid = ds.pve_storage_id || ds.name;
      o.dataset.hostids = JSON.stringify(ds.pve_host_ids || []);
      var badge = ({ nfs: '[NFS]', iscsi: '[iSCSI]', nvme: '[NVMe]' })[ds.protocol] || '';
      o.textContent = ds.name + ' ' + badge;
      sel.appendChild(o);
    });
    if (!rows.length) sel.innerHTML = '<option value="">No active datastores found</option>';
  } catch (e) {
    sel.innerHTML = '<option value="">Error: ' + esc(e.message) + '</option>';
  }
  // Reset steps 1+2
  _impState.ds = null; _impState.snapName = ''; _impState.vms = []; _impState.usedVmids = [];
  document.getElementById('impVmsCard').style.display = 'none';
  document.getElementById('impSnapRow').style.display = 'none';
  document.getElementById('impSnapSanRow').style.display = 'none';
  document.getElementById('impHostRow').style.display = 'none';
  document.getElementById('impStorageRewSection').style.display = 'none';
  document.getElementById('impStorageOld').value = '';
}

async function impOnDsChange() {
  var sel = document.getElementById('impDs');
  var opt = sel.selectedOptions[0];
  var dsId = sel.value;
  var proto = (opt && opt.dataset.proto) || 'nfs';
  var hostIds = JSON.parse((opt && opt.dataset.hostids) || '[]');

  _impState.ds = dsId ? { id: dsId, proto: proto, sid: (opt && opt.dataset.sid) || '', hostIds: hostIds } : null;
  _impState.vms = [];
  _impState.snapName = '';

  document.getElementById('impVmsCard').style.display = 'none';
  document.getElementById('impLoadErr').textContent = '';
  document.getElementById('impSnapRow').style.display = 'none';
  document.getElementById('impSnapSanRow').style.display = 'none';
  document.getElementById('impHostRow').style.display = 'none';

  if (!dsId) return;

  // Load available PVE hosts for this datastore
  _impLoadHosts(hostIds);

  // Reset auto-detect section
  document.getElementById('impStorageRewSection').style.display = 'none';
  document.getElementById('impStorageOld').value = '';

  if (proto === 'nfs') {
    document.getElementById('impSnapRow').style.display = '';
    var snapSel = document.getElementById('impSnap');
    snapSel.innerHTML = '<option value="">Loading snapshots…</option>';
    try {
      var r = await apiFetch('provisioning/recovery/manifests?ds_id=' + encodeURIComponent(dsId));
      var snaps = r.snapshots || [];
      snapSel.innerHTML = snaps.length
        ? snaps.map(function (s) { return '<option value="' + esc(s.snap_name) + '">' + esc(s.snap_name) + '</option>'; }).join('')
        : '<option value="">No manifests found</option>';
    } catch (e) {
      snapSel.innerHTML = '<option value="">Error: ' + esc(e.message) + '</option>';
    }
  } else {
    // SAN: no snapshot chooser — just show info row
    document.getElementById('impSnapSanRow').style.display = '';
  }
}

async function _impLoadHosts(hostIds) {
  var hostSel = document.getElementById('impHostSel');
  var row = document.getElementById('impHostRow');
  hostSel.innerHTML = '<option value="">— Auto (first available) —</option>';
  if (!hostIds || !hostIds.length) return;
  try {
    var r = await apiFetch('provisioning/pve-hosts');
    var allHosts = r.hosts || [];
    var relevant = allHosts.filter(function (h) { return hostIds.indexOf(h.id) >= 0; });
    relevant.forEach(function (h) {
      var o = document.createElement('option');
      o.value = h.id;
      o.textContent = h.name + ' (' + h.host + ')';
      hostSel.appendChild(o);
    });
    if (relevant.length > 0) row.style.display = '';
  } catch (e) { /* silently ignore — Auto fallback works */ }
}

async function impLoadVms() {
  if (!_impState.ds) {
    document.getElementById('impLoadErr').textContent = 'Select a datastore first.';
    return;
  }
  var dsId = _impState.ds.id;
  var proto = _impState.ds.proto;
  var spinner = document.getElementById('impLoadSpinner');
  var errEl = document.getElementById('impLoadErr');
  spinner.style.display = '';
  errEl.textContent = '';

  var url = 'provisioning/recovery/manifests?ds_id=' + encodeURIComponent(dsId);
  if (proto === 'nfs') {
    var snapName = document.getElementById('impSnap').value;
    if (!snapName) { spinner.style.display = 'none'; errEl.textContent = 'Select a snapshot first.'; return; }
    url += '&snap_name=' + encodeURIComponent(snapName);
    _impState.snapName = snapName;
  } else {
    _impState.snapName = '';
  }

  try {
    var r = await apiFetch(url);
    var vms = r.vms || [];
    spinner.style.display = 'none';
    if (!vms.length) { errEl.textContent = 'No VMs found in manifest.'; return; }
    _impState.vms = vms;
    _impRenderVmTable();
    _impAutodetectStorageId(r);
    document.getElementById('impVmsCard').style.display = '';
    impFetchUsedVmids(); // pre-load used VMIDs for auto-assign
  } catch (e) {
    spinner.style.display = 'none';
    errEl.textContent = e.message || String(e);
  }
}

function _impRenderVmTable() {
  var tbody = document.getElementById('impVmsTbody');
  tbody.innerHTML = _impState.vms.map(function (vm) {
    var icon = vm.vmtype === 'lxc' ? '📦' : '🖥️';
    return '<tr data-vmid="' + vm.vmid + '">'
      + '<td><input type="checkbox" class="impVmCb" value="' + vm.vmid + '" checked></td>'
      + '<td style="font-family:var(--mono)">' + esc(String(vm.vmid)) + '</td>'
      + '<td>' + icon + ' ' + esc(vm.name || ('VM ' + vm.vmid)) + '</td>'
      + '<td><span class="badge badge-gray" style="font-size:10px">'
      + esc(vm.vmtype || 'qemu') + '</span></td>'
      + '<td class="impNewVmid" style="font-family:var(--mono)">' + esc(String(vm.vmid)) + '</td>'
      + '</tr>';
  }).join('');
  document.getElementById('impSelectAll').checked = true;
  impUpdateVmidPreview();
}

async function impFetchUsedVmids() {
  if (!_impState.ds) return;
  var spinner = document.getElementById('impUsedSpinner');
  var infoEl = document.getElementById('impUsedVmidsInfo');
  spinner.style.display = '';
  try {
    var r = await apiFetch('provisioning/recovery/used-vmids?ds_id='
      + encodeURIComponent(_impState.ds.id));
    _impState.usedVmids = r.vmids || [];
    spinner.style.display = 'none';
    infoEl.textContent = _impState.usedVmids.length
      ? 'Used VMIDs on cluster: ' + _impState.usedVmids.join(', ')
      : 'No VMIDs currently in use on the cluster.';
    impUpdateVmidPreview();
  } catch (e) {
    spinner.style.display = 'none';
    infoEl.textContent = 'Could not fetch used VMIDs: ' + (e.message || String(e));
  }
}

function impUpdateVmidPreview() {
  var mode = (document.querySelector('input[name="impVmidMode"]:checked') || {}).value || 'keep';
  var offset = parseInt((document.getElementById('impVmidOffset') || {}).value || '0', 10) || 0;
  var usedSet = new Set(_impState.usedVmids);

  // Build auto-assign map (next free IDs starting from 100)
  var autoMap = {};
  if (mode === 'auto' && _impState.vms.length) {
    var used2 = new Set(_impState.usedVmids);
    var nextId = 100;
    _impState.vms.forEach(function (vm) {
      while (used2.has(nextId)) { nextId++; }
      autoMap[vm.vmid] = nextId;
      used2.add(nextId);
      nextId++;
    });
  }

  document.querySelectorAll('#impVmsTbody tr[data-vmid]').forEach(function (row) {
    var origId = parseInt(row.dataset.vmid, 10);
    var cell = row.querySelector('.impNewVmid');
    if (!cell) return;
    var newId;
    if (mode === 'keep') { newId = origId; }
    else if (mode === 'offset') { newId = origId + offset; }
    else { newId = autoMap[origId] !== undefined ? autoMap[origId] : origId; }
    cell.textContent = String(newId);
    // Colour: conflict=red, changed=info, unchanged=normal text
    if (usedSet.has(newId)) { cell.style.color = 'var(--error)'; }
    else if (newId !== origId) { cell.style.color = 'var(--info)'; }
    else { cell.style.color = 'var(--text)'; }
  });
}

function impToggleAll(checked) {
  document.querySelectorAll('.impVmCb').forEach(function (cb) { cb.checked = checked; });
}

function _impAutodetectStorageId(r) {
  var detected = (r.detected_storage_ids || [])[0] || '';
  var currentSid = (_impState.ds && _impState.ds.sid) || '';
  var sect = document.getElementById('impStorageRewSection');
  var info = document.getElementById('impStorageRewInfo');
  var fields = document.getElementById('impStorageRewFields');
  var oldInput = document.getElementById('impStorageOld');
  var newInput = document.getElementById('impStorageNew');

  if (!detected) {
    sect.style.display = 'none';
    oldInput.value = '';
    return;
  }
  sect.style.display = '';
  newInput.value = currentSid;
  newInput.placeholder = currentSid || '(current datastore)';

  if (detected === currentSid) {
    info.innerHTML = '✓ Datastore name matches — no rewrite needed.';
    fields.style.display = 'none';
    oldInput.value = '';
    oldInput.placeholder = '(no rewrite needed)';
  } else {
    info.innerHTML = '⚠ Manifest references <strong style="color:var(--warning)">'
      + esc(detected) + '</strong> — will be rewritten to <strong style="color:var(--success)">'
      + esc(currentSid) + '</strong>.';
    fields.style.display = '';
    oldInput.value = detected;
    oldInput.placeholder = detected;
  }
}

async function impDoImport() {
  if (!_impState.ds) {
    document.getElementById('impImportErr').textContent = 'No datastore selected.';
    return;
  }
  var checked = document.querySelectorAll('.impVmCb:checked');
  if (!checked.length) {
    document.getElementById('impImportErr').textContent = 'Select at least one VM.';
    return;
  }

  // Build vmid_map from the New VMID column
  var vmid_map = {};
  checked.forEach(function (cb) {
    var origId = parseInt(cb.value, 10);
    var row = cb.closest('tr[data-vmid]');
    var newCell = row && row.querySelector('.impNewVmid');
    var newId = newCell ? parseInt(newCell.textContent, 10) : origId;
    vmid_map[origId] = newId;
  });

  // Use the input value; if empty fall back to the placeholder (auto-detected ID)
  var oldInput = document.getElementById('impStorageOld');
  var storageOld = (oldInput && (oldInput.value || oldInput.placeholder)) || '';
  if (storageOld === '(no rewrite needed)' || storageOld === '(auto-detected)') storageOld = '';
  var targetHostId = (document.getElementById('impHostSel') || {}).value || '';
  var btn = document.getElementById('impImportBtn');
  var spinner = document.getElementById('impImportSpinner');
  var errEl = document.getElementById('impImportErr');

  if (btn) { btn.disabled = true; }
  spinner.style.display = '';
  errEl.textContent = '';

  try {
    var r = await apiPost('provisioning/recovery/restore-vms', {
      ds_id: _impState.ds.id,
      snap_name: _impState.snapName,
      vmids: Object.keys(vmid_map).map(Number),
      vmid_offset: 0,
      storage_id_old: storageOld,
      vmid_map: vmid_map,
      target_host_id: targetHostId || null,
    });
    spinner.style.display = 'none';
    var cnt = r.restored || 0;
    var logLines = (r.log || []).filter(function (l) { return l; });
    toast(cnt + ' VM config(s) imported.', 'success');

    // ── Show "Import Complete" result panel; keep impVmsCard intact in DOM ──
    var card = document.getElementById('impVmsCard');
    card.style.display = 'none';  // hide but don't destroy (impVmsTbody etc. must stay)

    var esc = function (s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    // VM summary rows
    var vmRows = Object.entries(vmid_map).map(function (kv) {
      var orig = kv[0], nw = kv[1];
      var arrow = (orig != nw)
        ? '<span style="color:var(--muted)">→</span> <strong>' + esc(nw) + '</strong>'
        : '<span style="color:var(--muted);font-size:11px">unchanged</span>';
      return '<tr><td style="padding:3px 10px 3px 0">' + esc(orig) + '</td>'
        + '<td style="padding:3px 0">' + arrow + '</td></tr>';
    }).join('');

    // Log block
    var logBlock = logLines.length
      ? '<div style="margin-top:16px">'
      + '<div style="font-size:11px;font-weight:600;text-transform:uppercase;'
      + 'letter-spacing:.06em;color:var(--muted);margin-bottom:6px">Import Log</div>'
      + '<pre style="padding:10px 14px;background:var(--bg);border-radius:6px;font-size:10px;'
      + 'color:var(--text);font-family:var(--mono);white-space:pre-wrap;word-break:break-word;'
      + 'max-height:300px;overflow-y:auto;line-height:1.5">'
      + esc(logLines.join('\n'))
      + '</pre></div>'
      : '';

    var resultDiv = document.createElement('div');
    resultDiv.id = 'impResultCard';
    resultDiv.className = 'card';
    resultDiv.style.marginBottom = '12px';
    resultDiv.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">'
      + '<span style="font-size:28px;line-height:1">✅</span>'
      + '<div>'
      + '<div style="font-size:15px;font-weight:600;color:var(--success)">'
      + cnt + ' VM config(s) imported successfully'
      + '</div>'
      + '<div style="font-size:12px;color:var(--muted);margin-top:3px">'
      + 'Datastore: <strong>' + esc((_impState.ds || {}).name || (_impState.ds || {}).pve_storage_id || '') + '</strong>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '<table style="font-size:13px;margin-bottom:4px">'
      + '<thead><tr>'
      + '<th style="padding:0 14px 6px 0;font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.06em">Original VMID</th>'
      + '<th style="padding:0 0 6px 0;font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.06em">Imported as</th>'
      + '</tr></thead>'
      + '<tbody>' + vmRows + '</tbody>'
      + '</table>'
      + logBlock
      + '<div style="margin-top:20px;display:flex;gap:8px">'
      + '<button class="btn btn-primary" onclick="impResetWizard()">Import another</button>'
      + '</div>';

    card.parentNode.insertBefore(resultDiv, card);

  } catch (e) {
    spinner.style.display = 'none';
    if (btn) { btn.disabled = false; }
    errEl.textContent = e.message || String(e);
  }
}

function impResetWizard() {
  // Remove result panel if present
  var old = document.getElementById('impResultCard');
  if (old) old.remove();
  // Reset state & wizard
  _impState = { ds: null, snapName: null };
  var dsSel = document.getElementById('impDs');
  if (dsSel) dsSel.value = '';
  document.getElementById('impVmsCard').style.display = 'none';
  // Re-enable import button in case it's still disabled
  var btn = document.getElementById('impImportBtn');
  if (btn) btn.disabled = false;
  document.getElementById('impImportErr').textContent = '';
  impLoadDatastores();
}

// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// DEPLOY WIZARD
// ══════════════════════════════════════════════════════════════════════════════

var _setupCurrentStep = 1;
var _setupPveHosts = [];  // cached from status call
var _setupPkgData = {};  // host_id → {host, packages, error}
var _wizClusters = [];  // cached from ProxmoxVEx cluster list

function setupWizardOpen() {
  document.getElementById('setupWizardModal').style.display = '';
  document.body.style.overflow = 'hidden';
  setupWizardInit();
}

function setupWizardClose() {
  document.getElementById('setupWizardModal').style.display = 'none';
  document.body.style.overflow = '';
}

function setupWizardBackdropClick(e) {
  if (e.target === document.getElementById('setupWizardModal')) setupWizardClose();
}
function provWizBackdropClick(e) {
  if (e.target === document.getElementById('provWizModal')) hideProvWizard();
}
function bindWizBackdropClick(e) {
  if (e.target === document.getElementById('bindWizModal')) hideBindWizard();
}
function showVmImportModal() {
  document.getElementById('vmImportModal').style.display = '';
  document.body.style.overflow = 'hidden';
  impLoadDatastores();
}
function hideVmImportModal() {
  document.getElementById('vmImportModal').style.display = 'none';
  document.body.style.overflow = '';
}
function vmImportBackdropClick(e) {
  if (e.target === document.getElementById('vmImportModal')) hideVmImportModal();
}
function createSnapshotBackdropClick(e) {
  if (e.target === document.getElementById('createSnapshotForm')) hideForm('createSnapshotForm');
}
function addScheduleBackdropClick(e) {
  if (e.target === document.getElementById('addScheduleForm')) hideForm('addScheduleForm');
}
function addEndpointBackdropClick(e) {
  if (e.target === document.getElementById('addEndpointForm')) hideForm('addEndpointForm');
}
function addPveHostBackdropClick(e) {
  if (e.target === document.getElementById('addPveHostForm')) hideForm('addPveHostForm');
}

// Escape key closes any open modal
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (document.getElementById('setupWizardModal').style.display !== 'none') { setupWizardClose(); }
  else if (document.getElementById('provWizModal').style.display !== 'none') { hideProvWizard(); }
  else if (document.getElementById('bindWizModal').style.display !== 'none') { hideBindWizard(); }
  else if (document.getElementById('vmImportModal').style.display !== 'none') { hideVmImportModal(); }
  else if (document.getElementById('createSnapshotForm').style.display !== 'none') { hideForm('createSnapshotForm'); }
  else if (document.getElementById('addScheduleForm').style.display !== 'none') { hideForm('addScheduleForm'); }
  else if (document.getElementById('addEndpointForm').style.display !== 'none') { hideForm('addEndpointForm'); }
  else if (document.getElementById('addPveHostForm').style.display !== 'none') { hideForm('addPveHostForm'); }
  else if (typeof _drModalIds !== 'undefined') {
    var openDr = _drModalIds.find(function (id) { var el = document.getElementById(id + 'Modal'); return el && el.style.display !== 'none'; });
    if (openDr) drHideModal(openDr);
  }
});

async function setupWizardInit() {
  try {
    var r = await apiFetch('setup/status');
    if (r.ssh_pubkey) {
      document.getElementById('setupSshPubKey').textContent = r.ssh_pubkey;
      document.getElementById('setupSshKeyBox').style.display = '';
    }
    // Pre-load lists so steps 2+4 feel instant when navigated to
    wizRefreshPveHosts();
    wizRefreshEndpoints();
  } catch (e) { /* silent */ }
  setupShowStep(1);
}

function setupShowStep(n) {
  _setupCurrentStep = n;
  for (var i = 1; i <= 4; i++) {
    var card = document.getElementById('setupStep' + i);
    var pill = document.getElementById('spill' + i);
    if (card) card.style.display = (i === n) ? '' : 'none';
    if (pill) {
      pill.classList.remove('active');
      if (i === n) pill.classList.add('active');
    }
  }
  if (n === 2) wizStep2Load();
  if (n === 3) wizRefreshEndpoints();
}

// ── Step 2: PVE Hosts & Packages — unified load ──────────────────────────

var _wizHostStatus = {};  // host.id → { ssh: {ok,error}, pkgs: {pkg:bool}|null }
var _wizFixHostId = null;

var _WIZ_PKGS = ['nfs-common', 'open-iscsi', 'multipath-tools', 'lvm2', 'nvme-cli'];

async function wizStep2Load() {
  var el = document.getElementById('wizHostTable');
  var sp = document.getElementById('wizStep2Spinner');
  if (!el) return;
  el.innerHTML = '<span style="color:var(--muted);font-size:13px">Detecting hosts…</span>';
  if (sp) sp.style.display = '';

  // 1. Load clusters + import all nodes (idempotent)
  try {
    if (!_wizClusters.length) {
      var rc = await apiFetch('setup/pve-clusters');
      _wizClusters = rc.clusters || [];
    }
    await Promise.all(_wizClusters.map(async function (c) {
      if (!c.nodes || !c.nodes.length) return;
      var nodes = c.nodes.map(function (n) { return n.node; });
      try { await apiPost('setup/import-pve-nodes', { cluster_id: c.id, nodes: nodes }); }
      catch (e) { /* already imported is fine */ }
    }));
  } catch (e) {
    el.innerHTML = '<span class="setup-err">❌ Failed to load clusters: ' + esc(e.message || String(e)) + '</span>';
    if (sp) sp.style.display = 'none';
    return;
  }

  // 2. Load PVE host list
  var hosts = [];
  try {
    hosts = await apiFetch('pve-hosts');
    _setupPveHosts = hosts;
  } catch (e) {
    el.innerHTML = '<span class="setup-err">❌ Failed to load PVE hosts: ' + esc(e.message || String(e)) + '</span>';
    if (sp) sp.style.display = 'none';
    return;
  }

  if (!hosts.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:12px 0">No PVE hosts found — make sure ProxmoxVEx clusters are configured.</div>';
    if (sp) sp.style.display = 'none';
    return;
  }

  // 3. SSH test all hosts at once
  var sshByName = {};
  try {
    var sr = await apiPost('setup/test-ssh', {});
    (sr.results || []).forEach(function (r) { sshByName[r.name] = r; });
  } catch (e) { /* will show as unknown */ }

  // 4. Package check for reachable hosts in parallel
  var pkgById = {};
  await Promise.all(hosts.map(async function (h) {
    var ssh = sshByName[h.name];
    if (ssh && !ssh.ok) { pkgById[h.id] = null; return; }
    try {
      var pr = await apiPost('setup/check-packages', { host_id: h.id });
      pkgById[h.id] = pr.packages || {};
    } catch (e) {
      pkgById[h.id] = null;
    }
  }));

  if (sp) sp.style.display = 'none';

  // Build status map for fix dialog
  _wizHostStatus = {};
  hosts.forEach(function (h) {
    _wizHostStatus[h.id] = { host: h, ssh: sshByName[h.name] || null, pkgs: pkgById[h.id] };
  });

  _wizRenderHostTable(hosts, sshByName, pkgById);
  loadPveHosts();
}

function _wizRenderHostTable(hosts, sshByName, pkgById) {
  var el = document.getElementById('wizHostTable');
  if (!el) return;

  var html = '<table style="border-collapse:collapse;width:100%;font-size:13px">';
  html += '<thead><tr style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);border-bottom:2px solid var(--border)">';
  html += '<th style="text-align:left;padding:5px 12px 5px 0;font-weight:600">Host</th>';
  html += '<th style="text-align:left;padding:5px 8px;font-weight:600">SSH</th>';
  html += '<th style="text-align:left;padding:5px 8px;font-weight:600">Packages</th>';
  html += '<th style="padding:5px 0"></th>';
  html += '</tr></thead><tbody>';

  hosts.forEach(function (h) {
    var ssh = sshByName[h.name] || null;
    var pkgs = pkgById[h.id];

    // SSH cell
    var sshCell;
    if (!ssh) sshCell = '<span style="color:var(--muted)">—</span>';
    else if (ssh.ok) sshCell = '<span class="setup-ok">✅ OK</span>';
    else sshCell = '<span class="setup-err">❌ Failed</span>';

    // Packages cell
    var pkgCell;
    if (!ssh || !ssh.ok) {
      pkgCell = '<span style="color:var(--muted)">—</span>';
    } else if (pkgs === null) {
      pkgCell = '<span style="color:var(--muted)">—</span>';
    } else {
      var missing = _WIZ_PKGS.filter(function (p) { return pkgs[p] === false; });
      pkgCell = missing.length === 0
        ? '<span class="setup-ok">✅ All present</span>'
        : '<span class="setup-warn">⚠️ ' + missing.length + ' missing</span>';
    }

    // Action cell
    var actionCell = '';
    if (ssh && !ssh.ok) {
      actionCell = '<button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="wizShowHostFix(' + JSON.stringify(h.id) + ')">Fix →</button>';
    } else if (pkgs !== null) {
      var miss2 = _WIZ_PKGS.filter(function (p) { return pkgs[p] === false; });
      if (miss2.length) {
        actionCell = '<button class="btn btn-warning btn-sm" style="font-size:11px" onclick="wizInstallHostPkgs(' + JSON.stringify(h.id) + ',' + JSON.stringify(miss2) + ')">Install ' + miss2.length + ' pkg' + (miss2.length > 1 ? 's' : '') + '</button>';
      }
    }

    html += '<tr style="border-bottom:1px solid var(--border)">';
    html += '<td style="padding:7px 12px 7px 0"><strong>' + esc(h.name) + '</strong> ' +
      '<span style="color:var(--muted);font-size:11px">' + esc(h.host) + ':' + (h.port || 8006) + '</span></td>';
    html += '<td style="padding:7px 8px;white-space:nowrap">' + sshCell + '</td>';
    html += '<td style="padding:7px 8px;white-space:nowrap">' + pkgCell + '</td>';
    html += '<td style="padding:7px 0;white-space:nowrap">' + actionCell + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table>';
  el.innerHTML = html;
}

async function wizInstallHostPkgs(hostId, packages) {
  var el = document.getElementById('wizPkgInstallMsg');
  el.textContent = 'Starting install…';
  try {
    var r = await apiPost('setup/install-packages', { host_id: hostId, packages: packages });
    if (r.job_id) {
      el.innerHTML = '✅ Install job started — <a href="#" onclick="showTabByName(\'jobs\');return false">view in Jobs tab</a>';
    } else {
      el.innerHTML = '<span class="setup-err">❌ ' + esc(r.error || 'Failed') + '</span>';
    }
  } catch (e) {
    el.innerHTML = '<span class="setup-err">❌ ' + esc(e.message || String(e)) + '</span>';
  }
}

// ── SSH Fix Panel ─────────────────────────────────────────────────────────

function wizShowHostFix(hostId) {
  _wizFixHostId = hostId;
  var st = _wizHostStatus[hostId] || {};
  var h = st.host || {};
  var ssh = st.ssh || {};

  var infoEl = document.getElementById('wizFixHostInfo');
  if (infoEl) {
    var errLine = ssh.error
      ? '<div style="color:var(--danger);font-size:12px;margin-top:4px">Error: ' + esc(ssh.error) + '</div>'
      : '';
    infoEl.innerHTML = '<strong>' + esc(h.name || '') + '</strong> ' +
      '<span style="color:var(--muted)">' + esc(h.host || '') + ':' + (h.port || 8006) + '</span>' + errLine;
  }

  var keyEl = document.getElementById('wizFixSshKey');
  var srcKey = document.getElementById('setupSshPubKey');
  if (keyEl) keyEl.textContent = (srcKey && srcKey.textContent) || 'Run System Check first to generate the key.';

  var sshRes = document.getElementById('wizFixSshResult');
  var pushRes = document.getElementById('wizFixPushResult');
  var passEl = document.getElementById('wizFixHostPass');
  if (sshRes) sshRes.innerHTML = '';
  if (pushRes) pushRes.innerHTML = '';
  if (passEl) passEl.value = '';

  document.getElementById('wizHostMainView').style.display = 'none';
  document.getElementById('wizFixPanel').style.display = '';
}

function wizHideHostFix() {
  document.getElementById('wizFixPanel').style.display = 'none';
  document.getElementById('wizHostMainView').style.display = '';
}

function wizFixCopySshKey() {
  var key = document.getElementById('wizFixSshKey').textContent;
  if (key) navigator.clipboard.writeText(key).catch(function () { });
}

async function wizRetestHostSsh() {
  var sp = document.getElementById('wizFixSshSpinner');
  var el = document.getElementById('wizFixSshResult');
  sp.style.display = '';
  el.textContent = '';
  try {
    var r = await apiPost('setup/test-ssh', { host_id: _wizFixHostId });
    var result = (r.results && r.results[0]) || r;
    if (result.ok) {
      el.innerHTML = '<span class="setup-ok">✅ SSH OK — close this dialog and re-check all.</span>';
    } else {
      el.innerHTML = '<span class="setup-err">❌ Still failing: ' + esc(result.error || 'Unknown error') + '</span>';
    }
  } catch (e) {
    el.innerHTML = '<span class="setup-err">❌ ' + esc(e.message || String(e)) + '</span>';
  } finally {
    sp.style.display = 'none';
  }
}

async function wizPushHostKey() {
  var sp = document.getElementById('wizFixPushSpinner');
  var el = document.getElementById('wizFixPushResult');
  var pass = document.getElementById('wizFixHostPass').value;
  if (!pass) { el.innerHTML = '<span class="setup-err">Enter the root password first.</span>'; return; }
  sp.style.display = '';
  el.textContent = '';
  try {
    var r = await apiPost('setup/push-ssh-key', { host_id: _wizFixHostId, password: pass });
    if (r.ok) {
      el.innerHTML = '<span class="setup-ok">✅ ' + esc(r.message || 'Key pushed.') + ' Test SSH to verify.</span>';
      document.getElementById('wizFixHostPass').value = '';
    } else {
      el.innerHTML = '<span class="setup-err">❌ ' + esc(r.error || 'Failed') + '</span>';
    }
  } catch (e) {
    el.innerHTML = '<span class="setup-err">❌ ' + esc(e.message || String(e)) + '</span>';
  } finally {
    sp.style.display = 'none';
  }
}

// ── Step 4: NetApp Systems — combined add + create user ───────────────────

async function wizRefreshEndpoints() {
  try {
    var rows = await apiFetch('endpoints');
    var el = document.getElementById('wizEpList');
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '';
      return;
    }
    var html = '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px">Registered Systems</div>';
    html += '<table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:10px"><tbody>';
    rows.forEach(function (ep) {
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:5px 10px 5px 0"><strong>' + esc(ep.name) + '</strong>' +
        '<br><span style="color:var(--muted);font-size:11px">' + esc(ep.host) + ' · ' + esc(ep.username) + '</span></td>' +
        '<td id="wizEpStatus_' + ep.id + '" style="font-size:12px;color:var(--muted);padding:5px 6px">—</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  } catch (e) {
    var el2 = document.getElementById('wizEpList');
    if (el2) el2.innerHTML = '<span class="setup-err">Failed to load endpoints: ' + esc(e.message) + '</span>';
  }
}

async function wizAddOntapSystem() {
  var sp = document.getElementById('wizAddEpSpinner');
  var el = document.getElementById('wizAddEpResult');
  var name = document.getElementById('wiz_ep_name').value.trim();
  var host = document.getElementById('wiz_ep_host').value.trim();
  var adminUser = document.getElementById('wiz_ep_admin_user').value.trim();
  var adminPass = document.getElementById('wiz_ep_admin_pass').value;
  var newUser = document.getElementById('wiz_ep_user').value.trim();
  var newPass = document.getElementById('wiz_ep_pass').value;
  var role = document.getElementById('wiz_ep_role').value;
  var ssl_verify = document.getElementById('wiz_ep_ssl').checked;

  if (!name || !host || !adminPass || !newPass) {
    el.innerHTML = '<span class="setup-err">❌ Name, host, admin password and plugin password are required.</span>';
    return;
  }
  sp.style.display = '';
  el.innerHTML = '<span style="color:var(--muted)">Connecting to ONTAP…</span>';
  try {
    var r = await apiPost('setup/add-ontap-system', {
      name, host,
      admin_user: adminUser,
      admin_password: adminPass,
      new_username: newUser,
      new_password: newPass,
      role,
      ssl_verify,
    });
    if (r.ok) {
      var lines = [];
      lines.push('✅ <strong>' + esc(r.cluster_name || host) + '</strong>' +
        (r.version ? ' · ONTAP ' + esc(r.version) : ''));
      lines.push(r.user_created
        ? '🔑 User <code>' + esc(newUser) + '</code> created with role <em>' + esc(role) + '</em>'
        : '🔑 User <code>' + esc(newUser) + '</code> already existed — endpoint updated');
      lines.push(r.ep_created ? '📝 Endpoint registered.' : '📝 Endpoint credentials updated.');
      el.innerHTML = '<span class="setup-ok">' + lines.join('<br>') + '</span>';
      // Clear fields so form is ready for the next system
      document.getElementById('wiz_ep_name').value = '';
      document.getElementById('wiz_ep_host').value = '';
      document.getElementById('wiz_ep_admin_pass').value = '';
      document.getElementById('wiz_ep_pass').value = '';
      await wizRefreshEndpoints();
      loadEndpoints();
      setupTestEndpoints();
    } else {
      el.innerHTML = '<span class="setup-err">❌ ' + esc(r.error || 'Unknown error') + '</span>';
    }
  } catch (e) {
    el.innerHTML = '<span class="setup-err">❌ ' + esc(e.message || String(e)) + '</span>';
  } finally {
    sp.style.display = 'none';
  }
}

// ── Step 1: System checks ──────────────────────────────────────────────────

async function setupRunSystemCheck() {
  var sp = document.getElementById('setupSysSpinner');
  var el = document.getElementById('setupDepsResult');
  sp.style.display = '';
  el.textContent = '';
  try {
    // SSH key fetch is non-fatal — show warning in key box if it fails
    var keyHint = '';
    try {
      var key = await apiFetch('setup/ssh-pubkey');
      if (key.pubkey) {
        document.getElementById('setupSshPubKey').textContent = key.pubkey;
        document.getElementById('setupSshKeyBox').style.display = '';
      }
    } catch (keyErr) {
      var errMsg = (keyErr.data && keyErr.data.error) ? keyErr.data.error : keyErr.message;
      var hintMsg = (keyErr.data && keyErr.data.hint) ? keyErr.data.hint : '';
      var autoFixed = (keyErr.data && keyErr.data.auto_fix_attempted);
      document.getElementById('setupSshKeyBox').style.display = '';
      document.getElementById('setupSshPubKey').textContent = '';
      // Render hint: replace newlines with <br> and format indented lines as code
      var hintHtml = '';
      if (hintMsg) {
        var lines = esc(hintMsg).split('\n');
        hintHtml = '<div style="margin-top:6px;font-size:11px;color:var(--muted)">' +
          lines.map(function (l) {
            var trimmed = l.trimStart();
            // Lines that start with spaces followed by a command get code formatting
            if (l.match(/^\s{2,}/)) {
              return '<code style="display:block;margin:1px 0 1px 12px;white-space:pre">' + trimmed + '</code>';
            }
            return '<span>' + l + '</span><br>';
          }).join('') +
          '</div>';
      }
      keyHint = '<tr><td colspan="3" style="padding:6px 0">' +
        '<span class="setup-err">⚠️ SSH key: ' + esc(errMsg) + '</span>' +
        (autoFixed ? '<span style="font-size:11px;color:var(--muted);margin-left:8px">(automatic fix attempted)</span>' : '') +
        hintHtml +
        '</td></tr>';
    }

    var s = await apiFetch('setup/status');
    var deps = s.deps || {};
    var items = [
      ['requests', 'Python requests library', true],
      ['ssh', 'ssh command (OpenSSH)', true],
      ['sshpass', 'sshpass (for password auth)', false],
    ];
    var html = '<table style="border-collapse:collapse;width:100%;font-size:13px"><tbody>';
    items.forEach(function (item) {
      var key = item[0], label = item[1], required = item[2];
      var ok = deps[key];
      var cls = ok ? 'setup-ok' : (required ? 'setup-err' : 'setup-warn');
      var ico = ok ? '✅' : (required ? '❌' : '⚠️');
      var hint = !ok ? (key === 'requests' ? '<code>pip3 install requests</code>' :
        key === 'ssh' ? '<code>apt-get install openssh-client</code>' :
          key === 'sshpass' ? '<code>apt-get install sshpass</code>' : '') : '';
      html += '<tr><td style="padding:3px 8px 3px 0;width:200px">' + label + '</td>';
      html += '<td class="' + cls + '">' + ico + ' ' + (ok ? 'OK' : 'Missing') + '</td>';
      html += '<td style="color:var(--muted);font-size:11px">' + hint + '</td></tr>';
    });
    html += keyHint + '</tbody></table>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<span class="setup-err">❌ ' + esc(e.message || String(e)) + '</span>';
  } finally {
    sp.style.display = 'none';
  }
}

function setupCopySshKey() {
  var key = document.getElementById('setupSshPubKey').textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(key).then(function () { toast(t('msg_ssh_key_copied'), 'success'); });
  } else {
    toast(t('msg_copy_not_supported_select_key_manually'), 'warning');
  }
}

// ── Step 2: Test ONTAP endpoints ──────────────────────────────────────────

async function setupTestEndpoints() {
  var sp = document.getElementById('setupEpSpinner');
  var el = document.getElementById('setupEpResult');
  sp.style.display = '';
  el.textContent = 'Testing…';
  try {
    var r = await apiPost('setup/test-endpoints', {});
    var results = r.results || [];
    if (!results.length) {
      el.innerHTML = '<span class="setup-warn">⚠️ No endpoints configured. Use <em>+ Add NetApp System</em> above.</span>';
      return;
    }
    var html = '<table style="border-collapse:collapse;width:100%;font-size:13px"><tbody>';
    results.forEach(function (ep) {
      var ico = ep.ok ? '✅' : '❌';
      var cls = ep.ok ? 'setup-ok' : 'setup-err';
      html += '<tr>';
      html += '<td style="padding:3px 8px 3px 0;width:220px"><strong>' + esc(ep.name) + '</strong> <span style="color:var(--muted);font-size:11px">' + esc(ep.host) + '</span></td>';
      html += '<td class="' + cls + '">' + ico + ' ' + (ep.ok ? 'Reachable' : 'Failed') + '</td>';
      html += '<td style="font-size:11px;color:' + (ep.ok ? 'var(--muted)' : 'var(--error)') + '">';
      html += ep.ok ? (esc(ep.cluster || '') + (ep.version ? ' · ' + esc(ep.version) : '')) : esc(ep.error || '');
      html += '</td></tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<span class="setup-err">❌ ' + esc(e.message || String(e)) + '</span>';
  } finally {
    sp.style.display = 'none';
  }
}

// ── Step 3: Create ONTAP user ─────────────────────────────────────────────

async function setupCreateOntapUser() {
  var sp = document.getElementById('setupUserSpinner');
  var el = document.getElementById('setupUserResult');
  sp.style.display = '';
  el.textContent = '';
  var newUser = document.getElementById('setupNewUser').value.trim();
  var body = {
    host: document.getElementById('setupOntapHost').value.trim(),
    admin_user: document.getElementById('setupAdminUser').value.trim(),
    admin_password: document.getElementById('setupAdminPass').value,
    new_username: newUser,
    new_password: document.getElementById('setupNewPass').value,
    ssl_verify: document.getElementById('setupSslVerify').checked,
    role: document.getElementById('setupOntapRole').value,
  };
  if (!body.host || !body.admin_password || !body.new_password) {
    sp.style.display = 'none';
    el.innerHTML = '<span class="setup-err">❌ Host, admin password and new password are required.</span>';
    return;
  }
  try {
    var r = await apiPost('setup/create-ontap-user', body);
    if (r.ok) {
      var msg = r.created
        ? '✅ User <strong>' + esc(newUser) + '</strong> created. Add or update endpoint credentials below.'
        : '⚠️ User <strong>' + esc(newUser) + '</strong> already exists on this cluster.';
      el.innerHTML = '<span class="' + (r.created ? 'setup-ok' : 'setup-warn') + '">' + msg + '</span>';
    } else {
      el.innerHTML = '<span class="setup-err">❌ ' + esc(r.error || 'Unknown error') + '</span>';
    }
  } catch (e) {
    el.innerHTML = '<span class="setup-err">❌ ' + esc(e.message || String(e)) + '</span>';
  } finally {
    sp.style.display = 'none';
  }
}


// helper: click a top-level nav tab by data-tab name
function showTabByName(name) {
  var pill = document.querySelector('.nav-tabs [data-tab="' + name + '"]');
  if (pill) pill.click();
}

// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// DISASTER RECOVERY  (v3.0 — direct peer sync)
// ══════════════════════════════════════════════════════════════════════════════

var _drCurrentPlanId = null;
var _drActiveSubTab = 'entries';
var _drCurrentGroupId = null;
var _drEntriesMap = {};
var _drModalIds = ['drAddPlan', 'drAddEntry', 'drAddGroup', 'drAddVm', 'drRole', 'drEditEntry', 'drFailover'];

function drShowModal(id) { document.getElementById(id + 'Modal').style.display = 'block'; }
function drHideModal(id) {
  var el = document.getElementById(id + 'Modal'); if (el) el.style.display = 'none';
  if (_drCurrentPlanId) { setTimeout(function () { drShowSubTab(_drActiveSubTab, null); }, 0); }
}

function drShowSubTab(name, el) {
  _drActiveSubTab = name;
  ['entries', 'groups'].forEach(function (t) { document.getElementById('drSubTab-' + t).style.display = t === name ? '' : 'none'; });
  document.querySelectorAll('[data-dr-tab]').forEach(function (e) { e.classList.remove('active'); });
  if (el) el.classList.add('active');
  else { var btn = document.querySelector('[data-dr-tab="' + name + '"]'); if (btn) btn.classList.add('active'); }
}

// ── Role ──────────────────────────────────────────────────────────────────────

async function drLoadRole() {
  try {
    var r = await apiFetch('dr/role');
    var banner = document.getElementById('drRoleBanner');
    var icon = document.getElementById('drRoleIcon');
    var label = document.getElementById('drRoleLabel');
    var sub = document.getElementById('drRoleSubtitle');
    var role = r.role || 'PRIMARY';
    var peer = r.peer || null;

    if (role === 'PRIMARY') {
      banner.style.borderColor = 'var(--success,#198754)';
      icon.textContent = '🟢'; label.textContent = 'PRIMARY'; label.style.color = 'var(--success,#198754)';
      sub.textContent = 'This instance manages DR plans and pushes sync to the Secondary.';
    } else if (role === 'SECONDARY') {
      banner.style.borderColor = 'var(--warning,#ffc107)';
      icon.textContent = '🟡'; label.textContent = 'SECONDARY'; label.style.color = 'var(--warning,#a07000)';
      sub.textContent = 'Standby — receives plan sync from Primary. Ready for failover.';
    } else {
      banner.style.borderColor = 'var(--border)';
      icon.textContent = '⚪'; label.textContent = 'STANDALONE'; label.style.color = '';
      sub.textContent = 'No peer configured — operates independently.';
    }
    if (r.role_forced) sub.textContent += ' [forced override active]';
    if (peer) {
      var peerStatus = peer.sync_status === 'online' ? '🟢 Peer online' : peer.sync_status === 'offline' ? '🔴 Peer offline' : '⚪ Peer unconfigured';
      sub.textContent += ' · ' + peerStatus;
    }
  } catch (e) { document.getElementById('drRoleSubtitle').textContent = 'Could not load role info'; }
}

async function drShowRoleModal() {
  try {
    var r = await apiFetch('dr/role');
    document.getElementById('drRoleSelect').value = r.role || 'PRIMARY';
    document.getElementById('drRoleForcedCheck').checked = !!r.role_forced;
  } catch (e) { }
  drShowModal('drRole');
}

async function drSaveRole() {
  var role = document.getElementById('drRoleSelect').value;
  var forced = document.getElementById('drRoleForcedCheck').checked;
  try {
    await apiPost('dr/role/set', { role, forced });
    toast(t('msg_role_set_to') + role, 'success');
    drHideModal('drRole'); drLoadRole();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Peer management ───────────────────────────────────────────────────────────

async function drLoadPeerStatus() {
  var el = document.getElementById('drPeerStatusSection');
  try {
    var p = await apiFetch('dr/peer/status');
    if (!p.configured) {
      el.innerHTML = '<div class="card" style="padding:.75rem 1rem;display:flex;align-items:center;justify-content:space-between">'
        + '<div><span style="color:var(--warning,#a07000)">⚠ No peer configured</span>'
        + ' <span style="color:var(--muted);font-size:.82rem">— Direct plugin-to-plugin sync not active.</span></div>'
        + '<button class="btn btn-primary btn-sm" onclick="drShowPeerConfigModal()">⚙ Configure Peer</button>'
        + '</div>';
      return;
    }
    var statusColor = p.sync_status === 'online' ? 'var(--success,#198754)' : p.sync_status === 'offline' ? 'var(--error,#f85149)' : 'var(--warning,#a07000)';
    var statusIcon = p.sync_status === 'online' ? '🟢' : p.sync_status === 'offline' ? '🔴' : '🟡';
    var lastSeen = p.last_seen ? p.last_seen.slice(0, 19).replace('T', ' ') : 'never';
    var lastSync = p.last_sync_sent ? p.last_sync_sent.slice(0, 19).replace('T', ' ') : 'never';
    var peerRoleBadge = p.peer_role ? '<span class="badge badge-info" style="font-size:.72rem">' + esc(p.peer_role) + '</span>' : '';
    el.innerHTML = '<div class="card" style="padding:.75rem 1rem">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem">'
      + '<div style="display:flex;align-items:center;gap:.75rem">'
      + '<span style="font-size:1.4rem">' + statusIcon + '</span>'
      + '<div>'
      + '<div style="font-weight:600">' + esc(p.name || p.url) + ' ' + peerRoleBadge + '</div>'
      + '<div style="font-size:.78rem;color:var(--muted)">'
      + '<span style="color:' + statusColor + '">' + esc(p.sync_status) + '</span>'
      + ' · Last seen: ' + esc(lastSeen)
      + ' · Last sync: ' + esc(lastSync)
      + (p.sync_error ? ' · <span style="color:var(--error,#f85149)">' + esc(p.sync_error.slice(0, 80)) + '</span>' : '')
      + '</div>'
      + '</div></div>'
      + '<div style="display:flex;gap:.4rem">'
      + '<button class="btn btn-ghost btn-sm" onclick="drPushSync()">⬆ Sync now</button>'
      + '<button class="btn btn-ghost btn-sm" onclick="drShowPeerConfigModal()">⚙ Edit</button>'
      + '<button class="btn btn-danger btn-sm" onclick="drRemovePeer()">🗑 Remove</button>'
      + '</div>'
      + '</div></div>';
  } catch (e) { el.innerHTML = '<div class="alert alert-danger" style="font-size:.85rem">' + esc(e.message) + '</div>'; }
}

async function drShowPeerConfigModal() {
  document.getElementById('drPeerConfigError').style.display = 'none';
  try {
    var p = await apiFetch('dr/peer/status');
    if (p.configured) {
      document.getElementById('peerConfigName').value = p.name || '';
      document.getElementById('peerConfigUrl').value = p.url || '';
      document.getElementById('peerConfigToken').value = '';
      document.getElementById('peerConfigSsl').checked = !!p.ssl_verify;
    } else {
      ['peerConfigName', 'peerConfigUrl', 'peerConfigToken'].forEach(function (id) { document.getElementById(id).value = ''; });
      document.getElementById('peerConfigSsl').checked = false;
    }
  } catch (e) { }
  document.getElementById('drPeerConfigModal').style.display = 'block';
}

function peerGenerateToken() {
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var token = '';
  for (var i = 0; i < 36; i++) token += i === 8 || i === 13 || i === 18 || i === 23 ? '-' : chars[Math.floor(Math.random() * chars.length)];
  document.getElementById('peerConfigToken').value = token;
}

async function drSavePeerConfig() {
  var errEl = document.getElementById('drPeerConfigError');
  errEl.style.display = 'none';
  var payload = {
    name: document.getElementById('peerConfigName').value.trim() || 'DR Site',
    url: document.getElementById('peerConfigUrl').value.trim(),
    ssl_verify: document.getElementById('peerConfigSsl').checked,
    sync_token: document.getElementById('peerConfigToken').value.trim(),
  };
  if (!payload.url) { errEl.textContent = 'Peer URL is required'; errEl.style.display = ''; return; }
  try {
    var r = await apiPost('dr/peer/configure', payload);
    document.getElementById('drPeerConfigModal').style.display = 'none';
    toast(t('msg_peer_configured_sync_token') + r.sync_token, 'success');
    drLoadPeerStatus(); drLoadRole();
  } catch (e) { errEl.textContent = e.message; errEl.style.display = ''; }
}

async function drRemovePeer() {
  if (!await uiConfirm(t('msg_remove_peer_configuration_sync_will_stop'))) return;
  try { await apiPost('dr/peer/remove', {}); toast(t('msg_peer_removed'), 'success'); drLoadPeerStatus(); drLoadRole(); }
  catch (e) { toast(e.message, 'error'); }
}

async function drPushSync() {
  try {
    var r = await apiPost('dr/peer/sync/push', {});
    if (r.ok) toast(t('msg_sync_pushed_to_peer'), 'success');
    else toast(t('msg_sync_failed') + (r.error || 'unknown error'), 'error');
    drLoadPeerStatus();
  } catch (e) { toast(e.message, 'error'); }
}

async function drInit() {
  drLoadRole();
  drLoadPeerStatus();
  drLoadPlans();
}

// ── DR Plans ──────────────────────────────────────────────────────────────────

function formatLag(lagStr) {
  if (!lagStr) return '';
  var m = lagStr.match(/PT?(?:(\d+)D)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return lagStr;
  var d = parseInt(m[1] || 0), h = parseInt(m[2] || 0), min = parseInt(m[3] || 0);
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + min + 'm';
  return min + 'm';
}

function drLagBadge(lagTime, healthy) {
  if (healthy === false) return '<span class="badge badge-danger">❌ unhealthy</span>';
  if (!lagTime) return '<span class="badge">—</span>';
  var pretty = formatLag(lagTime);
  var cls = 'badge-success';
  var m = lagTime.match(/PT?(?:(\d+)H)?(?:(\d+)M)?/);
  if (m && parseInt(m[1] || 0) > 0) cls = 'badge-warning';
  return '<span class="badge ' + cls + '">' + esc(pretty) + '</span>';
}

function drStateBadge(state) {
  var map = { standby: 'badge-info', failover_running: 'badge-warning', failed_over: 'badge-success', failback_running: 'badge-warning' };
  return '<span class="badge ' + (map[state] || '') + '">' + esc(state || 'standby') + '</span>';
}

async function drLoadPlans() {
  try {
    var plans = await apiFetch('dr/plans');
    var el = document.getElementById('drPlansList');
    if (!plans.length) { el.innerHTML = '<div class="muted-hint">No DR plans yet. Create a plan to get started.</div>'; return; }
    el.innerHTML = plans.map(function (p) {
      return '<div class="card" style="margin-bottom:.5rem;cursor:pointer" onclick="drOpenPlanDetail(\'' + esc(p.id) + '\',event)">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem">'
        + '<div style="flex:1"><div style="font-weight:600">📋 ' + esc(p.name) + ' ' + drStateBadge(p.state) + '</div>'
        + '<div style="font-size:.78rem;color:var(--muted);margin-top:.2rem">'
        + p.entry_count + ' datastore(s) · ' + p.group_count + ' group(s)'
        + (p.last_failover_at ? '<span class="muted-hint"> · Last failover: ' + p.last_failover_at.slice(0, 16).replace('T', ' ') + '</span>' : '')
        + '</div></div>'
        + '<div style="display:flex;gap:.4rem" onclick="event.stopPropagation()">'
        + '<button class="btn btn-ghost btn-xs" onclick="drOpenPlanDetail(\'' + esc(p.id) + '\')">Open</button>'
        + '<button class="btn btn-danger btn-xs" onclick="drDeletePlan(\'' + esc(p.id) + '\')">Delete</button>'
        + '</div></div></div>';
    }).join('');
  } catch (e) { document.getElementById('drPlansList').innerHTML = '<div class="alert alert-danger">' + esc(e.message) + '</div>'; }
}

function drShowAddPlanModal() {
  document.getElementById('drPlanName').value = '';
  document.getElementById('drPlanNotes').value = '';
  drShowModal('drAddPlan');
}

async function drCreatePlan() {
  var payload = {
    name: document.getElementById('drPlanName').value.trim(),
    notes: document.getElementById('drPlanNotes').value.trim(),
  };
  if (!payload.name) { toast(t('msg_plan_name_required'), 'error'); return; }
  try {
    await apiPost('dr/plans/create', payload);
    drHideModal('drAddPlan'); toast(t('msg_dr_plan_created_core_group_auto_created'), 'success'); drLoadPlans();
  } catch (e) { toast(e.message, 'error'); }
}

async function drDeletePlan(planId) {
  if (!await uiConfirm(t('msg_delete_this_dr_plan_all_its_datastores_and_vm_grou'))) return;
  try { await apiPost('dr/plans/delete', { id: planId }); toast(t('msg_dr_plan_deleted'), 'success'); drLoadPlans(); drClosePlanDetail(); }
  catch (e) { toast(e.message, 'error'); }
}

function drOpenPlanDetail(planId, evt) {
  _drCurrentPlanId = planId;
  document.getElementById('drPlanDetail').style.display = '';
  document.getElementById('drPlanDetailTitle').textContent = 'Loading…';
  document.getElementById('drPlanDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  drRefreshPlanDetail();
}

function drClosePlanDetail() { _drCurrentPlanId = null; document.getElementById('drPlanDetail').style.display = 'none'; }

async function drRefreshPlanDetail() {
  if (!_drCurrentPlanId) return;
  try {
    var plan = await apiFetch('dr/plans/detail?plan_id=' + _drCurrentPlanId);
    document.getElementById('drPlanDetailTitle').textContent = '📋 ' + plan.name;
    var status = await apiFetch('dr/plans/status?plan_id=' + _drCurrentPlanId);
    var healthy = status.overall_healthy;
    var syncInfo = plan.last_failover_at ? 'Last failover: ' + plan.last_failover_at.slice(0, 16).replace('T', ' ') : 'No failover yet';
    document.getElementById('drPlanStatusBar').className = 'alert ' + (healthy ? 'alert-success' : 'alert-warning');
    document.getElementById('drPlanStatusBar').innerHTML = drStateBadge(plan.state) + '&nbsp;'
      + (healthy ? '✅ SnapMirror healthy' : '⚠️ SnapMirror issues')
      + '&nbsp;·&nbsp;<span class="muted-hint">' + esc(syncInfo) + '</span>';
    drRenderEntries(plan.entries, status.entries);
    drRenderGroups(plan.vm_groups);
    drShowSubTab(_drActiveSubTab, null);
  } catch (e) {
    document.getElementById('drPlanStatusBar').className = 'alert alert-danger';
    document.getElementById('drPlanStatusBar').textContent = e.message;
  }
}

// ── Plan Entries ──────────────────────────────────────────────────────────────

function drRenderEntries(entries, statusEntries) {
  var statusMap = {}; (statusEntries || []).forEach(function (s) { statusMap[s.entry_id] = s; });
  _drEntriesMap = {};
  entries.forEach(function (e) { _drEntriesMap[e.id] = e; });
  var el = document.getElementById('drEntriesList');
  if (!entries.length) { el.innerHTML = '<div class="muted-hint">No datastores protected. Add or auto-detect via SnapMirror.</div>'; return; }
  el.innerHTML = '<table class="data-table" style="width:100%"><thead><tr><th>Source</th><th>DR Target</th><th>Storage / Hosts</th><th>SnapMirror</th><th></th></tr></thead><tbody>'
    + entries.map(function (e) {
      var s = statusMap[e.id] || {};
      var srcLabel = '<strong>' + esc(e.source_volume) + '</strong><br><span style="font-size:.75rem;color:var(--muted)">' + esc(e.source_endpoint_name || e.source_endpoint_id) + ' / ' + esc(e.source_svm) + '</span>';
      var dstLabel = e.dr_endpoint_id
        ? '<strong>' + esc(e.dr_volume) + '</strong><br><span style="font-size:.75rem;color:var(--muted)">' + esc(e.dr_endpoint_name || e.dr_endpoint_id) + ' / ' + esc(e.dr_svm) + '</span>'
        : '<span class="muted-hint">not configured</span>';
      var storLabel = e.dr_pve_storage_id
        ? '<code style="font-size:.8em">' + esc(e.dr_pve_storage_id) + '</code>'
        : '<span style="font-size:.78rem;color:var(--warning,#856404)">⚠ no storage ID</span>';
      var hostCount = (e.dr_pve_host_ids || []).length;
      var hostBadge = hostCount ? hostCount + ' host(s)' : '<span style="font-size:.78rem;color:var(--warning,#856404)">⚠ no host</span>';
      var smBadge = drLagBadge(s.sm_lag_time, s.sm_healthy !== undefined ? s.sm_healthy : null);
      return '<tr><td>' + srcLabel + '</td><td>' + dstLabel + '</td>'
        + '<td>' + storLabel + '<br><span style="font-size:.75rem;color:var(--muted)">' + hostBadge + '</span></td>'
        + '<td>' + smBadge + '</td>'
        + '<td style="white-space:nowrap">'
        + '<button class="btn btn-ghost btn-xs" onclick="drShowEditEntryModal(\'' + esc(e.id) + '\')">✏ Edit</button> '
        + '<button class="btn btn-danger btn-xs" onclick="drDeleteEntry(\'' + esc(e.id) + '\')">Remove</button>'
        + '</td></tr>';
    }).join('') + '</tbody></table>';
}

var _drEditEntryData = null;
function drShowEditEntryModal(entryId) {
  var entry = _drEntriesMap[entryId]; if (!entry) return;
  _drEditEntryData = entry;
  var storInfo = document.getElementById('drEditEntryStorageInfo');
  storInfo.innerHTML = entry.dr_pve_storage_id
    ? '📦 Storage ID: <strong><code>' + esc(entry.dr_pve_storage_id) + '</code></strong> <span style="color:var(--muted)">(auto-derived)</span>'
    : '<span style="color:var(--warning,#856404)">⚠ No storage ID — run Discovery in the Storage tab first.</span>';
  apiFetch('pve-hosts').then(function (hosts) {
    var sel = document.getElementById('drEditEntryPveHosts');
    sel.innerHTML = hosts.map(function (h) {
      var selected = (entry.dr_pve_host_ids || []).indexOf(h.id) >= 0 ? ' selected' : '';
      return '<option value="' + esc(h.id) + '"' + selected + '>' + esc(h.name) + ' (' + esc(h.host) + ')</option>';
    }).join('');
  }).catch(function () { });
  drShowModal('drEditEntry');
}

async function drSaveEntryEdit() {
  if (!_drEditEntryData) return;
  var hostIds = Array.from(document.getElementById('drEditEntryPveHosts').selectedOptions).map(function (o) { return o.value; });
  try {
    await apiPost('dr/plans/entries/update', { plan_id: _drCurrentPlanId, entry_id: _drEditEntryData.id, dr_pve_host_ids: hostIds });
    drHideModal('drEditEntry'); toast(t('msg_entry_updated'), 'success'); drRefreshPlanDetail();
  } catch (e) { toast(e.message, 'error'); }
}

function drShowAddEntryModal() {
  apiFetch('endpoints').then(function (eps) {
    var opts = eps.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>'; }).join('');
    document.getElementById('drEntryEndpoint').innerHTML = opts;
  }).catch(function () { });
  ['drEntrySvm', 'drEntryVolume'].forEach(function (id) { document.getElementById(id).value = ''; });
  drShowModal('drAddEntry');
}

async function drCreateEntry() {
  var payload = {
    plan_id: _drCurrentPlanId,
    source_endpoint_id: document.getElementById('drEntryEndpoint').value,
    source_svm: document.getElementById('drEntrySvm').value.trim(),
    source_volume: document.getElementById('drEntryVolume').value.trim(),
  };
  if (!payload.source_endpoint_id || !payload.source_svm || !payload.source_volume) { toast(t('msg_all_fields_required'), 'error'); return; }
  try {
    await apiPost('dr/plans/entries/add', payload);
    drHideModal('drAddEntry'); toast(t('msg_datastore_entry_added'), 'success'); drRefreshPlanDetail();
  } catch (e) { toast(e.message, 'error'); }
}

async function drDeleteEntry(entryId) {
  if (!await uiConfirm(t('msg_remove_this_datastore_from_the_plan'))) return;
  try { await apiPost('dr/plans/entries/delete', { plan_id: _drCurrentPlanId, entry_id: entryId }); toast(t('msg_entry_removed'), 'success'); drRefreshPlanDetail(); }
  catch (e) { toast(e.message, 'error'); }
}

async function drAutoDetect() {
  toast(t('msg_auto_detecting_snapmirror_relationships'), 'info');
  try {
    var r = await apiPost('dr/plans/auto-detect', { plan_id: _drCurrentPlanId });
    toast(r.message, r.added > 0 ? 'success' : 'info'); drRefreshPlanDetail();
  } catch (e) { toast(e.message, 'error'); }
}

// ── VM Groups ─────────────────────────────────────────────────────────────────

function drRenderGroups(groups) {
  var el = document.getElementById('drGroupsList');
  if (!groups.length) { el.innerHTML = '<div class="muted-hint">No VM groups. A Core group is auto-created with each plan.</div>'; return; }
  el.innerHTML = groups.map(function (g, idx) {
    var isCore = g.group_type === 'core';
    var typeBadge = isCore
      ? '<span class="badge badge-warning" style="font-size:.72rem">🔒 CORE</span>'
      : '<span class="badge" style="font-size:.72rem">GROUP</span>';
    var modeBadge = g.start_mode === 'auto'
      ? '<span class="badge badge-success" style="font-size:.72rem">AUTO</span>'
      : '<span class="badge badge-info" style="font-size:.72rem">MANUAL</span>';
    var parInfo = '<span style="font-size:.72rem;color:var(--muted)">max ' + g.max_parallel + ' parallel</span>';
    var delayInfo = g.startup_delay_sec > 0 ? '<span style="font-size:.72rem;color:var(--muted)">+' + g.startup_delay_sec + 's</span>' : '';
    var vmRows = g.vms.map(function (v) {
      return '<div style="display:flex;align-items:center;gap:.4rem;padding:.25rem .4rem;background:var(--bg);border-radius:4px;margin-bottom:2px;font-size:.82rem">'
        + '<span style="color:var(--muted)">VM</span> <strong>' + v.vmid + '</strong>'
        + (v.vm_name ? ' <span style="color:var(--muted)">' + esc(v.vm_name) + '</span>' : '')
        + (v.target_node ? ' <span class="badge" style="font-size:.68rem">→ ' + esc(v.target_node) + '</span>' : '')
        + '<button class="btn btn-danger btn-xs" style="margin-left:auto" onclick="drRemoveVm(\'' + esc(g.id) + '\',\'' + esc(v.id) + '\')">✕</button>'
        + '</div>';
    }).join('');
    var moveUp = idx > 0 && !isCore ? '<button class="btn btn-ghost btn-xs" onclick="drMoveGroup(\'' + esc(g.id) + '\',\'up\')">▲</button>' : '';
    var moveDown = idx < groups.length - 1 && !isCore ? '<button class="btn btn-ghost btn-xs" onclick="drMoveGroup(\'' + esc(g.id) + '\',\'down\')">▼</button>' : '';
    return '<div class="card" style="margin-bottom:.5rem">'
      + '<div style="display:flex;align-items:flex-start;justify-content:space-between;padding:.6rem .9rem">'
      + '<div style="flex:1">'
      + '<div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">'
      + '<span style="font-weight:600">' + esc(g.name) + '</span>' + typeBadge + modeBadge + parInfo + (delayInfo ? '&nbsp;' + delayInfo : '')
      + '</div>'
      + (vmRows ? '<div style="margin-top:.4rem">' + vmRows + '</div>' : '<div style="font-size:.78rem;color:var(--muted);margin-top:.3rem">No VMs assigned</div>')
      + '</div>'
      + '<div style="display:flex;gap:.3rem;align-items:center">'
      + moveUp + moveDown
      + '<button class="btn btn-ghost btn-xs" onclick="drShowAddVmModal(\'' + esc(g.id) + '\')">+ VM</button>'
      + (isCore ? '' : '<button class="btn btn-danger btn-xs" onclick="drDeleteGroup(\'' + esc(g.id) + '\')">Remove</button>')
      + '</div></div></div>';
  }).join('');
}

function drShowAddGroupModal() {
  document.getElementById('drGroupName').value = '';
  document.getElementById('drGroupStartMode').value = 'auto';
  document.getElementById('drGroupDelay').value = '30';
  document.getElementById('drGroupMaxParallel').value = '1';
  drShowModal('drAddGroup');
}

async function drCreateGroup() {
  var payload = {
    plan_id: _drCurrentPlanId,
    name: document.getElementById('drGroupName').value.trim(),
    start_mode: document.getElementById('drGroupStartMode').value,
    startup_delay_sec: parseInt(document.getElementById('drGroupDelay').value) || 30,
    max_parallel: parseInt(document.getElementById('drGroupMaxParallel').value) || 1,
    group_type: 'standard',
  };
  if (!payload.name) { toast(t('msg_group_name_required'), 'error'); return; }
  try {
    await apiPost('dr/plans/groups/create', payload);
    drHideModal('drAddGroup'); toast(t('msg_vm_group_added'), 'success'); drRefreshPlanDetail();
  } catch (e) { toast(e.message, 'error'); }
}

async function drDeleteGroup(groupId) {
  if (!await uiConfirm(t('msg_delete_this_vm_group_and_remove_all_its_vms'))) return;
  try { await apiPost('dr/plans/groups/delete', { plan_id: _drCurrentPlanId, group_id: groupId }); toast(t('msg_group_deleted'), 'success'); drRefreshPlanDetail(); }
  catch (e) { toast(e.message, 'error'); }
}

async function drMoveGroup(groupId, direction) {
  var plan = await apiFetch('dr/plans/detail?plan_id=' + _drCurrentPlanId);
  var order = plan.vm_groups.map(function (g) { return g.id; });
  var idx = order.indexOf(groupId);
  if (idx < 0) return;
  if (direction === 'up' && idx > 0) { var t = order[idx - 1]; order[idx - 1] = order[idx]; order[idx] = t; }
  if (direction === 'down' && idx < order.length - 1) { var t = order[idx + 1]; order[idx + 1] = order[idx]; order[idx] = t; }
  try { await apiPost('dr/plans/groups/reorder', { plan_id: _drCurrentPlanId, order }); drRefreshPlanDetail(); }
  catch (e) { toast(e.message, 'error'); }
}

function drShowAddVmModal(groupId) {
  _drCurrentGroupId = groupId;
  ['drVmVmid', 'drVmName', 'drVmNode'].forEach(function (id) { document.getElementById(id).value = ''; });
  drShowModal('drAddVm');
}

async function drAddVmToGroup() {
  var vmid = parseInt(document.getElementById('drVmVmid').value);
  if (!vmid) { toast(t('msg_vmid_required'), 'error'); return; }
  try {
    await apiPost('dr/plans/groups/vms/add', {
      plan_id: _drCurrentPlanId, group_id: _drCurrentGroupId,
      vmid, vm_name: document.getElementById('drVmName').value.trim(),
      target_node: document.getElementById('drVmNode').value.trim(),
    });
    drHideModal('drAddVm'); toast(t('msg_vm_added_to_group'), 'success'); drRefreshPlanDetail();
  } catch (e) { toast(e.message, 'error'); }
}

async function drRemoveVm(groupId, vmAssignmentId) {
  try { await apiPost('dr/plans/groups/vms/delete', { plan_id: _drCurrentPlanId, group_id: groupId, vm_id: vmAssignmentId }); toast(t('msg_vm_removed'), 'success'); drRefreshPlanDetail(); }
  catch (e) { toast(e.message, 'error'); }
}

// ── Failover ─────────────────────────────────────────────────────────────────

var _drFailoverEntries = [];
var _drFailoverSnapshots = {};

async function drShowFailoverModal() {
  if (!_drCurrentPlanId) return;
  document.getElementById('drFailoverChecks').innerHTML = '<div class="muted-hint">Running pre-checks…</div>';
  document.getElementById('drFailoverEntryList').innerHTML = '<div class="muted-hint">Loading…</div>';
  document.getElementById('drFailoverStartBtn').disabled = true;
  document.getElementById('drFailoverType').value = 'planned';
  _drFailoverEntries = []; _drFailoverSnapshots = {};
  drShowModal('drFailover');
  try {
    var plan = await apiFetch('dr/plans/detail?plan_id=' + _drCurrentPlanId);
    _drFailoverEntries = plan.entries || [];
    drRenderFailoverEntries();
    var r = await apiFetch('dr/plans/precheck?plan_id=' + _drCurrentPlanId);
    var hasError = r.checks.some(function (c) { return c.status === 'error'; });
    document.getElementById('drFailoverChecks').innerHTML = r.checks.map(function (c) {
      var icon = c.status === 'ok' ? '✅' : c.status === 'warn' ? '⚠️' : '❌';
      return '<div style="display:flex;gap:.5rem;align-items:flex-start">'
        + '<span>' + icon + '</span><span><strong>' + esc(c.name) + '</strong><br>'
        + '<span style="color:var(--muted);font-size:.82rem">' + esc(c.message) + '</span></span></div>';
    }).join('');
    if (!hasError) document.getElementById('drFailoverStartBtn').disabled = false;
  } catch (e) { document.getElementById('drFailoverChecks').innerHTML = '<div class="alert alert-danger">' + esc(e.message) + '</div>'; }
}

function drRenderFailoverEntries() {
  var el = document.getElementById('drFailoverEntryList');
  if (!_drFailoverEntries.length) { el.innerHTML = '<div class="muted-hint">No entries</div>'; return; }
  var html = '<div style="display:flex;gap:.5rem;margin-bottom:.4rem">'
    + '<button class="btn btn-ghost btn-xs" onclick="drSelectAllEntries(true)">☑ All</button>'
    + '<button class="btn btn-ghost btn-xs" onclick="drSelectAllEntries(false)">☐ None</button></div>';
  html += _drFailoverEntries.map(function (e) {
    var snaps = _drFailoverSnapshots[e.id] || [];
    var snapSel = '<select id="drSnap-' + esc(e.id) + '" style="font-size:.75rem;margin-left:.5rem;max-width:180px">'
      + '<option value="">— latest —</option>'
      + snaps.map(function (s) { return '<option value="' + esc(s.name) + '">' + esc(s.name) + (s.created ? ' (' + s.created.slice(0, 10) + ')' : '') + '</option>'; }).join('')
      + '</select>';
    return '<div style="display:flex;align-items:center;gap:.5rem;padding:.3rem .4rem;background:var(--bg);border-radius:4px;margin-bottom:2px">'
      + '<input type="checkbox" id="drChk-' + esc(e.id) + '" value="' + esc(e.id) + '" onchange="drUpdateFailoverBtn()" style="accent-color:var(--primary);flex-shrink:0">'
      + '<label for="drChk-' + esc(e.id) + '" style="cursor:pointer;flex:1;font-size:.85rem"><strong>' + esc(e.source_volume) + '</strong>'
      + ' <span style="color:var(--muted)">→ ' + esc(e.dr_volume) + '</span></label>'
      + '<button class="btn btn-ghost btn-xs" onclick="drLoadSnaps(\'' + esc(e.id) + '\')">🔄</button>'
      + snapSel + '</div>';
  }).join('');
  el.innerHTML = html;
}

function drSelectAllEntries(checked) { document.querySelectorAll('#drFailoverEntryList input[type=checkbox]').forEach(function (cb) { cb.checked = checked; }); drUpdateFailoverBtn(); }
function drUpdateFailoverBtn() {
  var any = document.querySelectorAll('#drFailoverEntryList input[type=checkbox]:checked').length > 0;
  var hasError = document.querySelector('#drFailoverChecks .badge-danger') !== null;
  document.getElementById('drFailoverStartBtn').disabled = !any || hasError;
}

async function drLoadSnaps(entryId) {
  try {
    var snaps = await apiFetch('dr/plans/snapshots?plan_id=' + _drCurrentPlanId + '&entry_id=' + entryId);
    _drFailoverSnapshots[entryId] = snaps; drRenderFailoverEntries();
    var cb = document.getElementById('drChk-' + entryId); if (cb) cb.checked = true;
    drUpdateFailoverBtn();
  } catch (e) { toast(t('msg_could_not_load_snapshots') + e.message, 'error'); }
}

async function drStartFailover() {
  var ftype = document.getElementById('drFailoverType').value;
  var selectedIds = Array.from(document.querySelectorAll('#drFailoverEntryList input[type=checkbox]:checked')).map(function (cb) { return cb.value; });
  if (!selectedIds.length) { toast(t('msg_select_at_least_one_datastore'), 'error'); return; }
  var snapMap = {};
  selectedIds.forEach(function (eid) { var sel = document.getElementById('drSnap-' + eid); if (sel && sel.value) snapMap[eid] = sel.value; });
  var warn = ftype === 'emergency'
    ? '⚠ EMERGENCY failover: SnapMirror will be broken WITHOUT a final sync. Data since last transfer may be lost. Continue?'
    : 'Start PLANNED failover? SnapMirror will be broken and storage mounted on the DR site.';
  if (!await uiConfirm(warn)) return;
  drHideModal('drFailover');
  try {
    var r = await apiPost('dr/plans/failover', { plan_id: _drCurrentPlanId, failover_type: ftype, entry_ids: selectedIds, snap_map: snapMap });
    toast(t('msg_failover_started_see_jobs_logs_tab_for_progress'), 'success');
    setTimeout(function () { document.querySelector('[data-tab="jobs"]').click(); setTimeout(loadAllJobs, 800); }, 300);
  } catch (e) { toast(e.message, 'error'); }
}


// Initial load
initNetApp();
