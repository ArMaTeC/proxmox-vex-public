/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/terraform-sync/ui.js
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
if (theme === 'corp-light') {
    document.documentElement.setAttribute('data-theme', 'corp-light');
} else if (theme === 'corp-dark') {
    document.documentElement.setAttribute('data-theme', 'corp-dark');
} else {
    document.documentElement.removeAttribute('data-theme');
}

const $ = (id) => document.getElementById(id);

// i18n
const t = (function () {
    const messages = {
        'terraformSync.title': 'Terraform State Sync',
        'terraformSync.loading': 'Loading...',
        'terraformSync.cluster': 'Cluster',
        'terraformSync.resourceType': 'Resource Type',
        'terraformSync.customType': 'Custom Type',
        'terraformSync.selectCluster': 'Select cluster...',
        'terraformSync.selectType': 'Select type...',
        'terraformSync.loadResources': 'Load Resources',
        'terraformSync.searchResources': 'Search resources...',
        'terraformSync.sortName': 'Sort by name',
        'terraformSync.sortId': 'Sort by ID',
        'terraformSync.sortNode': 'Sort by node',
        'terraformSync.sortStatus': 'Sort by status',
        'terraformSync.selectAll': 'Select All',
        'terraformSync.exportAllType': 'Export All of Type',
        'terraformSync.exportName': 'Export Name',
        'terraformSync.moduleTemplate': 'Module template',
        'terraformSync.excludeFields': 'Exclude fields (comma separated)',
        'terraformSync.preview': 'Preview',
        'terraformSync.export': 'Export',
        'terraformSync.dryRun': 'Dry Run',
        'terraformSync.copy': 'Copy',
        'terraformSync.downloadTf': 'Download .tf',
        'terraformSync.saveTemplate': 'Save as Template',
        'terraformSync.exportHistory': 'Export History',
        'terraformSync.allClusters': 'All clusters',
        'terraformSync.allTypes': 'All types',
        'terraformSync.searchHistory': 'Search history...',
        'terraformSync.noResources': 'No resources loaded.',
        'terraformSync.noHistory': 'No export history.',
        'terraformSync.noSchedules': 'No schedules.',
        'terraformSync.noTemplates': 'No templates.',
        'terraformSync.noAudit': 'No audit records.',
        'terraformSync.noStateLoaded': 'No state loaded.',
        'terraformSync.syncAndState': 'Sync & State',
        'terraformSync.syncNow': 'Sync Now',
        'terraformSync.loadState': 'Load State',
        'terraformSync.downloadState': 'Download State',
        'terraformSync.driftCheck': 'Drift Check',
        'terraformSync.checkDrift': 'Check Drift',
        'terraformSync.importDrifted': 'Import Drifted',
        'terraformSync.schedules': 'Schedules',
        'terraformSync.scheduleName': 'Name',
        'terraformSync.intervalMinutes': 'Interval (minutes)',
        'terraformSync.enabled': 'Enabled',
        'terraformSync.saveSchedule': 'Save Schedule',
        'terraformSync.templates': 'Templates',
        'terraformSync.auditLog': 'Audit Log',
        'terraformSync.allActions': 'All actions',
        'terraformSync.loadAudit': 'Load Audit',
        'terraformSync.exportedResources': 'Exported Resources',
        'terraformSync.lastSync': 'Last Sync',
        'terraformSync.syncStatus': 'Sync Status',
        'terraformSync.idle': 'Idle',
        'terraformSync.search': 'Search',
        'terraformSync.applyTemplate': 'Apply',
        'terraformSync.delete': 'Delete',
        'terraformSync.reExport': 'Re-export',
        'terraformSync.compare': 'Compare',
        'terraformSync.previous': 'Previous',
        'terraformSync.next': 'Next',
        'terraformSync.pageOf': 'Page {page} of {total}',
        'terraformSync.noTypeResources': 'No {type} resources found.',
        'terraformSync.errorRetry': 'Error: {msg}. Retry?',
        'terraformSync.retry': 'Retry',
        'terraformSync.exportSuccess': 'Exported {count} resources successfully.',
        'terraformSync.syncStarted': 'Sync started.',
        'terraformSync.syncComplete': 'Sync complete.',
        'terraformSync.driftFound': '{count} drift(s) found.',
        'terraformSync.importedCount': 'Imported {count} resource(s).',
        'terraformSync.templateSaved': 'Template saved.',
        'terraformSync.scheduleSaved': 'Schedule saved.',
        'terraformSync.copied': 'Copied to clipboard.',
        'terraformSync.deleted': 'Deleted.',
        'terraformSync.typeVM': 'Proxmox VM (qemu)',
        'terraformSync.typeLXC': 'Proxmox LXC',
        'terraformSync.typeStorage': 'Proxmox Storage',
        'terraformSync.typeNode': 'Proxmox Node',
    };
    return function (key, opts) {
        let s = messages[key] || key;
        if (opts) {
            Object.keys(opts).forEach(k => {
                s = s.replace(new RegExp('{' + k + '}', 'g'), opts[k]);
            });
        }
        return s;
    };
})();

