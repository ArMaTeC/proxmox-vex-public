/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/disk-usage-explorer/ui.js
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
if (theme === 'corp-light') { document.documentElement.setAttribute('data-theme', 'corp-light'); } else { document.documentElement.removeAttribute('data-theme'); }
const $ = (id) => document.getElementById(id);
const i18n = window.parent && window.parent.ProxmoxVExI18n;
const t = (k, p) => i18n ? i18n.getT('disk-usage-explorer')(k, p ? { params: p } : undefined) : k;

let sortMode = 'size';
let viewMode = 'tree';
let rootPath = null;
let currentPath = null;
let currentConfig = {};
let canManage = false;
let currentData = null;
let currentTop = null;
let currentTypes = null;
let filterText = '';
let lastPrecomputeState = {};

async function api(path, method = 'GET', body = null) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

function formatSize(bytes) {
    if (bytes === null || bytes === undefined) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let val = bytes, i = 0;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function iconFor(type) {
    if (type === 'directory') return '📁';
    if (type === 'symlink') return '🔗';
    if (type === 'file') return '📄';
    return '❔';
}

function badgeFor(node) {
    if (node.accessible === false) return '<span class="node-badge error" title="Permission denied">Inaccessible</span>';
    if (node.scan_status === 'partial') return '<span class="node-badge" title="Size computation stopped early">Partial</span>';
    if (node.scan_status === 'stale') return '<span class="node-badge" title="Size may be out of date">Stale</span>';
    return '';
}

// snyk:ignore:DOM-based Cross-site Scripting (XSS)
function showError(message) { $('errorBox').innerHTML = message ? `<div class="error">${escapeHtml(message)}</div>` : ''; }
function showWarning(message) { $('errorBox').innerHTML = message ? `<div class="warning">${escapeHtml(message)}</div>` : ''; }
function showLoading(el) { if (el) el.innerHTML = '<p class="loading">Loading…</p>'; }

function matchesFilter(name) { return !filterText || (name || '').toLowerCase().includes(filterText); }

function nodeRowHtml(node) {
    const pct = Math.max(0, Math.min(100, (node.percent_of_parent || 0) * 100));
    const nameTitle = node.type === 'symlink' && node.symlink_target ? ` → ${escapeHtml(node.symlink_target)}` : '';
    return `
                <div class="node-row" data-path="${escapeHtml(node.path)}" data-type="${escapeHtml(node.type)}">
                    <span class="node-icon">${iconFor(node.type)}</span>
                    <span class="node-name" title="${escapeHtml(node.name)}${nameTitle}">${escapeHtml(node.name)}${nameTitle}</span>
                    ${badgeFor(node)}
                    <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
                    <span class="node-size">${formatSize(node.size_bytes)}</span>
                    ${node.type === 'directory' ? '<button class="secondary node-refresh" data-action="refresh">Refresh</button>' : ''}
                </div>
                ${node.type === 'directory' ? `<div class="children" data-children-for="${escapeHtml(node.path)}"></div>` : ''}
            `;
}

function renderTree(container, data) {
    const children = (data.children || []).filter(n => matchesFilter(n.name));
    if (children.length === 0) {
        container.innerHTML = filterText ? '<div class="empty">No entries match the filter.</div>' : '<div class="empty">Empty directory.</div>';
        return;
    }
    // snyk:ignore:DOM-based Cross-site Scripting (XSS)
    container.innerHTML = children.map(n => `<div class="node">${nodeRowHtml(n)}</div>`).join('');
    container.querySelectorAll('.node-row').forEach(wireRow);
    container.querySelectorAll('[data-action="refresh"]').forEach(wireRefreshBtn);
}

async function loadInto(container, path) {
    showLoading(container);
    try {
        const data = await api(`list?path=${encodeURIComponent(path)}&sort=${encodeURIComponent(sortMode)}`);
        currentData = data;
        renderTree(container, data);
        return data;
    } catch (e) {
        container.innerHTML = '';
        showError(e.message);
    }
}

function wireRow(row) {
    row.addEventListener('click', async (ev) => {
        if (ev.target.closest('[data-action="refresh"]')) return;
        if (row.dataset.type !== 'directory') {
            const nameEl = row.querySelector('.node-name');
            openFile(row.dataset.path, nameEl ? nameEl.textContent : '');
            return;
        }
        const childrenBox = row.parentElement.querySelector(`[data-children-for="${CSS.escape(row.dataset.path)}"]`);
        if (!childrenBox) return;
        if (childrenBox.dataset.loaded === '1') {
            childrenBox.dataset.loaded = '';
            childrenBox.innerHTML = '';
            return;
        }
        childrenBox.dataset.loaded = '1';
        await loadInto(childrenBox, row.dataset.path);
    });
}

function wireRefreshBtn(btn) {
    btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const row = btn.closest('.node-row');
        const path = row.dataset.path;
        btn.disabled = true;
        try {
            await api('size', 'POST', { path });
            const parentChildren = row.closest('.children') || $('tree');
            const parentPath = parentChildren.dataset.childrenFor || rootPath;
            await loadInto(parentChildren.dataset.childrenFor ? parentChildren : $('tree'), parentPath);
        } catch (e) {
            showError(e.message);
        } finally {
            btn.disabled = false;
        }
    });
}

