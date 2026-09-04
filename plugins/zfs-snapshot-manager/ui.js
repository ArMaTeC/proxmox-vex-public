/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/zfs-snapshot-manager/ui.js
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
const t = (k, p) => i18n ? i18n.getT('zfs-snapshot-manager')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('zfs-snapshot-manager', '/api/plugins/zfs-snapshot-manager/i18n');

const state = { snapshots: [], datasets: [], sort: { col: 'dataset', order: 'asc' } };

async function api(path, method = 'GET', body = null) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts); const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data;
}
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; } catch (e) { $('status').textContent = 'Error'; } }
async function loadDatasets() { try { const d = await api('datasets'); state.datasets = d.data || []; $('datasets').innerHTML = DOMPurify.sanitize(state.datasets.map(ds => `<option value="${escapeHtml(ds)}">`).join('')); $('zDataset').innerHTML = DOMPurify.sanitize('<option value="">All datasets</option>' + state.datasets.map(ds => `<option value="${escapeHtml(ds)}">${escapeHtml(ds)}</option>`).join('')); } catch (e) { } }
async function loadSnapshots() { try { const d = await api('snapshots'); state.snapshots = Array.isArray(d) ? d : (d.data || []); renderSnapshots(); } catch (e) { showError(e.message); } }

function filteredSnapshots() {
    const txt = $('zSearch').value.toLowerCase();
    const ds = $('zDataset').value;
    let data = state.snapshots.filter(s => {
        const tmatch = !txt || (s.dataset || '').toLowerCase().includes(txt) || (s.name || '').toLowerCase().includes(txt);
        const dmatch = !ds || s.dataset === ds;
        return tmatch && dmatch;
    });
    data = data.sort((a, b) => {
        const av = (a[state.sort.col] || ''), bv = (b[state.sort.col] || '');
        if (state.sort.col === 'created_at') { return state.sort.order === 'asc' ? new Date(av) - new Date(bv) : new Date(bv) - new Date(av); }
        if (state.sort.order === 'asc') return av.localeCompare(bv); return bv.localeCompare(av);
    });
    return data;
}

