/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/dns-sync/ui.js
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
const t = (k, p) => i18n ? i18n.getT('dns-sync')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('dns-sync', '/api/plugins/dns-sync/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = `${s.zones_count} zones, ${s.records_count} records`; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join(''); $('sCluster').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }

function _zoneOptions(zones) { return '<option value="">Select</option>' + (zones || []).map(z => `<option value="${escapeHtml(z.id)}">${escapeHtml(z.name)}</option>`).join(''); }

async function loadZones() { try { const d = await api('zones'); const html = _zoneOptions(d.data); $('sZone').innerHTML = DOMPurify.sanitize(html); $('eZone').innerHTML = DOMPurify.sanitize(html); } catch (e) { } }

async function refreshZones() {
    $('zListError').textContent = ''; const type = $('zFilter').value; const params = new URLSearchParams(); if (type) params.set('type', type); try {
        const d = await api('zones?' + params.toString()); const c = $('zonesList');
        if (!d.data.length) { c.innerHTML = '<p class="empty">No zones.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="name">Name</th><th data-sort="type">Type</th><th>Records</th><th>Actions</th></tr></thead><tbody>';
        d.data.forEach(z => { html += `<tr data-id="${escapeHtml(z.id)}"><td class="muted">${escapeHtml(z.name)}</td><td class="muted">${escapeHtml(z.type)}</td><td class="muted">${(z.records || []).length}</td><td class="actions"><button class="viewBtn secondary">View</button><button class="editBtn secondary">Edit</button><button class="deleteBtn secondary">Delete</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { sortZones(th.dataset.sort); }));
        c.querySelectorAll('.viewBtn').forEach(b => b.addEventListener('click', () => { showRecords(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', () => { editZone(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.deleteBtn').forEach(b => b.addEventListener('click', () => { deleteZone(b.closest('tr').dataset.id); }));
    } catch (err) { $('zListError').textContent = err.message; showError(err.message); }
}

async function sortZones(col) {
    const type = $('zFilter').value; const params = new URLSearchParams(); params.set('sort', col); if (type) params.set('type', type); try {
        const d = await api('zones?' + params.toString()); const c = $('zonesList');
        let html = '<table><thead><tr><th data-sort="name">Name</th><th data-sort="type">Type</th><th>Records</th><th>Actions</th></tr></thead><tbody>';
        d.data.forEach(z => { html += `<tr data-id="${escapeHtml(z.id)}"><td class="muted">${escapeHtml(z.name)}</td><td class="muted">${escapeHtml(z.type)}</td><td class="muted">${(z.records || []).length}</td><td class="actions"><button class="viewBtn secondary">View</button><button class="editBtn secondary">Edit</button><button class="deleteBtn secondary">Delete</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { sortZones(th.dataset.sort); }));
        c.querySelectorAll('.viewBtn').forEach(b => b.addEventListener('click', () => { showRecords(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', () => { editZone(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.deleteBtn').forEach(b => b.addEventListener('click', () => { deleteZone(b.closest('tr').dataset.id); }));
    } catch (err) { showError(err.message); }
}

async function saveZone() { $('zError').textContent = ''; const name = $('zName').value.trim(), type = $('zType').value, editId = $('zEditId').value; const ptrTarget = type === 'reverse' ? $('zPtrTarget').value.trim() : ''; if (!name) { $('zError').textContent = 'Name required'; return; } try { const body = editId ? { id: editId, name, type, ptr_target: ptrTarget } : { name, type, ptr_target: ptrTarget }; const method = editId ? 'PUT' : 'POST'; const d = await api('zones', method, body); toast(t('created'), 'success'); resetZone(); refreshZones(); loadZones(); } catch (err) { $('zError').textContent = err.message; showError(err.message); } }

async function editZone(id) { try { const d = await api('zones'); const z = d.data.find(x => x.id === id); if (!z) throw new Error('Zone not found'); $('zEditId').value = z.id; $('zName').value = z.name; $('zType').value = z.type; $('zPtrTarget').value = z.ptr_target || ''; $('zPtrTargetLabel').hidden = z.type !== 'reverse'; $('zoneFormTitle').textContent = 'Edit Zone'; $('zSave').textContent = 'Update'; $('zCancel').hidden = false; } catch (err) { showError(err.message); } }

async function deleteZone(id) { if (!confirm('Delete this zone?')) return; try { await api('zones?id=' + encodeURIComponent(id), 'DELETE'); toast(t('deleted'), 'success'); refreshZones(); loadZones(); } catch (err) { showError(err.message); } }

function resetZone() { $('zEditId').value = ''; $('zName').value = ''; $('zType').value = 'forward'; $('zPtrTarget').value = ''; $('zPtrTargetLabel').hidden = true; $('zoneFormTitle').textContent = 'Add Zone'; $('zSave').textContent = 'Add'; $('zCancel').hidden = true; $('zError').textContent = ''; }

let lastPlan = null;

async function runSync() {
    $('sError').textContent = ''; const cluster = $('sCluster').value, zone = $('sZone').value; if (!cluster) { $('sError').textContent = 'Select a cluster'; return; } try {
        const d = await api('sync', 'POST', { cluster_id: cluster, zone_id: zone }); const plan = d.data; lastPlan = { zone_id: zone, plan }; const r = $('syncResult');
        let html = `<div class="grid"><div class="metric"><div class="value">${plan.vms_discovered}</div><div class="label">VMs</div></div><div class="metric"><div class="value">${(plan.records_to_add || []).length}</div><div class="label">Add</div></div><div class="metric"><div class="value">${(plan.records_to_remove || []).length}</div><div class="label">Remove</div></div></div>`;
        if (plan.records_to_add && plan.records_to_add.length) { html += '<h3>Records to add</h3><table><thead><tr><th>Name</th><th>Type</th><th>Value</th></tr></thead><tbody>'; plan.records_to_add.forEach(rec => { html += `<tr><td class="muted">${escapeHtml(rec.name)}</td><td class="muted">${rec.type}</td><td class="muted">${escapeHtml(rec.value)}</td></tr>`; }); html += '</tbody></table>'; }
        if (plan.records_to_remove && plan.records_to_remove.length) { html += '<h3>Records to remove</h3><table><thead><tr><th>Name</th><th>Type</th></tr></thead><tbody>'; plan.records_to_remove.forEach(rec => { html += `<tr><td class="muted">${escapeHtml(rec.name)}</td><td class="muted">${rec.type}</td></tr>`; }); html += '</tbody></table>'; }
        r.innerHTML = DOMPurify.sanitize(html);
        $('sApply').disabled = !zone;
    } catch (err) { $('sError').textContent = err.message; showError(err.message); }
}

async function applySync() { if (!lastPlan || !lastPlan.zone_id) { showError('No plan to apply'); return; } $('sError').textContent = ''; try { const d = await api('apply', 'POST', lastPlan); toast(t('applied'), 'success'); $('sApply').disabled = true; refreshZones(); showRecords(lastPlan.zone_id); } catch (err) { $('sError').textContent = err.message; showError(err.message); } }

async function showRecords(zoneId) {
    try {
        const params = new URLSearchParams(); if (zoneId) params.set('zone_id', zoneId); const d = await api('records?' + params.toString()); const c = $('recordsList');
        if (!d.data.length) { c.innerHTML = '<p class="empty">No records.</p>'; return; }
        let html = '<table><thead><tr><th>Zone</th><th>Name</th><th>Type</th><th>Value</th><th>Actions</th></tr></thead><tbody>';
        d.data.forEach(r => { html += `<tr data-id="${escapeHtml(r.id)}"><td class="muted">${escapeHtml(r.zone_name || '')}</td><td class="muted">${escapeHtml(r.name)}</td><td class="muted">${escapeHtml(r.type)}</td><td class="muted">${escapeHtml(r.value)}</td><td class="actions"><button class="recDeleteBtn secondary">Delete</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('.recDeleteBtn').forEach(b => b.addEventListener('click', () => { deleteRecord(b.closest('tr').dataset.id); }));
        switchTab('records');
    } catch (err) { showError(err.message); }
}

async function deleteRecord(id) { if (!confirm('Delete this record?')) return; try { await api('records?id=' + encodeURIComponent(id), 'DELETE'); toast(t('deleted'), 'success'); showRecords(); } catch (err) { showError(err.message); } }

let lastExport = null;

async function runExport() { $('eError').textContent = ''; const zone = $('eZone').value, fmt = $('eFormat').value; if (!zone) { $('eError').textContent = 'Select a zone'; return; } try { const d = await api(`export?zone_id=${encodeURIComponent(zone)}&format=${encodeURIComponent(fmt)}`); lastExport = d; const c = $('eOutput'); c.textContent = d.content; c.hidden = false; $('eDownload').disabled = false; $('eCopy').disabled = false; } catch (err) { $('eError').textContent = err.message; showError(err.message); $('eOutput').hidden = true; $('eDownload').disabled = true; $('eCopy').disabled = true; } }

function downloadExport() { if (!lastExport) return; const blob = new Blob([lastExport.content], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = lastExport.filename || 'zone.txt'; a.click(); URL.revokeObjectURL(a.href); toast('Downloaded'); }

async function copyExport() { if (!lastExport) return; try { await navigator.clipboard.writeText(lastExport.content); toast('Copied'); } catch (err) { showError(err.message); } }

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('zSave').addEventListener('click', saveZone); $('zCancel').addEventListener('click', resetZone); $('zLoad').addEventListener('click', refreshZones); $('zFilter').addEventListener('change', refreshZones); $('sRun').addEventListener('click', runSync); $('sApply').addEventListener('click', applySync); $('zType').addEventListener('change', () => { $('zPtrTargetLabel').hidden = $('zType').value !== 'reverse'; }); $('eRun').addEventListener('click', runExport); $('eDownload').addEventListener('click', downloadExport); $('eCopy').addEventListener('click', copyExport); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('dns-sync', '/api/plugins/dns-sync/i18n'); await loadStatus(); await loadClusters(); await loadZones(); wireEvents(); refreshZones(); })();