function renderBreadcrumbs(path) {
    if (!path) return '';
    const parts = path.split('/').filter(Boolean);
    const crumbs = [`<span data-path="/">/</span>`];
    let acc = '';
    for (const part of parts) {
        acc += '/' + part;
        crumbs.push(`<span data-path="${escapeHtml(acc)}">${escapeHtml(part)}</span>`);
    }
    return 'Path: ' + crumbs.join(' <span class="muted">/</span> ');
}

function wireBreadcrumbs(el) {
    el.querySelectorAll('span[data-path]').forEach(span => {
        span.addEventListener('click', () => navigateTo(span.dataset.path));
    });
}

function tmHue(index) { return (index * 137) % 360; }
function tmColor(index, isDir) {
    const hue = tmHue(index);
    const sat = isDir ? '70%' : '45%';
    const light = isDir ? '45%' : '60%';
    return `hsl(${hue} ${sat} ${light})`;
}

function renderTreemap(container, data) {
    container.innerHTML = '';
    const children = (data.children || []).filter(c => c.size_bytes !== null && matchesFilter(c.name));
    if (children.length === 0) {
        container.innerHTML = filterText ? '<div class="empty">No entries match the filter.</div>' : '<div class="empty">No size data to visualise.</div>';
        return;
    }
    const total = data.size_bytes || children.reduce((a, c) => a + (c.size_bytes || 0), 0);
    if (!total) return;

    const wrap = document.createElement('div');
    wrap.style.display = 'flex'; wrap.style.width = '100%'; wrap.style.height = '100%'; wrap.style.flexDirection = 'row';
    container.appendChild(wrap);

    _sort_nodes(children, 'size');
    for (let i = 0; i < children.length; i++) {
        const c = children[i];
        const pct = ((c.size_bytes || 0) / total) * 100;
        const node = document.createElement('div');
        node.className = 'tm-node';
        node.style.flex = `0 0 ${pct}%`;
        node.style.background = tmColor(i, c.type === 'directory');
        if (c.size_bytes !== null) {
            const label = document.createElement('div');
            label.className = 'tm-label';
            // snyk:ignore:DOM-based Cross-site Scripting (XSS)
            label.innerHTML = `${escapeHtml(c.name)}<br><span class="tm-sublabel">${formatSize(c.size_bytes)}</span>`;
            node.appendChild(label);
        }
        node.title = `${c.name} — ${formatSize(c.size_bytes)} (${pct.toFixed(1)}%)`;
        if (c.type === 'directory') node.addEventListener('click', () => navigateTo(c.path));
        wrap.appendChild(node);
    }
}

function _sort_nodes(items, mode) {
    if (mode === 'name' || mode === 'size_on_disk') return; // handled by server for list
    items.sort((a, b) => (b.size_bytes || 0) - (a.size_bytes || 0));
}

