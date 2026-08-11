"""Tests for the CLI draft-board report (model/tools/draft_board_report.py).

The tool's job is to reproduce the Draft Board page's default view from a
terminal: pull the live draft order, drop everyone already taken, and rank the
rest by potential WAR. These tests cover that logic on synthetic dashboards —
no test here touches the network.

The valuation rules being pinned are the frontend's, mirrored from
``app/src/components/boardUtils.js`` and ``app/src/utils/accessors.js``:
hitters value on ``prospect.war.max``, pitchers on the better of SP/RP
potential WAR with SP gated behind SP-eligibility.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

_TOOLS = Path(__file__).resolve().parents[1] / "tools"


def _load_module():
    """Import the tool by path — model/tools/ isn't a package."""
    spec = importlib.util.spec_from_file_location(
        "draft_board_report", _TOOLS / "draft_board_report.py"
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


dbr = _load_module()


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _hitter(pid, name, war_p, war=0.0, source="Draft 2058", positions=None, of_arm=None):
    return {
        "id": pid,
        "meta": {"name": name, "pos": "SS", "age": 18, "source": source, "prone": "Normal"},
        "maxWar": {"wtd": war},
        "prospect": {"war": {"max": war_p}},
        "positions": positions or {},
        "fieldingRatings": {"ofArm": of_arm},
    }


def _pitcher(pid, name, sp_war_p=None, rp_war_p=None, starter=True, source="Draft 2058"):
    return {
        "id": pid,
        "meta": {"name": name, "pos": "SP", "age": 19, "source": source, "prone": "Normal"},
        "starter": starter,
        "starterP": False,
        "sp": {"wtd": {"war": 0.0}},
        "rp": {"wtd": {"war": 0.0}},
        "prospect": {"sp": {"war": sp_war_p}, "rp": {"war": rp_war_p}},
    }


def _pos(runs_p, eligible=True):
    return {"eligible": eligible, "stats": {"runsP": runs_p}}


# ---------------------------------------------------------------------------
# Draft-order parsing
# ---------------------------------------------------------------------------


def test_is_filled_distinguishes_made_picks_from_open_slots():
    # ?all=1 returns every owned slot; not-yet-made ones carry a blank or "0" ID.
    assert dbr.is_filled({"ID": "61412"})
    assert not dbr.is_filled({"ID": ""})
    assert not dbr.is_filled({"ID": "0"})
    assert not dbr.is_filled({"ID": "  "})
    assert not dbr.is_filled({})


# ---------------------------------------------------------------------------
# Valuation — must match buildBoardPool / pickPitcherRole
# ---------------------------------------------------------------------------


def test_hitter_values_read_max_war_and_prospect_max():
    cur, pot = dbr.hitter_values(_hitter(1, "A", 4.5, war=1.25))
    assert (cur, pot) == (1.25, 4.5)


def test_pitcher_takes_the_better_role_potential():
    # RP potential strictly higher -> RP is the valued role.
    assert dbr.pitcher_values(_pitcher(1, "A", sp_war_p=2.0, rp_war_p=3.0))[1:] == (3.0, "RP")
    # SP higher -> SP.
    assert dbr.pitcher_values(_pitcher(2, "B", sp_war_p=4.0, rp_war_p=1.0))[1:] == (4.0, "SP")
    # Ties go to SP (the frontend's `>` is strict).
    assert dbr.pitcher_values(_pitcher(3, "C", sp_war_p=2.0, rp_war_p=2.0))[1:] == (2.0, "SP")


def test_sp_values_are_ignored_when_the_player_is_not_sp_eligible():
    # A non-starter's SP numbers must not be read, even when present — the
    # frontend gates getSpWarP behind starter / starterP.
    p = _pitcher(1, "A", sp_war_p=9.0, rp_war_p=1.5, starter=False)
    cur, pot, role = dbr.pitcher_values(p)
    assert (pot, role) == (1.5, "RP")


# ---------------------------------------------------------------------------
# bestPos — Option B argmax + LF/RF arm split
# ---------------------------------------------------------------------------


def test_best_pos_argmax_includes_the_defensive_spectrum():
    # Equal RunsP: the spectrum bonus makes SS (+12.7) beat 1B (−10.1).
    h = _hitter(1, "A", 3.0, positions={"ss": _pos(0.0), "1b": _pos(0.0)})
    assert dbr.hitter_best_pos(h, "BLM-ATL") == "SS"
    # A big enough 1B glove edge still can't cover a 22.8-run spectrum gap.
    h = _hitter(2, "B", 3.0, positions={"ss": _pos(0.0), "1b": _pos(20.0)})
    assert dbr.hitter_best_pos(h, "BLM-ATL") == "SS"
    h = _hitter(3, "C", 3.0, positions={"ss": _pos(0.0), "1b": _pos(25.0)})
    assert dbr.hitter_best_pos(h, "BLM-ATL") == "1B"


def test_best_pos_corner_outfield_resolves_by_arm():
    corner = {"lf": _pos(5.0), "rf": _pos(5.0)}
    assert dbr.hitter_best_pos(_hitter(1, "A", 3.0, positions=corner, of_arm=70), "BLM-ATL") == "RF"
    assert dbr.hitter_best_pos(_hitter(2, "B", 3.0, positions=corner, of_arm=40), "BLM-ATL") == "LF"
    # Right at the per-league threshold counts as RF.
    assert dbr.hitter_best_pos(_hitter(3, "C", 3.0, positions=corner, of_arm=55.2), "BLM-ATL") == "RF"


def test_best_pos_falls_back_to_dh_then_listed_position():
    assert dbr.hitter_best_pos(_hitter(1, "A", 3.0, positions={"dh": {"eligible": True}}), "SSB") == "DH"
    assert dbr.hitter_best_pos(_hitter(2, "B", 3.0, positions={}), "SSB") == "SS"


def test_pitcher_best_pos_flags_relief_profiles():
    assert dbr.pitcher_best_pos(_pitcher(1, "A", sp_war_p=2.0, rp_war_p=2.5)) == "SP"
    # RP more than a full win better than a playable SP -> RP*.
    assert dbr.pitcher_best_pos(_pitcher(2, "B", sp_war_p=2.0, rp_war_p=3.5)) == "RP*"
    # Below the SP replacement line, the better role simply wins.
    assert dbr.pitcher_best_pos(_pitcher(3, "C", sp_war_p=-1.0, rp_war_p=0.5)) == "RP*"
    assert dbr.pitcher_best_pos(_pitcher(4, "D", sp_war_p=-1.0, rp_war_p=-2.0)) == "SP"
    assert dbr.pitcher_best_pos(_pitcher(5, "E", sp_war_p=5.0, rp_war_p=1.0, starter=False)) == "RP"


# ---------------------------------------------------------------------------
# Board assembly — class filter, drafted removal, sort
# ---------------------------------------------------------------------------


@pytest.fixture
def dash():
    return {
        "hitters": [
            _hitter(1, "Top Bat", 6.0),
            _hitter(2, "Mid Bat", 3.0),
            _hitter(3, "Old Class", 9.9, source="Draft 2057"),
            _hitter(4, "No Potential", None),
        ],
        "pitchers": [
            _pitcher(5, "Ace", sp_war_p=5.0, rp_war_p=1.0),
            _pitcher(6, "Reliever", sp_war_p=None, rp_war_p=4.0, starter=False),
        ],
    }


def test_draft_classes_are_detected_and_ordered(dash):
    assert dbr.draft_classes(dash) == ["Draft 2057", "Draft 2058"]


def test_board_ranks_by_potential_war_and_honors_the_class_filter(dash):
    rows = dbr.build_board(dash, "BLM-ATL", "Draft 2058", set())
    assert [r["name"] for r in rows] == ["Top Bat", "Ace", "Reliever", "Mid Bat", "No Potential"]
    # A missing potential sorts as 0, exactly as buildBoardPool's `?? 0` does.
    assert rows[-1]["warP"] is None
    # The other class is excluded despite carrying the highest value in the file.
    assert "Old Class" not in {r["name"] for r in rows}


def test_drafted_players_are_removed(dash):
    rows = dbr.build_board(dash, "BLM-ATL", "Draft 2058", {"1", "5"})
    assert [r["name"] for r in rows] == ["Reliever", "Mid Bat", "No Potential"]


def test_no_class_filter_pools_every_draft_class(dash):
    rows = dbr.build_board(dash, "BLM-ATL", None, set())
    assert rows[0]["name"] == "Old Class"
    assert len(rows) == 6


# ---------------------------------------------------------------------------
# Future Value column (display only — never reorders the board)
# ---------------------------------------------------------------------------


def test_future_value_matches_the_v21_power_law():
    # t = (18−14)/(27−14) = 4/13; credit = 0.80 × (1 − t³)
    t = 4 / 13
    expected = 1.0 + (5.0 - 1.0) * (0.80 * (1 - t ** 3))
    assert dbr.future_value(1.0, 5.0, 18) == pytest.approx(expected)


def test_future_value_edge_cases():
    assert dbr.future_value(None, 5.0, 18) is None          # no current value
    assert dbr.future_value(2.0, 5.0, 27) == 2.0            # matured -> cur
    assert dbr.future_value(4.0, 2.0, 18) == 4.0            # cur > pot -> cur
    assert dbr.future_value(2.0, None, 18) == 2.0           # no potential -> cur
