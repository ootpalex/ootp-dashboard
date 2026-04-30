"""
src/export.py — Pipeline orchestration and JSON export for the React dashboard.

Loads players, computes all stats (current + prospect), and builds
nested JSON dicts ready for dashboard.json.gz output.
"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from src.ballparks import (
    BallparksTable,
    NormalizedAdjustments,
    ParkDeltas,
    neutral_adjustments,
    neutral_park_deltas,
)
from src.data_points import DEFAULT_HITTER_DP, DEFAULT_PITCHER_DP
from src.metadata import compose_data_points, generate_data_points
from src.hitters import (
    compute_fielding,
    compute_hitter_batting,
    compute_position_eligibility,
    compute_waa,
    parse_height_cm,
    refine_two_way,
)
from src.pitchers import (
    compute_pitch_counts,
    compute_pitcher_batting,
    compute_starter_flag,
    compute_starter_potential,
)
from src.players import load_players
from src.settings import PipelineSettings
from src.contract_projection import build_player_projection, project_super_two, DAYS_PER_SEASON


# ---------------------------------------------------------------------------
# Helpers: salary / price
# ---------------------------------------------------------------------------


def _parse_salary(slr_series: pd.Series) -> pd.Series:
    """Parse OOTP salary strings to numeric.

    Handles formats like '$570 500' → 570500, '$1 200 000' → 1200000.
    Non-parseable values (including '-') become NaN.
    """
    cleaned = slr_series.astype(str).str.replace(r"[$,]", "", regex=True)
    cleaned = cleaned.str.replace(r"\s+", "", regex=True)
    return pd.to_numeric(cleaned, errors="coerce")


def _parse_demand(dem_series: pd.Series) -> pd.Series:
    """Parse OOTP demand strings to numeric.

    Handles formats like '$1.1m' → 1100000, '$860k' → 860000,
    'Impossible' → 4000000. Non-parseable (including '-') become NaN.

    Matches Excel: =IFERROR(VALUE(SUBSTITUTE(SUBSTITUTE(DEM,"k","E3"),"m","E6")),
                    IF(DEM="Impossible",4000000,0))
    """
    s = dem_series.astype(str).str.strip()
    # Handle 'Impossible' first
    result = pd.Series(np.nan, index=dem_series.index, dtype=float)
    impossible = s.str.lower() == "impossible"
    result[impossible] = 4_000_000.0

    # Strip $ and handle k/m suffixes
    cleaned = s.str.replace(r"[$,]", "", regex=True)
    # Convert 'm' suffix to ×1e6
    m_mask = cleaned.str.lower().str.endswith("m") & ~impossible
    k_mask = cleaned.str.lower().str.endswith("k") & ~impossible
    plain_mask = ~m_mask & ~k_mask & ~impossible

    m_vals = pd.to_numeric(cleaned[m_mask].str[:-1], errors="coerce") * 1_000_000
    k_vals = pd.to_numeric(cleaned[k_mask].str[:-1], errors="coerce") * 1_000
    plain_vals = pd.to_numeric(cleaned[plain_mask], errors="coerce")

    result[m_mask] = m_vals
    result[k_mask] = k_vals
    result[plain_mask] = plain_vals
    return result


def _compute_price(slr_sort: pd.Series, dem_sort: pd.Series, org: pd.Series) -> pd.Series:
    """Compute player price from salary and demand.

    Free agents without salary get demand as price.
    Everyone else gets max(salary, league_min), where league_min is
    auto-detected as the smallest positive salary in the dataset.
    """
    # Auto-detect league minimum salary from the data
    positive = slr_sort[slr_sort > 0]
    league_min = positive.min() if len(positive) > 0 else 0.0

    is_free_agent_no_salary = (slr_sort.fillna(0) == 0) & (org.astype(str).str.strip() == "-")
    price = pd.Series(np.nan, index=slr_sort.index, dtype=float)
    price[is_free_agent_no_salary] = dem_sort[is_free_agent_no_salary]
    price[~is_free_agent_no_salary] = slr_sort[~is_free_agent_no_salary].clip(lower=league_min)
    return price


def _parse_salary_val(val) -> float | None:
    """Parse a single OOTP salary string to numeric.

    Handles formats like '$570 500' → 570500, '$1 200 000' → 1200000, '-' → None.
    """
    if val is None:
        return None
    s = str(val).strip()
    if s in ("-", "", "Free agent"):
        return None
    cleaned = re.sub(r"[$,]", "", s)
    cleaned = re.sub(r"\s+", "", cleaned)
    try:
        return float(cleaned)
    except ValueError:
        return None


def _safe_numeric(series: pd.Series) -> pd.Series:
    """Convert to numeric, coercing non-parseable values to NaN."""
    return pd.to_numeric(series, errors="coerce")


# ---------------------------------------------------------------------------
# Helpers: prospect pipeline
# ---------------------------------------------------------------------------

# Hitter potential rating columns: map current split cols to potential source
_HITTER_POTENTIAL_MAP = {
    "BA vR": "HT P", "BA vL": "HT P",
    "CON vR": "CON P", "CON vL": "CON P",
    "GAP vR": "GAP P", "GAP vL": "GAP P",
    "POW vR": "POW P", "POW vL": "POW P",
    "EYE vR": "EYE P", "EYE vL": "EYE P",
    "K vR": "K P", "K vL": "K P",
}

# Pitcher potential rating columns
_PITCHER_POTENTIAL_MAP = {
    "STU vR": "STU P", "STU vL": "STU P",
    "PCON vR": "PCON P", "PCON vL": "PCON P",
    "HRR vR": "HRR P", "HRR vL": "HRR P",
    "PBABIP vR": "PBABIP P", "PBABIP vL": "PBABIP P",
}


def _prepare_prospect_hitters(players: pd.DataFrame) -> pd.DataFrame:
    """Copy players, substitute potential ratings for vR/vL splits."""
    prospect = players.copy()
    for current_col, pot_col in _HITTER_POTENTIAL_MAP.items():
        if pot_col in prospect.columns:
            prospect[current_col] = _safe_numeric(prospect[pot_col])
    return prospect


def _prepare_prospect_pitchers(players: pd.DataFrame) -> pd.DataFrame:
    """Copy players, substitute potential ratings for vR/vL splits."""
    prospect = players.copy()
    for current_col, pot_col in _PITCHER_POTENTIAL_MAP.items():
        if pot_col in prospect.columns:
            prospect[current_col] = _safe_numeric(prospect[pot_col])
    return prospect


# ---------------------------------------------------------------------------
# Helpers: safe value extraction
# ---------------------------------------------------------------------------


def _v(val):
    """Convert numpy/pandas scalar to plain Python type, NaN → None."""
    if val is None:
        return None
    if isinstance(val, (np.integer,)):
        return int(val)
    if isinstance(val, (np.floating, float)):
        if np.isnan(val) or np.isinf(val):
            return None
        return round(float(val), 4)
    if isinstance(val, (np.bool_,)):
        return bool(val)
    return val


def _safe_str(val) -> str | None:
    """Convert to string, NaN/None → None."""
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    return str(val)


def _safe_int(val) -> int | None:
    """Convert to int, NaN → None."""
    try:
        v = pd.to_numeric(val, errors="coerce")
        if pd.isna(v):
            return None
        return int(v)
    except (ValueError, TypeError):
        return None


def _safe_float(val) -> float | None:
    """Convert to float, NaN → None."""
    try:
        v = float(val)
        if np.isnan(v) or np.isinf(v):
            return None
        return v
    except (ValueError, TypeError):
        return None


_MONTHS = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}
_SCT_RE = re.compile(r"(\w+)\.\s+(\d+)\w*\s+(\d{4})")


def _detect_game_date(players: pd.DataFrame) -> str | None:
    """Auto-detect game date from the most recent scouted date."""
    if "Sct" not in players.columns:
        return None
    best = None
    for raw in players["Sct"].dropna():
        m = _SCT_RE.match(str(raw).strip())
        if not m:
            continue
        mon = _MONTHS.get(m.group(1))
        if mon is None:
            continue
        try:
            d = datetime(int(m.group(3)), mon, int(m.group(2)))
        except ValueError:
            continue
        if best is None or d > best:
            best = d
    return best.strftime("%Y-%m-%d") if best else None


def _strip_none(d: dict) -> dict:
    """Recursively remove keys with None values from a dict."""
    out = {}
    for k, v in d.items():
        if isinstance(v, dict):
            v = _strip_none(v)
        if v is not None:
            out[k] = v
    return out


def _safe_bool(val) -> bool:
    """Convert to bool. Handles 'Y'/'N', 1/0, True/False."""
    if isinstance(val, bool):
        return val
    if isinstance(val, (np.bool_,)):
        return bool(val)
    s = str(val).strip().upper()
    return s in ("Y", "YES", "TRUE", "1")


def _row_val(row, col, default=None):
    """Get a value from a row, returning default if column missing."""
    if col in row.index:
        return row[col]
    return default


# Columns already explicitly mapped into structured sub-dicts (meta, ratings,
# fielding, batting, pitching, etc.).  Everything else in the source CSV row
# is collected into an ``extra`` dict so the frontend never needs a pipeline
# change to access a new field.
_MAPPED_COLS: set[str] = {
    # meta
    "ID", "Name", "POS", "ORG", "Lev", "Age", "B", "T", "DOB", "HT", "WT",
    "OVR", "POT", "MLD", "ON40", "R5", "Prone", "WAIV", "SLR",
    "INT", "WE", "AD", "LEA", "LOY", "FIN",
    "is_pitcher", "is_two_way", "source",
    # contract / service time
    "YL", "CV", "TY", "ECV", "ETY", "MLY", "OPT", "OY", "ACT", "IC",
    "PROY", "SECY", "SECD", "DFA", "ROOK", "FAT", "Draft",
    # hitter ratings
    "BA vR", "BA vL", "GAP vR", "GAP vL", "POW vR", "POW vL",
    "EYE vR", "EYE vL", "K vR", "K vL",
    "HT P", "GAP P", "POW P", "EYE P", "K P",
    "BUN", "BFH", "SPE", "STE", "RUN", "SR",
    # fielding ratings
    "C ABI", "C FRM", "C ARM", "IF RNG", "IF ERR", "IF ARM", "TDP",
    "OF RNG", "OF ERR", "OF ARM",
    "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "P",
    "C Pot", "1B Pot", "2B Pot", "3B Pot", "SS Pot", "LF Pot", "CF Pot", "RF Pot", "P Pot",
    # pitcher ratings
    "STU", "MOV", "CON", "PBABIP", "HRR",
    "STU vL", "MOV vL", "CON vL", "PBABIP vL", "HRR vL",
    "STU vR", "MOV vR", "CON vR", "PBABIP vR", "HRR vR",
    "STU P", "MOV P", "CON P", "PBABIP P", "HRR P",
    "PCON P", "PCON vL", "PCON vR",
    "FB", "FBP", "CH", "CHP", "CB", "CBP", "SL", "SLP", "SI", "SIP",
    "SP", "SPP", "CT", "CTP", "FO", "FOP", "CC", "CCP", "SC", "SCP",
    "KC", "KCP", "KN", "KNP",
    "VELO", "VT", "G/F", "STM", "HLD",
    # DEM is used by _compute_price
    "DEM",
}


def _collect_extra(row: pd.Series) -> dict:
    """Collect all CSV columns not already in structured sub-dicts."""
    extra = {}
    for col in row.index:
        if col in _MAPPED_COLS:
            continue
        val = _v(row[col])
        if val is None:
            continue
        # Convert boolean-ish strings
        if isinstance(val, str):
            s = val.strip()
            if s in ("", "-"):
                continue
            if s in ("Yes", "No", "True", "False"):
                val = s in ("Yes", "True")
        extra[col] = val
    return extra


# ---------------------------------------------------------------------------
# Pitch type helpers
# ---------------------------------------------------------------------------

_PITCH_COLS_CURRENT = ["FB", "CH", "CB", "SL", "SI", "SP", "CT", "FO", "CC", "SC", "KC", "KN"]
_PITCH_COLS_POTENTIAL = ["FBP", "CHP", "CBP", "SLP", "SIP", "SPP", "CTP", "FOP", "CCP", "SCP", "KCP", "KNP"]
_PITCH_KEYS = ["fb", "ch", "cb", "sl", "si", "sp", "ct", "fo", "cc", "sc", "kc", "kn"]


# ---------------------------------------------------------------------------
# Per-player dict builders
# ---------------------------------------------------------------------------


def _build_hitter_meta(row: pd.Series, ht_cm_val: float, salary_val, price_val, demand_val=None) -> dict:
    """Build the meta sub-dict for a hitter."""
    return {
        "name": _safe_str(_row_val(row, "Name")),
        "pos": _safe_str(_row_val(row, "POS")),
        "org": _safe_str(_row_val(row, "ORG")),
        "tm": _safe_str(_row_val(row, "TM")),
        "lev": _safe_str(_row_val(row, "Lev")),
        "age": _safe_int(_row_val(row, "Age")),
        "bats": _safe_str(_row_val(row, "B")),
        "throws": _safe_str(_row_val(row, "T")),
        "dob": _safe_str(_row_val(row, "DOB")),
        "ht": _safe_str(_row_val(row, "HT")),
        "htCm": _v(ht_cm_val),
        "wt": _safe_int(_row_val(row, "WT")),
        "ovr": _safe_int(_row_val(row, "OVR")),
        "pot": _safe_int(_row_val(row, "POT")),
        "mld": _safe_int(_row_val(row, "MLD")),
        "on40": _safe_bool(_row_val(row, "ON40", False)),
        "r5": _safe_bool(_row_val(row, "R5", False)),
        "prone": _safe_str(_row_val(row, "Prone")),
        "waiv": _safe_bool(_row_val(row, "WAIV", False)),
        "salary": _v(salary_val),
        "price": _v(price_val),
        "source": _safe_str(_row_val(row, "source")),
        "int": _safe_str(_row_val(row, "INT")),
        "we": _safe_str(_row_val(row, "WE")),
        "ad": _safe_str(_row_val(row, "AD")),
        "lea": _safe_str(_row_val(row, "LEA")),
        "loy": _safe_str(_row_val(row, "LOY")),
        "fin": _safe_str(_row_val(row, "FIN")),
        "isPitcher": bool(_row_val(row, "is_pitcher", False)),
        "isTwoWay": bool(_row_val(row, "is_two_way", False)),
        # Contract / service time fields
        "yl": _safe_str(_row_val(row, "YL")),
        "opt": _safe_int(_row_val(row, "OPT")),
        "act": _safe_bool(_row_val(row, "ACT", False)),
        "ic": _safe_str(_row_val(row, "IC")),
        "proy": _safe_int(_row_val(row, "PROY")),
        "draft": _safe_int(_row_val(row, "Draft")),
        "oy": _safe_int(_row_val(row, "OY")),
        "cv": _v(_parse_salary_val(_row_val(row, "CV"))),
        "ty": _safe_int(_row_val(row, "TY")),
        "ecv": _v(_parse_salary_val(_row_val(row, "ECV"))),
        "ety": _safe_int(_row_val(row, "ETY")),
        "secy": _safe_int(_row_val(row, "SECY")),
        "secd": _safe_int(_row_val(row, "SECD")),
        "mly": _safe_int(_row_val(row, "MLY")),
        "dfa": _safe_str(_row_val(row, "DFA")),
        "rook": _safe_bool(_row_val(row, "ROOK", False)),
        "dem": _safe_str(_row_val(row, "DEM")),
        "demSort": _v(demand_val),
    }


def _build_hitter_ratings(row: pd.Series) -> dict:
    """Build ratings sub-dict for a hitter."""
    return {
        "vR": {
            "con": _safe_int(_row_val(row, "CON vR")),
            "ba": _safe_int(_row_val(row, "BA vR")),
            "gap": _safe_int(_row_val(row, "GAP vR")),
            "pow": _safe_int(_row_val(row, "POW vR")),
            "eye": _safe_int(_row_val(row, "EYE vR")),
            "k": _safe_int(_row_val(row, "K vR")),
        },
        "vL": {
            "con": _safe_int(_row_val(row, "CON vL")),
            "ba": _safe_int(_row_val(row, "BA vL")),
            "gap": _safe_int(_row_val(row, "GAP vL")),
            "pow": _safe_int(_row_val(row, "POW vL")),
            "eye": _safe_int(_row_val(row, "EYE vL")),
            "k": _safe_int(_row_val(row, "K vL")),
        },
        "potential": {
            "con": _safe_int(_row_val(row, "CON P")),
            "ht": _safe_int(_row_val(row, "HT P")),
            "gap": _safe_int(_row_val(row, "GAP P")),
            "pow": _safe_int(_row_val(row, "POW P")),
            "eye": _safe_int(_row_val(row, "EYE P")),
            "k": _safe_int(_row_val(row, "K P")),
        },
        "spe": _safe_int(_row_val(row, "SPE")),
        "ste": _safe_int(_row_val(row, "STE")),
        "run": _safe_int(_row_val(row, "RUN")),
        "sr": _safe_int(_row_val(row, "SR")),
        "bun": _safe_int(_row_val(row, "BUN")),
        "bfh": _safe_int(_row_val(row, "BFH")),
    }


def _build_fielding_ratings(row: pd.Series) -> dict:
    """Build fieldingRatings sub-dict."""
    pos_keys = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"]
    pos_json_keys = ["c", "1b", "2b", "3b", "ss", "lf", "cf", "rf"]
    pot_cols = ["C Pot", "1B Pot", "2B Pot", "3B Pot", "SS Pot", "LF Pot", "CF Pot", "RF Pot"]

    return {
        "cAbi": _safe_int(_row_val(row, "C ABI")),
        "cFrm": _safe_int(_row_val(row, "C FRM")),
        "cArm": _safe_int(_row_val(row, "C ARM")),
        "ifRng": _safe_int(_row_val(row, "IF RNG")),
        "ifErr": _safe_int(_row_val(row, "IF ERR")),
        "ifArm": _safe_int(_row_val(row, "IF ARM")),
        "tdp": _safe_int(_row_val(row, "TDP")),
        "ofRng": _safe_int(_row_val(row, "OF RNG")),
        "ofErr": _safe_int(_row_val(row, "OF ERR")),
        "ofArm": _safe_int(_row_val(row, "OF ARM")),
        "posRatings": {
            k: _safe_int(_row_val(row, col))
            for k, col in zip(pos_json_keys, pos_keys)
        },
        "posPotentials": {
            k: _safe_int(_row_val(row, col))
            for k, col in zip(pos_json_keys, pot_cols)
        },
    }


def _batting_split_dict(batting_row: pd.Series, suffix: str) -> dict:
    """Extract one batting split's stats."""
    return {
        "hbp": _v(batting_row.get(f"HBP {suffix}")),
        "ubb": _v(batting_row.get(f"uBB {suffix}")),
        "hr": _v(batting_row.get(f"HR {suffix}")),
        "so": _v(batting_row.get(f"SO {suffix}")),
        "hMinusHr": _v(batting_row.get(f"H-HR {suffix}")),
        "xbhMinusHr": _v(batting_row.get(f"XBH-HR {suffix}")),
        "triples": _v(batting_row.get(f"3B {suffix}")),
        "doubles": _v(batting_row.get(f"2B {suffix}")),
        "singles": _v(batting_row.get(f"1B {suffix}")),
        "obp": _v(batting_row.get(f"OBP {suffix}")),
        "woba": _v(batting_row.get(f"wOBA {suffix}")),
        "batR": _v(batting_row.get(f"BatR {suffix}")),
    }