function rankRowHtml(node, index, max) {
    const pct = max ? Math.max(0, Math.min(100, (node.size_bytes || 0) / max * 100)) : 0;
    const clickClass = node.type === 'directory' ? ' clickable' : '';
    return `
                <div class="rank-row${clickClass}" data-path="${escapeHtml(node.path)}" data-type="${escapeHtml(node.type)}">
                    <span class="rank-rank">#${index + 1}</span>
                    <span class="node-icon" style="width:22px">${iconFor(node.type)}</span>
                    <span class="node-name" style="flex:1">${escapeHtml(node.name)}</span>
                    <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
                    <span class="node-size">${formatSize(node.size_bytes)}</span>
                </div>
            `;
}

function renderTop(container, data) {
    container.innerHTML = '';
    const entries = (data.entries || []).filter(n => matchesFilter(n.name));
    if (entries.length === 0) {
        container.innerHTML = '<div class="empty">No large files or directories found.</div>';
        return;
    }
    const max = data.total_size || Math.max(...entries.map(e => e.size_bytes || 0));
    // snyk:ignore:DOM-based Cross-site Scripting (XSS)
    container.innerHTML = entries.map((e, i) => rankRowHtml(e, i, max)).join('');
    container.querySelectorAll('.rank-row.clickable').forEach(row => {
        row.addEventListener('click', () => navigateTo(row.dataset.path));
    });
}

function renderTypes(container, data) {
    container.innerHTML = '';
    const types = (data.types || []).filter(t => matchesFilter(t.extension));
    if (types.length === 0) {
        container.innerHTML = '<div class="empty">No file type data found.</div>';
        return;
    }
    const max = Math.max(...types.map(t => t.size_bytes || 0));
    // snyk:ignore:DOM-based Cross-site Scripting (XSS)
    container.innerHTML = types.map((t, i) => `
                <div class="rank-row">
                    <span class="rank-rank">#${i + 1}</span>
                    <span class="node-name" style="flex:1">${escapeHtml(t.extension)}</span>
                    <span class="bar-track"><span class="bar-fill" style="width:${max ? (t.size_bytes / max * 100) : 0}%"></span></span>
                    <span class="node-size" style="width:140px;text-align:right">${formatSize(t.size_bytes)} · ${t.count} files</span>
                </div>
            `).join('');
}

async function navigateTo(path) {
    currentPath = path;
    filterText = '';
    $('searchInput').value = '';
    // snyk:ignore:DOM-based Cross-site Scripting (XSS)
    $('rootPath').innerHTML = renderBreadcrumbs(path);
    wireBreadcrumbs($('rootPath'));
    showError('');
    await renderCurrent();
}

async function renderCurrent() {
    $('tree').style.display = 'none';
    $('treemap').style.display = 'none';
    $('topView').style.display = 'none';
    $('typesView').style.display = 'none';
    if (!currentPath) return;

    if (viewMode === 'tree') {
        $('tree').style.display = 'block';
        showLoading($('tree'));
        const data = await api(`list?path=${encodeURIComponent(currentPath)}&sort=${encodeURIComponent(sortMode)}`);
        currentData = data;
        $('rootPath').innerHTML = renderBreadcrumbs(data.path);
        wireBreadcrumbs($('rootPath'));
        // snyk:ignore:DOM-based Cross-site Scripting (XSS)
        $('rootPath').insertAdjacentHTML('beforeend', ` — total: ${formatSize(data.size_bytes)} (${data.total_children} items)`);
        renderTree($('tree'), data);
    } else if (viewMode === 'treemap') {
        $('treemap').style.display = 'flex';
        showLoading($('treemap'));
        const data = await api(`list?path=${encodeURIComponent(currentPath)}&sort=${encodeURIComponent(sortMode)}`);
        currentData = data;
        renderTreemap($('treemap'), data);
    } else if (viewMode === 'top') {
        $('topView').style.display = 'block';
        showLoading($('topView'));
        const data = await api(`top?path=${encodeURIComponent(currentPath)}&n=50`);
        currentTop = data;
        renderTop($('topView'), data);
    } else if (viewMode === 'types') {
        $('typesView').style.display = 'block';
        showLoading($('typesView'));
        const data = await api(`types?path=${encodeURIComponent(currentPath)}`);
        currentTypes = data;
        renderTypes($('typesView'), data);
    }
}

