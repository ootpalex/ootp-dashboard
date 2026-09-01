"""Tests for src/contract_projection.py — year-by-year contract status math."""

from src.contract_projection import (
    DAYS_PER_SEASON,
    _parse_mld,
    _project_eos_mld,
    detect_contract_year,
    detect_limbo,
    detect_season_day,
    project_super_two,
    project_year_status,
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


# ---------------------------------------------------------------------------
# detect_season_day / detect_limbo — the season clock comes from MLD, not
# the calendar. OOTP's 172 league days span ~180 calendar days.
# ---------------------------------------------------------------------------


def _p(mld, mly=None, **meta):
    m = {"mld": mld}
    if mly is not None:
        m["mly"] = mly
    m.update(meta)
    return {"id": id(m), "meta": m}


def test_detect_season_day_uses_modal_mld_remainder():
    pool = [_p(DAYS_PER_SEASON * 3 + 40) for _ in range(10)]
    pool += [_p(DAYS_PER_SEASON * 2 + 7) for _ in range(3)]
    assert detect_season_day(pool) == 40


def test_detect_season_day_zero_when_seasons_are_whole():
    pool = [_p(DAYS_PER_SEASON * n) for n in (1, 2, 2, 3, 3, 3)]
    assert detect_season_day(pool) == 0


def test_detect_season_day_ignores_zero_and_missing_mld():
    assert detect_season_day([_p(0), _p(None), {"meta": {}}]) == 0


def test_detect_limbo_true_when_completed_season_not_yet_in_mly():
    # 3 whole seasons of service but MLY still reads 2 — the season just ended
    # and MLY has not rolled (it only rolls Jan 1).
    pool = [_p(DAYS_PER_SEASON * 3, mly=2)]
    assert detect_limbo(pool, 0) is True


def test_detect_limbo_false_before_opening_day():
    pool = [_p(DAYS_PER_SEASON * 3, mly=3)]
    assert detect_limbo(pool, 0) is False


def test_detect_limbo_false_mid_season():
    pool = [_p(DAYS_PER_SEASON * 3 + 40, mly=3)]
    assert detect_limbo(pool, 40) is False


def test_detect_limbo_false_without_mly_data():
    assert detect_limbo([_p(DAYS_PER_SEASON * 3)], 0) is False


def test_project_eos_mld_limbo_does_not_re_add_completed_season():
    p = {"meta": {"mld": DAYS_PER_SEASON * 2, "act": True, "lev": "MLB"}}
    # Pre-Opening-Day: the whole upcoming season is still ahead.
    assert _project_eos_mld(p, 0, False) == DAYS_PER_SEASON * 3
    # Limbo: that season is already inside MLD — adding it again double-counts.
    assert _project_eos_mld(p, 0, True) == DAYS_PER_SEASON * 2


# ---------------------------------------------------------------------------
# detect_contract_year — the offseason roll signal
# ---------------------------------------------------------------------------


def test_detect_contract_year_in_season_matches_game_year():
    contracts = [{"seasonYear": 2041, "currentYear": 2, "years": 4}] * 5
    assert detect_contract_year(contracts, 2043) == 2043


def test_detect_contract_year_rolls_after_arbitration_and_free_agency():
    # Settled one-year 2044 deals plus a long deal whose index has advanced.
    contracts = [{"seasonYear": 2044, "currentYear": 0, "years": 1}] * 8
    contracts += [{"seasonYear": 2039, "currentYear": 5, "years": 7}] * 2
    assert detect_contract_year(contracts, 2043) == 2044


def test_detect_contract_year_ignores_placeholder_contracts():
    contracts = [{"seasonYear": 0, "currentYear": 0, "years": 1}] * 20
    contracts += [{"seasonYear": 2044, "currentYear": 0, "years": 1}] * 3
    assert detect_contract_year(contracts, 2043) == 2044


def test_detect_contract_year_rejects_implausible_mode():
    contracts = [{"seasonYear": 2050, "currentYear": 0, "years": 1}] * 9
    assert detect_contract_year(contracts, 2043) == 2043


def test_detect_contract_year_empty_falls_back_to_game_year():
    assert detect_contract_year([], 2043) == 2043
    assert detect_contract_year({}, 2043) == 2043


def test_detect_contract_year_accepts_a_dict_of_contracts():
    contracts = {"1": {"seasonYear": 2044, "currentYear": 0, "years": 1}}
    assert detect_contract_year(contracts, 2043) == 2044


# ---------------------------------------------------------------------------
# project_year_status — once the frame has rolled, the settled contract beats
# the salary report's stale projection.
# ---------------------------------------------------------------------------


_ARB_PLAYER = {
    "id": 1,
    "meta": {"yl": "1 (arbitr.)", "mld": DAYS_PER_SEASON * 5 + 123, "on40": True, "lev": "MLB"},
}
# StatsPlus salary report, still anchored to the completed 2043 season: it
# reports 2044 as an unsigned arbitration *projection*.
_STALE_REPORT = {
    "years": {
        "2043": {"salary": 4_400_000, "type": "signed", "guaranteed": True},
        "2044": {"salary": 8_900_000, "type": "arb", "guaranteed": False},
    }
}
# The contract feed carries the deal actually signed for 2044.
_SETTLED_CONTRACT = {"seasonYear": 2044, "currentYear": 0, "years": 1, "salaries": [8_000_000]}


def _status(offset, contract_year):
    cs = parse_contract_status(_ARB_PLAYER, 2043)
    return project_year_status(
        _ARB_PLAYER, offset, 2043, cs, None,
        _SETTLED_CONTRACT, _STALE_REPORT, contract_year,
    )


def test_year_status_in_season_keeps_salary_report_precedence():
    # contract_year == game_year: nothing has rolled, behaviour is unchanged.
    st = _status(1, 2043)
    assert st["status"] == "arb"
    assert st["salary"] == 8_900_000
    assert st["guaranteed"] is False


def test_year_status_after_roll_uses_the_settled_contract():
    st = _status(1, 2044)
    assert st["status"] == "signed"
    assert st["salary"] == 8_000_000
    assert st["guaranteed"] is True


def test_year_status_after_roll_leaves_the_completed_season_alone():
    # 2043 is below contract_year, so the report still supplies it.
    st = _status(0, 2044)
    assert st["salary"] == 4_400_000


def test_year_status_after_roll_falls_back_past_the_contract_span():
    # 2045 is beyond the one-year deal, so the report's projection is still used.
    st = _status(2, 2044)
    assert st["status"] == "fa"


def test_year_status_after_roll_preserves_option_years_from_the_contract():
    contract = {
        "seasonYear": 2039, "currentYear": 5, "years": 7,
        "salaries": [8, 14, 18, 26, 26, 24, 24],
        "lastYearTeamOption": True, "lastYearOptionBuyout": 6,
    }
    player = {"id": 2, "meta": {"yl": "2", "mld": DAYS_PER_SEASON * 8, "on40": True, "lev": "MLB"}}
    cs = parse_contract_status(player, 2043)
    st = project_year_status(player, 2, 2043, cs, None, contract, None, 2044)
    assert st["status"] == "option"
    assert st["optionType"] == "club"


def test_year_status_after_roll_never_overrides_minor_league_level():
    # A 40-man player optioned to the minors still has a contract salary, but
    # "MiLB" is a roster level the contract feed cannot express — the report wins.
    report = {"years": {"2044": {"salary": 570_500, "type": "milb", "guaranteed": True}}}
    contract = {"seasonYear": 2044, "currentYear": 0, "years": 1, "salaries": [570_500]}
    player = {"id": 3, "meta": {"yl": "1 (auto.)", "mld": 30, "on40": True, "lev": "AAA"}}
    cs = parse_contract_status(player, 2043)
    st = project_year_status(player, 1, 2043, cs, None, contract, report, 2044)
    assert st["status"] == "minors"
    assert st["statusLabel"] == "MiLB"
