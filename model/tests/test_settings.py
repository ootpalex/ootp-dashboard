"""Tests for src/settings.py — settings load/save/hash."""

import json
from pathlib import Path

import pytest

from src.settings import (
    PipelineSettings,
    compute_input_hash,
    load_settings,
    save_settings,
)


class TestPipelineSettings:
    """PipelineSettings dataclass defaults."""

    def test_defaults(self):
        s = PipelineSettings()
        assert s.team == "Nashville Stars"
        assert s.park_factor_mode == "team"
        assert s.home_fraction == 0.5
        assert s.relative_blend is True
        assert s.osa_blend is True
        assert s.scout_weight == 0.8
        assert s.osa_weight == 0.2


class TestInputHash:
    """compute_input_hash detects file changes."""

    def test_hash_deterministic(self):
        """Same directory produces same hash."""
        from tests.conftest import PLAYERS_DIR
        if not PLAYERS_DIR.is_dir():
            pytest.skip("No player data directory")
        h1 = compute_input_hash(PLAYERS_DIR)
        h2 = compute_input_hash(PLAYERS_DIR)
        assert h1 == h2
        assert h1.startswith("sha256:")

    def test_hash_format(self, tmp_path):
        """Hash has correct prefix and is hex."""
        (tmp_path / "test.csv").write_text("a,b,c\n1,2,3\n")
        h = compute_input_hash(tmp_path)
        assert h.startswith("sha256:")
        hex_part = h.split(":")[1]
        assert len(hex_part) == 64
        int(hex_part, 16)  # should not raise


class TestSaveLoad:
    """Round-trip settings save/load."""

    def test_round_trip(self, tmp_path):
        settings = PipelineSettings(team="Test Team", park_factor_mode="neutral")
        path = tmp_path / "settings.json"
        save_settings(settings, "sha256:abc123", path)

        loaded, hash_val = load_settings(path)
        assert loaded is not None
        assert loaded.team == "Test Team"
        assert loaded.park_factor_mode == "neutral"
        assert hash_val == "sha256:abc123"

    def test_load_missing(self, tmp_path):
        path = tmp_path / "nonexistent.json"
        loaded, hash_val = load_settings(path)
        assert loaded is None
        assert hash_val is None

    def test_save_creates_parent_dirs(self, tmp_path):
        path = tmp_path / "sub" / "dir" / "settings.json"
        save_settings(PipelineSettings(), "sha256:x", path)
        assert path.exists()

    def test_camel_case_keys(self, tmp_path):
        """Saved JSON uses camelCase keys."""
        path = tmp_path / "settings.json"
        save_settings(PipelineSettings(), "sha256:x", path)
        data = json.loads(path.read_text())
        assert "parkFactorMode" in data
        assert "homeFraction" in data
        assert "park_factor_mode" not in data
