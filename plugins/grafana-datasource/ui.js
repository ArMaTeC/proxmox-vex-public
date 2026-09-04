/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/grafana-datasource/ui.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Ui JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
const qs = new URLSearchParams(window.location.search);
if (qs.get('theme') === 'corp-light') document.documentElement.setAttribute('data-theme', 'corp-light');
const $ = (id) => document.getElementById(id);
const i18n = window.parent && window.parent.ProxmoxVExI18n;
const t = (k, p) => i18n ? i18n.getT('grafana-datasource')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('grafana-datasource', '/api/plugins/grafana-datasource/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
async function copyToClipboard(text) { try { await navigator.clipboard.writeText(text); toast(t('copied')); } catch (e) { showError('Clipboard access denied'); } }

async function loadStatus() { try { const s = await api('status'); $('sPlugin').textContent = s.plugin; $('sVersion').textContent = s.version; $('status').textContent = 'Ready'; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join(''); $('pCluster').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }

let currentDs = null;

async function loadDs() { try { const d = await api('datasource'); currentDs = d.datasource; renderDs(currentDs); } catch (err) { showError(err.message); } }

function renderDs(ds) {
    const c = $('dCard');
    if (!ds) { c.innerHTML = '<p class="empty">No data source provisioned.</p>'; $('dCopyUrl').disabled = true; $('dCopyJson').disabled = true; $('dUnprovision').disabled = true; return; }
    c.innerHTML = DOMPurify.sanitize(`<p class="muted">Name: <strong>${escapeHtml(ds.name)}</strong></p>` +
        `<p class="muted">Cluster: <strong>${escapeHtml(ds.cluster_id || '')}</strong></p>` +
        `<p class="muted">Type: <strong>${escapeHtml(ds.type)}</strong></p>` +
        `<p class="muted">URL: <strong>${escapeHtml(ds.url)}</strong></p>` +
        `<p class="muted">Provisioned: <strong>${escapeHtml(ds.provisioned_at || '')}</strong></p>`);
    $('dCopyUrl').disabled = false; $('dCopyJson').disabled = false; $('dUnprovision').disabled = false;
}

async function provision() { $('pError').textContent = ''; const name = $('pName').value.trim(), cluster = $('pCluster').value, type = $('pType').value.trim(), url = $('pUrl').value.trim(); if (!name) { $('pError').textContent = 'Name is required'; return; } try { const r = await api('provision', 'POST', { name, cluster_id: cluster, type, url }); currentDs = r.datasource; renderDs(currentDs); toast(t('provisioned')); } catch (err) { $('pError').textContent = err.message; showError(err.message); } }

async function unprovision() { if (!confirm('Remove the provisioned data source?')) return; try { await api('unprovision', 'POST', {}); currentDs = null; renderDs(null); toast(t('unprovisioned')); } catch (err) { showError(err.message); } }

async function testConnection() { $('pError').textContent = ''; const cluster = $('pCluster').value; if (!cluster) { $('pError').textContent = 'Select a cluster'; return; } try { const r = await api('test', 'POST', { cluster_id: cluster }); toast('Connected to ' + r.host); } catch (err) { $('pError').textContent = err.message; showError(err.message); } }

async function loadDashboards() {
    try {
        const d = await api('dashboards'); let list = (d.dashboards || []); const search = $('dSearch').value.trim().toLowerCase(); if (search) list = list.filter(x => (x.title || '').toLowerCase().includes(search)); const c = $('dList');
        if (!list.length) { c.innerHTML = '<p class="empty">No dashboards found.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="id">ID</th><th data-sort="title">Title</th></tr></thead><tbody>';
        list.forEach(dash => { html += `<tr><td class="muted">${escapeHtml(dash.id)}</td><td class="muted">${escapeHtml(dash.title)}</td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const sorted = [...list].sort((a, b) => { const av = (a[th.dataset.sort] || '').toString(), bv = (b[th.dataset.sort] || '').toString(); return av.localeCompare(bv); }); c.querySelector('tbody').innerHTML = DOMPurify.sanitize(sorted.map(dash => `<tr><td class="muted">${escapeHtml(dash.id)}</td><td class="muted">${escapeHtml(dash.title)}</td></tr>`).join('')); }));
    } catch (err) { showError(err.message); }
}

async function loadQuery() {
    try {
        const d = await api('query'); const c = $('qList');
        if (!d.endpoints || !d.endpoints.length) { c.innerHTML = '<p class="empty">No endpoints.</p>'; return; }
        let html = '<table><thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead><tbody>';
        d.endpoints.forEach(e => { html += `<tr><td class="muted">${escapeHtml(e.method)}</td><td class="muted">${escapeHtml(e.path)}</td><td class="muted">${escapeHtml(e.description)}</td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (err) { showError(err.message); }
}

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'dashboards') loadDashboards(); if (name === 'query') loadQuery(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('pProvision').addEventListener('click', provision); $('pTest').addEventListener('click', testConnection); $('dUnprovision').addEventListener('click', unprovision); $('dCopyUrl').addEventListener('click', () => { if (currentDs) copyToClipboard(currentDs.url); }); $('dCopyJson').addEventListener('click', () => { if (currentDs) copyToClipboard(JSON.stringify(currentDs, null, 2)); }); $('dSearch').addEventListener('input', loadDashboards); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('grafana-datasource', '/api/plugins/grafana-datasource/i18n'); await loadStatus(); await loadClusters(); await loadDs(); wireEvents(); })();
