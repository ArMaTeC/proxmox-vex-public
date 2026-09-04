/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/maintenance-windows/ui.js
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
const t = (k, p) => i18n ? i18n.getT('maintenance-windows')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('maintenance-windows', '/api/plugins/maintenance-windows/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function badgeClass(s) { return s === 'active' ? 'active' : s === 'upcoming' ? 'upcoming' : s === 'past' ? 'past' : s === 'overridden' ? 'overridden' : 'muted'; }
function toLocalInput(iso) { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
function fromLocalInput(value) { if (!value) return ''; const d = new Date(value); d.setMinutes(d.getMinutes() + d.getTimezoneOffset()); return d.toISOString(); }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = `${s.windows_count} windows`; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');[$('wCluster'), $('iCluster')].forEach(el => { const pre = el.id === 'iCluster' ? '<option value="">All</option>' : '<option value="">Global</option>'; el.innerHTML = DOMPurify.sanitize(pre + opts); }); } catch (e) { } }

async function loadWindows() {
    $('wError').textContent = ''; const status = $('wStatus').value, sort = $('wSort').value; const params = new URLSearchParams(); if (status) params.set('status', status); params.set('sort', sort); try {
        const d = await api('windows?' + params.toString()); const c = $('windowsList');
        const opts = (d.windows || []).map(w => `<option value="${escapeHtml(w.window_id)}">${escapeHtml(w.name)}</option>`).join(''); $('iWindow').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts);
        if (!d.windows.length) { c.innerHTML = '<p class="empty">No windows.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="name">Name</th><th data-sort="start">Start</th><th data-sort="end">End</th><th>Status</th><th>Scope</th><th>Actions</th></tr></thead><tbody>';
        d.windows.forEach(w => { html += `<tr data-id="${escapeHtml(w.window_id)}"><td class="muted">${escapeHtml(w.name)}</td><td class="muted">${new Date(w.start).toLocaleString()}</td><td class="muted">${new Date(w.end).toLocaleString()}</td><td><span class="badge ${badgeClass(w.status)}">${escapeHtml(w.status)}</span></td><td class="muted">${w.cluster_id ? escapeHtml(w.cluster_id) : 'Global'}</td><td class="actions"><button class="editBtn secondary">Edit</button><button class="overrideBtn secondary">${w.override ? 'Revert' : 'Override'}</button><button class="delBtn secondary">Delete</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { $('wSort').value = th.dataset.sort; loadWindows(); }));
        c.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', () => { editWindow(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.overrideBtn').forEach(b => b.addEventListener('click', () => { toggleOverride(b.closest('tr').dataset.id, b.textContent === 'Override'); }));
        c.querySelectorAll('.delBtn').forEach(b => b.addEventListener('click', () => { deleteWindow(b.closest('tr').dataset.id); }));
    } catch (err) { $('wError').textContent = err.message; showError(err.message); }
}

async function saveWindow() { $('wAddError').textContent = ''; const name = $('wName').value.trim(), start = fromLocalInput($('wStart').value), end = fromLocalInput($('wEnd').value), cluster = $('wCluster').value, tz = $('wTz').value, recurring = $('wRecurring').checked, cron = $('wCron').value.trim(), desc = $('wDesc').value.trim(); if (!name || !start || !end) { $('wAddError').textContent = 'Name, start, and end required'; return; } try { const body = { name, start, end, cluster_id: cluster, timezone: tz, recurring, cron, description: desc }; const id = $('wIdH').value; if (id) body.window_id = id; const d = await api('window', 'POST', body); toast(t('saved'), 'success'); resetAdd(); loadWindows(); } catch (err) { $('wAddError').textContent = err.message; showError(err.message); } }

async function editWindow(id) { try { const d = await api('windows'); const w = (d.windows || []).find(x => x.window_id === id); if (!w) throw new Error('Not found'); $('wIdH').value = w.window_id; $('wName').value = w.name; $('wStart').value = toLocalInput(w.start); $('wEnd').value = toLocalInput(w.end); $('wCluster').value = w.cluster_id || ''; $('wTz').value = w.timezone || 'UTC'; $('wRecurring').checked = w.recurring; $('wCron').value = w.cron || ''; $('wDesc').value = w.description || ''; $('addTitle').textContent = 'Edit Window'; $('wCancel').hidden = false; switchTab('add'); } catch (err) { showError(err.message); } }

async function toggleOverride(id, override) { try { await api('override', 'POST', { window_id: id, override }); loadWindows(); } catch (err) { showError(err.message); } }

async function deleteWindow(id) { if (!confirm('Delete window?')) return; try { await api('delete?id=' + encodeURIComponent(id)); toast(t('deleted'), 'success'); loadWindows(); } catch (err) { showError(err.message); } }

function resetAdd() { $('wIdH').value = ''; $('wName').value = ''; $('wStart').value = ''; $('wEnd').value = ''; $('wCluster').value = ''; $('wTz').value = 'UTC'; $('wRecurring').checked = false; $('wCron').value = ''; $('wDesc').value = ''; $('addTitle').textContent = 'Create Window'; $('wCancel').hidden = true; $('wAddError').textContent = ''; }

async function checkImpact() { $('iError').textContent = ''; const id = $('iWindow').value, cluster = $('iCluster').value; if (!id) { $('iError').textContent = 'Select a window'; return; } try { const params = new URLSearchParams(); params.set('window_id', id); if (cluster) params.set('cluster_id', cluster); const d = await api('impact?' + params.toString()); $('iResult').innerHTML = DOMPurify.sanitize(`<p class="muted">Impact for ${escapeHtml(d.name)}: ${escapeHtml(d.impact)}</p>`); } catch (err) { $('iError').textContent = err.message; showError(err.message); } }

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('wSave').addEventListener('click', saveWindow); $('wCancel').addEventListener('click', resetAdd); $('wLoad').addEventListener('click', loadWindows); $('wStatus').addEventListener('change', loadWindows); $('wSort').addEventListener('change', loadWindows); $('iCheck').addEventListener('click', checkImpact); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('maintenance-windows', '/api/plugins/maintenance-windows/i18n'); await loadStatus(); await loadClusters(); wireEvents(); await loadWindows(); })();
