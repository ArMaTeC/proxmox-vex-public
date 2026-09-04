/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/storage-rebalancer/ui.js
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
function watchTheme() {
    try {
        window.addEventListener('message', (e) => {
            if (e.origin !== window.location.origin) return;
            if (e.data && e.data.type === 'theme' && e.data.theme) setTheme(e.data.theme);
        });
    } catch (_) { }
}
watchTheme();

const i18n = (window.parent && window.parent.ProxmoxVExI18n) || null;
const t = i18n ? i18n.getT('storage-rebalancer') : (k) => k;

function captureI18nDefaults() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        if (!el.dataset.i18nDefault) {
            el.dataset.i18nDefault = el.textContent;
        }
    });
}

function applyI18n() {
    if (!i18n) return;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const fallback = el.dataset.i18nDefault || el.textContent;
        const translated = t(key);
        if (translated === key) {
            if (el.tagName === 'OPTION') el.textContent = fallback;
            else if (!el.querySelector('input, select, textarea')) el.firstChild && el.childNodes[0].nodeType === 3 ? el.childNodes[0].textContent = fallback : el.textContent = fallback;
            return;
        }
        if (el.tagName === 'OPTION') el.textContent = translated;
        else if (!el.querySelector('input, select, textarea')) el.firstChild && el.childNodes[0].nodeType === 3 ? el.childNodes[0].textContent = translated + ' ' : el.textContent = translated;
    });
}

const $ = (id) => document.getElementById(id);
const $q = (sel) => document.querySelector(sel);

