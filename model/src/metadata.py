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
from collections.abc import Sequence
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

import numpy as np
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
    _build_virtual_role_frames,
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
    PiecewiseCoeffs,
    PitcherDataPoints,
    PitcherLeagueParams,
    PitchingRegressionCoeffs,
)
from src.hitters import parse_height_cm
from src.relative_ratings import blend_relative_ratings


__all__ = [
    "MetadataInputs",
    "load_metadata_inputs",
    "has_metadata_inputs",
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
    fielding_data: dict[str, pd.DataFrame]  # keyed by position: c, 1b, ...
    fielding_ratings: pd.DataFrame
    # Pitcher ratings come in one of two mutually exclusive formats:
    #   Legacy 4-file (per-role): sp_ratings_vr/vl + rp_ratings_vr/vl, each with a
    #     single "STU"/"HRR"/… column already filtered to that role.
    #   New 2-file (combined): pitcher_ratings_vr/vl, one row per pitcher with both
    #     vR/vL rating columns + POS; SP/RP role split is computed in pitch_aggregator.
    # Exactly one set is populated by load_metadata_inputs.
    sp_ratings_vr: pd.DataFrame | None = None  # SP ratings when facing RH batters
    sp_ratings_vl: pd.DataFrame | None = None  # SP ratings when facing LH batters
    rp_ratings_vr: pd.DataFrame | None = None  # RP ratings when facing RH batters
    rp_ratings_vl: pd.DataFrame | None = None  # RP ratings when facing LH batters
    pitcher_ratings_vr: pd.DataFrame | None = None  # all pitchers, BF = RH-faced
    pitcher_ratings_vl: pd.DataFrame | None = None  # all pitchers, BF = LH-faced
    # League identity. Read from ../league.json by load_metadata_inputs; used by
    # compute_fielding_constants to look up the frozen positional-adjustment spectrum
    # in data_points._FROZEN_POS_ADJ_BY_URL. None for ad-hoc / no-league contexts.
    statsplus_url: str | None = None


# ---------------------------------------------------------------------------
# Rating CSV blending helpers
# ---------------------------------------------------------------------------

# Columns that carry metadata (weights/identity) rather than ratings.
_METADATA_NON_RATING_COLS = frozenset({"ID", "POS", "Name", "PA", "BF", "B", "T"})


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
# Raw-export normalization
# ---------------------------------------------------------------------------
#
# Raw OOTP exports lack several columns the YourKidnies' 25 Metadata.xlsx
# computed. These helpers derive them when absent so raw and spreadsheet-derived
# inputs both work. They are *idempotent*: an already-present column is left
# untouched, so spreadsheet-derived seasons produce byte-identical results.

_BIZ_ATTEMPTED = ["BIZ-R", "BIZ-L", "BIZ-E", "BIZ-U", "BIZ-Z", "BIZ-I"]
_BIZ_MADE = ["BIZ-Rm", "BIZ-Lm", "BIZ-Em", "BIZ-Um", "BIZ-Zm"]


def _ip_clean(ip_series: pd.Series) -> pd.Series:
    """Convert OOTP thirds notation to true decimal innings.

    OOTP writes IP as ``139.2`` meaning 139 + 2/3 innings (the decimal is outs,
    not tenths). ``139.2 -> 139.667``, ``225.0 -> 225.0``.
    """
    ip = pd.to_numeric(ip_series, errors="coerce")
    whole = np.floor(ip)
    outs = ((ip - whole) * 10).round()
    return whole + outs / 3.0


def _normalize_pitching_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Add ``IP Clean`` from ``IP`` when absent (pitching_data/sp_data/rp_data)."""
    if "IP Clean" not in df.columns and "IP" in df.columns:
        df = df.copy()
        df["IP Clean"] = _ip_clean(df["IP"])
    return df


def _normalize_fielding_data_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Add ``IP Clean`` and ``Plays A``/``Plays M`` (BIZ-* sums) when absent."""
    df = df.copy()
    if "IP Clean" not in df.columns and "IP" in df.columns:
        df["IP Clean"] = _ip_clean(df["IP"])
    if "Plays A" not in df.columns and all(c in df.columns for c in _BIZ_ATTEMPTED):
        df["Plays A"] = sum(pd.to_numeric(df[c], errors="coerce").fillna(0)
                            for c in _BIZ_ATTEMPTED)
    if "Plays M" not in df.columns and all(c in df.columns for c in _BIZ_MADE):
        df["Plays M"] = sum(pd.to_numeric(df[c], errors="coerce").fillna(0)
                            for c in _BIZ_MADE)
    return df


_SPLIT_HIT_STATS = ["BA", "GAP", "POW", "EYE", "K"]


def _normalize_batter_ratings_frame(df: pd.DataFrame, side: str) -> pd.DataFrame:
    """Map new both-sides batter ratings to the legacy single-column shape.

    The new ``Batting Rtng Export`` carries both ``BA vR`` and ``BA vL`` (etc.) in
    each file; the aggregator expects a single ``BA`` column holding this file's
    side. For ``side="vR"`` alias ``BA vR -> BA`` (… EYE/POW/GAP/K too); for
    ``side="vL"`` alias the vL columns. Idempotent: legacy single-column files
    (which already have ``BA``) are returned unchanged. SPE/STE/RUN/SR are
    side-independent in both formats and need no aliasing.
    """
    df = df.copy()
    for stat in _SPLIT_HIT_STATS:
        col_side = f"{stat} {side}"
        if stat not in df.columns and col_side in df.columns:
            df[stat] = pd.to_numeric(df[col_side], errors="coerce")
    return df


def _normalize_fielding_ratings_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Add ``HT CM`` (height parse) and catcher ``* Fix`` (dash->20) when absent."""
    df = df.copy()
    if "HT CM" not in df.columns and "HT" in df.columns:
        df["HT CM"] = parse_height_cm(df["HT"])
    for raw, fixed in (("C ABI", "C ABI Fix"), ("C FRM", "C FRM Fix"),
                       ("C ARM", "C ARM Fix")):
        if fixed not in df.columns and raw in df.columns:
            # OOTP writes "-" for non-catchers → coerce to NaN, then 20 (matches
            # the spreadsheet's IF(="-",20,val)). Avoids replace()'s downcast warning.
            df[fixed] = pd.to_numeric(df[raw], errors="coerce").fillna(20)
    return df


def _normalize_pitcher_ratings_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Alias the HR-allowed pitcher rating ``HRA*`` to ``HRR*`` when present.

    OOTP exports this rating under either caption depending on the view; the
    aggregator reads ``HRR`` (bare for the legacy per-role files,
    ``HRR vR``/``HRR vL`` for the combined 2-file format). The suffix set covers
    both shapes. Idempotent: files that already use ``HRR`` are unchanged. (The
    ``_1``/``.1`` duplicate-caption issue handled in players.py cannot occur here
    — these are single-purpose exports with no repeated captions.)
    """
    aliases = {
        f"HRA{suffix}": f"HRR{suffix}"
        for suffix in ("", " vL", " vR", " P")
        if f"HRA{suffix}" in df.columns and f"HRR{suffix}" not in df.columns
    }
    return df.rename(columns=aliases) if aliases else df


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
        fielding_data[pos] = _normalize_fielding_data_frame(
            pd.read_csv(d / f"fielding_data_{pos}.csv"))

    # League identity: walk up from the metadata dir to find league.json
    # (`<slug>/league.json` for flat layouts and `<slug>/league.json` for pooled
    # season subdirs like `<slug>/metadata/2042/`). Used by compute_fielding_constants
    # → data_points.get_frozen_pos_adj for the per-universe positional-adjustment
    # spectrum. Optional — if no league.json is found / it's malformed, leave URL
    # as None and the frozen-pos-adj lookup falls back to its default spectrum.
    statsplus_url: str | None = None
    for ancestor in (d, *d.parents):
        league_json = ancestor / "league.json"
        if league_json.is_file():
            try:
                statsplus_url = json.loads(league_json.read_text()).get("statsplusUrl")
            except (json.JSONDecodeError, OSError):
                pass
            break

    # Pitcher ratings: the new 2-file combined format (pitcher_ratings_vr/vl)
    # takes precedence; otherwise fall back to the legacy 4-file per-role format.
    if (d / "pitcher_ratings_vr.csv").is_file():
        pitcher_kwargs = {
            "pitcher_ratings_vr": _normalize_pitcher_ratings_frame(
                _load_metadata_rating_csv(d / "pitcher_ratings_vr.csv", **blend_kw)),
            "pitcher_ratings_vl": _normalize_pitcher_ratings_frame(
                _load_metadata_rating_csv(d / "pitcher_ratings_vl.csv", **blend_kw)),
        }
    else:
        pitcher_kwargs = {
            "sp_ratings_vr": _normalize_pitcher_ratings_frame(
                _load_metadata_rating_csv(d / "sp_ratings_vr.csv", **blend_kw)),
            "sp_ratings_vl": _normalize_pitcher_ratings_frame(
                _load_metadata_rating_csv(d / "sp_ratings_vl.csv", **blend_kw)),
            "rp_ratings_vr": _normalize_pitcher_ratings_frame(
                _load_metadata_rating_csv(d / "rp_ratings_vr.csv", **blend_kw)),
            "rp_ratings_vl": _normalize_pitcher_ratings_frame(
                _load_metadata_rating_csv(d / "rp_ratings_vl.csv", **blend_kw)),
        }

    return MetadataInputs(
        hitting_data=pd.read_csv(d / "hitting_data.csv"),
        batter_ratings_vr=_normalize_batter_ratings_frame(
            _load_metadata_rating_csv(d / "batter_ratings_vr.csv", **blend_kw), "vR"),
        batter_ratings_vl=_normalize_batter_ratings_frame(
            _load_metadata_rating_csv(d / "batter_ratings_vl.csv", **blend_kw), "vL"),
        pitching_data=_normalize_pitching_frame(pd.read_csv(d / "pitching_data.csv")),
        sp_data=_normalize_pitching_frame(pd.read_csv(d / "sp_data.csv")),
        rp_data=_normalize_pitching_frame(pd.read_csv(d / "rp_data.csv")),
        fielding_data=fielding_data,
        fielding_ratings=_normalize_fielding_ratings_frame(pd.read_csv(d / "fielding_ratings.csv")),
        statsplus_url=statsplus_url,
        **pitcher_kwargs,
    )


# ---------------------------------------------------------------------------
# Caching
# ---------------------------------------------------------------------------

# v3: out_value (inf_out/of_out) now derived per league in compute_hitting_constants (BIZ OF-hit mix)
# and the baserunning c0 fallbacks corrected — both are code changes not captured by the input-data hash,
# so the version bump invalidates stale on-disk caches that still hold the old 0.75/0.90 / Excel intercepts.
# v4: positional adjustments replaced with the per-universe frozen blended spectrum at H=2.5/cut=8y
# (FANGRAPHS / Zimmerman field-8-mean-0 anchor; DH-tied-to-lowest rule). Constants change; existing
# caches still hold the old offense-derived per-season values, so they need to be invalidated.
# v5: defensive half of the blend widened to H_def=5/cut_def=20 (offense unchanged at H=2.5/cut=8)
# per the per-position-pair bootstrap-SE audit (Leftovers/positional-adjustments/SAMPLE_SIZE_AUDIT.md).
# Constants change; bump invalidates v4 caches that still hold the narrower-window values.
# v6: HitterLeagueParams gains ste_pa_dist (PA-weighted MLB-batter STE distribution) feeding the
# OOTP-27 league-adaptive sba c0 (AUDIT_HITPIT_BR_27 §F1). v5 caches load fine (defaulted field)
# but would silently keep the canonical c0 on 27 leagues; bump forces recompute so the
# distribution is present. No 26 constant changes.
# v7: engine-boundary season filtering (C1, FIELDING_PIPELINE_27) — a 27 league's constants
# may no longer pool pre-boundary (OOTP 26) metadata seasons.
_CACHE_VERSION = 7
_CACHE_FILENAME = ".metadata_cache.json"


def _compute_input_hash(directory: Path | str) -> str:
    """SHA-256 of sorted concatenated CSV file contents."""
    d = Path(directory)
    h = hashlib.sha256()
    for csv_path in sorted(d.glob("*.csv")):
        h.update(csv_path.name.encode())
        h.update(csv_path.read_bytes())
    return f"sha256:{h.hexdigest()}"


def _compute_seasons_input_hash(season_dirs: Sequence[Path]) -> str:
    """SHA-256 over the CSVs of every pooled season dir.

    Each file is season-qualified by its parent directory name so two seasons
    sharing the same filenames hash distinctly and the hash changes whenever any
    pooled season's data changes.
    """
    h = hashlib.sha256()
    for d in season_dirs:
        d = Path(d)
        for csv_path in sorted(d.glob("*.csv")):
            h.update(f"{d.name}/{csv_path.name}".encode())
            h.update(csv_path.read_bytes())
    return f"sha256:{h.hexdigest()}"


def _compute_config_hash(
    relative_blend: bool,
    osa_blend: bool,
    scout_weight: float,
    osa_weight: float,
    season_weights: Sequence[float] | None = None,
    ootp_version: str | None = None,
    engine_first_season: dict[str, int] | None = None,
) -> str:
    """Short hash of blending parameters for cache invalidation."""
    sw = ",".join(f"{w:.6f}" for w in (season_weights or ()))
    efs = ",".join(f"{k}:{v}" for k, v in sorted((engine_first_season or {}).items()))
    cfg = (f"rel={relative_blend},osa={osa_blend},"
           f"sw={scout_weight:.6f},ow={osa_weight:.6f},seasons=[{sw}],"
           f"ver={ootp_version or ''},efs=[{efs}]")
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
# Multi-season pooling
# ---------------------------------------------------------------------------

# Recency weights applied newest-first when a metadata dir holds year subfolders.
_DEFAULT_SEASON_WEIGHTS: tuple[float, ...] = (3.0, 2.0, 1.0)


class MetadataVersionError(RuntimeError):
    """A league's metadata cannot be safely resolved for its engine version.

    Raised instead of guessing: pooling metadata seasons across an OOTP engine boundary
    silently feeds stale-engine constants (chance counts, run values, rating averages) into the
    current-engine model — the root cause of the 2B/MI overvaluation
    (ootp27-conversion/proposals/FIELDING_PIPELINE_27.md, change C1). Loud failure is the fix.
    """


def _enforce_engine_boundary(
    year_dirs: list[tuple[int, "Path"]],
    directory: "Path",
    ootp_version: str | None,
    engine_first_season: dict[str, int] | None,
) -> list[tuple[int, "Path"]]:
    """Filter metadata season dirs to the league's current engine era.

    Version "26" (and None — legacy/direct callers) is the pre-boundary base: no filtering.
    Any later version REQUIRES league.json to declare its first season
    (``"engineFirstSeason": {"27": 2043}``); seasons before it are excluded. Missing
    declaration, a flat (year-less) metadata dir, or zero surviving seasons all raise
    MetadataVersionError with the operator fix in the message.
    """
    if ootp_version in (None, "", "26"):
        return year_dirs
    boundary = (engine_first_season or {}).get(str(ootp_version))
    if boundary is None:
        raise MetadataVersionError(
            f"League is on OOTP {ootp_version} but league.json declares no "
            f'"engineFirstSeason" entry for it. Add e.g. "engineFirstSeason": '
            f'{{"{ootp_version}": <first {ootp_version} in-game season>}} so metadata from the '
            f"previous engine cannot pool into this league's constants. (metadata dir: {directory})"
        )
    if not year_dirs:
        raise MetadataVersionError(
            f"League is on OOTP {ootp_version} but its metadata dir is flat (no year "
            f"subfolders), so seasons cannot be classified by engine. Move the CSVs into a "
            f"year-named subfolder (e.g. {directory}/<season>/) on the correct side of the "
            f"engineFirstSeason boundary ({boundary})."
        )
    kept = [(y, p) for y, p in year_dirs if y >= int(boundary)]
    if not kept:
        have = ", ".join(str(y) for y, _ in sorted(year_dirs))
        raise MetadataVersionError(
            f"League is on OOTP {ootp_version} (first season {boundary}) but its metadata dir "
            f"only holds pre-boundary seasons [{have}]. Export/build a {ootp_version}-era "
            f"metadata season under {directory}/<year>/ — refusing to fall back to "
            f"previous-engine constants."
        )
    dropped = sorted(y for y, _ in year_dirs if y < int(boundary))
    if dropped:
        print(
            f"Engine boundary {boundary} (OOTP {ootp_version}): excluding pre-boundary "
            f"metadata seasons {dropped}"
        )
    return kept


def has_metadata_inputs(directory: Path | str) -> bool:
    """True if *directory* holds metadata CSVs directly or in year subfolders.

    Used by the pipeline's detection gates so a metadata dir that only contains
    year-named season subfolders (no loose CSVs) is still recognized as custom
    metadata rather than treated as empty.
    """
    d = Path(directory)
    if not d.is_dir():
        return False
    if any(d.glob("*.csv")):
        return True
    return any(
        child.is_dir() and child.name.isdigit() and any(child.glob("*.csv"))
        for child in d.iterdir()
    )


def _resolve_season_dirs(
    directory: Path | str,
    season_weights: Sequence[float],
    *,
    ootp_version: str | None = None,
    engine_first_season: dict[str, int] | None = None,
) -> list[tuple[Path, float]]:
    """Resolve which season subfolders to pool, with their recency weights.

    A "season" subfolder is a child directory whose name is all digits (a year).
    Weights are assigned by *years-back* from the newest present season: the
    newest gets ``season_weights[0]``, one year older ``season_weights[1]``, etc.
    Seasons more than ``len(season_weights) - 1`` years older than the newest are
    dropped, and a gap year simply leaves its weight slot unused (e.g. 2026 + 2024
    with weights (3, 2, 1) → 2026=3, 2024=1).

    When no year subfolders exist, the flat *directory* itself is returned as a
    single season with weight 1.0 — identical to the legacy single-season
    behavior. The list is ordered newest-first.
    """
    directory = Path(directory)
    year_dirs: list[tuple[int, Path]] = []
    if directory.is_dir():
        for child in directory.iterdir():
            if child.is_dir() and child.name.isdigit():
                year_dirs.append((int(child.name), child))

    year_dirs = _enforce_engine_boundary(
        year_dirs, directory, ootp_version, engine_first_season)

    if not year_dirs:
        return [(directory, 1.0)]

    newest = max(year for year, _ in year_dirs)
    n = len(season_weights)
    selected: list[tuple[int, Path, float]] = []
    for year, path in year_dirs:
        idx = newest - year
        if 0 <= idx < n:
            weight = float(season_weights[idx])
            if weight > 0:
                selected.append((year, path, weight))

    if not selected:
        # Degenerate config (e.g. empty/zero weights) — fall back to newest only.
        newest_dir = next(p for y, p in year_dirs if y == newest)
        return [(newest_dir, 1.0)]

    selected.sort(key=lambda t: t[0], reverse=True)  # newest first
    return [(path, weight) for _, path, weight in selected]


def _blend_distributions(dists: list, weights: Sequence[float], total: float) -> list | None:
    """Season-weighted mixture of per-season ``[[value, weight], ...]`` distributions.

    Each season's weights are renormalized within-season before applying the season weight —
    the distribution analogue of the field-wise weighted mean of the scalar averages (so the
    mixture's mean equals the blended scalar average by construction). Returns None when any
    season lacks a usable distribution: a partial mixture would silently misrepresent the pool,
    and None falls back to the canonical-c0 behavior downstream.
    """
    if any(not d for d in dists):
        return None
    agg: dict[float, float] = {}
    for dist, w in zip(dists, weights):
        season_total = float(sum(pw for _, pw in dist))
        if season_total <= 0:
            return None
        for val, pw in dist:
            key = float(val)
            agg[key] = agg.get(key, 0.0) + (w / total) * (float(pw) / season_total)
    return [[v, pw] for v, pw in sorted(agg.items())]


def _blend_params(params_list: list, weights: Sequence[float]):
    """Weighted-average every field across same-typed param dataclasses.

    Float fields (everything in PitcherLeagueParams / FieldingParams, and all scalar
    HitterLeagueParams fields) take the field-wise weighted mean. Distribution-valued fields
    (``HitterLeagueParams.ste_pa_dist``: a list of [value, weight] pairs, or None) take the
    season-weighted measure mixture via ``_blend_distributions``. A single-element list returns
    that element unchanged (exact identity — no float drift on the single-season path).
    """
    if len(params_list) == 1:
        return params_list[0]
    total = float(sum(weights))
    if total <= 0:
        raise ValueError("season weights must sum to a positive value")
    cls = type(params_list[0])
    blended = {}
    for f in dataclasses.fields(cls):
        vals = [getattr(p, f.name) for p in params_list]
        if all(isinstance(v, (int, float)) for v in vals):
            blended[f.name] = sum(v * w for v, w in zip(vals, weights)) / total
        else:
            blended[f.name] = _blend_distributions(vals, weights, total)
    return cls(**blended)


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
    season_weights: Sequence[float] | None = None,
    ootp_version: str | None = None,
    engine_first_season: dict[str, int] | None = None,
) -> tuple[HitterLeagueParams, PitcherLeagueParams, FieldingParams]:
    """Full pipeline: load inputs → compute all calibration constants.

    Parameters
    ----------
    directory : Path
        Path to ``data/metadata/`` containing the metadata CSVs. May instead
        hold year-named subfolders (``2026/``, ``2025/`` …), in which case the
        most recent seasons are computed independently and blended (see
        ``season_weights``).
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
    season_weights : Sequence[float], optional
        Recency weights for year-subfolder pooling, newest-first
        (default ``(3, 2, 1)``). Ignored when ``directory`` holds the metadata
        CSVs directly (single season).

    Returns
    -------
    tuple
        (HitterLeagueParams, PitcherLeagueParams, FieldingParams)
    """
    directory = Path(directory)
    if season_weights is None:
        season_weights = _DEFAULT_SEASON_WEIGHTS
    blend_kw: _BlendKwargs = {
        "relative_blend": relative_blend,
        "osa_blend": osa_blend,
        "scout_weight": scout_weight,
        "osa_weight": osa_weight,
    }

    seasons = _resolve_season_dirs(
        directory, season_weights,
        ootp_version=ootp_version, engine_first_season=engine_first_season)
    is_flat = len(seasons) == 1 and seasons[0][0] == directory

    if use_cache:
        input_hash = (
            _compute_input_hash(directory) if is_flat
            else _compute_seasons_input_hash([d for d, _ in seasons])
        )
        config_hash = _compute_config_hash(
            **blend_kw, season_weights=season_weights,
            ootp_version=ootp_version, engine_first_season=engine_first_season)
        if not force_recompute:
            cached = _load_cache(directory, input_hash, config_hash)
            if cached is not None:
                return cached

    if not is_flat:
        years = ", ".join(d.name for d, _ in seasons)
        wts = ", ".join(f"{w:g}" for _, w in seasons)
        print(f"Pooling {len(seasons)} metadata seasons [{years}] weighted [{wts}]")

    hit_list, pit_list, fld_list, weights = [], [], [], []
    for season_dir, weight in seasons:
        inputs = load_metadata_inputs(season_dir, **blend_kw)
        hit_list.append(compute_hitting_constants(inputs))
        pit_list.append(compute_pitching_constants(inputs))
        fld_list.append(compute_fielding_constants(inputs))
        weights.append(weight)

    hitting = _blend_params(hit_list, weights)
    pitching = _blend_params(pit_list, weights)
    fielding = _blend_params(fld_list, weights)

    if use_cache:
        _save_cache(directory, input_hash, config_hash, hitting, pitching, fielding)

    return hitting, pitching, fielding


