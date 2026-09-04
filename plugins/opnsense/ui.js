/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/opnsense/ui.js
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
    if (i18n && i18n.registerNamespaceBulk) i18n.registerNamespaceBulk('opnsense', { en: I18N });

    let selectedHost = '';

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

    async function loadHosts() {
        try {
            const d = await api('hosts');
            const sel = $('hostSelect');
            if (!d.hosts.length) {
                sel.innerHTML = '<option disabled selected>No hosts configured</option>';
                $('hostChip').textContent = 'No hosts';
                $('hostChip').className = 'chip error';
                return;
            }
            sel.innerHTML = DOMPurify.sanitize(d.hosts.map(h => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)} (${escapeHtml(h.host)})</option>`).join(''));
            selectedHost = d.hosts[0].id;
            setHostChip(d.hosts[0]);
            loadOverview();
        } catch (e) { showMessage(e.message, 'error'); }
    }

    function setHostChip(h) {
        if (h.healthy) { $('hostChip').textContent = 'Healthy'; $('hostChip').className = 'chip ok'; } else { $('hostChip').textContent = 'Unreachable'; $('hostChip').className = 'chip error'; }
        $('versionChip').textContent = h.version || '—';
        $('versionChip').title = h.role || 'unknown';
    }

    async function loadOverview() { try { const params = new URLSearchParams(); if (selectedHost) params.set('host_id', selectedHost); const d = await api('dashboard?' + params.toString()); $('overviewStats').innerHTML = DOMPurify.sanitize(`<div class="stat"><div class="value">${escapeHtml(d.uptime)}</div><div class="muted">Uptime</div></div><div class="stat"><div class="value">${escapeHtml(d.cpu)}%</div><div class="muted">CPU</div></div><div class="stat"><div class="value">${escapeHtml(d.memory)}%</div><div class="muted">Memory</div></div><div class="stat"><div class="value">${escapeHtml(d.interfaces)}</div><div class="muted">Interfaces</div></div><div class="stat"><div class="value">${escapeHtml(d.vpns)}</div><div class="muted">VPNs</div></div><div class="stat"><div class="value">${escapeHtml(d.dhcp_leases)}</div><div class="muted">DHCP Leases</div></div>`); $('overviewHost').textContent = d.host ? `${escapeHtml(d.host.name)} (${escapeHtml(d.host.host)})` : '—'; } catch (e) { showMessage(e.message, 'error'); } }

    async function loadInterfaces() { try { const params = new URLSearchParams(); if (selectedHost) params.set('host_id', selectedHost); const d = await api('interfaces?' + params.toString()); if (!d.interfaces.length) { $('interfacesList').innerHTML = '<p class="empty">No interfaces.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>IP</th><th>Status</th><th>In</th><th>Out</th></tr></thead><tbody>'; d.interfaces.forEach(i => { html += `<tr><td><a href="#" class="ifLink" data-id="${escapeHtml(i.id)}" data-name="${escapeHtml(i.name)}">${escapeHtml(i.name)}</a></td><td class="muted">${escapeHtml(i.ip)}</td><td>${escapeHtml(i.status)}</td><td class="muted">${escapeHtml(i.in_kbps)} kbps</td><td class="muted">${escapeHtml(i.out_kbps)} kbps</td></tr>`; }); html += '</tbody></table>'; $('interfacesList').innerHTML = DOMPurify.sanitize(html); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadVPNs() { try { const params = new URLSearchParams(); if (selectedHost) params.set('host_id', selectedHost); const d = await api('vpns?' + params.toString()); if (!d.vpns.length) { $('vpnsList').innerHTML = '<p class="empty">No VPNs.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Uptime</th></tr></thead><tbody>'; d.vpns.forEach(v => { html += `<tr><td>${escapeHtml(v.name)}</td><td class="muted">${escapeHtml(v.type)}</td><td>${escapeHtml(v.status)}</td><td class="muted">${escapeHtml(v.uptime)}</td></tr>`; }); html += '</tbody></table>'; $('vpnsList').innerHTML = DOMPurify.sanitize(html); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadNAT() { try { const params = new URLSearchParams(); if (selectedHost) params.set('host_id', selectedHost); if ($('natSearch').value) params.set('q', $('natSearch').value); const d = await api('nat?' + params.toString()); if (!d.nat_rules.length) { $('natList').innerHTML = '<p class="empty">No NAT rules.</p>'; return; } let html = '<table><thead><tr><th>Description</th><th>Source</th><th>Target</th><th>Action</th></tr></thead><tbody>'; d.nat_rules.forEach(n => { html += `<tr><td>${escapeHtml(n.description)}</td><td class="muted">${escapeHtml(n.source)}</td><td class="muted">${escapeHtml(n.target)}</td><td>${escapeHtml(n.action)}</td></tr>`; }); html += '</tbody></table>'; $('natList').innerHTML = DOMPurify.sanitize(html); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadDNS() { try { const params = new URLSearchParams(); if (selectedHost) params.set('host_id', selectedHost); const d = await api('dns?' + params.toString()); if (!d.dns_overrides.length) { $('dnsList').innerHTML = '<p class="empty">No DNS overrides.</p>'; return; } let html = '<table><thead><tr><th>Host</th><th>IP</th></tr></thead><tbody>'; d.dns_overrides.forEach(o => { html += `<tr><td>${escapeHtml(o.host_record)}</td><td class="muted">${escapeHtml(o.ip)}</td></tr>`; }); html += '</tbody></table>'; $('dnsList').innerHTML = DOMPurify.sanitize(html); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadDHCP() { try { const params = new URLSearchParams(); if (selectedHost) params.set('host_id', selectedHost); if ($('leaseActive').value) params.set('active', $('leaseActive').value); const d = await api('dhcp?' + params.toString()); if (!d.leases.length) { $('dhcpList').innerHTML = '<p class="empty">No DHCP leases.</p>'; return; } let html = '<table><thead><tr><th>Client</th><th>IP</th><th>MAC</th><th>Active</th></tr></thead><tbody>'; d.leases.forEach(l => { html += `<tr><td>${escapeHtml(l.client)}</td><td class="muted">${escapeHtml(l.ip)}</td><td class="muted">${escapeHtml(l.mac)}</td><td>${l.active ? '<span class="chip ok">Yes</span>' : '<span class="chip">No</span>'}</td></tr>`; }); html += '</tbody></table>'; $('dhcpList').innerHTML = DOMPurify.sanitize(html); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadWG() { try { const params = new URLSearchParams(); if (selectedHost) params.set('host_id', selectedHost); const d = await api('wg?' + params.toString()); if (!d.peers.length) { $('wgList').innerHTML = '<p class="empty">No peers.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Allowed IPs</th><th>Latest Handshake</th></tr></thead><tbody>'; d.peers.forEach(p => { html += `<tr><td>${escapeHtml(p.name)}</td><td class="muted">${escapeHtml(p.allowed_ips)}</td><td class="muted">${p.latest_handshake ? new Date(p.latest_handshake).toLocaleString() : '—'}</td></tr>`; }); html += '</tbody></table>'; $('wgList').innerHTML = DOMPurify.sanitize(html); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadLogs() { try { const params = new URLSearchParams(); if (selectedHost) params.set('host_id', selectedHost); if ($('logSearch').value) params.set('q', $('logSearch').value); if ($('logSeverity').value) params.set('severity', $('logSeverity').value); const d = await api('logs?' + params.toString()); if (!d.logs.length) { $('logsList').innerHTML = '<p class="empty">No logs.</p>'; return; } let html = '<table><thead><tr><th>Time</th><th>Severity</th><th>Message</th></tr></thead><tbody>'; d.logs.forEach(l => { html += `<tr><td class="muted">${l.timestamp ? new Date(l.timestamp).toLocaleString() : '—'}</td><td>${escapeHtml(l.severity)}</td><td>${escapeHtml(l.message)}</td></tr>`; }); html += '</tbody></table>'; $('logsList').innerHTML = DOMPurify.sanitize(html); } catch (e) { showMessage(e.message, 'error'); } }

    async function loadGateways() { try { const params = new URLSearchParams(); if (selectedHost) params.set('host_id', selectedHost); const d = await api('gateways?' + params.toString()); if (!d.gateways.length) { $('gatewaysList').innerHTML = '<p class="empty">No gateways.</p>'; return; } let html = '<table><thead><tr><th>Name</th><th>Status</th><th>RTT</th></tr></thead><tbody>'; d.gateways.forEach(g => { html += `<tr><td>${escapeHtml(g.name)}</td><td>${escapeHtml(g.status)}</td><td class="muted">${escapeHtml(g.rtt)}</td></tr>`; }); html += '</tbody></table>'; $('gatewaysList').innerHTML = DOMPurify.sanitize(html); } catch (e) { showMessage(e.message, 'error'); } }

    $('hostSelect').addEventListener('change', (e) => { selectedHost = e.target.value; const host = e.target.options[e.target.selectedIndex].text; loadOverview(); });
    $('refreshAll').addEventListener('click', () => { loadOverview(); showMessage('Refreshed', 'success'); });
    $('natSearch').addEventListener('input', loadNAT);
    $('dhcpRefresh').addEventListener('click', loadDHCP);
    $('logSearch').addEventListener('input', loadLogs);
    $('logSeverity').addEventListener('change', loadLogs);
    $('logRefresh').addEventListener('click', loadLogs);
    $('leaseActive').addEventListener('change', loadDHCP);

    $('dnsForm').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; if (!selectedHost) { showMessage('Select a host', 'error'); return; } try { await api('dns/add', 'POST', { host_id: selectedHost, host_record: f.host_record.value, ip: f.ip.value }); showMessage('Added', 'success'); f.reset(); loadDNS(); } catch (err) { showMessage(err.message, 'error'); } });

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
        t.classList.add('active'); $(t.dataset.tab + 'Panel').classList.add('active');
        if (t.dataset.tab === 'overview') loadOverview();
        if (t.dataset.tab === 'network') loadInterfaces();
        if (t.dataset.tab === 'vpn') loadVPNs();
        if (t.dataset.tab === 'nat') loadNAT();
        if (t.dataset.tab === 'dns') loadDNS();
        if (t.dataset.tab === 'dhcp') loadDHCP();
        if (t.dataset.tab === 'wg') loadWG();
        if (t.dataset.tab === 'logs') loadLogs();
        if (t.dataset.tab === 'gateways') loadGateways();
    }));

    (async () => { await loadHosts(); })();
})();
