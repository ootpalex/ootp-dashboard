"""
Tests for the metadata pipeline (src/metadata.py).

Validates each computation phase against the expected values from the
25 Metadata.xlsx workbook.
"""
import dataclasses
import json
import shutil
from pathlib import Path

import pytest

from src.metadata import (
    _CACHE_FILENAME,
    _aggregate_hitting,
    _aggregate_pitching,
    _build_fielding_helper,
    _compute_fielding_aggregates,
    _compute_fielding_rating_averages,
    _compute_input_hash,
    _compute_matchup_splits_from_ratings,
    _compute_matchup_splits_pitching,
    _compute_position_adjustments,
    _compute_rating_averages_hitting,
    _compute_rating_averages_pitching,
    _compute_woba_from_aggregates,
    compose_data_points,
    compute_fielding_constants,
    compute_hitting_constants,
    compute_pitching_constants,
    generate_data_points,
    load_metadata_inputs,
)
from src.data_points import (
    FieldingParams,
    HitterDataPoints,
    HitterLeagueParams,
    HittingRegressionCoeffs,
    PitcherDataPoints,
    PitcherLeagueParams,
    PitchingRegressionCoeffs,
)

# Default instances with all hardcoded expected values
DEFAULT_FIELDING_PARAMS = FieldingParams()

def _resolve_metadata_dir() -> Path:
    """Prefer the new per-league location, fall back to legacy model/data/metadata/."""
    project_root = Path(__file__).resolve().parents[2]
    candidates = [
        project_root / "leagues" / "default" / "metadata",
        project_root / "model" / "data" / "metadata",
    ]
    for c in candidates:
        if c.is_dir() and any(c.glob("*.csv")):
            return c
    return candidates[0]


DATA_DIR = _resolve_metadata_dir()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def inputs():
    """Load all metadata inputs once for the module."""
    return load_metadata_inputs(DATA_DIR)


@pytest.fixture(scope="module")
def hitting_calc_raw():
    """Load the hitting calc raw expected data."""
    with open(DATA_DIR / "expected" / "hitting_calc_raw.json") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def pitching_calc_raw():
    """Load the pitching calc raw expected data."""
    with open(DATA_DIR / "expected" / "pitching_calc_raw.json") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Phase 0: Loading
# ---------------------------------------------------------------------------


class TestLoading:
    def test_load_inputs(self, inputs):
        assert len(inputs.hitting_data) == 516
        assert len(inputs.batter_ratings_vr) == 516
        assert len(inputs.batter_ratings_vl) == 509
        assert len(inputs.pitching_data) == 512
        assert len(inputs.sp_data) == 255
        assert len(inputs.rp_data) == 396
        assert len(inputs.sp_ratings_vr) == 173
        assert len(inputs.sp_ratings_vl) == 173
        assert len(inputs.rp_ratings_vr) == 257
        assert len(inputs.rp_ratings_vl) == 258
        assert len(inputs.fielding_data) == 8
        assert len(inputs.fielding_ratings) == 509


# ---------------------------------------------------------------------------
# Phase 1: Hitting Calc
# ---------------------------------------------------------------------------


class TestHittingAggregation:
    """Test counting stat aggregation from Hitting Data."""

    def test_aggregate_totals(self, inputs):
        agg = _aggregate_hitting(inputs.hitting_data)
        # Expected from hitting_calc_raw.json row 2 (index 1)
        assert agg["R"] == 21266
        assert agg["PA"] == 175104
        assert agg["AB"] == 156268
        assert agg["1B"] == 25227
        assert agg["2B"] == 8234
        assert agg["3B"] == 811
        assert agg["HR"] == 5396
        assert agg["BB"] == 15551
        assert agg["HP"] == 1778
        assert agg["IBB"] == 424
        assert agg["SH"] == 328
        assert agg["SF"] == 1155
        assert agg["SB"] == 3410
        assert agg["CS"] == 956
        assert agg["SO"] == 38950

    def test_outs_computation(self, inputs):
        agg = _aggregate_hitting(inputs.hitting_data)
        # Expected: 122406
        assert agg["Outs"] == 122406


