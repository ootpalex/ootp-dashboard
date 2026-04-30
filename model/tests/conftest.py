"""Shared test infrastructure — constants, fixtures, and helpers."""

from pathlib import Path

import pandas as pd
import pytest

from src.ballparks import BallparksTable
from src.players import load_players

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

_PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _resolve_player_dir() -> Path:
    """Locate user player data, preferring the new per-league layout.

    Always returns a Path — when no data is available the path simply doesn't
    exist, so `is_dir()` / `is_file()` checks naturally fail and fixtures /
    module-level skipif markers in individual test files can `pytest.skip`
    cleanly on a fresh clone.
    """
    candidates = [
        _PROJECT_ROOT / "leagues" / "default" / "csv" / "players",
        _PROJECT_ROOT / "model" / "data" / "players",
    ]
    for c in candidates:
        if c.is_dir() and any(c.glob("*.csv")):
            return c
    return candidates[0]  # canonical (non-existent) location for clear skip messages


def _resolve_ballparks_csv() -> Path:
    candidates = [
        _PROJECT_ROOT / "leagues" / "default" / "csv" / "ballparks.csv",
        _PROJECT_ROOT / "model" / "data" / "ballparks.csv",
    ]
    for c in candidates:
        if c.is_file():
            return c
    return candidates[0]


PLAYERS_DIR: Path = _resolve_player_dir()
BALLPARKS_CSV: Path = _resolve_ballparks_csv()
HAS_PLAYER_DATA: bool = PLAYERS_DIR.is_dir() and any(PLAYERS_DIR.glob("*.csv"))
HAS_BALLPARKS: bool = BALLPARKS_CSV.is_file()
TEAM = "Nashville Stars"
HOME_FRACTION = 0.5


# ---------------------------------------------------------------------------
# Session-scoped fixtures (loaded once across all tests)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def players():
    """Full player DataFrame (all CSV files, no blending)."""
    if not HAS_PLAYER_DATA:
        pytest.skip(f"No player CSVs at {PLAYERS_DIR}")
    return load_players(PLAYERS_DIR)


@pytest.fixture(scope="session")
def table():
    """Ballparks lookup table."""
    if not HAS_BALLPARKS:
        pytest.skip(f"No ballparks.csv at {BALLPARKS_CSV}")
    return BallparksTable.from_csv(BALLPARKS_CSV)


@pytest.fixture(scope="session")
def park_deltas(table):
    """Park deltas for the default team."""
    return table.compute_park_deltas(TEAM, HOME_FRACTION)


@pytest.fixture(scope="session")
def park_adj(table):
    """Normalized adjustments for the default team."""
    return table.rows[TEAM].adj


# ---------------------------------------------------------------------------
# Synthetic player helper
# ---------------------------------------------------------------------------


def make_player(**overrides) -> pd.DataFrame:
    """Create a single-row player DataFrame with sensible defaults.

    All rating columns default to 50, fielding to reasonable values.
    Pass keyword overrides to change any column, e.g. ``make_player(STE=90)``.
    """
    base = {
        "B": "R", "T": "R", "HT": "6' 0'", "POS": "CF",
        "SPE": 50, "STE": 50, "RUN": 50,
        "CON P": 30, "POW P": 30, "EYE P": 30,
        "STU P": 20, "MOV P": 20, "PCON P": 20,
        "C FRM": 20, "C ARM": 50, "IF RNG": 50, "IF ERR": 50,
        "IF ARM": 50, "TDP": 50, "OF RNG": 65, "OF ERR": 50, "OF ARM": 50,
    }
    # Add split rating columns
    for split in ["vR", "vL"]:
        for stat in ["BA", "GAP", "POW", "EYE", "K"]:
            base[f"{stat} {split}"] = 50
    base.update(overrides)
    return pd.DataFrame([base])
