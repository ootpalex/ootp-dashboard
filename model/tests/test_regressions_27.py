"""OOTP-27 piecewise coefficient suite.

Covers, per OOTP27_WIRING_IMPLEMENTATION_SPEC.md §9:
  1. The PiecewiseCoeffs datatype + regime-aware piecewise_delta evaluator (continuity,
     delta(avg)=0, clamps, relative-vs-absolute knot placement).
  2. Type-dispatch NO-OP proofs: every generalized applicator reproduces the historical
     26 arithmetic EXACTLY (==, not approx) when handed 26 coefficient objects.
  3. The 27 constants (DEFAULT_*_REG_COEFFS_27) match KNOT_DECISIONS_27.md, with by-hand
     delta spot checks per applicator family.
  4. Version routing: ootp_version "27" selects the constants; "26" never does.

The 26 byte-identical gate itself is tests/test_regressions.py (unchanged, 0.00% tol).
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pandas as pd
import pytest

from src.data_points import (
    DEFAULT_FIELDING_REG_COEFFS_27,
    DEFAULT_HITTER_DP,
    DEFAULT_HITTING_REG_COEFFS_27,
    DEFAULT_PITCHER_DP,
    DEFAULT_PITCHING_REG_COEFFS_27,
    _CALIB_AVG_27,
    CubicCoeffs,
    FieldingRegressionCoeffs,
    HittingRegressionCoeffs,
    LinearCoeffs,
    PiecewiseCoeffs,
    PitchingRegressionCoeffs,
)
from src.hitters import _dual_park, _fld_delta
from src.pitchers import _STUFF_CAP_27, _stu_delta_rp
from src.utils import baserunning_poly, piecewise_delta, rating_to_delta


def _pw(rating: float, avg: float, c: PiecewiseCoeffs) -> float:
    """Scalar-by-hand piecewise delta for cross-checking the vectorized evaluator."""
    knots = [avg + k for k in c.knots] if c.relative else list(c.knots)
    segs = [-np.inf] + knots + [np.inf]
    lo, hi = (rating, avg) if rating <= avg else (avg, rating)
    total = 0.0
    for i, s in enumerate(c.slopes):
        a, b = max(segs[i], lo), min(segs[i + 1], hi)
        if b > a:
            total += s * (b - a)
    return total if rating >= avg else -total


# ---------------------------------------------------------------------------
# 1. PiecewiseCoeffs datatype
# ---------------------------------------------------------------------------


class TestPiecewiseCoeffs:
    def test_len_mismatch_rejected(self):
        with pytest.raises(AssertionError):
            PiecewiseCoeffs(knots=(50.0,), slopes=(0.1,))

    def test_unsorted_knots_rejected(self):
        with pytest.raises(AssertionError):
            PiecewiseCoeffs(knots=(60.0, 50.0), slopes=(0.1, 0.2, 0.3))

    def test_clamp_flags_require_zero_end_slopes(self):
        with pytest.raises(AssertionError):
            PiecewiseCoeffs(knots=(50.0,), slopes=(0.1, 0.2), clamp_lo=True)
        with pytest.raises(AssertionError):
            PiecewiseCoeffs(knots=(50.0,), slopes=(0.1, 0.2), clamp_hi=True)

    def test_single_line_no_knots(self):
        c = PiecewiseCoeffs(knots=(), slopes=(0.002,), relative=False)
        assert piecewise_delta(60.0, 50.0, c) == pytest.approx(0.02)


# ---------------------------------------------------------------------------
# 2. piecewise_delta evaluator
# ---------------------------------------------------------------------------

ABS_2K = PiecewiseCoeffs(knots=(45.0, 60.0), slopes=(0.001, 0.004, 0.002), relative=False)
REL_2K = PiecewiseCoeffs(knots=(-10.0, 5.0), slopes=(0.001, 0.004, 0.002), relative=True)


class TestPiecewiseDelta:
    def test_anchor_zero_at_avg(self):
        for c in (ABS_2K, REL_2K):
            for avg in (48.0, 55.0, 63.0):
                assert piecewise_delta(avg, avg, c) == pytest.approx(0.0)

    def test_matches_scalar_reference_everywhere(self):
        ratings = pd.Series(np.arange(20.0, 85.0, 0.5))
        for c in (ABS_2K, REL_2K):
            for avg in (50.0, 55.0):
                vec = piecewise_delta(ratings, avg, c)
                ref = np.array([_pw(r, avg, c) for r in ratings])
                assert np.allclose(vec, ref, atol=1e-12)

    def test_continuity_at_knots(self):
        eps = 1e-9
        for c in (ABS_2K, REL_2K):
            avg = 55.0
            knots = [avg + k for k in c.knots] if c.relative else list(c.knots)
            for k in knots:
                lo = piecewise_delta(k - eps, avg, c)
                hi = piecewise_delta(k + eps, avg, c)
                assert hi - lo == pytest.approx(0.0, abs=1e-6)

    def test_segment_slopes_realized(self):
        avg = 55.0
        # ABS_2K segments: (-inf,45): 0.001 · (45,60): 0.004 · (60,inf): 0.002
        d = lambda r: piecewise_delta(r, avg, ABS_2K)
        assert d(41.0) - d(40.0) == pytest.approx(0.001)
        assert d(51.0) - d(50.0) == pytest.approx(0.004)
        assert d(71.0) - d(70.0) == pytest.approx(0.002)

    def test_relative_knots_slide_with_avg(self):
        # REL: knee at avg-10. For avg=50 the 0.001→0.004 break is at 40; for avg=60 at 50.
        d50 = piecewise_delta(41.0, 50.0, REL_2K) - piecewise_delta(39.0, 50.0, REL_2K)
        d60 = piecewise_delta(51.0, 60.0, REL_2K) - piecewise_delta(49.0, 60.0, REL_2K)
        assert d50 == pytest.approx(0.001 + 0.004, abs=1e-9)   # straddles the knee both times
        assert d60 == pytest.approx(0.001 + 0.004, abs=1e-9)

    def test_absolute_knots_do_not_slide(self):
        # ABS: break fixed at 45 regardless of avg.
        for avg in (50.0, 60.0):
            step = piecewise_delta(46.0, avg, ABS_2K) - piecewise_delta(44.0, avg, ABS_2K)
            assert step == pytest.approx(0.001 + 0.004, abs=1e-9)

    def test_clamp_lo_flat_floor(self):
        c = PiecewiseCoeffs(knots=(34.0, 50.0), slopes=(0.0, 0.00314, 0.0028),
                            relative=False, clamp_lo=True)
        assert piecewise_delta(20.0, 47.0, c) == piecewise_delta(34.0, 47.0, c)

    def test_clamp_hi_flat_ceiling(self):
        c = PiecewiseCoeffs(knots=(37.0, 73.0), slopes=(0.0, 0.0012, 0.0),
                            relative=False, clamp_lo=True, clamp_hi=True)
        assert piecewise_delta(85.0, 62.0, c) == piecewise_delta(73.0, 62.0, c)
        assert piecewise_delta(20.0, 62.0, c) == piecewise_delta(37.0, 62.0, c)


# ---------------------------------------------------------------------------
# 3. Dispatch NO-OP proofs — 26 arithmetic reproduced exactly
# ---------------------------------------------------------------------------

RATINGS = pd.Series([20.0, 35.0, 49.0, 49.999, 50.0, 50.001, 55.0, 70.0, 85.0])


class TestDispatch26Unchanged:
    def test_rating_to_delta_linear_exact(self):
        c = LinearCoeffs(h_const=0.0017, h_slope=0.0019, l_const=-0.0034, l_slope=0.0021)
        avg = 49.82
        got = rating_to_delta(RATINGS, avg, c)
        centered = RATINGS - avg
        want = pd.Series(
            np.where(RATINGS >= 50, c.h_const + c.h_slope * centered,
                     c.l_const + c.l_slope * centered),
            index=RATINGS.index,
        )
        assert (got == want).all()          # exact, not approx

    def test_baserunning_poly_cubic_exact(self):
        c = CubicCoeffs(c0=-0.13320702812059265, c1=0.008501465263446395)
        got = baserunning_poly(RATINGS, 50.46, c)
        want = c.c0 + c.c1 * (RATINGS - 50.46)
        assert (got == want).all()

    def test_dual_park_default_crossover_exact(self):
        base = pd.Series([0.1, 0.2, 0.3])
        rating = pd.Series([49.0, 50.0, 51.0])
        mult = pd.Series([1.1, 1.1, 1.1])
        got = _dual_park(base, rating, 0.05, mult)
        want = pd.Series(np.where(rating >= 50, base + 0.05, base * mult), index=base.index)
        assert (got == want).all()

    def test_fld_delta_scalar_exact(self):
        slope = 0.004131565657882436
        got = _fld_delta(RATINGS, 67.09107669009565, slope)
        want = slope * (RATINGS - 67.09107669009565)
        assert (got == want).all()

    def test_stu_delta_rp_linear_unchanged(self):
        c = DEFAULT_PITCHER_DP.pitching.rp_stu
        avg = DEFAULT_PITCHER_DP.league.avg_stu_rp
        stu = pd.Series([45.0, 55.0])
        pos = pd.Series(["SP", "CL"])
        got = _stu_delta_rp(stu, avg, c, pos)
        # SP@45 → adjusted 50 → high branch centered on 50; CL@55 → high branch on 55
        assert got.iloc[0] == c.h_const + c.h_slope * (50.0 - avg)
        assert got.iloc[1] == c.h_const + c.h_slope * (55.0 - avg)

    def test_rp_sba_defaults_to_none_shared_sba(self):
        assert PitchingRegressionCoeffs().rp_sba is None
        assert DEFAULT_PITCHER_DP.pitching.rp_sba is None


# ---------------------------------------------------------------------------
# 4. The 27 constants — Phase-B representative slice
#    (Phase C extends these assertions to every field.)
# ---------------------------------------------------------------------------


class TestSliceConstants:
    def test_eye_matches_knot_decisions(self):
        c = DEFAULT_HITTING_REG_COEFFS_27.eye
        assert isinstance(c, PiecewiseCoeffs) and c.relative
        # stored offsets + calibration avg == the KNOT_DECISIONS_27 absolute knots
        # (H-pool re-lock 2026-07-02)
        abs_knots = tuple(k + _CALIB_AVG_27["eye"] for k in c.knots)
        assert abs_knots == pytest.approx((26.0, 49.0, 79.0))
        assert c.slopes == (0.00056, 0.00256, 0.00176, 0.00579)

    def test_speed_matches_knot_decisions(self):
        c = DEFAULT_HITTING_REG_COEFFS_27.speed
        assert isinstance(c, PiecewiseCoeffs) and not c.relative and c.clamp_lo
        assert c.knots == (34.0, 50.0)
        assert c.slopes == (0.0, 0.00312, 0.00281)

    def test_sb_pct_carries_canonical_c0(self):
        c = DEFAULT_HITTING_REG_COEFFS_27.sb_pct
        assert isinstance(c, PiecewiseCoeffs) and not c.relative and c.clamp_lo
        # H-pool re-lock 2026-07-02: the engine STEP form (jump across STE 34→36)
        assert c.knots == (34.0, 36.0, 72.0) and c.slopes == (0.0, 0.09328, 0.01014, 0.00157)
        assert c.c0 == HittingRegressionCoeffs().sb_pct.c0   # 26 canonical intercept

    def test_rp_stu_matches_knot_decisions(self):
        c = DEFAULT_PITCHING_REG_COEFFS_27.rp_stu
        assert isinstance(c, PiecewiseCoeffs) and c.relative
        abs_knots = tuple(k + _CALIB_AVG_27["rp_stu"] for k in c.knots)
        assert abs_knots == pytest.approx((41.0, 78.0))
        assert c.slopes == (0.00622, 0.00339, 0.01025)

    def test_ss_range_matches_knot_decisions(self):
        c = DEFAULT_FIELDING_REG_COEFFS_27.ss_pm_rng_slope
        assert isinstance(c, PiecewiseCoeffs) and not c.relative
        assert c.knots == (62.0, 68.0)
        assert c.slopes == (0.00052, 0.00190, 0.00654)

    def test_c_frm_matches_knot_decisions(self):
        c = DEFAULT_FIELDING_REG_COEFFS_27.c_frm_slope
        assert isinstance(c, PiecewiseCoeffs) and not c.relative
        assert c.clamp_lo and c.clamp_hi
        assert c.knots == (37.0, 73.0)
        assert c.slopes == (0.0, 0.00120, 0.0)


class TestSliceDeltasByHand:
    """One hand-computed delta per applicator family (spec §8.2: below / mid / above knots)."""

    def test_eye_offsets_regime(self):
        # League avg EYE 52.0 → knots at 52 + (26−56.038, 49−56.038, 79−56.038)
        #                              = (21.962, 44.962, 74.962).
        c = DEFAULT_HITTING_REG_COEFFS_27.eye
        avg = 52.0
        # rating 60 (segment 3, same as the avg): delta = 0.00176 * (60 − 52)
        got = rating_to_delta(pd.Series([60.0]), avg, c).iloc[0]
        assert got == pytest.approx(0.00176 * 8.0, abs=1e-9)
        # rating 30 (segment 2): −[0.00256*(44.962−30) + 0.00176*(52−44.962)]
        got = rating_to_delta(pd.Series([30.0]), avg, c).iloc[0]
        want = -(0.00256 * (44.962 - 30.0) + 0.00176 * (52.0 - 44.962))
        assert got == pytest.approx(want, abs=1e-9)
        # rating 80 (above all knots): 0.00176*(74.962−52) + 0.00579*(80−74.962)
        got = rating_to_delta(pd.Series([80.0]), avg, c).iloc[0]
        want = 0.00176 * (74.962 - 52.0) + 0.00579 * (80.0 - 74.962)
        assert got == pytest.approx(want, abs=1e-9)

    def test_speed_absolute_floor(self):
        # SPE floor: below 34 the curve is flat — a 20 and a 34 sit together.
        c = DEFAULT_HITTING_REG_COEFFS_27.speed
        avg = 47.61   # 26-default league avg speed; knots are ABSOLUTE (34, 50)
        d20 = rating_to_delta(pd.Series([20.0]), avg, c).iloc[0]
        d34 = rating_to_delta(pd.Series([34.0]), avg, c).iloc[0]
        assert d20 == d34                                  # clamp floor
        assert d34 == pytest.approx(-(0.00312 * (47.61 - 34.0)), abs=1e-9)
        # above the 50 knee: delta(60) = 0.00312*(50−47.61) + 0.00281*(60−50)
        d60 = rating_to_delta(pd.Series([60.0]), avg, c).iloc[0]
        assert d60 == pytest.approx(0.00312 * (50.0 - 47.61) + 0.00281 * 10.0, abs=1e-9)

    def test_sb_pct_poly_with_c0(self):
        c = DEFAULT_HITTING_REG_COEFFS_27.sb_pct
        avg = 50.46
        # STE 80 (above the 72 knee; avg inside the 36–72 rise segment):
        #   c0 + 0.01014*(72−50.46) + 0.00157*(80−72)
        got = baserunning_poly(pd.Series([80.0]), avg, c).iloc[0]
        want = c.c0 + 0.01014 * (72.0 - 50.46) + 0.00157 * 8.0
        assert got == pytest.approx(want, abs=1e-9)
        # clamp-lo floor: STE 20 == STE 34 (the step form's floor knee)
        d20 = baserunning_poly(pd.Series([20.0]), avg, c).iloc[0]
        d34 = baserunning_poly(pd.Series([34.0]), avg, c).iloc[0]
        assert d20 == d34

    def test_ss_range_piecewise(self):
        c = DEFAULT_FIELDING_REG_COEFFS_27.ss_pm_rng_slope
        avg = 67.09107669009565   # 26-default avg_rng_ss; knots ABSOLUTE (62, 68)
        # rating 75: 0.00190*(68−67.091...) + ... wait 67.091 is inside (62,68):
        # delta(75) = 0.00190*(68−avg) + 0.00654*(75−68)
        got = _fld_delta(pd.Series([75.0]), avg, c).iloc[0]
        want = 0.00190 * (68.0 - avg) + 0.00654 * 7.0
        assert got == pytest.approx(want, abs=1e-9)
        # rating 50 (below 62): −[0.00052*(62−50) + 0.00190*(avg−62)]
        got = _fld_delta(pd.Series([50.0]), avg, c).iloc[0]
        want = -(0.00052 * 12.0 + 0.00190 * (avg - 62.0))
        assert got == pytest.approx(want, abs=1e-9)

    def test_c_frm_clamped_both_ends(self):
        c = DEFAULT_FIELDING_REG_COEFFS_27.c_frm_slope
        avg = 62.69286389219835   # 26-default avg_frm_c
        d = lambda r: _fld_delta(pd.Series([float(r)]), avg, c).iloc[0]
        assert d(20) == d(37)                    # flat floor
        assert d(90) == d(73)                    # flat ceiling
        assert d(73) == pytest.approx(0.00120 * (73.0 - avg), abs=1e-9)

    def test_rp_stu_sp_pos_plus5_and_offsets(self):
        c = DEFAULT_PITCHING_REG_COEFFS_27.rp_stu
        avg = 55.0
        # Knots at avg + (41−57.217, 78−57.217) = (38.783, 75.783).
        # CL @ 60 (mid segment): 0.00339 * (60 − 55)
        got = _stu_delta_rp(pd.Series([60.0]), avg, c, pd.Series(["CL"])).iloc[0]
        assert got == pytest.approx(0.00339 * 5.0, abs=1e-9)
        # SP POS @ 60 → adjusted 65: 0.00339 * (65 − 55)
        got = _stu_delta_rp(pd.Series([60.0]), avg, c, pd.Series(["SP"])).iloc[0]
        assert got == pytest.approx(0.00339 * 10.0, abs=1e-9)


class TestStuffCap27:
    def test_cap_applies_only_on_piecewise_path(self):
        """Displayed STU 95 behaves exactly like 88 in the 27 RP pipeline; 26 is uncapped."""
        from src.ballparks import neutral_adjustments
        from src.pitchers import compute_pitcher_batting

        def pitcher(stu):
            base = {
                "B": "R", "T": "R", "POS": "CL",
                "STU vR": stu, "STU vL": stu,
                "PCON vR": 50, "PCON vL": 50,
                "HRR vR": 50, "HRR vL": 50,
                "PBABIP vR": 50, "PBABIP vL": 50,
                "STU P": 60, "PCON P": 50, "HRR P": 50, "PBABIP P": 50,
                "HLD": 50, "STM": 30, "STE": 50,
            }
            for pt in ["FB", "CH", "CB", "SL"]:
                base[pt] = 55
                base[pt + "P"] = 60
            for pt in ["SI", "SP", "CT", "FO", "CC", "SC", "KC", "KN"]:
                base[pt] = "-"
                base[pt + "P"] = "-"
            return pd.DataFrame([base])

        dp27 = dataclasses.replace(DEFAULT_PITCHER_DP, pitching=DEFAULT_PITCHING_REG_COEFFS_27)
        r95 = compute_pitcher_batting(pitcher(95), neutral_adjustments(), 0.5, dp=dp27)
        r88 = compute_pitcher_batting(pitcher(88), neutral_adjustments(), 0.5, dp=dp27)
        assert r95["SO vR RP"].iloc[0] == r88["SO vR RP"].iloc[0]

        r95_26 = compute_pitcher_batting(pitcher(95), neutral_adjustments(), 0.5)
        r88_26 = compute_pitcher_batting(pitcher(88), neutral_adjustments(), 0.5)
        assert r95_26["SO vR RP"].iloc[0] > r88_26["SO vR RP"].iloc[0]


# ---------------------------------------------------------------------------
# 4b. FULL constants table — every DEFAULT_*_REG_COEFFS_27 field vs KNOT_DECISIONS_27.md
# ---------------------------------------------------------------------------

# (absolute knots, slopes, relative?, clamp_lo, clamp_hi, c0) — knots listed ABSOLUTE for
# relative rows too; the test converts stored offsets back via _CALIB_AVG_27.
_HIT_EXPECTED = {
    # H-pool RE-LOCK 2026-07-02 (de-quantized frame) — KNOT_DECISIONS_27.md
    "eye":    ((26, 49, 79), (0.00056, 0.00256, 0.00176, 0.00579), True, False, False, None),
    "power":  ((36, 79), (0.00042, 0.00116, 0.00400), True, False, False, None),
    "k":      ((15, 44), (0.0, -0.00897, -0.00483), True, True, False, None),
    "babip":  ((22, 43, 78), (0.00422, 0.00282, 0.00192, 0.00415), True, False, False, None),
    "gap":    ((30, 49, 79), (0.00389, 0.00584, 0.00237, 0.00893), True, False, False, None),
    "speed":  ((34, 50), (0.0, 0.00312, 0.00281), False, True, False, None),
    "sba":    ((37, 55, 72), (0.00076, 0.00182, 0.00642, 0.01172), False, False, False,
               0.009116895606791357),
    "sb_pct": ((34, 36, 72), (0.0, 0.09328, 0.01014, 0.00157), False, True, False,
               -0.13320702812059265),
    "ubr":    ((), (0.00019,), False, False, False, 3.093821597831973e-05),
}
_PIT_EXPECTED = {
    # H-pool RE-LOCK 2026-07-02 — EXCEPT sp_hrr/rp_hrr (C-pool locks KEPT; real-27 referee).
    "sp_stu":   ((32, 42, 78), (0.01315, 0.00603, 0.00339, 0.01078), True, False, False, None),
    "sp_con":   ((22, 42, 50, 78), (-0.00573, -0.00475, -0.00291, -0.00125, -0.00182),
                 True, False, False, None),
    "sp_hrr":   ((30, 39, 52, 65), (-0.00481, -0.00296, -0.00159, -0.00087, -0.00048),
                 True, False, False, None),
    "sp_babip": ((), (-0.00066,), True, False, False, None),
    "rp_stu":   ((41, 78), (0.00622, 0.00339, 0.01025), True, False, False, None),
    "rp_con":   ((23, 42, 50, 78), (-0.00549, -0.00472, -0.00290, -0.00123, -0.00175),
                 True, False, False, None),
    "rp_hrr":   ((31, 40, 53, 67), (-0.00449, -0.00259, -0.00159, -0.00081, -0.00037),
                 True, False, False, None),
    "rp_babip": ((), (-0.00057,), True, False, False, None),
    "sba":      ((), (-0.00148,), False, False, False, 0.0007224917422994285),
    "rp_sba":   ((), (-0.00105,), False, False, False, 0.0007224917422994285),
    "sp_sb_pct": ((42, 63), (-0.00159, -0.00059, -0.00202), False, False, False,
                  -0.01179124984884817),
    "rp_sb_pct": ((42, 64), (-0.00181, -0.00069, -0.00243), False, False, False,
                  -0.007441413482453901),
}
# Fielding piecewise rows (all ABSOLUTE, no c0).
_FLD_PW_EXPECTED = {
    "ss_pm_rng_slope":     ((62, 68), (0.00052, 0.00190, 0.00654), False, False),
    "cf_pm_slope":         ((62, 66, 71), (0.00009, 0.00665, 0.01200, 0.0), False, True),
    "second_pm_rng_slope": ((60, 69), (0.00067, 0.00879, 0.00112), False, False),
    # 1B / 3B-arm / c_rto re-fit 2026-07-02 (user-flagged structures, H-pool):
    "first_pm_rng_slope":  ((36, 49), (0.00019, 0.00206, 0.00042), False, False),
    "third_pm_rng_slope":  ((70,), (0.00281, 0.00110), False, False),
    "third_pm_arm_slope":  ((39,), (0.00032, 0.00309), False, False),
    "c_rto_slope":         ((44, 63), (0.00113, 0.00016, 0.00175), False, False),
    "lf_pm_slope":         ((48, 56), (0.00125, 0.00715, 0.0), False, True),
    "rf_pm_slope":         ((50, 57), (0.00075, 0.00676, 0.0), False, True),
    "c_frm_slope":         ((37, 73), (0.0, 0.00120, 0.0), True, True),
}
# Fielding single-line 27 scalars (errors + arms = H-pool FINAL re-base 2026-07-02).
_FLD_SCALAR_EXPECTED = {
    "second_pm_arm_slope": 0.00074, "ss_pm_arm_slope": 0.00091,
    "first_err_slope": -0.00004, "second_err_slope": -0.00007, "third_err_slope": -0.00021,
    "ss_err_slope": -0.00020, "lf_err_slope": -0.00022, "cf_err_slope": -0.00018,
    "rf_err_slope": -0.00028,
    "lf_arm_slope": 0.00021, "cf_arm_slope": 0.00023, "rf_arm_slope": 0.00024,
    "c_sba_slope": -0.00086,
}
# Fields that must KEEP their 26 values (🟡 borrowed: consts, D-1BHT, D-DP).
_FLD_KEEP_26 = [
    "c_frm_const", "c_sba_const", "c_rto_const",
    "first_pm_const", "second_pm_const", "third_pm_const", "ss_pm_const",
    "lf_pm_const", "cf_pm_const", "rf_pm_const",
    "first_err_const", "second_err_const", "third_err_const", "ss_err_const",
    "lf_err_const", "cf_err_const", "rf_err_const",
    "lf_arm_const", "cf_arm_const", "rf_arm_const",
    "first_pm_ht_slope",                        # D-1BHT: keep 26 height slope
    "second_dp_const", "second_dp_slope", "ss_dp_const", "ss_dp_slope",   # D-DP
]


class TestAllConstants27:
    """Every DEFAULT_*_REG_COEFFS_27 field equals KNOT_DECISIONS_27.md / spec §7 exactly."""

    @pytest.mark.parametrize("field", sorted(_HIT_EXPECTED))
    def test_hitting(self, field):
        abs_knots, slopes, rel, clo, chi, c0 = _HIT_EXPECTED[field]
        c = getattr(DEFAULT_HITTING_REG_COEFFS_27, field)
        assert isinstance(c, PiecewiseCoeffs)
        assert (c.relative, c.clamp_lo, c.clamp_hi) == (rel, clo, chi)
        stored_abs = tuple(k + _CALIB_AVG_27[field] for k in c.knots) if rel else c.knots
        assert stored_abs == pytest.approx(abs_knots)
        assert c.slopes == slopes
        assert c.c0 == c0

    @pytest.mark.parametrize("field", sorted(_PIT_EXPECTED))
    def test_pitching(self, field):
        abs_knots, slopes, rel, clo, chi, c0 = _PIT_EXPECTED[field]
        c = getattr(DEFAULT_PITCHING_REG_COEFFS_27, field)
        assert isinstance(c, PiecewiseCoeffs)
        assert (c.relative, c.clamp_lo, c.clamp_hi) == (rel, clo, chi)
        stored_abs = tuple(k + _CALIB_AVG_27[field] for k in c.knots) if rel else c.knots
        assert stored_abs == pytest.approx(abs_knots)
        assert c.slopes == slopes
        assert c.c0 == c0

    @pytest.mark.parametrize("field", sorted(_FLD_PW_EXPECTED))
    def test_fielding_piecewise(self, field):
        knots, slopes, clo, chi = _FLD_PW_EXPECTED[field]
        c = getattr(DEFAULT_FIELDING_REG_COEFFS_27, field)
        assert isinstance(c, PiecewiseCoeffs) and not c.relative
        assert (c.clamp_lo, c.clamp_hi) == (clo, chi)
        assert c.knots == tuple(float(k) for k in knots)
        assert c.slopes == slopes

    @pytest.mark.parametrize("field", sorted(_FLD_SCALAR_EXPECTED))
    def test_fielding_scalars(self, field):
        assert getattr(DEFAULT_FIELDING_REG_COEFFS_27, field) == _FLD_SCALAR_EXPECTED[field]

    @pytest.mark.parametrize("field", _FLD_KEEP_26)
    def test_fielding_keeps_26_borrowed_fields(self, field):
        assert getattr(DEFAULT_FIELDING_REG_COEFFS_27, field) == getattr(
            FieldingRegressionCoeffs(), field
        )

    def test_baserunning_c0s_equal_26_canonical(self):
        h26, p26 = HittingRegressionCoeffs(), PitchingRegressionCoeffs()
        assert DEFAULT_HITTING_REG_COEFFS_27.sba.c0 == h26.sba.c0
        assert DEFAULT_HITTING_REG_COEFFS_27.sb_pct.c0 == h26.sb_pct.c0
        assert DEFAULT_HITTING_REG_COEFFS_27.ubr.c0 == h26.ubr.c0
        assert DEFAULT_PITCHING_REG_COEFFS_27.sba.c0 == p26.sba.c0
        assert DEFAULT_PITCHING_REG_COEFFS_27.rp_sba.c0 == p26.sba.c0
        assert DEFAULT_PITCHING_REG_COEFFS_27.sp_sb_pct.c0 == p26.sp_sb_pct.c0
        assert DEFAULT_PITCHING_REG_COEFFS_27.rp_sb_pct.c0 == p26.rp_sb_pct.c0

    def test_26_default_objects_untouched(self):
        """The 26 constant sets still construct with their original values (spot fields)."""
        h, p, f = HittingRegressionCoeffs(), PitchingRegressionCoeffs(), FieldingRegressionCoeffs()
        assert isinstance(h.eye, LinearCoeffs) and h.eye.h_slope == 0.0018699770558723264
        assert isinstance(p.rp_stu, LinearCoeffs) and p.rp_stu.l_const == 0.021514220537781122
        assert f.ss_pm_rng_slope == 0.004131565657882436
        assert f.c_frm_slope == 0.0005468042209251762
        assert p.rp_sba is None


# ---------------------------------------------------------------------------
# 4c. Synthetic 27 end-to-end (spec §9.3) — public pipeline vs by-hand piecewise arithmetic.
#     Every expected value below is EXPLICIT segment arithmetic (never piecewise_delta —
#     that would be circular).
# ---------------------------------------------------------------------------


def _elig_all(index):
    cols = ["C Elig", "1B Elig", "2B Elig", "3B Elig", "SS Elig",
            "LF Elig", "CF Elig", "RF Elig"]
    return pd.DataFrame({c: True for c in cols}, index=index)


class TestSynthetic27EndToEnd:
    @pytest.fixture()
    def dp27_hit(self):
        return dataclasses.replace(
            DEFAULT_HITTER_DP,
            hitting=DEFAULT_HITTING_REG_COEFFS_27,
            fielding_coeffs=DEFAULT_FIELDING_REG_COEFFS_27,
        )

    def test_hit_ubb_from_eye_piecewise(self, dp27_hit):
        """EYE 65 hitter: uBB vR = (piecewise eye delta + lg.bb_rate) * (pa − hbp)."""
        from src.ballparks import neutral_adjustments, neutral_park_deltas
        from src.hitters import compute_hitter_batting
        from tests.conftest import make_player

        p = make_player()
        for split in ("vR", "vL"):
            p[f"EYE {split}"] = 65.0
        out = compute_hitter_batting(p, neutral_park_deltas(), neutral_adjustments(),
                                     0.5, dp=dp27_hit)
        lg = dp27_hit.league
        # knots at avg_eye + (26,49,79 − 56.038); with avg_eye 49.82 the 49-knot lands at
        # 42.782 and the 79-knot at 72.782 — EYE 65 and the avg share segment 3 (0.00176).
        k2 = lg.avg_eye + (49.0 - 56.038)
        k3 = lg.avg_eye + (79.0 - 56.038)
        assert k2 < lg.avg_eye < 65.0 < k3        # segment layout sanity
        eye_delta = 0.00176 * (65.0 - lg.avg_eye)
        hbp = lg.hbp_rate * lg.pa
        want = (eye_delta + lg.bb_rate) * (lg.pa - hbp)
        assert out["uBB vR"].iloc[0] == pytest.approx(want, rel=1e-9)

    def test_hit_sb_pct_from_steal_piecewise(self, dp27_hit):
        from src.ballparks import neutral_adjustments, neutral_park_deltas
        from src.hitters import compute_hitter_batting
        from tests.conftest import make_player

        p = make_player(STE=80)
        out = compute_hitter_batting(p, neutral_park_deltas(), neutral_adjustments(),
                                     0.5, dp=dp27_hit)
        lg = dp27_hit.league
        # step form: avg_steal sits in the 36–72 segment (0.01014), STE 80 above the 72 knee
        assert 36.0 < lg.avg_steal < 72.0
        want = (-0.13320702812059265
                + 0.01014 * (72.0 - lg.avg_steal) + 0.00157 * (80.0 - 72.0)
                + lg.sb_pct)
        assert out["SB%"].iloc[0] == pytest.approx(want, abs=1e-12)

    def test_fielding_ss_pmaa_piecewise(self, dp27_hit):
        from src.hitters import compute_fielding
        from tests.conftest import make_player

        p = make_player(**{"IF RNG": 75, "IF ARM": 55})
        out = compute_fielding(p, _elig_all(p.index), dp=dp27_hit)
        fp = dp27_hit.fielding
        # range: knots 62/68 absolute; avg_rng_ss between them
        rng_delta = 0.00190 * (68.0 - fp.avg_rng_ss) + 0.00654 * (75.0 - 68.0)
        arm_delta = 0.00091 * (55.0 - fp.avg_arm_ss)
        want = (0.0 + rng_delta + arm_delta) * fp.ss_pa
        assert out["SS PMAA"].iloc[0] == pytest.approx(want, rel=1e-9)

    def test_pit_so_from_sp_stu_piecewise(self):
        from src.ballparks import neutral_adjustments
        from src.pitchers import compute_pitcher_batting

        base = {
            "B": "R", "T": "R", "POS": "SP",
            "STU vR": 60, "STU vL": 60,
            "PCON vR": 50, "PCON vL": 50,
            "HRR vR": 50, "HRR vL": 50,
            "PBABIP vR": 50, "PBABIP vL": 50,
            "STU P": 60, "PCON P": 50, "HRR P": 50, "PBABIP P": 50,
            "HLD": 50, "STM": 55, "STE": 50,
        }
        for pt in ["FB", "CH", "CB", "SL"]:
            base[pt] = 55
            base[pt + "P"] = 60
        for pt in ["SI", "SP", "CT", "FO", "CC", "SC", "KC", "KN"]:
            base[pt] = "-"
            base[pt + "P"] = "-"
        players = pd.DataFrame([base])

        dp27 = dataclasses.replace(DEFAULT_PITCHER_DP, pitching=DEFAULT_PITCHING_REG_COEFFS_27)
        out = compute_pitcher_batting(players, neutral_adjustments(), 0.5, dp=dp27)
        lp = dp27.league
        # SP-POS in the SP section: no adjustment. Knots at avg_stu_sp + (32,42,78 − 56.605):
        # both the avg and STU 60 sit in segment 3 (0.00339), below the elite 78-knee.
        k2 = lp.avg_stu_sp + (42.0 - 56.605)
        k3 = lp.avg_stu_sp + (78.0 - 56.605)
        stu_delta = 0.00339 * (60.0 - lp.avg_stu_sp)
        assert k2 < lp.avg_stu_sp < 60.0 < k3     # segment layout sanity
        hbp = out["HBP vR"].iloc[0]
        ubb = out["uBB vR"].iloc[0]
        want_so = (stu_delta + lp.sp_so_rate) * (lp.bf_sp - ubb - hbp)
        assert out["SO vR"].iloc[0] == pytest.approx(want_so, rel=1e-9)

    def test_pit_rp_sba_split_applied(self):
        """RP SBAT uses rp_sba (−0.00105), not the SP sba (−0.00148)."""
        from src.ballparks import neutral_adjustments
        from src.pitchers import compute_pitcher_batting

        base = {
            "B": "R", "T": "R", "POS": "CL",
            "STU vR": 55, "STU vL": 55,
            "PCON vR": 50, "PCON vL": 50,
            "HRR vR": 50, "HRR vL": 50,
            "PBABIP vR": 50, "PBABIP vL": 50,
            "STU P": 60, "PCON P": 50, "HRR P": 50, "PBABIP P": 50,
            "HLD": 70, "STM": 30, "STE": 50,
        }
        for pt in ["FB", "CH", "CB", "SL"]:
            base[pt] = 55
            base[pt + "P"] = 60
        for pt in ["SI", "SP", "CT", "FO", "CC", "SC", "KC", "KN"]:
            base[pt] = "-"
            base[pt + "P"] = "-"
        players = pd.DataFrame([base])

        dp27 = dataclasses.replace(DEFAULT_PITCHER_DP, pitching=DEFAULT_PITCHING_REG_COEFFS_27)
        out = compute_pitcher_batting(players, neutral_adjustments(), 0.5, dp=dp27)
        lp = dp27.league
        on_first = (out["1B vR RP"] + out["uBB vR RP"] + out["HBP vR RP"]).iloc[0]
        sba_rate = (0.0007224917422994285                       # 26 canonical c0
                    - 0.00105 * (70.0 - lp.avg_hld_rp)          # RP line, not −0.00148
                    + lp.rp_sba_rate)
        assert out["SBAT vR RP"].iloc[0] == pytest.approx(max(sba_rate * on_first, 0.0), rel=1e-9)


# ---------------------------------------------------------------------------
# 5. Version routing
# ---------------------------------------------------------------------------


class TestVersionRouting:
    def test_league_config_threads_version(self):
        from src.settings import LeagueConfig
        cfg = LeagueConfig(slug="x", league_name="X", ootp_version="27")
        assert cfg.to_pipeline_settings().ootp_version == "27"
        cfg26 = LeagueConfig(slug="y", league_name="Y", ootp_version="26")
        assert cfg26.to_pipeline_settings().ootp_version == "26"

    def test_detect_metadata_routes_27_to_constants(self, tmp_path):
        import shutil
        from pathlib import Path

        from src.export import _detect_metadata
        from src.metadata import MetadataVersionError
        from src.settings import PipelineSettings

        meta_dir = Path(__file__).resolve().parents[2] / "leagues" / "default" / "metadata"
        if not (meta_dir.is_dir() and any(meta_dir.glob("*.csv"))):
            pytest.skip(f"no metadata fixture at {meta_dir}")

        # C1: a 27 league may not consume unclassifiable (flat) or undeclared metadata — the
        # legacy call shape is now the canonical failure case.
        with pytest.raises(MetadataVersionError):
            _detect_metadata(
                meta_dir, PipelineSettings(ootp_version="27"), regressions_dir=None
            )

        # Version-valid fixture: the same CSVs classified into a post-boundary season dir.
        season_root = tmp_path / "metadata"
        season_dir = season_root / "2043"
        season_dir.mkdir(parents=True)
        for csv in meta_dir.glob("*.csv"):
            shutil.copy(csv, season_dir / csv.name)
        settings27 = PipelineSettings(
            ootp_version="27", engine_first_season={"27": 2043})

        hitter_dp, pitcher_dp = _detect_metadata(
            season_root, settings27, regressions_dir=None
        )
        # Hitting routes to the hardcoded 27 constants, MODULO the league-adaptive sba c0
        # (compose_data_points replaces sba.c0 with −E_w[pw(STE)] when the league has an STE
        # distribution — AUDIT_HITPIT_BR_27 §F1). Every other field must be the wired default.
        assert dataclasses.replace(
            hitter_dp.hitting, sba=DEFAULT_HITTING_REG_COEFFS_27.sba
        ) == DEFAULT_HITTING_REG_COEFFS_27
        assert dataclasses.replace(
            hitter_dp.hitting.sba, c0=DEFAULT_HITTING_REG_COEFFS_27.sba.c0
        ) == DEFAULT_HITTING_REG_COEFFS_27.sba
        assert pitcher_dp.pitching is DEFAULT_PITCHING_REG_COEFFS_27
        # Fielding routes to the 27 constants MODULO the C3 build-time centring, which
        # replaces the piecewise channels' *_const with −E_w[Σdelta] (FIELDING_PIPELINE_27).
        centred_consts = [
            "first_pm_const", "second_pm_const", "third_pm_const", "ss_pm_const",
            "lf_pm_const", "cf_pm_const", "rf_pm_const", "c_frm_const", "c_rto_const",
        ]
        fc = hitter_dp.fielding_coeffs
        assert dataclasses.replace(
            fc, **{k: getattr(DEFAULT_FIELDING_REG_COEFFS_27, k) for k in centred_consts}
        ) == DEFAULT_FIELDING_REG_COEFFS_27
        # The centring genuinely fired: the convex 2B ramp and the clamped corner-OF curves
        # must produce nonzero population-mean offsets from any realistic population.
        assert fc.second_pm_const != DEFAULT_FIELDING_REG_COEFFS_27.second_pm_const
        assert fc.lf_pm_const != DEFAULT_FIELDING_REG_COEFFS_27.lf_pm_const

        hitter_dp26, pitcher_dp26 = _detect_metadata(
            meta_dir, PipelineSettings(ootp_version="26"), regressions_dir=None
        )
        assert hitter_dp26.hitting is not DEFAULT_HITTING_REG_COEFFS_27
        assert pitcher_dp26.pitching is not DEFAULT_PITCHING_REG_COEFFS_27


# ---------------------------------------------------------------------------
# 6. League-adaptive sba c0 (AUDIT_HITPIT_BR_27 §F1 fix)
# ---------------------------------------------------------------------------


class TestLeagueAdaptiveSbaC0:
    """compose_data_points replaces the 27 hitter sba canonical c0 with −E_w[pw(STE)].

    Design (ratified 2026-07-02): E_w = the league's PA-weighted MLB-batter STE distribution
    (``HitterLeagueParams.ste_pa_dist``), computed at metadata/compose time; sb_pct keeps its
    canonical constant; the 26 path and the no-distribution 27 path are untouched.
    """

    @staticmethod
    def _league(dist, avg_steal=50.0):
        from src.data_points import HitterLeagueParams
        return HitterLeagueParams(avg_steal=avg_steal, ste_pa_dist=dist)

    @staticmethod
    def _compose(hitting, hitting_reg):
        from src.data_points import FieldingParams, PitcherLeagueParams
        from src.metadata import compose_data_points
        hdp, _pdp = compose_data_points(
            hitting, PitcherLeagueParams(), FieldingParams(),
            hitting_reg=hitting_reg,
            pitching_reg=DEFAULT_PITCHING_REG_COEFFS_27,
            fielding_reg=DEFAULT_FIELDING_REG_COEFFS_27,
        )
        return hdp

    def test_reproduces_pooled_league_rate_by_construction(self):
        """PA-weighted mean of (c0 + pw(STE) + lg.sba_rate) == lg.sba_rate on a synthetic league."""
        dist = [[25.0, 0.15], [40.0, 0.20], [50.0, 0.30], [65.0, 0.25], [80.0, 0.10]]
        lg = self._league(dist)
        hdp = self._compose(lg, DEFAULT_HITTING_REG_COEFFS_27)
        sba = hdp.hitting.sba
        assert isinstance(sba, PiecewiseCoeffs)
        e = sum(w * (sba.c0 + float(piecewise_delta(v, lg.avg_steal, sba)))
                for v, w in dist) / sum(w for _, w in dist)
        assert e == pytest.approx(0.0, abs=1e-15)  # ⇒ E_w[rate] == lg.sba_rate exactly

    def test_adaptive_c0_is_negative_for_convex_curve_with_spread(self):
        """Any realistic STE spread ⇒ Jensen gap ⇒ c0 < 0 (the F1 sign fix)."""
        dist = [[25.0, 0.15], [40.0, 0.20], [50.0, 0.30], [65.0, 0.25], [80.0, 0.10]]
        hdp = self._compose(self._league(dist), DEFAULT_HITTING_REG_COEFFS_27)
        assert hdp.hitting.sba.c0 < 0
        assert hdp.hitting.sba.c0 != DEFAULT_HITTING_REG_COEFFS_27.sba.c0

    def test_no_distribution_keeps_canonical_c0(self):
        hdp = self._compose(self._league(None), DEFAULT_HITTING_REG_COEFFS_27)
        assert hdp.hitting is DEFAULT_HITTING_REG_COEFFS_27
        assert hdp.hitting.sba.c0 == DEFAULT_HITTING_REG_COEFFS_27.sba.c0

    def test_only_sba_changes(self):
        """sb_pct/ubr and every non-sba field keep the wired defaults (sb_pct exclusion ratified)."""
        dist = [[40.0, 0.5], [60.0, 0.5]]
        hdp = self._compose(self._league(dist), DEFAULT_HITTING_REG_COEFFS_27)
        assert dataclasses.replace(
            hdp.hitting, sba=DEFAULT_HITTING_REG_COEFFS_27.sba
        ) == DEFAULT_HITTING_REG_COEFFS_27
        assert hdp.hitting.sb_pct is DEFAULT_HITTING_REG_COEFFS_27.sb_pct
        assert hdp.hitting.ubr is DEFAULT_HITTING_REG_COEFFS_27.ubr

    def test_26_path_untouched(self):
        """A 26 HittingRegressionCoeffs (CubicCoeffs sba) passes through by identity even when
        the league carries an STE distribution."""
        reg26 = HittingRegressionCoeffs()
        dist = [[40.0, 0.5], [60.0, 0.5]]
        hdp = self._compose(self._league(dist), reg26)
        assert hdp.hitting is reg26
        assert hdp.hitting.sba.c0 == reg26.sba.c0

    def test_degenerate_distribution_all_average_gives_zero_gap(self):
        """Everyone at the league-average STE ⇒ no Jensen gap ⇒ c0 == 0 (not the canonical)."""
        hdp = self._compose(self._league([[50.0, 1.0]]), DEFAULT_HITTING_REG_COEFFS_27)
        assert hdp.hitting.sba.c0 == pytest.approx(0.0, abs=1e-15)

    def test_season_blending_mixes_distributions(self):
        """_blend_params mixes per-season distributions as a season-weighted measure mixture."""
        from src.data_points import HitterLeagueParams
        from src.metadata import _blend_params
        a = HitterLeagueParams(ste_pa_dist=[[40.0, 1.0]])
        b = HitterLeagueParams(ste_pa_dist=[[60.0, 1.0]])
        blended = _blend_params([a, b], [3.0, 2.0])
        assert blended.ste_pa_dist == [[40.0, pytest.approx(0.6)], [60.0, pytest.approx(0.4)]]

    def test_season_blending_missing_distribution_yields_none(self):
        """Any season without a distribution ⇒ None (falls back to the canonical c0)."""
        from src.data_points import HitterLeagueParams
        from src.metadata import _blend_params
        a = HitterLeagueParams(ste_pa_dist=[[40.0, 1.0]])
        b = HitterLeagueParams(ste_pa_dist=None)
        assert _blend_params([a, b], [3.0, 2.0]).ste_pa_dist is None

    def test_aggregator_distribution_matches_avg_steal_on_clean_data(self):
        """On NaN-free inputs the distribution's mean equals avg_steal (same weighting)."""
        from src.aggregators.hit_aggregator import (
            _compute_rating_averages_hitting,
            _compute_ste_pa_distribution,
        )
        vr = pd.DataFrame({"PA": [400, 300, 200], "STE": [35.0, 50.0, 70.0]})
        vl = pd.DataFrame({"PA": [100, 150, 50], "STE": [35.0, 50.0, 70.0]})
        ovr_vr = 0.72
        dist = _compute_ste_pa_distribution(vr, vl, ovr_vr)
        assert sum(w for _, w in dist) == pytest.approx(1.0)
        got = sum(v * w for v, w in dist)
        vr_avg = (vr["PA"] * vr["STE"]).sum() / vr["PA"].sum()
        vl_avg = (vl["PA"] * vl["STE"]).sum() / vl["PA"].sum()
        assert got == pytest.approx(vr_avg * ovr_vr + vl_avg * (1 - ovr_vr))

    def test_aggregator_missing_ste_column_returns_none(self):
        from src.aggregators.hit_aggregator import _compute_ste_pa_distribution
        vr = pd.DataFrame({"PA": [400], "SPE": [50.0]})
        vl = pd.DataFrame({"PA": [100], "SPE": [50.0]})
        assert _compute_ste_pa_distribution(vr, vl, 0.72) is None

    def test_cache_roundtrip_preserves_distribution(self, tmp_path):
        """ste_pa_dist survives the metadata JSON cache (asdict → json → kwargs)."""
        import json as _json
        from src.data_points import HitterLeagueParams
        d = dataclasses.asdict(HitterLeagueParams(ste_pa_dist=[[40.0, 0.5], [60.0, 0.5]]))
        loaded = HitterLeagueParams(**_json.loads(_json.dumps(d)))
        assert loaded.ste_pa_dist == [[40.0, 0.5], [60.0, 0.5]]


