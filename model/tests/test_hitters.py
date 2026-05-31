"""Tests for src/hitters.py — parse_height_cm, eligibility, fielding, WAA."""

import numpy as np
import pandas as pd
import pytest

from src.ballparks import neutral_adjustments, neutral_park_deltas
from src.data_points import DEFAULT_HITTER_DP
from src.hitters import (
    compute_fielding,
    compute_hitter_batting,
    compute_position_eligibility,
    compute_waa,
    parse_height_cm,
)

from tests.conftest import HOME_FRACTION, make_player

dp = DEFAULT_HITTER_DP


# ---------------------------------------------------------------------------
# parse_height_cm
# ---------------------------------------------------------------------------


class TestParseHeightCm:
    """Test height string → cm conversion."""

    def test_standard_height(self):
        s = pd.Series(["6' 2'"])
        result = parse_height_cm(s)
        expected = 6 * 30.48 + 2 * 2.54  # 187.96
        assert result.iloc[0] == pytest.approx(expected)

    def test_short_player(self):
        s = pd.Series(["5' 7'"])
        result = parse_height_cm(s)
        expected = 5 * 30.48 + 7 * 2.54  # 170.18
        assert result.iloc[0] == pytest.approx(expected)

    def test_no_trailing_tick(self):
        """Format without trailing tick mark should still parse."""
        s = pd.Series(["6' 0"])
        result = parse_height_cm(s)
        expected = 6 * 30.48 + 0 * 2.54  # 182.88
        assert result.iloc[0] == pytest.approx(expected)

    def test_nan_input(self):
        s = pd.Series([np.nan])
        result = parse_height_cm(s)
        assert np.isnan(result.iloc[0])

    def test_mixed_series(self):
        s = pd.Series(["5' 10'", "6' 4'", "5' 8'"])
        result = parse_height_cm(s)
        assert len(result) == 3
        assert result.iloc[1] == pytest.approx(6 * 30.48 + 4 * 2.54)


# ---------------------------------------------------------------------------
# compute_position_eligibility — boundary tests
# ---------------------------------------------------------------------------


