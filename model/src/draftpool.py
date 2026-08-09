"""
src/draftpool.py — Build draft-class player rows from the StatsPlus API.

When a league has no hand-exported ``draft<YYYY>.csv``, the pipeline can fetch
the current (or just-completed) draft class from the tokenless StatsPlus
endpoint ``<api>/draftpool/`` and reconstruct OOTP-export-format player rows
from the league's raw StatsPlus ratings dumps stored under
``leagues/<slug>/ratings/`` (``ratings_scout_<date>.csv.gz`` plus an optional
``ratings_osa_<date>.csv.gz``).

The dump→export column mapping below was derived empirically by matching the
840 players of the hand-exported SSB draft2043.csv against the same players in
the SSB scout ratings dump, cell by cell (Rosetta-stone method). Two known
traps are encoded here: the batting-average family maps from the dump's
BABIP_L/R columns (NOT Cntct), and catcher blocking ("C ABI") maps from CBlk.

Every fetch failure degrades to "no API draft pool" with a printed warning —
this module must never crash a build.
"""

from __future__ import annotations

import csv
import io
import re
import urllib.error
import urllib.request
from pathlib import Path

import pandas as pd

from src.statsplus import fetch_game_date, normalize_api_base

# ---------------------------------------------------------------------------
# Ratings-dump discovery (leagues/<slug>/ratings/)
# ---------------------------------------------------------------------------

_SCOUT_DUMP_RE = re.compile(r"^ratings_scout_(\d{4}-\d{2}-\d{2})\.csv\.gz$")
_OSA_DUMP_RE = re.compile(r"^ratings_osa_(\d{4}-\d{2}-\d{2})\.csv\.gz$")


def find_ratings_dumps(ratings_dir: Path | str) -> tuple[Path | None, Path | None]:
    """Locate the newest scout dump (by filename date) and the newest OSA dump.

    Returns (scout_path_or_None, osa_path_or_None). The OSA dump is optional;
    the scout dump is required for the API draft path to activate.
    """
    ratings_dir = Path(ratings_dir)
    if not ratings_dir.is_dir():
        return None, None
    scout: list[tuple[str, Path]] = []
    osa: list[tuple[str, Path]] = []
    for p in ratings_dir.iterdir():
        if not p.is_file():
            continue
        m = _SCOUT_DUMP_RE.match(p.name)
        if m:
            scout.append((m.group(1), p))
            continue
        m = _OSA_DUMP_RE.match(p.name)
        if m:
            osa.append((m.group(1), p))
    scout_path = max(scout)[1] if scout else None
    osa_path = max(osa)[1] if osa else None
    return scout_path, osa_path


# ---------------------------------------------------------------------------
# StatsPlus fetches
# ---------------------------------------------------------------------------


def fetch_draftpool(statsplus_url: str, timeout: int = 15) -> list[int]:
    """Fetch the draft-pool player IDs from ``<api>/draftpool/``.

    The endpoint is tokenless and returns CSV with header "ID","Player Name"
    for the current or most recently completed draft. Returns an empty list
    (with a printed warning) on any network / HTTP / parse failure — the
    caller treats an empty pool as "no API draft class".
    """
    base = normalize_api_base(statsplus_url)
    if not base:
        return []
    url = f"{base}/draftpool/"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        print(f"  Warning: could not fetch draft pool from {url} — {e}")
        return []

    text = text.strip()
    if not text:
        return []
    try:
        reader = csv.DictReader(io.StringIO(text))
        if reader.fieldnames is None or "ID" not in reader.fieldnames:
            print(f"  Warning: draft pool response from {url} has no ID column — ignoring")
            return []
        ids: list[int] = []
        for row in reader:
            raw = (row.get("ID") or "").strip()
            if not raw:
                continue
            try:
                ids.append(int(raw))
            except ValueError:
                continue
        return ids
    except csv.Error as e:
        print(f"  Warning: malformed draft pool CSV from {url} — {e}")
        return []


