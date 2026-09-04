/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/vm-snapshot-policy/ui.js
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
const t = (k, p) => i18n ? i18n.getT('vm-snapshot-policy')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('vm-snapshot-policy', '/api/plugins/vm-snapshot-policy/i18n');

const state = { clusters: [], policies: [], vms: [] };

async function api(path, method = 'GET', body = null) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts); const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data;
}
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; } catch (e) { $('status').textContent = 'Error'; $('status').classList.add('error'); } }
async function loadClusters() { try { const d = await api('clusters'); state.clusters = d.data || []; const a = $('aCluster'); const sel = a.value; a.innerHTML = ''; const def = document.createElement('option'); def.value = ''; def.textContent = 'Select'; a.appendChild(def); state.clusters.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.display_name || c.id; a.appendChild(o); }); a.value = sel; } catch (e) { showError(e.message); } }

async function loadPolicies() {
    try {
        const d = await api('policies'); state.policies = d.policies || []; const c = $('policiesList');
        c.innerHTML = '';
        if (!state.policies.length) { c.innerHTML = '<p class="empty">No policies.</p>'; return; }
        const table = document.createElement('table');
        table.innerHTML = '<thead><tr><th>ID</th><th>Schedule</th><th>Retention</th><th>Enabled</th><th>Actions</th></tr></thead>';
        const tbody = document.createElement('tbody');
        state.policies.forEach(p => {
            const tr = document.createElement('tr');
            const td1 = document.createElement('td'); td1.className = 'muted'; td1.textContent = p.id;
            const td2 = document.createElement('td'); td2.className = 'muted'; td2.textContent = p.human_schedule || p.schedule || 'manual';
            const td3 = document.createElement('td'); td3.className = 'muted'; td3.textContent = p.retention;
            const td4 = document.createElement('td'); td4.className = 'muted'; td4.textContent = p.enabled ? 'Yes' : 'No';
            const td5 = document.createElement('td'); td5.className = 'actions';
            const be = document.createElement('button'); be.type = 'button'; be.textContent = 'Edit'; be.dataset.edit = p.id;
            const bd = document.createElement('button'); bd.type = 'button'; bd.className = 'secondary'; bd.textContent = 'Delete'; bd.dataset.delete = p.id;
            td5.appendChild(be); td5.appendChild(bd);
            tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4); tr.appendChild(td5);
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        c.appendChild(table);
        c.querySelectorAll('button[data-edit]').forEach(b => b.addEventListener('click', () => editPolicy(b.dataset.edit)));
        c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deletePolicy(b.dataset.delete)));
        updatePolicySelect();
    } catch (e) { showError(e.message); }
}

function updatePolicySelect() { $('aPolicy').innerHTML = DOMPurify.sanitize(state.policies.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.id)}</option>`).join('')); }

function editPolicy(id) { const p = state.policies.find(x => x.id === id); if (!p) return; $('pId').value = p.id; $('pSchedule').value = p.schedule || ''; $('pRetention').value = p.retention; $('pDesc').value = p.description || ''; $('pEnabled').checked = p.enabled; }

async function deletePolicy(id) { if (!confirm('Delete policy ' + id + '?')) return; try { await api('policies', 'DELETE', { id }); toast(t('deleted'), 'success'); loadPolicies(); } catch (e) { showError(e.message); } }

async function savePolicy(e) {
    e.preventDefault();
    $('pError').textContent = '';
    const payload = { id: $('pId').value.trim(), schedule: $('pSchedule').value.trim(), retention: parseInt($('pRetention').value), description: $('pDesc').value.trim(), enabled: $('pEnabled').checked };
    if (!payload.id) { $('pError').textContent = 'ID is required'; return; }
    try { await api('policies', 'POST', payload); toast(t('saved'), 'success'); $('policyForm').reset(); $('pEnabled').checked = true; loadPolicies(); }
    catch (e) { $('pError').textContent = e.message; showError(e.message); }
}

async function loadVms() { const cid = $('aCluster').value; if (!cid) return; try { const d = await api(`vms?cluster_id=${encodeURIComponent(cid)}`); state.vms = d.data || []; $('aVm').innerHTML = DOMPurify.sanitize(state.vms.map(v => `<option value="${escapeHtml(v.vmid)}">${escapeHtml(v.name)} (${escapeHtml(v.vmid)})</option>`).join('')); } catch (e) { showError(e.message); } }

async function doApply(e) {
    e.preventDefault();
    try { const d = await api('apply', 'POST', { cluster_id: $('aCluster').value, vmid: $('aVm').value, policy_id: $('aPolicy').value }); $('applyResult').innerHTML = DOMPurify.sanitize(`<p class="message success">${t('applied')} Snapname: ${escapeHtml(d.planned.snapname)}</p>`); loadAssignments(); loadHistory(); }
    catch (e) { showError(e.message); }
}

async function loadAssignments() {
    try {
        const d = await api('assignments'); const c = $('assignList'); const data = d.data || [];
        if (!data.length) { c.innerHTML = '<p class="empty">No assignments.</p>'; return; }
        let html = '<table><thead><tr><th>Cluster</th><th>VM</th><th>Policy</th><th>Actions</th></tr></thead><tbody>';
        data.forEach(a => { html += `<tr><td class="muted">${escapeHtml(a.cluster_id)}</td><td class="muted">${escapeHtml(a.vmid)}</td><td class="muted">${escapeHtml(a.policy_id)}</td><td><button data-aid="${escapeHtml(a.assignment_id)}" type="button">Remove</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('button[data-aid]').forEach(b => b.addEventListener('click', async () => { try { await api('unassign', 'POST', { assignment_id: b.dataset.aid }); toast(t('unassigned'), 'success'); loadAssignments(); } catch (e) { showError(e.message); } }));
    } catch (e) { showError(e.message); }
}

async function loadHistory() {
    try {
        const d = await api('history'); const c = $('historyList'); const data = d.data || [];
        if (!data.length) { c.innerHTML = '<p class="empty">No history.</p>'; return; }
        let html = '<table><thead><tr><th>Time</th><th>VM</th><th>Policy</th><th>Snapname</th><th>Status</th></tr></thead><tbody>';
        data.forEach(h => { html += `<tr><td class="muted">${new Date(h.started_at).toLocaleString()}</td><td class="muted">${escapeHtml(h.vmid)}</td><td class="muted">${escapeHtml(h.policy_id)}</td><td class="muted">${escapeHtml(h.snapname)}</td><td><span class="badge">${escapeHtml(h.status)}</span></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showError(e.message); }
}

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'assignments') loadAssignments(); if (name === 'history') loadHistory(); if (name === 'apply') { loadClusters(); loadPolicies(); loadVms(); } }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('policyForm').addEventListener('submit', savePolicy); $('pReset').addEventListener('click', () => { $('policyForm').reset(); $('pEnabled').checked = true; }); $('applyForm').addEventListener('submit', doApply); $('aCluster').addEventListener('change', loadVms); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('vm-snapshot-policy', '/api/plugins/vm-snapshot-policy/i18n'); await loadStatus(); await loadClusters(); await loadPolicies(); wireEvents(); })();
