/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/tenant-isolation/ui.js
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
const i18nApi = (window.parent && window.parent.ProxmoxVExI18n) || window.ProxmoxVExI18n;

function _t(key, params) {
    let s = key;
    if (i18nApi && i18nApi.getT) {
        const tr = i18nApi.getT('tenant-isolation')(key, { params });
        if (tr && tr !== key) s = tr;
    }
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            // Use literal string replacement (no user-controlled regex)
            s = s.split('{' + k + '}').join(String(v));
        }
    }
    return s;
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

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function toast(text, type = 'success') {
    const box = $('toasts');
    const item = document.createElement('div');
    item.className = `toast-item ${type}`;
    item.textContent = text;
    box.appendChild(item);
    setTimeout(() => item.remove(), 4000);
}

function showGlobalError(msg, show) {
    $('globalError').style.display = show ? 'block' : 'none';
    $('globalErrorText').textContent = msg;
    $('globalErrorText').className = 'error';
}

function setLoading(el, loading) {
    el.disabled = loading;
    if (loading) el.dataset.orig = el.textContent;
    if (loading) el.textContent = _t('loading');
    if (!loading && el.dataset.orig) el.textContent = el.dataset.orig;
}

const tabs = ['tenants', 'bounds', 'validate', 'conflicts', 'audit', 'quotas', 'import'];
const tabNames = ['tenants', 'bounds', 'validate', 'conflicts', 'audit', 'quotas', 'importExport'];
let state = { status: {}, tenants: [], clusters: [], vms: [], bounds: [], conflicts: [], audit: [], page: 0, auditPage: 0 };

function renderTabs() {
    const c = $('tabs');
    c.innerHTML = '';
    tabs.forEach((id, i) => {
        const btn = document.createElement('button');
        btn.className = 'tab';
        btn.textContent = _t(tabNames[i]);
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', 'false');
        btn.setAttribute('tabindex', '0');
        btn.dataset.tab = id;
        if (i === 0) setTab(id);
        btn.onclick = () => setTab(id);
        btn.onkeydown = (e) => {
            if (e.key === 'ArrowRight') { const next = c.children[(i + 1) % tabs.length]; next.focus(); next.click(); }
            if (e.key === 'ArrowLeft') { const prev = c.children[(i - 1 + tabs.length) % tabs.length]; prev.focus(); prev.click(); }
        };
        c.appendChild(btn);
    });
}

function setTab(id) {
    tabs.forEach(t => { $(t + 'Section').classList.remove('active'); });
    const buttons = [...$('tabs').children];
    buttons.forEach(b => b.setAttribute('aria-selected', 'false'));
    $(id + 'Section').classList.add('active');
    const btn = buttons.find(b => b.dataset.tab === id);
    if (btn) btn.setAttribute('aria-selected', 'true');
    if (id === 'bounds') renderBoundsForm();
    if (id === 'validate') renderValidateForm();
    if (id === 'audit') populateAuditFilters();
    if (id === 'quotas') renderQuotaForm();
}

async function init() {
    $('status').textContent = _t('loading');
    $('status').className = 'status';
    showGlobalError('', false);
    try {
        if (i18nApi && i18nApi.loadPluginNamespaceFull) {
            await i18nApi.loadPluginNamespaceFull('tenant-isolation', '/api/plugins/tenant-isolation/i18n');
        }
        const [status, clusters] = await Promise.all([api('status'), api('clusters')]);
        state.status = status;
        state.clusters = clusters.clusters || [];
        $('statStatusVal').textContent = status.status === 'running' ? _t('running') : status.status;
        $('statTenantsVal').textContent = status.tenant_count || 0;
        $('statBoundsVal').textContent = status.bound_count || 0;
        $('status').textContent = status.status === 'running' ? _t('running') : status.status;
        await loadConflictsCounts();
        await loadTenants();
        await loadBounds();
        await loadAudit();
        renderTabs();
        populateClusterSelects();
        toast(_t('running'), 'success');
    } catch (e) {
        $('status').textContent = _t('error');
        $('status').classList.add('error');
        showGlobalError(_t('apiError', { message: e.message }), true);
        toast(e.message, 'error');
    }
}

