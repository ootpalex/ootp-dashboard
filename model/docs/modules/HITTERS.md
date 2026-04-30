# Hitters — Pipeline Guide

## Overview

Core evaluation engine for position players. Converts OOTP ratings into projected stats (batting, baserunning, fielding) and computes WAA (Wins Above Average) at every eligible position. Each player is evaluated against both RHP and LHP, then results are weighted by platoon split fractions based on batter handedness.

## Inputs Required

| Input | Source | Description |
|-------|--------|-------------|
| Player DataFrame | `players.load_players()` | Merged player data with rating columns |
| `ParkDeltas` | `BallparksTable.compute_park_deltas()` | Additive park stat deltas (for ratings >= 50) |
| `NormalizedAdjustments` | `BallparksTable.rows[team].adj` | Multiplicative park factors (for ratings < 50) |
| `home_fraction` | `config.HOME_PARK_FRACTION` (default 0.5) | Fraction of games at home |
| `HitterDataPoints` | `DEFAULT_HITTER_DP` or via `metadata.compose_data_points()` | Regression coefficients + league params |

## How to Use (Public API)

The 5 public functions are called in sequence:

```python
from src.hitters import (
    compute_hitter_batting,
    compute_position_eligibility,
    compute_fielding,
    compute_waa,
    refine_two_way,
)
from src.data_points import DEFAULT_HITTER_DP

# 1. Batting stats (49 columns appended to players DataFrame)
batting = compute_hitter_batting(players, park_deltas, park_adj, home_fraction=0.5)

# 2. Position eligibility (9 boolean columns)
eligibility = compute_position_eligibility(players)

# 3. Fielding stats (30 columns, NaN for ineligible positions)
fielding = compute_fielding(players, eligibility)

# 4. WAA per position + Max WAA (30 columns)
waa = compute_waa(batting, fielding, eligibility, park_deltas, home_fraction=0.5)

# 5. Refine two-way detection using eligibility
players["is_two_way"] = refine_two_way(players, eligibility)
```

## Expected Output

| Function | Columns | Description |
|----------|---------|-------------|
| `compute_hitter_batting()` | 49 | 12 batting vR + 12 vL + 3 weighted (OBP/wOBA/BatR) + 6 DH (wOBA/BatR per split + wtd) + 16 baserunning |
| `compute_position_eligibility()` | 9 | Boolean: C/1B/2B/3B/SS/LF/CF/RF/DH Elig |
| `compute_fielding()` | 30 | Per-position fielding stats (PMAA, EAA, DPAA, ARMAA, RunsP, catcher-specific) |
| `compute_waa()` | 30 | 9 positions x 3 splits (vR/vL/wtd) + 3 Max WAA |
| `refine_two_way()` | 1 | Boolean Series (updated `is_two_way`) |

### Batting columns per split (12 each)

`HBP`, `uBB`, `HR`, `SO`, `H-HR`, `XBH-HR`, `3B`, `2B`, `1B`, `OBP`, `wOBA`, `BatR`

### Baserunning columns (16)

`SB%` (single), `SBAT`/`SB`/`CS`/`wSB`/`UBR`/`BSR` per split (vR/vL), `wSB`/`UBR`/`BSR` weighted

## Key Concepts & League Context

- **Platoon splits & handedness weighting**: Every stat is computed separately vs RHP (vR) and vs LHP (vL). Weighted results use the batter's handedness-specific fraction of PA vs RHP: R=0.720, L=0.776, S=0.741.
- **Dual park factor models**: HR always uses multiplicative adjustment. H-HR, XBH-HR, and 3B use a dual model: additive (rating >= 50) or multiplicative (rating < 50). wOBA is divided by a park-adjusted `woba_ratio`.
- **Position eligibility rules**: C (FRM>=45), 1B (HT>179cm AND IF RNG>20), 2B (IF RNG>=50 AND throws R AND TDP>=45), 3B (IF RNG>=40 AND IF ARM>=50 AND throws R), SS (IF RNG>=60 AND IF ARM>=50 AND throws R), LF (OF RNG>=50), CF (OF RNG>=60), RF (OF RNG>=50), DH (always).
- **Catcher WAA**: Uses PA=500 (not 600) with inline BatR recalculation and a park adjustment scaled proportionally.
- **DH WAA**: No fielding component; BSR discounted by 0.98; uses DH-specific wOBA (0.98 non-HR discount + SO*0.02 PA adjustment).
- **Max WAA**: The best WAA across all eligible positions, computed per split (vR, vL, wtd). This is the player's headline value.
- **GAP regression**: Unlike other stats, XBH-HR uses the *same* high-model coefficients (h_const/h_slope) for all rating values.
