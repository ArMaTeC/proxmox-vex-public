/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/syslog-forwarder/ui.js
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
if (['modern-dark', 'corp-dark', 'corp-light'].includes(theme)) {
    document.documentElement.setAttribute('data-theme', theme);
}

const API = '/api/plugins/syslog-forwarder/api';

let app = {
    tab: 'targets',
    targets: [],
    clusters: [{ id: '__global__', name: 'Global' }],
    config: { paused: false, version: '', updated_at: null, targets: [] },
    editing: null,
    testLog: { data: [], total: 0, offset: 0, limit: 20 },
    auditLog: { data: [], total: 0, offset: 0, limit: 20 },
    health: [],
    filterRules: [],
    dirty: false,
};

let t = (key, params) => key;
let _i18nReady = false;

async function loadI18n() {
    const i18n = (window.parent && window.parent.ProxmoxVExI18n);
    try {
        const res = await fetch('/i18n/locales/syslog-forwarder/en.json');
        if (res.ok) {
            const dict = await res.json();
            if (i18n) {
                i18n.registerNamespaceBulk('syslog-forwarder', { en: dict });
                const language = i18n.getLanguage ? i18n.getLanguage() : 'en';
                if (language !== 'en') {
                    try {
                        const r2 = await fetch(`/i18n/locales/syslog-forwarder/${language}.json`);
                        if (r2.ok) i18n.registerNamespaceBulk('syslog-forwarder', { [language]: await r2.json() });
                    } catch (_) { }
                }
            }
            if (i18n && i18n.getT) t = i18n.getT('syslog-forwarder');
            _i18nReady = true;
        }
    } catch (e) {
        console.warn('i18n load failed', e);
    }
    translateAll();
}

function translateAll() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translated = t(key);
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            if (!el.dataset.i18nDefault) el.dataset.i18nDefault = el.placeholder;
            el.placeholder = translated === key ? el.dataset.i18nDefault : translated;
        } else {
            if (!el.dataset.i18nDefault) el.dataset.i18nDefault = el.textContent;
            el.textContent = translated === key ? el.dataset.i18nDefault : translated;
        }
    });
}

function $(id) { return document.getElementById(id); }
function showMessage(text, type = 'info') {
    const m = $('message');
    m.innerHTML = '<div class="message ' + type + '"></div>';
    if (m.firstElementChild) m.firstElementChild.textContent = text;
    setTimeout(() => { m.innerHTML = ''; }, 4000);
}
function notify(text, type = 'info') {
    if (window.parent && window.parent.ProxmoxVExNotify) {
        window.parent.ProxmoxVExNotify({ message: text, type });
    } else {
        showMessage(text, type);
    }
}
async function api(path, method = 'GET', body = null) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(API + '/' + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}
function badgeClass(status) {
    if (status === 'ok' || status === 'success') return 'ok';
    if (status === 'warning' || status === 'warn') return 'warn';
    if (status === 'error' || status === 'danger') return 'danger';
    return 'paused';
}

const TABS = [
    { id: 'targets', label: 'targets' },
    { id: 'target-form', label: 'newTarget', hidden: true },
    { id: 'filter', label: 'filterBuilder' },
    { id: 'test', label: 'test' },
    { id: 'test-log', label: 'testLog' },
    { id: 'health', label: 'health' },
    { id: 'diagnostics', label: 'diagnostics' },
    { id: 'audit', label: 'auditLog' },
    { id: 'import', label: 'import' },
];

function renderTabs() {
    const nav = $('tabs');
    nav.innerHTML = '';
    TABS.forEach(tab => {
        if (tab.hidden) return;
        const btn = document.createElement('button');
        btn.className = 'tab';
        btn.setAttribute('role', 'tab');
        btn.setAttribute('id', 'tab-btn-' + tab.id);
        btn.setAttribute('aria-controls', 'tab-' + tab.id);
        btn.setAttribute('tabindex', '0');
        btn.textContent = t(tab.label);
        if (app.tab === tab.id) {
            btn.setAttribute('aria-selected', 'true');
        } else {
            btn.setAttribute('aria-selected', 'false');
        }
        btn.addEventListener('click', () => switchTab(tab.id));
        nav.appendChild(btn);
    });
}

