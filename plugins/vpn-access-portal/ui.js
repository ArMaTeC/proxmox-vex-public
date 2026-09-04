/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/vpn-access-portal/ui.js
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
const t = (k, p) => i18n ? i18n.getT('vpn-access-portal')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('vpn-access-portal', '/api/plugins/vpn-access-portal/i18n');

const state = { clients: [], cfgClient: null, sort: { col: 'name', order: 'asc' } };

async function api(path, method = 'GET', body = null) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts); const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data;
}
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; } catch (e) { $('status').textContent = 'Error'; } }
async function loadClients() { try { const d = await api('clients'); state.clients = d.data || []; renderClients(); } catch (e) { showError(e.message); } }

function filteredClients() {
    const txt = $('cSearch').value.toLowerCase();
    const typ = $('cType').value;
    const en = $('cEnabled').value;
    let data = state.clients.filter(c => {
        const tmatch = !txt || (c.name || '').toLowerCase().includes(txt);
        const typmatch = !typ || c.type === typ;
        const enmatch = !en || String(c.enabled) === en;
        return tmatch && typmatch && enmatch;
    });
    data = data.sort((a, b) => {
        const av = (a[state.sort.col] || ''), bv = (b[state.sort.col] || '');
        if (state.sort.order === 'asc') return av.localeCompare(bv); return bv.localeCompare(av);
    });
    return data;
}

function renderClients() {
    const data = filteredClients();
    const c = $('clientsList');
    if (!data.length) { c.innerHTML = '<p class="empty">No clients.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="name">Name</th><th data-sort="type">Type</th><th data-sort="enabled">Enabled</th><th>Allowed IPs</th><th>Actions</th></tr></thead><tbody>';
    data.forEach(cl => {
        const badge = cl.enabled ? 'success' : 'danger';
        html += `<tr>
                    <td class="muted">${escapeHtml(cl.name)}</td>
                    <td class="muted">${escapeHtml(cl.type)}</td>
                    <td class="muted"><span class="badge ${badge}">${cl.enabled ? 'Yes' : 'No'}</span></td>
                    <td class="muted">${(cl.allowed_ips || []).map(escapeHtml).join(', ')}</td>
                    <td class="actions">
                        <button data-cfg="${escapeHtml(cl.id)}">Config</button>
                        <button data-edit="${escapeHtml(cl.id)}" class="secondary">Edit</button>
                        <button data-toggle="${escapeHtml(cl.id)}" class="secondary">${cl.enabled ? 'Disable' : 'Enable'}</button>
                        <button data-delete="${escapeHtml(cl.id)}" class="secondary">Delete</button>
                    </td>
                </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-cfg]').forEach(b => b.addEventListener('click', () => showConfig(b.dataset.cfg)));
    c.querySelectorAll('button[data-edit]').forEach(b => b.addEventListener('click', () => editClient(b.dataset.edit)));
    c.querySelectorAll('button[data-toggle]').forEach(b => b.addEventListener('click', () => toggleClient(b.dataset.toggle)));
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deleteClient(b.dataset.delete)));
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; state.sort.order = state.sort.col === col && state.sort.order === 'asc' ? 'desc' : 'asc'; state.sort.col = col; renderClients(); }));
}

function editClient(id) { const cl = state.clients.find(x => x.id === id); if (!cl) return; $('vId').value = cl.id; $('vName').value = cl.name; $('vType').value = cl.type; $('vIps').value = (cl.allowed_ips || []).join(', '); $('vDesc').value = cl.description || ''; $('vEmail').value = cl.email || ''; $('vExpires').value = cl.expires_at || ''; $('vEnabled').checked = cl.enabled; switchTab('add'); }
async function toggleClient(id) { const cl = state.clients.find(x => x.id === id); if (!cl) return; try { await api('clients', 'POST', { ...cl, id, enabled: !cl.enabled }); loadClients(); } catch (e) { showError(e.message); } }
async function deleteClient(id) { if (!confirm('Delete client?')) return; try { await api('clients', 'DELETE', { id }); toast(t('deleted'), 'success'); loadClients(); } catch (e) { showError(e.message); } }

async function showConfig(id) { try { const d = await api(`config?client_id=${encodeURIComponent(id)}`); state.cfgClient = d.data.client; const raw = d.data.config.raw; $('cfgRaw').textContent = raw; $('cfgDialog').showModal(); } catch (e) { showError(e.message); } }

async function saveClient(e) {
    e.preventDefault(); $('vError').textContent = '';
    const ips = $('vIps').value.split(',').map(x => x.trim()).filter(Boolean);
    const payload = { id: $('vId').value, name: $('vName').value.trim(), type: $('vType').value, allowed_ips: ips, description: $('vDesc').value.trim(), email: $('vEmail').value.trim(), expires_at: $('vExpires').value, enabled: $('vEnabled').checked };
    if (!payload.name) { $('vError').textContent = 'Name is required'; return; }
    try { await api('clients', 'POST', payload); toast(t('saved'), 'success'); $('clientForm').reset(); $('vEnabled').checked = true; loadClients(); }
    catch (err) { $('vError').textContent = err.message; showError(err.message); }
}

async function loadSessions() {
    try {
        const d = await api('sessions'); const c = $('sessionsList'); const data = d.data || [];
        if (!data.length) { c.innerHTML = '<p class="empty">No sessions.</p>'; return; }
        let html = '<table><thead><tr><th>Name</th><th>IP</th><th>Bytes</th><th>Connected</th></tr></thead><tbody>';
        data.forEach(s => html += `<tr><td class="muted">${escapeHtml(s.name)}</td><td class="muted">${escapeHtml(s.ip)}</td><td class="muted">${escapeHtml(s.bytes)}</td><td class="muted">${new Date(s.connected_since).toLocaleString()}</td></tr>`);
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showError(e.message); }
}

async function loadAudit() {
    try {
        const d = await api('audit'); const c = $('auditList'); const data = d.data || [];
        if (!data.length) { c.innerHTML = '<p class="empty">No audit events.</p>'; return; }
        let html = '<table><thead><tr><th>Action</th><th>Target</th><th>Time</th></tr></thead><tbody>';
        data.forEach(a => html += `<tr><td class="muted">${escapeHtml(a.action)}</td><td class="muted">${escapeHtml(a.target)}</td><td class="muted">${new Date(a.at).toLocaleString()}</td></tr>`);
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showError(e.message); }
}

function doDownload() { if (!state.cfgClient) return; const id = state.cfgClient.id; window.location.href = `download?client_id=${encodeURIComponent(id)}`; }
async function doCopy() { try { await navigator.clipboard.writeText($('cfgRaw').textContent); toast(t('copied'), 'success'); } catch (e) { showError(e.message); } }

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'sessions') loadSessions(); if (name === 'audit') loadAudit(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('clientForm').addEventListener('submit', saveClient); $('vReset').addEventListener('click', () => { $('clientForm').reset(); $('vEnabled').checked = true; }); $('cSearch').addEventListener('input', renderClients); $('cType').addEventListener('change', renderClients); $('cEnabled').addEventListener('change', renderClients); $('cfgClose').addEventListener('click', () => $('cfgDialog').close()); $('cfgDownload').addEventListener('click', doDownload); $('cfgCopy').addEventListener('click', doCopy); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('vpn-access-portal', '/api/plugins/vpn-access-portal/i18n'); await loadStatus(); await loadClients(); wireEvents(); })();
