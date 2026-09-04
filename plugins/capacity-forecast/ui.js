/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/capacity-forecast/ui.js
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
const t = (k, p) => i18n ? i18n.getT('capacity-forecast')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('capacity-forecast', '/api/plugins/capacity-forecast/i18n');

const state = { scenarios: [], schedules: [], sort: { col: 'name', order: 'asc' } };

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; } catch (e) { $('status').textContent = 'Error'; } }
async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join(''); const html = DOMPurify.sanitize('<option value="">Global</option>' + opts); $('fCluster').innerHTML = html; const h = $('hCluster'); if (h) h.innerHTML = html; } catch (e) { } }

function toCsv(forecast) { const rows = forecast.map(f => `${f.timestamp},${escapeHtml(f.value)}`); return "timestamp,value\n" + rows.join("\n"); }
function downloadCsv(content, filename) { const blob = new Blob([content], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); }
function downloadJson(obj, filename) { const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); }

async function loadForecast() {
    $('fResult').hidden = true; try {
        const threshold = parseFloat($('fThreshold').value); const thresholdParam = isNaN(threshold) ? '90' : String(threshold); const params = new URLSearchParams({ cluster_id: $('fCluster').value, resource: $('fResource').value, window: $('fWindow').value, threshold_pct: thresholdParam }); const d = await api(`forecast?${params}`); $('fResult').hidden = false; const max = Math.max(...d.forecast.map(f => f.value)); const thresholdPct = d.threshold_pct == null ? 90 : d.threshold_pct; const eta = d.eta_days == null ? 'Not within window' : d.eta_days; $('fMetrics').innerHTML = DOMPurify.sanitize(`<div class="metric"><div class="value">${escapeHtml(d.resource)}</div><div class="label">Resource</div></div><div class="metric"><div class="value">${d.window_days}</div><div class="label">Days</div></div><div class="metric"><div class="value">${max}</div><div class="label">Peak</div></div><div class="metric"><div class="value">${escapeHtml(thresholdPct)}%</div><div class="label">Threshold</div></div><div class="metric"><div class="value">${escapeHtml(eta)}</div><div class="label">ETA (days)</div></div>`); $('fChart').innerHTML = DOMPurify.sanitize(d.forecast.map(f => `<div class="bar" style="height:${(f.value / max) * 100}%" data-value="${escapeHtml(f.value)}" title="${escapeHtml(f.value)}"></div>`).join(''));
        let html = '<table><thead><tr><th>Timestamp</th><th>Value</th></tr></thead><tbody>'; d.forecast.forEach(f => { html += `<tr><td class="muted">${new Date(f.timestamp).toLocaleString()}</td><td class="muted">${escapeHtml(f.value)}</td></tr>`; }); html += '</tbody></table>'; $('fTable').innerHTML = DOMPurify.sanitize(html); window._lastForecast = d.forecast;
    } catch (e) { showError(e.message); }
}

async function saveScenario(e) { e.preventDefault(); $('sError').textContent = ''; const factors = { cpu: parseFloat($('fCpu').value) || 1, ram: parseFloat($('fRam').value) || 1, storage: parseFloat($('fStorage').value) || 1, power: parseFloat($('fPower').value) || 1 }; const body = { scenario_id: $('sId').value, name: $('sName').value.trim(), description: $('sDesc').value, factors }; try { await api('scenario', 'POST', body); toast(t('saved'), 'success'); $('scenarioForm').reset(); $('sId').value = ''; $('sFormTitle').textContent = 'Create Scenario'; loadScenarios(); } catch (err) { $('sError').textContent = err.message; showError(err.message); } }

async function loadScenarios() { try { const d = await api('scenario'); state.scenarios = d.scenarios || []; renderScenarios(); } catch (e) { showError(e.message); } }
function filteredScenarios() { const txt = ($('sSearch').value || '').toLowerCase(); let data = state.scenarios.filter(s => !txt || (s.name || '').toLowerCase().includes(txt)); data.sort((a, b) => { const av = String(a[state.sort.col] || '').toLowerCase(), bv = String(b[state.sort.col] || '').toLowerCase(); return state.sort.order === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av); }); return data; }

