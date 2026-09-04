/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        web/src/vm_config.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Vm Config JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
function IpsetEntries({ clusterId, vm, ipsetName, authFetch, onRefresh, t }) {
    const { isCorporate } = useLayout();
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newCidr, setNewCidr] = useState('');

    useEffect(() => {
        loadEntries();
    }, [ipsetName]);

    const loadEntries = async () => {
        setLoading(true);
        try {
            const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/ipset/${ipsetName}`);
            if (res?.ok) setEntries(await res.json());
        } catch (e) { }
        setLoading(false);
    };

    return (
        <div className="p-4">
            {loading ? (
                <div className="flex justify-center py-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-proxmox-orange"></div>
                </div>
            ) : (
                <>
                    <div className="flex gap-2 mb-3">
                        <input
                            type="text"
                            value={newCidr}
                            onChange={e => setNewCidr(e.target.value)}
                            placeholder="e.g. 10.0.0.0/24" className={isCorporate ? 'corp-input' : 'flex-1 bg-proxmox-dark border border-proxmox-border rounded-lg px-3 py-1.5 text-sm'}
                            onKeyDown={async (e) => {
                                if (e.key === 'Enter' && newCidr) {
                                    try {
                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/ipset/${ipsetName}`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ cidr: newCidr })
                                        });
                                        if (res?.ok) {
                                            loadEntries(); setNewCidr('');
                                        } else {
                                            const err = await res.json().catch(() => ({}));
                                            addToast(err.error || `Operation failed (HTTP ${res?.status || '?'})`, 'error');
                                        }
                                    } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                }
                            }}
                        />
                        <button
                            onClick={async () => {
                                if (!newCidr) return;
                                try {
                                    const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/ipset/${ipsetName}`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ cidr: newCidr })
                                    });
                                    if (res?.ok) {
                                        loadEntries(); setNewCidr('');
                                    } else {
                                        const err = await res.json().catch(() => ({}));
                                        addToast(err.error || `Operation failed (HTTP ${res?.status || '?'})`, 'error');
                                    }
                                } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                            }}
                            className="px-3 py-1.5 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm text-white transition-colors"
                        >
                            {t('add')}
                        </button>
                    </div>
                    {entries.length === 0 ? (
                        <div className="text-center text-gray-500 py-4 text-sm">Empty set</div>
                    ) : (
                        <div className="space-y-1">
                            {entries.map((entry, idx) => (
                                <div key={idx} className="flex justify-between items-center p-2 bg-proxmox-dark rounded-lg">
                                    <span className="font-mono text-sm">{entry.cidr}</span>
                                    <div className="flex items-center gap-2">
                                        {entry.comment && <span className="text-gray-500 text-xs">{entry.comment}</span>}
                                        <button
                                            onClick={async () => {
                                                try {
                                                    const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/ipset/${ipsetName}/${encodeURIComponent(entry.cidr)}`, { method: 'DELETE' });
                                                    if (res?.ok) {
                                                        loadEntries();
                                                    } else {
                                                        const err = await res.json().catch(() => ({}));
                                                        addToast(err.error || `Operation failed (HTTP ${res?.status || '?'})`, 'error');
                                                    }
                                                } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                            }}
                                            className="p-1 hover:bg-red-500/20 rounded text-red-400 transition-colors"
                                        >
                                            <Icons.Trash className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// (raw-config-ux): The "Advanced / Raw Config" block used to be a flat list of
// label+input pairs laid out with `grid-cols-[140px_1fr]`. That arbitrary-value class
// does not exist in the prebuilt tailwind.min.css we ship, so every row collapsed into
// a single cramped line and long PVE property strings were unreadable/unsearchable.
// This editor replaces it with: search, "modified only" filter, category grouping,
// modified/added/pending-delete states, per-key revert, value copy, staged key removal,
// property-string chips, and a plain-text editing mode.

// (structured-raw-config): Property-string schemas define how comma-separated key=value
// strings should be decomposed into labelled form fields.  Each schema entry maps a PVE
// config key pattern to an ordered list of sub-fields with types, placeholders, options,
// and help text so the UI can render a proper form instead of a single long text input.
// `match` is a regex tested against the raw config key (e.g. net0, scsi1, mp0).
// `fields` is an array of { key, label, type, placeholder?, options?, help? }.
//   type: 'text' | 'flag' (0/1 checkbox) | 'select' | 'readonly'
const PROPERTY_SCHEMAS = [
    {
        // QEMU network: virtio=MAC,bridge=vmbr0,firewall=1,...
        match: /^net\d+$/,
        // LXC net values also contain "bridge="; exclude LXC markers so the LXC schema wins.
        detect: (val) => (val.includes('bridge=') || val.includes('firewall=') || val.includes('tag=') || val.includes('link_down=')) && !val.includes('name=') && !val.includes('hwaddr='),
        fields: [
            { key: '_model_mac', label: 'propModel', type: 'readonly', help: 'propModelHelp' },
            { key: 'bridge', label: 'propBridge', type: 'text', placeholder: 'vmbr0' },
            { key: 'firewall', label: 'propFirewall', type: 'flag' },
            { key: 'tag', label: 'propVlanTag', type: 'text', placeholder: '' },
            { key: 'rate', label: 'propRate', type: 'text', placeholder: 'MB/s' },
            { key: 'mtu', label: 'propMtu', type: 'text', placeholder: '1500' },
            { key: 'queues', label: 'propQueues', type: 'text', placeholder: '' },
            { key: 'link_down', label: 'propLinkDown', type: 'flag' },
        ],
        // First part of QEMU net is special: model=MAC (e.g. virtio=AA:BB:CC:DD:EE:FF)
        parse: (val) => {
            const parts = val.split(',');
            const result = {};
            parts.forEach((p, i) => {
                if (i === 0 && p.includes('=') && p.split('=')[1]?.includes(':')) {
                    result['_model_mac'] = p;
                } else if (p.includes('=')) {
                    const [k, ...v] = p.split('=');
                    result[k] = v.join('=');
                }
            });
            return result;
        },
        build: (fields) => {
            const parts = [];
            if (fields['_model_mac']) parts.push(fields['_model_mac']);
            Object.entries(fields).forEach(([k, v]) => {
                if (k === '_model_mac' || v === '' || v === undefined) return;
                parts.push(`${k}=${v}`);
            });
            return parts.join(',');
        },
    },
    {
        // LXC network: name=eth0,bridge=vmbr0,gw=192.168.1.1,hwaddr=...,ip=...,type=veth
        match: /^net\d+$/,
        detect: (val) => val.includes('name=') || val.includes('hwaddr=') || (val.includes('ip=') && !val.includes('bridge=')),
        fields: [
            { key: 'name', label: 'propIfName', type: 'text', placeholder: 'eth0' },
            { key: 'bridge', label: 'propBridge', type: 'text', placeholder: 'vmbr0' },
            { key: 'hwaddr', label: 'propMac', type: 'text', placeholder: 'BC:24:11:12:06:54' },
            { key: 'ip', label: 'propIpv4', type: 'text', placeholder: '192.168.1.15/24 or dhcp' },
            { key: 'gw', label: 'propGateway', type: 'text', placeholder: '192.168.1.1' },
            { key: 'ip6', label: 'propIpv6', type: 'text', placeholder: 'auto or manual' },
            { key: 'gw6', label: 'propGateway6', type: 'text', placeholder: '' },
            { key: 'firewall', label: 'propFirewall', type: 'flag' },
            { key: 'tag', label: 'propVlanTag', type: 'text', placeholder: '' },
            { key: 'rate', label: 'propRate', type: 'text', placeholder: 'MB/s' },
            { key: 'mtu', label: 'propMtu', type: 'text', placeholder: '1500' },
            { key: 'type', label: 'propType', type: 'select', options: ['veth'] },
        ],
    },
    {
        // QEMU disks: local-lvm:vm-100-disk-0,size=32G,cache=none,...
        match: /^(scsi|sata|virtio|ide|efidisk|tpmstate)\d+$/,
        detect: (val) => val.includes(':') && (val.includes('size=') || val.includes('media=')),
        fields: [
            { key: '_volume', label: 'propVolume', type: 'readonly', help: 'propVolumeHelp' },
            { key: 'size', label: 'propSize', type: 'text', placeholder: '32G' },
            { key: 'cache', label: 'propCache', type: 'select', options: ['', 'none', 'writeback', 'writethrough', 'directsync', 'unsafe'] },
            { key: 'format', label: 'propFormat', type: 'select', options: ['', 'raw', 'qcow2', 'vmdk'] },
            { key: 'iothread', label: 'propIothread', type: 'flag' },
            { key: 'ssd', label: 'propSsd', type: 'flag' },
            { key: 'discard', label: 'propDiscard', type: 'select', options: ['', 'on', 'ignore'] },
            { key: 'backup', label: 'propBackup', type: 'flag' },
            { key: 'replicate', label: 'propReplicate', type: 'flag' },
            { key: 'aio', label: 'propAio', type: 'select', options: ['', 'native', 'threads', 'io_uring'] },
            { key: 'media', label: 'propMedia', type: 'select', options: ['', 'cdrom', 'disk'] },
        ],
        parse: (val) => {
            const parts = val.split(',');
            const result = {};
            parts.forEach((p, i) => {
                if (i === 0 && p.includes(':')) {
                    result['_volume'] = p;
                } else if (p.includes('=')) {
                    const [k, ...v] = p.split('=');
                    result[k] = v.join('=');
                }
            });
            return result;
        },
        build: (fields) => {
            const parts = [];
            if (fields['_volume']) parts.push(fields['_volume']);
            Object.entries(fields).forEach(([k, v]) => {
                if (k === '_volume' || v === '' || v === undefined) return;
                parts.push(`${k}=${v}`);
            });
            return parts.join(',');
        },
    },
    {
        // LXC mount points: local-lvm:vm-126-disk-0,size=8G,mp=/mnt/data,...
        match: /^(rootfs|mp\d+)$/,
        detect: (val) => val.includes(':'),
        fields: [
            { key: '_volume', label: 'propVolume', type: 'readonly', help: 'propVolumeHelp' },
            { key: 'size', label: 'propSize', type: 'text', placeholder: '8G' },
            { key: 'mp', label: 'propMountpoint', type: 'text', placeholder: '/mnt/data' },
            { key: 'acl', label: 'propAcl', type: 'flag' },
            { key: 'backup', label: 'propBackup', type: 'flag' },
            { key: 'quota', label: 'propQuota', type: 'flag' },
            { key: 'replicate', label: 'propReplicate', type: 'flag' },
            { key: 'ro', label: 'propReadOnly', type: 'flag' },
            { key: 'shared', label: 'propShared', type: 'flag' },
        ],
        parse: (val) => {
            const parts = val.split(',');
            const result = {};
            parts.forEach((p, i) => {
                if (i === 0 && p.includes(':')) {
                    result['_volume'] = p;
                } else if (p.includes('=')) {
                    const [k, ...v] = p.split('=');
                    result[k] = v.join('=');
                }
            });
            return result;
        },
        build: (fields) => {
            const parts = [];
            if (fields['_volume']) parts.push(fields['_volume']);
            Object.entries(fields).forEach(([k, v]) => {
                if (k === '_volume' || v === '' || v === undefined) return;
                parts.push(`${k}=${v}`);
            });
            return parts.join(',');
        },
    },
    {
        // Cloud-init ipconfig: ip=dhcp or ip=192.168.1.100/24,gw=192.168.1.1
        match: /^ipconfig\d+$/,
        detect: () => true,
        fields: [
            { key: 'ip', label: 'propIpv4', type: 'text', placeholder: '192.168.1.100/24 or dhcp' },
            { key: 'gw', label: 'propGateway', type: 'text', placeholder: '192.168.1.1' },
            { key: 'ip6', label: 'propIpv6', type: 'text', placeholder: 'auto or dhcp' },
            { key: 'gw6', label: 'propGateway6', type: 'text', placeholder: '' },
        ],
    },
    {
        // PCI passthrough: 0000:01:00.0,pcie=1,rombar=1,x-vga=1
        match: /^hostpci\d+$/,
        detect: (val) => /[0-9a-f]{4}:[0-9a-f]{2}/.test(val),
        fields: [
            { key: '_device', label: 'propPciDevice', type: 'readonly' },
            { key: 'pcie', label: 'propPcie', type: 'flag' },
            { key: 'rombar', label: 'propRombar', type: 'flag' },
            { key: 'x-vga', label: 'propXvga', type: 'flag' },
            { key: 'mdev', label: 'propMdev', type: 'text', placeholder: '' },
        ],
        parse: (val) => {
            const parts = val.split(',');
            const result = {};
            parts.forEach((p, i) => {
                if (i === 0 && !p.includes('=')) {
                    result['_device'] = p;
                } else if (p.includes('=')) {
                    const [k, ...v] = p.split('=');
                    result[k] = v.join('=');
                }
            });
            return result;
        },
        build: (fields) => {
            const parts = [];
            if (fields['_device']) parts.push(fields['_device']);
            Object.entries(fields).forEach(([k, v]) => {
                if (k === '_device' || v === '' || v === undefined) return;
                parts.push(`${k}=${v}`);
            });
            return parts.join(',');
        },
    },
    {
        // USB passthrough: host=1-2,usb3=1
        match: /^usb\d+$/,
        detect: (val) => val.includes('host=') || val.includes('usb3='),
        fields: [
            { key: 'host', label: 'propUsbHost', type: 'text', placeholder: '1-2 or vendorid:productid' },
            { key: 'usb3', label: 'propUsb3', type: 'flag' },
        ],
    },
    {
        // QEMU agent: 1,fstrim_cloned_disks=1,type=virtio,...
        match: /^agent$/,
        detect: () => true,
        fields: [
            { key: '_enabled', label: 'propEnabled', type: 'flag' },
            { key: 'fstrim_cloned_disks', label: 'propFstrim', type: 'flag' },
            { key: 'type', label: 'propType', type: 'select', options: ['', 'virtio', 'isa'] },
        ],
        parse: (val) => {
            const parts = val.split(',');
            const result = {};
            parts.forEach((p, i) => {
                if (i === 0 && !p.includes('=')) {
                    result['_enabled'] = p;
                } else if (p.includes('=')) {
                    const [k, ...v] = p.split('=');
                    result[k] = v.join('=');
                }
            });
            return result;
        },
        build: (fields) => {
            const parts = [];
            if (fields['_enabled'] !== undefined) parts.push(fields['_enabled']);
            Object.entries(fields).forEach(([k, v]) => {
                if (k === '_enabled' || v === '' || v === undefined) return;
                parts.push(`${k}=${v}`);
            });
            return parts.join(',');
        },
    },
    {
        // startup: order=1,up=30,down=30
        match: /^startup$/,
        detect: () => true,
        fields: [
            { key: 'order', label: 'propStartOrder', type: 'text', placeholder: '0' },
            { key: 'up', label: 'propStartUp', type: 'text', placeholder: '0 (seconds)' },
            { key: 'down', label: 'propStartDown', type: 'text', placeholder: '0 (seconds)' },
        ],
    },
    {
        // features (LXC): nesting=1,keyctl=1,mount=nfs;cifs
        match: /^features$/,
        detect: () => true,
        fields: [
            { key: 'nesting', label: 'propNesting', type: 'flag' },
            { key: 'keyctl', label: 'propKeyctl', type: 'flag' },
            { key: 'mount', label: 'propMount', type: 'text', placeholder: 'nfs;cifs' },
            { key: 'fuse', label: 'propFuse', type: 'flag' },
        ],
    },
    {
        // LXC raw config: semicolon+space-separated directives treated as a multi-line list.
        // e.g. "lxc.cgroup2.devices.allow: a" entries joined by commas in the PVE API.
        match: /^lxc$/,
        detect: () => true,
        _isLxcRaw: true,
        fields: [],
    },
    {
        // Cloud-init custom snippets: user=...,network=...,meta=...
        match: /^cicustom$/,
        detect: () => true,
        fields: [
            { key: 'user', label: 'propCiUser', type: 'text', placeholder: 'local:snippets/user.yaml' },
            { key: 'network', label: 'propCiNetwork', type: 'text', placeholder: 'local:snippets/network.yaml' },
            { key: 'meta', label: 'propCiMeta', type: 'text', placeholder: 'local:snippets/meta.yaml' },
        ],
    },
    {
        // Cloud-init type: configdrive2 | nocloud
        match: /^citype$/,
        detect: () => true,
        fields: [
            { key: '_value', label: 'propCiType', type: 'select', options: ['', 'configdrive2', 'nocloud'] },
        ],
        parse: (val) => ({ _value: val }),
        build: (fields) => fields._value || '',
    },
    {
        // Cloud-init package upgrade: 0 | 1
        match: /^ciupgrade$/,
        detect: () => true,
        fields: [
            { key: '_value', label: 'propCiUpgrade', type: 'flag' },
        ],
        parse: (val) => ({ _value: val }),
        build: (fields) => fields._value,
    },
    {
        // VirtIO RNG: source=...,max_bytes=...,period=...
        match: /^rng\d+$/,
        detect: (val) => val.includes('source=') || val.includes('max_bytes='),
        fields: [
            { key: 'source', label: 'propRngSource', type: 'text', placeholder: '/dev/hwrng' },
            { key: 'max_bytes', label: 'propRngMaxBytes', type: 'text', placeholder: '1024' },
            { key: 'period', label: 'propRngPeriod', type: 'text', placeholder: '1000' },
        ],
    },
    {
        // Watchdog: model=...,action=...
        match: /^watchdog$/,
        detect: () => true,
        fields: [
            { key: 'model', label: 'propWatchdogModel', type: 'text', placeholder: 'i6300esb' },
            { key: 'action', label: 'propWatchdogAction', type: 'select', options: ['', 'reset', 'none', 'poweroff', 'pause', 'debug'] },
        ],
    },
    {
        // Audio device: device=...,driver=...
        match: /^audio\d+$/,
        detect: (val) => val.includes('device=') || val.includes('driver='),
        fields: [
            { key: 'device', label: 'propAudioDevice', type: 'text', placeholder: 'ich9-intel-hda' },
            { key: 'driver', label: 'propAudioDriver', type: 'text', placeholder: 'spice' },
        ],
    },
    {
        // VGA: type=...,memory=...
        match: /^vga$/,
        detect: (val) => val.includes('type=') || val.includes('memory='),
        fields: [
            { key: 'type', label: 'propVgaType', type: 'text', placeholder: 'std' },
            { key: 'memory', label: 'propVgaMemory', type: 'text', placeholder: '32' },
        ],
    },
    {
        // Serial port: socket=1 | device=/dev/ttyS0
        match: /^serial\d+$/,
        detect: (val) => val.includes('socket') || val.includes('device='),
        fields: [
            { key: 'socket', label: 'propSocket', type: 'flag' },
            { key: 'device', label: 'propDevice', type: 'text', placeholder: '/dev/ttyS0' },
        ],
        parse: (val) => {
            const result = {};
            val.split(',').forEach(p => {
                if (p.includes('=')) {
                    const [k, ...v] = p.split('=');
                    result[k] = v.join('=');
                } else if (p.trim() === 'socket') {
                    result.socket = '1';
                }
            });
            return result;
        },
        build: (fields) => {
            const parts = [];
            if (fields.socket === '1') parts.push('socket=1');
            if (fields.device) parts.push(`device=${fields.device}`);
            return parts.join(',');
        },
    },
    {
        // Parallel port: socket=1 | device=/dev/parport0
        match: /^parallel\d+$/,
        detect: (val) => val.includes('socket') || val.includes('device='),
        fields: [
            { key: 'socket', label: 'propSocket', type: 'flag' },
            { key: 'device', label: 'propDevice', type: 'text', placeholder: '/dev/parport0' },
        ],
        parse: (val) => {
            const result = {};
            val.split(',').forEach(p => {
                if (p.includes('=')) {
                    const [k, ...v] = p.split('=');
                    result[k] = v.join('=');
                } else if (p.trim() === 'socket') {
                    result.socket = '1';
                }
            });
            return result;
        },
        build: (fields) => {
            const parts = [];
            if (fields.socket === '1') parts.push('socket=1');
            if (fields.device) parts.push(`device=${fields.device}`);
            return parts.join(',');
        },
    },
    {
        // Fallback for any remaining comma-separated key=value property string.
        // This auto-structures PVE keys like rng0, watchdog, audio0, and vga
        // without needing an explicit schema.
        match: /^.*$/,
        detect: (val) => {
            if (!val.includes(',') || !val.includes('=')) return false;
            return val.split(',').filter(p => p.includes('=')).length >= 2;
        },
        fields: [],
    },
];

// Help text lookup for schema field labels.  If a field does not define its own
// help key, this map provides a default tooltip based on its label key.
const PROPERTY_HELP = {
    propBridge: 'propBridgeHelp',
    propMac: 'propMacHelp',
    propVlanTag: 'propVlanTagHelp',
    propFirewall: 'propFirewallHelp',
    propRate: 'propRateHelp',
    propMtu: 'propMtuHelp',
    propQueues: 'propQueuesHelp',
    propLinkDown: 'propLinkDownHelp',
    propIpv4: 'propIpv4Help',
    propGateway: 'propGatewayHelp',
    propIpv6: 'propIpv6Help',
    propGateway6: 'propGateway6Help',
    propVolume: 'propVolumeHelp',
    propSize: 'propSizeHelp',
    propCache: 'propCacheHelp',
    propFormat: 'propFormatHelp',
    propIothread: 'propIothreadHelp',
    propSsd: 'propSsdHelp',
    propDiscard: 'propDiscardHelp',
    propBackup: 'propBackupHelp',
    propReplicate: 'propReplicateHelp',
    propAio: 'propAioHelp',
    propMedia: 'propMediaHelp',
    propMp: 'propMpHelp',
    propAcl: 'propAclHelp',
    propQuota: 'propQuotaHelp',
    propSocket: 'propSocketHelp',
    propDevice: 'propDeviceHelp',
    propIfName: 'propIfNameHelp',
    propPciDevice: 'propPciDeviceHelp',
    propPcie: 'propPcieHelp',
    propRombar: 'propRombarHelp',
    propXvga: 'propXvgaHelp',
    propMdev: 'propMdevHelp',
    propUsbHost: 'propUsbHostHelp',
    propUsb3: 'propUsb3Help',
    propEnabled: 'propEnabledHelp',
    propFstrim: 'propFstrimHelp',
    propStartOrder: 'propStartOrderHelp',
    propStartUp: 'propStartUpHelp',
    propStartDown: 'propStartDownHelp',
    propNesting: 'propNestingHelp',
    propKeyctl: 'propKeyctlHelp',
    propMount: 'propMountHelp',
    propFuse: 'propFuseHelp',
    propCiUser: 'propCiUserHelp',
    propCiNetwork: 'propCiNetworkHelp',
    propCiMeta: 'propCiMetaHelp',
    propCiType: 'propCiTypeHelp',
    propCiUpgrade: 'propCiUpgradeHelp',
    propRngSource: 'propRngSourceHelp',
    propRngMaxBytes: 'propRngMaxBytesHelp',
    propRngPeriod: 'propRngPeriodHelp',
    propWatchdogModel: 'propWatchdogModelHelp',
    propWatchdogAction: 'propWatchdogActionHelp',
    propAudioDevice: 'propAudioDeviceHelp',
    propAudioDriver: 'propAudioDriverHelp',
    propVgaType: 'propVgaTypeHelp',
    propVgaMemory: 'propVgaMemoryHelp',
};

