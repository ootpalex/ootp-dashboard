"""Hitting calc pipeline — produces ``HitterLeagueParams``.

Aggregates raw hitting counting stats and PA-weighted batter rating averages
to derive the league-side calibration constants used by the WAA / wOBA
projection in the rest of the pipeline.
"""
from __future__ import annotations

import pandas as pd

from src.aggregators._shared import (
    _compute_woba_from_aggregates,
    compute_runs_per_win,
    _pa_fractions_by_hand,
    _weighted_mean,
)
from src.data_points import HitterLeagueParams


def _aggregate_hitting(df: pd.DataFrame) -> dict:
    """Sum counting stats from Hitting Data."""
    cols = ["R", "PA", "AB", "1B", "2B", "3B", "HR", "BB", "IBB",
            "SH", "SF", "SB", "CS", "SO", "UBR", "GIDP", "HP"]
    agg = {}
    for c in cols:
        if c in df.columns:
            agg[c] = pd.to_numeric(df[c], errors="coerce").sum()
    # Outs = AB - (1B+2B+3B+HR) + GIDP + CS + SH + SF
    agg["Outs"] = (agg["AB"] - (agg["1B"] + agg["2B"] + agg["3B"] + agg["HR"])
                   + agg.get("GIDP", 0) + agg.get("CS", 0) + agg.get("SH", 0)
                   + agg.get("SF", 0))
    return agg


def _compute_matchup_splits_from_ratings(
    batter_vr: pd.DataFrame, batter_vl: pd.DataFrame
) -> dict:
    """Compute matchup fractions from separate vR/vL batter rating files.

    batter_vr has PA = player's PA vs RHP, batter_vl has PA vs LHP.
    Each file has columns: ID, PA, B, BA, GAP, POW, EYE, K, SPE, STE, RUN, SR.
    """
    return _pa_fractions_by_hand(
        batter_vr, batter_vl,
        weight_col="PA", hand_col="B",
        hands=[("L", "lvr"), ("R", "rvr"), ("S", "svr")],
    )


def _compute_rating_averages_hitting(
    batter_vr: pd.DataFrame, batter_vl: pd.DataFrame, ovr_vr: float
) -> dict:
    """Compute PA-weighted rating averages for hitters.

    Each file has columns: ID, PA, B, BA, GAP, POW, EYE, K, SPE, STE, RUN, SR.
    The vR file has ratings when facing RHP; vL has ratings when facing LHP.
    """
    # Split-specific (BA/GAP/POW/EYE/K) + universal (SPE/STE/RUN/SR) ratings.
    rating_cols = {
        "babip": "BA", "gap": "GAP", "pow": "POW", "eye": "EYE", "k": "K",
        "spe": "SPE", "ste": "STE", "run": "RUN", "sr": "SR",
    }

    def avgs(df: pd.DataFrame) -> dict:
        out = {}
        for name, col in rating_cols.items():
            if col in df.columns:
                out[name] = _weighted_mean(df["PA"], df[col])
        return out

    vr_avgs = avgs(batter_vr)
    vl_avgs = avgs(batter_vl)

    # Combined averages: vR_avg * ovr_vr + vL_avg * (1 - ovr_vr)
    return {
        name: vr_avgs[name] * ovr_vr + vl_avgs[name] * (1.0 - ovr_vr)
        for name in vr_avgs
    }


_OF_POSITIONS = ("lf", "cf", "rf")
_INF_OUT_FALLBACK = 0.75
_OF_OUT_FALLBACK = 0.90


