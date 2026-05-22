"""Pitching calc pipeline — produces ``PitcherLeagueParams``.

Aggregates raw pitching counting stats (overall + SP/RP splits) and
BF-weighted pitcher rating averages to derive league-side pitching constants.
The RP wOBA weights are normalized to the SP scale so SP and RP wOBA values
are directly comparable.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.aggregators._shared import (
    _compute_woba_from_aggregates,
    _pa_fractions_by_hand,
    _weighted_mean,
    compute_runs_per_win,
)
from src.data_points import FG_REPL_WPG_RP, FG_REPL_WPG_SP, PitcherLeagueParams


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


def _build_virtual_role_frames(
    pr_vr: pd.DataFrame,
    pr_vl: pd.DataFrame,
    sp_data: pd.DataFrame,
    rp_data: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Reconstruct legacy per-role rating frames from the 2-file combined format.

    The combined ``pitcher_ratings_vr/vl`` files carry both-side rating columns
    (``STU vR``/``STU vL`` …) plus ``POS``; the two files differ only in ``BF``
    (RH-faced vs LH-faced). Returns ``(sp_vr, sp_vl, rp_vr, rp_vl)`` each with the
    legacy columns (``ID, BF, T, STU, HRR, PBABIP, CON, HLD``) so the existing
    ``_compute_rating_averages_pitching`` / ``_compute_matchup_splits_pitching``
    consume them unchanged.

    Two transforms make this faithful to the player-eval pipeline:
    - **Proportional role weighting** — each pitcher's per-hand BF is scaled by
      their starter fraction ``sp_BF / (sp_BF + rp_BF)`` (from sp_data/rp_data) for
      the SP frames and ``1 − fraction`` for the RP frames, so a swingman splits
      across both roles and other-role BF never enters a role average.
    - **±5 STU role conversion** — keyed on POS, mirroring ``pitchers.py``: the SP
      frames use ``STU − 5`` for non-SP-POS pitchers, the RP frames ``STU + 5`` for
      SP-POS pitchers. Only STU converts; HRR/PBABIP/CON/HLD are role-independent.
    """
    ids = pr_vr["ID"]
    pos = pr_vr["POS"].astype(str).to_numpy()
    throws = pr_vr["T"].to_numpy()
    is_sp_pos = pos == "SP"

    # Per-pitcher starter fraction from role-specific BF (both hands). Pitchers
    # absent from a role's data file contribute 0 BF there; a pitcher in neither
    # falls back to their POS listing.
    sp_bf = pd.to_numeric(sp_data.set_index("ID")["BF"], errors="coerce").reindex(ids).fillna(0.0).to_numpy()
    rp_bf = pd.to_numeric(rp_data.set_index("ID")["BF"], errors="coerce").reindex(ids).fillna(0.0).to_numpy()
    role_total = sp_bf + rp_bf
    starter_frac = np.where(role_total > 0, np.divide(sp_bf, role_total, where=role_total > 0),
                            is_sp_pos.astype(float))

    # Per-hand BF from the ratings files (vl aligned to vr's ID order).
    bf_vr = pd.to_numeric(pr_vr["BF"], errors="coerce").to_numpy()
    bf_vl = pd.to_numeric(pr_vl.set_index("ID")["BF"], errors="coerce").reindex(ids).fillna(0.0).to_numpy()

    def _frame(side: str, role: str) -> pd.DataFrame:
        bf_side = bf_vr if side == "vR" else bf_vl
        role_w = starter_frac if role == "sp" else (1.0 - starter_frac)
        stu = pd.to_numeric(pr_vr[f"STU {side}"], errors="coerce").to_numpy()
        stu_conv = (np.where(is_sp_pos, stu, stu - 5) if role == "sp"
                    else np.where(is_sp_pos, stu + 5, stu))
        return pd.DataFrame({
            "ID": ids.to_numpy(),
            "BF": bf_side * role_w,
            "T": throws,
            "STU": stu_conv,
            "HRR": pd.to_numeric(pr_vr[f"HRR {side}"], errors="coerce").to_numpy(),
            "PBABIP": pd.to_numeric(pr_vr[f"PBABIP {side}"], errors="coerce").to_numpy(),
            "CON": pd.to_numeric(pr_vr[f"CON {side}"], errors="coerce").to_numpy(),
            "HLD": pd.to_numeric(pr_vr["HLD"], errors="coerce").to_numpy(),
        })

    return _frame("vR", "sp"), _frame("vL", "sp"), _frame("vR", "rp"), _frame("vL", "rp")


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

    # --- Pitcher rating frames ---
    # New 2-file combined format → reconstruct legacy per-role frames (proportional
    # role weighting + ±5 STU conversion). Legacy 4-file format → use the per-role
    # files directly (byte-identical to pre-redesign behavior).
    if inputs.pitcher_ratings_vr is not None:
        sp_vr, sp_vl, rp_vr, rp_vl = _build_virtual_role_frames(
            inputs.pitcher_ratings_vr, inputs.pitcher_ratings_vl,
            inputs.sp_data, inputs.rp_data)
    else:
        sp_vr, sp_vl = inputs.sp_ratings_vr, inputs.sp_ratings_vl
        rp_vr, rp_vl = inputs.rp_ratings_vr, inputs.rp_ratings_vl

    # --- Matchup splits ---
    p_splits = _compute_matchup_splits_pitching(sp_vr, sp_vl, rp_vr, rp_vl)

    # --- Rating averages ---
    sp_rating_avgs = _compute_rating_averages_pitching(sp_vr, sp_vl, p_splits["sp_ovr_vr"])
    rp_rating_avgs = _compute_rating_averages_pitching(rp_vr, rp_vl, p_splits["rp_ovr_vr"])

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
    waa_const = compute_runs_per_win(inputs.pitching_data)

    # --- WAR replacement-level RA/9 (FG-calibrated, scaled by this league) ---
    # Replacement = a fixed standard (FG: 0.12 W/9IP starters, 0.03 relievers)
    # applied with THIS league's runs-per-win, so the replacement RA/9 offset is
    # WPG * waa_const (the IP/9 cancels). Recomputed per league here so it tracks
    # each league's run environment instead of using a stale hardcoded baseline.
    ra9_repl_sp = ra9_sp + FG_REPL_WPG_SP * waa_const
    ra9_repl_rp = ra9_rp + FG_REPL_WPG_RP * waa_const

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

        # RA/9 replacement baselines (FG 0.12/0.03 W·9IP × this league's RPW)
        ra9_repl_sp=ra9_repl_sp,
        ra9_repl_rp=ra9_repl_rp,

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
