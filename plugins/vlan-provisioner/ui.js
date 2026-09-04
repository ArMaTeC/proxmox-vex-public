/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/vlan-provisioner/ui.js
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

const i18n = (window.parent && window.parent.ProxmoxVExI18n) || window.ProxmoxVExI18n;
let t = (k, p = {}) => k;

function interpolate(str, params) {
    if (!params) return str;
    return str.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, key) => params[key] !== undefined ? params[key] : m);
}

function text(k, params = {}) {
    const s = t(k);
    return interpolate(s, params);
}

function t_default(k) {
    if (i18n && i18n.getT) {
        const fn = i18n.getT('vlan-provisioner');
        if (fn) {
            try { return fn(k) || k; } catch (e) { return k; }
        }
    }
    return k;
}

function captureI18nDefaults() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        if (!el.dataset.i18nDefault) {
            el.dataset.i18nDefault = el.textContent;
        }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        if (!el.dataset.i18nDefaultPlaceholder) {
            el.dataset.i18nDefaultPlaceholder = el.placeholder;
        }
    });
}

async function initI18n() {
    if (i18n && i18n.loadNamespace) {
        try { await i18n.loadPluginNamespaceFull('vlan-provisioner', '/api/plugins/vlan-provisioner/i18n'); } catch (e) { console.warn('i18n load failed', e); }
    }
    if (i18n && i18n.getT) {
        const fn = i18n.getT('vlan-provisioner');
        t = (k, p = {}) => { const s = fn ? (fn(k) || k) : k; return interpolate(s, p); };
    } else {
        // No parent i18n system available (e.g. plugin UI loaded
        // standalone rather than embedded in the dashboard). Leave
        // the built-in markup text alone instead of overwriting it
        // with the raw translation key.
        return;
    }
    captureI18nDefaults();
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        const fallback = el.dataset.i18nDefault || el.textContent;
        const translated = text(key);
        el.textContent = translated === key ? fallback : translated;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        const fallback = el.dataset.i18nDefaultPlaceholder || el.placeholder;
        const translated = text(key);
        el.placeholder = translated === key ? fallback : translated;
    });
}

async function api(path, method = 'GET', body = null) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch('/api/plugins/vlan-provisioner/api/' + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    return data;
}

function showMessage(str, type = 'success') {
    const m = $('message');
    m.innerHTML = '<div class="message ' + type + '" role="alert" aria-live="polite"></div>';
    if (m.firstElementChild) m.firstElementChild.textContent = str;
    setTimeout(() => { m.innerHTML = ''; }, 5000);
}

function showError(str) {
    $('errorText').textContent = str;
    $('errorBox').classList.remove('hidden');
}

function hideError() {
    $('errorBox').classList.add('hidden');
}

const state = { vlans: [], clusters: [], selected: new Set(), editingId: null, allTags: new Set(), allEnvs: new Set(), page: 0, perPage: 20, candidates: [] };

async function loadStatus() {
    try {
        const s = await api('status');
        $('statusText').textContent = s.status === 'running' ? text('running') : s.status;
        $('statusText').className = 'status' + (s.status === 'running' ? '' : ' error');
        $('statusValue').textContent = s.status === 'running' ? text('running') : s.status;
        $('vlanCount').textContent = s.vlans_count;
        $('complianceValue').textContent = s.compliance_status === 'compliant' ? text('compliant') : text('driftDetected');
    } catch (e) { console.error('status', e); }
}

async function loadClusters() {
    try {
        const r = await api('clusters');
        state.clusters = r.data || [];
        const fills = ['applyCluster', 'complianceCluster', 'bulkClusters'];
        fills.forEach(id => {
            const sel = $(id);
            sel.innerHTML = '';
            if (id !== 'bulkClusters') {
                const def = document.createElement('option');
                def.value = ''; def.textContent = text('selectCluster');
                sel.appendChild(def);
            }
            state.clusters.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.display_name + (c.reachable ? '' : ' (' + text('unreachable') + ')');
                sel.appendChild(opt);
            });
        });
    } catch (e) { console.error('clusters', e); }
}

