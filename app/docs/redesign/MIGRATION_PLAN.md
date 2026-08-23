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

## Batch 1 — landed 2026-08-23 (uncommitted on `claude/ootp-dashboard-redesign-4cb921`)
Files: `app/src/components/shared.jsx`, `app/src/components/Dashboard.jsx` (sidebar `<nav>` + main padding + the
`PAGE_FALLBACK` colour), `app/src/components/LeagueSettingsModal.jsx`. No caller, accessor, prop, export, aria role/label,
localStorage key or callback changed; every colour now comes from `TOKENS` / `S`.
- **shared.jsx.** `Section` → scorecard box (`S.box` + `S.boxHead` strip, title Archivo Narrow 700 13.5, optional
  `count` `text3`, right-side `state` `text3` 12px + `actions`, optional `toolbar` strip `S.toolbar`, body padding 12,
  optional `footer` `S.boxFoot`) — `count`/`state`/`toolbar`/`footer` are new and unused until batch 2. `SortHeader` =
  `S.th` + `S.thSorted` (inset red underline) when sorted, hover → `text`; sticky kept as-is (D.10 deferred: no
  maxHeight/overflowY on `S.tableWrap`). `PillBtn` active = `accentBg`/`accent`/`accent` border, inactive
  `panel`/`line2`/`text2`, r3, Archivo Narrow 600 13. `TabGroup` = `panel2` strip (`line2` rule, r3, padding 3); callers'
  `style` still wins. `MultiSelectDropdown` / `NumericRangeFilter` triggers = raised `S.filterSelect` controls (open or
  keyboard focus → `focus` border; ring only on keyboard focus via a `:focus-visible` check; has-value text `accent`,
  count chip `accentBg`/`accent`); popovers opaque `panel` + `line2` + r3, no shadow, headings 12px Archivo Narrow
  sentence case, "Clear all"/"Clear" links `accent`, option rows hover `panel3`, checked `accentBg` + `text`, checkbox
  `accentColor: accent`; range inputs are sunken wells (`S.searchInput` basis, focus `focus` border + ring). New exports
  `SearchInput` / `searchWellStyle` (well + inline magnifier SVG drawn in `text3`, paddingLeft 26) for batch 2 — the
  FA search box still uses `S.searchInput` until its caller moves. `Toggle` gains `variant` (`"inline"` default,
  `"row"` = 8/12 padding, `line` top rule, hover `panel2`); switch 30×17 (`bg` well + `line2` ring + `text3` knob; on =
  `accent` + `accentText` knob); the switch is now `role="switch"` `aria-checked`, tabbable, Space/Enter toggles, focus
  ring `focus` (additive a11y — it was mouse-only before). `Pagination` = foot strip (`panel2`, `borderTop line2`,
  8/12, Archivo Narrow 12.5 `text2`, ‹ Prev / Next › `S.pageBtn`, disabled `textDisabled`/`line`); in this batch it
  still sits inside the padded Section body, under the bordered `S.tableWrap`. `TwoWayBadge` = outlined `warn` chip r3
  Archivo Narrow 700 10px. `FileDropZone` ready `good`/`goodBg`, dragover `accent`/`accentBg2`, idle `S.dropZone`
  (`bg` well, dashed `line2`); `DataLoader` wordmark `text` 800 −0.04em + "GM Dashboard" Archivo Narrow `text3` (no
  uppercase / tracking).
- **Dashboard.jsx.** Sidebar = 200px `panel` column, `line2` right rule, sticky 100vh; brand row (league name Archivo
  800 22px −0.04em + "GM Dashboard" `text3` Archivo Narrow 12) with the collapse glyph `text3`; League / My Team /
  Game Date in one bordered `panel2` block (`line` rule, r3) with 11px Archivo Narrow 600 `text3` labels and borderless
  underlined (`line2`) value rows; page rows Archivo Narrow 14 `text2` 500, active `text` 700 + the red ✓ tick
  (absolutely positioned 5×10 rotated-border `<span>`, `accent`), hover `panel2`; Settings row `text3` 13px under a
  `line` rule, pinned (the tablist keeps `flex: 1`). Collapsed rail kept at 52px: emoji icons only, active = 2px
  `accent` left border; expanded hides the icons (D.17 decision applied). Main column padding `18px 24px 48px`
  (maxWidth 1400 / overflowX hidden unchanged). `PAGE_FALLBACK` "Loading…" `#64748b` → `TOKENS.text3` (outside the
  nav block, but required by the 0-hex gate).
