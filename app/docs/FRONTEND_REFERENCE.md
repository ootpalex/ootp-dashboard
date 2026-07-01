# Frontend Reference — SSB GM Dashboard SPA

Detailed, on-demand reference extracted from `app/CLAUDE.md` to keep the base agent
context lean (progressive disclosure). Load this when you need page-level behavior,
the full helper catalog, or StatsPlus endpoints. The always-true rules (accessor
mandate, multi-league storage, CSV-presence page visibility, styling) stay in
`app/CLAUDE.md`; the `ootp-frontend` skill points here for the deep detail.

## Draft Board Features
- Draft class selector (detects year-tagged classes from Manual column)
- StatsPlus `/draftv2/` live API integration (proxied in dev) with manual CSV paste fallback
- Position caps by group (SP, RP, C, MI, CF, CI, Corner OF, DH)
- "I Drafted" manual pick tracking
- Supplemental round display (Round column + Supplemental=1 shows as "R1s", "R2s" etc.)
- All smart rank toggles

## Current Pages
1. **My Organization** — Sub-tabbed view with:
   - **Overview**: Positional strength table (full `PositionalStrengthTable` with both Now/Farm columns, click row to expand depth contributors) + paginated team roster. Roster columns include INTG (intangibles 20–80 grade) and 40M (✓ when `meta.on40` is truthy — accepts boolean or `"Yes"`).
   - **Active Roster (26-man)**: Field-diagram redesign — an SVG baseball diamond with 9 starter chips at their defensive positions, rotation 2-col grid top-left, bullpen 4×2 grid bottom-left, bench column on the right. Each chip shows POS · name · WAR · age · injury proneness; click opens the player profile. Pool: Lev=MLB + on40, plus injured MLB players.
   - **40-Man Depth Chart**: Position columns (C through RP) showing all on40 players. Active roster starters listed first (numbered), then remaining 40-man depth sorted by WAR.
   - **Optimized Lineup**: Side-by-side platoon lineups (vs RHP and vs LHP). `assignPlayersToPositions(hitters, [], LINEUP_DEPTH, "current", hand)` takes a `"vR"`/`"vL"` split arg and resolves split WAR through `getWar(p, pos, split)`. Batting order: leadoff = highest OBP, slots 2-9 = sorted by wOBA descending (per Tom Tango's *The Book*).
2. **All Players** — Searchable/filterable/sortable table with pagination. Mixed view now shows WAR + WAR P columns alongside hitter-only views (hitter enrichment sets `_war` / `_warP`, mirroring the pitcher pattern). Age filter uses the shared `NumericRangeFilter`.
3. **Free Agent Finder** — Side-by-side **Team Positional Needs** (dense `PositionalStrengthTable`, Now mode, sorted weakest-first) + **Smart Rank Adjustments** (4-toggle subset: Future Value / Org Positional Need / Injury Proneness / Intangibles). When any toggle is on, the FA Board grows a "Smart" column at the front showing `applySmartRank(...)` value. "Gap fills only" filter narrows to weak positions. Age + Pro Yrs filters use the shared `NumericRangeFilter`.
4. **Draft Board** — Draft class selector, live API, smart rank, position caps
5. **IAFA Board** — Same smart rank system, filtered to Manual = "IAFA"
6. **Dev Analysis** — Six-section page (hitter/pitcher toggle, no "all"):
   - **Age vs WAA Scatter Plot**: Recharts scatter with Current (blue) and Potential (green) dots. Extracted as `DevScatterChart` (`React.memo`) so it doesn't re-render when curve sliders change.
   - **Gap Distribution by Age**: Kernel-smoothed percentile bands (10th-90th, 25th-75th, median) of the gap (Potential - Current). Bandwidth slider with Save button. Trimmed where median hits zero.
   - **DevPercentile Distribution**: Kernel-smoothed current WAA percentile bands by age. ComposedChart with Area bands + Lines. Makes dev percentile concrete: "At age 20, the 75th percentile has current WAA of X."
   - **FV Impact Analysis**: Interactive table with **age columns** (14, 16, 18, 20, 22, 24, 26) and **dev percentile rows** (p95, p90, p75, p50, p25, p10). The row's percentile IS the devPct fed into the formula. Each cell shows the FV for a synthetic player at that (age, devPct) given the example pot. The cell sub-text shows the cohort's raw batR / cur-WAA at that (age, percentile) for context. Dropdown selects cohort (hit / sp / rp). p50 row is the typical-track baseline (deviation=0, no dev penalty); below = behind, above = ahead. `cur` reconstructed as `floor_assumed + devPct × (pot − floor_assumed)` using cohort median floor.
   - **Live Prospect Preview**: Real-time table of org-affiliated prospects ranked by FV with current slider settings. Updates live as curve parameters change. Shows top 30/50/100 with Name, Age, Pos, Org, Dev%, Cur, Pot, FV columns. Dev% is the player's batR-pct (hitters) or cur-WAA-pct (pitchers) within their age cohort. Respects playerType toggle.
   - **Development Curve Tuning** (v21 power-law creditAge): Single chart with the parametric `creditAge(age) = gapMax × (1 − t^gapExp)` plotted against the empirical `1 − progressCurve.hit.p50` dashed reference. The parametric is intentionally more generous than empirical at moderate ages — high-pot prospects don't follow the median trajectory. **Two sliders**: Gap Max (overall ceiling, default 0.80), Gap Exp (time-decay shape, default 3). Maturity Age toggle (26 or 27). Save/Revert/Defaults buttons.
   - **Current vs Potential Gap by Age**: Line chart showing avg current and avg potential WAA at each integer age bin.

7. **Scout View** — Browse any team's organization with trade analysis:
   - Team selector dropdown (excludes your team)
   - **Smart Rank Adjustments** (same 4-toggle subset as IAFA/R5/FAF) drive a per-player `_rank` via `applySmartRank` against the scouted team's enriched pool (`buildBoardPool` → `buildDisplayPool`, `null` draftContext).
   - **Positional Strength Comparison**: two side-by-side `PositionalStrengthTable`s (scouted team + your team), both sorted by *your* team's weakest position so rows align row-for-row.
   - Trade opportunity callout: positions where they're strong and you're weak (z-gap ≥ 1.0).
   - Trade targets table: their players at your weak positions with positive Smart Rank, sorted by `_rank` desc. Column header reads "Smart" when any toggle is on, "Fit" otherwise — mirrors Draft's "Smart" / "WAR P" pattern.
   - Full roster browser with level/type filters, sortable; weak-pos rows highlighted green.
8. **Player Compare** — Side-by-side comparison of 2-5 players:
   - Type-ahead search bar to find and add players (hitters or pitchers)
   - Selected players shown as removable chips
   - Vertical comparison table (stats as rows, players as columns)
   - Stat groups: Profile, Value (hitter/pitcher-specific), Splits, Intangibles, Contract
   - Best value highlighted green, worst red for numeric stats
   - Mixed type support (hitter + pitcher) — inapplicable stats show "—"
9. **Rule 5 Board** — Two sub-tabs:
   - **R5 Board**: Side-by-side **My Positional Needs** (dense `PositionalStrengthTable`, Now mode — Rule 5 picks must stay on the active roster all season, so immediate MLB need is the right metric, weakest-first) + **Smart Rank Adjustments** (4-toggle subset matching IAFA/Draft: Future Value / Org Positional Need / Injury Proneness / Intangibles). Pool excludes my team. Columns: Smart/WAR P, Name, Age, Dev%, POS, Best, Team, Lvl, FV, WAR, WAR P, Prone, Raw (when smart rank), B/T. Pool built via `buildBoardPool`: `_baseVal` from potential WAR, `_currentVal` from current WAR.
   - **40-Man Planner**: lazy-loads the full standalone `RosterPlanner` component. State syncs with the main Roster Planner page via the shared per-league `localStorage` keys (`ssb_roster_plan`, `ssb_roster_plan_order`, `ssb_roster_r5_threshold`).
10. **Prospects** — Sub-tabbed Fangraphs-style prospect ranking page:
   - **The Board**: Organization-affiliated prospects (MLD < 45, excludes FAs/IAFAs/draft-only players via `isInOrg()`) ranked by FV with scouting-grade tier badges (80→35+, players below 35+ excluded). Config table shows thresholds, dollar values, tier counts (H/P split), FV ranges, and MLB WAA comparison labels. "Suggest Thresholds" auto-populates from Fangraphs avg tier counts scaled by league size. Filters: search, type, position, org, level, tier.
   - **Farm Rankings**: Rankings table with clickable team names (navigate to Board filtered by team) and clickable tier counts (navigate to Board filtered by team+tier). Tier count columns, scouting ratings (Ceiling/Floor/Batting/Pitching on 20-80 scale via z-score), and multi-part scouting reports. Horizontal bar chart below table sorted highest→lowest. Settings persisted to localStorage (`prospect_board_settings`).
11. **Roster Planner** — Drag-and-drop 26-man / 40-man / IL planner with contract projection:
   - DnD orchestrated by `@dnd-kit` (PointerSensor / KeyboardSensor / TouchSensor); `RosterPlanner.jsx` is the coordinator that owns state and routes droppable IDs in `handleDragEnd`.
   - **Active depth panel** + **Inactive depth panel**: position-bucketed slots with hover highlighting (`hoveredActivePos` / `hoveredInactivePos`).
   - **Rule 5 Risk panel**: surfaces R5-eligible non-protected prospects above a configurable FV threshold (`r5Threshold`, scoped to the league) with a "show others" toggle.
   - **Queue panels**: option decisions, expiring contracts, out-of-options decisions, arbitration decisions — each summarizes upcoming roster pressure for the current `gameYear`.
   - **MLFA section**: minor-league free agent re-signings (collapsible).
   - **Suggestions panel**: heuristic move recommendations from `suggestActions()` in `utils/rosterPlanning/`.
   - **Moves log**: ordered list of user-recorded moves with labels from `MOVE_LABELS`. Persisted per-league via `ssb_roster_plan` + `ssb_roster_plan_order`.
   - **Super-Two detail modal**: opens from a "projected for arb" subtitle; walks through the cutoff calculation workflow showing season day, limbo state, candidate ranking, and the cutoff index. See `SuperTwoDetailModal.jsx`.
   - Contract data: prefers each player's embedded `contract` (from the pipeline's StatsPlus fetch) and `_projection.baseline`. Falls back to live StatsPlus API fetch only when those aren't present.
   - Game year derivation priority: `dashMeta.metaProjection.gameYear` → DOB/age crossover (`detectGameDate`) → `dashMeta.gameDate` → fallback.

