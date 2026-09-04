/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/ups-monitor/ui.js
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
const t = (k, p) => i18n ? i18n.getT('ups-monitor')(k, p ? { params: p } : undefined) : k;

const state = { readings: {}, devices: [], events: [], last_poll: null };

async function api(path, method = 'GET', body = null) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts); const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data;
}
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

function setLabels() {
    document.title = t('title');
    if ($('pageTitle')) $('pageTitle').textContent = t('title');
    if ($('tab-status')) $('tab-status').textContent = t('status');
    if ($('tab-devices')) $('tab-devices').textContent = t('devices');
    if ($('tab-events')) $('tab-events').textContent = t('events');
    if ($('readingsTitle')) $('readingsTitle').textContent = t('liveReadings');
    if ($('deviceFormTitle')) $('deviceFormTitle').textContent = t('addDevice');
    if ($('devicesTitle')) $('devicesTitle').textContent = t('deviceList');
    if ($('eventsTitle')) $('eventsTitle').textContent = t('eventLog');
    if ($('btnRefresh')) $('btnRefresh').textContent = t('refreshNow');
    if ($('dTest')) $('dTest').textContent = t('testConnection');
    if ($('dSave')) $('dSave').textContent = t('save');
    if ($('dReset')) $('dReset').textContent = t('reset');
}

async function loadStatus() {
    try {
        const s = await api('status'); $('status').textContent = s.status === 'running' ? t('ok') : s.status; $('status').className = `status ${s.critical_count ? 'danger' : (s.low_battery_count ? 'warning' : '')}`; $('metrics').innerHTML = DOMPurify.sanitize(`
    <div class="metric"><div class="value">${escapeHtml(s.device_count)}</div><div class="label">${escapeHtml(t('devices'))}</div></div>
    <div class="metric"><div class="value">${escapeHtml(s.on_battery_count)}</div><div class="label">${escapeHtml(t('onBattery'))}</div></div>
    <div class="metric"><div class="value">${escapeHtml(s.low_battery_count)}</div><div class="label">${escapeHtml(t('lowBattery'))}</div></div>
    <div class="metric"><div class="value">${escapeHtml(s.critical_count)}</div><div class="label">${escapeHtml(t('critical'))}</div></div>
`);
    } catch (e) { $('status').textContent = t('error', { msg: e.message }); }
}

function badgeFor(severity) {
    const cls = severity === 'critical' ? 'danger' : (severity === 'warning' ? 'warning' : 'success');
    const text = severity === 'critical' ? t('critical') : (severity === 'warning' ? t('lowBattery') : t('ok'));
    return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
}

function renderReadings() {
    const c = $('readingsList');
    const values = Object.values(state.readings);
    if (!values.length) { c.innerHTML = `<p class="empty">${escapeHtml(t('noDevices'))}</p>`; return; }
    let html = '';
    values.forEach(r => {
        const st = r.status || {};
        const vars = r.variables || {};
        const items = [
            [t('statusRaw'), st.raw_status || '-'],
            [t('batteryCharge'), vars['battery.charge'] ? `${vars['battery.charge']}%` : '-'],
            [t('runtime'), vars['battery.runtime'] ? `${vars['battery.runtime']} s` : '-'],
            [t('load'), vars['ups.load'] ? `${vars['ups.load']}%` : '-'],
            [t('inputVoltage'), vars['input.voltage'] ? `${vars['input.voltage']} V` : '-'],
            [t('temperature'), vars['ups.temperature'] ? `${vars['ups.temperature']} C` : '-'],
        ];
        const issueHtml = (st.issues || []).map(i => `<div class="muted">${escapeHtml(i)}</div>`).join('');
        const varsHtml = items.map(([k, v]) => `<div class="kv"><span class="k">${escapeHtml(k)}</span><div class="v">${escapeHtml(v)}</div></div>`).join('');
        html += `<div class="ups-card">
            <h3>${escapeHtml(r.device_id)} <span style="float:right;">${badgeFor(st.severity)}</span></h3>
            <div class="ups-grid">${DOMPurify.sanitize(varsHtml)}</div>
            ${st.issues ? DOMPurify.sanitize(issueHtml) : ''}
            <div class="muted" style="font-size:0.75rem;">${escapeHtml(r.polled_at ? new Date(r.polled_at).toLocaleString() : '')}</div>
        </div>`;
    });
    c.innerHTML = DOMPurify.sanitize(html);
}

async function loadReadings() { try { const d = await api('readings'); state.readings = d.readings || {}; state.last_poll = d.last_poll_at; renderReadings(); } catch (e) { showError(e.message); } }
async function doRefresh() { try { const d = await api('refresh', 'POST'); state.readings = d.readings || {}; state.last_poll = d.last_poll_at; renderReadings(); await loadStatus(); toast(t('refreshDone')); } catch (e) { showError(e.message); } }

async function loadDevices() { try { const d = await api('devices'); state.devices = d.devices || []; renderDevices(); } catch (e) { showError(e.message); } }

