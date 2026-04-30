# Onboarding

A first-day checklist for new contributors. The root [`README.md`](../README.md) covers the install path; this doc covers the *project shape* and where to look first.

## Day 1 checklist

1. Read the root [`README.md`](../README.md) and run the "First build" path end-to-end. Confirm <http://localhost:3000> renders with your data.
2. Read [`ARCHITECTURE.md`](ARCHITECTURE.md) — both Mermaid diagrams. Understand the **CSV → JSON → SPA** flow before opening any source file.
3. Skim [`../app/CLAUDE.md`](../app/CLAUDE.md) — it's the source of truth for frontend conventions (accessor helpers, no raw column names, `datedData` rule, smart-rank system).
4. Skim [`../model/README.md`](../model/README.md) — understand the optional calibration steps (metadata, regressions) even if you never run them.
5. Run the pipeline tests: `cd model && python -m pytest tests/ -v`. They should all pass.
6. Run the frontend build: `cd app && npm run build`. It should succeed.

## Mental model

- **One pipeline run produces one JSON file.** Everything in `model/` exists to write `dashboard.json.gz`. There is no live API, no database, no streaming.
- **The SPA never mutates pipeline data.** It enriches in memory (`Dashboard.enrichedData`) and renders. To add a backing field, add it to `model/src/export.py` and re-run the pipeline.
- **Settings are user-side.** League settings, team selection, game date, curve-tuning sliders — all live in browser localStorage. The pipeline doesn't know about them.

## Where things live

| If you want to… | Open |
|---|---|
| Understand the JSON shape the SPA consumes | `model/src/export.py` (`build_dashboard`) |
| Understand the data fields the SPA reads | `app/CLAUDE.md` (accessor helpers + computed fields) |
| Trace a number on the dashboard back to its source | `app/src/utils/` (accessors) → `model/src/<domain>.py` (compute) → CSV column |
| Tune the dev curve | `app/src/components/DevAnalysisView.jsx` (UI) + `app/src/utils/futureValue.js` (math) |
| Add a new view | `Dashboard.jsx` page switch + new component |
| Add a new test | `model/tests/test_<module>.py` mirrors `model/src/<module>.py` |

## What surprises new contributors

- The auto-copy at the end of `python main.py` (`model/main.py:128-140`) copies the gzipped JSON straight into `app/public/data/` — there is no manual step between the pipeline and the SPA.
- Ratings are quantized to 5-point increments (20, 25, 30, …, 80) in OOTP exports. The optional AAA/AA relative-rating exports subdivide each tier; see `model/src/relative_ratings.py`.
- The dev server runs on **port 3000**, not Vite's default 5173 — set in `app/vite.config.js`.
- The pipeline writes `dashboard.json.gz` (gzipped). The browser decompresses it transparently because the file is served with a `.gz` content-encoding hint.

## Asking for help

- The SOBR Discord (linked from the root README) is the place for OOTP-domain questions.
- For pipeline math questions, [`../model/docs/ARCHITECTURE_DEEP_DIVE.md`](../model/docs/ARCHITECTURE_DEEP_DIVE.md) is the canonical reference.
- For frontend conventions, [`../app/CLAUDE.md`](../app/CLAUDE.md) is more useful than the source code.
