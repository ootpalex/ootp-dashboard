# OOTP Rating System — Reverse Engineering Documentation

## Project Overview

This project reverse-engineers two Excel workbooks — **The Sheet Hitters.xlsx** and **The Sheet Pitchers.xlsx** — into a Python script. The spreadsheets form a data-based player rating system for OOTP Baseball that normalizes player attributes to league context.

### Data Flow

```
25 Regressions.xlsx
        ↓
  (updates coefficients / regression results)
        ↓
25 Metadata.xlsx
        ↓
  (provides league normalization values)
        ↓
The Sheet Hitters.xlsx / The Sheet Pitchers.xlsx
  ├── Data Points  ← receives values from Metadata
  ├── Ballparks    ← park factor inputs (manual)
  ├── Player List  ← raw OOTP export (paste-in)
  └── Hitters / Pitchers  ← computed output
```

**For this project phase, we focus only on The Sheet Hitters and The Sheet Pitchers.**

The `Data Points` sheet constants are the key bridge from the external sheets. When implementing in Python, these values will be hardcoded from the spreadsheets (and should be updatable per league/season).

---

## Workbook: `25 Regressions.xlsx`

The regressions workbook (13 sheets) is the root dependency — it contains 50 years of simulated game output (5 separate 10-year sims, 2016–2025) plus the Weighted Least Squares regressions that produce every coefficient in `data_points.py`.

### Sheets

| Sheet | Type | Rows | Cols | Description |
|-------|------|------|------|-------------|
| Data Points | Output | ~43 | ~23 | Final regression coefficients |
| Hitting Reg | Regression | 447 | 268 | WLS for EYE/POW/K/BABIP/GAP/SPE + SBA/SB%/UBR |
| Fielding Reg IF | Regression | — | — | WLS for 1B/2B/3B/SS fielding |
| Fielding Reg OF | Regression | — | — | WLS for LF/CF/RF fielding |
| Fielding Reg C | Regression | — | — | WLS for C fielding (FRM/SBA/RTO) |
| Pitching Reg | Regression | — | — | WLS for SP ratings |
| Pitching Reg RP | Regression | — | — | WLS for RP ratings |
| Hitters | Input | 448 | 100 | Player ratings |
| Pitchers | Input | 384 | 99 | Player ratings |
| Batting | Input | 43,777 | 33 | 5 sims of batting output |
| Pitching | Input | 39,178 | 58 | 5 sims of pitching output |
| Fielding | Input | ~59,263 | 41 | 5 sims of fielding output |
| Helpers | Scratch | — | — | Intermediate calculations |

### Extracted Data

The 17 CSVs derived from `25 Regressions.xlsx` ship pre-extracted at `data/regressions/ootp26/` (added in v0.1.1 so CI can run the full pytest suite). `model/src/regressions.py` reads them directly via `load_regression_inputs(regressions_dir)`. For a new OOTP version, drop fresh sim CSVs into `data/regressions/ootp<version>/` and run `regressions.py` against that path — see [`../../docs/MULTI_LEAGUE.md`](../../docs/MULTI_LEAGUE.md) for the workflow.

- `hitters_ratings.csv`, `pitchers_ratings.csv` — player ratings
- `batting_sim_1.csv` … `_5.csv` — batting sim data (~8,750 rows × 33 cols each)
- `pitching_sim_1.csv` … `_5.csv` — pitching sim data (~7,833 rows × 58 cols each)
- `fielding_sim_1.csv` … `_5.csv` — fielding sim data (~11,850 rows × 41 cols each)
- `calibration/` — answer-key JSONs and per-team DP rates (optional, used by integration tests)

See `docs/REGRESSIONS_ANALYSIS.md` for the complete WLS math and coefficient mapping.

---

## Common Structure (Both Workbooks)

Both workbooks share the same 4 relevant sheets with parallel structures:
- **Player List** — raw OOTP data import table (named table `Players`)
- **Data Points** — model constants: regression coefficients, league averages, wOBA weights
- **Ballparks** — 28-team park factor table, computed park stat deltas
- **Hitters / Pitchers** — main output sheet: one row per player, all computed stats

---

## Sheet: `Player List` (Both Workbooks)

The `Player List` sheet is referenced in all formulas as the Excel table **`Players`**.

**Key fact:** This sheet is almost entirely raw paste-from-OOTP data. Only the last few columns have formulas.

### Hitters Workbook — Player List
- **Dimensions:** 8,451 rows × 110 columns (A through DF)
- **Table name:** `Players`

**Column Headers (Row 1):**

| Col | Header | Notes |
|-----|--------|-------|
| A | Sheet ID | Sequential integer (1, 2, 3...), the join key |
| B | Manual | 'NO' default; can be overridden |
| C | ID | OOTP Player ID |
| D | POS | Primary position |
| E | Name | Player name |
| F | ORG | Organization/team |
| G | Lev | Level (MLB, AAA, AA, etc.) |
| H | DOB | Date of birth |
| I | Age | Age |
| J | HT | Height string (e.g., "6'2\"") |
| K | WT | Weight |
| L | B | Bats (R/L/S) |
| M | T | Throws (R/L) |
| N | Nat. Pop. | National popularity |
| O | Loc. Pop. | Local popularity |
| P–W | OVR, POT, LEA, LOY, AD, FIN, WE, INT | Scouting/personality |
| X | Type | Player type |
| Y | Prone | Injury prone flag |
| Z | INJ | Injured flag |
| AA | INJ2 | Injury detail |
| AB | Left | Days left on IL |
| AC | BABIP | Contact/BABIP rating (0–100) |
| AD | GAP | Gap power rating (0–100) |
| AE | POW | Home run power rating (0–100) |
| AF | EYE | Walk/eye rating (0–100) |
| AG | K's | Strikeout avoidance rating (0–100) |
| AH–AL | BA vL, GAP vL, POW vL, EYE vL, K vL | Ratings vs LHP |
| AM–AQ | BA vR, GAP vR, POW vR, EYE vR, K vR | Ratings vs RHP |
| AR–AV | HT P, GAP P, POW P, EYE P, K P | Prospect ratings |
| AW | BUN | Bunting rating |
| AX | BFH | Bunt for hit rating |
| AY | BBT | Ground ball tendency |
| AZ | GBT | Ground ball tendency |
| BA | FBT | Fly ball tendency |
| BB | C ABI | Catcher ability rating |
| BC | C FRM | Catcher framing rating |
| BD | C ARM | Catcher arm rating |
| BE | IF RNG | Infield range rating |
| BF | IF ERR | Infield error rating |
| BG | IF ARM | Infield arm rating |
| BH | TDP | Turn double play rating |
| BI | OF RNG | Outfield range rating |
| BJ | OF ERR | Outfield error rating |
| BK | OF ARM | Outfield arm rating |
| BL–BT | P, C, 1B, 2B, 3B, SS, LF, CF, RF | Position ratings (current) |
| BU–CC | P Pot–RF Pot | Position ratings (potential) |
| CD | SPE | Speed rating |
| CE | SR | Speed rating (steal) |
| CF | STE | Stealing rating |
| CG | RUN | Baserunning rating |
| CH | SLR | Salary string (e.g., "5.2m", "800k") |
| CI | YL | Years left on contract |
| CJ | CV | Contract value |
| CK | TY | Contract type |
| CL | ECV | Extension contract value |
| CM | ETY | Extension contract type |
| CN | MLY | MLB years |
| CO | MLD | MLB days |
| CP | PROY | Projected role |
| CQ | OPT | Option status |
| CR | OY | Option years |
| CS | ON40 | On 40-man roster |
| CT | IC | IL category |
| CU | WAIV | On waivers |
| CV | DEM | Demand/asking price string |
| CW | R5 | Rule 5 eligible |
| CX | Column1 | (unused/internal) |
| CY | Column3 | (unused/internal) |

**Computed columns (only columns with formulas):**