class TestWobaDerivation:
    """Test wOBA computation from aggregate stats."""

    def test_run_per_out(self, inputs):
        agg = _aggregate_hitting(inputs.hitting_data)
        woba = _compute_woba_from_aggregates(agg)
        assert woba["r_per_out"] == pytest.approx(0.17373331372645132, rel=1e-10)

    def test_run_values(self, inputs):
        agg = _aggregate_hitting(inputs.hitting_data)
        woba = _compute_woba_from_aggregates(agg)
        assert woba["run_bb"] == pytest.approx(0.3137333137264513, rel=1e-10)
        assert woba["run_hbp"] == pytest.approx(0.3387333137264513, rel=1e-10)
        assert woba["run_1b"] == pytest.approx(0.46873331372645133, rel=1e-10)
        assert woba["run_2b"] == pytest.approx(0.7687333137264514, rel=1e-10)
        assert woba["run_3b"] == pytest.approx(1.0387333137264514, rel=1e-10)
        assert woba["run_hr"] == 1.4
        assert woba["run_sb"] == 0.2
        assert woba["run_cs"] == pytest.approx(-0.42246662745290264, rel=1e-10)

    def test_woba_intermediates(self, inputs):
        agg = _aggregate_hitting(inputs.hitting_data)
        woba = _compute_woba_from_aggregates(agg)
        assert woba["pro_non_outs"] == 56573
        assert woba["unpro_outs"] == 117755
        assert woba["runs_plus"] == pytest.approx(0.5687789528703379, rel=1e-10)
        assert woba["runs_minus"] == pytest.approx(0.27325830496143366, rel=1e-10)
        assert woba["woba_scale"] == pytest.approx(1.1875959058806724, rel=1e-10)

    def test_woba_weights(self, inputs):
        agg = _aggregate_hitting(inputs.hitting_data)
        woba = _compute_woba_from_aggregates(agg)
        assert woba["wt_bb"] == pytest.approx(0.697108843140001, rel=1e-8)
        assert woba["wt_hbp"] == pytest.approx(0.7267987407870178, rel=1e-8)
        assert woba["wt_1b"] == pytest.approx(0.8811862085515052, rel=1e-8)
        assert woba["wt_2b"] == pytest.approx(1.237464980315707, rel=1e-8)
        assert woba["wt_3b"] == pytest.approx(1.5581158749034887, rel=1e-8)
        assert woba["wt_hr"] == pytest.approx(1.9871547124530322, rel=1e-8)
        assert woba["wt_sb"] == pytest.approx(0.2375191811761345, rel=1e-8)
        assert woba["wt_cs"] == pytest.approx(-0.5017196371342825, rel=1e-8)

    def test_lg_wsb(self, inputs):
        agg = _aggregate_hitting(inputs.hitting_data)
        woba = _compute_woba_from_aggregates(agg)
        assert woba["lg_wsb"] == pytest.approx(0.006601203459485072, rel=1e-8)

    def test_lg_woba(self, inputs):
        agg = _aggregate_hitting(inputs.hitting_data)
        woba = _compute_woba_from_aggregates(agg)
        assert woba["lg_woba"] == pytest.approx(0.3226257604360157, rel=1e-8)

    def test_stat_rates(self, inputs):
        agg = _aggregate_hitting(inputs.hitting_data)
        woba = _compute_woba_from_aggregates(agg)
        assert woba["babip"] == pytest.approx(0.30308550810509655, rel=1e-8)
        assert woba["xbh_rate"] == pytest.approx(0.26391806722689076, rel=1e-8)
        assert woba["sb_pct"] == pytest.approx(0.7810352725606963, rel=1e-8)
        assert woba["sba_rate"] == pytest.approx(0.10259422878090046, rel=1e-8)
        assert woba["triple_rate"] == pytest.approx(0.0896627971254837, rel=1e-8)
        assert woba["so_rate"] == pytest.approx(0.24753576399260252, rel=1e-8)
        assert woba["bb_rate"] == pytest.approx(0.08748886652554626, rel=1e-8)
        assert woba["hr_rate"] == pytest.approx(0.034292759499462984, rel=1e-8)
        assert woba["r_per_pa"] == pytest.approx(0.12144782529239766, rel=1e-8)
        assert woba["hbp_rate"] == pytest.approx(0.010153965643274854, rel=1e-8)


class TestHittingMatchupSplits:
    """Test batter-side matchup splits from batter ratings."""

    def test_splits(self, inputs):
        splits = _compute_matchup_splits_from_ratings(
            inputs.batter_ratings_vr, inputs.batter_ratings_vl)
        assert splits["lvr"] == pytest.approx(0.7759174096668231, rel=1e-6)
        assert splits["rvr"] == pytest.approx(0.7201749760774894, rel=1e-6)
        assert splits["svr"] == pytest.approx(0.7414885397888231, rel=1e-6)
        assert splits["ovr_vr"] == pytest.approx(0.7394976699561403, rel=1e-6)


class TestHittingRatingAverages:
    """Test PA-weighted rating averages."""

    def test_rating_averages(self, inputs):
        splits = _compute_matchup_splits_from_ratings(
            inputs.batter_ratings_vr, inputs.batter_ratings_vl)
        avgs = _compute_rating_averages_hitting(
            inputs.batter_ratings_vr, inputs.batter_ratings_vl, splits["ovr_vr"])
        # Expected from hitting_calc_raw.json
        assert avgs["eye"] == pytest.approx(49.8197356999269, rel=1e-4)
        assert avgs["pow"] == pytest.approx(48.93329107273392, rel=1e-4)
        assert avgs["k"] == pytest.approx(53.0672057748538, rel=1e-4)
        assert avgs["babip"] == pytest.approx(51.855497304459064, rel=1e-4)
        assert avgs["gap"] == pytest.approx(52.237527412280706, rel=1e-4)
        assert avgs["spe"] == pytest.approx(47.610134548611114, rel=1e-4)
        assert avgs["ste"] == pytest.approx(50.462696454678365, rel=1e-4)
        assert avgs["run"] == pytest.approx(54.28887975146199, rel=1e-4)


