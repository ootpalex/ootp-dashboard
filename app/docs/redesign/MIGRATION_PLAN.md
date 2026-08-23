# Night Scorecard — migration plan

**Chosen direction:** Direction 6 "Night Scorecard", **graphite** ground — Scorecard's document grammar (1 px-bordered
scorecard boxes with titled header strips, column-group rules, light zebra, one red-pencil accent, Savant-style FV tier
pills, level luminance ladder, Archivo + Archivo Narrow, 3 px radius) rebuilt dark-native on a neutral graphite ground.
Reference: `mockup/night-scorecard.html` (open in a browser; the "Ground" control is a review control — graphite is the
decision). Values: `app/src/theme.js` → `app/src/tokens.css` (batch 0 landed 2026-08-23); contrast: `CHECKS.md`; per-file evidence: `MIGRATION_INVENTORY.md`.

## What does not change
- **Data access and component logic.** Every accessor rule in `app/CLAUDE.md` still applies (`getWar`/`resolveKey`/
  `isEligible`…, never flat column names). Diffs stay inside inline `style={}` objects, `theme.js`, a few wrapper
  `<div>`s, `index.html`, `prototype.css`, docs.
- **Recharts** stays; restyled through `TOKENS.CHART` (series 1–6, grid, axis, refLine, tooltip, band fills).
- **Density.** Main boards keep their full column set at a 1440 px viewport with no horizontal scroll (gate per batch).
- **Helper API.** Every `theme.js` export that returns a string today still returns a string (the new text colour);
  object-returning helpers are additive: `posChip`, `levelChip`, `tierChip`, `zHeat`. `S` keeps all 17 keys (18 added).

## Token model (decided)
1. `app/src/theme.js` is the single source of truth: `TOKENS` (literal hexes) + encoding maps + helpers. Inline-style
   React and Recharts need literal colours, so components never see `var()`.
2. `app/src/tokens.css` is generated from it (`gen-tokens-css.mjs`) for body/global styles and `prototype.css` parity
   (`diff <(node gen-tokens-css.mjs) tokens.css` must be empty — it is today).
3. One theme. No light mode, no ground switch, nothing persisted. Colour mixes (zebra, z-heat, tier 65/40+, NEED tints)
   are computed in OKLab in JS to reproduce the mockup's `color-mix(in oklab, …)` — verified against the dir-6 report.

## The seven breaking changes in `theme.js` (full call-site list at the top of `app/src/theme.js`)
1. `FV_TIER_COLORS[tier]` → `{bg,text}` (was a hex). 6 call sites, all in `ProspectsView.jsx` (template `…22`
   suffixes, a Recharts `fill`, a legend swatch) → use `tierChip(id)` or `.bg`.
2. `zToColor(z).value/.label` flip to ink at |z| ≥ 2.0 (readable only on `.bg`); `PositionalStrengthTable.jsx:83`
   paints them on the row ground → migrate score/rank to filled heat cells (as the mockup) or use `zHeat(z).bar`.
3. `levelColor()` as text compresses the ladder below AA (A+/A/R return the AA grey); 12 text call sites keep working
   but lose three rungs → migrate to `levelChip()`.
4. `gradeStyle/warStyle/waaStyle` always return a `fontWeight` now (20/30→700 · 40–55→500 · 60→600 · 70→700 · 80→800);
   4 sites that set weight *before* the spread get overridden (PitchingTab:195, FortyManSubTab:147, FieldingTab:248/251).
5. `S.th` no longer uppercase/letter-spaced (Archivo Narrow 12 px 600 on the panel-2 strip); `S.td` cream on 29 px rows;
   `S.table` is `border-collapse: separate`.
6. `S.pillBtn` radius 20 → 3; the 35 call sites that override with old hexes keep the old colours until migrated.
7. Fonts: Archivo + Archivo Narrow replace system-ui / JetBrains Mono; `index.html` needs the Google Fonts `<link>`.
Not breaking but note: `gradeToColor` returns a hex (was `rgb(...)`); `devPctColor`/`scoutingRatingColor` bands now
map onto ramp stops; pre-existing bug `CompactPlayerRow.jsx:96` passes 0–100 into `devPctColor` (expects 0–1).