# ---------------------------------------------------------------------------
# Phase-1 fielding pipeline (FIELDING_PIPELINE_27: C1 boundary, C2 gate,
# C3 centring, C4 response factors)
# ---------------------------------------------------------------------------


class TestFieldingPipeline27:
    def test_engine_boundary_filters_and_raises(self, tmp_path):
        from src.metadata import MetadataVersionError, _resolve_season_dirs

        for y in ("2041", "2042", "2043"):
            d = tmp_path / y
            d.mkdir()
            (d / "x.csv").write_text("a\n1\n")

        # 26 / legacy: unfiltered.
        r = _resolve_season_dirs(tmp_path, (3, 2, 1))
        assert [p.name for p, _ in r] == ["2043", "2042", "2041"]

        # 27 + boundary: pre-boundary seasons excluded.
        r = _resolve_season_dirs(
            tmp_path, (3, 2, 1), ootp_version="27", engine_first_season={"27": 2043})
        assert [(p.name, w) for p, w in r] == [("2043", 3.0)]

        # 27 without a declared boundary: loud error.
        with pytest.raises(MetadataVersionError, match="engineFirstSeason"):
            _resolve_season_dirs(tmp_path, (3, 2, 1), ootp_version="27")

        # 27 with only pre-boundary seasons: loud error, never a stale fallback.
        with pytest.raises(MetadataVersionError, match="pre-boundary"):
            _resolve_season_dirs(
                tmp_path, (3, 2, 1), ootp_version="27",
                engine_first_season={"27": 2099})

        # 27 with a flat (year-less) dir: loud error.
        flat = tmp_path / "flatcase"
        flat.mkdir()
        (flat / "x.csv").write_text("a\n1\n")
        with pytest.raises(MetadataVersionError, match="flat"):
            _resolve_season_dirs(
                flat, (3, 2, 1), ootp_version="27", engine_first_season={"27": 2043})

    def test_centring_zeroes_population_mean(self):
        """C3: const = −E_w[Σδ] makes the population-mean channel value exactly 0."""
        from src.data_points import FieldingParams
        from src.metadata import _with_centred_fielding_consts
        from src.utils import piecewise_delta

        # Synthetic IP-weighted population whose average lands at the 2B ramp BOTTOM (knot 60)
        # — the real-SSB geometry (avg ≈ 60.9). The offset's sign depends on where the average
        # sits relative to the ramp: at the bottom the curve is locally convex above the anchor
        # (above-average players ride the steep segment) → E_w[δ] > 0 → const < 0. A population
        # centred mid-ramp flips it. Only the zero-mean identity is population-invariant.
        dist = [[52.0, 150.0], [56.0, 200.0], [60.0, 300.0], [64.0, 200.0], [68.0, 150.0]]
        total = sum(w for _, w in dist)
        avg = sum(v * w for v, w in dist) / total
        fp = FieldingParams(avg_rng_2b=avg, rng_ip_dist_2b=dist)
        fc = _with_centred_fielding_consts(DEFAULT_FIELDING_REG_COEFFS_27, fp)

        coeffs = DEFAULT_FIELDING_REG_COEFFS_27.second_pm_rng_slope
        e_after = sum(
            w * (fc.second_pm_const + float(piecewise_delta(v, avg, coeffs)))
            for v, w in dist
        ) / total
        assert e_after == pytest.approx(0.0, abs=1e-12)
        # The convex ramp overpays above-average players → the offset must be negative.
        assert fc.second_pm_const < 0

        # Clamped corner-OF curve: population mean of delta is negative → offset positive.
        lf_dist = [[50.0, 100.0], [56.0, 300.0], [60.0, 300.0], [66.0, 200.0]]
        lf_avg = sum(v * w for v, w in lf_dist) / sum(w for _, w in lf_dist)
        fp_lf = FieldingParams(avg_rng_lf=lf_avg, rng_ip_dist_lf=lf_dist)
        fc_lf = _with_centred_fielding_consts(DEFAULT_FIELDING_REG_COEFFS_27, fp_lf)
        assert fc_lf.lf_pm_const > 0

        # Missing distribution: channel untouched (and warns) — never a silent wrong value.
        fp_none = FieldingParams()
        fc_none = _with_centred_fielding_consts(DEFAULT_FIELDING_REG_COEFFS_27, fp_none)
        assert fc_none.second_pm_const == DEFAULT_FIELDING_REG_COEFFS_27.second_pm_const

        # 26 dispatch: scalar slopes pass through byte-identical.
        from src.data_points import FieldingRegressionCoeffs
        fc26 = FieldingRegressionCoeffs()
        assert _with_centred_fielding_consts(fc26, fp) is fc26

    def test_response_factor_dispatch(self):
        """C4: 2B ×0.80 on the 27 path; all other positions 1.0; 26 path exactly 1.0."""
        from src.data_points import FIELDING_RESPONSE_FACTORS_27, FieldingRegressionCoeffs
        from src.hitters import _pm_response_factor

        fc27 = DEFAULT_FIELDING_REG_COEFFS_27
        assert _pm_response_factor(fc27, "2b") == pytest.approx(0.80)
        for pos in ("1b", "3b", "ss", "lf", "cf", "rf"):
            assert _pm_response_factor(fc27, pos) == 1.0
        fc26 = FieldingRegressionCoeffs()
        for pos in ("1b", "2b", "3b", "ss", "lf", "cf", "rf"):
            assert _pm_response_factor(fc26, pos) == 1.0
        # Governance invariant: factors live in data_points with provenance, all in (0, 1.5].
        for pos, f in FIELDING_RESPONSE_FACTORS_27.items():
            assert 0.0 < f <= 1.5

    def test_conversion_gate(self):
        """C2: anchors pass; wrong-era-scale drift raises; 26-era counts pass (C1's job)."""
        from src.data_points import FIELDING_DEPLOY_PA_ANCHORS_27, FieldingParams
        from src.metadata import MetadataVersionError, check_fielding_conversion_27

        anchors = FIELDING_DEPLOY_PA_ANCHORS_27
        ok = FieldingParams(
            first_pa=anchors["1b"], second_pa=anchors["2b"], third_pa=anchors["3b"],
            ss_pa=anchors["ss"], lf_pa=anchors["lf"], cf_pa=anchors["cf"],
            rf_pa=anchors["rf"])
        check_fielding_conversion_27(ok)  # must not raise

        bad = dataclasses.replace(ok, second_pa=anchors["2b"] * 1.35)
        with pytest.raises(MetadataVersionError, match="drifted"):
            check_fielding_conversion_27(bad)