async function loadVlans() {
    try {
        const sort = $('sortBy').value, order = $('orderBy').value;
        const filter = $('search').value, tag = $('tagFilter').value, environment = $('envFilter').value;
        const params = new URLSearchParams({ sort, order });
        if (filter) params.set('filter', filter);
        if (tag) params.set('tag', tag);
        if (environment) params.set('environment', environment);
        const r = await api('vlans?' + params.toString());
        state.vlans = r.data || [];
        state.allTags.clear();
        state.allEnvs.clear();
        state.vlans.forEach(v => { (v.tags || []).forEach(t => state.allTags.add(t)); state.allEnvs.add(v.environment || ''); });
        updateFilters();
        renderVlans();
        renderApplyVlanList();
        hideError();
    } catch (e) {
        showError(text('apiError', { message: e.message }));
    }
}

function updateFilters() {
    const tf = $('tagFilter');
    const selectedTag = tf.value;
    tf.innerHTML = DOMPurify.sanitize('<option value="">' + text('allTags') + '</option>');
    Array.from(state.allTags).sort().forEach(tag => {
        const opt = document.createElement('option'); opt.value = tag; opt.textContent = tag; tf.appendChild(opt);
    });
    tf.value = selectedTag;
    const ef = $('envFilter');
    const selectedEnv = ef.value;
    ef.innerHTML = DOMPurify.sanitize('<option value="">' + text('allEnvironments') + '</option>');
    Array.from(state.allEnvs).filter(Boolean).sort().forEach(env => {
        const opt = document.createElement('option'); opt.value = env; opt.textContent = env; ef.appendChild(opt);
    });
    ef.value = selectedEnv;
}

function fmtSubnet(s) { return s || '-'; }

function renderVlans() {
    const list = $('vlansList');
    if (!state.vlans.length) {
        list.innerHTML = DOMPurify.sanitize('<p class="empty" data-i18n="noVlans">' + text('noVlans') + '</p>');
        return;
    }
    const start = state.page * state.perPage;
    const pageItems = state.vlans.slice(start, start + state.perPage);
    let html = '<table><thead><tr>';
    html += '<th><span class="sr-only">select</span></th>';
    html += '<th data-sort="name" tabindex="0" data-i18n="name">Name</th>';
    html += '<th data-sort="vid" tabindex="0" data-i18n="vid">VID</th>';
    html += '<th data-sort="subnet" tabindex="0" data-i18n="subnet">Subnet</th>';
    html += '<th data-i18n="description">Description</th>';
    html += '<th data-i18n="tags">Tags</th>';
    html += '<th data-sort="environment" tabindex="0" data-i18n="environment">Environment</th>';
    html += '<th data-i18n="lastApplied">Last applied</th>';
    html += '<th data-i18n="actions">Actions</th>';
    html += '</tr></thead><tbody>';
    pageItems.forEach(v => {
        html += '<tr>';
        html += '<td><input type="checkbox" class="row-check" data-id="' + escapeHtml(v.id || '') + '" ' + (state.selected.has(v.id) ? 'checked' : '') + ' /></td>';
        html += '<td>';
        if (v.color) html += '<span class="color-dot" style="background:' + escapeHtml(v.color) + '"></span>';
        html += escapeHtml(v.name) + '</td>';
        html += '<td>' + escapeHtml(v.vid) + '</td>';
        html += '<td>' + escapeHtml(fmtSubnet(v.subnet)) + '</td>';
        html += '<td>' + escapeHtml(v.description || '') + '</td>';
        html += '<td>' + (v.tags || []).map(t => '<span class="badge">' + escapeHtml(t) + '</span>').join('') + '</td>';
        html += '<td>' + escapeHtml(v.environment || '') + '</td>';
        html += '<td>' + (v.last_applied_at ? new Date(v.last_applied_at).toLocaleString() : '-') + '</td>';
        html += '<td class="actions">';
        html += '<button class="secondary edit" data-id="' + escapeHtml(v.id) + '" data-i18n="edit">' + text('edit') + '</button>';
        html += '<button class="secondary duplicate" data-id="' + escapeHtml(v.id) + '" data-i18n="duplicate">' + text('duplicate') + '</button>';
        html += '<button class="danger" data-id="' + escapeHtml(v.id) + '" data-i18n="delete">' + text('delete') + '</button>';
        html += '</td></tr>';
    });
    html += '</tbody></table>';
    list.innerHTML = DOMPurify.sanitize(html);
    renderPagination();
    bindRowActions();
}

