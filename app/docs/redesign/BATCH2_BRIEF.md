# Batch 2 brief — the board views (Night Scorecard, graphite)

Repo worktree: /Users/alex/Projects/ootp/dashboard/ootp-dashboard/.claude/worktrees/ootp-dashboard-redesign-4cb921
Branch `claude/ootp-dashboard-redesign-4cb921`. Batch 0 (theme.js foundation, ac04c89) and batch 1 (shell +
primitives, df2cf22) are committed. You are one of three agents working in parallel on DISJOINT files in this same
worktree; edit ONLY the files assigned to you in your task message. Do not touch shared.jsx, theme.js, Dashboard.jsx
or any file not assigned to you. Do not commit.

## Sources of truth (read first)
1. `app/src/theme.js` — `TOKENS` (T.bg/bg2/panel/panel2/panel3/zebra/text/text2/text3/textDisabled/line/line2/accent/
   accentHover/accentText/accentBg/accentBg2/good/goodSoft/goodBg/bad/badSoft/badBg/warn/warnBg/focus/scrim,
   T.fonts.ui/narrow, T.radius 3, T.radiusPill 10, T.CHART.*), the encoding helpers (`gradeStyle`, `warStyle`,
   `waaStyle`, `gradeToColor`, `posColor`, `posChip`, `levelColor`, `levelChip`, `tierChip`, `FV_TIER_COLORS`
   ({bg,text}), `zHeat`, `zToColor`, `proneColor`, `devPctColor`, `devPctStyle`, `intangibleColor`, `signColor`),
   and the restyled `S` (S.box/boxHead/boxFoot/toolbar, S.th/thSorted/td/tdName/groupRule/zebraRow/needRow/
   needTag/tableWrap/table, S.badge/tierPill/zCell, S.pillBtn/btn/btnPrimary/pageBtn, S.searchInput/filterSelect).
   USE THESE. Gate: zero six-digit hex literals and zero `rgba(`/`rgb(` literals in your files.
2. `app/src/components/shared.jsx` (batch 1) — `Section({ title, count, state, actions, toolbar, footer })` is the
   scorecard box; `SortHeader({ …, rule, align })`; NEW `colRule(cols, i)` returns the column-group left-rule style
   (spread into th via `rule={colRule(cols,i)}` and into every `<td>` of that column); `SearchInput` (sunken well
   with magnifier); `Toggle({ …, variant: "inline" | "row" })`; `PillBtn`; `Pagination` (foot strip);
   `MultiSelectDropdown`/`PositionFilter`/`LevelFilter`/`NumericRangeFilter`; `TwoWayBadge`.
3. `app/docs/redesign/mockup/night-scorecard.html` — the approved mockup (the Free Agent Finder). Read its <style>
   and markup for the board box: header strip (title + count left, state right), the filter toolbar strip, the
   table (sticky Archivo Narrow headers, sorted underline, column-group rules, light zebra, NEED rows tinted with
   the tiny NEED tag, 29px rows), the pagination foot strip; and the Needs box + Smart Rank box.
4. `app/docs/redesign/MIGRATION_INVENTORY.md` — §A.2 has your files' per-colour mapping (old hex → token, in
   context); §B.3 (column groups — the proposed `group` assignment per table), §B.4 (filter bars → toolbar slot),
   §B.6 (tier pills), §B.7 (level chips), §B.13 (DraftBoard), §D.1–D.4, D.6, D.11 (waiver strip, draft pick
   tracking, sign difficulty, intangibles, two-way, hover colours). Follow the proposals there — they are decided.
5. `app/CLAUDE.md` — accessor rules. You must not change data access, sorting, filtering, pagination or any logic.

## What every board gets (apply to each assigned view)
- **Box + toolbar:** the board's filter bar moves into `Section`'s `toolbar` slot (one `panel2` strip under the
  title; `flexWrap: wrap`, gap 8); the row count goes to `count` (e.g. `count="(1,545)"`), a short sort/state line to
  `state` if the view has one; export/secondary buttons become `actions` (`S.btn`); the search input becomes
  `<SearchInput>`; the "Gap fills only" style inline toggles stay `Toggle` (inline) pushed right with
  `marginLeft: "auto"`. Smart Rank Adjustments boxes: `Toggle variant="row"` inside a `Section` whose body has no
  extra padding (wrap the toggles in a div with `margin: -12` or pass children accordingly — keep it simple).
