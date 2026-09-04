/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        web/src/native_integrations.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Native Integrations JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
const INTEGRATION_SCHEMAS = {
    netapp_storage: [
        { key: 'default_consistency', label: 'Default consistency', type: 'select', options: ['crash', 'application_consistent'], required: true, default: 'crash' },
        { key: 'default_restore_method', label: 'Default restore method', type: 'select', options: ['sfsr', 'flexclone'], required: true, default: 'sfsr' },
        { key: 'snapshot_prefix', label: 'Snapshot prefix', type: 'text', required: true, default: 'NPP_' },
        { key: 'job_poll_interval_s', label: 'Poll interval (s)', type: 'number', required: true, min: 1, default: 3 },
        { key: 'job_poll_timeout_s', label: 'Poll timeout (s)', type: 'number', required: true, min: 1, default: 300 },
        { key: 'flexclone_mount_base', label: 'FlexClone mount base', type: 'text', required: true, default: '/mnt/ProxmoxVEx-clone', placeholder: '/mnt/ProxmoxVEx-clone' },
        { key: 'manifest_subdir', label: 'Manifest subdir', type: 'text', required: true, default: '.netapp-snapmanifest', placeholder: '.netapp-snapmanifest' },
        { key: 'san_volume_multiplier', label: 'SAN volume multiplier', type: 'number', step: '0.1', required: true, min: 0, default: 2.5 },
    ],
    docker_swarm: [
        { key: 'poll_interval', label: 'Poll interval (s)', type: 'number', required: true, min: 10, max: 300, default: 30 },
        {
            key: 'clusters', label: 'Clusters', type: 'array', required: true, default: [], fields: [
                { key: 'id', label: 'ID', type: 'text', required: true, default: 'prod', placeholder: 'prod' },
                { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Production' },
                {
                    key: 'hosts', label: 'Hosts', type: 'array', default: [], fields: [
                        { key: 'name', label: 'Name', type: 'text', placeholder: 'Manager-1' },
                        { key: 'host', label: 'Host / IP', type: 'text', required: true, placeholder: '192.168.1.10' },
                        { key: 'user', label: 'SSH user', type: 'text', required: true, default: 'root', placeholder: 'root' },
                        { key: 'key_file', label: 'Key file', type: 'text', placeholder: '/opt/ProxmoxVEx/plugins/docker_swarm/.ssh/id_ed25519' },
                        { key: 'password', label: 'Password', type: 'password' },
                    ]
                }
            ]
        }
    ],
    opnsense: [
        {
            key: 'opnsense_hosts', label: 'OPNsense hosts', type: 'array', required: true, default: [], fields: [
                { key: 'name', label: 'Name', type: 'text', required: true, default: 'NODOA', placeholder: 'NODOA' },
                { key: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://10.0.0.1' },
                { key: 'api_key', label: 'API key', type: 'text', required: true, placeholder: 'OPNsense API key' },
                { key: 'api_secret', label: 'API secret', type: 'password', required: true, placeholder: 'OPNsense API secret' },
                { key: 'verify_tls', label: 'Verify TLS', type: 'boolean', default: true },
                { key: 'ca_bundle_path', label: 'CA bundle path', type: 'text', placeholder: '/etc/ssl/certs/custom-ca.pem' },
            ]
        },
        { key: 'poll_interval', label: 'Poll interval (s)', type: 'number', required: true, min: 5, max: 3600, default: 30 },
        { key: 'read_only', label: 'Read only', type: 'boolean' },
        { key: 'cluster_mode', label: 'Cluster mode', type: 'select', options: ['auto', 'off', 'ha', 'cluster'], required: true, default: 'auto' },
    ],
    truenas: [
        {
            key: 'instances', label: 'TrueNAS instances', type: 'array', required: true, default: [], fields: [
                { key: 'id', label: 'ID', type: 'text', required: true, default: 'datos-64', placeholder: 'datos-64' },
                { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'TrueNAS Datos (.64)' },
                { key: 'client_id', label: 'Client ID', type: 'text', default: 'idkmanager' },
                { key: 'host', label: 'Host', type: 'text', required: true, placeholder: '10.0.0.64' },
                { key: 'port', label: 'Port', type: 'number', required: true, min: 1, max: 65535, default: 443 },
                { key: 'use_tls', label: 'Use TLS', type: 'boolean', default: true },
                { key: 'verify_tls', label: 'Verify TLS', type: 'boolean', default: true },
                { key: 'tls_server_name', label: 'TLS server name', type: 'text', placeholder: 'truenas.example.com' },
                { key: 'api_key_ro', label: 'API key (read-only)', type: 'password', placeholder: 'TrueNAS read-only API key' },
                { key: 'api_key_rw', label: 'API key (read-write)', type: 'password', placeholder: 'TrueNAS read-write API key' },
                { key: 'readonly', label: 'Readonly', type: 'boolean', default: true },
            ]
        },
        {
            key: 'poll', label: 'Polling intervals', type: 'group', fields: [
                { key: 'fast_s', label: 'Fast (s)', type: 'number', required: true, min: 1, default: 10 },
                { key: 'slow_s', label: 'Slow (s)', type: 'number', required: true, min: 1, default: 60 },
                { key: 'cold_s', label: 'Cold (s)', type: 'number', required: true, min: 1, default: 900 },
            ]
        }
    ],
    pfsense: [
        {
            key: 'pfsense_hosts', label: 'pfSense hosts', type: 'array', required: true, default: [], fields: [
                { key: 'name', label: 'Name', type: 'text', required: true, default: 'NODOA', placeholder: 'NODOA' },
                { key: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://10.0.0.1' },
                { key: 'api_key', label: 'API key', type: 'text', required: true, placeholder: 'pfSense API key' },
                { key: 'api_secret', label: 'API secret', type: 'password', required: true, placeholder: 'pfSense API secret' },
                { key: 'verify_tls', label: 'Verify TLS', type: 'boolean', default: true },
                { key: 'ca_bundle_path', label: 'CA bundle path', type: 'text', placeholder: '/etc/ssl/certs/custom-ca.pem' },
            ]
        },
        { key: 'poll_interval', label: 'Poll interval (s)', type: 'number', required: true, min: 5, max: 3600, default: 30 },
        { key: 'read_only', label: 'Read only', type: 'boolean' },
    ],
    proxmox_backup_server: [
        {
            key: 'pbs_hosts', label: 'Proxmox Backup Server hosts', type: 'array', required: true, default: [], fields: [
                { key: 'name', label: 'Name', type: 'text', required: true, default: 'pbs-01', placeholder: 'pbs-01' },
                { key: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://10.0.0.10:8007' },
                { key: 'api_token_id', label: 'API Token ID', type: 'text', required: true, placeholder: 'root@pam!tokenname' },
                { key: 'api_token_secret', label: 'API Token Secret', type: 'password', required: true, placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
                { key: 'verify_tls', label: 'Verify TLS', type: 'boolean', default: true },
            ]
        },
        { key: 'poll_interval', label: 'Poll interval (s)', type: 'number', required: true, min: 5, max: 3600, default: 30 },
        { key: 'read_only', label: 'Read only', type: 'boolean' },
    ],
    vmware_vcenter: [
        {
            key: 'vcenter_hosts', label: 'vCenter/ESXi hosts', type: 'array', required: true, default: [], fields: [
                { key: 'name', label: 'Name', type: 'text', required: true, default: 'vcenter-01', placeholder: 'vcenter-01' },
                { key: 'host', label: 'Host / IP', type: 'text', required: true, placeholder: 'vcenter.local' },
                { key: 'port', label: 'Port', type: 'number', required: true, min: 1, max: 65535, default: 443 },
                { key: 'username', label: 'Username', type: 'text', required: true, placeholder: 'administrator@vsphere.local' },
                { key: 'password', label: 'Password', type: 'password', required: true, placeholder: 'vSphere password' },
                { key: 'verify_ssl', label: 'Verify SSL', type: 'boolean', default: true },
            ]
        },
        { key: 'poll_interval', label: 'Poll interval (s)', type: 'number', required: true, min: 5, max: 3600, default: 60 },
        { key: 'read_only', label: 'Read only', type: 'boolean' },
    ],
    active_directory: [
        {
            key: 'ad_hosts', label: 'Active Directory servers', type: 'array', required: true, default: [], fields: [
                { key: 'name', label: 'Name', type: 'text', required: true, default: 'ad-01', placeholder: 'ad-01' },
                { key: 'server', label: 'Server', type: 'text', required: true, placeholder: 'ldaps://ad.local' },
                { key: 'port', label: 'Port', type: 'number', required: true, min: 1, max: 65535, default: 636 },
                { key: 'use_ssl', label: 'Use SSL (LDAPS)', type: 'boolean', default: true },
                { key: 'bind_dn', label: 'Bind DN', type: 'text', required: true, placeholder: 'cn=svc,dc=example,dc=com' },
                { key: 'bind_password', label: 'Bind password', type: 'password', required: true, placeholder: 'Bind password' },
                { key: 'base_dn', label: 'Base DN', type: 'text', required: true, placeholder: 'dc=example,dc=com' },
                { key: 'verify_tls', label: 'Verify TLS', type: 'boolean', default: true },
            ]
        },
        { key: 'poll_interval', label: 'Poll interval (s)', type: 'number', required: true, min: 5, max: 3600, default: 300 },
        { key: 'read_only', label: 'Read only', type: 'boolean' },
    ],
    zabbix: [
        {
            key: 'zabbix_hosts', label: 'Zabbix hosts', type: 'array', required: true, default: [], fields: [
                { key: 'name', label: 'Name', type: 'text', required: true, default: 'zabbix-01', placeholder: 'zabbix-01' },
                { key: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://zabbix.local' },
                { key: 'api_token', label: 'API token', type: 'password', required: true, placeholder: 'Zabbix API token' },
                { key: 'verify_tls', label: 'Verify TLS', type: 'boolean', default: true },
            ]
        },
        { key: 'poll_interval', label: 'Poll interval (s)', type: 'number', required: true, min: 5, max: 3600, default: 30 },
        { key: 'read_only', label: 'Read only', type: 'boolean' },
    ],
    vyos: [
        {
            key: 'vyos_hosts', label: 'VyOS hosts', type: 'array', required: true, default: [], fields: [
                { key: 'name', label: 'Name', type: 'text', required: true, default: 'vyos-01', placeholder: 'vyos-01' },
                { key: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://vyos.local' },
                { key: 'api_key', label: 'API key', type: 'password', required: true, placeholder: 'VyOS API key' },
                { key: 'verify_tls', label: 'Verify TLS', type: 'boolean', default: true },
            ]
        },
        { key: 'poll_interval', label: 'Poll interval (s)', type: 'number', required: true, min: 5, max: 3600, default: 30 },
        { key: 'read_only', label: 'Read only', type: 'boolean' },
    ],
};

// Category is used by the dashboard sidebar to group related integrations together.

// 004-sidebar-usability: canonical, data-driven ordering for integration categories.
// Any category not in this list is placed in an explicit 'Other' bucket at the end
// so new integrations never reorder the known groups unexpectedly.
const NATIVE_INTEGRATION_CATEGORIES = [
    'Hypervisors', 'Containers', 'Storage', 'Backup', 'Firewall', 'Network', 'Monitoring', 'Identity'
];
const NATIVE_INTEGRATION_OTHER = 'Other';

const NATIVE_INTEGRATION_LIST = [
    { id: 'docker_swarm', label: 'Docker Swarm', category: 'Containers', desc: 'Monitor and manage Docker hosts and Swarm clusters.', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/40', icon: Icons.Server },
    { id: 'netapp_storage', label: 'NetApp ONTAP', category: 'Storage', desc: 'Snapshot, restore and provision NetApp storage.', color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/40', icon: Icons.Database },
    { id: 'opnsense', label: 'OPNsense', category: 'Firewall', desc: 'Firewall rules, DHCP, NAT, VPN and more.', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/40', icon: Icons.Shield },

    { id: 'truenas', label: 'TrueNAS', category: 'Storage', desc: 'Pools, datasets, snapshots, shares and replication.', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/40', icon: Icons.HardDrive },
    { id: 'pfsense', label: 'pfSense', category: 'Firewall', desc: 'Firewall, VPN and routing with pfSense.', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/40', icon: Icons.Shield },
    { id: 'proxmox_backup_server', label: 'Proxmox Backup Server', category: 'Backup', desc: 'Manage Proxmox Backup Server repositories and jobs.', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/40', icon: Icons.Archive },
    { id: 'vmware_vcenter', label: 'VMware vCenter', category: 'Hypervisors', desc: 'Monitor and manage VMware vCenter and ESXi hosts.', color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/40', icon: Icons.Server },
    { id: 'active_directory', label: 'Active Directory', category: 'Identity', desc: 'Sync users and groups from Active Directory.', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/40', icon: Icons.Globe },
    { id: 'zabbix', label: 'Zabbix', category: 'Monitoring', desc: 'Monitor infrastructure metrics with Zabbix.', color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/40', icon: Icons.Activity },
    { id: 'vyos', label: 'VyOS', category: 'Network', desc: 'Configure VyOS routers and firewalls.', color: 'text-indigo-400', bg: 'bg-indigo-500/10', border: 'border-indigo-500/40', icon: Icons.Network },
];

function integrationSchema(moduleId) {
    return INTEGRATION_SCHEMAS[moduleId] || [];
}

function makeItem(fields) {
    const item = {};
    for (const f of fields) {
        if (f.default !== undefined) {
            item[f.key] = f.default;
        } else if (f.type === 'array' && f.fields) {
            item[f.key] = [];
        } else if (f.type === 'group' && f.fields) {
            item[f.key] = makeItem(f.fields);
        } else if (f.type === 'boolean') {
            item[f.key] = false;
        } else if (f.type === 'number') {
            item[f.key] = 0;
        } else {
            item[f.key] = '';
        }
    }
    return item;
}

function validateSchema(schema, values, pathPrefix) {
    const errors = [];
    for (const f of schema || []) {
        const fullPath = pathPrefix ? `${pathPrefix}.${f.key}` : f.key;
        const value = (values || {})[f.key];

        if (f.required) {
            const missing = value == null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);
            if (missing) {
                errors.push({ path: fullPath, message: `${f.label} is required` });
            }
        }

        if (f.type === 'number' && value != null && value !== '') {
            const n = Number(value);
            if (Number.isNaN(n)) {
                errors.push({ path: fullPath, message: `${f.label} must be a number` });
            } else {
                if (f.min != null && n < f.min) errors.push({ path: fullPath, message: `${f.label} must be at least ${f.min}` });
                if (f.max != null && n > f.max) errors.push({ path: fullPath, message: `${f.label} must be at most ${f.max}` });
            }
        }

        if (f.type === 'array' && f.fields && Array.isArray(value)) {
            value.forEach((item, idx) => {
                const nested = validateSchema(f.fields, item, `${fullPath}[${idx}]`);
                errors.push(...nested);
            });
        }

        if (f.type === 'group' && f.fields) {
            const nested = validateSchema(f.fields, value || {}, fullPath);
            errors.push(...nested);
        }
    }
    return errors;
}

function applyDefaults(fields, data) {
    const out = {};
    for (const f of fields || []) {
        let current = data && data[f.key];
        if (current === undefined && f.default !== undefined) {
            current = f.default;
        }
        if (f.type === 'group' && f.fields) {
            out[f.key] = applyDefaults(f.fields, current || {});
        } else if (f.type === 'array' && f.fields) {
            out[f.key] = (Array.isArray(current) ? current : []).map(item => applyDefaults(f.fields, item));
        } else {
            out[f.key] = current;
        }
    }
    for (const k in data || {}) {
        if (!(k in out)) out[k] = data[k];
    }
    return out;
}

function ArrayEditor({ field, items, onChange, isCorporate, path, errors, disabled }) {
    const selfError = errors && errors[path];
    const add = () => onChange([...(items || []), makeItem(field.fields)]);
    const remove = (idx) => {
        const next = [...(items || [])];
        next.splice(idx, 1);
        onChange(next);
    };
    const update = (idx, key, val) => {
        const next = [...(items || [])];
        next[idx] = { ...next[idx], [key]: val };
        onChange(next);
    };
    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <span className={isCorporate ? 'corp-label' : "text-sm font-medium text-gray-300"}>{field.label}</span>
                <button
                    onClick={add}
                    type="button"
                    disabled={disabled}
                    className={isCorporate ? 'corp-action-btn' : "p-1.5 text-gray-400 hover:text-proxmox-orange border border-proxmox-border rounded-lg disabled:opacity-50"}
                >
                    <Icons.Plus className="w-4 h-4" />
                </button>
            </div>
            {selfError && (
                <p className="text-xs text-theme-error">{selfError}</p>
            )}
            {(items || []).map((item, idx) => (
                <div key={idx} className={isCorporate ? 'corp-card' : "bg-proxmox-dark p-3 rounded-lg border border-proxmox-border"}>
                    <div className={isCorporate ? 'corp-card-body' : ''}>
                        <div className="flex justify-end mb-2">
                            <button onClick={() => remove(idx)} type="button" disabled={disabled} className={isCorporate ? 'corp-action-btn' : "text-gray-400 hover:text-red-400 disabled:opacity-50"}>
                                <Icons.Trash className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="space-y-3">
                            {field.fields.map(sub => (
                                <FormField
                                    key={sub.key}
                                    field={sub}
                                    value={item[sub.key]}
                                    onChange={v => update(idx, sub.key, v)}
                                    isCorporate={isCorporate}
                                    path={`${path}[${idx}].${sub.key}`}
                                    errors={errors}
                                    disabled={disabled}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            ))}
            {(items || []).length === 0 && (
                <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-500 italic"}>
                    No {field.label.toLowerCase()} configured. Click + to add one.
                </p>
            )}
        </div>
    );
}

function FormField({ field, value, onChange, isCorporate, path, errors, disabled }) {
    const error = errors && errors[path];
    const baseClass = isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm focus:outline-none focus:border-proxmox-orange transition-colors";
    const inputClass = baseClass + (error ? ' border-red-500' : '');
    const labelClass = isCorporate ? 'corp-label' : "block text-xs font-medium text-gray-400 mb-1";
    const errorClass = "text-xs text-theme-error mt-1";

    if (field.type === 'array' && field.fields) {
        return <ArrayEditor field={field} items={value || []} onChange={onChange} isCorporate={isCorporate} path={path} errors={errors} disabled={disabled} />;
    }

    if (field.type === 'group' && field.fields) {
        const v = value || {};
        return (
            <div className={isCorporate ? 'space-y-2' : "space-y-3"}>
                <span className={isCorporate ? 'corp-label' : "text-sm font-medium text-gray-300"}>{field.label}</span>
                <div className={isCorporate ? 'corp-card' : "bg-proxmox-dark p-3 rounded-lg border border-proxmox-border space-y-3"}>
                    <div className={isCorporate ? 'corp-card-body space-y-3' : ''}>
                        {field.fields.map(sub => (
                            <FormField
                                key={sub.key}
                                field={sub}
                                value={v[sub.key]}
                                onChange={sv => onChange({ ...v, [sub.key]: sv })}
                                isCorporate={isCorporate}
                                path={`${path}.${sub.key}`}
                                errors={errors}
                                disabled={disabled}
                            />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    if (field.type === 'boolean') {
        return (
            <div>
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={!!value}
                        onChange={e => onChange(e.target.checked)}
                        disabled={disabled}
                        className="w-4 h-4 rounded border-proxmox-border text-proxmox-orange focus:ring-proxmox-orange bg-proxmox-dark"
                    />
                    <span className={isCorporate ? 'corp-label' : "text-sm text-gray-300"}>{field.label}</span>
                </label>
                {error && <p className={errorClass}>{error}</p>}
            </div>
        );
    }

    if (field.type === 'select') {
        const options = field.options || [];
        const current = value != null ? value : (options[0] || '');
        return (
            <div>
                <label className={labelClass}>{field.label}</label>
                <select value={current} onChange={e => onChange(e.target.value)} disabled={disabled} className={inputClass}>
                    {options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                {error && <p className={errorClass}>{error}</p>}
            </div>
        );
    }

    if (field.type === 'number') {
        return (
            <div>
                <label className={labelClass}>{field.label}</label>
                <input
                    type="number"
                    step={field.step || 'any'}
                    placeholder={field.placeholder || ''}
                    value={value != null ? value : ''}
                    onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                    disabled={disabled}
                    className={inputClass}
                />
                {error && <p className={errorClass}>{error}</p>}
            </div>
        );
    }

    return (
        <div>
            <label className={labelClass}>{field.label}</label>
            <input
                type={field.type === 'password' ? 'password' : 'text'}
                placeholder={field.placeholder || ''}
                value={value != null ? value : ''}
                onChange={e => onChange(e.target.value)}
                disabled={disabled}
                className={inputClass}
            />
            {error && <p className={errorClass}>{error}</p>}
        </div>
    );
}

function AddIntegrationModal({ isOpen, onClose, addToast, initialModule = 'docker_swarm' }) {
    const { t } = useTranslation();
    const { isCorporate } = useLayout();
    const { getAuthHeaders } = useAuth();
    const authFetch = (url, opts = {}) => fetch(url, { ...opts, credentials: 'include', headers: { ...opts.headers, ...getAuthHeaders() } });
    const [active, setActive] = useState(initialModule);
    const [cfg, setCfg] = useState({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [fieldErrors, setFieldErrors] = useState({});
    const [showJson, setShowJson] = useState(false);
    const [original, setOriginal] = useState({});

    const modules = [
        { id: 'docker_swarm', label: 'Docker Swarm', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/40' },
        { id: 'netapp_storage', label: 'NetApp ONTAP', color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/40' },
        { id: 'opnsense', label: 'OPNsense', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/40' },
        { id: 'truenas', label: 'TrueNAS', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/40' },
        { id: 'pfsense', label: 'pfSense', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/40' },
        { id: 'proxmox_backup_server', label: 'Proxmox Backup Server', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/40' },
        { id: 'vmware_vcenter', label: 'VMware vCenter', color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/40' },
        { id: 'active_directory', label: 'Active Directory', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/40' },
        { id: 'zabbix', label: 'Zabbix', color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/40' },
        { id: 'vyos', label: 'VyOS', color: 'text-indigo-400', bg: 'bg-indigo-500/10', border: 'border-indigo-500/40' },
    ];

    React.useEffect(() => {
        if (isOpen) {
            setActive(initialModule);
        }
    }, [isOpen, initialModule]);

    React.useEffect(() => {
        if (!isOpen) return;
        setLoading(true);
        setError(null);
        setFieldErrors({});
        setCfg({});
        authFetch(`${API_URL}/native/${active}/config`)
            .then(r => r.json())
            .then(data => {
                const base = applyDefaults(schema, data || {});
                setOriginal(base);
                setCfg(base);
                setFieldErrors({});
                setLoading(false);
            })
            .catch(e => {
                setError('Failed to load existing config');
                setFieldErrors({});
                setOriginal({});
                setCfg({});
                setLoading(false);
            });
    }, [isOpen, active]);

    const schema = integrationSchema(active);

    const hasChanges = JSON.stringify(original) !== JSON.stringify(cfg);

    const handleClose = () => {
        if (hasChanges && !window.confirm('You have unsaved changes. Are you sure you want to close?')) {
            return;
        }
        onClose();
    };

    const handleReset = () => {
        setCfg(original);
        setError(null);
        setFieldErrors({});
    };

    const handleSave = async () => {
        setLoading(true);
        setError(null);
        const validation = validateSchema(schema, cfg);
        if (validation.length) {
            const map = {};
            for (const v of validation) map[v.path] = v.message;
            setFieldErrors(map);
            setShowJson(false);
            setError('Please fix the highlighted fields before saving.');
            setLoading(false);
            return;
        }
        try {
            const r = await authFetch(`${API_URL}/native/${active}/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cfg)
            });
            const data = await r.json();
            if (!r.ok || data.error) throw new Error(data.error || 'Save failed');
            if (addToast) addToast(`Integration saved successfully`, 'success');
            setOriginal(cfg);
            onClose();
        } catch (e) {
            setError(e.message);
        }
        setLoading(false);
    };

    React.useEffect(() => {
        if (!isOpen) return;
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                handleClose();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen, handleClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop bg-black/60" onClick={handleClose}>
            <div
                className={isCorporate ? 'w-full max-w-3xl corp-settings-card overflow-hidden max-h-[90vh] flex flex-col' : "w-full max-w-3xl bg-proxmox-card border border-proxmox-border rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"}
                onClick={e => e.stopPropagation()}
            >
                <div className={isCorporate ? 'corp-card-header' : "p-6 border-b border-proxmox-border"}>
                    <h2 className={isCorporate ? 'corp-modal-title' : "text-xl font-bold text-white"}>{t('configureIntegration')}</h2>
                    <div className={isCorporate ? 'corp-tab-strip flex-wrap' : "flex gap-2 mt-3 flex-wrap"}>
                        {modules.map(m => (
                            <button
                                key={m.id}
                                onClick={() => setActive(m.id)}
                                className={isCorporate ? (active === m.id ? 'active' : '') : `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${active === m.id
                                    ? `${m.bg} ${m.color} ${m.border}`
                                    : 'bg-proxmox-dark text-gray-500 border-transparent hover:text-gray-300 hover:border-proxmox-border'
                                    }`}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="p-6 flex-1 overflow-y-auto space-y-4">
                    {error && (
                        <div className="p-3 bg-theme-error/10 border border-theme-error/30 rounded-lg text-theme-error text-sm">
                            {error}
                        </div>
                    )}
                    {loading ? (
                        <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>Loading configuration…</p>
                    ) : schema.length > 0 ? (
                        <div className="space-y-4">
                            <div className="flex justify-end">
                                <button
                                    onClick={() => setShowJson(s => !s)}
                                    type="button"
                                    className={isCorporate ? 'corp-action-btn' : "text-xs text-gray-400 hover:text-white underline"}
                                >
                                    {showJson ? 'Form' : 'JSON'}
                                </button>
                            </div>
                            {showJson ? (
                                <textarea
                                    readOnly
                                    value={JSON.stringify(cfg, null, 2)}
                                    rows={18}
                                    disabled={loading}
                                    className={isCorporate ? 'corp-input resize-none' : "w-full px-4 py-3 bg-proxmox-dark border border-proxmox-border rounded-lg text-white font-mono text-sm focus:outline-none focus:border-proxmox-orange transition-colors resize-none"}
                                />
                            ) : (
                                <div className="space-y-5">
                                    {schema.map(f => (
                                        <FormField
                                            key={f.key}
                                            field={f}
                                            value={cfg[f.key]}
                                            onChange={v => {
                                                setCfg(prev => ({ ...prev, [f.key]: v }));
                                                setError(null);
                                                setFieldErrors({});
                                            }}
                                            isCorporate={isCorporate}
                                            path={f.key}
                                            errors={fieldErrors}
                                            disabled={loading}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>No configuration form available for this integration.</p>
                    )}
                </div>

                <div className="p-6 border-t border-proxmox-border flex justify-end gap-3">
                    <button
                        onClick={handleReset}
                        disabled={loading || !hasChanges}
                        className="px-4 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-gray-300 hover:text-white transition-colors disabled:opacity-50"
                    >
                        {t('reset')}
                    </button>
                    <button
                        onClick={handleClose}
                        disabled={loading}
                        className="px-4 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-gray-300 hover:text-white transition-colors"
                    >
                        {t('cancel')}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-white font-medium flex items-center gap-2"
                    >
                        {loading && <Icons.RotateCw className="w-4 h-4 animate-spin" />}
                        {t('save')}
                    </button>
                </div>
            </div>
        </div>
    );
}

function NativeIntegrationsPanel({ isOpen, onClose, addToast }) {
    const { t, language } = useTranslation();
    const { isCorporate } = useLayout();
    const [active, setActive] = useState('docker_swarm');
    const [configuring, setConfiguring] = useState(null);
    const [loadError, setLoadError] = useState(null);

    const integrations = [
        { id: 'docker_swarm', label: 'Docker Swarm', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/40', icon: Icons.Server },
        { id: 'netapp_storage', label: 'NetApp ONTAP', color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/40', icon: Icons.Database },
        { id: 'opnsense', label: 'OPNsense', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/40', icon: Icons.Shield },
        { id: 'truenas', label: 'TrueNAS', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/40', icon: Icons.HardDrive },
        { id: 'pfsense', label: 'pfSense', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/40', icon: Icons.Shield },
        { id: 'proxmox_backup_server', label: 'Proxmox Backup Server', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/40', icon: Icons.Archive },
        { id: 'vmware_vcenter', label: 'VMware vCenter', color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/40', icon: Icons.Server },
        { id: 'active_directory', label: 'Active Directory', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/40', icon: Icons.Globe },
        { id: 'zabbix', label: 'Zabbix', color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/40', icon: Icons.Activity },
        { id: 'vyos', label: 'VyOS', color: 'text-indigo-400', bg: 'bg-indigo-500/10', border: 'border-indigo-500/40', icon: Icons.Network },
    ];

    React.useEffect(() => {
        if (isOpen) setLoadError(null);
    }, [isOpen, active]);

    const activeIntegration = integrations.find(i => i.id === active) || integrations[0];
    const lang = language || document.documentElement.lang || 'en';
    const uiUrl = `${API_URL}/${activeIntegration.id}/ui?lang=${encodeURIComponent(lang)}`;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col" onClick={onClose}>
            <div className={isCorporate ? 'flex-1 flex flex-col corp-settings-card m-4 overflow-hidden shadow-2xl' : "flex-1 flex flex-col bg-proxmox-darker m-4 rounded-2xl border border-proxmox-border overflow-hidden shadow-2xl"} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className={isCorporate ? 'corp-card-header flex items-center justify-between' : "flex items-center justify-between p-4 border-b border-proxmox-border bg-proxmox-card"}>
                    <div className="flex items-center gap-3">
                        <Icons.Plug className="w-5 h-5 text-proxmox-orange" />
                        <h2 className={isCorporate ? '' : "text-lg font-bold text-white"}>{t('nativeIntegrations')}</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setConfiguring(activeIntegration.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-proxmox-dark border border-proxmox-border hover:border-proxmox-orange rounded-lg text-gray-300 hover:text-white transition-colors"
                        >
                            <Icons.Settings className="w-3.5 h-3.5" />
                            {t('configure')}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 text-gray-400 hover:text-white hover:bg-proxmox-hover rounded-lg transition-colors"
                        >
                            <Icons.X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className={isCorporate ? 'corp-tab-strip' : "flex border-b border-proxmox-border bg-proxmox-dark overflow-x-auto"}>
                    {integrations.map(integration => {
                        const Icon = integration.icon;
                        return (
                            <button
                                key={integration.id}
                                onClick={() => setActive(integration.id)}
                                className={isCorporate ? (active === integration.id ? 'active' : '') : `flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${active === integration.id
                                    ? `${integration.color} ${integration.bg}`
                                    : 'text-gray-400 border-transparent hover:text-white hover:bg-proxmox-hover'
                                    }`}
                                style={!isCorporate && active === integration.id ? { borderBottomColor: 'currentColor' } : undefined}
                            >
                                <Icon className="w-4 h-4" />
                                {integration.label}
                            </button>
                        );
                    })}
                </div>

                {/* Integration UI iframe */}
                <div className="flex-1 relative bg-proxmox-darker overflow-hidden">
                    {loadError && (
                        <div className="absolute inset-0 flex items-center justify-center p-6">
                            <div className="text-center max-w-lg">
                                <p className="text-red-400 font-medium mb-2">{loadError}</p>
                                <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>
                                    The integration UI could not be loaded. Make sure the integration is configured and the backend is running.
                                </p>
                            </div>
                        </div>
                    )}
                    <iframe
                        key={uiUrl}
                        src={uiUrl}
                        title={activeIntegration.label}
                        className="w-full h-full border-0"
                        sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-modals allow-downloads"
                        onError={() => setLoadError('Failed to load integration UI')}
                        onLoad={e => { if (window.ProxmoxVExSyncPluginIframe) window.ProxmoxVExSyncPluginIframe(e.target); }}
                    />
                </div>
            </div>

            {configuring && (
                <AddIntegrationModal
                    isOpen={!!configuring}
                    onClose={() => setConfiguring(null)}
                    addToast={addToast}
                    initialModule={configuring}
                />
            )}
        </div>
    );
}

// Inline main-view renderer for a single native integration.  This is used by
// the dashboard's main content area when an integration is selected from the
// new Integrations sidebar category.
function IntegrationMainView({ moduleId, onConfigure, addToast }) {
    const { t, language } = useTranslation();
    const { isCorporate } = useLayout();
    const [loadError, setLoadError] = useState(null);

    const activeIntegration = NATIVE_INTEGRATION_LIST.find(i => i.id === moduleId) || NATIVE_INTEGRATION_LIST[0];
    const lang = (typeof language !== 'undefined' ? language : null) || document.documentElement.lang || 'en';
    const uiUrl = `${API_URL}/${moduleId}/ui?lang=${encodeURIComponent(lang)}`;
    const Icon = activeIntegration.icon;

    return (
        <div className="flex flex-col h-full">
            <div className={isCorporate ? 'corp-card-header flex items-center justify-between' : "flex items-center justify-between p-4 border-b border-proxmox-border bg-proxmox-card"}>
                <div className="flex items-center gap-3">
                    <Icon className={`w-5 h-5 ${activeIntegration.color}`} />
                    <h2 className={isCorporate ? 'corp-modal-title' : "text-xl font-bold text-white"}>{activeIntegration.label}</h2>
                </div>
                {onConfigure && (
                    <button
                        onClick={() => onConfigure(moduleId)}
                        className={isCorporate ? 'corp-btn-secondary' : "flex items-center gap-2 px-3 py-1.5 text-sm bg-proxmox-dark border border-proxmox-border hover:border-proxmox-orange rounded-lg text-gray-300 hover:text-white transition-colors"}
                    >
                        <Icons.Settings className="w-3.5 h-3.5" />
                        {t('configure')}
                    </button>
                )}
            </div>
            <div className="flex-1 relative bg-proxmox-darker overflow-hidden">
                {loadError && (
                    <div className="absolute inset-0 flex items-center justify-center p-6">
                        <div className="text-center max-w-lg">
                            <p className="text-red-400 font-medium mb-2">{loadError}</p>
                            <p className={isCorporate ? 'corp-help-text' : "text-sm text-gray-400"}>
                                {t('integrationLoadError') || 'The integration UI could not be loaded. Make sure the integration is configured and the backend is running.'}
                            </p>
                        </div>
                    </div>
                )}
                <iframe
                    key={uiUrl}
                    src={uiUrl}
                    title={activeIntegration.label}
                    className="w-full h-full border-0"
                    sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-modals allow-downloads"
                    onError={() => setLoadError('Failed to load integration UI')}
                    onLoad={e => { setLoadError(null); if (window.ProxmoxVExSyncPluginIframe) window.ProxmoxVExSyncPluginIframe(e.target); }}
                />
            </div>
        </div>
    );
}