def _derive_out_values(fielding_data, woba: dict, agg: dict) -> tuple[float, float]:
    """Per-league fielding out-values: the run value of a PREVENTED hit, above an out.

    ``inf_out`` — single-above-out. Infielders prevent ~only singles (a ball past the IF that
    goes for extra bases is an *outfield* play), so ``inf_out = run_1b + runs_minus`` (the league's
    own linear-weight value of a single above an out). Textbook; no assumption.

    ``of_out`` — the OF-prevented-hit-mix-weighted hit value above out. Outfielders prevent a *mix*
    of 1B/2B/3B, so ``of_out`` must weight the run values by that mix. We recover the mix from OOTP's
    BIZ ball-in-zone accounting: ``OF (Plays A − Plays M) − Errors = OF hits``; ~all 2B/3B are
    outfield events, so ``OF-1B = OF hits − (2B + 3B)`` and the mix is ``OF-1B : 2B : 3B``. See
    ``Leftovers/oaa-fielding-model/OUT_VALUE_V2_FINDINGS.md`` (three validation identities).

    Falls back to (0.75, 0.90) when the BIZ ball-accounting isn't present or doesn't reconcile.
    """
    rm = woba["runs_minus"]
    rv1b = woba["run_1b"] + rm
    rv2b = woba["run_2b"] + rm
    rv3b = woba["run_3b"] + rm
    inf_out = rv1b  # IF prevents singles → single-above-out

    if not fielding_data:
        return _INF_OUT_FALLBACK, _OF_OUT_FALLBACK
    am = e = 0.0  # Σ(Plays A − Plays M) and Σ errors over the OF zones
    for pos in _OF_POSITIONS:
        df = fielding_data.get(pos)
        if df is None or not {"Plays A", "Plays M"}.issubset(df.columns):
            return _INF_OUT_FALLBACK, _OF_OUT_FALLBACK  # BIZ buckets absent → fall back
        am += (pd.to_numeric(df["Plays A"], errors="coerce").fillna(0.0).sum()
               - pd.to_numeric(df["Plays M"], errors="coerce").fillna(0.0).sum())
        if "E" in df.columns:
            e += pd.to_numeric(df["E"], errors="coerce").fillna(0.0).sum()
    of_hits = am - e
    of_1b = of_hits - (agg["2B"] + agg["3B"])  # all XBH are outfield events
    if of_hits <= 0 or of_1b < 0:
        return _INF_OUT_FALLBACK, _OF_OUT_FALLBACK  # accounting didn't reconcile → fall back
    f1, f2, f3 = of_1b / of_hits, agg["2B"] / of_hits, agg["3B"] / of_hits
    of_out = f1 * rv1b + f2 * rv2b + f3 * rv3b
    return inf_out, of_out


def compute_hitting_constants(inputs) -> HitterLeagueParams:
    """Compute all HitterLeagueParams from raw hitting data + batter ratings."""
    # Step 1: Aggregate counting stats
    agg = _aggregate_hitting(inputs.hitting_data)

    # Step 2: wOBA derivation
    woba = _compute_woba_from_aggregates(agg)

    # Step 2b: per-league fielding out-values from the league's own linear weights + BIZ hit mix
    inf_out, of_out = _derive_out_values(getattr(inputs, "fielding_data", None), woba, agg)

    # Step 3: Matchup splits
    splits = _compute_matchup_splits_from_ratings(
        inputs.batter_ratings_vr, inputs.batter_ratings_vl)

    # Step 4: PA-weighted rating averages
    rating_avgs = _compute_rating_averages_hitting(
        inputs.batter_ratings_vr, inputs.batter_ratings_vl, splits["ovr_vr"])

    return HitterLeagueParams(
        # Rating averages
        avg_eye=rating_avgs["eye"],
        avg_power=rating_avgs["pow"],
        avg_k=rating_avgs["k"],
        avg_babip=rating_avgs["babip"],
        avg_gap=rating_avgs["gap"],
        avg_speed=rating_avgs["spe"],
        avg_steal=rating_avgs["ste"],
        avg_bsr=rating_avgs["run"],

        # wOBA weights
        wt_hbp=woba["wt_hbp"],
        wt_bb=woba["wt_bb"],
        wt_1b=woba["wt_1b"],
        wt_2b=woba["wt_2b"],
        wt_3b=woba["wt_3b"],
        wt_hr=woba["wt_hr"],
        wt_sb=woba["wt_sb"],
        wt_cs=woba["wt_cs"],
        woba_scale=woba["woba_scale"],

        # Matchup splits
        lvr=splits["lvr"],
        rvr=splits["rvr"],
        svr=splits["svr"],
        ovr_vr=splits["ovr_vr"],

        # League measurements
        lg_woba=woba["lg_woba"],
        # Per-league runs-per-win from the same overall pitching data the pitch
        # aggregator uses — keeps hitter & pitcher WAR on one scale per league.
        waa_const=compute_runs_per_win(inputs.pitching_data),
        pa=600.0,
        pa_c=500.0,
        ip=1200.0,
        ip_c=1000.0,
        run_cs=woba["run_cs"],
        wsb=woba["lg_wsb"],
        hbp_rate=woba["hbp_rate"],
        inf_out=inf_out,
        of_out=of_out,
        r_per_pa=woba["r_per_pa"],
        bpk_woba=0.32576,  # From main workbook, not metadata

        # Stat rates
        bb_rate=woba["bb_rate"],
        hr_rate=woba["hr_rate"],
        so_rate=woba["so_rate"],
        babip=woba["babip"],
        xbh_rate=woba["xbh_rate"],
        triple_rate=woba["triple_rate"],
        sb_pct=woba["sb_pct"],
        ubr=woba["ubr_rate"],
        sba_rate=woba["sba_rate"],
    )