function renderPagination() {
    const pages = Math.ceil(state.vlans.length / state.perPage) || 1;
    const el = $('pagination');
    el.innerHTML = '';
    for (let i = 0; i < pages; i++) {
        const b = document.createElement('button');
        b.textContent = (i + 1);
        b.className = i === state.page ? '' : 'secondary';
        b.addEventListener('click', () => { state.page = i; renderVlans(); });
        el.appendChild(b);
    }
}

function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function bindRowActions() {
    document.querySelectorAll('.edit').forEach(b => b.addEventListener('click', e => editVlan(e.target.dataset.id)));
    document.querySelectorAll('.duplicate').forEach(b => b.addEventListener('click', e => duplicateVlan(e.target.dataset.id)));
    document.querySelectorAll('[data-i18n="delete"]').forEach(b => b.addEventListener('click', e => deleteVlan(e.target.dataset.id)));
    document.querySelectorAll('.row-check').forEach(cb => cb.addEventListener('change', e => {
        const id = e.target.dataset.id;
        if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
        updateSelectedCount();
    }));
}

function updateSelectedCount() {
    $('selectedCount').textContent = state.selected.size + ' ' + text('selected');
}

function fillForm(v) {
    $('editId').value = v.id || '';
    $('vlanName').value = v.name || '';
    $('vlanVid').value = v.vid || '';
    $('vlanSubnet').value = v.subnet || '';
    $('vlanDescription').value = v.description || '';
    $('vlanTags').value = (v.tags || []).join(', ');
    $('vlanColor').value = v.color || '#58a6ff';
    $('vlanEnvironment').value = v.environment || '';
    $('duplicateBtn').classList.toggle('hidden', !v.id);
    state.editingId = v.id || null;
}

function resetForm() {
    $('vlanForm').reset();
    $('editId').value = '';
    $('vlanColor').value = '#58a6ff';
    $('duplicateBtn').classList.add('hidden');
    state.editingId = null;
    $('formError').classList.add('hidden');
}

async function editVlan(id) {
    const v = state.vlans.find(x => x.id === id);
    if (!v) return;
    fillForm(v);
}

async function duplicateVlan(id) {
    const v = state.vlans.find(x => x.id === id);
    if (!v) return;
    const copy = Object.assign({}, v);
    copy.id = null;
    copy.name = v.name + '-copy';
    copy.vid = '';
    fillForm(copy);
}

async function deleteVlan(id) {
    const v = state.vlans.find(x => x.id === id);
    if (!v) return;
    if (!confirm(text('confirmDelete') + ' ' + v.name + '?')) return;
    try {
        await api('vlans?id=' + encodeURIComponent(id), 'DELETE');
        showMessage(text('deleteSuccess'));
        loadVlans(); loadStatus();
    } catch (e) {
        showMessage(e.message, 'error');
    }
}

$('vlanForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('formError').classList.add('hidden');
    const payload = {
        name: $('vlanName').value.trim(),
        vid: parseInt($('vlanVid').value, 10),
        subnet: $('vlanSubnet').value.trim(),
        description: $('vlanDescription').value.trim(),
        tags: $('vlanTags').value.split(',').map(s => s.trim()).filter(Boolean),
        color: $('vlanColor').value,
        environment: $('vlanEnvironment').value,
    };
    try {
        if (state.editingId) {
            await api('vlans?id=' + encodeURIComponent(state.editingId), 'PUT', Object.assign({ id: state.editingId }, payload));
            showMessage(text('updateSuccess'));
        } else {
            await api('vlans', 'POST', payload);
            showMessage(text('createSuccess'));
        }
        resetForm(); loadVlans(); loadStatus();
    } catch (err) {
        $('formError').textContent = err.message;
        $('formError').classList.remove('hidden');
    }
});

$('cancelBtn').addEventListener('click', resetForm);
$('duplicateBtn').addEventListener('click', () => { if (state.editingId) duplicateVlan(state.editingId); });

document.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const sort = th.dataset.sort;
    if ($('sortBy').value === sort) {
        $('orderBy').value = $('orderBy').value === 'asc' ? 'desc' : 'asc';
    } else {
        $('sortBy').value = sort; $('orderBy').value = 'asc';
    }
    loadVlans();
}));