let clusters = [];
let currentAnalysis = null;
let selectedVms = new Set();
let bulkPlans = [];
let autoRefreshInterval = null;
let currentHistory = [];

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function showMessage(text, type = 'info', timeout = 5000) {
    const m = $('message');
    m.innerHTML = DOMPurify.sanitize(`<div class="message ${type}">${escapeHtml(text)}</div>`);
    if (timeout) setTimeout(() => { m.innerHTML = ''; }, timeout);
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

function formatKB(kb) {
    if (!kb && kb !== 0) return '-';
    const gb = kb / (1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = kb / 1024;
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${kb} KB`;
}

function stateClass(state) {
    if (state === 'danger') return 'danger';
    if (state === 'warning') return 'warning';
    return 'ok';
}

function getThresholdsFromInputs() {
    return {
        warning: parseInt($('warnThreshold').value) || 70,
        danger: parseInt($('dangerThreshold').value) || 90
    };
}

function vmState(percent, thresholds) {
    if (percent >= thresholds.danger) return 'danger';
    if (percent >= thresholds.warning) return 'warning';
    return 'ok';
}

function populateClusters(selectId, addBlank = false) {
    const sel = $(selectId);
    if (!sel) return;
    sel.innerHTML = '';
    if (addBlank) {
        const opt = document.createElement('option');
        opt.value = ''; opt.textContent = t('selectCluster');
        sel.appendChild(opt);
    }
    clusters.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name || c.id;
        sel.appendChild(opt);
    });
}

async function loadClusters() {
    try {
        clusters = await api('clusters') || [];
        populateClusters('analyzeCluster', true);
        populateClusters('planCluster');
        populateClusters('executeCluster');
        populateClusters('trendsCluster');
        // Pre-fill the VMID dropdowns for the first cluster so they are
        // never left empty when the page is opened.
        await populatePlanVms();
        await populateExecuteVms();
    } catch (e) {
        showMessage(e.message, 'error');
    }
}

async function loadStatus() {
    try {
        const s = await api('status');
        const running = s.status === 'running';
        $('statusText').textContent = running ? t('running') : s.status;
        $('statusText').className = 'status' + (running ? '' : ' error');
        $('statusValue').textContent = s.status;
    } catch (e) {
        $('statusText').textContent = t('error');
        $('statusText').classList.add('error');
        showMessage(e.message, 'error');
    }
}

// ─── Tab navigation ──────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        $(`tab-${tab.dataset.tab}`).classList.add('active');
        if (tab.dataset.tab === 'history') loadHistory();
        if (tab.dataset.tab === 'settings') loadSettings();
    });
});

// ─── Analyze ─────────────────────────────────────────────────

function renderStorageTable(storage) {
    const th = getThresholdsFromInputs();
    const rows = storage.map(s => {
        const cls = stateClass(s.threshold_state);
        const overWarning = s.percent_used >= th.warning ? 'row-warning' : '';
        return `<tr class="${overWarning}">
                    <td>${escapeHtml(s.storage)}</td>
                    <td class="muted">${escapeHtml(s.type || '-')}</td>
                    <td class="muted">${escapeHtml(s.content || '-')}</td>
                    <td class="muted">${escapeHtml(formatKB(s.total))}</td>
                    <td class="muted">${escapeHtml(formatKB(s.used))}</td>
                    <td class="muted">${escapeHtml(formatKB(s.avail))}</td>
                    <td class="muted">${escapeHtml(s.percent_used)}%</td>
                    <td><span class="badge ${cls}">${t(s.threshold_state)}</span></td>
                </tr>`;
    }).join('');
    return `<table>
                <thead><tr><th data-i18n="name">Name</th><th data-i18n="type">Type</th><th data-i18n="content">Content</th>
                <th data-i18n="total">Total</th><th data-i18n="used">Used</th><th data-i18n="available">Available</th>
                <th data-i18n="percentUsed">% Used</th><th data-i18n="state">State</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
}

let vmSort = { col: 'vmid', dir: 'asc' };

function renderVmTable(vms) {
    const filter = $('vmFilter').value.toLowerCase();
    let filtered = vms.filter(v =>
        (v.name || '').toLowerCase().includes(filter) ||
        String(v.vmid).includes(filter) ||
        (v.storage || '').toLowerCase().includes(filter)
    );
    filtered.sort((a, b) => {
        let av = a[vmSort.col] || '', bv = b[vmSort.col] || '';
        if (typeof av === 'string') av = av.toLowerCase();
        if (typeof bv === 'string') bv = bv.toLowerCase();
        if (av < bv) return vmSort.dir === 'asc' ? -1 : 1;
        if (av > bv) return vmSort.dir === 'asc' ? 1 : -1;
        return 0;
    });
    const th = getThresholdsFromInputs();
    // pagination
    const pageSize = 20;
    const totalPages = Math.ceil(filtered.length / pageSize) || 1;
    const page = Math.min(window.__vmPage || 1, totalPages);
    window.__vmPage = page;
    const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
    const rows = paged.map(v => {
        const over = v.storage_percent && v.storage_percent >= th.warning ? 'row-warning' : '';
        return `<tr class="${over}">
                    <td><input type="checkbox" data-vmid="${escapeHtml(v.vmid)}" ${selectedVms.has(String(v.vmid)) ? 'checked' : ''} aria-label="select VM ${escapeHtml(v.vmid)}" /></td>
                    <td class="muted">${escapeHtml(v.vmid)}</td>
                    <td>${escapeHtml(v.name)}</td>
                    <td class="muted">${escapeHtml(v.node || '-')}</td>
                    <td class="muted">${escapeHtml(v.storage || '-')}</td>
                    <td class="muted">${escapeHtml(formatKB(v.disk_size))}</td>
                    <td class="muted">${escapeHtml(v.status)}</td>
                </tr>`;
    }).join('');
    const pagination = `<div class="pagination">
                <button id="vmPrev" ${page === 1 ? 'disabled' : ''}>&larr;</button>
                <span class="muted">${page} / ${totalPages}</span>
                <button id="vmNext" ${page === totalPages ? 'disabled' : ''}>&rarr;</button>
                <span class="muted">${selectedVms.size} ${t('selected')}</span>
            </div>`;
    return `<table id="vmTable">
                <thead><tr>
                    <th><input type="checkbox" id="selectAllVms" aria-label="select all" /></th>
                    <th data-col="vmid">VMID</th>
                    <th data-col="name">Name</th>
                    <th data-col="node">Node</th>
                    <th data-col="storage">${t('currentStorage')}</th>
                    <th data-col="disk_size">${t('diskSize')}</th>
                    <th data-col="status">Status</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>${pagination}`;
}

async function runAnalyze(e) {
    if (e) e.preventDefault();
    const clusterId = $('analyzeCluster').value;
    if (!clusterId) return;
    const btn = $('analyzeBtn');
    btn.disabled = true;
    btn.innerHTML = DOMPurify.sanitize(`${t('analyzing')}<span class="spinner"></span>`);
    try {
        const refresh = $('analyzeRefresh').checked ? '&refresh=1' : '';
        const data = await api(`analyze?cluster_id=${encodeURIComponent(clusterId)}${refresh}`);
        currentAnalysis = data;
        $('vmCount').textContent = data.vm_count || 0;
        const c = clusters.find(x => x.id === clusterId);
        $('selectedClusterName').textContent = c ? c.name : clusterId;
        const html = `<h3 data-i18n="storageTable">Storage</h3>` + renderStorageTable(data.storage) +
            `<h3 style="margin-top:20px;" data-i18n="vmTable">VMs</h3>` + renderVmTable(data.vms);
        $('analyzeResult').innerHTML = DOMPurify.sanitize(html);
        bindVmTable(data.vms);
        populateTrendsStorage(data.storage);
    } catch (err) {
        $('analyzeResult').innerHTML = DOMPurify.sanitize(`<p class="empty">${t('errorStateRetry').replace('{error}', err.message)}</p><button id="retryAnalyze" data-i18n="retry">${t('retry')}</button>`);
        $('retryAnalyze')?.addEventListener('click', runAnalyze);
        showMessage(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = t('analyze');
    }
}

function bindVmTable(vms) {
    $('vmTable')?.querySelectorAll('th[data-col]').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.col;
            if (vmSort.col === col) vmSort.dir = vmSort.dir === 'asc' ? 'desc' : 'asc';
            else { vmSort.col = col; vmSort.dir = 'asc'; }
            $('analyzeResult').innerHTML = DOMPurify.sanitize(renderStorageTable(currentAnalysis.storage) + `<h3 style="margin-top:20px;">${t('vmTable')}</h3>` + renderVmTable(currentAnalysis.vms));
            bindVmTable(currentAnalysis.vms);
        });
    });
    $('vmTable')?.querySelectorAll('tbody input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
            const vmid = cb.dataset.vmid;
            if (cb.checked) selectedVms.add(vmid);
            else selectedVms.delete(vmid);
            renderBulkSummary();
        });
    });
    $('selectAllVms')?.addEventListener('change', (e) => {
        const checked = e.target.checked;
        $('vmTable')?.querySelectorAll('tbody input[type=checkbox]').forEach(cb => {
            if (checked) selectedVms.add(cb.dataset.vmid);
            else selectedVms.delete(cb.dataset.vmid);
            cb.checked = checked;
        });
        renderBulkSummary();
    });
    $('vmPrev')?.addEventListener('click', () => { window.__vmPage = Math.max(1, (window.__vmPage || 1) - 1); runAnalyze(); });
    $('vmNext')?.addEventListener('click', () => { window.__vmPage = (window.__vmPage || 1) + 1; runAnalyze(); });
}

