/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/firewall-rule-manager/ui.js
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
const t = (k, p) => i18n ? i18n.getT('firewall-rule-manager')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('firewall-rule-manager', '/api/plugins/firewall-rule-manager/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = `${s.rules_count} rules, ${s.enabled_count} enabled`; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join(''); $('aCluster').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }

async function loadRules() {
    $('rError').textContent = ''; const q = $('rSearch').value.trim(), proto = $('rProtocol').value, action = $('rAction').value, en = $('rEnabled').value; const params = new URLSearchParams(); if (q) params.set('q', q); if (proto) params.set('protocol', proto); if (action) params.set('action', action); if (en) params.set('enabled', en); try {
        const d = await api('rules?' + params.toString()); const c = $('rulesList');
        if (!d.data.length) { c.innerHTML = '<p class="empty">No rules.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="name">Name</th><th>Source</th><th>Destination</th><th data-sort="port">Port</th><th data-sort="protocol">Protocol</th><th data-sort="action">Action</th><th>Enabled</th><th>Actions</th></tr></thead><tbody>';
        d.data.forEach(r => { html += `<tr data-id="${escapeHtml(r.id)}"><td class="muted">${escapeHtml(r.name)}</td><td class="muted">${escapeHtml(r.source)}</td><td class="muted">${escapeHtml(r.destination)}</td><td class="muted">${escapeHtml(r.port)}</td><td class="muted">${escapeHtml(r.protocol)}</td><td class="muted">${escapeHtml(r.action)}</td><td><span class="badge ${r.enabled ? 'enabled' : 'disabled'}">${r.enabled ? 'Enabled' : 'Disabled'}</span></td><td class="actions"><button class="editBtn secondary">Edit</button><button class="testBtn secondary">Test</button><button class="delBtn secondary">Delete</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { sortRules(th.dataset.sort); }));
        c.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', () => { editRule(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.testBtn').forEach(b => b.addEventListener('click', () => { testRule(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.delBtn').forEach(b => b.addEventListener('click', () => { deleteRule(b.closest('tr').dataset.id); }));
    } catch (err) { $('rError').textContent = err.message; showError(err.message); }
}

async function sortRules(col) {
    const q = $('rSearch').value.trim(), proto = $('rProtocol').value, action = $('rAction').value, en = $('rEnabled').value; const params = new URLSearchParams(); params.set('sort', col); if (q) params.set('q', q); if (proto) params.set('protocol', proto); if (action) params.set('action', action); if (en) params.set('enabled', en); try {
        const d = await api('rules?' + params.toString()); const c = $('rulesList');
        let html = '<table><thead><tr><th data-sort="name">Name</th><th>Source</th><th>Destination</th><th data-sort="port">Port</th><th data-sort="protocol">Protocol</th><th data-sort="action">Action</th><th>Enabled</th><th>Actions</th></tr></thead><tbody>';
        d.data.forEach(r => { html += `<tr data-id="${escapeHtml(r.id)}"><td class="muted">${escapeHtml(r.name)}</td><td class="muted">${escapeHtml(r.source)}</td><td class="muted">${escapeHtml(r.destination)}</td><td class="muted">${escapeHtml(r.port)}</td><td class="muted">${escapeHtml(r.protocol)}</td><td class="muted">${escapeHtml(r.action)}</td><td><span class="badge ${r.enabled ? 'enabled' : 'disabled'}">${r.enabled ? 'Enabled' : 'Disabled'}</span></td><td class="actions"><button class="editBtn secondary">Edit</button><button class="testBtn secondary">Test</button><button class="delBtn secondary">Delete</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { sortRules(th.dataset.sort); }));
        c.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', () => { editRule(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.testBtn').forEach(b => b.addEventListener('click', () => { testRule(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.delBtn').forEach(b => b.addEventListener('click', () => { deleteRule(b.closest('tr').dataset.id); }));
    } catch (err) { showError(err.message); }
}

async function saveRule() { $('edError').textContent = ''; const name = $('edName').value.trim(); if (!name) { $('edError').textContent = 'Name required'; return; } const body = { name, source: $('edSource').value, destination: $('edDestination').value, port: $('edPort').value, protocol: $('edProtocol').value, action: $('edAction').value, enabled: $('edEnabled').checked, description: $('edDesc').value }; const editId = $('edId').value; const method = editId ? 'PUT' : 'POST'; try { await api('rules', method, editId ? { id: editId, ...body } : body); toast(t('created'), 'success'); resetEditor(); loadRules(); switchTab('rules'); } catch (err) { $('edError').textContent = err.message; showError(err.message); } }

async function editRule(id) { try { const d = await api('rules?id=' + encodeURIComponent(id)); const r = d.data; if (!r) throw new Error('Rule not found'); $('edId').value = r.id; $('edName').value = r.name; $('edSource').value = r.source; $('edDestination').value = r.destination; $('edPort').value = r.port; $('edProtocol').value = r.protocol; $('edAction').value = r.action; $('edEnabled').checked = !!r.enabled; $('edDesc').value = r.description || ''; $('edTitle').textContent = 'Edit Rule'; $('edCancel').hidden = false; switchTab('editor'); } catch (err) { showError(err.message); } }

async function testRule(id) { const cluster = prompt('Cluster ID to test against:'); if (!cluster) return; try { const d = await api('test', 'POST', { cluster_id: cluster, rule_id: id }); alert(`Test result: ${d.result}`); } catch (err) { showError(err.message); } }

async function deleteRule(id) { if (!confirm('Delete rule?')) return; try { await api('rules?id=' + encodeURIComponent(id), 'DELETE'); toast(t('deleted'), 'success'); loadRules(); } catch (err) { showError(err.message); } }

async function applyRules() { $('aError').textContent = ''; const cluster = $('aCluster').value; if (!cluster) { $('aError').textContent = 'Select a cluster'; return; } try { const d = await api('rules'); const ids = (d.data || []).filter(r => r.enabled).map(r => r.id); if (!ids.length) { $('aError').textContent = 'No enabled rules'; return; } const res = await api('apply', 'POST', { cluster_id: cluster, rule_ids: ids }); const c = $('applyResult'); c.innerHTML = DOMPurify.sanitize(`<p class="muted">Applied: ${escapeHtml(res.applied.length)} | Skipped: ${escapeHtml(res.skipped.length)}</p>`); toast(t('applied'), 'success'); loadRules(); } catch (err) { $('aError').textContent = err.message; showError(err.message); } }

function resetEditor() { $('edId').value = ''; $('edName').value = ''; $('edSource').value = ''; $('edDestination').value = ''; $('edPort').value = ''; $('edProtocol').value = 'tcp'; $('edAction').value = 'accept'; $('edEnabled').checked = true; $('edDesc').value = ''; $('edTitle').textContent = 'Add Rule'; $('edCancel').hidden = true; $('edError').textContent = ''; }

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('rLoad').addEventListener('click', loadRules); $('rSearch').addEventListener('input', loadRules); $('rProtocol').addEventListener('change', loadRules); $('rAction').addEventListener('change', loadRules); $('rEnabled').addEventListener('change', loadRules); $('rReset').addEventListener('click', () => { $('rSearch').value = ''; $('rProtocol').value = ''; $('rAction').value = ''; $('rEnabled').value = ''; loadRules(); }); $('edSave').addEventListener('click', saveRule); $('edCancel').addEventListener('click', () => { resetEditor(); switchTab('rules'); }); $('aApply').addEventListener('click', applyRules); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('firewall-rule-manager', '/api/plugins/firewall-rule-manager/i18n'); await loadStatus(); await loadClusters(); wireEvents(); loadRules(); resetEditor(); })();
