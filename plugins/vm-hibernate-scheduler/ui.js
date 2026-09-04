/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/vm-hibernate-scheduler/ui.js
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
document.documentElement.setAttribute('data-theme', theme);

const $ = (id) => document.getElementById(id);

const i18n = window.parent && window.parent.ProxmoxVExI18n;
const t = (k, p) => i18n ? i18n.getT('vm-hibernate-scheduler')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('vm-hibernate-scheduler', '/api/plugins/vm-hibernate-scheduler/i18n');

const state = {
    tab: 'schedules',
    clusters: [],
    vms: [],
    schedules: [],
    scheduleTotal: 0,
    runs: [],
    runTotal: 0,
    audit: [],
    form: { id: '', cluster_id: '', action: 'hibernate', targets: [], cron: '', one_time: '', timezone: 'UTC', enabled: 'true', description: '', tags: '', exclusion_windows: [] },
    editing: null,
    selectedIds: new Set(),
    scheduleFilters: { action: '', cluster_id: '', tag: '', status: '', sort: 'next_run', order: 'asc', page: 1, limit: 10 },
    historyFilters: { schedule_id: '', action: '', status: '', page: 1, limit: 10 },
    vmCluster: '',
    vmSearch: '',
    vmStatus: ''
};

async function api(path, method = 'GET', body = null) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

function parentNotify(message, type = 'success') {
    if (window.parent && window.parent.ProxmoxVExNotify) {
        try { window.parent.ProxmoxVExNotify({ message, type, source: 'vm-hibernate-scheduler' }); } catch (e) { }
    } else if (window.parent) {
        try { window.parent.postMessage({ type: 'ProxmoxVEx:notify', message, level: type, source: 'vm-hibernate-scheduler' }, '*'); } catch (e) { }
    }
}

function toast(msg, type = 'success') {
    parentNotify(msg, type);
    const d = $('toasts');
    const el = document.createElement('div');
    el.className = `message ${type}`;
    el.textContent = msg;
    d.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

function showError(msg) {
    toast(t('error', { msg }), 'error');
}

function showGlobalError(msg) {
    $('globalError').hidden = false;
    $('globalErrorText').textContent = msg;
}

function hideGlobalError() {
    $('globalError').hidden = true;
}

function setLoading(loading) {
    $('status').textContent = loading ? t('loading') : 'Running';
    $('status').classList.toggle('error', !loading);
}

async function loadStatus() {
    try {
        const s = await api('status');
        $('status').textContent = s.status === 'running' ? 'Running' : s.status;
        renderStats(s);
    } catch (e) {
        $('status').textContent = 'Error';
        $('status').classList.add('error');
        showError(e.message);
    }
}

function renderStats(s) {
    const enabled = state.schedules.filter(x => x.enabled).length;
    const disabled = state.schedules.length - enabled;
    const hibernated = s.hibernated_count || 0;
    const today = s.run_count || 0;
    $('stats').innerHTML = DOMPurify.sanitize(`
                <div class="stat"><div class="value">${state.schedules.length}</div><div class="label">${t('schedulesTitle')}</div></div>
                <div class="stat"><div class="value" style="color:var(--success)">${enabled}</div><div class="label">${t('enabled')}</div></div>
                <div class="stat"><div class="value" style="color:var(--warning)">${disabled}</div><div class="label">${t('enabledNo')}</div></div>
                <div class="stat"><div class="value">${today}</div><div class="label">${t('historyTitle')}</div></div>
                <div class="stat"><div class="value" style="color:var(--info)">${hibernated}</div><div class="label">${t('hibernated')}</div></div>
            `);
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadClusters() {
    try {
        const data = await api('clusters');
        state.clusters = data.data || [];
        const sel = $('clusterSelect');
        sel.innerHTML = DOMPurify.sanitize(`<option value="">${t('cluster')}</option>` + state.clusters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name || c.id)}</option>`).join(''));
        renderScheduleFilters();
        renderVmFilters();
    } catch (e) { showError(e.message); }
}

async function loadVms(clusterId) {
    if (!clusterId) {
        state.vms = [];
        renderVmPicker();
        return;
    }
    try {
        const data = await api(`vms?cluster_id=${encodeURIComponent(clusterId)}`);
        state.vms = data.data || [];
        if (state.editing && state.editing.cluster_id !== clusterId) state.form.targets = [];
        renderVmPicker();
    } catch (e) { showError(e.message); }
}

function renderVmPicker() {
    const list = $('vmList');
    if (!state.vms.length) { list.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noVms')}</p>`); return; }
    list.innerHTML = DOMPurify.sanitize(state.vms.map(vm => {
        const checked = state.form.targets.includes(String(vm.vmid)) ? 'checked' : '';
        return `<label><input type="checkbox" value="${escapeHtml(vm.vmid)}" ${checked}> ${escapeHtml(vm.name)} (${escapeHtml(vm.vmid)})</label>`;
    }).join(''));
    list.querySelectorAll('input').forEach(cb => cb.addEventListener('change', e => {
        const v = e.target.value;
        if (e.target.checked) state.form.targets.push(v);
        else state.form.targets = state.form.targets.filter(x => x !== v);
        updateImpact();
    }));
}