- **Table:** tables run edge-to-edge inside the box body: wrap in `<div style={{ ...S.tableWrap, margin: -12,
  border: "none", borderRadius: 0 }}>` (the box border is the rule) with `<table style={S.table}>`; header cells via
  `SortHeader` (or `S.th` for unsortable) with `rule={colRule(cols,i)}`; body cells `S.td` (+ `S.tdName` for the
  name cell, `+ colRule(cols,i)` spread per cell, `textAlign:"right"` + `fontVariantNumeric:"tabular-nums"` for
  numbers); zebra = `S.zebraRow` on odd rows; rows at a below-average position = `S.needRow` + the `S.needTag`
  `<i>NEED</i>` next to the POS text (replace the old red 9px "NEED"); row hover → `T.panel3` (use onMouseEnter/
  Leave only if the view already does; otherwise skip hover).
- **Column groups:** add `group` to each column def per §B.3 (identity | value | development | health | contract
  — or the per-table proposal there) and spread `colRule` into th + td. If a view builds columns inline, lift them
  into a `cols` array first (no logic change).
- **Encodings — helpers only, no inline hexes:** grade/WAR/FV values → `warStyle`/`gradeStyle` (they now carry the
  weight rule); Dev% → `devPctStyle(pct)` or `devPctColor`; POS / Best cells → `posColor(pos)` text (bold Archivo
  Narrow 600) — NOT filled chips in dense tables; Lvl columns → `levelChip(lev)` spread into `S.badge`
  (`{bg,text,border}`), e.g. `<span style={{ ...S.badge, ...levelChip(lev) }}>{lev}</span>`; FV tier → `tierChip`
  spread into `S.tierPill` (ProspectsView only); proneness → `proneColor`; intangibles H/N/L → `intangibleColor`;
  sign difficulty → `signColor`; two-way → `TwoWayBadge`; "YOURS"/"DRAFTED"/status tags → outlined chips on
  `S.badge` with the token from §D; money/demand `$` → `T.warn`; "—"/null → `T.textDisabled`; captions/footnotes →
  `T.text3` 12px (NOT textDisabled — §D.15); strength/need heat (dense PositionalStrengthTable is a shared
  component — leave it; batch 3).
- **Chrome:** radius 3 only (tier pills 10); no shadows/gradients/blur; no uppercase+letterSpacing labels (Archivo
  Narrow 600 sentence case); no `fontFamily: "monospace"`; section sub-captions as `Section footer` where natural.
- **Layout:** keep each page's grid (e.g. FA's Needs | Smart Rank top row) — just restyle the boxes. Keep 1440px
  no-horizontal-scroll: after your changes, every assigned board must measure `document.documentElement.scrollWidth
  === 1440` at a 1440×1000 viewport with the widest column set on (Draft: all optional columns + smart toggles on).

## Verify (dev server runs on http://localhost:3011 with HMR; start `cd app && npx vite --port 3011 --strictPort`
## only if it is down; the browser pane is shared with sibling agents — re-check the tab/page before measuring)
- `cd app && npx vite build` succeeds.
- `grep -cE '#[0-9a-fA-F]{6}\b|rgba?\(' <your files>` → 0 for each; `grep -nE 'borderRadius: *(8|10|12|20)\b|textTransform|letterSpacing|monospace|boxShadow' <your files>` → nothing (10 allowed only on the tier pill via S.tierPill).
- Browser at 1440×1000 (league BLM-ATL is loaded by default): open each assigned page, screenshot, compare the board
  box against the mockup, check zebra/NEED/group rules/chips render, open any popovers/modals the view has, and
  record `scrollWidth`. No console errors.

## Deliver
Edited files only + append a "Batch 2 — <your files> landed" block to `app/docs/redesign/MIGRATION_PLAN.md`
(what changed per file, gate numbers, scrollWidth per page, deviations). Do NOT commit. Final message: per-file
summary (≤2 lines each), gate numbers, scrollWidth per page, deviations.
