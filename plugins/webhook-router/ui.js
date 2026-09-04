/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/webhook-router/ui.js
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
const t = (k, p) => i18n ? i18n.getT('webhook-router')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('webhook-router', '/api/plugins/webhook-router/i18n');

const state = { endpoints: [], sort: { col: 'name', order: 'asc' } };

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
async function loadEndpoints() { try { const d = await api('endpoints'); state.endpoints = d.endpoints || []; renderEndpoints(); updateEndpointSelect(); } catch (e) { showError(e.message); } }
async function loadDeliveries() {
    try {
        const d = await api('deliveries'); const c = $('deliveriesList'); const data = d.deliveries || [];
        if (!data.length) { c.innerHTML = '<p class="empty">No deliveries.</p>'; return; }
        let html = '<table><thead><tr><th>ID</th><th>Endpoint</th><th>URL</th><th>Status</th><th>Time</th><th>Actions</th></tr></thead><tbody>';
        data.forEach(dlv => {
            html += `<tr>
                <td class="muted">${escapeHtml(dlv.id)}</td>
                <td class="muted">${escapeHtml(dlv.endpoint_name || dlv.endpoint_id)}</td>
                <td class="muted">${escapeHtml(dlv.url)}</td>
                <td class="muted"><span class="badge ${dlv.status === 'queued' ? 'warning' : (dlv.status === 'delivered' ? 'success' : 'danger')}">${escapeHtml(dlv.status)}</span></td>
                <td class="muted">${new Date(dlv.timestamp).toLocaleString()}</td>
                <td><button data-dlv="${escapeHtml(dlv.id)}" data-payload='${escapeHtml(JSON.stringify(dlv.payload))}'>View</button></td>
            </tr>`;
        });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('button[data-dlv]').forEach(b => b.addEventListener('click', () => { $('payBody').textContent = JSON.stringify(JSON.parse(b.dataset.payload.replace(/&#39;/g, "'")), null, 2); $('payDialog').showModal(); }));
    } catch (e) { showError(e.message); }
}

function updateEndpointSelect() { $('dEndpoint').innerHTML = DOMPurify.sanitize(`<option value="">Select endpoint</option>` + state.endpoints.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('')); }

function filteredEndpoints() {
    const txt = $('eSearch').value.toLowerCase();
    const en = $('eEnabled').value;
    const ev = $('eFilter').value;
    let data = state.endpoints.filter(e => {
        const tmatch = !txt || (e.name || '').toLowerCase().includes(txt) || (e.url || '').toLowerCase().includes(txt);
        const enmatch = !en || String(e.enabled) === en;
        const evmatch = !ev || (e.events || []).includes(ev);
        return tmatch && enmatch && evmatch;
    });
    data = data.sort((a, b) => {
        let av = (a[state.sort.col] || ''), bv = (b[state.sort.col] || '');
        if (state.sort.col === 'event_count') { av = (a.events || []).length; bv = (b.events || []).length; }
        if (state.sort.order === 'asc') { return typeof av === 'number' ? av - bv : av.localeCompare(bv); }
        return typeof av === 'number' ? bv - av : bv.localeCompare(av);
    });
    return data;
}

function renderEndpoints() {
    const data = filteredEndpoints();
    const c = $('endpointsList');
    if (!data.length) { c.innerHTML = '<p class="empty">No endpoints.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="name">Name</th><th data-sort="url">URL</th><th data-sort="event_count">Events</th><th data-sort="enabled">Enabled</th><th>Actions</th></tr></thead><tbody>';
    data.forEach(e => {
        html += `<tr>
                <td class="muted">${escapeHtml(e.name)}</td>
                <td class="muted">${escapeHtml(e.url)}</td>
                <td class="muted">${(e.events || []).length}</td>
                <td class="muted"><span class="badge ${e.enabled ? 'success' : 'danger'}">${e.enabled ? 'Yes' : 'No'}</span></td>
                <td class="actions">
                    <button data-edit="${escapeHtml(e.id)}">Edit</button>
                    <button data-test="${escapeHtml(e.id)}" class="secondary">Test</button>
                    <button data-toggle="${escapeHtml(e.id)}" class="secondary">${e.enabled ? 'Disable' : 'Enable'}</button>
                    <button data-delete="${escapeHtml(e.id)}" class="secondary">Delete</button>
                </td>
            </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-edit]').forEach(b => b.addEventListener('click', () => editEndpoint(b.dataset.edit)));
    c.querySelectorAll('button[data-test]').forEach(b => b.addEventListener('click', () => { $('dEndpoint').value = b.dataset.test; switchTab('deliveries'); }));
    c.querySelectorAll('button[data-toggle]').forEach(b => b.addEventListener('click', () => toggleEndpoint(b.dataset.toggle)));
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deleteEndpoint(b.dataset.delete)));
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; state.sort.order = state.sort.col === col && state.sort.order === 'asc' ? 'desc' : 'asc'; state.sort.col = col; renderEndpoints(); }));
}

function editEndpoint(id) { const e = state.endpoints.find(x => x.id === id); if (!e) return; $('hId').value = e.id; $('hName').value = e.name; $('hUrl').value = e.url; $('hEvents').value = (e.events || []).join(', '); $('hFilter').value = e.filter || ''; $('hRetries').value = e.retries || 3; $('hSecret').value = e.secret || ''; $('hDesc').value = e.description || ''; $('hEnabled').checked = e.enabled; switchTab('add'); }
async function toggleEndpoint(id) { const e = state.endpoints.find(x => x.id === id); if (!e) return; try { await api('endpoints', 'POST', { ...e, id, enabled: !e.enabled }); loadEndpoints(); } catch (err) { showError(err.message); } }
async function deleteEndpoint(id) { if (!confirm('Delete endpoint?')) return; try { await api('endpoints', 'DELETE', { id }); toast(t('deleted'), 'success'); loadEndpoints(); } catch (err) { showError(err.message); } }

async function saveEndpoint(e) {
    e.preventDefault(); $('hError').textContent = '';
    const events = $('hEvents').value.split(',').map(x => x.trim()).filter(Boolean);
    const payload = { id: $('hId').value, name: $('hName').value.trim(), url: $('hUrl').value.trim(), events: events, enabled: $('hEnabled').checked, filter: $('hFilter').value.trim(), retries: parseInt($('hRetries').value) || 0, secret: $('hSecret').value.trim(), description: $('hDesc').value.trim() };
    if (!payload.name || !payload.url) { $('hError').textContent = 'Name and URL are required'; return; }
    try { await api('endpoints', 'POST', payload); toast(t('saved'), 'success'); $('endpointForm').reset(); $('hEnabled').checked = true; loadEndpoints(); }
    catch (err) { $('hError').textContent = err.message; showError(err.message); }
}

async function doTest(e) {
    e.preventDefault(); $('testResult').innerHTML = '';
    let payload = {};
    try { const raw = $('dPayload').value.trim(); payload = raw ? JSON.parse(raw) : {}; }
    catch (err) { showError('Payload must be valid JSON'); return; }
    const body = { id: $('dEndpoint').value || undefined, url: $('dUrl').value.trim(), payload };
    if (!body.id && !body.url) { showError('Select an endpoint or enter a manual URL'); return; }
    try { const d = await api('test', 'POST', body); $('testResult').innerHTML = DOMPurify.sanitize(`<p class="message success">${t('tested')} ${d.delivery.id}</p>`); loadDeliveries(); }
    catch (err) { showError(err.message); }
}

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'deliveries') loadDeliveries(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('endpointForm').addEventListener('submit', saveEndpoint); $('hReset').addEventListener('click', () => { $('endpointForm').reset(); $('hEnabled').checked = true; }); $('testForm').addEventListener('submit', doTest); $('payClose').addEventListener('click', () => $('payDialog').close()); $('eSearch').addEventListener('input', renderEndpoints); $('eEnabled').addEventListener('change', renderEndpoints); $('eFilter').addEventListener('change', renderEndpoints); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('webhook-router', '/api/plugins/webhook-router/i18n'); await loadStatus(); await loadEndpoints(); wireEvents(); })();
