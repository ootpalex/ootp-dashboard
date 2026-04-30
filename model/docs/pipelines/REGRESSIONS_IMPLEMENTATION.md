# Regressions Pipeline Implementation Status

## Overview

`src/regressions.py` replicates the WLS regression computations from `25 Regressions.xlsx`,
producing ~60 coefficients currently hardcoded in `data_points.py`.

## Files

| File | Purpose |
|------|---------|
| `src/regressions.py` | Main implementation (~960 lines) |
| `tests/test_regressions.py` | 112 tests (loading, WLS, hitting, pitching, fielding, caching, e2e) |
| `scripts/regression_diagnostics.py` | Full error baseline comparison script |
| `scripts/extract_regression_expected.py` | Answer key extraction from Excel |
| `data/regressions/expected/hitting_reg_players.json` | 440 hitter IDs |
| `data/regressions/expected/pitching_reg_players.json` | 160 SP + 224 RP IDs |
| `data/regressions/expected/fielding_reg_players.json` | Per-position IDs (C:30, IF:155, OF:90) |

## Phase Status

### Phase 0: Answer Key Extraction — COMPLETE
- Player IDs extracted and verified
- **Use hardcoded values in `data_points.py` as authoritative answer key**

### Phase 1: WLS Engine + Hitting Linear — COMPLETE
- Data loading and aggregation (concat 5 sims, filter split_id, group by player_id, join ratings)
- Answer key player ID filtering (440 hitters, 160 SP, 224 RP)
- WLS engine (`_wls_single`, `_wls_multi`, `_wls_cubic`)
- All stat rate formulas implemented
- BABIP formula: standard `(H-HR) / (AB - K - HR + SF)`
- **Split point RESOLVED**: center at PA-weighted average, split HIGH/LOW at rating=50
  - Slopes within 0-5% of answer key for all 6 hitting stats
  - Intercepts within 0.005 absolute (near-zero by construction of centered regression)

### Phase 2: Hitting Cubic + Pitching — COMPLETE
- Hitting cubic (SBA, SB%, UBR) uses split_id=1 data, STE/RUN ratings
- Pitching linear: SP/RP × 4 stats (CON/HRR/STU within 2%)
- **Pitching BABIP**: single-model regression (no high/low split), matching answer key h==l
- Pitching cubic: SBA/SB% use split_id=1 data (split_id=3 has sb=cs=0)
  - Signs and order of magnitude correct; c1 slopes ~18-80% off due to CSV data differences

### Phase 3: Fielding — COMPLETE
- C: FRM, C ARM ratings → framing, SBA, RTO (single-variable WLS)
- 1B: IF RNG + HT multi-variable WLS → PM%; IF ERR → E/IP error rate
- 2B/3B/SS: IF RNG + IF ARM multi-variable WLS → PM%; IF ERR → E/IP error rate
- **2B/SS DP**: OLS (not WLS) on team-level DP/IP from Excel Data Model lookup
- **OF (LF/CF/RF)**: OF RNG → PM%; OF ERR → **E/PO** (not E/IP); OF ARM → **arm/PA** (not arm/IP)
- NaN filtering added for players with zero PA/IP
- Correct per-position player IDs extracted from Excel: C:30, 1B:32, 2B:32, 3B:32, SS:32, LF:30, CF:30, RF:30
- **DP slopes now EXACT** (0.00%) using team-level OLS with Data Model rates
- SS DP replicates Bug 9 (only first 25 of 32 players in LINEST)

### Phase 4: Integration + Tests — COMPLETE
- Caching: SHA-256 hash of CSVs, `.regressions_cache.json`
- `generate_regression_coefficients()` cached wrapper
- 110 tests in `tests/test_regressions.py`, all passing

## Accuracy Summary

| Category | Slope Error | Notes |
|----------|-------------|-------|
| Hitting linear (12/12 slopes) | **0.00%** | All exact match after formula corrections |
| SP pitching linear (8/8 slopes) | **0.00%** | All exact match after formula corrections |
| RP pitching CON/HRR/STU (6 slopes) | <3% | rp_stu.h_slope 2.5% (gs=0 filter residual) |
| RP pitching BABIP | ~4.4% | gs=0 filter + AB column difference |
| Hitting SB% c1 | <1% | Linear WLS with SPE>=55 filter |
| Hitting SBA c1 | <3% | Linear WLS with STE>=55 filter |
| Hitting UBR c1 | <2% | Linear WLS, ubr/base_opp rate |
| SP pitching SBA c1, SP SB% c1 | **0.00%** | Linear WLS, exact match |
| RP pitching SB% c1 | ~14% | gs=0 filter residual |
| Fielding ALL slopes (26/26) | **0.00%** | All exact after OLS fix |