document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!el.dataset.i18nDefault) el.dataset.i18nDefault = el.textContent;
    const translated = t(key);
    el.textContent = translated === key ? el.dataset.i18nDefault : translated;
});
document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (!el.dataset.i18nDefault) el.dataset.i18nDefault = el.placeholder;
    const translated = t(key);
    el.placeholder = translated === key ? el.dataset.i18nDefault : translated;
});

// Try to register with parent i18n bridge
try {
    if (window.parent && window.parent.ProxmoxVExI18n) {
        const i18n = window.parent.ProxmoxVExI18n;
        i18n.registerNamespaceBulk && i18n.registerNamespaceBulk('terraform-sync', { en: {} });
    }
} catch (e) { }

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function showMessage(text, type) {
    const m = $('message');
    m.innerHTML = '<div class="message ' + type + '"></div>';
    if (m.firstElementChild) m.firstElementChild.textContent = text;
    setTimeout(() => { m.innerHTML = ''; }, 5000);
}

async function api(path, method = 'GET', body = null) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch('/api/plugins/terraform-sync/api/' + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

let clusters = [];
let resourceTypes = [];
let resources = [];
let selectedResourceIds = new Set();
let currentResourceOffset = 0;
const RESOURCE_LIMIT = 10;

async function loadStatus() {
    try {
        const s = await api('status');
        const statusEl = $('status');
        statusEl.textContent = s.status ? s.status.charAt(0).toUpperCase() + s.status.slice(1) : 'Idle';
        statusEl.className = 'status ' + (s.status === 'failed' ? 'error' : s.status === 'syncing' ? 'syncing' : '');
        $('summaryExports').textContent = s.exports_count || 0;
        $('summaryLastSync').textContent = s.last_sync ? new Date(s.last_sync).toLocaleString() : '—';
        const badge = document.createElement('span');
        badge.className = `badge ${s.status === 'failed' ? 'error' : s.status === 'success' ? 'success' : ''}`;
        badge.textContent = s.status || 'idle';
        $('summarySyncStatus').innerHTML = '';
        $('summarySyncStatus').appendChild(badge);
    } catch (e) {
        $('status').textContent = 'Error';
        $('status').classList.add('error');
        showMessage(e.message, 'error');
    }
}

async function loadClusters() {
    const data = await api('clusters');
    clusters = data.clusters || [];
    ['clusterSelect', 'driftCluster', 'historyClusterFilter'].forEach(id => {
        const sel = $(id);
        sel.innerHTML = '';
        const def = document.createElement('option');
        def.value = '';
        def.textContent = t('terraformSync.selectCluster');
        sel.appendChild(def);
        clusters.forEach(c => {
            const o = document.createElement('option');
            o.value = c.id;
            o.textContent = c.name;
            sel.appendChild(o);
        });
    });
}

async function loadResourceTypes() {
    const data = await api('resource-types');
    resourceTypes = data.resource_types || [];
    ['resourceTypeSelect', 'driftType'].forEach(id => {
        const sel = $(id);
        sel.innerHTML = '';
        const def = document.createElement('option');
        def.value = '';
        def.textContent = t('terraformSync.selectType');
        sel.appendChild(def);
        resourceTypes.forEach(r => {
            const o = document.createElement('option');
            o.value = r.id;
            o.textContent = r.id;
            sel.appendChild(o);
        });
    });
    const typeFilter = $('historyTypeFilter');
    typeFilter.innerHTML = '';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = t('terraformSync.allTypes');
    typeFilter.appendChild(def);
    resourceTypes.forEach(r => {
        const o = document.createElement('option');
        o.value = r.id;
        o.textContent = r.id;
        typeFilter.appendChild(o);
    });
}

function getSelectedResourceType() {
    return $('customType').value.trim() || $('resourceTypeSelect').value;
}

async function loadResources() {
    const clusterId = $('clusterSelect').value;
    const resourceType = getSelectedResourceType();
    if (!clusterId || !resourceType) {
        showMessage('Select a cluster and resource type first.', 'error');
        return;
    }
    const search = $('resourceSearch').value.trim();
    const sort = $('resourceSort').value;
    const offset = currentResourceOffset;
    try {
        const data = await api(`resources?cluster_id=${encodeURIComponent(clusterId)}&resource_type=${encodeURIComponent(resourceType)}&search=${encodeURIComponent(search)}&sort=${sort}&limit=${RESOURCE_LIMIT}&offset=${offset}`);
        resources = data.resources || [];
        selectedResourceIds.clear();
        renderResources(data.total || resources.length);
    } catch (e) {
        const list = $('resourcesList');
        list.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('terraformSync.errorRetry', { msg: e.message })} <button class="btn secondary" id="retryResources">${t('terraformSync.retry')}</button></p>`);
        $('retryResources')?.addEventListener('click', loadResources);
    }
}

function renderResources(total) {
    const list = $('resourcesList');
    if (!resources.length) {
        list.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('terraformSync.noTypeResources', { type: getSelectedResourceType() })}</p>`);
        renderPagination(total);
        return;
    }
    let html = `<table><thead><tr><th><input type="checkbox" id="toggleAll" class="focus-visible" /></th><th>ID</th><th data-i18n="terraformSync.sortName">Name</th><th data-i18n="terraformSync.sortNode">Node</th><th data-i18n="terraformSync.sortStatus">Status</th></tr></thead><tbody>`;
    resources.forEach(r => {
        const checked = selectedResourceIds.has(r.id) ? 'checked' : '';
        const selectedClass = selectedResourceIds.has(r.id) ? 'row-selected' : '';
        html += `<tr class="${selectedClass}"><td><input type="checkbox" class="res-checkbox focus-visible" data-id="${escapeHtml(r.id)}" ${checked} /></td><td class="muted">${escapeHtml(r.id)}</td><td>${escapeHtml(r.name || '')}</td><td>${escapeHtml(r.node || '')}</td><td><span class="badge">${escapeHtml(r.status || '')}</span></td></tr>`;
    });
    html += '</tbody></table>';
    list.innerHTML = DOMPurify.sanitize(html);
    list.querySelectorAll('.res-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            const id = cb.getAttribute('data-id');
            if (cb.checked) selectedResourceIds.add(id);
            else selectedResourceIds.delete(id);
            renderResources(total);
        });
    });
    $('toggleAll')?.addEventListener('change', (ev) => {
        if (ev.target.checked) resources.forEach(r => selectedResourceIds.add(r.id));
        else resources.forEach(r => selectedResourceIds.delete(r.id));
        renderResources(total);
    });
    renderPagination(total);
}

