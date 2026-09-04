/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/notifications/ui.js
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
const t = (k, p) => i18n ? i18n.getT('notifications')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('notifications', '/api/plugins/notifications/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (res.status === 403) throw new Error(t('denied')); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('sNtfy').textContent = s.ntfy_enabled ? 'On' : 'Off'; $('sApprise').textContent = s.apprise_enabled ? 'On' : 'Off'; $('sUrlCount').textContent = s.apprise_url_count; $('sHandler').textContent = s.handler_registered ? 'Yes' : 'No'; $('status').textContent = 'Ready'; const any = s.ntfy_enabled || s.apprise_enabled; $('tSend').disabled = !any; } catch (err) { $('status').textContent = 'Error'; if (err.message.includes('denied')) showError(err.message); } }

async function loadConfig() { try { const c = await api('config'); $('nEnabled').checked = !!c.ntfy_enabled; $('nUrl').value = c.ntfy_url || ''; $('nTopic').value = c.ntfy_topic || ''; $('nToken').value = c.ntfy_token || ''; $('nPriority').value = typeof c.ntfy_priority_map === 'object' ? JSON.stringify(c.ntfy_priority_map, null, 2) : (c.ntfy_priority_map || ''); $('aAvail').textContent = c.apprise_available ? 'yes' : 'no'; $('aEnabled').disabled = !c.apprise_available; $('aEnabled').checked = !!c.apprise_enabled && c.apprise_available; $('aUrls').value = (c.apprise_urls || []).join('\n'); $('aUrls').disabled = !c.apprise_available; } catch (e) { if (e.message.includes('denied')) { $('panel-status').hidden = true; $('panel-config').innerHTML = DOMPurify.sanitize('<p class="message error">' + t('denied') + '</p>'); } } }

async function saveConfig() { $('cfgError').textContent = ''; const priority = $('nPriority').value.trim(); let pmap = {}; if (priority) { try { pmap = JSON.parse(priority); } catch (err) { $('cfgError').textContent = 'Priority map is invalid JSON'; return; } } const urls = $('aUrls').value; const body = { ntfy_enabled: $('nEnabled').checked, ntfy_url: $('nUrl').value.trim(), ntfy_topic: $('nTopic').value.trim(), ntfy_token: $('nToken').value, ntfy_priority_map: pmap, apprise_enabled: $('aEnabled').checked, apprise_urls: urls }; try { await api('config/update', 'POST', body); toast(t('saved')); await loadConfig(); await loadStatus(); } catch (err) { $('cfgError').textContent = err.message; showError(err.message); } }

async function sendTest() { try { const r = await api('test'); $('tResult').innerHTML = ''; const n = r.ntfy || {}; const a = r.apprise || {}; $('tResult').innerHTML = DOMPurify.sanitize(`<div class="message ${n.success ? 'success' : 'error'}">Ntfy: ${n.success ? 'OK' : escapeHtml(n.error)}</div><div class="message ${a.success ? 'success' : 'error'}">Apprise: ${a.success ? 'OK' : escapeHtml(a.error)}</div>`); toast(t('test')); await loadHistory(); } catch (err) { showError(err.message); } }

async function loadHistory() {
    try {
        const d = await api('history'); const c = $('historyList'); const h = d.history || [];
        if (!h.length) { c.innerHTML = '<p class="empty">No events.</p>'; return; }
        let html = '<table><thead><tr><th>Time</th><th>Event</th><th>Status</th></tr></thead><tbody>';
        h.forEach(x => { html += `<tr><td class="muted">${new Date(x.timestamp).toLocaleString()}</td><td class="muted">${escapeHtml(x.event)}</td><td class="muted">${escapeHtml(x.status)}</td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { }
}

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('cfgSave').addEventListener('click', saveConfig); $('tSend').addEventListener('click', sendTest); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('notifications', '/api/plugins/notifications/i18n'); await loadStatus(); await loadConfig(); wireEvents(); await loadHistory(); })();
