/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/vm-template-marketplace/ui.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Ui JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
const qs = new URLSearchParams(window.location.search);
if (qs.get('theme') === 'corp-light') document.documentElement.setAttribute('data-theme', 'corp-light');
const $ = (id) => document.getElementById(id);

const i18n = window.parent && window.parent.ProxmoxVExI18n;
const t = (k, p) => i18n ? i18n.getT('vm-template-marketplace')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('vm-template-marketplace', '/api/plugins/vm-template-marketplace/i18n');

const state = { templates: [], clusters: [], sort: { col: 'name', order: 'asc' } };

async function api(path, method = 'GET', body = null) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts); const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data;
}
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
// Surface the raw backend message even when the i18n namespace is not loaded.
function showError(msg) { toast(msg, 'error'); }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; } catch (e) { $('status').textContent = 'Error'; } }
async function loadClusters() { try { const d = await api('clusters'); state.clusters = d.data || []; } catch (e) { } }

async function loadTemplates() {
    try { const d = await api('templates'); state.templates = d.templates || []; renderCatalog(); } catch (e) { showError(e.message); }
}

function filteredCatalog() {
    const txt = $('cSearch').value.toLowerCase();
    const cat = $('cCategory').value.toLowerCase();
    const tag = $('cTag').value.toLowerCase();
    let data = state.templates.filter(tmpl => {
        const textMatch = !txt || (tmpl.name || '').toLowerCase().includes(txt) || (tmpl.id || '').toLowerCase().includes(txt);
        const catMatch = !cat || (tmpl.category || '').toLowerCase() === cat;
        const tagMatch = !tag || ((tmpl.tags || []).join(' ').toLowerCase().includes(tag));
        return textMatch && catMatch && tagMatch;
    });
    data = data.sort((a, b) => {
        const av = (a[state.sort.col] || ''), bv = (b[state.sort.col] || '');
        if (state.sort.order === 'asc') return av.localeCompare(bv); return bv.localeCompare(av);
    });
    return data;
}

function renderCatalog() {
    const data = filteredCatalog();
    const c = $('catalogList');
    if (!data.length) { c.innerHTML = '<p class="empty">No templates.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="id">ID</th><th data-sort="name">Name</th><th data-sort="category">Category</th><th>Tags</th><th>Description</th><th>Actions</th></tr></thead><tbody>';
    data.forEach(tmpl => {
        const tags = (tmpl.tags || []).map(tg => `<span class="badge">${tg}</span>`).join(' ');
        html += `<tr>
                    <td class="muted">${tmpl.id}</td>
                    <td class="muted">${tmpl.name}</td>
                    <td class="muted">${tmpl.category || ''}</td>
                    <td class="muted">${tags}</td>
                    <td class="muted">${tmpl.description || ''}</td>
                    <td class="actions">
                        <button data-import="${tmpl.id}" type="button">Import</button>
                        <button data-edit="${tmpl.id}" type="button" class="secondary">Edit</button>
                        <button data-delete="${tmpl.id}" type="button" class="secondary">Delete</button>
                    </td>
                </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-edit]').forEach(b => b.addEventListener('click', () => editTemplate(b.dataset.edit)));
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deleteTemplate(b.dataset.delete)));
    c.querySelectorAll('button[data-import]').forEach(b => b.addEventListener('click', () => importTemplate(b.dataset.import)));
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; state.sort.order = state.sort.col === col && state.sort.order === 'asc' ? 'desc' : 'asc'; state.sort.col = col; renderCatalog(); }));
}

function editTemplate(id) {
    const t = state.templates.find(x => x.id === id); if (!t) return;
    $('tId').value = t.id; $('tName').value = t.name; $('tSource').value = t.source || '';
    $('tCategory').value = t.category || ''; $('tTags').value = (t.tags || []).join(', '); $('tDesc').value = t.description || '';
    switchTab('add');
}

async function deleteTemplate(id) { if (!confirm('Delete template ' + id + '?')) return; try { await api('template', 'DELETE', { id }); toast(t('deleted'), 'success'); loadTemplates(); } catch (e) { showError(e.message); } }

async function importTemplate(id) { try { const res = await api('import', 'POST', { template_id: id, cluster_id: (state.clusters[0] || {}).id }); toast(`${t('imported')} Job: ${res.job_id}`, 'success'); loadJobs(); } catch (e) { showError(e.message); } }

async function saveTemplate(e) {
    e.preventDefault(); $('tError').textContent = '';
    const payload = {
        id: $('tId').value.trim(), name: $('tName').value.trim(), source: $('tSource').value.trim(),
        category: $('tCategory').value.trim(), tags: $('tTags').value.trim(), description: $('tDesc').value.trim()
    };
    if (!payload.id || !payload.name) { $('tError').textContent = 'ID and name are required'; return; }
    try { await api('templates', 'POST', payload); toast(t('saved'), 'success'); $('tmplForm').reset(); loadTemplates(); }
    catch (err) { $('tError').textContent = err.message; showError(err.message); }
}

async function loadJobs() {
    try {
        const d = await api('jobs'); const c = $('jobsList'); const data = d.data || [];
        if (!data.length) { c.innerHTML = '<p class="empty">No jobs.</p>'; return; }
        let html = '<table><thead><tr><th>Job</th><th>Template</th><th>Target VMID</th><th>Status</th><th>Created</th></tr></thead><tbody>';
        // Some backends return template_id/created without template_name, so fall back gracefully.
        data.forEach(j => html += `<tr><td class="muted">${j.job_id}</td><td class="muted">${j.template_name || j.template_id || ''}</td><td class="muted">${j.target_vmid}</td><td class="muted"><span class="badge">${j.status}</span></td><td class="muted">${new Date(j.created || Date.now()).toLocaleString()}</td></tr>`);
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showError(e.message); }
}

function doExportJson() { window.location.href = 'export'; }

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'jobs') loadJobs(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('tmplForm').addEventListener('submit', saveTemplate); $('tReset').addEventListener('click', () => $('tmplForm').reset()); $('cSearch').addEventListener('input', renderCatalog); $('cCategory').addEventListener('change', renderCatalog); $('cTag').addEventListener('input', renderCatalog); $('exportJson').addEventListener('click', doExportJson); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('vm-template-marketplace', '/api/plugins/vm-template-marketplace/i18n'); await loadStatus(); await loadClusters(); await loadTemplates(); wireEvents(); })();
