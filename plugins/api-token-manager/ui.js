/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/api-token-manager/ui.js
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
const t = (k, p) => i18n ? i18n.getT('api-token-manager')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('api-token-manager', '/api/plugins/api-token-manager/i18n');

const state = { tokens: [], scopes: [], sort: { col: 'created_at', order: 'desc' } };
let currentPrefix = '';
let searchTimer = null;

async function api(path, method = 'GET', body = null) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts); const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data;
}
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

function fmtDate(s) { try { const d = new Date(s); return isNaN(d.getTime()) ? '-' : d.toLocaleString(); } catch (e) { return '-'; } }
function fmtRemaining(s) { try { const d = new Date(s); if (isNaN(d.getTime())) return '-'; const now = Date.now(); if (d.getTime() < now) return 'Expired'; const diff = d.getTime() - now; const days = Math.floor(diff / 86400000); const hours = Math.floor((diff % 86400000) / 3600000); const minutes = Math.floor((diff % 3600000) / 60000); if (days > 0) return `in ${days}d ${hours}h`; if (hours > 0) return `in ${hours}h ${minutes}m`; return 'in <1h'; } catch (e) { return '-'; } }
async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; } catch (e) { $('status').textContent = 'Error'; } }
async function loadTokens() { try { $('tokensList').innerHTML = '<p class="loading">Loading...</p>'; const d = await api('tokens'); state.tokens = d.tokens || []; state.scopes = d.scopes || []; renderTokens(); renderScopeTags(); } catch (e) { showError(e.message); } }
async function loadAudit() {
    try {
        $('auditList').innerHTML = '<p class="loading">Loading...</p>'; const d = await api('audit'); const c = $('auditList'); const data = d.audit || [];
        if (!data.length) { c.innerHTML = '<p class="empty">No audit entries.</p>'; return; }
        let html = '<table><thead><tr><th>Token</th><th>Endpoint</th><th>Time</th></tr></thead><tbody>';
        data.forEach(a => html += `<tr><td class="muted">${escapeHtml(a.token_name || a.token_id)}</td><td class="muted">${escapeHtml(a.endpoint || '-')}</td><td class="muted">${fmtDate(a.at)}</td></tr>`);
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showError(e.message); }
}

function renderScopeTags() { const c = $('scopeTags'); c.innerHTML = DOMPurify.sanitize(state.scopes.map(s => `<span class="scope-tag" data-scope="${escapeHtml(s)}">${escapeHtml(s)}</span>`).join('')); c.querySelectorAll('.scope-tag').forEach(tag => tag.addEventListener('click', () => { const v = $('tScopes').value.trim() || '[]'; let arr; try { arr = JSON.parse(v); } catch (e) { arr = []; } if (!arr.includes(tag.dataset.scope)) { arr.push(tag.dataset.scope); $('tScopes').value = JSON.stringify(arr); } })); }

function scopeOptions() { const all = new Set(); state.tokens.forEach(t => (t.scopes || []).forEach(s => all.add(s))); const opts = [...all].map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join(''); $('tScope').innerHTML = DOMPurify.sanitize('<option value="">All scopes</option>' + opts); }

function filteredTokens() {
    const txt = $('tSearch').value.toLowerCase(); const sc = $('tScope').value; const st = $('tStatus').value;
    let data = state.tokens.filter(t => {
        const tmatch = !txt || (t.name || '').toLowerCase().includes(txt) || (t.id || '').toLowerCase().includes(txt);
        const scmatch = !sc || (t.scopes || []).includes(sc);
        let stmatch = !st;
        if (st === 'active') stmatch = !!t._active && !t.revoked;
        else if (st === 'expired') stmatch = !t._active && !t.revoked;
        else if (st === 'revoked') stmatch = !!t.revoked;
        return tmatch && scmatch && stmatch;
    });
    data = data.sort((a, b) => {
        const av = a[state.sort.col], bv = b[state.sort.col];
        if (state.sort.col === 'created_at') { return state.sort.order === 'asc' ? new Date(av) - new Date(bv) : new Date(bv) - new Date(av); }
        if (state.sort.order === 'asc') return String(av || '').localeCompare(String(bv || '')); return String(bv || '').localeCompare(String(av || ''));
    });
    return data;
}

