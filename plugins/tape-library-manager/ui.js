/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/tape-library-manager/ui.js
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
if (theme === 'modern-dark') {
    document.documentElement.removeAttribute('data-theme');
} else {
    document.documentElement.setAttribute('data-theme', theme);
}

const i18n = (window.parent && window.parent.ProxmoxVExI18n) || {
    getT: () => (k, opts) => FALLBACK[k] ? (typeof FALLBACK[k] === 'function' ? FALLBACK[k](opts) : FALLBACK[k]) : k
};
const t = i18n.getT('tape-library-manager');

const FALLBACK = {
    pageTitle: 'Tape Library Manager',
    statusRunning: 'Running',
    statusError: 'Error',
    counts: 'Tapes: {tapes} | Loaded: {loaded} | Retired: {retired}',
    drives: 'Drives',
    tapes: 'Tapes',
    rack: 'Rack',
    activity: 'Activity',
    importExport: 'Import / Export',
    add: 'Add',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    edit: 'Edit',
    delete: 'Delete',
    duplicate: 'Duplicate',
    load: 'Load',
    eject: 'Eject',
    refresh: 'Refresh',
    search: 'Search',
    filter: 'Filter',
    sort: 'Sort',
    order: 'Order',
    barcode: 'Barcode',
    location: 'Location',
    status: 'Status',
    all: 'All',
    shelf: 'Shelf',
    loaded: 'Loaded',
    retired: 'Retired',
    bad: 'Bad',
    empty: 'Empty',
    maintenance: 'Maintenance',
    backupJob: 'Backup job',
    drive: 'Drive',
    driveId: 'Drive ID',
    driveName: 'Name',
    driveSerial: 'Serial',
    addDrive: 'Add Drive',
    addTape: 'Add Tape',
    noDrives: 'No drives.',
    noTapes: 'No tapes.',
    noActivity: 'No activity.',
    noLocations: 'No locations.',
    confirmDelete: 'Delete this {type}?',
    confirmEject: 'Eject tape from {drive}?',
    confirmLoadRetired: 'This tape is {status}. Load it anyway?',
    tapeLoaded: 'Tape is currently loaded in a drive.',
    loadInto: 'Load into {drive}',
    selectTape: 'Select tape',
    exportJSON: 'Export JSON',
    exportCSV: 'Export CSV',
    importData: 'Import data',
    importFormat: 'Format',
    importMode: 'Mode',
    import: 'Import',
    retry: 'Retry',
    apiError: 'Request failed: {message}',
    saved: 'Saved',
    deleted: 'Deleted',
    loaded: 'Loaded',
    ejected: 'Ejected',
    duplicated: 'Duplicated',
    importDone: 'Imported {imported}, skipped {skipped}',
    actor: 'Actor',
    timestamp: 'Timestamp',
    action: 'Action',
    details: 'Details',
    previous: 'Previous',
    next: 'Next',
    of: 'of'
};

const T = (k, opts) => {
    const v = t(k, opts);
    if (v && v !== k) return v;
    return typeof FALLBACK[k] === 'function' ? FALLBACK[k](opts) : (FALLBACK[k] || k);
};

