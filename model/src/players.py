"""
src/players.py — Load and merge OOTP CSV player exports.

Handles column disambiguation (INJ/CON/DEM duplicates), source tagging,
pitcher detection, two-way player detection, optional AAA/AA relative
rating blending, and optional OSA rating blending.
"""

from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

from src.relative_ratings import blend_relative_ratings

# Columns whose pandas auto-suffix (.1) we rename for clarity.
# Format: pandas_auto_name → desired_name
_COLUMN_RENAMES = {
    "INJ.1": "INJ2",
    "CON.1": "PCON",
    "CON vL.1": "PCON vL",
    "CON vR.1": "PCON vR",
    "CON P.1": "PCON P",
    "DEM.1": "DEM2",
}

# Positions that count as pitchers
_PITCHER_POSITIONS = frozenset({"SP", "RP", "CL"})

# File-name pattern → source tag.
# `draft####.csv` accepts any 4-digit year — historical leagues with
# draft1967.csv and far-future leagues with draft2156.csv both work.
# `org.csv` and `intl.csv` share the "Organization" tag — `intl.csv` is the
# optional split file for IntlComplex players when the OOTP export paginates.
_SOURCE_PATTERNS: list[tuple[re.Pattern, str | None]] = [
    (re.compile(r"^org\.csv$", re.IGNORECASE), "Organization"),
    (re.compile(r"^intl\.csv$", re.IGNORECASE), "Organization"),
    (re.compile(r"^freeagents\.csv$", re.IGNORECASE), "Free Agent"),
    (re.compile(r"^iafa\.csv$", re.IGNORECASE), "IAFA"),
    (re.compile(r"^draft(\d{4})\.csv$", re.IGNORECASE), None),  # dynamic tag from year
]

# Potential rating columns used for two-way detection
from src.constants import (
    HITTER_BIG3_COLS as _HITTER_BIG3_COLS,
    PITCHER_RATING_COLS as _PITCHER_RATING_COLS,
)

# Rating columns that SHOULD be blended during OSA merging.
# Only these columns get the weighted average of scout + OSA values.
# Everything else (metadata, contract, personality, etc.) is preserved from scout.
_RATING_COLUMNS = frozenset({
    # Hitting ratings (vR/vL splits)
    "BA vR", "BA vL", "CON vR", "CON vL", "GAP vR", "GAP vL",
    "POW vR", "POW vL", "EYE vR", "EYE vL", "K vR", "K vL",
    # Hitting potentials
    "HT P", "CON P", "GAP P", "POW P", "EYE P", "K P",
    # Speed / baserunning
    "SPE", "STE", "RUN", "SR", "BUN", "BFH",
    # Fielding abilities
    "C ABI", "C FRM", "C ARM", "IF RNG", "IF ERR", "IF ARM", "TDP",
    "OF RNG", "OF ERR", "OF ARM",
    # Position ratings (current + potential)
    "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF",
    "C Pot", "1B Pot", "2B Pot", "3B Pot", "SS Pot", "LF Pot", "CF Pot", "RF Pot",
    # Pitching ratings (vR/vL splits)
    "STU vR", "STU vL", "PCON vR", "PCON vL",
    "HRR vR", "HRR vL", "PBABIP vR", "PBABIP vL",
    # Pitching potentials
    "STU P", "PCON P", "HRR P", "PBABIP P",
    # Pitching other
    "HLD", "STM",
    # Pitch grades (current + potential)
    "FB", "FBP", "CH", "CHP", "CB", "CBP", "SL", "SLP",
    "SI", "SIP", "SP", "SPP", "CT", "CTP", "FO", "FOP",
    "CC", "CCP", "SC", "SCP", "KC", "KCP", "KN", "KNP",
    # Overall / potential / MLD
    "OVR", "POT", "MLD",
})


def _source_tag(filename: str) -> str:
    """Derive a source tag from a CSV filename."""
    for pattern, tag in _SOURCE_PATTERNS:
        m = pattern.match(filename)
        if m:
            if tag is not None:
                return tag
            # Draft file — extract year
            return f"Draft {m.group(1)}"
    return filename  # fallback: use filename as-is


def _discover_csv_files(
    directory: Path, osa_blend: bool = False
) -> list[tuple[Path, Path | None]]:
    """Find scout CSVs. If osa_blend, also find paired _osa.csv files.

    Returns list of (scout_path, osa_path_or_None) tuples.

    Pairing rule: org.csv → org_osa.csv, intl.csv → intl_osa.csv,
    draft2042.csv → draft2042_osa.csv, etc.
    """
    scout_files = []
    for p in sorted(directory.iterdir()):
        if not p.is_file() or p.suffix.lower() != ".csv":
            continue
        name = p.name.lower()
        # Skip OSA / AAA / AA files — they'll be paired with scout files
        if "_osa" in name or "_aaa" in name or "_aa" in name:
            continue
        if name in ("org.csv", "intl.csv", "freeagents.csv", "iafa.csv"):
            scout_files.append(p)
        elif name.startswith("draft") and name.endswith(".csv"):
            scout_files.append(p)

    result = []
    for scout_path in scout_files:
        osa_path = None
        if osa_blend:
            stem = scout_path.stem
            osa_candidate = scout_path.with_name(f"{stem}_osa.csv")
            if osa_candidate.exists():
                osa_path = osa_candidate
        result.append((scout_path, osa_path))

    return result


