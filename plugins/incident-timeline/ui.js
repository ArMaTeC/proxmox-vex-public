/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/incident-timeline/ui.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Ui JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
(function () {
    const qs = new URLSearchParams(window.location.search);
    const theme = qs.get('theme') || 'modern-dark';
    if (theme === 'corp-light') { document.documentElement.setAttribute('data-theme', 'corp-light'); } else { document.documentElement.removeAttribute('data-theme'); }
    const $ = (id) => document.getElementById(id);
    const I18N = {};
    const i18n = window.parent && window.parent.ProxmoxVExI18n;
    if (i18n && i18n.registerNamespaceBulk) i18n.registerNamespaceBulk('incident-timeline', { en: I18N });

    async function api(path, method = 'GET', body = null) {
        const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
        if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        const res = await fetch(path, opts);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    }
    function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function showMessage(text, type) { const m = $('message'); m.innerHTML = '<div class="message ' + type + '"></div>'; if (m.firstElementChild) m.firstElementChild.textContent = text; setTimeout(() => { m.innerHTML = ''; }, 4000); }

    async function loadStatus() {
        try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; }
        catch (e) { $('status').textContent = 'Error'; $('status').classList.add('error'); showMessage(e.message, 'error'); }
    }

    async function loadClusters() {
        try {
            const d = await api('clusters');
            const sel = $('clusterSelect');
            sel.innerHTML = DOMPurify.sanitize(d.clusters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || c.id)}</option>`).join(''));
        } catch (e) { console.error(e); }
    }

    function renderEvents(events, into, withActions = false) {
        if (!events || events.length === 0) { into.innerHTML = '<p class="empty">No events.</p>'; return; }
        let html = '<table><thead><tr><th>Time</th><th>Severity</th><th>ID</th><th>Message</th><th>VMID</th>' + (withActions ? '<th>Actions</th>' : '') + '</tr></thead><tbody>';
        events.forEach(e => {
            html += `<tr><td>${e.timestamp ? new Date(e.timestamp).toLocaleString() : '—'}</td><td>${escapeHtml(e.severity || '-')}</td><td class="muted">${escapeHtml(e.event_id || '-')}</td><td>${escapeHtml(e.message || '-')}</td><td class="muted">${escapeHtml(e.vmid || '-')}</td>`;
            if (withActions) html += `<td><button class="secondary bookmarkFromRow" data-eid="${escapeHtml(e.event_id || '')}">+B</button></td>`;
            html += '</tr>';
        });
        html += '</tbody></table>';
        into.innerHTML = DOMPurify.sanitize(html);
        into.querySelectorAll('.bookmarkFromRow').forEach(b => b.addEventListener('click', () => { document.querySelector('[data-tab="bookmarks"]').click(); $('bookmarkForm').event_id.value = b.dataset.eid; }));
    }

    function renderTimeline(data) {
        const r = $('timelineResult');
        if (!data.events || data.events.length === 0) { r.innerHTML = '<p class="empty">No events for this filter.</p>'; return; }
        r.innerHTML = DOMPurify.sanitize(`<p class="muted">Host: ${escapeHtml(data.host)} | Cluster: ${escapeHtml(data.cluster_id)}${data.vmid ? ' | VMID: ' + escapeHtml(data.vmid) : ''} | Events: ${data.events.length}</p>`);
        const tl = document.createElement('div'); tl.className = 'timeline';
        data.events.forEach(e => {
            const ev = document.createElement('div'); ev.className = 'event';
            ev.innerHTML = DOMPurify.sanitize(`<div class="time">${e.timestamp ? new Date(e.timestamp).toLocaleString() : '—'}</div><div class="desc">${escapeHtml(e.message || '-')}</div>${e.event_id ? `<div class="muted" style="font-size:0.75rem">${escapeHtml(e.event_id)}</div>` : ''}`);
            tl.appendChild(ev);
        });
        r.appendChild(tl);
    }

    async function loadTimeline() {
        const f = $('timelineForm');
        const params = new URLSearchParams();
        params.set('cluster_id', f.cluster_id.value.trim());
        if (f.vmid.value) params.set('vmid', f.vmid.value);
        if (f.severity.value) params.set('severity', f.severity.value);
        if (f.since.value) params.set('since', new Date(f.since.value).toISOString());
        if (f.until.value) params.set('until', new Date(f.until.value).toISOString());
        try { const d = await api('timeline?' + params.toString()); renderTimeline(d); } catch (err) { showMessage(err.message, 'error'); }
    }

    let currentPage = 1;
    async function loadEvents(page = 1) {
        currentPage = page;
        const params = new URLSearchParams();
        params.set('page', page);
        if ($('eventSearch').value) params.set('q', $('eventSearch').value);
        if ($('eventSeverity').value) params.set('severity', $('eventSeverity').value);
        if ($('eventType').value) params.set('event_type', $('eventType').value);
        try {
            const d = await api('events?' + params.toString());
            renderEvents(d.events, $('eventsList'), true);
            const p = $('eventsPagination');
            p.innerHTML = '';
            for (let i = 1; i <= d.pages; i++) {
                const b = document.createElement('button'); b.textContent = i; b.className = i === page ? '' : 'secondary';
                b.addEventListener('click', () => loadEvents(i));
                p.appendChild(b);
            }
        } catch (e) { showMessage(e.message, 'error'); }
    }

    async function loadBookmarks() {
        try {
            const d = await api('bookmarks');
            const b = $('bookmarksList');
            if (!d.bookmarks.length) { b.innerHTML = '<p class="empty">No bookmarks.</p>'; return; }
            let html = '<table><thead><tr><th>Event ID</th><th>Note</th><th>Created</th><th>Actions</th></tr></thead><tbody>';
            d.bookmarks.forEach(bk => {
                html += `<tr><td class="muted">${escapeHtml(bk.event_id)}</td><td>${escapeHtml(bk.note)}</td><td>${bk.created_at ? new Date(bk.created_at).toLocaleString() : '—'}</td><td><button class="deleteBkm secondary" data-id="${escapeHtml(bk.id)}">Delete</button></td></tr>`;
            });
            html += '</tbody></table>';
            b.innerHTML = DOMPurify.sanitize(html);
            b.querySelectorAll('.deleteBkm').forEach(b => b.addEventListener('click', async (ev) => { try { await api('bookmarks/delete', 'POST', { id: ev.target.dataset.id }); showMessage('Deleted', 'success'); loadBookmarks(); } catch (err) { showMessage(err.message, 'error'); } }));
        } catch (e) { showMessage(e.message, 'error'); }
    }

    async function exportData(fmt) {
        try { const data = await api('export?format=' + fmt); const blob = new Blob([data], { type: fmt === 'csv' ? 'text/csv' : 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'incidents.' + fmt; a.click(); showMessage('Downloaded', 'success'); } catch (e) { showMessage(e.message, 'error'); }
    }

    $('timelineForm').addEventListener('submit', (e) => { e.preventDefault(); loadTimeline(); });
    $('refreshTimeline').addEventListener('click', loadTimeline);
    $('applyFilter').addEventListener('click', () => loadEvents(1));
    $('resetFilter').addEventListener('click', () => { $('eventSearch').value = ''; $('eventSeverity').value = ''; $('eventType').value = ''; loadEvents(1); });
    $('exportJson').addEventListener('click', () => exportData('json'));
    $('exportCsv').addEventListener('click', () => exportData('csv'));
    $('bookmarkForm').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; try { await api('bookmark', 'POST', { event_id: f.event_id.value.trim(), note: f.note.value.trim() }); showMessage('Bookmark added', 'success'); f.reset(); loadBookmarks(); } catch (err) { showMessage(err.message, 'error'); } });
    $('loadHeatmap').addEventListener('click', async () => { try { const d = await api('heatmap'); $('heatmapResult').innerHTML = DOMPurify.sanitize('<pre style="white-space:pre-wrap">' + escapeHtml(JSON.stringify(d.heatmap, null, 2)) + '</pre>'); } catch (e) { showMessage(e.message, 'error'); } });

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
        t.classList.add('active'); $(t.dataset.tab + 'Panel').classList.add('active');
        if (t.dataset.tab === 'events') loadEvents(1);
        if (t.dataset.tab === 'bookmarks') loadBookmarks();
    }));

    (async () => { await loadStatus(); await loadClusters(); loadEvents(1); })();
})();
