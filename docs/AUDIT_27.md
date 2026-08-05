# AUDIT_27 — OOTP-27 coefficient port, audit-first record

> **🔁 RE-LOCK EVENT (2026-07-02, evening) — hit/pit/BSR constants are now H-POOL-provenance.**
> The H-pool's missing de-quantized display frame (D16) was built and validated
> (`ootp27-conversion/test-league-design/scripts/build_hpool_display_maps.py`, all hard gates pass), and
> every hit/pit/baserunning row was re-derived on it and RE-LOCKED (60 jobs, roster-role SP/RP
> split, C-pool-identical weights) — the H-pool is the single calibration substrate; the C-pool
> is history. **Exception: `sp_hrr`/`rp_hrr` keep their C-pool locks** (the real-27 referee
> rejected the H-pool candidates at 1.72×/1.46× real; conflict recorded in
> `POOL_RECONCILIATION_PLAN.md` §2). `_CALIB_AVG_27` moved to the H-pool averages (paired with
> the new offsets); all baserunning c0s remain 26-canonical; fielding untouched (H-pool FINAL
> since 2026-07-01). Referee after wiring: adopted rows 0.83–1.33 of real-SSB, no sign errors;
> suite 501 passed / 24 skipped incl. the 110-case 26 byte-identical gate. Per-row old→new:
> `ootp27-conversion/test-league-design/outputs/KNOT_DECISIONS_27.md`.

> **✅ F1 FIXED (2026-07-02, rollout session) —** the hitter Steal→SBA% c0 finding below is
> RESOLVED by the league-adaptive normalization (§6): on the 27 path `compose_data_points`
> replaces the canonical c0 with `−E_w[pw(STE)]` over the league's PA-weighted MLB-batter STE
> distribution, reproducing the pooled league attempt rate by construction. 26 path untouched
> (suite 512 passed / 24 skipped incl. the 110-case 26 gate). Design ratified by Alex
> (population/compute-site/sb_pct-exclusion); details + audit trace in §6.

> **⚠ Post-port adversarial audit (2026-07-02) —** the hit/pit/baserunning calibration was
> pressure-tested against a REAL OOTP-27 league (SSB 2043) + bell@27 realistic rosters:
> `ootp27-conversion/test-league-design/docs/AUDIT_HITPIT_BR_27.md`. Outcome: **hit/pit slopes validated
> on the real 27 engine** (9 relationships at 0.82–1.19 of wired; the 26 coefficients fit worse
> nearly everywhere) and the SP Move→HR% ALARM closed (real ratio 0.97). **One real finding: the
> hitter Steal→SBA% canonical c0 (+0.0091, 🟡 26-borrowed below) is a bell-substrate artifact,
> sign-wrong for realistic leagues (real-27 ≈ −0.08; bell@27 −0.010 in a 6.5× quieter run game)**
> — the correct offset scales with the league's run environment, so no constant fixes it;
> production over-projects steal attempts ~1.9× for average-STE players (WAR impact ≤ +0.13
> elite / ~0 typical; inherited 26-live behavior, unchanged by this port). Recommended
> league-adaptive fix + two smaller findings (missing SPE co-predictor; sb_pct c0 conservative)
> are specified in the audit doc and await a design sign-off.

**Date:** 2026-07-02. **Scope:** the OOTP-27 piecewise constants and applicator generalization
landed on branch `ootp27-wiring` (`model/src/data_points.py` Section 1b, `utils.py`,
`hitters.py`, `pitchers.py`, `settings.py`, `export.py`). Per the CLAUDE.md audit-first
protocol: every input traced (🟢 our calibration · 🟡 borrowed 26 constant · 🔵 deliberate
assumption), arithmetic re-derived against the evaluator, all flags resolved before merge.

**Sources of truth:** `ootp27-conversion/test-league-design/outputs/KNOT_DECISIONS_27.md` (43 locked
relationships; fielding = H-pool FINAL re-fit 2026-07-01; hit/pit/BSR = H-pool RE-LOCK
2026-07-02, de-quantized frame, except the two kept Move rows) via
`OOTP27_WIRING_IMPLEMENTATION_SPEC.md` §7; calibration-pool averages from
`ootp27-conversion/test-league-design/outputs/viz/hpool_hitpit_bins.json` (`leagueAvg.display`, full
precision; the kept `sp_hrr`/`rp_hrr` averages stay C-pool `viz_data.json`).
Phase-A derivations (fielding re-fit, catcher decision, D-STATDEF):
`ootp27-conversion/test-league-design/docs/DERIVATION_NOTES.md`.