function renderAnalysisResults() {
    if (!currentAnalysis) return;
    $('analyzeResult').innerHTML = DOMPurify.sanitize(renderStorageTable(currentAnalysis.storage) + `<h3 style="margin-top:20px;">${t('vmTable')}</h3>` + renderVmTable(currentAnalysis.vms));
    bindVmTable(currentAnalysis.vms);
}

let analyzeDebounce = null;
function debouncedRenderAnalysis() {
    if (analyzeDebounce) clearTimeout(analyzeDebounce);
    analyzeDebounce = setTimeout(renderAnalysisResults, 150);
}

$('analyzeForm').addEventListener('submit', runAnalyze);
$('vmFilter').addEventListener('input', debouncedRenderAnalysis);
$('warnThreshold').addEventListener('input', debouncedRenderAnalysis);
$('dangerThreshold').addEventListener('input', debouncedRenderAnalysis);

$('exportAnalyzeBtn').addEventListener('click', () => {
    if (!currentAnalysis) return;
    const blob = new Blob([JSON.stringify(currentAnalysis, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'analysis.json'; a.click();
});

$('autoRefresh').addEventListener('change', (e) => {
    if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
    const sec = parseInt(e.target.value);
    if (sec > 0) autoRefreshInterval = setInterval(runAnalyze, sec * 1000);
});

// ─── Plan / Execute ──────────────────────────────────────────

async function populatePlanVms() {
    const clusterId = $('planCluster').value;
    const sel = $('planVm');
    sel.innerHTML = '';
    if (!clusterId) return;
    try {
        const res = await api(`vms?cluster_id=${encodeURIComponent(clusterId)}`);
        (res.data || []).forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.vmid; opt.textContent = `${v.vmid} — ${v.name}`;
            sel.appendChild(opt);
        });
    } catch (e) { showMessage(e.message, 'error'); }
}

async function populateExecuteVms() {
    const clusterId = $('executeCluster').value;
    const sel = $('executeVm');
    sel.innerHTML = '';
    if (!clusterId) return;
    try {
        const res = await api(`vms?cluster_id=${encodeURIComponent(clusterId)}`);
        const blank = document.createElement('option');
        blank.value = ''; blank.textContent = 'Select a VM';
        sel.appendChild(blank);
        (res.data || []).forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.vmid; opt.textContent = `${v.vmid} — ${v.name}`;
            sel.appendChild(opt);
        });
    } catch (e) { showMessage(e.message, 'error'); }
}