function switchTab(id, skipCheck = false) {
    if (!skipCheck && app.dirty && id !== 'target-form') {
        if (!confirm(t('unsavedChanges'))) return;
        app.dirty = false;
    }
    app.tab = id;
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const sec = $('tab-' + id);
    if (sec) sec.classList.add('active');
    renderTabs();
    if (id === 'test-log') loadTestLog();
    if (id === 'audit') loadAudit();
    if (id === 'health') loadHealth();
    if (id === 'filter') renderFilterBuilder();
}

async function loadStatus() {
    try {
        const s = await api('status');
        $('statusValue').textContent = s.status;
        $('statusText').textContent = s.status;
        $('statusText').className = 'status ' + (s.paused ? 'warning' : '');
        $('targetCount').textContent = s.targets.total;
        $('enabledCount').textContent = s.targets.enabled;
        $('versionValue').textContent = s.version ? s.version.slice(0, 8) : '-';
        $('pauseBtn').textContent = s.paused ? t('resumeAll') : t('pauseAll');
        $('pauseBtn').setAttribute('aria-pressed', String(s.paused));
        app.config.paused = s.paused;
    } catch (e) { showMessage(e.message, 'error'); }
}

async function loadClusters() {
    try {
        const data = await api('clusters');
        const list = Array.isArray(data) ? data : (data.data || []);
        app.clusters = [{ id: '__global__', name: 'Global' }].concat(list.map(c => ({ id: c.id || c.cluster_id, name: c.name || c.display_name || c.id })));
    } catch (e) { app.clusters = [{ id: '__global__', name: 'Global' }]; }
    populateClusterSelects();
}

function populateClusterSelects() {
    ['targetCluster'].forEach(id => {
        const sel = $(id); if (!sel) return;
        sel.innerHTML = '';
        app.clusters.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o); });
    });
}

function populateTargetDropdowns() {
    const lists = ['testTarget', 'diagTarget'];
    lists.forEach(id => {
        const sel = $(id); if (!sel) return;
        sel.innerHTML = DOMPurify.sanitize('<option value="">' + t('selectTarget') + '</option>');
        app.targets.filter(t => t.enabled).forEach(target => {
            const o = document.createElement('option'); o.value = target.id; o.textContent = `${target.host}:${target.port}`; sel.appendChild(o);
        });
    });
    const fb = $('targetFallback');
    if (fb) {
        fb.innerHTML = DOMPurify.sanitize('<option value="">' + t('none') + '</option>');
        app.targets.forEach(target => {
            if (app.editing && target.id === app.editing) return;
            const o = document.createElement('option'); o.value = target.id; o.textContent = `${target.host}:${target.port}`; fb.appendChild(o);
        });
    }
}

async function loadConfig() {
    try {
        const cfg = await api('config');
        app.config = cfg;
        app.targets = cfg.targets || [];
        app.filterRules = (cfg.targets[0] && cfg.targets[0].filter) ? (cfg.targets[0].filter.rules || []) : [];
        renderTargets();
        populateTargetDropdowns();
    } catch (e) { showMessage(e.message, 'error'); }
}

function filteredTargets() {
    const q = ($('targetSearch') || { value: '' }).value.toLowerCase();
    const p = ($('targetFilterProto') || { value: '' }).value;
    return app.targets.filter(t => {
        const matches = !q || (t.host || '').toLowerCase().includes(q);
        const proto = !p || t.protocol === p;
        return matches && proto;
    });
}

