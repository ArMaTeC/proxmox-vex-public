/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/vm-bulk-deployer/ui.js
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
document.documentElement.setAttribute('data-theme', theme === 'corp-light' ? 'corp-light' : (theme === 'corp-dark' ? 'modern-dark' : theme));

const i18n = (window.parent && window.parent.ProxmoxVExI18n) || null;
const t = i18n ? i18n.getT('vm-bulk-deployer') : (k => k);

const $ = (id) => document.getElementById(id);

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function showMessage(text, type) {
    const m = $('message');
    m.innerHTML = DOMPurify.sanitize(`<div class="message ${type}">${escapeHtml(text)}</div>`);
    setTimeout(() => { m.innerHTML = ''; }, 5000);
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

let clusters = [];
let activeRefresh = null;

function translatePage() {
    if (!i18n) return;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translated = t(key);
        if (el.tagName === 'OPTION') {
            if (!el.dataset.i18nDefault) el.dataset.i18nDefault = el.textContent;
            el.textContent = translated === key ? el.dataset.i18nDefault : translated;
        } else if (el.hasAttribute('data-i18n-attr')) {
            const attr = el.getAttribute('data-i18n-attr');
            if (!el.dataset.i18nDefault) el.dataset.i18nDefault = el.getAttribute(attr);
            el.setAttribute(attr, translated === key ? el.dataset.i18nDefault : translated);
        } else if (el.querySelector('input, select, textarea, button')) {
            // Keep form controls inside labels; update the leading text node only.
            for (var i = 0; i < el.childNodes.length; i++) {
                if (el.childNodes[i].nodeType === Node.TEXT_NODE && el.childNodes[i].textContent.trim()) {
                    if (!el.dataset.i18nDefault) el.dataset.i18nDefault = el.childNodes[i].textContent;
                    el.childNodes[i].textContent = translated === key ? el.dataset.i18nDefault : translated;
                    break;
                }
            }
        } else {
            if (!el.dataset.i18nDefault) el.dataset.i18nDefault = el.textContent;
            el.textContent = translated === key ? el.dataset.i18nDefault : translated;
        }
    });
}

async function loadStatus() {
    try {
        const s = await api('status');
        $('status').textContent = s.status === 'running' ? t('running') : s.status;
    } catch (e) {
        $('status').textContent = t('error');
        $('status').classList.add('error');
        showMessage(e.message, 'error');
    }
}

async function loadDashboard() {
    try {
        const d = await api('dashboard');
        const html = ['queued', 'running', 'completed', 'failed'].map(k => `
                    <div class="stat" role="region" aria-label="${t(k)}">
                        <div class="stat-value">${d[k] || 0}</div>
                        <div class="stat-label">${t(k)}</div>
                    </div>
                `).join('');
        $('stats').innerHTML = DOMPurify.sanitize(html);
    } catch (e) { console.warn('dashboard', e); }
}

async function loadClusters() {
    const res = await api('clusters');
    clusters = res.data || [];
    const sel = document.querySelector('select[name="cluster_id"]');
    sel.innerHTML = DOMPurify.sanitize('<option value="">' + t('cluster') + '</option>' + clusters.map(c =>
        `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name || c.name)} ${c.reachable ? '' : '(offline)'}</option>`
    ).join(''));
}

async function loadSourcesForCluster(clusterId) {
    const sel = document.querySelector('select[name="source"]');
    sel.innerHTML = DOMPurify.sanitize('<option value="">' + t('source') + '</option>');
    if (!clusterId) { sel.disabled = true; return; }
    try {
        const res = await api(`sources?cluster_id=${encodeURIComponent(clusterId)}`);
        sel.disabled = false;
        const sources = res.data || [];
        sel.innerHTML = DOMPurify.sanitize('<option value="">' + t('source') + '</option>' + sources.map(s =>
            `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${s.type === 'template' ? t('template') : t('vm')})</option>`
        ).join(''));
        if (sources.length === 0) sel.innerHTML = DOMPurify.sanitize('<option value="">' + t('noSources') + '</option>');
    } catch (e) {
        showMessage(e.message, 'error');
        sel.disabled = true;
    }
}

