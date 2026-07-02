"""
src/utils.py — Shared helpers for hitter and pitcher stat pipelines.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from src.data_points import CubicCoeffs, LinearCoeffs, PiecewiseCoeffs


def piecewise_delta(
    rating: pd.Series | float, avg: float, coeffs: PiecewiseCoeffs
) -> pd.Series | float:
    """Continuous piecewise-linear delta, anchored delta(avg) = 0 (OOTP-27 path).

    Regime-aware (spec §2.2/§2.3): for ``relative=True`` the stored knots are OFFSETS from the
    league average and are placed at ``avg + knot`` (they slide with each league's average); for
    ``relative=False`` they are absolute display values and are placed as-is. Slopes apply
    directly in both regimes.

    Implementation: the piecewise integral in the ReLU basis
        cum(x) = slopes[0]*x + Σ_i (slopes[i+1] - slopes[i]) * max(x - knot_i, 0)
    and ``delta = cum(rating) - cum(avg)`` — continuous by construction, exact clamps when an
    end slope is 0.0, linear extrapolation beyond the outermost knots otherwise.
    """
    knots = [avg + k for k in coeffs.knots] if coeffs.relative else list(coeffs.knots)

    # Hard clamps: the end slope is 0.0, so clipping into the clamped band is mathematically
    # identical — but it makes the floor/ceiling EXACTLY flat in floating point too.
    x, a = rating, avg
    if coeffs.clamp_lo and knots:
        x, a = np.maximum(x, knots[0]), np.maximum(a, knots[0])
    if coeffs.clamp_hi and knots:
        x, a = np.minimum(x, knots[-1]), np.minimum(a, knots[-1])

    def cum(v):
        y = coeffs.slopes[0] * v
        for i, k in enumerate(knots):
            y = y + (coeffs.slopes[i + 1] - coeffs.slopes[i]) * np.maximum(v - k, 0.0)
        return y

    return cum(x) - cum(a)


def rating_to_delta(
    rating: pd.Series, avg: float, coeffs: LinearCoeffs | PiecewiseCoeffs
) -> pd.Series:
    """Rating → stat delta.

    OOTP-26 (``LinearCoeffs``): 2-segment piecewise linear — high model (rating >= 50), low
    model (rating < 50). Unchanged.
    OOTP-27 (``PiecewiseCoeffs``): continuous multi-knot piecewise via ``piecewise_delta``.
    """
    if isinstance(coeffs, PiecewiseCoeffs):
        return piecewise_delta(rating, avg, coeffs)
    centered = rating - avg
    high = coeffs.h_const + coeffs.h_slope * centered
    low = coeffs.l_const + coeffs.l_slope * centered
    return pd.Series(np.where(rating >= 50, high, low), index=rating.index)


def baserunning_poly(
    rating: pd.Series, avg: float, coeffs: CubicCoeffs | PiecewiseCoeffs
) -> pd.Series:
    """Baserunning rating → poly term (applied downstream as ``poly + lg.rate``).

    OOTP-26 (``CubicCoeffs``): ``c0 + c1*(rating - avg)`` — exactly the existing arithmetic
    (c2/c3 are 0 in 26 and were never applied).
    OOTP-27 (``PiecewiseCoeffs``): ``c0 + piecewise_delta(rating)`` — the canonical intercept
    ``c0`` is REQUIRED here (spec §2.5): it places the average-rated runner at their true rate
    below the pooled league rate. Never zero it.
    """
    if isinstance(coeffs, PiecewiseCoeffs):
        assert coeffs.c0 is not None, "27 baserunning PiecewiseCoeffs must carry the canonical c0"
        return coeffs.c0 + piecewise_delta(rating, avg, coeffs)
    return coeffs.c0 + coeffs.c1 * (rating - avg)