async function loadRoot() {
    showError('');
    showWarning('');
    try {
        const data = await api(`list?sort=${encodeURIComponent(sortMode)}`);
        rootPath = data.path;
        currentPath = data.path;
        if (data.path === rootPath && rootPath.endsWith('/disk-usage-explorer/data')) {
            showWarning('This plugin is configured to scan a safe default directory only. Open Settings to add host paths such as /.');
        }
        currentData = data;
        await renderCurrent();
    } catch (e) {
        showError(e.message);
    }
}

// Settings panel
async function tryLoadConfig() {
    try {
        const res = await fetch('config', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (res.ok) {
            canManage = true;
            $('settingsBtn').style.display = 'inline-block';
            const data = await res.json();
            let parsed = null;
            try { parsed = JSON.parse(data.config || '{}'); } catch (e) { }
            currentConfig = parsed && typeof parsed === 'object' ? parsed : {};
        } else if (res.status === 403) {
            canManage = false;
        }
    } catch (e) {
        canManage = false;
        currentConfig = {};
    }
}

function renderSettings() {
    const roots = Array.isArray(currentConfig.allowed_roots) ? currentConfig.allowed_roots : [];
    const excl = Array.isArray(currentConfig.excluded_patterns) ? currentConfig.excluded_patterns : [];
    $('rootsList').innerHTML = roots.map((r, i) => `<div class="list-item"><span>${escapeHtml(r)}</span><button class="secondary" data-idx="${i}" data-type="root">Remove</button></div>`).join('');
    $('exclusionsList').innerHTML = excl.map((r, i) => `<div class="list-item"><span>${escapeHtml(r)}</span><button class="secondary" data-idx="${i}" data-type="excl">Remove</button></div>`).join('');
    $('autoPrecompute').checked = currentConfig.auto_precompute !== false;
    $('fullScanBudget').value = currentConfig.full_scan_budget_ms || 300000;
    $('scanUser').value = currentConfig.scan_user || '';
    $('scanPassword').value = currentConfig.scan_password || '';

    $('rootsList').querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
        currentConfig.allowed_roots.splice(Number(btn.dataset.idx), 1);
        renderSettings();
    }));
    $('exclusionsList').querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
        currentConfig.excluded_patterns.splice(Number(btn.dataset.idx), 1);
        renderSettings();
    }));
}

function openSettings() { $('settingsPanel').style.display = 'block'; renderSettings(); }
function closeSettings() { $('settingsPanel').style.display = 'none'; }

async function saveSettings() {
    try {
        const raw = JSON.stringify(currentConfig, null, 4);
        await api('config', 'PUT', { config: raw });
        closeSettings();
        await loadRoot();
    } catch (e) {
        alert('Failed to save settings: ' + e.message);
    }
}

