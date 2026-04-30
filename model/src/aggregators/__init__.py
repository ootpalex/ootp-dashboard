"""Aggregator modules for metadata pipeline.

Each module computes one section of the calibration constants:
- hit_aggregator   → HitterLeagueParams
- pitch_aggregator → PitcherLeagueParams
- field_aggregator → FieldingParams

Shared helpers (wOBA derivation, weighted means, PA-fraction-by-hand splits)
live in ``_shared``.
"""
from src.aggregators.hit_aggregator import compute_hitting_constants
from src.aggregators.pitch_aggregator import compute_pitching_constants
from src.aggregators.field_aggregator import compute_fielding_constants

__all__ = [
    "compute_hitting_constants",
    "compute_pitching_constants",
    "compute_fielding_constants",
]
