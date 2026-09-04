/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/pbs-manager/ui.js
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
const t = (k, p) => i18n ? i18n.getT('pbs-manager')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('pbs-manager', '/api/plugins/pbs-manager/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = `${s.jobs_count} jobs`; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${c.id}">${c.name}</option>`).join(''); $('dCluster').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }

async function loadDatastores() {
    $('dError').textContent = ''; const cluster = $('dCluster').value, type = $('dFilterType').value; if (!cluster) { $('dError').textContent = 'Select a cluster'; return; } const params = new URLSearchParams(); params.set('cluster_id', cluster); if (type) params.set('type', type); try {
        const d = await api('datastores?' + params.toString()); const c = $('dList');
        if (!d.datastores.length) { c.innerHTML = '<p class="empty">No datastores.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="name">Name</th><th data-sort="type">Type</th><th data-sort="content">Content</th><th>Usage</th><th>Actions</th></tr></thead><tbody>';
        d.datastores.forEach(ds => { const pct = ds.capacity ? Math.round((ds.used / ds.capacity) * 100) : 0; html += `<tr data-name="${escapeHtml(ds.name)}"><td class="muted">${escapeHtml(ds.name)}</td><td class="muted">${escapeHtml(ds.type)}</td><td class="muted">${escapeHtml(ds.content)}</td><td class="muted">${pct}% <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div></td><td class="actions"><button class="viewBtn secondary">View</button><button class="jobsBtn secondary">Jobs</button><button class="verifyBtn secondary">Verify</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const params = new URLSearchParams(); params.set('cluster_id', cluster); params.set('type', type); params.set('sort', th.dataset.sort); api('datastores?' + params.toString()).then(loadDatastores); }));
        c.querySelectorAll('.viewBtn').forEach(b => b.addEventListener('click', () => { showDetail(b.closest('tr').dataset.name, cluster); }));
        c.querySelectorAll('.jobsBtn').forEach(b => b.addEventListener('click', () => { $('jDatastore').value = b.closest('tr').dataset.name; switchTab('jobs'); loadJobs(); }));
        c.querySelectorAll('.verifyBtn').forEach(b => b.addEventListener('click', () => { $('vDatastore').value = b.closest('tr').dataset.name; runVerify(); }));
        updateJobDatastoreOptions(d.datastores);
    } catch (err) { $('dError').textContent = err.message; showError(err.message); }
}

async function showDetail(name, cluster) { try { const params = new URLSearchParams(); params.set('name', name); if (cluster) params.set('cluster_id', cluster); const ds = await api('datastore?' + params.toString()); const used = ds.used || 0, cap = ds.capacity || 0, pct = cap ? Math.round(used / cap * 100) : 0; $('dDetail').innerHTML = DOMPurify.sanitize(`<p class="muted"><strong>Name:</strong> ${escapeHtml(ds.name)}<br><strong>Type:</strong> ${escapeHtml(ds.type)}<br><strong>Content:</strong> ${escapeHtml(ds.content)}<br><strong>Capacity:</strong> ${cap} ${ds.unit}<br><strong>Used:</strong> ${used} ${ds.unit} (${pct}%)<br><div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div></p>`); $('detailPanel').hidden = false; } catch (err) { showError(err.message); } }

function updateJobDatastoreOptions(datastores) { const opts = datastores.map(ds => `<option value="${escapeHtml(ds.name)}">${escapeHtml(ds.name)}</option>`).join(''); $('jDatastore').innerHTML = DOMPurify.sanitize(opts); $('jFilterDs').innerHTML = DOMPurify.sanitize('<option value="">All</option>' + opts); }

async function saveJob() { $('jError').textContent = ''; const id = $('jId').value, datastore = $('jDatastore').value, schedule = $('jSchedule').value.trim(), scope = $('jScope').value.split(',').map(s => s.trim()).filter(Boolean), retention = parseInt($('jRetention').value); if (!datastore || !schedule) { $('jError').textContent = 'Datastore and schedule required'; return; } try { await api('jobs', 'POST', { id, datastore, schedule, scope, retention }); toast(t('saved')); $('jId').value = ''; $('jSchedule').value = ''; $('jScope').value = ''; loadJobs(); } catch (err) { $('jError').textContent = err.message; showError(err.message); } }

async function loadJobs() {
    try {
        const ds = $('jFilterDs').value; const params = new URLSearchParams(); if (ds) params.set('datastore', ds); const d = await api('jobs?' + params.toString()); const c = $('jList');
        if (!d.jobs.length) { c.innerHTML = '<p class="empty">No jobs.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="datastore">Datastore</th><th data-sort="schedule">Schedule</th><th>Scope</th><th>Retention</th><th>Actions</th></tr></thead><tbody>';
        d.jobs.forEach(j => { html += `<tr data-id="${escapeHtml(j.id)}"><td class="muted">${escapeHtml(j.datastore)}</td><td class="muted">${escapeHtml(j.schedule)}</td><td class="muted">${(j.scope || []).join(', ')}</td><td class="muted">${j.retention || 7}</td><td class="actions"><button class="editBtn secondary">Edit</button><button class="runBtn secondary">Run</button><button class="delBtn secondary">Delete</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const params = new URLSearchParams(); if (ds) params.set('datastore', ds); params.set('sort', th.dataset.sort); api('jobs?' + params.toString()).then(loadJobs); }));
        c.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', () => { const row = b.closest('tr'); const j = d.jobs.find(x => x.id === row.dataset.id); if (!j) return; $('jId').value = j.id; $('jDatastore').value = j.datastore; $('jSchedule').value = j.schedule; $('jScope').value = (j.scope || []).join(','); $('jRetention').value = j.retention || 7; }));
        c.querySelectorAll('.runBtn').forEach(b => b.addEventListener('click', () => { runJob(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.delBtn').forEach(b => b.addEventListener('click', () => { deleteJob(b.closest('tr').dataset.id); }));
    } catch (err) { showError(err.message); }
}

async function runJob(id) { try { await api('run', 'POST', { id }); toast(t('run')); } catch (err) { showError(err.message); } }

async function deleteJob(id) { if (!confirm('Delete job?')) return; try { await api('jobs', 'DELETE', { id }); toast(t('deleted')); loadJobs(); } catch (err) { showError(err.message); } }

async function runVerify() { $('vError').textContent = ''; const datastore = $('vDatastore').value.trim(); if (!datastore) { $('vError').textContent = 'Datastore required'; return; } try { const r = await api('verify', 'POST', { datastore }); $('vResult').textContent = `Job ${r.job_id} for ${r.datastore} started at ${r.started_at}`; toast(t('verified')); } catch (err) { $('vError').textContent = err.message; showError(err.message); } }

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('dLoad').addEventListener('click', loadDatastores); $('dFilterType').addEventListener('change', loadDatastores); $('jSave').addEventListener('click', saveJob); $('jLoad').addEventListener('click', loadJobs); $('jFilterDs').addEventListener('change', loadJobs); $('vRun').addEventListener('click', runVerify); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('pbs-manager', '/api/plugins/pbs-manager/i18n'); await loadStatus(); await loadClusters(); wireEvents(); })();