function renderDevices() {
    const c = $('devicesList');
    if (!state.devices.length) { c.innerHTML = `<p class="empty">${escapeHtml(t('noDevices'))}</p>`; return; }
    let html = `<table><thead><tr><th>${escapeHtml(t('name'))}</th><th>${escapeHtml(t('host'))}</th><th>${escapeHtml(t('upsName'))}</th><th>${escapeHtml(t('actions'))}</th></tr></thead><tbody>`;
    state.devices.forEach(d => {
        html += `<tr>
        <td class="muted">${escapeHtml(d.name)}</td>
        <td class="muted">${escapeHtml(d.host)}:${escapeHtml(d.port)}</td>
        <td class="muted">${escapeHtml(d.ups_name)}</td>
        <td class="actions">
            <button data-edit="${escapeHtml(d.device_id)}">${escapeHtml(t('editDevice'))}</button>
            <button data-delete="${escapeHtml(d.device_id)}" class="secondary">${escapeHtml(t('delete'))}</button>
        </td>
    </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-edit]').forEach(b => b.addEventListener('click', () => editDevice(b.dataset.edit)));
    c.querySelectorAll('button[data-delete]').forEach(b => b.addEventListener('click', () => deleteDevice(b.dataset.delete)));
}

function editDevice(id) { const d = state.devices.find(x => x.device_id === id); if (!d) return; $('deviceFormTitle').textContent = t('editDevice'); $('dOld').value = d.device_id; $('dName').value = d.name || ''; $('dHost').value = d.host || 'localhost'; $('dPort').value = d.port || 3493; $('dUpsName').value = d.ups_name || 'ups'; $('dUsername').value = d.username || ''; $('dPassword').value = d.password || ''; const th = d.thresholds || {}; $('dLowBat').value = th.low_battery_pct ?? 20; $('dLowRun').value = th.low_runtime_minutes ?? 10; $('dMaxLoad').value = th.max_load_pct ?? 90; $('dMaxTemp').value = th.max_temperature_c ?? 45; }

async function deleteDevice(id) { if (!confirm(t('confirmDelete'))) return; try { await api('device_delete', 'DELETE', { device_id: id }); toast(t('deleted'), 'success'); loadDevices(); } catch (e) { showError(e.message); } }

async function testConnection() {
    $('dError').textContent = '';
    const body = { host: $('dHost').value, port: parseInt($('dPort').value), ups_name: $('dUpsName').value, username: $('dUsername').value, password: $('dPassword').value };
    try { const r = await api('test', 'POST', body); if (r.connected) { toast(t('testOk'), 'success'); } else { showError(r.error || t('testFailed')); } } catch (e) { showError(e.message); }
}

async function saveDevice(e) {
    e.preventDefault(); $('dError').textContent = '';
    const body = {
        device_id: $('dOld').value,
        name: $('dName').value.trim(),
        host: $('dHost').value.trim(),
        port: parseInt($('dPort').value),
        ups_name: $('dUpsName').value.trim(),
        username: $('dUsername').value.trim() || undefined,
        password: $('dPassword').value.trim() || undefined,
        thresholds: {
            low_battery_pct: parseFloat($('dLowBat').value),
            low_runtime_minutes: parseFloat($('dLowRun').value),
            max_load_pct: parseFloat($('dMaxLoad').value),
            max_temperature_c: parseFloat($('dMaxTemp').value),
        }
    };
    try { await api('device_save', 'POST', body); toast(t('saved'), 'success'); $('deviceForm').reset(); $('dOld').value = ''; $('deviceFormTitle').textContent = t('addDevice'); loadDevices(); } catch (err) { $('dError').textContent = err.message; showError(err.message); }
}

async function loadEvents() { try { const d = await api('events'); state.events = d.events || []; renderEvents(); } catch (e) { showError(e.message); } }
function renderEvents() {
    const c = $('eventsList');
    if (!state.events.length) { c.innerHTML = `<p class="empty">${escapeHtml(t('noEvents'))}</p>`; return; }
    let html = `<table><thead><tr><th>${escapeHtml(t('time'))}</th><th>${escapeHtml(t('devices'))}</th><th>${escapeHtml(t('type'))}</th><th>${escapeHtml(t('message'))}</th><th>${escapeHtml(t('severity'))}</th></tr></thead><tbody>`;
    state.events.slice().reverse().forEach(ev => {
        html += `<tr>
        <td class="muted">${ev.created_at ? new Date(ev.created_at).toLocaleString() : '-'}</td>
        <td class="muted">${escapeHtml(ev.device_id)}</td>
        <td class="muted">${escapeHtml(ev.type)}</td>
        <td class="muted">${escapeHtml(ev.message)}</td>
        <td class="muted">${badgeFor(ev.severity)}</td>
    </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
}

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }
function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('btnRefresh').addEventListener('click', doRefresh); $('dTest').addEventListener('click', testConnection); $('deviceForm').addEventListener('submit', saveDevice); $('dReset').addEventListener('click', () => { $('deviceForm').reset(); $('dOld').value = ''; $('deviceFormTitle').textContent = t('addDevice'); }); }

(async () => {
    if (i18n) await i18n.loadPluginNamespaceFull('ups-monitor', '/api/plugins/ups-monitor/i18n');
    setLabels();
    wireEvents();
    await loadStatus();
    await loadReadings();
    await loadDevices();
    await loadEvents();
})();
