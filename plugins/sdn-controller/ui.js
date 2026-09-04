/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/sdn-controller/ui.js
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
if (theme === 'corp-light') {
    document.documentElement.setAttribute('data-theme', 'corp-light');
} else {
    document.documentElement.removeAttribute('data-theme');
}

const $ = (id) => document.getElementById(id);

const i18n = window.parent && window.parent.ProxmoxVExI18n;
const t = (k, p) => i18n ? i18n.getT('sdn-controller')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('sdn-controller', '/api/plugins/sdn-controller/i18n');

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function showMessage(text, type) {
    const m = $('message');
    m.innerHTML = DOMPurify.sanitize(`<div class="message ${type}">${escapeHtml(text)}</div>`);
    setTimeout(() => { m.innerHTML = ''; }, 4000);
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

async function loadStatus() {
    try {
        const s = await api('status');
        $('status').textContent = s.status === 'running' ? 'Running' : s.status;
        $('statusValue').textContent = s.status;
        $('zoneCount').textContent = s.zones_count || 0;
        $('vnetCount').textContent = s.vnets_count || 0;
    } catch (e) {
        $('status').textContent = 'Error';
        $('status').classList.add('error');
        showMessage(t('error', { msg: e.message }), 'error');
    }
}

async function loadZones() {
    try {
        const { data } = await api('zones');
        const list = $('zonesList');
        const select = $('zoneSelect');
        if (!data || data.length === 0) {
            list.innerHTML = '<p class="empty">' + t('noZones') + '</p>';
            select.innerHTML = '<option value="">' + t('noVnetOptions') + '</option>';
            return;
        }
        select.innerHTML = DOMPurify.sanitize(data.map(z => `<option value="${escapeHtml(z.id)}">${escapeHtml(z.name)} (${escapeHtml(z.type)})</option>`).join(''));

        let html = '<table><thead><tr><th>Name</th><th>Type</th><th>VNets</th><th></th></tr></thead><tbody>';
        data.forEach(z => {
            html += `<tr data-id="${escapeHtml(z.id)}">
                        <td>${escapeHtml(z.name)}</td>
                        <td><span class="badge">${escapeHtml(z.type)}</span></td>
                        <td class="muted">${(z.vnets || []).length}</td>
                        <td class="actions"><button data-action="delete" class="secondary">${t('delete')}</button></td>
                    </tr>`;
        });
        html += '</tbody></table>';
        list.innerHTML = DOMPurify.sanitize(html);

        list.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.closest('tr').getAttribute('data-id');
                try {
                    await api(`zones?id=${encodeURIComponent(id)}`, 'DELETE');
                    showMessage(t('zoneDeleted'), 'success');
                    await loadZones();
                    await loadVnets();
                    await loadStatus();
                } catch (err) { showMessage(t('error', { msg: err.message }), 'error'); }
            });
        });
    } catch (e) { showMessage(t('error', { msg: e.message }), 'error'); }
}

async function loadVnets() {
    try {
        const { data } = await api('vnets');
        const list = $('vnetsList');
        if (!data || data.length === 0) {
            list.innerHTML = '<p class="empty">' + t('noVnets') + '</p>';
            return;
        }
        let html = '<table><thead><tr><th>Zone</th><th>Name</th><th>Tag</th><th>Subnet</th><th></th></tr></thead><tbody>';
        data.forEach(v => {
            html += `<tr data-id="${escapeHtml(v.id)}">
                        <td class="muted">${escapeHtml(v.zone_id)}</td>
                        <td>${escapeHtml(v.name)}</td>
                        <td class="muted">${escapeHtml(v.tag)}</td>
                        <td class="muted">${escapeHtml(v.subnet || '-')}</td>
                        <td class="actions"><button data-action="delete" class="secondary">${t('delete')}</button></td>
                    </tr>`;
        });
        html += '</tbody></table>';
        list.innerHTML = DOMPurify.sanitize(html);

        list.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.closest('tr').getAttribute('data-id');
                try {
                    await api(`vnets?id=${encodeURIComponent(id)}`, 'DELETE');
                    showMessage(t('vnetDeleted'), 'success');
                    await loadVnets();
                    await loadStatus();
                } catch (err) { showMessage(t('error', { msg: err.message }), 'error'); }
            });
        });
    } catch (e) { showMessage(t('error', { msg: e.message }), 'error'); }
}

$('applyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const clusterId = e.target.cluster_id.value.trim();
    try {
        const data = await api('apply', 'POST', { cluster_id: clusterId });
        $('applyResult').innerHTML = DOMPurify.sanitize(`<p class="muted">${escapeHtml(t('appliedResult', { count: data.zones_pushed, node: data.cluster_node }))}</p>`);
    } catch (err) { showMessage(t('error', { msg: err.message }), 'error'); }
});

$('zoneForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
        await api('zones', 'POST', { name: f.name.value.trim(), type: f.type.value });
        showMessage(t('zoneAdded'), 'success');
        f.reset();
        f.type.value = 'evpn';
        await loadZones();
        await loadVnets();
        await loadStatus();
    } catch (err) { showMessage(t('error', { msg: err.message }), 'error'); }
});

$('vnetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
        await api('vnets', 'POST', {
            zone_id: f.zone_id.value,
            name: f.name.value.trim(),
            tag: parseInt(f.tag.value),
            subnet: f.subnet.value.trim()
        });
        showMessage(t('vnetAdded'), 'success');
        f.reset();
        await loadVnets();
        await loadStatus();
    } catch (err) { showMessage(t('error', { msg: err.message }), 'error'); }
});

(async () => {
    if (i18n) await i18n.loadPluginNamespaceFull('sdn-controller', '/api/plugins/sdn-controller/i18n');
    await loadStatus();
    await loadZones();
    await loadVnets();
})();
