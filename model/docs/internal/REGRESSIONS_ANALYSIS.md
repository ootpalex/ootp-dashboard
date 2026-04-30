# Regressions Workbook Analysis

## Overview

`25 Regressions.xlsx` (13 sheets) is the root dependency of the entire OOTP rating-to-stat architecture. It contains 50 years of simulated game output (5 separate 10-year sims, 2016–2025) plus the Weighted Least Squares (WLS) regressions that produce every coefficient used in `data_points.py`.

### Data Flow

```
┌─────────────────────────────────┐
│   25 Regressions.xlsx           │
│                                 │
│  Raw Sims          Regression   │
│  ─────────         Sheets       │
│  Batting (×5)  ──► Hitting Reg  │
│  Pitching (×5) ──► Pitching Reg │
│                    Pitching RP  │
│  Fielding (×5) ──► Fielding IF  │
│                    Fielding OF  │
│                    Fielding C   │
│                                 │
│  Hitters (ratings)              │
│  Pitchers (ratings)             │
│  Helpers (scratch)              │
│  Data Points (output)           │
└──────────┬──────────────────────┘
           │
           ▼
┌──────────────────────┐     ┌─────────────────────┐
│ 25 Metadata.xlsx     │     │ data_points.py      │
│ (league averages,    │     │ (LinearCoeffs,      │
│  matchup splits)     │     │  CubicCoeffs, etc.) │
└──────────┬───────────┘     └──────────┬──────────┘
           │                            │
           ▼                            ▼
      ┌─────────┐              ┌──────────────────┐
      │ Metadata│              │ hitters.py        │
      │ pipeline│              │ pitchers.py       │
      └─────────┘              └──────────────────┘
```

### Sheet Inventory

| Sheet | Type | Rows | Cols | Description |
|-------|------|------|------|-------------|
| Data Points | Output | ~43 | ~23 | Final regression coefficients (mirrors Metadata Data Points) |
| Hitting Reg | Regression | 447 | 268 | WLS for EYE/POW/K/BABIP/GAP/SPE + SBA/SB%/UBR |
| Fielding Reg IF | Regression | — | — | WLS for 1B/2B/3B/SS fielding stats |
| Fielding Reg OF | Regression | — | — | WLS for LF/CF/RF fielding stats |
| Fielding Reg C | Regression | — | — | WLS for C fielding stats (FRM/SBA/RTO) |
| Pitching Reg | Regression | — | — | WLS for SP CON/HRR/STU/BABIP + SBA/SB% |
| Pitching Reg RP | Regression | — | — | WLS for RP CON/HRR/STU/BABIP + SBA/SB% |
| Hitters | Input | 448 | ~100 | Player ratings (BA/GAP/POW/EYE/K + fielding + speed) |
| Pitchers | Input | 384 | ~99 | Player ratings (STU/HRR/PBABIP/CON + pitch grades) |
| Batting | Input | 43,777 | 33 | 5 sims of batting output, separated by blank rows |
| Pitching | Input | 39,178 | 58 | 5 sims of pitching output, separated by blank rows |
| Fielding | Input | 70,895 | 41 | 5 sims of fielding output, split by player_id reset |
| Helpers | Scratch | — | — | Intermediate calculations |

---

## The Math: Weighted Least Squares

Each regression sheet uses the same WLS machinery. The goal is to answer: **"For each 1-point increase in a rating (above league average), how much does the corresponding stat change?"**

### Setup

For each player-year row in the sim data:

| Symbol | Meaning | Example |
|--------|---------|---------|
| **W** | Weight = PA (hitters) or BF (pitchers) | More playing time → more influence |
| **X** | Predictor = rating − league_avg_rating | EYE rating centered at 0 |
| **Y** | Outcome = stat_rate − league_avg_stat | BB% centered at 0 |

### Per-Row Weighted Values

Each player-year row computes four weighted products:

```
wX  = W × X       (weighted predictor)
wY  = W × Y       (weighted outcome)
wXY = W × X × Y   (weighted cross-product)
wX² = W × X²      (weighted squared predictor)
```

### Grand Total Row

The **Grand Total** row (last data row in each regression block) sums all weighted columns across every player-year:

```
sumW   = Σ W        (total weight)
sumwX  = Σ wX       (sum of weighted predictors)
sumwY  = Σ wY       (sum of weighted outcomes)
sumwXY = Σ wXY      (sum of weighted cross-products)
sumwX² = Σ wX²      (sum of weighted squared predictors)
```

### WLS Formulas

From the Grand Total sums, two coefficients are computed:

```
Slope     = (sumW × sumwXY − sumwX × sumwY) / (sumW × sumwX² − sumwX²)
Intercept = (sumwY − Slope × sumwX) / sumW
```