class TestPositionEligibility:
    """Boundary-value tests for each position's eligibility rules."""

    def test_catcher_frm_at_boundary(self):
        """C FRM=44 → ineligible, FRM=45 → eligible."""
        p44 = make_player(**{"C FRM": 44})
        p45 = make_player(**{"C FRM": 45})
        assert compute_position_eligibility(p44)["C Elig"].iloc[0] is np.bool_(False)
        assert compute_position_eligibility(p45)["C Elig"].iloc[0] is np.bool_(True)

    def test_first_base_strict_greater_179(self):
        """1B uses strict > 179cm, not >=.
        5'11' = 180.34 cm → eligible
        5'10' = 177.80 cm → ineligible
        """
        # 5'10.7' ≈ 179.58 cm (below 179? No, let's use exact boundary)
        # HT "5' 11'" = 180.34 cm > 179 → eligible
        p_tall = make_player(HT="5' 11'", **{"IF RNG": 25})
        # HT "5' 10'" = 177.80 cm < 179 → ineligible
        p_short = make_player(HT="5' 10'", **{"IF RNG": 25})
        assert compute_position_eligibility(p_tall)["1B Elig"].iloc[0] is np.bool_(True)
        assert compute_position_eligibility(p_short)["1B Elig"].iloc[0] is np.bool_(False)

    def test_first_base_needs_if_rng_above_20(self):
        """1B needs IF RNG > 20 (strict)."""
        p20 = make_player(HT="6' 2'", **{"IF RNG": 20})
        p21 = make_player(HT="6' 2'", **{"IF RNG": 21})
        assert compute_position_eligibility(p20)["1B Elig"].iloc[0] is np.bool_(False)
        assert compute_position_eligibility(p21)["1B Elig"].iloc[0] is np.bool_(True)

    def test_first_base_needs_if_err_above_20(self):
        """1B needs IF ERR > 20 (strict) — worst-hands guard added 2026-05-25."""
        p20 = make_player(HT="6' 2'", **{"IF RNG": 25, "IF ERR": 20})
        p21 = make_player(HT="6' 2'", **{"IF RNG": 25, "IF ERR": 21})
        assert compute_position_eligibility(p20)["1B Elig"].iloc[0] is np.bool_(False)
        assert compute_position_eligibility(p21)["1B Elig"].iloc[0] is np.bool_(True)

    def test_second_base_throws_r(self):
        """2B requires throws R."""
        p_r = make_player(T="R", **{"IF RNG": 50, "TDP": 45})
        p_l = make_player(T="L", **{"IF RNG": 50, "TDP": 45})
        assert compute_position_eligibility(p_r)["2B Elig"].iloc[0] is np.bool_(True)
        assert compute_position_eligibility(p_l)["2B Elig"].iloc[0] is np.bool_(False)

    def test_second_base_rng_boundary(self):
        """2B needs IF RNG >= 50."""
        p49 = make_player(**{"IF RNG": 49, "TDP": 45})
        p50 = make_player(**{"IF RNG": 50, "TDP": 45})
        assert compute_position_eligibility(p49)["2B Elig"].iloc[0] is np.bool_(False)
        assert compute_position_eligibility(p50)["2B Elig"].iloc[0] is np.bool_(True)

    def test_second_base_tdp_boundary(self):
        """2B needs TDP >= 45."""
        p44 = make_player(**{"IF RNG": 50, "TDP": 44})
        p45 = make_player(**{"IF RNG": 50, "TDP": 45})
        assert compute_position_eligibility(p44)["2B Elig"].iloc[0] is np.bool_(False)
        assert compute_position_eligibility(p45)["2B Elig"].iloc[0] is np.bool_(True)

    def test_third_base_arm_boundary(self):
        """3B needs IF ARM >= 50."""
        p49 = make_player(**{"IF RNG": 40, "IF ARM": 49})
        p50 = make_player(**{"IF RNG": 40, "IF ARM": 50})
        assert compute_position_eligibility(p49)["3B Elig"].iloc[0] is np.bool_(False)
        assert compute_position_eligibility(p50)["3B Elig"].iloc[0] is np.bool_(True)

    def test_shortstop_rng_boundary(self):
        """SS needs IF RNG >= 60."""
        p59 = make_player(**{"IF RNG": 59, "IF ARM": 50})
        p60 = make_player(**{"IF RNG": 60, "IF ARM": 50})
        assert compute_position_eligibility(p59)["SS Elig"].iloc[0] is np.bool_(False)
        assert compute_position_eligibility(p60)["SS Elig"].iloc[0] is np.bool_(True)

    def test_shortstop_tdp_boundary(self):
        """SS needs TDP >= 45 — matched to 2B's turn-DP floor 2026-05-25."""
        p44 = make_player(**{"IF RNG": 60, "IF ARM": 50, "TDP": 44})
        p45 = make_player(**{"IF RNG": 60, "IF ARM": 50, "TDP": 45})
        assert compute_position_eligibility(p44)["SS Elig"].iloc[0] is np.bool_(False)
        assert compute_position_eligibility(p45)["SS Elig"].iloc[0] is np.bool_(True)

    def test_cf_rng_boundary(self):
        """CF needs OF RNG >= 60."""
        p59 = make_player(**{"OF RNG": 59})
        p60 = make_player(**{"OF RNG": 60})
        assert compute_position_eligibility(p59)["CF Elig"].iloc[0] is np.bool_(False)
        assert compute_position_eligibility(p60)["CF Elig"].iloc[0] is np.bool_(True)

    def test_lf_rf_rng_boundary(self):
        """LF/RF need OF RNG >= 45 (lowered from 50 on 2026-05-25)."""
        p44 = make_player(**{"OF RNG": 44})
        p45 = make_player(**{"OF RNG": 45})
        e44 = compute_position_eligibility(p44)
        e45 = compute_position_eligibility(p45)
        assert e44["LF Elig"].iloc[0] is np.bool_(False)
        assert e45["LF Elig"].iloc[0] is np.bool_(True)
        assert e44["RF Elig"].iloc[0] is np.bool_(False)
        assert e45["RF Elig"].iloc[0] is np.bool_(True)

    def test_dh_always_eligible(self):
        """DH should always be True regardless of ratings."""
        p = make_player(**{"C FRM": 10, "IF RNG": 10, "OF RNG": 10})
        assert compute_position_eligibility(p)["DH Elig"].iloc[0] is np.bool_(True)