function renderScenarios() {
    const data = filteredScenarios(); const c = $('scenariosList');
    if (!data.length) { c.innerHTML = '<p class="empty">No scenarios.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="name">Name</th><th>Description</th><th data-sort="created_at">Created</th><th>Actions</th></tr></thead><tbody>';
    data.forEach(s => {
        html += `<tr>
                <td class="muted">${escapeHtml(s.name)}</td>
                <td class="muted">${escapeHtml(s.description || '-')}</td>
                <td class="muted">${s.created_at ? new Date(s.created_at).toLocaleString() : '-'}</td>
                <td class="actions">
                    <button data-edit="${escapeHtml(s.scenario_id)}">Edit</button>
                    <button data-apply="${escapeHtml(s.scenario_id)}">Apply</button>
                    <button data-clone="${escapeHtml(s.scenario_id)}">Clone</button>
                    <button data-delete="${escapeHtml(s.scenario_id)}" class="secondary">Delete</button>
                </td>
            </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-edit]').forEach(b => b.addEventListener('click', () => editScenario(b.dataset.edit)));
    c.querySelectorAll('button[data-apply]').forEach(b => b.addEventListener('click', () => applyScenario(b.dataset.apply)));
    c.querySelectorAll('button[data-clone]').forEach(b => b.addEventListener('click', () => cloneScenario(b.dataset.clone)));
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deleteScenario(b.dataset.delete)));
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; state.sort.order = state.sort.col === col && state.sort.order === 'asc' ? 'desc' : 'asc'; state.sort.col = col; renderScenarios(); }));
    const opts = state.scenarios.map(s => `<option value="${escapeHtml(s.scenario_id)}">${escapeHtml(s.name)}</option>`).join('');['sA', 'sB'].forEach(id => { $(id).innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); });
}

async function cloneScenario(id) { const s = state.scenarios.find(x => x.scenario_id === id); if (!s) return; const name = prompt('Clone as:', `Copy of ${s.name}`); if (!name) return; try { await api('scenario', 'POST', { name: name.trim(), clone_from: id }); toast('Cloned', 'success'); loadScenarios(); } catch (e) { showError(e.message); } }

function editScenario(id) { const s = state.scenarios.find(x => x.scenario_id === id); if (!s) return; $('sId').value = s.scenario_id; $('sName').value = s.name; $('sDesc').value = s.description || ''; $('fCpu').value = (s.factors || {}).cpu || 1; $('fRam').value = (s.factors || {}).ram || 1; $('fStorage').value = (s.factors || {}).storage || 1; $('fPower').value = (s.factors || {}).power || 1; $('sFormTitle').textContent = 'Edit Scenario'; }

async function deleteScenario(id) { if (!confirm('Delete scenario?')) return; try { await api('scenario', 'DELETE', { scenario_id: id }); toast(t('deleted'), 'success'); loadScenarios(); } catch (e) { showError(e.message); } }

async function applyScenario(id) {
    try {
        const threshold = parseFloat($('fThreshold').value); const thresholdParam = isNaN(threshold) ? '90' : String(threshold); const d = await api('apply', 'POST', { scenario_id: id, resource: $('fResource').value, window: $('fWindow').value, threshold_pct: thresholdParam }); switchTab('forecast'); $('fResult').hidden = false; const max = Math.max(...d.forecast.map(f => f.value)); const thresholdPct = d.threshold_pct == null ? 90 : d.threshold_pct; const eta = d.eta_days == null ? 'Not within window' : d.eta_days; $('fMetrics').innerHTML = DOMPurify.sanitize(`<div class="metric"><div class="value">${escapeHtml(d.resource)}</div><div class="label">Resource</div></div><div class="metric"><div class="value">${d.forecast.length}</div><div class="label">Days</div></div><div class="metric"><div class="value">${max}</div><div class="label">Peak</div></div><div class="metric"><div class="value">${escapeHtml(d.factor)}x</div><div class="label">Factor</div></div><div class="metric"><div class="value">${escapeHtml(thresholdPct)}%</div><div class="label">Threshold</div></div><div class="metric"><div class="value">${escapeHtml(eta)}</div><div class="label">ETA (days)</div></div>`); $('fChart').innerHTML = DOMPurify.sanitize(d.forecast.map(f => `<div class="bar" style="height:${(f.value / max) * 100}%" data-value="${escapeHtml(f.value)}" title="${escapeHtml(f.value)}"></div>`).join(''));
        let html = '<table><thead><tr><th>Timestamp</th><th>Adjusted</th><th>Baseline</th></tr></thead><tbody>'; d.forecast.forEach(f => { html += `<tr><td class="muted">${new Date(f.timestamp).toLocaleString()}</td><td class="muted">${escapeHtml(f.value)}</td><td class="muted">${escapeHtml(f.baseline)}</td></tr>`; }); html += '</tbody></table>'; $('fTable').innerHTML = DOMPurify.sanitize(html); toast('Applied scenario ' + id, 'success');
    } catch (e) { showError(e.message); }
}

async function doCompare() { const a = $('sA').value, b = $('sB').value; if (!a || !b) { showError('Select both scenarios'); return; } try { const d = await api('compare', 'POST', { a, b, resource: $('fResource').value }); $('compareResult').innerHTML = DOMPurify.sanitize(`<p class="muted">Delta for ${escapeHtml(d.resource)}</p><table><thead><tr><th>Timestamp</th><th>${escapeHtml(d.a)}</th><th>${escapeHtml(d.b)}</th><th>Delta</th></tr></thead><tbody>` + d.comparison.map(r => `<tr><td class="muted">${new Date(r.timestamp).toLocaleString()}</td><td class="muted">${escapeHtml(r.a)}</td><td class="muted">${escapeHtml(r.b)}</td><td class="muted">${escapeHtml(r.delta)}</td></tr>`).join('') + '</tbody></table>'); } catch (e) { showError(e.message); } }

async function loadTrends() {
    try {
        const d = await api('trends'); const c = $('trendsList');
        if (!d.trends.length) { c.innerHTML = '<p class="empty">No trends.</p>'; return; }
        c.innerHTML = DOMPurify.sanitize('<div class="grid">' + d.trends.map(t => `<div class="metric"><div class="value">${escapeHtml(t.resource)}</div><div class="label">${escapeHtml(t.last_value)} (${escapeHtml(t.trend)})</div></div>`).join('') + '</div>');
    } catch (e) { showError(e.message); }
}

async function loadSchedules() {
    try {
        const d = await api('schedules'); state.schedules = d.schedules || []; const c = $('schedulesList');
        if (!state.schedules.length) { c.innerHTML = '<p class="empty">No schedules.</p>'; return; }
        let html = '<table><thead><tr><th>Resource</th><th>Cron</th><th>Enabled</th><th>Actions</th></tr></thead><tbody>';
        state.schedules.forEach(s => {
            html += `<tr>
                <td class="muted">${escapeHtml(s.resource)}</td>
                <td class="muted">${escapeHtml(s.cron)}</td>
                <td class="muted">${s.enabled === false ? 'No' : 'Yes'}</td>
                <td>
                    <button data-toggle="${escapeHtml(s.id)}" data-current="${s.enabled === false ? '0' : '1'}">${s.enabled === false ? 'Enable' : 'Disable'}</button>
                    <button data-delete="${escapeHtml(s.id)}" class="secondary">Delete</button>
                </td>
            </tr>`;
        });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete schedule?')) return; try { await api('schedules', 'DELETE', { id: b.dataset.delete }); toast(t('deleted'), 'success'); loadSchedules(); } catch (e) { showError(e.message); } }));
        c.querySelectorAll('button[data-toggle]').forEach(b => b.addEventListener('click', () => toggleSchedule(b.dataset.toggle, b.dataset.current === '0')));
    } catch (e) { showError(e.message); }
}

async function toggleSchedule(id, enable) { try { await api('schedules', 'PUT', { id, enabled: enable }); toast(enable ? 'Enabled' : 'Disabled', 'success'); loadSchedules(); } catch (e) { showError(e.message); } }

async function saveSchedule() { $('shError').textContent = ''; const cron = $('shCron').value.trim(); const parts = cron.split(/\s+/); if (parts.length !== 5 || !parts.every(p => /^[\d*,/-]+$/.test(p))) { $('shError').textContent = 'Invalid cron: must be 5 fields (min hour day month weekday)'; showError('Invalid cron expression'); return; } const body = { cron, resource: $('shResource').value, enabled: $('shEnabled').checked }; try { await api('schedules', 'POST', body); toast(t('scheduled'), 'success'); loadSchedules(); } catch (e) { $('shError').textContent = e.message; showError(e.message); } }

async function loadHistory() { $('hResult').hidden = true; try { const params = new URLSearchParams({ cluster_id: $('hCluster').value, node: $('hNode').value, resource: $('hResource').value, days: $('hDays').value, step: $('hStep').value }); const d = await api(`history?${params}`); $('hResult').hidden = false; const samples = d.samples || []; window._lastHistory = samples; if (!samples.length) { $('hChart').innerHTML = `<p class="empty">${escapeHtml(d.note || 'No history yet.')}</p>`; $('hTable').innerHTML = ''; $('hMetrics').innerHTML = ''; return; } const max = Math.max(...samples.map(s => s.value)); const min = Math.min(...samples.map(s => s.value)); const avg = (samples.reduce((a, b) => a + b.value, 0) / samples.length).toFixed(2); const stepLabel = d.step ? `${d.step}s` : 'raw'; const nodeLabel = d.node || 'all'; const noteHtml = d.note ? `<p class="empty">${escapeHtml(d.note)}</p>` : ''; $('hMetrics').innerHTML = DOMPurify.sanitize(`${noteHtml}<div class="metric"><div class="value">${escapeHtml(d.resource)}</div><div class="label">Resource</div></div><div class="metric"><div class="value">${escapeHtml(nodeLabel)}</div><div class="label">Node</div></div><div class="metric"><div class="value">${samples.length}</div><div class="label">Samples</div></div><div class="metric"><div class="value">${stepLabel}</div><div class="label">Step</div></div><div class="metric"><div class="value">${max}</div><div class="label">Peak</div></div><div class="metric"><div class="value">${avg}</div><div class="label">Avg</div></div><div class="metric"><div class="value">${min}</div><div class="label">Min</div></div>`); $('hChart').innerHTML = DOMPurify.sanitize(samples.map(s => `<div class="bar" style="height:${(s.value / max) * 100}%" data-value="${escapeHtml(s.value)}" title="${escapeHtml(s.value)}"></div>`).join('')); let html = '<table><thead><tr><th>Timestamp</th><th>Value</th></tr></thead><tbody>'; samples.forEach(s => { html += `<tr><td class="muted">${new Date(s.timestamp).toLocaleString()}</td><td class="muted">${escapeHtml(s.value)}</td></tr>`; }); html += '</tbody></table>'; $('hTable').innerHTML = DOMPurify.sanitize(html); } catch (e) { showError(e.message); } }

async function exportScenarios() { try { const d = await api('scenario/export'); downloadJson(d, 'scenarios.json'); toast('Exported', 'success'); } catch (e) { showError(e.message); } }

async function importScenarios(file) { if (!file) return; try { const text = await file.text(); const payload = JSON.parse(text); await api('scenario/import', 'POST', { scenarios: payload.scenarios || payload }); toast('Imported', 'success'); loadScenarios(); } catch (e) { showError(e.message); } }

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'trends') loadTrends(); if (name === 'schedules') loadSchedules(); if (name === 'scenarios') loadScenarios(); if (name === 'history') loadHistory(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('fLoad').addEventListener('click', loadForecast); $('fExportCsv').addEventListener('click', () => { if (window._lastForecast) downloadCsv(toCsv(window._lastForecast), 'forecast.csv'); }); $('scenarioForm').addEventListener('submit', saveScenario); $('sReset').addEventListener('click', () => { $('scenarioForm').reset(); $('sId').value = ''; $('sFormTitle').textContent = 'Create Scenario'; }); $('sSearch').addEventListener('input', renderScenarios); $('btnCompare').addEventListener('click', doCompare); $('sExport').addEventListener('click', exportScenarios); $('sImportBtn').addEventListener('click', () => $('sImport').click()); $('sImport').addEventListener('change', (e) => { if (e.target.files[0]) importScenarios(e.target.files[0]); e.target.value = ''; }); $('shSave').addEventListener('click', saveSchedule); $('hLoad').addEventListener('click', loadHistory); $('hExportCsv').addEventListener('click', () => { if (window._lastHistory) downloadCsv(toCsv(window._lastHistory), 'history.csv'); }); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('capacity-forecast', '/api/plugins/capacity-forecast/i18n'); await loadStatus(); await loadClusters(); wireEvents(); })();
