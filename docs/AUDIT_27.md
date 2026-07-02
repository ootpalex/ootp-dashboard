# AUDIT_27 — OOTP-27 coefficient port, audit-first record

> **⚠ Post-port adversarial audit (2026-07-02) —** the hit/pit/baserunning calibration was
> pressure-tested against a REAL OOTP-27 league (SSB 2043) + bell@27 realistic rosters:
> `analysis/test-league-design/docs/AUDIT_HITPIT_BR_27.md`. Outcome: **hit/pit slopes validated
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

**Sources of truth:** `analysis/test-league-design/outputs/KNOT_DECISIONS_27.md` (43 locked
relationships; fielding = H-pool FINAL re-fit 2026-07-01) via
`OOTP27_WIRING_IMPLEMENTATION_SPEC.md` §7; calibration-pool averages from
`analysis/test-league-design/outputs/viz/viz_data.json` (`leagueAvg.display`, full precision).
Phase-A derivations (fielding re-fit, catcher decision, D-STATDEF):
`analysis/test-league-design/docs/DERIVATION_NOTES.md`.

---

## 1. Input trace

### 1.1 🟢 From our calibration (KNOT_DECISIONS_27.md → spec §7)

| Block | Fields | Notes |
|---|---|---|
| Hitting knots/slopes | `eye, power, k, babip, gap` (relative), `speed` (absolute, clamp-lo), `sba, sb_pct, ubr` (absolute, +c0) | HITTING + BASERUNNING[hit] tables |
| Pitching knots/slopes | `sp_stu, sp_con, sp_hrr, rp_stu, rp_con, rp_hrr` (relative), `sp_babip, rp_babip` (relative singles), `sba(SP), rp_sba, sp_sb_pct, rp_sb_pct` (absolute, +c0) | PITCHING[SP]/[RP] + BASERUNNING[pit] tables |
| Fielding piecewise | `ss/second/first_pm_rng_slope, lf/cf/rf_pm_slope, c_frm_slope` | H-pool FINAL rows (LOCKED (H-pool)) |
| Fielding singles | `third_pm_rng_slope, {second,third,ss}_pm_arm_slope, all 7 *_err_slope, {lf,cf,rf}_arm_slope, c_sba_slope, c_rto_slope` | H-pool / LOCKED-KEPT rows |
| Calibration averages | `_CALIB_AVG_27` (13 values) | `viz_data.json` leagueAvg.display; used ONLY to convert absolute knots → stored offsets for relative rows |

**Transcription convention (relative rows):** stored `knots = knot_abs − calib_avg` at
viz_data full precision (e.g. eye: 40/67/79 − 55.447). The spec's §7 tables round calib_avg to
1 decimal; the ≤0.05-display-unit placement difference is immaterial (curves are continuous;
slopes unchanged). `tests/test_regressions_27.py::TestAllConstants27` re-derives every stored
offset back to the absolute KNOT_DECISIONS values and asserts equality.

### 1.2 🟡 Borrowed 26 constants (provenance = `data_points.py` 26 defaults)

| Item | Value(s) | Why borrowed |
|---|---|---|
| Baserunning intercepts | hit `sba.c0` 0.009116895606791357, `sb_pct.c0` −0.13320702812059265, `ubr.c0` 3.093821597831973e-05; pit `sba.c0`/`rp_sba.c0` 0.0007224917422994285 (26's single shared value), `sp_sb_pct.c0` −0.01179124984884817, `rp_sb_pct.c0` −0.007441413482453901 | Spec §2.5: these channels apply as `poly + lg.rate` where lg.rate is the pooled (attempt-weighted) rate; c0 is the real average-rated-vs-pooled offset. The 27 calibration slopes are de-meaned and cannot supply it. Asserted `== 26 canonical` in tests. |
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

No un-traced constant ships: every field of the three 27 sets is asserted against its
KNOT_DECISIONS row (or its 26 origin, for 🟡 fields) in `TestAllConstants27` — 104 passing
cases as of Phase C, alongside the untouched 110-case 26 byte-identical suite.