## Batches (each leaves the app shippable; sizes from the inventory; ~2,100 lines, ~59 h total)
| # | Scope | Size | Gate |
|---|---|---|---|
| 0 ✅ | **Foundation (landed 2026-08-23)** — `theme.js` ← the candidate; `tokens.css` + generator; `index.html` fonts + body; `App.jsx` loader | ~220 lines · 6 h | no slate hex in `theme.js`; no `JetBrains`/`145deg` anywhere; fonts load; all 12 pages + modal render; `contrast.mjs` agrees with `CHECKS.md` |
| 1 | **Shell + primitives** — `Dashboard.jsx` sidebar (paper panel, league/team/date block, red-tick active, Settings pinned, collapse kept), `shared.jsx` (Section → box + header strip with state/actions slot; Toggle ruled row; PillBtn/TabGroup; SortHeader sticky + pencil underline; inputs/selects as sunken wells; Pagination strip), `LeagueSettingsModal` | ~260 lines · 8 h | FA Finder matches the mockup side by side at 1440; 1440 no-scroll on FA/Players/Waivers; keyboard nav intact |
| 2 | **Boards** — FreeAgentFinder, WaiverWireView, DraftBoard, IAFABoard, Rule5Board, ScoutView, PlayersView (+ `group` fields on column defs in `constants.js`), ProspectsView, PlayerCompareView: hex sweep, column-group rules, filter bars inside the box header strip, tier pills, level chips, NEED tint | ~420 lines · 14 h | 0 hex/rgba in the 9 files; `FV_TIER_COLORS[` only inside `tierChip`; 1440 no-scroll on all 9 (Draft with every optional column on = widest, 15 cols) |
| 3 | **Org** — OrgView, OverviewSubTab, ActiveRosterSubTab (SVG diamond fills/strokes → tokens, chips), FortyManSubTab, OptimizedLineupSubTab, PositionalStrengthTable (bars + heat via `zHeat`) | ~150 lines · 5 h | 0 hex/rgba; no `fill="#"`/`stroke="#"` in the diamond; heat only from `zToColor`/`zHeat` |
| 4 | **Player Profile** — modal (centred 960 px box, header bar, tab strip), PercentileHeader/Bar (→ Savant pill), FVProjectionChart, 5 tabs, `_shared.js` tiles; remove dead `EligiblePositionsTable` | ~260 lines · 8 h | 0 hex incl. 8-digit and `${x}22` template suffixes; no `boxShadow` |
| 5 | **Roster Planner** — RosterPlanner, `_shared.js`, CompactPlayerRow, Panels, DepthChartPanels, QueuePanels, MlfaSection, SuggestionsPanel, MovesLogPanel, Rule5RiskPanel, SuperTwoDetailModal | ~260 lines · 8 h | 0 hex; no `monospace`; drag/drop states (overlay, `isOver`, invalid) and crunch severities reviewed |
| 6 | **Dev Analysis + charts** — DevAnalysisView, DevScatterChart, GapDistributionChart, WarPercentileChart, CurveTuningPanel, FVImpactTable, LiveProspectPreview, BandwidthControl (+ ProspectsView chart, FVProjectionChart re-check) | ~190 lines · 6 h | 0 hex incl. `#fff`; axes/grids/tooltips on `CHART` tokens; no `linear-gradient` left in `app/src` |
| 7 | **Prototype CSS + docs** — `prototype.css` ← `prototype.next.css`; `app/CLAUDE.md` styling lines; `FRONTEND_REFERENCE.md` colour notes; `lavish-prototype` sample | ~350 lines CSS · 4 h | 0 tells in `prototype.css`; generator diff empty; docs no longer say "monospace" |

