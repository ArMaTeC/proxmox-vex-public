/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/ids/ui.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Ui JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
(function () {
    // --- theme ---
    const qs = new URLSearchParams(window.location.search);
    const THEME_MAP = {
        'proxmoxDark': 'modern-dark',
        'proxmoxLight': 'modern-light',
        'corporateDark': 'corp-dark',
        'corporateLight': 'corp-light'
    };
    function normalizeTheme(name) { return THEME_MAP[name] || name || 'modern-dark'; }
    let currentTheme = normalizeTheme(qs.get('theme'));
    document.documentElement.setAttribute('data-theme', currentTheme);

    function setTheme(name) {
        const t = normalizeTheme(name);
        if (t === currentTheme) return;
        currentTheme = t;
        document.documentElement.setAttribute('data-theme', t);
    }

    function watchTheme() {
        // The main app broadcasts theme changes via postMessage (defense-in-depth for iframes).
        window.addEventListener('message', e => {
            if (e.origin !== window.location.origin) return;
            if (e.data && e.data.type === 'theme' && e.data.theme) setTheme(e.data.theme);
        });
        // Also attempt to sync from a parent data-theme attribute when available.
        try {
            if (window.parent && window.parent.document && window.parent.document.documentElement) {
                const parent = window.parent.document.documentElement;
                const parentTheme = parent.getAttribute('data-theme');
                if (parentTheme) setTheme(parentTheme);
                const obs = new MutationObserver(() => {
                    const t = parent.getAttribute('data-theme');
                    if (t) setTheme(t);
                });
                obs.observe(parent, { attributes: true, attributeFilter: ['data-theme'] });
            }
        } catch (e) { /* cross-origin is ok */ }
    }
    watchTheme();

    // --- i18n ---
    const T = {
        title: 'IDS / IPS', status: 'Status', running: 'Running', error: 'Error',
        dashboard: 'Dashboard', segments: 'Segments', rules: 'Rules', policies: 'Policies',
        alerts: 'Alerts', reports: 'Reports', analyze: 'Analyze', refresh: 'Refresh',
        activeSegments: 'Active Segments', openAlerts: 'Open Alerts', criticalAlerts: 'Critical Alerts',
        topThreat: 'Top Threat', topThreats: 'Top Threats', latestAlerts: 'Latest Alerts',
        noAlerts: 'No alerts.', noData: 'No data', noSegments: 'No segments configured.',
        noRules: 'No rules defined.', noPolicies: 'No policies defined.',
        alertsCreated: 'Alerts created',
        addSegment: 'Add Segment', addRule: 'Add Rule', addPolicy: 'Add Policy',
        clear: 'Clear', name: 'Name', interface: 'Interface', bridge: 'Bridge', vlan: 'VLAN',
        captureMode: 'Capture Mode', enabled: 'Enabled', ruleType: 'Rule Type',
        signature: 'Signature', threatType: 'Threat Type', severity: 'Severity',
        segment: 'Segment', defaultAction: 'Default Action', ruleIds: 'Rule IDs',
        actionAlert: 'Alert', actionBlock: 'Block', actionQuarantine: 'Quarantine',
        actionRateLimit: 'Rate limit', allSeverities: 'All severities', allStates: 'All states',
        open: 'Open', acknowledged: 'Acknowledged', acknowledgeAll: 'Ack all visible',
        hours: 'Hours', summary: 'Summary', timeline: 'Timeline', exportCSV: 'CSV',
        exportJSON: 'JSON', packetCount: 'Packet count', sourceIp: 'Source IP',
        targetIp: 'Target IP', targetPort: 'Target port', packetJson: 'Packet JSON (advanced)',
        packets: 'Packets', blocked: 'Blocked', quarantined: 'Quarantined',
        runAnalysis: 'Run Analysis', cancel: 'Cancel', delete: 'Delete', confirm: 'Are you sure?',
        confirmDelete: 'This action cannot be undone.', ready: 'Ready', loading: 'Loading…',
        save: 'Save', saving: 'Saving…', saved: 'Saved', notFound: 'No options',
        details: 'Details', actions: 'Actions', capture: 'Capture', stop: 'Stop',
        tune: 'Tune', reEvaluate: 'Re-evaluate', block: 'Block', quarantine: 'Quarantine',
        ack: 'Ack', nAck: 'Un-ack', none: 'None', all: 'All', close: 'Close',
        since: 'Since', until: 'Until',
        updates: 'Updates', ruleUpdates: 'Rule Updates', ruleFeed: 'Rule Feed',
        feedUrl: 'Ruleset URL', versionUrl: 'Version URL', checkNow: 'Check now', updateNow: 'Update now',
        convertRulesFile: 'Convert rules file', rulesText: 'Paste Suricata/Snort .rules text',
        previewConvert: 'Preview / Convert', lastVersion: 'Latest upstream version',
        installedVersion: 'Installed version', updateAvailable: 'Update available',
        upToDate: 'Up to date', newerVersion: 'Newer version available',
        noInstalledVersion: 'No installed version recorded',
        localRuleCount: 'Local rules', feedAvailable: 'Feed reachable', feedUnavailable: 'Feed not reachable',
        converted: 'Converted', skipped: 'Skipped', imported: 'Imported', noFeedData: 'No feed data',
        checkFirst: 'Check the feed status first.'
    };
    const i18n = (window.parent && window.parent.ProxmoxVExI18n) || window.ProxmoxVExI18n;
    let t = (k, opts = {}) => {
        const v = i18n && i18n.getT && i18n.getT('ids')(k, opts);
        if (v && v !== k) return v;
        return T[k] || k;
    };

    function updateI18n() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            const translated = t(key);
            if (el.tagName === 'TITLE' || el.tagName === 'H1') {
                if (!el.dataset.i18nDefault) el.dataset.i18nDefault = el.textContent;
                el.textContent = translated === key ? el.dataset.i18nDefault : translated;
            } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                if (!el.dataset.i18nDefault) el.dataset.i18nDefault = el.placeholder;
                el.placeholder = translated === key ? el.dataset.i18nDefault : translated;
            } else if (el.tagName === 'OPTION') {
                if (!el.dataset.i18nDefault) el.dataset.i18nDefault = el.textContent;
                el.textContent = translated === key ? el.dataset.i18nDefault : translated;
            } else {
                if (!el.dataset.i18nDefault) el.dataset.i18nDefault = el.textContent;
                el.textContent = translated === key ? el.dataset.i18nDefault : translated;
            }
        });
    }
    updateI18n();

    // --- helpers ---
    const $ = (id) => document.getElementById(id);
    const $$ = (sel, c = document) => Array.from(c.querySelectorAll(sel));
    const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
    const fmtDate = (ts) => { if (!ts) return '-'; const d = new Date(typeof ts === 'number' ? ts * 1000 : ts); return isNaN(d) ? ts : d.toLocaleString(); };
    const fmtIp = (ts) => { if (!ts) return '-'; const d = new Date(ts); return isNaN(d) ? ts : d.toLocaleString(); };
    const formatSignature = (sig) => {
        if (!sig) return '-';
        if (sig.length <= 24 || !sig.includes(',')) return escapeHtml(sig);
        let parts;
        const eq = sig.indexOf('=');
        if (eq > -1) {
            const key = sig.slice(0, eq);
            parts = sig.slice(eq + 1).split(',').map(v => `${key}=${v.trim()}`);
        } else {
            parts = sig.split(',').map(s => s.trim());
        }
        return `<select class="signature-select" title="${escapeHtml(sig)}">${parts.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('')}</select>`;
    };
    const debounce = (fn, ms) => { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; };

    function showToast(message, type = 'info') {
        const stack = $('toastStack');
        const toast = el('div', 'toast ' + type);
        toast.textContent = message;
        stack.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
        try { if (window.parent && window.parent.postMessage) window.parent.postMessage({ type: 'ProxmoxVEx-toast', message, level: type }, '*'); } catch (e) { }
    }

    function showInlineMessage(type, text) {
        const m = $('message');
        m.className = 'message ' + type;
        m.textContent = text;
        if (type === 'success') setTimeout(() => { m.className = ''; m.textContent = ''; }, 5000);
    }

    function setStatus(ok, text) {
        const p = $('statusPill');
        p.textContent = text;
        p.className = 'status-pill' + (ok ? '' : ' error');
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showSpinner(btnId, show) {
        const btn = $(btnId);
        if (!btn) return;
        const sp = btn.querySelector('.spinner');
        if (sp) sp.classList.toggle('show', show);
        btn.disabled = show;
    }

    async function api(method, path, body = null) {
        const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } };
        if (body !== null && body !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(path, opts);
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(res.status + ' ' + res.statusText + ': ' + txt.slice(0, 120));
        }
        if (res.status === 204) return null;
        const data = await res.json().catch(() => ({}));
        return data;
    }

    function severityClass(s) { return 'badge ' + (s || 'low').toLowerCase(); }
    function actionClass(a) { return 'badge ' + (a || 'alert'); }

    // --- tabs ---
    function showTab(tab) {
        $$('.tab').forEach(btn => {
            const active = btn.dataset.tab === tab;
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
            btn.setAttribute('tabindex', active ? '0' : '-1');
        });
        $$('.section').forEach(sec => {
            const active = sec.id === tab + 'Section';
            sec.classList.toggle('active', active);
            if (active) sec.removeAttribute('hidden'); else sec.setAttribute('hidden', 'true');
        });
        if (tab === 'dashboard') loadDashboard();
        if (tab === 'segments') loadSegments();
        if (tab === 'rules') loadRules();
        if (tab === 'policies') loadPolicies();
        if (tab === 'alerts') loadAlerts();
        if (tab === 'reports') loadSummary();
        if (tab === 'analyze') loadAnalyzeSegments();
        if (tab === 'updates') { loadUpdates(); loadSchedule(); }
    }

    $('tabs').addEventListener('click', e => { if (e.target.classList.contains('tab')) showTab(e.target.dataset.tab); });
    $$('.tab').forEach(tab => {
        tab.addEventListener('keydown', e => {
            const tabs = $$('.tab');
            const idx = tabs.indexOf(e.target);
            if (e.key === 'ArrowRight') { const n = tabs[(idx + 1) % tabs.length]; n.focus(); n.click(); }
            if (e.key === 'ArrowLeft') { const n = tabs[(idx - 1 + tabs.length) % tabs.length]; n.focus(); n.click(); }
        });
    });

    // --- dashboard ---
    let lastDashboard = {};
    async function loadDashboard() {
        setStatus(true, t('loading'));
        try {
            const [segments, alerts, rules, policies, summary] = await Promise.all([
                api('GET', '/api/ids/segments').catch(() => []),
                api('GET', '/api/ids/alerts').catch(() => []),
                api('GET', '/api/ids/rules').catch(() => []),
                api('GET', '/api/ids/policies').catch(() => []),
                api('GET', '/api/ids/reports/summary?hours=24').catch(() => ({}))
            ]);
            const open = alerts.filter(a => !a.acknowledged);
            const critical = open.filter(a => a.severity === 'critical');
            updateStat('statSegments', 'deltaSegments', segments.length, lastDashboard.segments);
            updateStat('statAlerts', 'deltaAlerts', open.length, lastDashboard.alerts);
            updateStat('statCritical', 'deltaCritical', critical.length, lastDashboard.critical);
            $('statRules').textContent = rules.length;
            $('statTopThreat').textContent = (summary.top_threats || []).sort((a, b) => b[1] - a[1])[0]?.[0] || t('none');
            lastDashboard = { segments: segments.length, alerts: open.length, critical: critical.length };

            const recent = alerts.slice(0, 6);
            const alertEl = $('dashboardAlerts');
            alertEl.innerHTML = DOMPurify.sanitize(recent.length ? `<table><thead><tr><th>${t('time')}</th><th>${t('threatType')}</th><th>${t('severity')}</th><th>${t('sourceIp')}</th></tr></thead><tbody>` +
                recent.map(a => `<tr><td>${fmtDate(a.created_at)}</td><td>${escapeHtml(a.threat_type)}</td><td><span class="${severityClass(a.severity)}">${escapeHtml(a.severity)}</span></td><td class="mono">${escapeHtml(a.source_ip || '-')}</td></tr>`).join('') + '</tbody></table>'
                : `<p class="empty">${t('noAlerts')}</p>`);

            const threats = summary.top_threats || [];
            const threatEl = $('dashboardThreats');
            threatEl.innerHTML = DOMPurify.sanitize(threats.length ? `<table><tbody>` + threats.slice(0, 8).map(([name, count]) =>
                `<tr><td>${escapeHtml(name)}</td><td class="right"><span class="badge muted">${escapeHtml(count)}</span></td></tr>`).join('') + '</tbody></table>'
                : `<p class="empty">${t('noData')}</p>`);
            setStatus(true, t('ready'));
        } catch (e) { setStatus(false, t('error')); showInlineMessage('error', e.message); }
    }

    function updateStat(id, deltaId, val, prev) {
        $(id).textContent = val;
        const d = $(deltaId);
        if (prev !== undefined && prev !== null) {
            const diff = val - prev;
            d.textContent = (diff === 0 ? '' : (diff > 0 ? '↑ ' : '↓ ')) + Math.abs(diff) + ' vs last';
            d.style.color = diff === 0 ? 'var(--muted)' : (diff > 0 ? 'var(--danger)' : 'var(--success)');
        }
    }

    // --- segments ---
    async function loadSegments() {
        try {
            const segments = await api('GET', '/api/ids/segments');
            const el = $('segmentsList');
            if (!segments.length) { el.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noSegments')}</p>`); return; }
            el.innerHTML = DOMPurify.sanitize(`<table><thead><tr><th>${t('name')}</th><th>${t('interface')}</th><th>${t('bridge')}</th><th>${t('vlan')}</th><th>${t('captureMode')}</th><th>${t('enabled')}</th><th>${t('actions')}</th></tr></thead><tbody>` +
                segments.map(s => `<tr>
                        <td><strong>${escapeHtml(s.name)}</strong>${s.description ? '<br><span class="muted">' + escapeHtml(s.description) + '</span>' : ''}</td>
                        <td class="mono">${escapeHtml(s.interface || '-')}</td><td class="mono">${escapeHtml(s.bridge || '-')}</td><td>${escapeHtml(s.vlan || '-')}</td>
                        <td>${escapeHtml(s.capture_mode)}</td>
                        <td><span class="dot ${s.enabled ? 'online' : 'offline'}"></span> ${s.enabled ? t('enabled') : t('disabled')}</td>
                        <td class="actions">
                            <button class="secondary" data-action="capture" data-id="${s.id}">${t('capture')}</button>
                            <button class="secondary" data-action="stop" data-id="${s.id}">${t('stop')}</button>
                            <button class="ghost" data-action="delete" data-id="${s.id}">${t('delete')}</button>
                        </td>
                    </tr>`).join('') + '</tbody></table>');
            populateSelects(segments);
        } catch (e) { showInlineMessage('error', e.message); }
    }

    $('addSegment').addEventListener('click', async () => {
        const data = {
            name: $('segName').value,
            interface: $('segInterface').value || null,
            bridge: $('segBridge').value || null,
            vlan: $('segVlan').value ? parseInt($('segVlan').value) : null,
            capture_mode: $('segCapture').value,
            enabled: $('segEnabled').value === '1'
        };
        if (!data.name) { showToast('Name is required', 'warn'); return; }
        $('addSegmentSpinner').classList.add('show');
        try {
            await api('POST', '/api/ids/segments', data);
            showToast(t('addSegment') + ' ' + t('saved'), 'success');
            ['segName', 'segInterface', 'segBridge', 'segVlan'].forEach(id => $(id).value = '');
            await loadSegments();
        } catch (e) { showToast(e.message, 'error'); }
        finally { $('addSegmentSpinner').classList.remove('show'); }
    });
    $('clearSegment').addEventListener('click', () => ['segName', 'segInterface', 'segBridge', 'segVlan'].forEach(id => $(id).value = ''));

    // --- rules ---
    let rulesPage = 1;
    let rulesFilter = '';
    const RULES_LIMIT = 50;

    async function loadRules(page = rulesPage, filter = rulesFilter) {
        rulesPage = page;
        rulesFilter = filter;
        try {
            const offset = (rulesPage - 1) * RULES_LIMIT;
            let url = `/api/ids/rules?limit=${RULES_LIMIT}&offset=${offset}`;
            if (rulesFilter.trim()) url += '&q=' + encodeURIComponent(rulesFilter.trim());
            const result = await api('GET', url);
            const allRules = Array.isArray(result) ? result : (result.rules || []);
            const total = Array.isArray(result) ? allRules.length : (result.total || allRules.length);
            const rules = allRules.slice(offset, offset + RULES_LIMIT);
            const el = $('rulesList');
            const pag = $('rulesPagination');
            if (!rules.length) { el.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noRules')}</p>`); pag.innerHTML = ''; return; }
            el.innerHTML = DOMPurify.sanitize(`<table><thead><tr><th>${t('name')}</th><th>${t('ruleType')}</th><th>${t('signature')}</th><th>${t('threatType')}</th><th>${t('severity')}</th><th class="right">${t('actions')}</th></tr></thead><tbody>` +
                rules.map(r => `<tr>
                        <td><strong>${escapeHtml(r.name)}</strong></td>
                        <td>${escapeHtml(r.rule_type)}</td>
                        <td class="mono">${formatSignature(r.signature)}</td>
                        <td>${escapeHtml(r.threat_type)}</td>
                        <td><span class="${severityClass(r.severity)}">${escapeHtml(r.severity)}</span></td>
                        <td class="actions right">
                            <button class="secondary" data-action="tune" data-id="${r.id}">${t('tune')}</button>
                            <button class="ghost" data-action="delete" data-id="${r.id}">${t('delete')}</button>
                        </td>
                    </tr>`).join('') + '</tbody></table>');
            const totalPages = Math.max(1, Math.ceil(total / RULES_LIMIT));
            if (totalPages > 1) {
                pag.innerHTML = DOMPurify.sanitize(`<button class="secondary" data-page="1" ${rulesPage === 1 ? 'disabled' : ''}>First</button>
                        <button class="secondary" data-page="${rulesPage - 1}" ${rulesPage === 1 ? 'disabled' : ''}>Prev</button>
                        <span>Page ${rulesPage} of ${totalPages}</span>
                        <button class="secondary" data-page="${rulesPage + 1}" ${rulesPage === totalPages ? 'disabled' : ''}>Next</button>
                        <button class="secondary" data-page="${totalPages}" ${rulesPage === totalPages ? 'disabled' : ''}>Last</button>`);
            } else {
                pag.innerHTML = '';
            }
        } catch (e) { showInlineMessage('error', e.message); }
    }

    const searchRules = debounce((value) => { loadRules(1, value); }, 300);
    $('ruleFilter').addEventListener('input', e => searchRules(e.target.value));

    $('rulesList').addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;
        if (action === 'tune') actions.tuneRule(id);
        if (action === 'delete') actions.deleteRule(id);
    });

    $('rulesPagination').addEventListener('click', e => {
        const btn = e.target.closest('button[data-page]');
        if (!btn || btn.disabled) return;
        const p = parseInt(btn.dataset.page, 10);
        if (!isNaN(p) && p > 0) loadRules(p);
    });

    // Use delegated data-action listeners because DOMPurify strips inline onclick attributes.
    $('segmentsList').addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;
        if (action === 'capture') actions.runCapture(id);
        if (action === 'stop') actions.stopCapture(id);
        if (action === 'delete') actions.deleteSegment(id);
    });

    $('policiesList').addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;
        if (action === 're-evaluate') actions.reEvalPolicy(id);
        if (action === 'delete') actions.deletePolicy(id);
    });

    $('alertsList').addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;
        if (action === 'ack') actions.ackAlert(id, true);
        if (action === 'unack') actions.ackAlert(id, false);
        if (action === 'block') actions.blockHost(id, btn.dataset.ip);
        if (action === 'detail') actions.alertDetail(id);
    });

    $('addRule').addEventListener('click', async () => {
        const data = {
            name: $('ruleName').value,
            rule_type: $('ruleType').value,
            signature: $('ruleSignature').value || null,
            threat_type: $('ruleThreat').value,
            severity: $('ruleSeverity').value,
            enabled: true
        };
        if (!data.name) { showToast('Name is required', 'warn'); return; }
        $('addRuleSpinner').classList.add('show');
        try {
            await api('POST', '/api/ids/rules', data);
            showToast(t('addRule') + ' ' + t('saved'), 'success');
            ['ruleName', 'ruleSignature', 'ruleThreat'].forEach(id => $(id).value = '');
            await loadRules();
        } catch (e) { showToast(e.message, 'error'); }
        finally { $('addRuleSpinner').classList.remove('show'); }
    });
    $('clearRule').addEventListener('click', () => ['ruleName', 'ruleSignature', 'ruleThreat'].forEach(id => $(id).value = ''));

    // --- policies ---
    async function loadPolicies() {
        try {
            const [policies, segments] = await Promise.all([api('GET', '/api/ids/policies'), api('GET', '/api/ids/segments')]);
            const segMap = Object.fromEntries(segments.map(s => [s.id, s.name]));
            const el = $('policiesList');
            if (!policies.length) { el.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noPolicies')}</p>`); return; }
            el.innerHTML = DOMPurify.sanitize(`<table><thead><tr><th>${t('name')}</th><th>${t('segment')}</th><th>${t('defaultAction')}</th><th>${t('ruleIds')}</th><th class="right">${t('actions')}</th></tr></thead><tbody>` +
                policies.map(p => `<tr>
                        <td><strong>${escapeHtml(p.name)}</strong></td>
                        <td>${escapeHtml(segMap[p.segment_id] || p.segment_id)}</td>
                        <td><span class="badge ${escapeHtml(p.default_action)}">${escapeHtml(p.default_action)}</span></td>
                        <td class="mono">${escapeHtml((p.rule_ids || []).join(', '))}</td>
                        <td class="actions right">
                            <button class="secondary" data-action="re-evaluate" data-id="${p.id}">${t('reEvaluate')}</button>
                            <button class="ghost" data-action="delete" data-id="${p.id}">${t('delete')}</button>
                        </td>
                    </tr>`).join('') + '</tbody></table>');
            // Ensure the policy form has the latest segment options.
            populateSelects(segments);
        } catch (e) { showInlineMessage('error', e.message); }
    }

    $('addPolicy').addEventListener('click', async () => {
        const data = {
            name: $('policyName').value,
            segment_id: parseInt($('policySegment').value) || null,
            default_action: $('policyAction').value,
            rule_ids: $('policyRuleIds').value.split(',').map(s => parseInt(s.trim())).filter(Boolean),
            enabled: true
        };
        if (!data.name || !data.segment_id) { showToast(t('name') + ' / ' + t('segment') + ' required', 'warn'); return; }
        $('addPolicySpinner').classList.add('show');
        try {
            await api('POST', '/api/ids/policies', data);
            showToast(t('addPolicy') + ' ' + t('saved'), 'success');
            $('policyName').value = ''; $('policyRuleIds').value = '';
            await loadPolicies();
        } catch (e) { showToast(e.message, 'error'); }
        finally { $('addPolicySpinner').classList.remove('show'); }
    });
    $('clearPolicy').addEventListener('click', () => { $('policyName').value = ''; $('policyRuleIds').value = ''; });

    function populateSelects(segments) {
        const opts = '<option value="">' + t('select') + '</option>' + segments.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
        $('policySegment').innerHTML = DOMPurify.sanitize(opts);
        $('analyzeSegment').innerHTML = DOMPurify.sanitize(opts);
    }

    // --- alerts ---
    let alertsData = [];
    async function loadAlerts() {
        try {
            const params = new URLSearchParams();
            const severity = $('alertSeverity').value;
            const ack = $('alertAck').value;
            const threat = $('alertThreat').value.trim();
            const since = $('alertSince').value;
            if (severity) params.set('severity', severity);
            if (ack !== '') params.set('acknowledged', ack);
            if (threat) params.set('threat_type', threat);
            if (since) params.set('since', new Date(since).toISOString());
            alertsData = await api('GET', '/api/ids/alerts?' + params.toString());
            const el = $('alertsList');
            if (!alertsData.length) { el.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noAlerts')}</p>`); return; }
            el.innerHTML = DOMPurify.sanitize(`<table><thead><tr>
                    <th>${t('time')}</th><th>${t('threatType')}</th><th>${t('severity')}</th>
                    <th>${t('sourceIp')}</th><th>${t('targetIp')}</th><th>${t('ack')}</th><th class="right">${t('actions')}</th>
                </tr></thead><tbody>` +
                alertsData.map(a => `<tr>
                    <td>${fmtDate(a.created_at)}</td>
                    <td>${escapeHtml(a.threat_type)}</td>
                    <td><span class="${severityClass(a.severity)}">${escapeHtml(a.severity)}</span></td>
                    <td class="mono">${escapeHtml(a.source_ip || '-')}</td>
                    <td class="mono">${escapeHtml(a.target_ip || '-')}</td>
                    <td>${a.acknowledged ? t('acknowledged') : t('open')}</td>
                    <td class="actions right">
                        <button class="secondary" data-action="${a.action_taken === 'acknowledged' ? 'unack' : 'ack'}" data-id="${escapeHtml(a.id)}">${a.action_taken === 'acknowledged' ? t('nAck') : t('ack')}</button>
                        <button class="secondary" data-action="block" data-id="${escapeHtml(a.id)}" data-ip="${escapeHtml(a.source_ip || '')}">${t('block')}</button>
                        <button class="ghost" data-action="detail" data-id="${escapeHtml(a.id)}">${t('details')}</button>
                    </td>
                </tr>`).join('') + '</tbody></table>');
        } catch (e) { showInlineMessage('error', e.message); }
    }

    $('alertRefresh').addEventListener('click', loadAlerts);
    $('alertAckAll').addEventListener('click', async () => {
        try {
            const open = alertsData.filter(x => x.action_taken !== 'acknowledged');
            for (const a of open) await api('POST', `/api/ids/alerts/${a.id}/actions`, { action: 'acknowledge', reason: '' });
            showToast('Acknowledged ' + open.length + ' alerts', 'success');
            loadAlerts();
        } catch (e) { showToast(e.message, 'error'); }
    });
    $$('#alertSeverity, #alertAck, #alertSince').forEach(s => s.addEventListener('change', loadAlerts));
    $('alertThreat').addEventListener('input', debounce(loadAlerts, 300));

    // --- reports ---
    async function loadSummary() {
        try {
            const hours = $('reportHours').value;
            const data = await api('GET', `/api/ids/reports/summary?hours=${hours}`);
            const grid = $('summaryResult');
            grid.style.display = 'grid';
            grid.innerHTML = DOMPurify.sanitize(`<div class="card"><div class="title">${t('packets')}</div><div class="value">${data.packets || 0}</div></div>
                    <div class="card"><div class="title">${t('alerts')}</div><div class="value">${data.alerts || 0}</div></div>
                    <div class="card"><div class="title">${t('blocked')}</div><div class="value">${data.blocked || 0}</div></div>
                    <div class="card"><div class="title">${t('quarantined')}</div><div class="value">${data.quarantined || 0}</div></div>`);
            if ((data.top_threats || []).length) {
                grid.innerHTML += DOMPurify.sanitize(`<div class="panel" style="grid-column:1/-1"><h3>${t('topThreats')}</h3><table><tbody>` +
                    data.top_threats.map(([n, c]) => `<tr><td>${escapeHtml(n)}</td><td class="right"><span class="badge muted">${escapeHtml(c)}</span></td></tr>`).join('') + '</tbody></table></div>');
            }
        } catch (e) { showInlineMessage('error', e.message); }
    }

    async function loadTimeline() {
        try {
            const hours = $('reportHours').value;
            const data = await api('GET', `/api/ids/reports/timeline?hours=${hours}`);
            const panel = $('timelinePanel');
            const el = $('timelineResult');
            panel.style.display = 'block';
            if (!data.timeline || !data.timeline.length) { el.innerHTML = DOMPurify.sanitize(`<p class="empty">${t('noData')}</p>`); return; }
            el.innerHTML = DOMPurify.sanitize(`<table><thead><tr><th>${t('time')}</th><th>${t('alerts')}</th></tr></thead><tbody>` +
                data.timeline.map(t => `<tr><td>${escapeHtml(fmtIp(t.bucket))}</td><td class="right"><span class="badge muted">${escapeHtml(t.count)}</span></td></tr>`).join('') + '</tbody></table>');
        } catch (e) { showInlineMessage('error', e.message); }
    }

    async function exportReport(format) {
        try {
            const hours = $('reportHours').value;
            const data = await api('GET', `/api/ids/reports/export?hours=${hours}&format=${format}`);
            const blob = new Blob([format === 'csv' ? (data.csv || '') : JSON.stringify(data, null, 2)], { type: format === 'csv' ? 'text/csv' : 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `ids-report-${new Date().toISOString().slice(0, 19)}.${format}`;
            a.click();
        } catch (e) { showToast(e.message, 'error'); }
    }

    $('summaryRefresh').addEventListener('click', loadSummary);
    $('timelineRefresh').addEventListener('click', loadTimeline);
    $('exportCsv').addEventListener('click', () => exportReport('csv'));
    $('exportJson').addEventListener('click', () => exportReport('json'));

    // --- analyze ---
    async function loadAnalyzeSegments() { await loadSegments(); }

    $('runAnalyze').addEventListener('click', async () => {
        const seg = $('analyzeSegment').value;
        if (!seg) { showToast('Select a segment', 'warn'); return; }
        const count = parseInt($('packetCount').value) || 25;
        const src = $('packetSource').value;
        const tgt = $('packetTarget').value;
        const port = parseInt($('packetPort').value) || 1;
        const custom = $('packetJson').value.trim();
        let packets;
        if (custom) {
            try { packets = JSON.parse(custom); }
            catch (e) { showToast('Invalid packet JSON', 'error'); return; }
        } else {
            packets = Array.from({ length: count }, (_, i) => ({ source: src, destination: tgt, sport: 10000 + i, dport: port + i }));
        }
        $('analyzeSpinner').classList.add('show');
        try {
            const res = await api('POST', `/api/ids/segments/${seg}/analyze`, { packets });
            const el = $('analyzeResult');
            el.style.display = 'block';
            el.innerHTML = DOMPurify.sanitize(`<div class="message success">${t('alertsCreated')}: ${res.alerts_created || 0}</div>`);
        } catch (err) { showToast(err.message, 'error'); }
        finally { $('analyzeSpinner').classList.remove('show'); }
    });

    // --- actions registry (exposed to inline handlers) ---
    const actions = {};
    actions.runCapture = async (id) => { try { await api('POST', `/api/ids/segments/${id}/capture`); showToast(t('capture') + ' ' + t('started'), 'success'); } catch (e) { showToast(e.message, 'error'); } };
    actions.stopCapture = async (id) => { try { await api('POST', `/api/ids/segments/${id}/stop`); showToast(t('stop') + ' ' + t('saved'), 'success'); } catch (e) { showToast(e.message, 'error'); } };
    actions.deleteSegment = (id) => confirmDelete(() => api('DELETE', `/api/ids/segments/${id}`).then(() => { showToast(t('delete') + ' ' + t('saved'), 'success'); loadSegments(); }).catch(e => showToast(e.message, 'error')));
    actions.tuneRule = async (id) => { const newSev = prompt('New severity (low/medium/high/critical):'); if (!newSev) return; try { await api('PUT', `/api/ids/rules/${id}`, { severity: newSev }); showToast(t('tune') + ' ' + t('saved'), 'success'); loadRules(); } catch (e) { showToast(e.message, 'error'); } };
    actions.deleteRule = (id) => confirmDelete(() => api('DELETE', `/api/ids/rules/${id}`).then(() => { showToast(t('delete') + ' ' + t('saved'), 'success'); loadRules(); }).catch(e => showToast(e.message, 'error')));
    actions.reEvalPolicy = async (id) => { try { await api('POST', `/api/ids/policies/${id}/re-evaluate`); showToast(t('reEvaluate') + ' ' + t('saved'), 'success'); loadPolicies(); } catch (e) { showToast(e.message, 'error'); } };
    actions.deletePolicy = (id) => confirmDelete(() => api('DELETE', `/api/ids/policies/${id}`).then(() => { showToast(t('delete') + ' ' + t('saved'), 'success'); loadPolicies(); }).catch(e => showToast(e.message, 'error')));
    // Apply alert actions through the generic actions endpoint; the backend has no /ack or /actions/block route.
    actions.ackAlert = async (id, val) => { try { const action = val ? 'acknowledge' : 'unacknowledge'; await api('POST', `/api/ids/alerts/${id}/actions`, { action, reason: '' }); showToast(t('ack') + ' ' + t('saved'), 'success'); loadAlerts(); } catch (e) { showToast(e.message, 'error'); } };
    actions.blockHost = async (id, ip) => { if (!ip) return; try { await api('POST', `/api/ids/alerts/${id}/actions`, { action: 'block', reason: ip }); showToast(t('block') + ' ' + ip, 'success'); loadAlerts(); } catch (e) { showToast(e.message, 'error'); } };
    // Render alert JSON into the details panel inside the Alerts tab so it is actually visible (it was previously writing to the hidden Analyze tab panel).
    actions.alertDetail = (id) => { const a = alertsData.find(x => String(x.id) === String(id)); if (a) { const p = $('alertDetailPanel'); const c = $('alertDetailContent'); c.textContent = JSON.stringify(a, null, 2); p.style.display = 'block'; p.scrollIntoView({ behavior: 'smooth' }); } };
    window.actions = actions;

    // --- confirmation modal ---
    let confirmCallback = null;
    function confirmDelete(fn) {
        confirmCallback = fn;
        $('confirmModal').classList.add('active');
    }
    $('confirmCancel').addEventListener('click', () => { $('confirmModal').classList.remove('active'); confirmCallback = null; });
    $('confirmOk').addEventListener('click', () => { if (confirmCallback) confirmCallback(); $('confirmModal').classList.remove('active'); confirmCallback = null; });
    $('confirmModal').addEventListener('click', e => { if (e.target === $('confirmModal')) $('confirmModal').classList.remove('active'); });

    // --- updates ---
    async function loadUpdates() {
        const data = await api('GET', '/api/ids/feed/status');
        if (data.error) {
            showInlineMessage('error', data.error);
            return;
        }
        const statusValue = data.newer
            ? t('newerVersion')
            : (data.installed_version ? t('upToDate') : t('noInstalledVersion'));
        const status = document.createElement('div');
        status.innerHTML = DOMPurify.sanitize(`<div class="grid cols-4">`
            + `<div class="card"><div class="title">${t('lastVersion')}</div><div class="value">${escapeHtml(data.version || 'Unknown')}</div></div>`
            + `<div class="card"><div class="title">${t('installedVersion')}</div><div class="value">${escapeHtml(data.installed_version || t('noInstalledVersion'))}</div></div>`
            + `<div class="card"><div class="title">${t('localRuleCount')}</div><div class="value">${data.local_rule_count ?? 0}</div></div>`
            + `<div class="card"><div class="title">${t('updateAvailable')}</div><div class="value">${statusValue}</div></div>`
            + `</div>`
            + `<p><strong>${t('feedUrl')}:</strong> ${escapeHtml(data.default_url || '')}</p>`
            + `<p><strong>${t('versionUrl')}:</strong> ${escapeHtml(data.version_url || '')}</p>`);
        $('feedStatus').innerHTML = '';
        $('feedStatus').appendChild(status);
        $('feedStatusPanel').style.display = 'block';
    }

    $('checkFeed').addEventListener('click', async () => {
        showSpinner('checkFeed', true);
        try {
            const data = await api('GET', '/api/ids/feed/status');
            if (data.error) {
                showInlineMessage('error', data.error);
                return;
            }
            loadUpdates();
            if (data.newer) {
                showInlineMessage('success', `${t('newerVersion')}: ${escapeHtml(data.version)} (${t('installedVersion')}: ${escapeHtml(data.installed_version)})`);
            } else if (data.installed_version && data.version === data.installed_version) {
                showInlineMessage('success', `${t('upToDate')} (${t('installedVersion')}: ${escapeHtml(data.installed_version)})`);
            } else if (data.version) {
                showInlineMessage('success', `${t('lastVersion')}: ${escapeHtml(data.version)}`);
            } else {
                showInlineMessage('error', t('feedUnavailable'));
            }
        } catch (e) {
            showInlineMessage('error', e.message || t('feedUnavailable'));
        } finally {
            showSpinner('checkFeed', false);
        }
    });

    $('updateFeed').addEventListener('click', async () => {
        if (!confirm(t('confirm'))) return;
        showSpinner('updateFeed', true);
        try {
            const body = {
                ruleset_url: $('feedUrl').value,
                version_url: $('versionUrl').value
            };
            const data = await api('POST', '/api/ids/feed/update', body);
            if (data.error) {
                showInlineMessage('error', data.error);
            } else {
                showInlineMessage('success', `${t('imported')}: ${data.imported} / ${t('skipped')}: ${data.skipped}`);
                loadUpdates();
                loadRules();
            }
        } catch (e) {
            showInlineMessage('error', e.message || t('error'));
        } finally {
            showSpinner('updateFeed', false);
        }
    });

    $('convertRules').addEventListener('click', async () => {
        showSpinner('convertRules', true);
        try {
            const data = await api('POST', '/api/ids/feed/convert', { rules_text: $('rulesText').value });
            if (data.error) {
                showInlineMessage('error', data.error);
                return;
            }
            const list = data.rules.map(r => `<div class="badge-row" title="${escapeHtml(r.description || '')}">` +
                `<span class="badge ${(r.severity || 'low').toLowerCase()}">${escapeHtml(r.severity)}</span> ` +
                `<strong>${escapeHtml(r.name)}</strong> <code>${escapeHtml(r.signature)}</code>` +
                `</div>`).join('');
            const summary = `<div class="grid cols-3"><div class="card"><div class="title">${t('converted')}</div><div class="value">${data.converted}</div></div>` +
                `<div class="card"><div class="title">${t('skipped')}</div><div class="value">${data.skipped}</div></div>` +
                `<div class="card"><div class="title">${t('rules')}</div><div class="value">Preview top ${data.rules.length}</div></div></div>`;
            $('convertResult').innerHTML = DOMPurify.sanitize(summary + (list || `<p class="empty">${t('noData')}</p>`));
            $('convertResultPanel').style.display = 'block';
        } catch (e) {
            showInlineMessage('error', e.message || t('error'));
        } finally {
            showSpinner('convertRules', false);
        }
    });

    async function loadSchedule() {
        try {
            const data = await api('GET', '/api/ids/feed/schedule');
            if (data.error) return;
            $('scheduleEnabled').value = data.enabled ? '1' : '0';
            $('scheduleInterval').value = data.interval_hours || 24;
            const last = data.last_check ? new Date(data.last_check * 1000).toLocaleString() : 'Never';
            $('scheduleStatus').innerHTML = DOMPurify.sanitize(`<p class="small">Running: ${data.running} | Last check: ${last} | Last imported: ${data.last_imported || 0}</p>`);
        } catch (e) {
            showInlineMessage('error', e.message);
        }
    }

    $('saveSchedule').addEventListener('click', async () => {
        showSpinner('saveSchedule', true);
        try {
            const data = await api('POST', '/api/ids/feed/schedule', {
                enabled: Number($('scheduleEnabled').value) === 1,
                interval_hours: Number($('scheduleInterval').value)
            });
            if (data.error) {
                showInlineMessage('error', data.error);
            } else {
                showInlineMessage('success', 'Schedule saved');
                loadSchedule();
            }
        } catch (e) {
            showInlineMessage('error', e.message || t('error'));
        } finally {
            showSpinner('saveSchedule', false);
        }
    });

    // --- init ---
    $('refreshAll').addEventListener('click', () => {
        const active = $$('.tab[aria-selected="true"]')[0]?.dataset.tab || 'dashboard';
        showTab(active);
    });

    setStatus(true, t('ready'));
    loadDashboard();

    // Auto-refresh alerts if on alerts tab
    setInterval(() => {
        if ($('alertsSection').classList.contains('active')) loadAlerts();
    }, 30000);
})();
