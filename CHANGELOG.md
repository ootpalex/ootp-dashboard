# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed (breaking)

- **`players/organization.csv` renamed to `players/org.csv`** — and all paired sibling files follow suit (`org_osa.csv`, `org_aaa.csv`, `org_aa.csv`, `org_osa_aaa.csv`, `org_osa_aa.csv`). Validation prints a friendly one-line rename reminder when it spots the legacy filename. Migration: `mv organization*.csv → org*.csv` in each `leagues/<slug>/csv/players/` directory.
- `dashboard.json` `meta.csvPresence.hasOrganization` is now `hasOrg` (informational flag only — no frontend view consumes it today).

### Added

- **`players/intl.csv` (optional)** — IntlComplex players can now ship in a separate CSV when OOTP's "List All MLB Players" export paginates in larger leagues. Rows from `intl.csv` are concatenated with `org.csv` and tagged `source = "Organization"`, so all downstream views behave identically to a single-file export. OSA / AAA / AA pairing follows the same stem rule (`intl_osa.csv`, etc.). New `meta.csvPresence.hasIntl` flag in `dashboard.json` (informational).

### Fixed

- **2B and SS fielding error intercepts** — `second_err_const` and `ss_err_const` in `model/src/data_points.py` were imported from the original Excel "Fielding Reg IF" sheet, which had copy-paste centering bugs in the 2B/SS `E%` regression inputs (subtracting the zone-rating total instead of the errors total, and SS centering on 2B's grand total). This only corrupted the regression *intercepts* (slopes were unaffected), but those intercepts feed the errors-above-average term, adding a constant positive error bias to every 2B and SS and understating middle-infield defensive value. Corrected to the properly-centered values (≈ `-2.4e-05` / `1.2e-05`), matching the other infield positions. See `Spreadsheet/docs/KNOWN_BUGS.md` Bug 13.

## [0.1.1] — 2026-04-30

Same-day patch: ship test fixtures so CI runs the full pytest suite without skip markers.

### Added

- Bundled SSB league CSVs (`leagues/default/{csv,metadata,league.json}`) and the OOTP 26 regression calibration data (`data/regressions/ootp26/`) so a fresh clone has working fixtures for the test suite. Repo size grew from ~5 MB to ~25 MB (one-time).

### Changed

- Reverted all `pytest.mark.skipif` markers added during v0.1.0 patching. The full suite now runs end-to-end on a fresh clone — `cd model && python3 -m pytest` reports `338 passed, 24 skipped` (the 24 skips are pre-existing data-dependent guards, none introduced by this release).
- `model/tests/conftest.py` retains `HAS_PLAYER_DATA` / `HAS_BALLPARKS` defensive flags as cheap insurance against accidental fixture deletion in future PRs.

### Fixed

- GitHub Actions pytest job no longer fails on missing fixtures; the CI badge in `README.md` reflects each push reliably.

## [0.1.0] — 2026-04-30

Initial public release. Reverse-engineered from the original Excel workbook into a Python pipeline plus a React SPA.

### Added

- **Multi-league support** — `leagues/<slug>/` per league (`league.json`, `csv/players/`, `csv/ballparks.csv`, `metadata/`, `output/`). Regressions live at `data/regressions/ootp<version>/` and are shared across leagues on the same OOTP version.
- **One-click runner** — `python3 run.py` (plus `Run Dashboard.command` / `Run Dashboard.bat` shims) walks first-time users through league setup, runs the pipeline, starts the dev server, and opens the browser.
- **Auto-migration** — when `model/pipeline_settings.json` is detected on first run, settings + data are migrated into `leagues/default/`.
- **Validation layer** (`model/src/validation.py`) — pre-pipeline checks fire friendly errors with file paths and team-name diffs for ballpark/team mismatches, missing required CSVs, unknown teams.
- **Optional player CSVs** — only `organization.csv` was strictly required (renamed to `org.csv` post-v0.1.1; see Unreleased). Missing `freeagents.csv` / `iafa.csv` / `draftYYYY.csv` hides the corresponding view (Free Agent Finder / IAFA Board / Draft Board) automatically. Draft year regex accepts any 4 digits (`draft1967.csv` through `draft2156.csv`).
- **Frontend league switcher** — sidebar dropdown appears when more than one league is configured. Per-league localStorage namespacing for team, game date, league settings, roster moves, R5 threshold, IAFA signed list, prospect board settings.
- **Pipeline test suite** — 338 passing pytest cases, 24 skipped (data-dependent skips on a fresh clone with no CSVs).
- **GitHub release plumbing** — MIT LICENSE, GitHub Actions CI (pytest + Vite build on push/PR), bug-report and feature-request issue templates, pull-request template, CODE_OF_CONDUCT.

### Documentation

- Full rewrite of `README.md`, new `QUICKSTART.md`, new `docs/MULTI_LEAGUE.md`.
- `docs/OOTP_EXPORT_GUIDE.md` filled in with screen-by-screen OOTP export instructions, OSA / AAA / AA blending workflow, and the bundled OOTP saved-views file at `docs/ootp_views/`.
- Original Excel workbook README preserved verbatim at `docs/ORIGINAL_EXCEL_README.md`.

[Unreleased]: https://github.com/ootpalex/ootp-dashboard/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/ootpalex/ootp-dashboard/releases/tag/v0.1.1
[0.1.0]: https://github.com/ootpalex/ootp-dashboard/releases/tag/v0.1.0
