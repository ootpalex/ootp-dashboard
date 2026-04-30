"""Tests for src/utils.py — rating_to_delta piecewise linear function."""

import numpy as np
import pandas as pd
import pytest

from src.data_points import LinearCoeffs, DEFAULT_HITTER_DP
from src.utils import rating_to_delta


# Simple coefficients for predictable hand-calculations
SIMPLE = LinearCoeffs(h_const=1.0, h_slope=0.5, l_const=-1.0, l_slope=0.3)
AVG = 50.0


class TestRatingToDelta:
    """Test the core piecewise linear rating_to_delta function."""

    def test_high_branch_above_50(self):
        """Rating 60 uses high-branch coefficients."""
        rating = pd.Series([60.0])
        result = rating_to_delta(rating, AVG, SIMPLE)
        # high: 1.0 + 0.5 * (60 - 50) = 1.0 + 5.0 = 6.0
        assert result.iloc[0] == pytest.approx(6.0)

    def test_low_branch_below_50(self):
        """Rating 40 uses low-branch coefficients."""
        rating = pd.Series([40.0])
        result = rating_to_delta(rating, AVG, SIMPLE)
        # low: -1.0 + 0.3 * (40 - 50) = -1.0 + (-3.0) = -4.0
        assert result.iloc[0] == pytest.approx(-4.0)

    def test_boundary_at_50_uses_high(self):
        """Rating exactly 50 uses the high branch (>= 50)."""
        rating = pd.Series([50.0])
        result = rating_to_delta(rating, AVG, SIMPLE)
        # high: 1.0 + 0.5 * (50 - 50) = 1.0
        assert result.iloc[0] == pytest.approx(1.0)

    def test_extreme_rating_zero(self):
        """Rating 0 uses low branch."""
        rating = pd.Series([0.0])
        result = rating_to_delta(rating, AVG, SIMPLE)
        # low: -1.0 + 0.3 * (0 - 50) = -1.0 + (-15.0) = -16.0
        assert result.iloc[0] == pytest.approx(-16.0)

    def test_extreme_rating_100(self):
        """Rating 100 uses high branch."""
        rating = pd.Series([100.0])
        result = rating_to_delta(rating, AVG, SIMPLE)
        # high: 1.0 + 0.5 * (100 - 50) = 1.0 + 25.0 = 26.0
        assert result.iloc[0] == pytest.approx(26.0)

    def test_nan_propagation(self):
        """NaN ratings should produce NaN results."""
        rating = pd.Series([np.nan])
        result = rating_to_delta(rating, AVG, SIMPLE)
        assert np.isnan(result.iloc[0])

    def test_mixed_high_low_series(self):
        """Vectorized: Series with ratings above and below 50."""
        rating = pd.Series([30.0, 50.0, 70.0])
        result = rating_to_delta(rating, AVG, SIMPLE)
        # 30: low branch: -1.0 + 0.3*(30-50) = -1.0 - 6.0 = -7.0
        # 50: high branch: 1.0 + 0.5*(50-50) = 1.0
        # 70: high branch: 1.0 + 0.5*(70-50) = 1.0 + 10.0 = 11.0
        expected = [-7.0, 1.0, 11.0]
        np.testing.assert_allclose(result.values, expected)

    def test_known_value_eye_regression(self):
        """Known value: EYE coefficients at rating=60 with default avg_eye."""
        coeffs = DEFAULT_HITTER_DP.hitting.eye
        avg = DEFAULT_HITTER_DP.league.avg_eye  # 49.82
        rating = pd.Series([60.0])
        result = rating_to_delta(rating, avg, coeffs)
        # high: h_const + h_slope * (60 - 49.82)
        expected = coeffs.h_const + coeffs.h_slope * (60.0 - avg)
        assert result.iloc[0] == pytest.approx(expected)

    def test_known_value_eye_low_branch(self):
        """Known value: EYE coefficients at rating=40 uses low branch."""
        coeffs = DEFAULT_HITTER_DP.hitting.eye
        avg = DEFAULT_HITTER_DP.league.avg_eye
        rating = pd.Series([40.0])
        result = rating_to_delta(rating, avg, coeffs)
        expected = coeffs.l_const + coeffs.l_slope * (40.0 - avg)
        assert result.iloc[0] == pytest.approx(expected)

    def test_preserves_index(self):
        """Output index should match input index."""
        rating = pd.Series([55.0, 45.0], index=[10, 20])
        result = rating_to_delta(rating, AVG, SIMPLE)
        assert list(result.index) == [10, 20]