The cumulative all-`src` greps (palette tells, the 17 rgba families, 8-digit/`#fff`/template-suffix hexes, fonts /
gradients / blur / non-inset shadows, uppercase / tracking / radii, and "only `theme.js` holds hex literals") are in
`MIGRATION_INVENTORY.md` §C and must print 0 once batch 6 lands; each batch's own subset must print 0 immediately.
Manual gates per batch: `document.documentElement.scrollWidth === 1440` at 1440 × 1000 on every board touched;
smallest font ≥ 11 px; tier pills the only 10 px radius; the 145° gradient never visible (including the loading screen).

## Rollout
- One branch per batch off `claude/ootp-dashboard-redesign-4cb921`, merged in order (0–1 first so every later batch is
  reviewed against the real shell). Screenshots before/after at 1440 × 1000 under `app/docs/redesign/shots/` (not
  committed if large).
- Reviewer checks `git diff --stat` stays inside style code; no accessor or data changes in these PRs.

## Decisions needed from you before batch 1–2 (inventory §D, condensed)
1. **Collapsed sidebar + emoji page icons** are not in the mockup. Proposal: keep the collapse (rail shows icons), hide
   icons when expanded. (D.17)
2. **"My picks" vs "needs" on the Draft Board** both land in the pencil family (row tint `accentBg2`, ★/DRAFTED
   `accent`) — acceptable, but they look alike; say if drafted rows should take a different family (e.g. `good`). (D.2)
3. **Waiver freshness strip** — fold into the Needs box header-strip state slot, or keep as its own small box? (D.1)
4. **MiLB contract status** has no token (`#f472b6` pink today): `CHART.series6` tan or `text3`? Same for the
   Super-Two / MiLB-FA violet family → `CHART.series5`. (D.5)
5. **`textDisabled` (2.9:1) is used for real values today** (rank indices, tile labels, captions); the inventory
   sends those to `text3` (4.8:1) and keeps `textDisabled` only for true "—"/null/disabled. Confirm. (D.15)
6. **Accepted contrast exception:** z-heat text at |z| 1.8–2.0 ≈ 4.1:1 (AA-large), four cells in
   PositionalStrengthTable / FortyMan strips only. (D.16, `CHECKS.md` §4)
Everything else in §D (sign difficulty, intangibles H/N/L, hover colours set via JS, dead code, chart band contrast,
`zToColor` dead import) has a proposed token and needs no decision.

## Batch 0 — landed 2026-08-23 (uncommitted on `claude/ootp-dashboard-redesign-4cb921`)
Files: `app/src/theme.js` (rewritten), `app/src/tokens.css` (new, generated), `app/src/main.jsx` (imports tokens.css),
`app/index.html` (Archivo + Archivo Narrow link, flat `#141516` body), `app/src/App.jsx` (error boundary + loader on
tokens). Minimal extra edits so the app stays shippable after the swap: `ProspectsView.jsx` six `FV_TIER_COLORS` sites
→ `.bg`/`.text` (filled pills), `PositionalStrengthTable.jsx` score/rank text on the row ground → `zHeat(z).bar`,
`Dashboard.jsx:226` root → `TOKENS.bg` / `TOKENS.fonts.ui` / `TOKENS.text` (removes the 145° gradient and JetBrains
Mono app-wide; the sidebar itself is still batch 1), `LeagueSettingsModal.jsx:55` / `SuperTwoDetailModal.jsx:72` /
`CurveTuningPanel.jsx:148` `fontFamily` → `inherit`. `CHANGELOG.md` Unreleased entry added.
Gates: `vite build` OK; slate hexes in `theme.js` = 0 (one appears inside the breaking-change comment only);
`JetBrains|145deg|monospace` in `app/src` = 0 outside the tokens.css header comment; all 12 pages + the player modal
render on BLM-ATL with no console errors and `document.documentElement.scrollWidth` = 1440 at 1440 × 1000;
`contrast.mjs` output unchanged from `CHECKS.md`; Archivo webfont confirmed loaded (`document.fonts.check`). Archivo
Narrow is linked but not yet requested by any rendered element (first consumer is batch 1's `S.th`/`SortHeader`).
Note: `theme.next.js` was retired into `app/src/theme.js`; the generator and `contrast.mjs` now import `../../src/theme.js`.
