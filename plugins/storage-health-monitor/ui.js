/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/storage-health-monitor/ui.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Ui JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
const qs = new URLSearchParams(window.location.search);
// Theme is driven by the main app (query string on load, postMessage on change).
const THEME_MAP = {
    'proxmoxDark': 'modern-dark',
    'proxmoxLight': 'corp-light',
    'corporateDark': 'corp-dark',
    'corporateLight': 'corp-light'
};
const VALID_THEMES = ['modern-dark', 'corp-dark', 'corp-light'];
function normalizeTheme(name) {
    const mapped = THEME_MAP[name] || name || 'modern-dark';
    return VALID_THEMES.includes(mapped) ? mapped : 'modern-dark';
}
let currentTheme = normalizeTheme(qs.get('theme'));
document.documentElement.setAttribute('data-theme', currentTheme);
function setTheme(name) {
    const t = normalizeTheme(name);
    if (t === currentTheme) return;
    currentTheme = t;
    document.documentElement.setAttribute('data-theme', t);
}

const i18n = (window.parent && window.parent.ProxmoxVExI18n) || window.ProxmoxVExI18n;
let t = (k, opts) => k;
const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
    clusters: [],
    nodes: [],
    storages: [],
    disks: [],
    filteredDisks: [],
    history: [],
    rules: [],
    alerts: [],
    snapshots: [],
    audit: [],
    schedule: { interval_minutes: 0 },
    thresholds: { min_ok_percentage: 90, max_warning_disks: 0, max_failing_disks: 0 },
    pins: JSON.parse(localStorage.getItem('storageHealthPins') || '[]'),
    compare: [],
    sort: { key: 'node', dir: 'asc' },
    page: 1,
    pageSize: 25,
    autoRefresh: 0,
    autoTimer: null,
    expanded: new Set(),
    selectedDisks: new Set(),
    selectedStorages: new Set(),
};

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function text(k, params = {}) {
    const safe = {};
    for (const key of Object.keys(params)) { safe[key] = escapeHtml(params[key]); }
    return t(k, { params: safe });
}

function captureI18nDefaults() {
    // Preserve the original visible text so the UI stays capitalised
    // even if the i18n namespace is not loaded yet.
    $$('[data-i18n]').forEach(el => {
        if (!el.dataset.i18nDefault) {
            el.dataset.i18nDefault = el.textContent;
        }
    });
}

function updateI18nLabels() {
    $$('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const fallback = el.dataset.i18nDefault || el.textContent;
        const translated = text(key);
        // If the translation is missing the t() function returns the
        // key itself (e.g. "title", "health"). Keep the original label.
        el.textContent = translated === key ? fallback : translated;
    });
}

async function initI18n() {
    if (!i18n || !i18n.getT || !i18n.loadNamespace) return;
    // Capture defaults before any chance of overwriting them.
    captureI18nDefaults();
    let loaded = null;
    try {
        loaded = await i18n.loadNamespace('storage-health-monitor');
    } catch (e) {
        console.warn('i18n load failed', e);
    }
    // Only apply translations if the namespace actually loaded;
    // otherwise leave the page title/labels at their capitalised defaults.
    if (loaded) {
        t = i18n.getT('storage-health-monitor');
        const pageTitle = text('title');
        if (pageTitle !== 'title') {
            document.title = pageTitle;
        }
        updateI18nLabels();
    }
}

function showMessage(msg, type) {
    const m = $('message');
    m.innerHTML = DOMPurify.sanitize(`<div class="message ${type}" role="alert">${escapeHtml(msg)}</div>`);
    setTimeout(() => { m.innerHTML = ''; }, 6000);
}

function badgeClass(h) {
    h = (h || '').toUpperCase();
    if (['OK', 'PASSED', 'GOOD'].includes(h)) return 'badge ok';
    if (h.includes('WARN')) return 'badge warn';
    if (h === 'UNKNOWN' || h === '') return 'badge unknown';
    return 'badge danger';
}

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

async function loadStatus() {
    try {
        const s = await api('status');
        $('status').textContent = s.status === 'running' ? text('running') : s.status;
        $('statusValue').textContent = s.status;
    } catch (e) {
        $('status').textContent = text('error');
        $('status').classList.add('error');
        showMessage(e.message, 'error');
    }
}

async function loadClusters() {
    try {
        const data = await api('clusters');
        state.clusters = Array.isArray(data) ? data : (data.data || []);
        const label = c => `${c.display_name || c.name} ${c.connected ? '' : '(' + text('unreachable') + ')'}`.trim();
        populateSelect('healthCluster', state.clusters, c => c.id, label);
        populateSelect('scrubCluster', state.clusters, c => c.id, label);
        populateSelect('bulkScrubCluster', state.clusters, c => c.id, label);
        populateSelect('reportCluster', state.clusters, c => c.id, label);
        populateSelect('scheduleCluster', state.clusters, c => c.id, label);
        populateSelect('trendsCluster', state.clusters, c => c.id, c => c.display_name || c.name);
        populateSelect('ruleCluster', state.clusters, c => c.id, c => c.display_name || c.name, true);
        populateMultiSelect('compareClusters', state.clusters, c => c.id, c => c.display_name || c.name);
        renderPins();
        if (!state.clusters.length) {
            showMessage('No clusters available', 'error');
        }
    } catch (e) {
        showMessage(text('apiError', { message: e.message }), 'error');
    }
}

function populateSelect(id, items, valueFn, labelFn, includeAll = false, placeholderKey = '') {
    const el = $(id);
    el.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = text(placeholderKey || (id === 'ruleCluster' ? 'all' : 'selectCluster'));
    el.appendChild(placeholder);
    if (includeAll) {
        const opt = document.createElement('option');
        opt.value = '*';
        opt.textContent = '* ' + text('all');
        el.appendChild(opt);
    }
    items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = valueFn(item);
        opt.textContent = labelFn(item);
        el.appendChild(opt);
    });
}