async function loadNodesAndStorage(clusterId) {
    if (!clusterId) return;
    const [nodes, storages] = await Promise.all([
        api(`nodes?cluster_id=${encodeURIComponent(clusterId)}`).catch(() => ({ data: [] })),
        api(`storages?cluster_id=${encodeURIComponent(clusterId)}`).catch(() => ({ data: [] }))
    ]);
    const nodeSel = document.querySelector('select[name="target_node"]');
    const storeSel = document.querySelector('select[name="target_storage"]');
    nodeSel.disabled = false;
    storeSel.disabled = false;
    nodeSel.innerHTML = DOMPurify.sanitize('<option value="">' + t('targetNode') + '</option>' + (nodes.data || []).map(n =>
        `<option value="${escapeHtml(n.id)}">${escapeHtml(n.name)}</option>`
    ).join(''));
    storeSel.innerHTML = DOMPurify.sanitize('<option value="">' + t('targetStorage') + '</option>' + (storages.data || []).map(s =>
        `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`
    ).join(''));
}

function updatePreview() {
    const f = $('deployForm');
    const prefix = (f.naming_prefix.value || '').trim() || 'web-';
    const count = parseInt(f.count.value) || 0;
    const pattern = f.naming_pattern.value;
    const preview = $('namePreview');
    const impact = $('impact');
    if (count < 1 || count > 100) { preview.innerHTML = ''; impact.textContent = ''; return; }
    const names = [];
    for (let i = 1; i <= Math.min(count, 6); i++) names.push(pattern.replace('{prefix}', prefix).replace('{index}', i));
    const display = count > 6 ? names.slice(0, 3).concat(['...']).concat(names.slice(-3)) : names;
    preview.innerHTML = DOMPurify.sanitize(`<span class="muted">${t('namePreview')}:</span> ` + display.map(n => `<span>${escapeHtml(n)}</span>`).join(''));
    impact.textContent = `${t('estimatedImpact')}: ${t('cpu')} ≈ ${count} cores, ${t('memory')} ≈ ${count * 2}GB, ${t('disk')} ≈ ${count * 20}GB`;
}

async function queueDeploy() {
    const f = $('deployForm');
    const body = Object.fromEntries(new FormData(f).entries());
    body.count = parseInt(body.count);
    body.start_delay = parseInt(body.start_delay || 0);
    try {
        const data = await api('deploy', 'POST', body);
        $('deployResult').innerHTML = DOMPurify.sanitize(`<p class="muted">${t('jobQueued')}: <span class="badge">${escapeHtml(data.job.job_id)}</span></p>`);
        showMessage(t('jobQueued'), 'success');
        await loadJobs();
        await loadDashboard();
    } catch (err) { showMessage(err.message, 'error'); }
}

async function runDryRun() {
    const f = $('deployForm');
    const body = Object.fromEntries(new FormData(f).entries());
    body.count = parseInt(body.count);
    body.start_delay = parseInt(body.start_delay || 0);
    try {
        const data = await api('dry-run', 'POST', body);
        const list = data.would_create.map(n => `<span>${escapeHtml(n)}</span>`).join('');
        $('dryRunResult').innerHTML = DOMPurify.sanitize(`<p class="muted">${t('dryRun')} (${data.count}):</p><div class="preview-list">${list}</div>`);
    } catch (err) { showMessage(err.message, 'error'); }
}

async function saveTemplate() {
    const f = $('deployForm');
    const body = Object.fromEntries(new FormData(f).entries());
    body.count = parseInt(body.count);
    body.start_delay = parseInt(body.start_delay || 0);
    const name = prompt('Template name');
    if (!name) return;
    body.name = name;
    try {
        await api('templates', 'POST', body);
        showMessage(t('templateSaved'), 'success');
        await loadTemplates();
    } catch (err) { showMessage(err.message, 'error'); }
}

