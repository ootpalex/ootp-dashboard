"""
src/pitchers.py — Core batting-against stat pipeline for OOTP pitchers.

Converts pitcher ratings into per-BF stat counts for starters and relievers.

Pipeline per role (SP/RP) per split (vR / vL):
    1. Rating → delta via piecewise linear regression (high/low model split at 50)
    2. Delta + league rate → raw stat count
    3. Park adjustment: always multiplicative (not dual like hitters)
    4. Derived stats: XBH-HR, 3B, 2B, 1B

Phases 1–4:
    Phase 1: Starter classification + pitch counting
    Phase 2: Core batting-against stats (9 stats × 2 splits × 2 roles)
    Phase 3: Stolen base stats (SB%, SBAT, SB, CS per role/split)
    Phase 4: wOBA, RA/9, WAA per role/split + weighted

Dependencies:
    src/data_points.py  — LinearCoeffs, PitcherDataPoints, DEFAULT_PITCHER_DP
    src/ballparks.py    — NormalizedAdjustments
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from src.ballparks import NormalizedAdjustments
from src.data_points import (
    DEFAULT_PITCHER_DP,
    LinearCoeffs,
    PitcherDataPoints,
)
from src.utils import rating_to_delta as _rating_to_delta

# 12 pitch types (excluding knuckleball, handled separately)
_PITCH_TYPES = ["FB", "CH", "CB", "SL", "SI", "SP", "CT", "FO", "CC", "SC", "KC"]
_KN = "KN"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _stu_delta_rp(
    stu_raw: pd.Series, avg: float, coeffs: LinearCoeffs, pos: pd.Series
) -> pd.Series:
    """Compute STU delta for RP section with SP POS bonus.

    SP POS pitchers get STU+5 for the >= 50 threshold check and high-branch
    centering. The low branch always uses raw STU for centering.
    Non-SP POS pitchers use raw STU throughout.
    """
    is_sp_pos = pos.astype(str) == "SP"
    adjusted = pd.Series(
        np.where(is_sp_pos, stu_raw + 5, stu_raw), index=stu_raw.index
    )

    # High branch: centered on adjusted STU
    centered_high = adjusted - avg
    high = coeffs.h_const + coeffs.h_slope * centered_high

    # Low branch: centered on raw STU (always)
    centered_low = stu_raw - avg
    low = coeffs.l_const + coeffs.l_slope * centered_low

    # Threshold: uses adjusted STU
    return pd.Series(np.where(adjusted >= 50, high, low), index=stu_raw.index)


def _safe_col(df: pd.DataFrame, col: str) -> pd.Series:
    """Return column if it exists, otherwise a Series of '-' (dash)."""
    if col in df.columns:
        return df[col]
    return pd.Series("-", index=df.index)


# ---------------------------------------------------------------------------
# Phase 1: Pitch counting + starter classification
# ---------------------------------------------------------------------------


def _clean_hld(players: pd.DataFrame) -> pd.Series:
    """Replace '-' with 20 in HLD column, convert to numeric."""
    hld = players["HLD"].replace("-", 20)
    return pd.to_numeric(hld, errors="coerce")


def _is_real_pitch(col: pd.Series) -> pd.Series:
    """Return boolean Series: True if the pitch grade represents a real pitch.

    A pitch is real if it has a non-dash, non-NaN, non-zero numeric value.
    After rating blending, dashes become NaN rather than staying as '-',
    so we must check for both.
    """
    numeric = pd.to_numeric(col, errors="coerce")
    return numeric.notna() & (numeric > 0)


def compute_pitch_counts(players: pd.DataFrame) -> pd.DataFrame:
    """Compute pitch count metrics from pitch grade columns.

    Returns DataFrame with columns:
        Pitches    — count of real prospect pitches in repertoire (KN counts as 2)
        SP P Pitch — count of prospect grades strictly > 25 (KN counts as 2)
        SP Pitch   — count of current grades strictly > 25 (KN counts as 2)
    """
    idx = players.index

    # --- Pitches: count of real prospect grades (not dash, NaN, or zero) ---
    pitches = pd.Series(0, index=idx, dtype=int)
    for pt in _PITCH_TYPES:
        col = _safe_col(players, pt + "P")
        pitches = pitches + _is_real_pitch(col).astype(int)
    # KN prospect counts as 2
    kn_p = _safe_col(players, _KN + "P")
    pitches = pitches + _is_real_pitch(kn_p).astype(int) * 2

    # --- SP P Pitch: prospect grades strictly > 25 ---
    sp_p_pitch = pd.Series(0, index=idx, dtype=int)
    for pt in _PITCH_TYPES:
        col = _safe_col(players, pt + "P")
        val = pd.to_numeric(col, errors="coerce")
        sp_p_pitch = sp_p_pitch + (val > 25).astype(int)
    kn_p_val = pd.to_numeric(_safe_col(players, _KN + "P"), errors="coerce")
    sp_p_pitch = sp_p_pitch + (kn_p_val > 25).astype(int) * 2

    # --- SP Pitch: current grades strictly > 25 ---
    sp_pitch = pd.Series(0, index=idx, dtype=int)
    for pt in _PITCH_TYPES:
        col = _safe_col(players, pt)
        val = pd.to_numeric(col, errors="coerce")
        sp_pitch = sp_pitch + (val > 25).astype(int)
    kn_val = pd.to_numeric(_safe_col(players, _KN), errors="coerce")
    sp_pitch = sp_pitch + (kn_val > 25).astype(int) * 2

    return pd.DataFrame(
        {"Pitches": pitches, "SP P Pitch": sp_p_pitch, "SP Pitch": sp_pitch},
        index=idx,
    )


def _starter_gate(sp_pitch: pd.Series, pitches: pd.Series, stm: pd.Series) -> pd.Series:
    """Shared starter logic: pitch repertoire gate AND stamina >= 40."""
    pitch_gate = (
        (sp_pitch >= 3)
        | ((sp_pitch >= 2) & (pitches >= 3))
        | ((sp_pitch >= 1) & (pitches >= 5))
    )
    return pitch_gate & (stm >= 40)


def compute_starter_flag(
    players: pd.DataFrame, pitch_counts: pd.DataFrame
) -> pd.Series:
    """Determine current starter classification using current pitch grades.

    Starter = AND(
        OR(
            SP_Pitch >= 3,
            AND(SP_Pitch >= 2, Pitches >= 3),
            AND(SP_Pitch >= 1, Pitches >= 5)
        ),
        STM >= 40
    )

    Note: The original spreadsheet uses SP P Pitch (potential grades) for
    both Starter and Starter P. We fix this so Starter uses current grades
    (SP Pitch) — see model/docs/internal/archive/KNOWN_BUGS.md.

    Returns:
        Boolean Series: True = starter, False = reliever.
    """
    stm = pd.to_numeric(players["STM"], errors="coerce")
    return _starter_gate(pitch_counts["SP Pitch"], pitch_counts["Pitches"], stm)


def compute_starter_potential(
    players: pd.DataFrame, pitch_counts: pd.DataFrame
) -> pd.Series:
    """Determine potential starter classification using potential pitch grades.

    Same formula as ``compute_starter_flag`` but uses SP P Pitch (potential
    grades) instead of SP Pitch (current grades).

    Returns:
        Boolean Series: True = potential starter, False = potential reliever.
    """
    stm = pd.to_numeric(players["STM"], errors="coerce")
    return _starter_gate(pitch_counts["SP P Pitch"], pitch_counts["Pitches"], stm)


# ---------------------------------------------------------------------------
# Phase 2: Core batting-against stats
# ---------------------------------------------------------------------------


def _compute_park_mults(
    park_adj: NormalizedAdjustments,
    home_fraction: float,
    split: str,
) -> tuple[float, float, float, float]:
    """Compute 4 multiplicative park factors for one split.

    Args:
        park_adj: Normalized adjustments for the selected team.
        home_fraction: Fraction of games at home.
        split: 'vR' or 'vL' (batter hand).

    Returns:
        (hr_park, ba_park, d_park, t_park)
    """
    if split == "vR":
        hr_raw = park_adj.hr_rh
        ba_raw = park_adj.ba_rh
    else:
        hr_raw = park_adj.hr_lh
        ba_raw = park_adj.ba_lh

    hr_park = 1.0 + (hr_raw - 1.0) * home_fraction
    ba_park = 1.0 + (ba_raw - 1.0) * home_fraction
    d_park = 1.0 + (park_adj.pf_d_adj - 1.0) * home_fraction
    t_park = 1.0 + (park_adj.pf_t_adj - 1.0) * home_fraction

    return hr_park, ba_park, d_park, t_park


def _compute_batting_split(
    players: pd.DataFrame,
    split: str,
    con_coeffs: LinearCoeffs,
    hrr_coeffs: LinearCoeffs,
    stu_coeffs: LinearCoeffs,
    babip_coeffs: LinearCoeffs,
    avg_con: float,
    avg_hrr: float,
    avg_stu: float,
    avg_pbabip: float,
    bf: float,
    hbp_rate: float,
    bb_rate: float,
    so_rate: float,
    hr_rate: float,
    babip_rate: float,
    xbh_rate: float,
    triple_rate: float,
    hr_park: float,
    ba_park: float,
    d_park: float,
    t_park: float,
    is_sp: bool,
) -> pd.DataFrame:
    """Compute 9 batting-against stats for one role+split.

    Args:
        players: Player DataFrame.
        split: 'vR' or 'vL'.
        con_coeffs..babip_coeffs: Regression coefficients for this role.
        avg_*: Rating averages for this role.
        bf: Batters faced (800 SP / 300 RP).
        *_rate: League stat rates for this role.
        *_park: Multiplicative park factors for this split.
        is_sp: If True, this is the SP section (STU-5 penalty applies to non-SP POS).

    Returns:
        DataFrame with 9 columns (HBP, uBB, SO, HR, H-HR, XBH-HR, 3B, 2B, 1B).
    """
    # Read rating columns — pitcher control is "PCON" (renamed from CON.1)
    # PCON may contain '-' values; Excel substitutes '-' with 20 (same as HLD)
    con_r = pd.to_numeric(
        players[f"PCON {split}"].replace("-", 20), errors="coerce"
    )
    hrr_r = pd.to_numeric(players[f"HRR {split}"], errors="coerce")
    pbabip_r = pd.to_numeric(players[f"PBABIP {split}"], errors="coerce")
    stu_r = pd.to_numeric(players[f"STU {split}"], errors="coerce")

    # STU adjustment by POS column:
    #   SP section: non-SP POS → STU-5 (applied to threshold AND both branches)
    #   RP section: SP POS → STU+5 for threshold/high branch, raw STU for low branch
    if is_sp:
        pos = players["POS"].astype(str)
        stu_r = pd.Series(
            np.where(pos == "SP", stu_r, stu_r - 5),
            index=players.index,
        )

    # Compute deltas
    con_delta = _rating_to_delta(con_r, avg_con, con_coeffs)
    hrr_delta = _rating_to_delta(hrr_r, avg_hrr, hrr_coeffs)

    if not is_sp:
        # RP section: SP POS gets STU+5 for threshold check and high-branch delta,
        # but the low branch always uses raw STU
        stu_delta = _stu_delta_rp(stu_r, avg_stu, stu_coeffs, players["POS"])
    else:
        stu_delta = _rating_to_delta(stu_r, avg_stu, stu_coeffs)

    babip_delta = _rating_to_delta(pbabip_r, avg_pbabip, babip_coeffs)

    # Stat pipeline
    hbp = pd.Series(hbp_rate * bf, index=players.index)
    ubb = ((con_delta + bb_rate) * (bf - hbp)).clip(lower=0)
    so = ((stu_delta + so_rate) * (bf - ubb - hbp)).clip(lower=0)
    hr = ((hrr_delta + hr_rate) * (bf - ubb - hbp) * hr_park).clip(lower=0)
    bip = bf - hbp - ubb - so - hr
    hmhr = ((babip_delta + babip_rate) * bip * ba_park).clip(lower=0)
    xbh = hmhr * xbh_rate * d_park
    triple = xbh * triple_rate * t_park
    double = xbh - triple
    single = hmhr - xbh

    return pd.DataFrame(
        {
            "HBP": hbp,
            "uBB": ubb,
            "SO": so,
            "HR": hr,
            "H-HR": hmhr,
            "XBH-HR": xbh,
            "3B": triple,
            "2B": double,
            "1B": single,
        },
        index=players.index,
    )


def _compute_sb_stats(
    result: pd.DataFrame,
    splits: dict[str, pd.DataFrame],
    hld: pd.Series,
    sb_pct_coeffs,
    sba_coeffs,
    avg_hld: float,
    lg_sb_pct: float,
    lg_sba_rate: float,
    role: str,
) -> pd.Series:
    """Compute SB%, SBAT, SB, CS and write into result. Returns SB% series."""
    is_sp = role == "SP"

    # SB% — cubic polynomial in HLD (one value per role, not split by hand)
    sb_pct_poly = sb_pct_coeffs.c0 + sb_pct_coeffs.c1 * (hld - avg_hld)
    sb_pct = (sb_pct_poly + lg_sb_pct).clip(upper=1.0)

    # SBA rate — cubic polynomial in HLD
    sba_poly = sba_coeffs.c0 + sba_coeffs.c1 * (hld - avg_hld)
    sba_rate = sba_poly + lg_sba_rate

    sb_suffix = " SP" if is_sp else " RP"
    result[f"SB%{sb_suffix}"] = sb_pct

    for split in ["vR", "vL"]:
        s = splits[split]
        on_first = s["1B"] + s["uBB"] + s["HBP"]
        sbat = (sba_rate * on_first).clip(lower=0)
        sb = sb_pct * sbat
        cs = sbat - sb

        suffix = f" {split}" if is_sp else f" {split} RP"
        result[f"SBAT{suffix}"] = sbat
        result[f"SB{suffix}"] = sb
        result[f"CS{suffix}"] = cs

    return sb_pct


def _compute_performance(
    result: pd.DataFrame,
    splits: dict[str, pd.DataFrame],
    vr_frac: pd.Series,
    vl_frac: pd.Series,
    bf: float,
    woba_ratio: float,
    wt_hbp: float,
    wt_bb: float,
    wt_1b: float,
    wt_2b: float,
    wt_3b: float,
    wt_hr: float,
    wt_sb: float,
    wt_cs: float,
    woba_norm: float,
    ra9_base: float,
    ra9_repl: float,
    ip: float,
    waa_const: float,
    role: str,
) -> None:
    """Compute wOBA, RA/9, WAA, WAR per split + weighted and write into result.

    WAA uses ra9_base (league-average baseline); WAR uses ra9_repl
    (replacement-level baseline). WAR exceeds WAA by a constant per role
    (~1.5 wins for SP, ~0.5 wins for RP at full-time IP).
    """
    is_sp = role == "SP"

    woba_splits = {}
    for split in ["vR", "vL"]:
        s = splits[split]
        suffix = f" {split}" if is_sp else f" {split} RP"

        sb_col = result[f"SB{suffix}"]
        cs_col = result[f"CS{suffix}"]

        numerator = (
            wt_hbp * s["HBP"]
            + wt_bb * s["uBB"]
            + wt_1b * s["1B"]
            + wt_2b * s["2B"]
            + wt_3b * s["3B"]
            + wt_hr * s["HR"]
            + wt_sb * sb_col
            + wt_cs * cs_col
        )
        woba = numerator / bf / woba_ratio
        ra9 = (woba / woba_norm) ** 2 * ra9_base
        waa = (ra9_base - ra9) * (ip / 9.0) / waa_const
        war = (ra9_repl - ra9) * (ip / 9.0) / waa_const

        result[f"wOBA{suffix}"] = woba
        result[f"RA9{suffix}"] = ra9
        result[f"WAA{suffix}"] = waa
        result[f"WAR{suffix}"] = war
        woba_splits[split] = woba

    # Weighted wOBA → RA/9 → WAA/WAR (computed from weighted wOBA, not averaged)
    woba_wtd = woba_splits["vL"] * vl_frac + woba_splits["vR"] * vr_frac
    ra9_wtd = (woba_wtd / woba_norm) ** 2 * ra9_base
    waa_wtd = (ra9_base - ra9_wtd) * (ip / 9.0) / waa_const
    war_wtd = (ra9_repl - ra9_wtd) * (ip / 9.0) / waa_const

    suffix_wtd = " wtd" if is_sp else " wtd RP"
    result[f"wOBA{suffix_wtd}"] = woba_wtd
    result[f"RA9{suffix_wtd}"] = ra9_wtd
    result[f"WAA{suffix_wtd}"] = waa_wtd
    result[f"WAR{suffix_wtd}"] = war_wtd


def compute_pitcher_batting(
    players: pd.DataFrame,
    park_adj: NormalizedAdjustments,
    home_fraction: float,
    dp: PitcherDataPoints = DEFAULT_PITCHER_DP,
    woba_ratio: float = 1.0,
) -> pd.DataFrame:
    """Compute batting-against stats for all pitchers.

    For each role (SP/RP) and split (vR/vL), computes:
        Phase 2: 9 batting-against stats (HBP, uBB, SO, HR, H-HR, XBH-HR, 3B, 2B, 1B)
        Phase 3: Stolen base stats (SB%, SBAT, SB, CS)
        Phase 4: wOBA, RA/9, WAA, WAR

    Weighted stats are computed by pitcher throwing hand (T column) using
    pitcher-side matchup splits (rvr/lvr/svr).

    Args:
        players: Player DataFrame with pitcher rating columns.
        park_adj: Normalized park factor adjustments for the selected team.
        home_fraction: Fraction of games at home (typically 0.5).
        dp: Pitcher data points with regression coefficients and league params.
        woba_ratio: Raw park-specific wOBA ratio (from ParkDeltas), default 1.0.
            Internally adjusted for home_fraction: adj = 1 + (ratio-1)*hf.

    Returns:
        DataFrame with 86 columns:
            Per role (SP/RP): 9 batting × 2 splits + 9 batting wtd
                            + 7 SB (1 SB% + 3 per split)
                            + 9 perf (3 per split + 3 wtd)
            = (27 + 7 + 9) × 2 = 86
    """
    lp = dp.league
    reg = dp.pitching
    stat_names = ["HBP", "uBB", "SO", "HR", "H-HR", "XBH-HR", "3B", "2B", "1B"]

    # Adjust woba_ratio for home_fraction (Ballparks!AA37)
    woba_ratio_adj = 1.0 + (woba_ratio - 1.0) * home_fraction

    # HLD for stolen base polynomials
    hld = _clean_hld(players)

    result = pd.DataFrame(index=players.index)

    for role in ["SP", "RP"]:
        is_rp = role == "RP"
        is_sp = role == "SP"

        # Select role-specific constants
        if is_sp:
            con_coeffs, hrr_coeffs = reg.sp_con, reg.sp_hrr
            stu_coeffs, babip_coeffs = reg.sp_stu, reg.sp_babip
            avg_con, avg_hrr = lp.avg_con_sp, lp.avg_hrr_sp
            avg_stu, avg_pbabip = lp.avg_stu_sp, lp.avg_pbabip_sp
            bf = lp.bf_sp
            hbp_rate, bb_rate = lp.sp_hbp_rate, lp.sp_bb_rate
            so_rate, hr_rate = lp.sp_so_rate, lp.sp_hr_rate
            babip_rate, xbh_rate = lp.sp_babip, lp.sp_xbh_rate
            triple_rate = lp.sp_triple_rate
            avg_hld, lg_sb_pct, lg_sba_rate = lp.avg_hld_sp, lp.sp_sb_pct, lp.sp_sba_rate
            sb_pct_coeffs = reg.sp_sb_pct
            wt_hbp, wt_bb = lp.sp_wt_hbp, lp.sp_wt_bb
            wt_1b, wt_2b, wt_3b = lp.sp_wt_1b, lp.sp_wt_2b, lp.sp_wt_3b
            wt_hr, wt_sb, wt_cs = lp.sp_wt_hr, lp.sp_wt_sb, lp.sp_wt_cs
            woba_norm, ra9_base, ip = lp.woba_norm_sp, lp.ra9_sp, lp.ip_sp
            ra9_repl = lp.ra9_repl_sp
        else:
            con_coeffs, hrr_coeffs = reg.rp_con, reg.rp_hrr
            stu_coeffs, babip_coeffs = reg.rp_stu, reg.rp_babip
            avg_con, avg_hrr = lp.avg_con_rp, lp.avg_hrr_rp
            avg_stu, avg_pbabip = lp.avg_stu_rp, lp.avg_pbabip_rp
            bf = lp.bf_rp
            hbp_rate, bb_rate = lp.rp_hbp_rate, lp.rp_bb_rate
            so_rate, hr_rate = lp.rp_so_rate, lp.rp_hr_rate
            babip_rate, xbh_rate = lp.rp_babip, lp.rp_xbh_rate
            triple_rate = lp.rp_triple_rate
            avg_hld, lg_sb_pct, lg_sba_rate = lp.avg_hld_rp, lp.rp_sb_pct, lp.rp_sba_rate
            sb_pct_coeffs = reg.rp_sb_pct
            wt_hbp, wt_bb = lp.rp_wt_hbp, lp.rp_wt_bb
            wt_1b, wt_2b, wt_3b = lp.rp_wt_1b, lp.rp_wt_2b, lp.rp_wt_3b
            wt_hr, wt_sb, wt_cs = lp.rp_wt_hr, lp.rp_wt_sb, lp.rp_wt_cs
            woba_norm, ra9_base, ip = lp.woba_norm_rp, lp.ra9_rp, lp.ip_rp
            ra9_repl = lp.ra9_repl_rp

        # Phase 2: Core batting-against stats per split
        splits = {}
        for split in ["vR", "vL"]:
            hr_park, ba_park, d_park, t_park = _compute_park_mults(
                park_adj, home_fraction, split
            )
            split_df = _compute_batting_split(
                players, split,
                con_coeffs, hrr_coeffs, stu_coeffs, babip_coeffs,
                avg_con, avg_hrr, avg_stu, avg_pbabip,
                bf, hbp_rate, bb_rate, so_rate, hr_rate,
                babip_rate, xbh_rate, triple_rate,
                hr_park, ba_park, d_park, t_park, is_sp,
            )
            splits[split] = split_df

            suffix = f" {split}" if is_sp else f" {split} RP"
            for stat in stat_names:
                result[f"{stat}{suffix}"] = split_df[stat]

        # Handedness weighting by pitcher throwing hand (T column)
        throws = players["T"].astype(str)
        vr_frac = throws.map({"R": lp.rvr, "L": lp.lvr, "S": lp.svr}).astype(float)
        vl_frac = 1.0 - vr_frac

        suffix_wtd = " wtd" if is_sp else " wtd RP"
        for stat in stat_names:
            result[f"{stat}{suffix_wtd}"] = (
                splits["vL"][stat] * vl_frac + splits["vR"][stat] * vr_frac
            )

        # Phase 3: Stolen base stats
        _compute_sb_stats(
            result, splits, hld,
            sb_pct_coeffs, reg.sba,
            avg_hld, lg_sb_pct, lg_sba_rate, role,
        )

        # Phase 4: wOBA, RA/9, WAA, WAR
        _compute_performance(
            result, splits, vr_frac, vl_frac,
            bf, woba_ratio_adj,
            wt_hbp, wt_bb, wt_1b, wt_2b, wt_3b, wt_hr, wt_sb, wt_cs,
            woba_norm, ra9_base, ra9_repl, ip, lp.waa_const, role,
        )

    return result