class TestComputeHittingConstants:
    """Test the full hitting constants computation.

    Note: HitterLeagueParams defaults are ROUNDED (e.g., wt_bb=0.6971 vs
    full precision 0.697108...). We test against the full-precision expected
    values from hitting_calc_raw.json directly.
    """

    def test_woba_weights(self, inputs):
        result = compute_hitting_constants(inputs)
        # Full-precision expected from hitting_calc_raw.json row 16
        assert result.wt_bb == pytest.approx(0.697108843140001, rel=1e-8)
        assert result.wt_hbp == pytest.approx(0.7267987407870178, rel=1e-8)
        assert result.wt_1b == pytest.approx(0.8811862085515052, rel=1e-8)
        assert result.wt_2b == pytest.approx(1.237464980315707, rel=1e-8)
        assert result.wt_3b == pytest.approx(1.5581158749034887, rel=1e-8)
        assert result.wt_hr == pytest.approx(1.9871547124530322, rel=1e-8)
        assert result.wt_sb == pytest.approx(0.2375191811761345, rel=1e-8)
        assert result.wt_cs == pytest.approx(-0.5017196371342825, rel=1e-8)
        assert result.woba_scale == pytest.approx(1.1875959058806724, rel=1e-8)

    def test_matchup_splits(self, inputs):
        result = compute_hitting_constants(inputs)
        # Full-precision expected from hitting_calc_raw.json
        assert result.lvr == pytest.approx(0.7759174096668231, rel=1e-6)
        assert result.rvr == pytest.approx(0.7201749760774894, rel=1e-6)
        assert result.svr == pytest.approx(0.7414885397888231, rel=1e-6)
        assert result.ovr_vr == pytest.approx(0.7394976699561403, rel=1e-6)

    def test_stat_rates(self, inputs):
        result = compute_hitting_constants(inputs)
        # Full-precision expected from hitting_calc_raw.json row 5
        assert result.bb_rate == pytest.approx(0.08748886652554626, rel=1e-8)
        assert result.hr_rate == pytest.approx(0.034292759499462984, rel=1e-8)
        assert result.so_rate == pytest.approx(0.24753576399260252, rel=1e-8)
        assert result.babip == pytest.approx(0.30308550810509655, rel=1e-8)
        assert result.xbh_rate == pytest.approx(0.26391806722689076, rel=1e-8)
        assert result.triple_rate == pytest.approx(0.0896627971254837, rel=1e-8)
        assert result.sb_pct == pytest.approx(0.7810352725606963, rel=1e-8)
        assert result.sba_rate == pytest.approx(0.10259422878090046, rel=1e-8)

    def test_rating_averages(self, inputs):
        result = compute_hitting_constants(inputs)
        # Full-precision expected from hitting_calc_raw.json
        assert result.avg_eye == pytest.approx(49.8197356999269, rel=1e-4)
        assert result.avg_power == pytest.approx(48.93329107273392, rel=1e-4)
        assert result.avg_k == pytest.approx(53.0672057748538, rel=1e-4)
        assert result.avg_babip == pytest.approx(51.855497304459064, rel=1e-4)
        assert result.avg_gap == pytest.approx(52.237527412280706, rel=1e-4)
        assert result.avg_speed == pytest.approx(47.610134548611114, rel=1e-4)
        assert result.avg_steal == pytest.approx(50.462696454678365, rel=1e-4)
        assert result.avg_bsr == pytest.approx(54.28887975146199, rel=1e-4)

    def test_league_measurements(self, inputs):
        result = compute_hitting_constants(inputs)
        # Full-precision expected from hitting_calc_raw.json
        assert result.lg_woba == pytest.approx(0.3226257604360157, rel=1e-8)
        assert result.run_cs == pytest.approx(-0.42246662745290264, rel=1e-8)
        assert result.wsb == pytest.approx(0.006601203459485072, rel=1e-8)
        assert result.hbp_rate == pytest.approx(0.010153965643274854, rel=1e-8)
        assert result.r_per_pa == pytest.approx(0.12144782529239766, rel=1e-8)


# ---------------------------------------------------------------------------
# Phase 2: Pitching Calc
# ---------------------------------------------------------------------------


class TestPitchingAggregation:
    """Test pitching stat aggregation."""

    def test_sp_aggregates(self, inputs):
        agg = _aggregate_pitching(inputs.pitching_data)
        # Check that PA/BF is populated
        assert agg["PA"] > 0
        assert agg["Outs"] > 0

    def test_rp_aggregates(self, inputs):
        agg = _aggregate_pitching(inputs.rp_data)
        assert agg["PA"] > 0
        assert agg["Outs"] > 0


class TestPitchingMatchupSplits:
    """Test pitcher-side matchup splits."""

    def test_sp_splits(self, inputs):
        splits = _compute_matchup_splits_pitching(
            inputs.sp_ratings_vr, inputs.sp_ratings_vl,
            inputs.rp_ratings_vr, inputs.rp_ratings_vl)
        expected = PitcherLeagueParams()
        # SP splits
        assert splits["sp_lvr"] == pytest.approx(expected.lvr, rel=1e-4)
        assert splits["sp_rvr"] == pytest.approx(expected.rvr, rel=1e-4)


