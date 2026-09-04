/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/health-dashboard/ui.js
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
const t = (k, p) => i18n ? i18n.getT('health-dashboard')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('health-dashboard', '/api/plugins/health-dashboard/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
function badgeClass(s) { return s === 'healthy' ? 'healthy' : s === 'warning' ? 'warning' : s === 'critical' ? 'critical' : 'muted'; }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = `Trend points: ${s.trend_points}`; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const clusters = d.clusters || [];[$('oCluster'), $('cCluster')].forEach(el => { const sel = el.value; const empty = el.id === 'oCluster' ? 'Global' : 'Select'; el.innerHTML = ''; const def = document.createElement('option'); def.value = ''; def.textContent = empty; el.appendChild(def); clusters.forEach(c => { const opt = document.createElement('option'); opt.value = c.id; opt.textContent = c.name; el.appendChild(opt); }); el.value = sel; }); } catch (e) { } }

async function checkOverall() { $('oError').textContent = ''; const cluster = $('oCluster').value; const params = cluster ? '?cluster_id=' + encodeURIComponent(cluster) : ''; try { const d = await api('health' + params); $('oScore').textContent = d.score || '-'; $('oStatus').textContent = d.status || '-'; $('oStatus').className = 'badge ' + badgeClass(d.status); toast(t('loaded'), 'success'); } catch (err) { $('oError').textContent = err.message; showError(err.message); } }

async function loadCluster() {
    $('cError').textContent = ''; const cluster = $('cCluster').value; if (!cluster) { $('cError').textContent = 'Select a cluster'; return; } try {
        const d = await api('cluster?id=' + encodeURIComponent(cluster)); const cd = $('clusterDetails');
        let html = `<div class="grid">`;
        ['cpu_health', 'memory_health', 'storage_health', 'network_health'].forEach(k => { html += `<div class="metric"><div class="value">${escapeHtml(d[k])}</div><div class="label">${escapeHtml(k.replace('_', ' '))}</div></div>`; });
        html += '</div>';
        cd.innerHTML = DOMPurify.sanitize(html);
        $('nodePanel').hidden = false; $('storagePanel').hidden = false;
        loadNodes(cluster); loadStorage(cluster);
        toast(t('loaded'), 'success');
    } catch (err) { $('cError').textContent = err.message; showError(err.message); }
}