def fetch_draft_year(statsplus_url: str) -> int | None:
    """Return the league's current in-game year from ``<api>/date/``.

    The endpoint returns a date in YYYY-MM-DD form (possibly with a CSV
    header, handled by ``fetch_game_date``). Returns None when the date is
    unavailable or unparseable.
    """
    date_str = fetch_game_date(statsplus_url)
    if not date_str:
        return None
    m = re.match(r"^\s*(\d{4})-\d{2}-\d{2}", str(date_str))
    if not m:
        print(f"  Warning: unexpected /date format {date_str!r} — cannot derive draft year")
        return None
    return int(m.group(1))


# ---------------------------------------------------------------------------
# Dump → OOTP-export column mapping (verified against SSB draft2043)
# ---------------------------------------------------------------------------

# Export column → dump column, copied verbatim. Verified traps: BA* ← BABIP_*
# (not Cntct), C ABI ← CBlk.
_DIRECT_MAP: dict[str, str] = {
    "Name": "Name", "POS": "Pos", "Age": "Age", "B": "Bats", "T": "Throws",
    # Hitting — current (bare = overall, _L/_R = splits)
    "CON": "Cntct", "BABIP": "BABIP", "GAP": "Gap", "POW": "Pow",
    "EYE": "Eye", "K's": "Ks",
    "BA vL": "BABIP_L", "CON vL": "Cntct_L", "GAP vL": "Gap_L",
    "POW vL": "Pow_L", "EYE vL": "Eye_L", "K vL": "Ks_L",
    "BA vR": "BABIP_R", "CON vR": "Cntct_R", "GAP vR": "Gap_R",
    "POW vR": "Pow_R", "EYE vR": "Eye_R", "K vR": "Ks_R",
    # Hitting — potential ("HT P" is the batting-average potential → PotBABIP)
    "HT P": "PotBABIP", "CON P": "PotCntct", "GAP P": "PotGap",
    "POW P": "PotPow", "EYE P": "PotEye", "K P": "PotKs",
    # Bunting
    "BUN": "SacBunt", "BFH": "BuntHit",
    # Pitching — current / splits / potential. The export's second CON copy
    # (control) carries the spreadsheet-dedup suffix "_1" and is renamed to
    # PCON* by players.py after loading.
    "STU": "Stf", "MOV": "Mov", "CON_1": "Ctrl", "PBABIP": "PBABIP", "HRA": "HRA",
    "STU vL": "Stf_L", "MOV vL": "Mov_L", "CON vL_1": "Ctrl_L",
    "PBABIP vL": "PBABIP_L", "HRA vL": "HRA_L",
    "STU vR": "Stf_R", "MOV vR": "Mov_R", "CON vR_1": "Ctrl_R",
    "PBABIP vR": "PBABIP_R", "HRA vR": "HRA_R",
    "STU P": "PotStf", "MOV P": "PotMov", "CON P_1": "PotCtrl",
    "PBABIP P": "PotPBABIP", "HRA P": "PotHRA",
    # Misc pitching
    "VELO": "Vel", "STM": "Stm", "HLD": "Hold",
    # Fielding abilities (C ABI = catcher blocking = CBlk)
    "C ABI": "CBlk", "C FRM": "CFrm", "C ARM": "CArm",
    "IF RNG": "IFR", "IF ERR": "IFE", "IF ARM": "IFA", "TDP": "TDP",
    "OF RNG": "OFR", "OF ERR": "OFE", "OF ARM": "OFA",
    # Speed / baserunning
    "SPE": "Speed", "SR": "StlRt", "STE": "Steal", "RUN": "Run",
    # Overall / potential (20-80 scale in both frames)
    "OVR": "Ovr", "POT": "Pot",
    # Personality / injury
    "LEA": "Lead", "LOY": "Loy", "FIN": "Greed", "WE": "WrkEthic",
    "INT": "Int", "Prone": "Prone",
}

