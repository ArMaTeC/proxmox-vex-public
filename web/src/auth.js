/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        web/src/auth.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Auth JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
const authFetch = (url, opts = {}) => fetch(url, { ...opts, credentials: 'include', headers: { ...opts.headers } });

// Pick a logo that contrasts with the active page background.
// light themes (Clean Slate, vCenter Light, etc.) get the dark logo;
// dark themes get the light logo so it is always visible.
function getThemeLogoSrc() {
    try {
        const themeName = localStorage.getItem('ProxmoxVEx-theme') || 'proxmoxDark';
        const theme = (typeof ProxmoxVEx_THEMES !== 'undefined' && ProxmoxVEx_THEMES[themeName]) || null;
        if (theme && theme.colors && theme.colors.darker) {
            const hex = theme.colors.darker.replace('#', '');
            const r = parseInt(hex.substring(0, 2), 16) || 0;
            const g = parseInt(hex.substring(2, 4), 16) || 0;
            const b = parseInt(hex.substring(4, 6), 16) || 0;
            const isLight = (r + g + b) > 382;
            return isLight ? '/images/ProxmoxVEx-logo-dark.png' : '/images/ProxmoxVEx-logo-light.png';
        }
    } catch (_) { }
    return '/images/ProxmoxVEx-logo-dark.png';
}

const currentUserManagementTheme = () => document.documentElement?.getAttribute('data-theme') || 'proxmoxDark';