function renderPagination(total) {
    const pages = Math.ceil(total / RESOURCE_LIMIT) || 1;
    const page = Math.floor(currentResourceOffset / RESOURCE_LIMIT) + 1;
    const p = $('resourcePagination');
    p.innerHTML = DOMPurify.sanitize(`
                <button type="button" class="secondary" id="prevPage" ${page <= 1 ? 'disabled' : ''}>${t('terraformSync.previous')}</button>
                <span class="muted">${t('terraformSync.pageOf', { page, total: pages })}</span>
                <button type="button" class="secondary" id="nextPage" ${page >= pages ? 'disabled' : ''}>${t('terraformSync.next')}</button>
            `);
    $('prevPage')?.addEventListener('click', () => { currentResourceOffset = Math.max(0, currentResourceOffset - RESOURCE_LIMIT); loadResources(); });
    $('nextPage')?.addEventListener('click', () => { currentResourceOffset += RESOURCE_LIMIT; loadResources(); });
}

async function previewExport(save = false, dryRun = false) {
    const clusterId = $('clusterSelect').value;
    const resourceType = getSelectedResourceType();
    const ids = Array.from(selectedResourceIds);
    if (!clusterId || !resourceType) { showMessage('Select a cluster and resource type.', 'error'); return; }
    if (!ids.length) { showMessage('Select at least one resource.', 'error'); return; }
    const body = {
        cluster_id: clusterId,
        resource_type: resourceType,
        resource_ids: ids,
        excluded_fields: $('excludeFields').value.split(',').map(s => s.trim()).filter(Boolean),
        module: $('moduleToggle').checked,
        provider_version: '0.66.2'
    };
    try {
        const data = await api('export/preview', 'POST', body);
        $('exportResult').textContent = data.tf || '';
        $('exportPreview').style.display = 'block';
        if (save && !dryRun) {
            const exportData = {
                ...body,
                name: $('exportName').value.trim() || undefined
            };
            const result = await api('export', 'POST', exportData);
            showMessage(t('terraformSync.exportSuccess', { count: result.export.resource_count || 0 }), 'success');
            loadExportHistory();
            loadStatus();
        } else if (dryRun) {
            showMessage('Dry run preview generated.', 'success');
        } else {
            showMessage('Preview generated.', 'success');
        }
    } catch (e) { showMessage(e.message, 'error'); }
}

