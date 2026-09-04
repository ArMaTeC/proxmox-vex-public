/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/rolling-update-orchestrator/ui.js
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
const t = (k, p) => i18n ? i18n.getT('rolling-update-orchestrator')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('rolling-update-orchestrator', '/api/plugins/rolling-update-orchestrator/i18n');

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function loadStatus() { try { const s = await api('status'); $('sOrc').textContent = s.orchestrator_status; $('sCount').textContent = s.plans_count; $('status').textContent = 'Ready'; } catch (e) { $('status').textContent = 'Error'; } }

async function loadClusters() { try { const d = await api('clusters'); const opts = (d.clusters || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join(''); $('cCluster').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }

let lastPlans = [];
let openDetailId = null;
let pollHandle = null;
let feeds = {};

function hasRunningPlan() { return lastPlans.some(p => p.status === 'running'); }
function startPolling() { if (pollHandle) return; pollHandle = setInterval(() => { loadStatus(); if (document.querySelector('.tab[aria-selected="true"]')?.dataset.tab === 'plans') loadPlans(); }, 2000); }
function stopPolling() { if (pollHandle) { clearInterval(pollHandle); pollHandle = null; } }
function closePlanFeed(planId) { const es = feeds[planId]; if (es) { es.close(); delete feeds[planId]; } }
function openPlanFeed(planId) {
    if (feeds[planId]) return;
    const es = new EventSource('/api/plugins/rolling-update-orchestrator/api/feed?plan_id=' + encodeURIComponent(planId), { withCredentials: true });
    feeds[planId] = es;
    es.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'plan') {
                const idx = lastPlans.findIndex(p => p.plan_id === planId);
                if (idx >= 0) { lastPlans[idx] = msg.plan; } else { lastPlans.push(msg.plan); }
                renderPlans(lastPlans);
            }
        } catch (err) { console.error('feed parse error', err); }
    };
    es.onerror = () => { closePlanFeed(planId); };
}

async function loadPlans() { const status = $('pStatus').value, search = $('pSearch').value.trim().toLowerCase(); const params = new URLSearchParams(); if (status) params.set('status', status); if (search) params.set('q', search); try { const d = await api('plans?' + params.toString()); lastPlans = d.plans || []; renderPlans(lastPlans); } catch (err) { showError(err.message); } }

function vmLabel(vm) { if (!vm) return '-'; return `${vm.name || 'VM'} (ID ${vm.vmid}${vm.node ? ', ' + vm.node : ''})`; }

