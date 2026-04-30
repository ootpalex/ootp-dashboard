# Pitchers — Pipeline Guide

## Overview

Evaluates every pitcher as both a starter (SP) and reliever (RP), projecting batting-against stats, stolen base stats, wOBA, RA/9, and WAA for each role. This dual-role approach lets the user compare a pitcher's value in either role. The pipeline uses pitcher-specific regression coefficients, wOBA weights, and stat rates that are distinct from hitter values.

## Inputs Required

| Input | Source | Description |
|-------|--------|-------------|
| Player DataFrame | `players.load_players()` | Merged player data with pitcher rating columns (STU, HRR, PBABIP, PCON, HLD) |
| `NormalizedAdjustments` | `BallparksTable.rows[team].adj` | Multiplicative park factors |
| `home_fraction` | `config.HOME_PARK_FRACTION` (default 0.5) | Fraction of games at home |
| `PitcherDataPoints` | `DEFAULT_PITCHER_DP` or via `metadata.compose_data_points()` | Regression coefficients + league params |
| `woba_ratio` | `ParkDeltas.woba_ratio` | Park-specific wOBA ratio (default 1.0 for neutral) |

## How to Use (Public API)

The 3 public functions are called in sequence:

```python
from src.pitchers import (
    compute_pitch_counts,
    compute_starter_flag,
    compute_pitcher_batting,
)
from src.data_points import DEFAULT_PITCHER_DP

# 1. Count pitches from grade columns (3 columns)
pitch_counts = compute_pitch_counts(players)

# 2. Classify as starter or reliever (boolean Series)
is_starter = compute_starter_flag(players, pitch_counts)

# 3. Full batting-against pipeline (86 columns)
pitching = compute_pitcher_batting(
    players,
    park_adj,
    home_fraction=0.5,
    woba_ratio=park_deltas.woba_ratio,
)
```

## Expected Output

| Function | Columns | Description |
|----------|---------|-------------|
| `compute_pitch_counts()` | 3 | `Pitches` (non-dash prospect grades), `SP P Pitch` (prospect > 25), `SP Pitch` (current > 25) |
| `compute_starter_flag()` | 1 | Boolean: True = starter classification |
| `compute_pitcher_batting()` | 86 | See breakdown below |

### Column breakdown for `compute_pitcher_batting()` (86 total)

Per role (SP and RP):

| Group | Count | Examples |
|-------|-------|---------|
| Batting vR + vL | 18 | `HBP vR`, `HR vL`, `1B vR RP` |
| Batting weighted | 9 | `SO wtd`, `HR wtd RP` |
| SB stats | 7 | `SB% SP`, `SBAT vR`, `CS vL RP` |
| Performance | 9 | `wOBA vR`, `RA9 vL RP`, `WAA wtd` |
| **Role total** | **43** | |
| **Both roles** | **86** | |

Column naming: SP columns use `"stat vR"` / `"stat wtd"`, RP columns use `"stat vR RP"` / `"stat wtd RP"`.

## Key Concepts & League Context

- **Dual role evaluation**: Every pitcher is projected as both SP (800 BF) and RP (300 BF) regardless of their actual position. The `compute_starter_flag()` classification is for filtering display, not for limiting computation.
- **STU +/- 5 adjustment**: In the SP section, non-SP position players get STU-5 (penalty). In the RP section, SP position players get STU+5 for the threshold check and high-branch centering (but the low branch always uses raw STU). This models OOTP's role-dependent stuff recalculation.
- **Starter classification**: A pitcher is classified as a starter if they have enough pitch variety (based on prospect grades > 25) AND STM >= 40. The exact formula: `(SP_P_Pitch >= 3) OR (SP_P_Pitch >= 2 AND Pitches >= 3) OR (SP_P_Pitch >= 1 AND Pitches >= 5)`.
- **Always multiplicative park factors**: Unlike hitters (which use a dual additive/multiplicative model), pitchers always use multiplicative park adjustments for all stats.
- **RA/9 quadratic model**: `RA/9 = (wOBA / woba_norm)^2 * ra9_baseline`. The quadratic relationship means small wOBA differences produce amplified RA/9 differences. Weighted RA/9 is computed from weighted wOBA (not averaged splits) to preserve this nonlinearity.
- **Pitcher-side handedness splits**: The T (throwing hand) column drives platoon weighting with pitcher-specific fractions: RHP rvr=0.569, LHP lvr=0.745, S svr=0.617. These differ from batter-side splits.
- **SB stats use HLD**: Stolen base percentage and attempt rate use the HLD (hold runners) rating with cubic polynomials. SP and RP have different baselines but share the SBA slope. Dash values in HLD are substituted with 20.
- **wOBA includes SB/CS**: Unlike hitter wOBA (which excludes baserunning), pitcher wOBA includes `wt_sb * SB + wt_cs * CS` directly in the numerator.
