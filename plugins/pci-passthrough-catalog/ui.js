/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/pci-passthrough-catalog/ui.js
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
const t = (k, p) => i18n ? i18n.getT('pci-passthrough-catalog')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('pci-passthrough-catalog', '/api/plugins/pci-passthrough-catalog/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('sTotal').textContent = s.total_devices; $('sAssigned').textContent = s.assigned_devices; $('status').textContent = 'Ready'; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${c.id}">${c.name}</option>`).join(''); $('dCluster').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }

let lastDevices = [];

async function scanDevices() { $('dError').textContent = ''; const cluster = $('dCluster').value, search = $('dSearch').value.trim(), node = $('dNode').value; if (!cluster) { $('dError').textContent = 'Select a cluster'; return; } const params = new URLSearchParams(); params.set('cluster_id', cluster); if (search) params.set('q', search); if (node) params.set('node', node); try { const d = await api('scan?' + params.toString()); lastDevices = d.devices || []; renderDevices(d.devices); updateNodeSelect(d.devices); } catch (err) { $('dError').textContent = err.message; showError(err.message); } }

function updateNodeSelect(devices) { const nodes = [...new Set(devices.map(d => d.node).filter(Boolean))]; const opts = nodes.map(n => `<option value="${n}">${n}</option>`).join(''); $('dNode').innerHTML = DOMPurify.sanitize('<option value="">All</option>' + opts); $('aNode').innerHTML = DOMPurify.sanitize('<option value="">All</option>' + opts); }

function renderDevices(devices) {
    const c = $('dList');
    if (!devices.length) { c.innerHTML = '<p class="empty">No devices found.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="device_id">Device ID</th><th data-sort="name">Name</th><th data-sort="node">Node</th><th>Description</th><th>Actions</th></tr></thead><tbody>';
    devices.forEach(d => { const warn = !d.iommugroup; html += `<tr data-device="${escapeHtml(d.device_id)}" data-node="${escapeHtml(d.node)}"><td class="muted">${escapeHtml(d.device_id)}</td><td class="muted">${escapeHtml(d.name)} ${warn ? '<span class="warning">(no IOMMU)</span>' : ''}</td><td class="muted">${escapeHtml(d.node)}</td><td class="muted">${escapeHtml(d.description)}</td><td class="actions"><button class="viewBtn secondary">View</button><input type="text" class="vmidInput" placeholder="VMID" size="6" /><button class="assignBtn">Assign</button><button class="releaseBtn secondary">Release</button></td></tr>`; });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const sorted = [...devices].sort((a, b) => { const av = (a[th.dataset.sort] || '').toString(), bv = (b[th.dataset.sort] || '').toString(); return av.localeCompare(bv); }); renderDevices(sorted); }));
    c.querySelectorAll('.viewBtn').forEach(b => b.addEventListener('click', () => { showDetail(b.closest('tr').dataset); }));
    c.querySelectorAll('.assignBtn').forEach(b => b.addEventListener('click', () => { const row = b.closest('tr'); const vmid = row.querySelector('.vmidInput').value; if (!vmid) { showError('VMID required'); return; } assignDevice(row.dataset.device, row.dataset.node, vmid); }));
    c.querySelectorAll('.releaseBtn').forEach(b => b.addEventListener('click', () => { const row = b.closest('tr'); const vmid = row.querySelector('.vmidInput').value; if (!vmid) { showError('VMID required'); return; } releaseDevice(row.dataset.device, row.dataset.node, vmid); }));
}

async function showDetail(ds) { const d = lastDevices.find(x => x.device_id === ds.device && x.node === ds.node); if (!d) return; $('dDetail').innerHTML = DOMPurify.sanitize(`<p class="muted"><strong>Device ID:</strong> ${escapeHtml(d.device_id)}<br><strong>Name:</strong> ${escapeHtml(d.name)}<br><strong>Node:</strong> ${escapeHtml(d.node)}<br><strong>Description:</strong> ${escapeHtml(d.description)}<br><strong>Driver:</strong> ${escapeHtml(d.driver)}<br><strong>IOMMU Group:</strong> ${d.iommugroup !== undefined ? d.iommugroup : t('warning')}<br><strong>Type:</strong> ${escapeHtml(d.type)}</p>`); $('detailPanel').hidden = false; }

async function assignDevice(device_id, node, vmid) { try { await api('assign', 'POST', { device_id, node, vmid }); toast(t('assigned')); await loadStatus(); } catch (err) { showError(err.message); } }

async function releaseDevice(device_id, node, vmid) { try { await api('release', 'POST', { device_id, node, vmid }); toast(t('released'), 'warning'); await loadStatus(); } catch (err) { showError(err.message); } }

async function loadAssignments() {
    try {
        const node = $('aNode').value, vmid = $('aVmid').value.trim(); const params = new URLSearchParams(); if (node) params.set('node', node); if (vmid) params.set('vmid', vmid); const d = await api('assignments?' + params.toString()); const c = $('aList');
        if (!d.assignments.length) { c.innerHTML = '<p class="empty">No assignments.</p>'; return; }
        let html = '<table><thead><tr><th>VMID</th><th>Device</th><th>Node</th><th>Actions</th></tr></thead><tbody>';
        d.assignments.forEach(a => { html += `<tr><td class="muted">${escapeHtml(a.vmid)}</td><td class="muted">${escapeHtml(a.device_id)}</td><td class="muted">${escapeHtml(a.node)}</td><td><button class="relBtn secondary" data-device="${escapeHtml(a.device_id)}" data-node="${escapeHtml(a.node)}" data-vmid="${escapeHtml(a.vmid)}">Release</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('.relBtn').forEach(b => b.addEventListener('click', () => { releaseDevice(b.dataset.device, b.dataset.node, b.dataset.vmid); }));
    } catch (err) { showError(err.message); }
}

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { switchTab(t.dataset.tab); if (t.dataset.tab === 'assignments') loadAssignments(); })); $('dScan').addEventListener('click', scanDevices); $('dSearch').addEventListener('input', scanDevices); $('dNode').addEventListener('change', scanDevices); $('aLoad').addEventListener('click', loadAssignments); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('pci-passthrough-catalog', '/api/plugins/pci-passthrough-catalog/i18n'); await loadStatus(); await loadClusters(); wireEvents(); })();