function populateClusterSelects() {
    ['boundsCluster', 'validateCluster'].forEach(id => {
        const sel = $(id);
        sel.innerHTML = DOMPurify.sanitize(`<option value="">${_t('selectCluster')}</option>`);
        state.clusters.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id; opt.textContent = `${c.name} (${c.id})`;
            sel.appendChild(opt);
        });
    });
}

async function loadTenants() {
    try {
        const search = $('tenantSearch').value.trim();
        const statusFilter = $('tenantStatusFilter').value;
        const q = new URLSearchParams({ search, status: statusFilter, sort: 'name', order: 'asc', limit: '20', offset: String(state.page * 20) });
        const data = await api(`tenants?${q.toString()}`);
        state.tenants = data.tenants || [];
        renderTenants(data.total || 0);
        $('statTenantsVal').textContent = data.total || 0;
        populateTenantSelects();
    } catch (e) { toast(e.message, 'error'); }
}

function renderTenants(total) {
    const list = $('tenantsList');
    if (!state.tenants.length) { list.innerHTML = DOMPurify.sanitize(`<p class="empty">${_t('noTenants')}</p>`); return; }
    let html = `<table><thead><tr><th>ID</th><th>${_t('name')}</th><th>${_t('status')}</th><th>${_t('vms')}</th><th>${_t('createdAt')}</th><th class="actions">${_t('actions')}</th></tr></thead><tbody>`;
    state.tenants.forEach(t => {
        const cls = t.status === 'locked' ? 'locked' : t.status === 'retired' ? 'retired' : '';
        html += `<tr>
                    <td class="muted">${escapeHtml(t.id)}</td>
                    <td>${escapeHtml(t.name)}</td>
                    <td><span class="badge ${cls}">${_t(t.status)}</span></td>
                    <td>${escapeHtml(t.vm_count || 0)}</td>
                    <td class="muted">${t.created_at ? new Date(t.created_at).toLocaleString() : '-'}</td>
                    <td class="actions">
                        <button class="secondary" onclick="editTenant('${escapeHtml(t.id)}')">${_t('edit')}</button>
                        <button class="secondary" onclick="toggleLock('${escapeHtml(t.id)}','${escapeHtml(t.status)}')">${t.status === 'active' ? _t('lock') : _t('unlock')}</button>
                        <button class="secondary" onclick="dupTenant('${escapeHtml(t.id)}')">${_t('duplicate')}</button>
                        <button class="danger" onclick="delTenant('${escapeHtml(t.id)}','${escapeHtml(t.name)}')">${_t('delete')}</button>
                    </td>
                </tr>`;
    });
    html += '</tbody></table>';
    list.innerHTML = DOMPurify.sanitize(html);
    renderPagination(total, 'tenantPagination', 'state.page', loadTenants);
}

function renderPagination(total, id, pageVar, cb) {
    const el = $(id);
    el.style.display = 'none';
    el.innerHTML = '';
    const pages = Math.ceil(total / 20);
    if (pages <= 1) return;
    el.style.display = 'flex';
    const cur = pageVar === 'state.page' ? state.page : state.auditPage;
    for (let i = 0; i < pages; i++) {
        const b = document.createElement('button');
        b.textContent = i + 1;
        b.className = i === cur ? '' : 'secondary';
        b.disabled = i === cur;
        b.onclick = () => { if (pageVar === 'state.page') state.page = i; else state.auditPage = i; cb(); };
        el.appendChild(b);
    }
}

function populateTenantSelects() {
    ['boundsTenant', 'validateTenant', 'auditTenant', 'quotaTenant', 'netTenant', 'permTenant'].forEach(id => {
        const sel = $(id);
        const cur = sel.value;
        sel.innerHTML = DOMPurify.sanitize((id === 'auditTenant' ? `<option value="">${_t('all')}</option>` : `<option value="">${_t('selectTenant')}</option>`));
        state.tenants.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id; opt.textContent = t.name;
            sel.appendChild(opt);
        });
        sel.value = cur;
    });
}

function openTenantDialog() {
    $('tenantDialog').style.display = 'block';
    $('tenantDialogTitle').textContent = _t('createTenant');
    $('editTenantId').value = '';
    $('tenantName').value = '';
    $('tenantStatus').value = 'active';
    $('quotaMaxVms').value = '';
    $('quotaMaxCpu').value = '';
    $('quotaMaxMem').value = '';
    $('tenantError').style.display = 'none';
    $('tenantName').focus();
}

