# Batch 6 brief — Dev Analysis + Recharts theming (Night Scorecard, graphite)

Repo worktree: /Users/alex/Projects/ootp/dashboard/ootp-dashboard/.claude/worktrees/ootp-dashboard-redesign-4cb921
Branch `claude/ootp-dashboard-redesign-4cb921`; batches 0–2 committed, 3/4/5 in progress by sibling agents on other
files. YOUR FILES (edit only these): app/src/views/DevAnalysis/DevAnalysisView.jsx, DevScatterChart.jsx,
GapDistributionChart.jsx, WarPercentileChart.jsx, CurveTuningPanel.jsx, FVImpactTable.jsx, LiveProspectPreview.jsx,
BandwidthControl.jsx. (FVProjectionChart.jsx belongs to batch 4; ProspectsView's chart was done in batch 2.) Do not
touch anything else; do not commit.

Read first: the "Sources of truth" and "Decisions already made" sections of app/docs/redesign/BATCH345_BRIEF.md (they
apply verbatim: TOKENS/S/helpers, Section recipe, chipCss mapping, chrome rules, gates, the CDP harness), then
MIGRATION_INVENTORY.md §B.14 (Recharts components + props per file — the authoritative per-prop mapping), the
"Batch 6 — Dev Analysis" block in §A.2 (per-line colour mapping), and §D.13 (sliders).

Batch-6 specifics:
- Every Recharts colour prop goes to `T.CHART.*` (series1 current/blue, series2 potential/green, series3 pencil,
  series4 warn, series5 violet (gap), series6 tan; grid, axis, refLine, tooltipBg, tooltipBorder, tooltipText,
  bands.seriesN.outer/inner for the 18%/35% band fills). Add `axisLine={{ stroke: T.CHART.grid }}` /
  `tickLine={false}` where axes fall back to Recharts' default #666. Custom tooltips: `panel2`/`line2`/r3, no shadow.
  Legends inherit `text2`.
- DevScatterChart is hand-rolled SVG (React.memo) — map per §A.2 (grid → CHART.grid, ticks/titles → CHART.axis,
  current → series1, potential → series2, crosshair → text2, locked trend → series4, marker rings → text, tooltip
  box → tooltipBg/tooltipBorder r3). Do not change its memoization, props or event handling.
- Sliders (D.13): all sliders `accentColor: T.accent` with a flat `T.line2` track (remove the gradient tracks in
  CurveTuningPanel 40/122/133 and BandwidthControl's default); value readouts `T.accent`; MaturityToggle active =
  `accent` fill + `accentText`, wrapper `line2` r3; Save/Revert/Defaults = `S.btnPrimary` / `S.btn` (disabled
  `textDisabled`).
- FVImpactTable: the table recipe (`S.th`/`S.td`, groups Dev% | ages via `colRule`), p50 row `T.accentBg2` + label
  `T.accent`, zebra `S.zebraRow`, captions `T.text3`. LiveProspectPreview: table recipe, Top-N pills as `PillBtn`s,
  zebra, rank `text3`, `levelColor`/`posColor`/`warStyle`/`devPctStyle`.
- Each of the six DevAnalysisView sections is a `Section` (title + the hitter/pitcher `TabGroup` of `PillBtn`s in the
  page header or first box toolbar; section captions → `footer` or a `text3` line); the page keeps its layout.
- `<code>` → `<span>` (CurveTuningPanel 94-95). No `#fff`, no `linear-gradient`, no 8-digit hexes.
- Gates per file: `grep -cE '#[0-9a-fA-F]{6}\b|rgba?\('` → 0; `grep -nE 'borderRadius: *(8|10|12|20)\b|textTransform|letterSpacing|monospace|boxShadow|linear-gradient|#fff\b'` → nothing.
- Verify with the CDP harness: `node app/docs/redesign/shoot-app.mjs --league BLM-ATL --out app/docs/redesign/shots/b6 --pages "Dev Analysis" --full` (and with `--per` clicking the Pitchers pill) — charts must visibly render on tokens (bands, lines, grid, tooltips on hover cannot be shot; check computed stroke/fill via `--per` evaluating `document.querySelector('.recharts-cartesian-grid line')?.getAttribute('stroke')` etc.); scrollWidth 1440; `vite build` OK; no console errors.
Deliver: edited files + append a "Batch 6 — Dev Analysis landed" block to MIGRATION_PLAN.md (re-read right before
appending; siblings append too). Do NOT commit. Final message: per-file summary, gate numbers, scrollWidth, deviations.
