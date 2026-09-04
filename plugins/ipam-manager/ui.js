/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/ipam-manager/ui.js
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
const t = (k, p) => i18n ? i18n.getT('ipam-manager')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('ipam-manager', '/api/plugins/ipam-manager/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = `${s.subnets_count} subnets, ${s.reservations_count} IPs`; } catch (e) { $('status').textContent = 'Error'; } }

async function loadSubnets(populate = false) {
    $('subListError').textContent = ''; const family = $('subFamily').value, sort = $('subSort').value, order = $('subOrder').value; const params = new URLSearchParams(); if (family) params.set('family', family); if (sort) params.set('sort', sort); if (order) params.set('order', order); try {
        const d = await api('subnets?' + params.toString()); const c = $('subnetsList');
        const opts = (d.data || []).map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.cidr)})</option>`).join('');[$('resSub'), $('resFilter'), $('detSub')].forEach(el => { el.innerHTML = DOMPurify.sanitize((el.id === 'resFilter' ? '<option value="">All</option>' : '<option value="">Select</option>') + opts); });
        if (!d.data.length) { c.innerHTML = '<p class="empty">No subnets.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="name">Name</th><th data-sort="cidr">CIDR</th><th>Gateway</th><th>Utilization</th><th>Actions</th></tr></thead><tbody>';
        d.data.forEach(s => { const u = s.utilization || {}; html += `<tr data-id="${escapeHtml(s.id)}"><td class="muted">${escapeHtml(s.name)}</td><td class="muted">${escapeHtml(s.cidr)}</td><td class="muted">${escapeHtml(s.gateway)}</td><td class="muted">${escapeHtml(u.used)}/${escapeHtml(u.total)} (${escapeHtml(u.pct)}%)</td><td class="actions"><button class="editBtn secondary">Edit</button><button class="viewBtn secondary">View</button><button class="delBtn secondary">Delete</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { $('subSort').value = th.dataset.sort; loadSubnets(); }));
        c.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', () => { editSubnet(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.viewBtn').forEach(b => b.addEventListener('click', () => { $('detSub').value = b.closest('tr').dataset.id; switchTab('detail'); loadDetail(); }));
        c.querySelectorAll('.delBtn').forEach(b => b.addEventListener('click', () => { deleteSubnet(b.closest('tr').dataset.id); }));
    } catch (err) { $('subListError').textContent = err.message; showError(err.message); }
}

async function saveSubnet() { $('subError').textContent = ''; const name = $('subName').value.trim(), cidr = $('subCidr').value.trim(), gateway = $('subGateway').value.trim(); const id = $('subId').value; if (!name || !cidr) { $('subError').textContent = 'Name and CIDR required'; return; } try { const body = { name, cidr, gateway }; const method = id ? 'PUT' : 'POST'; if (id) body.id = id; const d = await api('subnets', method, body); toast(t('saved'), 'success'); resetSubnet(); loadSubnets(); } catch (err) { $('subError').textContent = err.message; showError(err.message); } }

async function editSubnet(id) { try { const d = await api('subnets?id=' + encodeURIComponent(id)); const s = d.data; $('subId').value = s.id; $('subName').value = s.name; $('subCidr').value = s.cidr; $('subGateway').value = s.gateway; $('subTitle').textContent = 'Edit Subnet'; $('subCancel').hidden = false; switchTab('subnets'); } catch (err) { showError(err.message); } }

async function deleteSubnet(id) { if (!confirm('Delete subnet?')) return; try { await api('subnets?id=' + encodeURIComponent(id), 'DELETE'); toast(t('deleted'), 'success'); loadSubnets(); } catch (err) { showError(err.message); } }

function resetSubnet() { $('subId').value = ''; $('subName').value = ''; $('subCidr').value = ''; $('subGateway').value = ''; $('subTitle').textContent = 'Add Subnet'; $('subCancel').hidden = true; $('subError').textContent = ''; }

