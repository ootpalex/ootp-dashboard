# Metadata Pipeline Documentation

## Overview

The `25 Metadata.xlsx` workbook is a **constant-generation pipeline**: raw OOTP game stats + player ratings → calibration constants stored in `data_points.py`.

**Module:** `src/metadata.py`
**Test suite:** `tests/test_metadata.py`
**Extracted data:** `data/metadata/inputs/` (raw data CSVs), `data/metadata/expected/` (answer keys)

## Data Flow

```
Input Tables (Hitting Data, Pitching Data, SP/RP Data, Fielding Data, Ratings)
  → Calc Sheets (aggregation + wOBA derivation + weighted averages)
    → Data Points (HitterLeagueParams, PitcherLeagueParams, FieldingParams)
```

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
- `batter_ratings.csv` — 518 batters with PA, handedness, and all split ratings

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
- `pitching_data.csv` — 512 pitchers, overall stats → SP wOBA weights
- `rp_data.csv` — 396 relievers → RP wOBA weights
- `sp_ratings.csv` — 346 SP entries with BF, ratings, HLD
- `rp_ratings.csv` — 515 RP entries with BF, ratings, HLD

### Computation Chain
1. **SP wOBA weights** from `sp_data.csv` (255 starters, BF=104928) — NOT from `pitching_data.csv`
2. **RP wOBA weights** from `rp_data.csv` — uses RP run values but **SP normalization** (SP's runs_minus and woba_scale for cross-normalization)
3. **BF-weighted SP rating averages** from sp_ratings (STU, HRR, pBABIP, CON, HLD)
4. **BF-weighted RP rating averages** from rp_ratings
5. **Pitcher matchup splits** from BF pivot tables
6. **RA/9 baselines**: `R / Clean_IP × 9` for SP and RP sections
7. **WAA constant**: `lg_RA/9 × 1.5 + 3` where `lg_RA/9 = pitching_data_R / pitching_data_IP_Clean × 9` (uses overall Pitching Data, not SP+RP separately)
8. **Pitching stat rate denominators** differ from hitting: `BF - HP - BB` (no IBB subtraction)
9. **SB/CS wOBA weights**: `run_value × woba_scale` (no runs_minus offset, unlike other events)

## Fielding Calc + POS Adj Pipeline (Phase 3)

### Inputs
- `fielding_data_{pos}.csv` — 8 position-specific tables
- `fielding_ratings.csv` — 509 players with fielding ratings
- `fielding_helper.csv` — IP distribution per player per position
- `pos_adj_helper.csv` — PA, IP, and offensive value per player

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