function $(id) { return document.getElementById(id); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function notify(message, type = 'info') {
    const parent = window.parent && window.parent.ProxmoxVExNotify;
    if (parent) parent({ message, type });
    const toasts = $('toasts');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toasts.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}
function showError(message) {
    const el = $('globalError');
    $('globalErrorText').textContent = T('apiError', { message });
    el.style.display = 'block';
}
function clearError() { $('globalError').style.display = 'none'; }

async function api(path, method = 'GET', body = null) {
    const opts = {
        method,
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    };
    if (body !== null) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

let state = { drives: [], tapes: [], locations: [], activity: [], page: 1, perPage: 25 };

async function loadStatus() {
    try {
        const s = await api('status');
        const el = $('status');
        el.textContent = s.status === 'running' ? T('statusRunning') : s.status;
        el.classList.remove('error');
        const c = s.tapes !== undefined ? T('counts', { tapes: s.tapes, loaded: s.loaded_tapes || 0, retired: s.retired_tapes || 0 }) : '';
        $('counts').textContent = c;
    } catch (e) {
        $('status').textContent = T('statusError');
        $('status').classList.add('error');
        showError(e.message);
    }
}

async function loadDrives() {
    try {
        const { drives } = await api('drives');
        state.drives = drives || [];
        renderDrives();
        clearError();
    } catch (e) { showError(e.message); }
}

function renderDrives() {
    const list = $('drivesList');
    if (!state.drives.length) {
        list.innerHTML = DOMPurify.sanitize(`<p class="empty">${T('noDrives')}</p>`);
        return;
    }
    let html = '<table><thead><tr><th>' + T('driveId') + '</th><th>' + T('driveName') + '</th><th>' + T('driveSerial') + '</th><th>' + T('status') + '</th><th>' + T('loaded') + '</th><th>' + T('actions') + '</th></tr></thead><tbody>';
    state.drives.forEach(d => {
        const statusClass = d.status === 'loaded' ? 'loaded' : (d.status === 'maintenance' ? 'maintenance' : (d.status === 'error' ? 'error' : 'empty'));
        const loadedTape = d.loaded_tape ? findTapeName(d.loaded_tape) : '-';
        html += `<tr data-id="${escapeHtml(d.id)}">
                    <td class="muted">${escapeHtml(d.id)}</td>
                    <td>${escapeHtml(d.name)}</td>
                    <td>${escapeHtml(d.serial || '-')}</td>
                    <td><span class="badge ${statusClass}">${escapeHtml(d.status)}</span></td>
                    <td class="muted">${loadedTape}</td>
                    <td class="actions">
                        <select class="tapePicker" data-action="load" aria-label="${T('selectTape')}" ${d.status !== 'empty' ? 'disabled' : ''}>
                            <option value="">${T('selectTape')}</option>
                            ${availableTapeOptions()}
                        </select>
                        <button class="small" data-action="load" ${d.status !== 'empty' ? 'disabled' : ''}>${T('load')}</button>
                        <button class="secondary small" data-action="eject" ${d.status !== 'loaded' ? 'disabled' : ''}>${T('eject')}</button>
                        <button class="secondary small" data-action="maintenance" title="maintenance">M</button>
                        <button class="secondary small" data-action="editDrive">${T('edit')}</button>
                        <button class="danger small" data-action="deleteDrive">${T('delete')}</button>
                    </td>
                </tr>`;
    });
    html += '</tbody></table>';
    list.innerHTML = DOMPurify.sanitize(html);
}

function findTapeName(tapeId) {
    const t = state.tapes.find(x => x.id === tapeId);
    return t ? `${escapeHtml(t.barcode)} (${escapeHtml(t.status)})` : escapeHtml(tapeId);
}

function availableTapeOptions() {
    return state.tapes.filter(t => t.status !== 'loaded').map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.barcode)} [${escapeHtml(t.location)}]</option>`).join('');
}

async function loadTapes() {
    try {
        const q = new URLSearchParams();
        const search = $('tapeSearch').value.trim();
        const status = $('tapeStatusFilter').value;
        const loc = $('tapeLocationFilter').value.trim();
        const sort = $('tapeSort').value;
        const order = $('tapeOrder').value;
        if (search) q.set('search', search);
        if (status) q.set('status', status);
        if (loc) q.set('location', loc);
        q.set('sort', sort); q.set('order', order);
        q.set('limit', state.perPage);
        q.set('offset', (state.page - 1) * state.perPage);
        const { tapes, total } = await api('tapes?' + q.toString());
        state.tapes = tapes || [];
        state.tapeTotal = total || 0;
        renderTapes();
        clearError();
    } catch (e) { showError(e.message); }
}

function renderTapes() {
    const list = $('tapesList');
    if (!state.tapes.length) {
        list.innerHTML = DOMPurify.sanitize(`<p class="empty">${T('noTapes')}</p>`);
        $('tapePagination').innerHTML = '';
        return;
    }
    let html = '<table><thead><tr><th>' + T('barcode') + '</th><th>' + T('location') + '</th><th>' + T('status') + '</th><th>' + T('backupJob') + '</th><th>' + T('loaded') + '</th><th>' + T('lastUsed') + '</th><th>' + T('actions') + '</th></tr></thead><tbody>';
    state.tapes.forEach(t => {
        const cls = t.status === 'loaded' ? 'loaded' : (t.status === 'retired' ? 'retired' : (t.status === 'bad' ? 'danger' : 'shelf'));
        html += `<tr data-id="${escapeHtml(t.id)}">
                    <td>${escapeHtml(t.barcode)}</td>
                    <td>${escapeHtml(t.location || '-')}</td>
                    <td><span class="badge ${cls}">${escapeHtml(t.status)}</span></td>
                    <td class="muted">${escapeHtml(t.backup_job || '-')}</td>
                    <td class="muted">${escapeHtml(t.use_count || 0)}</td>
                    <td class="muted">${t.last_used ? new Date(t.last_used).toLocaleString() : '-'}</td>
                    <td class="actions">
                        <button class="small" data-action="editTape">${T('edit')}</button>
                        <button class="secondary small" data-action="duplicateTape">${T('duplicate')}</button>
                        <button class="danger small" data-action="deleteTape">${T('delete')}</button>
                    </td>
                </tr>`;
    });
    html += '</tbody></table>';
    list.innerHTML = DOMPurify.sanitize(html);
    const pages = Math.ceil(state.tapeTotal / state.perPage);
    $('tapePagination').innerHTML = DOMPurify.sanitize(`<button ${state.page === 1 ? 'disabled' : ''} id="prevPage">${T('previous')}</button> <span>${state.page} / ${pages}</span> <button ${state.page >= pages ? 'disabled' : ''} id="nextPage">${T('next')}</button>`);
}

async function loadLocations() {
    try {
        const { locations } = await api('tapes/locations');
        state.locations = locations || [];
        renderLocations();
        const dl = $('locations');
        dl.innerHTML = DOMPurify.sanitize((locations || []).map(l => `<option value="${escapeHtml(l.name)}">`).join(''));
    } catch (e) { console.error(e); }
}

function renderLocations() {
    const list = $('rackList');
    if (!state.locations.length) {
        list.innerHTML = DOMPurify.sanitize(`<p class="empty">${T('noLocations')}</p>`);
        return;
    }
    list.innerHTML = DOMPurify.sanitize(state.locations.map(l => `<div class="rack-card" data-loc="${escapeHtml(l.name)}"><span class="name">${escapeHtml(l.name)}</span><span class="count">${escapeHtml(l.count)} tapes</span></div>`).join(''));
}

async function loadActivity() {
    try {
        const q = new URLSearchParams();
        const drive = $('actDrive').value.trim();
        const tape = $('actTape').value.trim();
        const action = $('actAction').value;
        if (drive) q.set('drive', drive);
        if (tape) q.set('tape', tape);
        if (action) q.set('action', action);
        const { activity } = await api('activity?' + q.toString());
        state.activity = activity || [];
        renderActivity();
    } catch (e) { showError(e.message); }
}

function renderActivity() {
    const list = $('activityList');
    if (!state.activity.length) {
        list.innerHTML = DOMPurify.sanitize(`<p class="empty">${T('noActivity')}</p>`);
        return;
    }
    let html = '<table><thead><tr><th>' + T('timestamp') + '</th><th>' + T('action') + '</th><th>' + T('drive') + '</th><th>' + T('barcode') + '</th><th>' + T('actor') + '</th><th>' + T('details') + '</th></tr></thead><tbody>';
    state.activity.forEach(a => {
        const ts = a.timestamp ? new Date(a.timestamp).toLocaleString() : '-';
        const tape = a.tape_id ? findTapeName(a.tape_id) : '-';
        html += `<tr><td class="muted">${ts}</td><td><span class="badge">${escapeHtml(a.action)}</span></td><td>${escapeHtml(a.drive_id || '-')}</td><td>${tape}</td><td>${escapeHtml(a.actor || '-')}</td><td class="muted">${escapeHtml(JSON.stringify(a.details || {}).slice(0, 60))}</td></tr>`;
    });
    html += '</tbody></table>';
    list.innerHTML = DOMPurify.sanitize(html);
}

function openModal(title, body, onConfirm) {
    $('modalTitle').textContent = title;
    $('modalBody').textContent = body;
    const backdrop = $('modal');
    backdrop.classList.add('active');
    const confirm = () => { closeModal(); onConfirm(); };
    $('modalConfirm').onclick = confirm;
}
function closeModal() { $('modal').classList.remove('active'); }
$('modalCancel').onclick = closeModal;

async function handleDriveSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const body = Object.fromEntries(new FormData(form).entries());
    try {
        await api('drives', 'POST', { id: body.id, name: body.name, serial: body.serial });
        notify(T('saved'), 'success');
        form.reset();
        await loadDrives();
    } catch (err) { notify(err.message, 'error'); }
}

async function handleTapeSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const body = Object.fromEntries(new FormData(form).entries());
    try {
        await api('tapes', 'POST', body);
        notify(T('saved'), 'success');
        form.reset();
        await loadTapes();
        await loadLocations();
        await loadStatus();
    } catch (err) { notify(err.message, 'error'); }
}

async function loadTape(driveId, tapeId, selectEl) {
    const tape = state.tapes.find(t => t.id === tapeId);
    if (tape && (tape.status === 'retired' || tape.status === 'bad')) {
        const ok = confirm(T('confirmLoadRetired', { status: tape.status }));
        if (!ok) return;
    }
    try {
        await api('load', 'POST', { drive: driveId, tape: tapeId });
        notify(T('loaded'), 'success');
        await loadDrives();
        await loadTapes();
        await loadActivity();
        await loadStatus();
    } catch (err) { notify(err.message, 'error'); }
}

async function ejectTape(driveId) {
    openModal(T('eject'), T('confirmEject', { drive: driveId }), async () => {
        try {
            await api('eject', 'POST', { drive: driveId });
            notify(T('ejected'), 'success');
            await loadDrives();
            await loadTapes();
            await loadActivity();
            await loadStatus();
        } catch (err) { notify(err.message, 'error'); }
    });
}

async function toggleMaintenance(driveId) {
    const drive = state.drives.find(d => d.id === driveId);
    if (!drive) return;
    const newStatus = drive.status === 'maintenance' ? 'empty' : 'maintenance';
    try {
        await api('drives', 'PUT', { id: driveId, name: drive.name, serial: drive.serial || '', status: newStatus });
        notify('Status updated', 'success');
        await loadDrives();
    } catch (err) { notify(err.message, 'error'); }
}

async function editDrive(drive) {
    const name = prompt('Drive name', drive.name);
    if (name === null) return;
    const serial = prompt('Serial', drive.serial || '');
    if (serial === null) return;
    try {
        await api('drives', 'PUT', { id: drive.id, name: name.trim(), serial: serial.trim() });
        notify(T('saved'), 'success');
        await loadDrives();
    } catch (err) { notify(err.message, 'error'); }
}

async function deleteDrive(driveId) {
    openModal(T('delete'), T('confirmDelete', { type: T('drive') }), async () => {
        try {
            await api('drives?id=' + encodeURIComponent(driveId), 'DELETE');
            notify(T('deleted'), 'success');
            await loadDrives();
            await loadActivity();
            await loadStatus();
        } catch (err) { notify(err.message, 'error'); }
    });
}

async function editTape(tape) {
    const location = prompt(T('location'), tape.location || 'shelf');
    if (location === null) return;
    const status = prompt(T('status'), tape.status || 'shelf');
    if (status === null) return;
    const job = prompt(T('backupJob'), tape.backup_job || '');
    if (job === null) return;
    try {
        await api('tapes', 'PUT', { id: tape.id, barcode: tape.barcode, location: location.trim(), status: status.trim(), backup_job: job.trim() });
        notify(T('saved'), 'success');
        await loadTapes();
        await loadLocations();
        await loadActivity();
    } catch (err) { notify(err.message, 'error'); }
}

async function duplicateTape(tape) {
    const newBarcode = prompt(T('barcode'), tape.barcode + '-copy');
    if (!newBarcode) return;
    try {
        await api('tapes/duplicate', 'POST', { id: tape.id, barcode: newBarcode.trim(), location: tape.location });
        notify(T('duplicated'), 'success');
        await loadTapes();
        await loadLocations();
        await loadStatus();
    } catch (err) { notify(err.message, 'error'); }
}

async function deleteTape(tape) {
    if (tape.status === 'loaded') {
        notify(T('tapeLoaded'), 'error');
        return;
    }
    openModal(T('delete'), T('confirmDelete', { type: T('barcode') }) + ' ' + tape.barcode, async () => {
        try {
            await api('tapes?id=' + encodeURIComponent(tape.id), 'DELETE');
            notify(T('deleted'), 'success');
            await loadTapes();
            await loadLocations();
            await loadActivity();
            await loadStatus();
        } catch (err) { notify(err.message, 'error'); }
    });
}

document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('button, .rack-card');
    if (!btn) return;
    const action = btn.dataset.action;
    if (!action) return;
    const row = btn.closest('tr');
    const id = row ? row.dataset.id : null;

    if (action === 'load') {
        const tr = btn.closest('tr');
        const driveId = tr.dataset.id;
        const select = tr.querySelector('.tapePicker');
        const tapeId = select.value;
        if (!tapeId) return;
        loadTape(driveId, tapeId, select);
    }
    if (action === 'eject') ejectTape(id);
    if (action === 'maintenance') toggleMaintenance(id);
    if (action === 'editDrive') editDrive(state.drives.find(d => d.id === id));
    if (action === 'deleteDrive') deleteDrive(id);
    if (action === 'editTape') editTape(state.tapes.find(t => t.id === id));
    if (action === 'duplicateTape') duplicateTape(state.tapes.find(t => t.id === id));
    if (action === 'deleteTape') deleteTape(state.tapes.find(t => t.id === id));
    if (action === 'filterRack') {
        $('tapeLocationFilter').value = btn.dataset.loc;
        switchTab('tapes');
        loadTapes();
    }
});

$('drivesList').addEventListener('change', (e) => {
    const sel = e.target.closest('.tapePicker');
    if (!sel) return;
    const driveId = sel.closest('tr').dataset.id;
    const tapeId = sel.value;
    if (tapeId) loadTape(driveId, tapeId, sel);
});

$('driveForm').addEventListener('submit', handleDriveSubmit);
$('tapeForm').addEventListener('submit', handleTapeSubmit);
$('tapeSearch').addEventListener('input', () => { state.page = 1; loadTapes(); });
$('tapeStatusFilter').addEventListener('change', () => { state.page = 1; loadTapes(); });
$('tapeLocationFilter').addEventListener('input', () => { state.page = 1; loadTapes(); });
$('tapeSort').addEventListener('change', () => { state.page = 1; loadTapes(); });
$('tapeOrder').addEventListener('change', () => { state.page = 1; loadTapes(); });
$('refreshTapes').addEventListener('click', loadTapes);
$('refreshActivity').addEventListener('click', loadActivity);
$('actDrive').addEventListener('input', loadActivity);
$('actTape').addEventListener('input', loadActivity);
$('actAction').addEventListener('change', loadActivity);

document.addEventListener('click', (e) => {
    if (e.target.id === 'prevPage' && state.page > 1) { state.page--; loadTapes(); }
    if (e.target.id === 'nextPage') { state.page++; loadTapes(); }
});

$('exportJSON').addEventListener('click', () => window.open('tapes/export?format=json', '_blank'));
$('exportCSV').addEventListener('click', () => window.open('tapes/export?format=csv', '_blank'));

$('importForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
        const res = await api('tapes/import', 'POST', { format: body.format, data: body.data, mode: body.mode });
        $('importResult').textContent = T('importDone', res) + '\n' + (res.errors || []).join('\n');
        notify(T('importDone', res), 'success');
        await loadTapes();
        await loadLocations();
        await loadStatus();
    } catch (err) { notify(err.message, 'error'); }
});

function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name));
    document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === name));
    if (name === 'tapes') loadTapes();
    if (name === 'drives') loadDrives();
    if (name === 'rack') loadLocations();
    if (name === 'activity') loadActivity();
}

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

$('retryBtn').addEventListener('click', () => { clearError(); loadAll(); });

async function loadAll() {
    await loadStatus();
    await loadDrives();
    await loadTapes();
    await loadLocations();
    await loadActivity();
}

document.title = T('pageTitle');
$('pageTitle').textContent = T('pageTitle');
loadAll();
