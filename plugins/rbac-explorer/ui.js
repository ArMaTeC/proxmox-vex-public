/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/rbac-explorer/ui.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Ui JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
const base = '/api/plugins/rbac-explorer';
const $ = (id) => document.getElementById(id);

const i18n = window.parent && window.parent.ProxmoxVExI18n;
const t = (k, p) => i18n ? i18n.getT('rbac-explorer')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('rbac-explorer', '/api/plugins/rbac-explorer/i18n');

function toast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `message ${type}`;
    el.textContent = message;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

async function fetchJson(path, options = {}) {
    try {
        const res = await fetch(`${base}/${path}`, options);
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
    } catch (err) {
        toast(`Error: ${err.message}`, 'error');
        throw err;
    }
}

async function loadStatus() {
    const data = await fetchJson('status');
    $('status').textContent = `${data.status} | ${data.roles_count} roles`;
}

function esc(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : text;
    return div.innerHTML;
}

async function loadRoles() {
    const data = await fetchJson('roles');
    const tbody = $('rolesTable').querySelector('tbody');
    tbody.innerHTML = '';
    for (const role of data.roles || []) {
        const tr = document.createElement('tr');
        tr.innerHTML = DOMPurify.sanitize(`
                    <td>${esc(role.id)}</td>
                    <td>${esc(role.name)}</td>
                    <td>${esc((role.permissions || []).join(', '))}</td>
                    <td><button class="danger" data-id="${esc(role.id)}">${t('delete')}</button></td>
                `);
        tbody.appendChild(tr);
    }
    tbody.querySelectorAll('button.danger').forEach((btn) => {
        btn.addEventListener('click', () => deleteRole(btn.dataset.id));
    });
}

async function createRole() {
    const id = $('roleId').value.trim();
    const name = $('roleName').value.trim();
    const perms = $('rolePerms').value.split(',').map((s) => s.trim()).filter(Boolean);
    if (!id || !name) {
        toast(t('idAndNameRequired'), 'error');
        return;
    }
    const body = JSON.stringify({ id, name, permissions: perms });
    await fetchJson('create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    toast(t('roleCreated'));
    $('roleId').value = '';
    $('roleName').value = '';
    $('rolePerms').value = '';
    loadStatus();
    loadRoles();
}

async function deleteRole(id) {
    if (!confirm(t('deleteRoleConfirm', { id }))) return;
    const body = JSON.stringify({ id });
    await fetchJson('delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    toast(t('roleDeleted'));
    loadStatus();
    loadRoles();
}

$('createRole').addEventListener('click', createRole);
(async () => {
    if (i18n) await i18n.loadPluginNamespaceFull('rbac-explorer', '/api/plugins/rbac-explorer/i18n');
    loadStatus();
    loadRoles();
})();
