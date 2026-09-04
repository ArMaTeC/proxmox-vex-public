#!/bin/bash
# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        web/Dev/build.sh
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Build SH source
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
set -e

# Locate the script and switch to the project root so all paths are stable
# regardless of where build.sh is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

# =============================================================================
# Overview
# =============================================================================
# This is the frontend build script for ProxmoxVEx. It assembles the JSX/JS
# modules in web/src/ into web/app.bundle.js and web/index.html. It supports
# three modes:
#
#   default              Single monolithic bundle (best for simple installs).
#   ./build.sh --split   Two bundles: a lazy bundle for heavy features
#                        (VNC console, world map) plus a core bundle.
#   ./build.sh --restore Dev mode: copies shell JS/CSS, concatenates JSX, and
#                        writes web/index.html so the browser runs Babel
#                        itself. No Node.js is required for this mode.
#
# New core JS modules must be appended to the CORE_FILES array below or they
# will not be included in app.bundle.js.
# =============================================================================

# Build tag from git commit
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_TAG="ProxmoxVEx build $GIT_COMMIT"

# Terminal output colors.
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          ProxmoxVEx Build Script - JSX Pre-Compiler          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Source files in dependency order
# Modules that can be loaded after the main app shell (VNC console + map are
# heavy and not needed for the initial dashboard paint). Used with --split.
LAZY_FILES=(
    vnc_secure_socket.js
)

# Core modules loaded immediately on dashboard render. Any new module that is
# part of the first paint must be added to this array.
# NOTE: translations.js has been replaced by the namespace-aware i18n system.
# The build now inlines JSON locale files + i18n.js + i18n_bridge.js instead.
CORE_FILES=(
    constants.js
    i18n_bridge.js
    contexts.js
    auth.js
    icons.js
    ui.js
    datacenter.js
    nodes.js
    security.js
    server_access.js
    storage.js
    networking.js
    clusters.js
    tables.js
    vm_modals.js
    vm_config.js
    node_modals.js
    create_modals.js
    native_integrations.js
    plugin_config_form.js
    plugin_console.js
    settings_modal.js
    converter_modal.js
    search.js
    routes.jsx
    pages/Settings/Licence.jsx
    pages/vms.js
    pages/lxc.js
    worldmap.js  # in core bundle because dashboard.js renders WorldMapView directly
    dashboard.js
)

# Default is split (lazy + core). --monolithic produces a single bundle.
SPLIT_MODE=1
SRC_FILES=("${LAZY_FILES[@]}" "${CORE_FILES[@]}")
if [[ "$1" == "--monolithic" ]]; then
    SPLIT_MODE=0
    shift
fi

# Verify all configured source files exist before doing any work.
for f in "${SRC_FILES[@]}"; do
    if [ ! -f "web/src/$f" ]; then
        echo -e "${RED}✗ Missing source file: web/src/$f${NC}"
        exit 1
    fi
done
echo -e "${GREEN}✓ All ${#SRC_FILES[@]} source files found${NC}"

# The build needs the original HTML shell as a starting point.
if [ ! -f "web/index.html.original" ]; then
    echo -e "${RED}✗ web/index.html.original not found!${NC}"
    exit 1
fi

# Verify shell has the insert marker
if ! grep -q "ProxmoxVEx_JSX_INSERT" web/index.html.original; then
    echo -e "${RED}✗ web/index.html.original missing ProxmoxVEx_JSX_INSERT marker!${NC}"
    echo "  The HTML shell needs the <!-- ProxmoxVEx_JSX_INSERT --> comment."
    exit 1
fi
echo -e "${GREEN}✓ HTML shell with JSX insert marker${NC}"

