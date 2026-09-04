/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/client-billing-portal/ui.js
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
const t = (k, p) => i18n ? i18n.getT('client-billing-portal')(k, p ? { params: p } : undefined) : k;
if (i18n) i18n.loadPluginNamespaceFull('client-billing-portal', '/api/plugins/client-billing-portal/i18n');

const state = { client: '', clients: [], invoices: [], usage: [], payments: [], invSort: { col: 'date', order: 'desc' } };

async function api(path, method = 'GET', body = null) { const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }; if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } const res = await fetch(path, opts); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data; }
function toast(msg, type = 'success') { const d = $('toasts'); const e = document.createElement('div'); e.className = `message ${type}`; e.textContent = msg; d.appendChild(e); setTimeout(() => e.remove(), 4000); }
function showError(msg) { toast(t('error', { msg }), 'error'); }
function statusClass(s) { if (s === 'paid') return 'success'; if (s === 'pending') return 'warning'; return 'danger'; }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

async function loadStatus() { try { const s = await api('status'); $('status').textContent = s.status === 'running' ? 'Running' : s.status; } catch (e) { $('status').textContent = 'Error'; } }
async function loadClients() { try { const d = await api('clients'); state.clients = d.clients || []; const opts = state.clients.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join(''); $('client').innerHTML = DOMPurify.sanitize('<option value="">Select</option>' + opts); } catch (e) { } }

async function loadClient() { $('clientError').textContent = ''; const id = $('client').value; if (!id) { showError('Select a client'); return; } state.client = id; const c = state.clients.find(x => x.id === id); $('clientName').value = c ? c.name : ''; $('iClient').value = id; $('pClient').value = id; $('summary').hidden = false; $('sName').textContent = c ? c.name : '-'; try { const u = await api(`usage?client_id=${encodeURIComponent(id)}`); $('sTotal').textContent = u.total; } catch (e) { } loadInvoices(); loadUsage(); loadPayments(); toast(t('loaded'), 'success'); }

async function loadInvoices() { if (!state.client) return; try { const d = await api(`invoices?client_id=${encodeURIComponent(state.client)}&status=${$('iFilter').value}&sort=${state.invSort.col}&order=${state.invSort.order}`); state.invoices = d.invoices || []; renderInvoices(); } catch (e) { showError(e.message); } }
function renderInvoices() {
    const c = $('invoicesList');
    if (!state.invoices.length) { c.innerHTML = '<p class="empty">No invoices.</p>'; return; }
    let html = '<table><thead><tr><th data-sort="date">Date</th><th data-sort="total">Total</th><th data-sort="status">Status</th><th>Actions</th></tr></thead><tbody>';
    state.invoices.forEach(i => {
        html += `<tr>
                <td class="muted">${escapeHtml(new Date(i.date).toLocaleDateString())}</td>
                <td class="muted">${escapeHtml(i.total)}</td>
                <td class="muted"><span class="badge ${statusClass(i.status)}">${escapeHtml(i.status)}</span></td>
                <td class="actions">
                    <button data-view="${escapeHtml(i.id)}">View</button>
                    <button data-pay="${escapeHtml(i.id)}">Pay</button>
                    <button data-void="${escapeHtml(i.id)}" class="secondary">Void</button>
                    <button data-del="${escapeHtml(i.id)}" class="secondary">Delete</button>
                </td>
            </tr>`;
    });
    html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    c.querySelectorAll('button[data-view]').forEach(b => b.addEventListener('click', () => { const i = state.invoices.find(x => x.id === b.dataset.view); if (!i) return; toast(i.items ? JSON.stringify(i.items) : 'No items'); }));
    c.querySelectorAll('button[data-pay]').forEach(b => b.addEventListener('click', async () => { try { await api('mark-paid', 'POST', { invoice_id: b.dataset.pay }); toast(t('paid'), 'success'); loadInvoices(); } catch (e) { showError(e.message); } }));
    c.querySelectorAll('button[data-void]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Void invoice?')) return; try { await api('void', 'POST', { invoice_id: b.dataset.void }); toast(t('voided'), 'success'); loadInvoices(); } catch (e) { showError(e.message); } }));
    c.querySelectorAll('button[data-del]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete invoice?')) return; try { await api('invoices', 'DELETE', { invoice_id: b.dataset.del }); toast(t('deleted'), 'success'); loadInvoices(); } catch (e) { showError(e.message); } }));
    c.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const col = th.dataset.sort; state.invSort.order = state.invSort.col === col && state.invSort.order === 'desc' ? 'asc' : 'desc'; state.invSort.col = col; loadInvoices(); }));
}