def _build_hitter_batting(batting_row: pd.Series) -> dict:
    """Build the batting sub-dict for a hitter."""
    return {
        "vR": _batting_split_dict(batting_row, "vR"),
        "vL": _batting_split_dict(batting_row, "vL"),
        "wtd": {
            "obp": _v(batting_row.get("OBP wtd")),
            "woba": _v(batting_row.get("wOBA wtd")),
            "batR": _v(batting_row.get("BatR wtd")),
        },
        "dh": {
            "vR": {
                "woba": _v(batting_row.get("DH wOBA vR")),
                "batR": _v(batting_row.get("DH BatR vR")),
            },
            "vL": {
                "woba": _v(batting_row.get("DH wOBA vL")),
                "batR": _v(batting_row.get("DH BatR vL")),
            },
            "wtd": {
                "woba": _v(batting_row.get("DH wOBA wtd")),
                "batR": _v(batting_row.get("DH BatR wtd")),
            },
        },
    }


def _build_baserunning(batting_row: pd.Series) -> dict:
    """Build baserunning sub-dict from batting output."""
    return {
        "sbPct": _v(batting_row.get("SB%")),
        "vR": {
            "sbat": _v(batting_row.get("SBAT vR")),
            "sb": _v(batting_row.get("SB vR")),
            "cs": _v(batting_row.get("CS vR")),
            "wsb": _v(batting_row.get("wSB vR")),
            "ubr": _v(batting_row.get("UBR vR")),
            "bsr": _v(batting_row.get("BSR vR")),
        },
        "vL": {
            "sbat": _v(batting_row.get("SBAT vL")),
            "sb": _v(batting_row.get("SB vL")),
            "cs": _v(batting_row.get("CS vL")),
            "wsb": _v(batting_row.get("wSB vL")),
            "ubr": _v(batting_row.get("UBR vL")),
            "bsr": _v(batting_row.get("BSR vL")),
        },
        "wtd": {
            "wsb": _v(batting_row.get("wSB wtd")),
            "ubr": _v(batting_row.get("UBR wtd")),
            "bsr": _v(batting_row.get("BSR wtd")),
        },
    }


