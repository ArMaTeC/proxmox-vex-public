# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        tests/e2e/test_storage_health.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Playwright end-to-end coverage for the Storage Health...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Playwright end-to-end coverage for the Storage Health Monitor plugin."""

import json
import re
from pathlib import Path

import pytest
from playwright.sync_api import Page, expect

from .mocks import mock_admin_session
from .test_ui_navigation import _collect_errors

REPO_ROOT = Path(__file__).resolve().parents[2]
UI_PATH = REPO_ROOT / "plugins" / "storage-health-monitor" / "ui.html"
UI_CSS_PATH = REPO_ROOT / "plugins" / "storage-health-monitor" / "ui.css"
UI_JS_PATH = REPO_ROOT / "plugins" / "storage-health-monitor" / "ui.js"
VISIBLE_TIMEOUT = 20000


def _storage_health_handler(route):
    """Fulfill the plugin API endpoints used by the UI."""
    url = route.request.url
    path = url.split("?")[0]
    if path.endswith("/status"):
        return route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"status": "running"}),
        )
    if path.endswith("/clusters") or path.endswith("/api/clusters"):
        return route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "data": [
                        {
                            "id": "cluster_1",
                            "name": "Test Cluster",
                            "display_name": "Test Cluster",
                            "connected": True,
                        }
                    ]
                }
            ),
        )
    if path.endswith("/nodes"):
        return route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "cluster_id": "cluster_1",
                    "data": [{"name": "pve1", "status": "online"}],
                }
            ),
        )
    if path.endswith("/storages"):
        return route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "cluster_id": "cluster_1",
                    "node": "pve1",
                    "data": [{"name": "local-lvm", "type": "lvmthin"}],
                }
            ),
        )
    if path.endswith("/health"):
        return route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "cluster_id": "cluster_1",
                    "health_index": 0.5,
                    "healthy_disks": 1,
                    "warning_disks": 0,
                    "failing_disks": 1,
                    "unknown_disks": 0,
                    "total_disks": 2,
                    "checked_at": "2026-08-09T12:00:00+00:00",
                    "next_check_at": "2026-08-09T13:00:00+00:00",
                    "meets_threshold": False,
                    "thresholds": {
                        "min_ok_percentage": 90,
                        "max_warning_disks": 0,
                        "max_failing_disks": 0,
                    },
                    "disks": [
                        {
                            "node": "pve1",
                            "devpath": "sda",
                            "health": "OK",
                            "size": 500000000000,
                            "model": "Test SSD",
                            "serial": "abc",
                            "wearout": "",
                            "temperature": "",
                            "changed": False,
                            "previous_health": "",
                        },
                        {
                            "node": "pve1",
                            "devpath": "sdb",
                            "health": "Failing",
                            "size": 0,
                            "model": "Unknown",
                            "serial": "",
                            "wearout": "",
                            "temperature": "",
                            "changed": False,
                            "previous_health": "",
                        },
                    ],
                }
            ),
        )
    if path.endswith("/trends"):
        return route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {"cluster_id": "cluster_1", "interval": "hourly", "data": []}
            ),
        )
    if path.endswith("/scrub-history"):
        return route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"data": [], "total": 0, "limit": 50, "offset": 0}),
        )
    if path.endswith("/alerts/rules"):
        return route.fulfill(
            status=200, content_type="application/json", body=json.dumps({"data": []})
        )
    if path.endswith("/alerts/active"):
        return route.fulfill(
            status=200, content_type="application/json", body=json.dumps({"data": []})
        )
    if path.endswith("/audit"):
        return route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"data": [], "total": 0, "limit": 50, "offset": 0}),
        )
    if path.endswith("/schedule"):
        return route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "cluster_id": "cluster_1",
                    "interval_minutes": 60,
                    "last_check_at": "",
                    "next_check_at": None,
                }
            ),
        )
    if path.endswith("/compare"):
        return route.fulfill(
            status=200, content_type="application/json", body=json.dumps({"data": []})
        )
    if path.endswith("/thresholds"):
        return route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "data": {
                        "min_ok_percentage": 90,
                        "max_warning_disks": 0,
                        "max_failing_disks": 0,
                    }
                }
            ),
        )
    return route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({"success": False, "error": "not mocked"}),
    )


def _ui_handler(route):
    """Serve the split plugin UI assets directly for the E2E test."""
    path = route.request.url.split("?")[0].split("/")[-1]
    if path == "ui":
        file_path, content_type = UI_PATH, "text/html"
    elif path == "ui.css":
        file_path, content_type = UI_CSS_PATH, "text/css"
    elif path == "ui.js":
        file_path, content_type = UI_JS_PATH, "text/javascript"
    else:
        return route.fallback()
    if not file_path.exists():
        return route.fulfill(
            status=404, content_type="text/plain", body=f"{file_path.name} not found"
        )
    return route.fulfill(
        status=200,
        content_type=content_type,
        body=file_path.read_text(encoding="utf-8"),
    )


@pytest.fixture
def storage_health_page(page: Page):
    """Open the storage health UI with mocked endpoints."""
    errors = _collect_errors(page)
    mock_admin_session(page)
    page.route(
        re.compile(r".*/api/plugins/storage-health-monitor/api/.*"),
        _storage_health_handler,
    )
    page.route(re.compile(r".*/api/plugins/storage-health-monitor/api/ui"), _ui_handler)
    page.goto("/api/plugins/storage-health-monitor/api/ui?theme=modern-dark")
    page.wait_for_load_state("networkidle")
    return errors


def test_storage_health_ui_loads(page: Page, storage_health_page):
    errors = storage_health_page
    expect(page.get_by_role("heading", name="Storage Health Monitor")).to_be_visible(
        timeout=VISIBLE_TIMEOUT
    )
    assert not errors, f"Console/page errors on load: {errors}"


def test_storage_health_cluster_check(page: Page, storage_health_page):
    errors = storage_health_page
    page.get_by_role(
        "combobox", name=re.compile("cluster", re.IGNORECASE)
    ).first.select_option("cluster_1")
    page.get_by_role("button", name="Check").first.click()
    expect(page.get_by_text("0.5")).to_be_visible(timeout=VISIBLE_TIMEOUT)
    expect(page.get_by_text("sda")).to_be_visible(timeout=VISIBLE_TIMEOUT)
    assert not errors, f"Console/page errors during health check: {errors}"


def test_storage_health_tabs_switch(page: Page, storage_health_page):
    errors = storage_health_page
    for name in (
        "Scrub",
        "History",
        "Trends",
        "Compare",
        "Schedule",
        "Alerts",
        "Audit",
        "Report",
        "Widget",
    ):
        tab = page.get_by_role("tab", name=name).first
        if tab.is_visible():
            tab.click()
    assert not errors, f"Console/page errors while switching tabs: {errors}"