| Col | Header | Formula |
|-----|--------|---------|
| CZ | SLR Sort | `=IFERROR(VALUE(SUBSTITUTE(SUBSTITUTE([SLR],"k","E3"),"m","E6")), 0)` — converts salary string to number |
| DA | DEM Sort | `=IFERROR(VALUE(SUBSTITUTE(SUBSTITUTE([DEM],"k","E3"),"m","E6")), IF([DEM]="Impossible",4000000,0))` |
| DB | HT Sort | `=IFERROR((LEFT(J,"'")-1)*30.48 + MID(...))*2.54, "")` — height in cm |
| DD | Price | `=IF(AND([SLR Sort]=0,[ORG]="-"), [DEM Sort], MAX([SLR Sort], 750000))` |
| DE | C Trained | `=IFERROR(IF(OR([C]=[C Pot],[C]+5=[C Pot]),TRUE,FALSE),TRUE)` — catcher positional training check |

---

### Pitchers Workbook — Player List
- **Dimensions:** 8,000 rows × 104 columns (A through CZ)
- **Table name:** `Players`

The Pitchers Player List has **different attribute columns** because it exports pitcher-specific data from OOTP:

**Key Differences from Hitters List:**

Instead of BA/GAP/POW/EYE/K ratings, pitchers have:

| Col | Header | Notes |
|-----|--------|-------|
| AB | STU | Stuff rating (overall) |
| AC | PBABIP | Pitcher BABIP control rating |
| AD | HRR | HR rate rating |
| AE | CON | Control rating (overall) |
| AF–AI | STU vL, HRR vL, PBABIP vL, CON vL | Ratings vs LHB |
| AJ–AM | STU vR, HRR vR, PBABIP vR, CON vR | Ratings vs RHB |
| AN–AQ | STU P, HRR P, PBABIP P, CON P | Prospect ratings |
| AR–BO | FB, FBP, CH, CHP, CB, CBP, SL, SLP, SI, SIP, SP, SPP, CT, CTP, FO, FOP, CC, CCP, SC, SCP, KC, KCP, KN, KNP | Pitch grades (grade + potential pairs) |
| BP | PIT | Pitching ability |
| BQ | G/F | Ground/fly ball ratio |
| BR | VELO | Velocity |
| BS | VT | Velocity trend |
| BT | Slot2 | Arm slot |
| BU | PT | Pitch type |
| BV | STM | Stamina |
| BW | HLD | Hold rating |
| BX | P | Pitcher position rating |
| BY | P Pot | Pitcher position potential |

**Computed columns (Pitchers Player List):**

| Col | Header | Formula |
|-----|--------|---------|
| CQ | SLR Sort | Same as Hitters (salary string to number) |
| CR | DEM Sort | Same as Hitters |
| CS | Price | Same as Hitters |
| CU | HT Sort | Same as Hitters (height to cm) |
| CV | Pitches | `SUM(IF(KNP<>"-",2,0), IF(FBP<>"-",1,0), ...)` — total pitch count (knuckleball=2) |
| CW | SP P Pitch | `SUM(IF(KNP>25 AND KNP<>"-",2,0), ...)` — prospect SP pitches with grade >25 |
| CX | SP Pitch | Same but using current grades (not potential) |

---

## Sheet: `Ballparks` (Both Workbooks)

The Ballparks sheet is **identical in structure** between both workbooks. It holds park factor data for 28 teams.

- **Dimensions:** 40 rows × 67 columns (A through BO)

### Layout

| Rows | Content |
|------|---------|
| 3 | Column headers |
| 4–31 | One row per team (28 teams) |
| 33 | League averages (AVERAGE of rows 4–31 for raw PF columns) |
| 34 | Column headers for the computed stat section |
| 35–40 | Dynamic lookup rows for the selected team (driven by `Filters!$C$3`) |

### Column Groups

**Raw Park Factors (manually entered, columns C–K):**
| Col | Header | Description |
|-----|--------|-------------|
| C | PF AVG | Overall average park factor |
| D | AVG L | BA park factor for LHB |
| E | AVG R | BA park factor for RHB |
| F | PF HR | Overall HR park factor |
| G | HR L | HR park factor for LHB |
| H | HR R | HR park factor for RHB |
| I | PF D | Doubles park factor |
| J | PF T | Triples park factor |
| K | PF | Overall composite PF |

**Normalized Adjustments (formulas, columns L–T):**
Each column is `= raw_PF / league_average_PF` (e.g., `=C4/C$33`).

**Handedness-specific Stat Columns (columns U–AB):**
| Col | Header | Formula |
|-----|--------|---------|
| U | 2B RH | `= [PF D ADJ]` |
| V | 2B LH | `= [PF D ADJ]` |
| W | 3B RH | `= [PF T ADJ]` |
| X | 3B LH | `= [PF T ADJ]` |
| Y | BA SH | `= BA RH * SvR + BA LH * (1-SvR)` |
| Z | HR SH | `= HR RH * SvR + HR LH * (1-SvR)` |
| AA | 2B SH | `= [PF D ADJ]` |
| AB | 3B SH | `= [3B RH]` |

**Computed Per-PA Stat Deltas vs RH Pitcher (columns AC–AR):**

These compute the expected stat counts per-PA for a batter at this park, vs a RH pitcher, using `Data Points` league rates:

| Col | Header | Formula |
|-----|--------|---------|
| AC | HBP RH | `= DP.HBP% * DP.PA` |
| AD | BB RH | `= DP.BB% * (DP.PA - HBP)` |
| AE | HR RH | `= DP.HR% * (DP.PA - BB - HBP) * [HR RH]` |
| AF | SO RH | `= DP.SO% * (DP.PA - BB - HBP)` |
| AH | H-HR RH | `= DP.BABIP * (DP.PA - BB - HBP - HR - SO) * [BA RH]` |
| AG | XBH-HR RH | `= DP.XBH% * H-HR * [2B RH]` |
| AI | 3B RH | `= XBH-HR * DP.3B% * [3B RH]` |
| AJ | 2B RH | `= XBH-HR - 3B` |
| AK | 1B RH | `= H-HR - XBH-HR` |
| AL | OBP RH | `= (BB + HBP + H-HR + HR) / DP.PA` |
| AM | wOBA RH | `= (wt_HBP*HBP + wt_BB*BB + wt_1B*1B + wt_2B*2B + wt_3B*3B + wt_HR*HR) / DP.PA` |
| AN | BatR RH | `= (wOBA - DP.lgwOBA) / DP.wOBA_scale * DP.PA` |
| AO | Adj OBP RH | `= OBP - AM$33_OBP` (delta vs league-avg row 33) |
| AP | Adj wOBA RH | `= wOBA - AM$33` (delta vs computed league-avg wOBA, NOT vs H29 constant) |
| AQ | Adj BatR RH | `= BatR - AM$33_BatR` |
| AR | Park wOBA RH | `= AP + H29` (adj_woba re-anchored to Data Points constant) |

> **Critical subtlety (verified in implementation):** `AP = wOBA - AM$33` subtracts the
> *computed* league-average row's wOBA (~0.32253), not the Data Points constant H29 (0.32263).
> `AR = AP + H29` then re-adds the constant. Since these two values differ by ~0.0001,
> `AR ≠ AM` — park_woba is slightly shifted relative to raw wOBA. This shift propagates
> through BL → BM → BN → BO and is the correct behavior to replicate.

**Computed Per-PA Stat Deltas vs LH Pitcher (columns AS–BH):** Same structure as vR columns,
but using `ba_lh` (col M) and `hr_lh` (col P) park factors instead of `ba_rh`/`hr_rh`.
Doubles and triples adjustments (`pf_d_adj`, `pf_t_adj`) are identical between hands.

**Weighted & Summary Columns (columns BI–BO):**
| Col | Header | Formula |
|-----|--------|---------|
| BI | wtd OBP | `= OBP_RH * H25 + OBP_LH * (1-H25)` (H25 = SvR = 0.741, switch-hitter split) |
| BJ | wtd wOBA | `= AM * H26 + BC * (1-H26)` (H26 = OVR_vR = 0.739; AM=wOBA RH, BC=wOBA LH) |
| BK | wtd BatR | `= BatR_RH * H26 + BatR_LH * (1-H26)` |
| BL | wtd Park wOBA | `= AR * H26 + BH * (1-H26)` (AR=park_woba RH, BH=park_woba LH) |
| BM | wOBA/lgwOBA | `= BL / H29` |
| BN | wRAA | `= (BL - H29) / H20 * H31` |
| BO | Adj | `= -1 * (BN + H40 * H31 * (1 - BM))` |

