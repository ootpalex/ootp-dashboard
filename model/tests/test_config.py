"""Tests for pipeline defaults and neutral park helpers."""

import pytest
from src.settings import PipelineSettings
from src.ballparks import neutral_park_deltas, neutral_adjustments


class TestConfigDefaults:
    """Verify default PipelineSettings values match expected pipeline defaults."""

    def test_target_team(self):
        assert PipelineSettings().team == "Nashville Stars"

    def test_park_factor_mode(self):
        assert PipelineSettings().park_factor_mode == "team"

    def test_home_fraction(self):
        assert PipelineSettings().home_fraction == 0.5

    def test_weights_sum_to_one(self):
        s = PipelineSettings()
        assert s.osa_weight + s.scout_weight == pytest.approx(1.0)

    def test_osa_weight(self):
        assert PipelineSettings().osa_weight == 0.2

    def test_scout_weight(self):
        assert PipelineSettings().scout_weight == 0.8


class TestNeutralParkDeltas:
    """Verify neutral park delta helpers."""

    def test_all_deltas_zero(self):
        pd = neutral_park_deltas()
        assert pd.hr_vr == 0.0
        assert pd.hr_vl == 0.0
        assert pd.h_minus_hr_vr == 0.0
        assert pd.h_minus_hr_vl == 0.0
        assert pd.xbh_minus_hr_vr == 0.0
        assert pd.xbh_minus_hr_vl == 0.0
        assert pd.triple_vr == 0.0
        assert pd.triple_vl == 0.0

    def test_woba_ratio_one(self):
        pd = neutral_park_deltas()
        assert pd.woba_ratio == 1.0

    def test_adj_value_zero(self):
        pd = neutral_park_deltas()
        assert pd.adj_value == 0.0

    def test_custom_team_name(self):
        pd = neutral_park_deltas(team_name="Test Team")
        assert pd.team_name == "Test Team"


class TestNeutralAdjustments:
    """Verify neutral adjustment helpers."""

    def test_all_factors_one(self):
        adj = neutral_adjustments()
        assert adj.pf_avg_adj == 1.0
        assert adj.ba_lh == 1.0
        assert adj.ba_rh == 1.0
        assert adj.pf_hr_adj == 1.0
        assert adj.hr_lh == 1.0
        assert adj.hr_rh == 1.0
        assert adj.pf_d_adj == 1.0
        assert adj.pf_t_adj == 1.0
