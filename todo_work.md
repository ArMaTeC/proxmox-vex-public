# TODO / Placeholder Work List

Generated from a scan of the `ProxmoxVEx` and `web/src` source trees.
Build artifacts (`web/app.bundle.js*`), `static/`, `.devin/skills`, `.specify/templates`, and i18n false-positives were excluded.

## Open TODO / FIXME

- [x] `ProxmoxVEx/api/vms.py:1638` — add option to restore with a different name.
  - Implemented: request may now include `name`/`hostname`; for `qemu` it is forwarded as `name` and for `lxc` as `hostname`.

- [x] `ProxmoxVEx/native/truenas/truenas_src/core/ws_client.py:820` — wire the real `core.unsubscribe` call on the server.
  - Implemented: `unsubscribe()` now removes local callbacks and sends `core.unsubscribe` when no callbacks remain for the collection.

- [x] `ProxmoxVEx/core/db.py:2008` — decide whether to delete migrated legacy JSON files after a few versions.
  - Implemented: `_archive_legacy_files()` moves migrated legacy JSON/encrypted files to a timestamped `config/legacy/` directory instead of deleting them.

- [x] `web/src/constants.js:81-82` — finish translation cleanup.
  - Implemented: removed outdated `TODO`/`FIXME` comments; `fr` and `es` translation blocks already exist in `translations.js`.

- [x] `web/src/dashboard.js:8459` — remove the `axios` TODO on the auth fetch helper.
  - Implemented: the `fetch`-based helper is adequate; the placeholder comment was removed.

- [x] `web/src/security.js:1842` — add bulk exclude/include for auto-migration pinned VMs.
  - Implemented: `ExcludedVMsList` now has a multi-select for bulk excluding available VMs and an "Include all excluded" button.

- [x] `.github/workflows/test.yml:34` — switch `ruff check` to a strict exit once the baseline is clean.
  - Implemented: added `scripts/ruff_baseline_check.py` and `scripts/ruff-baseline.json` to enforce a strict exit for *new* violations while grandfathering the existing baseline items (T032). Updated the workflow to run the baseline checker and added `ruff` to `requirements-dev.txt`.

## Placeholders / Hard-coded Defaults

- [x] `ProxmoxVEx/core/manager.py:10061` — replace default `changeme` LXC password placeholder with a required value.
  - Implemented: `password` is now required and returns an error if missing.

- [x] `ProxmoxVEx/core/manager.py:3370` — replace `#xxx` issue number placeholder.
  - Implemented: removed the unknown `#xxx` placeholder; only the PVE version note remains.

- [ ] `ProxmoxVEx/native/truenas/truenas_src/core/subsystem.py:139-145` — `list`, `read`, and `health` raise `NotImplementedError`.
  - **Intentional by design**: these are abstract contract methods meant to be overridden by concrete subsystems.

## HACK / Quick-fix Debt

- [x] `ProxmoxVEx/api/nodes.py:1129` — remove the "hack" wording on the `cluster/status` resolver.
  - Implemented: reworded the comment to describe the consolidated resolver.

- [x] `web/src/dashboard.js:8490` — reword the websocket callback closure workaround.
  - Implemented: comment now explains the ref-in-sync pattern instead of calling it a hack.
