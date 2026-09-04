/* --- ProxmoxVEx auto-header start ---
 * -------------------------------------------------------------------
 * File:        static/js/tailwind-config.js
 * Project:     ProxmoxVEx
 * Version:     1.2.303
 * Build:       2026.09.04
 * Description: Tailwind Config JS source
 * Docs:        https://proxmoxvex.local/docs
 * Generated:   2026-09-04
 * -------------------------------------------------------------------
 * --- ProxmoxVEx auto-header end --- */
const ProxmoxVEx_THEMES = {
    proxmoxDark: {
        name: 'Ember Core',
        icon: '🔥',
        description: 'Smouldering charcoal with burnt ember accents',
        colors: {
            primary: '#C75B2F',
            primaryHover: '#E07A4E',
            dark: '#1A1210',
            darker: '#0E0908',
            card: '#231A17',
            border: '#3D2E28',
            hover: '#2E221E',
            text: '#F7E8E4',
            textMuted: '#9C8B86',
            success: '#4CAF50',
            warning: '#FFC107',
            error: '#F44336',
            info: '#29B6F6'
        }
    },
    midnight: {
        name: 'Deep Indigo',
        icon: '🌌',
        description: 'Rich violet midnight with indigo highlights',
        colors: {
            primary: '#7C3AED',
            primaryHover: '#8B5CF6',
            dark: '#0F0C1B',
            darker: '#05040A',
            card: '#1C1631',
            border: '#312859',
            hover: '#261F45',
            text: '#F0EEFB',
            textMuted: '#9187BB',
            success: '#34D399',
            warning: '#FBBF24',
            error: '#FB7185',
            info: '#22D3EE'
        }
    },
    forest: {
        name: 'Mosswood',
        icon: '�',
        description: 'Deep woodland greens and mossy accents',
        colors: {
            primary: '#2D9E5F',
            primaryHover: '#3EC27A',
            dark: '#081C15',
            darker: '#03120C',
            card: '#0F2E20',
            border: '#1A4B35',
            hover: '#143828',
            text: '#E2F0EB',
            textMuted: '#6CA892',
            success: '#34D399',
            warning: '#FBBF24',
            error: '#F87171',
            info: '#38BDF8'
        }
    },
    rose: {
        name: 'Blush Petal',
        icon: '�',
        description: 'Soft rose mauve with warm pink highlights',
        colors: {
            primary: '#D81B60',
            primaryHover: '#EC407A',
            dark: '#1C1016',
            darker: '#0F080B',
            card: '#2A171D',
            border: '#4A2A33',
            hover: '#381F27',
            text: '#FFF0F4',
            textMuted: '#C494A3',
            success: '#66BB6A',
            warning: '#FFB74D',
            error: '#E53935',
            info: '#42A5F5'
        }
    },
    ocean: {
        name: 'Tidal Teal',
        icon: '🐋',
        description: 'Crisp teal waves over deep ocean blues',
        colors: {
            primary: '#0891B2',
            primaryHover: '#06B6D4',
            dark: '#081826',
            darker: '#030E16',
            card: '#0F2133',
            border: '#164E72',
            hover: '#153451',
            text: '#E0F2FE',
            textMuted: '#7DD3FC',
            success: '#22C55E',
            warning: '#EAB308',
            error: '#F43F5E',
            info: '#0EA5E9'
        }
    },
    highContrast: {
        name: 'Maximum Clarity',
        icon: '⚡',
        description: 'High-visibility neon red for sharp contrast',
        colors: {
            primary: '#FF3131',
            primaryHover: '#FF6B6B',
            dark: '#000000',
            darker: '#000000',
            card: '#0D0D0D',
            border: '#FFFFFF',
            hover: '#1F1F1F',
            text: '#FFFFFF',
            textMuted: '#CFCFCF',
            success: '#39FF14',
            warning: '#FFF01F',
            error: '#FF3131',
            info: '#00FFFF'
        }
    },
    // extra skins - Wanted more variety
    dracula: {
        name: 'Royal Velvet',
        icon: '👑',
        description: 'Regal purples and rich velvet tones',
        colors: {
            primary: '#A855F7',
            primaryHover: '#C084FC',
            dark: '#1E1B2E',
            darker: '#131124',
            card: '#2A263D',
            border: '#3F3A57',
            hover: '#3E3860',
            text: '#F5F3FF',
            textMuted: '#9A92C4',
            success: '#4ADE80',
            warning: '#FACC15',
            error: '#FB7185',
            info: '#22D3EE'
        }
    },
    nord: {
        name: 'Frostbound',
        icon: '🧊',
        description: 'Icy polar palette with frozen blue accents',
        colors: {
            primary: '#5E9CAF',
            primaryHover: '#7EB8C9',
            dark: '#1C2B33',
            darker: '#111C22',
            card: '#243944',
            border: '#3B5664',
            hover: '#2E4753',
            text: '#E8F5F9',
            textMuted: '#8EB5C3',
            success: '#6FBF84',
            warning: '#D6A86C',
            error: '#C06B6B',
            info: '#5B9FBC'
        }
    },
    monokai: {
        name: 'Synthwave Studio',
        icon: '�',
        description: 'Retro neon studio with hot pink and cyan',
        colors: {
            primary: '#FF2A6D',
            primaryHover: '#FF6F9C',
            dark: '#1A0B2E',
            darker: '#0F0520',
            card: '#2A1545',
            border: '#4A1E6E',
            hover: '#3D1F5C',
            text: '#FCEAFD',
            textMuted: '#D7A9E3',
            success: '#05FFA1',
            warning: '#FFEE00',
            error: '#FF2A6D',
            info: '#00D9FF'
        }
    },
    matrix: {
        name: 'Digital Rain',
        icon: '🌧️',
        description: 'Falling lime code on pitch black',
        colors: {
            primary: '#32CD32',
            primaryHover: '#58E658',
            dark: '#050505',
            darker: '#000000',
            card: '#0A0F0A',
            border: '#003300',
            hover: '#001A00',
            text: '#39FF14',
            textMuted: '#008F11',
            success: '#00FF00',
            warning: '#ADFF2F',
            error: '#FF0033',
            info: '#39FF14'
        }
    },
    sunset: {
        name: 'Horizon Glow',
        icon: '�',
        description: 'Warm coral sunset over a dusky sky',
        colors: {
            primary: '#FF7A50',
            primaryHover: '#FF9E7A',
            dark: '#1A1420',
            darker: '#0F0A14',
            card: '#2D2231',
            border: '#4D3A4E',
            hover: '#3D2E40',
            text: '#FFF4F0',
            textMuted: '#C9AFA6',
            success: '#84CC16',
            warning: '#F59E0B',
            error: '#E11D48',
            info: '#9333EA'
        }
    },
    cyberpunk: {
        name: 'Neon Sprawl',
        icon: '🌆',
        description: 'Pink and cyan lights of a future city',
        colors: {
            primary: '#FF00A0',
            primaryHover: '#FF4DBF',
            dark: '#0A0A14',
            darker: '#050508',
            card: '#12121A',
            border: '#00D4FF',
            hover: '#1A1A25',
            text: '#FFFFFF',
            textMuted: '#A89ACF',
            success: '#00FF9F',
            warning: '#FFFF00',
            error: '#FF0055',
            info: '#00D9FF'
        }
    },
    github: {
        name: 'Octo Ink',
        icon: '🐙',
        description: 'Deep ocean ink with inky blue-green accents',
        colors: {
            primary: '#2F9E7D',
            primaryHover: '#49C299',
            dark: '#0C1116',
            darker: '#05080B',
            card: '#151C24',
            border: '#2A3441',
            hover: '#1F2630',
            text: '#C8D8E9',
            textMuted: '#7D8FA8',
            success: '#39D353',
            warning: '#D29922',
            error: '#F85149',
            info: '#58A6FF'
        }
    },
    solarizedDark: {
        name: 'Desert Sun',
        icon: '🏜️',
        description: 'Golden amber sands over deep twilight',
        colors: {
            primary: '#D97706',
            primaryHover: '#F59E0B',
            dark: '#1E1A14',
            darker: '#120F0B',
            card: '#2C2520',
            border: '#4D3F33',
            hover: '#3D332A',
            text: '#FFF8E6',
            textMuted: '#CBB08A',
            success: '#65A30D',
            warning: '#FBBF24',
            error: '#DC2626',
            info: '#7C3AED'
        }
    },
    gruvbox: {
        name: 'Retro Crate',
        icon: '�',
        description: 'Warm brown and olive retro nostalgia',
        colors: {
            primary: '#B45309',
            primaryHover: '#D97706',
            dark: '#1F1A16',
            darker: '#0F0C0A',
            card: '#2C2620',
            border: '#3D352B',
            hover: '#3B3228',
            text: '#F0E6D7',
            textMuted: '#A89A88',
            success: '#84CC16',
            warning: '#FBBF24',
            error: '#EF4444',
            info: '#0EA5E9'
        }
    },
    // Corporate/Enterprise style themes
    corporateDark: {
        name: 'Boardroom Shadow',
        icon: '🏢',
        description: 'Dark navy slate for executive dashboards',
        colors: {
            primary: '#4F83CC',
            primaryHover: '#6FA3E0',
            dark: '#1B2533',
            darker: '#111821',
            card: '#243142',
            border: '#3A4A5E',
            hover: '#2D3D52',
            text: '#E2E8F0',
            textMuted: '#7F8C9A',
            success: '#52C41A',
            warning: '#F5A623',
            error: '#E85C4A',
            info: '#4F83CC'
        }
    },
    corporateLight: {
        name: 'Clean Slate',
        icon: '�',
        description: 'Bright professional light theme',
        colors: {
            primary: '#1D4ED8',
            primaryHover: '#2563EB',
            dark: '#F8FAFC',
            darker: '#FFFFFF',
            card: '#FFFFFF',
            border: '#CBD5E1',
            hover: '#F1F5F9',
            text: '#1E293B',
            textMuted: '#64748B',
            success: '#16A34A',
            warning: '#D97706',
            error: '#DC2626',
            info: '#2563EB'
        }
    },
    enterpriseBlue: {
        name: 'Azure Command',
        icon: '�️',
        description: 'Crisp corporate blue with clean lines',
        colors: {
            primary: '#0F6CBD',
            primaryHover: '#2B83D4',
            dark: '#1C2E40',
            darker: '#132233',
            card: '#283D52',
            border: '#3E5873',
            hover: '#324A65',
            text: '#EDF4FB',
            textMuted: '#9FB4CC',
            success: '#2E7D32',
            warning: '#F9A825',
            error: '#D32F2F',
            info: '#1976D2'
        }
    }
};