function renderPlans(plans) {
    const c = $('pList');
    if (!plans.length) { c.innerHTML = DOMPurify.sanitize('<p class="empty">No plans found.</p>'); openDetailId = null; stopPolling(); return; }
    let html = '<table><thead><tr><th data-sort="plan_id">Plan ID</th><th data-sort="cluster_id">Cluster</th><th data-sort="host">Host</th><th data-sort="status">Status</th><th>Live</th><th data-sort="created_at">Created</th><th>Actions</th></tr></thead><tbody>';
    plans.forEach(p => {
        const disabled = (p.status === 'running' || p.status === 'completed' || p.status === 'aborted');
        const live = p.status === 'running' ? `<span class="live"></span> ${escapeHtml(p.current_step || '')}<br><span class="muted">${escapeHtml(vmLabel(p.current_vm))}</span>` : '';
        html += `<tr data-id="${escapeHtml(p.plan_id)}"><td class="muted">${escapeHtml(p.plan_id)}</td><td class="muted">${escapeHtml(p.cluster_id)}</td><td class="muted">${escapeHtml(p.host)}</td><td class="muted">${escapeHtml(p.status)}</td><td>${live}</td><td class="muted">${escapeHtml(p.created_at)}</td><td class="actions"><button class="viewBtn secondary">View</button><button class="startBtn" ${disabled ? 'disabled' : ''}>Start</button><button class="abortBtn danger" ${p.status === 'aborted' ? 'disabled' : ''}>Abort</button></td></tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const sorted = [...plans].sort((a, b) => { const av = (a[th.dataset.sort] || '').toString(), bv = (b[th.dataset.sort] || '').toString(); return av.localeCompare(bv); }); renderPlans(sorted); }));
    c.querySelectorAll('.viewBtn').forEach(b => b.addEventListener('click', () => { viewPlan(b.closest('tr').dataset.id); }));
    c.querySelectorAll('.startBtn').forEach(b => b.addEventListener('click', () => { startPlan(b.closest('tr').dataset.id); }));
    c.querySelectorAll('.abortBtn').forEach(b => b.addEventListener('click', () => { abortPlan(b.closest('tr').dataset.id); }));
    if (openDetailId) viewPlan(openDetailId);
    if (hasRunningPlan()) startPolling(); else stopPolling();
}

function viewPlan(planId) {
    const p = lastPlans.find(x => x.plan_id === planId); if (!p) return; if (p.status === 'running') openPlanFeed(planId); else closePlanFeed(planId); openDetailId = planId; const existing = $(`d-${planId}`); if (existing) existing.remove(); const c = $('pList');
    const steps = (p.step_progress || p.steps || []).map(sp => { const state = (sp.state || sp); const cls = state === 'completed' ? 'done' : state === 'failed' ? 'fail' : state === 'in_progress' ? 'run' : ''; const label = sp.step ? `${sp.step}: ${state}` : state; return `<div class="step"><div class="dot ${cls}"></div><span class="muted">${escapeHtml(label)}</span></div>`; }).join('');
    const vms = (p.vm_sequence || []).map((v, i) => { const active = (p.current_vm && p.current_vm.vmid === v.vmid) ? ' (current)' : ''; return `<li class="muted">${i + 1}. ${escapeHtml(vmLabel(v))}${active}</li>`; }).join('');
    const logs = (p.logs || []).slice(-50).map(l => `<li>${escapeHtml(l)}</li>`).join('');
    const detail = `<div class="detail" id="d-${escapeHtml(planId)}"><h3>Plan ${escapeHtml(planId)}</h3><p class="muted">Template: ${escapeHtml(p.template || '')} | Steps: ${(p.steps || []).map(escapeHtml).join(', ')}</p><h4>Steps</h4>${steps}<h4>VM Sequence</h4><ul>${vms || '<li class="muted">No VM sequence</li>'}</ul><h4>Live log</h4><ul class="logs">${logs || '<li class="muted">No messages yet</li>'}</ul></div>`;
    c.insertAdjacentHTML('beforeend', DOMPurify.sanitize(detail));
}

async function startPlan(planId) { try { await api('start', 'POST', { plan_id: planId }); openPlanFeed(planId); toast(t('started')); await loadStatus(); await loadPlans(); startPolling(); } catch (err) { showError(err.message); } }

async function abortPlan(planId) { if (!confirm('Abort plan ' + planId + '?')) return; try { await api('abort', 'POST', { plan_id: planId }); toast(t('aborted'), 'warning'); await loadStatus(); await loadPlans(); } catch (err) { showError(err.message); } }

async function loadVms() { const cluster = $('cCluster').value; if (!cluster) { $('cError').textContent = 'Select a cluster first'; return; } $('cError').textContent = ''; try { const d = await api('vms?cluster_id=' + encodeURIComponent(cluster)); const vms = d.vms || []; const avail = $('cAvail'), sel = $('cSel'); avail.innerHTML = ''; sel.innerHTML = ''; vms.forEach(v => { const opt = document.createElement('option'); opt.value = JSON.stringify(v); opt.textContent = `${v.name} (ID ${v.vmid}, ${v.node})`; avail.appendChild(opt); }); $('cVmBox').hidden = false; if (vms.length) { toast(t('vmsLoaded', { count: vms.length }), 'info'); } else { toast(t('noVms'), 'warning'); } } catch (err) { showError(err.message); } }

function moveOptions(fromId, toId) { const from = $(fromId), to = $(toId); Array.from(from.selectedOptions).forEach(opt => { to.appendChild(opt); }); }

function reorderSelected(direction) {
    const sel = $('cSel'); const opts = Array.from(sel.selectedOptions);
    if (direction === 'up') { opts.forEach(opt => { if (opt.previousElementSibling) sel.insertBefore(opt, opt.previousElementSibling); }); }
    else { opts.reverse().forEach(opt => { if (opt.nextElementSibling) { if (opt.nextElementSibling.nextElementSibling) { sel.insertBefore(opt, opt.nextElementSibling.nextElementSibling); } else { sel.appendChild(opt); } } }); }
}

async function createPlan() {
    $('cError').textContent = ''; const cluster = $('cCluster').value, template = $('cTemplate').value; let steps = $('cSteps').value.split(',').map(s => s.trim()).filter(Boolean); if (template === 'safe') steps = ['cordon', 'evacuate', 'update', 'reboot']; if (template === 'fast') steps = ['update', 'reboot']; if (!cluster) { $('cError').textContent = 'Select a cluster'; return; }
    const vm_sequence = Array.from($('cSel').options).map(o => { try { return JSON.parse(o.value); } catch (e) { return null; } }).filter(Boolean);
    try { const r = await api('plan', 'POST', { cluster_id: cluster, steps, template, vm_sequence }); toast(t('created')); await loadStatus(); switchTab('plans'); loadPlans(); } catch (err) { $('cError').textContent = err.message; showError(err.message); }
}

function switchTab(name) { document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); if (name === 'plans') loadPlans(); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('pLoad').addEventListener('click', loadPlans); $('pStatus').addEventListener('change', loadPlans); $('pSearch').addEventListener('input', loadPlans); $('cCreate').addEventListener('click', createPlan); $('cTemplate').addEventListener('change', () => { const t = $('cTemplate').value; if (t === 'safe') $('cSteps').value = 'cordon, evacuate, update, reboot'; if (t === 'fast') $('cSteps').value = 'update, reboot'; }); $('cLoadVms').addEventListener('click', loadVms); $('cAdd').addEventListener('click', () => moveOptions('cAvail', 'cSel')); $('cRemove').addEventListener('click', () => moveOptions('cSel', 'cAvail')); $('cUp').addEventListener('click', () => reorderSelected('up')); $('cDown').addEventListener('click', () => reorderSelected('down')); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('rolling-update-orchestrator', '/api/plugins/rolling-update-orchestrator/i18n'); await loadStatus(); await loadClusters(); wireEvents(); })();
