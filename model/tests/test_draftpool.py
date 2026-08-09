"""Tests for the StatsPlus draft-pool API ingestion (src.draftpool).

No test in this module touches the network — every fetch is monkeypatched.
"""

from pathlib import Path

import pandas as pd
import pytest

import src.draftpool as draftpool
from src.draftpool import (
    EXPORT_COLUMNS,
    build_draft_players,
    fetch_draft_year,
    fetch_draftpool,
    find_ratings_dumps,
    load_api_draft_pool,
)
from src.export import _detect_csv_presence
from src.players import _COLUMN_RENAMES, load_players


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

# Minimal org.csv header covering load_players' downstream needs (same
# convention as test_players.py).
_ORG_HEADER = "ID,Name,POS,ORG,OVR,POT,CON P,POW P,EYE P,STU P,MOV P,PCON P"


def _write_org_csv(path: Path) -> None:
    path.write_text(
        _ORG_HEADER + "\n" + "1,Alice,SS,NYY,50,55,50,50,50,20,20,20\n"
    )


def _dump_frame(rows: list[dict]) -> pd.DataFrame:
    """Build a synthetic StatsPlus ratings dump with dump-native columns."""
    base = {
        "ID": 0, "Name": "X", "Pos": "SS", "Age": 18, "Height": 183,
        "Bats": "R", "Throws": "R",
        "Cntct": 40, "Gap": 40, "Pow": 40, "Eye": 40, "Ks": 40, "BABIP": 40,
        "Cntct_R": 40, "Gap_R": 40, "Pow_R": 40, "Eye_R": 40, "Ks_R": 40, "BABIP_R": 40,
        "Cntct_L": 40, "Gap_L": 40, "Pow_L": 40, "Eye_L": 40, "Ks_L": 40, "BABIP_L": 40,
        "PotCntct": 50, "PotGap": 50, "PotPow": 50, "PotEye": 50, "PotKs": 50, "PotBABIP": 50,
        "IFR": 45, "IFE": 45, "IFA": 45, "TDP": 45, "OFR": 45, "OFE": 45, "OFA": 45,
        "CBlk": 0, "CArm": 0, "CFrm": 0,
        "P": 0, "C": 0, "1B": 0, "2B": 0, "3B": 0, "SS": 55, "LF": 0, "CF": 0, "RF": 0,
        "PotP": 0, "PotC": 0, "Pot1B": 0, "Pot2B": 0, "Pot3B": 0, "PotSS": 60,
        "PotLF": 0, "PotCF": 0, "PotRF": 0,
        "Speed": 50, "StlRt": 50, "Steal": 50, "Run": 50, "SacBunt": 30, "BuntHit": 30,
        "Stf": 20, "Mov": 20, "HRA": 20, "PBABIP": 20, "Ctrl": 20,
        "Stf_R": 20, "Mov_R": 20, "HRA_R": 20, "PBABIP_R": 20, "Ctrl_R": 20,
        "Stf_L": 20, "Mov_L": 20, "HRA_L": 20, "PBABIP_L": 20, "Ctrl_L": 20,
        "PotStf": 20, "PotMov": 20, "PotHRA": 20, "PotPBABIP": 20, "PotCtrl": 20,
        "Vel": "88-90", "GB": 45, "Stm": 20, "Hold": 30,
        "Fst": 0, "Snk": 0, "Cutt": 0, "Crv": 0, "Sld": 0, "Chg": 0,
        "Splt": 0, "Frk": 0, "CirChg": 0, "Scr": 0, "Kncrv": 0, "Knbl": 0,
        "PotFst": 0, "PotSnk": 0, "PotCutt": 0, "PotCrv": 0, "PotSld": 0, "PotChg": 0,
        "PotSplt": 0, "PotFrk": 0, "PotCirChg": 0, "PotScr": 0, "PotKncrv": 0, "PotKnbl": 0,
        "Int": "N", "WrkEthic": "H", "Greed": "N", "Loy": "N", "Lead": "L",
        "Prone": "Normal", "Acc": "VH", "Ovr": 30, "Pot": 55,
    }
    out = []
    for row in rows:
        r = dict(base)
        r.update(row)
        out.append(r)
    return pd.DataFrame(out)


