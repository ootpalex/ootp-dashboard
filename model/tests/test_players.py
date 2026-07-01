"""Tests for the player-CSV discovery and loader in src.players."""

from pathlib import Path

from src.players import _discover_csv_files, _load_single_csv, load_players


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