---

## 1. Input trace

### 1.1 🟢 From our calibration (KNOT_DECISIONS_27.md → spec §7)

| Block | Fields | Notes |
|---|---|---|
| Hitting knots/slopes | `eye, power, k, babip, gap` (relative), `speed` (absolute, clamp-lo), `sba, sb_pct, ubr` (absolute, +c0) | HITTING + BASERUNNING[hit] tables |
| Pitching knots/slopes | `sp_stu, sp_con, sp_hrr, rp_stu, rp_con, rp_hrr` (relative), `sp_babip, rp_babip` (relative singles), `sba(SP), rp_sba, sp_sb_pct, rp_sb_pct` (absolute, +c0) | PITCHING[SP]/[RP] + BASERUNNING[pit] tables |
| Fielding piecewise | `ss/second/first_pm_rng_slope, lf/cf/rf_pm_slope, c_frm_slope` | H-pool FINAL rows (LOCKED (H-pool)) |
| Fielding singles | `third_pm_rng_slope, {second,third,ss}_pm_arm_slope, all 7 *_err_slope, {lf,cf,rf}_arm_slope, c_sba_slope, c_rto_slope` | H-pool / LOCKED-KEPT rows |
| Calibration averages | `_CALIB_AVG_27` (13 values) | H-pool `hpool_hitpit_bins.json` leagueAvg.display (re-lock 2026-07-02); `sp_hrr`/`rp_hrr` stay C-pool `viz_data.json`. Used ONLY to convert absolute knots → stored offsets for relative rows |

**Transcription convention (relative rows):** stored `knots = knot_abs − calib_avg` at
source full precision (e.g. eye: 26/49/79 − 56.038). `tests/test_regressions_27.py::
TestAllConstants27` re-derives every stored offset back to the absolute KNOT_DECISIONS values
and asserts equality.

### 1.2 🟡 Borrowed 26 constants (provenance = `data_points.py` 26 defaults)

