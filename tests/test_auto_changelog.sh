#!/bin/bash
# Spec 093/US052: auto-generated changelog — conventional commits between
# tags become structured changelog entries (matching version.json's
# object shape from US026): feat→feature, fix→fix, BREAKING→breaking.
set -u
cd "$(dirname "$0")/.." || exit

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL - $1"; }
check(){ if ( eval "$2" ) >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi }

echo "US052 auto-changelog tests"

check "generator exists"                "[ -f scripts/gen-changelog.py ]"
check "conventional prefixes parsed"    "grep -q 'feat\|fix' scripts/gen-changelog.py"
check "breaking detected"               "grep -qi 'breaking' scripts/gen-changelog.py"
check "structured entries emitted"      "grep -q 'type' scripts/gen-changelog.py"
check "wired into build-release"        "grep -q 'gen-changelog' scripts/build-release.sh"
check "wired into release pipeline"     "grep -q 'gen-changelog\|CHANGELOG' .github/workflows/release.yml"

# --- functional: synthetic git history → structured entries ------------------------------
SCRATCH=$(mktemp -d)
cd "$SCRATCH" && git init -q && git config user.email t@t && git config user.name t
git commit -qm "chore: init" --allow-empty && git tag v1.0.0
git commit -qm "feat(api): add delta endpoint" --allow-empty
git commit -qm "fix(updater): resume off-by-one" --allow-empty
git commit -qm "feat!: drop legacy config format" --allow-empty
git commit -qm "docs: tweak readme" --allow-empty
cd - >/dev/null || exit

python3 scripts/gen-changelog.py --repo "$SCRATCH" --from v1.0.0 --to HEAD \
    --version 9.9.9 --out "$SCRATCH/cl.json" >/dev/null 2>&1
[ $? -eq 0 ] && ok "generator runs on git range" || bad "generator runs on git range"
[ -f "$SCRATCH/cl.json" ] && ok "changelog emitted" || bad "changelog emitted"
python3 -c "
import json; d=json.load(open('$SCRATCH/cl.json'))
e={x['text']:x for x in d['changelog']}
assert any('delta endpoint' in t for t in e), e
assert any('resume off-by-one' in t for t in e), e
assert any(x['type']=='feature' for x in e.values())
assert any(x['type']=='fix' for x in e.values())
" && ok "feat/fix mapped to structured types" || bad "feat/fix mapped to structured types"
python3 -c "
import json; d=json.load(open('$SCRATCH/cl.json'))
assert any(x['breaking'] for x in d['changelog']), d
" && ok "feat! marked breaking" || bad "feat! marked breaking"
python3 -c "
import json; d=json.load(open('$SCRATCH/cl.json'))
assert not any('tweak readme' in x['text'] for x in d['changelog']), d
" && ok "docs/chore commits excluded" || bad "docs/chore commits excluded"
python3 -c "
import json; d=json.load(open('$SCRATCH/cl.json'))
assert any(x.get('component')=='api' for x in d['changelog']), d
" && ok "scope captured as component" || bad "scope captured as component"

rm -rf "$SCRATCH"

echo ""
echo "result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
