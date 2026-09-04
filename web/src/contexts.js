/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        web/src/contexts.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Contexts JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
const LanguageContext = createContext();

// (#389): supported language allowlist - reused for input validation
// both at init (localStorage) and at switch time. Keep in sync with the
// backend allowlist in ProxmoxVEx/api/users.py and the LanguageSwitcher list.
const SUPPORTED_LANGS = ['de', 'en', 'it', 'fr', 'es', 'pt', 'ko', 'ja', 'zh-hans', 'ar', 'hi', 'ru', 'id', 'tr'];

// map navigator.language ("en-US", "de-AT", ...) onto a supported code, or null
function _detectBrowserLang() {
    try {
        const langs = [];
        if (navigator.languages && navigator.languages.length) langs.push(...navigator.languages);
        if (navigator.language) langs.push(navigator.language);
        for (const raw of langs) {
            if (typeof raw !== 'string' || !raw) continue;
            const base = raw.toLowerCase().split(/[-_]/)[0];
            if (SUPPORTED_LANGS.includes(base)) return base;
        }
    } catch (_) { /* navigator unavailable / locked down */ }
    return null;
}

function LanguageProvider({ children }) {
    // Persist language preference in localStorage.
    // (#389): validate stored value against allowlist
    // (defence in depth — protects against tampered localStorage), and
    // when no valid value is stored, fall back to browser language.
    const [language, setLanguage] = useState(() => {
        let lang = 'de';
        try {
            const saved = localStorage.getItem('ProxmoxVEx-language');
            if (saved && SUPPORTED_LANGS.includes(saved)) { lang = saved; }
        } catch (_) { }
        if (lang === 'de') {
            const detected = _detectBrowserLang();
            if (detected) lang = detected;
        }
        // Initialize the i18n engine with the resolved language
        ProxmoxVExI18n.configure({ lang: lang, supportedLangs: SUPPORTED_LANGS });
        return lang;
    });

    // Translation function — delegates to the namespace-aware i18n engine.
    // Accepts optional { ns: 'namespace' } for plugin translations.
    const t = useCallback((key, opts) => {
        return ProxmoxVExI18n.t(key, opts);
    }, [language]);

    // Keep the i18n engine in sync with the active language.
    useEffect(() => {
        ProxmoxVExI18n.setLanguage(language);
        window.ProxmoxVExLanguage = language;
        document.documentElement.lang = language;
    }, [language]);

    // Expose globals for embedded integration iframes (backward compat).
    window.ProxmoxVExTranslations = translations;
    window.ProxmoxVExSupportedLangs = SUPPORTED_LANGS;
    window.ProxmoxVExT = (key, opts) => {
        return ProxmoxVExI18n.t(key, opts);
    };

    // Internal: validate + persist locally. Used by both code paths.
    const _setAndPersist = useCallback((lang) => {
        if (!SUPPORTED_LANGS.includes(lang)) return false;
        setLanguage(lang);
        try { localStorage.setItem('ProxmoxVEx-language', lang); } catch (_) { }
        return true;
    }, []);

    // changeLanguage = user-initiated switch from an authenticated context.
    // Persists locally AND syncs to the server so other devices pick it up.
    // (#389) - caller is responsible for only invoking this when
    // authenticated; the switcher uses applyLanguage on the login page.
    const changeLanguage = useCallback((lang) => {
        if (!_setAndPersist(lang)) return;
        fetch(`${API_URL}/user/preferences`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ language: lang })
        }).catch(() => { }); // fire and forget
    }, [_setAndPersist]);

    // applyLanguage just sets state+localStorage without API call.
    // Used on login/session restore AND on the unauth login page.
    const applyLanguage = useCallback((lang) => {
        _setAndPersist(lang);
    }, [_setAndPersist]);

    return (
        <LanguageContext.Provider value={{ language, t, changeLanguage, applyLanguage, supportedLangs: SUPPORTED_LANGS }}>
            {children}
        </LanguageContext.Provider>
    );
}

function useTranslation() {
    return useContext(LanguageContext);
}