> **BJ vs BL:** These are numerically close but not identical. BJ uses raw wOBA values;
> BL uses park_woba values (shifted by ~0.0001 per the AP/AR subtlety above). BM uses BL.

### Row 33: League Averages
`=SUM(C4:C31)/COUNTA(C4:C31)` for each raw PF column C–K.
Also computes the full per-PA stat pipeline using neutral-park factors (all adj = 1.0).
This row's wOBA (~0.32253) is the baseline subtracted in AP/AO/AQ formulas.

### Rows 35–40: Dynamic Team Lookup
These rows are referenced by the Hitters/Pitchers formulas as the "active" park.

Row 37 (vR deltas) and row 40 (vL deltas) are the key outputs:
- `AE$37` = HR delta for RH batters = (team_vR.hr − row33_vR.hr) × home_fraction
- `AH$37` = H-HR delta for RH batters
- `AG$37` = XBH-HR delta for RH batters
- `AI$37` = 3B delta for RH batters
- `AE$40` = HR delta for LH batters (uses LH lookup — correct)

```
Row 37: =IF(Filters!$C$3="", 0, (team_stat_row35 - league_avg_row33) * Filters!$G$3)
```
`Filters!$G$3` is the home/away game fraction (0.0–1.0; typically ~0.5 for a full season).

> **Known spreadsheet bug (replicated faithfully):** `AH$40`, `AG$40`, `AI$40` reference
> the RH lookup row (row 35) instead of the LH lookup row (row 38). This means the
> H-HR, XBH-HR, and 3B deltas for LH batters are identical to their RH counterparts.
> Only `AE$40` (HR delta) correctly uses the LH-adjusted values.

---

## Sheet: `Data Points`

This sheet holds all model constants: regression coefficients, league-average ratings, wOBA weights, and derived league-average stat rates. **This is the engine of the entire model.**

---

### Data Points — Hitters Workbook

**Dimensions:** 47 rows × 27 columns (B through Z)

#### Section 1: Hitting Rating Regression Coefficients (B–E, rows 2–19)

For each of the 6 main batting ratings, a **2-coefficient linear model** maps rating → stat rate:
`stat_rate = constant + slope * (rating - league_avg_rating)`

For the 3 running stats (SBA, SB%, UBR), a **4-coefficient cubic polynomial**:
`value = SUMPRODUCT((rating - avg)^{0,1,2,3}, [c0, c1, c2, c3])`

**Linear Rating Coefficients (rows 2–13):**

| Rows | Rating | B (h_const) | C (h_slope) | D (l_const) | E (l_slope) |
|------|--------|------------|------------|------------|------------|
| 2–3 | EYE | 0.001770 | 0.001870 | -0.003364 | 0.002052 |
| 4–5 | POW | -0.000383 | 0.001304 | -0.005860 | 0.000781 |
| 6–7 | K's | -0.008442 | -0.005063 | -0.005814 | -0.007939 |
| 8–9 | BABIP | 0.000230 | 0.002097 | 0.002732 | 0.002867 |
| 10–11 | GAP | 0.008329 | 0.003221 | 0.011803 | 0.006513 |
| 12–13 | SPE | 0.009946 | 0.001400 | -0.001969 | 0.002249 |

> **h** = "high" model (used when rating ≥ 50), **l** = "low" model (used when rating < 50)

**Cubic Running Stat Coefficients (rows 14–19):**

| Rows | Stat | B (c0) | C (c1) | D (c2) | E (c3) |
|------|------|--------|--------|--------|--------|
| 14–15 | SBA | 0.009117 | 0.013805 | **0.0** | **0.0** |
| 16–17 | SB% | -0.133207 | 0.008501 | **0.0** | **0.0** |
| 18–19 | UBR | 3.094e-05 | 1.520e-04 | **0.0** | **0.0** |

> **Confirmed (via openpyxl extraction of 25 Regressions.xlsx):** c2 and c3 are blank/zero for
> all three running stats in OOTP 26. The cells are reserved but unused. Same is true for all
> fielding and pitching cubic terms.

#### Section 2: Hitting Rating Averages (G–H, rows 2–20)

League-average rating values for each attribute (from regression calibration):

| Row | Stat | Average |
|-----|------|---------|
| H2 | Eye (league avg) | 49.82 |
| H3 | Power (league avg) | 48.93 |
| H4 | AvK (league avg) | 53.07 |
| H5 | BABIP (league avg) | 51.86 |
| H6 | Gap (league avg) | 52.24 |
| H7 | Speed (league avg) | 47.61 |
| H8 | Stealing (league avg) | 50.46 |
| H9 | Baserunning (league avg) | 54.29 |

> `H5` is the BABIP/BA rating average — used in all batting stat formulas as the centering point.
> `H8` is the STE (steal) rating average — used for SBAT/wSB/UBR polynomials.
> `H9` is the RUN rating average — used for UBR polynomial.

#### Section 3: wOBA Weights and Rate Constants (G–H, rows 11–20)

| Row | Stat | Value |
|-----|------|-------|
| H12 | wt_HBP | 0.7268 |
| H13 | wt_BB | 0.6971 |
| H14 | wt_1B | 0.8812 |
| H15 | wt_2B | 1.2375 |
| H16 | wt_3B | 1.5581 |
| H17 | wt_HR | 1.9872 |
| H18 | wt_SB | 0.2375 |
| H19 | wt_CS | -0.5017 |
| H20 | wOBA_scale | 1.1876 |

#### Section 4: Matchup Weights (G–H, rows 23–26)

These determine how to weight vL vs vR splits based on batter handedness:

| Row | Stat | Value | Meaning |
|-----|------|-------|---------|
| H23 | LvR | 0.776 | % of PA for LHB that are vs RHP |
| H24 | RvR | 0.720 | % of PA for RHB that are vs RHP |
| H25 | SvR | 0.741 | % of PA for switch hitters that are vs RHP |
| H26 | OVR vR | 0.739 | Used in Ballparks for park weighting |

**Usage in formulas:** For a right-handed batter (B="R"):
`wOBA_wtd = wOBA_vL * (1 - H24) + wOBA_vR * H24`

#### Section 5: League Measurements (G–H, rows 29–41)

| Row | Stat | Value |
|-----|------|-------|
| H29 | lgwOBA | 0.3226 |
| H30 | WAA Constant | 10.073 |
| H31 | PA (full season) | 600 |
| H32 | PA Catcher (reduced) | 500 |
| H33 | IP (full season) | 1200 |
| H34 | IP Catcher | 1000 |
| H35 | RunCS (value of CS) | -0.422 |
| H36 | wSB (per SB value) | 0.006601 |
| H37 | HBP% (league) | 0.010154 |
| H38 | Infield Out rate | 0.75 |
| H39 | Outfield Out rate | 0.90 |
| H40 | R/PA (league) | 0.1214 |
| H41 | Ballpark wOBA | formula using wOBA weights |

#### Section 6: Hitting Stat Rates (B–D, rows 33–41)

League-average rates used to compute per-PA stat counts:

| Row | B (Label) | C (Rate) | D (Count formula) |
|-----|-----------|----------|-------------------|
| 33 | BB% | 0.08749 | `= C33 * (PA - HBP_count)` |
| 34 | HR% | 0.03429 | `= C34 * (PA - BB - HBP)` |
| 35 | SO% | 0.24754 | `= C35 * (PA - BB - HBP)` |
| 36 | BABIP | 0.30309 | `= (PA - BB - HR - SO - HBP) * BABIP` |
| 37 | XBH% | 0.26392 | `= H-HR * XBH%` |
| 38 | 3B% | 0.08966 | `= XBH * 3B%` |
| 39 | SB% | 0.78104 | `= XBH - 3B` (2B count, label is misleading) |
| 40 | UBR | -0.001380 | `= H-HR - XBH` (1B count, label is misleading) |
| 41 | SBA% | 0.10259 | Stolen base attempt rate |