async function loadSchedules() {
    const f = state.scheduleFilters;
    const q = new URLSearchParams({ sort: f.sort, order: f.order, page: String(f.page), limit: String(f.limit) });
    if (f.action) q.set('action', f.action);
    if (f.cluster_id) q.set('cluster_id', f.cluster_id);
    if (f.tag) q.set('tag', f.tag);
    if (f.status) q.set('status', f.status);
    try {
        const data = await api(`schedules?${q}`);
        state.schedules = data.data || [];
        state.scheduleTotal = data.total || 0;
        renderSchedules();
        renderPagination('schedulePagination', state.scheduleTotal, f.page, f.limit, p => { state.scheduleFilters.page = p; loadSchedules(); });
    } catch (e) { showError(e.message); }
}

function renderSchedules() {
    const c = $('schedulesList');
    if (!state.schedules.length) { c.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noSchedules')}</p>`); return; }
    let html = `<table><thead><tr><th><input type="checkbox" id="selectAll" aria-label="${t('selectAll')}"></th>
                <th data-sort="id" tabindex="0" role="button">ID</th>
                <th data-sort="action" tabindex="0" role="button">${t('action')}</th>
                <th data-sort="cluster" tabindex="0" role="button">${t('cluster')}</th>
                <th data-sort="target_count" tabindex="0" role="button">${t('targetCount')}</th>
                <th data-sort="cron" tabindex="0" role="button">Cron</th>
                <th data-sort="next_run" tabindex="0" role="button">${t('nextRun')}</th>
                <th>${t('enabled')}</th>
                <th>${t('lastRun')}</th>
                <th>${t('actions')}</th>
            </tr></thead><tbody>`;
    state.schedules.forEach(s => {
        const last = s.last_run ? (s.last_run.status || '') : '-';
        const checked = state.selectedIds.has(s.id) ? 'checked' : '';
        html += `<tr data-id="${escapeHtml(s.id)}">
                    <td><input type="checkbox" class="row-check" value="${escapeHtml(s.id)}" ${checked}></td>
                    <td class="muted">${escapeHtml(s.id)}</td>
                    <td><span class="badge ${s.action === 'hibernate' ? '' : 'running'}">${escapeHtml(s.action)}</span></td>
                    <td class="muted">${escapeHtml(s.cluster_id)}</td>
                    <td class="muted">${escapeHtml(s.target_count)}</td>
                    <td class="muted" title="${escapeHtml(s.cron_description || '')}">${escapeHtml(s.cron || 'one-time')}</td>
                    <td class="muted">${s.next_run ? new Date(s.next_run).toLocaleString() : '-'}</td>
                    <td><button type="button" class="toggle-btn ${s.enabled ? '' : 'secondary'}" data-id="${escapeHtml(s.id)}">${s.enabled ? t('enabled') : t('enabledNo')}</button></td>
                    <td class="muted"><span class="badge ${last === 'failed' ? 'failed' : last === 'warning' ? 'warning' : ''}">${escapeHtml(last)}</span></td>
                    <td class="actions">
                        <button type="button" data-action="edit" data-id="${escapeHtml(s.id)}">${t('edit')}</button>
                        <button type="button" data-action="run" data-id="${escapeHtml(s.id)}">${t('run')}</button>
                        <button type="button" data-action="clone" data-id="${escapeHtml(s.id)}">${t('clone')}</button>
                        <button type="button" class="danger" data-action="delete" data-id="${escapeHtml(s.id)}">${t('delete')}</button>
                    </td>
                </tr>`;
    });
    html += `</tbody></table>
                <div class="btn-row" style="margin-top:12px;">
                    <button type="button" id="bulkEnable">${t('bulkEnable')}</button>
                    <button type="button" id="bulkDisable">${t('bulkDisable')}</button>
                    <button type="button" class="danger" id="bulkDelete">${t('bulkDelete')}</button>
                    <button type="button" id="exportBtn">${t('export')}</button>
                    <button type="button" id="importBtn">${t('import')}</button>
                </div>`;
    c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('[data-sort]').forEach(th => {
        th.addEventListener('click', () => sortSchedules(th.dataset.sort));
        th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortSchedules(th.dataset.sort); } });
    });
    c.querySelectorAll('.toggle-btn').forEach(b => b.addEventListener('click', () => toggleSchedule(b.dataset.id)));
    c.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => scheduleAction(b.dataset.action, b.dataset.id)));
    c.querySelectorAll('.row-check').forEach(cb => cb.addEventListener('change', () => updateSelection()));
    $('selectAll').addEventListener('change', () => {
        const checked = $('selectAll').checked;
        c.querySelectorAll('.row-check').forEach(cb => { cb.checked = checked; updateSelection(); });
    });
    $('bulkEnable').addEventListener('click', () => bulkToggle(true));
    $('bulkDisable').addEventListener('click', () => bulkToggle(false));
    $('bulkDelete').addEventListener('click', bulkDelete);
    $('exportBtn').addEventListener('click', doExport);
    $('importBtn').addEventListener('click', doImport);
}