These formulas are visible in the spreadsheet:
- `AQ3` (wSlope): `= (AQ4*AQ7 - AQ5*AQ6) / (AQ4*AQ8 - AQ5^2)`
- `AQ2` (wIntercept): `= (AQ6 - AQ3*AQ5) / AQ4`

Where AQ4=sumW, AQ5=sumwX, AQ6=sumwY, AQ7=sumwXY, AQ8=sumwX².

### Interpretation

- **Slope** = change in stat per 1-point rating increase above average
- **Intercept** = expected stat deviation at exactly league-average rating (ideally ~0)
- Higher-PA players dominate the regression (as intended — their stats are more reliable)

---

## Piecewise Splits (High/Low Models)

Ratings don't have symmetric effects. A player with 80 EYE doesn't benefit the same per-point as a player with 30 EYE. The spreadsheet handles this with **two independent regressions per stat**:

### Structure in the Regression Sheets

Each stat occupies two side-by-side column blocks:

```
Columns AG–AQ: HIGH model (rating ≥ league average → "h_const", "h_slope")
Columns AS–BC: LOW model  (rating < league average → "l_const", "l_slope")
```

**High model**: Only includes player-years where the player's rating ≥ league average for that stat. These rows get filtered into the AG–AN columns; all other rows are excluded.

**Low model**: Only includes player-years where the player's rating < league average. These rows get filtered into the AS–AZ columns.

Each block runs its own independent WLS → produces separate (intercept, slope).

### Mapping to `data_points.py`

```python
LinearCoeffs(h_const, h_slope, l_const, l_slope)
```

| Field | Source |
|-------|--------|
| `h_const` | High model intercept (wIntercept, e.g., AP2) |
| `h_slope` | High model slope (wSlope, e.g., AP3) |
| `l_const` | Low model intercept (wIntercept, e.g., BB2) |
| `l_slope` | Low model slope (wSlope, e.g., BB3) |

### Label Convention in the Sheets

Row 9 of the Hitting Reg shows labels like `hEYE` (high EYE) and `lEYE` (low EYE) confirming which block is which. The output cells (row 10) contain the final intercept and slope for use in Data Points.

### Application in Python

```python
def _rating_to_delta(rating, avg, coeffs):
    """Piecewise linear: split at rating=50 (league average)."""
    if rating >= 50:
        return coeffs.h_const + coeffs.h_slope * (rating - avg)
    else:
        return coeffs.l_const + coeffs.l_slope * (rating - avg)
```

---

## Multi-Variable Fielding Regressions

Fielding regressions are more complex than hitting/pitching because some positions use **multiple rating predictors** simultaneously.

### Sheets

| Sheet | Positions | Description |
|-------|-----------|-------------|
| Fielding Reg IF | 1B, 2B, 3B, SS | Infield: PM%, ERR, DP |
| Fielding Reg OF | LF, CF, RF | Outfield: PM%, ERR, ARM |
| Fielding Reg C | C | Catcher: FRM, SBA, RTO |

### Position-by-Position Breakdown

#### Catcher (C)
- **FRM (Framing)**: single-variable WLS on C FRM rating
- **SBA (Stolen Base Allowed rate)**: single-variable WLS on HLD rating
- **RTO (Runners Thrown Out %)**: single-variable WLS on C ARM rating

#### First Base (1B)
- **PM% (Plus/Minus)**: **two-variable** WLS on IF RNG + HT (height in cm)
  - Produces 3 coefficients: intercept, rng_slope, ht_slope
  - Maps to `FieldingRegressionCoeffs` fields: `_1b_pm_const`, `_1b_pm_rng_slope`, `_1b_pm_ht_slope`
- **ERR (Error rate)**: single-variable WLS on IF ERR rating

#### Second Base / Third Base (2B, 3B)
- **PM%**: **two-variable** WLS on IF RNG + IF ARM
  - Produces 3 coefficients: intercept, rng_slope, arm_slope
- **ERR**: single-variable WLS on IF ERR rating
- **DP (Double Play)**: single-variable WLS on TDP rating
  - 2B and 3B share the same DP regression structure but with different coefficients

#### Shortstop (SS)
- **PM%**: **two-variable** WLS on IF RNG + IF ARM (same structure as 2B/3B)
- **ERR**: single-variable WLS on IF ERR rating
- **DP**: single-variable WLS on TDP rating
  - Uses **separate coefficients** from 2B (K45/L45 vs K17/L17 in Data Points)
  - Uses separate avg TDP (Q25 vs Q17 for 2B)

#### Outfield (LF, CF, RF)
- **PM%**: single-variable WLS on OF RNG rating
- **ERR**: single-variable WLS on OF ERR rating
- **ARM**: single-variable WLS on OF ARM rating

