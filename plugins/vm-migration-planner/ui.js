/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/vm-migration-planner/ui.js
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
const t = (k, p) => i18n ? i18n.getT('vm-migration-planner')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('vm-migration-planner', '/api/plugins/vm-migration-planner/i18n');

const state = {
    tab: 'nodes',
    clusters: [],
    nodes: [],
    vms: [],
    plans: [],
    recommendations: [],
    settings: {},
    nodeSort: { col: 'cpu_pct', order: 'asc' }
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

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function toast(msg, type = 'success') {
    const d = $('toasts');
    const el = document.createElement('div');
    el.className = `message ${type}`;
    el.textContent = msg;
    d.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

function showError(msg) { toast(t('error', { msg }), 'error'); }

async function loadStatus() {
    try {
        const s = await api('status');
        $('status').textContent = s.status === 'running' ? 'Running' : s.status;
        $('stats').innerHTML = DOMPurify.sanitize(`
                    <div class="stat"><div class="value" style="color:var(--info)">${s.jobs_count || 0}</div><div class="label">${t('historyTitle')}</div></div>
                    <div class="stat"><div class="value" style="color:var(--warning)">${s.running_count || 0}</div><div class="label">${t('running')}</div></div>
                `);
    } catch (e) { $('status').textContent = 'Error'; $('status').classList.add('error'); showError(e.message); }
}

async function loadClusters() {
    try {
        const data = await api('clusters');
        state.clusters = data.data || [];
        const html = state.clusters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name || c.id)}</option>`).join('');
        document.querySelectorAll('.cluster-select').forEach(sel => sel.innerHTML = DOMPurify.sanitize(html));
        ['nodesCluster', 'planCluster', 'recCluster'].forEach(id => { if ($(id)) $(id).innerHTML = DOMPurify.sanitize(html); });
    } catch (e) { showError(e.message); }
}

async function loadNodes(e) {
    if (e) e.preventDefault();
    const clusterId = $('nodesCluster').value;
    if (!clusterId) return;
    try {
        const data = await api(`nodes?cluster_id=${encodeURIComponent(clusterId)}`);
        state.nodes = data.nodes || [];
        $('nodesRefresh').textContent = t('loadAt') + ': ' + new Date().toLocaleString();
        renderNodes();
        renderNodeChart();
    } catch (err) { showError(err.message); }
}

function renderNodes() {
    const c = $('nodesList');
    if (!state.nodes.length) { c.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noNodes')}</p>`); return; }
    const s = state.nodeSort;
    const sorted = [...state.nodes].sort((a, b) => {
        const av = a[s.col] || 0, bv = b[s.col] || 0;
        return s.order === 'asc' ? av - bv : bv - av;
    });
    let html = `<table><thead><tr>
                <th data-sort="node">${t('node')}</th>
                <th data-sort="cpu_pct">${t('cpu')}</th>
                <th data-sort="mem_free_mb">${t('freeMem')} (MB)</th>
                <th data-sort="mem_pct">${t('memory')}</th>
            </tr></thead><tbody>`;
    sorted.forEach(n => {
        html += `<tr>
                    <td class="${n.high_cpu || n.low_mem ? 'warning' : ''}">${escapeHtml(n.node)}</td>
                    <td class="muted">${(n.cpu_pct * 100).toFixed(1)}%</td>
                    <td class="muted">${escapeHtml(n.mem_free_mb)}</td>
                    <td class="muted">${(n.mem_pct * 100).toFixed(1)}%</td>
                </tr>`;
    });
    html += '</tbody></table>';
    c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
        const col = th.dataset.sort;
        state.nodeSort.order = (state.nodeSort.col === col && state.nodeSort.order === 'asc') ? 'desc' : 'asc';
        state.nodeSort.col = col;
        renderNodes();
    }));
}

function renderNodeChart() {
    const c = $('nodesChart');
    if (!state.nodes.length) { c.hidden = true; return; }
    c.hidden = false;
    c.innerHTML = DOMPurify.sanitize(state.nodes.map(n => `
                <div class="chart-col" title="${escapeHtml(n.node)}">
                    <div class="chart-bar" style="height:${Math.min(100, (n.cpu_pct * 100))}%; background:${n.high_cpu ? 'var(--warning)' : 'var(--info)'};"></div>
                    <span class="chart-label">${escapeHtml(n.node)}</span>
                </div>
            `).join(''));
}

async function loadPlanVms() {
    const clusterId = $('planCluster').value;
    if (!clusterId) { state.vms = []; renderPlanVms(); return; }
    try {
        const data = await api(`vms?cluster_id=${encodeURIComponent(clusterId)}`);
        state.vms = data.vms || [];
        renderPlanVms();
        renderTargetOptions();
    } catch (err) { showError(err.message); }
}

