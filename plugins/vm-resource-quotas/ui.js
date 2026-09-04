/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/vm-resource-quotas/ui.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Ui JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
const i18nRoot = window.parent && window.parent.ProxmoxVExI18n;
if (i18nRoot) { i18nRoot.loadPluginNamespaceFull('vm-resource-quotas', '/api/plugins/vm-resource-quotas/i18n'); }
const t = i18nRoot ? i18nRoot.getT('vm-resource-quotas') : (key) => key;

const theme = new URLSearchParams(window.location.search).get('theme') || 'modern-dark';
document.documentElement.setAttribute('data-theme', theme);

const TABS = [
  { id: 'quotas', label: t('quotas') },
  { id: 'usage', label: t('usage') },
  { id: 'templates', label: t('templates') },
  { id: 'alerts', label: t('alerts') },
  { id: 'defaults', label: t('defaults') },
  { id: 'history', label: t('history') },
  { id: 'dashboard', label: t('dashboard') },
  { id: 'importExport', label: t('importExport') }
];

let activeTab = 'quotas';
let state = { tenants: [], clusters: [], quotas: [], templates: [], alerts: [], history: [], dashboard: [] };

async function api(endpoint, { method = 'GET', body = null, json = true } = {}) {
  const opts = { method, headers: {} };
  if (body && json) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  else if (body) { opts.body = body; }
  const res = await fetch('/api/plugins/vm-resource-quotas/api/' + endpoint, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) { }
    throw new Error(msg);
  }
  if (!json) return res;
  return res.json();
}

function showMessage(text, type = 'error') {
  const el = document.getElementById('message');
  el.textContent = text; el.className = 'message show ' + type;
  setTimeout(() => el.className = 'message', 3000);
}