function renderTargets() {
    const tbody = document.querySelector('#targetsTable tbody');
    tbody.innerHTML = '';
    const list = filteredTargets();
    $('targetsEmpty').style.display = list.length ? 'none' : 'block';
    list.forEach(target => {
        const tr = document.createElement('tr');
        const status = (app.health.find(h => h.target_id === target.id) || {}).status || (target.enabled ? 'ok' : 'paused');
        tr.innerHTML = DOMPurify.sanitize(`
                    <td><input type="checkbox" ${target.enabled ? 'checked' : ''} aria-label="${t('enabled')}" data-toggle="${target.id}"></td>
                    <td>${target.host}</td>
                    <td>${target.port}</td>
                    <td>${target.protocol}</td>
                    <td>${target.format}</td>
                    <td><span class="badge ${badgeClass(status)}">${status}</span></td>
                    <td class="row">
                        <button class="secondary" data-edit="${target.id}">${t('edit')}</button>
                        <button class="secondary" data-test="${target.id}">${t('test')}</button>
                        <button class="secondary" data-diag="${target.id}">${t('diagnostics')}</button>
                        <button class="danger" data-delete="${target.id}">${t('delete')}</button>
                    </td>`);
        tbody.appendChild(tr);
    });
    tbody.querySelectorAll('[data-toggle]').forEach(cb => cb.addEventListener('change', e => toggleTarget(e.target.dataset.toggle)));
    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => editTarget(e.target.dataset.edit)));
    tbody.querySelectorAll('[data-test]').forEach(b => b.addEventListener('click', e => { switchTab('test'); $('testTarget').value = e.target.dataset.test; }));
    tbody.querySelectorAll('[data-diag]').forEach(b => b.addEventListener('click', e => { switchTab('diagnostics'); $('diagTarget').value = e.target.dataset.diag; }));
    tbody.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', e => confirmDelete(e.target.dataset.delete)));
}

function editTarget(id) {
    const target = app.targets.find(t => t.id === id);
    if (!target) return;
    app.editing = id;
    $('targetId').value = id;
    $('targetCluster').value = target.cluster_id || '__global__';
    $('targetHost').value = target.host;
    $('targetPort').value = target.port;
    $('targetProtocol').value = target.protocol;
    $('targetTls').checked = target.tls;
    $('targetEnabled').checked = target.enabled;
    $('targetFormat').value = target.format;
    $('targetTemplate').value = target.template || '';
    $('targetRate').value = target.rate_limit || '';
    $('targetFallback').value = target.fallback_target_id || '';
    app.filterRules = ((target.filter || {}).rules || []);
    $('targetFormTitle').textContent = t('updateTarget');
    app.dirty = false;
    switchTab('target-form', true);
    populateTargetDropdowns();
}

function resetTargetForm() {
    app.editing = null;
    $('targetForm').reset();
    $('targetId').value = '';
    $('targetFormTitle').textContent = t('newTarget');
    $('targetValidation').textContent = '';
    app.dirty = false;
    app.filterRules = [];
}

$('addTargetBtn').addEventListener('click', () => { resetTargetForm(); switchTab('target-form', true); });
$('targetCancel').addEventListener('click', () => { resetTargetForm(); switchTab('targets', true); });

$('targetProtocol').addEventListener('change', e => {
    if (e.target.value === 'udp' && $('targetTls').checked) {
        showMessage(t('tlsUdpWarning'), 'warning');
    }
});

async function saveTarget(e) {
    e.preventDefault();
    const body = {
        cluster_id: $('targetCluster').value,
        host: $('targetHost').value.trim(),
        port: parseInt($('targetPort').value, 10),
        protocol: $('targetProtocol').value,
        tls: $('targetTls').checked,
        enabled: $('targetEnabled').checked,
        format: $('targetFormat').value,
        template: $('targetTemplate').value.trim(),
        rate_limit: parseInt($('targetRate').value || '0', 10) || null,
        fallback_target_id: $('targetFallback').value,
        filter: { rules: app.filterRules, presets: [] },
    };
    if (body.protocol === 'udp' && body.tls) {
        showMessage(t('tlsUdpWarning'), 'error');
        return;
    }
    try {
        if (app.editing) {
            body.id = app.editing;
            await api('targets?id=' + app.editing, 'PUT', body);
            notify(t('targetSaved'), 'success');
        } else {
            await api('targets', 'POST', body);
            notify(t('targetSaved'), 'success');
        }
        app.dirty = false;
        await loadConfig();
        switchTab('targets', true);
    } catch (err) { $('targetValidation').textContent = err.message; }
}
$('targetForm').addEventListener('submit', saveTarget);
$('targetForm').addEventListener('input', () => app.dirty = true);

