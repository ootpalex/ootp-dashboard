# Data Points — Pipeline Guide

## Overview

Central constants library for the entire evaluation pipeline. Contains all regression coefficients (rating-to-stat mappings), league averages, wOBA weights, position adjustments, and calibration parameters. These values are derived from 50 years of simulated OOTP 26 baseline data (10 sims x 5 years) and define how player ratings translate to projected stats.

There are two ways to get constants: hardcoded singletons (`DEFAULT_HITTER_DP` / `DEFAULT_PITCHER_DP`) for quick use, or dynamically computed for league-specific calibration. In the dynamic path the **league averages / wOBA weights / out-values come from `metadata.py`** (per league) and the **rating→stat regression coefficients are computed from the calibration sims via `regressions.py`** (`generate_regression_coefficients`, cached) and injected through `compose_data_points`. The hardcoded values in `data_points.py` are the **fallback** used when no metadata / no sims are available.

> **Note (2026-05-24 OAA rollout):** the fielding `*_pm_*` slots now hold **OAA** (difficulty-adjusted outs above average) range coefficients, not raw PM%, and the fielding out-values (`inf_out`/`of_out`) are derived **per league** from each league's own linear weights rather than the old fixed 0.75/0.90.

## Inputs Required

| Input | Source | Description |
|-------|--------|-------------|
| None (hardcoded fallback) | `src/data_points.py` | OOTP 26 defaults baked into dataclass field values — used only when metadata / sims are unavailable |
| Metadata CSVs (optional) | `leagues/<slug>/metadata/*.csv` | Raw OOTP rating CSVs for league-specific constant computation via `src/metadata.py` |
| Calibration sims (optional) | `data/regressions/ootp<version>/` | Sim CSVs that `src/regressions.py` fits the rating→stat coefficients from at build time |

## How to Use (Public API)

### Quick start (hardcoded defaults)

```python
from src.data_points import DEFAULT_HITTER_DP, DEFAULT_PITCHER_DP

# Use directly in pipeline functions
dp = DEFAULT_HITTER_DP
print(dp.league.lg_woba)        # 0.32263
print(dp.hitting.eye.h_slope)   # 0.00187
print(dp.fielding.pos_ss)       # 11.97
```

### Dynamic constants (from metadata)

```python
from src.metadata import generate_data_points, compose_data_points

# Compute league params from per-league metadata CSVs
hitting, pitching, fielding = generate_data_points("leagues/<slug>/metadata/")

# Combine with regression coefficients into pipeline-ready containers
hitter_dp, pitcher_dp = compose_data_points(hitting, pitching, fielding)
```

### Bridge to ballparks

```python
from src.data_points import DEFAULT_HITTER_DP

# Convert hitter league params into BallparkConstants for ballparks.py
bpk_constants = DEFAULT_HITTER_DP.league.to_ballpark_constants()
```

## Expected Output

| Object | Type | Contents |
|--------|------|----------|
| `HitterDataPoints` | frozen dataclass | `.hitting` (regression coeffs), `.fielding_coeffs`, `.league` (HitterLeagueParams), `.fielding` (FieldingParams) |
| `PitcherDataPoints` | frozen dataclass | `.pitching` (regression coeffs), `.fielding_coeffs`, `.league` (PitcherLeagueParams), `.hitting_rates` (shared HitterLeagueParams), `.fielding` (FieldingParams) |

### Key sub-containers

| Container | Fields | Purpose |
|-----------|--------|---------|
| `HittingRegressionCoeffs` | `eye`, `power`, `k`, `babip`, `gap`, `speed` (LinearCoeffs) + `sba`, `sb_pct`, `ubr` (CubicCoeffs) | Rating-to-stat delta mappings for hitters |
| `PitchingRegressionCoeffs` | `sp_con/hrr/stu/babip` + `rp_con/hrr/stu/babip` (LinearCoeffs) + `sba`, `sp_sb_pct`, `rp_sb_pct` (CubicCoeffs) | Rating-to-stat delta mappings for pitchers |
| `FieldingRegressionCoeffs` | Per-position const/slope pairs for range (OAA; PM% is the fallback), ERR, DP, ARM, FRM, SBA, RTO | Fielding rating-to-stat mappings |
| `HitterLeagueParams` | Rating averages, wOBA weights, matchup splits, stat rates | League calibration for hitters |
| `PitcherLeagueParams` | SP/RP rating averages, SP/RP wOBA weights, workload, RA/9 baselines | League calibration for pitchers |
| `FieldingParams` | Position adjustments, rating averages (full precision), scaling constants | Fielding calibration per position |

## Key Concepts & League Context

- **Piecewise linear regression** (split at 50): `LinearCoeffs(h_const, h_slope, l_const, l_slope)`. If rating >= 50, uses h_const/h_slope; otherwise l_const/l_slope. The predicted value is a *delta from the league average*, not an absolute stat.
- **Cubic polynomial regression**: `CubicCoeffs(c0, c1, c2=0, c3=0)`. Used for baserunning stats (SBA, SB%, UBR). In OOTP 26, c2 and c3 are always 0.
- **Singletons vs. dynamic constants**: `DEFAULT_HITTER_DP` / `DEFAULT_PITCHER_DP` use hardcoded OOTP 26 values. For league-specific calibration, use `metadata.generate_data_points()` to compute from raw sim data, then `compose_data_points()` to build the pipeline containers.
- **SP/RP separate calibration**: Pitchers have completely separate regression coefficients, wOBA weights, stat rates, and rating averages for starters vs. relievers.
- **Metadata caching**: `generate_data_points()` supports SHA-256 hash caching via `.metadata_cache.json` to avoid recomputation when inputs haven't changed.