> **Note:** In rows 39 and 40, the B column labels ('SB%', 'UBR') are coefficient labels for a separate use; the D column formulas compute 2B and 1B counts respectively.

#### Section 7: Fielding Regression Coefficients (K–M, rows 2–45)

Linear coefficients mapping fielding ratings to fielding stats. All are single-segment (no high/low split at 50 like hitting regressions). Column K = intercept, L = primary slope, M = secondary slope (when applicable).

Multi-variable regressions: 1B PM% uses IF RNG + HT Sort (range + height); 2B/3B/SS PM% use IF RNG + IF ARM (range + arm). All others are single-variable.

| Rows | Stat | K (const) | L (slope) | M (slope2) | Input Rating | P (avg) | Q (avg2) |
|------|------|-----------|-----------|------------|--------------|---------|----------|
| 2–3 | C FRM | -0.000114 | 0.000547 | — | C FRM | 62.693 | — |
| 4–5 | C SBA | 0.000249 | -0.000696 | — | C ARM | 54.326 | — |
| 6–7 | C RTO% | 0.003682 | 0.002416 | — | C ARM | 54.326 | — |
| 8–9 | 1B PM% | -0.000138 | 0.001003 | 0.000388 | IF RNG | 44.873 | HT: 189.806 |
| 10–11 | 1B E% | 0.000003 | -0.000079 | — | IF ERR | 44.067 | — |
| 12–13 | 2B PM% | -0.000667 | 0.003756 | 0.000316 | IF RNG | 60.495 | IF ARM: 51.332 |
| 14–15 | 2B E% | 0.007875 | -0.000133 | — | IF ERR | 57.269 | — |
| 16–17 | 2B DP | 0.000003 | 0.000162 | — | TDP | 60.887 | — |
| 18–19 | 3B PM% | 0.000719 | 0.001378 | 0.001363 | IF RNG | 54.645 | IF ARM: 65.053 |
| 20–21 | 3B E% | -0.000025 | -0.000213 | — | IF ERR | 57.098 | — |
| 22–23 | SS PM% | 0.000305 | 0.004132 | 0.001612 | IF RNG | 67.091 | IF ARM: 62.612 |
| 24–25 | SS E% | 0.015278 | -0.000274 | — | IF ERR | 60.507 | TDP: 61.970* |
| 26–27 | LF PM% | -0.000767 | 0.003134 | — | OF RNG | 56.062 | — |
| 28–29 | LF E% | -0.000034 | -0.000188 | — | OF ERR | 55.193 | — |
| 30–31 | LF ARM | -0.000010 | 0.000179 | — | OF ARM | 59.186 | — |
| 32–33 | CF PM% | -0.000019 | 0.005036 | — | OF RNG | 67.223 | — |
| 34–35 | CF E% | 0.000022 | -0.000200 | — | OF ERR | 56.367 | — |
| 36–37 | CF ARM | -0.000006 | 0.000186 | — | OF ARM | 56.740 | — |
| 38–39 | RF PM% | 0.000069 | 0.002907 | — | OF RNG | 58.218 | — |
| 40–41 | RF E% | -0.000077 | -0.000231 | — | OF ERR | 55.233 | — |
| 42–43 | RF ARM | -0.000032 | 0.000204 | — | OF ARM | 63.428 | — |
| 44–45 | SS DP | 0.000015 | 0.000115 | — | TDP | Q25: 61.970 | — |

> *Q25 is shared: it serves as the SS TDP average for SS DPAA and the SS IF ERR average for SS E%.

> **Bug 5:** The C SBA formula in The Sheet Hitters.xlsx references K3/L3 (FRM coefficients) instead of K5/L5 (SBA coefficients). This is replicated in `src/hitters.py`. See `internal/archive/KNOWN_BUGS.md`.

#### Section 8: Fielding Rating Averages (P–Q, rows 2–43)

League-average values for all fielding ratings, used to center the regression polynomials. These are stored in column P (primary) and Q (secondary) of the Data Points sheet. See the table in Section 7 above for exact values per position.

#### Section 9: Fielding Stats Per Season (S–T, rows 2–30)

Expected fielding stat counts for an average fielder per 1200 IP (or per 1000 PA for catchers):

| Row | Stat | Value |
|-----|------|-------|
| T2 | C FRM/1000 | 1.819 |
| T3 | C SBA/1000 | 104.34 |
| T4 | C RTO% | 0.2091 |
| T5 | 1B PA/1200 | 277.48 |
| T6 | 1B PM% | 0.8488 |
| T7 | 1B E% | 0.03078 |
| T8 | 2B PA/1200 | 570.06 |
| T9 | 2B PM% | 0.6485 |
| T10 | 2B E% | 0.02113 |
| T11 | 2B DP/1200 | 88.02 |
| T12 | 3B PA/1200 | 352.80 |
| T13 | 3B PM% | 0.8202 |
| T14 | 3B E% | 0.04686 |
| T15 | SS PA/1200 | 609.23 |
| T16 | SS PM% | 0.6878 |
| T17 | SS E% | 0.04073 |
| T18 | LF PA/1200 | 401.21 |
| T19 | LF PM% | 0.5841 |
| T20 | LF E% | 0.01010 |
| T21 | LF ARM | -0.4941 |
| T22 | CF PA/1200 | 568.92 |
| T23 | CF PM% | 0.6450 |
| T24 | CF E% | 0.00822 |
| T25 | CF ARM | -0.1981 |
| T26 | RF PA/1200 | 434.15 |
| T27 | RF PM% | 0.5793 |
| T28 | RF E% | 0.01200 |
| T29 | RF ARM | 3.496 |
| T30 | SS DP/1200 | 77.27 |

#### Section 10: Position Adjustment Values (V–W, rows 2–10)

WAA adjustment for playing a harder/easier defensive position:

| Row | Position | Adj (runs/season) |
|-----|----------|------------------|
| W2 | C | +12.84 |
| W3 | 1B | -8.12 |
| W4 | 2B | +5.65 |
| W5 | 3B | +1.08 |
| W6 | SS | +11.97 |
| W7 | LF | -7.16 |
| W8 | CF | -4.41 |
| W9 | RF | -7.16 |
| W10 | DH | -8.34 |

---

### Data Points — Pitchers Workbook

**Dimensions:** ~43 rows × ~13 columns (B through M)

The Pitchers Data Points uses **pitcher ratings** (STU, HRR, PBABIP, CON) instead of hitter ratings.

#### Section 1: Pitcher Rating Coefficients (B–E, rows 2–11 SP, rows 12–20 RP)

Separate coefficient sets for **Starters** and **Relievers**, for each rating pair (h = above average, l = below average):
- hCON / lCON — Control rating
- hHRR / lHRR — HR rate rating
- hSTU / lSTU — Stuff rating
- hBABIP / lBABIP — BABIP control rating

#### Section 2: Pitcher Rating Averages (G–I, rows 2–20)

League-average ratings by role (SP/RP):
- STU, HRR, pBABIP, CON average values

#### Section 3: Pitcher Stat Pipeline (J–M, rows 2–24)

Computes expected per-BF stat counts from ratings:
- SP columns (J–L, rows 2–12): For starters at BF=800
- RP columns (J–L, rows 14–24): For relievers at BF=300

Stats computed: BB%, HR%, SO%, BABIP, XBH%, 3B%, SB%, HBP%, with counts in adjacent columns.

#### Section 4: League Measurements (H, rows 28–42)

| Row | Stat | Value |
|-----|------|-------|
| H29 | lgwOBA | 0.3234 |
| H30 | WAA Constant | 10.07 |
| H31 | BF SP | 800 |
| H32 | BF RP | 300 |
| H33 | IP SP | 185.5 |
| H34 | IP RP | 69.6 |
| H41 | RA/9 SP (league) | 4.76 |
| H42 | RA/9 RP (league) | 4.64 |