def _with_league_adaptive_sba_c0(
    hitting_reg: HittingRegressionCoeffs, hitting: HitterLeagueParams
) -> HittingRegressionCoeffs:
    """OOTP-27 only: replace the hitter Steal→SBA% canonical c0 with the league-adaptive offset.

    The sba channel applies as ``c0 + pw(STE) + lg.sba_rate`` with ``pw`` anchored to 0 at
    ``avg_steal`` and ``lg.sba_rate`` the POOLED (attempt-weighted) league rate. Self-consistency
    requires ``c0 = avg-rated rate − pooled rate`` — and because attempts are strongly convex in
    STE, that gap is a Jensen gap that scales with the league's run environment; no constant is
    correct for every league (AUDIT_HITPIT_BR_27 §F1: real-27 ≈ −0.44 × lg.sba_rate, the wired
    26-canonical +0.0091 is a quiet-bell-substrate artifact). Setting
    ``c0 = −E_w[pw(STE)]`` (E_w = the league's PA-weighted MLB-batter STE distribution, the same
    population/weighting as avg_steal) reproduces the pooled rate exactly by construction:
    E_w[c0 + pw + lg.sba_rate] = lg.sba_rate.

    Dispatch: 26 (CubicCoeffs) is returned untouched; 27 without a usable distribution keeps the
    canonical c0 (pre-fix behavior). Design ratified 2026-07-02 (population, compute site,
    sb_pct exclusion).
    """
    sba = hitting_reg.sba
    if not isinstance(sba, PiecewiseCoeffs):
        return hitting_reg
    dist = hitting.ste_pa_dist
    if not dist:
        return hitting_reg
    total = float(sum(w for _, w in dist))
    if total <= 0:
        return hitting_reg
    from src.utils import piecewise_delta
    e_pw = sum(
        w * float(piecewise_delta(float(v), hitting.avg_steal, sba)) for v, w in dist
    ) / total
    print(f"OOTP-27 league-adaptive SBA c0: {-e_pw:+.5f} "
          f"(replaces canonical {sba.c0:+.5f}; lg.sba_rate {hitting.sba_rate:.5f})")
    return dataclasses.replace(hitting_reg, sba=dataclasses.replace(sba, c0=-e_pw))


