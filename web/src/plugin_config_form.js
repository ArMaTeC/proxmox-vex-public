/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        web/src/plugin_config_form.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Plugin Config Form JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
function _prettyJson(obj) { return JSON.stringify(obj, null, 4); }

function _inputBaseClasses(isCorporate) {
    return isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm focus:outline-none focus:border-proxmox-orange";
}

function _cardClasses(isCorporate) {
    return isCorporate ? 'corp-settings-card' : "bg-proxmox-darker border border-proxmox-border rounded-lg";
}

function _smallBtnClasses() {
    return "px-2 py-1 text-xs bg-proxmox-border hover:bg-gray-600 rounded text-white";
}

function _smallDangerBtnClasses() {
    return "px-2 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded";
}

function _typeLabel(t) {
    return <span className="text-[10px] text-gray-500 uppercase">{t}</span>;
}

function _guessLabel(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Detect plugin config fields that should be populated from the main app.
// Cluster ID fields may be named cluster_id, clusterId, cluster, etc.
// VMID fields may be named vmid, vm_id, vmId, vm, etc.
const _clusterKeyPattern = /^(cluster[_-]?id|cluster)$/i;
const _vmKeyPattern = /^(vm[_-]?id|vm)$/i;

function _findClusterId(obj) {
    if (!obj || typeof obj !== 'object') return null;
    for (const k of Object.keys(obj)) {
        if (_clusterKeyPattern.test(k) && obj[k]) return obj[k];
    }
    return null;
}

function ClusterSelect({ value, onChange, isCorporate }) {
    const { getAuthHeaders } = useAuth();
    const [clusters, setClusters] = React.useState([]);
    const [loading, setLoading] = React.useState(false);

    React.useEffect(() => {
        let mounted = true;
        setLoading(true);
        fetch(`${API_URL}/clusters`, { credentials: 'include', headers: getAuthHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(data => { if (mounted) setClusters(Array.isArray(data) ? data : []); })
            .catch(() => { })
            .finally(() => { if (mounted) setLoading(false); });
        return () => { mounted = false; };
    }, [getAuthHeaders]);

    return (
        <select
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            className={_inputBaseClasses(isCorporate)}
        >
            <option value="">{loading ? 'Loading clusters…' : 'Select a cluster'}</option>
            {clusters.map(c => (
                <option key={c.id} value={c.id}>{c.display_name || c.name || c.id}</option>
            ))}
        </select>
    );
}

function VmSelect({ value, onChange, clusterId, isCorporate }) {
    const { getAuthHeaders } = useAuth();
    const [vms, setVms] = React.useState([]);
    const [loading, setLoading] = React.useState(false);

    React.useEffect(() => {
        if (!clusterId) { setVms([]); return; }
        let mounted = true;
        setLoading(true);
        fetch(`${API_URL}/clusters/${encodeURIComponent(clusterId)}/vms`, { credentials: 'include', headers: getAuthHeaders() })
            .then(r => r.ok ? r.json() : { vms: [] })
            .then(data => { if (mounted) setVms((data && data.vms) || []); })
            .catch(() => { })
            .finally(() => { if (mounted) setLoading(false); });
        return () => { mounted = false; };
    }, [clusterId, getAuthHeaders]);

    const current = value == null ? '' : String(value);
    return (
        <select
            value={current}
            onChange={e => onChange(e.target.value === '' ? '' : (typeof value === 'number' ? Number(e.target.value) : e.target.value))}
            className={_inputBaseClasses(isCorporate)}
        >
            <option value="">{loading ? 'Loading VMs…' : 'Select a VM'}</option>
            {vms.map(v => (
                <option key={v.vmid} value={String(v.vmid)}>{v.vmid} — {v.name} ({v.node})</option>
            ))}
        </select>
    );
}

function ConfigNode({ name, value, onChange, isCorporate, depth, parentValue }) {
    const t = typeof value;
    const d = (depth || 0);
    const isDark = !isCorporate;

    if (t === 'string') {
        if (_clusterKeyPattern.test(name || '')) {
            return <div className="flex-1"><ClusterSelect value={value} onChange={onChange} isCorporate={isCorporate} /></div>;
        }
        if (_vmKeyPattern.test(name || '')) {
            const clusterId = _findClusterId(parentValue);
            if (clusterId) {
                return <div className="flex-1"><VmSelect value={value} onChange={onChange} clusterId={clusterId} isCorporate={isCorporate} /></div>;
            }
        }
        return (
            <div className="flex-1">
                <input
                    type="text"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    className={_inputBaseClasses(isCorporate)}
                    placeholder={_guessLabel(name || '')}
                />
            </div>
        );
    }

    if (t === 'number') {
        if (_vmKeyPattern.test(name || '')) {
            const clusterId = _findClusterId(parentValue);
            if (clusterId) {
                return <div className="flex-1"><VmSelect value={value} onChange={onChange} clusterId={clusterId} isCorporate={isCorporate} /></div>;
            }
        }
        return (
            <div className="flex-1">
                <input
                    type="number"
                    value={value}
                    onChange={e => {
                        const v = e.target.value;
                        onChange(v === '' ? '' : Number(v));
                    }}
                    className={_inputBaseClasses(isCorporate)}
                />
            </div>
        );
    }

    if (t === 'boolean') {
        return (
            <label className="flex items-center gap-2 cursor-pointer flex-1">
                <input
                    type="checkbox"
                    checked={value}
                    onChange={e => onChange(e.target.checked)}
                    className="rounded border-gray-600"
                />
                <span className="text-sm text-white">{value ? 'true' : 'false'}</span>
            </label>
        );
    }

    if (value === null) {
        return (
            <div className="flex items-center gap-2 flex-1">
                <span className="text-sm text-gray-500">null</span>
                <button onClick={() => onChange('')} className={_smallBtnClasses()}>Set to string</button>
            </div>
        );
    }

    if (Array.isArray(value)) {
        const allString = value.every(v => typeof v === 'string');
        const allNumber = value.every(v => typeof v === 'number');
        const allBool = value.every(v => typeof v === 'boolean');
        const simple = allString || allNumber || allBool;

        if (simple) {
            return (
                <div className={_cardClasses(isCorporate) + " p-2 space-y-2"}>
                    {value.map((item, i) => (
                        <div key={i} className="flex items-center gap-2">
                            {allString && (
                                <input
                                    type="text"
                                    value={item}
                                    onChange={e => {
                                        const next = [...value];
                                        next[i] = e.target.value;
                                        onChange(next);
                                    }}
                                    className={_inputBaseClasses(isCorporate)}
                                />
                            )}
                            {allNumber && (
                                <input
                                    type="number"
                                    value={item}
                                    onChange={e => {
                                        const next = [...value];
                                        next[i] = e.target.value === '' ? '' : Number(e.target.value);
                                        onChange(next);
                                    }}
                                    className={_inputBaseClasses(isCorporate)}
                                />
                            )}
                            {allBool && (
                                <input
                                    type="checkbox"
                                    checked={item}
                                    onChange={e => {
                                        const next = [...value];
                                        next[i] = e.target.checked;
                                        onChange(next);
                                    }}
                                    className="rounded border-gray-600"
                                />
                            )}
                            <button
                                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                                className={_smallDangerBtnClasses()}
                                title="Remove"
                            >×</button>
                        </div>
                    ))}
                    <button
                        onClick={() => {
                            const next = [...value];
                            if (allString) next.push('');
                            if (allNumber) next.push(0);
                            if (allBool) next.push(false);
                            onChange(next);
                        }}
                        className={_smallBtnClasses()}
                    >+ Add item</button>
                </div>
            );
        }

        // Fallback for complex / mixed arrays
        return (
            <textarea
                defaultValue={_prettyJson(value)}
                onBlur={e => {
                    try { onChange(JSON.parse(e.target.value)); }
                    catch (err) { }
                }}
                className={_inputBaseClasses(isCorporate) + " font-mono text-xs h-24"}
                spellCheck="false"
            />
        );
    }

    if (t === 'object') {
        return (
            <div className={(d > 0 ? 'ml-4 ' : '') + _cardClasses(isCorporate) + " p-2 space-y-2"}>
                <ConfigObject value={value} onChange={onChange} isCorporate={isCorporate} depth={d + 1} />
            </div>
        );
    }

    return <span className="text-sm text-gray-500">Unsupported type</span>;
}

function ConfigObject({ value, onChange, isCorporate, depth }) {
    const keys = Object.keys(value);
    const [newKey, setNewKey] = React.useState('');
    const [newType, setNewType] = React.useState('string');

    const addValue = () => {
        let v;
        if (newType === 'string') v = '';
        else if (newType === 'number') v = 0;
        else if (newType === 'boolean') v = false;
        else if (newType === 'object') v = {};
        else if (newType === 'array') v = [];
        const k = newKey.trim() || 'new_field';
        onChange({ ...value, [k]: v });
        setNewKey('');
    };

    const renameKey = (oldKey, newKeyName) => {
        if (oldKey === newKeyName) return;
        const next = {};
        Object.keys(value).forEach(k => {
            next[k === oldKey ? newKeyName : k] = value[k];
        });
        onChange(next);
    };

    return (
        <div className="space-y-2">
            {keys.map(k => (
                <div key={k} className="space-y-1">
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={k}
                            onChange={e => renameKey(k, e.target.value)}
                            className={(isCorporate ? 'corp-input ' : '') + "px-2 py-1 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm font-medium w-48"}
                        />
                        <button
                            onClick={() => {
                                const next = { ...value };
                                delete next[k];
                                onChange(next);
                            }}
                            className={_smallDangerBtnClasses()}
                            title="Remove field"
                        >Remove</button>
                    </div>
                    <ConfigNode name={k} value={value[k]} onChange={v => onChange({ ...value, [k]: v })} isCorporate={isCorporate} depth={depth} parentValue={value} />
                </div>
            ))}
            <div className="flex items-center gap-2 pt-2 border-t border-proxmox-border/50">
                <input
                    type="text"
                    value={newKey}
                    onChange={e => setNewKey(e.target.value)}
                    placeholder="new field name"
                    className={_inputBaseClasses(isCorporate) + " w-48"}
                />
                <select
                    value={newType}
                    onChange={e => setNewType(e.target.value)}
                    className={_inputBaseClasses(isCorporate) + " w-32"}
                >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="array">Array</option>
                    <option value="object">Object</option>
                </select>
                <button onClick={addValue} className={_smallBtnClasses()}>+ Add field</button>
            </div>
        </div>
    );
}

function PluginConfigForm({ config, onChange, isCorporate }) {
    const [useRaw, setUseRaw] = React.useState(false);
    const [raw, setRaw] = React.useState(config);
    const [parsed, setParsed] = React.useState(null);
    const [valid, setValid] = React.useState(true);

    React.useEffect(() => {
        setRaw(config);
        try {
            const p = JSON.parse(config);
            setParsed(p);
            setValid(true);
        } catch (e) {
            setParsed(null);
            setValid(false);
        }
    }, [config]);

    const isObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);

    const onObjectChange = (obj) => {
        setParsed(obj);
        const s = _prettyJson(obj);
        setRaw(s);
        onChange(s);
    };

    const onRawChange = (text) => {
        setRaw(text);
        onChange(text);
        try { setParsed(JSON.parse(text)); setValid(true); }
        catch (e) { setValid(false); }
    };

    if (!valid) {
        return (
            <div className="space-y-2">
                <p className="text-sm text-red-400">Invalid JSON. Edit raw JSON to fix the syntax.</p>
                <textarea
                    value={raw}
                    onChange={e => onRawChange(e.target.value)}
                    className={_inputBaseClasses(isCorporate) + " font-mono text-sm h-[50vh]"}
                    spellCheck="false"
                />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col" style={{ minHeight: '40vh' }}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex gap-2">
                    <button
                        onClick={() => setUseRaw(false)}
                        className={(!useRaw ? 'bg-proxmox-orange text-white ' : 'bg-proxmox-border text-gray-300 ') + "px-3 py-1 text-xs rounded"}
                    >Form</button>
                    <button
                        onClick={() => setUseRaw(true)}
                        className={(useRaw ? 'bg-proxmox-orange text-white ' : 'bg-proxmox-border text-gray-300 ') + "px-3 py-1 text-xs rounded"}
                    >Raw JSON</button>
                </div>
                <button
                    onClick={() => {
                        try { onRawChange(_prettyJson(JSON.parse(raw))); }
                        catch (e) { /* keep invalid */ }
                    }}
                    className={_smallBtnClasses()}
                >Format JSON</button>
            </div>
            <div className="flex-1 overflow-auto pr-2">
                {useRaw ? (
                    <textarea
                        value={raw}
                        onChange={e => onRawChange(e.target.value)}
                        className={_inputBaseClasses(isCorporate) + " font-mono text-sm h-full min-h-[40vh]"}
                        spellCheck="false"
                    />
                ) : isObject ? (
                    <ConfigObject value={parsed} onChange={onObjectChange} isCorporate={isCorporate} depth={0} />
                ) : (
                    <div className="space-y-2">
                        <p className="text-sm text-gray-400">The current config is not a JSON object. Use Raw JSON to edit it, or reset it to an empty object below.</p>
                        <button onClick={() => onObjectChange({})} className={_smallBtnClasses()}>Reset to empty object</button>
                        <textarea
                            value={raw}
                            onChange={e => onRawChange(e.target.value)}
                            className={_inputBaseClasses(isCorporate) + " font-mono text-sm h-64"}
                            spellCheck="false"
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

// PluginInstallBulkSelection: select multiple plugins at once for installation.
function PluginInstallBulkSelection({ plugins, selected, onToggle, onSelectAll }) {
    return (
        <div className="border border-proxmox-border rounded bg-proxmox-card p-3 text-sm">
            <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Select plugins</span>
                <button onClick={onSelectAll} className="text-xs text-cyan-500 hover:text-cyan-400">
                    Select all
                </button>
            </div>
            {plugins?.map((plugin) => (
                <label key={plugin.id} className="flex items-center gap-2 py-1 text-proxmox-text">
                    <input
                        type="checkbox"
                        checked={selected?.includes(plugin.id) || false}
                        onChange={() => onToggle?.(plugin.id)}
                        className="rounded border-proxmox-border"
                    />
                    {plugin.name}
                </label>
            )) || <div className="text-xs text-proxmox-textMuted">No plugins available.</div>}
        </div>
    );
}

// PluginInstallStepWizard: guided wizard for installing plugins.
function PluginInstallStepWizard({ step, steps, onNext, onBack, onFinish }) {
    return (
        <div className="border border-proxmox-border rounded bg-proxmox-card p-4 text-sm">
            <div className="font-medium mb-3">Step {step + 1} of {steps.length}: {steps[step]}</div>
            <div className="flex gap-2">
                {step > 0 && (
                    <button onClick={onBack} className="px-3 py-1.5 rounded bg-gray-600 hover:bg-gray-700 text-white">
                        Back
                    </button>
                )}
                {step < steps.length - 1 ? (
                    <button onClick={onNext} className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-700 text-white">
                        Next
                    </button>
                ) : (
                    <button onClick={onFinish} className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white">
                        Install
                    </button>
                )}
            </div>
        </div>
    );
}

// PluginStoreColorTheme: dark-mode color theme for the Plugin Store page.
function PluginStoreColorTheme({ children, dark }) {
    return (
        <div className={dark ? 'dark bg-proxmox-dark text-proxmox-text' : 'bg-white text-gray-900'}>
            {children}
        </div>
    );
}

// PluginStoreCompactGrid: table density wrapper for the Plugin Store page.
function PluginStoreCompactGrid({ children, compact }) {
    return (
        <div className={compact ? 'text-xs leading-tight' : 'text-sm leading-normal'}>
            {children}
        </div>
    );
}

// PluginStoreResizablePanels: resizable layout wrapper for the Plugin Store page.
function PluginStoreResizablePanels({ children, resizable }) {
    return (
        <div className={resizable ? 'w-1/3 overflow-auto resize-x' : 'w-full'}>
            {children}
        </div>
    );
}

// PluginStoreColorCodedStatus: status badge for the Plugin Store page.
function PluginStoreColorCodedStatus({ children, status }) {
    const colorClass = status === 'error' ? 'text-red-400' : status === 'success' ? 'text-green-400' : 'text-yellow-400';
    return (
        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${colorClass}`}>
            {children}
        </span>
    );
}

// PluginStoreHoverCards: hover card wrapper for the Plugin Store page.
function PluginStoreHoverCards({ children, hover }) {
    return (
        <div className={hover ? 'group relative p-3 bg-proxmox-card border border-proxmox-border rounded-lg shadow-lg' : 'p-3'}>
            {children}
            {hover && (
                <div className="absolute z-10 hidden group-hover:block p-2 mt-1 text-sm text-white bg-proxmox-dark border border-proxmox-border rounded-lg">
                    {children}
                </div>
            )}
        </div>
    );
}

// PluginStoreBreadcrumbBar: breadcrumb navigation for the Plugin Store page.
function PluginStoreBreadcrumbBar({ items }) {
    return (
        <nav className="flex items-center space-x-2 text-sm text-proxmox-textMuted py-2">
            {items.map((item, index) => (
                <React.Fragment key={index}>
                    <span className={index === items.length - 1 ? 'text-white font-medium' : 'hover:text-white'}>
                        {item}
                    </span>
                    {index < items.length - 1 && <span>/</span>}
                </React.Fragment>
            ))}
        </nav>
    );
}

// PluginStoreCustomizableColumns: column picker for the Plugin Store page.
function PluginStoreCustomizableColumns({ columns, visible, onToggle }) {
    return (
        <div className="p-2 bg-proxmox-card border border-proxmox-border rounded-lg">
            {columns.map((col) => (
                <label key={col} className="flex items-center space-x-2 p-1 text-sm text-white cursor-pointer hover:bg-proxmox-hover rounded">
                    <input type="checkbox" checked={visible.includes(col)} onChange={() => onToggle(col)} className="form-checkbox" />
                    <span>{col}</span>
                </label>
            ))}
        </div>
    );
}

// PluginStoreDragAndDrop: drag handle for reordering the Plugin Store page.
function PluginStoreDragAndDrop({ children, onDragEnd }) {
    return (
        <div className="cursor-move p-1 text-gray-400 hover:text-white" draggable onDragEnd={onDragEnd}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8h16M4 16h16" />
            </svg>
            {children}
        </div>
    );
}

// PluginStoreFilterSidebar: filter sidebar for the Plugin Store page.
function PluginStoreFilterSidebar({ filters, onChange }) {
    return (
        <aside className="w-64 p-4 bg-proxmox-card border-r border-proxmox-border">
            <h3 className="text-sm font-medium text-white mb-3">Filters</h3>
            {filters.map((filter) => (
                <div key={filter.key} className="mb-2">
                    <label className="text-xs text-proxmox-textMuted">{filter.label}</label>
                    <input type="text" value={filter.value} onChange={(e) => onChange(filter.key, e.target.value)} className="w-full mt-1 px-2 py-1 text-sm text-white bg-proxmox-dark border border-proxmox-border rounded" />
                </div>
            ))}
        </aside>
    );
}

// PluginStoreKeyboardShortcuts: keyboard shortcut hints for the Plugin Store page.
function PluginStoreKeyboardShortcuts({ shortcuts }) {
    return (
        <div className="p-2 bg-proxmox-card border border-proxmox-border rounded-lg text-sm text-white">
            <h4 className="font-medium mb-2">Keyboard Shortcuts</h4>
            <ul className="space-y-1">
                {shortcuts.map((shortcut) => (
                    <li key={shortcut.key} className="flex justify-between">
                        <span className="text-proxmox-textMuted">{shortcut.action}</span>
                        <kbd className="px-1 bg-proxmox-dark border border-proxmox-border rounded font-mono text-xs">{shortcut.key}</kbd>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// PluginInstallContextMenu: context menu for the Plugin Install view.
function PluginInstallContextMenu({ items, onSelect }) {
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

// PluginInstallRecentItems: recent list for the Plugin Install view.
function PluginInstallRecentItems({ items, onSelect }) {
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

// PluginInstallUndoAction: undo action banner for the Plugin Install view.
function PluginInstallUndoAction({ message, onUndo }) {
    return (
        <div className="flex items-center justify-between p-3 bg-yellow-500/20 border border-yellow-500/50 rounded-lg text-sm text-yellow-200">
            <span>{message}</span>
            <button onClick={onUndo} className="px-3 py-1 text-xs font-medium bg-yellow-600 hover:bg-yellow-700 rounded text-white">Undo</button>
        </div>
    );
}

// PluginInstallQuickFilter: quick filter input for the Plugin Install view.
function PluginInstallQuickFilter({ value, onChange, placeholder }) {
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

// PluginInstallOneClickApply: one-click action button for the Plugin Install view.
function PluginInstallOneClickApply({ onClick, disabled }) {
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

// PluginInstallSmartDefaults: smart default selector for the Plugin Install view.
function PluginInstallSmartDefaults({ defaults, onApply }) {
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

// PluginInstallLivePreview: live preview panel for the Plugin Install view.
function PluginInstallLivePreview({ children, config }) {
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

// PluginInstallCompareView: compare view panel for the Plugin Install view.
function PluginInstallCompareView({ before, after }) {
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
