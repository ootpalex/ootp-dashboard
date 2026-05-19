"""
src/hitters.py — Core batting and baserunning stat pipeline for OOTP hitters.

Converts player ratings into per-PA stat counts, wOBA, BatR, and baserunning runs.

Pipeline per split (vR / vL):
    1. Rating → delta via piecewise linear regression (high/low model split at 50)
    2. Delta + league rate → raw stat count
    3. Park adjustment (stat-dependent — see below)
    4. Derived stats: OBP, wOBA (park-normalized), BatR
    5. Baserunning: SB%, SBAT, SB, CS, wSB, UBR, BSR

Park factor models (from Excel Hitters sheet formulas):
    - HR:     always multiplicative (no additive model)
    - H-HR:   dual — additive (BA ≥ 50) or multiplicative (BA < 50)
    - XBH-HR: dual — additive (GAP ≥ 50) or multiplicative (GAP < 50)
    - 3B:     dual — additive (SPE ≥ 50) or multiplicative (SPE < 50)
    - wOBA:   divided by park-adjusted woba_ratio (park normalization)

Special regression note:
    XBH-HR uses the SAME regression coefficients (h_const/h_slope) for both
    the high and low park models. 3B and H-HR use separate h/l coefficients.

DH computation:
    DH wOBA uses the park-adjusted counting stats (not recomputed) with a
    0.98 discount on non-HR weighted sum and SO*0.02 PA adjustment, then
    divides by woba_ratio.

Dependencies:
    src/data_points.py  — LinearCoeffs, HitterDataPoints, DEFAULT_HITTER_DP
    src/ballparks.py    — ParkDeltas, NormalizedAdjustments, BallparksTable
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from src.ballparks import NormalizedAdjustments, ParkDeltas
from src.data_points import (
    DEFAULT_HITTER_DP,
    FieldingParams,
    FieldingRegressionCoeffs,
    HitterDataPoints,
    LinearCoeffs,
)
from src.utils import rating_to_delta as _rating_to_delta
from src.constants import (
    HITTER_BIG3_COLS as _HITTER_BIG3_COLS,
    PITCHER_RATING_COLS as _PITCHER_RATING_COLS,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _dual_park(
    base_stat: pd.Series,
    rating: pd.Series,
    additive_delta: float,
    mult_factor,
) -> pd.Series:
    """Dual park factor model: additive (rating >= 50) or multiplicative (< 50).

    HIGH model (rating >= 50): base_stat + additive_delta
    LOW  model (rating <  50): base_stat * mult_factor
    """
    high = base_stat + additive_delta
    low = base_stat * mult_factor
    return pd.Series(np.where(rating >= 50, high, low), index=base_stat.index)


# ---------------------------------------------------------------------------
# Core split computation
# ---------------------------------------------------------------------------


def _compute_batting_split(
    df: pd.DataFrame,
    split: str,
    park_deltas: ParkDeltas,
    park_adj: NormalizedAdjustments,
    home_fraction: float,
    woba_ratio_adj: float,
    dp: HitterDataPoints,
) -> pd.DataFrame:
    """
    Compute 12 batting stats for one split (vR or vL).

    Args:
        df: Player DataFrame with rating columns.
        split: 'vR' or 'vL'.
        park_deltas: Additive park deltas (for high-model ratings >= 50).
        park_adj: Normalized adjustments (for low-model ratings < 50).
        home_fraction: Fraction of games at home (for multiplicative factor).
        woba_ratio_adj: Park-adjusted woba ratio for wOBA normalization.
        dp: Hitter data points.

    Returns:
        DataFrame with 12 columns suffixed by split name.
    """
    lg = dp.league
    reg = dp.hitting
    pa = lg.pa

    # --- Read rating columns ---
    eye_col = f"EYE {split}"
    pow_col = f"POW {split}"
    k_col = f"K {split}"
    ba_col = f"BA {split}"
    gap_col = f"GAP {split}"
    spe = pd.to_numeric(df["SPE"], errors="coerce")

    eye_r = pd.to_numeric(df[eye_col], errors="coerce")
    pow_r = pd.to_numeric(df[pow_col], errors="coerce")
    k_r = pd.to_numeric(df[k_col], errors="coerce")
    ba_r = pd.to_numeric(df[ba_col], errors="coerce")
    gap_r = pd.to_numeric(df[gap_col], errors="coerce")

    # --- Compute deltas ---
    eye_delta = _rating_to_delta(eye_r, lg.avg_eye, reg.eye)
    pow_delta = _rating_to_delta(pow_r, lg.avg_power, reg.power)
    k_delta = _rating_to_delta(k_r, lg.avg_k, reg.k)
    babip_delta = _rating_to_delta(ba_r, lg.avg_babip, reg.babip)
    speed_delta = _rating_to_delta(spe, lg.avg_speed, reg.speed)

    # XBH-HR (GAP) uses the SAME high-model coefficients for all ratings.
    # This is unlike other stats where _rating_to_delta switches h/l at 50.
    gap_centered = gap_r - lg.avg_gap
    gap_delta = reg.gap.h_const + reg.gap.h_slope * gap_centered

    # --- Multiplicative park factors ---
    bats = df["B"].astype(str)

    # HR: always multiplicative.
    # S batters: vR → LH factor, vL → RH factor (known spreadsheet bug).
    if split == "vR":
        s_hr = park_adj.hr_lh
    else:
        s_hr = park_adj.hr_rh
    hr_mult_map = {"R": park_adj.hr_rh, "L": park_adj.hr_lh, "S": s_hr}
    hr_mult_raw = bats.map(hr_mult_map).astype(float)
    hr_park_mult = 1.0 + (hr_mult_raw - 1.0) * home_fraction

    # H-HR (BA) multiplicative factor (for low model, BA < 50).
    # S batters use blended factor: ba_rh_mult * svr + ba_lh_mult * (1-svr).
    # Same blend for both splits (not flipped like HR).
    ba_rh_mult = 1.0 + (park_adj.ba_rh - 1.0) * home_fraction
    ba_lh_mult = 1.0 + (park_adj.ba_lh - 1.0) * home_fraction
    s_ba_mult = ba_rh_mult * lg.svr + ba_lh_mult * (1.0 - lg.svr)
    ba_mult_map = {"R": ba_rh_mult, "L": ba_lh_mult, "S": s_ba_mult}
    ba_park_mult = bats.map(ba_mult_map).astype(float)

    # XBH-HR (doubles) multiplicative — same for all batter hands
    d_park_mult = 1.0 + (park_adj.pf_d_adj - 1.0) * home_fraction

    # 3B (triples) multiplicative — same for all batter hands
    t_park_mult = 1.0 + (park_adj.pf_t_adj - 1.0) * home_fraction

    # --- Additive park deltas (for high model, rating >= 50) ---
    # Due to Ballparks bug, vR and vL deltas are identical for H-HR, XBH, 3B.
    if split == "vR":
        hmhr_delta = park_deltas.h_minus_hr_vr
        xbh_delta = park_deltas.xbh_minus_hr_vr
        tri_delta = park_deltas.triple_vr
    else:
        hmhr_delta = park_deltas.h_minus_hr_vl
        xbh_delta = park_deltas.xbh_minus_hr_vl
        tri_delta = park_deltas.triple_vl

    # --- Stat pipeline ---
    # 1. HBP (no regression, no park)
    hbp = pd.Series(lg.hbp_rate * pa, index=df.index)

    # 2. uBB (EYE regression, no park)
    ubb = (eye_delta + lg.bb_rate) * (pa - hbp)

    # 3. HR (POW regression + park, ALWAYS multiplicative)
    hr_base = (pow_delta + lg.hr_rate) * (pa - ubb - hbp)
    hr = hr_base * hr_park_mult

    # 4. SO (K regression, no park)
    so = (k_delta + lg.so_rate) * (pa - ubb - hbp)

    # 5. H-HR (BABIP regression + DUAL park model on BA rating)
    bip = pa - hbp - ubb - hr - so
    hmhr_base = (babip_delta + lg.babip) * bip
    hmhr = _dual_park(hmhr_base, ba_r, hmhr_delta, ba_park_mult)
    hmhr = hmhr.clip(lower=0)

    # 6. XBH-HR (GAP regression + DUAL park model on GAP rating)
    xbh_base = (gap_delta + lg.xbh_rate) * hmhr
    xbh = _dual_park(xbh_base, gap_r, xbh_delta, d_park_mult)

    # 7. 3B (SPE/speed regression + DUAL park model on SPE rating)
    tri_base = (speed_delta + lg.triple_rate) * xbh
    triple = _dual_park(tri_base, spe, tri_delta, t_park_mult)

    # 8. 2B
    double = xbh - triple

    # 9. 1B
    single = hmhr - xbh

    # 10. OBP (no park normalization)
    obp = (ubb + hbp + hmhr + hr) / pa

    # 11. wOBA (park-normalized by dividing by woba_ratio_adj)
    woba = (
        lg.wt_hbp * hbp
        + lg.wt_bb * ubb
        + lg.wt_1b * single
        + lg.wt_2b * double
        + lg.wt_3b * triple
        + lg.wt_hr * hr
    ) / pa / woba_ratio_adj

    # 12. BatR (uses park-normalized wOBA)
    batr = (woba - lg.lg_woba) / lg.woba_scale * pa

    result = pd.DataFrame({
        f"HBP {split}": hbp,
        f"uBB {split}": ubb,
        f"HR {split}": hr,
        f"SO {split}": so,
        f"H-HR {split}": hmhr,
        f"XBH-HR {split}": xbh,
        f"3B {split}": triple,
        f"2B {split}": double,
        f"1B {split}": single,
        f"OBP {split}": obp,
        f"wOBA {split}": woba,
        f"BatR {split}": batr,
    }, index=df.index)

    return result


# ---------------------------------------------------------------------------
# Baserunning computation
# ---------------------------------------------------------------------------


def _compute_baserunning(
    df: pd.DataFrame,
    vr_stats: pd.DataFrame,
    vl_stats: pd.DataFrame,
    dp: HitterDataPoints,
) -> pd.DataFrame:
    """
    Compute 16 baserunning columns from batting split stats and speed/steal ratings.

    Args:
        df: Player DataFrame with STE and RUN rating columns.
        vr_stats: Batting stats vR (from _compute_batting_split).
        vl_stats: Batting stats vL (from _compute_batting_split).
        dp: Hitter data points.

    Returns:
        DataFrame with 16 columns:
            SB%, SBAT vR/vL, SB vR/vL, CS vR/vL,
            wSB vR/vL/wtd, UBR vR/vL/wtd, BSR vR/vL/wtd
    """
    lg = dp.league
    reg = dp.hitting

    ste = pd.to_numeric(df["STE"], errors="coerce")
    run = pd.to_numeric(df["RUN"], errors="coerce")

    # --- SB% (single value, not split) ---
    sb_pct_poly = reg.sb_pct.c0 + reg.sb_pct.c1 * (ste - lg.avg_steal)
    sb_pct = (sb_pct_poly + lg.sb_pct).clip(lower=0)

    # --- SBA rate (no cap on STE) ---
    sba_poly = reg.sba.c0 + reg.sba.c1 * (ste - lg.avg_steal)
    sba_rate = sba_poly + lg.sba_rate

    # --- UBR rate ---
    ubr_poly = reg.ubr.c0 + reg.ubr.c1 * (run - lg.avg_bsr)
    ubr_rate = ubr_poly - lg.ubr  # lg.ubr is negative, so this adds |ubr|

    results = {}
    results["SB%"] = sb_pct

    for split, stats in [("vR", vr_stats), ("vL", vl_stats)]:
        single = stats[f"1B {split}"]
        ubb = stats[f"uBB {split}"]
        hbp = stats[f"HBP {split}"]
        double = stats[f"2B {split}"]
        triple = stats[f"3B {split}"]

        on_first = single + ubb + hbp

        # SBAT
        sbat = (sba_rate * on_first).clip(lower=0)

        # SB / CS
        sb = sb_pct * sbat
        cs = sbat - sb

        # wSB: SB weight hardcoded 0.2 (NOT lg.wt_sb=0.2375), CS weight = lg.run_cs
        wsb_raw = (sb * 0.2 + cs * lg.run_cs).clip(lower=0)
        wsb = wsb_raw - lg.wsb * on_first

        # UBR: uses THIS split's wSB for sb_adj condition
        sb_adj = pd.Series(
            np.where(wsb > 0, cs * 3 - sb, 0.0), index=df.index
        )
        base_opp = on_first * 3 + double * 2 + triple - sb_adj
        ubr = ubr_rate * base_opp

        # BSR
        bsr = wsb + ubr

        results[f"SBAT {split}"] = sbat
        results[f"SB {split}"] = sb
        results[f"CS {split}"] = cs
        results[f"wSB {split}"] = wsb
        results[f"UBR {split}"] = ubr
        results[f"BSR {split}"] = bsr

    # Handedness weighting for wSB, UBR, BSR
    bats = df["B"].astype(str)
    vr_frac = bats.map({"R": lg.rvr, "L": lg.lvr, "S": lg.svr}).astype(float)
    vl_frac = 1.0 - vr_frac

    for stat in ["wSB", "UBR", "BSR"]:
        results[f"{stat} wtd"] = (
            results[f"{stat} vL"] * vl_frac + results[f"{stat} vR"] * vr_frac
        )

    return pd.DataFrame(results, index=df.index)


def _compute_dh_stats(
    vr_stats: pd.DataFrame,
    vl_stats: pd.DataFrame,
    woba_ratio_adj: float,
    dp: HitterDataPoints,
) -> pd.DataFrame:
    """Compute DH wOBA and BatR from park-adjusted split stats.

    Uses the already-park-adjusted counting stats with a 0.98 discount on
    non-HR weighted sum, adjusts denominator to (PA - SO*0.02), and divides
    by woba_ratio_adj. The 0.98 discount and SO*0.02 PA adjustment model
    the DH batting penalty (no fielding fatigue tradeoff).
    """
    lg = dp.league
    pa = lg.pa
    results = {}

    for split, stats in [("vR", vr_stats), ("vL", vl_stats)]:
        hbp = stats[f"HBP {split}"]
        ubb = stats[f"uBB {split}"]
        hr = stats[f"HR {split}"]
        so = stats[f"SO {split}"]
        single = stats[f"1B {split}"]
        double = stats[f"2B {split}"]
        triple = stats[f"3B {split}"]

        # Non-HR weighted sum, discounted by 0.98
        non_hr_wtd = (
            hbp * lg.wt_hbp
            + ubb * lg.wt_bb
            + single * lg.wt_1b
            + double * lg.wt_2b
            + triple * lg.wt_3b
        ) * 0.98

        # HR weighted sum (no discount)
        hr_wtd = hr * lg.wt_hr

        # DH wOBA: adjusted denominator and park normalization
        dh_woba = (non_hr_wtd + hr_wtd) / (pa - so * 0.02) / woba_ratio_adj

        # DH BatR: from DH wOBA
        dh_batr = (dh_woba - lg.lg_woba) / lg.woba_scale * pa

        results[f"DH wOBA {split}"] = dh_woba
        results[f"DH BatR {split}"] = dh_batr

    return pd.DataFrame(results, index=vr_stats.index)


# ---------------------------------------------------------------------------
# Position eligibility
# ---------------------------------------------------------------------------


def parse_height_cm(ht_series: pd.Series) -> pd.Series:
    """Convert height strings like ``6' 2'`` to centimeters."""
    parts = ht_series.astype(str).str.extract(r"(\d+)'\s*(\d+)'?")
    feet = pd.to_numeric(parts[0], errors="coerce")
    inches = pd.to_numeric(parts[1], errors="coerce")
    return feet * 30.48 + inches * 2.54


def compute_position_eligibility(
    players: pd.DataFrame,
    dp: HitterDataPoints = DEFAULT_HITTER_DP,
) -> pd.DataFrame:
    """Determine which positions each player is eligible for.

    Returns a DataFrame with 9 boolean columns (C/1B/2B/3B/SS/LF/CF/RF/DH Elig).

    Rules (from The Sheet Hitters.xlsx columns BJ–BQ):
        C:  C FRM >= 45
        1B: HT (cm) > 179 AND IF RNG > 20
        2B: IF RNG >= 50 AND throws R AND TDP >= 45
        3B: IF RNG >= 40 AND IF ARM >= 50 AND throws R
        SS: IF RNG >= 60 AND IF ARM >= 50 AND throws R
        LF: OF RNG >= 50
        CF: OF RNG >= 60
        RF: OF RNG >= 50
        DH: always True
    """
    ht_cm = parse_height_cm(players["HT"])
    c_frm = pd.to_numeric(players["C FRM"], errors="coerce")
    if_rng = pd.to_numeric(players["IF RNG"], errors="coerce")
    if_arm = pd.to_numeric(players["IF ARM"], errors="coerce")
    tdp = pd.to_numeric(players["TDP"], errors="coerce")
    of_rng = pd.to_numeric(players["OF RNG"], errors="coerce")
    throws_r = players["T"].astype(str) == "R"

    return pd.DataFrame(
        {
            "C Elig": c_frm >= 45,
            "1B Elig": (ht_cm > 179) & (if_rng > 20),
            "2B Elig": (if_rng >= 50) & throws_r & (tdp >= 45),
            "3B Elig": (if_rng >= 40) & (if_arm >= 50) & throws_r,
            "SS Elig": (if_rng >= 60) & (if_arm >= 50) & throws_r,
            "LF Elig": of_rng >= 50,
            "CF Elig": of_rng >= 60,
            "RF Elig": of_rng >= 50,
            "DH Elig": True,
        },
        index=players.index,
    )


def refine_two_way(
    players: pd.DataFrame, eligibility: pd.DataFrame
) -> pd.Series:
    """Refine two-way detection using position eligibility.

    Path A: 2/3 big-3 (CON P, POW P, EYE P) >= 50 → qualifies regardless.
    Path B: 3/3 big-3 >= 40 AND eligible for a defensive position other
            than 1B/DH (i.e. C, 2B, 3B, SS, LF, CF, or RF).

    Both paths also require all 3 pitcher ratings (STU P, MOV P, PCON P) >= 40.
    """
    big3 = pd.DataFrame(
        {col: pd.to_numeric(players[col], errors="coerce") for col in _HITTER_BIG3_COLS}
    )
    big3_ge40 = big3.ge(40).sum(axis=1)
    big3_ge50 = big3.ge(50).sum(axis=1)

    pitcher_ok = pd.DataFrame(
        {col: pd.to_numeric(players[col], errors="coerce") for col in _PITCHER_RATING_COLS}
    ).ge(40).all(axis=1)

    field_positions = [
        "C Elig", "2B Elig", "3B Elig", "SS Elig",
        "LF Elig", "CF Elig", "RF Elig",
    ]
    has_field_pos = eligibility[field_positions].any(axis=1)

    path_a = big3_ge50 >= 2
    path_b = (big3_ge40 >= 3) & has_field_pos

    return (path_a | path_b) & pitcher_ok


# ---------------------------------------------------------------------------
# Fielding computation
# ---------------------------------------------------------------------------


def compute_fielding(
    players: pd.DataFrame,
    eligibility: pd.DataFrame,
    dp: HitterDataPoints = DEFAULT_HITTER_DP,
) -> pd.DataFrame:
    """Compute fielding stats for all eligible positions.

    For each position, stats are only computed where the player is eligible
    (from ``compute_position_eligibility``). Ineligible positions get NaN.

    Returns a DataFrame with 30 fielding columns:
        C:  FRMAA, SBA, RTO%, SB, CS, ArmR, RunsP  (7)
        1B: PMAA, EAA, RunsP                         (3)
        2B: PMAA, EAA, DPAA, RunsP                   (4)
        3B: PMAA, EAA, RunsP                          (3)
        SS: PMAA, EAA, DPAA, RunsP                    (4)
        LF: PMAA, EAA, ARMAA, RunsP                   (4)
        CF: PMAA, EAA, ARMAA, RunsP                    (4)
        RF: PMAA, EAA, ARMAA, RunsP                    (4)
    Note: C PMAA is always 0 (placeholder column in spreadsheet).
    """
    fc = dp.fielding_coeffs
    fp = dp.fielding
    lg = dp.league

    # Read ratings (coerce to float)
    c_frm  = pd.to_numeric(players["C FRM"],  errors="coerce")
    c_arm  = pd.to_numeric(players["C ARM"],  errors="coerce")
    if_rng = pd.to_numeric(players["IF RNG"], errors="coerce")
    if_err = pd.to_numeric(players["IF ERR"], errors="coerce")
    if_arm = pd.to_numeric(players["IF ARM"], errors="coerce")
    tdp    = pd.to_numeric(players["TDP"],    errors="coerce")
    of_rng = pd.to_numeric(players["OF RNG"], errors="coerce")
    of_err = pd.to_numeric(players["OF ERR"], errors="coerce")
    of_arm = pd.to_numeric(players["OF ARM"], errors="coerce")
    ht_cm  = parse_height_cm(players["HT"])

    idx = players.index
    result = pd.DataFrame(index=idx)

    # ── Catcher ──────────────────────────────────────────────────────────
    c_elig = eligibility["C Elig"]

    # FRMAA = (const + slope * (FRM - avg)) * ip_c
    frmaa = (fc.c_frm_const + fc.c_frm_slope * (c_frm - fp.avg_frm_c)) * lg.ip_c
    result["C FRMAA"] = frmaa.where(c_elig)

    # SBA = (const + slope * (ARM - avg_arm)) * ip_c + c_sba_scale
    c_sba = (fc.c_sba_const + fc.c_sba_slope * (c_arm - fp.avg_arm_c)) * lg.ip_c + fp.c_sba_scale
    result["C SBA"] = c_sba.where(c_elig)

    # RTO% = MAX(0, (const + slope * (ARM - avg)) + c_rto_lg)
    c_rto = (fc.c_rto_const + fc.c_rto_slope * (c_arm - fp.avg_arm_c) + fp.c_rto_lg).clip(lower=0)
    result["C RTO%"] = c_rto.where(c_elig)

    # CS = RTO% * SBA; SB = SBA - CS
    c_cs = c_rto * c_sba
    c_sb = c_sba - c_cs
    result["C SB"] = c_sb.where(c_elig)
    result["C CS"] = c_cs.where(c_elig)

    # ArmR = (CS * -(0.2 + run_cs)) - (c_sba_scale * c_rto_lg * -(0.2 + run_cs))
    arm_weight = -(0.2 + lg.run_cs)
    c_armr = c_cs * arm_weight - (fp.c_sba_scale * fp.c_rto_lg * arm_weight)
    result["C ArmR"] = c_armr.where(c_elig)

    # RunsP = FRMAA + ArmR (PMAA is always 0)
    result["C RunsP"] = (frmaa + c_armr).where(c_elig)

    # ── 1B ───────────────────────────────────────────────────────────────
    b1_elig = eligibility["1B Elig"]

    # PMAA = (const + rng_slope*(IF_RNG - avg_rng) + ht_slope*(HT - avg_ht)) * scale
    b1_pmaa = (
        fc.first_pm_const
        + fc.first_pm_rng_slope * (if_rng - fp.avg_rng_1b)
        + fc.first_pm_ht_slope * (ht_cm - fp.avg_ht_1b)
    ) * fp.first_pa
    result["1B PMAA"] = b1_pmaa.where(b1_elig)

    # EAA = (const + slope*(IF_ERR - avg_err)) * ip
    b1_eaa = (fc.first_err_const + fc.first_err_slope * (if_err - fp.avg_err_1b)) * lg.ip
    result["1B EAA"] = b1_eaa.where(b1_elig)

    # RunsP = (PMAA - EAA) * inf_out
    result["1B RunsP"] = ((b1_pmaa - b1_eaa) * lg.inf_out).where(b1_elig)

    # ── 2B ───────────────────────────────────────────────────────────────
    b2_elig = eligibility["2B Elig"]

    # PMAA = (const + rng_slope*(RNG-avg) + arm_slope*(ARM-avg)) * scale
    b2_pmaa = (
        fc.second_pm_const
        + fc.second_pm_rng_slope * (if_rng - fp.avg_rng_2b)
        + fc.second_pm_arm_slope * (if_arm - fp.avg_arm_2b)
    ) * fp.second_pa
    result["2B PMAA"] = b2_pmaa.where(b2_elig)

    # EAA = (const + slope*(ERR-avg)) * (PMAA + scale * lg_pm%)
    b2_eaa = (fc.second_err_const + fc.second_err_slope * (if_err - fp.avg_err_2b)) * (
        b2_pmaa + fp.second_pa * fp.second_pm_lg
    )
    result["2B EAA"] = b2_eaa.where(b2_elig)

    # DPAA = (const + slope*(TDP-avg)) * ip
    b2_dpaa = (fc.second_dp_const + fc.second_dp_slope * (tdp - fp.avg_tdp_2b)) * lg.ip
    result["2B DPAA"] = b2_dpaa.where(b2_elig)

    # RunsP = (PMAA - EAA + DPAA) * inf_out
    result["2B RunsP"] = ((b2_pmaa - b2_eaa + b2_dpaa) * lg.inf_out).where(b2_elig)

    # ── 3B ───────────────────────────────────────────────────────────────
    b3_elig = eligibility["3B Elig"]

    b3_pmaa = (
        fc.third_pm_const
        + fc.third_pm_rng_slope * (if_rng - fp.avg_rng_3b)
        + fc.third_pm_arm_slope * (if_arm - fp.avg_arm_3b)
    ) * fp.third_pa
    result["3B PMAA"] = b3_pmaa.where(b3_elig)

    b3_eaa = (fc.third_err_const + fc.third_err_slope * (if_err - fp.avg_err_3b)) * (
        b3_pmaa + fp.third_pa * fp.third_pm_lg
    )
    result["3B EAA"] = b3_eaa.where(b3_elig)

    result["3B RunsP"] = ((b3_pmaa - b3_eaa) * lg.inf_out).where(b3_elig)

    # ── SS ───────────────────────────────────────────────────────────────
    ss_elig = eligibility["SS Elig"]

    ss_pmaa = (
        fc.ss_pm_const
        + fc.ss_pm_rng_slope * (if_rng - fp.avg_rng_ss)
        + fc.ss_pm_arm_slope * (if_arm - fp.avg_arm_ss)
    ) * fp.ss_pa
    result["SS PMAA"] = ss_pmaa.where(ss_elig)

    ss_eaa = (fc.ss_err_const + fc.ss_err_slope * (if_err - fp.avg_err_ss)) * (
        ss_pmaa + fp.ss_pa * fp.ss_pm_lg
    )
    result["SS EAA"] = ss_eaa.where(ss_elig)

    # SS DPAA uses separate coefficients (K45/L45) and avg TDP from Q25
    ss_dpaa = (fc.ss_dp_const + fc.ss_dp_slope * (tdp - fp.avg_tdp_ss)) * lg.ip
    result["SS DPAA"] = ss_dpaa.where(ss_elig)

    result["SS RunsP"] = ((ss_pmaa - ss_eaa + ss_dpaa) * lg.inf_out).where(ss_elig)

    # ── LF ───────────────────────────────────────────────────────────────
    lf_elig = eligibility["LF Elig"]

    lf_pmaa = (fc.lf_pm_const + fc.lf_pm_slope * (of_rng - fp.avg_rng_lf)) * fp.lf_pa
    result["LF PMAA"] = lf_pmaa.where(lf_elig)

    lf_eaa = (fc.lf_err_const + fc.lf_err_slope * (of_err - fp.avg_err_lf)) * (
        lf_pmaa + fp.lf_pa * fp.lf_pm_lg
    )
    result["LF EAA"] = lf_eaa.where(lf_elig)

    lf_armaa = (fc.lf_arm_const + fc.lf_arm_slope * (of_arm - fp.avg_arm_lf)) * fp.lf_pa
    result["LF ARMAA"] = lf_armaa.where(lf_elig)

    result["LF RunsP"] = ((lf_pmaa - lf_eaa) * lg.of_out + lf_armaa).where(lf_elig)

    # ── CF ───────────────────────────────────────────────────────────────
    cf_elig = eligibility["CF Elig"]

    cf_pmaa = (fc.cf_pm_const + fc.cf_pm_slope * (of_rng - fp.avg_rng_cf)) * fp.cf_pa
    result["CF PMAA"] = cf_pmaa.where(cf_elig)

    cf_eaa = (fc.cf_err_const + fc.cf_err_slope * (of_err - fp.avg_err_cf)) * (
        cf_pmaa + fp.cf_pa * fp.cf_pm_lg
    )
    result["CF EAA"] = cf_eaa.where(cf_elig)

    cf_armaa = (fc.cf_arm_const + fc.cf_arm_slope * (of_arm - fp.avg_arm_cf)) * fp.cf_pa
    result["CF ARMAA"] = cf_armaa.where(cf_elig)

    result["CF RunsP"] = ((cf_pmaa - cf_eaa) * lg.of_out + cf_armaa).where(cf_elig)

    # ── RF ───────────────────────────────────────────────────────────────
    rf_elig = eligibility["RF Elig"]

    rf_pmaa = (fc.rf_pm_const + fc.rf_pm_slope * (of_rng - fp.avg_rng_rf)) * fp.rf_pa
    result["RF PMAA"] = rf_pmaa.where(rf_elig)

    rf_eaa = (fc.rf_err_const + fc.rf_err_slope * (of_err - fp.avg_err_rf)) * (
        rf_pmaa + fp.rf_pa * fp.rf_pm_lg
    )
    result["RF EAA"] = rf_eaa.where(rf_elig)

    rf_armaa = (fc.rf_arm_const + fc.rf_arm_slope * (of_arm - fp.avg_arm_rf)) * fp.rf_pa
    result["RF ARMAA"] = rf_armaa.where(rf_elig)

    result["RF RunsP"] = ((rf_pmaa - rf_eaa) * lg.of_out + rf_armaa).where(rf_elig)

    return result


# ---------------------------------------------------------------------------
# WAA (Wins Above Average) per position
# ---------------------------------------------------------------------------


def compute_waa(
    batting: pd.DataFrame,
    fielding: pd.DataFrame,
    eligibility: pd.DataFrame,
    park_deltas: ParkDeltas,
    home_fraction: float,
    dp: HitterDataPoints = DEFAULT_HITTER_DP,
) -> pd.DataFrame:
    """Compute WAA and WAR per position, plus Max WAA / Max WAR across positions.

    Standard positions (1B–RF):
        WAA = (RunsP + BSR + BatR + PosAdj) / waa_const
        WAR = WAA + (repl_runs_per_pa * pa) / waa_const

    Catcher (special — PA=500 inline BatR):
        WAA = (C_RunsP + BSR + BatR@500 + park_adj_c + PosAdj_C) / waa_const
        WAR = WAA + (repl_runs_per_pa * pa_c) / waa_const

    DH (special — 0.98 non-HR discount, no fielding):
        WAA = (BSR * 0.98 + DH_BatR + PosAdj_DH) / waa_const
        WAR = WAA + (repl_runs_per_pa * pa) / waa_const

    The replacement-runs bonus scales with the playing-time benchmark for each
    position (pa_c=500 for C, pa=600 for everything else), which is what gives
    catchers a smaller WAR bonus than other positions and why Max WAR may pick
    a different position than Max WAA.

    Args:
        batting: Output of compute_hitter_batting (has BatR, wOBA, BSR, DH BatR).
        fielding: Output of compute_fielding (has RunsP per position).
        eligibility: Output of compute_position_eligibility (9 boolean columns).
        park_deltas: For adj_value (catcher park correction).
        home_fraction: Fraction of games at home.
        dp: Hitter data points.

    Returns:
        DataFrame with 60 columns:
            9 positions × 3 splits × 2 metrics (WAA, WAR) = 54
            3 Max WAA columns + 3 Max WAR columns = 6
    """
    lg = dp.league
    fp = dp.fielding

    # Extract batting components
    batr_vr = batting["BatR vR"]
    batr_vl = batting["BatR vL"]
    bsr_vr = batting["BSR vR"]
    bsr_vl = batting["BSR vL"]
    woba_vr = batting["wOBA vR"]
    woba_vl = batting["wOBA vL"]
    dh_batr_vr = batting["DH BatR vR"]
    dh_batr_vl = batting["DH BatR vL"]

    # Handedness weighting fractions
    bats = batting["B"].astype(str)
    vr_frac = bats.map({"R": lg.rvr, "L": lg.lvr, "S": lg.svr}).astype(float)
    vl_frac = 1.0 - vr_frac

    result = pd.DataFrame(index=batting.index)
    waa_vr_cols = []
    waa_vl_cols = []
    war_vr_cols = []
    war_vl_cols = []

    # Replacement credit (wins) — scalar per playing-time benchmark
    repl_credit_non_c = lg.repl_runs_per_pa * lg.pa / lg.waa_const
    repl_credit_c = lg.repl_runs_per_pa * lg.pa_c / lg.waa_const

    # Position adjustments mapping
    pos_adj_map = {
        "C": fp.pos_c, "1B": fp.pos_1b, "2B": fp.pos_2b, "3B": fp.pos_3b,
        "SS": fp.pos_ss, "LF": fp.pos_lf, "CF": fp.pos_cf, "RF": fp.pos_rf,
    }

    # ── Standard positions (1B–RF) ────────────────────────────────────────
    for pos in ["1B", "2B", "3B", "SS", "LF", "CF", "RF"]:
        runsp = fielding[f"{pos} RunsP"]
        adj = pos_adj_map[pos]

        waa_vr = (runsp + bsr_vr + batr_vr + adj) / lg.waa_const
        waa_vl = (runsp + bsr_vl + batr_vl + adj) / lg.waa_const
        waa_wtd = waa_vl * vl_frac + waa_vr * vr_frac

        war_vr = waa_vr + repl_credit_non_c
        war_vl = waa_vl + repl_credit_non_c
        war_wtd = waa_wtd + repl_credit_non_c

        elig = eligibility[f"{pos} Elig"]
        result[f"{pos} WAA vR"] = waa_vr.where(elig)
        result[f"{pos} WAA vL"] = waa_vl.where(elig)
        result[f"{pos} WAA wtd"] = waa_wtd.where(elig)
        result[f"{pos} WAR vR"] = war_vr.where(elig)
        result[f"{pos} WAR vL"] = war_vl.where(elig)
        result[f"{pos} WAR wtd"] = war_wtd.where(elig)

        waa_vr_cols.append(f"{pos} WAA vR")
        waa_vl_cols.append(f"{pos} WAA vL")
        war_vr_cols.append(f"{pos} WAR vR")
        war_vl_cols.append(f"{pos} WAR vL")

    # ── Catcher (special: PA=500 inline BatR + park adjustment) ───────────
    c_runsp = fielding["C RunsP"]

    # BatR at PA=500
    batr_c_vr = (woba_vr - lg.lg_woba) / lg.woba_scale * lg.pa_c
    batr_c_vl = (woba_vl - lg.lg_woba) / lg.woba_scale * lg.pa_c

    # Park adjustment: scale adj_value from 600 PA to 500 PA
    park_adj_c = park_deltas.adj_value / lg.pa * lg.pa_c

    c_waa_vr = (c_runsp + bsr_vr + batr_c_vr + park_adj_c + fp.pos_c) / lg.waa_const
    c_waa_vl = (c_runsp + bsr_vl + batr_c_vl + park_adj_c + fp.pos_c) / lg.waa_const
    c_waa_wtd = c_waa_vl * vl_frac + c_waa_vr * vr_frac

    c_war_vr = c_waa_vr + repl_credit_c
    c_war_vl = c_waa_vl + repl_credit_c
    c_war_wtd = c_waa_wtd + repl_credit_c

    c_elig = eligibility["C Elig"]
    result["C WAA vR"] = c_waa_vr.where(c_elig)
    result["C WAA vL"] = c_waa_vl.where(c_elig)
    result["C WAA wtd"] = c_waa_wtd.where(c_elig)
    result["C WAR vR"] = c_war_vr.where(c_elig)
    result["C WAR vL"] = c_war_vl.where(c_elig)
    result["C WAR wtd"] = c_war_wtd.where(c_elig)

    waa_vr_cols.append("C WAA vR")
    waa_vl_cols.append("C WAA vL")
    war_vr_cols.append("C WAR vR")
    war_vl_cols.append("C WAR vL")

    # ── DH (special: 0.98 BSR discount, no fielding) ─────────────────────
    dh_waa_vr = (bsr_vr * 0.98 + dh_batr_vr + fp.pos_dh) / lg.waa_const
    dh_waa_vl = (bsr_vl * 0.98 + dh_batr_vl + fp.pos_dh) / lg.waa_const
    dh_waa_wtd = dh_waa_vl * vl_frac + dh_waa_vr * vr_frac

    dh_war_vr = dh_waa_vr + repl_credit_non_c
    dh_war_vl = dh_waa_vl + repl_credit_non_c
    dh_war_wtd = dh_waa_wtd + repl_credit_non_c

    # DH is always eligible
    result["DH WAA vR"] = dh_waa_vr
    result["DH WAA vL"] = dh_waa_vl
    result["DH WAA wtd"] = dh_waa_wtd
    result["DH WAR vR"] = dh_war_vr
    result["DH WAR vL"] = dh_war_vl
    result["DH WAR wtd"] = dh_war_wtd

    waa_vr_cols.append("DH WAA vR")
    waa_vl_cols.append("DH WAA vL")
    war_vr_cols.append("DH WAR vR")
    war_vl_cols.append("DH WAR vL")

    # ── Max WAA ───────────────────────────────────────────────────────────
    result["Max WAA vR"] = result[waa_vr_cols].max(axis=1)
    result["Max WAA vL"] = result[waa_vl_cols].max(axis=1)
    waa_wtd_cols = [c for c in result.columns if c.endswith(" WAA wtd")]
    result["Max WAA wtd"] = result[waa_wtd_cols].max(axis=1)

    # ── Max WAR ───────────────────────────────────────────────────────────
    # Computed independently of Max WAA because the catcher's smaller PA
    # benchmark means C may rank differently in WAR than in WAA.
    result["Max WAR vR"] = result[war_vr_cols].max(axis=1)
    result["Max WAR vL"] = result[war_vl_cols].max(axis=1)
    war_wtd_cols = [c for c in result.columns if c.endswith(" WAR wtd")]
    result["Max WAR wtd"] = result[war_wtd_cols].max(axis=1)

    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compute_hitter_batting(
    players: pd.DataFrame,
    park_deltas: ParkDeltas,
    park_adj: NormalizedAdjustments,
    home_fraction: float,
    dp: HitterDataPoints = DEFAULT_HITTER_DP,
) -> pd.DataFrame:
    """
    Compute batting stats for all hitters.

    Args:
        players: Player DataFrame (from load_players or subset).
        park_deltas: Additive park deltas (for high-model ratings >= 50).
        park_adj: Normalized adjustments (for low-model ratings < 50).
        home_fraction: Fraction of games at home (typically 0.5).
        dp: Hitter data points with regression coefficients and league params.

    Returns:
        DataFrame with 49 appended columns:
          - vR (12): HBP/uBB/HR/SO/H-HR/XBH-HR/3B/2B/1B/OBP/wOBA/BatR vR
          - vL (12): same with vL suffix
          - Weighted (3): OBP wtd, wOBA wtd, BatR wtd
          - DH (6): DH wOBA vR/vL/wtd, DH BatR vR/vL/wtd
          - Baserunning (16): SB%, SBAT/SB/CS/wSB/UBR/BSR vR/vL, wSB/UBR/BSR wtd
    """
    lg = dp.league

    # Park-adjusted woba_ratio: 1 + (woba_ratio - 1) * home_fraction
    woba_ratio_adj = 1.0 + (park_deltas.woba_ratio - 1.0) * home_fraction

    # Per-split stats
    vr = _compute_batting_split(
        players, "vR", park_deltas, park_adj, home_fraction, woba_ratio_adj, dp,
    )
    vl = _compute_batting_split(
        players, "vL", park_deltas, park_adj, home_fraction, woba_ratio_adj, dp,
    )

    # Handedness weighting
    bats = players["B"].astype(str)
    vr_frac = bats.map({"R": lg.rvr, "L": lg.lvr, "S": lg.svr}).astype(float)
    vl_frac = 1.0 - vr_frac

    wtd = pd.DataFrame({
        "OBP wtd": vl["OBP vL"] * vl_frac + vr["OBP vR"] * vr_frac,
        "wOBA wtd": vl["wOBA vL"] * vl_frac + vr["wOBA vR"] * vr_frac,
        "BatR wtd": vl["BatR vL"] * vl_frac + vr["BatR vR"] * vr_frac,
    }, index=players.index)

    # DH stats (from park-adjusted split stats, with 0.98/0.02 corrections)
    dh = _compute_dh_stats(vr, vl, woba_ratio_adj, dp)

    # DH weighted: computed from DH wOBA wtd, then BatR from that
    dh_woba_wtd = dh["DH wOBA vL"] * vl_frac + dh["DH wOBA vR"] * vr_frac
    dh_batr_wtd = (dh_woba_wtd - lg.lg_woba) / lg.woba_scale * lg.pa
    dh_wtd = pd.DataFrame({
        "DH wOBA wtd": dh_woba_wtd,
        "DH BatR wtd": dh_batr_wtd,
    }, index=players.index)

    # Baserunning stats
    baserunning = _compute_baserunning(players, vr, vl, dp)

    return pd.concat([players, vr, vl, wtd, dh, dh_wtd, baserunning], axis=1)
