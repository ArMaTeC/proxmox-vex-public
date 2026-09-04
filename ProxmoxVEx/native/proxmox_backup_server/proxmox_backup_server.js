/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        ProxmoxVEx/native/proxmox_backup_server/proxmox_backup_server.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Proxmox Backup Server JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
(async function () {
  let _parentI18n = null;
  try { _parentI18n = window.parent.ProxmoxVExI18n; } catch (e) { }
  function t(key) {
    if (_parentI18n) return _parentI18n.t(key, { ns: 'proxmox_backup_server' });
    return key;
  }
  function tf(key) {
    let s = t(key);
    for (let i = 1; i < arguments.length; i++) {
      s = s.replace('%s', String(arguments[i])).replace('%d', String(arguments[i]));
    }
    return s;
  }
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.getAttribute('data-i18n');
      const translated = t(key);
      if (translated !== key) el.textContent = translated;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-placeholder');
      const translated = t(key);
      if (translated !== key) el.setAttribute('placeholder', translated);
    });
  }

  if (_parentI18n) {
    await _parentI18n.loadPluginNamespaceFull('proxmox_backup_server', '/api/native/proxmox_backup_server/i18n');
  }
  applyI18n();
  if (document.title && document.title.includes('ProxmoxVEx')) {
    document.title = t('title') + ' - ProxmoxVEx';
  }

  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');
  const cache = {};

  function showPanel(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    panels.forEach(p => p.classList.toggle('active', p.id === name));
    const activeTab = document.querySelector('.tab.active');
    const endpoint = activeTab ? activeTab.dataset.endpoint : null;
    if (endpoint && !cache[name]) {
      loadData(name, endpoint);
    }
  }

  function setStatus(name, text, isError) {
    const el = document.getElementById('status-' + name);
    el.textContent = text;
    el.classList.toggle('error', !!isError);
    el.classList.toggle('ok', !isError && !!text);
  }

  function loadData(name, endpoint) {
    setStatus(name, t('loading'), false);
    return fetch(endpoint)
      .then(resp => resp.json().then(data => ({ resp, data })))
      .then(({ resp, data }) => {
        cache[name] = data;
        if (!resp.ok || !data.ok) {
          setStatus(name, tf('error', data.error || data.detail || resp.statusText), true);
          renderEmpty(name, data.error || data.detail || resp.statusText);
        } else {
          setStatus(name, tf('loaded', endpoint), false);
          renderPanel(name, data);
        }
      })
      .catch(err => {
        setStatus(name, tf('request_failed', err.message), true);
        renderEmpty(name, err.message);
      });
  }

  function renderEmpty(name, err) {
    const el = document.getElementById('content-' + name);
    if (!el) return;
    // Render plain-text messages via textContent to avoid innerHTML sinks.
    setMessage(el, 'empty', err || t('no_data'));
  }

  function renderPanel(name, data) {
    if (name === 'overview') renderOverview(data);
    else if (name === 'datastores') renderDatastores(data);
    else if (name === 'snapshots') renderSnapshots(data);
  }

  function getFirst(data, key) {
    if (!data || !Array.isArray(data.data)) return null;
    return data.data[0] || null;
  }

  function formatBytes(bytes, decimals) {
    if (bytes == null || isNaN(bytes)) return '-';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals || 2;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  function formatTime(ts) {
    if (!ts) return '-';
    const d = new Date(ts * 1000);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Helpers to set text/DOM without relying on innerHTML for remote data.
  function clearEl(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function setMessage(el, className, text) {
    clearEl(el);
    const div = document.createElement('div');
    div.className = className;
    div.textContent = text == null ? '' : String(text);
    el.appendChild(div);
  }

  function gauge(title, pct, value, max, colorClass) {
    const safePct = Math.max(0, Math.min(100, pct || 0));
    const cls = colorClass || (safePct > 90 ? 'danger' : safePct > 70 ? 'warning' : 'ok');
    return '<div class="gauge">' +
      '<div class="gauge-title">' + escapeHtml(title) + '</div>' +
      '<div class="gauge-bar"><div class="gauge-fill ' + cls + '" style="width:' + safePct + '%"></div></div>' +
      '<div class="gauge-meta">' + escapeHtml(value || '-') + ' / ' + escapeHtml(max || '-') + ' (' + safePct + '%)</div>' +
      '</div>';
  }

  function kpiCard(label, value, sub) {
    return '<div class="kpi">' +
      '<div class="kpi-label">' + escapeHtml(label) + '</div>' +
      '<div class="kpi-value">' + escapeHtml(value) + '</div>' +
      (sub ? '<div class="kpi-sub">' + escapeHtml(sub) + '</div>' : '') +
      '</div>';
  }

  function table(headers, rows) {
    // Build a table DOM so text cells are inserted as textContent, only
    // pre-sanitized HTML snippets (e.g. usage bars) are set as innerHTML.
    const frag = document.createDocumentFragment();
    const tbl = document.createElement('table');
    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    tbl.appendChild(thead);
    const tbody = document.createElement('tbody');
    if (rows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'empty-cell';
      td.colSpan = headers.length;
      td.textContent = t('no_data');
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      rows.forEach(row => {
        const tr = document.createElement('tr');
        row.forEach(c => {
          const td = document.createElement('td');
          if (c && typeof c === 'object' && c.html != null) {
            td.innerHTML = c.html;
          } else {
            td.textContent = c == null ? '-' : String(c);
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }
    tbl.appendChild(tbody);
    frag.appendChild(tbl);
    return frag;
  }

  function renderOverview(data) {
    const rec = getFirst(data, 'overview') || {};
    const system = rec.system || {};
    const datastores = rec.datastores || [];
    const snapshotsCount = rec.snapshots_count || 0;

    document.getElementById('host-meta').textContent = (rec.host ? rec.host + ' — ' + (rec.url || '') : '');

    const kpis = document.getElementById('overview-kpis');
    kpis.innerHTML =
      kpiCard(t('datastores'), datastores.length, t('configured')) +
      kpiCard(t('snapshots'), snapshotsCount, t('total')) +
      kpiCard(t('version'), system.version || '?', t('pbs_version'));

    const hostInfo = document.getElementById('overview-host');
    let hostHtml = '';
    if (rec.host) hostHtml += '<div class="kv-row"><dt>' + escapeHtml(t('host')) + '</dt><dd>' + escapeHtml(rec.host) + '</dd></div>';
    if (rec.url) hostHtml += '<div class="kv-row"><dt>' + escapeHtml(t('url')) + '</dt><dd>' + escapeHtml(rec.url) + '</dd></div>';
    if (system.version) hostHtml += '<div class="kv-row"><dt>' + escapeHtml(t('version')) + '</dt><dd>' + escapeHtml(system.version) + '</dd></div>';
    if (system.cpu_count != null) hostHtml += '<div class="kv-row"><dt>' + escapeHtml(t('cpu_count')) + '</dt><dd>' + escapeHtml(String(system.cpu_count)) + '</dd></div>';
    if (system.uptime) hostHtml += '<div class="kv-row"><dt>' + escapeHtml(t('uptime')) + '</dt><dd>' + escapeHtml(String(system.uptime)) + ' s</dd></div>';
    if (!hostHtml) hostHtml = '<div class="kv-row"><dt></dt><dd>' + escapeHtml(t('no_data')) + '</dd></div>';
    hostInfo.innerHTML = hostHtml;

    const gauges = document.getElementById('overview-gauges');
    let gaugesHtml = '';
    const mem = system.memory || {};
    if (mem.total) gaugesHtml += gauge(t('memory'), mem.pct, formatBytes(mem.used), formatBytes(mem.total));
    const swap = system.swap || {};
    if (swap.total) gaugesHtml += gauge(t('swap'), swap.pct, formatBytes(swap.used), formatBytes(swap.total));
    const root = system.rootfs || {};
    if (root.total) gaugesHtml += gauge(t('rootfs'), root.pct, formatBytes(root.used), formatBytes(root.total));
    if (!gaugesHtml) gaugesHtml = '<div class="empty">' + escapeHtml(t('no_usage_data')) + '</div>';
    gauges.innerHTML = gaugesHtml;

    const dsRows = datastores.map(ds => [
      ds.store || ds.name || '-',
      ds.path || '-',
      ds.pct != null ? { html: renderUsageBar(ds.pct, formatBytes(ds.used), formatBytes(ds.total)) } : '-',
      ds.count != null ? ds.count : '-',
      ds.last_backup ? formatTime(ds.last_backup) : '-'
    ]);
    const overviewDatastores = document.getElementById('overview-datastores');
    clearEl(overviewDatastores);
    overviewDatastores.appendChild(table(
      [t('store'), t('path'), t('usage'), t('snapshots'), t('last_backup')],
      dsRows
    ));
  }

  function renderUsageBar(pct, used, total) {
    const safePct = Math.max(0, Math.min(100, pct || 0));
    const cls = safePct > 90 ? 'danger' : safePct > 70 ? 'warning' : 'ok';
    return '<div class="usage-bar" title="' + escapeHtml(used + ' / ' + total + ' (' + safePct + '%)') + '">' +
      '<div class="usage-fill ' + cls + '" style="width:' + safePct + '%"></div>' +
      '<span>' + safePct + '%</span>' +
      '</div>';
  }

  function renderDatastores(data) {
    const datastores = (data && Array.isArray(data.data)) ? data.data : [];
    const rows = datastores.map(ds => [
      ds.store || ds.name || '-',
      ds.path || '-',
      ds.total != null ? formatBytes(ds.total) : '-',
      ds.used != null ? formatBytes(ds.used) : '-',
      ds.pct != null ? { html: renderUsageBar(ds.pct, formatBytes(ds.used), formatBytes(ds.total)) } : '-',
      ds.count != null ? ds.count : '-',
      ds.last_backup ? formatTime(ds.last_backup) : '-'
    ]);
    const contentDatastores = document.getElementById('content-datastores');
    clearEl(contentDatastores);
    contentDatastores.appendChild(table(
      [t('store'), t('path'), t('total'), t('used'), t('usage'), t('snapshots'), t('last_backup')],
      rows
    ));
  }

  function renderSnapshots(data) {
    const stores = (data && data.stores) || [];
    const sel = document.getElementById('snapshot-store');
    const contentSnapshots = document.getElementById('content-snapshots');
    clearEl(sel);
    stores.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      sel.appendChild(opt);
    });
    if (sel.options.length) {
      const current = cache._selectedStore || sel.value;
      sel.value = current;
      if (sel.value) loadSnapshotsForStore(sel.value);
    } else {
      setMessage(contentSnapshots, 'empty', t('no_datastores'));
    }
  }

  function loadSnapshotsForStore(store) {
    cache._selectedStore = store;
    const contentSnapshots = document.getElementById('content-snapshots');
    clearEl(contentSnapshots);
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    contentSnapshots.appendChild(spinner);
    contentSnapshots.appendChild(document.createTextNode(' ' + t('loading')));
    fetch('/api/proxmox_backup_server/snapshots?datastore=' + encodeURIComponent(store))
      .then(r => r.json().then(d => ({ r, d })))
      .then(({ r, d }) => {
        if (!r.ok || !d.ok) {
          setMessage(contentSnapshots, 'error-pad', d.error || d.detail || r.statusText);
          return;
        }
        const snaps = (d && Array.isArray(d.data)) ? d.data : [];
        const rows = snaps.map(s => [
          s['backup-id'] || s.backup_id || s.name || '-',
          s['backup-type'] || s.backup_type || '-',
          s['backup-time'] ? formatTime(s['backup-time']) : (s.ctime ? formatTime(s.ctime) : '-'),
          s.size != null ? formatBytes(s.size) : '-'
        ]);
        clearEl(contentSnapshots);
        contentSnapshots.appendChild(table(
          [t('backup_id'), t('backup_type'), t('backup_time'), t('size')],
          rows
        ));
      })
      .catch(err => {
        setMessage(contentSnapshots, 'error-pad', err.message);
      });
  }

  function refreshAll() {
    Object.keys(cache).forEach(k => { if (!k.startsWith('_')) delete cache[k]; });
    const active = document.querySelector('.tab.active');
    if (active) loadData(active.dataset.tab, active.dataset.endpoint);
  }

  document.getElementById('refresh-btn').addEventListener('click', refreshAll);
  document.getElementById('snapshots-refresh').addEventListener('click', function () {
    const sel = document.getElementById('snapshot-store');
    if (sel.value) loadSnapshotsForStore(sel.value);
  });
  document.getElementById('snapshot-store').addEventListener('change', function () {
    loadSnapshotsForStore(this.value);
  });

  tabs.forEach(tab => {
    tab.addEventListener('click', () => showPanel(tab.dataset.tab));
  });

  loadData('overview', '/api/proxmox_backup_server/overview');
})();
