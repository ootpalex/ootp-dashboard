"""
data_points.py — OOTP rating system constants.

Hardcodes all regression coefficients and league calibration parameters with
inline source references. Two sources feed into this module:

    25 Regressions.xlsx / Data Points
        cols B–E  : hitting regression coefficients
        cols H–K  : fielding regression coefficients (primary stat per position)
        cols N–Q  : pitching regression coefficients

    25 Metadata.xlsx / Data Points
        col E rows 2–9   : hitting rating averages
        col E rows 12–20 : wOBA event weights
        col E rows 23–26 : batter matchup splits (fraction of PA vs RHP)
        col E rows 29–41 : league measurements and hitting rates
        col A rows 33–41 : hitting stat rates
        col O rows 2–10  : position adjustment (WAR/162)
        col T rows 2–10  : starter/reliever rating averages
        col T rows 23–26 : pitcher matchup splits

Values calibrated from 50 years of simulated OOTP 26 baseline data
(10 sims × 5 years). Update for different league seasons or OOTP versions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.ballparks import BallparkConstants  # noqa: F401 — used in type annotations


# ---------------------------------------------------------------------------
# WAR replacement level (FanGraphs-calibrated, applied per-league)
# ---------------------------------------------------------------------------
# Replacement level is a fixed, once-calibrated standard (a replacement team
# wins ~.294 → ~1000 WAR / 30 teams, split 57% hitting / 43% pitching). For
# pitchers FanGraphs publishes it as wins-per-9-innings: 0.12 for a pure
# starter, 0.03 for a pure reliever. We apply these per league by scaling with
# each league's own runs-per-win (waa_const), so the replacement RA/9 offset is
# WPG * waa_const (the IP/9 cancels):
#     ra9_repl_sp = ra9_sp + FG_REPL_WPG_SP * waa_const
#     ra9_repl_rp = ra9_rp + FG_REPL_WPG_RP * waa_const
# This is size-invariant by construction (per-player WAR doesn't depend on team
# count — only on the league's run environment). See
# library.fangraphs.com/war/calculating-war-pitchers/ and
# blogs.fangraphs.com/unifying-replacement-level/.
FG_REPL_WPG_SP: float = 0.12   # replacement level, wins per 9 IP — starters
FG_REPL_WPG_RP: float = 0.03   # replacement level, wins per 9 IP — relievers


# ---------------------------------------------------------------------------
# Helper coefficient types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LinearCoeffs:
    """
    2-segment piecewise-linear regression model.

    Predicted delta = h_const + h_slope * (rating - avg)  if rating >= 50
                    = l_const + l_slope * (rating - avg)  if rating <  50

    For fielding positions (which use a single segment), h_const == l_const
    and h_slope == l_slope.

    Field naming: h = high-rating segment (>= 50), l = low-rating segment (< 50),
    X = slope coefficient in the Regressions sheet.
    """

    h_const: float
    h_slope: float
    l_const: float
    l_slope: float


@dataclass(frozen=True)
class CubicCoeffs:
    """
    Cubic SUMPRODUCT regression model.

    Predicted delta = c0 + c1*(r-avg) + c2*(r-avg)^2 + c3*(r-avg)^3

    In OOTP 26, c2 and c3 are 0.0 for all stats (the sheet reserves the cells
    but leaves them blank / zero). Retained for forward compatibility.
    """

    c0: float
    c1: float
    c2: float = 0.0
    c3: float = 0.0


@dataclass(frozen=True)
class PiecewiseCoeffs:
    """Continuous piecewise-linear rating→delta, anchored delta(lg.avg)=0 (OOTP-27 calibration).

    OOTP-27 only — no 26 constant uses this type. Applicators dispatch on
    ``isinstance(coeffs, PiecewiseCoeffs)`` so every 26 ``LinearCoeffs``/``CubicCoeffs``/scalar
    code path is untouched. See ``OOTP27_WIRING_IMPLEMENTATION_SPEC.md`` §2–§4.

    knots:  ascending knot positions where the slope changes (length K). Their MEANING depends on
        ``relative``:  relative=True  → OFFSETS from lg.avg (placed at lg.avg + knot);
                       relative=False → ABSOLUTE display values (placed there directly).
    slopes: per-segment slope per display point (length K+1), low→high. Used directly in BOTH
        regimes (slopes are frame-invariant — spec §2.1).
    relative: True for hit/pit skill ratings (EYE/POW/K/BA/GAP/STU/CON/HRR/PBABIP) → offset
        placement; False for absolute ratings (SPE/STE/RUN/HLD + all fielding) → absolute
        placement. Classify by the PREDICTOR rating, never the stat family (spec §2 table).
    clamp_lo / clamp_hi: the first/last segment is a hard flat floor/ceiling; informational —
        ``slopes[0]``/``slopes[-1]`` already encode it (0.0). Kept for provenance/tests.
    c0: OPTIONAL canonical intercept for ``poly + lg.rate`` channels (baserunning, spec §2.5).
        None for hit/pit/fielding rate deltas (which anchor at delta(lg.avg)=0).
    """

    knots: tuple[float, ...]
    slopes: tuple[float, ...]
    relative: bool = True
    clamp_lo: bool = False
    clamp_hi: bool = False
    c0: float | None = None

    def __post_init__(self):
        assert len(self.slopes) == len(self.knots) + 1, (
            f"need len(slopes) == len(knots)+1, got {len(self.slopes)} vs {len(self.knots)}"
        )
        assert all(a < b for a, b in zip(self.knots, self.knots[1:])), (
            f"knots must be strictly ascending: {self.knots}"
        )
        if self.clamp_lo:
            assert self.slopes[0] == 0.0, "clamp_lo requires slopes[0] == 0.0"
        if self.clamp_hi:
            assert self.slopes[-1] == 0.0, "clamp_hi requires slopes[-1] == 0.0"


# ---------------------------------------------------------------------------
# Section 1 — Regression coefficients (25 Regressions.xlsx / Data Points)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class HittingRegressionCoeffs:
    """
    Rating → stat regression coefficients for hitter offensive stats.

    Source: 25 Regressions.xlsx / Data Points, columns B (h_const), C (h_slope),
            D (l_const), E (l_slope).  Row pairs: label row, then value row.

    The predicted value is the DELTA from the league average for that stat,
    not the absolute stat value.
    """

    # Regressions Data Points rows 3–4: hEYE / lEye
    eye: LinearCoeffs = LinearCoeffs(
        h_const= 0.0017701750757387691,
        h_slope= 0.0018699770558723264,
        l_const=-0.0033631942139841944,
        l_slope= 0.0020517389336703515,
    )

    # Regressions Data Points rows 5–6: hPOW / lPOW
    power: LinearCoeffs = LinearCoeffs(
        h_const=-0.0003829540421328803,
        h_slope= 0.0013038568517479568,
        l_const=-0.005860434733517423,
        l_slope= 0.0007812595744648037,
    )

    # Regressions Data Points rows 7–8: hK's / lK's
    k: LinearCoeffs = LinearCoeffs(
        h_const=-0.008441742792481196,
        h_slope=-0.005063469346528512,
        l_const=-0.005814103094068408,
        l_slope=-0.007938740334460419,
    )

    # Regressions Data Points rows 9–10: hBABIP / lBABIP
    babip: LinearCoeffs = LinearCoeffs(
        h_const= 0.00022993019282137694,
        h_slope= 0.002097471734467991,
        l_const= 0.0027315645780548467,
        l_slope= 0.002866534329211713,
    )

    # Regressions Data Points rows 11–12: hGAP / lGAP
    # Excel: B11=h_const, C11=h_slope, D11=l_const, E11=l_slope.
    # XBH-HR uses C11/B11 (h_slope/h_const) for BOTH high and low models.
    gap: LinearCoeffs = LinearCoeffs(
        h_const= 0.008328547436316799,
        h_slope= 0.0032213371227252795,
        l_const= 0.011803143864072779,
        l_slope= 0.0065128316133427604,
    )

    # Regressions Data Points rows 13–14: hSPE / lSPE
    speed: LinearCoeffs = LinearCoeffs(
        h_const= 0.009946428683776223,
        h_slope= 0.0013996778077110226,
        l_const=-0.011968194641868489,
        l_slope= 0.00190816378408937,
    )

    # Baserunning (sba/sb_pct/ubr) are applied as poly + lg.rate (hitters.py 273-282), so c0 is the offset
    # an AVERAGE-rated runner sits at RELATIVE to lg.rate. c0 is NOT ~0: lg.sb_pct (≈0.78) is the *pooled*
    # league rate (attempt-weighted, so dominated by elite base-stealers who run the most), but a player at
    # the average steal RATING (STE≈48) actually succeeds only ~0.65 — verified directly from the calibration
    # sims (STE 45-51 → SB% 0.654). So sb_pct.c0 = 0.65 − 0.78 ≈ −0.133 is CORRECT, not a bug. (An earlier
    # rollout briefly zeroed these after the OLS recompute returned 0 — but _compute_linear_as_cubic CENTERS
    # the outcome, so it returns intercept 0 for *any* data and structurally cannot recover this offset; the
    # offset also depends on the league avg_steal/sb_pct, which the regression module doesn't have. So these
    # intercepts are the canonical calibration values, kept here and re-applied over the recompute.)

    # Regressions Data Points rows 15–16: hSBA / X  (cubic; c2=c3=0)
    sba: CubicCoeffs = CubicCoeffs(
        c0= 0.009116895606791357,
        c1= 0.013804785218935973,
    )

    # Regressions Data Points rows 17–18: SB% / X  (cubic; c2=c3=0)
    sb_pct: CubicCoeffs = CubicCoeffs(
        c0=-0.13320702812059265,
        c1= 0.008501465263446395,
    )

    # Regressions Data Points rows 19–20: UBR / X  (cubic; c2=c3=0)
    ubr: CubicCoeffs = CubicCoeffs(
        c0= 3.093821597831973e-05,
        c1= 0.00015200301980831775,
    )


@dataclass(frozen=True)
class FieldingRegressionCoeffs:
    """
    Rating → stat regression coefficients for fielding.

    Source: 25 Regressions.xlsx / Data Points, columns K–M (coefficients),
            P–Q (rating averages per regression).

    All fielding regressions use a single linear segment (no high/low split).
    Multi-variable regressions (1B PM% uses range + height; 2B/3B/SS PM% use
    range + arm) store the secondary slope separately.

    Naming convention:
        {pos}_pm   — Plays Made % regression (const, range_slope, [secondary_slope])
        {pos}_err  — Error rate regression (const, slope)
        {pos}_dp   — Double Play regression (2B, SS only)
        {pos}_arm  — Arm regression (OF only)
        c_frm      — Catcher framing
        c_sba      — Catcher stolen bases allowed
        c_rto      — Catcher caught-stealing rate
    """

    # ── Catcher regressions ──────────────────────────────────────────────────

    # K3/L3: C FRM (framing rate)
    c_frm_const:  float = -0.00011417355083632582
    c_frm_slope:  float =  0.0005468042209251762

    # K5/L5: C SBA (stolen bases allowed rate, keyed on C ARM)
    c_sba_const:  float =  0.0002492108069247607
    c_sba_slope:  float = -0.0006959274902115039

    # K7/L7: C RTO% (caught-stealing rate, keyed on C ARM)
    c_rto_const:  float =  0.0036822242562471307
    c_rto_slope:  float =  0.0024163633972008112

    # ── 1B regressions ───────────────────────────────────────────────────────

    # 1B RANGE: rating → made/TOTAL (PM%). These *_pm_* slots are the no-metadata FALLBACK; the live build
    # recomputes them from the sims (regressions.py, cached). Reverted from OAA 2026-06-28 (OAA tail-biased,
    # FIELDING_DENOMINATOR_DECISION.md; reverted-from OAA: rng 0.000915, ht 0.000345); centered ⇒ const ≈ 0.
    first_pm_const:      float =  0.0
    first_pm_rng_slope:  float =  0.001002977655284526
    first_pm_ht_slope:   float =  0.0003878808525983733

    # K11/L11: 1B E%
    first_err_const:     float =  3.1813551428886712e-06
    first_err_slope:     float = -7.899565261391058e-05

    # ── 2B regressions ───────────────────────────────────────────────────────

    # 2B RANGE: rating → made/TOTAL (PM%; fallback, live path recomputes). Reverted-from OAA: rng 0.003772, arm 0.000261.
    second_pm_const:     float =  0.0
    second_pm_rng_slope: float =  0.0037556628914973407
    second_pm_arm_slope: float =  0.00031640848444508296

    # K15/L15: 2B E% — Excel intercept corrected. The "Fielding Reg IF" sheet's
    # AP column subtracted $AC$118 (zone-rating total) instead of $AD$118 (errors
    # total), corrupting the centering and thus the LINEST intercept (AU86). Slope
    # is centering-invariant and unaffected. Was 0.007874640770265841. See
    # Spreadsheet/docs/KNOWN_BUGS.md Bug 13.
    second_err_const:    float = -2.3808211729618375e-05
    second_err_slope:    float = -0.00013250009062873734

    # K17/L17: 2B DP
    second_dp_const:     float =  3.0808116284891662e-06
    second_dp_slope:     float =  0.0001616565535000799

    # ── 3B regressions ───────────────────────────────────────────────────────

    # 3B RANGE: rating → made/TOTAL (PM%; fallback, live path recomputes). Reverted-from OAA: rng 0.001328, arm 0.001351.
    third_pm_const:      float =  0.0
    third_pm_rng_slope:  float =  0.0013781937691086114
    third_pm_arm_slope:  float =  0.0013632388402701617

    # K21/L21: 3B E%
    third_err_const:     float = -2.5281452967541396e-05
    third_err_slope:     float = -0.00021286232767740794

    # ── SS regressions ───────────────────────────────────────────────────────

    # SS RANGE: rating → made/TOTAL (PM%; fallback, live path recomputes). Reverted-from OAA: rng 0.004071, arm 0.001614.
    ss_pm_const:         float =  0.0
    ss_pm_rng_slope:     float =  0.004131565657882436
    ss_pm_arm_slope:     float =  0.0016120252281730022

    # K25/L25: SS E% — Excel intercept corrected. Two centering bugs in the
    # "Fielding Reg IF" SS block: AP subtracted $AC$197 (zone-rating total) not
    # $AD$197 (errors total), and AQ centered on $F$118 (2B's avg rating) instead
    # of $F$197 (SS's own). Both only shift the LINEST intercept (AU165); the slope
    # is unaffected. Was 0.015278208342137478. See Spreadsheet/docs/KNOWN_BUGS.md Bug 13.
    ss_err_const:        float =  1.204902615357462e-05
    ss_err_slope:        float = -0.0002744909984624334

    # K45/L45: SS DP (separate from 2B DP; uses Q25 as avg TDP)
    ss_dp_const:         float =  1.465003819891133e-05
    ss_dp_slope:         float =  0.00011510364277643594

    # ── LF regressions ───────────────────────────────────────────────────────

    # LF RANGE: rating → made/TOTAL (PM%; fallback, live path recomputes). Reverted-from OAA slope 0.003075.
    lf_pm_const:         float =  0.0
    lf_pm_slope:         float =  0.0031340210977502145

    # K29/L29: LF E%
    lf_err_const:        float = -3.4462774109098156e-05
    lf_err_slope:        float = -0.00018798622781514786

    # K31/L31: LF ARM
    lf_arm_const:        float = -1.030977453998843e-05
    lf_arm_slope:        float =  0.00017944483516864609

    # ── CF regressions ───────────────────────────────────────────────────────

    # CF RANGE: rating → made/TOTAL (PM%; fallback, live path recomputes). Reverted-from OAA slope 0.004564
    # (OAA de-steepened CF chasing a tail-biased ZR; made/TOTAL re-steepens — FIELDING_DENOMINATOR_DECISION.md).
    cf_pm_const:         float =  0.0
    cf_pm_slope:         float =  0.005035728341437424

    # K35/L35: CF E%
    cf_err_const:        float =  2.1654252079945865e-05
    cf_err_slope:        float = -0.00020041389855391184

    # K37/L37: CF ARM
    cf_arm_const:        float = -5.823384887873472e-06
    cf_arm_slope:        float =  0.00018579893515698281

    # ── RF regressions ───────────────────────────────────────────────────────

    # RF RANGE: rating → made/TOTAL (PM%; fallback, live path recomputes). Reverted-from OAA slope 0.002759.
    rf_pm_const:         float =  0.0
    rf_pm_slope:         float =  0.0029065972864713943

    # K41/L41: RF E%
    rf_err_const:        float = -7.722203634869723e-05
    rf_err_slope:        float = -0.00023123394889407696

    # K43/L43: RF ARM
    rf_arm_const:        float = -3.208169333898835e-05
    rf_arm_slope:        float =  0.00020431897628456845


@dataclass(frozen=True)
class PitchingRegressionCoeffs:
    """
    Rating → stat regression coefficients for pitchers.

    Source: 25 Regressions.xlsx / Data Points, columns N (h_const), O (h_slope),
            P (l_const), Q (l_slope).

    Starter coefficients: rows 3–10.  Reliever coefficients: rows 14–21.
    Pitcher SB% and SBA cubic coefficients: rows 23–26.
    """

    # Regressions Data Points rows 3–4: Starters / hCON / lCON
    sp_con: LinearCoeffs = LinearCoeffs(
        h_const=-0.0035476899891620627,
        h_slope=-0.001428544738645026,
        l_const=-0.00605335262770561,
        l_slope=-0.0032754677405578726,
    )

    # Regressions Data Points rows 5–6: Starters / hHRR / lHRR
    sp_hrr: LinearCoeffs = LinearCoeffs(
        h_const=-0.0022014455437011867,
        h_slope=-0.0006534377957375309,
        l_const= 0.0012153110650454488,
        l_slope=-0.0012346031880952992,
    )

    # Regressions Data Points rows 7–8: Starters / hSTU / lSTU
    sp_stu: LinearCoeffs = LinearCoeffs(
        h_const= 0.004325680266848777,
        h_slope= 0.0035392696304977693,
        l_const= 0.018311024519354843,
        l_slope= 0.006393418699708328,
    )

    # Regressions Data Points rows 9–10: Starters / hBABIP / lBABIP
    sp_babip: LinearCoeffs = LinearCoeffs(
        h_const= 2.488651793013013e-05,
        h_slope=-0.0008475079214598371,
        l_const= 2.488651793013013e-05,
        l_slope=-0.0008475079214598371,
    )

    # Regressions Data Points rows 15–16 (label row 14): Relievers / hCON / lCON
    rp_con: LinearCoeffs = LinearCoeffs(
        h_const=-0.0056565116503743615,
        h_slope=-0.001306178318252707,
        l_const=-0.014046397093491465,
        l_slope=-0.004003368976984335,
    )

    # Regressions Data Points rows 17–18 (label row 16): Relievers / hHRR / lHRR
    rp_hrr: LinearCoeffs = LinearCoeffs(
        h_const=-0.0018280388542870906,
        h_slope=-0.0006544336527405227,
        l_const=-0.002457889076308799,
        l_slope=-0.0015022649273308086,
    )

    # Regressions Data Points rows 19–20 (label row 18): Relievers / hSTU / lSTU
    rp_stu: LinearCoeffs = LinearCoeffs(
        h_const= 0.004716423826817736,
        h_slope= 0.0036132921482360894,
        l_const= 0.021514220537781122,
        l_slope= 0.005956178780489508,
    )

    # Regressions Data Points rows 21–22 (label row 20): Relievers / hBABIP / lBABIP
    rp_babip: LinearCoeffs = LinearCoeffs(
        h_const= 8.142206268767115e-06,
        h_slope=-0.0008043027593096815,
        l_const= 8.142206268767115e-06,
        l_slope=-0.0008043027593096815,
    )

    # Pitcher baserunning (sp_sb_pct/rp_sb_pct/sba) is applied as poly + lg_rate (pitchers.py 344-349). As on
    # the hitter side, c0 is the average-hold pitcher's offset relative to the *pooled* lg rate and is NOT ~0
    # (the recompute returns 0 only because the fit centers the outcome — see HittingRegressionCoeffs note).
    # These are the canonical calibration intercepts, kept here and re-applied over the recompute.

    # Regressions Data Points rows 23–24: SP SB% / X  (cubic; c2=c3=0)
    sp_sb_pct: CubicCoeffs = CubicCoeffs(
        c0=-0.01179124984884817,
        c1=-0.00254143972877271,
    )

    # Regressions Data Points rows 27–28: RP SB% / X  (cubic; c2=c3=0)
    rp_sb_pct: CubicCoeffs = CubicCoeffs(
        c0=-0.007441413482453901,
        c1=-0.00254143972877271,
    )

    # Regressions Data Points rows 25–26: SBA / X  (cubic; c2=c3=0). Shared SP/RP.
    sba: CubicCoeffs = CubicCoeffs(
        c0= 0.0007224917422994285,
        c1=-0.0017724275964245081,
    )

    # OOTP-27 D-SBASPLIT: 27 calibrates SP and RP Hold→SBA% separately. When set, the RP path uses
    # this instead of the shared `sba`. None for 26 (the default) ⇒ RP shares `sba`, exactly as before —
    # the 26 behavior is unchanged by construction. See OOTP27_WIRING_IMPLEMENTATION_SPEC.md §7.2.
    rp_sba: "CubicCoeffs | PiecewiseCoeffs | None" = None


# ---------------------------------------------------------------------------
# Section 1b — OOTP-27 regression coefficients (hardcoded piecewise constants)
# ---------------------------------------------------------------------------
# Source of truth: analysis/test-league-design/outputs/KNOT_DECISIONS_27.md (knots at absolute
# de-quantized display; slopes per display point) via OOTP27_WIRING_IMPLEMENTATION_SPEC.md §7.
# 27 does NOT use the sims auto-fit (decision PD3b): the fit machinery is single-segment-@50 and
# cannot represent these multi-knot / off-50 / clamped curves. `export._detect_metadata` selects
# these sets when the league's ootp_version == "27"; the 26 path is untouched.
#
# Transcription rule (spec §2/§7): RELATIVE-regime rows store knot OFFSETS = knot_abs − calib_avg
# (calib_avg = the calibration pool's leagueAvg.display for that rating — since the 2026-07-02
# H-pool RE-LOCK from analysis/test-league-design/outputs/viz/hpool_hitpit_bins.json, except the
# two kept Move rows whose averages stay C-pool viz_data.json; full precision); the applicator
# re-adds the per-league lg.avg at build time so knots slide with each league's average.
# ABSOLUTE-regime rows (SPE/STE/RUN/HLD + all fielding) store knots at absolute display, unchanged.
# Baserunning c0s are the canonical 26 intercepts (spec §2.5/§7.4 — pooled-vs-average-rated offset).
# Fielding consts and every 26 scalar reused for 27 keep their 26 values (spec §7.4).


def _rel_knots(abs_knots: tuple[float, ...], calib_avg: float) -> tuple[float, ...]:
    """Absolute display knots → offsets-from-calibration-average (RELATIVE regime storage)."""
    return tuple(k - calib_avg for k in abs_knots)


# Calibration pool averages (full precision; spec §7 rounds to 1dp). RE-LOCK 2026-07-02: all rows
# except sp_hrr/rp_hrr are the H-POOL fit-weighted averages on the de-quantized display frame
# (hpool_hitpit_bins.json v2 leagueAvg.display) — they pair with the H-pool re-locked knots below.
# sp_hrr/rp_hrr stay C-pool (viz_data.json): the Move rows kept their C-pool locks (real-27
# referee rejected the H-pool candidates), and offsets = knot_abs − calib_avg move together.
_CALIB_AVG_27 = {
    "eye": 56.038, "power": 57.686, "k": 56.316, "babip": 57.407, "gap": 57.508,
    "sp_stu": 56.605, "sp_con": 57.313, "sp_hrr": 54.157, "sp_babip": 52.629,
    "rp_stu": 57.217, "rp_con": 56.308, "rp_hrr": 53.866, "rp_babip": 52.064,
}

# Every row below is transcribed from KNOT_DECISIONS_27.md (status LOCKED; fielding rows are the
# H-pool FINAL re-fit of 2026-07-01) via spec §7. Baserunning c0s are the canonical 26 intercepts
# (spec §2.5/§7.4). Values deliberately KEPT from 26 (🟡 borrowed, per the spec's open-decision
# defaults): all fielding *_const fields, the 1B height slope (D-1BHT — no 27 height calibration,
# orthogonal to range), the 2B/SS DP slopes (D-DP — no 27 DP calibration), and the OF-arm/error/
# RTO singles that were spot-checked substrate-robust and locked at their C-pool values.

DEFAULT_HITTING_REG_COEFFS_27 = HittingRegressionCoeffs(
    # "Eye → uBB%": 3 knots 26/49/79 (abs). RE-LOCKED 2026-07-02 (H-pool, de-quantized frame;
    # was C-pool 40/67/79 · 0.00271/0.00225/0.00150/0.00313). Elite 79 knee confirmed. R²0.9995.
    eye=PiecewiseCoeffs(
        knots=_rel_knots((26.0, 49.0, 79.0), _CALIB_AVG_27["eye"]),
        slopes=(0.00056, 0.00256, 0.00176, 0.00579),
        relative=True,
    ),
    # "Power → HR%": 2 knots 36/79, convex w/ elite surge. RE-LOCKED 2026-07-02 (H-pool,
    # de-quantized frame; was C-pool 50/80 · 0.00086/0.00141/0.00229). R²0.9994.
    power=PiecewiseCoeffs(
        knots=_rel_knots((36.0, 79.0), _CALIB_AVG_27["power"]),
        slopes=(0.00042, 0.00116, 0.00400),
        relative=True,
    ),
    # "AvoidK → K%": clamp-low floor ≤15 (K% ceiling ~0.57), single in-band slope above 44.
    # RE-LOCKED 2026-07-02 (H-pool, de-quantized frame; was C-pool 24/29/69). R²0.9990.
    k=PiecewiseCoeffs(
        knots=_rel_knots((15.0, 44.0), _CALIB_AVG_27["k"]),
        slopes=(0.0, -0.00897, -0.00483),
        relative=True,
        clamp_lo=True,
    ),
    # "BABIP → BABIP": 3 knots 22/43/78 (diminishing low + elite re-steepen). RE-LOCKED
    # 2026-07-02 (H-pool, de-quantized frame; was C-pool 26/33 · 0.01305/0.00385/0.00201). R²0.9997.
    babip=PiecewiseCoeffs(
        knots=_rel_knots((22.0, 43.0, 78.0), _CALIB_AVG_27["babip"]),
        slopes=(0.00422, 0.00282, 0.00192, 0.00415),
        relative=True,
    ),
    # "Gap → XBH%": 3 knots 30/49/79, S-shape w/ elite surge. RE-LOCKED 2026-07-02 (H-pool,
    # de-quantized frame; was C-pool 25/51/76 · 0.01152/0.00461/0.00307/0.00489). R²0.9994.
    gap=PiecewiseCoeffs(
        knots=_rel_knots((30.0, 49.0, 79.0), _CALIB_AVG_27["gap"]),
        slopes=(0.00389, 0.00584, 0.00237, 0.00893),
        relative=True,
    ),
    # "Speed → 3B%": clamp-low floor <34, knee 50 (ABSOLUTE — SPE). RE-LOCK 2026-07-02: free
    # H-pool K-ladder CONFIRMS the knots; slopes under the v2 conventions (≤1% moves). R²0.999.
    speed=PiecewiseCoeffs(
        knots=(34.0, 50.0),
        slopes=(0.0, 0.00312, 0.00281),
        relative=False,
        clamp_lo=True,
    ),
    # BASERUNNING[hit] "Steal → SBA%": 3 knots 37/55/72, monotone-accelerating (ABSOLUTE — STE);
    # c0 = canonical 26 intercept. RE-LOCK 2026-07-02: free H-pool K-ladder CONFIRMS the knots
    # (an extra off-real-band 84 decel knee rejected); slopes ≤1.3% moves. R²0.997.
    sba=PiecewiseCoeffs(
        knots=(37.0, 55.0, 72.0),
        slopes=(0.00076, 0.00182, 0.00642, 0.01172),
        relative=False,
        c0=0.009116895606791357,
    ),
    # BASERUNNING[hit] "Steal → SB%" — STEP FORM, RE-LOCKED 2026-07-02 (free H-pool K-ladder):
    # SB% is a hard engine step at STE≈35 — flat ~0.29 floor ≤34, jump to ~0.50 across 34→36,
    # then +0.0101 to 72, decel above. The step is on BOTH substrates (C-pool bins jump
    # 0.366→0.503 across STE 34); the previous clamp-lo [26,70] smeared it (R²0.979→0.997).
    # c0 = canonical 26. ⚠ the 34–36 segment is steep (±0.09/pt) — sensitive to display
    # quantization of real inputs around STE 35 (documented in KNOT_DECISIONS_27).
    sb_pct=PiecewiseCoeffs(
        knots=(34.0, 36.0, 72.0),
        slopes=(0.0, 0.09328, 0.01014, 0.00157),
        relative=False,
        clamp_lo=True,
        c0=-0.13320702812059265,
    ),
    # BASERUNNING[hit] "Running → UBR/opp": single line (ABSOLUTE — RUN); c0 = canonical 26.
    # RE-LOCK 2026-07-02: single CONFIRMED (free ladder's ≥75 flattening immaterial).
    ubr=PiecewiseCoeffs(
        knots=(),
        slopes=(0.00019,),
        relative=False,
        c0=3.093821597831973e-05,
    ),
)

DEFAULT_PITCHING_REG_COEFFS_27 = PitchingRegressionCoeffs(
    # [SP] "Stuff → K%": 3 knots 32/42/78 w/ elite convexity ≥78 (real, D24). RE-LOCKED
    # 2026-07-02 (H-pool, de-quantized frame; was C-pool 32/52 · 0.01449/0.00361/0.00425).
    # (SP section applies POS −5 upstream, as in 26.) R²0.9994.
    sp_stu=PiecewiseCoeffs(
        knots=_rel_knots((32.0, 42.0, 78.0), _CALIB_AVG_27["sp_stu"]),
        slopes=(0.01315, 0.00603, 0.00339, 0.01078),
        relative=True,
    ),
    # [SP] "Control → uBB%": K=4, monotone diminishing w/ mild elite re-steepen ≥78. RE-LOCKED
    # 2026-07-02 (H-pool, de-quantized frame; was C-pool 27/35/49/63). R²0.9998.
    sp_con=PiecewiseCoeffs(
        knots=_rel_knots((22.0, 42.0, 50.0, 78.0), _CALIB_AVG_27["sp_con"]),
        slopes=(-0.00573, -0.00475, -0.00291, -0.00125, -0.00182),
        relative=True,
    ),
    # [SP] "Move → HR%": clean-4, monotone. C-POOL LOCK KEPT at the 2026-07-02 re-lock: the
    # real-27 referee rejects the H-pool candidate (1.72× real, z2.2) — see KNOT_DECISIONS_27 +
    # POOL_RECONCILIATION_PLAN §2 (knee is absolute-anchored ~50; H-pool avg 63.5 misplaces it
    # under relative storage). calib avg stays C-pool 54.157. R²0.999.
    sp_hrr=PiecewiseCoeffs(
        knots=_rel_knots((30.0, 39.0, 52.0, 65.0), _CALIB_AVG_27["sp_hrr"]),
        slopes=(-0.00481, -0.00296, -0.00159, -0.00087, -0.00048),
        relative=True,
    ),
    # [SP] "pbabip → BABIP": single line −0.00066. RE-LOCKED 2026-07-02 (H-pool, its threshold
    # map came free; was −0.00070). OOTP import ignores imported pbabip — immaterial channel.
    sp_babip=PiecewiseCoeffs(knots=(), slopes=(-0.00066,), relative=True),
    # [RP] "Stuff → K%": 2 knots 41/78 (elite re-steepen ≈ the C-pool's 75). RE-LOCKED
    # 2026-07-02 (H-pool, de-quantized frame; was C-pool 33/75 · 0.00846/0.00389/0.00649).
    # Consumed via _stu_delta_rp (SP-POS +5 preserved); displayed Stuff capped at 88 first (D24).
    rp_stu=PiecewiseCoeffs(
        knots=_rel_knots((41.0, 78.0), _CALIB_AVG_27["rp_stu"]),
        slopes=(0.00622, 0.00339, 0.01025),
        relative=True,
    ),
    # [RP] "Control → uBB%": K=4, mirrors SP. RE-LOCKED 2026-07-02 (H-pool, de-quantized frame;
    # was C-pool 27/35/48/63). R²0.9998.
    rp_con=PiecewiseCoeffs(
        knots=_rel_knots((23.0, 42.0, 50.0, 78.0), _CALIB_AVG_27["rp_con"]),
        slopes=(-0.00549, -0.00472, -0.00290, -0.00123, -0.00175),
        relative=True,
    ),
    # [RP] "Move → HR%": clean-4, monotone. C-POOL LOCK KEPT (as sp_hrr — referee rejection
    # 2026-07-02; H-pool candidate would land 1.46× real). calib avg stays C-pool 53.866. R²1.000.
    rp_hrr=PiecewiseCoeffs(
        knots=_rel_knots((31.0, 40.0, 53.0, 67.0), _CALIB_AVG_27["rp_hrr"]),
        slopes=(-0.00449, -0.00259, -0.00159, -0.00081, -0.00037),
        relative=True,
    ),
    # [RP] "pbabip → BABIP": single line −0.00057. RE-LOCKED 2026-07-02 (as sp_babip; was −0.00058).
    rp_babip=PiecewiseCoeffs(knots=(), slopes=(-0.00057,), relative=True),
    # BASERUNNING[pit] "SP Hold → SBA%": single line (ABSOLUTE — HLD). 27 splits SP/RP
    # (D-SBASPLIT): `sba` carries the SP line, `rp_sba` the RP line; both reuse the shared 26
    # canonical c0 (26 had a single SP/RP sba intercept). RE-LOCK 2026-07-02: singles CONFIRMED
    # by free ladder; slopes under the v2 conventions (roster-role split; ≤3% moves).
    sba=PiecewiseCoeffs(
        knots=(),
        slopes=(-0.00148,),
        relative=False,
        c0=0.0007224917422994285,
    ),
    rp_sba=PiecewiseCoeffs(
        knots=(),
        slopes=(-0.00105,),
        relative=False,
        c0=0.0007224917422994285,
    ),
    # BASERUNNING[pit] "SP Hold → SB%": 2 knots 42/63 (ABSOLUTE); c0 = canonical 26 sp_sb_pct.
    # RE-LOCK 2026-07-02: knots CONFIRMED (free [40,64] within noise); slopes ≤1.5% moves.
    sp_sb_pct=PiecewiseCoeffs(
        knots=(42.0, 63.0),
        slopes=(-0.00159, -0.00059, -0.00202),
        relative=False,
        c0=-0.01179124984884817,
    ),
    # BASERUNNING[pit] "RP Hold → SB%": 2 knots 42/64 (ABSOLUTE); c0 = canonical 26 rp_sb_pct.
    # RE-LOCK 2026-07-02: knots CONFIRMED (free [45,64] within noise); slopes ≤3% moves.
    rp_sb_pct=PiecewiseCoeffs(
        knots=(42.0, 64.0),
        slopes=(-0.00181, -0.00069, -0.00243),
        relative=False,
        c0=-0.007441413482453901,
    ),
)

# Fielding: ABSOLUTE regime throughout (knots at absolute display). Range/framing rows are
# PiecewiseCoeffs in the 26 scalar-slope slots (compute_fielding dispatches on type); single-line
# 27 rows replace the scalar value; consts and the D-1BHT/D-DP slopes keep their 26 defaults.
DEFAULT_FIELDING_REG_COEFFS_27 = FieldingRegressionCoeffs(
    # "SS range → PM%" (H-pool FINAL): flat-low → gentle → steep. R²0.991.
    ss_pm_rng_slope=PiecewiseCoeffs(
        knots=(62.0, 68.0),
        slopes=(0.00052, 0.00190, 0.00654),
        relative=False,
    ),
    # "CF range → PM%" (H-pool FINAL): floor <62 / accelerating rise / saturate ≥71. R²0.994.
    cf_pm_slope=PiecewiseCoeffs(
        knots=(62.0, 66.0, 71.0),
        slopes=(0.00009, 0.00665, 0.01200, 0.0),
        relative=False,
        clamp_hi=True,
    ),
    # "2B range → PM%" (H-pool FINAL): S-curve. R²0.996.
    second_pm_rng_slope=PiecewiseCoeffs(
        knots=(60.0, 69.0),
        slopes=(0.00067, 0.00879, 0.00112),
        relative=False,
    ),
    # "1B range → PM%" (H-pool FINAL, re-fit 2026-07-02): flat floor <36 / rise / saturate ≥49
    # (the earlier K=1 optimizer had stuck in a local optimum and missed the low floor). R²0.980.
    first_pm_rng_slope=PiecewiseCoeffs(
        knots=(36.0, 49.0),
        slopes=(0.00019, 0.00206, 0.00042),
        relative=False,
    ),
    # "LF range → PM%" (H-pool FINAL): S-curve, top clamped. R²0.995.
    lf_pm_slope=PiecewiseCoeffs(
        knots=(48.0, 56.0),
        slopes=(0.00125, 0.00715, 0.0),
        relative=False,
        clamp_hi=True,
    ),
    # "RF range → PM%" (H-pool FINAL): S-curve, top clamped. R²0.995.
    rf_pm_slope=PiecewiseCoeffs(
        knots=(50.0, 57.0),
        slopes=(0.00075, 0.00676, 0.0),
        relative=False,
        clamp_hi=True,
    ),
    # "3B range → PM%" (H-pool FINAL, re-fit 2026-07-02): high-end decel knee @70 (the tail
    # visibly saturates like every other position; knee location soft 68–72, documented). R²0.978.
    third_pm_rng_slope=PiecewiseCoeffs(
        knots=(70.0,),
        slopes=(0.00281, 0.00110),
        relative=False,
    ),
    # IF_Arm → PM% (H-pool FINAL). 3B gains a flat floor <39 (re-fit 2026-07-02, R²0.982);
    # 2B stays single (no structure, R²0.64); SS stays single (a borderline mid-band knee @58
    # exists, ΔR²+0.03 — documented, not adopted).
    second_pm_arm_slope=0.00074,
    third_pm_arm_slope=PiecewiseCoeffs(
        knots=(39.0,),
        slopes=(0.00032, 0.00309),
        relative=False,
    ),
    ss_pm_arm_slope=0.00091,
    # IF/OF error singles (H-pool FINAL, re-based 2026-07-02 — the H-pool is the declared final
    # fielding substrate; moves ≤17%, R²0.98–0.99 each).
    first_err_slope=-0.00004,
    second_err_slope=-0.00007,
    third_err_slope=-0.00021,
    ss_err_slope=-0.00020,
    lf_err_slope=-0.00022,
    cf_err_slope=-0.00018,
    rf_err_slope=-0.00028,
    # OF_Arm → arm/opp singles (H-pool FINAL, re-fit 2026-07-02 — the old KEPT LF/CF values
    # were stale-low vs both current substrates; RF unchanged). R²0.99 each.
    lf_arm_slope=0.00021,
    cf_arm_slope=0.00023,
    rf_arm_slope=0.00024,
    # "C C_Fram → fram/IP" (H-pool FINAL, real-27-validated): clamp-both. R²0.998.
    c_frm_slope=PiecewiseCoeffs(
        knots=(37.0, 73.0),
        slopes=(0.0, 0.00120, 0.0),
        relative=False,
        clamp_lo=True,
        clamp_hi=True,
    ),
    # "C C_Arm → SBA/IP" (H-pool FINAL): single line. R²0.92.
    c_sba_slope=-0.00086,
    # "C C_Arm → RTO%" (H-pool FINAL, re-fit 2026-07-02): steep / plateau / steep — the same
    # 2-knot structure appears independently on the C-pool ([38,63], R²0.958 vs single 0.872),
    # so it is real, not wiggle; the H-pool (realistic catchers) supplies the values. R²0.941.
    c_rto_slope=PiecewiseCoeffs(
        knots=(44.0, 63.0),
        slopes=(0.00113, 0.00016, 0.00175),
        relative=False,
    ),
    # NOT set (keep 26 defaults): every *_const; first_pm_ht_slope (D-1BHT); second_dp_* /
    # ss_dp_* (D-DP).
)


# ---------------------------------------------------------------------------
# Section 2 — League parameters (25 Metadata.xlsx / Data Points)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class HitterLeagueParams:
    """
    Batter-side league calibration constants from Metadata.xlsx / Data Points.

    Fields are grouped by their Excel column group in Metadata:
        Hitting rating averages : col E rows 2–9   (H2–H9 in main workbook)
        wOBA event weights      : col E rows 12–20 (H12–H20)
        Matchup splits          : col E rows 23–26 (H23–H26)
        League measurements     : col E rows 29–41 (H29–H41)
        Hitting stat rates      : col A rows 33–41 (C33–C41 in main workbook)

    Numeric defaults use the rounded values from the main workbook's Data Points
    sheet so that to_ballpark_constants() produces values identical to
    BallparkConstants() defaults in ballparks.py.
    """

    # ── Hitting rating averages (Metadata col E rows 2–9) ───────────────────
    avg_eye:   float = 49.82    # Metadata E2  — full: 49.8197356999269
    avg_power: float = 48.93    # Metadata E3  — full: 48.93329107273392
    avg_k:     float = 53.07    # Metadata E4  — full: 53.0672057748538
    avg_babip: float = 51.86    # Metadata E5  — full: 51.855497304459064
    avg_gap:   float = 52.24    # Metadata E6  — full: 52.237527412280706
    avg_speed: float = 47.61    # Metadata E7  — full: 47.610134548611114
    avg_steal: float = 50.46    # Metadata E8  — full: 50.462696454678365
    avg_bsr:   float = 54.29    # Metadata E9  — full: 54.28887975146199

    # ── wOBA event weights (Metadata col E rows 12–20) ──────────────────────
    wt_hbp:    float = 0.7268   # Metadata E12 — full: 0.7267987407870178
    wt_bb:     float = 0.6971   # Metadata E13 — full: 0.697108843140001
    wt_1b:     float = 0.8812   # Metadata E14 — full: 0.8811862085515052
    wt_2b:     float = 1.2375   # Metadata E15 — full: 1.237464980315707
    wt_3b:     float = 1.5581   # Metadata E16 — full: 1.5581158749034887
    wt_hr:     float = 1.9872   # Metadata E17 — full: 1.9871547124530322
    wt_sb:     float = 0.2375   # Metadata E18 — full: 0.2375191811761345
    wt_cs:     float = -0.5017  # Metadata E19 — full: -0.5017196371342825
    woba_scale: float = 1.1876  # Metadata E20 — full: 1.1875959058806724

    # ── Matchup splits — fraction of PA vs RHP, by batter hand (Metadata E23–E26) ──
    lvr:    float = 0.776   # Metadata E23 — LHB fraction vs RHP; full: 0.7759174096668231
    rvr:    float = 0.720   # Metadata E24 — RHB fraction vs RHP; full: 0.7201749760774894
    svr:    float = 0.741   # Metadata E25 — SHB fraction vs RHP; full: 0.7414885397888231
    ovr_vr: float = 0.739   # Metadata E26 — overall vR fraction;  full: 0.7394976699561403

    # ── League measurements (Metadata col E rows 29–41) ─────────────────────
    lg_woba:   float = 0.32263  # Metadata E29 — full: 0.3226257604360157
    waa_const: float = 10.073   # Metadata E30 — full: 10.07272219530025
    pa:        float = 600.0    # Metadata E31 — season plate appearances
    pa_c:      float = 500.0    # Metadata E32 — catcher PA
    ip:        float = 1200.0   # Metadata E33 — inning benchmark
    ip_c:      float = 1000.0   # Metadata E34 — catcher IP benchmark
    run_cs:    float = -0.422   # Metadata E35 — run value of CS; full: -0.42246662745290264
    wsb:       float = 0.006601 # Metadata E36 — wSB constant; full: 0.006601203459485072
    hbp_rate:  float = 0.010154 # Metadata E37 — HBP per PA; full: 0.010153965643274854
    inf_out:   float = 0.75     # Metadata E38 — infield out fraction
    of_out:    float = 0.90     # Metadata E39 — outfield out fraction
    r_per_pa:  float = 0.12145  # Metadata E40 — runs per PA; full: 0.12144782529239766
    bpk_woba:  float = 0.32576  # main workbook H41 — break-point key wOBA

    # ── Hitting stat rates (Metadata col A rows 33–41; C33–C41 in main workbook) ──
    bb_rate:     float = 0.08749   # Metadata A33 — full: 0.08748886652554626
    hr_rate:     float = 0.03429   # Metadata A34 — full: 0.034292759499462984
    so_rate:     float = 0.24754   # Metadata A35 — full: 0.24753576399260252
    babip:       float = 0.30309   # Metadata A36 — full: 0.30308550810509655
    xbh_rate:    float = 0.26392   # Metadata A37 — full: 0.26391806722689076
    triple_rate: float = 0.08966   # Metadata A38 — full: 0.0896627971254837
    sb_pct:      float = 0.78104   # Metadata A39 — full: 0.7810352725606963
    ubr:         float = -0.001380 # Metadata A40 — full: -0.00138026523592151
    sba_rate:    float = 0.10259   # Metadata A41 — full: 0.10259422878090046

    # ── WAR replacement-level (FG-standard) ─────────────────────────────────
    # A full-time non-catcher (600 PA) accrues +20 runs of replacement credit,
    # yielding ~+2.0 WAR for a league-average player. Catchers automatically
    # receive a smaller bonus (~+16.67 R at pa_c=500) via the lower PA benchmark.
    repl_runs_per_pa: float = 20.0 / 600.0   # ≈ 0.03333 R/PA

    def to_ballpark_constants(self) -> "BallparkConstants":
        """
        Bridge: construct a BallparkConstants from the subset of fields shared
        with the Ballparks computation.

        The 21 fields map 1-to-1 between HitterLeagueParams and BallparkConstants.
        Using default HitterLeagueParams values produces a BallparkConstants
        identical to DEFAULT_CONSTANTS in ballparks.py.
        """
        from src.ballparks import BallparkConstants
        return BallparkConstants(
            pa=self.pa,
            lg_woba=self.lg_woba,
            woba_scale=self.woba_scale,
            r_per_pa=self.r_per_pa,
            wt_hbp=self.wt_hbp,
            wt_bb=self.wt_bb,
            wt_1b=self.wt_1b,
            wt_2b=self.wt_2b,
            wt_3b=self.wt_3b,
            wt_hr=self.wt_hr,
            lvr=self.lvr,
            rvr=self.rvr,
            svr=self.svr,
            ovr_vr=self.ovr_vr,
            hbp_rate=self.hbp_rate,
            bb_rate=self.bb_rate,
            hr_rate=self.hr_rate,
            so_rate=self.so_rate,
            babip=self.babip,
            xbh_rate=self.xbh_rate,
            triple_rate=self.triple_rate,
        )


# ---------------------------------------------------------------------------
# Frozen positional adjustments (multi-year blended spectrum, per universe)
# ---------------------------------------------------------------------------
# Computed from each league's full career history in
# Leftovers/positional-adjustments/pos_adj_grid.json:
#   - method   : ½ Zimmerman defensive position-switcher on ZR + ½ offense, with
#                catcher and DH from offense only (the switcher can't rate them
#                — multi-position catchers are a self-selected non-representative
#                sample; see Leftovers/positional-adjustments/SAMPLE_SIZE_AUDIT.md).
#   - def recency : H_def = 5, cut_def = 20 (widened 2026-05-29 from H=2.5/cut=8
#                   per the per-position-pair bootstrap-SE audit — the switcher
#                   has FAR fewer effective obs per pair than the offense method,
#                   and the locked window left 3-4 adjacent-pair differences in
#                   the noise floor).
#   - off recency : H_off = 2.5, cut_off = 8 (unchanged — offense has ~10× the
#                   switcher's data and was never the sample-size concern).
#   - DH rule  : DH = min(spec[k] for all 9) — tie DH to the lowest position unless
#                DH itself is already lowest (locked 2026-05-28).
#   - anchor   : field-8 mean = 0 — the 8 defensive positions average to zero, DH
#                sits below as the no-defense deficit (Zimmerman 2014 / FanGraphs
#                convention; see Leftovers/positional-adjustments/POSITIONAL_ADJUSTMENTS.md:96-98).
# Lookup key = league's statsplus_url (Project/leagues/<slug>/league.json). The 6
# league dashboards fold into 2 underlying universes: the 4 BLM-* slugs all share
# statsplus.net/blm/, and SSB + default share atl-01.statsplus.net/ssb/.
# Re-derive periodically from the grid; do NOT hand-edit.
# Validated end-to-end in Leftovers/posadj-bestpos-impact/IMPACT.md.
# Units: runs/162.
_FROZEN_POS_ADJ_BY_URL: dict[str, dict[str, float]] = {
    "https://statsplus.net/blm/": {  # BLM (BLM-ATL, BLM-COL, BLM-MIA, BLM-NYM)
        "C":  16.1, "1B": -13.1, "2B":  -2.3, "3B":  -0.7, "SS":  9.6,
        "LF":  -8.4, "CF":  5.1, "RF":  -6.2, "DH": -13.1,
    },
    "https://atl-01.statsplus.net/ssb/": {  # SSB, default
        "C":  21.0, "1B": -12.4, "2B":  -0.3, "3B":  -1.0, "SS": 10.4,
        "LF": -12.0, "CF":  2.3, "RF":  -8.1, "DH": -13.0,
    },
}
# Fallback for unknown league URLs: BLM spectrum (most-tested, most-data-supported
# — 42 yrs vs SSB's 22). Also matches the FieldingParams pos_* dataclass defaults.
_FROZEN_POS_ADJ_DEFAULT: dict[str, float] = _FROZEN_POS_ADJ_BY_URL["https://statsplus.net/blm/"]


def get_frozen_pos_adj(statsplus_url: str | None) -> dict[str, float]:
    """Return the frozen 9-position spectrum (runs/162) for a league.

    Looks up by `statsplus_url` (from `Project/leagues/<slug>/league.json`).
    Falls back to the BLM spectrum for unknown / missing URLs.
    """
    key = (statsplus_url or "").strip()
    return dict(_FROZEN_POS_ADJ_BY_URL.get(key, _FROZEN_POS_ADJ_DEFAULT))


@dataclass(frozen=True)
class FieldingParams:
    """
    Fielding-related league parameters from Metadata.xlsx / Data Points.

    Position adjustments (pos_*) are WAR/162 values from Metadata col O rows 2–10.
    Primary rating averages are from the P column in the regression area.
    Secondary rating averages (arm, height, error, TDP) from P/Q columns.
    Scaling constants (PA/IP per position, league PM%, E%, etc.) from column T.
    """

    # ── Position adjustments — runs/162 ─────────────────────────────────────
    # Frozen from the multi-year blended defensive-switcher spectrum at H=2.5 / cutoff=8y
    # (Leftovers/positional-adjustments/pos_adj_grid.json). DH-tied-to-lowest rule applied,
    # then re-centered to FIELD-8 MEAN = 0 (Zimmerman 2014 / FanGraphs convention: the 8
    # defensive positions average to zero; DH sits below as a no-defense deficit).
    # Defaults below are the BLM spectrum; SSB has its own via _FROZEN_POS_ADJ_BY_URL.
    # The live path (compute_fielding_constants → _compute_position_adjustments) looks up
    # by statsplus_url; these defaults are the no-sims / unknown-league fallback.
    pos_c:   float =  16.1
    pos_1b:  float = -13.1
    pos_2b:  float =  -2.3
    pos_3b:  float =  -0.7
    pos_ss:  float =   9.6
    pos_lf:  float =  -8.4
    pos_cf:  float =   5.1
    pos_rf:  float =  -6.2
    pos_dh:  float = -13.1

    # ── Primary fielding rating averages (P column) ──────────────────────────
    avg_frm_c:  float = 62.69286389219835    # P3  — C framing rating avg
    avg_rng_1b: float = 44.872769563323445   # P9  — 1B range rating avg
    avg_rng_2b: float = 60.49494982700383    # P13 — 2B range rating avg
    avg_rng_3b: float = 54.64549476939269    # P19 — 3B range rating avg
    avg_rng_ss: float = 67.09107669009565    # P23 — SS range rating avg
    avg_rng_lf: float = 56.062455309810886   # P27 — LF range rating avg
    avg_rng_cf: float = 67.22310730797972    # P33 — CF range rating avg
    avg_rng_rf: float = 58.21813536206645    # P39 — RF range rating avg

    # ── Catcher secondary averages ───────────────────────────────────────────
    avg_arm_c:  float = 54.326239677909705   # P5/P7 — C ARM avg (shared by SBA and RTO)

    # ── Infield secondary averages ───────────────────────────────────────────
    avg_ht_1b:   float = 189.80621752459544  # Q9  — 1B avg height (cm)
    avg_err_1b:  float = 44.06689460750067   # P11 — 1B IF ERR avg
    avg_arm_2b:  float = 51.331864989028496  # Q13 — 2B IF ARM avg
    avg_err_2b:  float = 57.26937269372693   # P15 — 2B IF ERR avg
    avg_tdp_2b:  float = 60.88745798371122   # P17 — 2B TDP avg
    avg_arm_3b:  float = 65.05300513191655   # Q19 — 3B IF ARM avg
    avg_err_3b:  float = 57.0978353839068    # P21 — 3B IF ERR avg
    avg_arm_ss:  float = 62.61201461704337   # Q23 — SS IF ARM avg
    avg_err_ss:  float = 60.507152145643694  # P25 — SS IF ERR avg
    avg_tdp_ss:  float = 61.969885269378295  # Q25 — SS TDP avg

    # ── Outfield secondary averages ──────────────────────────────────────────
    avg_err_lf:  float = 55.19289723927641   # P29 — LF OF ERR avg
    avg_arm_lf:  float = 59.18645363315827   # P31 — LF OF ARM avg
    avg_err_cf:  float = 56.366581534191226  # P35 — CF OF ERR avg
    avg_arm_cf:  float = 56.74023371738756   # P37 — CF OF ARM avg
    avg_err_rf:  float = 55.23340837016713   # P41 — RF OF ERR avg
    avg_arm_rf:  float = 63.427594932549006  # P43 — RF OF ARM avg

    # ── Scaling constants (column T) ─────────────────────────────────────────
    # Catcher
    c_frm_scale:  float = 1.8191528696438106   # T2 — C FRM/1000
    c_sba_scale:  float = 104.34246744176491   # T3 — C SBA/1000
    c_rto_lg:     float = 0.2090715804394047   # T4 — league C RTO%

    # 1B
    first_pa:     float = 277.480705849477     # T5  — 1B PA/1200
    first_pm_lg:  float = 0.8487950522499467   # T6  — 1B league PM%
    first_err_lg: float = 0.03077889447236181  # T7  — 1B league E%

    # 2B
    second_pa:     float = 570.0638565405696   # T8  — 2B PA/1200
    second_pm_lg:  float = 0.6484845339422878  # T9  — 2B league PM%
    second_err_lg: float = 0.02112845138055222 # T10 — 2B league E%
    second_dp_pa:  float = 88.01847483953678   # T11 — 2B DP/1200

    # 3B
    third_pa:     float = 352.79952628462405   # T12 — 3B PA/1200
    third_pm_lg:  float = 0.8202416918429003   # T13 — 3B league PM%
    third_err_lg: float = 0.04685901370984244  # T14 — 3B league E%

    # SS
    ss_pa:     float = 609.2344158943886   # T15 — SS PA/1200
    ss_pm_lg:  float = 0.6878221962844081  # T16 — SS league PM%
    ss_err_lg: float = 0.0407268613448349  # T17 — SS league E%

    # LF
    lf_pa:     float = 401.213107478364      # T18 — LF PA/1200
    lf_pm_lg:  float = 0.584070796460177     # T19 — LF league PM%
    lf_err_lg: float = 0.010101010101010102  # T20 — LF league E%
    lf_arm_lg: float = -0.4941193875286634   # T21 — LF league arm runs

    # CF
    cf_pa:     float = 568.9236353483178     # T22 — CF PA/1200
    cf_pm_lg:  float = 0.6449802535855331    # T23 — CF league PM%
    cf_err_lg: float = 0.00821785368997744   # T24 — CF league E%
    cf_arm_lg: float = -0.19807671777352595  # T25 — CF league arm runs

    # RF
    rf_pa:     float = 434.15435679192905    # T26 — RF PA/1200
    rf_pm_lg:  float = 0.5792628925676137    # T27 — RF league PM%
    rf_err_lg: float = 0.011995766200164648  # T28 — RF league E%
    rf_arm_lg: float = 3.4959496541185393   # T29 — RF league arm runs

    # SS DP
    ss_dp_pa:  float = 77.27280209379268   # T30 — SS DP/1200


@dataclass(frozen=True)
class PitcherLeagueParams:
    """
    Pitcher-side league calibration constants.

    Sources:
        Metadata.xlsx / Data Points col T:
            rows 2–5   : SP rating averages
            rows 7–10  : RP rating averages
            rows 23–26 : pitcher matchup splits
            rows 31–34 : season workload totals
            rows 41–42 : RA/9 baselines

        The Sheet Pitchers.xlsx / Data Points:
            col H rows 11–20 : SP wOBA weights (different from hitter weights)
            col H rows 29–42 : league measurements (lg_woba, WAA const, RA/9, etc.)
            col I rows 2,7   : HLD baselines for SBA/SB% cubic polynomials
            col I rows 29,31 : wOBA normalization for RA/9 quadratic
            col K rows 3–12  : SP league stat rates (different from hitter rates)
            col K rows 15–24 : RP league stat rates
            col K rows 28–37 : RP wOBA weights

    Pitcher wOBA weights and league stat rates are ALL distinct from hitter
    values. SP and RP also have separate weight/rate sets. The only shared
    constant is waa_const (H30), which is identical across both workbooks.
    """

    # ── SP rating averages (Metadata col T rows 2–5) ─────────────────────────
    # Full precision required — pitcher spreadsheet uses unrounded values
    avg_stu_sp:    float = 49.115951742627345   # Metadata T2
    avg_hrr_sp:    float = 52.673688242052854   # Metadata T3
    avg_pbabip_sp: float = 53.11298353121409    # Metadata T4
    avg_con_sp:    float = 50.7835599387208     # Metadata T5

    # ── RP rating averages (Metadata col T rows 7–10) ────────────────────────
    avg_stu_rp:    float = 51.39180921194364    # Metadata T7
    avg_hrr_rp:    float = 50.61226248438106    # Metadata T8
    avg_pbabip_rp: float = 51.26739626868887    # Metadata T9
    avg_con_rp:    float = 46.535934335818      # Metadata T10

    # ── Pitcher matchup splits — fraction of BF vs RHB (Metadata T23–T26) ───
    # Note: these are pitcher-side splits (different values from batter-side splits)
    # Full precision required — pitcher spreadsheet uses unrounded values
    lvr:    float = 0.7451229406991922   # Metadata T23 — LHP fraction vs RHB
    rvr:    float = 0.5693559197298044   # Metadata T24 — RHP fraction vs RHB
    svr:    float = 0.6170624281884336   # Metadata T25 — switch-pitcher frac
    ovr_vr: float = 0.6170624281884336   # Metadata T26 — overall vR fraction

    # ── Season workload totals (Metadata col T rows 31–34) ───────────────────
    bf_sp:  float = 800.0                # Metadata T31 — SP batters faced per season
    bf_rp:  float = 300.0                # Metadata T32 — RP batters faced per season
    ip_sp:  float = 185.46810317578175   # Metadata T33 — SP innings pitched
    ip_rp:  float = 69.55053869091816    # Metadata T34 — RP innings pitched

    # ── RA/9 performance baselines (Metadata col T rows 41–42) ───────────────
    ra9_sp: float = 4.7611714110178145   # Metadata T41 — SP RA/9 baseline
    ra9_rp: float = 4.642996890252694    # Metadata T42 — RP RA/9 baseline

    # ── RA/9 replacement-level baselines (for WAR) ──────────────────────────
    # FALLBACK ONLY. compute_pitching_constants() recomputes these per league as
    #   ra9_repl_sp = ra9_sp + FG_REPL_WPG_SP * waa_const   (FG starter = 0.12 W/9)
    #   ra9_repl_rp = ra9_rp + FG_REPL_WPG_RP * waa_const   (FG reliever = 0.03 W/9)
    # so they track each league's RA/9 + runs-per-win. The defaults below are the
    # OOTP26 baseline values, kept only for code paths that build params directly.
    ra9_repl_sp: float = 5.969898074453844   # = 4.7611714110178145 + 0.12*10.07272219530025
    ra9_repl_rp: float = 4.945178556111702   # = 4.642996890252694  + 0.03*10.07272219530025

    # ── HLD baselines for SBA/SB% cubic polynomials (Pitcher DP I column) ──
    avg_hld_sp: float = 55.96328035235541   # I2 — SP HLD baseline
    avg_hld_rp: float = 53.819208065836534  # I7 — RP HLD baseline

    # ── wOBA normalization for RA/9 quadratic (Pitcher DP I column) ─────────
    # These are computed neutral-park wOBA baselines; RA/9 = (wOBA/norm)^2 * ra9
    woba_norm_sp: float = 0.3234007681296262   # I31 — SP wOBA normalization
    woba_norm_rp: float = 0.32288142890309673  # I29 — RP wOBA normalization

    # ── SP wOBA weights (Pitcher DP H column, rows 11–20) ──────────────────
    # These are pitcher-calibrated weights, distinct from hitter weights.
    sp_lg_woba:    float = 0.3234594326010722   # H11/H29
    sp_wt_hbp:    float = 0.7263554742276241    # H12
    sp_wt_bb:     float = 0.6967679375760808    # H13
    sp_wt_1b:     float = 0.88021066481565      # H14
    sp_wt_2b:     float = 1.2352611046341706    # H15
    sp_wt_3b:     float = 1.5548065004708393    # H16
    sp_wt_hr:     float = 1.9803614850875026    # H17
    sp_wt_sb:     float = 0.23670029321234726   # H18
    sp_wt_cs:     float = -0.5039992094073612   # H19
    sp_woba_scale: float = 1.1835014660617362   # H20

    # ── RP wOBA weights (Pitcher DP K column, rows 28–37) ──────────────────
    rp_lg_woba:    float = 0.3229821666001417   # K28
    rp_wt_hbp:    float = 0.7212544858444867    # K29
    rp_wt_bb:     float = 0.6916669491929432    # K30
    rp_wt_1b:     float = 0.8751096764325125    # K31
    rp_wt_2b:     float = 1.2301601162510332    # K32
    rp_wt_3b:     float = 1.549705512087702     # K33
    rp_wt_hr:     float = 1.9803614850875026    # K34 — same as SP
    rp_wt_sb:     float = 0.23670029321234726   # K35 — same as SP
    rp_wt_cs:     float = -0.49379723264108627  # K36
    rp_woba_scale: float = 1.195327908633651    # K37

    # ── SP league stat rates (Pitcher DP K column, rows 3–12) ──────────────
    # These differ from hitter rates in HitterLeagueParams.
    sp_hbp_rate:    float = 0.009854376334248247   # K10
    sp_bb_rate:     float = 0.08457064725480001    # K3
    sp_hr_rate:     float = 0.03344868571909415    # K4
    sp_so_rate:     float = 0.24031513290067424    # K5
    sp_babip:       float = 0.3030708192242294     # K6
    sp_xbh_rate:    float = 0.2647453725903903     # K7
    sp_triple_rate: float = 0.088933164281833      # K8
    sp_sb_pct:      float = 0.7796075683251577     # K9
    sp_sba_rate:    float = 0.11329892814608972    # K12

    # ── RP league stat rates (Pitcher DP K column, rows 15–24) ─────────────
    rp_hbp_rate:    float = 0.010600253608218046   # K22
    rp_bb_rate:     float = 0.09187795942599807    # K15
    rp_hr_rate:     float = 0.03531906751283605    # K16
    rp_so_rate:     float = 0.25692827757757436    # K17
    rp_babip:       float = 0.3029659581196774     # K18
    rp_xbh_rate:    float = 0.26267521622427675    # K19
    rp_triple_rate: float = 0.0908316775475447     # K20
    rp_sb_pct:      float = 0.7752577319587629     # K21
    rp_sba_rate:    float = 0.0838037092500864     # K24

    # ── Other pitcher-specific constants (Pitcher DP H column) ─────────────
    run_cs:     float = -0.4048885881              # H35 — pitcher RunCS (different from hitter)
    wsb:        float = 0.007043245889614909       # H36 — pitcher wSB constant
    waa_const:  float = 10.07272219530025          # H30 — same as hitter WAA constant
    r_per_pa:   float = 0.1214596638751471         # H40 — pitcher R/PA (slightly different from hitter)


# ---------------------------------------------------------------------------
# Combined containers
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class HitterDataPoints:
    """All calibration constants needed to evaluate a hitter."""

    hitting:         HittingRegressionCoeffs   # Regressions.xlsx: rating → offensive stat
    fielding_coeffs: FieldingRegressionCoeffs  # Regressions.xlsx: rating → fielding stat
    league:          HitterLeagueParams         # Metadata.xlsx: league averages and rates
    fielding:        FieldingParams             # Metadata.xlsx: position adjustments


@dataclass(frozen=True)
class PitcherDataPoints:
    """All calibration constants needed to evaluate a pitcher."""

    pitching:        PitchingRegressionCoeffs  # Regressions.xlsx: rating → pitching stat
    fielding_coeffs: FieldingRegressionCoeffs  # Regressions.xlsx: shared with hitters
    league:          PitcherLeagueParams        # Metadata.xlsx: pitcher league params
    hitting_rates:   HitterLeagueParams         # Metadata.xlsx: shared hitting rates/weights
    fielding:        FieldingParams             # Metadata.xlsx: shared position adjustments


# ---------------------------------------------------------------------------
# Module-level singletons
# ---------------------------------------------------------------------------

#: Default OOTP 26 hitter data points, calibrated from 50-year simulation baseline.
DEFAULT_HITTER_DP: HitterDataPoints = HitterDataPoints(
    hitting=HittingRegressionCoeffs(),
    fielding_coeffs=FieldingRegressionCoeffs(),
    league=HitterLeagueParams(),
    fielding=FieldingParams(),
)

#: Default OOTP 26 pitcher data points, calibrated from 50-year simulation baseline.
DEFAULT_PITCHER_DP: PitcherDataPoints = PitcherDataPoints(
    pitching=PitchingRegressionCoeffs(),
    fielding_coeffs=FieldingRegressionCoeffs(),
    league=PitcherLeagueParams(),
    hitting_rates=HitterLeagueParams(),
    fielding=FieldingParams(),
)