// Inline SVG flag icons. Keeps everything self-contained so the strict
// CSP (img-src 'self' data: blob:) does not block external flag images.
function LanguageFlag({ cc, alt }) {
    const props = { width: 20, height: 14, viewBox: '0 0 20 14', className: 'w-5 h-auto rounded', role: 'img', 'aria-label': alt };
    switch (cc) {
        case 'at': return <svg {...props}><rect fill="#C8102E" width="20" height="14" /><rect fill="#FFFFFF" y="5" width="20" height="4" /></svg>;
        case 'gb': return <svg {...props}><rect fill="#012169" width="20" height="14" /><path d="M0 0L20 14 M0 14L20 0" stroke="#FFFFFF" strokeWidth="3" /><path d="M0 0L20 14 M0 14L20 0" stroke="#C8102E" strokeWidth="1.5" /><rect fill="#FFFFFF" x="8" y="0" width="4" height="14" /><rect fill="#FFFFFF" x="0" y="5" width="20" height="4" /><rect fill="#C8102E" x="9" y="0" width="2" height="14" /><rect fill="#C8102E" x="0" y="6" width="20" height="2" /></svg>;
        case 'it': return <svg {...props}><rect fill="#009246" width="6.67" height="14" /><rect fill="#FFFFFF" x="6.67" width="6.66" height="14" /><rect fill="#CE2B37" x="13.33" width="6.67" height="14" /></svg>;
        case 'fr': return <svg {...props}><rect fill="#0055A4" width="6.67" height="14" /><rect fill="#FFFFFF" x="6.67" width="6.66" height="14" /><rect fill="#EF4135" x="13.33" width="6.67" height="14" /></svg>;
        case 'es': return <svg {...props}><rect fill="#AD1519" width="20" height="3.5" /><rect fill="#FABD00" y="3.5" width="20" height="7" /><rect fill="#AD1519" y="10.5" width="20" height="3.5" /></svg>;
        case 'br': return <svg {...props}><rect fill="#009C3B" width="20" height="14" /><polygon points="10,2 18,7 10,12 2,7" fill="#FFDF00" /><circle cx="10" cy="7" r="3.5" fill="#002776" /></svg>;
        case 'kr': return <svg {...props}><rect fill="#FFFFFF" width="20" height="14" /><path d="M 7 7 A 3 3 0 0 0 13 7 Z" fill="#C60C30" /><path d="M 7 7 A 3 3 0 0 1 13 7 Z" fill="#0047A0" /></svg>;
        case 'jp': return <svg {...props}><rect fill="#FFFFFF" width="20" height="14" /><circle cx="10" cy="7" r="3.5" fill="#BC002D" /></svg>;
        case 'cn': return <svg {...props}><rect fill="#DE2910" width="20" height="14" /><polygon points="5,2.4 5.94,5.29 3.48,3.51 6.52,3.51 4.06,5.29" fill="#FFDE00" /><circle cx="9.2" cy="2.8" r="0.45" fill="#FFDE00" /><circle cx="10.6" cy="3.8" r="0.45" fill="#FFDE00" /><circle cx="10.6" cy="6" r="0.45" fill="#FFDE00" /><circle cx="9.2" cy="7.2" r="0.45" fill="#FFDE00" /></svg>;
        case 'sa': return <svg {...props}><rect fill="#006C35" width="20" height="14" /><path d="M 4 9 Q 10 6 16 9 L 16 10 Q 10 7 4 10 Z" fill="#FFFFFF" /></svg>;
        case 'in': return <svg {...props}><rect fill="#FF9932" width="20" height="4.67" /><rect fill="#FFFFFF" y="4.67" width="20" height="4.66" /><rect fill="#138808" y="9.33" width="20" height="4.67" /><circle cx="10" cy="7" r="1.8" fill="none" stroke="#000080" strokeWidth="0.4" /><circle cx="10" cy="7" r="0.5" fill="#000080" /></svg>;
        case 'ru': return <svg {...props}><rect fill="#FFFFFF" width="20" height="4.67" /><rect fill="#0039A6" y="4.67" width="20" height="4.66" /><rect fill="#D52B1E" y="9.33" width="20" height="4.67" /></svg>;
        case 'id': return <svg {...props}><rect fill="#FF0000" width="20" height="7" /><rect fill="#FFFFFF" y="7" width="20" height="7" /></svg>;
        case 'tr': return <svg {...props}><rect fill="#E30A17" width="20" height="14" /><circle cx="7" cy="7" r="4" fill="#FFFFFF" /><circle cx="8.2" cy="7" r="3.2" fill="#E30A17" /><circle cx="13" cy="7" r="1.2" fill="#FFFFFF" /></svg>;
        default: return <svg {...props}><rect fill="#888888" width="20" height="14" /></svg>;
    }
}