// Hex to RGB channels for Tailwind opacity modifiers
function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16);
    return ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
}

const THEME_MODES = ['light', 'dark', 'system'];
const LIGHT_NAMED_THEMES = ['corporateLight'];

function resolveMode(mode) {
    if (mode === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        return prefersDark ? 'proxmoxDark' : 'corporateLight';
    }
    if (mode === 'light') return 'corporateLight';
    if (mode === 'dark') return 'proxmoxDark';
    // Named theme already; resolve to itself or default if unknown.
    return ProxmoxVEx_THEMES[mode] ? mode : 'proxmoxDark';
}

function modeFromThemeName(themeName) {
    return LIGHT_NAMED_THEMES.includes(themeName) ? 'light' : 'dark';
}

function buildPluginThemeCss(theme) {
    const colorVars = Object.entries(theme.colors).map(([key, value]) => {
        const rgb = value && value.startsWith('#') ? `--color-${key}-rgb: ${hexToRgb(value)};` : '';
        return `  --color-${key}: ${value};${rgb ? '\n  ' + rgb : ''}`;
    }).join('\n');

    const pluginAliases = `  --bg: var(--color-dark);
  --card: var(--color-card);
  --border: var(--color-border);
  --accent: var(--color-primary);
  --text: var(--color-text);
  --muted: var(--color-textMuted);
  --danger: var(--color-error);
  --error: var(--color-error);
  --success: var(--color-success);
  --warning: var(--color-warning);
  --info: var(--color-info);
  --fg: var(--color-text);
  --surface: var(--color-card);
  --card-hover: var(--color-hover);
  --hover: var(--color-hover);
  --input-bg: var(--color-darker);
  --shadow: var(--shadow-lg);
  --radius: var(--radius-lg);
  --radius-sm: var(--radius-sm);
  --font: var(--font-sans);
  --mono: var(--font-mono);
  --accent-soft: rgba(var(--color-primary-rgb), 0.15);
  --success-soft: rgba(var(--color-success-rgb), 0.12);
  --danger-soft: rgba(var(--color-error-rgb), 0.12);
  --warning-soft: rgba(var(--color-warning-rgb), 0.12);
  --info-soft: rgba(var(--color-info-rgb), 0.12);
  --border-strong: var(--color-border);
  --text-secondary: var(--color-textMuted);
  --ok: var(--color-success);`;

    const dataThemeBlocks = `
[data-theme="proxmoxDark"],
[data-theme="modern-dark"],
[data-theme="corp-dark"],
[data-theme="dark"] {
${pluginAliases}
}

[data-theme="corporateLight"],
[data-theme="proxmoxLight"],
[data-theme="modern-light"],
[data-theme="corp-light"],
[data-theme="light"] {
${pluginAliases}
}`;

    return `:root {\n${colorVars}\n${pluginAliases}\n}${dataThemeBlocks}`;
}

