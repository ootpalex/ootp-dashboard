"""End-to-end smoke tests — verify the full pipeline runs without exceptions."""

import pytest
import pandas as pd

from src.hitters import (
    compute_hitter_batting,
    compute_position_eligibility,
    compute_fielding,
    compute_waa,
)
from src.pitchers import compute_pitch_counts, compute_starter_flag, compute_pitcher_batting

from tests.conftest import HOME_FRACTION


class TestHitterPipeline:
    """Smoke test: hitter pipeline produces valid output."""

    @pytest.fixture(scope="class")
    def hitters(self, players):
        return players[~players["is_pitcher"] | players["is_two_way"]]

    @pytest.fixture(scope="class")
    def batting(self, hitters, park_deltas, park_adj):
        return compute_hitter_batting(hitters, park_deltas, park_adj, HOME_FRACTION)

    @pytest.fixture(scope="class")
    def eligibility(self, hitters):
        return compute_position_eligibility(hitters)

    @pytest.fixture(scope="class")
    def fielding(self, hitters, eligibility):
        return compute_fielding(hitters, eligibility)

    @pytest.fixture(scope="class")
    def waa(self, batting, fielding, eligibility, park_deltas):
        return compute_waa(batting, fielding, eligibility, park_deltas, HOME_FRACTION)

    def test_batting_shape(self, batting, hitters):
        assert len(batting) == len(hitters)
        # 49 batting/baserunning cols + original player cols
        assert batting.shape[1] > 49

    def test_no_all_nan_batting_cols(self, batting):
        stat_cols = [c for c in batting.columns if "vR" in c or "vL" in c or "wtd" in c]
        for col in stat_cols:
            assert not batting[col].isna().all(), f"{col} is all NaN"

    def test_eligibility_shape(self, eligibility, hitters):
        assert eligibility.shape == (len(hitters), 9)

    def test_fielding_shape(self, fielding, hitters):
        assert len(fielding) == len(hitters)
        assert fielding.shape[1] >= 30

    def test_waa_shape(self, waa, hitters):
        assert len(waa) == len(hitters)
        assert waa.shape[1] >= 30


class TestPitcherPipeline:
    """Smoke test: pitcher pipeline produces valid output."""

    @pytest.fixture(scope="class")
    def pitchers(self, players):
        return players[players["is_pitcher"] | players["is_two_way"]]

    @pytest.fixture(scope="class")
    def pitch_counts(self, pitchers):
        return compute_pitch_counts(pitchers)

    @pytest.fixture(scope="class")
    def starter_flag(self, pitchers, pitch_counts):
        return compute_starter_flag(pitchers, pitch_counts)

    @pytest.fixture(scope="class")
    def pitcher_batting(self, pitchers, park_adj, park_deltas):
        return compute_pitcher_batting(
            pitchers, park_adj, HOME_FRACTION,
            woba_ratio=park_deltas.woba_ratio,
        )

    def test_pitch_counts_shape(self, pitch_counts, pitchers):
        assert len(pitch_counts) == len(pitchers)
        assert list(pitch_counts.columns) == ["Pitches", "SP P Pitch", "SP Pitch"]

    def test_starter_flag_dtype(self, starter_flag):
        assert starter_flag.dtype == bool

    def test_pitcher_batting_shape(self, pitcher_batting, pitchers):
        assert len(pitcher_batting) == len(pitchers)
        # 86 base columns + 6 WAR columns (vR/vL/wtd × SP/RP) = 92
        assert pitcher_batting.shape[1] == 92

    def test_no_all_nan_pitcher_cols(self, pitcher_batting):
        for col in pitcher_batting.columns:
            assert not pitcher_batting[col].isna().all(), f"{col} is all NaN"