_PITCHER_ROW = {
    "ID": 101, "Name": "Cy Sample", "Pos": "SP", "Age": 21, "Height": 188,
    "Bats": "L", "Throws": "L",
    "BABIP_R": 33, "BABIP_L": 31, "Cntct_R": 42, "Cntct_L": 38,
    "Stf": 55, "Mov": 50, "Ctrl": 45, "PBABIP": 48, "HRA": 52,
    "Stf_R": 60, "Ctrl_R": 44, "HRA_R": 51,
    "PotStf": 65, "PotMov": 60, "PotCtrl": 55,
    "Fst": 60, "Sld": 55, "Chg": 45,
    "PotFst": 65, "PotSld": 60, "PotChg": 50,
    "P": 50, "PotP": 60, "SS": 0, "PotSS": 0,
    "Stm": 55, "Hold": 40, "Acc": "H",
}

_CATCHER_ROW = {
    "ID": 202, "Name": "Backstop Kid", "Pos": "C", "Age": 18, "Height": 180,
    "Bats": "R", "Throws": "R",
    "CBlk": 55, "CArm": 60, "CFrm": 50,
    "C": 45, "PotC": 65, "SS": 0, "PotSS": 0,
    "Acc": "A",
}


# ---------------------------------------------------------------------------
# build_draft_players — verified mapping on synthetic rows
# ---------------------------------------------------------------------------


def test_mapping_pitcher_row() -> None:
    dump = _dump_frame([_PITCHER_ROW, _CATCHER_ROW])
    scout, osa = build_draft_players([101], dump, None, 2058)

    assert osa is None
    assert len(scout) == 1
    assert list(scout.columns) == EXPORT_COLUMNS + ["source"]
    row = scout.iloc[0]

    assert row["ID"] == 101
    assert row["Name"] == "Cy Sample"
    assert row["POS"] == "SP"
    assert row["B"] == "L" and row["T"] == "L"
    # Trap: BA family comes from BABIP_L/R, NOT Cntct
    assert row["BA vR"] == 33 and row["BA vL"] == 31
    assert row["CON vR"] == 42 and row["CON vL"] == 38
    # Pitching: CON_1 is control (renamed to PCON later); HRA stays raw here
    assert row["CON_1"] == 45
    assert row["STU"] == 55 and row["STU vR"] == 60
    assert row["HRA"] == 52 and row["HRA vR"] == 51
    assert row["STU P"] == 65 and row["CON P_1"] == 55
    # Pitches: nonzero copied, zero becomes "-", PIT is the nonzero count
    assert row["FB"] == 60 and row["SL"] == 55 and row["CH"] == 45
    assert row["CB"] == "-" and row["KN"] == "-"
    assert row["PIT"] == 3
    assert row["FBP"] == 65 and row["SLP"] == 60
    # Height 188cm -> 74 in -> 6' 2'
    assert row["HT"] == "6' 2'"
    # Positions: zero -> "-"
    assert row["P"] == 50 and row["P Pot"] == 60
    assert row["SS"] == "-" and row["SS Pot"] == "-"
    assert row["SctAcc"] == "High"
    assert row["source"] == "Draft 2058"
    # Neutral fills
    assert row["YL"] == 0 and row["MLD"] == 0
    assert row["DEM"] == "-" and row["Sign"] == "-" and row["TM"] == "-"
    assert row["SLR"] == "Free agent" and row["ROOK"] == "No"


def test_mapping_catcher_row_cblk_trap() -> None:
    dump = _dump_frame([_PITCHER_ROW, _CATCHER_ROW])
    scout, _ = build_draft_players([202], dump, None, 2043)
    row = scout.iloc[0]
    # Trap: catcher blocking ("C ABI") comes from CBlk
    assert row["C ABI"] == 55
    assert row["C FRM"] == 50 and row["C ARM"] == 60
    assert row["C"] == 45 and row["C Pot"] == 65
    assert row["SctAcc"] == "Average"
    assert row["source"] == "Draft 2043"


def test_mapping_ids_missing_from_dump_are_skipped(capsys) -> None:
    dump = _dump_frame([_CATCHER_ROW])
    scout, _ = build_draft_players([202, 999, 1000], dump, None, 2043)
    assert scout["ID"].tolist() == [202]
    assert "2 of 3" in capsys.readouterr().out