async function reserveIp() { $('resError').textContent = ''; const subnet = $('resSub').value, ip = $('resIp').value.trim(), label = $('resLabel').value.trim(), mac = $('resMac').value.trim(); if (!subnet) { $('resError').textContent = 'Select a subnet'; return; } try { const body = { action: 'reserve', subnet_id: subnet, ip: ip || undefined, label, mac }; const d = await api('ips', 'POST', body); toast(t('reserved'), 'success'); $('resIp').value = ''; $('resLabel').value = ''; $('resMac').value = ''; loadReservations(); loadSubnets(); } catch (err) { $('resError').textContent = err.message; showError(err.message); } }

async function loadReservations() {
    $('resListError').textContent = ''; const subnet = $('resFilter').value; const params = subnet ? '?subnet_id=' + encodeURIComponent(subnet) : ''; try {
        const d = await api('ips' + params); const c = $('resList');
        if (!d.data.length) { c.innerHTML = '<p class="empty">No reservations.</p>'; return; }
        let html = '<table><thead><tr><th>IP</th><th>Subnet</th><th>Label</th><th>MAC</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
        d.data.forEach(r => { html += `<tr data-id="${escapeHtml(r.id)}" data-subnet="${escapeHtml(r.subnet_id)}"><td class="muted">${escapeHtml(r.ip)}</td><td class="muted">${escapeHtml(r.subnet_id)}</td><td class="muted">${escapeHtml(r.label)}</td><td class="muted">${escapeHtml(r.mac)}</td><td><span class="badge reserved">${escapeHtml(r.status)}</span></td><td class="actions"><button class="relBtn secondary">Release</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('.relBtn').forEach(b => b.addEventListener('click', () => { releaseIp(b.closest('tr').dataset.id, b.closest('tr').dataset.subnet); }));
    } catch (err) { $('resListError').textContent = err.message; showError(err.message); }
}

async function releaseIp(id, subnet_id) { if (!confirm('Release IP?')) return; try { await api('ips', 'POST', { action: 'release', ip_id: id }); toast(t('released'), 'success'); loadReservations(); loadSubnets(); } catch (err) { showError(err.message); } }

async function loadDetail() {
    $('detError').textContent = ''; const id = $('detSub').value; if (!id) { $('detError').textContent = 'Select a subnet'; return; } try {
        const d = await api('subnets?id=' + encodeURIComponent(id)); const s = d.data; const u = s.utilization || {}; $('detailCards').innerHTML = DOMPurify.sanitize(`<div class="grid"><div class="metric"><div class="value">${escapeHtml(u.total)}</div><div class="label">Total IPs</div></div><div class="metric"><div class="value">${escapeHtml(u.used)}</div><div class="label">Used</div></div><div class="metric"><div class="value">${escapeHtml(u.free)}</div><div class="label">Free</div></div><div class="metric"><div class="value">${escapeHtml(u.pct)}%</div><div class="label">Utilized</div></div></div>`);
        const map = $('ipMap'); map.innerHTML = ''; const used = new Set((s.reservations || []).map(r => r.ip));
        for (let i = 1; i <= Math.min(50, u.total); i++) { const cell = document.createElement('div'); cell.className = 'ip-cell ' + (used.has(i) ? '' : 'free'); cell.title = used.has(i) ? 'Reserved' : 'Free'; map.appendChild(cell); }
    } catch (err) { $('detError').textContent = err.message; showError(err.message); }
}

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('subSave').addEventListener('click', saveSubnet); $('subCancel').addEventListener('click', resetSubnet); $('subLoad').addEventListener('click', loadSubnets); $('subFamily').addEventListener('change', loadSubnets); $('subSort').addEventListener('change', loadSubnets); $('subOrder').addEventListener('change', loadSubnets); $('resReserve').addEventListener('click', reserveIp); $('resLoad').addEventListener('click', loadReservations); $('resFilter').addEventListener('change', loadReservations); $('detLoad').addEventListener('click', loadDetail); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('ipam-manager', '/api/plugins/ipam-manager/i18n'); await loadStatus(); wireEvents(); await loadSubnets(true); await loadReservations(); })();