# ---------------------------------------------------------------------------
# compute_fielding — spot checks
# ---------------------------------------------------------------------------


class TestFielding:
    """Spot-check fielding computations for key positions."""

    def test_catcher_arm_affects_sba(self):
        """Higher C ARM should lower SBA (fewer stolen bases allowed).

        Verify both direction AND approximate value from the regression formula:
        SBA = (c_sba_const + c_sba_slope * (ARM - avg_arm)) * ip_c + c_sba_scale
        """
        fc = dp.fielding_coeffs
        fp = dp.fielding
        lg = dp.league

        p_low = make_player(**{"C FRM": 60, "C ARM": 30})
        p_high = make_player(**{"C FRM": 60, "C ARM": 80})
        e_low = compute_position_eligibility(p_low)
        e_high = compute_position_eligibility(p_high)
        f_low = compute_fielding(p_low, e_low)
        f_high = compute_fielding(p_high, e_high)

        # Direction: higher ARM → lower SBA (negative slope)
        assert f_high["C SBA"].iloc[0] < f_low["C SBA"].iloc[0]

        # Value check: independently compute expected SBA for ARM=80
        expected_sba_high = (
            (fc.c_sba_const + fc.c_sba_slope * (80 - fp.avg_arm_c)) * lg.ip_c
            + fp.c_sba_scale
        )
        assert f_high["C SBA"].iloc[0] == pytest.approx(expected_sba_high, rel=1e-10)

    def test_first_base_height_affects_pmaa(self):
        """Taller 1B player should have higher PMAA (positive height slope).

        Verify direction AND approximate value from the 2-variable regression:
        PMAA = (const + rng_slope*(RNG-avg) + ht_slope*(HT-avg)) * first_pa
        """
        fc = dp.fielding_coeffs
        fp = dp.fielding

        p_tall = make_player(HT="6' 5'", **{"IF RNG": 50})
        p_short = make_player(HT="6' 0'", **{"IF RNG": 50})
        e_tall = compute_position_eligibility(p_tall)
        e_short = compute_position_eligibility(p_short)
        f_tall = compute_fielding(p_tall, e_tall)
        f_short = compute_fielding(p_short, e_short)

        # Direction: taller → higher PMAA (positive ht_slope)
        assert f_tall["1B PMAA"].iloc[0] > f_short["1B PMAA"].iloc[0]

        # Value check: independently compute expected PMAA for 6'5" (195.58 cm)
        ht_cm_tall = 6 * 30.48 + 5 * 2.54  # 195.58
        expected_pmaa = (
            fc.first_pm_const
            + fc.first_pm_rng_slope * (50 - fp.avg_rng_1b)
            + fc.first_pm_ht_slope * (ht_cm_tall - fp.avg_ht_1b)
        ) * fp.first_pa
        assert f_tall["1B PMAA"].iloc[0] == pytest.approx(expected_pmaa, rel=1e-10)

    def test_of_arm_affects_armaa(self):
        """Higher OF ARM should increase ARMAA for outfielders.

        Verify direction AND approximate value from the regression formula:
        ARMAA = (arm_const + arm_slope * (OF_ARM - avg_arm)) * pa_scale
        """
        fc = dp.fielding_coeffs
        fp = dp.fielding

        p_low = make_player(**{"OF RNG": 60, "OF ARM": 30})
        p_high = make_player(**{"OF RNG": 60, "OF ARM": 70})
        e_low = compute_position_eligibility(p_low)
        e_high = compute_position_eligibility(p_high)
        f_low = compute_fielding(p_low, e_low)
        f_high = compute_fielding(p_high, e_high)

        # Direction: higher ARM → higher ARMAA (positive slope)
        assert f_high["CF ARMAA"].iloc[0] > f_low["CF ARMAA"].iloc[0]

        # Value check: independently compute expected CF ARMAA for ARM=70
        expected_armaa = (
            fc.cf_arm_const + fc.cf_arm_slope * (70 - fp.avg_arm_cf)
        ) * fp.cf_pa
        assert f_high["CF ARMAA"].iloc[0] == pytest.approx(expected_armaa, rel=1e-10)

    def test_ineligible_position_is_nan(self):
        """Ineligible positions should have NaN fielding stats."""
        p = make_player(**{"C FRM": 20})  # Not C-eligible
        elig = compute_position_eligibility(p)
        field = compute_fielding(p, elig)
        assert np.isnan(field["C FRMAA"].iloc[0])
        assert np.isnan(field["C SBA"].iloc[0])

    def test_eligible_positions_are_numeric(self):
        """Eligible positions should have non-NaN fielding stats and reasonable values."""
        fc = dp.fielding_coeffs
        fp = dp.fielding
        lg = dp.league

        # This player is LF/RF eligible (OF RNG=65 >= 50)
        p = make_player(**{"OF RNG": 65})
        elig = compute_position_eligibility(p)
        field = compute_fielding(p, elig)
        assert not np.isnan(field["LF PMAA"].iloc[0])
        assert not np.isnan(field["LF RunsP"].iloc[0])

        # Value check: verify LF PMAA matches regression formula
        expected_pmaa = (
            fc.lf_pm_const + fc.lf_pm_slope * (65 - fp.avg_rng_lf)
        ) * fp.lf_pa
        assert field["LF PMAA"].iloc[0] == pytest.approx(expected_pmaa, rel=1e-10)

        # RunsP should be in a reasonable range for a 1200-IP season
        assert -20 < field["LF RunsP"].iloc[0] < 20