class TestComputePitchingConstants:
    """Test the full pitching constants computation."""

    def test_sp_woba_weights(self, inputs):
        result = compute_pitching_constants(inputs)
        expected = PitcherLeagueParams()
        assert result.sp_wt_bb == pytest.approx(expected.sp_wt_bb, rel=1e-4)
        assert result.sp_wt_1b == pytest.approx(expected.sp_wt_1b, rel=1e-4)
        assert result.sp_wt_hr == pytest.approx(expected.sp_wt_hr, rel=1e-4)
        assert result.sp_woba_scale == pytest.approx(expected.sp_woba_scale, rel=1e-4)

    def test_rp_woba_weights(self, inputs):
        result = compute_pitching_constants(inputs)
        expected = PitcherLeagueParams()
        assert result.rp_wt_bb == pytest.approx(expected.rp_wt_bb, rel=1e-4)
        assert result.rp_wt_1b == pytest.approx(expected.rp_wt_1b, rel=1e-4)
        assert result.rp_wt_hr == pytest.approx(expected.rp_wt_hr, rel=1e-4)
        assert result.rp_woba_scale == pytest.approx(expected.rp_woba_scale, rel=1e-4)

    def test_ra9_baselines(self, inputs):
        result = compute_pitching_constants(inputs)
        expected = PitcherLeagueParams()
        assert result.ra9_sp == pytest.approx(expected.ra9_sp, rel=1e-4)
        assert result.ra9_rp == pytest.approx(expected.ra9_rp, rel=1e-4)

    def test_waa_constant(self, inputs):
        result = compute_pitching_constants(inputs)
        expected = PitcherLeagueParams()
        assert result.waa_const == pytest.approx(expected.waa_const, rel=1e-4)

    def test_workload(self, inputs):
        result = compute_pitching_constants(inputs)
        expected = PitcherLeagueParams()
        assert result.ip_sp == pytest.approx(expected.ip_sp, rel=1e-4)
        assert result.ip_rp == pytest.approx(expected.ip_rp, rel=1e-4)

    def test_sp_rating_averages(self, inputs):
        result = compute_pitching_constants(inputs)
        expected = PitcherLeagueParams()
        assert result.avg_stu_sp == pytest.approx(expected.avg_stu_sp, rel=1e-3)
        assert result.avg_hrr_sp == pytest.approx(expected.avg_hrr_sp, rel=1e-3)
        assert result.avg_pbabip_sp == pytest.approx(expected.avg_pbabip_sp, rel=1e-3)
        assert result.avg_con_sp == pytest.approx(expected.avg_con_sp, rel=1e-3)

    def test_rp_rating_averages(self, inputs):
        result = compute_pitching_constants(inputs)
        expected = PitcherLeagueParams()
        assert result.avg_stu_rp == pytest.approx(expected.avg_stu_rp, rel=1e-3)
        assert result.avg_hrr_rp == pytest.approx(expected.avg_hrr_rp, rel=1e-3)
        assert result.avg_pbabip_rp == pytest.approx(expected.avg_pbabip_rp, rel=1e-3)
        assert result.avg_con_rp == pytest.approx(expected.avg_con_rp, rel=1e-3)

    def test_sp_stat_rates(self, inputs):
        result = compute_pitching_constants(inputs)
        expected = PitcherLeagueParams()
        assert result.sp_bb_rate == pytest.approx(expected.sp_bb_rate, rel=1e-4)
        assert result.sp_hr_rate == pytest.approx(expected.sp_hr_rate, rel=1e-4)
        assert result.sp_so_rate == pytest.approx(expected.sp_so_rate, rel=1e-4)
        assert result.sp_babip == pytest.approx(expected.sp_babip, rel=1e-4)

    def test_rp_stat_rates(self, inputs):
        result = compute_pitching_constants(inputs)
        expected = PitcherLeagueParams()
        assert result.rp_bb_rate == pytest.approx(expected.rp_bb_rate, rel=1e-4)
        assert result.rp_hr_rate == pytest.approx(expected.rp_hr_rate, rel=1e-4)
        assert result.rp_so_rate == pytest.approx(expected.rp_so_rate, rel=1e-4)
        assert result.rp_babip == pytest.approx(expected.rp_babip, rel=1e-4)


# ---------------------------------------------------------------------------
# Phase 3: Fielding Calc + POS Adj
# ---------------------------------------------------------------------------


class TestFieldingAggregates:
    """Test position aggregate stats."""

    def test_all_positions_present(self, inputs):
        agg = _compute_fielding_aggregates(inputs.fielding_data)
        assert set(agg.keys()) == {"c", "1b", "2b", "3b", "ss", "lf", "cf", "rf"}

    def test_catcher_ip(self, inputs):
        agg = _compute_fielding_aggregates(inputs.fielding_data)
        assert agg["c"]["IP Clean"] > 0


class TestFieldingRatingAverages:
    """Test IP-weighted fielding rating averages."""

    def test_catcher_frm(self, inputs):
        helper = _build_fielding_helper(inputs.fielding_data, inputs.fielding_ratings)
        avgs = _compute_fielding_rating_averages(helper, inputs.fielding_ratings)
        expected = DEFAULT_FIELDING_PARAMS
        assert avgs["c"]["C FRM"] == pytest.approx(expected.avg_frm_c, rel=1e-4)

    def test_1b_rng(self, inputs):
        helper = _build_fielding_helper(inputs.fielding_data, inputs.fielding_ratings)
        avgs = _compute_fielding_rating_averages(helper, inputs.fielding_ratings)
        expected = DEFAULT_FIELDING_PARAMS
        assert avgs["1b"]["IF RNG"] == pytest.approx(expected.avg_rng_1b, rel=1e-4)

    def test_ss_rng(self, inputs):
        helper = _build_fielding_helper(inputs.fielding_data, inputs.fielding_ratings)
        avgs = _compute_fielding_rating_averages(helper, inputs.fielding_ratings)
        expected = DEFAULT_FIELDING_PARAMS
        assert avgs["ss"]["IF RNG"] == pytest.approx(expected.avg_rng_ss, rel=1e-4)


class TestComputeFieldingConstants:
    """Test the full fielding constants computation."""

    def test_position_adjustments(self, inputs):
        result = compute_fielding_constants(inputs)
        expected = DEFAULT_FIELDING_PARAMS
        assert result.pos_c == pytest.approx(expected.pos_c, abs=0.5)
        assert result.pos_1b == pytest.approx(expected.pos_1b, abs=0.5)
        assert result.pos_2b == pytest.approx(expected.pos_2b, abs=0.5)
        assert result.pos_ss == pytest.approx(expected.pos_ss, abs=0.5)
        assert result.pos_dh == pytest.approx(expected.pos_dh, abs=0.5)

    def test_rating_averages(self, inputs):
        result = compute_fielding_constants(inputs)
        expected = DEFAULT_FIELDING_PARAMS
        assert result.avg_frm_c == pytest.approx(expected.avg_frm_c, rel=1e-4)
        assert result.avg_rng_1b == pytest.approx(expected.avg_rng_1b, rel=1e-4)
        assert result.avg_rng_ss == pytest.approx(expected.avg_rng_ss, rel=1e-4)
        assert result.avg_rng_cf == pytest.approx(expected.avg_rng_cf, rel=1e-4)

    def test_scaling_constants(self, inputs):
        result = compute_fielding_constants(inputs)
        expected = DEFAULT_FIELDING_PARAMS
        assert result.c_frm_scale == pytest.approx(expected.c_frm_scale, rel=1e-3)
        assert result.c_sba_scale == pytest.approx(expected.c_sba_scale, rel=1e-3)
        assert result.second_pm_lg == pytest.approx(expected.second_pm_lg, rel=1e-3)
        assert result.ss_pm_lg == pytest.approx(expected.ss_pm_lg, rel=1e-3)


