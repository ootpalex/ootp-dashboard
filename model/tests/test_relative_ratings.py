"""
tests/test_relative_ratings.py — Tests for AAA/AA relative rating blending.
"""

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.relative_ratings import (
    blend_relative_ratings,
    compute_tier_blend,
    detect_relative_columns,
)

# ---------------------------------------------------------------------------
# Test data paths
# ---------------------------------------------------------------------------
_RELATIVE_DIR = Path(__file__).resolve().parent.parent / "data" / "relative"
_MLB_PATH = _RELATIVE_DIR / "organization.csv"
_AAA_PATH = _RELATIVE_DIR / "organization_aaa.csv"
_AA_PATH = _RELATIVE_DIR / "organization_aa.csv"

# Skip all tests if relative data files are not present
pytestmark = pytest.mark.skipif(
    not _MLB_PATH.exists(), reason="relative test data not found"
)


@pytest.fixture(scope="module")
def mlb_df():
    return pd.read_csv(_MLB_PATH, low_memory=False)


@pytest.fixture(scope="module")
def aaa_df():
    return pd.read_csv(_AAA_PATH, low_memory=False)


@pytest.fixture(scope="module")
def aa_df():
    return pd.read_csv(_AA_PATH, low_memory=False)


# ---------------------------------------------------------------------------
# detect_relative_columns
# ---------------------------------------------------------------------------


class TestDetectRelativeColumns:
    def test_count(self, mlb_df, aaa_df):
        """65 columns differ between MLB and AAA exports."""
        cols = detect_relative_columns(mlb_df, aaa_df)
        assert len(cols) == 65

    def test_known_relative_columns(self, mlb_df, aaa_df):
        """Key rating columns should be detected as relative."""
        cols = set(detect_relative_columns(mlb_df, aaa_df))
        for expected in ["CON", "GAP", "POW", "EYE", "K's", "OVR", "POT",
                         "STU", "MOV", "FB", "CH", "SL"]:
            assert expected in cols, f"{expected} should be relative"

    def test_known_fixed_columns(self, mlb_df, aaa_df):
        """Fielding and physical columns should NOT be relative."""
        cols = set(detect_relative_columns(mlb_df, aaa_df))
        for fixed in ["SPE", "IF RNG", "OF RNG", "IF ARM", "OF ARM", "TDP"]:
            assert fixed not in cols, f"{fixed} should be fixed"

    def test_identical_frames_returns_empty(self):
        """Two identical DataFrames should produce no relative columns."""
        df = pd.DataFrame({"ID": [1, 2], "CON": [50, 60], "SPE": [40, 45]})
        assert detect_relative_columns(df, df.copy()) == []


# ---------------------------------------------------------------------------
# compute_tier_blend — synthetic data
# ---------------------------------------------------------------------------


class TestComputeTierBlend:
    def test_aaa_only_single_tier(self):
        """AAA-only: 3 distinct AAA values in one MLB tier."""
        mlb = np.array([50, 50, 50, 50, 50])
        aaa = np.array([45, 50, 55, 55, 45])  # 3 distinct: ranks 0, 1, 2

        result = compute_tier_blend(mlb, aaa)

        # n_aaa=3, formula: 50-2.5 + (rank+0.5)/3 * 5
        expected_by_aaa = {
            45: 47.5 + 0.5 / 3 * 5,   # rank 0 → 48.333...
            50: 47.5 + 1.5 / 3 * 5,   # rank 1 → 50.0
            55: 47.5 + 2.5 / 3 * 5,   # rank 2 → 51.667...
        }
        for i, (m, a) in enumerate(zip(mlb, aaa)):
            np.testing.assert_almost_equal(result[i], expected_by_aaa[a], decimal=10)

    def test_aaa_only_two_tiers(self):
        """AAA-only across two MLB tiers — each blended independently."""
        mlb = np.array([50, 50, 55, 55])
        aaa = np.array([45, 55, 55, 60])

        result = compute_tier_blend(mlb, aaa)

        # MLB=50: n_aaa=2 → rank 0 (aaa=45), rank 1 (aaa=55)
        np.testing.assert_almost_equal(result[0], 47.5 + 0.5 / 2 * 5)  # 48.75
        np.testing.assert_almost_equal(result[1], 47.5 + 1.5 / 2 * 5)  # 51.25
        # MLB=55: n_aaa=2 → rank 0 (aaa=55), rank 1 (aaa=60)
        np.testing.assert_almost_equal(result[2], 52.5 + 0.5 / 2 * 5)  # 53.75
        np.testing.assert_almost_equal(result[3], 52.5 + 1.5 / 2 * 5)  # 56.25

    def test_with_aa_subdivision(self):
        """Full 3-level blend with AA subdivision."""
        mlb = np.array([50, 50, 50, 50])
        aaa = np.array([45, 55, 55, 55])  # 2 distinct AAA: ranks 0, 1
        aa = np.array([50, 55, 60, 55])   # AAA=55 group: 2 distinct AA

        result = compute_tier_blend(mlb, aaa, aa)

        # n_aaa=2
        # AAA=45 (rank=0): AA=[50], n_aa=1, aa_rank=0
        #   → 47.5 + (0 + 0.5/1) / 2 * 5 = 47.5 + 1.25 = 48.75
        np.testing.assert_almost_equal(result[0], 48.75)

        # AAA=55 (rank=1): AA=[55, 60], n_aa=2
        #   aa=55 → aa_rank=0: 47.5 + (1 + 0.5/2) / 2 * 5 = 47.5 + 3.125 = 50.625
        #   aa=60 → aa_rank=1: 47.5 + (1 + 1.5/2) / 2 * 5 = 47.5 + 4.375 = 51.875
        np.testing.assert_almost_equal(result[1], 50.625)
        np.testing.assert_almost_equal(result[2], 51.875)
        np.testing.assert_almost_equal(result[3], 50.625)  # same aa=55

    def test_single_value_tier_unchanged(self):
        """If only 1 distinct AAA value, blended = M (midpoint)."""
        mlb = np.array([60, 60, 60])
        aaa = np.array([65, 65, 65])  # 1 distinct → n_aaa=1

        result = compute_tier_blend(mlb, aaa)

        # n_aaa=1, rank=0 → 57.5 + 0.5/1*5 = 60.0
        np.testing.assert_almost_equal(result, [60.0, 60.0, 60.0])