def _load_single_csv(path: Path) -> pd.DataFrame:
    """Load one CSV, disambiguate duplicate column names."""
    df = pd.read_csv(path, low_memory=False)
    df.rename(columns=_COLUMN_RENAMES, inplace=True)
    return df


def _detect_pitcher(pos_series: pd.Series) -> pd.Series:
    """Return boolean Series: True if POS is a pitcher position."""
    return pos_series.isin(_PITCHER_POSITIONS)


def _detect_two_way(df: pd.DataFrame) -> pd.Series:
    """Detect two-way players who have real ratings in both domains.

    Uses potential ratings with stricter thresholds than simple floor checks.

    Hitter side (CON P, POW P, EYE P — the "big 3"):
      - (3/3 >= 40) OR (2/3 >= 50)
      Note: Position eligibility gate applied via hitters.refine_two_way().

    Pitcher side (STU P, MOV P, PCON P):
      - All 3/3 >= 40
    """
    big3 = pd.DataFrame({
        col: pd.to_numeric(df[col], errors="coerce")
        for col in _HITTER_BIG3_COLS
    })
    big3_ge40 = big3.ge(40).sum(axis=1)
    big3_ge50 = big3.ge(50).sum(axis=1)
    hitter_ok = (big3_ge40 >= 3) | (big3_ge50 >= 2)

    pitcher_ratings = pd.DataFrame({
        col: pd.to_numeric(df[col], errors="coerce")
        for col in _PITCHER_RATING_COLS
    })
    pitcher_ok = pitcher_ratings.ge(40).all(axis=1)

    return hitter_ok & pitcher_ok


# ---------------------------------------------------------------------------
# Relative rating blending (AAA / AA)
# ---------------------------------------------------------------------------


def _find_relative_files(base_path: Path) -> tuple[Path | None, Path | None]:
    """Find AAA and AA relative export files paired with a base CSV.

    Pairing rule: org.csv → org_aaa.csv / org_aa.csv.
    Returns (aaa_path_or_None, aa_path_or_None).
    """
    stem = base_path.stem
    aaa_candidate = base_path.with_name(f"{stem}_aaa.csv")
    aa_candidate = base_path.with_name(f"{stem}_aa.csv")
    aaa_path = aaa_candidate if aaa_candidate.exists() else None
    aa_path = aa_candidate if aa_candidate.exists() else None
    return aaa_path, aa_path


def _apply_relative_blend(df: pd.DataFrame, base_path: Path) -> pd.DataFrame:
    """Load AAA/AA files if present and blend relative ratings into df.

    Returns df unchanged if no AAA file exists.
    """
    aaa_path, aa_path = _find_relative_files(base_path)
    if aaa_path is None:
        return df

    aaa_df = _load_single_csv(aaa_path)
    aa_df = _load_single_csv(aa_path) if aa_path is not None else None
    return blend_relative_ratings(df, aaa_df, aa_df)


# ---------------------------------------------------------------------------
# OSA blending
# ---------------------------------------------------------------------------


def calculate_dynamic_weights(
    scout_accuracy: str,
    days_since_scouted: int | float,
    base_osa: float,
    base_scout: float,
) -> tuple[float, float]:
    """Calculate blending weights for a single player.

    Future: decrease scout_weight when scout_accuracy is low or
    days_since_scouted is large, increasing OSA weight proportionally.

    Currently returns (base_scout, base_osa) unmodified.
    """
    return base_scout, base_osa


def _compute_blend_weights(
    scout_df: pd.DataFrame,
    base_scout: float,
    base_osa: float,
) -> tuple[pd.Series, pd.Series]:
    """Compute per-player (scout_weight, osa_weight) Series.

    Calls calculate_dynamic_weights per row using Scouting Accuracy
    and last-scouted date columns. Currently returns constant weights
    since the stub doesn't vary by player.

    When dynamic weights are implemented, this uses pd.DataFrame.apply()
    or np.select() for categorical scout_accuracy levels.
    """
    scout_w = pd.Series(base_scout, index=scout_df.index)
    osa_w = pd.Series(base_osa, index=scout_df.index)
    return scout_w, osa_w