async function toggleTarget(id) {
    try {
        await api('targets/toggle?id=' + id, 'POST', { id });
        await loadConfig();
        await loadStatus();
    } catch (e) { showMessage(e.message, 'error'); }
}

let pendingDelete = null;
function confirmDelete(id) {
    pendingDelete = id;
    const t = app.targets.find(x => x.id === id);
    $('confirmText').textContent = t ? `${t.host}:${t.port}` : '';
    $('confirmModal').classList.add('active');
}
$('confirmNo').addEventListener('click', () => { pendingDelete = null; $('confirmModal').classList.remove('active'); });
$('confirmYes').addEventListener('click', async () => {
    if (!pendingDelete) return;
    try {
        await api('targets?id=' + pendingDelete, 'DELETE', { id: pendingDelete });
        notify(t('targetDeleted'), 'success');
        await loadConfig();
        await loadStatus();
    } catch (e) { showMessage(e.message, 'error'); }
    pendingDelete = null;
    $('confirmModal').classList.remove('active');
});

function renderFilterBuilder() {
    const container = $('rulesContainer');
    container.innerHTML = '';
    app.filterRules.forEach((rule, idx) => {
        const div = document.createElement('div');
        div.className = 'rule-row';
        div.innerHTML = DOMPurify.sanitize(`
                    <select aria-label="${t('action')}" data-idx="${idx}" data-field="action">
                        <option value="include" ${rule.action === 'include' ? 'selected' : ''}>${t('include')}</option>
                        <option value="exclude" ${rule.action === 'exclude' ? 'selected' : ''}>${t('exclude')}</option>
                    </select>
                    <select aria-label="${t('type')}" data-idx="${idx}" data-field="type">
                        <option value="regex" ${rule.type === 'regex' ? 'selected' : ''}>${t('regex')}</option>
                        <option value="glob" ${rule.type === 'glob' ? 'selected' : ''}>${t('glob')}</option>
                        <option value="exact" ${rule.type === 'exact' ? 'selected' : ''}>${t('exact')}</option>
                    </select>
                    <input type="text" value="${rule.pattern || ''}" placeholder="${t('pattern')}" aria-label="${t('pattern')}" data-idx="${idx}" data-field="pattern" style="min-width:200px">
                    <label><input type="checkbox" ${rule.enabled !== false ? 'checked' : ''} data-idx="${idx}" data-field="enabled" style="width:auto"> ${t('enabled')}</label>
                    <button class="danger" data-remove="${idx}">${t('removeRule')}</button>`);
        container.appendChild(div);
    });
    container.querySelectorAll('input, select').forEach(el => el.addEventListener('input', updateFilterRule));
    container.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', e => {
        const idx = parseInt(e.target.dataset.remove, 10);
        app.filterRules.splice(idx, 1);
        renderFilterBuilder();
    }));
    validateFilter();
}

function updateFilterRule(e) {
    const el = e.target;
    const idx = parseInt(el.dataset.idx, 10);
    const field = el.dataset.field;
    const rule = app.filterRules[idx];
    if (field === 'enabled') rule[field] = el.checked;
    else rule[field] = el.value;
    app.dirty = true;
    validateFilter();
}

$('addRuleBtn').addEventListener('click', () => {
    app.filterRules.push({ id: Date.now().toString(), action: 'include', type: 'regex', pattern: '', enabled: true });
    renderFilterBuilder();
    app.dirty = true;
});

