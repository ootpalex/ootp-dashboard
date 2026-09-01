"""src/contract_projection.py — Year-by-year contract status projection.

Pure Python port of app/src/utils/rosterPlanning.js.
"""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any, Iterable

DAYS_PER_SEASON = 172
YL_PATTERN = re.compile(r"^(\d+)\s*(?:\(([^)]+)\))?$")


def _meta(player: dict) -> dict:
    return player.get("meta") or player


def _parse_mld(mld: int | float | None) -> tuple[int, int]:
    if mld is None:
        return 0, 0
    try:
        m = int(mld)
    except (TypeError, ValueError):
        return 0, 0
    years = m // DAYS_PER_SEASON
    days = m - years * DAYS_PER_SEASON
    return years, days


def _fmt_salary(v: float | int | None) -> str | None:
    if not v or v <= 0:
        return None
    if v >= 1_000_000:
        whole = v % 1_000_000 == 0
        return f"${v/1_000_000:.0f}M" if whole else f"${v/1_000_000:.1f}M"
    if v >= 1_000:
        return f"${round(v/1000)}K"
    return f"${v}"


def _is_accruing(meta: dict) -> bool:
    org = meta.get("org")
    # Treat missing org as accruing-eligible (legacy callers don't populate it).
    # Only reject the explicit free-agent markers.
    if org in ("-", "0"):
        return False
    if meta.get("act") is True and meta.get("lev") == "MLB":
        return True
    ic = meta.get("ic")
    if ic and ic not in ("-", "") and meta.get("lev") == "MLB":
        return True
    return False


def detect_season_day(all_players: Iterable[dict]) -> int:
    """League days into the current season, from the modal ``MLD % 172``.

    Mirrors ``detectSeasonDay`` in app/src/utils/rosterPlanning/service.js. The
    calendar date cannot give this: OOTP's 172 league days span ~180 calendar
    days, so day-of-year arithmetic drifts during the season and is meaningless
    outside it. Returns 0 at season start AND after the season ends.
    """
    counts: dict[int, int] = {}
    for p in all_players:
        mld = _meta(p).get("mld")
        if mld is None:
            continue
        try:
            m = int(mld)
        except (TypeError, ValueError):
            continue
        if m <= 0:
            continue
        rem = m % DAYS_PER_SEASON
        counts[rem] = counts.get(rem, 0) + 1
    if not counts:
        return 0
    return max(counts.items(), key=lambda kv: kv[1])[0]


def detect_limbo(all_players: Iterable[dict], season_day: int) -> bool:
    """True in post-season limbo: the season is complete but the calendar year
    has not rolled, so MLD already includes it while MLY has not caught up.

    Mirrors ``detectLimbo`` in service.js. MLY (and options used) only roll on
    Jan 1, so during limbo the service-time frame is still the old season's even
    though the season itself is over.
    """
    if season_day != 0:
        return False
    for p in all_players:
        meta = _meta(p)
        mly = meta.get("mly")
        if mly is None:
            continue
        try:
            mld = int(meta.get("mld") or 0)
            mly_i = int(mly)
        except (TypeError, ValueError):
            continue
        if mld > 0 and mld // DAYS_PER_SEASON != mly_i:
            return True
    return False


def detect_contract_year(contracts: Iterable[dict] | dict, game_year: int) -> int:
    """The calendar year the league's contracts are currently in force for.

    ``season_year + current_year`` is the year a contract's ``current_year``
    index points at. OOTP advances that index during the offseason, so once
    arbitration is settled and free agency opens it reads ``game_year + 1``
    league-wide while the calendar date still says ``game_year``. That makes it
    the signal for "the roster has rolled to next season".

    Only ``game_year`` and ``game_year + 1`` are accepted; anything else means
    the contract feed is missing or malformed, and we fall back to ``game_year``.
    """
    rows = contracts.values() if isinstance(contracts, dict) else contracts
    counts: dict[int, int] = {}
    for c in rows or ():
        if not c:
            continue
        try:
            sy = int(c.get("seasonYear") or 0)
            cy = int(c.get("currentYear") or 0)
        except (TypeError, ValueError):
            continue
        if sy < 1900:
            continue
        counts[sy + cy] = counts.get(sy + cy, 0) + 1
    if not counts:
        return game_year
    best = max(counts.items(), key=lambda kv: kv[1])[0]
    return best if best in (game_year, game_year + 1) else game_year