| Item | Value(s) | Why borrowed |
|---|---|---|
| Baserunning intercepts | hit `sba.c0` 0.009116895606791357 **(27: stored canonical only — superseded at compose time by the league-adaptive `−E_w[pw(STE)]`, §6; canonical remains the no-distribution fallback)**, `sb_pct.c0` −0.13320702812059265, `ubr.c0` 3.093821597831973e-05; pit `sba.c0`/`rp_sba.c0` 0.0007224917422994285 (26's single shared value), `sp_sb_pct.c0` −0.01179124984884817, `rp_sb_pct.c0` −0.007441413482453901 | Spec §2.5: these channels apply as `poly + lg.rate` where lg.rate is the pooled (attempt-weighted) rate; c0 is the real average-rated-vs-pooled offset. The 27 calibration slopes are de-meaned and cannot supply it. Asserted `== 26 canonical` in tests. |
| Fielding consts | every `*_const` (incl. `c_frm_const`, `c_sba_const`, `c_rto_const`) | Spec §7.4: the const is the position baseline; 27 changes only slopes. |
| 1B height slope | `first_pm_ht_slope` 0.0003878808525983733 | D-1BHT (see 🔵). |
| DP slopes | `second_dp_*`, `ss_dp_*` | D-DP (see 🔵). |

### 1.3 🔵 Deliberate assumptions (the spec §10 open decisions, defaults accepted)

| ID | Decision taken | Rationale / risk |
|---|---|---|
| D-DUALPARK | `_dual_park` additive/mult crossover for 27 = `rating >= lg.avg` (26 keeps 50) | 27 curves are continuous — no natural 50 split exists; additive at/above average skill. Park-application detail only; deltas/slopes unaffected. |
| D-1BHT | keep 26 `first_pm_ht_slope` | No 27 height calibration; height is orthogonal to range. |
| D-DP | keep 26 DP slopes | No 27 DP calibration in the locked set. |
| D-SBASPLIT | added optional `PitchingRegressionCoeffs.rp_sba`; `None` (the 26 default) ⇒ RP shares `sba` exactly as before | 27 calibrates SP/RP Hold→SBA separately (−0.00133 / −0.00096). Both reuse 26's single shared canonical c0 — 26 never had per-role sba intercepts; the shared offset is the best available anchor. **Surfaced dataclass change** (§4 below). |
| D-PBABIP | `sp_babip`/`rp_babip` wired to the locked 27 singles (−0.00070/−0.00058) rather than the 26 two-segment values | OOTP's import ignores imported pbabip, so the channel is near-immaterial; the locked table values are used verbatim for provenance cleanliness. (26 values were −0.00085/−0.00080 slope — same order.) |
| Stuff-cap placement | displayed STU clipped at 88 immediately at read, BEFORE the SP-section −5 / RP-section +5 POS conventions | D24 caps the *displayed* rating; the ±5 shifts are internal role conventions applied to display. An RP-section SP-POS pitcher at capped 88 evaluates at 93 — the convention operating on capped display, consistent with 26's ordering. |
| RP low-branch centering | 27 `_stu_delta_rp` evaluates the piecewise on the ADJUSTED rating | The 26 "low branch centers on raw STU" subtlety is an artifact of two discontinuous segments; a continuous curve has no branches. Spec §4.3 directive. |

### 1.4 Regime classification (spec §2 — classify by PREDICTOR, never stat family)

Relative (offset knots, slide with lg.avg): EYE POW K BA GAP · STU CON HRR PBABIP.
Absolute (fixed knots): SPE (→3B% — hitting family, absolute predictor ⚠), STE, RUN, HLD, all
fielding ratings. Encoded per-row as `PiecewiseCoeffs.relative`; asserted field-by-field in
`TestAllConstants27`.

---

## 2. Arithmetic re-derivations (spec §8.2 — one per family, 3 ratings: below / mid / above)

All values produced by the shipped evaluator and verified by hand; the same checks are
executable in `tests/test_regressions_27.py` (`TestSliceDeltasByHand`, `TestPiecewiseDelta`).
`piecewise_delta` is the ReLU-basis integral `cum(x) − cum(avg)` — continuous by construction,
`delta(avg)=0` by construction; clamped ends are FP-exact flat (inputs clipped into the band;
end slopes are 0 so this is mathematically identical).

**HIT eye (relative), league avg 52.0 → knots at 52 + (40,67,79 − 55.447) = 36.553 / 63.553 / 75.553:**
- delta(30) = −[0.00271·(36.553−30) + 0.00225·(52−36.553)] = −(0.01775863 + 0.03475575) = **−0.05251438** ✓
- delta(60) = 0.00225·8 = **+0.01800000** ✓
- delta(80) = 0.00225·11.553 + 0.00150·12.0 + 0.00313·4.447 = **+0.05791336** ✓

**PIT sp_con (relative), league avg_con_sp 50.7836 → knots at 23.06/31.06/45.06/59.06:**
- delta(30) = +0.05470648 (low control → more walks) · delta(55) = −0.00678847 · delta(75) = −0.03022123 ✓

**HIT speed (absolute, clamp-lo), league avg_speed 47.61, knots 34/50 fixed:**
- delta(20) = delta(34) = −0.00314·(47.61−34) = **−0.04273540** (floor exact) ✓
- delta(45) = −0.00314·2.61 = −0.00819540 ✓ · delta(60) = 0.00314·2.39 + 0.00280·10 = +0.03550460 ✓

**FLD ss_pm_rng (absolute), avg_rng_ss 67.09108, knots 62/68:**
- delta(50) = −[0.00052·12 + 0.00190·(67.09108−62)] = **−0.01591305** ✓
- delta(65) = −0.00190·2.09108 = −0.00397305 ✓ · delta(75) = 0.00190·0.90892 + 0.00654·7 = **+0.04750695** ✓

**FLD c_frm (absolute, clamp-both), avg_frm_c 62.69286, knots 37/73:**
- delta(20) = delta(37) = −0.03083144 · delta(73) = delta(90) = +0.01236856 (both ends FP-exact flat) ✓

**BSR sb_pct (absolute, canonical c0), avg_steal 50.46, knee 70; applied as poly + lg.sb_pct (0.78104):**
- STE 50.46 (avg) → poly = c0 = −0.13320703 → SB% **0.64783** (the calibrated average-rated rate ≈0.65 ✓)
- STE 30 → SB% 0.43403 · STE 80 → poly = c0 + 0.01045·19.54 + 0.00255·10 → SB% **0.87753** ✓ (sane, < 1.0 cap)

**Continuity + anchor:** `TestPiecewiseDelta::test_continuity_at_knots` (ε=1e-9 both regimes),
`test_anchor_zero_at_avg`, and `test_matches_scalar_reference_everywhere` (a from-scratch scalar
segment-summation reference, every 0.5 display point over 20–85, atol 1e-12).

**26-vs-27 continuity sanity (EYE at avg_eye 49.82):** 35 → −0.03377/−0.03334 · 50 →
+0.00211/+0.00041 · 65 → +0.03016/+0.03143 · 80 → +0.05821/+0.06474 (26 | 27). The two
calibrations nearly coincide mid-band and 27 steepens at the elite end, as the knot tables say.

---

## 3. Fielding frame confirmation (spec §8.3)

The 27 fielding range/framing targets are **made/TOTAL (PM%)** — Σmade_b/Σopps_b over the 6
difficulty buckets — matching the production PM% frame (the 26 `*_pm_*` cache is v4/PM%,
reverted from OAA 2026-06-28 per `FIELDING_DENOMINDATOR_DECISION`-lineage; see
`fielding-range-target-made-total`). D-STATDEF closed the remaining absolute-relationship
definitions: production 3B% ≡ calibration `t/(d+t)` (`lg.triple_rate·xbh` chain) and SBA% ≡
attempts per time-on-first (`sba_rate·on_first`, `on_first = 1B+uBB+HBP`, both hit and pit
sides). Details + the accepted ≲1% BB-vs-uBB denominator nit: `DERIVATION_NOTES.md` §3.

---

## 4. Surfaced structural change: `sba` / `rp_sba`

`PitchingRegressionCoeffs` gains an optional trailing field `rp_sba` (default `None`).
- 26 path: `rp_sba is None` → `pitchers.py` selects the shared `reg.sba` for both roles —
  literally the pre-change behavior; the field is never constructed by `regressions.py`
  (keyword-only construction sites verified: `regressions.py:956`, `:1242` — untouched).
- 27 path: `DEFAULT_PITCHING_REG_COEFFS_27` sets both; RP uses `rp_sba` (−0.00096), SP `sba`
  (−0.00133).
- Cache/serialization: the regressions JSON cache dumps via `dataclasses.asdict`, so fresh 26
  cache writes now carry an extra `"rp_sba": null` key; the load path (`regressions.py:~1242`)
  constructs field-by-field and ignores unknown keys, so old caches (no key) and new caches
  (null) both load correctly — verified by the passing cache-roundtrip cases in
  `test_regressions.py`.

---

## 5. Flags raised and resolved

| Flag | Resolution |
|---|---|
| Catcher `c_frm`/`c_sba` (KNOT_DECISIONS ⚠) | RESOLVED 2026-07-01 on the H-pool (c_frm real-27-validated: +0.00116 in-band vs +0.00120). `DERIVATION_NOTES.md` §2. |
| D-STATDEF 3B%/SBA% denominators | RESOLVED — frames match production exactly (§3 above). |
| `c_sba` real-27 validation | Follow-up (non-blocking): SSB-2043 univariate CI is uninformative (n=56 part-season); re-validate on a full SSB-27 season together with `c_rto`. Tracked in KNOT_DECISIONS_27.md. |
| WAR smell test 27-side bridge | Phase-E item: `ssb_war_smell_test` sources the 27 side via a retired bridge — see the Phase E report (HANDOFF.md) for status. |
| 2B range curve challenged post-rollout (Alex, 2026-07-03: SSB 2B runsP ceiling +40; 2B>SS ordering) | **RESOLVED 2026-07-04 — lock KEPT, VALIDATED as engine truth** by two-substrate bucket decomposition (step synchronized across all difficulty buckets, mix rating-invariant, arm/error/neighbor/exposure null; bell@27 agrees at bucket level). The user-visible ordering symptom traces to the 26-era frozen `_FROZEN_POS_ADJ_BY_URL` spectrum not reflecting the 27 engine's redistribution of defensive value — design question OPEN: `ootp27-conversion/test-league-design/docs/POSADJ_27_DESIGN_QUESTION.md`. Full derivation record: `ootp27-conversion/test-league-design/docs/DERIVATION_NOTES.md` (fifth batch). |

No un-traced constant ships: every field of the three 27 sets is asserted against its
KNOT_DECISIONS row (or its 26 origin, for 🟡 fields) in `TestAllConstants27` — 104 passing
cases as of Phase C, alongside the untouched 110-case 26 byte-identical suite.

---

## 6. League-adaptive sba c0 (F1 fix, 2026-07-02 rollout session)

**Problem** (AUDIT_HITPIT_BR_27 §F1): the hitter Steal→SBA% channel applies as
`c0 + pw(STE) + lg.sba_rate` with `lg.sba_rate` the POOLED (attempt-weighted) league rate.
Self-consistency requires `c0 = avg-rated rate − pooled rate`, and because attempts are strongly
convex in STE this is a Jensen gap that scales with the league's run environment — the
26-canonical +0.0091 (quiet bell substrate: no spread ⇒ no gap) is sign-wrong for every
realistic league; no constant is correct for all leagues.

**Mechanism** (design ratified by Alex 2026-07-02: MLB-metadata population, PA weighting,
metadata/compose-time compute, sb_pct excluded):
- `aggregators/hit_aggregator._compute_ste_pa_distribution` — PA-weighted STE distribution of
  the league's MLB batters (vR/vL blended by `ovr_vr` — the exact population/weighting of
  `avg_steal`) → new `HitterLeagueParams.ste_pa_dist` (`None`-safe; default `None`).
