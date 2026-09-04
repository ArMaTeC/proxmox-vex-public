/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/disaster-recovery-runner/ui.js
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
const t = (k, p) => i18n ? i18n.getT('disaster-recovery-runner')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('disaster-recovery-runner', '/api/plugins/disaster-recovery-runner/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = `${s.scenarios_count} scenarios, ${s.runs_count} runs`; } catch (e) { $('status').textContent = 'Error'; } }

function renderStep(index, name = 'failover') { const e = document.createElement('div'); e.className = 'step-row'; e.innerHTML = DOMPurify.sanitize(`<label>Step ${index + 1}<select class="stepType" data-idx="${index}"><option value="failover">failover</option><option value="verify">verify</option><option value="failback">failback</option><option value="network-isolate">network-isolate</option><option value="custom">custom</option></select></label><label>Target <input type="text" class="stepTarget" data-idx="${index}" placeholder="vm-100/cluster-a" /></label><button class="stepDel secondary" data-idx="${index}">Remove</button>`); e.querySelector('.stepType').value = name; e.querySelector('.stepDel').addEventListener('click', () => { e.remove(); renumberSteps(); }); return e; }
function renumberSteps() { const rows = $('edSteps').querySelectorAll('.step-row'); rows.forEach((r, i) => { r.querySelector('label').firstChild.textContent = `Step ${i + 1}`; r.querySelectorAll('[data-idx]').forEach(el => el.dataset.idx = i); }); }

let stepCount = 0;
function addStep(name = 'failover') { $('edSteps').appendChild(renderStep(stepCount++, name)); renumberSteps(); }

async function loadScenarios() {
    $('scError').textContent = ''; const name = $('scFilter').value.trim(); const params = new URLSearchParams(); if (name) params.set('name', name); try {
        const d = await api('scenarios?' + params.toString()); const c = $('scenariosList');
        if (!d.scenarios.length) { c.innerHTML = '<p class="empty">No scenarios.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="name">Name</th><th>Steps</th><th data-sort="created_at">Created</th><th>Actions</th></tr></thead><tbody>';
        d.scenarios.forEach(s => { html += `<tr data-id="${escapeHtml(s.scenario_id)}"><td class="muted">${escapeHtml(s.name)}</td><td class="muted">${(s.steps || []).length}</td><td class="muted">${new Date(s.created_at).toLocaleString()}</td><td class="actions"><button class="runBtn">Run</button><button class="editBtn secondary">Edit</button><button class="dupBtn secondary">Duplicate</button><button class="delBtn secondary">Delete</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { sortScenarios(th.dataset.sort); }));
        c.querySelectorAll('.runBtn').forEach(b => b.addEventListener('click', () => { runScenario(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', () => { editScenario(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.dupBtn').forEach(b => b.addEventListener('click', () => { duplicateScenario(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.delBtn').forEach(b => b.addEventListener('click', () => { deleteScenario(b.closest('tr').dataset.id); }));
    } catch (err) { $('scError').textContent = err.message; showError(err.message); }
}

async function sortScenarios(col) {
    const name = $('scFilter').value.trim(); const params = new URLSearchParams(); params.set('sort', col); if (name) params.set('name', name); try {
        const d = await api('scenarios?' + params.toString()); const c = $('scenariosList');
        let html = '<table><thead><tr><th data-sort="name">Name</th><th>Steps</th><th data-sort="created_at">Created</th><th>Actions</th></tr></thead><tbody>';
        d.scenarios.forEach(s => { html += `<tr data-id="${escapeHtml(s.scenario_id)}"><td class="muted">${escapeHtml(s.name)}</td><td class="muted">${(s.steps || []).length}</td><td class="muted">${new Date(s.created_at).toLocaleString()}</td><td class="actions"><button class="runBtn">Run</button><button class="editBtn secondary">Edit</button><button class="dupBtn secondary">Duplicate</button><button class="delBtn secondary">Delete</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { sortScenarios(th.dataset.sort); }));
        c.querySelectorAll('.runBtn').forEach(b => b.addEventListener('click', () => { runScenario(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', () => { editScenario(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.dupBtn').forEach(b => b.addEventListener('click', () => { duplicateScenario(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.delBtn').forEach(b => b.addEventListener('click', () => { deleteScenario(b.closest('tr').dataset.id); }));
    } catch (err) { showError(err.message); }
}

async function saveScenario() { $('edError').textContent = ''; const name = $('edName').value.trim(); if (!name) { $('edError').textContent = 'Name required'; return; } const steps = []; $('edSteps').querySelectorAll('.step-row').forEach(r => { const type = r.querySelector('.stepType').value; const target = r.querySelector('.stepTarget').value.trim(); steps.push({ name: type, target }); }); const editId = $('edId').value; const body = editId ? { scenario_id: editId, name, steps } : { name, steps }; const method = editId ? 'PUT' : 'POST'; const path = editId ? 'scenario-edit' : 'scenario'; try { await api(path, method, body); toast(t('created'), 'success'); resetEditor(); loadScenarios(); switchTab('scenarios'); } catch (err) { $('edError').textContent = err.message; showError(err.message); } }

async function editScenario(id) { try { const d = await api('scenarios'); const s = d.scenarios.find(x => x.scenario_id === id); if (!s) throw new Error('Scenario not found'); $('edId').value = s.scenario_id; $('edName').value = s.name; $('edSteps').innerHTML = ''; stepCount = 0; (s.steps || []).forEach(st => addStep(st.name)); $('edTitle').textContent = 'Edit Scenario'; $('edSave').textContent = 'Update'; $('edCancel').hidden = false; switchTab('editor'); } catch (err) { showError(err.message); } }

async function runScenario(id) { try { const d = await api('run', 'POST', { scenario_id: id }); toast(t('run', { id: d.run.run_id }), 'success'); $('rRunId').value = d.run.run_id; await lookupRun(); switchTab('runs'); } catch (err) { showError(err.message); } }

async function duplicateScenario(id) { try { const d = await api('scenario-duplicate', 'POST', { scenario_id: id }); toast('Duplicated: ' + d.scenario.scenario_id, 'success'); loadScenarios(); } catch (err) { showError(err.message); } }

async function deleteScenario(id) { if (!confirm('Delete this scenario?')) return; try { await api('scenario-delete?scenario_id=' + encodeURIComponent(id), 'DELETE'); toast(t('deleted'), 'success'); loadScenarios(); } catch (err) { showError(err.message); } }

async function lookupRun() {
    $('rError').textContent = ''; const runId = $('rRunId').value.trim(); if (!runId) { showError('Enter a run ID'); return; } try {
        const d = await api('result?id=' + encodeURIComponent(runId)); const c = $('runResult'); const r = d.result;
        let html = `<div class="grid"><div class="metric"><div class="value">${r.status}</div><div class="label">Status</div></div><div class="metric"><div class="value">${r.scenario_name || ''}</div><div class="label">Scenario</div></div></div>`;
        html += '<table><thead><tr><th>Step</th><th>Status</th></tr></thead><tbody>';
        (r.steps || []).forEach(st => { html += `<tr><td class="muted">${escapeHtml(st.name)}</td><td class="muted">${escapeHtml(st.status)}</td></tr>`; });
        html += '</tbody></table>';
        c.innerHTML = DOMPurify.sanitize(html);
    } catch (err) { $('rError').textContent = err.message; showError(err.message); }
}

function resetEditor() { $('edId').value = ''; $('edName').value = ''; $('edSteps').innerHTML = ''; stepCount = 0; addStep('failover'); addStep('verify'); addStep('failback'); $('edTitle').textContent = 'Create Scenario'; $('edSave').textContent = 'Create'; $('edCancel').hidden = true; $('edError').textContent = ''; $('edJsonBox').hidden = true; }

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('scLoad').addEventListener('click', loadScenarios); $('scFilter').addEventListener('input', loadScenarios); $('edAddStep').addEventListener('click', () => { addStep($('edCat').value); }); $('edSave').addEventListener('click', saveScenario); $('edCancel').addEventListener('click', () => { resetEditor(); switchTab('scenarios'); }); $('edJson').addEventListener('click', () => { const steps = []; $('edSteps').querySelectorAll('.step-row').forEach(r => steps.push({ name: r.querySelector('.stepType').value, target: r.querySelector('.stepTarget').value.trim() })); const b = $('edJsonBox'); b.value = JSON.stringify(steps, null, 2); b.hidden = !b.hidden; }); $('rLookup').addEventListener('click', lookupRun); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('disaster-recovery-runner', '/api/plugins/disaster-recovery-runner/i18n'); await loadStatus(); wireEvents(); loadScenarios(); resetEditor(); })();