function closeTenantDialog() { $('tenantDialog').style.display = 'none'; }

async function saveTenant() {
    const id = $('editTenantId').value;
    const name = $('tenantName').value.trim();
    if (!name) { $('tenantError').textContent = _t('nameRequired'); $('tenantError').style.display = 'block'; return; }
    const quotas = {
        max_vms: $('quotaMaxVms').value ? parseInt($('quotaMaxVms').value, 10) : null,
        max_cpu: $('quotaMaxCpu').value ? parseInt($('quotaMaxCpu').value, 10) : null,
        max_memory: $('quotaMaxMem').value ? parseInt($('quotaMaxMem').value, 10) : null
    };
    const payload = { name, status: $('tenantStatus').value, quotas };
    try {
        if (id) { payload.id = id; await api('tenants', 'PUT', payload); toast(_t('edit'), 'success'); }
        else { await api('tenants', 'POST', payload); toast(_t('createTenant'), 'success'); }
        closeTenantDialog();
        await loadTenants();
    } catch (e) { $('tenantError').textContent = e.message; $('tenantError').style.display = 'block'; }
}

async function editTenant(id) {
    try {
        const data = await api(`tenants?id=${encodeURIComponent(id)}`);
        const t = data.tenant;
        $('tenantDialog').style.display = 'block';
        $('tenantDialogTitle').textContent = _t('editTenant');
        $('editTenantId').value = t.id;
        $('tenantName').value = t.name;
        $('tenantStatus').value = t.status;
        const q = t.quotas || {};
        $('quotaMaxVms').value = q.max_vms || '';
        $('quotaMaxCpu').value = q.max_cpu || '';
        $('quotaMaxMem').value = q.max_memory || '';
        $('tenantError').style.display = 'none';
    } catch (e) { toast(e.message, 'error'); }
}

async function toggleLock(id, cur) {
    const next = cur === 'active' ? 'locked' : 'active';
    try {
        await api('tenants', 'PUT', { id, status: next });
        toast(next === 'locked' ? _t('lock') : _t('unlock'), 'success');
        await loadTenants();
    } catch (e) { toast(e.message, 'error'); }
}

async function delTenant(id, name) {
    if (!confirm(_t('confirmDelete', { name }))) return;
    try {
        await api(`tenants?id=${encodeURIComponent(id)}`, 'DELETE');
        toast(_t('delete'), 'success');
        await loadTenants();
    } catch (e) {
        if (e.message.includes('assigned')) {
            if (confirm(_t('deleteHasResources', { count: e.message.match(/\d+/) ? e.message.match(/\d+/)[0] : 'some' }))) {
                await api(`tenants?id=${encodeURIComponent(id)}`, 'DELETE', { id, force: true });
                toast(_t('delete'), 'success');
                await loadTenants();
            }
        } else { toast(e.message, 'error'); }
    }
}

async function dupTenant(id) {
    const name = prompt(_t('duplicate'));
    if (!name) return;
    try {
        const data = await api('tenants/duplicate', 'POST', { id, name });
        toast(_t('duplicateDone', { name, count: data.bounds_copied }), 'success');
        await loadTenants();
    } catch (e) { toast(e.message, 'error'); }
}

async function onBoundsClusterChange() {
    const cid = $('boundsCluster').value;
    $('vmMulti').innerHTML = '<option>Loading...</option>';
    if (!cid) { $('vmMulti').innerHTML = ''; return; }
    try {
        const data = await api(`vms?cluster_id=${encodeURIComponent(cid)}`);
        state.vms = data.vms || [];
        renderVmOptions();
    } catch (e) { toast(e.message, 'error'); }
}

function renderVmOptions() {
    const q = $('vmSearch').value.toLowerCase();
    const sel = $('vmMulti');
    sel.innerHTML = '';
    state.vms.filter(v => (v.name + v.vmid).toLowerCase().includes(q)).forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.vmid;
        opt.textContent = `${v.vmid} — ${v.name || v.vmid}`;
        sel.appendChild(opt);
    });
}

function renderBoundsForm() {
    populateTenantSelects();
    populateClusterSelects();
}