function renderPlanVms() {
    const sel = $('planVm');
    if (!state.vms.length) { sel.innerHTML = DOMPurify.sanitize(`<option value="">${t('noVms')}</option>`); return; }
    sel.innerHTML = DOMPurify.sanitize(state.vms.map(vm => `<option value="${escapeHtml(vm.vmid)}">${escapeHtml(vm.name)} (${escapeHtml(vm.vmid)}) - ${escapeHtml(vm.node)}</option>`).join(''));
}

function renderTargetOptions() {
    const sel = $('planTarget');
    const current = $('planVm').value;
    const vm = state.vms.find(v => String(v.vmid) === current);
    const source = vm ? vm.node : '';
    const opts = state.clusters.length ? ['pve1', 'pve2'] : [];
    sel.innerHTML = DOMPurify.sanitize(`<option value="">${t('auto')}</option>` + opts.filter(o => o !== source).map(o => `<option value="${o}">${o}</option>`).join(''));
}

async function doPlan(e) {
    e.preventDefault();
    const payload = {
        cluster_id: $('planCluster').value,
        vmid: $('planVm').value,
        target: $('planTarget').value
    };
    try {
        const data = await api('plan', 'POST', payload);
        const result = $('planResult');
        result.innerHTML = DOMPurify.sanitize(`
                    <div class="card" style="margin-top:12px;">
                        <p><strong>${t('source')}:</strong> ${escapeHtml(data.source)}</p>
                        <p><strong>${t('target')}:</strong> ${escapeHtml(data.recommended_target)}</p>
                        <p><strong>${t('reason')}:</strong> ${escapeHtml(data.reason)}</p>
                        <p><strong>${t('feasible')}:</strong> ${data.feasible ? 'Yes' : 'No'}</p>
                        <p><strong>${t('estimatedMinutes')}:</strong> ${escapeHtml(data.estimated_minutes)}</p>
                        <button type="button" id="addPlanBtn" data-i18n="add">${t('add')}</button>
                    </div>
                `);
        $('addPlanBtn').addEventListener('click', () => {
            state.plans.push({ vmid: data.vmid, source: data.source, target: data.recommended_target, reason: data.reason });
            toast(t('planAdded'), 'success');
            renderMultiPlan();
        });
    } catch (err) { showError(err.message); }
}

function renderMultiPlan() {
    const c = $('multiPlanList');
    if (!state.plans.length) { c.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noPlans')}</p>`); return; }
    let html = `<table><thead><tr><th>VMID</th><th>${t('source')}</th><th>${t('target')}</th><th>${t('actions')}</th></tr></thead><tbody>`;
    state.plans.forEach((p, i) => {
        html += `<tr>
                    <td class="muted">${escapeHtml(p.vmid)}</td>
                    <td class="muted">${escapeHtml(p.source)}</td>
                    <td class="muted">${escapeHtml(p.target)}</td>
                    <td><button type="button" data-idx="${i}">${t('remove')}</button></td>
                </tr>`;
    });
    html += '</tbody></table>';
    c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-idx]').forEach(b => b.addEventListener('click', () => {
        state.plans.splice(parseInt(b.dataset.idx), 1);
        renderMultiPlan();
    }));
}

async function doDryRun() {
    if (!state.plans.length) { showError('No plans to simulate'); return; }
    try {
        const data = await api('dry-run', 'POST', { plans: state.plans });
        const c = $('dryRunResult');
        c.innerHTML = DOMPurify.sanitize(`<p class="message success">${data.simulated} plan(s) simulated</p>`);
    } catch (err) { showError(err.message); }
}

async function doExecute() {
    if (!state.plans.length) { showError('No plans to execute'); return; }
    if (!confirm(t('confirmExecute', { count: state.plans.length }))) return;
    try {
        const data = await api('execute', 'POST', { cluster_id: $('planCluster').value, plans: state.plans });
        toast(t('runStarted', { job_id: data.job_id }), 'success');
        state.plans = [];
        renderMultiPlan();
        loadStatus();
    } catch (err) { showError(err.message); }
}