$('planCluster').addEventListener('change', () => {
    const cid = $('planCluster').value;
    $('executeCluster').value = cid;
    populatePlanVms();
    populateExecuteVms();
});
$('executeCluster').addEventListener('change', async () => {
    await populateExecuteVms();
    await populateExecuteTargets();
});

async function populateExecuteTargets() {
    const clusterId = $('executeCluster').value;
    const sel = $('executeTarget');
    sel.innerHTML = '';
    if (!clusterId || !currentAnalysis || currentAnalysis.cluster_id !== clusterId) {
        try {
            const data = await api(`analyze?cluster_id=${encodeURIComponent(clusterId)}`);
            currentAnalysis = data;
        } catch (e) { return; }
    }
    const imageStorage = (currentAnalysis.storage || []).filter(s => (s.content || '').includes('images'));
    imageStorage.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.storage; opt.textContent = `${s.storage} (${formatKB(s.avail)} free)`;
        sel.appendChild(opt);
    });
}

async function runPlan(dry = false) {
    const clusterId = $('planCluster').value;
    const vmid = $('planVm').value;
    if (!clusterId || !vmid) return;
    const btn = dry ? $('dryRunPlanBtn') : $('planBtn');
    btn.disabled = true;
    try {
        if (dry) {
            const res = await api('dry-run', 'POST', { cluster_id: clusterId, vmid: parseInt(vmid), target_storage: $('executeTarget').value });
            $('planResult').innerHTML = DOMPurify.sanitize(`<div class="message info"><strong>${t('dryRun')}</strong>: ${t('recordId')} ${escapeHtml(res.id)}, ${t('targetStorage')} ${escapeHtml(res.target_storage)}, ${t('status')} ${escapeHtml(res.status)}</div>`);
        } else {
            const res = await api('plan', 'POST', { cluster_id: clusterId, vmid: parseInt(vmid) });
            bulkPlans = [res];
            $('planResult').innerHTML = DOMPurify.sanitize(`<div class="message success"><strong>${t('recommendation')}</strong>: ${escapeHtml(res.target_storage)} (${escapeHtml(formatKB(res.available_kb))} ${t('available')}) — ${escapeHtml(t(res.reason) || res.reason)}</div>`);
            $('executeCluster').value = clusterId;
            await populateExecuteVms();
            $('executeVm').value = res.vmid;
            await populateExecuteTargets();
            $('executeTarget').value = res.target_storage;
        }
    } catch (err) {
        showMessage(err.message, 'error');
        $('planResult').innerHTML = DOMPurify.sanitize(`<div class="message error">${err.message}</div>`);
    } finally { btn.disabled = false; }
}

$('planForm').addEventListener('submit', (e) => { e.preventDefault(); runPlan(false); });
$('dryRunPlanBtn').addEventListener('click', (e) => { e.preventDefault(); runPlan(true); });