async function assignVms() {
    const cid = $('boundsCluster').value;
    const tid = $('boundsTenant').value;
    const selected = [...$('vmMulti').selectedOptions].map(o => o.value);
    if (!cid || !tid || !selected.length) { toast('Select cluster, tenant and VM(s)', 'warning'); return; }
    try {
        const data = await api('bounds', 'POST', { cluster_id: cid, tenant_id: tid, vmids: selected });
        if (data.duplicates && data.duplicates.length) toast(data.duplicates.join('; '), 'warning');
        else toast(_t('assign'), 'success');
        await loadBounds();
        await loadConflictsCounts();
    } catch (e) { toast(e.message, 'error'); }
}

async function loadBounds() {
    try {
        const data = await api('bounds');
        state.bounds = data.bounds || [];
        renderBounds();
        $('statBoundsVal').textContent = data.total || 0;
    } catch (e) { toast(e.message, 'error'); }
}

function renderBounds() {
    const list = $('boundsList');
    if (!state.bounds.length) { list.innerHTML = DOMPurify.sanitize(`<p class="empty">${_t('noBounds')}</p>`); return; }
    let html = `<table><thead><tr><th>${_t('cluster')}</th><th>${_t('tenant')}</th><th>${_t('vms')}</th><th class="actions">${_t('actions')}</th></tr></thead><tbody>`;
    state.bounds.forEach(b => {
        const t = state.tenants.find(x => x.id === b.tenant_id);
        const tenantName = t ? t.name : b.tenant_id;
        const vmTags = b.vmids.map(v => `<span class="badge" style="margin-right:4px">${escapeHtml(v)}</span>`).join('');
        html += `<tr>
                    <td class="muted">${escapeHtml(b.cluster_id)}</td>
                    <td>${escapeHtml(tenantName)}</td>
                    <td>${vmTags}</td>
                    <td class="actions">
                        <button class="danger" onclick="removeVm('${escapeHtml(b.id)}','${escapeHtml(b.vmids[0] || '')}')">${_t('remove')}</button>
                        <button class="danger" onclick="removeAll('${escapeHtml(b.id)}')">${_t('removeAll')}</button>
                    </td>
                </tr>`;
    });
    html += '</tbody></table>';
    list.innerHTML = DOMPurify.sanitize(html);
}

async function removeVm(id, vmid) {
    if (!vmid) return;
    try {
        await api(`bounds?id=${encodeURIComponent(id)}&vmid=${encodeURIComponent(vmid)}`, 'DELETE');
        toast(_t('remove'), 'success');
        await loadBounds();
        await loadConflictsCounts();
    } catch (e) { toast(e.message, 'error'); }
}

async function removeAll(id) {
    if (!confirm('Remove all VM assignments?')) return;
    try {
        await api(`bounds?id=${encodeURIComponent(id)}`, 'DELETE');
        toast(_t('removeAll'), 'success');
        await loadBounds();
        await loadConflictsCounts();
    } catch (e) { toast(e.message, 'error'); }
}

function renderValidateForm() {
    populateTenantSelects();
    populateClusterSelects();
}

async function validateSingle() {
    const cid = $('validateCluster').value;
    const tid = $('validateTenant').value;
    const vmid = $('validateVmid').value.trim();
    if (!cid || !tid || !vmid) { toast('Select cluster, tenant and VMID', 'warning'); return; }
    try {
        const data = await api('validate', 'POST', { cluster_id: cid, tenant_id: tid, vmid });
        const cls = data.valid ? 'valid' : 'invalid';
        const text = data.valid ? _t('valid') : _t('invalid') + ' — ' + escapeHtml(data.reason || '');
        $('validateResult').innerHTML = DOMPurify.sanitize(`<p><span class="indicator ${cls}"></span>${text}</p>`);
    } catch (e) { toast(e.message, 'error'); }
}

async function validateTenant() {
    const cid = $('validateCluster').value;
    const tid = $('validateTenant').value;
    if (!cid || !tid) { toast('Select cluster and tenant', 'warning'); return; }
    try {
        const data = await api('validate', 'POST', { cluster_id: cid, tenant_id: tid });
        const html = data.results.map(r => {
            const cls = r.valid ? 'valid' : 'invalid';
            const text = r.valid ? _t('valid') : _t('invalid') + ' — ' + escapeHtml(r.reason || '');
            return `<p><span class="indicator ${cls}"></span>${escapeHtml(r.vmid)}: ${text}</p>`;
        }).join('');
        $('validateResult').innerHTML = DOMPurify.sanitize(html || `<p class="empty">No VMs to validate.</p>`);
    } catch (e) { toast(e.message, 'error'); }
}

