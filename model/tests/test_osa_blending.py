"""Tests for OSA rating blending in players.py."""

import pandas as pd
import pytest

from src.players import (
    calculate_dynamic_weights,
    _compute_blend_weights,
    _blend_single_file,
    load_players,
)

from tests.conftest import PLAYERS_DIR as DATA_DIR


class TestDynamicWeights:
    """Test the dynamic weight stub."""

    def test_returns_base_weights(self):
        sw, ow = calculate_dynamic_weights("A", 0, 0.2, 0.8)
        assert sw == 0.8
        assert ow == 0.2

    def test_different_base_weights(self):
        sw, ow = calculate_dynamic_weights("C", 100, 0.5, 0.5)
        assert sw == 0.5
        assert ow == 0.5


class TestComputeBlendWeights:
    """Test vectorized weight computation."""

    def test_constant_weights(self):
        df = pd.DataFrame({"ID": [1, 2, 3]})
        sw, ow = _compute_blend_weights(df, 0.8, 0.2)
        assert len(sw) == 3
        assert (sw == 0.8).all()
        assert (ow == 0.2).all()


class TestBlendSingleFile:
    """Test blending logic with synthetic data."""

    def _scout_df(self):
        return pd.DataFrame({
            "ID": [1, 2, 3],
            "Name": ["Alice", "Bob", "Charlie"],
            "POS": ["CF", "SS", "SP"],
            "CON vR": [60, 70, 40],
            "POW vR": [50, 80, 30],
        })

    def _osa_df(self):
        return pd.DataFrame({
            "ID": [1, 2],
            "Name": ["Alice", "Bob"],
            "CON vR": [80, 50],
            "POW vR": [70, 60],
        })

    def test_weighted_average(self):
        """Blended values = 0.8 * scout + 0.2 * osa."""
        scout = self._scout_df()
        osa = self._osa_df()
        result = _blend_single_file(scout, osa, 0.8, 0.2)

        # Player 1: CON vR = 0.8*60 + 0.2*80 = 64
        alice = result[result["ID"] == 1].iloc[0]
        assert alice["CON vR"] == pytest.approx(64.0)
        assert alice["POW vR"] == pytest.approx(0.8 * 50 + 0.2 * 70)

    def test_metadata_preserved_from_scout(self):
        """Metadata columns (Name, POS) come from scout file."""
        scout = self._scout_df()
        osa = self._osa_df()
        result = _blend_single_file(scout, osa, 0.8, 0.2)

        alice = result[result["ID"] == 1].iloc[0]
        assert alice["Name"] == "Alice"
        assert alice["POS"] == "CF"

    def test_scout_only_players_preserved(self):
        """Players only in scout file (no OSA match) are kept."""
        scout = self._scout_df()
        osa = self._osa_df()
        result = _blend_single_file(scout, osa, 0.8, 0.2)

        assert 3 in result["ID"].values
        charlie = result[result["ID"] == 3].iloc[0]
        assert charlie["CON vR"] == 40  # unblended scout value

    def test_nan_osa_falls_back_to_scout(self):
        """When OSA value is NaN/dash, scout value is kept."""
        scout = pd.DataFrame({
            "ID": [1],
            "Name": ["Alice"],
            "CON vR": [60],
        })
        osa = pd.DataFrame({
            "ID": [1],
            "CON vR": ["-"],  # dash → NaN after to_numeric
        })
        result = _blend_single_file(scout, osa, 0.8, 0.2)
        # Should keep scout value since OSA is NaN
        assert result["CON vR"].iloc[0] == 60

    def test_no_osa_suffix_columns_remain(self):
        """All _osa suffix columns should be dropped."""
        scout = self._scout_df()
        osa = self._osa_df()
        result = _blend_single_file(scout, osa, 0.8, 0.2)

        osa_cols = [c for c in result.columns if c.endswith("_osa")]
        assert len(osa_cols) == 0


class TestLoadPlayersOSA:
    """Integration test: load_players with osa_blend=True."""

    def test_load_with_osa_blend(self):
        """Load players with OSA blending enabled — should not raise."""
        result = load_players(DATA_DIR, osa_blend=True)
        assert len(result) > 0
        assert "is_pitcher" in result.columns
        assert "is_two_way" in result.columns

    def test_load_without_osa_blend(self):
        """Load players without OSA blending — baseline test."""
        result = load_players(DATA_DIR, osa_blend=False)
        assert len(result) > 0

    def test_blended_has_same_columns_as_unblended(self):
        """Blended and unblended should have the same column set."""
        blended = load_players(DATA_DIR, osa_blend=True)
        unblended = load_players(DATA_DIR, osa_blend=False)
        assert set(blended.columns) == set(unblended.columns)
