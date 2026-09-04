/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/carbon-footprint/ui.js
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
const t = (k, p) => i18n ? i18n.getT('carbon-footprint')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('carbon-footprint', '/api/plugins/carbon-footprint/i18n');

const state = { estimates: [], presets: [], sort: { col: 'created_at', order: 'desc' } };
let lastEstimate = null;

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; } catch (e) { $('status').textContent = 'Error'; } }
async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join(''); const html = '<option value="">Select</option>' + opts; $('eCluster').innerHTML = DOMPurify.sanitize(html); $('lCluster').innerHTML = DOMPurify.sanitize(html); } catch (e) { } }
async function loadFactor() { try { const d = await api('factor'); $('fValue').value = d.factor; state.presets = d.presets || []; $('fPreset').innerHTML = DOMPurify.sanitize('<option value="">Custom</option>' + (d.presets || []).map(p => `<option value="${escapeHtml(p.value)}">${escapeHtml(p.name)}</option>`).join('')); } catch (e) { } }

async function doEstimate(e) { e.preventDefault(); $('eError').textContent = ''; try { const params = new URLSearchParams({ cluster_id: $('eCluster').value, hours: $('eHours').value, kw: $('eKw').value }); lastEstimate = await api(`estimate?${params}`); $('eResult').hidden = false; $('eMetrics').innerHTML = DOMPurify.sanitize(`<div class="metric"><div class="value">${escapeHtml(lastEstimate.energy_kwh)}</div><div class="label">Energy kWh</div></div><div class="metric"><div class="value">${escapeHtml(lastEstimate.co2_kg)}</div><div class="label">CO₂ kg</div></div><div class="metric"><div class="value">${escapeHtml(lastEstimate.factor)}</div><div class="label">Factor</div></div>`); } catch (err) { $('eError').textContent = err.message; showError(err.message); } }

async function doLiveScan(e) { e.preventDefault(); $('lError').textContent = ''; try { const params = new URLSearchParams({ cluster_id: $('lCluster').value, hours: $('lHours').value }); lastEstimate = await api(`live?${params}`); $('lResult').hidden = false; $('lMetrics').innerHTML = DOMPurify.sanitize(`<div class="metric"><div class="value">${escapeHtml(lastEstimate.power_w)}</div><div class="label">Power W</div></div><div class="metric"><div class="value">${escapeHtml(lastEstimate.energy_kwh)}</div><div class="label">Energy kWh</div></div><div class="metric"><div class="value">${escapeHtml(lastEstimate.co2_kg)}</div><div class="label">CO₂ kg</div></div><div class="metric"><div class="value">${escapeHtml(lastEstimate.average_kw)}</div><div class="label">Average kW</div></div>`); const b = lastEstimate.breakdown; $('lBreakdown').textContent = `${b.running_vms} running VMs across ${b.nodes} nodes (idle ${b.node_idle_w}W + CPU ${b.cpu_w}W + RAM ${b.mem_w}W, PUE ${b.pue})`; } catch (err) { $('lError').textContent = err.message; showError(err.message); } }

async function saveEstimate() { if (!lastEstimate) { showError('Run an estimate first'); return; } try { const body = { cluster_id: lastEstimate.cluster_id, hours: lastEstimate.hours, kw: lastEstimate.average_kw }; const d = await api('estimates', 'POST', body); toast(t('saved'), 'success'); loadEstimates(); } catch (e) { showError(e.message); } }

async function loadEstimates() { try { const params = new URLSearchParams({ cluster: $('esFilter').value, sort: state.sort.col, order: state.sort.order }); const d = await api(`estimates?${params}`); state.estimates = d.estimates || []; renderEstimates(); } catch (e) { showError(e.message); } }