# Fielding channels centred at compose time (change C3). Each entry: the const slot to set,
# then (slope attr, avg attr on FieldingParams, dist attr on FieldingParams) per rating term.
# Linear terms need no centring (E_w[linear(r − avg)] = 0 exactly, same rows/weights as avg);
# they are listed anyway so a future piecewise upgrade of that term is picked up automatically.
_FIELDING_CENTRE_CHANNELS: tuple = (
    ("first_pm_const",  (("first_pm_rng_slope",  "avg_rng_1b", "rng_ip_dist_1b"),)),
    ("second_pm_const", (("second_pm_rng_slope", "avg_rng_2b", "rng_ip_dist_2b"),
                         ("second_pm_arm_slope", "avg_arm_2b", None))),
    ("third_pm_const",  (("third_pm_rng_slope",  "avg_rng_3b", "rng_ip_dist_3b"),
                         ("third_pm_arm_slope",  "avg_arm_3b", "arm_ip_dist_3b"))),
    ("ss_pm_const",     (("ss_pm_rng_slope",     "avg_rng_ss", "rng_ip_dist_ss"),
                         ("ss_pm_arm_slope",     "avg_arm_ss", None))),
    ("lf_pm_const",     (("lf_pm_slope",         "avg_rng_lf", "rng_ip_dist_lf"),)),
    ("cf_pm_const",     (("cf_pm_slope",         "avg_rng_cf", "rng_ip_dist_cf"),)),
    ("rf_pm_const",     (("rf_pm_slope",         "avg_rng_rf", "rng_ip_dist_rf"),)),
    ("c_frm_const",     (("c_frm_slope",         "avg_frm_c",  "frm_ip_dist_c"),)),
    ("c_rto_const",     (("c_rto_slope",         "avg_arm_c",  "arm_ip_dist_c"),)),
)


