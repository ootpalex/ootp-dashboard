"""Tests for src/regressions.py — WLS regression coefficient pipeline.

Validates computed coefficients against the answer key in data_points.py.

Slope tolerances:
  - Hitting linear (12/12): 0.00% exact match (all slopes including speed.l
    after Bug 8 fix in updated spreadsheet). Speed slopes are near-exact
    (~0.003%) after fixing _hitting_triple_rate NaN propagation.
  - SP pitching linear (8/8): 0.00% exact match.
  - RP pitching linear (8/8): 0.00% exact match (stale cache fix in updated
    spreadsheet resolved Player 411 residuals).
  - Pitching BABIP: single-model regression (h==l); SP 0.00%, RP 0.00%.
  - Hitting cubics (actually linear): SBA 0.00%, SB% 0.00%, UBR ~0.06%.
  - Pitching cubics: SP SBA/SB% 0.00%, RP SB% 0.00% (uses SP slope).
  - OF ERR uses E/PO, OF ARM uses arm/PA (different from IF which uses E/IP).
Intercept tolerance: absolute (0.005), since centered regressions produce
near-zero intercepts where relative error is misleading.
"""
from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import numpy as np
import pytest

from src.data_points import (
    DEFAULT_HITTER_DP,
    DEFAULT_PITCHER_DP,
    CubicCoeffs,
    FieldingRegressionCoeffs,
    HittingRegressionCoeffs,
    LinearCoeffs,
    PitchingRegressionCoeffs,
)
from src.regressions import (
    RegressionInputs,
    _compute_cubic_coeffs,
    _compute_linear_coeffs,
    _compute_single_linear_coeffs,
    _wls_cubic,
    _wls_single,
    compute_fielding_regressions,
    compute_hitting_regressions,
    compute_pitching_regressions,
    compute_regressions,
    generate_regression_coefficients,
    load_regression_inputs,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "regressions" / "ootp26"

# Answer keys
EXPECTED_HIT = DEFAULT_HITTER_DP.hitting
EXPECTED_PITCH = DEFAULT_PITCHER_DP.pitching
EXPECTED_FIELD = DEFAULT_HITTER_DP.fielding_coeffs


@pytest.fixture(scope="module")
def inputs() -> RegressionInputs:
    """Load regression inputs once for the entire module."""
    return load_regression_inputs(DATA_DIR)


@pytest.fixture(scope="module")
def all_coeffs():
    """Compute all regression coefficients once for the module."""
    return compute_regressions(DATA_DIR)


@pytest.fixture(scope="module")
def hitting(all_coeffs) -> HittingRegressionCoeffs:
    return all_coeffs[0]


@pytest.fixture(scope="module")
def pitching(all_coeffs) -> PitchingRegressionCoeffs:
    return all_coeffs[1]


@pytest.fixture(scope="module")
def fielding(all_coeffs) -> FieldingRegressionCoeffs:
    return all_coeffs[2]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def assert_slope_close(computed, expected, stat_name, tol=0.02):
    """Assert slope is within relative tolerance (default 2%)."""
    if abs(expected) < 1e-10:
        assert abs(computed) < 1e-6, f"{stat_name}: expected ~0, got {computed}"
        return
    rel_err = abs((computed - expected) / expected)
    assert rel_err < tol, (
        f"{stat_name}: computed={computed:.8f}, expected={expected:.8f}, "
        f"rel_err={rel_err:.1%} > {tol:.0%}"
    )


def assert_abs_close(computed, expected, stat_name, tol=0.005):
    """Assert value is within absolute tolerance (for near-zero intercepts)."""
    abs_err = abs(computed - expected)
    assert abs_err < tol, (
        f"{stat_name}: computed={computed:.8f}, expected={expected:.8f}, "
        f"abs_err={abs_err:.6f} > {tol}"
    )


# ===========================================================================
# 1. Data Loading Tests
# ===========================================================================


class TestDataLoading:
    """Verify data shapes and structure from load_regression_inputs."""

    def test_hitting_shape(self, inputs):
        assert len(inputs.hitting) == 441

    def test_hitting_br_shape(self, inputs):
        assert len(inputs.hitting_br) == 441

    def test_sp_shape(self, inputs):
        assert len(inputs.sp) == 160

    def test_rp_shape(self, inputs):
        assert len(inputs.rp) == 224

    def test_sp_br_shape(self, inputs):
        """split_id=1 pitching data should have same player counts."""
        assert len(inputs.sp_br) == 160

    def test_rp_br_shape(self, inputs):
        assert len(inputs.rp_br) == 224

    def test_sp_br_has_sb_data(self, inputs):
        """split_id=1 pitching data should have non-zero sb/cs."""
        assert inputs.sp_br["sb"].sum() > 0
        assert inputs.sp_br["cs"].sum() > 0

    def test_sp_split3_has_no_sb(self, inputs):
        """split_id=3 pitching data should have zero sb/cs."""
        assert inputs.sp["sb"].sum() == 0

    def test_fielding_positions_present(self, inputs):
        expected_positions = {"c", "1b", "2b", "3b", "ss", "lf", "cf", "rf"}
        assert set(inputs.fielding.keys()) == expected_positions

    def test_fielding_catcher_count(self, inputs):
        assert len(inputs.fielding["c"]) >= 25

    def test_fielding_has_ratings(self, inputs):
        """Fielding DataFrames should have rating columns from join."""
        assert "IF RNG" in inputs.fielding["ss"].columns
        assert "OF RNG" in inputs.fielding["cf"].columns

    def test_hitting_has_pa(self, inputs):
        assert "pa" in inputs.hitting.columns
        assert inputs.hitting["pa"].sum() > 9_000_000

    def test_hitting_has_ratings(self, inputs):
        for col in ("EYE vR", "POW vR", "K vR", "BA vR", "GAP vR", "SPE", "STE", "RUN"):
            assert col in inputs.hitting.columns, f"Missing rating column: {col}"


# ===========================================================================
# 2. WLS Engine Tests
# ===========================================================================


class TestWLSEngine:
    """Low-level WLS math validation."""

    def test_wls_single_perfect_line(self):
        """WLS on a perfect line y = 2 + 3x should return (2, 3)."""
        x = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        y = 2.0 + 3.0 * x
        w = np.ones(5)
        intercept, slope = _wls_single(x, y, w)
        assert abs(slope - 3.0) < 1e-10
        assert abs(intercept - 2.0) < 1e-10

    def test_wls_single_weighted(self):
        """Higher-weight points should pull the fit toward them."""
        x = np.array([0.0, 1.0, 2.0])
        y = np.array([0.0, 1.0, 10.0])
        # Heavily weight the last point
        w_heavy = np.array([1.0, 1.0, 100.0])
        _, slope_heavy = _wls_single(x, y, w_heavy)
        w_uniform = np.ones(3)
        _, slope_uniform = _wls_single(x, y, w_uniform)
        assert slope_heavy > slope_uniform

    def test_piecewise_split_at_50(self):
        """_compute_linear_coeffs should split at rating=50."""
        rng = np.random.default_rng(42)
        # Ratings: half below 50, half above 50
        rating = np.concatenate([rng.uniform(20, 49, 50), rng.uniform(50, 80, 50)])
        stat = rating * 0.01 + rng.normal(0, 0.001, 100)
        weight = np.ones(100) * 500
        coeffs = _compute_linear_coeffs(rating, stat, weight)
        # Both slopes should be ~0.01
        assert abs(coeffs.h_slope - 0.01) < 0.005
        assert abs(coeffs.l_slope - 0.01) < 0.005

    def test_cubic_coeffs_linear_data(self):
        """Cubic on linear data should have c2≈0, c3≈0."""
        x = np.linspace(-20, 20, 100)
        y = 0.5 + 0.1 * x
        w = np.ones(100)
        coeffs = _wls_cubic(x, y, w)
        assert abs(coeffs.c0 - 0.5) < 1e-8
        assert abs(coeffs.c1 - 0.1) < 1e-8
        assert abs(coeffs.c2) < 1e-8
        assert abs(coeffs.c3) < 1e-8

    def test_nan_filtering_linear(self):
        """_compute_linear_coeffs should handle NaN values."""
        rating = np.array([40, 45, 50, 55, 60, np.nan, 65])
        stat = np.array([0.1, 0.12, 0.15, 0.18, 0.2, 0.22, 0.25])
        weight = np.array([500, 500, 500, 500, 500, 500, 500], dtype=float)
        # Should not raise or return NaN
        coeffs = _compute_linear_coeffs(rating, stat, weight)
        assert np.isfinite(coeffs.h_slope)
        assert np.isfinite(coeffs.l_slope)

    def test_nan_filtering_single(self):
        """_compute_single_linear_coeffs should handle NaN values."""
        rating = np.array([40.0, 50.0, 60.0, np.nan])
        stat = np.array([0.1, np.nan, 0.3, 0.4])
        weight = np.array([100.0, 100.0, 100.0, 100.0])
        intercept, slope = _compute_single_linear_coeffs(rating, stat, weight)
        assert np.isfinite(intercept)
        assert np.isfinite(slope)


# ===========================================================================
# 3. Hitting Linear Regression Tests
# ===========================================================================


class TestHittingLinear:
    """Hitting piecewise linear coefficients vs answer key.

    All 12 slopes match at 0.00% (exact) after the updated spreadsheet
    fixed Bug 8 (speed LOW filter now correctly uses SPE instead of GAP vR).
    """

    @pytest.mark.parametrize("stat,field", [
        ("eye", "h_slope"), ("eye", "l_slope"),
        ("power", "h_slope"), ("power", "l_slope"),
        ("k", "h_slope"), ("k", "l_slope"),
        ("babip", "h_slope"), ("babip", "l_slope"),
        ("gap", "h_slope"), ("gap", "l_slope"),
        ("speed", "h_slope"), ("speed", "l_slope"),
    ])
    def test_slope(self, hitting, stat, field):
        """Hitting linear slopes match exactly (0.00%)."""
        computed = getattr(getattr(hitting, stat), field)
        expected = getattr(getattr(EXPECTED_HIT, stat), field)
        assert_slope_close(computed, expected, f"hit.{stat}.{field}", tol=0.001)

    @pytest.mark.parametrize("stat", ["eye", "power", "k", "gap"])
    def test_h_const_close(self, hitting, stat):
        """h_const should be within 0.005 absolute of expected."""
        computed = getattr(hitting, stat).h_const
        expected = getattr(EXPECTED_HIT, stat).h_const
        assert_abs_close(computed, expected, f"hit.{stat}.h_const")

    @pytest.mark.parametrize("stat", ["eye", "power", "k", "gap"])
    def test_l_const_close(self, hitting, stat):
        computed = getattr(hitting, stat).l_const
        expected = getattr(EXPECTED_HIT, stat).l_const
        assert_abs_close(computed, expected, f"hit.{stat}.l_const")


# ===========================================================================
# 4. Hitting Cubic Regression Tests
# ===========================================================================


class TestHittingCubic:
    """Hitting SBA/SB%/UBR coefficients (linear WLS stored in CubicCoeffs).

    These are linear regressions (slope+intercept) stored in cubic format
    with c2=c3=0. SBA% and SB% are filtered to high-rating players only
    (STE>=55 and SPE>=55 respectively). Weights use PA from split_id=3.
    Full-time player filter (n_teams * 9) is applied before these regressions.
    """

    def test_sba_c1_close(self, hitting):
        """SBA c1 matches exactly with full-time filter."""
        assert_slope_close(hitting.sba.c1, EXPECTED_HIT.sba.c1, "hit.sba.c1", tol=0.001)

    def test_sb_pct_c1_close(self, hitting):
        """SB% c1 matches exactly with full-time filter."""
        assert_slope_close(hitting.sb_pct.c1, EXPECTED_HIT.sb_pct.c1, "hit.sb_pct.c1", tol=0.001)

    def test_ubr_c1_close(self, hitting):
        """UBR c1 within 0.1% — tiny residual from stale cached player 1288 in Excel."""
        assert_slope_close(hitting.ubr.c1, EXPECTED_HIT.ubr.c1, "hit.ubr.c1", tol=0.001)

    def test_c2_c3_exactly_zero(self, hitting):
        """c2 and c3 are exactly 0 (linear WLS, not cubic polynomial)."""
        for stat in ("sba", "sb_pct", "ubr"):
            coeffs = getattr(hitting, stat)
            assert coeffs.c2 == 0, f"{stat}.c2 should be exactly 0: {coeffs.c2}"
            assert coeffs.c3 == 0, f"{stat}.c3 should be exactly 0: {coeffs.c3}"


# ===========================================================================
# 5. Pitching Linear Regression Tests
# ===========================================================================


class TestPitchingLinear:
    """Pitching piecewise linear coefficients for SP and RP.

    All SP and RP slopes match at 0.00% (exact) after the updated spreadsheet
    fixed Player 411 stale cached formulas. BABIP uses a single-model
    regression (no high/low split), matching the answer key where h==l.
    """

    @pytest.mark.parametrize("stat,field", [
        ("sp_con", "h_slope"), ("sp_con", "l_slope"),
        ("sp_hrr", "h_slope"), ("sp_hrr", "l_slope"),
        ("sp_stu", "h_slope"), ("sp_stu", "l_slope"),
        ("rp_con", "h_slope"), ("rp_con", "l_slope"),
        ("rp_hrr", "h_slope"), ("rp_hrr", "l_slope"),
        ("rp_stu", "h_slope"), ("rp_stu", "l_slope"),
    ])
    def test_slope(self, pitching, stat, field):
        computed = getattr(getattr(pitching, stat), field)
        expected = getattr(getattr(EXPECTED_PITCH, stat), field)
        assert_slope_close(computed, expected, f"pitch.{stat}.{field}", tol=0.001)

    @pytest.mark.parametrize("stat", ["sp_con", "sp_hrr", "sp_stu", "rp_con", "rp_hrr", "rp_stu"])
    def test_h_const_close(self, pitching, stat):
        computed = getattr(pitching, stat).h_const
        expected = getattr(EXPECTED_PITCH, stat).h_const
        assert_abs_close(computed, expected, f"pitch.{stat}.h_const")

    @pytest.mark.parametrize("stat", ["sp_con", "sp_hrr", "sp_stu", "rp_con", "rp_hrr", "rp_stu"])
    def test_l_const_close(self, pitching, stat):
        computed = getattr(pitching, stat).l_const
        expected = getattr(EXPECTED_PITCH, stat).l_const
        assert_abs_close(computed, expected, f"pitch.{stat}.l_const")

    def test_sp_babip_single_model(self, pitching):
        """SP BABIP uses single model: h_slope == l_slope, h_const == l_const."""
        assert pitching.sp_babip.h_slope == pitching.sp_babip.l_slope
        assert pitching.sp_babip.h_const == pitching.sp_babip.l_const

    def test_rp_babip_single_model(self, pitching):
        """RP BABIP uses single model: h_slope == l_slope, h_const == l_const."""
        assert pitching.rp_babip.h_slope == pitching.rp_babip.l_slope
        assert pitching.rp_babip.h_const == pitching.rp_babip.l_const

    def test_sp_babip_slope(self, pitching):
        """SP BABIP slope within 1% (single-model fix)."""
        assert_slope_close(
            pitching.sp_babip.h_slope, EXPECTED_PITCH.sp_babip.h_slope,
            "pitch.sp_babip.h_slope", tol=0.01,
        )

    def test_rp_babip_slope(self, pitching):
        """RP BABIP slope matches exactly after stale cache fix."""
        assert_slope_close(
            pitching.rp_babip.h_slope, EXPECTED_PITCH.rp_babip.h_slope,
            "pitch.rp_babip.h_slope", tol=0.001,
        )


# ===========================================================================
# 6. Pitching Cubic Regression Tests
# ===========================================================================


class TestPitchingCubic:
    """Pitching cubic regressions (SBA, SP SB%, RP SB%).

    These use split_id=1 data. SP SBA/SB% match exactly. RP SB% uses the
    SP slope (matching the spreadsheet) with a separate RP-specific intercept.
    """

    def test_sba_c1_negative(self, pitching):
        """Higher HLD → fewer SB attempts against (negative slope)."""
        assert pitching.sba.c1 < 0

    def test_sp_sb_pct_c1_negative(self, pitching):
        """Higher HLD → lower SB% against (negative slope)."""
        assert pitching.sp_sb_pct.c1 < 0

    def test_rp_sb_pct_c1_negative(self, pitching):
        assert pitching.rp_sb_pct.c1 < 0

    def test_sba_nonzero(self, pitching):
        """SBA c1 should be non-trivially negative (not zero from missing data)."""
        assert abs(pitching.sba.c1) > 0.0001

    def test_sp_sb_pct_nonzero(self, pitching):
        assert abs(pitching.sp_sb_pct.c1) > 0.0005

    def test_rp_sb_pct_c1_exact(self, pitching):
        """RP SB% c1 matches exactly (uses SP slope, matching spreadsheet)."""
        assert_slope_close(
            pitching.rp_sb_pct.c1, EXPECTED_PITCH.rp_sb_pct.c1,
            "pitch.rp_sb_pct.c1", tol=0.001
        )


# ===========================================================================
# 7. Fielding Regression Tests
# ===========================================================================


class TestFielding:
    """Fielding regression coefficients.

    Fielding regressions use OLS (unweighted LINEST) with simple-average
    centering. All slopes now match exactly (0.00%) after switching from WLS.
    """

    _TOL = 0.001  # all fielding slopes are exact after OLS fix

    # --- Catcher ---

    def test_c_frm_slope(self, fielding):
        assert_slope_close(
            fielding.c_frm_slope, EXPECTED_FIELD.c_frm_slope,
            "c_frm_slope", tol=self._TOL,
        )

    def test_c_sba_slope(self, fielding):
        assert_slope_close(
            fielding.c_sba_slope, EXPECTED_FIELD.c_sba_slope,
            "c_sba_slope", tol=self._TOL,
        )

    def test_c_rto_slope(self, fielding):
        assert_slope_close(
            fielding.c_rto_slope, EXPECTED_FIELD.c_rto_slope,
            "c_rto_slope", tol=self._TOL,
        )

    # --- 1B ---

    def test_1b_pm_rng_slope(self, fielding):
        assert_slope_close(
            fielding.first_pm_rng_slope, EXPECTED_FIELD.first_pm_rng_slope,
            "first_pm_rng_slope", tol=self._TOL,
        )

    def test_1b_pm_ht_slope(self, fielding):
        assert_slope_close(
            fielding.first_pm_ht_slope, EXPECTED_FIELD.first_pm_ht_slope,
            "first_pm_ht_slope", tol=self._TOL,
        )

    def test_1b_err_slope(self, fielding):
        assert_slope_close(
            fielding.first_err_slope, EXPECTED_FIELD.first_err_slope,
            "first_err_slope", tol=self._TOL,
        )

    # --- 2B ---

    def test_2b_pm_rng_slope(self, fielding):
        assert_slope_close(
            fielding.second_pm_rng_slope, EXPECTED_FIELD.second_pm_rng_slope,
            "second_pm_rng_slope", tol=self._TOL,
        )

    def test_2b_pm_arm_slope(self, fielding):
        assert_slope_close(
            fielding.second_pm_arm_slope, EXPECTED_FIELD.second_pm_arm_slope,
            "second_pm_arm_slope", tol=self._TOL,
        )

    def test_2b_err_slope(self, fielding):
        assert_slope_close(
            fielding.second_err_slope, EXPECTED_FIELD.second_err_slope,
            "second_err_slope", tol=self._TOL,
        )

    # --- SS ---

    def test_ss_pm_rng_slope(self, fielding):
        assert_slope_close(
            fielding.ss_pm_rng_slope, EXPECTED_FIELD.ss_pm_rng_slope,
            "ss_pm_rng_slope", tol=self._TOL,
        )

    def test_ss_pm_arm_slope(self, fielding):
        assert_slope_close(
            fielding.ss_pm_arm_slope, EXPECTED_FIELD.ss_pm_arm_slope,
            "ss_pm_arm_slope", tol=self._TOL,
        )

    def test_ss_err_slope(self, fielding):
        assert_slope_close(
            fielding.ss_err_slope, EXPECTED_FIELD.ss_err_slope,
            "ss_err_slope", tol=self._TOL,
        )

    # --- 3B ---

    def test_3b_pm_rng_slope(self, fielding):
        assert_slope_close(
            fielding.third_pm_rng_slope, EXPECTED_FIELD.third_pm_rng_slope,
            "third_pm_rng_slope", tol=self._TOL,
        )

    def test_3b_err_slope(self, fielding):
        assert_slope_close(
            fielding.third_err_slope, EXPECTED_FIELD.third_err_slope,
            "third_err_slope", tol=self._TOL,
        )

    # --- 3B arm ---

    def test_3b_pm_arm_slope(self, fielding):
        assert_slope_close(
            fielding.third_pm_arm_slope, EXPECTED_FIELD.third_pm_arm_slope,
            "third_pm_arm_slope", tol=self._TOL,
        )

    # --- 2B/SS DP ---

    def test_2b_dp_slope(self, fielding):
        """2B DP uses OLS on team-level DP/IP from Excel Data Model."""
        assert_slope_close(
            fielding.second_dp_slope, EXPECTED_FIELD.second_dp_slope,
            "second_dp_slope", tol=self._TOL,
        )

    def test_ss_dp_slope(self, fielding):
        """SS DP uses OLS on team-level DP/IP, first 25 of 32 players (Bug 9)."""
        assert_slope_close(
            fielding.ss_dp_slope, EXPECTED_FIELD.ss_dp_slope,
            "ss_dp_slope", tol=self._TOL,
        )

    # --- Outfield PM slopes ---

    def test_lf_pm_slope(self, fielding):
        assert_slope_close(
            fielding.lf_pm_slope, EXPECTED_FIELD.lf_pm_slope,
            "lf_pm_slope", tol=self._TOL,
        )

    def test_cf_pm_slope(self, fielding):
        assert_slope_close(
            fielding.cf_pm_slope, EXPECTED_FIELD.cf_pm_slope,
            "cf_pm_slope", tol=self._TOL,
        )

    def test_rf_pm_slope(self, fielding):
        assert_slope_close(
            fielding.rf_pm_slope, EXPECTED_FIELD.rf_pm_slope,
            "rf_pm_slope", tol=self._TOL,
        )

    # --- Outfield ERR slopes (E/PO formula) ---

    def test_lf_err_slope(self, fielding):
        assert_slope_close(
            fielding.lf_err_slope, EXPECTED_FIELD.lf_err_slope,
            "lf_err_slope", tol=self._TOL,
        )

    def test_cf_err_slope(self, fielding):
        assert_slope_close(
            fielding.cf_err_slope, EXPECTED_FIELD.cf_err_slope,
            "cf_err_slope", tol=self._TOL,
        )

    def test_rf_err_slope(self, fielding):
        assert_slope_close(
            fielding.rf_err_slope, EXPECTED_FIELD.rf_err_slope,
            "rf_err_slope", tol=self._TOL,
        )

    # --- Outfield ARM slopes (arm/PA formula) ---

    def test_lf_arm_slope(self, fielding):
        assert_slope_close(
            fielding.lf_arm_slope, EXPECTED_FIELD.lf_arm_slope,
            "lf_arm_slope", tol=self._TOL,
        )

    def test_cf_arm_slope(self, fielding):
        assert_slope_close(
            fielding.cf_arm_slope, EXPECTED_FIELD.cf_arm_slope,
            "cf_arm_slope", tol=self._TOL,
        )

    def test_rf_arm_slope(self, fielding):
        assert_slope_close(
            fielding.rf_arm_slope, EXPECTED_FIELD.rf_arm_slope,
            "rf_arm_slope", tol=self._TOL,
        )


# ===========================================================================
# 8. Caching Tests
# ===========================================================================


class TestCaching:
    """Cache roundtrip and invalidation."""

    def test_cache_roundtrip(self, tmp_path, all_coeffs):
        """Write cache, read back, compare coefficients."""
        from src.regressions import _coeffs_from_dict, _coeffs_to_dict

        hitting, pitching, fielding = all_coeffs
        d = _coeffs_to_dict(hitting, pitching, fielding)
        h2, p2, f2 = _coeffs_from_dict(d)

        # Spot-check a few values
        assert h2.eye.h_slope == hitting.eye.h_slope
        assert p2.sp_con.l_slope == pitching.sp_con.l_slope
        assert f2.c_frm_slope == fielding.c_frm_slope

    def test_generate_creates_cache(self, tmp_path):
        """generate_regression_coefficients should create a cache file."""
        import shutil
        # Copy CSV files to tmp_path
        src_dir = DATA_DIR
        for f in src_dir.glob("*.csv"):
            shutil.copy(f, tmp_path / f.name)
        # Copy expected dir
        exp_src = src_dir / "expected"
        if exp_src.exists():
            exp_dst = tmp_path / "expected"
            shutil.copytree(exp_src, exp_dst)

        h, p, f = generate_regression_coefficients(tmp_path, use_cache=True)
        cache_path = tmp_path / ".regressions_cache.json"
        assert cache_path.exists()

        # Second call should use cache (verified by same result)
        h2, p2, f2 = generate_regression_coefficients(tmp_path, use_cache=True)
        assert h2.eye.h_slope == h.eye.h_slope


# ===========================================================================
# 9. End-to-End Tests
# ===========================================================================


class TestEndToEnd:
    """Full pipeline integration tests."""

    def test_compute_regressions_returns_tuple(self, all_coeffs):
        hitting, pitching, fielding = all_coeffs
        assert isinstance(hitting, HittingRegressionCoeffs)
        assert isinstance(pitching, PitchingRegressionCoeffs)
        assert isinstance(fielding, FieldingRegressionCoeffs)

    def test_all_hitting_fields_finite(self, hitting):
        for stat in ("eye", "power", "k", "babip", "gap", "speed"):
            coeffs = getattr(hitting, stat)
            for field in ("h_const", "h_slope", "l_const", "l_slope"):
                val = getattr(coeffs, field)
                assert np.isfinite(val), f"hit.{stat}.{field} is not finite: {val}"

    def test_all_pitching_linear_finite(self, pitching):
        for stat in ("sp_con", "sp_hrr", "sp_stu", "sp_babip",
                      "rp_con", "rp_hrr", "rp_stu", "rp_babip"):
            coeffs = getattr(pitching, stat)
            for field in ("h_const", "h_slope", "l_const", "l_slope"):
                val = getattr(coeffs, field)
                assert np.isfinite(val), f"pitch.{stat}.{field} is not finite: {val}"

    def test_all_pitching_cubic_finite(self, pitching):
        for stat in ("sba", "sp_sb_pct", "rp_sb_pct"):
            coeffs = getattr(pitching, stat)
            for field in ("c0", "c1", "c2", "c3"):
                val = getattr(coeffs, field)
                assert np.isfinite(val), f"pitch.{stat}.{field} is not finite: {val}"

    def test_all_fielding_finite(self, fielding):
        for key, val in dataclasses.asdict(fielding).items():
            assert np.isfinite(val), f"field.{key} is not finite: {val}"
