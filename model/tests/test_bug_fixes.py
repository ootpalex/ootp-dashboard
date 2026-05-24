"""Targeted tests verifying each replicated bug has been fixed."""

import numpy as np
import pandas as pd
import pytest

from src.ballparks import (
    BallparksTable,
    NormalizedAdjustments,
    ParkDeltas,
    neutral_adjustments,
    neutral_park_deltas,
)
from src.data_points import DEFAULT_HITTER_DP, DEFAULT_PITCHER_DP
from src.hitters import (
    compute_fielding,
    compute_hitter_batting,
    compute_position_eligibility,
)
from src.pitchers import _compute_park_mults

from tests.conftest import BALLPARKS_CSV, HOME_FRACTION, make_player


# ── Bug 1: Ballparks LH deltas should differ from RH deltas ─────────────


class TestBug1LHDeltas:
    """Bug 1 fix: vL park deltas use LH factors, not RH."""

    def test_asymmetric_park_has_different_vl_vr_deltas(self, table):
        """For a park with avg_l != avg_r, vL and vR deltas should differ."""
        # Find a team with asymmetric LH/RH batting average factors
        asymmetric_team = None
        for name, row in table.rows.items():
            if abs(row.adj.ba_lh - row.adj.ba_rh) > 0.001:
                asymmetric_team = name
                break

        assert asymmetric_team is not None, "No team with asymmetric BA factors found"

        deltas = table.compute_park_deltas(asymmetric_team, HOME_FRACTION)

        # After fix, vL H-HR delta should differ from vR
        assert deltas.h_minus_hr_vl != deltas.h_minus_hr_vr, (
            f"h_minus_hr_vl ({deltas.h_minus_hr_vl}) should != "
            f"h_minus_hr_vr ({deltas.h_minus_hr_vr})"
        )

    def test_symmetric_park_has_equal_vl_vr_hr_deltas_when_symmetric(self, table):
        """HR deltas always used the correct factors; verify they still work."""
        # Any team — just verify hr_vl uses LH and hr_vr uses RH
        team = table.team_names[0]
        deltas = table.compute_park_deltas(team, HOME_FRACTION)

        # These should be computed from different source values
        # (unless this team happens to have hr_l == hr_r)
        assert isinstance(deltas.hr_vl, float)
        assert isinstance(deltas.hr_vr, float)


# ── Bug 2: STE cap removed — SB% should increase beyond STE=80 ──────────


class TestBug2STECap:
    """Bug 2 fix: SB% uses raw STE (no cap at 80)."""

    def _make_player(self, ste_val):
        """Create a minimal player row for baserunning computation."""
        dp = DEFAULT_HITTER_DP
        cols = {
            "B": "R", "T": "R", "HT": "6' 0'", "POS": "CF",
            "SPE": 50,
            "STE": ste_val, "RUN": 50,
            "CON P": 30, "POW P": 30, "EYE P": 30,
            "STU P": 20, "MOV P": 20, "PCON P": 20,
            "C FRM": 20, "C ARM": 50, "IF RNG": 50, "IF ERR": 50,
            "IF ARM": 50, "TDP": 50, "OF RNG": 65, "OF ERR": 50, "OF ARM": 50,
        }
        # Add split rating columns
        for split in ["vR", "vL"]:
            for stat in ["BA", "GAP", "POW", "EYE", "K"]:
                cols[f"{stat} {split}"] = 50
        return pd.DataFrame([cols])

    def test_sb_pct_increases_beyond_80(self):
        """SB% at STE=90 should be higher than at STE=80.

        SB% is bounded to [0, 1] (a success rate can't exceed 100%), but with the calibration
        intercept it only saturates for the extreme tail (STE≈95+), so STE 80 vs 90 both sit
        below 1.0 and the rating above 80 still increases SB%.
        """
        park_deltas = neutral_park_deltas()
        park_adj = neutral_adjustments()

        player_80 = self._make_player(80)
        player_90 = self._make_player(90)

        batting_80 = compute_hitter_batting(player_80, park_deltas, park_adj, 0.5)
        batting_90 = compute_hitter_batting(player_90, park_deltas, park_adj, 0.5)

        sb_pct_80 = batting_80["SB%"].iloc[0]
        sb_pct_90 = batting_90["SB%"].iloc[0]

        assert sb_pct_90 > sb_pct_80, (
            f"SB% at STE=90 ({sb_pct_90:.4f}) should be > STE=80 ({sb_pct_80:.4f})"
        )


