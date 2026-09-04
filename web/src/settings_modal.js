/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        web/src/settings_modal.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Settings Modal JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
const PERMISSION_CATEGORY_META = {
    vm: { order: 10, title: 'Virtual Machines', icon: '🖥️' },
    cluster: { order: 20, title: 'Cluster', icon: '🔗' },
    node: { order: 30, title: 'Nodes', icon: '🏠' },
    storage: { order: 40, title: 'Storage', icon: '💾' },
    backup: { order: 50, title: 'Backup Jobs', icon: '📦' },
    ha: { order: 60, title: 'High Availability', icon: '⚡' },
    firewall: { order: 70, title: 'Firewall', icon: '🛡️' },
    pool: { order: 80, title: 'Resource Pools', icon: '🗂️' },
    replication: { order: 90, title: 'Replication', icon: '🔁' },
    ceph: { order: 100, title: 'Ceph', icon: '🐙' },
    sdn: { order: 110, title: 'Software-Defined Net', icon: '🌐' },
    alert: { order: 120, title: 'Alerts', icon: '🔔' },
    site_recovery: { order: 130, title: 'Site Recovery', icon: '🚨' },
    pbs: { order: 140, title: 'Proxmox Backup Server', icon: '🗄️' },
    vmware: { order: 150, title: 'ESXi', icon: '📡' },

    plugins: { order: 170, title: 'Plugins', icon: '🧩' },
    admin: { order: 999, title: 'Administration', icon: '⚙️' },
};

function PermissionsGrid({ allPermissions, selected, onChange, t }) {
    const [filter, setFilter] = useState('');
    // category collapsed state; admin category collapsed by default (less-used)
    const [collapsed, setCollapsed] = useState({ admin: true });
    const { isCorporate } = useLayout();
    const groups = React.useMemo(() => {
        const q = filter.trim().toLowerCase();
        const byCat = {};
        (allPermissions || []).forEach(p => {
            if (q && !(p.permission.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q))) return;
            const c = p.category || p.permission.split('.')[0];
            (byCat[c] = byCat[c] || []).push(p);
        });
        // sort by meta.order; unknown categories go to the end alphabetically
        return Object.keys(byCat)
            .sort((a, b) => {
                const oa = PERMISSION_CATEGORY_META[a]?.order ?? 500;
                const ob = PERMISSION_CATEGORY_META[b]?.order ?? 500;
                if (oa !== ob) return oa - ob;
                return a.localeCompare(b);
            })
            .map(c => ({ cat: c, perms: byCat[c].sort((x, y) => x.permission.localeCompare(y.permission)) }));
    }, [allPermissions, filter]);

    const selSet = new Set(selected || []);
    const toggleOne = (perm, on) => {
        const next = new Set(selected || []);
        if (on) next.add(perm); else next.delete(perm);
        onChange(Array.from(next));
    };
    const toggleGroup = (perms, on) => {
        const next = new Set(selected || []);
        perms.forEach(p => on ? next.add(p.permission) : next.delete(p.permission));
        onChange(Array.from(next));
    };

    return (
        <div className={isCorporate ? 'corp-settings-card overflow-hidden' : "bg-proxmox-darker border border-proxmox-border rounded-lg overflow-hidden"}>
            <div className="flex items-center gap-2 p-2 border-b border-proxmox-border bg-proxmox-dark">
                <Icons.Search className="w-4 h-4 text-gray-500 ml-1" />
                <input type="text" value={filter} onChange={e => setFilter(e.target.value)}
                    placeholder={t('filterPermissions2')}
                    className={isCorporate ? 'corp-input' : "flex-1 bg-transparent outline-none text-sm text-white placeholder:text-gray-500"} />
                <span className={isCorporate ? 'corp-help-text mr-2' : "text-xs text-gray-500 mr-2"}>{(selected || []).length} / {(allPermissions || []).length}</span>
                <button type="button" onClick={() => onChange([])} className="text-xs px-2 py-0.5 text-gray-400 hover:text-white" title={t('clearAll2')}>
                    {t('clearAll')}
                </button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2 space-y-2" style={{ scrollbarWidth: 'thin' }}>
                {groups.length === 0 && (
                    <div className={isCorporate ? 'corp-help-text text-center py-6' : "text-center text-sm text-gray-500 py-6"}>{t('noMatchingPermissions')}</div>
                )}
                {groups.map(({ cat, perms }) => {
                    const meta = PERMISSION_CATEGORY_META[cat] || { title: cat, icon: '•' };
                    const checkedCount = perms.filter(p => selSet.has(p.permission)).length;
                    const allChecked = checkedCount === perms.length && perms.length > 0;
                    const someChecked = checkedCount > 0 && !allChecked;
                    const isCollapsed = !!collapsed[cat];
                    return (
                        <div key={cat} className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border/50 rounded-md"}>
                            <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer select-none"
                                onClick={() => setCollapsed(c => ({ ...c, [cat]: !c[cat] }))}>
                                <Icons.ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                                <span className="text-base">{meta.icon}</span>
                                <span className="text-sm font-medium text-white flex-1">{meta.title}</span>
                                <span className={`text-xs ${allChecked ? 'text-green-400' : someChecked ? 'text-yellow-400' : 'text-gray-500'}`}>
                                    {checkedCount}/{perms.length}
                                </span>
                                <button type="button" onClick={(e) => { e.stopPropagation(); toggleGroup(perms, !allChecked); }}
                                    className="text-xs px-1.5 py-0.5 rounded bg-proxmox-darker hover:bg-proxmox-hover text-gray-300">
                                    {allChecked ? (t('deselectAll')) : (t('selectAll'))}
                                </button>
                            </div>
                            {!isCollapsed && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-1 px-3 pb-2 pt-1">
                                    {perms.map(p => (
                                        <label key={p.permission} className="flex items-start gap-2 text-xs text-gray-300 cursor-pointer hover:text-white py-0.5">
                                            <input type="checkbox" checked={selSet.has(p.permission)}
                                                onChange={e => toggleOne(p.permission, e.target.checked)}
                                                className="rounded border-gray-600 mt-0.5" />
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium leading-tight">{p.description || p.permission}</div>
                                                <div className="text-[10px] text-gray-500 font-mono truncate" title={p.permission}>{p.permission}</div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// Webhook alert channels (Slack/Discord/Teams/ntfy/generic).
// Lives in the Alerts card as a sub-section. Urls come back masked from the
// server on GET; when editing an entry we re-fetch with ?full=1 so the form
// shows the real URL (stays in the browser, never logged).
function AlertChannelsPanel({ t, addToast, getAuthHeaders }) {
    const [channels, setChannels] = useState([]);
    const [editing, setEditing] = useState(null);   // null | new-template | existing
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState({});
    const [testing, setTesting] = useState({});

    const load = async () => {
        setLoading(true);
        try {
            const r = await fetch(`${API_URL}/alert-channels`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) setChannels(await r.json());
        } catch (e) { console.error('channels load:', e); }
        setLoading(false);
    };
    useEffect(() => { load(); }, []);

    const newChannel = () => setEditing({ id: null, name: '', type: 'slack', url: '', token: '', topic: '', enabled: true });

    const startEdit = async (ch) => {
        // Refetch full list to get unmasked secrets for this row
        try {
            const r = await fetch(`${API_URL}/alert-channels?full=1`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) {
                const full = await r.json();
                const row = full.find(c => c.id === ch.id) || ch;
                setEditing({ ...row });
                return;
            }
        } catch (e) { }
        setEditing({ ...ch });
    };

    const save = async () => {
        const body = { ...editing };
        setSaving(true);
        try {
            const isNew = !editing.id;
            const r = await fetch(
                isNew ? `${API_URL}/alert-channels` : `${API_URL}/alert-channels/${editing.id}`,
                {
                    method: isNew ? 'POST' : 'PUT', credentials: 'include',
                    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                }
            );
            if (r.ok) {
                addToast?.(t('channelSaved'), 'success');
                setEditing(null); load();
            } else {
                const e = await r.json().catch(() => ({}));
                addToast?.(e.error || 'Save failed', 'error');
            }
        } catch (e) { addToast?.(e.message || 'Save failed', 'error'); }
        finally { setSaving(false); }
    };

    const del = async (ch) => {
        if (!window.confirm((t('confirmDeleteChannel')) + ' "' + (ch.name || ch.id) + '"?')) return;
        setDeleting(prev => ({ ...prev, [ch.id]: true }));
        try {
            const r = await fetch(`${API_URL}/alert-channels/${ch.id}`, {
                method: 'DELETE', credentials: 'include', headers: getAuthHeaders()
            });
            if (r.ok) { addToast?.(t('channelDeleted'), 'success'); load(); }
            else addToast?.('Delete failed', 'error');
        } catch (e) { addToast?.('Delete failed', 'error'); }
        finally { setDeleting(prev => ({ ...prev, [ch.id]: false })); }
    };

    const test = async (ch) => {
        setTesting({ ...testing, [ch.id]: true });
        try {
            const r = await fetch(`${API_URL}/alert-channels/${ch.id}/test`, {
                method: 'POST', credentials: 'include', headers: getAuthHeaders()
            });
            const d = await r.json().catch(() => ({}));
            if (d.success) addToast?.(`✓ ${ch.name}: ${d.detail || 'OK'}`, 'success');
            else addToast?.(`✗ ${ch.name}: ${d.detail || 'failed'}`, 'error');
        } catch (e) { addToast?.(`Test failed: ${e.message}`, 'error'); }
        finally { setTesting(prev => ({ ...prev, [ch.id]: false })); }
    };

    const typeLabel = (tp) => ({ slack: 'Slack', discord: 'Discord', teams: 'Microsoft Teams', ntfy: 'ntfy', generic: 'Generic JSON' }[tp] || tp);

    return (
        <div className="bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="font-medium text-white flex items-center gap-2">
                    <Icons.Bell className="w-4 h-4" />
                    {t('alertChannels')}
                    <span className="text-xs text-gray-500 ml-1">({channels.length})</span>
                </h4>
                <button onClick={newChannel} className="flex items-center gap-1 px-3 py-1.5 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm">
                    <Icons.Plus className="w-3.5 h-3.5" /> {t('addChannel')}
                </button>
            </div>
            <p className="text-xs text-gray-500">{t('alertChannelsDesc')}</p>

            {loading && channels.length === 0 ? (
                <div className="text-center py-4"><Icons.RotateCw className="w-4 h-4 animate-spin text-gray-400 mx-auto" /></div>
            ) : channels.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-3">{t('noChannels')}</p>
            ) : (
                <div className="space-y-2">
                    {channels.map(ch => (
                        <div key={ch.id} className={`flex items-center gap-3 p-3 rounded-lg border ${ch.enabled === false ? 'border-proxmox-border opacity-60' : 'border-proxmox-border'} bg-proxmox-secondary`}>
                            <div className={`p-1.5 rounded ${ch.enabled === false ? 'bg-gray-500/10' : 'bg-blue-500/10'}`}>
                                <Icons.Bell className={`w-4 h-4 ${ch.enabled === false ? 'text-gray-400' : 'text-blue-400'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-white text-sm font-medium">{ch.name || ch.id}</span>
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-300">{typeLabel(ch.type)}</span>
                                    {ch.enabled === false && <span className="text-xs text-gray-500">{t('disabled')}</span>}
                                </div>
                                <div className="text-xs text-gray-500 font-mono truncate">{ch.url}</div>
                            </div>
                            <button onClick={() => test(ch)} disabled={!!testing[ch.id]} className="px-2 py-1 text-xs bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 rounded flex items-center gap-1 disabled:opacity-50">
                                {testing[ch.id] ? <Icons.RotateCw className="w-3 h-3 animate-spin" /> : <Icons.Play />}
                                {t('testChannel')}
                            </button>
                            <button onClick={() => startEdit(ch)} className="px-2 py-1 text-xs bg-proxmox-dark text-gray-300 hover:bg-proxmox-hover rounded">
                                <Icons.Edit /> {t('edit')}
                            </button>
                            <button onClick={() => del(ch)} disabled={!!deleting[ch.id]} className="px-2 py-1 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded disabled:opacity-50">
                                {!!deleting[ch.id] ? <Icons.RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Icons.Trash />}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {editing && (
                <div className="mt-2 p-3 bg-proxmox-darker border border-proxmox-border rounded-lg space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">{t('name')}</label>
                            <input type="text" value={editing.name}
                                onChange={e => setEditing({ ...editing, name: e.target.value })}
                                placeholder="Ops Slack"
                                className="w-full px-3 py-1.5 bg-proxmox-secondary border border-proxmox-border rounded text-white text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">{t('type')}</label>
                            <select value={editing.type}
                                onChange={e => setEditing({ ...editing, type: e.target.value })}
                                className="w-full px-3 py-1.5 bg-proxmox-secondary border border-proxmox-border rounded text-white text-sm">
                                <option value="slack">Slack</option>
                                <option value="discord">Discord</option>
                                <option value="teams">Microsoft Teams</option>
                                <option value="ntfy">ntfy</option>
                                <option value="generic">Generic JSON</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs text-gray-400 mb-1">Webhook URL</label>
                        <input type="text" value={editing.url}
                            onChange={e => setEditing({ ...editing, url: e.target.value })}
                            placeholder="https://hooks.slack.com/services/…"
                            className="w-full px-3 py-1.5 bg-proxmox-secondary border border-proxmox-border rounded text-white text-sm font-mono" />
                    </div>
                    {editing.type === 'ntfy' && (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">{t('topic')}</label>
                                <input type="text" value={editing.topic || ''}
                                    onChange={e => setEditing({ ...editing, topic: e.target.value })}
                                    placeholder="ProxmoxVEx-alerts"
                                    className="w-full px-3 py-1.5 bg-proxmox-secondary border border-proxmox-border rounded text-white text-sm font-mono" />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">{t('token2')}</label>
                                <input type="password" value={editing.token || ''}
                                    onChange={e => setEditing({ ...editing, token: e.target.value })}
                                    placeholder={t('optional5')}
                                    className="w-full px-3 py-1.5 bg-proxmox-secondary border border-proxmox-border rounded text-white text-sm font-mono" />
                            </div>
                        </div>
                    )}
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={editing.enabled !== false}
                            onChange={e => setEditing({ ...editing, enabled: e.target.checked })}
                            className="w-4 h-4" />
                        <span className="text-sm text-white">{t('enabled')}</span>
                    </label>
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setEditing(null)} disabled={saving} className="px-3 py-1.5 text-sm text-gray-300 hover:text-white disabled:opacity-50">
                            {t('cancel')}
                        </button>
                        <button onClick={save} disabled={saving || !editing.url} className="px-3 py-1.5 bg-proxmox-orange hover:bg-orange-600 rounded text-sm disabled:opacity-50 flex items-center gap-2">
                            {saving ? <Icons.RotateCw className="w-3.5 h-3.5 animate-spin" /> : null}
                            {t('save')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// SIEM Forwarder admin panel inside the Settings modal.
// Lists configured targets, lets you add/edit/delete/test them.
function SIEMTab({ addToast, t, getAuthHeaders }) {
    const [targets, setTargets] = React.useState([]);
    const [types, setTypes] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [editing, setEditing] = React.useState(null); // null | {id?, ...form}
    const [saving, setSaving] = React.useState(false);
    const [deleting, setDeleting] = React.useState(null); // target id being deleted
    const [testing, setTesting] = React.useState(null); // target id being tested
    const { isCorporate } = useLayout();

    const refresh = async () => {
        setLoading(true);
        try {
            const [tg, tp] = await Promise.all([
                fetch(`${API_URL}/siem/targets`, { credentials: 'include', headers: getAuthHeaders() }).then(r => r.ok ? r.json() : { targets: [] }),
                fetch(`${API_URL}/siem/types`, { credentials: 'include', headers: getAuthHeaders() }).then(r => r.ok ? r.json() : { types: [] }),
            ]);
            setTargets(tg.targets || []);
            setTypes(tp.types || []);
        } finally { setLoading(false); }
    };
    React.useEffect(() => { refresh(); /* eslint-disable-line */ }, []);

    const newTarget = () => setEditing({
        name: '', type: 'syslog_udp', endpoint: '', enabled: true, settings: {},
    });

    const save = async () => {
        if (!editing.name?.trim() || !editing.endpoint?.trim()) {
            addToast(t('siemRequiredFields'), 'error');
            return;
        }
        setSaving(true);
        try {
            const isUpdate = !!editing.id;
            const url = isUpdate ? `${API_URL}/siem/targets/${editing.id}` : `${API_URL}/siem/targets`;
            const r = await fetch(url, {
                method: isUpdate ? 'PUT' : 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({
                    name: editing.name.trim(),
                    type: editing.type,
                    endpoint: editing.endpoint.trim(),
                    enabled: !!editing.enabled,
                    settings: editing.settings || {},
                }),
            });
            if (r.ok) {
                addToast(t('siemSaved'), 'success');
                setEditing(null);
                await refresh();
            } else {
                const d = await r.json().catch(() => ({}));
                addToast(d.error || (t('siemSaveFailed')), 'error');
            }
        } finally { setSaving(false); }
    };

    const remove = async (tid) => {
        if (!confirm(t('siemDeleteConfirm'))) return;
        setDeleting(tid);
        try {
            const r = await fetch(`${API_URL}/siem/targets/${tid}`, {
                method: 'DELETE', credentials: 'include', headers: getAuthHeaders(),
            });
            if (r.ok) { addToast(t('siemDeleted'), 'success'); await refresh(); }
            else { addToast('Delete failed', 'error'); }
        } catch (e) { addToast('Delete failed', 'error'); }
        finally { setDeleting(null); }
    };

    const testTarget = async (tid) => {
        setTesting(tid);
        try {
            const r = await fetch(`${API_URL}/siem/targets/${tid}/test`, {
                method: 'POST', credentials: 'include', headers: getAuthHeaders(),
            });
            if (r.ok) {
                const d = await r.json();
                addToast(d.ok ? (t('siemTestOk')) : (t('siemTestFailed')),
                    d.ok ? 'success' : 'error');
                refresh();
            } else {
                addToast(t('siemTestFailed'), 'error');
            }
        } catch (e) { addToast(t('siemTestFailed'), 'error'); }
        finally { setTesting(null); }
    };

    const currentTypeMeta = types.find(tt => tt.id === editing?.type) || {};

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-white">{t('siemTitle')}</h3>
                    <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-0.5"}>
                        {t('siemDesc')}
                    </p>
                </div>
                <div className="flex gap-2">
                    <button onClick={refresh} disabled={loading}
                        className="px-3 py-1.5 bg-proxmox-dark border border-proxmox-border text-gray-300 hover:text-white rounded-lg text-sm flex items-center gap-1.5">
                        <Icons.RefreshCw className="w-3.5 h-3.5" />
                        {t('refresh')}
                    </button>
                    <button onClick={newTarget}
                        className="px-3 py-1.5 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm text-white flex items-center gap-1.5">
                        <Icons.Plus className="w-3.5 h-3.5" />
                        {t('siemAddTarget')}
                    </button>
                </div>
            </div>

            {targets.length === 0 ? (
                <div className={isCorporate ? 'corp-settings-card text-center' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-8 text-center text-sm text-gray-500"}>
                    {t('siemNoTargets')}
                </div>
            ) : (
                <div className="space-y-2">
                    {targets.map(tg => (
                        <div key={tg.id} className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-3"}>
                            <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${!tg.enabled ? 'bg-gray-500' :
                                            tg.last_status === 'error' ? 'bg-red-500' :
                                                tg.last_status === 'ok' ? 'bg-green-500' : 'bg-yellow-500'
                                            }`}></span>
                                        <span className="text-sm font-medium text-white">{tg.name}</span>
                                        <span className="text-[10px] px-1.5 py-0.5 bg-proxmox-darker border border-proxmox-border rounded text-gray-400 uppercase">{tg.type}</span>
                                        {!tg.enabled && (
                                            <span className="text-[10px] px-1.5 py-0.5 bg-gray-500/15 text-gray-400 rounded">{t('disabled')}</span>
                                        )}
                                    </div>
                                    <div className="text-[11px] text-gray-500 font-mono mt-1 truncate">{tg.endpoint}</div>
                                    <div className="text-[10px] text-gray-600 mt-1">
                                        {tg.sent_count} {t('siemSent')}, {tg.error_count} {t('siemErrors')}
                                        {tg.last_ok_at && ` · ${t('siemLastOk')} ${(tg.last_ok_at || '').replace('T', ' ').slice(0, 16)}`}
                                        {tg.last_error && ` · ${t('siemLastError')}: `}
                                        {tg.last_error && <span className="text-red-400">{tg.last_error.slice(0, 80)}</span>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <button onClick={() => testTarget(tg.id)} disabled={testing === tg.id}
                                        className="px-2 py-1 bg-proxmox-darker border border-proxmox-border rounded text-xs text-gray-300 hover:text-white disabled:opacity-50 flex items-center gap-1">
                                        {testing === tg.id ? <Icons.RotateCw className="w-3 h-3 animate-spin" /> : null}
                                        {t('test')}
                                    </button>
                                    <button onClick={() => setEditing({ ...tg, enabled: !!tg.enabled })}
                                        className="px-2 py-1 bg-proxmox-darker border border-proxmox-border rounded text-xs text-gray-300 hover:text-white">
                                        {t('edit')}
                                    </button>
                                    <button onClick={() => remove(tg.id)} disabled={deleting === tg.id}
                                        className="px-2 py-1 bg-red-500/15 border border-red-500/30 rounded text-xs text-red-400 hover:bg-red-500/25 disabled:opacity-50">
                                        {deleting === tg.id ? <Icons.RotateCw className="w-3 h-3 animate-spin" /> : <Icons.Trash className="w-3 h-3" />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {editing && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => !saving && setEditing(null)}>
                    <div className={isCorporate ? 'corp-settings-card w-full max-w-lg max-h-[90vh] overflow-y-auto' : "bg-proxmox-card border border-proxmox-border rounded-xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto"} onClick={e => e.stopPropagation()}>
                        <h3 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "text-base font-semibold text-white mb-3 flex items-center gap-2"}>
                            <Icons.Send className="w-4 h-4 text-proxmox-orange" />
                            {editing.id ? (t('siemEditTarget2')) : (t('siemAddTarget2'))}
                        </h3>
                        <div className="space-y-3">
                            <div>
                                <label className={isCorporate ? 'corp-label' : "text-xs text-gray-400 block mb-1"}>{t('name')} *</label>
                                <input type="text" value={editing.name || ''}
                                    onChange={e => setEditing({ ...editing, name: e.target.value })}
                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-sm text-white"} />
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : "text-xs text-gray-400 block mb-1"}>{t('siemType')}</label>
                                <select value={editing.type}
                                    onChange={e => setEditing({ ...editing, type: e.target.value, settings: {} })}
                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-sm text-white"}>
                                    {types.map(tt => <option key={tt.id} value={tt.id}>{tt.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : "text-xs text-gray-400 block mb-1"}>
                                    {t('siemEndpoint')} *
                                    <span className={isCorporate ? 'corp-help-text ml-2' : "text-gray-600 ml-2"}>{currentTypeMeta.endpoint_hint}</span>
                                </label>
                                <input type="text" value={editing.endpoint || ''}
                                    onChange={e => setEditing({ ...editing, endpoint: e.target.value })}
                                    placeholder={currentTypeMeta.endpoint_hint || ''}
                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-sm text-white font-mono"} />
                            </div>

                            {/* per-type settings */}
                            {(currentTypeMeta.settings_fields || []).map(field => (
                                <div key={field}>
                                    {field === 'verify_tls' ? (
                                        <label className="flex items-center gap-2 text-sm text-gray-300">
                                            <input type="checkbox"
                                                checked={editing.settings?.verify_tls !== false}
                                                onChange={e => setEditing({ ...editing, settings: { ...editing.settings, verify_tls: e.target.checked } })} />
                                            {t('siemVerifyTls')}
                                            <span className={isCorporate ? 'corp-help-text ml-2' : "text-xs text-gray-500 ml-2"}>{t('siemVerifyTlsHint')}</span>
                                        </label>
                                    ) : field === 'headers' ? (
                                        <>
                                            <label className={isCorporate ? 'corp-label' : "text-xs text-gray-400 block mb-1"}>{field}</label>
                                            <textarea
                                                value={JSON.stringify(editing.settings?.headers || {}, null, 2)}
                                                onChange={e => {
                                                    try {
                                                        const v = JSON.parse(e.target.value || '{}');
                                                        setEditing({ ...editing, settings: { ...editing.settings, headers: v } });
                                                    } catch (_) { /* swallow until valid JSON */ }
                                                }}
                                                rows={3}
                                                placeholder='{"Authorization": "Bearer ..."}'
                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-xs text-white font-mono"}
                                            />
                                        </>
                                    ) : (
                                        <>
                                            <label className={isCorporate ? 'corp-label' : "text-xs text-gray-400 block mb-1"}>{field}</label>
                                            <input type={field === 'password' || field === 'token' ? 'password' : 'text'}
                                                value={editing.settings?.[field] || ''}
                                                onChange={e => setEditing({ ...editing, settings: { ...editing.settings, [field]: e.target.value } })}
                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-sm text-white"} />
                                        </>
                                    )}
                                </div>
                            ))}

                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                <input type="checkbox" checked={!!editing.enabled}
                                    onChange={e => setEditing({ ...editing, enabled: e.target.checked })} />
                                {t('enabled')}
                            </label>
                        </div>
                        <div className="flex justify-end gap-2 mt-5">
                            <button onClick={() => setEditing(null)} disabled={saving}
                                className="px-3 py-1.5 text-sm text-gray-400 hover:text-white">
                                {t('cancel')}
                            </button>
                            <button onClick={save} disabled={saving}
                                className="px-3 py-1.5 bg-proxmox-orange hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded flex items-center gap-1.5">
                                {saving ? <Icons.RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Icons.Check className="w-3.5 h-3.5" />}
                                {t('save')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// SettingsModalResizablePanels: wraps the settings sidebar in a resizable panel.
// 812-resizable-panels-for-settings-modal: users can drag the sidebar edge to resize.
function SettingsModalResizablePanels({ children, isCorporate }) {
    return (
        <aside
            className={`resizable-x flex-shrink-0 overflow-y-auto p-3 border-r ${isCorporate ? 'bg-proxmox-dark border-proxmox-border/50' : 'bg-proxmox-dark border-proxmox-border'}`}
            style={{ width: 240 }}
            data-testid="settings-modal-resizable-panels"
        >
            {children}
        </aside>
    );
}

// SettingsModalStatusBadge: small color-coded dot indicating the status of a setting.
// 813-color-coded-status-for-settings-modal: used in the settings modal header to surface status at a glance.
function SettingsModalStatusBadge({ status }) {
    const colors = {
        ok: 'bg-green-500',
        warning: 'bg-yellow-500',
        error: 'bg-rose-500',
        info: 'bg-cyan-500',
    };
    const color = colors[status] || colors.info;
    return (
        <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${color}`}
            data-testid="settings-modal-status-badge"
            aria-label={status || 'info'}
        />
    );
}

// SettingsModalHoverCard: shows a tooltip-style card on hover.
// 814-hover-cards-for-settings-modal: adds contextual hover cards to settings controls.
function SettingsModalHoverCard({ children, content }) {
    const [visible, setVisible] = useState(false);
    return (
        <div
            className="relative inline-block"
            onMouseEnter={() => setVisible(true)}
            onMouseLeave={() => setVisible(false)}
            data-testid="settings-modal-hover-card"
        >
            {children}
            {visible && (
                <div className="absolute z-50 left-full top-0 ml-2 w-48 p-2 rounded border border-proxmox-border bg-proxmox-dark text-proxmox-text text-xs shadow-lg">
                    {content}
                </div>
            )}
        </div>
    );
}

// SettingsModalBreadcrumbBar: breadcrumb navigation for the active settings tab.
// 815-breadcrumb-bar-for-settings-modal: helps operators keep track of where they are in settings.
function SettingsModalBreadcrumbBar({ activeTab }) {
    const { t } = useTranslation();
    return (
        <nav className="flex items-center gap-2 text-sm text-proxmox-textMuted" data-testid="settings-modal-breadcrumb-bar">
            <span className="text-proxmox-text">{t('ProxmoxVExSettings')}</span>
            <span>/</span>
            <span className="capitalize">{activeTab}</span>
        </nav>
    );
}

// SettingsModalFilterSidebar: search field for filtering settings tabs.
// 818-filter-sidebar-for-settings-modal: lets operators quickly narrow the settings sidebar.
function SettingsModalFilterSidebar({ value, onChange }) {
    const { t } = useTranslation();
    return (
        <div className="relative mb-2" data-testid="settings-modal-filter-sidebar">
            <Icons.Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={t('filterSidebar')}
                className="w-full pl-9 pr-3 py-2 bg-proxmox-card border border-proxmox-border rounded-lg text-sm text-proxmox-text placeholder-gray-500 focus:outline-none focus:border-proxmox-orange"
            />
        </div>
    );
}

// SettingsModalKeyboardShortcuts: shows keyboard shortcut hints and closes the modal on Escape.
// 819-keyboard-shortcuts-for-settings-modal: lets operators close the settings modal and see available shortcuts.
function SettingsModalKeyboardShortcuts({ onClose }) {
    const { t } = useTranslation();
    React.useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key === 'Escape' && !e.repeat) {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);
    return (
        <div className="mt-2 pt-2 border-t border-proxmox-border text-xs text-proxmox-textMuted" data-testid="settings-modal-keyboard-shortcuts">
            <div className="font-medium text-proxmox-text mb-1">{t('keyboardShortcuts')}</div>
            <div className="flex items-center justify-between gap-2">
                <span className="px-1.5 py-0.5 bg-proxmox-hover border border-proxmox-border rounded">Esc</span>
                <span className="text-right">{t('close')}</span>
            </div>
        </div>
    );
}

// SettingsModalDragHandle: drag grip used for reordering.
// 817-drag-and-drop-reordering-for-settings-modal: enables drag-and-drop in the settings modal sidebar.
function SettingsModalDragHandle() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" data-testid="settings-modal-drag-handle">
            <circle cx="9" cy="5" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="9" cy="19" r="1.5" />
            <circle cx="15" cy="5" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="15" cy="19" r="1.5" />
        </svg>
    );
}

// SettingsModalColumnPicker: lets operators show/hide table columns.
// 816-customizable-columns-for-settings-modal: adds a column picker to the audit log.
function SettingsModalColumnPicker({ columns, visible, onToggle }) {
    const [open, setOpen] = useState(false);
    const ref = React.useRef(null);
    React.useEffect(() => {
        const onClick = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        if (open) window.addEventListener('mousedown', onClick);
        return () => window.removeEventListener('mousedown', onClick);
    }, [open]);
    return (
        <div ref={ref} className="relative inline-block" data-testid="settings-modal-column-picker">
            <button
                onClick={() => setOpen(!open)}
                className="p-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-gray-300 hover:text-white hover:border-proxmox-orange transition-colors"
                aria-label="Columns"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="5" height="18" rx="1" />
                    <rect x="10" y="3" width="5" height="18" rx="1" />
                    <rect x="17" y="3" width="5" height="18" rx="1" />
                </svg>
            </button>
            {open && (
                <div className="absolute right-0 z-50 mt-1 w-48 p-2 rounded border border-proxmox-border bg-proxmox-dark shadow-lg">
                    {columns.map((col) => (
                        <label key={col.key} className="flex items-center gap-2 p-1 text-sm text-gray-300 hover:bg-proxmox-hover rounded cursor-pointer">
                            <input
                                type="checkbox"
                                checked={visible.includes(col.key)}
                                onChange={() => onToggle(col.key)}
                                className="rounded border-gray-600 bg-gray-700"
                            />
                            {col.label}
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════
// ProxmoxVEx - Settings Modal
// ProxmoxVExSettingsModal (Server, SSL, SMTP, RBAC, Audit, Tenants)
// ═══════════════════════════════════════════════
// ProxmoxVEx Settings Modal with User Management and Audit Log
function ProxmoxVExSettingsModal({ isOpen, onClose, addToast, onGroupsChanged, page = false }) {
    const { t } = useTranslation();
    const { getAuthHeaders, user: currentUser } = useAuth();
    const { isCorporate } = useLayout(); // Corporate styling
    const [theme, setTheme] = useState(localStorage.getItem('ProxmoxVEx-theme-mode') || 'system');
    const [savingTheme, setSavingTheme] = useState(false);
    const [activeTab, setActiveTab] = useState('users');

    // 817-drag-and-drop-reordering-for-settings-modal: tabs can be reordered by the operator.
    const tabsList = [
        { id: 'users', icon: Icons.Users, label: t('userManagement') },
        { id: 'tenants', icon: Icons.Building, label: t('tenants') },
        { id: 'groups', icon: Icons.Folder, label: t('clusterGroups') },
        { id: 'permissions', icon: Icons.Key, label: t('permissions') },
        { id: 'roles', icon: Icons.Shield, label: t('roles') },
        { id: 'security', icon: Icons.Lock, label: t('securitySettings') },
        { id: 'server-access', icon: Icons.Shield, label: t('serverAccess') },
        { id: 'apiTokens', icon: Icons.Key, label: 'API Tokens' },
        { id: 'ldap', icon: Icons.Users, label: 'LDAP / AD' },
        { id: 'oidc', icon: Icons.Shield, label: 'OIDC / Entra ID' },
        { id: 'compliance', icon: Icons.Check, label: t('compliance') },
        { id: 'server', icon: Icons.Server, label: t('server') },
        { id: 'plugins', icon: Icons.Package, label: t('plugins') },
        { id: 'native', icon: Icons.Plug, label: t('nativeIntegrations') },
        { id: 'syslog', icon: Icons.FileText, label: t('syslogServer') },
        { id: 'audit', icon: Icons.ClipboardList, label: t('auditLog') },
        { id: 'siem', icon: Icons.Send, label: 'SIEM' },
        { id: 'updates', icon: Icons.Download, label: 'Updates', checkForUpdates: true },
        { id: 'licence', icon: Icons.Key, label: t('licencePageTitle') },
        { id: 'about', icon: Icons.Info, label: t('about') },
        { id: 'support', icon: Icons.LifeBuoy, label: t('support') },
    ];
    const [tabOrder, setTabOrder] = useState(tabsList.map(t => t.id));
    const [draggedTab, setDraggedTab] = useState(null);
    const [tabFilter, setTabFilter] = useState('');

    // 002-ui-dark-mode: load persisted theme from the server when the modal opens
    // and apply it to the root data-theme attribute.
    useEffect(() => {
        if (!isOpen) return;
        fetch('/api/settings', { credentials: 'include', headers: getAuthHeaders() })
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
                if (data && data.theme && ['light', 'dark', 'system'].includes(data.theme)) {
                    setTheme(data.theme);
                    if (typeof window !== 'undefined' && window.applyTheme) {
                        window.applyTheme(data.theme);
                    }
                }
            })
            .catch(() => { });
    }, [isOpen]);

    // 002-ui-dark-mode: persist the selected light/dark/system theme to the backend
    // and apply it immediately to avoid a full page reload.
    const saveTheme = async (value) => {
        setTheme(value);
        if (typeof window !== 'undefined' && window.applyTheme) {
            window.applyTheme(value);
        }
        setSavingTheme(true);
        try {
            const r = await fetch('/api/settings', {
                method: 'PUT',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme: value }),
            });
            if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                addToast?.(d.error || 'Failed to save theme', 'error');
            }
        } catch (e) {
            addToast?.('Failed to save theme', 'error');
        } finally {
            setSavingTheme(false);
        }
    };
    const [users, setUsers] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showAddUser, setShowAddUser] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [userDeleting, setUserDeleting] = useState(null);
    const [updatingUser, setUpdatingUser] = useState(null);
    const [userFilter, setUserFilter] = useState('');
    const [userFolders, setUserFolders] = useState([]);
    const [showAddFolder, setShowAddFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [folderSaving, setFolderSaving] = useState(false);
    const [userPage, setUserPage] = useState(0);
    const usersPerPage = 15;
    const [actionFilter, setActionFilter] = useState('');
    const [passwordResetUser, setPasswordResetUser] = useState(null);
    const [newPasswordValue, setNewPasswordValue] = useState('');
    const [passwordResetting, setPasswordResetting] = useState(false);
    const [disabling2FA, setDisabling2FA] = useState(null);

    // tenant state
    const [tenants, setTenants] = useState([]);
    const [showAddTenant, setShowAddTenant] = useState(false);
    const [newTenant, setNewTenant] = useState({ name: '', clusters: [], groups: [] });
    const [tenantUsage, setTenantUsage] = useState(null);  // #502 - live usage for the edit modal
    const [chargeback, setChargeback] = useState(null);  // #502b - chargeback statement data
    const [chargebackTenant, setChargebackTenant] = useState(null);  // #502b - tenant being viewed
    const [editingTenant, setEditingTenant] = useState(null);
    const [tenantSaving, setTenantSaving] = useState(false);
    const [clusters, setClusters] = useState([]);  // for tenant cluster dropdown

    // Cluster Groups state
    const [clusterGroups, setClusterGroups] = useState([]);
    const [showAddGroup, setShowAddGroup] = useState(false);
    const [newGroup, setNewGroup] = useState({ name: '', description: '', color: '#E86F2D' });
    const [editingGroup, setEditingGroup] = useState(null);
    const [renamingCluster, setRenamingCluster] = useState(null);
    const [renameValue, setRenameValue] = useState('');

    // LDAP/AD settings
    const [ldapConfig, setLdapConfig] = useState({
        ldap_enabled: false,
        ldap_server: '', ldap_port: 389,
        ldap_use_ssl: false, ldap_use_starttls: false,
        ldap_bind_dn: '', ldap_bind_password: '',
        ldap_base_dn: '',
        ldap_user_filter: '(&(objectClass=person)(sAMAccountName={username}))',
        ldap_username_attribute: 'sAMAccountName',
        ldap_email_attribute: 'mail',
        ldap_display_name_attribute: 'displayName',
        ldap_group_base_dn: '',
        ldap_group_filter: '(&(objectClass=group)(member={user_dn}))',
        ldap_admin_group: '', ldap_user_group: '', ldap_viewer_group: '',
        ldap_default_role: 'viewer',
        ldap_auto_create_users: true,
        ldap_verify_tls: false,
        ldap_group_mappings: [],  // [{group_dn, role, tenant, tenant_role, permissions}]
    });
    const [ldapTesting, setLdapTesting] = useState(false);
    const [ldapTestResult, setLdapTestResult] = useState(null);
    const [ldapTestUser, setLdapTestUser] = useState('');

    // OIDC / Entra ID state
    const [oidcConfig, setOidcConfig] = useState({
        oidc_enabled: false,
        oidc_provider: 'entra',
        oidc_cloud_environment: 'commercial',  // GCC High/DoD support
        oidc_client_id: '',
        oidc_client_secret: '',
        oidc_tenant_id: '',
        oidc_authority: '',
        oidc_scopes: 'openid profile email',
        oidc_redirect_uri: '',
        oidc_admin_group_id: '',
        oidc_user_group_id: '',
        oidc_viewer_group_id: '',
        oidc_default_role: 'viewer',
        oidc_auto_create_users: true,
        oidc_button_text: 'Sign in with Microsoft',
        oidc_group_mappings: [],
        oidc_skip_jwt_verification: false,
        oidc_skip_ssl_verify: false,
        oidc_allow_private_ip: false,   // 
        oidc_audiences: '',             // (PVE 9.2 parity)
    });
    const [oidcTesting, setOidcTesting] = useState(false);
    const [oidcTestResult, setOidcTestResult] = useState(null);

    // permissions state - This got complex fast
    const [allPermissions, setAllPermissions] = useState([]);
    const [rolePermissions, setRolePermissions] = useState({});
    const [selectedUser, setSelectedUser] = useState(null);
    const [userPermissions, setUserPermissions] = useState(null);

    // custom roles state - Dec 2025
    const [allRoles, setAllRoles] = useState([]);
    const [showAddRole, setShowAddRole] = useState(false);
    const [newRole, setNewRole] = useState({ id: '', name: '', permissions: [], tenant_id: '' });
    const [editingRole, setEditingRole] = useState(null);
    const [roleSaving, setRoleSaving] = useState(false);
    const [roleDeleting, setRoleDeleting] = useState(null);
    const [selectedTenantForPerms, setSelectedTenantForPerms] = useState('');  // for per-tenant user perms

    // Pool Permissions state
    const [permSubTab, setPermSubTab] = useState('users');  // users, vms, pools
    const [pools, setPools] = useState([]);
    const [selectedPoolCluster, setSelectedPoolCluster] = useState('');
    const [selectedPool, setSelectedPool] = useState(null);
    const [poolPermissions, setPoolPermissions] = useState([]);
    const [showPoolPermModal, setShowPoolPermModal] = useState(false);
    const [poolPermForm, setPoolPermForm] = useState({ subject_type: 'user', subject_id: '', permissions: [] });
    const [availablePoolPerms, setAvailablePoolPerms] = useState([]);

    // Pool Management state
    const [showPoolManager, setShowPoolManager] = useState(false);
    const [showCreatePool, setShowCreatePool] = useState(false);
    const [newPoolForm, setNewPoolForm] = useState({ poolid: '', comment: '' });
    const [editingPool, setEditingPool] = useState(null);
    const [poolManagerLoading, setPoolManagerLoading] = useState(false);
    const [vmsWithoutPool, setVmsWithoutPool] = useState([]);
    const [showAddVmToPool, setShowAddVmToPool] = useState(null); // pool_id when open

    const [filterDate, setFilterDate] = useState('');
    const [snapshotsSubTab, setSnapshotsTab] = useState('overview');
    const [snapshots, setSnapshots] = useState([]);

    // Server settings state
    const [serverSettings, setServerSettings] = useState({
        domain: '',
        port: 5000,
        http_redirect_port: 0,  // 0=auto, -1=disabled, >0=specific port
        ssl_enabled: false,
        ssl_cert: '',
        ssl_key: '',
        ssl_cert_file: null,
        ssl_key_file: null,
        acme_enabled: false,
        acme_provider: 'letsencrypt',
        acme_email: '',
        acme_staging: false,
        acme_challenge_type: 'http-01',
        acme_dns_provider: 'manual',
        acme_dns_rfc2136_nameserver: '',
        acme_dns_rfc2136_port: 53,
        acme_dns_rfc2136_zone: '',
        acme_dns_rfc2136_key_name: '',
        acme_dns_rfc2136_secret: '',
        acme_dns_rfc2136_algorithm: 'hmac-sha512',
        acme_dns_rfc2136_ttl: 60,
        acme_dns_propagation_seconds: 30,
        acme_directory_url: '',
        cert_info: null,
        reverse_proxy_enabled: false,
        // Compliance / hardened-environment settings
        audit_retention_days: 90,
        air_gap_mode: false,
        trusted_proxies: '',
        proxy_bind_address: '',
        logo_url: '',
        app_name: 'ProxmoxVEx',
        default_theme: 'proxmoxDark',  // Default theme for new users
        login_background: '',
        // SMTP Settings
        smtp_enabled: false,
        smtp_host: '',
        smtp_port: 587,
        smtp_user: '',
        smtp_password: '',
        smtp_from_email: '',
        smtp_from_name: 'ProxmoxVEx Alerts',
        smtp_tls: true,
        smtp_ssl: false,
        alert_email_recipients: [],
        alert_cooldown: 300,
        alert_update_available: false,
        syslog_filter_by_selected_cluster: false,
        syslog_enabled: true,
    });
    const [serverLoading, setServerLoading] = useState(false);
    const [userTheme, setUserTheme] = useState('system');
    const [userThemeLoading, setUserThemeLoading] = useState(false);
    const [showRestartConfirm, setShowRestartConfirm] = useState(false);
    const [restartLoading, setRestartLoading] = useState(false);
    const [testEmailLoading, setTestEmailLoading] = useState(false);
    // ACME state
    const [acmeLoading, setAcmeLoading] = useState(false);
    const [acmeResult, setAcmeResult] = useState(null);
    const [testEmailAddress, setTestEmailAddress] = useState('');
    const [loginBgFile, setLoginBgFile] = useState(null);
    const [loginBgError, setLoginBgError] = useState(null);
    const [discoveredPlugins, setDiscoveredPlugins] = useState([]);
    const [togglingPlugin, setTogglingPlugin] = useState(null); // plugin id currently being enabled/disabled
    const [deletingPlugin, setDeletingPlugin] = useState(null); // plugin id currently being deleted
    const [savingPluginConfig, setSavingPluginConfig] = useState(false);
    const [editingPluginConfig, setEditingPluginConfig] = useState(null); // {id, name, config}
    const [nativeIntegrationConfig, setNativeIntegrationConfig] = useState(null); // module id string

    // Password policy state
    const [passwordPolicy, setPasswordPolicy] = useState({
        min_length: 8,
        require_uppercase: true,
        require_lowercase: true,
        require_numbers: true,
        require_special: false
    });

    // update checker
    const [updateInfo, setUpdateInfo] = useState(null);
    const [updateLoading, setUpdateLoading] = useState(false);
    const [updateError, setUpdateError] = useState(null);
    const [updateProgress, setUpdateProgress] = useState(null); // { status, message }
    const [updateFeed, setUpdateFeed] = useState([]); // live log entries from the update worker
    const updateEventSourceRef = React.useRef(null);
    const [availableBackups, setAvailableBackups] = useState([]);
    const [updateRolloutFilter, setUpdateRolloutFilter] = useState(''); // 933-quick-filter-for-update-rollout
    const [showRollbackModal, setShowRollbackModal] = useState(false);
    const [updateRolloutMenu, setUpdateRolloutMenu] = useState(null); // { x, y, items } for 930
    const [updateRecentItems, setUpdateRecentItems] = useState(() => {
        // 931-recent-items-for-update-rollout: load history from localStorage
        try {
            const saved = localStorage.getItem('proxmoxVEx_updateRollout_recent');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            return [];
        }
    });
    const [updateRolloutUndo, setUpdateRolloutUndo] = useState(null); // 932-undo-action-for-update-rollout

    // 933-quick-filter-for-update-rollout: narrow the rollback list by backup name
    const filteredBackups = React.useMemo(() => {
        const q = (updateRolloutFilter || '').toLowerCase().trim();
        if (!q) return availableBackups;
        return availableBackups.filter(backup =>
            (backup.name || '').toLowerCase().includes(q) ||
            (backup.files || []).some(f => (f || '').toLowerCase().includes(q))
        );
    }, [availableBackups, updateRolloutFilter]);

    // Close the update SSE feed if the settings modal unmounts mid-update
    React.useEffect(() => {
        return () => {
            if (updateEventSourceRef.current) {
                updateEventSourceRef.current.close();
                updateEventSourceRef.current = null;
            }
        };
    }, []);

    // New user form - Added tenant_id for multi-tenant support
    const [newUser, setNewUser] = useState({
        username: '',
        password: '',
        display_name: '',
        email: '',
        role: 'user',
        tenant_id: 'default',
        portal_only: false
    });

    useEffect(() => {
        if (isOpen) {
            fetchUsers();
            fetchAuditLogs();
            fetchServerSettings();
            fetchUserTheme();
            fetchPlugins();
            fetchTenants();
            fetchPermissions();
            fetchClusters();
            fetchClusterGroups();
            fetchRoles();
            fetchTemplates();
            fetchPasswordPolicy();
        }
    }, [isOpen]);

    // Listen for navigate-to-updates event from update notification modal
    useEffect(() => {
        const handleNavigateUpdates = () => {
            setActiveTab('updates');
            checkForUpdates();
        };
        window.addEventListener('ProxmoxVEx-navigate-updates', handleNavigateUpdates);
        return () => window.removeEventListener('ProxmoxVEx-navigate-updates', handleNavigateUpdates);
    }, []);

    // Fetch password policy
    const fetchPasswordPolicy = async () => {
        try {
            const r = await fetch(`${API_URL}/password-policy`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) {
                const data = await r.json();
                setPasswordPolicy(data);
            }
        } catch (e) {
            console.error('fetchPasswordPolicy error:', e);
        }
    };

    // Generate password policy hint from fetched policy
    const getSettingsPasswordPolicyHint = () => {
        const hints = [];
        hints.push(`${t('minChars')} ${passwordPolicy.min_length || 8} ${t('characters')}`);
        if (passwordPolicy.require_uppercase !== false) hints.push(t('uppercase'));
        if (passwordPolicy.require_lowercase !== false) hints.push(t('lowercase'));
        if (passwordPolicy.require_numbers !== false) hints.push(t('numbers'));
        if (passwordPolicy.require_special) hints.push(t('specialChar'));
        return hints.join(', ');
    };

    // fetch tenants - Added error logging after it silently failed once during testing
    const fetchTenants = async () => {
        try {
            const r = await fetch(`${API_URL}/tenants`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) setTenants(await r.json());
            else console.warn('Failed to fetch tenants:', r.status);
        } catch (e) { console.error('fetchTenants error:', e); }
    };

    // fetch clusters for tenant assignment
    const fetchClusters = async () => {
        try {
            const r = await fetch(`${API_URL}/clusters`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) setClusters(await r.json());
        } catch (e) { }
    };

    // fetch cluster groups
    const fetchClusterGroups = async () => {
        try {
            const r = await fetch(`${API_URL}/cluster-groups`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) setClusterGroups(await r.json());
        } catch (e) { console.error('fetchClusterGroups error:', e); }
    };

    // rename cluster - Mar 2026
    const handleRenameCluster = async () => {
        if (!renamingCluster) return;
        const newName = renameValue.trim();
        const confirmMsg = newName
            ? `${t('confirmRename')} "${newName}"?`
            : `${t('confirmResetName')}?`;
        if (!confirm(confirmMsg)) return;
        try {
            const r = await fetch(`${API_URL}/clusters/${renamingCluster.id}/rename`, {
                method: 'PUT',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ display_name: newName })
            });
            if (r.ok) {
                addToast(newName ? `Cluster renamed to "${newName}"` : 'Cluster name reset', 'success');
                setRenamingCluster(null);
                fetchClusters();
                onGroupsChanged?.();
            } else {
                const err = await r.json().catch(() => ({}));
                addToast(err.error || 'Rename failed', 'error');
            }
        } catch (e) { addToast('Rename failed', 'error'); }
    };

    // fetch all roles (builtin + custom)
    const fetchRoles = async () => {
        try {
            const r = await fetch(`${API_URL}/roles`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) setAllRoles(await r.json());
        } catch (e) { }
    };

    // check for updates on component mount
    const checkForUpdates = async () => {
        setUpdateLoading(true);
        setUpdateError(null);
        try {
            const r = await fetch(`${API_URL}/ProxmoxVEx/check-update`, { credentials: 'include', headers: getAuthHeaders() });
            const data = await r.json();
            setUpdateInfo(data);
            addUpdateRolloutRecentItem('check', t('checkForUpdates'), { version: data.latest_version || data.current_version });
            // Show error if present but still have version info
            if (data.error) {
                setUpdateError(data.error);
            }
        } catch (e) {
            setUpdateError('Network error checking for updates');
        } finally {
            setUpdateLoading(false);
        }
    };

    // Perform update
    const performUpdate = async () => {
        if (!confirm(t('confirmUpdate'))) return;
        addUpdateRolloutRecentItem('install', t('installUpdate'), { version: updateInfo?.latest_version });
        setUpdateLoading(true);
        setUpdateError(null);
        setUpdateFeed([]);
        setUpdateProgress({ status: 'starting', message: 'Starting update...' });
        try {
            const r = await fetch(`${API_URL}/ProxmoxVEx/update`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await r.json();
            if (!r.ok || !data.job_id) {
                throw new Error(data.error || 'Update request failed');
            }
            const jobId = data.job_id;

            const feedUrl = `${API_URL}/ProxmoxVEx/update/feed?job_id=${encodeURIComponent(jobId)}`;
            if (updateEventSourceRef.current) {
                updateEventSourceRef.current.close();
            }
            const es = new EventSource(feedUrl, { withCredentials: true });
            updateEventSourceRef.current = es;

            es.onmessage = (event) => {
                try {
                    const d = JSON.parse(event.data);
                    setUpdateFeed(prev => [...(prev || []), d]);
                    if (d.step === 'status' || d.step === 'done' || d.step === 'error') {
                        setUpdateProgress({ status: (d.extra && d.extra.status) || d.step, message: d.message });
                    }
                    if (d.step === 'done' || d.step === 'error') {
                        es.close();
                        updateEventSourceRef.current = null;
                        setUpdateLoading(false);
                        if (d.step === 'done' && d.extra && d.extra.restarting) {
                            addToast(t('updateSuccessRestarting'), 'success');
                            setTimeout(() => {
                                setUpdateProgress({ status: 'reconnecting', message: t('reconnecting') });
                                // Poll until server is back
                                const pollInterval = setInterval(async () => {
                                    try {
                                        const healthCheck = await fetch(`${API_URL}/ProxmoxVEx/version`, {
                                            credentials: 'include',
                                            headers: getAuthHeaders()
                                        });
                                        if (healthCheck.ok) {
                                            clearInterval(pollInterval);
                                            setUpdateProgress(null);
                                            addToast(t('updateComplete'), 'success');
                                            // Refresh page after short delay
                                            setTimeout(() => window.location.reload(), 2000);
                                        }
                                    } catch (e) {
                                        // Server still restarting
                                    }
                                }, 2000);

                                // Stop polling after 60 seconds
                                setTimeout(() => clearInterval(pollInterval), 60000);
                            }, (d.extra.restart_delay || 3) * 1000 + 2000);
                        } else if (d.step === 'done') {
                            addToast(t('updatePrepared'), 'success');
                            setUpdateInfo(prev => ({ ...prev, instructions: d.extra && d.extra.instructions, backup_path: d.extra && d.extra.backup_path }));
                            setUpdateProgress(null);
                            // 932-undo-action-for-update-rollout: remember the install so it can be rolled back
                            setUpdateRolloutUndo({
                                type: 'install',
                                label: t('installUpdate'),
                                version: updateInfo?.latest_version,
                                backup: d.extra && d.extra.backup_path,
                                canUndo: true
                            });
                        } else {
                            addToast((d.extra && d.extra.error) || t('updateFailed'), 'error');
                            setUpdateProgress(null);
                        }
                    }
                } catch (e) {
                    console.error('update feed parse error:', e);
                }
            };

            es.onerror = (e) => {
                // A closed feed usually means the server is restarting.
                console.error('update feed error:', e);
            };
        } catch (e) {
            addToast(t('errorPerformingUpdate'), 'error');
            setUpdateProgress(null);
            setUpdateLoading(false);
        }
    };

    // Load available backups for rollback
    const loadBackups = async () => {
        try {
            const r = await fetch(`${API_URL}/ProxmoxVEx/update/rollback`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await r.json();
            if (data.backups) {
                setAvailableBackups(data.backups);
            }
        } catch (e) {
            console.error('Error loading backups:', e);
        }
    };

    // Perform rollback
    const performRollback = async (backupName, skipConfirm = false) => {
        if (!skipConfirm && !confirm(t('confirmRollback') || `This will restore ProxmoxVEx from backup "${backupName}". The server will restart. Continue?`)) return;
        addUpdateRolloutRecentItem('rollback', t('rollback'), { backup: backupName });
        setUpdateLoading(true);
        setUpdateProgress({ status: 'restoring', message: t('restoringBackup') });
        try {
            const r = await fetch(`${API_URL}/ProxmoxVEx/update/rollback`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ backup: backupName })
            });
            const data = await r.json();
            if (r.ok && data.success) {
                setShowRollbackModal(false);
                addToast(t('rollbackSuccess'), 'success');
                setUpdateProgress({ status: 'restarting', message: t('serverRestarting') });
                // 932-undo-action-for-update-rollout: after rollback, offer to re-apply the update
                setUpdateRolloutUndo({
                    type: 'rollback',
                    label: t('rollback'),
                    version: updateInfo?.latest_version,
                    canUndo: !!updateInfo?.latest_version
                });

                // Poll for reconnection
                setTimeout(() => {
                    const pollInterval = setInterval(async () => {
                        try {
                            const healthCheck = await fetch(`${API_URL}/ProxmoxVEx/version`, {
                                credentials: 'include',
                                headers: getAuthHeaders()
                            });
                            if (healthCheck.ok) {
                                clearInterval(pollInterval);
                                setUpdateProgress(null);
                                setTimeout(() => window.location.reload(), 2000);
                            }
                        } catch (e) { }
                    }, 2000);
                    setTimeout(() => clearInterval(pollInterval), 60000);
                }, 5000);
            } else {
                addToast(data.error || t('rollbackFailed'), 'error');
                setUpdateProgress(null);
            }
        } catch (e) {
            addToast(t('errorRollback'), 'error');
            setUpdateProgress(null);
        } finally {
            setUpdateLoading(false);
        }
    };

    // 931-recent-items-for-update-rollout: record an action in the recent list.
    const addUpdateRolloutRecentItem = (action, label, meta = {}) => {
        try {
            setUpdateRecentItems((prev) => {
                const entry = { id: `${action}-${Date.now()}`, action, label, meta, timestamp: Date.now() };
                const next = [entry, ...prev.filter((i) => !(i.action === action && i.label === label && i.meta?.version === meta?.version))].slice(0, 10);
                localStorage.setItem('proxmoxVEx_updateRollout_recent', JSON.stringify(next));
                return next;
            });
        } catch (e) {
            console.error('Failed to save update rollout recent item:', e);
        }
    };

    // 930-context-menu-for-update-rollout: dispatch the selected rollout action.
    const handleUpdateRolloutMenuAction = (item) => {
        if (!item) return;
        if (item.id === 'check') checkForUpdates();
        else if (item.id === 'install') performUpdate();
        else if (item.id === 'backups') { addUpdateRolloutRecentItem('backups', t('viewBackups')); loadBackups(); setShowRollbackModal(true); }
        else if (item.id === 'github' && updateInfo?.download_url) { addUpdateRolloutRecentItem('github', t('openGitHubRelease'), { url: updateInfo.download_url }); window.open(updateInfo.download_url, '_blank'); }
    };

    // 931-recent-items-for-update-rollout: clear the recent item history.
    const clearUpdateRolloutRecentItems = () => {
        setUpdateRecentItems([]);
        try { localStorage.removeItem('proxmoxVEx_updateRollout_recent'); } catch { /* ignore */ }
    };

    // 931-recent-items-for-update-rollout: re-run a stored rollout action.
    const handleUpdateRolloutRecentItemClick = (item) => {
        if (!item) return;
        if (item.action === 'check') checkForUpdates();
        else if (item.action === 'install') performUpdate();
        else if (item.action === 'backups') { addUpdateRolloutRecentItem('backups', t('viewBackups')); loadBackups(); setShowRollbackModal(true); }
        else if (item.action === 'github' && (item.meta?.url || updateInfo?.download_url)) { const url = item.meta?.url || updateInfo?.download_url; addUpdateRolloutRecentItem('github', t('openGitHubRelease'), { url }); window.open(url, '_blank'); }
    };

    // 932-undo-action-for-update-rollout: reverse the last rollout action.
    const handleUpdateRolloutUndo = (item) => {
        if (!item || !item.canUndo) return;
        setUpdateRolloutUndo(null);
        if (item.type === 'install' && item.backup) {
            performRollback(item.backup, true);
        } else if (item.type === 'rollback') {
            performUpdate();
        }
    };

    // create custom role
    const handleCreateRole = async (e) => {
        e && e.preventDefault();
        setRoleSaving(true);
        try {
            const r = await fetch(`${API_URL}/roles`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(newRole)
            });
            if (r.ok) {
                setShowAddRole(false);
                setNewRole({ id: '', name: '', permissions: [], tenant_id: '' });
                fetchRoles();
                addToast(t('roleCreated'), 'success');
            } else {
                const err = await r.json();
                addToast(err.error || 'Failed', 'error');
            }
        } catch (e) { addToast('Error creating role', 'error'); }
        finally { setRoleSaving(false); }
    };

    // update custom role
    const handleUpdateRole = async (roleId, data) => {
        ProxmoxVExLog.debug('[ROLE] Saving role:', roleId, data);
        try {
            const r = await fetch(`${API_URL}/roles/${roleId}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            ProxmoxVExLog.debug('[ROLE] Response:', r.status, r.statusText);
            if (r.ok) {
                setEditingRole(null);
                fetchRoles();
                addToast(t('roleSaved'), 'success');
            } else {
                const err = await r.json().catch(() => ({}));
                ProxmoxVExLog.debug('[ROLE] Error response:', err);
                addToast(err.error || `Failed to update role (${r.status})`, 'error');
            }
        } catch (e) {
            console.error('[ROLE] Network error:', e);
            addToast('Network error: ' + e.message, 'error');
        }
    };

    // delete custom role
    const handleDeleteRole = async (roleId, tenantId) => {
        if (!confirm(t('confirmDeleteRole'))) return;
        setRoleDeleting(roleId);
        try {
            let url = `${API_URL}/roles/${roleId}`;
            if (tenantId) url += `?tenant_id=${tenantId}`;
            const r = await fetch(url, { method: 'DELETE', headers: getAuthHeaders() });
            if (r.ok) {
                fetchRoles();
                addToast(t('roleDeleted'), 'success');
            } else {
                const err = await r.json().catch(() => ({}));
                addToast(err.error || t('error'), 'error');
            }
        } catch (e) { addToast(t('error'), 'error'); }
        finally { setRoleDeleting(null); }
    };


    // role templates state
    const [roleTemplates, setRoleTemplates] = useState([]);
    const [showTemplateModal, setShowTemplateModal] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [templateConfig, setTemplateConfig] = useState({ role_id: '', name: '', tenant_id: '' });

    // fetch role templates
    const fetchTemplates = async () => {
        try {
            const r = await fetch(`${API_URL}/roles/templates`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) setRoleTemplates(await r.json());
        } catch (e) { }
    };

    // apply template
    const handleApplyTemplate = async () => {
        if (!selectedTemplate) return;
        try {
            const r = await fetch(`${API_URL}/roles/templates/${selectedTemplate.id}/apply`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(templateConfig)
            });
            if (r.ok) {
                setShowTemplateModal(false);
                setSelectedTemplate(null);
                setTemplateConfig({ role_id: '', name: '', tenant_id: '' });
                fetchRoles();
                addToast(t('roleCreatedFromTemplate'), 'success');
            } else {
                const err = await r.json();
                addToast(err.error || 'Failed', 'error');
            }
        } catch (e) { addToast('Error', 'error'); }
    };

    // VM ACL state - Dec 2025
    const [vmAcls, setVmAcls] = useState([]);
    const [selectedVmForAcl, setSelectedVmForAcl] = useState(null);
    const [showVmAclModal, setShowVmAclModal] = useState(false);
    const [vmAclUsers, setVmAclUsers] = useState([]);
    const [vmAclPerms, setVmAclPerms] = useState([]);
    const [vmAclInherit, setVmAclInherit] = useState(true);
    const [availableVms, setAvailableVms] = useState([]);
    const [selectedClusterForAcl, setSelectedClusterForAcl] = useState('');

    // fetch VMs for ACL management - Dec 2025
    const fetchVmsForAcl = async (clusterId) => {
        if (!clusterId) return;
        try {
            const r = await fetch(`${API_URL}/clusters/${clusterId}/vms`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) {
                const data = await r.json();
                setAvailableVms(data.vms || []);
            }
        } catch (e) { /* silently fail, user will see empty list */ }
    };

    // fetch VM ACLs for a cluster
    const fetchVmAcls = async (clusterId) => {
        if (!clusterId) return;
        try {
            const r = await fetch(`${API_URL}/clusters/${clusterId}/vm-acls`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) setVmAcls(await r.json());
        } catch (e) { }
    };

    // save VM ACL
    const saveVmAcl = async () => {
        if (!selectedClusterForAcl || !selectedVmForAcl) return;
        try {
            const r = await fetch(`${API_URL}/clusters/${selectedClusterForAcl}/vm-acls/${selectedVmForAcl}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    users: vmAclUsers,
                    permissions: vmAclPerms,
                    inherit_role: vmAclInherit
                })
            });
            if (r.ok) {
                setShowVmAclModal(false);
                fetchVmAcls(selectedClusterForAcl);
                addToast(t('vmAclSaved'), 'success');
            }
        } catch (e) { addToast('Error', 'error'); }
    };

    // delete VM ACL
    const deleteVmAcl = async (vmid) => {
        if (!selectedClusterForAcl) return;
        if (!confirm(t('confirmDeleteVmAcl'))) return;
        try {
            const r = await fetch(`${API_URL}/clusters/${selectedClusterForAcl}/vm-acls/${vmid}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (r.ok) {
                fetchVmAcls(selectedClusterForAcl);
                addToast(t('vmAclDeleted'), 'success');
            }
        } catch (e) { }
    };

    // Pool Permissions functions
    const fetchPools = async (clusterId) => {
        if (!clusterId) return;
        try {
            const r = await fetch(`${API_URL}/clusters/${clusterId}/pools`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (r.ok) {
                const data = await r.json();
                setPools(data);
            }
        } catch (e) {
            console.error('Failed to fetch pools:', e);
        }
    };

    const fetchPoolPermissions = async (clusterId, poolId) => {
        if (!clusterId || !poolId) return;
        try {
            const r = await fetch(`${API_URL}/clusters/${clusterId}/pools/${poolId}/permissions`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (r.ok) {
                const data = await r.json();
                setPoolPermissions(data.permissions || []);
                setAvailablePoolPerms(data.available_permissions || []);
            }
        } catch (e) {
            console.error('Failed to fetch pool permissions:', e);
        }
    };

    const savePoolPermission = async () => {
        if (!selectedPoolCluster || !selectedPool || !poolPermForm.subject_id) return;
        try {
            const r = await fetch(`${API_URL}/clusters/${selectedPoolCluster}/pools/${selectedPool}/permissions`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(poolPermForm)
            });
            if (r.ok) {
                setShowPoolPermModal(false);
                fetchPoolPermissions(selectedPoolCluster, selectedPool);
                addToast(t('poolPermSaved'), 'success');
                setPoolPermForm({ subject_type: 'user', subject_id: '', permissions: [] });
            } else {
                const err = await r.json();
                addToast(err.error || 'Error saving permission', 'error');
            }
        } catch (e) {
            addToast('Error saving permission', 'error');
        }
    };

    const deletePoolPermission = async (subjectType, subjectId) => {
        if (!selectedPoolCluster || !selectedPool) return;
        if (!confirm(t('confirmDeletePoolPerm') || `Remove permission for ${subjectId}?`)) return;
        try {
            const r = await fetch(`${API_URL}/clusters/${selectedPoolCluster}/pools/${selectedPool}/permissions/${subjectType}/${subjectId}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (r.ok) {
                fetchPoolPermissions(selectedPoolCluster, selectedPool);
                addToast(t('poolPermDeleted'), 'success');
            }
        } catch (e) { }
    };

    // Refresh pool cache from Proxmox
    const refreshPoolCache = async (clusterId) => {
        if (!clusterId) return;
        try {
            const r = await fetch(`${API_URL}/clusters/${clusterId}/pools/refresh-cache`, {
                method: 'POST',
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (r.ok) {
                const data = await r.json();
                addToast(data.message || 'Pool cache refreshed', 'success');
                // Refresh pools list
                fetchPools(clusterId);
            } else {
                addToast('Failed to refresh pool cache', 'error');
            }
        } catch (e) {
            addToast('Failed to refresh pool cache', 'error');
        }
    };

    // ================================================================
    // Pool Management Functions
    // ================================================================

    const createPool = async () => {
        if (!selectedPoolCluster || !newPoolForm.poolid.trim()) {
            addToast(t('poolIdRequired'), 'error');
            return;
        }

        setPoolManagerLoading(true);
        try {
            const r = await fetch(`${API_URL}/clusters/${selectedPoolCluster}/pools`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    poolid: newPoolForm.poolid.trim(),
                    comment: newPoolForm.comment.trim()
                })
            });

            const data = await r.json();
            if (r.ok) {
                addToast(data.message || t('poolCreated'), 'success');
                setShowCreatePool(false);
                setNewPoolForm({ poolid: '', comment: '' });
                // Small delay to let Proxmox process the change
                setTimeout(() => fetchPools(selectedPoolCluster), 300);
            } else {
                addToast(data.error || 'Failed to create pool', 'error');
            }
        } catch (e) {
            addToast('Failed to create pool', 'error');
        } finally {
            setPoolManagerLoading(false);
        }
    };

    const updatePool = async () => {
        if (!selectedPoolCluster || !editingPool) return;

        setPoolManagerLoading(true);
        try {
            const r = await fetch(`${API_URL}/clusters/${selectedPoolCluster}/pools/${editingPool.poolid}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    comment: editingPool.comment || ''
                })
            });

            const data = await r.json();
            if (r.ok) {
                addToast(data.message || t('poolUpdated'), 'success');
                setEditingPool(null);
                setTimeout(() => fetchPools(selectedPoolCluster), 300);
            } else {
                addToast(data.error || 'Failed to update pool', 'error');
            }
        } catch (e) {
            addToast('Failed to update pool', 'error');
        } finally {
            setPoolManagerLoading(false);
        }
    };

    const deletePool = async (poolId) => {
        if (!selectedPoolCluster || !poolId) return;
        if (!confirm(t('confirmDeletePool') || `Are you sure you want to delete pool "${poolId}"? This cannot be undone.`)) return;

        setPoolManagerLoading(true);
        try {
            const r = await fetch(`${API_URL}/clusters/${selectedPoolCluster}/pools/${poolId}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: getAuthHeaders()
            });

            const data = await r.json();
            if (r.ok) {
                addToast(data.message || t('poolDeleted'), 'success');
                if (selectedPool === poolId) {
                    setSelectedPool(null);
                    setPoolPermissions([]);
                }
                setTimeout(() => fetchPools(selectedPoolCluster), 300);
            } else {
                addToast(data.error || 'Failed to delete pool', 'error');
            }
        } catch (e) {
            addToast('Failed to delete pool', 'error');
        } finally {
            setPoolManagerLoading(false);
        }
    };

    const fetchVmsWithoutPool = async (clusterId) => {
        if (!clusterId) return;
        try {
            const r = await fetch(`${API_URL}/clusters/${clusterId}/vms-without-pool`, {
                credentials: 'include', headers: getAuthHeaders()
            });
            if (r.ok) {
                const data = await r.json();
                setVmsWithoutPool(data);
            }
        } catch (e) {
            console.error('Failed to fetch VMs without pool:', e);
        }
    };

    const addVmToPool = async (poolId, vmid) => {
        if (!selectedPoolCluster || !poolId || !vmid) return;

        setPoolManagerLoading(true);
        try {
            const r = await fetch(`${API_URL}/clusters/${selectedPoolCluster}/pools/${poolId}/members`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ vmid: vmid })
            });

            const data = await r.json();
            if (r.ok) {
                addToast(data.message || t('vmAddedToPool'), 'success');
                setTimeout(() => {
                    fetchPools(selectedPoolCluster);
                    fetchVmsWithoutPool(selectedPoolCluster);
                }, 300);
            } else {
                addToast(data.error || 'Failed to add VM to pool', 'error');
            }
        } catch (e) {
            addToast('Failed to add VM to pool', 'error');
        } finally {
            setPoolManagerLoading(false);
        }
    };

    const removeVmFromPool = async (poolId, vmid) => {
        if (!selectedPoolCluster || !poolId || !vmid) return;
        if (!confirm(t('confirmRemoveVmFromPool') || `Remove VM ${vmid} from pool "${poolId}"?`)) return;

        setPoolManagerLoading(true);
        try {
            const r = await fetch(`${API_URL}/clusters/${selectedPoolCluster}/pools/${poolId}/members/${vmid}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: getAuthHeaders()
            });

            const data = await r.json();
            if (r.ok) {
                addToast(data.message || t('vmRemovedFromPool'), 'success');
                setTimeout(() => fetchPools(selectedPoolCluster), 300);
            } else {
                addToast(data.error || 'Failed to remove VM from pool', 'error');
            }
        } catch (e) {
            addToast('Failed to remove VM from pool', 'error');
        } finally {
            setPoolManagerLoading(false);
        }
    };

    // fetch all permissions
    const fetchPermissions = async () => {
        try {
            const [permsRes, rolesRes] = await Promise.all([
                fetch(`${API_URL}/permissions`, { credentials: 'include', headers: getAuthHeaders() }),
                fetch(`${API_URL}/permissions/roles`, { credentials: 'include', headers: getAuthHeaders() })
            ]);
            if (permsRes.ok) setAllPermissions(await permsRes.json());
            if (rolesRes.ok) setRolePermissions(await rolesRes.json());
        } catch (e) { }
    };

    // fetch user permissions
    const fetchUserPermissions = async (username) => {
        try {
            const r = await fetch(`${API_URL}/users/${username}/permissions`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) setUserPermissions(await r.json());
        } catch (e) { }
    };

    const fetchServerSettings = async () => {
        try {
            const response = await fetch(`${API_URL}/settings/server`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (response && response.ok) {
                const data = await response.json();
                const acmeCertificate = data.acme_certificate || {};
                const acmeDnsConfig = acmeCertificate.dns_config || {};
                setServerSettings(prev => ({
                    ...prev,
                    // Server settings
                    domain: data.domain || '',
                    port: data.port || 5000,
                    ssl_enabled: data.ssl_enabled || false,
                    // (#354) - placeholders were hardcoded in German;
                    // surfaced on English UIs too. Wrap in t() with English fallback.
                    ssl_cert: data.ssl_cert_exists ? (t('certPresentPlaceholder')) : '',
                    ssl_key: data.ssl_key_exists ? (t('keyPresentPlaceholder')) : '',
                    acme_enabled: data.acme_enabled || false,
                    acme_provider: acmeCertificate.provider || data.acme_provider || 'letsencrypt',
                    acme_email: acmeCertificate.email || data.acme_email || '',
                    acme_directory_url: acmeCertificate.directory_url || data.acme_directory_url || '',
                    acme_staging: acmeCertificate.staging ?? data.acme_staging ?? false,
                    acme_challenge_type: acmeCertificate.challenge_type || data.acme_challenge_type || 'http-01',
                    acme_dns_provider: acmeCertificate.dns_provider || data.acme_dns_provider || 'manual',
                    acme_dns_rfc2136_nameserver: acmeDnsConfig.nameserver || data.acme_dns_rfc2136_nameserver || '',
                    acme_dns_rfc2136_port: acmeDnsConfig.port || data.acme_dns_rfc2136_port || 53,
                    acme_dns_rfc2136_zone: acmeDnsConfig.zone || data.acme_dns_rfc2136_zone || '',
                    acme_dns_rfc2136_key_name: acmeDnsConfig.key_name || data.acme_dns_rfc2136_key_name || '',
                    acme_dns_rfc2136_secret: acmeDnsConfig.secret || data.acme_dns_rfc2136_secret || '',
                    acme_dns_rfc2136_algorithm: acmeDnsConfig.algorithm || data.acme_dns_rfc2136_algorithm || 'hmac-sha512',
                    acme_dns_rfc2136_ttl: acmeDnsConfig.ttl || data.acme_dns_rfc2136_ttl || 60,
                    acme_dns_propagation_seconds: acmeDnsConfig.propagation_seconds || data.acme_dns_propagation_seconds || 30,
                    cert_info: data.cert_info || null,
                    http_redirect_port: data.http_redirect_port || 0,
                    reverse_proxy_enabled: data.reverse_proxy_enabled || false,
                    audit_retention_days: data.audit_retention_days || 90,
                    air_gap_mode: data.air_gap_mode || false,
                    trusted_proxies: data.trusted_proxies || '',
                    proxy_bind_address: data.proxy_bind_address || '',
                    default_theme: data.default_theme || 'proxmoxDark',
                    login_background: data.login_background || '',
                    // SMTP settings
                    smtp_enabled: data.smtp_enabled || false,
                    smtp_host: data.smtp_host || '',
                    smtp_port: data.smtp_port || 587,
                    smtp_user: data.smtp_user || '',
                    smtp_password: data.smtp_password || '',
                    smtp_from_email: data.smtp_from_email || '',
                    smtp_from_name: data.smtp_from_name || 'ProxmoxVEx Alerts',
                    smtp_tls: data.smtp_tls !== false,
                    smtp_ssl: data.smtp_ssl || false,
                    // Alert settings
                    alert_email_recipients: data.alert_email_recipients || [],
                    alert_cooldown: data.alert_cooldown || 300,
                    alert_update_available: !!data.alert_update_available,
                    syslog_filter_by_selected_cluster: !!data.syslog_filter_by_selected_cluster,
                    syslog_enabled: data.syslog_enabled !== false,  // default on
                    // Security settings
                    login_max_attempts: data.login_max_attempts || 5,
                    login_lockout_time: data.login_lockout_time || 300,
                    login_attempt_window: data.login_attempt_window || 300,
                    // Password policy
                    password_min_length: data.password_min_length || 8,
                    password_require_uppercase: data.password_require_uppercase || false,
                    password_require_lowercase: data.password_require_lowercase || false,
                    password_require_numbers: data.password_require_numbers || false,
                    password_require_special: data.password_require_special || false,
                    // Password expiry
                    password_expiry_enabled: data.password_expiry_enabled || false,
                    password_expiry_days: data.password_expiry_days || 90,
                    password_expiry_warning_days: data.password_expiry_warning_days || 14,
                    password_expiry_email_enabled: data.password_expiry_email_enabled !== false,
                    password_expiry_include_admins: data.password_expiry_include_admins || false,
                    force_2fa: data.force_2fa || false,
                    force_2fa_exclude_admins: data.force_2fa_exclude_admins || false,
                    // Session
                    session_timeout: data.session_timeout || 86400
                }));
                // Load LDAP settings
                setLdapConfig(prev => ({
                    ...prev,
                    ldap_enabled: data.ldap_enabled || false,
                    ldap_server: data.ldap_server || '',
                    ldap_port: data.ldap_port || 389,
                    ldap_use_ssl: data.ldap_use_ssl || false,
                    ldap_use_starttls: data.ldap_use_starttls || false,
                    ldap_bind_dn: data.ldap_bind_dn || '',
                    ldap_bind_password: data.ldap_bind_password ? '********' : '',
                    ldap_base_dn: data.ldap_base_dn || '',
                    ldap_user_filter: data.ldap_user_filter || '(&(objectClass=person)(sAMAccountName={username}))',
                    ldap_username_attribute: data.ldap_username_attribute || 'sAMAccountName',
                    ldap_email_attribute: data.ldap_email_attribute || 'mail',
                    ldap_display_name_attribute: data.ldap_display_name_attribute || 'displayName',
                    ldap_group_base_dn: data.ldap_group_base_dn || '',
                    ldap_group_filter: data.ldap_group_filter || '(&(objectClass=group)(member={user_dn}))',
                    ldap_admin_group: data.ldap_admin_group || '',
                    ldap_user_group: data.ldap_user_group || '',
                    ldap_viewer_group: data.ldap_viewer_group || '',
                    ldap_default_role: data.ldap_default_role || 'viewer',
                    ldap_auto_create_users: data.ldap_auto_create_users !== false,
                    ldap_verify_tls: data.ldap_verify_tls || false,
                    ldap_group_mappings: data.ldap_group_mappings || [],
                }));

                // Load OIDC / Entra ID settings
                setOidcConfig(prev => ({
                    ...prev,
                    oidc_enabled: data.oidc_enabled || false,
                    oidc_provider: data.oidc_provider || 'entra',
                    oidc_cloud_environment: data.oidc_cloud_environment || 'commercial',
                    oidc_client_id: data.oidc_client_id || '',
                    oidc_client_secret: '',  // Never returned from server
                    oidc_tenant_id: data.oidc_tenant_id || '',
                    oidc_authority: data.oidc_authority || '',
                    oidc_scopes: data.oidc_scopes || 'openid profile email',
                    oidc_redirect_uri: data.oidc_redirect_uri || '',
                    oidc_admin_group_id: data.oidc_admin_group_id || '',
                    oidc_user_group_id: data.oidc_user_group_id || '',
                    oidc_viewer_group_id: data.oidc_viewer_group_id || '',
                    oidc_default_role: data.oidc_default_role || 'viewer',
                    oidc_auto_create_users: data.oidc_auto_create_users !== false,
                    oidc_button_text: data.oidc_button_text || 'Sign in with Microsoft',
                    oidc_skip_jwt_verification: data.oidc_skip_jwt_verification || false,
                    oidc_skip_ssl_verify: data.oidc_skip_ssl_verify || false,
                    oidc_allow_private_ip: data.oidc_allow_private_ip || false,
                    oidc_audiences: data.oidc_audiences || '',
                    oidc_group_mappings: data.oidc_group_mappings || [],
                }));
            }
        } catch (err) {
            console.error('fetching server settings:', err);
        }
    };

    const fetchUserTheme = async () => {
        try {
            const response = await fetch(`${API_URL}/settings`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (response && response.ok) {
                const data = await response.json();
                const theme = data.theme || 'system';
                setUserTheme(theme);
                if (typeof applyTheme !== 'undefined') applyTheme(theme);
            }
        } catch (err) {
            console.error('fetching user theme:', err);
        }
    };

    const saveUserTheme = async (theme) => {
        setUserThemeLoading(true);
        try {
            const response = await fetch(`${API_URL}/settings`, {
                method: 'PUT',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme })
            });
            if (response && response.ok) {
                const data = await response.json();
                setUserTheme(data.theme || theme);
                if (typeof applyTheme !== 'undefined') applyTheme(data.theme || theme);
                addToast(t('settingsSaved'), 'success');
            } else {
                const err = await response.json().catch(() => ({}));
                addToast(err.error || t('errorSavingSettings'), 'error');
            }
        } catch (err) {
            addToast(err.message || t('errorSavingSettings'), 'error');
        }
        setUserThemeLoading(false);
    };

    // Plugin management
    const fetchPlugins = async () => {
        try {
            // Avoid stale cached lists: the enabled state changes after toggles.
            const res = await fetch(`${API_URL}/plugins`, { credentials: 'include', headers: getAuthHeaders(), cache: 'no-store' });
            if (res && res.ok) {
                const data = await res.json();
                const list = Array.isArray(data) ? data : (Array.isArray(data.plugins) ? data.plugins : []);
                setDiscoveredPlugins(list);
            }
        } catch (e) { console.warn('plugins fetch:', e); }
    };
    const togglePlugin = async (pluginId, enabled) => {
        if (togglingPlugin) return;
        setTogglingPlugin(pluginId);
        try {
            const action = enabled ? 'disable' : 'enable';
            const res = await fetch(`${API_URL}/plugins/${pluginId}/${action}`, {
                method: 'POST', credentials: 'include', headers: getAuthHeaders(), cache: 'no-store'
            });
            if (res && res.ok) {
                const data = await res.json().catch(() => ({}));
                addToast(data.message || `Plugin ${action}d`, 'success');
            } else {
                const err = await res.json().catch(() => ({}));
                addToast(err.error || `Failed to ${action} plugin`, 'error');
            }
        } catch (e) { addToast('Network error', 'error'); }
        // Refresh the list even on failure: the backend persists the intended
        // enabled state and may report a load error separately.
        finally { await fetchPlugins(); setTogglingPlugin(null); }
    };

    const handleDeletePlugin = async (plugin) => {
        if (!confirm(`Delete plugin "${plugin.name}"? This removes all plugin files.`)) return;
        setDeletingPlugin(plugin.id);
        try {
            const r = await fetch(`${API_URL}/plugins/${plugin.id}`, { method: 'DELETE', credentials: 'include', headers: getAuthHeaders() });
            if (r && r.ok) { addToast('Plugin deleted', 'success'); fetchPlugins(); }
            else { const e = await r.json().catch(() => ({})); addToast(e.error || 'Failed', 'error'); }
        } catch (e) { addToast('Error', 'error'); }
        finally { setDeletingPlugin(null); }
    };

    // LDAP save and test functions
    const saveLdapSettings = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/settings/server`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify(ldapConfig)
            });
            if (res.ok) {
                const result = await res.json();
                addToast('LDAP settings saved', 'success');
                // Show warnings if LDAP config is incomplete
                if (result.warnings && result.warnings.length > 0) {
                    result.warnings.forEach(w => addToast(`⚠️ ${w}`, 'warning'));
                }
                fetchServerSettings();
            } else {
                const err = await res.json();
                addToast(err.error || 'Failed to save', 'error');
            }
        } catch (e) { addToast('Network error', 'error'); }
        finally { setLoading(false); }
    };

    const testLdapConnection = async () => {
        setLdapTesting(true);
        setLdapTestResult(null);
        try {
            const res = await fetch(`${API_URL}/settings/ldap/test`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ ...ldapConfig, test_username: ldapTestUser })
            });
            const data = await res.json();
            setLdapTestResult(data);
            if (data.success) addToast('LDAP connection successful!', 'success');
            else addToast(data.error || 'Connection failed', 'error');
        } catch (e) { addToast('Network error', 'error'); }
        finally { setLdapTesting(false); }
    };

    // OIDC / Entra ID save and test
    const saveOidcSettings = async () => {
        setLoading(true);
        try {
            // Auto-detect redirect URI if not set
            const configToSave = { ...oidcConfig };
            if (!configToSave.oidc_redirect_uri) {
                configToSave.oidc_redirect_uri = `${window.location.origin}/oidc/callback`;
            }
            if (!configToSave.oidc_client_secret) {
                configToSave.oidc_client_secret = '********';  // Don't overwrite
            }
            const res = await fetch(`${API_URL}/settings/server`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify(configToSave)
            });
            if (res.ok) addToast('OIDC settings saved', 'success');
            else addToast('Failed to save OIDC settings', 'error');
        } catch (e) { addToast('Network error', 'error'); }
        finally { setLoading(false); }
    };

    const testOidcConnection = async () => {
        setOidcTesting(true);
        setOidcTestResult(null);
        try {
            const res = await fetch(`${API_URL}/settings/oidc/test`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify(oidcConfig)
            });
            const data = await res.json();
            setOidcTestResult(data);
            if (data.success) addToast('OIDC endpoints reachable!', 'success');
            else addToast('Some checks failed', 'warning');
        } catch (e) { addToast('Network error', 'error'); }
        finally { setOidcTesting(false); }
    };

    const handleSaveServerSettings = async () => {
        setServerLoading(true);
        try {
            const formData = new FormData();
            formData.append('domain', serverSettings.domain);
            formData.append('port', serverSettings.port);
            formData.append('http_redirect_port', serverSettings.http_redirect_port || 0);
            formData.append('ssl_enabled', serverSettings.ssl_enabled);
            formData.append('acme_enabled', serverSettings.acme_enabled ? 'true' : 'false');
            formData.append('acme_provider', serverSettings.acme_provider || 'letsencrypt');
            formData.append('acme_email', serverSettings.acme_email || '');
            formData.append('acme_staging', serverSettings.acme_staging ? 'true' : 'false');
            formData.append('acme_challenge_type', serverSettings.acme_challenge_type || 'http-01');
            formData.append('acme_dns_provider', serverSettings.acme_dns_provider || 'manual');
            formData.append('acme_dns_rfc2136_nameserver', serverSettings.acme_dns_rfc2136_nameserver || '');
            formData.append('acme_dns_rfc2136_port', serverSettings.acme_dns_rfc2136_port || 53);
            formData.append('acme_dns_rfc2136_zone', serverSettings.acme_dns_rfc2136_zone || '');
            formData.append('acme_dns_rfc2136_key_name', serverSettings.acme_dns_rfc2136_key_name || '');
            formData.append('acme_dns_rfc2136_secret', serverSettings.acme_dns_rfc2136_secret || '');
            formData.append('acme_dns_rfc2136_algorithm', serverSettings.acme_dns_rfc2136_algorithm || 'hmac-sha512');
            formData.append('acme_dns_rfc2136_ttl', serverSettings.acme_dns_rfc2136_ttl || 60);
            formData.append('acme_dns_propagation_seconds', serverSettings.acme_dns_propagation_seconds || 30);
            formData.append('acme_directory_url', serverSettings.acme_provider === 'custom' ? (serverSettings.acme_directory_url || '') : '');
            formData.append('reverse_proxy_enabled', serverSettings.reverse_proxy_enabled);
            formData.append('audit_retention_days', String(serverSettings.audit_retention_days || 90));
            formData.append('air_gap_mode', serverSettings.air_gap_mode ? 'true' : 'false');
            formData.append('trusted_proxies', serverSettings.trusted_proxies || '');
            formData.append('proxy_bind_address', serverSettings.proxy_bind_address || '');
            formData.append('default_theme', serverSettings.default_theme || 'proxmoxDark');
            // Alert recipients live in the same tab - must send them too
            formData.append('alert_email_recipients', JSON.stringify(serverSettings.alert_email_recipients || []));
            if (serverSettings.alert_cooldown) {
                formData.append('alert_cooldown', serverSettings.alert_cooldown);
            }
            formData.append('alert_update_available', serverSettings.alert_update_available ? 'true' : 'false');
            formData.append('syslog_filter_by_selected_cluster', serverSettings.syslog_filter_by_selected_cluster ? 'true' : 'false');
            formData.append('syslog_enabled', serverSettings.syslog_enabled ? 'true' : 'false');

            if (serverSettings.ssl_cert_file) {
                formData.append('ssl_cert', serverSettings.ssl_cert_file);
            }
            if (serverSettings.ssl_key_file) {
                formData.append('ssl_key', serverSettings.ssl_key_file);
            }
            if (loginBgFile) {
                formData.append('login_background', loginBgFile);
            }

            const response = await fetch(`${API_URL}/settings/server`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'X-Requested-With': 'XMLHttpRequest' },
                body: formData
            });

            if (response && response.ok) {
                const data = await response.json();
                addToast(t('serverSettingsSaved'), 'success');
                if (data.restart_required) {
                    addToast(t('restartRequired'), 'info');
                }
                setLoginBgFile(null);
                fetchServerSettings();
            } else {
                const err = await response.json();
                addToast(err.error || t('errorSavingSettings'), 'error');
            }
        } catch (err) {
            addToast(t('errorSavingSettings'), 'error');
        }
        finally { setServerLoading(false); }
    };

    const handleCertFileChange = (e, type) => {
        const file = e.target.files[0];
        if (file) {
            if (type === 'cert') {
                setServerSettings(prev => ({ ...prev, ssl_cert_file: file, ssl_cert: file.name }));
            } else {
                setServerSettings(prev => ({ ...prev, ssl_key_file: file, ssl_key: file.name }));
            }
        }
    };

    // ACME cert request handler
    const handleAcmeRequest = async () => {
        if (!serverSettings.domain) {
            addToast(t('domain') + ' required', 'error');
            return;
        }
        if (serverSettings.acme_provider === 'letsencrypt' && !serverSettings.acme_email) {
            addToast(t('acmeEmail') + ' required', 'error');
            return;
        }
        if (serverSettings.acme_provider === 'custom' && !serverSettings.acme_directory_url) {
            addToast('ACME Directory URL required', 'error');
            return;
        }
        setAcmeLoading(true);
        setAcmeResult(null);
        try {
            const resp = await fetch(`${API_URL}/settings/acme/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({
                    domain: serverSettings.domain,
                    provider: serverSettings.acme_provider || 'letsencrypt',
                    email: serverSettings.acme_email,
                    staging: serverSettings.acme_staging,
                    challenge_type: serverSettings.acme_challenge_type || 'http-01',
                    dns_provider: serverSettings.acme_dns_provider || 'manual',
                    acme_dns_provider: serverSettings.acme_dns_provider || 'manual',
                    acme_dns_rfc2136_nameserver: serverSettings.acme_dns_rfc2136_nameserver || '',
                    acme_dns_rfc2136_port: serverSettings.acme_dns_rfc2136_port || 53,
                    acme_dns_rfc2136_zone: serverSettings.acme_dns_rfc2136_zone || '',
                    acme_dns_rfc2136_key_name: serverSettings.acme_dns_rfc2136_key_name || '',
                    acme_dns_rfc2136_secret: serverSettings.acme_dns_rfc2136_secret || '',
                    acme_dns_rfc2136_algorithm: serverSettings.acme_dns_rfc2136_algorithm || 'hmac-sha512',
                    acme_dns_rfc2136_ttl: serverSettings.acme_dns_rfc2136_ttl || 60,
                    acme_dns_propagation_seconds: serverSettings.acme_dns_propagation_seconds || 30,
                    directory_url: serverSettings.acme_provider === 'custom' ? serverSettings.acme_directory_url : '',
                })
            });
            const data = await resp.json();
            setAcmeResult(data);
            if (data.pending_dns) {
                addToast(t('acmeDnsPrepared'), 'success');
            } else if (data.success) {
                addToast(t('acmeSuccess'), 'success');
                fetchServerSettings();
            } else {
                addToast(data.message || data.error || 'ACME failed', 'error');
            }
        } catch (err) {
            addToast('ACME request failed: ' + err.message, 'error');
        }
        finally { setAcmeLoading(false); }
    };

    const handleAcmeDnsComplete = async () => {
        if (!acmeResult?.challenge_id) return;
        setAcmeLoading(true);
        try {
            const resp = await fetch(`${API_URL}/settings/acme/dns/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ challenge_id: acmeResult.challenge_id })
            });
            const data = await resp.json();
            setAcmeResult(data);
            if (data.success) {
                addToast(t('acmeSuccess'), 'success');
                fetchServerSettings();
            } else {
                addToast(data.message || data.error || 'DNS-01 validation failed', 'error');
            }
        } catch (err) {
            addToast('DNS-01 validation failed: ' + err.message, 'error');
        }
        setAcmeLoading(false);
    };

    // Save SMTP Settings
    const [smtpLoading, setSmtpLoading] = useState(false);

    const handleSaveSMTPSettings = async () => {
        setSmtpLoading(true);
        try {
            const response = await fetch(`${API_URL}/settings/server`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    smtp_enabled: serverSettings.smtp_enabled,
                    smtp_host: serverSettings.smtp_host,
                    smtp_port: serverSettings.smtp_port,
                    smtp_user: serverSettings.smtp_user,
                    smtp_password: serverSettings.smtp_password,
                    smtp_from_email: serverSettings.smtp_from_email,
                    smtp_from_name: serverSettings.smtp_from_name,
                    smtp_tls: serverSettings.smtp_tls,
                    smtp_ssl: serverSettings.smtp_ssl,
                    alert_email_recipients: serverSettings.alert_email_recipients,
                    alert_cooldown: serverSettings.alert_cooldown,
                    alert_update_available: !!serverSettings.alert_update_available,
                })
            });

            if (response && response.ok) {
                addToast(t('smtpSettingsSaved'), 'success');
                fetchServerSettings();
            } else {
                const err = await response.json();
                addToast(err.error || t('errorSavingSettings'), 'error');
            }
        } catch (err) {
            console.error('Save SMTP error:', err);
            addToast(t('errorSavingSettings'), 'error');
        }
        setSmtpLoading(false);
    };

    // Test Email Function
    const handleTestEmail = async () => {
        if (!testEmailAddress) {
            addToast(t('enterEmailAddress'), 'error');
            return;
        }

        // Validate required SMTP fields before sending
        if (!serverSettings.smtp_host) {
            addToast(t('smtpHostRequired'), 'error');
            return;
        }
        if (!serverSettings.smtp_from_email) {
            addToast(t('smtpFromEmailRequired'), 'error');
            return;
        }

        setTestEmailLoading(true);
        try {
            const response = await fetch(`${API_URL}/settings/smtp/test`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: testEmailAddress,
                    // Include current SMTP settings in case they haven't been saved yet
                    smtp_host: serverSettings.smtp_host,
                    smtp_port: serverSettings.smtp_port || 587,
                    smtp_user: serverSettings.smtp_user || '',
                    smtp_password: serverSettings.smtp_password || '',
                    smtp_from_email: serverSettings.smtp_from_email,
                    smtp_from_name: serverSettings.smtp_from_name || 'ProxmoxVEx Alerts',
                    smtp_tls: serverSettings.smtp_tls !== false,
                    smtp_ssl: serverSettings.smtp_ssl || false
                })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                addToast(data.message || t('testEmailSuccess'), 'success');
            } else {
                addToast(data.error || t('testEmailFailed'), 'error');
            }
        } catch (err) {
            console.error('Test email error:', err);
            addToast(t('testEmailFailed'), 'error');
        }
        finally { setTestEmailLoading(false); }
    };

    const handleRestartServer = async () => {
        setRestartLoading(true);
        try {
            const response = await fetch(`${API_URL}/settings/server/restart`, {
                method: 'POST',
                credentials: 'include',
                headers: getAuthHeaders()
            });

            if (response && response.ok) {
                addToast(t('restartInitiated'), 'success');
                setShowRestartConfirm(false);
                // Show reconnecting message after a short delay
                setTimeout(() => {
                    addToast(t('reconnecting'), 'info');
                }, 2000);
                // Try to reconnect after server restart
                setTimeout(() => {
                    window.location.reload();
                }, 5000);
            } else {
                const err = await response.json();
                addToast(err.error || t('restartFailed'), 'error');
            }
        } catch (err) {
            // Expected - server is restarting
            addToast(t('restartInitiated'), 'success');
            setShowRestartConfirm(false);
            setTimeout(() => {
                window.location.reload();
            }, 5000);
        }
        finally { setRestartLoading(false); }
    };

    const fetchUsers = async () => {
        try {
            const response = await fetch(`${API_URL}/users`, {
                credentials: 'include', headers: getAuthHeaders()
            });
            if (response && response.ok) {
                const data = await response.json();
                setUsers(data);
            }
        } catch (err) {
            console.error('fetching users:', err);
        }
        // Also fetch user folders
        try {
            const fr = await fetch(`${API_URL}/user-folders`, { credentials: 'include', headers: getAuthHeaders() });
            if (fr.ok) setUserFolders(await fr.json());
        } catch (e) { }
    };

    // Server-side filters via /api/audit/search
    const [auditFrom, setAuditFrom] = useState('');
    const [auditTo, setAuditTo] = useState('');
    const [auditQuery, setAuditQuery] = useState('');
    const [auditSev, setAuditSev] = useState('');
    const [auditClusterFilter, setAuditClusterFilter] = useState('');
    const [auditIp, setAuditIp] = useState('');
    const [auditOffset, setAuditOffset] = useState(0);
    const [auditTotal, setAuditTotal] = useState(0);
    const auditColumns = React.useMemo(() => [
        { key: 'timestamp', label: t('timestamp') },
        { key: 'username', label: t('usernameLabel') },
        { key: 'cluster', label: t('cluster') },
        { key: 'action', label: t('action') },
        { key: 'details', label: t('details') },
        { key: 'ip_address', label: t('ipAddress') }
    ], [t]);
    const [auditVisibleColumns, setAuditVisibleColumns] = useState(auditColumns.map(c => c.key));
    const toggleAuditColumn = (key) => setAuditVisibleColumns(prev =>
        prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
    const auditPageSize = 100;

    const fetchAuditLogs = async (offsetOverride = null) => {
        try {
            const off = offsetOverride !== null ? offsetOverride : auditOffset;
            const params = new URLSearchParams();
            if (auditQuery) params.set('q', auditQuery);
            if (auditSev) params.set('severity', auditSev);
            if (auditClusterFilter) params.set('cluster', auditClusterFilter);
            if (auditIp) params.set('ip', auditIp);
            if (auditFrom) params.set('date_from', auditFrom);
            if (auditTo) params.set('date_to', auditTo);
            params.set('offset', String(off));
            params.set('limit', String(auditPageSize));
            const response = await fetch(`${API_URL}/audit/search?${params.toString()}`, {
                credentials: 'include', headers: getAuthHeaders(),
            });
            if (response && response.ok) {
                const data = await response.json();
                setAuditLogs(data.entries || []);
                setAuditTotal(data.total || 0);
                setAuditOffset(data.offset || 0);
            } else if (response && response.status === 404) {
                // backend without /audit/search — fall back to legacy /audit
                const legacy = await fetch(`${API_URL}/audit`, { credentials: 'include', headers: getAuthHeaders() });
                if (legacy && legacy.ok) {
                    const list = await legacy.json();
                    setAuditLogs(list);
                    setAuditTotal(list.length);
                }
            }
        } catch (err) {
            console.error('fetching audit logs:', err);
        }
    };


    const fetchSnapshots = async (body = null) => {
        try {
            const res = await fetch(`${API_URL}/snapshots/overview`, {
                method: body ? 'POST' : 'GET',
                headers: body ? { 'Content-Type': 'application/json', ...getAuthHeaders() } : getAuthHeaders(),
                credentials: 'include',
                body: body ? JSON.stringify(body) : undefined
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = await res.json();
            setSnapshots(data.snapshots ?? data ?? []);
        } catch (err) {
            console.error('Snapshot fetch failed:', err);
            setSnapshots([]);
        }
    };

    const applySnapshotFilter = async () => {
        await fetchSnapshots({
            date: filterDate,
            tab: snapshotsSubTab
        });
    };

    const deleteSnapshot = async (snap) => {
        if (!window.confirm(`Delete snapshot "${snap.snapshot_name}" from VM ${snap.vmid}?`)) {
            return;
        }
        try {
            await fetch(`${API_URL}/snapshots/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                credentials: 'include',
                body: JSON.stringify({ snapshots: [snap] })
            });
            addToast('Snapshot deleted', 'success');
            await fetchSnapshots(filterDate ? { date: filterDate, tab: snapshotsSubTab } : null);
        } catch (err) {
            console.error('Snapshot delete failed:', err);
            addToast('Failed to delete snapshot', 'error');
        }
    };

    const handleResetPassword = async (username) => {
        if (!newPasswordValue || newPasswordValue.length < 4) {
            addToast(t('passwordTooShort'), 'error');
            return;
        }
        setPasswordResetting(true);

        try {
            const response = await fetch(`${API_URL}/users/${username}/password`, {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders()
                },
                body: JSON.stringify({ password: newPasswordValue })
            });

            if (response && response.ok) {
                const data = await response.json().catch(() => ({}));
                setPasswordResetUser(null);
                setNewPasswordValue('');
                fetchAuditLogs();
                // 2026-04-24 - if admin reset their OWN password, the backend
                // killed their session — redirect to login.
                if (data.relogin_required) {
                    addToast(t('passwordChangedReloginRequired3'), 'success');
                    setTimeout(() => { window.location.href = '/'; }, 1200);
                } else {
                    addToast(t('passwordResetSuccess'), 'success');
                }
            } else {
                const data = await response.json();
                addToast(data.error || 'Error resetting password', 'error');
            }
        } catch (err) {
            addToast('Error resetting password', 'error');
        }
        finally { setPasswordResetting(false); }
    };

    const handleAddFolder = async () => {
        const name = newFolderName.trim();
        if (!name) return;
        setFolderSaving(true);
        try {
            const r = await fetch(`${API_URL}/user-folders`, { method: 'POST', credentials: 'include', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
            const d = await r.json().catch(() => ({}));
            if (d.success) {
                setNewFolderName('');
                fetchUsers();
            } else {
                addToast(d.error || t('error'), 'error');
            }
        } catch (e) { addToast(t('error'), 'error'); }
        finally { setFolderSaving(false); }
    };

    const handleDisable2FA = async (username) => {
        if (!confirm(`${t('disable2FA')} für ${username}?`)) return;
        setDisabling2FA(username);

        try {
            const response = await fetch(`${API_URL}/users/${username}/2fa`, {
                method: 'DELETE',
                credentials: 'include',  // Fix - need cookies for session auth
                headers: getAuthHeaders()
            });

            if (response && response.ok) {
                addToast(t('twoFactorDisabled'), 'success');
                fetchUsers();
                fetchAuditLogs();
            } else {
                const data = await response.json();
                addToast(data.error || 'Error disabling 2FA', 'error');
            }
        } catch (err) {
            addToast('Error disabling 2FA', 'error');
        }
        finally { setDisabling2FA(null); }
    };

    const handleCreateUser = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/users`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders()
                },
                body: JSON.stringify(newUser)
            });

            if (response && response.ok) {
                addToast(t('userCreated'), 'success');
                setShowAddUser(false);
                setNewUser({ username: '', password: '', display_name: '', email: '', role: 'user', tenant_id: 'default', portal_only: false });
                fetchUsers();
                fetchAuditLogs();
                fetchTenants(); // Refresh tenant user counts
            } else {
                const data = await response.json();
                addToast(data.error || 'Error creating user', 'error');
            }
        } catch (err) {
            addToast('Error creating user', 'error');
        }
        finally { setLoading(false); }
    };

    const handleUpdateUser = async (username, updates) => {
        setUpdatingUser(username);
        try {
            const response = await fetch(`${API_URL}/users/${username}`, {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders()
                },
                body: JSON.stringify(updates)
            });

            if (response && response.ok) {
                addToast(t('userUpdated'), 'success');
                setEditingUser(null);
                fetchUsers();
                fetchAuditLogs();
                fetchTenants(); // Refresh tenant user counts
            } else {
                const data = await response.json();
                addToast(data.error || 'Error updating user', 'error');
            }
        } catch (err) {
            console.error('Error updating user:', err);
            addToast('Error updating user', 'error');
        }
        finally { setUpdatingUser(null); }
    };

    const handleDeleteUser = async (username) => {
        if (!confirm(t('deleteUserConfirm'))) return;
        setUserDeleting(username);

        try {
            const response = await fetch(`${API_URL}/users/${username}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: getAuthHeaders()
            });

            if (response && response.ok) {
                addToast(t('userDeleted'), 'success');
                fetchUsers();
                fetchAuditLogs();
            } else {
                const data = await response.json();
                addToast(data.error || 'Error deleting user', 'error');
            }
        } catch (err) {
            addToast('Error deleting user', 'error');
        }
        finally { setUserDeleting(null); }
    };

    const exportAuditLog = () => {
        const csv = [
            ['Timestamp', 'User', 'Cluster', 'Action', 'Details', 'IP Address'].join(','),
            ...filteredLogs.map(log => [
                log.timestamp,
                log.user,
                log.cluster || '',
                log.action,
                `"${(log.details || '').replace(/"/g, '""')}"`,
                log.ip_address || ''
            ].join(','))
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ProxmoxVEx-audit-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const getActionLabel = (action) => {
        const labels = {
            'user.login': t('userLogin'),
            'user.logout': t('userLogout'),
            'user.created': t('userCreated'),
            'user.updated': t('userUpdated'),
            'user.deleted': t('userDeleted'),
            'user.password_changed': t('passwordChanged'),
            'cluster.added': t('clusterAdded'),
            'cluster.deleted': t('clusterDeleted'),
            'cluster.config_changed': t('clusterConfigChanged'),
            'vm.started': t('vmStarted'),
            'vm.stopped': t('vmStopped'),
            'vm.restarted': t('vmRestarted'),
            'vm.created': t('vmCreated'),
            'vm.deleted': t('vmDeleted'),
            'vm.cloned': t('vmCloned'),
            'vm.migrated': t('vmMigrated'),
            'vm.bulk_migrated': t('vmBulkMigrated'),
            'vm.config_changed': t('vmConfigChanged'),
            'vm.suspended': t('vmSuspended'),
            'vm.resumed': t('vmResumed'),
            'vm.disk_added': t('vmDiskAdded'),
            'vm.disk_removed': t('vmDiskRemoved'),
            'vm.disk_resized': t('vmDiskResized'),
            'vm.disk_moved': t('vmDiskMoved'),
            'vm.network_added': t('vmNetworkAdded'),
            'vm.network_removed': t('vmNetworkRemoved'),
            'vm.network_updated': t('vmNetworkUpdated'),
            'snapshot.created': t('snapshotCreated'),
            'snapshot.deleted': t('snapshotDeleted'),
            'snapshot.restored': t('snapshotRestored'),
            'replication.created': t('replicationCreated'),
            'replication.deleted': t('replicationDeleted'),
            'replication.triggered': t('replicationTriggered'),
            'ha.enabled': t('haEnabled'),
            'ha.disabled': t('haDisabled'),
            'ha.vm_added': t('haVmAdded'),
            'ha.vm_removed': t('haVmRemoved'),
            'node.maintenance_entered': t('nodeMaintenanceEntered'),
            'node.maintenance_exited': t('nodeMaintenanceExited'),
            'node.update_started': t('nodeUpdateStarted'),
        };
        return labels[action] || action;
    };

    const uniqueUsers = [...new Set(auditLogs.map(log => log.user))];
    const uniqueActions = [...new Set(auditLogs.map(log => log.action))];

    const filteredLogs = auditLogs.filter(log => {
        if (userFilter && log.user !== userFilter) return false;
        if (actionFilter && log.action !== actionFilter) return false;
        return true;
    });

    if (!isOpen) return null;

    return (
        <>
            <div
                className={page
                    ? 'fixed inset-0 z-50 flex flex-col overflow-hidden bg-proxmox-darker'
                    : (isCorporate ? "corp-vm-modal-overlay" : "fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80")}
                onClick={page ? undefined : onClose}
            >
                <div
                    className={page
                        ? 'flex-1 flex flex-col overflow-hidden'
                        : (isCorporate
                            ? 'corp-vm-modal'
                            : 'w-full max-w-5xl max-h-[90vh] bg-proxmox-card border border-proxmox-border overflow-hidden flex flex-col rounded-2xl shadow-2xl')}
                    style={!page && isCorporate ? { maxWidth: '1100px', width: '100%' } : undefined}
                    onClick={page ? undefined : e => e.stopPropagation()}
                >
                    {/* Header - Corporate uses unified corporate chrome (matches VM Configure) */}
                    {isCorporate ? (
                        <div className="corp-vm-modal-header">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <Icons.Settings className="w-5 h-5" style={{ color: 'var(--corp-accent, #49afd9)' }} />
                                <div className="min-w-0">
                                    <div className="corp-vm-modal-title truncate">{t('ProxmoxVExSettings')}</div>
                                    <div className="corp-vm-modal-meta">ProxmoxVEx {ProxmoxVEx_VERSION}</div>
                                </div>
                            </div>
                            <div className="corp-vm-modal-actions">
                                <button onClick={onClose} className="corp-vm-btn corp-vm-btn-ghost" title={t('close')}>
                                    <Icons.X />
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="border-b border-proxmox-border flex items-center justify-between p-6">
                            <div className="flex items-center gap-3">
                                <SettingsModalHoverCard content={t('ProxmoxVExSettings')}>
                                    <div className="w-10 h-10 rounded-xl bg-proxmox-orange/20 flex items-center justify-center">
                                        <Icons.Settings />
                                    </div>
                                </SettingsModalHoverCard>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-xl font-bold text-white">
                                            {t('ProxmoxVExSettings')}
                                        </h2>
                                        <SettingsModalStatusBadge status={updateInfo?.update_available ? 'warning' : 'ok'} />
                                    </div>
                                    <p className="text-sm text-gray-400">ProxmoxVEx {ProxmoxVEx_VERSION}</p>
                                    <SettingsModalBreadcrumbBar activeTab={activeTab} />
                                </div>
                            </div>
                            <button onClick={onClose} className="p-1.5 hover:bg-proxmox-dark text-gray-400 hover:text-white">
                                <Icons.X />
                            </button>
                        </div>
                    )}

                    {/* Settings sidebar */}
                    {/* Replaced the dated top tab bar with a dashboard-style left navigation */}
                    {/* Use opaque theme classes for the sidebar and nav items; the prebuilt tailwind.min.css does not include arbitrary or /40 opacity classes, so transparent backgrounds were rendered in both themes. */}
                    <div className="flex flex-1 overflow-hidden">
                        <SettingsModalResizablePanels isCorporate={isCorporate}>
                            <SettingsModalFilterSidebar value={tabFilter} onChange={setTabFilter} />
                            <nav className="space-y-1">
                                {tabOrder.filter((tabId) => {
                                    const item = tabsList.find(t => t.id === tabId);
                                    return !item ? false : item.label.toLowerCase().includes(tabFilter.toLowerCase());
                                }).map((tabId) => {
                                    const item = tabsList.find(t => t.id === tabId) || tabsList[0];
                                    const Icon = item.icon;
                                    const isActive = activeTab === item.id;
                                    return (
                                        <button
                                            key={item.id}
                                            draggable
                                            onDragStart={() => setDraggedTab(item.id)}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={() => {
                                                if (!draggedTab || draggedTab === item.id) return;
                                                setTabOrder(prev => {
                                                    const next = [...prev];
                                                    const from = next.indexOf(draggedTab);
                                                    const to = next.indexOf(item.id);
                                                    if (from < 0 || to < 0) return prev;
                                                    next.splice(from, 1);
                                                    next.splice(to, 0, draggedTab);
                                                    return next;
                                                });
                                                setDraggedTab(null);
                                            }}
                                            onClick={() => { setActiveTab(item.id); if (item.checkForUpdates) checkForUpdates(); }}
                                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors ${isActive
                                                ? (isCorporate ? 'bg-proxmox-hover text-proxmox-orange' : 'bg-proxmox-orange/10 text-proxmox-orange')
                                                : (isCorporate ? 'text-proxmox-textMuted hover:text-proxmox-text hover:bg-proxmox-hover' : 'text-gray-400 hover:text-white hover:bg-proxmox-hover')
                                                }`}
                                        >
                                            <span className="text-gray-500 hover:text-proxmox-orange cursor-move" onClick={(e) => e.stopPropagation()}>
                                                <SettingsModalDragHandle />
                                            </span>
                                            <Icon className="w-4 h-4 flex-shrink-0" />
                                            <span className="truncate">{item.label}</span>
                                            {item.id === 'updates' && updateInfo?.update_available && (
                                                <span className="ml-auto px-1.5 py-0.5 text-[10px] bg-green-500 text-white rounded-full">NEW</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </nav>
                            <SettingsModalKeyboardShortcuts onClose={onClose} />
                        </SettingsModalResizablePanels>
                        <main className={isCorporate ? 'corp-vm-modal-body' : 'flex-1 overflow-auto p-6'}>
                            {activeTab === 'users' && (
                                <div className="space-y-4">
                                    {/* Add User Button + Folder Management */}
                                    <div className="flex justify-between items-center">
                                        <h3 className="text-lg font-semibold text-white">{t('users')}</h3>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => setShowAddFolder(!showAddFolder)}
                                                className="flex items-center gap-1.5 px-3 py-2 bg-proxmox-card border border-proxmox-border hover:border-gray-500 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
                                                title="Manage Folders"
                                            >
                                                <Icons.Folder className="w-4 h-4" />
                                                {t('folders')}
                                            </button>
                                            <button
                                                onClick={() => setShowAddUser(true)}
                                                className="flex items-center gap-2 px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium transition-colors"
                                            >
                                                <Icons.UserPlus />
                                                {t('addUser')}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Folder Management Panel */}
                                    {showAddFolder && (
                                        <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-card border border-proxmox-border rounded-lg p-4 space-y-3"}>
                                            <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "text-sm font-medium text-gray-300 flex items-center gap-2"}>
                                                <Icons.Folder className="w-4 h-4" />
                                                {t('userFolders')}
                                            </h4>
                                            <div className="flex gap-2">
                                                <input
                                                    value={newFolderName}
                                                    onChange={e => setNewFolderName(e.target.value)}
                                                    placeholder={t('folderName')}
                                                    disabled={folderSaving}
                                                    className={isCorporate ? 'corp-input' : "flex-1 px-3 py-1.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-sm text-white disabled:opacity-50"}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter' && newFolderName.trim()) {
                                                            e.preventDefault();
                                                            handleAddFolder();
                                                        }
                                                    }}
                                                />
                                                <button
                                                    onClick={() => { if (newFolderName.trim()) handleAddFolder(); }}
                                                    disabled={folderSaving || !newFolderName.trim()}
                                                    className="px-3 py-1.5 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                                                >
                                                    {folderSaving ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : null}
                                                    {t('add')}
                                                </button>
                                            </div>
                                            {userFolders.length > 0 && (
                                                <div className="space-y-1">
                                                    {userFolders.map(f => (
                                                        <div key={f.id} className="flex items-center justify-between px-3 py-2 bg-proxmox-dark rounded-lg">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-3 h-3 rounded" style={{ background: f.color || '#6b7280' }} />
                                                                <span className="text-sm text-gray-300">{f.name}</span>
                                                                <span className="text-xs text-gray-600">{users.filter(u => u.user_folder === f.id).length} users</span>
                                                            </div>
                                                            <button
                                                                onClick={() => {
                                                                    if (!confirm(`Delete folder "${f.name}"?`)) return;
                                                                    fetch(`${API_URL}/user-folders/${f.id}`, { method: 'DELETE', credentials: 'include', headers: getAuthHeaders() })
                                                                        .then(r => r.json()).then(d => { if (d.success) fetchUsers(); });
                                                                }}
                                                                className="text-red-400/60 hover:text-red-400 transition-colors"
                                                            ><Icons.Trash2 className="w-3.5 h-3.5" /></button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Folder filter tabs */}
                                    {userFolders.length > 0 && (
                                        <div className="flex gap-1 flex-wrap">
                                            <button
                                                onClick={() => { setUserFilter(''); setUserPage(0); }}
                                                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${!userFilter ? 'bg-proxmox-orange/20 text-proxmox-orange' : 'text-gray-500 hover:text-gray-300'}`}
                                            >{t('all')}</button>
                                            <button
                                                onClick={() => { setUserFilter('__none__'); setUserPage(0); }}
                                                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${userFilter === '__none__' ? 'bg-gray-500/20 text-gray-300' : 'text-gray-500 hover:text-gray-300'}`}
                                            >{t('unfiled')}</button>
                                            {userFolders.map(f => (
                                                <button
                                                    key={f.id}
                                                    onClick={() => { setUserFilter(f.id); setUserPage(0); }}
                                                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${userFilter === f.id ? 'bg-proxmox-orange/20 text-proxmox-orange' : 'text-gray-500 hover:text-gray-300'}`}
                                                >
                                                    <div className="w-2 h-2 rounded" style={{ background: f.color || '#6b7280' }} />
                                                    {f.name}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {/* Add User Form */}
                                    {showAddUser && (
                                        <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                            <h4 className={isCorporate ? 'corp-card-header' : "text-white font-medium mb-4"}>{t('addUser')}</h4>
                                            <form onSubmit={handleCreateUser} className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('usernameLabel')}</label>
                                                    <input
                                                        type="text"
                                                        value={newUser.username}
                                                        onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm focus:outline-none focus:border-proxmox-orange"}
                                                        required
                                                    />
                                                </div>
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('passwordLabel')}</label>
                                                    <input
                                                        type="password"
                                                        value={newUser.password}
                                                        onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm focus:outline-none focus:border-proxmox-orange"}
                                                        required
                                                    />
                                                    <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>
                                                        {getSettingsPasswordPolicyHint()}
                                                    </p>
                                                </div>
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('displayName')}</label>
                                                    <input
                                                        type="text"
                                                        value={newUser.display_name}
                                                        onChange={e => setNewUser({ ...newUser, display_name: e.target.value })}
                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm focus:outline-none focus:border-proxmox-orange"}
                                                    />
                                                </div>
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('email')}</label>
                                                    <input
                                                        type="email"
                                                        value={newUser.email}
                                                        onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm focus:outline-none focus:border-proxmox-orange"}
                                                    />
                                                </div>
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('role')}</label>
                                                    <select
                                                        value={newUser.role}
                                                        onChange={e => {
                                                            const selectedRole = e.target.value;
                                                            // Auto-select tenant when tenant-specific role is chosen
                                                            const roleObj = allRoles.find(r => r.id === selectedRole);
                                                            if (roleObj && roleObj.scope === 'tenant' && roleObj.tenant_id) {
                                                                setNewUser({ ...newUser, role: selectedRole, tenant_id: roleObj.tenant_id });
                                                            } else {
                                                                setNewUser({ ...newUser, role: selectedRole });
                                                            }
                                                        }}
                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm focus:outline-none focus:border-proxmox-orange"}
                                                    >
                                                        <optgroup label={t('builtinRole2')}>
                                                            <option value="admin">{t('roleAdmin')}</option>
                                                            <option value="user">{t('roleUser')}</option>
                                                            <option value="viewer">{t('roleViewer')}</option>
                                                        </optgroup>
                                                        {allRoles.filter(r => !r.builtin && r.scope === 'global').length > 0 && (
                                                            <optgroup label={t('customRoles2')}>
                                                                {allRoles.filter(r => !r.builtin && r.scope === 'global').map(r => (
                                                                    <option key={r.id} value={r.id}>{r.name || r.id}</option>
                                                                ))}
                                                            </optgroup>
                                                        )}
                                                        {/* Show tenant-specific roles grouped by tenant */}
                                                        {tenants.filter(t => t.id !== 'default').map(tenant => {
                                                            const tenantRoles = allRoles.filter(r => !r.builtin && r.scope === 'tenant' && r.tenant_id === tenant.id);
                                                            if (tenantRoles.length === 0) return null;
                                                            return (
                                                                <optgroup key={tenant.id} label={`${tenant.name} Roles`}>
                                                                    {tenantRoles.map(r => (
                                                                        <option key={r.id} value={r.id}>{r.name || r.id}</option>
                                                                    ))}
                                                                </optgroup>
                                                            );
                                                        })}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('tenant')}</label>
                                                    <select
                                                        value={newUser.tenant_id || 'default'}
                                                        onChange={e => setNewUser({ ...newUser, tenant_id: e.target.value })}
                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm focus:outline-none focus:border-proxmox-orange"}
                                                    >
                                                        {tenants.map(t => (
                                                            <option key={t.id} value={t.id}>{t.name}</option>
                                                        ))}
                                                    </select>
                                                    <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>{t('tenantAutoHint')}</p>
                                                </div>
                                                {newUser.role !== 'admin' && (
                                                    <div className="flex items-center gap-3 pt-5">
                                                        <label className="flex items-center gap-3 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={newUser.portal_only || false}
                                                                onChange={e => setNewUser({ ...newUser, portal_only: e.target.checked })}
                                                                className="w-4 h-4 rounded border-proxmox-border bg-proxmox-darker text-proxmox-orange focus:ring-proxmox-orange"
                                                            />
                                                            <span className="text-sm text-gray-300">{t('portalOnly')}</span>
                                                        </label>
                                                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>{t('portalOnlyHint')}</p>
                                                    </div>
                                                )}
                                                <div className="flex items-end gap-2">
                                                    <button
                                                        type="submit"
                                                        disabled={loading}
                                                        className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                                                    >
                                                        {t('create')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowAddUser(false)}
                                                        className="px-4 py-2 bg-proxmox-border hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
                                                    >
                                                        {t('cancel')}
                                                    </button>
                                                </div>
                                            </form>
                                        </div>
                                    )}

                                    {/* Users Table */}
                                    <div className="bg-proxmox-dark border border-proxmox-border rounded-xl overflow-hidden">
                                        <table className="w-full" style={{ tableLayout: 'fixed' }}>
                                            <thead>
                                                <tr className="border-b border-proxmox-border">
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase" style={{ width: '18%' }}>{t('usernameLabel')}</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase" style={{ width: '15%' }}>{t('displayName')}</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase" style={{ width: '10%' }}>{t('role')}</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase" style={{ width: '10%' }}>{t('tenant')}</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase" style={{ width: '5%' }}>2FA</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase" style={{ width: '12%' }}>{t('lastLogin')}</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase" style={{ width: '7%' }}>{t('status')}</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase" style={{ width: '7%' }}>{t('portal')}</th>
                                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase" style={{ width: '16%' }}>{t('actions')}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(() => {
                                                    const filtered = users.filter(u => {
                                                        if (!userFilter) return true;
                                                        if (userFilter === '__none__') return !u.user_folder;
                                                        return u.user_folder === userFilter;
                                                    });
                                                    const totalPages = Math.ceil(filtered.length / usersPerPage);
                                                    // Reset page if filter changes and page is out of bounds
                                                    if (userPage >= totalPages && totalPages > 0 && userPage > 0) setUserPage(0);
                                                    return filtered.slice(userPage * usersPerPage, (userPage + 1) * usersPerPage);
                                                })().map(user => (
                                                    <tr key={user.username} className="border-b border-gray-700/50 hover:bg-proxmox-hover">
                                                        <td className="px-4 py-3">
                                                            <div className="flex items-center gap-2">
                                                                <UserAvatar user={user} sizeClass="w-8 h-8" textClass="text-sm" />
                                                                <div>
                                                                    <span className="text-white font-medium truncate block" style={{ maxWidth: 'min(180px, 15vw)' }} title={user.username}>{user.username}</span>
                                                                    {editingUser === user.username && userFolders.length > 0 ? (
                                                                        <select
                                                                            value={user.user_folder || ''}
                                                                            onChange={e => handleUpdateUser(user.username, { user_folder: e.target.value })}
                                                                            disabled={updatingUser === user.username}
                                                                            className="block mt-1 text-xs bg-proxmox-dark border border-proxmox-border rounded px-1.5 py-0.5 text-gray-400 disabled:opacity-50"
                                                                        >
                                                                            <option value="">— No folder —</option>
                                                                            {userFolders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                                                        </select>
                                                                    ) : user.user_folder && userFolders.find(f => f.id === user.user_folder) ? (
                                                                        <span className="block text-xs mt-0.5" style={{ color: userFolders.find(f => f.id === user.user_folder)?.color || '#6b7280' }}>
                                                                            {userFolders.find(f => f.id === user.user_folder)?.name}
                                                                        </span>
                                                                    ) : null}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 text-gray-300"><span className="truncate block" style={{ maxWidth: 'min(160px, 12vw)' }} title={user.display_name}>{user.display_name || '-'}</span></td>
                                                        <td className="px-4 py-3">
                                                            {editingUser === user.username ? (
                                                                <select
                                                                    defaultValue={user.role}
                                                                    onChange={e => {
                                                                        const selectedRole = e.target.value;
                                                                        // Auto-include tenant_id for tenant roles
                                                                        const roleObj = allRoles.find(r => r.id === selectedRole);
                                                                        if (roleObj && roleObj.scope === 'tenant' && roleObj.tenant_id) {
                                                                            handleUpdateUser(user.username, { role: selectedRole, tenant_id: roleObj.tenant_id });
                                                                        } else {
                                                                            handleUpdateUser(user.username, { role: selectedRole });
                                                                        }
                                                                    }}
                                                                    disabled={updatingUser === user.username}
                                                                    className="px-2 py-1 bg-proxmox-darker border border-proxmox-border rounded text-sm text-white disabled:opacity-50"
                                                                >
                                                                    <optgroup label={t('builtinRole3')}>
                                                                        <option value="admin">{t('roleAdmin')}</option>
                                                                        <option value="user">{t('roleUser')}</option>
                                                                        <option value="viewer">{t('roleViewer')}</option>
                                                                    </optgroup>
                                                                    {allRoles.filter(r => !r.builtin).length > 0 && (
                                                                        <optgroup label={t('customRoles3')}>
                                                                            {allRoles.filter(r => !r.builtin).map(r => (
                                                                                <option key={r.id} value={r.id}>{r.name || r.id}</option>
                                                                            ))}
                                                                        </optgroup>
                                                                    )}
                                                                </select>
                                                            ) : (
                                                                <>
                                                                    <span className={`px-2 py-1 rounded text-xs font-medium ${user.role === 'admin' ? 'bg-red-500/10 text-red-400' :
                                                                        user.role === 'user' ? 'bg-blue-500/10 text-blue-400' :
                                                                            user.role === 'viewer' ? 'bg-gray-500/10 text-gray-400' :
                                                                                'bg-purple-500/10 text-purple-400'
                                                                        }`}>
                                                                        {user.role === 'admin' ? t('roleAdmin') :
                                                                            user.role === 'user' ? t('roleUser') :
                                                                                user.role === 'viewer' ? t('roleViewer') :
                                                                                    user.role}
                                                                    </span>
                                                                    {user.auth_source === 'ldap' && (
                                                                        <span className="px-1.5 py-0.5 rounded text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20">LDAP</span>
                                                                    )}
                                                                    {user.auth_source === 'entra' && (
                                                                        <span className="px-1.5 py-0.5 rounded text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">Entra ID</span>
                                                                    )}
                                                                    {user.auth_source === 'oidc' && (
                                                                        <span className="px-1.5 py-0.5 rounded text-xs bg-purple-500/10 text-purple-400 border border-purple-500/20">OIDC</span>
                                                                    )}
                                                                </>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-gray-400 text-sm">
                                                            {/* Show tenant name - editable when in edit mode */}
                                                            {editingUser === user.username ? (
                                                                <select
                                                                    defaultValue={user.tenant_id || 'default'}
                                                                    onChange={e => handleUpdateUser(user.username, { tenant_id: e.target.value })}
                                                                    disabled={updatingUser === user.username}
                                                                    className="px-2 py-1 bg-proxmox-darker border border-proxmox-border rounded text-sm text-white disabled:opacity-50"
                                                                >
                                                                    {tenants.map(t => (
                                                                        <option key={t.id} value={t.id}>{t.name}</option>
                                                                    ))}
                                                                </select>
                                                            ) : (
                                                                <span className="px-2 py-1 rounded text-xs bg-cyan-500/10 text-cyan-400">
                                                                    {tenants.find(t => t.id === user.tenant_id)?.name || user.tenant_id || 'Default'}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className={`px-2 py-1 rounded text-xs font-medium ${user.totp_enabled ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-500'
                                                                }`}>
                                                                {user.totp_enabled ? '✓ 2FA' : '-'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-gray-400 text-sm">
                                                            {user.last_login ? new Date(user.last_login).toLocaleString() : t('never')}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className={`px-2 py-1 rounded text-xs font-medium ${user.enabled ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                                                                }`}>
                                                                {user.enabled ? t('enabled') : t('disabled')}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            {editingUser === user.username && user.role !== 'admin' ? (
                                                                <button
                                                                    onClick={() => handleUpdateUser(user.username, { portal_only: !user.portal_only })}
                                                                    disabled={updatingUser === user.username}
                                                                    className={`px-2 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${user.portal_only ? 'bg-orange-500/10 text-orange-400 hover:bg-orange-500/20' : 'bg-gray-500/10 text-gray-500 hover:bg-gray-500/20'
                                                                        } disabled:opacity-50`}
                                                                >
                                                                    {user.portal_only ? (t('portalOnly2')) : '-'}
                                                                </button>
                                                            ) : (
                                                                <span className={`px-2 py-1 rounded text-xs font-medium ${user.portal_only ? 'bg-orange-500/10 text-orange-400' : 'text-gray-500'
                                                                    }`}>
                                                                    {user.portal_only ? (t('portalOnly3')) : '-'}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            <div className="flex items-center justify-end gap-1">
                                                                {/* Password Reset */}
                                                                {passwordResetUser === user.username ? (
                                                                    <div className="flex items-center gap-1">
                                                                        <input
                                                                            type="password"
                                                                            value={newPasswordValue}
                                                                            onChange={e => setNewPasswordValue(e.target.value)}
                                                                            placeholder={t('newPassword')}
                                                                            title={getSettingsPasswordPolicyHint()}
                                                                            disabled={passwordResetting}
                                                                            className="w-24 px-2 py-1 bg-proxmox-darker border border-proxmox-border rounded text-sm text-white disabled:opacity-50"
                                                                        />
                                                                        <button
                                                                            onClick={() => handleResetPassword(user.username)}
                                                                            disabled={passwordResetting}
                                                                            className="p-1.5 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-50"
                                                                            title="Save"
                                                                        >
                                                                            {passwordResetting ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : <Icons.Check />}
                                                                        </button>
                                                                        <button
                                                                            onClick={() => { setPasswordResetUser(null); setNewPasswordValue(''); }}
                                                                            disabled={passwordResetting}
                                                                            className="p-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50"
                                                                            title="Cancel"
                                                                        >
                                                                            <Icons.X />
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <>
                                                                        <button
                                                                            onClick={() => setPasswordResetUser(user.username)}
                                                                            className="p-1.5 rounded hover:bg-proxmox-border text-gray-400 hover:text-yellow-400"
                                                                            title={t('resetPassword')}
                                                                        >
                                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                                                            </svg>
                                                                        </button>
                                                                        {user.totp_enabled && (
                                                                            <button
                                                                                onClick={() => handleDisable2FA(user.username)}
                                                                                disabled={disabling2FA === user.username}
                                                                                className="p-1.5 rounded hover:bg-proxmox-border text-gray-400 hover:text-orange-400 disabled:opacity-50"
                                                                                title={t('disable2FA')}
                                                                            >
                                                                                {disabling2FA === user.username ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : <Icons.Shield />}
                                                                            </button>
                                                                        )}
                                                                        <button
                                                                            onClick={() => setEditingUser(editingUser === user.username ? null : user.username)}
                                                                            className="p-1.5 rounded hover:bg-proxmox-border text-gray-400 hover:text-white"
                                                                            title={t('editUser')}
                                                                        >
                                                                            <Icons.Edit />
                                                                        </button>
                                                                        <button
                                                                            onClick={() => handleUpdateUser(user.username, { enabled: !user.enabled })}
                                                                            disabled={updatingUser === user.username}
                                                                            className={`p-1.5 rounded hover:bg-proxmox-border ${user.enabled ? 'text-green-400' : 'text-red-400'} disabled:opacity-50`}
                                                                            title={user.enabled ? t('disable') : t('enable')}
                                                                        >
                                                                            {updatingUser === user.username ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : (user.enabled ? <Icons.Check /> : <Icons.X />)}
                                                                        </button>
                                                                        {user.username !== currentUser?.username && (
                                                                            <button
                                                                                onClick={() => handleDeleteUser(user.username)}
                                                                                disabled={userDeleting === user.username}
                                                                                className="p-1.5 rounded hover:bg-red-500/10 text-gray-400 hover:text-red-400 disabled:opacity-50"
                                                                                title={t('deleteUser')}
                                                                            >
                                                                                {userDeleting === user.username ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : <Icons.Trash />}
                                                                            </button>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>

                                        {/* Pagination */}
                                        {(() => {
                                            const filtered = users.filter(u => {
                                                if (!userFilter) return true;
                                                if (userFilter === '__none__') return !u.user_folder;
                                                return u.user_folder === userFilter;
                                            });
                                            const totalPages = Math.ceil(filtered.length / usersPerPage);
                                            if (totalPages <= 1) return null;
                                            return (
                                                <div className="flex items-center justify-between px-4 py-3 border-t border-proxmox-border">
                                                    <span className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>
                                                        {t('showingUsers')} {userPage * usersPerPage + 1}–{Math.min((userPage + 1) * usersPerPage, filtered.length)} {t('of')} {filtered.length}
                                                    </span>
                                                    <div className="flex gap-1">
                                                        <button
                                                            onClick={() => setUserPage(Math.max(0, userPage - 1))}
                                                            disabled={userPage === 0}
                                                            className="px-2.5 py-1 rounded text-xs border border-proxmox-border text-gray-400 hover:text-white hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed"
                                                        >←</button>
                                                        {Array.from({ length: totalPages }, (_, i) => (
                                                            <button
                                                                key={i}
                                                                onClick={() => setUserPage(i)}
                                                                className={`px-2.5 py-1 rounded text-xs border ${i === userPage ? 'bg-proxmox-orange/20 border-proxmox-orange text-proxmox-orange' : 'border-proxmox-border text-gray-400 hover:text-white hover:border-gray-500'}`}
                                                            >{i + 1}</button>
                                                        ))}
                                                        <button
                                                            onClick={() => setUserPage(Math.min(totalPages - 1, userPage + 1))}
                                                            disabled={userPage >= totalPages - 1}
                                                            className="px-2.5 py-1 rounded text-xs border border-proxmox-border text-gray-400 hover:text-white hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed"
                                                        >→</button>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                            )}

                            {/* Tenants Tab */}
                            {/* This whole section was added after Reddit feedback */}
                            {/* MSPs really wanted separate customer views */}
                            {activeTab === 'tenants' && (
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <h3 className="text-lg font-semibold text-white">{t('tenants')}</h3>
                                        <button
                                            onClick={() => setShowAddTenant(true)}
                                            className="flex items-center gap-2 px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium transition-colors"
                                        >
                                            <Icons.Plus />
                                            {t('addTenant')}
                                        </button>
                                    </div>

                                    <p className="text-sm text-gray-400">
                                        {t('tenantsDesc')}
                                    </p>

                                    {/* Add tenant form */}
                                    {showAddTenant && (
                                        <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                            <h4 className={isCorporate ? 'corp-card-header' : "text-white font-medium mb-4"}>{t('addTenant')}</h4>
                                            <div className="space-y-4">
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>Name</label>
                                                    <input
                                                        type="text"
                                                        value={newTenant.name}
                                                        onChange={e => setNewTenant({ ...newTenant, name: e.target.value })}
                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                        placeholder="Company Name"
                                                    />
                                                </div>
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('clusters3')}</label>
                                                    <p className={isCorporate ? 'corp-help-text mb-2' : "text-xs text-gray-500 mb-2"}>Select clusters this tenant can access (empty = all)</p>
                                                    <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                                                        {clusters.map(c => (
                                                            <label key={c.id} className="flex items-center gap-2 p-2 bg-proxmox-darker rounded cursor-pointer hover:bg-proxmox-hover">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={newTenant.clusters.includes(c.id)}
                                                                    onChange={e => {
                                                                        if (e.target.checked) {
                                                                            setNewTenant({ ...newTenant, clusters: [...newTenant.clusters, c.id] });
                                                                        } else {
                                                                            setNewTenant({ ...newTenant, clusters: newTenant.clusters.filter(x => x !== c.id) });
                                                                        }
                                                                    }}
                                                                    className="rounded"
                                                                />
                                                                <span className="text-sm text-white">{c.name}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={async () => {
                                                            setTenantSaving(true);
                                                            try {
                                                                const r = await fetch(`${API_URL}/tenants`, {
                                                                    method: 'POST',
                                                                    credentials: 'include',
                                                                    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                                                                    body: JSON.stringify(newTenant)
                                                                });
                                                                if (r.ok) {
                                                                    addToast('Tenant created', 'success');
                                                                    setShowAddTenant(false);
                                                                    setNewTenant({ name: '', clusters: [] });
                                                                    fetchTenants();
                                                                } else {
                                                                    const err = await r.json();
                                                                    addToast(err.error || 'Error', 'error');
                                                                }
                                                            } catch (e) { addToast('Error', 'error'); }
                                                            finally { setTenantSaving(false); }
                                                        }}
                                                        disabled={tenantSaving}
                                                        className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                                                    >
                                                        {tenantSaving ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : null}
                                                        {t('create')}
                                                    </button>
                                                    <button
                                                        onClick={() => { setShowAddTenant(false); setNewTenant({ name: '', clusters: [] }); }}
                                                        disabled={tenantSaving}
                                                        className="px-4 py-2 bg-proxmox-dark border border-proxmox-border hover:bg-proxmox-hover rounded-lg text-sm text-gray-300 disabled:opacity-50"
                                                    >
                                                        {t('cancel')}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Tenants list */}
                                    <div className="bg-proxmox-dark border border-proxmox-border rounded-xl overflow-hidden">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-proxmox-border bg-proxmox-darker">
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Name</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t('clusters')}</th>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t('users')}</th>
                                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">{t('actions')}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-proxmox-border">
                                                {tenants.map(tenant => (
                                                    <tr key={tenant.id} className="hover:bg-proxmox-hover/50">
                                                        <td className="px-4 py-3">
                                                            <div className="flex items-center gap-2">
                                                                <Icons.Building className="w-4 h-4 text-gray-400" />
                                                                <span className="text-white font-medium">{tenant.name}</span>
                                                                {tenant.id === 'default' && (
                                                                    <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">Default</span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 text-sm text-gray-400">
                                                            {tenant.clusters.length === 0 ? 'All clusters' : tenant.clusters.length + ' clusters'}
                                                            {(tenant.quota_max_vms > 0 || tenant.quota_max_cores > 0 || tenant.quota_max_memory_gb > 0) && (
                                                                <div className="text-xs text-gray-600 mt-0.5">
                                                                    {t('quota')}: {tenant.quota_max_vms > 0 ? `${tenant.quota_max_vms} VMs ` : ''}{tenant.quota_max_cores > 0 ? `${tenant.quota_max_cores}c ` : ''}{tenant.quota_max_memory_gb > 0 ? `${tenant.quota_max_memory_gb}GB` : ''}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-sm text-gray-400">{tenant.user_count || 0}</td>
                                                        <td className="px-4 py-3 text-right">
                                                            <div className="flex items-center justify-end gap-2">
                                                                <button
                                                                    onClick={async () => {
                                                                        setChargebackTenant(tenant);  // #502b - open chargeback
                                                                        setChargeback(null);
                                                                        try {
                                                                            const r = await fetch(`${API_URL}/tenants/${tenant.id}/chargeback?days=30`, { credentials: 'include', headers: getAuthHeaders() });
                                                                            if (r.ok) setChargeback(await r.json());
                                                                        } catch (e) { /* best-effort */ }
                                                                    }}
                                                                    className="p-1.5 text-gray-400 hover:text-white hover:bg-proxmox-border rounded"
                                                                    title={t('chargeback')}
                                                                >
                                                                    <Icons.DollarSign className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={async () => {
                                                                        setEditingTenant({ ...tenant });
                                                                        setTenantUsage(null);  // #502 - load live usage
                                                                        try {
                                                                            const r = await fetch(`${API_URL}/tenants/${tenant.id}/quota`, { credentials: 'include', headers: getAuthHeaders() });
                                                                            if (r.ok) setTenantUsage(await r.json());
                                                                        } catch (e) { /* usage is best-effort */ }
                                                                    }}
                                                                    className="p-1.5 text-gray-400 hover:text-white hover:bg-proxmox-border rounded"
                                                                    title={t('edit')}
                                                                >
                                                                    <Icons.Edit className="w-4 h-4" />
                                                                </button>
                                                                {tenant.id !== 'default' && (
                                                                    <button
                                                                        onClick={async () => {
                                                                            if (!confirm(`Delete tenant "${tenant.name}"?`)) return;
                                                                            try {
                                                                                const r = await fetch(`${API_URL}/tenants/${tenant.id}`, {
                                                                                    method: 'DELETE',
                                                                                    credentials: 'include',
                                                                                    headers: getAuthHeaders()
                                                                                });
                                                                                if (r.ok) {
                                                                                    addToast('Tenant deleted', 'success');
                                                                                    fetchTenants();
                                                                                } else {
                                                                                    const err = await r.json();
                                                                                    addToast(err.error || 'Error', 'error');
                                                                                }
                                                                            } catch (e) { }
                                                                        }}
                                                                        className="p-1.5 text-red-400 hover:bg-red-500/20 rounded"
                                                                    >
                                                                        <Icons.Trash className="w-4 h-4" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Edit Tenant Modal - Dec 2025 */}
                                    {editingTenant && (
                                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                                            <div className={isCorporate ? 'corp-settings-card max-w-lg w-full' : "bg-proxmox-darker border border-proxmox-border rounded-xl p-6 w-full max-w-lg"}>
                                                <h3 className={isCorporate ? 'corp-card-header' : "text-lg font-semibold text-white mb-4"}>
                                                    {t('editTenant')}: {editingTenant.name}
                                                </h3>

                                                <div className="space-y-4">
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>Name</label>
                                                        <input
                                                            type="text"
                                                            value={editingTenant.name}
                                                            onChange={e => setEditingTenant({ ...editingTenant, name: e.target.value })}
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                                                        />
                                                    </div>

                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('clusters4')}</label>
                                                        <p className={isCorporate ? 'corp-help-text mb-2' : "text-xs text-gray-500 mb-2"}>{t('tenantClustersHint')}</p>
                                                        <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto bg-proxmox-dark rounded-lg p-3">
                                                            {clusters.map(c => (
                                                                <label key={c.id} className="flex items-center gap-2 p-2 hover:bg-proxmox-hover rounded cursor-pointer">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={editingTenant.clusters?.includes(c.id)}
                                                                        onChange={e => {
                                                                            if (e.target.checked) {
                                                                                setEditingTenant({ ...editingTenant, clusters: [...(editingTenant.clusters || []), c.id] });
                                                                            } else {
                                                                                setEditingTenant({ ...editingTenant, clusters: (editingTenant.clusters || []).filter(x => x !== c.id) });
                                                                            }
                                                                        }}
                                                                        className="rounded border-gray-600"
                                                                    />
                                                                    <span className="text-sm text-white">{c.name}</span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    {/* #502 - resource quotas (0 = unlimited) */}
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('quotas')} <span className="text-xs text-gray-600">({t('quotaZeroHint')})</span></label>
                                                        {tenantUsage && tenantUsage.usage && tenantUsage.usage.vms !== undefined && (
                                                            <p className={isCorporate ? 'corp-help-text mb-2' : "text-xs text-gray-500 mb-2"}>{t('currentUsage')}: {tenantUsage.usage.vms} VMs · {tenantUsage.usage.cores} {t('cores2')} · {tenantUsage.usage.memory_gb} GB</p>
                                                        )}
                                                        <div className="grid grid-cols-3 gap-2">
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-500 mb-1"}>{t('maxVms')}</label>
                                                                <input type="number" min="0" value={editingTenant.quota_max_vms || 0}
                                                                    onChange={e => setEditingTenant({ ...editingTenant, quota_max_vms: parseInt(e.target.value) || 0 })}
                                                                    className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"} />
                                                            </div>
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-500 mb-1"}>{t('maxCores')}</label>
                                                                <input type="number" min="0" value={editingTenant.quota_max_cores || 0}
                                                                    onChange={e => setEditingTenant({ ...editingTenant, quota_max_cores: parseInt(e.target.value) || 0 })}
                                                                    className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"} />
                                                            </div>
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-500 mb-1"}>{t('maxMemoryGb')}</label>
                                                                <input type="number" min="0" value={editingTenant.quota_max_memory_gb || 0}
                                                                    onChange={e => setEditingTenant({ ...editingTenant, quota_max_memory_gb: parseInt(e.target.value) || 0 })}
                                                                    className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"} />
                                                            </div>
                                                        </div>
                                                        <div className="mt-2">
                                                            <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-500 mb-1"}>{t('quotaEnforcement')}</label>
                                                            <select value={editingTenant.quota_enforcement || 'block'}
                                                                onChange={e => setEditingTenant({ ...editingTenant, quota_enforcement: e.target.value })}
                                                                className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}>
                                                                <option value="block">{t('quotaBlock')}</option>
                                                                <option value="warn">{t('quotaWarn')}</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex gap-2 mt-6">
                                                    <button
                                                        onClick={async () => {
                                                            try {
                                                                const r = await fetch(`${API_URL}/tenants/${editingTenant.id}`, {
                                                                    method: 'PUT',
                                                                    credentials: 'include',
                                                                    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({
                                                                        name: editingTenant.name,
                                                                        clusters: editingTenant.clusters || [],
                                                                        quota_max_vms: editingTenant.quota_max_vms || 0,
                                                                        quota_max_cores: editingTenant.quota_max_cores || 0,
                                                                        quota_max_memory_gb: editingTenant.quota_max_memory_gb || 0,
                                                                        quota_enforcement: editingTenant.quota_enforcement || 'block'
                                                                    })
                                                                });
                                                                if (r.ok) {
                                                                    addToast(t('tenantSaved'), 'success');
                                                                    setEditingTenant(null);
                                                                    fetchTenants();
                                                                } else {
                                                                    const err = await r.json();
                                                                    addToast(err.error || 'Error', 'error');
                                                                }
                                                            } catch (e) { addToast('Error', 'error'); }
                                                        }}
                                                        className="flex-1 px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium"
                                                    >
                                                        {t('save')}
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingTenant(null)}
                                                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
                                                    >
                                                        {t('cancel')}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {/* #502b - chargeback statement modal */}
                                    {chargebackTenant && (
                                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setChargebackTenant(null)}>
                                            <div className={isCorporate ? 'corp-settings-card max-h-[85vh] max-w-2xl overflow-y-auto w-full' : "bg-proxmox-darker border border-proxmox-border rounded-xl p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto"} onClick={e => e.stopPropagation()}>
                                                <div className="flex justify-between items-start mb-4">
                                                    <div>
                                                        <h3 className="text-lg font-semibold text-white">{t('chargeback')}: {chargebackTenant.name}</h3>
                                                        {chargeback && (
                                                            <p className="text-sm text-gray-400">{t('monthlyEstimate')}: <span className="text-proxmox-orange font-semibold">{chargeback.monthly_total} {chargeback.currency}</span> <span className="text-xs text-gray-600">({t('basedOnLast')} {chargeback.days}d)</span></p>
                                                        )}
                                                    </div>
                                                    <button onClick={() => setChargebackTenant(null)} className="p-1 text-gray-400 hover:text-white"><Icons.X className="w-5 h-5" /></button>
                                                </div>
                                                {!chargeback ? (
                                                    <p className="text-sm text-gray-500 py-6 text-center">{t('loading')}</p>
                                                ) : (
                                                    <div className="space-y-4">
                                                        <div className="space-y-1">
                                                            {(chargeback.by_cluster || []).map(c => (
                                                                <div key={c.cluster_id} className="flex justify-between text-sm bg-proxmox-dark rounded px-3 py-2">
                                                                    <span className="text-gray-300">{c.cluster_name} <span className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>({c.vm_count} VMs{c.enough_data ? '' : ' · ' + (t('noData'))})</span></span>
                                                                    <span className="text-gray-200">{c.monthly_subtotal} {chargeback.currency}/mo</span>
                                                                </div>
                                                            ))}
                                                            {(chargeback.by_cluster || []).length === 0 && <p className="text-sm text-gray-500">{t('noClustersForTenant')}</p>}
                                                        </div>
                                                        {(chargeback.rows || []).length > 0 && (
                                                            <div>
                                                                <div className="text-xs text-gray-500 uppercase mb-1">{t('topVmsByCost')}</div>
                                                                <table className="w-full text-sm">
                                                                    <tbody className="divide-y divide-proxmox-border">
                                                                        {(chargeback.rows || []).slice(0, 10).map(r => (
                                                                            <tr key={r.cluster_id + ':' + r.vmid}>
                                                                                <td className="py-1.5 text-gray-300">{r.name || r.vmid} <span className="text-xs text-gray-600">{r.cluster_name}</span></td>
                                                                                <td className="py-1.5 text-right text-gray-400">{r.monthly_total} {chargeback.currency}/mo</td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        )}
                                                        <div className="flex justify-end gap-2 pt-2">
                                                            <a href={`${API_URL}/tenants/${chargebackTenant.id}/chargeback?days=30&format=csv`} target="_blank" rel="noopener" className="px-4 py-2 bg-proxmox-dark border border-proxmox-border hover:bg-proxmox-hover rounded-lg text-sm text-gray-300">{t('downloadCsv')}</a>
                                                            <button onClick={() => setChargebackTenant(null)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">{t('close')}</button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Cluster Groups Tab - */}
                            {activeTab === 'groups' && (
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <h3 className="text-lg font-semibold text-white">{t('clusterGroups')}</h3>
                                            <p className="text-sm text-gray-400 mt-1">{t('clusterGroupsDesc')}</p>
                                        </div>
                                        <button
                                            onClick={() => setShowAddGroup(true)}
                                            className="flex items-center gap-2 px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium"
                                        >
                                            <Icons.Plus className="w-4 h-4" />
                                            {t('addGroup')}
                                        </button>
                                    </div>

                                    {/* Groups List */}
                                    <div className="space-y-3">
                                        {clusterGroups.length === 0 ? (
                                            <div className="text-center py-8 text-gray-500">
                                                <Icons.Folder className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                                <p>{t('noGroupsYet')}</p>
                                                <p className="text-sm mt-1">{t('createGroupFirst')}</p>
                                            </div>
                                        ) : (
                                            clusterGroups.map(group => {
                                                const groupClusters = clusters.filter(c => c.group_id === group.id);
                                                const tenant = tenants.find(t => t.id === group.tenant_id);
                                                return (
                                                    <div key={group.id} className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: group.color || '#E86F2D' }} />
                                                                <div>
                                                                    <h4 className={isCorporate ? 'corp-card-header' : "font-medium text-white"}>{group.name}</h4>
                                                                    {group.description && <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>{group.description}</p>}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-4">
                                                                {tenant && (
                                                                    <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">
                                                                        Tenant: {tenant.name}
                                                                    </span>
                                                                )}
                                                                <span className="text-sm text-gray-400">{groupClusters.length} cluster(s)</span>
                                                                <div className="flex items-center gap-1">
                                                                    <button
                                                                        onClick={() => setEditingGroup(group)}
                                                                        className="p-1.5 text-gray-400 hover:text-white hover:bg-proxmox-hover rounded"
                                                                    >
                                                                        <Icons.Edit className="w-4 h-4" />
                                                                    </button>
                                                                    <button
                                                                        onClick={async () => {
                                                                            if (!confirm(`Delete group "${group.name}"?`)) return;
                                                                            try {
                                                                                const r = await fetch(`${API_URL}/cluster-groups/${group.id}`, {
                                                                                    method: 'DELETE',
                                                                                    credentials: 'include',
                                                                                    headers: getAuthHeaders()
                                                                                });
                                                                                if (r.ok) {
                                                                                    addToast('Group deleted', 'success');
                                                                                    fetchClusterGroups();
                                                                                    onGroupsChanged?.();
                                                                                } else {
                                                                                    const err = await r.json();
                                                                                    addToast(err.error || 'Error', 'error');
                                                                                }
                                                                            } catch (e) { }
                                                                        }}
                                                                        className="p-1.5 text-red-400 hover:bg-red-500/20 rounded"
                                                                    >
                                                                        <Icons.Trash className="w-4 h-4" />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {/* Clusters in this group */}
                                                        {groupClusters.length > 0 && (
                                                            <div className="mt-3 pt-3 border-t border-proxmox-border">
                                                                <div className="flex flex-wrap gap-2">
                                                                    {groupClusters.map(c => (
                                                                        <span key={c.id} className="px-2 py-1 bg-proxmox-card border border-proxmox-border rounded text-xs text-gray-300">
                                                                            {c.display_name || c.name || c.host}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>

                                    {/* All Clusters — rename + group assignment */}
                                    <div className="mt-6">
                                        <h3 className={isCorporate ? 'corp-card-header' : "text-lg font-semibold text-white mb-3"}>{t('allClusters')}</h3>
                                        <div className="space-y-2">
                                            {clusters.length === 0 ? (
                                                <p className="text-gray-500 text-sm py-4 text-center">{t('noClustersAdded')}</p>
                                            ) : clusters.map(c => {
                                                const grp = clusterGroups.find(g => g.id === c.group_id);
                                                return (
                                                    <div key={c.id} className={isCorporate ? 'corp-settings-card flex items-center justify-between' : "flex items-center justify-between bg-proxmox-dark border border-proxmox-border rounded-lg px-4 py-3"}>
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.enabled !== false ? 'bg-green-500' : 'bg-gray-500'}`} />
                                                            <div className="min-w-0">
                                                                <div className="text-sm font-medium text-white truncate">
                                                                    {c.display_name || c.name || c.host}
                                                                    {c.display_name && c.display_name !== c.name && (
                                                                        <span className="ml-2 text-xs text-gray-500">({c.name})</span>
                                                                    )}
                                                                </div>
                                                                <div className="text-xs text-gray-500 flex items-center gap-2">
                                                                    <span>{c.host}</span>
                                                                    {grp && <span className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: (grp.color || '#E86F2D') + '30', color: grp.color }}>{grp.name}</span>}
                                                                    {c.cluster_type && c.cluster_type !== 'proxmox' && <span className="text-yellow-500">{c.cluster_type.toUpperCase()}</span>}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => { setRenamingCluster(c); setRenameValue(c.display_name || c.name || ''); }}
                                                            className="p-1.5 text-gray-400 hover:text-white hover:bg-proxmox-hover rounded flex-shrink-0"
                                                            title={t('renameCluster5')}
                                                        >
                                                            <Icons.Edit className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Rename Cluster Modal */}
                                    {renamingCluster && (
                                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setRenamingCluster(null)}>
                                            <div className={isCorporate ? 'corp-settings-card max-w-md w-full' : "bg-proxmox-card border border-proxmox-border rounded-xl w-full max-w-md p-6"} onClick={e => e.stopPropagation()}>
                                                <h3 className={isCorporate ? 'corp-card-header' : "text-lg font-semibold mb-1"}>{t('renameCluster')}</h3>
                                                <p className="text-sm text-gray-400 mb-4">{renamingCluster.name} ({renamingCluster.host})</p>
                                                <div className="space-y-3">
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('displayName')}</label>
                                                        <input
                                                            type="text"
                                                            value={renameValue}
                                                            onChange={e => setRenameValue(e.target.value)}
                                                            onKeyDown={e => { if (e.key === 'Enter' && renameValue.trim()) handleRenameCluster(); }}
                                                            placeholder={renamingCluster.name}
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}
                                                            autoFocus
                                                        />
                                                        <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>{t('renameHint')}</p>
                                                    </div>
                                                </div>
                                                <div className="flex justify-end gap-3 mt-5">
                                                    <button onClick={() => setRenamingCluster(null)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">
                                                        {t('cancel')}
                                                    </button>
                                                    <button
                                                        onClick={handleRenameCluster}
                                                        className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium"
                                                    >
                                                        {t('rename')}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Add/Edit Group Modal */}
                                    {(showAddGroup || editingGroup) && (
                                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                                            <div className={isCorporate ? 'corp-settings-card max-w-md w-full' : "bg-proxmox-card border border-proxmox-border rounded-xl w-full max-w-md p-6"}>
                                                <h3 className={isCorporate ? 'corp-card-header' : "text-lg font-semibold mb-4"}>{editingGroup ? 'Edit Group' : 'Add Cluster Group'}</h3>
                                                <div className="space-y-4">
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>Name *</label>
                                                        <input
                                                            type="text"
                                                            value={editingGroup ? editingGroup.name : newGroup.name}
                                                            onChange={e => editingGroup ? setEditingGroup({ ...editingGroup, name: e.target.value }) : setNewGroup({ ...newGroup, name: e.target.value })}
                                                            placeholder="Production Clusters"
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>Description</label>
                                                        <input
                                                            type="text"
                                                            value={editingGroup ? editingGroup.description : newGroup.description}
                                                            onChange={e => editingGroup ? setEditingGroup({ ...editingGroup, description: e.target.value }) : setNewGroup({ ...newGroup, description: e.target.value })}
                                                            placeholder="Production environment clusters"
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>Color</label>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="color"
                                                                value={editingGroup ? editingGroup.color : newGroup.color}
                                                                onChange={e => editingGroup ? setEditingGroup({ ...editingGroup, color: e.target.value }) : setNewGroup({ ...newGroup, color: e.target.value })}
                                                                className="w-10 h-10 rounded cursor-pointer"
                                                            />
                                                            <span className="text-sm text-gray-400">{editingGroup ? editingGroup.color : newGroup.color}</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>Assign to Tenant (optional)</label>
                                                        <select
                                                            value={editingGroup ? (editingGroup.tenant_id || '') : (newGroup.tenant_id || '')}
                                                            onChange={e => editingGroup ? setEditingGroup({ ...editingGroup, tenant_id: e.target.value || null }) : setNewGroup({ ...newGroup, tenant_id: e.target.value || null })}
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}
                                                        >
                                                            <option value="">No tenant (visible to all)</option>
                                                            {tenants.filter(t => t.id !== 'default').map(t => (
                                                                <option key={t.id} value={t.id}>{t.name}</option>
                                                            ))}
                                                        </select>
                                                        <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>If assigned, only this tenant can see clusters in this group</p>
                                                    </div>
                                                </div>
                                                <div className="flex justify-end gap-3 mt-6">
                                                    <button
                                                        onClick={() => { setShowAddGroup(false); setEditingGroup(null); setNewGroup({ name: '', description: '', color: '#E86F2D' }); }}
                                                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        onClick={async () => {
                                                            const data = editingGroup || newGroup;
                                                            if (!data.name) { addToast('Name required', 'error'); return; }
                                                            try {
                                                                const url = editingGroup ? `${API_URL}/cluster-groups/${editingGroup.id}` : `${API_URL}/cluster-groups`;
                                                                const r = await fetch(url, {
                                                                    method: editingGroup ? 'PUT' : 'POST',
                                                                    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify(data)
                                                                });
                                                                if (r.ok) {
                                                                    addToast(editingGroup ? 'Group updated' : 'Group created', 'success');
                                                                    setShowAddGroup(false);
                                                                    setEditingGroup(null);
                                                                    setNewGroup({ name: '', description: '', color: '#E86F2D' });
                                                                    fetchClusterGroups();
                                                                    onGroupsChanged?.();
                                                                } else {
                                                                    const err = await r.json();
                                                                    addToast(err.error || 'Error', 'error');
                                                                }
                                                            } catch (e) { addToast('Error', 'error'); }
                                                        }}
                                                        className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm"
                                                    >
                                                        {editingGroup ? 'Save' : 'Create'}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Permissions Tab - Granular access control */}
                            {activeTab === 'permissions' && (
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <h3 className="text-lg font-semibold text-white">{t('permissions')}</h3>
                                    </div>

                                    {/* Sub-tabs for permissions */}
                                    {isCorporate ? (
                                        <div className="corp-tab-strip">
                                            <button onClick={() => setPermSubTab('users')} className={permSubTab === 'users' ? 'active' : ''}>
                                                <Icons.User style={{ width: 14, height: 14, display: 'inline', marginRight: 6 }} />
                                                {t('userPermissions')}
                                            </button>
                                            <button onClick={() => setPermSubTab('vms')} className={permSubTab === 'vms' ? 'active' : ''}>
                                                <Icons.VM style={{ width: 14, height: 14, display: 'inline', marginRight: 6 }} />
                                                {t('vmPermissions')}
                                            </button>
                                            <button onClick={() => setPermSubTab('pools')} className={permSubTab === 'pools' ? 'active' : ''}>
                                                <Icons.Layers style={{ width: 14, height: 14, display: 'inline', marginRight: 6 }} />
                                                {t('poolPermissions')}
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2 border-b border-proxmox-border pb-2">
                                            <button
                                                onClick={() => setPermSubTab('users')}
                                                className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${permSubTab === 'users'
                                                    ? 'bg-proxmox-orange text-white'
                                                    : 'bg-proxmox-dark text-gray-400 hover:text-white'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Icons.User />
                                                    {t('userPermissions')}
                                                </div>
                                            </button>
                                            <button
                                                onClick={() => setPermSubTab('vms')}
                                                className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${permSubTab === 'vms'
                                                    ? 'bg-proxmox-orange text-white'
                                                    : 'bg-proxmox-dark text-gray-400 hover:text-white'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Icons.VM />
                                                    {t('vmPermissions')}
                                                </div>
                                            </button>
                                            <button
                                                onClick={() => setPermSubTab('pools')}
                                                className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${permSubTab === 'pools'
                                                    ? 'bg-proxmox-orange text-white'
                                                    : 'bg-proxmox-dark text-gray-400 hover:text-white'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Icons.Layers />
                                                    {t('poolPermissions')}
                                                </div>
                                            </button>
                                        </div>
                                    )}

                                    {/* User Permissions Sub-Tab */}
                                    {permSubTab === 'users' && (
                                        <div>
                                            <p className={isCorporate ? 'corp-help-text mb-4' : "text-sm text-gray-400 mb-4"}>
                                                {t('permissionsDesc')}
                                            </p>

                                            <div className="grid grid-cols-3 gap-4">
                                                {/* User selector */}
                                                <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                                    <h4 className={isCorporate ? 'corp-card-header' : "font-medium text-white mb-3"}>{t('selectUser')}</h4>
                                                    <div className="space-y-2 max-h-96 overflow-y-auto">
                                                        {users.map(u => (
                                                            <button
                                                                key={u.username}
                                                                onClick={() => { setSelectedUser(u.username); fetchUserPermissions(u.username); }}
                                                                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedUser === u.username
                                                                    ? 'bg-proxmox-orange text-white'
                                                                    : 'bg-proxmox-darker text-gray-300 hover:bg-proxmox-hover'
                                                                    }`}
                                                            >
                                                                <div className="font-medium">{u.display_name || u.username}</div>
                                                                <div className="text-xs opacity-70">{u.role}</div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Permissions editor */}
                                                <div className={isCorporate ? 'corp-settings-card col-span-2' : "col-span-2 bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                                    {selectedUser && userPermissions ? (
                                                        <div className="space-y-4">
                                                            <div className="flex justify-between items-center">
                                                                <h4 className={isCorporate ? 'corp-card-header' : "font-medium text-white"}>
                                                                    Permissions for {selectedUser}
                                                                    <span className={isCorporate ? 'corp-help-text ml-2' : "ml-2 text-xs text-gray-400"}>({userPermissions.role})</span>
                                                                </h4>
                                                                <button
                                                                    onClick={async () => {
                                                                        try {
                                                                            const r = await fetch(`${API_URL}/users/${selectedUser}/permissions`, {
                                                                                method: 'PUT',
                                                                                credentials: 'include',
                                                                                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                                                                                body: JSON.stringify({
                                                                                    permissions: userPermissions.extra_permissions,
                                                                                    denied_permissions: userPermissions.denied_permissions
                                                                                })
                                                                            });
                                                                            if (r.ok) {
                                                                                addToast('Permissions saved', 'success');
                                                                                fetchUserPermissions(selectedUser);
                                                                            }
                                                                        } catch (e) { }
                                                                    }}
                                                                    className="px-3 py-1.5 bg-proxmox-orange hover:bg-orange-600 rounded text-sm font-medium"
                                                                >
                                                                    {t('save')}
                                                                </button>
                                                            </div>

                                                            <div className={isCorporate ? 'corp-help-text mb-2' : "text-xs text-gray-500 mb-2"}>
                                                                ✓ = granted by role | + = extra permission | ✗ = denied
                                                            </div>

                                                            <div className="grid grid-cols-2 gap-4 max-h-80 overflow-y-auto">
                                                                {Object.entries(
                                                                    allPermissions.reduce((acc, p) => {
                                                                        const cat = p.category;
                                                                        if (!acc[cat]) acc[cat] = [];
                                                                        acc[cat].push(p);
                                                                        return acc;
                                                                    }, {})
                                                                ).map(([category, perms]) => (
                                                                    <div key={category} className={isCorporate ? 'corp-settings-card' : "bg-proxmox-darker rounded-lg p-3"}>
                                                                        <h5 className={isCorporate ? 'corp-card-header capitalize' : "text-sm font-medium text-white mb-2 capitalize"}>{category}</h5>
                                                                        <div className="space-y-1">
                                                                            {perms.map(p => {
                                                                                const fromRole = userPermissions.role_permissions?.includes(p.permission);
                                                                                const extra = userPermissions.extra_permissions?.includes(p.permission);
                                                                                const denied = userPermissions.denied_permissions?.includes(p.permission);
                                                                                const effective = userPermissions.effective_permissions?.includes(p.permission);

                                                                                return (
                                                                                    <div key={p.permission} className="flex items-center justify-between py-1">
                                                                                        <span className={`text-xs ${effective ? 'text-green-400' : 'text-gray-500'}`}>
                                                                                            {p.permission.split('.')[1]}
                                                                                        </span>
                                                                                        <div className="flex items-center gap-1">
                                                                                            {fromRole && <span className="text-xs text-blue-400">✓</span>}
                                                                                            <button
                                                                                                onClick={() => {
                                                                                                    if (extra) {
                                                                                                        setUserPermissions({
                                                                                                            ...userPermissions,
                                                                                                            extra_permissions: userPermissions.extra_permissions.filter(x => x !== p.permission)
                                                                                                        });
                                                                                                    } else {
                                                                                                        setUserPermissions({
                                                                                                            ...userPermissions,
                                                                                                            extra_permissions: [...(userPermissions.extra_permissions || []), p.permission],
                                                                                                            denied_permissions: (userPermissions.denied_permissions || []).filter(x => x !== p.permission)
                                                                                                        });
                                                                                                    }
                                                                                                }}
                                                                                                className={`px-1.5 py-0.5 text-xs rounded ${extra ? 'bg-green-500/20 text-green-400' : 'bg-proxmox-dark text-gray-500 hover:text-green-400'}`}
                                                                                            >
                                                                                                +
                                                                                            </button>
                                                                                            <button
                                                                                                onClick={() => {
                                                                                                    if (denied) {
                                                                                                        setUserPermissions({
                                                                                                            ...userPermissions,
                                                                                                            denied_permissions: userPermissions.denied_permissions.filter(x => x !== p.permission)
                                                                                                        });
                                                                                                    } else {
                                                                                                        setUserPermissions({
                                                                                                            ...userPermissions,
                                                                                                            denied_permissions: [...(userPermissions.denied_permissions || []), p.permission],
                                                                                                            extra_permissions: (userPermissions.extra_permissions || []).filter(x => x !== p.permission)
                                                                                                        });
                                                                                                    }
                                                                                                }}
                                                                                                className={`px-1.5 py-0.5 text-xs rounded ${denied ? 'bg-red-500/20 text-red-400' : 'bg-proxmox-dark text-gray-500 hover:text-red-400'}`}
                                                                                            >
                                                                                                ✗
                                                                                            </button>
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center justify-center h-64 text-gray-500">
                                                            {t('selectUserToEdit')}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* VM Permissions Sub-Tab */}
                                    {permSubTab === 'vms' && (
                                        <div>
                                            {/* VM-Level Access Control Section - Dec 2025 */}
                                            <div className="pt-2">
                                                <div className="flex justify-between items-center mb-4">
                                                    <div>
                                                        <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "text-md font-semibold text-white flex items-center gap-2"}>
                                                            <Icons.Shield />
                                                            {t('vmAcl')}
                                                        </h4>
                                                        <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>{t('vmAclDesc2')}</p>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-3 gap-4">
                                                    {/* Cluster selector */}
                                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-2"}>{t('selectCluster6')}</label>
                                                        <select
                                                            value={selectedClusterForAcl}
                                                            onChange={e => {
                                                                setSelectedClusterForAcl(e.target.value);
                                                                fetchVmAcls(e.target.value);
                                                                fetchVmsForAcl(e.target.value);
                                                            }}
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                        >
                                                            <option value="">{t('select2')}</option>
                                                            {clusters.map(c => (
                                                                <option key={c.id} value={c.id}>{c.name}</option>
                                                            ))}
                                                        </select>

                                                        {selectedClusterForAcl && (
                                                            <button
                                                                onClick={() => {
                                                                    setSelectedVmForAcl(null);
                                                                    setVmAclUsers([]);
                                                                    setVmAclPerms([]);
                                                                    setVmAclInherit(true);
                                                                    setShowVmAclModal(true);
                                                                }}
                                                                className="mt-3 w-full px-3 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                                                            >
                                                                <Icons.Plus />
                                                                {t('addVmAcl')}
                                                            </button>
                                                        )}
                                                    </div>

                                                    {/* VM ACLs list */}
                                                    <div className={isCorporate ? 'corp-settings-card col-span-2' : "col-span-2 bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                                        <h4 className={isCorporate ? 'corp-card-header' : "font-medium text-white mb-3"}>{t('vmPermissions')}</h4>
                                                        {selectedClusterForAcl ? (
                                                            vmAcls.length > 0 ? (
                                                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                                                    {vmAcls.map(acl => {
                                                                        const vm = availableVms.find(v => v.vmid === acl.vmid);
                                                                        return (
                                                                            <div key={acl.vmid} className={isCorporate ? 'corp-settings-card flex items-center justify-between' : "flex items-center justify-between p-3 bg-proxmox-darker rounded-lg"}>
                                                                                <div>
                                                                                    <div className="text-white text-sm font-medium">
                                                                                        {vm?.name || `VM ${acl.vmid}`}
                                                                                        <span className={isCorporate ? 'corp-help-text ml-2' : "ml-2 text-xs text-gray-500"}>({acl.vmid})</span>
                                                                                    </div>
                                                                                    <div className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-400 mt-1"}>
                                                                                        {acl.users?.length || 0} users •
                                                                                        {acl.inherit_role ? ' Inherits role permissions' : ` ${acl.permissions?.length || 0} custom permissions`}
                                                                                    </div>
                                                                                </div>
                                                                                <div className="flex items-center gap-2">
                                                                                    <button
                                                                                        onClick={() => {
                                                                                            setSelectedVmForAcl(acl.vmid);
                                                                                            setVmAclUsers(acl.users || []);
                                                                                            setVmAclPerms(acl.permissions || []);
                                                                                            setVmAclInherit(acl.inherit_role !== false);
                                                                                            setShowVmAclModal(true);
                                                                                        }}
                                                                                        className="px-2 py-1 text-xs bg-proxmox-border hover:bg-gray-600 rounded"
                                                                                    >
                                                                                        {t('edit')}
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={() => deleteVmAcl(acl.vmid)}
                                                                                        className="px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded"
                                                                                    >
                                                                                        {t('delete')}
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            ) : (
                                                                <div className={isCorporate ? 'corp-help-text text-center py-8' : "text-center py-8 text-gray-500"}>
                                                                    {t('noVmAcls')}
                                                                </div>
                                                            )
                                                        ) : (
                                                            <div className={isCorporate ? 'corp-help-text text-center py-8' : "text-center py-8 text-gray-500"}>
                                                                {t('selectClusterFirst7')}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* VM ACL Modal */}
                                            {showVmAclModal && (
                                                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                                                    <div className={isCorporate ? 'corp-settings-card w-full max-w-lg' : "bg-proxmox-darker border border-proxmox-border rounded-xl p-6 w-full max-w-lg"}>
                                                        <h3 className="text-lg font-semibold text-white mb-4">
                                                            {selectedVmForAcl ? t('editVmAcl') : t('addVmAcl')}
                                                        </h3>

                                                        <div className="space-y-4">
                                                            {/* VM selector (only for new) */}
                                                            {!selectedVmForAcl && (
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('selectVm4')}</label>
                                                                    <select
                                                                        value={selectedVmForAcl || ''}
                                                                        onChange={e => {
                                                                            const val = e.target.value;
                                                                            setSelectedVmForAcl(val ? parseInt(val) : null);
                                                                        }}
                                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                                                                    >
                                                                        <option value="">-- {t('selectVm5')} --</option>
                                                                        {availableVms.map(vm => (
                                                                            <option key={vm.vmid} value={vm.vmid}>
                                                                                {vm.name || `VM ${vm.vmid}`} ({vm.vmid}) - {vm.status}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                    {availableVms.length === 0 && (
                                                                        <p className="text-xs text-yellow-500 mt-1">{t('noVmsInCluster')}</p>
                                                                    )}
                                                                </div>
                                                            )}

                                                            {/* Users with access */}
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('usersWithAccess')}</label>
                                                                <div className={isCorporate ? 'corp-settings-card max-h-40 overflow-y-auto' : "max-h-40 overflow-y-auto bg-proxmox-dark rounded-lg p-2"}>
                                                                    {users.map(u => (
                                                                        <label key={u.username} className="flex items-center gap-2 p-2 hover:bg-proxmox-darker rounded cursor-pointer">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={vmAclUsers.includes(u.username)}
                                                                                onChange={e => {
                                                                                    if (e.target.checked) {
                                                                                        setVmAclUsers([...vmAclUsers, u.username]);
                                                                                    } else {
                                                                                        setVmAclUsers(vmAclUsers.filter(x => x !== u.username));
                                                                                    }
                                                                                }}
                                                                                className="rounded border-gray-600"
                                                                            />
                                                                            <span className="text-sm text-white">{u.display_name || u.username}</span>
                                                                            <span className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>({u.role})</span>
                                                                        </label>
                                                                    ))}
                                                                </div>
                                                            </div>

                                                            {/* Inherit role permissions */}
                                                            <label className="flex items-center gap-2 cursor-pointer">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={vmAclInherit}
                                                                    onChange={e => setVmAclInherit(e.target.checked)}
                                                                    className="rounded border-gray-600"
                                                                />
                                                                <span className="text-sm text-gray-300">{t('inheritRolePerms2')}</span>
                                                            </label>

                                                            {/* Custom permissions (if not inheriting) */}
                                                            {!vmAclInherit && (
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('customPermissions')}</label>
                                                                    <div className={isCorporate ? 'corp-settings-card grid grid-cols-2 gap-1 max-h-40 overflow-y-auto' : "grid grid-cols-2 gap-1 max-h-40 overflow-y-auto bg-proxmox-dark rounded-lg p-2"}>
                                                                        {allPermissions.filter(p => p.permission.startsWith('vm.')).map(p => (
                                                                            <label key={p.permission} className="flex items-center gap-2 p-1 text-xs text-gray-300 cursor-pointer hover:text-white">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={vmAclPerms.includes(p.permission)}
                                                                                    onChange={e => {
                                                                                        if (e.target.checked) {
                                                                                            setVmAclPerms([...vmAclPerms, p.permission]);
                                                                                        } else {
                                                                                            setVmAclPerms(vmAclPerms.filter(x => x !== p.permission));
                                                                                        }
                                                                                    }}
                                                                                    className="rounded border-gray-600"
                                                                                />
                                                                                {p.permission}
                                                                            </label>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="flex gap-2 mt-6">
                                                            <button
                                                                onClick={saveVmAcl}
                                                                disabled={!selectedVmForAcl || vmAclUsers.length === 0}
                                                                className="flex-1 px-4 py-2 bg-proxmox-orange hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium"
                                                            >
                                                                {t('save')}
                                                            </button>
                                                            <button
                                                                onClick={() => setShowVmAclModal(false)}
                                                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
                                                            >
                                                                {t('cancel')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Pool Permissions Sub-Tab - */}
                                    {permSubTab === 'pools' && (
                                        <div>
                                            <p className={isCorporate ? 'corp-help-text mb-4' : "text-sm text-gray-400 mb-4"}>
                                                {t('poolPermissionsDesc')}
                                            </p>

                                            <div className="grid grid-cols-3 gap-4">
                                                {/* Cluster & Pool Selector */}
                                                <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-2"}>{t('selectCluster7')}</label>
                                                    <div className="flex gap-2">
                                                        <select
                                                            value={selectedPoolCluster}
                                                            onChange={e => {
                                                                setSelectedPoolCluster(e.target.value);
                                                                setSelectedPool(null);
                                                                setPoolPermissions([]);
                                                                if (e.target.value) fetchPools(e.target.value);
                                                            }}
                                                            className="flex-1 px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"
                                                        >
                                                            <option value="">{t('select3')}</option>
                                                            {clusters.map(c => (
                                                                <option key={c.id} value={c.id}>{c.name}</option>
                                                            ))}
                                                        </select>
                                                        {selectedPoolCluster && (
                                                            <button
                                                                onClick={() => refreshPoolCache(selectedPoolCluster)}
                                                                className="px-3 py-2 bg-proxmox-border hover:bg-gray-600 rounded-lg text-sm"
                                                                title={t('refreshPools')}
                                                            >
                                                                <Icons.Refresh className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                        {selectedPoolCluster && (
                                                            <button
                                                                onClick={() => {
                                                                    setShowPoolManager(true);
                                                                    fetchVmsWithoutPool(selectedPoolCluster);
                                                                }}
                                                                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm"
                                                                title={t('managePools')}
                                                            >
                                                                <Icons.Settings className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </div>

                                                    {selectedPoolCluster && pools.length > 0 && (
                                                        <div className="mt-4">
                                                            <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-2"}>{t('selectPool3')}</label>
                                                            <div className="space-y-2 max-h-64 overflow-y-auto">
                                                                {pools.map(pool => (
                                                                    <button
                                                                        key={pool.poolid}
                                                                        onClick={() => {
                                                                            setSelectedPool(pool.poolid);
                                                                            fetchPoolPermissions(selectedPoolCluster, pool.poolid);
                                                                        }}
                                                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedPool === pool.poolid
                                                                            ? 'bg-proxmox-orange text-white'
                                                                            : 'bg-proxmox-darker text-gray-300 hover:bg-proxmox-hover'
                                                                            }`}
                                                                    >
                                                                        <div className="font-medium flex items-center gap-2">
                                                                            <Icons.Layers className="w-4 h-4" />
                                                                            {pool.poolid}
                                                                        </div>
                                                                        <div className="text-xs opacity-70 mt-1">
                                                                            {pool.vms || 0} VMs • {pool.comment || t('noDescription')}
                                                                        </div>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {selectedPoolCluster && pools.length === 0 && (
                                                        <div className={isCorporate ? 'corp-help-text mt-4 text-center py-4' : "mt-4 text-sm text-gray-500 text-center py-4"}>
                                                            {t('noPools')}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Pool Permissions List */}
                                                <div className={isCorporate ? 'corp-settings-card col-span-2' : "col-span-2 bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                                    <div className="flex justify-between items-center mb-3">
                                                        <h4 className={isCorporate ? 'corp-card-header' : "font-medium text-white"}>
                                                            {selectedPool ? `${t('permissionsFor')} "${selectedPool}"` : t('poolPermissions')}
                                                        </h4>
                                                        {selectedPool && (
                                                            <button
                                                                onClick={() => {
                                                                    setPoolPermForm({ subject_type: 'user', subject_id: '', permissions: [] });
                                                                    setShowPoolPermModal(true);
                                                                }}
                                                                className="px-3 py-1.5 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium flex items-center gap-2"
                                                            >
                                                                <Icons.Plus className="w-4 h-4" />
                                                                {t('addPermission')}
                                                            </button>
                                                        )}
                                                    </div>

                                                    {selectedPool ? (
                                                        poolPermissions.length > 0 ? (
                                                            <div className="space-y-2 max-h-80 overflow-y-auto">
                                                                {poolPermissions.map((perm, idx) => (
                                                                    <div key={idx} className={isCorporate ? 'corp-settings-card flex items-center justify-between' : "flex items-center justify-between p-3 bg-proxmox-darker rounded-lg"}>
                                                                        <div>
                                                                            <div className="text-white text-sm font-medium flex items-center gap-2">
                                                                                {perm.subject_type === 'user' ? <Icons.User className="w-4 h-4" /> : <Icons.Users className="w-4 h-4" />}
                                                                                {perm.subject_id}
                                                                                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
                                                                                    {perm.subject_type}
                                                                                </span>
                                                                            </div>
                                                                            <div className="flex flex-wrap gap-1 mt-2">
                                                                                {perm.permissions.map((p, i) => (
                                                                                    <span key={i} className="px-1.5 py-0.5 text-xs rounded bg-blue-500/20 text-blue-400">
                                                                                        {p.replace('pool.', '').replace('vm.', '')}
                                                                                    </span>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                        <div className="flex items-center gap-2">
                                                                            <button
                                                                                onClick={() => {
                                                                                    setPoolPermForm({
                                                                                        subject_type: perm.subject_type,
                                                                                        subject_id: perm.subject_id,
                                                                                        permissions: perm.permissions
                                                                                    });
                                                                                    setShowPoolPermModal(true);
                                                                                }}
                                                                                className="px-2 py-1 text-xs bg-proxmox-border hover:bg-gray-600 rounded"
                                                                            >
                                                                                {t('edit')}
                                                                            </button>
                                                                            <button
                                                                                onClick={() => deletePoolPermission(perm.subject_type, perm.subject_id)}
                                                                                className="px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded"
                                                                            >
                                                                                {t('delete')}
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <div className={isCorporate ? 'corp-help-text text-center py-8' : "text-center py-8 text-gray-500"}>
                                                                {t('noPoolPerms')}
                                                            </div>
                                                        )
                                                    ) : (
                                                        <div className={isCorporate ? 'corp-help-text text-center py-8' : "text-center py-8 text-gray-500"}>
                                                            {t('selectPoolFirst')}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Pool Permission Modal */}
                                            {showPoolPermModal && (
                                                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                                                    <div className={isCorporate ? 'corp-settings-card w-full max-w-lg' : "bg-proxmox-darker border border-proxmox-border rounded-xl p-6 w-full max-w-lg"}>
                                                        <h3 className="text-lg font-semibold text-white mb-4">
                                                            {poolPermForm.subject_id ? t('editPoolPerm') : t('addPoolPerm')}
                                                        </h3>

                                                        <div className="space-y-4">
                                                            {/* Subject Type */}
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('subjectType2')}</label>
                                                                <select
                                                                    value={poolPermForm.subject_type}
                                                                    onChange={e => setPoolPermForm({ ...poolPermForm, subject_type: e.target.value })}
                                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                                                                >
                                                                    <option value="user">{t('user')}</option>
                                                                    <option value="group">{t('group')}</option>
                                                                </select>
                                                            </div>

                                                            {/* Subject ID */}
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>
                                                                    {poolPermForm.subject_type === 'user' ? t('selectUser') : t('groupName')}
                                                                </label>
                                                                {poolPermForm.subject_type === 'user' ? (
                                                                    <select
                                                                        value={poolPermForm.subject_id}
                                                                        onChange={e => setPoolPermForm({ ...poolPermForm, subject_id: e.target.value })}
                                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                                                                    >
                                                                        <option value="">{t('select4')}</option>
                                                                        {users.map(u => (
                                                                            <option key={u.username} value={u.username}>
                                                                                {u.display_name || u.username} ({u.role})
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                ) : (
                                                                    <input
                                                                        type="text"
                                                                        value={poolPermForm.subject_id}
                                                                        onChange={e => setPoolPermForm({ ...poolPermForm, subject_id: e.target.value })}
                                                                        placeholder="developers"
                                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                                                                    />
                                                                )}
                                                            </div>

                                                            {/* Permissions */}
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-2"}>{t('permissions')}</label>
                                                                <div className={isCorporate ? 'corp-settings-card grid grid-cols-2 gap-2 max-h-48 overflow-y-auto' : "grid grid-cols-2 gap-2 max-h-48 overflow-y-auto bg-proxmox-dark p-3 rounded-lg border border-proxmox-border"}>
                                                                    {availablePoolPerms.map(perm => (
                                                                        <label key={perm} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-proxmox-hover p-1 rounded">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={poolPermForm.permissions.includes(perm)}
                                                                                onChange={e => {
                                                                                    if (e.target.checked) {
                                                                                        setPoolPermForm({
                                                                                            ...poolPermForm,
                                                                                            permissions: [...poolPermForm.permissions, perm]
                                                                                        });
                                                                                    } else {
                                                                                        setPoolPermForm({
                                                                                            ...poolPermForm,
                                                                                            permissions: poolPermForm.permissions.filter(p => p !== perm)
                                                                                        });
                                                                                    }
                                                                                }}
                                                                                className="w-4 h-4 rounded border-proxmox-border bg-proxmox-dark text-proxmox-orange"
                                                                            />
                                                                            <span className={poolPermForm.permissions.includes(perm) ? 'text-white' : 'text-gray-400'}>
                                                                                {perm.replace('pool.', '').replace('vm.', '')}
                                                                            </span>
                                                                        </label>
                                                                    ))}
                                                                </div>

                                                                {/* Quick select buttons */}
                                                                <div className="flex gap-2 mt-2">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setPoolPermForm({
                                                                            ...poolPermForm,
                                                                            permissions: ['pool.view', 'vm.start', 'vm.stop', 'vm.console']
                                                                        })}
                                                                        className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded"
                                                                    >
                                                                        Operator
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setPoolPermForm({
                                                                            ...poolPermForm,
                                                                            permissions: ['pool.view', 'vm.start', 'vm.stop', 'vm.console', 'vm.config', 'vm.snapshot', 'vm.backup']
                                                                        })}
                                                                        className="px-2 py-1 text-xs bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded"
                                                                    >
                                                                        Power User
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setPoolPermForm({
                                                                            ...poolPermForm,
                                                                            permissions: ['pool.admin']
                                                                        })}
                                                                        className="px-2 py-1 text-xs bg-proxmox-orange/20 text-proxmox-orange hover:bg-proxmox-orange/30 rounded"
                                                                    >
                                                                        Admin
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setPoolPermForm({ ...poolPermForm, permissions: [] })}
                                                                        className="px-2 py-1 text-xs bg-gray-500/20 text-gray-400 hover:bg-gray-500/30 rounded"
                                                                    >
                                                                        Clear
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="flex gap-3 mt-6">
                                                            <button
                                                                onClick={savePoolPermission}
                                                                disabled={!poolPermForm.subject_id || poolPermForm.permissions.length === 0}
                                                                className="flex-1 px-4 py-2 bg-proxmox-orange hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium"
                                                            >
                                                                {t('save')}
                                                            </button>
                                                            <button
                                                                onClick={() => setShowPoolPermModal(false)}
                                                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
                                                            >
                                                                {t('cancel')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Pool Manager Modal - */}
                                            {showPoolManager && (
                                                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                                                    <div className={isCorporate ? 'corp-settings-card w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col' : "bg-proxmox-card border border-proxmox-border rounded-xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"}>
                                                        <div className="p-4 border-b border-proxmox-border flex items-center justify-between">
                                                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                                                <Icons.Layers />
                                                                {t('managePools')}
                                                            </h3>
                                                            <button onClick={() => setShowPoolManager(false)} className="p-1 hover:bg-proxmox-dark rounded">
                                                                <Icons.X />
                                                            </button>
                                                        </div>

                                                        <div className="flex-1 overflow-auto p-4">
                                                            {/* Create Pool Button */}
                                                            <div className="flex justify-between items-center mb-4">
                                                                <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>
                                                                    {t('poolManagerDesc')}
                                                                </p>
                                                                <button
                                                                    onClick={() => setShowCreatePool(true)}
                                                                    className="flex items-center gap-2 px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium"
                                                                >
                                                                    <Icons.Plus className="w-4 h-4" />
                                                                    {t('createPool')}
                                                                </button>
                                                            </div>

                                                            {/* Pools List */}
                                                            <div className="space-y-3">
                                                                {pools.length === 0 ? (
                                                                    <div className={isCorporate ? 'corp-help-text text-center py-12' : "text-center py-12 text-gray-500"}>
                                                                        <Icons.Layers className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                                                        <p>{t('noPoolsYet')}</p>
                                                                        <p className="text-sm mt-1">{t('createFirstPool')}</p>
                                                                    </div>
                                                                ) : (
                                                                    pools.map(pool => (
                                                                        <div key={pool.poolid} className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                                                            <div className="flex items-start justify-between">
                                                                                <div className="flex-1">
                                                                                    <div className="flex items-center gap-3">
                                                                                        <Icons.Layers className="w-5 h-5 text-blue-400" />
                                                                                        <h4 className={isCorporate ? 'corp-card-header' : "font-semibold text-white"}>{pool.poolid}</h4>
                                                                                        <span className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-400">
                                                                                            {pool.members?.length || 0} {t('members')}
                                                                                        </span>
                                                                                    </div>
                                                                                    {pool.comment && (
                                                                                        <p className={isCorporate ? 'corp-help-text mt-1 ml-8' : "text-sm text-gray-500 mt-1 ml-8"}>{pool.comment}</p>
                                                                                    )}

                                                                                    {/* Pool Members (VMs) */}
                                                                                    {pool.members && pool.members.length > 0 && (
                                                                                        <div className="mt-3 ml-8">
                                                                                            <p className={isCorporate ? 'corp-help-text mb-2' : "text-xs text-gray-500 mb-2"}>{t('poolMembers')}:</p>
                                                                                            <div className="flex flex-wrap gap-2">
                                                                                                {pool.members.filter(m => m.type === 'qemu' || m.type === 'lxc').map(member => (
                                                                                                    <div key={member.id} className="flex items-center gap-1 px-2 py-1 bg-proxmox-darker rounded text-xs">
                                                                                                        {member.type === 'qemu' ? (
                                                                                                            <Icons.Monitor className="w-3 h-3 text-blue-400" />
                                                                                                        ) : (
                                                                                                            <Icons.Box className="w-3 h-3 text-yellow-400" />
                                                                                                        )}
                                                                                                        <span className="text-gray-300">{member.vmid} - {member.name || 'unnamed'}</span>
                                                                                                        <button
                                                                                                            onClick={() => removeVmFromPool(pool.poolid, member.vmid)}
                                                                                                            className="ml-1 text-red-400 hover:text-red-300"
                                                                                                            title={t('removeFromPool')}
                                                                                                        >
                                                                                                            <Icons.X className="w-3 h-3" />
                                                                                                        </button>
                                                                                                    </div>
                                                                                                ))}
                                                                                            </div>
                                                                                        </div>
                                                                                    )}
                                                                                </div>

                                                                                {/* Actions */}
                                                                                <div className="flex items-center gap-2">
                                                                                    <button
                                                                                        onClick={() => setShowAddVmToPool(pool.poolid)}
                                                                                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-xs flex items-center gap-1"
                                                                                        title={t('addVmToPool2')}
                                                                                    >
                                                                                        <Icons.Plus className="w-3 h-3" />
                                                                                        VM
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={() => setEditingPool({ poolid: pool.poolid, comment: pool.comment || '' })}
                                                                                        className="p-1.5 text-gray-400 hover:text-white hover:bg-proxmox-hover rounded"
                                                                                        title={t('edit')}
                                                                                    >
                                                                                        <Icons.Edit className="w-4 h-4" />
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={() => deletePool(pool.poolid)}
                                                                                        className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded"
                                                                                        title={t('delete')}
                                                                                    >
                                                                                        <Icons.Trash className="w-4 h-4" />
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    ))
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Create Pool Modal */}
                                            {showCreatePool && (
                                                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
                                                    <div className={isCorporate ? 'corp-settings-card w-full max-w-md' : "bg-proxmox-darker border border-proxmox-border rounded-xl p-6 w-full max-w-md"}>
                                                        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                                            <Icons.Plus />
                                                            {t('createPool')}
                                                        </h3>

                                                        <div className="space-y-4">
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('poolId')} *</label>
                                                                <input
                                                                    type="text"
                                                                    value={newPoolForm.poolid}
                                                                    onChange={e => setNewPoolForm({ ...newPoolForm, poolid: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })}
                                                                    placeholder="my-pool"
                                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                                                                />
                                                                <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>{t('poolIdHint')}</p>
                                                            </div>

                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('comment3')}</label>
                                                                <input
                                                                    type="text"
                                                                    value={newPoolForm.comment}
                                                                    onChange={e => setNewPoolForm({ ...newPoolForm, comment: e.target.value })}
                                                                    placeholder={t('optionalDescription')}
                                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                                                                />
                                                            </div>
                                                        </div>

                                                        <div className="flex gap-3 mt-6">
                                                            <button
                                                                onClick={createPool}
                                                                disabled={poolManagerLoading || !newPoolForm.poolid.trim()}
                                                                className="flex-1 px-4 py-2 bg-proxmox-orange hover:bg-orange-600 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                                                            >
                                                                {poolManagerLoading && <Icons.Loader className="w-4 h-4 animate-spin" />}
                                                                {t('create')}
                                                            </button>
                                                            <button
                                                                onClick={() => { setShowCreatePool(false); setNewPoolForm({ poolid: '', comment: '' }); }}
                                                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
                                                            >
                                                                {t('cancel')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Edit Pool Modal */}
                                            {editingPool && (
                                                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
                                                    <div className={isCorporate ? 'corp-settings-card w-full max-w-md' : "bg-proxmox-darker border border-proxmox-border rounded-xl p-6 w-full max-w-md"}>
                                                        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                                            <Icons.Edit />
                                                            {t('editPool')}: {editingPool.poolid}
                                                        </h3>

                                                        <div className="space-y-4">
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('poolId')}</label>
                                                                <input
                                                                    type="text"
                                                                    value={editingPool.poolid}
                                                                    disabled
                                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-gray-500 text-sm cursor-not-allowed"}
                                                                />
                                                                <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>{t('poolIdCannotChange')}</p>
                                                            </div>

                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('comment4')}</label>
                                                                <input
                                                                    type="text"
                                                                    value={editingPool.comment}
                                                                    onChange={e => setEditingPool({ ...editingPool, comment: e.target.value })}
                                                                    placeholder={t('optionalDescription')}
                                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                                                                />
                                                            </div>
                                                        </div>

                                                        <div className="flex gap-3 mt-6">
                                                            <button
                                                                onClick={updatePool}
                                                                disabled={poolManagerLoading}
                                                                className="flex-1 px-4 py-2 bg-proxmox-orange hover:bg-orange-600 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                                                            >
                                                                {poolManagerLoading && <Icons.Loader className="w-4 h-4 animate-spin" />}
                                                                {t('save')}
                                                            </button>
                                                            <button
                                                                onClick={() => setEditingPool(null)}
                                                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
                                                            >
                                                                {t('cancel')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Add VM to Pool Modal */}
                                            {showAddVmToPool && (
                                                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
                                                    <div className={isCorporate ? 'corp-settings-card w-full max-w-lg max-h-[70vh] flex flex-col' : "bg-proxmox-darker border border-proxmox-border rounded-xl p-6 w-full max-w-lg max-h-[70vh] flex flex-col"}>
                                                        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                                            <Icons.Plus />
                                                            {t('addVmToPool')}: {showAddVmToPool}
                                                        </h3>

                                                        <div className="flex-1 overflow-auto">
                                                            {vmsWithoutPool.length === 0 ? (
                                                                <div className={isCorporate ? 'corp-help-text text-center py-8' : "text-center py-8 text-gray-500"}>
                                                                    <Icons.Check className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                                                    <p>{t('allVmsInPools')}</p>
                                                                </div>
                                                            ) : (
                                                                <div className="space-y-2">
                                                                    <p className={isCorporate ? 'corp-help-text mb-3' : "text-sm text-gray-400 mb-3"}>{t('selectVmToAdd')}:</p>
                                                                    {vmsWithoutPool.map(vm => (
                                                                        <button
                                                                            key={vm.vmid}
                                                                            onClick={() => {
                                                                                addVmToPool(showAddVmToPool, vm.vmid);
                                                                                setShowAddVmToPool(null);
                                                                            }}
                                                                            className="w-full flex items-center gap-3 p-3 bg-proxmox-dark hover:bg-proxmox-hover border border-proxmox-border rounded-lg text-left transition-colors"
                                                                        >
                                                                            {vm.type === 'qemu' ? (
                                                                                <Icons.Monitor className="w-5 h-5 text-blue-400" />
                                                                            ) : (
                                                                                <Icons.Box className="w-5 h-5 text-yellow-400" />
                                                                            )}
                                                                            <div className="flex-1">
                                                                                <div className="font-medium text-white">{vm.vmid} - {vm.name}</div>
                                                                                <div className="text-xs text-gray-500">{vm.node} • {vm.type === 'qemu' ? 'VM' : 'Container'}</div>
                                                                            </div>
                                                                            <span className={`px-2 py-0.5 rounded text-xs ${vm.status === 'running' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                                                                                }`}>
                                                                                {vm.status}
                                                                            </span>
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="mt-4 pt-4 border-t border-proxmox-border">
                                                            <button
                                                                onClick={() => setShowAddVmToPool(null)}
                                                                className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
                                                            >
                                                                {t('close')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Roles Tab - Dec 2025 */}
                            {activeTab === 'roles' && (
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <h3 className="text-lg font-semibold text-white">{t('customRoles')}</h3>
                                        <button
                                            onClick={() => setShowAddRole(true)}
                                            className="flex items-center gap-2 px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium"
                                        >
                                            <Icons.Plus />
                                            {t('createRole')}
                                        </button>
                                    </div>

                                    <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>{t('rolesDesc')}</p>

                                    {/* Add Role Form */}
                                    {showAddRole && (
                                        <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                            <h4 className={isCorporate ? 'corp-card-header' : "text-white font-medium mb-4"}>{t('createRole')}</h4>
                                            <form onSubmit={handleCreateRole} className="space-y-4">
                                                <div className="grid grid-cols-3 gap-4">
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('roleId')}</label>
                                                        <input
                                                            type="text"
                                                            value={newRole.id}
                                                            onChange={e => setNewRole({ ...newRole, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                                                            placeholder="operator"
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                            required
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('roleName')}</label>
                                                        <input
                                                            type="text"
                                                            value={newRole.name}
                                                            onChange={e => setNewRole({ ...newRole, name: e.target.value })}
                                                            placeholder="Operator"
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('scope')}</label>
                                                        <select
                                                            value={newRole.tenant_id}
                                                            onChange={e => setNewRole({ ...newRole, tenant_id: e.target.value })}
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                        >
                                                            <option value="">{t('global')}</option>
                                                            {tenants.map(t => (
                                                                <option key={t.id} value={t.id}>{t.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>

                                                {/* Permission checkboxes — grouped with search */}
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-2"}>{t('permissions')}</label>
                                                    <PermissionsGrid
                                                        t={t}
                                                        allPermissions={allPermissions}
                                                        selected={newRole.permissions}
                                                        onChange={(next) => setNewRole({ ...newRole, permissions: next })}
                                                    />
                                                </div>

                                                <div className="flex gap-2">
                                                    <button type="submit" disabled={roleSaving} className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm disabled:opacity-50 flex items-center gap-2">
                                                        {roleSaving ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : null}
                                                        {t('create')}
                                                    </button>
                                                    <button type="button" onClick={() => setShowAddRole(false)} disabled={roleSaving} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm disabled:opacity-50">
                                                        {t('cancel')}
                                                    </button>
                                                </div>
                                            </form>
                                        </div>
                                    )}

                                    {/* Roles List */}
                                    <div className={isCorporate ? 'corp-settings-card overflow-hidden' : "bg-proxmox-dark border border-proxmox-border rounded-xl overflow-hidden"}>
                                        <table className="w-full">
                                            <thead className="bg-proxmox-darker">
                                                <tr>
                                                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">{t('role')}</th>
                                                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">{t('scope')}</th>
                                                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">{t('permissions')}</th>
                                                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">{t('actions')}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-proxmox-border">
                                                {allRoles.map(role => (
                                                    <tr key={`${role.id}-${role.tenant_id || 'global'}`} className="hover:bg-proxmox-darker/50">
                                                        <td className="px-4 py-3">
                                                            <div className="font-medium text-white">{role.name || role.id}</div>
                                                            <div className="text-xs text-gray-500">{role.id}</div>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className={`px-2 py-1 text-xs rounded ${role.builtin ? 'bg-blue-500/20 text-blue-400' :
                                                                role.scope === 'global' ? 'bg-purple-500/20 text-purple-400' :
                                                                    'bg-green-500/20 text-green-400'
                                                                }`}>
                                                                {role.builtin ? 'Builtin' : role.scope === 'global' ? 'Global' : `Tenant: ${role.tenant_id}`}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-sm text-gray-400">
                                                            {role.permissions?.length || 0} permissions
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            {!role.builtin && (
                                                                <div className="flex gap-2 justify-end">
                                                                    <button onClick={() => setEditingRole({ ...role })} disabled={roleDeleting === role.id} className="text-blue-400 hover:text-blue-300 text-sm disabled:opacity-50">{t('edit')}</button>
                                                                    <button onClick={() => handleDeleteRole(role.id, role.tenant_id)} disabled={roleDeleting === role.id} className="text-red-400 hover:text-red-300 text-sm disabled:opacity-50">{t('delete')}</button>
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>


                                    {/* Edit Role Form - #167 */}
                                    {editingRole && (
                                        <div className={isCorporate ? 'corp-settings-card space-y-4 mt-4' : "bg-proxmox-dark border border-blue-500/30 rounded-xl p-4 space-y-4 mt-4"}>
                                            <h4 className={isCorporate ? 'corp-card-header' : "font-medium text-white"}>{t('editRole')}: {editingRole.name || editingRole.id}</h4>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('name')}</label>
                                                    <input value={editingRole.name || ''} onChange={e => setEditingRole({ ...editingRole, name: e.target.value })}
                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"} />
                                                </div>
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('scope')}</label>
                                                    <select value={editingRole.tenant_id || ''} onChange={e => setEditingRole({ ...editingRole, tenant_id: e.target.value })}
                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}>
                                                        <option value="">{t('global')}</option>
                                                        {tenants.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                                                    </select>
                                                </div>
                                            </div>
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-2"}>{t('permissions')}</label>
                                                <PermissionsGrid
                                                    t={t}
                                                    allPermissions={allPermissions}
                                                    selected={editingRole.permissions || []}
                                                    onChange={(next) => setEditingRole({ ...editingRole, permissions: next })}
                                                />
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={() => handleUpdateRole(editingRole.id, { name: editingRole.name, permissions: editingRole.permissions, tenant_id: editingRole.tenant_id })}
                                                    className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm">{t('save')}</button>
                                                <button onClick={() => setEditingRole(null)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">{t('cancel')}</button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Role Templates Section */}
                                    <div className="mt-6">
                                        <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "text-md font-semibold text-white mb-3 flex items-center gap-2"}>
                                            <Icons.FileText />
                                            {t('roleTemplates')}
                                        </h4>
                                        <p className={isCorporate ? 'corp-help-text mb-4' : "text-sm text-gray-400 mb-4"}>{t('roleTemplatesDesc')}</p>

                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                            {roleTemplates.map(tpl => (
                                                <div
                                                    key={tpl.id}
                                                    className={isCorporate ? 'corp-settings-card hover:border-proxmox-orange/50 cursor-pointer transition-colors' : "bg-proxmox-dark border border-proxmox-border rounded-lg p-4 hover:border-proxmox-orange/50 cursor-pointer transition-colors"}
                                                    onClick={() => {
                                                        setSelectedTemplate(tpl);
                                                        setTemplateConfig({ role_id: tpl.id, name: tpl.name, tenant_id: '' });
                                                        setShowTemplateModal(true);
                                                    }}
                                                >
                                                    <div className="font-medium text-white text-sm">{tpl.name}</div>
                                                    <div className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>{tpl.description}</div>
                                                    <div className="text-xs text-proxmox-orange mt-2">{tpl.permission_count} {t('permissions2')}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Template Apply Modal */}
                                    {showTemplateModal && selectedTemplate && (
                                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                                            <div className={isCorporate ? 'corp-settings-card w-full max-w-md' : "bg-proxmox-darker border border-proxmox-border rounded-xl p-6 w-full max-w-md"}>
                                                <h3 className="text-lg font-semibold text-white mb-4">
                                                    {t('createFromTemplate')}: {selectedTemplate.name}
                                                </h3>

                                                <div className="space-y-4">
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('roleId')}</label>
                                                        <input
                                                            type="text"
                                                            value={templateConfig.role_id}
                                                            onChange={e => setTemplateConfig({ ...templateConfig, role_id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('roleName')}</label>
                                                        <input
                                                            type="text"
                                                            value={templateConfig.name}
                                                            onChange={e => setTemplateConfig({ ...templateConfig, name: e.target.value })}
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('scope')}</label>
                                                        <select
                                                            value={templateConfig.tenant_id}
                                                            onChange={e => setTemplateConfig({ ...templateConfig, tenant_id: e.target.value })}
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                                                        >
                                                            <option value="">{t('global')}</option>
                                                            {tenants.map(t => (
                                                                <option key={t.id} value={t.id}>{t.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    <div className={isCorporate ? 'corp-settings-card max-h-40 overflow-y-auto' : "bg-proxmox-dark rounded-lg p-3 max-h-40 overflow-y-auto"}>
                                                        <div className={isCorporate ? 'corp-help-text mb-2' : "text-xs text-gray-400 mb-2"}>{t('includedPermissions')}:</div>
                                                        <div className="flex flex-wrap gap-1">
                                                            {selectedTemplate.permissions.map(p => (
                                                                <span key={p} className="px-2 py-0.5 bg-proxmox-darker text-xs text-gray-300 rounded">{p}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex gap-2 mt-6">
                                                    <button
                                                        onClick={handleApplyTemplate}
                                                        className="flex-1 px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium"
                                                    >
                                                        {t('create')}
                                                    </button>
                                                    <button
                                                        onClick={() => { setShowTemplateModal(false); setSelectedTemplate(null); }}
                                                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm"
                                                    >
                                                        {t('cancel')}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Security Settings Tab */}
                            {activeTab === 'security' && (
                                <SecuritySettingsSection addToast={addToast} />
                            )}

                            {/* Server Access Tab */}
                            {activeTab === 'server-access' && (
                                <div className="space-y-6">
                                    <ServerAccessGroupEditor addToast={addToast} />
                                    <ServerAccessAuditLog />
                                </div>
                            )}

                            {/* Compliance Tab (HIPAA/ISO 27001) */}
                            {activeTab === 'compliance' && (
                                <ComplianceSection addToast={addToast} />
                            )}

                            {/* LDAP / Active Directory Tab */}
                            {activeTab === 'ldap' && (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                            <Icons.Users className="w-5 h-5 text-blue-400" />
                                            LDAP / Active Directory
                                        </h3>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <span className="text-sm text-gray-400">Enable LDAP</span>
                                            <input type="checkbox" checked={ldapConfig.ldap_enabled} onChange={e => setLdapConfig(prev => ({ ...prev, ldap_enabled: e.target.checked }))}
                                                className="w-4 h-4 rounded accent-proxmox-orange" />
                                        </label>
                                    </div>

                                    {/* Connection Settings */}
                                    <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-4'}>
                                        <h4 className={isCorporate ? 'corp-card-header' : 'text-white font-medium'}>Connection</h4>
                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="col-span-2">
                                                <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Server (hostname or IP)</label>
                                                <input type="text" value={ldapConfig.ldap_server} onChange={e => setLdapConfig(prev => ({ ...prev, ldap_server: e.target.value }))} placeholder="ldap.example.com" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm'} />
                                            </div>
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Port</label>
                                                <input type="number" value={ldapConfig.ldap_port} onChange={e => setLdapConfig(prev => ({ ...prev, ldap_port: parseInt(e.target.value) || 389 }))} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm'} />
                                            </div>
                                        </div>
                                        <div className="flex gap-4">
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input type="checkbox" checked={ldapConfig.ldap_use_ssl} onChange={e => setLdapConfig(prev => ({ ...prev, ldap_use_ssl: e.target.checked, ldap_port: e.target.checked ? 636 : 389 }))} className="w-4 h-4 accent-proxmox-orange" />
                                                <span className="text-sm text-gray-300">SSL (LDAPS, port 636)</span>
                                            </label>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input type="checkbox" checked={ldapConfig.ldap_use_starttls} onChange={e => setLdapConfig(prev => ({ ...prev, ldap_use_starttls: e.target.checked }))} className="w-4 h-4 accent-proxmox-orange" />
                                                <span className="text-sm text-gray-300">STARTTLS</span>
                                            </label>
                                            {(ldapConfig.ldap_use_ssl || ldapConfig.ldap_use_starttls) && (
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input type="checkbox" checked={ldapConfig.ldap_verify_tls} onChange={e => setLdapConfig(prev => ({ ...prev, ldap_verify_tls: e.target.checked }))} className="w-4 h-4 accent-proxmox-orange" />
                                                    <span className="text-sm text-gray-300">Verify TLS Certificate</span>
                                                </label>
                                            )}
                                        </div>
                                    </div>

                                    {/* Bind Credentials */}
                                    <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-4'}>
                                        <h4 className={isCorporate ? 'corp-card-header' : 'text-white font-medium'}>Service Account (Bind)</h4>
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Bind DN</label>
                                            <input type="text" value={ldapConfig.ldap_bind_dn} onChange={e => setLdapConfig(prev => ({ ...prev, ldap_bind_dn: e.target.value }))} placeholder="CN=svc-ProxmoxVEx,OU=Service Accounts,DC=example,DC=com" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm font-mono'} />
                                        </div>
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Bind Password</label>
                                            <input type="password" value={ldapConfig.ldap_bind_password} onChange={e => setLdapConfig(prev => ({ ...prev, ldap_bind_password: e.target.value }))} placeholder="Service account password" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm'} />
                                        </div>
                                    </div>

                                    {/* Search Settings */}
                                    <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-4'}>
                                        <h4 className={isCorporate ? 'corp-card-header' : 'text-white font-medium'}>User Search</h4>
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Base DN</label>
                                            <input type="text" value={ldapConfig.ldap_base_dn} onChange={e => setLdapConfig(prev => ({ ...prev, ldap_base_dn: e.target.value }))} placeholder="DC=example,DC=com" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm font-mono'} />
                                        </div>
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>User Filter <span className="text-gray-600">({'{username}'} = login name)</span></label>
                                            <input type="text" value={ldapConfig.ldap_user_filter} onChange={e => setLdapConfig(prev => ({ ...prev, ldap_user_filter: e.target.value }))} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm font-mono'} />
                                        </div>
                                        <div className="grid grid-cols-3 gap-3">
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Username Attr</label>
                                                <input type="text" value={ldapConfig.ldap_username_attribute} onChange={e => setLdapConfig(prev => ({ ...prev, ldap_username_attribute: e.target.value }))} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm font-mono'} />
                                            </div>
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Email Attr</label>
                                                <input type="text" value={ldapConfig.ldap_email_attribute} onChange={e => setLdapConfig(prev => ({ ...prev, ldap_email_attribute: e.target.value }))} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm font-mono'} />
                                            </div>
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Display Name Attr</label>
                                                <input type="text" value={ldapConfig.ldap_display_name_attribute} onChange={e => setLdapConfig(prev => ({ ...prev, ldap_display_name_attribute: e.target.value }))} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm font-mono'} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Unified Group-Role Mapping */}
                                    <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-3'}>
                                        <div className="flex items-center justify-between">
                                            <h4 className={isCorporate ? 'corp-card-header' : 'text-white font-medium'}>Group ↑ Role Mapping</h4>
                                            <button onClick={() => setLdapConfig(prev => ({ ...prev, ldap_group_mappings: [...prev.ldap_group_mappings, { group_dn: '', role: 'viewer' }] }))}
                                                className="px-2 py-1 bg-proxmox-secondary border border-proxmox-border rounded text-xs text-gray-300 hover:text-white hover:bg-proxmox-hover flex items-center gap-1">
                                                <Icons.Plus className="w-3 h-3" /> Add Mapping
                                            </button>
                                        </div>
                                        <p className={isCorporate ? 'corp-help-text' : 'text-xs text-gray-500'}>Map AD/LDAP groups to ProxmoxVEx roles (including custom roles). Use full Distinguished Name (DN).</p>

                                        {ldapConfig.ldap_group_mappings.length === 0 ? (
                                            <p className="text-gray-600 text-sm text-center py-4 border border-dashed border-proxmox-border rounded-lg">No group mappings configured. Click "Add Mapping" to map an AD group to a role.</p>
                                        ) : (
                                            <div className="space-y-2">
                                                {ldapConfig.ldap_group_mappings.map((mapping, idx) => (
                                                    <div key={idx} className="flex items-center gap-2 p-2 bg-proxmox-secondary rounded-lg border border-proxmox-border">
                                                        <div className="flex-1">
                                                            <input type="text" value={mapping.group_dn} placeholder="CN=DevOps,OU=Groups,DC=example,DC=com"
                                                                onChange={e => { const m = [...ldapConfig.ldap_group_mappings]; m[idx] = { ...m[idx], group_dn: e.target.value }; setLdapConfig(prev => ({ ...prev, ldap_group_mappings: m })); }}
                                                                className={isCorporate ? 'corp-input' : 'w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm font-mono'} />
                                                        </div>
                                                        <Icons.ArrowRight className="w-4 h-4 text-gray-500 shrink-0" />
                                                        <div className="w-44 shrink-0">
                                                            <select value={mapping.role || 'viewer'}
                                                                onChange={e => { const m = [...ldapConfig.ldap_group_mappings]; m[idx] = { ...m[idx], role: e.target.value }; setLdapConfig(prev => ({ ...prev, ldap_group_mappings: m })); }}
                                                                className={isCorporate ? 'corp-input' : 'w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm'}>
                                                                <optgroup label="Built-in">
                                                                    <option value="admin">Admin</option>
                                                                    <option value="user">User</option>
                                                                    <option value="viewer">Viewer</option>
                                                                </optgroup>
                                                                {allRoles.filter(r => !r.builtin).length > 0 && (
                                                                    <optgroup label="Custom Roles">
                                                                        {allRoles.filter(r => !r.builtin).map(r => (
                                                                            <option key={r.id} value={r.id}>{r.name}</option>
                                                                        ))}
                                                                    </optgroup>
                                                                )}
                                                            </select>
                                                        </div>
                                                        <button onClick={() => { const m = [...ldapConfig.ldap_group_mappings]; m.splice(idx, 1); setLdapConfig(prev => ({ ...prev, ldap_group_mappings: m })); }}
                                                            className="p-1.5 text-red-400 hover:bg-red-500/10 rounded shrink-0"><Icons.Trash className="w-4 h-4" /></button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-proxmox-border">
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Default Role (no group match)</label>
                                                <select value={ldapConfig.ldap_default_role} onChange={e => setLdapConfig(prev => ({ ...prev, ldap_default_role: e.target.value }))} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm'}>
                                                    <option value="viewer">Viewer</option>
                                                    <option value="user">User</option>
                                                    <option value="admin">Admin</option>
                                                    {allRoles.filter(r => !r.builtin).map(r => (
                                                        <option key={r.id} value={r.id}>{r.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="flex items-end pb-1">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input type="checkbox" checked={ldapConfig.ldap_auto_create_users} onChange={e => setLdapConfig(prev => ({ ...prev, ldap_auto_create_users: e.target.checked }))} className="w-4 h-4 accent-proxmox-orange" />
                                                    <span className="text-sm text-gray-300">Auto-create users on first login</span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Test Connection */}
                                    <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-3'}>
                                        <h4 className={isCorporate ? 'corp-card-header' : 'text-white font-medium'}>Test Connection</h4>
                                        <div className="flex items-end gap-3">
                                            <div className="flex-1">
                                                <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Test Username (optional)</label>
                                                <input type="text" value={ldapTestUser} onChange={e => setLdapTestUser(e.target.value)} placeholder="e.g. jdoe" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm'} />
                                            </div>
                                            <button onClick={testLdapConnection} disabled={ldapTesting || !ldapConfig.ldap_server} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-white text-sm flex items-center gap-2 shrink-0">
                                                {ldapTesting ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.Zap className="w-4 h-4" />}
                                                Test
                                            </button>
                                        </div>

                                        {ldapTestResult && (
                                            <div className={`p-3 rounded-lg border ${ldapTestResult.success ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                                                <p className={`font-medium text-sm ${ldapTestResult.success ? 'text-green-400' : 'text-red-400'}`}>
                                                    {ldapTestResult.success ? '✓ Connection Successful' : `✗ ${ldapTestResult.error}`}
                                                </p>
                                                {ldapTestResult.steps && (
                                                    <div className="mt-2 space-y-1">
                                                        {ldapTestResult.steps.map((step, i) => (
                                                            <div key={i} className="flex items-center gap-2 text-xs">
                                                                <span className={step.status === 'ok' ? 'text-green-400' : step.status === 'warning' ? 'text-yellow-400' : 'text-red-400'}>
                                                                    {step.status === 'ok' ? '✓' : step.status === 'warning' ? '⚠' : '✗'}
                                                                </span>
                                                                <span className="text-gray-400">{step.step}</span>
                                                                {step.detail && typeof step.detail === 'string' && <span className="text-gray-500 font-mono">{step.detail}</span>}
                                                                {step.detail && typeof step.detail === 'object' && <span className="text-gray-500 font-mono">{step.detail.dn} ({step.detail.groups} groups)</span>}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Save Button */}
                                    <div className="flex justify-end gap-3">
                                        <button onClick={saveLdapSettings} disabled={loading} className="px-6 py-2 bg-proxmox-orange hover:bg-orange-600 disabled:opacity-50 rounded-lg text-white font-medium flex items-center gap-2">
                                            {loading ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.Save className="w-4 h-4" />}
                                            Save LDAP Settings
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* OIDC / Entra ID Tab */}
                            {activeTab === 'oidc' && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                            <Icons.Shield className="w-5 h-5" /> OIDC / Entra ID Authentication
                                        </h3>
                                    </div>
                                    <p className="text-sm text-gray-400">
                                        Configure OpenID Connect authentication with Microsoft Entra ID (Azure AD), Okta, Auth0, Keycloak, or any OIDC provider.
                                    </p>

                                    {/* Enable + Provider */}
                                    <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-3'}>
                                        <div className="flex items-center justify-between">
                                            <h4 className={isCorporate ? 'corp-card-header' : 'text-white font-medium'}>Connection</h4>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input type="checkbox" checked={oidcConfig.oidc_enabled} onChange={e => setOidcConfig(prev => ({ ...prev, oidc_enabled: e.target.checked }))}
                                                    className="w-4 h-4 rounded bg-proxmox-secondary border-proxmox-border" />
                                                <span className="text-sm text-gray-300">Enable OIDC</span>
                                            </label>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Provider</label>
                                                <select value={oidcConfig.oidc_provider} onChange={e => setOidcConfig(prev => ({ ...prev, oidc_provider: e.target.value }))}
                                                    className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm'}>
                                                    <option value="entra">Microsoft Entra ID (Azure AD)</option>
                                                    <option value="okta">Okta</option>
                                                    <option value="generic">Generic OIDC</option>
                                                </select>
                                            </div>
                                            {oidcConfig.oidc_provider === 'entra' ? (
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Tenant ID</label>
                                                    <input type="text" value={oidcConfig.oidc_tenant_id} onChange={e => setOidcConfig(prev => ({ ...prev, oidc_tenant_id: e.target.value }))}
                                                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm font-mono'} />
                                                </div>
                                            ) : (
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Authority / Issuer URL</label>
                                                    <input type="text" value={oidcConfig.oidc_authority} onChange={e => setOidcConfig(prev => ({ ...prev, oidc_authority: e.target.value }))}
                                                        placeholder="https://login.example.com/realms/master" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm'} />
                                                </div>
                                            )}
                                        </div>
                                        {oidcConfig.oidc_provider === 'entra' && (
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Cloud Environment</label>
                                                <select value={oidcConfig.oidc_cloud_environment || 'commercial'} onChange={e => setOidcConfig(prev => ({ ...prev, oidc_cloud_environment: e.target.value }))}
                                                    className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm'}>
                                                    <option value="commercial">Commercial (Global)</option>
                                                    <option value="gcc">GCC (Government Community Cloud)</option>
                                                    <option value="gcc_high">GCC High (US Government)</option>
                                                    <option value="dod">DoD (Department of Defense)</option>
                                                </select>
                                                {oidcConfig.oidc_cloud_environment && oidcConfig.oidc_cloud_environment !== 'commercial' && oidcConfig.oidc_cloud_environment !== 'gcc' && (
                                                    <p className="text-xs text-yellow-400 mt-1">⚠️ {oidcConfig.oidc_cloud_environment === 'gcc_high' ? 'GCC High' : 'DoD'} uses sovereign endpoints: login.microsoftonline.us / {oidcConfig.oidc_cloud_environment === 'dod' ? 'dod-graph.microsoft.us' : 'graph.microsoft.us'}</p>
                                                )}
                                            </div>
                                        )}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Client ID (Application ID)</label>
                                                <input type="text" value={oidcConfig.oidc_client_id} onChange={e => setOidcConfig(prev => ({ ...prev, oidc_client_id: e.target.value }))}
                                                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm font-mono'} />
                                            </div>
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Client Secret</label>
                                                <input type="password" value={oidcConfig.oidc_client_secret} onChange={e => setOidcConfig(prev => ({ ...prev, oidc_client_secret: e.target.value }))}
                                                    placeholder="••••••••" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm'} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Scopes</label>
                                                <input type="text" value={oidcConfig.oidc_scopes} onChange={e => setOidcConfig(prev => ({ ...prev, oidc_scopes: e.target.value }))}
                                                    placeholder="openid profile email" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm'} />
                                            </div>
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Redirect URI</label>
                                                <input type="text" value={oidcConfig.oidc_redirect_uri || `${window.location.origin}/oidc/callback`} onChange={e => setOidcConfig(prev => ({ ...prev, oidc_redirect_uri: e.target.value }))}
                                                    className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm font-mono'} />
                                                <p className={isCorporate ? 'corp-help-text' : 'text-xs text-gray-600 mt-1'}>Register this URL in your identity provider</p>
                                            </div>
                                        </div>
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Login Button Text</label>
                                            <input type="text" value={oidcConfig.oidc_button_text} onChange={e => setOidcConfig(prev => ({ ...prev, oidc_button_text: e.target.value }))}
                                                placeholder="Sign in with Microsoft" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm'} />
                                        </div>
                                    </div>

                                    {/* JWT verification toggle for broken JWKS environments */}
                                    <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-3'}>
                                        <div className="flex items-center justify-between">
                                            <h4 className={isCorporate ? 'corp-card-header' : 'text-white font-medium flex items-center gap-2'}>
                                                <Icons.Shield />
                                                {t('jwtVerification')}
                                            </h4>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input type="checkbox"
                                                    checked={oidcConfig.oidc_skip_jwt_verification}
                                                    onChange={e => setOidcConfig(prev => ({ ...prev, oidc_skip_jwt_verification: e.target.checked }))}
                                                    className="rounded border-proxmox-border bg-proxmox-darker" />
                                                <span className="text-sm text-gray-300">{t('disableJwtVerification')}</span>
                                            </label>
                                        </div>
                                        {oidcConfig.oidc_skip_jwt_verification && (
                                            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                                                <p className="text-sm text-red-400 font-medium mb-1">⚠ {t('securityWarning')}</p>
                                                <p className="text-xs text-red-400/80">{t('jwtVerificationWarning')}</p>
                                            </div>
                                        )}
                                        {!oidcConfig.oidc_skip_jwt_verification && (
                                            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                                                <p className="text-xs text-green-400">✓ {t('jwtVerificationEnabled')}</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* (#188): TLS verify toggle for self-hosted Authentik / Keycloak with self-signed certs */}
                                    <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-3'}>
                                        <div className="flex items-center justify-between">
                                            <h4 className={isCorporate ? 'corp-card-header' : 'text-white font-medium flex items-center gap-2'}>
                                                <Icons.Lock />
                                                {t('oidcTlsVerification')}
                                            </h4>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input type="checkbox"
                                                    checked={oidcConfig.oidc_skip_ssl_verify}
                                                    onChange={e => setOidcConfig(prev => ({ ...prev, oidc_skip_ssl_verify: e.target.checked }))}
                                                    className="rounded border-proxmox-border bg-proxmox-darker" />
                                                <span className="text-sm text-gray-300">{t('skipTlsVerification')}</span>
                                            </label>
                                        </div>
                                        {oidcConfig.oidc_skip_ssl_verify ? (
                                            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                                                <p className="text-sm text-red-400 font-medium mb-1">⚠ {t('securityWarning')}</p>
                                                <p className="text-xs text-red-400/80">{t('oidcTlsWarning')}</p>
                                            </div>
                                        ) : (
                                            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                                                <p className="text-xs text-green-400">✓ {t('oidcTlsEnabled')}</p>
                                            </div>
                                        )}
                                        <p className={isCorporate ? 'corp-help-text' : 'text-[11px] text-gray-500 leading-snug'}>
                                            {t('oidcTlsHint')}
                                        </p>
                                    </div>

                                    {/* (#412 SeeJayEmm): opt-in private-IP allowlist for internal IdPs */}
                                    <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-3'}>
                                        <div className="flex items-center justify-between">
                                            <h4 className={isCorporate ? 'corp-card-header' : 'text-white font-medium flex items-center gap-2'}>
                                                <Icons.Globe />
                                                {t('oidcAllowPrivateIp')}
                                            </h4>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input type="checkbox"
                                                    checked={oidcConfig.oidc_allow_private_ip}
                                                    onChange={e => setOidcConfig(prev => ({ ...prev, oidc_allow_private_ip: e.target.checked }))}
                                                    className="rounded border-proxmox-border bg-proxmox-darker" />
                                                <span className="text-sm text-gray-300">{t('allowPrivateIp')}</span>
                                            </label>
                                        </div>
                                        {oidcConfig.oidc_allow_private_ip ? (
                                            <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                                                <p className="text-sm text-yellow-400 font-medium mb-1">⚠ {t('oidcPrivateIpOptIn')}</p>
                                                <p className="text-xs text-yellow-300/80">{t('oidcPrivateIpWarning')}</p>
                                            </div>
                                        ) : (
                                            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                                                <p className="text-xs text-green-400">✓ {t('oidcPrivateIpDisabled2')}</p>
                                            </div>
                                        )}
                                        <p className={isCorporate ? 'corp-help-text' : 'text-[11px] text-gray-500 leading-snug'}>
                                            {t('oidcPrivateIpHint')}
                                        </p>
                                    </div>

                                    {/* (PVE 9.2 parity) - extra audiences accepted on JWT verify */}
                                    <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-2'}>
                                        <h4 className={isCorporate ? 'corp-card-header' : 'text-white font-medium flex items-center gap-2'}>
                                            <Icons.Key />
                                            {t('oidcAudiences')}
                                        </h4>
                                        <input type="text"
                                            value={oidcConfig.oidc_audiences || ''}
                                            onChange={e => setOidcConfig(prev => ({ ...prev, oidc_audiences: e.target.value }))}
                                            placeholder="comma-separated, e.g. ProxmoxVEx-prod, ProxmoxVEx-staging"
                                            className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-darker border border-proxmox-border rounded p-2 text-sm font-mono text-white'} />
                                        <p className={isCorporate ? 'corp-help-text' : 'text-[11px] text-gray-500 leading-snug'}>
                                            {t('oidcAudiencesHint')}
                                        </p>
                                    </div>

                                    {/* Unified Group-Role Mapping */}
                                    <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-3'}>
                                        <div className="flex items-center justify-between">
                                            <h4 className={isCorporate ? 'corp-card-header' : 'text-white font-medium'}>Group ↑ Role Mapping</h4>
                                            <button onClick={() => setOidcConfig(prev => ({ ...prev, oidc_group_mappings: [...prev.oidc_group_mappings, { group_id: '', role: 'viewer' }] }))}
                                                className="px-2 py-1 bg-proxmox-secondary border border-proxmox-border rounded text-xs text-gray-300 hover:text-white hover:bg-proxmox-hover flex items-center gap-1">
                                                <Icons.Plus className="w-3 h-3" /> Add Mapping
                                            </button>
                                        </div>
                                        <p className={isCorporate ? 'corp-help-text' : 'text-xs text-gray-500'}>{oidcConfig.oidc_provider === 'entra' ? 'Map Entra groups to ProxmoxVEx roles. Use group Object IDs (Azure Portal ↑ Groups ↑ Overview).' : 'Map provider groups to ProxmoxVEx roles (including custom roles).'}</p>

                                        {oidcConfig.oidc_group_mappings.length === 0 ? (
                                            <p className="text-gray-600 text-sm text-center py-4 border border-dashed border-proxmox-border rounded-lg">No group mappings configured. Click "Add Mapping" to map a group to a role.</p>
                                        ) : (
                                            <div className="space-y-2">
                                                {oidcConfig.oidc_group_mappings.map((mapping, idx) => (
                                                    <div key={idx} className="flex items-center gap-2 p-2 bg-proxmox-secondary rounded-lg border border-proxmox-border">
                                                        <div className="flex-1">
                                                            <input type="text" value={mapping.group_id} placeholder={oidcConfig.oidc_provider === 'entra' ? 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' : 'GroupName'}
                                                                onChange={e => { const m = [...oidcConfig.oidc_group_mappings]; m[idx] = { ...m[idx], group_id: e.target.value }; setOidcConfig(prev => ({ ...prev, oidc_group_mappings: m })); }}
                                                                className={isCorporate ? 'corp-input' : 'w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm font-mono'} />
                                                        </div>
                                                        <Icons.ArrowRight className="w-4 h-4 text-gray-500 shrink-0" />
                                                        <div className="w-44 shrink-0">
                                                            <select value={mapping.role || 'viewer'}
                                                                onChange={e => { const m = [...oidcConfig.oidc_group_mappings]; m[idx] = { ...m[idx], role: e.target.value }; setOidcConfig(prev => ({ ...prev, oidc_group_mappings: m })); }}
                                                                className={isCorporate ? 'corp-input' : 'w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm'}>
                                                                <optgroup label="Built-in">
                                                                    <option value="admin">Admin</option>
                                                                    <option value="user">User</option>
                                                                    <option value="viewer">Viewer</option>
                                                                </optgroup>
                                                                {allRoles.filter(r => !r.builtin).length > 0 && (
                                                                    <optgroup label="Custom Roles">
                                                                        {allRoles.filter(r => !r.builtin).map(r => (
                                                                            <option key={r.id} value={r.id}>{r.name}</option>
                                                                        ))}
                                                                    </optgroup>
                                                                )}
                                                            </select>
                                                        </div>
                                                        <button onClick={() => { const m = [...oidcConfig.oidc_group_mappings]; m.splice(idx, 1); setOidcConfig(prev => ({ ...prev, oidc_group_mappings: m })); }}
                                                            className="p-1.5 text-red-400 hover:bg-red-500/10 rounded shrink-0"><Icons.Trash className="w-4 h-4" /></button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-proxmox-border">
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-1'}>Default Role (no group match)</label>
                                                <select value={oidcConfig.oidc_default_role} onChange={e => setOidcConfig(prev => ({ ...prev, oidc_default_role: e.target.value }))}
                                                    className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm'}>
                                                    <option value="viewer">Viewer</option>
                                                    <option value="user">User</option>
                                                    <option value="admin">Admin</option>
                                                    {allRoles.filter(r => !r.builtin).map(r => (
                                                        <option key={r.id} value={r.id}>{r.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="flex items-end pb-1">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input type="checkbox" checked={oidcConfig.oidc_auto_create_users} onChange={e => setOidcConfig(prev => ({ ...prev, oidc_auto_create_users: e.target.checked }))}
                                                        className="w-4 h-4 rounded bg-proxmox-secondary border-proxmox-border" />
                                                    <span className="text-sm text-gray-300">Auto-create users on first login</span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Test Connection */}
                                    <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-3'}>
                                        <h4 className={isCorporate ? 'corp-card-header' : 'text-white font-medium'}>Test Configuration</h4>
                                        <button onClick={testOidcConnection} disabled={oidcTesting || !oidcConfig.oidc_client_id} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-white text-sm flex items-center gap-2">
                                            {oidcTesting ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.Zap className="w-4 h-4" />}
                                            Test Endpoints
                                        </button>
                                        {oidcTestResult && (
                                            <div className="space-y-1.5">
                                                {oidcTestResult.results && oidcTestResult.results.map((r, i) => (
                                                    <div key={i} className={`flex items-center gap-2 text-sm ${r.status === 'ok' ? 'text-green-400' : r.status === 'warning' ? 'text-yellow-400' : 'text-red-400'}`}>
                                                        {r.status === 'ok' ? <Icons.Check className="w-4 h-4" /> : r.status === 'warning' ? <Icons.AlertTriangle className="w-4 h-4" /> : <Icons.X className="w-4 h-4" />}
                                                        <span className="font-medium">{r.step}:</span> <span className="text-gray-400 truncate">{r.detail}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Entra Setup Guide */}
                                    {oidcConfig.oidc_provider === 'entra' && (
                                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 space-y-2">
                                            <h4 className="text-blue-400 font-medium flex items-center gap-2"><Icons.Info className="w-4 h-4" /> Entra ID Setup Guide</h4>
                                            <ol className="text-sm text-gray-400 space-y-1 list-decimal list-inside">
                                                <li>Azure Portal ↑ Entra ID ↑ App registrations ↑ New registration</li>
                                                <li>Set Redirect URI to: <code className="text-blue-300 bg-proxmox-dark px-1 rounded">{oidcConfig.oidc_redirect_uri || `${window.location.origin}/oidc/callback`}</code></li>
                                                <li>Copy Application (client) ID ↑ paste as Client ID above</li>
                                                <li>Certificates & secrets ↑ New client secret ↑ paste above</li>
                                                <li>API permissions ↑ Add: <code className="text-blue-300 bg-proxmox-dark px-1 rounded">openid, profile, email, User.Read, GroupMember.Read.All</code></li>
                                                <li>Token configuration ↑ Add groups claim (Security groups)</li>
                                                <li>Copy Directory (tenant) ID ↑ paste as Tenant ID above</li>
                                            </ol>
                                        </div>
                                    )}

                                    {/* Save */}
                                    <div className="flex justify-end pt-2">
                                        <button onClick={saveOidcSettings} disabled={loading} className="px-6 py-2 bg-proxmox-orange hover:bg-orange-600 disabled:opacity-50 rounded-lg text-white font-medium flex items-center gap-2">
                                            {loading ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.Save className="w-4 h-4" />}
                                            Save OIDC Settings
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Syslog Server Settings Tab */}
                            {activeTab === 'syslog' && (
                                <div className="space-y-6">
                                    <h3 className="text-lg font-semibold text-white">{t('syslogServer')}</h3>

                                    <div className="bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-4">
                                        <div className="flex items-center justify-between gap-4">
                                            <div>
                                                <h4 className="font-medium text-white flex items-center gap-2">
                                                    <Icons.FileText />
                                                    {t('syslogEnabled')}
                                                </h4>
                                                <p className="text-sm text-gray-400 mt-1">
                                                    {t('syslogEnabledDesc')}
                                                </p>
                                            </div>
                                            <label className="flex items-center gap-2 cursor-pointer shrink-0">
                                                <input
                                                    type="checkbox"
                                                    checked={!!serverSettings.syslog_enabled}
                                                    onChange={e => setServerSettings({ ...serverSettings, syslog_enabled: e.target.checked })}
                                                    className="rounded border-proxmox-border bg-proxmox-darker"
                                                />
                                                <span className="text-sm text-gray-300">{t('enabled')}</span>
                                            </label>
                                        </div>

                                        <div className="flex items-center justify-between gap-4 border-t border-proxmox-border pt-4">
                                            <div>
                                                <h4 className="font-medium text-white flex items-center gap-2">
                                                    <Icons.FileText />
                                                    {t('syslogClusterFilter')}
                                                </h4>
                                                <p className="text-sm text-gray-400 mt-1">
                                                    {t('syslogClusterFilterDesc')}
                                                </p>
                                            </div>
                                            <label className="flex items-center gap-2 cursor-pointer shrink-0">
                                                <input
                                                    type="checkbox"
                                                    checked={!!serverSettings.syslog_filter_by_selected_cluster}
                                                    onChange={e => setServerSettings({ ...serverSettings, syslog_filter_by_selected_cluster: e.target.checked })}
                                                    className="rounded border-proxmox-border bg-proxmox-darker"
                                                />
                                                <span className="text-sm text-gray-300">{t('enabled')}</span>
                                            </label>
                                        </div>

                                        <div className="pt-3 flex justify-end border-t border-proxmox-border">
                                            <button
                                                onClick={async () => {
                                                    setServerLoading(true);
                                                    try {
                                                        const response = await fetch(`${API_URL}/settings/server`, {
                                                            method: 'POST',
                                                            credentials: 'include',
                                                            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                syslog_filter_by_selected_cluster: !!serverSettings.syslog_filter_by_selected_cluster,
                                                                syslog_enabled: !!serverSettings.syslog_enabled
                                                            })
                                                        });
                                                        if (response && response.ok) {
                                                            addToast(t('settingsSaved'), 'success');
                                                            fetchServerSettings();
                                                        } else {
                                                            const err = await response.json().catch(() => ({}));
                                                            addToast(err.error || t('errorSavingSettings'), 'error');
                                                        }
                                                    } catch (err) {
                                                        addToast(t('errorSavingSettings'), 'error');
                                                    }
                                                    setServerLoading(false);
                                                }}
                                                disabled={serverLoading}
                                                className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                                            >
                                                {serverLoading && <Icons.Loader className="w-4 h-4 animate-spin" />}
                                                {t('saveSettings') || t('save')}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Server Settings Tab */}
                            {activeTab === 'server' && (
                                <div className="space-y-6">
                                    <h3 className={isCorporate ? 'corp-card-header' : "text-lg font-semibold text-white"}>{t('serverSettings')}</h3>

                                    {/* Default Theme for New Users */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-4"}>
                                        <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "font-medium text-white flex items-center gap-2"}>
                                            <Icons.Palette />
                                            {t('defaultTheme')}
                                        </h4>
                                        <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>
                                            {t('defaultThemeDesc')}
                                        </p>

                                        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                                            {Object.entries(ProxmoxVEx_THEMES).map(([key, theme]) => {
                                                const isActive = (serverSettings.default_theme || 'proxmoxDark') === key;
                                                return (
                                                    <button
                                                        key={key}
                                                        onClick={() => setServerSettings({ ...serverSettings, default_theme: key })}
                                                        className={`p-2 rounded-lg border-2 transition-all hover:scale-105 ${isActive
                                                            ? 'border-proxmox-orange ring-2 ring-proxmox-orange/30'
                                                            : 'border-proxmox-border hover:border-gray-500'
                                                            }`}
                                                        title={theme.name}
                                                    >
                                                        <div
                                                            className="h-8 rounded mb-1 relative overflow-hidden"
                                                            style={{
                                                                background: theme.colors.darker,
                                                                border: `1px solid ${theme.colors.border}`
                                                            }}
                                                        >
                                                            <div
                                                                className="absolute inset-1 rounded"
                                                                style={{ background: theme.colors.card }}
                                                            >
                                                                <div
                                                                    className="w-1/2 h-1 rounded-full m-1"
                                                                    style={{ background: theme.colors.primary }}
                                                                />
                                                            </div>
                                                            {isActive && (
                                                                <div className="absolute top-0 right-0 bg-proxmox-orange rounded-full p-0.5">
                                                                    <Icons.Check className="w-2 h-2 text-white" />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="text-center text-xs truncate">
                                                            {theme.icon}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>
                                            {t('currentDefault')}: {ProxmoxVEx_THEMES[serverSettings.default_theme || 'proxmoxDark']?.name || 'Proxmox Dark'}
                                        </p>
                                    </div>

                                    {/* User Theme Preference (002-ui-dark-mode) */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-4"}>
                                        <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "font-medium text-white flex items-center gap-2"}>
                                            <Icons.Palette />
                                            {t('settings.theme.label')}
                                        </h4>
                                        <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>
                                            {t('appearance')}
                                        </p>

                                        <div className="flex items-center gap-3">
                                            {['light', 'dark', 'system'].map((mode) => (
                                                <button
                                                    key={mode}
                                                    onClick={() => saveUserTheme(mode)}
                                                    disabled={userThemeLoading || userTheme === mode}
                                                    className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${userTheme === mode
                                                        ? 'border-proxmox-orange ring-2 ring-proxmox-orange/30 text-white'
                                                        : 'border-proxmox-border text-gray-300 hover:border-gray-500'
                                                        } disabled:opacity-50`}
                                                >
                                                    {userThemeLoading && userTheme === mode ? (
                                                        <Icons.Loader className="w-4 h-4 animate-spin" />
                                                    ) : (
                                                        t(`settings.theme.${mode}`)
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Login Background - */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-3"}>
                                        <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "font-medium text-white flex items-center gap-2"}>
                                            <Icons.Image />
                                            {t('loginBackground')}
                                        </h4>
                                        <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>{t('loginBackgroundDesc')}</p>

                                        {serverSettings.login_background && (
                                            <div className="flex items-center gap-3">
                                                <img src={serverSettings.login_background} alt="Login bg" className="h-16 rounded border border-proxmox-border object-cover" />
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            const r = await fetch(`${API_URL}/settings/login-background`, { method: 'DELETE', credentials: 'include', headers: getAuthHeaders() });
                                                            if (r.ok) {
                                                                addToast(t('loginBackgroundDeleted'), 'success');
                                                                setServerSettings(prev => ({ ...prev, login_background: '' }));
                                                            }
                                                        } catch (e) { addToast('Error', 'error'); }
                                                    }}
                                                    className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-sm hover:bg-red-500/30 transition-colors"
                                                >
                                                    {t('removeBackground')}
                                                </button>
                                            </div>
                                        )}

                                        <input
                                            type="file"
                                            accept=".png,.jpg,.jpeg,.webp,.svg"
                                            onChange={e => {
                                                const file = e.target.files[0];
                                                if (file && file.size > 2 * 1024 * 1024) {
                                                    setLoginBgError(t('loginBackgroundTooLarge'));
                                                    e.target.value = '';
                                                    setLoginBgFile(null);
                                                } else {
                                                    setLoginBgError(null);
                                                    setLoginBgFile(file || null);
                                                }
                                            }}
                                            className="block w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:bg-proxmox-orange/20 file:text-proxmox-orange hover:file:bg-proxmox-orange/30 file:cursor-pointer"
                                        />
                                        {loginBgError && (
                                            <p className="text-xs text-red-400">{loginBgError}</p>
                                        )}
                                        {loginBgFile && (
                                            <p className="text-xs text-green-400">{loginBgFile.name} ({(loginBgFile.size / 1024).toFixed(0)} KB)</p>
                                        )}
                                    </div>

                                    {/* Domain & Port */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-4"}>
                                        <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "font-medium text-white flex items-center gap-2"}>
                                            <Icons.Globe />
                                            {t('networkSettings')}
                                        </h4>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('domain')}</label>
                                                <input
                                                    type="text"
                                                    value={serverSettings.domain}
                                                    onChange={e => setServerSettings({ ...serverSettings, domain: e.target.value })}
                                                    placeholder="ProxmoxVEx.example.com"
                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm focus:outline-none focus:border-proxmox-orange"}
                                                />
                                                <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>{t('domainHint')}</p>
                                            </div>
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('port')}</label>
                                                <input
                                                    type="number"
                                                    value={serverSettings.port}
                                                    onChange={e => setServerSettings({ ...serverSettings, port: parseInt(e.target.value) })}
                                                    min="1"
                                                    max="65535"
                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm focus:outline-none focus:border-proxmox-orange"}
                                                />
                                                <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>{t('portHint')}</p>
                                            </div>
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('httpRedirectPort2')}</label>
                                                <input
                                                    type="number"
                                                    value={serverSettings.http_redirect_port || 0}
                                                    onChange={e => setServerSettings({ ...serverSettings, http_redirect_port: parseInt(e.target.value) })}
                                                    min="-1"
                                                    max="65535"
                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm focus:outline-none focus:border-proxmox-orange"}
                                                />
                                                <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>{t('httpRedirectPortHint2')}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Reverse Proxy */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-4"}>
                                        <div className="flex items-center justify-between">
                                            <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "font-medium text-white flex items-center gap-2"}>
                                                <Icons.Shield />
                                                {t('reverseProxy')}
                                            </h4>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={serverSettings.reverse_proxy_enabled}
                                                    onChange={e => setServerSettings({ ...serverSettings, reverse_proxy_enabled: e.target.checked })}
                                                    className={isCorporate ? 'corp-input' : "rounded border-proxmox-border bg-proxmox-darker"}
                                                />
                                                <span className={isCorporate ? 'corp-help-text' : "text-sm text-gray-300"}>{t('reverseProxyEnabled')}</span>
                                            </label>
                                        </div>

                                        {serverSettings.reverse_proxy_enabled && (
                                            <div className="space-y-3 pt-1">
                                                <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                                                    <p className="text-sm text-blue-400">{t('reverseProxyHint')}</p>
                                                </div>
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('trustedProxies')}</label>
                                                    <input
                                                        type="text"
                                                        value={serverSettings.trusted_proxies}
                                                        onChange={e => setServerSettings({ ...serverSettings, trusted_proxies: e.target.value })}
                                                        placeholder="10.0.0.1, 172.16.0.0/12"
                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm focus:outline-none focus:border-proxmox-orange"}
                                                    />
                                                    <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>{t('trustedProxiesHint')}</p>
                                                </div>
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('proxyBindAddress')}</label>
                                                    <input
                                                        type="text"
                                                        value={serverSettings.proxy_bind_address}
                                                        onChange={e => setServerSettings({ ...serverSettings, proxy_bind_address: e.target.value })}
                                                        placeholder="127.0.0.1"
                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm focus:outline-none focus:border-proxmox-orange"}
                                                    />
                                                    <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>{t('proxyBindAddressHint')}</p>
                                                </div>
                                                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                                                    <p className="text-sm text-yellow-400">{t('reverseProxyWarning')}</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* SSL/TLS Settings */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-4"}>
                                        <div className="flex items-center justify-between">
                                            <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "font-medium text-white flex items-center gap-2"}>
                                                <Icons.Shield />
                                                {t('sslSettings')}
                                            </h4>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={serverSettings.ssl_enabled}
                                                    onChange={e => setServerSettings({ ...serverSettings, ssl_enabled: e.target.checked })}
                                                    className={isCorporate ? 'corp-input' : "rounded border-proxmox-border bg-proxmox-darker"}
                                                />
                                                <span className={isCorporate ? 'corp-help-text' : "text-sm text-gray-300"}>{t('enableSsl')}</span>
                                            </label>
                                        </div>

                                        {serverSettings.ssl_enabled && (
                                            <div className="space-y-4 pt-2">
                                                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                                                    <p className="text-sm text-yellow-400">
                                                        ⚠️ {t('sslWarning')}
                                                    </p>
                                                </div>

                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('sslCertificate')} (.pem, .crt)</label>
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="text"
                                                            value={serverSettings.ssl_cert}
                                                            readOnly
                                                            placeholder={t('noCertSelected')}
                                                            className={isCorporate ? 'corp-input' : "flex-1 px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                        />
                                                        <label className="px-4 py-2 bg-proxmox-hover hover:bg-proxmox-border rounded-lg text-sm cursor-pointer transition-colors">
                                                            <input
                                                                type="file"
                                                                accept=".pem,.crt,.cer"
                                                                onChange={e => handleCertFileChange(e, 'cert')}
                                                                className="hidden"
                                                            />
                                                            {t('browse')}
                                                        </label>
                                                    </div>
                                                </div>

                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('sslKey')} (.pem, .key)</label>
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="text"
                                                            value={serverSettings.ssl_key}
                                                            readOnly
                                                            placeholder={t('noKeySelected')}
                                                            className={isCorporate ? 'corp-input' : "flex-1 px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                        />
                                                        <label className="px-4 py-2 bg-proxmox-hover hover:bg-proxmox-border rounded-lg text-sm cursor-pointer transition-colors">
                                                            <input
                                                                type="file"
                                                                accept=".pem,.key"
                                                                onChange={e => handleCertFileChange(e, 'key')}
                                                                className="hidden"
                                                            />
                                                            {t('browse')}
                                                        </label>
                                                    </div>
                                                </div>

                                                <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                                                    <p className="text-sm text-blue-400">
                                                        💡 {t('sslHint')}
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        {/* ACME / Let's Encrypt section */}
                                        <div className="mt-4 pt-4 border-t border-proxmox-border">
                                            <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2 mb-3' : "font-medium text-white flex items-center gap-2 mb-3"}>
                                                🔒 {t('acmeTitle')}
                                            </h4>

                                            {/* cert status */}
                                            {serverSettings.cert_info && (
                                                <div className={`p-3 rounded-lg mb-3 ${serverSettings.cert_info.is_self_signed ? 'bg-yellow-500/10 border border-yellow-500/30' : serverSettings.cert_info.days_left > 30 ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                                                    <div className="text-sm space-y-1">
                                                        <div className="flex justify-between">
                                                            <span className={isCorporate ? 'corp-help-text' : "text-gray-400"}>{t('acmeIssuer')}:</span>
                                                            <span className={serverSettings.cert_info.is_self_signed ? 'text-yellow-400' : 'text-white'}>{serverSettings.cert_info.is_self_signed ? t('acmeSelfSigned') : serverSettings.cert_info.issuer}</span>
                                                        </div>
                                                        {!serverSettings.cert_info.is_self_signed && (
                                                            <>
                                                                <div className="flex justify-between">
                                                                    <span className={isCorporate ? 'corp-help-text' : "text-gray-400"}>{t('acmeExpires')}:</span>
                                                                    <span className="text-white">{new Date(serverSettings.cert_info.expires).toLocaleDateString()}</span>
                                                                </div>
                                                                <div className="flex justify-between">
                                                                    <span className={isCorporate ? 'corp-help-text' : "text-gray-400"}>{t('acmeDaysLeft')}:</span>
                                                                    <span className={serverSettings.cert_info.days_left > 30 ? 'text-emerald-400' : 'text-red-400'}>{serverSettings.cert_info.days_left}</span>
                                                                </div>
                                                            </>
                                                        )}
                                                        {serverSettings.cert_info.is_letsencrypt && serverSettings.acme_enabled && (
                                                            <div className="text-emerald-400 text-xs mt-1">✓ {t('acmeAutoRenew')}</div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="space-y-3">
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('acmeProvider')}</label>
                                                    <select
                                                        value={serverSettings.acme_provider || 'letsencrypt'}
                                                        onChange={e => setServerSettings({ ...serverSettings, acme_provider: e.target.value, acme_directory_url: e.target.value === 'custom' ? serverSettings.acme_directory_url : '' })}
                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                    >
                                                        <option value="letsencrypt">Let's Encrypt</option>
                                                        <option value="custom">{t('acmeProviderCustom')}</option>
                                                    </select>
                                                </div>

                                                {serverSettings.acme_provider === 'custom' && (
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('acmeDirectoryUrl')}</label>
                                                        <input
                                                            type="url"
                                                            value={serverSettings.acme_directory_url || ''}
                                                            onChange={e => setServerSettings({ ...serverSettings, acme_directory_url: e.target.value })}
                                                            placeholder="https://step-ca.example.com/acme/acme/directory"
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                        />
                                                        <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>{t('acmeDirectoryUrlHint')}</p>
                                                    </div>
                                                )}

                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('acmeEmail')}</label>
                                                    <input
                                                        type="email"
                                                        value={serverSettings.acme_email}
                                                        onChange={e => setServerSettings({ ...serverSettings, acme_email: e.target.value })}
                                                        placeholder="admin@example.com"
                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                    />
                                                    <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>{serverSettings.acme_provider === 'letsencrypt' ? t('acmeEmailHint') : (t('acmeEmailOptionalHint'))}</p>
                                                </div>

                                                {serverSettings.acme_provider === 'letsencrypt' && (
                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={serverSettings.acme_staging}
                                                            onChange={e => setServerSettings({ ...serverSettings, acme_staging: e.target.checked })}
                                                            className={isCorporate ? 'corp-input' : "rounded border-proxmox-border bg-proxmox-darker"}
                                                        />
                                                        <span className={isCorporate ? 'corp-help-text' : "text-sm text-gray-300"}>{t('acmeStaging')}</span>
                                                        <span className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>({t('acmeStagingHint')})</span>
                                                    </label>
                                                )}

                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('acmeChallengeType')}</label>
                                                    <select
                                                        value={serverSettings.acme_challenge_type || 'http-01'}
                                                        onChange={e => {
                                                            setServerSettings({ ...serverSettings, acme_challenge_type: e.target.value });
                                                            setAcmeResult(null);
                                                        }}
                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                    >
                                                        <option value="http-01">{t('acmeChallengeHttp')}</option>
                                                        <option value="dns-01">{t('acmeChallengeDns')}</option>
                                                    </select>
                                                </div>

                                                {(serverSettings.acme_challenge_type || 'http-01') === 'dns-01' && (
                                                    <>
                                                        <div>
                                                            <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('acmeDnsProvider')}</label>
                                                            <select
                                                                value={serverSettings.acme_dns_provider || 'manual'}
                                                                onChange={e => setServerSettings({ ...serverSettings, acme_dns_provider: e.target.value })}
                                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                            >
                                                                <option value="manual">{t('acmeDnsProviderManual')}</option>
                                                                <option value="rfc2136">{t('acmeDnsProviderRfc2136')}</option>
                                                            </select>
                                                        </div>

                                                        {(serverSettings.acme_dns_provider || 'manual') === 'rfc2136' && (
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('acmeDnsNameserver')}</label>
                                                                    <input
                                                                        type="text"
                                                                        value={serverSettings.acme_dns_rfc2136_nameserver || ''}
                                                                        onChange={e => setServerSettings({ ...serverSettings, acme_dns_rfc2136_nameserver: e.target.value })}
                                                                        placeholder="192.0.2.53"
                                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('acmeDnsPort')}</label>
                                                                    <input
                                                                        type="number"
                                                                        min="1"
                                                                        max="65535"
                                                                        value={serverSettings.acme_dns_rfc2136_port || 53}
                                                                        onChange={e => setServerSettings({ ...serverSettings, acme_dns_rfc2136_port: parseInt(e.target.value) || 53 })}
                                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('acmeDnsZone')}</label>
                                                                    <input
                                                                        type="text"
                                                                        value={serverSettings.acme_dns_rfc2136_zone || ''}
                                                                        onChange={e => setServerSettings({ ...serverSettings, acme_dns_rfc2136_zone: e.target.value })}
                                                                        placeholder="example.com"
                                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('acmeDnsKeyName')}</label>
                                                                    <input
                                                                        type="text"
                                                                        value={serverSettings.acme_dns_rfc2136_key_name || ''}
                                                                        onChange={e => setServerSettings({ ...serverSettings, acme_dns_rfc2136_key_name: e.target.value })}
                                                                        placeholder="mein-certbot-key"
                                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('acmeDnsAlgorithm')}</label>
                                                                    <select
                                                                        value={serverSettings.acme_dns_rfc2136_algorithm || 'hmac-sha512'}
                                                                        onChange={e => setServerSettings({ ...serverSettings, acme_dns_rfc2136_algorithm: e.target.value })}
                                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                                    >
                                                                        <option value="hmac-sha512">hmac-sha512</option>
                                                                        <option value="hmac-sha384">hmac-sha384</option>
                                                                        <option value="hmac-sha256">hmac-sha256</option>
                                                                        <option value="hmac-sha224">hmac-sha224</option>
                                                                        <option value="hmac-sha1">hmac-sha1</option>
                                                                        <option value="hmac-md5">hmac-md5</option>
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('acmeDnsSecret')}</label>
                                                                    <input
                                                                        type="password"
                                                                        value={serverSettings.acme_dns_rfc2136_secret || ''}
                                                                        onChange={e => setServerSettings({ ...serverSettings, acme_dns_rfc2136_secret: e.target.value })}
                                                                        placeholder="IHR_GENERIERTER_BASE64_SECRET_STRING"
                                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('acmeDnsTtl')}</label>
                                                                    <input
                                                                        type="number"
                                                                        min="1"
                                                                        max="86400"
                                                                        value={serverSettings.acme_dns_rfc2136_ttl || 60}
                                                                        onChange={e => setServerSettings({ ...serverSettings, acme_dns_rfc2136_ttl: parseInt(e.target.value) || 60 })}
                                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('acmeDnsPropagation')}</label>
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        max="600"
                                                                        value={serverSettings.acme_dns_propagation_seconds || 30}
                                                                        onChange={e => setServerSettings({ ...serverSettings, acme_dns_propagation_seconds: parseInt(e.target.value) || 0 })}
                                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}
                                                    </>
                                                )}

                                                <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                                                    <p className="text-xs text-blue-400">
                                                        {(serverSettings.acme_challenge_type || 'http-01') === 'dns-01'
                                                            ? ((serverSettings.acme_dns_provider || 'manual') === 'rfc2136'
                                                                ? (t('acmeDnsRfc2136Hint'))
                                                                : (t('acmeDnsHint')))
                                                            : t('acmePort80')}
                                                    </p>
                                                </div>

                                                {acmeResult?.pending_dns && (
                                                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-3">
                                                        <p className="text-sm text-amber-300">{t('acmeDnsInstructions')}</p>
                                                        <div>
                                                            <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('acmeDnsName')}</label>
                                                            <input
                                                                readOnly
                                                                value={acmeResult.dns_name || ''}
                                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm font-mono"}
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('acmeDnsValue')}</label>
                                                            <textarea
                                                                readOnly
                                                                value={acmeResult.dns_value || ''}
                                                                rows="2"
                                                                className={isCorporate ? 'corp-input resize-none' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm font-mono resize-none"}
                                                            />
                                                        </div>
                                                        <button
                                                            onClick={handleAcmeDnsComplete}
                                                            disabled={acmeLoading}
                                                            className="w-full px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                                                        >
                                                            {acmeLoading ? t('acmeRequesting') : (t('acmeDnsContinue'))}
                                                        </button>
                                                    </div>
                                                )}

                                                {acmeResult && !acmeResult.success && !acmeResult.pending_dns && (
                                                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                                                        <p className="text-sm text-red-400">{acmeResult.message}</p>
                                                    </div>
                                                )}

                                                <button
                                                    onClick={handleAcmeRequest}
                                                    disabled={acmeLoading || !serverSettings.domain || (serverSettings.acme_provider === 'letsencrypt' && !serverSettings.acme_email) || (serverSettings.acme_provider === 'custom' && !serverSettings.acme_directory_url) || ((serverSettings.acme_challenge_type || 'http-01') === 'dns-01' && (serverSettings.acme_dns_provider || 'manual') === 'rfc2136' && (!serverSettings.acme_dns_rfc2136_nameserver || !serverSettings.acme_dns_rfc2136_zone || !serverSettings.acme_dns_rfc2136_key_name || !serverSettings.acme_dns_rfc2136_secret))}
                                                    className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                                                >
                                                    {acmeLoading ? t('acmeRequesting') : ((serverSettings.acme_challenge_type || 'http-01') === 'dns-01' && (serverSettings.acme_dns_provider || 'manual') === 'manual' ? (t('acmeDnsPrepare')) : t('acmeRequest'))}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* SMTP Settings */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-4"}>
                                        <div className="flex items-center justify-between">
                                            <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "font-medium text-white flex items-center gap-2"}>
                                                <Icons.Mail />
                                                {t('smtpSettings')}
                                            </h4>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={serverSettings.smtp_enabled}
                                                    onChange={e => setServerSettings({ ...serverSettings, smtp_enabled: e.target.checked })}
                                                    className={isCorporate ? 'corp-input' : "rounded border-proxmox-border bg-proxmox-darker"}
                                                />
                                                <span className={isCorporate ? 'corp-help-text' : "text-sm text-gray-300"}>{t('enabled')}</span>
                                            </label>
                                        </div>

                                        {serverSettings.smtp_enabled && (
                                            <div className="space-y-4 pt-2">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('smtpHost')}</label>
                                                        <input
                                                            type="text"
                                                            value={serverSettings.smtp_host}
                                                            onChange={e => setServerSettings({ ...serverSettings, smtp_host: e.target.value })}
                                                            placeholder="smtp.gmail.com"
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('smtpPort')}</label>
                                                        <input
                                                            type="number"
                                                            value={serverSettings.smtp_port}
                                                            onChange={e => setServerSettings({ ...serverSettings, smtp_port: parseInt(e.target.value) })}
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                        />
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('smtpUser')}</label>
                                                        <input
                                                            type="text"
                                                            value={serverSettings.smtp_user}
                                                            onChange={e => setServerSettings({ ...serverSettings, smtp_user: e.target.value })}
                                                            placeholder="user@example.com"
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('smtpPassword')}</label>
                                                        <input
                                                            type="password"
                                                            value={serverSettings.smtp_password}
                                                            onChange={e => setServerSettings({ ...serverSettings, smtp_password: e.target.value })}
                                                            placeholder="••••••••"
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                        />
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('smtpFromEmail')}</label>
                                                        <input
                                                            type="email"
                                                            value={serverSettings.smtp_from_email}
                                                            onChange={e => setServerSettings({ ...serverSettings, smtp_from_email: e.target.value })}
                                                            placeholder="noreply@example.com"
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('smtpFromName')}</label>
                                                        <input
                                                            type="text"
                                                            value={serverSettings.smtp_from_name}
                                                            onChange={e => setServerSettings({ ...serverSettings, smtp_from_name: e.target.value })}
                                                            placeholder="ProxmoxVEx Alerts"
                                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                        />
                                                    </div>
                                                </div>

                                                <div className="flex gap-6">
                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={serverSettings.smtp_tls}
                                                            onChange={e => setServerSettings({ ...serverSettings, smtp_tls: e.target.checked, smtp_ssl: e.target.checked ? false : serverSettings.smtp_ssl })}
                                                            className="rounded"
                                                        />
                                                        <span className={isCorporate ? 'corp-help-text' : "text-sm text-gray-300"}>{t('smtpTls')} (STARTTLS)</span>
                                                    </label>
                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={serverSettings.smtp_ssl}
                                                            onChange={e => setServerSettings({ ...serverSettings, smtp_ssl: e.target.checked, smtp_tls: e.target.checked ? false : serverSettings.smtp_tls })}
                                                            className="rounded"
                                                        />
                                                        <span className={isCorporate ? 'corp-help-text' : "text-sm text-gray-300"}>{t('smtpSsl')} (SSL/TLS)</span>
                                                    </label>
                                                </div>

                                                {/* Test Email */}
                                                <div className="pt-3 border-t border-proxmox-border">
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('testEmail')}</label>
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="email"
                                                            value={testEmailAddress}
                                                            onChange={e => setTestEmailAddress(e.target.value)}
                                                            placeholder="test@example.com"
                                                            className={isCorporate ? 'corp-input' : "flex-1 px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                        />
                                                        <button
                                                            onClick={handleTestEmail}
                                                            disabled={testEmailLoading || !serverSettings.smtp_host}
                                                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                                                        >
                                                            {testEmailLoading ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : null}
                                                            {t('testEmail')}
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Save SMTP Button */}
                                                <div className="pt-3 flex justify-end">
                                                    <button
                                                        onClick={handleSaveSMTPSettings}
                                                        disabled={smtpLoading}
                                                        className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                                                    >
                                                        {smtpLoading && <Icons.Loader className="w-4 h-4 animate-spin" />}
                                                        {t('saveSmtpSettings')}
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {/* Save SMTP Button - always visible when disabled to allow enabling */}
                                        {!serverSettings.smtp_enabled && (
                                            <div className="pt-3 flex justify-end border-t border-proxmox-border mt-3">
                                                <p className={isCorporate ? 'corp-help-text mr-auto my-auto' : "text-xs text-gray-500 mr-auto my-auto"}>
                                                    {t('enableSmtpHint')}
                                                </p>
                                                <button
                                                    onClick={handleSaveSMTPSettings}
                                                    disabled={smtpLoading}
                                                    className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                                                >
                                                    {smtpLoading && <Icons.Loader className="w-4 h-4 animate-spin" />}
                                                    {t('save')}
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Alert Email Recipients */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-4"}>
                                        <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "font-medium text-white flex items-center gap-2"}>
                                            <Icons.Bell />
                                            {t('emailRecipients')}
                                        </h4>
                                        <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>{t('alertsDesc')}</p>

                                        <div className="space-y-2">
                                            {(serverSettings.alert_email_recipients || []).map((email, idx) => (
                                                <div key={idx} className="flex items-center gap-2">
                                                    <span className="flex-1 px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm">{email}</span>
                                                    <button
                                                        onClick={() => setServerSettings({
                                                            ...serverSettings,
                                                            alert_email_recipients: serverSettings.alert_email_recipients.filter((_, i) => i !== idx)
                                                        })}
                                                        className="p-2 text-red-400 hover:text-red-300"
                                                    >
                                                        <Icons.Trash />
                                                    </button>
                                                </div>
                                            ))}

                                            <div className="flex gap-2">
                                                <input
                                                    type="email"
                                                    id="newRecipientEmail"
                                                    placeholder="admin@example.com"
                                                    className={isCorporate ? 'corp-input' : "flex-1 px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                                />
                                                <button
                                                    onClick={() => {
                                                        const input = document.getElementById('newRecipientEmail');
                                                        if (input.value && input.value.includes('@')) {
                                                            setServerSettings({
                                                                ...serverSettings,
                                                                alert_email_recipients: [...(serverSettings.alert_email_recipients || []), input.value]
                                                            });
                                                            input.value = '';
                                                        }
                                                    }}
                                                    className="px-4 py-2 bg-proxmox-hover hover:bg-proxmox-border rounded-lg text-sm"
                                                >
                                                    {t('addRecipient')}
                                                </button>
                                            </div>
                                        </div>

                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('alertCooldown')}</label>
                                            <input
                                                type="number"
                                                value={serverSettings.alert_cooldown}
                                                onChange={e => setServerSettings({ ...serverSettings, alert_cooldown: parseInt(e.target.value) })}
                                                min="60"
                                                className={isCorporate ? 'corp-input w-32' : "w-32 px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                            />
                                            <span className={isCorporate ? 'corp-help-text ml-2' : "text-xs text-gray-500 ml-2"}>(min 60s)</span>
                                        </div>

                                        {/* (#331) - update-available email toggle.
                                            Uses the same recipients list; dedup handled server-side. */}
                                        <div className="pt-2 border-t border-proxmox-border">
                                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={!!serverSettings.alert_update_available}
                                                    onChange={e => setServerSettings({ ...serverSettings, alert_update_available: e.target.checked })}
                                                    className="w-4 h-4"
                                                />
                                                <span className="text-sm text-white">{t('alertUpdateAvailable')}</span>
                                            </label>
                                            <p className={isCorporate ? 'corp-help-text mt-1 ml-6' : "text-xs text-gray-500 mt-1 ml-6"}>{t('alertUpdateAvailableDesc')}</p>
                                        </div>
                                    </div>

                                    {/* Webhook alert channels */}
                                    <AlertChannelsPanel t={t} addToast={addToast} getAuthHeaders={getAuthHeaders} />

                                    {/* Save Button */}
                                    <div className="flex justify-end gap-3">
                                        <button
                                            onClick={handleSaveServerSettings}
                                            disabled={serverLoading}
                                            className="flex items-center gap-2 px-6 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                                        >
                                            {serverLoading ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : <Icons.Save />}
                                            {t('saveSettings')}
                                        </button>
                                    </div>

                                    {/* Restart Server Section */}
                                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "font-medium text-white flex items-center gap-2"}>
                                                    <Icons.RefreshCw />
                                                    {t('restartServer')}
                                                </h4>
                                                <p className={isCorporate ? 'corp-help-text mt-1' : "text-sm text-gray-400 mt-1"}>
                                                    {t('restartServerDesc')}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => setShowRestartConfirm(true)}
                                                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-colors"
                                            >
                                                <Icons.Power />
                                                {t('restartNow')}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Info Box */}
                                    <div className={isCorporate ? 'corp-settings-card' : "p-4 bg-proxmox-dark border border-proxmox-border rounded-xl"}>
                                        <h4 className={isCorporate ? 'corp-card-header mb-2' : "font-medium text-white mb-2"}>{t('restartInfo')}</h4>
                                        <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>
                                            {t('restartInfoDesc')}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Restart Confirmation Modal */}
                            {showRestartConfirm && (
                                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80">
                                    <div className="w-full max-w-md bg-proxmox-card border border-red-500/30 rounded-xl overflow-hidden animate-scale-in">
                                        <div className="p-6 border-b border-red-500/30 bg-red-500/10">
                                            <div className="flex items-center gap-3">
                                                <div className="p-3 rounded-full bg-red-500/20">
                                                    <Icons.AlertTriangle />
                                                </div>
                                                <div>
                                                    <h3 className={isCorporate ? 'corp-card-header' : "text-lg font-semibold text-white"}>{t('confirmRestart')}</h3>
                                                    <p className="text-sm text-red-400">{t('restartWarning')}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="p-6">
                                            <p className={isCorporate ? 'corp-help-text mb-4' : "text-gray-300 mb-4"}>{t('restartConfirmText')}</p>
                                            <ul className={isCorporate ? 'corp-help-text space-y-1 mb-4' : "text-sm text-gray-400 space-y-1 mb-4"}>
                                                <li>• {t('restartEffect1')}</li>
                                                <li>• {t('restartEffect2')}</li>
                                                <li>• {t('restartEffect3')}</li>
                                            </ul>
                                        </div>

                                        <div className="flex items-center justify-end gap-3 p-4 border-t border-proxmox-border bg-proxmox-dark">
                                            <button
                                                onClick={() => setShowRestartConfirm(false)}
                                                className="px-4 py-2 text-gray-300 hover:text-white"
                                            >
                                                {t('cancel')}
                                            </button>
                                            <button
                                                onClick={handleRestartServer}
                                                disabled={restartLoading}
                                                className="flex items-center gap-2 px-4 py-2 bg-red-600 rounded-lg text-white hover:bg-red-700 disabled:opacity-50"
                                            >
                                                {restartLoading ? (
                                                    <>
                                                        <Icons.RotateCw className="w-4 h-4 animate-spin" />
                                                        {t('restarting')}
                                                    </>
                                                ) : (
                                                    <>
                                                        <Icons.Power />
                                                        {t('yesRestart')}
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>

                                </div>
                            )}

                            {activeTab === 'plugins' && (
                                <div className="space-y-6">
                                    {/* Plugin Management */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-4"}>
                                        <div className="flex items-center justify-between">
                                            <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "font-medium text-white flex items-center gap-2"}>
                                                <Icons.Package className="w-4 h-4" />
                                                {t('plugins')}
                                            </h4>
                                            <button onClick={async () => {
                                                try {
                                                    await fetch(`${API_URL}/plugins/rescan`, { method: 'POST', credentials: 'include', headers: getAuthHeaders() });
                                                    fetchPlugins();
                                                    addToast('Plugins rescanned', 'success');
                                                } catch (e) { }
                                            }} className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                                                <Icons.RefreshCw className="w-3 h-3" />
                                                Rescan
                                            </button>
                                        </div>
                                        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                                            <p className="text-xs text-yellow-400">
                                                {t('pluginDisclaimer')}
                                            </p>
                                        </div>
                                        {discoveredPlugins.length === 0 ? (
                                            <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-500"}>{t('noPlugins')}</p>
                                        ) : (
                                            <div className="space-y-2">
                                                {discoveredPlugins.map(plugin => (
                                                    <div key={plugin.id} className={isCorporate ? 'corp-settings-card flex items-center justify-between' : "flex items-center justify-between p-3 bg-proxmox-darker rounded-lg border border-proxmox-border"}>
                                                        <div className="flex-1 min-w-0 mr-3">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-medium text-white text-sm">{plugin.name}</span>
                                                                <span className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>v{plugin.version}</span>
                                                            </div>
                                                            {plugin.author && <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>{t('pluginAuthor')} {plugin.author}</p>}
                                                            {plugin.description && <p className={isCorporate ? 'corp-help-text mt-0.5' : "text-xs text-gray-400 mt-0.5"}>{plugin.description}</p>}
                                                            {plugin.error && <p className="text-xs text-red-400 mt-0.5">{plugin.error}</p>}
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <div
                                                                className={`toggle-switch ${plugin.enabled ? 'active' : ''} ${togglingPlugin === plugin.id ? 'opacity-50 pointer-events-none' : ''}`}
                                                                onClick={() => { if (togglingPlugin !== plugin.id) togglePlugin(plugin.id, plugin.enabled); }}
                                                            />
                                                            <button onClick={async () => {
                                                                try {
                                                                    const r = await fetch(`${API_URL}/plugins/${plugin.id}/config`, { credentials: 'include', headers: getAuthHeaders() });
                                                                    let cfgText = '{}';
                                                                    if (r && r.ok) {
                                                                        const d = await r.json().catch(() => ({}));
                                                                        cfgText = d.config || '{}';
                                                                        try { cfgText = JSON.stringify(JSON.parse(cfgText), null, 4); } catch (e) { }
                                                                    }
                                                                    setEditingPluginConfig({ id: plugin.id, name: plugin.name, config: cfgText });
                                                                } catch (e) { addToast('Error loading config', 'error'); }
                                                            }} className="text-gray-400/50 hover:text-proxmox-orange transition-colors" title="Edit config.json">
                                                                <Icons.Edit className="w-4 h-4" />
                                                            </button>
                                                            <button onClick={() => handleDeletePlugin(plugin)} disabled={deletingPlugin === plugin.id} className="text-red-400/50 hover:text-red-400 transition-colors disabled:opacity-50" title="Delete plugin">
                                                                {deletingPlugin === plugin.id ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : <Icons.Trash2 className="w-4 h-4" />}
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Plugin Config Editor — uses high z-index to overlay everything */}
                                    {editingPluginConfig && (
                                        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'rgba(0,0,0,0.85)' }} onClick={() => setEditingPluginConfig(null)}>
                                            <div className={isCorporate ? 'corp-settings-card w-full max-w-4xl overflow-hidden shadow-2xl' : "w-full max-w-4xl bg-proxmox-card border border-proxmox-border rounded-xl overflow-hidden shadow-2xl"} style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
                                                <div className="flex items-center justify-between p-4 border-b border-proxmox-border flex-shrink-0">
                                                    <div>
                                                        <h3 className={isCorporate ? 'corp-card-header' : "text-white font-semibold text-base"}>{editingPluginConfig.name} — config.json</h3>
                                                        <p className={isCorporate ? 'corp-help-text mt-0.5' : "text-xs text-gray-500 mt-0.5"}>Edit plugin configuration (JSON)</p>
                                                    </div>
                                                    <button onClick={() => setEditingPluginConfig(null)} className="p-2 hover:bg-proxmox-border rounded"><Icons.X /></button>
                                                </div>
                                                <div className="p-4 flex-1 overflow-hidden">
                                                    <PluginConfigForm
                                                        config={editingPluginConfig.config}
                                                        onChange={newConfig => setEditingPluginConfig({ ...editingPluginConfig, config: newConfig })}
                                                        isCorporate={isCorporate}
                                                    />
                                                </div>
                                                <div className="flex items-center justify-between p-4 border-t border-proxmox-border flex-shrink-0">
                                                    <span className="text-xs text-gray-500">Switch to Form or Raw JSON in the editor.</span>
                                                    <div className="flex gap-2">
                                                        <button onClick={() => setEditingPluginConfig(null)} disabled={savingPluginConfig} className="px-4 py-2 bg-proxmox-border hover:bg-gray-600 rounded-lg text-sm transition-colors disabled:opacity-50">
                                                            {t('cancel')}
                                                        </button>
                                                        <button onClick={async () => {
                                                            try {
                                                                JSON.parse(editingPluginConfig.config);
                                                            } catch (e) {
                                                                addToast('Invalid JSON: ' + e.message, 'error');
                                                                return;
                                                            }
                                                            setSavingPluginConfig(true);
                                                            try {
                                                                const r = await fetch(`${API_URL}/plugins/${editingPluginConfig.id}/config`, {
                                                                    method: 'PUT', credentials: 'include',
                                                                    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                                                                    body: JSON.stringify({ config: editingPluginConfig.config })
                                                                });
                                                                if (r && r.ok) {
                                                                    addToast('Config saved. Restart plugin to apply changes.', 'success');
                                                                    setEditingPluginConfig(null);
                                                                } else {
                                                                    const e = await r.json().catch(() => ({}));
                                                                    addToast(e.error || 'Save failed', 'error');
                                                                }
                                                            } catch (e) { addToast('Error saving config', 'error'); }
                                                            finally { setSavingPluginConfig(false); }
                                                        }} disabled={savingPluginConfig} className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2">
                                                            {savingPluginConfig ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : null}
                                                            {t('saveSettings')}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                </div>
                            )}

                            {activeTab === 'native' && (
                                <div className="space-y-6">
                                    {/* Native Integrations */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4 space-y-4"}>
                                        <div className="flex items-center justify-between">
                                            <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "font-medium text-white flex items-center gap-2"}>
                                                <Icons.Plug className="w-4 h-4" />
                                                Native Integrations
                                            </h4>
                                        </div>
                                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-400"}>
                                            Built-in integrations ship with ProxmoxVEx. Use the dashboard <strong>Native Integrations</strong> button, or click Configure below.
                                        </p>
                                        {/* Render all native integrations from the shared catalog instead of a hard-coded four. */}
                                        {NATIVE_INTEGRATION_LIST.map(integration => (
                                            <div key={integration.id} className={isCorporate ? 'corp-settings-card flex items-center justify-between' : "flex items-center justify-between p-3 bg-proxmox-darker rounded-lg border border-proxmox-border"}>
                                                <div className="flex-1 min-w-0 mr-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-white text-sm">{integration.label}</span>
                                                    </div>
                                                    <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>{integration.desc}</p>
                                                </div>
                                                <button
                                                    onClick={() => setNativeIntegrationConfig(integration.id)}
                                                    className="text-xs px-3 py-1.5 bg-proxmox-border hover:bg-gray-600 rounded-lg transition-colors text-white"
                                                >
                                                    Configure
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    {nativeIntegrationConfig && (
                                        <AddIntegrationModal
                                            isOpen={true}
                                            onClose={() => setNativeIntegrationConfig(null)}
                                            addToast={addToast}
                                            initialModule={nativeIntegrationConfig}
                                        />
                                    )}

                                </div>
                            )}

                            {activeTab === 'audit' && (
                                <div className="space-y-4">
                                    {/* Server-side rich search */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-3 space-y-2"}>
                                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                                            <input
                                                type="text" value={auditQuery}
                                                onChange={e => setAuditQuery(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') fetchAuditLogs(0); }}
                                                placeholder={t('auditSearchQuery2')}
                                                className={isCorporate ? 'corp-input col-span-2' : "col-span-2 px-3 py-1.5 bg-proxmox-darker border border-proxmox-border rounded text-sm text-white"}
                                            />
                                            <input
                                                type="datetime-local" value={auditFrom}
                                                onChange={e => setAuditFrom(e.target.value)}
                                                title={t('auditDateFrom')}
                                                className={isCorporate ? 'corp-input' : "px-3 py-1.5 bg-proxmox-darker border border-proxmox-border rounded text-sm text-white"}
                                            />
                                            <input
                                                type="datetime-local" value={auditTo}
                                                onChange={e => setAuditTo(e.target.value)}
                                                title={t('auditDateTo')}
                                                className={isCorporate ? 'corp-input' : "px-3 py-1.5 bg-proxmox-darker border border-proxmox-border rounded text-sm text-white"}
                                            />
                                            <select
                                                value={auditSev}
                                                onChange={e => setAuditSev(e.target.value)}
                                                className={isCorporate ? 'corp-input' : "px-3 py-1.5 bg-proxmox-darker border border-proxmox-border rounded text-sm text-white"}>
                                                <option value="">{t('auditAnySeverity')}</option>
                                                <option value="info">info</option>
                                                <option value="warning">warning</option>
                                                <option value="critical">critical</option>
                                            </select>
                                            <input
                                                type="text" value={auditIp}
                                                onChange={e => setAuditIp(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') fetchAuditLogs(0); }}
                                                placeholder="IP"
                                                className={isCorporate ? 'corp-input' : "px-3 py-1.5 bg-proxmox-darker border border-proxmox-border rounded text-sm text-white"}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <div className="text-xs text-gray-500">
                                                {auditTotal > 0
                                                    ? `${auditOffset + 1}–${Math.min(auditOffset + auditLogs.length, auditTotal)} ${t('of')} ${auditTotal}`
                                                    : (t('noAuditLogs2'))}
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={() => { setAuditQuery(''); setAuditFrom(''); setAuditTo(''); setAuditSev(''); setAuditIp(''); setAuditClusterFilter(''); setAuditOffset(0); setTimeout(() => fetchAuditLogs(0), 0); }}
                                                    className="px-3 py-1 text-xs text-gray-400 hover:text-white">
                                                    {t('clearFilters')}
                                                </button>
                                                <button onClick={() => fetchAuditLogs(0)}
                                                    className="px-3 py-1 bg-proxmox-orange hover:bg-orange-600 text-white text-xs rounded">
                                                    {t('search')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Filters and Export */}
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-3">
                                            <select
                                                value={userFilter}
                                                onChange={e => setUserFilter(e.target.value)}
                                                className={isCorporate ? 'corp-input' : "px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-sm text-white focus:outline-none focus:border-proxmox-orange"}
                                            >
                                                <option value="">{t('allUsers')}</option>
                                                {uniqueUsers.map(u => (
                                                    <option key={u} value={u}>{u}</option>
                                                ))}
                                            </select>
                                            <select
                                                value={actionFilter}
                                                onChange={e => setActionFilter(e.target.value)}
                                                className={isCorporate ? 'corp-input' : "px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-sm text-white focus:outline-none focus:border-proxmox-orange"}
                                            >
                                                <option value="">{t('allActions')}</option>
                                                {uniqueActions.map(a => (
                                                    <option key={a} value={a}>{getActionLabel(a)}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={fetchAuditLogs}
                                                className="flex items-center gap-2 px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-sm text-gray-300 hover:text-white hover:border-proxmox-orange transition-colors"
                                            >
                                                <Icons.RefreshCw />
                                                {t('refreshAuditLog')}
                                            </button>
                                            <button
                                                onClick={exportAuditLog}
                                                className="flex items-center gap-2 px-3 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium transition-colors"
                                                title={t('exportFilteredHint')}
                                            >
                                                <Icons.Download />
                                                {t('exportAuditLog')}
                                            </button>
                                            {/* Full server-side CSV export for compliance archives.
                                                Differs from the button above in two ways: no client filter applied,
                                                and higher row cap (server honours ?limit=10000). */}
                                            <a
                                                href={`${API_URL}/audit?format=csv&limit=10000`}
                                                download
                                                className="flex items-center gap-2 px-3 py-2 bg-proxmox-dark hover:bg-proxmox-hover border border-proxmox-border rounded-lg text-sm font-medium transition-colors"
                                                title={t('exportFullCsvHint')}
                                            >
                                                <Icons.Download />
                                                {t('exportFullCsv')}
                                            </a>
                                            <SettingsModalColumnPicker
                                                columns={auditColumns}
                                                visible={auditVisibleColumns}
                                                onToggle={toggleAuditColumn}
                                            />
                                        </div>
                                    </div>

                                    <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>{t('auditLogDescription')}</p>

                                    {/* Audit Log Table */}
                                    <div className={isCorporate ? 'corp-settings-card overflow-hidden' : "bg-proxmox-dark border border-proxmox-border rounded-xl overflow-hidden"}>
                                        <div className="max-h-[400px] overflow-auto">
                                            <table className="w-full">
                                                <thead className="sticky top-0 bg-proxmox-dark">
                                                    <tr className="border-b border-proxmox-border">
                                                        {auditVisibleColumns.includes('timestamp') && <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t('timestamp')}</th>}
                                                        {auditVisibleColumns.includes('username') && <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t('usernameLabel')}</th>}
                                                        {auditVisibleColumns.includes('cluster') && <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t('cluster')}</th>}
                                                        {auditVisibleColumns.includes('action') && <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t('action')}</th>}
                                                        {auditVisibleColumns.includes('details') && <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t('details')}</th>}
                                                        {auditVisibleColumns.includes('ip_address') && <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t('ipAddress')}</th>}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {filteredLogs.length === 0 ? (
                                                        <tr>
                                                            <td colSpan={auditVisibleColumns.length} className="px-4 py-8 text-center text-gray-400">
                                                                {t('noAuditLogs')}
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        filteredLogs.map((log, idx) => (
                                                            <tr key={idx} className="border-b border-gray-700/50 hover:bg-proxmox-hover">
                                                                {auditVisibleColumns.includes('timestamp') && <td className="px-4 py-3 text-gray-400 text-sm whitespace-nowrap">
                                                                    {new Date(log.timestamp).toLocaleString()}
                                                                </td>}
                                                                {auditVisibleColumns.includes('username') && <td className="px-4 py-3 text-white font-medium">{log.user}</td>}
                                                                {auditVisibleColumns.includes('cluster') && <td className="px-4 py-3 text-sm">
                                                                    {log.cluster ? (
                                                                        <span className="px-2 py-1 rounded bg-proxmox-dark border border-proxmox-border text-proxmox-orange text-xs">
                                                                            {log.cluster}
                                                                        </span>
                                                                    ) : (
                                                                        <span className={isCorporate ? 'corp-help-text' : "text-gray-500"}>-</span>
                                                                    )}
                                                                </td>}
                                                                {auditVisibleColumns.includes('action') && <td className="px-4 py-3">
                                                                    <span className={`px-2 py-1 rounded text-xs font-medium ${log.action.includes('login') ? 'bg-green-500/10 text-green-400' :
                                                                        log.action.includes('logout') ? 'bg-yellow-500/10 text-yellow-400' :
                                                                            log.action.includes('delete') ? 'bg-red-500/10 text-red-400' :
                                                                                log.action.includes('create') || log.action.includes('added') ? 'bg-blue-500/10 text-blue-400' :
                                                                                    'bg-gray-500/10 text-gray-400'
                                                                        }`}>
                                                                        {getActionLabel(log.action)}
                                                                    </span>
                                                                </td>}
                                                                {auditVisibleColumns.includes('details') && <td className="px-4 py-3 text-gray-300 text-sm max-w-xs truncate" title={log.details}>
                                                                    {log.details || '-'}
                                                                </td>}
                                                                {auditVisibleColumns.includes('ip_address') && <td className="px-4 py-3 text-gray-400 text-sm font-mono">
                                                                    {log.ip_address || '-'}
                                                                </td>}
                                                            </tr>
                                                        ))
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    {/* Pagination */}
                                    {auditTotal > auditPageSize && (
                                        <div className="flex items-center justify-between text-xs text-gray-400">
                                            <span>{auditOffset + 1}–{Math.min(auditOffset + auditLogs.length, auditTotal)} {t('of')} {auditTotal}</span>
                                            <div className="flex gap-2">
                                                <button onClick={() => fetchAuditLogs(Math.max(0, auditOffset - auditPageSize))}
                                                    disabled={auditOffset <= 0}
                                                    className="px-3 py-1 bg-proxmox-dark border border-proxmox-border rounded disabled:opacity-50 hover:text-white">
                                                    ← {t('prev')}
                                                </button>
                                                <button onClick={() => fetchAuditLogs(auditOffset + auditPageSize)}
                                                    disabled={(auditOffset + auditLogs.length) >= auditTotal}
                                                    className="px-3 py-1 bg-proxmox-dark border border-proxmox-border rounded disabled:opacity-50 hover:text-white">
                                                    {t('next')} →
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* SIEM Forwarder Tab */}
                            {activeTab === 'siem' && (
                                <SIEMTab addToast={addToast} t={t} getAuthHeaders={getAuthHeaders} />
                            )}

                            {/* Updates Tab */}
                            {activeTab === 'updates' && (
                                <div
                                    className="space-y-6"
                                    data-testid="update-rollout-tab"
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        setUpdateRolloutMenu({
                                            x: e.clientX,
                                            y: e.clientY,
                                            items: [
                                                { id: 'check', label: t('checkForUpdates') },
                                                { id: 'install', label: t('installUpdate'), disabled: !updateInfo?.update_available },
                                                { id: 'backups', label: t('viewBackups') },
                                                { id: 'github', label: t('openGitHubRelease'), disabled: !updateInfo?.download_url },
                                            ].filter(Boolean),
                                        });
                                    }}
                                >
                                    {/* Current Version */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-6"}>
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "text-lg font-semibold text-white flex items-center gap-2"}>
                                                    <Icons.Package />
                                                    Current Version
                                                </h3>
                                                <div className="mt-2 space-y-1">
                                                    <p className="text-2xl font-bold text-proxmox-orange">
                                                        ProxmoxVEx {updateInfo?.current_version || ProxmoxVEx_VERSION}
                                                    </p>
                                                    <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>
                                                        Build: {updateInfo?.current_build || '2026.01'}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={checkForUpdates}
                                                disabled={updateLoading}
                                                className="flex items-center gap-2 px-4 py-2 bg-proxmox-orange hover:bg-orange-600 disabled:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
                                            >
                                                {updateLoading ? (
                                                    <Icons.Loader className="animate-spin" />
                                                ) : (
                                                    <Icons.RefreshCw />
                                                )}
                                                Check for Updates
                                            </button>
                                        </div>
                                    </div>

                                    {/* 931-recent-items-for-update-rollout: quick re-run of previous rollout actions */}
                                    <UpdateRolloutRecentItems
                                        items={updateRecentItems}
                                        onSelect={handleUpdateRolloutRecentItemClick}
                                        onClear={clearUpdateRolloutRecentItems}
                                    />

                                    {/* 932-undo-action-for-update-rollout: one-click reverse of last rollout action */}
                                    <UpdateRolloutUndo
                                        last={updateRolloutUndo}
                                        onUndo={handleUpdateRolloutUndo}
                                    />

                                    {/* Error */}
                                    {updateError && (
                                        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-3">
                                            <Icons.AlertTriangle className="text-red-400" />
                                            <span className="text-red-400">{updateError}</span>
                                        </div>
                                    )}

                                    {/* Update Available */}
                                    {updateInfo?.update_available && (
                                        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-6">
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <h3 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "text-lg font-semibold text-green-400 flex items-center gap-2"}>
                                                        <Icons.Download />
                                                        {t('updateAvailable')}
                                                    </h3>
                                                    <p className="text-2xl font-bold text-white mt-2">
                                                        Version {updateInfo.latest_version}
                                                    </p>
                                                    <p className={isCorporate ? 'corp-help-text mt-1' : "text-sm text-gray-400 mt-1"}>
                                                        {t('released')}: {updateInfo.release_date || 'Unknown'}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={performUpdate}
                                                    disabled={updateLoading || updateProgress}
                                                    className="flex items-center gap-2 px-6 py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-600 rounded-lg font-medium transition-colors"
                                                >
                                                    {updateLoading ? (
                                                        <Icons.Loader className="animate-spin" />
                                                    ) : (
                                                        <Icons.Download />
                                                    )}
                                                    {t('installUpdate')}
                                                </button>
                                            </div>

                                            {/* Changelog */}
                                            {updateInfo.changelog && updateInfo.changelog.length > 0 && (
                                                <div className="mt-4 pt-4 border-t border-green-500/30">
                                                    <h4 className={isCorporate ? 'corp-card-header mb-2' : "text-sm font-medium text-gray-300 mb-2"}>{t('whatsNew') || "What's New"}:</h4>
                                                    <ul className="space-y-1">
                                                        {updateInfo.changelog.map((item, idx) => (
                                                            <li key={idx} className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400 flex items-start gap-2"}>
                                                                <span className="text-green-400 mt-1">•</span>
                                                                {item}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}

                                            {/* Breaking Changes */}
                                            {updateInfo.breaking_changes && updateInfo.breaking_changes.length > 0 && (
                                                <div className="mt-4 pt-4 border-t border-yellow-500/30 bg-yellow-500/5 rounded-lg p-3">
                                                    <h4 className={isCorporate ? 'corp-card-header mb-2 flex items-center gap-2' : "text-sm font-medium text-yellow-400 mb-2 flex items-center gap-2"}>
                                                        <Icons.AlertTriangle />
                                                        {t('breakingChanges')}:
                                                    </h4>
                                                    <ul className="space-y-1">
                                                        {updateInfo.breaking_changes.map((item, idx) => (
                                                            <li key={idx} className="text-sm text-yellow-300">{item}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Update Progress */}
                                    {updateProgress && (
                                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-6">
                                            <div className="flex items-center gap-4">
                                                <div className="relative">
                                                    <Icons.Loader className="w-8 h-8 text-blue-400 animate-spin" />
                                                </div>
                                                <div>
                                                    <h3 className={isCorporate ? 'corp-card-header' : "text-lg font-semibold text-blue-400"}>
                                                        {updateProgress.message}
                                                    </h3>
                                                </div>
                                            </div>
                                            <div className="mt-4 w-full bg-proxmox-dark rounded-full h-2 overflow-hidden">
                                                <div className="h-full bg-blue-500 animate-pulse" style={{ width: '100%' }} />
                                            </div>
                                            {updateFeed && updateFeed.length > 0 && (
                                                <div className={`mt-4 ${isCorporate ? 'corp-border' : 'border border-blue-500/20'} rounded-lg p-3 max-h-60 overflow-y-auto`} style={{ scrollbarWidth: 'thin' }}>
                                                    {updateFeed.map((entry, idx) => (
                                                        <div key={idx} className="font-mono text-xs mb-1 last:mb-0">
                                                            <span className="text-gray-500">{entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}</span>
                                                            {' '}
                                                            <span className={
                                                                entry.step === 'error' || entry.level === 'ERROR'
                                                                    ? 'text-red-400'
                                                                    : entry.level === 'WARNING'
                                                                        ? 'text-yellow-400'
                                                                        : 'text-gray-300'
                                                            }>
                                                                {entry.message}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            <p className={isCorporate ? 'corp-help-text mt-2' : "text-xs text-gray-500 mt-2"}>
                                                {t('doNotCloseWindow')}
                                            </p>
                                        </div>
                                    )}

                                    {/* No Update Available - only show if no error */}
                                    {updateInfo && !updateInfo.update_available && !updateInfo.error && (
                                        <div className={isCorporate ? 'corp-settings-card text-center' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-6 text-center"}>
                                            <Icons.CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
                                            <h3 className={isCorporate ? 'corp-card-header' : "text-lg font-semibold text-white"}>You're up to date!</h3>
                                            <p className={isCorporate ? 'corp-help-text mt-1' : "text-gray-400 mt-1"}>
                                                ProxmoxVEx {updateInfo.current_version} is the latest version.
                                            </p>
                                        </div>
                                    )}

                                    {/* Rollback Section - */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-6"}>
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "text-lg font-semibold text-white flex items-center gap-2"}>
                                                    <Icons.RotateCcw />
                                                    {t('rollback')}
                                                </h3>
                                                <p className={isCorporate ? 'corp-help-text mt-1' : "text-sm text-gray-400 mt-1"}>
                                                    {t('rollbackDesc')}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => { addUpdateRolloutRecentItem('backups', t('viewBackups')); loadBackups(); setUpdateRolloutFilter(''); setShowRollbackModal(true); }}
                                                disabled={updateLoading || updateProgress}
                                                className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
                                            >
                                                <Icons.RotateCcw />
                                                {t('viewBackups')}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Update Instructions */}
                                    {updateInfo?.instructions && (
                                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-6">
                                            <h3 className={isCorporate ? 'corp-card-header flex items-center gap-2 mb-4' : "text-lg font-semibold text-blue-400 flex items-center gap-2 mb-4"}>
                                                <Icons.FileText />
                                                Update Instructions
                                            </h3>
                                            <div className="bg-proxmox-dark rounded-lg p-4 font-mono text-sm">
                                                {updateInfo.instructions.map((line, idx) => (
                                                    <p key={idx} className={`${line.startsWith('#') ? 'text-gray-500' : 'text-gray-300'} ${line === '' ? 'h-4' : ''}`}>
                                                        {line || '\u00A0'}
                                                    </p>
                                                ))}
                                            </div>
                                            {updateInfo.backup_path && (
                                                <p className={isCorporate ? 'corp-help-text mt-3' : "text-sm text-gray-400 mt-3"}>
                                                    ✓ Backup created: <code className="text-green-400">{updateInfo.backup_path}</code>
                                                </p>
                                            )}
                                            {updateInfo.download_url && (
                                                <a
                                                    href={updateInfo.download_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={() => addUpdateRolloutRecentItem('github', t('openGitHubRelease'), { url: updateInfo.download_url })}
                                                    className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg text-sm font-medium transition-colors"
                                                >
                                                    <Icons.ExternalLink />
                                                    {t('openGitHubRelease')}
                                                </a>
                                            )}
                                        </div>
                                    )}

                                    {/* GitHub Link */}
                                    <div className="text-center text-sm text-gray-500">
                                        <a
                                            href="https://proxmoxvex.local"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="hover:text-proxmox-orange transition-colors inline-flex items-center gap-1"
                                        >
                                            <Icons.Github />
                                            View on GitHub
                                        </a>
                                    </div>

                                    {/* 930-context-menu-for-update-rollout: render context menu overlay */}
                                    {updateRolloutMenu && (
                                        <UpdateRolloutContextMenu
                                            items={updateRolloutMenu.items}
                                            x={updateRolloutMenu.x}
                                            y={updateRolloutMenu.y}
                                            onSelect={(item) => {
                                                handleUpdateRolloutMenuAction(item);
                                                setUpdateRolloutMenu(null);
                                            }}
                                            onClose={() => setUpdateRolloutMenu(null)}
                                        />
                                    )}
                                </div>
                            )}

                            {/* Support Tab - */}
                            {activeTab === 'support' && (
                                <div className="space-y-6">
                                    {/* Support Bundle */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-6"}>
                                        <h3 className={isCorporate ? 'corp-card-header mb-4 flex items-center gap-2' : "text-lg font-semibold text-white mb-4 flex items-center gap-2"}>
                                            <Icons.Package className="w-5 h-5 text-proxmox-orange" />
                                            {t('supportBundle')}
                                        </h3>
                                        <p className={isCorporate ? 'corp-help-text mb-4' : "text-gray-400 text-sm mb-4"}>
                                            {t('supportBundleDesc')}
                                        </p>
                                        <div className="bg-proxmox-darker rounded-lg p-4 mb-4">
                                            <h4 className={isCorporate ? 'corp-card-header mb-2' : "text-white font-medium mb-2"}>{t('bundleContents')}:</h4>
                                            <ul className={isCorporate ? 'corp-help-text space-y-1' : "text-sm text-gray-400 space-y-1"}>
                                                <li>• {t('bundleSystemInfo')}</li>
                                                <li>• {t('bundleClusterStatus')}</li>
                                                <li>• {t('bundleAuditLogs')}</li>
                                                <li>• {t('bundleAppLogs')}</li>
                                                <li>• {t('bundleDbSchema')}</li>
                                                <li>• {t('bundleServerSettings')}</li>
                                                <li>• {t('bundleUserList')}</li>
                                                <li>• {t('bundleRecentTasks')}</li>
                                                <li>• {t('bundleSseStats')}</li>
                                            </ul>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        addToast(t('generatingBundle'), 'info');
                                                        const response = await fetch(`${API_URL}/support-bundle`, {
                                                            method: 'GET',
                                                            credentials: 'include'
                                                        });
                                                        if (response.ok) {
                                                            const blob = await response.blob();
                                                            const url = window.URL.createObjectURL(blob);
                                                            const a = document.createElement('a');
                                                            const safeFilename = `ProxmoxVEx_support_${new Date().toISOString().slice(0, 10)}.zip`;
                                                            a.href = url;
                                                            a.download = safeFilename;
                                                            document.body.appendChild(a);
                                                            a.click();
                                                            window.URL.revokeObjectURL(url);
                                                            a.remove();
                                                            addToast(t('bundleDownloaded'), 'success');
                                                        } else {
                                                            // Try to parse JSON error, but handle text/HTML responses too
                                                            try {
                                                                const err = await response.json();
                                                                addToast(err.error || 'Failed to generate bundle', 'error');
                                                            } catch {
                                                                addToast(`Server error: ${response.status} ${response.statusText}`, 'error');
                                                            }
                                                        }
                                                    } catch (e) {
                                                        console.error('Support bundle error:', e);
                                                        addToast(t('bundleError'), 'error');
                                                    }
                                                }}
                                                className="flex items-center gap-2 px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium transition-colors"
                                            >
                                                <Icons.Download className="w-4 h-4" />
                                                {t('downloadBundle')}
                                            </button>
                                            <span className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>
                                                {t('bundleSize')}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Support Links */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-6"}>
                                        <h3 className={isCorporate ? 'corp-card-header mb-4 flex items-center gap-2' : "text-lg font-semibold text-white mb-4 flex items-center gap-2"}>
                                            <Icons.LifeBuoy className="w-5 h-5 text-blue-400" />
                                            {t('supportResources')}
                                        </h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <a
                                                href="https://proxmoxvex.local/support"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-3 p-4 bg-proxmox-darker rounded-lg hover:bg-proxmox-border/50 transition-colors"
                                            >
                                                <div className="w-10 h-10 rounded-lg bg-gray-500/20 flex items-center justify-center">
                                                    <Icons.Github className="w-5 h-5 text-gray-400" />
                                                </div>
                                                <div>
                                                    <h4 className={isCorporate ? 'corp-card-header' : "font-medium text-white"}>{t('reportIssue')}</h4>
                                                    <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>GitHub Issues</p>
                                                </div>
                                                <Icons.ExternalLink className="w-4 h-4 text-gray-500 ml-auto" />
                                            </a>
                                            {/* 2026-06-02 (#519 Thermal-spearhead): "Discussions" tile pointed at
                                                proxmoxvex.local/discussions, which 404'd because we never enabled the
                                                Discussions feature on the repo. Removed the tile entirely — "Report
                                                an Issue" already covers the Q&A use case and Nico answers there.
                                                If we ever turn Discussions on, restore from git history. */}
                                            <a
                                                href="https://proxmoxvex.local/docs"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-3 p-4 bg-proxmox-darker rounded-lg hover:bg-proxmox-border/50 transition-colors"
                                            >
                                                <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                                                    <Icons.Book className="w-5 h-5 text-green-400" />
                                                </div>
                                                <div>
                                                    <h4 className={isCorporate ? 'corp-card-header' : "font-medium text-white"}>{t('documentation')}</h4>
                                                    <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>Wiki & Guides</p>
                                                </div>
                                                <Icons.ExternalLink className="w-4 h-4 text-gray-500 ml-auto" />
                                            </a>
                                            <a
                                                href="https://proxmoxvex.local/releases"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-3 p-4 bg-proxmox-darker rounded-lg hover:bg-proxmox-border/50 transition-colors"
                                            >
                                                <div className="w-10 h-10 rounded-lg bg-proxmox-orange/20 flex items-center justify-center">
                                                    <Icons.Download className="w-5 h-5 text-proxmox-orange" />
                                                </div>
                                                <div>
                                                    <h4 className={isCorporate ? 'corp-card-header' : "font-medium text-white"}>{t('releases')}</h4>
                                                    <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>Download & Changelog</p>
                                                </div>
                                                <Icons.ExternalLink className="w-4 h-4 text-gray-500 ml-auto" />
                                            </a>
                                        </div>
                                    </div>

                                    {/* System Information */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-6"}>
                                        <h3 className={isCorporate ? 'corp-card-header mb-4 flex items-center gap-2' : "text-lg font-semibold text-white mb-4 flex items-center gap-2"}>
                                            <Icons.Info className="w-5 h-5 text-blue-400" />
                                            {t('quickSystemInfo')}
                                        </h3>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                            <div className="bg-proxmox-darker rounded-lg p-3">
                                                <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>{t('version')}</p>
                                                <p className="text-white font-medium">{ProxmoxVEx_VERSION}</p>
                                            </div>
                                            <div className="bg-proxmox-darker rounded-lg p-3">
                                                <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>{t('clusters5')}</p>
                                                <p className="text-white font-medium">{clusters?.length || 0}</p>
                                            </div>
                                            <div className="bg-proxmox-darker rounded-lg p-3">
                                                <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>{t('users')}</p>
                                                <p className="text-white font-medium">{users?.length || 0}</p>
                                            </div>
                                            <div className="bg-proxmox-darker rounded-lg p-3">
                                                <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>{t('browser')}</p>
                                                <p className="text-white font-medium truncate" title={navigator.userAgent}>
                                                    {navigator.userAgent.includes('Chrome') ? 'Chrome' :
                                                        navigator.userAgent.includes('Firefox') ? 'Firefox' :
                                                            navigator.userAgent.includes('Safari') ? 'Safari' :
                                                                navigator.userAgent.includes('Edge') ? 'Edge' : 'Other'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* About Tab - Styled this */}
                            {activeTab === 'about' && (
                                <div className="space-y-6">
                                    {/* Appearance / Theme */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-6"}>
                                        <h3 className={isCorporate ? 'corp-card-header mb-4' : "text-lg font-semibold text-white mb-4"}>
                                            {t('appearance')}
                                        </h3>
                                        <label className={isCorporate ? 'corp-help-text block mb-2' : "block text-sm text-gray-400 mb-2"}>
                                            {t('settings.theme.label')}
                                        </label>
                                        <div className="flex items-center gap-3">
                                            <select
                                                value={theme}
                                                onChange={e => saveTheme(e.target.value)}
                                                disabled={savingTheme}
                                                className={isCorporate ? 'corp-input w-48' : "w-48 px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm focus:border-proxmox-orange focus:outline-none"}
                                            >
                                                <option value="light">{t('settings.theme.light')}</option>
                                                <option value="dark">{t('settings.theme.dark')}</option>
                                                <option value="system">{t('settings.theme.system')}</option>
                                            </select>
                                            {savingTheme && <Icons.RotateCw className="w-4 h-4 animate-spin text-gray-400" />}
                                        </div>
                                    </div>

                                    {/* Version Info */}
                                    <div className={isCorporate ? 'corp-settings-card text-center' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-6 text-center"}>
                                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-4">
                                            <img src={getLogoSrc()} alt="ProxmoxVEx" className="w-20 h-20 object-contain" />
                                        </div>
                                        <h2 className="text-3xl font-bold text-white">ProxmoxVEx</h2>
                                        <p className="text-xl text-proxmox-orange mt-1">{ProxmoxVEx_VERSION}</p>
                                        <p className={isCorporate ? 'corp-help-text mt-2' : "text-sm text-gray-400 mt-2"}>Multi-Cluster Proxmox Management</p>
                                        <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>Build 2026.02 • © 2025-2026 ProxmoxVEx Team</p>
                                    </div>

                                    {/* Team */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-6"}>
                                        <h3 className={isCorporate ? 'corp-card-header mb-4 flex items-center gap-2' : "text-lg font-semibold text-white mb-4 flex items-center gap-2"}>
                                            <Icons.Users />
                                            {t('developmentTeam')}
                                        </h3>
                                        <div className="flex justify-center">
                                            <a
                                                href="https://proxmoxvex.local/team"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="bg-proxmox-darker rounded-lg p-4 text-center hover:bg-proxmox-hover transition-colors inline-block w-full max-w-xs"
                                            >
                                                <div className="w-12 h-12 rounded-full bg-proxmox-orange/20 flex items-center justify-center mx-auto mb-2">
                                                    <span className="text-proxmox-orange font-bold">A</span>
                                                </div>
                                                <h4 className={isCorporate ? 'corp-card-header' : "font-medium text-white"}>ArMaTeC</h4>
                                                <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>Lead Developer & Founder</p>
                                            </a>
                                        </div>
                                    </div>

                                    {/* Credits & Acknowledgments */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-6"}>
                                        <h3 className={isCorporate ? 'corp-card-header mb-4 flex items-center gap-2' : "text-lg font-semibold text-white mb-4 flex items-center gap-2"}>
                                            <Icons.Heart />
                                            {t('creditsAcknowledgments')}
                                        </h3>
                                        <div className="space-y-4">
                                            {/* Other Credits */}
                                            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center text-[11px]">
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>Proxmox VE</p>
                                                    <p className="text-white font-medium">API</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>React</p>
                                                    <p className="text-white font-medium">UI</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>React-DOM</p>
                                                    <p className="text-white font-medium">UI</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>Tailwind CSS</p>
                                                    <p className="text-white font-medium">Styling</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>noVNC</p>
                                                    <p className="text-white font-medium">Console</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>xterm.js</p>
                                                    <p className="text-white font-medium">Terminal</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>Flask</p>
                                                    <p className="text-white font-medium">API</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>Werkzeug</p>
                                                    <p className="text-white font-medium">WSGI</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>requests</p>
                                                    <p className="text-white font-medium">HTTP</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>urllib3</p>
                                                    <p className="text-white font-medium">HTTP</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>dnspython</p>
                                                    <p className="text-white font-medium">DNS</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>cryptography</p>
                                                    <p className="text-white font-medium">Crypto</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>pyopenssl</p>
                                                    <p className="text-white font-medium">Crypto</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>paramiko</p>
                                                    <p className="text-white font-medium">SSH</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>websockets</p>
                                                    <p className="text-white font-medium">WS</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>gevent</p>
                                                    <p className="text-white font-medium">Async</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>PyJWT</p>
                                                    <p className="text-white font-medium">JWT</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>ldap3</p>
                                                    <p className="text-white font-medium">LDAP</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>pyvmomi</p>
                                                    <p className="text-white font-medium">vSphere</p>
                                                </div>

                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>defusedxml</p>
                                                    <p className="text-white font-medium">XML</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>Pillow</p>
                                                    <p className="text-white font-medium">Images</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>fido2</p>
                                                    <p className="text-white font-medium">WebAuthn</p>
                                                </div>
                                                <div className="bg-proxmox-darker rounded-lg p-2">
                                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400"}>sqlcipher3</p>
                                                    <p className="text-white font-medium">DB</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Links */}
                                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-6"}>
                                        <h3 className={isCorporate ? 'corp-card-header mb-4 flex items-center gap-2' : "text-lg font-semibold text-white mb-4 flex items-center gap-2"}>
                                            <Icons.Link />
                                            {t('links')}
                                        </h3>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <a href="https://proxmoxvex.certrunnerx.com" target="_blank" rel="noopener noreferrer"
                                                className="flex items-center gap-2 p-3 bg-proxmox-darker rounded-lg hover:bg-proxmox-hover transition-colors">
                                                <Icons.Globe className="text-proxmox-orange" />
                                                <span className={isCorporate ? 'corp-help-text' : "text-sm text-gray-300"}>proxmoxvex.certrunnerx.com</span>
                                            </a>
                                            <a href="https://proxmoxvex.local" target="_blank" rel="noopener noreferrer"
                                                className="flex items-center gap-2 p-3 bg-proxmox-darker rounded-lg hover:bg-proxmox-hover transition-colors">
                                                <Icons.Github className="text-gray-400" />
                                                <span className={isCorporate ? 'corp-help-text' : "text-sm text-gray-300"}>GitHub</span>
                                            </a>
                                            <a href="https://docs.proxmoxvex.certrunnerx.com" target="_blank" rel="noopener noreferrer"
                                                className="flex items-center gap-2 p-3 bg-proxmox-darker rounded-lg hover:bg-proxmox-hover transition-colors">
                                                <Icons.Book className="text-blue-400" />
                                                <span className={isCorporate ? 'corp-help-text' : "text-sm text-gray-300"}>Documentation</span>
                                            </a>
                                        </div>
                                    </div>

                                    {/* License */}
                                    <div className="text-center text-sm text-gray-500 space-y-1">
                                        <p>ProxmoxVEx is open source software licensed under the AGPL-3.0 License.</p>
                                        <p>© 2025-2026 ProxmoxVEx Team</p>
                                    </div>
                                </div>
                            )}

                            {/* Licence / Tier Plugins Tab */}
                            {activeTab === 'licence' && (
                                <LicenceSettingsPage />
                            )}

                            {/* API Token Manager Tab */}
                            {activeTab === 'apiTokens' && (
                                <div className="h-full flex flex-col">
                                    <h3 className={isCorporate ? 'corp-card-header' : "text-lg font-semibold text-white mb-2"}>API Token Manager</h3>
                                    <iframe
                                        src="/api/plugins/api-token-manager/api/ui"
                                        className="flex-1 w-full rounded-lg border border-proxmox-border bg-proxmox-dark"
                                        title="API Token Manager"
                                        onLoad={e => { if (window.ProxmoxVExSyncPluginIframe) window.ProxmoxVExSyncPluginIframe(e.target); }}
                                    />
                                </div>
                            )}

                        </main>
                    </div>
                </div>
            </div>

            {/* Rollback Modal - */}
            {showRollbackModal && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80" onClick={() => setShowRollbackModal(false)}>
                    <div
                        className={isCorporate ? 'corp-settings-card w-full max-w-lg shadow-2xl overflow-hidden' : "w-full max-w-lg bg-proxmox-card border border-proxmox-border rounded-xl shadow-2xl overflow-hidden"}
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="p-4 border-b border-proxmox-border flex items-center justify-between">
                            <h3 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "text-lg font-semibold text-white flex items-center gap-2"}>
                                <Icons.RotateCcw className="text-yellow-400" />
                                {t('selectBackup')}
                            </h3>
                            <button onClick={() => setShowRollbackModal(false)} className="p-1 hover:bg-proxmox-dark rounded">
                                <Icons.X />
                            </button>
                        </div>
                        <div className="p-4 max-h-[400px] overflow-y-auto">
                            {/* 933-quick-filter-for-update-rollout: search the backup list by name */}
                            <UpdateRolloutQuickFilter
                                value={updateRolloutFilter}
                                onChange={setUpdateRolloutFilter}
                                placeholder={t('search', { defaultValue: 'Filter backups...' })}
                            />
                            {filteredBackups.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">
                                    <Icons.Archive className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                    <p>{t('noBackupsFound')}</p>
                                </div>
                            ) : (
                                <div className="space-y-2 mt-3">
                                    {filteredBackups.map((backup, idx) => (
                                        <div
                                            key={idx}
                                            className={isCorporate ? 'corp-settings-card hover:border-yellow-500/50 transition-colors' : "bg-proxmox-dark border border-proxmox-border rounded-lg p-4 hover:border-yellow-500/50 transition-colors"}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="font-medium text-white">{backup.name}</p>
                                                    <p className={isCorporate ? 'corp-help-text mt-1' : "text-xs text-gray-500 mt-1"}>
                                                        {t('created4')}: {new Date(backup.created).toLocaleString()}
                                                    </p>
                                                    <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>
                                                        {t('files')}: {backup.files?.join(', ') || 'unknown'}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => performRollback(backup.name)}
                                                    disabled={updateLoading}
                                                    className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
                                                >
                                                    {t('restore')}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-proxmox-border bg-proxmox-dark/50">
                            <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 text-center"}>
                                {t('rollbackWarning2')}
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// LicensePanelColorTheme: dark-mode color theme for the License Panel.
function LicensePanelColorTheme({ children, dark }) {
    return (
        <div className={dark ? 'dark bg-proxmox-dark text-proxmox-text' : 'bg-white text-gray-900'}>
            {children}
        </div>
    );
}

// LicensePanelCompactGrid: table density wrapper for the License Panel.
function LicensePanelCompactGrid({ children, compact }) {
    return (
        <div className={compact ? 'text-xs leading-tight' : 'text-sm leading-normal'}>
            {children}
        </div>
    );
}

// LicenseRenewalBulkSelection: bulk selection toolbar for the License Renewal view.
function LicenseRenewalBulkSelection({ items, selected, onToggle, onRenew }) {
    return (
        <div className="p-2 bg-proxmox-card border border-proxmox-border rounded-lg">
            <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-white">Bulk Selection</h4>
                <button onClick={onRenew} disabled={selected.length === 0} className="px-3 py-1 text-xs font-medium bg-proxmox-orange hover:bg-orange-600 disabled:bg-gray-600 rounded text-white transition-colors">Renew</button>
            </div>
            {items.map((item) => (
                <label key={item} className="flex items-center space-x-2 p-1 text-sm text-white cursor-pointer hover:bg-proxmox-hover rounded">
                    <input type="checkbox" checked={selected.includes(item)} onChange={() => onToggle(item)} className="form-checkbox" />
                    <span>{item}</span>
                </label>
            ))}
        </div>
    );
}

// LicenseRenewalStepWizard: step-by-step wizard for the License Renewal view.
function LicenseRenewalStepWizard({ steps, currentStep, onNext, onBack }) {
    return (
        <div className="p-4 bg-proxmox-card border border-proxmox-border rounded-lg">
            <div className="flex items-center space-x-2 mb-4">
                {steps.map((step, index) => (
                    <div key={step} className={`px-2 py-1 rounded text-xs font-medium ${index === currentStep ? 'bg-proxmox-orange text-white' : 'bg-proxmox-dark text-proxmox-textMuted'}`}>
                        {step}
                    </div>
                ))}
            </div>
            <div className="flex justify-between">
                <button onClick={onBack} disabled={currentStep === 0} className="px-3 py-1 text-sm bg-proxmox-dark hover:bg-proxmox-hover disabled:bg-gray-600 rounded text-white transition-colors">Back</button>
                <button onClick={onNext} disabled={currentStep === steps.length - 1} className="px-3 py-1 text-sm bg-proxmox-orange hover:bg-orange-600 disabled:bg-gray-600 rounded text-white transition-colors">Next</button>
            </div>
        </div>
    );
}

// LicenseRenewalContextMenu: context menu for the License Renewal view.
function LicenseRenewalContextMenu({ items, onSelect }) {
    return (
        <div className="absolute z-20 w-48 py-1 bg-proxmox-dark border border-proxmox-border rounded-lg shadow-lg">
            {items.map((item) => (
                <button key={item} onClick={() => onSelect(item)} className="w-full px-4 py-2 text-sm text-left text-white hover:bg-proxmox-hover">
                    {item}
                </button>
            ))}
        </div>
    );
}

// LicenseRenewalRecentItems: recent list for the License Renewal view.
function LicenseRenewalRecentItems({ items, onSelect }) {
    return (
        <div className="p-2 bg-proxmox-card border border-proxmox-border rounded-lg">
            <h4 className="text-sm font-medium text-white mb-2">Recent</h4>
            <ul className="space-y-1">
                {items.map((item) => (
                    <li key={item}>
                        <button onClick={() => onSelect(item)} className="w-full text-left text-xs text-proxmox-textMuted hover:text-white truncate">
                            {item}
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// LicenseRenewalUndoAction: undo action banner for the License Renewal view.
function LicenseRenewalUndoAction({ message, onUndo }) {
    return (
        <div className="flex items-center justify-between p-3 bg-yellow-500/20 border border-yellow-500/50 rounded-lg text-sm text-yellow-200">
            <span>{message}</span>
            <button onClick={onUndo} className="px-3 py-1 text-xs font-medium bg-yellow-600 hover:bg-yellow-700 rounded text-white">Undo</button>
        </div>
    );
}

// LicenseRenewalQuickFilter: quick filter input for the License Renewal view.
function LicenseRenewalQuickFilter({ value, onChange, placeholder }) {
    return (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-sm text-white focus:outline-none focus:border-proxmox-orange"
        />
    );
}

// LicenseRenewalOneClickApply: one-click action button for the License Renewal view.
function LicenseRenewalOneClickApply({ onClick, disabled }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 disabled:bg-gray-600 rounded-lg text-sm font-medium text-white transition-colors"
        >
            Apply
        </button>
    );
}

// LicenseRenewalSmartDefaults: smart default selector for the License Renewal view.
function LicenseRenewalSmartDefaults({ defaults, onApply }) {
    return (
        <div className="p-2 bg-proxmox-card border border-proxmox-border rounded-lg">
            <h4 className="text-sm font-medium text-white mb-2">Smart Defaults</h4>
            {defaults.map((def) => (
                <button key={def} onClick={() => onApply(def)} className="w-full text-left px-3 py-2 text-sm text-proxmox-textMuted hover:bg-proxmox-hover hover:text-white rounded">
                    {def}
                </button>
            ))}
        </div>
    );
}

// LicenseRenewalLivePreview: live preview panel for the License Renewal view.
function LicenseRenewalLivePreview({ children, config }) {
    return (
        <div className="p-4 bg-proxmox-card border border-proxmox-border rounded-lg">
            <h4 className="text-sm font-medium text-white mb-2">Live Preview</h4>
            <pre className="p-2 bg-proxmox-dark rounded text-xs text-proxmox-textMuted overflow-auto">
                {JSON.stringify(config, null, 2)}
            </pre>
            {children}
        </div>
    );
}

// LicenseRenewalCompareView: compare view panel for the License Renewal view.
function LicenseRenewalCompareView({ before, after }) {
    return (
        <div className="grid grid-cols-2 gap-2 p-2 bg-proxmox-card border border-proxmox-border rounded-lg">
            <div className="p-2 bg-proxmox-dark rounded">
                <h5 className="text-xs font-medium text-proxmox-textMuted mb-1">Before</h5>
                <pre className="text-xs text-white overflow-auto">{JSON.stringify(before, null, 2)}</pre>
            </div>
            <div className="p-2 bg-proxmox-dark rounded">
                <h5 className="text-xs font-medium text-proxmox-textMuted mb-1">After</h5>
                <pre className="text-xs text-white overflow-auto">{JSON.stringify(after, null, 2)}</pre>
            </div>
        </div>
    );
}

// UpdateRolloutStepWizard: linear step indicator for the update rollout flow.
// 851-step-by-step-wizard-for-update-rollout: guides operators through the rollout process.
function UpdateRolloutStepWizard({ steps, currentStep, onNext, onBack, onFinish }) {
    const total = (steps || []).length;
    const canNext = currentStep < total - 1;
    const canBack = currentStep > 0;
    const canFinish = currentStep === total - 1;
    return (
        <div className="p-3 rounded border border-proxmox-border bg-proxmox-card" data-testid="update-rollout-step-wizard">
            <div className="flex items-center gap-2 mb-3">
                {(steps || []).map((s, i) => (
                    <div key={i} className={`text-xs px-2 py-1 rounded border ${i === currentStep ? 'bg-proxmox-orange text-white border-proxmox-orange' : i < currentStep ? 'bg-green-600 text-white border-green-600' : 'bg-proxmox-dark text-proxmox-textMuted border-proxmox-border'}`}>
                        {s.title}
                    </div>
                ))}
            </div>
            <div className="text-sm text-proxmox-text mb-3">Step {currentStep + 1} of {total}: {(steps[currentStep] || {}).title}</div>
            <div className="flex gap-2">
                {canBack && (
                    <button onClick={() => onBack && onBack()} className="px-3 py-1.5 text-xs rounded bg-proxmox-hover hover:bg-proxmox-active text-proxmox-text">
                        Back
                    </button>
                )}
                {canNext && (
                    <button onClick={() => onNext && onNext()} className="px-3 py-1.5 text-xs rounded bg-cyan-600 hover:bg-cyan-700 text-white">
                        Next
                    </button>
                )}
                {canFinish && (
                    <button onClick={() => onFinish && onFinish()} className="px-3 py-1.5 text-xs rounded bg-proxmox-orange hover:bg-orange-600 text-white">
                        Finish
                    </button>
                )}
            </div>
        </div>
    );
}

// UpdateRolloutBulkSelection: select and act on multiple update rollouts at once.
// 850-bulk-selection-for-update-rollout: lets operators select multiple rollouts in one step.
function UpdateRolloutBulkSelection({ items = [], selected = [], onChange, onUpdate }) {
    const allSelected = items.length > 0 && selected.length === items.length;
    const toggleAll = () => onChange && onChange(allSelected ? [] : items.map((i) => i.id));
    const toggleOne = (id) => {
        if (!onChange) return;
        onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    };

    return (
        <div className="p-3 rounded border border-proxmox-border bg-proxmox-card" data-testid="update-rollout-bulk-selection">
            <div className="flex items-center justify-between mb-2">
                <label className="flex items-center gap-2 text-xs">
                    <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        data-testid="update-rollout-select-all"
                    />
                    <span className="text-proxmox-textMuted">Select all</span>
                </label>
                {selected.length > 0 && (
                    <button
                        onClick={() => onUpdate?.(selected)}
                        className="px-2 py-1 text-[10px] rounded bg-proxmox-orange hover:bg-orange-600 text-white"
                    >
                        Update {selected.length}
                    </button>
                )}
            </div>
            <ul className="space-y-1">
                {(items || []).map((item) => (
                    <li key={item.id} className="flex items-center gap-2 text-xs">
                        <input
                            type="checkbox"
                            checked={selected.includes(item.id)}
                            onChange={() => toggleOne(item.id)}
                            data-testid={`update-rollout-select-${item.id}`}
                        />
                        <span className="text-proxmox-text">{item.name || item.id}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// UpdateRolloutContextMenu: context menu for update rollout actions.
// 930-context-menu-for-update-rollout: exposes rollout actions with a right-click menu.
function UpdateRolloutContextMenu({ items, x, y, onSelect, onClose }) {
    const { t } = useTranslation();
    return (
        <div className="fixed inset-0 z-50" onClick={onClose} data-testid="update-rollout-context-menu-overlay">
            <div
                className="absolute w-48 rounded border border-proxmox-border bg-proxmox-card shadow-xl py-1"
                style={{ top: y, left: x }}
                onClick={(e) => e.stopPropagation()}
                data-testid="update-rollout-context-menu"
            >
                {items.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => { onSelect && onSelect(item); onClose && onClose(); }}
                        disabled={!!item.disabled}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-proxmox-hover ${item.disabled ? 'text-gray-500 cursor-not-allowed' : 'text-white'}`}
                    >
                        {item.label}
                    </button>
                ))}
                <div className="border-t border-proxmox-border my-1" />
                <button
                    onClick={onClose}
                    className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-proxmox-hover"
                >
                    {t('cancel')}
                </button>
            </div>
        </div>
    );
}

// UpdateRolloutRecentItems: recent items list for the Update Rollout view.
// 931-recent-items-for-update-rollout: lets operators quickly re-run previous rollout actions.
function UpdateRolloutRecentItems({ items = [], onSelect, onClear }) {
    const { t } = useTranslation();
    return (
        <div className="p-3 rounded border border-proxmox-border bg-proxmox-card" data-testid="update-rollout-recent-items">
            <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-white">{t('recentItems')}</h4>
                {items.length > 0 && (
                    <button
                        onClick={onClear}
                        className="text-xs text-proxmox-orange hover:underline"
                        data-testid="update-rollout-clear-recent"
                    >
                        {t('clear')}
                    </button>
                )}
            </div>
            {items.length === 0 ? (
                <p className="text-sm text-proxmox-textMuted">{t('noRecentItems')}</p>
            ) : (
                <ul className="space-y-1">
                    {items.map((item, idx) => (
                        <li key={item.id || `${item.type || 'item'}-${idx}`}>
                            <button
                                onClick={() => onSelect && onSelect(item)}
                                className="w-full text-left px-2 py-1 text-xs text-proxmox-textMuted hover:text-white hover:bg-proxmox-hover rounded truncate"
                                data-testid={`update-rollout-recent-${item.type || idx}`}
                            >
                                {item.label || item.type}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// 932-undo-action-for-update-rollout: show an undo affordance for the last rollout action.
function UpdateRolloutUndo({ last, onUndo }) {
    const { t } = useTranslation();
    if (!last) return null;
    return (
        <div className="p-3 rounded border border-proxmox-border bg-proxmox-card flex items-center justify-between" data-testid="update-rollout-undo">
            <div className="text-sm text-proxmox-textMuted">
                {t('undoAction')}:
                <span className="ml-1 text-proxmox-orange font-medium">{last.label}</span>
                {last.version && <span className="ml-1 text-xs text-gray-500">({last.version})</span>}
            </div>
            <button
                onClick={() => onUndo && onUndo(last)}
                disabled={!last.canUndo}
                className="px-3 py-1.5 text-xs rounded bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white transition-colors"
                data-testid="update-rollout-undo-button"
            >
                {t('undo')}
            </button>
        </div>
    );
}

// 933-quick-filter-for-update-rollout: text input for narrowing the rollback backup list.
function UpdateRolloutQuickFilter({ value, onChange, placeholder }) {
    const { t } = useTranslation();
    return (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange && onChange(e.target.value)}
            placeholder={placeholder || t('search', { defaultValue: 'Search...' })}
            className="w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-sm text-white focus:outline-none focus:border-proxmox-orange"
            data-testid="update-rollout-quick-filter"
        />
    );
}

// AcmeCertificateBulkSelection: select and act on multiple ACME certificates at once.
function AcmeCertificateBulkSelection({ certificates = [], selected = [], onChange, onRenew, onDelete }) {
    const allSelected = certificates.length > 0 && selected.length === certificates.length;
    const toggleAll = () => onChange && onChange(allSelected ? [] : certificates.map(c => c.id));
    const toggleOne = (id) => {
        if (!onChange) return;
        onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
    };

    return (
        <div className="p-3 rounded border border-proxmox-border bg-proxmox-card" data-testid="acme-certificate-bulk-selection">
            <div className="flex items-center justify-between mb-2">
                <label className="flex items-center gap-2 text-xs">
                    <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        data-testid="acme-certificate-select-all"
                    />
                    <span className="text-proxmox-textMuted">Select all</span>
                </label>
                {selected.length > 0 && (
                    <div className="flex gap-2">
                        <button
                            onClick={() => onRenew?.(selected)}
                            className="px-2 py-1 text-[10px] rounded bg-green-600 hover:bg-green-700 text-white"
                        >
                            Renew {selected.length}
                        </button>
                        <button
                            onClick={() => onDelete?.(selected)}
                            className="px-2 py-1 text-[10px] rounded bg-red-600 hover:bg-red-700 text-white"
                        >
                            Delete {selected.length}
                        </button>
                    </div>
                )}
            </div>
            <ul className="space-y-1">
                {(certificates || []).map(cert => (
                    <li key={cert.id} className="flex items-center gap-2 text-xs">
                        <input
                            type="checkbox"
                            checked={selected.includes(cert.id)}
                            onChange={() => toggleOne(cert.id)}
                            data-testid={`acme-certificate-select-${cert.id}`}
                        />
                        <span className="text-proxmox-text">{cert.name || cert.domain || cert.id}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// AcmeCertificateStepWizard: multi-step wizard for creating or editing an ACME certificate.
function AcmeCertificateStepWizard({ steps = [], onFinish }) {
    const [step, setStep] = React.useState(0);
    const canNext = step < steps.length - 1;
    const canBack = step > 0;
    const finish = () => onFinish && onFinish();
    return (
        <div className="p-3 rounded border border-proxmox-border bg-proxmox-card" data-testid="acme-certificate-step-wizard">
            <div className="text-xs text-proxmox-textMuted mb-2">Step {step + 1} of {steps.length}</div>
            <div className="mb-3">
                {steps[step] && steps[step].content}
            </div>
            <div className="flex gap-2">
                {canBack && (
                    <button
                        onClick={() => setStep(step - 1)}
                        className="px-3 py-1.5 text-xs rounded bg-proxmox-hover hover:bg-proxmox-active"
                    >
                        Back
                    </button>
                )}
                {canNext ? (
                    <button
                        onClick={() => setStep(step + 1)}
                        className="px-3 py-1.5 text-xs rounded bg-cyan-600 hover:bg-cyan-700 text-white"
                    >
                        Next
                    </button>
                ) : (
                    <button
                        onClick={finish}
                        className="px-3 py-1.5 text-xs rounded bg-green-600 hover:bg-green-700 text-white"
                    >
                        Finish
                    </button>
                )}
            </div>
        </div>
    );
}

// SettingsModalColorTheme: applies a light/dark color theme to the Settings Modal.
function SettingsModalColorTheme({ darkMode, children }) {
    return (
        <div className={`p-4 rounded border border-proxmox-border ${darkMode ? 'bg-proxmox-dark text-proxmox-text' : 'bg-white text-gray-900'}`} data-testid="settings-modal-color-theme">
            {children}
        </div>
    );
}

// SettingsModalCompactGrid: renders settings data in a dense, compact table.
function SettingsModalCompactGrid({ columns, rows }) {
    return (
        <div className="overflow-auto border border-proxmox-border rounded" data-testid="settings-modal-compact-grid">
            <table className="w-full text-xs">
                <thead className="bg-proxmox-hover text-proxmox-textMuted sticky top-0">
                    <tr>
                        {(columns || []).map((col) => (
                            <th key={col.key} className="text-left px-2 py-1 font-medium">{col.label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {(rows || []).map((row, idx) => (
                        <tr key={idx} className="border-t border-proxmox-border hover:bg-proxmox-hover">
                            {(columns || []).map((col) => (
                                <td key={col.key} className="px-2 py-1 whitespace-nowrap">{row[col.key]}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// AcmeCertificateContextMenu: right-click / action menu for ACME certificate rows.
function AcmeCertificateContextMenu({ items, onSelect }) {
    const [open, setOpen] = React.useState(false);
    return (
        <div className="relative inline-block" data-testid="acme-certificate-context-menu">
            <button
                className="px-2 py-1 text-xs border border-proxmox-border rounded bg-proxmox-card hover:bg-proxmox-hover"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
            >
                Actions
            </button>
            {open && (
                <div className="absolute right-0 mt-1 w-40 border border-proxmox-border rounded bg-proxmox-card shadow-lg z-10">
                    {(items || []).map((item) => (
                        <button
                            key={item.key}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-proxmox-hover ${item.destructive ? 'text-rose-500' : 'text-proxmox-text'}`}
                            onClick={() => { setOpen(false); onSelect?.(item); }}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// AcmeCertificateRecentList: shows recently used / recent ACME certificate items.
function AcmeCertificateRecentList({ items, onSelect }) {
    return (
        <div className="p-2 border border-proxmox-border rounded bg-proxmox-card" data-testid="acme-certificate-recent-list">
            <div className="text-xs font-medium mb-2 text-proxmox-textMuted">Recent Items</div>
            {(items || []).map((item) => (
                <button
                    key={item.id}
                    className="w-full text-left text-sm px-2 py-1 hover:bg-proxmox-hover rounded"
                    onClick={() => onSelect?.(item)}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}

// AcmeCertificateUndoAction: displays an undo prompt for the last destructive ACME certificate action.
function AcmeCertificateUndoAction({ lastAction, onUndo, onDismiss }) {
    if (!lastAction) return null;
    return (
        <div className="flex items-center gap-2 p-2 border border-proxmox-border rounded bg-proxmox-card" data-testid="acme-certificate-undo-action">
            <span className="text-sm">{lastAction.label}</span>
            <button
                className="px-2 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-700 text-white"
                onClick={onUndo}
            >
                Undo
            </button>
            <button
                className="px-2 py-1 text-xs rounded border border-proxmox-border hover:bg-proxmox-hover"
                onClick={onDismiss}
            >
                Dismiss
            </button>
        </div>
    );
}

// AcmeCertificateQuickFilter: a compact search/filter input for ACME certificate lists.
function AcmeCertificateQuickFilter({ value, onChange, placeholder }) {
    return (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder={placeholder || "Filter certificates..."}
            className="w-full px-3 py-2 text-sm border border-proxmox-border rounded bg-proxmox-card text-proxmox-text placeholder-proxmox-textMuted focus:outline-none focus:border-cyan-600"
            data-testid="acme-certificate-quick-filter"
        />
    );
}

// AcmeCertificateOneClickApply: button to immediately apply the selected ACME certificate.
function AcmeCertificateOneClickApply({ onApply, disabled }) {
    return (
        <button
            className={`px-3 py-2 text-sm rounded ${disabled ? 'bg-gray-600 cursor-not-allowed' : 'bg-cyan-600 hover:bg-cyan-700'} text-white`}
            onClick={onApply}
            disabled={disabled}
            data-testid="acme-certificate-one-click-apply"
        >
            Apply Certificate
        </button>
    );
}

// AcmeCertificateSmartDefaults: suggests and applies sensible default ACME certificate settings.
function AcmeCertificateSmartDefaults({ defaults, onApply }) {
    return (
        <div className="p-3 border border-proxmox-border rounded bg-proxmox-card" data-testid="acme-certificate-smart-defaults">
            <div className="text-xs font-medium mb-2 text-proxmox-textMuted">Smart Defaults</div>
            <ul className="text-sm space-y-1 mb-2">
                {(defaults || []).map((d) => (
                    <li key={d.key} className="text-proxmox-text">{d.label}: <span className="text-cyan-400">{d.value}</span></li>
                ))}
            </ul>
            <button
                className="px-3 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-700 text-white"
                onClick={() => onApply?.(defaults)}
            >
                Apply Defaults
            </button>
        </div>
    );
}

// AcmeCertificateLivePreview: renders a live preview of the ACME certificate configuration before applying.
function AcmeCertificateLivePreview({ config }) {
    if (!config) return null;
    return (
        <div className="p-3 border border-proxmox-border rounded bg-proxmox-card" data-testid="acme-certificate-live-preview">
            <div className="text-xs font-medium mb-2 text-proxmox-textMuted">Live Preview</div>
            <div className="text-sm text-proxmox-text space-y-1">
                <div><span className="text-proxmox-textMuted">Domain:</span> {config.domain || '-'}</div>
                <div><span className="text-proxmox-textMuted">Account:</span> {config.account || '-'}</div>
                <div><span className="text-proxmox-textMuted">Plugin:</span> {config.plugin || '-'}</div>
            </div>
        </div>
    );
}

// AcmeCertificateCompareView: side-by-side comparison of two ACME certificate configurations.
function AcmeCertificateCompareView({ left, right }) {
    const fields = ['domain', 'account', 'plugin'];
    return (
        <div className="grid grid-cols-2 gap-2 p-3 border border-proxmox-border rounded bg-proxmox-card" data-testid="acme-certificate-compare-view">
            <div className="text-xs font-medium text-proxmox-textMuted">Current</div>
            <div className="text-xs font-medium text-proxmox-textMuted">Proposed</div>
            {fields.map((field) => (
                <React.Fragment key={field}>
                    <div className="text-sm text-proxmox-text">{left?.[field] || '-'}</div>
                    <div className={`text-sm ${right?.[field] !== left?.[field] ? 'text-cyan-400' : 'text-proxmox-text'}`}>{right?.[field] || '-'}</div>
                </React.Fragment>
            ))}
        </div>
    );
}

// UpdateRolloutSmartDefaults: pick sensible defaults when scheduling an update rollout.
function UpdateRolloutSmartDefaults({ selectedNodes = [], smartDefaults = {}, onApply }) {
    const { t } = useTranslation();
    return (
        <div className="p-3 rounded border border-proxmox-border bg-proxmox-card" data-testid="update-rollout-smart-defaults">
            <p className="text-sm text-proxmox-textMuted mb-2">{t('smartDefaults')}</p>
            <button onClick={() => onApply && onApply(smartDefaults)} className="px-3 py-1 bg-proxmox-orange rounded text-sm text-white">
                {t('apply')}
            </button>
        </div>
    );
}
