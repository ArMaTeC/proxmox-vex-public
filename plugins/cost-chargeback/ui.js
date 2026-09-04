/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/cost-chargeback/ui.js
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
const t = (k, p) => i18n ? i18n.getT('cost-chargeback')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('cost-chargeback', '/api/plugins/cost-chargeback/i18n');

const state = { rates: {} };

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

async function loadStatus() { try { const s = await api('status'); state.rates = s.rates || {}; Object.keys(state.rates).forEach(k => { const el = $(`r${k.replace(/_\w/g, m => m[1].toUpperCase()).replace(/^[a-z]/, c => c.toUpperCase())}`); if (el) el.value = state.rates[k]; }); $('status').textContent = s.status === 'running' ? 'Running' : s.status; renderRateCards(); } catch (e) { $('status').textContent = 'Error'; } }
function renderRateCards() { const c = $('rateCards'); c.innerHTML = DOMPurify.sanitize(Object.keys(state.rates || {}).map(k => `<div class="metric"><div class="value">${escapeHtml(state.rates[k])}</div><div class="label">${escapeHtml(k)}</div></div>`).join('')); }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');['cCluster', 'sCluster', 'iCluster'].forEach(id => $(id).innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts)); } catch (e) { } }

async function setRates(e) { e.preventDefault(); $('rError').textContent = ''; const body = { cpu_per_core_hour: parseFloat($('rCpu').value), ram_per_gb_hour: parseFloat($('rRam').value), storage_per_gb_hour: parseFloat($('rStorage').value), network_per_gb: parseFloat($('rNet').value), power_per_kwh: parseFloat($('rPower').value) }; try { const d = await api('rate', 'POST', body); state.rates = d.rates; renderRateCards(); toast(t('saved'), 'success'); } catch (err) { $('rError').textContent = err.message; showError(err.message); } }

async function loadReport() {
    $('cError').textContent = ''; const c = $('cCluster').value, from = $('cFrom').value, to = $('cTo').value; if (!c) { showError('Select a cluster'); return; } try {
        const d = await api(`report?cluster_id=${encodeURIComponent(c)}&from=${from}&to=${to}`); const r = $('reportResult');
        if (!d.allocations.length) { r.innerHTML = '<p class="empty">No allocations.</p>'; return; }
        let html = `<div class="grid"><div class="metric"><div class="value">$${escapeHtml(d.total_cost)}</div><div class="label">Total Cost</div></div></div><table><thead><tr><th data-sort="vm">VM</th><th data-sort="cpu_cost">CPU</th><th data-sort="ram_cost">RAM</th><th data-sort="storage_cost">Storage</th><th data-sort="network_cost">Network</th><th data-sort="power_cost">Power</th><th data-sort="cost">Total</th></tr></thead><tbody>`;
        d.allocations.forEach(a => { html += `<tr><td class="muted">${escapeHtml(a.vm || '-')}</td><td class="muted">${escapeHtml(a.cpu_cost || 0)}</td><td class="muted">${escapeHtml(a.ram_cost || 0)}</td><td class="muted">${escapeHtml(a.storage_cost || 0)}</td><td class="muted">${escapeHtml(a.network_cost || 0)}</td><td class="muted">${escapeHtml(a.power_cost || 0)}</td><td class="muted">${escapeHtml(a.cost || 0)}</td></tr>`; });
        html += '</tbody></table>'; r.innerHTML = DOMPurify.sanitize(html);
        r.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { loadReportSorted(th.dataset.sort); }));
    } catch (err) { $('cError').textContent = err.message; showError(err.message); }
}
async function loadReportSorted(col) {
    const c = $('cCluster').value, from = $('cFrom').value, to = $('cTo').value; try {
        const d = await api(`report?cluster_id=${encodeURIComponent(c)}&from=${from}&to=${to}&sort=${col}&order=desc`); const r = $('reportResult');
        let html = `<div class="grid"><div class="metric"><div class="value">$${escapeHtml(d.total_cost)}</div><div class="label">Total Cost</div></div></div><table><thead><tr><th data-sort="vm">VM</th><th data-sort="cpu_cost">CPU</th><th data-sort="ram_cost">RAM</th><th data-sort="storage_cost">Storage</th><th data-sort="network_cost">Network</th><th data-sort="power_cost">Power</th><th data-sort="cost">Total</th></tr></thead><tbody>`;
        d.allocations.forEach(a => { html += `<tr><td class="muted">${escapeHtml(a.vm || '-')}</td><td class="muted">${escapeHtml(a.cpu_cost || 0)}</td><td class="muted">${escapeHtml(a.ram_cost || 0)}</td><td class="muted">${escapeHtml(a.storage_cost || 0)}</td><td class="muted">${escapeHtml(a.network_cost || 0)}</td><td class="muted">${escapeHtml(a.power_cost || 0)}</td><td class="muted">${escapeHtml(a.cost || 0)}</td></tr>`; });
        html += '</tbody></table>'; r.innerHTML = DOMPurify.sanitize(html);
        r.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { loadReportSorted(th.dataset.sort); }));
    } catch (err) { showError(err.message); }
}

