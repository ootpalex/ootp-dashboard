# CLAUDE.md — OOTP Dashboard model

## ⚠️ Before changing ANY pipeline calculation: audit it first

Any change to the model's calculations — regression fits (`model/src/regressions.py`),
league/metadata constants (`model/src/aggregators/`, `model/src/data_points.py`), the
hitting / pitching / baserunning / fielding formulas (`model/src/hitters.py`,
`model/src/pitchers.py`), or the valuation / WAR / bestPos (`model/src/export.py`) — must be
**audited before it is implemented**:

1. **Trace every input** and classify it: 🟢 computed from our real data · 🟡 borrowed constant
   (note its provenance) · 🔵 deliberate assumption.
2. **Re-derive or spot-check every step's arithmetic against the actual data** — never trust a
   number you didn't reconstruct. Watch especially for borrowed constants that were never
   checked against our data. (Example caught this way: the fielding `out_value` = 0.75/0.90 in
   `data_points.py` — the real Zone-Rating data implies ~0.50/0.66, because our coarse 6-bucket
   out-count is over-spread vs a continuous catch-probability model.)
3. **Resolve every flag before merging.** No made-up constants, no skipped steps.

Pattern to copy (a worked audit + reusable harness):
`Leftovers/oaa-fielding-model/OAA_PIPELINE_AUDIT.md` and `verify_oaa_pipeline.py`.

## Key pipeline facts

- **Ratings-in, projection-out.** Real stats only *calibrate* coefficients and league constants;
  every per-player value (hitting, pitching, baserunning, fielding) is projected from that
  player's *ratings*. A player's own actual stats never enter his own valuation.
- **Regression coefficients are COMPUTED from the cached sims pipeline** (since the 2026-05-24 OAA
  rollout): `export.py:_detect_metadata` → `generate_regression_coefficients(regressions_dir)` →
  injected into `compose_data_points`. Cached in `.regressions_cache.json` (keyed on sim-data hash +
  `_CACHE_VERSION`; recomputes only on data change or version bump). The hardcoded `data_points.py`
  values are now only the **no-sims fallback** (fielding `*_pm_*` are OAA). The recompute reproduces the
  slopes exactly. **Caveat:** the baserunning cubics (sb_pct/sba/ubr, sp/rp_sb_pct) are applied as
  `poly + lg.rate`, so their `c0` is a real *pooled-vs-average-rated* offset (e.g. sb_pct.c0 ≈ −0.133), NOT
  zero — the centered recompute returns ≈0 there, which is wrong, so those intercepts are pinned to the
  calibration values (`_with_canonical_intercept`). Don't "fix" a nonzero baserunning c0 to 0.
- **Editing `model/` code needs `main.py --force`** — the build short-circuit and the metadata /
  regressions caches key on *inputs*, not code, so a code change alone won't rebuild. A code change that
  alters computed constants also needs its cache `_CACHE_VERSION` bumped (metadata.py / regressions.py)
  to invalidate stale caches. All 6 leagues rebuild separately.
- **Fielding is position-specific throughout** (separate regressions, league rates, out-values,
  and offense-derived position adjustments per position).
- **Multi-year positional adjustments.** Per-league posAdj is computed via a multi-year
  offense + defense blend (calibration windows H_def=5 / cut_def=20, H_off=2.5 / cut_off=8)
  and frozen into `_FROZEN_POS_ADJ_BY_URL` in `data_points.py` (keyed on `statsplus_url`).
  Cache version v5 invalidates pre-multi-year caches.
- **`bestPos` resolution is Option B** — `RunsP + DEF_SPECTRUM[pos]` argmax over eligible
  field positions, with an LF/RF arm-split leaf when both corners are eligible (chooses
  RF when OF arm ≥ per-league threshold, LF otherwise).
- **Position eligibility floors** are retuned against real IP usage and enforced in the
  pipeline output: LF/RF → 45 IP, 1B + IF errors > 20, SS + TDP ≥ 45.