**Pass/fail at thresholds** (60 slope coefficients):
- <1%: 53 pass — <2%: 54 pass — <5%: 58 pass — <10%: 58 pass — <20%: **60 pass**
- **50/60 exact (0.00%)**

**Key formula corrections** (discovered by reading Excel regression sheet formulas directly):
1. Hitting BB%: denom = `PA - IBB - HBP` (was `PA - HBP`)
2. Hitting/Pitching HR%/K%: denom = `PA - IBB - BB - HBP` (was `PA - uBB - HBP`)
3. Pitching BABIP: `(HA-HRA)/(AB-HRA-K+SF)` (was BF-based BIP)
4. Pitching SBA: `(SB+CS)/(BB+HP+SA)` (was `(SB+CS)/BF`)
5. Hitting SBA: uses total BB not uBB in denominator
6. Hitting UBR: `ubr/base_opp` not `ubr/PA`
7. Hitting cubics are actually linear (slope+intercept, c2=c3=0)
8. SBA filtered to STE>=55, SB% filtered to SPE>=55
9. Hitting cubic weights use PA from split_id=3 (not split_id=1)
10. Speed LOW filter uses GAP vR (spreadsheet Bug 8, replicated)
11. Fielding answer key: per-position player IDs from Excel Data Model pivot tables
12. DP regression: OLS on team-level DP/IP (from Data Model), not WLS on player dp/ip
13. SS DP LINEST bug (Bug 9): only first 25 of 32 players included
14. **ALL fielding regressions use OLS (unweighted LINEST), not WLS**
15. **Fielding centering uses simple averages (np.mean), not IP-weighted averages**

**Root cause of remaining residual errors**: RP pitching slopes differ due to gs=0 filter
interaction with CSV data. Hitting cubics have small split_id=1 data aggregation differences.
The 2 slopes >5% are:
- speed.l_slope (15%): intentional Bug 8 fix
- rp_sb_pct c1 (14%): gs=0 filter residual

## Key Technical Details

### Piecewise Linear Regression

- **Centering**: X = rating − PA_weighted_avg_rating, Y = stat − PA_weighted_avg_stat
- **Split**: HIGH = rating >= 50, LOW = rating < 50
- Centering at the weighted average (not at 50) is critical for correct slopes

### Stat Rate Formulas (Hitting)

| Stat | Rating | Formula | Notes |
|------|--------|---------|-------|
| BB% | EYE vR | `(bb - ibb) / (pa - hp)` | |
| HR% | POW vR | `hr / (pa - (bb-ibb) - hp)` | |
| K% | K vR | `k / (pa - (bb-ibb) - hp)` | |
| BABIP | BA vR | `(h - hr) / (ab - k - hr + sf)` | Standard formula |
| XBH% | GAP vR | `(d + t) / (h - hr)` | |
| 3B% | SPE | `t / (d + t)` | fillna(0) |
| SBA | STE | `(sb + cs) / (1B + uBB + hp)` | split_id=1 |
| SB% | STE | `sb / (sb + cs)` | split_id=1 |
| UBR | RUN | `ubr / pa` | split_id=1 |

### Stat Rate Formulas (Pitching)

| Stat | Rating | Formula | Data |
|------|--------|---------|------|
| uBB% | CON vR | `(bb - iw) / (bf - hp)` | split_id=3 |
| HR% | HRR vR | `hra / (bf - (bb-iw) - hp)` | split_id=3 |
| SO% | STU vR | `k / (bf - (bb-iw) - hp)` | split_id=3 |
| BABIP | PBABIP vR | `(ha - hra) / BIP` | split_id=3 |
| SBA | HLD | `(sb + cs) / bf` | split_id=1 |
| SB% | HLD | `sb / (sb + cs)` | split_id=1 |

### Player Counts

| Dataset | Count |
|---------|-------|
| Hitters ratings CSV | 448 |
| Regression hitters | 440 (answer key filtered) |
| SP pitchers | 160 |
| RP pitchers | 224 |
| Catchers (fielding) | ~30 |
| 1B (fielding) | ~71 |
| 2B/3B/SS (fielding) | ~78/~85/~85 |
| LF/CF/RF (fielding) | ~60/~54/~60 |
