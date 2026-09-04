/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        ProxmoxVEx/native/docker_swarm/ui.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Ui JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
try {
  var _t = new URLSearchParams(location.search).get('theme');
  if (_t) document.documentElement.setAttribute('data-theme', _t);
} catch (e) { }
const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ============== i18n (v3.0.0 — namespace-aware) ==============
// Integrates with ProxmoxVEx's namespace-aware i18n system when available.
// Falls back to inline I18N dictionary (Spanish keys -> English values).
let _parentI18n = null;
try { _parentI18n = window.parent.ProxmoxVExI18n; } catch (e) { }

function detectLang() {
  // Priority: parent i18n system > URL param > parent window var > localStorage
  try { const p = window.parent.ProxmoxVExLanguage; if (p) return p; } catch (e) { }
  try { const n = new URLSearchParams(location.search).get('lang'); if (n) return n.split(/[-_]/)[0].toLowerCase(); } catch (e) { }
  try { const o = localStorage.getItem('docker_swarm_lang'); if (o) return o; } catch (e) { }
  const supported = (function () { try { return window.parent.ProxmoxVExSupportedLangs; } catch (e) { return null; } })() || ['de', 'en', 'it', 'fr', 'es', 'pt', 'ko'];
  const base = (navigator.language || '').split(/[-_]/)[0].toLowerCase();
  if (supported.includes(base)) return base;
  return 'en';
}
let LANG = detectLang();
try { document.documentElement.lang = LANG; } catch (e) { }

// Use the parent i18n system for the docker_swarm namespace.
function t(s, params) {
  // Always use the parent i18n system for the docker_swarm namespace
  if (_parentI18n) {
    return _parentI18n.t(s, { ns: 'docker_swarm', params: params });
  }
  return s;
}
// Alias for use inside scopes that shadow `t` (e.g. .map(t =>{t("...) over targets).
const tr = t;

const API = '/api/docker_swarm';

// v2.1.0 multi-cluster: the active cluster id is a module-level mutable so the
// global `api()` helper and the few raw fetches all pick it up without having
// to thread a prop through every component. The selector in")}<App/> sets it.
let _CLUSTER = '';
function clURL(path) {
  if (!_CLUSTER) return `${API}/${path}`;
  const sep = path.includes('?') ? '&' : '?';
  return `${API}/${path}${sep}cluster=${encodeURIComponent(_CLUSTER)}`;
}

// v2.0.0: tabs that depend on Docker Swarm primitives (`docker node|service|
// stack|...`). Hidden when engine reports standalone. Sidebar nav, mode-flip
// auto-bounce, and the legend tooltip all share this single source of truth.
const SWARM_ONLY_TABS = new Set([
  'nodes', 'services', 'stacks', 'loadbalance', 'trends', 'audit'
]);

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(clURL(path), {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    return { error: 'Network error: ' + (e.message || e), _http: 0 };
  }
  let data = null;
  try { data = await res.json(); } catch (e) { data = { error: 'Invalid JSON response', _raw: '' }; }
  if (!data || typeof data !== 'object') data = { error: 'Empty response' };
  data._http = res.status;
  if (res.status === 403 && !data.error) data.error = 'Acceso denegado: requiere admin';
  return data;
}

// Format helpers
const fmtBytes = (b) => {
  if (!b || b === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + u[i];
};

const fmtUptime = (s) => {
  if (!s) return '-';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const fmtAgo = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso), now = new Date(), diff = (now - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

// Sparkline — pure SVG line chart for time-series data.
// points = [{ts, value}, ...] (ts in unix seconds, ascending)
const Sparkline = React.memo(function Sparkline({ points, width = 120, height = 32, color = 'var(--accent)', maxValue = null, fill = true }) {
  if (!points || points.length < 2) {
    return <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: 4 }}>
      {t("noData")}
    </div>;
  }
  const { linePath, fillPath, xy, last } = useMemo(() => {
    const minTs = points[0].ts;
    const maxTs = points[points.length - 1].ts;
    const tsSpan = Math.max(1, maxTs - minTs);
    const computedMax = maxValue ?? Math.max(...points.map(p => p.value || 0), 1);
    const safeMax = Math.max(computedMax, 1);
    const xy = points.map(p => {
      const x = ((p.ts - minTs) / tsSpan) * (width - 4) + 2;
      const y = height - 4 - (Math.min(p.value || 0, safeMax) / safeMax) * (height - 8);
      return [x, y];
    });
    const linePath = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const fillPath = `${linePath} L${xy[xy.length - 1][0].toFixed(1)},${height - 2} L${xy[0][0].toFixed(1)},${height - 2} Z`;
    const last = points[points.length - 1];
    return { linePath, fillPath, xy, last };
  }, [points, width, height, maxValue]);
  return <svg width={width} height={height} style={{ display: 'block' }}>
    {fill && <path d={fillPath} fill={color} opacity={0.15} />}
    <path d={linePath} stroke={color} strokeWidth={1.5} fill="none" />
    <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r={2} fill={color} />
    <text x={width - 2} y={11} textAnchor="end" fontSize="9" fill="var(--muted)">
      {(last.value ?? 0).toFixed?.(1) ?? last.value}
    </text>
  </svg>;
});

// Toast
function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, []);
  const bg = type === 'error' ? 'var(--red)' : type === 'success' ? 'var(--green)' : 'var(--blue)';
  return <div className="toast" style={{ background: bg, color: '#fff' }}>{msg}</div>;
}

// Status badge
function StatusBadge({ status }) {
  const s = (status || '').toLowerCase();
  if (['running', 'ready', 'active', 'complete'].includes(s)) return <span className="badge badge-green">{status}</span>;
  if (['down', 'failed', 'error', 'rejected', 'shutdown', 'remove'].includes(s)) return <span className="badge badge-red">{status}</span>;
  if (['drain', 'paused', 'pending', 'preparing', 'starting', 'assigned', 'accepted', 'orphaned'].includes(s)) return <span className="badge badge-yellow">{status}</span>;
  return <span className="badge badge-muted">{status || 'unknown'}</span>;
}

// Progress bar
function ProgressBar({ percent, color }) {
  const c = percent > 90 ? 'var(--red)' : percent > 70 ? 'var(--yellow)' : color || 'var(--green)';
  return <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, percent)}%`, background: c }} /></div>;
}

// Circular Gauge
function CircleGauge({ percent, color, label, subtext }) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const offset = circ - (percent / 100) * circ;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width="50" height="50" viewBox="0 0 50 50">
        <circle cx="25" cy="25" r={r} fill="none" stroke="var(--border)" strokeWidth="4" />
        <circle cx="25" cy="25" r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${circ} ${circ}`} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset .6s ease', transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }} />
        <text x="25" y="29" textAnchor="middle" style={{ fontSize: '11px', fill: 'var(--text)', fontWeight: 700 }}>{percent}%</text>
      </svg>
      {label && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, fontWeight: 600 }}>{label}</div>}
      {subtext && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{subtext}</div>}
    </div>
  );
}

// Modal
function Modal({ title, onClose, children }) {
  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal" onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h3>
        <button className="btn btn-sm" onClick={onClose}>X</button>
      </div>
      {children}
    </div>
  </div>;
}

// ============== PAGES ==============

// DiskPruneBar — botones de limpieza manual en Dashboard.
function DiskPruneBar({ onRefresh }) {
  const [busy, setBusy] = React.useState('');
  const [result, setResult] = React.useState(null);
  const targets = [
    { id: 'build-cache', label: 'Build cache', color: 'var(--blue,#3b82f6)', confirm: false },
    { id: 'images', label: t('images24h'), color: 'var(--blue,#3b82f6)', confirm: false },
    { id: 'containers', label: t('stoppedContainers'), color: 'var(--muted)', confirm: false },
    { id: 'networks', label: t('unusedNetworks'), color: 'var(--muted)', confirm: false },
    { id: 'all-safe', label: t('allSafe'), color: 'var(--yellow,#f59e0b)', confirm: true },
    { id: 'volumes', label: t('orphanedVolumes'), color: 'var(--red,#ef4444)', confirm: true },
    { id: 'all', label: t('allVolumes'), color: 'var(--red,#ef4444)', confirm: true },
  ];
  async function runPrune(t) {
    if (t.confirm && !window.confirm(tr("thisActionWillAffectAllNodes", { label: t.label, detail: t.id === 'volumes' || t.id === 'all' ? tr('mayDeleteDataFromUnmountedVolumes') : tr('itIsReversibleOnlyReclaimsSpace') }))) return;
    setBusy(t.id); setResult(null);
    try {
      const r = await fetch(clURL('disk/prune'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: t.id, all_nodes: true }) });
      const j = await r.json();
      setResult(j);
      if (onRefresh) onRefresh();
    } catch (e) { setResult({ error: String(e) }); }
    setBusy('');
  }
  return <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase' }}>{t("manualCleanup")}</div>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {targets.map(t => (
        <button key={t.id} disabled={!!busy}
          onClick={() => runPrune(t)}
          style={{ padding: '6px 10px', fontSize: 12, background: busy === t.id ? 'var(--muted)' : t.color, color: '#fff', border: 'none', borderRadius: 4, cursor: busy ? 'wait' : 'pointer', opacity: busy && busy !== t.id ? 0.5 : 1 }}>
          {busy === t.id ? '…' : '🧹 ' + t.label}
        </button>
      ))}
    </div>
    {result && <div style={{ marginTop: 10, padding: 10, background: 'var(--bg)', borderRadius: 4, fontSize: 12 }}>
      {result.error
        ? <span style={{ color: 'var(--red,#ef4444)' }}>Error: {result.error}</span>
        : <>
          <strong>{result.description}</strong>· Liberado total:<strong style={{ color: 'var(--green,#10b981)' }}>{result.total_freed_human}</strong>
          <details style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>{t("perNodeDetail")}</summary>
            <ul style={{ margin: '6px 0 0 18px', fontSize: 11 }}>
              {(result.results || []).map((r, i) => <li key={i}>{r.name || r.host}: {r.freed_bytes > 0 ? `+${(r.freed_bytes / 1024 / 1024).toFixed(1)} MB` : '0'} {r.exit_code !== 0 && <span style={{ color: 'var(--red,#ef4444)' }}>(exit {r.exit_code})</span>}</li>)}
            </ul>
          </details>
        </>}
    </div>}
  </div>;
}

