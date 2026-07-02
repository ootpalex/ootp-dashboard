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
        abs_knots = tuple(k + _CALIB_AVG_27["eye"] for k in c.knots)
        assert abs_knots == pytest.approx((40.0, 67.0, 79.0))
        assert c.slopes == (0.00271, 0.00225, 0.00150, 0.00313)

    def test_speed_matches_knot_decisions(self):
        c = DEFAULT_HITTING_REG_COEFFS_27.speed
        assert isinstance(c, PiecewiseCoeffs) and not c.relative and c.clamp_lo
        assert c.knots == (34.0, 50.0)
        assert c.slopes == (0.0, 0.00314, 0.00280)

    def test_sb_pct_carries_canonical_c0(self):
        c = DEFAULT_HITTING_REG_COEFFS_27.sb_pct
        assert isinstance(c, PiecewiseCoeffs) and not c.relative
        assert c.knots == (70.0,) and c.slopes == (0.01045, 0.00255)
        assert c.c0 == HittingRegressionCoeffs().sb_pct.c0   # 26 canonical intercept

    def test_rp_stu_matches_knot_decisions(self):
        c = DEFAULT_PITCHING_REG_COEFFS_27.rp_stu
        assert isinstance(c, PiecewiseCoeffs) and c.relative
        abs_knots = tuple(k + _CALIB_AVG_27["rp_stu"] for k in c.knots)
        assert abs_knots == pytest.approx((33.0, 75.0))
        assert c.slopes == (0.00846, 0.00389, 0.00649)

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
        # League avg EYE 52.0 → knots at 52 + (40−55.447, 67−55.447, 79−55.447)
        #                              = (36.553, 63.553, 75.553).
        c = DEFAULT_HITTING_REG_COEFFS_27.eye
        avg = 52.0
        # rating 60 (mid segment 2): delta = 0.00225 * (60 − 52) = 0.018
        got = rating_to_delta(pd.Series([60.0]), avg, c).iloc[0]
        assert got == pytest.approx(0.00225 * 8.0, abs=1e-12)
        # rating 30 (below all knots): −[0.00271*(36.553−30) + 0.00225*(52−36.553)]
        got = rating_to_delta(pd.Series([30.0]), avg, c).iloc[0]
        want = -(0.00271 * (36.553 - 30.0) + 0.00225 * (52.0 - 36.553))
        assert got == pytest.approx(want, abs=1e-9)
        # rating 80 (above all knots): 0.00225*(63.553−52) + 0.00150*(75.553−63.553) + 0.00313*(80−75.553)
        got = rating_to_delta(pd.Series([80.0]), avg, c).iloc[0]
        want = (0.00225 * (63.553 - 52.0) + 0.00150 * (75.553 - 63.553)
                + 0.00313 * (80.0 - 75.553))
        assert got == pytest.approx(want, abs=1e-9)

    def test_speed_absolute_floor(self):
        # SPE floor: below 34 the curve is flat — a 20 and a 34 both sit
        # −[0.00314*(50−34) + 0.00280*(avg−50)] below a league-average 55.0 runner... computed:
        c = DEFAULT_HITTING_REG_COEFFS_27.speed
        avg = 47.61   # 26-default league avg speed; knots are ABSOLUTE (34, 50)
        d20 = rating_to_delta(pd.Series([20.0]), avg, c).iloc[0]
        d34 = rating_to_delta(pd.Series([34.0]), avg, c).iloc[0]
        assert d20 == d34                                  # clamp floor
        assert d34 == pytest.approx(-(0.00314 * (47.61 - 34.0)), abs=1e-9)
        # above the 50 knee: delta(60) = 0.00314*(50−47.61) + 0.00280*(60−50)
        d60 = rating_to_delta(pd.Series([60.0]), avg, c).iloc[0]
        assert d60 == pytest.approx(0.00314 * (50.0 - 47.61) + 0.00280 * 10.0, abs=1e-9)

    def test_sb_pct_poly_with_c0(self):
        c = DEFAULT_HITTING_REG_COEFFS_27.sb_pct
        avg = 50.46
        # STE 80 (above the 70 knee): c0 + 0.01045*(70−50.46) + 0.00255*(80−70)
        got = baserunning_poly(pd.Series([80.0]), avg, c).iloc[0]
        want = c.c0 + 0.01045 * (70.0 - 50.46) + 0.00255 * 10.0
        assert got == pytest.approx(want, abs=1e-9)

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
        # Knots at avg + (33−56.905, 75−56.905) = (31.095, 73.095).
        # CL @ 60 (mid segment): 0.00389 * (60 − 55)
        got = _stu_delta_rp(pd.Series([60.0]), avg, c, pd.Series(["CL"])).iloc[0]
        assert got == pytest.approx(0.00389 * 5.0, abs=1e-9)
        # SP POS @ 60 → adjusted 65: 0.00389 * (65 − 55)
        got = _stu_delta_rp(pd.Series([60.0]), avg, c, pd.Series(["SP"])).iloc[0]
        assert got == pytest.approx(0.00389 * 10.0, abs=1e-9)


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
# 5. Version routing
# ---------------------------------------------------------------------------


class TestVersionRouting:
    def test_league_config_threads_version(self):
        from src.settings import LeagueConfig
        cfg = LeagueConfig(slug="x", league_name="X", ootp_version="27")
        assert cfg.to_pipeline_settings().ootp_version == "27"
        cfg26 = LeagueConfig(slug="y", league_name="Y", ootp_version="26")
        assert cfg26.to_pipeline_settings().ootp_version == "26"

    def test_detect_metadata_routes_27_to_constants(self):
        from pathlib import Path

        from src.export import _detect_metadata
        from src.settings import PipelineSettings

        meta_dir = Path(__file__).resolve().parents[2] / "leagues" / "default" / "metadata"
        if not (meta_dir.is_dir() and any(meta_dir.glob("*.csv"))):
            pytest.skip(f"no metadata fixture at {meta_dir}")

        hitter_dp, pitcher_dp = _detect_metadata(
            meta_dir, PipelineSettings(ootp_version="27"), regressions_dir=None
        )
        assert hitter_dp.hitting is DEFAULT_HITTING_REG_COEFFS_27
        assert pitcher_dp.pitching is DEFAULT_PITCHING_REG_COEFFS_27
        assert hitter_dp.fielding_coeffs is DEFAULT_FIELDING_REG_COEFFS_27

        hitter_dp26, pitcher_dp26 = _detect_metadata(
            meta_dir, PipelineSettings(ootp_version="26"), regressions_dir=None
        )
        assert hitter_dp26.hitting is not DEFAULT_HITTING_REG_COEFFS_27
        assert pitcher_dp26.pitching is not DEFAULT_PITCHING_REG_COEFFS_27