# Position column prefixes and their fielding stat column patterns
_POS_FIELDING_COLS = {
    "c": {
        "stats": ["C FRMAA", "C SBA", "C RTO%", "C SB", "C CS", "C ArmR", "C RunsP"],
        "keys": ["frmaa", "sba", "rtoPct", "sb", "cs", "armR", "runsP"],
    },
    "1b": {
        "stats": ["1B PMAA", "1B EAA", "1B RunsP"],
        "keys": ["pmaa", "eaa", "runsP"],
    },
    "2b": {
        "stats": ["2B PMAA", "2B EAA", "2B DPAA", "2B RunsP"],
        "keys": ["pmaa", "eaa", "dpaa", "runsP"],
    },
    "3b": {
        "stats": ["3B PMAA", "3B EAA", "3B RunsP"],
        "keys": ["pmaa", "eaa", "runsP"],
    },
    "ss": {
        "stats": ["SS PMAA", "SS EAA", "SS DPAA", "SS RunsP"],
        "keys": ["pmaa", "eaa", "dpaa", "runsP"],
    },
    "lf": {
        "stats": ["LF PMAA", "LF EAA", "LF ARMAA", "LF RunsP"],
        "keys": ["pmaa", "eaa", "armaa", "runsP"],
    },
    "cf": {
        "stats": ["CF PMAA", "CF EAA", "CF ARMAA", "CF RunsP"],
        "keys": ["pmaa", "eaa", "armaa", "runsP"],
    },
    "rf": {
        "stats": ["RF PMAA", "RF EAA", "RF ARMAA", "RF RunsP"],
        "keys": ["pmaa", "eaa", "armaa", "runsP"],
    },
}

