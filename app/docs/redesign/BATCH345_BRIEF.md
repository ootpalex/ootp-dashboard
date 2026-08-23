# Batches 3 · 4 · 5 brief — Org views, Player Profile, Roster Planner (Night Scorecard, graphite)

Repo worktree: /Users/alex/Projects/ootp/dashboard/ootp-dashboard/.claude/worktrees/ootp-dashboard-redesign-4cb921
Branch `claude/ootp-dashboard-redesign-4cb921`. Batches 0–2 are committed (theme.js foundation ac04c89, shell +
primitives df2cf22, boards 9a8b9ab). Three agents run in parallel on DISJOINT file sets (3 = Org, 4 = Player
Profile, 5 = Roster Planner). Edit ONLY your files. Do not touch theme.js, shared.jsx, Dashboard.jsx, constants.js
or any other batch's files. Do not commit.

## Sources of truth (read first) — same as batch 2
1. `app/src/theme.js` — `TOKENS` (T.*), encoding helpers (`gradeStyle/warStyle/waaStyle/gradeToColor`, `posColor/
   posChip`, `levelColor/levelChip`, `tierChip/FV_TIER_COLORS`, `zHeat/zToColor`, `proneColor`, `devPctStyle/
   devPctColor`, `intangibleColor`, `signColor`, `T.CHART.*`), restyled `S` (S.box/boxHead/boxFoot/toolbar, S.th/
   thSorted/td/tdName/groupRule/zebraRow/needRow/needTag/tableWrap/table, S.badge/tierPill/zCell, S.pillBtn/btn/
   btnPrimary/pageBtn, S.searchInput/filterSelect, S.section…). USE THESE. Gate: zero six-digit hex and zero
   `rgba(`/`rgb(` literals in your files (the scrim is `T.scrim`).
2. `app/src/components/shared.jsx` — `Section({title,count,state,actions,toolbar,footer})` (scorecard box),
   `SortHeader({…, rule, align})`, `colRule(cols,i)`, `SearchInput`, `Toggle({variant:"inline"|"row"})`, `PillBtn`,
   `TabGroup`, `Pagination`, `TwoWayBadge`, `MultiSelectDropdown`/`PositionFilter`/`LevelFilter`/`NumericRangeFilter`.
   NOTE: `levelChip/posChip/tierChip` return `{bg, text, border}` (theme keys, not CSS) — map them:
   `const chipCss = (c) => ({ background: c.bg, color: c.text, border: "1px solid " + c.border });` and render
   `<span style={{ ...S.badge, ...chipCss(levelChip(lev)) }}>{lev}</span>` (tier pills: `S.tierPill` + `tierChip`).
3. `app/docs/redesign/mockup/night-scorecard.html` (the approved mockup) and `app/docs/redesign/mockup/
   scorecard-layout.report.md` (layout model incl. the player-modal framing). Batch-2 boards in `app/src/components/
   FreeAgentFinder.jsx` / `PlayersView.jsx` are finished examples of the table recipe — copy their patterns
   (edge-to-edge table wrapper, `cols` array with `group`, `colRule` on th/td, zebra, foot-strip Pagination).
4. `app/docs/redesign/MIGRATION_INVENTORY.md` — §A.2 per-file colour mapping (your files), §B.5 (PST), §B.8–B.11
   (modal, PercentileBar, Active Roster, Roster Planner), §D.5–D.9, D.12 (decisions below). `app/CLAUDE.md` —
   accessor rules; no data-access / logic / dnd-kit behaviour changes.

## Decisions already made (apply; do not re-open)
- FV in the Player Profile header stays a WAR-scale **number** via `warStyle` (no tier pill) — D.9.
- PercentileBar (B.9): current = filled pill whose width = percentile, fill = `gradeToColor(pctToGrade(pct))`,
  ink text (`T.bg`) inside when wide enough, track `T.panel3`; potential = 1px dashed outline pill to the
  potential percentile drawn underneath; label/value columns unchanged.
- Drag overlay (D.12): no shadow; `T.panel3` bg + 2px `T.accent` border as the lift cue. Popovers/modals: no shadow.
- Violet family (Super-Two, MiLB-FA, "potential", "Needs reps", options) → `T.CHART.series5` (12–15% fills over
  panel for chips); minors status → `T.CHART.series6`; contract status: signed `accent` · arb `warn` · pre-arb
  `goodSoft` · fa `text2` (D.5). R5 countdown 0 `bad`, >0 `warn`; NO-TRADE outlined `warn`; options OUT `bad`.