function fmt(n) { return n == null ? '-' : Number(n).toLocaleString(); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderTabs() {
  const nav = document.getElementById('tabs');
  nav.innerHTML = DOMPurify.sanitize(TABS.map(tab => `<button class="${tab.id === activeTab ? 'active' : ''}" data-tab="${tab.id}">${esc(tab.label)}</button>`).join(''));
  nav.onclick = e => { const id = e.target.dataset.tab; if (id) { activeTab = id; renderTabs(); renderContent(); } };
}

function renderContent() {
  const main = document.getElementById('main');
  main.innerHTML = DOMPurify.sanitize(`<div id="${activeTab}" class="tabs-content active"></div>`);
  if (activeTab === 'quotas') renderQuotas();
  else if (activeTab === 'usage') renderUsage();
  else if (activeTab === 'templates') renderTemplates();
  else if (activeTab === 'alerts') renderAlerts();
  else if (activeTab === 'defaults') renderDefaults();
  else if (activeTab === 'history') renderHistory();
  else if (activeTab === 'dashboard') renderDashboard();
  else if (activeTab === 'importExport') renderImportExport();
}

async function loadStatus() {
  try {
    const s = await api('status');
    document.getElementById('status-card').textContent = `${s.plugin} v${s.version} — ${s.quotas} quotas`;
  } catch (e) { showMessage(e.message); }
}

async function loadTenants() {
  try { const r = await api('tenants'); state.tenants = r.tenants; } catch (e) { state.tenants = []; }
}
async function loadClusters() {
  try { const r = await api('clusters'); state.clusters = r.clusters; } catch (e) { state.clusters = []; }
}
async function loadQuotas() {
  try { const r = await api('quotas'); state.quotas = r.quotas; } catch (e) { state.quotas = []; }
}
async function loadTemplates() {
  try { const r = await api('templates'); state.templates = r.templates; } catch (e) { state.templates = []; }
}
async function loadAlerts() {
  try { const r = await api('alerts'); state.alerts = r.alerts; } catch (e) { state.alerts = []; }
}
async function loadHistory() {
  try { const r = await api('history'); state.history = r.history; } catch (e) { state.history = []; }
}
async function loadDashboard() {
  try { const r = await api('dashboard'); state.dashboard = r.tenants; } catch (e) { state.dashboard = []; }
}

function tenantOptions(selected = '') {
  return `<option value="">--</option>` + state.tenants.map(t => `<option value="${esc(t.id)}" ${t.id === selected ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
}
function clusterOptions(selected = '') {
  return `<option value="">--</option>` + state.clusters.map(c => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function quotaForm(q = {}) {
  return `
  <div class="card">
    <h3 id="form-title">${q.id ? t('update') : t('create')}</h3>
    <form class="form" id="quota-form" data-id="${esc(q.id || '')}">
      <label>${t('tenant')} <select name="tenant_id" ${q.id ? 'disabled' : ''}>${q.tenant_id ? tenantOptions(q.tenant_id) : tenantOptions()}</select></label>
      <label>${t('max_vcpus')} <input type="number" name="max_vcpus" min="0" value="${esc(q.max_vcpus == null ? '' : q.max_vcpus)}" /></label>
      <label>${t('max_memory_mb')} <input type="number" name="max_memory_mb" min="0" value="${esc(q.max_memory_mb == null ? '' : q.max_memory_mb)}" /></label>
      <label>${t('max_storage_gb')} <input type="number" name="max_storage_gb" min="0" value="${esc(q.max_storage_gb == null ? '' : q.max_storage_gb)}" /></label>
      <label>${t('max_vms')} <input type="number" name="max_vms" min="0" value="${esc(q.max_vms == null ? '' : q.max_vms)}" /></label>
      <label style="grid-column:1/-1">${t('notes')} <textarea name="notes">${esc(q.notes || '')}</textarea></label>
      <h4 style="grid-column:1/-1;margin:.5rem 0">${t('warning')} / ${t('danger')}</h4>
      ${['vcpus', 'memory', 'storage', 'vms'].map(r => {
    const th = (q.alert_thresholds && q.alert_thresholds[r]) || { warning: 80, danger: 95 };
    return `<label>${t(r)} ${t('warning')} <input type="number" name="warning_${r}" min="0" max="100" value="${th.warning}" /></label>
                <label>${t(r)} ${t('danger')} <input type="number" name="danger_${r}" min="0" max="100" value="${th.danger}" /></label>`;
  }).join('')}
      <div class="actions" style="grid-column:1/-1">
        <button type="submit" class="btn">${q.id ? t('update') : t('save')}</button>
        ${q.id ? `<button type="button" id="cancel-edit" class="btn secondary">${t('cancel')}</button>` : ''}
      </div>
    </form>
  </div>`;
}

async function saveQuota(e) {
  e.preventDefault();
  const f = e.target, id = f.dataset.id;
  const body = Object.fromEntries(new FormData(f).entries());
  body.max_vcpus = body.max_vcpus || ''; body.max_memory_mb = body.max_memory_mb || '';
  body.max_storage_gb = body.max_storage_gb || ''; body.max_vms = body.max_vms || '';
  if (!id) body.tenant_id = f.tenant_id.value;
  body.alert_thresholds = {};
  ['vcpus', 'memory', 'storage', 'vms'].forEach(r => {
    body.alert_thresholds[r] = {
      warning: parseInt(body['warning_' + r] || 80, 10),
      danger: parseInt(body['danger_' + r] || 95, 10)
    };
    delete body['warning_' + r]; delete body['danger_' + r];
  });
  try {
    if (id) { body.id = id; await api('quotas', { method: 'PUT', body }); showMessage(t('update') + ' OK', 'success'); }
    else { await api('quotas', { method: 'POST', body }); showMessage(t('create') + ' OK', 'success'); }
    await loadQuotas(); renderQuotas();
  } catch (ex) { showMessage(ex.message); }
}

let quotaSearch = '', quotaSort = 'tenant_name', quotaOrder = 'asc';
function renderQuotas() {
  const c = document.getElementById('quotas');
  c.innerHTML = DOMPurify.sanitize(quotaForm(window._editingQuota || {}) + `<div class="card">
    <div class="search-bar"><input id="q-search" type="text" placeholder="${t('search')}" value="${esc(quotaSearch)}" /><select id="q-sort">${['tenant_name', 'max_vcpus', 'max_memory_mb', 'max_storage_gb', 'max_vms'].map(s => `<option value="${s}" ${s === quotaSort ? 'selected' : ''}>${t(s)}</option>`).join('')}</select><button id="q-order" class="btn secondary">${esc(quotaOrder)}</button></div>
    <table><thead><tr><th>${t('tenant')}</th><th>${t('max_vcpus')}</th><th>${t('max_memory_mb')}</th><th>${t('max_storage_gb')}</th><th>${t('max_vms')}</th><th>${t('notes')}</th><th></th></tr></thead><tbody id="q-tbody"></tbody></table>
  </div>`);
  c.querySelector('#quota-form').onsubmit = saveQuota;
  const cancel = c.querySelector('#cancel-edit');
  if (cancel) cancel.onclick = () => { window._editingQuota = null; renderQuotas(); };
  c.querySelector('#q-search').oninput = e => { quotaSearch = e.target.value.toLowerCase(); renderQuotasList(); };
  c.querySelector('#q-sort').onchange = e => { quotaSort = e.target.value; renderQuotasList(); };
  c.querySelector('#q-order').onclick = () => { quotaOrder = quotaOrder === 'asc' ? 'desc' : 'asc'; renderQuotasList(); };
  renderQuotasList();
}
function renderQuotasList() {
  let rows = state.quotas.filter(q => !quotaSearch || (q.tenant_name || q.tenant_id).toLowerCase().includes(quotaSearch));
  rows.sort((a, b) => {
    const av = a[quotaSort] || (quotaSort === 'tenant_name' ? a.tenant_name : '') || '';
    const bv = b[quotaSort] || (quotaSort === 'tenant_name' ? b.tenant_name : '') || '';
    if (typeof av === 'number') return quotaOrder === 'asc' ? av - bv : bv - av;
    return quotaOrder === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
  const tb = document.getElementById('q-tbody');
  if (!tb) return;
  tb.innerHTML = DOMPurify.sanitize(rows.length ? rows.map(q => `<tr>
    <td>${esc(q.tenant_name || q.tenant_id)}</td>
    <td>${fmt(q.max_vcpus)}</td><td>${fmt(q.max_memory_mb)}</td><td>${fmt(q.max_storage_gb)}</td><td>${fmt(q.max_vms)}</td>
    <td>${esc(q.notes || '')}</td>
    <td><button class="btn secondary q-edit" data-id="${esc(q.id)}">${t('edit')}</button> <button class="btn danger q-del" data-id="${esc(q.id)}">${t('delete')}</button></td>
  </tr>`).join('') : `<tr><td colspan="7" class="empty">${t('noData')}</td></tr>`);
  tb.querySelectorAll('.q-edit').forEach(b => b.onclick = () => { window._editingQuota = state.quotas.find(q => q.id === b.dataset.id); renderQuotas(); });
  tb.querySelectorAll('.q-del').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this quota?')) return;
    try { await api('quotas?id=' + b.dataset.id, { method: 'DELETE' }); await loadQuotas(); renderQuotasList(); showMessage('Deleted', 'success'); }
    catch (ex) { showMessage(ex.message); }
  });
}

async function renderUsage() {
  const c = document.getElementById('usage');
  c.innerHTML = DOMPurify.sanitize(`<div class="card">
    <label>${t('tenant')} <select id="u-tenant">${tenantOptions()}</select></label>
    <div class="actions"><button id="u-load" class="btn">${t('refresh')}</button></div>
    <div id="u-result"></div>
  </div>`);
  c.querySelector('#u-load').onclick = async () => {
    const tid = c.querySelector('#u-tenant').value;
    if (!tid) return showMessage('Select a tenant');
    try {
      const r = await api('usage?tenant_id=' + tid);
      const result = document.getElementById('u-result');
      const view = r.usage.view, data = r.usage.usage, q = r.quota;
      result.innerHTML = DOMPurify.sanitize(`<h3>${esc(r.quota.tenant_name || r.tenant_id)}</h3>` + Object.keys(view).map(k => {
        const u = data[k === 'vcpus' ? 'vcpus_used' : k === 'memory' ? 'memory_used_mb' : k === 'storage' ? 'storage_used_gb' : 'vm_count'];
        const l = q['max_' + (k === 'vcpus' ? 'vcpus' : k === 'memory' ? 'memory_mb' : k === 'storage' ? 'storage_gb' : 'vms')];
        const v = view[k];
        return `<div style="margin:.75rem 0"><div style="display:flex;justify-content:space-between;margin-bottom:.25rem"><span>${t(k)} — ${fmt(u)} / ${fmt(l)}</span><span class="badge ${v.state}">${v.percent}%</span></div>
          <div class="progress"><div class="progress-bar ${v.state}" style="width:${Math.min(v.percent, 100)}%"></div></div></div>`;
      }).join(''));
    } catch (ex) { showMessage(ex.message); }
  };
}

let templateFormId = '';
function renderTemplates() {
  const c = document.getElementById('templates');
  const tm = state.templates.find(t => t.id === templateFormId) || {};
  c.innerHTML = DOMPurify.sanitize(`<div class="card">
    <h3>${tm.id ? t('update') + ' ' + esc(tm.name) : t('create')}</h3>
    <form class="form" id="tmpl-form" data-id="${esc(tm.id || '')}">
      <label>${t('name')} <input name="name" value="${esc(tm.name || '')}" /></label>
      <label>${t('max_vcpus')} <input type="number" name="max_vcpus" value="${esc(tm.limits && tm.limits.max_vcpus || '')}" /></label>
      <label>${t('max_memory_mb')} <input type="number" name="max_memory_mb" value="${esc(tm.limits && tm.limits.max_memory_mb || '')}" /></label>
      <label>${t('max_storage_gb')} <input type="number" name="max_storage_gb" value="${esc(tm.limits && tm.limits.max_storage_gb || '')}" /></label>
      <label>${t('max_vms')} <input type="number" name="max_vms" value="${esc(tm.limits && tm.limits.max_vms || '')}" /></label>
      <label style="grid-column:1/-1">${t('notes')} <textarea name="notes">${esc(tm.notes || '')}</textarea></label>
      <div class="actions" style="grid-column:1/-1"><button class="btn" type="submit">${tm.id ? t('update') : t('create')}</button> ${tm.id ? `<button type="button" id="tmpl-cancel" class="btn secondary">${t('cancel')}</button>` : ''}</div>
    </form>
  </div>
  <div class="card"><table><thead><tr><th>${t('name')}</th><th>${t('max_vcpus')}</th><th>${t('max_memory_mb')}</th><th>${t('max_storage_gb')}</th><th>${t('max_vms')}</th><th></th></tr></thead><tbody id="tmpl-tbody"></tbody></table></div>`);
  c.querySelector('#tmpl-form').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, body = Object.fromEntries(new FormData(f).entries()), id = f.dataset.id;
    const limits = { max_vcpus: body.max_vcpus || '', max_memory_mb: body.max_memory_mb || '', max_storage_gb: body.max_storage_gb || '', max_vms: body.max_vms || '' };
    const payload = { name: body.name, notes: body.notes, ...limits };
    try { if (id) { await api('templates', { method: 'PUT', body: { ...payload, id } }); } else { await api('templates', { method: 'POST', body: payload }); } showMessage('Saved', 'success'); templateFormId = ''; await loadTemplates(); renderTemplates(); }
    catch (ex) { showMessage(ex.message); }
  };
  if (tm.id) c.querySelector('#tmpl-cancel').onclick = () => { templateFormId = ''; renderTemplates(); };
  const tb = c.querySelector('#tmpl-tbody');
  tb.innerHTML = DOMPurify.sanitize(state.templates.length ? state.templates.map(t => `<tr>
    <td>${esc(t.name)}</td><td>${fmt(t.limits && t.limits.max_vcpus)}</td><td>${fmt(t.limits && t.limits.max_memory_mb)}</td><td>${fmt(t.limits && t.limits.max_storage_gb)}</td><td>${fmt(t.limits && t.limits.max_vms)}</td>
    <td><button class="btn secondary tm-edit" data-id="${esc(t.id)}">${t('edit')}</button> <button class="btn secondary tm-apply" data-id="${esc(t.id)}">${t('apply')}</button> <button class="btn danger tm-del" data-id="${esc(t.id)}">${t('delete')}</button></td>
  </tr>`).join('') : `<tr><td colspan="6" class="empty">${t('noData')}</td></tr>`);
  tb.querySelectorAll('.tm-edit').forEach(b => b.onclick = () => { templateFormId = b.dataset.id; renderTemplates(); });
  tb.querySelectorAll('.tm-del').forEach(b => b.onclick = async () => { if (!confirm('Delete?')) return; try { await api('templates?id=' + b.dataset.id, { method: 'DELETE' }); await loadTemplates(); renderTemplates(); showMessage('Deleted', 'success'); } catch (ex) { showMessage(ex.message); } });
  tb.querySelectorAll('.tm-apply').forEach(b => b.onclick = async () => {
    const tid = prompt(t('tenant') + ' ID?'); if (!tid) return;
    try { await api('templates/apply', { method: 'POST', body: { template_id: b.dataset.id, tenant_id: tid } }); showMessage('Applied', 'success'); await loadQuotas(); } catch (ex) { showMessage(ex.message); }
  });
}

function renderAlerts() {
  const c = document.getElementById('alerts');
  c.innerHTML = DOMPurify.sanitize(`<div class="card"><table><thead><tr><th>${t('tenant')}</th><th>${t('resource')}</th><th>${t('percent')}</th><th>${t('severity')}</th><th></th></tr></thead><tbody id="al-tbody"></tbody></table></div>`);
  const tb = c.querySelector('#al-tbody');
  tb.innerHTML = DOMPurify.sanitize(state.alerts.length ? state.alerts.map(a => `<tr>
    <td>${esc(a.tenant_id)}</td><td>${t(a.resource)}</td><td>${a.percent}%</td><td><span class="badge ${a.severity}">${a.severity}</span></td>
    <td><button class="btn secondary ack" data-id="${esc(a.id)}">${t('acknowledge')}</button></td>
  </tr>`).join('') : `<tr><td colspan="5" class="empty">${t('noData')}</td></tr>`);
  tb.querySelectorAll('.ack').forEach(b => b.onclick = async () => { try { await api('alerts/acknowledge', { method: 'POST', body: { id: b.dataset.id } }); showMessage('Ack', 'success'); await loadAlerts(); renderAlerts(); } catch (ex) { showMessage(ex.message); } });
}

function renderDefaults() {
  const c = document.getElementById('defaults');
  c.innerHTML = DOMPurify.sanitize(`<div class="card">
    <form class="form" id="def-form">
      <label>${t('cluster')} <select name="cluster_id">${clusterOptions()}</select></label>
      <label>${t('max_vcpus')} <input type="number" name="max_vcpus" /></label>
      <label>${t('max_memory_mb')} <input type="number" name="max_memory_mb" /></label>
      <label>${t('max_storage_gb')} <input type="number" name="max_storage_gb" /></label>
      <label>${t('max_vms')} <input type="number" name="max_vms" /></label>
      <div class="actions" style="grid-column:1/-1"><button type="submit" class="btn">${t('save')}</button> <button type="button" id="def-apply" class="btn secondary">${t('apply')} ${t('all')}</button></div>
    </form>
  </div>`);
  c.querySelector('#def-form').onsubmit = async (e) => {
    e.preventDefault(); const body = Object.fromEntries(new FormData(e.target).entries());
    try { await api('defaults', { method: 'POST', body }); showMessage('Saved', 'success'); } catch (ex) { showMessage(ex.message); }
  };
  c.querySelector('#def-apply').onclick = async () => {
    const body = Object.fromEntries(new FormData(c.querySelector('#def-form')).entries());
    if (!body.cluster_id) return showMessage('Select a cluster');
    try { const r = await api('defaults/apply', { method: 'POST', body }); showMessage(`Applied to ${r.updated.length} tenants`, 'success'); await loadQuotas(); } catch (ex) { showMessage(ex.message); }
  };
}

function renderHistory() {
  const c = document.getElementById('history');
  c.innerHTML = DOMPurify.sanitize(`<div class="card"><table><thead><tr><th>${t('timestamp')}</th><th>${t('action')}</th><th>${t('tenant')}</th><th>${t('actor')}</th><th>${t('details')}</th></tr></thead><tbody id="h-tbody"></tbody></table></div>`);
  const tb = c.querySelector('#h-tbody');
  tb.innerHTML = DOMPurify.sanitize(state.history.length ? state.history.map(h => `<tr>
    <td>${esc(h.timestamp)}</td><td>${esc(h.action)}</td><td>${esc(h.tenant_id)}</td><td>${esc(h.actor)}</td><td><pre style="margin:0">${esc(JSON.stringify(h.details || {}, null, 2))}</pre></td>
  </tr>`).join('') : `<tr><td colspan="5" class="empty">${t('noData')}</td></tr>`);
}

function renderDashboard() {
  const c = document.getElementById('dashboard');
  c.innerHTML = DOMPurify.sanitize(`<div class="card"><table><thead><tr><th>${t('tenant')}</th><th>${t('highest')}</th><th>${t('state')}</th></tr></thead><tbody id="dash-tbody"></tbody></table></div>`);
  const tb = c.querySelector('#dash-tbody');
  tb.innerHTML = DOMPurify.sanitize(state.dashboard.length ? state.dashboard.map(d => `<tr>
    <td>${esc(d.tenant_name || d.tenant_id)}</td><td>${d.highest_pct}%</td><td><span class="badge ${d.state}">${d.state}</span></td>
  </tr>`).join('') : `<tr><td colspan="3" class="empty">${t('noData')}</td></tr>`);
}

function renderImportExport() {
  const c = document.getElementById('importExport');
  c.innerHTML = DOMPurify.sanitize(`<div class="card">
    <div class="actions"><button id="ex-json" class="btn">${t('export')} ${t('json')}</button> <button id="ex-csv" class="btn secondary">${t('export')} ${t('csv')}</button></div>
    <hr style="border:0;border-top:1px solid var(--border);margin:1rem 0" />
    <h3>${t('import')}</h3>
    <form class="form" id="imp-form">
      <label>${t('format')} <select name="format"><option value="json">${t('json')}</option><option value="csv">${t('csv')}</option></select></label>
      <label style="grid-column:1/-1">${t('file')} / ${t('data')} <textarea name="data" placeholder="JSON or CSV content"></textarea></label>
      <div class="actions" style="grid-column:1/-1"><button type="submit" class="btn">${t('import')}</button></div>
    </form>
    <pre id="imp-result" style="margin-top:1rem"></pre>
  </div>`);
  c.querySelector('#ex-json').onclick = () => window.open('/api/plugins/vm-resource-quotas/api/export?format=json');
  c.querySelector('#ex-csv').onclick = () => window.open('/api/plugins/vm-resource-quotas/api/export?format=csv');
  c.querySelector('#imp-form').onsubmit = async (e) => {
    e.preventDefault(); const body = Object.fromEntries(new FormData(e.target).entries());
    try { const r = await api('import', { method: 'POST', body }); document.getElementById('imp-result').textContent = JSON.stringify(r, null, 2); showMessage('Imported', 'success'); } catch (ex) { showMessage(ex.message); }
  };
}

function captureI18nDefaults() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    if (!el.dataset.i18nDefault) {
      el.dataset.i18nDefault = el.textContent;
    }
  });
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const fallback = el.dataset.i18nDefault || el.textContent;
    const translated = t(key);
    el.textContent = translated === key ? fallback : translated;
  });
}

async function init() {
  captureI18nDefaults();
  applyI18n();
  const pageTitle = t('title');
  if (pageTitle !== 'title') {
    document.title = pageTitle;
  }
  renderTabs();
  await Promise.all([loadStatus(), loadTenants(), loadClusters(), loadQuotas(), loadTemplates(), loadAlerts(), loadHistory(), loadDashboard()]);
  renderContent();
  setInterval(async () => { await loadStatus(); await loadAlerts(); }, 30000);
}

init().catch(e => showMessage(e.message));