def _project_eos_mld(player: dict, season_day: int, limbo: bool = False) -> int:
    meta = _meta(player)
    mld = meta.get("mld") or 0
    # In limbo the completed season is already inside MLD — adding a "rest of
    # season" on top would double-count it.
    remaining = 0 if limbo else DAYS_PER_SEASON - season_day
    return (mld or 0) + remaining if _is_accruing(meta) else (mld or 0)


def _accrual_prior_year(player: dict, season_day: int, limbo: bool = False) -> int | None:
    """Days the player will accrue in the (current) year ending the cutoff.
    None when we lack StatsPlus data and cannot compute it."""
    meta = _meta(player)
    accruing = _is_accruing(meta)
    sp_days = meta.get("mlb_service_days_this_year")
    if season_day > 0:
        if sp_days is None:
            return None
        return sp_days + (DAYS_PER_SEASON - season_day if accruing else 0)
    if limbo:
        # Season complete: this year's accrual is finished and already recorded.
        return sp_days if sp_days is not None else 0
    # Pre-Opening-Day: the whole upcoming season is still ahead.
    return DAYS_PER_SEASON if accruing else 0


def project_super_two(
    all_players: Iterable[dict], season_day: int, limbo: bool = False
) -> tuple[set, int]:
    """Returns (super_two_id_set keyed by player id, cutoff MLD)."""
    two_class = []
    for p in all_players:
        meta = _meta(p)
        mld = meta.get("mld") or 0
        years, _ = _parse_mld(mld)
        if years != 2:
            continue
        projected = _project_eos_mld(p, season_day, limbo)
        accrual = _accrual_prior_year(p, season_day, limbo)
        if accrual is not None and accrual < 86:
            continue
        two_class.append((p, projected))
    if not two_class:
        return set(), DAYS_PER_SEASON * 3
    two_class.sort(key=lambda t: t[1], reverse=True)
    cutoff_index = max(0, math.ceil(len(two_class) * 0.22) - 1)
    cutoff_mld = two_class[cutoff_index][1]
    super_two = set()
    for p, projected in two_class:
        if projected >= cutoff_mld:
            pid = p.get("id") if p.get("id") is not None else p.get("_uid")
            if pid is not None:
                super_two.add(pid)
    return super_two, cutoff_mld


def parse_contract_status(player: dict, game_year: int, super_two_ids: set | None = None) -> dict:
    meta = _meta(player)
    yl = (meta.get("yl") or "").strip()
    mld = meta.get("mld") or 0
    mlb_years, mlb_days = _parse_mld(mld)
    on40 = meta.get("on40") is True
    lev = meta.get("lev") or ""

    m = YL_PATTERN.match(yl)
    years_left = int(m.group(1)) if m else 0
    qualifier = (m.group(2) or "").strip().lower() if m and m.group(2) else ""

    option_type = None
    if not yl or years_left == 0:
        ctype = "fa"
    elif "auto" in qualifier:
        ctype = "pre-arb"
    elif "arbitr" in qualifier:
        ctype = "arb"
    elif "club opt" in qualifier:
        ctype = "signed"
        option_type = "club"
    elif "player opt" in qualifier:
        ctype = "signed"
        option_type = "player"
    elif "vesting" in qualifier:
        ctype = "signed"
        option_type = "vesting"
    elif years_left > 0:
        ctype = "signed"
    else:
        ctype = "fa"

    if not on40 and lev != "MLB":
        if ctype in ("pre-arb", "fa"):
            ctype = "minors"

    pid = player.get("id") if player.get("id") is not None else player.get("_uid")
    if super_two_ids is not None:
        is_super_two = pid in super_two_ids
    else:
        is_super_two = (ctype == "arb" and mlb_years < 3) or (
            ctype == "pre-arb" and mlb_years == 2 and mlb_days >= 130
        )

    if ctype == "signed":
        control_years = years_left
    elif ctype in ("pre-arb", "arb"):
        control_years = max(0, 6 - mlb_years)
    else:
        control_years = 0

    control_end = game_year + control_years
    fa_year = game_year if ctype == "fa" else control_end

    if ctype == "arb":
        arb_start_year = game_year
    elif ctype == "signed":
        arb_start_year = None
    else:
        arb_start_year = game_year + max(0, 3 - mlb_years)

    arb_year_num = None
    if ctype == "arb":
        arb_year_num = max(1, min(3, mlb_years - 2))

    return {
        "type": ctype,
        "yearsLeft": years_left,
        "optionType": option_type,
        "controlEnd": control_end,
        "faYear": fa_year,
        "arbStartYear": arb_start_year,
        "isSuperTwo": bool(is_super_two),
        "controlYears": control_years,
        "arbYearNum": arb_year_num,
        "mlbYears": mlb_years,
        "mlbDays": mlb_days,
    }