async function loadSummary() {
    $('sError').textContent = ''; const c = $('sCluster').value, from = $('sFrom').value, to = $('sTo').value; if (!c) { showError('Select a cluster'); return; } try {
        const d = await api(`summary?cluster_id=${encodeURIComponent(c)}&from=${from}&to=${to}`); const r = $('summaryResult');
        if (!d.tenants.length) { r.innerHTML = '<p class="empty">No tenants.</p>'; return; }
        let html = `<div class="grid"><div class="metric"><div class="value">$${escapeHtml(d.total)}</div><div class="label">Total</div></div></div><table><thead><tr><th>Tenant</th><th>Cost</th><th>Percent</th></tr></thead><tbody>`;
        d.tenants.forEach(tn => { html += `<tr><td class="muted">${escapeHtml(tn.tenant)}</td><td class="muted">${escapeHtml(tn.cost)}</td><td class="muted">${escapeHtml(tn.percent)}%</td></tr>`; });
        html += '</tbody></table>'; r.innerHTML = DOMPurify.sanitize(html);
    } catch (err) { $('sError').textContent = err.message; showError(err.message); }
}

async function createInvoice() { $('iError').textContent = ''; const body = { cluster_id: $('iCluster').value, tenant: $('iTenant').value.trim(), period: $('iPeriod').value.trim(), total: parseFloat($('iTotal').value) }; if (!body.cluster_id || !body.tenant || isNaN(body.total)) { $('iError').textContent = 'Cluster, tenant, and total required'; return; } try { const d = await api('invoices', 'POST', body); toast(t('generated'), 'success'); loadInvoices(); } catch (err) { $('iError').textContent = err.message; showError(err.message); } }

async function loadInvoices() {
    try {
        const d = await api('invoice-list'); const c = $('invoicesList');
        if (!d.invoices.length) { c.innerHTML = '<p class="empty">No invoices.</p>'; return; }
        let html = '<table><thead><tr><th>Date</th><th>Tenant</th><th>Period</th><th>Total</th><th>Status</th></tr></thead><tbody>';
        d.invoices.forEach(i => { html += `<tr><td class="muted">${escapeHtml(new Date(i.date).toLocaleDateString())}</td><td class="muted">${escapeHtml(i.tenant)}</td><td class="muted">${escapeHtml(i.period)}</td><td class="muted">${escapeHtml(i.total)}</td><td class="muted">${escapeHtml(i.status)}</td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { }
}

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('rateForm').addEventListener('submit', setRates); $('rReset').addEventListener('click', () => { $('rateForm').reset(); }); $('cLoad').addEventListener('click', loadReport); $('sLoad').addEventListener('click', loadSummary); $('iCreate').addEventListener('click', createInvoice); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('cost-chargeback', '/api/plugins/cost-chargeback/i18n'); await loadStatus(); await loadClusters(); wireEvents(); loadInvoices(); })();