function sortSchedules(col) {
    const f = state.scheduleFilters;
    if (f.sort === col) f.order = f.order === 'asc' ? 'desc' : 'asc';
    else { f.sort = col; f.order = 'asc'; }
    loadSchedules();
}

function updateSelection() {
    state.selectedIds.clear();
    document.querySelectorAll('.row-check:checked').forEach(cb => state.selectedIds.add(cb.value));
}

function renderScheduleFilters() {
    const c = $('scheduleFilters');
    c.innerHTML = DOMPurify.sanitize(`
                <select id="filterAction" aria-label="${t('filterAction')}">
                    <option value="">${t('all')}</option>
                    <option value="hibernate">${t('actionHibernate')}</option>
                    <option value="resume">${t('actionResume')}</option>
                </select>
                <select id="filterCluster" aria-label="${t('filterCluster')}">
                    <option value="">${t('all')}</option>
                    ${state.clusters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name || c.id)}</option>`).join('')}
                </select>
                <input type="text" id="filterTag" placeholder="${t('filterTag')}" aria-label="${t('filterTag')}" />
                <select id="filterStatus" aria-label="${t('filterStatus')}">
                    <option value="">${t('all')}</option>
                    <option value="enabled">${t('enabled')}</option>
                    <option value="disabled">${t('enabledNo')}</option>
                </select>
            `);
    $('filterAction').addEventListener('change', e => { state.scheduleFilters.action = e.target.value; state.scheduleFilters.page = 1; loadSchedules(); });
    $('filterCluster').addEventListener('change', e => { state.scheduleFilters.cluster_id = e.target.value; state.scheduleFilters.page = 1; loadSchedules(); });
    $('filterTag').addEventListener('input', e => { state.scheduleFilters.tag = e.target.value; state.scheduleFilters.page = 1; loadSchedules(); });
    $('filterStatus').addEventListener('change', e => { state.scheduleFilters.status = e.target.value; state.scheduleFilters.page = 1; loadSchedules(); });
}

async function scheduleAction(action, id) {
    const s = state.schedules.find(x => x.id === id);
    if (!s) return;
    if (action === 'edit') {
        state.editing = s;
        $('formTitle').textContent = t('editSchedule');
        $('scheduleId').value = s.id;
        $('clusterSelect').value = s.cluster_id;
        $('actionSelect').value = s.action;
        $('cronInput').value = s.cron || '';
        $('timezoneSelect').value = s.timezone || 'UTC';
        $('oneTimeInput').value = s.one_time ? s.one_time.slice(0, 16) : '';
        $('enabledSelect').value = String(s.enabled);
        $('descriptionInput').value = s.description || '';
        $('tagsInput').value = (s.tags || []).join(', ');
        state.form.targets = (s.targets || []).map(x => String(x.vmid));
        state.form.exclusion_windows = s.exclusion_windows || [];
        await loadVms(s.cluster_id);
        renderWindows();
        updateImpact();
        $('scheduleId').scrollIntoView({ behavior: 'smooth' });
        return;
    }
    if (action === 'run') {
        confirm(t('confirmRun', { action: s.action, count: s.target_count }), async () => {
            try { await api('schedules/trigger', 'POST', { id: s.id }); toast(t('runQueued'), 'success'); loadHistory(); loadStatus(); loadSchedules(); }
            catch (e) { showError(e.message); }
        });
        return;
    }
    if (action === 'clone') {
        try { await api('schedules/clone', 'POST', { id: s.id }); toast(t('cloneDone'), 'success'); loadSchedules(); }
        catch (e) { showError(e.message); }
        return;
    }
    if (action === 'delete') {
        confirm(t('confirmDelete', { id: s.id }), async () => {
            try { await api(`schedules/detail?id=${encodeURIComponent(s.id)}`, 'DELETE'); toast(t('deleteSuccess'), 'success'); loadSchedules(); }
            catch (e) { showError(e.message); }
        });
    }
}

async function toggleSchedule(id) {
    try { await api('schedules/toggle', 'POST', { id }); loadSchedules(); }
    catch (e) { showError(e.message); }
}

async function bulkToggle(enabled) {
    if (!state.selectedIds.size) { showError('No schedules selected'); return; }
    const path = enabled ? 'schedules/bulk-enable' : 'schedules/bulk-disable';
    try { await api(path, 'POST', { ids: Array.from(state.selectedIds) }); state.selectedIds.clear(); loadSchedules(); }
    catch (e) { showError(e.message); }
}

async function bulkDelete() {
    if (!state.selectedIds.size) { showError('No schedules selected'); return; }
    confirm(t('confirmBulkDelete', { count: state.selectedIds.size }), async () => {
        try { await api('schedules/bulk-delete', 'POST', { ids: Array.from(state.selectedIds) }); state.selectedIds.clear(); loadSchedules(); }
        catch (e) { showError(e.message); }
    });
}

function doExport() {
    window.location.href = 'export?format=json';
}

async function doImport() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        const text = await file.text();
        try {
            const data = JSON.parse(text);
            const res = await api('import', 'POST', data);
            toast(t('importDone') + (res.errors ? ` ${res.errors.length} errors` : ''), res.errors && res.errors.length ? 'warning' : 'success');
            loadSchedules(); loadHistory(); loadAudit();
        } catch (e) { showError(e.message); }
    };
    input.click();
}

async function loadHistory() {
    const f = state.historyFilters;
    const q = new URLSearchParams({ sort: 'timestamp', order: 'desc', page: String(f.page), limit: String(f.limit) });
    if (f.schedule_id) q.set('schedule_id', f.schedule_id);
    if (f.action) q.set('action', f.action);
    if (f.status) q.set('status', f.status);
    try {
        const data = await api(`runs?${q}`);
        state.runs = data.data || [];
        state.runTotal = data.total || 0;
        renderHistory();
        renderPagination('historyPagination', state.runTotal, f.page, f.limit, p => { state.historyFilters.page = p; loadHistory(); });
    } catch (e) { showError(e.message); }
}

function renderHistory() {
    const c = $('historyList');
    if (!state.runs.length) { c.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noRuns')}</p>`); return; }
    let html = `<table><thead><tr><th>Run ID</th><th>${t('scheduleId')}</th><th>${t('action')}</th><th>${t('status')}</th><th>${t('lastRun')}</th><th>${t('targetCount')}</th><th>${t('actions')}</th></tr></thead><tbody>`;
    state.runs.forEach(r => {
        html += `<tr>
                    <td class="muted">${escapeHtml(r.run_id.slice(0, 8))}</td>
                    <td class="muted">${escapeHtml(r.schedule_id || '-')}</td>
                    <td><span class="badge ${r.action === 'hibernate' ? '' : 'running'}">${escapeHtml(r.action)}</span></td>
                    <td><span class="badge ${r.status === 'failed' ? 'failed' : r.status === 'warning' ? 'warning' : r.status === 'dry-run' ? 'warning' : 'running'}">${escapeHtml(r.status === 'dry-run' ? t('statusDryRun') : t(r.status))}</span></td>
                    <td class="muted">${new Date(r.started_at).toLocaleString()}</td>
                    <td class="muted">${(r.targets || []).length}</td>
                    <td class="actions">
                        <button type="button" data-action="expand" data-id="${escapeHtml(r.run_id)}">Details</button>
                        ${r.status === 'failed' ? `<button type="button" data-action="retry" data-id="${escapeHtml(r.run_id)}">${t('retry')}</button>` : ''}
                    </td>
                </tr>`;
    });
    html += '</tbody></table>';
    c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('[data-action="expand"]').forEach(b => b.addEventListener('click', () => {
        const r = state.runs.find(x => x.run_id === b.dataset.id);
        if (!r) return;
        const targets = (r.targets || []).map(t => `<li>${escapeHtml(t.vmid)} ${escapeHtml(t.name)} → ${escapeHtml(t.result)}</li>`).join('');
        const err = r.error ? `<p style="color:var(--danger)">${escapeHtml(r.error)}</p>` : '';
        confirm(`<div><h3>${escapeHtml(r.run_id)}</h3>${err}<ul>${targets}</ul></div>`, null, true);
    }));
    c.querySelectorAll('[data-action="retry"]').forEach(b => b.addEventListener('click', async () => {
        try { await api('runs/retry', 'POST', { id: b.dataset.id }); toast(t('runQueued'), 'success'); loadHistory(); }
        catch (e) { showError(e.message); }
    }));
}

