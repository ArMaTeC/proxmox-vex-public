/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/proxmox-ha/ui.js
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
const t = (k, p) => i18n ? i18n.getT('proxmox-ha')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('proxmox-ha', '/api/plugins/proxmox-ha/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = 'Ready'; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join(''); $('rCluster').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); $('aCluster').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }

let lastResources = [];

async function loadResources() { $('rError').textContent = ''; const cluster = $('rCluster').value, state = $('rState').value, search = $('rSearch').value.trim().toLowerCase(); if (!cluster) { $('rError').textContent = 'Select a cluster'; return; } const params = new URLSearchParams(); params.set('cluster_id', cluster); try { const d = await api('ha?' + params.toString()); let res = (d.data || []); if (state) res = res.filter(r => (r.state || '').toLowerCase() === state); if (search) res = res.filter(r => (r.sid || '').toLowerCase().includes(search)); lastResources = res; renderResources(res); updateStatus(res); } catch (err) { $('rError').textContent = err.message; showError(err.message); } }

function updateStatus(res) { $('sTotal').textContent = res.length; $('sStarted').textContent = res.filter(r => (r.state || '').toLowerCase() === 'started').length; }

function renderResources(resources) {
    const c = $('rList');
    if (!resources.length) { c.innerHTML = '<p class="empty">No resources found.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="sid">SID</th><th data-sort="state">State</th><th data-sort="max_restart">Max Restart</th><th data-sort="max_relocate">Max Relocate</th><th>Actions</th></tr></thead><tbody>';
    resources.forEach(r => { html += `<tr data-sid="${escapeHtml(r.sid)}"><td class="muted">${escapeHtml(r.sid)}</td><td class="muted">${escapeHtml(r.state)}</td><td class="muted">${escapeHtml(String(r.max_restart || ''))}</td><td class="muted">${escapeHtml(String(r.max_relocate || ''))}</td><td class="actions"><button class="editBtn secondary">Edit</button><button class="delBtn danger">Delete</button></td></tr>`; });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const sorted = [...resources].sort((a, b) => { const av = (a[th.dataset.sort] || '').toString(), bv = (b[th.dataset.sort] || '').toString(); return av.localeCompare(bv); }); renderResources(sorted); }));
    c.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', () => { const r = resources.find(x => x.sid === b.closest('tr').dataset.sid); if (!r) return; $('aCluster').value = $('rCluster').value; $('aSid').value = r.sid; $('aState').value = r.state; $('aRestart').value = r.max_restart || 1; $('aRelocate').value = r.max_relocate || 1; switchTab('add'); }));
    c.querySelectorAll('.delBtn').forEach(b => b.addEventListener('click', () => { const sid = b.closest('tr').dataset.sid; if (!confirm('Delete ' + sid + '?')) return; deleteResource(sid); }));
}

async function saveResource() { $('aError').textContent = ''; const cluster = $('aCluster').value, sid = $('aSid').value.trim(), state = $('aState').value, max_restart = parseInt($('aRestart').value), max_relocate = parseInt($('aRelocate').value); if (!cluster) { $('aError').textContent = 'Select a cluster'; return; } if (!/^\w+:\d+$/.test(sid)) { $('aError').textContent = 'SID must be vm:<id> or ct:<id>'; return; } if (isNaN(max_restart) || max_restart < 0 || isNaN(max_relocate) || max_relocate < 0) { $('aError').textContent = 'Max restart/relocate must be non-negative'; return; } try { const existing = lastResources.find(x => x.sid === sid); const method = existing ? 'PUT' : 'POST'; const r = await api('ha', method, { cluster_id: cluster, sid, state, max_restart, max_relocate }); $('aResult').textContent = r.message || 'Saved'; toast(t('saved')); if (method === 'PUT') { const existing = lastResources.find(x => x.sid === sid); if (existing) { Object.assign(existing, { sid, state, max_restart, max_relocate }); renderResources(lastResources); } } } catch (err) { $('aError').textContent = err.message; showError(err.message); } }

async function deleteResource(sid) { const cluster = $('rCluster').value; if (!cluster) return; try { await api('ha', 'DELETE', null, { cluster_id: cluster, sid }); const idx = lastResources.findIndex(r => r.sid === sid); if (idx >= 0) lastResources.splice(idx, 1); renderResources(lastResources); updateStatus(lastResources); toast(t('deleted')); } catch (err) { showError(err.message); } }

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'resources') loadResources(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('rLoad').addEventListener('click', loadResources); $('rState').addEventListener('change', loadResources); $('rSearch').addEventListener('input', loadResources); $('aSave').addEventListener('click', saveResource); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('proxmox-ha', '/api/plugins/proxmox-ha/i18n'); await loadStatus(); await loadClusters(); wireEvents(); })();
