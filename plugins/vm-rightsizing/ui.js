/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/vm-rightsizing/ui.js
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
if (theme === 'corp-light') document.documentElement.setAttribute('data-theme', 'corp-light');
const $ = (id) => document.getElementById(id);

const i18n = window.parent && window.parent.ProxmoxVExI18n;
const t = (k, p) => i18n ? i18n.getT('vm-rightsizing')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('vm-rightsizing', '/api/plugins/vm-rightsizing/i18n');

const state = { clusters: [], recommendations: [], selected: [], reports: [], schedules: [], sort: { col: 'cpu_util', order: 'desc' } };

async function api(path, method = 'GET', body = null) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

function toast(msg, type = 'success') {
    const d = $('toasts');
    const el = document.createElement('div');
    el.className = `message ${type}`; el.textContent = msg;
    d.appendChild(el); setTimeout(() => el.remove(), 4000);
}
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function showError(msg) { toast(t('error', { msg }), 'error'); }

async function loadStatus() {
    try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; }
    catch (e) { $('status').textContent = 'Error'; $('status').classList.add('error'); }
}

async function loadClusters() {
    try { const d = await api('clusters'); state.clusters = d.data || []; const h = state.clusters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name || c.id)}</option>`).join(''); $('scanCluster').innerHTML = DOMPurify.sanitize(h); $('schCluster').innerHTML = DOMPurify.sanitize(h); }
    catch (e) { showError(e.message); }
}

function summaryStats() {
    const counts = { scale_up_cpu: 0, scale_down_cpu: 0, reduce_memory: 0, right_sized: 0 };
    state.recommendations.forEach(r => counts[r.recommendation] = (counts[r.recommendation] || 0) + 1);
    $('stats').innerHTML = DOMPurify.sanitize(`
                <div class="stat"><div class="value">${state.recommendations.length}</div><div class="label">${t('total')}</div></div>
                <div class="stat"><div class="value" style="color:var(--danger)">${counts.scale_up_cpu}</div><div class="label">${t('scaleUp')}</div></div>
                <div class="stat"><div class="value" style="color:var(--warning)">${counts.scale_down_cpu}</div><div class="label">${t('scaleDown')}</div></div>
                <div class="stat"><div class="value" style="color:var(--success)">${counts.right_sized}</div><div class="label">${t('rightSized')}</div></div>
            `);
    $('scanSummary').innerHTML = DOMPurify.sanitize(Object.keys(counts).map(k => `<div style="text-align:center;"><div class="chart-bar" style="height:${Math.max(10, counts[k] * 20)}px; background:var(--${k === 'scale_up_cpu' ? 'danger' : k === 'scale_down_cpu' ? 'warning' : 'info'});"></div><span class="muted">${t(k)}</span></div>`).join(''));
}

function filteredRecs() {
    const txt = $('filterText').value.toLowerCase();
    const rec = $('filterRec').value;
    let data = state.recommendations.filter(r => (!txt || r.name.toLowerCase().includes(txt) || String(r.vmid).includes(txt)) && (!rec || r.recommendation === rec));
    data = data.sort((a, b) => { const av = a[state.sort.col] || 0, bv = b[state.sort.col] || 0; return state.sort.order === 'asc' ? av - bv : bv - av; });
    return data;
}

function renderScan() {
    const data = filteredRecs();
    const c = $('scanList');
    if (!data.length) { c.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noReports')}</p>`); return; }
    let html = `<table><thead><tr>
                <th><input type="checkbox" id="selectAll"></th>
                <th data-sort="vmid">VMID</th>
                <th data-sort="name">Name</th>
                <th data-sort="vcpus">vCPUs</th>
                <th data-sort="memory_gb">Mem GB</th>
                <th data-sort="cpu_util">CPU util</th>
                <th data-sort="recommendation">Recommendation</th>
            </tr></thead><tbody>`;
    data.forEach(r => {
        const cls = r.recommendation === 'scale_up_cpu' ? 'danger' : r.recommendation === 'scale_down_cpu' ? 'warning' : r.recommendation === 'right_sized' ? 'success' : 'info';
        const checked = state.selected.includes(String(r.vmid)) ? 'checked' : '';
        html += `<tr>
                    <td><input type="checkbox" data-vmid="${escapeHtml(r.vmid)}" ${checked}></td>
                    <td class="muted">${escapeHtml(r.vmid)}</td>
                    <td class="muted">${escapeHtml(r.name)}</td>
                    <td class="muted">${escapeHtml(r.vcpus)}</td>
                    <td class="muted">${escapeHtml(r.memory_gb)}</td>
                    <td class="muted">${(r.cpu_util * 100).toFixed(0)}%</td>
                    <td><span class="badge ${cls}">${t(r.recommendation)}</span></td>
                </tr>`;
    });
    html += '</tbody></table>';
    c.innerHTML = DOMPurify.sanitize(html);
    $('selectAll').addEventListener('change', e => { state.selected = e.target.checked ? data.map(r => String(r.vmid)) : []; renderScan(); updateSelected(); });
    c.querySelectorAll('input[data-vmid]').forEach(i => i.addEventListener('change', () => {
        if (i.checked) state.selected.push(i.dataset.vmid); else state.selected = state.selected.filter(x => x !== i.dataset.vmid);
        updateSelected();
    }));
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
        const col = th.dataset.sort; state.sort.order = state.sort.col === col && state.sort.order === 'desc' ? 'asc' : 'desc'; state.sort.col = col; renderScan();
    }));
}