async function generateInvoice(e) { e.preventDefault(); $('iError').textContent = ''; const client = $('iClient').value; if (!client) { $('iError').textContent = 'Load a client first'; return; } const total = parseFloat($('iTotal').value); const itemsRaw = $('iItems').value.trim(); let items = []; if (itemsRaw) { try { items = JSON.parse(itemsRaw); } catch { $('iError').textContent = 'Items must be valid JSON'; return; } } try { const d = await api('invoices', 'POST', { client_id: client, total, items }); toast(t('generated'), 'success'); $('invForm').reset(); loadInvoices(); } catch (err) { $('iError').textContent = err.message; showError(err.message); } }

async function loadUsage() {
    if (!state.client) return; try {
        const d = await api(`usage?client_id=${encodeURIComponent(state.client)}&resource=${$('uRes').value}`); const c = $('usageList');
        if (!d.usage.length) { c.innerHTML = '<p class="empty">No usage.</p>'; return; }
        let html = '<table><thead><tr><th>Resource</th><th>Qty</th><th>Rate</th><th>Cost</th><th>Date</th></tr></thead><tbody>';
        d.usage.forEach(u => { html += `<tr><td class="muted">${escapeHtml(u.resource)}</td><td class="muted">${escapeHtml(u.quantity)}</td><td class="muted">${escapeHtml(u.rate)}</td><td class="muted">${escapeHtml(u.cost)}</td><td class="muted">${u.date ? escapeHtml(new Date(u.date).toLocaleDateString()) : '-'}</td></tr>`; });
        html += `</tbody></table><p class="muted" style="margin-top:8px">Total: ${escapeHtml(d.total)}</p>`; c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showError(e.message); }
}

async function recordPayment() { $('pError').textContent = ''; const client = $('pClient').value, invoice = $('pInvoice').value.trim(), amount = parseFloat($('pAmount').value); if (!client || !invoice || isNaN(amount) || amount <= 0) { $('pError').textContent = 'Client, invoice and positive amount required'; return; } try { const d = await api('payment', 'POST', { client_id: client, invoice_id: invoice, amount }); toast(t('recorded'), 'success'); loadPayments(); loadInvoices(); } catch (err) { $('pError').textContent = err.message; showError(err.message); } }

async function loadPayments() {
    if (!state.client) return; try {
        const d = await api(`payments?client_id=${encodeURIComponent(state.client)}`); const c = $('paymentsList');
        if (!d.payments.length) { c.innerHTML = '<p class="empty">No payments.</p>'; return; }
        let html = '<table><thead><tr><th>Invoice</th><th>Amount</th><th>Time</th></tr></thead><tbody>';
        d.payments.forEach(p => { html += `<tr><td class="muted">${escapeHtml(p.invoice_id)}</td><td class="muted">${escapeHtml(p.amount)}</td><td class="muted">${p.timestamp ? escapeHtml(new Date(p.timestamp).toLocaleString()) : '-'}</td></tr>`; });
        html += '</tbody></table>'; c.innerHTML = DOMPurify.sanitize(html);
    } catch (e) { showError(e.message); }
}

function switchTab(name) { state.tab = name; document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name)); document.querySelectorAll('.tab-panel').forEach(p => p.hidden = (p.id !== 'panel-' + name)); }

function wireEvents() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); $('loadClient').addEventListener('click', loadClient); $('invForm').addEventListener('submit', generateInvoice); $('pRecord').addEventListener('click', recordPayment); $('iFilter').addEventListener('change', loadInvoices); $('uRes').addEventListener('input', loadUsage); }

(async () => { if (i18n) await i18n.loadPluginNamespaceFull('client-billing-portal', '/api/plugins/client-billing-portal/i18n'); await loadStatus(); await loadClients(); wireEvents(); })();