function populateMultiSelect(id, items, valueFn, labelFn) {
    const el = $(id);
    el.innerHTML = '';
    items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = valueFn(item);
        opt.textContent = labelFn(item);
        el.appendChild(opt);
    });
}

function setLoading(id, loading) {
    const el = $(id);
    if (!el) return;
    el.disabled = loading;
    el.dataset.loading = loading;
    el.textContent = loading ? (text('loading') + '…') : text(el.getAttribute('data-i18n') || el.id);
}

function formatSize(b) {
    if (!b) return '-';
    const gb = b / (1024 ** 3);
    if (gb < 1) return (b / (1024 ** 2)).toFixed(1) + ' MB';
    return gb.toFixed(2) + ' GB';
}

function healthIndexClass(idx) {
    if (idx === null || idx === undefined) return 'muted';
    if (idx >= 0.9) return 'health-good';
    if (idx >= 0.7) return 'health-warn';
    return 'health-bad';
}

function filterAndSortDisks() {
    let list = [...state.disks];
    const healthFilter = $('diskFilterHealth') ? $('diskFilterHealth').value : '';
    const nodeFilter = $('diskFilterNode') ? $('diskFilterNode').value : '';
    const query = ($('diskSearch') ? $('diskSearch').value : '').toLowerCase();
    if (healthFilter) list = list.filter(d => d.health.toUpperCase() === healthFilter.toUpperCase());
    if (nodeFilter) list = list.filter(d => d.node === nodeFilter);
    if (query) list = list.filter(d => `${d.node} ${d.devpath} ${d.model} ${d.health}`.toLowerCase().includes(query));

    const { key, dir } = state.sort;
    list.sort((a, b) => {
        let av = a[key] || '';
        let bv = b[key] || '';
        if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ? 1 : -1;
        return 0;
    });
    state.filteredDisks = list;
    state.page = 1;
    renderDiskTable();
}