def test_built_columns_survive_players_renames() -> None:
    """After players.py's duplicate-column renames the pitcher-side columns
    surface under their PCON*/HRR* names, exactly like a real draft CSV."""
    dump = _dump_frame([_PITCHER_ROW])
    scout, _ = build_draft_players([101], dump, None, 2058)
    renamed = scout.rename(columns=_COLUMN_RENAMES)
    for col in ("PCON vR", "PCON vL", "PCON P", "HRR", "HRR vR", "HRR vL", "HRR P"):
        assert col in renamed.columns, col
    assert renamed.iloc[0]["PCON P"] == 55
    assert renamed.iloc[0]["HRR"] == 52


def test_osa_frame_built_alongside_scout() -> None:
    dump = _dump_frame([_PITCHER_ROW, _CATCHER_ROW])
    osa_dump = _dump_frame([dict(_PITCHER_ROW, PotStf=45), _CATCHER_ROW])
    scout, osa = build_draft_players([101], dump, osa_dump, 2058)
    assert osa is not None and len(osa) == 1
    assert osa.iloc[0]["STU P"] == 45
    assert osa.iloc[0]["source"] == "Draft 2058"


# ---------------------------------------------------------------------------
# fetch_draftpool / fetch_draft_year — failure paths (no network)
# ---------------------------------------------------------------------------


def test_fetch_draftpool_parses_ids(monkeypatch) -> None:
    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'"ID","Player Name"\n"12","A Guy"\n"34","B Guy"\n'

    monkeypatch.setattr(draftpool.urllib.request, "urlopen", lambda *a, **k: _Resp())
    assert fetch_draftpool("https://statsplus.net/blm/") == [12, 34]


def test_fetch_draftpool_network_error_returns_empty(monkeypatch, capsys) -> None:
    import urllib.error

    def _boom(*a, **k):
        raise urllib.error.URLError("no route")

    monkeypatch.setattr(draftpool.urllib.request, "urlopen", _boom)
    assert fetch_draftpool("https://statsplus.net/blm/") == []
    assert "Warning" in capsys.readouterr().out


def test_fetch_draftpool_malformed_returns_empty(monkeypatch, capsys) -> None:
    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"not,a,draft\npool,at,all\n"

    monkeypatch.setattr(draftpool.urllib.request, "urlopen", lambda *a, **k: _Resp())
    assert fetch_draftpool("https://statsplus.net/blm/") == []
    assert "no ID column" in capsys.readouterr().out


def test_fetch_draftpool_empty_url() -> None:
    assert fetch_draftpool("") == []


def test_fetch_draft_year(monkeypatch) -> None:
    monkeypatch.setattr(draftpool, "fetch_game_date", lambda url: "2058-03-14")
    assert fetch_draft_year("https://statsplus.net/blm/") == 2058
    monkeypatch.setattr(draftpool, "fetch_game_date", lambda url: None)
    assert fetch_draft_year("https://statsplus.net/blm/") is None
    monkeypatch.setattr(draftpool, "fetch_game_date", lambda url: "whenever")
    assert fetch_draft_year("https://statsplus.net/blm/") is None


# ---------------------------------------------------------------------------
# find_ratings_dumps
# ---------------------------------------------------------------------------


def test_find_ratings_dumps_picks_newest(tmp_path: Path) -> None:
    for name in (
        "ratings_scout_2042-11-09.csv.gz",
        "ratings_scout_2043-09-28.csv.gz",
        "ratings_osa_2043-01-05.csv.gz",
        "ratings_osa_2043-09-28.csv.gz",
        "unrelated.csv",
    ):
        (tmp_path / name).write_bytes(b"")
    scout, osa = find_ratings_dumps(tmp_path)
    assert scout.name == "ratings_scout_2043-09-28.csv.gz"
    assert osa.name == "ratings_osa_2043-09-28.csv.gz"


def test_find_ratings_dumps_missing_dir(tmp_path: Path) -> None:
    assert find_ratings_dumps(tmp_path / "nope") == (None, None)
    assert find_ratings_dumps(tmp_path) == (None, None)