# Export column → dump column where the dump uses 0 for "no rating" but the
# export shows "-". Covers pitch grades and position ratings.
_ZERO_DASH_MAP: dict[str, str] = {
    # Pitch grades — current
    "FB": "Fst", "CH": "Chg", "CB": "Crv", "SL": "Sld", "SI": "Snk",
    "SP": "Splt", "CT": "Cutt", "FO": "Frk", "CC": "CirChg", "SC": "Scr",
    "KC": "Kncrv", "KN": "Knbl",
    # Pitch grades — potential
    "FBP": "PotFst", "CHP": "PotChg", "CBP": "PotCrv", "SLP": "PotSld",
    "SIP": "PotSnk", "SPP": "PotSplt", "CTP": "PotCutt", "FOP": "PotFrk",
    "CCP": "PotCirChg", "SCP": "PotScr", "KCP": "PotKncrv", "KNP": "PotKnbl",
    # Position ratings — current
    "P": "P", "C": "C", "1B": "1B", "2B": "2B", "3B": "3B", "SS": "SS",
    "LF": "LF", "CF": "CF", "RF": "RF",
    # Position ratings — potential
    "P Pot": "PotP", "C Pot": "PotC", "1B Pot": "Pot1B", "2B Pot": "Pot2B",
    "3B Pot": "Pot3B", "SS Pot": "PotSS", "LF Pot": "PotLF",
    "CF Pot": "PotCF", "RF Pot": "PotRF",
}

# Dump scout-accuracy code → export label.
_ACC_MAP = {"VH": "Very High", "H": "High", "A": "Average", "L": "Low", "VL": "Very Low"}

# Current pitch-grade dump columns, used to reconstruct the export's PIT
# (pitch count) column. Verified: count of nonzero dump pitch grades equals
# the export PIT for 99.9% of draft2043 rows and 99.5% of org rows.
_PITCH_DUMP_COLS = [
    "Fst", "Snk", "Cutt", "Crv", "Sld", "Chg",
    "Splt", "Frk", "CirChg", "Scr", "Kncrv", "Knbl",
]

# Columns the dump genuinely lacks → neutral "-" (ignored by the pipeline's
# numeric coercion and skipped by export._collect_extra).
_DASH_COLS = [
    "TM", "ORG", "LG", "Lev", "DOB", "WT", "Nat. Pop.", "Loc. Pop.",
    "AD", "INJ", "INJ_1", "Left", "Schl", "CommSch", "COMP", "HSC",
    "BBT", "GBT", "FBT", "G/F", "VT", "Slot", "PT",
    "CV", "ECV", "ON40", "IC", "WAIV", "DFA", "DEM", "DEM_1", "Sign",
    "FAT", "Sct", "Risk", "SctCat", "TXN", "TXNDT", "DrLg", "DrTm",
    "DiscTm", "Relation", "Interest",
]

# Columns the export shows as 0 for never-drafted / no-contract players.
_ZERO_COLS = [
    "YL", "TY", "ETY", "MLY", "MLD", "SECY", "SECD", "PROY", "OPT", "OY",
    "Draft", "Round", "Pick", "OA Pick", "Disc",
]

# Columns with a fixed non-dash neutral value in real draft exports.
_FIXED_COLS = {"Type": "Unknown", "R5": "No", "ROOK": "No", "ACT": "No", "SLR": "Free agent"}

