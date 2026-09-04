/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        web/src/networking.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: FirewallRulesColorTheme: applies a light/dark theme to...
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
// FirewallRulesColorTheme: applies a light/dark theme to the Firewall Rules page.
// 830-dark-mode-for-firewall-rules: lets operators view firewall rules in their preferred theme.
function FirewallRulesColorTheme({ darkMode, children }) {
    return (
        <div className={`p-4 rounded border border-proxmox-border ${darkMode ? 'bg-proxmox-dark text-proxmox-text' : 'bg-white text-gray-900'}`} data-testid="firewall-rules-color-theme">
            {children}
        </div>
    );
}

// FirewallRulesCompactGrid: renders a dense table for firewall rules.
// 831-compact-grid-for-firewall-rules: reduces row padding and font size to fit more rules.
function FirewallRulesCompactGrid({ rows, columns }) {
    return (
        <table className="w-full text-left text-xs border border-proxmox-border" data-testid="firewall-rules-compact-grid">
            <thead className="bg-proxmox-dark border-b border-proxmox-border">
                <tr>
                    {(columns || []).map((col) => (
                        <th key={col.key} className="py-1 px-2 font-medium text-proxmox-text">{col.label}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {(rows || []).map((row, i) => (
                    <tr key={i} className="border-b border-proxmox-border last:border-b-0">
                        {(columns || []).map((col) => (
                            <td key={col.key} className="py-1 px-2 text-proxmox-textMuted">{row[col.key]}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function NetworkTab({ clusterId, addToast, initialNetwork }) {
    const { t } = useTranslation();
    const { getAuthHeaders, isAdmin } = useAuth();
    const { isCorporate } = useLayout();
    const [loading, setLoading] = useState(true);
    const [networks, setNetworks] = useState([]);
    const [selectedNetwork, setSelectedNetwork] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedBridges, setExpandedBridges] = useState({});

    const authFetch = async (url, opts = {}) => {
        try {
            return await fetch(url, { ...opts, credentials: 'include', headers: { ...opts.headers, ...getAuthHeaders() } });
        } catch { return null; }
    };

    // load networks for this cluster
    const fetchNetworks = async () => {
        setLoading(true);
        try {
            const resp = await authFetch(`${API_URL}/clusters/${clusterId}/networks`);
            if (resp && resp.ok) {
                const data = await resp.json();
                setNetworks(data.networks || []);
                // auto-select from sidebar click or pick first
                if (data.networks?.length > 0) {
                    const pick = initialNetwork && data.networks.find(n => n.name === initialNetwork)
                        ? initialNetwork : (selectedNetwork || data.networks[0].name);
                    setSelectedNetwork(pick);
                }
            } else {
                // endpoint returned error - show empty state
                setNetworks([]);
            }
        } catch (err) {
            console.error('fetch networks:', err);
            setNetworks([]);
        }
        setLoading(false);
    };

    useEffect(() => {
        if (clusterId) fetchNetworks();
        return () => { setNetworks([]); setSelectedNetwork(null); };
    }, [clusterId]);

    // sidebar click → jump to that network
    useEffect(() => {
        if (initialNetwork && networks.length > 0) {
            setSelectedNetwork(initialNetwork);
        }
    }, [initialNetwork]);

    const filteredNetworks = searchTerm
        ? networks.filter(n => n.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            n.comments?.toLowerCase().includes(searchTerm.toLowerCase()))
        : networks;

    const selected = networks.find(n => n.name === selectedNetwork);

    // Status dot for VM list
    const statusDot = (status) => {
        const color = status === 'running' ? '#60b515' : status === 'stopped' ? 'var(--corp-text-muted)' : '#efc006';
        return <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: color }} />;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Icons.RotateCw className="w-6 h-6 animate-spin" style={{ color: isCorporate ? 'var(--corp-accent)' : undefined }} />
                <span className="ml-3 text-gray-400">{t('loading')}...</span>
            </div>
        );
    }

    if (!networks.length) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                <Icons.Network className="w-10 h-10 mb-3 opacity-40" />
                <span>{t('noNetworkData')}</span>
            </div>
        );
    }

    // corporate layout - split pane
    if (isCorporate) {
        return (
            <div className="flex h-full" style={{ minHeight: '500px' }}>
                {/* Left panel - network list */}
                <div className="w-64 flex-shrink-0 border-r" style={{ borderColor: 'var(--corp-border-medium)', background: 'var(--corp-bar-track)' }}>
                    <div className="p-2 border-b" style={{ borderColor: 'var(--corp-border-medium)' }}>
                        <div className="relative">
                            <Icons.Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--corp-text-muted)' }} />
                            <input
                                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                                placeholder={t('search') + '...'}
                                className={isCorporate ? 'corp-input' : 'w-full pr-2 py-1 text-[13px] bg-transparent border rounded text-white placeholder-gray-500'}
                                style={{ paddingLeft: '28px', borderColor: 'var(--corp-border-medium)' }}
                            />
                        </div>
                    </div>
                    <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                        {filteredNetworks.map(net => {
                            const isActive = net.active;
                            const vmCount = net.vms?.length || 0;
                            const isSel = selectedNetwork === net.name;
                            return (
                                <div
                                    key={net.name}
                                    onClick={() => setSelectedNetwork(net.name)}
                                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[13px]"
                                    style={isSel
                                        ? { background: '#324f61', color: '#e9ecef' }
                                        : { color: isActive ? 'var(--corp-text-secondary)' : 'var(--corp-text-muted)' }}
                                    onMouseEnter={e => { if (!isSel) { e.currentTarget.style.background = '#29414e'; } }}
                                    onMouseLeave={e => { if (!isSel) { e.currentTarget.style.background = ''; } }}
                                >
                                    <Icons.Network className="w-4 h-4 flex-shrink-0" style={{ color: isActive ? 'var(--corp-accent)' : 'var(--corp-text-muted)' }} />
                                    <span className="flex-1 truncate">{net.name}</span>
                                    <span className="text-[11px]" style={{ color: 'var(--corp-text-muted)' }}>{vmCount}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Right panel - detail */}
                <div className="flex-1 overflow-y-auto">
                    {selected ? (
                        <div>
                            {/* Header */}
                            <div className="corp-content-header">
                                <div className="flex items-center gap-2">
                                    <Icons.Network className="w-4 h-4" style={{ color: 'var(--corp-accent)' }} />
                                    <span className="font-medium text-white">{selected.name}</span>
                                    {selected.type === 'OVSBridge' && (
                                        <span className="corp-badge-blue text-[10px] px-1.5 py-0.5 rounded">OVS</span>
                                    )}
                                </div>
                                <button onClick={fetchNetworks} className="p-1 rounded hover:bg-white/10" title={t('refreshData')}>
                                    <Icons.RotateCw className="w-3.5 h-3.5" style={{ color: 'var(--corp-text-muted)' }} />
                                </button>
                            </div>

                            {/* Properties */}
                            <div className="p-4 space-y-4">
                                <div className="corp-property-grid">
                                    <span style={{ color: 'var(--corp-text-muted)' }}>{t('type')}</span>
                                    <span className="text-white">{selected.type}</span>

                                    {selected.address && <>
                                        <span style={{ color: 'var(--corp-text-muted)' }}>IP</span>
                                        <span className="text-white">{selected.cidr || selected.address}</span>
                                    </>}

                                    {selected.gateway && <>
                                        <span style={{ color: 'var(--corp-text-muted)' }}>Gateway</span>
                                        <span className="text-white">{selected.gateway}</span>
                                    </>}

                                    {selected.bridge_ports && <>
                                        <span style={{ color: 'var(--corp-text-muted)' }}>{t('bridgePorts')}</span>
                                        <span className="text-white">{selected.bridge_ports}</span>
                                    </>}

                                    {selected.comments && <>
                                        <span style={{ color: 'var(--corp-text-muted)' }}>{t('description')}</span>
                                        <span className="text-white">{selected.comments}</span>
                                    </>}

                                    <span style={{ color: 'var(--corp-text-muted)' }}>{t('presentOnNodes')}</span>
                                    <span className="text-white">{selected.nodes?.join(', ') || '-'}</span>
                                </div>

                                {/* Connected VMs section */}
                                <div>
                                    <div className="corp-section-header" style={{ marginBottom: '8px' }}>
                                        {t('connectedVms')} ({selected.vms?.length || 0})
                                    </div>

                                    {selected.vms?.length > 0 ? (
                                        <div className="corp-datagrid">
                                            <table className="w-full text-[13px]">
                                                <thead>
                                                    <tr>
                                                        <th className="text-left py-1.5 px-3 font-medium" style={{ color: 'var(--corp-text-secondary)' }}>{t('status')}</th>
                                                        <th className="text-left py-1.5 px-3 font-medium" style={{ color: 'var(--corp-text-secondary)' }}>{t('name')}</th>
                                                        <th className="text-left py-1.5 px-3 font-medium" style={{ color: 'var(--corp-text-secondary)' }}>VMID</th>
                                                        <th className="text-left py-1.5 px-3 font-medium" style={{ color: 'var(--corp-text-secondary)' }}>{t('type')}</th>
                                                        <th className="text-left py-1.5 px-3 font-medium" style={{ color: 'var(--corp-text-secondary)' }}>{t('node')}</th>
                                                        <th className="text-left py-1.5 px-3 font-medium" style={{ color: 'var(--corp-text-secondary)' }}>Interface</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {selected.vms.map((vm, i) => (
                                                        <tr key={`${vm.vmid}-${vm.iface}-${i}`}
                                                            className="border-t"
                                                            style={{ borderColor: 'var(--corp-divider)' }}
                                                            onMouseEnter={e => e.currentTarget.style.background = 'var(--color-hover)'}
                                                            onMouseLeave={e => e.currentTarget.style.background = ''}
                                                        >
                                                            <td className="py-1.5 px-3 text-white">
                                                                {statusDot(vm.status)}
                                                                {vm.status}
                                                            </td>
                                                            <td className="py-1.5 px-3 text-white">{vm.name || '-'}</td>
                                                            <td className="py-1.5 px-3" style={{ color: 'var(--corp-text-secondary)' }}>{vm.vmid}</td>
                                                            <td className="py-1.5 px-3" style={{ color: 'var(--corp-text-secondary)' }}>
                                                                {vm.type === 'qemu' ? 'VM' : 'CT'}
                                                            </td>
                                                            <td className="py-1.5 px-3" style={{ color: 'var(--corp-text-secondary)' }}>{vm.node}</td>
                                                            <td className="py-1.5 px-3" style={{ color: 'var(--corp-text-muted)' }}>{vm.iface}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className="text-center py-6" style={{ color: 'var(--corp-text-muted)' }}>
                                            {t('noVmsOnBridge')}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            {t('networkOverview')}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // modern layout - simpler card-based view
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white flex items-center gap-2'}>
                    <Icons.Network className="w-5 h-5 text-proxmox-orange" />
                    {t('networkOverview')}
                </h3>
                <button onClick={fetchNetworks} className="p-2 rounded-lg bg-proxmox-dark hover:bg-proxmox-hover text-gray-400 hover:text-white transition-colors">
                    <Icons.RotateCw className="w-4 h-4" />
                </button>
            </div>

            <div className="grid gap-3">
                {filteredNetworks.map(net => {
                    const expanded = expandedBridges[net.name];
                    const vmCount = net.vms?.length || 0;
                    return (
                        <div key={net.name} className="bg-proxmox-dark rounded-lg border border-proxmox-border overflow-hidden">
                            <div
                                className="flex items-center justify-between p-3 cursor-pointer hover:bg-proxmox-hover transition-colors"
                                onClick={() => setExpandedBridges(prev => ({ ...prev, [net.name]: !prev[net.name] }))}
                            >
                                <div className="flex items-center gap-3">
                                    <Icons.Network className={`w-5 h-5 ${net.active ? 'text-blue-400' : 'text-gray-600'}`} />
                                    <div>
                                        <span className="font-medium text-white">{net.name}</span>
                                        {net.cidr && <span className="ml-2 text-sm text-gray-400">{net.cidr}</span>}
                                        {net.comments && <span className="ml-2 text-sm text-gray-500">— {net.comments}</span>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-sm text-gray-400">
                                        {vmCount} {vmCount === 1 ? 'VM' : 'VMs'}
                                    </span>
                                    <span className="text-xs text-gray-500">{net.nodes?.join(', ')}</span>
                                    <Icons.ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                                </div>
                            </div>

                            {expanded && (
                                <div className="border-t border-proxmox-border">
                                    {net.bridge_ports && (
                                        <div className="px-4 py-2 text-sm">
                                            <span className="text-gray-500">{t('bridgePorts')}:</span>
                                            <span className="ml-2 text-gray-300">{net.bridge_ports}</span>
                                        </div>
                                    )}
                                    {vmCount > 0 ? (
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-proxmox-border">
                                                    <th className="text-left px-4 py-2 text-gray-400 font-medium">{t('name')}</th>
                                                    <th className="text-left px-4 py-2 text-gray-400 font-medium">VMID</th>
                                                    <th className="text-left px-4 py-2 text-gray-400 font-medium">{t('status')}</th>
                                                    <th className="text-left px-4 py-2 text-gray-400 font-medium">{t('node')}</th>
                                                    <th className="text-left px-4 py-2 text-gray-400 font-medium">Interface</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {net.vms.map((vm, i) => (
                                                    <tr key={`${vm.vmid}-${vm.iface}-${i}`} className="border-b border-proxmox-border/50 hover:bg-proxmox-hover/50">
                                                        <td className="px-4 py-1.5 text-white">{vm.name || '-'}</td>
                                                        <td className="px-4 py-1.5 text-gray-300">{vm.vmid}</td>
                                                        <td className="px-4 py-1.5">
                                                            {statusDot(vm.status)}
                                                            <span className="text-gray-300">{vm.status}</span>
                                                        </td>
                                                        <td className="px-4 py-1.5 text-gray-400">{vm.node}</td>
                                                        <td className="px-4 py-1.5 text-gray-500">{vm.iface}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <div className="px-4 py-3 text-gray-500 text-sm">{t('noVmsOnBridge')}</div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function NetworkBulkSelection({ networks, selected, onToggle, onApply }) {
    const { t } = useTranslation();
    return (
        <div className="p-3 border rounded border-proxmox-border bg-proxmox-dark">
            <div className="font-medium text-[13px] mb-2" style={{ color: '#e9ecef' }}>{t('bulkSelect')} ({selected?.length || 0})</div>
            <div className="max-h-40 overflow-y-auto space-y-1 mb-3">
                {(networks || []).map(net => (
                    <label key={net.name} className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: 'var(--corp-text-secondary)' }}>
                        <input
                            type="checkbox"
                            checked={(selected || []).includes(net.name)}
                            onChange={() => onToggle && onToggle(net.name)}
                            className="form-checkbox"
                        />
                        <span>{net.name}</span>
                    </label>
                ))}
            </div>
            <button
                onClick={onApply}
                disabled={!selected?.length}
                className="px-3 py-1.5 text-[13px] rounded bg-proxmox-primary text-white hover:bg-proxmox-primary/90 disabled:opacity-40"
            >
                {t('applyBulk')}
            </button>
        </div>
    );
}

function NetworkStepWizard({ steps, currentStep, onNext, onBack, onFinish }) {
    const { t } = useTranslation();
    const total = (steps || []).length;
    const step = steps?.[currentStep] || { title: t('step'), content: null };
    return (
        <div className="p-4 border rounded border-proxmox-border bg-proxmox-dark">
            <div className="flex items-center gap-2 mb-3 text-[13px]" style={{ color: 'var(--corp-text-muted)' }}>
                {t('step')} {currentStep + 1} {t('of')} {total}
            </div>
            <div className="font-medium text-[14px] mb-2" style={{ color: '#e9ecef' }}>{step.title}</div>
            <div className="mb-4">{step.content}</div>
            <div className="flex items-center gap-2">
                {currentStep > 0 && (
                    <button
                        onClick={onBack}
                        className="px-3 py-1.5 text-[13px] rounded border border-proxmox-border hover:bg-white/5"
                        style={{ color: 'var(--corp-text-secondary)' }}
                    >
                        {t('back')}
                    </button>
                )}
                {currentStep < total - 1 ? (
                    <button
                        onClick={onNext}
                        className="px-3 py-1.5 text-[13px] rounded bg-proxmox-primary text-white hover:bg-proxmox-primary/90"
                    >
                        {t('next')}
                    </button>
                ) : (
                    <button
                        onClick={onFinish}
                        className="px-3 py-1.5 text-[13px] rounded bg-proxmox-primary text-white hover:bg-proxmox-primary/90"
                    >
                        {t('finish')}
                    </button>
                )}
            </div>
        </div>
    );
}

function NetworkContextMenu({ items = [], onSelect }) {
    const { t } = useTranslation();
    return (
        <div className="py-1 rounded border border-proxmox-border bg-proxmox-dark shadow min-w-[160px]">
            {(items || []).map((item, idx) => (
                <button
                    key={idx}
                    onClick={() => onSelect && onSelect(item)}
                    className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-white/5"
                    style={{ color: 'var(--corp-text-secondary)' }}
                >
                    {item.label || item}
                </button>
            ))}
        </div>
    );
}

function NetworkUndo({ onUndo, disabled }) {
    const { t } = useTranslation();
    return (
        <button
            onClick={onUndo}
            disabled={disabled}
            className="px-3 py-1.5 text-[13px] rounded hover:bg-white/5 disabled:opacity-40 flex items-center gap-1"
            style={{ color: 'var(--corp-text-secondary)' }}
        >
            <Icons.RotateCcw className="w-4 h-4" />
            <span>{t('undo')}</span>
        </button>
    );
}

function NetworkCompareView({ options = [] }) {
    const { t } = useTranslation();
    return (
        <div className="mt-2 grid grid-cols-2 gap-2">
            {(options || []).map((opt, idx) => (
                <div key={idx} className="p-3 rounded border border-proxmox-border bg-proxmox-dark text-[13px]" style={{ color: 'var(--corp-text-secondary)' }}>
                    <div className="font-medium" style={{ color: '#e9ecef' }}>{opt.label || t('option') + ' ' + (idx + 1)}</div>
                    <pre className="text-[12px] whitespace-pre-wrap mt-1">{JSON.stringify(opt.value || {}, null, 2)}</pre>
                </div>
            ))}
        </div>
    );
}

function NetworkLivePreview({ config }) {
    const { t } = useTranslation();
    return (
        <div className="mt-2 p-3 rounded border border-proxmox-border bg-proxmox-dark text-[13px]" style={{ color: 'var(--corp-text-secondary)' }}>
            <div className="font-medium mb-1" style={{ color: '#e9ecef' }}>{t('livePreview')}</div>
            <pre className="text-[12px] whitespace-pre-wrap">{JSON.stringify(config || {}, null, 2)}</pre>
        </div>
    );
}

function NetworkSmartDefaults({ defaults, onApply }) {
    const { t } = useTranslation();
    return (
        <button
            onClick={() => onApply && onApply(defaults)}
            className="px-3 py-1.5 text-[13px] rounded border border-proxmox-border hover:bg-white/5"
            style={{ color: 'var(--corp-text-secondary)' }}
        >
            {t('smartDefaults')}
        </button>
    );
}

function NetworkOneClickApply({ onApply, disabled }) {
    const { t } = useTranslation();
    return (
        <button
            onClick={onApply}
            disabled={disabled}
            className="px-3 py-1.5 text-[13px] rounded bg-proxmox-primary text-white hover:bg-proxmox-primary/90 disabled:opacity-40"
        >
            {t('apply')}
        </button>
    );
}

function NetworkQuickFilter({ value, onChange, placeholder }) {
    const { t } = useTranslation();
    return (
        <input
            type="text"
            value={value || ''}
            onChange={(e) => onChange && onChange(e.target.value)}
            placeholder={placeholder || t('filterNetworks')}
            className="px-3 py-1.5 rounded bg-proxmox-dark border border-proxmox-border text-[13px] w-52"
            style={{ color: 'var(--corp-text-secondary)' }}
        />
    );
}

function NetworkRecentItems({ items = [], onSelect }) {
    const { t } = useTranslation();
    return (
        <div className="mt-2 p-3 border rounded border-proxmox-border bg-proxmox-dark">
            <div className="font-medium text-[13px] mb-2" style={{ color: '#e9ecef' }}>{t('recentItems')}</div>
            <div className="space-y-1">
                {(items || []).map((item, idx) => (
                    <button
                        key={idx}
                        onClick={() => onSelect && onSelect(item)}
                        className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-white/5"
                        style={{ color: 'var(--corp-text-secondary)' }}
                    >
                        {item.label || item}
                    </button>
                ))}
            </div>
        </div>
    );
}

// NetworkTopologyColorTheme: dark-mode aware wrapper for the Network Topology page.
function NetworkTopologyColorTheme({ children }) {
    const { isCorporate } = useLayout();
    return (
        <div className={`${isCorporate ? 'dark' : ''} bg-proxmox-dark text-proxmox-text min-h-full`}>
            {children}
        </div>
    );
}

// NetworkTopologyCompactGrid: compact grid density toggle for the Network Topology page.
function NetworkTopologyCompactGrid({ compact, onToggle, children }) {
    return (
        <div className={`${compact ? 'text-xs' : 'text-sm'}`}>
            <button
                onClick={onToggle}
                className="px-3 py-1.5 text-[13px] rounded hover:bg-white/5"
                style={{ color: 'var(--corp-text-secondary)' }}
            >
                {compact ? 'Expand' : 'Compact'}
            </button>
            {children}
        </div>
    );
}

// NetworkTopologyResizablePanels: resizable split-pane layout for the Network Topology page.
function NetworkTopologyResizablePanels({ left, right, defaultWidth = 256 }) {
    const [panelWidth, setPanelWidth] = useState(defaultWidth);
    const [dragging, setDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [startWidth, setStartWidth] = useState(defaultWidth);

    const onMouseDown = (e) => {
        setDragging(true);
        setStartX(e.clientX);
        setStartWidth(panelWidth);
    };

    useEffect(() => {
        if (!dragging) return;
        const onMouseMove = (e) => {
            const delta = e.clientX - startX;
            const newWidth = Math.max(180, startWidth + delta);
            setPanelWidth(newWidth);
        };
        const onMouseUp = () => setDragging(false);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [dragging, startX, startWidth]);

    return (
        <div className="flex h-full">
            <div className="flex-shrink-0 overflow-hidden" style={{ width: panelWidth + 'px' }}>
                {left}
            </div>
            <div
                className="w-2 cursor-col-resize bg-proxmox-border hover:bg-proxmox-orange"
                onMouseDown={onMouseDown}
            />
            <div className="flex-1 overflow-hidden">
                {right}
            </div>
        </div>
    );
}

// NetworkTopologyColorCodedStatus: status badge with color-coding for network states.
function NetworkTopologyColorCodedStatus({ status }) {
    const colors = {
        running: 'bg-green-500 text-white',
        stopped: 'bg-gray-500 text-white',
        warning: 'bg-yellow-500 text-black',
        error: 'bg-red-500 text-white'
    };
    const cls = colors[status] || 'bg-gray-400 text-white';
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
            {status || 'unknown'}
        </span>
    );
}

// NetworkTopologyHoverCard: hover card showing extra details for a network item.
function NetworkTopologyHoverCard({ title, children }) {
    const [show, setShow] = useState(false);
    return (
        <div
            className="relative inline-block"
            onMouseEnter={() => setShow(true)}
            onMouseLeave={() => setShow(false)}
        >
            {children}
            {show && (
                <div className="absolute z-50 w-64 p-3 rounded border border-proxmox-border bg-proxmox-dark shadow-lg text-[12px]" style={{ color: 'var(--corp-text-secondary)', bottom: '100%', left: '50%', transform: 'translateX(-50%)' }}>
                    {title && <div className="font-medium mb-1 text-white">{title}</div>}
                    <div className="text-gray-400">{children}</div>
                </div>
            )}
        </div>
    );
}

// NetworkTopologyBreadcrumb: breadcrumb navigation for the Network Topology page.
function NetworkTopologyBreadcrumb({ items, onSelect }) {
    return (
        <nav className="flex items-center text-[13px] text-gray-400 space-x-2">
            {(items || []).map((item, idx) => (
                <span key={item.id || idx} className="flex items-center">
                    {idx > 0 && <span className="mx-2 text-gray-600">/</span>}
                    <button
                        onClick={() => onSelect && onSelect(item)}
                        className="hover:text-white hover:underline"
                    >
                        {item.label}
                    </button>
                </span>
            ))}
        </nav>
    );
}

// NetworkTopologyColumnPicker: toggle visibility of individual data columns.
function NetworkTopologyColumnPicker({ columns, visible, onToggle }) {
    return (
        <div className="p-3 border rounded border-proxmox-border bg-proxmox-dark w-56">
            <div className="font-medium text-[13px] mb-2" style={{ color: '#e9ecef' }}>Columns</div>
            <div className="space-y-1">
                {(columns || []).map(col => (
                    <label key={col.key} className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: 'var(--corp-text-secondary)' }}>
                        <input
                            type="checkbox"
                            checked={visible?.includes(col.key)}
                            onChange={() => onToggle && onToggle(col.key)}
                            className="form-checkbox"
                        />
                        <span>{col.label}</span>
                    </label>
                ))}
            </div>
        </div>
    );
}

// NetworkTopologyDragHandle: drag handle for reordering network list items.
function NetworkTopologyDragHandle({ onDragStart, onDragEnd, itemId }) {
    const [dragging, setDragging] = useState(false);

    const handleDragStart = (e) => {
        setDragging(true);
        if (onDragStart) onDragStart(itemId, e);
    };

    const handleDragEnd = (e) => {
        setDragging(false);
        if (onDragEnd) onDragEnd(itemId, e);
    };

    return (
        <div
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            className={`cursor-move p-1 rounded ${dragging ? 'opacity-40' : 'opacity-100'}`}
            style={{ color: 'var(--corp-text-muted)' }}
        >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="6" r="2" />
                <circle cx="15" cy="6" r="2" />
                <circle cx="9" cy="12" r="2" />
                <circle cx="15" cy="12" r="2" />
                <circle cx="9" cy="18" r="2" />
                <circle cx="15" cy="18" r="2" />
            </svg>
        </div>
    );
}

// NetworkTopologyFilterSidebar: collapsible sidebar with filters for the Network Topology page.
function NetworkTopologyFilterSidebar({ filters = [], active = [], onToggle }) {
    return (
        <div className="w-64 p-3 border-r border-proxmox-border bg-proxmox-dark h-full overflow-y-auto">
            <div className="font-medium text-[13px] mb-3" style={{ color: '#e9ecef' }}>Filters</div>
            {(filters || []).map(f => (
                <label key={f.key} className="flex items-center gap-2 text-[13px] cursor-pointer mb-2" style={{ color: 'var(--corp-text-secondary)' }}>
                    <input
                        type="checkbox"
                        checked={active?.includes(f.key)}
                        onChange={() => onToggle && onToggle(f.key)}
                        className="form-checkbox"
                    />
                    <span>{f.label}</span>
                </label>
            ))}
        </div>
    );
}

// NetworkTopologyKeyboardShortcuts: listens for keyboard shortcuts and invokes registered handlers.
function NetworkTopologyKeyboardShortcuts({ shortcuts, onShortcut }) {
    useEffect(() => {
        const handler = (e) => {
            const combo = [
                e.ctrlKey ? 'ctrl' : '',
                e.shiftKey ? 'shift' : '',
                e.altKey ? 'alt' : '',
                e.key?.toLowerCase()
            ].filter(Boolean).join('+');
            if (shortcuts?.includes(combo) && onShortcut) {
                e.preventDefault();
                onShortcut(combo);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [shortcuts, onShortcut]);

    return null;
}

// FirewallRuleBulkSelection: select and act on multiple firewall rules at once.
function FirewallRuleBulkSelection({ rules = [], selected = [], onChange, onDelete }) {
    const allSelected = rules.length > 0 && selected.length === rules.length;
    const toggleAll = () => onChange && onChange(allSelected ? [] : rules.map(r => r.id));
    const toggleOne = (id) => {
        if (!onChange) return;
        onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
    };

    return (
        <div className="p-3 rounded border border-proxmox-border bg-proxmox-card" data-testid="firewall-rule-bulk-selection">
            <div className="flex items-center justify-between mb-2">
                <label className="flex items-center gap-2 text-xs">
                    <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        data-testid="firewall-rule-select-all"
                    />
                    <span className="text-proxmox-textMuted">Select all</span>
                </label>
                {selected.length > 0 && (
                    <button
                        onClick={() => onDelete?.(selected)}
                        className="px-2 py-1 text-[10px] rounded bg-red-600 hover:bg-red-700 text-white"
                    >
                        Delete {selected.length}
                    </button>
                )}
            </div>
            <ul className="space-y-1">
                {(rules || []).map(rule => (
                    <li key={rule.id} className="flex items-center gap-2 text-xs">
                        <input
                            type="checkbox"
                            checked={selected.includes(rule.id)}
                            onChange={() => toggleOne(rule.id)}
                            data-testid={`firewall-rule-select-${rule.id}`}
                        />
                        <span className="text-proxmox-text">{rule.name || rule.id}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// FirewallRuleStepWizard: multi-step wizard for creating or editing a firewall rule.
function FirewallRuleStepWizard({ steps = [], onFinish }) {
    const [step, setStep] = React.useState(0);
    const canNext = step < steps.length - 1;
    const canBack = step > 0;
    const finish = () => onFinish && onFinish();
    return (
        <div className="p-3 rounded border border-proxmox-border bg-proxmox-card" data-testid="firewall-rule-step-wizard">
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

// FirewallRuleContextMenu: right-click context menu for firewall rule actions.
function FirewallRuleContextMenu({ items = [], onSelect }) {
    const [visible, setVisible] = React.useState(false);
    const [pos, setPos] = React.useState({ x: 0, y: 0 });
    const menuRef = React.useRef(null);

    React.useEffect(() => {
        if (!visible) return;
        const close = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) setVisible(false);
        };
        window.addEventListener('click', close);
        window.addEventListener('scroll', () => setVisible(false), { passive: true });
        return () => {
            window.removeEventListener('click', close);
            window.removeEventListener('scroll', () => setVisible(false));
        };
    }, [visible]);

    const open = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setPos({ x: e.clientX, y: e.clientY });
        setVisible(true);
    };

    const select = (item) => {
        setVisible(false);
        onSelect?.(item);
    };

    return (
        <div onContextMenu={open} data-testid="firewall-rule-context-menu-trigger">
            {visible && (
                <div
                    ref={menuRef}
                    className="fixed z-50 min-w-[10rem] rounded border border-proxmox-border bg-proxmox-card shadow-xl py-1"
                    style={{ left: pos.x, top: pos.y }}
                    data-testid="firewall-rule-context-menu"
                >
                    {(items || []).map((item) => (
                        <button
                            key={item.id}
                            onClick={() => select(item)}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-proxmox-hover text-proxmox-textMuted"
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// FirewallRuleRecentItems: list of recently used firewall rules for quick access.
function FirewallRuleRecentItems({ items = [], onSelect, onClear }) {
    return (
        <div className="p-3 rounded border border-proxmox-border bg-proxmox-card" data-testid="firewall-rule-recent-items">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-proxmox-textMuted">Recent rules</span>
                {items.length > 0 && (
                    <button
                        onClick={onClear}
                        className="text-[11px] text-proxmox-blue hover:text-proxmox-blueLight"
                    >
                        Clear
                    </button>
                )}
            </div>
            {items.length === 0 ? (
                <div className="text-xs text-proxmox-textMuted">No recent rules</div>
            ) : (
                <ul className="space-y-1">
                    {items.map((item) => (
                        <li key={item.id}>
                            <button
                                onClick={() => onSelect?.(item)}
                                className="w-full text-left text-xs text-proxmox-text hover:text-proxmox-textMuted truncate"
                            >
                                {item.label || item.name || item.id}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// FirewallRuleUndoAction: shows a temporary undo button after a firewall rule action.
function FirewallRuleUndoAction({ action, onUndo, timeout = 5000 }) {
    const [visible, setVisible] = React.useState(true);

    React.useEffect(() => {
        if (!timeout) return;
        const timer = setTimeout(() => setVisible(false), timeout);
        return () => clearTimeout(timer);
    }, [timeout]);

    const handleUndo = () => {
        setVisible(false);
        onUndo?.(action);
    };

    if (!visible || !action) return null;
    return (
        <div className="flex items-center gap-2 px-3 py-2 rounded border border-proxmox-border bg-proxmox-card" data-testid="firewall-rule-undo-action">
            <span className="text-xs text-proxmox-textMuted">{action.label || 'Rule'} applied</span>
            <button
                onClick={handleUndo}
                className="text-xs text-proxmox-blue hover:text-proxmox-blueLight underline"
            >
                Undo
            </button>
        </div>
    );
}

// FirewallRuleQuickFilter: quick keyword filter for firewall rules.
function FirewallRuleQuickFilter({ value = '', onChange, placeholder = 'Filter firewall rules...' }) {
    return (
        <div data-testid="firewall-rule-quick-filter" className="relative">
            <input
                type="text"
                value={value}
                onChange={(e) => onChange?.(e.target.value)}
                placeholder={placeholder}
                className="w-full px-3 py-1.5 text-xs rounded border border-proxmox-border bg-proxmox-card text-proxmox-text placeholder:text-proxmox-textMuted focus:outline-none focus:border-proxmox-blue"
            />
            {value && (
                <button
                    onClick={() => onChange?.('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-proxmox-textMuted hover:text-proxmox-text"
                >
                    Clear
                </button>
            )}
        </div>
    );
}

// FirewallRuleOneClickApply: apply a firewall rule with a single button click and confirmation.
function FirewallRuleOneClickApply({ rule, onApply, applying = false }) {
    const [confirming, setConfirming] = React.useState(false);

    const start = () => setConfirming(true);
    const cancel = () => setConfirming(false);
    const confirm = () => {
        setConfirming(false);
        onApply?.(rule);
    };

    return (
        <div data-testid="firewall-rule-one-click-apply">
            {!confirming ? (
                <button
                    onClick={start}
                    disabled={applying || !rule}
                    className="px-3 py-1.5 text-xs rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white"
                >
                    {applying ? 'Applying...' : 'Apply rule'}
                </button>
            ) : (
                <div className="flex items-center gap-2">
                    <span className="text-xs text-proxmox-textMuted">Apply <strong>{rule.name || rule.id || 'this rule'}</strong>?</span>
                    <button
                        onClick={confirm}
                        className="px-2 py-1 text-[10px] rounded bg-green-600 hover:bg-green-700 text-white"
                    >
                        Confirm
                    </button>
                    <button
                        onClick={cancel}
                        className="px-2 py-1 text-[10px] rounded bg-proxmox-hover hover:bg-proxmox-active"
                    >
                        Cancel
                    </button>
                </div>
            )}
        </div>
    );
}

// FirewallRuleSmartDefaults: pre-fills sensible default options for a new firewall rule.
function FirewallRuleSmartDefaults({ defaultRule, onApply }) {
    const defaults = defaultRule || {
        action: 'ACCEPT',
        direction: 'in',
        protocol: 'tcp',
        interface: 'vmbr0'
    };

    return (
        <div className="p-3 rounded border border-proxmox-border bg-proxmox-card" data-testid="firewall-rule-smart-defaults">
            <div className="text-xs text-proxmox-textMuted mb-2">Smart defaults</div>
            <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                    <span className="text-proxmox-textMuted">Action</span>
                    <span className="text-proxmox-text">{defaults.action}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-proxmox-textMuted">Direction</span>
                    <span className="text-proxmox-text">{defaults.direction}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-proxmox-textMuted">Protocol</span>
                    <span className="text-proxmox-text">{defaults.protocol}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-proxmox-textMuted">Interface</span>
                    <span className="text-proxmox-text">{defaults.interface}</span>
                </div>
            </div>
            <button
                onClick={() => onApply?.(defaults)}
                className="mt-3 w-full px-3 py-1.5 text-xs rounded bg-cyan-600 hover:bg-cyan-700 text-white"
            >
                Use defaults
            </button>
        </div>
    );
}

// FirewallRuleLivePreview: shows a live summary of the firewall rule impact before applying.
function FirewallRuleLivePreview({ rule = {}, impact = {} }) {
    return (
        <div className="p-3 rounded border border-proxmox-border bg-proxmox-card" data-testid="firewall-rule-live-preview">
            <div className="text-xs text-proxmox-textMuted mb-2">Live preview</div>
            <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                    <span className="text-proxmox-textMuted">Source</span>
                    <span className="text-proxmox-text">{rule.source || '-'}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-proxmox-textMuted">Destination</span>
                    <span className="text-proxmox-text">{rule.destination || '-'}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-proxmox-textMuted">Ports</span>
                    <span className="text-proxmox-text">{rule.dport || '-'}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-proxmox-textMuted">Affected VMs</span>
                    <span className="text-proxmox-text">{impact.vms ?? '-'}</span>
                </div>
            </div>
        </div>
    );
}

// FirewallRuleCompareView: side-by-side comparison of current vs proposed firewall rule.
function FirewallRuleCompareView({ current = {}, proposed = {} }) {
    const rows = [
        { label: 'Action', current: current.action || '-', proposed: proposed.action || '-' },
        { label: 'Direction', current: current.direction || '-', proposed: proposed.direction || '-' },
        { label: 'Source', current: current.source || '-', proposed: proposed.source || '-' },
        { label: 'Destination', current: current.destination || '-', proposed: proposed.destination || '-' },
        { label: 'Protocol', current: current.protocol || '-', proposed: proposed.protocol || '-' },
        { label: 'Ports', current: current.dport || '-', proposed: proposed.dport || '-' },
    ];
    return (
        <div className="p-3 rounded border border-proxmox-border bg-proxmox-card" data-testid="firewall-rule-compare-view">
            <div className="text-xs text-proxmox-textMuted mb-2">Compare rule</div>
            <table className="w-full text-xs">
                <thead>
                    <tr className="text-left text-proxmox-textMuted border-b border-proxmox-border">
                        <th className="py-1 font-normal">Field</th>
                        <th className="py-1 font-normal">Current</th>
                        <th className="py-1 font-normal">Proposed</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.label} className="border-b border-proxmox-border/50 last:border-0">
                            <td className="py-1 text-proxmox-textMuted">{row.label}</td>
                            <td className="py-1 text-proxmox-text">{row.current}</td>
                            <td className="py-1 text-proxmox-text">{row.proposed}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// SdnZoneBulkSelection: renders checkboxes for bulk-selecting SDN zones and an action bar.
function SdnZoneBulkSelection({ zones, selected, onSelect, onSelectAll, onAction, actionLabel }) {
    return (
        <div className="space-y-2" data-testid="sdn-zone-bulk-selection">
            <div className="flex items-center gap-2 p-2 border border-proxmox-border rounded bg-proxmox-card">
                <input
                    type="checkbox"
                    checked={zones.length > 0 && selected.length === zones.length}
                    onChange={(e) => onSelectAll?.(e.target.checked)}
                    data-testid="sdn-zone-select-all"
                />
                <span className="text-sm text-proxmox-text">Select all zones</span>
                <button
                    className="ml-auto px-3 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-700 text-white disabled:bg-gray-600 disabled:cursor-not-allowed"
                    disabled={selected.length === 0}
                    onClick={() => onAction?.(selected)}
                >
                    {actionLabel || 'Apply'}
                </button>
            </div>
            <div className="space-y-1">
                {(zones || []).map((zone) => (
                    <label key={zone.id} className="flex items-center gap-2 p-2 border border-proxmox-border rounded bg-proxmox-card hover:bg-proxmox-hover cursor-pointer">
                        <input
                            type="checkbox"
                            checked={selected.includes(zone.id)}
                            onChange={(e) => onSelect?.(zone.id, e.target.checked)}
                            data-testid={`sdn-zone-checkbox-${zone.id}`}
                        />
                        <span className="text-sm text-proxmox-text">{zone.name || zone.id}</span>
                    </label>
                ))}
            </div>
        </div>
    );
}

// SdnZoneStepWizard: a step-by-step wizard for configuring an SDN zone.
function SdnZoneStepWizard({ steps, currentStep, onNext, onBack, onFinish }) {
    const activeStep = steps?.[currentStep];
    return (
        <div className="space-y-3" data-testid="sdn-zone-step-wizard">
            <div className="flex items-center gap-2 text-xs text-proxmox-textMuted">
                {steps.map((step, idx) => (
                    <span key={step.id} className={`px-2 py-1 rounded ${idx === currentStep ? 'bg-cyan-600 text-white' : 'bg-proxmox-card border border-proxmox-border'}`}>
                        {idx + 1}. {step.label}
                    </span>
                ))}
            </div>
            <div className="p-3 border border-proxmox-border rounded bg-proxmox-card">
                <div className="text-sm font-medium text-proxmox-text mb-2">{activeStep?.label || 'Step'}</div>
                <div className="text-sm text-proxmox-text">{activeStep?.content}</div>
            </div>
            <div className="flex gap-2">
                <button
                    className="px-3 py-1 text-xs rounded border border-proxmox-border hover:bg-proxmox-hover disabled:opacity-50"
                    onClick={onBack}
                    disabled={currentStep <= 0}
                >
                    Back
                </button>
                {currentStep < (steps?.length || 0) - 1 ? (
                    <button className="px-3 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-700 text-white" onClick={onNext}>Next</button>
                ) : (
                    <button className="px-3 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-700 text-white" onClick={onFinish}>Finish</button>
                )}
            </div>
        </div>
    );
}

// SdnZoneContextMenu: a context menu for SDN zone actions.
function SdnZoneContextMenu({ visible, x, y, items, onSelect }) {
    if (!visible) return null;
    return (
        <div
            className="absolute z-50 min-w-[10rem] border border-proxmox-border rounded bg-proxmox-card shadow-lg py-1"
            style={{ left: x, top: y }}
            data-testid="sdn-zone-context-menu"
        >
            {(items || []).map((item) => (
                <button
                    key={item.id}
                    className="w-full text-left px-3 py-2 text-sm text-proxmox-text hover:bg-proxmox-hover"
                    onClick={() => onSelect?.(item.id)}
                    data-testid={`sdn-zone-context-item-${item.id}`}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}

// SdnZoneRecentList: lists recently accessed SDN zones for quick navigation.
function SdnZoneRecentList({ recent, onSelect }) {
    if (!recent?.length) return null;
    return (
        <div className="p-3 border border-proxmox-border rounded bg-proxmox-card" data-testid="sdn-zone-recent-list">
            <div className="text-xs font-medium mb-2 text-proxmox-textMuted">Recent SDN Zones</div>
            <ul className="space-y-1">
                {recent.map((zone) => (
                    <li key={zone.id}>
                        <button
                            className="w-full text-left text-sm text-cyan-400 hover:underline"
                            onClick={() => onSelect?.(zone.id)}
                            data-testid={`sdn-zone-recent-${zone.id}`}
                        >
                            {zone.name || zone.id}
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// SdnZoneUndoAction: allows undoing the most recent SDN zone action.
function SdnZoneUndoAction({ lastAction, onUndo, onDismiss }) {
    if (!lastAction) return null;
    return (
        <div className="flex items-center gap-2 p-2 border border-proxmox-border rounded bg-proxmox-card" data-testid="sdn-zone-undo-action">
            <span className="text-sm text-proxmox-text">{lastAction.label}</span>
            <button className="px-2 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-700 text-white" onClick={onUndo}>Undo</button>
            <button className="px-2 py-1 text-xs rounded border border-proxmox-border hover:bg-proxmox-hover" onClick={onDismiss}>Dismiss</button>
        </div>
    );
}

// SdnZoneQuickFilter: a text input for quickly filtering SDN zones.
function SdnZoneQuickFilter({ value, onChange, placeholder }) {
    return (
        <input
            type="text"
            className="w-full px-3 py-2 text-sm rounded border border-proxmox-border bg-proxmox-card text-proxmox-text placeholder:text-proxmox-textMuted focus:outline-none focus:border-cyan-600"
            value={value || ''}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder={placeholder || 'Filter zones...'}
            data-testid="sdn-zone-quick-filter"
        />
    );
}

// SdnZoneOneClickApply: a single-button action to apply the current SDN zone configuration.
function SdnZoneOneClickApply({ onApply, disabled, label }) {
    return (
        <button
            className="w-full px-4 py-2 text-sm rounded bg-cyan-600 hover:bg-cyan-700 text-white disabled:bg-gray-600 disabled:cursor-not-allowed"
            onClick={onApply}
            disabled={disabled}
            data-testid="sdn-zone-one-click-apply"
        >
            {label || 'Apply Now'}
        </button>
    );
}

// SdnZoneSmartDefaults: suggests and applies sensible defaults for a new SDN zone.
function SdnZoneSmartDefaults({ onApply, defaults }) {
    return (
        <div className="p-3 border border-proxmox-border rounded bg-proxmox-card" data-testid="sdn-zone-smart-defaults">
            <div className="text-xs font-medium mb-2 text-proxmox-textMuted">Suggested Defaults</div>
            <ul className="text-sm text-proxmox-text space-y-1 mb-3">
                {(defaults || []).map((d) => (
                    <li key={d.key}>
                        <span className="text-proxmox-textMuted">{d.label}:</span> {d.value}
                    </li>
                ))}
            </ul>
            <button
                className="w-full px-3 py-2 text-sm rounded bg-cyan-600 hover:bg-cyan-700 text-white"
                onClick={() => onApply?.(defaults)}
                data-testid="sdn-zone-apply-defaults"
            >
                Apply Defaults
            </button>
        </div>
    );
}

// SdnZoneLivePreview: renders a live preview of the SDN zone configuration before applying.
function SdnZoneLivePreview({ config }) {
    if (!config) return null;
    return (
        <div className="p-3 border border-proxmox-border rounded bg-proxmox-card" data-testid="sdn-zone-live-preview">
            <div className="text-xs font-medium mb-2 text-proxmox-textMuted">Live Preview</div>
            <div className="text-sm text-proxmox-text space-y-1">
                <div><span className="text-proxmox-textMuted">ID:</span> {config.id || '-'}</div>
                <div><span className="text-proxmox-textMuted">Type:</span> {config.type || '-'}</div>
                <div><span className="text-proxmox-textMuted">Nodes:</span> {(config.nodes || []).join(', ') || '-'}</div>
            </div>
        </div>
    );
}

// FirewallRulesResizablePanels: resizable left/right panels for the Firewall Rules page.
// 912-resizable-panels-for-firewall-rules: lets operators resize the rules list and detail panels.
function FirewallRulesResizablePanels({ left, right, initialLeftPercent = 60 }) {
    const [leftPercent, setLeftPercent] = React.useState(initialLeftPercent);
    const [dragging, setDragging] = React.useState(false);
    const containerRef = React.useRef(null);

    React.useEffect(() => {
        if (!dragging) return;
        const handleMove = (e) => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percent = Math.min(Math.max((x / rect.width) * 100, 20), 80);
            setLeftPercent(percent);
        };
        const handleUp = () => setDragging(false);
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
    }, [dragging]);

    return (
        <div ref={containerRef} className="flex w-full h-full min-h-96" data-testid="firewall-rules-resizable-panels">
            <div className="overflow-auto" style={{ width: `${leftPercent}%` }}>
                {left}
            </div>
            <div
                className="w-1 shrink-0 cursor-col-resize bg-gray-500 hover:bg-gray-400 transition-colors"
                onMouseDown={() => setDragging(true)}
                data-testid="firewall-rules-resize-handle"
            />
            <div className="overflow-auto" style={{ width: `${100 - leftPercent}%` }}>
                {right}
            </div>
        </div>
    );
}

// FirewallRuleStatusBadge: color-coded status badge for a firewall rule (enabled/disabled).
// 913-color-coded-status-for-firewall-rules: gives operators an immediate visual status indicator.
function FirewallRuleStatusBadge({ enabled }) {
    const { t } = useTranslation();
    return (
        <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                enabled
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
            }`}
            data-testid="firewall-rule-status-badge"
        >
            <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-green-400' : 'bg-red-400'}`} />
            {enabled ? t('enabled') : t('disabled')}
        </span>
    );
}

// FirewallRuleHoverCard: hover-activated detail card for a firewall rule.
// 914-hover-cards-for-firewall-rules: shows rule details on hover for quick inspection.
function FirewallRuleHoverCard({ rule, children }) {
    const [hover, setHover] = React.useState(false);
    return (
        <div
            className="relative inline-block"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            data-testid="firewall-rule-hover-card"
        >
            {children}
            {hover && (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-72 p-3 bg-proxmox-card border border-proxmox-border rounded shadow-xl z-50 text-sm space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-proxmox-textMuted">#{rule.pos}</span>
                        <FirewallRuleStatusBadge enabled={rule.enable} />
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-300">
                        <div><span className="text-proxmox-textMuted">Type</span> {rule.type}</div>
                        <div><span className="text-proxmox-textMuted">Action</span> {rule.action}</div>
                        <div><span className="text-proxmox-textMuted">Macro</span> {rule.macro || '-'}</div>
                        <div><span className="text-proxmox-textMuted">Proto</span> {rule.proto || '-'}</div>
                        <div><span className="text-proxmox-textMuted">Port</span> {rule.dport || '-'}</div>
                        <div className="col-span-2"><span className="text-proxmox-textMuted">Source</span> {rule.source || '-'}</div>
                        <div className="col-span-2"><span className="text-proxmox-textMuted">Dest</span> {rule.dest || '-'}</div>
                        <div className="col-span-2 text-proxmox-textMuted truncate">{rule.comment || ''}</div>
                    </div>
                </div>
            )}
        </div>
    );
}

// FirewallRulesBreadcrumb: breadcrumb navigation for the Firewall Rules page.
// 915-breadcrumb-bar-for-firewall-rules: shows Datacenter > Firewall Rules path.
function FirewallRulesBreadcrumb() {
    const { t } = useTranslation();
    return (
        <nav className="flex items-center gap-2 text-sm text-proxmox-textMuted mb-3" data-testid="firewall-rules-breadcrumb">
            <span className="hover:text-white cursor-pointer">{t('datacenter')}</span>
            <span className="text-gray-500">/</span>
            <span className="text-white">{t('firewallRules')}</span>
        </nav>
    );
}

// FirewallRulesColumnPicker: dropdown to show/hide Firewall Rules table columns.
// 916-customizable-columns-for-firewall-rules: provides a checklist of toggleable columns.
function FirewallRulesColumnPicker({ columns, value, onChange }) {
    const [open, setOpen] = useState(false);
    const { t } = useTranslation();
    const toggle = (key) => {
        const next = value.includes(key)
            ? value.filter(k => k !== key)
            : [...value, key];
        onChange(next);
    };
    return (
        <div className="relative" data-testid="firewall-rules-column-picker">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 px-3 py-1.5 bg-proxmox-dark hover:bg-proxmox-hover border border-proxmox-border rounded-lg text-sm text-proxmox-text transition-colors"
            >
                {t('columns')}
            </button>
            {open && (
                <div className="absolute right-0 z-50 mt-2 w-48 bg-proxmox-card border border-proxmox-border rounded-lg shadow-lg p-2">
                    {columns.map(col => (
                        <label key={col.key} className="flex items-center gap-2 p-2 hover:bg-proxmox-dark rounded cursor-pointer text-sm text-gray-300">
                            <input
                                type="checkbox"
                                checked={value.includes(col.key)}
                                onChange={() => toggle(col.key)}
                                className="rounded border-proxmox-border bg-proxmox-dark text-proxmox-orange"
                            />
                            {col.label}
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
}

// FirewallRuleDragHandle: visual drag indicator for a firewall rule row.
// 917-drag-and-drop-reordering-for-firewall-rules: gives users a visible handle to initiate row drag.
function FirewallRuleDragHandle() {
    return (
        <span
            className="inline-block mr-2 cursor-grab text-proxmox-textMuted hover:text-white select-none"
            data-testid="firewall-rule-drag-handle"
        >
            ⋮⋮
        </span>
    );
}

// FirewallRulesFilterSidebar: quick filter panel for firewall rules list.
// 918-filter-sidebar-for-firewall-rules: provides type, action and enabled dropdown filters.
function FirewallRulesFilterSidebar({ filters = {}, onChange }) {
    return (
        <div className="w-52 p-3 border-r border-proxmox-border bg-proxmox-dark/50 flex flex-col gap-3" data-testid="firewall-rules-filter-sidebar">
            <h4 className="text-sm font-semibold text-white">{t('filter')}</h4>
            <div>
                <label className="block text-xs text-proxmox-textMuted mb-1">{t('type')}</label>
                <select
                    className="w-full bg-proxmox-dark border border-proxmox-border rounded px-2 py-1 text-sm text-white"
                    value={filters.type || ''}
                    onChange={(e) => onChange({ ...filters, type: e.target.value })}
                >
                    <option value="">{t('all')}</option>
                    <option value="in">in</option>
                    <option value="out">out</option>
                </select>
            </div>
            <div>
                <label className="block text-xs text-proxmox-textMuted mb-1">{t('action')}</label>
                <select
                    className="w-full bg-proxmox-dark border border-proxmox-border rounded px-2 py-1 text-sm text-white"
                    value={filters.action || ''}
                    onChange={(e) => onChange({ ...filters, action: e.target.value })}
                >
                    <option value="">{t('all')}</option>
                    <option value="ACCEPT">ACCEPT</option>
                    <option value="DROP">DROP</option>
                    <option value="REJECT">REJECT</option>
                </select>
            </div>
            <div>
                <label className="block text-xs text-proxmox-textMuted mb-1">{t('enabled')}</label>
                <select
                    className="w-full bg-proxmox-dark border border-proxmox-border rounded px-2 py-1 text-sm text-white"
                    value={filters.enabled}
                    onChange={(e) => onChange({ ...filters, enabled: e.target.value })}
                >
                    <option value="">{t('all')}</option>
                    <option value="1">{t('enabled')}</option>
                    <option value="0">{t('disabled2')}</option>
                </select>
            </div>
        </div>
    );
}

// FirewallRulesKeyboardShortcuts: keyboard help overlay and handlers for the firewall rules page.
// 919-keyboard-shortcuts-for-firewall-rules: press 'n' to add a rule, '?' to show this help, 'Esc' to close it.
function FirewallRulesKeyboardShortcuts({ onAddRule }) {
    const [showHelp, setShowHelp] = React.useState(false);

    React.useEffect(() => {
        const cleanup = window.useKeyboardShortcut([
            { key: 'n', action: onAddRule },
            { key: '?', action: () => setShowHelp(true) },
            { key: 'Escape', action: () => setShowHelp(false) }
        ]);
        return cleanup;
    }, [onAddRule]);

    if (!showHelp) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop" onClick={() => setShowHelp(false)} data-testid="firewall-rules-keyboard-help">
            <div className="w-full max-w-sm bg-proxmox-card border border-proxmox-border rounded-2xl shadow-2xl p-4" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-3 border-b border-proxmox-border pb-2">
                    <h3 className="font-semibold text-white">{t('keyboardShortcuts')}</h3>
                    <button onClick={() => setShowHelp(false)} className="text-proxmox-textMuted hover:text-white">×</button>
                </div>
                <ul className="space-y-2 text-sm text-gray-300">
                    <li className="flex justify-between"><span>{t('add')}</span> <kbd className="px-1.5 py-0.5 bg-proxmox-dark rounded border border-proxmox-border font-mono text-xs">N</kbd></li>
                    <li className="flex justify-between"><span>{t('keyboardShortcuts')}</span> <kbd className="px-1.5 py-0.5 bg-proxmox-dark rounded border border-proxmox-border font-mono text-xs">?</kbd></li>
                    <li className="flex justify-between"><span>{t('close')}</span> <kbd className="px-1.5 py-0.5 bg-proxmox-dark rounded border border-proxmox-border font-mono text-xs">Esc</kbd></li>
                </ul>
            </div>
        </div>
    );
}

// SdnZoneCompareView: side-by-side comparison of two SDN zone configurations.
function SdnZoneCompareView({ left, right }) {
    const fields = ['id', 'type', 'nodes'];
    const format = (value, field) => {
        if (field === 'nodes' && Array.isArray(value)) return value.join(', ') || '-';
        return value || '-';
    };
    return (
        <div className="grid grid-cols-2 gap-2 p-3 border border-proxmox-border rounded bg-proxmox-card" data-testid="sdn-zone-compare-view">
            <div className="text-xs font-medium text-proxmox-textMuted">Current</div>
            <div className="text-xs font-medium text-proxmox-textMuted">Proposed</div>
            {fields.map((field) => (
                <React.Fragment key={field}>
                    <div className="text-sm text-proxmox-text">{format(left?.[field], field)}</div>
                    <div className={`text-sm ${right?.[field] !== left?.[field] ? 'text-cyan-400' : 'text-proxmox-text'}`}>{format(right?.[field], field)}</div>
                </React.Fragment>
            ))}
        </div>
    );
}
