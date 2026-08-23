# Night Scorecard (graphite) — migration inventory

Companion to `MIGRATION_PLAN.md` (batches, gates, rollout). This file is the per-file evidence: what
each of the 49 styled files under `app/src` contains today, which token it becomes in *that file's
context*, which components need DOM/layout work rather than a literal swap, and what the design did
not cover.

**Scope rule.** Nothing in this migration touches data access. Every accessor rule in `app/CLAUDE.md`
stands (`getWar`/`resolveKey`/`isEligible`…, never flat column names); the diff for every batch must
stay inside inline `style={}` objects, `theme.js`, a handful of wrapper `<div>`s, `index.html`,
`prototype.css`, and docs.

**How the counts were made (verified this session on worktree `claude/ootp-dashboard-redesign-4cb921`,
HEAD `218dd86`).** Per file: `grep -oE '#[0-9a-fA-F]{6}\b' FILE | wc -l` (hex), `grep -oE 'rgba?\(' FILE | wc -l`
(rgba), and "touch lines" = `grep -cE '#[0-9a-fA-F]{6}|rgba?\(|borderRadius|textTransform|letterSpacing|fontFamily' FILE`.
Per-colour context breakdowns were read line-by-line (four parallel file-inventory passes, each
opening every file with `cat -n`; their line citations are reproduced below and were spot-checked
against the tell-line extracts I kept in the scratchpad). Token names are the `STEP2_BRIEF.md` names:
`bg bg2 panel panel2 panel3 zebra line line2 text text2 text3 textDisabled accent accentHover
accentBg accentBg2 accentText focus good goodSoft goodBg bad badSoft badBg warn warnBg scrim`,
`CHART.{series1..6,grid,axis,tooltipBg,tooltipBorder}`, and the encoding helpers
`gradeToColor / posChip / levelChip / tierChip / zHeat / proneColor / devPctColor / signColor / intangibleColor`.

**Totals.** 49 files carry six-digit hex literals: **1,063 hex literals**, **146 `rgba(`/`rgb(`
occurrences** (6 of them are template strings inside `theme.js:16-19,78,81`), **929 source lines** match
the change-regex. Three classes of literal escape the six-digit grep and must be in the verification
gates: 8-digit alpha hexes (`#4ade80aa` ×4, `#fbbf2444`, `#fbbf2415`, `#f59e0b44`), `"#fff"` ×2
(CurveTuningPanel.jsx:63,141), and template alpha suffixes (`${c}22`/`${c}44` ProspectsView:239,334,376;
`${b.color}44`/`15` PlayerProfileModal:298; `${stStyle.color}1f` ContractTab:179; `${accent}0d`/`14`
QueuePanels:11,19).

---

## A. Per-file inventory

### A.1 Summary table (sorted by hex count, descending)

| # | File | hex | rgba | touch lines | radius literals | uppercase / letterSpacing | fontFamily literal | batch |
|---|---|---|---|---|---|---|---|---|
| 1 | components/DraftBoard.jsx | 106 | 13 | 88 | 4×7, 8×2, 6×1, 2×1 | 0 / 1 (767 "NO MAX" ls 1.5) | — | 2 |
| 2 | theme.js | 93 | 13 | 42 | 12, 10, 8×3, 6×4, 4, 20 | 1 (S.th) / 3 (S.sectionTitle 0.5, S.th 0.5, S.loadBtn 1) | JetBrains Mono stack (124) | 0 |
| 3 | components/shared.jsx | 58 | 14 | 55 | 8×6, 10, 6, 4, 3 | 4 / 7 | — | 1 |
| 4 | views/DevAnalysis/DevScatterChart.jsx | 53 | 2 | 50 | 6×2, "50%"×2, 1×2 | 0 / 0 | — | 6 |
| 5 | views/RosterPlanner/QueuePanels.jsx | 43 | 4 | 36 | 8, `open?"8px 8px 0 0":8` | 0 / 0 | — | 5 |
| 6 | views/DevAnalysis/CurveTuningPanel.jsx | 42 | 2 | 32 | 10, 8, 6, 4×3, 3, 0 | 1 / 1 (28) | `monospace` (148) | 6 |
| 7 | components/ProspectsView.jsx | 41 | 3 | 39 | 10×2 (tier pills — keep), 8×2, 2 | 0 / 0 | — | 2 |
| 8 | views/DevAnalysis/WarPercentileChart.jsx | 36 | 0 | 25 | 6 | 0 / 0 | — | 6 |
| 9 | views/RosterPlanner/SuperTwoDetailModal.jsx | 33 | 3 | 32 | 10, 6 | 3 / 3 | `monospace` (72) | 5 |
| 10 | components/PlayerCompareView.jsx | 32 | 3 | 31 | 6, "0 0 6px 6px" | 1 / 1 (171) | — | 2 |
| 11 | components/WaiverWireView.jsx | 30 | 4 | 26 | 10, 3 | 0 / 0 | — | 2 |
| 12 | views/RosterPlanner/Panels.jsx | 28 | 12 | 28 | 8×2, "8px 8px 0 0", 6, 4, 2 | 1 / 3 (18, 19 −0.5, 118) | — | 5 |
| 13 | views/PlayerProfile/ContractTab.jsx | 26 | 2 | 28 | 6, 4×2 | 2 / 3 | — | 4 |
| 14 | views/RosterPlanner/RosterPlanner.jsx | 26 | 0 | 15 | 6 | 0 / 0 | — | 5 |
| 15 | views/DevAnalysis/GapDistributionChart.jsx | 25 | 0 | 20 | 6, 4 | 0 / 0 | — | 6 |
| 16 | views/RosterPlanner/MovesLogPanel.jsx | 23 | 2 | 13 | 6 | 1 / 1 (74) | — | 5 |
| 17 | views/PlayerProfile/FVProjectionChart.jsx | 23 | 0 | 19 | 6 | 0 / 1 (39) | — | 4 |
| 18 | components/LeagueSettingsModal.jsx | 22 | 4 | 18 | 12, 4 | 1 / 1 (49 labelStyle) | JetBrains Mono (55) | 1 |
| 19 | views/Org/ActiveRosterSubTab.jsx | 21 | 7 | 24 | 6 | 1 / 2 (59, 174) | — | 3 |
| 20 | views/PlayerProfile/PitchingTab.jsx | 20 | 3 | 26 | 8×2, 6 | 3 / 6 | — | 4 |
| 21 | views/PlayerProfile/PlayerProfileModal.jsx | 18 | 6 | 22 | 12, 6×2, 4×2 | 1 / 2 (39, 287 ls 2) | — | 4 |
| 22 | views/RosterPlanner/CompactPlayerRow.jsx | 18 | 5 | 16 | 3×2 | 1 / 1 (10) | — | 5 |
| 23 | views/PlayerProfile/FieldingTab.jsx | 18 | 3 | 22 | 6, 4, "50%" | 1 / 7 | — | 4 |
| 24 | components/Dashboard.jsx | 15 | 3 | 14 | 6×2 | 3 / 4 | JetBrains Mono stack (226) | 1 |
| 25 | views/RosterPlanner/_shared.js | 13 | 3 | 10 | — | 0 / 0 | — | 5 |
| 26 | components/PlayersView.jsx | 13 | 1 | 11 | — | 0 / 0 | — | 2 |
| 27 | views/PlayerProfile/BaserunningTab.jsx | 13 | 1 | 11 | 6 | 1 / 3 | — | 4 |
| 28 | components/ScoutView.jsx | 12 | 5 | 15 | 8 | 0 / 0 | — | 2 |
| 29 | views/Org/PositionalStrengthTable.jsx | 12 | 3 | 15 | 4×2, 3, 2 | 2 / 3 | — | 3 |
| 30 | views/PlayerProfile/BattingTab.jsx | 12 | 2 | 15 | 8, 6 | 2 / 4 | — | 4 |
| 31 | views/DevAnalysis/LiveProspectPreview.jsx | 12 | 1 | 10 | — | 0 / 0 | — | 6 |
| 32 | views/Org/OverviewSubTab.jsx | 12 | 1 | 9 | — | 0 / 0 | — | 3 |
| 33 | views/RosterPlanner/SuggestionsPanel.jsx | 11 | 2 | 12 | 6 | 0 / 0 | — | 5 |
| 34 | views/DevAnalysis/FVImpactTable.jsx | 11 | 2 | 10 | 4 | 0 / 0 | — | 6 |
| 35 | views/Org/FortyManSubTab.jsx | 10 | 3 | 9 | 8 | 0 / 0 | — | 3 |
| 36 | views/PlayerProfile/PercentileBar.jsx | 10 | 1 | 15 | "50%"×2, `TRACK_HEIGHT/2` | 0 / 1 (46) | — | 4 |
| 37 | views/RosterPlanner/Rule5RiskPanel.jsx | 9 | 4 | 8 | — | 0 / 0 | — | 5 |
| 38 | views/RosterPlanner/MlfaSection.jsx | 9 | 2 | 7 | 8 | 0 / 0 | — | 5 |
| 39 | views/DevAnalysis/BandwidthControl.jsx | 9 | 1 | 6 | 4 | 0 / 0 | — | 6 |
| 40 | views/Org/OptimizedLineupSubTab.jsx | 9 | 1 | 8 | — | 0 / 0 | — | 3 |
| 41 | App.jsx | 9 | 0 | 6 | 6 | 1 / 2 (196 −2, 197 3) | `monospace` (14) | 0 |
| 42 | components/FreeAgentFinder.jsx | 8 | 2 | 9 | — | 0 / 0 | — | 2 |
| 43 | components/Rule5Board.jsx | 8 | 1 | 9 | — | 0 / 0 | — | 2 |
| 44 | components/IAFABoard.jsx | 5 | 1 | 6 | — | 0 / 0 | — | 2 |
| 45 | views/DevAnalysis/DevAnalysisView.jsx | 2 | 0 | 2 | — | 0 / 0 | — | 6 |
| 46 | views/PlayerProfile/EligiblePositionsTable.jsx | 1 | 1 | 2 | — | 0 / 1 (10) | — | 4 |
| 47 | views/Org/OrgView.jsx | 1 | 0 | 1 | — | 0 / 0 | — | 3 |
| 48 | views/PlayerProfile/PercentileHeader.jsx | 1 | 0 | 1 | — | 0 / 1 (139) | — | 4 |
| 49 | views/RosterPlanner/DepthChartPanels.jsx | 1 | 0 | 1 | — | 0 / 0 | — | 5 |

Files under `app/src` with **no** colour literals and nothing to do: `main.jsx`, `components/boardUtils.js`,
`utils/*` (except `constants.js`, which gains `group` fields on `PLAYERS_*_COLS` in batch 2 — no colours),
`hooks/*`, `views/DevAnalysis/_shared.js`, `views/PlayerProfile/_shared.js`.

Global tallies that the batch gates will drive to zero: `#475569` 161 · `#64748b` 131 · `#94a3b8` 129 ·
`#e2e8f0` 85 · `#1e293b` 76 · `#334155` 66 · `#cbd5e1` 35 · `#4ade80` 35 · `#22c55e` 35 · `#3b82f6` 33 ·
`#fbbf24` 29 · `#f87171` 26 · `#fca5a5` 24 · `#0f172a` 21 · `#93c5fd` 18 · `#a78bfa` 15 · `#ef4444` 13 ·
`#60a5fa` 13 · `#38bdf8` 13 · `#86efac` 12 · `#dc2626` 8 · 27 further hexes ≤ 7 each.
`rgba(15,23,42,x)`: 56 (0.3 ×19, 0.6 ×11, 0.4 ×10, 0.5 ×5, 0.92 ×3, 0.8 ×3, 0.95 ×2, 0.35 ×2, 0.85, 0.55).
`borderRadius` numerics: 6 ×29, 4 ×24, 8 ×24, 10 ×7, 3 ×6, 2 ×4, 12 ×3, 0 ×2, 1 ×2, 20 ×1, plus `"50%"` ×5.
`textTransform:"uppercase"` 31 · `letterSpacing` 62 · `fontFamily` literals 6 (3 JetBrains stacks, 3 `monospace`).

### A.2 Per-file detail

Format: `old ×n: context → token`. "text" means a `color:` on text; "border", "bg", "svg", "chart" as
labelled. The mapping follows `STEP2_BRIEF.md`; where a file uses a colour *against* its general role
(e.g. `#475569` as a border, `#334155` as text) the per-file line wins.

#### Batch 0 — foundation

