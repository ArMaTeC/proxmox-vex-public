#!/usr/bin/env bats
# spec 093/US086: unit tests for update.sh helper functions.
#
# update.sh is a top-level script (no --source-only mode), so setup()
# extracts every `name() { ... }` definition with the same awk pattern the
# repo's shell tests use, prepends the globals the functions reference,
# and sources the result — pure functions, no script body.

setup() {
    UPD="$BATS_TEST_DIRNAME/../update.sh"
    FUNCS="$BATS_TMPDIR/update-functions.sh"
    awk '
        /^[a-z_][a-z0-9_]*\(\)[[:space:]]*\{/ {
            inf=1; print
            if ($0 ~ /\}[[:space:]]*$/) inf=0   # one-line definition
            next
        }
        inf { print; if ($0 ~ /^\}/) inf=0 }
    ' "$UPD" > "$FUNCS"
    [ -s "$FUNCS" ] || { echo "function extraction empty" >&2; return 1; }
    {
        echo 'RED= GREEN= YELLOW= BLUE= NC='
        echo 'SCRIPT_DIR="$(pwd)"'
        echo 'INSECURE=0; BUNDLE_MODE=0; VEX_MIRROR=""; UPDATE_WINDOW=""; VEX_UPDATE_WINDOW=""'
        cat "$FUNCS"
    } > "$FUNCS.env"
    # shellcheck disable=SC1090
    . "$FUNCS.env"
    BASE_DIR="$(mktemp -d)"
    export BASE_DIR
}

teardown() { rm -rf "$BASE_DIR" "$FUNCS" "$FUNCS.env" 2>/dev/null || true; }

@test "version_ge: basic ordering" {
    run version_ge 1.2.472 1.2.400; [ "$status" -eq 0 ]
    run version_ge 1.2.472 1.3.0;   [ "$status" -eq 1 ]
}

@test "version_ge: equal and zero-padded" {
    run version_ge 1.2.472 1.2.472; [ "$status" -eq 0 ]
    run version_ge 1.2 1.2.0;       [ "$status" -eq 0 ]
    run version_ge 1.10.0 1.9.9;    [ "$status" -eq 0 ]
}

@test "in_window: no window configured passes" {
    run in_window; [ "$status" -eq 0 ]
}

@test "in_window: inside configured window" {
    UPDATE_WINDOW="00:00-23:59" NOW_OVERRIDE="12:00" run in_window
    [ "$status" -eq 0 ]
}

@test "in_window: outside configured window" {
    UPDATE_WINDOW="02:00-04:00" NOW_OVERRIDE="12:00" run in_window
    [ "$status" -eq 1 ]
}

@test "in_window: overnight window wraps midnight" {
    UPDATE_WINDOW="22:00-06:00" NOW_OVERRIDE="23:30" run in_window
    [ "$status" -eq 0 ]
    UPDATE_WINDOW="22:00-06:00" NOW_OVERRIDE="03:00" run in_window
    [ "$status" -eq 0 ]
    UPDATE_WINDOW="22:00-06:00" NOW_OVERRIDE="12:00" run in_window
    [ "$status" -eq 1 ]
}

@test "assert_update_scheme: https and file accepted" {
    run assert_update_scheme https://example.com/dl
    [ "$status" -eq 0 ]
    run assert_update_scheme file:///srv/mirror
    [ "$status" -eq 0 ]
}

@test "assert_update_scheme: http rejected" {
    run assert_update_scheme http://example.com/dl
    [ "$status" -ne 0 ]
}

@test "pick_archive_ext: prefers zst when zstd exists" {
    mkdir -p "$BASE_DIR/bin"
    printf '#!/bin/sh\nexit 0\n' > "$BASE_DIR/bin/zstd"
    chmod +x "$BASE_DIR/bin/zstd"
    run env PATH="$BASE_DIR/bin:/usr/bin:/bin" bash -c '. "$0"; pick_archive_ext' "$FUNCS.env"
    [ "$status" -eq 0 ] && [ "$output" = ".tar.zst" ]
}

@test "pick_archive_ext: falls back to tar.gz without zstd" {
    # minimal PATH with no zstd in it at all
    mkdir -p "$BASE_DIR/nozstd-bin"
    for t in bash sh env command; do
        src="$(command -v "$t" 2>/dev/null)" && [ -n "$src" ] \
            && ln -sf "$src" "$BASE_DIR/nozstd-bin/$t"
    done
    command -v zstd >/dev/null && ln -sf "$(command -v bash)" "$BASE_DIR/nozstd-bin/bash"
    run env PATH="$BASE_DIR/nozstd-bin" bash -c '. "$0"; pick_archive_ext' "$FUNCS.env"
    [ "$status" -eq 0 ] && [ "$output" = ".tar.gz" ]
}

@test "canonical_json: sorted compact output" {
    printf '{"b":1,"a":{"d":2,"c":3}}' > "$BASE_DIR/in.json"
    run canonical_json "$BASE_DIR/in.json" "$BASE_DIR/out.json"
    [ "$status" -eq 0 ]
    [ "$(cat "$BASE_DIR/out.json")" = '{"a":{"c":3,"d":2},"b":1}' ]
}

@test "declared_size: reads releases size_bytes" {
    cat > "$BASE_DIR/v.json" <<'EOF'
{"releases":{"1.2.472":{"size_bytes":18413275}},"channels":{}}
EOF
    run declared_size "$BASE_DIR/v.json" 1.2.472
    [ "$status" -eq 0 ] && [ "$output" = "18413275" ]
}

@test "declared_size: falls back to channel entry" {
    cat > "$BASE_DIR/v.json" <<'EOF'
{"releases":{},"channels":{"stable":{"version":"1.2.472","size_bytes":99}}}
EOF
    run declared_size "$BASE_DIR/v.json" 1.2.472
    [ "$status" -eq 0 ] && [ "$output" = "99" ]
}

@test "show_changelog: only newer entries, breaking flagged" {
    cat > "$BASE_DIR/v.json" <<'EOF'
{"changelog":[
  {"type":"feat","breaking":false,"text":"1.2.475 (x) - new thing"},
  {"type":"fix","breaking":true,"text":"1.2.474 (x) - api break"},
  {"type":"fix","breaking":false,"text":"1.2.472 (x) - old thing"}]}
EOF
    run show_changelog "$BASE_DIR/v.json" 1.2.472
    [ "$status" -eq 0 ]
    [[ "$output" == *"1.2.475"* ]]
    [[ "$output" == *"1.2.474"* ]]
    [[ "$output" == *"BREAKING"* ]]
    [[ "$output" != *"old thing"* ]]
}