---

## Sheet: `Hitters`

**Dimensions:** 8,451 rows × 247 columns (A through HS)

### Row Structure
- **Row 1:** Column headers
- **Rows 2–8451:** One row per player slot (most slots empty; formulas return "" for empty rows)
- **Column A:** `Sheet ID` — sequential integer (1, 2, 3...) used to JOIN with `Player List`

### Column Group Overview

| Columns | Group | Description |
|---------|-------|-------------|
| A | Sheet ID | Sequential join key |
| B–T | Player Meta | ORG, Lev, MLY, LEA, LOY, AD, WE, INT, ON40, Prone, WAIV, R5, Price, SLR Sort, Manual, INJ, HT Sort, WT |
| U | Eligible | Boolean filter flag (multi-condition) |
| V–Z | Basic Info | Name, Age, B (bats), T (throws), POS |
| AA–AD | Rankings | Rank, Rank vR, Rank vL, Rank P |
| AE–AI | Ratings vL | BA vL, GAP vL, POW vL, EYE vL, K vL |
| AJ–AN | Ratings vR | BA vR, GAP vR, POW vR, EYE vR, K vR |
| AO–AS | Prospect Ratings | HT P, GAP P, POW P, EYE P, K P |
| AT–AZ | Running Ratings | SPE, SR, STE, RUN, BUN, BFH |
| BA–BB | Catcher Ratings | C ABI, C FRM, C ARM |
| BC–BI | Fielding Ratings | IF RNG, IF ERR, IF ARM, TDP, OF RNG, OF ERR, OF ARM |
| BJ–BQ | Position Eligibility | C, 1B, 2B, 3B, SS, LF, CF, RF (TRUE/FALSE) |
| BR–CC | Batting Stats vR | HBP, uBB, HR, SO, H-HR, XBH-HR, 3B, 2B, 1B, OBP, wOBA, BatR |
| CD–CO | Batting Stats vL | (same structure) |
| CP–CR | Weighted Batting | OBP wtd, wOBA wtd, BatR wtd |
| CS–CX | DH Stats | DH wOBA vR/vL/wtd, DH BatR vR/vL/wtd |
| CY | SB% | Stolen base success rate |
| CZ–DE | Stolen Base Stats | SBAT vR, SB vR, CS vR, SBAT vL, SB vL, CS vL |
| DF–DH | Weighted Stolen Base | wSB vR, wSB vL, wSB wtd |
| DI–DK | UBR | UBR vR, UBR vL, UBR wtd |
| DL–DN | BSR | BSR vR, BSR vL, BSR wtd (baserunning total) |
| DO–DV | Catcher Defense | C FRMAA, C PMAA, C SBA, C RTO%, C SB, C CS, C ArmR, C RunsP |
| DW–DY | 1B Defense | 1B PMAA, 1B EAA, 1B RunsP |
| DZ–EC | 2B Defense | 2B PMAA, 2B EAA, 2B DPAA, 2B RunsP |
| ED–EF | 3B Defense | 3B PMAA, 3B EAA, 3B RunsP |
| EG–EJ | SS Defense | SS PMAA, SS EAA, SS DPAA, SS RunsP |
| EK–EN | LF Defense | LF PMAA, LF EAA, LF ARMAA, LF RunsP |
| EO–ER | CF Defense | CF PMAA, CF EAA, CF ARMAA, CF RunsP |
| ES–EV | RF Defense | RF PMAA, RF EAA, RF ARMAA, RF RunsP |
| EW–GT | WAA by Position | C/1B/2B/3B/SS/LF/CF/RF/DH — each vR, vL, wtd |
| FX–FZ | Max WAA | Max WAA vR, vL, wtd (best position) |
| GA–HD | Prospect Stats | Batting + WAA by position for prospect scenario (skipped — React frontend) |
| HE–HS | Filter Flags | 15 filter boolean columns |

### Key Formula Patterns

#### 1. Player Data Lookup (from Player List)
```
B2 = INDEX(Players[#All], MATCH([Sheet ID], Players[[#All],[Sheet ID]], 0), MATCH(B$1, Players[#Headers], 0))
```
Used for most player info columns. Variant with ID guard:
```
C2 = IF([ID]=0, "", INDEX(Players[#All], MATCH([Sheet ID], Players[[#All],[Sheet ID]], 0), MATCH(C$1, Players[#Headers], 0)))
```

#### 2. Batting Stats vR — H-HR (contact hits) (column BV)
```
BV2 = IFERROR(MAX(
  IF([BA vR] >= 50,
    (([BA vR] - DP.H5) * DP.C9 + DP.B9 + DP.C36) *
    (DP.H31 - [HBP vR] - [uBB vR] - [HR vR] - [SO vR]) + Ballparks.AH37,
    (([BA vR] - DP.H5) * DP.E9 + DP.D9 + DP.C36) *
    (DP.H31 - [HBP vR] - [uBB vR] - [HR vR] - [SO vR]) *
    IF(Filters.C3="", 1, SWITCH([B], "R", Filters.C8, "L", Filters.D8, "S", ...))
  ), 0), "")
```
- Uses high model (C9/B9) when BA vR ≥ 50, low model (E9/D9) when < 50
- Applies park factor delta (`Ballparks!$AH$37`) for the home park H-HR adjustment
- When no filter applied, uses full count; when filtered (by handedness matchup), applies a platoon multiplier

#### 3. Weighted Split Stats (OBP wtd, wOBA wtd, etc.)
```
CP2 = IFERROR(SWITCH([B],
  "R", [OBP vL]*(1-DP.H24) + [OBP vR]*DP.H24,
  "L", [OBP vL]*(1-DP.H23) + [OBP vR]*DP.H23,
  "S", [OBP vL]*(1-DP.H25) + [OBP vR]*DP.H25
), 0)
```
Uses matchup weights from Data Points H23/H24/H25.

#### 4. Stolen Base Stats (cubic polynomial, array formula)
```
CY2 = IFERROR(IF(NOT([Eligible]), "", MAX(
  (SUMPRODUCT((MIN([STE],80) - DP.H8)^{0,1,2,3}, DP.B17:E17) + DP.C39), 0
)), "")
```
- Uses `STE` (steal rating), capped at 80
- `DP.B17:E17` = cubic polynomial coefficients for SB%
- `DP.C39` = league SB% rate

#### 5. Baserunning Stats (Phase 4 — Implemented)

**SB% (CY):** Single value per player (not split by hand).
```
SB% = MAX(SUMPRODUCT((MIN(STE, 80) - DP.H8)^{0,1,2,3}, DP.B17:E17) + DP.C39, 0)
```
STE capped at 80 (Bug 2 in KNOWN_BUGS.md).

**SBAT (CZ/DC — per split):** Stolen base attempts, based on reaching-base events.
```
sba_rate = SUMPRODUCT((STE - DP.H8)^{0,1,2,3}, DP.B15:E15) + DP.C41
SBAT = MAX(sba_rate * (1B + uBB + HBP), 0)
```
Note: uses `1B + uBB + HBP` (times on first base), NOT `sba_rate * PA`.

**SB / CS (per split):**
```
SB = SBAT * SB%
CS = SBAT * (1 - SB%)
```

**wSB (DF/DG/DH — per split, then weighted):**
```
wSB = 0.2 * SB + run_cs * CS
```
SB weight is hardcoded **0.2** (not wt_sb=0.2375 from H18). CS weight = run_cs = -0.422 (H35).

**UBR (DI/DJ/DK — per split, then weighted):**
```
ubr_rate = SUMPRODUCT((RUN - DP.H9)^{0,1,2,3}, DP.B19:E19) + DP.C40
base_opp = (1B + uBB + HBP) * 3 + 2B * 2 + 3B - sb_adj
sb_adj = IF(wSB_vL > 0, SBAT, 0)
UBR = ubr_rate * base_opp
```
Known quirk: `sb_adj` uses `wSB_vL` for the IF condition in **both** vR and vL splits (Bug 4 in KNOWN_BUGS.md).

