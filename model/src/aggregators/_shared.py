"""Shared helpers used by the hit/pitch/field aggregator modules.

Hosts the wOBA derivation (used by hitting, pitching, and fielding pipelines)
plus two small reusable patterns extracted from rating-average computations:
``_weighted_mean`` and ``_pa_fractions_by_hand``.
"""
from __future__ import annotations

import pandas as pd


# ---------------------------------------------------------------------------
# Generic weighted-aggregate helpers
# ---------------------------------------------------------------------------


def compute_runs_per_win(pitching_data: pd.DataFrame) -> float:
    """League runs-per-win (the WAA/WAR scale constant), from overall pitching.

    FanGraphs-style RPW = lg_RA/9 × 1.5 + 3, computed from the league's own
    overall run environment. Shared by the hit and pitch aggregators so both
    derive an identical, per-league value (rather than a stale hardcoded one).
    """
    overall_ip = pd.to_numeric(pitching_data["IP Clean"], errors="coerce").sum()
    overall_r = pd.to_numeric(pitching_data["R"], errors="coerce").sum()
    lg_ra9 = overall_r / overall_ip * 9 if overall_ip > 0 else 0.0
    return lg_ra9 * 1.5 + 3.0


def _weighted_mean(weights: pd.Series, values: pd.Series) -> float:
    """Return the weight-weighted mean of *values*.

    Both inputs are coerced to numeric (NaN on failure). The denominator is
    the sum of *weights* — callers must guarantee it is non-zero.
    """
    w = pd.to_numeric(weights, errors="coerce")
    v = pd.to_numeric(values, errors="coerce")
    return (w * v).sum() / w.sum()


def _pa_fractions_by_hand(
    vr_df: pd.DataFrame,
    vl_df: pd.DataFrame,
    *,
    weight_col: str,
    hand_col: str,
    hands: list[tuple[str, str]],
) -> dict[str, float]:
    """Compute weight fractions of vR side for each batter/pitcher hand.

    ``hands`` is a list of ``(hand_value, output_key)`` pairs. For each pair,
    the result has ``output_key = vr_weight[hand] / (vr_weight[hand] + vl_weight[hand])``.
    Also adds ``ovr_vr`` = total vR weight / total weight across both files.
    """
    vr_by_hand = vr_df.groupby(hand_col)[weight_col].sum()
    vl_by_hand = vl_df.groupby(hand_col)[weight_col].sum()

    result: dict[str, float] = {}
    for hand_value, key in hands:
        vr_w = vr_by_hand.get(hand_value, 0)
        vl_w = vl_by_hand.get(hand_value, 0)
        total = vr_w + vl_w
        result[key] = vr_w / total if total > 0 else 0.0

    total_vr = vr_df[weight_col].sum()
    total_all = total_vr + vl_df[weight_col].sum()
    result["ovr_vr"] = total_vr / total_all if total_all > 0 else 0.0
    return result


# ---------------------------------------------------------------------------
# wOBA derivation (shared between hitting, pitching, and fielding helpers)
# ---------------------------------------------------------------------------