async function doExport() {
    if (!currentPath) return;
    const fmt = confirm('Export as CSV? (Cancel for JSON)') ? 'csv' : 'json';
    try {
        const res = await fetch(`export?path=${encodeURIComponent(currentPath)}&format=${fmt}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const disp = res.headers.get('content-disposition') || '';
        const m = disp.match(/filename="?([^"]+)"?/);
        a.download = m ? m[1] : `disk_usage.${fmt}`;
        // snyk:ignore:DOM-based Cross-site Scripting (XSS)
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        showError(e.message);
    }
}

let precomputeInterval = null;

function updatePrecomputeUI(state) {
    lastPrecomputeState = state || {};
    const panel = $('precomputePanel');
    const bar = $('precomputeBar');
    const status = $('precomputeStatus');
    const title = $('precomputeTitle');
    if (!state || !state.status) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = 'block';
    if (state.status === 'running') {
        title.textContent = 'Precomputing sizes…';
        bar.className = 'progress-fill progress-indeterminate';
        bar.style.width = '100%';
        const budget = state.budget_ms ? `${(state.budget_ms / 1000).toFixed(0)}s` : '—';
        status.textContent = `Scanning ${state.directories || 0} dirs, ${state.files || 0} files · ${formatSize(state.bytes || 0)} · ${escapeHtml(state.current_path || '')} · budget ${budget}`;
        $('precomputeBtn').disabled = true;
    } else if (state.status === 'complete') {
        title.textContent = 'Precompute complete';
        bar.className = 'progress-fill';
        bar.style.width = '100%';
        const elapsed = state.elapsed_ms ? `${(state.elapsed_ms / 1000).toFixed(1)}s` : '—';
        const budget = state.budget_ms ? `${(state.budget_ms / 1000).toFixed(0)}s` : '—';
        status.textContent = `Done: ${state.directories || 0} directories, ${state.files || 0} files · total ${formatSize(state.bytes || 0)} · elapsed ${elapsed} · budget ${budget}`;
        $('precomputeBtn').disabled = false;
    } else if (state.status === 'partial') {
        title.textContent = 'Precompute partial (time limit reached)';
        bar.className = 'progress-fill';
        bar.style.width = '100%';
        const elapsed = state.elapsed_ms ? `${(state.elapsed_ms / 1000).toFixed(1)}s` : '—';
        const budget = state.budget_ms ? `${(state.budget_ms / 1000).toFixed(0)}s` : '—';
        const stopped = state.stopped_path ? escapeHtml(state.stopped_path) : '—';
        status.textContent = `Partial: ${state.directories || 0} dirs, ${state.files || 0} files · ${formatSize(state.bytes || 0)} · elapsed ${elapsed} · budget ${budget} · reason ${escapeHtml(state.reason || '')} · stopped at ${stopped}`;
        $('precomputeBtn').disabled = false;
    } else if (state.status === 'error') {
        title.textContent = 'Precompute failed';
        bar.className = 'progress-fill';
        bar.style.width = '0%';
        bar.style.background = 'var(--danger)';
        status.textContent = `Error: ${escapeHtml(state.error || 'unknown')}`;
        $('precomputeBtn').disabled = false;
    } else if (state.status === 'ready') {
        title.textContent = 'Precompute sizes';
        bar.className = 'progress-fill';
        bar.style.width = '0%';
        bar.style.background = 'var(--accent)';
        status.textContent = 'Sizes are not cached. Click Precompute to cache the entire allowed root.';
        $('precomputeBtn').disabled = false;
    } else {
        panel.style.display = 'none';
    }
}

async function loadPrecomputeStatus() {
    try {
        let state = await api('precompute_status');
        if (!state || !state.status) state = { status: 'ready' };
        updatePrecomputeUI(state);
        if (state && state.status === 'running') {
            if (!precomputeInterval) precomputeInterval = setInterval(loadPrecomputeStatus, 500);
        } else if (precomputeInterval) {
            clearInterval(precomputeInterval);
            precomputeInterval = null;
        }
        if (state && (state.status === 'complete' || state.status === 'partial')) {
            await loadRoot();
        }
    } catch (e) {
        // ignore status errors
    }
}

async function startPrecompute(automatic = false) {
    if (!rootPath) return;
    if (!automatic && !confirm('Precompute sizes for the entire allowed root? This may take a while for large filesystems.')) return;
    updatePrecomputeUI({ status: 'running', directories: 0, files: 0, bytes: 0, current_path: rootPath });
    try {
        await api('precompute', 'POST');
        loadPrecomputeStatus();
    } catch (e) {
        showError(e.message);
    }
}

let currentFilePath = '';
let currentFileName = '';

async function openScanLog() {
    currentFilePath = '';
    currentFileName = 'Scan log';
    $('fileName').textContent = 'Scan log';
    downloadBtn.hidden = true;
    $('fileModal').hidden = false;
    await loadScanLogContent();
}

async function loadScanLogContent() {
    const tail = $('tailToggle').checked ? '1' : '0';
    try {
        $('fileContent').textContent = 'Loading…';
        const data = await api(`scan_log?tail=${tail}`);
        $('fileContent').textContent = data.content || '(empty scan log)';
    } catch (e) {
        $('fileContent').textContent = 'Error: ' + e.message;
    }
}

async function openFile(path, name) {
    currentFilePath = path;
    currentFileName = name;
    $('fileName').textContent = name || path;
    $('fileModal').hidden = false;
    await loadFileContent();
}

async function loadFileContent() {
    if (!currentFilePath) return;
    const tail = $('tailToggle').checked ? '1' : '0';
    try {
        $('fileContent').textContent = 'Loading…';
        const data = await api(`content?path=${encodeURIComponent(currentFilePath)}&tail=${tail}`);
        $('fileContent').textContent = data.content || '(empty file)';
    } catch (e) {
        $('fileContent').textContent = 'Error: ' + e.message;
    }
}

function closeFileModal() { $('fileModal').hidden = true; currentFilePath = ''; currentFileName = ''; }

function downloadCurrentFile() {
    if (currentFilePath) {
        window.open(`download?path=${encodeURIComponent(currentFilePath)}`, '_blank');
    }
}

(async () => {
    if (i18n) await i18n.loadPluginNamespaceFull('disk-usage-explorer', '/api/plugins/disk-usage-explorer/i18n');
    await tryLoadConfig();

    $('sortSelect').value = sortMode;
    $('viewSelect').value = viewMode;

    $('searchInput').addEventListener('input', (e) => { filterText = e.target.value.toLowerCase().trim(); renderCurrent(); });
    $('sortSelect').addEventListener('change', (e) => { sortMode = e.target.value; if (viewMode === 'tree' || viewMode === 'treemap') renderCurrent(); });
    $('viewSelect').addEventListener('change', (e) => { viewMode = e.target.value; renderCurrent(); });
    $('refreshRootBtn').addEventListener('click', async () => { if (currentPath) { try { await api('size', 'POST', { path: currentPath }); } catch (e) { } } await loadRoot(); });
    $('exportBtn').addEventListener('click', doExport);
    $('settingsBtn').addEventListener('click', openSettings);
    $('cancelSettingsBtn').addEventListener('click', closeSettings);
    $('saveSettingsBtn').addEventListener('click', saveSettings);

    $('addRootBtn').addEventListener('click', () => {
        const v = $('newRoot').value.trim();
        if (!v) return;
        if (!v.startsWith('/')) { alert('Root paths must be absolute (start with /)'); return; }
        currentConfig.allowed_roots = currentConfig.allowed_roots || [];
        if (!currentConfig.allowed_roots.includes(v)) currentConfig.allowed_roots.push(v);
        $('newRoot').value = '';
        renderSettings();
    });

    $('addExclusionBtn').addEventListener('click', () => {
        const v = $('newExclusion').value.trim();
        if (!v) return;
        currentConfig.excluded_patterns = currentConfig.excluded_patterns || [];
        v.split(',').map(s => s.trim()).filter(Boolean).forEach(p => {
            if (!currentConfig.excluded_patterns.includes(p)) currentConfig.excluded_patterns.push(p);
        });
        $('newExclusion').value = '';
        renderSettings();
    });

    $('entireHostBtn').addEventListener('click', () => {
        if (!confirm('Scanning the entire host filesystem (/host) can expose all files to this plugin. Continue?')) return;
        currentConfig.allowed_roots = ['/host'];
        currentConfig.excluded_patterns = ['proc', 'sys', 'dev', 'run'];
        currentConfig.auto_precompute = true;
        currentConfig.full_scan_budget_ms = 300000;
        renderSettings();
    });

    $('autoPrecompute').addEventListener('change', (e) => { currentConfig.auto_precompute = e.target.checked; });
    $('fullScanBudget').addEventListener('input', (e) => { currentConfig.full_scan_budget_ms = parseInt(e.target.value, 10) || 300000; });
    $('scanUser').addEventListener('input', (e) => { currentConfig.scan_user = e.target.value.trim(); });
    $('scanPassword').addEventListener('input', (e) => { currentConfig.scan_password = e.target.value; });

    $('precomputeBtn').addEventListener('click', startPrecompute);
    $('scanLogBtn').addEventListener('click', openScanLog);

    $('fileClose').addEventListener('click', closeFileModal);
    $('fileDownload').addEventListener('click', downloadCurrentFile);
    $('tailToggle').addEventListener('change', () => { if (currentFilePath) loadFileContent(); else loadScanLogContent(); });

    await loadRoot();
    await loadPrecomputeStatus();
    if (currentConfig.auto_precompute !== false && (!lastPrecomputeState.status || lastPrecomputeState.status === 'ready') && rootPath) {
        startPrecompute(true);
    }
})();
