/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/hello_world/ui.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Ui JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
const qs = new URLSearchParams(window.location.search);
const theme = qs.get('theme') || 'modern-dark';
if (theme === 'corp-light') { document.documentElement.setAttribute('data-theme', 'corp-light'); } else { document.documentElement.removeAttribute('data-theme'); }
const $ = (id) => document.getElementById(id);
const i18n = window.parent && window.parent.ProxmoxVExI18n;
const t = (k, p) => i18n ? i18n.getT('hello_world')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('hello_world', '/api/plugins/hello_world/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
async function copyToClipboard(text) { try { await navigator.clipboard.writeText(text); toast(t('copied')); } catch (e) { toast('Clipboard access denied', 'error'); } }

function renderTable(obj, copyable = false) {
    let html = '<table><tbody>';
    Object.entries(obj).forEach(([k, v]) => {
        let raw = v;
        if (typeof v === 'object' && v !== null) { v = JSON.stringify(v); raw = v; }
        const valueId = `val-${k}`;
        html += `<tr><td class="muted">${escapeHtml(k)}</td><td id="${escapeHtml(valueId)}" data-raw="${escapeHtml(raw)}">${escapeHtml(v)}</td>${copyable ? `<td><button class="copyBtn secondary" data-target="${escapeHtml(valueId)}">Copy</button></td>` : ''}</tr>`;
    });
    html += '</tbody></table>';
    return html;
}

function renderDocs(docs) {
    let html = '<table><tbody>';
    Object.entries(docs).forEach(([k, v]) => { html += `<tr><td class="muted">${escapeHtml(k)}</td><td class="muted">${escapeHtml(v)}</td></tr>`; });
    html += '</tbody></table>';
    return html;
}

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; $('statusCard').innerHTML = DOMPurify.sanitize(renderTable(s, true)); wireCopy(); } catch (e) { $('status').textContent = 'Error'; $('status').classList.add('error'); $('statusCard').innerHTML = '<p class="error"></p>'; const _p = $('statusCard').firstElementChild; if (_p) _p.textContent = e.message; } }

async function loadInfo() { try { const i = await api('info'); $('infoCard').innerHTML = DOMPurify.sanitize(renderTable({ name: i.name, version: i.version, author: i.author, description: i.description, routes: i.available_routes }, true) + '<h3 style="margin-top:12px;">API Docs</h3>' + renderDocs(i.api_docs || {})); wireCopy(); } catch (e) { $('infoCard').innerHTML = '<p class="error"></p>'; const _p = $('infoCard').firstElementChild; if (_p) _p.textContent = e.message; } }

function wireCopy() { document.querySelectorAll('.copyBtn').forEach(b => b.addEventListener('click', () => { const el = $(b.dataset.target); if (el) copyToClipboard(el.dataset.raw); })); }

async function sendEcho() { const msg = $('echoText').value.trim() || 'Hello!'; try { const r = await api('echo', 'POST', { message: msg }); $('echoResult').textContent = JSON.stringify(r, null, 2); } catch (e) { $('echoResult').textContent = `Error: ${e.message}`; } }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('hello_world', '/api/plugins/hello_world/i18n'); await loadStatus(); await loadInfo(); $('refresh').addEventListener('click', async () => { await loadStatus(); await loadInfo(); }); $('echoBtn').addEventListener('click', sendEcho); })();
