/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/network-topology-map/ui.js
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
const t = (k, p) => i18n ? i18n.getT('network-topology-map')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('network-topology-map', '/api/plugins/network-topology-map/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('statNodes').textContent = s.cached_nodes; $('statEdges').textContent = s.cached_edges; $('status').textContent = `${s.cached_nodes} nodes`; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join(''); $('mCluster').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }

let graphData = { nodes: [], edges: [] };

function renderGraph() {
    const g = $('graph'); g.innerHTML = ''; const filter = $('mFilter').value; const nodes = graphData.nodes.filter(n => !filter || n.type === filter); const edges = graphData.edges; const w = g.clientWidth || 800, h = g.clientHeight || 400; const pos = {};
    const cx = w / 2, cy = h / 2; nodes.forEach((n, i) => { const angle = (i / nodes.length) * 2 * Math.PI; pos[n.id] = { x: cx + Math.cos(angle) * 150, y: cy + Math.sin(angle) * 150 }; });
    edges.forEach(e => { const s = pos[e.source], t = pos[e.target]; if (!s || !t) return; const dx = t.x - s.x, dy = t.y - s.y, len = Math.sqrt(dx * dx + dy * dy), ang = Math.atan2(dy, dx); const el = document.createElement('div'); el.className = 'gedge'; el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; el.style.width = len + 'px'; el.style.transform = `rotate(${ang}rad)`; g.appendChild(el); });
    nodes.forEach(n => { const p = pos[n.id]; const el = document.createElement('div'); el.className = 'gnode ' + n.type; el.style.left = (p.x - 20) + 'px'; el.style.top = (p.y - 20) + 'px'; el.textContent = n.type[0].toUpperCase(); el.title = escapeHtml(n.label); el.addEventListener('click', () => { $('detail').innerHTML = DOMPurify.sanitize(`<p class="muted"><strong>ID:</strong> ${escapeHtml(n.id)}<br><strong>Type:</strong> ${escapeHtml(n.type)}<br><strong>Label:</strong> ${escapeHtml(n.label)}</p>`); }); g.appendChild(el); });
}

async function loadMap() { $('mError').textContent = ''; const id = $('mCluster').value; if (!id) { $('mError').textContent = 'Select a cluster'; return; } try { const d = await api('map?cluster_id=' + encodeURIComponent(id)); graphData = d.data; renderGraph(); toast(t('loaded')); } catch (err) { $('mError').textContent = err.message; showError(err.message); } }

async function refreshMap() { $('mError').textContent = ''; const id = $('mCluster').value; if (!id) { $('mError').textContent = 'Select a cluster'; return; } try { await api('refresh', 'POST', { cluster_id: id }); await loadStatus(); await loadEdges(); toast(t('refreshed')); } catch (err) { $('mError').textContent = err.message; showError(err.message); } }

async function loadEdges() {
    try {
        const sort = $('eSort').value; const params = new URLSearchParams(); params.set('sort', sort); const d = await api('edges?' + params.toString()); const c = $('edgesList');
        if (!d.data.length) { c.innerHTML = '<p class="empty">No cached edges.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="source">Source</th><th data-sort="target">Target</th><th>Type</th></tr></thead><tbody>';
        d.data.forEach(e => { html += `<tr><td class="muted">${escapeHtml(e.source)}</td><td class="muted">${escapeHtml(e.target)}</td><td class="muted">${escapeHtml(e.type || '')}</td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { $('eSort').value = th.dataset.sort; loadEdges(); }));
    } catch (err) { showError(err.message); }
}

function fitGraph() { renderGraph(); }
function resetGraph() { $('mFilter').value = ''; renderGraph(); }
function fullscreen() { const g = $('graph'); if (g.requestFullscreen) g.requestFullscreen(); }

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('mLoad').addEventListener('click', loadMap); $('mRefresh').addEventListener('click', refreshMap); $('mFit').addEventListener('click', fitGraph); $('mReset').addEventListener('click', resetGraph); $('mFullscreen').addEventListener('click', fullscreen); $('mFilter').addEventListener('change', renderGraph); $('eLoad').addEventListener('click', loadEdges); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('network-topology-map', '/api/plugins/network-topology-map/i18n'); await loadStatus(); await loadClusters(); wireEvents(); })();