async function saveExport() { await previewExport(true); }
async function dryRun() { await previewExport(false, true); }

async function loadExportHistory() {
    try {
        const cluster = $('historyClusterFilter').value;
        const type = $('historyTypeFilter').value;
        const search = $('historySearch').value.trim();
        const data = await api(`exports?cluster_id=${encodeURIComponent(cluster)}&resource_type=${encodeURIComponent(type)}&search=${encodeURIComponent(search)}`);
        const list = $('exportHistory');
        if (!data.exports?.length) { list.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('terraformSync.noHistory')}</p>`); return; }
        let html = `<table><thead><tr><th data-i18n="terraformSync.exportName">Name</th><th data-i18n="terraformSync.resourceType">Type</th><th data-i18n="terraformSync.cluster">Cluster</th><th data-i18n="terraformSync.lastSync">Created</th><th></th></tr></thead><tbody>`;
        data.exports.forEach(e => {
            html += `<tr><td>${escapeHtml(e.name || '')}</td><td class="muted">${escapeHtml(e.resource_type || '')}</td><td>${escapeHtml(e.cluster_id || '')}</td><td>${new Date(e.created_at).toLocaleString()}</td>
                        <td>
                            <button type="button" class="btn secondary re-export" data-id="${escapeHtml(e.id)}">${t('terraformSync.reExport')}</button>
                            <a href="/api/plugins/terraform-sync/api/exports/download?id=${encodeURIComponent(e.id)}" class="btn secondary">Download</a>
                            <button type="button" class="btn danger delete-export" data-id="${escapeHtml(e.id)}">${t('terraformSync.delete')}</button>
                        </td></tr>`;
        });
        html += '</tbody></table>';
        list.innerHTML = DOMPurify.sanitize(html);
        list.querySelectorAll('.re-export').forEach(b => b.addEventListener('click', () => reExport(b.getAttribute('data-id'))));
        list.querySelectorAll('.delete-export').forEach(b => b.addEventListener('click', () => deleteExport(b.getAttribute('data-id'))));
    } catch (e) { showMessage(e.message, 'error'); }
}

async function reExport(id) {
    try {
        const data = await api('exports/re-export', 'POST', { id });
        showMessage(t('terraformSync.exportSuccess', { count: data.export.resource_count || 0 }), 'success');
        loadExportHistory();
    } catch (e) { showMessage(e.message, 'error'); }
}

async function deleteExport(id) {
    if (!confirm('Delete this export?')) return;
    try {
        await api('exports/delete', 'POST', { id });
        showMessage(t('terraformSync.deleted'), 'success');
        loadExportHistory();
    } catch (e) { showMessage(e.message, 'error'); }
}

async function syncNow() {
    try {
        const data = await api('sync', 'POST', {});
        $('syncResult').innerHTML = DOMPurify.sanitize(`<div class="message success">${t('terraformSync.syncStarted')} ${escapeHtml(data.sync_id)}</div>`);
        setTimeout(async () => {
            const latest = await api('sync');
            $('syncResult').innerHTML = DOMPurify.sanitize(`<div class="message success">${t('terraformSync.syncComplete')} ${escapeHtml(latest.status)}</div>`);
            loadStatus();
        }, 1500);
    } catch (e) { showMessage(e.message, 'error'); }
}

async function loadState() {
    try {
        const data = await api('state');
        $('stateResult').textContent = JSON.stringify(data.state || {}, null, 2);
    } catch (e) { showMessage(e.message, 'error'); }
}

async function checkDrift() {
    const clusterId = $('driftCluster').value;
    const resourceType = $('driftType').value;
    if (!clusterId || !resourceType) { showMessage('Select cluster and type.', 'error'); return; }
    try {
        const data = await api('drift', 'POST', { cluster_id: clusterId, resource_type: resourceType, resource_ids: [] });
        const list = $('driftList');
        if (!data.drifts?.length) { list.innerHTML = DOMPurify.sanitize(`<p class="empty">No drift detected.</p>`); return; }
        let html = '';
        data.drifts.forEach(d => {
            html += `<div class="card" style="margin-bottom: 12px;">
                        <strong>${escapeHtml(d.resource_id)}</strong> (${(d.diff_fields || []).map(escapeHtml).join(', ')})
                        <div class="diff">
                            <pre class="code">Live: ${escapeHtml(JSON.stringify(d.live, null, 2))}</pre>
                            <pre class="code">State: ${escapeHtml(JSON.stringify(d.state, null, 2))}</pre>
                        </div>
                    </div>`;
        });
        list.innerHTML = DOMPurify.sanitize(html);
        showMessage(t('terraformSync.driftFound', { count: data.total }), 'success');
    } catch (e) { showMessage(e.message, 'error'); }
}

async function importDrifted() {
    const clusterId = $('driftCluster').value;
    const resourceType = $('driftType').value;
    if (!clusterId || !resourceType) { showMessage('Select cluster and type.', 'error'); return; }
    try {
        const data = await api('drift?import=1', 'POST', { cluster_id: clusterId, resource_type: resourceType, resource_ids: [] });
        showMessage(t('terraformSync.importedCount', { count: data.imported?.length || 0 }), 'success');
        loadState();
    } catch (e) { showMessage(e.message, 'error'); }
}

async function saveSchedule() {
    const body = {
        name: $('scheduleName').value.trim(),
        interval_minutes: parseInt($('scheduleInterval').value, 10) || 60,
        enabled: $('scheduleEnabled').checked
    };
    try {
        await api('schedules', 'POST', body);
        showMessage(t('terraformSync.scheduleSaved'), 'success');
        loadSchedules();
    } catch (e) { showMessage(e.message, 'error'); }
}

async function loadSchedules() {
    try {
        const data = await api('schedules');
        const list = $('schedulesList');
        if (!data.schedules?.length) { list.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('terraformSync.noSchedules')}</p>`); return; }
        let html = '<table><thead><tr><th>Name</th><th>Interval</th><th>Enabled</th><th></th></tr></thead><tbody>';
        data.schedules.forEach(s => {
            html += `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.interval_minutes)} min</td><td>${s.enabled ? 'Yes' : 'No'}</td>
                        <td><button type="button" class="btn danger delete-schedule" data-id="${escapeHtml(s.id)}">${t('terraformSync.delete')}</button></td></tr>`;
        });
        html += '</tbody></table>';
        list.innerHTML = DOMPurify.sanitize(html);
        list.querySelectorAll('.delete-schedule').forEach(b => b.addEventListener('click', () => deleteSchedule(b.getAttribute('data-id'))));
    } catch (e) { showMessage(e.message, 'error'); }
}