function renderDiskTable() {
    const result = $('healthResult');
    if (!state.disks.length) {
        result.innerHTML = DOMPurify.sanitize(`<p class="empty">${text('noDisks')}</p>`);
        return;
    }

    const healthOptions = [...new Set(state.disks.map(d => d.health))].filter(Boolean);
    const nodeOptions = [...new Set(state.disks.map(d => d.node))].filter(Boolean).sort();

    const allKeys = new Set([...state.selectedDisks]);
    const start = (state.page - 1) * state.pageSize;
    const page = state.filteredDisks.slice(start, start + state.pageSize);
    const totalPages = Math.max(1, Math.ceil(state.filteredDisks.length / state.pageSize));

    const headers = [
        { key: 'select', label: `<input type="checkbox" id="selectAllDisks" ${state.selectedDisks.size === state.filteredDisks.length && state.filteredDisks.length ? 'checked' : ''}>` },
        { key: 'node', label: text('node') },
        { key: 'devpath', label: text('device') },
        { key: 'health', label: text('healthColumn') },
        { key: 'size', label: text('size') },
        { key: 'model', label: text('model') },
        { key: 'expand', label: text('details') },
    ];

    let html = `<div class="toolbar">
                <select id="diskFilterHealth" aria-label="${text('filter')} ${text('healthColumn')}">
                    <option value="">${text('filter')} ${text('healthColumn')}</option>
                    ${healthOptions.map(h => `<option value="${h}">${escapeHtml(h)}</option>`).join('')}
                </select>
                <select id="diskFilterNode" aria-label="${text('filter')} ${text('node')}">
                    <option value="">${text('filter')} ${text('node')}</option>
                    ${nodeOptions.map(n => `<option value="${n}">${escapeHtml(n)}</option>`).join('')}
                </select>
                <input id="diskSearch" type="search" placeholder="${text('search')}" aria-label="${text('search')}">
                <button class="secondary" id="exportCSV" type="button">${text('exportCSV')}</button>
                <button class="secondary" id="exportJSON" type="button">${text('exportJSON')}</button>
                <span class="muted">${state.filteredDisks.length} / ${state.disks.length}</span>
            </div>`;

    html += '<table><thead><tr>' + headers.map(h =>
        `<th>${h.key !== 'select' && h.key !== 'expand' ? `<button type="button" data-sort="${h.key}" class="sort-btn">${h.label}</button>` : h.label}</th>`
    ).join('') + '</tr></thead><tbody>';

    page.forEach(d => {
        const selected = state.selectedDisks.has(d.devpath + '@' + d.node);
        const expanded = state.expanded.has(d.devpath + '@' + d.node);
        const changedClass = d.changed ? 'changed' : '';
        const tooltip = text('tooltip' + (d.health || 'Unknown'));
        const prev = d.previous_health ? ` · ${text('previousHealth')}: ${escapeHtml(d.previous_health)}` : '';
        html += `<tr data-key="${escapeHtml(d.devpath)}@${escapeHtml(d.node)}" class="${changedClass}">
                    <td><input type="checkbox" class="disk-check" ${selected ? 'checked' : ''}></td>
                    <td class="muted">${escapeHtml(d.node || '-')}</td>
                    <td>${escapeHtml(d.devpath || '-')}</td>
                    <td data-tooltip="${tooltip}"><span class="${badgeClass(d.health)}">${d.health ? escapeHtml(d.health) : text('unknown')}</span></td>
                    <td class="muted" data-tooltip="${escapeHtml(d.size)} bytes">${formatSize(d.size)}</td>
                    <td class="muted">${escapeHtml(d.model || '-')}</td>
                    <td><button type="button" class="secondary expander" data-expand data-tooltip="${text('tooltipExpand')}">${expanded ? text('collapse') : text('expand')}</button></td>
                </tr>`;
        if (expanded) {
            html += `<tr><td colspan="7"><div class="detail">${text('serial')}: ${escapeHtml(d.serial || '-')} · ${text('wear')}: ${d.wearout !== '' ? escapeHtml(d.wearout) : '-'} · ${text('temperature')}: ${d.temperature !== '' ? escapeHtml(d.temperature) : '-'}${prev}</div></td></tr>`;
        }
    });

    html += '</tbody></table>';
    html += `<div class="pagination">
                <button type="button" class="secondary" id="prevPage" ${state.page === 1 ? 'disabled' : ''}>←</button>
                <span class="muted">${state.page} / ${totalPages}</span>
                <button type="button" class="secondary" id="nextPage" ${state.page >= totalPages ? 'disabled' : ''}>→</button>
                <select id="pageSize" aria-label="Page size">
                    <option value="25" ${state.pageSize === 25 ? 'selected' : ''}>25</option>
                    <option value="50" ${state.pageSize === 50 ? 'selected' : ''}>50</option>
                    <option value="100" ${state.pageSize === 100 ? 'selected' : ''}>100</option>
                </select>
            </div>`;

    result.innerHTML = DOMPurify.sanitize(html);

    result.querySelectorAll('.sort-btn').forEach(btn => btn.addEventListener('click', e => {
        const key = e.target.dataset.sort;
        state.sort.dir = state.sort.key === key && state.sort.dir === 'asc' ? 'desc' : 'asc';
        state.sort.key = key;
        filterAndSortDisks();
    }));

    result.querySelectorAll('[data-expand]').forEach(btn => btn.addEventListener('click', e => {
        const tr = e.target.closest('tr');
        const key = tr.dataset.key;
        if (state.expanded.has(key)) state.expanded.delete(key);
        else state.expanded.add(key);
        renderDiskTable();
    }));

    result.querySelectorAll('.disk-check').forEach(cb => cb.addEventListener('change', e => {
        const tr = e.target.closest('tr');
        const key = tr.dataset.key;
        if (e.target.checked) state.selectedDisks.add(key);
        else state.selectedDisks.delete(key);
        renderDiskTable();
    }));

    $('selectAllDisks').addEventListener('change', e => {
        if (e.target.checked) {
            state.filteredDisks.forEach(d => state.selectedDisks.add(`${d.devpath}@${d.node}`));
        } else {
            state.selectedDisks.clear();
        }
        renderDiskTable();
    });

    $('prevPage').addEventListener('click', () => { if (state.page > 1) { state.page--; renderDiskTable(); } });
    $('nextPage').addEventListener('click', () => { if (state.page < totalPages) { state.page++; renderDiskTable(); } });
    $('pageSize').addEventListener('change', e => { state.pageSize = parseInt(e.target.value); state.page = 1; renderDiskTable(); });

    $('diskFilterHealth').value = $('diskFilterHealth').value || '';
    $('diskFilterNode').value = $('diskFilterNode').value || '';
    $('diskFilterHealth').addEventListener('change', filterAndSortDisks);
    $('diskFilterNode').addEventListener('change', filterAndSortDisks);
    $('diskSearch').addEventListener('input', debounce(filterAndSortDisks, 200));
    $('exportCSV').addEventListener('click', exportCSV);
    $('exportJSON').addEventListener('click', exportJSON);
}