_ELIG_MAP = {
    "c": "C Elig", "1b": "1B Elig", "2b": "2B Elig", "3b": "3B Elig",
    "ss": "SS Elig", "lf": "LF Elig", "cf": "CF Elig", "rf": "RF Elig",
    "dh": "DH Elig",
}

_WAA_MAP = {
    "c": "C WAA", "1b": "1B WAA", "2b": "2B WAA", "3b": "3B WAA",
    "ss": "SS WAA", "lf": "LF WAA", "cf": "CF WAA", "rf": "RF WAA",
    "dh": "DH WAA",
}


def _build_positions(
    idx: int,
    eligibility: pd.DataFrame,
    fielding: pd.DataFrame,
    waa_df: pd.DataFrame,
) -> dict:
    """Build the positions sub-dict for a hitter."""
    positions = {}
    elig_row = eligibility.loc[idx]
    field_row = fielding.loc[idx] if idx in fielding.index else None
    waa_row = waa_df.loc[idx] if idx in waa_df.index else None

    for pos_key, elig_col in _ELIG_MAP.items():
        eligible = bool(elig_row.get(elig_col, False))
        pos_dict: dict = {"eligible": eligible}

        if eligible and pos_key != "dh" and pos_key in _POS_FIELDING_COLS:
            cols_info = _POS_FIELDING_COLS[pos_key]
            stats = {}
            if field_row is not None:
                for stat_col, key in zip(cols_info["stats"], cols_info["keys"]):
                    stats[key] = _v(field_row.get(stat_col))
            if stats:
                pos_dict["stats"] = stats

        if eligible and waa_row is not None:
            waa_prefix = _WAA_MAP[pos_key]
            pos_dict["waa"] = {
                "vR": _v(waa_row.get(f"{waa_prefix} vR")),
                "vL": _v(waa_row.get(f"{waa_prefix} vL")),
                "wtd": _v(waa_row.get(f"{waa_prefix} wtd")),
            }

        positions[pos_key] = pos_dict

    return positions


def _build_max_waa(idx: int, waa_df: pd.DataFrame, eligibility: pd.DataFrame) -> dict:
    """Build maxWaa sub-dict with best position."""
    waa_row = waa_df.loc[idx] if idx in waa_df.index else None
    if waa_row is None:
        return {"vR": None, "vL": None, "wtd": None, "bestPos": None}

    max_vr = _v(waa_row.get("Max WAA vR"))
    max_vl = _v(waa_row.get("Max WAA vL"))
    max_wtd = _v(waa_row.get("Max WAA wtd"))

    # Find best position by wtd WAA
    best_pos = None
    best_val = None
    for pos_key, waa_prefix in _WAA_MAP.items():
        elig_col = _ELIG_MAP[pos_key]
        if not bool(eligibility.loc[idx].get(elig_col, False)):
            continue
        wtd = waa_row.get(f"{waa_prefix} wtd")
        if wtd is not None and not (isinstance(wtd, float) and np.isnan(wtd)):
            if best_val is None or wtd > best_val:
                best_val = wtd
                best_pos = pos_key

    return {"vR": max_vr, "vL": max_vl, "wtd": max_wtd, "bestPos": best_pos}


