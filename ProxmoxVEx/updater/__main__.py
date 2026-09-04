# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/updater/__main__.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Command-line interface for checking and publishing...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Command-line interface for checking and publishing ProxmoxVEx releases."""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from ProxmoxVEx.constants import GITHUB_TOKEN, GITHUB_VERSION_URL, ProxmoxVEx_BUILD, ProxmoxVEx_VERSION
from ProxmoxVEx.updater.checker import check_for_update
from ProxmoxVEx.updater.uploader import upload_release


def _cmd_check(args: argparse.Namespace) -> int:
    result = check_for_update(args.current, args.build, args.url)
    print(json.dumps(result, indent=2))
    return 0 if result.get("update_available") else 0


def _resolve_token(args: argparse.Namespace) -> str | None:
    """Return a GitHub token from explicit args, the environment, gh CLI, or the git remote."""
    token = args.token or os.environ.get("GITHUB_TOKEN")
    if token:
        return token

    try:
        result = subprocess.run(
            ["gh", "auth", "token"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        token = result.stdout.strip()
        if token:
            return token
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    return GITHUB_TOKEN or None


def _load_version_json() -> dict[str, Any]:
    """Load version.json from the repository root, if it exists."""
    try:
        version_file = Path(__file__).resolve().parent.parent.parent / "version.json"
        if version_file.exists():
            return json.loads(version_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        pass
    return {}


def _cmd_release(args: argparse.Namespace) -> int:
    token = _resolve_token(args)
    if not token:
        print(
            "error: GitHub token not found; set GITHUB_TOKEN, run 'gh auth login', or pass --token",
            file=sys.stderr,
        )
        return 1

    version_data = _load_version_json()
    version = version_data.get("version") or ProxmoxVEx_VERSION

    tag = args.tag or f"v{version}"
    name = args.name or f"ProxmoxVEx {tag}"

    body = args.body
    if not body and version_data:
        v = tag.lstrip("v")
        notes = [c for c in version_data.get("changelog", []) if c.startswith(v) or c.startswith(f"v{v}")]
        if notes:
            body = "\n".join(f"- {c.split(' - ', 1)[-1]}" for c in notes)

    assets: list[str] = list(args.assets) if args.assets else []
    if not assets:
        root = Path(__file__).resolve().parent.parent.parent
        dist = root / "dist"
        candidates: list[str] = []
        if dist.is_dir():
            for f in dist.rglob("*"):
                if (
                    f.is_file()
                    and f.name.startswith("ProxmoxVEx-")
                    and f.name.endswith((".tar.xz", ".qcow2", ".tar.gz", ".zip"))
                ):
                    candidates.append(str(f))
        if not candidates:
            logging.warning("No release assets found in dist/; creating release without assets")
            assets = []
        else:
            assets = candidates

    result = upload_release(
        tag=tag,
        assets=assets,
        token=token,
        repo=args.repo,
        name=name,
        body=body or f"Release {tag}",
        draft=args.draft,
        prerelease=args.prerelease,
    )
    print(json.dumps(result, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ProxmoxVEx GitHub updater utility")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    subparsers = parser.add_subparsers(dest="command", required=True)

    check = subparsers.add_parser("check", help="Check for a newer version on GitHub")
    check.add_argument("--current", default=ProxmoxVEx_VERSION, help="Current version to compare against")
    check.add_argument("--build", default=ProxmoxVEx_BUILD, help="Current build string")
    check.add_argument("--url", default=GITHUB_VERSION_URL, help="Override version.json URL")
    check.set_defaults(func=_cmd_check)

    release = subparsers.add_parser("release", help="Create a GitHub release and upload assets")
    release.add_argument(
        "tag",
        nargs="?",
        default=None,
        help="Git tag for the release (default: v<version>)",
    )
    release.add_argument(
        "assets",
        nargs="*",
        default=[],
        help="Files to attach to the release (default: built artifacts in dist/)",
    )
    release.add_argument("--token", default=None, help="GitHub personal access token")
    release.add_argument("--repo", default="ArMaTeC/ProxmoxVEx", help="owner/repo")
    release.add_argument("--name", default=None, help="Release title")
    release.add_argument("--body", default="", help="Release notes markdown")
    release.add_argument("--draft", action="store_true", help="Create a draft release")
    release.add_argument("--prerelease", action="store_true", help="Mark as pre-release")
    release.set_defaults(func=_cmd_release)

    args = parser.parse_args(argv)
    if args.verbose:
        logging.basicConfig(level=logging.DEBUG)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
