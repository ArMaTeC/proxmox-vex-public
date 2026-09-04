/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/netapp-storage/ui.js
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
    if (i18n && i18n.registerNamespaceBulk) i18n.registerNamespaceBulk('netapp_storage', { en: I18N });

    async function api(path, method = 'GET', body = null) {
        const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
        if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        const res = await fetch(path, opts);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    }
    function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function showMessage(text, type) { const m = $('message'); m.innerHTML = DOMPurify.sanitize(`<div class="message ${type}">${escapeHtml(text)}</div>`); setTimeout(() => { m.innerHTML = ''; }, 4000); }

    async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Connected' : 'Error'; } catch (e) { $('status').textContent = 'Error'; $('status').classList.add('error'); } }

    function fmtSize(n) { if (!n) return '—'; return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'; }

    async function loadDashboard() { try { const d = await api('dashboard'); const grid = $('dashboardStats'); grid.innerHTML = DOMPurify.sanitize(`<div class="stat"><div class="value">${escapeHtml(d.volumes)}</div><div class="muted">Volumes</div></div><div class="stat"><div class="value">${escapeHtml(d.snapshots)}</div><div class="muted">Snapshots</div></div><div class="stat"><div class="value">${escapeHtml(d.schedules)}</div><div class="muted">Schedules</div></div><div class="stat"><div class="value">${escapeHtml(d.snapmirrors)}</div><div class="muted">SnapMirror</div></div>`); $('capacityResult').innerHTML = DOMPurify.sanitize(`Total: ${escapeHtml(fmtSize(d.capacity.total))} | Used: ${escapeHtml(fmtSize(d.capacity.used))}`); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadSnapshots() { try { const params = new URLSearchParams(); if ($('snapSearch').value) params.set('q', $('snapSearch').value); if ($('snapVolume').value) params.set('volume', $('snapVolume').value); const d = await api('snapshots?' + params.toString()); if (!d.snapshots.length) { $('snapshotsList').innerHTML = '<p class="empty">No snapshots.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Volume</th><th>Size</th><th>Created</th><th>Actions</th></tr></thead><tbody>'; d.snapshots.forEach(s => { html += `<tr><td>${escapeHtml(s.name)}</td><td class="muted">${escapeHtml(s.volume)}</td><td class="muted">${fmtSize(s.size)}</td><td class="muted">${s.created ? new Date(s.created).toLocaleString() : '—'}</td><td><button class="secondary restoreBtn" data-id="${escapeHtml(s.id)}" data-name="${escapeHtml(s.name)}">Restore</button><button class="secondary cloneBtn" data-id="${escapeHtml(s.id)}">Clone</button><button class="secondary deleteSnap" data-id="${escapeHtml(s.id)}">Delete</button></td></tr>`; }); html += '</tbody></table>'; $('snapshotsList').innerHTML = DOMPurify.sanitize(html); bindSnapshotActions(); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadVolumes() { try { const params = new URLSearchParams(); if ($('volProtected').value) params.set('protected', $('volProtected').value); const d = await api('volumes?' + params.toString()); if (!d.volumes.length) { $('volumesList').innerHTML = '<p class="empty">No volumes.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Aggregate</th><th>Size</th><th>Used</th><th>State</th><th>Protected</th></tr></thead><tbody>'; d.volumes.forEach(v => { html += `<tr><td>${escapeHtml(v.name)}</td><td class="muted">${escapeHtml(v.aggr)}</td><td class="muted">${fmtSize(v.size)}</td><td class="muted">${fmtSize(v.used)}</td><td>${escapeHtml(v.state)}</td><td>${v.protected ? '<span class="badge ok">Yes</span>' : '<span class="badge warn">No</span>'}</td></tr>`; }); html += '</tbody></table>'; $('volumesList').innerHTML = DOMPurify.sanitize(html); populateVolumeSelect(d.volumes); } catch (e) { showMessage(e.message, 'error'); } }

    function populateVolumeSelect(volumes) { const sel = $('snapVolume'); sel.innerHTML = DOMPurify.sanitize('<option value="">All volumes</option>' + volumes.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`).join('')); }

    async function loadSchedules() { try { const d = await api('schedules'); if (!d.schedules.length) { $('schedulesList').innerHTML = '<p class="empty">No schedules.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Volume</th><th>Frequency</th><th>Retention</th><th>Enabled</th><th>Actions</th></tr></thead><tbody>'; d.schedules.forEach(s => { html += `<tr><td>${escapeHtml(s.name)}</td><td class="muted">${escapeHtml(s.volume)}</td><td class="muted">${escapeHtml(s.frequency)}</td><td class="muted">${escapeHtml(s.retention)}</td><td>${s.enabled ? '<span class="badge ok">Yes</span>' : '<span class="badge warn">No</span>'}</td><td><button class="secondary deleteSched" data-id="${escapeHtml(s.id)}">Delete</button></td></tr>`; }); html += '</tbody></table>'; $('schedulesList').innerHTML = DOMPurify.sanitize(html); document.querySelectorAll('.deleteSched').forEach(b => b.addEventListener('click', async (e) => { try { await api('schedules/delete', 'POST', { id: e.target.dataset.id }); showMessage('Deleted', 'success'); loadSchedules(); } catch (err) { showMessage(err.message, 'error'); } })); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadSnapmirrors() { try { const d = await api('snapmirrors'); if (!d.snapmirrors.length) { $('snapmirrorsList').innerHTML = '<p class="empty">No SnapMirror.</p>'; return; } let html = '<table><thead><tr><th>Source</th><th>Destination</th><th>State</th></tr></thead><tbody>'; d.snapmirrors.forEach(s => { html += `<tr><td>${escapeHtml(s.source)}</td><td class="muted">${escapeHtml(s.destination)}</td><td>${escapeHtml(s.state)}</td></tr>`; }); html += '</tbody></table>'; $('snapmirrorsList').innerHTML = DOMPurify.sanitize(html); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadDR() { try { const d = await api('dr_plans'); if (!d.dr_plans.length) { $('drList').innerHTML = '<p class="empty">No plans.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>State</th></tr></thead><tbody>'; d.dr_plans.forEach(p => { html += `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.state)}</td></tr>`; }); html += '</tbody></table>'; $('drList').innerHTML = DOMPurify.sanitize(html); } catch (e) { showMessage(e.message, 'error'); } }

    function bindSnapshotActions() {
        document.querySelectorAll('.restoreBtn').forEach(b => b.addEventListener('click', async (e) => { const target = prompt('Restore target volume:'); if (!target) return; try { await api('snapshots/restore', 'POST', { snapshot_id: e.target.dataset.id, target }); showMessage('Restore started', 'success'); } catch (err) { showMessage(err.message, 'error'); } }));
        document.querySelectorAll('.cloneBtn').forEach(b => b.addEventListener('click', async (e) => { const name = prompt('Clone name:'); if (!name) return; try { await api('snapshots/clone', 'POST', { snapshot_id: e.target.dataset.id, name }); showMessage('Clone started', 'success'); } catch (err) { showMessage(err.message, 'error'); } }));
        document.querySelectorAll('.deleteSnap').forEach(b => b.addEventListener('click', async (e) => { if (!confirm('Delete snapshot?')) return; try { await api('snapshots/delete', 'POST', { id: e.target.dataset.id }); showMessage('Deleted', 'success'); loadSnapshots(); } catch (err) { showMessage(err.message, 'error'); } }));
    }

    $('scheduleForm').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; try { await api('schedules/save', 'POST', { name: f.name.value, volume: f.volume.value, frequency: f.frequency.value, retention: parseInt(f.retention.value), enabled: true }); showMessage('Saved', 'success'); f.reset(); loadSchedules(); } catch (err) { showMessage(err.message, 'error'); } });
    $('smForm').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; try { await api('snapmirrors/create', 'POST', { source: f.source.value, destination: f.destination.value }); showMessage('Created', 'success'); f.reset(); loadSnapmirrors(); } catch (err) { showMessage(err.message, 'error'); } });
    $('snapRefresh').addEventListener('click', loadSnapshots);
    $('volRefresh').addEventListener('click', loadVolumes);
    $('snapSearch').addEventListener('input', loadSnapshots);
    $('snapVolume').addEventListener('change', loadSnapshots);
    $('volProtected').addEventListener('change', loadVolumes);
    $('snapExportCsv').addEventListener('click', async () => { try { const data = await api('export?format=csv'); const blob = new Blob([data], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'snapshots.csv'; a.click(); } catch (e) { showMessage(e.message, 'error'); } });

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
        t.classList.add('active'); $(t.dataset.tab + 'Panel').classList.add('active');
        if (t.dataset.tab === 'dashboard') loadDashboard();
        if (t.dataset.tab === 'snapshots') loadSnapshots();
        if (t.dataset.tab === 'schedules') loadSchedules();
        if (t.dataset.tab === 'volumes') loadVolumes();
        if (t.dataset.tab === 'snapmirrors') loadSnapmirrors();
        if (t.dataset.tab === 'dr') loadDR();
    }));

    (async () => { await loadStatus(); await loadDashboard(); await loadSnapshots(); })();
})();
