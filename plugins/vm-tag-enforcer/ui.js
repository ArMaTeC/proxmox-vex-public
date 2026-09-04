/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/vm-tag-enforcer/ui.js
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
const t = (k, p) => i18n ? i18n.getT('vm-tag-enforcer')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('vm-tag-enforcer', '/api/plugins/vm-tag-enforcer/i18n');

const state = { clusters: [], rules: [], vms: [], autoRules: [], autoRuns: [], schedules: [], sort: { col: 'id', order: 'asc' } };

async function api(path, method = 'GET', body = null) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts); const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data;
}
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(msg, 'error'); }
function showFixHint(hint) { const m = $('fixModal'); $('fixModalContent').textContent = hint || 'No guidance available.'; m.hidden = false; }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; } catch (e) { $('status').textContent = 'Error'; } }
async function loadClusters() {
    try {
        const d = await api('clusters');
        state.clusters = d.data || [];
        const h = state.clusters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name || c.id)}</option>`).join('');
        $('vCluster').innerHTML = DOMPurify.sanitize(h);
        $('sCluster').innerHTML = DOMPurify.sanitize(h);
        const ah = '<option value="" disabled selected>Select cluster</option>' + h;
        $('aCluster').innerHTML = DOMPurify.sanitize(ah);
        $('schedCluster').innerHTML = DOMPurify.sanitize(ah);
        // Pre-load VMs for the first cluster so the Validate tab is not empty on first view.
        if (state.clusters.length) { await loadVms(); }
    } catch (e) { showError(e.message); }
}

async function loadRules() {
    try { const d = await api('rules'); state.rules = d.rules || []; renderRules(); } catch (e) { showError(e.message); }
}

function filteredRules() {
    const txt = $('rFilter').value.toLowerCase();
    const lv = $('rLevelFilter').value;
    const req = $('rRequiredFilter').value;
    let data = state.rules.filter(r => {
        const textMatch = !txt || r.id.toLowerCase().includes(txt) || r.tag.toLowerCase().includes(txt) || (r.description || '').toLowerCase().includes(txt);
        const levelMatch = !lv || r.level === lv;
        const reqMatch = !req || String(r.required) === req;
        return textMatch && levelMatch && reqMatch;
    });
    data = data.sort((a, b) => {
        const av = (a[state.sort.col] || ''), bv = (b[state.sort.col] || '');
        if (state.sort.order === 'asc') return av.localeCompare(bv); return bv.localeCompare(av);
    });
    return data;
}

function renderRules() {
    const data = filteredRules();
    const c = $('rulesList');
    if (!data.length) { c.innerHTML = '<p class="empty">No rules.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="id">ID</th><th data-sort="tag">Tag</th><th data-sort="level">Level</th><th>Required</th><th data-sort="description">Description</th><th>Actions</th></tr></thead><tbody>';
    data.forEach(r => {
        const cls = r.level === 'critical' ? 'danger' : 'warning';
        html += `<tr>
                    <td class="muted">${escapeHtml(r.id)}</td>
                    <td class="muted">${escapeHtml(r.tag)}</td>
                    <td class="muted"><span class="badge ${cls}">${escapeHtml(r.level)}</span></td>
                    <td class="muted">${r.required ? 'Yes' : 'No'}</td>
                    <td class="muted">${escapeHtml(r.description || '')}</td>
                    <td class="actions"><button data-edit="${escapeHtml(r.id)}">Edit</button><button data-delete="${escapeHtml(r.id)}" class="secondary">Delete</button></td>
                </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-edit]').forEach(b => b.addEventListener('click', () => editRule(b.dataset.edit)));
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deleteRule(b.dataset.delete)));
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; state.sort.order = state.sort.col === col && state.sort.order === 'asc' ? 'desc' : 'asc'; state.sort.col = col; renderRules(); }));
}

function editRule(id) { const r = state.rules.find(x => x.id === id); if (!r) return; $('rId').value = r.id; $('rTag').value = r.tag; $('rLevel').value = r.level; $('rRequired').checked = r.required; $('rDesc').value = r.description || ''; }
async function deleteRule(id) { if (!confirm('Delete rule ' + id + '?')) return; try { await api('rule', 'DELETE', { id }); toast(t('deleted'), 'success'); loadRules(); } catch (e) { showError(e.message); } }

async function saveRule(e) {
    e.preventDefault(); $('rError').textContent = '';
    const payload = { id: $('rId').value.trim(), tag: $('rTag').value.trim(), level: $('rLevel').value, required: $('rRequired').checked, description: $('rDesc').value.trim() };
    if (!payload.id || !payload.tag) { $('rError').textContent = 'ID and tag are required'; return; }
    try { await api('rules', 'POST', payload); toast(t('saved'), 'success'); $('ruleForm').reset(); $('rRequired').checked = true; loadRules(); }
    catch (err) { $('rError').textContent = err.message; showError(err.message); }
}