# Full OOTP player-export column order (matches a real draft<YYYY>.csv header).
EXPORT_COLUMNS = [
    "ID", "POS", "Name", "TM", "ORG", "LG", "Lev", "DOB", "Age", "HT", "WT",
    "B", "T", "Nat. Pop.", "Loc. Pop.", "OVR", "POT", "LEA", "LOY", "AD",
    "FIN", "WE", "INT", "Type", "Prone", "INJ", "INJ_1", "Left", "Schl",
    "CommSch", "COMP", "HSC", "CON", "BABIP", "GAP", "POW", "EYE", "K's",
    "BA vL", "CON vL", "GAP vL", "POW vL", "EYE vL", "K vL",
    "BA vR", "CON vR", "GAP vR", "POW vR", "EYE vR", "K vR",
    "HT P", "CON P", "GAP P", "POW P", "EYE P", "K P",
    "BUN", "BFH", "BBT", "GBT", "FBT",
    "STU", "MOV", "CON_1", "PBABIP", "HRA",
    "STU vL", "MOV vL", "CON vL_1", "PBABIP vL", "HRA vL",
    "STU vR", "MOV vR", "CON vR_1", "PBABIP vR", "HRA vR",
    "STU P", "MOV P", "CON P_1", "PBABIP P", "HRA P",
    "FB", "FBP", "CH", "CHP", "CB", "CBP", "SL", "SLP", "SI", "SIP",
    "SP", "SPP", "CT", "CTP", "FO", "FOP", "CC", "CCP", "SC", "SCP",
    "KC", "KCP", "KN", "KNP",
    "PIT", "G/F", "VELO", "VT", "Slot", "PT", "STM", "HLD",
    "C ABI", "C FRM", "C ARM", "IF RNG", "IF ERR", "IF ARM", "TDP",
    "OF RNG", "OF ERR", "OF ARM",
    "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF",
    "P Pot", "C Pot", "1B Pot", "2B Pot", "3B Pot", "SS Pot", "LF Pot",
    "CF Pot", "RF Pot",
    "SPE", "SR", "STE", "RUN", "SLR",
    "YL", "CV", "TY", "ECV", "ETY", "MLY", "MLD", "SECY", "SECD", "PROY",
    "OPT", "OY", "ON40", "IC", "WAIV", "DFA", "DEM", "DEM_1", "Sign", "R5",
    "FAT", "ROOK", "ACT", "Sct", "SctAcc", "Risk", "SctCat", "TXN", "TXNDT",
    "DrLg", "DrTm", "Draft", "Round", "Pick", "OA Pick", "Disc", "DiscTm",
    "Relation", "Interest",
]


def _height_str(cm) -> str:
    """Convert dump centimeters to the export's feet-inch string (``6' 1'``).

    Nearest-inch rounding reproduces the real export for 98.8% of players;
    the remainder are off by one inch (OOTP's internal height isn't exactly
    recoverable from whole centimeters).
    """
    try:
        total_in = round(float(cm) / 2.54)
    except (TypeError, ValueError):
        return "-"
    if total_in <= 0:
        return "-"
    return f"{int(total_in) // 12}' {int(total_in) % 12}'"


def build_draft_players(
    ids: list[int],
    scout_dump: pd.DataFrame,
    osa_dump: pd.DataFrame | None,
    year: int,
) -> tuple[pd.DataFrame, pd.DataFrame | None]:
    """Build OOTP-export-format draft rows from StatsPlus ratings dumps.

    Args:
        ids: draft-pool player IDs from ``fetch_draftpool``.
        scout_dump: the scout ratings dump (``ratings_scout_*.csv.gz``).
        osa_dump: the OSA ratings dump, or None. Only players present in the
            scout selection are carried into the OSA frame.
        year: in-game draft year, used for the ``source`` tag "Draft <year>".

    Returns:
        (scout_frame, osa_frame_or_None) in the raw OOTP export column
        convention (``CON_1``/``HRA``-style headers). players.py applies the
        same duplicate-column renames it applies to CSV files, then blends the
        OSA frame with the standard _RATING_COLUMNS whitelist. Both frames
        carry ``source = "Draft <year>"``.
    """
    id_set = set(ids)
    scout_rows = scout_dump[scout_dump["ID"].isin(id_set)]
    missing = len(id_set) - len(scout_rows)
    if missing:
        print(
            f"  Warning: {missing} of {len(id_set)} draft-pool IDs missing from "
            f"the scout ratings dump — those players are skipped"
        )

    frames = [_dump_rows_to_export(scout_rows, year)]
    if osa_dump is not None:
        osa_rows = osa_dump[osa_dump["ID"].isin(set(scout_rows["ID"]))]
        frames.append(_dump_rows_to_export(osa_rows, year))
    else:
        frames.append(None)
    return frames[0], frames[1]