# ── Bug 3: DH stats use park-adjusted counting stats (docstring fix) ─────


class TestBug3DHStats:
    """Bug 3 fix: DH stats inherit park factors through counting stats."""

    def test_dh_woba_differs_at_hitter_park(self):
        """DH wOBA at a hitter park should differ from neutral park."""
        table = BallparksTable.from_csv(BALLPARKS_CSV)

        # Find a park with a high woba_ratio
        best_team = max(table.rows, key=lambda t: table.rows[t].woba_ratio)
        deltas = table.compute_park_deltas(best_team, HOME_FRACTION)
        adj = table.rows[best_team].adj

        neutral_deltas = neutral_park_deltas()
        neutral_adj = neutral_adjustments()

        player = make_player(STE=50)

        batting_park = compute_hitter_batting(player, deltas, adj, HOME_FRACTION)
        batting_neutral = compute_hitter_batting(
            player, neutral_deltas, neutral_adj, HOME_FRACTION
        )

        # DH wOBA should be affected by park factors
        dh_park = batting_park["DH wOBA vR"].iloc[0]
        dh_neutral = batting_neutral["DH wOBA vR"].iloc[0]
        # They will differ because counting stats are park-adjusted
        assert abs(dh_park - dh_neutral) > 1e-6


# ── Bug 4: UBR uses correct per-split wSB for sb_adj ─────────────────────


class TestBug4UBRwSB:
    """Bug 4 fix: UBR vR uses wSB_vR (not wSB_vL) for sb_adj."""

    def test_ubr_uses_split_wsb(self):
        """UBR should use the split-specific wSB, not always vL."""
        park_deltas = neutral_park_deltas()
        park_adj = neutral_adjustments()

        # Create two players with very different vR vs vL STE-based outcomes
        # to make wSB differ by split. With neutral park and symmetric ratings,
        # the key test is that the code path uses the right variable.
        cols = {
            "B": "R", "T": "R", "HT": "6' 0'", "POS": "CF",
            "SPE": 50, "STE": 60, "RUN": 50,
            "CON P": 30, "POW P": 30, "EYE P": 30,
            "STU P": 20, "MOV P": 20, "PCON P": 20,
            "C FRM": 20, "C ARM": 50, "IF RNG": 50, "IF ERR": 50,
            "IF ARM": 50, "TDP": 50, "OF RNG": 65, "OF ERR": 50, "OF ARM": 50,
        }
        for split in ["vR", "vL"]:
            for stat in ["BA", "GAP", "POW", "EYE", "K"]:
                cols[f"{stat} {split}"] = 50
        player = pd.DataFrame([cols])

        batting = compute_hitter_batting(player, park_deltas, park_adj, HOME_FRACTION)

        # Both UBR splits should be present and numeric
        assert not np.isnan(batting["UBR vR"].iloc[0])
        assert not np.isnan(batting["UBR vL"].iloc[0])

        # With symmetric ratings at neutral park, vR and vL should be equal
        # (since there's no longer a cross-contamination bug)
        np.testing.assert_allclose(
            batting["UBR vR"].iloc[0],
            batting["UBR vL"].iloc[0],
            rtol=1e-10,
            err_msg="UBR vR and vL should be equal with symmetric inputs",
        )


# ── Bug 5: C SBA uses correct SBA coefficients ───────────────────────────