$('executeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const clusterId = $('executeCluster').value;
    const vmid = parseInt($('executeVm').value);
    const target = $('executeTarget').value;
    const dry = $('executeDryRun').checked;
    if (!clusterId || !vmid || !target) return;

    const confirm = await showConfirm(t('confirmExecute'), `${t('vmid')}: ${vmid} → ${target}`);
    if (!confirm) return;

    const btn = $('executeBtn');
    btn.disabled = true;
    btn.innerHTML = DOMPurify.sanitize(`${t('executing')}<span class="spinner"></span>`);
    try {
        const res = await api('execute', 'POST', { cluster_id: clusterId, vmid: vmid, target_storage: target, dry_run: dry });
        const statusClass = res.status === 'completed' ? 'success' : (res.status === 'failed' ? 'error' : 'info');
        $('executeResult').innerHTML = DOMPurify.sanitize(`<div class="message ${statusClass}"><strong>${t('recordId')}:</strong> ${escapeHtml(res.id)}<br><strong>${t('status')}:</strong> ${escapeHtml(res.status)}<br>${dry ? `(${t('dryRun')})` : ''}</div>`);
        if (!dry) await loadHistory();
    } catch (err) {
        $('executeResult').innerHTML = DOMPurify.sanitize(`<div class="message error">${err.message}</div>`);
        showMessage(err.message, 'error');
    } finally { btn.disabled = false; btn.textContent = t('execute'); }
});

// ─── Bulk ────────────────────────────────────────────────────

function renderBulkSummary() {
    const vms = (currentAnalysis?.vms || []).filter(v => selectedVms.has(String(v.vmid)));
    const vmids = vms.map(v => `<span class="badge">${escapeHtml(v.vmid)}</span> ${escapeHtml(v.name)}`).join(', ');
    $('bulkSummary').innerHTML = DOMPurify.sanitize(`<p class="muted">${selectedVms.size} ${t('selected')}: ${vmids}</p>`);
}

$('bulkPlanBtn').addEventListener('click', async () => {
    if (!selectedVms.size) { showMessage('Select VMs first', 'warning'); return; }
    const clusterId = $('analyzeCluster').value;
    const vmids = Array.from(selectedVms).map(Number);
    try {
        const res = await api('bulk-plan', 'POST', { cluster_id: clusterId, vmids });
        bulkPlans = res.plans || [];
        const rows = (res.plans || []).map(p => `<li>${escapeHtml(p.vmid)} → ${escapeHtml(p.target_storage || '-')} (${p.suggested ? t('suggestedTarget') : escapeHtml(p.reason)})</li>`).join('');
        $('bulkResult').innerHTML = DOMPurify.sanitize(`<div class="message info"><strong>${t('summary')}</strong>: ${res.summary.feasible}/${res.summary.total} ${t('feasible')}<ul>${rows}</ul></div>`);
    } catch (err) { showMessage(err.message, 'error'); }
});

$('bulkDryRunBtn').addEventListener('click', async () => {
    if (!bulkPlans.length) { showMessage('Run Bulk Plan first', 'warning'); return; }
    const clusterId = $('analyzeCluster').value;
    const moves = bulkPlans.filter(p => p.suggested && p.target_storage).map(p => ({ vmid: p.vmid, target_storage: p.target_storage }));
    try {
        const res = await api('bulk-execute', 'POST', { cluster_id: clusterId, moves, dry_run: true });
        const rows = (res.moves || []).map(m => `<li>${escapeHtml(m.vmid)}: ${escapeHtml(m.status)}</li>`).join('');
        $('bulkResult').innerHTML = DOMPurify.sanitize(`<div class="message info"><strong>${t('dryRun')}</strong><ul>${rows}</ul></div>`);
    } catch (err) { showMessage(err.message, 'error'); }
});

