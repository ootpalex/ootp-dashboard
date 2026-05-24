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

### What's still manual _(superseded by the 2026-05-24 OAA rollout — see Update below)_
- Regression coefficient regeneration for new OOTP versions. Originally the OOTP 26 coefficients were hardcoded in `data_points.py` (Excel-derived), and a new version meant hand-merging fresh fits into `data_points.py` (or a `data_points_v27.py`). This is no longer the case — the coefficients are now computed from the sims and injected automatically (see Update).

### Open work _(resolved — see Update below)_
- Wire the computed regression output into the data points automatically based on `LeagueConfig.ootpVersion` so that new-version leagues don't require a manual constant-merge step. See [`../../docs/MULTI_LEAGUE.md`](../../docs/MULTI_LEAGUE.md) for the current OOTP-version migration workflow.

> **Update (2026-05-24, OAA rollout):** the auto-wire is now **done**. `_detect_metadata` (`export.py`)
> calls `generate_regression_coefficients(regressions_dir)` — which computes *all* hitting/pitching/fielding
> coefficients from the sims in `data/regressions/ootp<ver>/` and caches them (`.regressions_cache.json`,
> keyed on a data hash + a `_CACHE_VERSION`; recomputes only when the sim data changes or the version is
> bumped) — and injects them via `compose_data_points(...)`. The hardcoded `data_points.py` coefficients are
> now only the **no-sims fallback**. A new OOTP version no longer needs a manual constant-merge: drop the
> sim CSVs into `data/regressions/ootp<ver>/` and the build computes from them. (Remaining nicety: surface
> the per-version regressions dir purely from `ootp_version` everywhere; today it resolves via
> `regressions_dir_for(config.ootp_version)`.)

---

## 5. SB% modeling for high steal ratings (STE ≳ 76) — saturating curve

**Priority:** Low–Medium — the model is correctly centered and coherent; only the extreme tail is crude.
**Source:** `src/hitters.py:273-278`, `src/pitchers.py:344-345`; noted during the 2026-05-24 OAA rollout
(the original creator's long-standing "steal ratings above 80 don't model well").

SB% (a success *rate*, bounded [0,1]) is modeled as a **linear** function of the steal rating:
`sb_pct = c0 + c1·(STE − avg_steal) + lg.sb_pct`. A line is unbounded, so very high STE overshoots 1.0.

### Current state (correct, with a guard)
- The intercept is the calibration value (`sb_pct.c0 ≈ −0.133`) and is **correct** — `lg.sb_pct ≈ 0.78` is
  the *pooled* league rate, but an average-*rated* runner actually succeeds ≈0.65 in the sims, so the offset
  is real. (A rollout pass briefly zeroed it on a faulty "centering" argument and inflated BsR ~13 pp; that
  was caught and reverted. See `Spreadsheet/docs/KNOWN_BUGS.md` "Non-Bug 14".)
- A `[0,1]` clip (`hitters.py:278`, matching the pitcher side) guards against `sb_pct > 1.0` (which would
  make `sb > sbat` ⇒ negative caught-stealing). With the correct intercept this only binds at STE ≈ 95+.

### What's still imperfect (the residual tail)
- The linear form mildly overestimates the very top: STE 80 → ~0.90 (fine), but STE ~95+ extrapolates to
  >1.0 and gets clipped to 100% — so a handful of extreme runners lose discrimination and sit slightly high
  (real elite ~85–90%). Small population, small effect, but not physically faithful at the tail.

### Proposed direction
Replace the linear SB% with a **logit-linear / logistic** form, `sb_pct = sigmoid(b0 + b1·(STE − avg))`,
fit on the `data/regressions/ootp26` sims so the average → its true (sub-pooled) rate and the asymptote → a
realistic ceiling (<1). Smooth, monotonic, bounded by construction (drops the need for the clip), and
discriminates among elite ratings. Apply the same to the pitcher SB%-allowed model, and add the symmetric
lower clip the pitcher side currently lacks (`pitchers.py:345` clips only the upper bound).