def _build_prospect_hitter(
    idx: int,
    prospect_batting: pd.DataFrame,
    prospect_waa: pd.DataFrame | None,
) -> dict:
    """Build prospect sub-dict for a hitter."""
    bat_row = prospect_batting.loc[idx]

    batting = {
        "hbp": _v(bat_row.get("HBP vR")),
        "ubb": _v(bat_row.get("uBB vR")),
        "hr": _v(bat_row.get("HR vR")),
        "so": _v(bat_row.get("SO vR")),
        "hMinusHr": _v(bat_row.get("H-HR vR")),
        "obp": _v(bat_row.get("OBP wtd")),
        "woba": _v(bat_row.get("wOBA wtd")),
        "batR": _v(bat_row.get("BatR wtd")),
        "dhWoba": _v(bat_row.get("DH wOBA wtd")),
        "dhBatR": _v(bat_row.get("DH BatR wtd")),
    }

    baserunning = {
        "sbPct": _v(bat_row.get("SB%")),
        "wsb": _v(bat_row.get("wSB wtd")),
        "ubr": _v(bat_row.get("UBR wtd")),
        "bsr": _v(bat_row.get("BSR wtd")),
    }

    waa = {}
    if prospect_waa is not None and idx in prospect_waa.index:
        pw_row = prospect_waa.loc[idx]
        for pos_key, waa_prefix in _WAA_MAP.items():
            val = pw_row.get(f"{waa_prefix} wtd")
            waa[pos_key] = _v(val)
        waa["max"] = _v(pw_row.get("Max WAA wtd"))

    return {"batting": batting, "baserunning": baserunning, "waa": waa}


def _build_hitter_dict(
    idx: int,
    players: pd.DataFrame,
    ht_cm: pd.Series,
    salary: pd.Series,
    price: pd.Series,
    batting: pd.DataFrame,
    eligibility: pd.DataFrame,
    fielding: pd.DataFrame,
    waa_df: pd.DataFrame,
    prospect_batting: pd.DataFrame,
    prospect_waa: pd.DataFrame | None,
    sp_contract: dict | None = None,
    demand: pd.Series | None = None,
    game_year: int | None = None,
    super_two_ids: set | None = None,
    salary_report_entry: dict | None = None,
) -> dict:
    """Build one hitter's nested dict."""
    row = players.loc[idx]
    bat_row = batting.loc[idx]

    d = {
        "id": int(row["ID"]),
        "meta": _build_hitter_meta(row, ht_cm.loc[idx], salary.loc[idx], price.loc[idx], demand.loc[idx] if demand is not None else None),
        "ratings": _build_hitter_ratings(row),
        "fieldingRatings": _build_fielding_ratings(row),
        "batting": _build_hitter_batting(bat_row),
        "baserunning": _build_baserunning(bat_row),
        "positions": _build_positions(idx, eligibility, fielding, waa_df),
        "maxWaa": _build_max_waa(idx, waa_df, eligibility),
        "prospect": _build_prospect_hitter(idx, prospect_batting, prospect_waa),
        "extra": _collect_extra(row),
    }
    if sp_contract is not None:
        d["contract"] = sp_contract
    if game_year is not None:
        d["_projection"] = build_player_projection(d, game_year, super_two_ids, salary_report_entry)
    return _strip_none(d)


# ---------------------------------------------------------------------------
# Pitcher dict builders
# ---------------------------------------------------------------------------


def _build_pitcher_meta(row: pd.Series, salary_val, price_val, demand_val=None) -> dict:
    """Build the meta sub-dict for a pitcher."""
    return {
        "name": _safe_str(_row_val(row, "Name")),
        "pos": _safe_str(_row_val(row, "POS")),
        "org": _safe_str(_row_val(row, "ORG")),
        "tm": _safe_str(_row_val(row, "TM")),
        "lev": _safe_str(_row_val(row, "Lev")),
        "age": _safe_int(_row_val(row, "Age")),
        "bats": _safe_str(_row_val(row, "B")),
        "throws": _safe_str(_row_val(row, "T")),
        "dob": _safe_str(_row_val(row, "DOB")),
        "ht": _safe_str(_row_val(row, "HT")),
        "wt": _safe_int(_row_val(row, "WT")),
        "ovr": _safe_int(_row_val(row, "OVR")),
        "pot": _safe_int(_row_val(row, "POT")),
        "mld": _safe_int(_row_val(row, "MLD")),
        "on40": _safe_bool(_row_val(row, "ON40", False)),
        "r5": _safe_bool(_row_val(row, "R5", False)),
        "prone": _safe_str(_row_val(row, "Prone")),
        "waiv": _safe_bool(_row_val(row, "WAIV", False)),
        "salary": _v(salary_val),
        "price": _v(price_val),
        "source": _safe_str(_row_val(row, "source")),
        "int": _safe_str(_row_val(row, "INT")),
        "we": _safe_str(_row_val(row, "WE")),
        "ad": _safe_str(_row_val(row, "AD")),
        "lea": _safe_str(_row_val(row, "LEA")),
        "loy": _safe_str(_row_val(row, "LOY")),
        "fin": _safe_str(_row_val(row, "FIN")),
        "isPitcher": bool(_row_val(row, "is_pitcher", False)),
        "isTwoWay": bool(_row_val(row, "is_two_way", False)),
        # Contract / service time fields
        "yl": _safe_str(_row_val(row, "YL")),
        "opt": _safe_int(_row_val(row, "OPT")),
        "act": _safe_bool(_row_val(row, "ACT", False)),
        "ic": _safe_str(_row_val(row, "IC")),
        "proy": _safe_int(_row_val(row, "PROY")),
        "draft": _safe_int(_row_val(row, "Draft")),
        "oy": _safe_int(_row_val(row, "OY")),
        "cv": _v(_parse_salary_val(_row_val(row, "CV"))),
        "ty": _safe_int(_row_val(row, "TY")),
        "ecv": _v(_parse_salary_val(_row_val(row, "ECV"))),
        "ety": _safe_int(_row_val(row, "ETY")),
        "secy": _safe_int(_row_val(row, "SECY")),
        "secd": _safe_int(_row_val(row, "SECD")),
        "mly": _safe_int(_row_val(row, "MLY")),
        "dfa": _safe_str(_row_val(row, "DFA")),
        "rook": _safe_bool(_row_val(row, "ROOK", False)),
        "dem": _safe_str(_row_val(row, "DEM")),
        "demSort": _v(demand_val),
        "velo": _safe_str(_row_val(row, "VELO")),
        "vt": _safe_str(_row_val(row, "VT")),
    }


