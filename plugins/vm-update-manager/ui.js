/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        plugins/vm-update-manager/ui.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Ui JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var clusterParam = (params.get('cluster') || '').trim();

  var i18n = window.parent && window.parent.ProxmoxVExI18n;
  var fallbackTranslations = null;

  function loadFallbackTranslations() {
    return fetch(I18N_API + '/en.json?v=' + Date.now(), { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('i18n fetch failed');
        return r.json();
      })
      .then(function (dict) {
        fallbackTranslations = dict || {};
        return fallbackTranslations;
      })
      .catch(function (err) {
        console.warn('[vm-update] fallback i18n load failed:', err);
        fallbackTranslations = {};
      });
  }

  function fallbackT(key, opts) {
    if (key == null) return '';
    var s = (fallbackTranslations || {})[key];
    if (typeof s !== 'string') return String(key);
    if (opts && opts.params) {
      var params = opts.params;
      s = s.replace(/\{(\w+)\}/g, function (_, k) { return params[k] !== undefined ? params[k] : ''; });
    }
    return s;
  }

  var t = i18n && i18n.getT ? i18n.getT('vm_update') : fallbackT;

  // Translate all static data-i18n and data-i18n-placeholder attributes that
  // are baked into ui.html. Dynamic strings rendered later call t() directly.
  function translateStaticElements() {
    if (!t) return;
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (!key) return;
      var translated = t(key);
      // Replace only the first text node so nested elements (e.g. caret spans)
      // are preserved. Keep any trailing whitespace that separated text from
      // adjacent inline elements.
      var textNode = Array.prototype.find.call(el.childNodes, function (n) { return n.nodeType === Node.TEXT_NODE; });
      if (textNode) {
        var trailing = (textNode.textContent.match(/\s+$/) || [''])[0];
        textNode.textContent = translated + trailing;
      } else {
        el.textContent = translated;
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = t(key);
    });
  }

  var PLUGIN_API = '/api/plugins/vm-update-manager/api';
  var I18N_API = '/api/plugins/vm-update-manager/i18n';
  var CORE_API = '/api';

  var state = {
    guests: [],
    clusters: [],
    selectedJob: null,
    runningGuestIds: {},
    sort: { key: 'name', dir: 'asc' },
    selectedGuestIds: {},
    packagesGuestId: null,
    packagesCount: 0,
    loadingGuests: false,
    searchTimeout: null,
  };

  function setGuestRunning(id, running) {
    if (running) {
      state.runningGuestIds[id] = true;
    } else {
      delete state.runningGuestIds[id];
    }
    renderList();
  }

  function isGuestRunning(g) {
    return !!state.runningGuestIds[g.id] || g.last_status === 'running' || g.last_status === 'pending';
  }

  // Lightweight, theme-aware confirmation modal used before destructive/impactful
  // actions (Apply Now, Delete), since native window.confirm() cannot be styled
  // to match the plugin and is inconsistently rendered inside sandboxed iframes.
  // Built with DOM APIs instead of innerHTML so the modal structure is never at
  // the mercy of an HTML sanitizer's parsing context.
  function confirmAction(message) {
    return new Promise(function (resolve) {
      var previousActiveElement = document.activeElement;
      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay';

      var modal = document.createElement('div');
      modal.className = 'modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', t('confirm'));

      var msg = document.createElement('p');
      msg.id = 'vm-update-modal-message';
      msg.className = 'modal-message';
      msg.textContent = message;
      modal.setAttribute('aria-describedby', msg.id);

      var actions = document.createElement('div');
      actions.className = 'modal-actions';

      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn secondary modal-cancel';
      cancelBtn.textContent = t('cancel');

      var confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'btn modal-confirm';
      confirmBtn.textContent = t('confirm');

      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);

      // Hard-code the modal and button colours so the dialog remains visible
      // even when parent theme CSS variables resolve to transparent or undefined.
      modal.style.setProperty('background-color', '#161b22', 'important');
      modal.style.setProperty('color', '#c9d1d9', 'important');
      modal.style.setProperty('border', '1px solid #30363d', 'important');
      confirmBtn.style.setProperty('background-color', '#ff6b35', 'important');
      confirmBtn.style.setProperty('color', '#fff', 'important');
      confirmBtn.style.setProperty('border', '1px solid #ff6b35', 'important');
      cancelBtn.style.setProperty('background-color', 'transparent', 'important');
      cancelBtn.style.setProperty('color', '#c9d1d9', 'important');
      cancelBtn.style.setProperty('border', '1px solid #30363d', 'important');

      modal.appendChild(msg);
      modal.appendChild(actions);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      // Prevent background scrolling while the modal is open.
      var bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      function getFocusable() {
        return Array.prototype.slice.call(
          modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        ).filter(function (el) { return !el.disabled && el.offsetWidth > 0 && el.offsetHeight > 0; });
      }
      function cleanup(result) {
        document.body.style.overflow = bodyOverflow;
        document.body.removeChild(overlay);
        document.removeEventListener('keydown', onKey);
        if (previousActiveElement && previousActiveElement.focus) {
          try { previousActiveElement.focus(); } catch (e) { }
        }
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup(false);
          return;
        }
        if (e.key === 'Tab') {
          var focusable = getFocusable();
          if (focusable.length < 2) return;
          var current = document.activeElement;
          var idx = focusable.indexOf(current);
          if (e.shiftKey) {
            if (idx <= 0) {
              e.preventDefault();
              focusable[focusable.length - 1].focus();
            }
          } else {
            if (idx === focusable.length - 1 || idx === -1) {
              e.preventDefault();
              focusable[0].focus();
            }
          }
        }
      }
      cancelBtn.addEventListener('click', function () { cleanup(false); });
      confirmBtn.addEventListener('click', function () { cleanup(true); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) cleanup(false); });
      document.addEventListener('keydown', onKey);
      confirmBtn.focus();
    });
  }

  function $(id) { return document.getElementById(id); }

  function setStatus(msg, type) {
    var el = $('statusMsg');
    el.textContent = msg || '';
    el.className = 'status ' + (type || '');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setTbodyHtml(tbody, html) {
    // DOMPurify parses markup in a <div> by default, but <tr> and <td> are
    // only valid inside a <table> context. Without a table wrapper, browsers
    // strip the row/cell tags and the data is rendered as a single block of
    // text. Wrapping the rows before sanitizing keeps the table structure.
    var clean = DOMPurify.sanitize('<table>' + html + '</table>', { RETURN_DOM: true });
    var table = clean.querySelector ? clean.querySelector('table') : null;
    var source = table && table.tBodies[0] ? table.tBodies[0] : null;
    if (source) {
      tbody.innerHTML = source.innerHTML;
    } else {
      tbody.innerHTML = '';
    }
  }

  function formatWhen(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString();
  }

  function applyTheme() {
    var parent = window.parent;
    var themeName = 'proxmoxDark';
    if (parent && parent.localStorage) {
      try { themeName = parent.localStorage.getItem('ProxmoxVEx-theme') || themeName; } catch (e) { }
    }
    var raw = params.get('theme');
    if (raw && raw !== 'undefined') themeName = raw;

    var root = document.documentElement;
    var parentStyle = null;
    try {
      if (parent && parent.document && parent.document.documentElement) {
        parentStyle = parent.getComputedStyle(parent.document.documentElement);
      }
    } catch (e) { }

    // Parent CSS may define theme colours as var(--...); the iframe cannot
    // resolve those references, so treat them as missing and use our fallback.
    // Also reject transparent/none because they would make the modal invisible.
    function isValidColor(v) {
      if (!v || typeof v !== 'string') return false;
      var s = v.trim().toLowerCase();
      return s && !s.startsWith('var(') && !s.startsWith('calc(') && s !== 'transparent' && s !== 'none';
    }
    function getColor(key, fallback) {
      if (!parentStyle) return fallback;
      var v = parentStyle.getPropertyValue('--color-' + key).trim();
      return isValidColor(v) ? v : fallback;
    }

    root.style.setProperty('--accent', getColor('primary', '#ff6b35'));
    root.style.setProperty('--bg', getColor('dark', '#0d1117'));
    root.style.setProperty('--card', getColor('card', '#161b22'));
    root.style.setProperty('--border', getColor('border', '#30363d'));
    root.style.setProperty('--text', getColor('text', '#c9d1d9'));
    root.style.setProperty('--muted', getColor('textMuted', '#8b949e'));
    root.style.setProperty('--ok', getColor('success', '#3fb950'));
    root.style.setProperty('--error', getColor('error', '#f85149'));
    root.style.setProperty('--warning', getColor('warning', '#f0883e'));
    root.style.setProperty('--info', getColor('info', '#58a6ff'));
    root.style.setProperty('--hover', getColor('hover', '#21262d'));

    var themes = parent && parent.ProxmoxVEx_THEMES;
    if (themes && themes[themeName] && themes[themeName].colors) {
      var colors = themes[themeName].colors;
      root.style.setProperty('--accent', isValidColor(colors.primary) ? colors.primary : getColor('primary', '#ff6b35'));
      root.style.setProperty('--bg', isValidColor(colors.dark) ? colors.dark : getColor('dark', '#0d1117'));
      root.style.setProperty('--card', isValidColor(colors.card) ? colors.card : getColor('card', '#161b22'));
      root.style.setProperty('--border', isValidColor(colors.border) ? colors.border : getColor('border', '#30363d'));
      root.style.setProperty('--text', isValidColor(colors.text) ? colors.text : getColor('text', '#c9d1d9'));
      root.style.setProperty('--muted', isValidColor(colors.textMuted) ? colors.textMuted : getColor('textMuted', '#8b949e'));
      root.style.setProperty('--ok', isValidColor(colors.success) ? colors.success : getColor('success', '#3fb950'));
      root.style.setProperty('--error', isValidColor(colors.error) ? colors.error : getColor('error', '#f85149'));
      root.style.setProperty('--warning', isValidColor(colors.warning) ? colors.warning : getColor('warning', '#f0883e'));
      root.style.setProperty('--info', isValidColor(colors.info) ? colors.info : getColor('info', '#58a6ff'));
      root.style.setProperty('--hover', isValidColor(colors.hover) ? colors.hover : getColor('hover', '#21262d'));
    }
    document.body.dataset.theme = themeName;
  }

  function watchTheme() {
    var parent = window.parent;
    if (!parent || !parent.document) return;
    try {
      var parentRoot = parent.document.documentElement;
      var observer = new MutationObserver(function () { applyTheme(); });
      observer.observe(parentRoot, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    } catch (e) { }
    try {
      window.addEventListener('storage', function () { applyTheme(); });
    } catch (e) { }
    try {
      window.addEventListener('message', function (event) {
        // Reject cross-origin postMessages before acting on event data.
        if (event.origin !== window.location.origin) return;
        if (event.data && typeof event.data === 'object' && event.data.type === 'theme') applyTheme();
      });
    } catch (e) { }
  }

  function parseApiResponse(resp, text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // Backend sometimes returns plain text/HTML on unexpected errors.
      // Surface a readable error instead of a JSON parse exception.
      data = { error: (text || resp.statusText || 'Request failed').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
    }
    if (!resp.ok) throw new Error(data.error || resp.statusText);
    return data;
  }

  function api(method, path, body) {
    var opts = { method: method, credentials: 'same-origin' };
    if (body && (method === 'POST' || method === 'PUT')) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    return fetch(PLUGIN_API + '/' + path, opts)
      .then(function (resp) {
        return resp.text().then(function (text) { return parseApiResponse(resp, text); });
      })
      .catch(function (err) {
        if (err && err.name === 'TypeError') throw new Error(t('networkError'));
        throw err;
      });
  }

  function coreApi(method, path) {
    return fetch(CORE_API + path, { method: method, credentials: 'same-origin' })
      .then(function (resp) {
        return resp.text().then(function (text) { return parseApiResponse(resp, text); });
      })
      .catch(function (err) {
        if (err && err.name === 'TypeError') throw new Error(t('networkError'));
        throw err;
      });
  }

  function guestName(id) {
    var g = state.guests.find(function (x) { return x.id === id; });
    return g ? g.name : '#' + id;
  }

  async function loadClusters() {
    var sel = $('cluster');
    sel.disabled = true;
    try {
      state.clusters = await coreApi('GET', '/clusters');
      sel.innerHTML = DOMPurify.sanitize('<option value="">' + t('selectCluster') + '</option>');
      state.clusters.forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = (c.display_name || c.name || c.id);
        sel.appendChild(opt);
      });
      sel.disabled = false;
      if (clusterParam) {
        sel.value = clusterParam;
      }
    } catch (err) {
      setStatus(t('noClusters') + ': ' + err.message, 'error');
    }
  }

  async function loadVms(clusterId, selectedVmid) {
    if (!clusterId) {
      $('vmid').innerHTML = DOMPurify.sanitize('<option value="">' + t('selectVm') + '</option>');
      $('vmid').disabled = true;
      return;
    }
    var sel = $('vmid');
    sel.disabled = true;
    try {
      var data = await api('GET', 'guests/vm-list?cluster_id=' + encodeURIComponent(clusterId));
      var vms = data.vms || [];
      sel.innerHTML = DOMPurify.sanitize('<option value="">' + t('selectVm') + '</option>');
      vms.forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = v.vmid;
        opt.textContent = (v.name || 'VM ' + v.vmid) + ' (' + v.vmid + ')';
        opt.dataset.type = v.type === 'lxc' ? 'lxc' : 'vm';
        opt.dataset.node = v.node || '';
        opt.dataset.ip = v.ip || '';
        sel.appendChild(opt);
      });
      if (selectedVmid) {
        if (!sel.querySelector('option[value="' + selectedVmid + '"]')) {
          var g = state.guests.find(function (x) { return x.vmid == selectedVmid; });
          var fallback = document.createElement('option');
          fallback.value = selectedVmid;
          fallback.textContent = (g ? g.name : t('unknown')) + ' (' + selectedVmid + ')';
          fallback.dataset.type = g ? g.guest_type : 'vm';
          sel.appendChild(fallback);
        }
        sel.value = selectedVmid;
      }
      sel.disabled = false;
    } catch (err) {
      setStatus(t('vmListError') + ': ' + err.message, 'error');
      $('vmid').innerHTML = DOMPurify.sanitize('<option value="">' + t('noVms') + '</option>');
    }
  }

  function onClusterChange() {
    var cid = $('cluster').value;
    loadVms(cid, null);
  }

  function onVmidChange() {
    var sel = $('vmid');
    var opt = sel.options[sel.selectedIndex];
    if (opt && opt.value && opt.dataset.type) {
      $('guestType').value = opt.dataset.type;
      if (!$('name').value && opt.textContent) {
        $('name').value = opt.textContent.split(' (')[0];
      }
      if (opt.dataset.ip) {
        $('ipHost').value = opt.dataset.ip;
      }
    }
  }

  function statusClass(s) {
    s = (s || '').toLowerCase();
    if (s === 'completed' || s === 'reachable' || s === 'ok') return 'ok';
    if (s === 'failed' || s === 'unreachable' || s === 'error') return 'error';
    if (s === 'running' || s === 'pending') return 'warning';
    return '';
  }

  function renderGuest(g) {
    var running = isGuestRunning(g);
    var disabled = running ? ' disabled' : '';
    var checked = state.selectedGuestIds[g.id] ? ' checked' : '';
    var statusClassName = statusClass(g.last_status);
    var statusIcon = { ok: '\u2713 ', error: '\u2717 ', warning: '\u25CF ' }[statusClassName] || '';
    var statusText = g.last_status || (g.last_check_at ? t('unknown') : t('filterNever'));
    var selectedClass = state.selectedGuestIds[g.id] ? ' selected' : '';
    var typeClass = 'badge-' + (g.guest_type === 'lxc' ? 'lxc' : (g.os_family === 'windows' ? 'windows' : 'vm'));
    return (
      '<tr data-id="' + g.id + '" class="' + (running ? 'row-running' : '') + selectedClass + '">' +
      '  <td><input type="checkbox" class="select-guest" data-id="' + g.id + '"' + checked + disabled + ' aria-label="' + escapeHtml(t('name')) + ' ' + escapeHtml(g.name) + '"></td>' +
      '  <td>' + escapeHtml(g.name) + (running ? ' <span class="spinner" role="status" aria-label="' + escapeHtml(t('running')) + '"></span>' : '') + '</td>' +
      '  <td><span class="badge ' + typeClass + '">' + escapeHtml(g.guest_type) + '</span> ' + escapeHtml(String(g.vmid)) + '</td>' +
      '  <td>' + escapeHtml(g.ip_host) + '</td>' +
      '  <td>' + escapeHtml(g.os_family) + '</td>' +
      '  <td>' + escapeHtml(g.username || '') + '</td>' +
      '  <td class="' + (g.enabled ? 'status-yes' : 'status-no') + '">' + (g.enabled ? t('yes') : t('no')) + '</td>' +
      '  <td class="' + (g.schedule_enabled ? 'status-yes' : 'status-no') + '">' + (g.schedule_enabled ? t('yes') : t('no')) + '</td>' +
      '  <td title="' + escapeHtml(formatWhen(g.last_check_at)) + '">' + escapeHtml(formatWhen(g.last_check_at)) + '</td>' +
      '  <td class="status ' + statusClassName + '" title="' + escapeHtml(statusText) + '">' + statusIcon + escapeHtml(statusText) + '</td>' +
      '  <td title="' + escapeHtml(formatWhen(g.next_run)) + '">' + escapeHtml(formatWhen(g.next_run)) + '</td>' +
      '  <td>' +
      '    <span class="row-actions">' +
      '      <button class="btn small check" data-id="' + g.id + '"' + disabled + ' aria-label="' + escapeHtml(t('checkNow')) + ' ' + escapeHtml(g.name) + '" title="' + escapeHtml(t('checkNow')) + '">' + t('checkNow') + '</button>' +
      '      <button class="btn small apply" data-id="' + g.id + '"' + disabled + ' aria-label="' + escapeHtml(t('applyNow')) + ' ' + escapeHtml(g.name) + '" title="' + escapeHtml(t('applyNow')) + '">' + t('applyNow') + '</button>' +
      '      <details class="action-menu" data-id="' + g.id + '">' +
      '        <summary class="btn small secondary" aria-label="' + escapeHtml(t('actions')) + '" title="' + escapeHtml(t('actions')) + '">' + escapeHtml(t('actions')) + ' <span class="caret">&#9662;</span></summary>' +
      '        <div class="action-menu-content">' +
      '          <button class="btn small preview" data-id="' + g.id + '"' + disabled + ' aria-label="' + escapeHtml(t('preview')) + ' ' + escapeHtml(g.name) + '" title="' + escapeHtml(t('preview')) + '">' + t('preview') + '</button>' +
      '          <button class="btn small test" data-id="' + g.id + '"' + disabled + ' aria-label="' + escapeHtml(t('testConnection')) + ' ' + escapeHtml(g.name) + '" title="' + escapeHtml(t('testConnection')) + '">' + t('testConnection') + '</button>' +
      '          <button class="btn small edit" data-id="' + g.id + '"' + disabled + ' aria-label="' + escapeHtml(t('edit')) + ' ' + escapeHtml(g.name) + '" title="' + escapeHtml(t('edit')) + '">' + t('edit') + '</button>' +
      '          <button class="btn small delete" data-id="' + g.id + '"' + disabled + ' aria-label="' + escapeHtml(t('delete')) + ' ' + escapeHtml(g.name) + '" title="' + escapeHtml(t('delete')) + '">' + t('delete') + '</button>' +
      '        </div>' +
      '      </details>' +
      '    </span>' +
      '  </td>' +
      '</tr>'
    );
  }

  function guestStatusBucket(g) {
    if (isGuestRunning(g)) return 'running';
    if (!g.last_check_at) return 'never';
    return statusClass(g.last_status) === 'error' ? 'error' : (statusClass(g.last_status) === 'ok' ? 'ok' : 'never');
  }

  function getFilteredSortedGuests() {
    var filter = ($('searchGuests').value || '').toLowerCase().trim();
    var statusFilter = $('filterStatus').value;
    var osFilter = $('filterOsFamily').value;
    var guests = state.guests.slice();
    if (filter) {
      guests = guests.filter(function (g) {
        return (g.name || '').toLowerCase().indexOf(filter) >= 0 ||
          (g.ip_host || '').toLowerCase().indexOf(filter) >= 0 ||
          (g.vmid + '').indexOf(filter) >= 0 ||
          (g.os_family || '').toLowerCase().indexOf(filter) >= 0 ||
          (g.username || '').toLowerCase().indexOf(filter) >= 0 ||
          (g.cluster_id || '').toLowerCase().indexOf(filter) >= 0;
      });
    }
    if (statusFilter) {
      guests = guests.filter(function (g) { return guestStatusBucket(g) === statusFilter; });
    }
    if (osFilter) {
      guests = guests.filter(function (g) { return (g.os_family || 'unknown') === osFilter; });
    }
    var key = state.sort.key;
    var dir = state.sort.dir === 'desc' ? -1 : 1;
    guests.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (av == null) av = '';
      if (bv == null) bv = '';
      var result = 0;
      if (typeof av === 'boolean' && typeof bv === 'boolean') {
        result = av === bv ? 0 : (av ? -1 : 1);
      } else if (key === 'vmid' || (typeof av === 'number' && typeof bv === 'number')) {
        result = av - bv;
      } else if (typeof av === 'string' && typeof bv === 'string') {
        result = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      } else {
        if (av < bv) result = -1;
        if (av > bv) result = 1;
      }
      return result * dir;
    });
    return guests;
  }

  function updateSortIndicators() {
    document.querySelectorAll('.guest-table th[data-sort]').forEach(function (th) {
      th.classList.remove('sort-asc', 'sort-desc');
      th.removeAttribute('aria-sort');
      if (th.dataset.sort === state.sort.key) {
        var isDesc = state.sort.dir === 'desc';
        th.classList.add(isDesc ? 'sort-desc' : 'sort-asc');
        th.setAttribute('aria-sort', isDesc ? 'descending' : 'ascending');
      }
    });
  }

  function updateBulkButtonState() {
    var count = Object.keys(state.selectedGuestIds).length;
    var checkBtn = $('checkSelected');
    checkBtn.disabled = count === 0;
    checkBtn.textContent = count > 0 ? t('checkSelected') + ' (' + count + ')' : t('checkSelected');
    var applyBtn = $('applySelected');
    applyBtn.disabled = count === 0;
    applyBtn.textContent = count > 0 ? t('applySelected') + ' (' + count + ')' : t('applySelected');
  }

  function updateSelectAllState() {
    var allBox = $('selectAllGuests');
    if (!allBox) return;
    var visible = getFilteredSortedGuests();
    var visibleIds = visible.map(function (g) { return g.id; });
    var selectedVisible = visibleIds.filter(function (id) { return state.selectedGuestIds[id]; });
    if (selectedVisible.length === 0) {
      allBox.checked = false;
      allBox.indeterminate = false;
    } else if (selectedVisible.length === visibleIds.length) {
      allBox.checked = true;
      allBox.indeterminate = false;
    } else {
      allBox.checked = false;
      allBox.indeterminate = true;
    }
  }

  function renderList() {
    var tbody = $('guestsBody');
    var guests = getFilteredSortedGuests();
    var hasFilter = ($('searchGuests').value || '').trim() || $('filterStatus').value || $('filterOsFamily').value;
    var countEl = $('guestCount');
    if (countEl) {
      countEl.textContent = guests.length === state.guests.length
        ? (guests.length + ' ' + t('guests'))
        : (guests.length + ' / ' + state.guests.length + ' ' + t('guests'));
    }
    updateSortIndicators();
    updateBulkButtonState();
    updateSelectAllState();
    if (state.loadingGuests) {
      setTbodyHtml(tbody, '<tr><td colspan="12" class="status">' + escapeHtml(t('loading')) + '</td></tr>');
      return;
    }
    if (!guests.length) {
      var emptyMsg = hasFilter ? t('noGuestsFilter') : t('noGuests');
      setTbodyHtml(tbody, '<tr><td colspan="12" class="status">' + escapeHtml(emptyMsg) + '</td></tr>');
      return;
    }
    setTbodyHtml(tbody, guests.map(renderGuest).join(''));
    tbody.querySelectorAll('input.select-guest').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = Number(cb.dataset.id);
        if (cb.checked) {
          state.selectedGuestIds[id] = true;
        } else {
          delete state.selectedGuestIds[id];
        }
        updateBulkButtonState();
        updateSelectAllState();
      });
    });
    tbody.querySelectorAll('button.check').forEach(function (b) {
      b.addEventListener('click', function () { checkGuest(Number(b.dataset.id)); });
    });
    tbody.querySelectorAll('button.apply').forEach(function (b) {
      b.addEventListener('click', function () { applyGuest(Number(b.dataset.id)); });
    });
    tbody.querySelectorAll('button.preview').forEach(function (b) {
      b.addEventListener('click', function () { previewGuest(Number(b.dataset.id)); });
    });
    tbody.querySelectorAll('button.test').forEach(function (b) {
      b.addEventListener('click', function () { testConnection(Number(b.dataset.id)); });
    });
    tbody.querySelectorAll('button.edit').forEach(function (b) {
      b.addEventListener('click', function () { editGuest(Number(b.dataset.id)); });
    });
    tbody.querySelectorAll('button.delete').forEach(function (b) {
      b.addEventListener('click', function () { deleteGuest(Number(b.dataset.id)); });
    });
  }

  async function bulkCheckSelected() {
    var ids = Object.keys(state.selectedGuestIds).map(Number);
    if (!ids.length) return;
    var queued = [];
    var skipped = [];
    ids.forEach(function (id) {
      if (state.runningGuestIds[id]) {
        skipped.push(id);
      } else {
        queued.push(id);
      }
    });
    setStatus(t('checking') + ' (' + queued.length + '/' + ids.length + ')', 'info');
    await Promise.all(queued.map(function (id) { return checkGuest(id); }));
    state.selectedGuestIds = {};
    updateBulkButtonState();
    renderList();
    var summary = t('bulkQueued', { params: { queued: queued.length } });
    if (skipped.length) {
      summary += ' ' + t('bulkSkipped', { params: { skipped: skipped.length } });
    }
    setStatus(summary, 'ok');
  }

  async function loadGuests() {
    state.loadingGuests = true;
    renderList();
    try {
      state.guests = await api('GET', 'guests');
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      state.loadingGuests = false;
      renderList();
    }
  }

  function formatDuration(startedAt, completedAt) {
    if (!startedAt || !completedAt) return '-';
    var start = new Date(startedAt);
    var end = new Date(completedAt);
    if (isNaN(start) || isNaN(end)) return '-';
    var ms = end - start;
    if (ms < 0) return '-';
    var totalSec = Math.round(ms / 1000);
    var mins = Math.floor(totalSec / 60);
    var secs = totalSec % 60;
    return mins > 0 ? (mins + 'm ' + secs + 's') : (secs + 's');
  }

  var seenFailedJobIds = {};
  var jobsLoadedOnce = false;

  // Notify the parent dashboard (toast) when a scheduled job for a guest with
  // notify_on_failure fails, so the failure is visible even if the user isn't
  // currently looking at this plugin's console. Best-effort: falls back to
  // the in-plugin status line if the parent has no listener.
  function notifyIfNewFailure(rows) {
    var firstLoad = !jobsLoadedOnce;
    jobsLoadedOnce = true;
    rows.forEach(function (j) {
      if (j.status !== 'failed' || seenFailedJobIds[j.id]) return;
      seenFailedJobIds[j.id] = true;
      // Don't retroactively notify for failures that already existed before
      // this session started polling (would spam a toast per historical row).
      if (firstLoad) return;
      var g = state.guests.find(function (x) { return x.id === j.guest_id; });
      if (!g || !g.notify_on_failure) return;
      var message = t('jobFailedNotification', { params: { name: g.name, jobType: j.job_type } });
      try {
        window.parent.postMessage({ type: 'vm-update-notification', level: 'error', message: message }, window.location.origin);
      } catch (e) { /* cross-origin/parent unavailable; ignore, in-plugin status still shown below */ }
    });
  }

  async function loadJobs() {
    var rows = await api('GET', 'jobs?limit=20');
    state.lastJobRows = rows;
    notifyIfNewFailure(rows);
    var tbody = $('jobsBody');
    if (!rows.length) {
      setTbodyHtml(tbody, '<tr><td colspan="7" class="status">' + t('noChecks') + '</td></tr>');
      return;
    }
    setTbodyHtml(tbody, rows.map(function (j) {
      var cls = j.id === state.selectedJob ? 'selected' : '';
      return (
        '<tr data-id="' + j.id + '" class="' + cls + '" tabindex="0" role="button">' +
        '  <td>' + escapeHtml(guestName(j.guest_id)) + '</td>' +
        '  <td>' + escapeHtml(j.job_type) + '</td>' +
        '  <td class="status ' + statusClass(j.status) + '">' + escapeHtml(j.status) + '</td>' +
        '  <td>' + (j.packages_found || 0) + '</td>' +
        '  <td>' + (j.packages_applied || 0) + '</td>' +
        '  <td>' + escapeHtml(formatWhen(j.started_at)) + '</td>' +
        '  <td>' + escapeHtml(formatDuration(j.started_at, j.completed_at)) + '</td>' +
        '</tr>'
      );
    }).join(''));
    tbody.querySelectorAll('tr').forEach(function (r) {
      r.addEventListener('click', function () { showJob(Number(r.dataset.id), rows); });
      r.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showJob(Number(r.dataset.id), rows);
        }
      });
    });
  }

  function showPackageList(rows, guestId) {
    var panel = $('packagesPanel');
    var tbody = $('packagesBody');
    var title = $('packagesTitle');
    var previewBtn = $('packagesPreview');
    var applyBtn = $('packagesApply');
    panel.classList.remove('hidden');
    state.packagesGuestId = guestId;
    state.packagesCount = (rows || []).length;
    var g = state.guests.find(function (x) { return x.id === guestId; }) || { id: guestId, name: '#' + guestId };
    var running = isGuestRunning(g);
    title.textContent = t('packagesFor', { params: { name: g.name, count: state.packagesCount } });
    previewBtn.textContent = t('previewUpdates', { params: { count: state.packagesCount } });
    applyBtn.textContent = t('applyUpdates', { params: { count: state.packagesCount } });
    previewBtn.disabled = running || state.packagesCount === 0;
    applyBtn.disabled = running || state.packagesCount === 0;
    if (!rows || !rows.length) {
      setTbodyHtml(tbody, '<tr><td colspan="4" class="status">' + t('noPackages') + '</td></tr>');
      return;
    }
    setTbodyHtml(tbody, rows.map(function (p) {
      return (
        '<tr>' +
        '  <td>' + escapeHtml(p.name) + '</td>' +
        '  <td>' + escapeHtml(p.current_version) + '</td>' +
        '  <td>' + escapeHtml(p.available_version) + '</td>' +
        '  <td>' + (p.is_security ? '<span class="security-badge">' + escapeHtml(t('security')) + '</span>' : '') + '</td>' +
        '</tr>'
      );
    }).join(''));
  }

  function formatTimestamp(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString() + ' ';
  }

  var CONSOLE_SCROLL_THRESHOLD = 24;

  // Consulted before any forced scroll so a user reading earlier output isn't
  // yanked back to the bottom while a job is still streaming.
  function isConsoleNearBottom() {
    var body = $('consoleBody');
    return body.scrollTop + body.clientHeight >= body.scrollHeight - CONSOLE_SCROLL_THRESHOLD;
  }

  function scrollConsoleToBottom() {
    var body = $('consoleBody');
    body.scrollTop = body.scrollHeight;
    $('jumpToBottom').classList.add('hidden');
  }

  function maybeAutoScrollConsole() {
    if (isConsoleNearBottom()) {
      scrollConsoleToBottom();
    } else {
      $('jumpToBottom').classList.remove('hidden');
    }
  }

  function clearConsole() {
    $('consoleBody').innerHTML = '';
    $('jumpToBottom').classList.add('hidden');
  }

  function consoleTextContent() {
    var lines = $('consoleBody').querySelectorAll('.console-line');
    return Array.prototype.map.call(lines, function (l) { return l.textContent; }).join('\n');
  }

  function copyConsole() {
    var text = consoleTextContent();
    var done = function () { setStatus(t('copied'), 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { setStatus(t('copyFailed'), 'error'); });
      return;
    }
    // Fallback for embedded webviews without the async Clipboard API.
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch (e) {
      setStatus(t('copyFailed'), 'error');
    }
    document.body.removeChild(ta);
  }

  function downloadConsole() {
    var text = consoleTextContent();
    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'vm-update-console-' + Date.now() + '.log';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Neutralize spreadsheet formula-injection prefixes client-side, mirroring
  // the server's sanitize_csv_field (CWE-1236 / OWASP CSV Injection), since
  // this export never round-trips through the backend.
  function csvField(value) {
    var s = value === null || value === undefined ? '' : String(value);
    if (s && /^[=+\-@\t\r]/.test(s)) {
      s = "'" + s;
    }
    if (/[",\n]/.test(s)) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function downloadCsv(filename, headers, rows) {
    var lines = [headers.map(csvField).join(',')];
    rows.forEach(function (row) { lines.push(row.map(csvField).join(',')); });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportGuestsCsv() {
    var guests = getFilteredSortedGuests();
    var headers = ['name', 'vmid', 'ip_host', 'os_family', 'username', 'enabled', 'schedule_enabled', 'last_check_at', 'last_status', 'next_run'];
    var rows = guests.map(function (g) {
      return [g.name, g.vmid, g.ip_host, g.os_family, g.username, g.enabled, g.schedule_enabled, g.last_check_at, g.last_status, g.next_run];
    });
    downloadCsv('vm-update-guests-' + Date.now() + '.csv', headers, rows);
  }

  function exportJobsCsv() {
    var rows = state.lastJobRows || [];
    var headers = ['guest', 'job_type', 'status', 'packages_found', 'packages_applied', 'started_at', 'duration'];
    var data = rows.map(function (j) {
      return [guestName(j.guest_id), j.job_type, j.status, j.packages_found || 0, j.packages_applied || 0, j.started_at, formatDuration(j.started_at, j.completed_at)];
    });
    downloadCsv('vm-update-jobs-' + Date.now() + '.csv', headers, data);
  }

  function setConsoleRunning(running, message) {
    var body = $('consoleBody');
    var existing = document.getElementById('console-running');
    if (existing) existing.remove();
    if (!running) return;
    var line = document.createElement('div');
    line.id = 'console-running';
    line.className = 'console-line info';
    line.textContent = (message || t('running')) + '...';
    body.appendChild(line);
    maybeAutoScrollConsole();
  }

  function renderConsole(log, error) {
    var body = $('consoleBody');
    setConsoleRunning(false);
    body.innerHTML = '';
    if (error) {
      var err = document.createElement('div');
      err.className = 'console-line error';
      err.textContent = formatTimestamp(new Date().toISOString()) + 'Error: ' + error;
      body.appendChild(err);
    }
    if (!log || !log.length) {
      if (!error) {
        var empty = document.createElement('div');
        empty.className = 'console-line muted';
        empty.textContent = t('noOutput');
        body.appendChild(empty);
      }
      return;
    }
    log.forEach(function (l) {
      var cls = 'console-line ' + (l.level || 'info');
      var prefix = formatTimestamp(l.at);
      // Multi-line command output (e.g. `apt list --upgradable`) is stored
      // as a single log entry whose message contains embedded newlines.
      // Render each line as its own block so the console stays readable
      // instead of collapsing everything onto one visual line.
      var rawLines = String(l.message || '').split('\n');
      rawLines.forEach(function (text, idx) {
        var line = document.createElement('div');
        line.className = cls;
        var linePrefix = idx === 0 ? prefix : '';
        if (idx === 0 && l.level === 'cmd') {
          line.textContent = linePrefix + '$ ' + text;
        } else {
          line.textContent = linePrefix + text;
        }
        body.appendChild(line);
      });
    });
    scrollConsoleToBottom();
  }

  async function showJob(jobId, rows) {
    state.selectedJob = jobId;
    var job = rows.find(function (j) { return j.id === jobId; });
    if (!job) return;
    var parsed = [];
    try {
      parsed = JSON.parse(job.output || '[]');
      if (!Array.isArray(parsed)) parsed = [];
    } catch (e) { }
    renderConsole(parsed, job.error);
    // Package-level detail is only recorded for 'check' jobs today (discovery
    // saves name/current/available rows); apply/preview jobs only produce raw
    // command output, already shown in the console above. Hide any stale
    // packages panel from a previously-selected check job rather than
    // fabricating package rows that don't exist for this job.
    if (job.job_type === 'check') {
      try {
        var pkgs = await api('GET', 'packages?job_id=' + job.id);
        showPackageList(pkgs, job.guest_id);
      } catch (e) { /* best-effort; console output above still shown */ }
    } else {
      $('packagesPanel').classList.add('hidden');
    }
    loadJobs();
  }

  async function pollJob(jobId, onComplete, attempts) {
    attempts = attempts || 0;
    var jobs = await api('GET', 'jobs?limit=50');
    var found = jobs.find(function (j) { return j.id === jobId; });
    if (!found) {
      if (attempts < 30) {
        setTimeout(function () { pollJob(jobId, onComplete, attempts + 1); }, 2000);
        return;
      }
      setStatus(t('unknown'), 'error');
      return;
    }
    if (found.status === 'pending' || found.status === 'running') {
      if (attempts < 30) {
        setTimeout(function () { pollJob(jobId, onComplete, attempts + 1); }, 2000);
        return;
      }
      setStatus(t('unknown'), 'error');
      return;
    }
    setStatus(found.status, found.status === 'completed' ? 'ok' : 'error');
    var parsed = [];
    try {
      parsed = JSON.parse(found.output || '[]');
      if (!Array.isArray(parsed)) parsed = [];
    } catch (e) { }
    renderConsole(parsed, found.error);
    if (onComplete) onComplete(found);
    loadJobs();
  }

  async function checkGuest(id) {
    setStatus(t('checking'), 'info');
    setConsoleRunning(true, t('checking'));
    setGuestRunning(id, true);
    try {
      var res = await api('POST', 'check', { guest_id: id });
      if (!res.ok) throw new Error(res.error || 'Failed to start check');
      await pollJob(res.job_id, async function (job) {
        if (job.status === 'completed') {
          var pkgs = await api('GET', 'packages?job_id=' + job.id);
          showPackageList(pkgs, id);
        }
      });
    } catch (err) {
      setConsoleRunning(false);
      renderConsole([], err.message);
      setStatus(err.message, 'error');
    } finally {
      setGuestRunning(id, false);
    }
  }

  async function performApply(id) {
    setStatus(t('applyNow') + ' ' + guestName(id), 'info');
    setConsoleRunning(true, t('applyNow'));
    setGuestRunning(id, true);
    try {
      var res = await api('POST', 'apply', { guest_id: id });
      if (!res.ok) throw new Error(res.error || 'Failed to start apply');
      await pollJob(res.job_id, function () { });
    } catch (err) {
      setConsoleRunning(false);
      renderConsole([], err.message);
      setStatus(err.message, 'error');
    } finally {
      setGuestRunning(id, false);
    }
  }

  async function applyGuest(id) {
    var g = state.guests.find(function (x) { return x.id === id; });
    var count = state.packagesGuestId === id ? state.packagesCount : null;
    var message = count
      ? t('confirmApplyWithCount', { params: { name: g ? g.name : id, count: count } })
      : t('confirmApply', { params: { name: g ? g.name : id } });
    var confirmed = await confirmAction(message);
    if (!confirmed) return;
    await performApply(id);
  }

  async function bulkApplySelected() {
    var ids = Object.keys(state.selectedGuestIds).map(Number);
    if (!ids.length) return;
    var queued = [];
    var skipped = [];
    ids.forEach(function (id) {
      if (state.runningGuestIds[id]) {
        skipped.push(id);
      } else {
        queued.push(id);
      }
    });
    if (!queued.length) {
      setStatus(t('bulkSkipped', { params: { skipped: skipped.length } }), 'info');
      return;
    }
    var confirmed = await confirmAction(t('confirmBulkApply', { params: { count: queued.length } }));
    if (!confirmed) return;
    setStatus(t('applyNow') + ' (' + queued.length + ')', 'info');
    for (var i = 0; i < queued.length; i++) {
      await performApply(queued[i]);
    }
    state.selectedGuestIds = {};
    updateBulkButtonState();
    renderList();
    var summary = t('bulkApplyDone', { params: { count: queued.length } });
    if (skipped.length) {
      summary += ' ' + t('bulkSkipped', { params: { skipped: skipped.length } });
    }
    setStatus(summary, 'ok');
  }

  async function previewGuest(id) {
    setStatus(t('previewAction'), 'info');
    setConsoleRunning(true, t('previewAction'));
    setGuestRunning(id, true);
    try {
      var res = await api('POST', 'guests/preview', { guest_id: id });
      setConsoleRunning(false);
      renderConsole(res.log || [], res.error);
      setStatus(res.ok ? t('preview') + ': ' + (res.packages_applied || 0) + ' packages' : (res.error || 'Preview failed'), res.ok ? 'ok' : 'error');
    } catch (err) {
      setConsoleRunning(false);
      renderConsole([], err.message);
      setStatus(err.message, 'error');
    } finally {
      setGuestRunning(id, false);
    }
  }

  // Toggles which secret field (password vs. SSH private key) is shown and
  // required, based on the selected authentication type.
  function updateAuthTypeFields(requireSecret) {
    var isKey = $('authType').value === 'ssh_key';
    $('passwordGroup').classList.toggle('hidden', isKey);
    $('sshKeyGroup').classList.toggle('hidden', !isKey);
    $('password').required = requireSecret && !isKey;
    $('sshPrivateKey').required = requireSecret && isKey;
  }

  async function editGuest(id) {
    var g = state.guests.find(function (x) { return x.id === id; });
    if (!g) return;
    $('formTitle').textContent = t('edit');
    $('guestId').value = g.id;
    $('guestType').value = g.guest_type;
    $('cluster').value = g.cluster_id;
    await loadVms(g.cluster_id, g.vmid);
    $('name').value = g.name;
    $('ipHost').value = g.ip_host;
    $('sshPort').value = g.ssh_port;
    $('osFamily').value = g.os_family;
    $('username').value = g.username || '';
    $('authType').value = g.auth_type || 'password';
    $('password').value = '';
    $('sshPrivateKey').value = '';
    updateAuthTypeFields(false);
    $('enabled').checked = g.enabled;
    $('scheduleEnabled').checked = g.schedule_enabled;
    $('scheduleCron').value = g.schedule_cron || '0 2 * * *';
    $('autoApply').checked = g.auto_apply;
    $('dryRun').checked = g.dry_run;
    $('notifyOnFailure').checked = g.notify_on_failure;
  }

  function newGuest() {
    $('formTitle').textContent = t('addGuest');
    $('guestId').value = '';
    $('guestType').value = 'vm';
    $('form').reset();
    $('sshPort').value = '22';
    $('authType').value = 'password';
    $('scheduleCron').value = '0 2 * * *';
    $('enabled').checked = true;
    $('dryRun').checked = true;
    $('notifyOnFailure').checked = true;
    updateAuthTypeFields(true);
    if (clusterParam) $('cluster').value = clusterParam;
    loadVms($('cluster').value, null);
  }

  async function saveGuest(e) {
    e.preventDefault();
    var saveBtn = document.querySelector('#form button[type="submit"]');
    if (saveBtn) saveBtn.disabled = true;
    var body = {
      cluster_id: $('cluster').value,
      guest_type: $('guestType').value || 'vm',
      vmid: Number($('vmid').value),
      name: $('name').value,
      ip_host: $('ipHost').value,
      ssh_port: Number($('sshPort').value),
      os_family: $('osFamily').value,
      username: $('username').value,
      auth_type: $('authType').value,
      password: $('authType').value === 'password' ? $('password').value : '',
      ssh_private_key: $('authType').value === 'ssh_key' ? $('sshPrivateKey').value : '',
      enabled: $('enabled').checked,
      schedule_enabled: $('scheduleEnabled').checked,
      schedule_cron: $('scheduleCron').value,
      auto_apply: $('autoApply').checked,
      dry_run: $('dryRun').checked,
      notify_on_failure: $('notifyOnFailure').checked,
    };
    if (!body.cluster_id) { setStatus(t('selectCluster'), 'error'); return; }
    if (body.vmid <= 0) { setStatus(t('selectVm'), 'error'); return; }
    var editing = $('guestId').value;
    try {
      if (editing) {
        body.id = Number(editing);
        await api('PUT', 'guest?id=' + editing, body);
      } else {
        await api('POST', 'guests', body);
      }
      setStatus(t('saved'), 'ok');
      newGuest();
      await loadGuests();
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function deleteGuest(id) {
    var g = state.guests.find(function (x) { return x.id === id; });
    var confirmed = await confirmAction(t('confirmDelete', { params: { name: g ? g.name : id } }));
    if (!confirmed) return;
    try {
      await api('DELETE', 'guest?id=' + id);
      await loadGuests();
    } catch (err) {
      setStatus(err.message, 'error');
    }
  }

  async function testConnection(id) {
    setStatus(t('testConnection') + '...', 'info');
    setConsoleRunning(true, t('testConnection'));
    try {
      var res = await api('POST', 'guests/connect', { guest_id: id });
      setConsoleRunning(false);
      var log = [
        { level: 'cmd', message: 'whoami', at: new Date().toISOString() },
        { level: res.ok ? 'info' : 'error', message: res.ok ? res.user : (res.error || t('unreachable')), at: new Date().toISOString() }
      ];
      renderConsole(log, null);
      setStatus(res.ok ? t('reachable') : (res.error || t('unreachable')), res.ok ? 'ok' : 'error');
    } catch (err) {
      setConsoleRunning(false);
      renderConsole([], err.message);
      setStatus(err.message, 'error');
    }
  }

  applyTheme();
  watchTheme();
  $('cluster').addEventListener('change', onClusterChange);
  $('vmid').addEventListener('change', onVmidChange);
  $('form').addEventListener('submit', saveGuest);
  $('authType').addEventListener('change', function () { updateAuthTypeFields(!$('guestId').value); });
  $('newGuest').addEventListener('click', newGuest);
  $('cancel').addEventListener('click', newGuest);
  $('refresh').addEventListener('click', function () { loadGuests(); loadJobs(); });
  $('clearConsole').addEventListener('click', clearConsole);
  $('copyConsole').addEventListener('click', copyConsole);
  $('downloadConsole').addEventListener('click', downloadConsole);
  $('jumpToBottom').addEventListener('click', scrollConsoleToBottom);
  $('consoleBody').addEventListener('scroll', function () {
    if (isConsoleNearBottom()) {
      $('jumpToBottom').classList.add('hidden');
    }
  });
  $('searchGuests').addEventListener('input', function () {
    if (state.searchTimeout) clearTimeout(state.searchTimeout);
    state.searchTimeout = setTimeout(function () { renderList(); }, 150);
  });
  $('filterStatus').addEventListener('change', renderList);
  $('filterOsFamily').addEventListener('change', renderList);
  $('checkSelected').addEventListener('click', bulkCheckSelected);
  $('applySelected').addEventListener('click', bulkApplySelected);
  $('exportGuestsCsv').addEventListener('click', exportGuestsCsv);
  $('exportJobsCsv').addEventListener('click', exportJobsCsv);
  $('packagesPreview').addEventListener('click', function () { if (state.packagesGuestId) previewGuest(state.packagesGuestId); });
  $('packagesApply').addEventListener('click', function () { if (state.packagesGuestId) applyGuest(state.packagesGuestId); });
  $('selectAllGuests').addEventListener('change', function (e) {
    var guests = getFilteredSortedGuests();
    if (e.target.checked) {
      guests.forEach(function (g) {
        if (!isGuestRunning(g)) state.selectedGuestIds[g.id] = true;
      });
    } else {
      guests.forEach(function (g) { delete state.selectedGuestIds[g.id]; });
    }
    updateBulkButtonState();
    renderList();
  });
  document.querySelectorAll('.guest-table th[data-sort]').forEach(function (th) {
    function toggleSort() {
      var key = th.dataset.sort;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = { key: key, dir: 'asc' };
      }
      renderList();
    }
    th.addEventListener('click', toggleSort);
    th.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleSort();
      }
    });
  });

  // Start after the plugin translation namespace is loaded so static labels
  // are translated before the first render. If the parent i18n bridge is
  // unavailable, fetch the English dictionary directly as a fallback.
  function start() {
    var init = Promise.resolve();
    if (i18n && i18n.loadPluginNamespaceFull) {
      init = i18n.loadPluginNamespaceFull('vm_update', I18N_API);
    } else {
      init = loadFallbackTranslations();
    }
    init.then(function () {
      translateStaticElements();
      loadClusters().then(function () {
        loadVms($('cluster').value, null).then(function () {
          loadGuests().then(function () {
            loadJobs();
            setInterval(loadJobs, 10000);
            setInterval(loadGuests, 60000);
          });
        });
      });
    });
    try {
      window.addEventListener('offline', function () { setStatus(t('offline'), 'warning'); });
      window.addEventListener('online', function () { setStatus(t('online'), 'ok'); setTimeout(function () { setStatus(''); }, 2000); });
    } catch (e) { }
  }
  start();
})();