- **LeagueSettingsModal.jsx.** Scrim `TOKENS.scrim` kept, `backdropFilter` removed; box 520 = `S.box` (`panel`/`line2`/r3)
  with an `S.boxHead` header strip (title + ✕ `text3`), scrolling body, footer strip (`panel2`, `line2` top rule) with
  Cancel `S.btn` / Save `S.btn + S.btnPrimary`; labels 12px Archivo Narrow 600 `text2` sentence case; inputs = wells
  (`S.searchInput`, focus `focus` border + ring via onFocus/onBlur); help text 11px `text3`; team chips r3 outlined
  (`goodBg`/`good` forced-include, `badBg`/`bad` + `badSoft` text excluded, "(auto)" `text3`); draft-demands checkbox
  `accentColor: accent`.
Gates (verified 2026-08-23): `vite build` OK; six-digit hexes in the three files = 0 / 0 / 0; `rgba(` = 0 / 0 / 0;
`boxShadow|linear-gradient|backdropFilter` → only the inset sort underline (`S.thSorted`, theme.js) and the focus ring
(`shared.jsx` focusStyle / trigger / switch, `LeagueSettingsModal.jsx` onWellFocus); `borderRadius: 8|10|12|20` = 0;
`textTransform` = 0. Browser at 1440 × 1000 (BLM-ATL): `document.documentElement.scrollWidth` = 1440 on Free Agent
Finder, All Players and Waiver Wire; sidebar expanded (200px) and collapsed (52px) both render; position MultiSelect
and Age range popovers open/close (Escape, outside click), selections and Clear work; League Settings opens/closes; Tab
order runs collapse → League → My Team → Game Date → 12 page tabs → Settings → 4 switches → position filter, the
switch toggles on Space/Enter; no console errors from the current modules (one React shorthand/longhand `border`
warning appeared during development and was fixed by writing `border` instead of `borderColor` in the focus style).
Archivo Narrow confirmed loaded (`document.fonts.check`).
Deferred / notes: D.10 sticky headers unchanged (no-op inside the overflowX wrapper); the board filter bars, the
Pagination foot strip flush with the box, the `Section` `count`/`state`/`toolbar`/`footer` slots, `Toggle
variant="row"` and `SearchInput` wait for their callers in batch 2; the FA "Free Agent Board (2649)" count still lives in
the title string until batch 2 passes `count`; `S.pillBtnActive` (theme.js, `text` ink) is not used — `PillBtn` follows
the brief (`accent` text) instead.

