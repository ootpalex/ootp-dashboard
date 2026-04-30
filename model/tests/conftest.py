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


def _resolve_player_dir() -> Path | None:
    """Locate user player data, preferring the new per-league layout.

    Returns None when no data is available so fixtures can `pytest.skip`
    cleanly on a fresh clone instead of erroring out.
    """
    candidates = [
        _PROJECT_ROOT / "leagues" / "default" / "csv" / "players",
        _PROJECT_ROOT / "model" / "data" / "players",
    ]
    for c in candidates:
        if c.is_dir() and any(c.glob("*.csv")):
            return c
    return None


def _resolve_ballparks_csv() -> Path | None:
    candidates = [
        _PROJECT_ROOT / "leagues" / "default" / "csv" / "ballparks.csv",
        _PROJECT_ROOT / "model" / "data" / "ballparks.csv",
    ]
    for c in candidates:
        if c.is_file():
            return c
    return None


PLAYERS_DIR = _resolve_player_dir()
BALLPARKS_CSV = _resolve_ballparks_csv()
TEAM = "Nashville Stars"
HOME_FRACTION = 0.5


# ---------------------------------------------------------------------------
# Session-scoped fixtures (loaded once across all tests)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def players():
    """Full player DataFrame (all CSV files, no blending)."""
    if PLAYERS_DIR is None:
        pytest.skip("No player data directory found (looked in leagues/default/ and model/data/)")
    return load_players(PLAYERS_DIR)


@pytest.fixture(scope="session")
def table():
    """Ballparks lookup table."""
    if BALLPARKS_CSV is None:
        pytest.skip("No ballparks.csv found (looked in leagues/default/ and model/data/)")
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
