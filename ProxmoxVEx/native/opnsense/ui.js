/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        ProxmoxVEx/native/opnsense/ui.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Ui JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
(async function applyThemeAndI18n() {
  const params = new URLSearchParams(location.search);
  const theme = params.get("theme") || "";
  if (/light/i.test(theme)) {
    document.documentElement.classList.add("theme-light");
  }
  const supported = (window.parent.ProxmoxVExSupportedLangs) || ['de', 'en', 'it', 'fr', 'es', 'pt', 'ko'];
  const lang = (() => {
    try {
      const p = window.parent.ProxmoxVExLanguage;
      if (p && supported.includes(p)) return p;
    } catch (e) { }
    const q = params.get("lang") || '';
    const base = q.split(/[-_]/)[0].toLowerCase();
    if (supported.includes(base)) return base;
    return 'en';
  })();
  document.documentElement.lang = lang;

  // Load the native OPNsense i18n namespace and expose translate helpers globally.
  // If the parent i18n system is unavailable, t()/tf() return the fallback key so
  // hard-coded English labels remain visible rather than raw i18n keys.
  let _parentI18n = null;
  try { _parentI18n = window.parent.ProxmoxVExI18n; } catch (e) { }
  if (_parentI18n) {
    await _parentI18n.loadPluginNamespaceFull('opnsense', '/api/native/opnsense/i18n');
  }
  function t(key) {
    if (_parentI18n) return _parentI18n.t(key, { ns: 'opnsense' });
    return key;
  }
  function tf(key) {
    let s = t(key);
    for (let i = 1; i < arguments.length; i++) {
      s = s.replace('%s', String(arguments[i])).replace('%d', String(arguments[i]));
    }
    return s;
  }
  function applyStaticI18n() {
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
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-title');
      const translated = t(key);
      if (translated !== key) el.setAttribute('title', translated);
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-aria-label');
      const translated = t(key);
      if (translated !== key) el.setAttribute('aria-label', translated);
    });
  }
  window.t = t;
  window.tf = tf;
  applyStaticI18n();
  document.title = t('page_title');
})();

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const el = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("aria-") || k === "role") n.setAttribute(k, v);
    else if (k.startsWith("data-")) n.setAttribute(k, v);
    else n[k] = v;
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null) continue;
    n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return n;
};
const fmtBytes = (n) => {
  if (!n || n < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`;
};
const meterClass = (p) => p > 85 ? "crit" : p > 65 ? "high" : "";
const escapeText = (s) => String(s ?? "").replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

// ---------- traffic samples (in-memory ring buffer per iface) ----------
// OPNsense exposes acumulative byte counters; we compute rates client-side
// by diffing samples poll-to-poll. Window kept small (60 samples) so the
// memory footprint stays trivial even on busy firewalls.
const TRAFFIC_WINDOW = 60;
const trafficSamples = new Map(); // iface name -> [{t, rx, tx}]
const trafficRates = new Map();   // iface name -> [{t, rxRate, txRate}]

function pushTrafficSample(name, rxBytes, txBytes) {
  const t = Date.now();
  let buf = trafficSamples.get(name);
  if (!buf) { buf = []; trafficSamples.set(name, buf); }
  const last = buf[buf.length - 1];
  buf.push({ t, rx: rxBytes, tx: txBytes });
  if (buf.length > TRAFFIC_WINDOW) buf.shift();

  if (last) {
    const dt = (t - last.t) / 1000;
    let rates = trafficRates.get(name);
    if (!rates) { rates = []; trafficRates.set(name, rates); }
    // Counter wrap or reset → drop the negative delta to 0.
    const drx = Math.max(0, rxBytes - last.rx);
    const dtx = Math.max(0, txBytes - last.tx);
    rates.push({
      t,
      rxRate: dt > 0 ? drx / dt : 0,
      txRate: dt > 0 ? dtx / dt : 0,
    });
    if (rates.length > TRAFFIC_WINDOW) rates.shift();
  }
}

// Caches so the drilldown can show iface metadata + neighbors.
const lastInterfaces = new Map(); // name -> row object
let lastArp = [], lastNdp = [];

function ingestInterfaces(rows) {
  for (const i of rows || []) {
    pushTrafficSample(i.name, i.received_bytes || 0, i.sent_bytes || 0);
    lastInterfaces.set(i.name, i);
  }
}

function fmtRate(bytesPerSec) {
  return fmtBytes(bytesPerSec) + "/s";
}

function sparkline(name) {
  const rates = trafficRates.get(name) || [];
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "spark");
  svg.setAttribute("viewBox", "0 0 80 18");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  if (rates.length < 2) return svg;
  const max = Math.max(1, ...rates.map(r => Math.max(r.rxRate, r.txRate)));
  const xStep = 80 / (TRAFFIC_WINDOW - 1);
  function pathFor(key, cls) {
    const offset = TRAFFIC_WINDOW - rates.length;
    const pts = rates.map((r, i) => {
      const x = (offset + i) * xStep;
      const y = 18 - (r[key] / max) * 16 - 1;
      return [x, y];
    });
    const first = pts[0];
    const last = pts[pts.length - 1];
    let d = `M${first[0].toFixed(1)},18 L${first[0].toFixed(1)},${first[1].toFixed(1)}`;
    for (const p of pts.slice(1)) d += ` L${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    d += ` L${last[0].toFixed(1)},18 Z`;
    const p = document.createElementNS(svgNS, "path");
    p.setAttribute("d", d);
    p.setAttribute("class", cls);
    return p;
  }
  svg.appendChild(pathFor("rxRate", "rx"));
  svg.appendChild(pathFor("txRate", "tx"));
  return svg;
}

function getCurrentRate(name) {
  const rates = trafficRates.get(name) || [];
  const last = rates[rates.length - 1];
  return last ? { rx: last.rxRate, tx: last.txRate } : { rx: 0, tx: 0 };
}

function trafficChart(rows) {
  // Pick top 4 by current total throughput.
  const ranked = (rows || [])
    .map(i => {
      const r = getCurrentRate(i.name);
      return { name: i.name, label: i.label || i.name, total: r.rx + r.tx };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);

  const colors = ["#e57000", "#22c55e", "#3b82f6", "#eab308"];
  const W = 800, H = 240, padL = 56, padR = 12, padT = 12, padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  // Build a unified time axis from the longest series among the picks.
  let maxLen = 0;
  for (const p of ranked) {
    const r = trafficRates.get(p.name) || [];
    if (r.length > maxLen) maxLen = r.length;
  }
  const xStep = maxLen > 1 ? innerW / (maxLen - 1) : 0;

  let yMax = 1;
  for (const p of ranked) {
    const r = trafficRates.get(p.name) || [];
    for (const s of r) {
      if (s.rxRate + s.txRate > yMax) yMax = s.rxRate + s.txRate;
    }
  }

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "area-chart");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Interface traffic");

  // grid lines + y labels
  const ticks = 4;
  const axis = document.createElementNS(svgNS, "g");
  axis.setAttribute("class", "axis");
  for (let k = 0; k <= ticks; k++) {
    const v = (yMax * k) / ticks;
    const y = padT + innerH - (innerH * k) / ticks;
    const ln = document.createElementNS(svgNS, "line");
    ln.setAttribute("class", "grid-line");
    ln.setAttribute("x1", padL); ln.setAttribute("x2", W - padR);
    ln.setAttribute("y1", y); ln.setAttribute("y2", y);
    axis.appendChild(ln);
    const tx = document.createElementNS(svgNS, "text");
    tx.setAttribute("x", padL - 6);
    tx.setAttribute("y", y + 3);
    tx.setAttribute("text-anchor", "end");
    tx.textContent = fmtRate(v);
    axis.appendChild(tx);
  }
  svg.appendChild(axis);

  // each interface gets its own area path (rx+tx combined for legibility)
  ranked.forEach((p, idx) => {
    const r = trafficRates.get(p.name) || [];
    if (r.length < 2) return;
    const offset = maxLen - r.length;
    const pts = r.map((s, i) => {
      const x = padL + (offset + i) * xStep;
      const v = s.rxRate + s.txRate;
      const y = padT + innerH - (v / yMax) * innerH;
      return [x, y];
    });
    const first = pts[0];
    const last = pts[pts.length - 1];
    let d = `M${first[0].toFixed(1)},${(padT + innerH).toFixed(1)} L${first[0].toFixed(1)},${first[1].toFixed(1)}`;
    for (const pt of pts.slice(1)) d += ` L${pt[0].toFixed(1)},${pt[1].toFixed(1)}`;
    d += ` L${last[0].toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", colors[idx] + "33");
    path.setAttribute("stroke", colors[idx]);
    path.setAttribute("stroke-width", "1.5");
    svg.appendChild(path);
  });

  // legend
  const legend = el("div", { class: "legend" });
  ranked.forEach((p, idx) => {
    const r = getCurrentRate(p.name);
    const total = fmtRate(r.rx + r.tx);
    legend.appendChild(el("span", {}, [
      el("span", { class: "dot", style: `background:${colors[idx]}` }),
      document.createTextNode(`${p.label} · ${total}`),
    ]));
  });
  if (!ranked.length) {
    legend.appendChild(el("span", { class: "dim", text: t('waiting_for_samples') }));
  }

  const cell = el("section", { class: "card span-12 chart-card", "aria-label": "Interface traffic" }, [
    el("p", {}, t("[ live traffic ]")),
  ]);
  cell.appendChild(svg);
  cell.appendChild(legend);
  return cell;
}

// Endpoints resolve under /api/opnsense/<x> when served by
// ProxmoxVEx (this HTML lives at /api/opnsense/ui).
const ENDPOINTS = {
  health: "health",
  cluster: "cluster",
  overview: "overview",
  network: "network",
  logs: "logs",
  nat: "nat",
  oneToOne: "one_to_one",
  dhcp: "dhcp",
  dhcpSubnet: "dhcp_subnet",
  unbound: "unbound",
  unboundDomains: "unbound_domains",
  unboundDots: "unbound_dots",
  wg: "wg",
};

// v1.13.0 cluster-mode state.
// `info` is the latest /api/health snapshot (cluster_mode boolean, hosts_configured).
// `lastCluster` is the latest /api/cluster payload — used by the overview tab
// when cluster_mode is on AND for the always-on cluster bar at the top.
const cluster = {
  enabled: false,
  info: null,
  lastCluster: null,
};

async function fetchJson(url) {
  const r = await fetch(url, { credentials: "same-origin" });
  if (r.status === 401) throw Object.assign(new Error("auth"), { kind: "auth" });
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json()).detail || ""; } catch { }
    throw Object.assign(new Error(`HTTP ${r.status}`), { kind: "upstream", detail });
  }
  const body = await r.json();
  if (!body.ok) throw Object.assign(new Error(body.error || "upstream"), { kind: body.error || "upstream", detail: body.detail });
  return body.data;
}

// ---------- shared header ----------
function renderHeader(system) {
  $("#conn-host").textContent = system?.name || "—";
  const versions = (system?.versions || []).join(" · ");
  $("#conn-version").textContent = versions;
  $("#conn").title = versions;
}

// ---------- overview cells ----------
function cellSystem(s) {
  const memPct = s.memory_used_pct || 0;
  const pfPct = s.pf_states_pct || 0;
  return el("section", { class: "card span-4", "aria-label": "Sistema" }, [
    el("p", {}, t("[ system ]")),
    el("p", { class: "lead", text: s.name || "—" }),
    el("div", { class: "sub", text: (s.versions || []).join(" / ") || "version desconocida" }),
    el("div", { class: "meter " + meterClass(memPct) }, [
      el("span", { class: "label", text: t('ram') + (s.memory_used_mb || 0) + "/" + (s.memory_total_mb || 0) + " MB" }),
      el("span", { class: "value", text: memPct.toFixed(1) + "%" }),
      el("span", { class: "bar" }, [el("i", { style: `width:${memPct}%` })]),
    ]),
    el("div", { class: "meter " + meterClass(pfPct) }, [
      el("span", { class: "label", text: t('pf_states') + (s.pf_states_current || 0) + " / " + (s.pf_states_limit || 0) }),
      el("span", { class: "value", text: pfPct.toFixed(2) + "%" }),
      el("span", { class: "bar" }, [el("i", { style: `width:${pfPct}%` })]),
    ]),
    el("div", { class: "sub", text: `Load ${(s.loadavg || []).map(n => n.toFixed(2)).join("  ") || "—"}  ·  Up ${s.uptime || "—"}` }),
  ]);
}

function cellHA(h) {
  const enabled = !!h.enabled;
  const badge = el("span", {
    class: "badge " + (enabled ? "badge-green" : "badge-muted"),
    text: enabled ? "Activo" : "Inactivo",
  });
  return el("section", { class: "card span-4", "aria-label": "HA Sync" }, [
    el("p", {}, t("[ ha sync ]")),
    el("p", { class: "lead" }, [el("span", { class: "accent", text: enabled ? "ON" : "OFF" })]),
    el("div", { class: "sub", text: `Iface ${h.pfsync_interface || "—"} · Peer ${h.pfsync_peer_ip || "—"}` }),
    el("div", { class: "sub", text: `Version ${h.pfsync_version || "—"}` }),
    el("div", { class: "chip-row", style: "margin-top:8px;" }, [badge]),
  ]);
}

function cellCerts(c) {
  const expiringSoon = c.expiring_soon_count > 0;
  const badgeCls = expiringSoon ? "badge-yellow" : "badge-green";
  const badgeText = expiringSoon ? `${c.expiring_soon_count} expiring soon` : "All valid";
  return el("section", { class: "card span-4", "aria-label": "Certificados" }, [
    el("p", {}, t("[ certs ]")),
    el("p", { class: "lead" }, [el("span", { class: "accent", text: String(c.total) })]),
    el("div", { class: "sub", text: `${c.expiring_soon_count} expire in 30 days` }),
    el("div", { class: "chip-row", style: "margin-top:8px;" }, [
      el("span", { class: "badge " + badgeCls, text: badgeText }),
    ]),
  ]);
}

function cellInterfaces(rows, span = "span-8") {
  const cell = el("section", { class: "card " + span, "aria-label": "Interfaces" }, [
    el("p", {}, t("[ interfaces ]")),
  ]);
  const table = el("table", { class: "tt" });
  table.innerHTML = `
      <caption>${t("Interfaces con contadores y rate en vivo")}</caption>
      <thead><tr>
        <th>${t("Iface")}</th><th>${t("State")}</th><th>${t("IPv4")}</th>
        <th>${t("Traffic")}</th>
        <th class="num">${t("Rate")}</th>
        <th class="num">${t("RX")}</th><th class="num">${t("TX")}</th><th class="num">${t("Err/Drop")}</th>
      </tr></thead><tbody></tbody>`;
  const tb = $("tbody", table);
  for (const i of rows) {
    const ip4 = (i.ipv4 || []).map(x => `${x.ipaddr}/${x.subnetbits}`).join(" ") || "—";
    const stateChip = i.is_up
      ? `<span class="badge badge-green">${t("UP")}</span>`
      : `<span class="badge badge-red">${t("DOWN")}</span>`;
    const tr = document.createElement("tr");
    const tdIface = document.createElement("td");
    tdIface.innerHTML = `<button class="iface-link" data-iface="${escapeText(i.name)}" type="button"><b>${escapeText(i.name)}</b></button><div class="dim" style="font-size:11px;">${escapeText(i.label || "")}</div>`;
    const tdState = document.createElement("td"); tdState.innerHTML = stateChip;
    const tdIp = document.createElement("td"); tdIp.className = "dim mono"; tdIp.textContent = ip4;
    const tdSpark = document.createElement("td"); tdSpark.appendChild(sparkline(i.name));
    const r = getCurrentRate(i.name);
    const tdRate = document.createElement("td");
    tdRate.className = "num rate";
    tdRate.innerHTML = `<span class="rx">↓ ${fmtRate(r.rx)}</span><br><span class="tx">↑ ${fmtRate(r.tx)}</span>`;
    const tdRx = document.createElement("td"); tdRx.className = "num"; tdRx.textContent = fmtBytes(i.received_bytes);
    const tdTx = document.createElement("td"); tdTx.className = "num"; tdTx.textContent = fmtBytes(i.sent_bytes);
    const tdErr = document.createElement("td"); tdErr.className = "num";
    tdErr.textContent = `${i.received_errors + i.send_errors} / ${i.dropped_packets}`;
    tr.append(tdIface, tdState, tdIp, tdSpark, tdRate, tdRx, tdTx, tdErr);
    tb.appendChild(tr);
  }
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="8" class="dim">${t("No interfaces reported.")}</td></tr>`;
  }
  cell.appendChild(table);
  return cell;
}

function cellGateways(rows, span = "span-4") {
  const cell = el("section", { class: "card " + span, "aria-label": "Gateways" }, [
    el("p", {}, t("[ gateways ]")),
  ]);
  const table = el("table", { class: "tt" });
  table.innerHTML = `
      <caption>${t("Gateways with RTT and loss")}</caption>
      <thead><tr>
        <th>${t("Nombre")}</th><th>${t("State")}</th><th class="num">${t("RTT")}</th><th class="num">${t("Loss")}</th>
      </tr></thead><tbody></tbody>`;
  const tb = $("tbody", table);
  for (const g of rows) {
    const tr = document.createElement("tr");
    const cls = g.is_up ? "badge-green" : "badge-red";
    tr.innerHTML = `
        <td><b>${escapeText(g.name)}</b><div class="dim mono" style="font-size:11px;">${escapeText(g.address)}</div></td>
        <td><span class="badge ${cls}">${escapeText(g.status_human || g.status)}</span></td>
        <td class="num">${g.delay_ms ? g.delay_ms.toFixed(1) + " " + t("ms") : "—"}</td>
        <td class="num">${g.loss_pct ? g.loss_pct.toFixed(1) + "%" : "—"}</td>`;
    tb.appendChild(tr);
  }
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="4" class="dim">${t("No gateways configured.")}</td></tr>`;
  }
  cell.appendChild(table);
  return cell;
}

function cellServices(s) {
  const cell = el("section", { class: "card span-6", "aria-label": "Servicios" }, [
    el("p", {}, t("[ servicios ]")),
    el("p", { class: "lead" }, [
      el("span", { class: "accent", text: String(s.running) }),
      document.createTextNode(` / ${s.total}`),
    ]),
    el("div", { class: "sub", text: `${s.stopped} detenidos` }),
  ]);
  if (s.stopped > 0) {
    const stopped = s.items.filter(x => !x.running).slice(0, 6).map(x => x.name);
    cell.appendChild(el("div", {
      class: "sub",
      style: "margin-top:8px;",
      text: t('detenidos') + stopped.join(", "),
    }));
  }
  return cell;
}

function cellVPNSummary(v) {
  const wgChip = el("span", {
    class: "badge " + (v.wireguard_enabled ? "badge-green" : "badge-muted"),
    text: t('wireguard') + (v.wireguard_enabled ? "ON" : "OFF"),
  });
  const ipsecChip = el("span", { class: "badge badge-blue", text: `IPsec ${v.ipsec_phase1.length}` });
  const ovpnChip = el("span", { class: "badge badge-blue", text: `OpenVPN ${v.openvpn_sessions.length}` });
  const lead = `${v.wireguard_peers.length} WG · ${v.ipsec_phase1.length} IPSEC · ${v.openvpn_sessions.length} OVPN`;
  return el("section", { class: "card span-6", "aria-label": "VPN" }, [
    el("p", {}, t("[ vpn ]")),
    el("p", { class: "lead", text: lead }),
    el("div", { class: "chip-row", style: "margin-top:8px;" }, [wgChip, ipsecChip, ovpnChip]),
  ]);
}

function renderOverview(data) {
  return [
    cellSystem(data.system),
    cellHA(data.hasync),
    cellCerts(data.certs),
    el("h2", { class: "section-title" }, [
      el("b", { text: t('data_plane') }),
      document.createTextNode("interfaces · gateways · routing"),
    ]),
    cellInterfaces(data.interfaces),
    cellGateways(data.gateways),
    el("h2", { class: "section-title" }, [
      el("b", { text: t('control_plane') }),
      document.createTextNode("services · vpn · certs"),
    ]),
    cellServices(data.services),
    cellVPNSummary(data.vpn),
  ];
}

// ---------- network tab ----------
function cellRoutes(rows) {
  const cell = el("section", { class: "card span-6", "aria-label": "Tabla de rutas" }, [
    el("p", {}, t("[ routes ]")),
  ]);
  const table = el("table", { class: "tt" });
  table.innerHTML = `
      <caption>${t("Tabla de enrutamiento")}</caption>
      <thead><tr>
        <th>${t("Destino")}</th><th>${t("Gateway")}</th><th>${t("Iface")}</th><th>${t("Flags")}</th><th class="num">${t("MTU")}</th>
      </tr></thead><tbody></tbody>`;
  const tb = $("tbody", table);
  for (const r of rows.slice(0, 50)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td class="mono">${escapeText(r.destination)}</td>
        <td class="mono dim">${escapeText(r.gateway || "—")}</td>
        <td>${escapeText(r.interface || r.netif)}</td>
        <td class="dim mono">${escapeText(r.flags)}</td>
        <td class="num">${r.mtu || "—"}</td>`;
    tb.appendChild(tr);
  }
  if (!rows.length) tb.innerHTML = `<tr><td colspan="5" class="dim">${t("No routes reported.")}</td></tr>`;
  cell.appendChild(table);
  if (rows.length > 50) cell.appendChild(el("div", { class: "sub", text: tf('showing_x_of_y', 50, rows.length) }));
  return cell;
}

function cellNeighbors(rows, family) {
  const title = family === "ipv4" ? "[ arp neighbors ]" : "[ ndp neighbors ]";
  const cell = el("section", { class: "card span-6", "aria-label": title }, [
    el("p", { class: "title", text: title }),
  ]);
  const table = el("table", { class: "tt" });
  table.innerHTML = `
      <caption>${t("Discovered neighbors")}</caption>
      <thead><tr>
        <th>${family === "ipv4" ? "IPv4" : "IPv6"}</th><th>${t("MAC")}</th><th>${t("Iface")}</th><th>${t("Host")}</th>
      </tr></thead><tbody></tbody>`;
  const tb = $("tbody", table);
  for (const r of rows.slice(0, 50)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td class="mono">${escapeText(r.ip)}</td>
        <td class="mono dim">${escapeText(r.mac || "—")}</td>
        <td>${escapeText(r.interface || r.interface_name || "—")}</td>
        <td class="dim">${escapeText(r.hostname || r.manufacturer || "—")}</td>`;
    tb.appendChild(tr);
  }
  if (!rows.length) tb.innerHTML = `<tr><td colspan="4" class="dim">${t("No neighbors discovered.")}</td></tr>`;
  cell.appendChild(table);
  if (rows.length > 50) cell.appendChild(el("div", { class: "sub", text: tf('showing_x_of_y', 50, rows.length) }));
  return cell;
}

function renderNetwork(data) {
  lastArp = data.arp || [];
  lastNdp = data.ndp || [];
  return [
    trafficChart(data.interfaces),
    cellInterfaces(data.interfaces, "span-12"),
    cellGateways(data.gateways, "span-6"),
    cellRoutes(data.routes),
    cellNeighbors(data.arp, "ipv4"),
    cellNeighbors(data.ndp, "ipv6"),
  ];
}

// ---------- vpn tab ----------
function tableWG(rows) {
  const cell = el("section", { class: "card span-12", "aria-label": "Peers WireGuard" }, [
    el("p", {}, t("[ wireguard peers ]")),
  ]);
  const table = el("table", { class: "tt" });
  table.innerHTML = `
      <caption>${t("Peers WireGuard")}</caption>
      <thead><tr>
        <th>${t("Nombre")}</th><th>${t("Pubkey")}</th><th>${t("State")}</th><th>${t("Endpoint")}</th>
        <th class="num">${t("RX")}</th><th class="num">${t("TX")}</th><th>${t("Latest handshake")}</th>
      </tr></thead><tbody></tbody>`;
  const tb = $("tbody", table);
  for (const p of rows) {
    const cls = p.is_connected ? "badge-green" : "badge-muted";
    const stateText = p.is_connected ? "ONLINE" : "—";
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td><b>${escapeText(p.name || "—")}</b></td>
        <td class="dim mono">${escapeText((p.pubkey || "").slice(0, 24))}…</td>
        <td><span class="badge ${cls}">${stateText}</span></td>
        <td class="dim mono">${escapeText(p.endpoint || "—")}</td>
        <td class="num">${fmtBytes(p.transfer_rx)}</td>
        <td class="num">${fmtBytes(p.transfer_tx)}</td>
        <td class="dim">${escapeText(p.latest_handshake || "—")}</td>`;
    tb.appendChild(tr);
  }
  if (!rows.length) tb.innerHTML = `<tr><td colspan="7" class="dim">${t("No WireGuard peers.")}</td></tr>`;
  cell.appendChild(table);
  return cell;
}

function tableIPSec(rows) {
  const cell = el("section", { class: "card span-6", "aria-label": "IPsec phase 1" }, [
    el("p", {}, t("[ ipsec phase 1 ]")),
  ]);
  const table = el("table", { class: "tt" });
  table.innerHTML = `
      <caption>${t("IPsec connections")}</caption>
      <thead><tr><th>${t("Nombre")}</th><th>${t("Local")}</th><th>${t("Remoto")}</th><th>${t("State")}</th></tr></thead><tbody></tbody>`;
  const tb = $("tbody", table);
  for (const p of rows) {
    const cls = p.is_connected ? "badge-green" : "badge-muted";
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td><b>${escapeText(p.name || "—")}</b></td>
        <td class="dim mono">${escapeText(p.local_addr || "—")}</td>
        <td class="dim mono">${escapeText(p.remote_addr || "—")}</td>
        <td><span class="badge ${cls}">${escapeText(p.is_connected ? t("ESTABLISHED") : "—")}</span></td>`;
    tb.appendChild(tr);
  }
  if (!rows.length) tb.innerHTML = `<tr><td colspan="4" class="dim">${t("No IPsec tunnels.")}</td></tr>`;
  cell.appendChild(table);
  return cell;
}

function tableOpenVPN(rows) {
  const cell = el("section", { class: "card span-6", "aria-label": "OpenVPN sessions" }, [
    el("p", {}, t("[ openvpn sessions ]")),
  ]);
  const table = el("table", { class: "tt" });
  table.innerHTML = `
      <caption>${t("OpenVPN sessions")}</caption>
      <thead><tr><th>${t("Common name")}</th><th>${t("Real address")}</th><th class="num">${t("RX")}</th><th class="num">${t("TX")}</th></tr></thead><tbody></tbody>`;
  const tb = $("tbody", table);
  for (const p of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td><b>${escapeText(p.name || "—")}</b></td>
        <td class="dim mono">${escapeText(p.endpoint || "—")}</td>
        <td class="num">${fmtBytes(p.transfer_rx)}</td>
        <td class="num">${fmtBytes(p.transfer_tx)}</td>`;
    tb.appendChild(tr);
  }
  if (!rows.length) tb.innerHTML = `<tr><td colspan="4" class="dim">${t("No OpenVPN sessions.")}</td></tr>`;
  cell.appendChild(table);
  return cell;
}

function renderVPN(data) {
  return [
    cellVPNSummary(data.vpn),
    el("section", { class: "card span-6", "aria-label": "WireGuard estado" }, [
      el("p", {}, t("[ wireguard ]")),
      el("p", { class: "lead" }, [el("span", { class: "accent", text: data.vpn.wireguard_enabled ? "ON" : "OFF" })]),
      el("div", { class: "sub", text: `${data.vpn.wireguard_peers.length} peers configured` }),
    ]),
    tableWG(data.vpn.wireguard_peers),
    tableIPSec(data.vpn.ipsec_phase1),
    tableOpenVPN(data.vpn.openvpn_sessions),
  ];
}

// ---------- logs tab ----------
let logState = { entries: [], filter: "", action: "" };

function badgeForAction(a) {
  const cls = a === "pass" ? "badge-green"
    : a === "block" ? "badge-red"
      : a === "rdr" || a === "nat" || a === "binat" ? "badge-blue"
        : "badge-muted";
  return `<span class="badge ${cls}">${escapeText(a)}</span>`;
}

function logToolbar() {
  return el("section", { class: "card span-12", "aria-label": "Filtros de log" }, [
    el("div", { class: "log-toolbar" }, [
      el("input", {
        type: "search", id: "log-filter", placeholder: t('filter_src_dst_iface'),
        value: logState.filter, "aria-label": "Filter entries",
      }),
      (() => {
        const sel = el("select", { id: "log-action", "aria-label": "Filter by action" });
        for (const [v, t] of [["", "Todas las acciones"], ["pass", "pass"], ["block", "block"], ["rdr", "rdr"], ["nat", "nat"]]) {
          const o = el("option", { value: v, text: t });
          if (v === logState.action) o.selected = true;
          sel.appendChild(o);
        }
        return sel;
      })(),
      el("span", { class: "summary", id: "log-summary", text: "" }),
    ]),
  ]);
}

function logTable(entries) {
  const cell = el("section", { class: "card span-12", "aria-label": "Entradas del firewall log" }, [
    el("p", {}, t("[ firewall log ]")),
  ]);
  const table = el("table", { class: "tt" });
  table.innerHTML = `
      <caption>${t("Entradas del firewall log")}</caption>
      <thead><tr>
        <th>${t("Time")}</th><th>${t("Iface")}</th><th>${t("Action")}</th><th>${t("Dir")}</th><th>${t("Rule")}</th>
        <th>${t("Src")}</th><th>${t("Dst")}</th><th>${t("Proto")}</th><th class="num">${t("Len")}</th>
      </tr></thead><tbody></tbody>`;
  const tb = $("tbody", table);
  for (const r of entries) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td class="dim mono">${escapeText(r.timestamp)}</td>
        <td>${escapeText(r.interface)}</td>
        <td>${badgeForAction(r.action)}</td>
        <td class="dim">${escapeText(r.direction)}</td>
        <td class="dim">${escapeText(r.rule_label || "—")}</td>
        <td class="mono">${escapeText(r.src)}</td>
        <td class="mono">${escapeText(r.dst)}</td>
        <td class="dim">${escapeText(r.protocol)}</td>
        <td class="num">${r.length}</td>`;
    tb.appendChild(tr);
  }
  if (!entries.length) tb.innerHTML = `<tr><td colspan="9" class="dim">${t("No entries.")}</td></tr>`;
  cell.appendChild(table);
  return cell;
}

function applyLogFilters() {
  const q = (logState.filter || "").toLowerCase();
  const action = logState.action;
  return logState.entries.filter(r => {
    if (action && r.action !== action) return false;
    if (!q) return true;
    const hay = `${r.src} ${r.dst} ${r.interface} ${r.rule_label} ${r.protocol}`.toLowerCase();
    return hay.includes(q);
  });
}

function rerenderLogs() {
  const filtered = applyLogFilters();
  const main = $("#grid");
  main.replaceChildren(logToolbar(), logTable(filtered));
  $("#log-summary").textContent = `${filtered.length} de ${logState.entries.length} entradas`;
  $("#log-filter").addEventListener("input", e => {
    logState.filter = e.target.value;
    const filtered = applyLogFilters();
    // re-render only the table to keep input focus
    const cell = main.lastElementChild;
    const newTable = logTable(filtered);
    cell.replaceWith(newTable);
    $("#log-summary").textContent = `${filtered.length} de ${logState.entries.length} entradas`;
  });
  $("#log-action").addEventListener("change", e => {
    logState.action = e.target.value;
    rerenderLogs();
  });
}

function renderLogs(data) {
  logState.entries = data.entries || [];
  rerenderLogs();
  return null; // we replaced children directly
}

// ---------- NAT tab ----------
let natRules = [];
let natFormState = { interface: "wan", target: "", source_net: "any", destination_net: "any", description: "", protocol: "any" };
let natError = "";
let natBusy = false;

async function natList() {
  try {
    const data = await fetchJson(ENDPOINTS.nat);
    natRules = data.rules || [];
    natError = "";
  } catch (e) {
    natRules = [];
    natError = e.detail || e.message || "error";
  }
}

async function natCreate() {
  natBusy = true;
  try {
    const r = await fetch(ENDPOINTS.nat, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", rule: natFormState }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error || "create failed");
    natFormState = { interface: "wan", target: "", source_net: "any", destination_net: "any", description: "", protocol: "any" };
    natError = "";
  } catch (e) {
    natError = e.message || String(e);
  }
  natBusy = false;
  await natList();
  renderNatTab();
}

async function natDelete(uuid) {
  if (!confirm(`Delete NAT rule ${uuid.slice(0, 8)}…?`)) return;
  natBusy = true;
  try {
    const r = await fetch(ENDPOINTS.nat, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", uuid }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error || "delete failed");
    natError = "";
  } catch (e) {
    natError = e.message || String(e);
  }
  natBusy = false;
  await natList();
  renderNatTab();
}

function natForm() {
  const card = el("section", { class: "card span-12", "aria-label": "Crear regla NAT" }, [
    el("p", {}, t("[ nueva regla source NAT ]")),
  ]);
  const grid = el("div", { style: "display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-top: 8px;" });
  const inputs = [
    ["interface", "Interface (wan/lan)", "text", false],
    ["target", "Target IP/alias", "text", false],
    ["source_net", "Source net", "text", false],
    ["destination_net", "Destination net", "text", false],
    ["protocol", "Protocol (any|tcp|udp)", "text", false],
    ["description", "Description", "text", false],
  ];
  for (const [k, label, type] of inputs) {
    const wrap = el("label", { style: "display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;" }, [
      document.createTextNode(label),
    ]);
    const input = document.createElement("input");
    input.type = type;
    input.value = natFormState[k] || "";
    input.style.cssText = "background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 6px 10px; font-size: 13px; font-family: inherit;";
    input.setAttribute("aria-label", label);
    input.addEventListener("input", (e) => { natFormState[k] = e.target.value; });
    wrap.appendChild(input);
    grid.appendChild(wrap);
  }
  card.appendChild(grid);

  const actions = el("div", { style: "display: flex; gap: 8px; align-items: center; margin-top: 10px;" });
  const btnAdd = el("button", { class: "btn btn-primary", type: "button" }, ["Crear regla"]);
  btnAdd.disabled = natBusy;
  btnAdd.setAttribute("aria-busy", natBusy ? "true" : "false");
  btnAdd.addEventListener("click", natCreate);
  actions.appendChild(btnAdd);
  if (natError) {
    actions.appendChild(el("span", { style: "color: #fca5a5; font-size: 12px; font-weight: 600;", role: "alert", text: t('error') + natError }));
  }
  card.appendChild(actions);
  return card;
}

function natTable() {
  const card = el("section", { class: "card span-12", "aria-label": "Source NAT rules" }, [
    el("p", { class: "title", text: `[ reglas existentes (${natRules.length}) ]` }),
  ]);
  const table = el("table", { class: "tt" });
  table.innerHTML = `
      <caption>${t("Outbound NAT rules")}</caption>
      <thead><tr>
        <th>${t("Iface")}</th><th>${t("Source")}</th><th>${t("Dest")}</th><th>${t("Target")}</th><th>${t("Proto")}</th><th>${t("Description")}</th><th>${t("State")}</th><th><span class="vh">${t("Actions")}</span></th>
      </tr></thead><tbody></tbody>`;
  const tb = $("tbody", table);
  for (const r of natRules) {
    const tr = document.createElement("tr");
    const enabled = r.disabled !== "1" && r.disabled !== 1;
    const stateBadge = enabled ? `<span class="badge badge-green">${t("on")}</span>` : `<span class="badge badge-muted">${t("off")}</span>`;
    const td = (txt, cls = "") => `<td class="${cls}">${escapeText(txt || "—")}</td>`;
    tr.innerHTML = `
        ${td(r.interface)}
        ${td(r.source_net, "mono")}
        ${td(r.destination_net, "mono")}
        ${td(r.target, "mono")}
        ${td(r.protocol, "dim")}
        ${td(r.description)}
        <td>${stateBadge}</td>
        <td></td>`;
    const btn = el("button", { class: "btn", type: "button", "aria-label": `Delete rule ${r.uuid}`, text: t('delete') });
    btn.disabled = natBusy;
    btn.addEventListener("click", () => natDelete(r.uuid));
    tr.lastElementChild.appendChild(btn);
    tb.appendChild(tr);
  }
  if (!natRules.length) tb.innerHTML = `<tr><td colspan="8" class="dim">${t("No rules configured.")}</td></tr>`;
  card.appendChild(table);
  return card;
}

// ---------- 1:1 NAT (BINAT) — sub-section under NAT tab ----------
let oneToOneRows = [];
let oneToOneForm = { interface: "wan", external: "", source_net: "", destination_net: "any", type: "binat", description: "" };
let oneToOneError = "", oneToOneBusy = false;

async function oneToOneList() {
  try {
    const data = await fetchJson(ENDPOINTS.oneToOne);
    oneToOneRows = data.rules || [];
    oneToOneError = "";
  } catch (e) { oneToOneRows = []; oneToOneError = e.detail || e.message || "error"; }
}
async function oneToOneCreate() {
  oneToOneBusy = true;
  try {
    const r = await fetch(ENDPOINTS.oneToOne, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", rule: oneToOneForm }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error);
    oneToOneForm = { interface: "wan", external: "", source_net: "", destination_net: "any", type: "binat", description: "" };
    oneToOneError = "";
  } catch (e) { oneToOneError = e.message; }
  oneToOneBusy = false; await oneToOneList(); renderNatTab();
}
async function oneToOneDelete(uuid) {
  if (!confirm(`Delete 1:1 rule ${uuid.slice(0, 8)}…?`)) return;
  oneToOneBusy = true;
  try {
    const r = await fetch(ENDPOINTS.oneToOne, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", uuid }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error);
    oneToOneError = "";
  } catch (e) { oneToOneError = e.message; }
  oneToOneBusy = false; await oneToOneList(); renderNatTab();
}

function renderNatTab() {
  const main = $("#grid");
  const oneToOneCreateForm = crudForm({
    titleText: "[ nueva regla 1:1 (BINAT) ]",
    fields: [
      { key: "interface", label: "Interface (wan|lan)" },
      { key: "external", label: "External IP/alias" },
      { key: "source_net", label: "Internal IP/alias" },
      { key: "destination_net", label: "Destination (any)" },
      { key: "type", label: "Tipo (binat|nat)" },
      { key: "description", label: "Description" },
    ],
    formState: oneToOneForm, busy: oneToOneBusy, error: oneToOneError, onSubmit: oneToOneCreate,
  });
  const oneToOneTable = crudTable({
    titleText: "reglas 1:1 existentes",
    rows: oneToOneRows,
    columns: [
      { h: "Iface", k: "interface", cls: "dim" },
      { h: "External", k: "external", cls: "mono" },
      { h: "Internal", k: "source_net", cls: "mono" },
      { h: "Destino", k: "destination_net", cls: "mono" },
      { h: "Tipo", k: "type", cls: "dim" },
      { h: "Description", k: "description" },
      { h: "State", fn: r => (r.enabled === "1" || r.enabled === 1 || r.enabled === true) ? "on" : "off", cls: "dim" },
    ],
    onDelete: oneToOneDelete, busy: oneToOneBusy,
  });
  main.replaceChildren(natForm(), natTable(), oneToOneCreateForm, oneToOneTable);
  main.setAttribute("aria-busy", "false");
}

// ---------- generic CRUD tab helper (used by DNS + WG) ----------
function crudForm({ titleText, fields, formState, busy, error, onSubmit }) {
  const card = el("section", { class: "card span-12", "aria-label": titleText }, [
    el("p", { class: "title", text: titleText }),
  ]);
  const grid = el("div", { style: "display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-top: 8px;" });
  for (const f of fields) {
    const wrap = el("label", { style: "display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;" }, [
      document.createTextNode(f.label),
    ]);
    const input = document.createElement("input");
    input.type = "text";
    input.value = formState[f.key] ?? "";
    input.style.cssText = "background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 6px 10px; font-size: 13px; font-family: inherit;";
    input.setAttribute("aria-label", f.label);
    input.addEventListener("input", (e) => { formState[f.key] = e.target.value; });
    wrap.appendChild(input);
    grid.appendChild(wrap);
  }
  card.appendChild(grid);
  const actions = el("div", { style: "display: flex; gap: 8px; align-items: center; margin-top: 10px;" });
  const btn = el("button", { class: "btn btn-primary", type: "button" }, ["Crear"]);
  btn.disabled = busy; btn.setAttribute("aria-busy", busy ? "true" : "false");
  btn.addEventListener("click", onSubmit);
  actions.appendChild(btn);
  if (error) {
    actions.appendChild(el("span", { style: "color: #fca5a5; font-size: 12px; font-weight: 600;", role: "alert", text: t('error') + error }));
  }
  card.appendChild(actions);
  return card;
}

function crudTable({ titleText, rows, columns, onDelete, busy }) {
  const card = el("section", { class: "card span-12", "aria-label": titleText }, [
    el("p", { class: "title", text: `[ ${titleText} (${rows.length}) ]` }),
  ]);
  const t = document.createElement("table");
  t.className = "tt";
  const ths = columns.map(c => `<th>${escapeText(c.h)}</th>`).join("") + '<th><span class="vh">Actions</span></th>';
  t.innerHTML = `<thead><tr>${ths}</tr></thead><tbody></tbody>`;
  const tb = $("tbody", t);
  for (const r of rows) {
    const tr = document.createElement("tr");
    const cells = columns.map(c => {
      const v = c.fn ? c.fn(r) : (r[c.k] ?? "—");
      return `<td class="${c.cls || ""}">${escapeText(String(v ?? "—"))}</td>`;
    }).join("");
    tr.innerHTML = cells + "<td></td>";
    const btn = el("button", { class: "btn", type: "button", "aria-label": `Delete ${r.uuid}`, text: t('delete') });
    btn.disabled = busy;
    btn.addEventListener("click", () => onDelete(r.uuid));
    tr.lastElementChild.appendChild(btn);
    tb.appendChild(tr);
  }
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="${columns.length + 1}" class="dim">${t("No entries configured.")}</td></tr>`;
  }
  card.appendChild(t);
  return card;
}

