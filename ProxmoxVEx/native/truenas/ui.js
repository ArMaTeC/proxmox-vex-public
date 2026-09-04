/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        ProxmoxVEx/native/truenas/ui.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Ui JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
(function () {
  // ─── Language Detection ─────────────────────────────────────────────────
  const supported = (function () {
    try { return window.parent.ProxmoxVExSupportedLangs; } catch (e) { }
    return null;
  })() || ['de', 'en', 'it', 'fr', 'es', 'pt', 'ko'];

  const lang = (() => {
    try {
      const p = window.parent.ProxmoxVExLanguage;
      if (p && supported.includes(p)) return p;
    } catch (e) { }
    const q = new URLSearchParams(location.search).get('lang') || '';
    const base = q.split(/[-_]/)[0].toLowerCase();
    if (supported.includes(base)) return base;
    return 'en';
  })();
  document.documentElement.lang = lang;

  // ─── i18n Integration ───────────────────────────────────────────────────
  // Try to use the parent's namespace-aware i18n system.
  // Falls back to inline TRUENAS_I18N dictionary if parent is unavailable.
  let _parentI18n = null;
  try { _parentI18n = window.parent.ProxmoxVExI18n; } catch (e) { }

  // ─── Translation Function ────────────────────────────────────────────────
  // If the parent i18n system has the truenas namespace loaded, delegate to it.
  // Otherwise use the inline TRUENAS_I18N dictionary as fallback.
  window.t = _parentI18n ? _parentI18n.getT('truenas') : function (key) { return key; };

  // ─── DOM Text Node Translation ─────────────────────────────────────────
  function translateTextNode(node) {
    if (node.nodeType !== 3) return;
    const parent = node.parentNode;
    if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'CODE')) return;
    const raw = node.nodeValue;
    const s = raw.trim().replace(/\s+/g, ' ');
    if (!s) return;
    const key = (parent && parent.dataset && parent.dataset.i18n) ? parent.dataset.i18n : s;
    let tr = t(key);
    if (tr === key) return;  // no translation available
    if (raw.endsWith(' ') && !tr.endsWith(' ')) tr += ' ';
    node.nodeValue = tr;
  }

  function translateAllTextNodes(root) {
    root = root || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    while (walker.nextNode()) {
      translateTextNode(walker.currentNode);
    }
  }

  // ─── Initialize ─────────────────────────────────────────────────────────
  // Try to register/load the truenas namespace in the parent i18n system,
  // then translate all DOM text nodes.
  (async function initI18n() {
    if (_parentI18n) {
      await _parentI18n.loadPluginNamespaceFull('truenas', '/api/native/truenas/i18n');
      _parentI18n.setLanguage(lang);
    }

    // Translate DOM on load
    function startTranslations() {
      translateAllTextNodes();
      _observeMutations();
      document.querySelectorAll('[data-i18n]').forEach(function (el) {
        el.textContent = t(el.getAttribute('data-i18n'));
      });
      // The main app script exposes loadConfig on window so this early i18n
      // setup script can trigger the initial instance list load after the
      // DOM translation pass completes.
      if (typeof window.loadConfig === 'function') {
        window.loadConfig();
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startTranslations);
    } else {
      startTranslations();
    }
  })();

  function _observeMutations() {
    const observer = new MutationObserver(function (mutations) {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const n of m.addedNodes) {
            if (n.nodeType === 3) {
              translateTextNode(n);
            } else if (n.nodeType === 1) {
              translateAllTextNodes(n);
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);
  var theme = qs.get('theme');
  if (theme) document.documentElement.setAttribute('data-theme', theme);

  var API_BASE = '/api/truenas/';
  var state = { config: null, editingId: null, selectedInstance: '', loadedTabs: {} };
  var DEFAULT_THRESHOLDS = { warn_pct: 80, crit_pct: 90 };

  function api(path, opts) {
    opts = opts || {};
    return fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    }).then(function (r) {
      // Read as text first, THEN try to parse — an intermediate proxy/CDN
      // (found live 2026-07-21: Cloudflare's tunnel, on a slow or errored
      // upstream) can return its OWN error page instead of relaying this
      // plugin's response, and that page is HTML/plain-text, not JSON.
      // Calling r.json() directly on that throws an uncaught
      // "Unexpected token '<' ... not valid JSON" with no useful status —
      // exactly what reached the operator's console. Falling back to a
      // synthetic {error: ...} keeps every existing call site working
      // unchanged (they already do `res.data && res.data.error`).
      return r.text().then(function (raw) {
        var data;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch (e) {
          data = {
            error: 'non-JSON response (HTTP ' + r.status + ') — likely an ' +
              'intermediate proxy/CDN error page rather than this plugin'
          };
        }
        return { status: r.status, data: data };
      });
    });
  }

  // -- tabs -------------------------------------------------------------
  var tabButtons = Array.prototype.slice.call(document.querySelectorAll('#tabs button'));
  tabButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      tabButtons.forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('main .tab').forEach(function (t) { t.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      refreshTab(btn.dataset.tab);
    });
  });

  function activeTabName() {
    var active = document.querySelector('#tabs button.active');
    return active ? active.dataset.tab : null;
  }

  // -- instance selector (grouped by client, per brief §3.1) -----------
  function renderSelector(groups) {
    var select = document.getElementById('instance-select');
    select.innerHTML = '';
    var total = 0;
    if (!groups || !groups.length) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = t("No instances configured");
      select.appendChild(opt);
      return;
    }
    groups.forEach(function (group) {
      var og = document.createElement('optgroup');
      og.label = group.client_id;
      group.instances.forEach(function (inst) {
        total++;
        var opt = document.createElement('option');
        opt.value = inst.id;
        opt.textContent = inst.name || inst.id;
        og.appendChild(opt);
      });
      select.appendChild(og);
    });
    if (!total) {
      var empty = document.createElement('option');
      empty.value = '';
      empty.textContent = t("No instances configured");
      select.appendChild(empty);
    }
  }

  function renderClientList(groups) {
    var root = document.getElementById('instances-by-client');
    root.innerHTML = '';
    if (!groups || !groups.length) {
      root.innerHTML = '<div class="empty">' + t("No instances configured — use \"New instance\" to add the first one.") + '</div>';
      return;
    }
    groups.forEach(function (group) {
      var wrap = document.createElement('div');
      wrap.className = 'client-group';
      var h3 = document.createElement('h3');
      h3.textContent = group.client_id;
      wrap.appendChild(h3);
      var table = document.createElement('table');
      table.innerHTML = '<thead><tr><th>Name</th><th>Host</th><th>Port</th>' +
        '<th>TLS</th><th>Readonly</th><th></th></tr></thead>';
      var tbody = document.createElement('tbody');
      group.instances.forEach(function (inst) {
        var tr = document.createElement('tr');
        [
          inst.name, inst.host, inst.port,
          inst.use_tls ? t("yes") : t("no"),
          inst.readonly ? t("yes") : t("no")
        ].forEach(function (txt) {
          var td = document.createElement('td');
          td.textContent = txt;
          tr.appendChild(td);
        });
        var actionsTd = document.createElement('td');
        actionsTd.className = 'row-actions';
        tr.appendChild(actionsTd);
        var editBtn = document.createElement('button');
        editBtn.className = 'btn secondary';
        editBtn.textContent = t("Edit");
        editBtn.addEventListener('click', function () { openForm(inst); });
        tr.querySelector('td:last-child').appendChild(editBtn);
        var deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn secondary';
        deleteBtn.textContent = t("deleteInstance");
        deleteBtn.addEventListener('click', function () { openDeleteConfirm(inst); });
        tr.querySelector('td:last-child').appendChild(deleteBtn);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      root.appendChild(wrap);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // DOM-safe HTML insertion using an inert DOMParser (no live innerHTML sink).
  function setHTMLSafe(el, html) {
    var s = String(html == null ? '' : html);
    var doc = new DOMParser().parseFromString(s, 'text/html');
    el.replaceChildren.apply(el, Array.from(doc.body.childNodes));
  }

  // -- instance form (create/edit + test connection) --------------------
  function openForm(inst) {
    closeDeleteConfirm();
    state.editingId = inst ? inst.id : null;
    document.getElementById('instance-form-card').hidden = false;
    document.getElementById('instance-form-title').textContent = inst ? t("Edit instance") : t("New instance");
    document.getElementById('f-id').value = inst ? inst.id : '';
    document.getElementById('f-id').disabled = !!inst;
    document.getElementById('f-name').value = inst ? inst.name : '';
    document.getElementById('f-client').value = inst ? inst.client_id : '';
    document.getElementById('f-host').value = inst ? inst.host : '';
    document.getElementById('f-port').value = inst ? inst.port : 443;
    document.getElementById('f-key').value = inst && inst.api_key_ro ? inst.api_key_ro : '';
    document.getElementById('f-key-rw').value = inst && inst.api_key_rw ? inst.api_key_rw : '';
    document.getElementById('f-tls-name').value = inst && inst.tls_server_name ? inst.tls_server_name : '';
    document.getElementById('f-warn-pct').value = inst && inst.warn_pct != null ? inst.warn_pct : '';
    document.getElementById('f-crit-pct').value = inst && inst.crit_pct != null ? inst.crit_pct : '';
    document.getElementById('f-tls').checked = inst ? !!inst.use_tls : true;
    document.getElementById('f-verify').checked = inst ? !!inst.verify_tls : false;
    document.getElementById('f-readonly').checked = inst ? !!inst.readonly : true;
    document.getElementById('test-result').textContent = '';
    document.getElementById('test-result').className = '';
    // Auto-expand advanced fields when editing an instance that already has
    // something set there — an operator revisiting an RW-enabled instance
    // shouldn't have to know to click "Advanced options" first.
    var hasAdvanced = !!(inst && (inst.api_key_rw || inst.tls_server_name || inst.warn_pct != null || inst.crit_pct != null));
    document.getElementById('advanced-fields').hidden = !hasAdvanced;
    document.getElementById('btn-toggle-advanced').textContent = hasAdvanced ? t("Advanced options ▴") : t("Advanced options ▾");
  }

  document.getElementById('btn-toggle-advanced').addEventListener('click', function () {
    var box = document.getElementById('advanced-fields');
    box.hidden = !box.hidden;
    this.textContent = box.hidden ? t("Advanced options ▾") : t("Advanced options ▴");
  });

  function closeForm() {
    document.getElementById('instance-form-card').hidden = true;
    document.getElementById('f-id').disabled = false;
    state.editingId = null;
  }

  // -- delete instance (typed confirmation, same convention as the
  // dataset/snapshot destructive-write cards further down) -------------
  var deleteTargetId = null;

  function openDeleteConfirm(inst) {
    closeForm();
    deleteTargetId = inst.id;
    document.getElementById('del-inst-name').textContent = inst.name || inst.id;
    document.getElementById('del-inst-id').textContent = inst.id;
    document.getElementById('f-delete-confirm').value = '';
    document.getElementById('btn-delete-confirm').disabled = true;
    document.getElementById('delete-result').textContent = '';
    document.getElementById('delete-result').className = '';
    document.getElementById('instance-delete-card').hidden = false;
  }

  function closeDeleteConfirm() {
    document.getElementById('instance-delete-card').hidden = true;
    deleteTargetId = null;
  }

  document.getElementById('f-delete-confirm').addEventListener('input', function () {
    document.getElementById('btn-delete-confirm').disabled = (this.value.trim() !== deleteTargetId);
  });

  document.getElementById('btn-delete-cancel').addEventListener('click', closeDeleteConfirm);

  document.getElementById('btn-delete-confirm').addEventListener('click', function () {
    var btn = this;
    var existing = (state.config && state.config.instances) || [];
    var next = existing.filter(function (i) { return i.id !== deleteTargetId; });
    var out = document.getElementById('delete-result');
    btn.disabled = true;
    saveInstances(next).then(function (res) {
      if (res.status === 200) {
        closeDeleteConfirm();
        loadConfig();
      } else {
        out.className = 'err';
        out.textContent = t((res.data && res.data.error) || 'Error: could not delete');
        btn.disabled = false;
      }
    }).catch(function (e) {
      out.className = 'err';
      out.textContent = t("Network error: ") + e;
      btn.disabled = false;
    });
  });

  function parseOptionalPct(elId) {
    var raw = document.getElementById(elId).value;
    if (raw === '' || raw == null) return null;
    var n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }

  function formToInstance() {
    return {
      id: document.getElementById('f-id').value.trim(),
      name: document.getElementById('f-name').value.trim(),
      client_id: document.getElementById('f-client').value.trim() || 'unassigned',
      host: document.getElementById('f-host').value.trim(),
      port: parseInt(document.getElementById('f-port').value, 10) || 0,
      use_tls: document.getElementById('f-tls').checked,
      verify_tls: document.getElementById('f-verify').checked,
      api_key_ro: document.getElementById('f-key').value,
      api_key_rw: document.getElementById('f-key-rw').value || null,
      tls_server_name: document.getElementById('f-tls-name').value.trim() || null,
      readonly: document.getElementById('f-readonly').checked,
      warn_pct: parseOptionalPct('f-warn-pct'),
      crit_pct: parseOptionalPct('f-crit-pct'),
    };
  }

  function refreshKnownClients() {
    var list = document.getElementById('known-clients');
    list.innerHTML = '';
    (state.config && state.config.instances_by_client || []).forEach(function (g) {
      var opt = document.createElement('option');
      opt.value = g.client_id;
      list.appendChild(opt);
    });
  }

  function loadConfig() {
    return api('config').then(function (res) {
      if (res.status !== 200) {
        setHTMLSafe(document.getElementById('instances-by-client'),
          '<div class="empty">' + esc((res.data && res.data.error) || 'error loading config') + '</div>');
        return;
      }
      state.config = res.data;
      renderSelector(res.data.instances_by_client);
      renderClientList(res.data.instances_by_client);
      refreshKnownClients();
      var thresholds = res.data.thresholds || DEFAULT_THRESHOLDS;
      document.getElementById('f-thresh-warn').value = thresholds.warn_pct;
      document.getElementById('f-thresh-crit').value = thresholds.crit_pct;
      var notifyCfg = res.data.notify || {};
      document.getElementById('f-webhook-url').value = notifyCfg.webhook_url || '';
      document.getElementById('f-wa-instance').value = notifyCfg.whatsapp_instance || '';
      document.getElementById('f-wa-target').value = notifyCfg.whatsapp_target || '';
      document.getElementById('f-wa-key').value = notifyCfg.whatsapp_api_key || '';
      refreshPollerStatusBadge();

      // Building <option> elements never fires 'change' — the browser
      // auto-picks the first one once instances exist, but state.
      // selectedInstance (only ever set by the 'change' listener) stays
      // '', so every tab keeps showing "Select an instance above." even
      // though the selector visibly already shows an instance. Sync once
      // here so the first configured instance loads without the operator
      // having to manually re-pick it.
      var select = document.getElementById('instance-select');
      if (select.value && select.value !== state.selectedInstance) {
        state.selectedInstance = select.value;
        var chip = document.getElementById('instance-chip');
        chip.textContent = t("selected");
        chip.className = 'chip';
        refreshTab(activeTabName());
      }
    });
  }

  // Expose to the earlier i18n setup script, which runs in a separate
  // <script> block and needs a globally reachable loadConfig to initialise
  // the instance list.
  window.loadConfig = loadConfig;

  function saveInstances(nextInstances) {
    return api('config/save', {
      method: 'POST',
      body: {
        instances: nextInstances,
        poll: state.config ? state.config.poll : undefined,
        thresholds: state.config ? state.config.thresholds : undefined,
      },
    });
  }

  document.getElementById('btn-save-thresholds').addEventListener('click', function () {
    var btn = this;
    var out = document.getElementById('thresholds-result');
    var warn = parseInt(document.getElementById('f-thresh-warn').value, 10);
    var crit = parseInt(document.getElementById('f-thresh-crit').value, 10);
    out.className = '';
    out.textContent = t("Saving…");
    btn.disabled = true;
    api('config/save', {
      method: 'POST',
      body: {
        instances: (state.config && state.config.instances) || [],
        poll: state.config ? state.config.poll : undefined,
        thresholds: { warn_pct: warn, crit_pct: crit },
      },
    }).then(function (res) {
      btn.disabled = false;
      if (res.status === 200) {
        out.className = 'ok';
        out.textContent = t("Thresholds saved.");
        loadConfig().then(function () { refreshTab(activeTabName()); });
      } else {
        out.className = 'err';
        out.textContent = t((res.data && res.data.error) || 'Error: could not save');
      }
    }).catch(function (e) {
      btn.disabled = false;
      out.className = 'err';
      out.textContent = t("Network error: ") + e;
    });
  });

  function refreshPollerStatusBadge() {
    var badge = document.getElementById('poller-status-badge');
    api('poller/status').then(function (res) {
      if (res.status !== 200 || !res.data) {
        badge.textContent = t("Poller: unknown state.");
        return;
      }
      var s = res.data;
      if (!s.last_run) {
        badge.textContent = t("Poller: no cycle has run yet.");
        return;
      }
      var secondsAgo = Math.max(0, Math.round(Date.now() / 1000 - s.last_run));
      badge.textContent = s.ok
        ? 'Poller: alive, last cycle ' + secondsAgo + 's ago.'
        : 'Poller: last cycle failed ' + secondsAgo + 's ago — ' + (s.error || 'unknown error');
      badge.className = 'subtab-hint' + (s.ok ? '' : ' err');
    }).catch(function () {
      badge.textContent = t("Poller: could not query state.");
    });
  }

  document.getElementById('btn-save-notify').addEventListener('click', function () {
    var btn = this;
    var out = document.getElementById('notify-result');
    var url = document.getElementById('f-webhook-url').value.trim();
    out.className = '';
    out.textContent = t("Saving…");
    btn.disabled = true;
    api('config/save', {
      method: 'POST',
      body: {
        instances: (state.config && state.config.instances) || [],
        poll: state.config ? state.config.poll : undefined,
        thresholds: state.config ? state.config.thresholds : undefined,
        notify: {
          webhook_url: url || null,
          whatsapp_instance: document.getElementById('f-wa-instance').value.trim() || null,
          whatsapp_target: document.getElementById('f-wa-target').value.trim() || null,
          whatsapp_api_key: document.getElementById('f-wa-key').value.trim() || null,
        },
      },
    }).then(function (res) {
      btn.disabled = false;
      if (res.status === 200) {
        out.className = 'ok';
        out.textContent = t("Notifications saved.");
        loadConfig();
      } else {
        out.className = 'err';
        out.textContent = t((res.data && res.data.error) || 'Error: could not save');
      }
    }).catch(function (e) {
      btn.disabled = false;
      out.className = 'err';
      out.textContent = t("Network error: ") + e;
    });
  });

  document.getElementById('btn-new-instance').addEventListener('click', function () { openForm(null); });
  document.getElementById('btn-cancel-instance').addEventListener('click', closeForm);

  document.getElementById('btn-test').addEventListener('click', function () {
    var draft = formToInstance();
    var out = document.getElementById('test-result');
    out.className = '';
    out.textContent = t("Testing…");
    api('instances/test', { method: 'POST', body: draft }).then(function (res) {
      var ok = res.data && res.data.ok;
      out.className = ok ? 'ok' : 'err';
      out.textContent = ok ? t("Connection OK (auth.login_with_api_key successful).")
        : t((res.data && res.data.error) || 'Unknown error');
    }).catch(function (e) {
      out.className = 'err';
      out.textContent = t("Network error: ") + e;
    });
  });

  document.getElementById('btn-save-instance').addEventListener('click', function () {
    var draft = formToInstance();
    if (!draft.id || !draft.host) {
      var out = document.getElementById('test-result');
      out.className = 'err';
      out.textContent = t("id and host are required.");
      return;
    }
    var existing = (state.config && state.config.instances) || [];
    var next = existing.filter(function (i) { return i.id !== draft.id; }).concat([draft]);
    saveInstances(next).then(function (res) {
      if (res.status === 200) {
        closeForm();
        loadConfig();
      } else {
        var out = document.getElementById('test-result');
        out.className = 'err';
        out.textContent = t((res.data && res.data.error) || 'Error: could not save');
      }
    });
  });

  document.getElementById('instance-select').addEventListener('change', function (e) {
    state.selectedInstance = e.target.value || '';
    state.loadedTabs = {};  // force a fresh fetch for the new instance
    var chip = document.getElementById('instance-chip');
    chip.textContent = state.selectedInstance ? t("selected") : '';
    chip.className = 'chip';
    refreshTab(activeTabName());
  });

  // -- F1: subsystem tabs (Overview/Pools/Datasets/Snapshots/Shares/
  // Replication/Apps-VMs) — fetch real data from the F1 read routes. -----

  function fetchSubsystem(name) {
    var qs = '?instance_id=' + encodeURIComponent(state.selectedInstance);
    return api(name + qs);
  }

  function badge(text) {
    return '<span class="badge ' + esc(text) + '">' + esc(text) + '</span>';
  }

  var TAB_BODY_ID = {
    fleet: 'fleet-body',
    overview: 'ov-body', pools: 'pools-body', datasets: 'datasets-body',
    snapshots: 'snapshots-body', shares: 'shares-body',
    replication: 'replication-body', apps: 'apps-body', services: 'services-body',
    'data-protection': 'data-protection-body',
  };
  // Overview reuses the pools+system data (no dedicated route) — settings
  // has its own load path (loadConfig) and is excluded here.
  var TAB_SUBSYSTEM = {
    overview: 'system', pools: 'pools', datasets: 'datasets',
    snapshots: 'snapshots', shares: 'shares', replication: 'replication',
    apps: 'apps_vms', services: 'services', 'data-protection': 'data_protection',
  };

  // Overview/Pools show live resilver/scrub progress — the brief's whole
  // point for the Overview bento — so they always refetch on entry rather
  // than showing a stale % from whenever the tab was first opened. Every
  // other F1 tab is fetched once per instance and cached (nothing in it
  // changes second-to-second the way scan progress does).
  var NEVER_CACHE_TABS = { fleet: true, overview: true, pools: true };

  function networkErrorMessage(e) {
    return t("Network error: ") + (e && e.message ? e.message : e);
  }

  function refreshTab(tab) {
    if (!tab || tab === 'settings') return;
    var bodyId = TAB_BODY_ID[tab];
    if (!bodyId) return;
    var body = document.getElementById(bodyId);

    // Fleet is cross-instance by design — it must never gate on
    // state.selectedInstance the way every other tab does below (it has
    // no meaning here; Fleet shows ALL configured instances at once).
    if (tab === 'fleet') {
      if (state.loadedTabs.fleet && !NEVER_CACHE_TABS.fleet) return;
      body.className = 'loading';
      body.textContent = t("Loading…");
      api('fleet').then(function (res) {
        if (res.status !== 200) {
          body.className = 'empty';
          body.textContent = (res.data && res.data.error) || 'error';
          return;
        }
        renderFleet(body, res.data);
        state.loadedTabs.fleet = true;
      }).catch(function (e) {
        body.className = 'empty';
        body.textContent = networkErrorMessage(e);
      });
      return;
    }

    if (!state.selectedInstance) {
      body.className = 'empty';
      body.innerHTML = t("Select an instance above.");
      return;
    }
    var cacheKey = tab + '::' + state.selectedInstance;
    if (state.loadedTabs[cacheKey] && !NEVER_CACHE_TABS[tab]) return;
    body.className = 'loading';
    body.textContent = t("Loading…");

    if (tab === 'overview') {
      Promise.all([fetchSubsystem('system'), fetchSubsystem('pools'), fetchSubsystem('telemetry')])
        .then(function (results) {
          renderOverview(body, results[0], results[1], results[2]);
          state.loadedTabs[cacheKey] = true;
        }).catch(function (e) {
          // Without this, a network failure (proxy down, ProxmoxVEx session
          // expired and returning HTML instead of JSON, ...) left the tab
          // stuck on "t("Loading…") forever with nothing visible anywhere — an
          // unhandled promise rejection muted in the console. Deliberately
          // NOT marking loadedTabs here, so the next tab-click/instance
          // change retries instead of staying stuck on the error forever.
          body.className = 'empty';
          body.textContent = networkErrorMessage(e);
        });
      return;
    }

    fetchSubsystem(TAB_SUBSYSTEM[tab]).then(function (res) {
      if (res.status !== 200) {
        body.className = 'empty';
        body.textContent = (res.data && res.data.error) || 'error';
        return;
      }
      RENDERERS[tab](body, res.data.data);
      state.loadedTabs[cacheKey] = true;
    }).catch(function (e) {
      body.className = 'empty';
      body.textContent = networkErrorMessage(e);
    });
  }

  function updatedAtHtml() {
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    var ss = String(now.getSeconds()).padStart(2, '0');
    return '<div class="subtab-hint">' + t("updated") + ' ' + hh + ':' + mm + ':' + ss + '</div>';
  }

  var ICONS = {
    system: '<svg class="card-icon" viewBox="0 0 24 24"><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>',
    pools: '<svg class="card-icon" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
    alerts: '<svg class="card-icon" viewBox="0 0 24 24"><path d="M12 3a5 5 0 0 0-5 5v3.5c0 .8-.3 1.5-.8 2.1L5 16h14l-1.2-2.4a3.5 3.5 0 0 1-.8-2.1V8a5 5 0 0 0-5-5z"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0"/></svg>',
    version: '<svg class="card-icon" viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z"/></svg>',
    check: '<svg class="row-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5.5"/></svg>',
    warn: '<svg class="row-icon" viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/></svg>',
  };

  // -- byte formatting + ZFS topology helpers (Storage grid) --------------

  function formatBytes(n) {
    if (n === null || n === undefined || isNaN(n)) return '?';
    var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    var v = n, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(i === 0 ? 0 : (v < 10 ? 2 : 1)) + ' ' + units[i];
  }

  function walkVdevDisks(vdev, out) {
    if (!vdev) return;
    if (vdev.type === 'DISK') { out.push(vdev); return; }
    (vdev.children || []).forEach(function (c) { walkVdevDisks(c, out); });
  }

  // ZFS reports read/write/checksum errors per LEAF disk inside topology,
  // not as a flat count on the pool — pool.query's own docs call this out
  // as attrs passthrough, so this walks the same vdev groups zpool status
  // does (data/cache/dedup/log/spare/special) rather than assuming "data"
  // is the only one that can hold a faulted disk.
  function poolDiskSummary(pool) {
    var topo = pool.topology || {};
    var leaves = [];
    ['data', 'cache', 'dedup', 'log', 'spare', 'special'].forEach(function (group) {
      (topo[group] || []).forEach(function (vdev) { walkVdevDisks(vdev, leaves); });
    });
    var errored = leaves.filter(function (d) {
      var s = d.stats || {};
      return d.status !== 'ONLINE' ||
        (s.read_errors || 0) > 0 || (s.write_errors || 0) > 0 || (s.checksum_errors || 0) > 0;
    }).length;
    return { errored: errored, total: leaves.length };
  }

  function lastScrubText(scan) {
    if (!scan || !scan.function) return t("never");
    if (scan.state === 'SCANNING') {
      return scan.function.toLowerCase() + ' ' + t("in progress") + ' (' + (scan.percentage || 0).toFixed(0) + '%)';
    }
    var when = scan.end_time && scan.end_time['$date'] ? new Date(scan.end_time['$date']) : null;
    var label = scan.state === 'FINISHED' ? t("completed") : (scan.state || '?').toLowerCase();
    return scan.function.toLowerCase() + ' ' + label + (when ? ' — ' + when.toLocaleDateString() : '');
  }

  function poolRow(ok, label, value) {
    return '<div class="pool-row ' + (ok ? 'ok' : 'warn') + '">' + ICONS[ok ? 'check' : 'warn'] +
      '<span class="pool-row-label">' + esc(label) + '</span>' +
      '<span class="pool-row-value">' + esc(value) + '</span></div>';
  }

  function formatEpochMs(dateField) {
    var ms = dateField && dateField['$date'];
    if (!ms) return '?';
    return new Date(ms).toLocaleString();
  }

  function fleetStatusClass(inst) {
    if (!inst.reachable) return 'stat-err';
    if ((inst.unhealthy_pools && inst.unhealthy_pools.length) ||
      inst.critical_alert_count ||
      (inst.down_services && inst.down_services.length)) return 'stat-warn';
    return 'stat-ok';
  }

  // -- Charts: ring gauges + bar-list rankings ---------------------------
  // Hand-rolled SVG, same "no charting library" rationale as the telemetry
  // sparklines further down. Every fill starts at 0 and animateFills()
  // grows it to the real value on next paint (see the CSS comment above
  // .ring-row for why: a plain inline width/offset never animates in,
  // since there's no prior state to transition FROM on first render).
  var RING_R = 42, RING_C = 2 * Math.PI * RING_R;

  // Three-state (ok/warn/crit) tone from a {warn_pct, crit_pct} pair —
  // falls back to DEFAULT_THRESHOLDS when called before config has loaded
  // (e.g. a stray render during the very first paint). ok is '' rather than
  // 'stat-ok' here because ring/bar fills use an unstyled default for ok
  // (see .ring-fill / .bar-list-fill CSS); cardTone() below is the
  // explicit-'stat-ok' variant that .bento .card needs instead.
  function pctTone(pct, thresholds) {
    var t = thresholds || DEFAULT_THRESHOLDS;
    if (pct >= t.crit_pct) return 'stat-err';
    if (pct >= t.warn_pct) return 'stat-warn';
    return '';
  }

  function cardTone(pct, thresholds) {
    var tone = pctTone(pct, thresholds);
    return tone || 'stat-ok';
  }

  // Effective thresholds for a given instance config object: its own
  // warn_pct/crit_pct override each independently, falling back to the
  // global pair per-field (an instance may only override one side).
  function instanceThresholds(inst) {
    var global = (state.config && state.config.thresholds) || DEFAULT_THRESHOLDS;
    if (!inst) return global;
    return {
      warn_pct: inst.warn_pct != null ? inst.warn_pct : global.warn_pct,
      crit_pct: inst.crit_pct != null ? inst.crit_pct : global.crit_pct,
    };
  }

  function findConfigInstance(id) {
    var list = (state.config && state.config.instances) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function currentInstanceConfig() {
    return findConfigInstance(state.selectedInstance);
  }

  function ringGauge(pct, opts) {
    opts = opts || {};
    var safePct = Math.max(0, Math.min(100, pct || 0));
    var offset = RING_C * (1 - safePct / 100);
    var tone = opts.tone || pctTone(safePct, opts.thresholds);
    var titleText = (opts.caption ? opts.caption + ': ' : '') + safePct.toFixed(1) + '%' +
      (opts.detail ? ' (' + opts.detail + ')' : '');
    return '<svg class="ring-gauge" viewBox="0 0 100 100" role="img" aria-label="' + esc(titleText) + '">' +
      '<title>' + esc(titleText) + '</title>' +
      '<circle class="ring-track" cx="50" cy="50" r="' + RING_R + '"/>' +
      '<circle class="ring-fill ' + tone + '" cx="50" cy="50" r="' + RING_R + '" ' +
      'stroke-dasharray="' + RING_C.toFixed(1) + '" style="stroke-dashoffset:' + RING_C.toFixed(1) + '" ' +
      'data-grow-to="' + offset.toFixed(1) + '" data-grow-prop="stroke-dashoffset"/>' +
      '<text class="ring-value" x="50" y="46">' + esc(opts.label != null ? opts.label : safePct.toFixed(0) + '%') + '</text>' +
      '<text class="ring-caption" x="50" y="63">' + esc(opts.caption || '') + '</text>' +
      '</svg>';
  }

  function barListRow(label, sub, pct, valueText, tone) {
    var safePct = Math.max(0, Math.min(100, pct || 0));
    return '<div class="bar-list-row">' +
      '<div class="bar-list-label" title="' + esc(label) + '">' + esc(label) +
      (sub ? ' <span class="bar-list-sub">' + esc(sub) + '</span>' : '') + '</div>' +
      '<div class="bar-list-track"><div class="bar-list-fill ' + (tone || pctTone(safePct, state.config && state.config.thresholds)) + '" data-grow-to="' + safePct + '%"></div></div>' +
      '<div class="bar-list-value">' + esc(valueText) + '</div>' +
      '</div>';
  }

  // Called once after any body.innerHTML = html that included a ring gauge,
  // bar-list row, or .progress bar — see the CSS comment for why this needs
  // a double rAF rather than just setting the target value directly.
  function animateFills(root) {
    var els = root.querySelectorAll('[data-grow-to]');
    if (!els.length) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        els.forEach(function (el) {
          if (el.dataset.growProp === 'stroke-dashoffset') {
            el.style.strokeDashoffset = el.dataset.growTo;
          } else {
            el.style.width = el.dataset.growTo;
          }
        });
      });
    });
  }

  function renderFleet(body, payload) {
    body.className = '';
    var agg = payload.aggregate || {};
    var instances = payload.instances || [];
    if (!instances.length) {
      body.className = 'empty';
      body.innerHTML = payload.skipped_no_api_key
        ? t("Instances are configured but missing api_key_ro — add one in Settings.")
        : t("No instances configured — add the first one from Settings.");
      return;
    }

    var html = updatedAtHtml();
    html += '<div class="bento">';
    html += '<div class="card"><div class="stat-label">' + ICONS.system + t('Instances') + '</div>' +
      '<div class="stat">' + agg.instance_count + '</div>' +
      '<div>' + agg.healthy_count + ' OK · ' + agg.degraded_count + ' ' + t("degraded") + ' · ' +
      agg.unreachable_count + ' ' + t("down") + '</div></div>';
    var globalThresholds = (state.config && state.config.thresholds) || DEFAULT_THRESHOLDS;
    html += '<div class="card ' + (agg.capacity_pct != null ? cardTone(agg.capacity_pct, globalThresholds) : 'stat-ok') +
      '"><div class="stat-label">' + ICONS.pools + t('Total capacity') + '</div>' +
      (agg.capacity_pct != null
        ? '<div class="ring-row">' + ringGauge(agg.capacity_pct, { caption: t("Usage"), thresholds: globalThresholds }) +
        '<div><div style="font-size:13px">' + formatBytes(agg.capacity_used) + '</div>' +
        '<div class="subtab-hint" style="margin:0">' + t("of") + ' ' + formatBytes(agg.capacity_size) + '</div></div></div>'
        : '<div class="stat">?</div>') +
      '</div>';
    html += '<div class="card ' + (agg.total_alerts ? 'stat-warn' : 'stat-ok') +
      '"><div class="stat-label">' + ICONS.alerts + t('Fleet-wide alerts') + '</div>' +
      '<div class="stat">' + agg.total_alerts + '</div></div>';
    html += '</div>';

    html += '<div class="pool-grid">';
    instances.forEach(function (inst) {
      html += '<div class="card pool-card ' + fleetStatusClass(inst) + '">';
      html += '<h2>' + esc(inst.name) + '</h2>';
      html += '<div class="subtab-hint">' + esc(inst.client_id) + '</div>';
      if (!inst.reachable) {
        html += poolRow(false, t("Status"), t("unreachable"));
        if (inst.connect_error) html += '<div class="subtab-hint">' + esc(inst.connect_error) + '</div>';
      } else {
        var unhealthyPools = inst.unhealthy_pools || [];
        var downServices = inst.down_services || [];
        html += poolRow(!unhealthyPools.length, 'Pools',
          inst.pool_count + ' (' + unhealthyPools.length + ' ' + t("with issues") + ')');
        html += poolRow(!inst.critical_alert_count, 'Critical alerts', inst.critical_alert_count || 0);
        html += poolRow(!downServices.length, 'Down services',
          downServices.length ? downServices.join(', ') : t("none"));
        // inst here is the /fleet route's aggregate summary object, which
        // has no warn_pct/crit_pct of its own — those only live on the
        // config.json instance record managed from Settings. Must look it
        // up by id rather than pass inst straight through, or a per-instance
        // override silently never applies on the Fleet tab.
        var instThresholds = instanceThresholds(findConfigInstance(inst.id));
        var pct = inst.capacity_size ? (inst.capacity_used / inst.capacity_size * 100) : 0;
        html += poolRow(pct < instThresholds.warn_pct, t("Usage"),
          formatBytes(inst.capacity_used) + ' / ' + formatBytes(inst.capacity_size) +
          (inst.capacity_size ? ' (' + pct.toFixed(1) + '%)' : ''));
        // Slim bar restates the SAME t("Usage") row above for fast side-by-side
        // scanning across many instances — never a second metric, so its
        // tone must agree with fleetStatusClass() rather than re-deriving
        // its own from pct alone (an instance can be stat-warn/err for
        // reasons unrelated to capacity, e.g. a down service, and the bar
        // shouldn't paint over that as fine).
        if (inst.capacity_size) {
          var instCardTone = fleetStatusClass(inst);
          var barTone = instCardTone === 'stat-ok' ? pctTone(pct, instThresholds) : instCardTone;
          html += '<div class="bar-list-track" style="margin-top:2px">' +
            '<div class="bar-list-fill ' + barTone + '" data-grow-to="' + pct + '%"></div></div>';
        }
      }
      html += '</div>';
    });
    html += '</div>';

    html += '<div class="charts-grid">';
    if (agg.top_pools && agg.top_pools.length) {
      html += '<div class="card"><h2>' + t('Highest usage pools') + '</h2>';
      agg.top_pools.forEach(function (p) {
        html += barListRow(p.pool, p.instance_name, p.pct, p.pct.toFixed(1) + '%');
      });
      html += '</div>';
    }
    if (agg.activity && agg.activity.length) {
      html += '<div class="card"><h2>' + t('Recent activity') + '</h2><table><thead><tr>' +
        '<th>When</th><th>Instance</th><th>User</th><th>Event</th></tr></thead><tbody>';
      agg.activity.forEach(function (a) {
        html += '<tr><td>' + esc(formatEpochMs(a.timestamp)) + '</td>' +
          '<td>' + esc(a.instance_name) + '</td><td>' + esc(a.username) + '</td>' +
          '<td>' + esc(a.event) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="subtab-hint">No relevant recent activity.</div>';
    }
    html += '</div>';

    setHTMLSafe(body, html);
    animateFills(body);
  }

  // -- Telemetry sparklines (CPU/memory/network) — hand-rolled SVG, no
  // charting library (CT119 has no internet access to fetch one from a
  // CDN). Series are ``[timestamp, value]`` pairs (or ``[ts, rx, tx]`` for
  // network), already downsampled server-side to at most ~120 points.
  // ``timestamp`` is TrueNAS reporting.get_data's own 'time' column, a
  // plain Unix-seconds epoch (that endpoint's documented convention,
  // distinct from the ``{"$date": ms}`` wrapper other TrueNAS datetime
  // fields use elsewhere in this file, e.g. formatEpochMs) — hover
  // tooltips below multiply by 1000 before handing it to `Date`.
  //
  // chartRegistry holds the raw series + formatter behind each rendered
  // chart so wireSparklineInteractivity() can look up the right value for
  // whatever x position the cursor is over — reset on every
  // renderTelemetryCards() call (Overview never caches, so a stale entry
  // would just be pointing at a chart that no longer exists in the DOM).
  var SPARKLINE_W = 260, SPARKLINE_H = 56;
  var chartRegistry = [];
  var chartIdSeq = 0;

  function sparklinePoints(series, valueIndex, width, height, min, max) {
    var range = (max - min) || 1;
    var stepX = series.length > 1 ? width / (series.length - 1) : 0;
    return series.map(function (row, i) {
      var v = row[valueIndex];
      var y = v == null ? height : height - ((v - min) / range) * height;
      return (i * stepX).toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
  }

  function sparklineY(v, min, max, height) {
    var range = (max - min) || 1;
    return v == null ? height : height - ((v - min) / range) * height;
  }

  function sparklineAreaFill(chartId, linePoints, color) {
    return '<defs><linearGradient id="spark-grad-' + chartId + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.32"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      '<polygon class="sparkline-area" points="0,' + SPARKLINE_H + ' ' + linePoints + ' ' + SPARKLINE_W + ',' + SPARKLINE_H +
      '" fill="url(#spark-grad-' + chartId + ')"/>';
  }

  function sparklineWrap(chartId, inner, valueLabel) {
    return '<div class="sparkline-wrap" data-chart-id="' + chartId + '">' +
      '<svg class="sparkline" viewBox="0 0 ' + SPARKLINE_W + ' ' + SPARKLINE_H + '" preserveAspectRatio="none">' +
      inner + '<circle class="sparkline-dot" r="3"/></svg>' +
      '<div class="sparkline-tooltip" hidden></div>' +
      '<div class="sparkline-value">' + valueLabel + '</div></div>';
  }

  function renderSparkline(series, opts) {
    opts = opts || {};
    if (!series || !series.length) {
      return '<div class="subtab-hint">No telemetry data.</div>';
    }
    var values = series.map(function (r) { return r[1]; }).filter(function (v) { return v != null; });
    var min = opts.min != null ? opts.min : Math.min.apply(null, values.concat([0]));
    var max = opts.max != null ? opts.max : Math.max.apply(null, values.concat([1]));
    var points = sparklinePoints(series, 1, SPARKLINE_W, SPARKLINE_H, min, max);
    var last = values.length ? values[values.length - 1] : null;
    var label = last == null ? '?' : (opts.format ? opts.format(last) : last.toFixed(1));
    var color = opts.color || 'var(--accent)';
    var chartId = chartIdSeq++;
    chartRegistry[chartId] = { series: series, min: min, max: max, dual: false, format: opts.format };
    var inner = sparklineAreaFill(chartId, points, color) +
      '<polyline points="' + points + '" fill="none" stroke="' + color + '" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>';
    return sparklineWrap(chartId, inner, esc(label));
  }

  function renderDualSparkline(series, opts) {
    opts = opts || {};
    if (!series || !series.length) {
      return '<div class="subtab-hint">No telemetry data.</div>';
    }
    var allValues = [];
    series.forEach(function (r) { allValues.push(r[1], r[2]); });
    allValues = allValues.filter(function (v) { return v != null; });
    var min = Math.min.apply(null, allValues.concat([0]));
    var max = Math.max.apply(null, allValues.concat([1]));
    var rxPoints = sparklinePoints(series, 1, SPARKLINE_W, SPARKLINE_H, min, max);
    var txPoints = sparklinePoints(series, 2, SPARKLINE_W, SPARKLINE_H, min, max);
    var lastRow = series[series.length - 1];
    var fmt = opts.format || function (v) { return v.toFixed(1); };
    var chartId = chartIdSeq++;
    chartRegistry[chartId] = { series: series, min: min, max: max, dual: true, format: fmt };
    var inner = sparklineAreaFill(chartId, rxPoints, 'var(--ok)') +
      '<polyline points="' + rxPoints + '" fill="none" stroke="var(--ok)" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<polyline points="' + txPoints + '" fill="none" stroke="var(--accent)" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>';
    var label = '↓' + esc(fmt(lastRow[1])) + ' ↑' + esc(fmt(lastRow[2]));
    return sparklineWrap(chartId, inner, label);
  }

  // Wired once per Overview render, after its HTML lands in the DOM — the
  // same "re-query and attach listeners post-innerHTML" pattern renderServices/
  // renderShares/renderAppsVms already use for their row action buttons.
  function wireSparklineInteractivity(root) {
    root.querySelectorAll('.sparkline-wrap[data-chart-id]').forEach(function (wrap) {
      var chart = chartRegistry[Number(wrap.dataset.chartId)];
      if (!chart) return;
      var svg = wrap.querySelector('svg.sparkline');
      var dot = wrap.querySelector('.sparkline-dot');
      var tip = wrap.querySelector('.sparkline-tooltip');
      var stepX = chart.series.length > 1 ? SPARKLINE_W / (chart.series.length - 1) : 0;

      function show(clientX, clientY) {
        var rect = svg.getBoundingClientRect();
        if (!rect.width) return;
        var xFrac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        var idx = Math.round(xFrac * (chart.series.length - 1));
        var row = chart.series[idx];
        if (!row) return;
        var x = idx * stepX;
        var y = sparklineY(row[1], chart.min, chart.max, SPARKLINE_H);
        dot.setAttribute('cx', x.toFixed(1));
        dot.setAttribute('cy', y.toFixed(1));
        dot.style.opacity = '1';
        var timeText = row[0] ? new Date(row[0] * 1000).toLocaleTimeString() : '';
        var valueText = chart.dual
          ? '↓' + chart.format(row[1]) + ' ↑' + chart.format(row[2])
          : (chart.format ? chart.format(row[1]) : (row[1] == null ? '?' : row[1].toFixed(1)));
        tip.innerHTML = esc(valueText) + (timeText ? '<span class="t-time">' + esc(timeText) + '</span>' : '');
        tip.hidden = false;
        var leftPx = Math.min(rect.width - 90, Math.max(0, (x / SPARKLINE_W) * rect.width - 30));
        tip.style.left = leftPx.toFixed(0) + 'px';
        tip.style.top = '-30px';
      }
      function hide() {
        dot.style.opacity = '0';
        tip.hidden = true;
      }
      svg.addEventListener('mousemove', function (e) { show(e.clientX, e.clientY); });
      svg.addEventListener('mouseleave', hide);
      svg.addEventListener('touchstart', function (e) {
        if (e.touches && e.touches[0]) show(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: true });
    });
  }

  function renderTelemetryCards(telemetry) {
    chartRegistry.length = 0;
    chartIdSeq = 0;
    var html = '<div class="bento telemetry-row">';
    html += '<div class="card telemetry-card"><div class="stat-label">' + ICONS.system + t('CPU') + '</div>' +
      (telemetry.cpu_error
        ? '<div class="subtab-hint">' + esc(telemetry.cpu_error) + '</div>'
        : renderSparkline(telemetry.cpu, { format: function (v) { return v.toFixed(1) + '%'; } })) +
      '</div>';
    html += '<div class="card telemetry-card"><div class="stat-label">' + ICONS.system + t('Memory') + '</div>' +
      (telemetry.memory_error
        ? '<div class="subtab-hint">' + esc(telemetry.memory_error) + '</div>'
        : renderSparkline(telemetry.memory, { min: 0, max: 100, color: 'var(--ok)', format: function (v) { return v.toFixed(1) + '%'; } })) +
      '</div>';
    // One card per configured interface (operator request 2026-07-21: a
    // multi-NIC host only ever showed the first one — interfaces_error
    // covers "couldn't even list them"; an empty (but errorless) list
    // covers "listed fine, there just aren't any").
    if (telemetry.interfaces_error) {
      html += '<div class="card telemetry-card"><div class="stat-label">' + ICONS.system + t('Network') + '</div>' +
        '<div class="subtab-hint">' + esc(telemetry.interfaces_error) + '</div></div>';
    } else if (!telemetry.interfaces || !telemetry.interfaces.length) {
      html += '<div class="card telemetry-card"><div class="stat-label">' + ICONS.system + t('Network') + '</div>' +
        '<div class="subtab-hint">No interfaces configured.</div></div>';
    } else {
      telemetry.interfaces.forEach(function (iface) {
        html += '<div class="card telemetry-card"><div class="stat-label">' + ICONS.system +
          'Red (' + esc(iface.name) + ')</div>' +
          (iface.error
            ? '<div class="subtab-hint">' + esc(iface.error) + '</div>'
            : renderDualSparkline(iface.series, { format: function (v) { return formatBytes(v) + '/s'; } })) +
          '</div>';
      });
    }
    html += '</div>';
    return html;
  }

  function renderOverview(body, sysRes, poolsRes, telemetryRes) {
    body.className = '';
    if (sysRes.status !== 200 || poolsRes.status !== 200) {
      body.innerHTML = '<div class="empty">' +
        esc((sysRes.data && sysRes.data.error) || (poolsRes.data && poolsRes.data.error) || 'error') +
        '</div>';
      return;
    }
    var sys = sysRes.data.data, pools = poolsRes.data.data;
    var telemetry = telemetryRes && telemetryRes.status === 200 ? telemetryRes.data.data : null;
    var health = sys.health || {};
    var poolHealth = pools.health || {};
    var poolList = pools.pools || [];
    var scanning = poolList.filter(function (p) { return p.scan && p.scan.state === 'SCANNING'; });

    var alertCount = (sys.alerts || []).length;
    var alertClass = alertCount ? (sys.alerts.some(function (a) { return a.level === 'CRITICAL'; }) ? 'stat-err' : 'stat-warn') : 'stat-ok';

    var html = updatedAtHtml();
    html += '<div class="bento">';
    html += '<div class="card ' + (health.healthy ? 'stat-ok' : 'stat-err') + '"><div class="stat-label">' + ICONS.system + t('System') + '</div>' +
      '<div class="stat">' + badge(health.healthy ? 'ONLINE' : 'DEGRADED') + '</div>' +
      '<div>' + esc(health.summary || '') + '</div></div>';
    html += '<div class="card ' + (poolHealth.healthy ? 'stat-ok' : 'stat-err') + '"><div class="stat-label">' + ICONS.pools + t('Pools') + '</div>' +
      '<div class="stat">' + badge(poolHealth.healthy ? 'ONLINE' : 'DEGRADED') + '</div>' +
      '<div>' + esc(poolHealth.summary || '') + '</div></div>';
    html += '<div class="card ' + alertClass + '"><div class="stat-label">' + ICONS.alerts + t('Active alerts') + '</div>' +
      '<div class="stat">' + alertCount + '</div></div>';
    html += '<div class="card"><div class="stat-label">' + ICONS.version + t('Version') + '</div>' +
      '<div class="stat" style="font-size:14px">' + esc((sys.info || {}).version || '?') + '</div>' +
      '<div>' + esc((sys.info || {}).hostname || '') + '</div></div>';
    html += '</div>';

    if (telemetry) {
      html += renderTelemetryCards(telemetry);
    }

    if (scanning.length) {
      html += '<div class="card"><h2>' + t('Resilver/scrub in progress') + '</h2>';
      scanning.forEach(function (p) {
        var pct = (p.scan && p.scan.percentage) || 0;
        html += '<div style="margin-bottom:10px">' + esc(p.name) + ' — ' +
          esc(p.scan.function || '') + ' ' + pct.toFixed(1) + '%' +
          '<div class="progress"><div data-grow-to="' + pct + '%"></div></div></div>';
      });
      html += '</div>';
    }

    if (sys.update_status_error) {
      html += '<div class="subtab-hint">' + t('Could not read') + ' update.status: ' + esc(sys.update_status_error) + '</div>';
    }
    if (sys.alerts_error) {
      html += '<div class="empty">' + t('Could not read') + ' alerts: ' + esc(sys.alerts_error) + '</div>';
    } else if ((sys.alerts || []).length) {
      html += '<div class="card"><h2>' + t('Alerts') + '</h2><table><thead><tr><th>' + t('Level') + '</th><th>' + t('Message') + '</th></tr></thead><tbody>';
      sys.alerts.slice(0, 20).forEach(function (a) {
        html += '<tr><td>' + badge(a.level || '?') + '</td><td>' + esc(a.formatted || a.text || '') + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    setHTMLSafe(body, html);
    animateFills(body);
    wireSparklineInteractivity(body);
  }

  function renderPools(body, data) {
    body.className = '';
    var pools = data.pools || [], temps = data.temperatures || {};
    if (!pools.length) { body.className = 'empty'; body.innerHTML = t("No pools."); return; }
    var thresholds = instanceThresholds(currentInstanceConfig());
    var html = updatedAtHtml();
    html += '<div class="pool-grid">';
    pools.forEach(function (p) {
      var disks = poolDiskSummary(p);
      var usedPct = p.size ? (p.allocated / p.size * 100) : 0;
      html += '<div class="card pool-card">';
      html += '<h2>' + esc(p.name) + '</h2>';
      // Ring tone follows the pool's OWN health flag first, usage% only as
      // a fallback — a pool sitting at 40% used but already UNHEALTHY (a
      // degraded vdev, say) must not paint a calm, low-usage ring.
      if (p.size) {
        html += '<div class="ring-row">' + ringGauge(usedPct, {
          caption: t("Usage"),
          tone: !p.healthy ? 'stat-err' : pctTone(usedPct, thresholds),
        }) + '<div><div style="font-size:13px">' + formatBytes(p.allocated) + '</div>' +
          '<div class="subtab-hint" style="margin:0">' + t("of") + ' ' + formatBytes(p.size) + '</div></div></div>';
      }
      html += poolRow(!!p.healthy, 'Pool Status', p.status || '?');
      html += poolRow(usedPct < thresholds.warn_pct, 'Used Space',
        formatBytes(p.allocated) + ' of ' + formatBytes(p.size) + ' (' + usedPct.toFixed(1) + '%)');
      html += poolRow(disks.errored === 0, t('Disks with Errors'), disks.errored + ' of ' + disks.total);
      html += poolRow(!p.scan || p.scan.state !== 'SCANNING', 'Last Scrub', lastScrubText(p.scan));
      if (p.scan && p.scan.state === 'SCANNING') {
        html += '<div class="progress"><div data-grow-to="' + (p.scan.percentage || 0) + '%"></div></div>';
      }
      html += '</div>';
    });
    html += '</div>';
    if (data.disks_error) {
      html += '<div class="subtab-hint">' + t('Could not read') + ' disks: ' + esc(data.disks_error) + '</div>';
    }
    if (data.temperatures_error) {
      html += '<div class="subtab-hint">' + t('Could not read') + ' temperatures: ' + esc(data.temperatures_error) + '</div>';
    }
    var diskNames = Object.keys(temps);
    if (diskNames.length) {
      html += '<h2 style="margin-top:16px;font-size:14px">' + t('Temperatures') + '</h2><table><thead><tr><th>' + t('Disk') + '</th><th>' + t('Temp') + '</th></tr></thead><tbody>';
      diskNames.forEach(function (name) {
        html += '<tr><td>' + esc(name) + '</td><td>' + esc(temps[name]) + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    setHTMLSafe(body, html);
    animateFills(body);
  }

  function renderServices(body, items) {
    body.className = '';
    if (!items || !items.length) { body.className = 'empty'; body.innerHTML = t("No services."); return; }
    var html = updatedAtHtml();
    html += '<table><thead><tr><th>Service</th><th>Enabled</th><th>Status</th><th></th></tr></thead><tbody>';
    items.forEach(function (s) {
      var running = String(s.state || '').toUpperCase() === 'RUNNING';
      html += '<tr>' +
        '<td>' + esc(s.service) + '</td>' +
        '<td>' + (s.enable ? t("yes") : t("no")) + '</td>' +
        '<td>' + badge(running ? 'RUNNING' : (s.state || 'STOPPED')) + '</td>' +
        '<td class="row-actions" data-service="' + esc(s.service) + '" data-running="' + running + '"></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    setHTMLSafe(body, html);

    // Buttons wired after innerHTML replaces the DOM (event listeners
    // can't survive being set on a string) — same pattern as
    // renderClientList's per-row "t("Edit") button.
    body.querySelectorAll('td.row-actions').forEach(function (cell) {
      var name = cell.dataset.service;
      var running = cell.dataset.running === 'true';
      var ops = running ? ['stop', 'restart'] : ['start'];
      ops.forEach(function (op) {
        var btn = document.createElement('button');
        btn.className = 'btn secondary';
        btn.textContent = SERVICE_OP_LABEL[op];
        btn.addEventListener('click', function () { openServiceForm(op, name); });
        cell.appendChild(btn);
      });
    });
  }

  var VM_OP_LABEL = { start: 'Start', stop: 'Stop', restart: 'Restart' };
  // Apps have no 'restart' — only 'redeploy' (stop + pull latest images +
  // start), a meaningfully heavier op than a plain restart (confirmed live:
  // app.restart doesn't exist on TrueNAS-25.10.1). Never aliased to
  // "Reiniciar" so the operator isn't misled about what it actually does.
  var APP_OP_LABEL = { start: t('Start'), stop: t('Stop'), redeploy: t('Redeploy') };

  function renderAppsVms(body, data) {
    body.className = '';
    body.innerHTML =
      '<h2 style="font-size:14px">Apps (Docker)</h2><div id="apps-list"></div>' +
      '<h2 style="font-size:14px;margin-top:16px">VMs</h2><div id="vms-list"></div>';

    var appsList = document.getElementById('apps-list');
    if (!data.apps || !data.apps.length) {
      appsList.className = 'empty'; appsList.innerHTML = t("No apps.");
    } else {
      var appsHtml = '<table><thead><tr><th>Name</th><th>Status</th><th></th></tr></thead><tbody>';
      data.apps.forEach(function (a) {
        var running = String(a.state || '').toUpperCase() === 'RUNNING';
        appsHtml += '<tr><td>' + esc(a.name || a.id) + '</td><td>' + badge(a.state || '?') + '</td>' +
          '<td class="row-actions" data-kind="apps" data-id="' + esc(a.name) + '" data-running="' + running + '"></td></tr>';
      });
      appsHtml += '</tbody></table>';
      appsList.innerHTML = appsHtml;
    }

    var vmsList = document.getElementById('vms-list');
    if (!data.vms || !data.vms.length) {
      vmsList.className = 'empty'; vmsList.innerHTML = t("No VMs.");
    } else {
      var vmsHtml = '<table><thead><tr><th>Name</th><th>Status</th><th></th></tr></thead><tbody>';
      data.vms.forEach(function (v) {
        var state = v.status && v.status.state;
        var running = String(state || '').toUpperCase() === 'RUNNING';
        vmsHtml += '<tr><td>' + esc(v.name || v.id) + '</td><td>' + badge(state || '?') + '</td>' +
          '<td class="row-actions" data-kind="vms" data-id="' + esc(v.id) + '" data-running="' + running + '"></td></tr>';
      });
      vmsHtml += '</tbody></table>';
      vmsList.innerHTML = vmsHtml;
    }

    body.querySelectorAll('td.row-actions').forEach(function (cell) {
      var kind = cell.dataset.kind;
      var id = cell.dataset.id;
      var running = cell.dataset.running === 'true';
      var ops = kind === 'vms'
        ? (running ? ['stop', 'restart'] : ['start'])
        : (running ? ['stop', 'redeploy'] : ['start']);
      var labels = kind === 'vms' ? VM_OP_LABEL : APP_OP_LABEL;
      ops.forEach(function (op) {
        var btn = document.createElement('button');
        btn.className = 'btn secondary';
        btn.textContent = labels[op];
        btn.addEventListener('click', function () { openResourceForm(kind, op, id, labels[op]); });
        cell.appendChild(btn);
      });
    });
  }

  function cronText(schedule) {
    if (!schedule) return '?';
    return [schedule.minute, schedule.hour, schedule.dom, schedule.month, schedule.dow]
      .map(function (v) { return v == null ? '*' : v; }).join(' ');
  }

  function lastRunText(job) {
    if (!job) return t("never");
    var when = job.time_finished ? formatEpochMs(job.time_finished) : '';
    return (job.state || '?') + (when ? ' — ' + when : '');
  }

  function renderDataProtection(body, data) {
    body.className = '';
    var html = updatedAtHtml();

    html += '<h2 style="font-size:14px">Cloudsync</h2>';
    if (data.cloudsync_error) {
      html += '<div class="empty">' + t('Could not read') + ': ' + esc(data.cloudsync_error) + '</div>';
    } else if (!data.cloudsync.length) {
      html += '<div class="empty">No cloud sync tasks.</div>';
    } else {
      html += '<table><thead><tr><th>Description</th><th>Path</th><th>Enabled</th><th>Schedule</th><th>Last run</th></tr></thead><tbody>';
      data.cloudsync.forEach(function (t) {
        html += '<tr><td>' + esc(t.description || t.id) + '</td><td>' + esc(t.path || '') + '</td>' +
          '<td>' + (t.enabled ? t("yes") : t("no")) + '</td><td>' + esc(cronText(t.schedule)) + '</td>' +
          '<td>' + badge(lastRunText(t.job).split(' — ')[0]) + ' ' + esc(lastRunText(t.job).split(' — ')[1] || '') + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    html += '<h2 style="font-size:14px;margin-top:16px">Rsync</h2>';
    if (data.rsync_error) {
      html += '<div class="empty">' + t('Could not read') + ': ' + esc(data.rsync_error) + '</div>';
    } else if (!data.rsync.length) {
      html += '<div class="empty">No rsync tasks.</div>';
    } else {
      html += '<table><thead><tr><th>Path</th><th>Remote</th><th>Direction</th><th>Enabled</th><th>Last run</th></tr></thead><tbody>';
      data.rsync.forEach(function (t) {
        html += '<tr><td>' + esc(t.path || '') + '</td><td>' + esc(t.remotehost || '') + ':' + esc(t.remoteport || '') + '</td>' +
          '<td>' + esc(t.direction || '') + '</td><td>' + (t.enabled ? t("yes") : t("no")) + '</td>' +
          '<td>' + esc(lastRunText(t.job)) + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    html += '<h2 style="font-size:14px;margin-top:16px">' + t('Certificates') + '</h2>';
    if (data.certificates_error) {
      html += '<div class="empty">' + t('Could not read') + ': ' + esc(data.certificates_error) + '</div>';
    } else if (!data.certificates.length) {
      html += '<div class="empty">No certificates.</div>';
    } else {
      html += '<table><thead><tr><th>Name</th><th>Common name</th><th>Expires</th><th>Status</th></tr></thead><tbody>';
      data.certificates.forEach(function (c) {
        var status = c.expired ? 'EXPIRADO' : 'OK';
        html += '<tr><td>' + esc(c.name || c.id) + '</td><td>' + esc(c.common || '') + '</td>' +
          '<td>' + esc(c.until || '?') + '</td><td>' + badge(status) + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    setHTMLSafe(body, html);
  }

  function renderShares(body, data) {
    body.className = '';
    body.innerHTML =
      '<h2 style="font-size:14px">SMB</h2><div id="shares-smb"></div>' +
      '<h2 style="font-size:14px;margin-top:16px">NFS</h2><div id="shares-nfs"></div>' +
      '<h2 style="font-size:14px;margin-top:16px">iSCSI targets</h2><div id="shares-iscsi"></div>';

    var smbDiv = document.getElementById('shares-smb');
    if (!data.smb || !data.smb.length) {
      smbDiv.className = 'empty'; smbDiv.innerHTML = t("No SMB shares.");
    } else {
      var smbHtml = '<table><thead><tr><th>Name</th><th>Path</th><th>Enabled</th><th></th></tr></thead><tbody>';
      data.smb.forEach(function (s) {
        smbHtml += '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.path || '') + '</td>' +
          '<td>' + (s.enabled ? t("yes") : t("no")) + '</td>' +
          '<td class="row-actions" data-kind="smb" data-id="' + esc(s.id) + '"></td></tr>';
      });
      smbHtml += '</tbody></table>';
      smbDiv.innerHTML = smbHtml;
    }

    var nfsDiv = document.getElementById('shares-nfs');
    if (!data.nfs || !data.nfs.length) {
      nfsDiv.className = 'empty'; nfsDiv.innerHTML = t("No NFS shares.");
    } else {
      // NFS shares are identified by `path` (a single string) — a prior
      // guess in this codebase assumed a `paths` array (never live-
      // verified at the time); the real field, confirmed live 2026-07-20,
      // is `path` singular.
      var nfsHtml = '<table><thead><tr><th>Path</th><th>Enabled</th><th></th></tr></thead><tbody>';
      data.nfs.forEach(function (s) {
        nfsHtml += '<tr><td>' + esc(s.path || '') + '</td>' +
          '<td>' + (s.enabled ? t("yes") : t("no")) + '</td>' +
          '<td class="row-actions" data-kind="nfs" data-id="' + esc(s.id) + '"></td></tr>';
      });
      nfsHtml += '</tbody></table>';
      nfsDiv.innerHTML = nfsHtml;
    }

    renderSimpleTable(document.getElementById('shares-iscsi'), data.iscsi_targets, [
      [t("Name"), function (t) { return t.name || ''; }],
      ['Alias', function (t) { return t.alias || ''; }],
    ]);

    var shareRows = { smb: data.smb || [], nfs: data.nfs || [] };
    body.querySelectorAll('td.row-actions').forEach(function (cell) {
      var kind = cell.dataset.kind;
      var id = cell.dataset.id;
      var row = shareRows[kind].find(function (s) { return String(s.id) === id; });
      if (!row) return;
      var editBtn = document.createElement('button');
      editBtn.className = 'btn secondary';
      editBtn.textContent = t("Edit");
      editBtn.addEventListener('click', function () { openShareForm(kind, 'update', row); });
      var delBtn = document.createElement('button');
      delBtn.className = 'btn secondary';
      delBtn.textContent = t("Delete");
      delBtn.addEventListener('click', function () { openShareForm(kind, 'delete', row); });
      cell.appendChild(editBtn);
      cell.appendChild(delBtn);
    });
  }

  function renderSimpleTable(body, items, columns) {
    body.className = '';
    if (!items || !items.length) { body.className = 'empty'; body.innerHTML = t("No data."); return; }
    var html = '<table><thead><tr>' + columns.map(function (c) { return '<th>' + esc(c[0]) + '</th>'; }).join('') + '</tr></thead><tbody>';
    items.forEach(function (item) {
      html += '<tr>' + columns.map(function (c) { return '<td>' + esc(c[1](item)) + '</td>'; }).join('') + '</tr>';
    });
    html += '</tbody></table>';
    setHTMLSafe(body, html);
  }

  var RENDERERS = {
    overview: null,  // handled specially in refreshTab
    pools: renderPools,
    datasets: function (body, items) {
      body.className = '';
      body.innerHTML = '';
      if (!items || !items.length) {
        body.className = 'empty';
        body.textContent = t("No datasets.");
        return;
      }
      var table = document.createElement('table');
      table.innerHTML = '<thead><tr><th>Name</th><th>Type</th><th>Usage</th>' +
        '<th>Available</th><th></th></tr></thead>';
      var tbody = document.createElement('tbody');
      items.forEach(function (d) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + esc(d.name || d.id) + '</td>' +
          '<td>' + esc(d.type || '') + '</td>' +
          '<td>' + esc((d.used && d.used.parsed) || '') + '</td>' +
          '<td>' + esc((d.available && d.available.parsed) || '') + '</td>' +
          '<td class="row-actions"></td>';
        var actions = tr.querySelector('td:last-child');
        var editBtn = document.createElement('button');
        editBtn.className = 'btn secondary';
        editBtn.textContent = t("Edit");
        editBtn.addEventListener('click', function () { openDatasetForm('update', d); });
        var delBtn = document.createElement('button');
        delBtn.className = 'btn secondary';
        delBtn.textContent = t("Delete");
        delBtn.addEventListener('click', function () { openDatasetForm('delete', d); });
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      body.appendChild(table);
    },
    snapshots: function (body, data) {
      body.className = '';
      body.innerHTML = '<h2 style="font-size:14px">Snapshots</h2>';
      var snapWrap = document.createElement('div');
      body.appendChild(snapWrap);
      var items = data.snapshots || [];
      if (!items.length) {
        snapWrap.className = 'empty';
        snapWrap.textContent = t("No snapshots.");
      } else {
        var table = document.createElement('table');
        table.innerHTML = '<thead><tr><th>Name</th><th>Dataset</th><th>Created</th><th></th></tr></thead>';
        var tbody = document.createElement('tbody');
        items.forEach(function (s) {
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td>' + esc(s.name || s.id) + '</td>' +
            '<td>' + esc(s.dataset || '') + '</td>' +
            '<td>' + esc((s.properties && s.properties.creation && s.properties.creation.parsed) || '') + '</td>' +
            '<td class="row-actions"></td>';
          var delBtn = document.createElement('button');
          delBtn.className = 'btn secondary';
          delBtn.textContent = t("Delete");
          delBtn.addEventListener('click', function () { openSnapshotForm('delete', s); });
          tr.querySelector('td:last-child').appendChild(delBtn);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        snapWrap.appendChild(table);
      }
      var tasksDiv = document.createElement('div');
      tasksDiv.innerHTML = '<h2 style="font-size:14px;margin-top:16px">' + t("Periodic tasks") + '</h2>';
      body.appendChild(tasksDiv);
      var tasksTable = document.createElement('div');
      tasksDiv.appendChild(tasksTable);
      renderSimpleTable(tasksTable, data.tasks, [
        [t("Dataset"), function (t) { return t.dataset || ''; }],
        ['Schedule', function (t) { return JSON.stringify(t.schedule || {}); }],
        ['Enabled', function (t) { return t.enabled ? t("yes") : t("no"); }],
      ]);
    },
    shares: renderShares,
    replication: function (body, items) {
      renderSimpleTable(body, items, [
        [t("Name"), function (r) { return r.name || r.id; }],
        [t("Status"), function (r) { return (r.state && r.state.state) || r.state || ''; }],
        [t("Last run"), function (r) { return (r.job && r.job.time && r.job.time.finished) || ''; }],
      ]);
    },
    apps: renderAppsVms,
    services: renderServices,
    'data-protection': renderDataProtection,
  };

  // -------------------------------------------------------------------
  // F2: write flows — datasets/snapshots create/update/delete. Every
  // write is: form -> "t("Preview") (dry-run, shows the EXACT method +
  // params that will run, never executes) -> "t("Confirm and run")
  // (enabled immediately for create/update; for delete, only once the
  // typed confirmation field matches the resource's full name exactly,
  // mirroring the server-side guard so the UI never promises a delete the
  // API would refuse anyway).
  // -------------------------------------------------------------------

  function writesDryRun(subsystem, op, payload) {
    return api('writes/dry-run', { method: 'POST', body: { subsystem: subsystem, op: op, payload: payload } });
  }

  function writesExecute(instanceId, subsystem, op, payload) {
    return api('writes/execute', {
      method: 'POST',
      body: { instance_id: instanceId, subsystem: subsystem, op: op, payload: payload },
    });
  }

  function invalidateAndRefetch(tab) {
    delete state.loadedTabs[tab + '::' + state.selectedInstance];
    refreshTab(tab);
  }

  // -- Dataset write form -------------------------------------------------

  var datasetWrite = { op: null, datasetId: null };

  function openDatasetForm(op, row) {
    datasetWrite = { op: op, datasetId: row ? (row.id || row.name) : null };
    document.getElementById('dataset-write-card').hidden = false;
    document.getElementById('dataset-write-title').textContent =
      op === 'create' ? t("New dataset") : (op === 'update' ? 'Edit: ' : 'Delete: ') +
        (datasetWrite.datasetId || '');
    document.getElementById('dataset-write-name-field').hidden = op !== 'create';
    document.getElementById('dataset-write-changes-field').hidden = op === 'delete';
    document.getElementById('dataset-write-confirm-field').hidden = op !== 'delete';
    document.getElementById('dsw-name').value = '';
    document.getElementById('dsw-changes').value = '';
    document.getElementById('dsw-confirm').value = '';
    document.getElementById('dataset-write-preview').textContent = '';
    document.getElementById('dataset-write-result').textContent = '';
    // create/update are safe to run without a typed confirmation (only
    // delete needs one, enabled below by the dsw-confirm input listener) —
    // must NOT disable for 'create' too, or the button is permanently
    // stuck disabled since the confirmation field is hidden and never
    // enables it (this broke dataset creation entirely, F2 review round 2).
    document.getElementById('btn-dataset-confirm').disabled = (op === 'delete');
  }

  function closeDatasetForm() {
    document.getElementById('dataset-write-card').hidden = true;
    datasetWrite = { op: null, datasetId: null };
  }

  // Never silently degrades malformed JSON to {} — a typo in the extra
  // properties field used to create the dataset anyway, minus whatever the
  // operator actually typed, while still reporting success (F2 review
  // round 2 finding). Returns {ok:true, value} or {ok:false, error}.
  function parseJsonField(raw) {
    if (!raw || !raw.trim()) return { ok: true, value: {} };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Returns {payload} on success or {error} if a JSON field didn't parse —
  // callers must check .error and refuse to preview/execute rather than
  // falling back to an empty object.
  function datasetPayload() {
    if (datasetWrite.op === 'create') {
      var extra = parseJsonField(document.getElementById('dsw-changes').value);
      if (!extra.ok) return { error: 'Invalid JSON in "Fields": ' + extra.error };
      var payload = { name: document.getElementById('dsw-name').value.trim() };
      for (var k in extra.value) { payload[k] = extra.value[k]; }
      return { payload: payload };
    }
    if (datasetWrite.op === 'update') {
      var changes = parseJsonField(document.getElementById('dsw-changes').value);
      if (!changes.ok) return { error: 'Invalid JSON in "Fields": ' + changes.error };
      return { payload: { dataset_id: datasetWrite.datasetId, changes: changes.value } };
    }
    return {
      payload: {
        dataset_id: datasetWrite.datasetId,
        confirm_name: document.getElementById('dsw-confirm').value.trim(),
      }
    };
  }

  document.getElementById('btn-new-dataset').addEventListener('click', function () {
    openDatasetForm('create', null);
  });
  document.getElementById('btn-dataset-cancel').addEventListener('click', closeDatasetForm);
  document.getElementById('dsw-confirm').addEventListener('input', function () {
    document.getElementById('btn-dataset-confirm').disabled =
      this.value.trim() !== datasetWrite.datasetId;
  });
  document.getElementById('btn-dataset-preview').addEventListener('click', function () {
    var btn = this;
    var out = document.getElementById('dataset-write-preview');
    var built = datasetPayload();
    if (built.error) { out.textContent = built.error; return; }
    btn.disabled = true;
    out.textContent = t("Querying…");
    writesDryRun('datasets', datasetWrite.op, built.payload).then(function (res) {
      if (res.status !== 200) {
        out.textContent = t((res.data && res.data.error) || 'Unknown error');
        return;
      }
      out.textContent = res.data.method + '(' + JSON.stringify(res.data.params) + ')';
    }).catch(function (e) { out.textContent = networkErrorMessage(e); })
      .finally(function () { btn.disabled = false; });
  });
  document.getElementById('btn-dataset-confirm').addEventListener('click', function () {
    // Guards against a double-click (or real ZFS-write latency) firing
    // writes/execute twice — a second concurrent create fails "already
    // exists" and that error response overwrites the first call's success
    // message, with no server-side idempotency to fall back on (F2 review
    // round 2 finding).
    var btn = this;
    var out = document.getElementById('dataset-write-result');
    var built = datasetPayload();
    if (built.error) { out.textContent = built.error; return; }
    btn.disabled = true;
    out.textContent = t("Running…");
    writesExecute(state.selectedInstance, 'datasets', datasetWrite.op, built.payload)
      .then(function (res) {
        if (res.status >= 400) {
          out.textContent = t((res.data && res.data.error) || 'Unknown error');
          return;
        }
        out.textContent = t('Result: ' + res.data.status) +
          (res.data.job_id ? ' (job_id=' + res.data.job_id + ')' : '');
        if (res.data.status === 'ok') {
          closeDatasetForm();
          invalidateAndRefetch('datasets');
        }
      }).catch(function (e) { out.textContent = networkErrorMessage(e); })
      .finally(function () { btn.disabled = false; });
  });

  // -- Snapshot write form --------------------------------------------------

  var snapshotWrite = { op: null, snapshotId: null };

  function openSnapshotForm(op, row) {
    snapshotWrite = { op: op, snapshotId: row ? (row.id || row.name) : null };
    document.getElementById('snapshot-write-card').hidden = false;
    document.getElementById('snapshot-write-title').textContent =
      op === 'create' ? t("New snapshot") : 'Delete: ' + (snapshotWrite.snapshotId || '');
    document.getElementById('snapshot-create-fields').hidden = op !== 'create';
    document.getElementById('snapshot-recursive-field').hidden = op !== 'create';
    document.getElementById('snapshot-write-confirm-field').hidden = op !== 'delete';
    document.getElementById('ssw-dataset').value = '';
    document.getElementById('ssw-name').value = '';
    document.getElementById('ssw-recursive').checked = false;
    document.getElementById('ssw-confirm').value = '';
    document.getElementById('snapshot-write-preview').textContent = '';
    document.getElementById('snapshot-write-result').textContent = '';
    document.getElementById('btn-snapshot-confirm').disabled = (op !== 'create');
  }

  function closeSnapshotForm() {
    document.getElementById('snapshot-write-card').hidden = true;
    snapshotWrite = { op: null, snapshotId: null };
  }

  function snapshotPayload() {
    if (snapshotWrite.op === 'create') {
      return {
        dataset: document.getElementById('ssw-dataset').value.trim(),
        name: document.getElementById('ssw-name').value.trim(),
        recursive: document.getElementById('ssw-recursive').checked,
      };
    }
    return {
      snapshot_id: snapshotWrite.snapshotId,
      confirm_name: document.getElementById('ssw-confirm').value.trim(),
    };
  }

  document.getElementById('btn-new-snapshot').addEventListener('click', function () {
    openSnapshotForm('create', null);
  });
  document.getElementById('btn-snapshot-cancel').addEventListener('click', closeSnapshotForm);
  document.getElementById('ssw-confirm').addEventListener('input', function () {
    document.getElementById('btn-snapshot-confirm').disabled =
      this.value.trim() !== snapshotWrite.snapshotId;
  });
  document.getElementById('btn-snapshot-preview').addEventListener('click', function () {
    var btn = this;
    var out = document.getElementById('snapshot-write-preview');
    btn.disabled = true;
    out.textContent = t("Querying…");
    writesDryRun('snapshots', snapshotWrite.op, snapshotPayload()).then(function (res) {
      if (res.status !== 200) {
        out.textContent = t((res.data && res.data.error) || 'Unknown error');
        return;
      }
      out.textContent = res.data.method + '(' + JSON.stringify(res.data.params) + ')';
    }).catch(function (e) { out.textContent = networkErrorMessage(e); })
      .finally(function () { btn.disabled = false; });
  });
  document.getElementById('btn-snapshot-confirm').addEventListener('click', function () {
    // Same double-submit guard as the dataset form — see its comment.
    var btn = this;
    var out = document.getElementById('snapshot-write-result');
    btn.disabled = true;
    out.textContent = t("Running…");
    writesExecute(state.selectedInstance, 'snapshots', snapshotWrite.op, snapshotPayload())
      .then(function (res) {
        if (res.status >= 400) {
          out.textContent = t((res.data && res.data.error) || 'Unknown error');
          return;
        }
        out.textContent = t('Result: ' + res.data.status) +
          (res.data.job_id ? ' (job_id=' + res.data.job_id + ')' : '');
        if (res.data.status === 'ok') {
          closeSnapshotForm();
          invalidateAndRefetch('snapshots');
        }
      }).catch(function (e) { out.textContent = networkErrorMessage(e); })
      .finally(function () { btn.disabled = false; });
  });

  // -- VM/App control form (F5: start/stop/restart/redeploy) --------------
  // Same dry-run-then-confirm rationale as services' F4b — stopping/
  // redeploying a real workload should never fire on a single click.

  var resourceWrite = { subsystem: null, op: null, id: null };

  function openResourceForm(subsystem, op, id, opLabel) {
    resourceWrite = { subsystem: subsystem, op: op, id: id };
    document.getElementById('resource-write-card').hidden = false;
    document.getElementById('resource-write-title').textContent = opLabel + ': ' + id;
    document.getElementById('resource-write-preview').textContent = '';
    document.getElementById('resource-write-result').textContent = '';
  }

  function closeResourceForm() {
    document.getElementById('resource-write-card').hidden = true;
    resourceWrite = { subsystem: null, op: null, id: null };
  }

  function resourcePayload() {
    return resourceWrite.subsystem === 'vms'
      ? { vm_id: resourceWrite.id }
      : { app_name: resourceWrite.id };
  }

  document.getElementById('btn-resource-cancel').addEventListener('click', closeResourceForm);
  document.getElementById('btn-resource-preview').addEventListener('click', function () {
    var btn = this;
    var out = document.getElementById('resource-write-preview');
    btn.disabled = true;
    out.textContent = t("Querying…");
    writesDryRun(resourceWrite.subsystem, resourceWrite.op, resourcePayload()).then(function (res) {
      if (res.status !== 200) {
        out.textContent = t((res.data && res.data.error) || 'Unknown error');
        return;
      }
      out.textContent = res.data.method + '(' + JSON.stringify(res.data.params) + ')';
    }).catch(function (e) { out.textContent = networkErrorMessage(e); })
      .finally(function () { btn.disabled = false; });
  });
  document.getElementById('btn-resource-confirm').addEventListener('click', function () {
    // Same double-submit guard as every other write confirm — see dataset
    // form's comment.
    var btn = this;
    var out = document.getElementById('resource-write-result');
    btn.disabled = true;
    out.textContent = t("Running…");
    writesExecute(state.selectedInstance, resourceWrite.subsystem, resourceWrite.op, resourcePayload())
      .then(function (res) {
        if (res.status >= 400) {
          out.textContent = t((res.data && res.data.error) || 'Unknown error');
          return;
        }
        out.textContent = t('Result: ' + res.data.status) +
          (res.data.job_id ? ' (job_id=' + res.data.job_id + ')' : '');
        if (res.data.status === 'ok') {
          closeResourceForm();
          invalidateAndRefetch('apps');
        }
      }).catch(function (e) { out.textContent = networkErrorMessage(e); })
      .finally(function () { btn.disabled = false; });
  });

  // -- SMB/NFS share write form (F4c: create/update/delete) ---------------
  // A single form adapts its fields to `kind` ('smb'|'nfs') and `op`
  // ('create'|'update'|'delete') — mirrors the dataset form's op-based
  // field toggling. Delete's confirmation is against the share's real
  // name (SMB) or path (NFS), never against its opaque numeric id, same
  // rationale as datasets confirming against the dataset's own path.

  var shareWrite = { kind: null, op: null, id: null, expected: null };

  function openShareForm(kind, op, row) {
    shareWrite = {
      kind: kind, op: op,
      id: row ? row.id : null,
      expected: row ? (kind === 'smb' ? row.name : row.path) : null,
    };
    var card = document.getElementById('share-write-card');
    card.hidden = false;
    var kindLabel = kind === 'smb' ? 'SMB' : 'NFS';
    document.getElementById('share-write-title').textContent =
      op === 'create' ? t("New share") + ' ' + kindLabel :
        (op === 'update' ? 'Edit: ' : 'Delete: ') + (shareWrite.expected || '');

    document.getElementById('share-write-name-field').hidden = kind !== 'smb';
    document.getElementById('share-write-browsable-field').hidden = kind !== 'smb';
    document.getElementById('share-write-hosts-field').hidden = kind !== 'nfs';
    document.getElementById('share-write-networks-field').hidden = kind !== 'nfs';
    document.getElementById('share-write-confirm-field').hidden = op !== 'delete';
    document.getElementById('shw-readonly-label').textContent =
      kind === 'smb' ? t("read-only") : t("read-only") + ' (ro)';

    document.getElementById('shw-name').value = row ? (row.name || '') : '';
    document.getElementById('shw-path').value = row ? (row.path || '') : '';
    document.getElementById('shw-comment').value = row ? (row.comment || '') : '';
    document.getElementById('shw-enabled').checked = row ? !!row.enabled : true;
    document.getElementById('shw-readonly').checked = row ? !!(row.readonly || row.ro) : false;
    document.getElementById('shw-browsable').checked = row ? row.browsable !== false : true;
    document.getElementById('shw-hosts').value = row && row.hosts ? row.hosts.join(', ') : '';
    document.getElementById('shw-networks').value = row && row.networks ? row.networks.join(', ') : '';
    document.getElementById('shw-confirm').value = '';
    document.getElementById('share-write-preview').textContent = '';
    document.getElementById('share-write-result').textContent = '';
    // Same rationale as the dataset form: only 'delete' needs a typed
    // confirmation before its confirm button is usable.
    document.getElementById('btn-share-confirm').disabled = (op === 'delete');
  }

  function closeShareForm() {
    document.getElementById('share-write-card').hidden = true;
    shareWrite = { kind: null, op: null, id: null, expected: null };
  }

  function splitCsv(raw) {
    return raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function shareFields() {
    var fields = {
      path: document.getElementById('shw-path').value.trim(),
      comment: document.getElementById('shw-comment').value.trim(),
      enabled: document.getElementById('shw-enabled').checked,
    };
    if (shareWrite.kind === 'smb') {
      fields.name = document.getElementById('shw-name').value.trim();
      fields.readonly = document.getElementById('shw-readonly').checked;
      fields.browsable = document.getElementById('shw-browsable').checked;
    } else {
      fields.ro = document.getElementById('shw-readonly').checked;
      fields.hosts = splitCsv(document.getElementById('shw-hosts').value);
      fields.networks = splitCsv(document.getElementById('shw-networks').value);
    }
    return fields;
  }

  function sharePayload() {
    var subsystem = shareWrite.kind === 'smb' ? 'smb_shares' : 'nfs_shares';
    if (shareWrite.op === 'delete') {
      var confirmField = document.getElementById('shw-confirm').value.trim();
      var payload = { share_id: shareWrite.id, confirm_name: confirmField };
      payload[shareWrite.kind === 'smb' ? 'expected_name' : 'expected_path'] = shareWrite.expected;
      return { subsystem: subsystem, payload: payload };
    }
    if (shareWrite.op === 'create') {
      return { subsystem: subsystem, payload: { fields: shareFields() } };
    }
    return { subsystem: subsystem, payload: { share_id: shareWrite.id, fields: shareFields() } };
  }

  document.getElementById('btn-new-smb').addEventListener('click', function () {
    openShareForm('smb', 'create', null);
  });
  document.getElementById('btn-new-nfs').addEventListener('click', function () {
    openShareForm('nfs', 'create', null);
  });
  document.getElementById('btn-share-cancel').addEventListener('click', closeShareForm);
  document.getElementById('shw-confirm').addEventListener('input', function () {
    document.getElementById('btn-share-confirm').disabled = this.value.trim() !== shareWrite.expected;
  });
  document.getElementById('btn-share-preview').addEventListener('click', function () {
    var btn = this;
    var out = document.getElementById('share-write-preview');
    var built = sharePayload();
    btn.disabled = true;
    out.textContent = t("Querying…");
    writesDryRun(built.subsystem, shareWrite.op, built.payload).then(function (res) {
      if (res.status !== 200) {
        out.textContent = t((res.data && res.data.error) || 'Unknown error');
        return;
      }
      out.textContent = res.data.method + '(' + JSON.stringify(res.data.params) + ')';
    }).catch(function (e) { out.textContent = networkErrorMessage(e); })
      .finally(function () { btn.disabled = false; });
  });
  document.getElementById('btn-share-confirm').addEventListener('click', function () {
    // Same double-submit guard as every other write confirm.
    var btn = this;
    var out = document.getElementById('share-write-result');
    var built = sharePayload();
    btn.disabled = true;
    out.textContent = t("Running…");
    writesExecute(state.selectedInstance, built.subsystem, shareWrite.op, built.payload)
      .then(function (res) {
        if (res.status >= 400) {
          out.textContent = t((res.data && res.data.error) || 'Unknown error');
          return;
        }
        out.textContent = t('Result: ' + res.data.status);
        if (res.data.status === 'ok') {
          closeShareForm();
          invalidateAndRefetch('shares');
        }
      }).catch(function (e) { out.textContent = networkErrorMessage(e); })
      .finally(function () { btn.disabled = false; });
  });

  // -- Service control form (F4b: start/stop/restart) --------------------
  // No fields to type — service name + op are already known from the row
  // clicked — but still goes through the same dry-run-then-confirm flow as
  // datasets/snapshots rather than firing on a single click, since a
  // stopped SMB/NFS/iSCSI service can break something a real client
  // depends on right now.

  var serviceWrite = { op: null, service: null };
  var SERVICE_OP_LABEL = { start: t('Start'), stop: t('Stop'), restart: t('Restart') };

  function openServiceForm(op, serviceName) {
    serviceWrite = { op: op, service: serviceName };
    document.getElementById('service-write-card').hidden = false;
    document.getElementById('service-write-title').textContent =
      SERVICE_OP_LABEL[op] + ': ' + serviceName;
    document.getElementById('service-write-preview').textContent = '';
    document.getElementById('service-write-result').textContent = '';
  }

  function closeServiceForm() {
    document.getElementById('service-write-card').hidden = true;
    serviceWrite = { op: null, service: null };
  }

  document.getElementById('btn-service-cancel').addEventListener('click', closeServiceForm);
  document.getElementById('btn-service-preview').addEventListener('click', function () {
    var btn = this;
    var out = document.getElementById('service-write-preview');
    btn.disabled = true;
    out.textContent = t("Querying…");
    writesDryRun('services', serviceWrite.op, { service: serviceWrite.service }).then(function (res) {
      if (res.status !== 200) {
        out.textContent = t((res.data && res.data.error) || 'Unknown error');
        return;
      }
      out.textContent = res.data.method + '(' + JSON.stringify(res.data.params) + ')';
    }).catch(function (e) { out.textContent = networkErrorMessage(e); })
      .finally(function () { btn.disabled = false; });
  });
  document.getElementById('btn-service-confirm').addEventListener('click', function () {
    // Same double-submit guard as dataset/snapshot confirm — see their comment.
    var btn = this;
    var out = document.getElementById('service-write-result');
    btn.disabled = true;
    out.textContent = t("Running…");
    writesExecute(state.selectedInstance, 'services', serviceWrite.op, { service: serviceWrite.service })
      .then(function (res) {
        if (res.status >= 400) {
          out.textContent = t((res.data && res.data.error) || 'Unknown error');
          return;
        }
        out.textContent = t('Result: ' + res.data.status);
        if (res.data.status === 'ok') {
          closeServiceForm();
          invalidateAndRefetch('services');
        }
      }).catch(function (e) { out.textContent = networkErrorMessage(e); })
      .finally(function () { btn.disabled = false; });
  });

})();