**BSR (DL/DM/DN — per split, then weighted):**
```
BSR = wSB + UBR
```

#### 6. Rankings (COUNTIFS)
```
AA2 = IF(NOT([Eligible]), "", COUNTIFS(Hitters[wOBA wtd], ">" & [wOBA wtd], Hitters[Eligible], TRUE) + 1)
```

#### 7. Fielding Formulas (DO–EV)

All fielding formulas are gated by eligibility: `IF(NOT([{Pos} Eligible]), "", ...)`.

**Catcher Defense (DO–DV):**
```
C FRMAA (DO) = SUMPRODUCT((C_FRM - DP.P3)^{0,1}, DP.K3:L3) * DP.H34
             = (K3 + L3 * (C_FRM - avg_frm)) * 1000

C SBA (DQ)   = ((C_ARM - DP.P5) * DP.L3 + DP.K3) * DP.H34 + DP.T3
             ⚠ Bug 5: uses L3/K3 (FRM coefficients) instead of L5/K5 (SBA coefficients)

C RTO% (DR)  = MAX(0, SUMPRODUCT((C_ARM - DP.P5)^{0,1}, DP.K7:L7) + DP.T4)
             = max(0, K7 + L7 * (C_ARM - avg_arm) + lg_rto)

C CS (DT)    = C_RTO% * C_SBA
C SB (DS)    = C_SBA - C_CS

C ArmR (DU)  = (C_CS * -(0.2 + H35)) - (T3 * T4 * -(0.2 + H35))
             = arm_weight * (C_CS - lg_sba * lg_rto)   where arm_weight = -(0.2 + run_cs)

C PMAA (DP)  = 0  (placeholder column, no formula — always empty)
C RunsP (DV) = C_ArmR + C_FRMAA + C_PMAA  (effectively = C_ArmR + C_FRMAA)
```

**1B Defense (DW–DY):**
```
1B PMAA (DW) = ((IF_RNG - P9) * L9 + (HT_Sort - Q9) * M9 + K9) * T5
             ⚠ Unique: uses both range AND height as predictors

1B EAA (DX)  = ((IF_ERR - P11) * L11 + K11) * H33
             = error_regression * 1200  (uses IP, not PA)

1B RunsP (DY) = (1B_PMAA - 1B_EAA) * H38  (inf_out = 0.75)
```

**2B Defense (DZ–EC):**
```
2B PMAA (DZ) = ((IF_RNG - P13) * L13 + (IF_ARM - Q13) * M13 + K13) * T8
             Uses range + arm as two predictors

2B EAA (EA)  = ((IF_ERR - P15) * L15 + K15) * (2B_PMAA + T8 * T9)
             ⚠ Multiplicative: error rate × (PMAA + scale × league_PM%)

2B DPAA (EB) = ((TDP - P17) * L17 + K17) * H33

2B RunsP (EC) = (2B_PMAA - 2B_EAA + 2B_DPAA) * H38
```

**3B Defense (ED–EF):**
```
3B PMAA (ED) = ((IF_RNG - P19) * L19 + (IF_ARM - Q19) * M19 + K19) * T12
3B EAA (EE)  = ((IF_ERR - P21) * L21 + K21) * (3B_PMAA + T12 * T13)
3B RunsP (EF) = (3B_PMAA - 3B_EAA) * H38
```

**SS Defense (EG–EJ):**
```
SS PMAA (EG) = ((IF_RNG - P23) * L23 + (IF_ARM - Q23) * M23 + K23) * T15
SS EAA (EH)  = ((IF_ERR - P25) * L25 + K25) * (SS_PMAA + T15 * T16)
SS DPAA (EI) = ((TDP - Q25) * L45 + K45) * H33
             ⚠ Uses K45/L45 (separate SS DP coefficients), not K17/L17 (2B DP)
SS RunsP (EJ) = (SS_PMAA - SS_EAA + SS_DPAA) * H38
```

**Outfield Defense (LF: EK–EN, CF: EO–ER, RF: ES–EV):**
```
{OF} PMAA    = ((OF_RNG - P_avg) * L_slope + K_const) * T_pa
{OF} EAA     = ((OF_ERR - P_avg) * L_slope + K_const) * ({OF}_PMAA + T_pa * T_pm)
{OF} ARMAA   = ((OF_ARM - P_avg) * L_slope + K_const) * T_pa
{OF} RunsP   = ({OF}_PMAA - {OF}_EAA) * H39 + {OF}_ARMAA
             ⚠ Outfield uses of_out (0.9), not inf_out (0.75)
             ⚠ ARMAA is added directly, not multiplied by of_out
```

**Key scaling constants:**
- `H33` = 1200 (IP for full-season fielding)
- `H34` = 1000 (IP for catchers)
- `H38` = 0.75 (infield out conversion rate)
- `H39` = 0.9 (outfield out conversion rate)

#### 8. WAA Calculation (EW–GT)
```
{Pos} WAA vR = ({Pos}_RunsP + BSR_vR + BatR_vR + PosAdj) / DP.H30
{Pos} WAA vL = ({Pos}_RunsP + BSR_vL + BatR_vL + PosAdj) / DP.H30
{Pos} WAA wtd = handedness-weighted average of vR and vL
```
Where `DP.H30` = 10.073 (runs per win, the WAA constant).

**Special cases:**
- **Catcher WAA:** Recalculates batting for PA=500 (DP.H32) instead of 600, plus uses `Ballparks!AB37` for park batting runs adjustment
- **DH WAA:** Uses `DH_BatR` (park-neutral) instead of regular `BatR`, and `BSR * 0.98`

**Max WAA (FX–FZ):** `MAX(C_WAA, 1B_WAA, ..., RF_WAA, DH_WAA)` across all eligible positions.

### Filter Flags (HE–HS)

| Col | Filter | Formula |
|-----|--------|---------|
| HE | Filter Age | `=IF(Filters!$G$8<>"", IF(Age<=Filters!$G$8, TRUE, FALSE), TRUE)` |
| HF | Filter Team 1 | Team inclusion filter |
| HG | Filter Team 2 | Secondary team filter |
| HH | Filter Waivers | `=IF(WAIV="Yes", TRUE, FALSE)` |
| HI | Filter Free Agent | `=IF(ORG="-", TRUE, FALSE)` |
| HJ | Filter Trained at C | Catcher training eligibility |
| HK | Filter MILB | `=IF(Filters!$A$73, IF(Lev<>"MLB", TRUE, FALSE), TRUE)` |
| HL | Filter On Sec | 40-man roster filter |
| HM | Filter R5 | Rule 5 eligibility |
| HN | Filter Draft | Draft eligible filter |
| HO | Filter Drafted | `=IF(COUNTIF(Drafted!$A:$A, "*"&Name&"*")>0, TRUE, FALSE)` |
| HP | Filter Prospect | Prospect filter |
| HQ | Filter Demand | `=IF(Filters!$A$80, IF(Price<=Filters!$AA$8, TRUE, FALSE), TRUE)` |
| HR | Filter Injured | `=IF(INJ="Yes", TRUE, FALSE)` |
| HS | Filter Block | Trade block filter |

The **Eligible** column (U) is a compound AND of all relevant filter flags.

---

## Sheet: `Pitchers`

> **Implementation blueprint:** See [`docs/PITCHERS_PIPELINE.md`](PITCHERS_PIPELINE.md) for the full phased implementation plan for `src/pitchers.py`.

**Dimensions:** 8,000 rows × 172 columns (A through FP)

### Column Group Overview