// ---------- DNS tab (Unbound host overrides) ----------
let dnsRows = [];
let dnsForm = { hostname: "", domain: "", server: "", rr: "A", description: "" };
let dnsError = "", dnsBusy = false;

async function dnsList() {
  try {
    const data = await fetchJson(ENDPOINTS.unbound);
    dnsRows = data.hosts || [];
    dnsError = "";
  } catch (e) { dnsRows = []; dnsError = e.detail || e.message || "error"; }
}
async function dnsCreate() {
  dnsBusy = true;
  try {
    const r = await fetch(ENDPOINTS.unbound, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", host: dnsForm }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error);
    dnsForm = { hostname: "", domain: "", server: "", rr: "A", description: "" };
    dnsError = "";
  } catch (e) { dnsError = e.message; }
  dnsBusy = false; await dnsList(); renderDnsTab();
}
async function dnsDelete(uuid) {
  if (!confirm(`Delete host override ${uuid.slice(0, 8)}…?`)) return;
  dnsBusy = true;
  try {
    const r = await fetch(ENDPOINTS.unbound, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", uuid }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error);
    dnsError = "";
  } catch (e) { dnsError = e.message; }
  dnsBusy = false; await dnsList(); renderDnsTab();
}
// ---------- DNS — domain overrides (forward an entire zone) ----------
let dnsDomRows = [];
let dnsDomForm = { domain: "", server: "", description: "" };
let dnsDomError = "", dnsDomBusy = false;

async function dnsDomList() {
  try {
    const data = await fetchJson(ENDPOINTS.unboundDomains);
    dnsDomRows = data.domains || [];
    dnsDomError = "";
  } catch (e) { dnsDomRows = []; dnsDomError = e.detail || e.message || "error"; }
}
async function dnsDomCreate() {
  dnsDomBusy = true;
  try {
    const r = await fetch(ENDPOINTS.unboundDomains, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", domain: dnsDomForm }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error);
    dnsDomForm = { domain: "", server: "", description: "" };
    dnsDomError = "";
  } catch (e) { dnsDomError = e.message; }
  dnsDomBusy = false; await dnsDomList(); renderDnsTab();
}
async function dnsDomDelete(uuid) {
  if (!confirm(`Delete domain override ${uuid.slice(0, 8)}…?`)) return;
  dnsDomBusy = true;
  try {
    const r = await fetch(ENDPOINTS.unboundDomains, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", uuid }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error);
    dnsDomError = "";
  } catch (e) { dnsDomError = e.message; }
  dnsDomBusy = false; await dnsDomList(); renderDnsTab();
}

// ---------- DNS — DoT entries ----------
let dnsDotRows = [];
let dnsDotForm = { domain: "", server: "", verify: "", port: "853", description: "" };
let dnsDotError = "", dnsDotBusy = false;

async function dnsDotList() {
  try {
    const data = await fetchJson(ENDPOINTS.unboundDots);
    dnsDotRows = data.dots || [];
    dnsDotError = "";
  } catch (e) { dnsDotRows = []; dnsDotError = e.detail || e.message || "error"; }
}
async function dnsDotCreate() {
  dnsDotBusy = true;
  try {
    const r = await fetch(ENDPOINTS.unboundDots, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", dot: dnsDotForm }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error);
    dnsDotForm = { domain: ".", server: "", verify: "", port: "853", description: "" };
    dnsDotError = "";
  } catch (e) { dnsDotError = e.message; }
  dnsDotBusy = false; await dnsDotList(); renderDnsTab();
}
async function dnsDotDelete(uuid) {
  if (!confirm(`Delete DoT entry ${uuid.slice(0, 8)}…?`)) return;
  dnsDotBusy = true;
  try {
    const r = await fetch(ENDPOINTS.unboundDots, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", uuid }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error);
    dnsDotError = "";
  } catch (e) { dnsDotError = e.message; }
  dnsDotBusy = false; await dnsDotList(); renderDnsTab();
}

function renderDnsTab() {
  const form = crudForm({
    titleText: "[ nuevo host override ]",
    fields: [
      { key: "hostname", label: "Hostname (router)" },
      { key: "domain", label: "Domain (lab.local)" },
      { key: "server", label: "IP destino" },
      { key: "rr", label: "RR (A|AAAA|MX)" },
      { key: "description", label: "Description" },
    ],
    formState: dnsForm, busy: dnsBusy, error: dnsError, onSubmit: dnsCreate,
  });
  const table = crudTable({
    titleText: "host overrides existentes",
    rows: dnsRows,
    columns: [
      { h: "Hostname", k: "hostname" },
      { h: "Domain", k: "domain", cls: "dim" },
      { h: "RR", k: "rr", cls: "dim" },
      { h: "Server", k: "server", cls: "mono" },
      { h: "Description", k: "description" },
      { h: "State", fn: r => (r.enabled === "1" || r.enabled === 1 || r.enabled === true) ? "on" : "off", cls: "dim" },
    ],
    onDelete: dnsDelete, busy: dnsBusy,
  });
  const domForm = crudForm({
    titleText: "[ nuevo domain override ]",
    fields: [
      { key: "domain", label: "Zone (internal.lab.local)" },
      { key: "server", label: "Resolver IP" },
      { key: "description", label: "Description" },
    ],
    formState: dnsDomForm, busy: dnsDomBusy, error: dnsDomError, onSubmit: dnsDomCreate,
  });
  const domTable = crudTable({
    titleText: "domain overrides existentes",
    rows: dnsDomRows,
    columns: [
      { h: "Domain", k: "domain" },
      { h: "Server", k: "server", cls: "mono" },
      { h: "Description", k: "description" },
      { h: "State", fn: r => (r.enabled === "1" || r.enabled === 1 || r.enabled === true) ? "on" : "off", cls: "dim" },
    ],
    onDelete: dnsDomDelete, busy: dnsDomBusy,
  });
  const dotForm = crudForm({
    titleText: "[ nueva entrada DoT (DNS over TLS) ]",
    fields: [
      { key: "domain", label: "Zone (FQDN — e.g. lab.local)" },
      { key: "server", label: "Resolver IP" },
      { key: "verify", label: "SNI / cert hostname" },
      { key: "port", label: "Puerto (853)" },
      { key: "description", label: "Description" },
    ],
    formState: dnsDotForm, busy: dnsDotBusy, error: dnsDotError, onSubmit: dnsDotCreate,
  });
  const dotTable = crudTable({
    titleText: "entradas DoT existentes",
    rows: dnsDotRows,
    columns: [
      { h: "Domain", k: "domain" },
      { h: "Server", k: "server", cls: "mono" },
      { h: "Verify (SNI)", k: "verify", cls: "mono" },
      { h: "Puerto", k: "port", cls: "dim" },
      { h: "Description", k: "description" },
      { h: "State", fn: r => (r.enabled === "1" || r.enabled === 1 || r.enabled === true) ? "on" : "off", cls: "dim" },
    ],
    onDelete: dnsDotDelete, busy: dnsDotBusy,
  });
  const main = $("#grid");
  main.replaceChildren(form, table, domForm, domTable, dotForm, dotTable);
  main.setAttribute("aria-busy", "false");
}

// ---------- DHCP — subnets sub-section ----------
let dhcpSubnetForm = { subnet: "", description: "", pools: "", next_server: "" };
let dhcpSubnetError = "", dhcpSubnetBusy = false;

async function dhcpSubnetCreate() {
  dhcpSubnetBusy = true;
  try {
    const r = await fetch(ENDPOINTS.dhcpSubnet, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", subnet: dhcpSubnetForm }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error);
    dhcpSubnetForm = { subnet: "", description: "", pools: "", next_server: "" };
    dhcpSubnetError = "";
  } catch (e) { dhcpSubnetError = e.message; }
  dhcpSubnetBusy = false; await dhcpList(); renderDhcpTab();
}
async function dhcpSubnetDelete(uuid) {
  if (!confirm(`Delete subnet ${uuid.slice(0, 8)}…? If it has associated reservations they will also be deleted.`)) return;
  dhcpSubnetBusy = true;
  try {
    const r = await fetch(ENDPOINTS.dhcpSubnet, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", uuid }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error);
    dhcpSubnetError = "";
  } catch (e) { dhcpSubnetError = e.message; }
  dhcpSubnetBusy = false; await dhcpList(); renderDhcpTab();
}

// ---------- DHCP tab (Kea reservations) ----------
let dhcpRows = [], dhcpSubnets = [];
let dhcpForm = { subnet: "", ip_address: "", hw_address: "", hostname: "", description: "" };
let dhcpError = "", dhcpBusy = false;

async function dhcpList() {
  try {
    const data = await fetchJson(ENDPOINTS.dhcp);
    dhcpRows = data.reservations || [];
    dhcpSubnets = data.subnets || [];
    dhcpError = "";
  } catch (e) { dhcpRows = []; dhcpSubnets = []; dhcpError = e.detail || e.message || "error"; }
}
async function dhcpCreate() {
  dhcpBusy = true;
  try {
    const r = await fetch(ENDPOINTS.dhcp, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", reservation: dhcpForm }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error);
    dhcpForm = { subnet: "", ip_address: "", hw_address: "", hostname: "", description: "" };
    dhcpError = "";
  } catch (e) { dhcpError = e.message; }
  dhcpBusy = false; await dhcpList(); renderDhcpTab();
}
async function dhcpDelete(uuid) {
  if (!confirm(`Delete reservation ${uuid.slice(0, 8)}…?`)) return;
  dhcpBusy = true;
  try {
    const r = await fetch(ENDPOINTS.dhcp, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", uuid }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error);
    dhcpError = "";
  } catch (e) { dhcpError = e.message; }
  dhcpBusy = false; await dhcpList(); renderDhcpTab();
}
function renderDhcpTab() {
  const main = $("#grid");
  const subnetForm = crudForm({
    titleText: "[ nueva subnet Kea ]",
    fields: [
      { key: "subnet", label: "CIDR (192.168.99.0/24)" },
      { key: "pools", label: "Pools (192.168.99.100-200, opcional)" },
      { key: "next_server", label: "Next server (TFTP, opcional)" },
      { key: "description", label: "Description" },
    ],
    formState: dhcpSubnetForm, busy: dhcpSubnetBusy, error: dhcpSubnetError, onSubmit: dhcpSubnetCreate,
  });
  const subnetTable = crudTable({
    titleText: "subnets Kea existentes",
    rows: dhcpSubnets,
    columns: [
      { h: "CIDR", k: "subnet", cls: "mono" },
      { h: "Pools", k: "pools", cls: "dim" },
      { h: "Next server", k: "next_server", cls: "mono" },
      { h: "UUID", k: "uuid", cls: "mono dim" },
      { h: "Description", k: "description" },
    ],
    onDelete: dhcpSubnetDelete, busy: dhcpSubnetBusy,
  });
  const form = crudForm({
    titleText: "[ nueva reservation DHCP ]",
    fields: [
      { key: "subnet", label: "Subnet UUID (de Kea)" },
      { key: "ip_address", label: "IP (192.168.1.50)" },
      { key: "hw_address", label: "MAC (AA:BB:CC:DD:EE:FF)" },
      { key: "hostname", label: "Hostname" },
      { key: "description", label: "Description" },
    ],
    formState: dhcpForm, busy: dhcpBusy, error: dhcpError, onSubmit: dhcpCreate,
  });
  const table = crudTable({
    titleText: "reservations existentes",
    rows: dhcpRows,
    columns: [
      { h: "Hostname", k: "hostname" },
      { h: "IP", k: "ip_address", cls: "mono" },
      { h: "MAC", k: "hw_address", cls: "mono" },
      { h: "Subnet", k: "subnet", cls: "dim" },
      { h: "Description", k: "description" },
    ],
    onDelete: dhcpDelete, busy: dhcpBusy,
  });
  main.replaceChildren(subnetForm, subnetTable, form, table);
  main.setAttribute("aria-busy", "false");
}

// ---------- WG peers tab ----------
let wgRows = [];
let wgForm = { name: "", pubkey: "", tunneladdress: "", keepalive: "25", psk: "" };
let wgError = "", wgBusy = false;

async function wgList() {
  try {
    const data = await fetchJson(ENDPOINTS.wg);
    wgRows = data.peers || [];
    wgError = "";
  } catch (e) { wgRows = []; wgError = e.detail || e.message || "error"; }
}
async function wgCreate() {
  wgBusy = true;
  try {
    const r = await fetch(ENDPOINTS.wg, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", peer: wgForm }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error);
    wgForm = { name: "", pubkey: "", tunneladdress: "", keepalive: "25", psk: "" };
    wgError = "";
  } catch (e) { wgError = e.message; }
  wgBusy = false; await wgList(); renderWgTab();
}
async function wgDelete(uuid) {
  if (!confirm(`Delete peer ${uuid.slice(0, 8)}…?`)) return;
  wgBusy = true;
  try {
    const r = await fetch(ENDPOINTS.wg, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", uuid }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.detail || j.error);
    wgError = "";
  } catch (e) { wgError = e.message; }
  wgBusy = false; await wgList(); renderWgTab();
}
function renderWgTab() {
  const form = crudForm({
    titleText: "[ nuevo WireGuard peer ]",
    fields: [
      { key: "name", label: "Nombre" },
      { key: "pubkey", label: "Pubkey (44 chars base64)" },
      { key: "tunneladdress", label: "Tunnel address (10.99.0.5/32)" },
      { key: "keepalive", label: "Keepalive (s)" },
      { key: "psk", label: "PSK (opcional)" },
    ],
    formState: wgForm, busy: wgBusy, error: wgError, onSubmit: wgCreate,
  });
  const table = crudTable({
    titleText: "peers existentes",
    rows: wgRows,
    columns: [
      { h: "Nombre", k: "name" },
      { h: "Pubkey", fn: r => (r.pubkey || "").slice(0, 18) + "…", cls: "dim mono" },
      { h: "Tunnel", k: "tunneladdress", cls: "mono" },
      { h: "Keepalive", k: "keepalive", cls: "dim" },
      { h: "State", fn: r => (r.enabled === "1" || r.enabled === 1 || r.enabled === true) ? "on" : "off", cls: "dim" },
    ],
    onDelete: wgDelete, busy: wgBusy,
  });
  const main = $("#grid");
  main.replaceChildren(form, table);
  main.setAttribute("aria-busy", "false");
}

// ---------- drilldown ----------
function dlChart(name) {
  const rates = trafficRates.get(name) || [];
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "dl-chart");
  const W = 920, H = 220, padL = 56, padR = 12, padT = 12, padB = 24;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Live traffic for ${name}`);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  if (rates.length < 2) {
    const t = document.createElementNS(svgNS, "text");
    t.setAttribute("x", W / 2); t.setAttribute("y", H / 2);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("fill", "var(--muted)");
    t.textContent = t('waiting_for_samples');
    svg.appendChild(t);
    return svg;
  }

  const yMax = Math.max(1, ...rates.map(r => Math.max(r.rxRate, r.txRate)));
  const xStep = innerW / (TRAFFIC_WINDOW - 1);

  // grid + y axis
  const ticks = 4;
  const axis = document.createElementNS(svgNS, "g");
  axis.setAttribute("class", "axis");
  for (let k = 0; k <= ticks; k++) {
    const v = (yMax * k) / ticks;
    const y = padT + innerH - (innerH * k) / ticks;
    const ln = document.createElementNS(svgNS, "line");
    ln.setAttribute("class", "grid-line");
    ln.setAttribute("x1", padL); ln.setAttribute("x2", W - padR);
    ln.setAttribute("y1", y); ln.setAttribute("y2", y);
    axis.appendChild(ln);
    const tx = document.createElementNS(svgNS, "text");
    tx.setAttribute("x", padL - 6);
    tx.setAttribute("y", y + 3);
    tx.setAttribute("text-anchor", "end");
    tx.textContent = fmtRate(v);
    axis.appendChild(tx);
  }
  svg.appendChild(axis);

  function line(key, color) {
    const offset = TRAFFIC_WINDOW - rates.length;
    const pts = rates.map((s, i) => {
      const x = padL + (offset + i) * xStep;
      const y = padT + innerH - (s[key] / yMax) * innerH;
      return [x, y];
    });
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (const p of pts.slice(1)) d += ` L${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", "2");
    svg.appendChild(path);
  }
  line("rxRate", "#22c55e");
  line("txRate", "#3b82f6");
  return svg;
}

async function fetchLogsForIface(name, limit = 200) {
  try {
    const data = await fetchJson(ENDPOINTS.logs + "?limit=" + limit);
    return (data.entries || []).filter(r => r.interface === name);
  } catch {
    return null; // signal failure
  }
}

function appendLogsCard(body, name, entries) {
  const card = el("section", { class: "card", style: "padding: 12px; margin-top: 12px;" }, [
    el("p", { class: "title", text: `[ recent firewall events on ${escapeText(name)} ]` }),
  ]);
  if (entries == null) {
    card.appendChild(el("div", { class: "dl-empty", text: t('no_se_pudieron_cargar_los_eventos_del_fi') }));
    body.appendChild(card);
    return;
  }
  if (!entries.length) {
    card.appendChild(el("div", { class: "dl-empty", text: t('no_recent_events_on_this_interface') }));
    body.appendChild(card);
    return;
  }
  const t = document.createElement("table");
  t.className = "tt";
  t.innerHTML = `<thead><tr><th>${t("Time")}</th><th>${t("Action")}</th><th>${t("Dir")}</th><th>${t("Src")}</th><th>${t("Dst")}</th><th>${t("Proto")}</th></tr></thead><tbody></tbody>`;
  const tb = $("tbody", t);
  const cls = (a) => a === "pass" ? "badge-green" : a === "block" ? "badge-red" : a === "rdr" || a === "nat" ? "badge-blue" : "badge-muted";
  for (const r of entries.slice(0, 30)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td class="dim mono">${escapeText(r.timestamp)}</td>
        <td><span class="badge ${cls(r.action)}">${escapeText(r.action)}</span></td>
        <td class="dim">${escapeText(r.direction)}</td>
        <td class="mono">${escapeText(r.src)}</td>
        <td class="mono">${escapeText(r.dst)}</td>
        <td class="dim">${escapeText(r.protocol)}</td>`;
    tb.appendChild(tr);
  }
  card.appendChild(t);
  if (entries.length > 30) {
    card.appendChild(el("div", { class: "sub", text: `Mostrando 30 de ${entries.length} eventos.` }));
  }
  body.appendChild(card);
}

async function openDrilldown(name) {
  const dlg = $("#drilldown");
  const body = $("#dl-body");
  const title = $("#dl-title");
  const i = lastInterfaces.get(name);
  title.innerHTML = `<span class="accent">${escapeText(name)}</span>${i?.label ? `<span class="label">${escapeText(i.label)}</span>` : ""}`;
  body.replaceChildren();

  if (!i) {
    body.appendChild(el("div", { class: "dl-empty", text: t('no_data_for_this_interface') }));
  } else {
    const r = getCurrentRate(name);
    const ip4 = (i.ipv4 || []).map(x => `${x.ipaddr}/${x.subnetbits}`).join(" ") || "—";
    const ip6 = (i.ipv6 || []).map(x => `${x.ipaddr}/${x.subnetbits}`).join(" ") || "—";
    const stats = el("div", { class: "dl-grid" }, [
      el("div", { class: "stat" }, [el("div", { class: "k", text: t('state') }), el("div", { class: "v", text: i.is_up ? "UP" : "DOWN" })]),
      el("div", { class: "stat" }, [el("div", { class: "k", text: t('rx_rate') }), el("div", { class: "v", text: fmtRate(r.rx) })]),
      el("div", { class: "stat" }, [el("div", { class: "k", text: t('tx_rate') }), el("div", { class: "v", text: fmtRate(r.tx) })]),
      el("div", { class: "stat" }, [el("div", { class: "k", text: t('mtu') }), el("div", { class: "v", text: String(i.mtu || "—") })]),
      el("div", { class: "stat" }, [el("div", { class: "k", text: t('rx_total') }), el("div", { class: "v", text: fmtBytes(i.received_bytes) })]),
      el("div", { class: "stat" }, [el("div", { class: "k", text: t('tx_total') }), el("div", { class: "v", text: fmtBytes(i.sent_bytes) })]),
      el("div", { class: "stat" }, [el("div", { class: "k", text: t('errors') }), el("div", { class: "v", text: String((i.received_errors || 0) + (i.send_errors || 0)) })]),
      el("div", { class: "stat" }, [el("div", { class: "k", text: t('drops') }), el("div", { class: "v", text: String(i.dropped_packets || 0) })]),
      el("div", { class: "stat", style: "grid-column: span 2;" }, [el("div", { class: "k", text: t('ipv4') }), el("div", { class: "v mono", text: ip4 })]),
      el("div", { class: "stat", style: "grid-column: span 2;" }, [el("div", { class: "k", text: t('ipv6') }), el("div", { class: "v mono", text: ip6 })]),
    ]);
    body.appendChild(stats);

    const chartCard = el("section", { class: "card chart-card", style: "padding: 12px;" }, [
      el("p", { class: "title", text: t('traffic__rx_green__tx_blue') }),
    ]);
    chartCard.appendChild(dlChart(name));
    body.appendChild(chartCard);

    // Filter neighbors to this iface (by interface_name or interface label)
    const matchIface = (n) => n.interface_name === name || n.interface === (i.label || name) || n.interface === name;
    const arp = lastArp.filter(matchIface).slice(0, 30);
    const ndp = lastNdp.filter(matchIface).slice(0, 30);
    if (arp.length || ndp.length) {
      const tbl = el("section", { class: "card", style: "padding: 12px; margin-top: 12px;" }, [
        el("p", { class: "title", text: `[ neighbors on ${escapeText(name)} ]` }),
      ]);
      const t = document.createElement("table");
      t.className = "tt";
      t.innerHTML = `<thead><tr><th>${t("Family")}</th><th>${t("IP")}</th><th>${t("MAC")}</th><th>${t("Host")}</th></tr></thead><tbody></tbody>`;
      const tb = $("tbody", t);
      for (const n of [...arp, ...ndp]) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td class="dim">${n.family}</td><td class="mono">${escapeText(n.ip)}</td><td class="mono dim">${escapeText(n.mac || "—")}</td><td class="dim">${escapeText(n.hostname || n.manufacturer || "—")}</td>`;
        tb.appendChild(tr);
      }
      tbl.appendChild(t);
      body.appendChild(tbl);
    } else {
      body.appendChild(el("div", { class: "dl-empty", text: t('no_neighbors_discovered_on_this_interfac') }));
    }

    // Lazy load firewall events for this iface (skeleton first, then table).
    const logsCard = el("section", { class: "card", style: "padding: 12px; margin-top: 12px;" }, [
      el("p", { class: "title", text: `[ recent firewall events on ${escapeText(name)} ]` }),
      el("div", { class: "skeleton lg", role: "presentation", style: "margin-top:8px;" }),
      el("div", { class: "skeleton", role: "presentation", style: "margin-top:6px; width: 90%;" }),
      el("div", { class: "skeleton", role: "presentation", style: "margin-top:6px; width: 80%;" }),
    ]);
    body.appendChild(logsCard);
    fetchLogsForIface(name).then(entries => {
      // Only swap if this dialog is still showing the same iface.
      if (!dlg.open || title.textContent.indexOf(name) === -1) return;
      logsCard.remove();
      appendLogsCard(body, name, entries);
    });
  }
  dlg.showModal();
}

function closeDrilldown() { $("#drilldown")?.close(); }

// delegated click — works for tables re-rendered after every poll
document.addEventListener("click", (e) => {
  const link = e.target.closest?.(".iface-link");
  if (link?.dataset?.iface) {
    e.preventDefault();
    openDrilldown(link.dataset.iface);
  }
});

// ---------- tab router ----------
const TAB_CONFIG = {
  overview: { endpoint: ENDPOINTS.overview, render: renderOverview, refresh: 10_000 },
  network: { endpoint: ENDPOINTS.network, render: renderNetwork, refresh: 10_000 },
  vpn: { endpoint: ENDPOINTS.overview, render: renderVPN, refresh: 30_000 },
  logs: { endpoint: ENDPOINTS.logs + "?limit=200", render: renderLogs, refresh: 10_000 },
  nat: { custom: true, refresh: 0 },
  dns: { custom: true, refresh: 0 },
  dhcp: { custom: true, refresh: 0 },
  wg: { custom: true, refresh: 0 },
};

let currentTab = "overview";
let pollTimer = null;
let inFlight = false;

function setActiveTab(name) {
  if (!TAB_CONFIG[name]) name = "overview";
  currentTab = name;
  for (const t of $$(".tab")) {
    const sel = t.dataset.tab === name;
    t.setAttribute("aria-selected", sel ? "true" : "false");
  }
  const main = $("#grid");
  main.setAttribute("aria-labelledby", `tab-${name}`);
  if (location.hash.replace("#", "") !== name) {
    history.replaceState(null, "", `#${name}`);
  }
}

function renderError(err) {
  const main = $("#grid");
  main.setAttribute("aria-busy", "false");
  let title = "Error upstream";
  let body = err.detail || err.message || "Unknown error";
  if (err.kind === "auth") {
    title = "Authentication failed";
    body = "OPNsense rejected the API key + secret. Check the plugin configuration.";
  } else if (err.kind === "timeout") {
    title = "Timeout";
    body = "OPNsense did not respond in time. Retry or check connectivity.";
  } else if (err.kind === "unconfigured") {
    title = "Plugin not configured";
    body = "Edit /opt/ProxmoxVEx/plugins/opnsense/config.json with an OPNsense host.";
  }
  main.replaceChildren(
    el("div", { class: "banner", role: "alert" }, [
      el("b", { text: title }),
      document.createTextNode(" — " + body),
    ])
  );
}

async function loadCurrentTab() {
  if (inFlight) return;
  inFlight = true;
  const cfg = TAB_CONFIG[currentTab];
  const main = $("#grid");
  main.setAttribute("aria-busy", "true");
  const btn = $("#btn-refresh");
  btn.setAttribute("aria-busy", "true");
  btn.disabled = true;
  try {
    if (cfg.custom && currentTab === "nat") {
      await Promise.all([natList(), oneToOneList()]);
      renderNatTab();
      main.setAttribute("aria-busy", "false");
      return;
    }
    if (cfg.custom && currentTab === "dns") {
      await Promise.all([dnsList(), dnsDomList(), dnsDotList()]);
      renderDnsTab();
      main.setAttribute("aria-busy", "false");
      return;
    }
    if (cfg.custom && currentTab === "dhcp") {
      await dhcpList();
      renderDhcpTab();
      main.setAttribute("aria-busy", "false");
      return;
    }
    if (cfg.custom && currentTab === "wg") {
      await wgList();
      renderWgTab();
      main.setAttribute("aria-busy", "false");
      return;
    }
    const data = await fetchJson(cfg.endpoint);
    // overview/network include system info we use for the conn header
    if (data.system) renderHeader(data.system);
    // Ingest iface counters for live rate/sparklines.
    if (data.interfaces) ingestInterfaces(data.interfaces);
    const nodes = cfg.render(data);
    if (nodes !== null) {
      main.replaceChildren(...nodes);
    }
    main.setAttribute("aria-busy", "false");
  } catch (e) {
    renderError(e);
  } finally {
    inFlight = false;
    btn.setAttribute("aria-busy", "false");
    btn.disabled = false;
  }
}

function schedulePolling() {
  if (pollTimer) clearInterval(pollTimer);
  const cfg = TAB_CONFIG[currentTab];
  if (cfg.refresh) pollTimer = setInterval(loadCurrentTab, cfg.refresh);
}

async function switchTab(name) {
  setActiveTab(name);
  await loadCurrentTab();
  schedulePolling();
}

// wire tabs
for (const t of $$(".tab")) {
  t.addEventListener("click", () => switchTab(t.dataset.tab));
}
window.addEventListener("hashchange", () => {
  const name = location.hash.replace("#", "") || "overview";
  if (name !== currentTab) switchTab(name);
});
$("#btn-refresh").addEventListener("click", loadCurrentTab);
$("#dl-close")?.addEventListener("click", closeDrilldown);

// ---------- v1.13.0 cluster bar + cluster overview ----------------------
// When ≥2 hosts are configured the header shows a compact host-selector
// dropdown instead of the old wide cluster bar. Single-host setups never
// see any cluster UI — the plain conn-host text is shown instead.

// Track which node the user has pinned (null = auto / master node).
let hsSelectedNode = null; // 'a' | 'b' | null

function _roleClass(role) {
  const r = (role || "unknown").toLowerCase();
  return ["master", "backup", "disabled", "unknown"].includes(r) ? r : "unknown";
}

function renderClusterBar(payload) {
  // When only 1 host is configured do not show any cluster UI.
  if ((cluster.info?.hosts_configured ?? 0) < 2) {
    $("#conn-single").hidden = false;
    $("#conn-multi").hidden = true;
    return;
  }

  if (!payload || !payload.ok || !payload.data) {
    // Keep multi-host UI visible but in a loading/error state.
    $("#conn-single").hidden = true;
    $("#conn-multi").hidden = false;
    return;
  }

  const d = payload.data;
  const ra = d?.nodes?.a?.snap?.carp;
  const rb = d?.nodes?.b?.snap?.carp;
  const nameA = d?.names?.a || "Node A";
  const nameB = d?.names?.b || "Node B";
  const roleA = _roleClass(ra?.role || (d?.nodes?.a?.ok ? "unknown" : "unreachable"));
  const roleB = _roleClass(rb?.role || (d?.nodes?.b?.ok ? "unknown" : "unreachable"));

  // Determine which node is "active" for display in the button label.
  // Default to whichever is master; respect explicit user selection.
  if (!hsSelectedNode) {
    hsSelectedNode = (roleA === "master") ? "a" : "b";
  }
  const activeName = hsSelectedNode === "a" ? nameA : nameB;
  const activeRole = hsSelectedNode === "a" ? roleA : roleB;

  // Update button label.
  $("#hs-active-name").textContent = activeName;
  const roleEl = $("#hs-active-role");
  roleEl.textContent = activeRole;
  roleEl.className = "hs-role " + activeRole;

  // Update dropdown items.
  $("#hs-item-name-a").textContent = nameA;
  const rA = $("#hs-item-role-a");
  rA.textContent = roleA; rA.className = "hs-item-role " + roleA;
  $("#hs-item-a").classList.toggle("active", hsSelectedNode === "a");

  $("#hs-item-name-b").textContent = nameB;
  const rB = $("#hs-item-role-b");
  rB.textContent = roleB; rB.className = "hs-item-role " + roleB;
  $("#hs-item-b").classList.toggle("active", hsSelectedNode === "b");

  // Divergence pill.
  const divs = Array.isArray(d.divergence) ? d.divergence : [];
  const errors = divs.filter(x => x.severity === "error").length;
  const warns = divs.filter(x => x.severity === "warning").length;
  const infos = divs.filter(x => x.severity === "info").length;
  const pill = $("#hs-diverge");
  pill.classList.remove("has-error", "has-warning");
  if (errors) {
    pill.classList.add("has-error");
    pill.innerHTML = `&nbsp;·&nbsp;<b>${errors}</b> ${tf("drift_error_count", errors)}${errors !== 1 ? 's' : ''}`;
  } else if (warns) {
    pill.classList.add("has-warning");
    pill.innerHTML = `&nbsp;·&nbsp;<b>${warns}</b> ${tf("warning_count", warns)}${warns !== 1 ? 's' : ''}`;
  } else if (infos) {
    pill.textContent = ` · ${infos} info`;
  } else {
    pill.textContent = t('in_sync');
  }

  // Show multi-host UI, hide single-host text.
  $("#conn-single").hidden = true;
  $("#conn-multi").hidden = false;
}

// Wire up the host-selector dropdown toggle + item selection.
(() => {
  const btn = $("#hs-btn");
  const menu = $("#hs-menu");
  if (!btn || !menu) return;

  function openMenu() {
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  }
  function closeMenu() {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", () => menu.hidden ? openMenu() : closeMenu());

  // Click-outside dismissal.
  document.addEventListener("click", (e) => {
    if (!$("#host-selector")?.contains(e.target)) closeMenu();
  });

  // Node A item.
  $("#hs-item-a")?.addEventListener("click", () => {
    hsSelectedNode = "a";
    closeMenu();
    // Re-render bar with cached cluster data to update the label immediately.
    if (cluster.lastCluster) renderClusterBar(cluster.lastCluster);
    // Reload the current tab against the selected node if applicable.
    loadCurrentTab();
  });

  // Node B item.
  $("#hs-item-b")?.addEventListener("click", () => {
    hsSelectedNode = "b";
    closeMenu();
    if (cluster.lastCluster) renderClusterBar(cluster.lastCluster);
    loadCurrentTab();
  });
})();

function renderClusterOverview(payload) {
  // Returns the list of children for #grid when cluster_mode is on.
  const d = payload?.data || {};
  const grid = el("div", { class: "cluster-grid", role: "presentation" });
  const buildCol = (side) => {
    const node = d?.nodes?.[side];
    const isMaster = (d.master === node?.name);
    const col = el("section", {
      class: "node-col",
      "data-role": isMaster ? "master" : "backup",
      "aria-label": node?.name || side.toUpperCase(),
    }, []);
    col.appendChild(el("div", { class: "col-head" }, [
      el("h2", {}, [
        el("span", { class: "accent", text: node?.name || side.toUpperCase() }),
        document.createTextNode(isMaster ? "  · master" : "  · backup"),
      ]),
    ]));
    if (!node || !node.ok || !node.snap) {
      col.appendChild(el("div", { class: "err-card" }, [
        el("b", { text: node?.error || "node unreachable" }),
        document.createTextNode(node?.detail || "No response from node."),
      ]));
      return col;
    }
    const s = node.snap;
    // Tight set of cards per column: system, link, CARP, services.
    col.appendChild(el("section", { class: "card" }, [
      el("div", { class: "title", text: t('system') }),
      el("div", { class: "lead", text: s?.system?.name || "—" }),
      el("div", { class: "sub", text: `${s?.system?.version || ""} · uptime ${s?.system?.uptime || "—"}` }),
    ]));
    col.appendChild(el("section", { class: "card" }, [
      el("div", { class: "title", text: t('carp') }),
      el("div", { class: "lead", text: (s?.carp?.role || "unknown").toUpperCase() }),
      el("div", {
        class: "sub", text: s?.carp?.enabled
          ? `${(s?.carp?.vhids || []).length} VHIDs · pfSync ${s?.hasync?.enabled ? "on" : "off"}`
          : "CARP disabled"
      }),
    ]));
    const certs = s?.certs?.expiring_soon_count ?? 0;
    col.appendChild(el("section", { class: "card" }, [
      el("div", { class: "title", text: t('certs__servicios') }),
      el("div", { class: "lead", text: certs ? `${certs} venciendo` : "OK" }),
      el("div", { class: "sub", text: `${(s?.services?.items || []).filter(x => x.running).length} servicios up` }),
    ]));
    return col;
  };
  grid.appendChild(buildCol("a"));
  grid.appendChild(buildCol("b"));

  const divs = Array.isArray(d.divergence) ? d.divergence : [];
  const divCard = el("section", { class: "card diverge-card", "aria-label": "Divergence between nodes" }, [
    el("div", { class: "title", text: `divergence (${divs.length})` }),
  ]);
  if (!divs.length) {
    divCard.appendChild(el("div", {
      class: "sub",
      text: t('no_detectable_differences_between_the_no')
    }));
  } else {
    const table = el("table", { class: "tt" });
    table.appendChild(el("thead", {}, [el("tr", {}, [
      el("th", { text: t('sev') }), el("th", { text: t('category') }),
      el("th", { text: t('item') }), el("th", { text: d?.names?.a || "A" }),
      el("th", { text: d?.names?.b || "B" }), el("th", { text: t('detalle') }),
    ])]));
    const body = el("tbody", {});
    for (const x of divs) {
      const tr = el("tr", { "data-severity": x.severity }, [
        el("td", { class: "sev", text: x.severity, "data-severity": x.severity }),
        el("td", { text: x.category }),
        el("td", { text: x.key }),
        el("td", { class: "dim", text: JSON.stringify(x.a) }),
        el("td", { class: "dim", text: JSON.stringify(x.b) }),
        el("td", { class: "dim", text: x.detail || "" }),
      ]);
      body.appendChild(tr);
    }
    table.appendChild(body);
    divCard.appendChild(table);
  }
  return [grid, divCard];
}

async function refreshClusterBar() {
  try {
    const data = await fetchJson(ENDPOINTS.cluster);
    cluster.lastCluster = data;
    renderClusterBar(data);
  } catch (e) {
    // 400 single_host = expected for 1-host setups; keep single-host UI visible.
    $("#conn-single").hidden = false;
    $("#conn-multi").hidden = true;
  }
}

async function bootCluster() {
  try {
    const h = await fetchJson(ENDPOINTS.health);
    cluster.info = h.data || h;
    cluster.enabled = !!(cluster.info?.cluster_mode);
    if ((cluster.info?.hosts_configured ?? 0) >= 2) {
      // Show multi-host UI and fetch cluster state.
      await refreshClusterBar();
      // Re-poll every 30s so CARP role flips surface promptly.
      setInterval(refreshClusterBar, 30_000);
    } else {
      // Single host — ensure multi UI stays hidden.
      $("#conn-single").hidden = false;
      $("#conn-multi").hidden = true;
    }
  } catch (e) {
    // health failing isn't fatal — the per-tab UI will surface auth/upstream.
  }
}

// Apply stagger --i indices to grid children. Called after every replaceChildren.
function applyStagger() {
  const grid = $("#grid");
  if (!grid) return;
  let i = 0;
  for (const c of grid.children) {
    if (c.classList?.contains("card") || c.classList?.contains("diverge-card")
      || c.classList?.contains("cluster-grid")) {
      c.style.setProperty("--i", String(i++));
    }
  }
}

// Patch loadCurrentTab: for the overview tab, when cluster mode is on,
// call /api/cluster and route through renderClusterOverview. Otherwise
// fall through to the existing behaviour.
const _origLoadCurrentTab = loadCurrentTab;
loadCurrentTab = async function patchedLoadCurrentTab() {
  if (currentTab === "overview" && cluster.enabled) {
    if (inFlight) return;
    inFlight = true;
    const main = $("#grid");
    main.setAttribute("aria-busy", "true");
    const btn = $("#btn-refresh");
    btn.setAttribute("aria-busy", "true");
    btn.disabled = true;
    try {
      const data = await fetchJson(ENDPOINTS.cluster);
      cluster.lastCluster = data;
      renderClusterBar(data);
      const nodes = renderClusterOverview(data);
      main.replaceChildren(...nodes);
      applyStagger();
      main.setAttribute("aria-busy", "false");
    } catch (e) {
      renderError(e);
    } finally {
      inFlight = false;
      btn.setAttribute("aria-busy", "false");
      btn.disabled = false;
    }
    return;
  }
  await _origLoadCurrentTab();
  applyStagger();
};

// initial
bootCluster();
const initialTab = location.hash.replace("#", "") || "overview";
switchTab(initialTab);
