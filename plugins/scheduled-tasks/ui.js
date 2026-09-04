/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/scheduled-tasks/ui.js
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
document.documentElement.setAttribute('data-theme', theme === 'corp-light' ? 'corp-light' : '');

const $ = (id) => document.getElementById(id);
const BASE = '/api/plugins/scheduled-tasks/api';

const i18n = window.parent && window.parent.ProxmoxVExI18n;
const tr = (k, p) => i18n ? i18n.getT('scheduled-tasks')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('scheduled-tasks', '/api/plugins/scheduled-tasks/i18n');
const resolve = (path, method, body) => {
    let b = body || {};
    let resolved = path;
    if (path === '/api/scheduled-tasks') {
        resolved = `${BASE}/tasks`;
    } else if (path === '/api/clusters') {
        resolved = `${BASE}/clusters`;
    } else if (path === '/api/scheduled-tasks/validate-cron') {
        resolved = `${BASE}/validate-cron`;
    } else if (path.startsWith('/api/scheduled-tasks/')) {
        const m = path.match(/^\/api\/scheduled-tasks\/([^\/]+)(?:\/([^\/]+))?$/);
        if (m) {
            const id = m[1];
            const sub = m[2] || '';
            b = { ...b, task_id: id };
            if (!sub) {
                resolved = `${BASE}/tasks`;
            } else if (['run', 'dry-run', 'clone', 'duplicate'].includes(sub)) {
                resolved = `${BASE}/${sub}`;
            } else if (sub === 'runs') {
                resolved = `${BASE}/runs?task_id=${encodeURIComponent(id)}`;
            }
        }
    } else if (path.startsWith('/api/clusters/')) {
        const m = path.match(/^\/api\/clusters\/([^\/]+)\/vms$/);
        if (m) resolved = `${BASE}/vms?cluster_id=${encodeURIComponent(m[1])}`;
    }
    return { resolved, body: b };
};
const api = async (path, method = 'GET', body = null) => {
    const { resolved, body: reqBody } = resolve(path, method, body);
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (Object.keys(reqBody).length > 0) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(reqBody); }
    const res = await fetch(resolved, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ? (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)) : `HTTP ${res.status}`);
    return data;
};

let _tasksCache = [];

function showMessage(text, type) {
    const m = $('message');
    m.innerHTML = DOMPurify.sanitize(`<div class="message ${type}">${escapeHtml(text)}</div>`);
    setTimeout(() => { m.innerHTML = ''; }, 5000);
}

