/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/cert-manager/ui.js
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
const t = (k, p) => i18n ? i18n.getT('cert-manager')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('cert-manager', '/api/plugins/cert-manager/i18n');

const state = { certs: [], nodes: [], sort: { col: 'domain', order: 'asc' } };

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function statusClass(s) { if (s === 'active') return 'success'; if (s === 'pending') return 'warning'; return 'danger'; }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; } catch (e) { $('status').textContent = 'Error'; } }
async function loadNodes() { try { const d = await api('nodes'); const opts = (d.nodes || []).map(n => `<option value="${escapeHtml(n.id)}">${escapeHtml(n.name)}</option>`).join(''); $('dNode').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }

async function loadCerts() {
    try {
        const d = await api(`certs?status=${$('cFilter').value}&sort=${state.sort.col}&order=${state.sort.order}`); state.certs = d.data || []; const c = $('certsList');
        const txt = ($('cSearch').value || '').toLowerCase();
        let data = state.certs.filter(c => !txt || (c.domain || '').toLowerCase().includes(txt));
        if (!data.length) { c.innerHTML = '<p class="empty">No certificates.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="domain">Domain</th><th data-sort="status">Status</th><th data-sort="expires_at">Expires</th><th>Actions</th></tr></thead><tbody>';
        data.forEach(c => {
            html += `<tr>
                <td class="muted">${escapeHtml(c.domain)}</td>
                <td class="muted"><span class="badge ${statusClass(c.status)}">${escapeHtml(c.status)}</span></td>
                <td class="muted">${c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '-'}</td>
                <td class="actions">
                    <button data-view="${escapeHtml(c.id)}">View</button>
                    <button data-renew="${escapeHtml(c.id)}">Renew</button>
                    <button data-deploy="${escapeHtml(c.id)}" class="secondary">Deploy</button>
                    <button data-delete="${escapeHtml(c.id)}" class="secondary">Delete</button>
                </td>
            </tr>`;
        });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('button[data-view]').forEach(b => b.addEventListener('click', () => { const c = state.certs.find(x => x.id === b.dataset.view); if (!c) return; toast(`${c.domain} / ${c.sans?.join(', ') || '-'}`); }));
        c.querySelectorAll('button[data-renew]').forEach(b => b.addEventListener('click', async () => { try { await api('renew', 'POST', { cert_id: b.dataset.renew }); toast(t('renewed'), 'success'); loadCerts(); } catch (e) { showError(e.message); } }));
        c.querySelectorAll('button[data-deploy]').forEach(b => b.addEventListener('click', () => { const c = state.certs.find(x => x.id === b.dataset.deploy); if (!c) return; $('deployForm').hidden = false; $('dId').value = c.id; }));
        c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete certificate?')) return; try { await api('certs', 'DELETE', { cert_id: b.dataset.delete }); toast(t('deleted'), 'success'); loadCerts(); } catch (e) { showError(e.message); } }));
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; state.sort.order = state.sort.col === col && state.sort.order === 'asc' ? 'desc' : 'asc'; state.sort.col = col; loadCerts(); }));
    } catch (e) { showError(e.message); }
}

async function requestCert(e) { e.preventDefault(); $('cError').textContent = ''; const sans = $('cSans').value.trim(); let sansArr = []; if (sans) { try { sansArr = JSON.parse(sans); if (!Array.isArray(sansArr)) throw new Error(); } catch { $('cError').textContent = 'SANs must be a JSON array'; return; } } const body = { domain: $('cDomain').value.trim(), sans: sansArr, description: $('cDesc').value.trim(), provider: $('cProvider').value }; try { await api('certs', 'POST', body); toast('Certificate requested.', 'success'); $('certForm').reset(); $('cId').value = ''; loadCerts(); } catch (err) { $('cError').textContent = err.message; showError(err.message); } }

async function deployCert() { $('dError').textContent = ''; const id = $('dId').value, node = $('dNode').value; if (!node) { $('dError').textContent = 'Select a node'; return; } try { await api('deploy', 'POST', { cert_id: id, node }); toast(t('deployed'), 'success'); $('deployForm').hidden = true; loadCerts(); } catch (e) { $('dError').textContent = e.message; showError(e.message); } }

async function checkExpiry() {
    try {
        const d = await api(`expiry?days=${$('eDays').value}`); const c = $('expiryList');
        if (!d.data.length) { c.innerHTML = '<p class="empty">No expiring certificates.</p>'; return; }
        let html = '<table><thead><tr><th>Domain</th><th>Expires</th></tr></thead><tbody>';
        d.data.forEach(c => { html += `<tr><td class="muted">${escapeHtml(c.domain)}</td><td class="muted">${new Date(c.expires_at).toLocaleDateString()}</td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showError(e.message); }
}

async function saveAlert() { $('aError').textContent = ''; const body = { threshold_days: parseInt($('aDays').value), target: $('aTarget').value.trim() }; try { await api('alerts', 'POST', body); toast(t('saved'), 'success'); } catch (err) { $('aError').textContent = err.message; showError(err.message); } }

async function loadAlert() { try { const d = await api('alerts'); if (d.threshold_days) $('aDays').value = d.threshold_days; if (d.target) $('aTarget').value = d.target; } catch (e) { } }

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'expiry') checkExpiry(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('certForm').addEventListener('submit', requestCert); $('cReset').addEventListener('click', () => { $('certForm').reset(); $('cId').value = ''; }); $('cFilter').addEventListener('change', loadCerts); $('cSearch').addEventListener('input', loadCerts); $('dSubmit').addEventListener('click', deployCert); $('eCheck').addEventListener('click', checkExpiry); $('aSave').addEventListener('click', saveAlert); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('cert-manager', '/api/plugins/cert-manager/i18n'); await loadStatus(); await loadNodes(); await loadAlert(); wireEvents(); loadCerts(); })();
