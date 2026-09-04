/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        web/src/create_modals.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Create Modals JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
const VM_PRESETS = [
    { label: 'Ubuntu 24.04 LTS', icon: '🐧', config: { ostype: 'l26', cores: 2, sockets: 1, memory: 2048, disk_size: '32', cpu: 'host', agent: true, bios: 'seabios', machine: 'i440fx', scsihw: 'virtio-scsi-single', net_model: 'virtio', disk_type: 'scsi', disk_discard: true, disk_iothread: true } },
    { label: 'Windows Server 2022', icon: '🖥️', config: { ostype: 'win11', cores: 4, sockets: 1, memory: 4096, disk_size: '64', cpu: 'host', agent: true, bios: 'ovmf', machine: 'q35', scsihw: 'virtio-scsi-single', net_model: 'virtio', disk_type: 'scsi', disk_discard: true } },
    { label: 'Windows 11', icon: '💻', config: { ostype: 'win11', cores: 4, sockets: 1, memory: 8192, disk_size: '64', cpu: 'host', agent: true, bios: 'ovmf', machine: 'q35', scsihw: 'virtio-scsi-single', net_model: 'virtio', disk_type: 'scsi', tpm_version: 'v2.0' } },
    { label: 'Minimal Linux', icon: '⚡', config: { ostype: 'l26', cores: 1, sockets: 1, memory: 512, disk_size: '8', cpu: 'host', agent: false, bios: 'seabios', net_model: 'virtio', disk_type: 'virtio' } },
];