async function loadNodes(cluster) {
    const status = $('nStatus').value; const params = new URLSearchParams(); params.set('cluster_id', cluster); if (status) params.set('status', status); try {
        const d = await api('nodes?' + params.toString()); const c = $('nodesList');
        if (!d.nodes.length) { c.innerHTML = '<p class="empty">No nodes.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="name">Name</th><th>CPU %</th><th>Mem %</th><th>Disk %</th><th data-sort="status">Status</th><th>Actions</th></tr></thead><tbody>';
        d.nodes.forEach(n => { html += `<tr><td class="muted">${escapeHtml(n.name)}</td><td class="muted">${escapeHtml(n.cpu_pct)}</td><td class="muted">${escapeHtml(n.mem_pct)}</td><td class="muted">${escapeHtml(n.disk_pct)}</td><td><span class="badge ${badgeClass(n.status)}">${escapeHtml(n.status)}</span></td><td class="actions"><button class="viewBtn secondary">View</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { sortNodes(th.dataset.sort); }));
        c.querySelectorAll('.viewBtn').forEach(b => b.addEventListener('click', () => { toast(`Node ${b.closest('tr').querySelector('td').textContent}: CPU ${b.closest('tr').children[1].textContent}%`); }));
    } catch (err) { showError(err.message); }
}

let currentNodes = [];
function sortNodes(col) { currentNodes.sort((a, b) => { const av = (a[col] || '').toString().toLowerCase(), bv = (b[col] || '').toString().toLowerCase(); return av > bv ? 1 : -1; }); renderNodes(currentNodes); }

async function loadStorage(cluster) {
    try {
        const d = await api('storage?cluster_id=' + encodeURIComponent(cluster)); const c = $('storageList');
        if (!d.storage.length) { c.innerHTML = '<p class="empty">No storage.</p>'; return; }
        let html = '<table><thead><tr><th>Name</th><th>Capacity %</th><th>Latency ms</th><th>IOPS</th><th>Health</th></tr></thead><tbody>';
        d.storage.forEach(s => { html += `<tr><td class="muted">${escapeHtml(s.name)}</td><td class="muted">${escapeHtml(s.capacity_pct)}</td><td class="muted">${escapeHtml(s.latency_ms)}</td><td class="muted">${escapeHtml(s.iops)}</td><td><span class="badge ${badgeClass(s.health)}">${escapeHtml(s.health)}</span></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (err) { showError(err.message); }
}

async function loadTrends() {
    $('tError').textContent = ''; const rng = $('tRange').value; try {
        const d = await api('trends?range=' + encodeURIComponent(rng)); const c = $('trendsChart');
        if (!d.trends.length) { c.innerHTML = '<p class="empty">No data.</p>'; $('trendsTable').innerHTML = '<p class="empty">No trend data.</p>'; return; }
        const w = c.clientWidth || 800, h = 200, vals = d.trends.map(t => t.score), min = Math.min(...vals, 60), max = Math.max(...vals, 100);
        const pts = d.trends.map((t, i) => { const x = (i / (d.trends.length - 1 || 1)) * w; const y = h - ((Number(t.score) - min) / (max - min || 1)) * h; return `${x},${y}`; }).join(' ');
        c.innerHTML = DOMPurify.sanitize(`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><rect x="0" y="0" width="${w}" height="${h * 0.3}" fill="rgba(248,81,73,0.08)"/><rect x="0" y="${h * 0.3}" width="${w}" height="${h * 0.3}" fill="rgba(210,153,34,0.08)"/><rect x="0" y="${h * 0.6}" width="${w}" height="${h * 0.4}" fill="rgba(35,134,54,0.08)"/><polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${escapeHtml(pts)}"/></svg>`);
        let html = '<table><thead><tr><th>Time</th><th>Score</th><th>Status</th></tr></thead><tbody>';
        d.trends.slice().reverse().forEach(t => { html += `<tr><td class="muted">${escapeHtml(new Date(t.timestamp).toLocaleString())}</td><td class="muted">${escapeHtml(t.score)}</td><td><span class="badge ${badgeClass(t.status)}">${escapeHtml(t.status)}</span></td></tr>`; });
        html += '</tbody></table>'; $('trendsTable').innerHTML = DOMPurify.sanitize(html);
    } catch (err) { $('tError').textContent = err.message; showError(err.message); }
}

async function renderNodes(nodes) {
    const d = await api('nodes?cluster_id=' + encodeURIComponent($('cCluster').value)); currentNodes = nodes || d.nodes; const c = $('nodesList');
    if (!currentNodes.length) { c.innerHTML = '<p class="empty">No nodes.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="name">Name</th><th>CPU %</th><th>Mem %</th><th>Disk %</th><th data-sort="status">Status</th><th>Actions</th></tr></thead><tbody>';
    currentNodes.forEach(n => { html += `<tr><td class="muted">${escapeHtml(n.name)}</td><td class="muted">${escapeHtml(n.cpu_pct)}</td><td class="muted">${escapeHtml(n.mem_pct)}</td><td class="muted">${escapeHtml(n.disk_pct)}</td><td><span class="badge ${badgeClass(n.status)}">${escapeHtml(n.status)}</span></td><td class="actions"><button class="viewBtn secondary">View</button></td></tr>`; });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { sortNodes(th.dataset.sort); }));
    c.querySelectorAll('.viewBtn').forEach(b => b.addEventListener('click', () => { toast(`Node ${b.closest('tr').querySelector('td').textContent}: CPU ${b.closest('tr').children[1].textContent}%`); }));
}

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('oCheck').addEventListener('click', checkOverall); $('cLoad').addEventListener('click', loadCluster); $('nLoad').addEventListener('click', () => loadNodes($('cCluster').value)); $('nStatus').addEventListener('change', () => loadNodes($('cCluster').value)); $('sLoad').addEventListener('click', () => loadStorage($('cCluster').value)); $('tLoad').addEventListener('click', loadTrends); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('health-dashboard', '/api/plugins/health-dashboard/i18n'); await loadStatus(); await loadClusters(); wireEvents(); loadTrends(); })();