function renderHistoryFilters() {
    const c = $('historyFilters');
    c.innerHTML = DOMPurify.sanitize(`
                <select id="histAction" aria-label="${t('filterAction')}">
                    <option value="">${t('all')}</option>
                    <option value="hibernate">${t('actionHibernate')}</option>
                    <option value="resume">${t('actionResume')}</option>
                </select>
                <select id="histStatus" aria-label="${t('filterStatus')}">
                    <option value="">${t('all')}</option>
                    <option value="completed">${t('completed')}</option>
                    <option value="failed">${t('failed')}</option>
                    <option value="warning">${t('warning')}</option>
                    <option value="dry-run">${t('dryRun')}</option>
                </select>
            `);
    $('histAction').addEventListener('change', e => { state.historyFilters.action = e.target.value; state.historyFilters.page = 1; loadHistory(); });
    $('histStatus').addEventListener('change', e => { state.historyFilters.status = e.target.value; state.historyFilters.page = 1; loadHistory(); });
}

async function loadVmStatus() {
    if (!state.vmCluster) { $('vmStatusList').innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noVms')}</p>`); return; }
    const q = new URLSearchParams({ cluster_id: state.vmCluster });
    if (state.vmSearch) q.set('search', state.vmSearch);
    if (state.vmStatus) q.set('status', state.vmStatus);
    try {
        const data = await api(`vm-status?${q}`);
        const vms = data.data || [];
        const c = $('vmStatusList');
        if (!vms.length) { c.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noVms')}</p>`); return; }
        let html = `<table><thead><tr><th>VMID</th><th>${t('name')}</th><th>Node</th><th>${t('status')}</th></tr></thead><tbody>`;
        vms.forEach(vm => {
            html += `<tr>
                        <td class="muted">${escapeHtml(vm.vmid)}</td>
                        <td>${escapeHtml(vm.name)}</td>
                        <td class="muted">${escapeHtml(vm.node)}</td>
                        <td><span class="badge ${vm.status === 'hibernated' ? 'hibernated' : vm.status === 'running' ? 'running' : ''}">${escapeHtml(vm.status)}</span></td>
                    </tr>`;
        });
        html += `</tbody></table>`;
        c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showError(e.message); }
}

function renderVmFilters() {
    const c = $('vmStatusFilters');
    c.innerHTML = DOMPurify.sanitize(`
                <select id="vmClusterSelect" aria-label="${t('cluster')}">
                    <option value="">${t('cluster')}</option>
                    ${state.clusters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name || c.id)}</option>`).join('')}
                </select>
                <input type="text" id="vmSearch" placeholder="${t('search')}" aria-label="${t('search')}" />
                <select id="vmStatusSelect" aria-label="${t('filterStatus')}">
                    <option value="">${t('all')}</option>
                    <option value="running">${t('running')}</option>
                    <option value="hibernated">${t('hibernated')}</option>
                </select>
            `);
    $('vmClusterSelect').addEventListener('change', e => { state.vmCluster = e.target.value; loadVmStatus(); });
    $('vmSearch').addEventListener('input', e => { state.vmSearch = e.target.value; loadVmStatus(); });
    $('vmStatusSelect').addEventListener('change', e => { state.vmStatus = e.target.value; loadVmStatus(); });
}

function renderCalendar() {
    const c = $('calendarList');
    if (!state.schedules.length) { c.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('calendarNoEvents')}</p>`); return; }
    const now = new Date();
    const events = [];
    state.schedules.filter(s => s.enabled).forEach(s => {
        const run = s.next_run ? new Date(s.next_run) : null;
        if (run && run >= now) events.push({
            date: run,
            title: s.id,
            action: s.action,
            targets: s.target_count || (s.targets || []).length,
            oneTime: false
        });
        if (s.one_time) {
            const ot = new Date(s.one_time);
            if (ot >= now) events.push({ date: ot, title: s.id, action: s.action, targets: s.target_count || (s.targets || []).length, oneTime: true });
        }
    });
    events.sort((a, b) => a.date - b.date);
    if (!events.length) { c.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('calendarNoEvents')}</p>`); return; }
    let html = `<div class="calendar-list">`;
    let lastDay = '';
    events.forEach(ev => {
        const day = ev.date.toLocaleDateString();
        const time = ev.date.toLocaleTimeString();
        if (day !== lastDay) {
            html += `<div class="calendar-day">${day === new Date().toLocaleDateString() ? t('calendarToday') + ' — ' : ''}<strong>${day}</strong></div>`;
            lastDay = day;
        }
        html += `<div class="calendar-event"><span class="badge ${ev.action === 'hibernate' ? '' : 'running'}">${escapeHtml(ev.action)}</span> <span class="muted">${time}</span> <span>${escapeHtml(ev.title)}</span> <span class="muted">(${ev.targets} VMs${ev.oneTime ? ', one-time' : ''})</span></div>`;
    });
    html += '</div>';
    c.innerHTML = DOMPurify.sanitize(html);
}

async function loadAudit() {
    try {
        const data = await api('audit?page=1&limit=50');
        state.audit = data.data || [];
        const c = $('auditList');
        if (!state.audit.length) { c.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noAudit')}</p>`); return; }
        let html = `<table><thead><tr><th>${t('lastRun')}</th><th>${t('actions')}</th><th>${t('scheduleId')}</th><th>Actor</th></tr></thead><tbody>`;
        state.audit.forEach(a => {
            html += `<tr>
                        <td class="muted">${new Date(a.timestamp).toLocaleString()}</td>
                        <td>${escapeHtml(a.event_type)}</td>
                        <td class="muted">${escapeHtml(a.schedule_id || '-')}</td>
                        <td class="muted">${escapeHtml(a.actor)}</td>
                    </tr>`;
        });
        html += '</tbody></table>';
        c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showError(e.message); }
}