async function loadTemplates() {
    try {
        const res = await api('templates');
        const list = $('templatesList');
        const tpls = res.data || [];
        if (!tpls.length) { list.innerHTML = DOMPurify.sanitize(`<p class="empty" data-i18n="noTemplates">${t('noTemplates')}</p>`); return; }
        let html = '<table role="table" aria-label="Templates"><thead><tr>';
        html += `<th data-i18n="none">Name</th><th data-i18n="cluster">Cluster</th><th data-i18n="source">Source</th><th data-i18n="count">Count</th><th data-i18n="namingPrefix">Prefix</th><th data-i18n="actions">Actions</th>`;
        html += '</tr></thead><tbody>';
        tpls.forEach(tpl => {
            html += `<tr>
                        <td>${escapeHtml(tpl.name)}</td>
                        <td class="muted">${escapeHtml(tpl.cluster_id)}</td>
                        <td>${escapeHtml((tpl.source || {}).name || '')}</td>
                        <td class="muted">${escapeHtml(tpl.count)}</td>
                        <td class="muted">${escapeHtml(tpl.naming_prefix)}</td>
                        <td>
                            <button class="secondary" onclick="loadTemplate('${escapeHtml(tpl.template_id)}')">${t('load') || 'Load'}</button>
                            <button class="danger" onclick="deleteTemplate('${escapeHtml(tpl.template_id)}')">${t('delete')}</button>
                        </td>
                    </tr>`;
        });
        html += '</tbody></table>';
        list.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showMessage(e.message, 'error'); }
}

async function loadTemplate(templateId) {
    try {
        const res = await api(`templates?id=${encodeURIComponent(templateId)}`);
        const tpl = res.data;
        if (!tpl) return;
        const f = $('deployForm');
        f.cluster_id.value = tpl.cluster_id;
        await loadSourcesForCluster(tpl.cluster_id);
        await loadNodesAndStorage(tpl.cluster_id);
        f.source.value = (tpl.source || {}).id || '';
        f.count.value = tpl.count;
        f.naming_prefix.value = tpl.naming_prefix;
        f.naming_pattern.value = tpl.naming_pattern || '{prefix}-{index}';
        f.mode.value = tpl.mode || 'sequential';
        f.start_delay.value = tpl.start_delay || 0;
        f.on_completion.value = tpl.on_completion || '';
        f.target_node.value = tpl.target_node || '';
        f.target_storage.value = tpl.target_storage || '';
        f.tags.value = (tpl.tags || []).join(',');
        updatePreview();
        activateTab('deploy');
    } catch (e) { showMessage(e.message, 'error'); }
}

async function deleteTemplate(templateId) {
    if (!confirm(t('confirmDeleteJob'))) return;
    try {
        await api('templates/delete', 'POST', { template_id: templateId });
        await loadTemplates();
    } catch (e) { showMessage(e.message, 'error'); }
}

let jobParams = { page: 1, per_page: 25 };

