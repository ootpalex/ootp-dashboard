"""Tests for src/contract_projection.py — year-by-year contract status math."""

from src.contract_projection import (
    DAYS_PER_SEASON,
    _parse_mld,
    _project_eos_mld,
    project_super_two,
    parse_contract_status,
    resolve_contract_year,
    get_options_info,
)


# ---------------------------------------------------------------------------
# _parse_mld
# ---------------------------------------------------------------------------


def test_parse_mld_zero():
    assert _parse_mld(0) == (0, 0)


def test_parse_mld_just_under_one_year():
    assert _parse_mld(DAYS_PER_SEASON - 1) == (0, DAYS_PER_SEASON - 1)


def test_parse_mld_exactly_one_year():
    assert _parse_mld(DAYS_PER_SEASON) == (1, 0)


def test_parse_mld_two_years_minus_one():
    assert _parse_mld(2 * DAYS_PER_SEASON - 1) == (1, DAYS_PER_SEASON - 1)


def test_parse_mld_handles_none_and_garbage():
    assert _parse_mld(None) == (0, 0)
    assert _parse_mld("not a number") == (0, 0)


# ---------------------------------------------------------------------------
# _project_eos_mld — accruing vs inactive
# ---------------------------------------------------------------------------


def test_project_eos_mld_active_player_accrues_remaining_season():
    player = {"meta": {"mld": 100, "act": True, "ic": "-", "lev": "MLB"}}
    assert _project_eos_mld(player, season_day=72) == 100 + (DAYS_PER_SEASON - 72)


def test_project_eos_mld_inactive_minors_player_does_not_accrue():
    player = {"meta": {"mld": 100, "act": False, "ic": "-", "lev": "AAA"}}
    assert _project_eos_mld(player, season_day=72) == 100


def test_project_eos_mld_injured_mlb_player_accrues():
    # IC != "-" + lev == "MLB" counts as accruing even when act is False (60-day IL).
    player = {"meta": {"mld": 100, "act": False, "ic": "60-Day", "lev": "MLB"}}
    assert _project_eos_mld(player, season_day=50) == 100 + (DAYS_PER_SEASON - 50)


# ---------------------------------------------------------------------------
# project_super_two — top ~22% of year-2 class
# ---------------------------------------------------------------------------


def test_project_super_two_takes_top_22_percent_of_year_two_class():
    # 100 strictly-distinct year-2 players (mld 344..443). All on the active
    # MLB roster so the new ≥86-day rule keeps them in the pool.
    players = [
        {"id": i, "meta": {
            "mld": 2 * DAYS_PER_SEASON + i, "act": True, "ic": "-",
            "lev": "MLB", "org": "ATL",
        }}
        for i in range(100)
    ]
    super_two_ids, cutoff = project_super_two(players, season_day=0)
    # ceil(100 * 0.22) - 1 = 21 → cutoff is the player at sorted-desc index 21.
    # With ascending mlds 0..99 and accruing players gaining a full season's
    # worth of remaining days at season_day=0, ranks invert vs the underlying
    # mld but the relative ordering still places id 78 at the cutoff index.
    expected_cutoff = 2 * DAYS_PER_SEASON + 78 + DAYS_PER_SEASON
    assert cutoff == expected_cutoff
    assert len(super_two_ids) == 22
    # Top 22 (player ids 78..99) all in.
    assert super_two_ids == set(range(78, 100))


def test_project_super_two_filters_non_accruing_when_no_statsplus_data():
    # Same year-2 pool as above but flagged inactive in the minors. With no
    # mlb_service_days_this_year present, the fallback `accruing ? 172 : 0`
    # rejects everyone — preserves the rule that minors don't qualify.
    players = [
        {"id": i, "meta": {"mld": 2 * DAYS_PER_SEASON + i, "act": False, "ic": "-", "lev": "AAA"}}
        for i in range(100)
    ]
    super_two_ids, cutoff = project_super_two(players, season_day=0)
    assert super_two_ids == set()
    assert cutoff == 3 * DAYS_PER_SEASON


def test_project_super_two_excludes_stale_active_free_agent():
    # Player flagged Active but org="-" must be filtered out by the new
    # FA guard inside _is_accruing.
    players = [
        {"id": 1, "meta": {
            "mld": 2 * DAYS_PER_SEASON + 50, "act": True, "ic": "-",
            "lev": "MLB", "org": "-",
        }},
        {"id": 2, "meta": {
            "mld": 2 * DAYS_PER_SEASON + 40, "act": True, "ic": "-",
            "lev": "MLB", "org": "ATL",
        }},
    ]
    super_two_ids, _ = project_super_two(players, season_day=0)
    assert 1 not in super_two_ids
    assert 2 in super_two_ids