## Batch 2 — `DraftBoard.jsx` + `ProspectsView.jsx` landed 2026-08-23 (uncommitted on `claude/ootp-dashboard-redesign-4cb921`)
Files: `app/src/components/DraftBoard.jsx`, `app/src/components/ProspectsView.jsx`. No accessor, sort, filter, pagination,
localStorage key, callback or prop changed; only render/style code plus the column defs lifted into `cols` arrays.
- **DraftBoard.jsx.** `zToColor` dead import removed; `devPctColor` → `devPctStyle`; `TOKENS as T` imported. `STEP_BTN`
  = `panel3` / `line2` / `text` r3 Archivo Narrow. Draft Class box: caption → `footer`. StatsPlus Draft Feed: Refresh =
  `S.btn + S.btnPrimary`, Paste CSV `S.btn`, Clear `S.btn` outlined `bad`; "Updated …" → `state`; the Drafted / Available /
  My picks counters → `footer`; textarea = `bg` well / `line2` / r3. Draft Settings: the clickable-title chevron became a
  header `actions` Show ▾ / Hide ▴ `S.btn`; "Demands on/off · $X of $Y remaining" → `state`; the mirror note → `footer`;
  checkbox `accentColor: accent`; budget `$` `warn`; budget bar = `good` / `warn` / `bad` fill on a `panel3` r3 track.
  My Draft Class: `count="(N picks)"`; upcoming-pick card = `panel` + dashed `line2` r3 at 70 % (labels `text3`, overall
  `textDisabled`); drafted card `panel2`/`line`; manual pick `accentBg2`/`line2` with ✕ `bad`; labels `text3`, values `text`,
  Demand `$` `warn` ("—" `textDisabled`), Sign `signColor`. Position Caps: "Total picks" label `text2`, Reset `S.btn`,
  Edit = `S.btn` (+ `S.pillBtnActive` when on), auto-detected note → `footer`; legend row Archivo Narrow 11 `text3`
  ("min" `accent`, "hard" `text2`); both editor panels `accentBg2` / `line2` r3 `text2` with `accent` min-coverage label
  and small `S.btn` Resets; rows: parent `panel3` r3, labels `text` Archivo Narrow, count ladder unmet `bad` · zero `text3`
  · open `good` · over `bad` · overage `warn` · ok `good`; min `accent` / `textDisabled`; "No max" Archivo Narrow `text2`
  (no tracking); meter = `good`/`warn`/`bad` fill on a `panel3` r3 track with the soft-cap tick `text2`; ∞ / ＋ `accent` /
  `text3`; "—" `textDisabled`. Smart Rank Adjustments: seven `Toggle variant="row"` in a `margin: -13px -12px -12px`
  column (no body padding), `state="N of 7 on"`. Draft Board: `count` = displayed row count, `state` = "Sorted by …",
  Export Top 500 → header `actions` `S.btn`, PositionFilter + `SearchInput` → `toolbar`; `cols` array with groups
  pick(+, Smart/WAR P) | identity(Name, Age) | development(Dev%) | position(POS, Best) | raw | contract(DEM, Sign) |
  health(Prone, INTG, INT, WE, LEA) (§B.3 item 4) — `colRule` spread into th (SortHeader `rule`) and every td via a
  per-key `cell` map that also carries the 12px first/last padding; table edge-to-edge (`S.tableWrap` margin −12, no
  border) with the `Pagination` foot strip flush (`margin: 0 -12px -12px`); zebra `S.zebraRow`; manual-pick row
  `accentBg2` + ★ `accent` + outlined "DRAFTED" chip on `S.badge` (`accent`); "+" = outlined `S.badge` `line2`/`text3`;
  numbers right-aligned tabular; POS/Best Archivo Narrow 600 `posColor`; name `S.tdName`; Dev% `devPctStyle`; DEM
  `warn`; Sign `signColor`; INT/WE/LEA `intangibleColor` 600; "—" `textDisabled`; empty-state `text3`.