# --restore flag: dev mode with in-browser Babel compilation
if [ "$1" == "--restore" ]; then
    echo ""
    echo -e "${YELLOW}Building dev version (Babel compiles in browser)...${NC}"

    # Copy auxiliary shell JS/CSS to served locations
    echo -e "${BLUE}→ Copying auxiliary shell assets...${NC}"
    mkdir -p "static/js"
    for f in pwa.js a11y.js logging.js lib-loader.js novnc-loader.js font-loader.js tailwind-config.js noise.js; do
        cp "web/src/$f" "static/js/$f"
    done
    cp web/src/app-shell.css web/app.bundle.css
    echo -e "  Copied shell JS to static/js/ and app-shell.css to web/app.bundle.css"

    # Generate i18n preamble for dev mode
    echo -e "${BLUE}→ Generating i18n preamble...${NC}"
    I18N_PREAMBLE_CONTENT="$(cat "web/i18n/i18n.js")"
    I18N_PREAMBLE_CONTENT+=$'\n'
    for lang_file in web/i18n/locales/core/*.json; do
        lang_code=$(basename "$lang_file" .json)
        # JS identifiers cannot contain hyphens; normalise to underscores.
        lang_var=${lang_code//-/_}
        I18N_PREAMBLE_CONTENT+="window._i18n_core_${lang_var} = $(cat "$lang_file");"
        I18N_PREAMBLE_CONTENT+=$'\n'
    done

    # Generate plugin directory for dev mode
    echo -e "${BLUE}→ Generating plugin directory...${NC}"
    python3 "scripts/generate_plugin_directory.py"
    PLUGIN_PREAMBLE_CONTENT="window.__PROXMOXVEX_PLUGIN_DIRECTORY__ = $(cat "plugins/directory.json");"
    PLUGIN_PREAMBLE_CONTENT+=$'\n'

    # Concatenate source files (i18n + plugin preambles first)
    JSX_CONTENT="$I18N_PREAMBLE_CONTENT"
    JSX_CONTENT+=$'\n'
    JSX_CONTENT+="$PLUGIN_PREAMBLE_CONTENT"
    JSX_CONTENT+=$'\n'
    for f in "${SRC_FILES[@]}"; do
        JSX_CONTENT+="$(cat "web/src/$f")"
        JSX_CONTENT+=$'\n'
    done

    # Build HTML: shell + <script type="text/babel"> + jsx + </script></body></html>
    # Replace everything from the marker line onwards
    python3 -c "
import sys
with open('web/index.html.original', 'r') as f:
    shell = f.read()

# Read concatenated JSX from stdin
jsx = sys.stdin.read()

# Find the marker and replace from there
marker = '    <!-- ProxmoxVEx_JSX_INSERT -->'
idx = shell.find(marker)
if idx == -1:
    print('ERROR: ProxmoxVEx_JSX_INSERT marker not found', file=sys.stderr)
    sys.exit(1)

html_before = shell[:idx]
new_html = html_before + '<script type=\"text/babel\">\n' + jsx + '\n    </script>\n\n</body>\n</html>\n'

with open('web/index.html', 'w') as f:
    f.write(new_html)

print(f'  Dev build: {len(new_html):,} bytes')
" <<< "$JSX_CONTENT"

    echo -e "${GREEN}✓ Dev build complete (web/index.html)${NC}"
    echo "  Babel will compile JSX in the browser (slower but good for development)"
    echo "  Run ./build.sh again (without --restore) to create production build"
    exit 0
fi

# Production builds require Node.js for Babel. Bail with install instructions if
# it is missing or too old.
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js not found!${NC}"
    echo ""
    echo "We need Node.js to run Babel. Install it:"
    echo "  Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
    echo "  Or visit: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo -e "${RED}✗ Node.js 16+ required (you have v$NODE_VERSION)${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm not found! Should come with Node.js...${NC}"
    exit 1
fi
echo -e "${GREEN}✓ npm $(npm -v)${NC}"

# Hidden build directory where Babel and intermediate files live. It is
# gitignored so builds do not dirty the working tree.
BUILD_DIR="$SCRIPT_DIR/.build"
mkdir -p "$BUILD_DIR"

# Install Babel if this is the first run
if [ ! -d "$BUILD_DIR/node_modules/@babel/core" ]; then
    echo ""
    echo -e "${YELLOW}First run - installing Babel (one-time setup)...${NC}"
    cd "$BUILD_DIR"

    cat > package.json << 'EOF'
{
  "name": "ProxmoxVEx-build",
  "private": true,
  "devDependencies": {
    "@babel/core": "^7.23.0",
    "@babel/cli": "^7.23.0",
    "@babel/preset-react": "^7.23.0"
  }
}
EOF

    npm install --silent
    cd "$PROJECT_ROOT"
    echo -e "${GREEN}✓ Babel installed${NC}"
fi

echo ""
echo -e "${YELLOW}Building production version...${NC}"

# Step 0: Generate i18n preamble (inline locale JSON as JS variables + i18n engine)
echo -e "${BLUE}→ Generating i18n preamble from locale JSON files...${NC}"
I18N_PREAMBLE="$BUILD_DIR/i18n_preamble.js"
cat /dev/null > "$I18N_PREAMBLE"

# Inline the i18n engine first
cat "web/i18n/i18n.js" >> "$I18N_PREAMBLE"
echo "" >> "$I18N_PREAMBLE"

# Inline core locale JSON files as JS variables: var _i18n_core_XX = {...};
I18N_LANG_COUNT=0
for lang_file in web/i18n/locales/core/*.json; do
    lang_code=$(basename "$lang_file" .json)
    # JS identifiers cannot contain hyphens; normalise to underscores.
    lang_var=${lang_code//-/_}
    echo "window._i18n_core_${lang_var} = $(cat "$lang_file");" >> "$I18N_PREAMBLE"
    echo "" >> "$I18N_PREAMBLE"
    I18N_LANG_COUNT=$((I18N_LANG_COUNT + 1))
done
echo "  Inlined ${I18N_LANG_COUNT} core locale files + i18n engine"

# Step 0a: Generate plugin directory from plugin manifests and inline it.
# This is the source-of-truth catalog used by the licence server and the UI.
echo -e "${BLUE}→ Generating plugin directory...${NC}"
python3 "scripts/generate_plugin_directory.py"
PLUGIN_PREAMBLE="$BUILD_DIR/plugin_preamble.js"
cat /dev/null > "$PLUGIN_PREAMBLE"
echo "window.__PROXMOXVEX_PLUGIN_DIRECTORY__ = $(cat "plugins/directory.json");" >> "$PLUGIN_PREAMBLE"
echo "" >> "$PLUGIN_PREAMBLE"
echo "  Inlined plugin directory"

# Step 1: Concatenate source files
echo -e "${BLUE}→ Concatenating source files...${NC}"

if [ "$SPLIT_MODE" -eq 1 ]; then
    # Start with i18n + plugin directory preambles
    cat "$I18N_PREAMBLE" > "$BUILD_DIR/app.jsx"
    cat "$PLUGIN_PREAMBLE" >> "$BUILD_DIR/app.jsx"
    echo "" >> "$BUILD_DIR/app.jsx"
    for f in "${CORE_FILES[@]}"; do
        cat "web/src/$f" >> "$BUILD_DIR/app.jsx"
        echo "" >> "$BUILD_DIR/app.jsx"
    done

    cat /dev/null > "$BUILD_DIR/lazy.jsx"
    for f in "${LAZY_FILES[@]}"; do
        cat "web/src/$f" >> "$BUILD_DIR/lazy.jsx"
        echo "" >> "$BUILD_DIR/lazy.jsx"
    done
    echo "  Core: ${#CORE_FILES[@]} files + i18n preamble, Lazy: ${#LAZY_FILES[@]} files"
else
    # Start with i18n + plugin directory preambles
    cat "$I18N_PREAMBLE" > "$BUILD_DIR/app.jsx"
    cat "$PLUGIN_PREAMBLE" >> "$BUILD_DIR/app.jsx"
    echo "" >> "$BUILD_DIR/app.jsx"
    for f in "${SRC_FILES[@]}"; do
        cat "web/src/$f" >> "$BUILD_DIR/app.jsx"
        echo "" >> "$BUILD_DIR/app.jsx"
    done
    echo "  Concatenated: ${#SRC_FILES[@]} files + i18n preamble"
fi

if [ "$SPLIT_MODE" -eq 1 ]; then
    CORE_SIZE=$(wc -c < "$BUILD_DIR/app.jsx")
    LAZY_SIZE=$(wc -c < "$BUILD_DIR/lazy.jsx")
    echo "  Core JSX: ${CORE_SIZE} bytes, Lazy JSX: ${LAZY_SIZE} bytes"
else
    JSX_SIZE=$(wc -c < "$BUILD_DIR/app.jsx")
    JSX_LINES=$(wc -l < "$BUILD_DIR/app.jsx")
    echo "  Concatenated: ${JSX_LINES} lines, ${JSX_SIZE} bytes"
fi

# Step 2: Compile JSX with Babel
echo -e "${BLUE}→ Compiling JSX with Babel...${NC}"

BABEL_CMD="$BUILD_DIR/node_modules/.bin/babel"
# Run from .build/ dir so Babel finds node_modules/@babel/preset-react
(cd "$BUILD_DIR" && "$BABEL_CMD" app.jsx -o app.js --presets=@babel/preset-react --source-maps --compact true)
if [ "$SPLIT_MODE" -eq 1 ]; then
    (cd "$BUILD_DIR" && "$BABEL_CMD" lazy.jsx -o lazy.js --presets=@babel/preset-react --source-maps --compact true)
    JS_SIZE=$(wc -c < "$BUILD_DIR/app.js")
    LAZY_JS_SIZE=$(wc -c < "$BUILD_DIR/lazy.js")
    echo "  Core JS: ${JS_SIZE} bytes, Lazy JS: ${LAZY_JS_SIZE} bytes"
else
    JS_SIZE=$(wc -c < "$BUILD_DIR/app.js")
    echo "  Compiled JS: ${JS_SIZE} bytes"
fi

# Step 3: Build final HTML
echo -e "${BLUE}→ Assembling final HTML...${NC}"

# Pass build state to the Python assembly script via the environment.
export ProxmoxVEx_BUILD_DIR="$BUILD_DIR"
export ProxmoxVEx_PROJECT_ROOT="$PROJECT_ROOT"
export ProxmoxVEx_SPLIT_MODE="$SPLIT_MODE"
export ProxmoxVEx_GIT_COMMIT="$GIT_COMMIT"

# The Python block takes the compiled JS and inserts the correct <script> tags
# into web/index.html. It also copies auxiliary shell JS/CSS and rewrites
# lib-loader.js to skip the in-browser Babel loader in production.
python3 << 'PYTHON_SCRIPT'
import os
import shutil
import time

build_dir = os.environ["ProxmoxVEx_BUILD_DIR"]
project_root = os.environ["ProxmoxVEx_PROJECT_ROOT"]
web_dir = os.path.join(project_root, 'web')
split_mode = os.environ.get('ProxmoxVEx_SPLIT_MODE', '0') == '1'

# Read HTML shell
with open(os.path.join(web_dir, 'index.html.original'), 'r', encoding='utf-8') as f:
    shell = f.read()

# Read compiled JS
with open(os.path.join(build_dir, 'app.js'), 'r', encoding='utf-8') as f:
    compiled_js = f.read()

# Find insert marker
marker = '    <!-- ProxmoxVEx_JSX_INSERT -->'
idx = shell.find(marker)
if idx == -1:
    print("ERROR: ProxmoxVEx_JSX_INSERT marker not found!")
    exit(1)

html_before = shell[:idx]

# Wrap compiled JS in waitForReact IIFE so it only runs once React is loaded.
wrapper_start = '''(function waitForReact() {
    if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
        setTimeout(waitForReact, 10);
        return;
    }
    // React is ready, run the app
'''
wrapper_end = '''
})();'''

git_commit = os.environ.get("ProxmoxVEx_GIT_COMMIT", "unknown")
build_id = str(int(time.time() * 1000))
build_tag = f"ProxmoxVEx build {git_commit}"

# Cache-bust the app shell CSS so the browser reloads it after each build.
html_before = html_before.replace('href="/app.bundle.css"', f'href="/app.bundle.css?v={build_id}"')
html_before = html_before.replace("href='/app.bundle.css'", f'href="/app.bundle.css?v={build_id}"')

def _strip_inline_map(js):
    lines = js.splitlines()
    if lines and lines[-1].startswith("//# sourceMappingURL="):
        lines = lines[:-1]
    return "\n".join(lines)

if split_mode:
    with open(os.path.join(build_dir, 'lazy.js'), 'r', encoding='utf-8') as f:
        lazy_js = f.read()

    core_body = _strip_inline_map(compiled_js)
    with open(os.path.join(web_dir, 'app.bundle.js'), 'w', encoding='utf-8') as f:
        f.write(f"/* {build_tag} */\n")
        f.write(wrapper_start + core_body + wrapper_end)
        f.write("\n//# sourceMappingURL=app.bundle.js.map\n")
    shutil.copyfile(os.path.join(build_dir, 'app.js.map'), os.path.join(web_dir, 'app.bundle.js.map'))

    lazy_body = _strip_inline_map(lazy_js)
    with open(os.path.join(web_dir, 'lazy.bundle.js'), 'w', encoding='utf-8') as f:
        f.write(f"/* {build_tag} */\n")
        f.write("(function(){" + lazy_body + "})();")
        f.write("\n//# sourceMappingURL=lazy.bundle.js.map\n")
    shutil.copyfile(os.path.join(build_dir, 'lazy.js.map'), os.path.join(web_dir, 'lazy.bundle.js.map'))

    new_html = html_before + f'<script src="lazy.bundle.js?v={build_id}" defer></script>\n    <script src="app.bundle.js?v={build_id}" defer></script>\n\n</body>\n</html>\n'
