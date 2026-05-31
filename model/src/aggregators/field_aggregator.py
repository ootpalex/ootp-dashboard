"""Fielding calc + position adjustment pipeline — produces ``FieldingParams``.

Builds the per-position helper tables (fielding helper + POS Adj helper) from
raw inputs, then derives IP-weighted rating averages, position adjustments,
and the per-position scaling constants used downstream.

Depends on the hitting wOBA derivation to compute per-player offensive value
(OFF = wRAA + wSB + UBRAA) for the position-adjustment math.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.aggregators._shared import _compute_woba_from_aggregates
from src.aggregators.hit_aggregator import _aggregate_hitting
from src.data_points import FieldingParams


# Per-position IP column names used across the helper tables.
_POS_IP_MAP = {
    "c": "C IP", "1b": "1B IP", "2b": "2B IP", "3b": "3B IP",
    "ss": "SS IP", "lf": "LF IP", "cf": "CF IP", "rf": "RF IP",
}


def _compute_fielding_aggregates(fielding_data: dict[str, pd.DataFrame]) -> dict:
    """Sum counting stats per position from fielding data tables."""
    result = {}
    stat_cols = ["IP Clean", "Plays A", "Plays M", "E", "DP", "ARM", "FRM", "SBA", "RTO"]

    for pos, df in fielding_data.items():
        pos_agg = {}
        for col in stat_cols:
            if col in df.columns:
                pos_agg[col] = pd.to_numeric(df[col], errors="coerce").sum()
            else:
                pos_agg[col] = 0.0
        result[pos] = pos_agg

    return result


def _build_fielding_helper(fielding_data: dict[str, pd.DataFrame],
                           fielding_ratings: pd.DataFrame) -> pd.DataFrame:
    """Build the fielding helper table from raw fielding data + ratings.

    Joins per-position IP from fielding_data_{pos} files with fielding_ratings
    to produce a single table with per-player IP distribution and rating columns.

    This replicates the pivot table in the 25 Metadata.xlsx spreadsheet.
    """
    rating_cols = ["ID", "C ABI Fix", "C FRM Fix", "C ARM Fix",
                   "IF RNG", "IF ERR", "IF ARM", "TDP",
                   "OF RNG", "OF ERR", "OF ARM", "HT CM"]
    helper = fielding_ratings[rating_cols].copy()
    helper["ID"] = pd.to_numeric(helper["ID"], errors="coerce")

    # Add per-position IP from fielding_data files
    for pos_key, col_name in _POS_IP_MAP.items():
        fd = fielding_data[pos_key][["ID", "IP Clean"]].copy()
        fd["ID"] = pd.to_numeric(fd["ID"], errors="coerce")
        fd = fd.rename(columns={"IP Clean": col_name})
        helper = helper.merge(fd, on="ID", how="left")
        helper[col_name] = helper[col_name].fillna(0.0)

    # IP Clean = sum of all position IPs
    ip_cols = list(_POS_IP_MAP.values())
    helper["IP Clean"] = helper[ip_cols].sum(axis=1)

    return helper


def _build_pos_adj_helper(hitting_data: pd.DataFrame,
                          fielding_data: dict[str, pd.DataFrame],
                          woba_intermediates: dict) -> pd.DataFrame:
    """Build the position adjustment helper table from raw data.

    Computes per-player OFF (offensive value = wRAA + BSR) from hitting_data,
    then joins with per-position IP from fielding_data files.

    This replicates the POS Adj Calc pivot table in 25 Metadata.xlsx.
    """
    hd = hitting_data.copy()
    for col in hd.columns:
        if col not in ("ID", "Name", "ORG"):
            hd[col] = pd.to_numeric(hd[col], errors="coerce").fillna(0)

    # Per-player wOBA
    uBB = hd["BB"] - hd["IBB"]
    numerator = (uBB * woba_intermediates["wt_bb"]
                 + hd["HP"] * woba_intermediates["wt_hbp"]
                 + hd["1B"] * woba_intermediates["wt_1b"]
                 + hd["2B"] * woba_intermediates["wt_2b"]
                 + hd["3B"] * woba_intermediates["wt_3b"]
                 + hd["HR"] * woba_intermediates["wt_hr"])
    denominator = hd["AB"] + uBB + hd["HP"] + hd["SF"]
    player_woba = np.where(denominator > 0, numerator / denominator, 0.0)

    # wRAA = (wOBA - lg_wOBA) / woba_scale * PA
    lg_woba = woba_intermediates["lg_woba"]
    woba_scale = woba_intermediates["woba_scale"]
    wRAA = (player_woba - lg_woba) / woba_scale * hd["PA"]

    # wSB = SB*run_sb + CS*run_cs - lg_wsb*(1B+BB+HP-IBB)
    run_sb = woba_intermediates["run_sb"]
    run_cs = woba_intermediates["run_cs"]
    lg_wsb = woba_intermediates["lg_wsb"]
    wSB = (hd["SB"] * run_sb + hd["CS"] * run_cs
           - lg_wsb * (hd["1B"] + hd["BB"] + hd["HP"] - hd["IBB"]))

    # UBRAA = UBR - ubr_rate * UBR_opportunities
    lg_ubr_rate = woba_intermediates["ubr_rate"]
    ubr_opp = (hd["1B"] + hd["BB"] + hd["HP"]) * 3 + hd["2B"] * 2 + hd["3B"] - hd["SB"] - hd["CS"] * 3
    UBRAA = hd["UBR"] - lg_ubr_rate * ubr_opp

    # OFF = wRAA + BSR = wRAA + wSB + UBRAA
    OFF = wRAA + wSB + UBRAA

    result = pd.DataFrame({"ID": hd["ID"], "PA": hd["PA"], "OFF": OFF})

    for pos_key, col_name in _POS_IP_MAP.items():
        fd = fielding_data[pos_key][["ID", "IP Clean"]].copy()
        fd["ID"] = pd.to_numeric(fd["ID"], errors="coerce")
        fd = fd.rename(columns={"IP Clean": col_name})
        result = result.merge(fd, on="ID", how="left")
        result[col_name] = result[col_name].fillna(0.0)

    ip_cols = list(_POS_IP_MAP.values())
    result["IP Clean"] = result[ip_cols].sum(axis=1)

    # Filter to only players with fielding data (IP Clean > 0)
    result = result[result["IP Clean"] > 0].reset_index(drop=True)

    return result


def _compute_fielding_rating_averages(fielding_helper: pd.DataFrame,
                                      fielding_ratings: pd.DataFrame) -> dict:
    """Compute IP-weighted fielding rating averages per position.

    Uses the fielding helper table (per-player IP distribution + ratings)
    to compute IP-weighted averages for each position.
    """
    helper = fielding_helper.copy()

    for col in helper.columns:
        if col != "ID":
            helper[col] = pd.to_numeric(helper[col], errors="coerce").fillna(0)

    rating_cols = {
        "C ABI": "C ABI Fix", "C FRM": "C FRM Fix", "C ARM": "C ARM Fix",
        "IF RNG": "IF RNG", "IF ERR": "IF ERR", "IF ARM": "IF ARM",
        "TDP": "TDP", "OF RNG": "OF RNG", "OF ERR": "OF ERR",
        "OF ARM": "OF ARM", "HT": "HT CM",
    }

    result = {}
    for pos, ip_col in _POS_IP_MAP.items():
        if ip_col not in helper.columns:
            continue

        ip_weights = helper[ip_col]
        total_ip = ip_weights.sum()
        if total_ip == 0:
            continue

        pos_avgs = {}
        for name, col in rating_cols.items():
            if col in helper.columns:
                vals = helper[col]
                pos_avgs[name] = (ip_weights * vals).sum() / total_ip

        result[pos] = pos_avgs

    return result


def _compute_position_adjustments(statsplus_url: str | None) -> dict[str, float]:
    """Return the frozen multi-year blended defensive-switcher spectrum (runs/162).

    Replaces the prior per-season offense-allocation method, which was broken in
    three measurable ways: noisy season-to-season, sample-artifact sign-flips on
    premium positions (SSB CF wrongly negative), and a DH-collapse (54% of BLM
    hitters had maxWar=DH because the offense-derived DH floated above the corners).

    The replacement is the per-universe spectrum computed in
    ``Leftovers/positional-adjustments/pos_adj_grid.json`` at H=2.5 / cutoff=8y,
    with the locked DH-tie-to-lowest rule and the field-8-mean=0 anchor
    (Zimmerman 2014 / FanGraphs convention) — frozen in
    ``data_points._FROZEN_POS_ADJ_BY_URL`` and looked up here by the league's
    ``statsplusUrl`` (4 BLM-* slugs share one URL; SSB + default share another).
    Unknown URLs fall back to BLM.

    See ``Leftovers/posadj-bestpos-impact/IMPACT.md`` for end-to-end validation.
    """
    from src.data_points import get_frozen_pos_adj
    return get_frozen_pos_adj(statsplus_url)


def compute_fielding_constants(inputs,
                               woba_intermediates: dict | None = None) -> FieldingParams:
    """Compute all FieldingParams from fielding data + ratings.

    Args:
        inputs: MetadataInputs with raw data
        woba_intermediates: Unused since the 2026-05 pos-adj overhaul (positional
            adjustments are now a per-league frozen lookup, no longer offense-derived).
            Kept for backward compatibility with external callers.
    """
    del woba_intermediates  # no longer needed; see _compute_position_adjustments
    fielding_helper = _build_fielding_helper(inputs.fielding_data, inputs.fielding_ratings)

    agg = _compute_fielding_aggregates(inputs.fielding_data)
    rating_avgs = _compute_fielding_rating_averages(
        fielding_helper, inputs.fielding_ratings)
    pos_adj = _compute_position_adjustments(inputs.statsplus_url)

    # Helper to get aggregate value
    def ga(pos: str, stat: str) -> float:
        return agg.get(pos, {}).get(stat, 0.0)

    # Catcher stats per 1000 IP
    c_ip = ga("c", "IP Clean")
    c_frm_scale = ga("c", "FRM") / c_ip * 1000 if c_ip > 0 else 0.0
    c_sba_scale = ga("c", "SBA") / c_ip * 1000 if c_ip > 0 else 0.0
    c_rto_lg = ga("c", "RTO") / ga("c", "SBA") if ga("c", "SBA") > 0 else 0.0

    def pos_stats(pos: str) -> dict:
        ip = ga(pos, "IP Clean")
        plays_a = ga(pos, "Plays A")
        plays_m = ga(pos, "Plays M")
        e = ga(pos, "E")
        dp = ga(pos, "DP")
        return {
            "pa_per_1200": plays_a / ip * 1200 if ip > 0 else 0.0,
            "pm_pct": plays_m / plays_a if plays_a > 0 else 0.0,
            "e_pct": e / plays_m if plays_m > 0 else 0.0,
            "dp_per_1200": dp / ip * 1200 if ip > 0 else 0.0,
        }

    stats = {pos: pos_stats(pos) for pos in
             ["1b", "2b", "3b", "ss", "lf", "cf", "rf"]}

    def arm_per_1200(pos: str) -> float:
        ip = ga(pos, "IP Clean")
        arm = ga(pos, "ARM")
        return arm / ip * 1200 if ip > 0 else 0.0

    def ra(pos: str, rating: str) -> float:
        pos_data = rating_avgs.get(pos, {})
        return pos_data.get(rating, 50.0)

    return FieldingParams(
        # Position adjustments
        pos_c=pos_adj.get("C", 0.0),
        pos_1b=pos_adj.get("1B", 0.0),
        pos_2b=pos_adj.get("2B", 0.0),
        pos_3b=pos_adj.get("3B", 0.0),
        pos_ss=pos_adj.get("SS", 0.0),
        pos_lf=pos_adj.get("LF", 0.0),
        pos_cf=pos_adj.get("CF", 0.0),
        pos_rf=pos_adj.get("RF", 0.0),
        pos_dh=pos_adj.get("DH", 0.0),

        # Primary fielding rating averages
        avg_frm_c=ra("c", "C FRM"),
        avg_rng_1b=ra("1b", "IF RNG"),
        avg_rng_2b=ra("2b", "IF RNG"),
        avg_rng_3b=ra("3b", "IF RNG"),
        avg_rng_ss=ra("ss", "IF RNG"),
        avg_rng_lf=ra("lf", "OF RNG"),
        avg_rng_cf=ra("cf", "OF RNG"),
        avg_rng_rf=ra("rf", "OF RNG"),

        # Catcher secondary
        avg_arm_c=ra("c", "C ARM"),

        # Infield secondary
        avg_ht_1b=ra("1b", "HT"),
        avg_err_1b=ra("1b", "IF ERR"),
        avg_arm_2b=ra("2b", "IF ARM"),
        avg_err_2b=ra("2b", "IF ERR"),
        avg_tdp_2b=ra("2b", "TDP"),
        avg_arm_3b=ra("3b", "IF ARM"),
        avg_err_3b=ra("3b", "IF ERR"),
        avg_arm_ss=ra("ss", "IF ARM"),
        avg_err_ss=ra("ss", "IF ERR"),
        avg_tdp_ss=ra("ss", "TDP"),

        # Outfield secondary
        avg_err_lf=ra("lf", "OF ERR"),
        avg_arm_lf=ra("lf", "OF ARM"),
        avg_err_cf=ra("cf", "OF ERR"),
        avg_arm_cf=ra("cf", "OF ARM"),
        avg_err_rf=ra("rf", "OF ERR"),
        avg_arm_rf=ra("rf", "OF ARM"),

        # Scaling constants
        c_frm_scale=c_frm_scale,
        c_sba_scale=c_sba_scale,
        c_rto_lg=c_rto_lg,

        first_pa=stats["1b"]["pa_per_1200"],
        first_pm_lg=stats["1b"]["pm_pct"],
        first_err_lg=stats["1b"]["e_pct"],

        second_pa=stats["2b"]["pa_per_1200"],
        second_pm_lg=stats["2b"]["pm_pct"],
        second_err_lg=stats["2b"]["e_pct"],
        second_dp_pa=stats["2b"]["dp_per_1200"],

        third_pa=stats["3b"]["pa_per_1200"],
        third_pm_lg=stats["3b"]["pm_pct"],
        third_err_lg=stats["3b"]["e_pct"],

        ss_pa=stats["ss"]["pa_per_1200"],
        ss_pm_lg=stats["ss"]["pm_pct"],
        ss_err_lg=stats["ss"]["e_pct"],

        lf_pa=stats["lf"]["pa_per_1200"],
        lf_pm_lg=stats["lf"]["pm_pct"],
        lf_err_lg=stats["lf"]["e_pct"],
        lf_arm_lg=arm_per_1200("lf"),

        cf_pa=stats["cf"]["pa_per_1200"],
        cf_pm_lg=stats["cf"]["pm_pct"],
        cf_err_lg=stats["cf"]["e_pct"],
        cf_arm_lg=arm_per_1200("cf"),

        rf_pa=stats["rf"]["pa_per_1200"],
        rf_pm_lg=stats["rf"]["pm_pct"],
        rf_err_lg=stats["rf"]["e_pct"],
        rf_arm_lg=arm_per_1200("rf"),

        ss_dp_pa=stats["ss"]["dp_per_1200"],
    )