function renderPagination(id, total, page, limit, cb) {
    const pages = Math.ceil(total / limit) || 1;
    let html = `<span>Page ${page} / ${pages}</span>`;
    if (page > 1) html += `<button type="button" class="secondary" id="${id}Prev">Prev</button>`;
    if (page < pages) html += `<button type="button" class="secondary" id="${id}Next">Next</button>`;
    const c = $(id);
    c.innerHTML = DOMPurify.sanitize(html);
    if ($(id + 'Prev')) $(id + 'Prev').addEventListener('click', () => cb(page - 1));
    if ($(id + 'Next')) $(id + 'Next').addEventListener('click', () => cb(page + 1));
}

function updateImpact() {
    const count = state.form.targets.length;
    const action = $('actionSelect').value;
    const c = $('impact');
    if (count === 0) { c.hidden = true; return; }
    c.hidden = false;
    $('impactText').innerHTML = DOMPurify.sanitize(`${count} VM(s) will be <strong>${action}</strong>`);
}

function renderWindows() {
    const c = $('windowsList');
    if (!state.form.exclusion_windows.length) { c.innerHTML = DOMPurify.sanitize(`<p class="empty muted">${t('noData')}</p>`); return; }
    c.innerHTML = DOMPurify.sanitize(state.form.exclusion_windows.map((w, i) => `
                <div class="window-row">
                    <input type="datetime-local" value="${(w.start || '').slice(0, 16)}" data-idx="${i}" data-field="start" />
                    <input type="datetime-local" value="${(w.end || '').slice(0, 16)}" data-idx="${i}" data-field="end" />
                    <input type="text" placeholder="Reason" value="${w.reason || ''}" data-idx="${i}" data-field="reason" />
                    <button type="button" class="danger" data-idx="${i}" data-del-window>×</button>
                </div>
            `).join(''));
    c.querySelectorAll('input').forEach(el => el.addEventListener('change', () => {
        const i = parseInt(el.dataset.idx);
        const field = el.dataset.field;
        state.form.exclusion_windows[i][field] = el.value;
    }));
    c.querySelectorAll('[data-del-window]').forEach(b => b.addEventListener('click', () => {
        const i = parseInt(b.dataset.idx);
        state.form.exclusion_windows.splice(i, 1);
        renderWindows();
    }));
}