// Language Switcher Component
function LanguageSwitcher() {
    const { language, changeLanguage, applyLanguage } = useTranslation();
    const { isCorporate } = useLayout();
    // (#389): On the login page (unauthenticated) we must NOT
    // hit /api/user/preferences — it would always 401 and spam the console.
    const auth = useContext(AuthContext);
    const switchLang = (auth && auth.isAuthenticated) ? changeLanguage : applyLanguage;
    const langs = [
        { code: 'de', cc: 'at', label: 'DE', title: 'Deutsch' },
        { code: 'en', cc: 'gb', label: 'EN', title: 'English' },
        { code: 'it', cc: 'it', label: 'IT', title: 'Italiano' },
        { code: 'fr', cc: 'fr', label: 'FR', title: 'Français' },
        { code: 'es', cc: 'es', label: 'ES', title: 'Español (LATAM)' },
        { code: 'pt', cc: 'br', label: 'PT', title: 'Português' },
        { code: 'ko', cc: 'kr', label: 'KO', title: '한국어' },
        { code: 'ja', cc: 'jp', label: 'JA', title: '日本語' },
        { code: 'zh-hans', cc: 'cn', label: 'ZH', title: '简体中文' },
        { code: 'ar', cc: 'sa', label: 'AR', title: 'العربية' },
        { code: 'hi', cc: 'in', label: 'HI', title: 'हिन्दी' },
        { code: 'ru', cc: 'ru', label: 'RU', title: 'Русский' },
        { code: 'id', cc: 'id', label: 'ID', title: 'Bahasa Indonesia' },
        { code: 'tr', cc: 'tr', label: 'TR', title: 'Türkçe' },
    ];
    const activeLanguage = langs.find(l => l.code === language) || langs[0];
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef(null);

    useEffect(() => {
        const handleClick = (e) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    return (
        <div
            ref={wrapperRef}
            className={isCorporate ? 'corp-settings-card language-switcher relative flex items-center gap-2' : 'language-switcher relative flex items-center gap-2 rounded-lg px-2 py-1.5 border border-proxmox-border bg-proxmox-dark'}
        >
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className={isCorporate ? 'corp-input language-switcher-trigger flex items-center gap-2 px-2 py-1.5 text-sm bg-transparent border-0 focus:outline-none' : 'language-switcher-trigger flex items-center gap-2 px-2 py-1.5 text-sm text-proxmox-text bg-transparent border-0 focus:outline-none'}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label="Select language"
                title={activeLanguage.title}
            >
                <LanguageFlag cc={activeLanguage.cc} alt={activeLanguage.title} />
                <span>{activeLanguage.label}</span>
                <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {open && (
                <div
                    role="listbox"
                    className="absolute top-full right-0 mt-1 min-w-full rounded-lg border border-proxmox-border bg-proxmox-card shadow-lg z-50 overflow-hidden backdrop-blur-sm"
                >
                    {langs.map(l => (
                        <div
                            key={l.code}
                            role="option"
                            aria-selected={l.code === language}
                            onClick={() => { setOpen(false); switchLang(l.code); }}
                            className={l.code === language ? 'language-switcher-option flex items-center gap-2 px-3 py-2 text-sm font-medium text-proxmox-text cursor-pointer' : 'language-switcher-option flex items-center gap-2 px-3 py-2 text-sm text-proxmox-text cursor-pointer'}
                        >
                            <LanguageFlag cc={l.cc} alt={l.title} />
                            <span>{l.label}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ============================================
// Authentication System
// Simple session-based auth. Sessions stored server-side.
// Passwords hashed with bcrypt on backend.
// ============================================

const AuthContext = createContext();

function AuthProvider({ children }) {
    const { t, applyLanguage } = useTranslation();
    const [user, setUser] = useState(null);
    // Security fix - session cookie is HttpOnly (can't be stolen by XSS)
    // But we also keep sessionId in memory for WebSocket auth (not in localStorage!)
    const [sessionId, setSessionId] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [passwordExpiry, setPasswordExpiry] = useState(null);  // Track password expiration
    const [requires2FASetup, setRequires2FASetup] = useState(false);  // Force 2FA setup
    const [ldapEnabled, setLdapEnabled] = useState(false);  // LDAP available
    const [oidcEnabled, setOidcEnabled] = useState(false);  // OIDC available
    const [oidcButtonText, setOidcButtonText] = useState('Sign in with SSO');
    const [loginBackground, setLoginBackground] = useState('');
    const [reverseProxyEnabled, setReverseProxyEnabled] = useState(false);
    // When /auth/check returns initialized=false the install
    // hasn't run the first-admin setup yet. Frontend gates this to render
    // <SetupWizard /> instead of <LoginScreen />.
    const [needsSetup, setNeedsSetup] = useState(false);

    // Check session on mount
    useEffect(() => {
        checkSession();
    }, []);

    // check if session still valid (cookie is sent automatically)
    const checkSession = async () => {
        try {
            // Add cache-busting to prevent stale data
            const r = await fetch(`${API_URL}/auth/check?t=${Date.now()}`, {
                credentials: 'include',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                }
            });

            if (r && r.ok) {
                const d = await r.json();
                // Removed session response log (leaked session_id to console)
                // Persist air-gap flag for the next page
                // load so the boot script knows to skip CDN/font fetches.
                try {
                    if (d.air_gap_mode) localStorage.setItem('ProxmoxVEx-air-gap', '1');
                    else localStorage.removeItem('ProxmoxVEx-air-gap');
                } catch (_) { }
                if (d.authenticated) {
                    // Portal_only users must not access main dashboard
                    if (d.user?.portal_only && !window.location.pathname.startsWith('/portal')) {
                        logout();
                        setLoading(false);
                        return;
                    }
                    setUser(d.user);
                    setIsAuthenticated(true);
                    // Get session_id from response for WebSocket auth
                    if (d.session_id) {
                        setSessionId(d.session_id);
                    }
                    // Store password expiry info if present
                    if (d.password_expiry) {
                        setPasswordExpiry(d.password_expiry);
                    }
                    // Check if server requires 2FA setup
                    if (d.requires_2fa_setup) {
                        setRequires2FASetup(true);
                    } else {
                        setRequires2FASetup(false);
                    }
                    // Apply user's saved language (server overrides local)
                    if (d.user?.language && translations[d.user.language]) {
                        applyLanguage(d.user.language);
                    }
                    // Apply user's saved theme or the server default.
                    // vCenter/Corporate layout no longer forces a corporate-only palette,
                    // so the theme chosen in the profile color picker is respected.
                    const userTheme = d.user?.theme || d.default_theme || 'proxmoxDark';
                    ProxmoxVExLog.debug('[Theme] checkSession - Server theme:', d.user?.theme, 'Default:', d.default_theme, 'Using:', userTheme);
                    if (userTheme && ProxmoxVEx_THEMES[userTheme]) {
                        applyTheme(userTheme);
                    }
                    // Store reverse proxy status
                    if (d.reverse_proxy_enabled !== undefined) {
                        setReverseProxyEnabled(d.reverse_proxy_enabled);
                    }
                } else {
                    // Server returns 200 with authenticated=False and login page metadata
                    // so we never hit the browser's "Failed to load resource" 401 path.
                    setUser(null);
                    setSessionId(null);
                    setIsAuthenticated(false);
                    if (d.ldap_enabled !== undefined) setLdapEnabled(d.ldap_enabled);
                    if (d.oidc_enabled !== undefined) { setOidcEnabled(d.oidc_enabled); setOidcButtonText(d.oidc_button_text || 'Sign in with SSO'); }
                    if (d.login_background) setLoginBackground(d.login_background);
                    if (d.initialized === false) setNeedsSetup(true);
                    else setNeedsSetup(false);
                }
            } else {
                // Capture ldap_enabled from 401 response
                try {
                    const errData = await r.json();
                    if (errData.ldap_enabled !== undefined) setLdapEnabled(errData.ldap_enabled);
                    if (errData.oidc_enabled !== undefined) { setOidcEnabled(errData.oidc_enabled); setOidcButtonText(errData.oidc_button_text || 'Sign in with SSO'); }
                    if (errData.login_background) setLoginBackground(errData.login_background);
                    if (errData.reverse_proxy_enabled !== undefined) setReverseProxyEnabled(errData.reverse_proxy_enabled);
                    // First-run signal from backend
                    if (errData.initialized === false) setNeedsSetup(true);
                    else setNeedsSetup(false);
                } catch (e) { }
                logout();
            }
        } catch (err) {
            console.error('Session check failed');
            logout();
        }
        setLoading(false);
    };

    // -lw: Main login handler - supports 2FA flow + remember me
    const login = async (username, password, totpCode = '', remember = false, webauthnProof = '') => {
        setError(null);
        try {
            const resp = await fetch(`${API_URL}/auth/login`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, totp_code: totpCode, remember, webauthn_proof: webauthnProof })
            });

            const data = await resp.json();

            // Rate-limit / lockout — server returns 401+locked for user lockouts
            // (audit #5: uniform 401 stops username enumeration) and 429 for IP-level.
            // Both carry data.locked + data.retry_after.
            if (data.locked) {
                // user-friendly error message derived from retry_after, since
                // the server response stays generic ("Invalid credentials") to avoid
                // leaking which users exist
                const sec = data.retry_after || 0;
                const mins = Math.ceil(sec / 60);
                setError(t('accountLocked')
                    ? t('accountLocked').replace('{mins}', mins)
                    : `Too many failed attempts. Try again in ~${mins} min.`);
                return { success: false, locked: true, retry_after: sec };
            }
            if (resp.status === 429) {
                setError(data.error || 'Too many requests, slow down.');
                return { success: false, locked: false };
            }

            // 2fa required?
            if (resp.ok && data.requires_2fa) {
                return { requires_2fa: true };
            }

            if (resp.ok && data.success) {
                // portal_only users can't use main dashboard
                if (data.portal_only && !window.location.pathname.startsWith('/portal')) {
                    setError(t('portalOnlyAccount'));
                    return { success: false, portal_only: true };
                }
                setUser(data.user);
                setIsAuthenticated(true);
                // Keep session_id in memory for WebSocket auth
                if (data.session_id) {
                    setSessionId(data.session_id);
                }
                // Check if force 2FA setup is required
                if (data.requires_2fa_setup) {
                    setRequires2FASetup(true);
                }
                // Apply user's saved language on login
                if (data.user?.language && translations[data.user.language]) {
                    applyLanguage(data.user.language);
                }
                // Apply user's saved theme (with fallback to default).
                // vCenter/Corporate layout no longer forces a corporate-only palette,
                // so the theme chosen in the profile color picker is respected.
                const userTheme = data.user?.theme || data.default_theme || 'proxmoxDark';
                ProxmoxVExLog.debug('[Theme] Login - Server theme:', data.user?.theme, 'Default:', data.default_theme, 'Using:', userTheme);
                if (userTheme && ProxmoxVEx_THEMES[userTheme]) {
                    applyTheme(userTheme);
                }
                // Store reverse proxy status
                if (data.reverse_proxy_enabled !== undefined) {
                    setReverseProxyEnabled(data.reverse_proxy_enabled);
                }
                // Security warning for default password
                if (data.security_warning === 'DEFAULT_PASSWORD') {
                    setTimeout(() => {
                        alert('⚠️ SECURITY WARNING!\n\nYou are using the default admin password.\nPlease change it immediately in Settings ↑ Users!');
                    }, 500);
                }
                return { success: true };
            } else {
                setError(data.error || 'Login failed');
                return { success: false, error: data.error };
            }
        } catch (err) {
            console.error('login err', err);
            setError('Connection error');
            return { success: false, error: 'Connection error' };
        }
    };

    // Update user preferences (theme, language, ui_layout)
    const updatePreferences = async (prefs) => {
        try {
            if (DEBUG) ProxmoxVExLog.debug('updatePreferences:', Object.keys(prefs));
            const r = await fetch(`${API_URL}/user/preferences`, {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(prefs)
            });
            if (DEBUG) ProxmoxVExLog.debug('updatePreferences status:', r.status);

            if (r.ok) {
                const data = await r.json();
                if (DEBUG) ProxmoxVExLog.debug('updatePreferences: ok');

                // Update user in state
                setUser(currentUser => {
                    const updated = {
                        ...currentUser,
                        theme: data.theme,
                        language: data.language,
                        ui_layout: data.ui_layout,
                        taskbar_auto_expand: data.taskbar_auto_expand,
                        taskbar_visible: data.taskbar_visible,
                        taskbar_expanded: data.taskbar_expanded,
                        sidebar_show_vmid: data.sidebar_show_vmid,
                        layout_chosen: data.layout_chosen
                    };
                    // State updated, no log needed
                    return updated;
                });

                // Apply theme immediately AND save to localStorage
                if (data.theme && ProxmoxVEx_THEMES[data.theme]) {
                    applyTheme(data.theme);
                }
                return { success: true, data };
            }

            const errorData = await r.json().catch(() => ({}));
            console.error('updatePreferences: Request failed:', errorData);
            return { success: false, error: errorData.error };
        } catch (e) {
            console.error('Failed to update preferences:', e);
            return { success: false, error: e.message };
        }
    };

    const updateCurrentUser = (updates) => {
        setUser(currentUser => currentUser ? { ...currentUser, ...updates } : currentUser);
    };

    const logout = async () => {
        try {
            await fetch(`${API_URL}/auth/logout`, {
                method: 'POST',
                credentials: 'include'
            });
        } catch (err) {
            console.error('Logout request failed:', err);
        }
        setUser(null);
        setSessionId(null);
        setIsAuthenticated(false);
        // #295 - re-fetch login page info so OIDC button shows after logout
        try {
            const r = await fetch(`${API_URL}/auth/check?t=${Date.now()}`, { credentials: 'include' });
            const d = await r.json();
            if (d.oidc_enabled !== undefined) { setOidcEnabled(d.oidc_enabled); setOidcButtonText(d.oidc_button_text || 'Sign in with SSO'); }
            if (d.ldap_enabled !== undefined) setLdapEnabled(d.ldap_enabled);
            if (d.login_background) setLoginBackground(d.login_background);
        } catch (e) { }
    };

    const getAuthHeaders = useCallback(() => {
        return sessionId ? { 'X-Session-ID': sessionId } : {};
    }, [sessionId]);

    const clearError = useCallback(() => setError(null), []);

    return (
        <AuthContext.Provider value={{ user, sessionId, isAuthenticated, loading, error, clearError, login, logout, getAuthHeaders, isAdmin: user?.role === 'admin', passwordExpiry, requires2FASetup, setRequires2FASetup, updatePreferences, updateCurrentUser, ldapEnabled, oidcEnabled, oidcButtonText, loginBackground, reverseProxyEnabled, needsSetup, setNeedsSetup }}>
            {children}
        </AuthContext.Provider>
    );
}

function useAuth() {
    return useContext(AuthContext);
}

// Layout hook (reads from user preferences)
// returns layout type and convenience boolean for corporate mode
function useLayout() {
    const { user } = useAuth();
    // vCenter/Corporate is now the only supported layout; Modern has been removed.
    const rawLayout = user?.ui_layout || 'corporate';
    const validLayouts = ['corporate'];
    const layout = validLayouts.includes(rawLayout) ? rawLayout : 'corporate';
    const isCorporate = layout === 'corporate';

    // Set data-layout on body and gate the vCenter light-mode CSS overrides
    // based on the currently-applied theme. The theme itself is applied once
    // at login/session check and whenever the user picks one in the profile.
    useEffect(() => {
        document.body.setAttribute('data-layout', layout);
        const currentTheme = localStorage.getItem('ProxmoxVEx-theme') || user?.theme || 'corporateDark';
        document.body.dataset.corpTheme = currentTheme.endsWith('Light') ? 'light' : '';
    }, [user?.theme]);

    // (scale) - the corporate sidebar "show VM IDs" pref renders
    // the #vmid via a CSS ::after on each row (see index.html) instead of an
    // extra <span> per guest. Gate it with a single body flag so toggling the
    // pref costs nothing at 1000+ VMs (no per-row React re-render / DOM node).
    useEffect(() => {
        if (isCorporate && user?.sidebar_show_vmid) {
            document.body.dataset.sidebarVmid = '1';
        } else {
            delete document.body.dataset.sidebarVmid;
        }
    }, [isCorporate, user?.sidebar_show_vmid]);

    return { layout, isCorporate };
}