| Columns | Group | Description |
|---------|-------|-------------|
| A | Sheet ID | Sequential join key |
| B–S | Player Meta | ID, ORG, Lev, LEA, LOY, AD, WE, INT, ON40, Type, WAIV, R5, Price, DEM Sort, Manual, INJ, HT Sort, Prone |
| T | Eligible | Multi-condition filter flag |
| U–Y | Basic Info | Name, Age, B, T, POS |
| Z–AF | Rankings | Rank (SP wtd/vR/vL), Rank P, Rank RP (wtd/vR/vL/P) |
| AG–AS | Pitcher Ratings | STU P/vR/vL, HRR P/vR/vL, PBABIP P/vR/vL, CON P/vR/vL |
| AT–AW | Stamina/Stuff | STM, HLD, Pitches, SP Pitch |
| AX–AY | Starter Flags | Starter (current), SP P Pitch |
| AZ | Starter P | Prospect starter flag |
| BA–BP | SP Stats vR | HBP, uBB, SO, HR, H-HR, XBH-HR, 3B, 2B, 1B, SBAT, SB%, SB, CS, wOBA, RA/9, WAA |
| BQ–CF | SP Stats vL | Same structure |
| CG–CI | SP Weighted | wOBA wtd, RA/9 wtd, WAA wtd (SP) |
| CK–CZ | RP Stats vR | Same structure as SP but for relief role |
| DA–DS | RP Stats vL | Same structure |
| DU–EJ | Prospect SP Stats | P versions of SP stats |
| EL–FA | Prospect RP Stats | P versions of RP stats |
| FC–FP | Filter Flags | 15 filter boolean columns (same structure as Hitters) |

### Key Formula Patterns

#### 1. Player Rating Extraction
```
AH2 = IF([ID]=0, "", VALUE(SUBSTITUTE(INDEX(Players[#All], MATCH([Sheet ID], Players[[#All],[Sheet ID]], 0), MATCH(AH$1, Players[#Headers], 0)))))
```
Uses `VALUE(SUBSTITUTE(...))` because pitcher ratings may be stored as text in the Player List.

#### 2. Starter Determination
```
AX2 = IF(AND(OR(SP_P_Pitch>=3, OR(AND(SP_P_Pitch>=2, Pitches>=3), ...)), ...), TRUE, FALSE)
```
Complex logic considering number of pitches above thresholds.

#### 3. SP Batting Stats vs RHP (BN = wOBA vR)
```
BN2 = IF(NOT(AND([Starter],[Eligible])), "",
  (wt_HBP*HBP_vR + wt_BB*uBB_vR + wt_1B*1B_vR + wt_2B*2B_vR + wt_3B*3B_vR + wt_HR*HR_vR) / DP.H31
)
```

#### 4. SP RA/9 and WAA
```
BO2 (RA/9 vR) = IF(NOT(AND([Starter],[Eligible])), "",
  (wOBA_vR / DP.H29)^2 * DP.H41 * DP.H31 / DP.H33 * 9
)

BP2 (WAA vR) = IF(NOT(AND([Starter],[Eligible])), "",
  (DP.H41 - RA/9_vR) * (DP.H33/9) / DP.H30
)
```

#### 5. Rankings (COUNTIFS — SP)
```
Z2 = IF(NOT(AND([Starter],[Eligible])), "",
  COUNTIFS(Pitchers[WAA wtd], ">"&[WAA wtd], Pitchers[Starter], TRUE, Pitchers[Eligible], TRUE) + 1
)
```

---

## Implementation Notes for Python

### Input Data
1. **Player List** → Load from CSV exports in `data/players/` via `src/players.py`. Multiple files merged.
2. **Data Points** → Store as a Python dict/constants module (hardcoded from sheet, updatable per league).
3. **Ballparks** → `data/ballparks.csv` with columns: Team Name, Park, PF AVG, AVG L, AVG R, PF HR, HR L, HR R, PF D, PF T, PF

### Processing Pipeline

```python
# Pseudo-code
data_points = load_data_points("hitters_data_points.json")
ballparks = load_ballparks("ballparks.csv")  # shared between hitters/pitchers
players = load_player_list("player_list.csv")

# 1. Compute park deltas (Ballparks sheet rows AC-BO per team, plus rows 35-40)
park_deltas = compute_park_factors(ballparks, data_points, selected_team, home_fraction)

# 2. For each player, compute all stats
for player in players:
    # Batting stats vR and vL using rating regressions
    batting_vR = compute_batting(player, "vR", data_points, park_deltas)
    batting_vL = compute_batting(player, "vL", data_points, park_deltas)
    # Weighted stats by handedness
    batting_wtd = weight_by_handedness(batting_vR, batting_vL, player["B"], data_points)
    # Running stats
    running = compute_running(player, data_points)
    # Fielding by position
    fielding = compute_fielding(player, data_points)
    # WAA by position
    waa = compute_waa(batting_wtd, running, fielding, data_points)
```

### Ballparks Module — Implemented (`src/ballparks.py`)

**Status:** Complete. 81/81 tests passing (`tests/test_ballparks.py`).

**Key classes:**
- `BallparkConstants` — all Data Points values used by Ballparks (frozen dataclass)
- `BallparksTable.from_csv(path)` — loads any CSV, derives team count/names dynamically
- `BallparksTable.compute_park_deltas(team, home_fraction)` → `ParkDeltas`
- `ParkDeltas` — the per-stat delta struct consumed by hitters.py / pitchers.py

**Implementation notes:**
- Two-pass bootstrap: compute neutral-park stats (all adj=1.0) first → use as baseline for adj_* fields
- `adj_woba = woba - lg_computed_woba` (relative to row 33, not the constant H29)
- `park_woba = adj_woba + H29` (re-anchored to the constant; ≠ woba when row 33 ≈ 0.32253 vs H29 = 0.32263)
- The spreadsheet bug (AH40/AG40/AI40 using RH row instead of LH) is replicated with a comment

**Extracted test values used for verification:**

| Stat | Arizona (row 4) | League Avg (row 33) |
|------|----------------|---------------------|
| HR vR (AE) | 17.850 | 18.585 |
| H-HR vR (AH) | 118.930 | 117.964 |
| XBH-HR vR (AG) | 33.732 | 31.133 |
| 3B vR (AI) | 5.038 | 2.791 |
| wOBA vR (AM) | 0.32426 | 0.32253 |
| wOBA ratio (BM) | 1.0147 | ~1.000 |
| wRAA (BN) | 2.4012 | ~0.000 |
| Adj (BO) | −1.3277 | ~0.000 |

### Data Points Module — Implemented (`src/data_points.py`)

**Status:** Complete. 50/50 tests passing (`tests/test_data_points.py`).

**Sources:**
- `25 Regressions.xlsx` → regression coefficients (extracted via `openpyxl`, `data_only=True`)
- `25 Metadata.xlsx` → league averages, wOBA weights, splits, rates, position adjustments

**Key types:**

| Class | Description |
|-------|-------------|
| `LinearCoeffs` | 2-segment piecewise-linear: `h_const + h_slope*(r-avg)` if r≥50, else `l_const + l_slope*(r-avg)` |
| `CubicCoeffs` | Polynomial `c0 + c1*(r-avg) + c2*(r-avg)² + c3*(r-avg)³`; c2=c3=0 for all OOTP 26 stats |
| `HittingRegressionCoeffs` | `LinearCoeffs` for EYE/POW/K/BABIP/GAP/SPD; `CubicCoeffs` for SBA/SB%/UBR |
| `FieldingRegressionCoeffs` | Flat float attrs for all fielding regressions: PM%, Error, DP, ARM, C FRM/SBA/RTO |
| `PitchingRegressionCoeffs` | `LinearCoeffs` for SP/RP CON/HRR/STU/BABIP; `CubicCoeffs` for SB%/SBA |
| `HitterLeagueParams` | Rating avgs, wOBA weights, matchup splits, league measurements, hitting rates |
| `FieldingParams` | Position adjustments, all rating averages (full precision), scaling constants (column T) |
| `PitcherLeagueParams` | SP/RP rating avgs, pitcher matchup splits, RA/9 baselines, BF/IP season totals |
| `HitterDataPoints` | Container: `hitting`, `fielding_coeffs`, `league`, `fielding` |
| `PitcherDataPoints` | Container: `pitching`, `fielding_coeffs`, `league`, `hitting_rates`, `fielding` |

**Module-level singletons:**
```python
DEFAULT_HITTER_DP: HitterDataPoints   # OOTP 26 defaults
DEFAULT_PITCHER_DP: PitcherDataPoints
```