$('search').addEventListener('input', () => { state.page = 0; loadVlans(); });
$('tagFilter').addEventListener('change', () => { state.page = 0; loadVlans(); });
$('envFilter').addEventListener('change', () => { state.page = 0; loadVlans(); });
$('sortBy').addEventListener('change', () => loadVlans());
$('orderBy').addEventListener('change', () => loadVlans());

$('selectAll').addEventListener('change', (e) => {
    if (e.target.checked) state.vlans.forEach(v => state.selected.add(v.id));
    else state.vlans.forEach(v => state.selected.delete(v.id));
    renderVlans(); updateSelectedCount();
});

$('bulkDelete').addEventListener('click', async () => {
    if (!state.selected.size) return;
    if (!confirm(text('confirmBulkDelete', { count: state.selected.size }))) return;
    try {
        await api('vlans/bulk-delete', 'POST', { ids: Array.from(state.selected) });
        showMessage(text('deleteSuccess'));
        state.selected.clear();
        updateSelectedCount(); loadVlans(); loadStatus();
    } catch (e) { showMessage(e.message, 'error'); }
});

$('bulkApply').addEventListener('click', () => { switchTab('apply'); });
$('exportSelected').addEventListener('click', exportSelected);
$('exportSelected2').addEventListener('click', exportSelected);

async function exportSelected() {
    const ids = Array.from(state.selected);
    const data = ids.length ? state.vlans.filter(v => ids.includes(v.id)) : state.vlans;
    const blob = new Blob([JSON.stringify({ vlans: data }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'vlans.json'; a.click();
}

function renderApplyVlanList() {
    const div = $('applyVlanList');
    if (!state.vlans.length) { div.innerHTML = DOMPurify.sanitize('<p class="empty">' + text('noVlans') + '</p>'); return; }
    let html = '<div style="max-height:180px;overflow:auto;border:1px solid var(--border);padding:8px;border-radius:6px;">';
    state.vlans.forEach(v => {
        html += '<label style="display:block;margin:2px 0;"><input type="checkbox" class="apply-check" data-id="' + escapeHtml(v.id) + '" checked /> ' + escapeHtml(v.name) + ' (VID ' + escapeHtml(v.vid) + ')</label>';
    });
    html += '</div>';
    div.innerHTML = DOMPurify.sanitize(html);
}

function getApplyVlanIds() {
    const checked = Array.from(document.querySelectorAll('.apply-check:checked')).map(cb => cb.dataset.id);
    return checked.length ? checked : state.vlans.map(v => v.id);
}

$('applyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const clusterId = $('applyCluster').value;
    if (!clusterId) return;
    const vlanIds = getApplyVlanIds();
    const dryRun = $('applyDryRun').checked;
    const btn = $('applyBtn');
    btn.disabled = true; btn.textContent = text('applying');
    try {
        const r = await api('apply', 'POST', { cluster_id: clusterId, vlan_ids: vlanIds, dry_run: dryRun });
        const msg = dryRun ? text('dryRunResult', { count: r.vlans_pushed }) : text('applySuccess', { count: r.vlans_pushed, cluster: r.cluster_node || clusterId });
        showMessage(msg);
        $('applyResult').innerHTML = DOMPurify.sanitize('<pre>' + escapeHtml(JSON.stringify(r, null, 2)) + '</pre>');
        loadVlans(); loadStatus(); loadAudit();
    } catch (e) {
        showMessage(e.message, 'error');
    } finally { btn.disabled = false; btn.textContent = text('apply'); }
});

$('bulkApplyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const clusterIds = Array.from($('bulkClusters').selectedOptions).map(o => o.value);
    const vlanIds = getApplyVlanIds();
    const dryRun = $('bulkDryRun').checked;
    try {
        const r = await api('apply/bulk', 'POST', { cluster_ids: clusterIds, vlan_ids: vlanIds, dry_run: dryRun });
        showMessage(text('applySuccess', { count: r.results.length, cluster: 'clusters' }));
        $('bulkApplyResult').innerHTML = DOMPurify.sanitize('<pre>' + escapeHtml(JSON.stringify(r, null, 2)) + '</pre>');
        loadVlans(); loadStatus(); loadAudit();
    } catch (e) { showMessage(e.message, 'error'); }
});

$('complianceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const clusterId = $('complianceCluster').value;
    if (!clusterId) return;
    try {
        const r = await api('compliance?cluster_id=' + encodeURIComponent(clusterId));
        const d = r.data;
        let html = '<h3>' + (d.compliant ? text('compliant') : text('driftDetected')) + '</h3>';
        if (d.diff && d.diff.length) {
            html += '<table><thead><tr><th>VID</th><th>' + text('name') + '</th><th>' + text('status') + '</th></tr></thead><tbody>';
            d.diff.forEach(item => {
                const cls = item.status === 'missing' ? 'diff-missing' : (item.status === 'extra' ? 'diff-extra' : 'diff-mismatch');
                html += '<tr class="' + cls + '"><td>' + escapeHtml(item.vid) + '</td><td>' + escapeHtml(item.name) + '</td><td>' + escapeHtml(item.status) + '</td></tr>';
            });
            html += '</tbody></table>';
            html += '<div class="actions" style="margin-top:12px;">';
            html += '<button id="reapplyBtn" class="secondary" data-i18n="reapply">' + text('reapply') + '</button>';
            html += '<button id="removeStaleBtn" class="secondary" data-i18n="removeStale">' + text('removeStale') + '</button>';
            html += '</div>';
        }
        html += '<pre>' + escapeHtml(JSON.stringify(r, null, 2)) + '</pre>';
        $('complianceResult').innerHTML = DOMPurify.sanitize(html);
        if (d.diff && d.diff.length) {
            $('reapplyBtn').addEventListener('click', async () => {
                await api('compliance/reapply', 'POST', { cluster_id: clusterId });
                showMessage(text('reapply') + ' ' + text('compliant'));
                loadStatus();
            });
            $('removeStaleBtn').addEventListener('click', async () => {
                const vids = d.diff.filter(x => x.status === 'extra' && x.side === 'actual').map(x => x.vid);
                await api('compliance/remove', 'POST', { cluster_id: clusterId, vids: vids });
                showMessage(text('removeStale') + ' completed');
                loadStatus();
            });
        }
        loadAudit();
    } catch (e) { showMessage(e.message, 'error'); }
});

