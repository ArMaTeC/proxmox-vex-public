/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        web/src/security.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Security JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
const currentRoleMatrixTheme = () => document.documentElement?.getAttribute('data-theme') || 'proxmoxDark';

// TagManagementContextMenu: a right-click context menu for tag actions.
// 832-context-menu-for-tag-management: lets operators edit, delete, or merge tags from the tag list.
function TagManagementContextMenu({ items, onSelect, targetRef }) {
    const [open, setOpen] = React.useState(false);
    const [pos, setPos] = React.useState({ x: 0, y: 0 });

    React.useEffect(() => {
        const el = targetRef ? targetRef.current : null;
        if (!el) return;
        const onContextMenu = (e) => {
            e.preventDefault();
            setPos({ x: e.clientX, y: e.clientY });
            setOpen(true);
        };
        const onClick = () => setOpen(false);
        el.addEventListener('contextmenu', onContextMenu);
        window.addEventListener('click', onClick);
        return () => {
            el.removeEventListener('contextmenu', onContextMenu);
            window.removeEventListener('click', onClick);
        };
    }, [targetRef]);

    if (!open) return null;
    return (
        <ul
            className="fixed z-50 w-40 py-1 rounded border border-proxmox-border bg-proxmox-dark shadow-lg"
            style={{ left: pos.x, top: pos.y }}
            data-testid="tag-management-context-menu"
        >
            {(items || []).map((item) => (
                <li key={item.id}>
                    <button
                        onClick={() => { onSelect && onSelect(item.id); setOpen(false); }}
                        className="w-full text-left px-3 py-1.5 text-sm text-proxmox-text hover:bg-proxmox-hover"
                    >
                        {item.label}
                    </button>
                </li>
            ))}
        </ul>
    );
}

// TagManagementRecentItems: shows a short list of recently used tags for quick reuse.
// 833-recent-items-for-tag-management: lets operators pick from recently applied tags.
function TagManagementRecentItems({ items, onSelect }) {
    return (
        <div className="p-2 border border-proxmox-border rounded bg-proxmox-dark" data-testid="tag-management-recent-items">
            <div className="text-xs font-medium text-proxmox-text mb-2">Recent Tags</div>
            <div className="flex flex-wrap gap-1">
                {(items || []).slice(0, 10).map((item) => (
                    <button
                        key={item.id}
                        onClick={() => onSelect && onSelect(item)}
                        className="text-xs px-2 py-1 rounded border border-proxmox-border text-proxmox-text hover:bg-proxmox-hover"
                    >
                        {item.name}
                    </button>
                ))}
            </div>
        </div>
    );
}

// TagManagementUndoAction: a transient undo control for the last tag action.
// 834-undo-action-for-tag-management: lets operators revert the most recent tag operation.
function TagManagementUndoAction({ action, onUndo, onDismiss }) {
    const [visible, setVisible] = React.useState(true);
    if (!action || !visible) return null;
    return (
        <div className="p-2 mb-2 rounded border border-proxmox-border bg-proxmox-dark text-proxmox-text" data-testid="tag-management-undo-action">
            <span className="text-sm">{action.description}</span>
            <div className="mt-2 flex gap-2">
                <button
                    onClick={() => { onUndo && onUndo(action); setVisible(false); }}
                    className="text-xs px-2 py-1 rounded bg-proxmox-orange text-white hover:bg-orange-600"
                >
                    Undo
                </button>
                <button
                    onClick={() => { onDismiss && onDismiss(action); setVisible(false); }}
                    className="text-xs px-2 py-1 rounded border border-proxmox-border text-proxmox-text hover:bg-proxmox-hover"
                >
                    Dismiss
                </button>
            </div>
        </div>
    );
}

// TagManagementQuickFilter: fast text filter for tag lists.
// 835-quick-filter-for-tag-management: lets operators narrow tags by typing a keyword.
function TagManagementQuickFilter({ value, onChange, placeholder }) {
    return (
        <div className="mb-2" data-testid="tag-management-quick-filter">
            <input
                type="text"
                value={value || ''}
                onChange={(e) => onChange && onChange(e.target.value)}
                placeholder={placeholder || 'Filter tags...'}
                className="w-full px-3 py-1.5 rounded border border-proxmox-border bg-proxmox-dark text-proxmox-text text-sm focus:outline-none focus:border-proxmox-orange"
            />
        </div>
    );
}

// TagManagementOneClickApply: bulk apply a tag to selected resources with one click.
// 836-one-click-apply-for-tag-management: lets operators apply a tag to multiple resources without extra confirmation.
function TagManagementOneClickApply({ tag, count, onApply, busy }) {
    return (
        <div className="p-2 mb-2 border border-proxmox-border rounded bg-proxmox-dark" data-testid="tag-management-one-click-apply">
            <div className="text-sm text-proxmox-text mb-1">
                Apply <strong className="text-proxmox-orange">{tag}</strong> to {count} selected resources.
            </div>
            <button
                onClick={() => onApply && onApply(tag)}
                disabled={!!busy}
                className="text-xs px-3 py-1 rounded bg-proxmox-orange text-white hover:bg-orange-600 disabled:opacity-50"
            >
                {busy ? 'Applying...' : 'Apply Now'}
            </button>
        </div>
    );
}

// TagManagementSmartDefaults: pre-selects the most likely default tags for a resource.
// 837-smart-defaults-for-tag-management: suggests common tags to reduce manual selection.
function TagManagementSmartDefaults({ defaults, onSelect }) {
    return (
        <div className="p-2 border border-proxmox-border rounded bg-proxmox-dark" data-testid="tag-management-smart-defaults">
            <div className="text-xs font-medium text-proxmox-text mb-2">Suggested Tags</div>
            <div className="flex flex-wrap gap-1">
                {(defaults || []).map((tag) => (
                    <button
                        key={tag}
                        onClick={() => onSelect && onSelect(tag)}
                        className="text-xs px-2 py-1 rounded border border-proxmox-border text-proxmox-text hover:bg-proxmox-hover"
                    >
                        {tag}
                    </button>
                ))}
            </div>
        </div>
    );
}

// TagManagementLivePreview: shows a read-only preview of how the selected tags will look before applying.
// 838-live-preview-for-tag-management: lets operators review tag impact in real time.
function TagManagementLivePreview({ tags }) {
    return (
        <div className="p-2 border border-proxmox-border rounded bg-proxmox-dark" data-testid="tag-management-live-preview">
            <div className="text-xs font-medium text-proxmox-text mb-2">Live Preview</div>
            <div className="text-sm text-proxmox-text break-words">
                {(tags || []).length ? tags.join(', ') : 'No tags selected.'}
            </div>
        </div>
    );
}

// TagManagementCompareView: side-by-side tag comparison of two resources.
// 839-compare-view-for-tag-management: lets operators compare tags across resources.
function TagManagementCompareView({ left, right }) {
    const leftTags = (left && left.tags) || [];
    const rightTags = (right && right.tags) || [];
    const onlyLeft = leftTags.filter((t) => !rightTags.includes(t));
    const onlyRight = rightTags.filter((t) => !leftTags.includes(t));
    const both = leftTags.filter((t) => rightTags.includes(t));
    return (
        <div className="grid grid-cols-2 gap-2 p-2 border border-proxmox-border rounded bg-proxmox-dark" data-testid="tag-management-compare-view">
            <div className="text-sm font-medium text-proxmox-text">{left ? left.name : 'Left'}</div>
            <div className="text-sm font-medium text-proxmox-text">{right ? right.name : 'Right'}</div>
            <div className="text-xs text-proxmox-text">
                <div className="text-green-500 mb-1">Only here: {onlyLeft.length}</div>
                <div className="text-red-400">Shared: {both.length}</div>
            </div>
            <div className="text-xs text-proxmox-text">
                <div className="text-red-400 mb-1">Only here: {onlyRight.length}</div>
                <div className="text-green-500">Shared: {both.length}</div>
            </div>
        </div>
    );
}