async function deleteSchedule(id) {
    if (!confirm('Delete this schedule?')) return;
    try {
        await api('schedules', 'DELETE', { id });
        loadSchedules();
    } catch (e) { showMessage(e.message, 'error'); }
}

async function loadTemplates() {
    try {
        const data = await api('templates');
        const list = $('templatesList');
        if (!data.templates?.length) { list.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('terraformSync.noTemplates')}</p>`); return; }
        let html = '<table><thead><tr><th>Name</th><th>Type</th><th>Module</th><th></th></tr></thead><tbody>';
        data.templates.forEach(tpl => {
            html += `<tr><td>${escapeHtml(tpl.name)}</td><td class="muted">${escapeHtml(tpl.resource_type)}</td><td>${tpl.module ? 'Yes' : 'No'}</td>
                        <td><button type="button" class="btn secondary apply-template" data-excluded="${escapeHtml((tpl.excluded_fields || []).join(','))}" data-module="${escapeHtml(tpl.module)}">${t('terraformSync.applyTemplate')}</button>
                        <button type="button" class="btn danger delete-template" data-id="${escapeHtml(tpl.id)}">${t('terraformSync.delete')}</button></td></tr>`;
        });
        html += '</tbody></table>';
        list.innerHTML = DOMPurify.sanitize(html);
        list.querySelectorAll('.apply-template').forEach(b => b.addEventListener('click', () => {
            $('excludeFields').value = b.getAttribute('data-excluded') || '';
            $('moduleToggle').checked = b.getAttribute('data-module') === 'true';
            showMessage('Template applied.', 'success');
        }));
        list.querySelectorAll('.delete-template').forEach(b => b.addEventListener('click', () => deleteTemplate(b.getAttribute('data-id'))));
    } catch (e) { showMessage(e.message, 'error'); }
}

async function deleteTemplate(id) {
    if (!confirm('Delete this template?')) return;
    try {
        await api('templates', 'DELETE', { id });
        loadTemplates();
    } catch (e) { showMessage(e.message, 'error'); }
}

async function saveAsTemplate() {
    const name = prompt('Template name:');
    if (!name) return;
    const body = {
        name,
        resource_type: getSelectedResourceType(),
        module: $('moduleToggle').checked,
        excluded_fields: $('excludeFields').value.split(',').map(s => s.trim()).filter(Boolean),
        variables: []
    };
    try {
        await api('templates', 'POST', body);
        showMessage(t('terraformSync.templateSaved'), 'success');
        loadTemplates();
    } catch (e) { showMessage(e.message, 'error'); }
}

async function loadAudit() {
    const action = $('auditActionFilter').value;
    try {
        const data = await api(`audit?action=${encodeURIComponent(action)}`);
        const list = $('auditList');
        if (!data.audit?.length) { list.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('terraformSync.noAudit')}</p>`); return; }
        let html = '<table><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Cluster</th></tr></thead><tbody>';
        data.audit.forEach(a => {
            html += `<tr><td>${new Date(a.timestamp).toLocaleString()}</td><td class="muted">${a.action}</td><td>${a.actor}</td><td>${a.cluster_id || ''}</td></tr>`;
        });
        html += '</tbody></table>';
        list.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showMessage(e.message, 'error'); }
}