function formatDate(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString(); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadClusters() {
    try {
        const data = await api('/api/clusters');
        const clusters = Array.isArray(data) ? data : (data.clusters || []);
        const select = $('clusterId');
        select.innerHTML = '<option value="">— select —</option>';
        (clusters || []).forEach(c => { const opt = document.createElement('option'); opt.value = c.id || c.cluster_id; opt.textContent = c.name || c.id || c.cluster_id; select.appendChild(opt); });
    } catch (e) { showMessage(tr('failedLoadClusters', { msg: e.message }), 'error'); }
}

async function loadVMs(clusterId) {
    const select = $('targetId');
    if (!clusterId) { select.innerHTML = '<option value="">' + tr('selectClusterFirst') + '</option>'; return; }
    select.innerHTML = '<option value="">— loading —</option>';
    try {
        const data = await api(`/api/clusters/${clusterId}/vms`);
        select.innerHTML = '<option value="">— none —</option>';
        (data.vms || []).forEach(v => { const opt = document.createElement('option'); opt.value = v.vmid; opt.textContent = `${v.vmid} - ${v.name || v.vmid} (${v.type || 'vm'})`; select.appendChild(opt); });
    } catch (e) { showMessage(tr('failedLoadVMs', { msg: e.message }), 'error'); }
}

async function validateCron() {
    const cron = $('scheduleCron').value.trim();
    $('cronDesc').textContent = '';
    if (!cron) return;
    try {
        const data = await api('/api/scheduled-tasks/validate-cron', 'POST', { schedule_cron: cron });
        $('cronDesc').textContent = data.valid ? (data.description || cron) : 'Invalid cron';
    } catch (err) { $('cronDesc').textContent = err.message; }
}

function _cronRange(start, end) {
    const out = [];
    for (let i = start; i <= end; i++) out.push(String(i));
    return out;
}

function buildCronBuilder() {
    const builder = $('cronBuilder');
    builder.innerHTML = '';
    const groups = [
        { id: 'cronMinute', label: 'Minute', values: ['*', '*/5', '*/15', '*/30'].concat(_cronRange(0, 59)) },
        { id: 'cronHour', label: 'Hour', values: ['*'].concat(_cronRange(0, 23)) },
        { id: 'cronDayOfMonth', label: 'Day of month', values: ['*'].concat(_cronRange(1, 31)) },
        { id: 'cronMonth', label: 'Month', values: ['*'].concat(_cronRange(1, 12)) },
        { id: 'cronDayOfWeek', label: 'Day of week', values: [['*', 'Any'], ['0', 'Sunday'], ['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday']] }
    ];
    groups.forEach(g => {
        const lbl = document.createElement('label');
        lbl.textContent = g.label;
        const sel = document.createElement('select');
        sel.id = g.id;
        g.values.forEach(v => {
            const opt = document.createElement('option');
            if (Array.isArray(v)) { opt.value = v[0]; opt.textContent = v[1]; }
            else { opt.value = v; opt.textContent = v === '*' ? 'Any' : v; }
            sel.appendChild(opt);
        });
        lbl.appendChild(sel);
        builder.appendChild(lbl);
        sel.addEventListener('change', updateCronFromBuilder);
    });
    const ids = ['cronMinute', 'cronHour', 'cronDayOfMonth', 'cronMonth', 'cronDayOfWeek'];
    $(ids[0]).value = '0';
    $(ids[1]).value = '2';
    $(ids[2]).value = '*';
    $(ids[3]).value = '*';
    $(ids[4]).value = '*';
    updateCronFromBuilder();
}

function updateCronFromBuilder() {
    const ids = ['cronMinute', 'cronHour', 'cronDayOfMonth', 'cronMonth', 'cronDayOfWeek'];
    const parts = ids.map(id => $(id).value);
    $('scheduleCron').value = parts.join(' ');
    validateCron();
}

function updateBuilderFromCron() {
    const cron = $('scheduleCron').value.trim();
    const parts = cron.split(/\s+/);
    if (parts.length !== 5) return;
    const ids = ['cronMinute', 'cronHour', 'cronDayOfMonth', 'cronMonth', 'cronDayOfWeek'];
    ids.forEach((id, i) => {
        const sel = $(id);
        const val = parts[i];
        if (!Array.from(sel.options).some(o => o.value === val)) {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            sel.insertBefore(opt, sel.firstChild);
        }
        sel.value = val;
    });
}

function updateActionFields() {
    const action = $('action').value;
    $('pluginRouteLabel').classList.toggle('hidden', action !== 'plugin_route');
    $('webhookUrlLabel').classList.toggle('hidden', action !== 'webhook');
    $('shellCommandLabel').classList.toggle('hidden', action !== 'shell_command');
}

function collectParams() {
    const action = $('action').value;
    const params = {};
    if (action === 'plugin_route') params.route = $('pluginRoute').value;
    if (action === 'webhook') params.url = $('webhookUrl').value;
    if (action === 'shell_command') params.command = $('shellCommand').value;
    return params;
}

function populateForm(task) {
    $('taskId').value = task.id || '';
    $('name').value = task.name || '';
    $('action').value = task.action || '';
    $('clusterId').value = task.cluster_id || '';
    loadVMs(task.cluster_id).then(() => { $('targetId').value = task.target_id || ''; });
    $('targetNode').value = task.target_node || '';
    $('enabled').checked = !!task.enabled;
    $('description').value = task.description || '';
    $('scheduleCron').value = task.schedule_cron || '';
    $('retryCount').value = task.retry_count ?? 0;
    $('retryDelay').value = task.retry_delay ?? 0;
    $('timeout').value = task.timeout ?? 300;
    $('notification').value = task.notification || 'never';
    if (task.action_params) {
        $('pluginRoute').value = task.action_params.route || '';
        $('webhookUrl').value = task.action_params.url || '';
        $('shellCommand').value = task.action_params.command || '';
    }
    $('formTitle').textContent = tr('editTask');
    $('saveBtn').textContent = tr('update');
    $('cancelEdit').classList.remove('hidden');
    updateActionFields();
    updateBuilderFromCron();
    validateCron();
}

function resetForm() {
    $('taskForm').reset();
    $('taskId').value = '';
    $('formTitle').textContent = tr('createTask');
    $('saveBtn').textContent = tr('create');
    $('cancelEdit').classList.add('hidden');
    $('targetId').innerHTML = '<option value="">— select cluster first —</option>';
    $('scheduleCron').value = '0 2 * * *';
    updateBuilderFromCron();
    validateCron();
    updateActionFields();
}

function updateHistorySelect() {
    const select = $('historyTaskSelect');
    select.innerHTML = '<option value="">' + tr('selectTask') + '</option>';
    _tasksCache.forEach(t => { const opt = document.createElement('option'); opt.value = t.id; opt.textContent = `${t.name} (${t.id})`; select.appendChild(opt); });
}

function updateFilterActions() {
    const actions = [...new Set(_tasksCache.map(t => t.action).filter(Boolean))].sort();
    const select = $('filterAction');
    select.innerHTML = '<option value="">' + tr('allActions') + '</option>';
    actions.forEach(a => { const opt = document.createElement('option'); opt.value = a; opt.textContent = a; select.appendChild(opt); });
}

function renderTasks(tasks) {
    const list = $('tasksList');
    if (!tasks.length) { list.innerHTML = '<p class="empty">' + tr('noTasksMatch') + '</p>'; return; }
    let html = '<table><thead><tr><th><input type="checkbox" id="selectAll" title="Select all"></th><th data-sort="id">ID</th><th data-sort="name">Name</th><th data-sort="action">Action</th><th>Schedule</th><th data-sort="enabled">Enabled</th><th data-sort="next_run">Next Run</th><th data-sort="last_run">Last Run</th><th></th></tr></thead><tbody>';
    tasks.forEach(t => {
        const enabled = t.enabled ? 'on' : 'off';
        const human = t.schedule_human || t.schedule_cron || '';
        html += `<tr data-id="${escapeHtml(t.id)}">
                    <td><input type="checkbox" class="task-select" data-id="${escapeHtml(t.id)}"></td>
                    <td class="muted">${escapeHtml(t.id)}</td>
                    <td>${escapeHtml(t.name)}</td>
                    <td class="muted">${escapeHtml(t.action)}</td>
                    <td class="muted" title="${escapeHtml(t.schedule_cron || '')}">${escapeHtml(human)}</td>
                    <td><button type="button" class="secondary" data-action="toggle" data-id="${escapeHtml(t.id)}"><span class="badge ${enabled}">${t.enabled ? tr('yes') : tr('no')}</span></button></td>
                    <td class="muted">${escapeHtml(formatDate(t.next_run))}</td>
                    <td class="muted">${escapeHtml(formatDate(t.last_run))}</td>
                    <td class="row-actions">
                        <button type="button" class="secondary" data-action="edit" data-id="${escapeHtml(t.id)}">${tr('edit')}</button>
                        <button type="button" class="secondary" data-action="run" data-id="${escapeHtml(t.id)}">${tr('run')}</button>
                        <button type="button" class="secondary" data-action="dry" data-id="${escapeHtml(t.id)}">${tr('dry')}</button>
                        <button type="button" class="secondary" data-action="clone" data-id="${escapeHtml(t.id)}">${tr('clone')}</button>
                        <button type="button" class="secondary" data-action="dup" data-id="${escapeHtml(t.id)}">${tr('dup')}</button>
                        <button type="button" class="secondary" data-action="delete" data-id="${escapeHtml(t.id)}">${tr('delete')}</button>
                    </td>
                </tr>`;
    });
    html += '</tbody></table>';
    list.innerHTML = DOMPurify.sanitize(html);

    list.querySelectorAll('button[data-action]').forEach(b => b.addEventListener('click', async (e) => {
        const id = e.target.closest('button').dataset.id;
        const action = e.target.closest('button').dataset.action;
        const task = _tasksCache.find(x => x.id === id);
        if (action === 'edit') { if (task) populateForm(task); }
        else if (action === 'toggle') { await toggleEnabled(id, task); }
        else if (action === 'run') { await runTask(id); }
        else if (action === 'dry') { await dryTask(id); }
        else if (action === 'clone') { await cloneTask(id); }
        else if (action === 'dup') { await dupTask(id); }
        else if (action === 'delete') { await deleteTask(id); }
    }));

    list.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
        const sortBy = th.dataset.sort;
        if (_sortBy === sortBy) { _sortDesc = !_sortDesc; } else { _sortBy = sortBy; _sortDesc = false; }
        $('sortBy').value = _sortBy;
        applyFilters();
    }));

    $('selectAll').addEventListener('change', (e) => {
        list.querySelectorAll('.task-select').forEach(cb => cb.checked = e.target.checked);
    });
}

