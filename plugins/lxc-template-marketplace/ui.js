/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/lxc-template-marketplace/ui.js
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
const t = (k, p) => i18n ? i18n.getT('lxc-template-marketplace')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('lxc-template-marketplace', '/api/plugins/lxc-template-marketplace/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = `${s.templates_count} templates`; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join(''); $('iCluster').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }

async function loadCatalog() {
    try {
        const s = $('catSearch').value, o = $('catOs').value, a = $('catArch').value, st = $('catSource').value, sort = $('catSort').value; const params = new URLSearchParams(); if (s) params.set('search', s); if (o) params.set('os', o); if (a) params.set('arch', a); if (st) params.set('source_type', st); params.set('sort', sort); const d = await api('templates?' + params.toString()); const c = $('catalogList');
        if (!d.templates.length) { c.innerHTML = '<p class="empty">No templates.</p>'; return; }
        let html = '<table><thead><tr><th data-sort="id">ID</th><th data-sort="name">Name</th><th data-sort="os">OS</th><th data-sort="arch">Arch</th><th>Source</th><th>Actions</th></tr></thead><tbody>';
        const osSet = new Set(), archSet = new Set();
        d.templates.forEach(tmpl => { osSet.add(tmpl.os); archSet.add(tmpl.arch); html += `<tr data-id="${escapeHtml(tmpl.id)}"><td class="muted">${escapeHtml(tmpl.id)}</td><td class="muted">${escapeHtml(tmpl.name)}</td><td class="muted">${escapeHtml(tmpl.os)}</td><td class="muted">${escapeHtml(tmpl.arch)}</td><td class="muted">${escapeHtml(tmpl.source)}</td><td class="actions"><button class="viewBtn secondary">View</button><button class="editBtn secondary">Edit</button><button class="delBtn secondary">Delete</button><button class="importBtn">Import</button></td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
        [$('catOs'), $('tOs')].forEach(el => { const old = el.value; el.innerHTML = DOMPurify.sanitize('<option value="">All</option>' + Array.from(osSet).map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('')); el.value = old; });
        $('catArch').innerHTML = DOMPurify.sanitize('<option value="">All</option>' + Array.from(archSet).map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join(''));
        c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { $('catSort').value = th.dataset.sort; loadCatalog(); }));
        c.querySelectorAll('.viewBtn').forEach(b => b.addEventListener('click', () => { viewTemplate(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', () => { editTemplate(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.delBtn').forEach(b => b.addEventListener('click', () => { deleteTemplate(b.closest('tr').dataset.id); }));
        c.querySelectorAll('.importBtn').forEach(b => b.addEventListener('click', () => { openImport(b.closest('tr').dataset.id); }));
    } catch (err) { showError(err.message); }
}

async function viewTemplate(id) { try { const d = await api('templates?search=' + encodeURIComponent(id)); const t = (d.templates || []).find(x => x.id === id); if (!t) throw new Error('Not found'); $('mTitle').textContent = t.name; $('mBody').textContent = JSON.stringify(t, null, 2); $('detailModal').classList.add('active'); } catch (err) { showError(err.message); } }

async function editTemplate(id) { try { const d = await api('templates?search=' + encodeURIComponent(id)); const t = (d.templates || []).find(x => x.id === id); if (!t) throw new Error('Not found'); $('tIdH').value = t.id; $('tId').value = t.id; $('tName').value = t.name; $('tOs').value = t.os; $('tArch').value = t.arch; $('tVersion').value = t.version; $('tSource').value = t.source; $('tDesc').value = t.description; $('tMeta').value = t.metadata ? JSON.stringify(t.metadata) : ''; $('addTitle').textContent = 'Edit Template'; $('tCancel').hidden = false; switchTab('add'); } catch (err) { showError(err.message); } }

async function saveTemplate() { $('tError').textContent = ''; const id = $('tId').value.trim(), name = $('tName').value.trim(), os = $('tOs').value, arch = $('tArch').value.trim(), version = $('tVersion').value.trim(), source = $('tSource').value.trim(), description = $('tDesc').value.trim(), meta = $('tMeta').value.trim(); if (!id || !name) { $('tError').textContent = 'ID and name required'; return; } try { const body = { id, name, os, arch, version, source, description }; if (meta) body.metadata = meta; const d = await api('templates', 'POST', body); toast(t('saved'), 'success'); resetAdd(); loadCatalog(); loadImportOpts(); } catch (err) { $('tError').textContent = err.message; showError(err.message); } }

async function deleteTemplate(id) { if (!confirm('Delete template?')) return; try { await api('templates?id=' + encodeURIComponent(id), 'DELETE'); toast(t('deleted'), 'success'); loadCatalog(); loadImportOpts(); } catch (err) { showError(err.message); } }

function resetAdd() { $('tIdH').value = ''; $('tId').value = ''; $('tName').value = ''; $('tOs').value = 'debian'; $('tArch').value = ''; $('tVersion').value = ''; $('tSource').value = ''; $('tDesc').value = ''; $('tMeta').value = ''; $('addTitle').textContent = 'Add Template'; $('tCancel').hidden = true; $('tError').textContent = ''; }

async function loadImportOpts() { try { const d = await api('templates'); const opts = (d.templates || []).map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join(''); $('iTmpl').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }

async function loadPublicLists() { try { const d = await api('public-lists'); const opts = (d.public_lists || []).map(l => `<option value="${escapeHtml(l.id)}" data-url="${escapeHtml(l.url)}">${escapeHtml(l.name)}</option>`).join(''); $('pList').innerHTML = DOMPurify.sanitize('<option value="">Custom URL</option>' + opts); } catch (e) { } }

function onPublicListChange() { const opt = $('pList').selectedOptions[0]; const u = opt ? opt.getAttribute('data-url') : ''; $('pUrl').value = u || ''; $('pUrl').disabled = !!$('pList').value; }

function openImport(id) { $('iTmpl').value = id; switchTab('import'); }

async function importTmpl() { $('iError').textContent = ''; const id = $('iTmpl').value, cluster = $('iCluster').value; if (!id || !cluster) { $('iError').textContent = 'Template and cluster required'; return; } try { const d = await api('import', 'POST', { template_id: id, cluster_id: cluster }); $('iResult').innerHTML = DOMPurify.sanitize(`<p class="muted">Import queued: ${escapeHtml(d.job_id)}</p>`); toast(t('imported'), 'success'); } catch (err) { $('iError').textContent = err.message; showError(err.message); } }

async function pullPublic() { $('pError').textContent = ''; const list_id = $('pList').value, url = $('pUrl').value.trim(); if (!list_id && !url) { $('pError').textContent = 'Select a list or enter a URL'; return; } const btn = $('pPull'); const oldText = btn.textContent; btn.disabled = true; btn.textContent = 'Pulling...'; $('pResult').innerHTML = '<p class="muted">Starting pull...</p>'; const body = {}; if (list_id) body.list_id = list_id; else body.url = url; try { const res = await fetch('pull', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `HTTP ${res.status}`); } const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = ''; let lastData = null; while (true) { const { done, value } = await reader.read(); if (done) break; buf += decoder.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop(); for (const line of lines) { if (!line.trim()) continue; const data = JSON.parse(line); if (data.stage === 'error') throw new Error(data.message); if (data.stage === 'complete') lastData = data; const progress = (data.index && data.total) ? ` (${data.index}/${data.total})` : ''; $('pResult').innerHTML = DOMPurify.sanitize(`<p class="muted">${escapeHtml(data.stage)}: ${escapeHtml(data.message)}${progress}</p>`); } } if (buf.trim()) { const data = JSON.parse(buf); if (data.stage === 'error') throw new Error(data.message); if (data.stage === 'complete') lastData = data; } if (lastData) { $('pResult').innerHTML = DOMPurify.sanitize(`<p class="muted">Pulled: ${lastData.added} new, ${lastData.updated} updated, ${lastData.count} total</p>`); toast(t('pulled', { added: lastData.added, updated: lastData.updated }), 'success'); loadCatalog(); loadImportOpts(); } else { $('pResult').innerHTML = '<p class="empty">No public list pulled.</p>'; } } catch (err) { $('pError').textContent = err.message; showError(err.message); $('pResult').innerHTML = '<p class="empty">Pull failed.</p>'; } finally { btn.disabled = false; btn.textContent = oldText; } }

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('tSave').addEventListener('click', saveTemplate); $('tCancel').addEventListener('click', resetAdd); $('catLoad').addEventListener('click', loadCatalog); $('catSearch').addEventListener('input', loadCatalog); $('catOs').addEventListener('change', loadCatalog); $('catArch').addEventListener('change', loadCatalog); $('catSource').addEventListener('change', loadCatalog); $('catSort').addEventListener('change', loadCatalog); $('iImport').addEventListener('click', importTmpl); $('pPull').addEventListener('click', pullPublic); $('pList').addEventListener('change', onPublicListChange); $('mClose').addEventListener('click', () => $('detailModal').classList.remove('active')); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('lxc-template-marketplace', '/api/plugins/lxc-template-marketplace/i18n'); await loadStatus(); await loadClusters(); await loadImportOpts(); await loadPublicLists(); wireEvents(); await loadCatalog(); })();
