"""
src/utils.py — Shared helpers for hitter and pitcher stat pipelines.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from src.data_points import LinearCoeffs


def rating_to_delta(
    rating: pd.Series, avg: float, coeffs: LinearCoeffs
) -> pd.Series:
    """Piecewise linear: high model (rating >= 50), low model (rating < 50)."""
    centered = rating - avg
    high = coeffs.h_const + coeffs.h_slope * centered
    low = coeffs.l_const + coeffs.l_slope * centered
    return pd.Series(np.where(rating >= 50, high, low), index=rating.index)