let _sortBy = 'name';
let _sortDesc = false;

function applyFilters() {
    let filtered = _tasksCache.slice();
    const search = $('searchInput').value.toLowerCase();
    const action = $('filterAction').value;
    const enabled = $('filterEnabled').value;

    if (search) filtered = filtered.filter(t => (t.name || '').toLowerCase().includes(search));
    if (action) filtered = filtered.filter(t => t.action === action);
    if (enabled !== '') filtered = filtered.filter(t => String(t.enabled) === enabled);

    const sortKey = _sortBy;
    filtered.sort((a, b) => {
        let av = a[sortKey] || '';
        let bv = b[sortKey] || '';
        if (sortKey === 'next_run' || sortKey === 'last_run') { av = av || '9999'; bv = bv || '9999'; }
        if (typeof av === 'string' ? av.toLowerCase() < (typeof bv === 'string' ? bv.toLowerCase() : bv) : av < bv) return _sortDesc ? 1 : -1;
        if (av > bv) return _sortDesc ? -1 : 1;
        return 0;
    });

    renderTasks(filtered);
}

function updateStatusBar() {
    const total = _tasksCache.length;
    const enabled = _tasksCache.filter(t => t.enabled).length;
    const disabled = total - enabled;
    const dueSoon = _tasksCache.filter(t => t.enabled && t.next_run && new Date(t.next_run) - new Date() < 24 * 60 * 60 * 1000).length;
    const failed = _tasksCache.filter(t => t.last_run && !t.enabled).length; // simplistic
    $('statusBar').innerHTML = DOMPurify.sanitize(`
                <span class="badge">Total: ${total}</span>
                <span class="badge on">Enabled: ${enabled}</span>
                <span class="badge off">Disabled: ${disabled}</span>
                <span class="badge running">Due &lt; 24h: ${dueSoon}</span>
            `);
}

