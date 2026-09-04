/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/status_page/ui.js
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
const t = (k, p) => i18n ? i18n.getT('status_page')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('status_page', '/api/plugins/status_page/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadConfig() { try { const c = await api('config'); $('sTitle').value = c.page_title || ''; $('sRefresh').value = c.refresh_interval; $('sPbsStale').value = c.pbs_stale_hours; $('sColor').value = c.theme_color || '#e57000'; $('sLogo').value = c.custom_logo_url || ''; $('sClusterName').checked = !!c.show_cluster_name; $('sNodeDetails').checked = !!c.show_node_details; $('sVmSummary').checked = !!c.show_vm_summary; $('sStorage').checked = !!c.show_storage; $('sPbs').checked = !!c.show_pbs_backups; $('publicUrl').textContent = escapeHtml(c.status_url || 'N/A'); $('status').textContent = 'Ready'; } catch (e) { $('status').textContent = 'Error'; showError(e.message); } }

async function saveConfig() {
    $('sError').textContent = ''; const body = {
        page_title: $('sTitle').value,
        refresh_interval: parseInt($('sRefresh').value),
        pbs_stale_hours: parseInt($('sPbsStale').value),
        theme_color: $('sColor').value,
        custom_logo_url: $('sLogo').value,
        show_cluster_name: $('sClusterName').checked,
        show_node_details: $('sNodeDetails').checked,
        show_vm_summary: $('sVmSummary').checked,
        show_storage: $('sStorage').checked,
        show_pbs_backups: $('sPbs').checked
    }; try { await api('config/update', 'POST', body); toast(t('saved')); await loadConfig(); } catch (err) { $('sError').textContent = err.message; showError(err.message); }
}

async function regenKey() { if (!confirm('Regenerate auth key? Old public links will stop working.')) return; try { const r = await api('generate-key', 'POST'); toast(t('regenerated')); $('publicUrl').textContent = escapeHtml(`/status?key=${r.auth_key}`); } catch (err) { showError(err.message); } }

async function loadIncidents() { try { const d = await api('incidents'); renderIncidents(d); } catch (err) { showError(err.message); } }

function renderIncidents(incidents) {
    const c = $('iList');
    if (!incidents || !incidents.length) { c.innerHTML = '<p class="muted">No incidents.</p>'; return; }
    let html = '<table><thead><tr><th>Title</th><th>Status</th><th>Severity</th><th>Started</th><th>Actions</th></tr></thead><tbody>';
    incidents.forEach(inc => { html += `<tr data-id="${escapeHtml(inc.id)}"><td>${escapeHtml(inc.title)}</td><td>${escapeHtml(inc.status)}</td><td>${escapeHtml(inc.severity)}</td><td>${escapeHtml(inc.started_at)}</td><td><button class="resolveBtn secondary" ${inc.status === 'resolved' ? 'disabled' : ''}>Resolve</button></td></tr>`; });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('.resolveBtn').forEach(b => b.addEventListener('click', () => resolveIncident(b.closest('tr').dataset.id)));
}

async function createIncident() { const body = { title: $('iTitle').value, severity: $('iSeverity').value, message: $('iMessage').value, status: $('iStatus').value, components: $('iComponents').value.split(',').map(s => s.trim()).filter(Boolean) }; try { await api('incidents/create', 'POST', body); toast(t('created')); loadIncidents(); } catch (err) { showError(err.message); } }

async function resolveIncident(id) { try { await api('incidents/update', 'POST', { id, status: 'resolved' }); toast('Resolved'); loadIncidents(); } catch (err) { showError(err.message); } }

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'incidents') loadIncidents(); if (name === 'public') loadConfig(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('sSave').addEventListener('click', saveConfig); $('sRegen').addEventListener('click', regenKey); $('iCreate').addEventListener('click', createIncident); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('status_page', '/api/plugins/status_page/i18n'); await loadConfig(); wireEvents(); })();