**theme.js** (93 hex / 13 rgba / 42 lines) — becomes the `TOKENS` + encoding + helper module.
- `FV_TIER_COLORS` (5-9) 11 chart-blue→red hexes → `tierChip` fills from the dir-6 table (80 #bccdff … 35+ #f98b80); **shape change to `{bg,text}`** — the only consumer is `ProspectsView.jsx` (lines 239, 334, 376, 494, 524, 534).
- `zToColor` (11-21): `rgba(100,116,139,0.15)`/`#94a3b8`/`#64748b`/`#334155` null case and the 4 template `rgba()` ramps → computed from `zHeat(z)` (oklab/linear-sRGB mix of `#e86c5f`/`#6193de` toward `panel`, |z|/2.5), returning the same `{bg,value,label,border}` keys (callers: PositionalStrengthTable 83, FortyManSubTab 113, DraftBoard import is dead).
- `posColor` (23) 11 hexes + fallback → dir-6 positions (C #b8a2f2 … RP #cfae92, DH #a9a59c, SP = `text`); `levelColor` (25) 7 + `#475569` fallback → **see D.8** (ladder fills are too dark for text at A+/A/R); `proneColor` (27) → Iron Man g80 / Durable g55 / Normal text2 / Fragile g30 / Wrecked g20; `signColor` (29) → D.4 mapping; `intangibleColor` (103) `#4ade80`/`#f87171`/`#64748b` → good / bad / text3; `devPctColor` (105-113) 5 bands → g70 / g55 / text2 / g40 / g30; `scoutingRatingColor` (115-121) → same 5-band ramp as devPct.
- `GRADE_COLORS` (59-67) 7 RGB stops → 9-stop text ramp (20 #f98b80, 30 #e08e52, 40 #b38f34, 45 #8d953e, 50 #47a46e, 55 #3ea891, 60 #49aac4, 70 #80acf0, 80 #bccdff); `gradeToColor` still returns a string; `gradeStyle/warStyle/waaStyle` (83-101) keep signatures, null → `textDisabled`, weight rule 20/30→700, 40–55→500, 60→600, 70→700, 80→800 (today: bold only ≥70/≤30).
- `S` (123-141): `loaderContainer` gradient `#0c1222/#0f172a` + JetBrains stack → flat `bg`, Archivo; `loaderCard` `rgba(15,23,42,0.8)`/`#1e293b`/r12/`backdropFilter blur(12px)` → `panel`/`line2`/r3/no blur; `dropZone` `#334155` dashed r8 → `line2` r3; `loadBtn` `rgba(59,130,246,.2)`/`#3b82f6`/`#93c5fd` r8 ls1 → primary: `accent` bg / `accentText` text r3 no tracking; `errorBox` `rgba(239,68,68,.1)`/`#dc2626`/`#fca5a5` r6 → `badBg`/`bad`/`badSoft` r3; `section` `rgba(15,23,42,.4)`/`#1e293b` r10 p20 → `panel`/`line2` r3 p0 (box owns header strip; body padding moves into `Section`); `sectionTitle` `#e2e8f0` ls .5 → 13.5px Archivo Narrow 700 `text` (strip); `strengthCard` r8 → r3 (unused today — grep shows no consumer; delete or keep); `pillBtn` r20 → r3, Archivo Narrow 600; `tableWrap` `#1e293b` r6 → `line` r0 (inside a box); `th` 11px 700 `#64748b` `rgba(15,23,42,.6)` uppercase ls .5 → 12px Archivo Narrow 600 `text2` on `panel2`, sentence case, no tracking, `borderBottom line2`; `td` `#94a3b8` 6/8 padding → `text2` (names/values set their own), 29px rows, `borderBottom line`; `searchInput`/`filterSelect` `#0f172a`/`#334155`/`#e2e8f0` r6 → `bg` well / `line2` / `text` r3 (select = raised `panel`); `pageBtn` `rgba(30,41,59,.5)`/`#334155`/`#94a3b8` r4 → `panel`/`line2`/`text` r3 Archivo Narrow.
- New exports: `TOKENS`, `CHART`, `posChip`, `levelChip`, `tierChip`, `zHeat`; `tokens.css` generator.

**App.jsx** (9 / 0 / 6). `#e2e8f0` ×3 (14 ErrorBoundary text, 17 button text, 196 wordmark) → `text`; `#f87171` 15 heading → `bad`; `#94a3b8` 16 → `text2`; `#64748b` 197 → `text3`; `#334155` 17 border → `line2`; `#1e293b` 17 button **bg** → `panel3`; `#0c1222` 14 page bg → `bg`. r6 (17) → 3. `fontFamily:"monospace"` (14) → remove. 197 `uppercase` + ls 3 ("Loading data...") → Archivo Narrow 12px sentence case; 196 ls −2 on the 42px wordmark → −0.04em (the mockup brand uses −0.04em; keep as the one tracked display element). The loader body uses `S.loaderContainer/loaderCard` (batch 0 via theme.js); the drop zone is `DataLoader` in shared.jsx (batch 1).

**index.html** (not under `src`): body `#0c1222` → `bg` `#141516` via generated `tokens.css`; add the Google Fonts `<link>` (Archivo 400–800 + Archivo Narrow 400–700, `display=swap`); `color-scheme: dark` stays; body `font-family` Archivo stack, `font-variant-numeric: tabular-nums`.

#### Batch 1 — shell + primitives

**components/shared.jsx** (58 / 14 / 55).
- `#64748b` ×9: 65 PillBtn inactive text, 142/370 ▾ carets, 159/175/385 popover headings, 395 "—", 458 "items", 487 "GM Dashboard" → `text3` (popover headings → `text2` 12px Archivo Narrow sentence case).
- `#334155` ×7: 119/352 closed border, 153/378 popover border, 330 range-input border, 431 Toggle off track, 447 dropzone idle border → `line2` (Toggle off track → `bg` well with `line2` ring).
- `#475569` ×6: 119/352 "has value" border → `line2`; 398 helper text, 428 disabled label, 436 Toggle description, 450 "Click or drag CSV" → `textDisabled` (description → `text3`).
- `#94a3b8` ×5: 121/354 button text, 428 unchecked label, 449 dropzone label, 461 "Page x of y" → `text2`.
- `#3b82f6` ×5: 65 active border, 119/352 open border, 197 checkbox `accentColor`, 431 Toggle on → `accent` (open border → `focus`).
- `#0f172a` ×4: 117/350 gradient start, 152/378 popover bg → `panel` (popover opaque `panel`, button raised `panel`).
- `#e2e8f0` ×3: 428 checked label, 432 knob, 486 wordmark → `text` / knob `accentText` on / `text3` off.
- `#93c5fd` ×3: 65 active text, 121/354 "has value" text → `accent`.
- `#60a5fa` ×3: 162/388 CLEAR links, 447 dragover border → `accent`.
- `#0a0f1c` ×3: 117/350 gradient end, 329 range-input bg → `bg` (inputs are wells).
- `#cbd5e1` ×2: 189 option text, 332 range-input text → `text`. `#bfdbfe` ×2: 139 count chip, 189 checked option → `accent` / `text`. `#1e293b` ×2: 65 inactive border, 171 divider → `line2` / `line`.
- `#fbbf24` 417 TwoWayBadge text, `rgba(251,191,36,.2)` bg → `warn` outlined chip (D.6). `#86efac`/`#4ade80`/`#22c55e` 449-450/447 dropzone ready → `good`/`goodSoft`/`good`.
- rgba: `rgba(59,130,246,.18)` ×2 focus ring → `focus` at 26%; `rgba(0,0,0,.2)` ×2 button shadow → drop; `rgba(0,0,0,.5)` ×2 popover shadow → drop (1px `line2` border only); `rgba(59,130,246,.25)` 139 chip → `accentBg`; `rgba(59,130,246,.15)` 188 checked row → `accentBg`; `rgba(96,165,250,.07)` 195 hover → `panel3`; `rgba(34,197,94,.06)`/`rgba(96,165,250,.06)`/`rgba(15,23,42,.5)` 447 → `goodBg`/`accentBg2`/`panel2`.
- radius: 8 ×6 (120/353 buttons, 139 chip, 154/379 popovers, 432 knob) → 3 (knob 50% ok); 10 (431 track) → 9 (switch stays pill — mockup `.switch{border-radius:9px}`); 6 (331) → 3; 4 (186 option row) → 3; 3 (416) keep.
- uppercase ×4 (159, 175, 385 popover headings; 487 loader caption) and ls ×7 (159, 162, 175, 385, 388, 486 −2, 487 3) → sentence case, no tracking (wordmark −0.04em).
- gradients ×2 (117, 350), boxShadow ×4, `transition` several — gradients and shadows go.

**components/Dashboard.jsx** (15 / 3 / 14). `#64748b` ×4 (30 Loading…, 231 collapse glyph, 270 inactive page, 281 Settings) → `text2` for pages (mockup `.pages li` = `text2`, 14px Archivo Narrow 500), `text3` for Settings/glyph; `#475569` ×3 (237/252/258 sidebar labels, 10px uppercase ls 1) → `text3` 11px Archivo Narrow 600, sentence case; `#1e293b` ×2 (228 sidebar right rule, 277 Settings top rule) → `line2` / `line`; `#0c1222` ×2 + `#0f172a` (226 gradient) → flat `bg`; `#e2e8f0` 230 brand → `text` Archivo 800 22px ls −0.04em; `#cbd5e1` 226 body colour → `text`; `#93c5fd` 270 active page text → `text` 700 + red tick (`accent`). rgba: `rgba(15,23,42,.8)` 228 nav bg → `panel`; `rgba(96,165,250,.15)`/`.3` 268-269 active fill/border → none (tick + bold replace the pill). r6 ×2 (268, 280) → 0 (plain rows; hover `panel2`). JetBrains stack (226) → Archivo via body. Layout: sidebar width 220/52 → 200 (see B.1 for the collapsed state question); main `padding 24, maxWidth 1400` → `18px 24px 48px`, maxWidth stays.

**components/LeagueSettingsModal.jsx** (22 / 4 / 18). `#475569` ×4 (69/75/96 help text, 122 empty) → `text3`; `#dc2626` ×3 (107 excluded chip border, 113/115 ✕/✓) → `bad`; `#64748b` ×3 (49 labels, 58 ✕, 111 "(auto)") → `text2` labels / `text3`; `#22c55e` ×2 (107 forced-include border, 113 ↩) → `good`; `#fca5a5` 108 → `badSoft`; `#86efac` 108 → `good`; `#e2e8f0` 57 title → `text`; `#cbd5e1` 55 body → `text`; `#94a3b8` 133 Cancel → `text`; `#93c5fd`+`#3b82f6`+`rgba(59,130,246,.15)` 134 Save → primary `accent`/`accentText`; `#334155` 133 → `line2`; `#1e293b` 55 modal border → `line2`; `#0f172a` 55 modal bg → `panel`; `rgba(0,0,0,.6)` 54 → `scrim` keep; `rgba(34,197,94,.1)`/`rgba(239,68,68,.1)` 106 chips → `goodBg`/`badBg`. r12 (55) → 3, r4 (105) → 3. `labelStyle` 49 uppercase ls .5 → sentence case. JetBrains (55) → remove. `backdropFilter: blur(4px)` (54) → remove.

#### Batch 2 — boards

**components/DraftBoard.jsx** (106 / 13 / 88) — the 106 break down as: 59 plain text-tier literals, 15 borders, 12 state/encoding colours on the Position-Caps and Budget meters, 11 accent/button colours, 9 placeholders.
- `#94a3b8` ×15 text (475, 502, 521, 639, 645, 647, 655, 664, 676, 682, 695, 702, 767, 904) → `text2`; 778 is a 1px **tick** div on the cap meter → `text2`.
- `#64748b` ×15 text (447, 458, 486, 503, 522, 530, 535, 567, 570, 607, 616, 654, 719, 791, 888) → `text3`.
- `#e2e8f0` ×11 text (471, 476-478, 611, 642, 681, 749, 789, 804, 894) → `text`. `#cbd5e1` ×9 (56, 493, 617, 619, 679, 680, 749, 788, 803) → `text`.
- `#475569` ×9 placeholders (568, 622, 658, 758, 762, 797, 798, 900, 914) → `textDisabled` (658 is a header caption → `text3`).
- `#334155` ×9 borders (55, 458, 471, 556, 645, 647, 682, 702, 888) → `line2`.
- `#93c5fd` ×5 accent text (455, 647, 690, 758, 762) → `accent`. `#3b82f6` ×4 (455/647 borders, 890 ★, 897 "DRAFTED") → `accent`. `#60a5fa` ×2 (661, 696) → `accent`. `#38bdf8` 791 → `accent`.
- `#f87171` ×4 (462, 602, 718, 721) → `bad`; `#7f1d1d` 462 border → `bad`; `#ef4444` ×2 (517, 775 meters) → `bad`.
- `#86efac` ×4 (472, 720, 721, 854) → `good`; `#22c55e` ×4 (472, 517, 775, 854) → `good`.
- `#fbbf24` 721, `#facc15` 622 (Demand $), `#f59e0b` 775, `#eab308` 517 → `warn`.
- `#1e3a5f` ×3 borders (588 manual-pick card, 676/695 editor panels) → `line2`; `#1e293b` ×2 (524 track, 588) → `panel3` track / `line`; `#0f172a` ×2 (471 textarea, 769 track) → `bg` / `panel3`.
- rgba: `rgba(59,130,246,.07)` ×2 (676, 695 editor panels) → `accentBg2`; `.15` 455, `.12` 647 → `accentBg`; `.10` 587, `.08` 885 manual-pick card/row → `accentBg2`; `rgba(15,23,42,.3)` 555 empty-slot card → `panel`, 885 zebra → `zebra`; `.5` 587 → `panel2`; `rgba(51,65,85,.5)` 54 STEP_BTN → `panel3`; `rgba(30,41,59,.45)` 747 → `panel3`; `rgba(34,197,94,.10)` 854 → `goodBg`; `rgba(239,68,68,.10)` 462 → `badBg`.
- radius 4 ×7, 8 ×2, 6, 2 → all 3. ls 1.5 (767) → 0. `zToColor` import (4) is dead — remove.

**components/ProspectsView.jsx** (41 / 3 / 39). `#94a3b8` ×8: 195/208 pill text, 268/383/490/505/535 text → `text2`; 520 XAxis tick → `CHART.axis`. `#475569` ×8: 265/277/341/354/380/386/484 → `textDisabled` (484 rank → `text3`); 521 YAxis label → `CHART.axis`. `#334155` ×7: 195/208 borders → `line2`; 261-263/494 zero-count **text** → `textDisabled`; 372 tooltip border → `CHART.tooltipBorder`. `#e2e8f0` ×5 (261, 330, 338, 372, 384) → `text`. `#fbbf24` ×3 ($ values 351, 379, 488) → `warn`. `#64748b` ×3: 264/331 → `text3`; 521 YAxis tick → `CHART.axis`. `#93c5fd` ×2 (201, 485) → `accent`. `#1e293b` ×2: 372 tooltip **bg** → `CHART.tooltipBg`; 519 grid → `CHART.grid`. `#60a5fa` 262 hitter count → `CHART.series1`; `#f472b6` 263 pitcher count → `CHART.series3`; `#3b82f6` 201 → `accent`. rgba `.3` ×3 (236, 329, 483) → `zebra`. Tier pills 238/333 r10 **keep 10**; 372 tooltip r8 → 3; 375 tooltip pill r8 → 10; 534 legend swatch r2 → 3. `FV_TIER_COLORS[id]` with `${c}22`/`${c}44` alpha suffixes (239, 334, 376) → `tierChip(id).bg/.text` filled pill (the suffix trick dies).

**components/PlayerCompareView.jsx** (32 / 3 / 31). `#475569` ×11 (49, 50, 54, 56, 57, 58, 121, 134, 157, 159, 223) → `textDisabled` (121/134 dropdown/chip org → `text3`). `#94a3b8` ×4 (160, 191, 198, 207) → `text2`. `#64748b` ×4 (120, 139, 158, 171) → `text3`. `#334155` ×4: 73/194 **text** → `textDisabled`; 113/139 borders → `line2`. `#e2e8f0` ×3 (118, 133, 154) → `text`. `#f87171` ×2 (135 ✕, 206 worst) → `bad`. `#4ade80` 205 best → `good`. `#1e3a5f` 131 chip border → `line2`. `#1e293b` 113 popover bg → `panel`. `#0f172a` 115 row divider → `line`. rgba `rgba(96,165,250,.1)` 116 hover (JS-set) → `panel3`; `rgba(59,130,246,.1)` 131 chip → `accentBg2`; `rgba(15,23,42,.6)` 171 group row → `panel2`. r6 (131) → 3; `"0 0 6px 6px"` (113) → `0 0 3px 3px`. 171 group-header rows uppercase ls 1 → 12px Archivo Narrow 600 sentence case.

**components/WaiverWireView.jsx** (30 / 4 / 26). `#94a3b8` ×6 (83, 107-109, 193, 202) → `text2`. `#475569` ×6 (96, 105, 106, 115, 197, 216) → `textDisabled`. `#cbd5e1` ×5 (92, 200, 280 ×2, 282 `<code>`) → `text`. `#f87171` ×4 (89 NEED, 96 ≤1 day, 204, 207) → `bad`. `#e2e8f0` ×3 (76, 96, 207) → `text`. `#64748b` ×3 (96 "cleared", 264, 279) → `text3`. `#fbbf24` 194 "CSV EXPORT ONLY" → `warn`; `#34d399` 194 "STATSPLUS LIVE" → `good`; `#1e293b` 192 strip border → `line2`. rgba: `rgba(148,163,184,.15)` 83 YOURS chip → `panel3`; `rgba(15,23,42,.4)` 192 strip → `panel`; `.3` 74 → `zebra`; `rgba(239,68,68,.04)` 74 weak row → `accentBg2` (NEED-row tint, mockup). r10 (192) → 3; r3 (83) keep.

**components/ScoutView.jsx** (12 / 5 / 15). `#475569` ×5 (149, 159, 215, 216, 223) → `textDisabled` (149/159 captions → `text3`). `#e2e8f0` ×4 (118, 129, 173, 205) → `text`. `#94a3b8` ×2 (143, 219) → `text2`. `#86efac` 142 → `good`. rgba `.3` ×2 (171, 204) → `zebra`; `rgba(34,197,94,.2)`/`.08` 141 callout → `good` border / `goodBg`; `.04` 204 trade-fit row → `goodBg`. r8 (141) → 3.

**components/PlayersView.jsx** (13 / 1 / 11). `#94a3b8` ×5 (117, 124, 153, 160, 163) → `text2`. `#64748b` ×2 (123, 158 "FA") → `text3`. `#475569` ×2 (150, 151) → `textDisabled`. `#fbbf24` 158 Draft-year org → `warn`; `#a78bfa` 158 IAFA org → `CHART.series5`; `#e2e8f0` 148 → `text`; `#cbd5e1` 158 → `text`. rgba `.3` 139 → `zebra`. No radius/uppercase. **No `Section` at all** — the page needs a box (B.4).

**components/FreeAgentFinder.jsx** (8 / 2 / 9). `#475569` ×4 (145, 207, 208, 215) → `textDisabled` (145 footnote → `text3`). `#94a3b8` ×2 (209, 211) → `text2`. `#f87171` 202 NEED → `accent` (the mockup NEED tag is the pencil). `#e2e8f0` 197 → `text`. rgba `rgba(239,68,68,.04)` 195 → `accentBg2`; `.3` 195 → `zebra`.

**components/Rule5Board.jsx** (8 / 1 / 9). `#475569` ×4 (77, 129, 136, 142) → `textDisabled` (77 → `text3`). `#e2e8f0` 126 → `text`; `#cbd5e1` 132 → `text`; `#64748b` 55 → `text3`; `#1e293b` 46 tab rule → `line`. rgba `.3` 124 → `zebra`.

**components/IAFABoard.jsx** (5 / 1 / 6). `#94a3b8` ×2 (95, 142) → `text2`; `#475569` ×2 (134, 146) → `textDisabled`; `#e2e8f0` 131 → `text`. rgba `.3` 126 → `zebra`. Signed rows `opacity .5` (126) keep.

**components/boardUtils.js** — 0 / 0; untouched.

**utils/constants.js** `PLAYERS_HIT_COLS / PIT / MIXED` (460-462) — no colours; gain `group` fields (B.3).

#### Batch 3 — Org

**views/Org/ActiveRosterSubTab.jsx** (21 / 7 / 24). `#94a3b8` ×4 (109-112 svg base rects fill) → `text2`. `#475569` ×4: 63 "—", 222, 239 text → `textDisabled`; 114 mound **stroke** → `line2`. `#64748b` ×3 (79, 174 sectionLabel, 180) → `text3`. `#334155` ×3 (47 ×2 chip borders dashed/solid, 56 hover-leave) → `line2`. `#1e293b` ×2 (103, 105 svg strokes) → `line`. `#fbbf24` 66 injured name → `warn`; `#f87171` 75 INJ → `bad`; `#e2e8f0` 66 → `text`; `#cbd5e1` 116 home plate fill → `text`; `#3b82f6` 55 hover border → `text` (mockup hover border = cream). rgba: `rgba(15,23,42,.92)` 46 chip → `panel`; `.55` 46 empty chip → `bg`; `rgba(0,0,0,.45)` 50 shadow → drop; `rgba(34,197,94,.05)` 103 outfield, `.03` 107 infield grass → `goodBg` at 6% / 4% (compute: good over panel); `rgba(166,128,89,.07)` 105 dirt, `.22` 114 mound → `CHART.series6` (tan) at 8% / 25% over panel. r6 (45) → 3. 59 POS label ls 1 → 0 (Archivo Narrow 700); 174 uppercase ls 1 → sentence case 12px.

**views/Org/PositionalStrengthTable.jsx** (12 / 3 / 15). `#475569` ×4: 90 bar **midline** → `line2`; 105 "—" → `textDisabled`; 110 index, 117 "×w" → `text3`. `#64748b` ×3 (113, 126 header, 148 caret) → `text3` (header → `text2`). `#94a3b8` ×2 (104, 145) → `text2`. `#f59e0b` 145 age ≥ 31 → `warn`. `#e2e8f0` 111 → `text`. `#1e293b` 126 → `line2`. rgba: `rgba(30,41,59,.45)` 89 track → drop (mockup zbar has no track fill — only centre line + edge ticks); `rgba(59,130,246,.10)` 143 open row → `accentBg`; `rgba(15,23,42,.4)` 151 expanded → `panel2`. r3/2/4 → 3. uppercase ×2 (104, 126) + ls (104, 126, 128) → sentence case.

**views/Org/OverviewSubTab.jsx** (12 / 1 / 9). `#94a3b8` ×4 (39 ×3, 72) → `text2`. `#475569` ×4 (68, 69, 75, 79) → `textDisabled`. `#f87171`/`#4ade80` 39 legend → `bad`/`good`. `#e2e8f0` 60 → `text`. `#64748b` 38 → `text3`. rgba `.3` 59 → `zebra`.

**views/Org/FortyManSubTab.jsx** (10 / 3 / 9). `#475569` ×4: 121, 137 → `textDisabled`; 140 meta row, 161 footer → `text3`. `#334155` ×2 (129, 152 **text**) → `textDisabled`. `#e2e8f0` 139 starter → `text`; `#94a3b8` 139 → `text2`; `#1e293b` 115 card border → `line2`; `#0f172a` 135 divider → `line`. rgba `.4` 115 → `panel`; `.6` 152 → `panel2`; `rgba(59,130,246,.06)` 135 starter row → `accentBg2`. r8 (115) → 3. Header strip 116-126 uses `zToColor(z)` `{bg,border,value,label}` — keeps working through the new `zToColor`.

**views/Org/OptimizedLineupSubTab.jsx** (9 / 1 / 8). `#475569` ×5: 69 slot number → `text3`; 77/78 "—", 82, 86 → `textDisabled`. `#e2e8f0` ×3 (70, 77, 78) → `text`. `#94a3b8` 99 → `text2`. rgba `.3` 68 → `zebra`.

**views/Org/OrgView.jsx** (1 / 0 / 1). `#1e293b` 29 tab rule → `line`.

#### Batch 4 — Player Profile

**views/PlayerProfile/ContractTab.jsx** (26 / 2 / 28). `#fbbf24` ×6 (19 arb, 185 NO-TRADE, 218, 235 Super-Two, 259, 284) → `warn`; `#fbbf2444`/`#fbbf2415` (186) → `warn` border / `warnBg`. `#94a3b8` ×5 (21 fa, 183, 218 Protected, 257, 279) → `text2`. `#f87171` ×2 (207 OUT, 218 Now) → `bad`. `#f472b6` ×2 (22, 258 minors) → **D.5** (`CHART.series6`). `#a3e635` ×2 (20, 260 pre-arb) → `goodSoft`. `#e2e8f0` ×2 (15, 265) → `text`. `#475569` ×2 (12, 14 labels) → `text3`. `#cbd5e1` 262 → `text`; `#a78bfa` 261 option → `CHART.series5`; `#64748b` 269 → `text3`; `#60a5fa` 18 signed → `accent`; `#1e293b` 13 → `line`. `${stStyle.color}1f` 179 pill bg → per-status `{bg,text}`. rgba `.6` 13 → `panel2`; `rgba(251,191,36,.05)` 264 → `warnBg`. r6/4/4 → 3. 14 `tL` and 179 pill uppercase, ls 12/14/179 → sentence case.

**views/PlayerProfile/FVProjectionChart.jsx** (23 / 0 / 19). `#64748b` ×4: 45/46 tick fills, 53 maturity line → `CHART.axis` / `text2`; 32 "Floor" → `text3`. `#475569` ×4: 39 caption → `text3`; 45/48 axis labels → `CHART.axis`; 50 zero line → `text2`. `#38bdf8` ×4 (31, 51, 52, 57 projected line/"Now") → `CHART.series1`. `#94a3b8` ×3 (29, 54, 58 Legend) → `text2`. `#334155` ×3: 28 tooltip border → `CHART.tooltipBorder`; 45/46 axis stroke → `CHART.axis`. `#1e293b` ×3: 28 tooltip bg → `CHART.tooltipBg`; 38 border → `line`; 44 grid → `CHART.grid`. `#4ade80` ×2 (30, 56 ceiling band `fillOpacity .12`) → `CHART.series2` at 18%. r6 (28) → 3; ls 1 (39) → 0.

**views/PlayerProfile/PitchingTab.jsx** (20 / 3 / 26). `#475569` ×6 (6, 7, 8, 19, 99, 243) → `text3` labels / `textDisabled` separators+empty. `#94a3b8` ×3 (107, 168, 308) → `text2`. `#1e293b` ×3 (5, 114, 299) → `line`. `#e2e8f0` ×2 (33, 311) → `text`; `#cbd5e1` ×2 (53, 214) → `text`; `#64748b` ×2 (54, 178) → `text3`; `#4ade80` ×2 (44, 64 POT) → `good`; `#4ade80aa` ×2 (43, 63) → `goodSoft`. rgba `.6` 5 → `panel2`; `.4` 113/298 → `panel`. r6/8/8 → 3. uppercase ×3 (6, 107, 308), ls ×6 → sentence case.

**views/PlayerProfile/PlayerProfileModal.jsx** (18 / 6 / 22). `#1e293b` ×5 (30 tile, 265 modal, 270, 280, 331 rules) → `line` (265 → `line2`). `#e2e8f0` ×3 (40, 46, 290) → `text`. `#fbbf24` 248 INJ → `warn`; `#f87171` 247 R5 → `bad`; `#60a5fa` 246 40-Man → `accent`; `#a78bfa` 251 Draft/IAFA → `CHART.series5`; `#cbd5e1` 296 → `text`; `#94a3b8` 271 ✕ → `text2`; `#64748b` 48 → `text3`; `#475569` 39 tile label → `text3`; `#334155` 271 → `line2`; `#0f172a` 265 → `panel`. `${b.color}44/15` 298 → badge `{bg,text,border}`. rgba: `.6` 29 tile → `panel2`; `.85` 270 / `.8` 281 → `panel2` (header bar); `.4` 331 → `panel2` (tab strip); `rgba(0,0,0,.65)` 263 → `scrim` 60%; `rgba(0,0,0,.7)` 265 shadow → drop. r12 (265) → 3; r6 (31, 271) → 3; r4 (287, 298) → 3. 39 uppercase ls 1; 287 ls 2 → 0.

**views/PlayerProfile/FieldingTab.jsx** (18 / 3 / 22). `#475569` ×8 (14, 15, 16, 19, 80, 84, 86, 90) → `text3` labels / `textDisabled` nulls+separators. `#64748b` ×5 (165, 175, 186, 230, 264) → `text3`. `#1e293b` ×2: 13 → `line`; 60 mini-bar track → `panel3`. `#94a3b8` 233 → `text2`; `#4ade80` 91 → `good`; `#334155` 61 tick → `line2`. rgba `.6` 13 → `panel2`; `rgba(15,23,42,.95)` 69 dot ring → drop; `rgba(34,197,94,.06)` 226 best row → `goodBg`. r6/4 → 3; `"50%"` 67 dot keep. uppercase 14; ls ×7 → 0.

**views/PlayerProfile/BattingTab.jsx** (12 / 2 / 15). `#475569` ×6 (7, 8, 9, 10, 65, 126) → `text3` / `textDisabled`. `#1e293b` ×2 (6, 141) → `line`. `#cbd5e1` 80 → `text`; `#94a3b8` 134 → `text2`; `#64748b` 81 → `text3`; `#4ade80` 91 → `good`; `#4ade80aa` 90 → `goodSoft`. rgba `.6` 6 → `panel2`; `.4` 140 → `panel`. r6/8 → 3. uppercase ×2 (7, 134), ls ×4 → 0.

**views/PlayerProfile/BaserunningTab.jsx** (13 / 1 / 11). `#cbd5e1` ×5 (46-49, 103) → `text`; `#64748b` ×3 (47-49 labels) → `text3`; `#475569` ×3 (6, 7, 8) → `text3`; `#4ade80` 30 → `good`; `#4ade80aa` 29 → `goodSoft`; `#1e293b` 5 → `line`. rgba `.6` 5 → `panel2`. r6 → 3. uppercase 6, ls ×3 → 0.

**views/PlayerProfile/PercentileBar.jsx** (10 / 1 / 15). `#64748b` ×3 (48, 116, 119) → `text3`; `#475569` ×3 (31, 113, 125) → `textDisabled`; `#cbd5e1` 44 → `text`; `#94a3b8` 106 → `text2`; `#334155` 69 midline → `line2`; `#1e293b` 28 track → `panel3`. rgba `rgba(15,23,42,.95)` 97 ring → drop. `"50%"` ×2 + `TRACK_HEIGHT/2` → rewritten as a pill (B.9). ls .3 (46) → 0.

**views/PlayerProfile/EligiblePositionsTable.jsx** (1 / 1 / 2). `#475569` 10 → `text3`; `rgba(34,197,94,.06)` 20 → `goodBg`. ls 1 (10) → 0. Not imported by the modal today — confirm before spending time.

**views/PlayerProfile/PercentileHeader.jsx** (1 / 0 / 1). `#475569` 139 caption → `text3`; ls 1.2 → 0.

**views/PlayerProfile/_shared.js** — 0.

#### Batch 5 — Roster Planner

**views/RosterPlanner/QueuePanels.jsx** (43 / 4 / 36). `#fca5a5` ×9 (70, 75, 94, 135, 148, 156, 161, 208, 217) → `badSoft`; `#4ade80` ×8 (66, 75, 114, 118, 152, 161, 204, 217) → `goodSoft`; `#22c55e` ×5 borders (66, 114, 152, 204, 216) → `good`; `#ef4444` ×4 borders (70, 156, 208, 216) → `bad`; `#e2e8f0` ×4 names → `text`; `#fde047` ×2 (52, 62) → `warn`; `#fbbf24` ×2 (108, 197) → `warn`; `#93c5fd` ×2 (180, 196) → `accent`; `#7f1d1d` ×2 (92, 133 panel accent) → `bad`; `#475569` ×2 (108, 197) → `textDisabled`; `#78350f` 50 → `warn`; `#1e3a8a` 178 → `accent`; `#1e293b` 37 → `line`. `${accent}0d`/`14` (11, 19) panel tints → `panel` / `panel2` (tint dropped; title carries the semantic colour). rgba headerBg ×4 (51 → `warnBg`, 93/134 → `badBg`, 179 → `accentBg2`) → `panel2`. r8 ×2 → 3.

**views/RosterPlanner/SuperTwoDetailModal.jsx** (33 / 3 / 32). `#94a3b8` ×5 (26, 85, 98, 139, 141) → `text2`; `#475569` ×5: 85 border → `line2`; 97, 136, 143, 171 → `textDisabled`; `#e2e8f0` ×4 → `text`; `#a78bfa` ×4 (80 title, 151 ×2 cutoff rules, 152) → `accent`; `#64748b` ×4 (92, 106, 111, 164) → `text2` headings / `text3`; `#1e293b` ×4 (70 → `line2`; 77, 91, 111 → `line`); `#0f172a` ×3 (70, 78 → `panel`/`panel2`; 133 → `line`); `#4ade80` ×2 (23, 143) → `goodSoft`; `#fbbf24` 24 → `warn`; `#60a5fa` 25 → `accent`. rgba `rgba(0,0,0,.6)` 65 → `scrim`; `rgba(167,139,250,.05)` 134 → `accentBg2`; `.08` 153 → `accentBg`. r10/6 → 3. uppercase ×3 (92, 106, 111), ls ×3 → 0. `fontFamily:"monospace"` 72 → remove.

**views/RosterPlanner/Panels.jsx** (28 / 12 / 28). `#1e293b` ×6 (14, 45 outer → `line2`; 51, 73, 116 ×2 → `line`); `#fca5a5` ×3 (63, 118, 121) → `badSoft`; `#64748b` ×3 (18, 55, 121) → `text3`; `#e2e8f0` ×2 (32, 54) → `text`; `#dc2626` ×2 (14, 63) → `bad`; `#475569` ×2 (20, 126) → `textDisabled`; `#3b82f6` ×2 (31, 45 drop target) → `accent`; `#fde047` 64 → `warn`; `#ca8a04` 64 → `warn`; `#facc15` 92 → `accent`; `#cbd5e1` 118 → `text`; `#a78bfa` 100 → `CHART.series5`; `#94a3b8` 8 → `text2`; `#4ade80` 65 → `goodSoft`; `#22c55e` 65 → `good`. rgba: `.5` ×3 (13 → `panel`; 51, 115 → `panel2`); `rgba(239,68,68,.1)` 13 / `.15` 63 → `badBg`; `rgba(250,204,21,.12)` 64 → `warnBg`; `rgba(34,197,94,.12)` 65 → `goodBg`; `rgba(30,41,59,.95)` 31 → `panel3`; `rgba(96,165,250,.05)` 44 → `accentBg2`; `.3` 44 → `panel`; `.4` 73 → `panel2`; `rgba(0,0,0,.4)` 32 shadow → drop. r8/8/"8px 8px 0 0"/6/4/2 → 3 (header radius 0). 18 uppercase ls .5, 19 ls −.5, 118 ls .3 → 0.

**views/RosterPlanner/RosterPlanner.jsx** (26 / 0 / 15). `#fca5a5` ×4 (475, 491, 494, 503) → `badSoft`; `#4ade80` ×4 (483, 491, 498, 503) → `goodSoft`; `#334155` ×4 (471 ×2, 475 ×2 disabled border/text) → `line2` / `textDisabled`; `#64748b` ×3 (471 border → `line2`; 480, 570 → `text3`); `#fde047` ×2 (501, 503) → `warn`; `#a78bfa` ×2 (509, 513) → `CHART.series5`; `#94a3b8` ×2 (471, 501) → `text2`; `#22c55e` ×2 (481/482 legend underlines) → `good`; `#fb923c` 498 → `warn`; `#dc2626` 475 → `bad`; `#93c5fd` 494 → `accent`. r6 (524) → 3.

**views/RosterPlanner/MovesLogPanel.jsx** (23 / 2 / 13). `ACTION_COLORS` 17-22: protect `#fb923c` → `warn`; dfa/trade/nonTender `#ef4444` → `bad`; promote `#22c55e` → `good`; demote `#94a3b8` → `text2`; sign/accept_option/tender `#4ade80` → `goodSoft`; sign_milb/milfa `#c084fc` → `CHART.series5`; decline_option `#fca5a5` → `badSoft`; ilShort `#fbbf24`, ilLong `#f97316` → `warn`; default 29 → `text2`. `#94a3b8` 56 → `text2`; `#475569` 45 grip → `textDisabled`, 56 border → `line2`; `#e2e8f0` 50 → `text`; `#60a5fa` 74 year heading → `text2`; `#38bdf8` 33 dragging border → `accent`; `#1e293b` 33 → `line`; `#64748b` 99 → `text3`. rgba `rgba(56,189,248,.12)` 32 → `accentBg`; `.3` 32 → `panel`. r6 → 3. 74 uppercase ls .5 → 0.

**views/RosterPlanner/CompactPlayerRow.jsx** (18 / 5 / 16). `#475569` ×3 (84, 96, 102) → `textDisabled`; `#94a3b8` ×2 (93, 118) → `text2`; `#64748b` ×2 (10 header, 108) → `text2` header / `text3`; `#1e293b` ×2 (14, 62) → `line`; `#e2e8f0` 87 → `text`; `#cbd5e1` 102 → `text`; `#fbbf24` 102, `#fde047` 108 → `warn`; `#fca5a5` 108 → `badSoft`; `#facc15` 70 current-coverage bar → `accent`; `#38bdf8` 71 hover bar → `accent`; `#a78bfa` 70, `#c4b5fd` 122 → `CHART.series5`. rgba `rgba(15,23,42,.35)` 14 → `panel2`; `rgba(139,92,246,.12)` 67 → series5 12% over panel; `rgba(250,204,21,.12)` 67 → `accentBg`; `rgba(56,189,248,.10)` 68 → `panel3`; `rgba(139,92,246,.15)` 122 → series5 15%. r3 ×2 keep. 10 header uppercase ls .3 → 12px Archivo Narrow 600 sentence case. boxShadow inset bars (69-71) → keep as the left rule (2px `accent`; it is a border, not a shadow).

**views/RosterPlanner/_shared.js** (13 / 3 / 10). `BUCKET_CONFIG` 11-17: active `#22c55e` → `good`; fortyMan `#60a5fa` → `accent`; ilShort `#fbbf24`, ilLong `#f97316`, r5Risk `#f97316` → `warn`; prospects `#a78bfa` → `CHART.series5`; departing `#ef4444` → `bad`. `SEVERITY_STYLES` 21-23: error → `badBg`/`bad`/`badSoft`; warning `rgba(250,204,21,.10)`/`#ca8a04`/`#fde047` → `warnBg`/`warn`/`warn`; info `rgba(96,165,250,.10)`/`#2563eb`/`#93c5fd` → `accentBg2`/`accent`/`accent`.

**views/RosterPlanner/SuggestionsPanel.jsx** (11 / 2 / 12). `TYPE_COLORS` 11-17: protect `#f97316` → `warn`; considerProtect `#fbbf24` → `warn`; milfa `#c084fc` → `CHART.series5`; dfa `#ef4444` → `bad`; promote `#22c55e` → `good`. `#475569` ×2 (69, 74) → `textDisabled`; `#e2e8f0` 47 → `text`; `#64748b` 48 → `text3`; `#4ade80` 58 → `goodSoft`; `#1e293b` 44 → `line`. rgba `rgba(34,197,94,.08)` 43 → `goodBg`; `.3` 43 → `panel`. r6 → 3.

**views/RosterPlanner/Rule5RiskPanel.jsx** (9 / 4 / 8). `#94a3b8` ×2 (22, 77) → `text2`; `#fbbf24` 28 → `warn`; `#1e293b` 20 → `line`; `#334155` 65 → `line2`; `#64748b` 65 → `text3`; `#475569` 40 → `textDisabled`; `#fca5a5` 51 → `badSoft`; `#fdba74` 51 → `warn`. rgba `.35` 20 → `panel2`; `rgba(239,68,68,.15)` 50 → `badBg`; `rgba(249,115,22,.15)` 50 → `warnBg`; `rgba(100,116,139,.15)` 77 → `panel3`.

**views/RosterPlanner/MlfaSection.jsx** (9 / 2 / 7). `#c084fc` ×3 (15, 20, 29) → `CHART.series5` (title → `text`); `#4ade80` ×2 (32, 35) → `goodSoft`; `#1e293b` ×2 (10 → `line2`; 13 → `line`); `#7c3aed` 20 → `line2`; `#22c55e` 35 → `good`. rgba `.6` 10 → `panel`; `rgba(124,58,237,.15)` 29 → series5 15%. r8 → 3.

**views/RosterPlanner/DepthChartPanels.jsx** (1 / 0 / 1). `#475569` 81 → `textDisabled`.

#### Batch 6 — Dev Analysis

**views/DevAnalysis/DevScatterChart.jsx** (53 / 2 / 50; hand-rolled SVG, no Recharts). `#64748b` ×13: 155-158 svg tick/axis-title fills → `CHART.axis`; 200, 204, 209-211, 217, 218, 222, 223 tooltip text → `text3`. `#e2e8f0` ×8: 176/177 marker ring strokes → `text`; 194, 218, 223, 242, 246, 250 → `text`. `#3b82f6` ×8 "Current" series (89, 159, 166, 176, 182, 184, 216, 241) → `CHART.series1`. `#22c55e` ×8 "Potential" (90, 160, 167, 177, 183, 185, 221, 245) → `CHART.series2`. `#94a3b8` ×6: 171/172 crosshair strokes → `text2`; 181, 203, 217, 222 → `text2`. `#1e293b` ×4: 153/154 grid strokes → `CHART.grid`; 208/248 rules → `line`. `#f59e0b` ×3 (175 locked-trend line, 237, 249) → `CHART.series4`; `#f59e0b44` 232 → `CHART.tooltipBorder`. `#475569` ×2 (147, 253) → `textDisabled`. `#334155` 190 → `CHART.tooltipBorder`. rgba `.92` ×2 (190, 232) → `CHART.tooltipBg`. r6 ×2 → 3; `"50%"` ×2 legend dots keep; r1 ×2 legend bars → 0.

**views/DevAnalysis/CurveTuningPanel.jsx** (42 / 2 / 32). `#1e293b` ×10: 8, 20 borders → `line2`/`line`; 40, 122, 133 slider gradient start → flat `line2` track; 100 grid → `CHART.grid`; 103 tooltip border → `CHART.tooltipBorder`; 141-143 button bg → `panel`. `#64748b` ×6: 10, 51, 148 → `text3`; 101 ×2 / 102 axis → `CHART.axis`. `#94a3b8` ×5: 63, 70, 142, 143 → `text2`; 106 empirical line → `text2`. `#475569` ×5 (46, 141-143 disabled, 153) → `textDisabled`. `#334155` ×5 (64, 71, 72, 142, 143) → `line2`. `#38bdf8` ×4: 105 parametric line → `CHART.series1`; 40/122 gradient end, 48 value → `accent`. `#3b82f6` ×3 (62, 64, 141) → `accent`; `"#fff"` ×2 (63, 141) → `accentText`. `#e2e8f0` 9 → `text`; `#cbd5e1` 28 → `text`; `#a78bfa` 133 → `accent`; `#0f172a` 103 tooltip bg → `CHART.tooltipBg`. rgba `.4` 8 → `panel`; `.6` 19 → `panel2`. r8/10/6/4×3 → 3; r3 track keep; r0 keep. 28 uppercase ls .4 → 0. `fontFamily:"monospace"` 148 → remove; `<code>` 94-95 → `<span>` (D.11). Gradients ×3 → removed.

**views/DevAnalysis/WarPercentileChart.jsx** (36 / 0 / 25). `#64748b` ×12: 33/34 axis ticks+labels → `CHART.axis`; 42-49 tooltip counts → `text3`. `#3b82f6` ×5 (25, 47, 54, 55, 60 median + bands) → `CHART.series1` (bands 18%/35%). `#fbbf24` ×2 (43, 56 p99) → `CHART.series4`; `#f59e0b` ×2 (44, 57 p95) → `CHART.series6`; `#22c55e` ×2 (45, 58 p90) → `CHART.series2`; `#86efac` ×2 (46, 59 p75) → `goodSoft`; `#94a3b8` ×2 (48, 61 p25) → `text2`; `#f87171` ×2 (49, 62 p10) → `CHART.series3`; `#475569` ×2 (14, 68) → `textDisabled`; `#334155` ×2 (41 → `CHART.tooltipBorder`; 63 zero line → `text2`); `#1e293b` ×2 (32 → `CHART.grid`; 41 tooltip bg → `CHART.tooltipBg`); `#e2e8f0` 42 → `text`. r6 → 3.

**views/DevAnalysis/GapDistributionChart.jsx** (25 / 0 / 20). `#8b5cf6` ×7 (21, 22, 31, 49, 56, 57, 58 the gap series) → `CHART.series5` (bands 18%/35%). `#64748b` ×4 (37/38 ticks+labels) → `CHART.axis`. `#334155` ×4: 21 → `line2`; 23 "|" → `line2`; 45 → `CHART.tooltipBorder`; 59 zero line → `text2`. `#94a3b8` ×3 (19, 48, 50) → `text2`. `#1e293b` ×2 (36 → `CHART.grid`; 45 tooltip bg → `CHART.tooltipBg`). `#f87171` 51 → `bad`; `#e2e8f0` 46 → `text`; `#475569` 15 → `textDisabled`; `#22c55e` 47 → `good`; `#0f172a` 21 → `bg`. r4/6 → 3.

**views/DevAnalysis/LiveProspectPreview.jsx** (12 / 1 / 10). `#94a3b8` ×3 (63-65) → `text2`; `#475569` ×3 (37, 61, 66) → `textDisabled` (61 rank → `text3`); `#64748b` ×2 (40, 79) → `text3`; `#e2e8f0` 62 → `text`; `#93c5fd`/`#3b82f6`/`#334155` 79 pills → `accent`/`accent`/`line2`. rgba `.3` 60 → `zebra`.

**views/DevAnalysis/FVImpactTable.jsx** (11 / 2 / 10). `#475569` ×4 (62, 70, 91, 130) → `text3`; `#94a3b8` ×2 (79, 87) → `text2`; `#e2e8f0` 111 → `text`; `#7dd3fc` 111 p50 label → `accent`; `#64748b` 117 → `text3`; `#334155` 89 → `line2`; `#0f172a` 89 → `bg`. rgba `rgba(56,189,248,.07)` 110 → `accentBg2`; `.3` 110 → `zebra`. r4 → 3.

**views/DevAnalysis/BandwidthControl.jsx** (9 / 1 / 6). `#334155` ×2 (13, 27) → `line2`; `#94a3b8` 17 → `text2`; `#64748b` 27 → `text3`; `#475569` 29 → `textDisabled`; `#22c55e`/`#86efac` 26 → `good`; `#3b82f6` 9 default accentColor → `accent`; `#0f172a` 13 → `bg`. rgba `rgba(34,197,94,.15)` 26 → `goodBg`. r4 → 3.

**views/DevAnalysis/DevAnalysisView.jsx** (2 / 0 / 2). `#94a3b8` 372 → `text2`; `#475569` 383 → `textDisabled`.

---

## B. Structural rework list

Estimates are lines changed / hours for one engineer who already has the token file. "Risk" is
about regressions, not effort. Line cites are to today's files.

### B.1 Dashboard.jsx sidebar → paper panel (`Dashboard.jsx:226-287`)
- **What:** `<nav>` becomes the 200px `panel` column with a `line2` right rule; brand row (230) = league
  name Archivo 800 22px + "GM Dashboard" suffix in `text3` Archivo Narrow; the League / My Team / Game
  Date block (234-262) becomes one bordered `panel2` box with 11px Archivo Narrow labels and underlined
  value rows (selects styled borderless, `borderBottom line2`); page list (264-276) = plain Archivo
  Narrow rows, active = 700 + a 5×10px rotated-border ✓ in `accent` at left (CSS `::before` in the
  mockup → an absolutely positioned `<span>` here, since inline styles have no pseudo-elements), hover
  `panel2`; Settings (277-286) pinned with `marginTop:auto` above a `line` rule. Main column padding
  `18px 24px 48px`.
- **Why:** dir-2/dir-6 layout model ("200px sticky paper sidebar… active page = bold with a red pencil ✓
  at left; Settings pinned").
- **Open:** the mockup has no collapsed (52px) state and no emoji icons (`PAGES[].icon`). Keep the
  collapse toggle (231) as a plain `text3` glyph and keep icons only in the collapsed rail — decision needed.
- **Estimate:** ~70 lines / 3 h. **Risk:** low–medium (keyboard/aria on the nav unchanged; only the
  `role="tab"` buttons restyle).

### B.2 shared.jsx primitives
| Primitive | Lines | Change | Est. | Risk |
|---|---|---|---|---|
| `Section` (41-51) | → scorecard box: outer `panel`/`line2`/r3/`overflow:hidden`; `<h2>` header strip in `panel2` (13.5px Archivo Narrow 700, `borderBottom line2`, min-height 34) with `title` left, new optional `count`/`state` (right, `text3` 12px) and existing `actions` (right); new optional `toolbar` slot rendered as a second `panel2` strip (8/12 padding, `borderBottom line2`) — the board filter bars move here; new optional `footer` slot (`line` top rule, 12px `text3`); body padding 12 (tables: 0, they run edge to edge). | 45 lines / 1.5 h | **Medium** — 24 files use `Section`; every body that assumed `S.section` padding 20 renders tighter; tables need `S.tableWrap` border removed so the box border is the rule. |
| `Toggle` (422-440) | two variants: `inline` (current, for toolbars) and `row` (ruled rows: `padding 8px 12px`, `borderTop line` between siblings, hover `panel2`, label 13px `text2`→`text` when on, description 12px `text3`); switch 30×17 `bg` well + `line2` ring, knob 11px `text3`; on = `accent` track + `accentText` knob; focus ring `focus` 28%. | 35 lines / 1 h | low |
| `PillBtn` (63-68) + `S.pillBtn` | r3, Archivo Narrow 600 13px; inactive `panel`/`line2`/`text`; active `accent` fill + `accentText` (tabs) — or `accentBg` + `accent` text for filter toggles (decide per call site; `TabGroup` callers → filled). `S.pillBtn` r20→3 changes all 35 spread sites at once. | 15 lines / 0.5 h | low |
| `TabGroup` (407-413) | unchanged API; when used as the modal tab strip, render children inside a `panel2` strip with the active pill drawn as the sorted-underline style (`boxShadow: inset 0 -2px 0 accent`). | 10 lines / 0.5 h | low |
| `SortHeader` (53-61) | `S.th` restyle (12px Archivo Narrow 600 `text2`, `panel2`, sentence case); sorted = `text` + `boxShadow: inset 0 -2px 0 accent`; hover `text`; `position: sticky; top: 0; zIndex: 2`. | 15 lines / 0.5 h | **Medium** — sticky only works against a scrolling ancestor; `S.tableWrap` is `overflowX:auto` (a scroll container) so the header sticks to the wrapper, not the viewport. Either cap table height (`maxHeight: 70vh; overflowY: auto` on the wrap — then it sticks inside the box) or drop sticky. Decide in batch 1 (D.10). |
| `MultiSelectDropdown` (79-207) / `NumericRangeFilter` (297-405) / `S.searchInput` / `S.filterSelect` | buttons = raised `panel` selects (`line2` border, Archivo Narrow 600 13px, hover border `text`); text/number inputs = sunken `bg` wells (`line2`, hover `text2`, focus `focus` + 26% ring); popovers = opaque `panel`, `line2`, r3, no shadow; option rows hover `panel3`, checked `accentBg` + `text`; headings 12px Archivo Narrow sentence case; CLEAR links `accent`; search gets the inline magnifier (`backgroundImage` data-URI, `paddingLeft 26`). | 80 lines / 2 h | low |
| `Pagination` (455-466) | becomes the foot strip of the box: `panel2`, `borderTop line2`, `8px 12px`, Archivo Narrow 12.5px `text2`; count left, Prev/Next `panel`/`line2`/`text` r3, disabled = `textDisabled`/`line`. Needs to render *inside* the `Section` (today it is a sibling after the table inside the Section body — fine; it just loses its `marginTop: 8`). | 15 lines / 0.5 h | low |
| `FileDropZone`/`DataLoader` (442-502) | `S.dropZone` r3 `line2` dashed; ready `good`/`goodBg`; dragover `accent`/`accentBg2`; idle `panel2`; load button primary. | 15 lines / 0.5 h | low |
| `TwoWayBadge` (415-420) | outlined chip: `warn` text+border, transparent bg, r3, Archivo Narrow 700 10px (D.6). | 5 lines | low |

### B.3 Column-group rules (per-view `groups`)
- **Mechanism:** every column entry gets a `group` string (`{ key, label, w, group: "value" }`); a
  helper `colRule(cols, i)` (new, in `shared.jsx`) returns `{ borderLeft: "1px solid " + line2 }` when
  `cols[i].group !== cols[i-1].group`, spread into the `<th>` (via `SortHeader` — add a `rule` prop) and
  every `<td>`. Tables whose tds are hand-written (all of them) need the spread added per cell; tables
  that render by key-switch (PlayersView 140-165) add it in the switch wrapper. First/last cells get
  12px box padding. No DOM change beyond the style spread.
- **Tables that need a `groups` assignment** (proposed groups; identity | value | development | health | contract, per the mockup):
  1. **PlayersView** (`constants.js:460-462` HIT/PIT/MIXED): Name Age POS Best Team Lvl | FV WAR WAR P (PIT: SP WAR RP WAR SP WAR P RP WAR P) | Dev% (PIT: + STM SP?) | Prone INTG | Salary.
  2. **FreeAgentFinder** (174-186): [Smart] | Name Age POS Best | FV WAR WAR P | Dev% Pro Yrs | Prone | Salary.
  3. **WaiverWireView** `cols` (39-56): Smart/WAR P | Name Age POS Best From Lvl | Left | FV WAR WAR P | Dev% | Salary Yrs Opt | Prone.
  4. **DraftBoard** (860-875): [pick] Smart/WAR P | Name Age | Dev% | POS Best | [Raw] | [DEM Sign] | Prone INTG INT WE LEA.
  5. **IAFABoard** (104-117): Signed Smart/WAR P | Name Age | Dev% | POS Best | [Raw] | Prone INTG WE INT | DEM.
  6. **Rule5Board** (103-117): Smart/WAR P | Name Age | Dev% | POS Best Team Lvl | FV WAR WAR P | Prone [Raw] B/T.
  7. **ScoutView** roster (198) and trade-targets (165): Name Age POS Best B/T Lvl 40M | FV WAR WAR P | Dev% | Prone Fit Salary.
  8. **ProspectsView** board (307-321): Rank Org Tier | Name Age | Dev% | POS Best Team Lvl | FV WAR WAR P | $ Val; farm rankings (464-476): # Team | Value #P Avg | tier counts | Ceil Floor Bat Pit | Report; config table (216-276): Tier | thresholds | $ | counts | ranges.
  9. **PlayerCompareView** (147-217): rows are stats, columns are players — rule between the stat-label column and the first player only (group = "label" | "players").
  10. **Org/OverviewSubTab** (56): Name Age POS Best B/T Lvl 40M | FV WAR WAR P Dev% | Prone INTG | Salary.
  11. **Org/OptimizedLineupSubTab** (53-61): # | Name POS Best B/T | WAR DEF | OBP wOBA.
  12. **Org/PositionalStrengthTable** (grid, 126-149): POS | Age | Now (bar·score·rank) | Farm — rules between POS/Age/Now/Farm columns (grid `borderLeft` on the cell wrappers).
  13. **RosterPlanner** `CompactPlayerRow`/`CompactRowHeader` grid (7-30): grip POS NAME AGE | WAR POT DEV% FV | SALARY OPT | tags; **SuperTwoDetailModal** (111-119): Rank Name POS ORG Status | Current Projected | S2.
  14. **PlayerProfile/FieldingTab** eligibility table (201-259): Pos | WAR RunsP | PosAdj Score; **ContractTab** year table (245): Year Age Status | Salary | Notes; **DevAnalysis/FVImpactTable** (99-102): Dev% | Age 14…26; **LiveProspectPreview** (45-55): Rk Name Age Pos Org | Dev% Cur Pot FV.
- **Estimate:** ~14 tables × ~20 touched lines ≈ 280 lines / 7 h (batch 2 carries 9 of them).
- **Risk:** low per table; medium in aggregate (easy to miss a `<td>` in a conditional column — add a
  one-line dev assertion that `cols.length === children.length` in DEV builds, or rely on screenshots).

### B.4 Board filter bars → inside the box header strip
Today each filter bar is a flex row *inside the Section body* above the table; the mockup puts it in a
second `panel2` strip under the title (`toolbar` slot from B.2).
- FreeAgentFinder 161-169 (PositionFilter · search · Age · Pro Yrs · "Gap fills only" Toggle pushed right) · WaiverWireView 232-238 (shared by three tables — toolbar on the first box only) · DraftBoard 837-855 (PositionFilter, search, Export Top 500 → the export becomes a secondary button in the header `actions`) · IAFABoard 86-99 (PositionFilter · search · Hide-signed PillBtn · Clear-signed link) · Rule5Board 93-98 · ScoutView 191-194 (PositionFilter · LevelFilter) · ProspectsView 286-302 (two rows today; keep `flexWrap`) · Org/OverviewSubTab 51-54 · PlayerCompareView 100-142 (search + chips stay in the body; the box title gets the player count) · **PlayersView 111-134 has no Section at all** — wrap the page in one box titled "All Players (N)" with the two filter rows in the toolbar and the summary line (123-134) as the header `state` text.
- Smart Rank Adjustments (7 copies: FA 150-157, Waiver 221-228, IAFA 76-83, Rule5 82-89, Scout 106-113, Draft 814-832 with 7 toggles) → `Toggle variant="row"` inside a box that has no body padding; one shared `SmartRankBox` component would remove 6 copies (optional, ~40 lines).
- **Estimate:** ~10 views × 10 lines + PlayersView box 20 = ~120 lines / 3 h. **Risk:** low; verify 1440 width with all toolbar controls on one row (mockup wrapped to two rows at 1192px — `flexWrap: wrap` everywhere).

### B.5 PositionalStrengthTable bar + heat (`PositionalStrengthTable.jsx:82-100, 126-155`)
- **What:** `bar()` keeps the centre-zero geometry but: track fill `rgba(30,41,59,.45)` removed (centre
  line `line2` + left/right edge ticks `line` only — mockup `td.zbar::before`), fill colour = `zHeat(z).bar`
  (`#e86c5f` negative / `#6193de` positive), height 11, width `min(|z|/2.5,1)·48%`; score + rank cells become
  heat cells: bg `zHeat(z).bg`, text `zHeat(z).text` (cream ≤72% mix, ink ≥80%), weight 600, right aligned.
  Header row → 12px Archivo Narrow `text2` sentence case; age ≥31 → `warn`; expanded depth panel → `panel2`.
  `zToColor` keeps serving FortyManSubTab 113-126 (rank/z header strip) with the same key set.
- **Estimate:** 50 lines / 2 h. **Risk:** low; contrast note — heat text at |z| 1.8–2.0 sits at ≈4.1:1 (documented in the dir-6 report).

### B.6 FV tier badge → filled pill
- **Where tiers render today:** only `ProspectsView.jsx` — board cell 236-240 (`_tierId`), tooltip 374-377,
  config-table count cell 494, bar fills 524, legend swatches 534, and the Farm Rankings tier-count
  columns (text only). Boards (FA/Waiver/Draft/IAFA/Rule5/Scout/Players) show FV as a **number** via
  `warStyle` and have no tier badge; PlayerProfileModal shows FV as a tile value (79) — neither renders a tier.
- **Change:** pill = `tierChip(id)` `{bg,text:#141516}`, r10 (the one 10px radius), Archivo Narrow 700 12px,
  min-width 30, line-height 18. `FV_TIER_COLORS` → `{bg,text}` per key (breaking; 7 call sites listed in A.2).
- **Estimate:** 30 lines / 1 h. **Risk:** low.

### B.7 Level badge → ladder chip
- **Where `levelColor` renders (all as coloured text):** WaiverWireView 93 · Rule5Board 133 · ScoutView 178, 211 · PlayersView 156 · ProspectsView 347 · PlayerCompareView 40 · Org/OverviewSubTab 64 · Org/PositionalStrengthTable 114 · Org/FortyManSubTab 141 · PlayerProfileModal 72 (Tile value).
- **Change:** table cells render `levelChip(lev)` = filled chip (`{bg,text,border:line2}`; INT = dashed `#dfb04c` outline), 17px line-height, Archivo Narrow 700 12px, r3. Depth lists / tiles that want text keep `levelColor()` — but see D.8: the ladder fills are greys (`A+ #5f5d57`, `A #45443f`, `R #323130`) that fail as text on `panel` (2.6:1, 1.9:1, 1.4:1). `levelColor` as a *string* must return a text-safe colour; proposal: `MLB text · AAA #bdb8ad · AA #8d8a82 · A+ text3 · A text3 · R textDisabled · INT #dfb04c`, and use `levelChip` wherever the level is a column.
- **Estimate:** 11 sites × 2 lines + helper = ~30 lines / 1 h. **Risk:** low; row height 29px already fits a 17px chip.

### B.8 PlayerProfileModal + tabs (`PlayerProfileModal.jsx:263-359`, five tabs)
- **What:** scrim `rgba(0,0,0,.6)`; box `width 960` (today 800), `maxHeight 90vh`, `panel`/`line2`/r3,
  no shadow; the 36px close bar (270-272) merges into the header bar: one `panel2` strip with name
  (Archivo 800 20px) · `posChip` · `levelChip` · FV `tierChip` (FV is a WAR-scale number today — see D.9)
  left, ✕ right; header tiles (54-85) → 8px-grid stat tiles in `panel2`/`line`/r3 with 12px Archivo Narrow
  labels; `PercentileHeader` → Savant pills (B.9); `FVProjectionChart` → CHART tokens; tab strip (331-344)
  = `panel2` strip, active tab = sorted-underline; tab bodies: the `tS/tL/sectionLabel` trio duplicated in
  BattingTab 6-8, PitchingTab 5-7, FieldingTab 13-15, BaserunningTab 5-7, ContractTab 12-14 → one export
  in `PlayerProfile/_shared.js` (or `theme.js S.tile/S.tileLabel`), tiles `panel2`/`line`/r3, labels 12px
  Archivo Narrow `text3` sentence case, "POT" `goodSoft`; FieldingTab eligibility table and ContractTab
  year table get group rules; status badges (246-251, 298) → `{bg,text,border}` per badge.
- **Estimate:** modal 40 lines / 1.5 h; tabs 5 × 20 lines / 2 h; `_shared` tile styles 10 lines. **Risk:** medium — the 960px box on a 1440 viewport with the 200px sidebar leaves 1240px of content; fine. Pitcher vs hitter layouts both need a screenshot.

### B.9 PercentileBar → Savant pill (`PercentileBar.jsx:36-127`)
- **What:** today: 6px track (`#1e293b`), 50th tick, a 14px dashed "potential" ring and a 12px filled
  "current" dot coloured by `gradeToColor(pctToGrade(pct))`, value column right. Mockup: a filled pill whose
  **width = percentile** and fill = the tier-pill fill rule (`tierChip` ramp by grade), ink text inside
  showing the percentile, track `panel3`. Two values (current + potential) cannot both be one pill →
  proposal: current = filled pill to `pct%`; potential = 1px dashed outline pill to `potPct%` drawn
  underneath (same row, `zIndex` 0); label/value columns unchanged. `dotColor` → `gradeToColor` on the new ramp.
- **Estimate:** 60 lines / 2 h. **Risk:** low–medium (design call on the potential marker; D.9).

### B.10 ActiveRosterSubTab diamond + chips (`ActiveRosterSubTab.jsx:33-117`)
- Fills/strokes per A.2 (grass → `goodBg`-class greens at 4–6%, dirt/mound → `CHART.series6` tan at 8–25%, bases `text2`, plate `text`, lines `line`, mound stroke `line2`); chips → `panel`/`line2`/r3, hover border `text`, no shadow; empty slot = dashed `line2` on `bg`; POS label Archivo Narrow 700 `posColor`; injured name `warn` + INJ `bad`; section labels (174) 12px Archivo Narrow sentence case. The four groups (Rotation / Bullpen / Starting Lineup / Bench) sit inside one `Section` — keep; optionally make them four `panel-foot`-style sub-captions.
- **Estimate:** 30 lines / 1 h. **Risk:** low.

### B.11 RosterPlanner panels (`Panels.jsx`, `QueuePanels.jsx`, `MlfaSection.jsx`, `Rule5RiskPanel.jsx`, `SuggestionsPanel.jsx`, `MovesLogPanel.jsx`, `SuperTwoDetailModal.jsx`, `CompactPlayerRow.jsx`)
- `DroppablePanel` (Panels 40-60), `CollapsiblePanel` (QueuePanels 7-31), `MlfaSection` wrapper (10-24),
  `SummaryCard` (Panels 8-23) → the scorecard-box recipe (`panel`/`line2`/r3; header strip `panel2`
  13.5px Archivo Narrow 700; subtitle/count `text3`; the 8×22 accent bar (Panels 53) → a 3px left rule in the
  bucket colour, or dropped). Drop target: `accent` border + `accentBg2`. Drag overlay (Panels 25-38):
  `panel3` + `accent` border, **no shadow** (the one `boxShadow` lift in the app — decision D.12).
  `CoverageStrip` tiles (62-66, 88-103): `badBg/badSoft/bad`, `warnBg/warn`, `goodBg/goodSoft/good`, hover
  `accent` border, drop the `scale(1.05)`. `SlotGroup` sub-headers → `panel2` strips. `CompactPlayerRow` →
  29px rows, `line` rule, hover `panel3` + 2px `accent` left rule; coverage highlight current `accentBg`,
  potential series5 12%; header 12px Archivo Narrow sentence case; chips r3 Archivo Narrow 700. Queue rows:
  action buttons `PillBtn` secondary (`panel`/`line2`) with `good`/`bad` text+border; panel titles carry the
  semantic colour (warn/bad/accent) instead of tinted backgrounds. Moves log: action colour map per A.2;
  year heading `text2` sentence case. Super-Two modal: same framing as B.8 (`maxWidth 880`, header strip,
  cutoff row `accent` rules + `accentBg`), remove `monospace`. Crunch warnings (RosterPlanner 518-533):
  `SEVERITY_STYLES` → badBg/warnBg/accentBg2 boxes r3.
- **Estimate:** ~180 lines / 6 h. **Risk:** medium — dnd-kit visual states (drag source, overlay, `isOver`, sortable dragging opacity) must be re-verified by hand; `DragOverlay` is portal-rendered outside the box.

### B.12 LeagueSettingsModal (`LeagueSettingsModal.jsx:53-135`)
- Scrim keep; box 520 `panel`/`line2`/r3, header strip with title + ✕; field labels 12px Archivo Narrow `text2`; inputs = wells; team chips r3 outlined (`goodBg`/`good` forced-include, `badBg`/`bad` excluded); footer Cancel secondary / Save primary. Remove `backdropFilter` and the JetBrains stack.
- **Estimate:** 25 lines / 1 h. **Risk:** low.

### B.13 DraftBoard — what the 106 hexes are (`DraftBoard.jsx`)
- 59 are plain text-tier literals (`text`/`text2`/`text3`) on captions, stats lines (475-478), card grid
  labels (616-625), cap-editor captions — pure swaps. 15 borders (`line2`). 9 placeholders. 11
  accent/button colours on the StatsPlus feed buttons (455-465), Edit/Reset pills (645-647, 682, 702),
  the ∞ "open cap" glyph (791), ★/DRAFTED manual-pick marks (890, 897). 12 are **state encodings on two
  meters**: the Budget bar (517-525: >50% `good`, 20–50% `warn`, <20% `bad` on a `panel3` track) and the
  Position-Caps rows (706-811: count colour ladder 718-721 unmet `bad` / zero `text3` / open `good` / over
  `bad` / in-overage `warn` / ok `good`; fill bar 775 `good`/`warn`/`bad`; soft-cap tick 778 `text2`;
  parent rows `panel3`). Plus the My-Draft-Class card grid (544-631): empty upcoming-pick card dashed
  `line2` on `panel` at 70% opacity; drafted card `panel2`/`line`; manual pick `accentBg2`/`line2` with ✕
  `bad`; Demand `$` `warn`; Sign difficulty via `signColor` (D.4). Structural: "Draft Settings" Section
  title is a clickable span (484-491) — becomes the header-strip `actions` chevron; "Position Caps"
  Section `actions` (637-650) keeps the stepper. The Draft Board table gets the pick column (860) in the
  identity group.
- **Estimate:** 88 lines / 4 h. **Risk:** low–medium (many conditional columns: `anyToggle`, `demandsOn`).

### B.14 Recharts + DevScatterChart → `CHART` tokens
| File | Components and colour props to change |
|---|---|
| `PlayerProfile/FVProjectionChart.jsx` 43-58 | `CartesianGrid stroke` → grid; `XAxis`/`YAxis` `stroke` + `tick.fill` + `label.fill` → axis; custom `FVTooltip` bg/border/r3 → tooltipBg/tooltipBorder; `ReferenceLine y` → text2; `ReferenceLine x=age` stroke+label → series1; `ReferenceLine x=maturity` → text2; `Area band_height` fill → series2 @18%; `Line center_plot` → series1; `Legend wrapperStyle.color` → text2. |
| `DevAnalysis/GapDistributionChart.jsx` 34-62 | grid; `XAxis`/`YAxis` `tick.fill`+`label.fill` → axis (also add `axisLine={{stroke: CHART.grid}}` / `tickLine={false}` — today they fall back to Recharts' default `#666`); custom Tooltip → tooltipBg/tooltipBorder/r3, rows good/text2/series5/text2/bad; `Area outerRange` → series5 @18%, `Area iqrRange` → @35%; `Line median` → series5; `ReferenceLine y=0` → text2; `Legend` inherits. `BandwidthControl accentColor` → `accent` (D.13). |
| `DevAnalysis/WarPercentileChart.jsx` 30-66 | grid; axes as above; Tooltip rows: 99th series4 · 95th series6 · 90th series2 · 75th goodSoft · 50th series1 · 25th text2 · 10th series3, counts text3; `Area outer/iqr` → series1 @18/35%; `Line p99` series4 dashed · `p95` series6 dashed · `p90` series2 · `p75` goodSoft · `median` series1 w3 · `p25` text2 · `p10` series3; `ReferenceLine y=0` → text2. |
| `DevAnalysis/CurveTuningPanel.jsx` 98-108 | `CartesianGrid` → grid; `XAxis`/`YAxis stroke` + label → axis; `Tooltip contentStyle` bg/border → tooltipBg/tooltipBorder (+ add `labelStyle={{color: text}}`, `itemStyle`); `Line parametric` → series1; `Line empirical` dashed → text2; sliders: gradient tracks (40, 122, 133) → flat `line2` track + `accentColor: accent`; value text → `accent`; MaturityToggle → `accent`/`accentText` active, `line2` wrapper r3. |
| `components/ProspectsView.jsx` 515-529 (Farm values BarChart) | `CartesianGrid` → grid; `XAxis tick.fill` → axis; `YAxis tick.fill`+`label.fill` → axis; `Bar fill` per tier → `tierChip(id).bg`; `FarmStackedTooltip` (364-391) bg/border/r3 → tooltip tokens; legend swatches (531-538) → tier fills r3. |
| `DevAnalysis/DevScatterChart.jsx` (raw SVG) 151-186, 188-254 | grid lines → grid; tick/axis-title fills → axis; current points/path/marker/legend → series1; potential → series2; crosshair → text2; locked-trend marker + tooltip accents → series4; marker rings → text; tooltips → tooltipBg/tooltipBorder r3; tables inside tooltips → text/text2/text3. |
- **Estimate:** ~120 lines / 4 h. **Risk:** low; Recharts 3.7 accepts literal hex strings everywhere listed — no `var()` needed (that is why `TOKENS` stays a JS object).

### B.15 App.jsx loader / dropzone (`App.jsx:8-23, 191-200`; `shared.jsx:442-502`; `theme.js:124-128`)
- ErrorBoundary page `bg`, heading `bad`, button secondary; loading card `panel`/`line2`/r3, no blur, wordmark Archivo 800 42px ls −0.04em, caption 12px Archivo Narrow `text3`; `DataLoader` dropzones per B.2; load button primary. ~25 lines / 0.5 h. Risk: none.

---

## C. Batches

Each batch must leave the app shippable: the dev server renders every page, no console errors, the
gate greps for *that batch's files* return 0, and the 1440 no-horizontal-scroll check passes on the
boards touched. Screenshots: before/after at 1440×1000 for each listed page (`app/docs/redesign/shots/`,
not committed if large). The cumulative "all-src" greps are listed once at the end of this section.

| # | Files | Size | Screenshot before/after | Verification |
|---|---|---|---|---|
| **0 Foundation** | `theme.js` (TOKENS, CHART, encodings, helpers, `S`), new `tokens.css` + `gen-tokens-css.mjs`, `index.html` (fonts link, body bg/font), `App.jsx` | ~220 lines / 6 h | Loading screen; Error boundary (force one); any board (to see the global `S.th`/`S.td`/`S.pillBtn` restyle land everywhere at once) | `grep -cE '#[0-9a-fA-F]{6}\b' app/src/theme.js` = count of TOKENS literals only (no slate hexes: `grep -cE '#0f172a\|#0c1222\|#1e293b\|#334155\|#475569\|#64748b\|#94a3b8\|#e2e8f0\|#cbd5e1\|#3b82f6' app/src/theme.js` = 0); `grep -rn 'JetBrains' app/src app/index.html` = 0; `grep -rn '145deg' app/src` = 0; fonts load (Network tab shows `fonts.gstatic.com`); every page renders (12 nav items + modal); `node app/docs/redesign/contrast.mjs` agrees with the dir-6 table. |
| **1 Shell + primitives** | `shared.jsx`, `Dashboard.jsx`, `LeagueSettingsModal.jsx` | ~260 lines / 8 h | Sidebar (expanded + collapsed), FA Finder full page (the mockup page), Players, Waiver Wire, League Settings modal open, a MultiSelect popover open, a NumericRange popover open | `grep -cE '#[0-9a-fA-F]{6}\b' app/src/components/shared.jsx app/src/components/Dashboard.jsx app/src/components/LeagueSettingsModal.jsx` → 0 0 0; `grep -rn 'boxShadow\|linear-gradient\|backdropFilter' app/src/components/shared.jsx app/src/components/Dashboard.jsx app/src/components/LeagueSettingsModal.jsx` → only the `inset 0 -2px 0` sort underline and the focus ring; no `borderRadius: (8|10|12|20)`; `document.documentElement.scrollWidth === 1440` on FA / Players / Waivers at 1440×1000; keyboard: Tab through sidebar, dropdowns, toggles still works; sticky-header decision recorded (D.10). |
| **2 Boards** | `FreeAgentFinder`, `WaiverWireView`, `DraftBoard`, `IAFABoard`, `Rule5Board`, `ScoutView`, `PlayersView` (+ `utils/constants.js` group fields), `ProspectsView`, `PlayerCompareView` | ~420 lines / 14 h | Each of the 9 pages at 1440 (Prospects: Board + Farm tabs; Rule 5: board tab; Draft: with Draft Settings open and a manual pick; Waiver: live + stale sections; Compare with 3 players) | `grep -cE '#[0-9a-fA-F]{6}\b\|rgba\(' app/src/components/{FreeAgentFinder,WaiverWireView,DraftBoard,IAFABoard,Rule5Board,ScoutView,PlayersView,ProspectsView,PlayerCompareView}.jsx` → all 0 (encodings come from helpers only); `grep -rn 'FV_TIER_COLORS\[' app/src` → 0 outside `tierChip`; each table has a `group` on every column and the rules render; 1440 no-scroll on all 9 (Draft with `demandsOn` + `anyToggle` = the widest case, 15 columns); tier pills r10, everything else r3; "NEED" rows tinted `accentBg2` with the pencil tag. |
| **3 Org** | `OrgView`, `OverviewSubTab`, `ActiveRosterSubTab`, `FortyManSubTab`, `OptimizedLineupSubTab`, `PositionalStrengthTable` | ~150 lines / 5 h | Overview (strength table expanded on one row + roster), Active Roster diamond, 40-Man Depth, Optimized Lineup; FA Finder/Waiver/Rule 5/Scout dense strength tables (consumers of PST) | greps → 0 for the 6 files; `grep -n 'rgba' app/src/views/Org/PositionalStrengthTable.jsx` → 0; `zToColor`/`zHeat` are the only heat sources; SVG fills/strokes all token-sourced (`grep -n 'fill="#\|stroke="#' app/src/views/Org/ActiveRosterSubTab.jsx` → 0); no `textTransform` in Org. |
| **4 Player Profile** | `PlayerProfileModal`, `PercentileHeader`, `PercentileBar`, `FVProjectionChart`, `BattingTab`, `PitchingTab`, `FieldingTab`, `BaserunningTab`, `ContractTab`, `EligiblePositionsTable`, `_shared.js` (tile styles) | ~260 lines / 8 h | Hitter modal (each of 4 tabs), pitcher modal (2 tabs, SP and RP role), FV chart hovered, a player with INJ + R5 + 40-Man badges | greps → 0 for the 11 files incl. `#[0-9a-fA-F]{8}\b` and `\$\{[a-zA-Z.]+\}[0-9a-f]{2}` template suffixes; `grep -n 'boxShadow' app/src/views/PlayerProfile` → 0; modal box 960 wide centred; tab strip underline on active; percentile pills readable at 11px. |
| **5 Roster Planner** | `RosterPlanner`, `_shared.js`, `CompactPlayerRow`, `Panels`, `DepthChartPanels`, `QueuePanels`, `MlfaSection`, `SuggestionsPanel`, `MovesLogPanel`, `Rule5RiskPanel`, `SuperTwoDetailModal` | ~260 lines / 8 h | Roster Planner full page; a drag in progress (overlay + `isOver` target); each queue panel open; moves log with 3 moves; Super-Two modal; Rule 5 tab of the Rule 5 Board (same component) | greps → 0 for the 11 files (incl. `\$\{accent\}[0-9a-f]{2}`); `grep -rn 'monospace' app/src/views/RosterPlanner` → 0; `grep -rn 'boxShadow' app/src/views/RosterPlanner` → only the 2px inset left rules; drag/drop still works with keyboard sensor; crunch warnings render in the three severities. |
| **6 Dev Analysis + charts** | `DevAnalysisView`, `DevScatterChart`, `GapDistributionChart`, `WarPercentileChart`, `CurveTuningPanel`, `FVImpactTable`, `LiveProspectPreview`, `BandwidthControl` (+ re-check ProspectsView chart and FVProjectionChart) | ~190 lines / 6 h | Each of the 6 sections, hitter and pitcher; scatter with a locked trend point; tuning panel with dirty sliders | greps → 0 for the 8 files (incl. `#fff\b`); `grep -rn 'linear-gradient' app/src` → 0; `grep -rn 'fill="#\|stroke="#\|stroke: *"#\|fill: *"#' app/src/views/DevAnalysis app/src/views/PlayerProfile/FVProjectionChart.jsx app/src/components/ProspectsView.jsx` → 0; Recharts axes/grids/tooltips visibly on tokens (no `#666` default axis lines); legends readable. |
| **7 Prototype CSS + docs** | `app/docs/prototype.css` (rewritten from `tokens.css`, same class API: `.card .tbl-wrap .num .grade-20…80 .badge .pos-* .lvl-* .tier-* .pill .btn .input .toolbar …`), `app/CLAUDE.md` "Styling" line (10) + "All styling is inline… monospace" (353), `app/docs/FRONTEND_REFERENCE.md` (page notes that name colours: Dev Analysis "Current (blue)/Potential (green)", Scout "weak-pos rows highlighted green", Compare "best green/worst red"), `.claude/skills/lavish-prototype` sample | ~350 lines CSS / 4 h | A `lavish-prototype` sample page rendered against the new CSS | `grep -cE '#0f172a\|#0c1222\|#1e293b\|#334155\|JetBrains\|145deg' app/docs/prototype.css` → 0; `diff <(node app/docs/redesign/gen-tokens-css.mjs) app/src/tokens.css` → empty; docs no longer say "monospace". |

**Cumulative all-src gates (run after every batch; all must print 0 once batch 6 has landed, and the
per-batch subsets above must print 0 immediately):**
```bash
cd app
# slate / Tailwind palette tells
grep -rEc '#0f172a|#0c1222|#0a0f1c|#1e293b|#334155|#475569|#64748b|#94a3b8|#e2e8f0|#cbd5e1|#3b82f6|#2563eb|#60a5fa|#93c5fd|#bfdbfe|#38bdf8|#7dd3fc|#22c55e|#4ade80|#86efac|#ef4444|#dc2626|#f87171|#fca5a5|#7f1d1d|#fbbf24|#f59e0b|#facc15|#fde047|#eab308|#ca8a04|#78350f|#a78bfa|#8b5cf6|#c084fc|#7c3aed|#c4b5fd|#f472b6|#e879f9|#fb923c|#fdba74|#f97316|#34d399|#2dd4bf|#22d3ee|#a3e635|#1e3a5f|#1e3a8a' src | awk -F: '{s+=$2} END {print s}'
grep -rEc 'rgba\(15,23,42|rgba\(30,41,59|rgba\(51,65,85|rgba\(59,130,246|rgba\(96,165,250|rgba\(56,189,248|rgba\(34,197,94|rgba\(239,68,68|rgba\(250,204,21|rgba\(251,191,36|rgba\(249,115,22|rgba\(139,92,246|rgba\(124,58,237|rgba\(167,139,250|rgba\(166,128,89|rgba\(148,163,184|rgba\(100,116,139' src | awk -F: '{s+=$2} END {print s}'
# alpha-suffix tricks, #fff, 8-digit hexes
grep -rEc '#[0-9a-fA-F]{8}\b|#fff\b|\$\{[A-Za-z_.]+\}[0-9a-fA-F]{2}\b' src | awk -F: '{s+=$2} END {print s}'
# fonts / gradients / blur / shadows (allowed: the inset sort-underline and the inset 2px left rules)
grep -rn 'JetBrains\|monospace\|linear-gradient\|radial-gradient\|backdropFilter\|145deg' src | wc -l
grep -rn 'boxShadow' src | grep -v 'inset' | wc -l
# casing / tracking / radii
grep -rEc 'textTransform: *"uppercase"' src | awk -F: '{s+=$2} END {print s}'
grep -rEc 'letterSpacing' src | awk -F: '{s+=$2} END {print s}'        # target: 0 outside the two wordmarks (App.jsx:196, Dashboard.jsx:230) which use -0.04em
grep -rEc 'borderRadius: *(1|2|4|5|6|8|12|20)\b' src | awk -F: '{s+=$2} END {print s}'   # only 0, 3, 9 (switch), 10 (tier pills), "50%" (dots) remain
# inline colours in components at all (the end state: only theme.js holds hex literals)
grep -rlE '#[0-9a-fA-F]{6}\b' src | grep -v 'src/theme.js' | wc -l
```
Manual gates per batch: `document.documentElement.scrollWidth === 1440` at 1440×1000 on All Players,
FA Finder, Waiver Wire, Draft Board (all optional columns on), IAFA, Rule 5, Scout, Prospects (both tabs),
Compare; smallest font ≥ 11px; tier pills are the only 10px radius; no element with the old 145° gradient
is visible at any time (including the loading screen).

---

## D. Risks and open questions (not covered by the mockup), with a proposed token for each

1. **Waiver freshness strip** (`WaiverWireView.jsx:190-211`) — a standalone bordered box above the
   sections with a status word ("STATSPLUS LIVE" `#34d399` / "CSV EXPORT ONLY" `#fbbf24`), dates, a
   fills-need count (`#f87171`) and 40-man occupancy (`#f87171` when full). Proposal: render it as the
   Overview-style `panel-foot` line inside the Needs box header (`state` slot) or as a small scorecard box:
   `panel`/`line2`; status `good` / `warn` Archivo Narrow 700; counts `bad` when alarming, else `text`.
   The claim-clock ladder (96): null `textDisabled`, 0 "cleared" `text3`, ≤1 day `bad` 700, else `text`.
   "YOURS" chip (82-84): outlined `line2`/`text2` r3 Archivo Narrow 700 10px.
2. **Draft pick tracking** (`DraftBoard.jsx:543-631, 885-897`) — manual-pick row tint + ★ + "DRAFTED",
   drafted-card grid, upcoming-pick placeholders, budget bar, position-cap meters. Proposal: row tint
   `accentBg2` (same family as NEED rows), ★/"DRAFTED" `accent`; cards `panel2`/`line` with the manual
   pick `accentBg2`/`line2`; budget/cap meters `good`/`warn`/`bad` on a `panel3` track with the soft-cap tick
   `text2`. Two meters + a tint + a tag all in the pencil family means "my picks" and "needs" look alike
   — acceptable, but flag it for review.
3. **Demand `$` and sign difficulty** (`DraftBoard.jsx:622, 625, 904-905`, `theme.js:29`). `signColor`
   has six states; proposal: Very Easy `good` · Easy `goodSoft` · Normal `text2` · Hard `warn` · Extremely
   Hard g30 `#e08e52` · Impossible `bad`; Demand `$` value `warn`.
4. **Intangibles H/N/L** (`intangibleColor`, Draft 908-910, IAFA 140-141, Compare 84-89): H `good` · N `text3`
   · L `bad` (weight 600). INTG 20–80 grade stays on `gradeStyle`.
5. **Contract status / Super-Two / MiLB status family** (`ContractTab.jsx:17-22, 257-262`; RosterPlanner
   violet family `#a78bfa/#c084fc/#c4b5fd/#7c3aed` in 7 files): signed `accent` · arb `warn` · pre-arb
   `goodSoft` · fa `text2` · option `CHART.series5` · **minors `#f472b6` has no token** → proposal
   `CHART.series6` (RP tan `#cfae92`) or `text3`; Super-Two / MiLB-FA / "potential" / "Needs reps" violet →
   `CHART.series5` (`#b8a2f2`, 7.7:1 on panel) everywhere, with 12–15% fills over `panel` for chips.
   R5 flags: countdown 0 `bad`, >0 `warn`; NO-TRADE `warn` outlined; options OUT `bad`; "Last Opt" `warn`,
   "NoOpt" `badSoft`.
6. **Two-way badge** (`shared.jsx:415-420`, 14 call sites) and injury (`ActiveRosterSubTab.jsx:66, 75`,
   `PlayerProfileModal.jsx:248`): two-way = outlined `warn` chip r3; injured name `warn`, "INJ" tag `bad`;
   modal badges 40-Man `accent`, R5 `bad`, INJ `warn`, Draft/IAFA `CHART.series5` (outlined, 10% fill).
7. **Org cell colour-coding in PlayersView** (158): IAFA `CHART.series5`, draft-year `warn`, FA `text3`,
   team `text`. Scout trade-fit rows (`ScoutView.jsx:141, 204`) `goodBg` + callout `good`; FortyMan starter
   row `accentBg2`; FieldingTab/EligiblePositions best row `goodBg`; FVImpactTable p50 row `accentBg2`.
8. **`levelColor` as text is unsafe on the new ladder.** A+/A/R fills are 2.6 / 1.9 / 1.4:1 against
   `panel`. The brief says string helpers keep returning a *text* colour, so `levelColor` must map to a
   text-safe ramp (MLB `text`, AAA `#bdb8ad`, AA `#8d8a82`, A+/A `text3`, R `textDisabled`, INT `#dfb04c`)
   and every level **column** should use `levelChip` (B.7). Same caution for `posColor("SP")` = `text`
   (loses its hue cue in the POS column — by design) and DH `#a9a59c`.
9. **FV is a WAR-scale number, not a 20–80 tier, everywhere except ProspectsView.** The modal header
   "FV pill" in the mockup assumes a tier; either show `tierChip(assignFVTier(fv, thresholds))` (needs the
   Prospects thresholds passed into the modal) or keep FV as a `warStyle` number in the header tiles.
   PercentileBar's potential marker (B.9) is a second open design call.
10. **Sticky table headers** (`SortHeader`, mockup `thead th{position:sticky}`): inside `S.tableWrap`
    (`overflowX:auto`) a sticky th sticks to the wrapper, not the page. Options: (a) give the board wrap
    `maxHeight: calc(100vh - 260px); overflowY: auto` so the header sticks within the box; (b) drop sticky.
    (a) changes scroll feel on every board; decide in batch 1 and record it in `app/CLAUDE.md`.
11. **Monospace leaks that the grep will not catch:** `<code>` elements (`WaiverWireView.jsx:200, 280-282`,
    `CurveTuningPanel.jsx:94-95`) render the UA monospace font. Proposal: `<span>` with `text` 600, or a
    global `code{font:inherit}` rule in `tokens.css` body styles.
12. **Shadows the design forbids but the UI leans on:** dnd-kit `DragOverlayRow` (`Panels.jsx:32`), the
    MultiSelect/NumericRange popovers (`shared.jsx:155, 381`), PlayerProfileModal (265), chip hover in
    ActiveRoster (50). Proposal: drop all; overlays get a `line2`→`text` border and `panel3` bg; if the
    drag overlay reads as flat, allow one 2px `accent` border as the lift cue. The inset 2px left rules
    (`CompactPlayerRow.jsx:69-71`) are borders in disguise — keep them (the gate excludes `inset`).
13. **Slider colour coupling** (`BandwidthControl.jsx:9`, Gap `#8b5cf6`, WarPct `#3b82f6`,
    CurveTuning `#38bdf8/#a78bfa` gradient tracks): today each slider wears its chart's series colour.
    Proposal: all sliders `accent` + flat `line2` track (interactive = pencil); charts keep series colours.
14. **Hover colours set via JS** (`shared.jsx:195-196`, `PlayerCompareView.jsx:116-117`,
    `ActiveRosterSubTab.jsx:55-56`) — `onMouseEnter` writes literals into `style`; they must read from
    `TOKENS` too (the grep catches them, but a reviewer might miss that they are not in `style={}`).
15. **`textDisabled` (2.9:1) is used for real values today**, not only placeholders: rank indices
    (`PositionalStrengthTable.jsx:110`, `OptimizedLineupSubTab.jsx:69`, `SuperTwoDetailModal.jsx:136`,
    `LiveProspectPreview.jsx:61`, `ProspectsView.jsx:484`), the FortyMan meta row (140), tile labels in all
    five profile tabs, captions (`FreeAgentFinder.jsx:145`, `Rule5Board.jsx:77`, `FVImpactTable.jsx:62-130`).
    The per-file mapping above sends those to `text3` (4.8:1); only true "—"/null/disabled stays
    `textDisabled`. Reviewers should hold that line.
16. **z-heat text at |z| 1.8–2.0 is 4.07–4.15:1** (dir-6 report, honesty note) — affects only
    PositionalStrengthTable score/rank cells and the FortyMan header strips. Accepted and documented; no
    token change proposed.
17. **Collapsed sidebar and emoji icons** (`Dashboard.jsx:91, 228-275`, `PAGES[].icon`) are not in the
    mockup (B.1). Proposal: keep the collapse (rail shows icons only), hide icons when expanded.
18. **`EligiblePositionsTable.jsx`** is not imported by the modal (FieldingTab superseded it) and
    `S.strengthGrid/strengthCard` have no consumers — confirm and delete rather than restyle.
19. **`zToColor` dead import** `DraftBoard.jsx:4` — remove in batch 2.
20. **Contrast of `CHART.series5` band fills** (Gap chart 18%/35% violet over `panel`) and the seven-line
    WAR-percentile fan: legend text takes the series colour in Recharts; `goodSoft`/`text2` lines at 1px may
    be faint on `panel` — verify on the 1440 screenshot and thicken to 1.5px if needed.