- **ProspectsView.jsx.** `levelColor`/`devPctColor` → `levelChip`/`devPctStyle`; `tierChip` + `colRule` + `SearchInput`
  imported. Local mappers `tierPill(id)` (= `S.tierPill` + `tierChip` bg/text, r10) and `levelBadge(lev)` (= `S.badge` +
  `levelChip` bg/text/border, dashed INT) because the theme chip helpers return `{bg,text,border}` keys, not CSS; shared
  `cellStyles(cols)` / `edgeWrap` / `footWrap` / `numCell` / `posCell` consts. Prospect Board Configuration: Show/Hide
  Config `S.btn`, Suggest Thresholds `S.btn + S.btnPrimary`, Reset $ Defaults `S.btn`; `state` = "N tiers · M prospects";
  "N total prospects across M teams" → `footer` (only while open); config table edge-to-edge with groups tier |
  thresholds | money(Bat $M, Pit $M) | counts | ranges (§B.3 item 8), unsortable `S.th` + rule, tier → `tierPill`,
  inputs = 24px `S.searchInput` wells, Count `text`/`textDisabled`, H `CHART.series1`, P `CHART.series3`, Cum `text3`,
  FV range `text3` (real value — D.15), MLB ≥ FV `text2`; closed state shows a one-line `text2` hint. The Board:
  `count` = displayed row count, `state` = "Sorted by …", the two filter rows → one wrapping `toolbar` (PositionFilter ·
  Teams · LevelFilter · Tiers · `SearchInput`); groups rank(Rank, Org, FV Tier) | identity | development | position(POS,
  Best, Team, Lvl) | value(FV, WAR, WAR P) | contract($ Val); tier → `tierPill`, Lvl → `levelBadge`, Dev% `devPctStyle`,
  $ Val `warn`, rank `text` 700, org rank `text3`, zebra `S.zebraRow`, edge-to-edge table + flush `Pagination`. Farm
  Rankings: `count="(30)"`, `state`, `footer` hint; groups identity(#, Team) | value(Value, #P, Avg) | tiers(11 counts) |
  scouting(Ceil, Floor, Bat, Pit) | report; team link `accent` (dashed underline kept), Value `warn` 700, Avg `text2`,
  tier counts keep `FV_TIER_COLORS[id].bg` text / `textDisabled` zero, report `text2` 12px wrapping (row grows past 29px
  — kept). Farm System Values: grid `CHART.grid`, ticks + label `CHART.axis`, tooltip `CHART.tooltipBg/Border/Text` r3
  with a `tierPill`, `$` `warn`, counts `text3`, rows `text2`/`text`; bar cursor `panel3`; legend → `footer` with r3
  swatches and `text2` labels.
Gates (verified 2026-08-23): `vite build` OK; `#hex|rgba(` = 0 / 0; `borderRadius 8|10|12|20 | textTransform |
letterSpacing | monospace | boxShadow` = 0 / 0 (tier pills take r10 from `S.tierPill`). Browser at 1440 × 1000 (BLM-ATL):
Draft Board with every Smart Rank toggle on + Draft Demands on with a budget (DEM + Sign columns) + Edit caps open →
`document.documentElement.scrollWidth` = 1440 and the table wrapper's scrollWidth = clientWidth = 1190 (no internal
scroll either); Prospects Board tab (config open) = 1440; Farm Rankings tab = 1440; no console errors. Checked via DOM
inspection: column-group rules land on Name / Dev% / POS / Raw / DEM / Prone (Draft), Name / Dev% / POS / FV / $ Val
(Board), FV ≥ / Bat $M / Count / FV Range (config), Value / 80 / Ceil / Report (Farm); zebra `#1e1f22` on odd rows;
a manual pick renders the `accentBg2` row + `accent` ★ + outlined DRAFTED chip and the `accentBg2`/`line2` card; tier
pill `#80acf0` / ink r10; AAA level chip `#bdb8ad` / ink / `line2` ring; position popover opens (`panel`).
Deviations / notes: (1) screenshots could not be taken in this session (the shared browser pane was not displayed, so
the page did not composite frames and `requestAnimationFrame` never fired) — all visual checks above are computed-style
reads, and the Recharts bars (animated on mount) could not be confirmed drawn for the same reason; re-screenshot when the
pane is visible. (2) The config table's FV-range values and the tooltip's count/FV use `text3` per D.15 rather than the
`textDisabled` listed in §A.2 (they are real values, not placeholders). (3) The Draft Settings collapsed body and the
StatsPlus feed body now show a one-line `text2` hint instead of the old summary (the summary moved to `state`/`footer`).
(4) The Farm "Scouting Report" cell wraps, so those rows exceed 29px (pre-existing behaviour kept). (5) `NumInput` was
already an unused import in ProspectsView and is left as found.

## Batch 2 — PlayersView / ScoutView / PlayerCompareView (+ constants.js `group` fields) landed
Verified 2026-08-23 against the dev server at 1440 × 1000, league BLM-ATL. Uncommitted on `claude/ootp-dashboard-redesign-4cb921`.
- **utils/constants.js.** `PLAYERS_HIT_COLS` / `PLAYERS_PIT_COLS` / `PLAYERS_MIXED_COLS` gain `group` per §B.3 item 1
  (identity: Name Age POS Best Team Lvl · value: FV + the WAR columns · development: Dev% [+ STM, SP?] · health: Prone INTG ·
  contract: Salary). No other change in the file.