async function loadVms() { const cid = $('vCluster').value; if (!cid) return; try { const d = await api(`vms?cluster_id=${encodeURIComponent(cid)}`); state.vms = d.data || []; $('vVm').innerHTML = DOMPurify.sanitize(state.vms.map(v => `<option value="${escapeHtml(v.vmid)}">${escapeHtml(v.name)} (${escapeHtml(v.vmid)})</option>`).join('')); } catch (e) { showError(e.message); } }

async function doValidate(e) {
    e.preventDefault();
    try { const d = await api('validate', 'POST', { cluster_id: $('vCluster').value, vmid: $('vVm').value }); showValidate(d); }
    catch (e) { showError(e.message); }
}

function showValidate(d) {
    const v = d.violations || [];
    let html = `<p class="muted">Tags: ${(d.tags || []).map(escapeHtml).join(', ') || 'none'}</p>`;
    if (!v.length) { html += '<p class="message success">No violations.</p>'; }
    else {
        html += '<table><thead><tr><th>Rule</th><th>Missing tag</th><th>Level</th><th>Actions</th></tr></thead><tbody>';
        v.forEach(x => { html += `<tr><td class="muted">${escapeHtml(x.rule_id)}</td><td class="muted">${escapeHtml(x.tag)}</td><td class="muted"><span class="badge ${x.level === 'critical' ? 'danger' : 'warning'}">${escapeHtml(x.level)}</span></td><td><button data-cid="${escapeHtml(d.cluster_id)}" data-vmid="${escapeHtml(d.vmid)}" data-tag="${escapeHtml(x.tag)}" class="remediate">Remediate</button></td></tr>`; });
        html += '</tbody></table>';
    }
    $('vResult').innerHTML = DOMPurify.sanitize(html);
    $('vResult').querySelectorAll('button.remediate').forEach(b => b.addEventListener('click', async () => { try { const res = await api('remediate', 'POST', { cluster_id: b.dataset.cid, vmid: b.dataset.vmid }); toast(`${t('remediated')} Job: ${res.job_id}`, 'success'); loadHistory(); } catch (e) { showError(e.message); } }));
}

async function doScan(e) {
    e.preventDefault();
    try { const d = await api(`scan?cluster_id=${encodeURIComponent($('sCluster').value)}`); showScan(d); } catch (e) { showError(e.message); }
}

function showScan(d) {
    const res = d.results || [];
    if (!res.length) { $('scanResult').innerHTML = '<p class="message success">All VMs are compliant.</p>'; return; }
    let html = `<p class="muted">Non-compliant: ${d.non_compliant}</p><table><thead><tr><th>VM</th><th>Missing tags</th><th>Actions</th></tr></thead><tbody>`;
    res.forEach(r => {
        const missing = r.violations.map(v => escapeHtml(v.tag)).join(', ');
        html += `<tr><td class="muted">${escapeHtml(r.name)} (${escapeHtml(r.vmid)})</td><td class="muted">${missing}</td><td><button data-cid="${escapeHtml(d.cluster_id)}" data-vmid="${escapeHtml(r.vmid)}" class="remediate">Remediate</button></td></tr>`;
    });
    html += '</tbody></table>'; $('scanResult').innerHTML = DOMPurify.sanitize(html);
    $('scanResult').querySelectorAll('button.remediate').forEach(b => b.addEventListener('click', async () => { try { const res = await api('remediate', 'POST', { cluster_id: b.dataset.cid, vmid: b.dataset.vmid }); toast(`${t('remediated')} Job: ${res.job_id}`, 'success'); loadHistory(); } catch (e) { showError(e.message); } }));
}

function doExportJson() { window.location.href = 'export?format=json'; }
function doExportCsv() { window.location.href = 'export?format=csv'; }

async function loadHistory() {
    try {
        const d = await api('history'); const c = $('historyList'); const data = d.data || [];
        if (!data.length) { c.innerHTML = '<p class="empty">No history.</p>'; return; }
        let html = '<table><thead><tr><th>Kind</th><th>ID</th><th>Target</th><th>Status</th><th>Time</th><th>Note</th></tr></thead><tbody>';
        data.forEach(h => {
            const note = h.error || h.message || '';
            html += `<tr>
                        <td class="muted">${escapeHtml(h.kind)}</td>
                        <td class="muted">${escapeHtml(h.id)}</td>
                        <td class="muted">${escapeHtml(h.target || '')}</td>
                        <td class="muted"><span class="badge">${escapeHtml(h.status)}</span></td>
                        <td class="muted">${new Date(h.created_at).toLocaleString()}</td>
                        <td class="muted">${escapeHtml(note)}</td>
                    </tr>`;
        });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showError(e.message); }
}