// DiskAutoPruneSettings — panel en Settings para política automática.
function DiskAutoPruneSettings({ toast }) {
  const [cfg, setCfg] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [available, setAvailable] = React.useState([]);
  React.useEffect(() => {
    fetch(clURL('disk/settings')).then(r => r.json()).then(j => {
      setCfg(j.disk_auto_prune || {});
      setAvailable((j.available_targets || []).filter(t => t !== 'volumes' && t !== 'all'));
    });
  }, []);
  if (!cfg) return <div className="card">{t("loading")}</div>;
  async function save() {
    setSaving(true);
    try {
      const r = await fetch(clURL('disk/settings'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
      const j = await r.json();
      if (j.error) toast && toast(t('error', { msg: j.error }), 'error');
      else { setCfg(j.disk_auto_prune); toast && toast(t('autoPruneSaved'), 'success'); }
    } catch (e) { toast && toast(t('networkError'), 'error'); }
    setSaving(false);
  }
  async function runNow() {
    if (!window.confirm(t('runAutoPruneNowOnNodes'))) return;
    setSaving(true);
    try {
      const r = await fetch(clURL('disk/auto-prune/run'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json();
      if (j.error) toast && toast(t('error', { msg: j.error }), 'error');
      else { setCfg(j.disk_auto_prune); toast && toast(t('autoPruneExecuted'), 'success'); }
    } catch (e) { toast && toast(t('networkError'), 'error'); }
    setSaving(false);
  }
  const toggleTarget = (t) => setCfg(c => ({ ...c, targets: c.targets.includes(t) ? c.targets.filter(x => x !== t) : [...c.targets, t] }));
  return <div className="card" style={{ marginTop: 16 }}>
    <h4 style={{ marginTop: 0 }}>{t("diskAutoPrune")}</h4>
    <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
      {t("runsAutomaticCleanupOnEachNode")} <strong>{t("doesNotTouchVolumes")}</strong>{t("forbiddenInAutomaticModeForSafety")}
    </p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!cfg.enabled} onChange={e => setCfg({ ...cfg, enabled: e.target.checked })} />
          <span style={{ fontWeight: 600 }}>{cfg.enabled ? t('enabled') : t('disabled')}</span>
        </label>
      </div>
      <div>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>{t("diskThreshold")}</label>
        <input type="number" min={50} max={95} value={cfg.threshold_pct || 80}
          onChange={e => setCfg({ ...cfg, threshold_pct: parseInt(e.target.value) || 80 })}
          style={{ width: '100%', padding: 6, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)' }} />
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{t("triggersWhenExceedsThisPercentageOn")}</div>
      </div>
      <div>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>{t("checkEveryMin")}</label>
        <input type="number" min={5} max={1440} value={cfg.check_interval_min || 30}
          onChange={e => setCfg({ ...cfg, check_interval_min: parseInt(e.target.value) || 30 })}
          style={{ width: '100%', padding: 6, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)' }} />
      </div>
    </div>
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{t("whatToCleanInOrder")}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {available.map(t => (
          <label key={t} style={{ padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, cursor: 'pointer', background: cfg.targets.includes(t) ? 'var(--blue,#3b82f6)' : 'var(--bg)', color: cfg.targets.includes(t) ? '#fff' : 'var(--fg)' }}>
            <input type="checkbox" style={{ display: 'none' }} checked={cfg.targets.includes(t)} onChange={() => toggleTarget(t)} />
            {cfg.targets.includes(t) ? '✓ ' : ''}{t}
          </label>
        ))}
      </div>
    </div>
    {cfg.last_run && <div style={{ marginTop: 16, padding: 10, background: 'var(--bg)', borderRadius: 4, fontSize: 12 }}>
      <div style={{ color: 'var(--muted)' }}>{t("lastRun", { time: new Date(cfg.last_run).toLocaleString() })}</div>
      <div>{t("reclaimed")} <strong style={{ color: 'var(--green,#10b981)' }}>{((cfg.last_run_freed_bytes || 0) / 1024 / 1024).toFixed(1)} MB</strong></div>
    </div>}
    <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
      <button onClick={save} disabled={saving} style={{ padding: '8px 16px', background: 'var(--blue,#3b82f6)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
        {saving ? t('saving') : t('savePolicy')}
      </button>
      <button onClick={runNow} disabled={saving} style={{ padding: '8px 16px', background: 'var(--yellow,#f59e0b)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
        {t("runNow")}
      </button>
    </div>
  </div>;
}

// Stat card — top-level so Dashboard doesn't recreate it every render.
const StatCard = React.memo(function StatCard({ value, label, color, sub }) {
  return <div className="card" style={{ padding: '20px 16px', position: 'relative', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${color}, transparent)` }} />
    <div style={{ fontSize: 32, fontWeight: 800, color, lineHeight: 1, marginBottom: 4 }}>{value}</div>
    <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, opacity: .7 }}>{sub}</div>}
  </div>;
});

// Dashboard — enhanced visual design
const Dashboard = React.memo(function Dashboard({ overview, nodeStats, loadBalance, onRefresh, engineMode }) {
  // v2.0.0: standalone mode shows a friendly summary card instead of trying
  // to render swarm KPIs. A full standalone dashboard with container/image
  // counts is a follow-up (v2.1) — for now we steer users to the other tabs
  // which all work in standalone.
  if (engineMode === 'standalone') {
    return <div className="card" style={{ padding: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(59,130,246,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#3b82f6' }}>D</div>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{t("Docker Standalone")}</h3>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t("theConfiguredEngineIsNotPart")}</div>
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        {t("swarmFeaturesNodesServicesStacksBalance")}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12 }}>
        <span className="badge badge-blue">{t("containers")}</span>
        <span className="badge badge-blue">{t("networks")}</span>
        <span className="badge badge-blue">{t("volumes")}</span>
        <span className="badge badge-blue">{t("images")}</span>
      </div>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 16, opacity: .7 }}>
        {t("toEnableSwarmOnThisHost")} <code>{t("docker swarm init")}</code>{t("theSwarmTabsAppearAutomaticallyAfter")}
      </p>
    </div>;
  }
  if (!overview || overview.error) return <div className="card" style={{ textAlign: 'center', padding: 60 }}>
    <div style={{ fontSize: 40, marginBottom: 12, opacity: .3 }}>~</div>
    <p style={{ color: 'var(--muted)', marginBottom: 8, fontSize: 15 }}>{t("noConnectionToTheSwarm")}</p>
    <p style={{ fontSize: 12, color: 'var(--red)' }}>{overview?.error || t('configureAHostInTheSettings')}</p>
  </div>;

  const sw = overview.swarm || {};
  const totalContainers = (sw.containers_running || 0) + (sw.containers_stopped || 0) + (sw.containers_paused || 0);
  const runPct = totalContainers > 0 ? ((sw.containers_running || 0) / totalContainers * 100).toFixed(0) : 0;



  return <>
    {/* Stat cards with colored top accents */}
    <div className="grid-4" style={{ marginBottom: 16 }}>
      <StatCard value={sw.nodes_count || 0} label={t("nodes")} color="#3b82f6" sub={`${sw.managers || 0} managers`} />
      <StatCard value={overview.services_count || 0} label={t("services")} color="var(--accent)" sub="Docker Swarm" />
      <StatCard value={sw.containers_running || 0} label={t("Containers Running")} color="var(--green)" sub={`${totalContainers} total`} />
      <StatCard value={sw.images || 0} label={t("images")} color="#a855f7" sub="Across all nodes" />
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
      {/* Swarm Info — improved layout */}
      <div className="card" style={{ position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3, background: 'var(--accent)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingLeft: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(229,112,0,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>S</div>
          <div>
            <h4 style={{ fontSize: 14, fontWeight: 700 }}>{t("Swarm Cluster")}</h4>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Docker {sw.docker_version}</div>
          </div>
          <span className="live-dot" style={{ marginLeft: 'auto' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13, paddingLeft: 8 }}>
          <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>{t("Manager Node")}</span><div style={{ fontWeight: 500 }}>{sw.hostname}</div></div>
          <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>{t("OS")}</span><div style={{ fontWeight: 500 }}>{(sw.os || '').replace('Ubuntu ', 'Ubuntu\n')}</div></div>
          <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>{t("Kernel")}</span><div style={{ fontFamily: 'monospace', fontSize: 12 }}>{sw.kernel}</div></div>
          <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>{t("architecture")}</span><div style={{ fontWeight: 500 }}>{sw.arch || 'x86_64'}</div></div>
          <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>{t("Topology")}</span>
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <span className="badge badge-blue">{sw.managers || 0} Managers</span>
              <span className="badge badge-muted">{(sw.nodes_count || 0) - (sw.managers || 0)} Workers</span>
            </div>
          </div>
          <div><span style={{ color: 'var(--muted)', fontSize: 11 }}>{t("CPUs (manager)")}</span><div style={{ fontWeight: 500 }}>{sw.cpus || 0} cores</div></div>
        </div>
      </div>

      {/* Containers — donut-style visual */}
      <div className="card">
        <h4 style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>{t("Container Status")}</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {/* Simple donut via SVG */}
          <svg width="90" height="90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15.915" fill="none" stroke="var(--border)" strokeWidth="3" />
            <circle cx="18" cy="18" r="15.915" fill="none" stroke="var(--green)" strokeWidth="3"
              strokeDasharray={`${runPct} ${100 - runPct}`} strokeDashoffset="25" strokeLinecap="round"
              style={{ transition: 'stroke-dasharray .6s ease' }} />
            <text x="18" y="18" textAnchor="middle" dy=".1em" style={{ fontSize: '8px', fill: 'var(--text)', fontWeight: 700 }}>{runPct}%</text>
            <text x="18" y="23" textAnchor="middle" style={{ fontSize: '3.5px', fill: 'var(--muted)' }}>{t("healthy")}</text>
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--green)' }} />
              <span style={{ fontSize: 13, flex: 1 }}>{t("Running")}</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>{sw.containers_running || 0}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--red)' }} />
              <span style={{ fontSize: 13, flex: 1 }}>{t("Stopped")}</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--red)' }}>{sw.containers_stopped || 0}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--yellow)' }} />
              <span style={{ fontSize: 13, flex: 1 }}>{t("Paused")}</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--yellow)' }}>{sw.containers_paused || 0}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Disk Usage — horizontal bars + prune actions */}
    {(overview.disk_usage || []).length > 0 && <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{t("Disk Usage (Manager)")}</h4>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t("actionsAffectAllNodes")}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {overview.disk_usage.map((d, i) => {
          const pctMatch = (d.Reclaimable || '').match(/\((\d+)%\)/);
          const pct = pctMatch ? parseInt(pctMatch[1]) : 0;
          return <div key={i} style={{ padding: 12, background: 'var(--bg)', borderRadius: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{d.Type}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{d.Size}</span>
            </div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
              <div style={{ height: '100%', width: `${100 - pct}%`, background: pct > 50 ? 'var(--green)' : 'var(--yellow)', borderRadius: 3, transition: 'width .4s' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t("reclaimable", { r: d.Reclaimable })}</div>
          </div>;
        })}
      </div>
      <DiskPruneBar onRefresh={onRefresh} />
    </div>}

    {/* Task Balance Summary */}
    {loadBalance && !loadBalance.error && (() => {
      const { nodes, total_tasks, balance_score, recommendation } = loadBalance;
      const scoreColor = balance_score >= 80 ? 'var(--green)' : balance_score >= 50 ? 'var(--yellow)' : 'var(--red)';
      const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
      return <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
          <h4 style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{t("Task Balance")}</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: scoreColor }}>{balance_score}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>/100</span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{total_tasks} tasks</span>
        </div>
        {/* Stacked bar */}
        <div style={{ display: 'flex', height: 20, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
          {nodes.map((n, i) => {
            const pct = total_tasks > 0 ? (n.tasks_running / total_tasks) * 100 : 0;
            return <div key={i} title={`${n.name}: ${n.tasks_running} tasks`}
              style={{ width: `${pct}%`, background: colors[i % colors.length], minWidth: pct > 0 ? 2 : 0, transition: 'width .3s' }} />;
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {nodes.map((n, i) => {
            const pct = total_tasks > 0 ? ((n.tasks_running / total_tasks) * 100).toFixed(0) : 0;
            return <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: colors[i % colors.length], display: 'inline-block' }} />
              <span style={{ color: 'var(--muted)' }}>{n.name}</span>
              <span style={{ fontWeight: 600 }}>{n.tasks_running}</span>
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>({pct}%)</span>
            </div>;
          })}
        </div>
        {recommendation && <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 4, fontSize: 11, color: 'var(--yellow)' }}>
          {recommendation}
        </div>}
      </div>;
    })()}

    {/* Node Resources — enhanced cards instead of plain table */}
    {nodeStats && nodeStats.stats && <div>
      <h4 style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>{t("resourcesPerNode")}</h4>
      <div className="grid-3">
        {nodeStats.stats.map((n, i) => {
          const cpuPct = n.cpu_count ? ((n.load_1m / n.cpu_count) * 100).toFixed(0) : 0;
          const memPct = n.mem_total ? ((n.mem_used / n.mem_total) * 100).toFixed(1) : 0;
          const diskPct = n.disk_total ? ((n.disk_used / n.disk_total) * 100).toFixed(1) : 0;
          const cpuColor = cpuPct > 80 ? 'var(--red)' : cpuPct > 50 ? 'var(--yellow)' : 'var(--green)';
          const memColor = memPct > 80 ? 'var(--red)' : memPct > 50 ? 'var(--yellow)' : 'var(--green)';
          const diskColor = diskPct > 80 ? 'var(--red)' : diskPct > 50 ? 'var(--yellow)' : 'var(--green)';

          return <div key={i} className="card" style={{ position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${cpuColor}, ${memColor}, ${diskColor})` }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{n.name || n.hostname}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{n.host}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="live-dot" style={{ width: 6, height: 6 }} />{' '}
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtUptime(n.uptime_seconds)}</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-around', gap: 10, marginTop: 20, marginBottom: 8 }}>
              <CircleGauge percent={cpuPct} color={cpuColor} label={t("CPU")} subtext={`${n.load_1m} / ${n.cpu_count}c`} />
              <CircleGauge percent={memPct} color={memColor} label={t("RAM")} subtext={fmtBytes(n.mem_used)} />
              <CircleGauge percent={diskPct} color={diskColor} label={t("disk")} subtext={fmtBytes(n.disk_used)} />
            </div>
          </div>;
        })}
      </div>
    </div>}

    <div style={{ textAlign: 'right', marginTop: 12, fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
      <span className="live-dot" /> {t("liveUpdated", { time: overview.updated_at ? new Date(overview.updated_at).toLocaleTimeString() : '-' })}
    </div>
  </>;
});

// Nodes
const Nodes = React.memo(function Nodes({ data }) {
  if (!data || !data.length) return <div className="card" style={{ padding: 20, color: 'var(--muted)' }}>{t("noNodes")}</div>;;
  return <div className="card">
    <table>
      <thead><tr><th>{t("ID")}</th><th>{t("Hostname")}</th><th>{t("Status")}</th><th>{t("Availability")}</th><th>{t("Role")}</th><th>{t("Engine")}</th><th>{t("IP")}</th><th>{t("CPU")}</th><th>{t("RAM")}</th></tr></thead>
      <tbody>{data.map((n, i) => <tr key={i}>
        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{(n.ID || '').substring(0, 12)}</td>
        <td><strong>{n.Hostname}</strong></td>
        <td><StatusBadge status={n.state || n.Status} /></td>
        <td><StatusBadge status={n.Availability} /></td>
        <td><span className={`badge ${n.ManagerStatus ? 'badge-blue' : 'badge-muted'}`}>{n.ManagerStatus || 'Worker'}</span></td>
        <td>{n.engine_version || n.EngineVersion}</td>
        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{n.addr || '-'}</td>
        <td>{n.resources?.cpus ? n.resources.cpus.toFixed(0) + ' cores' : '-'}</td>
        <td>{n.resources?.memory_bytes ? fmtBytes(n.resources.memory_bytes) : '-'}</td>
      </tr>)}</tbody>
    </table>
  </div>;
});

// Service Detail — Portainer-style full service view
// Row — top-level so ServiceDetail doesn't recreate it every render.
const Row = React.memo(function Row({ label, val, mono }) {
  return <tr><td style={{ color: 'var(--muted)', width: 200, fontSize: 13 }}>{label}</td><td style={mono ? { fontFamily: 'monospace', fontSize: 12 } : { fontSize: 13 }}>{val || '-'}</td></tr>;
});

const ServiceDetail = React.memo(function ServiceDetail({ serviceId, onBack, toast }) {
  const [svc, setSvc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState('details');
  const [logs, setLogs] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [editReplicas, setEditReplicas] = useState('');
  const [editImage, setEditImage] = useState('');
  const [unmasked, setUnmasked] = useState(false);

  const load = async (opts = {}) => {
    setLoading(true);
    const q = opts.unmask ? '&unmask=1' : '';
    const d = await api(`service-detail?service_id=${encodeURIComponent(serviceId)}${q}`);
    if (d._http === 403) toast(d.error || t('accessDenied'), 'error');
    setSvc(d); setEditReplicas(d.replicas ?? ''); setEditImage(d.image?.split('@')[0] || '');
    setUnmasked(!!opts.unmask && d.env_masked === false);
    setLoading(false);
  };
  useEffect(() => { load(); }, [serviceId]);

  const toggleUnmask = async () => {
    if (unmasked) { setUnmasked(false); load(); return; }
    if (!confirm(t('showRealValuesOfSensitiveVariables'))) return;
    load({ unmask: true });
  };

  const loadLogs = async () => { setLogsLoading(true); const r = await api(`service-logs?service_id=${encodeURIComponent(serviceId)}&tail=200`); setLogs(r.logs || ''); setLogsLoading(false); };

  const doUpdate = async () => {
    const body = { service_id: serviceId };
    if (editImage !== (svc.image?.split('@')[0] || '')) body.image = editImage;
    if (svc.mode_type === 'replicated' && parseInt(editReplicas) !== svc.replicas) body.replicas = parseInt(editReplicas);
    const r = await api('service-update', { method: 'POST', body });
    if (r.success) { toast(t('serviceUpdated'), 'success'); load(); } else toast(r.error, 'error');
  };
  const doRollback = async () => { if (!confirm(t('rollThisServiceBackToThe'))) return; const r = await api('service-rollback', { method: 'POST', body: { service_id: serviceId } }); if (r.success) { toast(t('rollbackSuccessful'), 'success'); load(); } else toast(r.error, 'error'); };
  const doRestart = async () => { const r = await api('service-restart', { method: 'POST', body: { service_id: serviceId } }); if (r.success) { toast(t('restarted'), 'success'); load(); } else toast(r.error, 'error'); };
  const doRemove = async () => { if (!confirm(t('deleteService', { id: serviceId }))) return; const r = await api('service-remove', { method: 'POST', body: { service_id: serviceId } }); if (r.success) { toast(t('deleted'), 'success'); onBack(); } else toast(r.error, 'error'); };

  const fmtNano = (ns) => ns ? `${(ns / 1e9).toFixed(1)}s` : '-';
  const fmtNanoCpu = (n) => n ? (n / 1e9).toFixed(2) : '-';
  const fmtMemLimit = (b) => b ? fmtBytes(b) : '-';

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner" /> {t("loadingService")}</div>;
  if (!svc || svc.error) return <div className="card" style={{ padding: 20, color: 'var(--red)' }}>{svc?.error || 'Error'}</div>;

  const sections = [
    { id: 'details', label: t('details') },
    { id: 'env', label: t('environmentVariables') },
    { id: 'image', label: 'Container Image' },
    { id: 'labels', label: 'Labels' },
    { id: 'mounts', label: 'Mounts' },
    { id: 'network', label: t('networkPorts') },
    { id: 'resources', label: t('resources') },
    { id: 'placement', label: 'Placement' },
    { id: 'restart', label: 'Restart Policy' },
    { id: 'update', label: 'Update Config' },
    { id: 'logging', label: 'Logging' },
    { id: 'secrets', label: 'Configs & Secrets' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'logs', label: 'Logs' },
  ];



  return <>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <button className="btn btn-sm" onClick={onBack}>{t("back")}</button>
      <h3 style={{ fontSize: 16, fontWeight: 700 }}>{t("Service details")}</h3>
      <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>{svc.name}</span>
    </div>

    <div style={{ display: 'flex', gap: 16 }}>
      {/* Main content */}
      <div style={{ flex: 1 }}>
        {section === 'details' && <div className="card fade-in">
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>{t("Service details")}</h4>
          <table style={{ width: '100%' }}><tbody>
            <Row label={t("Name")} val={svc.name} />
            <Row label={t("ID")} val={svc.id} mono />
            <Row label={t("Created at")} val={svc.created ? new Date(svc.created).toLocaleString() : '-'} />
            <Row label={t("Last updated at")} val={svc.updated ? new Date(svc.updated).toLocaleString() : '-'} />
            <Row label={t("Version")} val={svc.version} />
            <Row label={t("Scheduling mode")} val={svc.mode_type} />
          </tbody></table>

          <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            {svc.mode_type === 'replicated' && <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{t("Replicas")}</label>
              <input type="number" value={editReplicas} onChange={e => setEditReplicas(e.target.value)} min={0} max={100} style={{ width: 80 }} />
            </div>}
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{t("Image")}</label>
              <input value={editImage} onChange={e => setEditImage(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Full: {svc.image}</div>

          {svc.has_previous_spec && <div style={{ marginTop: 12, padding: 8, background: 'rgba(234,179,8,.1)', borderRadius: 6, fontSize: 12, color: 'var(--yellow)' }}>
            {t("rollbackAvailablePreviousImage", { img: svc.previous_image?.split('@')[0] || 'unknown' })}
          </div>}

          <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <button className="btn btn-sm" onClick={() => { setSection('logs'); loadLogs(); }}>{t("Service logs")}</button>
            <button className="btn btn-sm btn-primary" onClick={doUpdate}>{t("Update the service")}</button>
            {svc.has_previous_spec && <button className="btn btn-sm" style={{ background: 'var(--yellow)', borderColor: 'var(--yellow)', color: '#000' }} onClick={doRollback}>{t("Rollback the service")}</button>}
            <button className="btn btn-sm btn-danger" onClick={doRemove}>{t("Delete the service")}</button>
          </div>
        </div>}

        {section === 'env' && <div className="card fade-in">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Environment variables ({svc.env?.length || 0})</h4>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {svc.env_masked && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t("sensitiveValuesHidden")}</span>}
              <button className="btn btn-sm" onClick={toggleUnmask}>
                {unmasked ? t('hide') : t('showRealAdmin')}
              </button>
            </div>
          </div>
          {(svc.env || []).length ? <div style={{ background: 'var(--bg)', borderRadius: 6, padding: 8, fontFamily: 'monospace', fontSize: 12, maxHeight: 400, overflow: 'auto' }}>
            {svc.env.map((e, i) => {
              const [k, ...v] = e.split('='); const val = v.join('='); const sensitive = /password|secret|token|apikey|api_key|jwt|bearer|auth|private|credential|dsn|passwd|passphrase/i.test(k); const serverMasked = val === '***'; const display = serverMasked ? '••••••••' : val;
              return <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}><span style={{ color: 'var(--blue)' }}>{k}</span>=<span style={{ color: sensitive || serverMasked ? 'var(--red)' : 'var(--green)' }}>{display}</span></div>;
            })}
          </div> : <div style={{ color: 'var(--muted)' }}>{t("noEnvironmentVariables")}</div>}
        </div>}

        {section === 'image' && <div className="card fade-in">
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t("Container image")}</h4>
          <table style={{ width: '100%' }}><tbody>
            <Row label={t("Image")} val={svc.image?.split('@')[0]} mono />
            <Row label={t("Digest")} val={svc.image?.includes('@') ? svc.image.split('@')[1] : '-'} mono />
            <Row label={t("Command")} val={(svc.command || []).join(' ')} mono />
            <Row label={t("Arguments")} val={(svc.args || []).join(' ')} mono />
            <Row label={t("Working Dir")} val={svc.dir} mono />
            <Row label={t("User")} val={svc.user} />
            <Row label={t("Hostname")} val={svc.hostname} />
            <Row label={t("Read Only")} val={svc.read_only ? 'Yes' : 'No'} />
            <Row label={t("Init")} val={svc.init === true ? 'Yes' : svc.init === false ? 'No' : '-'} />
            <Row label={t("Stop Grace Period")} val={fmtNano(svc.stop_grace_period)} />
          </tbody></table>
          {svc.healthcheck && Object.keys(svc.healthcheck).length > 0 && <>
            <h5 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 12 }}>{t("Healthcheck")}</h5>
            <table style={{ width: '100%' }}><tbody>
              <Row label={t("Test")} val={(svc.healthcheck.Test || []).join(' ')} mono />
              <Row label={t("Interval")} val={fmtNano(svc.healthcheck.Interval)} />
              <Row label={t("Timeout")} val={fmtNano(svc.healthcheck.Timeout)} />
              <Row label={t("Retries")} val={svc.healthcheck.Retries} />
            </tbody></table>
          </>}
        </div>}

        {section === 'labels' && <div className="card fade-in">
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t("Service labels")}</h4>
          {Object.entries(svc.service_labels || {}).length ? <div style={{ background: 'var(--bg)', borderRadius: 6, padding: 8, fontFamily: 'monospace', fontSize: 12 }}>
            {Object.entries(svc.service_labels).map(([k, v], i) => <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}><span style={{ color: 'var(--blue)' }}>{k}</span>=<span style={{ color: 'var(--green)' }}>{v}</span></div>)}
          </div> : <div style={{ color: 'var(--muted)' }}>{t("noLabels")}</div>}
          <h4 style={{ fontSize: 14, fontWeight: 600, marginTop: 16, marginBottom: 12 }}>{t("Container labels")}</h4>
          {Object.entries(svc.container_labels || {}).length ? <div style={{ background: 'var(--bg)', borderRadius: 6, padding: 8, fontFamily: 'monospace', fontSize: 12 }}>
            {Object.entries(svc.container_labels).map(([k, v], i) => <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}><span style={{ color: 'var(--blue)' }}>{k}</span>=<span style={{ color: 'var(--green)' }}>{v}</span></div>)}
          </div> : <div style={{ color: 'var(--muted)' }}>{t("noContainerLabels")}</div>}
        </div>}

        {section === 'mounts' && <div className="card fade-in">
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Mounts ({(svc.mounts || []).length})</h4>
          {(svc.mounts || []).length ? <table><thead><tr><th>{t("type")}</th><th>{t("Source")}</th><th>{t("Target")}</th><th>{t("ReadOnly")}</th></tr></thead>
            <tbody>{svc.mounts.map((m, i) => <tr key={i}><td><span className="badge badge-blue">{m.Type}</span></td><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{m.Source || '-'}</td><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{m.Target}</td><td>{m.ReadOnly ? 'Yes' : 'No'}</td></tr>)}</tbody>
          </table> : <div style={{ color: 'var(--muted)' }}>{t("noMounts")}</div>}
        </div>}

        {section === 'network' && <div className="card fade-in">
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Network & published ports</h4>
          <table style={{ width: '100%' }}><tbody>
            <Row label={t("Endpoint Mode")} val={svc.endpoint_mode} />
          </tbody></table>
          {(svc.published_ports || []).length > 0 && <>
            <h5 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 12 }}>{t("Published ports")}</h5>
            <table><thead><tr><th>{t("Published")}</th><th>{t("Target")}</th><th>{t("Protocol")}</th><th>{t("Mode")}</th></tr></thead>
              <tbody>{svc.published_ports.map((p, i) => <tr key={i}><td>{p.PublishedPort}</td><td>{p.TargetPort}</td><td>{p.Protocol}</td><td>{p.PublishMode || 'ingress'}</td></tr>)}</tbody>
            </table>
          </>}
          {(svc.virtual_ips || []).length > 0 && <>
            <h5 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 12 }}>{t("Virtual IPs")}</h5>
            {svc.virtual_ips.map((v, i) => <div key={i} style={{ fontFamily: 'monospace', fontSize: 12 }}>{v.Addr} (Network: {(v.NetworkID || '').substring(0, 12)})</div>)}
          </>}
        </div>}

        {section === 'resources' && <div className="card fade-in">
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Resource limits & reservations</h4>
          <table style={{ width: '100%' }}><tbody>
            <Row label={t("CPU Limit")} val={fmtNanoCpu(svc.resource_limits?.NanoCPUs)} />
            <Row label={t("Memory Limit")} val={fmtMemLimit(svc.resource_limits?.MemoryBytes)} />
            <Row label={t("CPU Reservation")} val={fmtNanoCpu(svc.resource_reservations?.NanoCPUs)} />
            <Row label={t("Memory Reservation")} val={fmtMemLimit(svc.resource_reservations?.MemoryBytes)} />
          </tbody></table>
        </div>}

        {section === 'placement' && <div className="card fade-in">
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t("Placement constraints")}</h4>
          {(svc.constraints || []).length ? <div style={{ background: 'var(--bg)', borderRadius: 6, padding: 8, fontFamily: 'monospace', fontSize: 12 }}>
            {svc.constraints.map((c, i) => <div key={i} style={{ padding: '2px 0' }}>{c}</div>)}
          </div> : <div style={{ color: 'var(--muted)' }}>{t("noConstraints")}</div>}
          <h4 style={{ fontSize: 14, fontWeight: 600, marginTop: 16, marginBottom: 12 }}>{t("Placement preferences")}</h4>
          {(svc.preferences || []).length ? <div style={{ background: 'var(--bg)', borderRadius: 6, padding: 8, fontFamily: 'monospace', fontSize: 12 }}>
            {svc.preferences.map((p, i) => <div key={i}>{JSON.stringify(p)}</div>)}
          </div> : <div style={{ color: 'var(--muted)' }}>{t("noPreferences")}</div>}
          {svc.max_replicas > 0 && <div style={{ marginTop: 8 }}><Row label={t("Max replicas per node")} val={svc.max_replicas} /></div>}
        </div>}

        {section === 'restart' && <div className="card fade-in">
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t("Restart policy")}</h4>
          <table style={{ width: '100%' }}><tbody>
            <Row label={t("Condition")} val={svc.restart_condition} />
            <Row label={t("Delay")} val={fmtNano(svc.restart_delay)} />
            <Row label={t("Max Attempts")} val={svc.restart_max_attempts || 'unlimited'} />
            <Row label={t("Window")} val={fmtNano(svc.restart_window)} />
          </tbody></table>
        </div>}

        {section === 'update' && <div className="card fade-in">
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t("Update configuration")}</h4>
          <table style={{ width: '100%' }}><tbody>
            <Row label={t("Parallelism")} val={svc.update_parallelism} />
            <Row label={t("Delay")} val={fmtNano(svc.update_delay)} />
            <Row label={t("Failure Action")} val={svc.update_failure_action} />
            <Row label={t("Monitor")} val={fmtNano(svc.update_monitor)} />
            <Row label={t("Max Failure Ratio")} val={svc.update_max_failure_ratio} />
            <Row label={t("Order")} val={svc.update_order} />
          </tbody></table>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginTop: 16, marginBottom: 12 }}>{t("Rollback configuration")}</h4>
          <table style={{ width: '100%' }}><tbody>
            <Row label={t("Parallelism")} val={svc.rollback_parallelism} />
            <Row label={t("Delay")} val={fmtNano(svc.rollback_delay)} />
            <Row label={t("Failure Action")} val={svc.rollback_failure_action} />
            <Row label={t("Order")} val={svc.rollback_order} />
          </tbody></table>
        </div>}

        {section === 'logging' && <div className="card fade-in">
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t("Logging")}</h4>
          <table style={{ width: '100%' }}><tbody>
            <Row label={t("Driver")} val={svc.log_driver || 'default (json-file)'} />
          </tbody></table>
          {Object.keys(svc.log_options || {}).length > 0 && <div style={{ marginTop: 8, background: 'var(--bg)', borderRadius: 6, padding: 8, fontFamily: 'monospace', fontSize: 12 }}>
            {Object.entries(svc.log_options).map(([k, v], i) => <div key={i}><span style={{ color: 'var(--blue)' }}>{k}</span>={v}</div>)}
          </div>}
        </div>}

        {section === 'secrets' && <div className="card fade-in">
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Configs ({(svc.configs || []).length})</h4>
          {(svc.configs || []).length ? <table><thead><tr><th>{t("Name")}</th><th>{t("Target")}</th><th>{t("Mode")}</th></tr></thead>
            <tbody>{svc.configs.map((c, i) => <tr key={i}><td>{c.ConfigName || c.ConfigID}</td><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.File?.Name}</td><td>{c.File?.Mode}</td></tr>)}</tbody>
          </table> : <div style={{ color: 'var(--muted)' }}>{t("noConfigs")}</div>}
          <h4 style={{ fontSize: 14, fontWeight: 600, marginTop: 16, marginBottom: 12 }}>Secrets ({(svc.secrets || []).length})</h4>
          {(svc.secrets || []).length ? <table><thead><tr><th>{t("Name")}</th><th>{t("Target")}</th><th>{t("Mode")}</th></tr></thead>
            <tbody>{svc.secrets.map((s, i) => <tr key={i}><td>{s.SecretName || s.SecretID}</td><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.File?.Name}</td><td>{s.File?.Mode}</td></tr>)}</tbody>
          </table> : <div style={{ color: 'var(--muted)' }}>{t("noSecrets")}</div>}
        </div>}

        {section === 'tasks' && <div className="card fade-in">
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Tasks ({(svc.tasks || []).length})</h4>
          <table><thead><tr><th>{t("ID")}</th><th>{t("name")}</th><th>{t("node")}</th><th>{t("state")}</th><th>{t("Error")}</th></tr></thead>
            <tbody>{(svc.tasks || []).map((t, i) => <tr key={i}>
              <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{(t.ID || '').substring(0, 12)}</td>
              <td>{t.Name}</td><td>{t.Node}</td>
              <td><StatusBadge status={t.CurrentState?.split(' ')[0] || t.DesiredState} /><div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.CurrentState}</div></td>
              <td style={{ fontSize: 12, color: 'var(--red)', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.Error || '-'}</td>
            </tr>)}</tbody>
          </table>
        </div>}

        {section === 'logs' && <div className="card fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600 }}>{t("Service logs")}</h4>
            <button className="btn btn-sm" onClick={loadLogs}>{t("refresh")}</button>
          </div>
          {logsLoading ? <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner" /></div>
            : <div className="log-viewer">{logs || t('noLogs')}</div>}
        </div>}
      </div>

      {/* Quick navigation sidebar */}
      <div style={{ width: 200, flexShrink: 0 }}>
        <div className="card" style={{ position: 'sticky', top: 0 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t("Quick navigation")}</h4>
          {sections.map(s => <div key={s.id} style={{ padding: '5px 8px', fontSize: 12, cursor: 'pointer', borderRadius: 4, color: section === s.id ? 'var(--accent)' : 'var(--muted)', background: section === s.id ? 'rgba(229,112,0,.1)' : 'transparent', marginBottom: 2, transition: 'all .15s' }}
            onClick={() => { setSection(s.id); if (s.id === 'logs' && !logs) loadLogs(); }}
            onMouseEnter={e => { if (section !== s.id) e.currentTarget.style.color = 'var(--text)'; }}
            onMouseLeave={e => { if (section !== s.id) e.currentTarget.style.color = 'var(--muted)'; }}
          >{s.label}</div>)}
        </div>
      </div>
    </div>
  </>;
});

