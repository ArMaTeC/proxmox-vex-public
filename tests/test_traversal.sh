#!/bin/bash
# Roadmap ID-0181: deploy/server.py static serving must be confined to
# the docroot — .., encoded traversal, absolute paths, dot-files, .py
# sources, and symlink escapes can never read outside ROOT.
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "ID-0181 traversal confinement tests"

SCRATCH="$(mktemp -d)"
trap 'kill $SRV 2>/dev/null; rm -rf "$SCRATCH"' EXIT

# scratch docroot: index + a file + a symlink escaping root + outside file
mkdir -p "$SCRATCH/root/docs" "$SCRATCH/outside"
echo "<h1>hi</h1>" > "$SCRATCH/root/index.html"
echo "SECRET-OUTSIDE-7c2d" > "$SCRATCH/outside/secret.txt"
echo "docpage" > "$SCRATCH/root/docs/index.html"
ln -s "$SCRATCH/outside/secret.txt" "$SCRATCH/root/leak.txt"
ln -s "$SCRATCH/outside" "$SCRATCH/root/leakdir"
mkdir -p "$SCRATCH/root/leakidx"; ln -s "$SCRATCH/outside/secret.txt" \
    "$SCRATCH/root/leakidx/index.html"
echo "print('py')" > "$SCRATCH/root/app.py"
mkdir -p "$SCRATCH/root/.git"; echo "gitsecret" > "$SCRATCH/root/.git/cfg"

PORT=18199
SERVER_PY="$(pwd)/deploy/server.py"
(cd "$SCRATCH/root" && PORT=$PORT HOST=127.0.0.1 \
    python3 "$SERVER_PY") &
SRV=$!
for _ in $(seq 1 40); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/" \
    && break; sleep 0.25; done

code() { curl -s -o /dev/null -w '%{http_code}' \
    --path-as-is "http://127.0.0.1:$PORT$1"; }
body() { curl -s --path-as-is "http://127.0.0.1:$PORT$1"; }

check "index serves"            "[ \"\$(code /)\" = 200 ]"
check "docs page serves"        "[ \"\$(code /docs/)\" = 200 ]"
check ".. traversal 404"        "[ \"\$(code /../outside/secret.txt)\" = 404 ]"
check ".. traversal no leak"    "! body /../outside/secret.txt | grep -q SECRET-OUTSIDE"
check "encoded .. 404"          "[ \"\$(code /%2e%2e/outside/secret.txt)\" = 404 ]"
check "encoded .. no leak"      "! body /%2e%2e/%2e%2e/outside/secret.txt | grep -q SECRET-OUTSIDE"
check "abs path 404"            "[ \"\$(code //etc/passwd)\" = 404 ]"
check "abs path no leak"        "! body //etc/passwd | grep -q 'root:'"
check "file symlink-out 404"    "[ \"\$(code /leak.txt)\" = 404 ]"
check "dir symlink-out 404"     "[ \"\$(code /leakdir/secret.txt)\" = 404 ]"
check "index symlink-out 404"   "[ \"\$(code /leakidx/)\" = 404 ]"
check "dot dir 404"             "[ \"\$(code /.git/cfg)\" = 404 ]"
check ".py source 404"          "[ \"\$(code /app.py)\" = 404 ]"
check "nested .. mid-path 404"  "[ \"\$(code /docs/../outside/secret.txt)\" = 404 ]"
check "missing file 404"        "[ \"\$(code /nope.txt)\" = 404 ]"
check "dir without index 404"   "mkdir -p $SCRATCH/root/noindex && [ \"\$(code /noindex/)\" = 404 ]"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