function UserManagementResizablePanels({ left, right }) {
    const [leftWidth, setLeftWidth] = useState(300);
    const [dragging, setDragging] = useState(false);

    const handleMouseDown = (e) => {
        setDragging(true);
        const startX = e.clientX;
        const startWidth = leftWidth;
        const onMouseMove = (ev) => {
            const delta = ev.clientX - startX;
            setLeftWidth(Math.max(180, Math.min(startWidth + delta, 600)));
        };
        const onMouseUp = () => {
            setDragging(false);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    return (
        <div className={`flex h-full ${dragging ? 'select-none' : ''}`}>
            <div className="h-full overflow-auto p-2" style={{ width: leftWidth + 'px' }}>
                {left}
            </div>
            <div
                className="w-2 cursor-col-resize bg-proxmox-border hover:bg-proxmox-orange rounded-full self-stretch"
                onMouseDown={handleMouseDown}
            />
            <div className="flex-1 h-full overflow-auto p-2 space-y-4">
                {right}
            </div>
        </div>
    );
}

function LoginScreen() {
    const { t } = useTranslation();
    const { isCorporate } = useLayout();
    const { login, error, clearError, ldapEnabled, oidcEnabled, oidcButtonText, loginBackground } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [totpCode, setTotpCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [requires2FA, setRequires2FA] = useState(false);
    // Which 2FA methods are available for the user who just entered password
    const [twoFAMethods, setTwoFAMethods] = useState([]);
    const [webauthnBusy, setWebauthnBusy] = useState(false);
    const [webauthnError, setWebauthnError] = useState('');
    const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('ProxmoxVEx-remember') === 'true');

    const [oidcLoading, setOidcLoading] = useState(false);

    const usernameRef = React.useRef(null);
    const passwordRef = React.useRef(null);

    // (#501) - sync React state with browser autofill values.
    // Password managers / browsers fill the DOM input without always
    // firing an `input` event, leaving the button disabled. Poll the
    // real DOM value while the login screen is mounted so the sign-in
    // button becomes active as soon as the username and password are filled.
    React.useEffect(() => {
        const sync = () => {
            if (usernameRef.current) {
                const u = usernameRef.current.value;
                setUsername(prev => u !== prev ? u : prev);
            }
            if (passwordRef.current) {
                const p = passwordRef.current.value;
                setPassword(prev => p !== prev ? p : prev);
            }
        };
        sync();
        const id = setInterval(sync, 250);
        return () => clearInterval(id);
    }, []);

    // Handle OIDC callback (check URL for auth code on mount)
    React.useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');
        if (code && state) {
            // We got redirected back from IdP with auth code
            setOidcLoading(true);
            fetch(`${API_URL}/auth/oidc/callback`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, state })
            })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        // Redirect to portal if OIDC flow was started from there
                        // Backend filters strictly, but enforce the
                        // same rule client-side too: single leading /, not //
                        // (protocol-relative), no backslash, no control chars.
                        const ra = data.redirect_after;
                        if (ra && typeof ra === 'string' && ra.length < 200
                            && ra.charAt(0) === '/' && ra.charAt(1) !== '/' && ra.charAt(1) !== '\\'
                            && !/[\r\n\t\\]/.test(ra)) {
                            window.location.href = ra;
                            return;
                        }
                        // Clear URL params and reload to authenticated state
                        window.history.replaceState({}, '', window.location.pathname);
                        window.location.reload();
                    } else {
                        setOidcError(data.error || 'OIDC authentication failed');
                        window.history.replaceState({}, '', window.location.pathname);
                    }
                })
                .catch(() => { setOidcError('Network error during OIDC callback'); })
                .finally(() => setOidcLoading(false));
        }
    }, []);

    const [oidcError, setOidcError] = useState('');

    const handleOidcLogin = async () => {
        setOidcLoading(true);
        setOidcError('');
        try {
            const res = await fetch(`${API_URL}/auth/oidc/authorize`, { credentials: 'include' });
            const data = await res.json();
            if (data.auth_url && data.auth_url.startsWith('https://')) {
                window.location.href = data.auth_url;
            } else if (data.auth_url) {
                // Block non-https redirects (open redirect prevention)
                console.error('OIDC auth_url must use https');
                setOidcError('Insecure authentication URL rejected');
            } else {
                setOidcError(data.error || 'Failed to get authorization URL');
                setOidcLoading(false);
            }
        } catch (e) {
            setOidcError('Network error');
            setOidcLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!username || !password) return;
        if (requires2FA && !totpCode) return;

        setLoading(true);
        try {
            localStorage.setItem('ProxmoxVEx-remember', rememberMe);
            const result = await login(username, password, totpCode, rememberMe);

            if (result?.requires_2fa) {
                setRequires2FA(true);
                // server hints which 2FA methods the user has configured
                if (Array.isArray(result.methods)) setTwoFAMethods(result.methods);
            }
        } finally {
            setLoading(false);
        }
    };

    // WebAuthn flow for 2FA step. Hits /webauthn/auth/begin,
    // asks the browser, then /webauthn/auth/finish returns a one-shot proof
    // token we pipe into /auth/login so the session can be minted.
    const handleWebauthnLogin = async () => {
        if (!('credentials' in navigator) || !navigator.credentials.get) {
            return;
        }
        setWebauthnBusy(true);
        setWebauthnError('');
        try {
            // helpers — same shape as create_modals.js but inline here to avoid a new import
            const b64urlToBuf = (s) => {
                const pad = '='.repeat((4 - s.length % 4) % 4);
                const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
                const buf = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
                return buf.buffer;
            };
            const bufToB64url = (buf) => {
                const bin = String.fromCharCode(...new Uint8Array(buf));
                return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            };
            const begin = await fetch(`${API_URL}/webauthn/auth/begin`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                credentials: 'include', body: JSON.stringify({ username })
            });
            if (!begin.ok) throw new Error((await begin.json().catch(() => ({}))).error || `begin ${begin.status}`);
            const opts = await begin.json();
            const pko = opts.publicKey || opts;
            const publicKey = {
                ...pko,
                challenge: b64urlToBuf(pko.challenge),
                allowCredentials: (pko.allowCredentials || []).map(c => ({ ...c, id: b64urlToBuf(c.id) })),
            };
            const assertion = await navigator.credentials.get({ publicKey });
            if (!assertion) throw new Error('cancelled');
            const finishBody = {
                username,
                id: assertion.id,
                rawId: bufToB64url(assertion.rawId),
                type: assertion.type,
                response: {
                    clientDataJSON: bufToB64url(assertion.response.clientDataJSON),
                    authenticatorData: bufToB64url(assertion.response.authenticatorData),
                    signature: bufToB64url(assertion.response.signature),
                    userHandle: assertion.response.userHandle ? bufToB64url(assertion.response.userHandle) : null,
                },
            };
            const finish = await fetch(`${API_URL}/webauthn/auth/finish`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                credentials: 'include', body: JSON.stringify(finishBody)
            });
            const fd = await finish.json().catch(() => ({}));
            if (!finish.ok || !fd.proof) throw new Error(fd.error || `finish ${finish.status}`);
            // Now complete login with the proof
            setLoading(true);
            const result = await login(username, password, '', rememberMe, fd.proof);
            setLoading(false);
            if (result?.requires_2fa) setRequires2FA(true);  // shouldn't happen on success
        } catch (e) {
            console.warn('webauthn login:', e);
            setWebauthnError('Security key login failed — please try again');
        }
        setWebauthnBusy(false);
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-proxmox-darker text-proxmox-text relative overflow-hidden p-4">
            {/* Ambient accent glows - theme-safe, driven by the active accent color */}
            <div className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-proxmox-orange/20 blur-3xl animate-pulse"></div>
            <div className="pointer-events-none absolute -bottom-40 -right-24 w-[28rem] h-[28rem] rounded-full bg-proxmox-orange/10 blur-3xl animate-pulse"></div>

            {/* Brand / feature panel - desktop only */}
            <div className="hidden">
                <div className="flex items-center gap-3">
                    <img
                        src="/images/ProxmoxVEx-logo-dark.png"
                        alt="ProxmoxVEx"
                        className="w-10 h-10 object-contain"
                        onError={(e) => { e.target.style.display = 'none'; }}
                    />
                    <span className="text-lg font-semibold tracking-tight text-proxmox-text">ProxmoxVEx</span>
                </div>

                <div className="max-w-md">
                    <h1 className="text-4xl font-bold leading-tight mb-4 text-proxmox-text">
                        Command your Proxmox clusters<span className="text-proxmox-orange">.</span>
                    </h1>
                    <p className="text-proxmox-textMuted text-lg mb-10">{t('loginSubtitle')}</p>

                    <div className="space-y-5">
                        <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-lg bg-proxmox-orange/10 text-proxmox-orange flex items-center justify-center shrink-0">
                                <Icons.Activity />
                            </div>
                            <div>
                                <p className="font-medium text-proxmox-text">Live cluster insight</p>
                                <p className="text-sm text-proxmox-textMuted">Real-time metrics across every node and VM.</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-lg bg-proxmox-orange/10 text-proxmox-orange flex items-center justify-center shrink-0">
                                <Icons.Layers />
                            </div>
                            <div>
                                <p className="font-medium text-proxmox-text">Unified management</p>
                                <p className="text-sm text-proxmox-textMuted">Control VMs, storage and networking from one place.</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-lg bg-proxmox-orange/10 text-proxmox-orange flex items-center justify-center shrink-0">
                                <Icons.Shield />
                            </div>
                            <div>
                                <p className="font-medium text-proxmox-text">Enterprise-grade security</p>
                                <p className="text-sm text-proxmox-textMuted">SSO, LDAP, WebAuthn and 2FA out of the box.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <p className="text-xs text-proxmox-textMuted">ProxmoxVEx Cluster Management {ProxmoxVEx_VERSION}</p>
            </div>

            {/* Sign-in panel */}
            <div className="w-full flex items-center justify-center p-4 sm:p-8 relative"
                style={loginBackground ? {
                    backgroundImage: `url(${loginBackground})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat'
                } : undefined}>
                {loginBackground && (
                    <div className="absolute inset-0 bg-proxmox-darker/50" />
                )}
                <div className="w-full max-w-sm relative z-10">
                    {/* Logo and Title - shown on mobile/tablet where the brand panel is hidden */}
                    <div className="text-center mb-8 lg:hidden">
                        <img
                            src={getThemeLogoSrc()}
                            alt="ProxmoxVEx"
                            className="w-28 h-28 mx-auto mb-5 object-contain drop-shadow-[0_8px_24px_rgba(229,112,0,0.35)]"
                            onError={(e) => {
                                // fallback to styled div if PNG not found
                                e.target.outerHTML = '<div class="w-16 h-16 mx-auto mb-4 rounded-full bg-proxmox-orange flex items-center justify-center shadow-lg"><svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" /></svg></div>';
                            }}
                        />
                        <h1 className="text-2xl font-bold text-proxmox-text mb-1">ProxmoxVEx</h1>
                        <p className="text-proxmox-textMuted text-sm">{t('loginSubtitle')}</p>
                    </div>

                    {/* Login Form */}
                    <div className="glass-panel rounded-2xl p-8 shadow-2xl">
                        <h2 className="text-xl font-semibold text-proxmox-text mb-1">
                            {requires2FA ? t('twoFARequired') : t('loginTitle')}
                        </h2>
                        <p className="text-sm text-proxmox-textMuted mb-6">
                            {requires2FA ? (t('twoFAHint')) : (t('loginSubtitle2'))}
                        </p>

                        {error && (
                            <div className="mb-4 p-3 bg-theme-error/10 border border-theme-error/30 rounded-lg text-theme-error text-sm">
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-5">
                            {!requires2FA ? (
                                <>
                                    <div>
                                        <label className={isCorporate ? 'corp-label' : 'block text-sm font-medium text-proxmox-textMuted mb-2'}>
                                            {t('usernameLabel')}
                                        </label>
                                        <input
                                            type="text"
                                            ref={usernameRef}
                                            value={username}
                                            onChange={(e) => { setUsername(e.target.value); clearError(); }}
                                            onBlur={(e) => { setUsername(e.target.value); clearError(); }}
                                            onFocus={() => clearError()}
                                            className={isCorporate ? 'corp-input' : 'w-full px-4 py-3 glass-input rounded-xl text-proxmox-text placeholder-proxmox-textMuted'}
                                            placeholder="ProxmoxVEx"
                                            autoComplete="username"
                                            autoFocus
                                        />
                                    </div>

                                    <div>
                                        <label className={isCorporate ? 'corp-label' : 'block text-sm font-medium text-proxmox-textMuted mb-2'}>
                                            {t('passwordLabel')}
                                        </label>
                                        <div className="relative">
                                            <input
                                                type={showPassword ? 'text' : 'password'}
                                                ref={passwordRef}
                                                value={password}
                                                onChange={(e) => { setPassword(e.target.value); clearError(); }}
                                                onBlur={(e) => { setPassword(e.target.value); clearError(); }}
                                                onFocus={() => clearError()}
                                                className={isCorporate ? 'corp-input' : 'w-full px-4 py-3 glass-input rounded-xl text-proxmox-text placeholder-proxmox-textMuted pr-12'}
                                                placeholder="••••••••"
                                                autoComplete="current-password"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword(!showPassword)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-proxmox-textMuted hover:text-proxmox-text"
                                            >
                                                {showPassword ? (
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                                    </svg>
                                                ) : (
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                    </svg>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="space-y-4">
                                    {twoFAMethods.includes('webauthn') && (
                                        <div className="space-y-2">
                                            <button type="button" onClick={handleWebauthnLogin} disabled={webauthnBusy}
                                                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-proxmox-dark hover:bg-proxmox-hover border border-proxmox-border rounded-xl text-proxmox-text font-medium transition-colors disabled:opacity-50">
                                                {webauthnBusy ? <Icons.Loader className="w-5 h-5 animate-spin" /> : <Icons.Key className="w-5 h-5 text-proxmox-orange" />}
                                                {t('useSecurityKey')}
                                            </button>
                                            {webauthnError && (
                                                <p className="text-center text-theme-error text-sm">{webauthnError}</p>
                                            )}
                                        </div>
                                    )}
                                    {twoFAMethods.includes('webauthn') && twoFAMethods.includes('totp') && (
                                        <div className="flex items-center gap-3">
                                            <div className="flex-1 h-px bg-proxmox-border"></div>
                                            <span className="text-xs text-proxmox-textMuted uppercase">{t('or')}</span>
                                            <div className="flex-1 h-px bg-proxmox-border"></div>
                                        </div>
                                    )}
                                    {(twoFAMethods.length === 0 || twoFAMethods.includes('totp')) && (
                                        <div>
                                            <label className={isCorporate ? 'corp-label' : 'block text-sm font-medium text-proxmox-textMuted mb-2'}>
                                                {t('enter2FACode')}
                                            </label>
                                            <input
                                                type="text"
                                                value={totpCode}
                                                onChange={(e) => { setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6)); clearError(); }}
                                                onFocus={() => clearError()}
                                                className={isCorporate ? 'corp-input' : 'w-full px-4 py-3 glass-input rounded-xl text-proxmox-text text-center text-2xl tracking-widest placeholder-proxmox-textMuted'}
                                                placeholder="000000"
                                                maxLength={6}
                                                autoFocus
                                            />
                                            <p className="text-proxmox-textMuted text-sm mt-2 text-center">
                                                {t('scan2FACode')}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                            <label className="flex items-center gap-2 text-sm text-proxmox-textMuted cursor-pointer select-none">
                                <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} className="rounded border-proxmox-border bg-proxmox-dark" />
                                {t('rememberMe2')}
                            </label>

                            {/* submit button: hidden when user only has WebAuthn (the Use Security Key button handles it) */}
                            {!(requires2FA && twoFAMethods.length === 1 && twoFAMethods[0] === 'webauthn') && (
                                <button
                                    type="submit"
                                    disabled={loading || !username || !password || (requires2FA && twoFAMethods.includes('totp') && totpCode.length !== 6)}
                                    className="w-full py-3 login-button rounded-xl font-semibold flex items-center justify-center gap-2"
                                >
                                    {loading ? (
                                        <>
                                            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            {t('loggingIn')}
                                        </>
                                    ) : (
                                        t('loginButton')
                                    )}
                                </button>
                            )}
                        </form>

                        {/* OIDC / Entra ID login */}
                        {oidcEnabled && (
                            <div className="mt-4">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="flex-1 h-px bg-proxmox-border"></div>
                                    <span className="text-xs text-proxmox-textMuted uppercase">or</span>
                                    <div className="flex-1 h-px bg-proxmox-border"></div>
                                </div>
                                {/* #295 - detect provider from button text, show matching icon + color */}
                                <button onClick={handleOidcLogin} disabled={oidcLoading}
                                    className={`w-full flex items-center justify-center gap-3 px-4 py-2.5 disabled:opacity-50 rounded-lg font-medium text-sm transition-colors ${(oidcButtonText || '').toLowerCase().includes('microsoft') || (oidcButtonText || '').toLowerCase().includes('entra')
                                        ? 'bg-[#0078d4] hover:bg-[#106ebe] text-white'
                                        : (oidcButtonText || '').toLowerCase().includes('google')
                                            ? 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-300'
                                            : 'bg-proxmox-card hover:bg-proxmox-hover border border-proxmox-border text-proxmox-text'
                                        }`}>
                                    {oidcLoading ? (
                                        <Icons.Loader className="w-5 h-5 animate-spin" />
                                    ) : (oidcButtonText || '').toLowerCase().includes('microsoft') || (oidcButtonText || '').toLowerCase().includes('entra') ? (
                                        <svg className="w-5 h-5" viewBox="0 0 21 21" fill="none"><path d="M0 0h10v10H0z" fill="#f25022" /><path d="M11 0h10v10H11z" fill="#7fba00" /><path d="M0 11h10v10H0z" fill="#00a4ef" /><path d="M11 11h10v10H11z" fill="#ffb900" /></svg>
                                    ) : (
                                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>
                                    )}
                                    {oidcButtonText || 'Sign in with SSO'}
                                </button>
                                {oidcError && (
                                    <p className="text-theme-error text-xs text-center mt-2">{oidcError}</p>
                                )}
                            </div>
                        )}

                        {/* LDAP indicator */}
                        {ldapEnabled && (
                            <div className="mt-3 flex items-center justify-center gap-2 text-xs text-proxmox-textMuted">
                                <Icons.Users className="w-3 h-3" />
                                <span>LDAP / Active Directory enabled</span>
                            </div>
                        )}
                    </div>

                    {/* Language Switcher */}
                    <div className="flex justify-center mt-6">
                        <LanguageSwitcher />
                    </div>

                </div>
            </div>

            <footer className="absolute bottom-0 left-0 right-0 border-t border-proxmox-border bg-proxmox-dark/50">
                <div className="max-w-[800px] mx-auto px-6 py-6 text-center text-xs text-gray-600">
                    <p>ProxmoxVEx {ProxmoxVEx_VERSION} • {t('madeWithLove2')}</p>
                </div>
            </footer>
        </div>
    );
}

// ═══════════════════════════════════════════════
// First-Run Setup Wizard
// Replaces the hardcoded `ProxmoxVEx/admin` bootstrap that
// exposed every fresh network-reachable install to remote takeover.
// Renders instead of LoginScreen when /auth/check returns initialized=false.
// ═══════════════════════════════════════════════
function SetupWizard() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [passwordConfirm, setPasswordConfirm] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState('');
    const [done, setDone] = useState(false);
    const { t } = useTranslation();
    const { isCorporate } = useLayout();

    const submit = async (e) => {
        e.preventDefault();
        setErr('');
        if (!username || username.length < 2) { setErr('Username must be at least 2 characters'); return; }
        if (username.toLowerCase() === 'ProxmoxVEx') { setErr("'ProxmoxVEx' is reserved — pick a different username"); return; }
        if (!password) { setErr('Password is required'); return; }
        if (password !== passwordConfirm) { setErr('Passwords do not match'); return; }
        setSubmitting(true);
        try {
            const r = await fetch(`${API_URL}/auth/setup`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username.trim().toLowerCase(),
                    password,
                    display_name: displayName,
                    email,
                }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
                setErr(data.error || `Setup failed (HTTP ${r.status})`);
                setSubmitting(false);
                return;
            }
            setDone(true);
            // reload after a short delay so AuthProvider re-checks and shows the login form
            setTimeout(() => window.location.reload(), 1500);
        } catch (e2) {
            setErr('Network error — could not reach server');
            setSubmitting(false);
        }
    };

    if (done) {
        return (
            <div className="min-h-screen bg-proxmox-darker text-proxmox-text flex items-center justify-center p-4">
                <div className="glass-panel rounded-2xl p-8 shadow-2xl max-w-md w-full text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-theme-success/20 flex items-center justify-center">
                        <svg className="w-10 h-10 text-theme-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-semibold text-proxmox-text mb-2">Setup complete</h2>
                    <p className="text-proxmox-textMuted">Redirecting to login…</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-proxmox-darker text-proxmox-text relative overflow-hidden p-4">
            <div className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-proxmox-orange/20 blur-3xl animate-pulse"></div>
            <div className="pointer-events-none absolute -bottom-40 -right-24 w-[28rem] h-[28rem] rounded-full bg-proxmox-orange/10 blur-3xl animate-pulse"></div>
            <div className="w-full max-w-md relative z-10">
                <div className="text-center mb-8">
                    <img
                        src={getThemeLogoSrc()}
                        alt="ProxmoxVEx"
                        className="w-32 h-32 mx-auto mb-5 object-contain drop-shadow-[0_8px_24px_rgba(229,112,0,0.35)]"
                        onError={(e) => { e.target.style.display = 'none'; }}
                    />
                    <h1 className="text-3xl font-bold text-proxmox-text mb-2">Welcome to ProxmoxVEx</h1>
                    <p className="text-proxmox-textMuted">Create the first administrator account to get started</p>
                </div>
                <div className="glass-panel rounded-2xl p-8 shadow-2xl">
                    <h2 className="text-xl font-semibold text-proxmox-text mb-6">First-Time Setup</h2>

                    {err && (
                        <div className="mb-4 p-3 bg-theme-error/10 border border-theme-error/30 rounded-lg text-theme-error text-sm">
                            {err}
                        </div>
                    )}

                    <form onSubmit={submit} className="space-y-5">
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-sm font-medium text-proxmox-textMuted mb-2'}>Username</label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className={isCorporate ? 'corp-input' : 'w-full px-4 py-3 glass-input rounded-xl text-proxmox-text placeholder-proxmox-textMuted'}
                                placeholder="admin"
                                autoComplete="username"
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-sm font-medium text-proxmox-textMuted mb-2'}>Password</label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className={isCorporate ? 'corp-input' : 'w-full px-4 py-3 glass-input rounded-xl text-proxmox-text placeholder-proxmox-textMuted pr-12'}
                                    placeholder="••••••••"
                                    autoComplete="new-password"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-proxmox-textMuted hover:text-proxmox-text z-10"
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    aria-pressed={showPassword}
                                >
                                    {showPassword ? (
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                        </svg>
                                    ) : (
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-sm font-medium text-proxmox-textMuted mb-2'}>Confirm password</label>
                            <div className="relative">
                                <input
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    value={passwordConfirm}
                                    onChange={(e) => setPasswordConfirm(e.target.value)}
                                    className={isCorporate ? 'corp-input' : 'w-full px-4 py-3 glass-input rounded-xl text-proxmox-text placeholder-proxmox-textMuted pr-12'}
                                    placeholder="••••••••"
                                    autoComplete="new-password"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-proxmox-textMuted hover:text-proxmox-text z-10"
                                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                                    aria-pressed={showConfirmPassword}
                                >
                                    {showConfirmPassword ? (
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                        </svg>
                                    ) : (
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-sm font-medium text-proxmox-textMuted mb-2'}>
                                Display name <span className="text-proxmox-textMuted font-normal">(optional)</span>
                            </label>
                            <input
                                type="text"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                className={isCorporate ? 'corp-input' : 'w-full px-4 py-3 glass-input rounded-xl text-proxmox-text placeholder-proxmox-textMuted'}
                                placeholder="Cluster Admin"
                            />
                        </div>
                        <div>
                            <label className={isCorporate ? 'corp-label' : 'block text-sm font-medium text-proxmox-textMuted mb-2'}>
                                Email <span className="text-proxmox-textMuted font-normal">(optional)</span>
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className={isCorporate ? 'corp-input' : 'w-full px-4 py-3 glass-input rounded-xl text-proxmox-text placeholder-proxmox-textMuted'}
                                placeholder="admin@example.com"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full px-4 py-3 bg-proxmox-orange hover:bg-orange-600 disabled:opacity-50 rounded-xl text-white font-semibold transition-colors"
                        >
                            {submitting ? 'Creating administrator…' : 'Create administrator'}
                        </button>
                    </form>

                    <p className="text-xs text-proxmox-textMuted mt-6 leading-relaxed">
                        This account becomes the first ProxmoxVEx administrator. Treat the
                        password like any other root credential — store it in your password
                        manager. You can create additional users (admin or scoped roles)
                        once you are logged in.
                    </p>
                </div>
                <p className="text-center text-proxmox-textMuted text-sm mt-6">
                    ProxmoxVEx Cluster Management {ProxmoxVEx_VERSION}
                </p>
            </div>

            <footer className="absolute bottom-0 left-0 right-0 border-t border-proxmox-border bg-proxmox-dark/50">
                <div className="max-w-[800px] mx-auto px-6 py-6 text-center text-xs text-gray-600">
                    <p>ProxmoxVEx {ProxmoxVEx_VERSION} • {t('madeWithLove2')}</p>
                </div>
            </footer>
        </div>
    );
}

function UserStatusBadge({ status }) {
    const color = status === 'active' ? 'bg-green-500' : status === 'inactive' ? 'bg-red-500' : 'bg-yellow-500';
    return <span className={`inline-block w-3 h-3 rounded-full ${color}`} />;
}

function UserBreadcrumbBar({ items }) {
    return (
        <nav className="text-sm text-gray-400 py-2">
            <ol className="flex items-center gap-2">
                {items.map((it, i) => (
                    <li key={i} className="flex items-center gap-2">
                        {i > 0 && <span>›</span>}
                        <span className="text-white">{it.label}</span>
                    </li>
                ))}
            </ol>
        </nav>
    );
}

// UserInviteBulkSelection: bulk select invitations for the User Invite view.
function UserInviteBulkSelection({ items = [], onSelect }) {
    const { t } = useTranslation();
    const [selected, setSelected] = React.useState({});
    const toggle = (id) => {
        const next = { ...selected, [id]: !selected[id] };
        setSelected(next);
        if (onSelect) onSelect(Object.keys(next).filter(k => next[k]));
    };
    const selectedCount = Object.values(selected).filter(Boolean).length;
    const [orderedItems, setOrderedItems] = useState(items);
    const [dragFrom, setDragFrom] = useState(null);
    const [filterText, setFilterText] = useState('');
    const filterInputRef = useRef(null);
    const [visibleColumns, setVisibleColumns] = useState(['id', 'label']);
    const columnOptions = ['id', 'label', 'email'];
    useEffect(() => { setOrderedItems(items); }, [items]);
    useEffect(() => {
        const handleKeydown = (e) => {
            if (e.key === '/' && filterInputRef.current) {
                e.preventDefault();
                filterInputRef.current.focus();
            }
        };
        window.addEventListener('keydown', handleKeydown);
        return () => window.removeEventListener('keydown', handleKeydown);
    }, []);
    const filteredItems = filterText
        ? orderedItems.filter(item => item.label.toLowerCase().includes(filterText.toLowerCase()))
        : orderedItems;
    return (
        <div className="p-2 rounded border border-proxmox-border bg-proxmox-card group hover:shadow-lg hover:scale-105 transition-transform duration-200" data-theme={currentUserManagementTheme()} data-testid="user-invite-bulk-selection">
            <UserBreadcrumbBar items={[{ label: t('bulkSelection') }]} />
            <div className="flex items-center gap-2 mb-2"><UserStatusBadge status={selectedCount > 0 ? 'active' : 'inactive'} /><div className="text-sm font-medium" style={{ color: 'var(--corp-text)' }}>{t('bulkSelection')}</div></div>
            <div className="text-sm mb-2" style={{ color: 'var(--corp-text-secondary)' }}>{selectedCount} {t('selected')}</div>
            <div className="flex flex-wrap gap-2 mb-2">
                {columnOptions.map((col) => (
                    <label key={col} className="flex items-center gap-1 text-sm" style={{ color: 'var(--corp-text-secondary)' }}>
                        <input
                            type="checkbox"
                            checked={visibleColumns.includes(col)}
                            onChange={() => setVisibleColumns(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col])}
                        /> {col}
                    </label>
                ))}
            </div>
            <input
                type="text"
                ref={filterInputRef}
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                className="w-full px-2 py-1 mb-2 bg-proxmox-secondary border border-proxmox-border rounded text-white text-sm"
            />
            <div className="space-y-1 max-h-40 overflow-y-auto">
                {filteredItems.map((item, index) => (
                    <label
                        key={item.id}
                        className="flex items-center gap-2 text-sm cursor-grab"
                        draggable
                        onDragStart={() => setDragFrom(index)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                            if (dragFrom === null) return;
                            const next = [...orderedItems];
                            const [moved] = next.splice(dragFrom, 1);
                            next.splice(index, 0, moved);
                            setOrderedItems(next);
                            setDragFrom(null);
                        }}
                        style={{ color: 'var(--corp-text-secondary)' }}
                    >
                        <span className="text-gray-500 select-none mr-1">⋮⋮</span>
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

// UserInviteStepByStepWizard: guided multi-step wizard for the User Invite view.
function UserInviteStepByStepWizard({ steps = [] }) {
    const { t } = useTranslation();
    const [step, setStep] = React.useState(0);
    const canNext = step < steps.length - 1;
    const canBack = step > 0;
    return (
        <div className="p-2 rounded border border-proxmox-border bg-proxmox-card group hover:shadow-lg hover:scale-105 transition-transform duration-200" data-theme={currentUserManagementTheme()} data-testid="user-invite-step-by-step-wizard">
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

// UserInviteContextMenu: context menu for the User Invite view.
function UserInviteContextMenu({ items = [], onSelect }) {
    const { t } = useTranslation();
    return (
        <div className="p-2 rounded border border-proxmox-border bg-proxmox-card group hover:shadow-lg hover:scale-105 transition-transform duration-200 inline-block min-w-[10rem]" data-theme={currentUserManagementTheme()} data-testid="user-invite-context-menu">
            <div className="text-sm font-medium mb-1" style={{ color: 'var(--corp-text)' }}>{t('contextMenu')}</div>
            {items.map((item) => (
                <button
                    key={item.id}
                    onClick={() => onSelect && onSelect(item.id)}
                    className="block w-full text-left px-2 py-1 text-sm rounded hover:bg-proxmox-hover"
                    style={{ color: 'var(--corp-text-secondary)' }}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}

// UserInviteRecentItems: recent items list for the User Invite view.
function UserInviteRecentItems({ items = [] }) {
    const { t } = useTranslation();
    return (
        <div className="p-2 rounded border border-proxmox-border bg-proxmox-card group hover:shadow-lg hover:scale-105 transition-transform duration-200" data-theme={currentUserManagementTheme()} data-testid="user-invite-recent-items">
            <div className="text-sm font-medium mb-2" style={{ color: 'var(--corp-text)' }}>{t('recentItems')}</div>
            <ul className="text-sm space-y-1" style={{ color: 'var(--corp-text-secondary)' }}>
                {items.map((item, index) => (
                    <li key={index} className="truncate">- {item}</li>
                ))}
            </ul>
        </div>
    );
}

// UserInviteUndoAction: undo the last user invite action.
function UserInviteUndoAction({ onUndo, canUndo = false }) {
    const { t } = useTranslation();
    return (
        <div className="p-2 rounded border border-proxmox-border bg-proxmox-card group hover:shadow-lg hover:scale-105 transition-transform duration-200" data-theme={currentUserManagementTheme()} data-testid="user-invite-undo-action">
            <div className="text-sm font-medium mb-2" style={{ color: 'var(--corp-text)' }}>{t('undoAction')}</div>
            <button
                onClick={onUndo}
                disabled={!canUndo}
                className="px-3 py-1.5 text-sm rounded bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50"
            >
                {t('undo')}
            </button>
        </div>
    );
}

// UserInviteQuickFilter: quick filter for the User Invite view.
function UserInviteQuickFilter({ options = [], onFilter }) {
    const { t } = useTranslation();
    const [active, setActive] = React.useState('');
    const select = (value) => {
        setActive(value);
        if (onFilter) onFilter(value);
    };
    return (
        <div className="p-2 rounded border border-proxmox-border bg-proxmox-card group hover:shadow-lg hover:scale-105 transition-transform duration-200" data-theme={currentUserManagementTheme()} data-testid="user-invite-quick-filter">
            <div className="text-sm font-medium mb-2" style={{ color: 'var(--corp-text)' }}>{t('quickFilter')}</div>
            <div className="flex flex-wrap gap-2">
                {options.map((option) => (
                    <button
                        key={option}
                        onClick={() => select(option)}
                        className={`px-2 py-1 text-xs rounded border ${active === option ? 'bg-cyan-600 border-cyan-600' : 'border-proxmox-border hover:bg-proxmox-hover'}`}
                        style={{ color: 'var(--corp-text-secondary)' }}
                    >
                        {option}
                    </button>
                ))}
            </div>
        </div>
    );
}

// UserInviteOneClickApply: one-click apply for the User Invite view.
function UserInviteOneClickApply({ onApply }) {
    const { t } = useTranslation();
    return (
        <div className="p-2 rounded border border-proxmox-border bg-proxmox-card group hover:shadow-lg hover:scale-105 transition-transform duration-200" data-theme={currentUserManagementTheme()} data-testid="user-invite-one-click-apply">
            <div className="text-sm font-medium mb-2" style={{ color: 'var(--corp-text)' }}>{t('oneClickApply')}</div>
            <button
                onClick={onApply}
                className="px-3 py-1.5 text-sm rounded bg-cyan-600 hover:bg-cyan-700"
            >
                {t('apply')}
            </button>
        </div>
    );
}

// UserInviteSmartDefaults: apply smart defaults for the User Invite view.
function UserInviteSmartDefaults({ onApply, defaults = {} }) {
    const { t } = useTranslation();
    return (
        <div className="p-2 rounded border border-proxmox-border bg-proxmox-card group hover:shadow-lg hover:scale-105 transition-transform duration-200" data-theme={currentUserManagementTheme()} data-testid="user-invite-smart-defaults">
            <div className="text-sm font-medium mb-2" style={{ color: 'var(--corp-text)' }}>{t('smartDefaults')}</div>
            <button
                onClick={() => onApply && onApply(defaults)}
                className="px-3 py-1.5 text-sm rounded bg-cyan-600 hover:bg-cyan-700"
            >
                {t('apply')}
            </button>
        </div>
    );
}

// UserInviteLivePreview: live preview for the User Invite view.
function UserInviteLivePreview({ preview = [] }) {
    const { t } = useTranslation();
    return (
        <div className="p-2 rounded border border-proxmox-border bg-proxmox-card group hover:shadow-lg hover:scale-105 transition-transform duration-200" data-theme={currentUserManagementTheme()} data-testid="user-invite-live-preview">
            <div className="text-sm font-medium mb-2" style={{ color: 'var(--corp-text)' }}>{t('livePreview')}</div>
            <ul className="text-sm space-y-1" style={{ color: 'var(--corp-text-secondary)' }}>
                {preview.map((item, index) => (
                    <li key={index}>- {item}</li>
                ))}
            </ul>
        </div>
    );
}

// UserInviteCompareView: compare view for the User Invite view.
function UserInviteCompareView({ baseline = [], current = [] }) {
    const { t } = useTranslation();
    const diffCount = Math.abs(baseline.length - current.length);
    return (
        <div className="p-2 rounded border border-proxmox-border bg-proxmox-card group hover:shadow-lg hover:scale-105 transition-transform duration-200" data-theme={currentUserManagementTheme()} data-testid="user-invite-compare-view">
            <div className="text-sm font-medium mb-2" style={{ color: 'var(--corp-text)' }}>{t('compareView')}</div>
            <div className="text-sm" style={{ color: 'var(--corp-text-secondary)' }}>{diffCount} {t('changes')}</div>
        </div>
    );
}

function CompactGridUserManagement() {
    return (
        <div className="p-2 rounded border border-proxmox-border bg-proxmox-card" data-testid="user-invite-compact-grid"></div>
    );
}