def _with_centred_fielding_consts(
    fielding_reg: FieldingRegressionCoeffs, fielding: FieldingParams
) -> FieldingRegressionCoeffs:
    """OOTP-27 only: centre every piecewise fielding channel on its league population (C3).

    The 27 curves anchor delta = 0 at the position's average RATING, which centres the average
    player but not the population whenever the curve bends there (Jensen gap: ~+5 runs at 2B's
    convex ramp, ~−5 at the clamped corner-OF curves — items 1.0/2.8, FIELDING_PIPELINE_27).
    Setting ``const = −E_w[Σ piecewise_delta]`` over the SAME IP-weighted population that
    defines the avg makes the population-mean channel value exactly zero by construction, for
    any curve shape, any league, any future engine.

    Dispatch: a channel is touched only when at least one of its slope terms is
    ``PiecewiseCoeffs`` — every 26 path (scalar/linear slopes) passes through byte-identical.
    A piecewise channel whose distribution is missing keeps its const and WARNS LOUDLY: the
    population mean will not be zero and the metadata should be rebuilt (cache version ≥ 7).
    """
    from src.utils import piecewise_delta

    updates: dict = {}
    report: list[str] = []
    for const_attr, terms in _FIELDING_CENTRE_CHANNELS:
        piecewise_terms = [
            t for t in terms
            if isinstance(getattr(fielding_reg, t[0], None), PiecewiseCoeffs)
        ]
        if not piecewise_terms:
            continue
        e_total = 0.0
        missing = False
        for slope_attr, avg_attr, dist_attr in piecewise_terms:
            dist = getattr(fielding, dist_attr, None) if dist_attr else None
            if not dist:
                print(f"⚠️  OOTP-27 centring SKIPPED for {const_attr} ({slope_attr}): no "
                      f"{dist_attr or 'distribution'} in league metadata — population-mean "
                      f"runsP will NOT be centred at this position. Rebuild metadata "
                      f"(cache v7+) to fix.")
                missing = True
                break
            total = float(sum(w for _, w in dist))
            if total <= 0:
                missing = True
                break
            coeffs = getattr(fielding_reg, slope_attr)
            avg = float(getattr(fielding, avg_attr))
            e_total += sum(
                w * float(piecewise_delta(float(v), avg, coeffs)) for v, w in dist
            ) / total
        if missing:
            continue
        updates[const_attr] = -e_total
        report.append(f"{const_attr}={-e_total:+.6f}")
    if updates:
        print("OOTP-27 fielding centring (C3): " + " · ".join(report))
        return dataclasses.replace(fielding_reg, **updates)
    return fielding_reg