$('rangeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const start = parseInt($('rangeStart').value, 10);
    const end = parseInt($('rangeEnd').value, 10);
    const prefix = $('rangePrefix').value.trim();
    const payload = {
        start_vid: start, end_vid: end, name_prefix: prefix,
        subnet: $('rangeSubnet').value.trim(),
        description: $('rangeDescription').value.trim(),
        tags: $('rangeTags').value.split(',').map(s => s.trim()).filter(Boolean),
        color: $('rangeColor').value,
    };
    try {
        const r = await api('vlans/generate', 'POST', payload);
        state.candidates = r.data || [];
        let html = '<table><thead><tr><th>' + text('name') + '</th><th>VID</th><th>' + text('subnet') + '</th><th>' + text('valid') + '</th></tr></thead><tbody>';
        state.candidates.forEach(c => {
            html += '<tr><td>' + escapeHtml(c.name) + '</td><td>' + c.vid + '</td><td>' + fmtSubnet(c.subnet) + '</td><td>' + (c.valid ? '✓' : '✗') + '</td></tr>';
        });
        html += '</tbody></table>';
        html += '<button id="confirmRange" type="button" data-i18n="confirmImport">' + text('confirmImport') + '</button>';
        $('rangePreview').innerHTML = DOMPurify.sanitize(html);
        $('confirmRange').addEventListener('click', importCandidates);
    } catch (e) { showMessage(e.message, 'error'); }
});

async function importCandidates() {
    const valid = state.candidates.filter(c => c.valid);
    let imported = 0;
    for (const c of valid) {
        try {
            await api('vlans', 'POST', {
                name: c.name, vid: c.vid, subnet: c.subnet, description: c.description,
                tags: c.tags, color: c.color, environment: ''
            });
            imported++;
        } catch (e) { console.warn('candidate failed', c.name, e); }
    }
    showMessage(text('importSuccess', { count: imported }));
    state.candidates = []; $('rangePreview').innerHTML = '';
    loadVlans(); loadStatus(); loadAudit();
}