async function loadTasks() {
    try {
        const data = await api('/api/scheduled-tasks');
        _tasksCache = data.tasks || [];
        updateHistorySelect();
        updateFilterActions();
        updateStatusBar();
        applyFilters();
    } catch (e) {
        $('tasksList').innerHTML = '<p class="empty">' + tr('errorLoadingTasks') + '</p>';
        showMessage(tr('failedLoadTasks', { msg: e.message }), 'error');
        $('status').textContent = tr('errorStatus');
        $('status').classList.add('error');
    }
}

async function toggleEnabled(id, task) {
    if (!task) return;
    try {
        await api(`/api/scheduled-tasks/${id}`, 'PUT', { enabled: !task.enabled });
        showMessage(tr(task.enabled ? 'taskDisabled' : 'taskEnabled'), 'success');
        await loadTasks();
    } catch (e) { showMessage(tr('error', { msg: e.message }), 'error'); }
}

async function runTask(id) {
    try {
        await api(`/api/scheduled-tasks/${id}/run`, 'POST');
        showMessage(tr('taskStarted'), 'success');
        $('historyTaskSelect').value = id;
        await loadHistory();
        await loadTasks();
    } catch (e) { showMessage(tr('error', { msg: e.message }), 'error'); }
}

async function dryTask(id) {
    try {
        await api(`/api/scheduled-tasks/${id}/dry-run`, 'POST');
        showMessage(tr('dryRunCompleted'), 'success');
        $('historyTaskSelect').value = id;
        await loadHistory();
    } catch (e) { showMessage(tr('error', { msg: e.message }), 'error'); }
}