async function validateFilter() {
    if (!app.filterRules.length) { $('filterValidation').textContent = ''; return; }
    try {
        const r = await api('filter/validate', 'POST', { rules: app.filterRules });
        $('filterValidation').textContent = r.errors ? r.errors.join(' ') : '';
    } catch (e) { }
}

$('dryRunBtn').addEventListener('click', async () => {
    const lines = $('dryRunInput').value.split('\n').filter(Boolean);
    try {
        const r = await api('filter/test', 'POST', { rules: app.filterRules, messages: lines });
        $('dryRunResult').innerHTML = DOMPurify.sanitize(`<div class="message info">${t('matched')}: ${r.matched} / ${r.total}</div>`);
    } catch (e) { showMessage(e.message, 'error'); }
});

$('testForm').addEventListener('submit', async e => {
    e.preventDefault();
    const target_id = $('testTarget').value;
    if (!target_id) { showMessage(t('noTargetSelected'), 'error'); return; }
    const message = $('testMessage').value;
    try {
        const r = await api('test', 'POST', { target_id, message });
        $('testResult').innerHTML = DOMPurify.sanitize(`<div class="message ${r.result === 'success' ? 'success' : 'error'}">${t('result')}: ${r.result} · ${t('latency')}: ${r.latency_ms}ms ${r.error ? '· ' + r.error : ''}</div>`);
        if (r.result === 'success') notify(t('testSent'), 'success');
        await loadHealth();
    } catch (e) { showMessage(e.message, 'error'); }
});

async function loadTestLog() {
    try {
        const r = await api(`test-log?limit=${app.testLog.limit}&offset=${app.testLog.offset}`);
        app.testLog = { ...app.testLog, ...r };
        const tbody = document.querySelector('#testLogTable tbody');
        tbody.innerHTML = '';
        r.data.forEach(entry => {
            const tr = document.createElement('tr');
            tr.innerHTML = DOMPurify.sanitize(`<td>${entry.sent_at ? entry.sent_at.replace('T', ' ').slice(0, 19) : ''}</td><td>${entry.target_id ? entry.target_id.slice(0, 12) : ''}</td><td>${entry.message || ''}</td><td><span class="badge ${badgeClass(entry.result)}">${entry.result}</span></td><td>${entry.latency_ms || 0}</td>`);
            tbody.appendChild(tr);
        });
        $('logPage').textContent = `${Math.floor(app.testLog.offset / app.testLog.limit) + 1}`;
    } catch (e) { showMessage(e.message, 'error'); }
}
$('refreshLogBtn').addEventListener('click', loadTestLog);
$('clearLogBtn').addEventListener('click', async () => {
    try { await api('test-log', 'DELETE'); loadTestLog(); } catch (e) { showMessage(e.message, 'error'); }
});
$('logPrev').addEventListener('click', () => { if (app.testLog.offset >= app.testLog.limit) { app.testLog.offset -= app.testLog.limit; loadTestLog(); } });
$('logNext').addEventListener('click', () => { if (app.testLog.offset + app.testLog.limit < app.testLog.total) { app.testLog.offset += app.testLog.limit; loadTestLog(); } });
$('generateLogsBtn').addEventListener('click', async () => {
    try { await api('test/generate', 'POST', { count: 5 }); loadTestLog(); } catch (e) { showMessage(e.message, 'error'); }
});

