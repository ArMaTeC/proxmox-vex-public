/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/backup-retention-guard/ui.js
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
const t = (k, p) => i18n ? i18n.getT('backup-retention-guard')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('backup-retention-guard', '/api/plugins/backup-retention-guard/i18n');

const state = { policies: [], sort: { col: 'name', order: 'asc' } };

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; } catch (e) { $('status').textContent = 'Error'; } }
async function loadPolicies() { try { const d = await api('policies'); state.policies = d.policies || []; renderPolicies(); updatePolicySelects(); } catch (e) { showError(e.message); } }
async function loadCompliance() { try { const c = await api('compliance'); $('compGrid').innerHTML = DOMPurify.sanitize(`<div class="metric"><div class="value">${escapeHtml(c.policies_defined)}</div><div class="label">Policies defined</div></div><div class="metric"><div class="value">${c.compliant ? 'Yes' : 'No'}</div><div class="label">Compliant</div></div><div class="metric"><div class="value">${new Date(c.last_check).toLocaleString()}</div><div class="label">Last check</div></div>`); } catch (e) { showError(e.message); } }

function updatePolicySelects() { const opts = state.policies.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join(''); $('prPolicy').innerHTML = DOMPurify.sanitize('<option value="">Select policy</option>' + opts); $('asPolicy').innerHTML = DOMPurify.sanitize('<option value="">Select policy</option>' + opts); }

function filteredPolicies() { const txt = $('pSearch').value.toLowerCase(); const data = state.policies.filter(p => !txt || (p.name || '').toLowerCase().includes(txt)); data.sort((a, b) => { const av = String(a[state.sort.col] || '').toLowerCase(), bv = String(b[state.sort.col] || '').toLowerCase(); return state.sort.order === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av); }); return data; }

function renderPolicies() {
    const data = filteredPolicies(); const c = $('policiesList');
    if (!data.length) { c.innerHTML = '<p class="empty">No policies.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="name">Name</th><th data-sort="keep_count">Keep</th><th data-sort="max_age_days">Max age</th><th>Description</th><th data-sort="created_at">Created</th><th>Actions</th></tr></thead><tbody>';
    data.forEach(p => {
        html += `<tr>
                <td class="muted">${escapeHtml(p.name)}</td>
                <td class="muted">${escapeHtml(p.keep_count)}</td>
                <td class="muted">${escapeHtml(p.max_age_days)}</td>
                <td class="muted">${escapeHtml(p.description || '-')}</td>
                <td class="muted">${p.created_at ? new Date(p.created_at).toLocaleString() : '-'}</td>
                <td class="actions">
                    <button data-edit="${escapeHtml(p.id)}">Edit</button>
                    <button data-delete="${escapeHtml(p.id)}" class="secondary">Delete</button>
                    <button data-sim="${escapeHtml(p.id)}" class="secondary">Simulate</button>
                    <button data-apply="${escapeHtml(p.id)}" class="secondary">Apply</button>
                </td>
            </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-edit]').forEach(b => b.addEventListener('click', () => editPolicy(b.dataset.edit)));
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deletePolicy(b.dataset.delete)));
    c.querySelectorAll('button[data-sim]').forEach(b => b.addEventListener('click', () => { $('prPolicy').value = b.dataset.sim; switchTab('prune'); doSim(); }));
    c.querySelectorAll('button[data-apply]').forEach(b => b.addEventListener('click', () => { $('prPolicy').value = b.dataset.apply; switchTab('prune'); doApply(); }));
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; state.sort.order = state.sort.col === col && state.sort.order === 'asc' ? 'desc' : 'asc'; state.sort.col = col; renderPolicies(); }));
}

function editPolicy(id) { const p = state.policies.find(x => x.id === id); if (!p) return; $('pId').value = p.id; $('pName').value = p.name; $('pKeep').value = p.keep_count; $('pAge').value = p.max_age_days; $('pDesc').value = p.description || ''; $('formTitle').textContent = 'Edit Policy'; }

async function savePolicy(e) { e.preventDefault(); $('pError').textContent = ''; const keep = parseInt($('pKeep').value), age = parseInt($('pAge').value); if (keep < 1 || age < 1) { $('pError').textContent = 'Keep count and max age must be positive'; return; } const body = { id: $('pId').value, name: $('pName').value.trim(), keep_count: keep, max_age_days: age, description: $('pDesc').value }; try { await api('policies', 'POST', body); toast(t('saved'), 'success'); $('policyForm').reset(); $('pId').value = ''; $('formTitle').textContent = 'Create Policy'; loadPolicies(); } catch (err) { $('pError').textContent = err.message; showError(err.message); } }

async function deletePolicy(id) { if (!confirm('Delete policy?')) return; try { await api('policies', 'DELETE', { id }); toast(t('deleted'), 'success'); loadPolicies(); } catch (e) { showError(e.message); } }

async function doSim() {
    const id = $('prPolicy').value; if (!id) { showError('Select a policy'); return; } try {
        const d = await api('prune', 'POST', { policy_id: id }); $('prMetrics').innerHTML = DOMPurify.sanitize(`<div class="metric"><div class="value">${escapeHtml(d.pruned_count)}</div><div class="label">Pruned</div></div><div class="metric"><div class="value">${escapeHtml(d.kept)}</div><div class="label">Kept</div></div>`);
        if (!d.pruned_backups.length) { $('pruneList').innerHTML = '<p class="empty">No backups would be pruned.</p>'; return; }
        let html = '<table><thead><tr><th>Backup ID</th><th>Date</th><th>Reason</th></tr></thead><tbody>';
        d.pruned_backups.forEach(b => { html += `<tr><td class="muted">${escapeHtml(b.backup_id)}</td><td class="muted">${new Date(b.date).toLocaleString()}</td><td class="muted">${escapeHtml(b.reason)}</td></tr>`; });
        html += '</tbody></table>'; $('pruneList').innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showError(e.message); }
}

async function doApply() { const id = $('prPolicy').value; if (!id) { showError('Select a policy'); return; } if (!confirm('Apply prune? This will remove matching backups.')) return; try { const d = await api('apply', 'POST', { policy_id: id }); toast(t('pruned', { count: d.removed }), 'success'); } catch (e) { showError(e.message); } }

async function doAssign() { const id = $('asPolicy').value, target = $('asTarget').value.trim(); if (!id || !target) { showError('Select policy and target'); return; } try { await api('assign', 'POST', { policy_id: id, target }); toast(t('assigned'), 'success'); } catch (e) { showError(e.message); } }

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'compliance') loadCompliance(); if (name === 'prune') updatePolicySelects(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('policyForm').addEventListener('submit', savePolicy); $('pReset').addEventListener('click', () => { $('policyForm').reset(); $('pId').value = ''; $('formTitle').textContent = 'Create Policy'; }); $('pSearch').addEventListener('input', renderPolicies); $('prSim').addEventListener('click', doSim); $('prApply').addEventListener('click', doApply); $('asAssign').addEventListener('click', doAssign); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('backup-retention-guard', '/api/plugins/backup-retention-guard/i18n'); await loadStatus(); await loadPolicies(); wireEvents(); })();