def _build_pitcher_ratings(row: pd.Series) -> dict:
    """Build ratings sub-dict for a pitcher."""
    return {
        "vR": {
            "stu": _safe_int(_row_val(row, "STU vR")),
            "mov": _safe_int(_row_val(row, "MOV vR")),
            "pcon": _safe_int(_row_val(row, "PCON vR")),
            "hrr": _safe_int(_row_val(row, "HRR vR")),
            "pbabip": _safe_int(_row_val(row, "PBABIP vR")),
        },
        "vL": {
            "stu": _safe_int(_row_val(row, "STU vL")),
            "mov": _safe_int(_row_val(row, "MOV vL")),
            "pcon": _safe_int(_row_val(row, "PCON vL")),
            "hrr": _safe_int(_row_val(row, "HRR vL")),
            "pbabip": _safe_int(_row_val(row, "PBABIP vL")),
        },
        "potential": {
            "stu": _safe_int(_row_val(row, "STU P")),
            "mov": _safe_int(_row_val(row, "MOV P")),
            "pcon": _safe_int(_row_val(row, "PCON P")),
            "hrr": _safe_int(_row_val(row, "HRR P")),
            "pbabip": _safe_int(_row_val(row, "PBABIP P")),
        },
        "hld": _safe_int(_row_val(row, "HLD")),
        "stm": _safe_int(_row_val(row, "STM")),
    }


def _build_pitch_grades(row: pd.Series) -> dict:
    """Build pitchGrades sub-dict."""
    current = {}
    potential = {}
    for key, cur_col, pot_col in zip(_PITCH_KEYS, _PITCH_COLS_CURRENT, _PITCH_COLS_POTENTIAL):
        cur_val = _row_val(row, cur_col)
        pot_val = _row_val(row, pot_col)
        current[key] = _safe_int(cur_val)
        potential[key] = _safe_int(pot_val)
    return {"current": current, "potential": potential}


def _pitcher_split_dict(stats_row: pd.Series, suffix: str, include_waa: bool = True) -> dict:
    """Extract one pitcher split's stats (SP or RP section)."""
    d = {
        "hbp": _v(stats_row.get(f"HBP{suffix}")),
        "ubb": _v(stats_row.get(f"uBB{suffix}")),
        "so": _v(stats_row.get(f"SO{suffix}")),
        "hr": _v(stats_row.get(f"HR{suffix}")),
        "hMinusHr": _v(stats_row.get(f"H-HR{suffix}")),
        "xbhMinusHr": _v(stats_row.get(f"XBH-HR{suffix}")),
        "triples": _v(stats_row.get(f"3B{suffix}")),
        "doubles": _v(stats_row.get(f"2B{suffix}")),
        "singles": _v(stats_row.get(f"1B{suffix}")),
        "woba": _v(stats_row.get(f"wOBA{suffix}")),
        "ra9": _v(stats_row.get(f"RA9{suffix}")),
    }
    if include_waa:
        d["waa"] = _v(stats_row.get(f"WAA{suffix}"))
    return d


def _build_pitcher_role_stats(stats_row: pd.Series, role: str) -> dict:
    """Build SP or RP stats sub-dict."""
    is_sp = role == "SP"
    vr_suffix = " vR" if is_sp else " vR RP"
    vl_suffix = " vL" if is_sp else " vL RP"
    wtd_suffix = " wtd" if is_sp else " wtd RP"
    sb_suffix = " SP" if is_sp else " RP"

    return {
        "sbPct": _v(stats_row.get(f"SB%{sb_suffix}")),
        "vR": _pitcher_split_dict(stats_row, vr_suffix),
        "vL": _pitcher_split_dict(stats_row, vl_suffix),
        "wtd": _pitcher_split_dict(stats_row, wtd_suffix),
    }


def _build_prospect_pitcher(
    idx: int,
    prospect_stats: pd.DataFrame,
) -> dict:
    """Build prospect sub-dict for a pitcher."""
    stats_row = prospect_stats.loc[idx]

    sp = {
        "so": _v(stats_row.get("SO wtd")),
        "ubb": _v(stats_row.get("uBB wtd")),
        "hr": _v(stats_row.get("HR wtd")),
        "sbPct": _v(stats_row.get("SB% SP")),
        "woba": _v(stats_row.get("wOBA wtd")),
        "ra9": _v(stats_row.get("RA9 wtd")),
        "waa": _v(stats_row.get("WAA wtd")),
    }
    rp = {
        "so": _v(stats_row.get("SO wtd RP")),
        "ubb": _v(stats_row.get("uBB wtd RP")),
        "hr": _v(stats_row.get("HR wtd RP")),
        "sbPct": _v(stats_row.get("SB% RP")),
        "woba": _v(stats_row.get("wOBA wtd RP")),
        "ra9": _v(stats_row.get("RA9 wtd RP")),
        "waa": _v(stats_row.get("WAA wtd RP")),
    }

    return {"sp": sp, "rp": rp}


def _build_pitcher_dict(
    idx: int,
    players: pd.DataFrame,
    pitch_counts: pd.DataFrame,
    starter: pd.Series,
    starter_p: pd.Series,
    salary: pd.Series,
    price: pd.Series,
    stats: pd.DataFrame,
    prospect_stats: pd.DataFrame,
    sp_contract: dict | None = None,
    demand: pd.Series | None = None,
    game_year: int | None = None,
    super_two_ids: set | None = None,
    salary_report_entry: dict | None = None,
) -> dict:
    """Build one pitcher's nested dict."""
    row = players.loc[idx]
    stats_row = stats.loc[idx]
    pc_row = pitch_counts.loc[idx]

    d = {
        "id": int(row["ID"]),
        "meta": _build_pitcher_meta(row, salary.loc[idx], price.loc[idx], demand.loc[idx] if demand is not None else None),
        "ratings": _build_pitcher_ratings(row),
        "pitchGrades": _build_pitch_grades(row),
        "pitchCounts": {
            "pitches": _safe_int(pc_row.get("Pitches")),
            "spPPitch": _safe_int(pc_row.get("SP P Pitch")),
            "spPitch": _safe_int(pc_row.get("SP Pitch")),
        },
        "starter": bool(starter.loc[idx]),
        "starterP": bool(starter_p.loc[idx]),
        "sp": _build_pitcher_role_stats(stats_row, "SP"),
        "rp": _build_pitcher_role_stats(stats_row, "RP"),
        "prospect": _build_prospect_pitcher(idx, prospect_stats),
        "extra": _collect_extra(row),
    }
    if sp_contract is not None:
        d["contract"] = sp_contract
    if game_year is not None:
        d["_projection"] = build_player_projection(d, game_year, super_two_ids, salary_report_entry)
    return _strip_none(d)