else:
    core_body = _strip_inline_map(compiled_js)
    with open(os.path.join(web_dir, 'app.bundle.js'), 'w', encoding='utf-8') as f:
        f.write(f"/* {build_tag} */\n")
        f.write(wrapper_start + core_body + wrapper_end)
        f.write("\n//# sourceMappingURL=app.bundle.js.map\n")
    shutil.copyfile(os.path.join(build_dir, 'app.js.map'), os.path.join(web_dir, 'app.bundle.js.map'))

    new_html = html_before + f'<script src="app.bundle.js?v={build_id}" defer></script>\n\n</body>\n</html>\n'

# Write output
output_file = os.path.join(web_dir, 'index.html')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(new_html)

# Copy auxiliary shell JS and CSS to served locations (prod: Babel stripped)
print("  Copying auxiliary shell assets...")
static_js_dir = os.path.join(project_root, 'static', 'js')
os.makedirs(static_js_dir, exist_ok=True)

for f in ['pwa.js', 'a11y.js', 'logging.js', 'novnc-loader.js', 'font-loader.js', 'tailwind-config.js', 'noise.js']:
    shutil.copyfile(os.path.join(web_dir, 'src', f), os.path.join(static_js_dir, f))

# Process lib-loader.js: strip Babel load step and transform call for production
with open(os.path.join(web_dir, 'src', 'lib-loader.js'), 'r', encoding='utf-8') as f:
    lib_loader = f.read()

