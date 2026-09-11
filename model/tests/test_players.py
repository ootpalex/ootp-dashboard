"""Tests for the player-CSV discovery and loader in src.players."""

from pathlib import Path

import pytest

from src.players import (
    SCOUTED_SPLIT_COLUMNS,
    SCOUTED_SUFFIX,
    _discover_csv_files,
    _load_single_csv,
    load_players,
)


# Minimal CSV header covering every column referenced by load_players'
# downstream helpers (_detect_pitcher, _detect_two_way). Any extra columns
# in real OOTP exports are ignored by this code path.
_HEADER = "ID,Name,POS,ORG,OVR,POT,CON P,POW P,EYE P,STU P,MOV P,PCON P"


def _write_player_csv(path: Path, rows: list[str]) -> None:
    path.write_text(_HEADER + "\n" + "\n".join(rows) + "\n")


def test_discover_picks_up_intl_alongside_org(tmp_path: Path) -> None:
    """_discover_csv_files should return both org.csv and intl.csv when present."""
    (tmp_path / "org.csv").write_text(_HEADER + "\n")
    (tmp_path / "intl.csv").write_text(_HEADER + "\n")

    pairs = _discover_csv_files(tmp_path)
    names = sorted(p.name for p, _ in pairs)
    assert names == ["intl.csv", "org.csv"]
    assert all(osa is None for _, osa in pairs)


def test_intl_rows_source_tagged_organization(tmp_path: Path) -> None:
    """Rows from intl.csv share the 'Organization' source tag with org.csv rows."""
    _write_player_csv(
        tmp_path / "org.csv",
        ["1,Alice,SS,NYY,50,55,50,50,50,20,20,20"],
    )
    _write_player_csv(
        tmp_path / "intl.csv",
        ["2,Bob,CF,NYY,30,60,40,40,40,20,20,20"],
    )

    df = load_players(tmp_path)
    assert sorted(df["ID"].tolist()) == [1, 2]
    assert set(df["source"].unique()) == {"Organization"}


# Columns that the pitcher pipeline reads after disambiguation. The hitter-side
# CON / INJ / DEM copies stay under their bare caption; the pitcher-side copies
# must surface as PCON*, INJ2, DEM2, and the HR rating as HRR*.
_PITCHER_RENAME_TARGETS = [
    "PCON", "PCON vL", "PCON vR", "PCON P",
    "HRR", "HRR vL", "HRR vR", "HRR P",
    "INJ2", "DEM2",
]


def test_pandas_duplicate_columns_normalized(tmp_path: Path) -> None:
    """Raw OOTP exports use literal duplicate captions; pandas suffixes them
    with '.1' and the loader renames the pitcher copy (the historical path)."""
    header = ("ID,Name,POS,INJ,INJ,CON,CON,CON vL,CON vL,CON vR,CON vR,"
              "CON P,CON P,HRR,HRR vL,HRR vR,HRR P,DEM,DEM")
    path = tmp_path / "org.csv"
    path.write_text(header + "\n" + ",".join(["x"] * 19) + "\n")

    cols = _load_single_csv(path).columns
    for target in _PITCHER_RENAME_TARGETS:
        assert target in cols, f"{target!r} missing from {list(cols)}"
    # Hitter-side copies are preserved under their bare caption.
    assert "CON" in cols and "INJ" in cols and "DEM" in cols


def test_spreadsheet_deduped_columns_normalized(tmp_path: Path) -> None:
    """A CSV round-tripped through a spreadsheet arrives with '_1'-suffixed
    duplicates and an 'HRA' HR caption; the loader normalizes both."""
    header = ("ID,Name,POS,INJ,INJ_1,CON,CON_1,CON vL,CON vL_1,CON vR,CON vR_1,"
              "CON P,CON P_1,HRA,HRA vL,HRA vR,HRA P,DEM,DEM_1")
    path = tmp_path / "org.csv"
    path.write_text(header + "\n" + ",".join(["x"] * 19) + "\n")

    cols = _load_single_csv(path).columns
    for target in _PITCHER_RENAME_TARGETS:
        assert target in cols, f"{target!r} missing from {list(cols)}"
    assert "CON" in cols and "INJ" in cols and "DEM" in cols
    # The stray 'HRA' / '_1' raw names should be gone after normalization.
    assert "HRA" not in cols and "CON_1" not in cols


# ---------------------------------------------------------------------------
# As-scouted split snapshots (src.players._snapshot_scouted_splits)
# ---------------------------------------------------------------------------

# Full split-rating header, plus what _detect_two_way reads. The hitter/pitcher
# CON duplicate is spelled the way a spreadsheet round-trip leaves it.
_SPLIT_HEADER = (
    "ID,Name,POS,ORG,OVR,POT,"
    "BA vL,BA vR,CON vL,CON vR,GAP vL,GAP vR,POW vL,POW vR,EYE vL,EYE vR,K vL,K vR,"
    "STU vL,STU vR,MOV vL,MOV vR,CON vL_1,CON vR_1,HRR vL,HRR vR,PBABIP vL,PBABIP vR,"
    "CON P,POW P,EYE P,STU P,MOV P,PCON P"
)


def _write_split_csv(path: Path, rows: list[str]) -> None:
    path.write_text(_SPLIT_HEADER + "\n" + "\n".join(rows) + "\n")


def test_scouted_splits_snapshotted_for_both_sides(tmp_path: Path) -> None:
    """Every hitter and pitcher vR/vL rating gains a ' SCOUT' copy on load."""
    _write_split_csv(
        tmp_path / "org.csv",
        ["1,Alice,SS,NYY,50,55," + ",".join(str(v) for v in range(40, 52)) + ","
         + ",".join(str(v) for v in range(20, 30)) + ",50,50,50,20,20,20"],
    )

    df = load_players(tmp_path)
    row = df.iloc[0]
    for col in SCOUTED_SPLIT_COLUMNS:
        snapshot = col + SCOUTED_SUFFIX
        assert snapshot in df.columns, f"{snapshot!r} missing"
        assert row[snapshot] == row[col]


def test_scouted_splits_survive_osa_blend_unblended(tmp_path: Path) -> None:
    """The OSA blend moves the live rating columns but never the SCOUT copies —
    the snapshot is the quantized grade OOTP displays, which is the whole point.
    """
    scout_vals = ",".join(["40"] * 22)
    osa_vals = ",".join(["60"] * 22)
    _write_split_csv(tmp_path / "org.csv", [f"1,Alice,SS,NYY,50,55,{scout_vals},50,50,50,20,20,20"])
    _write_split_csv(tmp_path / "org_osa.csv", [f"1,Alice,SS,NYY,50,55,{osa_vals},50,50,50,20,20,20"])

    df = load_players(tmp_path, osa_blend=True, scout_weight=0.9, osa_weight=0.1)
    row = df.iloc[0]
    # 0.9 * 40 + 0.1 * 60 = 42 on the live column; the snapshot stays at 40.
    assert row["EYE vL"] == pytest.approx(42.0)
    assert row["EYE vL" + SCOUTED_SUFFIX] == 40
    assert row["PCON vR"] == pytest.approx(42.0)
    assert row["PCON vR" + SCOUTED_SUFFIX] == 40


def test_scouted_snapshot_skipped_when_columns_absent(tmp_path: Path) -> None:
    """An export with no split ratings simply gains no SCOUT columns."""
    _write_player_csv(tmp_path / "org.csv", ["1,Alice,SS,NYY,50,55,50,50,50,20,20,20"])

    df = load_players(tmp_path)
    assert not [c for c in df.columns if c.endswith(SCOUTED_SUFFIX)]