# ---------------------------------------------------------------------------
# Metadata auto-detection
# ---------------------------------------------------------------------------


def _detect_metadata(
    metadata_dir: Path | str | None,
    settings: PipelineSettings | None = None,
) -> tuple | None:
    """Auto-detect custom metadata inputs and compute data points.

    Returns (HitterDataPoints, PitcherDataPoints) if inputs found, else None.
    """
    if metadata_dir is None:
        return None

    metadata_dir = Path(metadata_dir)

    if not metadata_dir.is_dir():
        return None

    csvs = list(metadata_dir.glob("*.csv"))
    if not csvs:
        return None

    from src.metadata import _BlendKwargs
    blend_kw: _BlendKwargs | dict = {}
    if settings is not None:
        blend_kw = {
            "relative_blend": settings.relative_blend,
            "osa_blend": settings.osa_blend,
            "scout_weight": settings.scout_weight,
            "osa_weight": settings.osa_weight,
        }

    hitting, pitching, fielding = generate_data_points(metadata_dir, **blend_kw)
    return compose_data_points(hitting, pitching, fielding)


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def _detect_csv_presence(player_dir: Path) -> dict:
    """Report which player-source CSVs exist in `player_dir`.

    Returned flags drive view visibility on the frontend (e.g. hide the IAFA
    Board when there's no iafa.csv). `hasOrganization` is informational only —
    the pipeline already requires it via validation.
    """
    files = {p.name.lower() for p in player_dir.iterdir() if p.is_file() and p.suffix.lower() == ".csv"}
    has_draft = any(re.match(r"^draft\d{4}\.csv$", f) for f in files)
    return {
        "hasOrganization": "organization.csv" in files,
        "hasFreeAgents": "freeagents.csv" in files,
        "hasIAFA": "iafa.csv" in files,
        "hasDraft": has_draft,
    }


