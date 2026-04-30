# OOTP Dashboard — Frontend

React 18 + Vite SPA. Renders the JSON produced by the Python pipeline in [`../model/`](../model/).

> **Most users should run `python3 run.py` from the project root** — it builds the pipeline data and starts this dev server in one step. This README is for contributors working on the SPA directly.

For frontend conventions (accessor helpers, computed fields, view-by-view notes), see [`CLAUDE.md`](CLAUDE.md). For architecture diagrams, see [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

## Run

```bash
npm install
npm run dev      # http://localhost:3000
```

The dev server runs on port **3000** (set in `vite.config.js`) and proxies `/statsplus` to the StatsPlus host to avoid CORS issues during development.

## Build

```bash
npm run build    # → app/dist/
npm run preview  # serve the production build locally
```

## Where the data comes from

On startup the app fetches `public/data/leagues.json` (a list of configured leagues) and then `public/data/<active-slug>/dashboard.json` for the currently selected league. Both are written by the pipeline (`python3 run.py` from the project root). If `leagues.json` is missing the SPA falls back to fetching `public/data/dashboard.json` directly, and if that's also absent it shows a manual file-upload modal.

## Project shape

```
app/
├─ index.html
├─ vite.config.js          # dev port 3000, /statsplus proxy
├─ CLAUDE.md               # frontend conventions (accessor rules, computed fields)
├─ public/
│   └─ data/
│       ├─ leagues.json    # index of all configured leagues, refreshed each pipeline run
│       └─ <slug>/
│           ├─ dashboard.json
│           └─ dashboard.json.gz
└─ src/
    ├─ main.jsx
    ├─ App.jsx              # entry shell + ErrorBoundary + data load (per-league fetch)
    ├─ theme.js             # OOTP 20-80 color scale, posColor, waaStyle
    ├─ components/          # leaf UI primitives + remaining views
    ├─ views/               # domain-split views (Org, PlayerProfile, RosterPlanner, DevAnalysis)
    ├─ hooks/               # useDebouncedValue, useLocalStorage (with per-league scoping)
    └─ utils/               # accessor helpers, math, board utilities
```

## Tests

The frontend has no automated test suite yet. Verify changes manually:

1. `npm run build` succeeds with no warnings.
2. `npm run dev` starts cleanly, no console errors.
3. Click through the affected view + at least one unrelated view (regression check).

## Conventions

Read [`CLAUDE.md`](CLAUDE.md). Most important rules:

- **Always use accessor helpers** (`getWaa`, `isEligible`, `resolveKey`, …). Never read flat column names directly.
- **All views receive `datedData`**, not raw `data` — age recomputation is centralized.
- **Memoize render-heavy children** that don't depend on slider state (see `DevScatterChart` for the canonical `React.memo` pattern).
- **No new state-management libraries.** Local state + props.
- **Inline styles only.** Dark theme via `theme.js`.