- **PlayersView.jsx.** The page is now one scorecard box ("All Players", `count` = filtered total, `state` = the Best Pos
  breakdown while any filter is on, else "Sorted by <col>, <dir>"); both filter rows collapse into the `toolbar` slot
  (PositionFilter · Teams · Levels · Prone · 40-Man · `SearchInput` · Age range · "FA only" `Toggle` pushed right — the old
  checkbox became the inline switch, same state). Table edge-to-edge (`S.tableWrap` border/radius removed, `margin:-12`),
  `SortHeader rule={colRule}` + `align="right"` for numeric columns, the key-switch wrapper spreads `colRule` + right-align into
  every td; zebra `S.zebraRow`; Name `S.tdName`; POS/Best `posColor` Archivo Narrow 600; Lvl → `levelChip` on `S.badge` ("-"
  → `textDisabled` "—"); Team cell IAFA `CHART.series5` / draft-year `warn` / FA `text3` / team `text`; Dev% `devPctColor`;
  matured / null → `textDisabled`; Age, Salary, generic numerics `text2`. `Pagination` is the foot strip inside the box.
- **ScoutView.jsx.** Page grid: a top row `minmax(0,2fr) | minmax(300px,1fr)` = "Positional Strength Comparison" (two
  compact `PositionalStrengthTable`s side by side, untouched component; the scout-team `<select>` moved into the box toolbar
  with the Now/Farm `PillBtn`s pushed right; `state` names the pool) | "Smart Rank Adjustments" (`Toggle variant="row"` ×4 in a
  `margin:-12` wrapper, `state` = "n of 4 on"); the old "Scout Team" box (a bare select) is gone. Trade-opportunity callout =
  `goodBg` / `good` border r3. "Trade Targets" box: `count`, `state` "Sorted by Fit/Smart", the caption as `footer`; columns
  lifted into `TRADE_TARGET_COLS(fitLabel)` with groups (§B.3 item 7), unsortable `S.th` + `colRule`. Roster box: title
  "<team> Roster" + `count`, toolbar = PositionFilter · LevelFilter · a `goodBg` legend for trade-fit rows; columns lifted into
  `ROSTER_COLS(fitLabel)` with groups; trade-fit rows `goodBg` (D.7), else zebra; Lvl `levelChip`; matured/null `textDisabled`;
  foot-strip `Pagination`. Sorting/filtering/pool code untouched.
- **PlayerCompareView.jsx.** "Player Compare" box: `count` "(n/5)", "Clear all" → `S.btn` in `actions` (was a pill in the
  chip row), `SearchInput` (the unused `searchRef` is no longer attached — `SearchInput` does not forward refs); the results
  list is now **in-flow** under the input (`panel`/`line2`/r3, hover `panel3`) because `S.box` clips overflow and the old
  absolute popover was cut at the box edge; chips `accentBg2`/`line2` r3, ✕ `bad`. "Comparison" box: table edge-to-edge; one
  group rule between the Stat column and the first player (`cmpCols` label | players, §B.3 item 9); group-header rows `panel2`
  Archivo Narrow 600 12px sentence case (uppercase/letterSpacing removed); best `good` 700 / worst `bad` / other `text2`;
  "—" `textDisabled`; Level row → `levelChip`; intangibles H/N/L `intangibleColor` 600. Stat definitions/accessors unchanged
  (only the colour literals inside them moved to tokens, plus a `chip` field on Level and `weight` on the H/N/L rows).
- Shared note: `levelChip()` returns `{bg,text,border}` (not CSS keys) — each file maps it with a local `chipCss()` helper
  before spreading onto `S.badge`.
Gates: `vite build` OK; six-digit hexes / `rgba(` = 0 / 0 / 0 / 0 (PlayersView, ScoutView, PlayerCompareView, constants);
`borderRadius 8|10|12|20` / `textTransform` / `letterSpacing` / `monospace` / `boxShadow` = 0 in all four.
`document.documentElement.scrollWidth` at 1440 × 1000: All Players 1440 (mixed and hitter column sets, position popover
open), Scout View 1440, Player Compare 1440 (3 players). Console: no errors. Group rules verified via computed
`borderLeft` on th + td (All Players: FV, Dev%, Prone, Salary; Compare: first player column); zebra on odd rows; 33 of 50
roster rows tinted `goodBg` for Arizona's weak positions.
Deviations / notes: the All Players toolbar wraps to two rows at 1440 (8 controls; `flexWrap` by design). Scout's standalone
"Scout Team" box was folded into the comparison box's toolbar and Smart Rank moved beside it (top-row grid) — the only
layout change. The Smart Rank box shows a `line` rule above its first row (Toggle row variant always draws one) directly
under the head's `line2` rule. The Compare search results are an in-flow list rather than a floating popover (see above).
No NEED tags on these boards: none of the three has a per-row "below-average position" semantic except Scout's trade-fit,
which the inventory maps to `goodBg`.