function addWindow() {
    state.form.exclusion_windows.push({ start: '', end: '', reason: '' });
    renderWindows();
}

function buildPayload() {
    const tags = $('tagsInput').value.split(',').map(x => x.trim()).filter(Boolean);
    return {
        id: $('scheduleId').value.trim(),
        cluster_id: $('clusterSelect').value,
        action: $('actionSelect').value,
        targets: state.form.targets.map(id => {
            const vm = state.vms.find(v => String(v.vmid) === id);
            return vm ? { vmid: vm.vmid, name: vm.name, node: vm.node } : { vmid: parseInt(id), name: '', node: '' };
        }),
        cron: $('cronInput').value.trim(),
        one_time: $('oneTimeInput').value ? new Date($('oneTimeInput').value).toISOString() : null,
        timezone: $('timezoneSelect').value,
        enabled: $('enabledSelect').value === 'true',
        description: $('descriptionInput').value,
        tags: tags,
        exclusion_windows: state.form.exclusion_windows
    };
}

async function saveSchedule(e) {
    e.preventDefault();
    clearErrors();
    const payload = buildPayload();
    if (!payload.id) { showFieldError('idError', t('idRequired')); return; }
    if (!payload.cluster_id) { showError('Select a cluster'); return; }
    if (!payload.targets.length) { showFieldError('targetsError', t('selectAtLeastOneVm')); return; }
    if (!payload.cron && !payload.one_time) { showFieldError('targetsError', 'Cron or one-time required'); return; }
    const path = state.editing ? 'schedules/detail' : 'schedules';
    try {
        if (state.editing) await api(path, 'PUT', payload);
        else await api(path, 'POST', payload);
        toast(t('saveSuccess'), 'success');
        resetForm();
        loadSchedules(); loadStatus();
    } catch (err) { showError(err.message); }
}