# ---------------------------------------------------------------------------
# compute_waa — special paths
# ---------------------------------------------------------------------------


class TestWAA:
    """Test WAA computation special cases: catcher, DH, max WAA."""

    @pytest.fixture()
    def neutral_env(self):
        """Neutral park environment for isolated WAA testing."""
        return neutral_park_deltas(), neutral_adjustments()

    def _run_pipeline(self, player, neutral_env):
        """Run full hitter pipeline through WAA."""
        deltas, adj = neutral_env
        batting = compute_hitter_batting(player, deltas, adj, HOME_FRACTION)
        elig = compute_position_eligibility(player)
        field = compute_fielding(player, elig)
        waa = compute_waa(batting, field, elig, deltas, HOME_FRACTION)
        return waa, elig

    def test_catcher_pa_500_reduces_batr(self):
        """Catcher BatR uses PA=500 (not 600), so C BatR is 5/6 of standard.

        For a player eligible at both C and LF with identical fielding,
        the reduced BatR at catcher should produce a meaningfully different WAA.
        """
        lg = dp.league
        p = make_player(**{"C FRM": 60, "OF RNG": 65})
        env = (neutral_park_deltas(), neutral_adjustments())
        waa, elig = self._run_pipeline(p, env)

        c_waa = waa["C WAA wtd"].iloc[0]
        lf_waa = waa["LF WAA wtd"].iloc[0]

        # Both should be numeric
        assert not np.isnan(c_waa)
        assert not np.isnan(lf_waa)

        # The difference should reflect: pos adj gap, BatR reduction (5/6),
        # and different fielding RunsP. Catcher has positive pos_adj (+12.84)
        # while LF has negative (-7.16), so catcher WAA is typically higher
        # despite the PA reduction. Key: they should NOT be equal.
        assert c_waa != pytest.approx(lf_waa, abs=0.01), (
            "C WAA and LF WAA should differ due to PA=500 BatR reduction"
        )

    def test_dh_bsr_discounted(self):
        """DH WAA applies 0.98 discount to BSR.

        Verify DH uses discounted BSR by comparing vR splits between DH and a
        field position. The DH formula is:
        DH WAA = (BSR * 0.98 + DH_BatR + pos_dh) / waa_const
        """
        lg = dp.league
        fp = dp.fielding

        # High STE player to get visible BSR
        p = make_player(STE=80, **{"OF RNG": 65})
        deltas = neutral_park_deltas()
        adj = neutral_adjustments()
        batting = compute_hitter_batting(p, deltas, adj, HOME_FRACTION)
        elig = compute_position_eligibility(p)
        field = compute_fielding(p, elig)
        waa = compute_waa(batting, field, elig, deltas, HOME_FRACTION)

        dh_waa_vr = waa["DH WAA vR"].iloc[0]
        assert not np.isnan(dh_waa_vr)

        # Independently verify DH WAA vR from batting components
        bsr_vr = batting["BSR vR"].iloc[0]
        dh_batr_vr = batting["DH BatR vR"].iloc[0]
        expected_dh_waa_vr = (bsr_vr * 0.98 + dh_batr_vr + fp.pos_dh) / lg.waa_const
        assert dh_waa_vr == pytest.approx(expected_dh_waa_vr, rel=1e-10)

    def test_max_waa_picks_highest(self):
        """Max WAA should be the highest WAA among eligible positions."""
        p = make_player(**{"C FRM": 60, "OF RNG": 65, "IF RNG": 50})
        deltas = neutral_park_deltas()
        adj = neutral_adjustments()
        batting = compute_hitter_batting(p, deltas, adj, HOME_FRACTION)
        elig = compute_position_eligibility(p)
        field = compute_fielding(p, elig)
        waa = compute_waa(batting, field, elig, deltas, HOME_FRACTION)

        max_waa = waa["Max WAA wtd"].iloc[0]
        # Check max is >= all eligible position WAAs
        for col in waa.columns:
            if col.endswith(" WAA wtd") and col != "Max WAA wtd":
                val = waa[col].iloc[0]
                if not np.isnan(val):
                    assert max_waa >= val - 1e-10

    def test_ineligible_position_waa_is_nan(self):
        """WAA for ineligible positions should be NaN."""
        p = make_player(**{"C FRM": 20})  # Not C eligible
        deltas = neutral_park_deltas()
        adj = neutral_adjustments()
        batting = compute_hitter_batting(p, deltas, adj, HOME_FRACTION)
        elig = compute_position_eligibility(p)
        field = compute_fielding(p, elig)
        waa = compute_waa(batting, field, elig, deltas, HOME_FRACTION)
        assert np.isnan(waa["C WAA wtd"].iloc[0])

    def test_dh_always_has_waa(self):
        """DH WAA should always be present (DH always eligible).

        Even a player ineligible at every field position gets DH WAA.
        Since DH has no fielding component but carries a large negative pos
        adjustment (-8.34), DH WAA for an average player should be negative.
        """
        fp = dp.fielding

        p = make_player(**{"C FRM": 10, "IF RNG": 10, "OF RNG": 10})
        deltas = neutral_park_deltas()
        adj = neutral_adjustments()
        batting = compute_hitter_batting(p, deltas, adj, HOME_FRACTION)
        elig = compute_position_eligibility(p)
        field = compute_fielding(p, elig)
        waa = compute_waa(batting, field, elig, deltas, HOME_FRACTION)

        dh_waa = waa["DH WAA wtd"].iloc[0]
        assert not np.isnan(dh_waa)

        # With average ratings (all 50) at neutral park, DH WAA should be
        # negative because pos_dh = -8.34 dominates the small batting value
        assert dh_waa < 0, f"DH WAA ({dh_waa:.3f}) should be negative for average player"

        # DH WAA should be the max (and only non-NaN) WAA since all field
        # positions are ineligible
        assert waa["Max WAA wtd"].iloc[0] == pytest.approx(dh_waa, rel=1e-10)


