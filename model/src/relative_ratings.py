"""
src/relative_ratings.py — Blend AAA/AA relative rating exports for finer granularity.

OOTP ratings are quantized to 5-point increments (20–80). Exporting at AAA and AA
relative levels reveals finer distinctions within each MLB tier. This module uses
a per-tier midpoint subdivision algorithm to produce continuous blended ratings.

Algorithm (per column):
  For each player with MLB rating M, AAA value, and optional AA value:
    1. Group by MLB tier → find distinct AAA values → n_aaa, aaa_rank (0-indexed)
    2. Within (MLB, AAA) group → find distinct AA values → n_aa, aa_rank
    3. blended = M - 2.5 + (aaa_rank + (aa_rank + 0.5) / n_aa) / n_aaa × 5

  Properties:
    - Values always in [M-2.5, M+2.5)
    - Monotonic ordering preserved across all tiers
    - Works for any number of sub-tiers (1, 2, 3, 4+)
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def detect_relative_columns(mlb_df: pd.DataFrame, minor_df: pd.DataFrame) -> list[str]:
    """Compare two exports and return columns where any value differs.

    Only considers columns present in both DataFrames. Skips non-comparable
    columns (ID, Name, etc. that may differ for non-rating reasons).
    """
    # Columns that can't meaningfully differ for rating purposes
    skip = {"ID", "Name", "POS", "TM", "ORG", "LG", "Lev", "DOB", "Age",
            "HT", "WT", "B", "T", "Nat. Pop.", "Loc. Pop.", "NAT",
            "Contract", "Salary", "YRS", "source", "is_pitcher", "is_two_way"}

    common = [c for c in mlb_df.columns if c in minor_df.columns and c not in skip]
    relative = []
    for col in common:
        if not mlb_df[col].equals(minor_df[col]):
            relative.append(col)
    return relative


def compute_tier_blend(
    mlb_values: np.ndarray,
    aaa_values: np.ndarray,
    aa_values: np.ndarray | None = None,
) -> np.ndarray:
    """Apply per-tier midpoint subdivision for a single rating column.

    Parameters
    ----------
    mlb_values : array of MLB-level ratings (quantized to 5-point scale)
    aaa_values : array of AAA-level ratings (finer granularity within MLB tiers)
    aa_values : optional array of AA-level ratings (even finer granularity)

    Returns
    -------
    Array of blended continuous ratings.
    """
    mlb = np.asarray(mlb_values, dtype=float)
    aaa = np.asarray(aaa_values, dtype=float)
    result = np.empty_like(mlb, dtype=float)

    if aa_values is not None:
        aa = np.asarray(aa_values, dtype=float)
    else:
        aa = None

    # Process each MLB tier
    for m_val in np.unique(mlb):
        tier_mask = mlb == m_val
        tier_aaa = aaa[tier_mask]

        # Distinct AAA values within this MLB tier, sorted
        distinct_aaa = np.sort(np.unique(tier_aaa))
        n_aaa = len(distinct_aaa)
        # Map each AAA value to its 0-indexed rank
        aaa_rank_map = {v: i for i, v in enumerate(distinct_aaa)}

        if aa is None:
            # AAA-only formula: M - 2.5 + (aaa_rank + 0.5) / n_aaa * 5
            tier_indices = np.where(tier_mask)[0]
            for idx in tier_indices:
                aaa_rank = aaa_rank_map[aaa[idx]]
                result[idx] = m_val - 2.5 + (aaa_rank + 0.5) / n_aaa * 5
        else:
            tier_aa = aa[tier_mask]
            tier_indices = np.where(tier_mask)[0]

            # For each (MLB, AAA) sub-group, find distinct AA values
            for aaa_val in distinct_aaa:
                aaa_rank = aaa_rank_map[aaa_val]
                sub_mask = tier_aaa == aaa_val
                sub_aa = tier_aa[sub_mask]
                sub_indices = tier_indices[sub_mask]

                distinct_aa = np.sort(np.unique(sub_aa))
                n_aa = len(distinct_aa)
                aa_rank_map = {v: i for i, v in enumerate(distinct_aa)}

                for j, idx in enumerate(sub_indices):
                    aa_rank = aa_rank_map[aa[idx]]
                    result[idx] = (
                        m_val - 2.5
                        + (aaa_rank + (aa_rank + 0.5) / n_aa) / n_aaa * 5
                    )

    return result


def blend_relative_ratings(
    mlb_df: pd.DataFrame,
    aaa_df: pd.DataFrame,
    aa_df: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Blend all relative rating columns in a player DataFrame.

    The DataFrames must have the same rows in the same order (same player IDs).

    Parameters
    ----------
    mlb_df : MLB-level export (quantized 5-point ratings)
    aaa_df : AAA-level export (finer within MLB tiers)
    aa_df : optional AA-level export (even finer within AAA tiers)

    Returns
    -------
    Copy of mlb_df with relative columns replaced by blended continuous values.
    """
    if len(mlb_df) != len(aaa_df):
        raise ValueError(
            f"MLB ({len(mlb_df)}) and AAA ({len(aaa_df)}) row counts differ"
        )
    if aa_df is not None and len(mlb_df) != len(aa_df):
        raise ValueError(
            f"MLB ({len(mlb_df)}) and AA ({len(aa_df)}) row counts differ"
        )

    relative_cols = detect_relative_columns(mlb_df, aaa_df)
    if not relative_cols:
        return mlb_df.copy()

    result = mlb_df.copy()
    # Pre-cast relative columns to float so blended values aren't truncated
    for col in relative_cols:
        result[col] = pd.to_numeric(result[col], errors="coerce").astype(float)

    for col in relative_cols:
        mlb_vals = pd.to_numeric(mlb_df[col], errors="coerce").values.astype(float)
        aaa_vals = pd.to_numeric(aaa_df[col], errors="coerce").values.astype(float)
        aa_vals = (
            pd.to_numeric(aa_df[col], errors="coerce").values.astype(float)
            if aa_df is not None
            else None
        )

        # Only blend where all levels are numeric (non-NaN)
        valid = ~np.isnan(mlb_vals) & ~np.isnan(aaa_vals)
        if aa_vals is not None:
            valid &= ~np.isnan(aa_vals)

        if valid.any():
            blended = np.full_like(mlb_vals, np.nan)
            blended[valid] = compute_tier_blend(
                mlb_vals[valid],
                aaa_vals[valid],
                aa_vals[valid] if aa_vals is not None else None,
            )
            # Keep original value where blending wasn't possible
            blended[~valid] = mlb_vals[~valid]
            result[col] = blended

    return result
