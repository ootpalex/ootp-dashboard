# Batch 1 brief — shell + primitives (Night Scorecard, graphite)

Repo worktree: /Users/alex/Projects/ootp/dashboard/ootp-dashboard/.claude/worktrees/ootp-dashboard-redesign-4cb921
Branch `claude/ootp-dashboard-redesign-4cb921`; batch 0 (theme.js foundation) is committed as ac04c89.

Files you may edit — ONLY these three:
- `app/src/components/shared.jsx` (primitives)
- `app/src/components/Dashboard.jsx` (the sidebar `<nav>` block ~lines 226–287 and the main-content wrapper
  padding just below it; nothing else in that file)
- `app/src/components/LeagueSettingsModal.jsx`
No data-access or behaviour changes: every prop, export, aria role/label, keyboard interaction, localStorage key and
callback stays exactly as it is. This is a styling + small-DOM-wrapper batch. Do not touch other files (batch 2+).

Sources of truth (read first):
1. `app/src/theme.js` — `TOKENS` (T.bg/bg2/panel/panel2/panel3/zebra/text/text2/text3/textDisabled/line/line2/lineInk/
   accent/accentHover/accentText/accentBg/accentBg2/good/goodSoft/goodBg/bad/badSoft/badBg/warn/warnBg/focus/scrim,
   T.fonts.ui / T.fonts.narrow, T.radius = 3, T.radiusPill = 10) and the restyled `S` (S.section, S.sectionTitle,
   S.th, S.thSorted, S.td, S.tableWrap, S.pillBtn, S.pageBtn, S.searchInput, S.filterSelect, S.badge, S.dropZone,
   S.loadBtn, S.errorBox …). USE THESE; add no hex literal anywhere in the three files (gate: 0 six-digit hexes).
2. `app/docs/redesign/mockup/night-scorecard.html` — the approved mockup (graphite). Read its <style> for: `.sidebar`
   (paper panel, brand row, the bordered league/team/date block, nav rows with the red ✓ tick, Settings pinned),
   `.card`/`.box-head`/`.box-foot`, `.toolbar`, `.toggle`/`.switch`, `.btn`/`.btn-primary`, `.input`/`.select`,
   `.pagination`, `.pill`. Match these.
3. `app/docs/redesign/MIGRATION_INVENTORY.md` §B.1 (sidebar), §B.2 (each primitive, with line numbers), §B.12
   (LeagueSettingsModal) — the spec per component, including estimates and risks. Follow it.

Decisions already made (do not re-open):
- Sidebar: keep the collapse toggle and the collapsed 52px rail; when COLLAPSED show the emoji icons only; when
  EXPANDED hide the emoji icons (text rows only, with the red ✓ tick on the active page — an absolutely positioned
  `<span>` since inline styles have no pseudo-elements). Width expanded = 200px.
- Sticky table headers (D.10): keep `position: sticky; top: 0` from `S.th` as-is (inside the overflowX wrapper it is a
  no-op today); do NOT add maxHeight/overflowY to `S.tableWrap`.
- `PillBtn` active = `accentBg` fill + `accent` text + `accent` border; inactive = `panel` / `line2` / `text2`;
  radius 3, Archivo Narrow 600 13px. `TabGroup` keeps its API and just lays pills out in a `panel2` strip.
- `Section` gains optional props `count`, `state`, `toolbar`, `footer` (all additive; `title`, `children`, `actions`
  unchanged). Render: outer box `panel` + 1px `line2` + radius 3 + overflow hidden; header strip `panel2`,
  min-height 34, `borderBottom line2`, title Archivo Narrow 700 13.5px `text`, then `count` (`text3`), then on the
  right `state` (`text3` 12px) and `actions`; optional `toolbar` as a second `panel2` strip (padding 8px 12px,
  `borderBottom line2`); body padding 12; optional `footer` (`borderTop line`, 12px `text3`, padding 6px 12px).
  Batch 2 will move the boards' filter bars into `toolbar`; in this batch no caller changes.
- `Toggle` gets a `variant` prop: `"inline"` (default, current usage) and `"row"` (ruled row, per §B.2). Switch
  30×17: off = `bg` well + `line2` ring + `text3` knob; on = `accent` track + `accentText` knob; focus ring `focus`.
- `SortHeader`: `S.th` + sorted → `...S.thSorted` (the inset red underline) + arrow; hover → `text`.
- Inputs: text/number/date inputs = sunken wells (`S.searchInput` basis: `bg`, `line2`, focus `focus` border + ring);
  select buttons (`MultiSelectDropdown` trigger, `S.filterSelect`) = raised `panel` controls; popovers opaque `panel`
  + `line2` + r3, NO shadow, NO backdropFilter; option rows hover `panel3`, checked `accentBg` + `text`; "Clear"
  links `accent`; the search input gets an inline magnifier (inline SVG data-URI backgroundImage, paddingLeft 26).
- `Pagination`: foot-strip style (`panel2`, `borderTop line2`, padding 8px 12px, Archivo Narrow 12.5px `text2`;
  Prev/Next `panel`/`line2`/`text` r3; disabled `textDisabled`/`line`).
- `FileDropZone`/`DataLoader`: r3, dashed `line2`; ready `good`/`goodBg`; dragover `accent`/`accentBg2`; primary load
  button = `accent` fill + `accentText`.
- `TwoWayBadge`: outlined chip `warn` text + border, transparent, r3, Archivo Narrow 700 10px.
- `LeagueSettingsModal` (§B.12): keep the scrim; box 520 `panel`/`line2`/r3; header strip (title + ✕); labels 12px
  Archivo Narrow `text2`; inputs = wells; team chips r3 outlined (`goodBg`/`good` forced-include, `badBg`/`bad`
  excluded); footer Cancel secondary / Save primary; remove `backdropFilter`, radius 12, and every hex.
- No `boxShadow` except the inset sort underline and the focus ring; no `linear-gradient`; no `backdropFilter`;
  no `borderRadius` 8/10/12/20; no uppercase+letterSpacing labels (use Archivo Narrow 600 sentence case instead;
  the sidebar field labels are 11px Archivo Narrow `text3`).

Verify (the dev server is already running on http://localhost:3011 with HMR — Vite picks up your edits; if it is
not running: `cd app && npx vite --port 3011 --strictPort`):
- `cd app && npx vite build` succeeds.
- Gates: `grep -cE '#[0-9a-fA-F]{6}\b' app/src/components/shared.jsx app/src/components/Dashboard.jsx
  app/src/components/LeagueSettingsModal.jsx` → 0 0 0; `grep -n 'boxShadow\|linear-gradient\|backdropFilter'` in the
  three files → only the inset underline / focus ring; `grep -nE 'borderRadius: *(8|10|12|20)\b'` → none;
  `grep -n 'textTransform' ` → none.
- In the browser (mcp__Claude_Browser__preview_start url http://localhost:3011, resize 1440×1000): sidebar expanded
  and collapsed; Free Agent Finder (compare against the mockup side by side — this is the reference page), All
  Players, Waiver Wire; open League Settings; open a position MultiSelect popover and an Age range popover;
  `document.documentElement.scrollWidth === 1440` on FA / Players / Waivers; Tab through sidebar → dropdown → toggle
  still works; no console errors.

Deliver: the three edited files, then append a short "Batch 1 — landed" section to
`app/docs/redesign/MIGRATION_PLAN.md` (what changed per file, decisions applied, gate results, anything deferred).
Do NOT commit. Final message: per-file summary (≤8 lines), gate results, and any deviation from this brief.
