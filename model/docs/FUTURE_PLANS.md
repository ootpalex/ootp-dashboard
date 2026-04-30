# Future Plans

Items deferred for later discussion and implementation.

---

## 1. Per-Organization Park Factors

**Priority:** High
**Source:** Plan transcript — confirmed as important

Currently the pipeline supports two park factor modes:
- **Neutral** — no park adjustments
- **Team** — all players evaluated at your team's ballpark

The third mode evaluates each player at their **own organization's** ballpark. This is the most accurate approach for scouting other teams' players, since it reflects where they actually play.

### Architecture Impact
- Instead of one `ParkDeltas` object, need per-org park data
- Option A: loop `build_dashboard()` over 28 teams (simple but slow — 28× compute)
- Option B: vectorize park factor application so each row uses its org's factors (faster, bigger refactor)
- Option C: precompute all 28 `ParkDeltas` and select per-row via org column (moderate)
- `settings.py` needs a third mode option ("per-org")
- Hitter/pitcher compute functions currently take a single `ParkDeltas` / `NormalizedAdjustments` — would need to accept per-row park data or be restructured
- Free agents (`ORG="-"`) need a fallback (neutral park or user's team)

### Open Questions
- Which approach (A/B/C) gives the best performance/complexity tradeoff?
- How should free agents be handled?
- Should prospect stats also use per-org parks?

---

## 2. Dynamic OSA Blending Weights

**Priority:** Medium
**Source:** `src/players.py` lines 181–213

`calculate_dynamic_weights()` is currently a stub returning constant weights (scout=0.8, osa=0.2). The intended behavior adjusts blend weights per player based on:

- **Scouting accuracy** — lower accuracy → reduce scout weight, increase OSA weight
- **Days since scouted** — stale scouting → reduce scout weight

### Implementation Considerations
- Player CSV has `SctAcc` (scouting accuracy) and possibly date columns
- Need to define the accuracy categories and weight curves
- Could use `np.select()` with categorical buckets or a continuous decay function
- Should we also factor in scout skill level?

---

## 3. JSON Output Size Optimization

**Priority:** Low (gzip already shipped)
**Source:** Output is gzipped in `model/main.py:234-236`; uncompressed is ~29 MB

The gzipped JSON typically lands at 2–4 MB, which the SPA loads cleanly. Remaining size-reduction options if first-paint becomes a problem:

- **Aggressive rounding** — 4 decimal places instead of 6 (most stats don't need 6 digits)
- **Null omission** — skip None/null fields entirely (e.g., ineligible position stats)
- **Split files** — separate hitters.json / pitchers.json
- **Binary format** — MessagePack instead of JSON
- **Lazy loading** — paginate or stream players on demand

### Tradeoffs
- Rounding + null omission are easiest and could cut size 30–50% before gzip
- Split files add complexity but help if only one list is needed
- Binary formats require a deserializer on the React side

---

## 4. Metadata + Regressions Pipeline Integration

**Priority:** Partial — metadata wired in v0.1.0; regressions still manual for OOTP-version migrations.

**Source:** `src/metadata.py`, `src/regressions.py`, `src/export.py:build_dashboard`

### What's wired (v0.1.0)
- `build_dashboard()` accepts an optional `metadata_dir` parameter. When `leagues/<slug>/metadata/` contains CSV files, the pipeline auto-calls `generate_data_points()` → `compose_data_points()` to compute league-specific calibration. SHA-256 hash caching via `.metadata_cache.json` short-circuits unchanged inputs. Falls back to `DEFAULT_HITTER_DP` / `DEFAULT_PITCHER_DP` when the directory is empty.

### What's still manual
- Regression coefficient regeneration for new OOTP versions. Today the OOTP 26 coefficients are hardcoded in `data_points.py` (originally Excel-derived). For OOTP 27, you drop sim CSVs into `data/regressions/ootp27/` and run `regressions.py` against that path; the resulting coefficients still need to be hand-merged into `data_points.py` (or a future `data_points_v27.py`).

### Open work
- Wire `compute_regressions()` output into `data_points.py` automatically based on `LeagueConfig.ootpVersion` so that new-version leagues don't require a manual constant-merge step. See [`../../docs/MULTI_LEAGUE.md`](../../docs/MULTI_LEAGUE.md) for the current OOTP-version migration workflow.
