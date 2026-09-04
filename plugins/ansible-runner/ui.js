/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/ansible-runner/ui.js
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
const t = (k, p) => i18n ? i18n.getT('ansible-runner')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('ansible-runner', '/api/plugins/ansible-runner/i18n');

const state = { playbooks: [], runs: [], schedules: [], clusters: [] };

async function api(path, method = 'GET', body = null) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts); const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data;
}
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; } catch (e) { $('status').textContent = 'Error'; } }
async function loadClusters() { try { const d = await api('clusters'); state.clusters = d.data || []; const opts = state.clusters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name)}</option>`).join(''); $('rCluster').innerHTML = DOMPurify.sanitize('<option value="">None</option>' + opts); $('sCluster').innerHTML = DOMPurify.sanitize('<option value="">None</option>' + opts); } catch (e) { } }
async function loadPlaybooks() { try { const d = await api('playbooks'); state.playbooks = d.playbooks || []; renderPlaybooks(); updatePlaybookSelects(); } catch (e) { showError(e.message); } }
async function loadRuns() { try { const d = await api('runs'); state.runs = d.runs || []; renderRuns(); } catch (e) { showError(e.message); } }
async function loadSchedules() { try { const d = await api('schedules'); state.schedules = d.schedules || []; renderSchedules(); } catch (e) { showError(e.message); } }

function updatePlaybookSelects() { const opts = state.playbooks.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join(''); $('rPlaybook').innerHTML = DOMPurify.sanitize(opts); $('sPlaybook').innerHTML = DOMPurify.sanitize(opts); }

function filteredPlaybooks() { const txt = $('pbSearch').value.toLowerCase(); return state.playbooks.filter(p => (p.name || '').toLowerCase().includes(txt) || (p.path || '').toLowerCase().includes(txt)); }

function renderPlaybooks() {
    const data = filteredPlaybooks(); const c = $('playbooksList');
    if (!data.length) { c.innerHTML = '<p class="empty">No playbooks.</p>'; return; }
    let html = '<table><thead><tr><th>Name</th><th>Path</th><th>Actions</th></tr></thead><tbody>';
    data.forEach(p => { html += `<tr><td class="muted">${escapeHtml(p.name)}</td><td class="muted">${escapeHtml(p.path)}</td><td class="actions"><button data-edit="${escapeHtml(p.id)}">Edit</button><button data-delete="${escapeHtml(p.id)}" class="secondary">Delete</button></td></tr>`; });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-edit]').forEach(b => b.addEventListener('click', () => editPb(b.dataset.edit)));
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deletePb(b.dataset.delete)));
}

async function editPb(id) { const p = state.playbooks.find(x => x.id === id); if (!p) return; $('pbOld').value = p.id; $('pbName').value = p.name; $('pbPath').value = p.path; try { const d = await api(`playbook-content?id=${encodeURIComponent(id)}`); $('pbContent').value = d.content || ''; } catch (e) { $('pbContent').value = ''; } }
async function deletePb(id) { if (!confirm('Delete playbook?')) return; try { await api('playbooks', 'DELETE', { id }); toast(t('deletedPb'), 'success'); loadPlaybooks(); } catch (e) { showError(e.message); } }

async function savePb(e) {
    e.preventDefault(); $('pbError').textContent = '';
    const name = $('pbName').value.trim(), path = $('pbPath').value.trim();
    if (!name || !path) { $('pbError').textContent = 'Name and path are required'; return; }
    try { await api('playbooks', 'POST', { id: $('pbOld').value, name, path, content: $('pbContent').value }); toast(t('savedPb'), 'success'); $('pbForm').reset(); loadPlaybooks(); } catch (err) { $('pbError').textContent = err.message; showError(err.message); }
}

async function doRun(e) {
    e.preventDefault(); $('rError').textContent = ''; $('runResult').innerHTML = '';
    let extra = {}; try { const raw = $('rExtra').value.trim(); extra = raw ? JSON.parse(raw) : {}; } catch (err) { $('rError').textContent = 'Extra vars must be valid JSON'; showError('Invalid JSON'); return; }
    const playbook = $('rPlaybook').value; if (!playbook) { $('rError').textContent = 'Playbook is required'; return; }
    const body = { playbook, cluster_id: $('rCluster').value, limit: $('rLimit').value.trim(), extra_vars: extra, dry_run: $('rDry').checked };
    try { const d = await api('run', 'POST', body); toast(`${t('run')} ${escapeHtml(d.run.run_id)}`, 'success'); $('runResult').innerHTML = DOMPurify.sanitize(`<p class="message success">Queued: ${escapeHtml(d.run.run_id)}</p>`); loadRuns(); } catch (err) { $('rError').textContent = err.message; showError(err.message); }
}

function renderRuns() {
    const c = $('runsList');
    if (!state.runs.length) { c.innerHTML = '<p class="empty">No runs.</p>'; return; }
    let html = '<table><thead><tr><th>Run ID</th><th>Playbook</th><th>Cluster</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>';
    state.runs.forEach(r => { html += `<tr><td class="muted">${escapeHtml(r.run_id)}</td><td class="muted">${escapeHtml(r.playbook)}</td><td class="muted">${escapeHtml(r.cluster_id || '-')}</td><td class="muted"><span class="badge">${escapeHtml(r.status)}</span></td><td class="muted">${new Date(r.created_at).toLocaleString()}</td><td class="actions"><button data-logs="${escapeHtml(r.run_id)}">Logs</button></td></tr>`; });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-logs]').forEach(b => b.addEventListener('click', () => showLogs(b.dataset.logs)));
}

async function showLogs(run_id) { try { const d = await api(`logs?run_id=${run_id}`); const text = d.logs.length ? d.logs.map(l => l.line).join('\n') : 'No logs'; alert(`Logs for ${run_id}:\n${text}`); } catch (e) { showError(e.message); } }

function renderSchedules() {
    const c = $('schedulesList');
    if (!state.schedules.length) { c.innerHTML = '<p class="empty">No schedules.</p>'; return; }
    let html = '<table><thead><tr><th>Playbook</th><th>Cluster</th><th>Cron</th><th>Enabled</th><th>Actions</th></tr></thead><tbody>';
    state.schedules.forEach(s => { html += `<tr><td class="muted">${escapeHtml(s.playbook)}</td><td class="muted">${escapeHtml(s.cluster_id || '-')}</td><td class="muted">${escapeHtml(s.schedule)}</td><td class="muted">${s.enabled ? 'Yes' : 'No'}</td><td class="actions"><button data-delete="${escapeHtml(s.id)}" class="secondary">Delete</button></td></tr>`; });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deleteSchedule(b.dataset.delete)));
}

async function addSchedule(e) {
    e.preventDefault(); $('sError').textContent = '';
    let extra = {}; try { const raw = $('sExtra').value.trim(); extra = raw ? JSON.parse(raw) : {}; } catch (err) { $('sError').textContent = 'Extra vars must be valid JSON'; showError('Invalid JSON'); return; }
    try { await api('schedules', 'POST', { playbook: $('sPlaybook').value, cluster_id: $('sCluster').value, schedule: $('sCron').value.trim(), extra_vars: extra, enabled: $('sEnabled').checked }); toast(t('schedule'), 'success'); $('schForm').reset(); $('sEnabled').checked = true; loadSchedules(); } catch (err) { $('sError').textContent = err.message; showError(err.message); }
}

async function deleteSchedule(id) { if (!confirm('Delete schedule?')) return; try { await api('schedules', 'DELETE', { id }); loadSchedules(); } catch (e) { showError(e.message); } }

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'runs') loadRuns(); if (name === 'schedule') loadSchedules(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('pbForm').addEventListener('submit', savePb); $('pbReset').addEventListener('click', () => $('pbForm').reset()); $('runForm').addEventListener('submit', doRun); $('schForm').addEventListener('submit', addSchedule); $('pbSearch').addEventListener('input', renderPlaybooks); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('ansible-runner', '/api/plugins/ansible-runner/i18n'); await loadStatus(); await loadClusters(); await loadPlaybooks(); wireEvents(); })();