def _compute_woba_from_aggregates(agg: dict, *, is_pitching: bool = False) -> dict:
    """Compute wOBA weights and league stats from aggregate counting stats.

    This is the shared wOBA derivation methodology used by both hitting and
    pitching calc sheets. Returns a dict with all intermediate values.

    The ``agg`` dict must have keys: R, PA, AB, 1B, 2B, 3B, HR, BB, HP, IBB,
    SH, SF, SB, CS, Outs (or K for pitching).

    The ``is_pitching`` flag controls the HR%/SO% denominator:
    - Hitting: HR/(PA-HP-IBB-BB), SO/(PA-HP-IBB-BB)
    - Pitching: HR/(BF-HP-BB), SO/(BF-HP-BB)
    """
    R = agg["R"]
    PA = agg["PA"]
    AB = agg["AB"]
    s1B = agg["1B"]
    s2B = agg["2B"]
    s3B = agg["3B"]
    HR = agg["HR"]
    BB = agg["BB"]
    HP = agg["HP"]
    IBB = agg["IBB"]
    SF = agg["SF"]
    SB = agg["SB"]
    CS = agg["CS"]
    Outs = agg["Outs"]

    # Step 1: Run per out
    r_per_out = R / Outs

    # Step 2: Run values (linear from run_per_out)
    run_bb = 0.14 + r_per_out
    run_hbp = 0.025 + run_bb
    run_1b = 0.155 + run_bb
    run_2b = 0.3 + run_1b
    run_3b = run_2b + 0.27
    run_hr = 1.4
    run_sb = 0.2
    run_cs = -(2 * r_per_out + 0.075)

    # Step 3: Productive / unproductive decomposition
    pro_non_outs = s1B + s2B + s3B + HR + (BB - IBB) + HP
    unpro_outs = AB - (s1B + s2B + s3B + HR) + SF

    # Step 4: Total run values (count × run_value per event)
    total_rv = {
        "BB": (BB - IBB) * run_bb,
        "HBP": HP * run_hbp,
        "1B": s1B * run_1b,
        "2B": s2B * run_2b,
        "3B": s3B * run_3b,
        "HR": HR * run_hr,
        "SB": SB * run_sb,
        "CS": CS * run_cs,
    }
    total_run_value = sum(total_rv.values())

    # Step 5: wOBA scale
    runs_plus = total_run_value / pro_non_outs
    runs_minus = total_run_value / unpro_outs
    woba_scale = 1.0 / (runs_plus + runs_minus)

    # Step 6: wOBA event weights
    # Standard events: wt = (run_value + runs_minus) × woba_scale
    wt_bb = (run_bb + runs_minus) * woba_scale
    wt_hbp = (run_hbp + runs_minus) * woba_scale
    wt_1b = (run_1b + runs_minus) * woba_scale
    wt_2b = (run_2b + runs_minus) * woba_scale
    wt_3b = (run_3b + runs_minus) * woba_scale
    wt_hr = (run_hr + runs_minus) * woba_scale
    # SB/CS: wt = run_value × woba_scale (no runs_minus offset)
    wt_sb = run_sb * woba_scale
    wt_cs = run_cs * woba_scale

    # Step 7: lg wSB
    lg_wsb = max((SB * run_sb + CS * run_cs) / (BB + HP + s1B - IBB), 0.0)

    # Step 8: lg wOBA
    numerator = (
        (BB - IBB) * wt_bb
        + HP * wt_hbp
        + s1B * wt_1b
        + s2B * wt_2b
        + s3B * wt_3b
        + HR * wt_hr
    )
    denominator = AB + (BB - IBB) + HP + SF
    lg_woba = numerator / denominator

    # Step 9: League stat rates
    SO = agg.get("SO", agg.get("K", 0))
    SH = agg.get("SH", 0)

    # The denominator for SO% and HR% differs between hitting and pitching:
    # Hitting: PA - HP - IBB - BB (excludes IBB from denominator)
    # Pitching: BF - HP - BB (keeps IBB in denominator — BB includes IBB)
    if is_pitching:
        rate_denom = PA - HP - BB
    else:
        rate_denom = PA - HP - IBB - BB

    so_rate = SO / rate_denom if rate_denom > 0 else 0.0

    # uBB% = (BB-IBB)/(PA-IBB-HP)
    bb_rate = (BB - IBB) / (PA - IBB - HP) if (PA - IBB - HP) > 0 else 0.0

    hr_rate = HR / rate_denom if rate_denom > 0 else 0.0

    # BABIP = (1B+2B+3B)/(AB-HR+SF-SO)
    babip = (s1B + s2B + s3B) / (AB - HR + SF - SO) if (AB - HR + SF - SO) > 0 else 0.0

    # XBH% = (2B+3B)/(1B+2B+3B)
    xbh_rate = (s2B + s3B) / (s1B + s2B + s3B) if (s1B + s2B + s3B) > 0 else 0.0

    # 3B% = 3B/(3B+2B)
    triple_rate = s3B / (s3B + s2B) if (s3B + s2B) > 0 else 0.0

    # SB% = SB/(SB+CS)
    sb_pct = SB / (SB + CS) if (SB + CS) > 0 else 0.0

    # SBA% = (SB+CS)/(1B+BB+HP)
    sba_rate = (SB + CS) / (s1B + BB + HP) if (s1B + BB + HP) > 0 else 0.0

    # UBR rate: UBR / ((1B+BB+HP)*3 + 2B*2 + 3B - CS*3 - SB)
    UBR = agg.get("UBR", 0.0)
    if UBR is None:
        UBR = 0.0
    ubr_denom = (s1B + BB + HP) * 3 + s2B * 2 + s3B - CS * 3 - SB
    ubr_rate = UBR / ubr_denom if ubr_denom != 0 else 0.0

    # R/PA
    r_per_pa = R / PA if PA > 0 else 0.0

    # HBP rate
    hbp_rate = HP / PA if PA > 0 else 0.0

    return {
        "r_per_out": r_per_out,
        "run_bb": run_bb, "run_hbp": run_hbp, "run_1b": run_1b,
        "run_2b": run_2b, "run_3b": run_3b, "run_hr": run_hr,
        "run_sb": run_sb, "run_cs": run_cs,
        "pro_non_outs": pro_non_outs, "unpro_outs": unpro_outs,
        "total_run_value": total_run_value,
        "runs_plus": runs_plus, "runs_minus": runs_minus,
        "woba_scale": woba_scale,
        "wt_bb": wt_bb, "wt_hbp": wt_hbp, "wt_1b": wt_1b, "wt_2b": wt_2b,
        "wt_3b": wt_3b, "wt_hr": wt_hr, "wt_sb": wt_sb, "wt_cs": wt_cs,
        "lg_wsb": lg_wsb, "lg_woba": lg_woba,
        "so_rate": so_rate, "bb_rate": bb_rate, "hr_rate": hr_rate,
        "babip": babip, "xbh_rate": xbh_rate, "triple_rate": triple_rate,
        "sb_pct": sb_pct, "sba_rate": sba_rate, "ubr_rate": ubr_rate,
        "r_per_pa": r_per_pa, "hbp_rate": hbp_rate,
    }