def calc_r5_projection(player: dict, game_year: int) -> dict | None:
    meta = _meta(player)
    if meta.get("on40") is True:
        return {"r5Year": None, "r5Countdown": None, "isProtected": True}
    if meta.get("r5") is True:
        return {"r5Year": game_year, "r5Countdown": 0, "isProtected": False}

    draft_year = meta.get("draft")
    proy = meta.get("proy") or 0

    if not draft_year and proy == 0:
        return {"r5Year": None, "r5Countdown": None, "isProtected": False}

    signing_age = 19
    dob = meta.get("dob")
    if draft_year and draft_year > 0 and dob:
        try:
            d = datetime.strptime(dob, "%Y-%m-%d")
            july_first = datetime(int(draft_year), 7, 1)
            signing_age = int((july_first - d).days // 365.25)
        except (ValueError, TypeError):
            signing_age = 19

    if not draft_year or draft_year == 0:
        threshold = 5 if signing_age <= 18 else 4
        estimated_sign_year = game_year - proy
        r5_year = int(estimated_sign_year + threshold)
        return {
            "r5Year": r5_year,
            "r5Countdown": max(0, r5_year - game_year),
            "isProtected": False,
        }

    threshold = 5 if signing_age <= 18 else 4
    r5_year = int(draft_year + threshold)
    return {
        "r5Year": r5_year,
        "r5Countdown": max(0, r5_year - game_year),
        "isProtected": False,
    }


def calc_mlfa(player: dict, game_year: int) -> dict | None:
    meta = _meta(player)
    proy = meta.get("proy") or 0
    years_left = max(0, math.ceil(7 - proy))
    return {
        "eligible": proy >= 7,
        "mlfaYear": game_year + years_left,
    }


def get_options_info(player: dict) -> dict:
    meta = _meta(player)
    used = meta.get("opt") or 0
    remaining = max(0, 3 - used)
    on40 = meta.get("on40") is True
    return {
        "used": used,
        "remaining": remaining,
        "outOfOptions": on40 and remaining <= 0,
    }


def resolve_contract_year(contract: dict | None, calendar_year: int) -> dict | None:
    if not contract:
        return None
    season_year = contract.get("seasonYear", 0) or 0
    current_year = contract.get("currentYear", 0) or 0
    years = contract.get("years", 0) or 0
    salaries = contract.get("salaries") or []

    year_index = current_year + (calendar_year - (season_year + current_year))

    if 0 <= year_index < years:
        salary = salaries[year_index] if year_index < len(salaries) else 0
        option_type = None
        buyout = 0
        if year_index == years - 1:
            if contract.get("lastYearTeamOption"):
                option_type = "club"; buyout = contract.get("lastYearOptionBuyout", 0) or 0
            elif contract.get("lastYearPlayerOption"):
                option_type = "player"; buyout = contract.get("lastYearOptionBuyout", 0) or 0
            elif contract.get("lastYearVestingOption"):
                option_type = "vesting"
        if year_index == years - 2:
            if contract.get("nextLastYearTeamOption"):
                option_type = "club"; buyout = contract.get("nextLastYearOptionBuyout", 0) or 0
            elif contract.get("nextLastYearPlayerOption"):
                option_type = "player"; buyout = contract.get("nextLastYearOptionBuyout", 0) or 0
            elif contract.get("nextLastYearVestingOption"):
                option_type = "vesting"
        return {"salary": salary or 0, "optionType": option_type, "buyout": buyout}

    ext = contract.get("extension")
    if ext:
        ext_start = season_year + years
        ext_index = calendar_year - ext_start
        ext_years = ext.get("years", 0) or 0
        ext_salaries = ext.get("salaries") or []
        if 0 <= ext_index < ext_years:
            salary = ext_salaries[ext_index] if ext_index < len(ext_salaries) else 0
            option_type = None
            buyout = 0
            if ext_index == ext_years - 1:
                if ext.get("lastYearTeamOption"):
                    option_type = "club"; buyout = ext.get("lastYearOptionBuyout", 0) or 0
                elif ext.get("lastYearPlayerOption"):
                    option_type = "player"; buyout = ext.get("lastYearOptionBuyout", 0) or 0
                elif ext.get("lastYearVestingOption"):
                    option_type = "vesting"
            if ext_index == ext_years - 2:
                if ext.get("nextLastYearTeamOption"):
                    option_type = "club"; buyout = ext.get("nextLastYearOptionBuyout", 0) or 0
                elif ext.get("nextLastYearPlayerOption"):
                    option_type = "player"; buyout = ext.get("nextLastYearOptionBuyout", 0) or 0
                elif ext.get("nextLastYearVestingOption"):
                    option_type = "vesting"
            return {"salary": salary or 0, "optionType": option_type, "buyout": buyout}

    return None


def _resolve_from_sp_contract(sp_contract: dict | None, target_year: int) -> dict | None:
    """Per-year status straight from the StatsPlus contract feed, or None."""
    if not sp_contract:
        return None
    resolved = resolve_contract_year(sp_contract, target_year)
    if not resolved or resolved.get("salary", 0) <= 0:
        return None
    label = _fmt_salary(resolved["salary"]) or "Signed"
    opt = resolved.get("optionType")
    if opt:
        status_label = (
            "Club Opt" if opt == "club" else "Player Opt" if opt == "player" else "Vesting Opt"
        )
        return {
            "status": "option", "label": label, "statusLabel": status_label,
            "optionType": opt, "buyout": resolved.get("buyout", 0),
            "salary": resolved["salary"], "guaranteed": True,
        }
    return {
        "status": "signed", "label": label, "statusLabel": "Signed",
        "salary": resolved["salary"], "guaranteed": True,
    }


def project_year_status(
    player: dict,
    year_offset: int,
    game_year: int,
    contract_status: dict,
    mlfa: dict | None,
    sp_contract: dict | None = None,
    salary_report_entry: dict | None = None,
    contract_year: int | None = None,
) -> dict:
    target_year = game_year + year_offset
    meta = _meta(player)

    # Once the contract frame has rolled past the calendar year (offseason:
    # arbitration settled, free agency open), the StatsPlus salary report is
    # still anchored to the completed season and reports next year as an
    # unsigned *projection*. The contract feed carries the settled deal, so it
    # wins for every year the roll has reached. Beyond the contract's span
    # nothing resolves and we fall through to the report's projections.
    rolled = contract_year is not None and contract_year > game_year
    if rolled and target_year >= contract_year:
        sr_type = None
        if salary_report_entry:
            years_map = salary_report_entry.get("years") or {}
            yr_row = years_map.get(target_year) or years_map.get(str(target_year))
            sr_type = (yr_row or {}).get("type")
        # "milb"/"milc" encode roster LEVEL, which the contract feed cannot
        # express — a 40-man player optioned to the minors still has a salary
        # there. Only let the feed override the terms the roll actually
        # settles: arbitration, free agency, options and signed years.
        if sr_type not in ("milb", "milc"):
            from_contract = _resolve_from_sp_contract(sp_contract, target_year)
            if from_contract:
                return from_contract

    if salary_report_entry:
        years_map = salary_report_entry.get("years") or {}
        yr = years_map.get(target_year) or years_map.get(str(target_year))
        if yr:
            salary = yr.get("salary")
            label = _fmt_salary(salary) or (yr.get("type") or "").upper()
            g = yr.get("guaranteed")
            t = yr.get("type")
            if t == "fa":
                return {"status": "fa", "label": "FA", "statusLabel": "FA"}
            if t == "milb":
                return {"status": "minors", "label": "MiLB", "statusLabel": "MiLB"}
            if t == "milc":
                return {"status": "minors", "label": "MiLC", "statusLabel": "MiLC"}
            if t == "arb":
                return {"status": "arb", "label": label, "statusLabel": "Arb", "salary": salary, "guaranteed": g}
            if t == "arb_uncertain":
                return {"status": "arb", "label": label, "statusLabel": "Arb?", "salary": salary, "guaranteed": g}
            if t == "team_option":
                return {"status": "option", "label": label, "statusLabel": "Team Opt", "salary": salary, "guaranteed": g, "optionType": "club"}
            if t == "player_option":
                return {"status": "option", "label": label, "statusLabel": "Player Opt", "salary": salary, "guaranteed": g, "optionType": "player"}
            if t == "vesting_option":
                return {"status": "option", "label": label, "statusLabel": "Vest Opt", "salary": salary, "guaranteed": g, "optionType": "vesting"}
            if t == "opt_out":
                return {"status": "signed", "label": label, "statusLabel": "Opt-out", "salary": salary, "guaranteed": g}
            if t == "retained":
                return {"status": "signed", "label": label, "statusLabel": "Retained", "salary": salary, "guaranteed": g}
            return {"status": "signed", "label": label, "statusLabel": "Signed", "salary": salary, "guaranteed": g}

    from_contract = _resolve_from_sp_contract(sp_contract, target_year)
    if from_contract:
        return from_contract

    ctype = contract_status["type"]

    if ctype != "minors" and target_year >= contract_status["faYear"]:
        return {"status": "fa", "label": "FA", "statusLabel": "FA"}

    if ctype == "signed":
        if year_offset < contract_status["yearsLeft"]:
            if year_offset == contract_status["yearsLeft"] - 1 and contract_status.get("optionType"):
                opt = contract_status["optionType"]
                status_label = "Club Opt" if opt == "club" else "Player Opt" if opt == "player" else "Vesting Opt"
                return {"status": "option", "label": "Signed", "statusLabel": status_label, "optionType": opt}
            return {"status": "signed", "label": "Signed", "statusLabel": "Signed"}
        return {"status": "fa", "label": "FA", "statusLabel": "FA"}

    if ctype == "minors":
        if meta.get("on40") is True:
            projected = contract_status["mlbYears"] + year_offset
            if projected >= 6:
                return {"status": "fa", "label": "FA", "statusLabel": "FA"}
            return {"status": "pre-arb", "label": "Pre-Arb", "statusLabel": "Pre-Arb"}
        mlfa_year = mlfa.get("mlfaYear") if mlfa else None
        if mlfa_year is not None and target_year >= mlfa_year:
            return {"status": "fa", "label": "MiLB FA", "statusLabel": "MiLB FA"}
        return {"status": "minors", "label": "MiLB", "statusLabel": "MiLB"}

    projected_mlb_years = contract_status["mlbYears"] + year_offset
    if projected_mlb_years >= 6:
        return {"status": "fa", "label": "FA", "statusLabel": "FA"}

    if ctype == "pre-arb":
        years_until_arb = max(0, (contract_status["arbStartYear"] or game_year + 1) - game_year) if contract_status.get("arbStartYear") is not None else 1
        if year_offset < years_until_arb:
            return {"status": "pre-arb", "label": "Pre-Arb", "statusLabel": "Pre-Arb"}
        arb_num = min(3, year_offset - years_until_arb + 1)
        s2 = " (S2)" if contract_status.get("isSuperTwo") and arb_num == 1 else ""
        label = f"Arb-{arb_num}{s2}"
        return {"status": "arb", "label": label, "statusLabel": label}

    if ctype == "arb":
        current_arb = contract_status.get("arbYearNum") or 1
        projected_arb = current_arb + year_offset
        if projected_arb > 3 or projected_mlb_years >= 6:
            return {"status": "fa", "label": "FA", "statusLabel": "FA"}
        label = f"Arb-{projected_arb}"
        return {"status": "arb", "label": label, "statusLabel": label}

    return {"status": "fa", "label": "FA", "statusLabel": "FA"}


def build_player_projection(
    player: dict,
    game_year: int,
    super_two_ids: set | None = None,
    salary_report_entry: dict | None = None,
    year_horizon: int = 7,
    contract_year: int | None = None,
) -> dict:
    contract_status = parse_contract_status(player, game_year, super_two_ids)
    r5 = calc_r5_projection(player, game_year)
    mlfa = calc_mlfa(player, game_year)
    options = get_options_info(player)
    sp_contract = player.get("contract")

    baseline: dict[str, Any] = {}
    for offset in range(year_horizon):
        year = game_year + offset
        baseline[str(year)] = project_year_status(
            player, offset, game_year, contract_status, mlfa, sp_contract,
            salary_report_entry, contract_year,
        )

    return {
        "baseline": baseline,
        "r5": r5,
        "mlfa": mlfa,
        "contractStatus": contract_status,
        "options": options,
        "isSuperTwo": contract_status["isSuperTwo"],
    }