function copyExport() {
    const code = $('exportResult').textContent;
    navigator.clipboard.writeText(code).then(() => showMessage(t('terraformSync.copied'), 'success'));
}

function downloadExport() {
    const code = $('exportResult').textContent;
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'terraform-export.tf';
    a.click();
    URL.revokeObjectURL(url);
}

function downloadState() {
    window.open('/api/plugins/terraform-sync/api/state?download=1', '_blank');
}

// Event wiring
$('loadResources').addEventListener('click', () => { currentResourceOffset = 0; loadResources(); });
$('resourceSearch').addEventListener('input', () => { currentResourceOffset = 0; loadResources(); });
$('resourceSort').addEventListener('change', () => { currentResourceOffset = 0; loadResources(); });
$('selectAll').addEventListener('click', () => { resources.forEach(r => selectedResourceIds.add(r.id)); renderResources(resources.length); });
$('exportAll').addEventListener('click', () => { resources.forEach(r => selectedResourceIds.add(r.id)); renderResources(resources.length); showMessage('All loaded resources selected.', 'success'); });
$('previewBtn').addEventListener('click', () => previewExport(false));
$('exportBtn').addEventListener('click', saveExport);
$('dryRunBtn').addEventListener('click', dryRun);
$('copyExport').addEventListener('click', copyExport);
$('downloadExport').addEventListener('click', downloadExport);
$('saveTemplate').addEventListener('click', saveAsTemplate);
$('historyClusterFilter').addEventListener('change', loadExportHistory);
$('historyTypeFilter').addEventListener('change', loadExportHistory);
$('historySearch').addEventListener('input', loadExportHistory);
$('syncBtn').addEventListener('click', syncNow);
$('loadStateBtn').addEventListener('click', loadState);
$('downloadStateBtn').addEventListener('click', downloadState);
$('driftBtn').addEventListener('click', checkDrift);
$('driftImportBtn').addEventListener('click', importDrifted);
$('saveScheduleBtn').addEventListener('click', saveSchedule);
$('loadAuditBtn').addEventListener('click', loadAudit);

// Init
(async function init() {
    try {
        await Promise.all([loadStatus(), loadClusters(), loadResourceTypes()]);
        loadExportHistory();
        loadSchedules();
        loadTemplates();
        loadAudit();
    } catch (e) { showMessage(e.message, 'error'); }
})();
