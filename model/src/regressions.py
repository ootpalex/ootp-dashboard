"""
src/regressions.py — Compute regression coefficients from OOTP simulation data.

Implements Weighted Least Squares (WLS) to produce the same coefficients that
are hardcoded in data_points.py. Fed by the 17 CSVs in
data/regressions/ootp<version>/ (e.g. data/regressions/ootp26/, originally
extracted from 25 Regressions.xlsx). When migrating to a new OOTP version,
drop new sim CSVs into a sibling directory (e.g. data/regressions/ootp27/)
and re-run this pipeline against that path to produce updated coefficients.

Pipeline:
    1. Load & aggregate sim data (5 sims → one row per player)
    2. Join with player ratings
    3. Compute stat rates (outcome variables)
    4. Run WLS regressions (piecewise linear or cubic)
    5. Return coefficient dataclasses matching data_points.py types

WLS math (from REGRESSIONS_ANALYSIS.md):
    W = weight (PA for hitting, BF for pitching, IP for fielding)
    X = rating − weighted_avg_rating  (centered predictor)
    Y = stat_rate − weighted_avg_stat (centered outcome)

    slope     = (ΣW·ΣwXY − ΣwX·ΣwY) / (ΣW·ΣwX² − (ΣwX)²)
    intercept = (ΣwY − slope·ΣwX) / ΣW
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from src.data_points import (
    CubicCoeffs,
    FieldingRegressionCoeffs,
    HittingRegressionCoeffs,
    LinearCoeffs,
    PitchingRegressionCoeffs,
)


# ---------------------------------------------------------------------------
# Data container
# ---------------------------------------------------------------------------


@dataclass
class RegressionInputs:
    """Aggregated simulation data joined with player ratings."""

    hitting: pd.DataFrame        # ~441 rows: batting (split_id=3) + hitter ratings
    hitting_br: pd.DataFrame     # ~441 rows: batting (split_id=1) for baserunning
    sp: pd.DataFrame             # ~160 rows: pitching split_id=3 + SP pitcher ratings
    rp: pd.DataFrame             # ~224 rows: pitching split_id=3 + RP/CL pitcher ratings
    sp_br: pd.DataFrame          # ~160 rows: pitching split_id=1 (has sb/cs) + SP ratings
    rp_br: pd.DataFrame          # ~224 rows: pitching split_id=1 (has sb/cs) + RP ratings
    fielding: dict[str, pd.DataFrame]  # keyed by position: "c", "1b", "2b", ...
    team_dp_rates: dict | None = None  # team_id → {"dp_2b_ip", "dp_ss_ip"}


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def _load_answer_key_ids(regressions_dir: Path) -> dict:
    """Load player ID subsets from calibration JSONs (if available)."""
    calibration_dir = regressions_dir / "calibration"
    ids = {}
    for name in ("hitting_reg_players", "pitching_reg_players", "fielding_reg_players"):
        path = calibration_dir / f"{name}.json"
        if path.exists():
            ids[name] = json.loads(path.read_text())
    return ids


def _load_team_dp_rates(regressions_dir: Path) -> dict | None:
    """Load team-level DP/IP rates extracted from the Excel DP section.

    Returns dict with:
      - int team_id keys → {"dp_2b_ip": float, "dp_ss_ip": float}
      - "_ss_linest_player_ids" → list of 25 SS player IDs (Bug 9 replication)

    Returns None if the file doesn't exist.
    """
    path = regressions_dir / "calibration" / "team_dp_rates.json"
    if not path.exists():
        return None
    raw = json.loads(path.read_text())
    result = {}
    for k, v in raw.items():
        if k.startswith("_"):
            result[k] = v  # metadata keys preserved as-is
        else:
            result[int(k)] = v  # team_id keys converted to int
    return result


def _concat_sims(regressions_dir: Path, prefix: str, n: int = 5) -> pd.DataFrame:
    """Concatenate n sim CSVs into one DataFrame."""
    frames = []
    for i in range(1, n + 1):
        path = regressions_dir / f"{prefix}_sim_{i}.csv"
        df = pd.read_csv(path, low_memory=False)
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def _aggregate_batting(sims: pd.DataFrame, split_id: int) -> pd.DataFrame:
    """Filter by split_id, group by player_id, sum all counting stats."""
    filtered = sims[sims["split_id"] == split_id]
    numeric_cols = [c for c in filtered.select_dtypes(include="number").columns if c != "player_id"]
    return filtered.groupby("player_id")[numeric_cols].sum().reset_index()


def _aggregate_pitching(sims: pd.DataFrame, split_id: int) -> pd.DataFrame:
    """Filter pitching sims by split_id, group by player_id, sum."""
    filtered = sims[sims["split_id"] == split_id]
    numeric_cols = [c for c in filtered.select_dtypes(include="number").columns if c != "player_id"]
    return filtered.groupby("player_id")[numeric_cols].sum().reset_index()


def _aggregate_fielding_by_position(sims: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Aggregate fielding sims by position, returning per-position DataFrames.

    Position codes in OOTP: 2=C, 3=1B, 4=2B, 5=3B, 6=SS, 7=LF, 8=CF, 9=RF

    Also determines each player's primary team_id (team with most IP at that
    position) and includes it in the result as ``primary_team_id``.
    """
    pos_map = {2: "c", 3: "1b", 4: "2b", 5: "3b", 6: "ss", 7: "lf", 8: "cf", 9: "rf"}
    result = {}
    numeric_cols = sims.select_dtypes(include="number").columns.tolist()
    numeric_cols = [c for c in numeric_cols if c not in ("player_id", "position", "team_id")]

    for pos_code, pos_name in pos_map.items():
        pos_data = sims[sims["position"] == pos_code]
        if len(pos_data) == 0:
            continue
        agg = pos_data.groupby("player_id")[numeric_cols].sum().reset_index()

        # Determine primary team_id: team where player accumulated the most IP
        primary_team = (
            pos_data.groupby(["player_id", "team_id"])["ip"]
            .sum()
            .reset_index()
            .sort_values("ip", ascending=False)
            .drop_duplicates(subset="player_id", keep="first")[["player_id", "team_id"]]
        )
        primary_team = primary_team.rename(columns={"team_id": "primary_team_id"})
        agg = agg.merge(primary_team, on="player_id", how="left")
        result[pos_name] = agg

    return result