async function runDryRun() {
    clearErrors();
    const payload = buildPayload();
    if (!payload.cluster_id) { showError('Select a cluster'); return; }
    if (!payload.targets.length) { showFieldError('targetsError', t('selectAtLeastOneVm')); return; }
    try {
        const res = await api('dry-run', 'POST', payload);
        const list = res.targets.map(t => `<li>${t.vmid} ${t.name || ''}</li>`).join('');
        confirm(`<div><h3>${t('dryRunDone')}</h3><p>${res.affected_count} VM(s) affected</p><ul>${list}</ul></div>`, null, true);
    } catch (err) { showError(err.message); }
}

function resetForm() {
    state.editing = null;
    state.form = { targets: [], exclusion_windows: [] };
    $('scheduleForm').reset();
    $('formTitle').textContent = t('createSchedule');
    $('scheduleId').value = '';
    $('clusterSelect').value = '';
    $('cronInput').value = '';
    $('oneTimeInput').value = '';
    $('timezoneSelect').value = 'UTC';
    $('enabledSelect').value = 'true';
    $('tagsInput').value = '';
    $('descriptionInput').value = '';
    state.form.exclusion_windows = [];
    renderWindows();
    renderVmPicker();
    updateImpact();
}

function clearErrors() {
    document.querySelectorAll('.error-text').forEach(el => el.textContent = '');
    document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
}

