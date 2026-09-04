/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/backup-verification-runner/ui.js
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
const t = (k, p) => i18n ? i18n.getT('backup-verification-runner')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('backup-verification-runner', '/api/plugins/backup-verification-runner/i18n');

const state = { clusters: [], vms: [], backups: [], results: [], schedules: [], history: [], sort: { col: 'checked_at', order: 'desc' } };

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; } catch (e) { $('status').textContent = 'Error'; } }
async function loadClusters() { try { const d = await api('clusters'); state.clusters = d.clusters || []; const opts = state.clusters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');['vCluster', 'sCluster'].forEach(id => { $(id).innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); }); } catch (e) { } }
async function loadVms(selectId, cluster) { try { const d = await api(`vms?cluster_id=${encodeURIComponent(cluster)}`); state.vms = d.vms || []; const opts = state.vms.map(v => { const label = v.type === 'lxc' ? `LXC ${v.name}` : `VM ${v.name}`; return `<option value="${escapeHtml(v.vmid)}">${escapeHtml(label)}</option>`; }).join(''); $(selectId).innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }
async function loadBackups(selectId, cluster, vmid) { try { $(selectId).innerHTML = '<option value="">Loading...</option>'; const d = await api(`backups?cluster_id=${encodeURIComponent(cluster)}&vmid=${encodeURIComponent(vmid)}`); state.backups = d.backups || []; if (!state.backups.length) { $(selectId).innerHTML = DOMPurify.sanitize('<option value="">No backups found</option>'); return; } const opts = state.backups.map(b => `<option value="${escapeHtml(b.volid || b)}">${escapeHtml(b.filename || b.volid || b)}</option>`).join(''); $(selectId).innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { console.error('loadBackups', e); $(selectId).innerHTML = DOMPurify.sanitize('<option value="">' + (e.message || 'Backups unavailable') + '</option>'); showError(e.message); } }

async function doVerify(e) { e.preventDefault(); $('vError').textContent = ''; const body = { cluster_id: $('vCluster').value, vmid: $('vVm').value, backup_id: $('vBackup').value }; try { const d = await api('verify', 'POST', body); toast(t('verified'), 'success'); $('verifyResult').hidden = false; $('resMetrics').innerHTML = DOMPurify.sanitize(`<div class="metric"><div class="value">${escapeHtml(d.result)}</div><div class="label">Status</div></div><div class="metric"><div class="value">${escapeHtml(d.id)}</div><div class="label">ID</div></div><div class="metric"><div class="value">${new Date(d.checked_at).toLocaleString()}</div><div class="label">Checked</div></div>`); } catch (err) { $('vError').textContent = err.message; showError(err.message); } }

async function doSchedule(e) { e.preventDefault(); $('sError').textContent = ''; const body = { cluster_id: $('sCluster').value, vmid: $('sVm').value, backup_id: $('sBackup').value, frequency: $('sFreq').value, cron: $('sCron').value }; try { await api('schedule', 'POST', body); toast(t('scheduled'), 'success'); $('scheduleForm').reset(); loadSchedules(); } catch (err) { $('sError').textContent = err.message; showError(err.message); } }

async function loadResults() { try { const params = new URLSearchParams({ cluster: $('rCluster').value, vm: $('rVm').value, status: $('rStatus').value, sort: state.sort.col, order: state.sort.order }); const d = await api(`results?${params}`); state.results = d.results || []; renderResults(); } catch (e) { showError(e.message); } }

function renderResults() {
    const c = $('resultsList');
    if (!state.results.length) { c.innerHTML = '<p class="empty">No results.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="checked_at">Checked</th><th data-sort="cluster_id">Cluster</th><th data-sort="vmid">VM</th><th data-sort="backup_id">Backup</th><th data-sort="result">Status</th></tr></thead><tbody>';
    state.results.forEach(r => {
        const cls = r.result === 'ok' ? 'success' : 'danger'; html += `<tr>
                <td class="muted">${new Date(r.checked_at).toLocaleString()}</td>
                <td class="muted">${escapeHtml(r.cluster_id)}</td>
                <td class="muted">${escapeHtml(r.vmid)}</td>
                <td class="muted">${escapeHtml(r.backup_id)}</td>
                <td class="muted"><span class="badge ${cls}">${escapeHtml(r.result)}</span></td>
            </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; state.sort.order = state.sort.col === col && state.sort.order === 'asc' ? 'desc' : 'asc'; state.sort.col = col; loadResults(); }));
}

async function loadSchedules() { try { const d = await api('schedule'); state.schedules = d.schedules || []; renderSchedules(); } catch (e) { showError(e.message); } }

function renderSchedules() {
    const c = $('schedulesList');
    if (!state.schedules.length) { c.innerHTML = '<p class="empty">No schedules.</p>'; return; }
    let html = '<table><thead><tr><th>Cluster</th><th>VM</th><th>Backup</th><th>Frequency</th><th>Next run</th><th>Actions</th></tr></thead><tbody>';
    state.schedules.forEach(s => {
        html += `<tr>
                <td class="muted">${escapeHtml(s.cluster_id)}</td>
                <td class="muted">${escapeHtml(s.vmid)}</td>
                <td class="muted">${escapeHtml(s.backup_id)}</td>
                <td class="muted">${escapeHtml(s.frequency)}</td>
                <td class="muted">${s.next_run ? new Date(s.next_run).toLocaleString() : '-'}</td>
                <td><button data-delete="${escapeHtml(s.id)}" class="secondary">Delete</button></td>
            </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete schedule?')) return; try { await api('schedule', 'DELETE', { id: b.dataset.delete }); toast(t('deleted'), 'success'); loadSchedules(); } catch (e) { showError(e.message); } }));
}

async function loadHistory() {
    try {
        const d = await api('history'); state.history = d.history || []; const c = $('historyGrid');
        if (!state.history.length) { c.innerHTML = '<p class="empty">No history yet.</p>'; return; }
        c.innerHTML = DOMPurify.sanitize(state.history.map(h => `<div class="metric"><div class="value">${escapeHtml(h.date)}</div><div class="label">OK ${escapeHtml(h.ok)} / Fail ${escapeHtml(h.fail)}</div></div>`).join(''));
    } catch (e) { showError(e.message); }
}

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('verifyForm').addEventListener('submit', doVerify); $('scheduleForm').addEventListener('submit', doSchedule); $('vCluster').addEventListener('change', () => loadVms('vVm', $('vCluster').value)); $('vVm').addEventListener('change', () => loadBackups('vBackup', $('vCluster').value, $('vVm').value)); $('sCluster').addEventListener('change', () => loadVms('sVm', $('sCluster').value)); $('sVm').addEventListener('change', () => loadBackups('sBackup', $('sCluster').value, $('sVm').value)); $('rLoad').addEventListener('click', loadResults); }

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'results') loadResults(); if (name === 'schedule') loadSchedules(); if (name === 'history') loadHistory(); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('backup-verification-runner', '/api/plugins/backup-verification-runner/i18n'); await loadStatus(); await loadClusters(); wireEvents(); })();
