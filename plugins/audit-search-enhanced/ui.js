/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/audit-search-enhanced/ui.js
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
const FALLBACK = {
    title: 'Enhanced Audit Search',
    status_loading: 'Loading...',
    status_running: 'Running',
    status_error: 'Error',
    tab_search: 'Search',
    tab_aggregations: 'Aggregations',
    tab_saved: 'Saved',
    label_cluster: 'Cluster',
    label_quick: 'Quick',
    label_start: 'Start',
    label_end: 'End',
    label_user: 'User',
    label_text: 'Text',
    label_severity: 'Severity',
    label_action: 'Action',
    label_ip: 'IP',
    label_page_size: 'Page size',
    option_all_clusters: 'All clusters',
    option_all: 'All',
    option_custom: 'Custom',
    option_today: 'Today',
    option_7d: 'Last 7 days',
    option_30d: 'Last 30 days',
    option_info: 'Info',
    option_warning: 'Warning',
    option_error: 'Error',
    button_search: 'Search',
    button_save_search: 'Save search',
    button_export: 'Export',
    button_cancel: 'Cancel',
    button_save: 'Save',
    button_delete: 'Delete',
    button_load: 'Load',
    button_load_more: 'Load more',
    button_prev: 'Prev',
    button_next: 'Next',
    button_show: 'Show',
    button_hide: 'Hide',
    placeholder_search_name: 'Search name',
    loading: 'Loading...',
    searching: 'Searching...',
    empty_results: 'No results.',
    empty_saved: 'No saved searches.',
    caption_results: 'Search results',
    caption_saved: 'Saved searches',
    metric_total: 'Total',
    metric_total_entries: 'Total entries',
    metric_severity: 'Severity {{severity}}',
    th_time: 'Time',
    th_user: 'User',
    th_action: 'Action',
    th_cluster: 'Cluster',
    th_details: 'Details',
    th_name: 'Name',
    th_actions: 'Actions',
    aria_show_details: 'Show details',
    aria_hide_details: 'Hide details',
    aria_dialog_save: 'Save this search',
    aria_dialog_delete: 'Delete saved search',
    dialog_title_save: 'Save Search',
    dialog_title_delete: 'Delete saved search?',
    dialog_title_export: 'Export audit log',
    dialog_body_delete: 'This action cannot be undone.',
    toast_searched: 'Found {{count}} results.',
    toast_saved: 'Search saved.',
    toast_deleted: 'Deleted.',
    error: 'Error: {{msg}}',
    error_end_before_start: 'End must not be before start',
    error_rate_limit: 'Rate limit exceeded. Please wait and try again.',
    error_large_export: 'Export is too large. Please confirm.',
    save_prompt: 'Name this search',
    delete_confirm: 'Delete?',
    large_export_confirm: 'This export is large. Continue?',
    skip_content: 'Skip to main content',
    searched: 'Found {{count}} results',
    saved: 'Search saved',
    deleted: 'Search deleted',
};
function translateI18n(container = document) {
    container.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        const params = el.dataset.i18nParams ? JSON.parse(el.dataset.i18nParams) : undefined;
        el.textContent = t(key, params);
    });
}
const t = (k, p) => {
    let s;
    try { s = i18n && i18n.getT('audit-search-enhanced')(k, p ? { params: p } : undefined); } catch (e) { }
    if (s && s !== k) return s;
    const fb = FALLBACK[k];
    if (!fb) return k;
    if (!p) return fb;
    return fb.replace(/\{\{(\w+)\}\}/g, (m, name) => (p[name] !== undefined ? p[name] : m));
};
if (i18n) i18n.loadPluginNamespaceFull('audit-search-enhanced', '/api/plugins/audit-search-enhanced/i18n');

// XSS strategy: all dynamic HTML is sanitised through DOMPurify.sanitize. The
// escapeHtml helper is used only inside highlight() to encode raw text before
// wrapping matches in <span>, so the final DOMPurify pass still sees only safe HTML.

const CHUNK = 100;
const state = { clusters: [], users: [], results: [], rendered: 0, filters: { text: '' }, offset: 0, limit: 25, sort: 'timestamp', order: 'desc' };

async function api(path, method = 'GET', body = null) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const opts = { method, credentials: 'same-origin', signal: controller.signal, headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    try {
        const res = await fetch(path, opts);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    } finally {
        clearTimeout(timeout);
    }
}
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; e.setAttribute('role', type === 'error' ? 'alert' : 'status'); d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