# ---------------------------------------------------------------------------
# load_players integration — CSV-wins, API path, failure path, hasDraft
# ---------------------------------------------------------------------------


def _write_dumps(ratings_dir: Path, osa: bool = True) -> None:
    ratings_dir.mkdir(parents=True, exist_ok=True)
    dump = _dump_frame([_PITCHER_ROW, _CATCHER_ROW])
    dump.to_csv(ratings_dir / "ratings_scout_2058-01-01.csv.gz", index=False)
    if osa:
        osa_dump = _dump_frame(
            [dict(_PITCHER_ROW, PotStf=45), dict(_CATCHER_ROW, PotCntct=40)]
        )
        osa_dump.to_csv(ratings_dir / "ratings_osa_2058-01-01.csv.gz", index=False)


def test_api_pool_loads_when_no_draft_csv(tmp_path: Path, monkeypatch) -> None:
    player_dir = tmp_path / "players"
    player_dir.mkdir()
    _write_org_csv(player_dir / "org.csv")
    ratings_dir = tmp_path / "ratings"
    _write_dumps(ratings_dir)

    monkeypatch.setattr(draftpool, "fetch_draftpool", lambda url: [101, 202])
    monkeypatch.setattr(draftpool, "fetch_draft_year", lambda url: 2058)

    df = load_players(
        player_dir, statsplus_url="https://statsplus.net/blm/", ratings_dir=ratings_dir
    )
    assert df.attrs["api_draft_loaded"] is True
    draftees = df[df["source"] == "Draft 2058"]
    assert sorted(draftees["ID"].tolist()) == [101, 202]
    # Pitcher detection works on API rows
    assert draftees.set_index("ID").loc[101, "is_pitcher"]
    assert not draftees.set_index("ID").loc[202, "is_pitcher"]


def test_api_pool_osa_blend_uses_rating_whitelist(tmp_path: Path, monkeypatch) -> None:
    player_dir = tmp_path / "players"
    player_dir.mkdir()
    _write_org_csv(player_dir / "org.csv")
    ratings_dir = tmp_path / "ratings"
    _write_dumps(ratings_dir)

    monkeypatch.setattr(draftpool, "fetch_draftpool", lambda url: [101])
    monkeypatch.setattr(draftpool, "fetch_draft_year", lambda url: 2058)

    df = load_players(
        player_dir,
        statsplus_url="https://statsplus.net/blm/",
        ratings_dir=ratings_dir,
        osa_blend=True,
        scout_weight=0.8,
        osa_weight=0.2,
    )
    row = df[df["source"] == "Draft 2058"].iloc[0]
    # STU P: scout 65, OSA 45 -> 0.8*65 + 0.2*45 = 61
    assert row["STU P"] == pytest.approx(61.0)
    # Non-rating columns come straight from scout (no _osa contamination)
    assert row["Name"] == "Cy Sample"


def test_hand_exported_draft_csv_wins_over_api(tmp_path: Path, monkeypatch) -> None:
    player_dir = tmp_path / "players"
    player_dir.mkdir()
    _write_org_csv(player_dir / "org.csv")
    (player_dir / "draft2099.csv").write_text(
        _ORG_HEADER + "\n" + "7,Draftee,CF,-,30,60,40,40,40,20,20,20\n"
    )
    ratings_dir = tmp_path / "ratings"
    _write_dumps(ratings_dir)

    def _fail(*a, **k):
        raise AssertionError("API draft path must not run when a draft CSV exists")

    monkeypatch.setattr(draftpool, "load_api_draft_pool", _fail)
    monkeypatch.setattr(draftpool, "fetch_draftpool", _fail)

    df = load_players(
        player_dir, statsplus_url="https://statsplus.net/blm/", ratings_dir=ratings_dir
    )
    assert df.attrs["api_draft_loaded"] is False
    assert set(df["source"]) == {"Organization", "Draft 2099"}


def test_failed_fetch_does_not_flip_flag(tmp_path: Path, monkeypatch) -> None:
    player_dir = tmp_path / "players"
    player_dir.mkdir()
    _write_org_csv(player_dir / "org.csv")
    ratings_dir = tmp_path / "ratings"
    _write_dumps(ratings_dir)

    monkeypatch.setattr(draftpool, "fetch_draftpool", lambda url: [])  # 404/timeout path

    df = load_players(
        player_dir, statsplus_url="https://statsplus.net/blm/", ratings_dir=ratings_dir
    )
    assert df.attrs["api_draft_loaded"] is False
    assert set(df["source"]) == {"Organization"}


