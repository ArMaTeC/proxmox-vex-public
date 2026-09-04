/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/power-manager/ui.js
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
const t = (k, p) => i18n ? i18n.getT('power-manager')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('power-manager', '/api/plugins/power-manager/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('sTotal').textContent = s.total_outlets; $('sActive').textContent = s.active_outlets; $('status').textContent = `${s.active_outlets} active`; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join(''); $('oCluster').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }

async function control(action) { $('cError').textContent = ''; const node = $('cNode').value.trim(), outlet = $('cOutlet').value.trim(); if (!node || !outlet) { $('cError').textContent = 'Node and outlet required'; return; } if ((action === 'off' || action === 'cycle') && !confirm(`Confirm ${action} ${node}/${outlet}?`)) return; try { const r = await api(action, 'POST', { node, outlet }); $('cResult').textContent = `${r.outlet.node}/${r.outlet.outlet} -> ${r.outlet.state} at ${r.outlet.last_changed}`; toast(t(action)); loadStatus(); } catch (err) { $('cError').textContent = err.message; showError(err.message); } }

async function loadOutlets() {
    const cluster = $('oCluster').value, state = $('oState').value, node = $('oNode').value; const params = new URLSearchParams(); if (cluster) params.set('cluster_id', cluster); if (state) params.set('state', state); if (node) params.set('node', node); try {
        const d = await api('outlets?' + params.toString()); const c = $('oList');
        if (!d.outlets.length) { c.innerHTML = '<p class="empty">No outlets.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="node">Node</th><th data-sort="outlet">Outlet</th><th data-sort="state">State</th><th data-sort="last_action">Last Action</th><th data-sort="last_changed">Last Changed</th><th>Actions</th></tr></thead><tbody>';
        d.outlets.forEach(o => { html += `<tr data-node="${escapeHtml(o.node)}" data-outlet="${escapeHtml(String(o.outlet))}" data-state="${escapeHtml(o.state)}"><td class="muted">${escapeHtml(o.node)}</td><td class="muted">${escapeHtml(String(o.outlet))}</td><td class="muted">${escapeHtml(o.state)}</td><td class="muted">${escapeHtml(o.last_action)}</td><td class="muted">${escapeHtml(o.last_changed)}</td><td class="actions"><button class="onBtn" ${o.state === 'on' ? 'disabled' : ''}>On</button><button class="offBtn danger" ${o.state === 'off' ? 'disabled' : ''}>Off</button><button class="cycleBtn secondary">Cycle</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { params.set('sort', th.dataset.sort); api('outlets?' + params.toString()).then(loadOutlets); }));
        c.querySelectorAll('.onBtn').forEach(b => b.addEventListener('click', () => { controlFromRow(b, 'on'); }));
        c.querySelectorAll('.offBtn').forEach(b => b.addEventListener('click', () => { controlFromRow(b, 'off'); }));
        c.querySelectorAll('.cycleBtn').forEach(b => b.addEventListener('click', () => { controlFromRow(b, 'cycle'); }));
        updateNodeSelect(d.outlets);
    } catch (err) { showError(err.message); }
}

function updateNodeSelect(outlets) { const nodes = [...new Set(outlets.map(o => o.node).filter(Boolean))]; const opts = nodes.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join(''); $('oNode').innerHTML = DOMPurify.sanitize('<option value="">All</option>' + opts); $('hNode').innerHTML = DOMPurify.sanitize('<option value="">All</option>' + opts); }

async function controlFromRow(btn, action) { const row = btn.closest('tr'); await doControl(row.dataset.node, row.dataset.outlet, action); }

async function doControl(node, outlet, action) { if (!node || !outlet) return; if ((action === 'off' || action === 'cycle') && !confirm(`Confirm ${action} ${node}/${outlet}?`)) return; try { const r = await api(action, 'POST', { node, outlet }); toast(t(action)); await loadStatus(); if (document.querySelector('#panel-outlets:not([hidden])')) loadOutlets(); } catch (err) { showError(err.message); } }

let hPage = 1;
async function loadHistory(page = 1) {
    hPage = page; const action = $('hAction').value, node = $('hNode').value; const params = new URLSearchParams(); params.set('page', page); if (action) params.set('action', action); if (node) params.set('node', node); try {
        const d = await api('history?' + params.toString()); const c = $('hList');
        if (!d.history.length) { c.innerHTML = '<p class="empty">No history.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="timestamp">Timestamp</th><th data-sort="node">Node</th><th data-sort="outlet">Outlet</th><th data-sort="action">Action</th></tr></thead><tbody>';
        d.history.forEach(h => { html += `<tr><td class="muted">${escapeHtml(h.timestamp)}</td><td class="muted">${escapeHtml(h.node)}</td><td class="muted">${escapeHtml(String(h.outlet))}</td><td class="muted">${escapeHtml(h.action)}</td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        $('hPage').textContent = `Page ${d.page} of ${Math.max(1, Math.ceil(d.total / d.per_page))} (${d.total})`;
    } catch (err) { showError(err.message); }
}

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'outlets') loadOutlets(); if (name === 'history') loadHistory(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('cOn').addEventListener('click', () => control('on')); $('cOff').addEventListener('click', () => control('off')); $('cCycle').addEventListener('click', () => control('cycle')); $('oLoad').addEventListener('click', loadOutlets); $('oState').addEventListener('change', loadOutlets); $('oNode').addEventListener('change', loadOutlets); $('hLoad').addEventListener('click', () => loadHistory(1)); $('hAction').addEventListener('change', () => loadHistory(1)); $('hNode').addEventListener('change', () => loadHistory(1)); $('hPrev').addEventListener('click', () => loadHistory(Math.max(1, hPage - 1))); $('hNext').addEventListener('click', () => loadHistory(hPage + 1)); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('power-manager', '/api/plugins/power-manager/i18n'); await loadStatus(); await loadClusters(); wireEvents(); })();
