#!/usr/bin/env python3
"""Standing fielding referee (FIELDING_PIPELINE_27 change C4) — the post-season audit stage.

Regresses each position's OBSERVED variant-A fielding-range runs (real-league made/TOTAL
chance conversion, real chance flow per 1200 IP) on the MODEL's runsP range channel (the
plays-made channel exactly as src/hitters.py computes it: centred constant + piecewise/linear
rating deltas, times {pos}_pa, times the per-position response factor, times the infield or
outfield out value). Reports chance-weighted WLS slope/intercept with HC1 + cluster-bootstrap
standard errors (never below the binomial floor), the per-position population mean of the
model channel (the C3 centring identity, expected ~0), and elite-band model-vs-observed means.

C4 governance rule: per-position response factors (data_points.FIELDING_RESPONSE_FACTORS_27)
move only on two-sample evidence — the same signal replicated in two seasons or two leagues —
and any adjustment is shrunk toward 1.0. A single-season slope from this tool is grounds to
watch, not to move.

Usage (from the model/ directory):
    python3 tools/referee_fielding.py --league SSB --year 2043 [--ratings path] [--out r.json]

Read-only against production code and league data; writes nothing except the optional --out.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

MODEL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = MODEL_DIR.parent
sys.path.insert(0, str(MODEL_DIR))

from src.settings import load_league_config          # noqa: E402
from src.export import _detect_metadata              # noqa: E402
from src.hitters import _pm_response_factor          # noqa: E402
from src.data_points import PiecewiseCoeffs          # noqa: E402
from src.utils import piecewise_delta                # noqa: E402

POSITIONS = ["1B", "2B", "3B", "SS", "LF", "CF", "RF"]
FILE_TAG = {p: p.lower() for p in POSITIONS}
IF_POS = {"1B", "2B", "3B", "SS"}
BUCKETS = ["R", "L", "E", "U", "Z", "I"]
TOT_COLS = [f"BIZ-{b}" for b in BUCKETS]
MADE_COLS = [f"BIZ-{b}m" for b in BUCKETS[:-1]]      # BIZ-I is never made
SCOUT_W, OSA_W = 0.9, 0.1
RATING_COLS = ["IFR", "IFA", "OFR"]
MIN_CHANCES = 20
ELITE_RATING, ELITE_IP = 68.0, 300.0
N_BOOT, SEED = 4000, 20260809

RATINGS_SEARCH_DIRS = [
    "/Users/alex/Projects/ootp/analysis/statsplus-automation/output/{slug}",
    "/Users/alex/Projects/ootp/ootp27-conversion/real27-anchors/output/{slug}",
]


def ip_thirds(series: pd.Series) -> pd.Series:
    """OOTP x.y innings notation (y = outs) -> true innings."""
    ip = pd.to_numeric(series, errors="coerce")
    whole = np.floor(ip)
    return whole + ((ip - whole) * 10).round() / 3.0


def fld_delta(rating, avg, coeff):
    """Rating -> rate delta, mirroring src.hitters._fld_delta (piecewise or linear)."""
    if isinstance(coeff, PiecewiseCoeffs):
        return np.array([float(piecewise_delta(float(v), avg, coeff)) for v in rating])
    return coeff * (np.asarray(rating, float) - avg)


def find_ratings(slug: str, year: int, explicit: str | None):
    """Locate the scout dump (newest for the year) and a matching OSA dump if present."""
    if explicit:
        scout = Path(explicit)
        if not scout.exists():
            sys.exit(f"--ratings path not found: {scout}")
    else:
        candidates = []
        for tmpl in RATINGS_SEARCH_DIRS:
            d = Path(tmpl.format(slug=slug))
            if d.is_dir():
                candidates += sorted(d.glob(f"ratings_scout_{year}-*.csv.gz"))
        if not candidates:
            sys.exit(f"no ratings_scout_{year}-*.csv.gz found for {slug}; pass --ratings")
        scout = max(candidates, key=lambda p: p.name)
    osa = scout.with_name(scout.name.replace("ratings_scout_", "ratings_osa_"))
    if not osa.exists():
        sib = sorted(scout.parent.glob(f"ratings_osa_{year}-*.csv.gz"))
        osa = sib[-1] if sib else None
    return scout, osa


def load_ratings(scout_path: Path, osa_path: Path | None):
    cols = ["ID", "Height"] + RATING_COLS
    s = pd.read_csv(scout_path)[cols]
    n_no_osa = 0
    if osa_path is not None:
        o = pd.read_csv(osa_path)[["ID"] + RATING_COLS]
        m = s.merge(o, on="ID", how="left", suffixes=("_s", "_o"))
        n_no_osa = int(m[f"{RATING_COLS[0]}_o"].isna().sum())
        for c in RATING_COLS:
            m[c] = np.where(m[f"{c}_o"].notna(),
                            SCOUT_W * m[f"{c}_s"] + OSA_W * m[f"{c}_o"], m[f"{c}_s"])
        s = m[cols]
    s = s.copy()
    s["ht_cm"] = pd.to_numeric(s["Height"], errors="coerce")
    return s, n_no_osa


def model_range_runs(pos: str, df: pd.DataFrame, fp, lg, fc) -> tuple[np.ndarray, float, float]:
    """Model runsP range (plays-made) channel, reproducing hitters.py: returns
    (runs per player, pa used, out value used)."""
    tag = FILE_TAG[pos]
    out = lg.inf_out if pos in IF_POS else lg.of_out
    pa = {"1B": fp.first_pa, "2B": fp.second_pa, "3B": fp.third_pa, "SS": fp.ss_pa,
          "LF": fp.lf_pa, "CF": fp.cf_pa, "RF": fp.rf_pa}[pos]
    factor = _pm_response_factor(fc, tag)
    if pos == "1B":
        rate = (fc.first_pm_const
                + fld_delta(df["IFR"].values, fp.avg_rng_1b, fc.first_pm_rng_slope)
                + fc.first_pm_ht_slope * (df["ht_cm"].values - fp.avg_ht_1b))
    elif pos in IF_POS:
        rate = (getattr(fc, {"2B": "second", "3B": "third", "SS": "ss"}[pos] + "_pm_const")
                + fld_delta(df["IFR"].values, getattr(fp, f"avg_rng_{tag}"),
                            getattr(fc, {"2B": "second", "3B": "third", "SS": "ss"}[pos]
                                    + "_pm_rng_slope"))
                + fld_delta(df["IFA"].values, getattr(fp, f"avg_arm_{tag}"),
                            getattr(fc, {"2B": "second", "3B": "third", "SS": "ss"}[pos]
                                    + "_pm_arm_slope")))
    else:
        rate = (getattr(fc, f"{tag}_pm_const")
                + fld_delta(df["OFR"].values, getattr(fp, f"avg_rng_{tag}"),
                            getattr(fc, f"{tag}_pm_slope")))
    return rate * pa * factor * out, pa, out


def wls(X, y, w):
    A = X.T @ (X * w[:, None])
    return np.linalg.solve(A, X.T @ (w * y))


def hc1_se(X, y, w, beta):
    n, k = X.shape
    r = y - X @ beta
    A = np.linalg.inv(X.T @ (X * w[:, None]))
    meat = (X * (w * r)[:, None]).T @ (X * (w * r)[:, None])
    return np.sqrt(np.diag(A @ meat @ A * n / max(n - k, 1)))


def boot_se(X, y, w, B=N_BOOT, seed=SEED):
    rs = np.random.default_rng(seed)
    n, k = X.shape
    out = np.full((B, k), np.nan)
    for i in range(B):
        j = rs.integers(0, n, n)
        try:
            out[i] = wls(X[j], y[j], w[j])
        except np.linalg.LinAlgError:
            pass
    return np.nanstd(out, axis=0, ddof=1)


def binomial_floor_se(X, w, var_y):
    """SE floor from independent binomial sampling noise in observed runs (a prior tool
    reported SEs below this floor — never allowed here)."""
    A = np.linalg.inv(X.T @ (X * w[:, None]))
    meat = (X * (w**2 * var_y)[:, None]).T @ X
    return np.sqrt(np.diag(A @ meat @ A))


def referee_position(pos, fld_csv, ratings, fp, lg, fc, min_ch):
    f = pd.read_csv(fld_csv)
    for c in TOT_COLS + MADE_COLS:
        f[c] = pd.to_numeric(f[c], errors="coerce").fillna(0.0)
    f["ipc"] = ip_thirds(f["IP"])
    f["tot"] = f[TOT_COLS].sum(axis=1)
    f["made"] = f[MADE_COLS].sum(axis=1)
    f = f[f["ipc"] > 0].copy()
    out_val = lg.inf_out if pos in IF_POS else lg.of_out
    lg_p = f["made"].sum() / f["tot"].sum()
    pa_obs = f["tot"].sum() / f["ipc"].sum() * lg.ip     # league chances per 1200 IP, this season
    f = f.merge(ratings, on="ID", how="left")
    d = f[(f["tot"] >= min_ch) & f["IFR" if pos in IF_POS else "OFR"].notna()].copy()
    n_unmatched = int((f["tot"] >= min_ch).sum() - len(d))

    d["model"], pa_mod, _ = model_range_runs(pos, d, fp, lg, fc)
    d["p"] = d["made"] / d["tot"]
    d["obs"] = (d["p"] - lg_p) * pa_obs * out_val
    p_tilde = (d["made"] + 0.5) / (d["tot"] + 1.0)
    d["var_obs"] = p_tilde * (1 - p_tilde) / d["tot"] * (pa_obs * out_val) ** 2

    y, x, w = d["obs"].values, d["model"].values, d["tot"].values.astype(float)
    X = np.column_stack([np.ones(len(x)), x])
    beta = wls(X, y, w)
    se = np.maximum.reduce([hc1_se(X, y, w, beta), boot_se(X, y, w),
                            binomial_floor_se(X, w, d["var_obs"].values)])
    ww = w / w.sum()
    r2 = 1 - np.sum(w * (y - X @ beta) ** 2) / np.sum(w * (y - np.sum(ww * y)) ** 2)
    pop_mean = float(np.sum(ww * x))                     # chance-weighted centring check

    prim = "IFR" if pos in IF_POS else "OFR"
    e = d[(d[prim] >= ELITE_RATING) & (d["ipc"] >= ELITE_IP)]
    if len(e):
        ew = e["ipc"].values / e["ipc"].sum()
        elite = dict(n=len(e), model=float(ew @ e["model"].values),
                     obs=float(ew @ e["obs"].values))
    else:
        elite = dict(n=0, model=None, obs=None)

    return dict(pos=pos, n=len(d), n_unmatched=n_unmatched, chances=float(w.sum()),
                lg_pm=float(lg_p), pa_obs=float(pa_obs), pa_model=float(pa_mod),
                response_factor=float(_pm_response_factor(fc, FILE_TAG[pos])),
                intercept=float(beta[0]), se_intercept=float(se[0]),
                slope=float(beta[1]), se_slope=float(se[1]), r2w=float(r2),
                pop_mean_model=pop_mean, elite=elite)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--league", required=True)
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--ratings", default=None, help="scout dump csv.gz (overrides search)")
    ap.add_argument("--out", default=None, help="write JSON report here")
    ap.add_argument("--min-chances", type=int, default=MIN_CHANCES)
    args = ap.parse_args()

    slug = args.league
    cfg = load_league_config(slug, root=REPO_ROOT)
    dp = _detect_metadata(REPO_ROOT / "leagues" / slug / "metadata",
                          cfg.to_pipeline_settings(), regressions_dir=None)
    if dp is None:
        sys.exit(f"no metadata inputs for league {slug}")
    hitter_dp, _ = dp
    fp, lg, fc = hitter_dp.fielding, hitter_dp.league, hitter_dp.fielding_coeffs

    scout_path, osa_path = find_ratings(slug, args.year, args.ratings)
    ratings, n_no_osa = load_ratings(scout_path, osa_path)
    print(f"\nratings: scout={scout_path.name}"
          f"  osa={'(none — scout only)' if osa_path is None else osa_path.name}"
          f"  blend={SCOUT_W}/{OSA_W}  players missing from OSA -> scout-only: {n_no_osa}")

    season_dir = REPO_ROOT / "leagues" / slug / "metadata" / str(args.year)
    rows = []
    for pos in POSITIONS:
        csv = season_dir / f"fielding_data_{FILE_TAG[pos]}.csv"
        if not csv.exists():
            print(f"  {pos}: {csv} missing — skipped")
            continue
        rows.append(referee_position(pos, csv, ratings, fp, lg, fc, args.min_chances))

    print(f"\nFIELDING REFEREE — {slug} {args.year} — range channel, observed = variant A "
          f"(real chance flow), sample: >= {args.min_chances} total chances")
    print(f"{'pos':<4}{'n':>4}{'chances':>9}{'rf':>6} | {'slope':>7}{'+/-':>7}"
          f"{'intercept':>10}{'+/-':>7}{'R2w':>7} | {'popmean':>8} | "
          f"{'eliteN':>7}{'elite mdl':>10}{'elite obs':>10}")
    for r in rows:
        e = r["elite"]
        em = f"{e['model']:>+10.1f}" if e["n"] else f"{'—':>10}"
        eo = f"{e['obs']:>+10.1f}" if e["n"] else f"{'—':>10}"
        print(f"{r['pos']:<4}{r['n']:>4}{r['chances']:>9.0f}{r['response_factor']:>6.2f} | "
              f"{r['slope']:>7.3f}{r['se_slope']:>7.3f}{r['intercept']:>+10.2f}"
              f"{r['se_intercept']:>7.2f}{r['r2w']:>7.3f} | {r['pop_mean_model']:>+8.2f} | "
              f"{e['n']:>7}{em}{eo}")
    print("\nC4 governance: response factors move only on two-sample evidence (two seasons or"
          "\ntwo leagues), shrunk toward 1.0. One season's slope is a watch signal, not a move.")

    if args.out:
        report = dict(league=slug, year=args.year, scout=scout_path.name,
                      osa=(osa_path.name if osa_path else None),
                      min_chances=args.min_chances, positions=rows)
        Path(args.out).write_text(json.dumps(report, indent=2))
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