- `metadata._blend_params` — multi-season pooling blends distribution fields as a
  season-weighted measure mixture (per-season renormalized — the distribution analogue of the
  scalar field-wise mean); any season missing a distribution ⇒ `None` (fallback).
- `metadata._with_league_adaptive_sba_c0` (called from `compose_data_points`) — 27 path only
  (`isinstance(sba, PiecewiseCoeffs)`): replaces `sba.c0` with `−E_w[pw(STE)]`, so
  `E_w[c0 + pw + lg.sba_rate] = lg.sba_rate` **exactly by construction**. 26 (`CubicCoeffs`)
  and no-distribution leagues pass through by identity (canonical c0 = pre-fix behavior).
- Metadata `_CACHE_VERSION` 5 → 6 (v5 caches lack the distribution and would silently keep the
  canonical c0 on 27 leagues).

**Input trace:** 🟢 STE + PA from the league's own metadata batter files (same files as
`avg_steal`); 🟢 `pw` = the locked 27 sba piecewise; 🔵 PA approximates on-first weighting
(ratified; pooled-rate reproduction is exact w.r.t. the PA measure).

**Re-derivation on real data (SSB metadata, 2041+2042 pooled):** STE is 5-pt quantized 20–80
(13 values); `E[dist]` 49.96 vs `avg_steal` 49.90 (Δ from 13 NaN-STE rows, 269 PA ≈ 0.2%, which
`_weighted_mean` keeps in its denominator — the distribution correctly excludes unprojectable
rows; the invariant is anchor-independent). Adaptive c0 = **−0.02538** (replaces +0.00912) in a
`lg.sba_rate` = 0.101 environment; `E_w[c0 + pw]` = −3.0e−18 ✓. The audit's real-27 descriptive
estimate (−0.44 × rate ≈ −0.044) is larger because it includes real-engine convexity beyond the
wired curve (the deliberately-unwired SPE co-predictor) — this fix makes the league TOTAL exact
under the wired curve and fixes the sign; the SPE co-predictor remains a reported, unwired
follow-up.

**Tests** (`TestLeagueAdaptiveSbaC0`, 11 cases): pooled-rate reproduction on a synthetic league
(abs 1e−15), sign fix, no-distribution fallback, only-sba-changes (sb_pct/ubr identity), 26-path
identity pass-through, degenerate all-average league ⇒ c0 = 0, season-mixture blending +
missing-season fallback, aggregator-vs-avg_steal consistency on clean data, missing-STE-column
`None`, cache JSON roundtrip. Full suite 512 passed / 24 skipped; the 110-case 26 byte-identical
gate untouched.