def test_no_scout_dump_skips_fetch_entirely(tmp_path: Path, monkeypatch) -> None:
    player_dir = tmp_path / "players"
    player_dir.mkdir()
    _write_org_csv(player_dir / "org.csv")
    ratings_dir = tmp_path / "ratings"
    ratings_dir.mkdir()

    def _fail(*a, **k):
        raise AssertionError("must not hit the network when no scout dump exists")

    monkeypatch.setattr(draftpool, "fetch_draftpool", _fail)

    df = load_players(
        player_dir, statsplus_url="https://statsplus.net/blm/", ratings_dir=ratings_dir
    )
    assert df.attrs["api_draft_loaded"] is False


def test_no_statsplus_url_skips_api(tmp_path: Path, monkeypatch) -> None:
    player_dir = tmp_path / "players"
    player_dir.mkdir()
    _write_org_csv(player_dir / "org.csv")
    ratings_dir = tmp_path / "ratings"
    _write_dumps(ratings_dir)

    def _fail(*a, **k):
        raise AssertionError("must not fetch without a statsplus_url")

    monkeypatch.setattr(draftpool, "fetch_draftpool", _fail)

    df = load_players(player_dir, statsplus_url="", ratings_dir=ratings_dir)
    assert df.attrs["api_draft_loaded"] is False


# ---------------------------------------------------------------------------
# hasDraft flag logic
# ---------------------------------------------------------------------------


def test_has_draft_csv_only(tmp_path: Path) -> None:
    (tmp_path / "org.csv").write_text(_ORG_HEADER + "\n")
    (tmp_path / "draft2043.csv").write_text(_ORG_HEADER + "\n")
    assert _detect_csv_presence(tmp_path)["hasDraft"] is True
    assert _detect_csv_presence(tmp_path, api_draft_loaded=False)["hasDraft"] is True


def test_has_draft_api_only(tmp_path: Path) -> None:
    (tmp_path / "org.csv").write_text(_ORG_HEADER + "\n")
    assert _detect_csv_presence(tmp_path)["hasDraft"] is False
    assert _detect_csv_presence(tmp_path, api_draft_loaded=True)["hasDraft"] is True


def test_has_draft_neither(tmp_path: Path) -> None:
    (tmp_path / "org.csv").write_text(_ORG_HEADER + "\n")
    assert _detect_csv_presence(tmp_path, api_draft_loaded=False)["hasDraft"] is False


# ---------------------------------------------------------------------------
# load_api_draft_pool orchestration
# ---------------------------------------------------------------------------


def test_load_api_draft_pool_happy_path(tmp_path: Path, monkeypatch) -> None:
    _write_dumps(tmp_path)
    monkeypatch.setattr(draftpool, "fetch_draftpool", lambda url: [101, 202])
    monkeypatch.setattr(draftpool, "fetch_draft_year", lambda url: 2058)
    result = load_api_draft_pool("https://statsplus.net/blm/", tmp_path)
    assert result is not None
    scout, osa, year = result
    assert year == 2058
    assert len(scout) == 2 and osa is not None and len(osa) == 2


def test_load_api_draft_pool_no_year(tmp_path: Path, monkeypatch) -> None:
    _write_dumps(tmp_path)
    monkeypatch.setattr(draftpool, "fetch_draftpool", lambda url: [101])
    monkeypatch.setattr(draftpool, "fetch_draft_year", lambda url: None)
    assert load_api_draft_pool("https://statsplus.net/blm/", tmp_path) is None


def test_load_api_draft_pool_no_matching_ids(tmp_path: Path, monkeypatch) -> None:
    _write_dumps(tmp_path)
    monkeypatch.setattr(draftpool, "fetch_draftpool", lambda url: [999999])
    monkeypatch.setattr(draftpool, "fetch_draft_year", lambda url: 2058)
    assert load_api_draft_pool("https://statsplus.net/blm/", tmp_path) is None
