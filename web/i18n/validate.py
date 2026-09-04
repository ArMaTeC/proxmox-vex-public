#!/usr/bin/env python3
# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        web/i18n/validate.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: i18n Translation Completeness Validator
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""
i18n Translation Completeness Validator
========================================
Checks that all namespaces have consistent keys across all their language files.

Usage:
    python3 web/i18n/validate.py [--strict] [--namespace NAME]

Options:
    --strict      Exit with error code if ANY keys are missing (not just warnings)
    --namespace   Only check a specific namespace
"""

import json
import sys
from pathlib import Path

LOCALES_DIR = Path(__file__).parent / "locales"
NATIVE_DIR = Path(__file__).parents[2] / "ProxmoxVEx" / "native"
PLUGINS_DIR = Path(__file__).parents[2] / "plugins"
# The reference language — all keys must exist here
REFERENCE_LANG = "en"


def load_namespace(ns_dir):
    """Load all language files for a namespace."""
    langs = {}
    for f in sorted(ns_dir.glob("*.json")):
        lang = f.stem
        try:
            with open(f, encoding="utf-8") as fh:
                langs[lang] = json.load(fh)
        except json.JSONDecodeError as e:
            print(f"  ERROR: {f.name} is not valid JSON: {e}")
            langs[lang] = {}
    return langs


def validate_namespace(ns_name, ns_dir, strict=False):
    """Validate a single namespace. Returns (warnings, errors)."""
    warnings = []
    errors = []

    langs = load_namespace(ns_dir)
    if not langs:
        errors.append(f"[{ns_name}] No language files found")
        return warnings, errors

    # Reference language must exist
    if REFERENCE_LANG not in langs:
        errors.append(f"[{ns_name}] Missing reference language '{REFERENCE_LANG}.json'")
        return warnings, errors

    ref_keys = set(langs[REFERENCE_LANG].keys())
    print(f"  {ns_name}: {len(ref_keys)} keys in {REFERENCE_LANG}, {len(langs)} languages")

    for lang, data in sorted(langs.items()):
        if lang == REFERENCE_LANG:
            continue
        lang_keys = set(data.keys())
        missing = ref_keys - lang_keys
        extra = lang_keys - ref_keys

        if missing:
            msg = f"[{ns_name}/{lang}] Missing {len(missing)} keys: {sorted(missing)[:5]}{'...' if len(missing) > 5 else ''}"
            if strict:
                errors.append(msg)
            else:
                warnings.append(msg)

        if extra:
            warnings.append(f"[{ns_name}/{lang}] {len(extra)} extra keys not in {REFERENCE_LANG}")

    return warnings, errors


def main():
    strict = "--strict" in sys.argv
    ns_filter = None
    for i, arg in enumerate(sys.argv):
        if arg == "--namespace" and i + 1 < len(sys.argv):
            ns_filter = sys.argv[i + 1]

    print("=" * 60)
    print("i18n Translation Completeness Check")
    print("=" * 60)
    print(f"Locales directory: {LOCALES_DIR}")
    print(f"Native i18n directory: {NATIVE_DIR}")
    print(f"Reference language: {REFERENCE_LANG}")
    print(f"Mode: {'strict' if strict else 'permissive'}")
    print()

    all_warnings = []
    all_errors = []
    seen = set()

    for ns_dir in sorted(LOCALES_DIR.iterdir()):
        if not ns_dir.is_dir():
            continue
        ns_name = ns_dir.name
        if ns_filter and ns_name != ns_filter:
            continue
        # If a native integration has a matching i18n/ dir, prefer that one
        native_ns = NATIVE_DIR / ns_name / "i18n"
        if native_ns.is_dir():
            seen.add(ns_name)
            warnings, errors = validate_namespace(ns_name + " (native)", native_ns, strict=strict)
            all_warnings.extend(warnings)
            all_errors.extend(errors)
            continue

        warnings, errors = validate_namespace(ns_name, ns_dir, strict=strict)
        all_warnings.extend(warnings)
        all_errors.extend(errors)

    # Also validate any native-only i18n folders not mirrored in web/i18n/locales
    for native_mod in sorted(NATIVE_DIR.iterdir()):
        if not native_mod.is_dir():
            continue
        ns_name = native_mod.name
        if ns_name in seen:
            continue
        if ns_filter and ns_name != ns_filter:
            continue
        native_ns = native_mod / "i18n"
        if not native_ns.is_dir():
            continue

        warnings, errors = validate_namespace(ns_name + " (native)", native_ns, strict=strict)
        all_warnings.extend(warnings)
        all_errors.extend(errors)

    # Plugin i18n folders live under plugins/<plugin-id>/i18n
    for plugin_dir in sorted(PLUGINS_DIR.iterdir()):
        if not plugin_dir.is_dir():
            continue
        plugin_i18n = plugin_dir / "i18n"
        if not plugin_i18n.is_dir():
            continue
        ns_name = plugin_dir.name
        if ns_filter and ns_name != ns_filter:
            continue

        warnings, errors = validate_namespace(ns_name + " (plugin)", plugin_i18n, strict=strict)
        all_warnings.extend(warnings)
        all_errors.extend(errors)

    print()
    if all_warnings:
        print(f"WARNINGS ({len(all_warnings)}):")
        for w in all_warnings:
            print(f"  ⚠  {w}")
        print()

    if all_errors:
        print(f"ERRORS ({len(all_errors)}):")
        for e in all_errors:
            print(f"  ✗  {e}")
        print()
        sys.exit(1)

    if not all_warnings and not all_errors:
        print("✓ All namespaces are complete!")
    else:
        print(f"✓ No errors (but {len(all_warnings)} warnings)")

    sys.exit(0)


if __name__ == "__main__":
    main()