def check_fielding_conversion_27(fielding: FieldingParams) -> None:
    """Build gate for a 27 league's fielding conversion inputs (change C2).

    Prints the fit-vs-deploy chance-count table (visibility: the fit substrate is by design
    allocation-unrepresentative, rule C5) and raises MetadataVersionError when a deployed
    per-position chance count drifts more than FIELDING_DEPLOY_PA_REL_TOL from its real-27
    anchor — the signature of wrong-era or corrupted metadata, which season-to-season noise
    (~1%) cannot produce.
    """
    from src.data_points import (
        FIELDING_DEPLOY_PA_ANCHORS_27,
        FIELDING_DEPLOY_PA_REL_TOL,
        FIELDING_FIT_ENV_27,
        FIELDING_RESPONSE_FACTORS_27,
    )
    pa_attr = {"1b": "first_pa", "2b": "second_pa", "3b": "third_pa", "ss": "ss_pa",
               "lf": "lf_pa", "cf": "cf_pa", "rf": "rf_pa"}
    print("OOTP-27 fielding conversion (C2 gate): pos  deploy_pa  anchor  fit_env  response")
    failures: list[str] = []
    for pos, attr in pa_attr.items():
        deploy = float(getattr(fielding, attr))
        anchor = FIELDING_DEPLOY_PA_ANCHORS_27[pos]
        fit = FIELDING_FIT_ENV_27[pos].chances_per_1200
        factor = FIELDING_RESPONSE_FACTORS_27[pos]
        rel = deploy / anchor - 1.0 if anchor else 0.0
        flag = "  ⚠️ DRIFT" if abs(rel) > FIELDING_DEPLOY_PA_REL_TOL else ""
        print(f"  {pos.upper():3s} {deploy:9.1f} {anchor:7.1f} {fit:8.1f} {factor:9.2f}"
              f"  ({rel:+.1%} vs anchor){flag}")
        if abs(rel) > FIELDING_DEPLOY_PA_REL_TOL:
            failures.append(f"{pos.upper()} deploy {deploy:.1f} vs anchor {anchor:.1f} ({rel:+.1%})")
    if failures:
        raise MetadataVersionError(
            "OOTP-27 deployment chance counts drifted beyond ±"
            f"{FIELDING_DEPLOY_PA_REL_TOL:.0%} of the real-27 anchors: {'; '.join(failures)}. "
            "This is the wrong-era/corrupt-metadata signature (season noise is ~1%). Check the "
            "league's metadata year-dirs and engineFirstSeason; if the league has genuinely "
            "shifted, re-derive the anchors (data_points.FIELDING_DEPLOY_PA_ANCHORS_27) with "
            "referee sign-off."
        )


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

    # OOTP-27 F1 fix: league-adaptive hitter sba c0 (no-op for 26 LinearCoeffs/CubicCoeffs).
    hitting_reg = _with_league_adaptive_sba_c0(hitting_reg, hitting)
    # OOTP-27 C3: population-centre the piecewise fielding channels (no-op for 26 scalars).
    fielding_reg = _with_centred_fielding_consts(fielding_reg, fielding)

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
