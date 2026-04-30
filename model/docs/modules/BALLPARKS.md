# Ballparks — Pipeline Guide

## Overview

Translates a raw park factor CSV into stat adjustments consumed by the hitters and pitchers pipelines. Each OOTP league has unique park dimensions that inflate or suppress certain stats (HR, batting average, doubles, triples). This module normalizes those raw factors against the league average, then computes per-PA stat counts for every team so the downstream pipelines can adjust individual player projections for their home park.

## Inputs Required

| Input | Source | Description |
|-------|--------|-------------|
| `data/ballparks.csv` | User-provided (copy from OOTP) | 28 teams, 11 columns: Team Name, Park, PF AVG, AVG L, AVG R, PF HR, HR L, HR R, PF D, PF T, PF |
| `BallparkConstants` | `data_points.py` defaults (or via `HitterLeagueParams.to_ballpark_constants()`) | League wOBA weights, stat rates, platoon splits, PA |

## How to Use (Public API)

```python
from src.ballparks import BallparksTable, neutral_park_deltas, neutral_adjustments

# 1. Load park factors and compute all team rows
table = BallparksTable.from_csv("data/ballparks.csv")

# 2. Get park deltas for a specific team (input to hitters/pitchers)
park_deltas = table.compute_park_deltas("Nashville Stars", home_fraction=0.5)

# 3. Get normalized adjustments for the same team (multiplicative factors)
park_adj = table.rows["Nashville Stars"].adj

# 4. For neutral-park mode (no park effects):
neutral_deltas = neutral_park_deltas()       # all deltas = 0, woba_ratio = 1.0
neutral_adj    = neutral_adjustments()        # all factors = 1.0
```

## Expected Output

| Object | Type | Contents |
|--------|------|----------|
| `ParkDeltas` | dataclass | 8 additive stat deltas (HR/H-HR/XBH-HR/3B, split by vR/vL), `woba_ratio`, `adj_value` |
| `NormalizedAdjustments` | dataclass | 8 multiplicative factors: `ba_lh`, `ba_rh`, `hr_lh`, `hr_rh`, `pf_d_adj`, `pf_t_adj`, `pf_avg_adj`, `pf_hr_adj` |
| `BallparksTable` | class | `.rows` dict (team name -> `BallparkRow`), `.league_row`, `.team_names` |

## Key Concepts & League Context

- **Neutral-park baseline**: League averages are computed as the arithmetic mean of all 28 team rows. A team with adjustment = 1.0 has a league-average effect on that stat.
- **Home fraction scaling**: Deltas are scaled by `home_fraction` (typically 0.5). A player who plays half their games at home gets half the park effect. Multiplicative factors use `1 + (raw - 1) * home_fraction`.
- **Handedness-split factors**: HR and batting average park factors are split by batter hand (LH/RH). Doubles and triples factors are the same for both hands.
- **Bootstrap computation**: Neutral-park per-PA stats (all adjustments = 1.0) are computed first as a baseline, then used to calculate the `adj_*` delta fields for each team row.
- **wOBA park normalization**: `adj_woba` is relative to the *computed* neutral-park wOBA (~0.32253), not the Data Points constant (0.32263). `park_woba = adj_woba + lg_woba_constant`.