function renderTokens() {
    scopeOptions(); const data = filteredTokens(); const c = $('tokensList');
    if (!data.length) { const anyFilter = $('tSearch').value || $('tScope').value || $('tStatus').value; c.innerHTML = `<p class="empty">${anyFilter ? 'No tokens match your filters.' : 'No tokens.'}</p>`; return; }
    let html = '<table><thead><tr><th data-sort="name">Name</th><th>Scopes</th><th data-sort="created_at">Created</th><th>Expires</th><th data-sort="expires_at">Time left</th><th>Last used</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    data.forEach(t => {
        const status = t.revoked ? 'revoked' : (t._active ? 'active' : 'expired'); const lastUsed = t.last_used_at ? `${fmtDate(t.last_used_at)}${t.last_used_ip ? ' · ' + escapeHtml(t.last_used_ip) : ''}` : '-'; html += `<tr>
                <td class="muted">${escapeHtml(t.name)}</td>
                <td class="muted">${(t.scopes || []).map(s => `<span class="scope-tag">${escapeHtml(s)}</span>`).join('')}</td>
                <td class="muted">${fmtDate(t.created_at)}</td>
                <td class="muted">${t.expires_at ? fmtDate(t.expires_at) : '-'}</td>
                <td class="muted">${t.expires_at ? fmtRemaining(t.expires_at) : '-'}</td>
                <td class="muted">${lastUsed}</td>
                <td class="muted"><span class="badge ${status === 'active' ? 'success' : (status === 'expired' ? 'warning' : 'danger')}">${status}</span></td>
                <td class="actions">
                    <button data-show="${escapeHtml(t.id)}">Show</button>
                    <button data-edit="${escapeHtml(t.id)}">Edit</button>
                    <button data-rotate="${escapeHtml(t.id)}" class="secondary">Rotate</button>
                    <button data-revoke="${escapeHtml(t.id)}" class="secondary">Revoke</button>
                    <button data-delete="${escapeHtml(t.id)}" class="secondary">Delete</button>
                </td>
            </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-show]').forEach(b => b.addEventListener('click', () => showToken(b.dataset.show)));
    c.querySelectorAll('button[data-edit]').forEach(b => b.addEventListener('click', () => editToken(b.dataset.edit)));
    c.querySelectorAll('button[data-rotate]').forEach(b => b.addEventListener('click', () => rotateToken(b.dataset.rotate)));
    c.querySelectorAll('button[data-revoke]').forEach(b => b.addEventListener('click', () => revokeToken(b.dataset.revoke)));
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deleteToken(b.dataset.delete)));
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; state.sort.order = state.sort.col === col && state.sort.order === 'asc' ? 'desc' : 'asc'; state.sort.col = col; renderTokens(); }));
}

function showToken(id) { const t = state.tokens.find(x => String(x.id) === id); if (!t) return; openPrefixModal(t); }
function openPrefixModal(t) { currentPrefix = t.token_prefix || 'N/A'; $('prefixName').textContent = t.name || '-'; $('prefixValue').value = currentPrefix; $('prefixModal').hidden = false; }
function closePrefixModal() { $('prefixModal').hidden = true; }
async function copyPrefix() { try { await navigator.clipboard.writeText(currentPrefix); toast('Token prefix copied', 'success'); } catch (e) { showError('Copy failed'); } }
function editToken(id) { const t = state.tokens.find(x => String(x.id) === id); if (!t) return; $('tId').value = t.id; $('tName').value = t.name; $('tScopes').value = JSON.stringify(t.scopes || []); $('tExpires').value = t.expires_at ? t.expires_at.slice(0, 16) : ''; switchTab('create'); }

async function saveToken(e) { e.preventDefault(); $('tError').textContent = ''; $('newTokenPanel').hidden = true; const saveBtn = e.target.querySelector('button[type="submit"]'); const originalText = saveBtn.textContent; saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; let scopes = []; try { scopes = JSON.parse($('tScopes').value.trim() || '[]'); } catch (err) { $('tError').textContent = 'Scopes must be valid JSON'; showError('Invalid scopes'); saveBtn.disabled = false; saveBtn.textContent = originalText; return; } const body = { id: $('tId').value, name: $('tName').value.trim(), scopes: scopes, expires_at: $('tExpires').value }; try { const d = await api('token', 'POST', body); toast(t('saved'), 'success'); if (d.raw_token) { $('newToken').value = d.raw_token; $('newTokenPanel').hidden = false; } $('tokenForm').reset(); loadTokens(); } catch (err) { $('tError').textContent = err.message; showError(err.message); } finally { saveBtn.disabled = false; saveBtn.textContent = originalText; } }

async function rotateToken(id) { if (!confirm('Rotate token?')) return; try { const d = await api('rotate', 'POST', { id }); toast(t('rotated'), 'success'); $('newToken').value = d.raw_token; $('newTokenPanel').hidden = false; loadTokens(); } catch (e) { showError(e.message); } }
async function revokeToken(id) { if (!confirm('Revoke token?')) return; try { await api('revoke', 'POST', { id }); toast(t('revoked'), 'success'); loadTokens(); } catch (e) { showError(e.message); } }
async function deleteToken(id) { if (!confirm('Delete token?')) return; try { await api('token', 'DELETE', { id }); toast(t('deleted'), 'success'); loadTokens(); } catch (e) { showError(e.message); } }

async function copyNew() { try { await navigator.clipboard.writeText($('newToken').value); toast(t('copied'), 'success'); } catch (e) { showError('Copy failed'); } }

function scheduleSearch() { clearTimeout(searchTimer); searchTimer = setTimeout(renderTokens, 200); }

function hasUnsavedToken() { return !!$('tName').value || !!$('tId').value || ($('tScopes').value.trim() && $('tScopes').value.trim() !== '[]') || !!$('tExpires').value; }

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'audit') loadAudit(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('tokenForm').addEventListener('submit', saveToken); $('tReset').addEventListener('click', () => { $('tokenForm').reset(); $('newTokenPanel').hidden = true; }); $('copyToken').addEventListener('click', copyNew); $('prefixCopy').addEventListener('click', copyPrefix); $('prefixClose').addEventListener('click', closePrefixModal); $('tSearch').addEventListener('input', scheduleSearch); $('tScope').addEventListener('change', renderTokens); $('tStatus').addEventListener('change', renderTokens); window.addEventListener('beforeunload', (e) => { if (hasUnsavedToken()) { e.preventDefault(); e.returnValue = ''; } }); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('api-token-manager', '/api/plugins/api-token-manager/i18n'); await loadStatus(); await loadTokens(); wireEvents(); })();