## StatsPlus API
- Base URL: Configurable via League Settings (default: `https://atl-01.statsplus.net/ssb/api`)
- Dev proxy: `/statsplus` -> StatsPlus host (configured in `vite.config.js`), path extracted from settings URL at runtime via `getStatsplusBase()`
- `/draftv2/` — CSV of drafted players with IDs, Round, Pick In Round, Supplemental flag (live during draft)
- `/contract` — CSV of player contracts with year-by-year salaries, option flags, no-trade clauses
- `/contractextension` — CSV of contract extensions (same format as /contract)
- `/teams/` — Team ID to name mapping
- `/players/` — Player ID to name mapping
- **Pipeline integration**: Python pipeline fetches `/contract` + `/contractextension` at build time and embeds data in `dashboard.json` as `contract` sub-dict per player. Frontend uses embedded data as primary source, falls back to live API fetch if not present.

## Key Helper Functions
- `num(v)` — Parse string to number, returns null for empty/invalid
- `fmt(v, d=2)` — Format number to d decimal places, "—" for null
- `fmtAge(v)` — Format age: integers as whole numbers, fractional as 1 decimal, "—" for null
- `parseCSVBoolean(v)` — Parse "Yes"/"true"/true to boolean
- `posColor(pos)` — Position color mapping for consistent styling
- `warStyle(v)` — WAR value color using OOTP 20-80 scale gradient (blue→cyan→teal→green→yellow→orange→red) based on z-score relative to the **active league's** MLB WAR distribution. The calibration is **per-league**: the pipeline embeds each league's MLB WAR mean/std at `meta.warColor` (`export._compute_war_color`), and `App.jsx` calls `setWarCalibration(meta.warColor)` on load. `theme.js` keeps a built-in default (mean=1.61, std=1.88 — 5-league MLB snapshot) as a fallback for dashboards without `warColor`. So a compressed-talent league (SSB, std≈1.3) gets a tighter color scale than a wider one (BLM, std≈2.0). Grade 50=green (league avg), ±10=one std dev. Bold for extreme grades (≥70 or ≤30). Use this for all WAR display cells.
- `waaStyle(v)` — Preserved alongside `warStyle`. Uses old MLB WAA distribution (mean=-0.25, std=1.49). Unused in the current UI; available for a future "show WAA" toggle.
- `calcBestPos(player, type)` — Compute best defensive position for a player
- `recomputeAges(data, gameDateStr)` — Recompute all `_age` fields from DOB + game date
- `calcExactAge(dob, gameDate)` — Fractional years between DOB and game date
- `devPctColor(pct)` — Dev percentile color: green (80-100), light green (60-80), gray (40-60), light red (20-40), red (0-20)
- `loadLeagueSettings()` / `saveLeagueSettings(settings)` — Read/write league settings to localStorage
- `detectExcludedTeams(rawRows)` — Auto-detect contracted teams (player count < 25% of league average)
- `getStatsplusBase(settings)` — Returns StatsPlus API base URL (proxy path in dev, full URL in prod)
- `isTrueFA(player, iafaTag)` — Check if player is a true free agent (not IAFA/draft tagged). Second arg defaults to "IAFA" if omitted.
- `isProspect(player)` — MLD < 45 or null (prospect eligibility check)
- `isInOrg(player, iafaTag)` — Player belongs to an organization (not FA, not IAFA-tagged, not draft-tagged)
- `buildProspectPool(data, iafaTag)` — Filter hitters/pitchers to org-affiliated prospects, add `_poolType`/`_baseVal`/`_currentVal`
- `loadProspectSettings()` / `saveProspectSettings(settings)` — Read/write prospect board settings to localStorage
- `suggestThresholds(prospects, numTeams)` — Auto-suggest FV tier thresholds from Fangraphs avg counts scaled by league size
- `assignFVTier(fv, thresholds)` — Map continuous FV value to scouting-grade tier (80→35)
- `getDollarValue(tierId, playerType, dollarValues)` — Lookup bat/pit dollar value for a tier
- `calcFarmRankings(prospectPool, thresholds, dollarValues, teams)` — Full pipeline: tier → dollars → z-score scouting ratings → reports
- `buildScoutingReport(ceiling, floor, batting, pitching)` — Multi-part narrative scouting report text

### Recharts Imports
`ComposedChart, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, ReferenceLine, Area, BarChart, Bar` — all from `"recharts"`. `ComposedChart` is used when mixing scatter + line in a single chart. `ReferenceLine` available for adding reference markers. `BarChart`/`Bar` used for Farm Rankings system value chart.
