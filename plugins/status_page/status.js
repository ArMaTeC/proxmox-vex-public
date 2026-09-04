/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/status_page/status.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Status JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
(function () {
    'use strict';
    var params = new URLSearchParams(window.location.search);
    var KEY = params.get('key') || '';
    var API = window.location.origin + '/api/public/status-page?key=' + encodeURIComponent(KEY);
    var refreshMs = 30000;

    function fmtBytes(b) {
        if (!b) return '0 B';
        if (b >= 1099511627776) return (b / 1099511627776).toFixed(1) + ' TB';
        if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
        if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
        return (b / 1024).toFixed(0) + ' KB';
    }

    function fmtUptime(s) {
        if (!s) return '-';
        var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
        if (d > 0) return d + 'd ' + h + 'h';
        var m = Math.floor((s % 3600) / 60);
        return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
    }

    function barColor(pct, type) {
        if (pct > 90) return 'var(--red)';
        if (pct > 75) return 'var(--accent)';
        if (type === 'cpu') return 'var(--green)';
        if (type === 'mem') return 'var(--blue)';
        return 'var(--purple)';
    }

    function fmtTime(isoStr) {
        if (!isoStr) return '';
        try {
            var d = new Date(isoStr);
            if (isNaN(d.getTime())) return isoStr;
            return d.toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
        } catch (e) { return isoStr; }
    }

    function fmtDuration(startIso, endIso) {
        if (!startIso || !endIso) return '';
        try {
            var ms = new Date(endIso) - new Date(startIso);
            if (ms < 0 || isNaN(ms)) return '';
            var mins = Math.floor(ms / 60000);
            if (mins < 60) return mins + 'm';
            var hrs = Math.floor(mins / 60);
            var rem = mins % 60;
            if (hrs < 24) return hrs + 'h ' + rem + 'm';
            var days = Math.floor(hrs / 24);
            return days + 'd ' + (hrs % 24) + 'h';
        } catch (e) { return ''; }
    }

    function nowTimeStr() {
        var d = new Date();
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function _stripDangerousNodes(root) {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        var DANGEROUS_TAGS = ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base'];
        DANGEROUS_TAGS.forEach(function (tag) {
            var nodes = root.querySelectorAll(tag);
            for (var i = 0; i < nodes.length; i++) {
                if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
            }
        });
        var all = root.querySelectorAll('*');
        for (var j = 0; j < all.length; j++) {
            var el = all[j];
            for (var k = el.attributes.length - 1; k >= 0; k--) {
                var attr = el.attributes[k];
                var name = (attr.name || '').toLowerCase();
                var val = attr.value || '';
                if (name.indexOf('on') === 0) {
                    el.removeAttribute(attr.name);
                } else if ((name === 'href' || name === 'src' || name === 'action' || name === 'formaction' ||
                    name.indexOf(':href') > 0 || name.indexOf(':src') > 0) &&
                    /^\s*(javascript|data|vbscript):/i.test(val)) {
                    el.removeAttribute(attr.name);
                }
            }
        }
    }
    function setHTMLSafe(el, html) {
        var s = String(html == null ? '' : html);
        var doc = new DOMParser().parseFromString(s, 'text/html');
        _stripDangerousNodes(doc.body);
        el.replaceChildren.apply(el, Array.from(doc.body.childNodes));
    }

    function safeNum(v, max) {
        var n = parseFloat(v);
        if (!isFinite(n) || isNaN(n)) return 0;
        if (n < 0) return 0;
        if (max != null && n > max) return max;
        return n;
    }

    function computeOverallUptime(uptime, clusters) {
        if (!uptime || !clusters || !clusters.length) return null;
        var sum = 0, count = 0;
        for (var i = 0; i < clusters.length; i++) {
            var val = uptime[clusters[i].id];
            if (val != null && !isNaN(val)) {
                sum += parseFloat(val);
                count++;
            }
        }
        return count > 0 ? (sum / count).toFixed(2) : null;
    }

    function uptimeColor(pct) {
        if (pct >= 99) return 'var(--green)';
        if (pct >= 90) return 'var(--accent)';
        return 'var(--red)';
    }

    function renderUptimeBar(cid, days, overallPct) {
        if (!days || !days.length) return '';
        var html = '<div class="uptime-bar-container"><div class="uptime-bar">';
        for (var i = 0; i < days.length; i++) {
            var d = days[i];
            var p = safeNum(d.pct, 100);
            html += '<div class="day-block" title="' + escapeHtml(d.day || '') + ' ' + p.toFixed(1) + '%" style="background:' + uptimeColor(p) + '"></div>';
        }
        html += '</div><div class="uptime-bar-label"><span>30 days</span><span>' + (overallPct != null ? overallPct + '%' : '-') + '</span></div></div>';
        return html;
    }

    function renderGuests(guests) {
        if (!guests || !guests.length) return '';
        var html = '<div class="section" style="margin-top:16px"><div class="section-title">Guests</div><div class="guests-list">';
        html += '<div class="guest-row header"><div class="guest-name">Name</div><div class="guest-metric">Status</div><div class="guest-metric">CPU %</div><div class="guest-metric">RAM %</div><div class="guest-metric">Disk %</div></div>';
        for (var i = 0; i < guests.length; i++) {
            var g = guests[i];
            var dotClass = g.status === 'running' ? 'dot-green' : 'dot-red';
            html += '<div class="guest-row">' +
                '<div class="guest-name"><span class="dot ' + dotClass + '"></span>' + escapeHtml(g.name) + '</div>' +
                '<div class="guest-metric">' + escapeHtml(g.status || '-') + '</div>' +
                '<div class="guest-metric">' + safeNum(g.cpu_percent, 100).toFixed(1) + '</div>' +
                '<div class="guest-metric">' + safeNum(g.mem_percent, 100).toFixed(1) + '</div>' +
                '<div class="guest-metric">' + safeNum(g.disk_percent, 100).toFixed(1) + '</div>' +
                '</div>';
        }
        html += '</div></div>';
        return html;
    }

    async function load() {
        try {
            var r = await fetch(API);
            if (!r.ok) {
                var d = {};
                try { d = await r.json(); } catch (_) { }
                setHTMLSafe(document.getElementById('app'),
                    '<div class="error-box"><h2 style="margin-bottom:8px">' +
                    (r.status === 401 ? 'Unauthorized' : 'Error') + '</h2><p style="color:var(--muted)">' +
                    escapeHtml(d.error || 'Failed to load status') + '</p></div>');
                return;
            }
            var data = await r.json();
            render(data);
            refreshMs = (data.config && data.config.refresh_interval ? data.config.refresh_interval : 30) * 1000;
            document.getElementById('last-updated').textContent = 'Updated at ' + nowTimeStr();
            startCountdown();
        } catch (e) {
            setHTMLSafe(document.getElementById('app'), '<div class="error-box"><h2>Connection Error</h2><p style="color:var(--muted)">Could not reach the server.</p></div>');
        }
    }

    function render(data) {
        var cfg = data.config || {};
        var clusters = data.clusters || [];
        var uptime = data.uptime || {};
        var uptime_history = data.uptime_history || {};
        var incidents = data.incidents || [];
        var components = cfg.components || [];

        if (cfg.theme_color) document.documentElement.style.setProperty('--accent', cfg.theme_color);
        document.title = cfg.page_title || 'System Status';

        var allOnline = clusters.length > 0 && clusters.every(function (c) { return c.status === 'online'; });
        var allOffline = clusters.length > 0 && clusters.every(function (c) { return c.status === 'offline'; });
        var anyNodeDown = clusters.some(function (c) {
            return c.status === 'offline' || (c.nodes || []).some(function (n) { return !n.online; });
        });
        var overallClass = 'overall-ok', overallText = 'All Systems Operational';
        if (allOffline) { overallClass = 'overall-down'; overallText = 'All Systems Down'; }
        else if (anyNodeDown) { overallClass = 'overall-partial'; overallText = 'Partial Outage'; }

        var overallUptimePct = computeOverallUptime(uptime, clusters);

        var html = '';

        if (cfg.maintenance_message) {
            html += '<div class="maintenance-banner">' +
                '<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575L6.457 1.047zM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5zm1 6a1 1 0 1 0-2 0 1 1 0 0 0 2 0z"/></svg>' +
                '<div><strong>Scheduled Maintenance</strong>: ' + escapeHtml(cfg.maintenance_message);
            if (cfg.maintenance_start || cfg.maintenance_end) {
                html += '<div class="maint-times">';
                if (cfg.maintenance_start) html += 'Starts: ' + fmtTime(cfg.maintenance_start);
                if (cfg.maintenance_start && cfg.maintenance_end) html += ' &mdash; ';
                if (cfg.maintenance_end) html += 'Ends: ' + fmtTime(cfg.maintenance_end);
                html += '</div>';
            }
            html += '</div></div>';
        }

        html += '<div class="header">' +
            '<h1>' + escapeHtml(cfg.page_title || 'System Status') + '</h1>' +
            '<div class="header-right"></div>' +
            '</div>';

        html += '<div class="overall-status">' +
            '<div class="overall-badge ' + overallClass + '">' + overallText + '</div>' +
            '<div class="overall-uptime">Uptime ' + computeOverallUptime(uptime, clusters) + '%</div>' +
            '</div>';

        for (var i = 0; i < clusters.length; i++) {
            var c = clusters[i];
            var clusterOnline = c.status === 'online';
            html += '<div class="cluster">';
            html += '<div class="cluster-header"><div class="cluster-header-left"><h2>' + escapeHtml(c.name) + '</h2></div>' +
                '<span class="badge-' + (clusterOnline ? 'ok' : 'down') + '">' + (clusterOnline ? 'online' : 'offline') + '</span></div>';
            html += renderUptimeBar(c.id, uptime_history[c.id], uptime[c.id]);
            html += '<div class="cluster-body">';
            if (c.nodes && c.nodes.length) {
                html += '<div class="section-title">Nodes</div>';
                html += '<div class="nodes-grid">';
                for (var n = 0; n < c.nodes.length; n++) {
                    var node = c.nodes[n];
                    html += '<div class="node-card ' + (node.online ? '' : 'offline') + '">';
                    html += '<div class="node-name"><span class="dot ' + (node.online ? 'dot-green' : 'dot-red') + '"></span>' + escapeHtml(node.name) + '</div>';
                    // _public_status now returns pre-computed percentages, not the
                    // raw PVE fractional cpu / byte memory fields that this page once used.
                    var cpuPct = safeNum(node.cpu_percent, 100);
                    html += '<div class="bar-row"><div class="bar-label">CPU ' + cpuPct.toFixed(1) + '%</div><div class="bar"><div class="bar-fill" style="width:' + cpuPct + '%;background:' + barColor(cpuPct, 'cpu') + '"></div></div></div>';
                    var memPct = safeNum(node.mem_percent, 100);
                    html += '<div class="bar-row"><div class="bar-label">RAM ' + memPct.toFixed(1) + '%</div><div class="bar"><div class="bar-fill" style="width:' + memPct + '%;background:' + barColor(memPct, 'mem') + '"></div></div></div>';
                    var diskPct = safeNum(node.disk_percent, 100);
                    html += '<div class="bar-row"><div class="bar-label">Disk ' + diskPct.toFixed(1) + '% (' + fmtBytes(node.disk_used || 0) + ' / ' + fmtBytes(node.disk_total || 0) + ')</div><div class="bar"><div class="bar-fill" style="width:' + diskPct + '%;background:' + barColor(diskPct, 'disk') + '"></div></div></div>';
                    var netin = node.netin || 0, netout = node.netout || 0;
                    html += '<div class="net-row">NET IN ' + fmtBytes(netin) + '/s &middot; OUT ' + fmtBytes(netout) + '/s</div>';
                    var load = (node.loadavg || []).slice(0, 3);
                    if (load.length) {
                        html += '<div class="load-row">Load ' + load.map(function (v) { return Number(v).toFixed(2); }).join(' / ') + '</div>';
                    }
                    html += '<div class="bar-row" style="font-size:11px;color:var(--muted);margin-top:6px">Uptime ' + fmtUptime(node.uptime) + '</div>';
                    html += '</div>';
                }
                html += '</div>';
            }
            if (c.storage && c.storage.length) {
                html += '<div class="section-title" style="margin-top:16px">Storage</div>';
                html += '<div class="storage-list">';
                for (var s = 0; s < c.storage.length; s++) {
                    var st = c.storage[s];
                    var pct = safeNum(st.total ? (st.used / st.total * 100) : 0, 100);
                    html += '<div class="storage-item"><div class="storage-info">' +
                        '<div class="storage-name">' + escapeHtml(st.name) + '</div>' +
                        '<div class="storage-type">' + (st.total ? fmtBytes(st.total) : '-') + '</div>' +
                        '</div><div style="width:80px;text-align:right">' +
                        '<div style="font-size:12px;font-weight:600;color:' + barColor(pct, 'storage') + '">' + pct.toFixed(1) + '%</div>' +
                        '<div class="bar"><div class="bar-fill" style="width:' + pct + '%;background:' + barColor(pct, 'storage') + '"></div></div>' +
                        '</div></div>';
                }
                html += '</div>';
            }
            html += renderGuests(c.guests);
            html += '</div></div>';
        }

        html += '<div class="components-card"><div class="components-header"><h2>Components</h2></div>';
        for (var ci = 0; ci < components.length; ci++) {
            var comp = components[ci];
            var compClass = comp.status === 'operational' ? 'comp-operational' : 'comp-degraded';
            var compDot = comp.status === 'operational' ? 'dot-green' : 'dot-red';
            html += '<div class="component-row"><span class="component-name">' + escapeHtml(comp.name) + '</span>' +
                '<span class="component-status ' + compClass + '"><span class="dot ' + compDot + '"></span>' + escapeHtml(comp.status || 'operational') + '</span></div>';
        }
        html += '</div>';

        html += renderIncidents(incidents);

        setHTMLSafe(document.getElementById('app'), html);
    }

    function renderIncidents(incidents) {
        var html = '<div class="incidents-section"><div class="incidents-header"><h2>Recent Incidents</h2></div>';

        if (!incidents || incidents.length === 0) {
            html += '<div class="incidents-empty">No recent incidents &mdash; all clear.</div>';
        } else {
            for (var i = 0; i < incidents.length; i++) {
                var inc = incidents[i];
                var statusClass = 'incident-investigating';
                if (inc.status === 'identified') statusClass = 'incident-identified';
                else if (inc.status === 'monitoring') statusClass = 'incident-monitoring';
                else if (inc.status === 'resolved') statusClass = 'incident-resolved';

                var sevClass = 'severity-minor';
                if (inc.severity === 'critical') sevClass = 'severity-critical';
                else if (inc.severity === 'major') sevClass = 'severity-major';

                html += '<div class="incident">' +
                    '<div class="incident-top">' +
                    '<span class="incident-title">' + escapeHtml(inc.title) + '</span>' +
                    '<span class="incident-badge ' + statusClass + '">' + escapeHtml(inc.status || 'unknown') + '</span>' +
                    '<span class="incident-badge ' + sevClass + '">' + escapeHtml(inc.severity || 'minor') + '</span>' +
                    '</div>';
                if (inc.message) {
                    html += '<div class="incident-message">' + escapeHtml(inc.message) + '</div>';
                }
                html += '<div class="incident-meta">';
                if (inc.started_at) {
                    html += '<span>Started: ' + fmtTime(inc.started_at) + '</span>';
                }
                if (inc.resolved_at) {
                    html += '<span>Resolved: ' + fmtTime(inc.resolved_at) + '</span>';
                    if (inc.started_at) {
                        var dur = fmtDuration(inc.started_at, inc.resolved_at);
                        if (dur) html += '<span>Duration: ' + dur + '</span>';
                    }
                }
                html += '</div></div>';
            }
        }

        html += '</div>';
        return html;
    }

    var countdownTimer = null;
    function startCountdown() {
        var remaining = Math.floor(refreshMs / 1000);
        var el = document.getElementById('countdown');
        var elInline = document.getElementById('countdown-inline');
        if (countdownTimer) clearInterval(countdownTimer);

        function update() {
            var txt = 'Refresh in ' + remaining + 's';
            if (el) el.textContent = txt;
            if (elInline) elInline.textContent = txt;
        }
        update();

        countdownTimer = setInterval(function () {
            remaining--;
            if (remaining >= 0) update();
            if (remaining <= 0) {
                clearInterval(countdownTimer);
                load();
            }
        }, 1000);
    }

    if (!KEY) {
        setHTMLSafe(document.getElementById('app'), '<div class="error-box"><h2>Missing Auth Key</h2><p style="color:var(--muted)">Add <code>?key=your_auth_key</code> to the URL.</p></div>');
    } else {
        load();
    }
})();