function openModal({ title = 'Confirm', body = '', input = false, value = '', okText = 'OK' } = {}) {
    return new Promise((resolve) => {
        const overlay = $('modalOverlay'), modalEl = $('modal'), titleEl = $('modalTitle'), bodyEl = $('modalBody'), inputEl = $('modalInput'), okEl = $('modalOk'), cancelEl = $('modalCancel');
        titleEl.textContent = title;
        bodyEl.textContent = body;
        inputEl.value = value;
        if (input) { inputEl.removeAttribute('hidden'); inputEl.style.display = 'block'; } else { inputEl.setAttribute('hidden', ''); inputEl.style.display = 'none'; }
        okEl.textContent = okText;
        overlay.removeAttribute('hidden');
        overlay.style.display = 'flex';
        if (modalEl) { modalEl.removeAttribute('hidden'); modalEl.style.display = 'block'; }
        if (input) setTimeout(() => inputEl.focus(), 0);
        const cleanup = () => { overlay.setAttribute('hidden', ''); overlay.style.display = 'none'; if (modalEl) { modalEl.setAttribute('hidden', ''); modalEl.style.display = 'none'; } okEl.onclick = null; cancelEl.onclick = null; window.removeEventListener('keydown', key); };
        const key = (e) => { if (e.key === 'Escape') { cleanup(); resolve(input ? null : false); } };
        okEl.onclick = () => { cleanup(); resolve(input ? inputEl.value.trim() : true); };
        cancelEl.onclick = () => { cleanup(); resolve(input ? null : false); };
        window.addEventListener('keydown', key);
    });
}

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? t('status_running') : s.status; } catch (e) { $('status').textContent = t('status_error'); } }
async function loadClusters() { try { const d = await api('clusters'); state.clusters = d.data || []; const opts = state.clusters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name)}</option>`).join(''); $('sCluster').innerHTML = DOMPurify.sanitize('<option value="">' + t('option_all_clusters') + '</option>' + opts); } catch (e) { } }
async function loadUsers() { try { const d = await api('users'); state.users = d.users || []; const opts = state.users.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join(''); $('sUser').innerHTML = DOMPurify.sanitize('<option value="">' + t('option_all') + '</option>' + opts); } catch (e) { } }
async function loadSaved() { try { const d = await api('saved'); state.saved = d.saved || []; renderSaved(); } catch (e) { showError(e.message); } }

function formatLocalDatetime(dt) { const pad = n => String(n).padStart(2, '0'); return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`; }

function setQuick() { const q = $('sQuick').value; if (!q) return; const end = new Date(); let start = new Date(); if (q === 'today') start = new Date(end.getFullYear(), end.getMonth(), end.getDate()); else if (q === '7d') start = new Date(end - 7 * 24 * 60 * 60 * 1000); else if (q === '30d') start = new Date(end - 30 * 24 * 60 * 60 * 1000); $('sEnd').value = formatLocalDatetime(end); $('sStart').value = formatLocalDatetime(start); }

async function doSearch(e) {
    if (e) e.preventDefault();
    if (e) state.offset = 0;
    $('sError').textContent = '';
    const loadingP = document.createElement('p');
    loadingP.className = 'empty';
    loadingP.textContent = t('loading');
    $('resultsList').replaceChildren(loadingP);
    const start = $('sStart').value, end = $('sEnd').value, ip = $('sIp').value;
    if (start && end && new Date(end) < new Date(start)) { $('sError').textContent = t('error_end_before_start'); return; }
    const body = { cluster_id: $('sCluster').value, start, end, user: $('sUser').value, text: $('sText').value, severity: $('sSeverity').value, action: $('sAction').value, ip, offset: state.offset, limit: state.limit, sort: state.sort, order: state.order };
    state.filters = body; try { const d = await api('search', 'POST', body); state.results = d.results || []; state.total = d.count; state.rendered = Math.min(CHUNK, d.results.length); toast(t('searched', { count: d.count }), 'success'); renderResults(); renderPager(); } catch (err) { $('sError').textContent = err.message; showError(err.message); }
}