**Bridge method:**
```python
HitterLeagueParams.to_ballpark_constants() -> BallparkConstants
```
Maps the 21 fields shared between `HitterLeagueParams` and `BallparkConstants`. The defaults in
`HitterLeagueParams` use the same rounded values as `DEFAULT_CONSTANTS` in `ballparks.py`, so
`DEFAULT_HITTER_DP.league.to_ballpark_constants() == DEFAULT_CONSTANTS` (exact equality).

**Implementation notes:**
- All regression coefficient defaults are stored at full float64 precision (15–17 sig figs), as read
  from the xlsx file. Inline comments note the full-precision Metadata values where rounding was applied.
- `FieldingRegressionCoeffs` stores ALL fielding regression coefficients as flat float attrs:
  PM%, Error, DP, ARM, and catcher-specific (FRM, SBA, RTO). Multi-variable regressions
  (1B range+height, 2B/3B/SS range+arm) have separate slope fields.
- `FieldingParams` stores all rating averages at full precision plus scaling constants from column T.
- `bpk_woba = 0.32576` (H41) is sourced from the main workbook's Data Points sheet, not Metadata.xlsx.
- `c2 = c3 = 0` for all CubicCoeffs — confirmed via openpyxl extraction of `25 Regressions.xlsx`.

### Config — Removed (was `src/config.py`)

**Status:** Deleted. Superseded by `src/settings.py` `PipelineSettings` dataclass which provides the same defaults (`team="Nashville Stars"`, `home_fraction=0.5`, `scout_weight=0.8`, `osa_weight=0.2`) plus interactive configuration and JSON persistence.

### Export Module (`src/export.py`)

**Purpose:** Pipeline orchestration and JSON export for the React dashboard.

**Key details:**
- `_v()` rounds floats to 4 decimal places (sufficient for baseball stats like .3210 OBP, 1.234 WAA)
- `_strip_none()` recursively removes None-valued keys from output dicts to reduce JSON size
- Output JSON is gzipped by `main.py`

### Players Module — Implemented (`src/players.py`)

**Status:** Complete. Includes OSA rating blending.

**Purpose:** Load and merge all OOTP CSV exports from `data/players/` into a single DataFrame, with column disambiguation, source tagging, pitcher detection, two-way player detection, and optional OSA rating blending.

**Key function:**
```python
load_players(
    directory, *, source_tags=True, osa_blend=False,
    scout_weight=0.8, osa_weight=0.2
) -> pd.DataFrame
```

**Features:**
- Discovers files by name pattern (organization, freeagents, iafa, draft*)
- Disambiguates 3 duplicate column names: `INJ`→`INJ/INJ2`, `CON`→`CON/PCON` (+ vL/vR/P splits), `DEM`→`DEM/DEM2`
- Tags each row with source file origin (`'Organization'`, `'Free Agent'`, `'IAFA'`, `'Draft XXXX'`)
- Detects pitchers by POS ∈ {SP, RP, CL}
- Detects two-way players: ≥3/5 hitter ratings > 20 AND ≥2/3 pitcher ratings > 20
- **OSA blending**: when `osa_blend=True`, pairs scout CSVs with `_osa.csv` files and blends rating columns using `scout_weight * scout + osa_weight * osa`. Metadata columns preserved from scout file. Players without OSA match keep scout values.
- Returns merged DataFrame: 184 raw columns + 3 added (source, is_pitcher, is_two_way) = 187 total

**Data notes:**
- Total ~10,447 rows across 6 CSV files
- Column 111 (HLD) and PCON have mixed types (some `'-'` values) — uses `low_memory=False`
- No deduplication across files; players in multiple sources kept as-is

### Hitters Module — Implemented (`src/hitters.py`)

**Status:** Complete (batting + baserunning + eligibility + fielding + WAA). All 6 spreadsheet bugs fixed.

**Purpose:** Convert player ratings into batting stats, baserunning stats, position eligibility, and fielding stats. Phases 2–6 of the hitter pipeline.

**Key functions:**
```python
compute_hitter_batting(players, park_deltas, park_adj, home_fraction, dp) -> DataFrame
    # 49 columns: 12 vR + 12 vL + 3 weighted + 6 DH + 16 baserunning

compute_position_eligibility(players, dp) -> DataFrame
    # 9 boolean columns: C/1B/2B/3B/SS/LF/CF/RF/DH Elig

refine_two_way(players, eligibility) -> Series
    # Refined two-way flag using position eligibility

compute_fielding(players, eligibility, dp) -> DataFrame
    # 30 columns: 7 C + 3 1B + 4 2B + 3 3B + 4 SS + 4 LF + 4 CF + 4 RF
```

**Architecture:**
- Piecewise linear rating regressions (split at 50 for batting; single-segment for fielding)
- Dual park factor model: additive (high model ≥50) vs multiplicative (low model <50)
- Handedness weighting: vL/vR → weighted by batter hand (R=0.720, L=0.776, S=0.741)
- Fielding: multi-variable regressions (1B uses range+height, 2B/3B/SS use range+arm)
- Multiplicative error formula for 2B/3B/SS/OF: `err_rate × (PMAA + scale × league_PM%)`
- All computations vectorized via pandas/numpy on the full player DataFrame

### Testing Strategy

Smoke tests validate the full pipeline runs without exceptions, bug fix tests verify each corrected bug, and config/OSA tests verify the new modules.

---

## Known Bugs — All Fixed

All 6 spreadsheet bugs discovered during Phase 1 reverse engineering have been **fixed** in the Python implementation. See `internal/archive/KNOWN_BUGS.md` for full details.

Summary:
1. **Bug 1** (Ballparks LH deltas): Fixed vR→vL references in `compute_park_deltas()`
2. **Bug 2** (STE cap): Removed `ste.clip(upper=80)` for SB%
3. **Bug 3** (DH docs): Clarified comments — DH stats use park-adjusted counting stats
4. **Bug 4** (UBR wSB): Each split now uses its own wSB for sb_adj condition
5. **Bug 5** (C SBA coefficients): Changed to `c_sba_const`/`c_sba_slope`
6. **Bug 6** (RP vL park factors): Removed `is_rp` parameter, vL always uses LH factors

---

## Open Questions / To Verify

1. ~~Position eligibility flags BJ–BQ~~ — **RESOLVED**: Extracted all 8 position rules (C FRM≥45, 1B HT>179 & IF RNG>20, 2B IF RNG≥50 & R & TDP≥45, 3B IF RNG≥40 & IF ARM≥50 & R, SS IF RNG≥60 & IF ARM≥50 & R, LF OF RNG≥50, CF OF RNG≥60, RF OF RNG≥50, DH always). Implemented in `hitters.compute_position_eligibility()`.
2. Full formula for the `Eligible` column (U) — complex multi-condition, not fully captured
3. ~~Full DH logic~~ — **RESOLVED**: DH stats use zero park deltas and multiplicative factor = 1.0 (park-neutral by design)
4. `Filter Trained at C` (HJ) — exact condition for catcher training eligibility
5. Array formula for SB% (CY) — confirm cap at 80 is correct
6. ~~Full cubic polynomial coefficients for SBA/SB%/UBR~~ — **RESOLVED**: c2=c3=0 for all cubic stats (confirmed via openpyxl extraction of `25 Regressions.xlsx`). Cells D/E are reserved but blank.
7. ~~Catcher defensive stat formulas (DP–DV) beyond FRMAA and ArmR~~ — **RESOLVED**: All 8 catcher stats extracted and implemented. C PMAA is always 0 (placeholder). C SBA uses FRM coefficients (Bug 5). See Section 7 of Hitters formula patterns above.
8. ~~WAA formula details for all positions~~ — **RESOLVED**: WAA fully implemented in Phase 7. Standard positions use `(RunsP + BSR + BatR + PosAdj) / waa_const`. Catcher recalculates BatR at PA=500 + park adj scaling. DH uses BSR*0.98 + park-neutral BatR. See `compute_waa()` in `src/hitters.py`.