babel_load_step = '''        }).then(function() {
            return loadScriptWithFallback(
                'https://cdn.jsdelivr.net/npm/@babel/standalone@7.29.2/babel.min.js',
                '/static/js/babel.min.js',
                'babel@7.29.2'
            );
'''
if babel_load_step in lib_loader:
    lib_loader = lib_loader.replace(babel_load_step, '')
    print('  Stripped @babel/standalone loader from lib-loader.js')

for variation in [
    "if (window.Babel) {\n                Babel.transformScriptTags();\n            }",
    "if (window.Babel) {\r\n                Babel.transformScriptTags();\r\n            }",
    "if (window.Babel) { Babel.transformScriptTags(); }",
]:
    if variation in lib_loader:
        lib_loader = lib_loader.replace(variation, "// Babel loaded but skipped - JSX pre-compiled by build.sh")
        print('  Disabled Babel.transformScriptTags() in lib-loader.js')
        break

with open(os.path.join(static_js_dir, 'lib-loader.js'), 'w', encoding='utf-8') as f:
    f.write(lib_loader)

# Copy app shell CSS to bundle and append shared UI state styles if present
shutil.copyfile(os.path.join(web_dir, 'src', 'app-shell.css'), os.path.join(web_dir, 'app.bundle.css'))
ui_states_src = os.path.join(web_dir, 'src', 'ui-states.css')
if os.path.exists(ui_states_src):
    with open(os.path.join(web_dir, 'app.bundle.css'), 'a', encoding='utf-8') as out:
        out.write('\n')
        with open(ui_states_src, 'r', encoding='utf-8') as f:
            out.write(f.read())
    print('  Copied app-shell.css + ui-states.css -> web/app.bundle.css')