async function loadJobs() {
    try {
        const params = new URLSearchParams();
        if ($('filterStatus').value) params.append('status', $('filterStatus').value);
        if ($('filterSource').value) params.append('source', $('filterSource').value);
        params.append('sort', $('sortBy').value);
        params.append('order', $('sortOrder').value);
        params.append('page', jobParams.page);
        params.append('per_page', jobParams.per_page);
        const res = await api(`jobs?${params.toString()}`);
        const list = $('jobsList');
        const jobs = res.data || [];
        if (!jobs.length) { list.innerHTML = DOMPurify.sanitize(`<p class="empty" data-i18n="noJobs">${t('noJobs')}</p>`); return; }
        let html = '<table role="table" aria-label="Jobs"><thead><tr>';
        html += `<th><input type="checkbox" id="selectAll" aria-label="${t('selectAll')}"></th><th data-i18n="jobId">Job ID</th><th data-i18n="cluster">Cluster</th><th data-i18n="source">Source</th><th data-i18n="count">Count</th><th data-i18n="namingPrefix">Prefix</th><th data-i18n="status">Status</th><th data-i18n="created">Created</th><th data-i18n="actions">Actions</th></tr></thead><tbody>`;
        jobs.forEach(j => {
            html += `<tr>
                        <td><input type="checkbox" class="job-check" value="${escapeHtml(j.job_id)}" aria-label="${t('selectJob')}"></td>
                        <td class="muted">${escapeHtml(j.job_id)}</td>
                        <td class="muted">${escapeHtml(j.cluster_id)}</td>
                        <td>${escapeHtml((j.source || {}).name || j.source)}</td>
                        <td class="muted">${escapeHtml(j.count)}</td>
                        <td class="muted">${escapeHtml(j.naming_prefix)}</td>
                        <td><span class="badge ${j.status}">${t(j.status)}</span></td>
                        <td class="muted">${j.created ? new Date(j.created).toLocaleString() : '-'}</td>
                        <td>
                            <button class="secondary" onclick="expandJob('${escapeHtml(j.job_id)}', this)">${t('expand')}</button>
                            ${j.status === 'queued' || j.status === 'running' ? `<button class="danger" onclick="cancelJob('${escapeHtml(j.job_id)}')">${t('cancel')}</button>` : ''}
                            <button class="secondary" onclick="duplicateJob('${escapeHtml(j.job_id)}')">${t('duplicate')}</button>
                            <button class="danger" onclick="deleteJob('${escapeHtml(j.job_id)}')">${t('delete')}</button>
                        </td>
                    </tr>`;
        });
        html += '</tbody></table>';
        if (res.total) {
            html += `<p class="muted">Page ${res.page} — ${res.total} total</p>`;
        }
        list.innerHTML = DOMPurify.sanitize(html);
        document.getElementById('selectAll')?.addEventListener('change', (e) => {
            document.querySelectorAll('.job-check').forEach(c => c.checked = e.target.checked);
        });
    } catch (e) { showMessage(e.message, 'error'); }
}

async function expandJob(jobId, btn) {
    const row = btn.closest('tr');
    let next = row.nextElementSibling;
    if (next && next.classList.contains('detail-row')) { next.remove(); return; }
    try {
        const res = await api(`jobs/detail?id=${encodeURIComponent(jobId)}`);
        const job = res.data;
        const vms = job.vms || [];
        let detail = '<tr class="detail-row"><td colspan="9"><table style="width:100%;margin-left:24px;"><thead><tr>';
        detail += `<th data-i18n="vmName">VM Name</th><th data-i18n="node">Node</th><th data-i18n="status">Status</th><th data-i18n="progress">Progress</th><th data-i18n="actions">Actions</th></tr></thead><tbody>`;
        vms.forEach(vm => {
            detail += `<tr>
                        <td>${escapeHtml(vm.name)}</td>
                        <td class="muted">${escapeHtml(vm.node || '-')}</td>
                        <td><span class="badge ${vm.status}">${t(vm.status)}</span></td>
                        <td>
                            <div class="bar"><div style="width:${vm.progress || 0}%"></div></div>
                            <span class="muted">${escapeHtml(vm.progress || 0)}%</span>
                        </td>
                        <td>
                            ${vm.status === 'failed' ? `<button class="secondary" onclick="retryVm('${escapeHtml(jobId)}', '${escapeHtml(vm.name)}')">${t('retryVM')}</button>` : ''}
                        </td>
                    </tr>`;
        });
        detail += '</tbody></table></td></tr>';
        row.insertAdjacentHTML('afterend', DOMPurify.sanitize(detail));
    } catch (e) { showMessage(e.message, 'error'); }
}

async function cancelJob(jobId) {
    if (!confirm(t('confirmCancelJob'))) return;
    try { await api('jobs/cancel', 'POST', { job_id: jobId }); await loadJobs(); await loadDashboard(); }
    catch (e) { showMessage(e.message, 'error'); }
}

async function duplicateJob(jobId) {
    try { await api('jobs/duplicate', 'POST', { job_id: jobId }); await loadJobs(); await loadDashboard(); }
    catch (e) { showMessage(e.message, 'error'); }
}

async function deleteJob(jobId) {
    if (!confirm(t('confirmDeleteJob'))) return;
    try { await api('jobs', 'DELETE', { job_id: jobId }); await loadJobs(); await loadDashboard(); }
    catch (e) { showMessage(e.message, 'error'); }
}