async function loadAutoRules() {
    try { const d = await api('auto_rules'); state.autoRules = d.auto_rules || []; renderAutoRules(); } catch (e) { showError(e.message); }
}

function renderAutoRules() {
    const c = $('autoRulesList');
    const data = state.autoRules || [];
    if (!data.length) { c.innerHTML = '<p class="empty">No auto tag rules.</p>'; return; }
    let html = '<table><thead><tr><th>ID</th><th>Source</th><th>Template</th><th>Prefix</th><th>Enabled</th><th>Description</th><th>Actions</th></tr></thead><tbody>';
    data.forEach(r => {
        const btnClass = r.enabled ? 'secondary' : '';
        const btnText = r.enabled ? 'Disable' : 'Enable';
        html += `<tr>
                    <td class="muted">${escapeHtml(r.id)}</td>
                    <td class="muted">${escapeHtml(r.source)}</td>
                    <td class="muted">${escapeHtml(r.template)}</td>
                    <td class="muted">${escapeHtml(r.prefix || '')}</td>
                    <td class="muted">${r.enabled ? 'Yes' : 'No'}</td>
                    <td class="muted">${escapeHtml(r.description || '')}</td>
                    <td class="actions"><button data-edit="${escapeHtml(r.id)}">Edit</button><button data-toggle="${escapeHtml(r.id)}" class="${btnClass}">${btnText}</button><button data-delete="${escapeHtml(r.id)}" class="secondary">Delete</button></td>
                </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-edit]').forEach(b => b.addEventListener('click', () => editAutoRule(b.dataset.edit)));
    c.querySelectorAll('button[data-toggle]').forEach(b => b.addEventListener('click', () => toggleAutoRule(b.dataset.toggle)));
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deleteAutoRule(b.dataset.delete)));
}

function editAutoRule(id) {
    const r = state.autoRules.find(x => x.id === id); if (!r) return;
    $('aId').value = r.id; $('aSource').value = r.source; $('aTemplate').value = r.template;
    $('aPrefix').value = r.prefix || ''; $('aEnabled').checked = r.enabled; $('aDesc').value = r.description || '';
}

async function deleteAutoRule(id) { if (!confirm('Delete auto rule ' + id + '?')) return; try { await api('auto_rule', 'DELETE', { id }); toast('Deleted', 'success'); loadAutoRules(); } catch (e) { showError(e.message); } }

async function toggleAutoRule(id) {
    const r = state.autoRules.find(x => x.id === id); if (!r) return;
    try {
        await api('auto_rules', 'POST', { id: r.id, source: r.source, template: r.template, prefix: r.prefix || '', enabled: !r.enabled, description: r.description || '' });
        toast(r.enabled ? 'Disabled' : 'Enabled', 'success');
        loadAutoRules();
    } catch (e) { showError(e.message); }
}

async function saveAutoRule(e) {
    e.preventDefault(); $('aError').textContent = '';
    const template = $('aTemplate').value.trim();
    if (!template.includes('{value}')) { $('aError').textContent = 'Template must contain {value}'; return; }
    const payload = { id: $('aId').value.trim(), source: $('aSource').value, template, prefix: $('aPrefix').value.trim(), enabled: $('aEnabled').checked, description: $('aDesc').value.trim() };
    if (!payload.id || !payload.source) { $('aError').textContent = 'ID and source are required'; return; }
    try { await api('auto_rules', 'POST', payload); toast('Saved', 'success'); $('autoForm').reset(); $('aEnabled').checked = true; loadAutoRules(); }
    catch (err) { $('aError').textContent = err.message; showError(err.message); }
}

async function loadAutoRuns() {
    try { const d = await api('auto_runs'); state.autoRuns = d.data || []; renderAutoRuns(); } catch (e) { showError(e.message); }
}

function renderAutoRuns() {
    const c = $('autoRunsList');
    const data = state.autoRuns || [];
    if (!data.length) { c.innerHTML = '<p class="empty">No runs.</p>'; return; }
    let html = '<table><thead><tr><th>Run ID</th><th>Cluster</th><th>Dry run</th><th>Changed</th><th>Failed</th><th>Time</th></tr></thead><tbody>';
    data.forEach(r => {
        html += `<tr>
                    <td class="muted">${escapeHtml(r.run_id)}</td>
                    <td class="muted">${escapeHtml(r.cluster_id)}</td>
                    <td class="muted">${r.dry_run ? 'Yes' : 'No'}</td>
                    <td class="muted">${r.changed_vms || 0}</td>
                    <td class="muted">${r.failed_vms || 0}</td>
                    <td class="muted">${new Date(r.created_at).toLocaleString()}</td>
                </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
}

async function runAutoTags(dryRun) {
    const cid = $('aCluster').value;
    if (!cid) { showError('Select a cluster first'); return; }
    const enabled = (state.autoRules || []).filter(r => r.enabled).length;
    if (!enabled) { showError('Enable at least one auto tag rule first'); return; }
    try {
        const d = await api('auto_tag', 'POST', { cluster_id: cid, dry_run: dryRun });
        showAutoRun(d);
        loadAutoRuns();
    } catch (e) { showError(e.message); }
}

function showAutoRun(d) {
    const c = $('autoRunResult');
    const vms = d.vms_count !== undefined ? d.vms_count : '?';
    const total = d.resources_total !== undefined ? d.resources_total : '?';
    const types = (d.resource_types || []).join(', ') || 'none';
    const error = d.discovery_error ? `<br><span class="error-text">PVE error: ${escapeHtml(d.discovery_error)}</span>` : '';
    const resultData = d.results || [];
    const noResults = !resultData.length;
    const hints = {};
    let html = `<p class="message ${d.failed_vms ? 'error' : 'success'}">${escapeHtml(d.message || '')} <span class="muted">(VMs found: ${vms}, PVE resources: ${total}, types: ${escapeHtml(types)}, applied: ${d.changed_vms || 0}, failed: ${d.failed_vms || 0})</span>${error}</p>`;
    if (noResults) { c.innerHTML = DOMPurify.sanitize(html); return; }
    html += '<table><thead><tr><th>VM</th><th>Status</th><th>New tags</th><th>Changes</th><th>Error</th><th>Help</th></tr></thead><tbody>';
    resultData.forEach(r => {
        const statusClass = r.status === 'failed' ? 'danger' : (r.status === 'planned' ? 'warning' : (r.status === 'unchanged' ? '' : 'success'));
        const statusLabel = r.status === 'planned' ? (d.dry_run ? 'Preview' : 'Planned') : r.status;
        const changes = (r.changes || []).map(x => `${escapeHtml(x.rule_id)}: ${x.old ? escapeHtml(x.old) + ' &rarr; ' : ''}${escapeHtml(x.new)}`).join('<br>');
        if (r.error) { hints[r.vmid] = r.fix_hint || 'No guidance available for this error.'; }
        const helpButton = r.error ? `<button type="button" class="secondary hint" data-vmid="${escapeHtml(String(r.vmid))}">Fix Helper</button>` : '<span class="muted">-</span>';
        html += `<tr>
                    <td class="muted">${escapeHtml(r.name)} (${escapeHtml(r.vmid)})</td>
                    <td class="muted"><span class="badge ${statusClass}">${escapeHtml(statusLabel)}</span></td>
                    <td class="muted">${(r.new_tags || []).map(escapeHtml).join(', ')}</td>
                    <td class="muted">${changes}</td>
                    <td class="muted">${escapeHtml(r.error || '')}</td>
                    <td>${helpButton}</td>
                </tr>`;
    });
    html += '</tbody></table>';
    c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button.hint').forEach(b => b.addEventListener('click', () => showFixHint(hints[b.dataset.vmid])));
}

function updateScheduleForm() {
    const type = $('schedType').value;
    $('schedIntervalLabel').hidden = type !== 'interval';
    $('schedDailyLabel').hidden = type !== 'daily';
    $('schedOnceLabel').hidden = type !== 'once';
}

async function loadSchedules() {
    try { const d = await api('schedules'); state.schedules = d.schedules || []; renderSchedules(); } catch (e) { showError(e.message); }
}

function renderSchedules() {
    const c = $('schedulesList');
    const data = state.schedules || [];
    if (!data.length) { c.innerHTML = '<p class="empty">No schedules.</p>'; return; }
    let html = '<table><thead><tr><th>Name</th><th>Cluster</th><th>Mode</th><th>Type</th><th>Next run</th><th>Last run</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    data.forEach(s => {
        const mode = s.dry_run ? 'Preview' : 'Apply';
        const statusClass = s.enabled ? 'success' : '';
        const statusLabel = s.enabled ? 'Enabled' : 'Disabled';
        const next = s.next_run ? new Date(s.next_run).toLocaleString() : '-';
        const last = s.last_run ? new Date(s.last_run).toLocaleString() : '-';
        const error = s.last_error ? `<br><span class="error-text">${escapeHtml(s.last_error)}</span>` : '';
        html += `<tr>
                    <td class="muted">${escapeHtml(s.name)}</td>
                    <td class="muted">${escapeHtml(s.cluster_id)}</td>
                    <td class="muted">${mode}</td>
                    <td class="muted">${escapeHtml(s.schedule_type)}</td>
                    <td class="muted">${next}</td>
                    <td class="muted">${last}</td>
                    <td class="muted"><span class="badge ${statusClass}">${statusLabel}</span>${error}</td>
                    <td class="actions"><button data-toggle="${escapeHtml(s.id)}">${s.enabled ? 'Disable' : 'Enable'}</button><button data-delete="${escapeHtml(s.id)}" class="secondary">Delete</button></td>
                </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-toggle]').forEach(b => b.addEventListener('click', () => toggleSchedule(b.dataset.toggle)));
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deleteSchedule(b.dataset.delete)));
}

async function saveSchedule(e) {
    e.preventDefault(); $('schedError').textContent = '';
    const type = $('schedType').value;
    const payload = {
        name: $('schedName').value.trim(),
        cluster_id: $('schedCluster').value,
        dry_run: $('schedMode').value === 'preview',
        schedule_type: type,
        interval_minutes: parseInt($('schedInterval').value, 10) || 60,
        daily_time: $('schedDaily').value,
        run_at: $('schedOnce').value,
        start_at: $('schedStartAt').value,
        end_at: $('schedEndAt').value,
        description: $('schedDesc').value.trim(),
    };
    if (!payload.name) { $('schedError').textContent = 'Name is required'; return; }
    if (!payload.cluster_id) { $('schedError').textContent = 'Cluster is required'; return; }
    try { await api('schedules', 'POST', payload); toast('Schedule saved', 'success'); $('scheduleForm').reset(); updateScheduleForm(); loadSchedules(); } catch (e) { $('schedError').textContent = e.message; showError(e.message); }
}

async function toggleSchedule(id) {
    try { await api('schedule_toggle', 'POST', { id }); toast('Toggled', 'success'); loadSchedules(); } catch (e) { showError(e.message); }
}

async function deleteSchedule(id) {
    if (!confirm('Delete schedule ' + id + '?')) return;
    try { await api('schedule', 'DELETE', { id }); toast('Deleted', 'success'); loadSchedules(); } catch (e) { showError(e.message); }
}

function switchTab(name) {
    state.tab = name;
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name));
    // Refresh the VM list when entering the Validate tab so the dropdown is current.
    if (name === 'validate') { loadVms(); }
    if (name === 'auto') { loadAutoRules(); loadAutoRuns(); }
    if (name === 'schedules') { loadSchedules(); }
    if (name === 'history') { loadHistory(); }
}

function wireEvents() {
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    $('ruleForm').addEventListener('submit', saveRule);
    $('rReset').addEventListener('click', () => { $('ruleForm').reset(); $('rRequired').checked = true; });
    $('rFilter').addEventListener('input', renderRules);
    $('rLevelFilter').addEventListener('change', renderRules);
    $('rRequiredFilter').addEventListener('change', renderRules);
    $('vForm').addEventListener('submit', doValidate);
    $('vCluster').addEventListener('change', loadVms);
    $('sForm').addEventListener('submit', doScan);
    $('exportCsv').addEventListener('click', doExportCsv);
    $('exportJson').addEventListener('click', doExportJson);
    $('autoForm').addEventListener('submit', saveAutoRule);
    $('aReset').addEventListener('click', () => { $('autoForm').reset(); $('aEnabled').checked = true; });
    $('autoRunForm').addEventListener('submit', (e) => { e.preventDefault(); runAutoTags(true); });
    $('aApply').addEventListener('click', () => runAutoTags(false));
    $('scheduleForm').addEventListener('submit', saveSchedule);
    $('schedReset').addEventListener('click', () => { $('scheduleForm').reset(); updateScheduleForm(); });
    $('schedType').addEventListener('change', updateScheduleForm);
    $('fixModalClose').addEventListener('click', () => { $('fixModal').hidden = true; });
    $('fixModal').addEventListener('click', (e) => { if (!e.target.closest('.modal-content')) $('fixModal').hidden = true; });
}

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('vm-tag-enforcer', '/api/plugins/vm-tag-enforcer/i18n'); await loadStatus(); await loadClusters(); await loadRules(); await loadAutoRules(); await loadAutoRuns(); wireEvents(); })();
