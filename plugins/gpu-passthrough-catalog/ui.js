/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/gpu-passthrough-catalog/ui.js
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
const t = (k, p) => i18n ? i18n.getT('gpu-passthrough-catalog')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('gpu-passthrough-catalog', '/api/plugins/gpu-passthrough-catalog/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

let scanData = { devices: [] };

async function loadStatus() { try { const s = await api('status'); $('status').textContent = `${s.assignments_count} assignments`; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');[$('sCluster'), $('actCluster'), $('aFilterCluster')].forEach(el => { el.innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); }); } catch (e) { } }

async function scan() { $('sError').textContent = ''; const cluster = $('sCluster').value; if (!cluster) { $('sError').textContent = 'Select a cluster'; return; } try { const d = await api('scan?cluster_id=' + encodeURIComponent(cluster)); scanData = d; renderDevices(); updateNodeFilter(); } catch (err) { $('sError').textContent = err.message; showError(err.message); } }

function updateNodeFilter() { const nodes = [...new Set(scanData.devices.map(d => d.node))]; const opts = nodes.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join(''); $('sNode').innerHTML = DOMPurify.sanitize('<option value="">All</option>' + opts); }

function renderDevices() {
    const c = $('devicesList');
    const node = $('sNode').value, status = $('sStatus').value, q = $('sSearch').value.trim().toLowerCase();
    const filtered = scanData.devices.filter(d => {
        if (node && d.node !== node) return false;
        if (status && d.status !== status) return false;
        if (q && !((d.name || '').toLowerCase().includes(q) || (d.device_id || '').toLowerCase().includes(q))) return false;
        return true;
    });
    if (!filtered.length) { c.innerHTML = '<p class="empty">No matching GPUs.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="node">Node</th><th data-sort="name">Name</th><th>Device ID</th><th>Description</th><th data-sort="status">Status</th><th>VM</th><th>Slot</th><th>Actions</th></tr></thead><tbody>';
    filtered.forEach(d => { html += `<tr data-node="${escapeHtml(d.node)}" data-device="${escapeHtml(d.device_id)}"><td class="muted">${escapeHtml(d.node)}</td><td class="muted">${escapeHtml(d.name)}</td><td class="muted">${escapeHtml(d.device_id)}</td><td class="muted">${escapeHtml(d.description)}</td><td><span class="badge ${escapeHtml(d.status)}">${escapeHtml(d.status)}</span></td><td class="muted">${escapeHtml(d.vmid || '')}</td><td class="muted">${escapeHtml(d.slot || '')}</td><td class="actions"><button class="assignBtn">Assign</button><button class="detailBtn secondary">Details</button></td></tr>`; });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { sortDevices(th.dataset.sort); }));
    c.querySelectorAll('.assignBtn').forEach(b => b.addEventListener('click', () => { const tr = b.closest('tr'); $('actCluster').value = $('sCluster').value; $('actNode').value = tr.dataset.node; $('actDevice').value = tr.dataset.device; $('actAction').value = 'assign'; switchTab('action'); }));
    c.querySelectorAll('.detailBtn').forEach(b => b.addEventListener('click', () => { const tr = b.closest('tr'); toast(`Node: ${tr.dataset.node}, ID: ${tr.dataset.device}`); }));
}

function sortDevices(col) { scanData.devices.sort((a, b) => { const av = (a[col] || '').toLowerCase(), bv = (b[col] || '').toLowerCase(); return av > bv ? 1 : -1; }); renderDevices(); }

async function runAction() { $('actError').textContent = ''; const cluster = $('actCluster').value, node = $('actNode').value, vmid = $('actVmid').value.trim(), device = $('actDevice').value.trim(), action = $('actAction').value; if (!cluster || !vmid || !device) { $('actError').textContent = 'Cluster, VMID, and Device ID are required'; return; } try { const body = { cluster_id: cluster, node, vmid, device_id: device, pcie: $('optPcie').checked, 'x-vga': $('optXvga').checked, rombar: $('optRombar').checked, mdev: $('optMdev').value.trim() || null }; const res = await api(action, 'POST', body); $('actResult').innerHTML = DOMPurify.sanitize(`<p class="muted">${action === 'assign' ? 'Assigned' : 'Released'}: ${escapeHtml(device)} to VM ${vmid}</p>`); toast(t(action === 'assign' ? 'assigned' : 'released'), 'success'); scan(); loadAssignments(); } catch (err) { $('actError').textContent = err.message; showError(err.message); } }

async function loadAssignments() {
    $('aError').textContent = ''; const cluster = $('aFilterCluster').value, node = $('aFilterNode').value, vmid = $('aFilterVmid').value.trim(); const params = new URLSearchParams(); if (cluster) params.set('cluster_id', cluster); if (node) params.set('node', node); if (vmid) params.set('vmid', vmid); try {
        const d = await api('assignments?' + params.toString()); const c = $('assignmentsList');
        if (!d.assignments.length) { c.innerHTML = '<p class="empty">No assignments.</p>'; return; }
        let html = '<table><thead><tr><th>Cluster</th><th>Node</th><th>VMID</th><th>Device ID</th><th>Slot</th><th>Actions</th></tr></thead><tbody>';
        d.assignments.forEach(a => { html += `<tr data-cluster="${escapeHtml(a.cluster_id)}" data-node="${escapeHtml(a.node)}" data-device="${escapeHtml(a.device_id)}"><td class="muted">${escapeHtml(a.cluster_id)}</td><td class="muted">${escapeHtml(a.node)}</td><td class="muted">${escapeHtml(a.vmid)}</td><td class="muted">${escapeHtml(a.device_id)}</td><td class="muted">${escapeHtml(a.slot || '')}</td><td class="actions"><button class="relBtn secondary">Release</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('.relBtn').forEach(b => b.addEventListener('click', () => { const tr = b.closest('tr'); $('actCluster').value = tr.dataset.cluster; $('actNode').value = tr.dataset.node; $('actDevice').value = tr.dataset.device; $('actVmid').value = tr.querySelector('td:nth-child(3)').textContent; $('actAction').value = 'release'; switchTab('action'); }));
    } catch (err) { $('aError').textContent = err.message; showError(err.message); }
}

async function updateNodeAssignmentFilter() { try { const d = await api('assignments'); const nodes = [...new Set(d.assignments.map(a => a.node))]; const opts = nodes.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join(''); $('aFilterNode').innerHTML = DOMPurify.sanitize('<option value="">All</option>' + opts); } catch (e) { } }

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('sScan').addEventListener('click', scan); $('sNode').addEventListener('change', renderDevices); $('sStatus').addEventListener('change', renderDevices); $('sSearch').addEventListener('input', renderDevices); $('sReset').addEventListener('click', () => { $('sNode').value = ''; $('sStatus').value = ''; $('sSearch').value = ''; renderDevices(); }); $('actRun').addEventListener('click', runAction); $('aLoad').addEventListener('click', loadAssignments); $('aFilterCluster').addEventListener('change', loadAssignments); $('aFilterNode').addEventListener('change', loadAssignments); $('aFilterVmid').addEventListener('input', loadAssignments); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('gpu-passthrough-catalog', '/api/plugins/gpu-passthrough-catalog/i18n'); await loadStatus(); await loadClusters(); wireEvents(); await updateNodeAssignmentFilter(); })();
