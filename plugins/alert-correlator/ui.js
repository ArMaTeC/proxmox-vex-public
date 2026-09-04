/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/alert-correlator/ui.js
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
const t = (k, p) => i18n ? i18n.getT('alert-correlator')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('alert-correlator', '/api/plugins/alert-correlator/i18n');

const state = { incidents: [], rules: [], clusters: [], sort: { col: 'created_at', order: 'desc' } };

async function api(path, method = 'GET', body = null) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts); const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data;
}
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; $('metrics').innerHTML = DOMPurify.sanitize(`<div class="metric"><div class="value">${escapeHtml(s.open_count)}</div><div class="label">Open incidents</div></div><div class="metric"><div class="value">${escapeHtml(s.incident_count)}</div><div class="label">Total</div></div><div class="metric"><div class="value">${escapeHtml(s.rule_count)}</div><div class="label">Rules</div></div>`); } catch (e) { $('status').textContent = 'Error'; } }
async function loadClusters() { try { const d = await api('clusters'); state.clusters = d.data || []; const opts = state.clusters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name)}</option>`).join(''); $('cCluster').innerHTML = DOMPurify.sanitize('<option value="">Unclustered</option>' + opts); $('iCluster').innerHTML = DOMPurify.sanitize('<option value="">All clusters</option>' + opts); } catch (e) { } }
async function loadRules() { try { const d = await api('rules'); state.rules = d.rules || []; renderRules(); } catch (e) { showError(e.message); } }
async function loadIncidents() { try { const d = await api('incidents'); state.incidents = d.incidents || []; renderIncidents(); } catch (e) { showError(e.message); } }

function filteredIncidents() {
    const txt = $('iSearch').value.toLowerCase();
    const st = $('iStatus').value;
    const cl = $('iCluster').value;
    let data = state.incidents.filter(i => {
        const tmatch = !txt || (i.title || '').toLowerCase().includes(txt) || (i.incident_id || '').toLowerCase().includes(txt) || (i.cluster_id || '').toLowerCase().includes(txt);
        let stmatch = !st;
        if (st === 'acknowledged') stmatch = !!i.acknowledged && i.status !== 'resolved';
        else if (st === 'resolved') stmatch = i.status === 'resolved';
        else if (st === 'open') stmatch = !i.acknowledged && i.status !== 'resolved';
        const clmatch = !cl || i.cluster_id === cl;
        return tmatch && stmatch && clmatch;
    });
    data = data.sort((a, b) => {
        const av = a[state.sort.col], bv = b[state.sort.col];
        if (state.sort.col === 'alerts') { return state.sort.order === 'asc' ? av.length - bv.length : bv.length - av.length; }
        if (state.sort.col === 'created_at') { return state.sort.order === 'asc' ? new Date(av) - new Date(bv) : new Date(bv) - new Date(av); }
        if (state.sort.order === 'asc') { return String(av).localeCompare(String(bv)); } return String(bv).localeCompare(String(av));
    });
    return data;
}

function renderIncidents() {
    const data = filteredIncidents();
    const c = $('incidentsList');
    if (!data.length) { c.innerHTML = '<p class="empty">No incidents.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="incident_id">ID</th><th data-sort="cluster_id">Cluster</th><th>Alerts</th><th data-sort="status">Status</th><th data-sort="created_at">Created</th><th>Actions</th></tr></thead><tbody>';
    data.forEach(i => {
        html += `<tr>
                <td class="muted">${escapeHtml(i.incident_id)}</td>
                <td class="muted">${escapeHtml(i.cluster_id || '-')}</td>
                <td class="muted">${(i.alerts || []).length}</td>
                <td class="muted"><span class="badge ${i.status === 'resolved' ? 'success' : (i.acknowledged ? 'warning' : 'danger')}">${i.status === 'resolved' ? 'resolved' : (i.acknowledged ? 'ack' : 'open')}</span></td>
                <td class="muted">${new Date(i.created_at).toLocaleString()}</td>
                <td class="actions">
                    <button data-ack="${escapeHtml(i.incident_id)}">Ack</button>
                    <button data-resolve="${escapeHtml(i.incident_id)}" class="secondary">Resolve</button>
                    <button data-view="${escapeHtml(i.incident_id)}" class="secondary">View</button>
                </td>
            </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-ack]').forEach(b => b.addEventListener('click', () => { noteId = b.dataset.ack; $('noteText').value = ''; $('noteDialog').showModal(); }));
    c.querySelectorAll('button[data-resolve]').forEach(b => b.addEventListener('click', () => resolveIncident(b.dataset.resolve)));
    c.querySelectorAll('button[data-view]').forEach(b => b.addEventListener('click', () => { const inc = state.incidents.find(x => x.incident_id === b.dataset.view); alert('Alerts:\n' + JSON.stringify(inc.alerts || [], null, 2)); }));
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; state.sort.order = state.sort.col === col && state.sort.order === 'asc' ? 'desc' : 'asc'; state.sort.col = col; renderIncidents(); }));
}