function debounce(fn, ms) {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

function exportCSV() {
    const rows = (state.selectedDisks.size ? state.filteredDisks.filter(d => state.selectedDisks.has(`${d.devpath}@${d.node}`)) : state.filteredDisks);
    const header = [text('node'), text('device'), text('healthColumn'), text('size'), text('model'), text('serial'), text('wear'), text('temperature')];
    const csv = [header, ...rows.map(d => [d.node, d.devpath, d.health, d.size, d.model, d.serial, d.wearout, d.temperature])]
        .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `storage-health-${new Date().toISOString().slice(0, 19)}.csv`;
    a.click();
}

function exportJSON() {
    const rows = (state.selectedDisks.size ? state.filteredDisks.filter(d => state.selectedDisks.has(`${d.devpath}@${d.node}`)) : state.filteredDisks);
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `storage-health-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
}

async function runHealthCheck(dry = false) {
    const clusterId = $('healthCluster').value;
    if (!clusterId) {
        showMessage(text('validationRequired', { field: text('cluster') }), 'error');
        return;
    }
    const btn = dry ? 'dryRunBtn' : 'checkBtn';
    setLoading(btn, true);
    try {
        const data = await api(`health?cluster_id=${encodeURIComponent(clusterId)}&dry_run=${dry ? 1 : 0}`);
        if (data.dry_run) {
            showMessage(text('dryRunResult', { cluster: clusterId }), 'info');
            $('healthIndex').textContent = '-';
            $('healthIndex').className = 'value';
            $('healthyCount').textContent = '0';
            $('warningCount').textContent = '0';
            $('failingCount').textContent = '0';
            $('lastCheck').textContent = text('notChecked');
            state.disks = [];
            renderDiskTable();
        } else {
            state.disks = data.disks || [];
            state.thresholds = data.thresholds || state.thresholds;
            $('healthIndex').textContent = data.health_index ?? '-';
            $('healthIndex').className = 'value ' + healthIndexClass(data.health_index);
            $('healthyCount').textContent = data.healthy_disks ?? 0;
            $('warningCount').textContent = data.warning_disks ?? 0;
            $('failingCount').textContent = (data.failing_disks ?? 0) + (data.unknown_disks ? ' / ' + data.unknown_disks + ' ' + text('unknown') : '');
            $('lastCheck').textContent = data.checked_at ? new Date(data.checked_at).toLocaleString() : text('notChecked');
            $('nextCheck').textContent = data.next_check_at ? new Date(data.next_check_at).toLocaleString() : text('notChecked');
            const th = state.thresholds;
            const meets = data.meets_threshold;
            const thresholdMsg = meets ? text('thresholdMet', { pct: th.min_ok_percentage }) : text('thresholdNotMet', { pct: th.min_ok_percentage });
            const thEl = $('thresholdStatus');
            thEl.textContent = thresholdMsg;
            thEl.className = 'message ' + (meets ? 'success' : 'error');
            thEl.style.display = '';
            state.expanded.clear();
            state.selectedDisks.clear();
            filterAndSortDisks();
            loadSchedule();
            showMessage(text('healthy') + ': ' + (data.healthy_disks || 0), 'success');
        }
    } catch (err) {
        showMessage(text('apiError', { message: err.message }), 'error');
    } finally {
        setLoading(btn, false);
    }
}

$('healthForm').addEventListener('submit', e => { e.preventDefault(); runHealthCheck(false); });
$('dryRunBtn').addEventListener('click', () => runHealthCheck(true));
$('refreshBtn').addEventListener('click', () => runHealthCheck(false));
$('autoRefresh').addEventListener('change', e => {
    if (state.autoTimer) { clearInterval(state.autoTimer); state.autoTimer = null; }
    const v = parseInt(e.target.value);
    state.autoRefresh = v;
    if (v > 0) state.autoTimer = setInterval(() => { if ($('healthCluster').value) runHealthCheck(false); }, v * 1000);
});

async function onScrubClusterChange() {
    const clusterId = $('scrubCluster').value;
    $('scrubNode').disabled = true;
    $('scrubStorage').disabled = true;
    $('scrubNode').innerHTML = DOMPurify.sanitize(`<option value="">${text('selectNode')}</option>`);
    $('scrubStorage').innerHTML = DOMPurify.sanitize(`<option value="">${text('selectStorage')}</option>`);
    if (!clusterId) return;
    try {
        const data = await api(`nodes?cluster_id=${encodeURIComponent(clusterId)}`);
        state.nodes = data.data || [];
        populateSelect('scrubNode', state.nodes, n => n.name, n => `${n.name} (${n.status})`, false, 'selectNode');
        $('scrubNode').disabled = false;
    } catch (e) { showMessage(text('apiError', { message: e.message }), 'error'); }
}

async function onScrubNodeChange() {
    const clusterId = $('scrubCluster').value;
    const node = $('scrubNode').value;
    $('scrubStorage').disabled = true;
    $('scrubStorage').innerHTML = DOMPurify.sanitize(`<option value="">${text('selectStorage')}</option>`);
    if (!clusterId || !node) return;
    try {
        const data = await api(`storages?cluster_id=${encodeURIComponent(clusterId)}&node=${encodeURIComponent(node)}`);
        state.storages = data.data || [];
        populateSelect('scrubStorage', state.storages, s => s.name, s => `${s.name} (${s.type})`, false, 'selectStorage');
        $('scrubStorage').disabled = false;
    } catch (e) { showMessage(text('apiError', { message: e.message }), 'error'); }
}

$('scrubCluster').addEventListener('change', onScrubClusterChange);
$('scrubNode').addEventListener('change', onScrubNodeChange);

$('scrubForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const clusterId = $('scrubCluster').value;
    const node = $('scrubNode').value;
    const storage = $('scrubStorage').value;
    if (!node || !storage) {
        showMessage(text('validationNodeStorage'), 'error');
        return;
    }
    setLoading('scrubBtn', true);
    try {
        const data = await api('start-scrub', 'POST', { cluster_id: clusterId, node, storage });
        $('scrubResult').innerHTML = DOMPurify.sanitize(`<p class="message success">${text('scrubStarted', { job: data.job_id, node: data.node, storage: data.storage })} <span class="badge">${escapeHtml(data.status)}</span></p>`);
        showToast(text('scrubStarted', { job: data.job_id, node: data.node, storage: data.storage }), 'success');
        await loadHistory();
    } catch (err) {
        $('scrubResult').innerHTML = DOMPurify.sanitize(`<p class="message error">${text('apiError', { message: err.message })}</p>`);
    } finally { setLoading('scrubBtn', false); }
});

async function loadHistory() {
    try {
        const params = new URLSearchParams();
        const node = $('historyFilterNode').value.trim();
        const storage = $('historyFilterStorage').value.trim();
        const status = $('historyFilterStatus').value;
        if (node) params.set('node', node);
        if (storage) params.set('storage', storage);
        if (status) params.set('status', status);
        const data = await api('scrub-history?' + params.toString());
        state.history = data.data || [];
        renderHistory();
    } catch (e) { showMessage(text('apiError', { message: e.message }), 'error'); }
}

function renderHistory() {
    const el = $('historyResult');
    if (!state.history.length) {
        el.innerHTML = DOMPurify.sanitize(`<p class="empty">${text('noHistory')}</p>`);
        return;
    }
    let html = '<table><thead><tr><th>' + text('jobId') + '</th><th>' + text('node') + '</th><th>' + text('storage') + '</th><th>' + text('status') + '</th><th>' + text('startedAt') + '</th><th>' + text('actions') + '</th></tr></thead><tbody>';
    state.history.forEach(h => {
        html += `<tr data-job="${escapeHtml(h.job_id)}">
                    <td class="muted">${escapeHtml(h.job_id)}</td>
                    <td>${escapeHtml(h.node)}</td>
                    <td>${escapeHtml(h.storage)}</td>
                    <td><span class="badge ${h.status === 'completed' ? 'ok' : h.status === 'cancelled' || h.status === 'failed' ? 'danger' : 'warn'}">${escapeHtml(h.status)}</span></td>
                    <td class="muted">${h.started_at ? new Date(h.started_at).toLocaleString() : '-'}</td>
                    <td>
                        ${h.status === 'started' || h.status === 'running' ? `<button class="secondary cancel-job" data-job="${escapeHtml(h.job_id)}">${text('cancel')}</button>` : ''}
                        <button class="secondary expander" data-expand>${state.expanded.has(h.job_id) ? text('collapse') : text('expand')}</button>
                    </td>
                </tr>`;
        if (state.expanded.has(h.job_id)) {
            html += `<tr><td colspan="6"><div class="detail">${JSON.stringify(h.result || {}, null, 2)}</div></td></tr>`;
        }
    });
    html += '</tbody></table>';
    el.innerHTML = DOMPurify.sanitize(html);
    el.querySelectorAll('.cancel-job').forEach(btn => btn.addEventListener('click', async (e) => {
        const jobId = e.target.dataset.job;
        try {
            await api('scrub/cancel', 'POST', { job_id: jobId });
            showMessage(text('scrubCancelled', { job: jobId }), 'success');
            await loadHistory();
        } catch (err) { showMessage(text('apiError', { message: err.message }), 'error'); }
    }));
    el.querySelectorAll('[data-expand]').forEach(btn => btn.addEventListener('click', (e) => {
        const job = e.target.closest('tr').dataset.job;
        if (state.expanded.has(job)) state.expanded.delete(job);
        else state.expanded.add(job);
        renderHistory();
    }));
}

$('historyFilterNode').addEventListener('input', debounce(loadHistory, 300));
$('historyFilterStorage').addEventListener('input', debounce(loadHistory, 300));
$('historyFilterStatus').addEventListener('change', loadHistory);
$('historyRefresh').addEventListener('click', loadHistory);

async function loadTrends() {
    const clusterId = $('trendsCluster').value;
    if (!clusterId) return;
    const params = new URLSearchParams();
    params.set('cluster_id', clusterId);
    if ($('trendsStart').value) params.set('start', new Date($('trendsStart').value).toISOString());
    if ($('trendsEnd').value) params.set('end', new Date($('trendsEnd').value).toISOString());
    params.set('interval', $('trendsInterval').value);
    try {
        const data = await api('trends?' + params.toString());
        state.snapshots = data.data || [];
        renderTrends();
    } catch (e) { showMessage(text('apiError', { message: e.message }), 'error'); }
}

function renderTrends() {
    const el = $('trendsResult');
    if (!state.snapshots.length) {
        el.innerHTML = DOMPurify.sanitize(`<p class="empty">${text('noTrends')}</p>`);
        return;
    }
    let html = '<table><thead><tr><th>' + text('auditTime') + '</th><th>' + text('healthIndex') + '</th><th>' + text('healthy') + '</th><th>' + text('warning') + '</th><th>' + text('failing') + '</th><th>' + text('total') + '</th></tr></thead><tbody>';
    state.snapshots.forEach(s => {
        html += `<tr>
                    <td class="muted">${s.timestamp ? new Date(s.timestamp).toLocaleString() : '-'}</td>
                    <td>${escapeHtml(s.health_index ?? '-')}</td>
                    <td class="health-good">${escapeHtml(s.healthy_disks ?? 0)}</td>
                    <td class="health-warn">${escapeHtml(s.warning_disks ?? 0)}</td>
                    <td class="health-bad">${escapeHtml(s.failing_disks ?? 0)}</td>
                    <td>${escapeHtml(s.total_disks ?? 0)}</td>
                </tr>`;
    });
    html += '</tbody></table>';
    el.innerHTML = DOMPurify.sanitize(html);
}

$('trendsLoad').addEventListener('click', loadTrends);

async function loadAlerts() {
    try {
        const [rules, active] = await Promise.all([api('alerts/rules'), api('alerts/active')]);
        state.rules = rules.data || [];
        state.alerts = active.data || [];
        renderRules();
        renderActiveAlerts();
    } catch (e) { showMessage(text('apiError', { message: e.message }), 'error'); }
}

function renderRules() {
    const el = $('rulesResult');
    if (!state.rules.length) { el.innerHTML = DOMPurify.sanitize(`<p class="empty">${text('noData')}</p>`); return; }
    let html = '<table><thead><tr><th>' + text('cluster') + '</th><th>' + text('threshold') + '</th><th>' + text('operator') + '</th><th>' + text('value') + '</th><th>' + text('channels') + '</th><th>' + text('status') + '</th><th>' + text('actions') + '</th></tr></thead><tbody>';
    state.rules.forEach(r => {
        html += `<tr>
                    <td>${escapeHtml(r.cluster_id)}</td>
                    <td>${escapeHtml(r.threshold)}</td>
                    <td>${escapeHtml(r.operator)}</td>
                    <td>${escapeHtml(r.value)}</td>
                    <td class="muted">${(r.channels || []).map(c => escapeHtml(c)).join(', ')}</td>
                    <td><span class="badge ${r.enabled ? 'ok' : 'unknown'}">${r.enabled ? 'enabled' : 'disabled'}</span></td>
                    <td><button class="secondary toggle-rule" data-id="${escapeHtml(r.id)}">${r.enabled ? 'disable' : 'enable'}</button> <button class="secondary delete-rule" data-id="${escapeHtml(r.id)}">${text('delete')}</button></td>
                </tr>`;
    });
    html += '</tbody></table>';
    el.innerHTML = DOMPurify.sanitize(html);
    el.querySelectorAll('.toggle-rule').forEach(btn => btn.addEventListener('click', async (e) => {
        const rule = state.rules.find(r => r.id === e.target.dataset.id);
        if (!rule) return;
        rule.enabled = !rule.enabled;
        try { await api('alerts/rules', 'POST', rule); await loadAlerts(); }
        catch (err) { showMessage(text('apiError', { message: err.message }), 'error'); }
    }));
    el.querySelectorAll('.delete-rule').forEach(btn => btn.addEventListener('click', async (e) => {
        if (!confirm('Delete this rule?')) return;
        try { await api('alerts/rules', 'DELETE', { id: e.target.dataset.id }); await loadAlerts(); }
        catch (err) { showMessage(text('apiError', { message: err.message }), 'error'); }
    }));
}

function renderActiveAlerts() {
    const el = $('activeAlertsResult');
    if (!state.alerts.length) { el.innerHTML = DOMPurify.sanitize(`<p class="empty">${text('noAlerts')}</p>`); return; }
    let html = '<table><thead><tr><th>' + text('cluster') + '</th><th>' + text('message') + '</th><th>' + text('severity') + '</th><th>' + text('auditTime') + '</th><th>' + text('actions') + '</th></tr></thead><tbody>';
    state.alerts.forEach(a => {
        html += `<tr>
                    <td>${escapeHtml(a.cluster_id)}</td>
                    <td>${escapeHtml(a.message)}</td>
                    <td><span class="badge ${a.severity === 'danger' ? 'danger' : 'warn'}">${escapeHtml(a.severity)}</span></td>
                    <td class="muted">${a.created_at ? new Date(a.created_at).toLocaleString() : '-'}</td>
                    <td>${a.resolved_at ? `<span class="muted">${text('resolved')} ${new Date(a.resolved_at).toLocaleString()}</span>` : `<button class="secondary resolve-alert" data-id="${escapeHtml(a.id)}">${text('resolve')}</button>`}</td>
                </tr>`;
    });
    html += '</tbody></table>';
    el.innerHTML = DOMPurify.sanitize(html);
    el.querySelectorAll('.resolve-alert').forEach(btn => btn.addEventListener('click', async (e) => {
        try { await api('alerts/resolve', 'POST', { id: e.target.dataset.id }); await loadAlerts(); }
        catch (err) { showMessage(text('apiError', { message: err.message }), 'error'); }
    }));
}

$('ruleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const channels = Array.from(f.channels.selectedOptions).map(o => o.value);
    const rule = {
        cluster_id: f.cluster_id.value,
        threshold: f.threshold.value,
        operator: f.operator.value,
        value: parseFloat(f.value.value),
        channels,
        email: f.email.value,
        webhook_url: f.webhook_url.value,
        enabled: true,
    };
    try {
        await api('alerts/rules', 'POST', rule);
        f.reset();
        await loadAlerts();
    } catch (err) { showMessage(text('apiError', { message: err.message }), 'error'); }
});

async function loadAudit() {
    const action = $('auditAction').value;
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    try {
        const data = await api('audit?' + params.toString());
        state.audit = data.data || [];
        renderAudit();
    } catch (e) { showMessage(text('apiError', { message: e.message }), 'error'); }
}

function renderAudit() {
    const el = $('auditResult');
    if (!state.audit.length) { el.innerHTML = DOMPurify.sanitize(`<p class="empty">${text('noAudit')}</p>`); return; }
    let html = '<table><thead><tr><th>' + text('auditAction') + '</th><th>' + text('auditCluster') + '</th><th>' + text('auditUser') + '</th><th>' + text('auditTime') + '</th></tr></thead><tbody>';
    state.audit.forEach(e => {
        html += `<tr>
                    <td>${escapeHtml(e.action)}</td>
                    <td>${escapeHtml(e.cluster_id || '-')}</td>
                    <td>${escapeHtml(e.user)}</td>
                    <td class="muted">${e.timestamp ? new Date(e.timestamp).toLocaleString() : '-'}</td>
                </tr>`;
    });
    html += '</tbody></table>';
    el.innerHTML = DOMPurify.sanitize(html);
}

$('auditAction').addEventListener('change', loadAudit);
$('auditRefresh').addEventListener('click', loadAudit);

function savePins() {
    localStorage.setItem('storageHealthPins', JSON.stringify(state.pins));
}

function renderPins() {
    const bar = $('pinBar');
    if (!bar) return;
    const current = $('healthCluster').value;
    let html = `<button type="button" class="secondary" id="addPinBtn" ${current ? '' : 'disabled'}>${text('pin')}</button>`;
    if (state.pins.length) {
        html += state.pins.map(c => {
            const cl = state.clusters.find(x => x.id === c);
            const name = cl ? (cl.display_name || cl.name) : c;
            return `<span class="pin" data-pin="${escapeHtml(c)}">${escapeHtml(name)}<span class="close" data-unpin="${escapeHtml(c)}">&times;</span></span>`;
        }).join('');
    }
    bar.innerHTML = DOMPurify.sanitize(html);
    const addBtn = $('addPinBtn');
    if (addBtn) addBtn.addEventListener('click', () => { if (current && !state.pins.includes(current)) { state.pins.push(current); savePins(); renderPins(); } });
    bar.querySelectorAll('[data-unpin]').forEach(btn => btn.addEventListener('click', (e) => {
        const id = e.target.dataset.unpin;
        state.pins = state.pins.filter(p => p !== id);
        savePins();
        renderPins();
    }));
    bar.querySelectorAll('[data-pin]:not([data-unpin])').forEach(el => el.addEventListener('click', () => {
        $('healthCluster').value = el.dataset.pin;
        runHealthCheck(false);
    }));
}

$('healthCluster').addEventListener('change', renderPins);

async function loadSchedule() {
    const clusterId = $('healthCluster').value || $('scheduleCluster').value;
    if (!clusterId) return;
    try {
        const data = await api(`schedule?cluster_id=${encodeURIComponent(clusterId)}`);
        state.schedule = data;
        const result = $('scheduleResult');
        if (result) result.innerHTML = DOMPurify.sanitize(`<p class="message info">${text('lastCheck')}: ${data.last_check_at ? new Date(data.last_check_at).toLocaleString() : text('notChecked')} · ${text('nextCheck')}: ${data.next_check_at ? new Date(data.next_check_at).toLocaleString() : text('notChecked')}</p>`);
        const input = $('scheduleInterval');
        if (input && !input.matches(':focus')) input.value = data.interval_minutes;
    } catch (e) { showMessage(text('apiError', { message: e.message }), 'error'); }
}

$('scheduleCluster').addEventListener('change', loadSchedule);

$('scheduleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const clusterId = $('scheduleCluster').value;
    const interval = parseInt($('scheduleInterval').value) || 0;
    try {
        await api('schedule?cluster_id=' + encodeURIComponent(clusterId), 'POST', { cluster_id: clusterId, interval_minutes: interval });
        showMessage(text('saved'), 'success');
        loadSchedule();
    } catch (err) { showMessage(text('apiError', { message: err.message }), 'error'); }
});

$('scheduleRefresh').addEventListener('click', loadSchedule);

async function onBulkScrubClusterChange() {
    const clusterId = $('bulkScrubCluster').value;
    $('bulkScrubNode').disabled = true;
    $('bulkScrubStorages').innerHTML = '';
    if (!clusterId) return;
    try {
        const data = await api(`nodes?cluster_id=${encodeURIComponent(clusterId)}`);
        populateSelect('bulkScrubNode', data.data || [], n => n.name, n => `${n.name} (${n.status})`, false, 'selectNode');
        $('bulkScrubNode').disabled = false;
    } catch (e) { showMessage(text('apiError', { message: e.message }), 'error'); }
}

async function onBulkScrubNodeChange() {
    const clusterId = $('bulkScrubCluster').value;
    const node = $('bulkScrubNode').value;
    const container = $('bulkScrubStorages');
    container.innerHTML = '';
    if (!clusterId || !node) return;
    try {
        const data = await api(`storages?cluster_id=${encodeURIComponent(clusterId)}&node=${encodeURIComponent(node)}`);
        state.bulkStorages = data.data || [];
        state.bulkStorages.forEach(s => {
            const label = document.createElement('label');
            label.innerHTML = DOMPurify.sanitize(`<input type="checkbox" value="${escapeHtml(s.name)}" class="bulk-storage-check"> ${escapeHtml(s.name)} (${escapeHtml(s.type)})`);
            container.appendChild(label);
        });
    } catch (e) { showMessage(text('apiError', { message: e.message }), 'error'); }
}

$('bulkScrubCluster').addEventListener('change', onBulkScrubClusterChange);
$('bulkScrubNode').addEventListener('change', onBulkScrubNodeChange);

$('bulkScrubForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const clusterId = $('bulkScrubCluster').value;
    const node = $('bulkScrubNode').value;
    const selected = Array.from(document.querySelectorAll('.bulk-storage-check:checked')).map(cb => cb.value);
    if (!node || !selected.length) { showMessage(text('validationNodeStorage'), 'error'); return; }
    setLoading('bulkScrubBtn', true);
    try {
        const data = await api('scrub/bulk', 'POST', { cluster_id: clusterId, node, storages: selected });
        const count = (data.data || []).length;
        showMessage(text('bulkScrubStarted', { count }), 'success');
        await loadHistory();
    } catch (err) { showMessage(text('apiError', { message: err.message }), 'error'); }
    finally { setLoading('bulkScrubBtn', false); }
});

$('compareForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const selected = Array.from($('compareClusters').selectedOptions).map(o => o.value);
    if (!selected.length) { showMessage(text('selectCluster'), 'error'); return; }
    try {
        const data = await api(`compare?cluster_ids=${encodeURIComponent(selected.join(','))}`);
        state.compare = data.data || [];
        renderCompare();
    } catch (err) { showMessage(text('apiError', { message: err.message }), 'error'); }
});

function renderCompare() {
    const el = $('compareResult');
    if (!state.compare.length) { el.innerHTML = DOMPurify.sanitize(`<p class="empty">${text('noData')}</p>`); return; }
    let html = '<table><thead><tr><th>' + text('cluster') + '</th><th>' + text('healthIndex') + '</th><th>' + text('healthy') + '</th><th>' + text('warning') + '</th><th>' + text('failing') + '</th><th>' + text('total') + '</th><th>' + text('auditTime') + '</th></tr></thead><tbody>';
    state.compare.forEach(c => {
        html += `<tr>
                    <td class="muted">${escapeHtml(c.cluster_id)}</td>
                    <td>${escapeHtml(c.health_index ?? '-')}</td>
                    <td class="health-good">${escapeHtml(c.healthy_disks ?? 0)}</td>
                    <td class="health-warn">${escapeHtml(c.warning_disks ?? 0)}</td>
                    <td class="health-bad">${escapeHtml(c.failing_disks ?? 0)}</td>
                    <td>${escapeHtml(c.total_disks ?? 0)}</td>
                    <td class="muted">${c.timestamp ? new Date(c.timestamp).toLocaleString() : '-'}</td>
                </tr>`;
    });
    html += '</tbody></table>';
    el.innerHTML = DOMPurify.sanitize(html);
}

$('reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const clusterId = $('reportCluster').value;
    if (!clusterId) { showMessage(text('selectCluster'), 'error'); return; }
    try {
        const data = await api(`report?cluster_id=${encodeURIComponent(clusterId)}`);
        const result = $('reportResult');
        const summary = `<div class="grid"><div class="card"><div class="title">${text('healthIndex')}</div><div class="value">${data.health_index ?? '-'}</div></div><div class="card"><div class="title">${text('healthy')}</div><div class="value">${data.healthy_disks ?? 0}</div></div><div class="card"><div class="title">${text('warning')}</div><div class="value">${data.warning_disks ?? 0}</div></div><div class="card"><div class="title">${text('failing')}</div><div class="value">${data.failing_disks ?? 0}</div></div></div>`;
        let html = summary + '<table><thead><tr><th>' + text('node') + '</th><th>' + text('device') + '</th><th>' + text('healthColumn') + '</th><th>' + text('size') + '</th><th>' + text('model') + '</th></tr></thead><tbody>';
        (data.disks || []).forEach(d => {
            html += `<tr class="${d.changed ? 'changed' : ''}"><td>${escapeHtml(d.node)}</td><td>${escapeHtml(d.devpath)}</td><td><span class="${badgeClass(d.health)}">${d.health ? escapeHtml(d.health) : '-'}</span></td><td class="muted">${formatSize(d.size)}</td><td class="muted">${escapeHtml(d.model || '-')}</td></tr>`;
        });
        html += '</tbody></table>';
        result.innerHTML = DOMPurify.sanitize(html);
    } catch (err) { showMessage(text('apiError', { message: err.message }), 'error'); }
});

$('printReport').addEventListener('click', () => { window.print(); });
$('shareReport').addEventListener('click', () => {
    const clusterId = $('reportCluster').value;
    const url = `${window.location.origin}${window.location.pathname}?cluster=${encodeURIComponent(clusterId)}`;
    navigator.clipboard.writeText(url).then(() => showMessage(text('linkCopied'), 'success')).catch(() => showMessage(text('copyFailed'), 'error'));
});

async function loadWidget() {
    try {
        const data = await api('clusters');
        const clusters = data.data || [];
        const counts = await Promise.all(clusters.map(c => api(`health?cluster_id=${encodeURIComponent(c.id)}`).catch(() => ({}))));
        const el = $('widgetResult');
        let html = '';
        clusters.forEach((c, i) => {
            const r = counts[i] || {};
            html += `<div class="card"><div class="title">${escapeHtml(c.display_name || c.name)}</div><div class="value ${healthIndexClass(r.health_index)}">${escapeHtml(r.health_index ?? '-')}</div><div class="muted">${escapeHtml(r.healthy_disks ?? 0)}/${escapeHtml(r.total_disks ?? 0)} OK</div></div>`;
        });
        el.innerHTML = DOMPurify.sanitize(html || `<p class="empty">${text('noData')}</p>`);
    } catch (e) { showMessage(text('apiError', { message: e.message }), 'error'); }
}

function showToast(message, type = 'info') {
    if (window.parent && window.parent.postMessage) {
        window.parent.postMessage({ type: 'ProxmoxVEx-toast', message, level: type }, '*');
    }
}

function watchTheme() {
    // The main app broadcasts theme changes to plugin iframes via postMessage.
    try {
        window.addEventListener('message', (e) => {
            if (e.origin !== window.location.origin) return;
            if (e.data && e.data.type === 'theme' && e.data.theme) setTheme(e.data.theme);
        });
    } catch (_) { /* cross-origin is ok */ }
}

// Tabs
const tabs = $$('.tab');
const sections = $$('.section');
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const name = tab.dataset.tab;
        tabs.forEach(t => { t.setAttribute('aria-selected', 'false'); t.setAttribute('tabindex', '-1'); });
        sections.forEach(s => { s.classList.remove('active'); s.hidden = true; });
        tab.setAttribute('aria-selected', 'true'); tab.setAttribute('tabindex', '0');
        $(name + 'Section').classList.add('active'); $(name + 'Section').hidden = false;
        if (name === 'history') loadHistory();
        if (name === 'trends') loadTrends();
        if (name === 'alerts') loadAlerts();
        if (name === 'audit') loadAudit();
        if (name === 'compare') loadClusters();
        if (name === 'schedule') loadSchedule();
        if (name === 'report') loadClusters();
        if (name === 'widget') loadWidget();
    });
    tab.addEventListener('keydown', (e) => {
        const idx = tabs.indexOf(document.activeElement);
        if (e.key === 'ArrowRight') { tabs[(idx + 1) % tabs.length].focus(); tabs[(idx + 1) % tabs.length].click(); }
        if (e.key === 'ArrowLeft') { tabs[(idx - 1 + tabs.length) % tabs.length].focus(); tabs[(idx - 1 + tabs.length) % tabs.length].click(); }
    });
});

(async () => {
    await initI18n();
    await Promise.all([loadStatus(), loadClusters()]);
    if ($('trendsStart')) $('trendsStart').value = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 16);
    if ($('trendsEnd')) $('trendsEnd').value = new Date().toISOString().slice(0, 16);
    watchTheme();
    const clusterFromUrl = new URLSearchParams(window.location.search).get('cluster');
    if (clusterFromUrl) {
        const c = state.clusters.find(x => x.id === clusterFromUrl);
        if (c) { $('healthCluster').value = clusterFromUrl; runHealthCheck(false); }
    }
})();