function pluginIframeThemeName(resolvedName) {
    return (LIGHT_NAMED_THEMES.includes(resolvedName) || resolvedName === 'proxmoxLight' || resolvedName === 'corporateLight') ? 'corporateLight' : 'proxmoxDark';
}

function syncPluginIframe(iframe, css, iframeTheme) {
    try {
        const doc = iframe.contentDocument;
        if (doc && doc.documentElement) {
            doc.documentElement.setAttribute('data-theme', iframeTheme);
            let style = doc.getElementById('proxmoxvex-plugin-theme-bridge');
            if (!style) {
                style = doc.createElement('style');
                style.id = 'proxmoxvex-plugin-theme-bridge';
                if (doc.head) doc.head.appendChild(style);
            }
            if (style) style.textContent = css;
        }
        if (iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'theme', theme: iframeTheme }, window.location.origin);
        }
    } catch (_) { /* cross-origin is ok */ }
}

// Apply theme by setting CSS variables
function applyTheme(themeName) {
    const resolvedName = resolveMode(themeName);
    const theme = ProxmoxVEx_THEMES[resolvedName] || ProxmoxVEx_THEMES.proxmoxDark;
    const dataTheme = themeName === 'system' ? 'system' : modeFromThemeName(resolvedName);
    const root = document.documentElement;
    const iframeTheme = pluginIframeThemeName(resolvedName);
    const pluginCss = buildPluginThemeCss(theme);

    Object.entries(theme.colors).forEach(([key, value]) => {
        root.style.setProperty(`--color-${key}`, value);
        // RGB channels for Tailwind opacity modifiers (bg-proxmox-orange/20 etc)
        if (value && value.startsWith('#')) {
            root.style.setProperty(`--color-${key}-rgb`, hexToRgb(value));
        }
    });

    // Expose the semantic data-theme attribute (002-ui-dark-mode)
    root.dataset.theme = dataTheme;

    // Special handling for light theme - only if body exists
    if (document.body) {
        if (LIGHT_NAMED_THEMES.includes(resolvedName)) {
            document.body.classList.add('light-theme');
            document.body.classList.remove('dark-theme');
        } else {
            document.body.classList.add('dark-theme');
            document.body.classList.remove('light-theme');
        }
    }

    localStorage.setItem('ProxmoxVEx-theme', resolvedName);
    localStorage.setItem('ProxmoxVEx-theme-mode', dataTheme);
    if (typeof ProxmoxVExLog !== 'undefined') ProxmoxVExLog.debug(`Theme applied: ${theme.name} (${dataTheme})`);

    // Synchronize theme to plugin iframes via postMessage and a shared CSS bridge.
    try {
        document.querySelectorAll('iframe').forEach((f) => syncPluginIframe(f, pluginCss, iframeTheme));
    } catch (_) { }
}