def load_regression_inputs(regressions_dir: Path | str) -> RegressionInputs:
    """Load and aggregate all simulation data, join with ratings.

    Returns a RegressionInputs with one row per player per data type,
    filtered to the exact player sets used in the regression sheets.
    """
    regressions_dir = Path(regressions_dir)
    answer_keys = _load_answer_key_ids(regressions_dir)

    # --- Hitter ratings ---
    hitters_ratings = pd.read_csv(regressions_dir / "hitters_ratings.csv", low_memory=False)
    hitters_ratings["ID"] = pd.to_numeric(hitters_ratings["ID"], errors="coerce").astype("Int64")

    # --- Batting sims ---
    batting_sims = _concat_sims(regressions_dir, "batting")
    batting_agg = _aggregate_batting(batting_sims, split_id=3)
    batting_br = _aggregate_batting(batting_sims, split_id=1)

    # Join with ratings
    hitting = batting_agg.merge(hitters_ratings, left_on="player_id", right_on="ID", how="inner")
    hitting_br = batting_br.merge(hitters_ratings, left_on="player_id", right_on="ID", how="inner")

    # Filter to answer-key player IDs
    if "hitting_reg_players" in answer_keys:
        hit_ids = set(answer_keys["hitting_reg_players"])
        hitting = hitting[hitting["player_id"].isin(hit_ids)].reset_index(drop=True)
        hitting_br = hitting_br[hitting_br["player_id"].isin(hit_ids)].reset_index(drop=True)

    # --- Pitcher ratings ---
    pitchers_ratings = pd.read_csv(regressions_dir / "pitchers_ratings.csv", low_memory=False)
    pitchers_ratings["ID"] = pd.to_numeric(pitchers_ratings["ID"], errors="coerce").astype("Int64")

    # --- Pitching sims ---
    # RP regression sheet filters gs=0 per row (relief appearances only).
    # SP uses all rows. We aggregate separately for SP and RP.
    pitching_sims = _concat_sims(regressions_dir, "pitching")
    pitching_agg = _aggregate_pitching(pitching_sims, split_id=3)
    pitching_br_agg = _aggregate_pitching(pitching_sims, split_id=1)

    # RP-specific aggregation: only relief appearances (gs=0)
    rp_sims = pitching_sims[pitching_sims["gs"] == 0]
    rp_pitching_agg = _aggregate_pitching(rp_sims, split_id=3)
    rp_pitching_br_agg = _aggregate_pitching(rp_sims, split_id=1)

    # Join with ratings (SP uses full aggregation, RP uses gs=0 aggregation)
    sp_joined = pitching_agg.merge(
        pitchers_ratings, left_on="player_id", right_on="ID", how="inner"
    )
    rp_joined = rp_pitching_agg.merge(
        pitchers_ratings, left_on="player_id", right_on="ID", how="inner"
    )
    sp_br_joined = pitching_br_agg.merge(
        pitchers_ratings, left_on="player_id", right_on="ID", how="inner"
    )
    rp_br_joined = rp_pitching_br_agg.merge(
        pitchers_ratings, left_on="player_id", right_on="ID", how="inner"
    )

    # Split SP / RP by answer key player IDs
    if "pitching_reg_players" in answer_keys:
        sp_ids = set(answer_keys["pitching_reg_players"]["sp"])
        rp_ids = set(answer_keys["pitching_reg_players"]["rp"])
        sp = sp_joined[sp_joined["player_id"].isin(sp_ids)].reset_index(drop=True)
        rp = rp_joined[rp_joined["player_id"].isin(rp_ids)].reset_index(drop=True)
        sp_br = sp_br_joined[sp_br_joined["player_id"].isin(sp_ids)].reset_index(drop=True)
        rp_br = rp_br_joined[rp_br_joined["player_id"].isin(rp_ids)].reset_index(drop=True)
    else:
        # Fallback: classify by POS column
        sp = sp_joined[sp_joined["POS"] == "SP"].reset_index(drop=True)
        rp = rp_joined[rp_joined["POS"] != "SP"].reset_index(drop=True)
        sp_br = sp_br_joined[sp_br_joined["POS"] == "SP"].reset_index(drop=True)
        rp_br = rp_br_joined[rp_br_joined["POS"] != "SP"].reset_index(drop=True)

    # --- Fielding sims ---
    fielding_sims = _concat_sims(regressions_dir, "fielding")
    fielding_by_pos = _aggregate_fielding_by_position(fielding_sims)

    # Join ALL fielding positions with hitter ratings (C FRM, C ARM, IF RNG, etc.)
    fielding_joined = {}
    fielding_ids = answer_keys.get("fielding_reg_players", {})

    for pos_name, pos_df in fielding_by_pos.items():
        merged = pos_df.merge(hitters_ratings, left_on="player_id", right_on="ID", how="inner")
        if pos_name in fielding_ids:
            pos_id_set = set(fielding_ids[pos_name])
            merged = merged[merged["player_id"].isin(pos_id_set)].reset_index(drop=True)
        fielding_joined[pos_name] = merged

    # --- Team-level DP rates (from Excel Data Model) ---
    team_dp_rates = _load_team_dp_rates(regressions_dir)

    return RegressionInputs(
        hitting=hitting,
        hitting_br=hitting_br,
        sp=sp,
        rp=rp,
        sp_br=sp_br,
        rp_br=rp_br,
        fielding=fielding_joined,
        team_dp_rates=team_dp_rates,
    )


# ---------------------------------------------------------------------------
# WLS engine
# ---------------------------------------------------------------------------


def _wls_single(x: np.ndarray, y: np.ndarray, w: np.ndarray) -> tuple[float, float]:
    """Single-variable WLS regression.

    Parameters
    ----------
    x : centered predictor (rating - avg)
    y : centered outcome (stat - avg)
    w : weights (PA, BF, or IP)

    Returns
    -------
    (intercept, slope)

    Formula (from REGRESSIONS_ANALYSIS.md):
        slope = (ΣW·ΣwXY − ΣwX·ΣwY) / (ΣW·ΣwX² − (ΣwX)²)
        intercept = (ΣwY − slope·ΣwX) / ΣW
    """
    sum_w = np.sum(w)
    sum_wx = np.sum(w * x)
    sum_wy = np.sum(w * y)
    sum_wxy = np.sum(w * x * y)
    sum_wx2 = np.sum(w * x * x)

    denom = sum_w * sum_wx2 - sum_wx * sum_wx
    slope = (sum_w * sum_wxy - sum_wx * sum_wy) / denom
    intercept = (sum_wy - slope * sum_wx) / sum_w

    return intercept, slope