def test_project_super_two_excludes_under_86_days_in_season():
    # In-season cutoff with mlb_service_days_this_year supplied. Player A had
    # 0 days through day 100; even projecting forward, they finish at 72 < 86.
    # Player B had 30 days; projects to 30 + 72 = 102 >= 86.
    players = [
        {"id": 1, "meta": {
            "mld": 2 * DAYS_PER_SEASON, "act": True, "ic": "-",
            "lev": "MLB", "org": "ATL", "mlb_service_days_this_year": 0,
        }},
        {"id": 2, "meta": {
            "mld": 2 * DAYS_PER_SEASON + 50, "act": True, "ic": "-",
            "lev": "MLB", "org": "ATL", "mlb_service_days_this_year": 30,
        }},
    ]
    super_two_ids, _ = project_super_two(players, season_day=100)
    assert 1 not in super_two_ids
    assert 2 in super_two_ids


def test_project_super_two_empty_pool():
    super_two_ids, cutoff = project_super_two([], season_day=0)
    assert super_two_ids == set()
    assert cutoff == 3 * DAYS_PER_SEASON


# ---------------------------------------------------------------------------
# parse_contract_status — branching on yl qualifier and roster status
# ---------------------------------------------------------------------------


def test_parse_contract_status_arb_qualifier_yields_arb_type():
    player = {
        "meta": {"yl": "2 (arbitr.)", "mld": 3 * DAYS_PER_SEASON, "on40": True, "lev": "MLB"},
        "id": 1,
    }
    s = parse_contract_status(player, game_year=2026)
    assert s["type"] == "arb"
    assert s["yearsLeft"] == 2
    assert s["mlbYears"] == 3
    # 6 - mlbYears = 3 control years left
    assert s["controlYears"] == 3
    assert s["faYear"] == 2029


def test_parse_contract_status_pre_arb_off40_demoted_to_minors():
    # Pre-arb player not on the 40-man roster and not at MLB level
    # collapses to "minors" status.
    player = {
        "meta": {"yl": "1 (auto.)", "mld": 0, "on40": False, "lev": "AAA"},
        "id": 2,
    }
    s = parse_contract_status(player, game_year=2026)
    assert s["type"] == "minors"


def test_parse_contract_status_signed_with_club_option():
    player = {
        "meta": {"yl": "3 (Club Option)", "mld": 4 * DAYS_PER_SEASON, "on40": True, "lev": "MLB"},
        "id": 3,
    }
    s = parse_contract_status(player, game_year=2026)
    assert s["type"] == "signed"
    assert s["optionType"] == "club"
    assert s["yearsLeft"] == 3
    assert s["controlEnd"] == 2029


# ---------------------------------------------------------------------------
# resolve_contract_year — base contract + extension overlay
# ---------------------------------------------------------------------------


def test_resolve_contract_year_falls_through_to_extension():
    contract = {
        "seasonYear": 2026,
        "currentYear": 0,
        "years": 2,
        "salaries": [10_000_000, 12_000_000],
        "extension": {
            "years": 3,
            "salaries": [15_000_000, 16_000_000, 17_000_000],
        },
    }
    # Base year 0
    assert resolve_contract_year(contract, 2026)["salary"] == 10_000_000
    # Base year 1 (last base year)
    assert resolve_contract_year(contract, 2027)["salary"] == 12_000_000
    # Extension year 0 (base done)
    assert resolve_contract_year(contract, 2028)["salary"] == 15_000_000
    # Extension year 2 (last extension year)
    assert resolve_contract_year(contract, 2030)["salary"] == 17_000_000
    # Past the extension end
    assert resolve_contract_year(contract, 2031) is None


def test_resolve_contract_year_last_year_team_option_marker():
    contract = {
        "seasonYear": 2026,
        "currentYear": 0,
        "years": 3,
        "salaries": [10_000_000, 12_000_000, 15_000_000],
        "lastYearTeamOption": True,
        "lastYearOptionBuyout": 2_000_000,
    }
    r = resolve_contract_year(contract, 2028)
    assert r["salary"] == 15_000_000
    assert r["optionType"] == "club"
    assert r["buyout"] == 2_000_000


# ---------------------------------------------------------------------------
# get_options_info — outOfOptions semantics
# ---------------------------------------------------------------------------


def test_get_options_info_out_of_options_when_on40_and_zero_remaining():
    p = {"meta": {"opt": 3, "on40": True}}
    info = get_options_info(p)
    assert info == {"used": 3, "remaining": 0, "outOfOptions": True}


def test_get_options_info_remaining_options_not_outOfOptions():
    p = {"meta": {"opt": 1, "on40": True}}
    info = get_options_info(p)
    assert info == {"used": 1, "remaining": 2, "outOfOptions": False}


def test_get_options_info_off40_never_outOfOptions():
    # outOfOptions is only meaningful for 40-man roster players.
    p = {"meta": {"opt": 3, "on40": False}}
    info = get_options_info(p)
    assert info["outOfOptions"] is False
