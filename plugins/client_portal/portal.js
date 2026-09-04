/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/client_portal/portal.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Portal JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
const params = new URLSearchParams(window.location.search);
document.body.dataset.theme = params.get('theme') || 'modern-dark';

const API = window.location.origin + '/api/plugins/client_portal/api';
let cfg = {};
let vms = [];

const i18n = window.parent && window.parent.ProxmoxVExI18n;
const t = (k, p) => i18n ? i18n.getT('client_portal')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('client_portal', '/api/plugins/client_portal/i18n');

async function api(url, opts = {}) {
    const res = await fetch(url, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        ...opts
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
}

function allowed(action) {
    return (cfg.allowed_actions || []).includes(action);
}

async function load() {
    try {
        cfg = (await api(API + '/config'));
        const data = await api(API + '/my-vms');
        if (data.redirect) {
            document.getElementById('app').innerHTML =
                '<div class="info">Client portal is intended for client users. Please log out and use the main dashboard.</div>';
            return;
        }
        vms = data.vms || [];
        document.getElementById('user').textContent = t('loggedInAs', { user: data.user || t('unknown') });
        document.getElementById('title').textContent = cfg.portal_title || t('title');
        render();
    } catch (e) {
        document.getElementById('error').textContent = t('error', { msg: e.message });
    }
}

function render() {
    const app = document.getElementById('app');
    if (!vms.length) {
        app.innerHTML = '<div class="info">' + t('noAssignedVms') + '</div>';
        return;
    }
    app.innerHTML = DOMPurify.sanitize('<div class="grid">' + vms.map(vm => {
        const ips = (vm.ips || []).join(', ');
        const statusClass = 'status ' + (vm.status === 'running' ? 'running' : 'stopped');
        const usage = cfg.show_resource_usage
            ? `${t('cpu')}: ${escapeHtml(vm.cpu_percent || 0)}% · ${t('ram')}: ${escapeHtml(vm.mem_percent || 0)}%`
            : '';
        return `<div class="card" data-vmid="${escapeHtml(vm.vmid)}">
                    <div class="title">${escapeHtml(vm.name)} <span class="meta">(VMID ${escapeHtml(vm.vmid)})</span></div>
                    <div class="meta">${escapeHtml(vm.cluster_name)} · ${escapeHtml(vm.node)}</div>
                    <div class="${statusClass}">${escapeHtml(vm.status)}</div>
                    <div class="meta">${usage}</div>
                    ${ips ? '<div class="meta">' + t('ip') + ': ' + escapeHtml(ips) + '</div>' : ''}
                    <div class="actions">
                        ${allowed('vm.start') ? `<button data-action="start" data-cluster="${escapeHtml(vm.cluster_id)}" data-vmid="${escapeHtml(vm.vmid)}">${t('start')}</button>` : ''}
                        ${allowed('vm.stop') ? `<button class="secondary" data-action="stop" data-cluster="${escapeHtml(vm.cluster_id)}" data-vmid="${escapeHtml(vm.vmid)}">${t('stop')}</button>` : ''}
                        ${allowed('vm.start') ? `<button class="secondary" data-action="reboot" data-cluster="${escapeHtml(vm.cluster_id)}" data-vmid="${escapeHtml(vm.vmid)}">${t('reboot')}</button>` : ''}
                        ${allowed('vm.console') ? `<button class="secondary" data-action="console" data-cluster="${escapeHtml(vm.cluster_id)}" data-vmid="${escapeHtml(vm.vmid)}">${t('console')}</button>` : ''}
                    </div>
                </div>`;
    }).join('') + '</div>');
    wireButtons();
}

function wireButtons() {
    app.querySelectorAll('button[data-action]').forEach(btn => {
        btn.addEventListener('click', function (e) {
            const clusterId = e.currentTarget.dataset.cluster;
            const vmid = parseInt(e.currentTarget.dataset.vmid, 10);
            const action = e.currentTarget.dataset.action;
            if (action === 'console') openConsole(clusterId, vmid);
            else power(clusterId, vmid, action);
        });
    });
}

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

async function power(clusterId, vmid, action) {
    try {
        await api(API + '/vm/power', {
            method: 'POST',
            body: JSON.stringify({ cluster_id: clusterId, vmid: vmid, action })
        });
        await load();
    } catch (e) {
        document.getElementById('error').textContent = t('error', { msg: e.message });
    }
}

function isAllowedUrl(u) {
    try {
        const parsed = new URL(u, window.location.href);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

async function openConsole(clusterId, vmid) {
    try {
        const data = await api(API + '/vm/console', {
            method: 'POST',
            body: JSON.stringify({ cluster_id: clusterId, vmid })
        });
        const consoleUrl = data.console_url || data.url;
        if (consoleUrl && isAllowedUrl(consoleUrl)) {
            window.open(consoleUrl, '_blank', 'noopener,noreferrer');
        } else if (consoleUrl) {
            document.getElementById('error').textContent = t('consoleRejected');
        } else {
            document.getElementById('error').textContent = t('consoleNotAvailable');
        }
    } catch (e) {
        document.getElementById('error').textContent = t('error', { msg: e.message });
    }
}

(async () => {
    if (i18n) await i18n.loadPluginNamespaceFull('client_portal', '/api/plugins/client_portal/i18n');
    await load();
    setInterval(load, (cfg.refresh_interval || 30) * 1000);
})();
