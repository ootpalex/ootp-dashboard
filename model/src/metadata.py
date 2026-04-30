"""
metadata.py — Compute league calibration constants from raw OOTP data.

Reverse-engineers the 25 Metadata.xlsx computation chain:
    Input Tables (raw stats + ratings)
      → Calc Sheets (aggregation + wOBA derivation + weighted averages)
        → Data Points (HitterLeagueParams, PitcherLeagueParams, FieldingParams)

Public API:
    load_metadata_inputs(directory) → MetadataInputs
    compute_hitting_constants(inputs) → HitterLeagueParams
    compute_pitching_constants(inputs) → PitcherLeagueParams
    compute_fielding_constants(inputs) → FieldingParams
    generate_data_points(directory) → (HitterLeagueParams, PitcherLeagueParams, FieldingParams)
    compose_data_points(hitting, pitching, fielding) → (HitterDataPoints, PitcherDataPoints)

The per-section calc logic lives in ``src.aggregators.{hit,pitch,field}_aggregator``;
this module owns input loading (with optional rating-blending), result caching,
and the top-level orchestrator.
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
from dataclasses import dataclass
from typing import TypedDict


class _BlendKwargs(TypedDict):
    """Heterogeneous blend kwargs forwarded into _load_metadata_rating_csv etc.

    Defined as TypedDict so mypy can see that `**blend_kw` unpacks correctly
    into bool + float keyword params without collapsing to dict[str, float].
    """
    relative_blend: bool
    osa_blend: bool
    scout_weight: float
    osa_weight: float
from pathlib import Path

import pandas as pd

from src.aggregators._shared import _compute_woba_from_aggregates
from src.aggregators.field_aggregator import (
    _build_fielding_helper,
    _build_pos_adj_helper,
    _compute_fielding_aggregates,
    _compute_fielding_rating_averages,
    _compute_position_adjustments,
    compute_fielding_constants,
)
from src.aggregators.hit_aggregator import (
    _aggregate_hitting,
    _compute_matchup_splits_from_ratings,
    _compute_rating_averages_hitting,
    compute_hitting_constants,
)
from src.aggregators.pitch_aggregator import (
    _aggregate_pitching,
    _compute_matchup_splits_pitching,
    _compute_rating_averages_pitching,
    compute_pitching_constants,
)
from src.data_points import (
    FieldingParams,
    FieldingRegressionCoeffs,
    HitterDataPoints,
    HitterLeagueParams,
    HittingRegressionCoeffs,
    PitcherDataPoints,
    PitcherLeagueParams,
    PitchingRegressionCoeffs,
)
from src.relative_ratings import blend_relative_ratings


__all__ = [
    "MetadataInputs",
    "load_metadata_inputs",
    "compute_hitting_constants",
    "compute_pitching_constants",
    "compute_fielding_constants",
    "generate_data_points",
    "compose_data_points",
]


# ---------------------------------------------------------------------------
# Data container
# ---------------------------------------------------------------------------


@dataclass
class MetadataInputs:
    """All raw data needed to compute calibration constants."""

    hitting_data: pd.DataFrame
    batter_ratings_vr: pd.DataFrame  # batter ratings when facing RHP
    batter_ratings_vl: pd.DataFrame  # batter ratings when facing LHP
    pitching_data: pd.DataFrame
    sp_data: pd.DataFrame
    rp_data: pd.DataFrame
    sp_ratings_vr: pd.DataFrame  # SP ratings when facing RH batters
    sp_ratings_vl: pd.DataFrame  # SP ratings when facing LH batters
    rp_ratings_vr: pd.DataFrame  # RP ratings when facing RH batters
    rp_ratings_vl: pd.DataFrame  # RP ratings when facing LH batters
    fielding_data: dict[str, pd.DataFrame]  # keyed by position: c, 1b, ...
    fielding_ratings: pd.DataFrame


# ---------------------------------------------------------------------------
# Rating CSV blending helpers
# ---------------------------------------------------------------------------

# Columns that carry metadata (weights/identity) rather than ratings.
_METADATA_NON_RATING_COLS = frozenset({"ID", "PA", "BF", "B", "T"})


def _blend_metadata_osa_ratings(
    scout_df: pd.DataFrame,
    osa_df: pd.DataFrame,
    scout_weight: float,
    osa_weight: float,
) -> pd.DataFrame:
    """Weighted-average blend of scout + OSA rating columns.

    Only blends numeric columns that appear in both DataFrames and are not in
    _METADATA_NON_RATING_COLS.  PA/BF weights are always preserved from the
    scout file.  Players with no OSA match retain their scout-only values.
    """
    rating_cols = [
        c for c in scout_df.columns
        if c not in _METADATA_NON_RATING_COLS and c in osa_df.columns
    ]
    osa_sub = osa_df[["ID"] + rating_cols].copy()
    merged = scout_df.merge(osa_sub, on="ID", suffixes=("", "_osa"))

    for col in rating_cols:
        scout_val = pd.to_numeric(merged[col], errors="coerce")
        osa_val = pd.to_numeric(merged[f"{col}_osa"], errors="coerce")
        blended = scout_weight * scout_val + osa_weight * osa_val
        merged[col] = blended.where(osa_val.notna(), scout_val)

    merged.drop(columns=[c for c in merged.columns if c.endswith("_osa")], inplace=True)

    scout_only = scout_df[~scout_df["ID"].isin(osa_df["ID"])]
    if not scout_only.empty:
        merged = pd.concat([merged, scout_only], ignore_index=True)

    return merged


def _load_metadata_rating_csv(
    path: Path,
    *,
    relative_blend: bool = False,
    osa_blend: bool = False,
    scout_weight: float = 0.8,
    osa_weight: float = 0.2,
) -> pd.DataFrame:
    """Load one metadata rating CSV with optional OSA / relative blending.

    Naming convention for paired files (same directory as *path*):
      base.csv  →  base_aaa.csv, base_aa.csv  (AAA/AA relative blend)
                →  base_osa.csv               (OSA blend)
      base_osa.csv  →  base_osa_aaa.csv, base_osa_aa.csv  (relative blend on OSA)

    Pipeline order: load → relative blend → OSA blend  (mirrors players.py).
    """
    df = pd.read_csv(path)

    if relative_blend:
        aaa_path = path.with_name(f"{path.stem}_aaa.csv")
        if aaa_path.exists():
            aaa_df = pd.read_csv(aaa_path)
            aa_path = path.with_name(f"{path.stem}_aa.csv")
            aa_df = pd.read_csv(aa_path) if aa_path.exists() else None
            df = blend_relative_ratings(df, aaa_df, aa_df)

    if osa_blend:
        osa_path = path.with_name(f"{path.stem}_osa.csv")
        if osa_path.exists():
            osa_df = pd.read_csv(osa_path)
            if relative_blend:
                osa_aaa_path = osa_path.with_name(f"{osa_path.stem}_aaa.csv")
                if osa_aaa_path.exists():
                    osa_aaa_df = pd.read_csv(osa_aaa_path)
                    osa_aa_path = osa_path.with_name(f"{osa_path.stem}_aa.csv")
                    osa_aa_df = pd.read_csv(osa_aa_path) if osa_aa_path.exists() else None
                    osa_df = blend_relative_ratings(osa_df, osa_aaa_df, osa_aa_df)
            df = _blend_metadata_osa_ratings(df, osa_df, scout_weight, osa_weight)

    return df


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def load_metadata_inputs(
    directory: Path | str,
    *,
    relative_blend: bool = False,
    osa_blend: bool = False,
    scout_weight: float = 0.8,
    osa_weight: float = 0.2,
) -> MetadataInputs:
    """Load all extracted metadata CSVs from the given directory.

    When *relative_blend* is True, each rating CSV is blended with its paired
    ``_aaa`` / ``_aa`` files if present (using the same tier-subdivision
    algorithm as the player pipeline).

    When *osa_blend* is True, each rating CSV is blended with its paired
    ``_osa`` file if present (weighted average: scout_weight + osa_weight).

    Statistical data files (hitting_data, pitching_data, sp_data, rp_data,
    fielding_data, fielding_ratings) are always loaded as-is — blending only
    applies to the rating files (batter_ratings_*, sp_ratings_*, rp_ratings_*).
    """
    d = Path(directory)
    blend_kw: _BlendKwargs = {
        "relative_blend": relative_blend,
        "osa_blend": osa_blend,
        "scout_weight": scout_weight,
        "osa_weight": osa_weight,
    }

    positions = ["c", "1b", "2b", "3b", "ss", "lf", "cf", "rf"]
    fielding_data = {}
    for pos in positions:
        fielding_data[pos] = pd.read_csv(d / f"fielding_data_{pos}.csv")

    return MetadataInputs(
        hitting_data=pd.read_csv(d / "hitting_data.csv"),
        batter_ratings_vr=_load_metadata_rating_csv(d / "batter_ratings_vr.csv", **blend_kw),
        batter_ratings_vl=_load_metadata_rating_csv(d / "batter_ratings_vl.csv", **blend_kw),
        pitching_data=pd.read_csv(d / "pitching_data.csv"),
        sp_data=pd.read_csv(d / "sp_data.csv"),
        rp_data=pd.read_csv(d / "rp_data.csv"),
        sp_ratings_vr=_load_metadata_rating_csv(d / "sp_ratings_vr.csv", **blend_kw),
        sp_ratings_vl=_load_metadata_rating_csv(d / "sp_ratings_vl.csv", **blend_kw),
        rp_ratings_vr=_load_metadata_rating_csv(d / "rp_ratings_vr.csv", **blend_kw),
        rp_ratings_vl=_load_metadata_rating_csv(d / "rp_ratings_vl.csv", **blend_kw),
        fielding_data=fielding_data,
        fielding_ratings=pd.read_csv(d / "fielding_ratings.csv"),
    )


# ---------------------------------------------------------------------------
# Caching
# ---------------------------------------------------------------------------

_CACHE_VERSION = 2
_CACHE_FILENAME = ".metadata_cache.json"


def _compute_input_hash(directory: Path | str) -> str:
    """SHA-256 of sorted concatenated CSV file contents."""
    d = Path(directory)
    h = hashlib.sha256()
    for csv_path in sorted(d.glob("*.csv")):
        h.update(csv_path.name.encode())
        h.update(csv_path.read_bytes())
    return f"sha256:{h.hexdigest()}"


def _compute_config_hash(
    relative_blend: bool,
    osa_blend: bool,
    scout_weight: float,
    osa_weight: float,
) -> str:
    """Short hash of blending parameters for cache invalidation."""
    cfg = f"rel={relative_blend},osa={osa_blend},sw={scout_weight:.6f},ow={osa_weight:.6f}"
    return hashlib.sha256(cfg.encode()).hexdigest()[:16]


def _load_cache(
    directory: Path | str,
    input_hash: str,
    config_hash: str,
) -> tuple[HitterLeagueParams, PitcherLeagueParams, FieldingParams] | None:
    """Load cached results if valid. Returns None on any mismatch or error."""
    cache_path = Path(directory) / _CACHE_FILENAME
    try:
        data = json.loads(cache_path.read_text())
        if data.get("version") != _CACHE_VERSION:
            return None
        if data.get("input_hash") != input_hash:
            return None
        if data.get("config_hash") != config_hash:
            return None
        return (
            HitterLeagueParams(**data["hitting"]),
            PitcherLeagueParams(**data["pitching"]),
            FieldingParams(**data["fielding"]),
        )
    except Exception:
        return None


def _save_cache(
    directory: Path | str,
    input_hash: str,
    config_hash: str,
    hitting: HitterLeagueParams,
    pitching: PitcherLeagueParams,
    fielding: FieldingParams,
) -> None:
    """Write cache file with version, hashes, and all params as JSON."""
    cache_path = Path(directory) / _CACHE_FILENAME
    data = {
        "version": _CACHE_VERSION,
        "input_hash": input_hash,
        "config_hash": config_hash,
        "hitting": dataclasses.asdict(hitting),
        "pitching": dataclasses.asdict(pitching),
        "fielding": dataclasses.asdict(fielding),
    }
    cache_path.write_text(json.dumps(data, indent=2))


# ---------------------------------------------------------------------------
# Master function
# ---------------------------------------------------------------------------


def generate_data_points(
    directory: Path | str,
    *,
    use_cache: bool = True,
    force_recompute: bool = False,
    relative_blend: bool = False,
    osa_blend: bool = False,
    scout_weight: float = 0.8,
    osa_weight: float = 0.2,
) -> tuple[HitterLeagueParams, PitcherLeagueParams, FieldingParams]:
    """Full pipeline: load inputs → compute all calibration constants.

    Parameters
    ----------
    directory : Path
        Path to ``data/metadata/`` containing the metadata CSVs.
    use_cache : bool
        When True (default), check for a valid cache before computing and
        save results to cache after computing.
    force_recompute : bool
        When True, skip cache read (recompute from scratch) but still
        write the cache. Ignored if ``use_cache`` is False.
    relative_blend : bool
        When True, look for paired ``_aaa`` / ``_aa`` rating CSVs alongside
        each rating file and apply tier-subdivision blending (same algorithm
        as the player pipeline).
    osa_blend : bool
        When True, look for paired ``_osa`` rating CSVs alongside each rating
        file and blend using ``scout_weight`` / ``osa_weight``.
    scout_weight : float
        Weight applied to scout ratings when OSA blending (default 0.8).
    osa_weight : float
        Weight applied to OSA ratings when OSA blending (default 0.2).

    Returns
    -------
    tuple
        (HitterLeagueParams, PitcherLeagueParams, FieldingParams)
    """
    directory = Path(directory)
    blend_kw: _BlendKwargs = {
        "relative_blend": relative_blend,
        "osa_blend": osa_blend,
        "scout_weight": scout_weight,
        "osa_weight": osa_weight,
    }

    if use_cache:
        input_hash = _compute_input_hash(directory)
        config_hash = _compute_config_hash(**blend_kw)
        if not force_recompute:
            cached = _load_cache(directory, input_hash, config_hash)
            if cached is not None:
                return cached

    inputs = load_metadata_inputs(directory, **blend_kw)

    hitting = compute_hitting_constants(inputs)
    pitching = compute_pitching_constants(inputs)
    fielding = compute_fielding_constants(inputs)

    if use_cache:
        _save_cache(directory, input_hash, config_hash, hitting, pitching, fielding)

    return hitting, pitching, fielding


def compose_data_points(
    hitting: HitterLeagueParams,
    pitching: PitcherLeagueParams,
    fielding: FieldingParams,
    *,
    hitting_reg: HittingRegressionCoeffs | None = None,
    pitching_reg: PitchingRegressionCoeffs | None = None,
    fielding_reg: FieldingRegressionCoeffs | None = None,
) -> tuple[HitterDataPoints, PitcherDataPoints]:
    """Combine metadata-computed league params with regression coefficients.

    Regression coefficients default to the hardcoded OOTP 26 values when not
    provided (the Regressions pipeline is not yet implemented).

    Parameters
    ----------
    hitting : HitterLeagueParams
        Computed by ``compute_hitting_constants()``.
    pitching : PitcherLeagueParams
        Computed by ``compute_pitching_constants()``.
    fielding : FieldingParams
        Computed by ``compute_fielding_constants()``.
    hitting_reg : HittingRegressionCoeffs, optional
        Defaults to ``HittingRegressionCoeffs()``.
    pitching_reg : PitchingRegressionCoeffs, optional
        Defaults to ``PitchingRegressionCoeffs()``.
    fielding_reg : FieldingRegressionCoeffs, optional
        Defaults to ``FieldingRegressionCoeffs()``.

    Returns
    -------
    tuple
        (HitterDataPoints, PitcherDataPoints)
    """
    if hitting_reg is None:
        hitting_reg = HittingRegressionCoeffs()
    if pitching_reg is None:
        pitching_reg = PitchingRegressionCoeffs()
    if fielding_reg is None:
        fielding_reg = FieldingRegressionCoeffs()

    hitter_dp = HitterDataPoints(
        hitting=hitting_reg,
        fielding_coeffs=fielding_reg,
        league=hitting,
        fielding=fielding,
    )
    pitcher_dp = PitcherDataPoints(
        pitching=pitching_reg,
        fielding_coeffs=fielding_reg,
        league=pitching,
        hitting_rates=hitting,
        fielding=fielding,
    )
    return hitter_dp, pitcher_dp
