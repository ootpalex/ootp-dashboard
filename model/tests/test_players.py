"""Tests for the player-CSV discovery and loader in src.players."""

from pathlib import Path

from src.players import _discover_csv_files, load_players


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
