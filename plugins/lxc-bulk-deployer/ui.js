/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/lxc-bulk-deployer/ui.js
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
const t = (k, p) => i18n ? i18n.getT('lxc-bulk-deployer')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('lxc-bulk-deployer', '/api/plugins/lxc-bulk-deployer/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function badgeClass(s) { return s === 'queued' ? 'queued' : s === 'running' ? 'running' : s === 'cancelled' ? 'cancelled' : s === 'completed' ? 'completed' : 'muted'; }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = `${s.jobs_count} jobs (${s.queued} queued, ${s.running} running)`; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join(''); $('dCluster').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }

async function loadSpecs() {
    try {
        const d = await api('specs'); const opts = (d.data || []).map(sp => `<option value="${escapeHtml(sp.id)}">${escapeHtml(sp.name)}</option>`).join(''); $('dSpec').innerHTML = DOMPurify.sanitize('<option value="">Manual</option>' + opts); const c = $('specsList');
        if (!d.data.length) { c.innerHTML = '<p class="empty">No specs.</p>'; return; }
        let html = '<table><thead><tr><th>Name</th><th>Source</th><th>Count</th><th>Prefix</th><th>Memory</th><th>Cores</th><th>Actions</th></tr></thead><tbody>';
        d.data.forEach(sp => { html += `<tr data-id="${escapeHtml(sp.id)}"><td class="muted">${escapeHtml(sp.name)}</td><td class="muted">${escapeHtml(sp.source)}</td><td class="muted">${escapeHtml(sp.count)}</td><td class="muted">${escapeHtml(sp.naming_prefix)}</td><td class="muted">${escapeHtml(sp.memory)}</td><td class="muted">${escapeHtml(sp.cores)}</td><td class="actions"><button class="useBtn">Use</button><button class="delSpecBtn secondary">Delete</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('.useBtn').forEach(b => b.addEventListener('click', () => { useSpec(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.delSpecBtn').forEach(b => b.addEventListener('click', () => { deleteSpec(b.closest('tr').dataset.id); }));
    } catch (err) { showError(err.message); }
}

function useSpec(id) { api('specs').then(d => { const sp = (d.data || []).find(x => x.id === id); if (!sp) return; $('dSpec').value = id; $('dSource').value = sp.source; $('dCount').value = sp.count; $('dPrefix').value = sp.naming_prefix; $('dStart').value = sp.start_index; switchTab('deploy'); }); }

async function queueDeploy() { $('dError').textContent = ''; const cluster = $('dCluster').value, source = $('dSource').value.trim(), count = $('dCount').value, prefix = $('dPrefix').value, start = $('dStart').value; if (!cluster || !source) { $('dError').textContent = 'Cluster and source required'; return; } try { const body = { cluster_id: cluster, source, count: parseInt(count), naming_prefix: prefix, start_index: parseInt(start) }; const d = await api('deploy', 'POST', body); const j = d.job; $('dResult').innerHTML = DOMPurify.sanitize(`<p class="muted">Queued ${escapeHtml(j.job_id)} for cluster ${escapeHtml(j.cluster_id)} (${escapeHtml(j.count)} containers)</p>`); toast(t('queued'), 'success'); loadJobs(); loadStatus(); } catch (err) { $('dError').textContent = err.message; showError(err.message); } }

async function loadJobs() {
    $('jError').textContent = ''; const status = $('jStatus').value, sort = $('jSort').value; const params = new URLSearchParams(); if (status) params.set('status', status); params.set('sort', sort); try {
        const d = await api('jobs?' + params.toString()); const c = $('jobsList');
        if (!d.jobs.length) { c.innerHTML = '<p class="empty">No jobs.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="job_id">Job ID</th><th>Cluster</th><th>Source</th><th>Count</th><th data-sort="status">Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>';
        d.jobs.forEach(j => { html += `<tr data-id="${escapeHtml(j.job_id)}"><td class="muted">${escapeHtml(j.job_id)}</td><td class="muted">${escapeHtml(j.cluster_id)}</td><td class="muted">${escapeHtml(j.source)}</td><td class="muted">${escapeHtml(j.count)}</td><td><span class="badge ${badgeClass(j.status)}">${escapeHtml(j.status)}</span></td><td class="muted">${new Date(j.created).toLocaleString()}</td><td class="actions"><button class="viewBtn secondary">View</button><button class="cancelBtn secondary" ${j.status === 'completed' ? 'disabled' : ''}>Cancel</button><button class="delJobBtn secondary">Delete</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { $('jSort').value = th.dataset.sort; loadJobs(); }));
        c.querySelectorAll('.viewBtn').forEach(b => b.addEventListener('click', () => { viewJob(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.cancelBtn').forEach(b => b.addEventListener('click', () => { jobAction(b.closest('tr').dataset.id, 'cancel'); }));
        c.querySelectorAll('.delJobBtn').forEach(b => b.addEventListener('click', () => { jobAction(b.closest('tr').dataset.id, 'delete'); }));
    } catch (err) { $('jError').textContent = err.message; showError(err.message); }
}

async function viewJob(id) { try { const d = await api('jobs'); const j = (d.jobs || []).find(x => x.job_id === id); if (!j) throw new Error('Job not found'); const c = $('jobsList'); const items = (j.containers || []).map(ct => `<tr><td class="muted">${escapeHtml(ct.vmid)}</td><td class="muted">${escapeHtml(ct.name)}</td><td class="muted">${escapeHtml(ct.status)}</td></tr>`).join(''); c.innerHTML = DOMPurify.sanitize(`<p class="muted">Job: ${escapeHtml(j.job_id)}</p><table><thead><tr><th>VMID</th><th>Name</th><th>Status</th></tr></thead><tbody>${items}</tbody></table><button class="backBtn secondary">Back</button>`); c.querySelector('.backBtn').addEventListener('click', loadJobs); } catch (err) { showError(err.message); } }

async function jobAction(id, action) { if (action === 'delete' && !confirm('Delete job?')) return; try { await api('job', 'POST', { job_id: id, action }); if (action === 'cancel') toast(t('cancelled'), 'success'); loadJobs(); loadStatus(); } catch (err) { showError(err.message); } }

async function saveSpec() { $('sError').textContent = ''; const name = $('sName').value.trim(); if (!name) { $('sError').textContent = 'Name required'; return; } try { const body = { name, source: $('sSource').value.trim(), count: parseInt($('sCount').value), naming_prefix: $('sPrefix').value, start_index: parseInt($('sStart').value), memory: parseInt($('sMem').value), cores: parseInt($('sCores').value) }; await api('specs', 'POST', body); toast(t('saved'), 'success'); loadSpecs(); } catch (err) { $('sError').textContent = err.message; showError(err.message); } }

async function deleteSpec(id) { if (!confirm('Delete spec?')) return; try { await api('specs?id=' + encodeURIComponent(id), 'DELETE'); toast(t('deleted'), 'success'); loadSpecs(); } catch (err) { showError(err.message); } }

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('dQueue').addEventListener('click', queueDeploy); $('jLoad').addEventListener('click', loadJobs); $('jStatus').addEventListener('change', loadJobs); $('jSort').addEventListener('change', loadJobs); $('sSave').addEventListener('click', saveSpec); $('dSpec').addEventListener('change', () => { const id = $('dSpec').value; if (id) useSpec(id); }); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('lxc-bulk-deployer', '/api/plugins/lxc-bulk-deployer/i18n'); await loadStatus(); await loadClusters(); await loadSpecs(); wireEvents(); await loadJobs(); })();