// Default parse/build helpers for simple comma-separated key=value property strings.
// Schemas that need special first-token handling (volume, model=mac, device) provide
// their own parse/build; the rest fall through to these.
const _defaultPropParse = (val) => {
    const result = {};
    val.split(',').forEach(p => {
        if (p.includes('=')) {
            const [k, ...v] = p.split('=');
            result[k] = v.join('=');
        }
    });
    return result;
};
const _defaultPropBuild = (fields) =>
    Object.entries(fields)
        .filter(([, v]) => v !== '' && v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join(',');

// Find the matching schema for a raw config key + value. Returns null if none match.
const _findSchema = (key, value) => {
    for (const schema of PROPERTY_SCHEMAS) {
        if (!schema.match.test(key)) continue;
        if (schema.detect && !schema.detect(value)) continue;
        return schema;
    }
    return null;
};

// (structured-raw-config): Inline editor for property-string values. Instead of a
// single long text input, this renders each sub-property as its own labelled field —
// text, checkbox, or dropdown — based on the schema.  The user can always toggle back
// to the raw text input via the "raw" mode button on the row.
function PropertyStringEditor({ configKey, value, schema, onChange, isCorporate, t }) {
    // Hooks must be declared unconditionally at the top (LXC editor uses these).
    const [lxcAddKey, setLxcAddKey] = useState('');
    const [lxcAddValue, setLxcAddValue] = useState('');

    const parse = schema.parse || _defaultPropParse;
    const build = schema.build || _defaultPropBuild;
    const parsed = parse(value);

    const handleFieldChange = (fieldKey, newVal) => {
        const updated = { ...parsed, [fieldKey]: newVal };
        onChange(build(updated));
    };

    const inputCls = isCorporate
        ? 'corp-input'
        : 'w-full px-2 py-1 bg-proxmox-darker border border-proxmox-border rounded text-white text-sm font-mono focus:outline-none focus:border-proxmox-orange';
    const labelCls = isCorporate
        ? 'corp-label'
        : 'block text-xs text-gray-500 mb-0.5';

    // LXC raw config is a special multi-line list of directives, not key=value pairs.
    // PVE stores each lxc.* directive as a comma-separated entry in a single "lxc" key.
    if (schema._isLxcRaw) {
        // LXC raw config is stored as a comma-separated list of directives, but each
        // directive's value can also contain commas. Directives all start with "lxc.",
        // so split on ",lxc." rather than plain commas. When joining, reinsert the
        // "lxc." prefix between directives (the first directive already has it).
        const raw = value ? value.split(',lxc.').map((p, i) => (i === 0 ? p : `lxc.${p}`)).filter(Boolean) : [];
        const rows = raw.map(d => {
            const [k, ...v] = d.trim().split(',');
            return { key: k, value: v.join(',') };
        }).filter(r => r.key);

        const updateRows = (nextRows) => onChange(nextRows.map(r => `${r.key},${r.value}`).join(',lxc.'));

        return (
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <label className={`${labelCls} flex items-center gap-2`}>
                        <Icons.Terminal className="w-3 h-3" />
                        {t('propLxcDirectives')}
                        <span className="text-gray-600">({rows.length})</span>
                    </label>
                    <span className="text-[10px] text-gray-500">{t('propLxcHint')}</span>
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                    {rows.map((r, i) => (
                        <div key={i} className="flex items-center gap-1.5 group">
                            <input
                                type="text"
                                value={r.key}
                                onChange={(e) => {
                                    const next = [...rows];
                                    next[i] = { ...r, key: e.target.value.trim() };
                                    updateRows(next);
                                }}
                                placeholder="lxc.cgroup2.devices.allow"
                                className={`${inputCls} flex-[2]`}
                            />
                            <input
                                type="text"
                                value={r.value}
                                onChange={(e) => {
                                    const next = [...rows];
                                    next[i] = { ...r, value: e.target.value };
                                    updateRows(next);
                                }}
                                placeholder="c 188:* rwm"
                                className={`${inputCls} flex-[3]`}
                            />
                            <button
                                onClick={() => updateRows(rows.filter((_, j) => j !== i))}
                                className="p-0.5 rounded text-red-400 hover:bg-red-500/20 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                title={t('remove')}
                            >
                                <Icons.X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>
                <div className="flex items-center gap-1.5 pt-1 border-t border-proxmox-border/50">
                    <input
                        type="text"
                        value={lxcAddKey}
                        onChange={(e) => setLxcAddKey(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && lxcAddKey.trim()) {
                                updateRows([...rows, { key: lxcAddKey.trim(), value: lxcAddValue }]);
                                setLxcAddKey('');
                                setLxcAddValue('');
                            }
                        }}
                        placeholder="lxc.cgroup2.devices.allow"
                        className={`${inputCls} flex-[2]`}
                    />
                    <input
                        type="text"
                        value={lxcAddValue}
                        onChange={(e) => setLxcAddValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && lxcAddKey.trim()) {
                                updateRows([...rows, { key: lxcAddKey.trim(), value: lxcAddValue }]);
                                setLxcAddKey('');
                                setLxcAddValue('');
                            }
                        }}
                        placeholder="c 188:* rwm"
                        className={`${inputCls} flex-[3]`}
                    />
                    <button
                        onClick={() => {
                            if (lxcAddKey.trim()) {
                                updateRows([...rows, { key: lxcAddKey.trim(), value: lxcAddValue }]);
                                setLxcAddKey('');
                                setLxcAddValue('');
                            }
                        }}
                        disabled={!lxcAddKey.trim()}
                        className="px-2 py-1 bg-proxmox-orange rounded text-white text-xs hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    >
                        {t('add')}
                    </button>
                </div>
            </div>
        );
    }

    // Collect fields from schema + any extra keys present in the value but not in
    // the schema (so we never silently lose unknown sub-properties).
    const schemaKeys = new Set(schema.fields.map(f => f.key));
    const extraKeys = Object.keys(parsed).filter(k => !schemaKeys.has(k) && !k.startsWith('_'));

    return (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {schema.fields.map(field => {
                const val = parsed[field.key] ?? '';
                const fieldHelp = field.help || (PROPERTY_HELP && PROPERTY_HELP[field.label]);
                const helpTitle = fieldHelp ? t(fieldHelp) : undefined;
                if (field.type === 'readonly') {
                    return (
                        <div key={field.key} className="col-span-2">
                            <label className={labelCls} title={helpTitle}>{t(field.label)}</label>
                            <div className="px-2 py-1 bg-proxmox-darker border border-proxmox-border/50 rounded text-xs font-mono text-gray-400 truncate" title={val}>
                                {val || <span className="italic text-gray-600">{t('propNotSet')}</span>}
                            </div>
                        </div>
                    );
                }
                if (field.type === 'flag') {
                    return (
                        <label key={field.key} title={helpTitle} className="flex items-center gap-2 cursor-pointer text-sm text-gray-300 col-span-1">
                            <input
                                type="checkbox"
                                checked={val === '1'}
                                onChange={(e) => handleFieldChange(field.key, e.target.checked ? '1' : '0')}
                                className="w-3.5 h-3.5 rounded"
                            />
                            <span className="text-xs text-gray-400">{t(field.label)}</span>
                        </label>
                    );
                }
                if (field.type === 'select') {
                    return (
                        <div key={field.key}>
                            <label className={labelCls} title={helpTitle}>{t(field.label)}</label>
                            <select
                                value={val}
                                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                                className={isCorporate ? 'corp-input' : 'w-full px-2 py-1 bg-proxmox-darker border border-proxmox-border rounded text-white text-sm focus:outline-none focus:border-proxmox-orange'}
                            >
                                {field.options.map(opt => (
                                    <option key={opt} value={opt}>{opt || `(${t('default')})`}</option>
                                ))}
                            </select>
                        </div>
                    );
                }
                // text
                return (
                    <div key={field.key}>
                        <label className={labelCls} title={helpTitle}>{t(field.label)}</label>
                        <input
                            type="text"
                            value={val}
                            onChange={(e) => handleFieldChange(field.key, e.target.value)}
                            placeholder={field.placeholder || ''}
                            className={inputCls}
                        />
                    </div>
                );
            })}
            {/* Render any extra sub-keys not covered by the schema so nothing is lost */}
            {extraKeys.map(k => (
                <div key={k}>
                    <label className={labelCls}>{k}</label>
                    <input
                        type="text"
                        value={parsed[k] || ''}
                        onChange={(e) => handleFieldChange(k, e.target.value)}
                        className={inputCls}
                    />
                </div>
            ))}
        </div>
    );
}

// Keys that PVE stores as 0/1 flags -> rendered as a checkbox instead of a text field.
// Deliberately a fixed list: numeric fields like `cores` are also often "1".
const RAW_FLAG_KEYS = /^(onboot|protection|unprivileged|tablet|localtime|acpi|kvm|freeze|autostart|template|reboot)$/;

// Category buckets for grouping. First match wins, `other` is the catch-all.
const RAW_CONFIG_GROUPS = [
    { id: 'disks', labelKey: 'disks', test: (k) => /^(scsi|sata|virtio|ide|unused|efidisk|tpmstate|mp)\d*$/.test(k) || k === 'rootfs' },
    { id: 'network', labelKey: 'network', test: (k) => /^(net|ipconfig)\d+$/.test(k) || /^(nameserver|searchdomain)$/.test(k) },
    { id: 'compute', labelKey: 'rawGroupCompute', test: (k) => /^(cores|sockets|cpu|cpulimit|cpuunits|vcpus|numa|memory|balloon|shares|hugepages|affinity|swap|arch)$/.test(k) },
    { id: 'boot', labelKey: 'rawGroupBoot', test: (k) => /^(boot|bootdisk|onboot|startup|reboot|hotplug|autostart|template|protection)$/.test(k) },
    { id: 'devices', labelKey: 'rawGroupDevices', test: (k) => /^(hostpci|usb|serial|audio|rng|parallel)\d*$/.test(k) || /^(vga|watchdog|machine|bios|tablet)$/.test(k) },
    { id: 'guest', labelKey: 'rawGroupGuest', test: (k) => /^ci[a-z]*$/.test(k) || /^(agent|ostype|features|unprivileged|tags|localtime|timezone|keyboard|tty|console|cmode|args|hookscript|vmgenid|smbios1|sshkeys)$/.test(k) },
    { id: 'other', labelKey: 'other', test: () => true }
];

const rawGroupOf = (key) => (RAW_CONFIG_GROUPS.find(g => g.test(key)) || RAW_CONFIG_GROUPS[RAW_CONFIG_GROUPS.length - 1]).id;

function RawConfigEditor({ rawValues, keys, changes, deletes, onChange, onRevert, onToggleDelete, isCorporate, addToast }) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [onlyModified, setOnlyModified] = useState(false);
    const [mode, setMode] = useState('table');
    const [collapsed, setCollapsed] = useState({});
    const [newKey, setNewKey] = useState('');
    const [newValue, setNewValue] = useState('');
    const [newKeyError, setNewKeyError] = useState('');
    const [draft, setDraft] = useState(null);      // text-mode buffer (null = not editing)
    const [draftError, setDraftError] = useState('');
    // (structured-raw-config): per-key toggle between structured (form) and raw (text)
    // editing for property-string values.  Keys not in this map default to structured
    // when a matching schema exists.
    const [rawModeKeys, setRawModeKeys] = useState({});

    const valueOf = (key) => String((key in changes ? changes[key] : rawValues[key]) ?? '');
    const isAdded = (key) => !(key in rawValues);
    const isModified = (key) => key in changes && !isAdded(key) && String(changes[key]) !== String(rawValues[key] ?? '');
    const isDeleted = (key) => deletes.includes(key);

    const modifiedCount = keys.filter(k => isModified(k) || isAdded(k) || isDeleted(k)).length;

    // Filter + group. Search matches key and value so users can find e.g. "local-lvm".
    const visible = keys.filter(k => {
        if (onlyModified && !(isModified(k) || isAdded(k) || isDeleted(k))) return false;
        if (!query.trim()) return true;
        const q = query.trim().toLowerCase();
        return k.toLowerCase().includes(q) || valueOf(k).toLowerCase().includes(q);
    });
    const groups = RAW_CONFIG_GROUPS
        .map(g => ({ ...g, items: visible.filter(k => rawGroupOf(k) === g.id) }))
        .filter(g => g.items.length > 0);

    const copyValue = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            addToast?.(t('copied'), 'success');
        } catch (e) {
            addToast?.(t('rawConfigCopyFailed'), 'error');
        }
    };

    const submitNewKey = () => {
        const key = newKey.trim();
        if (!key) return;
        if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key)) { setNewKeyError(t('rawConfigInvalidKey')); return; }
        if (keys.includes(key)) { setNewKeyError(t('rawConfigKeyExists')); return; }
        setNewKeyError('');
        onChange(key, newValue.trim());
        setNewKey('');
        setNewValue('');
    };

    // Text mode: `key: value` per line, applied explicitly so a stray keystroke
    // cannot silently drop a key.
    const draftText = draft !== null ? draft : keys.filter(k => !isDeleted(k)).map(k => `${k}: ${valueOf(k)}`).join('\n');

    const applyDraft = () => {
        const parsed = {};
        const badLines = [];
        draftText.split('\n').forEach((line, i) => {
            const s = line.trim();
            if (!s || s.startsWith('#')) return;
            const colon = s.indexOf(':');
            const eq = s.indexOf('=');
            const sep = colon === -1 ? eq : (eq !== -1 && eq < colon ? eq : colon);
            if (sep <= 0) { badLines.push(i + 1); return; }
            parsed[s.slice(0, sep).trim()] = s.slice(sep + 1).trim();
        });
        const invalidKey = Object.keys(parsed).find(k => !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(k));
        if (badLines.length || invalidKey) {
            setDraftError(badLines.length
                ? t('rawConfigTextInvalid', { params: { lines: badLines.join(', ') } })
                : t('rawConfigInvalidKey'));
            return;
        }
        Object.entries(parsed).forEach(([k, v]) => {
            if (valueOf(k) !== v) onChange(k, v);
            if (isDeleted(k)) onToggleDelete(k);   // key came back -> un-stage removal
        });
        keys.forEach(k => {
            if (k in parsed || isDeleted(k)) return;
            if (isAdded(k)) onRevert(k); else onToggleDelete(k);
        });
        setDraftError('');
        setDraft(null);
        setMode('table');
        addToast?.(t('rawConfigApplied'), 'success');
    };

    const toolbarBtn = (active) => `px-2 py-1 rounded text-xs transition-colors ${active
        ? 'bg-proxmox-orange text-white'
        : 'text-gray-400 hover:text-white hover:bg-proxmox-hover'}`;
    const iconBtn = 'p-1 rounded text-gray-400 hover:text-white hover:bg-proxmox-hover transition-colors';
    const inputCls = isCorporate ? 'corp-input' : 'w-full px-2 py-1.5 bg-proxmox-darker border border-proxmox-border rounded text-white text-sm font-mono focus:outline-none focus:border-proxmox-orange';

    const renderRow = (key) => {
        const value = valueOf(key);
        const deleted = isDeleted(key);
        const added = isAdded(key);
        const modified = isModified(key);
        const pairs = value.includes('=') ? value.split(',').filter(p => p.includes('=')) : [];
        const isFlag = RAW_FLAG_KEYS.test(key) && (value === '0' || value === '1' || value === '');
        const long = value.length > 58;

        // (structured-raw-config): check if this key has a property-string schema.
        // If so, default to structured view unless the user toggled to raw.
        const schema = !deleted ? _findSchema(key, value) : null;
        const hasStructured = !!schema;
        const showStructured = hasStructured && !rawModeKeys[key];

        let stateCls = 'border-proxmox-border bg-proxmox-darker';
        if (deleted) stateCls = 'border-red-500/30 bg-red-500/10';
        else if (added || modified) stateCls = 'border-proxmox-orange bg-proxmox-card';

        return (
            <div key={key} className={`flex flex-wrap items-start gap-3 px-3 py-2 rounded-md border ${stateCls}`}>
                <div className="w-48 shrink-0 min-w-0">
                    <div className={`text-xs font-mono truncate ${deleted ? 'text-red-400 line-through' : 'text-gray-200'}`} title={key}>{key}</div>
                    <div className="text-xs text-gray-500 truncate">
                        {deleted ? t('rawConfigPendingDelete')
                            : added ? t('rawConfigAdded')
                                : modified ? t('rawConfigModifiedLabel')
                                    : ''}
                    </div>
                    {/* (structured-raw-config): toggle between structured form and raw text */}
                    {hasStructured && !deleted && (
                        <button
                            onClick={() => setRawModeKeys(prev => ({ ...prev, [key]: !prev[key] }))}
                            className="mt-1 flex items-center gap-1 text-xs text-gray-500 hover:text-proxmox-orange transition-colors"
                            title={showStructured ? t('propSwitchRaw') : t('propSwitchForm')}
                        >
                            {showStructured ? (
                                <><Icons.FileText className="w-3 h-3" /><span>{t('propRawMode')}</span></>
                            ) : (
                                <><Icons.Grid className="w-3 h-3" /><span>{t('propFormMode')}</span></>
                            )}
                        </button>
                    )}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                    {showStructured ? (
                        // (structured-raw-config): render the structured form for this property string
                        <PropertyStringEditor
                            configKey={key}
                            value={value}
                            schema={schema}
                            onChange={(newVal) => onChange(key, newVal)}
                            isCorporate={isCorporate}
                            t={t}
                        />
                    ) : isFlag ? (
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                            <input
                                type="checkbox"
                                disabled={deleted}
                                checked={value === '1'}
                                onChange={(e) => onChange(key, e.target.checked ? '1' : '0')}
                                className="w-4 h-4"
                            />
                            <span className="font-mono text-xs text-gray-400">{value || '0'}</span>
                        </label>
                    ) : long ? (
                        <textarea
                            rows={Math.min(5, Math.ceil(value.length / 70) + 1)}
                            disabled={deleted}
                            value={value}
                            onChange={(e) => onChange(key, e.target.value)}
                            className={`${inputCls} resize-y whitespace-pre-wrap`}
                        />
                    ) : (
                        <input
                            type="text"
                            disabled={deleted}
                            value={value}
                            onChange={(e) => onChange(key, e.target.value)}
                            className={inputCls}
                        />
                    )}
                    {/* Only show chips in raw mode when not using structured editor */}
                    {!showStructured && pairs.length > 1 && !deleted && (
                        <div className="flex flex-wrap gap-1">
                            {pairs.map((p, i) => (
                                <span key={`${key}-${i}`} className="px-2 py-1 rounded bg-proxmox-dark border border-proxmox-border text-xs font-mono text-gray-400 break-all">{p}</span>
                            ))}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {(modified || added) && (
                        <button onClick={() => onRevert(key)} className={iconBtn} title={t('revert')}>
                            <Icons.RotateCcw />
                        </button>
                    )}
                    <button onClick={() => copyValue(`${key}: ${value}`)} className={iconBtn} title={t('copy')}>
                        <Icons.Copy />
                    </button>
                    <button
                        onClick={() => (added ? onRevert(key) : onToggleDelete(key))}
                        className={`p-1 rounded transition-colors ${deleted ? 'text-green-400 hover:bg-proxmox-hover' : 'text-red-400 hover:bg-red-500/20'}`}
                        title={deleted ? t('rawConfigKeepKey') : t('rawConfigRemoveKey')}
                    >
                        {deleted ? <Icons.RotateCcw /> : <Icons.Trash2 />}
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="p-4 bg-proxmox-dark rounded-lg border border-proxmox-border space-y-3">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <label className={isCorporate ? 'corp-label' : 'text-sm font-medium text-gray-300'}>{t('advanced2')}</label>
                        <span className="px-2 py-1 rounded-full bg-proxmox-darker border border-proxmox-border text-xs text-gray-400">
                            {t('rawConfigKeyCount', { params: { count: keys.length } })}
                        </span>
                        {modifiedCount > 0 && (
                            <span className="px-2 py-1 rounded-full bg-proxmox-orange text-xs text-white">
                                {t('rawConfigPendingCount', { params: { count: modifiedCount } })}
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{t('advancedHint')}</p>
                </div>
                <div className="flex items-center gap-1 p-1 bg-proxmox-darker border border-proxmox-border rounded-md">
                    <button onClick={() => setMode('table')} className={toolbarBtn(mode === 'table')}>{t('rawConfigViewTable')}</button>
                    <button onClick={() => { setDraft(null); setDraftError(''); setMode('text'); }} className={toolbarBtn(mode === 'text')}>{t('rawConfigViewText')}</button>
                </div>
            </div>

            {mode === 'table' ? (
                <>
                    {/* Toolbar */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 bg-proxmox-darker border border-proxmox-border rounded">
                            <Icons.Search className="w-4 h-4 text-gray-500" />
                            <input
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={t('rawConfigSearch')}
                                className="flex-1 min-w-0 bg-proxmox-darker text-white text-sm focus:outline-none placeholder-gray-500"
                            />
                            {query && (
                                <button onClick={() => setQuery('')} className={iconBtn} title={t('reset')}><Icons.X /></button>
                            )}
                        </div>
                        <button
                            onClick={() => setOnlyModified(v => !v)}
                            className={`px-2 py-1.5 rounded border text-xs transition-colors ${onlyModified
                                ? 'border-proxmox-orange text-proxmox-orange bg-proxmox-card'
                                : 'border-proxmox-border text-gray-400 hover:text-white hover:bg-proxmox-hover'}`}
                        >
                            {t('rawConfigOnlyModified')}
                        </button>
                    </div>

                    {/* Grouped rows */}
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                        {groups.map(g => (
                            <div key={g.id} className="space-y-2">
                                <button
                                    onClick={() => setCollapsed(prev => ({ ...prev, [g.id]: !prev[g.id] }))}
                                    className="flex items-center gap-2 w-full text-left text-xs uppercase tracking-wide text-gray-500 hover:text-gray-300 transition-colors"
                                >
                                    {collapsed[g.id] ? <Icons.ChevronRight /> : <Icons.ChevronDown />}
                                    <span>{t(g.labelKey)}</span>
                                    <span className="text-gray-600">({g.items.length})</span>
                                </button>
                                {!collapsed[g.id] && <div className="space-y-2">{g.items.map(renderRow)}</div>}
                            </div>
                        ))}
                        {groups.length === 0 && (
                            <div className="px-3 py-6 text-center text-xs text-gray-500 border border-proxmox-border rounded-md bg-proxmox-darker">
                                {keys.length === 0 ? t('rawConfigEmpty') : t('rawConfigNoMatches')}
                            </div>
                        )}
                    </div>

                    {/* Add key */}
                    <div className="pt-3 border-t border-proxmox-border space-y-1">
                        <div className="flex flex-wrap items-end gap-2">
                            <div className="w-48 shrink-0">
                                <label className="block text-xs text-gray-500 mb-1">{t('rawConfigNewKey')}</label>
                                <input
                                    type="text"
                                    value={newKey}
                                    onChange={(e) => { setNewKey(e.target.value); setNewKeyError(''); }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') submitNewKey(); }}
                                    placeholder="args"
                                    className={inputCls}
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <label className="block text-xs text-gray-500 mb-1">{t('value')}</label>
                                <input
                                    type="text"
                                    value={newValue}
                                    onChange={(e) => setNewValue(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') submitNewKey(); }}
                                    placeholder="-cpu host"
                                    className={inputCls}
                                />
                            </div>
                            <button
                                onClick={submitNewKey}
                                disabled={!newKey.trim()}
                                className="px-3 py-1.5 bg-proxmox-orange rounded text-white text-xs hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {t('add')}
                            </button>
                        </div>
                        {newKeyError && <p className="text-xs text-red-400">{newKeyError}</p>}
                    </div>
                </>
            ) : (
                <>
                    <p className="text-xs text-gray-500">{t('rawConfigTextHint')}</p>
                    <textarea
                        value={draftText}
                        onChange={(e) => { setDraft(e.target.value); setDraftError(''); }}
                        spellCheck={false}
                        className="w-full h-64 px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded text-white text-sm font-mono resize-y focus:outline-none focus:border-proxmox-orange"
                    />
                    {draftError && <p className="text-xs text-red-400">{draftError}</p>}
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            onClick={applyDraft}
                            disabled={draft === null}
                            className="px-3 py-1.5 bg-proxmox-orange rounded text-white text-xs hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {t('rawConfigApply')}
                        </button>
                        <button
                            onClick={() => { setDraft(null); setDraftError(''); }}
                            disabled={draft === null}
                            className="px-3 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-gray-300 text-xs hover:bg-proxmox-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {t('reset')}
                        </button>
                        <button
                            onClick={() => copyValue(draftText)}
                            className="px-3 py-1.5 bg-proxmox-dark border border-proxmox-border rounded text-gray-300 text-xs hover:bg-proxmox-hover transition-colors"
                        >
                            {t('copy')}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

function ConfigModal({ vm, clusterId, allClusters = [], dashboardAuthFetch, onClose, addToast, isCorporate = false }) {
    const { t } = useTranslation();
    const { getAuthHeaders } = useAuth();
    const [config, setConfig] = useState(null);
    const [configError, setConfigError] = useState(null);  // Track config load errors
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState('general');
    const [changes, setChanges] = useState({});
    // (raw-config-ux): derived instead of a separate state flag. Staged raw-key removals
    // and per-key reverts both affect it, and keeping a manual flag in sync with them was
    // an easy way to leave the Save button enabled/disabled incorrectly.
    const [descEditMode, setDescEditMode] = useState(false);
    const [clusterTags, setClusterTags] = useState([]);
    const [tagInputValue, setTagInputValue] = useState('');
    const [showTagDropdown, setShowTagDropdown] = useState(false);
    // (raw-config-ux): keys staged for removal in the Advanced / Raw Config editor.
    // Sent to PVE as its `delete` parameter on save so raw keys can be removed, not
    // just blanked out.
    const [rawDeletes, setRawDeletes] = useState([]);
    // Keys added through the raw editor: they do not exist in config.raw yet, but must
    // still be listed so they can be edited or reverted before saving.
    const [rawExtraKeys, setRawExtraKeys] = useState([]);
    const hasChanges = Object.keys(changes).length > 0 || rawDeletes.length > 0;

    // Additional states for hardware options and lists
    const [hardwareOptions, setHardwareOptions] = useState(null);
    const [storageList, setStorageList] = useState([]);
    const [bridgeList, setBridgeList] = useState([]);
    const [isoList, setIsoList] = useState([]);
    const [dcMacPrefix, setDcMacPrefix] = useState('');  // (#365): datacenter MAC prefix for generateMAC

    // Snapshot states
    const [snapshots, setSnapshots] = useState([]);
    const [snapshotLoading, setSnapshotLoading] = useState(false);
    const [showCreateSnapshot, setShowCreateSnapshot] = useState(false);

    // Efficient snapshot states
    const [efficientSnapshots, setEfficientSnapshots] = useState([]);
    const [efficientInfo, setEfficientInfo] = useState(null);
    // Guest-level snapshot capability used to disable creation on configs that
    // Proxmox cannot snapshot (e.g. raw devices, certain LXC storage).
    const [snapshotCapability, setSnapshotCapability] = useState({ can_snapshot: true });

    // Replication states
    const [replications, setReplications] = useState([]);

    // Backup states
    const [vmBackups, setVmBackups] = useState([]);
    const [backupLoading, setBackupLoading] = useState(false);
    const [showCreateBackup, setShowCreateBackup] = useState(false);
    const [showRestoreBackup, setShowRestoreBackup] = useState(null);
    const [verifyingBackup, setVerifyingBackup] = useState(null);
    const [verifyResults, setVerifyResults] = useState({});
    const verifyPollRef = useRef(null);
    // cleanup verify poll on unmount
    useEffect(() => () => { if (verifyPollRef.current) clearInterval(verifyPollRef.current); }, []);

    // History states
    const [vmProxmoxTasks, setVmProxmoxTasks] = useState([]);
    const [vmProxmoxVExActions, setVmProxmoxVExActions] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historySubTab, setHistorySubTab] = useState('proxmox');

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
    const [replicationLoading, setReplicationLoading] = useState(false);
    const [showCreateReplication, setShowCreateReplication] = useState(false);
    const [clusterNodes, setClusterNodes] = useState([]);
    const [allClusterNodes, setAllClusterNodes] = useState([]);
    const [crossClusterRepls, setCrossClusterRepls] = useState([]); // Cross-cluster DR jobs
    const [showCreateXRepl, setShowCreateXRepl] = useState(false);
    const [xReplForm, setXReplForm] = useState({ target_cluster: '', target_storage: '', target_bridge: 'vmbr0', target_vmid: '', schedule: '0 */6 * * *', retention: 3 });
    // Target cluster resources for cross-cluster replication dropdowns
    const [xReplTargetStorages, setXReplTargetStorages] = useState([]);
    const [xReplTargetBridges, setXReplTargetBridges] = useState([]);
    const [xReplLoadingResources, setXReplLoadingResources] = useState(false);
    // #532 - per-source-bridge -> target-bridge map so a multi-NIC VM keeps each card on its own net
    const [xReplBridgeMap, setXReplBridgeMap] = useState({});

    // Modal states for sub-dialogs
    const [showAddDisk, setShowAddDisk] = useState(false);
    const [showAddNetwork, setShowAddNetwork] = useState(false);
    const [showEditNetwork, setShowEditNetwork] = useState(null);
    const [showMoveDisk, setShowMoveDisk] = useState(null);
    const [showResizeDisk, setShowResizeDisk] = useState(null);
    const [showEditDisk, setShowEditDisk] = useState(null);  // Edit disk bus type
    const [showReattachDisk, setShowReattachDisk] = useState(null);  // Reattach unused disk modal
    const [showMountISO, setShowMountISO] = useState(false);
    // When "Change ISO" is clicked on an existing cdrom row,
    // we open the same MountISOModal but pre-select that drive.
    const [mountIsoInitialDrive, setMountIsoInitialDrive] = useState(null);
    const [showImportDisk, setShowImportDisk] = useState(false);  // Import disk from storage
    const [showReassignOwner, setShowReassignOwner] = useState(null);  // Reassign disk to another VM
    const [importableDisks, setImportableDisks] = useState([]);  // List of importable disk images

    // PCI/USB/Serial Passthrough states
    const [passthrough, setPassthrough] = useState({ pci: [], usb: [], serial: [] });
    const [availablePci, setAvailablePci] = useState([]);
    const [availableUsb, setAvailableUsb] = useState([]);
    const [showAddPci, setShowAddPci] = useState(false);
    const [showAddUsb, setShowAddUsb] = useState(false);
    const [showAddSerial, setShowAddSerial] = useState(false);
    const [showAddEfiDisk, setShowAddEfiDisk] = useState(false);  // EFI Disk modal
    const [showAddTpm, setShowAddTpm] = useState(false);          // TPM modal
    const [efiStorage, setEfiStorage] = useState('');             // Selected storage for EFI
    const [tpmStorage, setTpmStorage] = useState('');             // Selected storage for TPM
    const [selectedPciDevice, setSelectedPciDevice] = useState(null);
    const [selectedUsbDevice, setSelectedUsbDevice] = useState(null);
    const [pciOptions, setPciOptions] = useState({ pcie: true, rombar: true });
    const [usbOptions, setUsbOptions] = useState({ usb3: false });
    const [serialType, setSerialType] = useState('socket');
    const [passthroughLoading, setPassthroughLoading] = useState(false);

    // Firewall states
    const [fwOptions, setFwOptions] = useState({});
    const [fwRules, setFwRules] = useState([]);
    const [fwAliases, setFwAliases] = useState([]);
    const [fwIpsets, setFwIpsets] = useState([]);
    const [fwLog, setFwLog] = useState([]);
    const [fwRefs, setFwRefs] = useState([]);
    const [fwLoading, setFwLoading] = useState(false);
    const [showAddFwRule, setShowAddFwRule] = useState(false);
    const [newFwRule, setNewFwRule] = useState({ type: 'in', action: 'ACCEPT', enable: 1 });
    const [showAddFwAlias, setShowAddFwAlias] = useState(false);
    const [newFwAlias, setNewFwAlias] = useState({ name: '', cidr: '', comment: '' });
    const [showAddFwIpset, setShowAddFwIpset] = useState(false);
    const [newFwIpset, setNewFwIpset] = useState({ name: '', comment: '' });
    const [expandedIpset, setExpandedIpset] = useState(null);
    const [newIpsetCidr, setNewIpsetCidr] = useState('');
    const [fwSubTab, setFwSubTab] = useState('rules');

    const isQemu = vm.type === 'qemu';
    // Snapshot creation is allowed only when the guest reports full capability
    // without warnings (raw disks, passthrough, unsupported LXC storage, etc.).
    const canCreateSnapshots = snapshotCapability?.can_snapshot && !(snapshotCapability?.warnings?.length);

    // (modal-perf): fire the ~14 open-time fetches ONLY when the
    // target VM/cluster changes. This effect previously ALSO depended on
    // hasChanges + saving, so every keystroke (hasChanges false->true) and every
    // save re-ran the WHOLE fetch storm — including the slow PCI/USB passthrough
    // node-scan and the backup-catalog fetch — which is exactly what made the
    // config modal lag while editing. The SSE listener is split out below.
    useEffect(() => {
        fetchConfig();
        fetchHardwareOptions();
        fetchStorageList();
        fetchBridgeList();
        if (isQemu) {
            fetchISOList();
        }
        fetchSnapshots();
        fetchEfficientSnapshots();
        fetchEfficientInfo();
        fetchSnapshotCapability();
        fetchReplications();
        fetchCrossClusterRepls();
        fetchBackups();
        fetchClusterNodes();

        // Fetch unique Proxmox tags from cluster resources for tag selector
        authFetch(`${API_URL}/clusters/${clusterId}/resources`)
            .then(r => r && r.ok ? r.json() : [])
            .then(data => {
                const tagSet = new Set();
                (Array.isArray(data) ? data : []).forEach(vm => {
                    if (vm.tags) {
                        const tags = Array.isArray(vm.tags) ? vm.tags : vm.tags.split(';');
                        tags.filter(t => t.trim()).forEach(t => tagSet.add(t.trim()));
                    }
                });
                setClusterTags(Array.from(tagSet).sort().map(name => ({ name })));
            })
            .catch(() => { });
    }, [vm, clusterId]);

    // SSE vm_config live-update listener - split from the fetch effect so
    // re-subscribing when the user's edit state changes never re-fires the
    // fetches above (add/removeEventListener is cheap, no network).
    useEffect(() => {
        const handleVmConfigUpdate = (event) => {
            const { vmid: eventVmid, vm_type, config: newConfig } = event.detail;
            // Only update if this is our VM and user has no pending changes
            if (eventVmid === vm.vmid && vm_type === vm.type && !hasChanges && !saving) {
                ProxmoxVExLog.debug('SSE: Updating config for', vm.vmid);
                setConfig(prev => ({
                    ...prev,
                    ...newConfig,
                    // Preserve some local state
                    disks: newConfig.disks || prev?.disks,
                    unused_disks: newConfig.unused_disks || prev?.unused_disks,
                    options: {
                        ...prev?.options,
                        ...newConfig.options
                    },
                    raw: {
                        ...prev?.raw,
                        ...newConfig.raw
                    }
                }));
            }
        };

        window.addEventListener('ProxmoxVEx-vm-config', handleVmConfigUpdate);
        return () => window.removeEventListener('ProxmoxVEx-vm-config', handleVmConfigUpdate);
    }, [vm, clusterId, hasChanges, saving]);

    // Auto-fetch history when history tab is selected
    useEffect(() => {
        if (activeTab === 'history') {
            fetchHistory();
        }
    }, [activeTab]);

    useEffect(() => {
        if (activeTab === 'firewall') {
            fetchFirewallData();
        }
        if (activeTab === 'backups') {
            fetchBackups();
        }
    }, [activeTab]);

    // (modal-perf): the PCI/USB passthrough scan enumerates node
    // hardware (~900ms of lspci/lsusb on the node) and is only shown on the
    // Hardware/Resources tab — fetch it on tab entry instead of on every modal
    // open (default tab is 'general'). Mirrors the history/firewall gating above.
    useEffect(() => {
        if (isQemu && (activeTab === 'hardware' || activeTab === 'resources')) {
            fetchPassthrough();
        }
    }, [activeTab, vm, clusterId]);

    const fetchPassthrough = async () => {
        if (vm.type !== 'qemu') return;
        try {
            // Fetch current passthrough config
            const ptRes = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/qemu/${vm.vmid}/passthrough`);
            if (ptRes && ptRes.ok) {
                setPassthrough(await ptRes.json());
            }

            // Fetch available PCI devices
            const pciRes = await authFetch(`${API_URL}/clusters/${clusterId}/nodes/${vm.node}/hardware/pci`);
            if (pciRes && pciRes.ok) {
                setAvailablePci(await pciRes.json());
            }

            // Fetch available USB devices
            const usbRes = await authFetch(`${API_URL}/clusters/${clusterId}/nodes/${vm.node}/hardware/usb`);
            if (usbRes && usbRes.ok) {
                setAvailableUsb(await usbRes.json());
            }
        } catch (error) {
            console.error('to load passthrough:', error);
        }
    };

    const handleAddPciDevice = async () => {
        if (!selectedPciDevice) return;
        setPassthroughLoading(true);
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/qemu/${vm.vmid}/passthrough/pci`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_id: selectedPciDevice.id,
                    pcie: pciOptions.pcie,
                    rombar: pciOptions.rombar
                })
            });
            if (response && response.ok) {
                setShowAddPci(false);
                setSelectedPciDevice(null);
                fetchPassthrough();
                addToast(t('deviceAdded'));
            } else {
                const err = await response.json();
                addToast(err.error || t('operationFailed'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setPassthroughLoading(false);
    };

    const handleAddUsbDevice = async () => {
        if (!selectedUsbDevice) return;
        setPassthroughLoading(true);
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/qemu/${vm.vmid}/passthrough/usb`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vendorid: selectedUsbDevice.vendid,
                    productid: selectedUsbDevice.prodid,
                    usb3: usbOptions.usb3
                })
            });
            if (response && response.ok) {
                setShowAddUsb(false);
                setSelectedUsbDevice(null);
                fetchPassthrough();
                addToast(t('deviceAdded'));
            } else {
                const err = await response.json();
                addToast(err.error || t('operationFailed'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setPassthroughLoading(false);
    };

    const handleAddSerialPort = async () => {
        setPassthroughLoading(true);
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/qemu/${vm.vmid}/passthrough/serial`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: serialType })
            });
            if (response && response.ok) {
                setShowAddSerial(false);
                fetchPassthrough();
                addToast(t('deviceAdded'));
            } else {
                const err = await response.json();
                addToast(err.error || t('operationFailed'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setPassthroughLoading(false);
    };

    const handleRemovePassthrough = async (type, key) => {
        if (!confirm(`${key} ${t('remove')}?`)) return;
        setPassthroughLoading(true);
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/qemu/${vm.vmid}/passthrough/${type}/${key}`,
                { method: 'DELETE' }
            );
            if (response && response.ok) {
                fetchPassthrough();
                addToast(t('deviceRemoved'));
            } else {
                addToast(t('operationFailed'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setPassthroughLoading(false);
    };

    const fetchConfig = async (retryCount = 0) => {
        setLoading(true);
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/config`
            );
            if (response && response.ok) {
                const data = await response.json();
                setConfig(data);
                setConfigError(null);  // Clear any previous error
            } else if (response) {
                // API returned error status
                const errText = await response.text();
                setConfigError(t('configLoadError'));
                console.error('Config load failed:', errText);
            }
        } catch (error) {
            console.error('Failed to load config:', error);
            // Retry up to 2 times with increasing delay
            if (retryCount < 2) {
                setTimeout(() => fetchConfig(retryCount + 1), 1000 * (retryCount + 1));
                return;
            }
            setConfigError(t('configLoadError'));
        }
        setLoading(false);
    };

    const fetchHardwareOptions = async () => {
        try {
            const response = await authFetch(`${API_URL}/hardware-options`);
            if (response && response.ok) {
                setHardwareOptions(await response.json());
            }
        } catch (error) {
            console.error('to load hardware options:', error);
        }
    };

    const fetchStorageList = async () => {
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/nodes/${vm.node}/storage`);
            if (response && response.ok) {
                setStorageList(await response.json());
            }
        } catch (error) {
            console.error('to load storage list:', error);
        }
    };

    const fetchBridgeList = async () => {
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/nodes/${vm.node}/networks`);
            if (response && response.ok) {
                setBridgeList(await response.json());
            }
        } catch (error) {
            console.error('to load bridge list:', error);
        }
    };

    const fetchISOList = async () => {
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/nodes/${vm.node}/isos`);
            if (response && response.ok) {
                setIsoList(await response.json());
            }
        } catch (error) {
            console.error('to load ISO list:', error);
        }
    };

    const fetchSnapshots = async () => {
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/snapshots`);
            if (response && response.ok) {
                setSnapshots(await response.json());
            }
        } catch (error) {
            console.error('to load snapshots:', error);
        }
    };

    // Fetch efficient snapshots + capability
    const fetchEfficientSnapshots = async () => {
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/efficient-snapshots?refresh=true`);
            if (response && response.ok) {
                setEfficientSnapshots(await response.json());
            }
        } catch (error) {
            console.error('Failed to load efficient snapshots:', error);
        }
    };

    const fetchEfficientInfo = async () => {
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/snapshot-capability`);
            if (response && response.ok) {
                const data = await response.json();
                setEfficientInfo(data.efficient_snapshot || null);
            }
        } catch (error) {
            // Not critical - just means efficient snapshots won't be offered
        }
    };

    const fetchSnapshotCapability = async () => {
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/snapshot-capability`);
            if (response && response.ok) {
                const data = await response.json();
                setSnapshotCapability(data);
            }
        } catch (error) {
            // Default to allowing snapshots if the capability check fails.
        }
    };

    const fetchReplications = async () => {
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/replication?vmid=${vm.vmid}`);
            if (response && response.ok) {
                setReplications(await response.json());
            }
        } catch (error) {
            console.error('to load replications:', error);
        }
    };

    // Fetch cross-cluster replication jobs for this VM
    const fetchCrossClusterRepls = async () => {
        try {
            const response = await authFetch(`${API_URL}/cross-cluster-replications?vmid=${vm.vmid}`);
            if (response && response.ok) {
                setCrossClusterRepls(await response.json());
            }
        } catch (e) {
            console.error('cross-cluster repl fetch:', e);
        }
    };

    // Fetch target cluster storages/bridges when target cluster changes
    useEffect(() => {
        if (!xReplForm.target_cluster || !dashboardAuthFetch) return;
        let cancelled = false;
        const fetchTargetResources = async () => {
            setXReplLoadingResources(true);
            setXReplTargetStorages([]);
            setXReplTargetBridges([]);
            try {
                const nodesRes = await dashboardAuthFetch(`${API_URL}/clusters/${xReplForm.target_cluster}/nodes`);
                if (!nodesRes.ok || cancelled) return;
                const nodesData = await nodesRes.json();
                const onlineNode = (Array.isArray(nodesData) ? nodesData : nodesData.nodes || []).find(n => n.status === 'online');
                if (!onlineNode || cancelled) return;
                const nodeName = onlineNode.node || onlineNode.name;
                const [storRes, netRes] = await Promise.all([
                    dashboardAuthFetch(`${API_URL}/clusters/${xReplForm.target_cluster}/nodes/${nodeName}/storage`),
                    dashboardAuthFetch(`${API_URL}/clusters/${xReplForm.target_cluster}/nodes/${nodeName}/networks`)
                ]);
                if (cancelled) return;
                if (storRes.ok) {
                    const storData = await storRes.json();
                    const storages = (Array.isArray(storData) ? storData : storData.storages || [])
                        .filter(s => s.content && (s.content.includes('images') || s.content.includes('rootdir')));
                    setXReplTargetStorages(storages);
                }
                if (netRes.ok) {
                    const netData = await netRes.json();
                    const bridges = (Array.isArray(netData) ? netData : netData.networks || [])
                        .filter(n => n.type === 'bridge' || n.type === 'OVSBridge' || n.source === 'sdn');
                    setXReplTargetBridges(bridges);
                    // #532 - seed the per-NIC bridge map: default each source bridge to the
                    // same-named target bridge (they usually exist on both), else first avail.
                    const avail = bridges.map(b => b.iface);
                    const fallback = avail[0] || 'vmbr0';
                    const srcBridges = [...new Set((config?.networks || []).map(n => n.bridge).filter(Boolean))];
                    const seeded = {};
                    srcBridges.forEach(sb => { seeded[sb] = avail.includes(sb) ? sb : fallback; });
                    setXReplBridgeMap(seeded);
                }
            } catch (err) {
                console.error('Error fetching target cluster resources:', err);
            }
            if (!cancelled) setXReplLoadingResources(false);
        };
        fetchTargetResources();
        return () => { cancelled = true; };
    }, [xReplForm.target_cluster]);

    // Fetch backups for this VM
    const fetchBackups = async () => {
        setBackupLoading(true);
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/backups`);
            if (response && response.ok) {
                setVmBackups(await response.json());
            }
        } catch (error) {
            console.error('failed to load backups:', error);
        } finally {
            setBackupLoading(false);
        }
    };

    // Fetch VM History (Proxmox Tasks + ProxmoxVEx Audit)
    const fetchHistory = async () => {
        setHistoryLoading(true);
        try {
            // Fetch Proxmox tasks for this VM
            const tasksRes = await authFetch(`${API_URL}/clusters/${clusterId}/nodes/${vm.node}/tasks?vmid=${vm.vmid}&limit=50`);
            if (tasksRes && tasksRes.ok) {
                setVmProxmoxTasks(await tasksRes.json());
            }

            // Fetch ProxmoxVEx audit log for this VM
            const auditRes = await authFetch(`${API_URL}/clusters/${clusterId}/audit?vmid=${vm.vmid}&limit=50`);
            if (auditRes && auditRes.ok) {
                setVmProxmoxVExActions(await auditRes.json());
            }
        } catch (error) {
            console.error('Failed to load history:', error);
        } finally {
            setHistoryLoading(false);
        }
    };

    const fetchFirewallData = async () => {
        setFwLoading(true);
        try {
            const base = `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall`;
            const [optRes, rulesRes, aliasRes, ipsetRes, refsRes] = await Promise.all([
                authFetch(`${base}/options`),
                authFetch(`${base}/rules`),
                authFetch(`${base}/aliases`),
                authFetch(`${base}/ipset`),
                authFetch(`${base}/refs`)
            ]);
            if (optRes?.ok) setFwOptions(await optRes.json());
            if (rulesRes?.ok) setFwRules(await rulesRes.json());
            if (aliasRes?.ok) setFwAliases(await aliasRes.json());
            if (ipsetRes?.ok) setFwIpsets(await ipsetRes.json());
            if (refsRes?.ok) setFwRefs(await refsRes.json());
        } catch (e) {
            console.error('Failed to load firewall data:', e);
        }
        setFwLoading(false);
    };

    const fetchFwLog = async () => {
        try {
            const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/log`);
            if (res?.ok) setFwLog(await res.json());
        } catch (e) { }
    };

    const fetchClusterNodes = async () => {
        try {
            const response = await authFetch(`${API_URL}/clusters/${clusterId}/metrics`);
            if (response && response.ok) {
                const metrics = await response.json();
                const allNodes = Object.keys(metrics);
                setAllClusterNodes(allNodes);
                setClusterNodes(allNodes.filter(n => n !== vm.node));
            }
        } catch (error) {
            console.error('to load cluster nodes:', error);
        }
    };

    // Snapshot operations - Enhanced with efficient mode
    const handleCreateSnapshot = async (snapname, description, vmstate, modeInfo) => {
        setSnapshotLoading(true);
        try {
            if (modeInfo?.mode === 'efficient') {
                // Create efficient (LVM COW) snapshot
                const response = await authFetch(
                    `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/efficient-snapshots`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ snapname, description, snap_size_gb: modeInfo.snap_size_gb })
                    }
                );
                if (response && response.ok) {
                    const data = await response.json();
                    const savings = data.space_savings;
                    addToast(`${t('efficientSnapshotCreated')}: '${snapname}' (${savings?.savings_percent}% ${t('spaceSavings').toLowerCase()})`);
                    setShowCreateSnapshot(false);
                    await fetchEfficientSnapshots();
                } else if (response) {
                    const err = await response.json();
                    addToast(err.error || t('snapshotFailed'), 'error');
                }
            } else {
                // Standard Proxmox snapshot
                const response = await authFetch(
                    `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/snapshots`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ snapname, description, vmstate })
                    }
                );
                if (response && response.ok) {
                    addToast(`${t('snapshotCreated')}: '${snapname}'`);
                    setShowCreateSnapshot(false);
                    await fetchSnapshots();
                } else if (response) {
                    const err = await response.json();
                    addToast(err.error || t('snapshotFailed'), 'error');
                }
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setSnapshotLoading(false);
    };

    const POLL_MAX_ATTEMPTS = 30;
    const POLL_INTERVAL = 2000;
    const pollForSnapshotRemoval = async (stdName, effId, attempts = 0) => {
        // Poll the VM's snapshot endpoints and only replace the local state once
        // the deleted snapshot is no longer present, so stale PVE caches cannot
        // re-add the row right after an optimistic removal.
        if (attempts >= POLL_MAX_ATTEMPTS) return;
        const base = `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}`;
        try {
            const [stdRes, effRes] = await Promise.all([
                authFetch(`${base}/snapshots`),
                authFetch(`${base}/efficient-snapshots?refresh=true`)
            ]);
            let stdList = [];
            let effList = [];
            if (stdRes?.ok) stdList = await stdRes.json();
            if (effRes?.ok) effList = await effRes.json();
            const stdGone = !stdName || !stdList.some(s => s.name === stdName);
            const effGone = !effId || !effList.some(s => s.id === effId);
            if (stdGone && effGone) {
                setSnapshots(stdList);
                setEfficientSnapshots(effList);
            } else {
                setTimeout(() => pollForSnapshotRemoval(stdName, effId, attempts + 1), POLL_INTERVAL);
            }
        } catch (error) { console.error('poll snapshots:', error); }
    };

    // Quick confirm before delete, then refresh list
    const handleDeleteSnapshot = async (snapname) => {
        if (!confirm(`${t('confirmDelete')} '${snapname}'?`)) return;
        setSnapshotLoading(true);
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/snapshots/${snapname}`,
                { method: 'DELETE' }
            );
            if (response?.ok) {
                addToast(t('snapshotDeleted'));
                // Remove the snapshot from the UI immediately, then refetch in the
                // background and only re-render once the backend no longer lists it.
                setSnapshots(prev => (prev || []).filter(s => s.name !== snapname));
                pollForSnapshotRemoval(snapname, null, 0);
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('deleteFailed'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setSnapshotLoading(false);
    };

    const handleRollbackSnapshot = async (snapname) => {
        if (!confirm(`${snapname}: ${t('rollbackConfirm')}`)) return;
        setSnapshotLoading(true);
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/snapshots/${snapname}/rollback`,
                { method: 'POST' }
            );
            if (response && response.ok) {
                addToast(`${t('rollbackStarted')}: '${snapname}'`);
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('rollbackFailed'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setSnapshotLoading(false);
    };

    // Efficient snapshot delete/rollback
    const handleDeleteEfficientSnapshot = async (snapId, snapname) => {
        if (!confirm(`${t('confirmDelete')} '${snapname}'?`)) return;
        setSnapshotLoading(true);
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/efficient-snapshots/${snapId}`,
                { method: 'DELETE' }
            );
            if (response?.ok) {
                addToast(t('efficientSnapshotDeleted'));
                // Remove the efficient snapshot from the UI immediately, then refetch
                // in the background and only re-render once it is no longer listed.
                setEfficientSnapshots(prev => (prev || []).filter(s => s.id !== snapId));
                pollForSnapshotRemoval(null, snapId, 0);
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('deleteFailed'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setSnapshotLoading(false);
    };

    const handleRollbackEfficientSnapshot = async (snapId, snapname) => {
        if (!confirm(`${snapname}: ${t('rollbackConfirm')}\n\n${t('vmMustBeStopped')}`)) return;
        setSnapshotLoading(true);
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/efficient-snapshots/${snapId}/rollback`,
                { method: 'POST' }
            );
            if (response && response.ok) {
                addToast(t('efficientSnapshotRollback'));
                await fetchEfficientSnapshots();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('rollbackFailed'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setSnapshotLoading(false);
    };

    // Backup operations
    const handleCreateBackup = async (storage, mode, compress, notes) => {
        setBackupLoading(true);
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/backups/create`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ storage, mode, compress, notes })
                }
            );
            if (response && response.ok) {
                addToast(t('backupStarted'));
                setShowCreateBackup(false);
                setTimeout(() => fetchBackups(), 5000);
            } else if (response) {
                const err = await response.json();
                addToast(err.error || 'Backup failed', 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setBackupLoading(false);
    };

    const handleRestoreBackup = async (volid, targetVmid, storage, startAfter) => {
        // Confirmation before restore - learned this the hard way
        if (!confirm(t('confirmRestore') || `Really restore this backup? ${targetVmid === vm.vmid ? 'VM will be overwritten!' : ''}`)) return;

        setBackupLoading(true);
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/backups/restore`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ volid, target_vmid: targetVmid, storage, start: startAfter })
                }
            );
            if (response && response.ok) {
                const result = await response.json();
                addToast(t('restoreStarted') || `Restore started (VMID: ${result.vmid})`);
                setShowRestoreBackup(null);
            } else if (response) {
                const err = await response.json();
                addToast(err.error || 'Restore failed', 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setBackupLoading(false);
    };

    const handleDeleteBackup = async (volid) => {
        if (!confirm(t('confirmDeleteBackup'))) return;

        setBackupLoading(true);
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/backups/${encodeURIComponent(volid)}`,
                { method: 'DELETE' }
            );
            if (response && response.ok) {
                addToast(t('backupDeleted'));
                await fetchBackups();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || 'Delete failed', 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setBackupLoading(false);
    };

    // Backup Verification
    const handleVerifyBackup = async (backup) => {
        if (!confirm(t('confirmVerify'))) return;
        setVerifyingBackup(backup.volid);
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/backup-verify`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        node: vm.node,
                        vmid: vm.vmid,
                        vm_type: vm.type || 'qemu',
                        vm_name: vm.name || '',
                        backup_volid: backup.volid,
                        backup_time: backup.ctime ? new Date(backup.ctime * 1000).toISOString() : '',
                        storage: storageList.find(s => (s.content || '').includes('images'))?.storage || 'local-lvm',
                        check_agent: true,
                        auto_cleanup: true,
                    })
                }
            );
            if (response && response.ok) {
                const data = await response.json();
                addToast(t('verificationStarted'), 'info');
                const taskId = data.task_id;
                if (verifyPollRef.current) clearInterval(verifyPollRef.current);
                const poll = setInterval(async () => {
                    try {
                        const sr = await authFetch(`${API_URL}/clusters/${clusterId}/backup-verify/${taskId}`);
                        if (sr && sr.ok) {
                            const st = await sr.json();
                            setVerifyResults(prev => ({ ...prev, [backup.volid]: st }));
                            if (st.status !== 'running') {
                                clearInterval(poll);
                                verifyPollRef.current = null;
                                setVerifyingBackup(null);
                                addToast(st.status === 'passed'
                                    ? (t('verificationPassed2'))
                                    : (t('verificationFailed2') + (st.error || st.status)), st.status === 'passed' ? 'success' : 'error');
                            }
                        }
                    } catch (e) { clearInterval(poll); verifyPollRef.current = null; setVerifyingBackup(null); }
                }, 3000);
                verifyPollRef.current = poll;
            } else if (response) {
                const err = await response.json();
                addToast(err.error || 'Verification failed', 'error');
                setVerifyingBackup(null);
            }
        } catch (e) { addToast(t('connectionError'), 'error'); setVerifyingBackup(null); }
    };

    // Replication operations
    const handleCreateReplication = async (target, schedule, rate, comment) => {
        setReplicationLoading(true);
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/replication`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ vmid: vm.vmid, target, schedule, rate, comment })
                }
            );
            if (response && response.ok) {
                addToast(t('replicationCreated'), 'success');
                setShowCreateReplication(false);
                await fetchReplications();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || 'Creation failed', 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setReplicationLoading(false);
    };

    const handleDeleteReplication = async (jobId) => {
        if (!confirm(t('confirmDeleteReplication') || `Really delete replication job '${jobId}'?`)) return;
        setReplicationLoading(true);
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/replication/${jobId}`,
                { method: 'DELETE' }
            );
            if (response && response.ok) {
                addToast(t('replicationDeleted'), 'success');
                await fetchReplications();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || 'Delete failed', 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setReplicationLoading(false);
    };

    const handleRunReplicationNow = async (jobId) => {
        setReplicationLoading(true);
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/replication/${jobId}/run`,
                { method: 'POST' }
            );
            if (response && response.ok) {
                addToast(t('replicationStarted'), 'success');
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('startFailed'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setReplicationLoading(false);
    };

    // Cross-cluster replication handlers
    const handleCreateXRepl = async () => {
        try {
            const srcBridges = [...new Set((config?.networks || []).map(n => n.bridge).filter(Boolean))];
            const payload = {
                source_cluster: clusterId,
                vmid: vm.vmid,
                vm_type: vm.type || 'qemu',
                ...xReplForm,
                target_vmid: xReplForm.target_vmid ? parseInt(xReplForm.target_vmid, 10) : null,
            };
            // #532 - per-NIC bridge map when the VM has NICs, single bridge otherwise
            if (srcBridges.length > 0 && Object.keys(xReplBridgeMap).length > 0) {
                payload.target_bridge_map = xReplBridgeMap;
            }
            const response = await authFetch(`${API_URL}/cross-cluster-replications`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (response && response.ok) {
                addToast(t('xReplCreated'), 'success');
                setShowCreateXRepl(false);
                setXReplForm({ target_cluster: '', target_storage: '', target_bridge: 'vmbr0', target_vmid: '', schedule: '0 */6 * * *', retention: 3 });
                setXReplBridgeMap({});
                await fetchCrossClusterRepls();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('xReplCreateFailed'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    const handleDeleteXRepl = async (jobId) => {
        if (!confirm(t('confirmDeleteXRepl'))) return;
        // #552 - second prompt: optionally tear down the replica VM on the target too
        const alsoDeleteTarget = confirm(t('confirmDeleteXReplTarget'));
        try {
            // #564 - send the choice explicitly. Omitting the param let the
            // job's stored delete_target flag win, so "keep replica" was ignored
            // and a failed teardown left the job permanently undeletable.
            const url = `${API_URL}/cross-cluster-replications/${jobId}?delete_target=${alsoDeleteTarget ? '1' : '0'}`;
            const response = await authFetch(url, { method: 'DELETE' });
            if (response && response.ok) {
                addToast(t('xReplDeleted'), 'success');
                await fetchCrossClusterRepls();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('xReplDeleteFailed'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    const handleRunXReplNow = async (jobId) => {
        try {
            const response = await authFetch(`${API_URL}/cross-cluster-replications/${jobId}/run`, { method: 'POST' });
            if (response && response.ok) {
                addToast(t('xReplStarted'), 'success');
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('xReplStartFailed'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    const handleChange = (section, key, value) => {
        setChanges(prev => ({
            ...prev,
            [key]: value
        }));
    };

    // (raw-config-ux): drop a single staged edit again (per-key revert in the raw editor).
    const handleRevert = (key) => {
        setChanges(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
        setRawExtraKeys(prev => prev.filter(k => k !== key));
    };

    // Raw editor edits go through handleChange, but new keys also need tracking so the
    // row stays visible until saved or reverted.
    const handleRawChange = (key, value) => {
        if (!(key in (config?.raw || {}))) {
            setRawExtraKeys(prev => (prev.includes(key) ? prev : [...prev, key]));
        }
        handleChange('raw', key, value);
    };

    // (raw-config-ux): stage/un-stage a raw key for removal. Nothing is sent until save,
    // so the action stays undoable.
    const handleToggleRawDelete = (key) => {
        const staging = !rawDeletes.includes(key);
        setRawDeletes(prev => (staging ? [...prev, key] : prev.filter(k => k !== key)));
        // A key cannot be set and deleted in the same PVE request, so staging a removal
        // discards any pending value edit for that key.
        if (staging) {
            setChanges(prev => {
                const next = { ...prev };
                delete next[key];
                return next;
            });
        }
    };

    const handleSave = async () => {
        // Staged raw-key removals go out as PVE's comma-separated `delete` parameter.
        const payload = { ...changes };
        const pendingDeletes = rawDeletes.filter(k => !(k in changes));
        if (pendingDeletes.length > 0) payload.delete = pendingDeletes.join(',');
        if (Object.keys(payload).length === 0) return;

        // Validate VM name format (DNS-compatible)
        const nameValue = 'name' in changes ? changes.name : ('hostname' in changes ? changes.hostname : undefined);
        if (nameValue !== undefined && nameValue !== '') {
            const dnsRegex = /^[a-zA-Z]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$/;
            if (!dnsRegex.test(nameValue)) {
                addToast(t('invalidDnsName'), 'error');
                return;
            }
        }

        // (memory-swap-validation): guard against out-of-range Memory/Swap being staged
        // outside of MemoryInputField (e.g. via the raw config editor) before they ever
        // reach the PVE API.
        const memoryRanges = { memory: { min: 128, max: 4194304 }, swap: { min: 0, max: 1048576 }, balloon: { min: 0, max: 4194304 } };
        for (const [field, range] of Object.entries(memoryRanges)) {
            if (!(field in changes)) continue;
            const numValue = Number(changes[field]);
            if (!Number.isFinite(numValue) || numValue < range.min || numValue > range.max) {
                addToast(t('invalidMemoryRange', { params: { field, min: range.min, max: range.max } }) ||
                    `${field} must be between ${range.min} and ${range.max} MB`, 'error');
                return;
            }
        }

        setSaving(true);
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/config`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }
            );

            if (response && response.ok) {
                addToast(t('configSaved'), 'success');
                setChanges({});
                setRawDeletes([]);
                setRawExtraKeys([]);
                await fetchConfig();
            } else {
                const err = await response.json();
                addToast(err.error || t('saveFailed'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
        setSaving(false);
    };

    // Disk operations - Refactored this like 3 times, finally happy with it
    // Just don't touch the size parsing, that took forever to get right
    const handleAddDisk = async (diskConfig) => {
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/disks`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(diskConfig)
                }
            );
            if (response && response.ok) {
                addToast(t('diskAdded'));
                setShowAddDisk(false);
                // Small delay to allow Proxmox to allocate the disk
                await new Promise(resolve => setTimeout(resolve, 500));
                await fetchConfig();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('error'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    const handleRemoveDisk = async (diskId) => {
        if (!confirm(`${t('removeDiskConfirm')} ${diskId}? ${t('dataWillBeDeleted')}`)) return;
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/disks/${diskId}?delete_data=true`,
                { method: 'DELETE' }
            );
            if (response && response.ok) {
                addToast(t('diskDeleted'));
                await fetchConfig();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('error'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    // Detach disk - removes from VM but keeps as unused
    const handleDetachDisk = async (diskId) => {
        if (!confirm(`${t('detachDiskConfirm2')} ${diskId}`)) return;
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/disks/${diskId}`,
                { method: 'DELETE' }
            );
            if (response && response.ok) {
                addToast(t('diskDetached'));
                await fetchConfig();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('error'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    const handleResizeDisk = async (diskId, newSize) => {
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/resize`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ disk: diskId, size: newSize })
                }
            );
            if (response && response.ok) {
                addToast(t('diskResized'));
                setShowResizeDisk(null);
                await fetchConfig();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('error'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    const handleMoveDisk = async (diskId, targetStorage, deleteOriginal = true) => {
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/disks/${diskId}/move`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ storage: targetStorage, delete: deleteOriginal })
                }
            );
            if (response && response.ok) {
                addToast(t('moveStarted'));
                setShowMoveDisk(null);
                await fetchConfig();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('error'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    // CD-ROM operations
    const handleMountISO = async (isoPath, drive = 'ide2') => {
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/qemu/${vm.vmid}/cdrom`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ iso: isoPath, drive: drive })
                }
            );
            if (response && response.ok) {
                addToast(isoPath ? (t('isoMounted') || `ISO mounted on ${drive}`) : (t('isoEjected') || `${drive} ejected`));
                setShowMountISO(false);
                await fetchConfig();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('error'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    // Network operations
    const handleAddNetwork = async (netConfig) => {
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/networks`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(netConfig)
                }
            );
            if (response && response.ok) {
                addToast(t('vmNetworkAdded'));
                setShowAddNetwork(false);
                await fetchConfig();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('error'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    const handleUpdateNetwork = async (netId, netConfig) => {
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/networks/${netId}`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(netConfig)
                }
            );
            if (response && response.ok) {
                addToast(t('vmNetworkUpdated'));
                setShowEditNetwork(null);
                await fetchConfig();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('error'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    const handleRemoveNetwork = async (netId) => {
        if (!confirm(`${t('removeNetworkConfirm')} ${netId}?`)) return;
        try {
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/networks/${netId}`,
                { method: 'DELETE' }
            );
            if (response && response.ok) {
                addToast(t('vmNetworkRemoved'));
                await fetchConfig();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('error'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    // Toggle network link_down state (simulates cable unplug)
    const handleToggleNetworkLink = async (netId, currentLinkDown) => {
        try {
            const newLinkDown = !currentLinkDown;
            const response = await authFetch(
                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/networks/${netId}/link`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ link_down: newLinkDown })
                }
            );
            if (response && response.ok) {
                addToast(newLinkDown ? t('networkDisconnected') : t('connectNetwork'), newLinkDown ? 'warning' : 'success');
                await fetchConfig();
            } else if (response) {
                const err = await response.json();
                addToast(err.error || t('error'), 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    // (#365 j0c00): fetch datacenter MAC prefix once on mount so
    // generateMAC can honour Datacenter → Options → MAC address prefix.
    // PVE itself uses this prefix when it auto-generates MACs; our button
    // was just rolling random `02:xx:xx:xx:xx:xx` regardless.
    useEffect(() => {
        if (!clusterId) return;
        let cancelled = false;
        (async () => {
            try {
                const r = await dashboardAuthFetch(`${API_URL}/clusters/${clusterId}/datacenter/options`);
                if (r?.ok && !cancelled) {
                    const data = await r.json();
                    if (data?.mac_prefix) setDcMacPrefix(String(data.mac_prefix));
                }
            } catch (e) { /* non-fatal — generateMAC falls back to '02:' */ }
        })();
        return () => { cancelled = true; };
    }, [clusterId]);

    // Helper functions
    const generateMAC = () => {
        const hex = '0123456789ABCDEF';
        const rand = () => hex[Math.floor(Math.random() * 16)] + hex[Math.floor(Math.random() * 16)];
        // (#365): honour the cluster's MAC prefix when set.
        // PVE accepts 1–3 octets (BC, BC:24, BC:24:11); we mirror that.
        const prefix = (dcMacPrefix || '').trim();
        let parts = [];
        if (/^[A-Fa-f0-9]{2}(:[A-Fa-f0-9]{2}){0,2}$/.test(prefix)) {
            parts = prefix.toUpperCase().split(':');
        }
        if (parts.length === 0) parts = ['02'];  // fall back to locally-administered prefix
        while (parts.length < 6) parts.push(rand());
        return parts.join(':');
    };

    const getNextDiskId = (busType = 'scsi') => {
        const existing = config?.disks?.filter(d => d.id.startsWith(busType)).map(d => parseInt(d.id.replace(busType, ''))) || [];
        for (let i = 0; i < 30; i++) {
            if (!existing.includes(i)) return `${busType}${i}`;
        }
        return `${busType}0`;
    };

    const getNextNetId = () => {
        const existing = config?.networks?.map(n => parseInt(n.id.replace('net', ''))) || [];
        for (let i = 0; i < 10; i++) {
            if (!existing.includes(i)) return `net${i}`;
        }
        return 'net0';
    };

    const getValue = (section, key) => {
        if (key in changes) return changes[key];
        // Try parsed section first, then raw config as fallback
        const parsedValue = config?.[section]?.[key];
        if (parsedValue !== undefined && parsedValue !== '') return parsedValue;
        // Fallback to raw config
        return config?.raw?.[key] ?? '';
    };

    const tabs = isQemu
        ? [
            { id: 'general', labelKey: 'generalTab', icon: Icons.Server },
            { id: 'hardware', labelKey: 'hardware', icon: Icons.Cpu },
            { id: 'disks', labelKey: 'disks', icon: Icons.HardDrive },
            { id: 'network', labelKey: 'networkTab', icon: Icons.Network },
            { id: 'snapshots', labelKey: 'snapshotsTab', icon: Icons.Clock },
            { id: 'backups', labelKey: 'backupsTab', icon: Icons.Database },
            { id: 'replication', labelKey: 'replicationTab', icon: Icons.RefreshCw },
            { id: 'history', labelKey: 'historyTab', icon: Icons.List },
            { id: 'firewall', labelKey: 'firewall', icon: Icons.Shield },
            { id: 'options', labelKey: 'optionsTab', icon: Icons.Settings },
        ]
        : [
            { id: 'general', labelKey: 'generalTab', icon: Icons.Server },
            { id: 'resources', labelKey: 'resourcesTab', icon: Icons.Cpu },
            { id: 'disks', labelKey: 'storageTab', icon: Icons.HardDrive },
            { id: 'network', labelKey: 'networkTab', icon: Icons.Network },
            { id: 'snapshots', labelKey: 'snapshotsTab', icon: Icons.Clock },
            { id: 'backups', labelKey: 'backupsTab', icon: Icons.Database },
            { id: 'replication', labelKey: 'replicationTab', icon: Icons.RefreshCw },
            { id: 'history', labelKey: 'historyTab', icon: Icons.List },
            { id: 'firewall', labelKey: 'firewall', icon: Icons.Shield },
            { id: 'options', labelKey: 'optionsTab', icon: Icons.Settings },
        ];

    // May 2026: in Corporate layout we render a corporate flat
    // chrome (flat, light-weighted typography, underlined tabs, clean
    // header with explicit Apply / Cancel actions). The Modern dark
    // pill-tab look feels foreign in the Corporate layout especially
    // under the light theme. Body markup is shared between layouts.
    return (
        <div className={isCorporate
            ? 'corp-vm-modal-overlay'
            : 'fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop bg-black/80'}>
            <div className={isCorporate
                ? 'corp-vm-modal'
                : 'w-full max-w-4xl max-h-[90vh] bg-proxmox-card border border-proxmox-border rounded-2xl shadow-2xl animate-scale-in overflow-hidden flex flex-col'}>
                {/* Header */}
                {isCorporate ? (
                    <div className="corp-vm-modal-header">
                        <div className="corp-vm-modal-header-left">
                            <span className={`corp-vm-type-pill ${isQemu ? '' : 'lxc'}`}>{isQemu ? 'VM' : 'CT'}</span>
                            <div className="corp-vm-modal-title-block">
                                <h2 className="corp-vm-modal-title">{vm.name || `${isQemu ? 'VM' : 'CT'} ${vm.vmid}`}</h2>
                                <div className="corp-vm-modal-meta">
                                    <span>ID {vm.vmid}</span>
                                    <span className="corp-meta-sep">·</span>
                                    <span>{vm.node}</span>
                                    <span className="corp-meta-sep">·</span>
                                    <span>{isQemu ? 'QEMU' : 'LXC'}</span>
                                    {vm.status && (
                                        <>
                                            <span className="corp-meta-sep">·</span>
                                            <span className={`corp-badge corp-badge-${vm.status === 'running' ? 'running' : 'stopped'}`}>
                                                {vm.status}
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="corp-vm-modal-actions">
                            {hasChanges && (
                                <span className="corp-unsaved-pill">{t('unsavedChanges')}</span>
                            )}
                            {hasChanges && (
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="corp-vm-btn corp-vm-btn-primary"
                                    title={t('save2')}
                                >
                                    {saving ? (t('saving')) : (t('apply'))}
                                </button>
                            )}
                            <button
                                onClick={onClose}
                                className="corp-vm-btn corp-vm-btn-ghost"
                            >
                                {t('close')}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-between px-6 py-4 border-b border-proxmox-border bg-proxmox-dark">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${isQemu ? 'bg-blue-500/10' : 'bg-purple-500/10'}`}>
                                {isQemu ? <Icons.VM /> : <Icons.Container />}
                            </div>
                            <div>
                                <h2 className="font-semibold text-white">{vm.name || `${isQemu ? 'VM' : 'CT'} ${vm.vmid}`}</h2>
                                <p className="text-xs text-gray-400">
                                    {isQemu ? 'QEMU Virtual Machine' : 'LXC Container'} · ID {vm.vmid} · {vm.node}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {hasChanges && (
                                <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded">
                                    {t('unsavedChanges')}
                                </span>
                            )}
                            <button
                                onClick={onClose}
                                className="p-2 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
                            >
                                <Icons.X />
                            </button>
                        </div>
                    </div>
                )}

                {/* Tabs */}
                {isCorporate ? (
                    <div className="corp-vm-modal-tabs">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`corp-vm-modal-tab ${activeTab === tab.id ? 'active' : ''}`}
                            >
                                <tab.icon className="w-3.5 h-3.5" />
                                {t(tab.labelKey)}
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-1 px-6 py-3 border-b border-proxmox-border bg-proxmox-dark/50">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${activeTab === tab.id
                                    ? 'bg-proxmox-orange text-white'
                                    : 'text-gray-400 hover:text-white hover:bg-proxmox-hover'
                                    }`}
                            >
                                <tab.icon />
                                {t(tab.labelKey)}
                            </button>
                        ))}
                    </div>
                )}

                {/* Content */}
                <div className={isCorporate ? 'corp-vm-modal-body' : 'flex-1 overflow-y-auto p-6'}>
                    {loading ? (
                        isCorporate ? (
                            <div className="corp-vm-modal-state">
                                <div className="corp-vm-spinner"></div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-64">
                                <div className="animate-spin w-8 h-8 border-2 border-proxmox-orange border-t-transparent rounded-full"></div>
                            </div>
                        )
                    ) : configError ? (
                        /* Show error when config fails to load */
                        isCorporate ? (
                            <div className="corp-vm-modal-state">
                                <Icons.AlertTriangle className="w-10 h-10 mb-3" style={{ color: '#f54f47' }} />
                                <p style={{ color: '#f54f47', fontWeight: 500, marginBottom: '6px' }}>{configError}</p>
                                <p style={{ fontSize: '12px', color: 'var(--corp-text-muted)', marginBottom: '14px' }}>
                                    {t('checkConnectionAndRetry')}
                                </p>
                                <button
                                    onClick={() => { setConfigError(null); fetchConfig(); }}
                                    className="corp-vm-btn corp-vm-btn-primary"
                                >
                                    <Icons.RotateCw className="w-3.5 h-3.5" />
                                    {t('retry')}
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-64 text-center">
                                <Icons.AlertTriangle className="w-12 h-12 text-red-400 mb-4" />
                                <p className="text-red-400 font-medium mb-2">{configError}</p>
                                <p className="text-gray-500 text-sm mb-4">{t('checkConnectionAndRetry')}</p>
                                <button
                                    onClick={() => { setConfigError(null); fetchConfig(); }}
                                    className="px-4 py-2 bg-proxmox-orange rounded-lg text-white hover:bg-orange-600 flex items-center gap-2"
                                >
                                    <Icons.RotateCw className="w-4 h-4" />
                                    {t('retry')}
                                </button>
                            </div>
                        )
                    ) : config ? (
                        <>
                            {/* General Tab */}
                            {activeTab === 'general' && (
                                <div className="space-y-6">
                                    <div className="grid grid-cols-2 gap-4">
                                        <ConfigInputField
                                            label={isQemu ? t('name') : t('hostname')}
                                            value={getValue('general', isQemu ? 'name' : 'hostname')}
                                            onChange={(v) => handleChange('general', isQemu ? 'name' : 'hostname', v)}
                                        />
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : 'block text-xs font-medium text-gray-400 mb-1'}>{t('tags')}</label>
                                            <div className="w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg min-h-[38px] relative">
                                                <div className="flex flex-wrap gap-1 mb-1">
                                                    {(getValue('general', 'tags') || '').split(';').filter(t => t.trim()).map((tag, i) => (
                                                        <span key={i} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs" style={{
                                                            background: 'rgba(249,115,22,0.15)', color: '#f97316'
                                                        }}>
                                                            {tag.trim()}
                                                            <button type="button" onClick={() => {
                                                                const current = (getValue('general', 'tags') || '').split(';').filter(t => t.trim());
                                                                current.splice(i, 1);
                                                                handleChange('general', 'tags', current.join(';'));
                                                            }} className="hover:text-red-400 ml-0.5">
                                                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                                            </button>
                                                        </span>
                                                    ))}
                                                </div>
                                                <input
                                                    type="text"
                                                    placeholder={t('addTag')}
                                                    value={tagInputValue}
                                                    onChange={(e) => { setTagInputValue(e.target.value); setShowTagDropdown(true); }}
                                                    onFocus={() => setShowTagDropdown(true)}
                                                    onBlur={() => setTimeout(() => setShowTagDropdown(false), 200)} className={isCorporate ? 'corp-input' : 'bg-transparent text-white text-sm focus:outline-none w-full'}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && tagInputValue.trim()) {
                                                            e.preventDefault();
                                                            const val = tagInputValue.trim();
                                                            if (!/^[a-z0-9][a-z0-9\-_.+]*$/.test(val)) {
                                                                addToast(t('invalidTagFormat'), 'error');
                                                                return;
                                                            }
                                                            const current = (getValue('general', 'tags') || '').split(';').filter(t => t.trim());
                                                            if (!current.includes(val)) {
                                                                current.push(val);
                                                                handleChange('general', 'tags', current.join(';'));
                                                            }
                                                            setTagInputValue('');
                                                        }
                                                    }}
                                                />
                                                {showTagDropdown && clusterTags.length > 0 && (() => {
                                                    const currentTags = (getValue('general', 'tags') || '').split(';').filter(t => t.trim());
                                                    const filtered = clusterTags.filter(ct =>
                                                        !currentTags.includes(ct.name) &&
                                                        (!tagInputValue || ct.name.toLowerCase().includes(tagInputValue.toLowerCase()))
                                                    );
                                                    return filtered.length > 0 ? (
                                                        <div className="absolute left-0 right-0 top-full mt-1 bg-proxmox-darker border border-proxmox-border rounded-lg shadow-lg z-50 max-h-[150px] overflow-y-auto">
                                                            {filtered.map(ct => (
                                                                <button key={ct.name} type="button"
                                                                    className="w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-proxmox-orange/10 hover:text-white flex items-center gap-2"
                                                                    onMouseDown={(e) => {
                                                                        e.preventDefault();
                                                                        const current = (getValue('general', 'tags') || '').split(';').filter(t => t.trim());
                                                                        current.push(ct.name);
                                                                        handleChange('general', 'tags', current.join(';'));
                                                                        setTagInputValue('');
                                                                    }}
                                                                >
                                                                    <span className="w-2 h-2 rounded-full" style={{ background: ct.color || '#f97316' }} />
                                                                    {ct.name}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    ) : null;
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <label className={isCorporate ? 'corp-label' : 'text-xs font-medium text-gray-400'}>{t('description')}</label>
                                            <button
                                                type="button"
                                                onClick={() => setDescEditMode(!descEditMode)}
                                                className="text-xs px-2 py-0.5 rounded bg-proxmox-dark border border-proxmox-border text-gray-400 hover:text-white transition-colors"
                                            >
                                                {descEditMode ? (t('preview')) : (t('edit'))}
                                            </button>
                                        </div>
                                        {descEditMode ? (
                                            <textarea
                                                value={getValue('general', 'description')}
                                                onChange={(e) => handleChange('general', 'description', e.target.value)}
                                                rows={6} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm focus:outline-none focus:border-proxmox-orange'}
                                            />
                                        ) : (
                                            <div
                                                className="w-full px-3 py-2 border border-proxmox-border rounded-lg text-sm text-white min-h-[120px] cursor-pointer transition-colors"
                                                style={{ overflowWrap: 'break-word', background: 'transparent' }}
                                                dangerouslySetInnerHTML={{
                                                    __html: (() => {
                                                        const raw = getValue('general', 'description');
                                                        if (!raw) return '<span style="color:#6b7280">No description</span>';
                                                        if (!window.marked) return (window.DOMPurify ? window.DOMPurify.sanitize(raw) : raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'));
                                                        // Security audit - if DOMPurify not loaded, render as escaped plain text, NEVER unsanitized HTML
                                                        const html = window.DOMPurify ? window.DOMPurify.sanitize(window.marked.parse(raw)) : raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                                                        return '<style>.md-desc table,.md-desc thead,.md-desc tbody,.md-desc tr,.md-desc th,.md-desc td{background:none!important;background-color:transparent!important;color:inherit!important}.md-desc table{border-collapse:collapse;width:100%;margin:8px 0}.md-desc th,.md-desc td{border:1px solid rgba(255,255,255,0.15)!important;padding:6px 12px}.md-desc th{background-color:rgba(255,255,255,0.05)!important;text-align:left}.md-desc tr:nth-child(even) td{background-color:rgba(255,255,255,0.02)!important}.md-desc a{color:#f97316;text-decoration:underline}.md-desc code{background:rgba(255,255,255,0.08)!important;padding:1px 4px;border-radius:3px;font-size:0.85em}.md-desc pre{background:rgba(255,255,255,0.05)!important;padding:12px;border-radius:6px;overflow-x:auto;margin:8px 0}.md-desc pre code{background:none!important;padding:0}.md-desc blockquote{border-left:3px solid #f97316;padding-left:12px;margin:8px 0;color:#9ca3af}.md-desc hr{border:none;border-top:1px solid rgba(255,255,255,0.1);margin:12px 0}.md-desc h1,.md-desc h2,.md-desc h3,.md-desc h4{color:inherit;margin:12px 0 6px}.md-desc p{margin:6px 0}.md-desc img{max-width:100%;border-radius:4px}</style><div class="md-desc">' + html + '</div>';
                                                    })()
                                                }}
                                                onClick={() => setDescEditMode(true)}
                                            />
                                        )}
                                    </div>
                                    {config.status && (
                                        <div className="grid grid-cols-3 gap-4 p-4 bg-proxmox-dark rounded-lg">
                                            <div>
                                                <div className="text-xs text-gray-500">{t('status')}</div>
                                                <div className={`font-medium ${config.status.status === 'running' ? 'text-green-400' : 'text-red-400'}`}>
                                                    {config.status.status === 'running' ? t('running') : t('stopped')}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-gray-500">{t('cpuUsage')}</div>
                                                <div className="font-medium text-white">{((config.status.cpu || 0) * 100).toFixed(1)}%</div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-gray-500">{t('ramUsage')}</div>
                                                <div className="font-medium text-white">
                                                    {((config.status.mem || 0) / 1073741824).toFixed(1)} GB
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Lock Warning and Unlock Button */}
                                    {config.lock?.locked && (
                                        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <Icons.AlertTriangle className="text-yellow-400" />
                                                    <div>
                                                        <div className="text-yellow-400 font-medium">{t('vmLocked')}</div>
                                                        <div className="text-xs text-yellow-300/70">{config.lock?.description || config.lock?.reason || 'Locked'}</div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            const response = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/unlock`, {
                                                                method: 'POST'
                                                            });
                                                            if (response && response.ok) {
                                                                addToast(t('vmUnlocked'), 'success');
                                                                fetchConfig(); // Reload config
                                                            } else {
                                                                const err = await response.json();
                                                                addToast(err.error || t('deleteFailed'), 'error');
                                                            }
                                                        } catch (e) {
                                                            addToast(t('connectionError'), 'error');
                                                        }
                                                    }}
                                                    className="px-3 py-1.5 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/30 rounded-lg text-yellow-400 text-sm font-medium transition-colors"
                                                >
                                                    {t('unlockVm')}
                                                </button>
                                            </div>
                                            <div className="mt-2 text-xs text-gray-500">
                                                CLI: <code className="text-green-400">{config.lock?.unlock_command}</code>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Hardware/Resources Tab */}
                            {(activeTab === 'hardware' || activeTab === 'resources') && (
                                <div className="space-y-6">
                                    <div className="grid grid-cols-2 gap-4">
                                        <ConfigInputField
                                            label={t('cpuCores')}
                                            type="number"
                                            value={getValue('hardware', 'cores')}
                                            onChange={(v) => handleChange('hardware', 'cores', v)}
                                            needsRestart={vm.status === 'running'}
                                        />
                                        {isQemu && (
                                            <ConfigInputField
                                                label={t('sockets')}
                                                type="number"
                                                value={getValue('hardware', 'sockets')}
                                                onChange={(v) => handleChange('hardware', 'sockets', v)}
                                                needsRestart={true}
                                            />
                                        )}
                                        {!isQemu && (
                                            <ConfigInputField
                                                label={t('cpuLimit')}
                                                type="number"
                                                value={getValue('hardware', 'cpulimit')}
                                                onChange={(v) => handleChange('hardware', 'cpulimit', v)}
                                                suffix={t('cores')}
                                            />
                                        )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <MemoryInputField
                                            label={t('memory')}
                                            value={getValue('hardware', 'memory') || 2048}
                                            onChange={(v) => handleChange('hardware', 'memory', v)}
                                            minMB={128}
                                            maxMB={4194304}
                                            stepMB={128}
                                            needsRestart={vm.status === 'running'}
                                        />
                                        {isQemu ? (
                                            <MemoryInputField
                                                label={t('ballooningMinimum')}
                                                value={getValue('hardware', 'balloon') || 0}
                                                onChange={(v) => handleChange('hardware', 'balloon', v)}
                                                minMB={0}
                                                maxMB={4194304}
                                                stepMB={128}
                                            />
                                        ) : (
                                            <MemoryInputField
                                                label={t('swap')}
                                                value={getValue('hardware', 'swap') || 512}
                                                onChange={(v) => handleChange('hardware', 'swap', v)}
                                                minMB={0}
                                                maxMB={1048576}
                                                stepMB={64}
                                            />
                                        )}
                                    </div>
                                    {isQemu && (
                                        <>
                                            {/* Composite cpu= string parsers. PVE accepts
                                                        "type,flags=...,reported-model=...,level=...". We keep the
                                                        existing dropdown bound to the BASE type (first segment) and
                                                        add reported-model + level as separate inputs below that
                                                        splice into the composite. PVE 9.2+ exposes those sub-options
                                                        formally; older PVE just sees them as unknown sub-options and
                                                        ignores quietly. */}
                                            <div className="grid grid-cols-2 gap-4">
                                                <ConfigInputField
                                                    label={t('cpuType')}
                                                    value={(getValue('hardware', 'cpu') || '').split(',')[0]}
                                                    onChange={(v) => {
                                                        const cur = getValue('hardware', 'cpu') || '';
                                                        const parts = cur.split(',').slice(1);
                                                        handleChange('hardware', 'cpu', [v, ...parts].filter(Boolean).join(','));
                                                    }}
                                                    options={hardwareOptions?.cpu_types || ['host', 'kvm64', 'qemu64']}
                                                    needsRestart={true}
                                                />
                                                <ConfigInputField
                                                    label="VGA"
                                                    value={getValue('hardware', 'vga')}
                                                    onChange={(v) => handleChange('hardware', 'vga', v)}
                                                    options={[
                                                        { value: 'std', label: 'Standard VGA' },
                                                        { value: 'virtio', label: 'VirtIO-GPU' },
                                                        { value: 'virtio-gl', label: 'VirtIO-GPU (virgl)' },
                                                        { value: 'qxl', label: 'SPICE (QXL)' },
                                                        { value: 'vmware', label: 'VMware compatible' },
                                                        { value: 'cirrus', label: 'Cirrus Logic' },
                                                        { value: 'none', label: t('none') },
                                                    ]}
                                                    needsRestart={true}
                                                />
                                            </div>
                                            {/* PVE 9.2 cpu sub-options. Splice in/out of the
                                                        composite cpu= string. Empty input = remove the sub-option. */}
                                            <div className="grid grid-cols-2 gap-4">
                                                <ConfigInputField
                                                    label="reported-model"
                                                    value={(() => {
                                                        const cur = getValue('hardware', 'cpu') || '';
                                                        for (const part of cur.split(',').slice(1)) {
                                                            const [k, v] = part.split('=');
                                                            if (k === 'reported-model') return v || '';
                                                        }
                                                        return '';
                                                    })()}
                                                    onChange={(v) => {
                                                        const cur = getValue('hardware', 'cpu') || '';
                                                        const [base, ...rest] = cur.split(',');
                                                        const kept = rest.filter(p => !p.startsWith('reported-model='));
                                                        if (v && v.trim()) kept.push(`reported-model=${v.trim()}`);
                                                        handleChange('hardware', 'cpu', [base, ...kept].filter(Boolean).join(','));
                                                    }}
                                                    placeholder="(empty) e.g. Skylake-Client, host"
                                                    needsRestart={true}
                                                />
                                                <ConfigInputField
                                                    label="level"
                                                    type="number"
                                                    min={1}
                                                    max={64}
                                                    value={(() => {
                                                        const cur = getValue('hardware', 'cpu') || '';
                                                        for (const part of cur.split(',').slice(1)) {
                                                            const [k, v] = part.split('=');
                                                            if (k === 'level') return v || '';
                                                        }
                                                        return '';
                                                    })()}
                                                    onChange={(v) => {
                                                        const cur = getValue('hardware', 'cpu') || '';
                                                        const [base, ...rest] = cur.split(',');
                                                        const kept = rest.filter(p => !p.startsWith('level='));
                                                        const num = parseInt(v, 10);
                                                        if (!isNaN(num) && num >= 1 && num <= 64) {
                                                            kept.push(`level=${num}`);
                                                        }
                                                        handleChange('hardware', 'cpu', [base, ...kept].filter(Boolean).join(','));
                                                    }}
                                                    placeholder="(empty) 1-64"
                                                    needsRestart={true}
                                                />
                                            </div>
                                            {/* Extra CPU Flags (#410). Tri-state per flag:
                                                        off (absent) / +flag (enabled) / -flag (disabled). Spliced
                                                        in/out of the composite cpu= string as one semicolon-joined
                                                        flags= segment, preserving type/reported-model/level. Backend
                                                        passes cpu= through untouched, so this rides the delta-save. */}
                                            <div className="mt-1">
                                                <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-2'}>{t('extraCpuFlags')}</label>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {['pcid', 'spec-ctrl', 'ssbd', 'ibpb', 'virt-ssbd', 'amd-ssbd', 'amd-no-ssb', 'pdpe1gb', 'hv-tlbflush', 'hv-evmcs', 'aes', 'md-clear'].map(flag => {
                                                        const cur = getValue('hardware', 'cpu') || '';
                                                        let state = 0; // 0 = default, 1 = +, -1 = -
                                                        for (const part of cur.split(',').slice(1)) {
                                                            if (part.startsWith('flags=')) {
                                                                for (const tk of part.slice(6).split(';').filter(Boolean)) {
                                                                    if (tk === '+' + flag) state = 1;
                                                                    else if (tk === '-' + flag) state = -1;
                                                                }
                                                            }
                                                        }
                                                        const cycle = () => {
                                                            const cur2 = getValue('hardware', 'cpu') || '';
                                                            const [base, ...rest] = cur2.split(',');
                                                            let toks = [];
                                                            const kept = rest.filter(p => {
                                                                if (p.startsWith('flags=')) { toks = p.slice(6).split(';').filter(Boolean); return false; }
                                                                return true;
                                                            });
                                                            toks = toks.filter(tk => tk !== '+' + flag && tk !== '-' + flag);
                                                            const next = state === 0 ? 1 : (state === 1 ? -1 : 0);
                                                            if (next === 1) toks.push('+' + flag);
                                                            else if (next === -1) toks.push('-' + flag);
                                                            if (toks.length) kept.push('flags=' + toks.join(';'));
                                                            handleChange('hardware', 'cpu', [base, ...kept].filter(Boolean).join(','));
                                                        };
                                                        const cls = state === 1 ? 'bg-green-500/20 border-green-500/50 text-green-300'
                                                            : state === -1 ? 'bg-red-500/20 border-red-500/50 text-red-300'
                                                                : 'bg-proxmox-dark border-proxmox-border text-gray-400';
                                                        return (
                                                            <button key={flag} type="button" onClick={cycle}
                                                                title={state === 1 ? `+${flag} (enabled)` : state === -1 ? `-${flag} (disabled)` : `${flag} (default)`}
                                                                className={`px-2 py-1.5 text-xs rounded-lg border font-mono ${cls} hover:opacity-80 transition-opacity`}>
                                                                {state === 1 ? '+' : state === -1 ? '−' : ''}{flag}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                                <p className={isCorporate ? 'corp-help-text' : 'text-xs text-gray-500 mt-1.5'}>{t('extraCpuFlagsHint2')}</p>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <ConfigInputField
                                                    label="BIOS"
                                                    value={getValue('hardware', 'bios')}
                                                    onChange={(v) => handleChange('hardware', 'bios', v)}
                                                    options={[
                                                        { value: 'seabios', label: 'SeaBIOS (Legacy)' },
                                                        { value: 'ovmf', label: 'OVMF (UEFI)' },
                                                    ]}
                                                    needsRestart={true}
                                                />
                                                <ConfigInputField
                                                    label={t('scsiController')}
                                                    value={getValue('hardware', 'scsihw')}
                                                    onChange={(v) => handleChange('hardware', 'scsihw', v)}
                                                    options={hardwareOptions?.scsi_controllers || [
                                                        { value: 'virtio-scsi-pci', label: 'VirtIO SCSI' },
                                                        { value: 'virtio-scsi-single', label: 'VirtIO SCSI Single' },
                                                        { value: 'lsi', label: 'LSI 53C895A' },
                                                    ]}
                                                    needsRestart={true}
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <ConfigInputField
                                                    label={t('machineType')}
                                                    value={getValue('hardware', 'machine')}
                                                    onChange={(v) => handleChange('hardware', 'machine', v)}
                                                    options={hardwareOptions?.machine_types || [
                                                        { value: '', label: t('default') },
                                                        // q35 versions
                                                        { value: 'q35', label: 'q35 (Latest)' },
                                                        { value: 'pc-q35-10.1', label: 'q35 10.1' },
                                                        { value: 'pc-q35-10.0+pve1', label: 'q35 10.0+pve1' },
                                                        { value: 'pc-q35-10.0', label: 'q35 10.0' },
                                                        { value: 'pc-q35-9.2+pve1', label: 'q35 9.2+pve1' },
                                                        { value: 'pc-q35-9.2', label: 'q35 9.2' },
                                                        { value: 'pc-q35-9.1', label: 'q35 9.1' },
                                                        { value: 'pc-q35-9.0', label: 'q35 9.0' },
                                                        { value: 'pc-q35-8.2', label: 'q35 8.2' },
                                                        { value: 'pc-q35-8.1', label: 'q35 8.1' },
                                                        { value: 'pc-q35-8.0', label: 'q35 8.0' },
                                                        { value: 'pc-q35-7.2', label: 'q35 7.2' },
                                                        { value: 'pc-q35-7.1', label: 'q35 7.1' },
                                                        { value: 'pc-q35-7.0', label: 'q35 7.0' },
                                                        { value: 'pc-q35-6.2', label: 'q35 6.2' },
                                                        { value: 'pc-q35-6.1', label: 'q35 6.1' },
                                                        { value: 'pc-q35-6.0', label: 'q35 6.0' },
                                                        { value: 'pc-q35-5.2', label: 'q35 5.2' },
                                                        { value: 'pc-q35-5.1', label: 'q35 5.1' },
                                                        { value: 'pc-q35-5.0', label: 'q35 5.0' },
                                                        { value: 'pc-q35-4.2', label: 'q35 4.2' },
                                                        { value: 'pc-q35-4.1', label: 'q35 4.1' },
                                                        { value: 'pc-q35-4.0', label: 'q35 4.0' },
                                                        { value: 'pc-q35-3.1', label: 'q35 3.1' },
                                                        { value: 'pc-q35-3.0', label: 'q35 3.0' },
                                                        { value: 'pc-q35-2.12', label: 'q35 2.12' },
                                                        { value: 'pc-q35-2.11', label: 'q35 2.11' },
                                                        { value: 'pc-q35-2.10', label: 'q35 2.10' },
                                                        // i440fx versions
                                                        { value: 'i440fx', label: 'i440fx (Latest)' },
                                                        { value: 'pc-i440fx-10.1', label: 'i440fx 10.1' },
                                                        { value: 'pc-i440fx-10.0+pve1', label: 'i440fx 10.0+pve1' },
                                                        { value: 'pc-i440fx-10.0', label: 'i440fx 10.0' },
                                                        { value: 'pc-i440fx-9.2+pve1', label: 'i440fx 9.2+pve1' },
                                                        { value: 'pc-i440fx-9.2', label: 'i440fx 9.2' },
                                                        { value: 'pc-i440fx-9.1', label: 'i440fx 9.1' },
                                                        { value: 'pc-i440fx-9.0', label: 'i440fx 9.0' },
                                                        { value: 'pc-i440fx-8.2', label: 'i440fx 8.2' },
                                                        { value: 'pc-i440fx-8.1', label: 'i440fx 8.1' },
                                                        { value: 'pc-i440fx-8.0', label: 'i440fx 8.0' },
                                                        { value: 'pc-i440fx-7.2', label: 'i440fx 7.2' },
                                                        { value: 'pc-i440fx-7.1', label: 'i440fx 7.1' },
                                                        { value: 'pc-i440fx-7.0', label: 'i440fx 7.0' },
                                                        { value: 'pc-i440fx-6.2', label: 'i440fx 6.2' },
                                                        { value: 'pc-i440fx-6.1', label: 'i440fx 6.1' },
                                                        { value: 'pc-i440fx-6.0', label: 'i440fx 6.0' },
                                                        { value: 'pc-i440fx-5.2', label: 'i440fx 5.2' },
                                                        { value: 'pc-i440fx-5.1', label: 'i440fx 5.1' },
                                                        { value: 'pc-i440fx-5.0', label: 'i440fx 5.0' },
                                                        { value: 'pc-i440fx-4.2', label: 'i440fx 4.2' },
                                                        { value: 'pc-i440fx-4.1', label: 'i440fx 4.1' },
                                                        { value: 'pc-i440fx-4.0', label: 'i440fx 4.0' },
                                                        { value: 'pc-i440fx-3.1', label: 'i440fx 3.1' },
                                                        { value: 'pc-i440fx-3.0', label: 'i440fx 3.0' },
                                                        { value: 'pc-i440fx-2.12', label: 'i440fx 2.12' },
                                                        { value: 'pc-i440fx-2.11', label: 'i440fx 2.11' },
                                                        { value: 'pc-i440fx-2.10', label: 'i440fx 2.10' },
                                                    ]}
                                                    needsRestart={true}
                                                />
                                                {/* VIOMMU for nested virt and GPU passthrough
                                                            Appends to machine string like "q35,viommu=intel" */}
                                                <ConfigInputField
                                                    label="vIOMMU"
                                                    value={getValue('hardware', 'machine')?.includes('viommu=') ? getValue('hardware', 'machine').split('viommu=')[1]?.split(',')[0] : ''}
                                                    onChange={(v) => {
                                                        const currentMachine = getValue('hardware', 'machine') || '';
                                                        const baseMachine = currentMachine.split(',')[0];
                                                        if (v && v !== 'none') {
                                                            handleChange('hardware', 'machine', `${baseMachine},viommu=${v}`);
                                                        } else {
                                                            handleChange('hardware', 'machine', baseMachine);
                                                        }
                                                    }}
                                                    options={[
                                                        { value: '', label: t('default') + ' (None)' },
                                                        { value: 'intel', label: 'Intel (VT-d)' },
                                                        { value: 'virtio', label: 'VirtIO' },
                                                    ]}
                                                    needsRestart={true}
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="flex items-center gap-4 pt-2">
                                                    <ConfigCheckboxField
                                                        label={t('enableNuma')}
                                                        checked={getValue('hardware', 'numa') == 1}
                                                        onChange={(v) => handleChange('hardware', 'numa', v)}
                                                        needsRestart={true}
                                                        t={t}
                                                    />
                                                </div>
                                                <div></div>
                                            </div>

                                            {/* EFI Disk & TPM Section - For UEFI and Windows 11 */}
                                            {getValue('hardware', 'bios') === 'ovmf' && (
                                                <div className="mt-6 pt-6 border-t border-proxmox-border">
                                                    <h3 className={isCorporate ? 'corp-card-header' : 'text-white font-medium mb-4 flex items-center gap-2'}>
                                                        🔐 {t('efiTpmSettings')}
                                                        {vm.status === 'running' && (
                                                            <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded">
                                                                {t('changesAfterRestart')}
                                                            </span>
                                                        )}
                                                    </h3>

                                                    {/* EFI Disk */}
                                                    <div className="mb-4">
                                                        <div className="flex justify-between items-center mb-2">
                                                            <span className="text-sm text-gray-400">{t('efiDisk')}</span>
                                                        </div>
                                                        {config?.raw?.efidisk0 ? (
                                                            <div className="p-3 bg-proxmox-dark rounded-lg">
                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-2">
                                                                        <Icons.HardDrive className="w-4 h-4 text-blue-400" />
                                                                        <span className="text-sm font-mono text-gray-300">{config.raw.efidisk0}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded">{t('configured2')}</span>
                                                                        <button
                                                                            onClick={async () => {
                                                                                if (!confirm(t('confirmDeleteEfiDisk'))) return;
                                                                                try {
                                                                                    const res = await fetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/config`, {
                                                                                        method: 'PUT',
                                                                                        credentials: 'include',
                                                                                        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                                                                                        body: JSON.stringify({ delete: 'efidisk0' })
                                                                                    });
                                                                                    if (res.ok) {
                                                                                        addToast(t('efiDiskDeleted'), 'success');
                                                                                        fetchConfig();
                                                                                    } else {
                                                                                        const err = await res.json();
                                                                                        addToast(err.error || 'Error deleting EFI disk', 'error');
                                                                                    }
                                                                                } catch (e) {
                                                                                    addToast('Error deleting EFI disk', 'error');
                                                                                }
                                                                            }}
                                                                            className="text-xs px-2 py-1 text-red-400 hover:bg-red-500/20 rounded"
                                                                            title={t('delete')}
                                                                        >
                                                                            <Icons.Trash className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="p-3 bg-proxmox-dark rounded-lg border border-dashed border-proxmox-border">
                                                                <div className="flex items-center justify-between">
                                                                    <span className="text-sm text-gray-500">{t('noEfiDisk')}</span>
                                                                    <button
                                                                        onClick={() => setShowAddEfiDisk(true)}
                                                                        className="text-xs px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 flex items-center gap-1"
                                                                    >
                                                                        <Icons.Plus className="w-3 h-3" />
                                                                        {t('addEfiDisk')}
                                                                    </button>
                                                                </div>
                                                                <p className="text-xs text-gray-600 mt-2">{t('efiDiskRequired')}</p>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* TPM */}
                                                    <div>
                                                        <div className="flex justify-between items-center mb-2">
                                                            <span className="text-sm text-gray-400">{t('tpmChip')}</span>
                                                        </div>
                                                        {config?.raw?.tpmstate0 ? (
                                                            <div className="p-3 bg-proxmox-dark rounded-lg">
                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-2">
                                                                        <Icons.Shield className="w-4 h-4 text-green-400" />
                                                                        <span className="text-sm font-mono text-gray-300">{config.raw.tpmstate0}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded">TPM 2.0</span>
                                                                        <button
                                                                            onClick={async () => {
                                                                                if (!confirm(t('confirmDeleteTpm'))) return;
                                                                                try {
                                                                                    const res = await fetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/config`, {
                                                                                        method: 'PUT',
                                                                                        credentials: 'include',
                                                                                        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                                                                                        body: JSON.stringify({ delete: 'tpmstate0' })
                                                                                    });
                                                                                    if (res.ok) {
                                                                                        addToast(t('tpmDeleted'), 'success');
                                                                                        fetchConfig();
                                                                                    } else {
                                                                                        const err = await res.json();
                                                                                        addToast(err.error || 'Error deleting TPM', 'error');
                                                                                    }
                                                                                } catch (e) {
                                                                                    addToast('Error deleting TPM', 'error');
                                                                                }
                                                                            }}
                                                                            className="text-xs px-2 py-1 text-red-400 hover:bg-red-500/20 rounded"
                                                                            title={t('delete')}
                                                                        >
                                                                            <Icons.Trash className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="p-3 bg-proxmox-dark rounded-lg border border-dashed border-proxmox-border">
                                                                <div className="flex items-center justify-between">
                                                                    <span className="text-sm text-gray-500">{t('noTpm')}</span>
                                                                    <button
                                                                        onClick={() => setShowAddTpm(true)}
                                                                        className="text-xs px-3 py-1.5 bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 flex items-center gap-1"
                                                                    >
                                                                        <Icons.Plus className="w-3 h-3" />
                                                                        {t('addTpm')}
                                                                    </button>
                                                                </div>
                                                                <p className="text-xs text-yellow-500 mt-2 flex items-center gap-1">
                                                                    <Icons.AlertTriangle className="w-3 h-3" />
                                                                    {t('win11NeedsTpm')}
                                                                </p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* PCI/USB/Serial Passthrough Section */}
                                            <div className="mt-6 pt-6 border-t border-proxmox-border">
                                                <h3 className={isCorporate ? 'corp-card-header' : 'text-white font-medium mb-4 flex items-center gap-2'}>
                                                    🔌 {t('devicePassthrough')}
                                                    {vm.status === 'running' && (
                                                        <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded">
                                                            {t('changesAfterRestart')}
                                                        </span>
                                                    )}
                                                </h3>

                                                {/* PCI Devices */}
                                                <div className="mb-4">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <span className="text-sm text-gray-400">{t('pciDevices')}</span>
                                                        <button
                                                            onClick={() => setShowAddPci(true)}
                                                            className="text-xs px-2 py-1 bg-proxmox-orange/20 text-proxmox-orange rounded hover:bg-proxmox-orange/30"
                                                        >
                                                            + {t('addPci')}
                                                        </button>
                                                    </div>
                                                    {passthrough.pci?.length > 0 ? (
                                                        <div className="space-y-1">
                                                            {passthrough.pci.map((dev, idx) => (
                                                                <div key={idx} className="flex items-center justify-between p-2 bg-proxmox-dark rounded text-sm">
                                                                    <span className="font-mono text-gray-300">{dev.key}: {dev.value}</span>
                                                                    <button
                                                                        onClick={() => handleRemovePassthrough('pci', dev.key)}
                                                                        className="text-red-400 hover:text-red-300 p-1"
                                                                    >
                                                                        <Icons.Trash className="w-3 h-3" />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="text-xs text-gray-500 italic">{t('noPciDevices')}</div>
                                                    )}
                                                </div>

                                                {/* USB Devices */}
                                                <div className="mb-4">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <span className="text-sm text-gray-400">{t('usbDevices')}</span>
                                                        <button
                                                            onClick={() => setShowAddUsb(true)}
                                                            className="text-xs px-2 py-1 bg-proxmox-orange/20 text-proxmox-orange rounded hover:bg-proxmox-orange/30"
                                                        >
                                                            + {t('addUsb')}
                                                        </button>
                                                    </div>
                                                    {passthrough.usb?.length > 0 ? (
                                                        <div className="space-y-1">
                                                            {passthrough.usb.map((dev, idx) => (
                                                                <div key={idx} className="flex items-center justify-between p-2 bg-proxmox-dark rounded text-sm">
                                                                    <span className="font-mono text-gray-300">{dev.key}: {dev.value}</span>
                                                                    <button
                                                                        onClick={() => handleRemovePassthrough('usb', dev.key)}
                                                                        className="text-red-400 hover:text-red-300 p-1"
                                                                    >
                                                                        <Icons.Trash className="w-3 h-3" />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="text-xs text-gray-500 italic">{t('noUsbDevices')}</div>
                                                    )}
                                                </div>

                                                {/* Serial Ports */}
                                                <div>
                                                    <div className="flex justify-between items-center mb-2">
                                                        <span className="text-sm text-gray-400">{t('serialPorts')}</span>
                                                        <button
                                                            onClick={() => setShowAddSerial(true)}
                                                            className="text-xs px-2 py-1 bg-proxmox-orange/20 text-proxmox-orange rounded hover:bg-proxmox-orange/30"
                                                        >
                                                            + {t('addSerial')}
                                                        </button>
                                                    </div>
                                                    {passthrough.serial?.length > 0 ? (
                                                        <div className="space-y-1">
                                                            {passthrough.serial.map((dev, idx) => (
                                                                <div key={idx} className="flex items-center justify-between p-2 bg-proxmox-dark rounded text-sm">
                                                                    <span className="font-mono text-gray-300">{dev.key}: {dev.value}</span>
                                                                    <button
                                                                        onClick={() => handleRemovePassthrough('serial', dev.key)}
                                                                        className="text-red-400 hover:text-red-300 p-1"
                                                                    >
                                                                        <Icons.Trash className="w-3 h-3" />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="text-xs text-gray-500 italic">{t('noSerialPorts')}</div>
                                                    )}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Disks Tab */}
                            {activeTab === 'disks' && (
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <h3 className="font-medium text-white">{t('disks')}</h3>
                                        <div className="flex gap-2">
                                            {isQemu && (
                                                <button
                                                    onClick={() => setShowMountISO(true)}
                                                    className="flex items-center gap-2 px-3 py-1.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-sm text-gray-300 hover:text-white hover:border-proxmox-orange transition-colors"
                                                >
                                                    <Icons.Play />
                                                    {t('mountIso')}
                                                </button>
                                            )}
                                            <button
                                                onClick={() => setShowAddDisk(true)}
                                                className="flex items-center gap-2 px-3 py-1.5 bg-proxmox-orange rounded-lg text-sm text-white hover:bg-orange-600 transition-colors"
                                            >
                                                <Icons.Plus />
                                                {t('addDisk')}
                                            </button>
                                            {isQemu && (
                                                <button
                                                    onClick={() => setShowImportDisk(true)}
                                                    className="flex items-center gap-2 px-3 py-1.5 bg-proxmox-dark border border-proxmox-border rounded-lg text-sm text-gray-300 hover:text-white hover:border-proxmox-orange transition-colors"
                                                >
                                                    <Icons.Download />
                                                    {t('importDisk')}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {config.disks?.length > 0 ? (
                                        config.disks.map((disk) => {
                                            // Single source of truth for the cdrom check
                                            // (used to swap the row's actions for an ISO-aware set).
                                            const isCdrom = isQemu && (
                                                String(disk.value || '').includes('media=cdrom') ||
                                                disk.media === 'cdrom' ||
                                                (disk.volume || '').includes('iso')
                                            );
                                            return (
                                                <div key={disk.id} className="p-4 bg-proxmox-dark rounded-lg border border-proxmox-border">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <div className="flex items-center gap-3">
                                                            {isCdrom ? <Icons.Disc /> : <Icons.HardDrive />}
                                                            <span className="font-medium text-white">{disk.id}</span>
                                                            <span className="text-xs text-gray-500 bg-proxmox-card px-2 py-0.5 rounded">{disk.storage}</span>
                                                            {isCdrom && (
                                                                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">CD</span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm text-proxmox-orange font-mono mr-2">{disk.size}</span>
                                                            {/* Direct "Change ISO" entry point so the user
                                                                    no longer has to detach + remount just to swap the image. */}
                                                            {isCdrom && (
                                                                <button
                                                                    onClick={() => { setMountIsoInitialDrive(disk.id); setShowMountISO(true); }}
                                                                    className="p-1.5 rounded hover:bg-proxmox-hover text-gray-400 hover:text-blue-400 transition-colors"
                                                                    title={t('changeIso')}
                                                                >
                                                                    <Icons.Disc />
                                                                </button>
                                                            )}
                                                            {/* Edit disk bus type - not for CD-ROMs */}
                                                            {isQemu && !isCdrom && disk.id !== 'rootfs' && !disk.id.includes('efidisk') && !disk.id.includes('tpmstate') && (
                                                                <button
                                                                    onClick={() => setShowEditDisk(disk)}
                                                                    className="p-1.5 rounded hover:bg-proxmox-hover text-gray-400 hover:text-yellow-400 transition-colors"
                                                                    title={t('editDiskType')}
                                                                >
                                                                    <Icons.Edit />
                                                                </button>
                                                            )}
                                                            {!isCdrom && (
                                                                <button
                                                                    onClick={() => setShowResizeDisk(disk)}
                                                                    className="p-1.5 rounded hover:bg-proxmox-hover text-gray-400 hover:text-green-400 transition-colors"
                                                                    title={t('resize')}
                                                                >
                                                                    <Icons.Plus />
                                                                </button>
                                                            )}
                                                            {!isCdrom && (
                                                                <button
                                                                    onClick={() => setShowMoveDisk(disk)}
                                                                    className="p-1.5 rounded hover:bg-proxmox-hover text-gray-400 hover:text-blue-400 transition-colors"
                                                                    title={t('move')}
                                                                >
                                                                    <Icons.ArrowRight />
                                                                </button>
                                                            )}
                                                            {disk.id !== 'rootfs' && !disk.id.includes('efidisk') && !disk.id.includes('tpmstate') && (
                                                                <>
                                                                    {/* Only show reassign for real disks, not CD-ROM/ISO */}
                                                                    {isQemu && !disk.volume?.includes('iso') && !disk.media?.includes('cdrom') && !String(disk.value || '').includes('media=cdrom') && (
                                                                        <button
                                                                            onClick={() => setShowReassignOwner(disk)}
                                                                            className="p-1.5 rounded hover:bg-proxmox-hover text-gray-400 hover:text-purple-400 transition-colors"
                                                                            title={t('reassignOwner')}
                                                                        >
                                                                            <Icons.Users />
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        onClick={() => handleDetachDisk(disk.id)}
                                                                        className="p-1.5 rounded hover:bg-proxmox-hover text-gray-400 hover:text-yellow-400 transition-colors"
                                                                        title={t('detachDisk')}
                                                                    >
                                                                        <Icons.Unplug />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleRemoveDisk(disk.id)}
                                                                        className="p-1.5 rounded hover:bg-proxmox-hover text-gray-400 hover:text-red-400 transition-colors"
                                                                        title={t('remove')}
                                                                    >
                                                                        <Icons.Trash />
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-4 gap-4 text-sm">
                                                        <div>
                                                            <span className="text-gray-500">Volume:</span>
                                                            <span className="ml-2 text-gray-300 font-mono text-xs">{disk.volume}</span>
                                                        </div>
                                                        {disk.cache && (
                                                            <div>
                                                                <span className="text-gray-500">Cache:</span>
                                                                <span className="ml-2 text-gray-300">{disk.cache}</span>
                                                            </div>
                                                        )}
                                                        {disk.iothread ? (
                                                            <div><span className="text-green-400">IOthread</span></div>
                                                        ) : null}
                                                        {disk.ssd ? (
                                                            <div><span className="text-blue-400">SSD</span></div>
                                                        ) : null}
                                                        {disk.mountpoint && (
                                                            <div>
                                                                <span className="text-gray-500">Mount:</span>
                                                                <span className="ml-2 text-gray-300">{disk.mountpoint}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="text-center py-8 text-gray-500">
                                            {t('noDisksConfigured')}
                                        </div>
                                    )}

                                    {/* Unused Disks Section - detached disks that can be reattached or deleted */}
                                    {config.unused_disks?.length > 0 && (
                                        <div className="mt-6 pt-4 border-t border-proxmox-border">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Icons.AlertTriangle className="w-4 h-4 text-yellow-500" />
                                                <h4 className="font-medium text-yellow-400">{t('unusedDisks')}</h4>
                                                <span className="text-xs text-gray-500">({config.unused_disks.length})</span>
                                            </div>
                                            <p className="text-xs text-gray-500 mb-3">
                                                {t('unusedDisksDesc')}
                                            </p>
                                            {config.unused_disks.map((disk) => (
                                                <div key={disk.id} className="p-3 bg-yellow-500/5 rounded-lg border border-yellow-500/30 mb-2">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <Icons.HardDrive className="text-yellow-500" />
                                                            <span className="font-medium text-yellow-400">{disk.id}</span>
                                                            <span className="text-xs text-gray-400 font-mono">{disk.value}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            {/* Open reattach modal */}
                                                            <button
                                                                onClick={() => setShowReattachDisk(disk)}
                                                                className="px-2 py-1 text-xs bg-green-600/20 text-green-400 rounded hover:bg-green-600/30 transition-colors"
                                                                title={t('reattachDisk')}
                                                            >
                                                                {t('reattach')}
                                                            </button>
                                                            {/* Delete permanently */}
                                                            <button
                                                                onClick={async () => {
                                                                    if (!confirm(t('deleteUnusedDiskConfirm') || `Permanently delete ${disk.id}? This cannot be undone!`)) return;
                                                                    try {
                                                                        // First delete the unused reference, then purge the actual volume
                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/config`, {
                                                                            method: 'PUT',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ delete: disk.id })
                                                                        });
                                                                        if (res && res.ok) {
                                                                            addToast(t('unusedDiskDeleted'), 'success');
                                                                            fetchConfig();
                                                                        } else {
                                                                            const err = await res.json();
                                                                            addToast(err.error || 'Error deleting disk', 'error');
                                                                        }
                                                                    } catch (e) {
                                                                        addToast('Error deleting disk', 'error');
                                                                    }
                                                                }}
                                                                className="px-2 py-1 text-xs bg-red-600/20 text-red-400 rounded hover:bg-red-600/30 transition-colors"
                                                                title={t('deletePermanently')}
                                                            >
                                                                {t('delete')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Network Tab */}
                            {activeTab === 'network' && (
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <h3 className="font-medium text-white">{t('networkInterfaces')}</h3>
                                        <button
                                            onClick={() => setShowAddNetwork(true)}
                                            className="flex items-center gap-2 px-3 py-1.5 bg-proxmox-orange rounded-lg text-sm text-white hover:bg-orange-600 transition-colors"
                                        >
                                            <Icons.Plus />
                                            {t('addNetwork')}
                                        </button>
                                    </div>

                                    {config.networks?.length > 0 ? (
                                        config.networks.map((net) => (
                                            <div key={net.id} className={`p-4 bg-proxmox-dark rounded-lg border ${net.link_down ? 'border-red-500/50' : 'border-proxmox-border'}`}>
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-3">
                                                        <Icons.Network className={net.link_down ? 'text-red-400' : ''} />
                                                        <span className="font-medium text-white">{net.id}</span>
                                                        {net.bridge && (() => {
                                                            const bridgeInfo = bridgeList.find(b => b.iface === net.bridge);
                                                            const isSDN = bridgeInfo?.source === 'sdn';
                                                            // Check if it looks like an SDN VNet name (no vmbr prefix)
                                                            const looksLikeSDN = !bridgeInfo && net.bridge && !net.bridge.startsWith('vmbr');
                                                            return (
                                                                <span className={`text-xs px-2 py-0.5 rounded ${isSDN ? 'text-purple-400 bg-purple-500/10' : looksLikeSDN ? 'text-purple-400 bg-purple-500/10' : 'text-gray-500 bg-proxmox-card'}`}
                                                                    title={bridgeInfo?.comments || (isSDN ? `SDN Zone: ${bridgeInfo?.zone}` : (looksLikeSDN ? 'Possible SDN VNet' : ''))}>
                                                                    {(isSDN || looksLikeSDN) && <span className="mr-1">🌐</span>}
                                                                    {net.bridge}
                                                                    {bridgeInfo?.zone ? ` (${bridgeInfo.zone})` : (bridgeInfo?.comments ? ` (${bridgeInfo.comments})` : '')}
                                                                    {looksLikeSDN && !bridgeInfo && ' (SDN?)'}
                                                                </span>
                                                            );
                                                        })()}
                                                        {/* Show disconnected status */}
                                                        {net.link_down && (
                                                            <span className="text-xs text-red-400 bg-red-500/10 px-2 py-0.5 rounded flex items-center gap-1">
                                                                <Icons.WifiOff className="w-3 h-3" />
                                                                {t('networkDisconnected')}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {net.firewall ? (
                                                            <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded">Firewall</span>
                                                        ) : null}
                                                        {/* Connect/Disconnect toggle (QEMU only - hot-pluggable) */}
                                                        {isQemu && (
                                                            <button
                                                                onClick={() => handleToggleNetworkLink(net.id, net.link_down)}
                                                                className={`p-1.5 rounded hover:bg-proxmox-hover transition-colors ${net.link_down ? 'text-red-400 hover:text-green-400' : 'text-gray-400 hover:text-red-400'}`}
                                                                title={net.link_down ? t('connectNetwork') : t('disconnectNetwork')}
                                                            >
                                                                {net.link_down ? <Icons.Plug /> : <Icons.Unplug />}
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => setShowEditNetwork(net)}
                                                            className="p-1.5 rounded hover:bg-proxmox-hover text-gray-400 hover:text-blue-400 transition-colors"
                                                            title={t('edit')}
                                                        >
                                                            <Icons.Cog />
                                                        </button>
                                                        <button
                                                            onClick={() => handleRemoveNetwork(net.id)}
                                                            className="p-1.5 rounded hover:bg-proxmox-hover text-gray-400 hover:text-red-400 transition-colors"
                                                            title={t('remove')}
                                                        >
                                                            <Icons.Trash />
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-4 text-sm">
                                                    {isQemu ? (
                                                        <>
                                                            <div><span className="text-gray-500">Model:</span><span className="ml-2 text-gray-300">{net.model || 'virtio'}</span></div>
                                                            <div><span className="text-gray-500">MAC:</span><span className="ml-2 text-gray-300 font-mono text-xs">{net.macaddr || 'auto'}</span></div>
                                                            {net.queues && <div><span className="text-gray-500">Queues:</span><span className="ml-2 text-gray-300">{net.queues}</span></div>}
                                                        </>
                                                    ) : (
                                                        <>
                                                            <div><span className="text-gray-500">{t('name')}:</span><span className="ml-2 text-gray-300">{net.name || 'eth0'}</span></div>
                                                            <div><span className="text-gray-500">IP:</span><span className="ml-2 text-gray-300 font-mono">{net.ip || 'dhcp'}</span></div>
                                                            {net.gw && <div><span className="text-gray-500">Gateway:</span><span className="ml-2 text-gray-300 font-mono">{net.gw}</span></div>}
                                                        </>
                                                    )}
                                                    {net.tag && <div><span className="text-gray-500">VLAN:</span><span className="ml-2 text-gray-300">{net.tag}</span></div>}
                                                    {net.rate && <div><span className="text-gray-500">Rate:</span><span className="ml-2 text-gray-300">{net.rate} MB/s</span></div>}
                                                    {net.mtu && <div><span className="text-gray-500">MTU:</span><span className="ml-2 text-gray-300">{net.mtu}</span></div>}
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center py-8 text-gray-500">
                                            {t('noNetworksConfigured')}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Snapshots Tab */}
                            {activeTab === 'snapshots' && (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-semibold text-gray-300">Snapshots</h3>
                                        <button
                                            onClick={() => canCreateSnapshots && setShowCreateSnapshot(true)}
                                            disabled={!canCreateSnapshots}
                                            title={canCreateSnapshots ? '' : (snapshotCapability?.reason || "The current guest configuration does not support taking new snapshots")}
                                            className="flex items-center gap-2 px-3 py-1.5 bg-green-600 rounded-lg text-white text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <Icons.Plus />
                                            {t('createSnapshot')}
                                        </button>
                                    </div>

                                    {!canCreateSnapshots && (
                                        <div className="p-4 bg-proxmox-dark rounded-lg border border-yellow-500/30 text-yellow-400 text-sm">
                                            <div className="flex items-center gap-2">
                                                <Icons.AlertTriangle />
                                                <span>{"The current guest configuration does not support taking new snapshots"}</span>
                                            </div>
                                            {snapshotCapability?.reason && (
                                                <div className="mt-1 pl-6 opacity-90">{snapshotCapability.reason}</div>
                                            )}
                                            <div className="mt-1 pl-6 opacity-90">To enable snapshots, use qcow2, ZFS or thin-LVM storage, avoid raw disks and PCI/USB passthrough, and for LXC use a supported rootfs.</div>
                                        </div>
                                    )}

                                    {snapshots.length > 0 ? (
                                        <div className="space-y-3">
                                            {snapshots.map(snap => (
                                                <div key={snap.name} className="p-4 bg-proxmox-dark rounded-lg border border-proxmox-border">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <div className="p-2 bg-blue-500/10 rounded-lg">
                                                                <Icons.Clock />
                                                            </div>
                                                            <div>
                                                                <div className="font-medium text-white">{snap.name}</div>
                                                                <div className="text-xs text-gray-400">
                                                                    {snap.snaptime ? new Date(snap.snaptime * 1000).toLocaleString() : t('unknown')}
                                                                    {snap.vmstate && <span className="ml-2 text-blue-400">+ RAM</span>}
                                                                </div>
                                                                {snap.description && (
                                                                    <div className="text-sm text-gray-500 mt-1">{snap.description}</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => handleRollbackSnapshot(snap.name)}
                                                                disabled={snapshotLoading}
                                                                className="p-2 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 transition-colors disabled:opacity-50"
                                                                title={t('rollback')}
                                                            >
                                                                <Icons.RotateCcw />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteSnapshot(snap.name)}
                                                                disabled={snapshotLoading}
                                                                className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors disabled:opacity-50"
                                                                title={t('delete')}
                                                            >
                                                                <Icons.Trash />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 text-gray-500">
                                            <Icons.Clock />
                                            <p className="mt-2">{t('noSnapshots')}</p>
                                        </div>
                                    )}

                                    {/* Space-Efficient Snapshots Section */}
                                    {efficientSnapshots.length > 0 && (
                                        <div className="mt-6">
                                            <div className="flex items-center gap-2 mb-3">
                                                <Icons.Zap className="text-green-400" />
                                                <h3 className="text-sm font-semibold text-green-400">{t('spaceEfficientSnapshots')}</h3>
                                                <span className="text-xs text-gray-500">({t('managedByProxmoxVEx')})</span>
                                            </div>
                                            <div className="space-y-3">
                                                {efficientSnapshots.map(snap => {
                                                    const isInvalidated = snap.status === 'invalidated';
                                                    return (
                                                        <div key={snap.id} className={`p-4 rounded-lg border ${isInvalidated
                                                            ? 'bg-gray-800/50 border-gray-700'
                                                            : 'bg-proxmox-dark border-green-500/30'
                                                            }`}>
                                                            <div className="flex items-center justify-between mb-2">
                                                                <div className="flex items-center gap-3">
                                                                    <div className={`p-2 rounded-lg ${isInvalidated ? 'bg-gray-500/10' : 'bg-green-500/10'}`}>
                                                                        <Icons.Zap className={isInvalidated ? 'text-gray-500' : ''} />
                                                                    </div>
                                                                    <div>
                                                                        <div className="flex items-center gap-2">
                                                                            <span className={`font-medium ${isInvalidated ? 'text-gray-500 line-through' : 'text-white'}`}>{snap.snapname}</span>
                                                                            <span className="px-1.5 py-0.5 text-xs rounded bg-green-500/20 text-green-400">{t('cowSnapshot')}</span>
                                                                            {snap.fs_frozen && <span className="px-1.5 py-0.5 text-xs rounded bg-blue-500/20 text-blue-400">{t('fsFrozen')}</span>}
                                                                        </div>
                                                                        <div className="text-xs text-gray-400 mt-0.5">
                                                                            {snap.created_at ? new Date(snap.created_at).toLocaleString() : ''}
                                                                            <span className="ml-2 text-gray-500">
                                                                                {snap.total_snap_alloc_gb?.toFixed(1)} GB / {snap.total_disk_size_gb?.toFixed(1)} GB
                                                                            </span>
                                                                        </div>
                                                                        {snap.description && <div className="text-sm text-gray-500 mt-1">{snap.description}</div>}
                                                                        {isInvalidated && <div className="text-xs text-red-400 mt-1">{t('snapshotInvalidated')}</div>}
                                                                    </div>
                                                                </div>
                                                                {!isInvalidated && (
                                                                    <div className="flex items-center gap-2">
                                                                        <button
                                                                            onClick={() => handleRollbackEfficientSnapshot(snap.id, snap.snapname)}
                                                                            disabled={snapshotLoading}
                                                                            className="p-2 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 transition-colors disabled:opacity-50"
                                                                            title={t('rollback')}
                                                                        >
                                                                            <Icons.RotateCcw />
                                                                        </button>
                                                                        <button
                                                                            onClick={() => handleDeleteEfficientSnapshot(snap.id, snap.snapname)}
                                                                            disabled={snapshotLoading}
                                                                            className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors disabled:opacity-50"
                                                                            title={t('delete')}
                                                                        >
                                                                            <Icons.Trash />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                                {isInvalidated && (
                                                                    <button
                                                                        onClick={() => handleDeleteEfficientSnapshot(snap.id, snap.snapname)}
                                                                        disabled={snapshotLoading}
                                                                        className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors disabled:opacity-50"
                                                                        title={t('delete')}
                                                                    >
                                                                        <Icons.Trash />
                                                                    </button>
                                                                )}
                                                            </div>
                                                            {/* Per-disk usage bars */}
                                                            {!isInvalidated && snap.disks?.length > 0 && (
                                                                <div className="mt-2 space-y-1.5">
                                                                    {snap.disks.map(disk => {
                                                                        const pct = disk.snap_used_percent || 0;
                                                                        const barColor = pct >= 80 ? (pct >= 95 ? 'bg-red-500' : 'bg-yellow-500') : 'bg-green-500';
                                                                        return (
                                                                            <div key={disk.disk_key} className="text-xs">
                                                                                <div className="flex justify-between text-gray-400 mb-0.5">
                                                                                    <span>{disk.disk_key} ({disk.original_lv})</span>
                                                                                    <span className={pct >= 80 ? (pct >= 95 ? 'text-red-400' : 'text-yellow-400') : 'text-gray-400'}>
                                                                                        {pct.toFixed(1)}% {t('snapshotUsage')}
                                                                                        {pct >= 80 && ' ⚠'}
                                                                                    </span>
                                                                                </div>
                                                                                <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                                                                                    <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${Math.min(100, pct)}%` }}></div>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                    {snap.disks.some(d => (d.snap_used_percent || 0) >= 80) && (
                                                                        <div className="text-xs text-yellow-400 flex items-center gap-1 mt-1">
                                                                            <Icons.AlertTriangle />
                                                                            {t('snapshotOverflow')}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Create Snapshot Modal */}
                                    {showCreateSnapshot && (
                                        <CreateSnapshotModal
                                            isQemu={isQemu}
                                            onSubmit={handleCreateSnapshot}
                                            onClose={() => setShowCreateSnapshot(false)}
                                            loading={snapshotLoading}
                                            efficientInfo={efficientInfo}
                                        />
                                    )}
                                </div>
                            )}

                            {/* Backups Tab */}
                            {activeTab === 'backups' && (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-semibold text-gray-300">{t('backupsTab')}</h3>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={fetchBackups}
                                                disabled={backupLoading}
                                                className="p-2 hover:bg-proxmox-hover rounded-lg text-gray-400"
                                                title={t('refresh')}
                                            >
                                                <Icons.RotateCw className={backupLoading ? 'animate-spin' : ''} />
                                            </button>
                                            <button
                                                onClick={() => setShowCreateBackup(true)}
                                                className="flex items-center gap-2 px-3 py-1.5 bg-green-600 rounded-lg text-white text-sm hover:bg-green-700"
                                            >
                                                <Icons.Plus />
                                                {t('createBackup')}
                                            </button>
                                        </div>
                                    </div>

                                    {backupLoading ? (
                                        <div className="flex items-center justify-center py-8">
                                            <Icons.RotateCw className="animate-spin text-gray-400" />
                                        </div>
                                    ) : vmBackups.length > 0 ? (
                                        <div className="space-y-3">
                                            {vmBackups.map(backup => (
                                                <div key={backup.volid} className={`p-4 bg-proxmox-dark rounded-lg border ${verifyResults[backup.volid]?.status === 'passed' ? 'border-green-500/30' : verifyResults[backup.volid]?.status === 'failed' || verifyResults[backup.volid]?.status === 'error' ? 'border-red-500/30' : 'border-proxmox-border'}`}>
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <div className="p-2 bg-purple-500/10 rounded-lg">
                                                                <Icons.Database className="text-purple-400" />
                                                            </div>
                                                            <div>
                                                                <div className="font-medium text-white">{backup.filename}</div>
                                                                <div className="text-xs text-gray-400">
                                                                    {backup.ctime ? new Date(backup.ctime * 1000).toLocaleString() : ''}
                                                                    <span className="mx-2">•</span>
                                                                    {(backup.size / (1024 * 1024 * 1024)).toFixed(2)} GB
                                                                    <span className="mx-2">•</span>
                                                                    <span className="text-gray-500">{backup.storage}</span>
                                                                </div>
                                                                {backup.notes && (
                                                                    <div className="text-sm text-gray-500 mt-1">{backup.notes}</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => handleVerifyBackup(backup)}
                                                                disabled={verifyingBackup === backup.volid}
                                                                className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${verifyResults[backup.volid]?.status === 'passed' ? 'bg-green-500/10 text-green-400' :
                                                                    verifyResults[backup.volid]?.status === 'failed' || verifyResults[backup.volid]?.status === 'error' ? 'bg-red-500/10 text-red-400' :
                                                                        verifyingBackup === backup.volid ? 'bg-yellow-500/10 text-yellow-400' :
                                                                            'bg-purple-500/10 hover:bg-purple-500/20 text-purple-400'
                                                                    }`}
                                                                title={verifyResults[backup.volid]?.status === 'passed' ? (t('verifiedOk2')) :
                                                                    verifyResults[backup.volid]?.status ? verifyResults[backup.volid].status :
                                                                        (t('verifyBackup'))}
                                                            >
                                                                {verifyingBackup === backup.volid ? (
                                                                    <Icons.RotateCw className="animate-spin" />
                                                                ) : verifyResults[backup.volid]?.status === 'passed' ? (
                                                                    <Icons.CheckCircle />
                                                                ) : verifyResults[backup.volid]?.status === 'failed' || verifyResults[backup.volid]?.status === 'error' ? (
                                                                    <Icons.XCircle />
                                                                ) : (
                                                                    <Icons.Shield />
                                                                )}
                                                            </button>
                                                            <button
                                                                onClick={() => setShowRestoreBackup(backup)}
                                                                disabled={backupLoading}
                                                                className="p-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors disabled:opacity-50"
                                                                title={t('restore')}
                                                            >
                                                                <Icons.RotateCcw />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteBackup(backup.volid)}
                                                                disabled={backupLoading}
                                                                className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors disabled:opacity-50"
                                                                title={t('delete')}
                                                            >
                                                                <Icons.Trash />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    {/* Verification status bar */}
                                                    {(verifyingBackup === backup.volid || verifyResults[backup.volid]) && (
                                                        <div className={`mt-3 pt-3 border-t text-xs flex flex-wrap items-center gap-2 ${verifyResults[backup.volid]?.status === 'passed' ? 'border-green-500/20 text-green-400' :
                                                            verifyResults[backup.volid]?.status === 'failed' || verifyResults[backup.volid]?.status === 'error' ? 'border-red-500/20 text-red-400' :
                                                                'border-yellow-500/20 text-yellow-400'
                                                            }`}>
                                                            {verifyingBackup === backup.volid ? (
                                                                <>
                                                                    <Icons.RotateCw className="w-3 h-3 animate-spin" />
                                                                    <span>{verifyResults[backup.volid]?.phase === 'restoring' ? (t('restoring')) :
                                                                        verifyResults[backup.volid]?.phase === 'booting' ? (t('booting')) :
                                                                            verifyResults[backup.volid]?.phase === 'verifying' ? (t('verifying2')) :
                                                                                verifyResults[backup.volid]?.phase === 'cleanup' ? (t('cleaningUp')) :
                                                                                    (t('verifying3'))}</span>
                                                                </>
                                                            ) : verifyResults[backup.volid]?.status === 'passed' ? (
                                                                <>
                                                                    <Icons.CheckCircle className="w-3 h-3" />
                                                                    <span>{t('backupVerified')} — {t('restoreBootOk')}</span>
                                                                    <span className="text-gray-500 ml-auto">{verifyResults[backup.volid]?.duration_seconds}s</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Icons.XCircle className="w-3 h-3" />
                                                                    <span>{verifyResults[backup.volid]?.error?.substring(0, 80) || (t('verificationFailed3'))}</span>
                                                                    <span className="text-gray-500 ml-auto">{verifyResults[backup.volid]?.duration_seconds}s</span>
                                                                </>
                                                            )}
                                                            <div className="w-full bg-gray-700 rounded-full h-2 mt-2 overflow-hidden">
                                                                <div className="bg-green-500 h-2 rounded-full transition-all duration-500" style={{ width: (verifyResults[backup.volid]?.progress || 0) + '%' }} />
                                                            </div>
                                                            {verifyResults[backup.volid]?.logs?.length > 0 && (
                                                                <pre className="w-full mt-2 p-2 bg-proxmox-dark rounded text-xs font-mono text-gray-400 overflow-y-auto max-h-32" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                                                    {verifyResults[backup.volid].logs.join('\n')}
                                                                </pre>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 text-gray-500">
                                            <Icons.Database className="mx-auto opacity-50" />
                                            <p className="mt-2">{t('noBackups')}</p>
                                            <p className="text-xs mt-1">{t('noBackupsHint')}</p>
                                        </div>
                                    )}

                                    {/* Create Backup Modal */}
                                    {showCreateBackup && (
                                        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                                            <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-card border border-proxmox-border rounded-xl p-6 w-full max-w-md'}>
                                                <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold mb-4'}>{t('createBackup')}</h3>
                                                <div className="space-y-4">
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-2'}>{t('storage')}</label>
                                                        <select
                                                            id="backup-storage"
                                                            defaultValue="local" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white'}
                                                        >
                                                            {storageList.filter(s => s.content?.includes('backup')).map(s => (
                                                                <option key={s.storage} value={s.storage}>{s.storage}</option>
                                                            ))}
                                                            {!storageList.some(s => s.content?.includes('backup')) && (
                                                                <option value="local">local</option>
                                                            )}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-2'}>{t('backupMode2')}</label>
                                                        <select
                                                            id="backup-mode"
                                                            defaultValue="snapshot" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white'}
                                                        >
                                                            <option value="snapshot">{t('backupModeSnapshot')}</option>
                                                            <option value="suspend">{t('backupModeSuspend')}</option>
                                                            <option value="stop">{t('backupModeStop')}</option>
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-2'}>{t('compression')}</label>
                                                        <select
                                                            id="backup-compress"
                                                            defaultValue="zstd" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white'}
                                                        >
                                                            <option value="zstd">{t('compressZstd')}</option>
                                                            <option value="lzo">{t('compressLzo')}</option>
                                                            <option value="gzip">{t('compressGzip')}</option>
                                                            <option value="0">{t('compressNone')}</option>
                                                        </select>
                                                    </div>
                                                    {/* Notes/Description field */}
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-2'}>{t('backupNotes')}</label>
                                                        <textarea
                                                            id="backup-notes"
                                                            placeholder={t('backupNotesPlaceholder')} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white resize-none'}
                                                            rows={2}
                                                        />
                                                    </div>
                                                    <div className="flex gap-2 justify-end pt-2">
                                                        <button
                                                            onClick={() => setShowCreateBackup(false)}
                                                            className="px-4 py-2 bg-proxmox-dark hover:bg-proxmox-hover rounded-lg"
                                                        >
                                                            {t('cancel')}
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                const storage = document.getElementById('backup-storage').value;
                                                                const mode = document.getElementById('backup-mode').value;
                                                                const compress = document.getElementById('backup-compress').value;
                                                                const notes = document.getElementById('backup-notes').value;
                                                                handleCreateBackup(storage, mode, compress, notes);
                                                            }}
                                                            disabled={backupLoading}
                                                            className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50"
                                                        >
                                                            {backupLoading ? t('loading') : t('create')}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Restore Backup Modal */}
                                    {showRestoreBackup && (
                                        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                                            <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-card border border-proxmox-border rounded-xl p-6 w-full max-w-md'}>
                                                <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold mb-4'}>{t('restoreBackup')}</h3>
                                                <div className="space-y-4">
                                                    <div className="p-3 bg-proxmox-dark rounded-lg">
                                                        <p className="text-sm text-gray-400">{t('selectedBackup')}:</p>
                                                        <p className="font-mono text-sm truncate">{showRestoreBackup.filename}</p>
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-2'}>{t('targetVmid')}</label>
                                                        <input
                                                            type="number"
                                                            id="restore-vmid"
                                                            defaultValue={vm.vmid} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white'}
                                                        />
                                                        <p className="text-xs text-yellow-400 mt-1">
                                                            {t('sameVmidWarning')}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : 'block text-sm text-gray-400 mb-2'}>{t('targetStorage2')}</label>
                                                        <select
                                                            id="restore-storage"
                                                            defaultValue="" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white'}
                                                        >
                                                            <option value="">{t('originalStorage')}</option>
                                                            {storageList.filter(s => s.content?.includes('images')).map(s => (
                                                                <option key={s.storage} value={s.storage}>{s.storage}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="checkbox"
                                                            id="restore-start"
                                                            className="w-4 h-4 rounded"
                                                        />
                                                        <label htmlFor="restore-start" className={isCorporate ? 'corp-label' : 'text-sm text-gray-300'}>
                                                            {t('startAfterRestore')}
                                                        </label>
                                                    </div>
                                                    <div className="flex gap-2 justify-end pt-2">
                                                        <button
                                                            onClick={() => setShowRestoreBackup(null)}
                                                            className="px-4 py-2 bg-proxmox-dark hover:bg-proxmox-hover rounded-lg"
                                                        >
                                                            {t('cancel')}
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                const targetVmid = parseInt(document.getElementById('restore-vmid').value);
                                                                const storage = document.getElementById('restore-storage').value;
                                                                const startAfter = document.getElementById('restore-start').checked;
                                                                handleRestoreBackup(showRestoreBackup.volid, targetVmid, storage, startAfter);
                                                            }}
                                                            disabled={backupLoading}
                                                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                                                        >
                                                            {backupLoading ? t('loading') : t('restore')}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Replication Tab */}
                            {activeTab === 'replication' && (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-semibold text-gray-300">{t('replicationJobs')}</h3>
                                        <button
                                            onClick={() => setShowCreateReplication(true)}
                                            disabled={allClusterNodes.length < 2}
                                            className="flex items-center gap-2 px-3 py-1.5 bg-green-600 rounded-lg text-white text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <Icons.Plus />
                                            {t('createReplication')}
                                        </button>
                                    </div>

                                    {allClusterNodes.length < 2 && (
                                        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-yellow-400">
                                            ⚠️ {t('replicationNeedsTwoNodes')}
                                        </div>
                                    )}

                                    {replications.length > 0 ? (
                                        <div className="space-y-3">
                                            {replications.map(job => (
                                                <div key={job.id} className="p-4 bg-proxmox-dark rounded-lg border border-proxmox-border">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <div className={`p-2 rounded-lg ${job.error ? 'bg-red-500/10' : 'bg-green-500/10'}`}>
                                                                <Icons.RefreshCw />
                                                            </div>
                                                            <div>
                                                                <div className="font-medium text-white">
                                                                    ↑ {job.target}
                                                                </div>
                                                                <div className="text-xs text-gray-400">
                                                                    Schedule: {job.schedule || '*/15'} |
                                                                    {job.last_sync ? ` ${t('lastSync')}: ${new Date(job.last_sync * 1000).toLocaleString()}` : ` ${t('neverSynced')}`}
                                                                </div>
                                                                {job.error && (
                                                                    <div className="text-xs text-red-400 mt-1">{t('error')}: {job.error}</div>
                                                                )}
                                                                {job.comment && (
                                                                    <div className="text-sm text-gray-500 mt-1">{job.comment}</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => handleRunReplicationNow(job.id)}
                                                                disabled={replicationLoading}
                                                                className="p-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors disabled:opacity-50"
                                                                title={t('syncNow')}
                                                            >
                                                                <Icons.PlayCircle />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteReplication(job.id)}
                                                                disabled={replicationLoading}
                                                                className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors disabled:opacity-50"
                                                                title={t('delete')}
                                                            >
                                                                <Icons.Trash />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 text-gray-500">
                                            <Icons.RefreshCw />
                                            <p className="mt-2">{t('noReplicationJobs')}</p>
                                        </div>
                                    )}

                                    {/* Create Replication Modal */}
                                    {showCreateReplication && (
                                        <CreateReplicationModal
                                            nodes={clusterNodes}
                                            onSubmit={handleCreateReplication}
                                            onClose={() => setShowCreateReplication(false)}
                                            loading={replicationLoading}
                                        />
                                    )}

                                    {/* Cross-cluster replication - DR to other clusters */}
                                    <div className="mt-6">
                                        <div className="flex items-center justify-between mb-3">
                                            <h4 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                                                <Icons.Globe className="w-4 h-4 text-proxmox-orange" />
                                                {t('crossClusterReplication')}
                                            </h4>
                                            <button
                                                onClick={() => setShowCreateXRepl(true)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-proxmox-orange/10 text-proxmox-orange rounded-lg text-xs hover:bg-proxmox-orange/20 transition-colors"
                                            >
                                                <Icons.Plus className="w-3.5 h-3.5" />
                                                {t('addDrJob')}
                                            </button>
                                        </div>

                                        {crossClusterRepls.length === 0 ? (
                                            <div className="text-center py-6 text-gray-500 text-sm">
                                                {t('noReplicationJobs')}
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {crossClusterRepls.map(job => (
                                                    <div key={job.id} className="bg-proxmox-darker rounded-lg p-3 flex items-center justify-between">
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className={`w-2 h-2 rounded-full ${job.enabled ? 'bg-green-500' : 'bg-gray-500'}`} />
                                                                <span className="text-sm text-white">&rarr; {job.target_cluster}</span>
                                                                <span className="text-xs text-gray-500">{job.schedule}</span>
                                                            </div>
                                                            <div className="text-xs text-gray-500 mt-1">
                                                                {job.last_run ? `${t('lastRunPrefix')}: ${new Date(job.last_run).toLocaleString()}` : t('neverRun')}
                                                                {job.last_status && ` \u00b7 ${job.last_status}`}
                                                                {job.last_error && <span className="text-red-400 ml-1">{job.last_error}</span>}
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-1">
                                                            <button onClick={() => handleRunXReplNow(job.id)} className="p-1.5 rounded hover:bg-green-500/10 text-gray-400 hover:text-green-400" title={t('runNow')}>
                                                                <Icons.Play className="w-3.5 h-3.5" />
                                                            </button>
                                                            <button onClick={() => handleDeleteXRepl(job.id)} className="p-1.5 rounded hover:bg-red-500/10 text-gray-400 hover:text-red-400" title={t('delete')}>
                                                                <Icons.Trash className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Inline form for new cross-cluster job */}
                                        {showCreateXRepl && (
                                            <div className="bg-proxmox-dark border border-proxmox-border rounded-lg p-4 mt-3">
                                                <h5 className={isCorporate ? 'corp-card-header' : 'text-sm font-medium mb-3'}>{t('newCrossClusterReplication')}</h5>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('targetCluster')}</label>
                                                        <select
                                                            value={xReplForm.target_cluster}
                                                            onChange={e => setXReplForm(f => ({ ...f, target_cluster: e.target.value, target_storage: '', target_bridge: 'vmbr0' }))} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm'}
                                                        >
                                                            <option value="">{t('selectCluster5')}</option>
                                                            {allClusters.filter(c => c.id !== clusterId && c.connected).map(c => (
                                                                <option key={c.id} value={c.id}>{c.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('targetStorage')}</label>
                                                        {xReplLoadingResources ? (
                                                            <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
                                                                <Icons.RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                                                {t('loading')}...
                                                            </div>
                                                        ) : xReplForm.target_cluster ? (
                                                            <select
                                                                value={xReplForm.target_storage}
                                                                onChange={e => setXReplForm(f => ({ ...f, target_storage: e.target.value }))} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm'}
                                                            >
                                                                <option value="">{t('selectStorage7')}</option>
                                                                {xReplTargetStorages.map(s => (
                                                                    <option key={s.storage} value={s.storage}>{s.storage} ({s.type})</option>
                                                                ))}
                                                            </select>
                                                        ) : (
                                                            <div className="text-xs text-gray-500 py-2">{t('selectClusterFirst5')}</div>
                                                        )}
                                                    </div>
                                                    <div className="col-span-2">
                                                        <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('networkMappings') || t('targetBridge')}</label>
                                                        {xReplLoadingResources ? (
                                                            <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
                                                                <Icons.RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                                                {t('loading')}...
                                                            </div>
                                                        ) : !xReplForm.target_cluster ? (
                                                            <div className="text-xs text-gray-500 py-2">{t('selectClusterFirst6')}</div>
                                                        ) : [...new Set((config?.networks || []).map(n => n.bridge).filter(Boolean))].length > 0 ? (
                                                            // #532 - map each source NIC's bridge to a target bridge of choice
                                                            <div className="space-y-2">
                                                                {[...new Set((config.networks || []).map(n => n.bridge).filter(Boolean))].map(sb => (
                                                                    <div key={sb} className="flex items-center gap-2">
                                                                        <span className="text-xs text-gray-400 w-28 shrink-0 truncate" title={sb}>{sb}</span>
                                                                        <span className="text-gray-600">→</span>
                                                                        <select
                                                                            value={xReplBridgeMap[sb] || ''}
                                                                            onChange={e => setXReplBridgeMap(prev => ({ ...prev, [sb]: e.target.value }))} className={isCorporate ? 'corp-input' : 'flex-1 px-2 py-1.5 bg-proxmox-darker border border-proxmox-border rounded text-white text-sm'}
                                                                        >
                                                                            {xReplTargetBridges.filter(b => b.source !== 'sdn').length > 0 && (
                                                                                <optgroup label="Local Bridges">
                                                                                    {xReplTargetBridges.filter(b => b.source !== 'sdn').map(b => (
                                                                                        <option key={b.iface} value={b.iface}>{b.iface}{b.comments ? ` - ${b.comments}` : ''}</option>
                                                                                    ))}
                                                                                </optgroup>
                                                                            )}
                                                                            {xReplTargetBridges.filter(b => b.source === 'sdn').length > 0 && (
                                                                                <optgroup label="SDN VNets">
                                                                                    {xReplTargetBridges.filter(b => b.source === 'sdn').map(b => (
                                                                                        <option key={b.iface} value={b.iface}>{b.iface} - {b.zone || 'SDN'}{b.alias ? ` (${b.alias})` : ''}</option>
                                                                                    ))}
                                                                                </optgroup>
                                                                            )}
                                                                        </select>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <select
                                                                value={xReplForm.target_bridge}
                                                                onChange={e => setXReplForm(f => ({ ...f, target_bridge: e.target.value }))} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm'}
                                                            >
                                                                {xReplTargetBridges.filter(b => b.source !== 'sdn').length > 0 && (
                                                                    <optgroup label="Local Bridges">
                                                                        {xReplTargetBridges.filter(b => b.source !== 'sdn').map(b => (
                                                                            <option key={b.iface} value={b.iface}>{b.iface}{b.comments ? ` - ${b.comments}` : ''}</option>
                                                                        ))}
                                                                    </optgroup>
                                                                )}
                                                                {xReplTargetBridges.filter(b => b.source === 'sdn').length > 0 && (
                                                                    <optgroup label="SDN VNets">
                                                                        {xReplTargetBridges.filter(b => b.source === 'sdn').map(b => (
                                                                            <option key={b.iface} value={b.iface}>{b.iface} - {b.zone || 'SDN'}{b.alias ? ` (${b.alias})` : ''}</option>
                                                                        ))}
                                                                    </optgroup>
                                                                )}
                                                            </select>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('targetVmidOptional')}</label>
                                                        <input
                                                            type="number"
                                                            min="100"
                                                            value={xReplForm.target_vmid}
                                                            onChange={e => setXReplForm(f => ({ ...f, target_vmid: e.target.value }))}
                                                            placeholder={t('autoNextId')} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm'}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('scheduleCron')}</label>
                                                        <input
                                                            type="text"
                                                            value={xReplForm.schedule}
                                                            onChange={e => setXReplForm(f => ({ ...f, schedule: e.target.value }))}
                                                            placeholder="0 */6 * * *" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm'}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('replicationRetention')}</label>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            max="30"
                                                            value={xReplForm.retention}
                                                            onChange={e => setXReplForm(f => ({ ...f, retention: parseInt(e.target.value) || 1 }))} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-white text-sm'}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 mt-3">
                                                    <button onClick={handleCreateXRepl} className="px-3 py-1.5 bg-proxmox-orange text-white rounded-lg text-sm hover:bg-proxmox-orange/90 transition-colors">{t('create')}</button>
                                                    <button onClick={() => setShowCreateXRepl(false)} className="px-3 py-1.5 bg-proxmox-dark border border-proxmox-border text-gray-300 rounded-lg text-sm hover:bg-proxmox-darker transition-colors">{t('cancel')}</button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* History Tab - */}
                            {activeTab === 'history' && (
                                <div className="space-y-4">
                                    {/* Sub-tabs */}
                                    <div className="flex gap-2 border-b border-proxmox-border pb-2">
                                        <button
                                            onClick={() => { setHistorySubTab('proxmox'); fetchHistory(); }}
                                            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${historySubTab === 'proxmox' ? 'bg-proxmox-orange text-white' : 'text-gray-400 hover:text-white hover:bg-proxmox-dark'}`}
                                        >
                                            {t('proxmoxTasks')}
                                        </button>
                                        <button
                                            onClick={() => { setHistorySubTab('ProxmoxVEx'); fetchHistory(); }}
                                            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${historySubTab === 'ProxmoxVEx' ? 'bg-proxmox-orange text-white' : 'text-gray-400 hover:text-white hover:bg-proxmox-dark'}`}
                                        >
                                            {t('ProxmoxVExActions')}
                                        </button>
                                        <button
                                            onClick={fetchHistory}
                                            className="ml-auto p-2 hover:bg-proxmox-dark rounded-lg text-gray-400 hover:text-white"
                                            title="Refresh"
                                        >
                                            <Icons.RefreshCw className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} />
                                        </button>
                                    </div>

                                    {historyLoading ? (
                                        <div className="flex items-center justify-center py-8">
                                            <Icons.RotateCw className="w-6 h-6 animate-spin text-proxmox-orange" />
                                        </div>
                                    ) : (
                                        <>
                                            {/* Proxmox Tasks */}
                                            {historySubTab === 'proxmox' && (
                                                <div className="space-y-2">
                                                    <h4 className={isCorporate ? 'corp-card-header' : 'text-sm font-medium text-gray-400 mb-2'}>Proxmox Tasks for {isQemu ? 'VM' : 'CT'} {vm.vmid}</h4>
                                                    {vmProxmoxTasks && vmProxmoxTasks.length > 0 ? (
                                                        <div className="overflow-x-auto max-h-96 overflow-y-auto">
                                                            <table className="w-full text-sm">
                                                                <thead className="sticky top-0 bg-proxmox-dark">
                                                                    <tr className="text-left text-gray-400">
                                                                        <th className="p-2">Time</th>
                                                                        <th className="p-2">Type</th>
                                                                        <th className="p-2">User</th>
                                                                        <th className="p-2">Status</th>
                                                                        <th className="p-2">Node</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {vmProxmoxTasks.map((task, idx) => (
                                                                        <tr key={idx} className="border-t border-proxmox-border hover:bg-proxmox-dark/50">
                                                                            <td className="p-2 text-gray-300 whitespace-nowrap">
                                                                                {task.starttime ? new Date(task.starttime * 1000).toLocaleString() : '-'}
                                                                            </td>
                                                                            <td className="p-2 font-mono text-xs">
                                                                                <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded">{task.type || '-'}</span>
                                                                            </td>
                                                                            <td className="p-2 text-gray-300">{task.user || '-'}</td>
                                                                            <td className="p-2">
                                                                                <span className={`px-2 py-0.5 rounded text-xs ${task.status === 'OK' ? 'bg-green-500/20 text-green-400' :
                                                                                    task.status && task.status.includes('ERROR') ? 'bg-red-500/20 text-red-400' :
                                                                                        task.exitstatus === 'OK' ? 'bg-green-500/20 text-green-400' :
                                                                                            !task.endtime ? 'bg-yellow-500/20 text-yellow-400' :
                                                                                                'bg-gray-500/20 text-gray-400'
                                                                                    }`}>
                                                                                    {task.status || task.exitstatus || (task.endtime ? 'completed' : 'running')}
                                                                                </span>
                                                                            </td>
                                                                            <td className="p-2 text-gray-400 font-mono text-xs">{task.node || vm.node}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    ) : (
                                                        <div className="text-center py-8 text-gray-500">
                                                            <Icons.List className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                                            <p>No Proxmox tasks found for this {isQemu ? 'VM' : 'Container'}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* ProxmoxVEx Actions */}
                                            {historySubTab === 'ProxmoxVEx' && (
                                                <div className="space-y-2">
                                                    <h4 className={isCorporate ? 'corp-card-header' : 'text-sm font-medium text-gray-400 mb-2'}>ProxmoxVEx Actions for {isQemu ? 'VM' : 'CT'} {vm.vmid}</h4>
                                                    {vmProxmoxVExActions && vmProxmoxVExActions.length > 0 ? (
                                                        <div className="overflow-x-auto max-h-96 overflow-y-auto">
                                                            <table className="w-full text-sm">
                                                                <thead className="sticky top-0 bg-proxmox-dark">
                                                                    <tr className="text-left text-gray-400">
                                                                        <th className="p-2">Time</th>
                                                                        <th className="p-2">Action</th>
                                                                        <th className="p-2">User</th>
                                                                        <th className="p-2">Details</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {vmProxmoxVExActions.map((action, idx) => (
                                                                        <tr key={idx} className="border-t border-proxmox-border hover:bg-proxmox-dark/50">
                                                                            <td className="p-2 text-gray-300 whitespace-nowrap">
                                                                                {action.timestamp ? new Date(action.timestamp).toLocaleString() : '-'}
                                                                            </td>
                                                                            <td className="p-2">
                                                                                <span className="px-2 py-0.5 bg-proxmox-orange/20 text-proxmox-orange rounded text-xs font-mono">
                                                                                    {action.action || '-'}
                                                                                </span>
                                                                            </td>
                                                                            <td className="p-2 text-gray-300 font-medium">{action.user || '-'}</td>
                                                                            <td className="p-2 text-gray-400 text-xs max-w-xs truncate" title={action.details || ''}>
                                                                                {action.details || '-'}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    ) : (
                                                        <div className="text-center py-8 text-gray-500">
                                                            <Icons.List className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                                            <p>No ProxmoxVEx actions found for this {isQemu ? 'VM' : 'Container'}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {activeTab === 'firewall' && (
                                <div className="space-y-6">
                                    {fwLoading ? (
                                        <div className="flex items-center justify-center py-12">
                                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-proxmox-orange"></div>
                                        </div>
                                    ) : (
                                        <>
                                            {/* Sub-tabs for firewall sections */}
                                            <div className="flex gap-1 border-b border-proxmox-border pb-2">
                                                {['rules', 'options', 'aliases', 'ipsets', 'log'].map(st => (
                                                    <button
                                                        key={st}
                                                        onClick={() => { setFwSubTab(st); if (st === 'log') fetchFwLog(); }}
                                                        className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${fwSubTab === st
                                                            ? 'bg-proxmox-orange text-white'
                                                            : 'text-gray-400 hover:text-white hover:bg-proxmox-dark'
                                                            }`}
                                                    >
                                                        {st === 'rules' ? t('firewallRules2') :
                                                            st === 'options' ? t('firewallOptions2') :
                                                                st === 'aliases' ? t('aliases') :
                                                                    st === 'ipsets' ? 'IP Sets' :
                                                                        t('log')}
                                                    </button>
                                                ))}
                                            </div>

                                            {/* Rules Sub-Tab */}
                                            {fwSubTab === 'rules' && (
                                                <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-card border border-proxmox-border rounded-xl overflow-hidden'}>
                                                    <div className="p-4 border-b border-proxmox-border flex justify-between items-center">
                                                        <h3 className="font-semibold">{t('firewallRules')}</h3>
                                                        <button
                                                            onClick={() => setShowAddFwRule(true)}
                                                            className="flex items-center gap-2 px-3 py-1.5 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm text-white transition-colors"
                                                        >
                                                            <Icons.Plus /> {t('add')}
                                                        </button>
                                                    </div>
                                                    <div className="overflow-x-auto">
                                                        <table className="w-full">
                                                            <thead className="bg-proxmox-dark">
                                                                <tr>
                                                                    <th className="text-left p-3 text-sm text-gray-400">#</th>
                                                                    <th className="text-left p-3 text-sm text-gray-400">{t('type')}</th>
                                                                    <th className="text-left p-3 text-sm text-gray-400">{t('action')}</th>
                                                                    <th className="text-left p-3 text-sm text-gray-400">Macro</th>
                                                                    <th className="text-left p-3 text-sm text-gray-400">{t('source')}</th>
                                                                    <th className="text-left p-3 text-sm text-gray-400">Dest</th>
                                                                    <th className="text-left p-3 text-sm text-gray-400">Proto</th>
                                                                    <th className="text-left p-3 text-sm text-gray-400">Port</th>
                                                                    <th className="text-left p-3 text-sm text-gray-400">{t('enabled')}</th>
                                                                    <th className="text-left p-3 text-sm text-gray-400">{t('comment')}</th>
                                                                    <th className="text-left p-3 text-sm text-gray-400"></th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(!fwRules || fwRules.length === 0) ? (
                                                                    <tr><td colSpan="11" className="p-8 text-center text-gray-500">{t('noFirewallRules2')}</td></tr>
                                                                ) : (Array.isArray(fwRules) ? fwRules : []).map((rule, idx) => (
                                                                    <tr key={idx} className="border-t border-proxmox-border hover:bg-proxmox-dark/50">
                                                                        <td className="p-3 text-gray-400">{rule.pos}</td>
                                                                        <td className="p-3">
                                                                            <span className={`px-2 py-0.5 rounded text-xs ${rule.type === 'in' ? 'bg-blue-500/20 text-blue-400' :
                                                                                rule.type === 'out' ? 'bg-purple-500/20 text-purple-400' :
                                                                                    'bg-yellow-500/20 text-yellow-400'
                                                                                }`}>
                                                                                {(rule.type || 'in').toUpperCase()}
                                                                            </span>
                                                                        </td>
                                                                        <td className="p-3">
                                                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${rule.action === 'ACCEPT' ? 'bg-green-500/20 text-green-400' :
                                                                                rule.action === 'DROP' ? 'bg-red-500/20 text-red-400' :
                                                                                    'bg-yellow-500/20 text-yellow-400'
                                                                                }`}>
                                                                                {rule.action}
                                                                            </span>
                                                                        </td>
                                                                        <td className="p-3 text-gray-300">{rule.macro || '-'}</td>
                                                                        <td className="p-3 font-mono text-xs text-gray-300">{rule.source || '-'}</td>
                                                                        <td className="p-3 font-mono text-xs text-gray-300">{rule.dest || '-'}</td>
                                                                        <td className="p-3 text-gray-300">{rule.proto || '-'}</td>
                                                                        <td className="p-3 font-mono text-xs text-gray-300">{rule.dport || '-'}</td>
                                                                        <td className="p-3">
                                                                            <button
                                                                                onClick={async () => {
                                                                                    try {
                                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/rules/${rule.pos}`, {
                                                                                            method: 'PUT',
                                                                                            headers: { 'Content-Type': 'application/json' },
                                                                                            body: JSON.stringify({ enable: rule.enable ? 0 : 1 })
                                                                                        });
                                                                                        if (res?.ok) {
                                                                                            setFwRules(prev => prev.map(r =>
                                                                                                r.pos === rule.pos ? { ...r, enable: rule.enable ? 0 : 1 } : r
                                                                                            ));
                                                                                        } else {
                                                                                            const err = await res.json().catch(() => ({}));
                                                                                            addToast(err.error || `Failed to toggle rule (HTTP ${res?.status || '?'})`, 'error');
                                                                                        }
                                                                                    } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                                                                }}
                                                                                className={`w-8 h-5 rounded-full transition-colors ${rule.enable ? 'bg-green-500' : 'bg-gray-600'}`}
                                                                            >
                                                                                <div className={`w-4 h-4 rounded-full bg-white transition-transform ${rule.enable ? 'translate-x-3.5' : 'translate-x-0.5'}`}></div>
                                                                            </button>
                                                                        </td>
                                                                        <td className="p-3 text-gray-500 text-xs max-w-32 truncate">{rule.comment || ''}</td>
                                                                        <td className="p-3">
                                                                            <button
                                                                                onClick={async () => {
                                                                                    if (!confirm(t('confirmDeleteRule'))) return;
                                                                                    try {
                                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/rules/${rule.pos}`, { method: 'DELETE' });
                                                                                        if (res?.ok) {
                                                                                            fetchFirewallData();
                                                                                        } else {
                                                                                            const err = await res.json().catch(() => ({}));
                                                                                            addToast(err.error || `Operation failed (HTTP ${res?.status || '?'})`, 'error');
                                                                                        }
                                                                                    } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                                                                }}
                                                                                className="p-1.5 hover:bg-red-500/20 rounded text-red-400 transition-colors"
                                                                            >
                                                                                <Icons.Trash />
                                                                            </button>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Options Sub-Tab */}
                                            {fwSubTab === 'options' && (
                                                <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-card border border-proxmox-border rounded-xl p-6'}>
                                                    <h3 className={isCorporate ? 'corp-card-header' : 'font-semibold flex items-center gap-2 mb-4'}>
                                                        <Icons.Shield />
                                                        {t('firewallOptions')}
                                                    </h3>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                        <div className="bg-proxmox-dark rounded-lg p-4">
                                                            <div className="text-sm text-gray-400 mb-2">{t('fwEnable')}</div>
                                                            <button
                                                                onClick={async () => {
                                                                    const newVal = fwOptions.enable ? 0 : 1;
                                                                    try {
                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/options`, {
                                                                            method: 'PUT',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ enable: newVal })
                                                                        });
                                                                        if (res?.ok) {
                                                                            setFwOptions(prev => ({ ...prev, enable: newVal }));
                                                                        } else {
                                                                            const err = await res.json().catch(() => ({}));
                                                                            addToast(err.error || `Failed to update firewall option (HTTP ${res?.status || '?'})`, 'error');
                                                                        }
                                                                    } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                                                }}
                                                                className={`px-4 py-2 rounded-lg font-medium transition-colors ${fwOptions.enable
                                                                    ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                                                    : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                                                    }`}
                                                            >
                                                                {fwOptions.enable ? t('enabled') : t('disabled3')}
                                                            </button>
                                                        </div>
                                                        <div className="bg-proxmox-dark rounded-lg p-4">
                                                            <div className="text-sm text-gray-400 mb-1">Policy In</div>
                                                            <select
                                                                value={fwOptions.policy_in || 'DROP'}
                                                                onChange={async (e) => {
                                                                    try {
                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/options`, {
                                                                            method: 'PUT',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ policy_in: e.target.value })
                                                                        });
                                                                        if (res?.ok) {
                                                                            setFwOptions(prev => ({ ...prev, policy_in: e.target.value }));
                                                                        } else {
                                                                            const err = await res.json().catch(() => ({}));
                                                                            addToast(err.error || `Failed to update firewall option (HTTP ${res?.status || '?'})`, 'error');
                                                                        }
                                                                    } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                                                }} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-darker border border-proxmox-border rounded-lg p-2 text-white'}
                                                            >
                                                                <option value="ACCEPT">ACCEPT</option>
                                                                <option value="DROP">DROP</option>
                                                                <option value="REJECT">REJECT</option>
                                                            </select>
                                                        </div>
                                                        <div className="bg-proxmox-dark rounded-lg p-4">
                                                            <div className="text-sm text-gray-400 mb-1">Policy Out</div>
                                                            <select
                                                                value={fwOptions.policy_out || 'ACCEPT'}
                                                                onChange={async (e) => {
                                                                    try {
                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/options`, {
                                                                            method: 'PUT',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ policy_out: e.target.value })
                                                                        });
                                                                        if (res?.ok) {
                                                                            setFwOptions(prev => ({ ...prev, policy_out: e.target.value }));
                                                                        } else {
                                                                            const err = await res.json().catch(() => ({}));
                                                                            addToast(err.error || `Failed to update firewall option (HTTP ${res?.status || '?'})`, 'error');
                                                                        }
                                                                    } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                                                }} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-darker border border-proxmox-border rounded-lg p-2 text-white'}
                                                            >
                                                                <option value="ACCEPT">ACCEPT</option>
                                                                <option value="DROP">DROP</option>
                                                                <option value="REJECT">REJECT</option>
                                                            </select>
                                                        </div>
                                                        <div className="bg-proxmox-dark rounded-lg p-4">
                                                            <div className="text-sm text-gray-400 mb-1">{t('fwDhcp')}</div>
                                                            <button
                                                                onClick={async () => {
                                                                    const newVal = fwOptions.dhcp ? 0 : 1;
                                                                    try {
                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/options`, {
                                                                            method: 'PUT',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ dhcp: newVal })
                                                                        });
                                                                        if (res?.ok) {
                                                                            setFwOptions(prev => ({ ...prev, dhcp: newVal }));
                                                                        } else {
                                                                            const err = await res.json().catch(() => ({}));
                                                                            addToast(err.error || `Failed to update firewall option (HTTP ${res?.status || '?'})`, 'error');
                                                                        }
                                                                    } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                                                }}
                                                                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${fwOptions.dhcp ? 'bg-green-500/20 text-green-400' : 'bg-gray-600/30 text-gray-400'
                                                                    }`}
                                                            >
                                                                {fwOptions.dhcp ? 'On' : 'Off'}
                                                            </button>
                                                        </div>
                                                        <div className="bg-proxmox-dark rounded-lg p-4">
                                                            <div className="text-sm text-gray-400 mb-1">{t('fwNdp')}</div>
                                                            <button
                                                                onClick={async () => {
                                                                    const newVal = fwOptions.ndp ? 0 : 1;
                                                                    try {
                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/options`, {
                                                                            method: 'PUT',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ ndp: newVal })
                                                                        });
                                                                        if (res?.ok) {
                                                                            setFwOptions(prev => ({ ...prev, ndp: newVal }));
                                                                        } else {
                                                                            const err = await res.json().catch(() => ({}));
                                                                            addToast(err.error || `Failed to update firewall option (HTTP ${res?.status || '?'})`, 'error');
                                                                        }
                                                                    } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                                                }}
                                                                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${fwOptions.ndp ? 'bg-green-500/20 text-green-400' : 'bg-gray-600/30 text-gray-400'
                                                                    }`}
                                                            >
                                                                {fwOptions.ndp ? 'On' : 'Off'}
                                                            </button>
                                                        </div>
                                                        <div className="bg-proxmox-dark rounded-lg p-4">
                                                            <div className="text-sm text-gray-400 mb-1">{t('fwRadv')}</div>
                                                            <button
                                                                onClick={async () => {
                                                                    const newVal = fwOptions.radv ? 0 : 1;
                                                                    try {
                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/options`, {
                                                                            method: 'PUT',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ radv: newVal })
                                                                        });
                                                                        if (res?.ok) {
                                                                            setFwOptions(prev => ({ ...prev, radv: newVal }));
                                                                        } else {
                                                                            const err = await res.json().catch(() => ({}));
                                                                            addToast(err.error || `Failed to update firewall option (HTTP ${res?.status || '?'})`, 'error');
                                                                        }
                                                                    } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                                                }}
                                                                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${fwOptions.radv ? 'bg-green-500/20 text-green-400' : 'bg-gray-600/30 text-gray-400'
                                                                    }`}
                                                            >
                                                                {fwOptions.radv ? 'On' : 'Off'}
                                                            </button>
                                                        </div>
                                                        <div className="bg-proxmox-dark rounded-lg p-4">
                                                            <div className="text-sm text-gray-400 mb-1">{t('fwMacFilter')}</div>
                                                            <button
                                                                onClick={async () => {
                                                                    const newVal = fwOptions.macfilter ? 0 : 1;
                                                                    try {
                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/options`, {
                                                                            method: 'PUT',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ macfilter: newVal })
                                                                        });
                                                                        if (res?.ok) {
                                                                            setFwOptions(prev => ({ ...prev, macfilter: newVal }));
                                                                        } else {
                                                                            const err = await res.json().catch(() => ({}));
                                                                            addToast(err.error || `Failed to update firewall option (HTTP ${res?.status || '?'})`, 'error');
                                                                        }
                                                                    } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                                                }}
                                                                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${fwOptions.macfilter ? 'bg-green-500/20 text-green-400' : 'bg-gray-600/30 text-gray-400'
                                                                    }`}
                                                            >
                                                                {fwOptions.macfilter ? 'On' : 'Off'}
                                                            </button>
                                                        </div>
                                                        <div className="bg-proxmox-dark rounded-lg p-4">
                                                            <div className="text-sm text-gray-400 mb-1">{t('fwLogLevel')}</div>
                                                            <select
                                                                value={fwOptions.log_level_in || 'nolog'}
                                                                onChange={async (e) => {
                                                                    try {
                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/options`, {
                                                                            method: 'PUT',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ log_level_in: e.target.value })
                                                                        });
                                                                        if (res?.ok) {
                                                                            setFwOptions(prev => ({ ...prev, log_level_in: e.target.value }));
                                                                        } else {
                                                                            const err = await res.json().catch(() => ({}));
                                                                            addToast(err.error || `Failed to update firewall option (HTTP ${res?.status || '?'})`, 'error');
                                                                        }
                                                                    } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                                                }} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-darker border border-proxmox-border rounded-lg p-2 text-white'}
                                                            >
                                                                <option value="nolog">No Log</option>
                                                                <option value="emerg">Emergency</option>
                                                                <option value="alert">Alert</option>
                                                                <option value="crit">Critical</option>
                                                                <option value="err">Error</option>
                                                                <option value="warning">Warning</option>
                                                                <option value="notice">Notice</option>
                                                                <option value="info">Info</option>
                                                                <option value="debug">Debug</option>
                                                            </select>
                                                        </div>
                                                        <div className="bg-proxmox-dark rounded-lg p-4">
                                                            <div className="text-sm text-gray-400 mb-1">{t('fwLogLevelOut')}</div>
                                                            <select
                                                                value={fwOptions.log_level_out || 'nolog'}
                                                                onChange={async (e) => {
                                                                    try {
                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/options`, {
                                                                            method: 'PUT',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ log_level_out: e.target.value })
                                                                        });
                                                                        if (res?.ok) {
                                                                            setFwOptions(prev => ({ ...prev, log_level_out: e.target.value }));
                                                                        } else {
                                                                            const err = await res.json().catch(() => ({}));
                                                                            addToast(err.error || `Failed to update firewall option (HTTP ${res?.status || '?'})`, 'error');
                                                                        }
                                                                    } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                                                }} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-darker border border-proxmox-border rounded-lg p-2 text-white'}
                                                            >
                                                                <option value="nolog">No Log</option>
                                                                <option value="emerg">Emergency</option>
                                                                <option value="alert">Alert</option>
                                                                <option value="crit">Critical</option>
                                                                <option value="err">Error</option>
                                                                <option value="warning">Warning</option>
                                                                <option value="notice">Notice</option>
                                                                <option value="info">Info</option>
                                                                <option value="debug">Debug</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Aliases Sub-Tab */}
                                            {fwSubTab === 'aliases' && (
                                                <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-card border border-proxmox-border rounded-xl overflow-hidden'}>
                                                    <div className="p-4 border-b border-proxmox-border flex justify-between items-center">
                                                        <h3 className="font-semibold">{t('aliases')}</h3>
                                                        <button
                                                            onClick={() => setShowAddFwAlias(true)}
                                                            className="flex items-center gap-2 px-3 py-1.5 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm text-white transition-colors"
                                                        >
                                                            <Icons.Plus /> {t('add')}
                                                        </button>
                                                    </div>
                                                    <div className="overflow-x-auto">
                                                        <table className="w-full">
                                                            <thead className="bg-proxmox-dark">
                                                                <tr>
                                                                    <th className="text-left p-3 text-sm text-gray-400">{t('name')}</th>
                                                                    <th className="text-left p-3 text-sm text-gray-400">CIDR</th>
                                                                    <th className="text-left p-3 text-sm text-gray-400">{t('comment')}</th>
                                                                    <th className="text-left p-3 text-sm text-gray-400"></th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(!fwAliases || fwAliases.length === 0) ? (
                                                                    <tr><td colSpan="4" className="p-8 text-center text-gray-500">{t('noAliases')}</td></tr>
                                                                ) : fwAliases.map((alias, idx) => (
                                                                    <tr key={idx} className="border-t border-proxmox-border hover:bg-proxmox-dark/50">
                                                                        <td className="p-3 font-medium">{alias.name}</td>
                                                                        <td className="p-3 font-mono text-sm text-gray-300">{alias.cidr}</td>
                                                                        <td className="p-3 text-gray-500 text-sm">{alias.comment || ''}</td>
                                                                        <td className="p-3">
                                                                            <button
                                                                                onClick={async () => {
                                                                                    if (!confirm(`Delete alias "${alias.name}"?`)) return;
                                                                                    try {
                                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/aliases/${alias.name}`, { method: 'DELETE' });
                                                                                        if (res?.ok) {
                                                                                            fetchFirewallData();
                                                                                        } else {
                                                                                            const err = await res.json().catch(() => ({}));
                                                                                            addToast(err.error || `Operation failed (HTTP ${res?.status || '?'})`, 'error');
                                                                                        }
                                                                                    } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                                                                }}
                                                                                className="p-1.5 hover:bg-red-500/20 rounded text-red-400 transition-colors"
                                                                            >
                                                                                <Icons.Trash />
                                                                            </button>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            )}

                                            {/* IP Sets Sub-Tab */}
                                            {fwSubTab === 'ipsets' && (
                                                <div className="space-y-4">
                                                    <div className="flex justify-between items-center">
                                                        <h3 className="font-semibold">IP Sets</h3>
                                                        <button
                                                            onClick={() => setShowAddFwIpset(true)}
                                                            className="flex items-center gap-2 px-3 py-1.5 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-sm text-white transition-colors"
                                                        >
                                                            <Icons.Plus /> {t('add')}
                                                        </button>
                                                    </div>
                                                    {(!fwIpsets || fwIpsets.length === 0) ? (
                                                        <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-card border border-proxmox-border rounded-xl p-8 text-center text-gray-500'}>
                                                            {t('noIpsets')}
                                                        </div>
                                                    ) : fwIpsets.map((ipset, idx) => (
                                                        <div key={idx} className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-card border border-proxmox-border rounded-xl overflow-hidden'}>
                                                            <div
                                                                className="p-4 flex justify-between items-center cursor-pointer hover:bg-proxmox-dark/50"
                                                                onClick={() => setExpandedIpset(expandedIpset === ipset.name ? null : ipset.name)}
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    <Icons.ChevronRight className={`w-4 h-4 transition-transform ${expandedIpset === ipset.name ? 'rotate-90' : ''}`} />
                                                                    <span className="font-medium">{ipset.name}</span>
                                                                    {ipset.comment && <span className="text-gray-500 text-sm">- {ipset.comment}</span>}
                                                                </div>
                                                                <button
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        if (!confirm(`Delete IP set "${ipset.name}"?`)) return;
                                                                        try {
                                                                            const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/ipset/${ipset.name}`, { method: 'DELETE' });
                                                                            if (res?.ok) {
                                                                                fetchFirewallData();
                                                                            } else {
                                                                                const err = await res.json().catch(() => ({}));
                                                                                addToast(err.error || `Operation failed (HTTP ${res?.status || '?'})`, 'error');
                                                                            }
                                                                        } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                                                    }}
                                                                    className="p-1.5 hover:bg-red-500/20 rounded text-red-400 transition-colors"
                                                                >
                                                                    <Icons.Trash />
                                                                </button>
                                                            </div>
                                                            {expandedIpset === ipset.name && (
                                                                <div className="border-t border-proxmox-border">
                                                                    <IpsetEntries
                                                                        clusterId={clusterId}
                                                                        vm={vm}
                                                                        ipsetName={ipset.name}
                                                                        authFetch={authFetch}
                                                                        onRefresh={fetchFirewallData}
                                                                        t={t}
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Log Sub-Tab */}
                                            {fwSubTab === 'log' && (
                                                <div className={isCorporate ? 'corp-settings-card' : 'bg-proxmox-card border border-proxmox-border rounded-xl overflow-hidden'}>
                                                    <div className="p-4 border-b border-proxmox-border flex justify-between items-center">
                                                        <h3 className="font-semibold">{t('firewallLog')}</h3>
                                                        <button
                                                            onClick={fetchFwLog}
                                                            className="flex items-center gap-2 px-3 py-1.5 bg-proxmox-dark hover:bg-proxmox-hover rounded-lg text-sm transition-colors"
                                                        >
                                                            <Icons.RefreshCw className="w-4 h-4" /> {t('refresh')}
                                                        </button>
                                                    </div>
                                                    <div className="p-4 max-h-96 overflow-y-auto">
                                                        {(!fwLog || fwLog.length === 0) ? (
                                                            <div className="text-center text-gray-500 py-8">{t('noLogEntries')}</div>
                                                        ) : (
                                                            <div className="space-y-1 font-mono text-xs">
                                                                {(Array.isArray(fwLog) ? fwLog : []).map((entry, idx) => (
                                                                    <div key={idx} className="p-2 bg-proxmox-dark rounded text-gray-300 whitespace-pre-wrap break-all">
                                                                        {typeof entry === 'string' ? entry : (entry.t || entry.n || JSON.stringify(entry))}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Add Rule Modal */}
                                            {showAddFwRule && (
                                                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 modal-backdrop" onClick={() => setShowAddFwRule(false)}>
                                                    <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-lg bg-proxmox-card border border-proxmox-border rounded-2xl shadow-2xl overflow-hidden'} onClick={e => e.stopPropagation()}>
                                                        <div className="p-4 border-b border-proxmox-border">
                                                            <h3 className="font-semibold">{t('addFirewallRule')}</h3>
                                                        </div>
                                                        <div className="p-4 space-y-4">
                                                            <div className="grid grid-cols-2 gap-4">
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : 'text-sm text-gray-400 mb-1 block'}>Direction</label>
                                                                    <select
                                                                        value={newFwRule.type || 'in'}
                                                                        onChange={e => setNewFwRule(p => ({ ...p, type: e.target.value }))} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded-lg p-2'}
                                                                    >
                                                                        <option value="in">IN</option>
                                                                        <option value="out">OUT</option>
                                                                        <option value="group">GROUP</option>
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : 'text-sm text-gray-400 mb-1 block'}>Action</label>
                                                                    <select
                                                                        value={newFwRule.action || 'ACCEPT'}
                                                                        onChange={e => setNewFwRule(p => ({ ...p, action: e.target.value }))} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded-lg p-2'}
                                                                    >
                                                                        <option value="ACCEPT">ACCEPT</option>
                                                                        <option value="DROP">DROP</option>
                                                                        <option value="REJECT">REJECT</option>
                                                                    </select>
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-4">
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : 'text-sm text-gray-400 mb-1 block'}>Macro</label>
                                                                    <select
                                                                        value={newFwRule.macro || ''}
                                                                        onChange={e => setNewFwRule(p => ({ ...p, macro: e.target.value || undefined }))} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded-lg p-2'}
                                                                    >
                                                                        <option value="">None</option>
                                                                        {(() => {
                                                                            const dynamicMacros = (Array.isArray(fwRefs) ? fwRefs : []).filter(r => r.type === 'macro').map(r => r.name);
                                                                            const allMacros = dynamicMacros.length > 0 ? dynamicMacros : [
                                                                                'Amanda', 'Auth', 'BGP', 'BitTorrent', 'Ceph', 'CephMon', 'CephOSD', 'CephMGR', 'CephMDS',
                                                                                'DHCPfwd', 'DHCPv6', 'DNS', 'Dropbox', 'FTP', 'GNUnet', 'GRE', 'HKP',
                                                                                'HTTP', 'HTTPS', 'ICMP', 'ICMPv6', 'IMAP', 'IMAPS', 'IPsec-ah', 'IPsec-esp',
                                                                                'IRC', 'Jabber', 'JetDirect', 'L2TP', 'LDAP', 'LDAPS', 'MDNS', 'MSSQL',
                                                                                'MySQL', 'NFS', 'NTP', 'OSPF', 'OpenVPN', 'PCA', 'PMG', 'POP3', 'POP3S',
                                                                                'PPtP', 'Ping', 'PostgreSQL', 'Printer', 'RDP', 'RIP', 'RNDC',
                                                                                'Razor', 'Rsh', 'SANE', 'SMB', 'SMBv2', 'SMTP', 'SMTPS', 'SNMP', 'SPAMD',
                                                                                'SSH', 'SVN', 'SixXS', 'Squid', 'Submission', 'Syslog', 'TFTP', 'Telnet',
                                                                                'Tinc', 'Traceroute', 'VNC', 'VXLAN', 'Webmin', 'NFS', 'Razor'
                                                                            ];
                                                                            return allMacros.sort().map(name => (
                                                                                <option key={name} value={name}>{name}</option>
                                                                            ));
                                                                        })()}
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : 'text-sm text-gray-400 mb-1 block'}>Interface</label>
                                                                    <select
                                                                        value={newFwRule.iface || ''}
                                                                        onChange={e => setNewFwRule(p => ({ ...p, iface: e.target.value }))} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded-lg p-2'}
                                                                    >
                                                                        <option value="">Any</option>
                                                                        {(config?.networks || []).map(n => (
                                                                            <option key={n.id} value={n.id}>{n.id}{n.bridge ? ` (${n.bridge})` : ''}</option>
                                                                        ))}
                                                                        {(!config?.networks || config.networks.length === 0) && (
                                                                            <>
                                                                                <option value="net0">net0</option>
                                                                                <option value="net1">net1</option>
                                                                            </>
                                                                        )}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-4">
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : 'text-sm text-gray-400 mb-1 block'}>Protocol</label>
                                                                    <select
                                                                        value={newFwRule.proto || ''}
                                                                        onChange={e => setNewFwRule(p => ({ ...p, proto: e.target.value }))} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded-lg p-2'}
                                                                    >
                                                                        <option value="">Any</option>
                                                                        <option value="tcp">TCP</option>
                                                                        <option value="udp">UDP</option>
                                                                        <option value="icmp">ICMP</option>
                                                                        <option value="sctp">SCTP</option>
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : 'text-sm text-gray-400 mb-1 block'}>Dest. Port</label>
                                                                    <input
                                                                        type="text"
                                                                        value={newFwRule.dport || ''}
                                                                        onChange={e => setNewFwRule(p => ({ ...p, dport: e.target.value }))}
                                                                        placeholder="e.g. 22, 80, 443" className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded-lg p-2'}
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-4">
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : 'text-sm text-gray-400 mb-1 block'}>Source</label>
                                                                    <input
                                                                        type="text"
                                                                        value={newFwRule.source || ''}
                                                                        onChange={e => setNewFwRule(p => ({ ...p, source: e.target.value }))}
                                                                        placeholder="10.0.0.0/24 or 10.0.0.1" className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded-lg p-2'}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : 'text-sm text-gray-400 mb-1 block'}>Destination</label>
                                                                    <input
                                                                        type="text"
                                                                        value={newFwRule.dest || ''}
                                                                        onChange={e => setNewFwRule(p => ({ ...p, dest: e.target.value }))}
                                                                        placeholder="192.168.1.0/24 or 192.168.1.1" className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded-lg p-2'}
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : 'text-sm text-gray-400 mb-1 block'}>Comment</label>
                                                                <input
                                                                    type="text"
                                                                    value={newFwRule.comment || ''}
                                                                    onChange={e => setNewFwRule(p => ({ ...p, comment: e.target.value }))}
                                                                    placeholder="Optional description" className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded-lg p-2'}
                                                                />
                                                            </div>
                                                            <label className="flex items-center gap-2">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={newFwRule.enable !== 0}
                                                                    onChange={e => setNewFwRule(p => ({ ...p, enable: e.target.checked ? 1 : 0 }))}
                                                                    className="w-4 h-4 rounded"
                                                                />
                                                                <span>Enable rule</span>
                                                            </label>
                                                        </div>
                                                        <div className="p-4 border-t border-proxmox-border flex gap-3 justify-end">
                                                            <button
                                                                onClick={() => setShowAddFwRule(false)}
                                                                className="px-4 py-2 bg-proxmox-dark rounded-lg hover:bg-proxmox-hover transition-colors"
                                                            >
                                                                {t('cancel')}
                                                            </button>
                                                            <button
                                                                onClick={async () => {
                                                                    try {
                                                                        const ruleData = { ...newFwRule };
                                                                        Object.keys(ruleData).forEach(k => { if (!ruleData[k] && ruleData[k] !== 0) delete ruleData[k]; });
                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/rules`, {
                                                                            method: 'POST',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify(ruleData)
                                                                        });
                                                                        if (res?.ok) {
                                                                            fetchFirewallData();
                                                                            setShowAddFwRule(false);
                                                                            setNewFwRule({ type: 'in', action: 'ACCEPT', enable: 1 });
                                                                            if (addToast) addToast(t('firewallRuleCreated'), 'success');
                                                                        } else {
                                                                            const err = await res?.json().catch(() => ({}));
                                                                            let errMsg = 'Failed to create rule';
                                                                            if (err?.error && typeof err.error === 'object') {
                                                                                errMsg = Object.entries(err.error).map(([k, v]) => `${k}: ${String(v).trim()}`).join('; ');
                                                                            } else if (err?.error) {
                                                                                errMsg = String(err.error);
                                                                            } else if (err?.message) {
                                                                                errMsg = String(err.message);
                                                                            }
                                                                            if (addToast) addToast(errMsg, 'error');
                                                                        }
                                                                    } catch (e) { if (addToast) addToast('Connection error', 'error'); }
                                                                }}
                                                                className="px-4 py-2 bg-proxmox-orange rounded-lg text-white hover:bg-orange-600 transition-colors"
                                                            >
                                                                {t('add')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Add Alias Modal */}
                                            {showAddFwAlias && (
                                                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 modal-backdrop" onClick={() => setShowAddFwAlias(false)}>
                                                    <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-md bg-proxmox-card border border-proxmox-border rounded-2xl shadow-2xl overflow-hidden'} onClick={e => e.stopPropagation()}>
                                                        <div className="p-4 border-b border-proxmox-border">
                                                            <h3 className="font-semibold">{t('fwAddAlias')}</h3>
                                                        </div>
                                                        <div className="p-4 space-y-4">
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : 'text-sm text-gray-400 mb-1 block'}>{t('name')}</label>
                                                                <input
                                                                    type="text"
                                                                    value={newFwAlias.name}
                                                                    onChange={e => setNewFwAlias(p => ({ ...p, name: e.target.value }))}
                                                                    placeholder="e.g. myserver" className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded-lg p-2'}
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : 'text-sm text-gray-400 mb-1 block'}>CIDR</label>
                                                                <input
                                                                    type="text"
                                                                    value={newFwAlias.cidr}
                                                                    onChange={e => setNewFwAlias(p => ({ ...p, cidr: e.target.value }))}
                                                                    placeholder="e.g. 10.0.0.1/32" className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded-lg p-2'}
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : 'text-sm text-gray-400 mb-1 block'}>{t('comment')}</label>
                                                                <input
                                                                    type="text"
                                                                    value={newFwAlias.comment}
                                                                    onChange={e => setNewFwAlias(p => ({ ...p, comment: e.target.value }))} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded-lg p-2'}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="p-4 border-t border-proxmox-border flex gap-3 justify-end">
                                                            <button onClick={() => setShowAddFwAlias(false)} className="px-4 py-2 bg-proxmox-dark rounded-lg hover:bg-proxmox-hover transition-colors">{t('cancel')}</button>
                                                            <button
                                                                onClick={async () => {
                                                                    if (!newFwAlias.name || !newFwAlias.cidr) return;
                                                                    try {
                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/aliases`, {
                                                                            method: 'POST',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify(newFwAlias)
                                                                        });
                                                                        if (res?.ok) {
                                                                            fetchFirewallData();
                                                                            setShowAddFwAlias(false);
                                                                            setNewFwAlias({ name: '', cidr: '', comment: '' });
                                                                        } else {
                                                                            const err = await res.json().catch(() => ({}));
                                                                            addToast(err.error || `Failed to add alias (HTTP ${res?.status || '?'})`, 'error');
                                                                        }
                                                                    } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                                                }}
                                                                className="px-4 py-2 bg-proxmox-orange rounded-lg text-white hover:bg-orange-600 transition-colors"
                                                            >
                                                                {t('add')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Add IP Set Modal */}
                                            {showAddFwIpset && (
                                                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 modal-backdrop" onClick={() => setShowAddFwIpset(false)}>
                                                    <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-md bg-proxmox-card border border-proxmox-border rounded-2xl shadow-2xl overflow-hidden'} onClick={e => e.stopPropagation()}>
                                                        <div className="p-4 border-b border-proxmox-border">
                                                            <h3 className="font-semibold">{t('fwAddIpset')}</h3>
                                                        </div>
                                                        <div className="p-4 space-y-4">
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : 'text-sm text-gray-400 mb-1 block'}>{t('name')}</label>
                                                                <input
                                                                    type="text"
                                                                    value={newFwIpset.name}
                                                                    onChange={e => setNewFwIpset(p => ({ ...p, name: e.target.value }))}
                                                                    placeholder="e.g. allowed-hosts" className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded-lg p-2'}
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : 'text-sm text-gray-400 mb-1 block'}>{t('comment')}</label>
                                                                <input
                                                                    type="text"
                                                                    value={newFwIpset.comment}
                                                                    onChange={e => setNewFwIpset(p => ({ ...p, comment: e.target.value }))} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded-lg p-2'}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="p-4 border-t border-proxmox-border flex gap-3 justify-end">
                                                            <button onClick={() => setShowAddFwIpset(false)} className="px-4 py-2 bg-proxmox-dark rounded-lg hover:bg-proxmox-hover transition-colors">{t('cancel')}</button>
                                                            <button
                                                                onClick={async () => {
                                                                    if (!newFwIpset.name) return;
                                                                    try {
                                                                        const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/firewall/ipset`, {
                                                                            method: 'POST',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify(newFwIpset)
                                                                        });
                                                                        if (res?.ok) {
                                                                            fetchFirewallData();
                                                                            setShowAddFwIpset(false);
                                                                            setNewFwIpset({ name: '', comment: '' });
                                                                        } else {
                                                                            const err = await res.json().catch(() => ({}));
                                                                            addToast(err.error || `Failed to add IP set (HTTP ${res?.status || '?'})`, 'error');
                                                                        }
                                                                    } catch (e) { addToast(`Network error: ${e.message || e}`, 'error'); }
                                                                }}
                                                                className="px-4 py-2 bg-proxmox-orange rounded-lg text-white hover:bg-orange-600 transition-colors"
                                                            >
                                                                {t('add')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Options Tab */}
                            {activeTab === 'options' && (
                                <div className="space-y-6">
                                    <div className="space-y-4">
                                        {/* General Options Card */}
                                        <div className="p-4 bg-proxmox-dark rounded-lg border border-proxmox-border space-y-3">
                                            <ConfigCheckboxField
                                                label={t('startOnBoot')}
                                                checked={getValue('options', 'onboot') == 1}
                                                onChange={(v) => handleChange('options', 'onboot', v)}
                                                t={t}
                                            />
                                            <ConfigCheckboxField
                                                label={t('protection')}
                                                checked={getValue('options', 'protection') == 1}
                                                onChange={(v) => handleChange('options', 'protection', v)}
                                                t={t}
                                            />
                                        </div>
                                        {isQemu && (
                                            <>
                                                {/* QEMU Guest Agent Section */}
                                                <div className="p-4 bg-proxmox-dark rounded-lg border border-proxmox-border">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <label className="flex items-center gap-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={getValue('options', 'agent')?.toString().includes('1')}
                                                                onChange={(e) => {
                                                                    const current = getValue('options', 'agent') || '';
                                                                    if (e.target.checked) {
                                                                        handleChange('options', 'agent', '1');
                                                                    } else {
                                                                        handleChange('options', 'agent', '0');
                                                                    }
                                                                }}
                                                                className="w-4 h-4 rounded"
                                                            />
                                                            <span className="text-sm font-medium text-gray-300">{t('qemuGuestAgent')}</span>
                                                            <span className="text-[10px] px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded font-medium">{t('needsRestart')}</span>
                                                        </label>
                                                    </div>
                                                    <p className="text-xs text-gray-500 mb-3">{t('qemuGuestAgentHint')}</p>

                                                    {getValue('options', 'agent')?.toString().includes('1') && (
                                                        <div className="mt-3 pt-3 border-t border-proxmox-border space-y-2">
                                                            <label className={isCorporate ? 'corp-label' : 'flex items-center gap-2 text-sm text-gray-400'}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={getValue('options', 'agent')?.toString().includes('fstrim_cloned_disks=1')}
                                                                    onChange={(e) => {
                                                                        let agent = getValue('options', 'agent') || '1';
                                                                        if (e.target.checked) {
                                                                            agent = agent.includes(',') ? agent + ',fstrim_cloned_disks=1' : '1,fstrim_cloned_disks=1';
                                                                        } else {
                                                                            agent = agent.replace(/,?fstrim_cloned_disks=1/, '').replace(/^,/, '');
                                                                        }
                                                                        handleChange('options', 'agent', agent || '1');
                                                                    }}
                                                                    className="w-4 h-4 rounded"
                                                                />
                                                                {t('fstrim')}
                                                            </label>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Hotplug options */}
                                                <div className="p-4 bg-proxmox-dark rounded-lg border border-proxmox-border">
                                                    <label className={isCorporate ? 'corp-label' : 'text-sm font-medium text-gray-300 block mb-2'}>{t('hotplug')}</label>
                                                    <p className="text-xs text-gray-500 mb-3">{t('hotplugHint')}</p>
                                                    <div className="flex flex-wrap gap-4">
                                                        {[
                                                            { key: 'disk', label: t('hotplugDisk') },
                                                            { key: 'network', label: t('hotplugNetwork') },
                                                            { key: 'usb', label: t('hotplugUsb') },
                                                            { key: 'memory', label: t('hotplugMemory') },
                                                            { key: 'cpu', label: t('hotplugCpu') },
                                                        ].map(hp => {
                                                            const hotplugValue = getValue('options', 'hotplug') || 'disk,network,usb';
                                                            const isEnabled = hotplugValue === '1' || hotplugValue.includes(hp.key);
                                                            return (
                                                                <label key={hp.key} className={isCorporate ? 'corp-label' : 'flex items-center gap-2 text-sm text-gray-400'}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isEnabled}
                                                                        onChange={(e) => {
                                                                            let current = getValue('options', 'hotplug') || 'disk,network,usb';
                                                                            if (current === '1') current = 'disk,network,usb,memory,cpu';
                                                                            if (current === '0') current = '';

                                                                            let parts = current.split(',').filter(p => p);
                                                                            if (e.target.checked && !parts.includes(hp.key)) {
                                                                                parts.push(hp.key);
                                                                            } else if (!e.target.checked) {
                                                                                parts = parts.filter(p => p !== hp.key);
                                                                            }
                                                                            handleChange('options', 'hotplug', parts.join(',') || '0');
                                                                        }}
                                                                        className="w-4 h-4 rounded"
                                                                    />
                                                                    {hp.label}
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                {/* Virtualization Options Card */}
                                                <div className="p-4 bg-proxmox-dark rounded-lg border border-proxmox-border space-y-3">
                                                    <ConfigCheckboxField
                                                        label={t('kvmVirtualization')}
                                                        checked={getValue('options', 'kvm') == 1}
                                                        onChange={(v) => handleChange('options', 'kvm', v)}
                                                        needsRestart={true}
                                                        t={t}
                                                    />
                                                    <ConfigCheckboxField
                                                        label="ACPI"
                                                        checked={getValue('options', 'acpi') == 1}
                                                        onChange={(v) => handleChange('options', 'acpi', v)}
                                                        needsRestart={true}
                                                        t={t}
                                                    />
                                                </div>
                                            </>
                                        )}
                                        {!isQemu && (
                                            <>
                                                <ConfigCheckboxField
                                                    label={t('unprivilegedContainer')}
                                                    checked={getValue('options', 'unprivileged') == 1}
                                                    onChange={(v) => handleChange('options', 'unprivileged', v)}
                                                    disabled={true}
                                                    needsRestart={true}
                                                    t={t}
                                                />

                                                {/* LXC Startup (boot order and start/stop delays) */}
                                                <div className="p-4 bg-proxmox-dark rounded-lg border border-proxmox-border space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <label className={isCorporate ? 'corp-label' : 'text-sm font-medium text-gray-300'}>{t('startup')}</label>
                                                        <span className="text-[10px] px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded font-medium">{t('needsRestart')}</span>
                                                    </div>
                                                    <p className="text-xs text-gray-500">{t('startupHint')}</p>
                                                    {(() => {
                                                        const startup = getValue('options', 'startup') || '';
                                                        const parsed = {};
                                                        startup.split(',').forEach(p => {
                                                            if (p.includes('=')) {
                                                                const [k, v] = p.split('=');
                                                                parsed[k.trim()] = v.trim();
                                                            }
                                                        });
                                                        const update = (key, val) => {
                                                            const next = { ...parsed, [key]: (val || '').toString().trim() };
                                                            const parts = [];
                                                            if (next.order !== '' && next.order !== undefined) parts.push(`order=${next.order}`);
                                                            if (next.up !== '' && next.up !== undefined) parts.push(`up=${next.up}`);
                                                            if (next.down !== '' && next.down !== undefined) parts.push(`down=${next.down}`);
                                                            handleChange('options', 'startup', parts.join(',') || '');
                                                        };
                                                        return (
                                                            <div className="grid grid-cols-3 gap-3">
                                                                <ConfigInputField
                                                                    label={t('startupOrder')}
                                                                    type="text"
                                                                    value={parsed.order || ''}
                                                                    onChange={(v) => update('order', v)}
                                                                    placeholder="0"
                                                                    t={t}
                                                                />
                                                                <ConfigInputField
                                                                    label={t('startupUp')}
                                                                    type="text"
                                                                    value={parsed.up || ''}
                                                                    onChange={(v) => update('up', v)}
                                                                    placeholder="0"
                                                                    t={t}
                                                                />
                                                                <ConfigInputField
                                                                    label={t('startupDown')}
                                                                    type="text"
                                                                    value={parsed.down || ''}
                                                                    onChange={(v) => update('down', v)}
                                                                    placeholder="0"
                                                                    t={t}
                                                                />
                                                            </div>
                                                        );
                                                    })()}
                                                </div>

                                                {/* LXC Features */}
                                                <div className="p-4 bg-proxmox-dark rounded-lg border border-proxmox-border space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <label className={isCorporate ? 'corp-label' : 'text-sm font-medium text-gray-300'}>{t('features')}</label>
                                                        <span className="text-[10px] px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded font-medium">{t('needsRestart')}</span>
                                                    </div>
                                                    {(() => {
                                                        const features = getValue('options', 'features') || '';
                                                        const parsed = {};
                                                        features.split(',').forEach(p => {
                                                            if (p.includes('=')) {
                                                                const [k, v] = p.split('=');
                                                                parsed[k.trim()] = v.trim();
                                                            }
                                                        });
                                                        const update = (key, val) => {
                                                            const next = { ...parsed, [key]: (val || '').toString().trim() };
                                                            const parts = [];
                                                            ['nesting', 'keyctl'].forEach(k => {
                                                                if (next[k] === '1') parts.push(`${k}=1`);
                                                            });
                                                            if (next.mount) parts.push(`mount=${next.mount.trim()}`);
                                                            Object.entries(next).forEach(([k, v]) => {
                                                                if (!['nesting', 'keyctl', 'mount'].includes(k)) parts.push(`${k}=${v}`);
                                                            });
                                                            handleChange('options', 'features', parts.join(','));
                                                        };
                                                        return (
                                                            <div className="space-y-3">
                                                                <ConfigCheckboxField
                                                                    label={t('nesting')}
                                                                    checked={parsed.nesting === '1'}
                                                                    onChange={(v) => update('nesting', v ? '1' : '0')}
                                                                    t={t}
                                                                />
                                                                <ConfigCheckboxField
                                                                    label={t('keyctl')}
                                                                    checked={parsed.keyctl === '1'}
                                                                    onChange={(v) => update('keyctl', v ? '1' : '0')}
                                                                    t={t}
                                                                />
                                                                <ConfigInputField
                                                                    label={t('mount2')}
                                                                    value={parsed.mount || ''}
                                                                    onChange={(v) => update('mount', v)}
                                                                    placeholder="nfs;cifs"
                                                                    t={t}
                                                                />
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                    {isQemu && (
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-2 gap-4">
                                                <ConfigInputField
                                                    label={t('osType')}
                                                    value={getValue('options', 'ostype')}
                                                    onChange={(v) => handleChange('options', 'ostype', v)}
                                                    options={[
                                                        { value: 'l26', label: 'Linux 2.6+' },
                                                        { value: 'l24', label: 'Linux 2.4' },
                                                        { value: 'win11', label: 'Windows 11' },
                                                        { value: 'win10', label: 'Windows 10' },
                                                        { value: 'win8', label: 'Windows 8' },
                                                        { value: 'win7', label: 'Windows 7' },
                                                        { value: 'wxp', label: 'Windows XP' },
                                                        { value: 'other', label: t('other') },
                                                    ]}
                                                />
                                            </div>

                                            {/* Boot Order UI */}
                                            <div className="p-4 bg-proxmox-dark rounded-lg border border-proxmox-border">
                                                <div className="flex items-center justify-between mb-3">
                                                    <label className={isCorporate ? 'corp-label' : 'text-sm font-medium text-gray-300'}>{t('bootOrder')}</label>
                                                    <span className="text-xs text-gray-500">{t('bootOrderHint')}</span>
                                                </div>

                                                {/* Parse current boot order and available devices */}
                                                {(() => {
                                                    const currentBoot = getValue('options', 'boot') || '';
                                                    const bootDevices = currentBoot.includes('order=')
                                                        ? currentBoot.split('order=')[1].split(';').filter(d => d)
                                                        : [];

                                                    // Collect all bootable devices from config
                                                    const allDevices = [];
                                                    if (config.disks) {
                                                        config.disks.forEach(d => {
                                                            if (!d.id.includes('cloudinit')) allDevices.push(d.id);
                                                        });
                                                    }
                                                    if (config.networks) {
                                                        config.networks.forEach(n => allDevices.push(n.id));
                                                    }
                                                    // Add common devices that might not be in disks array
                                                    ['ide2', 'ide0', 'sata0', 'scsi0', 'virtio0', 'net0'].forEach(dev => {
                                                        if (!allDevices.includes(dev)) {
                                                            // Check if device exists in raw config
                                                            if (config[dev]) allDevices.push(dev);
                                                        }
                                                    });

                                                    // Sort: boot devices first in order, then others
                                                    const sortedDevices = [
                                                        ...bootDevices.filter(d => allDevices.includes(d)),
                                                        ...allDevices.filter(d => !bootDevices.includes(d))
                                                    ].filter((v, i, a) => a.indexOf(v) === i); // unique

                                                    const toggleDevice = (device) => {
                                                        const newOrder = bootDevices.includes(device)
                                                            ? bootDevices.filter(d => d !== device)
                                                            : [...bootDevices, device];
                                                        handleChange('options', 'boot', newOrder.length > 0 ? 'order=' + newOrder.join(';') : '');
                                                    };

                                                    const moveDevice = (device, direction) => {
                                                        const idx = bootDevices.indexOf(device);
                                                        if (idx === -1) return;
                                                        const newOrder = [...bootDevices];
                                                        const newIdx = direction === 'up' ? idx - 1 : idx + 1;
                                                        if (newIdx < 0 || newIdx >= newOrder.length) return;
                                                        [newOrder[idx], newOrder[newIdx]] = [newOrder[newIdx], newOrder[idx]];
                                                        handleChange('options', 'boot', 'order=' + newOrder.join(';'));
                                                    };

                                                    return (
                                                        <div className="space-y-1.5">
                                                            {(() => {
                                                                let enabledCounter = 0;
                                                                return sortedDevices.map((device, idx) => {
                                                                    const isEnabled = bootDevices.includes(device);
                                                                    if (isEnabled) enabledCounter++;
                                                                    const displayNum = enabledCounter;
                                                                    const bootIdx = bootDevices.indexOf(device);
                                                                    const isFirst = bootIdx === 0;
                                                                    const isLast = bootIdx === bootDevices.length - 1;

                                                                    // Determine device type icon + color
                                                                    const isDisk = device.match(/^(scsi|virtio|ide|sata)\d+$/);
                                                                    const isNet = device.match(/^net\d+$/);
                                                                    const isCdrom = device === 'ide2' || (config[device] && String(config[device]).includes('media=cdrom'));
                                                                    const iconColor = isCdrom ? 'text-yellow-400' : isNet ? 'text-cyan-400' : isDisk ? 'text-blue-400' : 'text-gray-400';
                                                                    const iconBg = isCdrom ? 'bg-yellow-500/10' : isNet ? 'bg-cyan-500/10' : isDisk ? 'bg-blue-500/10' : 'bg-gray-500/10';

                                                                    // Get device detail from config
                                                                    const deviceDetail = config[device] ? String(config[device]).split(',')[0] : '';

                                                                    return (
                                                                        <div
                                                                            key={device}
                                                                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${isEnabled
                                                                                ? 'bg-gradient-to-r from-proxmox-orange/5 to-transparent border border-proxmox-orange/30'
                                                                                : 'bg-proxmox-darker/50 border border-transparent hover:border-proxmox-border'
                                                                                }`}
                                                                        >
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={isEnabled}
                                                                                onChange={() => toggleDevice(device)}
                                                                                className="w-4 h-4 rounded border-gray-600 text-proxmox-orange focus:ring-proxmox-orange shrink-0"
                                                                            />
                                                                            <span className={`w-6 text-center text-xs font-bold shrink-0 ${isEnabled ? 'text-proxmox-orange' : 'text-gray-600'}`}>
                                                                                {isEnabled ? `${displayNum}.` : '-'}
                                                                            </span>
                                                                            <div className={`p-1.5 rounded-md ${iconBg} shrink-0`}>
                                                                                {isCdrom ? <Icons.Disc className={`w-4 h-4 ${iconColor}`} />
                                                                                    : isNet ? <Icons.Globe className={`w-4 h-4 ${iconColor}`} />
                                                                                        : isDisk ? <Icons.HardDrive className={`w-4 h-4 ${iconColor}`} />
                                                                                            : <Icons.Database className={`w-4 h-4 ${iconColor}`} />}
                                                                            </div>
                                                                            <div className="flex-1 min-w-0">
                                                                                <span className={`font-mono text-sm ${isEnabled ? 'text-white font-medium' : 'text-gray-500'}`}>
                                                                                    {device}
                                                                                </span>
                                                                                {deviceDetail && (
                                                                                    <span className="ml-2 text-xs text-gray-500 truncate">{deviceDetail.length > 40 ? deviceDetail.substring(0, 40) + '...' : deviceDetail}</span>
                                                                                )}
                                                                            </div>
                                                                            {isEnabled && (
                                                                                <div className="flex items-center gap-0.5 shrink-0">
                                                                                    <button
                                                                                        onClick={() => moveDevice(device, 'up')}
                                                                                        disabled={isFirst}
                                                                                        className="p-1.5 rounded-md hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                                                                                        title="Move up"
                                                                                    >
                                                                                        <Icons.ChevronUp className="w-4 h-4" />
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={() => moveDevice(device, 'down')}
                                                                                        disabled={isLast}
                                                                                        className="p-1.5 rounded-md hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                                                                                        title="Move down"
                                                                                    >
                                                                                        <Icons.ChevronDown className="w-4 h-4" />
                                                                                    </button>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                });
                                                            })()}
                                                            {sortedDevices.length === 0 && (
                                                                <div className="text-center py-4 text-gray-500 text-sm">
                                                                    {t('noBootDevices')}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
                                            </div>

                                            {/* SMBIOS Configuration */}
                                            <div className="p-4 bg-proxmox-dark rounded-lg border border-proxmox-border">
                                                <div className="flex items-center justify-between mb-3">
                                                    <label className={isCorporate ? 'corp-label' : 'text-sm font-medium text-gray-300 flex items-center gap-2'}>
                                                        <Icons.Cpu />
                                                        {t('smbiosSettings')}
                                                    </label>
                                                    <span className="text-[10px] px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded font-medium">{t('needsRestart')}</span>
                                                </div>
                                                <p className="text-xs text-gray-500 mb-4">{t('smbiosHint2')}</p>

                                                {/* Current SMBIOS value display */}
                                                {getValue('options', 'smbios1') && (
                                                    <div className="mb-4 p-3 bg-black/50 rounded-lg border border-green-500/30">
                                                        <label className="block text-[10px] text-green-400 mb-1 font-medium">{t('currentValue')} (smbios1):</label>
                                                        <code className="text-xs text-green-300 font-mono break-all">
                                                            {getValue('options', 'smbios1')}
                                                        </code>
                                                    </div>
                                                )}

                                                {(() => {
                                                    // Parse existing smbios1 value
                                                    const smbiosRaw = getValue('options', 'smbios1') || '';
                                                    const parseSmbios = (raw) => {
                                                        const result = { uuid: '', manufacturer: '', product: '', version: '', serial: '', sku: '', family: '' };
                                                        if (!raw) return result;
                                                        raw.split(',').forEach(part => {
                                                            const [key, ...valueParts] = part.split('=');
                                                            const value = valueParts.join('='); // Handle values with = in them
                                                            if (key && result.hasOwnProperty(key)) {
                                                                result[key] = value || '';
                                                            }
                                                        });
                                                        return result;
                                                    };

                                                    const smbios = parseSmbios(smbiosRaw);

                                                    // Sanitize for Proxmox SMBIOS - only A-Za-z0-9, learned the hard way that underscores dont work either
                                                    const sanitizeSmbios = (value) => {
                                                        if (!value) return '';
                                                        return value
                                                            .replace(/\s+/g, '')  // Remove spaces
                                                            .replace(/[^A-Za-z0-9]/g, '');  // Remove ALL other chars including underscores
                                                    };

                                                    const buildSmbios = (newValues) => {
                                                        const parts = [];
                                                        Object.entries(newValues).forEach(([key, value]) => {
                                                            if (value && value.trim()) {
                                                                // UUID is special - don't sanitize
                                                                const finalValue = key === 'uuid' ? value : sanitizeSmbios(value);
                                                                if (finalValue) {
                                                                    parts.push(`${key}=${finalValue}`);
                                                                }
                                                            }
                                                        });
                                                        return parts.join(',');
                                                    };

                                                    const updateSmbios = (field, value) => {
                                                        const newSmbios = { ...smbios, [field]: value };
                                                        const encoded = buildSmbios(newSmbios);
                                                        handleChange('options', 'smbios1', encoded || null);
                                                    };

                                                    const generateUuid = () => {
                                                        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                                                            const r = Math.random() * 16 | 0;
                                                            const v = c === 'x' ? r : (r & 0x3 | 0x8);
                                                            return v.toString(16);
                                                        });
                                                    };

                                                    return (
                                                        <div className="space-y-3">
                                                            {/* UUID - Display only, managed by Proxmox */}
                                                            <div>
                                                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>UUID <span className="text-gray-600">({t('managedByProxmox')})</span></label>
                                                                <div className="w-full px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded-lg text-gray-500 text-sm font-mono">
                                                                    {smbios.uuid ? smbios.uuid : <span className="italic">{t('willBeAutoGenerated')}</span>}
                                                                </div>
                                                            </div>

                                                            {/* Format hint */}
                                                            <p className="text-[10px] text-yellow-500/70">
                                                                ⚠️ {t('smbiosFormatHint')}
                                                            </p>

                                                            <div className="grid grid-cols-2 gap-3">
                                                                {/* Manufacturer */}
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('manufacturer')}</label>
                                                                    <input
                                                                        type="text"
                                                                        value={smbios.manufacturer}
                                                                        onChange={(e) => updateSmbios('manufacturer', e.target.value)}
                                                                        placeholder="e.g. Dell" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-card border border-proxmox-border rounded-lg text-white text-sm'}
                                                                    />
                                                                    {smbios.manufacturer && sanitizeSmbios(smbios.manufacturer) !== smbios.manufacturer && (
                                                                        <p className="text-[10px] text-yellow-400 mt-0.5">↑ {sanitizeSmbios(smbios.manufacturer)}</p>
                                                                    )}
                                                                </div>

                                                                {/* Product */}
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('product')}</label>
                                                                    <input
                                                                        type="text"
                                                                        value={smbios.product}
                                                                        onChange={(e) => updateSmbios('product', e.target.value)}
                                                                        placeholder="e.g. PowerEdgeR740" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-card border border-proxmox-border rounded-lg text-white text-sm'}
                                                                    />
                                                                    {smbios.product && sanitizeSmbios(smbios.product) !== smbios.product && (
                                                                        <p className="text-[10px] text-yellow-400 mt-0.5">↑ {sanitizeSmbios(smbios.product)}</p>
                                                                    )}
                                                                </div>

                                                                {/* Version */}
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('version')}</label>
                                                                    <input
                                                                        type="text"
                                                                        value={smbios.version}
                                                                        onChange={(e) => updateSmbios('version', e.target.value)}
                                                                        placeholder="e.g. v1" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-card border border-proxmox-border rounded-lg text-white text-sm'}
                                                                    />
                                                                    {smbios.version && sanitizeSmbios(smbios.version) !== smbios.version && (
                                                                        <p className="text-[10px] text-yellow-400 mt-0.5">↑ {sanitizeSmbios(smbios.version)}</p>
                                                                    )}
                                                                </div>

                                                                {/* Serial */}
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('serialNumber')}</label>
                                                                    <input
                                                                        type="text"
                                                                        value={smbios.serial}
                                                                        onChange={(e) => updateSmbios('serial', e.target.value)}
                                                                        placeholder="e.g. ABC123" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-card border border-proxmox-border rounded-lg text-white text-sm'}
                                                                    />
                                                                    {smbios.serial && sanitizeSmbios(smbios.serial) !== smbios.serial && (
                                                                        <p className="text-[10px] text-yellow-400 mt-0.5">↑ {sanitizeSmbios(smbios.serial)}</p>
                                                                    )}
                                                                </div>

                                                                {/* SKU */}
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>SKU</label>
                                                                    <input
                                                                        type="text"
                                                                        value={smbios.sku}
                                                                        onChange={(e) => updateSmbios('sku', e.target.value)}
                                                                        placeholder="e.g. SKU12345" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-card border border-proxmox-border rounded-lg text-white text-sm'}
                                                                    />
                                                                    {smbios.sku && sanitizeSmbios(smbios.sku) !== smbios.sku && (
                                                                        <p className="text-[10px] text-yellow-400 mt-0.5">↑ {sanitizeSmbios(smbios.sku)}</p>
                                                                    )}
                                                                </div>

                                                                {/* Family */}
                                                                <div>
                                                                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('family')}</label>
                                                                    <input
                                                                        type="text"
                                                                        value={smbios.family}
                                                                        onChange={(e) => updateSmbios('family', e.target.value)}
                                                                        placeholder="e.g. Server" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-card border border-proxmox-border rounded-lg text-white text-sm'}
                                                                    />
                                                                    {smbios.family && sanitizeSmbios(smbios.family) !== smbios.family && (
                                                                        <p className="text-[10px] text-yellow-400 mt-0.5">↑ {sanitizeSmbios(smbios.family)}</p>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* Live Preview */}
                                                            {(smbios.uuid || smbios.manufacturer || smbios.product || smbios.version || smbios.serial || smbios.sku || smbios.family) && (
                                                                <div className="p-3 bg-black/50 rounded-lg border border-proxmox-border">
                                                                    <label className={isCorporate ? 'corp-label' : 'block text-[10px] text-gray-500 mb-1'}>{t('preview')} (smbios1):</label>
                                                                    <code className="text-xs text-green-400 font-mono break-all">
                                                                        {buildSmbios(smbios)}
                                                                    </code>
                                                                </div>
                                                            )}

                                                            {/* Quick presets - using only safe characters (A-Za-z0-9) */}
                                                            <div className="pt-2 border-t border-proxmox-border">
                                                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-2'}>{t('presets')}</label>
                                                                <div className="flex flex-wrap gap-2">
                                                                    <button
                                                                        onClick={() => {
                                                                            const base = smbios.uuid ? `uuid=${smbios.uuid},` : '';
                                                                            handleChange('options', 'smbios1', `${base}manufacturer=Dell,product=PowerEdgeR740,version=v1,serial=DELL${Math.random().toString(36).substr(2, 8).toUpperCase()},family=Server`);
                                                                        }}
                                                                        className="px-2 py-1 bg-proxmox-card border border-proxmox-border rounded text-xs text-gray-400 hover:text-white hover:bg-proxmox-border"
                                                                    >
                                                                        Dell Server
                                                                    </button>
                                                                    <button
                                                                        onClick={() => {
                                                                            const base = smbios.uuid ? `uuid=${smbios.uuid},` : '';
                                                                            handleChange('options', 'smbios1', `${base}manufacturer=HP,product=ProLiantDL380,version=v1,serial=MXQ${Math.random().toString(36).substr(2, 8).toUpperCase()},family=Server`);
                                                                        }}
                                                                        className="px-2 py-1 bg-proxmox-card border border-proxmox-border rounded text-xs text-gray-400 hover:text-white hover:bg-proxmox-border"
                                                                    >
                                                                        HP Server
                                                                    </button>
                                                                    <button
                                                                        onClick={() => {
                                                                            const base = smbios.uuid ? `uuid=${smbios.uuid},` : '';
                                                                            handleChange('options', 'smbios1', `${base}manufacturer=Lenovo,product=ThinkPadX1,version=v1,serial=PF${Math.random().toString(36).substr(2, 8).toUpperCase()},family=ThinkPad`);
                                                                        }}
                                                                        className="px-2 py-1 bg-proxmox-card border border-proxmox-border rounded text-xs text-gray-400 hover:text-white hover:bg-proxmox-border"
                                                                    >
                                                                        Lenovo Laptop
                                                                    </button>
                                                                    <button
                                                                        onClick={async () => {
                                                                            // Fetch smbios settings from cluster config
                                                                            const sanitize = (v) => (v || '').replace(/\s+/g, '').replace(/[^A-Za-z0-9]/g, '');
                                                                            try {
                                                                                const res = await authFetch(`${API_URL}/clusters/${clusterId}/smbios-autoconfig`);
                                                                                const settings = res?.ok ? await res.json() : {};
                                                                                const mfg = sanitize(settings.manufacturer) || 'Proxmox';
                                                                                const prod = sanitize(settings.product) || 'ProxmoxVExManagment';
                                                                                const ver = sanitize(settings.version) || 'v1';
                                                                                const fam = sanitize(settings.family) || 'ProxmoxVE';
                                                                                const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(2, 14);
                                                                                const randomPart = Math.floor(Math.random() * 9000 + 1000);
                                                                                const base = smbios.uuid ? `uuid=${smbios.uuid},` : '';
                                                                                handleChange('options', 'smbios1', `${base}manufacturer=${mfg},product=${prod},version=${ver},serial=PVE${timestamp}${randomPart},family=${fam}`);
                                                                            } catch (e) {
                                                                                // fallback to defaults
                                                                                const base = smbios.uuid ? `uuid=${smbios.uuid},` : '';
                                                                                const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(2, 14);
                                                                                const randomPart = Math.floor(Math.random() * 9000 + 1000);
                                                                                handleChange('options', 'smbios1', `${base}manufacturer=Proxmox,product=ProxmoxVExManagment,version=v1,serial=PVE${timestamp}${randomPart},family=ProxmoxVE`);
                                                                            }
                                                                        }}
                                                                        className="px-2 py-1 bg-proxmox-orange/20 border border-proxmox-orange/50 rounded text-xs text-proxmox-orange hover:bg-proxmox-orange/30"
                                                                        title={t('applySmbiosFromClusterConfig')}
                                                                    >
                                                                        🦄 ProxmoxVEx
                                                                    </button>
                                                                    <button
                                                                        onClick={() => {
                                                                            const base = smbios.uuid ? `uuid=${smbios.uuid},` : '';
                                                                            handleChange('options', 'smbios1', `${base}manufacturer=Microsoft,product=VirtualMachine,version=HyperV,serial=0000000000000000,family=VirtualMachine`);
                                                                        }}
                                                                        className="px-2 py-1 bg-proxmox-card border border-proxmox-border rounded text-xs text-gray-400 hover:text-white hover:bg-proxmox-border"
                                                                    >
                                                                        Hyper-V
                                                                    </button>
                                                                    <button
                                                                        onClick={() => {
                                                                            handleChange('options', 'smbios1', '');
                                                                        }}
                                                                        className="px-2 py-1 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400 hover:bg-red-500/20"
                                                                    >
                                                                        {t('clear')}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    )}
                                    {!isQemu && (
                                        <div className="grid grid-cols-2 gap-4">
                                            <ConfigInputField
                                                label="Nameserver"
                                                value={getValue('options', 'nameserver')}
                                                onChange={(v) => handleChange('options', 'nameserver', v)}
                                            />
                                            <ConfigInputField
                                                label="Search Domain"
                                                value={getValue('options', 'searchdomain')}
                                                onChange={(v) => handleChange('options', 'searchdomain', v)}
                                            />
                                        </div>
                                    )}

                                    {/* Advanced / Raw Config */}
                                    {(() => {
                                        // Hide everything the dedicated sections above already expose.
                                        const excluded = new Set(['digest', 'lock', 'node', 'type', 'status', 'vmid', ...Object.keys(config.general || {}), ...Object.keys(config.hardware || {}), ...Object.keys(config.options || {})]);
                                        ['ostype', 'arch', 'vmgenid', 'bootdisk', 'tablet'].forEach(k => excluded.delete(k));
                                        const rawValues = config.raw || {};
                                        const rawKeys = Array.from(new Set([
                                            ...Object.keys(rawValues).filter(k => !excluded.has(k)),
                                            ...rawExtraKeys
                                        ])).sort();
                                        return (
                                            <RawConfigEditor
                                                rawValues={rawValues}
                                                keys={rawKeys}
                                                changes={changes}
                                                deletes={rawDeletes}
                                                onChange={handleRawChange}
                                                onRevert={handleRevert}
                                                onToggleDelete={handleToggleRawDelete}
                                                isCorporate={isCorporate}
                                                addToast={addToast}
                                            />
                                        );
                                    })()}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="text-center py-8 text-red-400">
                            Konfiguration konnte nicht geladen werden
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-proxmox-border bg-proxmox-dark">
                    <div className="text-xs text-gray-500">
                        {vm.status === 'running' && (
                            <span className="text-yellow-400">
                                {t('changesRequireRestart')}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-gray-300 font-medium hover:bg-proxmox-hover transition-colors"
                        >
                            {t('cancel')}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!hasChanges || saving}
                            className="flex items-center gap-2 px-4 py-2 bg-proxmox-orange rounded-lg text-white font-medium hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {saving ? (
                                <Icons.RotateCw className="w-4 h-4 animate-spin" />
                            ) : (
                                <Icons.Save />
                            )}
                            {t('save')}
                        </button>
                    </div>
                </div>
            </div>

            {/* Sub-Modals */}
            {showAddDisk && (
                <AddDiskModal
                    isQemu={isQemu}
                    storageList={storageList}
                    hardwareOptions={hardwareOptions}
                    getNextDiskId={getNextDiskId}
                    onAdd={handleAddDisk}
                    onClose={() => setShowAddDisk(false)}
                />
            )}

            {showResizeDisk && (
                <ResizeDiskModal
                    disk={showResizeDisk}
                    onResize={(size) => handleResizeDisk(showResizeDisk.id, size)}
                    onClose={() => setShowResizeDisk(null)}
                />
            )}

            {showMoveDisk && (
                <MoveDiskModal
                    disk={showMoveDisk}
                    storageList={storageList}
                    onMove={(storage, deleteSource) => handleMoveDisk(showMoveDisk.id, storage, deleteSource)}
                    onClose={() => setShowMoveDisk(null)}
                />
            )}

            {/* Edit Disk Bus Type Modal */}
            {showEditDisk && (
                <EditDiskBusModal
                    disk={showEditDisk}
                    hardwareOptions={hardwareOptions}
                    vmStatus={config?.status?.status}
                    onSave={async (newBusType) => {
                        // Double-check VM is stopped before changing bus type
                        if (config?.status?.status === 'running') {
                            addToast(t('vmMustBeStopped2'), 'error');
                            return;
                        }

                        const oldId = showEditDisk.id;
                        const oldBusMatch = oldId.match(/^([a-z]+)(\d+)$/);
                        if (!oldBusMatch) {
                            addToast('Invalid disk ID format', 'error');
                            return;
                        }
                        const oldBus = oldBusMatch[1];
                        const oldNum = oldBusMatch[2];

                        // Find next available ID for new bus type
                        const existingIds = (config?.disks || []).map(d => d.id);
                        let newNum = 0;
                        while (existingIds.includes(`${newBusType}${newNum}`)) {
                            newNum++;
                        }
                        const newId = `${newBusType}${newNum}`;

                        if (oldId === newId) {
                            setShowEditDisk(null);
                            return;
                        }

                        try {
                            // Get current disk value and clean it for new bus type
                            let currentValue = config?.raw?.[oldId] || showEditDisk.volume;

                            // Strip unsupported options based on target bus type
                            // iothread only supported on scsi/virtio
                            if (!['scsi', 'virtio'].includes(newBusType)) {
                                currentValue = currentValue.replace(/,iothread=\d+/g, '');
                            }
                            // ssd only supported on scsi/virtio/sata (not ide)
                            if (!['scsi', 'virtio', 'sata'].includes(newBusType)) {
                                currentValue = currentValue.replace(/,ssd=\d+/g, '');
                            }

                            // Remove size= parameter!
                            // If size is present, Proxmox thinks we want to CREATE a new disk
                            // For reattaching existing volumes, size must be omitted
                            currentValue = currentValue.replace(/,size=\d+[KMGT]?/gi, '');

                            // Two-step process to avoid creating new volume:
                            // Delete old disk config (volume becomes "unused")
                            const deleteRes = await fetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/config`, {
                                method: 'PUT',
                                credentials: 'include',
                                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                                body: JSON.stringify({ delete: oldId })
                            });

                            if (!deleteRes.ok) {
                                const err = await deleteRes.json();
                                addToast(err.error || 'Error detaching old disk', 'error');
                                return;
                            }

                            // Small delay to let Proxmox process the detach
                            await new Promise(r => setTimeout(r, 500));

                            // Attach volume with new bus type
                            const attachRes = await fetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/config`, {
                                method: 'PUT',
                                credentials: 'include',
                                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                                body: JSON.stringify({ [newId]: currentValue })
                            });

                            if (attachRes.ok) {
                                addToast(`${t('diskBusChanged2')}: ${oldId} ↑ ${newId}`, 'success');
                                fetchConfig();
                                setShowEditDisk(null);
                            } else {
                                const err = await attachRes.json();
                                addToast(err.error || 'Error attaching disk with new bus type', 'error');
                                // Try to restore old config on failure
                                await fetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/config`, {
                                    method: 'PUT',
                                    credentials: 'include',
                                    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ [oldId]: config?.raw?.[oldId] || showEditDisk.volume })
                                });
                                fetchConfig();
                            }
                        } catch (e) {
                            addToast('Error changing disk bus', 'error');
                        }
                    }}
                    onClose={() => setShowEditDisk(null)}
                />
            )}

            {/* Reattach unused disk modal */}
            {showReattachDisk && (
                <ReattachDiskModal
                    disk={showReattachDisk}
                    getNextDiskId={getNextDiskId}
                    onReattach={async (diskId, diskValue) => {
                        try {
                            const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/config`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ [diskId]: diskValue })
                            });
                            if (res && res.ok) {
                                addToast(`${t('diskReattached2')} ${diskId}`, 'success');
                                fetchConfig();
                                setShowReattachDisk(null);
                            } else {
                                const err = await res.json();
                                addToast(err.error || 'Error reattaching disk', 'error');
                            }
                        } catch (e) {
                            addToast('Error reattaching disk', 'error');
                        }
                    }}
                    onClose={() => setShowReattachDisk(null)}
                />
            )}

            {/* Import Disk Modal */}
            {showImportDisk && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
                    <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-lg bg-proxmox-card border border-proxmox-border rounded-xl p-6'}>
                        <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white mb-2'}>{t('importDisk')}</h3>
                        <p className="text-sm text-gray-400 mb-4">{t('importDiskDesc')}</p>
                        <div className="space-y-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('selectImportStorage2')}</label>
                                <select
                                    id="importStorage" className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded px-3 py-2 text-white'}
                                    onChange={async (e) => {
                                        const storage = e.target.value;
                                        if (!storage) { setImportableDisks([]); return; }
                                        try {
                                            const res = await authFetch(`${API_URL}/clusters/${clusterId}/nodes/${vm.node}/storage/${storage}/content?content=images`);
                                            if (res && res.ok) {
                                                const data = await res.json();
                                                // Filter for disk images that could be imported
                                                const disks = (data || []).filter(item =>
                                                    item.format && ['raw', 'qcow2', 'vmdk'].includes(item.format)
                                                );
                                                setImportableDisks(disks);
                                            }
                                        } catch (e) { setImportableDisks([]); }
                                    }}
                                >
                                    <option value="">-- {t('selectStorage8')} --</option>
                                    {storageList.filter(s => s.type !== 'iso' && s.type !== 'vztmpl').map(s => (
                                        <option key={s.storage} value={s.storage}>{s.storage} ({s.type})</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('selectDiskImage')}</label>
                                <select
                                    id="importDiskImage" className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded px-3 py-2 text-white'}
                                >
                                    <option value="">-- {t('selectDiskImage2')} --</option>
                                    {importableDisks.map(disk => (
                                        <option key={disk.volid} value={disk.volid}>
                                            {disk.volid} ({disk.format}, {Math.round((disk.size || 0) / 1024 / 1024 / 1024)} GB)
                                        </option>
                                    ))}
                                </select>
                                {importableDisks.length === 0 && (
                                    <p className="text-xs text-yellow-500 mt-1">{t('noImportableDisks')}</p>
                                )}
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('targetBus')}</label>
                                <select
                                    id="importTargetBus"
                                    defaultValue="scsi" className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded px-3 py-2 text-white'}
                                >
                                    <option value="scsi">SCSI</option>
                                    <option value="virtio">VirtIO</option>
                                    <option value="sata">SATA</option>
                                    <option value="ide">IDE</option>
                                </select>
                            </div>
                            <div className="flex gap-2 justify-end pt-4">
                                <button onClick={() => { setShowImportDisk(false); setImportableDisks([]); }} className="px-4 py-2 bg-proxmox-dark hover:bg-proxmox-hover rounded text-gray-300">{t('cancel')}</button>
                                <button
                                    onClick={async () => {
                                        const volid = document.getElementById('importDiskImage').value;
                                        const sourceStorage = document.getElementById('importStorage').value;
                                        const targetBus = document.getElementById('importTargetBus').value;
                                        if (!volid) { addToast('Please select a disk image', 'error'); return; }

                                        // Ensure volid has storage prefix (some APIs return just volume name)
                                        let fullVolid = volid;
                                        if (!volid.includes(':') && sourceStorage) {
                                            fullVolid = `${sourceStorage}:${volid}`;
                                        }

                                        // Get next available disk ID for the bus type
                                        const nextId = getNextDiskId(targetBus);

                                        try {
                                            // Import by setting the disk config
                                            const res = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/config`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ [nextId]: fullVolid })
                                            });
                                            if (res && res.ok) {
                                                addToast(t('diskImported'), 'success');
                                                await new Promise(resolve => setTimeout(resolve, 500));
                                                fetchConfig();
                                                setShowImportDisk(false);
                                                setImportableDisks([]);
                                            } else {
                                                const err = await res.json();
                                                addToast(err.error || 'Error importing disk', 'error');
                                            }
                                        } catch (e) {
                                            addToast('Error importing disk', 'error');
                                        }
                                    }}
                                    className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded text-white"
                                >
                                    {t('import')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Reassign Owner Modal */}
            {showReassignOwner && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
                    <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-lg bg-proxmox-card border border-proxmox-border rounded-xl p-6'}>
                        <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white mb-2'}>{t('reassignOwner')}</h3>
                        <p className="text-sm text-gray-400 mb-4">{t('reassignOwnerDesc')}</p>
                        <div className="space-y-4">
                            <div className="p-3 bg-proxmox-dark rounded">
                                <span className="text-gray-400">{t('disk')}:</span>
                                <span className="ml-2 text-white font-mono">{showReassignOwner.id}</span>
                                <span className="ml-2 text-gray-500">({showReassignOwner.volume})</span>
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('targetVm')}</label>
                                <select
                                    id="reassignTargetVm" className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded px-3 py-2 text-white'}
                                >
                                    <option value="">-- {t('selectVm3')} --</option>
                                    {(window.ProxmoxVExVmList || []).filter(v => v.type === 'qemu' && v.vmid !== vm.vmid).map(v => (
                                        <option key={v.vmid} value={v.vmid}>{v.vmid} - {v.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('targetBus')}</label>
                                <select
                                    id="reassignTargetBus"
                                    defaultValue="scsi" className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded px-3 py-2 text-white'}
                                >
                                    <option value="scsi">SCSI</option>
                                    <option value="virtio">VirtIO</option>
                                    <option value="sata">SATA</option>
                                </select>
                            </div>
                            <div className="flex gap-2 justify-end pt-4">
                                <button onClick={() => setShowReassignOwner(null)} className="px-4 py-2 bg-proxmox-dark hover:bg-proxmox-hover rounded text-gray-300">{t('cancel')}</button>
                                <button
                                    onClick={async () => {
                                        const targetVmid = document.getElementById('reassignTargetVm').value;
                                        const targetBus = document.getElementById('reassignTargetBus').value;
                                        if (!targetVmid) { addToast('Please select a target VM', 'error'); return; }

                                        try {
                                            // Detach from current VM
                                            const detachRes = await authFetch(
                                                `${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/disks/${showReassignOwner.id}`,
                                                { method: 'DELETE' }
                                            );
                                            if (!detachRes || !detachRes.ok) {
                                                const err = await detachRes.json();
                                                addToast(err.error || 'Error detaching disk', 'error');
                                                return;
                                            }

                                            // Attach to target VM
                                            // Need to get the next available disk ID for target VM
                                            const configRes = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/qemu/${targetVmid}/config`);
                                            let nextId = `${targetBus}0`;
                                            if (configRes && configRes.ok) {
                                                const targetConfig = await configRes.json();
                                                // Find next available ID
                                                for (let i = 0; i < 30; i++) {
                                                    const testId = `${targetBus}${i}`;
                                                    if (!targetConfig[testId]) {
                                                        nextId = testId;
                                                        break;
                                                    }
                                                }
                                            }

                                            // Use full volume path (storage:volume) - disk.value has the complete string
                                            // But we need to strip any extra options like ,size=32G
                                            let volumePath = showReassignOwner.value || `${showReassignOwner.storage}:${showReassignOwner.volume}`;
                                            // Extract just the storage:volume part (before any comma)
                                            volumePath = volumePath.split(',')[0];

                                            const attachRes = await authFetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/qemu/${targetVmid}/config`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ [nextId]: volumePath })
                                            });

                                            if (attachRes && attachRes.ok) {
                                                addToast(t('diskReassigned'), 'success');
                                                await new Promise(resolve => setTimeout(resolve, 500));
                                                fetchConfig();
                                                setShowReassignOwner(null);
                                            } else {
                                                const err = await attachRes.json();
                                                addToast(err.error || 'Error attaching to target VM', 'error');
                                            }
                                        } catch (e) {
                                            addToast('Error reassigning disk', 'error');
                                        }
                                    }}
                                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-white"
                                >
                                    {t('reassign')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showMountISO && (
                <MountISOModal
                    isoList={isoList}
                    initialDrive={mountIsoInitialDrive}
                    existingDrives={
                        // Extract existing drives from config.disks array
                        (config?.disks || []).map(disk => ({
                            key: disk.id,
                            isCdrom: String(disk.value || '').includes('media=cdrom')
                        }))
                    }
                    onMount={handleMountISO}
                    onClose={() => { setShowMountISO(false); setMountIsoInitialDrive(null); }}
                />
            )}

            {showAddNetwork && (
                <AddNetworkModal
                    isQemu={isQemu}
                    bridgeList={bridgeList}
                    hardwareOptions={hardwareOptions}
                    getNextNetId={getNextNetId}
                    generateMAC={generateMAC}
                    onAdd={handleAddNetwork}
                    onClose={() => setShowAddNetwork(false)}
                />
            )}

            {showEditNetwork && (
                <EditNetworkModal
                    isQemu={isQemu}
                    network={showEditNetwork}
                    bridgeList={bridgeList}
                    hardwareOptions={hardwareOptions}
                    generateMAC={generateMAC}
                    onUpdate={(config) => handleUpdateNetwork(showEditNetwork.id, config)}
                    onClose={() => setShowEditNetwork(null)}
                />
            )}

            {/* Add PCI Device Modal */}
            {showAddPci && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
                    <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-lg bg-proxmox-card border border-proxmox-border rounded-xl p-6'}>
                        <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white mb-4'}>{t('addPci')}</h3>
                        <div className="space-y-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('availableDevices')}</label>
                                <select
                                    value={selectedPciDevice?.id || ''}
                                    onChange={(e) => setSelectedPciDevice(availablePci.find(d => d.id === e.target.value))} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded px-3 py-2 text-white'}
                                >
                                    <option value="">-- {t('selectDevice')} --</option>
                                    {availablePci.filter(d => d.iommugroup >= 0).map(dev => (
                                        <option key={dev.id} value={dev.id}>
                                            {dev.id} - {dev.vendor_name} {dev.device_name} (IOMMU: {dev.iommugroup})
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {selectedPciDevice && (
                                <div className="p-3 bg-proxmox-dark rounded text-sm">
                                    <div className="text-gray-400">{t('vendor')}: <span className="text-white">{selectedPciDevice.vendor_name}</span></div>
                                    <div className="text-gray-400">Device: <span className="text-white">{selectedPciDevice.device_name}</span></div>
                                    <div className="text-gray-400">{t('iommuGroup')}: <span className="text-white">{selectedPciDevice.iommugroup}</span></div>
                                </div>
                            )}
                            <div className="space-y-2">
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={pciOptions.pcie} onChange={(e) => setPciOptions({ ...pciOptions, pcie: e.target.checked })} className="rounded" />
                                    <span className="text-sm text-gray-300">{t('pcie')}</span>
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={pciOptions.rombar} onChange={(e) => setPciOptions({ ...pciOptions, rombar: e.target.checked })} className="rounded" />
                                    <span className="text-sm text-gray-300">{t('romBar')}</span>
                                </label>
                            </div>
                            <div className="flex gap-2 justify-end pt-4">
                                <button onClick={() => { setShowAddPci(false); setSelectedPciDevice(null); }} className="px-4 py-2 bg-proxmox-dark hover:bg-proxmox-hover rounded">{t('cancel')}</button>
                                <button onClick={handleAddPciDevice} disabled={!selectedPciDevice || passthroughLoading} className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded disabled:opacity-50">
                                    {passthroughLoading ? t('adding') : t('add')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Add USB Device Modal */}
            {showAddUsb && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
                    <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-lg bg-proxmox-card border border-proxmox-border rounded-xl p-6'}>
                        <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white mb-4'}>{t('addUsb')}</h3>
                        <div className="space-y-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('availableDevices')}</label>
                                <select
                                    value={selectedUsbDevice ? `${selectedUsbDevice.vendid}:${selectedUsbDevice.prodid}` : ''}
                                    onChange={(e) => {
                                        const [vid, pid] = e.target.value.split(':');
                                        setSelectedUsbDevice(availableUsb.find(d => d.vendid === vid && d.prodid === pid));
                                    }} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded px-3 py-2 text-white'}
                                >
                                    <option value="">-- {t('selectDevice')} --</option>
                                    {availableUsb.map((dev, idx) => (
                                        <option key={idx} value={`${dev.vendid}:${dev.prodid}`}>
                                            {dev.manufacturer || dev.vendid} - {dev.product || dev.prodid}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={usbOptions.usb3} onChange={(e) => setUsbOptions({ ...usbOptions, usb3: e.target.checked })} className="rounded" />
                                <span className="text-sm text-gray-300">{t('usb3')}</span>
                            </label>
                            <div className="flex gap-2 justify-end pt-4">
                                <button onClick={() => { setShowAddUsb(false); setSelectedUsbDevice(null); }} className="px-4 py-2 bg-proxmox-dark hover:bg-proxmox-hover rounded">{t('cancel')}</button>
                                <button onClick={handleAddUsbDevice} disabled={!selectedUsbDevice || passthroughLoading} className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded disabled:opacity-50">
                                    {passthroughLoading ? t('adding') : t('add')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Serial Port Modal */}
            {showAddSerial && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
                    <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-md bg-proxmox-card border border-proxmox-border rounded-xl p-6'}>
                        <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white mb-4'}>{t('addSerial')}</h3>
                        <div className="space-y-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('serialType')}</label>
                                <select
                                    value={serialType}
                                    onChange={(e) => setSerialType(e.target.value)} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded px-3 py-2 text-white'}
                                >
                                    <option value="socket">{t('socketConsole')}</option>
                                    <option value="/dev/ttyUSB0">/dev/ttyUSB0</option>
                                    <option value="/dev/ttyUSB1">/dev/ttyUSB1</option>
                                    <option value="/dev/ttyS0">/dev/ttyS0</option>
                                    <option value="/dev/ttyS1">/dev/ttyS1</option>
                                </select>
                            </div>
                            <div className="flex gap-2 justify-end pt-4">
                                <button onClick={() => setShowAddSerial(false)} className="px-4 py-2 bg-proxmox-dark hover:bg-proxmox-hover rounded">{t('cancel')}</button>
                                <button onClick={handleAddSerialPort} disabled={passthroughLoading} className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded disabled:opacity-50">
                                    {passthroughLoading ? t('adding') : t('add')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Add EFI Disk Modal
                        Size is always 4MB, pre-enrolled keys for Secure Boot */}
            {showAddEfiDisk && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
                    <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-md bg-proxmox-card border border-proxmox-border rounded-xl p-6'}>
                        <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white mb-4 flex items-center gap-2'}>
                            <Icons.HardDrive className="text-blue-400" />
                            {t('addEfiDisk')}
                        </h3>
                        <div className="space-y-4">
                            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm text-blue-300">
                                {t('efiDiskInfo')}
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('storage')}</label>
                                <select
                                    value={efiStorage}
                                    onChange={(e) => setEfiStorage(e.target.value)} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded px-3 py-2 text-white'}
                                >
                                    <option value="">{t('selectStorage9')}</option>
                                    {storageList.filter(s => s.content?.includes('images')).map(s => (
                                        <option key={s.storage} value={s.storage}>{s.storage}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex gap-2 justify-end pt-4">
                                <button onClick={() => setShowAddEfiDisk(false)} className="px-4 py-2 bg-proxmox-dark hover:bg-proxmox-hover rounded">{t('cancel')}</button>
                                <button
                                    onClick={async () => {
                                        if (!efiStorage) return;
                                        setPassthroughLoading(true);
                                        try {
                                            const res = await fetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/config`, {
                                                method: 'PUT',
                                                credentials: 'include',
                                                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ efidisk0: `${efiStorage}:1,efitype=4m,pre-enrolled-keys=1` })
                                            });
                                            if (res.ok) {
                                                addToast(t('efiDiskAdded'), 'success');
                                                setShowAddEfiDisk(false);
                                                fetchConfig();
                                            } else {
                                                const err = await res.json();
                                                addToast(err.error || 'Error adding EFI disk', 'error');
                                            }
                                        } catch (e) {
                                            addToast('Error adding EFI disk', 'error');
                                        }
                                        setPassthroughLoading(false);
                                    }}
                                    disabled={!efiStorage || passthroughLoading}
                                    className="px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded disabled:opacity-50"
                                >
                                    {passthroughLoading ? t('adding') : t('add')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Add TPM Modal */}
            {showAddTpm && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
                    <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-md bg-proxmox-card border border-proxmox-border rounded-xl p-6'}>
                        <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white mb-4 flex items-center gap-2'}>
                            <Icons.Shield className="text-green-400" />
                            {t('addTpm')}
                        </h3>
                        <div className="space-y-4">
                            <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-yellow-300">
                                <div className="flex items-start gap-2">
                                    <Icons.AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                    <div>{t('tpmInfo')}</div>
                                </div>
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('storage')}</label>
                                <select
                                    value={tpmStorage}
                                    onChange={(e) => setTpmStorage(e.target.value)} className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded px-3 py-2 text-white'}
                                >
                                    <option value="">{t('selectStorage10')}</option>
                                    {storageList.filter(s => s.content?.includes('images')).map(s => (
                                        <option key={s.storage} value={s.storage}>{s.storage}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('tpmVersion')}</label>
                                <select className={isCorporate ? 'corp-input' : 'w-full bg-proxmox-dark border border-proxmox-border rounded px-3 py-2 text-white'}
                                    defaultValue="v2.0"
                                >
                                    <option value="v2.0">TPM 2.0 ({t('recommended')})</option>
                                    <option value="v1.2">TPM 1.2</option>
                                </select>
                            </div>
                            <div className="flex gap-2 justify-end pt-4">
                                <button onClick={() => setShowAddTpm(false)} className="px-4 py-2 bg-proxmox-dark hover:bg-proxmox-hover rounded">{t('cancel')}</button>
                                <button
                                    onClick={async () => {
                                        if (!tpmStorage) return;
                                        setPassthroughLoading(true);
                                        try {
                                            const res = await fetch(`${API_URL}/clusters/${clusterId}/vms/${vm.node}/${vm.type}/${vm.vmid}/config`, {
                                                method: 'PUT',
                                                credentials: 'include',
                                                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ tpmstate0: `${tpmStorage}:1,version=v2.0` })
                                            });
                                            if (res.ok) {
                                                addToast(t('tpmAdded'), 'success');
                                                setShowAddTpm(false);
                                                fetchConfig();
                                            } else {
                                                const err = await res.json();
                                                addToast(err.error || 'Error adding TPM', 'error');
                                            }
                                        } catch (e) {
                                            addToast('Error adding TPM', 'error');
                                        }
                                        setPassthroughLoading(false);
                                    }}
                                    disabled={!tpmStorage || passthroughLoading}
                                    className="px-4 py-2 bg-green-500 hover:bg-green-600 rounded disabled:opacity-50"
                                >
                                    {passthroughLoading ? t('adding') : t('add')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Sub-modals for disk/network operations
// Disk creation modal - handles both QEMU and LXC
// ZFS RAID level is set at pool creation, not per-disk. Type shown in selector.
function AddDiskModal({ isQemu, storageList, hardwareOptions, getNextDiskId, onAdd, onClose }) {
    const { isCorporate } = useLayout();
    const { t } = useTranslation();

    // Explicit format-per-storage matrix. PVE 9.1 added qcow2
    // support on LVM and LVM-thin (was raw-only before). ZFS/Ceph RBD remain
    // raw-only because they're block-level. We expose the format choice in the
    // UI rather than silently defaulting it (#user-feedback).
    const formatsForStorageType = (st) => {
        if (!st) return ['raw', 'qcow2'];
        switch (st) {
            case 'dir': case 'nfs': case 'cifs': case 'glusterfs':
                return ['qcow2', 'raw', 'vmdk'];
            case 'btrfs':
                return ['raw', 'qcow2'];
            case 'lvm': case 'lvmthin':
                // PVE 9.1+ added qcow2 on LVM(-thin) — list it first so it's the
                // default for snapshot-friendly setups.
                return ['qcow2', 'raw'];
            case 'zfspool': case 'zfs': case 'rbd': case 'iscsi': case 'iscsidirect':
                return ['raw'];
            default:
                return ['raw', 'qcow2'];
        }
    };
    const initialStorage = storageList[0]?.storage || 'local-lvm';
    const initialFmt = formatsForStorageType(storageList[0]?.type)[0] || 'raw';

    const [diskConfig, setDiskConfig] = useState({
        disk_id: 'scsi1',
        storage: initialStorage,
        format: initialFmt,
        size: 32,
        cache: '',
        iothread: true,
        ssd: false,
        discard: true,
    });

    // Get current bus type from disk_id (e.g. "scsi0" -> "scsi")
    const currentBus = diskConfig.disk_id.replace(/[0-9]/g, '');
    // Iothread needs virtio-scsi-pci controller, won't work with IDE/SATA
    const supportsIothread = ['scsi', 'virtio'].includes(currentBus);
    // Ssd emulation for TRIM support - IDE doesn't support it at all
    const supportsSsd = ['scsi', 'virtio', 'sata'].includes(currentBus);

    // Available formats for the currently-selected storage
    const selectedStorageEntry = storageList.find(s => s.storage === diskConfig.storage);
    const availableFormats = formatsForStorageType(selectedStorageEntry?.type);

    // When the user picks a different storage, snap the format to the first
    // valid choice for that storage type — but keep their existing pick if
    // it's still valid.
    useEffect(() => {
        if (!availableFormats.includes(diskConfig.format)) {
            setDiskConfig(prev => ({ ...prev, format: availableFormats[0] }));
        }
    }, [diskConfig.storage]);

    useEffect(() => {
        if (getNextDiskId) {
            setDiskConfig(prev => ({ ...prev, disk_id: getNextDiskId('scsi') }));
        }
    }, []);

    // Handle bus type change - reset unsupported options
    const handleBusChange = (newBus) => {
        const newId = getNextDiskId ? getNextDiskId(newBus) : newBus + '0';
        const busSupportsIothread = ['scsi', 'virtio'].includes(newBus);
        const busSupportsSsd = ['scsi', 'virtio', 'sata'].includes(newBus);
        setDiskConfig({
            ...diskConfig,
            disk_id: newId,
            iothread: busSupportsIothread ? diskConfig.iothread : false,
            ssd: busSupportsSsd ? diskConfig.ssd : false
        });
    };

    // Filter out unsupported options before sending to API
    const handleAdd = () => {
        const configToSend = {
            disk_id: diskConfig.disk_id,
            storage: diskConfig.storage,
            size: diskConfig.size,
            discard: diskConfig.discard,
            // Pass selected format through to PVE.
            format: diskConfig.format || availableFormats[0] || 'raw',
        };
        // Only add cache if set
        if (diskConfig.cache) {
            configToSend.cache = diskConfig.cache;
        }
        // Only add iothread for scsi/virtio
        if (supportsIothread && diskConfig.iothread) {
            configToSend.iothread = true;
        }
        // Only add ssd for scsi/virtio/sata
        if (supportsSsd && diskConfig.ssd) {
            configToSend.ssd = true;
        }
        onAdd(configToSend);
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
            <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-md bg-proxmox-card border border-proxmox-border rounded-xl p-6 animate-scale-in'}>
                <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white mb-4'}>{t('addDisk')}</h3>
                <div className="space-y-4">
                    {isQemu && hardwareOptions && (
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>Bus/Device</label>
                                <select
                                    value={currentBus}
                                    onChange={(e) => handleBusChange(e.target.value)} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'}
                                >
                                    {(hardwareOptions?.disk_bus_types || [{ value: 'scsi', label: 'SCSI' }]).map(bus => (
                                        <option key={bus.value} value={bus.value}>{bus.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>ID</label>
                                <input
                                    type="text"
                                    value={diskConfig.disk_id}
                                    onChange={(e) => setDiskConfig({ ...diskConfig, disk_id: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'}
                                />
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>Storage</label>
                            <select
                                value={diskConfig.storage}
                                onChange={(e) => setDiskConfig({ ...diskConfig, storage: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'}
                            >
                                {storageList.map(s => {
                                    const freeBytes = s.avail || s.free || 0;
                                    const totalBytes = s.total || 0;
                                    const usedPercent = totalBytes > 0 ? Math.round((1 - freeBytes / totalBytes) * 100) : 0;
                                    const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(1);
                                    const totalGB = (totalBytes / (1024 * 1024 * 1024)).toFixed(1);
                                    return (
                                        <option key={s.storage} value={s.storage}>
                                            {s.storage} ({freeGB} GB {t('free')} / {totalGB} GB - {usedPercent}% {t('used')})
                                        </option>
                                    );
                                })}
                            </select>
                            {/* Show selected storage details */}
                            {diskConfig.storage && storageList.length > 0 && (() => {
                                const selected = storageList.find(s => s.storage === diskConfig.storage);
                                if (!selected) return null;
                                const freeBytes = selected.avail || selected.free || 0;
                                const totalBytes = selected.total || 0;
                                const usedPercent = totalBytes > 0 ? Math.round((1 - freeBytes / totalBytes) * 100) : 0;
                                const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(1);
                                return (
                                    <div className="mt-2 p-2 bg-proxmox-darker rounded-lg">
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-gray-400">{t('freeSpace')}:</span>
                                            <span className={`font-medium ${freeBytes < diskConfig.size * 1024 * 1024 * 1024 ? 'text-red-400' : 'text-green-400'}`}>
                                                {freeGB} GB
                                            </span>
                                        </div>
                                        <div className="h-1.5 bg-proxmox-dark rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full transition-all ${usedPercent > 90 ? 'bg-red-500' : usedPercent > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                                style={{ width: `${usedPercent}%` }}
                                            />
                                        </div>
                                        {freeBytes < diskConfig.size * 1024 * 1024 * 1024 && diskConfig.size > 0 && (
                                            <p className="text-xs text-red-400 mt-1">⚠️ {t('notEnoughSpace')}</p>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('size')} (GB)</label>
                            <input
                                type="number"
                                value={diskConfig.size}
                                onChange={(e) => setDiskConfig({ ...diskConfig, size: parseInt(e.target.value) || 0 })}
                                min="1"
                                placeholder="32" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'}
                            />
                        </div>
                    </div>
                    {/* Explicit format selector. Defaults follow the
                                storage type (raw for ZFS/RBD, qcow2 for files / LVM since 9.1). */}
                    {isQemu && (
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>
                                {t('diskFormat')}
                                {selectedStorageEntry?.type && (
                                    <span className="ml-2 text-gray-500">({selectedStorageEntry.type})</span>
                                )}
                            </label>
                            <select
                                value={diskConfig.format}
                                onChange={(e) => setDiskConfig({ ...diskConfig, format: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'}
                            >
                                {availableFormats.map(f => (
                                    <option key={f} value={f}>
                                        {f === 'qcow2' ? 'qcow2 — supports snapshots, thin provisioning' :
                                            f === 'raw' ? 'raw — best performance, fixed size' :
                                                f === 'vmdk' ? 'vmdk — VMware compatibility' : f}
                                    </option>
                                ))}
                            </select>
                            {availableFormats.length === 1 && (
                                <p className={isCorporate ? 'corp-help-text' : 'text-xs text-gray-500 mt-1'}>
                                    {t('diskFormatLockedHint')}
                                </p>
                            )}
                        </div>
                    )}
                    {isQemu && hardwareOptions && (
                        <React.Fragment>
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>Cache</label>
                                <select
                                    value={diskConfig.cache}
                                    onChange={(e) => setDiskConfig({ ...diskConfig, cache: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'}
                                >
                                    {(hardwareOptions?.cache_modes || [{ value: '', label: 'Default' }]).map(c => (
                                        <option key={c.value} value={c.value}>{c.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex flex-wrap gap-4">
                                {/* IO Thread only for SCSI and VirtIO */}
                                {supportsIothread && (
                                    <label className={isCorporate ? 'corp-label' : 'flex items-center gap-2 text-sm text-gray-300'}>
                                        <input type="checkbox" checked={diskConfig.iothread} onChange={(e) => setDiskConfig({ ...diskConfig, iothread: e.target.checked })} className="rounded" />
                                        IO Thread
                                    </label>
                                )}
                                {/* SSD Emulation for SCSI, VirtIO, SATA (not IDE) */}
                                {supportsSsd && (
                                    <label className={isCorporate ? 'corp-label' : 'flex items-center gap-2 text-sm text-gray-300'}>
                                        <input type="checkbox" checked={diskConfig.ssd} onChange={(e) => setDiskConfig({ ...diskConfig, ssd: e.target.checked })} className="rounded" />
                                        SSD Emulation
                                    </label>
                                )}
                                <label className={isCorporate ? 'corp-label' : 'flex items-center gap-2 text-sm text-gray-300'}>
                                    <input type="checkbox" checked={diskConfig.discard} onChange={(e) => setDiskConfig({ ...diskConfig, discard: e.target.checked })} className="rounded" />
                                    Discard
                                </label>
                            </div>
                        </React.Fragment>
                    )}
                </div>
                <div className="flex justify-end gap-3 mt-6">
                    <button onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white">{t('cancel')}</button>
                    <button onClick={handleAdd} className="px-4 py-2 bg-proxmox-orange rounded-lg text-white hover:bg-orange-600">{t('add')}</button>
                </div>
            </div>
        </div>
    );
}

function ResizeDiskModal({ disk, onResize, onClose }) {
    const { isCorporate } = useLayout();
    const { t } = useTranslation();
    const [size, setSize] = useState('+10G');
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
            <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-sm bg-proxmox-card border border-proxmox-border rounded-xl p-6 animate-scale-in'}>
                <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white mb-4'}>{t('resizeDisk')}</h3>
                <p className="text-sm text-gray-400 mb-4">{t('currentSize')}: {disk.size}</p>
                <div>
                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('resizeDiskHint')}</label>
                    <input
                        type="text"
                        value={size}
                        onChange={(e) => setSize(e.target.value)} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'}
                    />
                </div>
                <div className="flex justify-end gap-3 mt-6">
                    <button onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white">{t('cancel')}</button>
                    <button onClick={() => onResize(size)} className="px-4 py-2 bg-green-600 rounded-lg text-white hover:bg-green-700">{t('resize')}</button>
                </div>
            </div>
        </div>
    );
}

// Modal for reattaching unused disks with bus type selection
// Makes it easier to reattach disks with correct settings
function ReattachDiskModal({ disk, getNextDiskId, onReattach, onClose }) {
    const { isCorporate } = useLayout();
    const { t } = useTranslation();
    const [busType, setBusType] = useState('scsi');
    const [diskId, setDiskId] = useState(getNextDiskId('scsi'));
    const [iothread, setIothread] = useState(true);
    const [ssd, setSsd] = useState(false);
    const [discard, setDiscard] = useState(true);
    const [loading, setLoading] = useState(false);

    // Update disk ID when bus type changes
    const handleBusChange = (newBus) => {
        setBusType(newBus);
        setDiskId(getNextDiskId(newBus));
        // Reset unsupported options
        if (!['scsi', 'virtio'].includes(newBus)) {
            setIothread(false);
        }
        if (!['scsi', 'virtio', 'sata'].includes(newBus)) {
            setSsd(false);
        }
    };

    // Check which options are supported
    const supportsIothread = ['scsi', 'virtio'].includes(busType);
    const supportsSsd = ['scsi', 'virtio', 'sata'].includes(busType);

    const busTypes = [
        { value: 'scsi', label: 'SCSI', desc: t('scsiDesc') },
        { value: 'virtio', label: 'VirtIO Block', desc: t('virtioDesc') },
        { value: 'sata', label: 'SATA', desc: t('sataDesc') },
        { value: 'ide', label: 'IDE', desc: t('ideDesc') },
    ];

    const handleReattach = async () => {
        if (loading) return;
        setLoading(true);

        // Build disk options string
        let options = [];
        if (supportsIothread && iothread) options.push('iothread=1');
        if (supportsSsd && ssd) options.push('ssd=1');
        if (discard) options.push('discard=on');

        const diskValue = options.length > 0
            ? `${disk.value},${options.join(',')}`
            : disk.value;

        try {
            await onReattach(diskId, diskValue);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
            <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-md bg-proxmox-card border border-proxmox-border rounded-xl p-6 animate-scale-in'}>
                <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white mb-2 flex items-center gap-2'}>
                    <Icons.HardDrive className="text-green-400" />
                    {t('reattachDisk2')}
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                    {t('volume')}: <span className="font-mono text-white">{disk.value}</span>
                </p>

                {/* Bus Type Selection */}
                <div className="mb-4">
                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-2'}>{t('selectBusType')}</label>
                    <div className="grid grid-cols-2 gap-2">
                        {busTypes.map(bus => (
                            <button
                                key={bus.value}
                                onClick={() => handleBusChange(bus.value)}
                                disabled={loading}
                                className={`p-3 rounded-lg text-left transition-all ${busType === bus.value
                                    ? 'bg-green-600/20 border border-green-500'
                                    : 'bg-proxmox-dark border border-proxmox-border hover:border-gray-500'
                                    }`}
                            >
                                <div className="font-medium text-white text-sm">{bus.label}</div>
                                <div className="text-xs text-gray-500 mt-0.5">{bus.desc}</div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Disk ID */}
                <div className="mb-4">
                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('diskId')}</label>
                    <input
                        type="text"
                        value={diskId}
                        onChange={(e) => setDiskId(e.target.value)}
                        disabled={loading} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm font-mono'}
                    />
                    <p className={isCorporate ? 'corp-help-text' : 'text-xs text-gray-500 mt-1'}>{t('nextAvailableId')}</p>
                </div>

                {/* Options */}
                <div className="mb-4 p-3 bg-proxmox-dark rounded-lg border border-proxmox-border">
                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-2'}>{t('diskOptions')}</label>
                    <div className="flex flex-wrap gap-4">
                        {supportsIothread && (
                            <label className={isCorporate ? 'corp-label' : 'flex items-center gap-2 text-sm text-gray-300 cursor-pointer'}>
                                <input
                                    type="checkbox"
                                    checked={iothread}
                                    onChange={(e) => setIothread(e.target.checked)}
                                    disabled={loading}
                                    className="rounded"
                                />
                                IO Thread
                            </label>
                        )}
                        {supportsSsd && (
                            <label className={isCorporate ? 'corp-label' : 'flex items-center gap-2 text-sm text-gray-300 cursor-pointer'}>
                                <input
                                    type="checkbox"
                                    checked={ssd}
                                    onChange={(e) => setSsd(e.target.checked)}
                                    disabled={loading}
                                    className="rounded"
                                />
                                SSD Emulation
                            </label>
                        )}
                        <label className={isCorporate ? 'corp-label' : 'flex items-center gap-2 text-sm text-gray-300 cursor-pointer'}>
                            <input
                                type="checkbox"
                                checked={discard}
                                onChange={(e) => setDiscard(e.target.checked)}
                                disabled={loading}
                                className="rounded"
                            />
                            Discard (TRIM)
                        </label>
                    </div>
                    {!supportsIothread && !supportsSsd && (
                        <p className="text-xs text-yellow-500 mt-2">
                            {t('ideLimitedOptions')}
                        </p>
                    )}
                </div>

                {/* Preview */}
                <div className="mb-4 p-3 bg-proxmox-dark/50 rounded-lg border border-dashed border-proxmox-border">
                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('preview')}</label>
                    <div className="flex items-center gap-2">
                        <span className="text-green-400 font-mono font-medium">{diskId}</span>
                        <Icons.ArrowRight className="w-4 h-4 text-gray-500" />
                        <span className="text-gray-300 font-mono text-sm truncate">{disk.value}</span>
                    </div>
                </div>

                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="px-4 py-2 text-gray-300 hover:text-white disabled:opacity-50"
                    >
                        {t('cancel')}
                    </button>
                    <button
                        onClick={handleReattach}
                        disabled={loading || !diskId}
                        className="px-4 py-2 bg-green-600 rounded-lg text-white hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                    >
                        {loading && <Icons.RotateCw className="w-4 h-4 animate-spin" />}
                        {loading ? (t('attaching')) : (t('reattach'))}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Simple modal for moving disks between storages
// Works with both local and shared storage
function MoveDiskModal({ disk, storageList, onMove, onClose }) {
    const { isCorporate } = useLayout();
    const { t } = useTranslation();
    const [storage, setStorage] = useState(storageList.filter(s => s.storage !== disk.storage)[0]?.storage || '');
    const [deleteSource, setDeleteSource] = useState(true);
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
            <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-sm bg-proxmox-card border border-proxmox-border rounded-xl p-6 animate-scale-in'}>
                <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white mb-4'}>{t('moveDisk')}</h3>
                <p className="text-sm text-gray-400 mb-4">{disk.id} - {t('from')} <span className="text-white font-mono">{disk.storage}</span></p>
                <div>
                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('targetStorage')}</label>
                    <select
                        value={storage}
                        onChange={(e) => setStorage(e.target.value)} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'}
                    >
                        {storageList.filter(s => s.storage !== disk.storage).map(s => (
                            <option key={s.storage} value={s.storage}>{s.storage}</option>
                        ))}
                    </select>
                </div>
                <div className="mt-4 flex items-center gap-3 p-3 bg-proxmox-dark rounded-lg border border-proxmox-border">
                    <Toggle checked={deleteSource} onChange={setDeleteSource} label={t('deleteSourceDisk')} />
                </div>
                {!deleteSource && (
                    <p className="mt-2 text-xs text-yellow-400/80">
                        {t('deleteSourceDiskWarning')}
                    </p>
                )}
                <div className="flex justify-end gap-3 mt-6">
                    <button onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white">{t('cancel')}</button>
                    <button onClick={() => onMove(storage, deleteSource)} className="px-4 py-2 bg-blue-600 rounded-lg text-white hover:bg-blue-700">{t('move')}</button>
                </div>
            </div>
        </div>
    );
}

// Edit Disk Bus Type Modal - allows changing disk from SCSI to IDE/SATA/VirtIO etc.
function EditDiskBusModal({ disk, hardwareOptions, vmStatus, onSave, onClose }) {
    const { isCorporate } = useLayout();
    const { t } = useTranslation();
    const currentBus = disk.id.replace(/[0-9]/g, '');
    const [newBus, setNewBus] = useState(currentBus);
    const [loading, setLoading] = useState(false);

    // Check if VM is running - bus type change requires VM to be stopped
    const isVmRunning = vmStatus === 'running';

    // Check which options will be stripped - use Boolean to avoid JSX rendering 0
    const hasIothread = Boolean(disk.iothread && disk.iothread > 0);
    const hasSsd = Boolean(disk.ssd && disk.ssd > 0);
    const willStripIothread = hasIothread && !['scsi', 'virtio'].includes(newBus);
    const willStripSsd = hasSsd && !['scsi', 'virtio', 'sata'].includes(newBus);

    const handleSave = async () => {
        if (loading || isVmRunning) return; // Prevent double-click and running VM
        setLoading(true);
        try {
            await onSave(newBus);
        } finally {
            setLoading(false);
        }
    };

    const busTypes = [
        { value: 'scsi', label: 'SCSI', desc: t('scsiDesc') },
        { value: 'virtio', label: 'VirtIO Block', desc: t('virtioDesc') },
        { value: 'sata', label: 'SATA', desc: t('sataDesc') },
        { value: 'ide', label: 'IDE', desc: t('ideDesc') },
    ];

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
            <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-md bg-proxmox-card border border-proxmox-border rounded-xl p-6 animate-scale-in'}>
                <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white mb-2 flex items-center gap-2'}>
                    <Icons.Edit className="text-yellow-400" />
                    {t('changeDiskBusType')}
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                    {t('currentDisk')}: <span className="font-mono text-white">{disk.id}</span> ({disk.size})
                    {disk.iothread && <span className="ml-2 text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">IOthread</span>}
                    {disk.ssd && <span className="ml-1 text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">SSD</span>}
                </p>

                {/* Error if VM is running */}
                {isVmRunning ? (
                    <div className="p-4 bg-red-500/20 border border-red-500/50 rounded-lg mb-4">
                        <div className="flex items-start gap-3">
                            <Icons.AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
                            <div>
                                <div className="font-medium text-red-400 mb-1">{t('vmIsRunning')}</div>
                                <p className="text-sm text-red-300">{t('vmMustBeStoppedForBusChange')}</p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-yellow-300 mb-4">
                        <div className="flex items-start gap-2">
                            <Icons.AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            <div>{t('diskBusWarning')}</div>
                        </div>
                    </div>
                )}

                {/* Show warning about stripped options */}
                {(willStripIothread || willStripSsd) && !isVmRunning && (
                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-300 mb-4">
                        <div className="flex items-start gap-2">
                            <Icons.Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            <div>
                                {t('optionsWillBeRemoved')}:
                                {willStripIothread && <span className="ml-2 font-mono bg-red-500/20 px-1.5 py-0.5 rounded">IO Thread</span>}
                                {willStripSsd && <span className="ml-2 font-mono bg-red-500/20 px-1.5 py-0.5 rounded">SSD</span>}
                            </div>
                        </div>
                    </div>
                )}

                <div className="space-y-2">
                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-2'}>{t('selectNewBusType')}</label>
                    {busTypes.map(bus => (
                        <label
                            key={bus.value}
                            className={`flex items-center p-3 rounded-lg cursor-pointer transition-all ${newBus === bus.value
                                ? 'bg-proxmox-orange/20 border border-proxmox-orange'
                                : 'bg-proxmox-dark border border-proxmox-border hover:border-gray-500'
                                } ${loading || isVmRunning ? 'opacity-50 pointer-events-none' : ''}`}
                        >
                            <input
                                type="radio"
                                name="busType"
                                value={bus.value}
                                checked={newBus === bus.value}
                                onChange={(e) => setNewBus(e.target.value)}
                                disabled={loading || isVmRunning}
                                className="mr-3"
                            />
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-white">{bus.label}</span>
                                    {currentBus === bus.value && (
                                        <span className="text-xs bg-gray-600 px-2 py-0.5 rounded">{t('current')}</span>
                                    )}
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">{bus.desc}</p>
                            </div>
                        </label>
                    ))}
                </div>

                <div className="flex justify-end gap-3 mt-6">
                    <button onClick={onClose} disabled={loading} className="px-4 py-2 text-gray-300 hover:text-white disabled:opacity-50">{t('cancel')}</button>
                    <button
                        onClick={handleSave}
                        disabled={newBus === currentBus || loading || isVmRunning}
                        className="px-4 py-2 bg-yellow-600 rounded-lg text-white hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {loading && <Icons.RotateCw className="w-4 h-4 animate-spin" />}
                        {isVmRunning ? (t('vmMustBeStopped3')) : loading ? (t('saving')) : (t('changeBusType'))}
                    </button>
                </div>
            </div>
        </div>
    );
}

function MountISOModal({ isoList, existingDrives, onMount, onClose, initialDrive }) {
    const { isCorporate } = useLayout();
    const { t } = useTranslation();
    const [iso, setIso] = useState('');
    // When invoked from a per-row "Change ISO" action, parse
    // initialDrive ('ide2', 'sata0', …) into bus type + slot so we land
    // directly on the existing CD-ROM instead of forcing the user to
    // re-pick everything. Falls back to ide2 (PVE convention) otherwise.
    const _parseInitial = (s) => {
        if (typeof s !== 'string') return null;
        const m = s.match(/^(ide|scsi|sata)(\d+)$/);
        if (!m) return null;
        return { type: m[1], num: m[2] };
    };
    const _parsed = _parseInitial(initialDrive);
    const [driveType, setDriveType] = useState(_parsed?.type || 'ide');
    const [driveNum, setDriveNum] = useState(_parsed?.num || '2');

    // calc which drives are already in use
    const usedDrives = existingDrives || [];

    // Available drive options
    const driveOptions = [
        { type: 'ide', nums: ['0', '1', '2', '3'], label: 'IDE' },
        { type: 'scsi', nums: ['0', '1', '2', '3', '4', '5'], label: 'SCSI' },
        { type: 'sata', nums: ['0', '1', '2', '3', '4', '5'], label: 'SATA' },
    ];

    const currentDrive = `${driveType}${driveNum}`;
    const currentDriveInfo = usedDrives.find(d => d.key === currentDrive);
    const isDriveUsedByDisk = currentDriveInfo && !currentDriveInfo.isCdrom;
    const isDriveCdrom = currentDriveInfo?.isCdrom;

    // Find first free or cdrom slot when changing drive type
    const findBestSlot = (type) => {
        const nums = driveOptions.find(o => o.type === type)?.nums || [];
        // First try to find existing CD-ROM
        for (const num of nums) {
            const drive = `${type}${num}`;
            const info = usedDrives.find(d => d.key === drive);
            if (info?.isCdrom) return num;
        }
        // Then find free slot
        for (const num of nums) {
            const drive = `${type}${num}`;
            const info = usedDrives.find(d => d.key === drive);
            if (!info) return num;
        }
        // Default to first
        return nums[0];
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
            <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-md bg-proxmox-card border border-proxmox-border rounded-xl p-6 animate-scale-in'}>
                <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white mb-4'}>{t('mountIso')}</h3>

                <div className="space-y-4">
                    {/* ISO Selection */}
                    <div>
                        <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('isoImage')}</label>
                        <select
                            value={iso}
                            onChange={(e) => setIso(e.target.value)} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'}
                        >
                            <option value="">-- {t('noIsoEject')} --</option>
                            {isoList.map(i => (
                                <option key={i.volid} value={i.volid}>{i.volid.split('/').pop()}</option>
                            ))}
                        </select>
                    </div>

                    {/* Drive Type Selection */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('busType')}</label>
                            <select
                                value={driveType}
                                onChange={(e) => {
                                    const newType = e.target.value;
                                    setDriveType(newType);
                                    setDriveNum(findBestSlot(newType));
                                }} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'}
                            >
                                {driveOptions.map(opt => (
                                    <option key={opt.type} value={opt.type}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('device')}</label>
                            <select
                                value={driveNum}
                                onChange={(e) => setDriveNum(e.target.value)} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'}
                            >
                                {driveOptions.find(o => o.type === driveType)?.nums.map(num => {
                                    const drive = `${driveType}${num}`;
                                    const info = usedDrives.find(d => d.key === drive);
                                    const isUsedByDisk = info && !info.isCdrom;
                                    const isCdrom = info?.isCdrom;

                                    let label = drive;
                                    if (isCdrom) label += ` (${t('cdrom')})`;
                                    else if (isUsedByDisk) label += ` (${t('hardDisk')})`;

                                    return (
                                        <option
                                            key={num}
                                            value={num}
                                            disabled={isUsedByDisk}
                                            style={isUsedByDisk ? { color: '#666' } : {}}
                                        >
                                            {label}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>
                    </div>

                    {/* Drive info */}
                    <div className="text-xs">
                        <span className="text-gray-500">{t('target')}: </span>
                        <span className="text-proxmox-orange font-mono">{currentDrive}</span>
                        {isDriveCdrom && (
                            <span className="text-green-500 ml-2">✓ {t('existingCdrom')}</span>
                        )}
                        {isDriveUsedByDisk && (
                            <span className="text-red-500 ml-2">✗ {t('hardDiskNotAvailable')}</span>
                        )}
                        {!currentDriveInfo && (
                            <span className="text-blue-400 ml-2">○ {t('freeSlot')}</span>
                        )}
                    </div>
                </div>

                <div className="flex justify-end gap-3 mt-6">
                    <button onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white">{t('cancel')}</button>
                    <button
                        onClick={() => onMount(iso || null, currentDrive)}
                        disabled={isDriveUsedByDisk}
                        className={`px-4 py-2 rounded-lg text-white ${isDriveUsedByDisk
                            ? 'bg-gray-600 cursor-not-allowed'
                            : 'bg-proxmox-orange hover:bg-orange-600'
                            }`}
                    >
                        {iso ? t('mount') : t('eject')}
                    </button>
                </div>
            </div>
        </div>
    );
}

function AddNetworkModal({ isQemu, bridgeList, hardwareOptions, getNextNetId, generateMAC, onAdd, onClose }) {
    const { isCorporate } = useLayout();
    const { t } = useTranslation();
    const [netConfig, setNetConfig] = useState({
        net_id: 'net1',
        bridge: bridgeList[0]?.iface || 'vmbr0',
        model: 'virtio',
        macaddr: '',
        firewall: true,
        tag: '',
        rate: '',
        mtu: '',
        queues: '',
        name: 'eth0',
        ip: 'dhcp',
        gw: '',
        ip6: '',
        gw6: '',
        hwaddr: '',
    });

    useEffect(() => {
        if (getNextNetId) {
            setNetConfig(prev => ({ ...prev, net_id: getNextNetId() }));
        }
    }, []);

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
            <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-lg bg-proxmox-card border border-proxmox-border rounded-xl p-6 animate-scale-in max-h-[80vh] overflow-y-auto'}>
                <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white mb-4'}>{t('addNetwork')}</h3>
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>Interface ID</label>
                            <input type="text" value={netConfig.net_id} onChange={(e) => setNetConfig({ ...netConfig, net_id: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'} />
                        </div>
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>Bridge / VNet</label>
                            <select value={netConfig.bridge} onChange={(e) => setNetConfig({ ...netConfig, bridge: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'}>
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
                                {/* Fallback if no bridges loaded */}
                                {bridgeList.length === 0 && <option value="vmbr0">vmbr0</option>}
                            </select>
                        </div>
                    </div>
                    {isQemu && hardwareOptions && (
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>Model</label>
                                <select value={netConfig.model} onChange={(e) => setNetConfig({ ...netConfig, model: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'}>
                                    {(hardwareOptions?.network_models || [{ value: 'virtio', label: 'VirtIO' }]).map(m => (<option key={m.value} value={m.value}>{m.label}</option>))}
                                </select>
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('macAddress')}</label>
                                <div className="flex gap-2">
                                    <input type="text" value={netConfig.macaddr} onChange={(e) => setNetConfig({ ...netConfig, macaddr: e.target.value })}
                                        placeholder="auto" className={isCorporate ? 'corp-input' : 'flex-1 px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm font-mono'} />
                                    <button onClick={() => setNetConfig({ ...netConfig, macaddr: generateMAC() })}
                                        className="px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-gray-400 hover:text-white text-sm">
                                        <Icons.RefreshCw />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {!isQemu && (
                        <>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>Interface Name</label>
                                    <input type="text" value={netConfig.name} onChange={(e) => setNetConfig({ ...netConfig, name: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'} />
                                </div>
                                <div>
                                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('macAddress')}</label>
                                    <div className="flex gap-2">
                                        <input type="text" value={netConfig.hwaddr} onChange={(e) => setNetConfig({ ...netConfig, hwaddr: e.target.value })}
                                            placeholder="auto" className={isCorporate ? 'corp-input' : 'flex-1 px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm font-mono'} />
                                        <button onClick={() => setNetConfig({ ...netConfig, hwaddr: generateMAC() })}
                                            className="px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-gray-400 hover:text-white">
                                            <Icons.RefreshCw />
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>IPv4</label>
                                    <input type="text" value={netConfig.ip} onChange={(e) => setNetConfig({ ...netConfig, ip: e.target.value })}
                                        placeholder="dhcp or 10.0.0.10/24" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'} />
                                </div>
                                <div>
                                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>Gateway</label>
                                    <input type="text" value={netConfig.gw} onChange={(e) => setNetConfig({ ...netConfig, gw: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'} />
                                </div>
                            </div>
                        </>
                    )}
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>VLAN Tag</label>
                            <input type="text" value={netConfig.tag} onChange={(e) => setNetConfig({ ...netConfig, tag: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'} />
                        </div>
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>Rate (MB/s)</label>
                            <input type="text" value={netConfig.rate} onChange={(e) => setNetConfig({ ...netConfig, rate: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'} />
                        </div>
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>MTU</label>
                            <input type="text" value={netConfig.mtu} onChange={(e) => setNetConfig({ ...netConfig, mtu: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'} />
                        </div>
                    </div>
                    <label className={isCorporate ? 'corp-label' : 'flex items-center gap-2 text-sm text-gray-300'}>
                        <input type="checkbox" checked={netConfig.firewall} onChange={(e) => setNetConfig({ ...netConfig, firewall: e.target.checked })} className="rounded" />
                        {t('enableFirewall')}
                    </label>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                    <button onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white">{t('cancel')}</button>
                    <button onClick={() => onAdd(netConfig)} className="px-4 py-2 bg-proxmox-orange rounded-lg text-white hover:bg-orange-600">{t('add')}</button>
                </div>
            </div>
        </div>
    );
}

function EditNetworkModal({ isQemu, network, bridgeList, hardwareOptions, generateMAC, onUpdate, onClose }) {
    const { isCorporate } = useLayout();
    const { t } = useTranslation();
    const [editConfig, setEditConfig] = useState({
        bridge: network.bridge || 'vmbr0',
        model: network.model || 'virtio',
        macaddr: network.macaddr || '',
        firewall: network.firewall || false,
        tag: network.tag || '',
        rate: network.rate || '',
        mtu: network.mtu || '',
        queues: network.queues || '',  // Multiqueue support
        link_down: network.link_down || false,  // Disconnect checkbox
        name: network.name || 'eth0',
        ip: network.ip || 'dhcp',
        gw: network.gw || '',
        hwaddr: network.hwaddr || '',
    });

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
            <div className={isCorporate ? 'corp-settings-card' : 'w-full max-w-lg bg-proxmox-card border border-proxmox-border rounded-xl p-6 animate-scale-in max-h-[80vh] overflow-y-auto'}>
                <h3 className={isCorporate ? 'corp-card-header' : 'text-lg font-semibold text-white mb-4'}>{t('editNetwork')}: {network.id}</h3>
                <div className="space-y-4">
                    {/* Disconnect Checkbox - prominent at top for QEMU */}
                    {isQemu && (
                        <div className={`p-3 rounded-lg border ${editConfig.link_down ? 'bg-red-500/10 border-red-500/30' : 'bg-proxmox-dark border-proxmox-border'}`}>
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={editConfig.link_down}
                                    onChange={(e) => setEditConfig({ ...editConfig, link_down: e.target.checked })}
                                    className="w-4 h-4 rounded"
                                />
                                <div>
                                    <span className={`text-sm font-medium ${editConfig.link_down ? 'text-red-400' : 'text-gray-300'}`}>
                                        {t('disconnectNetwork')}
                                    </span>
                                    <p className="text-xs text-gray-500">{t('disconnectNetworkHint')}</p>
                                </div>
                            </label>
                        </div>
                    )}

                    <div>
                        <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>Bridge / VNet</label>
                        <select value={editConfig.bridge} onChange={(e) => setEditConfig({ ...editConfig, bridge: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'}>
                            {/* Include current bridge if not in list (important for SDN VNets) */}
                            {editConfig.bridge && !bridgeList.find(b => b.iface === editConfig.bridge) && (
                                <option value={editConfig.bridge}>{editConfig.bridge} (current)</option>
                            )}
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
                            {/* Fallback if no bridges loaded */}
                            {bridgeList.length === 0 && <option value="vmbr0">vmbr0</option>}
                        </select>
                    </div>
                    {isQemu && hardwareOptions && (
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>Model</label>
                                <select value={editConfig.model} onChange={(e) => setEditConfig({ ...editConfig, model: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'}>
                                    {(hardwareOptions?.network_models || [{ value: 'virtio', label: 'VirtIO' }]).map(m => (<option key={m.value} value={m.value}>{m.label}</option>))}
                                </select>
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>{t('macAddress')}</label>
                                <div className="flex gap-2">
                                    <input type="text" value={editConfig.macaddr} onChange={(e) => setEditConfig({ ...editConfig, macaddr: e.target.value })} className={isCorporate ? 'corp-input' : 'flex-1 px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm font-mono'} />
                                    <button onClick={() => setEditConfig({ ...editConfig, macaddr: generateMAC() })}
                                        className="px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-gray-400 hover:text-white">
                                        <Icons.RefreshCw />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {!isQemu && (
                        <React.Fragment>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>Interface Name</label>
                                    <input type="text" value={editConfig.name} onChange={(e) => setEditConfig({ ...editConfig, name: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'} />
                                </div>
                                <div>
                                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>MAC</label>
                                    <div className="flex gap-2">
                                        <input type="text" value={editConfig.hwaddr} onChange={(e) => setEditConfig({ ...editConfig, hwaddr: e.target.value })} className={isCorporate ? 'corp-input' : 'flex-1 px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm font-mono'} />
                                        <button onClick={() => setEditConfig({ ...editConfig, hwaddr: generateMAC() })}
                                            className="px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-gray-400 hover:text-white">
                                            <Icons.RefreshCw />
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>IPv4</label>
                                    <input type="text" value={editConfig.ip} onChange={(e) => setEditConfig({ ...editConfig, ip: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'} />
                                </div>
                                <div>
                                    <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>Gateway</label>
                                    <input type="text" value={editConfig.gw} onChange={(e) => setEditConfig({ ...editConfig, gw: e.target.value })} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'} />
                                </div>
                            </div>
                        </React.Fragment>
                    )}

                    {/* Network Settings Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>VLAN Tag</label>
                            <input type="text" value={editConfig.tag} onChange={(e) => setEditConfig({ ...editConfig, tag: e.target.value })}
                                placeholder="z.B. 100" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'} />
                        </div>
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>MTU</label>
                            <input type="number" value={editConfig.mtu} onChange={(e) => setEditConfig({ ...editConfig, mtu: e.target.value })}
                                placeholder="1500" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'} />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>Rate Limit (MB/s)</label>
                            <input type="number" value={editConfig.rate} onChange={(e) => setEditConfig({ ...editConfig, rate: e.target.value })}
                                placeholder={t('unlimited')} className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'} />
                        </div>
                        {/* Multiqueue - only for QEMU with virtio */}
                        {isQemu && (
                            <div>
                                <label className={isCorporate ? 'corp-label' : 'block text-xs text-gray-400 mb-1'}>Multiqueue</label>
                                <input type="number" value={editConfig.queues} onChange={(e) => setEditConfig({ ...editConfig, queues: e.target.value })}
                                    placeholder="1"
                                    min="1" max="64" className={isCorporate ? 'corp-input' : 'w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm'} />
                                <p className={isCorporate ? 'corp-help-text' : 'text-xs text-gray-500 mt-1'}>{t('multiqueueHint2')}</p>
                            </div>
                        )}
                    </div>

                    <label className={isCorporate ? 'corp-label' : 'flex items-center gap-2 text-sm text-gray-300'}>
                        <input type="checkbox" checked={editConfig.firewall} onChange={(e) => setEditConfig({ ...editConfig, firewall: e.target.checked })} className="rounded" />
                        {t('enableFirewall')}
                    </label>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                    <button onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white">{t('cancel')}</button>
                    <button onClick={() => onUpdate(editConfig)} className="px-4 py-2 bg-proxmox-orange rounded-lg text-white hover:bg-orange-600">{t('save')}</button>
                </div>
            </div>
        </div>
    );
}