$('exportJSON').addEventListener('click', () => window.open('/api/plugins/vlan-provisioner/api/vlans/export?format=json'));
$('exportCSV').addEventListener('click', () => window.open('/api/plugins/vlan-provisioner/api/vlans/export?format=csv'));

$('importForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = $('importFile').files[0];
    if (!file) return;
    const content = await file.text();
    let data;
    try {
        data = JSON.parse(content);
    } catch (e) { showMessage('Invalid JSON', 'error'); return; }
    try {
        const r = await api('vlans/import', 'POST', data);
        showMessage(text('importSuccess', { count: r.imported }));
        if (r.errors && r.errors.length) showMessage('Import errors: ' + r.errors.length, 'warning');
        $('importResult').innerHTML = DOMPurify.sanitize('<pre>' + escapeHtml(JSON.stringify(r, null, 2)) + '</pre>');
        loadVlans(); loadStatus(); loadAudit();
    } catch (e) { showMessage(e.message, 'error'); }
});

async function loadTopology() {
    try {
        const r = await api('topology');
        const d = r.data;
        let html = '<h3>' + text('networkTopology') + '</h3>';
        html += '<p>' + text('totalVlans') + ': ' + d.vlans.length + '</p>';
        if (d.links && d.links.length) {
            html += '<ul>';
            d.links.forEach(l => { html += '<li>' + escapeHtml(l.name) + ' (VID ' + escapeHtml(l.vid) + ') → ' + escapeHtml(l.cluster_id) + '</li>'; });
            html += '</ul>';
        } else { html += '<p class="empty">' + text('noData') + '</p>'; }
        html += '<pre>' + escapeHtml(JSON.stringify(r, null, 2)) + '</pre>';
        $('topologyView').innerHTML = DOMPurify.sanitize(html);
    } catch (e) { console.error('topology', e); }
}

async function loadAudit() {
    try {
        const action = $('auditAction').value;
        const params = new URLSearchParams({ limit: '50', offset: '0' });
        if (action) params.set('action', action);
        const r = await api('audit?' + params.toString());
        const rows = r.data || [];
        if (!rows.length) { $('auditView').innerHTML = DOMPurify.sanitize('<p class="empty">' + text('noAudit') + '</p>'); return; }
        let html = '<table><thead><tr><th>' + text('dateRange') + '</th><th>' + text('cluster') + '</th><th>' + text('action') + '</th><th>' + text('target') + '</th></tr></thead><tbody>';
        rows.forEach(a => {
            html += '<tr><td>' + new Date(a.timestamp).toLocaleString() + '</td><td>' + escapeHtml(a.actor) + '</td><td>' + escapeHtml(a.action) + '</td><td>' + escapeHtml(a.target_id || '') + '</td></tr>';
        });
        html += '</tbody></table>';
        $('auditView').innerHTML = DOMPurify.sanitize(html);
    } catch (e) { console.error('audit', e); }
}

$('loadAudit').addEventListener('click', loadAudit);
$('auditAction').addEventListener('change', loadAudit);

async function loadSchedule() {
    try {
        const r = await api('schedule');
        const s = r.data || {};
        $('scheduleEnabled').checked = !!s.enabled;
        $('scheduleInterval').value = s.interval_minutes || 60;
    } catch (e) { console.error('schedule', e); }
}

$('scheduleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await api('schedule', 'POST', {
            enabled: $('scheduleEnabled').checked,
            interval_minutes: parseInt($('scheduleInterval').value, 10) || 60,
        });
        showMessage(text('saved'));
    } catch (e) { showMessage(e.message, 'error'); }
});

function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => { t.classList.toggle('active', t.dataset.tab === name); t.setAttribute('aria-selected', t.dataset.tab === name); });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === name + '-tab'));
    if (name === 'topology') loadTopology();
    if (name === 'audit') loadAudit();
    if (name === 'schedule') loadSchedule();
}

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    tab.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(tab.dataset.tab); } });
});

$('refreshBtn').addEventListener('click', () => { loadStatus(); loadVlans(); });
$('retryBtn').addEventListener('click', () => { hideError(); loadVlans(); });

async function init() {
    await initI18n();
    loadClusters(); loadStatus(); loadVlans(); loadSchedule();
}

init();
