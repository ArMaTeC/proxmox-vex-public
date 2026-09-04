/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/truenas/ui.js
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
    if (i18n && i18n.registerNamespaceBulk) i18n.registerNamespaceBulk('truenas', { en: I18N });

    let selectedInstance = '';

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

    async function loadInstances() {
        try {
            const d = await api('instances');
            const sel = $('instanceSelect');
            if (!d.instances.length) {
                sel.innerHTML = '<option disabled selected>No instances configured</option>';
                $('connChip').textContent = 'No instances';
                $('connChip').classList.add('error');
                return;
            }
            sel.innerHTML = DOMPurify.sanitize(d.instances.map(i => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.name)}</option>`).join(''));
            selectedInstance = d.instances[0].id;
            setInstanceChip(d.instances[0]);
            loadOverview();
        } catch (e) { showMessage(e.message, 'error'); }
    }

    function setInstanceChip(inst) {
        const chip = $('connChip');
        if (inst.healthy) { chip.textContent = 'Healthy'; chip.className = 'chip'; } else { chip.textContent = 'Unreachable'; chip.className = 'chip error'; }
    }

    async function loadOverview() { try { const params = new URLSearchParams(); if (selectedInstance) params.set('instance_id', selectedInstance); const d = await api('dashboard?' + params.toString()); $('overviewStats').innerHTML = DOMPurify.sanitize(`<div class="stat"><div class="value">${escapeHtml(d.instances)}</div><div class="muted">Instances</div></div><div class="stat"><div class="value">${escapeHtml(d.pools)}</div><div class="muted">Pools</div></div><div class="stat"><div class="value">${escapeHtml(d.datasets)}</div><div class="muted">Datasets</div></div><div class="stat"><div class="value">${escapeHtml(d.shares)}</div><div class="muted">Shares</div></div>`); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadPools() { try { const params = new URLSearchParams(); if (selectedInstance) params.set('instance_id', selectedInstance); const d = await api('pools?' + params.toString()); if (!d.pools.length) { $('poolsList').innerHTML = '<p class="empty">No pools.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>State</th><th>Usage</th><th>Disks</th></tr></thead><tbody>'; d.pools.forEach(p => { html += `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.state)}</td><td class="muted">${escapeHtml(p.usage)}%</td><td class="muted">${(p.disks || []).map(d => escapeHtml(d.name)).join(', ')}</td></tr>`; }); html += '</tbody></table>'; $('poolsList').innerHTML = DOMPurify.sanitize(html); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadDatasets() { try { const params = new URLSearchParams(); if (selectedInstance) params.set('instance_id', selectedInstance); if ($('datasetSearch').value) params.set('q', $('datasetSearch').value); const d = await api('datasets?' + params.toString()); if (!d.datasets.length) { $('datasetsList').innerHTML = '<p class="empty">No datasets.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Used</th><th>Available</th><th>Actions</th></tr></thead><tbody>'; d.datasets.forEach(ds => { html += `<tr><td>${escapeHtml(ds.name)}</td><td class="muted">${escapeHtml(ds.used)}</td><td class="muted">${escapeHtml(ds.available)}</td><td><button class="secondary deleteDs" data-id="${escapeHtml(ds.id)}" data-name="${escapeHtml(ds.name)}">Delete</button></td></tr>`; }); html += '</tbody></table>'; $('datasetsList').innerHTML = DOMPurify.sanitize(html); document.querySelectorAll('.deleteDs').forEach(b => b.addEventListener('click', async (e) => { const name = prompt(`Type dataset name to confirm:`); if (!name) return; try { await api('datasets/delete', 'POST', { id: e.target.dataset.id, confirm: name }); showMessage('Deleted', 'success'); loadDatasets(); } catch (err) { showMessage(err.message, 'error'); } })); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadSnapshots() { try { const params = new URLSearchParams(); if (selectedInstance) params.set('instance_id', selectedInstance); if ($('snapshotSearch').value) params.set('q', $('snapshotSearch').value); const d = await api('snapshots?' + params.toString()); if (!d.snapshots.length) { $('snapshotsList').innerHTML = '<p class="empty">No snapshots.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Dataset</th><th>Created</th><th>Actions</th></tr></thead><tbody>'; d.snapshots.forEach(s => { html += `<tr><td>${escapeHtml(s.name)}</td><td class="muted">${escapeHtml(s.dataset)}</td><td class="muted">${s.created ? new Date(s.created).toLocaleString() : '—'}</td><td><button class="secondary deleteSnap" data-id="${escapeHtml(s.id)}">Delete</button></td></tr>`; }); html += '</tbody></table>'; $('snapshotsList').innerHTML = DOMPurify.sanitize(html); document.querySelectorAll('.deleteSnap').forEach(b => b.addEventListener('click', async (e) => { try { await api('snapshots/delete', 'POST', { id: e.target.dataset.id }); showMessage('Deleted', 'success'); loadSnapshots(); } catch (err) { showMessage(err.message, 'error'); } })); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadShares() { try { const params = new URLSearchParams(); if (selectedInstance) params.set('instance_id', selectedInstance); const d = await api('shares?' + params.toString()); if (!d.shares.length) { $('sharesList').innerHTML = '<p class="empty">No shares.</p>'; return; } let html = '<table><thead><tr><th>Type</th><th>Name</th><th>Path</th></tr></thead><tbody>'; d.shares.forEach(s => { html += `<tr><td>${escapeHtml(s.type)}</td><td>${escapeHtml(s.name)}</td><td class="muted">${escapeHtml(s.path)}</td></tr>`; }); html += '</tbody></table>'; $('sharesList').innerHTML = DOMPurify.sanitize(html); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadReplications() { try { const params = new URLSearchParams(); if (selectedInstance) params.set('instance_id', selectedInstance); const d = await api('replications?' + params.toString()); if (!d.replications.length) { $('replicationsList').innerHTML = '<p class="empty">No replication tasks.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>State</th></tr></thead><tbody>'; d.replications.forEach(r => { html += `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.state)}</td></tr>`; }); html += '</tbody></table>'; $('replicationsList').innerHTML = DOMPurify.sanitize(html); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadServices() { try { const params = new URLSearchParams(); if (selectedInstance) params.set('instance_id', selectedInstance); const d = await api('services?' + params.toString()); if (!d.services.length) { $('servicesList').innerHTML = '<p class="empty">No services.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Running</th><th>Actions</th></tr></thead><tbody>'; d.services.forEach(s => { html += `<tr><td>${escapeHtml(s.name)}</td><td>${s.running ? '<span class="chip">Yes</span>' : '<span class="chip error">No</span>'}</td><td><button class="secondary toggleSvc" data-id="${escapeHtml(s.id)}" data-run="${escapeHtml(!s.running)}">${s.running ? 'Stop' : 'Start'}</button></td></tr>`; }); html += '</tbody></table>'; $('servicesList').innerHTML = DOMPurify.sanitize(html); document.querySelectorAll('.toggleSvc').forEach(b => b.addEventListener('click', async (e) => { try { await api('services/set', 'POST', { id: e.target.dataset.id, running: e.target.dataset.run === 'true' }); showMessage('Updated', 'success'); loadServices(); } catch (err) { showMessage(err.message, 'error'); } })); } catch (e) { showMessage(e.message, 'error'); } }

    $('instanceSelect').addEventListener('change', (e) => { selectedInstance = e.target.value; loadOverview(); });

    $('datasetForm').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; if (!selectedInstance) { showMessage('Select an instance', 'error'); return; } try { await api('datasets/add', 'POST', { instance_id: selectedInstance, name: f.name.value }); showMessage('Added', 'success'); f.reset(); loadDatasets(); } catch (err) { showMessage(err.message, 'error'); } });

    $('snapshotForm').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; if (!selectedInstance) { showMessage('Select an instance', 'error'); return; } try { await api('snapshots/add', 'POST', { instance_id: selectedInstance, dataset: f.dataset.value, name: f.name.value, recursive: f.recursive.checked }); showMessage('Added', 'success'); f.reset(); loadSnapshots(); } catch (err) { showMessage(err.message, 'error'); } });

    $('shareForm').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; if (!selectedInstance) { showMessage('Select an instance', 'error'); return; } try { await api('shares/add', 'POST', { instance_id: selectedInstance, type: f.type.value, name: f.name.value, path: f.path.value }); showMessage('Added', 'success'); f.reset(); loadShares(); } catch (err) { showMessage(err.message, 'error'); } });

    $('datasetSearch').addEventListener('input', loadDatasets);
    $('snapshotSearch').addEventListener('input', loadSnapshots);

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
        t.classList.add('active'); $(t.dataset.tab + 'Panel').classList.add('active');
        if (t.dataset.tab === 'overview') loadOverview();
        if (t.dataset.tab === 'pools') loadPools();
        if (t.dataset.tab === 'datasets') loadDatasets();
        if (t.dataset.tab === 'snapshots') loadSnapshots();
        if (t.dataset.tab === 'shares') loadShares();
        if (t.dataset.tab === 'replication') loadReplications();
        if (t.dataset.tab === 'services') loadServices();
    }));

    (async () => { await loadInstances(); })();
})();