### Multi-Variable WLS Extension

For two predictors X₁ and X₂, the WLS extends to:

```
wX₁  = W × X₁
wX₂  = W × X₂
wY   = W × Y
wX₁Y = W × X₁ × Y
wX₂Y = W × X₂ × Y
wX₁² = W × X₁²
wX₂² = W × X₂²
wX₁X₂ = W × X₁ × X₂
```

The system of normal equations produces two slopes and an intercept:

```
[sumW    sumwX₁    sumwX₂  ] [β₀]   [sumwY  ]
[sumwX₁  sumwX₁²  sumwX₁X₂] [β₁] = [sumwX₁Y]
[sumwX₂  sumwX₁X₂ sumwX₂² ] [β₂]   [sumwX₂Y]
```

---

## Cubic Polynomials (SBA, SB%, UBR)

Baserunning stats use **cubic polynomial** regressions instead of linear, because the relationship between speed/stealing ratings and baserunning outcomes is nonlinear.

### Setup

For cubic regressions, the predictor columns include X, X², and X³:

```
wX   = W × X
wX²  = W × X²
wX³  = W × X³
wXY  = W × X × Y
wX²Y = W × X² × Y
wX³Y = W × X³ × Y
```

### Coefficients

The WLS produces four coefficients:

```python
CubicCoeffs(c0, c1, c2=0, c3=0)
```

| Field | Meaning |
|-------|---------|
| `c0` | Intercept (value at X=0, i.e., at league-average rating) |
| `c1` | Linear slope |
| `c2` | Quadratic coefficient |
| `c3` | Cubic coefficient |

### OOTP 26 Simplification

In the current OOTP 26 data, **c2 and c3 are effectively zero** for all baserunning stats (SBA, SB%, UBR). This means the cubic regressions collapse to linear regressions in practice, but the infrastructure supports full cubic models for future versions.

### Stats Using Cubic Regressions

| Stat | Rating Input | Used By |
|------|-------------|---------|
| SBA (Stolen Base Attempts) | STE (Stealing) | Hitters |
| SB% (Stolen Base Success Rate) | STE (Stealing) | Hitters, Pitchers |
| UBR (Ultimate Base Running) | RUN (Running) | Hitters |
| SBA (pitcher) | HLD (Hold Runners) | Pitchers |

### Pitcher SB% Special Case

Pitchers have separate `sp_sb_pct` and `rp_sb_pct` cubic coefficients. Both share the same `c1` slope but have **different `c0` intercepts** — SP vs RP baselines differ because starters and relievers face different base-stealing contexts.

---

## No Pivot Tables

The "Reg" sheets are **NOT** pivot tables. They ARE the calculations. There are no Excel PivotTable objects in this workbook. The WLS is computed row-by-row with column formulas and a Grand Total sum row at the bottom. The regression output (intercept/slope) appears in summary cells at the top (rows 2–3 and 9–10).

This is important because it means there's nothing to "refresh" — the regression outputs are pure formula-driven and fully determined by the input sim data.

---

## Output Mapping

### Hitting Regression Coefficients

The Hitting Reg sheet (447 rows × 268 cols) contains ~15 regression blocks arranged horizontally. Row 3 headers and rows 9–10 labels/outputs identify each stat.

| Stat | Rating | Hitting Reg Columns | Data Points Cell | `data_points.py` Field |
|------|--------|-------------------|-----------------|----------------------|
| BB% (Eye) | EYE vR | AG–AQ (high), AS–BC (low) | H3/H4/I3/I4 | `eye` LinearCoeffs |
| HR% (Power) | POW vR | Next block pair | H5/H6/I5/I6 | `power` LinearCoeffs |
| K% | K vR | Next block pair | H7/H8/I7/I8 | `k` LinearCoeffs |
| BABIP | BA vR | Next block pair | H9/H10/I9/I10 | `babip` LinearCoeffs |
| XBH% (Gap) | GAP vR | Next block pair | H11/H12/I11/I12 | `gap` LinearCoeffs |
| 3B% (Speed) | SPE | Next block pair | H13/H14/I13/I14 | `speed` LinearCoeffs |
| SBA rate | STE | Cubic block | H15/H16 | `sba` CubicCoeffs |
| SB% | STE | Cubic block | H17/H18 | `sb_pct` CubicCoeffs |
| UBR | RUN | Cubic block | H19/H20 | `ubr` CubicCoeffs |

**Note**: GAP regression uniquely uses the SAME h_const/h_slope for BOTH high and low models (unlike other regressions which have distinct high/low coefficients).

### Pitching Regression Coefficients

Split across two sheets: Pitching Reg (SP) and Pitching Reg RP.