async function loadRecommendations(e) {
    if (e) e.preventDefault();
    const clusterId = $('recCluster').value;
    const policy = $('recPolicy').value;
    if (!clusterId) return;
    try {
        const data = await api(`recommendations?cluster_id=${encodeURIComponent(clusterId)}&policy=${encodeURIComponent(policy)}`);
        state.recommendations = data.recommendations || [];
        const c = $('recList');
        if (!state.recommendations.length) { c.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noRecommendations')}</p>`); return; }
        let html = `<table><thead><tr><th>VMID</th><th>${t('source')}</th><th>${t('target')}</th><th>${t('reason')}</th><th>${t('actions')}</th></tr></thead><tbody>`;
        state.recommendations.forEach(r => {
            html += `<tr>
                        <td class="muted">${escapeHtml(r.vmid)}</td>
                        <td class="muted">${escapeHtml(r.source)}</td>
                        <td class="muted">${escapeHtml(r.target)}</td>
                        <td class="muted">${escapeHtml(r.reason)}</td>
                        <td><button type="button" data-vmid="${escapeHtml(r.vmid)}">${t('add')}</button></td>
                    </tr>`;
        });
        html += `</tbody></table><button type="button" id="applyAllRec" data-i18n="execute" style="margin-top:12px;">${t('execute')}</button>`;
        c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('button[data-vmid]').forEach(b => b.addEventListener('click', () => {
            const r = state.recommendations.find(x => String(x.vmid) === b.dataset.vmid);
            if (r) { state.plans.push(r); toast(t('planAdded'), 'success'); renderMultiPlan(); }
        }));
        $('applyAllRec').addEventListener('click', () => {
            state.plans = [...state.plans, ...state.recommendations];
            toast(t('planAdded'), 'success');
            renderMultiPlan();
        });
    } catch (err) { showError(err.message); }
}

async function loadHistory() {
    try {
        const data = await api('history');
        const c = $('historyList');
        if (!data.data || !data.data.length) { c.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noHistory')}</p>`); return; }
        let html = `<table><thead><tr><th>${t('started')}</th><th>Job ID</th><th>${t('status')}</th><th>${t('actions')}</th></tr></thead><tbody>`;
        data.data.forEach(j => {
            html += `<tr>
                        <td class="muted">${j.started_at ? new Date(j.started_at).toLocaleString() : '-'}</td>
                        <td class="muted">${escapeHtml(j.job_id)}</td>
                        <td><span class="badge ${j.status === 'running' ? 'warning' : j.status === 'failed' ? 'danger' : 'success'}">${escapeHtml(j.status)}</span></td>
                        <td class="actions">
                            ${j.status === 'running' ? `<button type="button" data-cancel="${escapeHtml(j.job_id)}">${t('cancel')}</button>` : ''}
                            ${j.status === 'failed' ? `<button type="button" data-retry="${escapeHtml(j.job_id)}">${t('retry')}</button>` : ''}
                        </td>
                    </tr>`;
        });
        html += '</tbody></table>';
        c.innerHTML = DOMPurify.sanitize(html);
        c.querySelectorAll('button[data-cancel]').forEach(b => b.addEventListener('click', async () => {
            try { await api('cancel', 'POST', { job_id: b.dataset.cancel }); loadHistory(); loadStatus(); }
            catch (err) { showError(err.message); }
        }));
        c.querySelectorAll('button[data-retry]').forEach(b => b.addEventListener('click', async () => {
            try { await api('retry', 'POST', { job_id: b.dataset.retry }); loadHistory(); loadStatus(); }
            catch (err) { showError(err.message); }
        }));
    } catch (err) { showError(err.message); }
}

async function loadSettings() {
    try {
        const data = await api('settings');
        state.settings = data.settings || {};
        $('setPolicy').value = state.settings.policy || 'balance_cpu';
        $('setExcluded').value = (state.settings.excluded_nodes || []).join(', ');
        $('setPinned').value = (state.settings.pinned_vms || []).join(', ');
    } catch (err) { showError(err.message); }
}

async function saveSettings(e) {
    e.preventDefault();
    const payload = {
        policy: $('setPolicy').value,
        excluded_nodes: $('setExcluded').value.split(',').map(x => x.trim()).filter(Boolean),
        pinned_vms: $('setPinned').value.split(',').map(x => x.trim()).filter(Boolean)
    };
    try {
        await api('settings', 'POST', payload);
        toast(t('saved'), 'success');
    } catch (err) { showError(err.message); }
}

async function doExport() { window.location.href = 'export?format=json'; }

async function doImport() { $('importFile').click(); }

$('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    try {
        const data = JSON.parse(text);
        await api('import', 'POST', data);
        toast(t('importDone'), 'success');
        loadSettings(); loadHistory();
    } catch (err) { showError(err.message); }
});

function switchTab(name) {
    state.tab = name;
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name));
    if (name === 'history') loadHistory();
    if (name === 'settings') loadSettings();
    if (name === 'recommendations') loadRecommendations();
}

function initTabs() {
    document.querySelectorAll('.tab').forEach(t => {
        t.addEventListener('click', () => switchTab(t.dataset.tab));
        t.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(t.dataset.tab); } });
    });
}

async function loadAll() {
    await loadStatus();
    await loadClusters();
    await loadNodes();
}

function wireEvents() {
    $('nodesForm').addEventListener('submit', loadNodes);
    $('planForm').addEventListener('submit', doPlan);
    $('recForm').addEventListener('submit', loadRecommendations);
    $('settingsForm').addEventListener('submit', saveSettings);
    $('dryRunBtn').addEventListener('click', doDryRun);
    $('executeBtn').addEventListener('click', doExecute);
    $('exportBtn').addEventListener('click', doExport);
    $('importBtn').addEventListener('click', doImport);
    $('refreshBtn').addEventListener('click', loadAll);
    $('planCluster').addEventListener('change', loadPlanVms);
    $('planVm').addEventListener('change', renderTargetOptions);
    initTabs();
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