async function cloneTask(id) {
    try {
        await api(`/api/scheduled-tasks/${id}/clone`, 'POST');
        showMessage(tr('taskCloned'), 'success');
        await loadTasks();
    } catch (e) { showMessage(tr('error', { msg: e.message }), 'error'); }
}

async function dupTask(id) {
    const target = prompt(tr('duplicatePrompt'));
    if (!target) return;
    try {
        await api(`/api/scheduled-tasks/${id}/duplicate`, 'POST', { target_cluster_id: target });
        showMessage(tr('taskDuplicated', { target }), 'success');
        await loadTasks();
    } catch (e) { showMessage(tr('error', { msg: e.message }), 'error'); }
}

async function deleteTask(id) {
    if (!confirm(tr('deleteTaskConfirm'))) return;
    try {
        await api(`/api/scheduled-tasks/${id}`, 'DELETE');
        showMessage(tr('taskDeleted'), 'success');
        await loadTasks();
    } catch (e) { showMessage(tr('error', { msg: e.message }), 'error'); }
}

function getSelectedIds() {
    return [...document.querySelectorAll('.task-select:checked')].map(cb => cb.dataset.id);
}

async function bulkAction(type) {
    const ids = getSelectedIds();
    if (!ids.length) { showMessage(tr('noTasksSelected'), 'error'); return; }
    if (type === 'delete' && !confirm(tr('bulkDeleteConfirm', { count: ids.length }))) return;

    for (const id of ids) {
        const task = _tasksCache.find(t => t.id === id);
        try {
            if (type === 'delete') {
                await api(`/api/scheduled-tasks/${id}`, 'DELETE');
            } else if (type === 'enable' || type === 'disable') {
                await api(`/api/scheduled-tasks/${id}`, 'PUT', { enabled: type === 'enable' });
            }
        } catch (e) { showMessage(tr('bulkFailed', { action: type, id, msg: e.message }), 'error'); }
    }
    showMessage(tr('bulkApplied', { action: type }), 'success');
    await loadTasks();
}