# ---------------------------------------------------------------------------
# compute_tier_blend — real data
# ---------------------------------------------------------------------------


class TestTierBlendRealData:
    def test_con_tier_55(self, mlb_df, aaa_df, aa_df):
        """Verify CON blended values at MLB=55 match expected formula output."""
        col = "CON"
        mask = mlb_df[col] == 55
        mlb_vals = mlb_df.loc[mask, col].values.astype(float)
        aaa_vals = aaa_df.loc[mask, col].values.astype(float)
        aa_vals = aa_df.loc[mask, col].values.astype(float)

        result = compute_tier_blend(mlb_vals, aaa_vals, aa_vals)

        # Expected from our analysis:
        # AAA=55,AA=60 → 53.3333 (rank0, 1 aa val)
        # AAA=60,AA=60 → 54.5833 (rank1, aa_rank0 of 2)
        # AAA=60,AA=65 → 55.4167 (rank1, aa_rank1 of 2)
        # AAA=65,AA=65 → 56.2500 (rank2, aa_rank0 of 2)
        # AAA=65,AA=70 → 57.0833 (rank2, aa_rank1 of 2)

        expected_map = {
            (55, 60): 55 - 2.5 + (0 + 0.5 / 1) / 3 * 5,
            (60, 60): 55 - 2.5 + (1 + 0.5 / 2) / 3 * 5,
            (60, 65): 55 - 2.5 + (1 + 1.5 / 2) / 3 * 5,
            (65, 65): 55 - 2.5 + (2 + 0.5 / 2) / 3 * 5,
            (65, 70): 55 - 2.5 + (2 + 1.5 / 2) / 3 * 5,
        }

        for i in range(len(result)):
            key = (int(aaa_vals[i]), int(aa_vals[i]))
            np.testing.assert_almost_equal(
                result[i], expected_map[key], decimal=4,
                err_msg=f"Mismatch at index {i}, AAA={key[0]}, AA={key[1]}"
            )


# ---------------------------------------------------------------------------
# blend_relative_ratings — integration
# ---------------------------------------------------------------------------


class TestBlendRelativeRatings:
    def test_fixed_columns_unchanged(self, mlb_df, aaa_df, aa_df):
        """Non-relative columns should pass through unchanged."""
        blended = blend_relative_ratings(mlb_df, aaa_df, aa_df)

        for col in ["SPE", "IF RNG", "OF RNG", "IF ARM", "OF ARM", "TDP"]:
            pd.testing.assert_series_equal(
                blended[col], mlb_df[col],
                check_names=False,
                obj=f"Fixed column {col}",
            )

    def test_shape_preserved(self, mlb_df, aaa_df, aa_df):
        """Output should have same shape as input."""
        blended = blend_relative_ratings(mlb_df, aaa_df, aa_df)
        assert blended.shape == mlb_df.shape

    def test_id_preserved(self, mlb_df, aaa_df, aa_df):
        """Player IDs should be unchanged."""
        blended = blend_relative_ratings(mlb_df, aaa_df, aa_df)
        pd.testing.assert_series_equal(blended["ID"], mlb_df["ID"])

    def test_relative_columns_changed(self, mlb_df, aaa_df, aa_df):
        """Relative columns should have different values from MLB input."""
        blended = blend_relative_ratings(mlb_df, aaa_df, aa_df)
        # CON should be changed (no longer 5-point quantized)
        assert not blended["CON"].equals(mlb_df["CON"])

    def test_aaa_only_blend(self, mlb_df, aaa_df):
        """Blending with AAA only (no AA) should work."""
        blended = blend_relative_ratings(mlb_df, aaa_df, aa_df=None)
        assert blended.shape == mlb_df.shape
        assert not blended["CON"].equals(mlb_df["CON"])

    def test_no_aaa_returns_copy(self):
        """If MLB and 'AAA' are identical, output equals input."""
        df = pd.DataFrame({
            "ID": [1, 2, 3],
            "CON": [50, 55, 60],
            "SPE": [40, 45, 50],
        })
        blended = blend_relative_ratings(df, df.copy())
        pd.testing.assert_frame_equal(blended, df)