| Stat | Rating | Sheet | Data Points Cell | `data_points.py` Field |
|------|--------|-------|-----------------|----------------------|
| SP uBB% | CON | Pitching Reg | K3/K4/L3/L4 | `sp_con` LinearCoeffs |
| SP HR% | HRR | Pitching Reg | K5/K6/L5/L6 | `sp_hrr` LinearCoeffs |
| SP SO% | STU | Pitching Reg | K7/K8/L7/L8 | `sp_stu` LinearCoeffs |
| SP BABIP | PBABIP | Pitching Reg | K9/K10/L9/L10 | `sp_babip` LinearCoeffs |
| SP SBA | HLD | Pitching Reg | K15/K16 | `sba` CubicCoeffs (shared) |
| SP SB% | HLD | Pitching Reg | K17/K18 | `sp_sb_pct` CubicCoeffs |
| RP uBB% | CON | Pitching Reg RP | K3/K4/L3/L4 | `rp_con` LinearCoeffs |
| RP HR% | HRR | Pitching Reg RP | K5/K6/L5/L6 | `rp_hrr` LinearCoeffs |
| RP SO% | STU | Pitching Reg RP | K7/K8/L7/L8 | `rp_stu` LinearCoeffs |
| RP BABIP | PBABIP | Pitching Reg RP | K9/K10/L9/L10 | `rp_babip` LinearCoeffs |
| RP SB% | HLD | Pitching Reg RP | K17/K18 | `rp_sb_pct` CubicCoeffs |

### Fielding Regression Coefficients

Spread across three sheets, mapped to `FieldingRegressionCoeffs` in `data_points.py`.

| Position | Stat | Rating(s) | Sheet | `data_points.py` Field Pattern |
|----------|------|-----------|-------|-------------------------------|
| C | FRM | C FRM | Fielding Reg C | `c_frm_const/slope` |
| C | SBA | HLD | Fielding Reg C | `c_sba_const/slope` |
| C | RTO | C ARM | Fielding Reg C | `c_rto_const/slope` |
| 1B | PM% | IF RNG + HT | Fielding Reg IF | `_1b_pm_const/rng_slope/ht_slope` |
| 1B | ERR | IF ERR | Fielding Reg IF | `_1b_err_const/slope` |
| 2B | PM% | IF RNG + IF ARM | Fielding Reg IF | `_2b_pm_const/rng_slope/arm_slope` |
| 2B | ERR | IF ERR | Fielding Reg IF | `_2b_err_const/slope` |
| 2B | DP | TDP | Fielding Reg IF | `_2b_dp_const/slope` |
| 3B | PM% | IF RNG + IF ARM | Fielding Reg IF | `_3b_pm_const/rng_slope/arm_slope` |
| 3B | ERR | IF ERR | Fielding Reg IF | `_3b_err_const/slope` |
| 3B | DP | TDP | Fielding Reg IF | `_3b_dp_const/slope` |
| SS | PM% | IF RNG + IF ARM | Fielding Reg IF | `ss_pm_const/rng_slope/arm_slope` |
| SS | ERR | IF ERR | Fielding Reg IF | `ss_err_const/slope` |
| SS | DP | TDP | Fielding Reg IF | `ss_dp_const/slope` |
| LF | PM% | OF RNG | Fielding Reg OF | `lf_pm_const/slope` |
| LF | ERR | OF ERR | Fielding Reg OF | `lf_err_const/slope` |
| LF | ARM | OF ARM | Fielding Reg OF | `lf_arm_const/slope` |
| CF | PM% | OF RNG | Fielding Reg OF | `cf_pm_const/slope` |
| CF | ERR | OF ERR | Fielding Reg OF | `cf_err_const/slope` |
| CF | ARM | OF ARM | Fielding Reg OF | `cf_arm_const/slope` |
| RF | PM% | OF RNG | Fielding Reg OF | `rf_pm_const/slope` |
| RF | ERR | OF ERR | Fielding Reg OF | `rf_err_const/slope` |
| RF | ARM | OF ARM | Fielding Reg OF | `rf_arm_const/slope` |

---

## Extracted Data Files

The extraction script (`scripts/extract_regressions.py`) produces 17 CSV files in `data/regressions/`:

| File | Source Sheet | Description |
|------|-------------|-------------|
| `hitters_ratings.csv` | Hitters | Player ratings (~448 rows) |
| `pitchers_ratings.csv` | Pitchers | Player ratings (~384 rows) |
| `batting_sim_1.csv` … `_5.csv` | Batting | 5 sims (~8,734 rows × 33 cols each) |
| `pitching_sim_1.csv` … `_5.csv` | Pitching | 5 sims (~7,833 rows × 58 cols each) |
| `fielding_sim_1.csv` … `_5.csv` | Fielding | 5 sims (~11,850 rows × 41 cols each) |