// Services
const Services = React.memo(function Services({ data, onScale, onRestart, onLogs, onTasks, toast }) {
  const [selectedService, setSelectedService] = useState(null);
  const [filterInput, setFilterInput] = useState('');
  const [filter, setFilter] = useState('');

  const selectService = useCallback((name) => setSelectedService(name), []);
  const closeService = useCallback(() => setSelectedService(null), []);

  useEffect(() => {
    const id = setTimeout(() => setFilter(filterInput), 250);
    return () => clearTimeout(id);
  }, [filterInput]);

  const filtered = useMemo(() => {
    const f = filter.toLowerCase();
    return (data || []).filter(s => {
      const name = (s.Name || '').toLowerCase();
      const stack = (s.stack || '').toLowerCase();
      return !f || name.includes(f) || stack.includes(f);
    });
  }, [data, filter]);

  if (selectedService) return <ServiceDetail serviceId={selectedService} onBack={closeService} toast={toast} />;

  if (!data || !data.length) return <div className="card" style={{ padding: 20, color: 'var(--muted)' }}>{t("noServices")}</div>;

  return <>
    <div style={{ marginBottom: 12 }}>
      <input placeholder={t("filterServices")} value={filterInput} onChange={e => setFilterInput(e.target.value)} style={{ maxWidth: 300 }} />
    </div>
    <div className="card" style={{ overflowX: 'auto' }}>
      <table>
        <thead><tr><th>{t("service")}</th><th>{t("Stack")}</th><th>{t("Image")}</th><th>{t("Replicas")}</th><th>{t("Ports")}</th><th>{t("Updated")}</th><th>{t("actions")}</th></tr></thead>
        <tbody>{filtered.map((s, i) => {
          const img = (s.Image || s.image_full || '').split('@')[0];
          const shortImg = img.includes('/') ? img.split('/').pop() : img;
          return <tr key={i}>
            <td><strong style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => selectService(s.Name)}>{s.Name}</strong><div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{(s.ID || '').substring(0, 12)}</div></td>
            <td>{s.stack ? <span className="badge badge-blue">{s.stack}</span> : '-'}</td>
            <td style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={img}>{shortImg}</td>
            <td><span style={{ fontWeight: 600 }}>{s.Replicas}</span>{s.mode_type === 'global' && <span className="badge badge-muted" style={{ marginLeft: 4 }}>{t("global")}</span>}</td>
            <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{s.Ports || '-'}</td>
            <td style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtAgo(s.updated || s.UpdatedAt)}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              <button className="btn btn-sm" onClick={() => onTasks(s)} title={t("Tasks")}>{t("Tasks")}</button>{' '}
              <button className="btn btn-sm" onClick={() => onLogs(s.Name || s.ID)} title={t("Logs")}>{t("Logs")}</button>{' '}
              {s.mode_type !== 'global' && <button className="btn btn-sm" onClick={() => onScale(s)} title={t("Scale")}>{t("Scale")}</button>}{' '}
              <button className="btn btn-sm" onClick={() => onRestart(s.Name || s.ID)} title={t("Restart")}>{t("Restart")}</button>
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>{t("ofServices", { n: filtered.length, total: data.length })}</div>
  </>;
});

// Stacks — full Portainer-style management
const Stacks = React.memo(function Stacks({ data, onRemove, toast }) {
  const [selected, setSelected] = useState(null); // selected stack name
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [compose, setCompose] = useState(null);
  const [composeLoading, setComposeLoading] = useState(false);
  const [stackLogs, setStackLogs] = useState(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [activeView, setActiveView] = useState('services'); // services|compose|logs|env
  const [deployModal, setDeployModal] = useState(false);
  const [deployName, setDeployName] = useState('');
  const [deployYaml, setDeployYaml] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [stackUnmasked, setStackUnmasked] = useState(false);

  const selectStack = async (name, opts = {}) => {
    if (!opts._keep) { setSelected(name); setActiveView('services'); setStackUnmasked(false); }
    setDetail(null); setCompose(null); setStackLogs(null);
    setDetailLoading(true);
    const q = opts.unmask ? '&unmask=1' : '';
    const d = await api(`stack-detail?name=${encodeURIComponent(name)}${q}`);
    if (d._http === 403) {
      toast(d.error || t('accessDenied'), 'error');
      setStackUnmasked(false);
    } else {
      setStackUnmasked(!!opts.unmask);
    }
    setDetail(d); setDetailLoading(false);
  };

  const toggleStackUnmask = async () => {
    if (stackUnmasked) { setStackUnmasked(false); selectStack(selected, { _keep: true }); return; }
    if (!confirm(t('showRealValuesOfSensitiveVariables2'))) return;
    selectStack(selected, { _keep: true, unmask: true });
  };

  const loadCompose = async () => {
    setComposeLoading(true);
    const d = await api(`stack-compose?name=${encodeURIComponent(selected)}`);
    setCompose(d); setComposeLoading(false);
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    const d = await api(`stack-logs?name=${encodeURIComponent(selected)}&tail=100`);
    setStackLogs(d); setLogsLoading(false);
  };

  const doDeploy = async () => {
    if (!deployName || !deployYaml) return;
    setDeploying(true);
    const r = await api('stack-deploy', { method: 'POST', body: { stack_name: deployName, compose_yaml: deployYaml } });
    setDeploying(false);
    if (r.success) { toast(t('stackDeployed'), 'success'); setDeployModal(false); setDeployName(''); setDeployYaml(''); }
    else toast(r.error || 'Error', 'error');
  };

  const doRedeploy = async (name) => {
    if (!compose?.compose) { toast(t('loadTheComposeFirst'), 'error'); return; }
    if (!confirm(t('redeployStackThisWillUpdateThe', { name }))) return;
    const r = await api('stack-deploy', { method: 'POST', body: { stack_name: name, compose_yaml: compose.compose } });
    if (r.success) { toast(t('stackRedeployed', { name }), 'success'); selectStack(name); }
    else toast(r.error || 'Error', 'error');
  };

  if (!data || !data.length) return <div className="card" style={{ padding: 20, color: 'var(--muted)' }}>{t("noStacks")}</div>;

  // Stack detail view
  if (selected && detail) {
    const svcs = detail.services || [];
    const totalRunning = svcs.reduce((acc, s) => {
      const r = (s.Replicas || '').split('/');
      return acc + (parseInt(r[0]) || 0);
    }, 0);
    const totalDesired = svcs.reduce((acc, s) => {
      const r = (s.Replicas || '').split('/');
      return acc + (parseInt(r[1] || r[0]) || 0);
    }, 0);
    const healthy = totalRunning === totalDesired && totalDesired > 0;

    return <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button className="btn btn-sm" onClick={() => { setSelected(null); setDetail(null); }}>{t("back")}</button>
        <h3 style={{ fontSize: 16, fontWeight: 700 }}>{selected}</h3>
        <span className={`badge ${healthy ? 'badge-green' : 'badge-yellow'}`}>{healthy ? 'Healthy' : 'Degraded'}</span>
        <span className="badge badge-blue">{t("services2", { n: svcs.length })}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{totalRunning}/{totalDesired} replicas</span>
      </div>

      <div className="tabs">
        <div className={`tab ${activeView === 'services' ? 'active' : ''}`} onClick={() => setActiveView('services')}>{t("services2", { n: svcs.length })}</div>
        <div className={`tab ${activeView === 'compose' ? 'active' : ''}`} onClick={() => { setActiveView('compose'); if (!compose) loadCompose(); }}>{t("Compose")}</div>
        <div className={`tab ${activeView === 'logs' ? 'active' : ''}`} onClick={() => { setActiveView('logs'); loadLogs(); }}>{t("Logs")}</div>
        <div className={`tab ${activeView === 'env' ? 'active' : ''}`} onClick={() => setActiveView('env')}>{t("variables")}</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {healthy ? <button className="btn btn-sm" style={{ background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' }} onClick={async () => { if (!confirm(t('stopStackAllServicesWillBe', { name: selected }))) return; const r = await api('stack-stop', { method: 'POST', body: { stack_name: selected } }); if (r.success) { toast(r.message, 'success'); selectStack(selected); } else toast(r.error, 'error'); }}>{t("Stop Stack")}</button>
            : <button className="btn btn-sm" style={{ background: 'var(--green)', borderColor: 'var(--green)', color: '#fff' }} onClick={async () => { const r = await api('stack-start', { method: 'POST', body: { stack_name: selected } }); if (r.success) { toast(r.message, 'success'); selectStack(selected); } else toast(r.error, 'error'); }}>{t("Start Stack")}</button>}
          {compose && <button className="btn btn-sm btn-primary" onClick={() => doRedeploy(selected)}>{t("Redeploy")}</button>}
          <button className="btn btn-sm btn-danger" onClick={() => { onRemove(selected); setSelected(null); }}>{t("Remove Stack")}</button>
        </div>
      </div>

      {activeView === 'services' && <div className="card fade-in" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>{t("service")}</th><th>{t("Image")}</th><th>{t("Replicas")}</th><th>{t("ports")}</th><th>{t("taskStatus")}</th><th>{t("actions")}</th></tr></thead>
          <tbody>{svcs.map((s, i) => {
            const img = (s.image_full || s.Image || '').split('/').pop();
            const tasks = s.tasks || [];
            const running = tasks.filter(t => (t.CurrentState || '').toLowerCase().startsWith('running')).length;
            const failed = tasks.filter(t => (t.CurrentState || '').toLowerCase().includes('failed')).length;
            const ports = (s.ports_detail || []).map(p => `${p.PublishedPort || ''}:${p.TargetPort || ''}`).filter(p => p !== ':').join(', ');
            return <tr key={i}>
              <td><strong>{(s.Name || '').replace(selected + '_', '')}</strong><div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{s.Name}</div></td>
              <td style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.image_full}>{img}</td>
              <td><span style={{ fontWeight: 600, color: running > 0 ? 'var(--green)' : 'var(--red)' }}>{s.Replicas}</span>{s.mode_type === 'global' && <span className="badge badge-muted" style={{ marginLeft: 4 }}>{t("global")}</span>}</td>
              <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{ports || '-'}</td>
              <td>
                <div style={{ display: 'flex', gap: 4 }}>
                  {running > 0 && <span className="badge badge-green">{running} running</span>}
                  {failed > 0 && <span className="badge badge-red">{failed} failed</span>}
                  {tasks.length === 0 && <span className="badge badge-muted">{t("no tasks")}</span>}
                </div>
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn btn-sm" onClick={async () => { const r = await api('service-restart', { method: 'POST', body: { service_id: s.Name } }); if (r.success) { toast(t('restarted2', { name: s.Name }), 'success'); selectStack(selected); } else toast(r.error, 'error'); }}>{t("Restart")}</button>{' '}
                {s.mode_type !== 'global' && <button className="btn btn-sm" onClick={() => { const n = prompt('Replicas:', s.Replicas?.split('/').pop() || '1'); if (n !== null) api('service-scale', { method: 'POST', body: { service_id: s.Name, replicas: parseInt(n) } }).then(r => { if (r.success) { toast(t('scaled'), 'success'); selectStack(selected); } else toast(r.error, 'error'); }); }}>{t("Scale")}</button>}
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>}

      {activeView === 'compose' && <div className="card fade-in">
        {composeLoading ? <div style={{ textAlign: 'center', padding: 30 }}><span className="spinner" /></div> : compose ? <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t("source", { src: compose.source === 'stack-config' ? 'docker stack config' : t('rebuiltFromInspects') })}</span>
            <button className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(compose.compose); toast(t('copiedToClipboard'), 'success'); }}>{t("copy")}</button>
          </div>
          <textarea value={compose.compose} onChange={e => setCompose({ ...compose, compose: e.target.value })} style={{ fontFamily: 'monospace', fontSize: 12, minHeight: 400, background: '#000', color: '#0f0', padding: 12, borderRadius: 8, width: '100%', border: '1px solid var(--border)', resize: 'vertical' }} />
        </> : <div style={{ color: 'var(--muted)' }}>{t("errorLoadingCompose")}</div>}
      </div>}

      {activeView === 'logs' && <div className="card fade-in">
        {logsLoading ? <div style={{ textAlign: 'center', padding: 30 }}><span className="spinner" /></div>
          : <><div style={{ marginBottom: 8, fontSize: 12, color: 'var(--muted)' }}>{t("services3", { n: stackLogs?.services || 0 })}<button className="btn btn-sm" onClick={loadLogs}>{t("refresh")}</button></div>
            <div className="log-viewer">{stackLogs?.logs || t('noLogs')}</div></>}
      </div>}

      {activeView === 'env' && <div className="card fade-in">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h4 style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{t("environmentVariablesPerService")}</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {svcs.some(s => s.env_masked) && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t("sensitiveValuesHidden")}</span>}
            <button className="btn btn-sm" onClick={toggleStackUnmask}>
              {stackUnmasked ? t('hide') : t('showRealAdmin')}
            </button>
          </div>
        </div>
        {svcs.map((s, i) => {
          const envVars = s.env_vars || [];
          if (!envVars.length) return null;
          return <div key={i} style={{ marginBottom: 16 }}>
            <h5 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{(s.Name || '').replace(selected + '_', '')}<span style={{ color: 'var(--muted)', fontWeight: 400 }}> ({envVars.length} vars)</span></h5>
            <div style={{ background: 'var(--bg)', borderRadius: 6, padding: 8, fontSize: 12, fontFamily: 'monospace', maxHeight: 200, overflow: 'auto' }}>
              {envVars.map((e, j) => {
                const [k, ...v] = e.split('=');
                const val = v.join('=');
                const isSensitive = /password|secret|token|apikey|api_key|jwt|bearer|auth|private|credential|dsn|passwd|passphrase/i.test(k);
                const serverMasked = val === '***';
                const display = serverMasked ? '••••••••' : val;
                return <div key={j} style={{ padding: '2px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--blue)' }}>{k}</span>=<span style={{ color: (isSensitive || serverMasked) ? 'var(--red)' : 'var(--green)' }}>{display}</span>
                </div>;
              })}
            </div>
          </div>;
        })}
        {svcs.every(s => !(s.env_vars || []).length) && <div style={{ color: 'var(--muted)' }}>{t("noEnvironmentVariablesConfigured")}</div>}
      </div>}

      {detail.networks && detail.networks.length > 0 && activeView === 'services' && <div className="card" style={{ marginTop: 12 }}>
        <h4 style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>{t("stackNetworks")}</h4>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {detail.networks.map((n, i) => <span key={i} className="badge badge-blue">{n.Name} ({n.Driver})</span>)}
        </div>
      </div>}
    </>;
  }

  if (selected && detailLoading) return <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner" /> {t("loading2", { name: selected })}</div>;

  // Stack list view
  return <>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t("stacks", { n: data.length })}</span>
      <button className="btn btn-primary btn-sm" onClick={() => setDeployModal(true)}>+ Deploy Stack</button>
    </div>
    <div className="grid-3">
      {data.map((s, i) => {
        const svcCount = typeof s.Services === 'number' ? s.Services : parseInt(s.Services) || 0;
        const status = s.status || 'unknown';
        const isRunning = status === 'running';
        const isPartial = status === 'partial';
        const isStopped = status === 'stopped';
        const statusColor = isRunning ? 'var(--green)' : isPartial ? 'var(--yellow)' : 'var(--red)';
        const statusText = isRunning ? 'Running' : isPartial ? 'Partial' : isStopped ? 'Stopped' : 'Unknown';
        const borderColor = isRunning ? 'rgba(34,197,94,.3)' : isPartial ? 'rgba(234,179,8,.3)' : isStopped ? 'rgba(239,68,68,.3)' : 'var(--border)';

        return <div key={i} className="card fade-in" style={{ cursor: 'pointer', transition: 'all .2s', borderLeft: `3px solid ${statusColor}`, border: `1px solid ${borderColor}` }} onClick={() => selectStack(s.Name)}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.transform = 'translateY(-2px)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor = borderColor; e.currentTarget.style.borderLeft = `3px solid ${statusColor}`; e.currentTarget.style.transform = 'none'; }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, display: 'inline-block', animation: isRunning ? 'pulse 2s ease-in-out infinite' : 'none' }} />
              <h4 style={{ fontSize: 15, fontWeight: 700 }}>{s.Name}</h4>
            </div>
            <span className="badge badge-green">{svcCount} svcs</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: statusColor }}>{statusText}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{s.running || 0}/{s.desired || 0} replicas</span>
          </div>
          <div style={{ marginBottom: 6 }}>
            <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${s.desired > 0 ? (s.running / s.desired * 100) : 0}%`, background: statusColor, borderRadius: 2, transition: 'width .4s ease' }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t("activeServices", { r: s.svc_running || 0, d: s.svc_total || 0 })}</span>
            {isRunning || isPartial ? <button className="btn btn-sm" style={{ fontSize: 11, padding: '2px 8px', background: 'rgba(239,68,68,.15)', color: 'var(--red)', borderColor: 'rgba(239,68,68,.3)' }} onClick={e => { e.stopPropagation(); if (!confirm(t('stop', { name: s.Name }))) return; api('stack-stop', { method: 'POST', body: { stack_name: s.Name } }).then(r => { if (r.success) toast(t('stopped'), 'success'); }); }}>{t("Stop")}</button>
              : <button className="btn btn-sm" style={{ fontSize: 11, padding: '2px 8px', background: 'rgba(34,197,94,.15)', color: 'var(--green)', borderColor: 'rgba(34,197,94,.3)' }} onClick={e => { e.stopPropagation(); api('stack-start', { method: 'POST', body: { stack_name: s.Name } }).then(r => { if (r.success) toast(t('started'), 'success'); }); }}>{t("Start")}</button>}
          </div>
        </div>;
      })}
    </div>

    {deployModal && <Modal title={t("Deploy Stack")} onClose={() => setDeployModal(false)}>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4, display: 'block' }}>{t("stackName")}</label>
        <input value={deployName} onChange={e => setDeployName(e.target.value)} placeholder={t("my-stack")} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4, display: 'block' }}>{t("Docker Compose YAML")}</label>
        <textarea value={deployYaml} onChange={e => setDeployYaml(e.target.value)} placeholder="version: '3.8'&#10;services:&#10;  web:&#10;    image: nginx" style={{ fontFamily: 'monospace', fontSize: 12, minHeight: 250, resize: 'vertical' }} />
      </div>
      <button className="btn btn-primary" onClick={doDeploy} disabled={deploying || !deployName || !deployYaml}>
        {deploying ? <><span className="spinner" style={{ width: 14, height: 14 }} /> {t("deploying")}</> : 'Deploy Stack'}
      </button>
    </Modal>}
  </>;
});

// SortHeader — top-level so Containers doesn't recreate it every render.
const SortHeader = React.memo(function SortHeader({ col, children, sortCol, sortAsc, setSortCol, setSortAsc }) {
  return <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => { if (sortCol === col) setSortAsc(!sortAsc); else { setSortCol(col); setSortAsc(true); } }}>
    {children} {sortCol === col ? (sortAsc ? '↑' : '↓') : ''}
  </th>;
});

const stateColor = (s) => {
  s = (s || '').toLowerCase();
  if (s === 'running') return { bg: 'rgba(34,197,94,.15)', color: 'var(--green)', text: 'running' };
  if (s === 'exited') return { bg: 'rgba(239,68,68,.15)', color: 'var(--red)', text: 'exited' };
  if (s === 'paused') return { bg: 'rgba(234,179,8,.15)', color: 'var(--yellow)', text: 'paused' };
  if (s === 'created') return { bg: 'rgba(59,130,246,.15)', color: 'var(--blue)', text: 'created' };
  return { bg: 'rgba(113,113,122,.15)', color: 'var(--muted)', text: s || 'unknown' };
};

// Get stack name from container labels (docker appends it)
const getStack = (c) => {
  const labels = c.Labels || '';
  const m = labels.match(/com\.docker\.stack\.namespace=([^,]+)/);
  return m ? m[1] : '-';
};

// ContainerRow — top-level so React doesn't remount rows on every selection render.
const ContainerRow = React.memo(function ContainerRow({ c, isSelected, toggleSelect, onLogs, onAction }) {
  const id = c.ID || c.Names;
  const sc = stateColor(c.State);
  const status = c.Status || '';
  const stack = getStack(c);
  const networks = c.Networks || '';
  return <tr style={{ background: isSelected ? 'rgba(229,112,0,.05)' : '' }}>
    <td><input type="checkbox" checked={isSelected} onChange={() => toggleSelect(id)} /></td>
    <td>
      <strong style={{ fontSize: 13 }}>{c.Names}</strong>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{(c.ID || '').substring(0, 12)}</div>
    </td>
    <td>
      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color }}>
        {status || sc.text}
      </span>
    </td>
    <td style={{ whiteSpace: 'nowrap' }}>
      <button className="btn btn-sm" title={t("Logs")} onClick={() => onLogs(c.ID, c._host)} style={{ padding: '2px 5px' }}>L</button>{' '}
      <button className="btn btn-sm" title={t("Restart")} onClick={() => onAction(id, 'restart', false, c._host)} style={{ padding: '2px 5px' }}>R</button>{' '}
      {(c.State || '') === 'running'
        ? <button className="btn btn-sm" title={t("Stop")} onClick={() => onAction(id, 'stop', false, c._host)} style={{ padding: '2px 5px' }}>S</button>
        : <button className="btn btn-sm" title={t("Start")} onClick={() => onAction(id, 'start', false, c._host)} style={{ padding: '2px 5px' }}>P</button>
      }
    </td>
    <td>{stack !== '-' ? <span className="badge badge-blue">{stack}</span> : '-'}</td>
    <td style={{ fontSize: 12, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.Image}>{c.Image}</td>
    <td style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{c.CreatedAt || c.RunningFor}</td>
    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{networks || '-'}</td>
    <td><span className="badge badge-muted">{c._node || '-'}</span></td>
  </tr>;
});

// Containers — Portainer-style with multi-select, bulk actions, pagination, state filter
const Containers = React.memo(function Containers({ data, onLogs, onAction, toast }) {
  const [filterInput, setFilterInput] = useState('');
  const [filter, setFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [sortCol, setSortCol] = useState('Names');
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => { setFilter(filterInput); setPage(1); }, 250);
    return () => clearTimeout(id);
  }, [filterInput]);

  const containers = data?.containers || [];

  const { runningCount, stoppedCount, exitedCount } = useMemo(() => {
    let running = 0, stopped = 0, exited = 0;
    for (const c of containers) {
      const s = (c.State || '').toLowerCase();
      if (s === 'running') running++;
      else stopped++;
      if (s === 'exited') exited++;
    }
    return { runningCount: running, stoppedCount: stopped, exitedCount: exited };
  }, [containers]);

  const filtered = useMemo(() => {
    const f = filter.toLowerCase();
    return containers.filter(c => {
      const state = (c.State || '').toLowerCase();
      const matchFilter = !f || (c.Names || '').toLowerCase().includes(f) || (c.Image || '').toLowerCase().includes(f) || (c._node || '').toLowerCase().includes(f);
      const matchState = stateFilter === 'all' || state === stateFilter;
      return matchFilter && matchState;
    }).sort((a, b) => {
      const va = (a[sortCol] || '').toString().toLowerCase();
      const vb = (b[sortCol] || '').toString().toLowerCase();
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [containers, filter, stateFilter, sortCol, sortAsc]);

  const totalPages = useMemo(() => Math.ceil(filtered.length / perPage), [filtered.length, perPage]);
  const paged = useMemo(() => filtered.slice((page - 1) * perPage, page * perPage), [filtered, page, perPage]);

  const toggleSelect = useCallback((id) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; }), []);
  const selectAll = useCallback(() => setSelected(prev => (prev.size === paged.length) ? new Set() : new Set(paged.map(c => c.ID || c.Names))), [paged]);

  const bulkAction = async (action) => {
    if (selected.size === 0) return;
    if (!confirm(t('containers2', { action, n: selected.size }))) return;
    let ok = 0;
    for (const id of selected) {
      const c = containers.find(x => (x.ID || x.Names) === id);
      const r = await api('container-action', { method: 'POST', body: { container_id: id, action, host: c?._host || '' } });
      if (r.success) ok++;
    }
    toast(t('succeeded', { action, ok, n: selected.size }), 'success');
    setSelected(new Set());
    onAction(null, null, true); // signal reload
  };



  return <>
    {/* Top bar with actions */}
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, fontWeight: 600, marginRight: 4 }}>{t("Containers")}</span>
      <input placeholder={t("Search...")} value={filterInput} onChange={e => setFilterInput(e.target.value)} style={{ maxWidth: 200, padding: '4px 8px' }} />
      <div style={{ display: 'flex', gap: 4, borderLeft: '1px solid var(--border)', paddingLeft: 8, marginLeft: 4 }}>
        <button className="btn btn-sm" disabled={selected.size === 0} onClick={() => bulkAction('start')}>{t("Start")}</button>
        <button className="btn btn-sm" disabled={selected.size === 0} onClick={() => bulkAction('stop')}>{t("Stop")}</button>
        <button className="btn btn-sm" disabled={selected.size === 0} onClick={() => bulkAction('kill')}>{t("Kill")}</button>
        <button className="btn btn-sm" disabled={selected.size === 0} onClick={() => bulkAction('restart')}>{t("Restart")}</button>
        <button className="btn btn-sm" disabled={selected.size === 0} onClick={() => bulkAction('pause')}>{t("Pause")}</button>
        <button className="btn btn-sm" disabled={selected.size === 0} onClick={() => bulkAction('unpause')}>{t("Resume")}</button>
        <button className="btn btn-sm btn-danger" disabled={selected.size === 0} onClick={() => bulkAction('remove')}>{t("Remove")}</button>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{runningCount} running / {stoppedCount} stopped</span>
      </div>
    </div>

    {/* State filter tabs */}
    <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
      {[{ id: 'all', label: `All (${containers.length})` }, { id: 'running', label: `Running (${runningCount})` }, { id: 'exited', label: `Stopped (${exitedCount})` }, { id: 'paused', label: 'Paused' }].map(f =>
        <button key={f.id} className={`btn btn-sm ${stateFilter === f.id ? 'btn-primary' : ''}`} onClick={() => { setStateFilter(f.id); setPage(1); }}>{f.label}</button>
      )}
    </div>

    {/* Table */}
    <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
      <table>
        <thead><tr>
          <th style={{ width: 30 }}><input type="checkbox" checked={selected.size === paged.length && paged.length > 0} onChange={selectAll} /></th>
          <SortHeader col="Names" sortCol={sortCol} sortAsc={sortAsc} setSortCol={setSortCol} setSortAsc={setSortAsc}>{t("Name")}</SortHeader>
          <SortHeader col="State" sortCol={sortCol} sortAsc={sortAsc} setSortCol={setSortCol} setSortAsc={setSortAsc}>{t("State")}</SortHeader>
          <th>{t("Quick Actions")}</th>
          <th>{t("Stack")}</th>
          <SortHeader col="Image" sortCol={sortCol} sortAsc={sortAsc} setSortCol={setSortCol} setSortAsc={setSortAsc}>{t("Image")}</SortHeader>
          <SortHeader col="CreatedAt" sortCol={sortCol} sortAsc={sortAsc} setSortCol={setSortCol} setSortAsc={setSortAsc}>{t("Created")}</SortHeader>
          <th>{t("IP Address")}</th>
          <th>{t("Node")}</th>
        </tr></thead>
        <tbody>{paged.map(c => {
          const id = c.ID || c.Names;
          return <ContainerRow key={id} c={c} isSelected={selected.has(id)} toggleSelect={toggleSelect} onLogs={onLogs} onAction={onAction} />;
        })}</tbody>
      </table>
    </div>

    {/* Pagination */}
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t("containers3", { n: filtered.length })}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t("Items per page")}</span>
        <select value={perPage} onChange={e => { setPerPage(parseInt(e.target.value)); setPage(1); }} style={{ width: 60, padding: '2px 4px' }}>
          <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
        </select>
        <div style={{ display: 'flex', gap: 2 }}>
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
            let p;
            if (totalPages <= 5) p = i + 1;
            else if (page <= 3) p = i + 1;
            else if (page >= totalPages - 2) p = totalPages - 4 + i;
            else p = page - 2 + i;
            return <button key={p} className={`btn btn-sm ${page === p ? 'btn-primary' : ''}`} onClick={() => setPage(p)}>{p}</button>;
          })}
          {totalPages > 5 && page < totalPages - 2 && <span style={{ color: 'var(--muted)' }}>...</span>}
          {totalPages > 5 && page < totalPages - 2 && <button className="btn btn-sm" onClick={() => setPage(totalPages)}>{totalPages}</button>}
          <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>›</button>
        </div>
      </div>
    </div>
  </>;
});

// Networks — Portainer style with IPAM details, Stack, multi-node
const Networks = React.memo(function Networks({ data, toast }) {
  const [filterInput, setFilterInput] = useState('');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    const id = setTimeout(() => setFilter(filterInput), 250);
    return () => clearTimeout(id);
  }, [filterInput]);

  const nets = data?.networks || [];
  const filtered = useMemo(() => nets.filter(n => !filter || (n.Name || '').toLowerCase().includes(filter.toLowerCase())), [nets, filter]);
  const toggle = id => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s); };
  const removeSelected = async () => {
    if (!confirm(t('deleteNetworks', { n: selected.size }))) return;
    let ok = 0;
    for (const name of selected) { const r = await api('network-remove', { method: 'POST', body: { network_name: name } }); if (r.success) ok++; }
    toast(t('networksDeleted', { n: ok }), 'success'); setSelected(new Set());
  };

  return <>
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{t("Networks")}</span>
      <input placeholder={t("Search...")} value={filterInput} onChange={e => setFilterInput(e.target.value)} style={{ maxWidth: 200, padding: '4px 8px' }} />
      <button className="btn btn-sm btn-danger" disabled={selected.size === 0} onClick={removeSelected}>{t("Remove")}</button>
    </div>
    <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
      <table>
        <thead><tr><th style={{ width: 30 }}><input type="checkbox" onChange={() => { if (selected.size === filtered.length) setSelected(new Set()); else setSelected(new Set(filtered.map(n => n.Name))); }} checked={selected.size === filtered.length && filtered.length > 0} /></th><th>{t("Name")}</th><th>{t("Stack")}</th><th>{t("Driver")}</th><th>{t("Attachable")}</th><th>{t("IPAM Driver")}</th><th>{t("IPV4 IPAM Subnet")}</th><th>{t("IPV4 IPAM Gateway")}</th><th>{t("Scope")}</th></tr></thead>
        <tbody>{filtered.map((n, i) => <tr key={i}>
          <td><input type="checkbox" checked={selected.has(n.Name)} onChange={() => toggle(n.Name)} /></td>
          <td><strong style={{ color: 'var(--blue)' }}>{n.Name}</strong>{n.System && <span className="badge badge-blue" style={{ marginLeft: 6 }}>{t("System")}</span>}</td>
          <td>{n.Stack ? <span className="badge badge-blue">{n.Stack}</span> : '-'}</td>
          <td>{n.Driver}</td>
          <td>{n.Attachable ? 'true' : 'false'}</td>
          <td>{n.IPAM_Driver || 'default'}</td>
          <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{n.Subnet || '-'}</td>
          <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{n.Gateway || '-'}</td>
          <td>{n.Scope}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>{t("networks2", { n: filtered.length })}</div>
  </>;
});

// Volumes — Portainer style with Stack, Mountpoint, Browse, multi-node
const Volumes = React.memo(function Volumes({ data, toast }) {
  const [filterInput, setFilterInput] = useState('');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const perPage = 10;

  useEffect(() => {
    const id = setTimeout(() => { setFilter(filterInput); setPage(1); }, 250);
    return () => clearTimeout(id);
  }, [filterInput]);

  const vols = data?.volumes || [];
  const filtered = useMemo(() => vols.filter(v => !filter || (v.Name || '').toLowerCase().includes(filter.toLowerCase()) || (v.Stack || '').toLowerCase().includes(filter.toLowerCase())), [vols, filter]);
  const totalPages = useMemo(() => Math.ceil(filtered.length / perPage), [filtered.length, perPage]);
  const paged = useMemo(() => filtered.slice((page - 1) * perPage, page * perPage), [filtered, page, perPage]);
  const toggle = id => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s); };
  const removeSelected = async () => {
    if (!confirm(t('deleteVolumes', { n: selected.size }))) return;
    let ok = 0;
    for (const name of selected) { const v = vols.find(x => x.Name === name); const r = await api('volume-remove', { method: 'POST', body: { volume_name: name, host: v?._host || '' } }); if (r.success) ok++; }
    toast(t('volumesDeleted', { n: ok }), 'success'); setSelected(new Set());
  };

  return <>
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{t("Volumes")}</span>
      <input placeholder={t("Search...")} value={filterInput} onChange={e => setFilterInput(e.target.value)} style={{ maxWidth: 200, padding: '4px 8px' }} />
      <button className="btn btn-sm btn-danger" disabled={selected.size === 0} onClick={removeSelected}>{t("Remove")}</button>
    </div>
    <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
      <table>
        <thead><tr><th style={{ width: 30 }}><input type="checkbox" onChange={() => { if (selected.size === paged.length) setSelected(new Set()); else setSelected(new Set(paged.map(v => v.Name))); }} checked={selected.size === paged.length && paged.length > 0} /></th><th>{t("Name")}</th><th>{t("Stack")}</th><th>{t("Driver")}</th><th>{t("Mount point")}</th><th>{t("Created")}</th><th>{t("Node")}</th></tr></thead>
        <tbody>{paged.map((v, i) => <tr key={i}>
          <td><input type="checkbox" checked={selected.has(v.Name)} onChange={() => toggle(v.Name)} /></td>
          <td><strong style={{ color: 'var(--blue)', fontSize: 13 }}>{v.Name?.length > 35 ? v.Name.substring(0, 35) + '...' : v.Name}</strong></td>
          <td>{v.Stack ? <span className="badge badge-blue">{v.Stack}</span> : '-'}</td>
          <td>{v.Driver}</td>
          <td style={{ fontSize: 12, fontFamily: 'monospace', maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis' }} title={v.Mountpoint}>{v.Mountpoint}</td>
          <td style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{v.CreatedAt?.substring(0, 19) || '-'}</td>
          <td><span className="badge badge-muted">{v._node || '-'}</span></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t("volumes2", { n: filtered.length })}</span>
      {totalPages > 1 && <div style={{ display: 'flex', gap: 2 }}>
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => <button key={i + 1} className={`btn btn-sm ${page === i + 1 ? 'btn-primary' : ''}`} onClick={() => setPage(i + 1)}>{i + 1}</button>)}
        {totalPages > 5 && <><span style={{ color: 'var(--muted)' }}>...</span><button className="btn btn-sm" onClick={() => setPage(totalPages)}>{totalPages}</button></>}
        <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>›</button>
      </div>}
    </div>
  </>;
});

// Images — Portainer style with Pull, multi-node, Host column, Remove
const Images = React.memo(function Images({ data, toast }) {
  const [filterInput, setFilterInput] = useState('');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [pullImage, setPullImage] = useState('');
  const [pullHost, setPullHost] = useState('');
  const [pulling, setPulling] = useState(false);
  const [page, setPage] = useState(1);
  const perPage = 10;

  useEffect(() => {
    const id = setTimeout(() => { setFilter(filterInput); setPage(1); }, 250);
    return () => clearTimeout(id);
  }, [filterInput]);

  const imgs = data?.images || [];
  const filtered = useMemo(() => imgs.filter(img => {
    const f = filter.toLowerCase();
    return !f || (img.Repository || '').toLowerCase().includes(f) || (img.Tag || '').toLowerCase().includes(f) || (img._node || '').toLowerCase().includes(f);
  }), [imgs, filter]);
  const totalPages = useMemo(() => Math.ceil(filtered.length / perPage), [filtered.length, perPage]);
  const paged = useMemo(() => filtered.slice((page - 1) * perPage, page * perPage), [filtered, page, perPage]);
  const toggle = id => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s); };

  // Get unique hosts for pull dropdown
  const hosts = useMemo(() => [...new Set(imgs.map(i => i._node).filter(Boolean))], [imgs]);

  const doPull = async () => {
    if (!pullImage) return;
    setPulling(true);
    const body = { image: pullImage };
    if (pullHost) {
      const img = imgs.find(i => i._node === pullHost);
      if (img) body.host = img._host;
    }
    const r = await api('image-pull', { method: 'POST', body });
    setPulling(false);
    if (r.success) toast(t('imagePulled'), 'success');
    else toast(r.error || 'Error', 'error');
  };

  const removeSelected = async () => {
    if (!confirm(t('deleteImages', { n: selected.size }))) return;
    let ok = 0;
    for (const key of selected) {
      const [id, host] = key.split('|');
      const r = await api('image-remove', { method: 'POST', body: { image_id: id, host } });
      if (r.success) ok++;
    }
    toast(t('imagesDeleted', { n: ok }), 'success'); setSelected(new Set());
  };

  // Check if image is used by running containers
  const isUnused = (img) => (img.Repository || '') === '<none>' || (img.Tag || '') === '<none>';

  return <>
    {/* Pull image section */}
    <div className="card" style={{ marginBottom: 12 }}>
      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t("Pull image")}</h4>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{t("Image")}</label>
          <div style={{ display: 'flex', gap: 0 }}>
            <span style={{ background: 'var(--border)', padding: '6px 10px', borderRadius: '6px 0 0 6px', fontSize: 12, color: 'var(--muted)' }}>{t("docker.io")}</span>
            <input value={pullImage} onChange={e => setPullImage(e.target.value)} placeholder={t("e.g. nginx:latest")} style={{ borderRadius: '0 6px 6px 0', borderLeft: 'none' }} />
          </div>
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{t("Node")}</label>
          <select value={pullHost} onChange={e => setPullHost(e.target.value)} style={{ width: 160 }}>
            <option value="">{t("Any (manager)")}</option>
            {hosts.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={doPull} disabled={pulling || !pullImage}>
          {pulling ? <><span className="spinner" style={{ width: 14, height: 14 }} />{t("Pulling...")}</> : 'Pull the image'}
        </button>
      </div>
    </div>

    {/* Image list */}
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{t("Images")}</span>
      <input placeholder={t("Search...")} value={filterInput} onChange={e => setFilterInput(e.target.value)} style={{ maxWidth: 200, padding: '4px 8px' }} />
      <button className="btn btn-sm btn-danger" disabled={selected.size === 0} onClick={removeSelected}>{t("Remove")}</button>
      <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>{t("imagesOnNodes", { n: imgs.length, h: hosts.length })}</div>
    </div>
    <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
      <table>
        <thead><tr>
          <th style={{ width: 30 }}><input type="checkbox" onChange={() => { if (selected.size === paged.length) setSelected(new Set()); else setSelected(new Set(paged.map(i => `${i.ID}|${i._host}`))); }} checked={selected.size === paged.length && paged.length > 0} /></th>
          <th>{t("Id")}</th><th>{t("Tags")}</th><th>{t("Size")}</th><th>{t("Created")}</th><th>{t("Host")}</th>
        </tr></thead>
        <tbody>{paged.map((img, i) => {
          const key = `${img.ID}|${img._host}`;
          const tag = `${img.Repository}:${img.Tag}`;
          const unused = isUnused(img);
          return <tr key={i}>
            <td><input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} /></td>
            <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--blue)' }}>{(img.ID || '').substring(0, 25)}...</td>
            <td>{tag !== '<none>:<none>' ? tag : '-'} {unused && <span className="badge badge-yellow" style={{ marginLeft: 4 }}>{t("Unused")}</span>}</td>
            <td>{img.Size}</td>
            <td style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{img.CreatedAt?.substring(0, 19) || img.CreatedSince}</td>
            <td><span className="badge badge-muted">{img._node}</span></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t("images2", { n: filtered.length })}</span>
      {totalPages > 1 && <div style={{ display: 'flex', gap: 2 }}>
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => <button key={i + 1} className={`btn btn-sm ${page === i + 1 ? 'btn-primary' : ''}`} onClick={() => setPage(i + 1)}>{i + 1}</button>)}
        {totalPages > 5 && <><span style={{ color: 'var(--muted)' }}>...</span><button className="btn btn-sm" onClick={() => setPage(totalPages)}>{totalPages}</button></>}
        <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>›</button>
      </div>}
    </div>
  </>;
});

// Settings
const Settings = React.memo(function Settings({ onSave, toast }) {
  const [config, setConfig] = useState(null);
  // v2.1.0: edit the full multi-cluster shape. Each cluster = {id,name,hosts:[...]}.
  const [clusters, setClusters] = useState([]);
  const [poll, setPoll] = useState(30);
  const [testing, setTesting] = useState(null);     // `${ci}:${hi}` while testing
  const [testResult, setTestResult] = useState(null); // {key, ...result}

  useEffect(() => {
    api('config').then(d => {
      setConfig(d);
      setClusters(d.clusters || (d.swarm_hosts ? [{ id: 'default', name: 'Swarm', hosts: d.swarm_hosts }] : []));
      setPoll(d.poll_interval || 30);
    });
  }, []);

  const updateCluster = (ci, field, val) => setClusters(cl => cl.map((c, j) => j === ci ? { ...c, [field]: val } : c));
  const removeCluster = ci => setClusters(cl => cl.filter((_, j) => j !== ci));
  const addCluster = () => setClusters(cl => [...cl, { id: '', name: '', hosts: [{ name: '', host: '', user: '', key_file: '', password: '' }] }]);

  const addHost = ci => setClusters(cl => cl.map((c, j) => j === ci ? { ...c, hosts: [...c.hosts, { name: '', host: '', user: '', key_file: '', password: '' }] } : c));
  const removeHost = (ci, hi) => setClusters(cl => cl.map((c, j) => j === ci ? { ...c, hosts: c.hosts.filter((_, k) => k !== hi) } : c));
  const updateHost = (ci, hi, field, val) => setClusters(cl => cl.map((c, j) => j === ci ? { ...c, hosts: c.hosts.map((h, k) => k === hi ? { ...h, [field]: val } : h) } : c));

  const save = async () => {
    // Validate cluster ids: non-empty + unique.
    const ids = clusters.map(c => (c.id || '').trim());
    if (ids.some(id => !id)) { toast(t('eachClusterNeedsAnId'), 'error'); return; }
    if (new Set(ids).size !== ids.length) { toast(t('clusterIdsMustBeUnique'), 'error'); return; }
    const r = await api('config/save', { method: 'POST', body: { clusters, poll_interval: poll } });
    if (r.success) { toast(t('configurationSaved'), 'success'); onSave && onSave(); }
    else toast(r.error || t('error2'), 'error');
  };

  const testConn = async (ci, hi) => {
    const key = `${ci}:${hi}`;
    setTesting(key); setTestResult(null);
    const h = clusters[ci].hosts[hi];
    const pwd = h.password === '***' ? '' : h.password;
    if (!pwd && !h.key_file) { toast(t('enterPasswordOrKeyFileTo'), 'error'); setTesting(null); return; }
    const r = await api('test-connection', { method: 'POST', body: { host: h.host, user: h.user, key_file: h.key_file || '', password: pwd } });
    setTestResult({ key, ...r }); setTesting(null);
  };

  if (!config) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>;

  return <div className="card">
    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{t("dockerManagerConfiguration")}</h3>

    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4, display: 'block' }}>{t("pollingIntervalSeconds")}</label>
      <input type="number" value={poll} onChange={e => setPoll(parseInt(e.target.value) || 30)} min={10} max={300} style={{ maxWidth: 120 }} />
    </div>

    <h4 style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>{t("clusters")}</h4>
    {clusters.map((c, ci) => <div key={ci} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 10, alignItems: 'end' }}>
        <div><label style={{ fontSize: 11, color: 'var(--muted)' }}>{t("idStableNoSpaces")}</label><input value={c.id} onChange={e => updateCluster(ci, 'id', e.target.value)} placeholder={t("prod")} /></div>
        <div><label style={{ fontSize: 11, color: 'var(--muted)' }}>{t("name")}</label><input value={c.name} onChange={e => updateCluster(ci, 'name', e.target.value)} placeholder={t("eGProduction")} /></div>
        <button className="btn btn-sm btn-danger" onClick={() => removeCluster(ci)}>{t("deleteCluster")}</button>
      </div>

      {c.hosts.map((h, hi) => <div key={hi} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 8, background: 'rgba(255,255,255,.02)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div><label style={{ fontSize: 11, color: 'var(--muted)' }}>{t("name")}</label><input value={h.name} onChange={e => updateHost(ci, hi, 'name', e.target.value)} placeholder={t("eGSwarmManager1")} /></div>
          <div><label style={{ fontSize: 11, color: 'var(--muted)' }}>{t("hostIp")}</label><input value={h.host} onChange={e => updateHost(ci, hi, 'host', e.target.value)} placeholder={t("eG192168110")} /></div>
          <div><label style={{ fontSize: 11, color: 'var(--muted)' }}>{t("user")}</label><input value={h.user} onChange={e => updateHost(ci, hi, 'user', e.target.value)} placeholder={t("eGSshUser")} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div><label style={{ fontSize: 11, color: 'var(--muted)' }}>{t("keyFileSshKeyPath")}</label><input value={h.key_file || ''} onChange={e => updateHost(ci, hi, 'key_file', e.target.value)} placeholder="/opt/ProxmoxVEx/plugins/docker_swarm/.ssh/id_ed25519" /></div>
          <div><label style={{ fontSize: 11, color: 'var(--muted)' }}>{t("passwordIfNotUsingAKey")}</label><input type="password" value={h.password || ''} onChange={e => updateHost(ci, hi, 'password', e.target.value)} /></div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={() => testConn(ci, hi)} disabled={testing === `${ci}:${hi}`}>
            {testing === `${ci}:${hi}` ? <><span className="spinner" style={{ width: 14, height: 14 }} /> {t("testing")}</> : t('testConnection')}
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => removeHost(ci, hi)}>{t("deleteHost")}</button>
          {testResult && testResult.key === `${ci}:${hi}` && <span style={{ fontSize: 12, color: testResult.success ? 'var(--green)' : 'var(--red)', alignSelf: 'center' }}>
            {testResult.success ? t("okSwarmActiveNodesManagers", { nodes: testResult.nodes, managers: testResult.managers }) : testResult.error}
          </span>}
        </div>
      </div>)}

      <button className="btn btn-sm" onClick={() => addHost(ci)}>{t("addHost")}</button>
    </div>)}

    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
      <button className="btn" onClick={addCluster}>{t("addCluster")}</button>
      <button className="btn btn-primary" onClick={save}>{t("saveConfiguration")}</button>
    </div>

    <DiskAutoPruneSettings toast={toast} />
  </div>;
});

// ============== LOAD BALANCE ==============

function NodeBalanceCard({ node: n, maxTasks, rebalancing, onRebalance, history }) {
  const [expanded, setExpanded] = useState(false);
  const cpuColor = n.cpu_percent > 80 ? 'var(--red)' : n.cpu_percent > 50 ? 'var(--yellow)' : 'var(--green)';
  const memColor = n.mem_percent > 80 ? 'var(--red)' : n.mem_percent > 50 ? 'var(--yellow)' : 'var(--green)';
  const taskBarPct = (n.tasks_running / maxTasks) * 100;

  // history = {cpu_percent: [{ts,value}], mem_percent: [...], tasks_running: [...]} for this node
  const cpuHistory = history?.cpu_percent || [];
  const memHistory = history?.mem_percent || [];
  const taskHistory = history?.tasks_running || [];

  return <div className="card" style={{ padding: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{n.name}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{n.host} {n.node_id && `(${n.node_id})`}</div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)' }}>{n.tasks_running}</div>
    </div>

    {/* Tasks bar */}
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
        <span>{t("Tasks")}</span><span>{n.tasks_running} / {maxTasks}</span>
      </div>
      <ProgressBar percent={taskBarPct} color="#3b82f6" />
    </div>

    {/* CPU */}
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
        <span>CPU ({n.cpu_count} cores)</span><span style={{ color: cpuColor, fontWeight: 600 }}>{n.cpu_percent}%</span>
      </div>
      <ProgressBar percent={n.cpu_percent} color={cpuColor} />
      {cpuHistory.length >= 2 && <div style={{ marginTop: 4 }} title={t("cpuLast24h")}>
        <Sparkline points={cpuHistory} width={280} height={28} color={cpuColor} maxValue={100} />
      </div>}
    </div>

    {/* RAM */}
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
        <span>{t("RAM")}</span><span style={{ color: memColor, fontWeight: 600 }}>{n.mem_total ? `${fmtBytes(n.mem_used)} / ${fmtBytes(n.mem_total)}` : '-'} ({n.mem_percent}%)</span>
      </div>
      <ProgressBar percent={n.mem_percent} color={memColor} />
      {memHistory.length >= 2 && <div style={{ marginTop: 4 }} title={t("ramLast24h")}>
        <Sparkline points={memHistory} width={280} height={28} color={memColor} maxValue={100} />
      </div>}
    </div>

    {/* Services list (collapsible) */}
    {n.services && n.services.length > 0 && <>
      <div onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer', fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: expanded ? 8 : 0 }}>
        <span style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-block' }}>&#9654;</span>
        {t("services4", { n: n.services.length })}
      </div>
      {expanded && <div style={{ maxHeight: 200, overflow: 'auto' }}>
        {n.services.map((svc, si) => <div key={si} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
          <span style={{ fontFamily: 'monospace' }}>{svc}</span>
          <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 8px' }}
            disabled={rebalancing === svc} onClick={() => onRebalance(svc)}>
            {rebalancing === svc ? '...' : t('rebalance')}
          </button>
        </div>)}
      </div>}
    </>}
  </div>;
}

const LoadBalance = React.memo(function LoadBalance({ data, toast }) {
  const [rebalancing, setRebalancing] = useState(null);
  const [historyByHost, setHistoryByHost] = useState({});;
  const [insights, setInsights] = useState(null);
  const [rebalanceAllModal, setRebalanceAllModal] = useState(null); // dry-run plan
  const [rebalancingAll, setRebalancingAll] = useState(false);
  const [rebalanceJob, setRebalanceJob] = useState(null);  // {job_id, status, total, completed, ...}
  const rebalancePollRef = useRef(null);

  // Fetch balance insights (why it isn't balancing + which services can move)
  const refreshInsights = useCallback(async () => {
    const r = await api('balance/insights');
    if (!r.error) setInsights(r);
  }, []);
  useEffect(() => { if (!data || data.error) return; refreshInsights(); }, [refreshInsights, data?.updated_at]);

  // Fetch 24h history for each node's CPU/RAM/tasks. Done once per data-load
  // (not per render) and merged into a {host: {metric: [points]}} map.
  useEffect(() => {
    if (!data?.nodes) return;
    let cancelled = false;
    (async () => {
      const result = {};
      for (const n of data.nodes) {
        if (!n.host || n.error) continue;
        const [cpu, mem, tasks] = await Promise.all([
          api(`metrics/history?host=${encodeURIComponent(n.host)}&metric=cpu_percent&duration=24h`),
          api(`metrics/history?host=${encodeURIComponent(n.host)}&metric=mem_percent&duration=24h`),
          api(`metrics/history?host=${encodeURIComponent(n.host)}&metric=tasks_running&duration=24h`),
        ]);
        if (cancelled) return;
        result[n.host] = {
          cpu_percent: cpu?.points || [],
          mem_percent: mem?.points || [],
          tasks_running: tasks?.points || [],
        };
      }
      if (!cancelled) setHistoryByHost(result);
    })();
    return () => { cancelled = true; };
  }, [data?.updated_at]);

  if (!data) return <div className="card" style={{ padding: 20, color: 'var(--muted)' }}>{t("noBalanceData")}</div>;
  if (data.error) return <div className="card" style={{ padding: 20, color: 'var(--red)' }}>{data.error}</div>;

  const { nodes, total_tasks, balance_score, recommendation } = data;
  const scoreColor = balance_score >= 80 ? 'var(--green)' : balance_score >= 50 ? 'var(--yellow)' : 'var(--red)';
  const maxTasks = Math.max(...nodes.map(n => n.tasks_running), 1);

  const doRebalance = async (svcName) => {
    if (!confirm(t('rebalanceThisWillForceARe', { svc: svcName }))) return;
    setRebalancing(svcName);
    try {
      const r = await api('rebalance-service', { method: 'POST', body: { service_name: svcName } });
      if (r.success) toast(t('rebalancing', { svc: svcName }), 'success');
      else toast(r.error || 'Error', 'error');
    } catch (e) { toast(t('connectionError'), 'error'); }
    setRebalancing(null);
  };

  // Rebalance-all flow: first call returns dry-run plan, second call executes
  const doRebalanceAllDryRun = async () => {
    const r = await api('balance/rebalance-all', { method: 'POST', body: { dry_run: true, delay_sec: 5 } });
    if (r._http === 403) { toast(t('requiresAdmin'), 'error'); return; }
    if (r.error) { toast(r.error, 'error'); return; }
    setRebalanceAllModal(r);
  };

  // v1.14.1: backend now spawns a daemon thread and returns {job_id} immediately.
  // We poll /balance/rebalance-status every 3s to render live progress.
  const doRebalanceAllConfirm = async () => {
    if (!rebalanceAllModal) return;
    setRebalanceAllModal(null);
    setRebalancingAll(true);
    try {
      const r = await api('balance/rebalance-all', { method: 'POST', body: { dry_run: false, delay_sec: 5 } });
      if (r.error) { toast(r.error, 'error'); setRebalancingAll(false); return; }
      if (!r.started || !r.job_id) { toast(r.reason || t('couldNotStart'), 'error'); setRebalancingAll(false); return; }
      // Seed the live job state, kick off polling
      setRebalanceJob({
        job_id: r.job_id, status: 'running', total: r.total, completed: 0,
        failed: 0, current_service: null, current_index: 0, results: [],
        elapsed_sec: 0, eta_sec: null, progress_pct: 0
      });
      toast(t('rebalanceStartedServices', { n: r.total }), 'success');
      const poll = async () => {
        const s = await api(`balance/rebalance-status?job_id=${encodeURIComponent(r.job_id)}`);
        if (s.error) return;
        setRebalanceJob(s);
        if (s.status === 'running') {
          rebalancePollRef.current = setTimeout(poll, 3000);
        } else {
          setRebalancingAll(false);
          refreshInsights();
          const ok = s.failed === 0;
          toast(t('rebalanceFail', { state: ok ? t('complete') : t('withErrors'), completed: s.completed, total: s.total, failed: s.failed }), ok ? 'success' : 'error');
        }
      };
      poll();
    } catch (e) { toast(t('error', { msg: (e.message || e) }), 'error'); setRebalancingAll(false); }
  };

  // Cleanup polling on unmount
  useEffect(() => () => { if (rebalancePollRef.current) clearTimeout(rebalancePollRef.current); }, []);

  // On mount, check if there's already a running job (e.g. user reopened the page)
  useEffect(() => {
    (async () => {
      const r = await api('balance/rebalance-status');
      if (r?.jobs?.length) {
        const running = r.jobs.find(j => j.status === 'running');
        if (running) {
          setRebalancingAll(true);
          // Hydrate then start polling
          const poll = async () => {
            const s = await api(`balance/rebalance-status?job_id=${encodeURIComponent(running.job_id)}`);
            if (s.error) return;
            setRebalanceJob(s);
            if (s.status === 'running') {
              rebalancePollRef.current = setTimeout(poll, 3000);
            } else {
              setRebalancingAll(false);
              refreshInsights();
            }
          };
          poll();
        }
      }
    })();
  }, []);

  return <div>
    {/* Score + Summary */}
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, marginBottom: 16 }}>
      <div className="card" style={{ padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 48, fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{balance_score}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{t("Balance Score")}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{t("tasksOnNodes", { tasks: total_tasks, nodes: nodes.length })}</div>
      </div>
      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{t("taskDistribution")}</div>
        {/* Stacked bar */}
        <div style={{ display: 'flex', height: 32, borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
          {nodes.map((n, i) => {
            const pct = total_tasks > 0 ? (n.tasks_running / total_tasks) * 100 : 0;
            const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
            return <div key={i} title={`${n.name}: ${n.tasks_running} tasks (${pct.toFixed(0)}%)`}
              style={{ width: `${pct}%`, background: colors[i % colors.length], minWidth: pct > 0 ? 2 : 0, transition: 'width .3s' }} />;
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {nodes.map((n, i) => {
            const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
            const pct = total_tasks > 0 ? ((n.tasks_running / total_tasks) * 100).toFixed(0) : 0;
            return <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: colors[i % colors.length], display: 'inline-block' }} />
              {n.name}: {n.tasks_running} ({pct}%)
            </div>;
          })}
        </div>
        {recommendation && <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 6, fontSize: 12, color: 'var(--yellow)' }}>
          {recommendation}
        </div>}
      </div>
    </div>

    {/* Diagnóstico de balance — porqué no balancea + acción one-click */}
    {/* Live progress card — visible whenever there's a running or recently-finished job */}
    {rebalanceJob && <div className="card" style={{ padding: 16, marginBottom: 16, borderColor: rebalanceJob.status === 'running' ? 'var(--accent)' : rebalanceJob.failed > 0 ? 'var(--red)' : 'var(--green)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            {rebalanceJob.status === 'running'
              ? <><span className="spinner" style={{ width: 14, height: 14 }} /> {t("rebalanceInProgress")}</>
              : rebalanceJob.failed > 0 ? t('rebalanceFinishedWithErrors')
                : t('rebalanceCompleted')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', marginTop: 2 }}>{t("job")}<strong>{rebalanceJob.job_id}</strong> · started by {rebalanceJob.started_by || '?'}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 12 }}>
          <div><strong style={{ fontSize: 18 }}>{rebalanceJob.completed}/{rebalanceJob.total}</strong> {rebalanceJob.failed > 0 && <span style={{ color: 'var(--red)' }}>· {rebalanceJob.failed} fail</span>}</div>
          <div style={{ color: 'var(--muted)', fontSize: 11 }}>
            {rebalanceJob.status === 'running'
              ? `${rebalanceJob.progress_pct || 0}% · elapsed ${Math.floor((rebalanceJob.elapsed_sec || 0) / 60)}m${(rebalanceJob.elapsed_sec || 0) % 60}s${rebalanceJob.eta_sec ? ` · ETA ${Math.floor(rebalanceJob.eta_sec / 60)}m${rebalanceJob.eta_sec % 60}s` : ''}`
              : `total ${Math.floor((rebalanceJob.elapsed_sec || 0) / 60)}m${(rebalanceJob.elapsed_sec || 0) % 60}s`}
          </div>
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginBottom: 10 }}>
        <div style={{
          width: `${rebalanceJob.progress_pct || 0}%`,
          height: '100%',
          background: rebalanceJob.failed > 0 ? 'var(--red)' : rebalanceJob.status === 'running' ? 'var(--accent)' : 'var(--green)',
          transition: 'width .6s ease',
        }} />
      </div>
      {rebalanceJob.current_service && <div style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 8, fontFamily: 'monospace' }}>
        {t("now")}<strong>{rebalanceJob.current_service}</strong> ({rebalanceJob.current_index}/{rebalanceJob.total})
      </div>}
      {/* Last 6 results */}
      {(rebalanceJob.results || []).slice(-6).reverse().map((r, i) => <div key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: r.success ? 'var(--green)' : 'var(--red)', marginBottom: 2 }}>
        {r.success ? '✓' : '✗'} {r.service} {!r.success && r.error && <span style={{ color: 'var(--muted)' }}>— {r.error}</span>}
      </div>)}
      {rebalanceJob.status !== 'running' && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setRebalanceJob(null)}>{t("hide")}</button>}
    </div>}

    {insights && !insights.error && <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t("balanceDiagnostics")}</div>
          <div style={{ fontSize: 13, color: 'var(--text)' }}>{insights.verdict}</div>
        </div>
        <button className="btn btn-primary"
          disabled={rebalancingAll || !insights.totals?.eligible}
          onClick={doRebalanceAllDryRun}>
          {rebalancingAll ? <span><span className="spinner" style={{ width: 12, height: 12, verticalAlign: 'middle', marginRight: 4 }} /> {t("rebalancing2")}</span>
            : t('automaticRebalance', { n: insights.totals?.eligible || 0 })}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, fontSize: 12 }}>
        <div style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
          <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>{t("Imbalance")}</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: insights.imbalance_pct < 10 ? 'var(--green)' : insights.imbalance_pct < 25 ? 'var(--yellow)' : 'var(--red)' }}>
            {insights.imbalance_pct}%
          </div>
        </div>
        {insights.hot_node && <div style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
          <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>{t("mostLoaded")}</div>
          <div style={{ fontWeight: 600 }}>{insights.hot_node.name}</div>
          <div style={{ color: 'var(--muted)', fontSize: 11 }}>{t("tasks", { n: insights.hot_node.tasks })}</div>
        </div>}
        {insights.cold_node && <div style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
          <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>{t("leastLoaded")}</div>
          <div style={{ fontWeight: 600 }}>{insights.cold_node.name}</div>
          <div style={{ color: 'var(--muted)', fontSize: 11 }}>{t("tasks", { n: insights.cold_node.tasks })}</div>
        </div>}
        <div style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
          <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>{t("eligible")}</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--accent)' }}>{insights.totals?.eligible || 0}</div>
          <div style={{ color: 'var(--muted)', fontSize: 10 }}>{t("replicas1NoPin")}</div>
        </div>
        <div style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
          <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>{t("Pinned")}</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--muted)' }}>{insights.totals?.pinned || 0}</div>
          <div style={{ color: 'var(--muted)', fontSize: 10 }}>{t("cannotBeMoved")}</div>
        </div>
        <div style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
          <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>{t("Singletons")}</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--muted)' }}>{insights.totals?.singletons || 0}</div>
          <div style={{ color: 'var(--muted)', fontSize: 10 }}>{t("replicas1")}</div>
        </div>
      </div>
    </div>}

    {/* Confirm modal for rebalance-all */}
    {rebalanceAllModal && <div className="modal-overlay" onClick={() => setRebalanceAllModal(null)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{t("confirmAutomaticRebalance")}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          {t("youAreAboutToForceUpdate", { count: rebalanceAllModal.count, delay: rebalanceAllModal.delay_sec })}
        </div>
        <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
          <div style={{ color: 'var(--muted)', marginBottom: 4 }}>{t("skipped")}</div>
          <div>{t("withNodeIdHostnameConstraintCannot", { n: rebalanceAllModal.pinned_skipped })}</div>
          <div>{t("withReplicas1NothingToDistribute", { n: rebalanceAllModal.singletons_skipped })}</div>
        </div>
        <div style={{
          maxHeight: 200, overflow: 'auto', padding: '6px 10px', background: '#000', border: '1px solid var(--border)',
          borderRadius: 6, marginBottom: 12, fontFamily: 'monospace', fontSize: 11, color: '#0f0'
        }}>
          {(rebalanceAllModal.will_touch || []).map(s => <div key={s}>$ docker service update --force {s}</div>)}
        </div>
        <div style={{
          padding: '6px 10px', background: 'rgba(234,179,8,.1)', border: '1px solid rgba(234,179,8,.3)',
          borderRadius: 6, fontSize: 11, color: 'var(--yellow)', marginBottom: 16
        }}>
          {t("estimatedTotalTimeMinEachService", { min: Math.ceil((rebalanceAllModal.count * rebalanceAllModal.delay_sec) / 60) })}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => setRebalanceAllModal(null)}>{t("cancel")}</button>
          <button className="btn btn-primary" onClick={doRebalanceAllConfirm}>{t("runRebalance")}</button>
        </div>
      </div>
    </div>}

    {/* Node Cards */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
      {nodes.map((n, i) => <NodeBalanceCard key={i} node={n} maxTasks={maxTasks}
        rebalancing={rebalancing} onRebalance={doRebalance} history={historyByHost[n.host]} />)}
    </div>
  </div>;
});

// ============== TRENDS ==============

const Trends = React.memo(function Trends({ toast, engineMode }) {
  const [duration, setDuration] = useState('24h');
  const [trends, setTrends] = useState(null);
  const [historyByHost, setHistoryByHost] = useState({});;
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (engineMode !== 'swarm') return;
    setLoading(true);
    try {
      const t = await api(`metrics/trends?duration=${duration}`);
      setTrends(t);
      if (t?.nodes) {
        const result = {};
        for (const n of t.nodes) {
          if (!n.host) continue;
          const [cpu, mem, tasks] = await Promise.all([
            api(`metrics/history?host=${encodeURIComponent(n.host)}&metric=cpu_percent&duration=${duration}`),
            api(`metrics/history?host=${encodeURIComponent(n.host)}&metric=mem_percent&duration=${duration}`),
            api(`metrics/history?host=${encodeURIComponent(n.host)}&metric=tasks_running&duration=${duration}`),
          ]);
          result[n.host] = {
            cpu_percent: cpu?.points || [],
            mem_percent: mem?.points || [],
            tasks_running: tasks?.points || [],
          };
        }
        setHistoryByHost(result);
      }
    } catch (e) { toast(t('errorLoadingTrends'), 'error'); }
    setLoading(false);
  }, [duration, toast, engineMode]);

  useEffect(() => { reload(); }, [reload]);

  if (!trends) return <div className="card" style={{ padding: 20, color: 'var(--muted)' }}>
    {loading ? t('loading') : t('noData2')}
  </div>;

  const totalSamples = (trends.nodes || []).reduce((sum, n) => sum + (n.samples || 0), 0);
  const oldestTs = Math.min(...(trends.nodes || []).map(n => n.first_ts || Infinity));
  const oldestStr = isFinite(oldestTs) ? new Date(oldestTs * 1000).toLocaleString() : '-';

  return <div>
    {/* Duration toggle + summary */}
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
      {['1h', '6h', '24h', '7d', '30d'].map(d => <button key={d}
        className={`btn btn-sm ${duration === d ? 'btn-primary' : ''}`}
        onClick={() => setDuration(d)}>{d}</button>)}
      <button className="btn btn-sm" onClick={reload} disabled={loading}>{loading ? '...' : 'Refresh'}</button>
      <div style={{ flex: 1 }} />
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
        {t("samplesOldest", { n: totalSamples.toLocaleString(), old: oldestStr })}
      </div>
    </div>

    {trends.nodes?.length === 0 && <div className="card" style={{ padding: 20, color: 'var(--muted)', textAlign: 'center' }}>
      {t("noSamplesAccumulatedForThisWindow")}
    </div>}

    {/* One large card per node */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
      {(trends.nodes || []).map(n => {
        const h = historyByHost[n.host] || {};
        const cpuColor = (n.cpu.current > 80) ? 'var(--red)' : (n.cpu.current > 50) ? 'var(--yellow)' : 'var(--green)';
        const memColor = (n.mem.current > 80) ? 'var(--red)' : (n.mem.current > 50) ? 'var(--yellow)' : 'var(--green)';
        return <div key={n.host} className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{n.hostname || n.host}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{n.host} · {n.samples} samples</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <TrendPanel label={t("CPU")} unit="%" current={n.cpu.current} avg={n.cpu.avg} max={n.cpu.max}
              color={cpuColor} points={h.cpu_percent} maxValue={100} />
            <TrendPanel label={t("RAM")} unit="%" current={n.mem.current} avg={n.mem.avg} max={n.mem.max}
              color={memColor} points={h.mem_percent} maxValue={100} />
            <TrendPanel label={t("Tasks")} unit="" current={n.tasks.current} avg={n.tasks.avg} max={n.tasks.max}
              color="#3b82f6" points={h.tasks_running} maxValue={null} />
          </div>
        </div>;
      })}
    </div>
  </div>;
});

function TrendPanel({ label, unit, current, avg, max, color, points, maxValue }) {
  return <div style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'rgba(255,255,255,.02)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 700, color }}>{(current ?? 0).toFixed?.(1) ?? current}{unit}</span>
    </div>
    <div style={{ marginBottom: 6 }}>
      <Sparkline points={points || []} width={280} height={48} color={color} maxValue={maxValue} />
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)' }}>
      <span>{t("avg:")}<strong style={{ color: 'var(--text)' }}>{(avg ?? 0).toFixed?.(1) ?? avg}{unit}</strong></span>
      <span>{t("max:")}<strong style={{ color: 'var(--text)' }}>{(max ?? 0).toFixed?.(1) ?? max}{unit}</strong></span>
    </div>
  </div>;
}


// ============== AUDIT ==============

const GRADE_COLOR = {
  A: '#22c55e',
  B: '#3b82f6',
  C: '#eab308',
  D: '#f97316',
  F: '#ef4444',
};

const SEV_COLOR = {
  P0: 'var(--red)',
  P1: '#f97316',
  P2: 'var(--yellow)',
  P3: 'var(--blue)',
};

const STATUS_BADGE = {
  pass: { color: 'var(--green)', bg: 'rgba(34,197,94,.15)', label: 'OK' },
  warn: { color: 'var(--yellow)', bg: 'rgba(234,179,8,.15)', label: t('warning') },
  fail: { color: 'var(--red)', bg: 'rgba(239,68,68,.15)', label: t('fail') },
  skip: { color: 'var(--muted)', bg: 'rgba(113,113,122,.15)', label: 'N/A' },
};

function GradeBadge({ grade, size = 'md' }) {
  const s = size === 'lg' ? { fontSize: 64, w: 84, h: 84 } : size === 'sm' ? { fontSize: 13, w: 28, h: 24 } : { fontSize: 22, w: 44, h: 36 };
  const color = GRADE_COLOR[grade] || 'var(--muted)';
  return <span style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: s.w, height: s.h, borderRadius: 8, fontWeight: 800, fontSize: s.fontSize,
    background: color + '22', color: color, border: `1px solid ${color}66`,
  }}>{grade}</span>;
}

// Set of check_ids whose fix the backend can auto-apply via /policy/apply.
// Mirror of POLICY_APPLIERS keys in __init__.py — kept in sync manually.
// If they ever drift, the apply endpoint returns 400 with the auth list.
const AUTO_FIXABLE_CHECKS = new Set([
  'anti_affinity',
  'restart_policy',
  'update_rollback',
  'update_parallelism',
]);

const Audit = React.memo(function Audit({ data, onRefresh, toast }) {
  const [expanded, setExpanded] = useState(null);  // service_id of expanded row
  const [filter, setFilter] = useState('all');     // all | non-a | f-only
  const [stackFilterInput, setStackFilterInput] = useState('');
  const [stackFilter, setStackFilter] = useState('');
  const [applying, setApplying] = useState(null);  // {service, check_id} being applied
  const [applyModal, setApplyModal] = useState(null);  // dry-run result + confirm dialog

  // Debounce stack name search so typing doesn't re-filter on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setStackFilter(stackFilterInput), 250);
    return () => clearTimeout(id);
  }, [stackFilterInput]);

  if (!data) return <div className="card" style={{ padding: 20, color: 'var(--muted)' }}>{t("loadingAudit")}</div>;
  if (data.error) return <div className="card" style={{ padding: 20, color: 'var(--red)' }}>{data.error}</div>;

  const { cluster_grade, avg_rank, healthy_nodes, total_nodes, service_count, grade_distribution, worst_offenders, audits } = data;

  const visible = useMemo(() => {
    let v = audits || [];
    if (filter === 'non-a') v = v.filter(a => a.grade !== 'A');
    if (filter === 'f-only') v = v.filter(a => a.grade === 'F');
    if (stackFilter) v = v.filter(a => (a.stack || '').toLowerCase().includes(stackFilter.toLowerCase()));
    // Sort worst-first then by name
    return [...v].sort((x, y) => {
      const r = (GRADE_COLOR[x.grade] ? ['F', 'D', 'C', 'B', 'A'].indexOf(x.grade) : 99) -
        (GRADE_COLOR[y.grade] ? ['F', 'D', 'C', 'B', 'A'].indexOf(y.grade) : 99);
      if (r !== 0) return r;
      return (x.service_name || '').localeCompare(y.service_name || '');
    });
  }, [audits, filter, stackFilter]);

  const totalP0 = useMemo(() => audits.reduce((sum, a) => sum + (a.summary?.issues_by_severity?.P0 || 0), 0), [audits]);
  const totalP1 = useMemo(() => audits.reduce((sum, a) => sum + (a.summary?.issues_by_severity?.P1 || 0), 0), [audits]);
  const nonACount = useMemo(() => audits.filter(a => a.grade !== 'A').length, [audits]);
  const fCount = useMemo(() => audits.filter(a => a.grade === 'F').length, [audits]);

  // Two-step apply: dry-run shows the exact docker command in a modal, user confirms,
  // we POST again with confirm:true. Backend re-validates the check still fails.
  const doApplyDryRun = useCallback(async (service, check_id) => {
    setApplying({ service, check_id });
    try {
      const r = await api('policy/apply', { method: 'POST', body: { service_name: service, check_id, confirm: false } });
      if (r._http === 403) { toast(t('requiresAdminToApplyFixes'), 'error'); setApplying(null); return; }
      if (r.error) { toast(r.error, 'error'); setApplying(null); return; }
      if (!r.applicable) { toast(t('notApplicable', { reason: r.reason }), 'info'); setApplying(null); onRefresh(); return; }
      setApplyModal({ service, check_id, command: r.command, description: r.description, reason: r.reason });
    } catch (e) { toast(t('error', { msg: (e.message || e) }), 'error'); }
    setApplying(null);
  }, [toast, onRefresh]);

  const doApplyConfirm = useCallback(async () => {
    if (!applyModal) return;
    const { service, check_id } = applyModal;
    setApplying({ service, check_id });
    setApplyModal(null);
    try {
      const r = await api('policy/apply', { method: 'POST', body: { service_name: service, check_id, confirm: true } });
      if (r.error) toast(r.error, 'error');
      else if (r.applied) { toast(t('fixAppliedTo', { service }), 'success'); onRefresh(); }
      else toast(t('failedRc', { rc: r.rc, detail: r.error || r.output || 'unknown' }), 'error');
    } catch (e) { toast(t('error', { msg: (e.message || e) }), 'error'); }
    setApplying(null);
  }, [applyModal, toast, onRefresh]);

  return <div>
    {/* Top: cluster grade + summary */}
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, marginBottom: 16 }}>
      <div className="card" style={{ padding: 20, textAlign: 'center' }}>
        <GradeBadge grade={cluster_grade} size="lg" />
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{t("clusterGrade")}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{t("average4", { avg: avg_rank?.toFixed?.(2) ?? avg_rank })}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{t("servicesHealthyNodes", { n: service_count, h: healthy_nodes, t: total_nodes })}</div>
      </div>
      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{t("distribution")}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {['A', 'B', 'C', 'D', 'F'].map(g => {
            const count = grade_distribution?.[g] || 0;
            const pct = service_count > 0 ? Math.round((count / service_count) * 100) : 0;
            return <div key={g} style={{
              flex: '1 1 0', minWidth: 80, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6,
              borderLeft: `3px solid ${GRADE_COLOR[g]}`, background: 'rgba(255,255,255,.02)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <GradeBadge grade={g} size="sm" />
                <span style={{ fontSize: 18, fontWeight: 700 }}>{count}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{t("ofTotal", { pct })}</div>
            </div>;
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)' }}>
          <span>{t("p0IssuesCritical", { n: totalP0 })}</span>
          <span>{t("p1IssuesImportant", { n: totalP1 })}</span>
        </div>
      </div>
    </div>

    {worst_offenders && worst_offenders.length > 0 && <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t("topWithWorstGrade", { n: worst_offenders.length })}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {worst_offenders.map((w, i) => <button key={i}
          onClick={() => { setExpanded(w.service_name); setFilter('all'); document.getElementById('audit-row-' + w.service_name)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
          className="btn btn-sm" style={{ borderColor: GRADE_COLOR[w.grade] + '66' }}>
          <GradeBadge grade={w.grade} size="sm" />
          {w.service_name}
          {w.p0_issues > 0 && <span style={{ color: 'var(--red)', fontWeight: 700 }}> P0×{w.p0_issues}</span>}
          {w.p1_issues > 0 && <span style={{ color: '#f97316' }}> P1×{w.p1_issues}</span>}
        </button>)}
      </div>
    </div>}

    {/* Filters */}
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <input placeholder={t("filterByStack")} value={stackFilterInput}
        onChange={e => setStackFilterInput(e.target.value)} style={{ maxWidth: 240 }} />
      <button className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : ''}`} onClick={() => setFilter('all')}>{t("all", { n: audits.length })}</button>
      <button className={`btn btn-sm ${filter === 'non-a' ? 'btn-primary' : ''}`} onClick={() => setFilter('non-a')}>{t("withIssues", { n: nonACount })}</button>
      <button className={`btn btn-sm ${filter === 'f-only' ? 'btn-primary' : ''}`} onClick={() => setFilter('f-only')}>{t("onlyF", { n: fCount })}</button>
      <button className="btn btn-sm" onClick={onRefresh}>{t("Refresh")}</button>
    </div>

    {/* Confirmation modal for apply */}
    {applyModal && <div className="modal-overlay" onClick={() => setApplyModal(null)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{t("confirmAutomaticFix")}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          {t("youAreAboutToRun")} <code>{t("docker service update")}</code> {t("on")} <strong style={{ color: 'var(--accent)' }}>{applyModal.service}</strong>{t("swarmWillDoARollingUpdate")}
        </div>
        <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>{t("action")}</div>
          <div style={{ fontSize: 13 }}>{applyModal.description}</div>
        </div>
        <div style={{
          padding: '8px 12px', background: '#000', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 12,
          fontFamily: 'monospace', fontSize: 11, color: '#0f0', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
        }}>
          $ {applyModal.command}
        </div>
        <div style={{
          padding: '6px 10px', background: 'rgba(234,179,8,.1)', border: '1px solid rgba(234,179,8,.3)',
          borderRadius: 6, fontSize: 11, color: 'var(--yellow)', marginBottom: 16
        }}>
          {t("preConditionConfirmed", { reason: applyModal.reason || t('checkStillFailing') })}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => setApplyModal(null)}>{t("cancel")}</button>
          <button className="btn btn-primary" onClick={doApplyConfirm}>{t("applyNow")}</button>
        </div>
      </div>
    </div>}

    {/* Per-service table */}
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <table>
        <thead><tr>
          <th style={{ width: 60 }}>{t("grade")}</th>
          <th>{t("service")}</th>
          <th>{t("Stack")}</th>
          <th>{t("mode")}</th>
          <th>{t("Issues")}</th>
          <th style={{ width: 70 }}></th>
        </tr></thead>
        <tbody>
          {visible.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>{t("nothingToShow")}</td></tr>}
          {visible.map(a => {
            const isExp = expanded === a.service_name;
            const sev = a.summary?.issues_by_severity || {};
            return <React.Fragment key={a.service_name}>
              <tr id={'audit-row-' + a.service_name}
                style={{ cursor: 'pointer', background: isExp ? 'rgba(255,255,255,.04)' : undefined }}
                onClick={() => setExpanded(isExp ? null : a.service_name)}>
                <td><GradeBadge grade={a.grade} /></td>
                <td style={{ fontWeight: 500 }}>{a.service_name}</td>
                <td style={{ color: 'var(--muted)', fontSize: 12 }}>{a.stack || '—'}</td>
                <td style={{ fontSize: 12 }}>{a.mode_type === 'replicated' ? `replicated (${a.replicas_spec})` : a.mode_type}</td>
                <td style={{ fontSize: 12 }}>
                  {sev.P0 > 0 && <span className="badge badge-red" style={{ marginRight: 4 }}>P0×{sev.P0}</span>}
                  {sev.P1 > 0 && <span style={{ padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: 'rgba(249,115,22,.15)', color: '#f97316', marginRight: 4 }}>P1×{sev.P1}</span>}
                  {sev.P2 > 0 && <span className="badge badge-yellow" style={{ marginRight: 4 }}>P2×{sev.P2}</span>}
                  {sev.P3 > 0 && <span className="badge badge-blue" style={{ marginRight: 4 }}>P3×{sev.P3}</span>}
                  {(sev.P0 + sev.P1 + sev.P2 + sev.P3) === 0 && <span className="badge badge-green">{t("noIssues")}</span>}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 18 }}>{isExp ? '▾' : '▸'}</td>
              </tr>
              {isExp && <tr><td colSpan={6} style={{ padding: 0, background: 'rgba(0,0,0,.15)' }}>
                <div style={{ padding: '12px 20px' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontFamily: 'monospace' }}>{a.image}</div>
                  <table style={{ background: 'transparent' }}>
                    <thead><tr>
                      <th style={{ width: 60 }}>{t("sev")}</th>
                      <th style={{ width: 100 }}>{t("state")}</th>
                      <th>{t("Check")}</th>
                      <th>{t("detail")}</th>
                    </tr></thead>
                    <tbody>
                      {a.findings.map(f => {
                        const sb = STATUS_BADGE[f.status] || STATUS_BADGE.skip;
                        return <tr key={f.id}>
                          <td><span style={{ fontWeight: 700, color: SEV_COLOR[f.severity] || 'var(--muted)' }}>{f.severity}</span></td>
                          <td><span style={{ padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: sb.bg, color: sb.color }}>{sb.label}</span></td>
                          <td style={{ fontWeight: 500 }}>{f.title}</td>
                          <td style={{ fontSize: 12 }}>
                            <div style={{ color: 'var(--text)' }}>{f.message}</div>
                            {f.fix_hint && f.status !== 'pass' && f.status !== 'skip' && <div style={{
                              marginTop: 6, padding: '6px 10px', background: 'rgba(229,112,0,.08)',
                              border: '1px solid rgba(229,112,0,.25)', borderRadius: 6,
                              fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', whiteSpace: 'pre-wrap',
                            }}>{f.fix_hint}</div>}
                            {AUTO_FIXABLE_CHECKS.has(f.id) && f.status === 'fail' && <div style={{ marginTop: 8 }}>
                              <button className="btn btn-sm btn-primary"
                                disabled={applying && applying.service === a.service_name && applying.check_id === f.id}
                                onClick={(e) => { e.stopPropagation(); doApplyDryRun(a.service_name, f.id); }}>
                                {applying && applying.service === a.service_name && applying.check_id === f.id
                                  ? <span><span className="spinner" style={{ width: 12, height: 12, verticalAlign: 'middle', marginRight: 4 }} /> {t("applying")}</span>
                                  : t('applyAutomaticFix')}
                              </button>
                            </div>}
                          </td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              </td></tr>}
            </React.Fragment>;
          })}
        </tbody>
      </table>
    </div>
  </div>;
});

// Auto-refresh countdown for dashboard; isolated so App doesn't re-render every second.
const RefreshCountdown = React.memo(function RefreshCountdown({ tab, onRefresh }) {
  const REFRESH_INTERVAL = 15;
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  useEffect(() => {
    if (tab !== 'dashboard') return;
    setCountdown(REFRESH_INTERVAL);
    const id = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          onRefresh('dashboard');
          return REFRESH_INTERVAL;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [tab, onRefresh]);
  if (tab !== 'dashboard') return null;
  return <>
    <span style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}><span className="live-dot" style={{ width: 6, height: 6 }} /> {countdown}s</span>
    <div className="countdown-bar" style={{ width: `${(countdown / REFRESH_INTERVAL) * 100}%` }} />
  </>;
});

// TabBar — top-level so App doesn't recreate tab buttons on every state change.
const TabBar = React.memo(function TabBar({ tabs, activeTab, onTabChange }) {
  return <div className="tabs">
    {tabs.map(t => (
      <div key={t.id} className={`tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => onTabChange(t.id)}>
        <span style={{ width: 20, textAlign: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{t.icon}</span>
        {t.label}
      </div>
    ))}
  </div>;
});

// ============== APP ==============

function App() {
  const [tab, setTab] = useState('dashboard');
  // v2.1.0 multi-cluster: list of {id,name,hosts,mode} + the currently selected id.
  const [clusters, setClusters] = useState([]);
  const [cluster, setClusterState] = useState('');
  // Set the module-global synchronously BEFORE the re-render so any api() call
  // triggered by the cluster change already carries the new cluster param.
  const setCluster = useCallback((cid) => { _CLUSTER = cid; setClusterState(cid); }, []);
  // v2.0.0: engine mode probe — drives tab visibility + Dashboard layout.
  // null until first fetch resolves; tabs render with placeholder labels until
  // mode is known (~50ms on warm cache).
  const [engineMode, setEngineMode] = useState(null);
  const [overview, setOverview] = useState(null);
  const [nodeStats, setNodeStats] = useState(null);
  const [nodes, setNodes] = useState(null);
  const [services, setServices] = useState(null);
  const [stacks, setStacks] = useState(null);
  const [containers, setContainers] = useState(null);
  const [networks, setNetworks] = useState(null);
  const [volumes, setVolumes] = useState(null);
  const [images, setImages] = useState(null);
  const [loadBalance, setLoadBalance] = useState(null);
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [modal, setModal] = useState(null);
  const [logs, setLogs] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // In-memory cache so tab switching doesn't refetch the same data within 5s.
  const tabCacheRef = useRef({});

  const toast = useCallback((msg, type = 'info') => setToastMsg({ msg, type }), []);

  const loadTab = useCallback(async (tabName, force = false) => {
    if (engineMode == null) { setLoading(false); return; }
    if (engineMode !== 'swarm' && SWARM_ONLY_TABS.has(tabName)) { setLoading(false); return; }
    const cacheKey = `${_CLUSTER || ''}:${engineMode || ''}:${tabName}`;
    const cached = tabCacheRef.current[cacheKey];
    if (!force && cached && Date.now() - cached.ts < 5000) {
      switch (tabName) {
        case 'dashboard': setOverview(cached.overview); setNodeStats(cached.nodeStats); setLoadBalance(cached.loadBalance); break;
        case 'nodes': setNodes(cached.nodes); break;
        case 'services': setServices(cached.services); break;
        case 'stacks': setStacks(cached.stacks); break;
        case 'containers': setContainers(cached.containers); break;
        case 'networks': setNetworks(cached.networks); break;
        case 'volumes': setVolumes(cached.volumes); break;
        case 'images': setImages(cached.images); break;
        case 'loadbalance': setLoadBalance(cached.loadBalance); break;
        case 'audit': setAudit(cached.audit); break;
      }
      return;
    }
    setLoading(true);
    try {
      switch (tabName) {
        case 'dashboard':
          if (engineMode === 'standalone') {
            setOverview(null); setNodeStats(null); setLoadBalance(null);
            tabCacheRef.current[cacheKey] = { ts: Date.now(), overview: null, nodeStats: null, loadBalance: null };
          } else {
            const [ov, ns, lb] = await Promise.all([api('overview'), api('node-stats'), api('load-balance')]);
            setOverview(ov); setNodeStats(ns); setLoadBalance(lb);
            tabCacheRef.current[cacheKey] = { ts: Date.now(), overview: ov, nodeStats: ns, loadBalance: lb };
          }
          break;
        case 'nodes': { const d = await api('nodes'); setNodes(d); tabCacheRef.current[cacheKey] = { ts: Date.now(), nodes: d }; break; }
        case 'services': { const d = await api('services'); setServices(d); tabCacheRef.current[cacheKey] = { ts: Date.now(), services: d }; break; }
        case 'stacks': { const d = await api('stacks'); setStacks(d); tabCacheRef.current[cacheKey] = { ts: Date.now(), stacks: d }; break; }
        case 'containers': { const d = await api('containers'); setContainers(d); tabCacheRef.current[cacheKey] = { ts: Date.now(), containers: d }; break; }
        case 'networks': { const d = await api('networks'); setNetworks(d); tabCacheRef.current[cacheKey] = { ts: Date.now(), networks: d }; break; }
        case 'volumes': { const d = await api('volumes'); setVolumes(d); tabCacheRef.current[cacheKey] = { ts: Date.now(), volumes: d }; break; }
        case 'images': { const d = await api('images'); setImages(d); tabCacheRef.current[cacheKey] = { ts: Date.now(), images: d }; break; }
        case 'loadbalance': { const d = await api('load-balance'); setLoadBalance(d); tabCacheRef.current[cacheKey] = { ts: Date.now(), loadBalance: d }; break; }
        case 'audit': { const d = await api('policy/audit'); setAudit(d); tabCacheRef.current[cacheKey] = { ts: Date.now(), audit: d }; break; }
      }
    } catch (e) { toast(t('errorLoadingData'), 'error'); }
    setLoading(false);
  }, [engineMode]);

  // Load the cluster list once on mount; pick the server's default as active.
  useEffect(() => {
    let cancelled = false;
    api('clusters').then(r => {
      if (cancelled || !r || !Array.isArray(r.clusters)) return;
      setClusters(r.clusters);
      const initial = r.default || (r.clusters[0] && r.clusters[0].id) || '';
      if (initial) setCluster(initial);
    });
    return () => { cancelled = true; };
  }, []);

  // Reload the active tab whenever the tab, selected cluster or detected engine mode changes.
  // Waiting for engineMode to resolve avoids calling Swarm-only routes on standalone engines.
  useEffect(() => { loadTab(tab); }, [tab, cluster, engineMode]);

  const showLogs = useCallback(async (id, type = 'service') => {
    setModal({ type: 'logs', title: t('logs', { id }) }); setLogs(''); setLogsLoading(true);
    const endpoint = type === 'container' ? 'container-logs' : 'service-logs';
    const param = type === 'container' ? 'container_id' : 'service_id';
    const r = await api(`${endpoint}?${param}=${encodeURIComponent(id)}&tail=200`);
    setLogs(r.logs || r.error || t('noLogs')); setLogsLoading(false);
  }, []);

  const scaleService = useCallback((svc) => {
    const current = (svc.Replicas || '').split('/').pop() || svc.replicas_spec || 1;
    setModal({ type: 'scale', svc, current: parseInt(current) || 1 });
  }, []);

  const doScale = useCallback(async (svcName, replicas) => {
    const r = await api('service-scale', { method: 'POST', body: { service_id: svcName, replicas } });
    if (r.success) { toast(t('scaledTo', { svc: svcName, n: replicas }), 'success'); setModal(null); loadTab('services', true); }
    else toast(r.error || 'Error', 'error');
  }, [toast, loadTab]);

  const doRestart = useCallback(async (svcName) => {
    if (!confirm(t('restartService', { svc: svcName }))) return;
    const r = await api('service-restart', { method: 'POST', body: { service_id: svcName } });
    if (r.success) { toast(t('restarted3', { svc: svcName }), 'success'); loadTab('services', true); }
    else toast(r.error || 'Error', 'error');
  }, [toast, loadTab]);

  const showTasks = useCallback(async (svc) => {
    setModal({ type: 'tasks', title: t('tasks2', { name: svc.Name }), tasks: null });
    const r = await api(`tasks?service_id=${encodeURIComponent(svc.Name || svc.ID)}`);
    setModal(m => ({ ...m, tasks: r.tasks || [] }));
  }, []);

  const doContainerAction = useCallback(async (id, action) => {
    if (!confirm(t('container', { action, id }))) return;
    const r = await api('container-action', { method: 'POST', body: { container_id: id, action } });
    if (r.success) { toast(t('containerEd', { action }), 'success'); loadTab('containers', true); }
    else toast(r.error || 'Error', 'error');
  }, [toast, loadTab]);

  const doStackRemove = useCallback(async (name) => {
    if (!confirm(t('deleteStackThisWillRemoveAll', { name }))) return;
    const r = await api('stack-remove', { method: 'POST', body: { stack_name: name } });
    if (r.success) { toast(t('stackDeleted', { name }), 'success'); loadTab('stacks', true); }
    else toast(r.error || 'Error', 'error');
  }, [toast, loadTab]);

  // Stable adapters so child components can be memoized without re-rendering on every App render.
  const handleContainerLogs = useCallback((id) => showLogs(id, 'container'), [showLogs]);
  const handleContainerAction = useCallback((id, action, reload) => {
    if (reload) { loadTab('containers', true); return; }
    doContainerAction(id, action);
  }, [loadTab, doContainerAction]);
  const handleAuditRefresh = useCallback(() => loadTab('audit', true), [loadTab]);
  const handleSettingsSave = useCallback(() => loadTab('dashboard', true), [loadTab]);

  // v2.0.0: probe engine mode on mount + every 60s. Cheap (api/host-mode is
  // server-cached for 60s), and a re-probe lets the UI update if an admin
  // runs `docker swarm init` / `swarm leave` while the page is open.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const r = await api('host-mode');
        if (!cancelled && r && (r.mode === 'swarm' || r.mode === 'standalone')) {
          setEngineMode(r.mode);
          // If user is sitting on a tab that's no longer valid (mode flipped
          // to standalone while looking at Services), bounce to dashboard.
          if (r.mode === 'standalone' && SWARM_ONLY_TABS.has(tab)) {
            setTab('dashboard');
          }
        }
      } catch (e) { /* leave engineMode null → tabs default to swarm-mode */ }
    };
    probe();
    const id = setInterval(probe, 60000);
    return () => { cancelled = true; clearInterval(id); };
    // Re-probe when the cluster changes (prod and QA can be in different modes).
    // `tab` is intentionally excluded — the bounce is best-effort.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster]);

  // Memoize tab definitions so the TabBar only re-renders when engine mode changes.
  const allTabs = useMemo(() => [
    { id: 'dashboard', label: t('dashboard'), icon: '#' },
    { id: 'nodes', label: t('nodes'), icon: 'N', swarmOnly: true },
    { id: 'services', label: t('services'), icon: 'S', swarmOnly: true },
    { id: 'stacks', label: t('stacks2'), icon: 'K', swarmOnly: true },
    { id: 'containers', label: t('containers'), icon: 'C' },
    { id: 'networks', label: t('networks'), icon: 'R' },
    { id: 'volumes', label: t('volumes'), icon: 'V' },
    { id: 'images', label: t('images'), icon: 'I' },
    { id: 'loadbalance', label: t('balance'), icon: 'B', swarmOnly: true },
    { id: 'trends', label: t('trends'), icon: 'T', swarmOnly: true },
    { id: 'audit', label: t('audit'), icon: 'A', swarmOnly: true },
    { id: 'settings', label: t('settings'), icon: '*' },
  ], []);
  // While engineMode is null (initial render before first probe completes)
  // we *show* swarm tabs — most users have swarm; standalone is the minority
  // case and the brief flash of extra tabs is gentler than the inverse.
  const tabs = useMemo(() => (engineMode === 'standalone')
    ? allTabs.filter(t => !t.swarmOnly)
    : allTabs, [engineMode, allTabs]);

  return <>
    <div className="main">
      <TabBar tabs={tabs} activeTab={tab} onTabChange={setTab} />

      <div className="header" style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>{tabs.find(t => t.id === tab)?.label}</h2>
          <RefreshCountdown key={refreshKey} tab={tab} onRefresh={loadTab} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {clusters.length > 1 && <select
            value={cluster}
            onChange={e => setCluster(e.target.value)}
            title={t("Cluster Docker")}
            style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 13, cursor: 'pointer' }}>
            {clusters.map(c => <option key={c.id} value={c.id}>{c.name} ({c.hosts})</option>)}
          </select>}
          {loading && <span className="spinner" />}
          <button className="btn btn-sm" title={t("Language / Idioma")} onClick={() => setLang(LANG === 'en' ? 'es' : 'en')}>{LANG === 'en' ? 'EN' : 'ES'}</button>
          <button className="btn" onClick={() => { loadTab(tab, true); if (tab === 'dashboard') setRefreshKey(k => k + 1); }}>{t("Refresh")}</button>
        </div>
      </div>

      {tab === 'dashboard' && <Dashboard overview={overview} nodeStats={nodeStats} loadBalance={loadBalance} onRefresh={loadTab} engineMode={engineMode} />}
      {tab === 'nodes' && <Nodes data={nodes} />}
      {tab === 'services' && <Services data={services} onScale={scaleService} onRestart={doRestart} onLogs={showLogs} onTasks={showTasks} toast={toast} />}
      {tab === 'stacks' && <Stacks data={stacks} onRemove={doStackRemove} toast={toast} />}
      {tab === 'containers' && <Containers data={containers} onLogs={handleContainerLogs} onAction={handleContainerAction} toast={toast} />}
      {tab === 'networks' && <Networks data={networks} toast={toast} />}
      {tab === 'volumes' && <Volumes data={volumes} toast={toast} />}
      {tab === 'images' && <Images data={images} toast={toast} />}
      {tab === 'loadbalance' && <LoadBalance data={loadBalance} toast={toast} />}
      {tab === 'trends' && <Trends toast={toast} engineMode={engineMode} />}
      {tab === 'audit' && <Audit data={audit} onRefresh={handleAuditRefresh} toast={toast} />}
      {tab === 'settings' && <Settings onSave={handleSettingsSave} toast={toast} />}
    </div>

    {/* Modals */}
    {modal?.type === 'logs' && <Modal title={modal.title} onClose={() => setModal(null)}>
      {logsLoading ? <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner" /></div>
        : <div className="log-viewer">{logs}</div>}
    </Modal>}

    {modal?.type === 'scale' && <Modal title={t('scale', { name: modal.svc.Name })} onClose={() => setModal(null)}>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>{t("currentReplicas", { n: modal.current })}</label>
        <input type="number" id="scaleInput" defaultValue={modal.current} min={0} max={100} style={{ marginTop: 4 }} />
      </div>
      <button className="btn btn-primary" onClick={() => doScale(modal.svc.Name || modal.svc.ID, parseInt(document.getElementById('scaleInput').value))}>
        {t("applyScale")}
      </button>
    </Modal>}

    {modal?.type === 'tasks' && <Modal title={modal.title} onClose={() => setModal(null)}>
      {!modal.tasks ? <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner" /></div>
        : <table>
          <thead><tr><th>{t("ID")}</th><th>{tr("name")}</th><th>{tr("node")}</th><th>{tr("state")}</th><th>{t("Error")}</th></tr></thead>
          <tbody>{modal.tasks.map((t, i) => <tr key={i}>
            <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{(t.ID || '').substring(0, 12)}</td>
            <td>{t.Name}</td>
            <td>{t.Node}</td>
            <td><StatusBadge status={t.CurrentState?.split(' ')[0] || t.DesiredState} /><div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.CurrentState}</div></td>
            <td style={{ fontSize: 12, color: 'var(--red)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.Error || '-'}</td>
          </tr>)}</tbody>
        </table>
      }
    </Modal>}

    {toastMsg && <Toast msg={toastMsg.msg} type={toastMsg.type} onClose={() => setToastMsg(null)} />}
  </>;
}

if (_parentI18n && !_parentI18n.isNamespaceLoaded('docker_swarm')) {
  _parentI18n.loadPluginNamespaceFull('docker_swarm', '/api/native/docker_swarm/i18n').then(function () {
    ReactDOM.render(<App />, document.getElementById('root'));
  }).catch(function (e) {
    console.error('[docker_swarm] failed to load namespace', e);
    ReactDOM.render(<App />, document.getElementById('root'));
  });
} else {
  ReactDOM.render(<App />, document.getElementById('root'));
}