def build_dashboard(
    settings: PipelineSettings,
    player_dir: str | Path,
    ballpark_path: str | Path,
    metadata_dir: str | Path | None = None,
    contracts: dict | None = None,
    salary_reports: dict | None = None,
    players_extra: dict | None = None,
) -> dict:
    """Full pipeline: load → compute → build JSON dict.

    1. Load players (relative + OSA blending per settings)
    2. Load ballparks, compute park factors based on mode
    3. Split hitters vs pitchers (two-way appear in both)
    4. Compute hitter current stats (batting, eligibility, fielding, WAA)
    5. Compute hitter prospect stats (potential ratings → pipeline)
    6. Compute pitcher current stats (SP + RP)
    7. Compute pitcher prospect stats
    8. Build nested dicts for each player
    9. Assemble top-level structure with platoon splits
    """
    player_dir = Path(player_dir)
    ballpark_path = Path(ballpark_path)

    # 1. Load players
    print("Loading players...")
    players = load_players(
        player_dir,
        relative_blend=settings.relative_blend,
        osa_blend=settings.osa_blend,
        scout_weight=settings.scout_weight,
        osa_weight=settings.osa_weight,
    )

    # 2. Load ballparks + compute park factors
    print("Computing park factors...")
    if settings.park_factor_mode == "neutral":
        park_deltas = neutral_park_deltas()
        park_adj = neutral_adjustments()
        home_fraction = 0.0
        woba_ratio = 1.0
    else:
        table = BallparksTable.from_csv(ballpark_path)
        park_deltas = table.compute_park_deltas(settings.team, settings.home_fraction)
        park_adj = table.rows[settings.team].adj
        home_fraction = settings.home_fraction
        woba_ratio = park_deltas.woba_ratio

    # 3. Split hitters vs pitchers
    # Hitters = non-pitchers + two-way players
    # Pitchers = pitchers + two-way players
    is_hitter = ~players["is_pitcher"] | players["is_two_way"]
    is_pitcher = players["is_pitcher"] | players["is_two_way"]

    hitter_players = players[is_hitter].copy()
    pitcher_players = players[is_pitcher].copy()

    # Auto-detect custom metadata or fall back to hardcoded defaults
    custom = _detect_metadata(metadata_dir, settings)
    if custom is not None:
        dp_h, dp_p = custom
        print("Using custom metadata from", metadata_dir)
    else:
        dp_h = DEFAULT_HITTER_DP
        dp_p = DEFAULT_PITCHER_DP
        print("Using default OOTP 26 parameters")

    # 4. Compute hitter current stats
    print(f"Computing hitter stats ({len(hitter_players)} players)...")

    # Eligibility first (needed for fielding + WAA + two-way refinement)
    eligibility = compute_position_eligibility(hitter_players, dp_h)

    # Refine two-way flags using eligibility
    refined_tw = refine_two_way(hitter_players, eligibility)
    hitter_players.loc[:, "is_two_way"] = refined_tw

    batting = compute_hitter_batting(
        hitter_players, park_deltas, park_adj, home_fraction, dp_h
    )
    fielding_stats = compute_fielding(hitter_players, eligibility, dp_h)
    waa_stats = compute_waa(
        batting, fielding_stats, eligibility, park_deltas, home_fraction, dp_h
    )

    # Height in cm for hitter meta
    ht_cm = parse_height_cm(hitter_players["HT"])

    # Salary and price for hitters
    h_slr = _parse_salary(hitter_players["SLR"]) if "SLR" in hitter_players.columns else pd.Series(np.nan, index=hitter_players.index)
    h_dem = _parse_demand(hitter_players["DEM"]) if "DEM" in hitter_players.columns else pd.Series(np.nan, index=hitter_players.index)
    h_price = _compute_price(h_slr, h_dem, hitter_players["ORG"])

    # 5. Compute hitter prospect stats
    print("Computing hitter prospect stats...")
    prospect_hitters = _prepare_prospect_hitters(hitter_players)
    prospect_batting = compute_hitter_batting(
        prospect_hitters, park_deltas, park_adj, home_fraction, dp_h
    )
    # Prospect fielding + WAA (using potential fielding ratings for eligibility)
    prospect_elig = compute_position_eligibility(prospect_hitters, dp_h)
    prospect_fielding = compute_fielding(prospect_hitters, prospect_elig, dp_h)
    prospect_waa = compute_waa(
        prospect_batting, prospect_fielding, prospect_elig,
        park_deltas, home_fraction, dp_h
    )

    # 6. Compute pitcher current stats
    print(f"Computing pitcher stats ({len(pitcher_players)} players)...")
    pitch_counts = compute_pitch_counts(pitcher_players)
    starter = compute_starter_flag(pitcher_players, pitch_counts)
    starter_p = compute_starter_potential(pitcher_players, pitch_counts)
    pitcher_stats = compute_pitcher_batting(
        pitcher_players, park_adj, home_fraction, dp_p, woba_ratio
    )

    # 7. Compute pitcher prospect stats
    print("Computing pitcher prospect stats...")
    prospect_pitchers = _prepare_prospect_pitchers(pitcher_players)
    prospect_pitcher_stats = compute_pitcher_batting(
        prospect_pitchers, park_adj, home_fraction, dp_p, woba_ratio
    )

    # Salary and price for pitchers
    p_slr = _parse_salary(pitcher_players["SLR"]) if "SLR" in pitcher_players.columns else pd.Series(np.nan, index=pitcher_players.index)
    p_dem = _parse_demand(pitcher_players["DEM"]) if "DEM" in pitcher_players.columns else pd.Series(np.nan, index=pitcher_players.index)
    p_price = _compute_price(p_slr, p_dem, pitcher_players["ORG"])

    # 8. Build nested dicts for each player
    print("Building JSON output...")
    if contracts:
        from src.statsplus import contract_to_json

    # Game-date derived projection inputs
    game_date_str = _detect_game_date(players)
    if game_date_str:
        game_dt = datetime.strptime(game_date_str, "%Y-%m-%d")
    else:
        import datetime as _dt
        game_dt = datetime.combine(_dt.date.today(), datetime.min.time())
    game_year = game_dt.year
    season_day = game_dt.timetuple().tm_yday % DAYS_PER_SEASON

    # Lightweight player-projection seeds for super-two (need MLD, act, ic, lev,
    # org for the free-agent guard, and StatsPlus mlb_service_days_this_year for
    # the 86-day rule).
    proj_seed = []
    for idx in players.index:
        prow = players.loc[idx]
        pid = int(prow["ID"])
        extra = (players_extra or {}).get(str(pid)) or {}
        proj_seed.append({
            "id": pid,
            "meta": {
                "mld": _safe_int(_row_val(prow, "MLD")) or 0,
                "mly": _safe_int(_row_val(prow, "MLY")) or 0,
                "act": _safe_bool(_row_val(prow, "ACT", False)),
                "ic": _safe_str(_row_val(prow, "IC")),
                "lev": _safe_str(_row_val(prow, "Lev")),
                "org": _safe_str(_row_val(prow, "ORG")),
                "mlb_service_days_this_year": extra.get("mlb_service_days_this_year"),
            },
        })
    super_two_ids, super_two_cutoff = project_super_two(proj_seed, season_day)

    # salary_reports is a flat {playerId: entry} dict spanning every team's salary
    # report, so look up by pid directly without filtering by user team.
    sr_map = salary_reports or {}

    # Precompute pid strings once — avoids per-row hitter_players.loc[idx, "ID"]
    # lookups (the slowest path for scalar access in pandas).
    hitter_id_strs = hitter_players["ID"].astype(int).astype(str)
    pitcher_id_strs = pitcher_players["ID"].astype(int).astype(str)

    def _merge_players_extra(d: dict, pid_str: str) -> dict:
        if not players_extra:
            return d
        extra = players_extra.get(pid_str)
        if not extra:
            return d
        meta = d.setdefault("meta", {})
        for key, v in extra.items():
            if v is not None:
                meta[key] = v
        return d

    hitter_dicts = []
    for idx, pid_str in hitter_id_strs.items():
        sp_contract = None
        if contracts:
            raw = contracts.get(pid_str)
            if raw:
                sp_contract = contract_to_json(raw)
        sr_entry = sr_map.get(pid_str)
        d = _build_hitter_dict(
            idx, hitter_players, ht_cm, h_slr, h_price, batting, eligibility,
            fielding_stats, waa_stats, prospect_batting, prospect_waa,
            sp_contract, demand=h_dem,
            game_year=game_year, super_two_ids=super_two_ids,
            salary_report_entry=sr_entry,
        )
        if sr_entry:
            d["_salaryReport"] = sr_entry
        hitter_dicts.append(_merge_players_extra(d, pid_str))

    pitcher_dicts = []
    for idx, pid_str in pitcher_id_strs.items():
        sp_contract = None
        if contracts:
            raw = contracts.get(pid_str)
            if raw:
                sp_contract = contract_to_json(raw)
        sr_entry = sr_map.get(pid_str)
        d = _build_pitcher_dict(
            idx, pitcher_players, pitch_counts, starter, starter_p,
            p_slr, p_price,
            pitcher_stats, prospect_pitcher_stats,
            sp_contract, demand=p_dem,
            game_year=game_year, super_two_ids=super_two_ids,
            salary_report_entry=sr_entry,
        )
        if sr_entry:
            d["_salaryReport"] = sr_entry
        pitcher_dicts.append(_merge_players_extra(d, pid_str))

    # 9. Assemble top-level structure
    lp_h = dp_h.league
    lp_p = dp_p.league

    result = {
        "meta_projection": {
            "gameYear": game_year,
            "seasonDay": season_day,
            "superTwoCutoffMLD": super_two_cutoff,
            "yearHorizon": 7,
        },
        "meta": {
            "generatedAt": datetime.now().isoformat(timespec="seconds"),
            "gameDate": _detect_game_date(players),
            "settings": {
                "team": settings.team,
                "parkFactorMode": settings.park_factor_mode,
                "homeFraction": settings.home_fraction,
                "relativeBlend": settings.relative_blend,
                "osaBlend": settings.osa_blend,
            },
            "playerCount": {
                "hitters": len(hitter_dicts),
                "pitchers": len(pitcher_dicts),
            },
            "csvPresence": _detect_csv_presence(player_dir),
        },
        "platoonSplits": {
            "hitters": {
                "L": {"vR": lp_h.lvr, "vL": round(1 - lp_h.lvr, 4)},
                "R": {"vR": lp_h.rvr, "vL": round(1 - lp_h.rvr, 4)},
                "S": {"vR": lp_h.svr, "vL": round(1 - lp_h.svr, 4)},
            },
            "pitchers": {
                "L": {"vR": round(lp_p.lvr, 4), "vL": round(1 - lp_p.lvr, 4)},
                "R": {"vR": round(lp_p.rvr, 4), "vL": round(1 - lp_p.rvr, 4)},
                "S": {"vR": round(lp_p.svr, 4), "vL": round(1 - lp_p.svr, 4)},
            },
        },
        "hitters": hitter_dicts,
        "pitchers": pitcher_dicts,
    }

    return result
