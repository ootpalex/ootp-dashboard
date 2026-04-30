"""Pitching calc pipeline — produces ``PitcherLeagueParams``.

Aggregates raw pitching counting stats (overall + SP/RP splits) and
BF-weighted pitcher rating averages to derive league-side pitching constants.
The RP wOBA weights are normalized to the SP scale so SP and RP wOBA values
are directly comparable.
"""
from __future__ import annotations

import pandas as pd

from src.aggregators._shared import (
    _compute_woba_from_aggregates,
    _pa_fractions_by_hand,
    _weighted_mean,
)
from src.data_points import PitcherLeagueParams


def _aggregate_pitching(df: pd.DataFrame) -> dict:
    """Sum counting stats from a pitching data table."""
    # Pitching uses BF instead of PA, K instead of SO
    agg = {}
    col_map = {
        "R": "R", "BF": "BF", "AB": "AB", "1B": "1B", "2B": "2B",
        "3B": "3B", "HR": "HR", "BB": "BB", "HP": "HP", "IBB": "IBB",
        "SH": "SH", "SF": "SF", "SB": "SB", "CS": "CS", "DP": "DP",
        "K": "K", "IP Clean": "IP Clean",
    }
    for key, col in col_map.items():
        if col in df.columns:
            agg[key] = pd.to_numeric(df[col], errors="coerce").sum()

    # Map to the keys expected by _compute_woba_from_aggregates
    agg["PA"] = agg.get("BF", 0)
    agg["SO"] = agg.get("K", 0)
    # Outs = AB - (1B+2B+3B+HR) + DP + CS + SH + SF
    agg["Outs"] = (agg["AB"] - (agg["1B"] + agg["2B"] + agg["3B"] + agg["HR"])
                   + agg.get("DP", 0) + agg.get("CS", 0) + agg.get("SH", 0)
                   + agg.get("SF", 0))

    return agg


def _compute_matchup_splits_pitching(
    sp_vr: pd.DataFrame, sp_vl: pd.DataFrame,
    rp_vr: pd.DataFrame, rp_vl: pd.DataFrame,
) -> dict:
    """Compute pitcher-side matchup splits from separate vR/vL rating files.

    Each file has columns: ID, BF, T, STU, HRR, PBABIP, CON, HLD.
    vR files have BF = batters faced who bat RH; vL = batters faced who bat LH.
    """
    result = {}
    for label, vr_section, vl_section in [("sp", sp_vr, sp_vl), ("rp", rp_vr, rp_vl)]:
        section = _pa_fractions_by_hand(
            vr_section, vl_section,
            weight_col="BF", hand_col="T",
            hands=[("L", "lvr"), ("R", "rvr")],
        )
        for key, value in section.items():
            result[f"{label}_{key}"] = value
    return result


def _compute_rating_averages_pitching(
    ratings_vr: pd.DataFrame, ratings_vl: pd.DataFrame, ovr_vr: float
) -> dict:
    """Compute BF-weighted rating averages for pitchers.

    Each file has columns: ID, BF, T, STU, HRR, PBABIP, CON, HLD.
    The vR file has ratings when facing RH batters; vL when facing LH batters.
    """
    # Split-specific (STU/HRR/PBABIP/CON) + universal (HLD) ratings.
    rating_cols = {"stu": "STU", "hrr": "HRR", "pbabip": "PBABIP", "con": "CON",
                   "hld": "HLD"}

    def avgs(df: pd.DataFrame) -> dict:
        out = {}
        for name, col in rating_cols.items():
            if col in df.columns:
                out[name] = _weighted_mean(df["BF"], df[col])
        return out

    vr_avgs = avgs(ratings_vr)
    vl_avgs = avgs(ratings_vl)

    return {
        name: vr_avgs[name] * ovr_vr + vl_avgs.get(name, vr_avgs[name]) * (1.0 - ovr_vr)
        for name in vr_avgs
    }


