/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/ceph-dashboard/ui.js
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
const t = (k, p) => i18n ? i18n.getT('ceph-dashboard')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('ceph-dashboard', '/api/plugins/ceph-dashboard/i18n');

const state = { cluster: '', pools: [], osds: [], history: [], poolSort: { col: 'name', order: 'asc' }, osdSort: { col: 'id', order: 'asc' }, refresh: null };

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
function healthClass(h) { if (h === 'HEALTH_OK') return 'success'; if (h === 'HEALTH_WARN') return 'warning'; return 'danger'; }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; } catch (e) { $('status').textContent = 'Error'; } }
async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join(''); $('cCluster').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }

async function loadClusterStatus() { $('cError').textContent = ''; const cluster = $('cCluster').value; if (!cluster) { showError('Select a cluster'); return; } state.cluster = cluster; try { const d = await api(`cluster-status?cluster_id=${encodeURIComponent(cluster)}`); $('cResult').hidden = false; const h = d.status.health || 'UNKNOWN'; const cls = healthClass(h); $('cHealth').innerHTML = DOMPurify.sanitize(`<span class="badge ${cls}">${escapeHtml(h)}</span>`); $('cMonitors').textContent = d.status.monitors || '-'; const o = d.status.osdmap || {}; $('cOsds').textContent = `${o.num_up_osds || 0}/${o.num_in_osds || 0}`; $('cNode').textContent = d.node || '-'; toast(t('loaded'), 'success'); } catch (e) { $('cResult').hidden = true; $('cError').textContent = e.message; showError(e.message); } }

async function loadPools() { if (!state.cluster) { showError('Select a cluster first'); return; } try { const d = await api(`pools?cluster_id=${encodeURIComponent(state.cluster)}`); state.pools = d.pools || []; renderPools(); } catch (e) { showError(e.message); } }
function renderPools() {
    const c = $('poolsList'); const txt = ($('pSearch').value || '').toLowerCase(); let data = state.pools.filter(p => !txt || (p.name || '').toLowerCase().includes(txt)); data.sort((a, b) => { const av = String(a[state.poolSort.col] || '').toLowerCase(), bv = String(b[state.poolSort.col] || '').toLowerCase(); return state.poolSort.order === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av); });
    if (!data.length) { c.innerHTML = '<p class="empty">No pools.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="name">Name</th><th data-sort="size">Size</th><th>PG num</th><th>Usage</th></tr></thead><tbody>';
    data.forEach(p => {
        html += `<tr>
                <td class="muted">${escapeHtml(p.name)}</td>
                <td class="muted">${escapeHtml(p.size)}</td>
                <td class="muted">${escapeHtml(p.pg_num) || '-'}</td>
                <td class="muted">${p.usage !== undefined ? (p.usage * 100).toFixed(1) + '%' : '-'}</td>
            </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; state.poolSort.order = state.poolSort.col === col && state.poolSort.order === 'asc' ? 'desc' : 'asc'; state.poolSort.col = col; renderPools(); }));
}

async function loadOsds() { if (!state.cluster) { showError('Select a cluster first'); return; } try { const d = await api(`osds?cluster_id=${encodeURIComponent(state.cluster)}`); state.osds = d.osds || []; renderOsds(); } catch (e) { showError(e.message); } }
function renderOsds() {
    const c = $('osdsList'); let data = [...state.osds]; data.sort((a, b) => { const av = String(a[state.osdSort.col] || '').toLowerCase(), bv = String(b[state.osdSort.col] || '').toLowerCase(); return state.osdSort.order === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av); });
    if (!data.length) { c.innerHTML = '<p class="empty">No OSDs.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="id">ID</th><th data-sort="host">Host</th><th data-sort="up">Up</th><th data-sort="in">In</th></tr></thead><tbody>';
    data.forEach(o => {
        const upCls = o.up ? 'success' : 'danger'; const inCls = o.in ? 'success' : 'danger'; html += `<tr>
                <td class="muted">${escapeHtml(o.id)}</td>
                <td class="muted">${escapeHtml(o.host)}</td>
                <td class="muted"><span class="badge ${upCls}">${o.up ? 'yes' : 'no'}</span></td>
                <td class="muted"><span class="badge ${inCls}">${o.in ? 'yes' : 'no'}</span></td>
            </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; state.osdSort.order = state.osdSort.col === col && state.osdSort.order === 'asc' ? 'desc' : 'asc'; state.osdSort.col = col; renderOsds(); }));
}

async function loadHistory() {
    try {
        const d = await api(`history?cluster_id=${encodeURIComponent(state.cluster || '')}`); state.history = d.history || []; const c = $('historyList');
        if (!state.history.length) { c.innerHTML = '<p class="empty">No history.</p>'; return; }
        let html = '<table><thead><tr><th>Time</th><th>Health</th></tr></thead><tbody>';
        state.history.slice().reverse().forEach(h => { const cls = healthClass(h.health); html += `<tr><td class="muted">${new Date(h.timestamp).toLocaleString()}</td><td class="muted"><span class="badge ${cls}">${escapeHtml(h.health)}</span></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showError(e.message); }
}

function startRefresh() { if (state.refresh) { clearInterval(state.refresh); } const sec = parseInt($('cRefresh').value) || 0; if (sec > 0) { state.refresh = setInterval(loadClusterStatus, sec * 1000); } }

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'pools') loadPools(); if (name === 'osds') loadOsds(); if (name === 'history') loadHistory(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('cLoad').addEventListener('click', () => { loadClusterStatus(); startRefresh(); }); $('cRefresh').addEventListener('change', startRefresh); $('pSearch').addEventListener('input', renderPools); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('ceph-dashboard', '/api/plugins/ceph-dashboard/i18n'); await loadStatus(); await loadClusters(); wireEvents(); })();