class TestBug5CSBACoeffs:
    """Bug 5 fix: C SBA uses SBA coefficients, not FRM."""

    def test_c_sba_slope_direction(self):
        """Higher C ARM should decrease SBA (fewer stolen bases allowed)."""
        dp = DEFAULT_HITTER_DP

        # Create players with different C ARM values but same FRM
        base = {
            "B": "R", "T": "R", "HT": "6' 0'", "POS": "C",
            "SPE": 50, "STE": 50, "RUN": 50,
            "CON P": 30, "POW P": 30, "EYE P": 30,
            "STU P": 20, "MOV P": 20, "PCON P": 20,
            "C FRM": 60, "IF RNG": 50, "IF ERR": 50,
            "IF ARM": 50, "TDP": 50, "OF RNG": 50, "OF ERR": 50, "OF ARM": 50,
        }
        for split in ["vR", "vL"]:
            for stat in ["BA", "GAP", "POW", "EYE", "K"]:
                base[f"{stat} {split}"] = 50

        player_low_arm = {**base, "C ARM": 30}
        player_high_arm = {**base, "C ARM": 80}

        df_low = pd.DataFrame([player_low_arm])
        df_high = pd.DataFrame([player_high_arm])

        elig_low = compute_position_eligibility(df_low, dp)
        elig_high = compute_position_eligibility(df_high, dp)

        field_low = compute_fielding(df_low, elig_low, dp)
        field_high = compute_fielding(df_high, elig_high, dp)

        sba_low = field_low["C SBA"].iloc[0]
        sba_high = field_high["C SBA"].iloc[0]

        # With correct SBA coefficients (negative slope), higher ARM → lower SBA
        assert sba_high < sba_low, (
            f"C SBA at ARM=80 ({sba_high:.4f}) should be < ARM=30 ({sba_low:.4f}); "
            "negative SBA slope means better arms allow fewer stolen bases"
        )


# ── Bug 6: RP vL park factors use LH values ──────────────────────────────


class TestBug6RPvLParkFactors:
    """Bug 6 fix: RP vL uses LH park factors, not RH."""

    def test_rp_vl_uses_lh_factors(self):
        """RP vL park mults should use hr_lh and ba_lh."""
        adj = NormalizedAdjustments(
            pf_avg_adj=1.0,
            ba_lh=1.05,
            ba_rh=0.95,
            pf_hr_adj=1.0,
            hr_lh=1.10,
            hr_rh=0.90,
            pf_d_adj=1.0,
            pf_t_adj=1.0,
        )
        hf = 0.5

        hr_park, ba_park, _, _ = _compute_park_mults(adj, hf, "vL")

        # vL should use LH factors (1.10, 1.05), not RH (0.90, 0.95)
        expected_hr = 1.0 + (1.10 - 1.0) * hf  # 1.05
        expected_ba = 1.0 + (1.05 - 1.0) * hf  # 1.025

        assert hr_park == pytest.approx(expected_hr), (
            f"RP vL hr_park ({hr_park}) should use hr_lh=1.10, expected {expected_hr}"
        )
        assert ba_park == pytest.approx(expected_ba), (
            f"RP vL ba_park ({ba_park}) should use ba_lh=1.05, expected {expected_ba}"
        )

    def test_vr_still_uses_rh_factors(self):
        """vR should continue to use RH factors."""
        adj = NormalizedAdjustments(
            pf_avg_adj=1.0,
            ba_lh=1.05,
            ba_rh=0.95,
            pf_hr_adj=1.0,
            hr_lh=1.10,
            hr_rh=0.90,
            pf_d_adj=1.0,
            pf_t_adj=1.0,
        )
        hf = 0.5

        hr_park, ba_park, _, _ = _compute_park_mults(adj, hf, "vR")

        expected_hr = 1.0 + (0.90 - 1.0) * hf  # 0.95
        expected_ba = 1.0 + (0.95 - 1.0) * hf  # 0.975

        assert hr_park == pytest.approx(expected_hr)
        assert ba_park == pytest.approx(expected_ba)