function renderEstimates() {
    const c = $('estimatesList');
    if (!state.estimates.length) { c.innerHTML = '<p class="empty">No estimates.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="cluster_id">Cluster</th><th data-sort="hours">Hours</th><th data-sort="average_kw">kW</th><th data-sort="energy_kwh">Energy</th><th data-sort="co2_kg">CO₂</th><th data-sort="created_at">Created</th><th>Actions</th></tr></thead><tbody>';
    state.estimates.forEach(e => {
        html += `<tr>
                <td class="muted">${escapeHtml(e.cluster_id)}</td>
                <td class="muted">${escapeHtml(e.hours)}</td>
                <td class="muted">${escapeHtml(e.average_kw)}</td>
                <td class="muted">${escapeHtml(e.energy_kwh)}</td>
                <td class="muted">${escapeHtml(e.co2_kg)}</td>
                <td class="muted">${new Date(e.created_at).toLocaleString()}</td>
                <td class="actions">
                    <button data-view="${escapeHtml(e.id)}">View</button>
                    <button data-rerun="${escapeHtml(e.id)}" class="secondary">Re-run</button>
                    <button data-delete="${escapeHtml(e.id)}" class="secondary">Delete</button>
                </td>
            </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-view]').forEach(b => b.addEventListener('click', () => { const est = state.estimates.find(x => x.id === b.dataset.view); if (!est) return; toast(`Energy ${est.energy_kwh} kWh / CO₂ ${est.co2_kg} kg`); }));
    c.querySelectorAll('button[data-rerun]').forEach(b => b.addEventListener('click', async () => { const est = state.estimates.find(x => x.id === b.dataset.view); if (!est) return; try { const params = new URLSearchParams({ cluster_id: est.cluster_id, hours: est.hours, kw: est.average_kw }); lastEstimate = await api(`estimate?${params}`); switchTab('estimate'); $('eResult').hidden = false; $('eMetrics').innerHTML = DOMPurify.sanitize(`<div class="metric"><div class="value">${escapeHtml(lastEstimate.energy_kwh)}</div><div class="label">Energy kWh</div></div><div class="metric"><div class="value">${escapeHtml(lastEstimate.co2_kg)}</div><div class="label">CO₂ kg</div></div><div class="metric"><div class="value">${escapeHtml(lastEstimate.factor)}</div><div class="label">Factor</div></div>`); } catch (e) { showError(e.message); } }));
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete estimate?')) return; try { await api('estimates', 'DELETE', { id: b.dataset.delete }); toast(t('deleted'), 'success'); loadEstimates(); } catch (e) { showError(e.message); } }));
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; state.sort.order = state.sort.col === col && state.sort.order === 'asc' ? 'desc' : 'asc'; state.sort.col = col; renderEstimates(); }));
}

async function setFactor() { $('fError').textContent = ''; const v = parseFloat($('fValue').value); try { await api('factor', 'POST', { factor: v }); toast(t('factored'), 'success'); } catch (err) { $('fError').textContent = err.message; showError(err.message); } }

async function loadTrends() {
    try {
        const d = await api('trends'); const c = $('trendsList');
        if (!d.trends.length) { c.innerHTML = '<p class="empty">No trends.</p>'; return; }
        let html = '<table><thead><tr><th>Cluster</th><th>Timestamp</th><th>CO₂</th></tr></thead><tbody>';
        d.trends.forEach(t => { html += `<tr><td class="muted">${escapeHtml(t.cluster_id)}</td><td class="muted">${t.timestamp ? new Date(t.timestamp).toLocaleString() : '-'}</td><td class="muted">${escapeHtml(t.co2_kg)}</td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showError(e.message); }
}

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'estimates') loadEstimates(); if (name === 'trends') loadTrends(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('estForm').addEventListener('submit', doEstimate); $('eSave').addEventListener('click', saveEstimate); $('liveForm').addEventListener('submit', doLiveScan); $('lSave').addEventListener('click', saveEstimate); $('fSet').addEventListener('click', setFactor); $('fPreset').addEventListener('change', () => { if ($('fPreset').value) $('fValue').value = $('fPreset').value; }); $('esFilter').addEventListener('input', loadEstimates); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('carbon-footprint', '/api/plugins/carbon-footprint/i18n'); await loadStatus(); await loadClusters(); await loadFactor(); wireEvents(); })();