function exportTasks(tasks) {
    const data = JSON.stringify(tasks, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scheduled-tasks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

async function importTasks(text) {
    let tasks;
    try {
        tasks = JSON.parse(text);
    } catch (e) { showMessage(tr('invalidJson'), 'error'); return; }
    if (!Array.isArray(tasks)) { showMessage(tr('importArrayRequired'), 'error'); return; }
    for (const t of tasks) {
        try {
            const body = { ...t };
            delete body.id;
            body.name = (body.name || 'imported') + ' (imported)';
            body.enabled = false;
            await api('/api/scheduled-tasks', 'POST', body);
        } catch (e) { showMessage(tr('importFailed', { name: t.name, msg: e.message }), 'error'); }
    }
    showMessage(tr('importCompleted'), 'success');
    await loadTasks();
}

async function loadHistory() {
    const taskId = $('historyTaskSelect').value;
    const list = $('historyList');
    if (!taskId) { list.innerHTML = '<p class="empty">' + tr('selectTaskHistory') + '</p>'; return; }
    list.innerHTML = '<p class="empty loading">' + tr('loading') + '</p>';
    try {
        const data = await api(`/api/scheduled-tasks/${taskId}/runs`);
        const runs = data.runs || [];
        if (!runs.length) { list.innerHTML = '<p class="empty">' + tr('noRunsForTask') + '</p>'; return; }
        let html = '<table><thead><tr><th>Run ID</th><th>Started</th><th>Duration</th><th>Status</th><th>Output / Error</th></tr></thead><tbody>';
        runs.forEach(r => {
            const status = r.status || 'unknown';
            let badge = 'info';
            if (status === 'success') badge = 'on';
            if (status === 'failed') badge = 'off';
            if (status === 'running') badge = 'running';
            const detail = r.error || r.output || '—';
            html += `<tr>
                        <td class="muted">${escapeHtml(r.run_id)}</td>
                        <td>${escapeHtml(formatDate(r.started_at))}</td>
                        <td class="muted">${escapeHtml((r.duration ?? 0).toFixed(2))}s</td>
                        <td><span class="badge ${badge}">${escapeHtml(status)}</span></td>
                        <td class="muted">${escapeHtml(detail)}</td>
                    </tr>`;
        });
        html += '</tbody></table>';
        list.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { list.innerHTML = '<p class="empty">' + tr('errorLoadingHistory') + '</p>'; showMessage(tr('error', { msg: e.message }), 'error'); }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (i18n) await i18n.loadPluginNamespaceFull('scheduled-tasks', '/api/plugins/scheduled-tasks/i18n');
    buildCronBuilder();
    loadClusters().then(loadTasks).then(() => { $('status').textContent = tr('ready'); });

    $('action').addEventListener('change', updateActionFields);
    $('clusterId').addEventListener('change', (e) => loadVMs(e.target.value));
    $('scheduleCron').addEventListener('input', () => { setTimeout(() => { updateBuilderFromCron(); validateCron(); }, 300); });

    document.querySelectorAll('.presets button').forEach(b => b.addEventListener('click', (e) => {
        $('scheduleCron').value = e.target.dataset.cron;
        updateBuilderFromCron();
        validateCron();
    }));

    $('cancelEdit').addEventListener('click', resetForm);
    $('loadHistory').addEventListener('click', loadHistory);

    $('bulkApply').addEventListener('click', () => { const a = $('bulkAction').value; if (a) bulkAction(a); });
    $('exportAll').addEventListener('click', () => exportTasks(_tasksCache));
    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => importTasks(ev.target.result);
        reader.readAsText(file);
        e.target.value = '';
    });

    $('searchInput').addEventListener('input', () => { setTimeout(applyFilters, 200); });
    $('filterAction').addEventListener('change', applyFilters);
    $('filterEnabled').addEventListener('change', applyFilters);
    $('sortBy').addEventListener('change', (e) => { _sortBy = e.target.value; _sortDesc = false; applyFilters(); });

    $('taskForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('taskId').value;
        const body = {
            name: $('name').value,
            action: $('action').value,
            cluster_id: $('clusterId').value,
            target_id: $('targetId').value,
            target_node: $('targetNode').value,
            enabled: $('enabled').checked,
            description: $('description').value,
            schedule_cron: $('scheduleCron').value,
            retry_count: parseInt($('retryCount').value, 10) || 0,
            retry_delay: parseInt($('retryDelay').value, 10) || 0,
            timeout: parseInt($('timeout').value, 10) || 300,
            notification: $('notification').value,
            action_params: collectParams(),
        };
        try {
            if (id) {
                await api(`/api/scheduled-tasks/${id}`, 'PUT', body);
                showMessage(tr('taskUpdated'), 'success');
            } else {
                await api('/api/scheduled-tasks', 'POST', body);
                showMessage(tr('taskCreated'), 'success');
            }
            resetForm();
            await loadTasks();
        } catch (err) { showMessage(tr('error', { msg: err.message }), 'error'); }
    });
});