async function loadConflictsCounts() {
    try {
        const data = await api('conflicts');
        const n = (data.conflicts || []).length;
        $('statConflictsVal').textContent = n;
        return data;
    } catch (e) { return { conflicts: [] }; }
}

async function loadConflicts(autoFixAll = false) {
    try {
        let data = await api('conflicts');
        if (autoFixAll) {
            for (const c of (data.conflicts || [])) {
                await api('conflicts/fix', 'POST', { cluster_id: c.cluster_id, vmid: c.vmid });
            }
            data = await api('conflicts');
            toast(_t('conflictFixed'), 'success');
            await loadBounds();
            await loadConflictsCounts();
        }
        const list = $('conflictsList');
        if (!data.conflicts.length) { list.innerHTML = DOMPurify.sanitize(`<p class="empty">${_t('noConflicts')}</p>`); return; }
        let html = `<table><thead><tr><th>VMID</th><th>${_t('cluster')}</th><th>${_t('tenants')}</th><th class="actions">${_t('actions')}</th></tr></thead><tbody>`;
        data.conflicts.forEach(c => {
            html += `<tr>
                        <td class="muted">${escapeHtml(c.vmid)}</td>
                        <td class="muted">${escapeHtml(c.cluster_id)}</td>
                        <td>${c.tenant_ids.map(tid => escapeHtml((state.tenants.find(t => t.id === tid) || {}).name || tid)).join(', ')}</td>
                        <td class="actions">
                            <button class="secondary" onclick="fixConflict('${escapeHtml(c.cluster_id)}','${escapeHtml(c.vmid)}')">Unbind</button>
                        </td>
                    </tr>`;
        });
        html += '</tbody></table>';
        list.innerHTML = DOMPurify.sanitize(html);
        $('statConflictsVal').textContent = data.conflicts.length;
    } catch (e) { toast(e.message, 'error'); }
}

async function fixConflict(cluster_id, vmid) {
    try {
        await api('conflicts/fix', 'POST', { cluster_id, vmid });
        toast(_t('conflictFixed'), 'success');
        await loadConflicts();
        await loadBounds();
    } catch (e) { toast(e.message, 'error'); }
}

function populateAuditFilters() {
    populateTenantSelects();
    const acts = ['create', 'edit', 'delete', 'bound', 'unbound', 'validate', 'conflict', 'auto_fix', 'import', 'export', 'duplicate', 'lock'];
    const sel = $('auditAction');
    sel.innerHTML = DOMPurify.sanitize(`<option value="">${_t('all')}</option>`);
    acts.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; sel.appendChild(o); });
}

async function loadAudit() {
    try {
        const tenant = $('auditTenant').value;
        const action = $('auditAction').value;
        const q = new URLSearchParams({ sort: 'timestamp', order: 'desc', limit: '20', offset: String(state.auditPage * 20) });
        if (tenant) q.set('tenant_id', tenant);
        if (action) q.set('action', action);
        const data = await api(`audit?${q.toString()}`);
        state.audit = data.audit || [];
        renderAudit(data.total || 0);
    } catch (e) { toast(e.message, 'error'); }
}

function renderAudit(total) {
    const list = $('auditList');
    if (!state.audit.length) { list.innerHTML = DOMPurify.sanitize(`<p class="empty">${_t('noAudit')}</p>`); return; }
    let html = `<table><thead><tr><th>Time</th><th>${_t('status')}</th><th>Actor</th><th>${_t('tenant')}</th><th>${_t('cluster')}</th><th>VMID</th></tr></thead><tbody>`;
    state.audit.forEach(a => {
        html += `<tr>
                    <td class="muted">${new Date(a.timestamp).toLocaleString()}</td>
                    <td><span class="badge">${escapeHtml(a.action)}</span></td>
                    <td class="muted">${escapeHtml(a.actor)}</td>
                    <td>${escapeHtml(a.tenant_id || '-')}</td>
                    <td class="muted">${escapeHtml(a.cluster_id || '-')}</td>
                    <td class="muted">${escapeHtml(a.vmid || '-')}</td>
                </tr>`;
    });
    html += '</tbody></table>';
    list.innerHTML = DOMPurify.sanitize(html);
    renderPagination(total, 'auditPagination', 'state.auditPage', loadAudit);
}