function showFieldError(id, msg) {
    const el = $(id); if (!el) return;
    el.textContent = msg;
    el.previousElementSibling && el.previousElementSibling.classList.add('invalid');
}

function confirm(text, onOk, readOnly = false) {
    const m = $('confirmModal');
    $('confirmText').innerHTML = DOMPurify.sanitize(text);
    m.style.display = 'flex';
    const ok = $('confirmOk');
    const cancel = $('confirmCancel');
    if (readOnly) {
        ok.textContent = 'OK';
        ok.onclick = () => { m.style.display = 'none'; };
        cancel.style.display = 'none';
    } else {
        ok.textContent = t('confirm');
        ok.onclick = () => { m.style.display = 'none'; if (onOk) onOk(); };
        cancel.style.display = '';
        cancel.onclick = () => { m.style.display = 'none'; };
    }
    ok.focus();
}

function switchTab(name) {
    state.tab = name;
    document.querySelectorAll('.tab').forEach(t => { t.setAttribute('aria-selected', t.dataset.tab === name); });
    document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = (p.id !== 'panel-' + name); });
    if (name === 'history') loadHistory();
    if (name === 'vmstatus' && !state.clusters.length) loadClusters();
    if (name === 'vmstatus' && state.vmCluster) loadVmStatus();
    if (name === 'calendar') renderCalendar();
    if (name === 'audit') loadAudit();
}

function initTabs() {
    document.querySelectorAll('.tab').forEach(t => {
        t.addEventListener('click', () => switchTab(t.dataset.tab));
        t.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(t.dataset.tab); } });
    });
}

async function refreshAll() {
    hideGlobalError();
    setLoading(true);
    await loadStatus();
    await loadClusters();
    if (state.tab === 'schedules') await loadSchedules();
    if (state.tab === 'history') await loadHistory();
    if (state.tab === 'vmstatus') await loadVmStatus();
    if (state.tab === 'audit') await loadAudit();
    setLoading(false);
}

async function loadAll() {
    setLoading(true);
    try {
        await loadStatus();
        await loadClusters();
        await loadSchedules();
    } catch (e) {
        showGlobalError(e.message);
    } finally {
        setLoading(false);
    }
}

function wireEvents() {
    $('scheduleForm').addEventListener('submit', saveSchedule);
    $('dryRunBtn').addEventListener('click', runDryRun);
    $('resetBtn').addEventListener('click', resetForm);
    $('addWindow').addEventListener('click', addWindow);
    $('refreshBtn').addEventListener('click', refreshAll);
    $('globalRetry').addEventListener('click', loadAll);
    $('clusterSelect').addEventListener('change', e => { state.form.targets = []; loadVms(e.target.value); updateImpact(); });
    $('cronInput').addEventListener('input', () => { $('cronDesc').textContent = $('cronInput').value; });
    $('cronPreset').addEventListener('change', e => { if (e.target.value) { $('cronInput').value = e.target.value; $('cronDesc').textContent = e.target.value; } });
    $('actionSelect').addEventListener('change', updateImpact);
    initTabs();
    renderScheduleFilters();
    renderHistoryFilters();
    renderVmFilters();
}

function captureI18nDefaults() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        if (!el.dataset.i18nDefault) {
            el.dataset.i18nDefault = el.textContent;
        }
    });
}

function translatePage() {
    const pageTitle = t('title');
    if (pageTitle !== 'title') {
        document.title = pageTitle;
    }
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const fallback = el.dataset.i18nDefault || el.textContent;
        const translated = t(key);
        el.textContent = translated === key ? fallback : translated;
    });
}

captureI18nDefaults();
translatePage();
loadAll();
wireEvents();