def _blend_single_file(
    scout_df: pd.DataFrame,
    osa_df: pd.DataFrame,
    base_scout: float,
    base_osa: float,
) -> pd.DataFrame:
    """Merge scout + OSA on ID, blend rating columns, keep scout metadata."""
    # 1. Inner join on ID (only players in both files)
    merged = scout_df.merge(osa_df, on="ID", suffixes=("", "_osa"))

    # 2. Identify rating columns (present in both files AND in whitelist)
    rating_cols = [
        c for c in osa_df.columns
        if c in _RATING_COLUMNS and c in scout_df.columns
    ]

    # 3. Compute per-row weights
    scout_w, osa_w = _compute_blend_weights(merged, base_scout, base_osa)

    # 4. Vectorized blend: result = scout_w * scout_val + osa_w * osa_val
    for col in rating_cols:
        scout_val = pd.to_numeric(merged[col], errors="coerce")
        osa_val = pd.to_numeric(merged[f"{col}_osa"], errors="coerce")
        # Where OSA is NaN (e.g., dash values), keep scout value
        blended = scout_w * scout_val + osa_w * osa_val
        merged[col] = blended.where(osa_val.notna(), scout_val)

    # 5. Drop _osa suffix columns
    merged.drop(
        columns=[c for c in merged.columns if c.endswith("_osa")], inplace=True
    )

    # 6. For players only in scout file (no OSA match), preserve scout-only rows
    scout_only = scout_df[~scout_df["ID"].isin(osa_df["ID"])]
    if scout_only.empty:
        return merged.reset_index(drop=True)
    return pd.concat([merged, scout_only], ignore_index=True)


def load_players(
    directory: Path | str,
    *,
    source_tags: bool = True,
    relative_blend: bool = False,
    osa_blend: bool = False,
    scout_weight: float = 0.8,
    osa_weight: float = 0.2,
) -> pd.DataFrame:
    """Load and merge all OOTP CSV exports from a directory.

    Discovers files by name pattern:
      - org.csv, intl.csv, freeagents.csv, iafa.csv, draft*.csv

    `org.csv` holds MLB + MiLB players. `intl.csv` is the optional split file
    for IntlComplex players when OOTP's "List All MLB Players" export
    paginates in larger leagues; rows from both files are tagged
    `source = "Organization"`.

    When relative_blend=True, for each source file, looks for paired
    _aaa.csv / _aa.csv files and blends relative ratings for finer
    granularity within each 5-point MLB rating tier.

    When osa_blend=True, for each scout file, looks for a paired _osa.csv
    (e.g., org_osa.csv) and blends rating columns using the specified
    weights before concatenation.

    Pipeline order: load → relative blend → OSA blend → concat.

    Returns single DataFrame with:
      - All raw columns (duplicates disambiguated: INJ2, PCON, DEM2, etc.)
      - 'source' column tagging origin file (if source_tags=True)
      - 'is_pitcher' column (True if POS in SP/RP/CL)
      - 'is_two_way' column (True if has real ratings in both domains)
    """
    directory = Path(directory)
    if not directory.is_dir():
        raise FileNotFoundError(f"Directory not found: {directory}")

    csv_pairs = _discover_csv_files(directory, osa_blend=osa_blend)
    if not csv_pairs:
        raise FileNotFoundError(f"No player CSV files found in {directory}")

    name_width = max(len(p[0].name) for p in csv_pairs) + 1
    print("\nLoading player CSVs...")

    frames = []
    for scout_path, osa_path in csv_pairs:
        df = _load_single_csv(scout_path)
        if source_tags:
            df["source"] = _source_tag(scout_path.name)

        # Relative blend (AAA/AA) on scout ratings
        aaa_path = aa_path = None
        if relative_blend:
            aaa_path, aa_path = _find_relative_files(scout_path)
            df = _apply_relative_blend(df, scout_path)

        if osa_path is not None:
            osa_df = _load_single_csv(osa_path)
            # Relative blend on OSA ratings too
            if relative_blend:
                osa_df = _apply_relative_blend(osa_df, osa_path)
            df = _blend_single_file(df, osa_df, scout_weight, osa_weight)
            # Re-apply source tag (blend may reorder rows)
            if source_tags:
                df["source"] = _source_tag(scout_path.name)

        parts = []
        if aaa_path is not None:
            parts.append("AAA/AA" if aa_path is not None else "AAA")
        if osa_path is not None:
            parts.append(f"OSA ({scout_weight:g}/{osa_weight:g})")
        status = "scout + " + " + ".join(parts) if parts else "scout only"
        print(f"  {(scout_path.name + ':').ljust(name_width)} {status}")

        frames.append(df)

    combined = pd.concat(frames, ignore_index=True)
    combined["is_pitcher"] = _detect_pitcher(combined["POS"])
    combined["is_two_way"] = _detect_two_way(combined)

    return combined