async function retryVm(jobId, vmName) {
    try { await api('jobs/retry', 'POST', { job_id: jobId, vms: [vmName] }); await loadJobs(); }
    catch (e) { showMessage(e.message, 'error'); }
}

async function clearCompleted() {
    if (!confirm(t('confirmClearCompleted'))) return;
    try { await api('jobs/clear-completed', 'POST'); await loadJobs(); await loadDashboard(); }
    catch (e) { showMessage(e.message, 'error'); }
}

async function bulkDelete() {
    const ids = [...document.querySelectorAll('.job-check:checked')].map(c => c.value);
    if (!ids.length) return;
    if (!confirm(t('confirmBulkDelete'))) return;
    try { await api('jobs/bulk-delete', 'POST', { ids }); await loadJobs(); await loadDashboard(); }
    catch (e) { showMessage(e.message, 'error'); }
}

async function loadAudit() {
    try {
        const res = await api('audit');
        const list = $('auditList');
        const entries = res.data || [];
        if (!entries.length) { list.innerHTML = DOMPurify.sanitize(`<p class="empty">No audit entries.</p>`); return; }
        let html = '<table><thead><tr><th>Action</th><th>Target</th><th>Actor</th><th>Time</th></tr></thead><tbody>';
        entries.forEach(e => {
            html += `<tr><td>${escapeHtml(e.action)}</td><td class="muted">${escapeHtml(e.target_id || '-')}</td><td class="muted">${escapeHtml(e.actor)}</td><td class="muted">${new Date(e.timestamp).toLocaleString()}</td></tr>`;
        });
        html += '</tbody></table>';
        list.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { console.warn('audit', e); }
}

function activateTab(tab) {
    document.querySelectorAll('[role="tab"]').forEach(t => {
        const active = t.getAttribute('data-tab') === tab;
        t.setAttribute('aria-selected', active);
        t.classList.toggle('active', active);
    });
    ['deploy', 'jobs', 'templates', 'audit'].forEach(id => {
        $(id + '-panel').hidden = id !== tab;
    });
}

document.querySelectorAll('[role="tab"]').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        activateTab(tab);
        if (tab === 'jobs') loadJobs();
        if (tab === 'templates') loadTemplates();
        if (tab === 'audit') loadAudit();
    });
});

document.querySelector('select[name="cluster_id"]').addEventListener('change', async (e) => {
    const clusterId = e.target.value;
    await loadSourcesForCluster(clusterId);
    await loadNodesAndStorage(clusterId);
    updatePreview();
});

$('deployForm').addEventListener('input', updatePreview);
$('queueBtn').addEventListener('click', queueDeploy);
$('dryRunBtn').addEventListener('click', runDryRun);
$('saveTemplateBtn').addEventListener('click', saveTemplate);

$('filterStatus').addEventListener('change', loadJobs);
$('filterSource').addEventListener('input', debounce(loadJobs, 300));
$('sortBy').addEventListener('change', loadJobs);
$('sortOrder').addEventListener('change', loadJobs);
$('clearCompletedBtn').addEventListener('click', clearCompleted);
$('bulkDeleteBtn').addEventListener('click', bulkDelete);
$('exportJsonBtn').addEventListener('click', () => window.location.href = 'jobs/export?format=json');
$('exportCsvBtn').addEventListener('click', () => window.location.href = 'jobs/export?format=csv');

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

(async () => {
    translatePage();
    await loadStatus();
    await loadDashboard();
    await loadClusters();
    await loadTemplates();
    updatePreview();
    if (i18n) await i18n.loadPluginNamespaceFull('vm-bulk-deployer', '/api/plugins/vm-bulk-deployer/i18n');
    translatePage();
    // auto-refresh dashboard + jobs when active
    if (activeRefresh) clearInterval(activeRefresh);
    activeRefresh = setInterval(async () => { await loadDashboard(); if (!$('jobs-panel').hidden) await loadJobs(); }, 5000);
})();