async function loadHealth() {
    try {
        const r = await api('health');
        app.health = r.data || [];
        renderHealth();
    } catch (e) { showMessage(e.message, 'error'); }
}
function renderHealth() {
    const grid = $('healthGrid');
    grid.innerHTML = '';
    if (!app.health.length) grid.innerHTML = DOMPurify.sanitize(`<div class="empty" data-i18n="noTargets">${t('noTargets')}</div>`);
    app.health.forEach(h => {
        const card = document.createElement('div');
        card.className = 'card';
        const target = app.targets.find(x => x.id === h.target_id) || {};
        card.innerHTML = DOMPurify.sanitize(`
                    <div class="title">${target.host || h.target_id}:${target.port || ''}</div>
                    <div class="value ${badgeClass(h.status)}">${h.status}</div>
                    <div class="muted">${t('lastSend')}: ${h.last_send ? h.last_send.replace('T', ' ').slice(0, 19) : '-'}</div>
                    <div class="muted">${t('queueDepth')}: ${h.queue_depth || 0}</div>
                    ${h.last_error ? `<div class="validation">${h.last_error}</div>` : ''}
                `);
        grid.appendChild(card);
    });
}

$('diagnosticsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const target_id = $('diagTarget').value;
    const type = $('diagType').value;
    if (!target_id) { showMessage(t('noTargetSelected'), 'error'); return; }
    try {
        const r = await api('diagnostics', 'POST', { target_id, type });
        $('diagnosticsResult').innerHTML = DOMPurify.sanitize(`<div class="message ${r.result === 'ok' ? 'success' : 'error'}">${t('result')}: ${r.result}<br>${r.details}</div>`);
    } catch (e) { showMessage(e.message, 'error'); }
});

async function loadAudit() {
    try {
        const r = await api(`audit-log?limit=${app.auditLog.limit}&offset=${app.auditLog.offset}`);
        app.auditLog = { ...app.auditLog, ...r };
        const tbody = document.querySelector('#auditTable tbody');
        tbody.innerHTML = '';
        r.data.forEach(a => {
            const tr = document.createElement('tr');
            tr.innerHTML = DOMPurify.sanitize(`<td>${a.timestamp ? a.timestamp.replace('T', ' ').slice(0, 19) : ''}</td><td>${a.actor}</td><td>${a.action}</td><td class="muted">${JSON.stringify(a.previous).slice(0, 60)}</td><td class="muted">${JSON.stringify(a.next).slice(0, 60)}</td>`);
            tbody.appendChild(tr);
        });
        $('auditPage').textContent = `${Math.floor(app.auditLog.offset / app.auditLog.limit) + 1}`;
    } catch (e) { showMessage(e.message, 'error'); }
}
$('auditPrev').addEventListener('click', () => { if (app.auditLog.offset >= app.auditLog.limit) { app.auditLog.offset -= app.auditLog.limit; loadAudit(); } });
$('auditNext').addEventListener('click', () => { if (app.auditLog.offset + app.auditLog.limit < app.auditLog.total) { app.auditLog.offset += app.auditLog.limit; loadAudit(); } });

$('pauseBtn').addEventListener('click', async () => {
    try {
        const r = await api('pause', 'POST', { paused: !app.config.paused });
        app.config.paused = r.paused;
        await loadStatus();
    } catch (e) { showMessage(e.message, 'error'); }
});

$('exportBtn').addEventListener('click', async () => {
    try {
        const data = await api('config/export');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'syslog-forwarder-config.json';
        a.click();
        URL.revokeObjectURL(a.href);
    } catch (e) { showMessage(e.message, 'error'); }
});

$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
        const text = await f.text();
        const data = JSON.parse(text);
        const r = await api('config/import', 'POST', data);
        notify(`${t('import')}: ${r.imported.targets} ${t('targets')}`, 'success');
        await loadConfig();
        await loadStatus();
    } catch (err) { showMessage(err.message, 'error'); }
    e.target.value = '';
});

window.addEventListener('beforeunload', e => {
    if (app.dirty) { e.preventDefault(); e.returnValue = t('unsavedChanges'); }
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('confirmModal').classList.contains('active')) { $('confirmModal').classList.remove('active'); pendingDelete = null; }
});

async function init() {
    await loadI18n();
    renderTabs();
    await loadClusters();
    await loadConfig();
    await loadStatus();
    await loadHealth();
    setInterval(() => { if (!app.dirty) loadStatus(); }, 30000);
}
init();