$('bulkExecuteBtn').addEventListener('click', async () => {
    if (!bulkPlans.length) { showMessage('Run Bulk Plan first', 'warning'); return; }
    const ok = await showConfirm(t('confirmBulk'), '');
    if (!ok) return;
    const clusterId = $('analyzeCluster').value;
    const moves = bulkPlans.filter(p => p.suggested && p.target_storage).map(p => ({ vmid: p.vmid, target_storage: p.target_storage }));
    try {
        const res = await api('bulk-execute', 'POST', { cluster_id: clusterId, moves });
        const rows = (res.moves || []).map(m => `<li>${m.vmid}: ${m.status}</li>`).join('');
        $('bulkResult').innerHTML = DOMPurify.sanitize(`<div class="message success"><strong>${t('summary')}</strong>: ${res.summary.completed}/${res.summary.total} ${t('completed')}<ul>${rows}</ul></div>`);
        await loadHistory();
    } catch (err) { showMessage(err.message, 'error'); }
});

// ─── History ─────────────────────────────────────────────────

async function loadHistory() {
    const status = $('historyFilterStatus').value;
    const vmid = $('historyFilterVmid').value;
    const cid = $('analyzeCluster').value;
    let q = 'history';
    const params = [];
    if (cid) params.push(`cluster_id=${encodeURIComponent(cid)}`);
    if (status) params.push(`status=${encodeURIComponent(status)}`);
    if (vmid) params.push(`vmid=${encodeURIComponent(vmid)}`);
    if (params.length) q += '?' + params.join('&');
    try {
        const res = await api(q);
        currentHistory = res.data || [];
        if (!currentHistory.length) { $('historyList').innerHTML = DOMPurify.sanitize(`<p class="empty" data-i18n="noHistory">${t('noHistory')}</p>`); return; }
        const rows = currentHistory.map(h => `<tr>
                    <td class="muted">${h.id}</td>
                    <td class="muted">${h.vmid}</td>
                    <td class="muted">${h.cluster_id}</td>
                    <td>${h.target_storage}</td>
                    <td><span class="badge ${stateClass(h.status === 'completed' ? 'ok' : (h.status === 'failed' ? 'danger' : 'warning'))}">${h.status}</span></td>
                    <td class="muted">${h.planned_at ? new Date(h.planned_at).toLocaleString() : '-'}</td>
                    <td class="actions">
                        <button data-clone="${h.id}">${t('clone')}</button>
                        ${h.status === 'planned' ? `<button data-cancel="${h.id}">${t('cancel')}</button>` : ''}
                        <button class="danger" data-del="${h.id}">${t('delete')}</button>
                    </td>
                </tr>`).join('');
        $('historyList').innerHTML = DOMPurify.sanitize(`<table><thead><tr>
                    <th>ID</th><th>VMID</th><th>Cluster</th><th>${t('targetStorage')}</th><th>Status</th><th>${t('plannedAt')}</th><th data-i18n="actions">${t('actions')}</th>
                </tr></thead><tbody>${rows}</tbody></table>`);
        $('historyList').querySelectorAll('button[data-clone]').forEach(b => b.addEventListener('click', () => cloneHistory(b.dataset.clone)));
        $('historyList').querySelectorAll('button[data-cancel]').forEach(b => b.addEventListener('click', () => cancelHistory(b.dataset.cancel)));
        $('historyList').querySelectorAll('button[data-del]').forEach(b => b.addEventListener('click', () => deleteHistory(b.dataset.del)));
    } catch (e) { showMessage(e.message, 'error'); }
}

async function cloneHistory(id) {
    try { await api('history/clone', 'POST', { id }); showMessage('Cloned', 'success'); await loadHistory(); }
    catch (e) { showMessage(e.message, 'error'); }
}
async function cancelHistory(id) {
    try { await api('history/cancel', 'POST', { id }); showMessage('Cancelled', 'success'); await loadHistory(); }
    catch (e) { showMessage(e.message, 'error'); }
}
async function deleteHistory(id) {
    const ok = await showConfirm(t('confirmDelete'), id);
    if (!ok) return;
    try { await api(`history?id=${encodeURIComponent(id)}`, 'DELETE'); showMessage('Deleted', 'success'); await loadHistory(); }
    catch (e) { showMessage(e.message, 'error'); }
}

let historyFilterTimeout = null;
function debouncedLoadHistory() {
    if (historyFilterTimeout) clearTimeout(historyFilterTimeout);
    historyFilterTimeout = setTimeout(loadHistory, 300);
}