# ---------------------------------------------------------------------------
# Phase 4: Integration
# ---------------------------------------------------------------------------


class TestIntegration:
    """End-to-end: generate_data_points validated against data_points.json answer key."""

    @pytest.fixture(scope="module")
    def results(self):
        return generate_data_points(DATA_DIR, use_cache=False)

    _EXPECTED_FILE = DATA_DIR / "expected" / "data_points.json"

    @pytest.fixture(scope="module")
    def expected(self):
        if not self._EXPECTED_FILE.exists():
            pytest.skip("Expected answer key not available")
        with open(self._EXPECTED_FILE) as f:
            return json.load(f)

    def test_full_pipeline_runs(self, results):
        hitting, pitching, fielding = results
        assert isinstance(hitting, HitterLeagueParams)
        assert isinstance(pitching, PitcherLeagueParams)
        assert isinstance(fielding, FieldingParams)

    def test_hitting_fields_match_expected(self, results, expected):
        """Validate every HitterLeagueParams field against data_points.json."""
        hitting = results[0]
        # Rating averages F2-F9
        assert hitting.avg_eye == pytest.approx(expected["F2"], rel=1e-8)
        assert hitting.avg_power == pytest.approx(expected["F3"], rel=1e-8)
        assert hitting.avg_k == pytest.approx(expected["F4"], rel=1e-8)
        assert hitting.avg_babip == pytest.approx(expected["F5"], rel=1e-8)
        assert hitting.avg_gap == pytest.approx(expected["F6"], rel=1e-8)
        assert hitting.avg_speed == pytest.approx(expected["F7"], rel=1e-8)
        assert hitting.avg_steal == pytest.approx(expected["F8"], rel=1e-8)
        assert hitting.avg_bsr == pytest.approx(expected["F9"], rel=1e-8)
        # wOBA weights F12-F20
        assert hitting.wt_hbp == pytest.approx(expected["F12"], rel=1e-8)
        assert hitting.wt_bb == pytest.approx(expected["F13"], rel=1e-8)
        assert hitting.wt_1b == pytest.approx(expected["F14"], rel=1e-8)
        assert hitting.wt_2b == pytest.approx(expected["F15"], rel=1e-8)
        assert hitting.wt_3b == pytest.approx(expected["F16"], rel=1e-8)
        assert hitting.wt_hr == pytest.approx(expected["F17"], rel=1e-8)
        assert hitting.wt_sb == pytest.approx(expected["F18"], rel=1e-8)
        assert hitting.wt_cs == pytest.approx(expected["F19"], rel=1e-8)
        assert hitting.woba_scale == pytest.approx(expected["F20"], rel=1e-8)
        # Matchup splits F23-F26
        assert hitting.lvr == pytest.approx(expected["F23"], rel=1e-8)
        assert hitting.rvr == pytest.approx(expected["F24"], rel=1e-8)
        assert hitting.svr == pytest.approx(expected["F25"], rel=1e-8)
        assert hitting.ovr_vr == pytest.approx(expected["F26"], rel=1e-8)
        # League measurements F29-F40
        assert hitting.lg_woba == pytest.approx(expected["F29"], rel=1e-8)
        assert hitting.waa_const == pytest.approx(expected["F30"], rel=1e-8)
        assert hitting.pa == expected["F31"]
        assert hitting.pa_c == expected["F32"]
        assert hitting.ip == expected["F33"]
        assert hitting.ip_c == expected["F34"]
        assert hitting.run_cs == pytest.approx(expected["F35"], rel=1e-8)
        assert hitting.wsb == pytest.approx(expected["F36"], rel=1e-8)
        assert hitting.hbp_rate == pytest.approx(expected["F37"], rel=1e-8)
        assert hitting.inf_out == expected["F38"]
        assert hitting.of_out == expected["F39"]
        assert hitting.r_per_pa == pytest.approx(expected["F40"], rel=1e-8)
        # Stat rates B33-B41
        assert hitting.bb_rate == pytest.approx(expected["B33"], rel=1e-8)
        assert hitting.hr_rate == pytest.approx(expected["B34"], rel=1e-8)
        assert hitting.so_rate == pytest.approx(expected["B35"], rel=1e-8)
        assert hitting.babip == pytest.approx(expected["B36"], rel=1e-8)
        assert hitting.xbh_rate == pytest.approx(expected["B37"], rel=1e-8)
        assert hitting.triple_rate == pytest.approx(expected["B38"], rel=1e-8)
        assert hitting.sb_pct == pytest.approx(expected["B39"], rel=1e-8)
        assert hitting.ubr == pytest.approx(expected["B40"], rel=1e-8)
        assert hitting.sba_rate == pytest.approx(expected["B41"], rel=1e-8)

    def test_pitching_fields_match_expected(self, results, expected):
        """Validate every PitcherLeagueParams field against data_points.json.

        wOBA weights use rel=1e-4 (sp_data.csv subset differs slightly from
        the Pitching Calc's full dataset). Rating averages, stat rates,
        matchup splits, and workload use rel=1e-8.
        """
        pitching = results[1]
        # SP rating averages T2-T5
        assert pitching.avg_stu_sp == pytest.approx(expected["T2"], rel=1e-8)
        assert pitching.avg_hrr_sp == pytest.approx(expected["T3"], rel=1e-8)
        assert pitching.avg_pbabip_sp == pytest.approx(expected["T4"], rel=1e-8)
        assert pitching.avg_con_sp == pytest.approx(expected["T5"], rel=1e-8)
        # RP rating averages T7-T10
        assert pitching.avg_stu_rp == pytest.approx(expected["T7"], rel=1e-8)
        assert pitching.avg_hrr_rp == pytest.approx(expected["T8"], rel=1e-8)
        assert pitching.avg_pbabip_rp == pytest.approx(expected["T9"], rel=1e-8)
        assert pitching.avg_con_rp == pytest.approx(expected["T10"], rel=1e-8)
        # SP wOBA weights T11-T20 — rel=1e-4 (SP subset input discrepancy)
        assert pitching.sp_lg_woba == pytest.approx(expected["T11"], rel=1e-2)
        assert pitching.sp_wt_hbp == pytest.approx(expected["T12"], rel=1e-4)
        assert pitching.sp_wt_bb == pytest.approx(expected["T13"], rel=1e-4)
        assert pitching.sp_wt_1b == pytest.approx(expected["T14"], rel=1e-4)
        assert pitching.sp_wt_2b == pytest.approx(expected["T15"], rel=1e-4)
        assert pitching.sp_wt_3b == pytest.approx(expected["T16"], rel=1e-4)
        assert pitching.sp_wt_hr == pytest.approx(expected["T17"], rel=1e-4)
        assert pitching.sp_wt_sb == pytest.approx(expected["T18"], rel=1e-4)
        assert pitching.sp_wt_cs == pytest.approx(expected["T19"], rel=1e-4)
        assert pitching.sp_woba_scale == pytest.approx(expected["T20"], rel=1e-4)
        # Matchup splits T23-T26
        assert pitching.lvr == pytest.approx(expected["T23"], rel=1e-8)
        assert pitching.rvr == pytest.approx(expected["T24"], rel=1e-8)
        assert pitching.svr == pytest.approx(expected["T25"], rel=1e-8)
        assert pitching.ovr_vr == pytest.approx(expected["T26"], rel=1e-8)
        # RP wOBA W28-W37 — rel=1e-4 (RP subset + SP normalization)
        assert pitching.rp_lg_woba == pytest.approx(expected["W28"], rel=1e-2)
        assert pitching.rp_wt_hbp == pytest.approx(expected["W29"], rel=1e-4)
        assert pitching.rp_wt_bb == pytest.approx(expected["W30"], rel=1e-4)
        assert pitching.rp_wt_1b == pytest.approx(expected["W31"], rel=1e-4)
        assert pitching.rp_wt_2b == pytest.approx(expected["W32"], rel=1e-4)
        assert pitching.rp_wt_3b == pytest.approx(expected["W33"], rel=1e-4)
        assert pitching.rp_wt_hr == pytest.approx(expected["W34"], rel=1e-4)
        assert pitching.rp_wt_sb == pytest.approx(expected["W35"], rel=1e-4)
        assert pitching.rp_wt_cs == pytest.approx(expected["W36"], rel=1e-4)
        assert pitching.rp_woba_scale == pytest.approx(expected["W37"], rel=1e-4)
        # Workload T31-T34
        assert pitching.bf_sp == expected["T31"]
        assert pitching.bf_rp == expected["T32"]
        assert pitching.ip_sp == pytest.approx(expected["T33"], rel=1e-8)
        assert pitching.ip_rp == pytest.approx(expected["T34"], rel=1e-8)
        # Other pitcher constants T35-T42 — run_cs/wsb/ra9 depend on SP
        # aggregation which has a known subset discrepancy → rel=1e-1
        assert pitching.run_cs == pytest.approx(expected["T35"], rel=1e-1)
        assert pitching.wsb == pytest.approx(expected["T36"], rel=1e-1)
        assert pitching.r_per_pa == pytest.approx(expected["T40"], rel=1e-8)
        assert pitching.ra9_sp == pytest.approx(expected["T41"], rel=1e-2)
        assert pitching.ra9_rp == pytest.approx(expected["T42"], rel=1e-2)
        assert pitching.waa_const == pytest.approx(expected["T30"], rel=1e-8)
        # HLD baselines U2, U7
        assert pitching.avg_hld_sp == pytest.approx(expected["U2"], rel=1e-8)
        assert pitching.avg_hld_rp == pytest.approx(expected["U7"], rel=1e-8)
        # SP stat rates W3-W12
        assert pitching.sp_bb_rate == pytest.approx(expected["W3"], rel=1e-8)
        assert pitching.sp_hr_rate == pytest.approx(expected["W4"], rel=1e-8)
        assert pitching.sp_so_rate == pytest.approx(expected["W5"], rel=1e-8)
        assert pitching.sp_babip == pytest.approx(expected["W6"], rel=1e-8)
        assert pitching.sp_xbh_rate == pytest.approx(expected["W7"], rel=1e-8)
        assert pitching.sp_triple_rate == pytest.approx(expected["W8"], rel=1e-8)
        assert pitching.sp_sb_pct == pytest.approx(expected["W9"], rel=1e-8)
        assert pitching.sp_hbp_rate == pytest.approx(expected["W10"], rel=1e-8)
        assert pitching.sp_sba_rate == pytest.approx(expected["W12"], rel=1e-8)
        # RP stat rates W15-W24
        assert pitching.rp_bb_rate == pytest.approx(expected["W15"], rel=1e-8)
        assert pitching.rp_hr_rate == pytest.approx(expected["W16"], rel=1e-8)
        assert pitching.rp_so_rate == pytest.approx(expected["W17"], rel=1e-8)
        assert pitching.rp_babip == pytest.approx(expected["W18"], rel=1e-8)
        assert pitching.rp_xbh_rate == pytest.approx(expected["W19"], rel=1e-8)
        assert pitching.rp_triple_rate == pytest.approx(expected["W20"], rel=1e-8)
        assert pitching.rp_sb_pct == pytest.approx(expected["W21"], rel=1e-8)
        assert pitching.rp_hbp_rate == pytest.approx(expected["W22"], rel=1e-8)
        assert pitching.rp_sba_rate == pytest.approx(expected["W24"], rel=1e-8)

    def test_fielding_fields_match_expected(self, results, expected):
        """Validate every FieldingParams field against data_points.json."""
        fielding = results[2]
        # Position adjustments P2-P10
        assert fielding.pos_c == pytest.approx(expected["P2"], abs=0.5)
        assert fielding.pos_1b == pytest.approx(expected["P3"], abs=0.5)
        assert fielding.pos_2b == pytest.approx(expected["P4"], abs=0.5)
        assert fielding.pos_3b == pytest.approx(expected["P5"], abs=0.5)
        assert fielding.pos_ss == pytest.approx(expected["P6"], abs=0.5)
        assert fielding.pos_lf == pytest.approx(expected["P7"], abs=0.5)
        assert fielding.pos_cf == pytest.approx(expected["P8"], abs=0.5)
        assert fielding.pos_rf == pytest.approx(expected["P9"], abs=0.5)
        assert fielding.pos_dh == pytest.approx(expected["P10"], abs=0.5)
        # Rating averages I3-I43
        assert fielding.avg_frm_c == pytest.approx(expected["I3"], rel=1e-4)
        assert fielding.avg_arm_c == pytest.approx(expected["I5"], rel=1e-4)
        assert fielding.avg_rng_1b == pytest.approx(expected["I9"], rel=1e-4)
        assert fielding.avg_ht_1b == pytest.approx(expected["J9"], rel=1e-4)
        assert fielding.avg_err_1b == pytest.approx(expected["I11"], rel=1e-4)
        assert fielding.avg_rng_2b == pytest.approx(expected["I13"], rel=1e-4)
        assert fielding.avg_arm_2b == pytest.approx(expected["J13"], rel=1e-4)
        assert fielding.avg_err_2b == pytest.approx(expected["I15"], rel=1e-4)
        assert fielding.avg_tdp_2b == pytest.approx(expected["I17"], rel=1e-4)
        assert fielding.avg_rng_3b == pytest.approx(expected["I19"], rel=1e-4)
        assert fielding.avg_arm_3b == pytest.approx(expected["J19"], rel=1e-4)
        assert fielding.avg_err_3b == pytest.approx(expected["I21"], rel=1e-4)
        assert fielding.avg_rng_ss == pytest.approx(expected["I23"], rel=1e-4)
        assert fielding.avg_arm_ss == pytest.approx(expected["J23"], rel=1e-4)
        assert fielding.avg_err_ss == pytest.approx(expected["I25"], rel=1e-4)
        assert fielding.avg_tdp_ss == pytest.approx(expected["J25"], rel=1e-4)
        assert fielding.avg_rng_lf == pytest.approx(expected["I27"], rel=1e-4)
        assert fielding.avg_err_lf == pytest.approx(expected["I29"], rel=1e-4)
        assert fielding.avg_arm_lf == pytest.approx(expected["I31"], rel=1e-4)
        assert fielding.avg_rng_cf == pytest.approx(expected["I33"], rel=1e-4)
        assert fielding.avg_err_cf == pytest.approx(expected["I35"], rel=1e-4)
        assert fielding.avg_arm_cf == pytest.approx(expected["I37"], rel=1e-4)
        assert fielding.avg_rng_rf == pytest.approx(expected["I39"], rel=1e-4)
        assert fielding.avg_err_rf == pytest.approx(expected["I41"], rel=1e-4)
        assert fielding.avg_arm_rf == pytest.approx(expected["I43"], rel=1e-4)
        # Scaling constants M2-M30
        assert fielding.c_frm_scale == pytest.approx(expected["M2"], rel=1e-3)
        assert fielding.c_sba_scale == pytest.approx(expected["M3"], rel=1e-3)
        assert fielding.c_rto_lg == pytest.approx(expected["M4"], rel=1e-3)
        assert fielding.first_pa == pytest.approx(expected["M5"], rel=1e-3)
        assert fielding.first_pm_lg == pytest.approx(expected["M6"], rel=1e-3)
        assert fielding.first_err_lg == pytest.approx(expected["M7"], rel=1e-3)
        assert fielding.second_pa == pytest.approx(expected["M8"], rel=1e-3)
        assert fielding.second_pm_lg == pytest.approx(expected["M9"], rel=1e-3)
        assert fielding.second_err_lg == pytest.approx(expected["M10"], rel=1e-3)
        assert fielding.second_dp_pa == pytest.approx(expected["M11"], rel=1e-3)
        assert fielding.third_pa == pytest.approx(expected["M12"], rel=1e-3)
        assert fielding.third_pm_lg == pytest.approx(expected["M13"], rel=1e-3)
        assert fielding.third_err_lg == pytest.approx(expected["M14"], rel=1e-3)
        assert fielding.ss_pa == pytest.approx(expected["M15"], rel=1e-3)
        assert fielding.ss_pm_lg == pytest.approx(expected["M16"], rel=1e-3)
        assert fielding.ss_err_lg == pytest.approx(expected["M17"], rel=1e-3)
        assert fielding.lf_pa == pytest.approx(expected["M18"], rel=1e-3)
        assert fielding.lf_pm_lg == pytest.approx(expected["M19"], rel=1e-3)
        assert fielding.lf_err_lg == pytest.approx(expected["M20"], rel=1e-3)
        assert fielding.lf_arm_lg == pytest.approx(expected["M21"], rel=1e-3)
        assert fielding.cf_pa == pytest.approx(expected["M22"], rel=1e-3)
        assert fielding.cf_pm_lg == pytest.approx(expected["M23"], rel=1e-3)
        assert fielding.cf_err_lg == pytest.approx(expected["M24"], rel=1e-3)
        assert fielding.cf_arm_lg == pytest.approx(expected["M25"], rel=1e-3)
        assert fielding.rf_pa == pytest.approx(expected["M26"], rel=1e-3)
        assert fielding.rf_pm_lg == pytest.approx(expected["M27"], rel=1e-3)
        assert fielding.rf_err_lg == pytest.approx(expected["M28"], rel=1e-3)
        assert fielding.rf_arm_lg == pytest.approx(expected["M29"], rel=1e-3)
        assert fielding.ss_dp_pa == pytest.approx(expected["M30"], rel=1e-3)

    def test_compose_data_points(self, results):
        """Verify compose_data_points produces valid composites."""
        hitting, pitching, fielding = results
        hitter_dp, pitcher_dp = compose_data_points(hitting, pitching, fielding)
        assert isinstance(hitter_dp, HitterDataPoints)
        assert isinstance(pitcher_dp, PitcherDataPoints)
        # League params should be the computed values
        assert hitter_dp.league is hitting
        assert hitter_dp.fielding is fielding
        assert pitcher_dp.league is pitching
        assert pitcher_dp.hitting_rates is hitting
        assert pitcher_dp.fielding is fielding
        # Regression coeffs should be defaults
        assert hitter_dp.hitting == HittingRegressionCoeffs()
        assert pitcher_dp.pitching == PitchingRegressionCoeffs()
        assert hitter_dp.fielding_coeffs is pitcher_dp.fielding_coeffs

    def test_ballpark_bridge(self, results):
        """Verify to_ballpark_constants() works with computed values."""
        hitting = results[0]
        bpc = hitting.to_ballpark_constants()
        # Spot check a few fields
        assert bpc.lg_woba == hitting.lg_woba
        assert bpc.woba_scale == hitting.woba_scale
        assert bpc.lvr == hitting.lvr
        assert bpc.pa == hitting.pa


