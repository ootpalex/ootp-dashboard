# Contributing

## Setup

```bash
# Pipeline runtime + test deps (Python 3.11+):
cd model && pip install -r requirements-dev.txt
# Frontend deps (Node 20+):
cd app && npm install
```

`requirements.txt` holds runtime-only dependencies; `requirements-dev.txt` extends it with `pytest` and any future lint/type-check tooling.

## Branching

Work on feature branches when changes touch ≥2 files; commit straight to main only for typo-level fixes. PRs are welcome but not required for solo work.

## Tests before you commit

```bash
# Pipeline
cd model && python3 -m pytest

# Frontend (no test suite yet — verify manually)
cd app && npm run build && npm run dev
```

Frontend has no automated test suite. When changing a view, click through it in the dev server and confirm:

1. The page renders without console errors.
2. The relevant data loads (player counts, sort order, filters).
3. The page that uses the changed code still works on cold load (refresh the browser).

## Style

### Markdown

- One `#` per file (the title). `##` for top-level sections, `###` for sub-sections. Avoid `####+` — split the file instead.
- Always tag code fences (`bash`, `python`, `jsx`, `json`, `mermaid`, `text`).
- Cross-doc links: **relative** paths from the linking file. Cite source code with `path:line` (e.g., `model/main.py:116-117`), not pasted snippets.
- File names: `SCREAMING_SNAKE_CASE.md` for new docs (matches existing convention). `README.md` and `CLAUDE.md` keep their conventional names.
- Status banners: prefix templates and stale docs with a single bold line — `**STATUS: TEMPLATE — REQUIRES USER WALKTHROUGH.**` or `**STATUS: ARCHIVED — kept for history.**`
- Mermaid: use `flowchart TD` for stage-by-stage pipelines, `flowchart LR` for short summaries.

### Python

- Follow existing module style. `pandas` + `numpy`, no extra dependencies without discussion.
- Type hints on every public function (params + return). Inner helpers can be loose.
- The codebase passes `mypy --ignore-missing-imports src/` clean as of v0.1.0. Run `pip install mypy && mypy --ignore-missing-imports src/` before opening a PR; if you must introduce a type-check error, add a focused `# type: ignore[error-code]` with a comment explaining why.
- Cite Excel-formula sources in docstrings when porting; reference [`../model/docs/ARCHITECTURE_DEEP_DIVE.md`](../model/docs/ARCHITECTURE_DEEP_DIVE.md) by section.
- Tests live in `model/tests/test_<module>.py`. Use `pytest` style; fixtures in `conftest.py`.

### React

- Read [`../app/CLAUDE.md`](../app/CLAUDE.md) before writing frontend code. The accessor helper rules are non-negotiable.
- Inline styles, no CSS-in-JS library. Dark theme via `app/src/theme.js`.
- Memoize expensive derived data with `useMemo`. Wrap render-heavy children with `React.memo` when the parent re-renders frequently (see `DevScatterChart` for the canonical pattern).
- No new state-management libraries (Redux, Zustand, React Query). Local state + props is the chosen pattern.
- No TypeScript migration — JSX with PropTypes-light convention.

## Commit messages

Short imperative subject (≤72 chars). Body optional but encouraged for math changes — cite the formula or source. No PR-tooling tags (`Co-Authored-By` etc.) unless paired-on.

## What to avoid

- Don't paste pipeline output into commits. The output JSON is regenerated.
- Don't commit `leagues/<slug>/output/`, `app/dist/`, `app/public/data/`, `node_modules/`, `__pycache__/`, `.DS_Store`, real-league CSVs, or `leagues/<slug>/league.json` (all already gitignored). Only `leagues/.example/` template files ship.
- Don't add new top-level directories without updating [`ARCHITECTURE.md`](ARCHITECTURE.md).
- Don't break the auto-copy in `model/main.py` — the SPA depends on the per-league output landing in `app/public/data/<slug>/` and `leagues.json` being refreshed atomically.
