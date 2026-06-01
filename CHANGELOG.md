# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

_No unreleased changes._

## [0.2.0] — 2026-06-01

A large feature release consolidating all work since v0.1.1. WAR becomes the primary value metric; the Draft Board gains a roster-derived position-cap system plus signability/budget tracking; the metadata and fielding pipelines are reworked (now with multi-year positional adjustments and OAA-based range); regression coefficients are computed from the calibration sims rather than hardcoded; the frontend gets a Player Profile redesign, an SVG field-diagram Active Roster, smart-rank parity across every board, and a cross-page uniformity sweep.

### Changed (breaking)

- **WAR replaces WAA as the primary value metric** across the pipeline and frontend. Player value, sorting, best-position decisions, and the FV/smart-rank formulas now key on WAR (whose replacement-runs term gives SPs ~3× the credit of RPs at full-time IP — the structural fix for SP-vs-RP comparison). WAA is retained internally as a secondary metric. Replacement level is derived **per league** (FanGraphs-calibrated) rather than from a fixed OOTP-26 baseline.
- **`players/organization.csv` renamed to `players/org.csv`** — and all paired sibling files follow suit (`org_osa.csv`, `org_aaa.csv`, `org_aa.csv`, `org_osa_aaa.csv`, `org_osa_aa.csv`). Validation prints a friendly one-line rename reminder when it spots the legacy filename. Migration: `mv organization*.csv → org*.csv` in each `leagues/<slug>/csv/players/` directory.
- `dashboard.json` `meta.csvPresence.hasOrganization` is now `hasOrg` (informational flag only — no frontend view consumes it today).
- **Draft Board position caps reworked** — the flat `CAP_GROUPS` model is replaced by a roster-derived **cap tree** (`CAP_TREE`): caps come from the 26-man roster you're filling (soft cap = roster share, hard cap = soft × 1.2), nested P/H → SP/RP, C/INF/OF → leaf positions. A pick's penalty is the max over its leaf→parent chain. Persisted Draft Board cap settings from earlier versions are re-derived from the tree.

### Added

- **FV v21 + smart-rank rewrite** — logistic future-value curve, plus smart-rank deltas for org positional need, position caps, signability, and player intangibles/injury-proneness.
- **Coverage floor + RP smart-rank scaling** — a minimum-coverage nudge that secures ≥1 player at scarce premium leaves (C/MI/CF), and an RP-role adjustment (`RP_ADJUST_SCALE` = IP_RP/IP_SP ≈ 0.375) that shrinks the talent-relative smart-rank deltas for relievers, whose raw WAR/FV is compressed.
- **Draft Board signability & budget tracking** — per-pick expected signing cost vs. remaining budget, feeding the signability smart-rank penalty.
- **OAA fielding range model** — the fielding range target moves from raw PM% to OAA (difficulty-adjusted outs above average), league-adaptive via per-position bucket baselines from the calibration sims.
- **Per-league fielding out-values** — `inf_out`/`of_out` are derived from each league's own linear weights and outfield-hit mix instead of the fixed 0.75/0.90.
- **Computed regression coefficients** — rating→stat coefficients are now computed from the cached calibration sims (`generate_regression_coefficients`) and injected into the data points; the hardcoded values in `data_points.py` are the no-sims fallback. Cached in `.regressions_cache.json` (keyed on sim-data hash + cache version).
- **Multi-season metadata calibration** — league constants are calibrated from a 3-season weighted blend rather than a single season.
- **Positional Strength rebuild** — slot-weighted Now/Farm strength with aging-core detection.
- **Metadata input rework** — pipeline normalizes raw OOTP exports (derives the spreadsheet columns itself) and accepts a 2-file usage-based `pitcher_ratings` split (SP/RP); export-workflow docs added.
- **`players/intl.csv` (optional)** — IntlComplex players can ship in a separate CSV when OOTP's "List All MLB Players" export paginates in larger leagues. Rows from `intl.csv` are concatenated with `org.csv` and tagged `source = "Organization"`, so all downstream views behave identically to a single-file export. OSA / AAA / AA pairing follows the same stem rule (`intl_osa.csv`, etc.). New `meta.csvPresence.hasIntl` flag in `dashboard.json` (informational).
- **Young over-achievers** are now included in the Dev% and Smart Rank signals.
- **StatsPlus integration improvements** — live game-date detection (preferred over CSV-detected Sct date), a dynamic dev proxy, and build-cache refresh handling.
- **Multi-year positional adjustments + bestPos Option B + eligibility floors** in the fielding model. Per-league frozen posAdj uses a multi-year offense/defense blend (H_def=5 / cut_def=20, H_off=2.5 / cut_off=8). `bestPos` resolves via `RunsP + DEF_SPECTRUM[pos]` argmax over eligible field positions, with an LF/RF arm-split leaf when both corners are eligible. Position eligibility floors retuned against real IP usage: LF/RF→45, 1B+IFerr>20, SS+TDP≥45. All 6 leagues rebuilt on cache version v5.
- **Prospect tier thresholds: V5c range-constrained natural-break detection.** Tier breaks now come from gap structure in the prospect pool rather than fixed FV cutoffs, constrained to each tier's expected FV range. The tier-config table gains a "MLB Players ≥ FV" column showing how many current MLB players sit at or above each tier's threshold.
- **Player Profile tab redesign.** `FieldingTab` is now a compact projection table with a subtle `⤴` arm-split indicator on the LF/RF leaf and per-position peer-percentile mini-bars (RunsP rank within MLB players eligible at that position). OOTP scouting grades hoisted to the top of `BattingTab` / `BaserunningTab` / `FieldingTab`. BSR / wSB / UBR render plain white with the POT chip in green.
- **Active Roster page: field-diagram redesign.** The three stacked lineup/rotation/bullpen tables are replaced by an SVG baseball diamond with 9 starter chips at their defensive positions (foul-line angles continue smoothly from the baselines through the foul poles). Rotation 2-col grid top-left, bullpen 4×2 grid bottom-left, bench column right. Each chip shows pos · name · WAR · age · injury proneness; click opens the player profile.
- **Shared `PositionalStrengthTable` component** propagated to Free Agent Finder, Rule 5 Board, and Scout View. A `dense` mode (drops Age column, smaller bars) keeps the satellite views' Positional Needs sections as compact reminders. Scout View renders two side-by-side tables sorted against the user's team for row-aligned comparison.
- **Smart Rank parity across boards.** Scout View's `Fit` rewired from the inline multiplicative formula to the additive `applySmartRank` formula used by Draft/IAFA/R5, with the same 4-toggle subset (Future Value / Org Positional Need / Injury Proneness / Intangibles). Free Agent Finder gains the same Smart Rank section + a Smart column. IAFA/R5 toggle text aligned to Draft Board verbatim.
- **All Players mixed view gains WAR + WAR P columns.** Hitter enrichment now sets `_war` / `_warP` so the mixed-pool table renders the same columns the hitter and pitcher views already had.
- **`NumericRangeFilter` shared component** matching the `MultiSelectDropdown` styling. Supports min-only / max-only / both. Replaces the inline `<input type="number">` pairs on PlayersView (Age) and Free Agent Finder (Age, Pro Yrs).
- **40-Man Planner sub-tab on Rule 5 Board** now lazy-loads the full `RosterPlanner` so changes sync between the standalone Roster Planner page and the R5 sub-tab via the shared per-league `localStorage` keys.

