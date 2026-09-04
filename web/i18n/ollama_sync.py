#!/usr/bin/env python3
# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        web/i18n/ollama_sync.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: i18n Missing Key Synchronizer via Ollama.
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""i18n Missing Key Synchronizer via Ollama.

Scans every namespace under web/i18n/locales, compares each language file
to the reference (en) file, fills missing keys by translating the English
value through a local Ollama server, removes extra keys that no longer exist
in the reference, and creates language files that do not yet exist for a
namespace. Optionally re-translates specific keys that are already present
(e.g., outOfScopeText) when the English source has changed.

Usage:
    python3 web/i18n/ollama_sync.py
    python3 web/i18n/ollama_sync.py --ollama-url http://192.168.1.216:11434
    python3 web/i18n/ollama_sync.py --model llama3.1 --batch 20
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

LOCALE_ROOT = Path(__file__).resolve().parent / "locales"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
PLUGINS_I18N_ROOT = PROJECT_ROOT / "plugins"
LOCALE_ROOTS = (LOCALE_ROOT, PLUGINS_I18N_ROOT)
REFERENCE_LANG = "en"
BATCH_SIZE = 20


def _validate_ollama_url(url: str) -> str:
    """Reject non-HTTP(S) or otherwise dangerous Ollama URLs before they
    reach urllib.request.urlopen, mitigating SSRF attacks.
    Returns only a hard-coded allow-list endpoint so no user input reaches
    the network sink."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise SystemExit("[ABORT] Ollama URL scheme must be http or https")
    if parsed.hostname is None:
        raise SystemExit("[ABORT] Ollama URL has no hostname")
    host = parsed.hostname.lower()
    port = parsed.port or 0
    if parsed.scheme == "http" and host == "192.168.1.216" and port == 11434:
        return "http://192.168.1.216:11434"
    if parsed.scheme == "http" and host == "localhost" and port == 11434:
        return "http://localhost:11434"
    if parsed.scheme == "http" and host == "127.0.0.1" and port == 11434:
        return "http://127.0.0.1:11434"
    raise SystemExit("[ABORT] Ollama URL is not in the allowlist")


def _safe_locale_path(path: Path) -> Path:
    """Ensure a locale file path resolves inside LOCALE_ROOT or a plugin
    i18n directory, blocking directory traversal from command-line arguments."""
    resolved = path.resolve()
    for root in LOCALE_ROOTS:
        if resolved.is_relative_to(root.resolve()):
            return resolved
    raise SystemExit(f"[ABORT] path {resolved} must be inside {LOCALE_ROOTS}")


def _ns_name(ns_dir: Path) -> str:
    """Return a human-readable namespace name for a locale directory.
    For plugins the i18n folder is under plugins/<id>/i18n, so return <id>."""
    if ns_dir.is_relative_to(PLUGINS_I18N_ROOT):
        return ns_dir.parent.name
    return ns_dir.name


LANG_NAMES: Dict[str, str] = {
    # Current
    "en": "English",
    "de": "German",
    "es": "Spanish",
    "fr": "French",
    "it": "Italian",
    "ko": "Korean",
    "pt": "Portuguese",
    # Priority Additions
    "ja": "Japanese",  # High Revenue
    "zh-hans": "Chinese (Simp)",  # Massive Reach / Revenue
    "ar": "Arabic",  # High Spending / Regional Block
    "hi": "Hindi",  # Pure Scale
    "ru": "Russian",  # High Internet Usage
    "id": "Indonesian",  # Emerging Growth
    "tr": "Turkish",  # Regional Bridge
}


def eprint(msg: str) -> None:
    """Print a message to stderr."""
    print(msg, file=sys.stderr)


def load_json(path: Path) -> Dict[str, str]:
    """Load a JSON locale file and return its key/value mapping."""
    path = _safe_locale_path(path)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Dict[str, str]) -> None:
    """Write a locale file with keys sorted alphabetically."""
    path = _safe_locale_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(data.items())), f, ensure_ascii=False, indent=2)
        f.write("\n")


def choose_model(ollama_url: str, explicit: Optional[str]) -> str:
    """Return the model to use. If not explicitly provided, ask Ollama."""
    if explicit:
        return explicit

    PREFERRED = ("llama", "mistral", "qwen", "gemma", "phi", "command")
    SKIP = ("llava", "bakllava", "moondream", "nomic-embed", "all-minilm")

    try:
        req = urllib.request.Request(f"{ollama_url.rstrip('/')}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            models = [m.get("name") for m in payload.get("models", []) if m.get("name")]
            # Prefer text-only chat models, avoid vision/embedding models.
            scored = [
                (name, any(p in name.lower() for p in PREFERRED))
                for name in models
                if not any(s in name.lower() for s in SKIP)
            ]
            scored.sort(key=lambda x: (not x[1], x[0].lower()))
            if scored:
                eprint(f"Using Ollama model: {scored[0][0]}")
                return scored[0][0]
    except urllib.error.URLError as exc:
        eprint(f"Could not reach Ollama to list models: {exc}")

    raise SystemExit("No Ollama model specified and the server is unreachable. Pass --model or set OLLAMA_MODEL.")


def extract_json(text: str) -> Dict[str, Any]:
    """Best-effort JSON extraction from an LLM response."""
    # Strip markdown fences if present.
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[\w\s]*\n?|\n?```$", "", text).strip()
    # If there is surrounding prose, grab the first balanced JSON object.
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        text = match.group(0)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Last resort: extract "key": "value" pairs with a regex and unescape each
    # value individually. This handles models that emit JSON-like text with
    # malformed escape sequences.
    pairs = re.findall(r'"([^"\\]+)"\s*:\s*"((?:[^"\\]|\\.)*)"', text, re.DOTALL)
    if not pairs:
        raise ValueError(f"Could not parse Ollama response as JSON:\n{text[:500]}")

    parsed: Dict[str, Any] = {}
    for key, raw_value in pairs:
        try:
            parsed[key] = json.loads('"' + raw_value + '"')
        except json.JSONDecodeError:
            parsed[key] = raw_value
    return parsed


def translate_batch(
    ollama_url: str,
    model: str,
    target_code: str,
    items: List[Tuple[str, str]],
) -> Dict[str, str]:
    """Translate a batch of English strings to the target language."""
    if not items:
        return {}

    lang_name = LANG_NAMES.get(target_code, target_code)
    inputs = dict(items)

    prompt = (
        f"Translate the following UI strings from English to {lang_name}. "
        "Return ONLY a JSON object where the keys are exactly the same and "
        "the values are the translations. Do not include explanations, "
        "markdown, or any other text.\n\n"
        f"Input:\n{json.dumps(inputs, ensure_ascii=False, indent=2)}"
    )

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "format": "json",
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{ollama_url.rstrip('/')}/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    eprint(f"  Sending {len(items)} key(s) to Ollama ({model})...")
    for key, value in items:
        eprint(f"    -> {key}: {json.dumps(value, ensure_ascii=False)}")

    # snyk:ignore:Server-Side Request Forgery (SSRF)
    # lgtm[py/ssrf]
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read().decode("utf-8"))

    raw = result.get("response", "")
    translated = extract_json(raw)
    if not isinstance(translated, dict):
        raise ValueError("Ollama did not return a JSON object")

    # Ensure every requested key is present; fall back to English if missing.
    out: Dict[str, str] = {}
    eprint("  Received translations:")
    for key, value in items:
        got = translated.get(key, value)
        if key not in translated:
            eprint(f"    <- {key}: missing in response, using English fallback")
        out[key] = got
        eprint(f"    <- {key}: {json.dumps(value, ensure_ascii=False)} -> {json.dumps(got, ensure_ascii=False)}")
    return out


def discover_target_languages() -> List[str]:
    """Return the full set of languages to sync from the LANG_NAMES allowlist,
    excluding the reference language so new languages are generated as soon as
    they are added to LANG_NAMES."""
    return sorted(lang for lang in LANG_NAMES if lang != REFERENCE_LANG)


def main() -> int:
    """Entry point."""
    parser = argparse.ArgumentParser(description="Sync missing i18n translations using Ollama.")
    parser.add_argument(
        "--ollama-url",
        default=os.getenv("OLLAMA_URL", "http://192.168.1.216:11434"),
        help="Ollama base URL (default: http://192.168.1.216:11434).",
    )
    parser.add_argument(
        "--model",
        default=os.getenv("OLLAMA_MODEL"),
        help="Ollama model to use. If omitted, the first running model is used.",
    )
    parser.add_argument(
        "--batch",
        type=int,
        default=int(os.getenv("OLLAMA_BATCH", "20")),
        help="Number of keys to translate per Ollama call (default: 20).",
    )
    parser.add_argument(
        "--retranslate",
        action="append",
        default=[],
        help="Re-translate keys that already exist (can be repeated). Disabled by default.",
    )
    parser.add_argument(
        "--namespace",
        default=None,
        help="Only process a single namespace (e.g. truenas).",
    )
    args = parser.parse_args()
    retranslate = set(args.retranslate)

    # Validate and lock down SSRF/path-traversal sinks before using them.
    ollama_url = _validate_ollama_url(args.ollama_url)

    if args.namespace:
        ns_name = args.namespace.strip("/\\")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", ns_name):
            raise SystemExit("[ABORT] --namespace must be a simple directory name")
        # Check core namespaces first, then plugin i18n directories.
        ns_path = LOCALE_ROOT / ns_name
        if not ns_path.is_dir():
            ns_path = PLUGINS_I18N_ROOT / ns_name / "i18n"
        if not ns_path.is_dir():
            raise SystemExit(f"[ABORT] namespace not found: {ns_name}")
        _safe_locale_path(ns_path)
        namespaces = [ns_path]
    else:
        core_namespaces = (d for d in LOCALE_ROOT.iterdir() if d.is_dir())
        plugin_i18n = (
            d / "i18n"
            for d in PLUGINS_I18N_ROOT.iterdir()
            if d.is_dir() and (d / "i18n" / f"{REFERENCE_LANG}.json").is_file()
        )
        namespaces = sorted(list(core_namespaces) + list(plugin_i18n))

    model = choose_model(ollama_url, args.model)
    target_langs = discover_target_languages()

    print(f"Ollama URL: {ollama_url}")
    print(f"Model: {model}")
    print(f"Batch size: {args.batch}")
    print(f"Reference language: {REFERENCE_LANG}")
    print(f"Target languages: {', '.join(target_langs)}")
    print(f"Namespaces: {', '.join(_ns_name(ns) for ns in namespaces)}\n")

    updated_files = 0
    new_files = 0

    try:
        for ns_dir in namespaces:
            en_path = ns_dir / f"{REFERENCE_LANG}.json"
            if not en_path.exists():
                eprint(f"[skip] No reference file for {_ns_name(ns_dir)}")
                continue

            reference = load_json(en_path)
            eprint(f"\n[namespace: {_ns_name(ns_dir)}] {len(reference)} reference keys")
            retranslate_set = set(retranslate)

            for lang in target_langs:
                lang_path = ns_dir / f"{lang}.json"
                is_new = not lang_path.exists()
                if is_new:
                    current = {}
                    new_files += 1
                    eprint(f"  [{lang}] creating new file: {lang_path}")
                else:
                    current = load_json(lang_path)

                # Drop stale keys that have been removed from the reference.
                extra = set(current) - set(reference)
                if extra:
                    eprint(f"  [{lang}] {len(extra)} extra key(s) not in reference; removing")
                    current = {k: v for k, v in current.items() if k in reference}

                missing = [(k, reference[k]) for k in reference if k not in current or k in retranslate_set]
                if not missing and not extra:
                    eprint(f"  [{lang}] up to date")
                    continue

                eprint(f"  [{lang}] {len(missing)} missing key(s); {len(current)} existing")

                translated: Dict[str, str] = {}
                for i in range(0, len(missing), args.batch):
                    batch = missing[i : i + args.batch]
                    eprint(
                        f"\n  [{_ns_name(ns_dir)}/{lang}] batch "
                        f"{i // args.batch + 1} of {(len(missing) - 1) // args.batch + 1} "
                        f"({len(batch)} key(s))"
                    )
                    # snyk:ignore:Server-Side Request Forgery (SSRF)
                    # lgtm[py/ssrf]
                    batch_result = translate_batch(ollama_url, model, lang, batch)
                    translated.update(batch_result)

                merged = {**current, **translated}
                save_json(lang_path, merged)
                updated_files += 1
                eprint(f"  [{lang}] saved {lang_path} (+{len(translated)} translated, {len(current)} kept)")

        print(f"\nDone. {new_files} new locale file(s) created, {updated_files} locale file(s) updated.")
    except KeyboardInterrupt:
        eprint("\nInterrupted by user. Saving partial progress if any...")
        if "lang_path" in locals() and "translated" in locals():
            merged = {**current, **translated}
            save_json(lang_path, merged)
            eprint(f"  Saved partial progress: {lang_path}")
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