- Two-way → `TwoWayBadge`; injured name `warn` + "INJ" tag `bad`; modal badges 40-Man `accent`, R5 `bad`, INJ
  `warn`, Draft/IAFA `CHART.series5` — outlined chips on `S.badge` with a ~10% fill (D.6).
- `<code>` elements → `<span>` (font inherits; no monospace) — D.11.
- Row highlights (D.7): FortyMan starter rows `accentBg2`; FieldingTab/EligiblePositions best row `goodBg`.
- `levelColor()` is text-safe now; level COLUMNS use `levelChip`; depth lists / tiles that want text keep `levelColor`.
- Captions/footnotes/real values → `T.text3` (not `textDisabled`; that is only for "—"/null/disabled) — D.15.
- Chrome: radius 3 (tier pills 10 via S.tierPill); no shadows/gradients/blur; no uppercase+letterSpacing labels
  (Archivo Narrow 600 sentence case); no `fontFamily: "monospace"`; every box is a `Section` or `S.box` + `S.boxHead`.

## Batch 3 — Org (files: views/Org/OrgView.jsx, OverviewSubTab.jsx, ActiveRosterSubTab.jsx, FortyManSubTab.jsx,
## OptimizedLineupSubTab.jsx, PositionalStrengthTable.jsx)
- OrgView: sub-tabs as `PillBtn`s inside `TabGroup`; page header/context on tokens.
- PositionalStrengthTable (§B.5): `bar()` keeps the centre-zero geometry; track fill removed (centre tick `T.line2`,
  edge ticks `T.line`), fill = `zHeat(z).bar`, height 11, width `min(|z|/2.5,1)·48%`; score + rank cells become
  filled heat cells (`zHeat(z).bg` / `zHeat(z).text`, 600, right-aligned, padding 0 6px) — the dense variant too;
  header row 12px Archivo Narrow `text2` sentence case; age ≥ 31 `T.warn`; expanded depth panel `T.panel2`; every
  rgba literal gone. It is shared by Overview, FA Finder, Rule 5, Scout, Waiver — check all five after.
- OverviewSubTab: roster table recipe with groups (§B.3 item 10), `levelChip`; the strength box = `Section`.
- ActiveRosterSubTab (§B.10): SVG diamond fills/strokes → tokens (grass `T.goodBg`-class greens at 4–6% → use
  `T.goodBg`, dirt/mound `T.CHART.series6` at low alpha → derive via `mixOklab` from theme or use `T.panel3`,
  bases `T.text2`, plate `T.text`, lines `T.line`, mound `T.line2`); chips `panel`/`line2`/r3, hover border `text`,
  empty slot dashed `line2` on `bg`; POS label Archivo Narrow 700 `posColor`; injured name `warn` + INJ `bad`;
  section labels 12px Archivo Narrow sentence case; four groups inside one `Section`.
- FortyManSubTab: position column cards → `S.box` + `S.boxHead` (head strip bg = `zToColor(z).bg`, text
  `zToColor(z).value`), starter rows `accentBg2`, numbered starters `text3`, `levelColor` text in depth lists.
- OptimizedLineupSubTab: two lineup tables with groups (§B.3 item 11), `# | Name POS Best B/T | WAR DEF | OBP wOBA`.
Verify: Overview (strength table expanded on one row), Active Roster, 40-Man, Optimized Lineup; and the dense PST
on FA Finder / Scout View still renders and aligns. scrollWidth 1440 on all.

## Batch 4 — Player Profile (files: views/PlayerProfile/PlayerProfileModal.jsx, PercentileHeader.jsx,
## PercentileBar.jsx, FVProjectionChart.jsx, BattingTab.jsx, PitchingTab.jsx, FieldingTab.jsx, BaserunningTab.jsx,
## ContractTab.jsx, EligiblePositionsTable.jsx (delete if unused — confirm with grep), _shared.js)
- Modal (§B.8): scrim `T.scrim`; box `width 960`, `maxHeight 90vh`, `S.box`; ONE header strip (`S.boxHead`) with
  name (Archivo 800 20px) · `posChip` · `levelChip` · status badges (D.6) left, ✕ right (merge the old 36px close
  bar); header stat tiles → 8px-grid tiles `panel2`/`line`/r3 with 12px Archivo Narrow `text3` labels (FV/WAR values
  via `warStyle`); tab strip = `TabGroup` of `PillBtn`s in a `panel2` strip with the active tab carrying the
  sorted-underline (`S.thSorted` boxShadow) — or PillBtn active style; tab bodies' `tS/tL/sectionLabel` trio → one
  export in `_shared.js` (tiles `panel2`/`line`/r3; labels 12px Archivo Narrow `text3` sentence case; "POT" `goodSoft`).
