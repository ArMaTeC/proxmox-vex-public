/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/cross-cluster-replication/ui.js
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
const t = (k, p) => i18n ? i18n.getT('cross-cluster-replication')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('cross-cluster-replication', '/api/plugins/cross-cluster-replication/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.active_jobs + ' active'; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');['cSource', 'cTarget', 'jSource', 'jTarget'].forEach(id => { const sel = $(id); const all = sel.options[0].outerHTML; sel.innerHTML = DOMPurify.sanitize(all + opts); }); } catch (e) { } }

async function loadJobs() {
    $('jError').textContent = ''; const src = $('jSource').value, tgt = $('jTarget').value, st = $('jStatus').value; try {
        const params = new URLSearchParams(); if (src) params.set('source', src); if (tgt) params.set('target', tgt); if (st) params.set('status', st); const d = await api('jobs?' + params.toString()); const c = $('jobsList');
        if (!d.jobs.length) { c.innerHTML = '<p class="empty">No jobs.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="source">Source</th><th data-sort="target">Target</th><th>VMs</th><th>Schedule</th><th data-sort="enabled">Status</th><th>Last Sync</th><th>Actions</th></tr></thead><tbody>';
        d.jobs.forEach(j => { html += `<tr data-id="${escapeHtml(j.job_id)}"><td class="muted">${escapeHtml(j.source)}</td><td class="muted">${escapeHtml(j.target)}</td><td class="muted">${(j.vms || []).map(v => escapeHtml(v)).join(', ')}</td><td class="muted">${escapeHtml(j.schedule || '-')}</td><td class="muted">${j.enabled ? 'Enabled' : 'Disabled'}</td><td class="muted">${j.last_sync ? new Date(j.last_sync).toLocaleString() : '-'}</td><td class="actions"><button class="syncBtn">Sync</button><button class="editBtn secondary">Edit</button><button class="deleteBtn secondary">Delete</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { sortJobs(th.dataset.sort); }));
        c.querySelectorAll('.syncBtn').forEach(b => b.addEventListener('click', () => syncJob(b.closest('tr').dataset.id)));
        c.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', () => editJob(b.closest('tr').dataset.id)));
        c.querySelectorAll('.deleteBtn').forEach(b => b.addEventListener('click', () => deleteJob(b.closest('tr').dataset.id)));
    } catch (err) { $('jError').textContent = err.message; showError(err.message); }
}

async function sortJobs(col) {
    const src = $('jSource').value, tgt = $('jTarget').value, st = $('jStatus').value; const params = new URLSearchParams(); if (src) params.set('source', src); if (tgt) params.set('target', tgt); if (st) params.set('status', st); params.set('sort', col); try {
        const d = await api('jobs?' + params.toString()); const c = $('jobsList');
        let html = '<table><thead><tr><th data-sort="source">Source</th><th data-sort="target">Target</th><th>VMs</th><th>Schedule</th><th data-sort="enabled">Status</th><th>Last Sync</th><th>Actions</th></tr></thead><tbody>';
        d.jobs.forEach(j => { html += `<tr data-id="${escapeHtml(j.job_id)}"><td class="muted">${escapeHtml(j.source)}</td><td class="muted">${escapeHtml(j.target)}</td><td class="muted">${(j.vms || []).map(v => escapeHtml(v)).join(', ')}</td><td class="muted">${escapeHtml(j.schedule || '-')}</td><td class="muted">${j.enabled ? 'Enabled' : 'Disabled'}</td><td class="muted">${j.last_sync ? new Date(j.last_sync).toLocaleString() : '-'}</td><td class="actions"><button class="syncBtn">Sync</button><button class="editBtn secondary">Edit</button><button class="deleteBtn secondary">Delete</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { sortJobs(th.dataset.sort); }));
        c.querySelectorAll('.syncBtn').forEach(b => b.addEventListener('click', () => syncJob(b.closest('tr').dataset.id)));
        c.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', () => editJob(b.closest('tr').dataset.id)));
        c.querySelectorAll('.deleteBtn').forEach(b => b.addEventListener('click', () => deleteJob(b.closest('tr').dataset.id)));
    } catch (err) { showError(err.message); }
}

async function saveJob() { $('cError').textContent = ''; const source = $('cSource').value, target = $('cTarget').value; if (!source || !target) { $('cError').textContent = 'Source and target required'; return; } if (source === target) { $('cError').textContent = 'Source and target must differ'; return; } const body = { job_id: $('cJobId').value, source, target, vms: $('cVms').value.split(',').map(s => s.trim()).filter(Boolean), schedule: $('cSchedule').value, enabled: $('cEnabled').checked }; try { const isEdit = !!body.job_id; const path = isEdit ? 'job-edit' : 'job'; const method = isEdit ? 'PUT' : 'POST'; const d = await api(path, method, body); toast(t('created'), 'success'); switchTab('jobs'); loadJobs(); resetCreate(); } catch (err) { $('cError').textContent = err.message; showError(err.message); } }

async function syncJob(id) { try { const d = await api('sync', 'POST', { job_id: id }); toast(t('synced'), 'success'); loadJobs(); } catch (err) { showError(err.message); } }

async function editJob(id) { try { const d = await api('jobs?' + new URLSearchParams().toString()); const j = d.jobs.find(x => x.job_id === id); if (!j) throw new Error('Job not found'); $('cJobId').value = j.job_id; $('cSource').value = j.source; $('cTarget').value = j.target; $('cVms').value = (j.vms || []).join(','); $('cSchedule').value = j.schedule || ''; $('cEnabled').checked = !!j.enabled; $('formTitle').textContent = 'Edit Job'; $('cSave').textContent = 'Update'; $('cCancel').hidden = false; switchTab('create'); } catch (err) { showError(err.message); } }

async function deleteJob(id) { if (!confirm('Delete job ' + id + '?')) return; try { await api('job-delete?job_id=' + encodeURIComponent(id), 'DELETE'); toast(t('deleted'), 'success'); loadJobs(); } catch (err) { showError(err.message); } }

async function loadDrift() {
    $('dError').textContent = ''; const job = $('dJob').value; const params = new URLSearchParams(); if (job) params.set('job_id', job); try {
        const d = await api('drift?' + params.toString()); const c = $('driftList');
        if (!d.drift_items.length) { c.innerHTML = '<p class="empty">No drift.</p>'; return; }
        let html = '<table><thead><tr><th>VM</th><th>Reason</th><th>Job</th><th>Actions</th></tr></thead><tbody>';
        d.drift_items.forEach(it => { html += `<tr data-did="${escapeHtml(it.drift_id)}"><td class="muted">${escapeHtml(it.vm || '')}</td><td class="muted">${escapeHtml(it.reason || '')}</td><td class="muted">${escapeHtml(it.job_id || '')}</td><td class="actions"><button class="resolveBtn">Resolve</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('.resolveBtn').forEach(b => b.addEventListener('click', () => resolveDrift(b.closest('tr').dataset.did)));
    } catch (err) { $('dError').textContent = err.message; showError(err.message); }
}

async function resolveDrift(did) { try { await api('drift-resolve', 'POST', { drift_id: did }); toast(t('resolved'), 'success'); loadDrift(); } catch (err) { showError(err.message); } }

function resetCreate() { $('cJobId').value = ''; $('cSource').value = ''; $('cTarget').value = ''; $('cVms').value = ''; $('cSchedule').value = '0 2 * * *'; $('cEnabled').checked = true; $('formTitle').textContent = 'Create Job'; $('cSave').textContent = 'Create'; $('cCancel').hidden = true; $('cError').textContent = ''; }
function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('jFilter').addEventListener('click', loadJobs); $('jReset').addEventListener('click', () => { $('jSource').value = ''; $('jTarget').value = ''; $('jStatus').value = ''; loadJobs(); }); $('cSave').addEventListener('click', saveJob); $('cCancel').addEventListener('click', () => { resetCreate(); switchTab('jobs'); }); $('dLoad').addEventListener('click', loadDrift); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('cross-cluster-replication', '/api/plugins/cross-cluster-replication/i18n'); await loadStatus(); await loadClusters(); wireEvents(); loadJobs(); loadDrift(); })();