## Batch 2 — FreeAgentFinder, WaiverWireView, Rule5Board, IAFABoard landed 2026-08-23 (uncommitted)
Files: `app/src/components/FreeAgentFinder.jsx`, `WaiverWireView.jsx`, `Rule5Board.jsx`, `IAFABoard.jsx`. No accessor,
sort/filter/pagination, pool, localStorage or callback line changed; every colour comes from `TOKENS` / `S` / the theme
helpers. Shared per-file grammar (a small local helper block in each file — shared.jsx was off limits): columns lifted into a
`cols` array with `group` (+ `align` for numeric columns) per inventory §B.3; `colRule(cols,i)` spread into every th (via
`SortHeader rule=`) and td; first/last cells carry the 12px box padding (written as the full `padding` shorthand so a column
that shifts when the Smart column appears never mixes shorthand/longhand across renders — React 18 warns on that); zebra
`S.zebraRow` on odd rows; NEED rows `S.needRow` (`accentBg2Even` on a zebra stripe) + `S.needTag` `<i>NEED</i>` in the POS
cell; POS/Best `posColor` Archivo Narrow 600 13px; WAR/FV `warStyle`; Dev% `devPctStyle`; Prone `proneColor` + the `PRONE`
weight; "—"/null `textDisabled`; captions `text3` as `Section footer`; table + `Pagination` inside one `margin:-12` wrapper
(tableWrap `border:none`, r0) so the foot strip sits flush with the box; page/grid gap 20 → 16 (mockup `.panel` spacing).
Smart Rank boxes = `Toggle variant="row"` ×4 in a `margin:"-13px -12px -12px"` wrapper (the −13 lets the first row's `line`
rule sit on the head's `line2` rule instead of doubling it), `state` = "n of 4 on".
- **FreeAgentFinder.jsx** (reference page). Top row: "Team Positional Needs" (`state` "z vs league · now", caption → `footer`,
  `PositionalStrengthTable` untouched) | "Smart Rank Adjustments". Board: title "Free Agent Board" + `count` "(2,649)",
  `state` "Sorted by <col>, <dir>", toolbar = PositionFilter · `SearchInput` · Age · Pro Yrs · "Gap fills only" inline
  Toggle pushed right (`marginLeft:auto` wrapper); groups [Smart] | Name Age POS Best | FV WAR WAR P | Dev% Pro Yrs | Prone |
  Salary (4 rules); Pro Yrs / Salary `text2` (inventory A.2), old red 9px NEED → `S.needTag`; empty row `text3`.
- **WaiverWireView.jsx.** D.1 freshness strip folded into header `state` slots (no standalone box): the claim board's
  `state` = "StatsPlus live · fetched <date> · league date <date> · <n> at a position you're below average in" (status
  `good` 700 / "CSV export only" `warn` 700, count `bad` 700); the Needs box `state` = "40-man: used/limit — n open | full"
  (`bad` when full); no-live mode adds a board `footer` "No StatsPlus URL configured — … org.csv export". Board title split
  into title + `count` ("Claimable Now (4)" / "On Waivers — last CSV export (n)"); toolbar (PositionFilter · SearchInput)
  on the first box only (§B.4). `WaiverTable` restyled once for all three boxes: groups Smart/WAR P | Name Age POS Best From
  Lvl | Left | FV WAR WAR P | Dev% | Salary Yrs Opt | Prone (6 rules); Lvl → `levelChip` badge; YOURS → outlined
  `line2`/`text2` r3 Archivo Narrow 700 10px; claim clock ladder null `textDisabled` · 0 "cleared" `text3` · ≤1d `bad` 700 ·
  else `text`; From `text`. Cleared / stale boxes: `count`, caption as an `S.boxSub` line above the table (mockup
  `.panel-sub`), `<code>` → `<span>` `text` 600 (D.11).
- **Rule5Board.jsx.** Tab pills wrapped in `TabGroup` (panel2 strip; the old `line`-rule row is gone); Suspense fallback
  `text3`. Needs box (`state`, caption → `footer`) | Smart Rank. Board "Rule 5 Board" + `count` (pool size, as before) +
  sort `state`; toolbar PositionFilter · SearchInput; groups Smart/WAR P | Name Age | Dev% | POS Best Team Lvl | FV WAR WAR P
  | Prone [Raw] B/T (5 rules); Lvl `levelChip`; the `_baseVal_raw` → `_baseVal` sort mapping kept verbatim.
- **IAFABoard.jsx.** Smart Rank box = 2 × 2 grid of `Toggle variant="row"` with a `line` rule between the columns (keeps
  the page short; no Needs box on this page). Board "IAFA Board" + `count` + sort `state`; toolbar PositionFilter ·
  SearchInput · Hide-signed `PillBtn` · "Clear signed (n)" as an `accent` Archivo Narrow link; groups Signed Smart/WAR P |
  Name Age | Dev% | POS Best | [Raw] | Prone INTG WE INT | DEM (6 rules); Signed = unsortable `S.th` + checkbox
  `accentColor: accent`; signed rows keep `opacity .5` (A.2); DEM `warn`; WE/INT `intangibleColor` 600 (D.4); INTG `gradeStyle`.
Gates (verified 2026-08-23): `vite build` OK; six-digit hex / `rgba(` = 0 / 0 / 0 / 0; `borderRadius 8|10|12|20` /
`textTransform` / `letterSpacing` / `monospace` / `boxShadow` = 0 in all four; `group:` on every column (12 / 16 / 14 / 13
column defs). Browser 1440 × 1000, BLM-ATL (Arizona): `document.documentElement.scrollWidth` = 1440 on Free Agent Finder
(Smart on = 12 cols), Waiver Wire (Smart on, two boxes × 16 cols), Rule 5 Board (Smart on = 14 cols incl. Raw), IAFA Board
(Smart on = 13 cols incl. Raw); every board table also fits its wrapper (`scrollWidth − clientWidth` = 0, i.e. no inner
horizontal scroll). Computed-style audit: group rules on FV/Dev%/Prone/Salary (FA), zebra `#1e1f22`, NEED `#2a2223` /
even `#282223`, sorted th inset `accent` underline, Archivo Narrow loaded, level chips filled (AAA `#bdb8ad` ink text).
Position and Age popovers open/close (Escape); Smart toggles, sorting, signed tick (reverted afterwards) exercised; console
clean after the shorthand-padding fix (the first pass logged React's "Removing paddingLeft when padding is set" warning on
Smart-column toggles — gone).
Deviations / notes:
- **`S.box` `overflow:hidden` clips toolbar popovers on short boxes** (theme.js / shared.jsx, not in this slice): on the
  Waiver claim board (4 rows) the position popover bottom is at 832px vs the box bottom at 649px and is cut off. Any board
  with few rows (or an empty result) hits it. One-line fix for the theme owner: drop `overflow:"hidden"` from `S.box` (round
  the head strip's top corners instead).
- **`levelChip()` must be mapped, not spread:** it returns `{bg,text,border,borderStyle?}` (theme keys) — the brief's
  `{ ...S.badge, ...levelChip(lev) }` example renders plain text (and `border: "#bdb8ad"` kills the ring). Waiver/R5 use a
  local `levelBadge(lev)` → `{ ...S.badge, background, color, border: "1px solid|dashed <border>" }`.
- Smart Rank toggles do not stretch to fill the box height (mockup `.toggles .toggle{flex:1}`) — `Section`'s body is a
  padded div, not a flex column; a shared.jsx change.
- POS/Best text is Archivo Narrow **600** (brief) where the mockup `td[data-pos]` uses 700.
- Not exercised on BLM-ATL: the no-live "CSV export only" board + footer, the stale-export third box, the YOURS chip (no
  Arizona player on the wire), an empty board's "No … found" row.
- Page-level gap 20 → 16 (mockup) on all four pages; sibling boards may still use 20.