$('loadHistoryBtn').addEventListener('click', loadHistory);
$('historyFilterStatus').addEventListener('input', debouncedLoadHistory);
$('historyFilterVmid').addEventListener('input', debouncedLoadHistory);
$('exportHistoryCsv').addEventListener('click', () => {
    const cid = $('analyzeCluster').value;
    const status = $('historyFilterStatus').value;
    const vmid = $('historyFilterVmid').value;
    const params = ['format=csv'];
    if (cid) params.push('cluster_id=' + encodeURIComponent(cid));
    if (status) params.push('status=' + encodeURIComponent(status));
    if (vmid) params.push('vmid=' + encodeURIComponent(vmid));
    window.location.href = 'history?' + params.join('&');
});
$('exportHistoryJson').addEventListener('click', () => {
    const cid = $('analyzeCluster').value;
    const status = $('historyFilterStatus').value;
    const vmid = $('historyFilterVmid').value;
    const params = ['format=json'];
    if (cid) params.push('cluster_id=' + encodeURIComponent(cid));
    if (status) params.push('status=' + encodeURIComponent(status));
    if (vmid) params.push('vmid=' + encodeURIComponent(vmid));
    window.location.href = 'history?' + params.join('&');
});

// ─── Trends ──────────────────────────────────────────────────

function populateTrendsStorage(storage) {
    const sel = $('trendsStorage');
    if (!sel) return;
    sel.innerHTML = '<option value="">All</option>';
    (storage || []).forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.storage; opt.textContent = s.storage;
        sel.appendChild(opt);
    });
}

$('trendsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cid = $('trendsCluster').value;
    const storage = $('trendsStorage').value;
    const interval = $('trendsInterval').value;
    if (!cid) return;
    try {
        const res = await api(`trends?cluster_id=${encodeURIComponent(cid)}&storage=${encodeURIComponent(storage)}&interval=${encodeURIComponent(interval)}`);
        const rows = (res.data || []).map(s => `<tr>
                    <td class="muted">${s.timestamp}</td>
                    <td class="muted">${s.storage || '-'}</td>
                    <td class="muted">${s.percent_used}%</td>
                </tr>`).join('');
        $('trendsResult').innerHTML = DOMPurify.sanitize(`<table><thead><tr><th>Time</th><th>Storage</th><th>% Used</th></tr></thead><tbody>${rows}</tbody></table>`);
    } catch (err) { showMessage(err.message, 'error'); }
});

// ─── Settings ────────────────────────────────────────────────

async function loadSettings() {
    try {
        const cfg = await api('config');
        $('settingWarning').value = cfg.threshold_warning;
        $('settingDanger').value = cfg.threshold_danger;
        $('warnThreshold').value = cfg.threshold_warning;
        $('dangerThreshold').value = cfg.threshold_danger;
    } catch (e) { showMessage(e.message, 'error'); }
}

$('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await api('config', 'POST', {
            threshold_warning: parseInt($('settingWarning').value),
            threshold_danger: parseInt($('settingDanger').value)
        });
        $('warnThreshold').value = $('settingWarning').value;
        $('dangerThreshold').value = $('settingDanger').value;
        showMessage('Saved', 'success');
    } catch (err) { showMessage(err.message, 'error'); }
});

// ─── Dialog ──────────────────────────────────────────────────

function showConfirm(title, body) {
    return new Promise(resolve => {
        $('confirmTitle').textContent = title;
        $('confirmBody').textContent = body;
        $('confirmDialog').classList.add('active');
        const cleanup = () => {
            $('confirmDialog').classList.remove('active');
            $('confirmOk').onclick = null;
            $('confirmCancel').onclick = null;
        };
        $('confirmOk').onclick = () => { cleanup(); resolve(true); };
        $('confirmCancel').onclick = () => { cleanup(); resolve(false); };
    });
}

// ─── Init ────────────────────────────────────────────────────

(async () => {
    if (i18n) await i18n.loadPluginNamespaceFull('storage-rebalancer', '/api/plugins/storage-rebalancer/i18n');
    captureI18nDefaults();
    applyI18n();
    await loadStatus();
    await loadClusters();
    await loadSettings();
})();