### Changed

- **RP WAR is no longer scaled** — the WAA-era negative-value ramp for relievers is redundant under WAR, so `scaleRpWarP` is now a no-op (the WAA scaler `scaleRpWaaP` is retained as the seam for a future "show WAA" toggle).
- **Metadata cache version** bumped (2→3) so on-disk caches holding the old fixed out-values / PM% fielding coefficients are invalidated on next build. Fielding cache version subsequently bumped to v5 by the multi-year posAdj work.
- **Cross-page uniformity sweep**: standardized column labels and widths everywhere (Name 170 · Best 48 · Lvl 45 · Team 130 · WAR / WAR P 65 · INTG 48 · Salary 85 · Age 45 · POS 48). Section title count format unified to `(N)`. `INTS` → `INTG` everywhere (Draft Board, IAFA Board, Players View, Org Overview).
- **My Organization → Overview**: Prospect Watch section removed (covered by the Prospects page); team roster gains pagination; INTG column added.
- **My Organization → Rule 5 Eligible** sub-tab removed (covered by the standalone Rule 5 Board).
- **FA Finder + Rule 5 Board layout**: Positional Needs and Smart Rank Adjustments now sit side-by-side in a `1fr 1fr` grid with stretched heights; toggles render in a single column matching the Positional Needs box height.
- **Vite `chunkSizeWarningLimit` bumped to 600 KB** so the recharts chunk (already isolated via `manualChunks`) no longer trips the default 500 KB warning every build.

### Fixed

- **2B and SS fielding error intercepts** — `second_err_const` and `ss_err_const` in `model/src/data_points.py` were imported from the original Excel "Fielding Reg IF" sheet, which had copy-paste centering bugs in the 2B/SS `E%` regression inputs (subtracting the zone-rating total instead of the errors total, and SS centering on 2B's grand total). This only corrupted the regression *intercepts* (slopes were unaffected), but those intercepts feed the errors-above-average term, adding a constant positive error bias to every 2B and SS and understating middle-infield defensive value. Corrected to the properly-centered values (≈ `-2.4e-05` / `1.2e-05`), matching the other infield positions. See `Spreadsheet/docs/KNOWN_BUGS.md` Bug 13.
- **SB% bounded to `[0, 1]`** — a success rate can't exceed 100%, so the linear rating model is clipped (matching the pitcher side); with the calibration intercept this only binds for the extreme tail (STE ≈ 95+).
- **Per-league state fixes** — settings reload, Draft Board persistence, startup-league selection, and game-date sync are now correctly scoped per league; a URL-param league override is no longer clobbered by the React StrictMode double-mount.
- **Active Roster page crash** — two `fmt(waa)` references survived the WAA→WAR rename; both replaced with `fmt(war)`. Page is functional again.
- **Optimized Lineup broken under nested JSON** — `assignPlayersToPositions` was reading flat CSV keys like `"1B WAR vR"` that don't exist on the post-v0.2.0 nested player shape. It now accepts a `split` parameter and resolves through `getWar(p, pos, split)`.
- **40M column on the Overview roster wasn't rendering checks** because `meta.on40` is a boolean, not the string `"Yes"`. Check now accepts either.

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

[Unreleased]: https://github.com/ootpalex/ootp-dashboard/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ootpalex/ootp-dashboard/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/ootpalex/ootp-dashboard/releases/tag/v0.1.1
[0.1.0]: https://github.com/ootpalex/ootp-dashboard/releases/tag/v0.1.0