function renderQuotaForm() {
    populateTenantSelects();
}

async function loadQuota() {
    const tid = $('quotaTenant').value;
    if (!tid) { $('quotaPanel').innerHTML = ''; return; }
    try {
        const data = await api(`quotas?tenant_id=${encodeURIComponent(tid)}`);
        const q = data.quotas || {};
        const usage = data.vm_usage || 0;
        const max = q.max_vms || '∞';
        const pct = q.max_vms ? Math.min(100, (usage / q.max_vms) * 100) : 0;
        $('quotaPanel').innerHTML = DOMPurify.sanitize(`
                    <div class="card"><div class="title">VMs</div><div class="value">${escapeHtml(usage)} / ${escapeHtml(max)}</div>
                    <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div></div>
                    <div class="form">
                        <label>Max VMs<input type="number" id="editMaxVms" value="${escapeHtml(q.max_vms || '')}"></label>
                        <label>Max CPU<input type="number" id="editMaxCpu" value="${escapeHtml(q.max_cpu || '')}"></label>
                        <label>Max Memory<input type="number" id="editMaxMem" value="${escapeHtml(q.max_memory || '')}"></label>
                        <button onclick="saveQuota('${escapeHtml(tid)}')">${_t('save')}</button>
                    </div>
                `);
    } catch (e) { toast(e.message, 'error'); }
}

async function saveQuota(tid) {
    const quotas = {
        max_vms: $('editMaxVms').value ? parseInt($('editMaxVms').value, 10) : null,
        max_cpu: $('editMaxCpu').value ? parseInt($('editMaxCpu').value, 10) : null,
        max_memory: $('editMaxMem').value ? parseInt($('editMaxMem').value, 10) : null
    };
    try {
        await api('quotas', 'PUT', { tenant_id: tid, quotas });
        toast(_t('quotaSaved'), 'success');
        await loadQuota();
    } catch (e) { toast(e.message, 'error'); }
}

async function saveNetwork() {
    const tid = $('netTenant').value;
    if (!tid) { toast('Select a tenant', 'warning'); return; }
    const vlans = $('netVlans').value.split(',').map(s => s.trim()).filter(Boolean);
    try {
        await api('network', 'POST', { tenant_id: tid, vlans });
        toast(_t('networkSaved'), 'success');
    } catch (e) { toast(e.message, 'error'); }
}

async function savePermission() {
    const tid = $('permTenant').value;
    const template = $('permTemplate').value;
    if (!tid) { toast('Select a tenant', 'warning'); return; }
    try {
        await api('permissions', 'POST', { tenant_id: tid, template });
        toast(_t('permissionSaved'), 'success');
    } catch (e) { toast(e.message, 'error'); }
}

async function doImport() {
    try {
        const data = JSON.parse($('importJson').value);
        const mode = $('importMode').value;
        const res = await api('import', 'POST', { mode, data });
        $('importResult').textContent = JSON.stringify(res, null, 2);
        toast(_t('importDone', { tenants: res.imported.tenants, bounds: res.imported.bounds }), 'success');
        await init();
    } catch (e) {
        $('importResult').textContent = e.message;
        toast(e.message, 'error');
    }
}

async function doExport() {
    try {
        const res = await fetch('export');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'tenant-isolation.json'; a.click();
        URL.revokeObjectURL(url);
        toast(_t('exportReady'), 'success');
    } catch (e) { toast(e.message, 'error'); }
}

window.openTenantDialog = openTenantDialog;
window.closeTenantDialog = closeTenantDialog;
window.saveTenant = saveTenant;
window.editTenant = editTenant;
window.toggleLock = toggleLock;
window.delTenant = delTenant;
window.dupTenant = dupTenant;
window.onBoundsClusterChange = onBoundsClusterChange;
window.assignVms = assignVms;
window.removeVm = removeVm;
window.removeAll = removeAll;
window.validateSingle = validateSingle;
window.validateTenant = validateTenant;
window.loadConflicts = loadConflicts;
window.fixConflict = fixConflict;
window.loadAudit = loadAudit;
window.loadQuota = loadQuota;
window.saveQuota = saveQuota;
window.saveNetwork = saveNetwork;
window.savePermission = savePermission;
window.doImport = doImport;
window.doExport = doExport;

// Initial load
init();