def _dump_rows_to_export(rows: pd.DataFrame, year: int) -> pd.DataFrame:
    """Map a slice of a StatsPlus ratings dump into export-format columns."""
    cols: dict[str, object] = {"ID": rows["ID"]}
    for export_col, dump_col in _DIRECT_MAP.items():
        cols[export_col] = rows[dump_col] if dump_col in rows.columns else "-"
    for export_col, dump_col in _ZERO_DASH_MAP.items():
        if dump_col in rows.columns:
            vals = pd.to_numeric(rows[dump_col], errors="coerce")
            cols[export_col] = rows[dump_col].where(vals.ne(0), other="-")
        else:
            cols[export_col] = "-"
    cols["HT"] = rows["Height"].map(_height_str) if "Height" in rows.columns else "-"
    if all(c in rows.columns for c in _PITCH_DUMP_COLS):
        pitch = rows[_PITCH_DUMP_COLS].apply(pd.to_numeric, errors="coerce")
        cols["PIT"] = pitch.gt(0).sum(axis=1)
    else:
        cols["PIT"] = "-"
    if "Acc" in rows.columns:
        cols["SctAcc"] = rows["Acc"].map(_ACC_MAP).fillna("-")
    else:
        cols["SctAcc"] = "-"
    for col in _DASH_COLS:
        cols[col] = "-"
    for col in _ZERO_COLS:
        cols[col] = 0
    for col, val in _FIXED_COLS.items():
        cols[col] = val
    cols["source"] = f"Draft {year}"
    out = pd.DataFrame(cols, index=rows.index)
    return out[EXPORT_COLUMNS + ["source"]].reset_index(drop=True)


# ---------------------------------------------------------------------------
# Orchestrator used by players.load_players
# ---------------------------------------------------------------------------


def load_api_draft_pool(
    statsplus_url: str,
    ratings_dir: Path | str,
) -> tuple[pd.DataFrame, pd.DataFrame | None, int] | None:
    """Fetch the draft pool and build export-format rows from local dumps.

    Returns (scout_frame, osa_frame_or_None, year), or None when any
    precondition fails: no scout dump on disk, empty/failed pool fetch,
    unknown in-game year, or no pool IDs present in the dump. Never raises
    for network-shaped failures.
    """
    scout_path, osa_path = find_ratings_dumps(ratings_dir)
    if scout_path is None:
        return None

    ids = fetch_draftpool(statsplus_url)
    if not ids:
        return None

    year = fetch_draft_year(statsplus_url)
    if year is None:
        print("  Warning: could not determine in-game year — skipping API draft pool")
        return None

    try:
        scout_dump = pd.read_csv(scout_path, low_memory=False)
        osa_dump = pd.read_csv(osa_path, low_memory=False) if osa_path else None
    except (OSError, ValueError, pd.errors.ParserError) as e:
        print(f"  Warning: could not read ratings dump ({scout_path}) — {e}")
        return None

    scout_df, osa_df = build_draft_players(ids, scout_dump, osa_dump, year)
    if scout_df.empty:
        return None
    osa_note = f" + OSA ({osa_path.name})" if osa_path else ""
    print(
        f"  StatsPlus draft pool: {len(scout_df)} players (Draft {year}) "
        f"from {scout_path.name}{osa_note}"
    )
    return scout_df, osa_df, year