# ---------------------------------------------------------------------------
# compute_waa — WAR columns (FG-standard replacement-runs adjustment)
# ---------------------------------------------------------------------------


class TestWAR:
    """Test WAR columns: replacement scaling, position differences, Max WAR."""

    def _run_pipeline(self, player):
        deltas = neutral_park_deltas()
        adj = neutral_adjustments()
        batting = compute_hitter_batting(player, deltas, adj, HOME_FRACTION)
        elig = compute_position_eligibility(player)
        field = compute_fielding(player, elig)
        waa = compute_waa(batting, field, elig, deltas, HOME_FRACTION)
        return waa, elig

    def test_war_minus_waa_is_repl_credit(self):
        """For any eligible non-C position, WAR − WAA equals the fixed
        replacement credit (repl_runs_per_pa * pa / waa_const ≈ 1.9856).
        """
        lg = dp.league
        expected_credit = lg.repl_runs_per_pa * lg.pa / lg.waa_const

        p = make_player(**{"OF RNG": 65})
        waa, _ = self._run_pipeline(p)

        for pos in ["LF", "CF", "RF", "DH"]:
            wtd_waa = waa[f"{pos} WAA wtd"].iloc[0]
            wtd_war = waa[f"{pos} WAR wtd"].iloc[0]
            if np.isnan(wtd_waa):
                continue
            assert wtd_war - wtd_waa == pytest.approx(expected_credit, rel=1e-10), (
                f"{pos}: WAR − WAA should be {expected_credit:.6f}, got {wtd_war - wtd_waa:.6f}"
            )

    def test_catcher_war_credit_smaller_than_other_positions(self):
        """Catcher WAR − WAA uses pa_c=500, smaller than non-C credit (which uses pa=600)."""
        lg = dp.league
        c_credit = lg.repl_runs_per_pa * lg.pa_c / lg.waa_const
        non_c_credit = lg.repl_runs_per_pa * lg.pa / lg.waa_const

        # Sanity: catcher gets ~5/6 of non-C credit
        assert c_credit < non_c_credit
        assert c_credit == pytest.approx(non_c_credit * (500 / 600), rel=1e-10)

        p = make_player(**{"C FRM": 60, "OF RNG": 65})
        waa, _ = self._run_pipeline(p)

        c_diff = waa["C WAR wtd"].iloc[0] - waa["C WAA wtd"].iloc[0]
        lf_diff = waa["LF WAR wtd"].iloc[0] - waa["LF WAA wtd"].iloc[0]

        assert c_diff == pytest.approx(c_credit, rel=1e-10)
        assert lf_diff == pytest.approx(non_c_credit, rel=1e-10)
        assert c_diff < lf_diff

    def test_max_war_picks_highest(self):
        """Max WAR should be >= every eligible position's WAR."""
        p = make_player(**{"C FRM": 60, "OF RNG": 65, "IF RNG": 50})
        waa, _ = self._run_pipeline(p)

        max_war = waa["Max WAR wtd"].iloc[0]
        for col in waa.columns:
            if col.endswith(" WAR wtd") and col != "Max WAR wtd":
                val = waa[col].iloc[0]
                if not np.isnan(val):
                    assert max_war >= val - 1e-10

    def test_ineligible_position_war_is_nan(self):
        """WAR for ineligible positions should be NaN (same as WAA)."""
        p = make_player(**{"C FRM": 20})
        waa, _ = self._run_pipeline(p)
        assert np.isnan(waa["C WAR wtd"].iloc[0])

    def test_dh_war_for_avg_player_is_positive_around_one(self):
        """An average player at DH has WAR ≈ +1.16 (= −0.82 WAA + 1.99 repl credit).

        Sanity check that the replacement adjustment lifts the DH for an
        average player out of the negative.
        """
        p = make_player(**{"C FRM": 10, "IF RNG": 10, "OF RNG": 10})
        waa, _ = self._run_pipeline(p)

        dh_waa = waa["DH WAA wtd"].iloc[0]
        dh_war = waa["DH WAR wtd"].iloc[0]
        lg = dp.league
        expected_credit = lg.repl_runs_per_pa * lg.pa / lg.waa_const

        assert dh_waa < 0  # WAA negative for average DH (pos_dh penalty dominates)
        assert dh_war == pytest.approx(dh_waa + expected_credit, rel=1e-10)
        assert dh_war > 0, f"Average DH should clear replacement (got {dh_war:.3f})"