def _ols_single(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """Single-variable OLS regression (unweighted LINEST).

    Used by fielding regressions which use plain LINEST, not weighted.
    """
    n = len(x)
    sum_x = np.sum(x)
    sum_y = np.sum(y)
    sum_xy = np.sum(x * y)
    sum_x2 = np.sum(x * x)

    denom = n * sum_x2 - sum_x * sum_x
    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n

    return intercept, slope


def _ols_multi(
    x1: np.ndarray, x2: np.ndarray, y: np.ndarray
) -> tuple[float, float, float]:
    """Two-variable OLS regression (unweighted LINEST).

    Returns (intercept, slope1, slope2).
    """
    n = len(y)
    ones = np.ones(n)

    A = np.array([
        [n, np.sum(x1), np.sum(x2)],
        [np.sum(x1), np.sum(x1 * x1), np.sum(x1 * x2)],
        [np.sum(x2), np.sum(x1 * x2), np.sum(x2 * x2)],
    ])
    b = np.array([np.sum(y), np.sum(x1 * y), np.sum(x2 * y)])

    coeffs = np.linalg.solve(A, b)
    return coeffs[0], coeffs[1], coeffs[2]


def _wls_multi(
    x1: np.ndarray, x2: np.ndarray, y: np.ndarray, w: np.ndarray
) -> tuple[float, float, float]:
    """Two-variable WLS regression.

    Returns (intercept, slope1, slope2) by solving the 3×3 normal equation system.
    """
    sum_w = np.sum(w)
    sum_wx1 = np.sum(w * x1)
    sum_wx2 = np.sum(w * x2)
    sum_wy = np.sum(w * y)
    sum_wx1y = np.sum(w * x1 * y)
    sum_wx2y = np.sum(w * x2 * y)
    sum_wx1_sq = np.sum(w * x1 * x1)
    sum_wx2_sq = np.sum(w * x2 * x2)
    sum_wx1x2 = np.sum(w * x1 * x2)

    A = np.array([
        [sum_w, sum_wx1, sum_wx2],
        [sum_wx1, sum_wx1_sq, sum_wx1x2],
        [sum_wx2, sum_wx1x2, sum_wx2_sq],
    ])
    b = np.array([sum_wy, sum_wx1y, sum_wx2y])

    coeffs = np.linalg.solve(A, b)
    return coeffs[0], coeffs[1], coeffs[2]


def _wls_cubic(x: np.ndarray, y: np.ndarray, w: np.ndarray) -> CubicCoeffs:
    """Cubic polynomial WLS regression.

    Solves the 4×4 normal equation system for:
        y = c0 + c1*x + c2*x² + c3*x³

    In OOTP 26, c2 ≈ 0 and c3 ≈ 0 but the full cubic is computed.
    """
    x2 = x * x
    x3 = x * x2

    # Build the normal equation matrix
    sum_w = np.sum(w)
    sum_wx = np.sum(w * x)
    sum_wx2 = np.sum(w * x2)
    sum_wx3 = np.sum(w * x3)
    sum_wx4 = np.sum(w * x2 * x2)
    sum_wx5 = np.sum(w * x2 * x3)
    sum_wx6 = np.sum(w * x3 * x3)

    sum_wy = np.sum(w * y)
    sum_wxy = np.sum(w * x * y)
    sum_wx2y = np.sum(w * x2 * y)
    sum_wx3y = np.sum(w * x3 * y)

    A = np.array([
        [sum_w, sum_wx, sum_wx2, sum_wx3],
        [sum_wx, sum_wx2, sum_wx3, sum_wx4],
        [sum_wx2, sum_wx3, sum_wx4, sum_wx5],
        [sum_wx3, sum_wx4, sum_wx5, sum_wx6],
    ])
    b_vec = np.array([sum_wy, sum_wxy, sum_wx2y, sum_wx3y])

    coeffs = np.linalg.solve(A, b_vec)
    return CubicCoeffs(c0=coeffs[0], c1=coeffs[1], c2=coeffs[2], c3=coeffs[3])


# ---------------------------------------------------------------------------
# Piecewise linear regression helper
# ---------------------------------------------------------------------------


def _compute_linear_coeffs(
    rating: np.ndarray,
    stat_rate: np.ndarray,
    weight: np.ndarray,
) -> LinearCoeffs:
    """Piecewise linear WLS: center at PA-weighted average, split at 50.

    HIGH model: players with rating >= 50
    LOW model:  players with rating < 50

    Centering is at the PA-weighted average rating (produces the correct
    slopes by removing collinearity). The HIGH/LOW split is at rating=50,
    matching the application in rating_to_delta().
    """
    # Filter out NaN/inf in any array
    valid = np.isfinite(rating) & np.isfinite(stat_rate) & np.isfinite(weight)
    rating, stat_rate, weight = rating[valid], stat_rate[valid], weight[valid]

    # Compute weight-averaged centering points
    avg_rating = np.average(rating, weights=weight)
    avg_stat = np.average(stat_rate, weights=weight)

    # Center
    x = rating - avg_rating
    y = stat_rate - avg_stat

    # Split at rating = 50 (matches application split point)
    high_mask = rating >= 50
    low_mask = ~high_mask

    h_intercept, h_slope = _wls_single(x[high_mask], y[high_mask], weight[high_mask])
    l_intercept, l_slope = _wls_single(x[low_mask], y[low_mask], weight[low_mask])

    return LinearCoeffs(
        h_const=h_intercept,
        h_slope=h_slope,
        l_const=l_intercept,
        l_slope=l_slope,
    )


def _compute_single_linear_coeffs(
    rating: np.ndarray,
    stat_rate: np.ndarray,
    weight: np.ndarray,
) -> tuple[float, float]:
    """Single-segment linear WLS (no high/low split). Used for hitting/pitching."""
    # Filter out NaN/inf in any array
    valid = np.isfinite(rating) & np.isfinite(stat_rate) & np.isfinite(weight)
    rating, stat_rate, weight = rating[valid], stat_rate[valid], weight[valid]
    avg_rating = np.average(rating, weights=weight)
    avg_stat = np.average(stat_rate, weights=weight)
    x = rating - avg_rating
    y = stat_rate - avg_stat
    return _wls_single(x, y, weight)


def _compute_single_ols_coeffs(
    rating: np.ndarray,
    stat_rate: np.ndarray,
) -> tuple[float, float]:
    """Single-segment OLS regression (unweighted). Used for fielding.

    The Excel fielding regressions use plain LINEST (unweighted OLS)
    with simple averages for centering, not IP-weighted averages.
    """
    valid = np.isfinite(rating) & np.isfinite(stat_rate)
    rating, stat_rate = rating[valid], stat_rate[valid]
    avg_rating = np.mean(rating)
    avg_stat = np.mean(stat_rate)
    x = rating - avg_rating
    y = stat_rate - avg_stat
    return _ols_single(x, y)


def _compute_cubic_coeffs(
    rating: np.ndarray,
    stat_rate: np.ndarray,
    weight: np.ndarray,
) -> CubicCoeffs:
    """Cubic polynomial WLS regression (no high/low split)."""
    # Filter out NaN/inf in any array
    valid = np.isfinite(rating) & np.isfinite(stat_rate) & np.isfinite(weight)
    rating, stat_rate, weight = rating[valid], stat_rate[valid], weight[valid]
    avg_rating = np.average(rating, weights=weight)
    avg_stat = np.average(stat_rate, weights=weight)
    x = rating - avg_rating
    y = stat_rate - avg_stat
    return _wls_cubic(x, y, weight)


def _compute_linear_as_cubic(
    rating: np.ndarray,
    stat_rate: np.ndarray,
    weight: np.ndarray,
) -> CubicCoeffs:
    """Linear WLS stored as CubicCoeffs (c2=c3=0).

    The hitting SBA/SB%/UBR regressions are linear in the spreadsheet
    (only slope and intercept columns), stored in a cubic-ready format.
    """
    valid = np.isfinite(rating) & np.isfinite(stat_rate) & np.isfinite(weight)
    rating, stat_rate, weight = rating[valid], stat_rate[valid], weight[valid]
    avg_rating = np.average(rating, weights=weight)
    avg_stat = np.average(stat_rate, weights=weight)
    x = rating - avg_rating
    y = stat_rate - avg_stat
    intercept, slope = _wls_single(x, y, weight)
    return CubicCoeffs(c0=intercept, c1=slope)


# ---------------------------------------------------------------------------
# Stat rate formulas — Hitting
# ---------------------------------------------------------------------------
# Regression rate formulas (from 25 Regressions.xlsx "Hitting Reg" sheet):
#   uBB% = (BB - IBB) / (PA - IBB - HBP)
#   HR%  = HR / (PA - IBB - BB - HBP)
#   K%   = K  / (PA - IBB - BB - HBP)
#   BABIP= (H - HR) / (AB - K - HR + SF)
#   XBH% = (D + T) / (H - HR)
#   3B%  = T / (D + T)


def _hitting_bb_rate(df: pd.DataFrame) -> np.ndarray:
    """uBB% = (BB - IBB) / (PA - IBB - HBP)"""
    return ((df["bb"] - df["ibb"]) / (df["pa"] - df["ibb"] - df["hp"])).values


def _hitting_hr_rate(df: pd.DataFrame) -> np.ndarray:
    """HR% = HR / (PA - IBB - BB - HBP)"""
    denom = df["pa"] - df["ibb"] - df["bb"] - df["hp"]
    return (df["hr"] / denom).values


def _hitting_k_rate(df: pd.DataFrame) -> np.ndarray:
    """K% = K / (PA - IBB - BB - HBP)"""
    denom = df["pa"] - df["ibb"] - df["bb"] - df["hp"]
    return (df["k"] / denom).values


def _hitting_babip(df: pd.DataFrame) -> np.ndarray:
    """BABIP = (H-HR) / (AB - K - HR + SF)  (standard formula)"""
    denom = df["ab"] - df["k"] - df["hr"] + df["sf"]
    return ((df["h"] - df["hr"]) / denom).values


def _hitting_xbh_rate(df: pd.DataFrame) -> np.ndarray:
    """XBH% = (D + T) / (H - HR)"""
    return ((df["d"] + df["t"]) / (df["h"] - df["hr"])).values


def _hitting_triple_rate(df: pd.DataFrame) -> np.ndarray:
    """3B% = T / (D + T)

    Players with D+T=0 produce NaN (division by zero), which is correct:
    Excel's LINEST silently excludes DIV/0 rows. The downstream
    ``_compute_linear_coeffs`` ``np.isfinite`` filter handles NaN exclusion.
    """
    denom = df["d"] + df["t"]
    return (df["t"] / denom).values


def _hitting_sba_rate(df: pd.DataFrame) -> np.ndarray:
    """SBA rate = (SB + CS) / (1B + BB + HBP)  [uses total BB, not uBB]"""
    singles = df["h"] - df["d"] - df["t"] - df["hr"]
    opportunities = singles + df["bb"] + df["hp"]
    return ((df["sb"] + df["cs"]) / opportunities).values


def _hitting_sb_pct(df: pd.DataFrame) -> np.ndarray:
    """SB% = SB / (SB + CS)"""
    total = df["sb"] + df["cs"]
    result = df["sb"] / total
    return result.fillna(0).values


def _hitting_ubr_rate(df: pd.DataFrame) -> np.ndarray:
    """UBR rate = UBR / base_opp (baserunning opportunities)"""
    singles = df["h"] - df["d"] - df["t"] - df["hr"]
    base_opp = (singles + df["bb"] + df["hp"]) * 3 + df["d"] * 2 + df["t"] * 2 + df["sb"] * (-1) + df["cs"] * (-3)
    return (df["ubr"] / base_opp).values


# ---------------------------------------------------------------------------
# Stat rate formulas — Pitching
# ---------------------------------------------------------------------------
# Regression rate formulas (from 25 Regressions.xlsx "Pitching Reg" sheet):
#   uBB% = (BB - IW) / (BF - IW - HP)
#   HR%  = HRA / (BF - BB - HP)
#   K%   = K / (BF - BB - HP)
#   BABIP= (HA - HRA) / (AB - HRA - K + SF)
#   SBA  = (SB + CS) / (BB + HP + SA)   [SA = singles allowed]
#   SB%  = SB / (SB + CS)


def _pitching_bb_rate(df: pd.DataFrame) -> np.ndarray:
    """uBB% = (BB - IW) / (BF - IW - HP)"""
    return ((df["bb"] - df["iw"]) / (df["bf"] - df["iw"] - df["hp"])).values


def _pitching_hr_rate(df: pd.DataFrame) -> np.ndarray:
    """HR% = HRA / (BF - BB - HP)"""
    denom = df["bf"] - df["bb"] - df["hp"]
    return (df["hra"] / denom).values


def _pitching_k_rate(df: pd.DataFrame) -> np.ndarray:
    """K% = K / (BF - BB - HP)"""
    denom = df["bf"] - df["bb"] - df["hp"]
    return (df["k"] / denom).values


def _pitching_babip(df: pd.DataFrame) -> np.ndarray:
    """BABIP = (HA - HRA) / (AB - HRA - K + SF)"""
    denom = df["ab"] - df["hra"] - df["k"] + df["sf"]
    return ((df["ha"] - df["hra"]) / denom).values


def _pitching_sba_rate(df: pd.DataFrame) -> np.ndarray:
    """SBA rate = (SB + CS) / (BB + HP + SA) where SA = singles allowed"""
    denom = df["bb"] + df["hp"] + df["sa"]
    return ((df["sb"] + df["cs"]) / denom).values


def _pitching_sb_pct(df: pd.DataFrame) -> np.ndarray:
    """SB% = SB / (SB + CS)"""
    total = df["sb"] + df["cs"]
    result = df["sb"] / total
    return result.fillna(0).values


# ---------------------------------------------------------------------------
# Stat rate formulas — Fielding
# ---------------------------------------------------------------------------


def _fielding_framing_rate(df: pd.DataFrame) -> np.ndarray:
    """Framing per IP"""
    return (df["framing"] / df["ip"]).values


def _fielding_sba_rate(df: pd.DataFrame) -> np.ndarray:
    """SBA per IP"""
    return (df["sba"] / df["ip"]).values


def _fielding_rto_rate(df: pd.DataFrame) -> np.ndarray:
    """RTO% = RTO / SBA"""
    return (df["rto"] / df["sba"]).values


def _fielding_pm_rate(df: pd.DataFrame) -> np.ndarray:
    """PM% = PM / PA (play opportunities)"""
    return (df["pm"] / df["pa"]).values


def _fielding_err_rate_ip(df: pd.DataFrame) -> np.ndarray:
    """Infield error rate = E / IP"""
    return (df["e"] / df["ip"]).values


def _fielding_err_rate_po(df: pd.DataFrame) -> np.ndarray:
    """Outfield error rate = E / PO (putouts)"""
    return (df["e"] / df["po"]).values


def _fielding_dp_rate(df: pd.DataFrame) -> np.ndarray:
    """DP rate = DP / IP (player-level, used as fallback only)."""
    return (df["dp"] / df["ip"]).values


def _compute_dp_ols(
    df: pd.DataFrame,
    team_dp_rates: dict,
    dp_key: str,
    player_ids: list | None = None,
) -> tuple[float, float]:
    """OLS regression of team DP/IP ~ TDP for 2B or SS.

    The Excel's DP regression uses team-level DP/IP (from the Data Model)
    as the Y variable, looked up per player by team_id.  It uses ordinary
    least squares (unweighted LINEST), NOT WLS.

    Parameters
    ----------
    df : fielding DataFrame with TDP ratings and primary_team_id
    team_dp_rates : dict mapping team_id → {"dp_2b_ip", "dp_ss_ip"}
    dp_key : "dp_2b_ip" or "dp_ss_ip"
    player_ids : if set, only include these players (replicates SS LINEST Bug 9)

    Returns
    -------
    (intercept, slope)
    """
    if player_ids is not None:
        mask = df["player_id"].isin(set(player_ids))
        df = df[mask].reset_index(drop=True)

    tdp = _safe_rating(df, "TDP")

    # Look up each player's team DP/IP rate
    team_ids = df["primary_team_id"].values.astype(int)
    dp_ip = np.array([team_dp_rates[t][dp_key] for t in team_ids])

    # Center using arithmetic mean (matching Excel's unweighted approach)
    avg_tdp = np.mean(tdp)
    avg_dp_ip = np.mean(dp_ip)
    x = tdp - avg_tdp
    y = dp_ip - avg_dp_ip

    # OLS: slope = (n*Σxy - Σx*Σy) / (n*Σx² - (Σx)²)
    n = len(x)
    sum_x = np.sum(x)
    sum_y = np.sum(y)
    sum_xy = np.sum(x * y)
    sum_x2 = np.sum(x * x)
    denom = n * sum_x2 - sum_x * sum_x
    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n

    return intercept, slope


def _fielding_arm_rate(df: pd.DataFrame) -> np.ndarray:
    """Outfield arm value per PA"""
    return (df["arm"] / df["pa"]).values


# ---------------------------------------------------------------------------
# Hitting regressions
# ---------------------------------------------------------------------------

_LINEUP_SPOTS = 9  # batting order positions per team


def _filter_fulltime_br(
    hitting: pd.DataFrame, hitting_br: pd.DataFrame,
) -> pd.DataFrame:
    """Filter baserunning data to full-time players only.

    The spreadsheet uses only full-time everyday players for the SBA, SB%,
    and UBR regressions. With 32 teams this is 288 players (9 lineup spots
    per team). We compute this dynamically: count "real" teams (those with
    more than 1 player), then keep the top ``n_teams * 9`` players by PA.
    """
    team_counts = hitting["team_id"].value_counts()
    n_real_teams = int((team_counts > 1).sum())
    n_fulltime = n_real_teams * _LINEUP_SPOTS

    top_ids = set(
        hitting.nlargest(n_fulltime, "pa")["player_id"].values
    )
    return hitting_br[hitting_br["player_id"].isin(top_ids)].copy()


def compute_hitting_regressions(inputs: RegressionInputs) -> HittingRegressionCoeffs:
    """Compute all 9 hitting regression coefficients from aggregated sim data."""
    df = inputs.hitting
    br = inputs.hitting_br
    pa = df["pa"].values.astype(float)

    # --- 6 linear regressions (from split_id=3 data) ---
    eye_rating = pd.to_numeric(df["EYE vR"], errors="coerce").values.astype(float)
    pow_rating = pd.to_numeric(df["POW vR"], errors="coerce").values.astype(float)
    k_rating = pd.to_numeric(df["K vR"], errors="coerce").values.astype(float)
    ba_rating = pd.to_numeric(df["BA vR"], errors="coerce").values.astype(float)
    gap_rating = pd.to_numeric(df["GAP vR"], errors="coerce").values.astype(float)
    spe_rating = pd.to_numeric(df["SPE"], errors="coerce").values.astype(float)

    eye = _compute_linear_coeffs(eye_rating, _hitting_bb_rate(df), pa)
    power = _compute_linear_coeffs(pow_rating, _hitting_hr_rate(df), pa)
    k = _compute_linear_coeffs(k_rating, _hitting_k_rate(df), pa)
    babip = _compute_linear_coeffs(ba_rating, _hitting_babip(df), pa)
    gap = _compute_linear_coeffs(gap_rating, _hitting_xbh_rate(df), pa)
    speed = _compute_linear_coeffs(spe_rating, _hitting_triple_rate(df), pa)

    # --- 3 linear regressions stored in CubicCoeffs format (from split_id=1 data) ---
    # These are linear (c2=c3=0) but stored in cubic-ready format.
    # Weights use PA from split_id=3 data, looked up by player_id.
    # SBA% and SB% are filtered to high-rating players only.
    #
    # Full-time player filter: the spreadsheet only uses full-time players for
    # baserunning regressions. With 32 teams and 9 lineup spots, that's 288
    # players. We dynamically compute this as n_real_teams * 9, selecting the
    # top players by PA so it scales with different league sizes.
    br = _filter_fulltime_br(df, br)

    br_ste = pd.to_numeric(br["STE"], errors="coerce").values.astype(float)
    br_spe = pd.to_numeric(br["SPE"], errors="coerce").values.astype(float)
    br_run = pd.to_numeric(br["RUN"], errors="coerce").values.astype(float)

    # Look up PA from split_id=3 data for each baserunning player
    pa_lookup = df.set_index("player_id")["pa"]
    br_weight = br["player_id"].map(pa_lookup).values.astype(float)

    # SBA%: filter to STE >= 55 (78 players in answer key)
    sba_mask = br_ste >= 55
    sba = _compute_linear_as_cubic(
        br_ste[sba_mask], _hitting_sba_rate(br)[sba_mask], br_weight[sba_mask],
    )

    # SB%: filter to SPE >= 55 (71 players in answer key), X=STE
    sbpct_mask = br_spe >= 55
    sb_pct = _compute_linear_as_cubic(
        br_ste[sbpct_mask], _hitting_sb_pct(br)[sbpct_mask], br_weight[sbpct_mask],
    )

    # UBR: all full-time players, no rating filter, X=RUN
    ubr = _compute_linear_as_cubic(
        br_run, _hitting_ubr_rate(br), br_weight,
    )

    return HittingRegressionCoeffs(
        eye=eye,
        power=power,
        k=k,
        babip=babip,
        gap=gap,
        speed=speed,
        sba=sba,
        sb_pct=sb_pct,
        ubr=ubr,
    )


# ---------------------------------------------------------------------------
# Pitching regressions
# ---------------------------------------------------------------------------


def compute_pitching_regressions(inputs: RegressionInputs) -> PitchingRegressionCoeffs:
    """Compute all pitching regression coefficients (SP + RP linear + cubics)."""
    sp = inputs.sp
    rp = inputs.rp

    sp_bf = sp["bf"].values.astype(float)
    rp_bf = rp["bf"].values.astype(float)

    # SP ratings
    sp_con = pd.to_numeric(sp["CON vR"], errors="coerce").values.astype(float)
    sp_hrr = pd.to_numeric(sp["HRR vR"], errors="coerce").values.astype(float)
    sp_stu = pd.to_numeric(sp["STU vR"], errors="coerce").values.astype(float)
    sp_pbabip = pd.to_numeric(sp["PBABIP vR"], errors="coerce").values.astype(float)
    sp_hld = pd.to_numeric(sp["HLD"], errors="coerce").values.astype(float)

    # RP ratings
    rp_con = pd.to_numeric(rp["CON vR"], errors="coerce").values.astype(float)
    rp_hrr = pd.to_numeric(rp["HRR vR"], errors="coerce").values.astype(float)
    rp_stu = pd.to_numeric(rp["STU vR"], errors="coerce").values.astype(float)
    rp_pbabip = pd.to_numeric(rp["PBABIP vR"], errors="coerce").values.astype(float)
    rp_hld = pd.to_numeric(rp["HLD"], errors="coerce").values.astype(float)

    # SP linear (4 stats)
    sp_con_coeffs = _compute_linear_coeffs(sp_con, _pitching_bb_rate(sp), sp_bf)
    sp_hrr_coeffs = _compute_linear_coeffs(sp_hrr, _pitching_hr_rate(sp), sp_bf)
    sp_stu_coeffs = _compute_linear_coeffs(sp_stu, _pitching_k_rate(sp), sp_bf)
    # SP BABIP: single linear model (answer key has h==l to 12 decimals)
    sp_babip_int, sp_babip_slope = _compute_single_linear_coeffs(
        sp_pbabip, _pitching_babip(sp), sp_bf
    )
    sp_babip_coeffs = LinearCoeffs(
        h_const=sp_babip_int, h_slope=sp_babip_slope,
        l_const=sp_babip_int, l_slope=sp_babip_slope,
    )

    # RP linear (4 stats)
    rp_con_coeffs = _compute_linear_coeffs(rp_con, _pitching_bb_rate(rp), rp_bf)
    rp_hrr_coeffs = _compute_linear_coeffs(rp_hrr, _pitching_hr_rate(rp), rp_bf)
    rp_stu_coeffs = _compute_linear_coeffs(rp_stu, _pitching_k_rate(rp), rp_bf)
    # RP BABIP: single linear model (answer key has h==l to 12 decimals)
    rp_babip_int, rp_babip_slope = _compute_single_linear_coeffs(
        rp_pbabip, _pitching_babip(rp), rp_bf
    )
    rp_babip_coeffs = LinearCoeffs(
        h_const=rp_babip_int, h_slope=rp_babip_slope,
        l_const=rp_babip_int, l_slope=rp_babip_slope,
    )

    # Pitcher linear regressions stored as CubicCoeffs (SBA and SB% on HLD rating)
    # Uses split_id=1 data which has actual sb/cs counts (split_id=3 has zeros)
    sp_br = inputs.sp_br
    rp_br = inputs.rp_br
    sp_br_bf = sp_br["bf"].values.astype(float)
    rp_br_bf = rp_br["bf"].values.astype(float)
    sp_br_hld = pd.to_numeric(sp_br["HLD"], errors="coerce").values.astype(float)
    rp_br_hld = pd.to_numeric(rp_br["HLD"], errors="coerce").values.astype(float)

    sp_sba = _compute_linear_as_cubic(sp_br_hld, _pitching_sba_rate(sp_br), sp_br_bf)
    sp_sb_pct_coeffs = _compute_linear_as_cubic(sp_br_hld, _pitching_sb_pct(sp_br), sp_br_bf)

    # RP SB%: compute RP-specific intercept but reuse SP slope.
    # The spreadsheet uses the SP slope for both (SP has larger sample:
    # 5.96M BF vs 3.77M), storing separate c0 intercepts.
    rp_sb_pct_raw = _compute_linear_as_cubic(rp_br_hld, _pitching_sb_pct(rp_br), rp_br_bf)
    rp_sb_pct_coeffs = CubicCoeffs(c0=rp_sb_pct_raw.c0, c1=sp_sb_pct_coeffs.c1)

    # SBA is shared between SP and RP (same coefficients from SP data)
    sba = sp_sba

    return PitchingRegressionCoeffs(
        sp_con=sp_con_coeffs,
        sp_hrr=sp_hrr_coeffs,
        sp_stu=sp_stu_coeffs,
        sp_babip=sp_babip_coeffs,
        rp_con=rp_con_coeffs,
        rp_hrr=rp_hrr_coeffs,
        rp_stu=rp_stu_coeffs,
        rp_babip=rp_babip_coeffs,
        sp_sb_pct=sp_sb_pct_coeffs,
        rp_sb_pct=rp_sb_pct_coeffs,
        sba=sba,
    )


# ---------------------------------------------------------------------------
# Fielding regressions
# ---------------------------------------------------------------------------


def _safe_rating(df: pd.DataFrame, col: str) -> np.ndarray:
    """Read a rating column, coercing non-numeric to NaN then to float."""
    return pd.to_numeric(df[col], errors="coerce").values.astype(float)


def _parse_height_cm(ht_series: pd.Series) -> np.ndarray:
    """Convert height string like '6\\' 2\"' to centimeters.

    Vectorized: regex extracts feet + optional inches; non-matching rows yield NaN.
    """
    ext = ht_series.astype(str).str.extract(r"(\d+)\s*'\s*(\d*)")
    feet = pd.to_numeric(ext[0], errors="coerce")
    inches = pd.to_numeric(ext[1], errors="coerce").fillna(0)
    return (feet * 30.48 + inches * 2.54).to_numpy(dtype=float)


def compute_fielding_regressions(inputs: RegressionInputs) -> FieldingRegressionCoeffs:
    """Compute all fielding regression coefficients."""
    fd = inputs.fielding
    coeffs = {}

    # ── Catcher ────────────────────────────────────────────────────────────
    if "c" in fd:
        c_df = fd["c"]

        # FRM: C FRM rating → framing/ip (OLS)
        c_frm_rating = _safe_rating(c_df, "C FRM")
        c_frm_int, c_frm_slope = _compute_single_ols_coeffs(
            c_frm_rating, _fielding_framing_rate(c_df)
        )
        coeffs["c_frm_const"] = c_frm_int
        coeffs["c_frm_slope"] = c_frm_slope

        # SBA: C ARM rating → sba/ip (OLS)
        c_arm_rating = _safe_rating(c_df, "C ARM")
        c_sba_int, c_sba_slope = _compute_single_ols_coeffs(
            c_arm_rating, _fielding_sba_rate(c_df)
        )
        coeffs["c_sba_const"] = c_sba_int
        coeffs["c_sba_slope"] = c_sba_slope

        # RTO: C ARM rating → rto/sba (OLS, filtered to rows with sba > 0)
        has_sba = c_df["sba"] > 0
        if has_sba.sum() > 5:
            c_rto_df = c_df[has_sba]
            c_rto_arm = _safe_rating(c_rto_df, "C ARM")
            c_rto_int, c_rto_slope = _compute_single_ols_coeffs(
                c_rto_arm, _fielding_rto_rate(c_rto_df)
            )
        else:
            c_rto_int, c_rto_slope = _compute_single_ols_coeffs(
                c_arm_rating, _fielding_rto_rate(c_df)
            )
        coeffs["c_rto_const"] = c_rto_int
        coeffs["c_rto_slope"] = c_rto_slope

    # ── 1B (multi-variable: IF RNG + HT) ─────────────────────────────────
    if "1b" in fd:
        b1_df = fd["1b"]

        b1_rng = _safe_rating(b1_df, "IF RNG")
        b1_ht = _parse_height_cm(b1_df["HT"]) if "HT" in b1_df.columns else _safe_rating(b1_df, "HT CM")

        # PM%: 2-variable OLS (filter NaN from pm_rate)
        b1_pm_rate = _fielding_pm_rate(b1_df)
        valid = np.isfinite(b1_rng) & np.isfinite(b1_ht) & np.isfinite(b1_pm_rate)
        v_rng, v_ht, v_pm = b1_rng[valid], b1_ht[valid], b1_pm_rate[valid]
        avg_rng = np.mean(v_rng)
        avg_ht = np.mean(v_ht)
        avg_pm = np.mean(v_pm)
        b1_pm_int, b1_pm_rng_slope, b1_pm_ht_slope = _ols_multi(
            v_rng - avg_rng, v_ht - avg_ht, v_pm - avg_pm
        )
        coeffs["first_pm_const"] = b1_pm_int
        coeffs["first_pm_rng_slope"] = b1_pm_rng_slope
        coeffs["first_pm_ht_slope"] = b1_pm_ht_slope

        # ERR: single OLS
        b1_err_rating = _safe_rating(b1_df, "IF ERR")
        b1_err_int, b1_err_slope = _compute_single_ols_coeffs(
            b1_err_rating, _fielding_err_rate_ip(b1_df)
        )
        coeffs["first_err_const"] = b1_err_int
        coeffs["first_err_slope"] = b1_err_slope

    # ── Infield helper (2B, 3B, SS share structure) ───────────────────────
    team_dp_rates = inputs.team_dp_rates

    def _compute_infield(pos_key, pos_prefix, dp_key=None, dp_player_ids=None):
        if pos_key not in fd:
            return
        df = fd[pos_key]

        rng = _safe_rating(df, "IF RNG")
        arm = _safe_rating(df, "IF ARM")
        err_rating = _safe_rating(df, "IF ERR")

        # PM%: 2-variable OLS (IF RNG + IF ARM), filter NaN
        pm_rate = _fielding_pm_rate(df)
        valid = np.isfinite(rng) & np.isfinite(arm) & np.isfinite(pm_rate)
        v_rng, v_arm, v_pm = rng[valid], arm[valid], pm_rate[valid]
        avg_rng = np.mean(v_rng)
        avg_arm = np.mean(v_arm)
        avg_pm = np.mean(v_pm)
        pm_int, pm_rng_slope, pm_arm_slope = _ols_multi(
            v_rng - avg_rng, v_arm - avg_arm, v_pm - avg_pm
        )
        coeffs[f"{pos_prefix}_pm_const"] = pm_int
        coeffs[f"{pos_prefix}_pm_rng_slope"] = pm_rng_slope
        coeffs[f"{pos_prefix}_pm_arm_slope"] = pm_arm_slope

        # ERR: single OLS (IF uses E/IP)
        err_int, err_slope = _compute_single_ols_coeffs(
            err_rating, _fielding_err_rate_ip(df)
        )
        coeffs[f"{pos_prefix}_err_const"] = err_int
        coeffs[f"{pos_prefix}_err_slope"] = err_slope

        # DP: OLS on team-level DP/IP (only 2B and SS)
        if dp_key is not None and team_dp_rates is not None:
            dp_int, dp_slope = _compute_dp_ols(
                df, team_dp_rates, dp_key, player_ids=dp_player_ids
            )
            coeffs[f"{pos_prefix}_dp_const"] = dp_int
            coeffs[f"{pos_prefix}_dp_slope"] = dp_slope
        elif dp_key is not None:
            # Fallback: player-level WLS (less accurate)
            tdp = _safe_rating(df, "TDP")
            dp_int, dp_slope = _compute_single_linear_coeffs(
                tdp, _fielding_dp_rate(df), df["ip"].values
            )
            coeffs[f"{pos_prefix}_dp_const"] = dp_int
            coeffs[f"{pos_prefix}_dp_slope"] = dp_slope

    # 2B DP: all 32 players, team 2B DP/IP
    _compute_infield("2b", "second", dp_key="dp_2b_ip")
    _compute_infield("3b", "third")
    # SS DP: first 25 of 32 players (Bug 9: SS LINEST range too short)
    ss_linest_ids = (
        team_dp_rates.get("_ss_linest_player_ids") if team_dp_rates else None
    )
    _compute_infield("ss", "ss", dp_key="dp_ss_ip", dp_player_ids=ss_linest_ids)

    # ── Outfield (LF, CF, RF share structure) ─────────────────────────────
    def _compute_outfield(pos_key, pos_prefix):
        if pos_key not in fd:
            return
        df = fd[pos_key]

        rng = _safe_rating(df, "OF RNG")
        err_rating = _safe_rating(df, "OF ERR")
        arm_rating = _safe_rating(df, "OF ARM")

        # PM%: single OLS on OF RNG
        pm_int, pm_slope = _compute_single_ols_coeffs(
            rng, _fielding_pm_rate(df)
        )
        coeffs[f"{pos_prefix}_pm_const"] = pm_int
        coeffs[f"{pos_prefix}_pm_slope"] = pm_slope

        # ERR: single OLS on OF ERR (OF uses E/PO, not E/IP)
        err_int, err_slope = _compute_single_ols_coeffs(
            err_rating, _fielding_err_rate_po(df)
        )
        coeffs[f"{pos_prefix}_err_const"] = err_int
        coeffs[f"{pos_prefix}_err_slope"] = err_slope

        # ARM: single OLS on OF ARM
        arm_int, arm_slope = _compute_single_ols_coeffs(
            arm_rating, _fielding_arm_rate(df)
        )
        coeffs[f"{pos_prefix}_arm_const"] = arm_int
        coeffs[f"{pos_prefix}_arm_slope"] = arm_slope

    _compute_outfield("lf", "lf")
    _compute_outfield("cf", "cf")
    _compute_outfield("rf", "rf")

    return FieldingRegressionCoeffs(**coeffs)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compute_regressions(
    regressions_dir: Path | str,
) -> tuple[HittingRegressionCoeffs, PitchingRegressionCoeffs, FieldingRegressionCoeffs]:
    """Full pipeline: load → aggregate → WLS → coefficient objects."""
    regressions_dir = Path(regressions_dir)
    inputs = load_regression_inputs(regressions_dir)
    hitting = compute_hitting_regressions(inputs)
    pitching = compute_pitching_regressions(inputs)
    fielding = compute_fielding_regressions(inputs)
    return hitting, pitching, fielding


# ---------------------------------------------------------------------------
# Caching
# ---------------------------------------------------------------------------

_CACHE_VERSION = 1
_CACHE_FILENAME = ".regressions_cache.json"


def _compute_input_hash(regressions_dir: Path) -> str:
    """SHA-256 of all CSV files in the regressions directory."""
    h = hashlib.sha256()
    for csv_path in sorted(regressions_dir.glob("*.csv")):
        h.update(csv_path.name.encode())
        h.update(csv_path.read_bytes())
    return f"sha256:{h.hexdigest()}"


def _coeffs_to_dict(
    hitting: HittingRegressionCoeffs,
    pitching: PitchingRegressionCoeffs,
    fielding: FieldingRegressionCoeffs,
) -> dict:
    """Serialize coefficient objects to a JSON-safe dict."""
    import dataclasses
    return {
        "hitting": dataclasses.asdict(hitting),
        "pitching": dataclasses.asdict(pitching),
        "fielding": dataclasses.asdict(fielding),
    }


def _coeffs_from_dict(
    data: dict,
) -> tuple[HittingRegressionCoeffs, PitchingRegressionCoeffs, FieldingRegressionCoeffs]:
    """Deserialize coefficient objects from a dict."""
    # Reconstruct nested LinearCoeffs/CubicCoeffs
    h = data["hitting"]
    hitting = HittingRegressionCoeffs(
        eye=LinearCoeffs(**h["eye"]),
        power=LinearCoeffs(**h["power"]),
        k=LinearCoeffs(**h["k"]),
        babip=LinearCoeffs(**h["babip"]),
        gap=LinearCoeffs(**h["gap"]),
        speed=LinearCoeffs(**h["speed"]),
        sba=CubicCoeffs(**h["sba"]),
        sb_pct=CubicCoeffs(**h["sb_pct"]),
        ubr=CubicCoeffs(**h["ubr"]),
    )

    p = data["pitching"]
    pitching = PitchingRegressionCoeffs(
        sp_con=LinearCoeffs(**p["sp_con"]),
        sp_hrr=LinearCoeffs(**p["sp_hrr"]),
        sp_stu=LinearCoeffs(**p["sp_stu"]),
        sp_babip=LinearCoeffs(**p["sp_babip"]),
        rp_con=LinearCoeffs(**p["rp_con"]),
        rp_hrr=LinearCoeffs(**p["rp_hrr"]),
        rp_stu=LinearCoeffs(**p["rp_stu"]),
        rp_babip=LinearCoeffs(**p["rp_babip"]),
        sp_sb_pct=CubicCoeffs(**p["sp_sb_pct"]),
        rp_sb_pct=CubicCoeffs(**p["rp_sb_pct"]),
        sba=CubicCoeffs(**p["sba"]),
    )

    fielding = FieldingRegressionCoeffs(**data["fielding"])

    return hitting, pitching, fielding


def _load_cache(
    regressions_dir: Path, input_hash: str
) -> tuple[HittingRegressionCoeffs, PitchingRegressionCoeffs, FieldingRegressionCoeffs] | None:
    """Load cached coefficients if valid."""
    cache_path = regressions_dir / _CACHE_FILENAME
    try:
        raw = json.loads(cache_path.read_text())
        if raw.get("version") != _CACHE_VERSION:
            return None
        if raw.get("input_hash") != input_hash:
            return None
        return _coeffs_from_dict(raw["coefficients"])
    except Exception:
        return None


def _save_cache(
    regressions_dir: Path,
    input_hash: str,
    hitting: HittingRegressionCoeffs,
    pitching: PitchingRegressionCoeffs,
    fielding: FieldingRegressionCoeffs,
) -> None:
    """Save coefficients to cache."""
    cache_path = regressions_dir / _CACHE_FILENAME
    data = {
        "version": _CACHE_VERSION,
        "input_hash": input_hash,
        "coefficients": _coeffs_to_dict(hitting, pitching, fielding),
    }
    cache_path.write_text(json.dumps(data, indent=2))


def generate_regression_coefficients(
    regressions_dir: Path | str,
    *,
    use_cache: bool = True,
    force_recompute: bool = False,
) -> tuple[HittingRegressionCoeffs, PitchingRegressionCoeffs, FieldingRegressionCoeffs]:
    """Cached wrapper for compute_regressions.

    Mirrors the pattern in metadata.generate_data_points().
    """
    regressions_dir = Path(regressions_dir)

    if use_cache:
        input_hash = _compute_input_hash(regressions_dir)
        if not force_recompute:
            cached = _load_cache(regressions_dir, input_hash)
            if cached is not None:
                return cached

    hitting, pitching, fielding = compute_regressions(regressions_dir)

    if use_cache:
        _save_cache(regressions_dir, input_hash, hitting, pitching, fielding)

    return hitting, pitching, fielding