- PercentileHeader/PercentileBar: per the decision above.
- FVProjectionChart: Recharts → `T.CHART.*` (grid/axis/tooltip/series; current `series1`, potential `series2`,
  band fills `T.CHART.bands.*`); tooltip `panel2`/`line2`/r3 no shadow; no `#fff`.
- FieldingTab eligibility table + ContractTab year table: table recipe with groups (§B.3 item 14); contract
  status family per D.5; ContractTab `${stStyle.color}1f` template → a token fill (`accentBg2` / `warnBg` / `goodBg`).
- Hitter and pitcher modals both verified (open from All Players: click a name; pitcher = a row with POS SP/RP).
Verify: hitter modal all 4 tabs, pitcher modal 2 tabs, FV chart renders, no console errors, no horizontal scroll.

## Batch 5 — Roster Planner (files: views/RosterPlanner/RosterPlanner.jsx, _shared.js, CompactPlayerRow.jsx,
## Panels.jsx, DepthChartPanels.jsx, QueuePanels.jsx, MlfaSection.jsx, SuggestionsPanel.jsx, MovesLogPanel.jsx,
## Rule5RiskPanel.jsx, SuperTwoDetailModal.jsx)
- §B.11 in full: `DroppablePanel`/`CollapsiblePanel`/`MlfaSection`/`SummaryCard` → `S.box` + `S.boxHead` recipe
  (header 13.5px Archivo Narrow 700, subtitle/count `text3`; the 8×22 accent bar → a 3px left rule in the bucket
  colour); drop target `accent` border + `accentBg2`; drag overlay per D.12; `CoverageStrip` tiles on
  badBg/badSoft/bad · warnBg/warn · goodBg/goodSoft/good, hover `accent` border, no `scale()`; `SlotGroup` sub-headers
  `panel2` strips; `CompactPlayerRow` 29px rows, `line` rule, hover `panel3` + 2px `accent` left rule, coverage
  highlight current `accentBg` / potential `CHART.series5` at ~12% (derive via `mixOklab` from theme), header 12px
  Archivo Narrow sentence case, chips r3 Archivo Narrow 700; queue action buttons `PillBtn`-style secondary with
  `good`/`bad` text+border; panel titles carry the semantic colour instead of tinted backgrounds; Moves log action
  colour map per §A.2; Super-Two modal = modal framing (`maxWidth 880`, `S.box`, header strip, cutoff row `accent`
  rules + `accentBg`), no monospace; crunch `SEVERITY_STYLES` → badBg/warnBg/accentBg2 boxes r3; `${accent}0d/14`
  template alphas → token fills.
- dnd-kit behaviour must be untouched; re-verify drag source opacity, overlay, `isOver` target, keyboard sensor.
Verify: Roster Planner full page, a drag in progress (use the keyboard sensor or pointer events via JS if needed),
each queue panel open, moves log, Super-Two modal, Rule 5 tab; scrollWidth 1440.

## Verify (all batches) — dev server http://localhost:3011 (HMR; start `cd app && npx vite --port 3011 --strictPort`
## only if down). The Browser pane may be hidden (screenshots time out) — use the CDP harness instead:
##   node app/docs/redesign/shoot-app.mjs --league BLM-ATL --out app/docs/redesign/shots/b3 --pages "My Organization" [--per "js to click a sub-tab"] [--full]
## (it prints scrollWidth per page and writes PNGs you can open with the Read tool). Sub-tabs/modals: pass --per
## with a JS snippet that clicks the PillBtn by text or a player name cell, e.g.
##   --per "[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Active Roster'))?.click()"
- `cd app && npx vite build` OK; per-file `grep -cE '#[0-9a-fA-F]{6}\b|rgba?\('` → 0; `grep -nE 'borderRadius: *(8|10|12|20)\b|textTransform|letterSpacing|monospace|boxShadow'` → nothing (boxShadow allowed only for S.thSorted/focus ring/the inset left rules); no console errors; scrollWidth 1440.
## Deliver: edited files + append a "Batch N — … landed" block to app/docs/redesign/MIGRATION_PLAN.md (re-read the file
## right before appending — siblings append too; append, never rewrite). Do NOT commit. Final message: per-file
## summary (≤2 lines each), gate numbers, scrollWidth per page, deviations.