// Load saved theme on page load - apply CSS vars immediately, body classes after DOM ready
(function () {
    const saved = localStorage.getItem('ProxmoxVEx-theme-mode') || localStorage.getItem('ProxmoxVEx-theme') || 'proxmoxDark';
    if (typeof ProxmoxVExLog !== 'undefined') ProxmoxVExLog.debug('[Theme] Initial load from localStorage:', saved);
    // Apply CSS variables immediately (works on documentElement)
    const resolvedName = resolveMode(saved);
    const theme = ProxmoxVEx_THEMES[resolvedName] || ProxmoxVEx_THEMES.proxmoxDark;
    Object.entries(theme.colors).forEach(([key, value]) => {
        document.documentElement.style.setProperty(`--color-${key}`, value);
        if (value && value.startsWith('#')) {
            document.documentElement.style.setProperty(`--color-${key}-rgb`, hexToRgb(value));
        }
    });
    // Set the data-theme attribute as early as possible to avoid flash
    document.documentElement.dataset.theme = modeFromThemeName(resolvedName);
    // Apply body classes after DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => applyTheme(saved));
    } else {
        applyTheme(saved);
    }
})();

// ============================================
// TAILWIND CONFIG
// ============================================
// Custom Proxmox-inspired color palette
// Now uses CSS variables for dynamic theming
if (typeof tailwind !== 'undefined') {
    tailwind.config = {
        darkMode: 'class',
        theme: {
            extend: {
                fontFamily: {
                    sans: ['Plus Jakarta Sans', 'sans-serif'],
                    mono: ['JetBrains Mono', 'monospace'],
                },
                colors: {
                    proxmox: {
                        // These now reference CSS variables for theme support
                        orange: 'var(--color-primary, #E57000)',
                        dark: 'var(--color-dark, #0F1419)',
                        darker: 'var(--color-darker, #080B0E)',
                        card: 'var(--color-card, #161B22)',
                        border: 'var(--color-border, #30363D)',
                        hover: 'var(--color-hover, #1C2128)',
                        text: 'var(--color-text, #E6EDF3)',
                        textMuted: 'var(--color-textMuted, #9CA3AF)',
                    },
                    // Semantic colors
                    theme: {
                        primary: 'var(--color-primary, #E57000)',
                        success: 'var(--color-success, #3FB950)',
                        warning: 'var(--color-warning, #D29922)',
                        error: 'var(--color-error, #F85149)',
                        info: 'var(--color-info, #58A6FF)',
                    }
                },
                animation: {
                    'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                    'gradient': 'gradient 8s ease infinite',
                    'slide-up': 'slideUp 0.5s ease-out',
                    'slide-in': 'slideIn 0.3s ease-out',
                    'fade-in': 'fadeIn 0.4s ease-out',
                    'scale-in': 'scaleIn 0.3s ease-out',
                    'glow': 'glow 2s ease-in-out infinite alternate',
                },
                keyframes: {
                    gradient: {
                        '0%, 100%': { backgroundPosition: '0% 50%' },
                        '50%': { backgroundPosition: '100% 50%' },
                    },
                    slideUp: {
                        '0%': { opacity: '0', transform: 'translateY(20px)' },
                        '100%': { opacity: '1', transform: 'translateY(0)' },
                    },
                    slideIn: {
                        '0%': { opacity: '0', transform: 'translateX(-10px)' },
                        '100%': { opacity: '1', transform: 'translateX(0)' },
                    },
                    fadeIn: {
                        '0%': { opacity: '0' },
                        '100%': { opacity: '1' },
                    },
                    scaleIn: {
                        '0%': { opacity: '0', transform: 'scale(0.95)' },
                        '100%': { opacity: '1', transform: 'scale(1)' },
                    },
                    glow: {
                        '0%': { boxShadow: '0 0 20px var(--color-primary, rgba(229, 112, 0, 0.3))' },
                        '100%': { boxShadow: '0 0 40px var(--color-primary, rgba(229, 112, 0, 0.6))' },
                    },
                }
            }
        }
    };
} // end if (typeof tailwind !== 'undefined')

// Expose helpers so the main React app can synchronise late-loading plugin iframes.
window.ProxmoxVExSyncPluginIframe = function (iframe) {
    const saved = localStorage.getItem('ProxmoxVEx-theme') || localStorage.getItem('ProxmoxVEx-theme-mode') || 'proxmoxDark';
    const resolvedName = resolveMode(saved);
    const theme = ProxmoxVEx_THEMES[resolvedName] || ProxmoxVEx_THEMES.proxmoxDark;
    const iframeTheme = pluginIframeThemeName(resolvedName);
    const css = buildPluginThemeCss(theme);
    syncPluginIframe(iframe, css, iframeTheme);
};
window.ProxmoxVExGetActiveTheme = function () {
    return localStorage.getItem('ProxmoxVEx-theme') || 'proxmoxDark';
};
