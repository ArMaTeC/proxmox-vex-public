/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/docker-swarm/ui.js
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
    if (i18n && i18n.registerNamespaceBulk) i18n.registerNamespaceBulk('docker_swarm', { en: I18N });

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

    async function loadDashboard() { try { const d = await api('dashboard'); $('dashboardStats').innerHTML = DOMPurify.sanitize(`<div class="stat"><div class="value">${escapeHtml(d.mode)}</div><div class="muted">Engine</div></div><div class="stat"><div class="value">${escapeHtml(d.nodes)}</div><div class="muted">Nodes</div></div><div class="stat"><div class="value">${escapeHtml(d.services)}</div><div class="muted">Services</div></div><div class="stat"><div class="value">${escapeHtml(d.stacks)}</div><div class="muted">Stacks</div></div><div class="stat"><div class="value">${escapeHtml(d.containers)}</div><div class="muted">Containers</div></div><div class="stat"><div class="value">${escapeHtml(d.images)}</div><div class="muted">Images</div></div>`); $('modeChip').textContent = d.mode; } catch (e) { showMessage(e.message, 'error'); } }

    async function loadNodes() { try { const d = await api('nodes'); if (!d.nodes.length) { $('nodesList').innerHTML = '<p class="empty">No nodes.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>CPU</th><th>Memory</th><th>Actions</th></tr></thead><tbody>'; d.nodes.forEach(n => { html += `<tr><td>${escapeHtml(n.name)}</td><td class="muted">${escapeHtml(n.role)}</td><td>${escapeHtml(n.status)}</td><td class="muted">${escapeHtml(n.cpu)}%</td><td class="muted">${escapeHtml(n.memory)}%</td><td><button class="secondary drainNode" data-id="${escapeHtml(n.id)}">Drain</button></td></tr>`; }); html += '</tbody></table>'; $('nodesList').innerHTML = DOMPurify.sanitize(html); document.querySelectorAll('.drainNode').forEach(b => b.addEventListener('click', async (e) => { try { await api('nodes/drain', 'POST', { id: e.target.dataset.id }); showMessage('Drained', 'success'); loadNodes(); } catch (err) { showMessage(err.message, 'error'); } })); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadServices() { try { const d = await api('services'); if (!d.services.length) { $('servicesList').innerHTML = '<p class="empty">No services.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Image</th><th>Replicas</th><th>Status</th><th>Actions</th></tr></thead><tbody>'; d.services.forEach(s => { html += `<tr><td>${escapeHtml(s.name)}</td><td class="muted">${escapeHtml(s.image)}</td><td>${escapeHtml(s.replicas)}</td><td>${escapeHtml(s.status)}</td><td><input type="number" style="width:60px" value="${escapeHtml(s.replicas)}" class="scaleInput" data-id="${escapeHtml(s.id)}" /><button class="secondary scaleBtn" data-id="${escapeHtml(s.id)}">Scale</button></td></tr>`; }); html += '</tbody></table>'; $('servicesList').innerHTML = DOMPurify.sanitize(html); document.querySelectorAll('.scaleBtn').forEach(b => b.addEventListener('click', async (e) => { const input = document.querySelector(`.scaleInput[data-id="${e.target.dataset.id}"]`); try { await api('services/scale', 'POST', { id: e.target.dataset.id, replicas: parseInt(input.value) }); showMessage('Scaled', 'success'); loadServices(); } catch (err) { showMessage(err.message, 'error'); } })); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadStacks() { try { const d = await api('stacks'); if (!d.stacks.length) { $('stacksList').innerHTML = '<p class="empty">No stacks.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Services</th><th>Status</th><th>Actions</th></tr></thead><tbody>'; d.stacks.forEach(s => { html += `<tr><td>${escapeHtml(s.name)}</td><td class="muted">${(s.services || []).map(escapeHtml).join(', ')}</td><td>${escapeHtml(s.status)}</td><td><button class="secondary deleteStack" data-id="${escapeHtml(s.id)}">Delete</button></td></tr>`; }); html += '</tbody></table>'; $('stacksList').innerHTML = DOMPurify.sanitize(html); document.querySelectorAll('.deleteStack').forEach(b => b.addEventListener('click', async (e) => { if (!confirm('Delete stack?')) return; try { await api('stacks/delete', 'POST', { id: e.target.dataset.id }); showMessage('Deleted', 'success'); loadStacks(); } catch (err) { showMessage(err.message, 'error'); } })); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadContainers() { try { const d = await api('containers'); if (!d.containers.length) { $('containersList').innerHTML = '<p class="empty">No containers.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Image</th><th>Node</th><th>Status</th><th>Actions</th></tr></thead><tbody>'; d.containers.forEach(c => { html += `<tr><td>${escapeHtml(c.name)}</td><td class="muted">${escapeHtml(c.image)}</td><td class="muted">${escapeHtml(c.node)}</td><td>${escapeHtml(c.status)}</td><td><button class="secondary actContainer" data-id="${escapeHtml(c.id)}" data-action="stop">Stop</button><button class="secondary actContainer" data-id="${escapeHtml(c.id)}" data-action="delete">Delete</button></td></tr>`; }); html += '</tbody></table>'; $('containersList').innerHTML = DOMPurify.sanitize(html); document.querySelectorAll('.actContainer').forEach(b => b.addEventListener('click', async (e) => { try { await api('containers/action', 'POST', { id: e.target.dataset.id, action: e.target.dataset.action }); showMessage(e.target.dataset.action, 'success'); loadContainers(); } catch (err) { showMessage(err.message, 'error'); } })); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadNetworks() { try { const d = await api('networks'); if (!d.networks.length) { $('networksList').innerHTML = '<p class="empty">No networks.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Driver</th><th>Scope</th></tr></thead><tbody>'; d.networks.forEach(n => { html += `<tr><td>${escapeHtml(n.name)}</td><td class="muted">${escapeHtml(n.driver)}</td><td>${escapeHtml(n.scope)}</td></tr>`; }); html += '</tbody></table>'; $('networksList').innerHTML = DOMPurify.sanitize(html); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadVolumes() { try { const d = await api('volumes'); if (!d.volumes.length) { $('volumesList').innerHTML = '<p class="empty">No volumes.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Driver</th><th>Size</th></tr></thead><tbody>'; d.volumes.forEach(v => { html += `<tr><td>${escapeHtml(v.name)}</td><td class="muted">${escapeHtml(v.driver)}</td><td>${escapeHtml(v.size)}</td></tr>`; }); html += '</tbody></table>'; $('volumesList').innerHTML = DOMPurify.sanitize(html); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadImages() { try { const d = await api('images'); if (!d.images.length) { $('imagesList').innerHTML = '<p class="empty">No images.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Tags</th><th>Size</th><th>Actions</th></tr></thead><tbody>'; d.images.forEach(i => { html += `<tr><td>${escapeHtml(i.name)}</td><td class="muted">${(i.tags || []).map(escapeHtml).join(', ')}</td><td>${escapeHtml(i.size)}</td><td><button class="secondary rmImage" data-id="${escapeHtml(i.id)}">Remove</button></td></tr>`; }); html += '</tbody></table>'; $('imagesList').innerHTML = DOMPurify.sanitize(html); document.querySelectorAll('.rmImage').forEach(b => b.addEventListener('click', async (e) => { try { await api('images/remove', 'POST', { id: e.target.dataset.id }); showMessage('Removed', 'success'); loadImages(); } catch (err) { showMessage(err.message, 'error'); } })); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadPrune() { try { const d = await api('prune_policy'); $('pruneResult').textContent = `Auto prune: ${d.prune_policy.enabled ? 'On' : 'Off'} | Threshold: ${d.prune_policy.threshold}% | Interval: ${d.prune_policy.interval}s | Targets: ${(d.prune_policy.targets || []).join(', ')}`; } catch (e) { showMessage(e.message, 'error'); } }

    $('refreshAll').addEventListener('click', () => { loadDashboard(); showMessage('Refreshed', 'success'); });
    $('runPrune').addEventListener('click', async () => { try { const d = await api('prune', 'POST'); $('pruneResult').textContent = `Freed: ${JSON.stringify(d.freed)}`; showMessage('Prune started', 'success'); } catch (e) { showMessage(e.message, 'error'); } });
    $('pruneForm').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; try { await api('prune_policy/save', 'POST', { enabled: f.enabled.checked, threshold: parseInt(f.threshold.value), interval: parseInt(f.interval.value), targets: f.targets.value.split(',').map(x => x.trim()) }); showMessage('Saved', 'success'); loadPrune(); } catch (err) { showMessage(err.message, 'error'); } });

    $('stackForm').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; try { await api('stacks/deploy', 'POST', { name: f.name.value, compose: f.compose.value }); showMessage('Deployed', 'success'); f.reset(); loadStacks(); } catch (err) { showMessage(err.message, 'error'); } });

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
        t.classList.add('active'); $(t.dataset.tab + 'Panel').classList.add('active');
        if (t.dataset.tab === 'dashboard') loadDashboard();
        if (t.dataset.tab === 'nodes') loadNodes();
        if (t.dataset.tab === 'services') loadServices();
        if (t.dataset.tab === 'stacks') loadStacks();
        if (t.dataset.tab === 'containers') loadContainers();
        if (t.dataset.tab === 'networks') loadNetworks();
        if (t.dataset.tab === 'volumes') loadVolumes();
        if (t.dataset.tab === 'images') loadImages();
        if (t.dataset.tab === 'cleanup') loadPrune();
    }));

    (async () => { await loadDashboard(); })();
})();