let noteId = null;
async function ackWithNote() { if (!noteId) return; try { await api('ack', 'POST', { incident_id: noteId, note: $('noteText').value }); toast(t('acknowledged'), 'success'); loadIncidents(); $('noteDialog').close(); } catch (e) { showError(e.message); } }
async function resolveIncident(id) { if (!confirm('Resolve incident?')) return; try { await api('resolve', 'POST', { incident_id: id }); toast(t('resolved'), 'success'); loadIncidents(); } catch (e) { showError(e.message); } }

async function doCorrelate(e) {
    e.preventDefault(); $('cError').textContent = '';
    let alerts = [];
    try { const raw = $('cAlerts').value.trim(); alerts = raw ? JSON.parse(raw) : []; } catch (err) { $('cError').textContent = 'Alerts must be valid JSON'; showError('Invalid JSON'); return; }
    if (!Array.isArray(alerts) || !alerts.length) { $('cError').textContent = 'Alerts must be a non-empty array'; return; }
    try { await api('correlate', 'POST', { cluster_id: $('cCluster').value, title: $('cTitle').value.trim(), alerts }); toast(t('correlated'), 'success'); $('correlateForm').reset(); loadIncidents(); } catch (err) { $('cError').textContent = err.message; showError(err.message); }
}

function renderRules() {
    const c = $('rulesList');
    if (!state.rules.length) { c.innerHTML = '<p class="empty">No rules.</p>'; return; }
    let html = '<table><thead><tr><th>Rule ID</th><th>Description</th><th>Key</th><th>Actions</th></tr></thead><tbody>';
    state.rules.forEach(r => {
        html += `<tr>
                <td class="muted">${escapeHtml(r.rule_id)}</td>
                <td class="muted">${escapeHtml(r.description || '')}</td>
                <td class="muted">${escapeHtml(r.key || '')}</td>
                <td class="actions">
                    <button data-edit="${escapeHtml(r.rule_id)}">Edit</button>
                    <button data-delete="${escapeHtml(r.rule_id)}" class="secondary">Delete</button>
                </td>
            </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-edit]').forEach(b => b.addEventListener('click', () => editRule(b.dataset.edit)));
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deleteRule(b.dataset.delete)));
}

function editRule(id) { const r = state.rules.find(x => x.rule_id === id); if (!r) return; $('rOld').value = r.rule_id; $('rId').value = r.rule_id; $('rDesc').value = r.description || ''; $('rKey').value = r.key || ''; }
async function deleteRule(id) { if (!confirm('Delete rule?')) return; try { await api('rule_delete', 'DELETE', { rule_id: id }); toast(t('deletedRule'), 'success'); loadRules(); } catch (e) { showError(e.message); } }

async function saveRule(e) {
    e.preventDefault(); $('rError').textContent = '';
    const rid = $('rId').value.trim();
    if (!rid) { $('rError').textContent = 'Rule ID is required'; return; }
    try { await api('rule', 'POST', { rule_id: rid, id: $('rOld').value, description: $('rDesc').value.trim(), key: $('rKey').value.trim() }); toast(t('savedRule'), 'success'); $('ruleForm').reset(); loadRules(); } catch (err) { $('rError').textContent = err.message; showError(err.message); }
}

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('correlateForm').addEventListener('submit', doCorrelate); $('ruleForm').addEventListener('submit', saveRule); $('rReset').addEventListener('click', () => $('ruleForm').reset()); $('iSearch').addEventListener('input', renderIncidents); $('iStatus').addEventListener('change', renderIncidents); $('iCluster').addEventListener('change', renderIncidents); $('noteAck').addEventListener('click', ackWithNote); $('noteResolve').addEventListener('click', () => { resolveIncident(noteId); $('noteDialog').close(); }); $('noteClose').addEventListener('click', () => $('noteDialog').close()); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('alert-correlator', '/api/plugins/alert-correlator/i18n'); await loadStatus(); await loadClusters(); await loadRules(); await loadIncidents(); wireEvents(); })();