else:
    print('  Copied app-shell.css -> web/app.bundle.css')

print(f"  Shell:    {len(shell):,} bytes")
if split_mode:
    print(f"  Core JS:  {len(compiled_js):,} bytes")
    print(f"  Lazy JS:  {len(lazy_js):,} bytes")
    print(f"  Output:   {len(new_html):,} bytes")
else:
    print(f"  JS:       {len(compiled_js):,} bytes")
    print(f"  Bundle:   {len(core_body):,} bytes -> web/app.bundle.js")
    print(f"  Output:   {len(new_html):,} bytes")

PYTHON_SCRIPT

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Build failed!${NC}"
    exit 1
fi

# Warn if a running Docker container is serving stale plugin code.
# The container image is built from these same files, but a long-running
# container will not pick up edits until it is rebuilt or the files are synced.
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'ProxmoxVEx'; then
    echo ""
    echo -e "${BLUE}→ Checking plugin code sync with running container...${NC}"
    bash "$PROJECT_ROOT/scripts/check-and-sync-plugin-code.sh" --check
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    Build Complete! ✓                       ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
if [ "$SPLIT_MODE" -eq 1 ]; then
    echo -e "  ${BLUE}Source:${NC}  web/src/ (core: ${#CORE_FILES[@]}, lazy: ${#LAZY_FILES[@]})"
    echo -e "  ${BLUE}Output:${NC}  web/index.html, web/app.bundle.js, web/lazy.bundle.js"
    echo ""
    echo -e "  Default build: ${YELLOW}./build.sh${NC}"
    echo -e "  Dev mode:      ${YELLOW}./build.sh --restore${NC}"
else
    echo -e "  ${BLUE}Source:${NC}  web/src/ (${#SRC_FILES[@]} files)"
    echo -e "  ${BLUE}Output:${NC}  web/index.html, web/app.bundle.js, web/app.bundle.css, web/app.bundle.js.map, static/js/*.js"
    echo ""
    echo -e "  For split build: ${YELLOW}./build.sh --split${NC}"
    echo -e "  For development: ${YELLOW}./build.sh --restore${NC}"
    echo -e "  After changes:   ${YELLOW}./build.sh${NC}"
fi
echo ""