function highlight(text) { const q = $('sText').value.toLowerCase(); if (!q || !text) return escapeHtml(text); const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'); return escapeHtml(String(text)).replace(re, '<span class="highlight">$1</span>'); }

function renderResults() {
    const c = $('resultsList');
    if (!state.results.length) {
        const emptyP = document.createElement('p');
        emptyP.className = 'empty';
        emptyP.textContent = t('empty_results');
        c.replaceChildren(emptyP);
        $('metrics').innerHTML = '';
        return;
    }
    $('metrics').innerHTML = DOMPurify.sanitize(`<div class="metric"><div class="value">${escapeHtml(state.total)}</div><div class="label" data-i18n="metric_total">Total</div></div>`);
    const ariaSort = (col) => col === state.sort ? ` aria-sort="${state.order}"` : '';
    let html = `<table><caption data-i18n="caption_results">Search results</caption><thead><tr><th data-sort="timestamp" data-i18n="th_time"${ariaSort('timestamp')}>Time</th><th data-sort="user" data-i18n="th_user"${ariaSort('user')}>User</th><th data-sort="action" data-i18n="th_action"${ariaSort('action')}>Action</th><th data-sort="cluster_id" data-i18n="th_cluster"${ariaSort('cluster_id')}>Cluster</th><th data-i18n="th_details">Details</th></tr></thead><tbody>`;
    state.results.slice(0, state.rendered).forEach((r, idx) => {
        const details = JSON.stringify(r, null, 2); html += `<tr>
                <td class="muted">${(() => { const ts = r.timestamp || r.created_at; const d = ts ? new Date(ts) : null; return (d && !isNaN(d)) ? d.toLocaleString() : '-'; })()}</td>
                <td class="muted">${highlight(r.user || '-')}</td>
                <td class="muted">${highlight(r.action || '-')}</td>
                <td class="muted">${escapeHtml(r.cluster_id || '-')}</td>
                <td><span class="expand" role="button" tabindex="0" aria-expanded="false" data-idx="${idx}" data-i18n="button_show">Show</span></td>
            </tr><tr id="detail-${idx}" hidden><td colspan="5"><pre>${escapeHtml(details)}</pre></td></tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    translateI18n(c);
    c.querySelectorAll('.expand').forEach(el => el.addEventListener('click', () => { const tr = $(`detail-${el.dataset.idx}`); tr.hidden = !tr.hidden; el.textContent = tr.hidden ? t('button_show') : t('button_hide'); el.setAttribute('aria-expanded', String(!tr.hidden)); }));
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { state.sort = th.dataset.sort; state.order = (state.sort === th.dataset.sort && state.order === 'asc') ? 'desc' : 'asc'; doSearch(); }));
    if (state.rendered < state.results.length) { const more = document.createElement('button'); more.className = 'secondary'; more.textContent = t('button_load_more'); more.addEventListener('click', () => { state.rendered = Math.min(state.results.length, state.rendered + CHUNK); renderResults(); }); c.appendChild(more); }
}

function renderPager() { const c = $('pager'); if (state.total <= state.limit) { c.innerHTML = ''; return; } c.innerHTML = DOMPurify.sanitize(`<button ${state.offset === 0 ? 'disabled' : ''} data-pg="-1" data-i18n="button_prev">Prev</button><span>${state.offset + 1}-${escapeHtml(Math.min(state.offset + state.limit, state.total))} of ${escapeHtml(state.total)}</span><button ${state.offset + state.limit >= state.total ? 'disabled' : ''} data-pg="1" data-i18n="button_next">Next</button>`); translateI18n(c); c.querySelectorAll('button[data-pg]').forEach(b => b.addEventListener('click', () => { const dir = parseInt(b.dataset.pg); state.offset = Math.max(0, state.offset + dir * state.limit); doSearch(); })); }

async function saveSearch() { const name = await openModal({ title: t('dialog_title_save'), body: t('save_prompt'), input: true, okText: t('button_save') }); if (!name) return; try { await api('saved', 'POST', { name, filters: state.filters }); toast(t('saved'), 'success'); loadSaved(); } catch (e) { showError(e.message); } }

function _downloadAuditExport(entries) {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'audit-export.json'; a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

async function exportJson() {
    try {
        const res = await fetch('export', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const d = await res.json().catch(() => ({}));
        if (res.status === 409 && d.confirm_required) {
            const confirm = await openModal({ title: t('dialog_title_export'), body: t('large_export_confirm'), okText: t('button_export') });
            if (!confirm) return;
            const confirmed = await api('export?confirm=1');
            _downloadAuditExport(confirmed.audit_entries);
            return;
        }
        if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
        _downloadAuditExport(d.audit_entries);
    } catch (e) { showError(e.message); }
}

function renderSaved() {
    const c = $('savedList');
    if (!state.saved.length) {
        const emptyP = document.createElement('p');
        emptyP.className = 'empty';
        emptyP.textContent = t('empty_saved');
        c.replaceChildren(emptyP);
        return;
    }
    let html = '<table><caption data-i18n="caption_saved">Saved searches</caption><thead><tr><th data-i18n="th_name">Name</th><th data-i18n="th_actions">Actions</th></tr></thead><tbody>';
    state.saved.forEach(s => { html += `<tr><td class="muted">${escapeHtml(s.name)}</td><td class="actions"><button data-load="${escapeHtml(s.id)}" data-i18n="button_load">Load</button><button data-delete="${escapeHtml(s.id)}" class="secondary" data-i18n="button_delete">Delete</button></td></tr>`; });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    translateI18n(c);
    c.querySelectorAll('button[data-load]').forEach(b => b.addEventListener('click', () => { const s = state.saved.find(x => x.id === b.dataset.load); if (s) { Object.entries(s.filters || {}).forEach(([k, v]) => { const el = $(`s${k.charAt(0).toUpperCase() + k.slice(1)}`); if (el) el.value = v; }); doSearch(); } }));
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', async () => { if (!(await openModal({ title: t('dialog_title_delete'), body: t('dialog_body_delete'), okText: t('button_delete') }))) return; try { await api('saved', 'DELETE', { id: b.dataset.delete }); toast(t('deleted'), 'success'); loadSaved(); } catch (e) { showError(e.message); } }));
}

async function loadAggs() {
    const grid = $('aggGrid');
    const loadingP = document.createElement('p');
    loadingP.className = 'empty';
    loadingP.textContent = t('loading');
    grid.replaceChildren(loadingP);
    try {
        const d = await api('aggregations');
        const c = $('aggGrid');
        if (!d.total) {
            const emptyP = document.createElement('p');
            emptyP.className = 'empty';
            emptyP.textContent = t('empty_results');
            c.replaceChildren(emptyP);
            return;
        }
        // snyk:ignore:DOM-based Cross-site Scripting (XSS)
        c.innerHTML = DOMPurify.sanitize(`<div class="metric"><div class="value">${escapeHtml(d.total)}</div><div class="label">${t('metric_total_entries')}</div></div>` + Object.entries(d.by_user || {}).map(([u, n]) => `<div class="metric"><div class="value">${escapeHtml(n)}</div><div class="label">${escapeHtml(u)}</div></div>`).join('') + Object.entries(d.by_severity || {}).map(([s, n]) => `<div class="metric"><div class="value">${escapeHtml(n)}</div><div class="label">${t('metric_severity', { severity: s })}</div></div>`).join(''));
    } catch (e) { showError(e.message); }
}

function switchTab(name) {
    state.tab = name;
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name));
    history.replaceState({ tab: name }, '', '#tab=' + name);
    if (name === 'saved') loadSaved();
    if (name === 'agg') loadAggs();
}

function wireEvents() {
    const tabs = Array.from(document.querySelectorAll('.tab'));
    tabs.forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    const form = $('searchForm'); if (form) form.addEventListener('submit', doSearch);
    const sQuick = $('sQuick'); if (sQuick) sQuick.addEventListener('change', setQuick);
    const sSave = $('sSave'); if (sSave) sSave.addEventListener('click', saveSearch);
    const sExport = $('sExport'); if (sExport) sExport.addEventListener('click', exportJson);
    const pageSize = $('pageSize'); if (pageSize) pageSize.addEventListener('change', () => { state.limit = parseInt($('pageSize').value, 10) || 25; state.offset = 0; doSearch(); });
    window.addEventListener('popstate', (e) => {
        const tab = (window.location.hash.match(/^#tab=(.+)/) || [])[1] || 'search';
        switchTab(tab);
    });
    window.addEventListener('message', (e) => {
        if (e.origin !== window.location.origin) return;
        if (e.data && typeof e.data.theme === 'string') {
            document.documentElement.setAttribute('data-theme', e.data.theme);
        }
    });
    const tabList = document.querySelector('.tabs'); if (tabList) tabList.addEventListener('keydown', (e) => {
        const idx = tabs.findIndex(t => t === document.activeElement);
        if (idx === -1) return;
        let next = idx;
        if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        if (next !== idx) { e.preventDefault(); tabs[next].focus(); tabs[next].click(); }
    });
}

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('audit-search-enhanced', '/api/plugins/audit-search-enhanced/i18n'); translateI18n(document); await loadStatus(); await loadClusters(); await loadUsers(); wireEvents(); })();