# ---------------------------------------------------------------------------
# Ordering and bounds
# ---------------------------------------------------------------------------


class TestOrderingAndBounds:
    def test_values_within_bucket(self, mlb_df, aaa_df, aa_df):
        """All blended values should be within [M-2.5, M+2.5]."""
        relative_cols = detect_relative_columns(mlb_df, aaa_df)
        blended = blend_relative_ratings(mlb_df, aaa_df, aa_df)

        for col in relative_cols:
            mlb_vals = pd.to_numeric(mlb_df[col], errors="coerce")
            blended_vals = pd.to_numeric(blended[col], errors="coerce")
            valid = mlb_vals.notna() & blended_vals.notna()

            lower = mlb_vals[valid] - 2.5
            upper = mlb_vals[valid] + 2.5
            below = blended_vals[valid] < lower - 1e-10
            above = blended_vals[valid] >= upper + 1e-10
            assert not below.any(), f"{col}: values below M-2.5"
            assert not above.any(), f"{col}: values at or above M+2.5"

    def test_ordering_monotonic(self, mlb_df, aaa_df, aa_df):
        """Within each MLB tier, blended ordering respects (AAA, AA) ordering."""
        col = "CON"
        blended = blend_relative_ratings(mlb_df, aaa_df, aa_df)

        for m_val in mlb_df[col].unique():
            mask = mlb_df[col] == m_val
            tier_data = pd.DataFrame({
                "aaa": aaa_df.loc[mask, col],
                "aa": aa_df.loc[mask, col],
                "blended": blended.loc[mask, col],
            })
            # Sort by (aaa, aa) — blended should be non-decreasing
            tier_data = tier_data.sort_values(["aaa", "aa"]).reset_index(drop=True)
            diffs = tier_data["blended"].diff().dropna()
            assert (diffs >= -1e-10).all(), (
                f"Non-monotonic blended values in MLB={m_val} tier"
            )

    def test_cross_tier_ordering(self, mlb_df, aaa_df, aa_df):
        """Blended values for higher MLB tiers should generally be higher."""
        col = "CON"
        blended = blend_relative_ratings(mlb_df, aaa_df, aa_df)
        mlb_vals = mlb_df[col].values

        # Compare max of tier N with min of tier N+5
        tiers = sorted(mlb_df[col].unique())
        for i in range(len(tiers) - 1):
            mask_lo = mlb_vals == tiers[i]
            mask_hi = mlb_vals == tiers[i + 1]
            max_lo = blended.loc[mask_lo, col].max()
            min_hi = blended.loc[mask_hi, col].min()
            # Tier gap = 5, bucket width = 5, so max_lo < M+2.5 and min_hi >= M+5-2.5
            # max_lo < tiers[i]+2.5, min_hi >= tiers[i+1]-2.5 = tiers[i]+2.5
            assert max_lo < min_hi + 1e-10, (
                f"Tier overlap: max({tiers[i]})={max_lo} vs min({tiers[i+1]})={min_hi}"
            )


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_row_count_mismatch_raises(self):
        """Mismatched row counts should raise ValueError."""
        mlb = pd.DataFrame({"ID": [1, 2], "CON": [50, 55]})
        aaa = pd.DataFrame({"ID": [1], "CON": [50]})
        with pytest.raises(ValueError, match="row counts differ"):
            blend_relative_ratings(mlb, aaa)

    def test_dash_values_preserved(self, mlb_df, aaa_df, aa_df):
        """Columns with dash values (like PCON) should handle them gracefully."""
        # CON.1 has dash values for non-pitchers
        col = "CON.1"
        if col not in mlb_df.columns:
            pytest.skip(f"Column {col} not found")

        blended = blend_relative_ratings(mlb_df, aaa_df, aa_df)

        # Check that dash rows remain NaN (from to_numeric coercion)
        mlb_dashes = mlb_df[col] == "-"
        # Non-dash numeric values should be blended
        mlb_numeric = pd.to_numeric(mlb_df[col], errors="coerce")
        blended_numeric = pd.to_numeric(blended[col], errors="coerce")
        # Where MLB was numeric and non-NaN, blended should also be non-NaN
        valid_mlb = mlb_numeric.notna()
        assert blended_numeric[valid_mlb].notna().all()

    def test_all_same_aaa_returns_midpoint(self):
        """If all players have the same AAA value, blended = MLB value."""
        mlb = np.array([50, 50, 50])
        aaa = np.array([55, 55, 55])
        result = compute_tier_blend(mlb, aaa)
        np.testing.assert_almost_equal(result, [50.0, 50.0, 50.0])