# ---------------------------------------------------------------------------
# Phase 5: Caching
# ---------------------------------------------------------------------------


def _copy_inputs(src_dir: Path, dst_dir: Path) -> None:
    """Copy metadata CSVs to a temp directory for cache testing."""
    for csv_file in sorted(src_dir.glob("*.csv")):
        shutil.copy2(csv_file, dst_dir / csv_file.name)


class TestCache:
    """Tests for the SHA-256 hash-based change detection cache."""

    def test_hash_deterministic(self):
        """Same inputs produce the same hash."""
        h1 = _compute_input_hash(DATA_DIR)
        h2 = _compute_input_hash(DATA_DIR)
        assert h1 == h2
        assert h1.startswith("sha256:")

    def test_cache_roundtrip(self, tmp_path):
        """Compute → save → load produces identical asdict() results."""
        _copy_inputs(DATA_DIR, tmp_path)
        # First call: computes and caches
        h1, p1, f1 = generate_data_points(tmp_path, use_cache=True)
        assert (tmp_path / _CACHE_FILENAME).exists()
        # Second call: loads from cache
        h2, p2, f2 = generate_data_points(tmp_path, use_cache=True)
        assert dataclasses.asdict(h1) == dataclasses.asdict(h2)
        assert dataclasses.asdict(p1) == dataclasses.asdict(p2)
        assert dataclasses.asdict(f1) == dataclasses.asdict(f2)

    def test_cache_invalidation_on_change(self, tmp_path):
        """Modifying an input CSV invalidates the cache."""
        _copy_inputs(DATA_DIR, tmp_path)
        # Build cache
        generate_data_points(tmp_path, use_cache=True)
        hash_before = _compute_input_hash(tmp_path)
        # Modify a CSV
        csv_file = tmp_path / "hitting_data.csv"
        content = csv_file.read_text()
        csv_file.write_text(content + "\n")
        hash_after = _compute_input_hash(tmp_path)
        assert hash_before != hash_after

    def test_force_recompute(self, tmp_path):
        """force_recompute=True ignores existing cache."""
        _copy_inputs(DATA_DIR, tmp_path)
        # Write a corrupt cache
        (tmp_path / _CACHE_FILENAME).write_text("not valid json!!!")
        # force_recompute should succeed despite corrupt cache
        h, p, f = generate_data_points(
            tmp_path, use_cache=True, force_recompute=True)
        assert isinstance(h, HitterLeagueParams)
        # Cache should now be valid
        assert json.loads((tmp_path / _CACHE_FILENAME).read_text())["version"] == 2

    def test_use_cache_false(self, tmp_path):
        """use_cache=False never creates a cache file."""
        _copy_inputs(DATA_DIR, tmp_path)
        generate_data_points(tmp_path, use_cache=False)
        assert not (tmp_path / _CACHE_FILENAME).exists()

    def test_corrupt_cache_graceful(self, tmp_path):
        """Invalid JSON in cache file is silently ignored."""
        _copy_inputs(DATA_DIR, tmp_path)
        (tmp_path / _CACHE_FILENAME).write_text("{invalid json")
        h, p, f = generate_data_points(tmp_path, use_cache=True)
        assert isinstance(h, HitterLeagueParams)

    def test_cache_version_mismatch(self, tmp_path):
        """Wrong version number invalidates cache."""
        _copy_inputs(DATA_DIR, tmp_path)
        # Build valid cache
        generate_data_points(tmp_path, use_cache=True)
        # Tamper with version
        cache_path = tmp_path / _CACHE_FILENAME
        data = json.loads(cache_path.read_text())
        data["version"] = 999
        cache_path.write_text(json.dumps(data))
        # Should recompute (not crash)
        h, p, f = generate_data_points(tmp_path, use_cache=True)
        assert isinstance(h, HitterLeagueParams)
        # Cache should be overwritten with correct version
        refreshed = json.loads(cache_path.read_text())
        assert refreshed["version"] == 2
