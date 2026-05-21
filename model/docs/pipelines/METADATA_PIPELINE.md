# Metadata Pipeline Documentation

## Overview

The `25 Metadata.xlsx` workbook is a **constant-generation pipeline**: raw OOTP game stats + player ratings → calibration constants stored in `data_points.py`.

**Module:** `src/metadata.py` (orchestrator + caching) + `src/aggregators/{hit,pitch,field}_aggregator.py` (Phase E split — domain-specific aggregation)
**Test suite:** `model/tests/test_metadata.py`
**Per-league inputs:** `leagues/<slug>/metadata/*.csv` (raw OOTP rating + sim CSVs the pipeline auto-detects on each build), or year-named subfolders for multi-season pooling (see [Multi-season pooling](#multi-season-pooling))
**Calibration answer keys:** `data/regressions/ootp<version>/calibration/*.json` (shipped per OOTP version)

After Phase E (2026-04-28), `src/metadata.py` slimmed from 1482 → 439 lines. It now owns: `MetadataInputs`, CSV loading + OSA/relative blending, result caching (SHA-256 hash via `.metadata_cache.json`), and the top-level orchestrators `generate_data_points` / `compose_data_points`. The heavy aggregation moved into the `src/aggregators/` package — `hit_aggregator.py` (`_aggregate_hitting`, `compute_hitting_constants`), `pitch_aggregator.py` (`_aggregate_pitching`, `compute_pitching_constants` with SP-normalized RP wOBA), `field_aggregator.py` (`_compute_fielding_aggregates`, `_compute_position_adjustments`, `compute_fielding_constants`), and `_shared.py` (`_compute_woba_from_aggregates`, weighted-mean helpers). `src.metadata` re-exports the private helpers that `tests/test_metadata.py` imports, so test imports stayed unchanged across the split.

## Data Flow

```
Input Tables (Hitting Data, Pitching Data, SP/RP Data, Fielding Data, Ratings)
  → Calc Sheets (aggregation + wOBA derivation + weighted averages)
    → Data Points (HitterLeagueParams, PitcherLeagueParams, FieldingParams)
```

## Multi-season pooling

A single season of metadata is noisy — wOBA weights, league rating averages, and
especially **position adjustments** swing year to year on small samples. To stabilize the
constants, `metadata/` can hold **year-named subfolders** and the pipeline pools the most
recent seasons with a recency-weighted blend:

```
leagues/<slug>/metadata/
  2026/   ← newest; weight 3   (full set of the ~20 metadata CSVs)
  2025/   ← weight 2
  2024/   ← weight 1
  .metadata_cache.json         ← combined cache stays at the parent level
```

- **Detection.** A "season" is any child directory whose name is all digits (a year). Each
  season folder must contain the complete metadata CSV set. **If year subfolders exist they
  are the source of truth and loose CSVs in `metadata/` are ignored. If none exist, the flat
  `metadata/*.csv` is loaded as a single season — identical to the legacy behavior.**
- **Weighting (years-back).** The newest present year gets `season_weights[0]`, one year
  older `season_weights[1]`, etc. A **gap year leaves its weight slot unused** (e.g. 2026 +
  2024 with weights `(3,2,1)` → 2026=3, 2024=1). Seasons older than the weight window are
  dropped; a single season collapses to weight 1.
- **Blend method.** Each season's `HitterLeagueParams` / `PitcherLeagueParams` /
  `FieldingParams` is computed **independently** with the existing aggregators, then every
  (float) field is weighted-averaged via `_blend_params`. The aggregator math is untouched.
- **Config.** The weight vector is `seasonWeights` in `leagues/<slug>/league.json`
  (default `[3, 2, 1]`); it flows through `LeagueConfig` → `generate_data_points(...,
  season_weights=...)` and is folded into the cache config hash.

Key functions in `src/metadata.py`: `_resolve_season_dirs` (discovery + weighting),
`_blend_params` (generic weighted average), `has_metadata_inputs` (detection gate shared
with `export.py` / `validation.py`).

## Phase Status

| Phase | Description | Status | Tests |
|-------|-------------|--------|-------|
| 0 | Setup & CSV extraction | COMPLETE | — |
| 1 | Hitting Calc pipeline | COMPLETE | 17 |
| 2 | Pitching Calc pipeline | COMPLETE | 11 |
| 3 | Fielding Calc + POS Adj | COMPLETE | 7 |
| 4 | Integration & Composition | COMPLETE | 6 |
| 5 | Change Detection & Caching | COMPLETE | 7 |
| **Total** | | **50 passing** | **50** |

## Hitting Calc Pipeline (Phase 1)

### Inputs
- `hitting_data.csv` — 516 batters, 26 stat columns (R, PA, AB, 1B, 2B, 3B, HR, BB, HP, IBB, SH, SF, SB, CS, Outs, SO, UBR, GIDP)
- `batter_ratings_vr.csv` / `batter_ratings_vl.csv` — batter ratings with PA, handedness, and split ratings (the two files carry the same ratings and differ only in the side-specific PA column)

### Computation Chain

1. **Aggregate counting stats** from Hitting Data: SUM each column
2. **Run per Out** = R / Outs
3. **Run values** (linear from run_per_out):
   - `run_bb = 0.14 + r_per_out`
   - `run_hbp = 0.025 + run_bb`
   - `run_1b = 0.155 + run_bb`
   - `run_2b = 0.3 + run_1b`
   - `run_3b = run_2b + 0.27`
   - `run_hr = 1.4` (fixed)
   - `run_sb = 0.2` (fixed)
   - `run_cs = -(2 * r_per_out + 0.075)`
4. **wOBA derivation**:
   - Pro Non Outs = 1B + 2B + 3B + HR + (BB - IBB) + HP
   - Unpro Outs = AB - (1B + 2B + 3B + HR) + SF
   - Total Run Value = SUM(count × run_value) for each event
   - Runs+ = Total Run Value / Pro Non Outs
   - Runs- = Total Run Value / Unpro Outs
   - wOBA Scale = 1 / (Runs+ + Runs-)
   - wOBA weights = (run_value + Runs-) × wOBA Scale
   - lg wSB = MAX((SB×run_sb + CS×run_cs) / (BB + HP + 1B - IBB), 0)
   - lg wOBA = (Σ count×weight) / (BB-IBB + HP + AB - (1B+2B+3B+HR) + 1B+2B+3B+HR + SF)
5. **League stat rates** from aggregates: BB%, HR%, SO%, BABIP, XBH%, 3B%, SB%, SBA%, UBR
6. **Rating averages** — PA-weighted SUMPRODUCT from batter_ratings:
   - For each rating (EYE, POW, K, BA, GAP, SPE, STE, RUN, SR):
     - avg_vR = SUMPRODUCT(PA, rating_vR) / SUM(PA)
     - avg_vL = SUMPRODUCT(PA, rating_vL) / SUM(PA)
     - combined = avg_vR × ovr_vr + avg_vL × (1 - ovr_vr)
7. **Matchup splits** — PA fraction vs RHP by batter hand:
   - LvR = PA(L batters vR) / Total PA(L batters)
   - RvR, SvR computed similarly
   - OVR vR = Total vR PA / Total PA

### Outputs → `HitterLeagueParams` fields
- Rating averages (avg_eye through avg_bsr)
- wOBA weights (wt_hbp through woba_scale)
- Matchup splits (lvr, rvr, svr, ovr_vr)
- League measurements (lg_woba, waa_const, run_cs, wsb, etc.)
- Stat rates (bb_rate through sba_rate)

## Pitching Calc Pipeline (Phase 2)

### Inputs
- `pitching_data.csv` — overall pitching stats (drives `lg_RA/9` + WAA constant)
- `sp_data.csv` / `rp_data.csv` — per-pitcher counting stats as starter / reliever → SP and RP wOBA weights, **and** the per-pitcher BF used to classify role
- `pitcher_ratings_vr.csv` / `pitcher_ratings_vl.csv` — all pitchers, both-side rating columns + `POS`; `BF` = RH-faced (vr) / LH-faced (vl). **Legacy fallback:** older seasons instead carry the 4-file `sp_ratings_vr/vl` + `rp_ratings_vr/vl` (per-role, single rating column); the loader auto-detects per season folder.

### Computation Chain
1. **SP wOBA weights** from `sp_data.csv` (BF as starter) — NOT from `pitching_data.csv`
2. **RP wOBA weights** from `rp_data.csv` — uses RP run values but **SP normalization** (SP's runs_minus and woba_scale for cross-normalization)
3. **Role classification (2-file format)** — `_build_virtual_role_frames` (`pitch_aggregator.py`) computes each pitcher's `starter_fraction = sp_BF / (sp_BF + rp_BF)` and reconstructs per-role rating frames: each pitcher's per-hand BF is scaled by `starter_fraction` (SP) / `1 − starter_fraction` (RP), and STU is converted ±5 by POS (mirrors `pitchers.py`). The 4-file legacy format skips this and uses the per-role files directly.
4. **BF-weighted SP / RP rating averages** (STU, HRR, pBABIP, CON, HLD) from the role frames
5. **Pitcher matchup splits** from the (role-weighted) BF by pitcher hand
6. **RA/9 baselines**: `R / Clean_IP × 9` for SP and RP sections
7. **WAA constant**: `lg_RA/9 × 1.5 + 3` where `lg_RA/9 = pitching_data_R / pitching_data_IP_Clean × 9` (uses overall Pitching Data, not SP+RP separately)
8. **Pitching stat rate denominators** differ from hitting: `BF - HP - BB` (no IBB subtraction)
9. **SB/CS wOBA weights**: `run_value × woba_scale` (no runs_minus offset, unlike other events)

## Fielding Calc + POS Adj Pipeline (Phase 3)

### Inputs
- `fielding_data_{pos}.csv` — 8 position-specific tables (`c`, `1b`, `2b`, `3b`, `ss`, `lf`, `cf`, `rf`)
- `fielding_ratings.csv` — per-player fielding ratings

(The `fielding_helper` / `pos_adj_helper` tables are **not** input files — they are built in code by `_build_fielding_helper` / `_build_pos_adj_helper` from the two inputs above.)

### Computation Chain
1. **Position aggregate stats** — SUM of IP, Plays, E, DP, ARM, FRM, SBA, RTO per position
2. **Derived rates**:
   - PM% = Plays_M / Plays_A (NOT Plays_M / total)
   - E% = E / Plays_M (NOT E / total)
   - PA/season = Plays_A / IP × std_IP (1000 for C, 1200 for others)
   - DP/season, ARM/season, C stats/1000 IP
3. **IP-weighted rating averages** — from fielding_helper (already has rating columns merged)
4. **Position adjustments** — POS Adj Calc formula:
   - `ip_per_bf = SUM(IP Clean) / SUM(PA)` across all players
   - Per player: `PAIP = PA × ip_per_bf`, `DH_IP = MAX(PAIP - IP_Clean, 0)`
   - Allocation: `P_OFF = OFF × P_IP / MAX(IP_Clean, PAIP)`
   - Final: `pos_adj[P] = -SUM(P_OFF) / (SUM(raw_IP[P]) / std_IP[P])`
   - LF/RF: averaged as "corner outfield" → same value for both
