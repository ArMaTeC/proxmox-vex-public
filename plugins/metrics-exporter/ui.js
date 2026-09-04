/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/metrics-exporter/ui.js
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
const t = (k, p) => i18n ? i18n.getT('metrics-exporter')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('metrics-exporter', '/api/plugins/metrics-exporter/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = `${s.targets_count} targets`; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');[$('mCluster'), $('tCluster'), $('tFilterCluster')].forEach(el => { const pre = el.id === 'tCluster' ? '<option value="">Any</option>' : '<option value="">' + (el.id === 'mCluster' ? 'Global' : 'All') + '</option>'; el.innerHTML = DOMPurify.sanitize(pre + opts); }); } catch (e) { } }

async function previewMetrics() { $('mError').textContent = ''; const cluster = $('mCluster').value, prefix = $('mPrefix').value.trim(); const params = new URLSearchParams(); if (cluster) params.set('cluster_id', cluster); if (prefix) params.set('prefix', prefix); try { const d = await api('metrics?' + params.toString()); $('mOutput').textContent = d.sample; } catch (err) { $('mError').textContent = err.message; showError(err.message); } }

function copyMetrics() { navigator.clipboard.writeText($('mOutput').textContent).then(() => toast(t('copied'))).catch(() => showError('Copy failed')); }

function downloadMetrics() { const b = new Blob([$('mOutput').textContent], { type: 'text/plain' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'metrics.prom'; a.click(); URL.revokeObjectURL(u); }

async function addTarget() { $('tError').textContent = ''; const id = $('tId').value.trim(), cluster = $('tCluster').value, enabled = $('tEnabled').value === 'true'; if (!id) { $('tError').textContent = 'Target ID required'; return; } try { await api('scrape', 'POST', { target_id: id, cluster_id: cluster, enabled }); toast(t('added')); $('tId').value = ''; loadTargets(); loadStatus(); } catch (err) { $('tError').textContent = err.message; showError(err.message); } }

async function loadTargets() {
    try {
        const enabled = $('tFilterEnabled').value, cluster = $('tFilterCluster').value, sort = $('tSort').value; const params = new URLSearchParams(); if (enabled) params.set('enabled', enabled); if (cluster) params.set('cluster_id', cluster); params.set('sort', sort); const d = await api('targets?' + params.toString()); const c = $('targetsList');
        if (!d.targets.length) { c.innerHTML = '<p class="empty">No targets.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="target_id">ID</th><th>Cluster</th><th>Enabled</th><th>Added</th><th>Actions</th></tr></thead><tbody>';
        d.targets.forEach(tg => { html += `<tr data-id="${escapeHtml(tg.target_id)}"><td class="muted">${escapeHtml(tg.target_id)}</td><td class="muted">${escapeHtml(tg.cluster_id)}</td><td class="muted">${escapeHtml(tg.enabled)}</td><td class="muted">${new Date(tg.added_at).toLocaleString()}</td><td class="actions"><button class="toggleBtn secondary">${tg.enabled ? 'Disable' : 'Enable'}</button><button class="delBtn secondary">Delete</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { $('tSort').value = th.dataset.sort; loadTargets(); }));
        c.querySelectorAll('.toggleBtn').forEach(b => b.addEventListener('click', () => { toggleTarget(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.delBtn').forEach(b => b.addEventListener('click', () => { deleteTarget(b.closest('tr').dataset.id); }));
    } catch (err) { showError(err.message); }
}

async function toggleTarget(id) { try { await api('toggle', 'POST', { target_id: id }); loadTargets(); } catch (err) { showError(err.message); } }

async function deleteTarget(id) { if (!confirm('Delete target?')) return; try { await api('delete?id=' + encodeURIComponent(id)); toast(t('deleted')); loadTargets(); loadStatus(); } catch (err) { showError(err.message); } }

async function loadConfig() { try { const d = await api('config'); $('cInterval').value = d.interval; $('cFormat').value = d.format; $('cPath').value = d.path; } catch (e) { } }

async function saveConfig() { $('cError').textContent = ''; const interval = parseInt($('cInterval').value), format = $('cFormat').value, path = $('cPath').value.trim(); if (!path) { $('cError').textContent = 'Path required'; return; } try { await api('config', 'POST', { interval, format, path }); toast(t('saved')); } catch (err) { $('cError').textContent = err.message; showError(err.message); } }

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('mPreview').addEventListener('click', previewMetrics); $('mCopy').addEventListener('click', copyMetrics); $('mDownload').addEventListener('click', downloadMetrics); $('tAdd').addEventListener('click', addTarget); $('tLoad').addEventListener('click', loadTargets); $('tFilterEnabled').addEventListener('change', loadTargets); $('tFilterCluster').addEventListener('change', loadTargets); $('tSort').addEventListener('change', loadTargets); $('cSave').addEventListener('click', saveConfig); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('metrics-exporter', '/api/plugins/metrics-exporter/i18n'); await loadStatus(); await loadClusters(); await loadConfig(); wireEvents(); await loadTargets(); })();