function renderSnapshots() {
    const data = filteredSnapshots();
    const c = $('snapshotsList');
    if (!data.length) { c.innerHTML = '<p class="empty">No snapshots.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="dataset">Dataset</th><th data-sort="name">Name</th><th data-sort="size_mb">Size (MB)</th><th data-sort="created_at">Created</th><th>Actions</th></tr></thead><tbody>';
    data.forEach(s => {
        html += `<tr>
                <td class="muted">${escapeHtml(s.dataset)}</td>
                <td class="muted">${escapeHtml(s.name)}</td>
                <td class="muted">${escapeHtml(s.size_mb)}</td>
                <td class="muted">${new Date(s.created_at).toLocaleString()}</td>
                <td class="actions">
                    <button data-roll="${escapeHtml(s.id)}">Rollback</button>
                    <button data-delete="${escapeHtml(s.id)}" class="secondary">Delete</button>
                </td>
            </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-roll]').forEach(b => b.addEventListener('click', () => rollbackSnapshot(b.dataset.roll)));
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deleteSnapshot(b.dataset.delete)));
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; state.sort.order = state.sort.col === col && state.sort.order === 'asc' ? 'desc' : 'asc'; state.sort.col = col; renderSnapshots(); }));
}

async function saveSnapshot(e) {
    e.preventDefault(); $('sError').textContent = '';
    const dataset = $('sDataset').value.trim(), name = $('sName').value.trim();
    if (!dataset || !name) { $('sError').textContent = 'Dataset and name are required'; return; }
    try { const d = await api('snapshots', 'POST', { dataset, name }); toast(t('created'), 'success'); if (d.warnings && d.warnings.length) toast(d.warnings[0], 'warning'); $('snapForm').reset(); loadSnapshots(); } catch (err) { $('sError').textContent = err.message; showError(err.message); }
}

async function deleteSnapshot(id) { if (!confirm('Delete snapshot?')) return; try { await api('snapshots', 'DELETE', { id }); toast(t('deleted'), 'success'); loadSnapshots(); } catch (e) { showError(e.message); } }

async function rollbackSnapshot(id) { const s = state.snapshots.find(x => x.id === id); if (!s) return; const dry = !confirm('This simulates rollback. Data loss may occur. Confirm?'); if (!s || !confirm('This simulates rollback. Data loss may occur. Confirm?')) return; try { const d = await api('rollback', 'POST', { snapshot_id: id, dataset: s.dataset }); toast(`${t('rolled')} ${d.status}`, 'success'); } catch (e) { showError(e.message); } }

async function doPrune(e) {
    e.preventDefault(); $('pError').textContent = ''; $('pruneResult').innerHTML = '';
    const age = parseInt($('pAge').value); const dry = $('pDry').checked;
    try { const d = await api('prune', 'POST', { age_days: age, dry_run: dry }); toast(`${t('pruned')} ${d.pruned} pruned, ${d.kept} kept`, 'success'); $('pruneResult').innerHTML = DOMPurify.sanitize(`<p class="message success">${d.dry_run ? 'Dry run' : 'Pruned'}: ${escapeHtml(d.pruned)} deleted, ${escapeHtml(d.kept)} kept</p>`); loadSnapshots(); loadHistory(); } catch (err) { $('pError').textContent = err.message; showError(err.message); }
}

async function loadSchedules() {
    try {
        const d = await api('prune_schedules'); const c = $('schedulesList'); const data = d.schedules || [];
        if (!data.length) { c.innerHTML = '<p class="empty">No schedules.</p>'; return; }
        let html = '<table><thead><tr><th>Cron</th><th>Age</th><th>Enabled</th><th>Actions</th></tr></thead><tbody>';
        data.forEach(s => html += `<tr><td class="muted">${escapeHtml(s.schedule)}</td><td class="muted">${escapeHtml(s.age_days)}</td><td class="muted">${s.enabled ? 'Yes' : 'No'}</td><td class="actions"><button data-delete="${escapeHtml(s.id)}" class="secondary">Delete</button></td></tr>`);
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deleteSchedule(b.dataset.delete)));
    } catch (e) { showError(e.message); }
}

async function addSchedule(e) { e.preventDefault(); try { await api('prune_schedules', 'POST', { schedule: $('schCron').value.trim(), age_days: parseInt($('schAge').value), enabled: $('schEnabled').checked }); toast('Schedule added', 'success'); $('scheduleForm').reset(); $('schEnabled').checked = true; loadSchedules(); } catch (err) { showError(err.message); } }
async function deleteSchedule(id) { if (!confirm('Delete schedule?')) return; try { await api('prune_schedules', 'DELETE', { id }); loadSchedules(); } catch (e) { showError(e.message); } }

async function loadHistory() {
    try {
        const d = await api('prune_history'); const c = $('historyList'); const data = d.history || [];
        if (!data.length) { c.innerHTML = '<p class="empty">No prune history.</p>'; return; }
        let html = '<table><thead><tr><th>Run</th><th>Age (days)</th><th>Pruned</th><th>Kept</th><th>Dry run</th><th>Time</th></tr></thead><tbody>';
        data.forEach(h => html += `<tr><td class="muted">${escapeHtml(h.run_id)}</td><td class="muted">${escapeHtml(h.age_days)}</td><td class="muted">${escapeHtml(h.pruned)}</td><td class="muted">${escapeHtml(h.kept)}</td><td class="muted">${h.dry_run ? 'Yes' : 'No'}</td><td class="muted">${new Date(h.ran_at).toLocaleString()}</td></tr>`);
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showError(e.message); }
}

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'prune') loadSchedules(); if (name === 'history') loadHistory(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('snapForm').addEventListener('submit', saveSnapshot); $('pruneForm').addEventListener('submit', doPrune); $('scheduleForm').addEventListener('submit', addSchedule); $('zSearch').addEventListener('input', renderSnapshots); $('zDataset').addEventListener('change', renderSnapshots); $('zPruneNow').addEventListener('click', () => switchTab('prune')); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('zfs-snapshot-manager', '/api/plugins/zfs-snapshot-manager/i18n'); await loadStatus(); await loadDatasets(); await loadSnapshots(); wireEvents(); })();