function CreateVmModal({ vmType, clusterId, clusterType, nodes: initialNodes, onCreate, onClose }) {
    const { t } = useTranslation();
    const { getAuthHeaders } = useAuth();
    const { isCorporate } = useLayout();
    const [activeStep, setActiveStep] = useState(0);
    const [loading, setLoading] = useState(false);
    const [stepErrors, setStepErrors] = useState({});
    const [storageList, setStorageList] = useState([]);
    const [bridgeList, setBridgeList] = useState([]);
    const [isoList, setIsoList] = useState([]);
    const [templateList, setTemplateList] = useState([]);
    const [nextVmid, setNextVmid] = useState('');
    const [presetFilter, setPresetFilter] = useState('');
    const [contextMenu, setContextMenu] = useState(null);
    const [recentTemplates, setRecentTemplates] = useState(() => {
        try { return JSON.parse(localStorage.getItem('proxmoxvex-recent-lxc-templates') || '[]'); } catch { return []; }
    });
    const [lastCreatedLxc, setLastCreatedLxc] = useState(null);
    const [nodes, setNodes] = useState(initialNodes || []);
    const isQemu = vmType === 'qemu';

    // Local authFetch helper
    const authFetch = async (url, options = {}) => {
        try {
            const response = await fetch(url, {
                ...options,
                credentials: 'include',
                headers: {
                    ...options.headers,
                    ...getAuthHeaders()
                }
            });
            return response;
        } catch (err) {
            console.error('Auth fetch error:', err);
            return null;
        }
    };

    // Fetch nodes if not provided
    useEffect(() => {
        const fetchNodes = async () => {
            if (nodes.length === 0) {
                try {
                    const response = await authFetch(`${API_URL}/clusters/${clusterId}/nodes`);
                    if (response && response.ok) {
                        const data = await response.json();
                        const nodeNames = data.map(n => n.node || n.name).filter(Boolean);
                        setNodes(nodeNames);
                        if (nodeNames.length > 0) {
                            const online = data.find(n => n.status === 'online');
                            const smartNode = (online && (online.node || online.name)) || nodeNames[0];
                            setConfig(prev => ({ ...prev, node: smartNode }));
                        }
                    }
                } catch (e) {
                    console.error('fetching nodes:', e);
                }
            }
        };
        fetchNodes();
    }, [clusterId]);

    const [config, setConfig] = useState({
        // General
        node: nodes[0] || '',
        vmid: '',
        name: '',

        // OS (QEMU)
        ostype: 'l26',
        iso: '',
        virtio_iso: '', // VirtIO drivers ISO for Windows

        // Template (LXC)
        template: '',
        password: '',

        // Hardware
        cores: 2,
        sockets: 1,
        memory: 2048,
        memoryUnit: 'GB',  // Easier to work with GB by default

        // Advanced CPU (QEMU)
        cpu_affinity: '',      // CPU affinity string e.g. "0-3" or "0,2,4"
        numa: false,           // Enable NUMA

        // Advanced Memory (QEMU)
        min_memory: '',        // Minimum memory for ballooning (MB)
        min_memoryUnit: 'MB',  // Unit for minimum memory
        ballooning: true,      // Ballooning device enabled
        shares: 1000,          // Memory shares (0-50000)

        // Disk
        storage: 'local-lvm',
        disk_size: isQemu ? '32' : '8',
        disk_type: 'scsi',  // scsi, virtio, ide, sata
        disk_format: '',    // raw, qcow2, vmdk (empty = storage default)
        disk_cache: '',     // none, directsync, writethrough, writeback, unsafe
        disk_discard: true,
        disk_iothread: true,
        disk_ssd: false,
        additional_disks: [], // Array of additional disks {storage, size, type, format}

        // Network
        net_bridge: 'vmbr0',
        net_model: 'virtio',
        net_firewall: true,
        net_tag: '',
        net_ip: 'dhcp',
        net_gw: '',
        // Advanced Network
        net_macaddr: '',       // Custom MAC address
        net_disconnect: false, // Disconnect network
        net_mtu: '',           // MTU (1-65520)
        net_rate: '',          // Rate limit in MB/s

        // Advanced (QEMU)
        cpu: 'host',
        bios: 'seabios',
        machine: 'i440fx',
        // Virtio-scsi-single is the modern PVE default
        // (one controller per disk → own IO thread, better perf)
        scsihw: 'virtio-scsi-single',
        vga: 'std',
        agent: true,
        efi_storage: '',     // Storage for EFI disk
        efi_pre_enroll: true, // Pre-enroll Microsoft keys
        tpm_storage: '',     // Storage for TPM state
        tpm_version: 'v2.0', // TPM version
        ha_enabled: false,   // Enable Proxmox native HA
        ha_group: '',        // HA group name

        // Advanced (LXC)
        unprivileged: true,
        nesting: false,
        keyctl: false,
        fuse: false,
        swap: 512,
        swapUnit: 'MB',  // Unit selector for swap
        ssh_public_keys: '',

        // Network (extended for LXC)
        net_ip_type: 'dhcp',      // dhcp, static, manual
        net_ip6_type: 'dhcp',     // dhcp, static, slaac, manual
        net_ip6: '',
        net_gw6: '',
        net_disconnected: false,

        // DNS
        dns_domain: '',
        dns_servers: '',

        // Options
        onboot: false,
        start: false,

        // XCP-ng specific
        install_method: 'template',   // template, iso, pxe
        os_type: 'linux',             // OS type key for built-in template
        iso_uuid: '',                 // VDI UUID of ISO
        boot_order: 'dc',             // cdrom+disk for ISO, 'n' for PXE
    });

    useEffect(() => {
        // Set default node if available
        if (nodes.length > 0 && !config.node) {
            setConfig(prev => ({ ...prev, node: nodes[0] }));
        }
    }, [nodes]);

    useEffect(() => {
        if (!config.template || !config.template.startsWith('local:')) return;
        setRecentTemplates(prev => {
            const updated = [config.template, ...prev.filter(t => t !== config.template)].slice(0, 5);
            try { localStorage.setItem('proxmoxvex-recent-lxc-templates', JSON.stringify(updated)); } catch { }
            return updated;
        });
    }, [config.template]);

    useEffect(() => {
        if (config.node) {
            fetchStorageList();
            fetchBridgeList();
            if (isQemu) {
                fetchIsoList();
                if (isXcpng) fetchTemplateList();  // XCP-ng needs templates for 'from template' method
            } else {
                fetchTemplateList();
            }
            fetchNextVmid();
            // Fetch XCP-ng OS types for from-scratch creation
            if (isXcpng && isQemu) fetchXcpOsTypes();
        }
    }, [config.node]);

    const fetchStorageList = async () => {
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/nodes/${config.node}/storage`);
            if (response && response.ok) {
                const data = await response.json();
                setStorageList(data);
                // Set default storage if current is not in list
                if (data.length > 0 && !data.find(s => s.storage === config.storage)) {
                    const defaultStorage = data.find(s => s.storage === 'local-lvm') || data[0];
                    setConfig(prev => ({ ...prev, storage: defaultStorage.storage }));
                }
            }
        } catch (e) { console.error(e); }
    };

    const fetchBridgeList = async () => {
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/nodes/${config.node}/networks`);
            if (response && response.ok) {
                const data = await response.json();
                setBridgeList(data);
                // Set default bridge (prefer vmbr0, then any local bridge, then SDN vnet, then first available)
                if (data.length > 0 && !data.find(b => b.iface === config.net_bridge)) {
                    const defaultBridge = data.find(b => b.iface === 'vmbr0') ||
                        data.find(b => b.type === 'bridge' || b.type === 'OVSBridge') ||
                        data.find(b => b.source === 'sdn') ||
                        data[0];
                    if (defaultBridge) setConfig(prev => ({ ...prev, net_bridge: defaultBridge.iface }));
                }
            }
        } catch (e) { console.error(e); }
    };

    const fetchIsoList = async () => {
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/nodes/${config.node}/isos`);
            if (response && response.ok) {
                const data = await response.json();
                setIsoList(data);
                if (data.length > 0) {
                    const defaultIso = data.find(i => /ubuntu|debian|linux/i.test(i.name || i.volid || '')) || data[0];
                    setConfig(prev => ({ ...prev, iso: defaultIso.volid || defaultIso.iso || '' }));
                }
                ProxmoxVExLog.debug('Loaded ISOs:', data);
            }
        } catch (e) { console.error('loading ISOs:', e); }
    };

    const fetchTemplateList = async () => {
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/nodes/${config.node}/templates`);
            if (response && response.ok) {
                const data = await response.json();
                setTemplateList(data);
                if (data.length > 0) {
                    const defaultTemplate = data.find(t => /ubuntu|debian|linux/i.test(t.name || t.volid || '')) || data[0];
                    setConfig(prev => ({ ...prev, template: defaultTemplate.volid || defaultTemplate.template || '' }));
                }
            }
        } catch (e) { console.error(e); }
    };

    const fetchNextVmid = async () => {
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/nodes/${config.node}/nextid`);
            if (response && response.ok) {
                const data = await response.json();
                setNextVmid(data.vmid);
                if (!config.vmid) setConfig(prev => ({ ...prev, vmid: data.vmid }));
            }
        } catch (e) { console.error(e); }
    };

    const fetchXcpOsTypes = async () => {
        try {
            const resp = await authFetch(`${API_URL}/clusters/${clusterId}/xcp/os-types`);
            if (resp && resp.ok) {
                const data = await resp.json();
                setXcpOsTypes(data);
            }
        } catch (e) { /* ignore */ }
    };

    const handleCreate = async () => {
        setLoading(true);
        try {
            await onCreate(vmType, config.node, config);
            if (!isQemu) {
                setLastCreatedLxc({ node: config.node, vmid: config.vmid });
            }
        } finally {
            setLoading(false);
        }
    };

    const handleUndoLxc = async () => {
        if (!lastCreatedLxc) return;
        setLoading(true);
        try {
            const res = await authFetch(`${API_URL}/clusters/${clusterId}/nodes/${lastCreatedLxc.node}/lxc/${lastCreatedLxc.vmid}`, { method: 'DELETE' });
            if (res && res.ok) setLastCreatedLxc(null);
        } catch (e) { console.error('undo lxc:', e); }
        finally { setLoading(false); }
    };

    // XCP-ng VMs skip the advanced step (no BIOS/Machine/SCSI/EFI/TPM)
    const steps = isXcpng && isQemu
        ? [t('general'), t('installMethod2'), t('hardware'), t('disk'), t('network'), t('options')]
        : isQemu
            ? [t('general'), t('os'), t('hardware'), t('disk'), t('network'), t('advanced')]
            : [t('general'), t('template'), t('resources'), t('disk'), t('network'), t('options')];

    // (#358) - match PVE 9.1's full ostype list + labels
    // (we were missing w2k/w2k3/w2k8/wvista/solaris and the labels
    // didn't line up with what PVE shows in its own UI).
    const osTypes = [
        { value: 'l26', label: 'Linux 2.6 - 6.x Kernel' },
        { value: 'l24', label: 'Linux 2.4 Kernel' },
        { value: 'win11', label: 'Microsoft Windows 11/2022/2025' },
        { value: 'win10', label: 'Microsoft Windows 10/2016/2019' },
        { value: 'win8', label: 'Microsoft Windows 8.x/2012/2012r2' },
        { value: 'win7', label: 'Microsoft Windows 7/2008r2' },
        { value: 'wvista', label: 'Microsoft Windows Vista' },
        { value: 'w2k8', label: 'Microsoft Windows 2008' },
        { value: 'w2k3', label: 'Microsoft Windows 2003' },
        { value: 'w2k', label: 'Microsoft Windows 2000' },
        { value: 'wxp', label: 'Microsoft Windows XP' },
        { value: 'solaris', label: 'Solaris Kernel' },
        { value: 'other', label: 'Other OS types' },
    ];

    // 2026-05-30 - host first, max second, then alphabetical (case-insensitive).
    // Matches the backend get_cpu_types() ordering; VM Config dropdown already gets
    // a sorted list from /api/hardware-options so the two surfaces look identical now.
    const cpuTypes = (() => {
        const all = [
            'host', 'max',
            'kvm64', 'kvm32', 'qemu64', 'qemu32',
            'Broadwell', 'Broadwell-IBRS', 'Broadwell-noTSX', 'Broadwell-noTSX-IBRS',
            'Cascadelake-Server', 'Cascadelake-Server-noTSX', 'Conroe', 'EPYC', 'EPYC-IBPB',
            'EPYC-Milan', 'EPYC-Rome', 'Haswell', 'Haswell-IBRS', 'Haswell-noTSX',
            'Haswell-noTSX-IBRS', 'Icelake-Client', 'Icelake-Client-noTSX', 'Icelake-Server',
            'Icelake-Server-noTSX', 'IvyBridge', 'IvyBridge-IBRS', 'KnightsMill', 'Nehalem',
            'Nehalem-IBRS', 'Opteron_G1', 'Opteron_G2', 'Opteron_G3', 'Opteron_G4', 'Opteron_G5',
            'Penryn', 'SandyBridge', 'SandyBridge-IBRS', 'Skylake-Client', 'Skylake-Client-IBRS',
            'Skylake-Client-noTSX-IBRS', 'Skylake-Server', 'Skylake-Server-IBRS',
            'Skylake-Server-noTSX-IBRS', 'Westmere', 'Westmere-IBRS', 'athlon', 'core2duo',
            'coreduo', 'n270', 'pentium', 'pentium2', 'pentium3', 'phenom', 'x86-64-v2',
            'x86-64-v2-AES', 'x86-64-v3', 'x86-64-v4',
        ];
        const head = [];
        const rest = [];
        for (const t of all) {
            if (t === 'host' || t === 'max') head.push(t);
            else rest.push(t);
        }
        rest.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        return ['host', 'max', ...rest];
    })();

    const vgaTypes = [
        { value: 'std', label: 'Standard VGA' },
        { value: 'vmware', label: 'VMware compatible' },
        { value: 'qxl', label: 'SPICE (QXL)' },
        { value: 'qxl2', label: 'SPICE (QXL) 2 heads' },
        { value: 'qxl3', label: 'SPICE (QXL) 3 heads' },
        { value: 'qxl4', label: 'SPICE (QXL) 4 heads' },
        { value: 'virtio', label: 'VirtIO-GPU' },
        { value: 'virtio-gl', label: 'VirtIO-GPU (virgl)' },
        { value: 'cirrus', label: 'Cirrus Logic' },
        { value: 'none', label: 'None (headless)' },
    ];

    // machine types — curated short list, newest on top. Jun 2026: bumped to QEMU 11.
    // full historical list lives in backend get_machine_types(); an unknown current value
    // gets injected into the select below so migrated VMs on e.g. pc-q35-5.1 still show
    const machineOpts = [
        { group: 'i440fx', value: 'i440fx', label: 'i440fx (Latest)' },
        { group: 'i440fx', value: 'pc-i440fx-11.0+pve1', label: 'i440fx 11.0+pve1' },
        { group: 'i440fx', value: 'pc-i440fx-10.1', label: 'i440fx 10.1' },
        { group: 'i440fx', value: 'pc-i440fx-9.2+pve1', label: 'i440fx 9.2+pve1' },
        { group: 'i440fx', value: 'pc-i440fx-8.2', label: 'i440fx 8.2' },
        { group: 'i440fx', value: 'pc-i440fx-7.2', label: 'i440fx 7.2' },
        { group: 'q35', value: 'q35', label: 'q35 (Latest)' },
        { group: 'q35', value: 'pc-q35-11.0+pve1', label: 'q35 11.0+pve1' },
        { group: 'q35', value: 'pc-q35-10.1', label: 'q35 10.1' },
        { group: 'q35', value: 'pc-q35-9.2+pve1', label: 'q35 9.2+pve1' },
        { group: 'q35', value: 'pc-q35-8.2', label: 'q35 8.2' },
        { group: 'q35', value: 'pc-q35-7.2', label: 'q35 7.2' },
    ];

    const scsiControllers = [
        { value: 'virtio-scsi-pci', label: 'VirtIO SCSI' },
        { value: 'virtio-scsi-single', label: 'VirtIO SCSI Single' },
        { value: 'lsi', label: 'LSI 53C895A' },
        { value: 'lsi53c810', label: 'LSI 53C810' },
        { value: 'megasas', label: 'MegaRAID SAS' },
        { value: 'pvscsi', label: 'VMware PVSCSI' },
    ];

    // validate current step before advancing
    const validateStep = (step) => {
        const errs = {};
        if (step === 0) {
            if (!config.name || !config.name.trim()) errs.name = t('required');
        }
        if (step === 3 && isQemu && !isXcpng) {
            if (!config.storage) errs.storage = t('required');
        }
        setStepErrors(errs);
        return Object.keys(errs).length === 0;
    };

    // Storage type -> supported disk formats
    // ZFS/LVM/RBD only do raw, file-based storages support all
    const STORAGE_FORMATS = {
        zfspool: ['raw'], zfs: ['raw'],
        lvm: ['raw'], lvmthin: ['raw'],
        rbd: ['raw'],
        iscsi: ['raw'], iscsidirect: ['raw'],
        dir: ['raw', 'qcow2', 'vmdk'],
        nfs: ['raw', 'qcow2', 'vmdk'],
        cifs: ['raw', 'qcow2', 'vmdk'],
        glusterfs: ['raw', 'qcow2', 'vmdk'],
        cephfs: ['raw', 'qcow2', 'vmdk'],
        btrfs: ['raw', 'qcow2', 'vmdk'],
    };
    const getAllowedFormats = (storageName) => {
        const st = storageList.find(s => s.storage === storageName);
        if (!st) return ['raw', 'qcow2', 'vmdk'];
        return STORAGE_FORMATS[st.type] || ['raw', 'qcow2', 'vmdk'];
    };

    const renderStepContent = () => {
        // Filter storages by content type
        const diskStorages = storageList.filter(s => {
            const content = s.content || '';
            return content.includes('images') || content.includes('rootdir') || s.type === 'lvmthin' || s.type === 'lvm' || s.type === 'zfspool' || s.type === 'rbd' || s.type === 'dir';
        });
        const isoStorages = storageList.filter(s => (s.content || '').includes('iso'));
        const templateStorages = storageList.filter(s => (s.content || '').includes('vztmpl'));

        if (isQemu) {
            switch (activeStep) {
                case 0: // General
                    return (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('node')}</label>
                                    <select value={config.node} onChange={e => setConfig({ ...config, node: e.target.value })}
                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                        {nodes.map(n => <option key={n} value={n}>{n}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>VM ID</label>
                                    <input type="number" value={config.vmid} onChange={e => setConfig({ ...config, vmid: e.target.value })}
                                        placeholder={nextVmid ? `${t('next')}: ${nextVmid}` : ''}
                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                </div>
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('name')}</label>
                                <input type="text" value={config.name} onChange={e => { setConfig({ ...config, name: e.target.value }); if (stepErrors.name) setStepErrors({}); }}
                                    placeholder="my-virtual-machine"
                                    className={`w-full px-3 py-2 bg-proxmox-dark border rounded-lg text-white ${stepErrors.name ? 'border-red-500' : 'border-proxmox-border'}`} />
                                {stepErrors.name && <p className="text-xs text-red-400 mt-1">{stepErrors.name}</p>}
                            </div>
                            {isQemu && (
                                <div className="pt-3 border-t border-proxmox-border">
                                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-500 mb-2"}>{t('quickTemplate')}</label>
                                    <input
                                        type="text"
                                        value={presetFilter}
                                        onChange={e => setPresetFilter(e.target.value)}
                                        placeholder={t('search')}
                                        className="w-full px-3 py-2 mb-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                        {VM_PRESETS.filter(p => p.label.toLowerCase().includes(presetFilter.toLowerCase())).map(p => (
                                            <button key={p.label} type="button"
                                                onClick={() => {
                                                    const defaultName = (config.name || p.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                                                    setConfig(prev => ({ ...prev, ...p.config, name: defaultName, vmid: prev.vmid || nextVmid }));
                                                    setStepErrors({});
                                                    setActiveStep(s => Math.min(s + 1, 3));
                                                }}
                                                className="text-left p-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-xs hover:border-proxmox-orange/50 transition-colors flex items-center gap-2">
                                                <span>{p.icon}</span>
                                                <span className="text-gray-300">{p.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                    <div className="mt-4 border border-proxmox-border rounded-lg overflow-hidden">
                                        <div className="px-3 py-2 bg-proxmox-dark border-b border-proxmox-border text-xs font-semibold text-proxmox-orange uppercase tracking-wider">
                                            {t('compare')}
                                        </div>
                                        <table className="w-full text-left text-xs">
                                            <thead>
                                                <tr className="bg-proxmox-dark/50 text-gray-400">
                                                    <th className="px-3 py-2 font-normal">{t('name')}</th>
                                                    <th className="px-3 py-2 font-normal">{t('cores')}</th>
                                                    <th className="px-3 py-2 font-normal">{t('memory')}</th>
                                                    <th className="px-3 py-2 font-normal">{t('disk')}</th>
                                                    <th className="px-3 py-2 font-normal">{t('os')}</th>
                                                    <th className="px-3 py-2 font-normal" />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {VM_PRESETS.filter(p => p.label.toLowerCase().includes(presetFilter.toLowerCase())).map(p => (
                                                    <tr key={p.label} className="border-t border-proxmox-border hover:bg-proxmox-hover">
                                                        <td className="px-3 py-2 text-gray-300 whitespace-nowrap"><span className="mr-1">{p.icon}</span>{p.label}</td>
                                                        <td className="px-3 py-2 text-gray-300">{p.config.cores}</td>
                                                        <td className="px-3 py-2 text-gray-300">{p.config.memory} MB</td>
                                                        <td className="px-3 py-2 text-gray-300">{p.config.disk_size} GB</td>
                                                        <td className="px-3 py-2 text-gray-300">{p.config.ostype || '-'}</td>
                                                        <td className="px-3 py-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const defaultName = (config.name || p.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                                                                    setConfig(prev => ({ ...prev, ...p.config, name: defaultName, vmid: prev.vmid || nextVmid }));
                                                                    setStepErrors({});
                                                                    setActiveStep(s => Math.min(s + 1, 3));
                                                                }}
                                                                className="text-proxmox-orange hover:text-white transition-colors"
                                                            >
                                                                {t('apply')}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                case 1: // OS / Install Method
                    if (isXcpng) {
                        // XCP-ng: install method selection + OS type + ISO
                        return (
                            <div className="space-y-4">
                                <div>
                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('installMethod')}</label>
                                    <div className="flex gap-3">
                                        {['template', 'iso', 'pxe'].map(m => (
                                            <label key={m} className={`flex-1 flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${config.install_method === m ? 'border-orange-500 bg-orange-500/10 text-white' : 'border-proxmox-border bg-proxmox-dark text-gray-400 hover:border-gray-500'}`}>
                                                <input type="radio" name="install_method" value={m} checked={config.install_method === m}
                                                    onChange={e => setConfig({ ...config, install_method: e.target.value })}
                                                    className="hidden" />
                                                <span className="text-sm font-medium">
                                                    {m === 'template' ? (t('fromTemplate')) :
                                                        m === 'iso' ? (t('fromIso')) :
                                                            'PXE Boot'}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {config.install_method === 'template' && (
                                    <div>
                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('template')}</label>
                                        <select value={config.template} onChange={e => setConfig({ ...config, template: e.target.value })}
                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                            <option value="">{t('selectTemplate')}</option>
                                            {templateList.map(tpl => <option key={tpl.uuid} value={tpl.uuid}>{tpl.name}</option>)}
                                        </select>
                                    </div>
                                )}

                                {(config.install_method === 'iso' || config.install_method === 'pxe') && (
                                    <div>
                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('osType')}</label>
                                        <select value={config.os_type} onChange={e => setConfig({ ...config, os_type: e.target.value })}
                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                            {xcpOsTypes.map(os => <option key={os.key} value={os.key}>{os.label}</option>)}
                                            {xcpOsTypes.length === 0 && (
                                                <>
                                                    <option value="linux">Linux (Generic)</option>
                                                    <option value="windows">Windows</option>
                                                    <option value="other">Other</option>
                                                </>
                                            )}
                                        </select>
                                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>{t('osTypeHint')}</p>
                                    </div>
                                )}

                                {config.install_method === 'iso' && (
                                    <div>
                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('isoImage')}</label>
                                        <select value={config.iso_uuid} onChange={e => setConfig({ ...config, iso_uuid: e.target.value })}
                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                            <option value="">{t('selectIso')}</option>
                                            {isoList.map(iso => <option key={iso.uuid || iso.volid} value={iso.uuid || iso.volid}>{iso.name || iso.volid}</option>)}
                                        </select>
                                    </div>
                                )}

                                {config.install_method === 'pxe' && (
                                    <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                                        <p className="text-sm text-blue-400">{t('pxeHint')}</p>
                                    </div>
                                )}
                            </div>
                        );
                    }
                    // Proxmox: standard OS selection
                    return (
                        <div className="space-y-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('guestOs')}</label>
                                <select value={config.ostype} onChange={e => setConfig({ ...config, ostype: e.target.value })}
                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                    {osTypes.map(os => <option key={os.value} value={os.value}>{os.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('isoImage')}</label>
                                {/* (#305): filter input above native select - scrollable + selectable */}
                                {isoList.length > 5 && (
                                    <div className="relative mb-1">
                                        <Icons.Search className="w-3 h-3 absolute left-2 top-2.5 text-gray-500" />
                                        <input
                                            type="text"
                                            value={config._isoFilter || ''}
                                            onChange={e => setConfig({ ...config, _isoFilter: e.target.value })}
                                            placeholder={t('filterIso2')}
                                            className={isCorporate ? 'corp-input' : "w-full pl-7 pr-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-xs focus:outline-none focus:border-proxmox-orange"}
                                        />
                                    </div>
                                )}
                                {(() => {
                                    const q = (config._isoFilter || '').toLowerCase();
                                    const filtered = q ? isoList.filter(iso => iso.volid.toLowerCase().includes(q)) : isoList;
                                    return (
                                        <select
                                            value={config.iso}
                                            onChange={e => setConfig({ ...config, iso: e.target.value })}
                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}
                                        >
                                            <option value="">{t('noIso')}</option>
                                            {isoList.length === 0 && <option disabled>{t('noIsoAvailable')}</option>}
                                            {/* show currently selected even if it doesn't match filter — prevents blank */}
                                            {config.iso && q && !filtered.find(i => i.volid === config.iso) && (
                                                <option value={config.iso}>{config.iso.split('/').pop()} ✓</option>
                                            )}
                                            {filtered.map(iso => (
                                                <option key={iso.volid} value={iso.volid}>{iso.volid.split('/').pop()}</option>
                                            ))}
                                            {q && filtered.length === 0 && <option disabled>{t('noResults')}</option>}
                                        </select>
                                    );
                                })()}
                                {isoStorages.length === 0 && (
                                    <p className="text-xs text-yellow-500 mt-1">⚠️ {t('noIsoStorage')}</p>
                                )}
                            </div>
                            {config.ostype.startsWith('win') && (
                                <div>
                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('virtioDrivers')}</label>
                                    <select value={config.virtio_iso} onChange={e => setConfig({ ...config, virtio_iso: e.target.value })}
                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                        <option value="">{t('noVirtioDrivers')}</option>
                                        {isoList.filter(iso => iso.volid.toLowerCase().includes('virtio')).map(iso => (
                                            <option key={iso.volid} value={iso.volid}>{iso.volid.split('/').pop()}</option>
                                        ))}
                                        <optgroup label={t('allIsos')}>
                                            {isoList.map(iso => <option key={iso.volid} value={iso.volid}>{iso.volid.split('/').pop()}</option>)}
                                        </optgroup>
                                    </select>
                                    <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>{t('virtioDriversHint')}</p>
                                </div>
                            )}
                        </div>
                    );
                case 2: // Hardware
                    return (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                {!isXcpng && (
                                    <div>
                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('sockets')}</label>
                                        <input type="number" min="1" max="4" value={config.sockets} onChange={e => setConfig({ ...config, sockets: parseInt(e.target.value) })}
                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                    </div>
                                )}
                                <div>
                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{isXcpng ? 'vCPUs' : t('cores')}</label>
                                    <input type="number" min="1" max={isXcpng ? 256 : 128} value={config.cores} onChange={e => setConfig({ ...config, cores: parseInt(e.target.value) })}
                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                </div>
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('memory')}</label>
                                <div className="flex gap-2">
                                    <input type="number" min={config.memoryUnit === 'GB' ? 0.5 : 128} step={config.memoryUnit === 'GB' ? 0.5 : 128}
                                        value={config.memoryUnit === 'GB' ? (config.memory / 1024) : config.memory}
                                        onChange={e => {
                                            const val = parseFloat(e.target.value) || 0;
                                            setConfig({ ...config, memory: config.memoryUnit === 'GB' ? Math.round(val * 1024) : val });
                                        }}
                                        className={isCorporate ? 'corp-input' : "flex-1 px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                    <select value={config.memoryUnit || 'MB'} onChange={e => setConfig({ ...config, memoryUnit: e.target.value })}
                                        className="w-20 px-2 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white">
                                        <option value="MB">MB</option>
                                        <option value="GB">GB</option>
                                    </select>
                                </div>
                                <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>
                                    {config.memoryUnit === 'GB' ? `${config.memory} MB` : `${(config.memory / 1024).toFixed(1)} GB`}
                                </p>
                            </div>

                            {/* Advanced CPU Section */}
                            <details className="group">
                                <summary className="flex items-center justify-between cursor-pointer p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg hover:bg-blue-500/20">
                                    <span className="text-sm font-medium text-blue-400">{t('advancedCpu2')}</span>
                                    <Icons.ChevronDown className="w-4 h-4 text-blue-400 group-open:rotate-180 transition-transform" />
                                </summary>
                                <div className="mt-3 space-y-3 p-3 bg-proxmox-dark/50 rounded-lg">
                                    <div>
                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('cpuAffinity')}</label>
                                        <input type="text" value={config.cpu_affinity} onChange={e => setConfig({ ...config, cpu_affinity: e.target.value })}
                                            placeholder="e.g. 0-3 or 0,2,4,6"
                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>{t('cpuAffinityHint')}</p>
                                    </div>
                                    <label className="flex items-center gap-2 text-sm text-gray-300">
                                        <input type="checkbox" checked={config.numa} onChange={e => setConfig({ ...config, numa: e.target.checked })} className="rounded" />
                                        {t('enableNuma')}
                                    </label>
                                </div>
                            </details>

                            {/* Advanced Memory Section */}
                            <details className="group">
                                <summary className="flex items-center justify-between cursor-pointer p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg hover:bg-purple-500/20">
                                    <span className="text-sm font-medium text-purple-400">{t('advancedMemory2')}</span>
                                    <Icons.ChevronDown className="w-4 h-4 text-purple-400 group-open:rotate-180 transition-transform" />
                                </summary>
                                <div className="mt-3 space-y-3 p-3 bg-proxmox-dark/50 rounded-lg">
                                    <div>
                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('minimumMemory')}</label>
                                        <div className="flex gap-2">
                                            <input type="number" min="0"
                                                value={config.min_memoryUnit === 'GB' ? (config.min_memory ? config.min_memory / 1024 : '') : (config.min_memory || '')}
                                                onChange={e => {
                                                    const val = parseFloat(e.target.value) || '';
                                                    if (val === '') {
                                                        setConfig({ ...config, min_memory: '' });
                                                    } else {
                                                        setConfig({ ...config, min_memory: config.min_memoryUnit === 'GB' ? Math.round(val * 1024) : val });
                                                    }
                                                }}
                                                placeholder={t('sameAsMemory2')}
                                                className={isCorporate ? 'corp-input' : "flex-1 px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                            <select value={config.min_memoryUnit || 'MB'} onChange={e => setConfig({ ...config, min_memoryUnit: e.target.value })}
                                                className="w-20 px-2 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white">
                                                <option value="MB">MB</option>
                                                <option value="GB">GB</option>
                                            </select>
                                        </div>
                                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>{t('minimumMemoryHint')}</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <label className="flex items-center gap-2 text-sm text-gray-300">
                                            <input type="checkbox" checked={config.ballooning} onChange={e => setConfig({ ...config, ballooning: e.target.checked })} className="rounded" />
                                            {t('ballooningDevice')}
                                        </label>
                                    </div>
                                    <div>
                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('memoryShares')}</label>
                                        <input type="number" min="0" max="50000" value={config.shares} onChange={e => setConfig({ ...config, shares: parseInt(e.target.value) || 0 })}
                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>{t('memorySharesHint')}</p>
                                    </div>
                                </div>
                            </details>
                        </div>
                    );
                case 3: // Disk
                    // Helper to render storage bar
                    const renderStorageBar = (selectedStorage) => {
                        const storageInfo = diskStorages.find(s => s.storage === selectedStorage);
                        if (!storageInfo) return null;
                        const total = storageInfo.total || storageInfo.maxdisk || storageInfo.avail || 0;
                        const avail = storageInfo.avail || 0;
                        if (total <= 0) return null;
                        const usedPercent = total > 0 ? ((total - avail) / total) * 100 : 0;
                        const freeGB = (avail / 1024 / 1024 / 1024).toFixed(1);
                        return (
                            <div className="mt-2">
                                <div className="flex justify-between text-xs text-gray-500 mb-1">
                                    <span>{freeGB} GB {t('free')}</span>
                                    <span>{usedPercent.toFixed(0)}% {t('used')}</span>
                                </div>
                                <div className="h-1.5 bg-proxmox-dark rounded-full overflow-hidden">
                                    <div className={`h-full ${usedPercent > 90 ? 'bg-red-500' : usedPercent > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                        style={{ width: `${usedPercent}%` }} />
                                </div>
                            </div>
                        );
                    };

                    return (
                        <div className="space-y-4">
                            {/* Primary Disk with ALL options */}
                            <div className={isCorporate ? 'corp-settings-card' : "p-4 bg-proxmox-dark/50 rounded-lg border border-proxmox-border"}>
                                <h4 className="text-sm font-medium text-white mb-3">{isXcpng ? (t('virtualDisk')) : `${t('primaryDisk2')} 0 (${config.disk_type}0)`}</h4>
                                {isXcpng ? (
                                    /* XCP-ng: simplified disk config - just SR + size */
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('storageRepository')}</label>
                                            <select value={config.storage} onChange={e => setConfig({ ...config, storage: e.target.value })}
                                                className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}>
                                                {diskStorages.map(s => (
                                                    <option key={s.storage} value={s.storage}>
                                                        {s.storage} ({s.type})
                                                    </option>
                                                ))}
                                            </select>
                                            {renderStorageBar(config.storage)}
                                        </div>
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('size')} (GB)</label>
                                            <input type="number" min="1" value={config.disk_size} onChange={e => setConfig({ ...config, disk_size: e.target.value })}
                                                className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"} />
                                        </div>
                                    </div>
                                ) : (
                                    /* Proxmox: full disk options */
                                    <>
                                        <div className="grid grid-cols-4 gap-3 mb-3">
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('busType')}</label>
                                                <select value={config.disk_type} onChange={e => setConfig({ ...config, disk_type: e.target.value })}
                                                    className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}>
                                                    <option value="scsi">SCSI</option>
                                                    <option value="virtio">VirtIO Block</option>
                                                    <option value="ide">IDE</option>
                                                    <option value="sata">SATA</option>
                                                </select>
                                            </div>
                                            <div className="col-span-2">
                                                <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('storage')}</label>
                                                <select value={config.storage} onChange={e => setConfig({ ...config, storage: e.target.value })}
                                                    className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}>
                                                    {diskStorages.map(s => (
                                                        <option key={s.storage} value={s.storage}>
                                                            {s.storage} ({s.type})
                                                        </option>
                                                    ))}
                                                </select>
                                                {renderStorageBar(config.storage)}
                                            </div>
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('size')} (GB)</label>
                                                <input type="number" min="1" value={config.disk_size} onChange={e => setConfig({ ...config, disk_size: e.target.value })}
                                                    className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-4 gap-3 mb-3">
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('format')}</label>
                                                {(() => {
                                                    const fmts = getAllowedFormats(config.storage); return (
                                                        <select value={fmts.length === 1 ? '' : config.disk_format} onChange={e => setConfig({ ...config, disk_format: e.target.value })}
                                                            className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}
                                                            disabled={fmts.length === 1}>
                                                            <option value="">{fmts.length === 1 ? fmts[0].toUpperCase() : (t('storageDefault2'))}</option>
                                                            {fmts.length > 1 && fmts.map(f => <option key={f} value={f}>{f === 'raw' ? 'Raw' : f === 'qcow2' ? 'QCOW2' : 'VMDK'}</option>)}
                                                        </select>);
                                                })()}
                                            </div>
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('cache')}</label>
                                                <select value={config.disk_cache} onChange={e => setConfig({ ...config, disk_cache: e.target.value })}
                                                    className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}>
                                                    <option value="">{t('default')}</option>
                                                    <option value="directsync">Direct Sync</option>
                                                    <option value="writethrough">Write Through</option>
                                                    <option value="writeback">Write Back</option>
                                                    <option value="none">{t('none')}</option>
                                                </select>
                                            </div>
                                            {config.disk_type === 'scsi' && (
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('scsiController')}</label>
                                                    <select value={config.scsihw} onChange={e => setConfig({ ...config, scsihw: e.target.value })}
                                                        className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}>
                                                        {scsiControllers.map(sc => <option key={sc.value} value={sc.value}>{sc.label}</option>)}
                                                    </select>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-4">
                                            <label className="flex items-center gap-2 text-xs text-gray-300">
                                                <input type="checkbox" checked={config.disk_discard} onChange={e => setConfig({ ...config, disk_discard: e.target.checked })} className="rounded" />
                                                {t('discard')} (TRIM)
                                            </label>
                                            {config.disk_type === 'scsi' && (
                                                <label className="flex items-center gap-2 text-xs text-gray-300">
                                                    <input type="checkbox" checked={config.disk_iothread} onChange={e => setConfig({ ...config, disk_iothread: e.target.checked })} className="rounded" />
                                                    {t('ioThread')}
                                                </label>
                                            )}
                                            <label className="flex items-center gap-2 text-xs text-gray-300">
                                                <input type="checkbox" checked={config.disk_ssd} onChange={e => setConfig({ ...config, disk_ssd: e.target.checked })} className="rounded" />
                                                {t('ssdEmulation')}
                                            </label>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Additional Disks - each with ALL options */}
                            {config.additional_disks.map((disk, idx) => (
                                <div key={idx} className={isCorporate ? 'corp-settings-card' : "p-4 bg-proxmox-dark/50 rounded-lg border border-proxmox-border"}>
                                    <div className="flex items-center justify-between mb-3">
                                        <h4 className="text-sm font-medium text-white">{t('disk')} {idx + 1} ({disk.type}{idx + 1})</h4>
                                        <button onClick={() => setConfig({ ...config, additional_disks: config.additional_disks.filter((_, i) => i !== idx) })}
                                            className="p-1 text-red-400 hover:bg-red-500/20 rounded">
                                            <Icons.Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-4 gap-3 mb-3">
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('busType')}</label>
                                            <select value={disk.type} onChange={e => {
                                                const newDisks = [...config.additional_disks];
                                                newDisks[idx] = { ...disk, type: e.target.value };
                                                setConfig({ ...config, additional_disks: newDisks });
                                            }}
                                                className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}>
                                                <option value="scsi">SCSI</option>
                                                <option value="virtio">VirtIO Block</option>
                                                <option value="sata">SATA</option>
                                            </select>
                                        </div>
                                        <div className="col-span-2">
                                            <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('storage')}</label>
                                            <select value={disk.storage} onChange={e => {
                                                const newDisks = [...config.additional_disks];
                                                newDisks[idx] = { ...disk, storage: e.target.value };
                                                setConfig({ ...config, additional_disks: newDisks });
                                            }}
                                                className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}>
                                                {diskStorages.map(s => <option key={s.storage} value={s.storage}>{s.storage} ({s.type})</option>)}
                                            </select>
                                            {renderStorageBar(disk.storage)}
                                        </div>
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('size')} (GB)</label>
                                            <input type="number" min="1" value={disk.size} onChange={e => {
                                                const newDisks = [...config.additional_disks];
                                                newDisks[idx] = { ...disk, size: e.target.value };
                                                setConfig({ ...config, additional_disks: newDisks });
                                            }}
                                                className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"} />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-4 gap-3 mb-3">
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('format')}</label>
                                            {(() => {
                                                const fmts = getAllowedFormats(disk.storage); return (
                                                    <select value={fmts.length === 1 ? '' : (disk.format || '')} onChange={e => {
                                                        const newDisks = [...config.additional_disks];
                                                        newDisks[idx] = { ...disk, format: e.target.value };
                                                        setConfig({ ...config, additional_disks: newDisks });
                                                    }}
                                                        className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}
                                                        disabled={fmts.length === 1}>
                                                        <option value="">{fmts.length === 1 ? fmts[0].toUpperCase() : (t('storageDefault3'))}</option>
                                                        {fmts.length > 1 && fmts.map(f => <option key={f} value={f}>{f === 'raw' ? 'Raw' : f === 'qcow2' ? 'QCOW2' : 'VMDK'}</option>)}
                                                    </select>);
                                            })()}
                                        </div>
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('cache')}</label>
                                            <select value={disk.cache || ''} onChange={e => {
                                                const newDisks = [...config.additional_disks];
                                                newDisks[idx] = { ...disk, cache: e.target.value };
                                                setConfig({ ...config, additional_disks: newDisks });
                                            }}
                                                className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}>
                                                <option value="">{t('default')}</option>
                                                <option value="directsync">Direct Sync</option>
                                                <option value="writethrough">Write Through</option>
                                                <option value="writeback">Write Back</option>
                                                <option value="none">{t('none')}</option>
                                            </select>
                                        </div>
                                        {disk.type === 'scsi' && (
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('scsiController')}</label>
                                                <select value={disk.scsihw || config.scsihw} onChange={e => {
                                                    const newDisks = [...config.additional_disks];
                                                    newDisks[idx] = { ...disk, scsihw: e.target.value };
                                                    setConfig({ ...config, additional_disks: newDisks });
                                                }}
                                                    className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}>
                                                    <option value="virtio-scsi-pci">VirtIO SCSI</option>
                                                    <option value="virtio-scsi-single">VirtIO Single</option>
                                                    <option value="lsi">LSI 53C895A</option>
                                                    <option value="megasas">MegaRAID SAS</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-4">
                                        <label className="flex items-center gap-2 text-xs text-gray-300">
                                            <input type="checkbox" checked={disk.discard !== false} onChange={e => {
                                                const newDisks = [...config.additional_disks];
                                                newDisks[idx] = { ...disk, discard: e.target.checked };
                                                setConfig({ ...config, additional_disks: newDisks });
                                            }} className="rounded" />
                                            {t('discard')} (TRIM)
                                        </label>
                                        {disk.type === 'scsi' && (
                                            <label className="flex items-center gap-2 text-xs text-gray-300">
                                                <input type="checkbox" checked={disk.iothread !== false} onChange={e => {
                                                    const newDisks = [...config.additional_disks];
                                                    newDisks[idx] = { ...disk, iothread: e.target.checked };
                                                    setConfig({ ...config, additional_disks: newDisks });
                                                }} className="rounded" />
                                                {t('ioThread')}
                                            </label>
                                        )}
                                        <label className="flex items-center gap-2 text-xs text-gray-300">
                                            <input type="checkbox" checked={disk.ssd || false} onChange={e => {
                                                const newDisks = [...config.additional_disks];
                                                newDisks[idx] = { ...disk, ssd: e.target.checked };
                                                setConfig({ ...config, additional_disks: newDisks });
                                            }} className="rounded" />
                                            {t('ssdEmulation')}
                                        </label>
                                    </div>
                                </div>
                            ))}

                            {/* Add Disk Button */}
                            <button onClick={() => setConfig({ ...config, additional_disks: [...config.additional_disks, { type: 'scsi', storage: config.storage, size: '32', format: '', cache: '', discard: true, iothread: true, ssd: false }] })}
                                className="w-full px-4 py-2 border-2 border-dashed border-proxmox-border rounded-lg text-gray-400 hover:text-white hover:border-proxmox-orange transition-colors">
                                + {t('addDisk')}
                            </button>
                        </div>
                    );
                case 4: // Network
                    return (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('bridge')} / VNet</label>
                                    <select value={config.net_bridge} onChange={e => setConfig({ ...config, net_bridge: e.target.value })}
                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                        {/* Local bridges */}
                                        {bridgeList.filter(b => b.source !== 'sdn').length > 0 && (
                                            <optgroup label="Local Bridges">
                                                {bridgeList.filter(b => b.source !== 'sdn').map(b => (
                                                    <option key={b.iface} value={b.iface}>{b.iface}{b.comments ? ` - ${b.comments}` : ''}</option>
                                                ))}
                                            </optgroup>
                                        )}
                                        {/* SDN VNets */}
                                        {bridgeList.filter(b => b.source === 'sdn').length > 0 && (
                                            <optgroup label="SDN VNets">
                                                {bridgeList.filter(b => b.source === 'sdn').map(b => (
                                                    <option key={b.iface} value={b.iface}>{b.iface} - {b.zone || 'SDN'}{b.alias ? ` (${b.alias})` : ''}</option>
                                                ))}
                                            </optgroup>
                                        )}
                                        {bridgeList.length === 0 && <option value="vmbr0">vmbr0</option>}
                                    </select>
                                </div>
                                <div>
                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('model')}</label>
                                    <select value={config.net_model} onChange={e => setConfig({ ...config, net_model: e.target.value })}
                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                        <option value="virtio">VirtIO (paravirtualized)</option>
                                        <option value="e1000">Intel E1000</option>
                                        <option value="rtl8139">Realtek RTL8139</option>
                                        <option value="vmxnet3">VMware vmxnet3</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('vlanTag')}</label>
                                    <input type="text" value={config.net_tag} onChange={e => setConfig({ ...config, net_tag: e.target.value })}
                                        placeholder={t('vlanExample')}
                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                </div>
                                <div>
                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('macAddress')}</label>
                                    <input type="text" value={config.net_macaddr} onChange={e => setConfig({ ...config, net_macaddr: e.target.value })}
                                        placeholder={t('autoGenerate')}
                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                </div>
                            </div>

                            {/* Advanced Network Options */}
                            <details className="group">
                                <summary className="flex items-center justify-between cursor-pointer p-3 bg-green-500/10 border border-green-500/30 rounded-lg hover:bg-green-500/20">
                                    <span className="text-sm font-medium text-green-400">{t('advancedNetwork2')}</span>
                                    <Icons.ChevronDown className="w-4 h-4 text-green-400 group-open:rotate-180 transition-transform" />
                                </summary>
                                <div className="mt-3 space-y-3 p-3 bg-proxmox-dark/50 rounded-lg">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>MTU</label>
                                            <input type="number" min="1" max="65520" value={config.net_mtu} onChange={e => setConfig({ ...config, net_mtu: e.target.value })}
                                                placeholder={t('inheritBridge')}
                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                        </div>
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('rateLimit2')} (MB/s)</label>
                                            <input type="number" min="0" step="0.1" value={config.net_rate} onChange={e => setConfig({ ...config, net_rate: e.target.value })}
                                                placeholder={t('unlimited')}
                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                        </div>
                                    </div>
                                    <label className="flex items-center gap-2 text-sm text-gray-300">
                                        <input type="checkbox" checked={config.net_disconnect} onChange={e => setConfig({ ...config, net_disconnect: e.target.checked })} className="rounded" />
                                        {t('disconnected')} ({t('noLinkOnStart')})
                                    </label>
                                </div>
                            </details>

                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                <input type="checkbox" checked={config.net_firewall} onChange={e => setConfig({ ...config, net_firewall: e.target.checked })} className="rounded" />
                                {t('enableFirewall')}
                            </label>
                        </div>
                    );
                case 5: // Advanced / Options
                    if (isXcpng) {
                        // XCP-ng: simplified options (no BIOS/Machine/SCSI/EFI/TPM)
                        return (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="flex items-center gap-2 text-sm text-gray-300">
                                        <input type="checkbox" checked={config.onboot} onChange={e => setConfig({ ...config, onboot: e.target.checked })} className="rounded" />
                                        {t('startOnBoot')}
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-gray-300">
                                        <input type="checkbox" checked={config.start} onChange={e => setConfig({ ...config, start: e.target.checked })} className="rounded" />
                                        {t('startAfterCreate')}
                                    </label>
                                </div>
                                <div>
                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('description')}</label>
                                    <textarea value={config.description || ''} onChange={e => setConfig({ ...config, description: e.target.value })}
                                        rows="3" placeholder={t('optionalDescription')}
                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white resize-none"} />
                                </div>
                            </div>
                        );
                    }
                    return (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('cpuType')}</label>
                                    <select value={config.cpu} onChange={e => setConfig({ ...config, cpu: e.target.value })}
                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                        {cpuTypes.map(cpu => <option key={cpu} value={cpu}>{cpu}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>BIOS</label>
                                    <select value={config.bios} onChange={e => {
                                        const newBios = e.target.value;
                                        setConfig({
                                            ...config,
                                            bios: newBios,
                                            machine: newBios === 'ovmf' ? 'q35' : config.machine,
                                            efi_storage: newBios === 'ovmf' ? config.storage : ''
                                        });
                                    }}
                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                        <option value="seabios">SeaBIOS (Legacy BIOS)</option>
                                        <option value="ovmf">OVMF (UEFI)</option>
                                    </select>
                                </div>
                            </div>

                            {/* EFI Settings */}
                            {config.bios === 'ovmf' && (
                                <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg space-y-3">
                                    <h4 className="text-sm font-medium text-blue-400">{t('efiSettings')}</h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('efiDiskStorage')}</label>
                                            <select value={config.efi_storage || config.storage} onChange={e => setConfig({ ...config, efi_storage: e.target.value })}
                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                                {diskStorages.map(s => <option key={s.storage} value={s.storage}>{s.storage}</option>)}
                                            </select>
                                        </div>
                                        <div className="flex items-end">
                                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                                <input type="checkbox" checked={config.efi_pre_enroll} onChange={e => setConfig({ ...config, efi_pre_enroll: e.target.checked })} className="rounded" />
                                                {t('preEnrollKeys')}
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* TPM Settings */}
                            <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-medium text-purple-400">{t('tpmSettings')}</h4>
                                    <label className="flex items-center gap-2 text-sm text-gray-300">
                                        <input type="checkbox" checked={!!config.tpm_storage} onChange={e => setConfig({ ...config, tpm_storage: e.target.checked ? config.storage : '' })} className="rounded" />
                                        {t('enableTpm')}
                                    </label>
                                </div>
                                {config.tpm_storage && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('tpmStorage')}</label>
                                            <select value={config.tpm_storage} onChange={e => setConfig({ ...config, tpm_storage: e.target.value })}
                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                                {diskStorages.map(s => <option key={s.storage} value={s.storage}>{s.storage}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('tpmVersion')}</label>
                                            <select value={config.tpm_version} onChange={e => setConfig({ ...config, tpm_version: e.target.value })}
                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                                <option value="v2.0">TPM 2.0 ({t('recommended')})</option>
                                                <option value="v1.2">TPM 1.2</option>
                                            </select>
                                        </div>
                                    </div>
                                )}
                                {config.ostype.startsWith('win11') && !config.tpm_storage && (
                                    <p className="text-xs text-yellow-400">⚠️ {t('win11NeedsTpm')}</p>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('machineType')}</label>
                                    <select value={config.machine} onChange={e => setConfig({ ...config, machine: e.target.value })}
                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                        {config.machine && !machineOpts.some(o => o.value === config.machine) && (
                                            <option value={config.machine}>{config.machine}</option>
                                        )}
                                        <optgroup label="i440fx (Standard)">
                                            {machineOpts.filter(o => o.group === 'i440fx').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </optgroup>
                                        <optgroup label="q35 (Modern, PCIe)">
                                            {machineOpts.filter(o => o.group === 'q35').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </optgroup>
                                    </select>
                                </div>
                                <div>
                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>VGA</label>
                                    <select value={config.vga} onChange={e => setConfig({ ...config, vga: e.target.value })}
                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                        {vgaTypes.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            {/* High Availability Section */}
                            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-medium text-red-400">{t('highAvailability2')}</h4>
                                    <label className="flex items-center gap-2 text-sm text-gray-300">
                                        <input type="checkbox" checked={config.ha_enabled} onChange={e => setConfig({ ...config, ha_enabled: e.target.checked })} className="rounded" />
                                        {t('enableHa')}
                                    </label>
                                </div>
                                {config.ha_enabled && (
                                    <div>
                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('haGroup')}</label>
                                        <input type="text" value={config.ha_group} onChange={e => setConfig({ ...config, ha_group: e.target.value })}
                                            placeholder={t('defaultGroup')}
                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-sm text-gray-300">
                                    <input type="checkbox" checked={config.agent} onChange={e => setConfig({ ...config, agent: e.target.checked })} className="rounded" />
                                    {t('enableQemuAgent')}
                                </label>
                                <label className="flex items-center gap-2 text-sm text-gray-300">
                                    <input type="checkbox" checked={config.onboot} onChange={e => setConfig({ ...config, onboot: e.target.checked })} className="rounded" />
                                    {t('startOnBoot')}
                                </label>
                                <label className="flex items-center gap-2 text-sm text-gray-300">
                                    <input type="checkbox" checked={config.start} onChange={e => setConfig({ ...config, start: e.target.checked })} className="rounded" />
                                    {t('startAfterCreate')}
                                </label>
                            </div>
                        </div>
                    );
            }
        } else {
            return (
                <div className="space-y-4" onClick={() => setContextMenu(null)} onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }); }}>
                    <div className="text-xs text-proxmox-orange mb-2 font-medium">
                        {t('step')} {activeStep + 1}/{steps.length}: {steps[activeStep]}
                    </div>
                    {contextMenu && (
                        <div
                            className="fixed z-50 bg-proxmox-dark border border-proxmox-border rounded-lg shadow-lg py-1 text-xs min-w-[120px]"
                            style={{ top: contextMenu.y, left: contextMenu.x }}
                            onClick={e => e.stopPropagation()}
                        >
                            <button onClick={() => { setContextMenu(null); setActiveStep(Math.max(0, activeStep - 1)); }} className="block w-full text-left px-3 py-2 text-gray-300 hover:bg-proxmox-hover hover:text-white">{t('back')}</button>
                            <button onClick={() => { setContextMenu(null); setActiveStep(0); }} className="block w-full text-left px-3 py-2 text-gray-300 hover:bg-proxmox-hover hover:text-white">{t('reset')}</button>
                            <button onClick={() => { setContextMenu(null); onClose(); }} className="block w-full text-left px-3 py-2 text-gray-300 hover:bg-proxmox-hover hover:text-white">{t('close')}</button>
                        </div>
                    )}
                    {(() => {
                        // LXC Container
                        switch (activeStep) {
                            case 0: // Allgemein
                                return (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>Node</label>
                                                <select value={config.node} onChange={e => setConfig({ ...config, node: e.target.value })}
                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                                    {nodes.map(n => <option key={n} value={n}>{n}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>CT ID</label>
                                                <input type="number" value={config.vmid} onChange={e => setConfig({ ...config, vmid: e.target.value })}
                                                    placeholder={nextVmid ? `Nächste: ${nextVmid}` : ''}
                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                            </div>
                                        </div>
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>Hostname</label>
                                            <input type="text" value={config.name} onChange={e => setConfig({ ...config, name: e.target.value })}
                                                placeholder="my-container"
                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                        </div>
                                    </div>
                                );
                            case 1: // Template
                                return (
                                    <div className="space-y-4">
                                        {recentTemplates.length > 0 && (
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-500 mb-1"}>{t('recentItems')}</label>
                                                <div className="flex flex-wrap gap-2">
                                                    {recentTemplates.map(tpl => {
                                                        const item = templateList.find(t => t.volid === tpl);
                                                        return (
                                                            <button
                                                                key={tpl}
                                                                type="button"
                                                                onClick={() => setConfig({ ...config, template: tpl })}
                                                                className={`text-xs px-2 py-1 rounded border ${config.template === tpl ? 'border-proxmox-orange bg-proxmox-orange/20 text-white' : 'border-proxmox-border bg-proxmox-dark text-gray-300 hover:border-proxmox-orange/50'}`}
                                                            >
                                                                {item?.name || tpl}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>Template</label>
                                            <select value={config.template} onChange={e => setConfig({ ...config, template: e.target.value })}
                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                                <option value="">{t('selectTemplate')}</option>
                                                {templateList.filter(tpl => tpl.type === 'lxc').map(tpl => <option key={tpl.volid} value={tpl.volid}>{tpl.name}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('rootPassword')}</label>
                                            <input type="password" value={config.password} onChange={e => setConfig({ ...config, password: e.target.value })}
                                                placeholder="••••••••"
                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                        </div>

                                        {/* SSH Public Keys */}
                                        <div>
                                            <div className="flex items-center justify-between mb-1">
                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400"}>{t('sshPublicKeys')}</label>
                                                <label className="text-xs text-proxmox-orange cursor-pointer hover:text-orange-400">
                                                    <input
                                                        type="file"
                                                        accept=".pub,.txt"
                                                        className="hidden"
                                                        onChange={(e) => {
                                                            const file = e.target.files[0];
                                                            if (file) {
                                                                const reader = new FileReader();
                                                                reader.onload = (event) => {
                                                                    const content = event.target.result;
                                                                    setConfig(prev => ({
                                                                        ...prev,
                                                                        ssh_public_keys: prev.ssh_public_keys
                                                                            ? prev.ssh_public_keys + '\n' + content.trim()
                                                                            : content.trim()
                                                                    }));
                                                                };
                                                                reader.readAsText(file);
                                                            }
                                                            e.target.value = '';
                                                        }}
                                                    />
                                                    📂 {t('loadSshKeyFile')}
                                                </label>
                                            </div>
                                            <textarea
                                                value={config.ssh_public_keys}
                                                onChange={e => setConfig({ ...config, ssh_public_keys: e.target.value })}
                                                placeholder="ssh-rsa AAAAB3... user@host"
                                                rows={3}
                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm font-mono resize-none"}
                                            />
                                            <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>{t('sshKeyHintMultiple')}</p>
                                        </div>
                                    </div>
                                );
                            case 2: // Ressourcen
                                return (
                                    <div className="space-y-4">
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('cpuCoresLabel')}</label>
                                            <input type="number" min="1" max="128" value={config.cores} onChange={e => setConfig({ ...config, cores: parseInt(e.target.value) })}
                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                        </div>
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>RAM</label>
                                            <div className="flex gap-2">
                                                <input type="number" min={config.memoryUnit === 'GB' ? 0.1 : 16} step={config.memoryUnit === 'GB' ? 0.25 : 64}
                                                    value={config.memoryUnit === 'GB' ? (config.memory / 1024) : config.memory}
                                                    onChange={e => {
                                                        const val = parseFloat(e.target.value) || 0;
                                                        setConfig({ ...config, memory: config.memoryUnit === 'GB' ? Math.round(val * 1024) : val });
                                                    }}
                                                    className={isCorporate ? 'corp-input' : "flex-1 px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                                <select value={config.memoryUnit || 'MB'} onChange={e => setConfig({ ...config, memoryUnit: e.target.value })}
                                                    className="w-20 px-2 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white">
                                                    <option value="MB">MB</option>
                                                    <option value="GB">GB</option>
                                                </select>
                                            </div>
                                            <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>
                                                {config.memoryUnit === 'GB' ? `${config.memory} MB` : `${(config.memory / 1024).toFixed(1)} GB`}
                                            </p>
                                        </div>
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('swapMemory')}</label>
                                            <div className="flex gap-2">
                                                <input type="number" min={config.swapUnit === 'GB' ? 0 : 0} step={config.swapUnit === 'GB' ? 0.25 : 64}
                                                    value={config.swapUnit === 'GB' ? (config.swap / 1024) : config.swap}
                                                    onChange={e => {
                                                        const val = parseFloat(e.target.value) || 0;
                                                        setConfig({ ...config, swap: config.swapUnit === 'GB' ? Math.round(val * 1024) : val });
                                                    }}
                                                    className={isCorporate ? 'corp-input' : "flex-1 px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                                <select value={config.swapUnit || 'MB'} onChange={e => setConfig({ ...config, swapUnit: e.target.value })}
                                                    className="w-20 px-2 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white">
                                                    <option value="MB">MB</option>
                                                    <option value="GB">GB</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                );
                            case 3: // Disk
                                // Helper to render storage bar for LXC
                                const renderLxcStorageBar = (selectedStorage) => {
                                    const storageInfo = storageList.find(s => s.storage === selectedStorage);
                                    if (!storageInfo) return null;
                                    const total = storageInfo.total || storageInfo.maxdisk || 0;
                                    const used = storageInfo.used || storageInfo.disk || 0;
                                    const avail = total - used;
                                    if (total <= 0) return null;
                                    const usedPercent = total > 0 ? (used / total) * 100 : 0;
                                    const freeGB = (avail / 1024 / 1024 / 1024).toFixed(1);
                                    return (
                                        <div className="mt-2">
                                            <div className="flex justify-between text-xs text-gray-500 mb-1">
                                                <span>{freeGB} GB {t('free')}</span>
                                                <span>{usedPercent.toFixed(0)}% {t('used')}</span>
                                            </div>
                                            <div className="h-1.5 bg-proxmox-dark rounded-full overflow-hidden">
                                                <div className={`h-full ${usedPercent > 90 ? 'bg-red-500' : usedPercent > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                                    style={{ width: `${usedPercent}%` }} />
                                            </div>
                                        </div>
                                    );
                                };

                                return (
                                    <div className="space-y-4">
                                        {/* Root Filesystem */}
                                        <div className={isCorporate ? 'corp-settings-card' : "p-4 bg-proxmox-dark/50 rounded-lg border border-proxmox-border"}>
                                            <h4 className="text-sm font-medium text-white mb-3">{t('rootFilesystem')} (rootfs)</h4>
                                            <div className="grid grid-cols-3 gap-4">
                                                <div className="col-span-2">
                                                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>Storage</label>
                                                    <select value={config.storage} onChange={e => setConfig({ ...config, storage: e.target.value })}
                                                        className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}>
                                                        {storageList.map(s => (
                                                            <option key={s.storage} value={s.storage}>
                                                                {s.storage} ({s.type || 'storage'})
                                                            </option>
                                                        ))}
                                                    </select>
                                                    {renderLxcStorageBar(config.storage)}
                                                </div>
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('size')} (GB)</label>
                                                    <input type="number" min="1" value={config.disk_size} onChange={e => setConfig({ ...config, disk_size: e.target.value })}
                                                        className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"} />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Additional Mount Points */}
                                        {config.additional_disks.map((mp, idx) => (
                                            <div key={idx} className={isCorporate ? 'corp-settings-card' : "p-4 bg-proxmox-dark/50 rounded-lg border border-proxmox-border"}>
                                                <div className="flex items-center justify-between mb-3">
                                                    <h4 className="text-sm font-medium text-white">{t('mountPoint')} {idx} (mp{idx})</h4>
                                                    <button onClick={() => setConfig({ ...config, additional_disks: config.additional_disks.filter((_, i) => i !== idx) })}
                                                        className="p-1 text-red-400 hover:bg-red-500/20 rounded">
                                                        <Icons.Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                                <div className="grid grid-cols-4 gap-3">
                                                    <div className="col-span-2">
                                                        <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>Storage</label>
                                                        <select value={mp.storage} onChange={e => {
                                                            const newMps = [...config.additional_disks];
                                                            newMps[idx] = { ...mp, storage: e.target.value };
                                                            setConfig({ ...config, additional_disks: newMps });
                                                        }}
                                                            className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}>
                                                            {storageList.map(s => <option key={s.storage} value={s.storage}>{s.storage} ({s.type || 'storage'})</option>)}
                                                        </select>
                                                        {renderLxcStorageBar(mp.storage)}
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('size')} (GB)</label>
                                                        <input type="number" min="1" value={mp.size} onChange={e => {
                                                            const newMps = [...config.additional_disks];
                                                            newMps[idx] = { ...mp, size: e.target.value };
                                                            setConfig({ ...config, additional_disks: newMps });
                                                        }}
                                                            className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"} />
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('path')}</label>
                                                        <input type="text" value={mp.path || ''} onChange={e => {
                                                            const newMps = [...config.additional_disks];
                                                            newMps[idx] = { ...mp, path: e.target.value };
                                                            setConfig({ ...config, additional_disks: newMps });
                                                        }}
                                                            placeholder="/mnt/data"
                                                            className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"} />
                                                    </div>
                                                </div>
                                                {/* PVE 9.2 mountpoint extras. idmap = inline uid/gid
                                                mapping, format like 'u 0 100000 65536' (uid, host_id, len);
                                                keepattrs = preserve xattr/setuid bits on snapshot + backup.
                                                Pre-9.2 clusters silently ignore both; backend gates the emit. */}
                                                <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-proxmox-border">
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>
                                                            idmap <span className="text-[10px] text-gray-500">PVE 9.2+</span>
                                                        </label>
                                                        <input type="text" value={mp.idmap || ''} onChange={e => {
                                                            const newMps = [...config.additional_disks];
                                                            newMps[idx] = { ...mp, idmap: e.target.value };
                                                            setConfig({ ...config, additional_disks: newMps });
                                                        }}
                                                            placeholder="u 0 100000 65536"
                                                            className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm font-mono"} />
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>
                                                            keepattrs <span className="text-[10px] text-gray-500">PVE 9.2+</span>
                                                        </label>
                                                        <label className="flex items-center gap-2 cursor-pointer pt-1.5">
                                                            <input type="checkbox"
                                                                checked={!!mp.keepattrs}
                                                                onChange={e => {
                                                                    const newMps = [...config.additional_disks];
                                                                    newMps[idx] = { ...mp, keepattrs: e.target.checked };
                                                                    setConfig({ ...config, additional_disks: newMps });
                                                                }}
                                                                className={isCorporate ? 'corp-input' : "rounded border-proxmox-border bg-proxmox-darker"} />
                                                            <span className="text-xs text-gray-300">preserve xattrs / suid on snapshot &amp; backup</span>
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}

                                        {/* Add Mount Point Button */}
                                        <button onClick={() => setConfig({ ...config, additional_disks: [...config.additional_disks, { storage: config.storage, size: '8', path: '/mnt/data' + config.additional_disks.length }] })}
                                            className="w-full px-4 py-2 border-2 border-dashed border-proxmox-border rounded-lg text-gray-400 hover:text-white hover:border-proxmox-orange transition-colors">
                                            + {t('addMountPoint')}
                                        </button>
                                    </div>
                                );
                            case 4: // Netzwerk
                                return (
                                    <div className="space-y-4">
                                        {/* Bridge Selection */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>Bridge / VNet</label>
                                                <select value={config.net_bridge} onChange={e => setConfig({ ...config, net_bridge: e.target.value })}
                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"}>
                                                    {/* Local bridges */}
                                                    {bridgeList.filter(b => b.source !== 'sdn').length > 0 && (
                                                        <optgroup label="Local Bridges">
                                                            {bridgeList.filter(b => b.source !== 'sdn').map(b => (
                                                                <option key={b.iface} value={b.iface}>{b.iface}{b.comments ? ` - ${b.comments}` : ''}</option>
                                                            ))}
                                                        </optgroup>
                                                    )}
                                                    {/* SDN VNets */}
                                                    {bridgeList.filter(b => b.source === 'sdn').length > 0 && (
                                                        <optgroup label="SDN VNets">
                                                            {bridgeList.filter(b => b.source === 'sdn').map(b => (
                                                                <option key={b.iface} value={b.iface}>{b.iface} - {b.zone || 'SDN'}{b.alias ? ` (${b.alias})` : ''}</option>
                                                            ))}
                                                        </optgroup>
                                                    )}
                                                    {bridgeList.length === 0 && <option value="vmbr0">vmbr0</option>}
                                                </select>
                                            </div>
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>VLAN Tag</label>
                                                <input type="text" value={config.net_tag} onChange={e => setConfig({ ...config, net_tag: e.target.value })}
                                                    placeholder={t('optional')}
                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                            </div>
                                        </div>

                                        {/* Advanced Network for LXC */}
                                        <div className="grid grid-cols-3 gap-4">
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('macAddress')}</label>
                                                <input type="text" value={config.net_macaddr} onChange={e => setConfig({ ...config, net_macaddr: e.target.value })}
                                                    placeholder={t('autoGenerate2')}
                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                            </div>
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>MTU</label>
                                                <input type="number" min="1" max="65520" value={config.net_mtu} onChange={e => setConfig({ ...config, net_mtu: e.target.value })}
                                                    placeholder={t('inheritBridge2')}
                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                            </div>
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('rateLimit3')} (MB/s)</label>
                                                <input type="number" min="0" step="0.1" value={config.net_rate} onChange={e => setConfig({ ...config, net_rate: e.target.value })}
                                                    placeholder={t('unlimited')}
                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                            </div>
                                        </div>

                                        {/* IPv4 Configuration */}
                                        <div className="p-3 bg-proxmox-dark/50 rounded-lg border border-proxmox-border">
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="text-sm font-medium text-white">IPv4</span>
                                                <select
                                                    value={config.net_ip_type}
                                                    onChange={e => setConfig({ ...config, net_ip_type: e.target.value, net_ip: e.target.value === 'dhcp' ? 'dhcp' : '' })}
                                                    className={isCorporate ? 'corp-input' : "px-2 py-1 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}
                                                >
                                                    <option value="dhcp">DHCP</option>
                                                    <option value="static">Static</option>
                                                    <option value="manual">{t('manual')}</option>
                                                </select>
                                            </div>
                                            {config.net_ip_type === 'static' && (
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('ipAddress')}</label>
                                                        <input type="text" value={config.net_ip} onChange={e => setConfig({ ...config, net_ip: e.target.value })}
                                                            placeholder="192.168.1.100/24"
                                                            className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"} />
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>Gateway</label>
                                                        <input type="text" value={config.net_gw} onChange={e => setConfig({ ...config, net_gw: e.target.value })}
                                                            placeholder="192.168.1.1"
                                                            className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"} />
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* IPv6 Configuration */}
                                        <div className="p-3 bg-proxmox-dark/50 rounded-lg border border-proxmox-border">
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="text-sm font-medium text-white">IPv6</span>
                                                <select
                                                    value={config.net_ip6_type}
                                                    onChange={e => setConfig({ ...config, net_ip6_type: e.target.value, net_ip6: e.target.value === 'dhcp' ? 'dhcp' : e.target.value === 'slaac' ? 'auto' : '' })}
                                                    className={isCorporate ? 'corp-input' : "px-2 py-1 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"}
                                                >
                                                    <option value="dhcp">DHCP</option>
                                                    <option value="slaac">SLAAC</option>
                                                    <option value="static">Static</option>
                                                    <option value="manual">{t('manual')}</option>
                                                </select>
                                            </div>
                                            {config.net_ip6_type === 'static' && (
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('ipAddress')}</label>
                                                        <input type="text" value={config.net_ip6} onChange={e => setConfig({ ...config, net_ip6: e.target.value })}
                                                            placeholder="2001:db8::100/64"
                                                            className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"} />
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>Gateway</label>
                                                        <input type="text" value={config.net_gw6} onChange={e => setConfig({ ...config, net_gw6: e.target.value })}
                                                            placeholder="2001:db8::1"
                                                            className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"} />
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Network Options */}
                                        <div className="flex flex-wrap gap-4">
                                            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                                <input type="checkbox" checked={config.net_firewall} onChange={e => setConfig({ ...config, net_firewall: e.target.checked })} className="rounded" />
                                                {t('enableFirewall')}
                                            </label>
                                            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                                <input type="checkbox" checked={config.net_disconnected} onChange={e => setConfig({ ...config, net_disconnected: e.target.checked })} className="rounded" />
                                                {t('disconnected')}
                                            </label>
                                        </div>
                                    </div>
                                );
                            case 5: // Optionen
                                return (
                                    <div className="space-y-4">
                                        {/* High Availability Section for LXC */}
                                        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg space-y-3">
                                            <div className="flex items-center justify-between">
                                                <h4 className="text-sm font-medium text-red-400">{t('highAvailability3')}</h4>
                                                <label className="flex items-center gap-2 text-sm text-gray-300">
                                                    <input type="checkbox" checked={config.ha_enabled} onChange={e => setConfig({ ...config, ha_enabled: e.target.checked })} className="rounded" />
                                                    {t('enableHa')}
                                                </label>
                                            </div>
                                            {config.ha_enabled && (
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>{t('haGroup')}</label>
                                                    <input type="text" value={config.ha_group} onChange={e => setConfig({ ...config, ha_group: e.target.value })}
                                                        placeholder={t('defaultGroup')}
                                                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white"} />
                                                </div>
                                            )}
                                        </div>

                                        {/* Container Options */}
                                        <div className="space-y-2">
                                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                                <input type="checkbox" checked={config.unprivileged} onChange={e => setConfig({ ...config, unprivileged: e.target.checked })} className="rounded" />
                                                Unprivileged Container ({t('recommended2')})
                                            </label>
                                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                                <input type="checkbox" checked={config.nesting} onChange={e => setConfig({ ...config, nesting: e.target.checked })} className="rounded" />
                                                Nesting ({t('dockerSupport')})
                                            </label>
                                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                                <input type="checkbox" checked={config.keyctl} onChange={e => setConfig({ ...config, keyctl: e.target.checked })} className="rounded" />
                                                keyctl ({t('keyctlDesc')})
                                            </label>
                                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                                <input type="checkbox" checked={config.fuse} onChange={e => setConfig({ ...config, fuse: e.target.checked })} className="rounded" />
                                                FUSE ({t('fuseDesc')})
                                            </label>
                                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                                <input type="checkbox" checked={config.onboot} onChange={e => setConfig({ ...config, onboot: e.target.checked })} className="rounded" />
                                                {t('startOnBoot')}
                                            </label>
                                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                                <input type="checkbox" checked={config.start} onChange={e => setConfig({ ...config, start: e.target.checked })} className="rounded" />
                                                {t('startAfterCreate')}
                                            </label>
                                        </div>

                                        {/* DNS Settings */}
                                        <div className="p-3 bg-proxmox-dark/50 rounded-lg border border-proxmox-border">
                                            <h4 className="text-sm font-medium text-white mb-3">DNS</h4>
                                            <div className="space-y-3">
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('dnsDomain')}</label>
                                                    <input type="text" value={config.dns_domain} onChange={e => setConfig({ ...config, dns_domain: e.target.value })}
                                                        placeholder={t('useHostSettings')}
                                                        className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"} />
                                                </div>
                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('dnsServers')}</label>
                                                    <input type="text" value={config.dns_servers} onChange={e => setConfig({ ...config, dns_servers: e.target.value })}
                                                        placeholder={t('useHostSettings2')}
                                                        className={isCorporate ? 'corp-input' : "w-full px-2 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-white text-sm"} />
                                                    <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>{t('dnsServersHint')}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                        }
                    })()}
                </div>
            );
        }
    };

    const renderLivePreview = () => (
        <div className={`mb-4 p-3 border border-proxmox-border rounded-lg ${isCorporate ? 'bg-white/5' : 'bg-proxmox-dark'}`}>
            <h4 className="text-xs font-semibold text-proxmox-orange mb-2 uppercase tracking-wider">{t('preview')}</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-gray-400">{t('name')}</div>
                <div className="text-gray-200 truncate">{config.name || '-'}</div>
                <div className="text-gray-400">{t('node')}</div>
                <div className="text-gray-200">{config.node || '-'}</div>
                <div className="text-gray-400">{t('vmid')}</div>
                <div className="text-gray-200">{config.vmid || '-'}</div>
                <div className="text-gray-400">{t('memory')}</div>
                <div className="text-gray-200">{config.memory} MB</div>
                <div className="text-gray-400">{t('disk')}</div>
                <div className="text-gray-200">{config.disk_size} GB</div>
                <div className="text-gray-400">{t('network')}</div>
                <div className="text-gray-200">{config.net_bridge || '-'}</div>
            </div>
        </div>
    );

    // May 2026: Corporate path got a corporate chrome upgrade.
    // The previous setup mixed corp-modal-header with bg-proxmox-card
    // outer + Modern-styled steps/footer, which looked unfinished
    // under the Corporate light theme. Both code paths are kept
    // explicit (isCorporate vs Modern) so they don't tangle.
    if (isCorporate) {
        return (
            <div className="corp-vm-modal-overlay">
                <div className="corp-vm-modal" style={{ maxWidth: '760px' }}>
                    <div className="corp-vm-modal-header">
                        <div className="corp-vm-modal-header-left">
                            <span className={`corp-vm-type-pill ${isQemu ? '' : 'lxc'}`}>{isQemu ? 'VM' : 'CT'}</span>
                            <div className="corp-vm-modal-title-block">
                                <h2 className="corp-vm-modal-title">
                                    {isQemu ? (t('createVm2')) : (t('createContainer2'))}
                                </h2>
                                <div className="corp-vm-modal-meta">
                                    <span>{isQemu ? 'QEMU/KVM' : 'LXC'}</span>
                                    <span className="corp-meta-sep">·</span>
                                    <span>{t('step')} {activeStep + 1} / {steps.length}</span>
                                    {nextVmid && (
                                        <>
                                            <span className="corp-meta-sep">·</span>
                                            <span>{t('vmid')} {nextVmid}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="corp-vm-modal-actions">
                            <button onClick={onClose} className="corp-vm-btn corp-vm-btn-ghost">
                                {t('close')}
                            </button>
                        </div>
                    </div>

                    {nodes.length === 0 && (
                        <div className="corp-vm-modal-warning">
                            <Icons.AlertTriangle className="w-3.5 h-3.5" />
                            <span>{t('noNodesAvailable')}</span>
                        </div>
                    )}

                    {/* Steps as a numbered stepper, corporate flat style */}
                    <div className="corp-vm-stepper">
                        {steps.map((step, idx) => {
                            const cls = idx === activeStep ? 'active' : (idx < activeStep ? 'done' : 'todo');
                            return (
                                <button
                                    key={step}
                                    onClick={() => setActiveStep(idx)}
                                    className={`corp-vm-step ${cls}`}
                                    disabled={idx > activeStep}
                                >
                                    <span className="corp-vm-step-num">{idx < activeStep ? '✓' : idx + 1}</span>
                                    <span className="corp-vm-step-label">{step}</span>
                                    {idx < steps.length - 1 && <span className="corp-vm-step-line" />}
                                </button>
                            );
                        })}
                    </div>

                    <div className="corp-vm-modal-body" style={{ minHeight: '320px' }}>
                        {storageList.length === 0 && config.node && (
                            <p style={{ fontSize: '11.5px', color: 'var(--corp-text-muted)', margin: '0 0 12px' }}>
                                {t('loadingStorage')} ({t('node')}: {config.node})
                            </p>
                        )}
                        {renderLivePreview()}
                        {renderStepContent()}
                    </div>

                    {/* Cancel left, Back+Next right.
                                Was Cancel directly next to Next which is a misclick footgun. */}
                    <div className="corp-vm-modal-footer">
                        <button onClick={onClose} className="corp-vm-btn corp-vm-btn-ghost">
                            {t('cancel')}
                        </button>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                onClick={() => setActiveStep(Math.max(0, activeStep - 1))}
                                disabled={activeStep === 0}
                                className="corp-vm-btn corp-vm-btn-ghost"
                            >
                                {t('back')}
                            </button>
                            {activeStep < steps.length - 1 ? (
                                <button
                                    onClick={() => { if (validateStep(activeStep)) setActiveStep(activeStep + 1); }}
                                    className="corp-vm-btn corp-vm-btn-primary"
                                >
                                    {t('next')}
                                </button>
                            ) : lastCreatedLxc ? (
                                <button
                                    onClick={handleUndoLxc}
                                    disabled={loading}
                                    className="corp-vm-btn corp-vm-btn-danger"
                                >
                                    {loading && <Icons.RotateCw className="w-3.5 h-3.5 animate-spin" />}
                                    {t('remove')} CT {lastCreatedLxc.vmid}
                                </button>
                            ) : (
                                <button
                                    onClick={handleCreate}
                                    disabled={loading || (!isQemu && !config.template)}
                                    className="corp-vm-btn corp-vm-btn-create"
                                >
                                    {loading && <Icons.RotateCw className="w-3.5 h-3.5 animate-spin" />}
                                    {isQemu ? (t('createVm3')) : (t('createContainer3'))}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
            <div className="w-full max-w-2xl bg-proxmox-card border border-proxmox-border shadow-2xl overflow-hidden rounded-xl animate-scale-in">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-proxmox-border bg-proxmox-dark px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${isQemu ? 'bg-blue-500/10' : 'bg-purple-500/10'}`}>
                            {isQemu ? <Icons.VM /> : <Icons.Container />}
                        </div>
                        <h2 className={isCorporate ? 'corp-card-header' : "font-semibold text-white"}>
                            {isQemu ? t('createVm') : t('createContainer')}
                        </h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-proxmox-hover rounded-lg text-gray-400 hover:text-white">
                        <Icons.X />
                    </button>
                </div>

                {/* No nodes warning */}
                {nodes.length === 0 && (
                    <div className="p-4 bg-yellow-500/10 border-b border-yellow-500/30">
                        <p className="text-yellow-400 text-sm">
                            ⚠️ {t('noNodesAvailable')}
                        </p>
                    </div>
                )}

                {/* Debug info */}
                {storageList.length === 0 && config.node && (
                    <div className="px-6 pt-2">
                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>
                            {t('loadingStorage2')} (Node: {config.node})
                        </p>
                    </div>
                )}

                {/* Steps Navigation */}
                <div className="flex border-b border-proxmox-border bg-proxmox-dark/50">
                    {steps.map((step, idx) => (
                        <button
                            key={step}
                            onClick={() => setActiveStep(idx)}
                            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${activeStep === idx
                                ? 'text-proxmox-orange border-b-2 border-proxmox-orange'
                                : 'text-gray-400 hover:text-white'
                                }`}
                        >
                            {step}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="p-6 min-h-[300px]">
                    {renderLivePreview()}
                    {renderStepContent()}
                </div>

                {/* Footer */}
                {/* Cancel left, Back+Next right (misclick safety) */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-proxmox-border bg-proxmox-dark">
                    <button onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white">
                        {t('cancel')}
                    </button>
                    <div className="flex gap-3">
                        <button
                            onClick={() => setActiveStep(Math.max(0, activeStep - 1))}
                            disabled={activeStep === 0}
                            className="px-4 py-2 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {t('back')}
                        </button>
                        {activeStep < steps.length - 1 ? (
                            <button
                                onClick={() => { if (validateStep(activeStep)) setActiveStep(activeStep + 1); }}
                                className="px-4 py-2 bg-proxmox-orange rounded-lg text-white hover:bg-orange-600"
                            >
                                {t('next')}
                            </button>
                        ) : lastCreatedLxc ? (
                            <button
                                onClick={handleUndoLxc}
                                disabled={loading}
                                className="flex items-center gap-2 px-4 py-2 bg-red-600 rounded-lg text-white hover:bg-red-700 disabled:opacity-50"
                            >
                                {loading && <Icons.RotateCw className="w-4 h-4 animate-spin" />}
                                {t('remove')} CT {lastCreatedLxc.vmid}
                            </button>
                        ) : (
                            <button
                                onClick={handleCreate}
                                disabled={loading || (!isQemu && !config.template)}
                                className="flex items-center gap-2 px-4 py-2 bg-green-600 rounded-lg text-white hover:bg-green-700 disabled:opacity-50"
                            >
                                {loading && <Icons.RotateCw className="w-4 h-4 animate-spin" />}
                                {isQemu ? t('createVm') : t('createContainer')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Add Cluster Modal
// Wizard for adding new Proxmox clusters
// Defaults are pretty sensible, most users just need host + credentials
function AddClusterModal({ isOpen, onClose, onSubmit, onAddPBS, onAddVMware, loading, error, initialType = 'proxmox', reconfigureConfig = null }) {
    const { t } = useTranslation();
    const { isCorporate } = useLayout();
    const [connectionType, setConnectionType] = useState(initialType);

    // Sync with initialType when modal opens with different type
    useEffect(() => {
        if (isOpen) setConnectionType(initialType);
        // #256: pre-fill config for re-configure
        if (isOpen && reconfigureConfig) {
            setConnectionType(reconfigureConfig.cluster_type || 'proxmox');
            const rc = reconfigureConfig;
            setConfig(prev => ({ ...prev, name: rc.name || '', host: rc.host || '', api_port: rc.api_port || 8006, user: rc.user || '', pass: '', ssl_verification: rc.ssl_verification || false, migration_threshold: rc.migration_threshold || 20, migration_tolerance: rc.migration_tolerance || 10, check_interval: rc.check_interval || 300, auto_migrate: rc.auto_migrate || false, balance_containers: rc.balance_containers || false, balance_local_disks: rc.balance_local_disks || false, dry_run: rc.dry_run || false, ssh_key: '' }));
        }
    }, [isOpen, initialType, reconfigureConfig]);

    // Proxmox config
    const [config, setConfig] = useState({
        name: '', host: '', api_port: 8006, user: 'root@pam', pass: '',
        ssl_verification: false, migration_threshold: 20, migration_tolerance: 10, check_interval: 300,
        auto_migrate: false, balance_containers: false, balance_local_disks: false,
        dry_run: false, ssh_key: '',
        predictive_balancing: false, predictive_threshold: 75,
        balance_cpu_weight: 1.0, balance_mem_weight: 1.0, balance_io_weight: 0.0,
        cpu_baseline: null,
    });
    const [showSshSettings, setShowSshSettings] = useState(false);

    // PBS config
    const [pbsConfig, setPbsConfig] = useState({
        name: '', host: '', port: 8007, user: 'root@pam', password: '',
        api_token_id: '', api_token_secret: '', fingerprint: '',
        ssl_verify: false, linked_clusters: [], notes: '',
        ssh_user: '', ssh_port: 22, ssh_key: '',
    });
    const [showPbsSshSettings, setShowPbsSshSettings] = useState(false);

    // VMware config
    const [vmwConfig, setVmwConfig] = useState({
        name: '', host: '', port: 443, username: 'root', password: '',
        ssl_verify: false, notes: '',
    });

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (connectionType === 'proxmox') onSubmit(config);
        else if (connectionType === 'pbs') onAddPBS(pbsConfig);
        else if (connectionType === 'vmware') onAddVMware(vmwConfig);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop bg-black/60" onClick={onClose}>
            <div
                className="w-full max-w-lg bg-proxmox-card border border-proxmox-border rounded-2xl shadow-2xl animate-scale-in overflow-hidden max-h-[90vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-6 border-b border-proxmox-border">
                    <h2 className={isCorporate ? 'corp-card-header' : "text-xl font-bold text-white"}>{reconfigureConfig ? (t('reconfigureCluster')) : t('addCluster')}</h2>
                    <div className="flex gap-2 mt-3">
                        {[
                            { id: 'proxmox', label: 'Proxmox VE', icon: Icons.Server, active: 'bg-orange-500/20 text-orange-400 border-orange-500/40', inactive: 'bg-proxmox-dark text-gray-500 border-transparent hover:text-gray-300 hover:border-proxmox-border' },
                            { id: 'pbs', label: 'PBS', icon: Icons.Shield, active: 'bg-blue-500/20 text-blue-400 border-blue-500/40', inactive: 'bg-proxmox-dark text-gray-500 border-transparent hover:text-gray-300 hover:border-proxmox-border' },
                            { id: 'vmware', label: 'ESXi', icon: Icons.Cloud, active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40', inactive: 'bg-proxmox-dark text-gray-500 border-transparent hover:text-gray-300 hover:border-proxmox-border' },
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setConnectionType(tab.id)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${connectionType === tab.id ? tab.active : tab.inactive
                                    }`}
                            >
                                <tab.icon className="w-3.5 h-3.5" />
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                {error && (
                    <div className="mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {/* ===== PROXMOX VE FORM ===== */}
                    {connectionType === 'proxmox' && (<>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>{t('clusterName')}</label>
                                <input type="text" value={config.name} onChange={e => setConfig({ ...config, name: e.target.value })} required
                                    className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-proxmox-orange transition-colors"}
                                    placeholder="Production Cluster" />
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>{t('host')}</label>
                                <input type="text" value={config.host} onChange={e => setConfig({ ...config, host: e.target.value })} required
                                    className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-proxmox-orange transition-colors"}
                                    placeholder="proxmox.example.com" />
                            </div>
                        </div>
                        {/* API-port override. Default 8006; override only if your PVE listens elsewhere.
                                We never go through a reverse proxy — direct TLS to PVE, no MitM-able middlebox. */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>{t('apiPort')}</label>
                                <input type="number" value={config.api_port}
                                    onChange={e => setConfig({ ...config, api_port: parseInt(e.target.value) || 8006 })}
                                    min="1" max="65535"
                                    className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-proxmox-orange transition-colors"}
                                    placeholder="8006" />
                                <p className={isCorporate ? 'corp-help-text' : "mt-1 text-xs text-gray-500"}>{t('apiPortHint2')}</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>{t('username')}</label>
                                <input type="text" value={config.user} onChange={e => setConfig({ ...config, user: e.target.value })} required
                                    className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-proxmox-orange transition-colors"}
                                    placeholder="root@pam or user@pam!tokenid" />
                                <p className={isCorporate ? 'corp-help-text' : "mt-1 text-xs text-gray-500"}>{t('apiTokenHint2')}</p>
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>{t('passwordOrToken') || t('password')}</label>
                                <input type="password" value={config.pass} onChange={e => setConfig({ ...config, pass: e.target.value })}
                                    className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-proxmox-orange transition-colors"}
                                    placeholder={config.user.includes('!') ? 'Token Secret' : 'Password'} />
                            </div>
                        </div>

                        {config.user.includes('!') && (
                            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                                <div className="flex items-start gap-3">
                                    <Icons.AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-medium text-yellow-200">{t('apiTokenWarningTitle')}</p>
                                        <p className="text-sm text-yellow-300/80 mt-1">{t('apiTokenWarningDesc')}</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="pt-4 border-t border-proxmox-border">
                            <button type="button" onClick={() => setShowSshSettings(!showSshSettings)}
                                className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
                                <Icons.ChevronRight className={`w-3 h-3 transform transition-transform ${showSshSettings ? 'rotate-90' : ''}`} />
                                {t('sshKeyOptional')}
                            </button>
                            {showSshSettings && (
                                <div className="mt-4 space-y-4 p-4 bg-proxmox-dark/50 rounded-lg">
                                    <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-400"}>{t('sshKeyExplanation2')}</p>
                                    <textarea value={config.ssh_key} onChange={e => setConfig({ ...config, ssh_key: e.target.value })}
                                        className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-proxmox-orange transition-colors font-mono text-xs"}
                                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" rows={4} />
                                </div>
                            )}
                        </div>

                        <div className="space-y-4 pt-4 border-t border-proxmox-border">
                            <Slider label={t('migrationThreshold')} description={t('migrationThresholdDesc')} value={config.migration_threshold}
                                onChange={v => setConfig({ ...config, migration_threshold: v })} min={5} max={100} />
                            <Slider label={t('checkInterval')} description={t('checkIntervalDesc')} value={config.check_interval}
                                onChange={v => setConfig({ ...config, check_interval: v })} min={60} max={3600} step={60} unit="s" />
                        </div>

                        <div className="flex flex-wrap gap-4 pt-4 border-t border-proxmox-border">
                            <Toggle checked={config.ssl_verification} onChange={v => setConfig({ ...config, ssl_verification: v })} label={t('sslVerification')} />
                            <Toggle checked={config.auto_migrate} onChange={v => setConfig({ ...config, auto_migrate: v })} label={t('autoMigrate')} />
                            <Toggle checked={config.dry_run} onChange={v => setConfig({ ...config, dry_run: v })} label={t('dryRunShort')} />
                        </div>

                        <div className="pt-4 border-t border-proxmox-border">
                            <div className="flex items-start gap-3">
                                <Toggle checked={config.balance_containers} onChange={v => setConfig({ ...config, balance_containers: v })} label={t('balanceContainers')} />
                            </div>
                            <div className="flex items-start gap-3 pt-3 mt-3 border-t border-gray-700/50">
                                <Toggle checked={config.balance_local_disks} onChange={v => setConfig({ ...config, balance_local_disks: v })} label={t('balanceLocalDisks')} />
                            </div>
                            <div className="text-xs text-gray-500 mt-1">{t('balanceLocalDisksDesc')}</div>
                        </div>
                    </>)}



                    {/* ===== PBS FORM ===== */}
                    {connectionType === 'pbs' && (<>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>{t('name')}</label>
                                <input type="text" value={pbsConfig.name} onChange={e => setPbsConfig({ ...pbsConfig, name: e.target.value })} required
                                    className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-400 transition-colors"}
                                    placeholder="Backup Server 1" />
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>{t('host')}</label>
                                <input type="text" value={pbsConfig.host} onChange={e => setPbsConfig({ ...pbsConfig, host: e.target.value })} required
                                    className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-400 transition-colors"}
                                    placeholder="pbs.example.com" />
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>{t('username')}</label>
                                <input type="text" value={pbsConfig.user} onChange={e => setPbsConfig({ ...pbsConfig, user: e.target.value })} required
                                    className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-400 transition-colors"}
                                    placeholder="root@pam" />
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>{t('password')}</label>
                                <input type="password" value={pbsConfig.password} onChange={e => setPbsConfig({ ...pbsConfig, password: e.target.value })} required
                                    className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-400 transition-colors"}
                                    placeholder="Password" />
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>Port</label>
                                <input type="number" value={pbsConfig.port} onChange={e => setPbsConfig({ ...pbsConfig, port: parseInt(e.target.value) || 8007 })}
                                    className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white focus:outline-none focus:border-blue-400 transition-colors"} />
                            </div>
                        </div>
                        <div>
                            <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>Fingerprint ({t('optional2')})</label>
                            <input type="text" value={pbsConfig.fingerprint} onChange={e => setPbsConfig({ ...pbsConfig, fingerprint: e.target.value })}
                                className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-400 transition-colors font-mono text-xs"}
                                placeholder="XX:XX:XX:..." />
                        </div>
                        <div>
                            <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>{t('notes')} ({t('optional3')})</label>
                            <input type="text" value={pbsConfig.notes} onChange={e => setPbsConfig({ ...pbsConfig, notes: e.target.value })}
                                className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-400 transition-colors"}
                                placeholder="Backup for production cluster" />
                        </div>

                        {/* Apr 2026: SSH settings - needed for running apt upgrade on the PBS host */}
                        <div className="pt-4 border-t border-proxmox-border">
                            <button type="button" onClick={() => setShowPbsSshSettings(!showPbsSshSettings)}
                                className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
                                <Icons.ChevronRight className={`w-3 h-3 transform transition-transform ${showPbsSshSettings ? 'rotate-90' : ''}`} />
                                {t('sshKeyOptional2')}
                            </button>
                            {showPbsSshSettings && (
                                <div className="mt-4 space-y-3 p-4 bg-proxmox-dark/50 rounded-lg">
                                    <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-400"}>
                                        {t('pbsSshHint')}
                                    </p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('sshUser')}</label>
                                            <input type="text" value={pbsConfig.ssh_user} onChange={e => setPbsConfig({ ...pbsConfig, ssh_user: e.target.value })}
                                                placeholder="root"
                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"} />
                                        </div>
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('sshPort')}</label>
                                            <input type="number" value={pbsConfig.ssh_port} onChange={e => setPbsConfig({ ...pbsConfig, ssh_port: parseInt(e.target.value) || 22 })}
                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"} />
                                        </div>
                                    </div>
                                    <div>
                                        <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>{t('sshPrivateKey')}</label>
                                        <textarea value={pbsConfig.ssh_key} onChange={e => setPbsConfig({ ...pbsConfig, ssh_key: e.target.value })}
                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 font-mono text-xs"}
                                            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" rows={4} />
                                    </div>
                                </div>
                            )}
                        </div>
                    </>)}

                    {/* ===== VMWARE FORM ===== */}
                    {connectionType === 'vmware' && (<>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>{t('name')}</label>
                                <input type="text" value={vmwConfig.name} onChange={e => setVmwConfig({ ...vmwConfig, name: e.target.value })} required
                                    className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400 transition-colors"}
                                    placeholder="ESXi Host 1" />
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>{t('host')}</label>
                                <input type="text" value={vmwConfig.host} onChange={e => setVmwConfig({ ...vmwConfig, host: e.target.value })} required
                                    className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400 transition-colors"}
                                    placeholder="esxi.example.com" />
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>{t('username')}</label>
                                <input type="text" value={vmwConfig.username} onChange={e => setVmwConfig({ ...vmwConfig, username: e.target.value })} required
                                    className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400 transition-colors"}
                                    placeholder="root" />
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>{t('password')}</label>
                                <input type="password" value={vmwConfig.password} onChange={e => setVmwConfig({ ...vmwConfig, password: e.target.value })} required
                                    className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400 transition-colors"}
                                    placeholder="Password" />
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>Port</label>
                                <input type="number" value={vmwConfig.port} onChange={e => setVmwConfig({ ...vmwConfig, port: parseInt(e.target.value) || 443 })}
                                    className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white focus:outline-none focus:border-emerald-400 transition-colors"} />
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <Toggle checked={vmwConfig.ssl_verify} onChange={v => setVmwConfig({ ...vmwConfig, ssl_verify: v })} label={t('sslVerification')} />
                        </div>
                        <div>
                            <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-300 mb-2"}>{t('notes')} ({t('optional4')})</label>
                            <input type="text" value={vmwConfig.notes} onChange={e => setVmwConfig({ ...vmwConfig, notes: e.target.value })}
                                className={isCorporate ? 'corp-input' : "w-full px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400 transition-colors"}
                                placeholder="Production ESXi host" />
                        </div>
                    </>)}

                    <div className="flex gap-3 pt-4 border-t border-proxmox-border">
                        <button type="button" onClick={onClose}
                            className="flex-1 px-4 py-2.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-gray-300 font-medium hover:bg-proxmox-hover transition-colors">
                            {t('cancel')}
                        </button>
                        <button type="submit" disabled={loading}
                            className={`flex-1 px-4 py-2.5 rounded-lg text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${connectionType === 'pbs' ? 'bg-blue-500 hover:bg-blue-600'
                                : connectionType === 'vmware' ? 'bg-emerald-500 hover:bg-emerald-600'
                                    : 'bg-proxmox-orange hover:bg-orange-600'
                                }`}>
                            {loading ? t('connecting') : reconfigureConfig ? (t('reconfigure'))
                                : connectionType === 'pbs' ? (t('addPbsServer'))
                                    : connectionType === 'vmware' ? (t('addVmwareServer'))
                                        : t('addCluster')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// User Profile Modal with Password Change and 2FA Setup
function UserProfileModal({ isOpen, onClose, addToast }) {
    const { t } = useTranslation();
    const { getAuthHeaders, user, updatePreferences, updateCurrentUser } = useAuth();
    const { isCorporate } = useLayout();
    const [activeTab, setActiveTab] = useState('appearance');
    const [loading, setLoading] = useState(false);
    const [selectedTheme, setSelectedTheme] = useState(user?.theme || 'proxmoxDark');
    const [avatarUploading, setAvatarUploading] = useState(false);
    const avatarInputRef = React.useRef(null);

    // Password change
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // 2FA setup
    const [twoFAStatus, setTwoFAStatus] = useState({ enabled: false, available: false });
    const [setupData, setSetupData] = useState(null);
    const [totpCode, setTotpCode] = useState('');
    const [disablePassword, setDisablePassword] = useState('');

    // API Token management
    const [tokens, setTokens] = useState([]);
    const [tokensLoading, setTokensLoading] = useState(false);
    const [newTokenName, setNewTokenName] = useState('');
    const [newTokenRole, setNewTokenRole] = useState('');
    const [newTokenExpiry, setNewTokenExpiry] = useState('');
    const [createdToken, setCreatedToken] = useState(null);
    const [tokenCopied, setTokenCopied] = useState(false);

    // Password Policy state
    const [passwordPolicy, setPasswordPolicy] = useState({
        min_length: 8,
        require_uppercase: true,
        require_lowercase: true,
        require_numbers: true,
        require_special: false
    });

    // Stable VNC Mode toggle was reading localStorage on
    // each render but had no React state, so flipping it didn't trigger
    // a re-render and the knob/colour stayed on the previous value
    // until the modal was reopened. Mirror localStorage in state.
    const [stableVncOn, setStableVncOn] = useState(
        typeof window !== 'undefined' &&
        window.localStorage &&
        window.localStorage.getItem('ProxmoxVEx-vnc-stable-mode') === '1'
    );

    // Generate password policy hint text
    const getPasswordPolicyHint = () => {
        const hints = [];
        hints.push(`${t('minChars')} ${passwordPolicy.min_length} ${t('characters')}`);
        if (passwordPolicy.require_uppercase) hints.push(t('uppercase'));
        if (passwordPolicy.require_lowercase) hints.push(t('lowercase'));
        if (passwordPolicy.require_numbers) hints.push(t('numbers'));
        if (passwordPolicy.require_special) hints.push(t('specialChar'));
        return hints.join(', ');
    };

    // Fetch password policy
    const fetchPasswordPolicy = async () => {
        try {
            const r = await fetch(`${API_URL}/password-policy`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) {
                const data = await r.json();
                setPasswordPolicy(data);
            }
        } catch (e) {
            console.error('Failed to fetch password policy:', e);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetch2FAStatus();
            fetchPasswordPolicy();
            fetchTokens();  // Load API tokens
        }
    }, [isOpen]);

    const handleAvatarSelected = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Browsers sometimes report an empty MIME type even for valid image
        // files, so also fall back to the file extension before rejecting.
        const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
        const allowedExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
        const fileName = file.name || '';
        const hasAllowedMime = file.type && allowedMimeTypes.includes(file.type);
        const hasAllowedExt = allowedExtensions.some(ext => fileName.toLowerCase().endsWith(ext));

        if (!hasAllowedMime && !hasAllowedExt) {
            if (addToast) addToast(`Unsupported image type: ${file.type || 'unknown'}. Please choose PNG, JPEG, GIF, or WebP.`, 'error');
            e.target.value = '';
            return;
        }

        if (file.size > 512 * 1024) {
            if (addToast) addToast(`Avatar image must be 512 KB or smaller (this file is ${(file.size / 1024).toFixed(1)} KB).`, 'error');
            e.target.value = '';
            return;
        }

        setAvatarUploading(true);
        try {
            const avatarDataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Failed to read image'));
                reader.onabort = () => reject(new Error('Image read was cancelled'));
                reader.readAsDataURL(file);
            });

            // Decode the image in the browser before uploading. This catches
            // corrupted files or formats the browser cannot render (e.g. some
            // WebP variants), so the user gets feedback instead of a silent no-op.
            await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = resolve;
                img.onerror = () => reject(new Error('The selected image could not be loaded. It may be corrupted or in an unsupported format.'));
                img.src = avatarDataUrl;
            });

            const response = await fetch(`${API_URL}/user/avatar`, {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders()
                },
                body: JSON.stringify({ avatar: avatarDataUrl })
            });

            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                updateCurrentUser({ avatar_url: data.avatar_url || '' });
                if (addToast) addToast('Avatar updated', 'success');
            } else {
                if (addToast) addToast(data.error || `Failed to update avatar (HTTP ${response.status})`, 'error');
            }
        } catch (err) {
            console.error('Avatar upload error:', err);
            if (addToast) addToast(err.message || 'Failed to update avatar', 'error');
        } finally {
            setAvatarUploading(false);
            e.target.value = '';
        }
    };

    const handleAvatarRemove = async () => {
        setAvatarUploading(true);
        try {
            const response = await fetch(`${API_URL}/user/avatar`, {
                method: 'DELETE',
                credentials: 'include',
                headers: getAuthHeaders()
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                updateCurrentUser({ avatar_url: '' });
                addToast('Avatar removed', 'success');
            } else {
                addToast(data.error || 'Failed to remove avatar', 'error');
            }
        } catch (err) {
            addToast(err.message || 'Failed to remove avatar', 'error');
        }
        setAvatarUploading(false);
    };

    // API Token management functions
    const fetchTokens = async () => {
        setTokensLoading(true);
        try {
            const response = await fetch(`${API_URL}/auth/tokens`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (response.ok) {
                const data = await response.json();
                setTokens(data.tokens || []);
            }
        } catch (e) { console.error('fetchTokens error:', e); }
        finally { setTokensLoading(false); }
    };

    const createToken = async () => {
        if (!newTokenName.trim()) return;
        setLoading(true);
        try {
            const body = { name: newTokenName.trim() };
            if (newTokenRole) body.role = newTokenRole;
            if (newTokenExpiry) body.expires_days = parseInt(newTokenExpiry);

            const response = await fetch(`${API_URL}/auth/tokens`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (data.success) {
                setCreatedToken(data.token);
                setNewTokenName(''); setNewTokenRole(''); setNewTokenExpiry('');
                fetchTokens();
                if (addToast) addToast('Token created - copy it now, it won\'t be shown again!', 'warning');
            } else {
                if (addToast) addToast(data.error || 'Failed to create token', 'error');
            }
        } catch (e) { if (addToast) addToast('Network error', 'error'); }
        finally { setLoading(false); }
    };

    const revokeToken = async (tokenId) => {
        try {
            const response = await fetch(`${API_URL}/auth/tokens/${tokenId}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (response.ok) {
                fetchTokens();
                if (addToast) addToast('Token revoked', 'success');
            }
        } catch (e) { if (addToast) addToast('Failed to revoke token', 'error'); }
    };

    const copyToken = (token) => {
        navigator.clipboard.writeText(token).then(() => {
            setTokenCopied(true);
            setTimeout(() => setTokenCopied(false), 3000);
        });
    };

    const fetch2FAStatus = async () => {
        try {
            const response = await fetch(`${API_URL}/auth/2fa/status`, {
                credentials: 'include',  // Fix - need cookies for session auth
                headers: getAuthHeaders()
            });
            if (response && response.ok) {
                setTwoFAStatus(await response.json());
            }
        } catch (err) {
            console.error('fetching 2FA status:', err);
        }
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            addToast(t('passwordsDoNotMatch'), 'error');
            return;
        }
        if (newPassword.length < 4) {
            addToast(t('passwordTooShort'), 'error');
            return;
        }

        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/auth/change-password`, {
                method: 'POST',
                credentials: 'include',  // Fix - need cookies for session auth
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders()
                },
                body: JSON.stringify({
                    current_password: currentPassword,
                    new_password: newPassword
                })
            });

            if (response && response.ok) {
                const data = await response.json().catch(() => ({}));
                setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
                // 2026-04-24 - server now invalidates ALL user sessions on password
                // change (incl. the current one). Force a hard redirect to login so the
                // user can't keep clicking in a dead UI.
                if (data.relogin_required) {
                    addToast(t('passwordChangedReloginRequired2'), 'success');
                    // give the toast a breath, then hard-reload to wash out in-memory state
                    setTimeout(() => { window.location.href = '/'; }, 1200);
                } else {
                    addToast(t('passwordResetSuccess'), 'success');
                }
            } else {
                const data = await response.json();
                addToast(data.error || 'Error', 'error');
            }
        } catch (err) {
            addToast(t('connectionError'), 'error');
        }
        setLoading(false);
    };

    const handleSetup2FA = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/auth/2fa/setup`, {
                method: 'POST',
                credentials: 'include',  // Fix - need cookies for session auth
                headers: getAuthHeaders()
            });

            if (response && response.ok) {
                setSetupData(await response.json());
            } else {
                const data = await response.json();
                addToast(data.error || 'Error', 'error');
            }
        } catch (err) {
            addToast(t('connectionError'), 'error');
        }
        setLoading(false);
    };

    const handleVerify2FA = async () => {
        if (totpCode.length !== 6) return;

        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/auth/2fa/verify`, {
                method: 'POST',
                credentials: 'include',  // Fix - need cookies for session auth
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders()
                },
                body: JSON.stringify({ code: totpCode })
            });

            if (response && response.ok) {
                addToast(t('twoFactorEnabled'), 'success');
                setSetupData(null);
                setTotpCode('');
                fetch2FAStatus();
            } else {
                const data = await response.json();
                addToast(data.error || t('invalid2FACode'), 'error');
            }
        } catch (err) {
            addToast(t('connectionError'), 'error');
        }
        setLoading(false);
    };

    const handleDisable2FA = async () => {
        if (!disablePassword) {
            addToast(t('currentPassword') + ' required', 'error');
            return;
        }

        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/auth/2fa/disable`, {
                method: 'POST',
                credentials: 'include',  // Fix - need cookies for session auth
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders()
                },
                body: JSON.stringify({ password: disablePassword })
            });

            if (response && response.ok) {
                addToast(t('twoFactorDisabled'), 'success');
                setDisablePassword('');
                fetch2FAStatus();
            } else {
                const data = await response.json();
                addToast(data.error || 'Error', 'error');
            }
        } catch (err) {
            addToast(t('connectionError'), 'error');
        }
        setLoading(false);
    };

    if (!isOpen) return null;

    // Corporate corporate chrome - flat tabs, soft borders, no orange
    const overlayCls = isCorporate
        ? "corp-vm-modal-overlay"
        : "fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80";
    const panelCls = isCorporate
        ? "corp-vm-modal"
        : "w-full max-w-2xl max-h-[90vh] bg-proxmox-card border border-proxmox-border rounded-2xl shadow-2xl overflow-hidden flex flex-col";
    const tabsWrapCls = isCorporate ? "corp-vm-modal-tabs" : "flex border-b border-proxmox-border";
    const tabCls = (active) => isCorporate
        ? `corp-vm-modal-tab${active ? ' active' : ''}`
        : `flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${active ? 'text-proxmox-orange border-b-2 border-proxmox-orange' : 'text-gray-400 hover:text-white'}`;

    return (
        <div className={overlayCls} onClick={onClose}>
            <div
                className={panelCls}
                onClick={e => e.stopPropagation()}
                style={isCorporate ? { maxWidth: '760px', width: '100%' } : undefined}
            >
                {/* Header */}
                {isCorporate ? (
                    <div className="corp-vm-modal-header">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <UserAvatar user={user} sizeClass="w-9 h-9" textClass="text-sm" />
                            <div className="min-w-0">
                                <div className="corp-vm-modal-title truncate">{t('myProfile')}</div>
                                <div className="corp-vm-modal-meta truncate">{user?.display_name || user?.username}</div>
                            </div>
                        </div>
                        <div className="corp-vm-modal-actions">
                            <button onClick={onClose} className="corp-vm-btn corp-vm-btn-ghost" title={t('close')}>
                                <Icons.X />
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-between p-6 border-b border-proxmox-border">
                        <div className="flex items-center gap-3">
                            <UserAvatar user={user} sizeClass="w-10 h-10" textClass="text-base" />
                            <div>
                                <h2 className={isCorporate ? 'corp-card-header' : "text-xl font-bold text-white"}>{t('myProfile')}</h2>
                                <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>{user?.display_name || user?.username}</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-proxmox-dark text-gray-400 hover:text-white">
                            <Icons.X />
                        </button>
                    </div>
                )}

                {/* Tabs */}
                <div className={tabsWrapCls}>
                    <button
                        onClick={() => setActiveTab('appearance')}
                        className={tabCls(activeTab === 'appearance')}
                    >
                        <Icons.Palette />
                        {t('appearance')}
                    </button>
                    <button
                        onClick={() => setActiveTab('security')}
                        className={tabCls(activeTab === 'security')}
                    >
                        <Icons.Lock />
                        {t('security')}
                    </button>
                    <button
                        onClick={() => setActiveTab('tokens')}
                        className={tabCls(activeTab === 'tokens')}
                    >
                        <Icons.Key />
                        API Tokens
                    </button>
                    <button
                        onClick={() => setActiveTab('sessions')}
                        className={tabCls(activeTab === 'sessions')}
                    >
                        <Icons.Monitor />
                        {t('activeSessions2')}
                    </button>
                </div>

                {/* Content */}
                <div className={isCorporate ? "corp-vm-modal-body" : "flex-1 overflow-auto p-6"}>
                    {/* Appearance Tab */}
                    {activeTab === 'appearance' && (
                        <div className="space-y-6">
                            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                <div className="flex items-center gap-4">
                                    <UserAvatar user={user} sizeClass="w-16 h-16" textClass="text-xl" />
                                    <div className="flex-1 min-w-0">
                                        <h3 className={isCorporate ? 'corp-card-header' : "text-white font-medium"}>{t('profilePicture')}</h3>
                                        <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>
                                            {t('profilePictureDesc')}
                                        </p>
                                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>PNG, JPEG, GIF, or WebP up to 512 KB.</p>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2 mt-4">
                                    <input
                                        ref={avatarInputRef}
                                        type="file"
                                        accept="image/png,image/jpeg,image/gif,image/webp"
                                        onChange={handleAvatarSelected}
                                        className="hidden"
                                    />
                                    <button
                                        onClick={() => avatarInputRef.current?.click()}
                                        disabled={avatarUploading}
                                        className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {avatarUploading ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.Upload className="w-4 h-4" />}
                                        {user?.avatar_url ? (t('changeAvatar')) : (t('uploadAvatar'))}
                                    </button>
                                    {user?.avatar_url && (
                                        <button
                                            onClick={handleAvatarRemove}
                                            disabled={avatarUploading}
                                            className="px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 rounded-lg text-sm font-medium disabled:opacity-50"
                                        >
                                            {t('removeAvatar')}
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div>
                                <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                                    <Icons.Palette />
                                    {t('chooseTheme')}
                                </h3>
                                <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400 mb-4"}>
                                    {t('themePersonal')}
                                </p>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {Object.entries(ProxmoxVEx_THEMES).map(([key, theme]) => {
                                    const isActive = (user?.theme || 'proxmoxDark') === key;
                                    return (
                                        <button
                                            key={key}
                                            onClick={async () => {
                                                setSelectedTheme(key);
                                                const result = await updatePreferences({ theme: key });
                                                if (result.success) {
                                                    addToast(`${t('themeChanged')} ${theme.name}`, 'success');
                                                } else {
                                                    addToast(t('themeChangeFailed'), 'error');
                                                }
                                            }}
                                            className={`p-3 rounded-xl border-2 transition-all hover:scale-105 ${isActive
                                                ? 'border-proxmox-orange ring-2 ring-proxmox-orange/30'
                                                : 'border-proxmox-border hover:border-gray-500'
                                                }`}
                                            title={theme.description || theme.name}
                                        >
                                            <div
                                                className="h-16 rounded-lg mb-2 relative overflow-hidden"
                                                style={{
                                                    background: theme.colors.darker,
                                                    border: `1px solid ${theme.colors.border}`
                                                }}
                                            >
                                                <div className="absolute left-0 top-0 bottom-0 w-4" style={{ background: theme.colors.dark }} />
                                                <div
                                                    className="absolute right-2 top-2 bottom-2 left-6 rounded"
                                                    style={{
                                                        background: theme.colors.card,
                                                        border: `1px solid ${theme.colors.border}`
                                                    }}
                                                >
                                                    <div
                                                        className="w-3/4 h-1.5 rounded-full m-1.5"
                                                        style={{ background: theme.colors.primary }}
                                                    />
                                                </div>
                                                {isActive && (
                                                    <div className="absolute top-1 right-1 bg-proxmox-orange rounded-full p-0.5">
                                                        <Icons.Check className="w-3 h-3 text-white" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center justify-center gap-1.5">
                                                <span className="text-lg">{theme.icon}</span>
                                                <span className="text-xs font-medium">{theme.name}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>



                            {/* TaskBar Auto-Expand Setting */}
                            <div className="pt-4 border-t border-proxmox-border">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-blue-500/10">
                                            <Icons.Layers className="w-5 h-5 text-blue-400" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-white">{t('taskbarAutoExpand')}</p>
                                            <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-400"}>{t('taskbarAutoExpandDesc')}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            // Toggle current value - if true/undefined -> false, if false -> true
                                            const currentValue = user?.taskbar_auto_expand !== false;
                                            const newValue = !currentValue;
                                            ProxmoxVExLog.debug('TaskBar auto-expand toggle:', currentValue, '->', newValue);
                                            const result = await updatePreferences({ taskbar_auto_expand: newValue });
                                            if (result.success) {
                                                addToast(newValue ? (t('taskbarAutoExpandEnabled')) : (t('taskbarAutoExpandDisabled')), 'success');
                                            }
                                        }}
                                        className={`relative w-12 h-6 rounded-full transition-colors ${user?.taskbar_auto_expand !== false ? 'bg-proxmox-orange' : 'bg-gray-600'
                                            }`}
                                    >
                                        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${user?.taskbar_auto_expand !== false ? 'left-7' : 'left-1'
                                            }`} />
                                    </button>
                                </div>
                            </div>

                            {/* Show VMIDs in the corporate sidebar tree */}
                            {isCorporate && (
                                <div className="pt-4 border-t border-proxmox-border">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-blue-500/10">
                                                <Icons.Tag className="w-5 h-5 text-blue-400" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-white">{t('showVmidSidebar')}</p>
                                                <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-400"}>{t('showVmidSidebarDesc')}</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                const newValue = !(user?.sidebar_show_vmid === true);
                                                const result = await updatePreferences({ sidebar_show_vmid: newValue });
                                                if (result.success) addToast(newValue ? (t('showVmidSidebarOn')) : (t('showVmidSidebarOff')), 'success');
                                            }}
                                            className={`relative w-12 h-6 rounded-full transition-colors ${user?.sidebar_show_vmid === true ? 'bg-proxmox-orange' : 'bg-gray-600'}`}
                                        >
                                            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${user?.sidebar_show_vmid === true ? 'left-7' : 'left-1'}`} />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Language moved from corporate header into profile prefs */}
                            {isCorporate && (
                                <div className="pt-4 border-t border-proxmox-border">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Icons.Globe className="w-5 h-5 text-gray-400" />
                                            <div>
                                                <p className="text-sm font-medium text-white">{t('languagePreference')}</p>
                                                <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>{t('languagePreferenceDesc2')}</p>
                                            </div>
                                        </div>
                                        <LanguageSwitcher />
                                    </div>
                                </div>
                            )}

                            {/* 24h/12h time format toggle */}
                            <div className="pt-4 border-t border-proxmox-border">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Icons.Clock className="w-5 h-5 text-gray-400" />
                                        <div>
                                            <p className="text-sm font-medium text-white">{t('timeFormat')}</p>
                                            <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>{t('timeFormatDesc')}</p>
                                        </div>
                                    </div>
                                    <select
                                        value={localStorage.getItem('ProxmoxVEx-time-format') || '24h'}
                                        onChange={e => { localStorage.setItem('ProxmoxVEx-time-format', e.target.value); addToast(t('timeFormatChanged'), 'success'); }}
                                        className={isCorporate ? 'corp-input' : "px-3 py-1.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                                    >
                                        <option value="24h">24h (14:30)</option>
                                        <option value="12h">12h (2:30 PM)</option>
                                    </select>
                                </div>
                            </div>

                            {/* (#342) - disable modern-layout noise overlay */}
                            <div className="pt-4 border-t border-proxmox-border">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Icons.Eye className="w-5 h-5 text-gray-400" />
                                        <div>
                                            <p className="text-sm font-medium text-white">{t('disableNoiseOverlay')}</p>
                                            <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>{t('disableNoiseOverlayDesc')}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            const off = localStorage.getItem('ProxmoxVEx-noise') !== 'off';
                                            localStorage.setItem('ProxmoxVEx-noise', off ? 'off' : 'on');
                                            if (off) document.body.setAttribute('data-noise', 'off');
                                            else document.body.removeAttribute('data-noise');
                                            addToast(t('settingsSaved2'), 'success');
                                        }}
                                        className={`relative w-12 h-6 rounded-full transition-colors ${localStorage.getItem('ProxmoxVEx-noise') === 'off' ? 'bg-emerald-500' : 'bg-proxmox-dark border border-proxmox-border'
                                            }`}
                                    >
                                        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${localStorage.getItem('ProxmoxVEx-noise') === 'off' ? 'left-7' : 'left-1'
                                            }`} />
                                    </button>
                                </div>
                            </div>

                            {/* Stable VNC Mode (D). Adds an inner AES-256-GCM layer
                                        that survives middlebox TLS-inspection / EDR byte-mangling. Off by
                                        default (small CPU overhead) — opt-in for environments where the
                                        VNC console fails with "Authentication failed" or randomly disconnects. */}
                            <div className="pt-4 border-t border-proxmox-border">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Icons.Lock className="w-5 h-5 text-gray-400" />
                                        <div>
                                            <p className="text-sm font-medium text-white">{t('stableVncMode')}</p>
                                            <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>{t('stableVncModeDesc2')}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            const next = !stableVncOn;
                                            setStableVncOn(next);
                                            localStorage.setItem('ProxmoxVEx-vnc-stable-mode', next ? '1' : '0');
                                            addToast((t('settingsSaved3')) + (next ? ' — ' + (t('stableVncModeNote')) : ''), 'success');
                                        }}
                                        // Flex-shrink-0 + ml-4: long description text was
                                        // squeezing the toggle; the knob looked off-position because the
                                        // button itself was being compressed below 48×24.
                                        className={`flex-shrink-0 ml-4 relative w-12 h-6 rounded-full transition-colors ${stableVncOn ? 'bg-emerald-500' : 'bg-proxmox-dark border border-proxmox-border'
                                            }`}
                                    >
                                        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${stableVncOn ? 'left-7' : 'left-1'
                                            }`} />
                                    </button>
                                </div>
                            </div>

                            {/* (#299) - default nodes collapsed in cluster overview */}
                            <div className="pt-4 border-t border-proxmox-border">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Icons.Server className="w-5 h-5 text-gray-400" />
                                        <div>
                                            <p className="text-sm font-medium text-white">{t('collapseNodesDefault')}</p>
                                            <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>{t('collapseNodesDefaultDesc')}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            const cur = localStorage.getItem('ProxmoxVEx-nodes-default-collapsed') === '1';
                                            const next = !cur;
                                            localStorage.setItem('ProxmoxVEx-nodes-default-collapsed', next ? '1' : '0');
                                            // wipe the per-node overrides so the new default takes effect immediately
                                            localStorage.removeItem('ProxmoxVEx-collapsed-nodes');
                                            // poke the dashboard to re-sync state without requiring a refresh
                                            try { window.dispatchEvent(new CustomEvent('ProxmoxVEx-node-collapse-pref', { detail: next })); } catch (_) { }
                                            addToast(next ? (t('collapseNodesOn')) : (t('collapseNodesOff')), 'success');
                                        }}
                                        className={`relative w-12 h-6 rounded-full transition-colors ${localStorage.getItem('ProxmoxVEx-nodes-default-collapsed') === '1' ? 'bg-proxmox-orange' : 'bg-proxmox-border'}`}
                                    >
                                        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${localStorage.getItem('ProxmoxVEx-nodes-default-collapsed') === '1' ? 'left-7' : 'left-1'
                                            }`} />
                                    </button>
                                </div>
                            </div>

                            <p className="text-xs text-gray-500 text-center">
                                {t('themeNote')}
                            </p>
                        </div>
                    )}

                    {activeTab === 'security' && (
                        <div className="space-y-6">
                            {/* Password Change — only for local users (#164) */}
                            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                <h3 className="text-white font-medium mb-4 flex items-center gap-2">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                    </svg>
                                    {t('resetPassword')}
                                </h3>
                                {user?.auth_source && user.auth_source !== 'local' ? (
                                    <div className="text-sm text-gray-400 py-2">
                                        <p>{t('passwordManagedExternally') || `Your password is managed by ${user.auth_source === 'ldap' ? 'LDAP / Active Directory' : user.auth_source === 'entra' ? 'Microsoft Entra ID' : 'your identity provider'}.`}</p>
                                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>{t('passwordManagedExternallyHint')}</p>
                                    </div>
                                ) : (
                                    <form onSubmit={handleChangePassword} className="space-y-3">
                                        <input
                                            type="password"
                                            value={currentPassword}
                                            onChange={e => setCurrentPassword(e.target.value)}
                                            placeholder={t('currentPassword')}
                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                            required
                                        />
                                        <input
                                            type="password"
                                            value={newPassword}
                                            onChange={e => setNewPassword(e.target.value)}
                                            placeholder={t('newPassword')}
                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                            required
                                        />
                                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 -mt-1 mb-1"}>{getPasswordPolicyHint()}</p>
                                        <input
                                            type="password"
                                            value={confirmPassword}
                                            onChange={e => setConfirmPassword(e.target.value)}
                                            placeholder={t('confirmPassword')}
                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                            required
                                        />
                                        <button
                                            type="submit"
                                            disabled={loading}
                                            className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium disabled:opacity-50"
                                        >
                                            {t('resetPassword')}
                                        </button>
                                    </form>
                                )}
                            </div>

                            {/* 2FA Section */}
                            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                <h3 className="text-white font-medium mb-4 flex items-center gap-2">
                                    <Icons.Shield />
                                    {t('twoFactorAuth')}
                                </h3>

                                {!twoFAStatus.available ? (
                                    <p className={isCorporate ? 'corp-help-text' : "text-gray-400 text-sm"}>
                                        2FA nicht verfügbar. Server benötigt: pip install pyotp qrcode[pil]
                                    </p>
                                ) : twoFAStatus.enabled ? (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2 text-green-400">
                                            <Icons.Check />
                                            <span>{t('twoFactorEnabled')}</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <input
                                                type="password"
                                                value={disablePassword}
                                                onChange={e => setDisablePassword(e.target.value)}
                                                placeholder={t('currentPassword')}
                                                className={isCorporate ? 'corp-input' : "flex-1 px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm"}
                                            />
                                            <button
                                                onClick={handleDisable2FA}
                                                disabled={loading || !disablePassword}
                                                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium disabled:opacity-50"
                                            >
                                                {t('disable2FA')}
                                            </button>
                                        </div>
                                    </div>
                                ) : setupData ? (
                                    <div className="space-y-4">
                                        <p className={isCorporate ? 'corp-help-text' : "text-gray-400 text-sm"}>{t('scan2FACode')}</p>
                                        <div className="flex justify-center">
                                            <img src={setupData.qr_code} alt="QR Code" className="rounded-lg" />
                                        </div>
                                        <div className="text-center">
                                            <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mb-1"}>{t('secretKey')}:</p>
                                            <code className="text-xs text-proxmox-orange bg-proxmox-darker px-2 py-1 rounded">
                                                {setupData.secret}
                                            </code>
                                        </div>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={totpCode}
                                                onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                placeholder={t('enter2FACode')}
                                                maxLength={6}
                                                className={isCorporate ? 'corp-input' : "flex-1 px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-center text-lg tracking-widest"}
                                            />
                                            <button
                                                onClick={handleVerify2FA}
                                                disabled={loading || totpCode.length !== 6}
                                                className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-medium disabled:opacity-50"
                                            >
                                                {t('verify2FA')}
                                            </button>
                                        </div>
                                        <button
                                            onClick={() => setSetupData(null)}
                                            className="text-sm text-gray-400 hover:text-white"
                                        >
                                            {t('cancel')}
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={handleSetup2FA}
                                        disabled={loading}
                                        className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium disabled:opacity-50"
                                    >
                                        {t('setup2FA')}
                                    </button>
                                )}
                            </div>

                            {/* WebAuthn / FIDO2 hardware keys. 2nd-factor only;
                                        TOTP stays parallel. */}
                            <HardwareKeysPanel t={t} addToast={addToast} getAuthHeaders={getAuthHeaders} />
                        </div>
                    )}

                    {/* API Tokens Tab */}
                    {activeTab === 'tokens' && (
                        <div className="space-y-4">
                            {/* Created Token Banner - only shown once after creation */}
                            {createdToken && (
                                <div className="p-4 bg-yellow-500/10 border border-yellow-500/40 rounded-xl">
                                    <div className="flex items-start gap-2 mb-2">
                                        <Icons.AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                                        <p className="text-yellow-400 font-medium text-sm">{t('copyTokenNow')}</p>
                                    </div>
                                    <div className="flex items-center gap-2 mt-2">
                                        <code className="flex-1 bg-proxmox-dark px-3 py-2 rounded text-sm text-green-400 font-mono break-all select-all border border-proxmox-border">{createdToken}</code>
                                        <button onClick={() => copyToken(createdToken)} className="px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded hover:bg-proxmox-hover text-sm shrink-0">
                                            {tokenCopied ? <Icons.CheckCircle className="w-4 h-4 text-green-400" /> : <Icons.Copy className="w-4 h-4 text-gray-400" />}
                                        </button>
                                    </div>
                                    <button onClick={() => setCreatedToken(null)} className="text-xs text-gray-500 hover:text-gray-300 mt-2">Dismiss</button>
                                </div>
                            )}

                            {/* Create New Token */}
                            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                <h3 className="text-white font-medium mb-3 flex items-center gap-2">
                                    <Icons.Plus className="w-4 h-4 text-proxmox-orange" />
                                    Create API Token
                                </h3>
                                <div className="space-y-3">
                                    <div>
                                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>Token Name</label>
                                        <input
                                            type="text"
                                            value={newTokenName}
                                            onChange={e => setNewTokenName(e.target.value)}
                                            placeholder="e.g. ci-pipeline, monitoring, backup-script"
                                            maxLength={64}
                                            className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm"}
                                        />
                                    </div>
                                    <div className={`grid ${user?.role === 'admin' ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                                        {/* Only admins can pick a different role - everyone else gets their own */}
                                        {user?.role === 'admin' && (
                                            <div>
                                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>Role</label>
                                                <select
                                                    value={newTokenRole}
                                                    onChange={e => setNewTokenRole(e.target.value)}
                                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm"}
                                                >
                                                    <option value="">Same as my role</option>
                                                    <option value="viewer">Viewer</option>
                                                    <option value="user">User</option>
                                                    <option value="admin">Admin</option>
                                                </select>
                                            </div>
                                        )}
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-1"}>Expires (optional)</label>
                                            <select
                                                value={newTokenExpiry}
                                                onChange={e => setNewTokenExpiry(e.target.value)}
                                                className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-secondary border border-proxmox-border rounded-lg text-white text-sm"}
                                            >
                                                <option value="">Never</option>
                                                <option value="7">7 days</option>
                                                <option value="30">30 days</option>
                                                <option value="90">90 days</option>
                                                <option value="180">180 days</option>
                                                <option value="365">1 year</option>
                                            </select>
                                        </div>
                                    </div>
                                    <button
                                        onClick={createToken}
                                        disabled={loading || !newTokenName.trim()}
                                        className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 disabled:opacity-50 rounded-lg text-white text-sm flex items-center gap-2"
                                    >
                                        {loading ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.Key className="w-4 h-4" />}
                                        Generate Token
                                    </button>
                                </div>
                            </div>

                            {/* Existing Tokens */}
                            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                                <h3 className="text-white font-medium mb-3 flex items-center gap-2">
                                    <Icons.Key className="w-4 h-4 text-blue-400" />
                                    Your Tokens
                                    <span className="text-xs text-gray-500 ml-auto">{tokens.filter(t => !t.revoked).length} active</span>
                                </h3>
                                {tokensLoading ? (
                                    <div className="text-center py-4"><Icons.Loader className="w-5 h-5 animate-spin text-gray-400 mx-auto" /></div>
                                ) : tokens.length === 0 ? (
                                    <p className="text-gray-500 text-sm text-center py-4">No API tokens yet</p>
                                ) : (
                                    <div className="space-y-2">
                                        {tokens.map(token => (
                                            <div key={token.id} className={`flex items-center gap-3 p-3 rounded-lg border ${token.revoked ? 'border-red-500/20 bg-red-500/5 opacity-50' : 'border-proxmox-border bg-proxmox-secondary'}`}>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-white text-sm font-medium">{token.name}</span>
                                                        <code className="text-xs text-gray-500 font-mono">pgx_{token.token_prefix}_...</code>
                                                        <span className={`text-xs px-1.5 py-0.5 rounded ${token.role === 'admin' ? 'bg-red-500/20 text-red-400' :
                                                            token.role === 'user' ? 'bg-blue-500/20 text-blue-400' :
                                                                'bg-gray-500/20 text-gray-400'
                                                            }`}>{token.role}</span>
                                                        {token.revoked ? <span className="text-xs text-red-400">revoked</span> : null}
                                                    </div>
                                                    <div className="text-xs text-gray-500 mt-1 flex gap-3 flex-wrap">
                                                        <span>Created: {new Date(token.created_at).toLocaleDateString()}</span>
                                                        {token.expires_at && <span className={new Date(token.expires_at) < new Date() ? 'text-red-400' : ''}>
                                                            Expires: {new Date(token.expires_at).toLocaleDateString()}
                                                        </span>}
                                                        {token.last_used_at ? (
                                                            <span>Last used: {new Date(token.last_used_at).toLocaleDateString()} from {token.last_used_ip}</span>
                                                        ) : <span className="text-gray-600">Never used</span>}
                                                    </div>
                                                </div>
                                                {!token.revoked && (
                                                    <button
                                                        onClick={() => { if (confirm(`Revoke token "${token.name}"? This cannot be undone.`)) revokeToken(token.id); }}
                                                        className="px-3 py-1.5 bg-red-500/10 text-red-400 rounded-lg text-xs hover:bg-red-500/20 border border-red-500/20 shrink-0"
                                                    >
                                                        Revoke
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Usage Info */}
                            <div className="bg-proxmox-dark/50 border border-proxmox-border rounded-xl p-4 text-sm text-gray-400 space-y-2">
                                <h4 className="text-gray-300 font-medium flex items-center gap-2"><Icons.Info className="w-4 h-4" /> Usage</h4>
                                <p>Use API tokens for scripts, CI/CD pipelines, and monitoring integrations:</p>
                                <code className="block bg-proxmox-dark px-3 py-2 rounded text-xs font-mono text-green-400 border border-proxmox-border">
                                    curl -H "Authorization: Bearer pgx_..." {window.location.origin}/api/clusters
                                </code>
                            </div>
                        </div>
                    )}

                    {/* Active-sessions self-service tab */}
                    {activeTab === 'sessions' && (
                        <UserSessionsPanel t={t} addToast={addToast} getAuthHeaders={getAuthHeaders} />
                    )}
                </div>
            </div>
        </div>
    );
}

// Compact panel showing the caller's own sessions with a revoke button.
// Kept as its own component so the hooks don't leak into SettingsModal's render.
// Hardware Keys (WebAuthn/FIDO2) registration + listing.
// ─ CBOR-like binary blobs come back as base64url. `fido2` sends/receives them
//   as byte strings; browsers work with ArrayBuffers. These two helpers convert
//   between base64url and ArrayBuffer on the wire.
function _b64urlToBuf(s) {
    const pad = '='.repeat((4 - s.length % 4) % 4);
    const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
}
function _bufToB64url(buf) {
    const bin = String.fromCharCode(...new Uint8Array(buf));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function HardwareKeysPanel({ t, addToast, getAuthHeaders }) {
    const { isCorporate } = useLayout();
    const [available, setAvailable] = useState(true);   // optimistic; will flip if server says no
    const [hostUsable, setHostUsable] = useState(true);
    const [hostReason, setHostReason] = useState(null);
    const [creds, setCreds] = useState([]);
    const [loading, setLoading] = useState(false);
    const [registering, setRegistering] = useState(false);

    // WebAuthn forbids IP literals as RP IDs; detect and warn up-front
    useEffect(() => {
        fetch(`${API_URL}/webauthn/available`, { credentials: 'include' })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) { setHostUsable(!!d.host_usable); setHostReason(d.host_reason); } })
            .catch(() => { });
    }, []);

    const fmtTs = (ts) => ts ? new Date(ts).toLocaleString() : '—';

    const load = async () => {
        setLoading(true);
        try {
            const r = await fetch(`${API_URL}/webauthn/credentials`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) {
                const d = await r.json();
                setAvailable(!!d.available);
                setCreds(d.credentials || []);
            }
        } catch (e) { console.error('webauthn list:', e); }
        setLoading(false);
    };
    useEffect(() => { load(); }, []);

    const register = async () => {
        if (!('credentials' in navigator) || !navigator.credentials.create) {
            addToast?.(t('browserNoWebauthn'), 'error');
            return;
        }
        const name = (window.prompt(t('hardwareKeyNamePrompt') || 'Name this key (e.g. "YubiKey 5C Nano, office")', 'Security Key') || '').trim();
        if (!name) return;
        setRegistering(true);
        try {
            // 1) begin
            const beginRes = await fetch(`${API_URL}/webauthn/register/begin`, {
                method: 'POST', credentials: 'include', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }
            });
            if (!beginRes.ok) {
                const e = await beginRes.json().catch(() => ({}));
                throw new Error(e.error || `begin failed (${beginRes.status})`);
            }
            const opts = await beginRes.json();
            // server's JSON still has base64url for id/challenge fields — convert
            const pko = opts.publicKey || opts;
            const publicKey = {
                ...pko,
                challenge: _b64urlToBuf(pko.challenge),
                user: { ...pko.user, id: _b64urlToBuf(pko.user.id) },
                excludeCredentials: (pko.excludeCredentials || []).map(c => ({ ...c, id: _b64urlToBuf(c.id) })),
            };
            // 2) browser ceremony
            const cred = await navigator.credentials.create({ publicKey });
            if (!cred) throw new Error('cancelled');
            const response = {
                id: cred.id,
                rawId: _bufToB64url(cred.rawId),
                type: cred.type,
                response: {
                    clientDataJSON: _bufToB64url(cred.response.clientDataJSON),
                    attestationObject: _bufToB64url(cred.response.attestationObject),
                },
                transports: (cred.response.getTransports && cred.response.getTransports()) || [],
                name,
            };
            // 3) finish
            const finishRes = await fetch(`${API_URL}/webauthn/register/finish`, {
                method: 'POST', credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
            });
            const d = await finishRes.json().catch(() => ({}));
            if (!finishRes.ok) throw new Error(d.error || `finish failed (${finishRes.status})`);
            addToast?.(t('hardwareKeyAdded') || `Security key "${name}" added`, 'success');
            load();
        } catch (e) {
            console.error('webauthn register:', e);
            addToast?.((e && e.message) || 'Registration failed', 'error');
        }
        setRegistering(false);
    };

    const del = async (c) => {
        if (!window.confirm(t('confirmRemoveKey') || `Remove "${c.name}"?`)) return;
        const r = await fetch(`${API_URL}/webauthn/credentials/${c.id}`, {
            method: 'DELETE', credentials: 'include', headers: getAuthHeaders()
        });
        if (r.ok) { addToast?.(t('hardwareKeyRemoved'), 'success'); load(); }
        else addToast?.('Delete failed', 'error');
    };

    if (!available) {
        return (
            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                <h3 className="text-white font-medium mb-2 flex items-center gap-2">
                    <Icons.Key /> {t('hardwareKeys')}
                </h3>
                <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>{t('webauthnUnavailable')}</p>
            </div>
        );
    }

    return (
        <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-medium flex items-center gap-2">
                    <Icons.Key /> {t('hardwareKeys')}
                    <span className="text-xs text-gray-500 ml-1">({creds.length})</span>
                </h3>
                <button onClick={register} disabled={registering || !hostUsable}
                    className="px-3 py-1.5 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                    {registering ? <Icons.RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Icons.Plus className="w-3.5 h-3.5" />}
                    {t('addHardwareKey')}
                </button>
            </div>
            {!hostUsable && hostReason === 'ip_literal' && (
                <div className="mb-3 p-3 rounded-lg flex items-start gap-2" style={{ background: 'rgba(239, 192, 6, 0.08)', borderLeft: '3px solid #efc006' }}>
                    <Icons.AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#efc006' }} />
                    <div className="text-xs text-yellow-300">
                        <div className="font-medium">{t('webauthnIpHostTitle')}</div>
                        <div className="text-gray-400 mt-0.5">
                            {t('webauthnIpHostDesc')}
                        </div>
                    </div>
                </div>
            )}
            <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mb-3"}>
                {t('hardwareKeysDesc')}
            </p>
            {loading && creds.length === 0 ? (
                <div className="text-center py-4"><Icons.RotateCw className="w-4 h-4 animate-spin text-gray-400 mx-auto" /></div>
            ) : creds.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">{t('noHardwareKeys')}</p>
            ) : (
                <div className="space-y-2">
                    {creds.map(c => (
                        <div key={c.id} className="flex items-center gap-3 p-3 bg-proxmox-secondary border border-proxmox-border rounded-lg">
                            <div className="p-2 rounded-lg bg-blue-500/10">
                                <Icons.Key className="w-4 h-4 text-blue-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm text-white font-medium truncate">{c.name}</div>
                                <div className="text-xs text-gray-500 flex flex-wrap gap-3">
                                    <span>{t('added')}: {fmtTs(c.created_at)}</span>
                                    <span>{t('lastUsed')}: {c.last_used_at ? fmtTs(c.last_used_at) : (t('never'))}</span>
                                    {c.transports?.length > 0 && <span className="text-gray-400">{c.transports.join(', ')}</span>}
                                </div>
                            </div>
                            <button onClick={() => del(c)}
                                className="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded text-xs flex items-center gap-1">
                                <Icons.Trash /> {t('remove')}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function UserSessionsPanel({ t, addToast, getAuthHeaders }) {
    const { isCorporate } = useLayout();
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const r = await fetch(`${API_URL}/user/sessions`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) {
                const d = await r.json();
                setSessions(d.sessions || []);
            }
        } catch (e) { console.error('sessions load:', e); }
        setLoading(false);
    };
    useEffect(() => { load(); }, []);

    const revoke = async (s) => {
        if (s.is_current && !window.confirm(t('confirmRevokeCurrent'))) return;
        const r = await fetch(`${API_URL}/user/sessions/${encodeURIComponent(s.revoke_token)}`, {
            method: 'DELETE', credentials: 'include', headers: getAuthHeaders()
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok) {
            addToast?.(t('sessionRevoked'), 'success');
            if (d.self_logout) { window.location.href = '/'; return; }
            load();
        } else {
            addToast?.(d.error || 'Revoke failed', 'error');
        }
    };

    const fmtAgent = (ua) => {
        if (!ua) return '—';
        // naive UA shortener: pick a browser family or fallback to first 60 chars
        const m = ua.match(/(Firefox|Chrome|Safari|Edge|Opera|curl|python-requests)[\/\s]?([\d.]*)/i);
        return m ? `${m[1]} ${m[2] || ''}`.trim() : ua.substring(0, 60);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className={isCorporate ? 'corp-card-header' : "text-lg font-semibold text-white"}>{t('activeSessions')}</h3>
                    <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400 mt-1"}>{t('activeSessionsDesc')}</p>
                </div>
                <button onClick={load} className="px-3 py-1.5 bg-proxmox-dark hover:bg-proxmox-hover border border-proxmox-border rounded-lg text-sm flex items-center gap-2">
                    <Icons.RefreshCw className={loading ? 'animate-spin' : ''} />
                    {t('refresh')}
                </button>
            </div>
            {loading && sessions.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-gray-500">
                    <Icons.RotateCw className="w-5 h-5 animate-spin" />
                </div>
            ) : sessions.length === 0 ? (
                <div className="text-center text-gray-500 py-8">{t('noSessions')}</div>
            ) : (
                <div className="space-y-2">
                    {sessions.map(s => (
                        <div key={s.revoke_token} className="bg-proxmox-dark border border-proxmox-border rounded-lg p-3 flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${s.is_current ? 'bg-green-500/10' : 'bg-gray-500/10'}`}>
                                <Icons.Monitor className={`w-5 h-5 ${s.is_current ? 'text-green-400' : 'text-gray-400'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-sm text-white">{s.ip || '—'}</span>
                                    {s.is_current && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">{t('currentSession')}</span>}
                                    {s.remember && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">{t('rememberMe')}</span>}
                                </div>
                                <div className="text-xs text-gray-400 truncate" title={s.user_agent}>{fmtAgent(s.user_agent)}</div>
                                <div className="text-xs text-gray-500">
                                    {t('lastActive')}: {s.last_activity ? new Date(s.last_activity * 1000).toLocaleString() : '—'}
                                </div>
                            </div>
                            <button onClick={() => revoke(s)}
                                className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm flex items-center gap-1.5"
                                title={t('revokeSession')}>
                                <Icons.Trash />
                                {t('revoke')}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