function updateSelected() {
    const list = state.recommendations.filter(r => state.selected.includes(String(r.vmid)));
    $('selectedList').innerHTML = DOMPurify.sanitize(list.map(r => `${escapeHtml(r.name)} (${escapeHtml(r.vmid)}) - ${t(r.recommendation)}`).join('<br>') || 'None');
    $('applyPanel').hidden = !list.length;
}

async function doScan(e) {
    e.preventDefault();
    try {
        const d = await api('scan?cluster_id=' + encodeURIComponent($('scanCluster').value));
        state.recommendations = d.recommendations || [];
        await api('report', 'POST', { cluster_id: $('scanCluster').value, name: $('scanName').value || 'Scan' });
        summaryStats(); renderScan(); loadReports(); loadStatus();
    } catch (err) { showError(err.message); }
}

async function doApply() {
    const changes = state.recommendations.filter(r => state.selected.includes(String(r.vmid))).map(r => ({ vmid: r.vmid, new_vcpus: r.vcpus, new_memory_gb: r.memory_gb }));
    try { const d = await api('apply', 'POST', { changes }); toast(`Applied ${d.applied} recommendation(s)`, 'success'); state.selected = []; $('applyPanel').hidden = true; renderScan(); }
    catch (err) { showError(err.message); }
}

function doExportJson() { window.location.href = 'export?format=json'; }
function doExportCsv() { window.location.href = 'export?format=csv'; }

async function loadReports() {
    try {
        const d = await api('reports'); state.reports = d.data || []; const c = $('reportsList');
        if (!state.reports.length) { c.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noReports')}</p>`); return; }
        let html = '<table><thead><tr><th>Name</th><th>Cluster</th><th>Created</th></tr></thead><tbody>';
        state.reports.forEach(r => html += `<tr><td class="muted">${escapeHtml(r.name)}</td><td class="muted">${escapeHtml(r.cluster_id)}</td><td class="muted">${new Date(r.created_at).toLocaleString()}</td></tr>`);
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (err) { showError(err.message); }
}

async function loadSchedules() {
    try {
        const d = await api('schedules'); state.schedules = d.data || []; const c = $('scheduleList');
        if (!state.schedules.length) { c.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noSchedules')}</p>`); return; }
        let html = '<table><thead><tr><th>Cluster</th><th>Cron</th><th>Enabled</th></tr></thead><tbody>';
        state.schedules.forEach(s => html += `<tr><td class="muted">${escapeHtml(s.cluster_id)}</td><td class="muted">${escapeHtml(s.cron)}</td><td class="muted">${s.enabled ? 'Yes' : 'No'}</td></tr>`);
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (err) { showError(err.message); }
}

async function addSchedule(e) {
    e.preventDefault();
    try { await api('schedule', 'POST', { cluster_id: $('schCluster').value, cron: $('schCron').value }); toast('Schedule added', 'success'); loadSchedules(); }
    catch (err) { showError(err.message); }
}

function switchTab(name) {
    state.tab = name;
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name));
    if (name === 'reports') loadReports(); if (name === 'schedule') loadSchedules();
}

function wireEvents() {
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    $('scanForm').addEventListener('submit', doScan);
    $('filterText').addEventListener('input', renderScan);
    $('filterRec').addEventListener('change', renderScan);
    $('applyBtn').addEventListener('click', doApply);
    $('exportJson').addEventListener('click', doExportJson);
    $('exportCsv').addEventListener('click', doExportCsv);
    $('scheduleForm').addEventListener('submit', addSchedule);
}

(async () => { await loadStatus(); await loadClusters(); wireEvents(); })();