function SecuritySettingsSection({ addToast }) {
    const { t } = useTranslation();
    const { getAuthHeaders, isAdmin } = useAuth();
    const { isCorporate } = useLayout();
    const [settings, setSettings] = useState({
        login_max_attempts: 5,
        login_lockout_time: 300,
        login_attempt_window: 600,
        password_min_length: 8,
        password_require_uppercase: true,
        password_require_lowercase: true,
        password_require_numbers: true,
        password_require_special: false,
        session_timeout: 86400,  // Frontend says 86400 but backend default is 28800 (the server wins)
        // Password expiry
        password_expiry_enabled: false,
        password_expiry_days: 90,
        password_expiry_warning_days: 14,
        password_expiry_email_enabled: true,
        password_expiry_include_admins: false,  // Opt-in for admins
        // Force 2FA
        force_2fa: false,
        force_2fa_exclude_admins: false,
        // 2026-04-24 - strict session IP binding (audit
        strict_session_ip: false,
    });
    const [lockedIps, setLockedIps] = useState([]);
    const [lockedUsers, setLockedUsers] = useState([]);  // Username lockout support
    const [loading, setLoading] = useState(true);
    const [resetAllLoading, setResetAllLoading] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [includeAdmins, setIncludeAdmins] = useState(false);
    const [killAllLoading, setKillAllLoading] = useState(false);
    const [showKillAllConfirm, setShowKillAllConfirm] = useState(false);

    useEffect(() => {
        fetchSettings();
        fetchLockedIps();
    }, []);

    const fetchSettings = async () => {
        try {
            const res = await fetch(`${API_URL}/settings/server`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const data = await res.json();
                setSettings(prev => ({
                    ...prev,
                    login_max_attempts: data.login_max_attempts || 5,
                    login_lockout_time: data.login_lockout_time || 300,
                    login_attempt_window: data.login_attempt_window || 600,
                    password_min_length: data.password_min_length || 8,
                    password_require_uppercase: data.password_require_uppercase !== false,
                    password_require_lowercase: data.password_require_lowercase !== false,
                    password_require_numbers: data.password_require_numbers !== false,
                    password_require_special: data.password_require_special || false,
                    session_timeout: data.session_timeout || 86400,
                    // Password expiry
                    password_expiry_enabled: data.password_expiry_enabled || false,
                    password_expiry_days: data.password_expiry_days || 90,
                    password_expiry_warning_days: data.password_expiry_warning_days || 14,
                    password_expiry_email_enabled: data.password_expiry_email_enabled !== false,
                    password_expiry_include_admins: data.password_expiry_include_admins || false,
                    force_2fa: data.force_2fa || false,
                    force_2fa_exclude_admins: data.force_2fa_exclude_admins || false,
                    strict_session_ip: data.strict_session_ip || false,
                }));
            }
        } catch (e) {
            console.error('to fetch security settings:', e);
        } finally {
            setLoading(false);
        }
    };

    const fetchLockedIps = async () => {
        try {
            const res = await fetch(`${API_URL}/security/locked-ips`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const data = await res.json();
                setLockedIps(data.locked_ips || []);
                setLockedUsers(data.locked_users || []);  // Also get locked users
            }
        } catch (e) {
            console.error('to fetch locked IPs:', e);
        }
    };

    // Reset all user passwords - for security incidents
    // This was scary to implement lol, triple-confirmed it works right
    const resetAllPasswords = async () => {
        setResetAllLoading(true);
        try {
            const res = await fetch(`${API_URL}/security/password-expiry/reset-all`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ include_admins: includeAdmins })
            });
            if (res.ok) {
                const data = await res.json();
                addToast(data.message || `${data.reset_count} users will need to change their password`, 'success');
                setShowResetConfirm(false);
                setIncludeAdmins(false);  // reset checkbox
            } else {
                const err = await res.json();
                addToast(err.error || 'Failed to reset passwords', 'error');
            }
        } catch (e) {
            console.error('reset all passwords failed:', e);
            addToast('Connection error', 'error');
        } finally {
            setResetAllLoading(false);
        }
    };

    // Kill switch - forces every logged-in session (including our own) to
    // re-authenticate right now, e.g. suspected credential compromise.
    // Sessions already survive an app restart, so this is the "everyone out
    // immediately, without restarting" counterpart.
    const killAllSessions = async () => {
        setKillAllLoading(true);
        try {
            const res = await fetch(`${API_URL}/auth/sessions/kill-all`, {
                method: 'POST',
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const data = await res.json();
                setShowKillAllConfirm(false);
                addToast(`${data.sessions_killed} session(s) killed`, 'success');
                // Our own session just died too - send everyone (including us) back to login
                setTimeout(() => { window.location.href = '/'; }, 800);
            } else {
                const err = await res.json().catch(() => ({}));
                addToast(err.error || 'Failed to kill sessions', 'error');
            }
        } catch (e) {
            console.error('kill all sessions failed:', e);
            addToast('Connection error', 'error');
        } finally {
            setKillAllLoading(false);
        }
    };

    const saveSettings = async (newSettings) => {
        try {
            const res = await fetch(`${API_URL}/settings/server`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(newSettings)
            });
            if (res.ok) {
                setSettings(newSettings);
                addToast(t('settingsSaved'), 'success');
            }
        } catch (e) {
            addToast(t('failedToSaveSettings'), 'error');
        }
    };

    const unlockIp = async (ip) => {
        try {
            const res = await fetch(`${API_URL}/security/locked-ips/${encodeURIComponent(ip)}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (res.ok) {
                setLockedIps(prev => prev.filter(l => l.ip !== ip));
                addToast(`IP ${ip} ${t('unlocked')}`, 'success');
            }
        } catch (e) {
            addToast(t('failedToUnlockIp'), 'error');
        }
    };

    // Unlock a specific username
    const unlockUser = async (username) => {
        try {
            const res = await fetch(`${API_URL}/security/locked-users/${encodeURIComponent(username)}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (res.ok) {
                setLockedUsers(prev => prev.filter(l => l.username !== username));
                addToast(`${t('user')} ${username} ${t('unlocked')}`, 'success');
            }
        } catch (e) {
            addToast(t('failedToUnlockUser'), 'error');
        }
    };

    const unlockAll = async () => {
        if (!confirm(t('unlockAllConfirm'))) return;
        try {
            const res = await fetch(`${API_URL}/security/locked-ips`, {
                method: 'DELETE',
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (res.ok) {
                setLockedIps([]);
                addToast(t('allIpsUnlocked'), 'success');
            }
        } catch (e) {
            addToast(t('failedToUnlockAllIps'), 'error');
        }
    };

    // Unlock all usernames
    const unlockAllUsers = async () => {
        if (!confirm(t('unlockAllUsersConfirm'))) return;
        try {
            const res = await fetch(`${API_URL}/security/locked-users`, {
                method: 'DELETE',
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (res.ok) {
                setLockedUsers([]);
                addToast(t('allUsersUnlocked'), 'success');
            }
        } catch (e) {
            addToast(t('failedToUnlockAllUsers'), 'error');
        }
    };

    if (!isAdmin) return null;

    return (
        <div className="space-y-6">
            {/* Header with badge */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-500/10 rounded-lg">
                        <Icons.Shield />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white">{t('bruteForceProtection')}</h3>
                        <p className="text-xs text-gray-500">{t('bruteForceProtectionDesc2')}</p>
                    </div>
                </div>
                {(lockedIps.length > 0 || lockedUsers.length > 0) && (
                    <div className="flex gap-2">
                        {lockedIps.length > 0 && (
                            <span className="px-3 py-1.5 bg-red-500/20 text-red-400 rounded-full text-sm font-medium">
                                {lockedIps.length} IP{lockedIps.length !== 1 ? 's' : ''}
                            </span>
                        )}
                        {lockedUsers.length > 0 && (
                            <span className="px-3 py-1.5 bg-orange-500/20 text-orange-400 rounded-full text-sm font-medium">
                                {lockedUsers.length} {t('user')}{lockedUsers.length !== 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* Settings */}
            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                <h4 className={isCorporate ? 'corp-card-header' : "font-medium text-white mb-4"}>{t('loginProtection')}</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-2"}>{t('maxLoginAttempts')}</label>
                        <input
                            type="number"
                            value={settings.login_max_attempts}
                            onChange={e => setSettings(prev => ({ ...prev, login_max_attempts: parseInt(e.target.value) || 5 }))}
                            onBlur={() => saveSettings(settings)}
                            min={1}
                            max={20}
                            className={isCorporate ? 'corp-input' : "w-full bg-proxmox-darker border border-proxmox-border rounded-lg p-2 text-white"}
                        />
                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>{t('maxLoginAttemptsDesc')}</p>
                    </div>
                    <div>
                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-2"}>{t('lockoutTime')}</label>
                        <div className="flex gap-2">
                            <input
                                type="number"
                                value={settings.login_lockout_time}
                                onChange={e => setSettings(prev => ({ ...prev, login_lockout_time: parseInt(e.target.value) || 300 }))}
                                onBlur={() => saveSettings(settings)}
                                min={60}
                                max={3600}
                                step={60}
                                className={isCorporate ? 'corp-input flex-1' : "flex-1 bg-proxmox-darker border border-proxmox-border rounded-lg p-2 text-white"}
                            />
                            <span className="flex items-center text-gray-500 text-sm">sec</span>
                        </div>
                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>{Math.round(settings.login_lockout_time / 60)} {t('minutes')}</p>
                    </div>
                    <div>
                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-2"}>{t('attemptWindow')}</label>
                        <div className="flex gap-2">
                            <input
                                type="number"
                                value={settings.login_attempt_window}
                                onChange={e => setSettings(prev => ({ ...prev, login_attempt_window: parseInt(e.target.value) || 600 }))}
                                onBlur={() => saveSettings(settings)}
                                min={60}
                                max={3600}
                                step={60}
                                className={isCorporate ? 'corp-input flex-1' : "flex-1 bg-proxmox-darker border border-proxmox-border rounded-lg p-2 text-white"}
                            />
                            <span className="flex items-center text-gray-500 text-sm">sec</span>
                        </div>
                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>{Math.round(settings.login_attempt_window / 60)} {t('minutes')}</p>
                    </div>
                </div>
            </div>

            {/* Password Policy */}
            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                <h4 className="font-medium text-white mb-4 flex items-center gap-2">
                    <Icons.Key />
                    {t('passwordPolicy')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-2"}>{t('minPasswordLength')}</label>
                        <input
                            type="number"
                            value={settings.password_min_length || 8}
                            onChange={e => setSettings(prev => ({ ...prev, password_min_length: parseInt(e.target.value) || 8 }))}
                            onBlur={() => saveSettings(settings)}
                            min={4}
                            max={32}
                            className={isCorporate ? 'corp-input' : "w-full bg-proxmox-darker border border-proxmox-border rounded-lg p-2 text-white"}
                        />
                    </div>
                    <div>
                        <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-2"}>{t('sessionTimeout')}</label>
                        <div className="flex gap-2">
                            <input
                                type="number"
                                value={Math.round((settings.session_timeout || 86400) / 3600)}
                                onChange={e => setSettings(prev => ({ ...prev, session_timeout: (parseInt(e.target.value) || 24) * 3600 }))}
                                onBlur={() => saveSettings(settings)}
                                min={1}
                                max={168}
                                className={isCorporate ? 'corp-input flex-1' : "flex-1 bg-proxmox-darker border border-proxmox-border rounded-lg p-2 text-white"}
                            />
                            <span className="flex items-center text-gray-500 text-sm">{t('hours')}</span>
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={settings.password_require_uppercase !== false}
                            onChange={e => {
                                const newSettings = { ...settings, password_require_uppercase: e.target.checked };
                                setSettings(newSettings);
                                saveSettings(newSettings);
                            }}
                            className="rounded"
                        />
                        <span className="text-sm text-gray-300">{t('requireUppercase')}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={settings.password_require_lowercase !== false}
                            onChange={e => {
                                const newSettings = { ...settings, password_require_lowercase: e.target.checked };
                                setSettings(newSettings);
                                saveSettings(newSettings);
                            }}
                            className="rounded"
                        />
                        <span className="text-sm text-gray-300">{t('requireLowercase')}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={settings.password_require_numbers !== false}
                            onChange={e => {
                                const newSettings = { ...settings, password_require_numbers: e.target.checked };
                                setSettings(newSettings);
                                saveSettings(newSettings);
                            }}
                            className="rounded"
                        />
                        <span className="text-sm text-gray-300">{t('requireNumbers')}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={settings.password_require_special || false}
                            onChange={e => {
                                const newSettings = { ...settings, password_require_special: e.target.checked };
                                setSettings(newSettings);
                                saveSettings(newSettings);
                            }}
                            className="rounded"
                        />
                        <span className="text-sm text-gray-300">{t('requireSpecial')}</span>
                    </label>
                </div>
            </div>

            {/* Password Expiry Settings
                        Good feature request from IT-Sec team. They wanted this for compliance.
                        Exempt admins from expiry to prevent accidental lockout
                    */}
            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium text-white flex items-center gap-2">
                        <Icons.Clock />
                        {t('passwordExpiry')}
                    </h4>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={settings.password_expiry_enabled || false}
                            onChange={e => {
                                const newSettings = { ...settings, password_expiry_enabled: e.target.checked };
                                setSettings(newSettings);
                                saveSettings(newSettings);
                            }}
                            className="rounded"
                        />
                        <span className="text-sm text-gray-300">{t('enabled')}</span>
                    </label>
                </div>

                <p className="text-sm text-gray-400 mb-4">
                    {t('passwordExpiryDesc')}
                </p>

                {/* only show options when enabled - saves screen space */}
                {settings.password_expiry_enabled && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-2"}>{t('expiryDays')}</label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        value={settings.password_expiry_days || 90}
                                        onChange={e => setSettings(prev => ({ ...prev, password_expiry_days: parseInt(e.target.value) || 90 }))}
                                        onBlur={() => saveSettings(settings)}
                                        min={7}
                                        max={365}
                                        className={isCorporate ? 'corp-input flex-1' : "flex-1 bg-proxmox-darker border border-proxmox-border rounded-lg p-2 text-white"}
                                    />
                                    <span className="flex items-center text-gray-500 text-sm">{t('days')}</span>
                                </div>
                                {/* 90 days is a common default, but some orgs want 30 or 60 */}
                            </div>
                            <div>
                                <label className={isCorporate ? 'corp-label' : "block text-sm text-gray-400 mb-2"}>{t('warningDays')}</label>
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        value={settings.password_expiry_warning_days || 14}
                                        onChange={e => setSettings(prev => ({ ...prev, password_expiry_warning_days: parseInt(e.target.value) || 14 }))}
                                        onBlur={() => saveSettings(settings)}
                                        min={1}
                                        max={30}
                                        className={isCorporate ? 'corp-input flex-1' : "flex-1 bg-proxmox-darker border border-proxmox-border rounded-lg p-2 text-white"}
                                    />
                                    <span className="flex items-center text-gray-500 text-sm">{t('days')}</span>
                                </div>
                            </div>
                        </div>

                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={settings.password_expiry_email_enabled !== false}
                                onChange={e => {
                                    const newSettings = { ...settings, password_expiry_email_enabled: e.target.checked };
                                    setSettings(newSettings);
                                    saveSettings(newSettings);
                                }}
                                className="rounded"
                            />
                            <span className="text-sm text-gray-300">{t('sendExpiryEmails')}</span>
                        </label>

                        {/* Include admins checkbox - requested by IT-Sec team */}
                        <label className="flex items-center gap-2 cursor-pointer p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                            <input
                                type="checkbox"
                                checked={settings.password_expiry_include_admins || false}
                                onChange={e => {
                                    const newSettings = { ...settings, password_expiry_include_admins: e.target.checked };
                                    setSettings(newSettings);
                                    saveSettings(newSettings);
                                }}
                                className="rounded"
                            />
                            <div>
                                <span className="text-sm text-yellow-400 font-medium">{t('includeAdminsInExpiry')}</span>
                                <p className="text-xs text-gray-500">{t('includeAdminsInExpiryDesc')}</p>
                            </div>
                        </label>

                        <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                            <p className="text-sm text-blue-400">
                                💡 {t('passwordExpiryHint')}
                            </p>
                        </div>

                        {/* Emergency reset button - Wanted this after a security scare */}
                        <div className="pt-4 border-t border-proxmox-border">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h5 className="text-sm font-medium text-white">{t('forcePasswordReset')}</h5>
                                    <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>{t('forcePasswordResetDesc')}</p>
                                </div>
                                <button
                                    onClick={() => setShowResetConfirm(true)}
                                    className="px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg text-sm font-medium transition-colors"
                                >
                                    {t('resetAllPasswords')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Reset All Passwords Confirmation Modal */}
            {showResetConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
                    <div className="bg-proxmox-dark border border-proxmox-border rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-red-500/20 rounded-lg">
                                <Icons.AlertTriangle className="w-6 h-6 text-red-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-white">{t('confirmPasswordReset')}</h3>
                        </div>

                        <p className="text-gray-400 mb-4">
                            {t('resetAllWarning')}
                        </p>

                        <label className="flex items-center gap-2 cursor-pointer mb-6 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                            <input
                                type="checkbox"
                                checked={includeAdmins}
                                onChange={e => setIncludeAdmins(e.target.checked)}
                                className="rounded"
                            />
                            <div>
                                <span className="text-sm text-yellow-400 font-medium">{t('includeAdmins')}</span>
                                <p className="text-xs text-gray-500">{t('includeAdminsWarning')}</p>
                            </div>
                        </label>

                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    setShowResetConfirm(false);
                                    setIncludeAdmins(false);
                                }}
                                className="flex-1 px-4 py-2 bg-proxmox-hover hover:bg-proxmox-border rounded-lg text-white transition-colors"
                                disabled={resetAllLoading}
                            >
                                {t('cancel')}
                            </button>
                            <button
                                onClick={resetAllPasswords}
                                disabled={resetAllLoading}
                                className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 rounded-lg text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {resetAllLoading ? (
                                    <>
                                        <Icons.RotateCw className="w-4 h-4 animate-spin" />
                                        {t('processing')}
                                    </>
                                ) : (
                                    t('resetAllPasswords2')
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Force 2FA Settings */}
            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium text-white flex items-center gap-2">
                        <Icons.Shield />
                        {t('force2FA')}
                    </h4>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={settings.force_2fa || false}
                            onChange={e => {
                                const newSettings = { ...settings, force_2fa: e.target.checked };
                                setSettings(newSettings);
                                saveSettings(newSettings);
                            }}
                            className="rounded"
                        />
                        <span className="text-sm text-gray-300">{t('enabled')}</span>
                    </label>
                </div>

                <p className="text-sm text-gray-400 mb-4">
                    {t('force2FADesc')}
                </p>

                {settings.force_2fa && (
                    <div className="space-y-4">
                        <label className="flex items-center gap-2 cursor-pointer p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                            <input
                                type="checkbox"
                                checked={settings.force_2fa_exclude_admins || false}
                                onChange={e => {
                                    const newSettings = { ...settings, force_2fa_exclude_admins: e.target.checked };
                                    setSettings(newSettings);
                                    saveSettings(newSettings);
                                }}
                                className="rounded"
                            />
                            <div>
                                <span className="text-sm text-yellow-400 font-medium">{t('force2FAExcludeAdmins')}</span>
                                <p className="text-xs text-gray-500">{t('force2FAExcludeAdminsDesc')}</p>
                            </div>
                        </label>

                        <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                            <p className="text-sm text-blue-400">
                                💡 {t('force2FAHint')}
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Session IP-binding (audit #6) */}
            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                <h4 className="font-medium text-white mb-3 flex items-center gap-2">
                    <Icons.Shield className="w-4 h-4" />
                    {t('strictSessionIp')}
                </h4>
                <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-proxmox-hover/50">
                    <input type="checkbox"
                        checked={settings.strict_session_ip || false}
                        onChange={e => {
                            const ns = { ...settings, strict_session_ip: e.target.checked };
                            saveSettings(ns);
                        }}
                        className="mt-0.5 w-4 h-4 rounded accent-proxmox-orange"
                    />
                    <div>
                        <span className="text-sm text-white font-medium">{t('strictSessionIpLabel')}</span>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {t('strictSessionIpDesc')}
                        </p>
                    </div>
                </label>
            </div>

            {/* Kill all sessions - panic button for suspected credential compromise */}
            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-500/10 rounded-lg">
                            <Icons.Monitor className="w-5 h-5 text-red-400" />
                        </div>
                        <div>
                            <h4 className="font-medium text-white">{t('killAllSessions')}</h4>
                            <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>{t('killAllSessionsDesc')}</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowKillAllConfirm(true)}
                        className="px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg text-sm font-medium transition-colors"
                    >
                        {t('killAllSessions')}
                    </button>
                </div>
            </div>

            {/* Kill All Sessions Confirmation Modal */}
            {showKillAllConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
                    <div className="bg-proxmox-dark border border-proxmox-border rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-red-500/20 rounded-lg">
                                <Icons.AlertTriangle className="w-6 h-6 text-red-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-white">{t('killAllSessions')}</h3>
                        </div>

                        <p className="text-gray-400 mb-6">
                            {t('killAllSessionsWarning')}
                        </p>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowKillAllConfirm(false)}
                                className="flex-1 px-4 py-2 bg-proxmox-hover hover:bg-proxmox-border rounded-lg text-white transition-colors"
                                disabled={killAllLoading}
                            >
                                {t('cancel')}
                            </button>
                            <button
                                onClick={killAllSessions}
                                disabled={killAllLoading}
                                className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 rounded-lg text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {killAllLoading ? (
                                    <>
                                        <Icons.RotateCw className="w-4 h-4 animate-spin" />
                                        {t('processing')}
                                    </>
                                ) : (
                                    t('killAllSessions')
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Locked IPs */}
            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium text-white flex items-center gap-2">
                        <Icons.Shield />
                        {t('lockedIps')}
                    </h4>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={fetchLockedIps}
                            className="p-2 hover:bg-proxmox-hover rounded-lg text-gray-400 hover:text-white transition-colors"
                            title="Refresh"
                        >
                            <Icons.RefreshCw />
                        </button>
                        {lockedIps.length > 0 && (
                            <button
                                onClick={unlockAll}
                                className="px-3 py-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg text-sm transition-colors"
                            >
                                {t('unlockAll')}
                            </button>
                        )}
                    </div>
                </div>
                {lockedIps.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <Icons.CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500/50" />
                        <p>{t('noLockedIps')}</p>
                        <p className="text-xs mt-1">{t('allClear')}</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {lockedIps.map(item => (
                            <div key={item.ip} className="flex items-center justify-between p-3 bg-proxmox-darker rounded-lg border border-red-500/20">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                    <div>
                                        <span className="font-mono text-white">{item.ip}</span>
                                        <div className="text-xs text-gray-500">
                                            {item.attempt_count} {t('attempts')} • {item.remaining_seconds}s {t('remaining')}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => unlockIp(item.ip)}
                                    className="px-4 py-2 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-lg text-sm font-medium transition-colors"
                                >
                                    {t('unlock')}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Locked Users - username-based lockout protection */}
            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark border border-proxmox-border rounded-xl p-4"}>
                <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium text-white flex items-center gap-2">
                        <Icons.User />
                        {t('lockedUsers')}
                    </h4>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={fetchLockedIps}
                            className="p-2 hover:bg-proxmox-hover rounded-lg text-gray-400 hover:text-white transition-colors"
                            title="Refresh"
                        >
                            <Icons.RefreshCw />
                        </button>
                        {lockedUsers.length > 0 && (
                            <button
                                onClick={unlockAllUsers}
                                className="px-3 py-1.5 bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 rounded-lg text-sm transition-colors"
                            >
                                {t('unlockAll')}
                            </button>
                        )}
                    </div>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                    {t('lockedUsersDesc')}
                </p>
                {lockedUsers.length === 0 ? (
                    <div className="text-center py-6 text-gray-500">
                        <Icons.CheckCircle className="w-10 h-10 mx-auto mb-2 text-green-500/50" />
                        <p className="text-sm">{t('noLockedUsers')}</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {lockedUsers.map(item => (
                            <div key={item.username} className="flex items-center justify-between p-3 bg-proxmox-darker rounded-lg border border-orange-500/20">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                                    <div>
                                        <span className="font-medium text-white">{item.username}</span>
                                        <div className="text-xs text-gray-500">
                                            {item.attempt_count} {t('attempts')} • {item.remaining_seconds}s {t('remaining')}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => unlockUser(item.username)}
                                    className="px-4 py-2 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-lg text-sm font-medium transition-colors"
                                >
                                    {t('unlock')}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* IP Whitelisting */}
            <div className="bg-proxmox-dark rounded-xl p-6 border border-proxmox-border">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <Icons.Shield className="w-5 h-5 text-blue-400" />
                    {t('ipWhitelisting')}
                </h3>
                <IPWhitelistSection addToast={addToast} />
            </div>

            {/* Config Backup/Restore */}
            <div className="bg-proxmox-dark rounded-xl p-6 border border-proxmox-border">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <Icons.Database className="w-5 h-5 text-green-400" />
                    {t('configBackupRestore')}
                </h3>
                <ConfigBackupSection addToast={addToast} />
            </div>
        </div>
    );
}

// Compliance & Key Management Section (HIPAA/ISO 27001)
function ComplianceSection({ addToast }) {
    const { t } = useTranslation();
    const { getAuthHeaders, isAdmin } = useAuth();
    const { isCorporate } = useLayout();
    const [compliance, setCompliance] = useState(null);
    const [auditIntegrity, setAuditIntegrity] = useState(null);
    const [keyInfo, setKeyInfo] = useState(null);
    const [corsInfo, setCorsInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [rotating, setRotating] = useState(false);
    const [checking, setChecking] = useState(false);
    // Local mirror of two server settings we expose here:
    // audit retention days + air-gap mode. Loaded from /api/settings/server,
    // saved via the same endpoint (POST JSON branch).
    const [hardening, setHardening] = useState({ audit_retention_days: 90, air_gap_mode: false });
    const [hardeningSaving, setHardeningSaving] = useState(false);

    useEffect(() => {
        fetchComplianceStatus();
        fetchHardeningSettings();
    }, []);

    const fetchHardeningSettings = async () => {
        try {
            const r = await fetch(`${API_URL}/settings/server`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) {
                const d = await r.json();
                setHardening({
                    audit_retention_days: d.audit_retention_days || 90,
                    air_gap_mode: !!d.air_gap_mode,
                });
            }
        } catch (_) { }
    };

    const saveHardeningSettings = async (patch) => {
        setHardeningSaving(true);
        try {
            const next = { ...hardening, ...patch };
            setHardening(next);
            const r = await fetch(`${API_URL}/settings/server`, {
                method: 'POST', credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(patch)
            });
            if (r.ok) addToast(t('settingsSaved4'), 'success');
            else addToast('Save failed', 'error');
        } catch (e) {
            addToast('Save failed: ' + e, 'error');
        } finally {
            setHardeningSaving(false);
        }
    };

    const fetchComplianceStatus = async () => {
        setLoading(true);
        try {
            const [compRes, keyRes, corsRes] = await Promise.all([
                fetch(`${API_URL}/security/compliance`, { credentials: 'include', headers: getAuthHeaders() }),
                fetch(`${API_URL}/security/key-info`, { credentials: 'include', headers: getAuthHeaders() }),
                fetch(`${API_URL}/security/cors`, { credentials: 'include', headers: getAuthHeaders() })
            ]);

            if (compRes.ok) setCompliance(await compRes.json());
            if (keyRes.ok) setKeyInfo(await keyRes.json());
            if (corsRes.ok) setCorsInfo(await corsRes.json());
        } catch (e) {
            console.error('Failed to fetch compliance status:', e);
        } finally {
            setLoading(false);
        }
    };

    const checkAuditIntegrity = async () => {
        setChecking(true);
        try {
            const res = await fetch(`${API_URL}/audit/integrity`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const data = await res.json();
                setAuditIntegrity(data);
                if (data.potentially_tampered > 0) {
                    addToast(`⚠️ WARNING: ${data.potentially_tampered} audit entries may have been tampered!`, 'error');
                } else {
                    addToast(`✓ Audit log integrity verified: ${data.verified}/${data.total_entries} entries`, 'success');
                }
            }
        } catch (e) {
            addToast('Failed to check audit integrity', 'error');
        } finally {
            setChecking(false);
        }
    };

    const rotateKey = async () => {
        if (!confirm('Are you sure you want to rotate the encryption key?\n\nThis will re-encrypt all sensitive data with a new key.\nThe old key will be backed up.')) {
            return;
        }

        setRotating(true);
        try {
            const res = await fetch(`${API_URL}/security/key-rotate`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirm: true })
            });
            const data = await res.json();

            if (data.success) {
                addToast(`Key rotation completed: ${data.users_rotated} users, ${data.clusters_rotated} clusters re-encrypted`, 'success');
                fetchComplianceStatus();
            } else {
                addToast(`Key rotation failed: ${data.error}`, 'error');
            }
        } catch (e) {
            addToast('Key rotation failed', 'error');
        } finally {
            setRotating(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-proxmox-orange"></div>
            </div>
        );
    }

    const getScoreColor = (score) => {
        if (score >= 90) return 'text-green-400';
        if (score >= 70) return 'text-yellow-400';
        return 'text-red-400';
    };

    return (
        <div className="space-y-6">
            {/* Hardening / Compliance settings (audit retention + air-gap).
                        BSI Grundschutz / VS-NfD / NIS2 customers want these front-and-center
                        in the Compliance tab, not buried under Server settings. */}
            <div className={isCorporate ? 'corp-settings-card space-y-5' : "bg-proxmox-dark rounded-xl p-6 border border-proxmox-border space-y-5"}>
                <h3 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "text-lg font-semibold text-white flex items-center gap-2"}>
                    <Icons.Lock /> {t('complianceSettings')}
                </h3>

                {/* Audit retention */}
                <div>
                    <label className={isCorporate ? 'corp-label' : "block text-sm font-medium text-gray-200 mb-1"}>
                        {t('auditRetention')}
                    </label>
                    <div className="flex items-center gap-3">
                        <input type="number" min="30" max="3650"
                            value={hardening.audit_retention_days}
                            onChange={e => setHardening({ ...hardening, audit_retention_days: parseInt(e.target.value) || 90 })}
                            className={isCorporate ? 'corp-input' : "w-32 px-3 py-2 bg-proxmox-darker border border-proxmox-border rounded text-white text-sm"} />
                        <button
                            onClick={() => saveHardeningSettings({ audit_retention_days: hardening.audit_retention_days })}
                            disabled={hardeningSaving}
                            className="px-3 py-2 bg-proxmox-orange/80 hover:bg-proxmox-orange text-white rounded text-sm disabled:opacity-50">
                            {hardeningSaving ? '...' : (t('save'))}
                        </button>
                    </div>
                    <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>
                        {t('auditRetentionHint2')}
                    </p>
                </div>

                {/* Air-gap mode */}
                <div className="pt-4 border-t border-proxmox-border">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white">{t('airGapMode')}</p>
                            <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>
                                {t('airGapModeDesc')}
                            </p>
                        </div>
                        <button
                            onClick={() => saveHardeningSettings({ air_gap_mode: !hardening.air_gap_mode })}
                            disabled={hardeningSaving}
                            className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${hardening.air_gap_mode ? 'bg-emerald-500' : 'bg-proxmox-darker border border-proxmox-border'
                                } disabled:opacity-50`}>
                            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${hardening.air_gap_mode ? 'left-7' : 'left-1'
                                }`} />
                        </button>
                    </div>
                    {hardening.air_gap_mode && (
                        <div className="mt-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                            <p className="text-xs text-yellow-300">
                                ⚠ {t('airGapModeActive2')}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Compliance Score */}
            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark rounded-xl p-6 border border-proxmox-border"}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "text-lg font-semibold text-white flex items-center gap-2"}>
                        <Icons.Check /> {t('securitySelfCheck')}
                    </h3>
                    {compliance && (
                        <div className={`text-3xl font-bold ${getScoreColor(compliance.compliance_score)}`}>
                            {compliance.compliance_score}%
                        </div>
                    )}
                </div>

                <p className={isCorporate ? 'corp-help-text mb-4' : "text-xs text-gray-500 mb-4"}>
                    {t('securitySelfCheckDisclaimer2')}
                </p>

                {compliance && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        {Object.entries(compliance.checks || {}).map(([key, value]) => (
                            <div key={key} className={`p-3 rounded-lg ${value ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                                <div className="flex items-center gap-2">
                                    {value ? <span className="text-green-400">✓</span> : <span className="text-red-400">✗</span>}
                                    <span className="text-sm text-gray-300">{key.replace(/_/g, ' ')}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {compliance?.recommendations?.length > 0 && (
                    <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                        <h4 className="text-yellow-400 font-medium mb-2">{t('recommendations')}</h4>
                        <ul className="text-sm text-gray-300 space-y-1">
                            {compliance.recommendations.map((rec, i) => (
                                <li key={i}>• {rec}</li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {/* Audit Log Integrity */}
            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark rounded-xl p-6 border border-proxmox-border"}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className={isCorporate ? 'corp-card-header' : "text-lg font-semibold text-white"}>{t('auditLogIntegrity')} (HMAC-SHA256)</h3>
                    <button
                        onClick={checkAuditIntegrity}
                        disabled={checking}
                        className="px-4 py-2 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        {checking ? t('checking') : t('verifyIntegrity')}
                    </button>
                </div>

                {auditIntegrity && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 bg-proxmox-card rounded-lg border border-proxmox-border">
                            <div className="text-2xl font-bold text-white">{auditIntegrity.total_entries}</div>
                            <div className="text-sm text-gray-400">{t('totalEntries')}</div>
                        </div>
                        <div className="p-4 bg-green-500/10 rounded-lg border border-green-500/30">
                            <div className="text-2xl font-bold text-green-400">{auditIntegrity.verified}</div>
                            <div className="text-sm text-gray-400">{t('verified')}</div>
                        </div>
                        <div className="p-4 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
                            <div className="text-2xl font-bold text-yellow-400">{auditIntegrity.unsigned}</div>
                            <div className="text-sm text-gray-400">{t('unsigned')}</div>
                        </div>
                        <div className={`p-4 rounded-lg border ${auditIntegrity.potentially_tampered > 0 ? 'bg-red-500/20 border-red-500' : 'bg-proxmox-card border-proxmox-border'}`}>
                            <div className={`text-2xl font-bold ${auditIntegrity.potentially_tampered > 0 ? 'text-red-400' : 'text-gray-400'}`}>
                                {auditIntegrity.potentially_tampered}
                            </div>
                            <div className="text-sm text-gray-400">{t('tampered')}</div>
                        </div>
                    </div>
                )}
            </div>

            {/* Encryption Key Management */}
            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark rounded-xl p-6 border border-proxmox-border"}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className={isCorporate ? 'corp-card-header' : "text-lg font-semibold text-white"}>{t('encryptionKey')} (AES-256-GCM)</h3>
                    <button
                        onClick={rotateKey}
                        disabled={rotating}
                        className="px-4 py-2 bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        {rotating ? t('rotating') : t('rotateKey')}
                    </button>
                </div>

                {keyInfo && (
                    <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-400">{t('algorithm')}:</span>
                            <span className="text-white font-mono">{keyInfo.algorithm || 'AES-256-GCM'}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-400">{t('keySize')}:</span>
                            <span className="text-white">{keyInfo.key_size_bits || 256} bits</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-400">{t('created3')}:</span>
                            <span className="text-white">{keyInfo.created ? new Date(keyInfo.created).toLocaleString() : 'Unknown'}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-400">{t('lastRotation')}:</span>
                            <span className="text-white">{keyInfo.last_modified ? new Date(keyInfo.last_modified).toLocaleString() : 'Never'}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-400">{t('backups')}:</span>
                            <span className="text-white">{keyInfo.backups?.length || 0}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* CORS Configuration */}
            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark rounded-xl p-6 border border-proxmox-border"}>
                <h3 className={isCorporate ? 'corp-card-header mb-4' : "text-lg font-semibold text-white mb-4"}>{t('corsConfiguration')}</h3>

                {corsInfo && (
                    <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-400">{t('mode')}:</span>
                            <span className={`font-medium ${corsInfo.mode === 'same-origin' ? 'text-green-400' : 'text-yellow-400'}`}>
                                {corsInfo.mode === 'same-origin' ? '🔒 Same-Origin Only (Most Secure)' : '⚙️ Configured Origins'}
                            </span>
                        </div>

                        {corsInfo.all_allowed?.length > 0 && (
                            <div>
                                <span className="text-gray-400 text-sm">{t('allowedOrigins')}:</span>
                                <div className="mt-2 space-y-1">
                                    {corsInfo.all_allowed.map((origin, i) => (
                                        <div key={i} className="text-sm font-mono bg-proxmox-card px-3 py-1 rounded border border-proxmox-border">
                                            {origin}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm text-gray-300">
                            <strong className="text-blue-400">Tip:</strong> For permanent CORS configuration, set the environment variable:
                            <code className="block mt-1 bg-proxmox-card px-2 py-1 rounded font-mono text-xs">
                                export ProxmoxVEx_ALLOWED_ORIGINS="https://your-domain.com"
                            </code>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// IP Whitelist Management Component
// Enterprise feature, be careful with this
// Make sure you add your own IP before enabling
function IPWhitelistSection({ addToast }) {
    const { t } = useTranslation();
    const { isCorporate } = useLayout();
    const { getAuthHeaders } = useAuth();
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [newWhitelistIP, setNewWhitelistIP] = useState('');
    const [newBlacklistIP, setNewBlacklistIP] = useState('');
    const [testIP, setTestIP] = useState('');
    const [testResult, setTestResult] = useState(null);

    useEffect(() => {
        fetchConfig();
    }, []);

    const fetchConfig = async () => {
        try {
            const res = await fetch(`${API_URL}/security/ip-whitelist`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (res.ok) {
                setConfig(await res.json());
            }
        } catch (e) {
            console.error('Failed to fetch IP whitelist:', e);
        } finally {
            setLoading(false);
        }
    };

    const saveConfig = async (newConfig) => {
        setSaving(true);
        try {
            const res = await fetch(`${API_URL}/security/ip-whitelist`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(newConfig)
            });
            const data = await res.json();

            if (res.ok) {
                addToast(t('saved'), 'success');
                fetchConfig();
            } else {
                addToast(data.error || 'Failed to save', 'error');
            }
        } catch (e) {
            addToast('Failed to save', 'error');
        } finally {
            setSaving(false);
        }
    };

    const addToWhitelist = () => {
        if (!newWhitelistIP.trim()) return;
        const updated = [...(config?.whitelist || []), newWhitelistIP.trim()];
        saveConfig({ ...config, whitelist: updated });
        setNewWhitelistIP('');
    };

    const removeFromWhitelist = (ip) => {
        const updated = (config?.whitelist || []).filter(i => i !== ip);
        saveConfig({ ...config, whitelist: updated });
    };

    const addToBlacklist = () => {
        if (!newBlacklistIP.trim()) return;
        const updated = [...(config?.blacklist || []), newBlacklistIP.trim()];
        saveConfig({ ...config, blacklist: updated });
        setNewBlacklistIP('');
    };

    const removeFromBlacklist = (ip) => {
        const updated = (config?.blacklist || []).filter(i => i !== ip);
        saveConfig({ ...config, blacklist: updated });
    };

    const testIPAccess = async () => {
        if (!testIP.trim()) return;
        try {
            const res = await fetch(`${API_URL}/security/ip-whitelist/test`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip: testIP.trim() })
            });
            if (res.ok) {
                setTestResult(await res.json());
            }
        } catch (e) {
            console.error('Test failed:', e);
        }
    };

    if (loading) {
        return <div className="animate-pulse h-20 bg-proxmox-card rounded"></div>;
    }

    // Show error state if config failed to load
    if (!config) {
        return (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
                <p>{t('failedToLoad')}</p>
                <button
                    onClick={fetchConfig}
                    className="mt-2 px-3 py-1 bg-red-500/20 hover:bg-red-500/30 rounded text-sm"
                >
                    {t('retry')}
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between p-4 bg-proxmox-card rounded-lg border border-proxmox-border">
                <div>
                    <div className="font-medium text-white">{t('enableIPWhitelist')}</div>
                    <div className="text-sm text-gray-400">{t('ipWhitelistDesc')}</div>
                </div>
                <button
                    onClick={() => saveConfig({ ...config, enabled: !config?.enabled })}
                    disabled={saving}
                    className={`relative w-12 h-6 rounded-full transition-colors ${config?.enabled ? 'bg-green-500' : 'bg-gray-600'
                        }`}
                >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${config?.enabled ? 'translate-x-6' : 'translate-x-0'
                        }`}></span>
                </button>
            </div>

            {/* Your IP */}
            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-sm">
                <span className="text-gray-400">{t('yourIP')}:</span>
                <span className="ml-2 font-mono text-white">{config?.your_ip}</span>
            </div>

            {/* Whitelist */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">{t('whitelist')} ({t('allowedIPs')})</label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newWhitelistIP}
                        onChange={(e) => setNewWhitelistIP(e.target.value)}
                        placeholder="192.168.1.0/24 or 10.0.0.*"
                        className={isCorporate ? 'corp-input flex-1' : "flex-1 px-3 py-2 bg-proxmox-card border border-proxmox-border rounded-lg text-white text-sm"}
                        onKeyDown={(e) => e.key === 'Enter' && addToWhitelist()}
                    />
                    <button
                        onClick={addToWhitelist}
                        disabled={saving || !newWhitelistIP.trim()}
                        className="px-4 py-2 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-lg text-sm disabled:opacity-50"
                    >
                        {t('add')}
                    </button>
                </div>
                {config?.whitelist?.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                        {config.whitelist.map((ip, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-3 py-1 bg-green-500/10 border border-green-500/30 rounded-full text-sm text-green-400">
                                {ip}
                                <button onClick={() => removeFromWhitelist(ip)} className="ml-1 text-red-400 hover:text-red-300">×</button>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Blacklist */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">{t('blacklist')} ({t('blockedIPs')})</label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newBlacklistIP}
                        onChange={(e) => setNewBlacklistIP(e.target.value)}
                        placeholder="192.168.1.100"
                        className={isCorporate ? 'corp-input flex-1' : "flex-1 px-3 py-2 bg-proxmox-card border border-proxmox-border rounded-lg text-white text-sm"}
                        onKeyDown={(e) => e.key === 'Enter' && addToBlacklist()}
                    />
                    <button
                        onClick={addToBlacklist}
                        disabled={saving || !newBlacklistIP.trim()}
                        className="px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg text-sm disabled:opacity-50"
                    >
                        {t('add')}
                    </button>
                </div>
                {config?.blacklist?.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                        {config.blacklist.map((ip, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-3 py-1 bg-red-500/10 border border-red-500/30 rounded-full text-sm text-red-400">
                                {ip}
                                <button onClick={() => removeFromBlacklist(ip)} className="ml-1 text-gray-400 hover:text-gray-300">×</button>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Test IP */}
            <div className="space-y-2 pt-4 border-t border-proxmox-border">
                <label className="text-sm font-medium text-gray-300">{t('testIP')}</label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={testIP}
                        onChange={(e) => setTestIP(e.target.value)}
                        placeholder="Enter IP to test"
                        className={isCorporate ? 'corp-input flex-1' : "flex-1 px-3 py-2 bg-proxmox-card border border-proxmox-border rounded-lg text-white text-sm"}
                        onKeyDown={(e) => e.key === 'Enter' && testIPAccess()}
                    />
                    <button
                        onClick={testIPAccess}
                        disabled={!testIP.trim()}
                        className="px-4 py-2 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded-lg text-sm disabled:opacity-50"
                    >
                        {t('test')}
                    </button>
                </div>
                {testResult && (
                    <div className={`p-3 rounded-lg text-sm ${testResult.allowed ? 'bg-green-500/10 border border-green-500/30 text-green-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
                        <strong>{testResult.ip}:</strong> {testResult.allowed ? '✓ Allowed' : '✗ Blocked'} - {testResult.reason}
                    </div>
                )}
            </div>

            {/* Supported Formats */}
            <div className="text-xs text-gray-500 mt-2">
                {t('supportedFormats')}: Single IP (192.168.1.100), CIDR (192.168.1.0/24), Wildcard (192.168.1.*)
            </div>
        </div>
    );
}

// Config Backup/Restore Component
// Encrypted backups with AES-256-GCM
// Double password (user + backup) for security
function ConfigBackupSection({ addToast }) {
    const { t } = useTranslation();
    const { isCorporate } = useLayout();
    const { getAuthHeaders } = useAuth();
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [includeSecrets, setIncludeSecrets] = useState(false);  // Off by default for safety
    const [includeUsers, setIncludeUsers] = useState(true);
    const [includeAudit, setIncludeAudit] = useState(false);
    const [restoreMode, setRestoreMode] = useState('merge');  // Merge is safer than overwrite
    const [restoreUsers, setRestoreUsers] = useState(false);
    const [dryRun, setDryRun] = useState(true);  // Dry run by default, dont want accidents
    const [lastResult, setLastResult] = useState(null);
    const fileInputRef = React.useRef(null);

    // Security: Password fields
    const [showExportModal, setShowExportModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [userPassword, setUserPassword] = useState('');
    const [backupPassword, setBackupPassword] = useState('');
    const [backupPasswordConfirm, setBackupPasswordConfirm] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);

    const exportConfig = async () => {
        if (!userPassword) {
            addToast(t('passwordRequired'), 'error');
            return;
        }
        if (!backupPassword || backupPassword.length < 8) {
            addToast(t('backupPasswordMin8'), 'error');
            return;
        }
        if (backupPassword !== backupPasswordConfirm) {
            addToast(t('passwordsNoMatch'), 'error');
            return;
        }

        setExporting(true);
        try {
            const res = await fetch(`${API_URL}/config/backup`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_password: userPassword,
                    backup_password: backupPassword,
                    include_secrets: includeSecrets,
                    include_users: includeUsers,
                    include_audit: includeAudit
                })
            });

            if (res.ok) {
                const blob = await res.blob();
                if (blob.size === 0) {
                    addToast('Backup file is empty', 'error');
                    return;
                }
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `ProxmoxVEx-backup-${new Date().toISOString().split('T')[0]}.proxmoxbackup`;
                a.style.display = 'none';
                // deepcode ignore DOMXSS: object URL for download, not an HTML content sink
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    window.URL.revokeObjectURL(url);
                    a.remove();
                }, 100);
                addToast(t('backupDownloaded'), 'success');
                setShowExportModal(false);
                setUserPassword('');
                setBackupPassword('');
                setBackupPasswordConfirm('');
            } else {
                // Try to parse error response
                let errMsg = `Export failed (${res.status})`;
                try {
                    const err = await res.json();
                    errMsg = err.error || errMsg;
                } catch (e) {
                    // Response might not be JSON
                    const text = await res.text();
                    if (text) errMsg = text;
                }
                addToast(errMsg, 'error');
            }
        } catch (e) {
            console.error('Backup export error:', e);
            addToast('Export failed: ' + e.message, 'error');
        } finally {
            setExporting(false);
        }
    };

    const importConfig = async () => {
        if (!userPassword) {
            addToast(t('passwordRequired'), 'error');
            return;
        }
        if (!backupPassword) {
            addToast(t('backupPasswordRequired'), 'error');
            return;
        }
        if (!selectedFile) {
            addToast(t('selectFile2'), 'error');
            return;
        }

        setImporting(true);
        setLastResult(null);
        try {
            const formData = new FormData();
            formData.append('user_password', userPassword);
            formData.append('backup_password', backupPassword);
            formData.append('backup_file', selectedFile);
            formData.append('mode', restoreMode);
            formData.append('restore_users', restoreUsers);
            formData.append('dry_run', dryRun);

            const res = await fetch(`${API_URL}/config/restore`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'X-Requested-With': 'XMLHttpRequest' },
                body: formData
            });

            const result = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
            setLastResult(result);

            if (res.ok) {
                if (dryRun) {
                    addToast(t('dryRunComplete'), 'info');
                } else {
                    addToast(t('restoreComplete'), 'success');
                }
                setShowImportModal(false);
                setUserPassword('');
                setBackupPassword('');
                setSelectedFile(null);
            } else {
                console.error('Restore error:', result);
                addToast(result.error || `Restore failed (${res.status})`, 'error');
            }
        } catch (e) {
            console.error('Import exception:', e);
            addToast('Import failed: ' + e.message, 'error');
        } finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div className="space-y-6">
            {/* Security Notice */}
            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-sm text-gray-300">
                <strong className="text-green-400">🔒 {t('secureBackup')}:</strong> {t('secureBackupDesc')}
            </div>

            {/* Export Section */}
            <div className="space-y-4">
                <h4 className="font-medium text-white">{t('exportConfig')}</h4>

                <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={includeUsers}
                            onChange={(e) => setIncludeUsers(e.target.checked)}
                            className="rounded border-gray-600 bg-proxmox-card text-proxmox-orange focus:ring-proxmox-orange"
                        />
                        {t('includeUsers')}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={includeSecrets}
                            onChange={(e) => setIncludeSecrets(e.target.checked)}
                            className="rounded border-gray-600 bg-proxmox-card text-proxmox-orange focus:ring-proxmox-orange"
                        />
                        {t('includeSecrets')}
                        <span className="text-yellow-500 text-xs">(⚠️ {t('sensitive')})</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={includeAudit}
                            onChange={(e) => setIncludeAudit(e.target.checked)}
                            className="rounded border-gray-600 bg-proxmox-card text-proxmox-orange focus:ring-proxmox-orange"
                        />
                        {t('includeAuditLog')}
                        <span className="text-gray-500 text-xs">({t('canBeLarge')})</span>
                    </label>
                </div>

                <button
                    onClick={() => setShowExportModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded-lg text-sm font-medium transition-colors"
                >
                    <Icons.Download className="w-4 h-4" /> {t('createBackup')}
                </button>
            </div>

            {/* Import Section */}
            <div className="space-y-4 pt-4 border-t border-proxmox-border">
                <h4 className="font-medium text-white">{t('importConfig')}</h4>

                <div className="space-y-3">
                    <div className="flex gap-4">
                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                            <input
                                type="radio"
                                name="restoreMode"
                                checked={restoreMode === 'merge'}
                                onChange={() => setRestoreMode('merge')}
                                className="border-gray-600 bg-proxmox-card text-proxmox-orange focus:ring-proxmox-orange"
                            />
                            {t('merge')} <span className="text-gray-500 text-xs">({t('keepExisting')})</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                            <input
                                type="radio"
                                name="restoreMode"
                                checked={restoreMode === 'overwrite'}
                                onChange={() => setRestoreMode('overwrite')}
                                className="border-gray-600 bg-proxmox-card text-proxmox-orange focus:ring-proxmox-orange"
                            />
                            {t('overwrite')} <span className="text-red-500 text-xs">({t('replaceAll')})</span>
                        </label>
                    </div>

                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={restoreUsers}
                            onChange={(e) => setRestoreUsers(e.target.checked)}
                            className="rounded border-gray-600 bg-proxmox-card text-proxmox-orange focus:ring-proxmox-orange"
                        />
                        {t('restoreUsers')}
                        <span className="text-yellow-500 text-xs">(⚠️ {t('notAdmin')})</span>
                    </label>

                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={dryRun}
                            onChange={(e) => setDryRun(e.target.checked)}
                            className="rounded border-gray-600 bg-proxmox-card text-proxmox-orange focus:ring-proxmox-orange"
                        />
                        {t('dryRun')}
                        <span className="text-green-500 text-xs">({t('validateOnly')})</span>
                    </label>
                </div>

                <button
                    onClick={() => setShowImportModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 rounded-lg text-sm font-medium transition-colors"
                >
                    <Icons.Upload className="w-4 h-4" /> {t('restoreBackup3')}
                </button>
            </div>

            {/* Results */}
            {lastResult && (
                <div className={`p-4 rounded-lg border ${lastResult.errors?.length > 0 ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
                    <h5 className="font-medium text-white mb-2">
                        {lastResult.dry_run ? (t('dryRunResults')) : (t('restoreResults'))}
                    </h5>
                    <div className="text-sm text-gray-300 space-y-1">
                        <div>{t('backupVersion')}: {lastResult.backup_version}</div>
                        <div>{t('backupDate')}: {new Date(lastResult.backup_date).toLocaleString()}</div>
                        <div>{t('backupBy')}: {lastResult.backup_by}</div>
                        <div>{t('mode')}: {lastResult.mode}</div>

                        {Object.keys(lastResult.restored || {}).length > 0 && (
                            <div className="mt-2">
                                <strong className="text-green-400">{t('restored')}:</strong>
                                <ul className="ml-4">
                                    {Object.entries(lastResult.restored).map(([key, val]) => (
                                        <li key={key}>{key}: {val === true ? '✓' : val}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {Object.keys(lastResult.skipped || {}).length > 0 && (
                            <div className="mt-2">
                                <strong className="text-yellow-400">{t('skipped')}:</strong>
                                <ul className="ml-4">
                                    {Object.entries(lastResult.skipped).map(([key, val]) => (
                                        <li key={key}>{key}: {val}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {lastResult.errors?.length > 0 && (
                            <div className="mt-2">
                                <strong className="text-red-400">{t('errors')}:</strong>
                                <ul className="ml-4 text-red-300">
                                    {lastResult.errors.map((err, i) => (
                                        <li key={i}>{err}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Export Modal */}
            {showExportModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                    <div className="bg-proxmox-dark border border-proxmox-border rounded-xl p-6 max-w-md w-full mx-4 space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="text-lg font-semibold text-white">🔐 {t('securityVerification')}</h3>
                            <button onClick={() => { setShowExportModal(false); setUserPassword(''); setBackupPassword(''); setBackupPasswordConfirm(''); }} className="text-gray-400 hover:text-white">×</button>
                        </div>

                        <p className="text-sm text-gray-400">{t('exportSecurityDesc')}</p>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">{t('yourPassword')}</label>
                                <input
                                    type="password"
                                    value={userPassword}
                                    onChange={(e) => setUserPassword(e.target.value)}
                                    placeholder={t('enterYourPassword')}
                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-card border border-proxmox-border rounded-lg text-white"}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">{t('backupPassword')}</label>
                                <input
                                    type="password"
                                    value={backupPassword}
                                    onChange={(e) => setBackupPassword(e.target.value)}
                                    placeholder={t('backupPasswordPlaceholder')}
                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-card border border-proxmox-border rounded-lg text-white"}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">{t('confirmBackupPassword')}</label>
                                <input
                                    type="password"
                                    value={backupPasswordConfirm}
                                    onChange={(e) => setBackupPasswordConfirm(e.target.value)}
                                    placeholder={t('repeatBackupPassword')}
                                    className={`w-full px-3 py-2 bg-proxmox-card border rounded-lg text-white ${backupPasswordConfirm && backupPassword !== backupPasswordConfirm ? 'border-red-500' : 'border-proxmox-border'}`}
                                />
                            </div>
                        </div>

                        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-yellow-300">
                            ⚠️ {t('rememberBackupPassword')}
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => { setShowExportModal(false); setUserPassword(''); setBackupPassword(''); setBackupPasswordConfirm(''); }}
                                className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500"
                            >
                                {t('cancel')}
                            </button>
                            <button
                                onClick={exportConfig}
                                disabled={exporting || !userPassword || backupPassword.length < 8 || backupPassword !== backupPasswordConfirm}
                                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {exporting ? t('exporting') : t('downloadBackup')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Import Modal */}
            {showImportModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                    <div className="bg-proxmox-dark border border-proxmox-border rounded-xl p-6 max-w-md w-full mx-4 space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="text-lg font-semibold text-white">🔐 {t('restoreFromBackup')}</h3>
                            <button onClick={() => { setShowImportModal(false); setUserPassword(''); setBackupPassword(''); setSelectedFile(null); }} className="text-gray-400 hover:text-white">×</button>
                        </div>

                        <p className="text-sm text-gray-400">{t('importSecurityDesc')}</p>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">{t('backupFile')}</label>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".proxmoxbackup,.json"
                                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                    className="w-full px-3 py-2 bg-proxmox-card border border-proxmox-border rounded-lg text-white file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:bg-proxmox-orange file:text-white file:cursor-pointer"
                                />
                                {selectedFile && (
                                    <p className="text-xs text-gray-400 mt-1">📎 {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">{t('yourPassword')}</label>
                                <input
                                    type="password"
                                    value={userPassword}
                                    onChange={(e) => setUserPassword(e.target.value)}
                                    placeholder={t('enterYourPassword')}
                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-card border border-proxmox-border rounded-lg text-white"}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">{t('backupPassword')}</label>
                                <input
                                    type="password"
                                    value={backupPassword}
                                    onChange={(e) => setBackupPassword(e.target.value)}
                                    placeholder={t('backupPasswordUsedWhenCreating')}
                                    className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-card border border-proxmox-border rounded-lg text-white"}
                                />
                            </div>
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => { setShowImportModal(false); setUserPassword(''); setBackupPassword(''); setSelectedFile(null); }}
                                className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500"
                            >
                                {t('cancel')}
                            </button>
                            <button
                                onClick={importConfig}
                                disabled={importing || !userPassword || !backupPassword || !selectedFile}
                                className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {importing ? t('importing') : (dryRun ? t('validateBackup') : t('restoreBackup'))}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Excluded VMs List Component for Balancing Config
// Users wanted to exclude certain VMs from auto-migration (pinned VMs, etc)
// TODO(): Add bulk exclude/include
function ExcludedVMsList({ clusterId, clusterMetrics, addToast, getAuthHeaders }) {
    const { t } = useTranslation();
    const { isCorporate } = useLayout();
    const [excludedVMs, setExcludedVMs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [allVMs, setAllVMs] = useState([]);

    // Fetch excluded VMs
    const fetchExcludedVMs = async () => {
        try {
            const res = await fetch(`${API_URL}/clusters/${clusterId}/excluded-vms`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const data = await res.json();
                setExcludedVMs(data.excluded_vms || []);
            }
        } catch (e) {
            console.error('Error fetching excluded VMs:', e);
        }
        setLoading(false);
    };

    // Fetch all VMs for dropdown
    const fetchAllVMs = async () => {
        try {
            const res = await fetch(`${API_URL}/clusters/${clusterId}/vms`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const data = await res.json();
                setAllVMs(data.vms || data || []);
            }
        } catch (e) {
            console.error('Error fetching VMs:', e);
        }
    };

    useEffect(() => {
        fetchExcludedVMs();
        fetchAllVMs();
    }, [clusterId]);

    const excludeVM = async (vmid, vmName) => {
        try {
            const res = await fetch(`${API_URL}/clusters/${clusterId}/excluded-vms/${vmid}`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Manually excluded' })
            });
            if (res.ok) {
                addToast(`${vmName || vmid} ${t('excludedFromBalancing3')}`, 'success');
                fetchExcludedVMs();
            }
        } catch (e) {
            console.error(e);
        }
    };

    const includeVM = async (vmid, vmName) => {
        try {
            const res = await fetch(`${API_URL}/clusters/${clusterId}/excluded-vms/${vmid}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (res.ok) {
                addToast(`${vmName || vmid} ${t('reincludedInBalancing')}`, 'success');
                fetchExcludedVMs();
            }
        } catch (e) {
            console.error(e);
        }
    };

    const bulkIncludeAll = async () => {
        for (const vm of [...excludedVMs]) {
            await includeVM(vm.vmid, vm.name);
        }
    };

    const bulkExcludeSelected = async () => {
        const select = document.getElementById(`excludeVMSelect-${clusterId}`);
        if (!select) return;
        const selected = Array.from(select.selectedOptions)
            .map(o => parseInt(o.value))
            .filter(v => v);
        if (!selected.length) return;
        const nameMap = Object.fromEntries(availableVMs.map(v => [v.vmid, v.name]));
        for (const vmid of selected) {
            await excludeVM(vmid, nameMap[vmid]);
        }
    };

    const excludedVmIds = excludedVMs.map(v => v.vmid);
    const availableVMs = allVMs.filter(vm => !excludedVmIds.includes(vm.vmid));

    if (loading) {
        return <div className="text-xs text-gray-500">{t('loading')}...</div>;
    }

    return (
        <div>
            {/* Current excluded VMs */}
            {excludedVMs.length > 0 ? (
                <div className="space-y-2 mb-3">
                    {excludedVMs.map(vm => (
                        <div key={vm.vmid} className="flex items-center justify-between bg-proxmox-dark rounded-lg p-2">
                            <div className="flex items-center gap-2">
                                <Icons.Monitor className="w-4 h-4 text-red-400" />
                                <span className="text-sm">{vm.name || `VM ${vm.vmid}`}</span>
                                <span className="text-xs text-gray-500">({vm.vmid})</span>
                            </div>
                            <button
                                onClick={() => includeVM(vm.vmid, vm.name)}
                                className="text-xs text-green-400 hover:text-green-300"
                            >
                                {t('include')}
                            </button>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-xs text-gray-600 mb-3 p-2 bg-proxmox-dark rounded-lg">
                    {t('noExcludedVMs2')}
                </div>
            )}

            {/* Bulk include */}
            {excludedVMs.length > 0 && (
                <button
                    onClick={bulkIncludeAll}
                    className="mb-3 text-xs text-green-400 hover:text-green-300"
                >
                    {t('includeAllExcluded')}
                </button>
            )}

            {/* Add VM dropdown */}
            {/* (#335): min-w-0 on the select lets flex shrink it below its intrinsic
                        content width (long VM names would otherwise push the Exclude button out of
                        view). flex-shrink-0 + whitespace-nowrap on the button keeps it pinned. */}
            <div className="flex gap-2 w-full">
                <select
                    id={`excludeVMSelect-${clusterId}`}
                    className={isCorporate ? 'corp-input flex-1 min-w-0' : "flex-1 min-w-0 bg-proxmox-dark border border-proxmox-border rounded-lg px-3 py-2 text-sm"}
                    multiple
                    size="4"
                >
                    {availableVMs.map(vm => (
                        <option key={vm.vmid} value={vm.vmid}>
                            {vm.name || `VM ${vm.vmid}`} ({vm.vmid}) - {vm.node}
                        </option>
                    ))}
                </select>
                <button
                    onClick={bulkExcludeSelected}
                    className="flex-shrink-0 whitespace-nowrap px-3 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 text-sm flex items-center gap-1"
                >
                    <Icons.Ban className="w-4 h-4" />
                    {t('bulkExclude')}
                </button>
            </div>
        </div>
    );
}

// Excluded Pools from auto-balancing
function ExcludedPoolsList({ clusterId, addToast, getAuthHeaders }) {
    const { t } = useTranslation();
    const { isCorporate } = useLayout();
    const [excludedPools, setExcludedPools] = useState([]);
    const [allPools, setAllPools] = useState([]);

    const fetchExcluded = async () => {
        try {
            const r = await fetch(`${API_URL}/clusters/${clusterId}/excluded-pools`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) setExcludedPools(await r.json());
        } catch (e) { }
    };
    const fetchPools = async () => {
        try {
            const r = await fetch(`${API_URL}/clusters/${clusterId}/pools`, { credentials: 'include', headers: getAuthHeaders() });
            if (r.ok) { const data = await r.json(); setAllPools(data.pools || data || []); }
        } catch (e) { }
    };
    useEffect(() => { fetchExcluded(); fetchPools(); }, [clusterId]);

    const excludePool = async (poolId) => {
        const r = await fetch(`${API_URL}/clusters/${clusterId}/excluded-pools/${poolId}`, {
            method: 'POST', credentials: 'include',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Manually excluded' })
        });
        if (r.ok) { addToast(`Pool "${poolId}" excluded`, 'success'); fetchExcluded(); }
        else addToast('Failed to exclude pool', 'error');
    };
    const includePool = async (poolId) => {
        const r = await fetch(`${API_URL}/clusters/${clusterId}/excluded-pools/${poolId}`, {
            method: 'DELETE', credentials: 'include', headers: getAuthHeaders()
        });
        if (r.ok) { addToast(`Pool "${poolId}" included`, 'success'); fetchExcluded(); }
        else addToast('Failed', 'error');
    };

    const excludedNames = excludedPools.map(p => p.pool_name);
    const available = allPools.filter(p => !excludedNames.includes(p.poolid || p.id || p.name));

    return (
        <div>
            {excludedPools.length > 0 && (
                <div className="space-y-1 mb-3">
                    {excludedPools.map(pool => (
                        <div key={pool.pool_name} className="flex items-center justify-between px-3 py-2 bg-red-500/5 border border-red-500/20 rounded-lg">
                            <div className="flex items-center gap-2">
                                <Icons.Layers className="w-4 h-4 text-red-400" />
                                <span className="text-sm text-white">{pool.pool_name}</span>
                                {pool.reason && <span className="text-xs text-gray-500">({pool.reason})</span>}
                            </div>
                            <button onClick={() => includePool(pool.pool_name)} className="text-xs text-green-400 hover:text-green-300">{t('include')}</button>
                        </div>
                    ))}
                </div>
            )}
            {/* #335: same flex fix as ExcludedVMsList — long pool names pushed the button out */}
            <div className="flex gap-2 w-full">
                <select
                    id={`excludePoolSelect-${clusterId}`}
                    className={isCorporate ? 'corp-input flex-1 min-w-0' : "flex-1 min-w-0 bg-proxmox-dark border border-proxmox-border rounded-lg px-3 py-2 text-sm"}
                    defaultValue=""
                >
                    <option value="" disabled>{t('selectPool2')}</option>
                    {available.map(p => (
                        <option key={p.poolid || p.name} value={p.poolid || p.name}>
                            {p.poolid || p.name}{p.comment ? ` — ${p.comment}` : ''}
                        </option>
                    ))}
                </select>
                <button
                    onClick={() => {
                        const select = document.getElementById(`excludePoolSelect-${clusterId}`);
                        if (!select?.value) return;
                        excludePool(select.value);
                        select.value = '';
                    }}
                    className="flex-shrink-0 whitespace-nowrap px-3 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 text-sm flex items-center gap-1"
                >
                    <Icons.Ban className="w-4 h-4" />
                    {t('exclude')}
                </button>
            </div>
        </div>
    );
}

// update Manager Section Component (for Settings tab)
function UpdateManagerSection({ clusterId, addToast }) {
    const { t } = useTranslation();
    const { getAuthHeaders, isAdmin } = useAuth();
    const { isCorporate } = useLayout();
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(false);
    const [updateStatus, setUpdateStatus] = useState(null);
    const [rollingUpdate, setRollingUpdate] = useState(null);
    const [includeReboot, setIncludeReboot] = useState(true);
    const [skipUpToDate, setSkipUpToDate] = useState(true);  // Skip nodes without updates
    const [skipEvacuation, setSkipEvacuation] = useState(false);  // Issue #22 - skip VM evacuation (NOT RECOMMENDED)
    const [evacuationTimeout, setEvacuationTimeout] = useState(1800);  // 30 min default
    const [rebootTimeout, setRebootTimeout] = useState(600);  // (#328): 10 min default, extend for Ceph/slow-boot nodes
    const [allowLocalDisks, setAllowLocalDisks] = useState(false);  // #330
    const [waitForReboot, setWaitForReboot] = useState(true);  // GitHub #40 - wait for node online before next
    const [pauseOnEvacError, setPauseOnEvacError] = useState(true);  // GitHub #40 - pause if VMs fail to migrate
    const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);  // Toggle for timeouts
    const [showConfirm, setShowConfirm] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [selectedNode, setSelectedNode] = useState(null);
    const [updatingNode, setUpdatingNode] = useState(null);
    const [showNodeUpdateConfirm, setShowNodeUpdateConfirm] = useState(null);
    const [nodeReboot, setNodeReboot] = useState(true);
    // Apr 2026: PBS update state
    const [showPbsUpdateConfirm, setShowPbsUpdateConfirm] = useState(null);
    const [pbsUpdateReboot, setPbsUpdateReboot] = useState(false);
    const [pbsUpdateStatus, setPbsUpdateStatus] = useState({});  // {pbs_id: {status, phase, output_lines, ...}}

    // Rolling update target ordering (nodes first, then PBS)
    const [nodeOrder, setNodeOrder] = useState([]);
    const [pbsOrder, setPbsOrder] = useState([]);

    // Auto-Update Scheduling
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [updateSchedule, setUpdateSchedule] = useState(null);
    const [scheduleEnabled, setScheduleEnabled] = useState(false);
    const [scheduleType, setScheduleType] = useState('recurring');  // 'once' or 'recurring'
    const [scheduleDay, setScheduleDay] = useState('sunday');
    const [scheduleTime, setScheduleTime] = useState('03:00');
    const [scheduleReboot, setScheduleReboot] = useState(true);
    const [scheduleSkipEvacuation, setScheduleSkipEvacuation] = useState(false);
    const [scheduleEvacTimeout, setScheduleEvacTimeout] = useState(1800);
    const [scheduleWaitForReboot, setScheduleWaitForReboot] = useState(true);
    const [scheduleShowAdvanced, setScheduleShowAdvanced] = useState(false);
    const [scheduleSaving, setScheduleSaving] = useState(false);

    // check if node has kernel updates
    const nodeHasKernelUpdates = (nodeData) => {
        return (nodeData?.updates || []).some(pkg =>
            pkg.Package?.includes('linux-image') ||
            pkg.Package?.includes('pve-kernel') ||
            pkg.Package?.includes('proxmox-kernel')
        );
    };

    // check if node has security updates
    const nodeHasSecurityUpdates = (nodeData) => {
        return (nodeData?.updates || []).some(pkg =>
            pkg.Origin?.includes('security') ||
            pkg.Section?.includes('security')
        );
    };

    // update single node
    const updateSingleNode = async (nodeName, withReboot) => {
        setShowNodeUpdateConfirm(null);
        setUpdatingNode(nodeName);
        try {
            // First try normal update (requires maintenance mode)
            let response = await fetch(`${API_URL}/clusters/${clusterId}/nodes/${nodeName}/update`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ reboot: withReboot })
            });
            let data = await response.json();

            // If node not in maintenance mode, ask user if they want to force
            if (!response.ok && data.error?.includes('Wartungsmodus')) {
                const forceUpdate = confirm(
                    `${t('nodeNotInMaintenance')}\n\n` +
                    `${t('forceUpdateWarning')}\n\n` +
                    `${t('continueAnyway')}`
                );

                if (forceUpdate) {
                    response = await fetch(`${API_URL}/clusters/${clusterId}/nodes/${nodeName}/update`, {
                        method: 'POST',
                        credentials: 'include',
                        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                        body: JSON.stringify({ reboot: withReboot, force: true })
                    });
                    data = await response.json();
                } else {
                    setUpdatingNode(null);
                    return;
                }
            }

            if (data.success || response.ok) {
                addToast(`${t('updateStarted')}: ${nodeName}`, 'success');

                // Poll for update completion and refresh list
                const pollUpdateStatus = setInterval(async () => {
                    try {
                        const statusRes = await fetch(`${API_URL}/clusters/${clusterId}/nodes/${nodeName}/update`, {
                            credentials: 'include',
                            headers: getAuthHeaders()
                        });
                        if (statusRes.ok) {
                            const statusData = await statusRes.json();
                            if (statusData.status === 'completed' || statusData.status === 'failed') {
                                clearInterval(pollUpdateStatus);
                                setUpdatingNode(null);
                                if (statusData.status === 'completed') {
                                    addToast(`${t('updateCompleted2')}: ${nodeName}`, 'success');
                                    // Clear cache and re-check updates
                                    localStorage.removeItem(`updateCheck_${clusterId}`);
                                    setTimeout(() => checkUpdates(), 2000);
                                }
                            }
                        }
                    } catch (e) {
                        // Ignore polling errors
                    }
                }, 5000);

                // Stop polling after 15 minutes max
                setTimeout(() => {
                    clearInterval(pollUpdateStatus);
                    setUpdatingNode(null);
                }, 15 * 60 * 1000);
            } else {
                addToast(data.error || 'Error starting update', 'error');
                setUpdatingNode(null);
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
            setUpdatingNode(null);
        }
    };

    // Check for updates with progress
    const [checkProgress, setCheckProgress] = useState(null);

    // 2026-04-24: pass `force` to bypass the 24h server cache.
    // Auto-fired checks (stale cache, post-rolling-update) run non-forced and
    // reuse the cached payload when fresh; only the Refresh button forces a poll.
    const checkUpdates = async (force = false) => {
        setChecking(true);
        setCheckProgress({ status: 'checking', message: t('checkingNodes2') });

        try {
            const res = await fetch(`${API_URL}/clusters/${clusterId}/updates/check`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ force: !!force }),
                // (offline): cap the soft-spin. This is same-origin
                // but the backend SSHes each node to run apt-update, which can
                // hang on an offline node/repo; without a client timeout the
                // "Checking..." spinner never resolves. 45s tolerates a legit
                // multi-node check but eventually gives up.
                signal: AbortSignal.timeout(45000),
            });

            const json = await res.json();

            if (json.success) {
                setUpdateStatus(json);
                localStorage.setItem(`updateCheck_${clusterId}`, JSON.stringify({
                    time: new Date().toISOString(),
                    summary: json.summary,
                    nodes: json.nodes,
                    // Keep PBS detail rows with the summary so reopening Settings
                    // cannot show a PBS-inclusive counter without the PBS section.
                    pbs: json.pbs || {}
                }));
                if (json.summary?.total_updates > 0) {
                    const failMsg = json.summary?.nodes_failed ? ` (${json.summary.nodes_failed} node(s) failed)` : '';
                    addToast(`${json.summary.total_updates} ${t('updatesAvailable')}${failMsg}`, 'info');
                } else if (json.summary?.nodes_failed > 0) {
                    addToast(`${json.summary.nodes_failed} node(s) failed update check`, 'warning');
                } else {
                    addToast(t('noUpdatesAvailable'), 'success');
                }
            } else {
                addToast(json.error || 'Error checking updates', 'error');
            }
        } catch (err) {
            console.error('Update check error:', err);
            addToast('Connection error checking updates', 'error');
        }
        setChecking(false);
        setCheckProgress(null);
    };

    // Load update schedule for this cluster
    const loadUpdateSchedule = async () => {
        try {
            const res = await fetch(`${API_URL}/clusters/${clusterId}/updates/schedule`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const data = await res.json();
                setUpdateSchedule(data);
                setScheduleEnabled(data.enabled || false);
                setScheduleType(data.schedule_type || 'recurring');
                setScheduleDay(data.day || 'sunday');
                setScheduleTime(data.time || '03:00');
                setScheduleReboot(data.include_reboot !== false);
                setScheduleSkipEvacuation(data.skip_evacuation || false);
                setScheduleEvacTimeout(data.evacuation_timeout || 1800);
                setScheduleWaitForReboot(data.wait_for_reboot !== false);
            }
        } catch (e) {
            console.error('Error loading update schedule:', e);
        }
    };

    // Save update schedule
    const saveUpdateSchedule = async () => {
        setScheduleSaving(true);
        try {
            const res = await fetch(`${API_URL}/clusters/${clusterId}/updates/schedule`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enabled: scheduleEnabled,
                    schedule_type: scheduleType,
                    day: scheduleDay,
                    time: scheduleTime,
                    include_reboot: scheduleReboot,
                    skip_evacuation: scheduleSkipEvacuation,
                    wait_for_reboot: scheduleWaitForReboot,
                    skip_up_to_date: true,
                    evacuation_timeout: scheduleEvacTimeout
                })
            });
            if (res.ok) {
                addToast(t('scheduleSaved'), 'success');
                setShowScheduleModal(false);
                loadUpdateSchedule();
            } else {
                const err = await res.json();
                addToast(err.error || 'Error saving schedule', 'error');
            }
        } catch (e) {
            addToast('Error saving schedule', 'error');
        }
        setScheduleSaving(false);
    };

    // Load schedule on mount
    useEffect(() => {
        loadUpdateSchedule();
    }, [clusterId]);

    // Initialise rolling update target order when the confirmation opens
    useEffect(() => {
        if (!showConfirm || !updateStatus) return;
        setNodeOrder(Object.keys(updateStatus.nodes || {}));
        setPbsOrder(Object.values(updateStatus.pbs || {}).map(p => p.pbs_id).filter(Boolean));
    }, [showConfirm, updateStatus]);

    // Apr 2026: poll PBS update status for any PBS visible in updateStatus
    useEffect(() => {
        if (!updateStatus?.pbs) return;
        const pbsIds = Object.values(updateStatus.pbs).map(p => p.pbs_id).filter(Boolean);
        if (pbsIds.length === 0) return;
        let cancelled = false;
        const poll = async () => {
            const next = {};
            for (const pid of pbsIds) {
                try {
                    const r = await fetch(`${API_URL}/pbs/${pid}/update`, {
                        credentials: 'include', headers: getAuthHeaders()
                    });
                    if (r?.ok) next[pid] = await r.json();
                } catch (e) { /* ignore */ }
            }
            if (!cancelled) setPbsUpdateStatus(next);
        };
        poll();
        const iv = setInterval(poll, 5000);
        return () => { cancelled = true; clearInterval(iv); };
    }, [updateStatus?.pbs ? Object.keys(updateStatus.pbs).length : 0]);

    // Get rolling update status
    const getRollingStatus = async () => {
        try {
            const r = await fetch(`${API_URL}/clusters/${clusterId}/updates/status`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            if (!r.ok) {
                // #179: don't clear on transient errors (node rebooting, API temporarily down)
                return;
            }
            const d = await r.json();
            if (d.success && d.rolling_update) {
                setRollingUpdate(d.rolling_update);
            } else if (d.success) {
                // only clear when API explicitly says no rolling update running
                setRollingUpdate(null);
            }
        } catch (e) {
            // #179: network error during node reboot — keep existing state, don't hide log
            console.warn('rolling status poll error:', e);
        }
    };

    // start rolling update
    const startRollingUpdate = async () => {
        setShowConfirm(false);
        try {
            const response = await fetch(`${API_URL}/clusters/${clusterId}/updates/rolling`, {
                method: 'POST',
                credentials: 'include',
                headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    include_reboot: includeReboot,
                    skip_up_to_date: skipUpToDate,
                    skip_evacuation: skipEvacuation,  // Issue #22 - skip VM evacuation (NOT RECOMMENDED)
                    wait_for_reboot: waitForReboot,  // GitHub
                    pause_on_evacuation_error: pauseOnEvacError,  // GitHub
                    evacuation_timeout: evacuationTimeout,
                    reboot_timeout: rebootTimeout,  // (#328): per-cluster override for slow-boot nodes
                    allow_local_disks: allowLocalDisks,  // #330
                    node_order: nodeOrder,
                    pbs_order: pbsOrder,
                })
            });
            const data = await response.json();
            if (data.success) {
                addToast(t('rollingUpdateInProgress'), 'info');
                setExpanded(true); // Auto-expand to show progress
                // Immediately fetch status to show progress UI
                setTimeout(() => getRollingStatus(), 500);
                setTimeout(() => getRollingStatus(), 1500);
            } else {
                addToast(data.error || 'Error starting rolling update', 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    // Reorder helpers for the rolling-update target lists
    const moveItem = (list, setList, idx, dir) => {
        if (dir === -1 && idx === 0) return;
        if (dir === 1 && idx === list.length - 1) return;
        const next = [...list];
        [next[idx], next[idx + dir]] = [next[idx + dir], next[idx]];
        setList(next);
    };

    // Cancel rolling update
    const cancelRollingUpdate = async () => {
        try {
            const response = await fetch(`${API_URL}/clusters/${clusterId}/updates/rolling`, {
                method: 'DELETE',
                credentials: 'include',
                headers: getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                addToast(t('cancelRollingUpdate') + ' ✓', 'info');
                setRollingUpdate(null);
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    // GitHub #40 - Resume a paused rolling update
    const resumeRollingUpdate = async () => {
        try {
            const response = await fetch(`${API_URL}/clusters/${clusterId}/updates/rolling/resume`, {
                method: 'POST',
                credentials: 'include',
                headers: getAuthHeaders()
            });
            const data = await response.json();
            if (data.success) {
                addToast('Rolling Update resumed', 'success');
                setTimeout(() => getRollingStatus(), 500);
            } else {
                addToast(data.error || 'Failed to resume', 'error');
            }
        } catch (error) {
            addToast(t('connectionError'), 'error');
        }
    };

    // Load cached update status and check daily
    useEffect(() => {
        // Reset state when cluster changes
        setUpdateStatus(null);
        setRollingUpdate(null);
        setSelectedNode(null);
        setUpdatingNode(null);
        setExpanded(false);

        // Check rolling update status
        getRollingStatus();

        // Load cached status from localStorage
        const cached = localStorage.getItem(`updateCheck_${clusterId}`);
        if (cached) {
            try {
                const data = JSON.parse(cached);
                // Show cached node and PBS details immediately. Older cache
                // entries omitted `pbs`, which produced a PBS-inclusive badge
                // with no PBS rows; refresh those entries to repair the cache.
                if (data.summary) {
                    setUpdateStatus({ summary: data.summary, nodes: data.nodes || {}, pbs: data.pbs || {} });
                }
                const lastCheck = new Date(data.time);
                const hoursSince = (Date.now() - lastCheck.getTime()) / (1000 * 60 * 60);
                const missingPbsDetails = (data.summary?.total_pbs || data.summary?.pbs_with_updates) && !data.pbs;
                if (hoursSince > 24 || missingPbsDetails) {
                    checkUpdates();
                }
            } catch (e) {
                checkUpdates();
            }
        } else {
            // No cache - do initial check
            checkUpdates();
        }

        // Poll for rolling update status every 3 seconds (always poll, let the function decide)
        const interval = setInterval(() => {
            getRollingStatus();
        }, 3000);
        return () => clearInterval(interval);
    }, [clusterId]);

    // #183: auto-refresh update counts when rolling update finishes
    useEffect(() => {
        if (rollingUpdate && ['completed', 'failed', 'cancelled'].includes(rollingUpdate.status)) {
            localStorage.removeItem(`updateCheck_${clusterId}`);
            checkUpdates();
        }
    }, [rollingUpdate?.status]);

    const totalUpdates = updateStatus?.summary?.total_updates || 0;
    const nodesWithUpdates = updateStatus?.summary?.nodes_with_updates || 0;
    const pbsWithUpdates = updateStatus?.summary?.pbs_with_updates || 0;
    const nodesFailed = updateStatus?.summary?.nodes_failed || 0;
    const totalTargets = (updateStatus?.summary?.total_nodes || 0) + (updateStatus?.summary?.total_pbs || 0);
    const targetsWithUpdates = (nodesWithUpdates || 0) + (pbsWithUpdates || 0);

    // Check for kernel updates
    // Kernel updates require reboot, so we flag them seperately
    const hasKernelUpdates = updateStatus && Object.values(updateStatus.nodes || {}).some(node =>
        (node.updates || []).some(pkg =>
            pkg.Package?.includes('linux-image') || pkg.Package?.includes('pve-kernel')
        )
    );

    // Get last check info
    const lastCheckInfo = (() => {
        const cached = localStorage.getItem(`updateCheck_${clusterId}`);
        if (cached) {
            try {
                const data = JSON.parse(cached);
                return new Date(data.time).toLocaleString();
            } catch (e) { }
        }
        return t('neverChecked');
    })();

    return (
        <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-card border border-proxmox-border rounded-xl overflow-hidden"}>
            {/* Header - always visible */}
            <div
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-proxmox-hover/50 transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-proxmox-dark flex items-center justify-center">
                        <Icons.Download />
                    </div>
                    <div>
                        <h3 className={isCorporate ? 'corp-card-header' : "font-semibold text-white"}>{t('updateManager')}</h3>
                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-400"}>
                            {totalUpdates > 0 ? (
                                <span className="text-yellow-400">{totalUpdates} {t('updatesAvailable')}{nodesFailed > 0 ? ` (${nodesFailed} failed)` : ''}</span>
                            ) : nodesFailed > 0 ? (
                                <span className="text-red-400">{nodesFailed} node(s) failed check</span>
                            ) : updateStatus ? (
                                <span className="text-green-400">{t('noUpdatesAvailable')}</span>
                            ) : (
                                <span>{t('lastChecked')}: {lastCheckInfo}</span>
                            )}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {totalUpdates > 0 && (
                        <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded-full text-xs font-medium">
                            {totalUpdates}
                        </span>
                    )}
                    {hasKernelUpdates && (
                        <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded-full text-xs font-medium">
                            Kernel
                        </span>
                    )}
                    <Icons.ChevronDown className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </div>
            </div>

            {/* Expanded content */}
            {expanded && (
                <div className="border-t border-proxmox-border p-4 space-y-4">
                    {/* Actions */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={(e) => { e.stopPropagation(); checkUpdates(true); }}
                            disabled={checking}
                            className="px-4 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-sm hover:border-proxmox-orange transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                            {checking ? (
                                <div className="animate-spin w-4 h-4 border-2 border-proxmox-orange border-t-transparent rounded-full"></div>
                            ) : (
                                <Icons.RefreshCw />
                            )}
                            {t('checkForUpdates')}
                        </button>

                        {/* Schedule button */}
                        {isAdmin && (
                            <button
                                onClick={(e) => { e.stopPropagation(); setShowScheduleModal(true); }}
                                className={`px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${scheduleEnabled
                                    ? 'bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30'
                                    : 'bg-proxmox-dark border border-proxmox-border text-gray-400 hover:bg-proxmox-hover'
                                    }`}
                                title={scheduleEnabled ? `${t('scheduledFor')}: ${scheduleDay} ${scheduleTime}` : t('scheduleUpdates')}
                            >
                                <Icons.Clock />
                                {scheduleEnabled ? (
                                    <span className="hidden sm:inline">{scheduleDay.charAt(0).toUpperCase() + scheduleDay.slice(1)} {scheduleTime}</span>
                                ) : (
                                    <span className="hidden sm:inline">{t('schedule')}</span>
                                )}
                            </button>
                        )}

                        {isAdmin && totalUpdates > 0 && !rollingUpdate && (
                            <button
                                onClick={(e) => { e.stopPropagation(); setShowConfirm(true); }}
                                className="px-4 py-2 bg-proxmox-orange rounded-lg text-white text-sm hover:bg-orange-600 transition-colors flex items-center gap-2"
                            >
                                <Icons.Play />
                                {t('startRollingUpdate')}
                            </button>
                        )}
                    </div>

                    {/* Check Progress Indicator */}
                    {checking && checkProgress && (
                        <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                            <div className="flex items-center gap-3">
                                <div className="relative">
                                    <div className="animate-spin w-8 h-8 border-3 border-blue-400 border-t-transparent rounded-full"></div>
                                    <Icons.Server className="absolute inset-0 m-auto w-4 h-4 text-blue-400" />
                                </div>
                                <div>
                                    <div className="text-blue-400 font-medium">{t('checkingForUpdates')}</div>
                                    <div className="text-sm text-gray-400">{checkProgress.message}</div>
                                </div>
                            </div>
                            <div className="mt-3 w-full bg-proxmox-dark rounded-full h-1.5 overflow-hidden">
                                <div className="bg-blue-400 h-full rounded-full animate-pulse" style={{ width: '100%' }}></div>
                            </div>
                        </div>
                    )}

                    {/* Kernel Update Warning */}
                    {hasKernelUpdates && (
                        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
                            <span className="text-red-400">⚠️</span>
                            <div>
                                <p className="text-red-400 text-sm font-medium">Kernel Update Available</p>
                                <p className="text-red-300/70 text-xs">{t('includeRebootHint')}</p>
                            </div>
                        </div>
                    )}

                    {/* Node Status Cards */}
                    {updateStatus && (
                        <div className="space-y-2">
                            {Object.entries(updateStatus.nodes || {}).map(([nodeName, nodeData]) => {
                                const hasKernel = nodeHasKernelUpdates(nodeData);
                                const hasSecurity = nodeHasSecurityUpdates(nodeData);
                                const isExpanded = selectedNode === nodeName;
                                const isUpdating = updatingNode === nodeName;

                                return (
                                    <div key={nodeName} className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark rounded-lg border border-proxmox-border overflow-hidden"}>
                                        {/* Node Header */}
                                        <div
                                            className="p-3 flex items-center justify-between cursor-pointer hover:bg-proxmox-hover/30 transition-colors"
                                            onClick={() => setSelectedNode(isExpanded ? null : nodeName)}
                                        >
                                            <div className="flex items-center gap-3">
                                                <Icons.Server className="w-4 h-4 text-gray-400" />
                                                <span className="text-sm font-medium text-white">{nodeName}</span>
                                                {hasKernel && (
                                                    <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded text-xs">
                                                        Kernel
                                                    </span>
                                                )}
                                                {hasSecurity && (
                                                    <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded text-xs">
                                                        Security
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {isUpdating && (
                                                    <div className="flex items-center gap-2 text-blue-400 text-xs">
                                                        <div className="animate-spin w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full"></div>
                                                        Updating...
                                                    </div>
                                                )}
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${!nodeData.success ? 'bg-red-500/20 text-red-400' :
                                                    nodeData.count > 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'
                                                    }`}>
                                                    {!nodeData.success ? `⚠ ${t('checkFailed')}` : `${nodeData.count || 0} ${t('updates')}`}
                                                </span>
                                                <Icons.ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                            </div>
                                        </div>

                                        {/* Expanded Package List */}
                                        {isExpanded && (
                                            <div className="border-t border-proxmox-border">
                                                {nodeData.count > 0 ? (
                                                    <>
                                                        {/* Update Actions */}
                                                        {isAdmin && (
                                                            <div className="p-3 bg-proxmox-darker border-b border-proxmox-border flex items-center gap-2">
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setNodeReboot(hasKernel);
                                                                        setShowNodeUpdateConfirm(nodeName);
                                                                    }}
                                                                    disabled={isUpdating}
                                                                    className="px-3 py-1.5 bg-proxmox-orange hover:bg-orange-600 rounded text-white text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
                                                                >
                                                                    <Icons.Download className="w-3 h-3" />
                                                                    {t('updateThisNode')}
                                                                </button>
                                                                {hasKernel && (
                                                                    <span className="text-xs text-red-400 flex items-center gap-1">
                                                                        <Icons.AlertTriangle className="w-3 h-3" />
                                                                        {t('rebootRequired')}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* Package List */}
                                                        <div className="max-h-64 overflow-y-auto">
                                                            <table className="w-full text-xs">
                                                                <thead className="bg-proxmox-darker sticky top-0">
                                                                    <tr>
                                                                        <th className="text-left p-2 text-gray-400 font-medium">{t('package')}</th>
                                                                        <th className="text-left p-2 text-gray-400 font-medium">{t('currentVersion2')}</th>
                                                                        <th className="text-left p-2 text-gray-400 font-medium">{t('newVersion')}</th>
                                                                        <th className="text-left p-2 text-gray-400 font-medium">{t('type')}</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {(nodeData.updates || []).map((pkg, idx) => {
                                                                        const isKernelPkg = pkg.Package?.includes('linux-image') || pkg.Package?.includes('kernel');
                                                                        const isSecurityPkg = pkg.Origin?.includes('security') || pkg.Section?.includes('security');

                                                                        return (
                                                                            <tr key={idx} className="border-t border-gray-700/50 hover:bg-proxmox-hover/20">
                                                                                <td className="p-2 font-mono text-white">
                                                                                    {pkg.Package || 'unknown'}
                                                                                </td>
                                                                                <td className="p-2 font-mono text-gray-400 truncate max-w-24" title={pkg.OldVersion}>
                                                                                    {pkg.OldVersion?.substring(0, 15) || '-'}
                                                                                </td>
                                                                                <td className="p-2 font-mono text-green-400 truncate max-w-24" title={pkg.Version}>
                                                                                    {pkg.Version?.substring(0, 15) || '-'}
                                                                                </td>
                                                                                <td className="p-2">
                                                                                    {isKernelPkg ? (
                                                                                        <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded">Kernel</span>
                                                                                    ) : isSecurityPkg ? (
                                                                                        <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded">Security</span>
                                                                                    ) : (
                                                                                        <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">Update</span>
                                                                                    )}
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </>
                                                ) : !nodeData.success ? (
                                                    <div className="p-4 text-center text-sm">
                                                        <Icons.AlertTriangle className="w-6 h-6 mx-auto mb-2 text-red-400" />
                                                        <p className="text-red-400 font-medium">{t('checkFailed2')}</p>
                                                        <p className="text-gray-500 mt-1 text-xs">{nodeData.error || 'Connection error'}</p>
                                                    </div>
                                                ) : (
                                                    <div className="p-4 text-center text-gray-500 text-sm">
                                                        <Icons.CheckCircle className="w-6 h-6 mx-auto mb-2 text-green-400" />
                                                        {t('noUpdatesForNode')}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* PBS Server Updates - (#240), upgrade execution */}
                    {updateStatus?.pbs && Object.keys(updateStatus.pbs).length > 0 && (
                        <div className="space-y-2 mt-4">
                            <h4 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "text-sm font-medium text-gray-400 flex items-center gap-2"}>
                                <Icons.Shield className="w-4 h-4" />
                                Proxmox Backup Server
                            </h4>
                            {Object.entries(updateStatus.pbs).map(([pbsName, pbsData]) => {
                                const pbsKey = `pbs_${pbsName}`;
                                const pbsJob = pbsUpdateStatus[pbsData.pbs_id];
                                const isUpdating = pbsJob && ['starting', 'updating', 'rebooting', 'waiting_online'].includes(pbsJob.status);
                                return (
                                    <div key={pbsName} className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark rounded-lg border border-proxmox-border overflow-hidden"}>
                                        <div className="p-3 flex items-center justify-between cursor-pointer hover:bg-proxmox-hover/30"
                                            onClick={() => setSelectedNode(selectedNode === pbsKey ? null : pbsKey)}>
                                            <div className="flex items-center gap-3">
                                                <Icons.Shield className="w-4 h-4 text-blue-400" />
                                                <span className="text-sm font-medium text-white">{pbsName}</span>
                                                {isUpdating && (
                                                    <span className="flex items-center gap-1 text-blue-400 text-xs">
                                                        <div className="animate-spin w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full"></div>
                                                        {pbsJob.phase || pbsJob.status}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${!pbsData.success ? 'bg-red-500/20 text-red-400' :
                                                    pbsData.count > 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'
                                                    }`}>
                                                    {!pbsData.success ? '⚠ Check failed' : `${pbsData.count || 0} updates`}
                                                </span>
                                                <Icons.ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${selectedNode === pbsKey ? 'rotate-180' : ''}`} />
                                            </div>
                                        </div>
                                        {selectedNode === pbsKey && (
                                            <div className="border-t border-proxmox-border">
                                                {isAdmin && pbsData.count > 0 && !isUpdating && (
                                                    <div className="p-3 bg-proxmox-darker border-b border-proxmox-border flex items-center gap-2">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setShowPbsUpdateConfirm({ id: pbsData.pbs_id, name: pbsName, count: pbsData.count }); }}
                                                            className="px-3 py-1.5 bg-proxmox-orange hover:bg-orange-600 rounded text-white text-xs font-medium transition-colors flex items-center gap-1"
                                                        >
                                                            <Icons.Download className="w-3 h-3" />
                                                            {t('updatePbsServer')}
                                                        </button>
                                                        <span className="text-xs text-gray-500">SSH-based apt dist-upgrade</span>
                                                    </div>
                                                )}
                                                {pbsJob && (pbsJob.output_lines || []).length > 0 && (
                                                    <div className="p-3 bg-black/50 max-h-48 overflow-y-auto font-mono text-xs">
                                                        {(pbsJob.output_lines || []).map((line, i) => {
                                                            // Backend sends output_lines as {timestamp, text} objects (#240).
                                                            // Fall back to String() only for legacy/plain-string entries.
                                                            const text = line && typeof line === 'object' ? String(line.text || '') : String(line || '');
                                                            return <div key={i} className={`${text.includes('[ERROR]') ? 'text-red-400' : text.includes('[OK]') ? 'text-green-400' : 'text-gray-300'}`}>{text}</div>;
                                                        })}
                                                        {pbsJob.error && <div className="text-red-400 mt-2">⚠ {pbsJob.error}</div>}
                                                    </div>
                                                )}
                                                {pbsData.count > 0 && (
                                                    <div className="max-h-48 overflow-y-auto">
                                                        <table className="w-full text-xs">
                                                            <thead><tr className="text-gray-500 border-b border-proxmox-border">
                                                                <th className="text-left p-2">Package</th><th className="text-left p-2">Version</th>
                                                            </tr></thead>
                                                            <tbody>
                                                                {(pbsData.updates || []).map((pkg, i) => (
                                                                    <tr key={i} className="border-b border-proxmox-border/50">
                                                                        <td className="p-2 text-white">{pkg.Package || pkg.package || '-'}</td>
                                                                        <td className="p-2 text-gray-400">{pkg.Version || pkg.version || '-'}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* PBS update confirm + trigger */}
                    {showPbsUpdateConfirm && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop" onClick={() => setShowPbsUpdateConfirm(null)}>
                            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-card border border-proxmox-border rounded-xl p-5 max-w-md w-full"} onClick={e => e.stopPropagation()}>
                                <h3 className={isCorporate ? 'corp-card-header mb-3 flex items-center gap-2' : "text-lg font-semibold text-white mb-3 flex items-center gap-2"}>
                                    <Icons.Download />
                                    {t('updatePbsServer2')}: {showPbsUpdateConfirm.name}
                                </h3>
                                <p className={isCorporate ? 'corp-help-text mb-3' : "text-sm text-gray-400 mb-3"}>{showPbsUpdateConfirm.count} {t('updates')} {t('willBeInstalled')}</p>
                                <label className="flex items-center gap-2 text-sm text-gray-300 mb-4">
                                    <input type="checkbox" checked={pbsUpdateReboot} onChange={e => setPbsUpdateReboot(e.target.checked)} className="rounded" />
                                    {t('rebootAfter')}
                                </label>
                                <div className="flex gap-2 justify-end">
                                    <button onClick={() => setShowPbsUpdateConfirm(null)} className="px-3 py-1.5 text-gray-400 hover:text-white text-sm">{t('cancel')}</button>
                                    <button
                                        onClick={async () => {
                                            try {
                                                const r = await fetch(`${API_URL}/pbs/${showPbsUpdateConfirm.id}/update`, {
                                                    method: 'POST',
                                                    credentials: 'include',
                                                    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ reboot: pbsUpdateReboot })
                                                });
                                                if (r?.ok) addToast('PBS update started', 'success');
                                                else {
                                                    const err = await r?.json().catch(() => ({}));
                                                    addToast(err.error || 'Failed to start update', 'error');
                                                }
                                            } catch (e) { addToast('Connection error', 'error'); }
                                            setShowPbsUpdateConfirm(null);
                                        }}
                                        className="px-3 py-1.5 bg-proxmox-orange hover:bg-orange-600 rounded text-white text-sm flex items-center gap-1"
                                    ><Icons.Download className="w-3 h-3" />{t('startUpdate')}</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Single Node Update Confirm Modal */}
                    {showNodeUpdateConfirm && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop" onClick={() => setShowNodeUpdateConfirm(null)}>
                            <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-card border border-proxmox-border rounded-xl p-5 max-w-md w-full animate-scale-in"} onClick={e => e.stopPropagation()}>
                                <h3 className={isCorporate ? 'corp-card-header mb-3 flex items-center gap-2' : "text-lg font-semibold text-white mb-3 flex items-center gap-2"}>
                                    <Icons.Download />
                                    {t('updateNode')}: {showNodeUpdateConfirm}
                                </h3>

                                <p className="text-gray-400 text-sm mb-4">
                                    {t('updateNodeDesc')}
                                </p>

                                {nodeHasKernelUpdates(updateStatus?.nodes?.[showNodeUpdateConfirm]) && (
                                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg mb-4 flex items-start gap-2">
                                        <Icons.AlertTriangle className="w-4 h-4 text-red-400 mt-0.5" />
                                        <div className="text-xs">
                                            <p className="text-red-400 font-medium">{t('kernelUpdateDetected')}</p>
                                            <p className="text-red-300/70">{t('rebootRecommended')}</p>
                                        </div>
                                    </div>
                                )}

                                <label className="flex items-center gap-2 mb-4 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={nodeReboot}
                                        onChange={(e) => setNodeReboot(e.target.checked)}
                                        className="rounded"
                                    />
                                    <span className="text-sm text-gray-300">{t('rebootAfterUpdate')}</span>
                                </label>

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setShowNodeUpdateConfirm(null)}
                                        className="flex-1 px-4 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-gray-400 hover:text-white transition-colors"
                                    >
                                        {t('cancel')}
                                    </button>
                                    <button
                                        onClick={() => updateSingleNode(showNodeUpdateConfirm, nodeReboot)}
                                        className="flex-1 px-4 py-2 bg-proxmox-orange hover:bg-orange-600 rounded-lg text-white font-medium transition-colors"
                                    >
                                        {t('startUpdate')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Rolling Update Completed/Failed Banner (#183) */}
                    {rollingUpdate && (rollingUpdate.status === 'completed' || rollingUpdate.status === 'failed' || rollingUpdate.status === 'cancelled') && (
                        <div className={`p-4 ${rollingUpdate.status === 'completed' ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'} rounded-lg`}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {rollingUpdate.status === 'completed' ? (
                                        <Icons.CheckCircle className="w-5 h-5 text-green-400" />
                                    ) : (
                                        <Icons.XCircle className="w-5 h-5 text-red-400" />
                                    )}
                                    <span className={`font-semibold ${rollingUpdate.status === 'completed' ? 'text-green-400' : 'text-red-400'}`}>
                                        {rollingUpdate.status === 'completed' ? (t('rollingUpdateCompleted')) :
                                            rollingUpdate.status === 'cancelled' ? (t('rollingUpdateCancelled')) :
                                                (t('rollingUpdateFailed'))}
                                    </span>
                                </div>
                                <button
                                    onClick={() => setRollingUpdate(null)}
                                    className="text-xs text-gray-300 hover:text-white px-2 py-1 bg-proxmox-hover hover:bg-proxmox-border rounded transition-colors"
                                >
                                    ✕ {t('dismiss')}
                                </button>
                            </div>
                            {(rollingUpdate.completed_nodes?.length > 0 || rollingUpdate.failed_nodes?.length > 0) && (
                                <p className={isCorporate ? 'corp-help-text mt-2' : "text-xs text-gray-400 mt-2"}>
                                    {rollingUpdate.completed_nodes?.length || 0}/{rollingUpdate.nodes?.length || '?'} {t('nodesUpdated')}
                                    {rollingUpdate.failed_nodes?.length > 0 && `, ${rollingUpdate.failed_nodes.length} failed`}
                                    {rollingUpdate.skipped_nodes?.length > 0 && `, ${rollingUpdate.skipped_nodes.length} skipped`}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Rolling Update Progress */}
                    {rollingUpdate && (rollingUpdate.status === 'running' || rollingUpdate.status === 'paused') && (
                        <div className={`p-4 ${rollingUpdate.status === 'paused' ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-blue-500/10 border border-blue-500/30'} rounded-lg space-y-4`}>
                            {/* GitHub #40 - Paused Banner */}
                            {rollingUpdate.status === 'paused' && (
                                <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-4 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <Icons.AlertTriangle className="w-5 h-5 text-yellow-400" />
                                        <span className="text-yellow-400 font-semibold text-lg">Rolling Update Paused</span>
                                    </div>
                                    {rollingUpdate.paused_details && (
                                        <div className="text-sm text-yellow-200/80">
                                            {rollingUpdate.paused_details.message}
                                        </div>
                                    )}
                                    {/* Show failed VMs if evacuation failure */}
                                    {rollingUpdate.paused_reason === 'evacuation_failures' && rollingUpdate.paused_details?.failed_vms && (
                                        <div className="space-y-1 mt-2">
                                            <p className="text-xs text-yellow-400 font-medium">Failed VMs:</p>
                                            {rollingUpdate.paused_details.failed_vms.map((vm, i) => (
                                                <div key={i} className="flex items-center gap-2 text-xs text-red-400 bg-red-900/20 rounded px-2 py-1">
                                                    <Icons.XCircle className="w-3 h-3" />
                                                    <span className="font-mono">{vm.name} (VMID: {vm.vmid})</span>
                                                    {vm.error && <span className="text-gray-500">- {vm.error}</span>}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className="flex gap-3 mt-3">
                                        <button
                                            onClick={resumeRollingUpdate}
                                            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                                        >
                                            <Icons.Play className="w-4 h-4" />
                                            Continue Update
                                        </button>
                                        <button
                                            onClick={cancelRollingUpdate}
                                            className="px-4 py-2 bg-red-600/30 hover:bg-red-600/50 text-red-400 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                                        >
                                            <Icons.X className="w-4 h-4" />
                                            Cancel Update
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Header with cancel button */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {rollingUpdate.status === 'paused' ? (
                                        <Icons.Pause className="w-5 h-5 text-yellow-400" />
                                    ) : (
                                        <div className="animate-spin w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full"></div>
                                    )}
                                    <span className={`${rollingUpdate.status === 'paused' ? 'text-yellow-400' : 'text-blue-400'} font-semibold text-lg`}>
                                        {rollingUpdate.status === 'paused' ? 'Update Paused' : t('rollingUpdateInProgress')}
                                    </span>
                                </div>
                                {rollingUpdate.status === 'running' && (
                                    <button
                                        onClick={cancelRollingUpdate}
                                        className="px-3 py-1.5 text-sm bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors flex items-center gap-1"
                                    >
                                        <Icons.X className="w-4 h-4" />
                                        {t('cancel')}
                                    </button>
                                )}
                            </div>

                            {/* Current status */}
                            <div className="bg-proxmox-dark rounded-lg p-4">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
                                    <div>
                                        <span className="text-gray-400">{t('currentNode')}:</span>
                                        <div className="text-white font-mono font-semibold">{rollingUpdate.current_node || '-'}</div>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">{t('currentStep')}:</span>
                                        <div className="text-yellow-400 font-medium capitalize">{rollingUpdate.current_step || '-'}</div>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">{t('progress')}:</span>
                                        <div className="text-white font-mono">{(rollingUpdate.current_index || 0) + 1} / {rollingUpdate.nodes?.length || 0}</div>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">{t('started')}:</span>
                                        <div className="text-gray-300 text-xs">{rollingUpdate.started_at || '-'}</div>
                                    </div>
                                </div>

                                {/* Progress bar */}
                                <div className="w-full bg-proxmox-darker rounded-full h-3 overflow-hidden">
                                    <div
                                        className="bg-gradient-to-r from-blue-500 to-blue-400 h-full rounded-full transition-all duration-500 relative"
                                        style={{ width: `${((rollingUpdate.current_index || 0) + 1) / (rollingUpdate.nodes?.length || 1) * 100}%` }}
                                    >
                                        <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                                    </div>
                                </div>
                            </div>

                            {/* Node status overview */}
                            <div className="flex flex-wrap gap-2">
                                {(rollingUpdate.nodes || []).map((nodeName, idx) => {
                                    const isCompleted = (rollingUpdate.completed_nodes || []).includes(nodeName);
                                    const isFailed = (rollingUpdate.failed_nodes || []).some(f => f.node === nodeName);
                                    const isCurrent = rollingUpdate.current_node === nodeName;
                                    const isPending = !isCompleted && !isFailed && !isCurrent;

                                    return (
                                        <div
                                            key={nodeName}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 ${isCompleted ? 'bg-green-500/20 text-green-400' :
                                                isFailed ? 'bg-red-500/20 text-red-400' :
                                                    isCurrent ? 'bg-blue-500/20 text-blue-400 animate-pulse' :
                                                        'bg-gray-500/20 text-gray-400'
                                                }`}
                                        >
                                            {isCompleted && <Icons.CheckCircle className="w-3 h-3" />}
                                            {isFailed && <Icons.XCircle className="w-3 h-3" />}
                                            {isCurrent && <div className="w-2 h-2 bg-blue-400 rounded-full animate-ping"></div>}
                                            {isPending && <Icons.Clock className="w-3 h-3" />}
                                            {nodeName}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Logs */}
                            {rollingUpdate.logs && rollingUpdate.logs.length > 0 && (
                                <div className="bg-proxmox-darker rounded-lg overflow-hidden">
                                    <div className="px-3 py-2 bg-proxmox-dark border-b border-proxmox-border flex items-center justify-between">
                                        <span className="text-sm font-medium text-gray-300 flex items-center gap-2">
                                            <Icons.Terminal className="w-4 h-4" />
                                            {t('updateLogs')}
                                        </span>
                                        <span className="text-xs text-gray-500">{rollingUpdate.logs.length} entries</span>
                                    </div>
                                    <div className="max-h-48 overflow-y-auto p-3 font-mono text-xs space-y-1">
                                        {rollingUpdate.logs.map((log, idx) => (
                                            <div
                                                key={idx}
                                                className={`${log.includes('ERROR') || log.includes('Failed:') ? 'text-red-400' :
                                                    log.includes('PAUSED') || log.includes('Warning') ? 'text-yellow-400' :
                                                        log.includes('Resumed') || log.includes('successfully') || log.includes('completed') || log.includes('back online') ? 'text-green-400' :
                                                            log.includes('Starting') || log.includes('Processing') ? 'text-blue-400' :
                                                                'text-gray-400'
                                                    }`}
                                            >
                                                {log}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Rolling Update Completed - only show if recent (< 10 min) */}
                    {rollingUpdate && rollingUpdate.status === 'completed' && rollingUpdate.completed_at && (() => {
                        const completedTime = new Date(rollingUpdate.completed_at.replace(' ', 'T'));
                        const ageMinutes = (Date.now() - completedTime.getTime()) / 1000 / 60;
                        return !isNaN(ageMinutes) && ageMinutes < 10;
                    })() && (
                            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center justify-between">
                                <div className="flex items-center gap-2 text-green-400">
                                    <Icons.CheckCircle />
                                    <span>{t('updateCompleted')}</span>
                                </div>
                                <button
                                    onClick={async () => {
                                        setRollingUpdate(null);
                                        // Clear backend status too
                                        try {
                                            await fetch(`${API_URL}/clusters/${clusterId}/updates/rolling/clear`, {
                                                method: 'POST',
                                                credentials: 'include',
                                                headers: getAuthHeaders()
                                            });
                                        } catch (e) { }
                                        // Clear cache and re-check updates
                                        localStorage.removeItem(`updateCheck_${clusterId}`);
                                        checkUpdates();
                                    }}
                                    className="text-xs text-gray-400 hover:text-white"
                                >
                                    {t('dismiss')}
                                </button>
                            </div>
                        )}

                    {/* Rolling Update Failed */}
                    {rollingUpdate && rollingUpdate.status === 'failed' && (
                        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-red-400">
                                    <Icons.XCircle />
                                    <span className="font-semibold">{t('updateFailed2')}</span>
                                </div>
                                <button
                                    onClick={async () => {
                                        setRollingUpdate(null);
                                        try {
                                            await fetch(`${API_URL}/clusters/${clusterId}/updates/rolling/clear`, {
                                                method: 'POST',
                                                credentials: 'include',
                                                headers: getAuthHeaders()
                                            });
                                        } catch (e) { }
                                        localStorage.removeItem(`updateCheck_${clusterId}`);
                                        checkUpdates();
                                    }}
                                    className="text-xs text-gray-400 hover:text-white"
                                >
                                    {t('dismiss')}
                                </button>
                            </div>

                            {/* Error message */}
                            {rollingUpdate.error && (
                                <div className="p-2 bg-red-500/20 rounded text-red-300 text-sm font-mono">
                                    {rollingUpdate.error}
                                </div>
                            )}

                            {/* Failed nodes with their errors */}
                            {rollingUpdate.failed_nodes && rollingUpdate.failed_nodes.length > 0 && (
                                <div className="space-y-2">
                                    <span className="text-sm text-gray-400">{t('failedNodes')}:</span>
                                    {rollingUpdate.failed_nodes.map((fn, idx) => (
                                        <div key={idx} className="p-2 bg-proxmox-dark rounded-lg">
                                            <div className="flex items-center gap-2 text-red-400 text-sm font-medium">
                                                <Icons.Server className="w-4 h-4" />
                                                {fn.node}
                                            </div>
                                            {fn.error && (
                                                <pre className="mt-1 text-xs text-red-300/70 whitespace-pre-wrap max-h-24 overflow-auto">
                                                    {fn.error}
                                                </pre>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Warning about maintenance mode */}
                            <div className="p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-300 text-xs flex items-start gap-2">
                                <span className="mt-0.5">⚠️</span>
                                <span>{t('maintenanceModeWarning')}</span>
                            </div>

                            {/* Logs expandable */}
                            {rollingUpdate.logs && rollingUpdate.logs.length > 0 && (
                                <details className="bg-proxmox-dark rounded-lg overflow-hidden">
                                    <summary className="px-3 py-2 cursor-pointer text-sm text-gray-400 hover:text-white">
                                        {t('viewLogs')} ({rollingUpdate.logs.length})
                                    </summary>
                                    <div className="max-h-48 overflow-y-auto p-3 font-mono text-xs space-y-1 border-t border-proxmox-border">
                                        {rollingUpdate.logs.map((log, idx) => (
                                            <div
                                                key={idx}
                                                className={`${log.includes('ERROR') || log.includes('✗') ? 'text-red-400' :
                                                    log.includes('✓') || log.includes('successfully') ? 'text-green-400' :
                                                        log.includes('Starting') ? 'text-blue-400' :
                                                            'text-gray-400'
                                                    }`}
                                            >
                                                {log}
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Confirm Modal */}
            {showConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop" onClick={() => setShowConfirm(false)}>
                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-card border border-proxmox-border rounded-2xl p-6 max-w-md w-full animate-scale-in"} onClick={e => e.stopPropagation()}>
                        <h3 className={isCorporate ? 'corp-card-header mb-2' : "text-lg font-semibold text-white mb-2"}>{t('confirmRollingUpdate')}</h3>
                        <p className="text-gray-400 text-sm mb-4">{t('rollingUpdateWarning')}</p>

                        <div className="space-y-3 mb-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={includeReboot}
                                    onChange={(e) => setIncludeReboot(e.target.checked)}
                                    className="w-4 h-4 rounded border-proxmox-border bg-proxmox-dark text-proxmox-orange focus:ring-proxmox-orange"
                                />
                                <span className="text-white">{t('includeReboot')}</span>
                                {hasKernelUpdates && <span className="text-xs text-red-400">(Recommended)</span>}
                            </label>


                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={skipUpToDate}
                                    onChange={(e) => setSkipUpToDate(e.target.checked)}
                                    className="w-4 h-4 rounded border-proxmox-border bg-proxmox-dark text-proxmox-orange focus:ring-proxmox-orange"
                                />
                                <span className="text-white">{t('skipUpToDate')}</span>
                            </label>

                            {/* Skip evacuation - moved from advanced options for visibility */}
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={skipEvacuation}
                                    onChange={(e) => setSkipEvacuation(e.target.checked)}
                                    className="w-4 h-4 rounded border-proxmox-border bg-proxmox-dark text-red-500 focus:ring-red-500"
                                />
                                <span className="text-red-400">{t('skipEvacuation')}</span>
                                <span className="text-xs bg-red-900/30 text-red-400 px-1.5 py-0.5 rounded">{t('notRecommended')}</span>
                            </label>
                            {skipEvacuation && (
                                <div className="ml-6 p-2 bg-red-900/20 border border-red-800 rounded text-xs text-red-400">
                                    {t('skipEvacuationWarning2')}
                                </div>
                            )}

                            {/* Advanced options toggle */}
                            <button
                                onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                                className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
                            >
                                <Icons.ChevronRight className={`w-3 h-3 transition-transform ${showAdvancedOptions ? 'rotate-90' : ''}`} />
                                {t('advancedOptions')}
                            </button>

                            {showAdvancedOptions && (
                                <div className="ml-4 space-y-3 p-3 bg-proxmox-dark rounded-lg">
                                    {/* GitHub #40 - Wait for reboot */}
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={waitForReboot}
                                            onChange={(e) => setWaitForReboot(e.target.checked)}
                                            className="w-4 h-4 rounded border-proxmox-border bg-proxmox-darker text-proxmox-orange focus:ring-proxmox-orange"
                                            disabled={!includeReboot}
                                        />
                                        <div>
                                            <span className="text-white text-sm">Wait for node to come back online before next</span>
                                            <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>Prevents migrating VMs to a still-rebooting node</p>
                                        </div>
                                    </label>
                                    {!waitForReboot && includeReboot && (
                                        <div className="ml-6 p-2 bg-yellow-900/20 border border-yellow-800 rounded text-xs text-yellow-400">
                                            Warning: Next node may try to migrate VMs to a node that is still rebooting!
                                        </div>
                                    )}

                                    {/* GitHub #40 - Pause on evacuation error */}
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={pauseOnEvacError}
                                            onChange={(e) => setPauseOnEvacError(e.target.checked)}
                                            className="w-4 h-4 rounded border-proxmox-border bg-proxmox-darker text-proxmox-orange focus:ring-proxmox-orange"
                                            disabled={skipEvacuation}
                                        />
                                        <div>
                                            <span className="text-white text-sm">Pause if VMs fail to migrate</span>
                                            <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>Lets you manually handle stuck VMs before continuing</p>
                                        </div>
                                    </label>

                                    <div>
                                        <label className={isCorporate ? 'corp-label' : "text-xs text-gray-400 block mb-1"}>
                                            {t('evacuationTimeout')} ({t('seconds')})
                                        </label>
                                        <select
                                            value={evacuationTimeout}
                                            onChange={(e) => setEvacuationTimeout(parseInt(e.target.value))}
                                            className={isCorporate ? 'corp-input' : "w-full bg-proxmox-darker border border-proxmox-border rounded px-3 py-1.5 text-sm text-white"}
                                            disabled={skipEvacuation}
                                        >
                                            <option value={300}>5 {t('minutes')}</option>
                                            <option value={600}>10 {t('minutes')}</option>
                                            <option value={1200}>20 {t('minutes')}</option>
                                            <option value={1800}>30 {t('minutes')} ({t('default2')})</option>
                                            <option value={3600}>1 {t('hour')}</option>
                                            <option value={7200}>2 {t('hours')}</option>
                                        </select>
                                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>
                                            {t('evacuationTimeoutHint')}
                                        </p>
                                    </div>

                                    {/* (#328): reboot timeout -- slow-boot nodes (Ceph OSDs) need more than 10min */}
                                    <div>
                                        <label className={isCorporate ? 'corp-label' : "text-xs text-gray-400 block mb-1"}>
                                            {t('rebootTimeout')} ({t('seconds')})
                                        </label>
                                        <select
                                            value={rebootTimeout}
                                            onChange={(e) => setRebootTimeout(parseInt(e.target.value))}
                                            className={isCorporate ? 'corp-input' : "w-full bg-proxmox-darker border border-proxmox-border rounded px-3 py-1.5 text-sm text-white"}
                                            disabled={!waitForReboot}
                                        >
                                            <option value={300}>5 {t('minutes')}</option>
                                            <option value={600}>10 {t('minutes')} ({t('default3')})</option>
                                            <option value={1200}>20 {t('minutes')}</option>
                                            <option value={1800}>30 {t('minutes')}</option>
                                            <option value={3600}>1 {t('hour')}</option>
                                            <option value={7200}>2 {t('hours')}</option>
                                        </select>
                                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>
                                            {t('rebootTimeoutHint')}
                                        </p>
                                    </div>

                                    {/* (#330): opt-in for local-disk evacuation. intentionally
                                                styled as a checkbox with a warning block so users don't flip it
                                                without reading — copying disks over the cluster network is painful
                                                on bigger VMs. */}
                                    <label className="flex items-start gap-2 mt-3 cursor-pointer" title={t('allowLocalDisksHint2')}>
                                        <input
                                            type="checkbox"
                                            checked={allowLocalDisks}
                                            onChange={(e) => setAllowLocalDisks(e.target.checked)}
                                            disabled={skipEvacuation}
                                            className="mt-0.5 w-4 h-4 rounded border-proxmox-border bg-proxmox-darker accent-proxmox-orange"
                                        />
                                        <div>
                                            <div className="text-sm text-white">
                                                {t('allowLocalDisks2')}
                                            </div>
                                            <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>
                                                {t('allowLocalDisksHint3')}
                                            </p>
                                            {allowLocalDisks && (
                                                <p className="text-xs text-yellow-400 mt-1">
                                                    ⚠ {t('allowLocalDisksWarn')}
                                                </p>
                                            )}
                                        </div>
                                    </label>
                                </div>
                            )}
                        </div>

                        {/* Update order selection */}
                        <div className="border border-proxmox-border rounded-lg p-3 mb-4 bg-proxmox-dark space-y-3">
                            <p className="text-sm text-white font-medium">Update order</p>
                            <div>
                                <p className="text-xs text-gray-400 mb-1">{t('nodes')}</p>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                    {nodeOrder.map((name, i) => (
                                        <div key={name} className="flex items-center justify-between bg-proxmox-darker rounded px-2 py-1">
                                            <span className="text-sm text-gray-300 flex items-center gap-2"><Icons.Server className="w-3 h-3" /> {name}</span>
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => moveItem(nodeOrder, setNodeOrder, i, -1)} disabled={i === 0} className="p-1 text-gray-400 hover:text-white disabled:opacity-30">▲</button>
                                                <button onClick={() => moveItem(nodeOrder, setNodeOrder, i, 1)} disabled={i === nodeOrder.length - 1} className="p-1 text-gray-400 hover:text-white disabled:opacity-30">▼</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {pbsOrder.length > 0 && (
                                <div>
                                    <p className="text-xs text-gray-400 mb-1">Proxmox Backup Server</p>
                                    <div className="space-y-1 max-h-32 overflow-y-auto">
                                        {pbsOrder.map((id, i) => {
                                            const pbsName = updateStatus?.pbs ? Object.entries(updateStatus.pbs).find(([_, p]) => p.pbs_id === id)?.[0] || id : id;
                                            return (
                                                <div key={id} className="flex items-center justify-between bg-proxmox-darker rounded px-2 py-1">
                                                    <span className="text-sm text-gray-300 flex items-center gap-2"><Icons.Shield className="w-3 h-3" /> {pbsName}</span>
                                                    <div className="flex items-center gap-1">
                                                        <button onClick={() => moveItem(pbsOrder, setPbsOrder, i, -1)} disabled={i === 0} className="p-1 text-gray-400 hover:text-white disabled:opacity-30">▲</button>
                                                        <button onClick={() => moveItem(pbsOrder, setPbsOrder, i, 1)} disabled={i === pbsOrder.length - 1} className="p-1 text-gray-400 hover:text-white disabled:opacity-30">▼</button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="bg-proxmox-dark rounded-lg p-3 mb-4 text-sm">
                            <div className="flex justify-between text-gray-400">
                                <span>{t('nodes')}:</span>
                                <span className="text-white">{skipUpToDate ? `${targetsWithUpdates}/${totalTargets}` : totalTargets}</span>
                            </div>
                            <div className="flex justify-between text-gray-400">
                                <span>{t('packagesAvailable')}:</span>
                                <span className="text-yellow-400">{totalUpdates}</span>
                            </div>
                            <div className="flex justify-between text-gray-400">
                                <span>{t('estimatedTime')}:</span>
                                <span className="text-white">~{(skipUpToDate ? (targetsWithUpdates || 1) : (totalTargets || 1)) * (includeReboot ? 10 : 5)} {t('minutes')}</span>
                            </div>
                            {skipUpToDate && (
                                <div className="flex justify-between text-gray-400 mt-1">
                                    <span>{t('note')}:</span>
                                    <span className="text-green-400 text-xs">{t('skipUpToDateHint2')}</span>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowConfirm(false)}
                                className="px-4 py-2 bg-proxmox-dark text-gray-300 rounded-lg hover:bg-proxmox-hover transition-colors"
                            >
                                {t('cancel')}
                            </button>
                            <button
                                onClick={startRollingUpdate}
                                className="px-4 py-2 bg-proxmox-orange text-white rounded-lg hover:bg-orange-600 transition-colors"
                            >
                                {t('startRollingUpdate')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Schedule Modal */}
            {showScheduleModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop" onClick={() => setShowScheduleModal(false)}>
                    <div className={isCorporate ? 'corp-settings-card' : "bg-proxmox-card border border-proxmox-border rounded-2xl p-6 max-w-md w-full animate-scale-in"} onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-blue-500/20">
                                <Icons.Clock className="text-blue-400" />
                            </div>
                            <div>
                                <h3 className={isCorporate ? 'corp-card-header' : "text-lg font-semibold text-white"}>{t('scheduleUpdates2')}</h3>
                                <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">{t('experimental')}</span>
                            </div>
                        </div>

                        {/* Experimental Warning */}
                        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                            <div className="flex items-start gap-2">
                                <Icons.AlertTriangle className="text-yellow-400 mt-0.5 flex-shrink-0" />
                                <div className="text-sm text-yellow-300">
                                    {t('experimentalWarning')}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            {/* Enable/Disable Toggle */}
                            <label className="flex items-center justify-between p-3 bg-proxmox-dark rounded-lg cursor-pointer">
                                <div>
                                    <div className="text-white font-medium">{t('enableAutoUpdate')}</div>
                                    <div className="text-xs text-gray-500">{t('autoUpdateDesc')}</div>
                                </div>
                                <div
                                    className={`w-12 h-6 rounded-full p-1 transition-colors cursor-pointer ${scheduleEnabled ? 'bg-green-500' : 'bg-proxmox-border'}`}
                                    onClick={() => setScheduleEnabled(!scheduleEnabled)}
                                >
                                    <div className={`w-4 h-4 rounded-full bg-white transition-transform ${scheduleEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                                </div>
                            </label>

                            {scheduleEnabled && (
                                <>
                                    {/* Schedule Type Selection */}
                                    <div>
                                        <label className={isCorporate ? 'corp-label' : "text-xs text-gray-400 block mb-1"}>{t('scheduleType')}</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => setScheduleType('once')}
                                                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${scheduleType === 'once'
                                                    ? 'bg-proxmox-orange/20 border-proxmox-orange text-proxmox-orange'
                                                    : 'bg-proxmox-dark border-proxmox-border text-gray-400 hover:border-gray-500'
                                                    }`}
                                            >
                                                {t('runOnce')}
                                            </button>
                                            <button
                                                onClick={() => setScheduleType('recurring')}
                                                className={`p-3 rounded-lg border text-sm font-medium transition-colors ${scheduleType === 'recurring'
                                                    ? 'bg-proxmox-orange/20 border-proxmox-orange text-proxmox-orange'
                                                    : 'bg-proxmox-dark border-proxmox-border text-gray-400 hover:border-gray-500'
                                                    }`}
                                            >
                                                {t('recurring')}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Day Selection */}
                                    <div>
                                        <label className={isCorporate ? 'corp-label' : "text-xs text-gray-400 block mb-1"}>{t('updateDay')}</label>
                                        <select
                                            value={scheduleDay}
                                            onChange={(e) => setScheduleDay(e.target.value)}
                                            className={isCorporate ? 'corp-input' : "w-full bg-proxmox-dark border border-proxmox-border rounded-lg px-3 py-2 text-white"}
                                        >
                                            <option value="monday">{t('monday')}</option>
                                            <option value="tuesday">{t('tuesday')}</option>
                                            <option value="wednesday">{t('wednesday')}</option>
                                            <option value="thursday">{t('thursday')}</option>
                                            <option value="friday">{t('friday')}</option>
                                            <option value="saturday">{t('saturday')}</option>
                                            <option value="sunday">{t('sunday')}</option>
                                            {scheduleType === 'recurring' && <option value="daily">{t('daily')}</option>}
                                        </select>
                                    </div>

                                    {/* Time Selection */}
                                    <div>
                                        <label className={isCorporate ? 'corp-label' : "text-xs text-gray-400 block mb-1"}>{t('updateTime')}</label>
                                        <input
                                            type="time"
                                            value={scheduleTime}
                                            onChange={(e) => setScheduleTime(e.target.value)}
                                            className={isCorporate ? 'corp-input' : "w-full bg-proxmox-dark border border-proxmox-border rounded-lg px-3 py-2 text-white"}
                                        />
                                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500 mt-1"}>{t('serverTimezone')}</p>
                                    </div>

                                    {/* Options */}
                                    <div className="space-y-2 pt-2 border-t border-proxmox-border">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={scheduleReboot}
                                                onChange={(e) => setScheduleReboot(e.target.checked)}
                                                className="rounded bg-proxmox-darker border-proxmox-border text-proxmox-orange focus:ring-proxmox-orange"
                                            />
                                            <span className="text-white text-sm">{t('includeReboot2')}</span>
                                        </label>

                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={scheduleSkipEvacuation}
                                                onChange={(e) => setScheduleSkipEvacuation(e.target.checked)}
                                                className="rounded bg-proxmox-darker border-proxmox-border text-red-500 focus:ring-red-500"
                                            />
                                            <span className="text-red-400 text-sm">{t('skipEvacuation')}</span>
                                            <span className="text-xs bg-red-900/30 text-red-400 px-1.5 py-0.5 rounded">{t('notRecommended')}</span>
                                        </label>

                                        {/* GitHub #40 - Advanced Options */}
                                        <button
                                            onClick={() => setScheduleShowAdvanced(!scheduleShowAdvanced)}
                                            className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 mt-1"
                                        >
                                            <Icons.ChevronRight className={`w-3 h-3 transition-transform ${scheduleShowAdvanced ? 'rotate-90' : ''}`} />
                                            {t('advancedOptions')}
                                        </button>

                                        {scheduleShowAdvanced && (
                                            <div className="ml-4 space-y-3 p-3 bg-proxmox-darker rounded-lg">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={scheduleWaitForReboot}
                                                        onChange={(e) => setScheduleWaitForReboot(e.target.checked)}
                                                        className="w-4 h-4 rounded border-proxmox-border bg-proxmox-dark text-proxmox-orange focus:ring-proxmox-orange"
                                                        disabled={!scheduleReboot}
                                                    />
                                                    <div>
                                                        <span className="text-white text-sm">Wait for node to come back online</span>
                                                        <p className={isCorporate ? 'corp-help-text' : "text-xs text-gray-500"}>Prevents migrating VMs to a still-rebooting node</p>
                                                    </div>
                                                </label>

                                                <div>
                                                    <label className={isCorporate ? 'corp-label' : "text-xs text-gray-400 block mb-1"}>
                                                        {t('evacuationTimeout')}
                                                    </label>
                                                    <select
                                                        value={scheduleEvacTimeout}
                                                        onChange={(e) => setScheduleEvacTimeout(parseInt(e.target.value))}
                                                        className={isCorporate ? 'corp-input' : "w-full bg-proxmox-dark border border-proxmox-border rounded px-3 py-1.5 text-sm text-white"}
                                                        disabled={scheduleSkipEvacuation}
                                                    >
                                                        <option value={300}>5 {t('minutes2')}</option>
                                                        <option value={600}>10 {t('minutes3')}</option>
                                                        <option value={1200}>20 {t('minutes4')}</option>
                                                        <option value={1800}>30 {t('minutes5')} ({t('default4')})</option>
                                                        <option value={3600}>1 {t('hour')}</option>
                                                        <option value={7200}>2 {t('hours')}</option>
                                                    </select>
                                                </div>

                                                <div className="text-xs text-gray-500 flex items-start gap-1.5">
                                                    <Icons.Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                                    <span>Scheduled updates cannot pause for user input. If VMs fail to migrate, the node will be skipped and the update continues with the next node.</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Info Box */}
                                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-sm">
                                        <div className="flex items-start gap-2">
                                            <Icons.Info className="text-blue-400 mt-0.5 flex-shrink-0" />
                                            <div className="text-blue-300">
                                                {scheduleType === 'once'
                                                    ? (t('runOnceInfo'))
                                                    : (t('autoUpdateInfo2'))
                                                }
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="flex gap-3 justify-end mt-6">
                            <button
                                onClick={() => setShowScheduleModal(false)}
                                className="px-4 py-2 bg-proxmox-dark text-gray-300 rounded-lg hover:bg-proxmox-hover transition-colors"
                            >
                                {t('cancel')}
                            </button>
                            <button
                                onClick={saveUpdateSchedule}
                                disabled={scheduleSaving}
                                className="px-4 py-2 bg-proxmox-orange text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {scheduleSaving && <Icons.RotateCw className="animate-spin" />}
                                {t('save')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// SMBIOS Auto-Config Section Component
// This whole feature started because Windows kept complaining about hardware changes after migrations
function SmbiosAutoConfigSection({ clusterId, selectedCluster, updateConfig, addToast }) {
    const { t } = useTranslation();
    const { getAuthHeaders } = useAuth();
    const { isCorporate } = useLayout();
    const [smbiosStatus, setSmbiosStatus] = useState({});
    const [smbiosLoading, setSmbiosLoading] = useState(false);
    const [smbiosActionLoading, setSmbiosActionLoading] = useState({});  // per-node loading state

    // Local authFetch for this component
    const authFetch = (url, opts = {}) => fetch(url, { ...opts, credentials: 'include', headers: { ...opts.headers, ...getAuthHeaders() } });

    const loadSmbiosStatus = async () => {
        if (!clusterId) return;
        setSmbiosLoading(true);
        try {
            const res = await authFetch(`${API_URL}/clusters/${clusterId}/smbios-autoconfig/status-all`);
            if (res && res.ok) {
                const data = await res.json();
                setSmbiosStatus(data || {});
            }
        } catch (e) {
            console.error('Error loading SMBIOS status:', e);
        }
        setSmbiosLoading(false);
    };

    // Load status on mount
    useEffect(() => {
        if (clusterId) {
            loadSmbiosStatus();
        }
    }, [clusterId]);

    // Control service (start/stop/restart)
    const controlService = async (node, action) => {
        setSmbiosActionLoading(prev => ({ ...prev, [node]: action }));
        try {
            const res = await authFetch(`${API_URL}/clusters/${clusterId}/nodes/${node}/smbios-autoconfig/control`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            });
            const result = await res.json();
            if (result.success) {
                addToast(result.message, 'success');
                await loadSmbiosStatus();
            } else {
                addToast(result.error || 'Action failed', 'error');
            }
        } catch (e) {
            addToast('Error: ' + e.message, 'error');
        }
        setSmbiosActionLoading(prev => ({ ...prev, [node]: null }));
    };

    // Remove from node
    const removeFromNode = async (node) => {
        if (!confirm(`Remove SMBIOS Auto-Config from ${node}?`)) return;
        setSmbiosActionLoading(prev => ({ ...prev, [node]: 'remove' }));
        try {
            const res = await authFetch(`${API_URL}/clusters/${clusterId}/nodes/${node}/smbios-autoconfig`, {
                method: 'DELETE'
            });
            const result = await res.json();
            if (result.success) {
                addToast(result.message, 'success');
                await loadSmbiosStatus();
            } else {
                addToast(result.error || 'Remove failed', 'error');
            }
        } catch (e) {
            addToast('Error: ' + e.message, 'error');
        }
        setSmbiosActionLoading(prev => ({ ...prev, [node]: null }));
    };

    // Deploy to all nodes
    const deployToAll = async () => {
        if (!confirm(t('deploySmbiosConfirm2'))) return;
        setSmbiosLoading(true);
        try {
            // Save config first
            await authFetch(`${API_URL}/clusters/${clusterId}/smbios-autoconfig`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    manufacturer: selectedCluster?.smbios_manufacturer || 'Proxmox',
                    product: selectedCluster?.smbios_product || 'ProxmoxVExManagment',
                    version: selectedCluster?.smbios_version || 'v1',
                    family: selectedCluster?.smbios_family || 'ProxmoxVE'
                })
            });

            // Deploy
            const res = await authFetch(`${API_URL}/clusters/${clusterId}/smbios-autoconfig/deploy-all`, {
                method: 'POST'
            });
            const result = await res.json();
            if (result.success) {
                addToast(result.message, 'success');
                if (updateConfig) updateConfig('smbios_enabled', true);
                await loadSmbiosStatus();
            } else {
                addToast(result.error || 'Deploy failed', 'error');
            }
        } catch (e) {
            addToast('Error: ' + e.message, 'error');
        }
        setSmbiosLoading(false);
    };

    // Count running nodes
    const nodeCount = Object.keys(smbiosStatus).length;
    const runningCount = Object.values(smbiosStatus).filter(s => s.running).length;
    const installedCount = Object.values(smbiosStatus).filter(s => s.installed).length;

    return (
        <>
            <div className="flex items-center justify-between mb-4">
                <h3 className={isCorporate ? 'corp-card-header flex items-center gap-2' : "font-semibold flex items-center gap-2"}>
                    <Icons.Cpu className="w-5 h-5" />
                    SMBIOS Auto-Configurator
                </h3>
                <div className="flex items-center gap-2">
                    <button
                        onClick={loadSmbiosStatus}
                        disabled={smbiosLoading}
                        className="p-1.5 rounded-lg hover:bg-proxmox-dark text-gray-400 hover:text-white transition-colors"
                        title={t('refresh')}
                    >
                        <Icons.RefreshCw className={`w-4 h-4 ${smbiosLoading ? 'animate-spin' : ''}`} />
                    </button>
                    {nodeCount > 0 && (
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${runningCount === nodeCount && runningCount > 0
                            ? 'bg-green-500/20 text-green-400'
                            : runningCount > 0
                                ? 'bg-yellow-500/20 text-yellow-400'
                                : installedCount > 0
                                    ? 'bg-orange-500/20 text-orange-400'
                                    : 'bg-gray-500/20 text-gray-400'
                            }`}>
                            {runningCount}/{nodeCount} {t('running2')}
                        </span>
                    )}
                </div>
            </div>

            <p className={isCorporate ? 'corp-help-text mb-4' : "text-sm text-gray-400 mb-4"}>
                {t('smbiosAutoDesc')}
            </p>

            {/* Settings */}
            <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>Manufacturer</label>
                    <input
                        type="text"
                        value={selectedCluster?.smbios_manufacturer || 'Proxmox'}
                        onChange={(e) => updateConfig && updateConfig('smbios_manufacturer', e.target.value)}
                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                    />
                </div>
                <div>
                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>Product</label>
                    <input
                        type="text"
                        value={selectedCluster?.smbios_product || 'ProxmoxVExManagment'}
                        onChange={(e) => updateConfig && updateConfig('smbios_product', e.target.value)}
                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                    />
                </div>
                <div>
                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>Version</label>
                    <input
                        type="text"
                        value={selectedCluster?.smbios_version || 'v1'}
                        onChange={(e) => updateConfig && updateConfig('smbios_version', e.target.value)}
                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                    />
                </div>
                <div>
                    <label className={isCorporate ? 'corp-label' : "block text-xs text-gray-400 mb-1"}>Family</label>
                    <input
                        type="text"
                        value={selectedCluster?.smbios_family || 'ProxmoxVE'}
                        onChange={(e) => updateConfig && updateConfig('smbios_family', e.target.value)}
                        className={isCorporate ? 'corp-input' : "w-full px-3 py-2 bg-proxmox-dark border border-proxmox-border rounded-lg text-white text-sm"}
                    />
                </div>
            </div>

            {/* Deploy Button */}
            <div className="flex gap-3 mb-4">
                <button
                    onClick={deployToAll}
                    disabled={smbiosLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 rounded-lg text-white text-sm font-medium hover:bg-green-500 transition-colors disabled:opacity-50"
                >
                    {smbiosLoading ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : <Icons.Download className="w-4 h-4" />}
                    {installedCount > 0 ? (t('updateAllNodes')) : (t('deployToAllNodes'))}
                </button>
            </div>

            {/* Per-Node Status */}
            {nodeCount > 0 && (
                <div className="space-y-2">
                    <div className="text-xs text-gray-500 font-medium">{t('nodeStatus')}:</div>
                    {Object.entries(smbiosStatus).map(([nodeName, status]) => (
                        <div key={nodeName} className={isCorporate ? 'corp-settings-card' : "bg-proxmox-dark rounded-lg border border-proxmox-border overflow-hidden"}>
                            <div className="flex items-center justify-between p-3">
                                <div className="flex items-center gap-3">
                                    <div className={`w-2 h-2 rounded-full ${status.running ? 'bg-green-500' : status.installed ? 'bg-yellow-500' : 'bg-gray-500'
                                        }`} />
                                    <span className="text-sm text-white font-medium">{nodeName}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded ${status.running ? 'bg-green-500/20 text-green-400' :
                                        status.installed ? 'bg-yellow-500/20 text-yellow-400' :
                                            'bg-gray-500/20 text-gray-400'
                                        }`}>
                                        {status.running ? t('running') : status.installed ? t('stopped3') : t('notInstalled')}
                                    </span>
                                    {status.error && (
                                        <span className="text-xs text-red-400">{status.error}</span>
                                    )}
                                </div>
                                {status.installed && (
                                    <div className="flex items-center gap-1">
                                        {status.running ? (
                                            <button
                                                onClick={() => controlService(nodeName, 'stop')}
                                                disabled={smbiosActionLoading[nodeName]}
                                                className="p-1.5 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
                                                title={t('stop')}
                                            >
                                                {smbiosActionLoading[nodeName] === 'stop' ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : <Icons.Square className="w-4 h-4" />}
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => controlService(nodeName, 'start')}
                                                disabled={smbiosActionLoading[nodeName]}
                                                className="p-1.5 rounded hover:bg-green-500/20 text-gray-400 hover:text-green-400 transition-colors disabled:opacity-50"
                                                title={t('start')}
                                            >
                                                {smbiosActionLoading[nodeName] === 'start' ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : <Icons.Play className="w-4 h-4" />}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => controlService(nodeName, 'restart')}
                                            disabled={smbiosActionLoading[nodeName]}
                                            className="p-1.5 rounded hover:bg-orange-500/20 text-gray-400 hover:text-orange-400 transition-colors disabled:opacity-50"
                                            title={t('restart')}
                                        >
                                            {smbiosActionLoading[nodeName] === 'restart' ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : <Icons.RefreshCw className="w-4 h-4" />}
                                        </button>
                                        <button
                                            onClick={() => controlService(nodeName, 'rescan')}
                                            disabled={smbiosActionLoading[nodeName]}
                                            className="p-1.5 rounded hover:bg-blue-500/20 text-gray-400 hover:text-blue-400 transition-colors disabled:opacity-50"
                                            title={t('rescanAllVms')}
                                        >
                                            {smbiosActionLoading[nodeName] === 'rescan' ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : <Icons.Search className="w-4 h-4" />}
                                        </button>
                                        <button
                                            onClick={() => removeFromNode(nodeName)}
                                            disabled={smbiosActionLoading[nodeName]}
                                            className="p-1.5 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
                                            title={t('remove')}
                                        >
                                            {smbiosActionLoading[nodeName] === 'remove' ? <Icons.RotateCw className="w-4 h-4 animate-spin" /> : <Icons.Trash className="w-4 h-4" />}
                                        </button>
                                    </div>
                                )}
                            </div>
                            {/* Logs - show last entries */}
                            {status.logs && status.logs !== 'No logs yet' && (
                                <div className="px-3 pb-3 pt-0">
                                    <details className="text-xs">
                                        <summary className="cursor-pointer text-gray-500 hover:text-gray-400">
                                            {t('showLogs')}
                                        </summary>
                                        <pre className="mt-2 p-2 bg-black/50 rounded text-[10px] text-gray-400 overflow-x-auto max-h-32 overflow-y-auto font-mono whitespace-pre-wrap">
                                            {status.logs}
                                        </pre>
                                    </details>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {nodeCount === 0 && !smbiosLoading && (
                <div className="text-center py-4 text-gray-500 text-sm">
                    {t('clickDeployToStart') || 'Click "Deploy to All Nodes" to get started'}
                </div>
            )}
        </>
    );
}

// RoleAssignmentBulkSelection: bulk select role assignment items.
function RoleAssignmentBulkSelection({ items = [], onSelect }) {
    const { t } = useTranslation();
    const [selected, setSelected] = React.useState({});
    const toggle = (id) => {
        const next = { ...selected, [id]: !selected[id] };
        setSelected(next);
        if (onSelect) onSelect(Object.keys(next).filter(k => next[k]));
    };
    const selectedCount = Object.values(selected).filter(Boolean).length;
    return (
        <div className="p-2 rounded border border-proxmox-border bg-proxmox-card" data-theme={currentRoleMatrixTheme()} data-testid="role-assignment-bulk-selection">
            <div className="text-sm font-medium mb-2" style={{ color: 'var(--corp-text)' }}>{t('bulkSelection')}</div>
            <div className="text-sm mb-2" style={{ color: 'var(--corp-text-secondary)' }}>{selectedCount} {t('selected')}</div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
                {items.map((item) => (
                    <label key={item.id} className="flex items-center gap-2 text-sm" style={{ color: 'var(--corp-text-secondary)' }}>
                        <input
                            type="checkbox"
                            checked={!!selected[item.id]}
                            onChange={() => toggle(item.id)}
                        />
                        {item.label}
                    </label>
                ))}
            </div>
        </div>
    );
}

// RoleAssignmentStepByStepWizard: guided multi-step wizard for role assignment.
function RoleAssignmentStepByStepWizard({ steps = [] }) {
    const { t } = useTranslation();
    const [step, setStep] = React.useState(0);
    const canNext = step < steps.length - 1;
    const canBack = step > 0;
    return (
        <div className="p-2 rounded border border-proxmox-border bg-proxmox-card" data-theme={currentRoleMatrixTheme()} data-testid="role-assignment-step-by-step-wizard">
            <div className="text-sm font-medium mb-2" style={{ color: 'var(--corp-text)' }}>{t('stepByStepWizard')}</div>
            <div className="text-sm mb-3" style={{ color: 'var(--corp-text-secondary)' }}>
                {t('step')} {step + 1} {t('of')} {steps.length}
            </div>
            {steps[step] && (
                <div className="text-sm p-2 rounded bg-proxmox-dark/40 mb-3" style={{ color: 'var(--corp-text-secondary)' }}>
                    {steps[step]}
                </div>
            )}
            <div className="flex gap-2">
                <button onClick={() => setStep(s => s - 1)} disabled={!canBack} className="px-3 py-1.5 text-sm rounded bg-proxmox-gray disabled:opacity-50">
                    {t('back')}
                </button>
                {canNext ? (
                    <button onClick={() => setStep(s => s + 1)} className="px-3 py-1.5 text-sm rounded bg-cyan-600 hover:bg-cyan-700">
                        {t('next')}
                    </button>
                ) : (
                    <button onClick={() => { }} className="px-3 py-1.5 text-sm rounded bg-cyan-600 hover:bg-cyan-700">
                        {t('finish')}
                    </button>
                )}
            </div>
        </div>
    );
}

// RoleAssignmentContextMenu: context menu for role assignment actions.
function RoleAssignmentContextMenu({ items, onSelect }) {
    const [open, setOpen] = React.useState(false);

    return (
        <div className="relative inline-block">
            <button onClick={() => setOpen(!open)} className="px-2 py-1 text-sm rounded border border-proxmox-border">
                ⋮
            </button>
            {open && (
                <div className="absolute right-0 mt-1 w-40 bg-proxmox-card border border-proxmox-border rounded shadow-lg z-50">
                    {items.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => { setOpen(false); onSelect?.(item.id); }}
                            className="block w-full text-left px-3 py-2 text-sm hover:bg-proxmox-hover"
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// RoleAssignmentRecentItems: recent role assignment picks for quick reuse.
function RoleAssignmentRecentItems({ items, onSelect }) {
    return (
        <div className="p-2 border-t border-proxmox-border">
            <div className="text-xs text-proxmox-textMuted mb-1">Recent</div>
            {items.slice(0, 5).map((item) => (
                <button
                    key={item.id}
                    onClick={() => onSelect?.(item.id)}
                    className="block w-full text-left text-xs px-2 py-1 hover:bg-proxmox-hover truncate"
                >
                    {item.name}
                </button>
            ))}
        </div>
    );
}

// RoleAssignmentUndo: undo toast for the last role assignment action.
function RoleAssignmentUndo({ onUndo, message }) {
    return (
        <div className="flex items-center gap-2 px-3 py-2 text-sm bg-proxmox-card border border-proxmox-border rounded shadow">
            <span>{message}</span>
            <button onClick={onUndo} className="text-cyan-500 hover:text-cyan-400 underline">
                Undo
            </button>
        </div>
    );
}

// RoleAssignmentQuickFilter: filter chips for role assignment lists.
function RoleAssignmentQuickFilter({ options, active, onChange }) {
    return (
        <div className="flex gap-2 flex-wrap">
            {options.map((option) => (
                <button
                    key={option}
                    onClick={() => onChange?.(option)}
                    className={`px-2 py-1 text-xs rounded border ${active === option
                        ? 'bg-cyan-600 border-cyan-600 text-white'
                        : 'bg-proxmox-card border-proxmox-border text-proxmox-text'
                        }`}
                >
                    {option}
                </button>
            ))}
        </div>
    );
}

// RoleAssignmentOneClickApply: single-button confirmation to apply a role.
function RoleAssignmentOneClickApply({ role, onApply, loading }) {
    return (
        <button
            onClick={() => onApply?.(role)}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white"
        >
            {loading ? 'Applying...' : 'Apply Role'}
        </button>
    );
}

// RoleAssignmentSmartDefaults: pre-fill role assignment form with sensible defaults.
function RoleAssignmentSmartDefaults({ role, user, domain, onApply }) {
    const defaults = { role: role || 'PVEUser', user: user || '', domain: domain || 'pam' };
    return (
        <div className="p-2 border border-proxmox-border rounded bg-proxmox-card text-sm">
            <div className="font-medium mb-2">Smart defaults</div>
            <div className="text-xs text-proxmox-textMuted">Role: {defaults.role}</div>
            <div className="text-xs text-proxmox-textMuted">Domain: {defaults.domain}</div>
            <button
                onClick={() => onApply?.(defaults)}
                className="mt-2 px-3 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-700 text-white"
            >
                Apply defaults
            </button>
        </div>
    );
}

// RoleAssignmentLivePreview: show effective permissions before applying a role.
function RoleAssignmentLivePreview({ role, permissions }) {
    return (
        <div className="p-2 border border-proxmox-border rounded bg-proxmox-card text-sm">
            <div className="font-medium mb-2">Preview: {role || 'No role selected'}</div>
            {permissions?.length ? (
                <ul className="text-xs text-proxmox-textMuted space-y-1">
                    {permissions.map((p) => (
                        <li key={p}>{p}</li>
                    ))}
                </ul>
            ) : (
                <div className="text-xs text-proxmox-textMuted">No permissions to preview.</div>
            )}
        </div>
    );
}

// RoleAssignmentCompareView: compare permissions between two roles side-by-side.
function RoleAssignmentCompareView({ base, compare, basePermissions, comparePermissions }) {
    return (
        <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="p-2 border border-proxmox-border rounded bg-proxmox-card">
                <div className="font-medium mb-2">{base || 'Base role'}</div>
                <ul className="text-xs text-proxmox-textMuted space-y-1">
                    {basePermissions?.map((p) => <li key={p}>{p}</li>) || <li>No permissions.</li>}
                </ul>
            </div>
            <div className="p-2 border border-proxmox-border rounded bg-proxmox-card">
                <div className="font-medium mb-2">{compare || 'Compare role'}</div>
                <ul className="text-xs text-proxmox-textMuted space-y-1">
                    {comparePermissions?.map((p) => <li key={p}>{p}</li>) || <li>No permissions.</li>}
                </ul>
            </div>
        </div>
    );
}

// RoleMatrixResizablePanels: wraps the role matrix in a resizable two-pane layout.
function RoleMatrixResizablePanels({ leftPanel, rightPanel, initialLeftWidth = 40, minLeft = 20, maxLeft = 80 }) {
    const [leftWidth, setLeftWidth] = React.useState(initialLeftWidth);
    const [dragging, setDragging] = React.useState(false);

    React.useEffect(() => {
        const handleMouseMove = (e) => {
            if (!dragging) return;
            const width = (e.clientX / window.innerWidth) * 100;
            setLeftWidth(Math.max(minLeft, Math.min(maxLeft, width)));
        };
        const handleMouseUp = () => setDragging(false);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [dragging, minLeft, maxLeft]);

    return (
        <div className="flex w-full h-full overflow-hidden border border-proxmox-border rounded bg-proxmox-card" data-testid="role-matrix-resizable-panels">
            <div className="h-full overflow-auto p-2" style={{ width: `${leftWidth}%` }}>
                {leftPanel}
            </div>
            <div
                className="w-1 bg-proxmox-border hover:bg-cyan-600 cursor-col-resize transition-colors"
                onMouseDown={() => setDragging(true)}
                role="separator"
                aria-label="Resize panels"
            />
            <div className="h-full overflow-auto p-2 flex-1">
                {rightPanel}
            </div>
        </div>
    );
}

// RoleMatrixStatusBadge: color-coded status badge for role matrix entries.
function RoleMatrixStatusBadge({ status }) {
    const styles = {
        active: 'bg-green-500/20 text-green-400',
        pending: 'bg-yellow-500/20 text-yellow-400',
        revoked: 'bg-red-500/20 text-red-400',
        default: 'bg-gray-500/20 text-gray-400'
    };
    const style = styles[status] || styles.default;
    return (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${style}`} data-testid="role-matrix-status-badge">
            {status || 'unknown'}
        </span>
    );
}

// RoleMatrixHoverCard: hover card showing role details on the Role Matrix page.
function RoleMatrixHoverCard({ title, details, children }) {
    const [visible, setVisible] = React.useState(false);
    return (
        <div
            className="relative inline-block"
            onMouseEnter={() => setVisible(true)}
            onMouseLeave={() => setVisible(false)}
            data-testid="role-matrix-hover-card"
        >
            {children}
            {visible && (
                <div className="absolute z-50 w-64 p-3 rounded-lg border border-proxmox-border bg-proxmox-card shadow-xl -top-2 left-full ml-2">
                    <div className="font-medium text-sm mb-1">{title}</div>
                    <div className="text-xs text-proxmox-textMuted">{details}</div>
                </div>
            )}
        </div>
    );
}

// RoleMatrixBreadcrumbBar: breadcrumb navigation for the Role Matrix page.
function RoleMatrixBreadcrumbBar({ items = [], onNavigate }) {
    return (
        <nav className="flex items-center text-sm text-proxmox-textMuted" data-testid="role-matrix-breadcrumb-bar" aria-label="Breadcrumb">
            {items.map((item, index) => (
                <React.Fragment key={item.id || index}>
                    {index > 0 && <span className="px-2 text-proxmox-border">/</span>}
                    {index === items.length - 1 ? (
                        <span className="font-medium text-white">{item.label}</span>
                    ) : (
                        <button
                            onClick={() => onNavigate?.(item)}
                            className="hover:text-cyan-400 transition-colors"
                        >
                            {item.label}
                        </button>
                    )}
                </React.Fragment>
            ))}
        </nav>
    );
}

// RoleMatrixColumnPicker: column visibility picker for the Role Matrix page.
function RoleMatrixColumnPicker({ columns = [], visible = [], onChange }) {
    const toggle = (key) => {
        const next = visible.includes(key)
            ? visible.filter(k => k !== key)
            : [...visible, key];
        onChange?.(next);
    };
    return (
        <div className="p-2 border border-proxmox-border rounded bg-proxmox-card" data-testid="role-matrix-column-picker">
            <div className="text-sm font-medium mb-2 text-white">Columns</div>
            <div className="space-y-1">
                {columns.map((col) => (
                    <label key={col.key} className="flex items-center gap-2 text-sm text-proxmox-textMuted cursor-pointer">
                        <input
                            type="checkbox"
                            checked={visible.includes(col.key)}
                            onChange={() => toggle(col.key)}
                            className="rounded"
                        />
                        {col.label}
                    </label>
                ))}
            </div>
        </div>
    );
}

// RoleMatrixDragHandle: drag handle for reordering role matrix rows.
function RoleMatrixDragHandle({ onDragStart, onDragEnd }) {
    return (
        <div
            className="cursor-grab text-proxmox-textMuted hover:text-white"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            data-testid="role-matrix-drag-handle"
            aria-label="Drag to reorder"
        >
            ⋮⋮
        </div>
    );
}

// RoleMatrixFilterSidebar: filter sidebar for the Role Matrix page.
function RoleMatrixFilterSidebar({ filters = [], active = {}, onChange }) {
    return (
        <div className="w-64 border-r border-proxmox-border bg-proxmox-card p-3" data-testid="role-matrix-filter-sidebar">
            <div className="text-sm font-medium text-white mb-3">Filters</div>
            <div className="space-y-3">
                {filters.map((filter) => (
                    <div key={filter.key}>
                        <div className="text-xs text-proxmox-textMuted mb-1">{filter.label}</div>
                        {filter.options?.map((option) => (
                            <label key={option} className="flex items-center gap-2 text-sm text-proxmox-textMuted cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={!!active[filter.key]?.[option]}
                                    onChange={() => onChange?.({ ...active, [filter.key]: { ...active[filter.key], [option]: !active[filter.key]?.[option] } })}
                                    className="rounded"
                                />
                                {option}
                            </label>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

// RoleMatrixKeyboardShortcuts: keyboard shortcut help and listener for role matrix.
function RoleMatrixKeyboardShortcuts({ shortcuts = [], onShortcut }) {
    React.useEffect(() => {
        const handleKeyDown = (e) => {
            shortcuts.forEach((s) => {
                if (e.key === s.key && (e.ctrlKey || false) === !!s.ctrl && (e.shiftKey || false) === !!s.shift) {
                    e.preventDefault();
                    onShortcut?.(s);
                }
            });
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [shortcuts, onShortcut]);

    return (
        <div className="p-2 border border-proxmox-border rounded bg-proxmox-card" data-testid="role-matrix-keyboard-shortcuts">
            <div className="text-sm font-medium text-white mb-2">Keyboard Shortcuts</div>
            <div className="space-y-1 text-xs text-proxmox-textMuted">
                {shortcuts.map((s) => (
                    <div key={s.id} className="flex justify-between">
                        <span>{s.description}</span>
                        <span className="font-mono">{s.ctrl ? 'Ctrl+' : ''}{s.shift ? 'Shift+' : ''}{s.key}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// TagManagementBulkSelection: renders checkboxes for bulk-selecting tags and an action bar.
function TagManagementBulkSelection({ tags, selected, onSelect, onSelectAll, onAction, actionLabel }) {
    return (
        <div className="space-y-2" data-testid="tag-management-bulk-selection">
            <div className="flex items-center gap-2 p-2 border border-proxmox-border rounded bg-proxmox-card">
                <input
                    type="checkbox"
                    checked={tags.length > 0 && selected.length === tags.length}
                    onChange={(e) => onSelectAll?.(e.target.checked)}
                    data-testid="tag-management-select-all"
                />
                <span className="text-sm text-proxmox-text">Select all tags</span>
                <button
                    className="ml-auto px-3 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-700 text-white disabled:bg-gray-600 disabled:cursor-not-allowed"
                    disabled={selected.length === 0}
                    onClick={() => onAction?.(selected)}
                >
                    {actionLabel || 'Apply'}
                </button>
            </div>
            <div className="space-y-1">
                {(tags || []).map((tag) => (
                    <label key={tag.id} className="flex items-center gap-2 p-2 border border-proxmox-border rounded bg-proxmox-card hover:bg-proxmox-hover cursor-pointer">
                        <input
                            type="checkbox"
                            checked={selected.includes(tag.id)}
                            onChange={(e) => onSelect?.(tag.id, e.target.checked)}
                            data-testid={`tag-management-checkbox-${tag.id}`}
                        />
                        <span className="text-sm text-proxmox-text">{tag.name || tag.id}</span>
                    </label>
                ))}
            </div>
        </div>
    );
}

// TagManagementStepWizard: a step-by-step wizard for configuring tags.
function TagManagementStepWizard({ steps, currentStep, onNext, onBack, onFinish }) {
    const activeStep = steps?.[currentStep];
    return (
        <div className="space-y-3" data-testid="tag-management-step-wizard">
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