def compute_pitching_constants(inputs) -> PitcherLeagueParams:
    """Compute all PitcherLeagueParams from pitching data + ratings."""

    # --- SP section: uses SP Data for wOBA weights ---
    sp_agg = _aggregate_pitching(inputs.sp_data)
    sp_woba = _compute_woba_from_aggregates(sp_agg, is_pitching=True)

    # --- RP section: uses RP Data for run values, but SP normalization for wOBA weights ---
    rp_agg = _aggregate_pitching(inputs.rp_data)
    rp_woba_raw = _compute_woba_from_aggregates(rp_agg, is_pitching=True)

    # RP wOBA weights use (RP_run_value + SP_runs_minus) × SP_woba_scale
    # This provides a consistent normalization baseline from the SP (overall) section.
    rp_woba = dict(rp_woba_raw)
    sp_runs_minus = sp_woba["runs_minus"]
    sp_scale = sp_woba["woba_scale"]
    for event in ["bb", "hbp", "1b", "2b", "3b", "hr"]:
        rp_woba[f"wt_{event}"] = (rp_woba_raw[f"run_{event}"] + sp_runs_minus) * sp_scale
    rp_woba["wt_sb"] = rp_woba_raw["run_sb"] * sp_scale
    rp_woba["wt_cs"] = rp_woba_raw["run_cs"] * sp_scale
    # NOTE: rp_woba["woba_scale"] keeps the RP's OWN scale for PitcherLeagueParams.

    # Recompute RP lg_woba with the SP-normalized weights
    BB = rp_agg["BB"]
    IBB = rp_agg["IBB"]
    HP = rp_agg["HP"]
    AB = rp_agg["AB"]
    SF = rp_agg["SF"]
    s1B = rp_agg["1B"]
    s2B = rp_agg["2B"]
    s3B = rp_agg["3B"]
    HR = rp_agg["HR"]
    rp_num = ((BB - IBB) * rp_woba["wt_bb"] + HP * rp_woba["wt_hbp"]
              + s1B * rp_woba["wt_1b"] + s2B * rp_woba["wt_2b"]
              + s3B * rp_woba["wt_3b"] + HR * rp_woba["wt_hr"])
    rp_den = AB + (BB - IBB) + HP + SF
    rp_woba["lg_woba"] = rp_num / rp_den if rp_den > 0 else 0.0

    # --- Matchup splits ---
    p_splits = _compute_matchup_splits_pitching(
        inputs.sp_ratings_vr, inputs.sp_ratings_vl,
        inputs.rp_ratings_vr, inputs.rp_ratings_vl)

    # --- Rating averages ---
    sp_rating_avgs = _compute_rating_averages_pitching(
        inputs.sp_ratings_vr, inputs.sp_ratings_vl, p_splits["sp_ovr_vr"])
    rp_rating_avgs = _compute_rating_averages_pitching(
        inputs.rp_ratings_vr, inputs.rp_ratings_vl, p_splits["rp_ovr_vr"])

    # --- Workload (overall pitching data drives BF/IP ratio) ---
    overall_ip = pd.to_numeric(inputs.pitching_data["IP Clean"], errors="coerce").sum()
    overall_bf = pd.to_numeric(inputs.pitching_data["BF"], errors="coerce").sum()
    overall_r = pd.to_numeric(inputs.pitching_data["R"], errors="coerce").sum()
    bf_per_ip = overall_bf / overall_ip if overall_ip > 0 else 0.0

    ip_sp = 800.0 / bf_per_ip
    ip_rp = 300.0 / bf_per_ip

    # --- RA/9 baselines ---
    sp_ip = pd.to_numeric(inputs.sp_data["IP Clean"], errors="coerce").sum()
    rp_ip = pd.to_numeric(inputs.rp_data["IP Clean"], errors="coerce").sum()
    sp_r = pd.to_numeric(inputs.sp_data["R"], errors="coerce").sum()
    rp_r = pd.to_numeric(inputs.rp_data["R"], errors="coerce").sum()
    ra9_sp = sp_r / sp_ip * 9 if sp_ip > 0 else 0.0
    ra9_rp = rp_r / rp_ip * 9 if rp_ip > 0 else 0.0

    # --- WAA constant: RPW = lg_RA/9 × 1.5 + 3 (FanGraphs formula) ---
    lg_ra9 = overall_r / overall_ip * 9 if overall_ip > 0 else 0.0
    waa_const = lg_ra9 * 1.5 + 3.0

    pitcher_r_per_pa = overall_r / overall_bf if overall_bf > 0 else 0.0

    return PitcherLeagueParams(
        # SP rating averages
        avg_stu_sp=sp_rating_avgs["stu"],
        avg_hrr_sp=sp_rating_avgs["hrr"],
        avg_pbabip_sp=sp_rating_avgs["pbabip"],
        avg_con_sp=sp_rating_avgs["con"],

        # RP rating averages
        avg_stu_rp=rp_rating_avgs["stu"],
        avg_hrr_rp=rp_rating_avgs["hrr"],
        avg_pbabip_rp=rp_rating_avgs["pbabip"],
        avg_con_rp=rp_rating_avgs["con"],

        # Pitcher matchup splits (use SP values for the main params)
        lvr=p_splits["sp_lvr"],
        rvr=p_splits["sp_rvr"],
        svr=p_splits["sp_ovr_vr"],  # SvR uses OVR for pitchers
        ovr_vr=p_splits["sp_ovr_vr"],

        # Workload
        bf_sp=800.0,
        bf_rp=300.0,
        ip_sp=ip_sp,
        ip_rp=ip_rp,

        # RA/9 baselines
        ra9_sp=ra9_sp,
        ra9_rp=ra9_rp,

        # HLD baselines
        avg_hld_sp=sp_rating_avgs.get("hld", 55.96),
        avg_hld_rp=rp_rating_avgs.get("hld", 53.82),

        # wOBA normalization
        woba_norm_sp=sp_woba["lg_woba"],
        woba_norm_rp=rp_woba["lg_woba"],

        # SP wOBA weights
        sp_lg_woba=sp_woba["lg_woba"],
        sp_wt_hbp=sp_woba["wt_hbp"],
        sp_wt_bb=sp_woba["wt_bb"],
        sp_wt_1b=sp_woba["wt_1b"],
        sp_wt_2b=sp_woba["wt_2b"],
        sp_wt_3b=sp_woba["wt_3b"],
        sp_wt_hr=sp_woba["wt_hr"],
        sp_wt_sb=sp_woba["wt_sb"],
        sp_wt_cs=sp_woba["wt_cs"],
        sp_woba_scale=sp_woba["woba_scale"],

        # RP wOBA weights
        rp_lg_woba=rp_woba["lg_woba"],
        rp_wt_hbp=rp_woba["wt_hbp"],
        rp_wt_bb=rp_woba["wt_bb"],
        rp_wt_1b=rp_woba["wt_1b"],
        rp_wt_2b=rp_woba["wt_2b"],
        rp_wt_3b=rp_woba["wt_3b"],
        rp_wt_hr=rp_woba["wt_hr"],
        rp_wt_sb=rp_woba["wt_sb"],
        rp_wt_cs=rp_woba["wt_cs"],
        rp_woba_scale=rp_woba["woba_scale"],

        # SP league stat rates
        sp_hbp_rate=sp_woba["hbp_rate"],
        sp_bb_rate=sp_woba["bb_rate"],
        sp_hr_rate=sp_woba["hr_rate"],
        sp_so_rate=sp_woba["so_rate"],
        sp_babip=sp_woba["babip"],
        sp_xbh_rate=sp_woba["xbh_rate"],
        sp_triple_rate=sp_woba["triple_rate"],
        sp_sb_pct=sp_woba["sb_pct"],
        sp_sba_rate=sp_woba["sba_rate"],

        # RP league stat rates
        rp_hbp_rate=rp_woba["hbp_rate"],
        rp_bb_rate=rp_woba["bb_rate"],
        rp_hr_rate=rp_woba["hr_rate"],
        rp_so_rate=rp_woba["so_rate"],
        rp_babip=rp_woba["babip"],
        rp_xbh_rate=rp_woba["xbh_rate"],
        rp_triple_rate=rp_woba["triple_rate"],
        rp_sb_pct=rp_woba["sb_pct"],
        rp_sba_rate=rp_woba["sba_rate"],

        # Other pitcher-specific constants
        run_cs=sp_woba["run_cs"],
        wsb=sp_woba["lg_wsb"],
        waa_const=waa_const,
        r_per_pa=pitcher_r_per_pa,
    )
