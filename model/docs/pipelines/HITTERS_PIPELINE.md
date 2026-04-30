# Hitters Pipeline — Architectural Blueprint

## Overview

This document defines the architecture for implementing the OOTP hitter evaluation pipeline in Python. It serves as the blueprint for `players.py` (shared ingestion) and `hitters.py` (hitter-specific computation).

**Existing modules (complete, all bugs fixed):**
- `src/ballparks.py` — park factor computation (Bug 1 fixed)
- `src/data_points.py` — model constants and regression coefficients
- `src/players.py` — CSV ingestion, merging, source tagging, two-way detection, OSA blending
- `src/config.py` — global configuration constants

---

## Data Structures & Ingestion Strategy

### Pandas DataFrames for the Player Pipeline

The player pipeline uses **Pandas DataFrames** for all tabular data:
- Vectorized operations on 8000+ rows, 250+ columns
- Natural CSV I/O (read/write)
- Column-based computation maps cleanly to the spreadsheet's column-oriented formulas

### Integration with Existing Modules

`ballparks.py` and `data_points.py` remain dataclass-based. They produce scalar/singleton outputs consumed by the DataFrame pipeline:
- `ParkDeltas` (from `ballparks.py`) → per-stat delta values applied across all player rows
- `HitterDataPoints` / `DEFAULT_HITTER_DP` (from `data_points.py`) → regression coefficients, league params, wOBA weights

All raw CSV columns are retained in the DataFrame; computed columns are appended alongside.

---

## Module Organization

```
data/
  ballparks.csv          # park factor data (28 teams)
  players/               # OOTP CSV exports
    organization.csv     # players in any team's organization
    freeagents.csv       # free agents
    iafa.csv             # international amateur free agents
    draft2042.csv        # draft class files
    draft2043.csv
    draft2044.csv

src/
  ballparks.py       # COMPLETE — park factor computation
  data_points.py     # COMPLETE — model constants, regression coefficients
  players.py         # COMPLETE — shared CSV ingestion, merging, tagging, two-way detection
  hitters.py         # NEW — hitter stat computation pipeline
  pitchers.py        # FUTURE — pitcher stat computation pipeline
```

---

## CSV Ingestion (`players.py`) — COMPLETE

**Status:** Implemented. 29/29 tests passing (`tests/test_players.py`).

### Input Files

Load from `data/players/` directory containing OOTP CSV exports:
- `organization.csv` — players in any team's organization (~7,926 rows)
- `freeagents.csv` — free agents (~784 rows)
- `iafa.csv` — international amateur free agents (~90 rows)
- `draftXXXX.csv` — draft class files (~1,647 rows total across 3 files)

Total: ~10,447 rows × 184 raw columns per file.

### Column Disambiguation

The OOTP CSV has 3 duplicate column names. Pandas auto-appends `.1` suffixes; `players.py` renames them for clarity:

| Pandas auto-name | Renamed to | Description |
|-------------------|-----------|-------------|
| `INJ.1` | `INJ2` | Injury detail |
| `CON.1` | `PCON` | Pitcher control (overall) |
| `CON vL.1` | `PCON vL` | Pitcher control vs LHB |
| `CON vR.1` | `PCON vR` | Pitcher control vs RHB |
| `CON P.1` | `PCON P` | Pitcher control (prospect) |
| `DEM.1` | `DEM2` | Demand detail |

### Public API

```python
def load_players(
    directory: Path | str,
    *,
    source_tags: bool = True,
) -> pd.DataFrame:
```

Returns a merged DataFrame with 184 raw columns + 3 added columns = 187 total:
- `source` — origin file tag (e.g., `'Organization'`, `'Free Agent'`, `'Draft 2042'`)
- `is_pitcher` — `True` if POS ∈ {SP, RP, CL}
- `is_two_way` — `True` if player has real ratings in both hitter and pitcher domains

### Source Tagging

| Filename pattern | Source tag |
|-----------------|-----------|
| `organization.csv` | `'Organization'` |
| `freeagents.csv` | `'Free Agent'` |
| `iafa.csv` | `'IAFA'` |
| `draftXXXX.csv` | `'Draft XXXX'` |

### Two-Way Player Detection

Uses **potential ratings** with strict thresholds:

- **Hitter side** (CON P, POW P, EYE P — the "big 3"):
  - (3/3 ≥ 40) OR (2/3 ≥ 50)
  - Position eligibility gate applied via `hitters.refine_two_way()` — see Phase 5

- **Pitcher side** (STU P, MOV P, PCON P):
  - All 3/3 ≥ 40

This flags a small percentage of players as two-way (<10%), much more realistic than the previous floor-based approach.

### OSA Blending — COMPLETE

OSA blending is implemented via `load_players(osa_blend=True)`:
- Auto-detects `_osa.csv` files alongside scout files
- Blends only whitelisted rating columns (`_RATING_COLUMNS` frozenset): `final = scout_weight * scout + osa_weight * osa`
- Non-rating metadata (name, salary, contract, flags) always preserved from scout file
- Players without an OSA match keep their scout-only ratings

### Implementation Notes

- Uses `pd.read_csv(low_memory=False)` to handle mixed-type columns (HLD has `'-'` values)
- Files are concatenated with `pd.concat(ignore_index=True)` — no deduplication
- Column mapping by header string; only the 3 duplicate disambiguations use positional logic
- All raw columns retained; OOTP player ID is in the `ID` column

---

## Hitter Computation Pipeline (`hitters.py`)

### Phase 2 + 3: Core Batting Stats + DH Stats — COMPLETE

**Status:** Implemented in `src/hitters.py`. 59 tests passing (`tests/test_hitters.py`).

For each split (vR and vL), compute per-PA stat counts using rating regressions:

1. **HBP** = `hbp_rate × PA` (no regression, no park)
2. **uBB** = `(eye_delta + bb_rate) × (PA - HBP)` (EYE regression, no park)
3. **HR** = `(pow_delta + hr_rate) × (PA - uBB - HBP)` [+ park]
4. **SO** = `(k_delta + so_rate) × (PA - uBB - HBP)` (K regression, no park)
5. **H-HR** = `MAX((babip_delta + babip) × BIP [+ park], 0)` where BIP = PA-HBP-uBB-HR-SO
6. **XBH-HR** = `(gap_delta + xbh_rate) × H-HR` [+ park]
7. **3B** = `(speed_delta + triple_rate) × XBH-HR` [+ park] — uses SPE rating, not fixed rate
8. **2B** = `XBH-HR - 3B`
9. **1B** = `H-HR - XBH-HR`
10. **OBP** = `(uBB + HBP + H-HR + HR) / PA`
11. **wOBA** = `(wt_HBP×HBP + wt_BB×uBB + wt_1B×1B + wt_2B×2B + wt_3B×3B + wt_HR×HR) / PA`
12. **BatR** = `(wOBA - lgwOBA) / wOBA_scale × PA`

Each rating-to-rate conversion uses the piecewise linear model from `data_points.py`:
- Rating ≥ 50: `delta = h_const + h_slope × (rating - avg_rating)`
- Rating < 50: `delta = l_const + l_slope × (rating - avg_rating)`

**Dual park factor model** (key discovery during implementation):
- **Rating ≥ 50 (high model):** Additive park deltas from `ParkDeltas` (split by pitcher hand vR/vL)
- **Rating < 50 (low model):** Multiplicative factors from `NormalizedAdjustments` (by batter hand R/L/S)
  - `park_mult = 1 + (normalized_adj - 1) × home_fraction`

**Handedness weighting** (vL/vR → weighted):
```
SWITCH(bats):
  "R" → stat_vL × (1 - RvR) + stat_vR × RvR       # RvR = 0.720
  "L" → stat_vL × (1 - LvR) + stat_vR × LvR       # LvR = 0.776
  "S" → stat_vL × (1 - SvR) + stat_vR × SvR       # SvR = 0.741
```

**DH stats** = the regular batting pipeline with zero park deltas and multiplicative factor = 1.0 (park-neutral). Produces DH wOBA (vR/vL/wtd) and DH BatR (vR/vL/wtd).

**Output:** 33 new columns appended: 12 vR + 12 vL + 3 weighted + 6 DH. PA = 600 for all players.

### Phase 4: Baserunning — COMPLETE

**Status:** Implemented in `src/hitters.py`. 99 tests passing (59 batting + 40 baserunning).

**SB% (stolen base success rate):**
- Cubic polynomial: `SUMPRODUCT((STE - avg_ste)^{0,1,2,3}, sb_pct_coeffs) + league_sb_pct`
- STE cap at 80 was **removed** (Bug 2 FIXED — cap was a spreadsheet bug, not intentional)
- SB% is shared across both splits (single value per player)

**SBA rate (stolen base attempt rate):**
- Cubic polynomial: `SUMPRODUCT((STE - avg_ste)^{0,1,2,3}, sba_coeffs) + league_sba_rate`
- STE is NOT capped for SBA

**SBAT (stolen base attempts, per split):**
- `SBAT = sba_rate * (1B + uBB + HBP)`, clipped to >= 0
- Note: uses reaching-base events (1B + uBB + HBP), NOT `sba_rate * PA`

**SB / CS (per split):**
- `SB = SBAT * SB%`
- `CS = SBAT * (1 - SB%)`

**wSB (per split):**
- `wSB = 0.2 * SB + run_cs * CS`
- SB weight is **hardcoded 0.2** (NOT wt_sb = 0.2375 from Data Points H18)
- CS weight uses `run_cs` = -0.422 (Data Points H35)

**UBR (per split):**
- Cubic polynomial on RUN rating: `SUMPRODUCT((RUN - avg_run)^{0,1,2,3}, ubr_coeffs) + league_ubr`
- `ubr_rate * base_opportunities` where `base_opp = (1B + uBB + HBP) * 3 + 2B * 2 + 3B - sb_adj`
- `sb_adj = IF(wSB_vL > 0, SBAT, 0)` — uses **wSB_vL** for the IF condition in BOTH vR and vL splits (spreadsheet quirk, see KNOWN_BUGS.md)

**BSR (total baserunning):**
- `BSR = wSB + UBR` (per split, then weighted by handedness)

**Output:** 16 new baserunning columns: SB%, SBAT vR/vL, SB vR/vL, CS vR/vL, wSB vR/vL/wtd, UBR vR/vL/wtd, BSR vR/vL/wtd. Total output: 49 columns (33 batting + 16 baserunning).

### Phase 5: Position Eligibility — COMPLETE

**Status:** Implemented in `src/hitters.py`. 161 tests passing (99 batting/baserunning + 28 eligibility + 6 two-way refinement + 4 height parsing + 29 players).

Determine which positions a player is eligible for based on fielding ratings, throwing hand, and height. Every player is always eligible for DH.

| Position | Column | Rule |
|----------|--------|------|
| **C**  | BJ | `C FRM >= 45` |
| **1B** | BK | `HT (cm) > 179` AND `IF RNG > 20` |
| **2B** | BL | `IF RNG >= 50` AND `T == "R"` AND `TDP >= 45` |
| **3B** | BM | `IF RNG >= 40` AND `IF ARM >= 50` AND `T == "R"` |
| **SS** | BN | `IF RNG >= 60` AND `IF ARM >= 50` AND `T == "R"` |
| **LF** | BO | `OF RNG >= 50` |
| **CF** | BP | `OF RNG >= 60` |
| **RF** | BQ | `OF RNG >= 50` |
| **DH** | — | Always `True` |

**Notes:**
- **HT Sort** = height in cm. CSV `HT` column format `6' 2'` → parsed via `feet * 30.48 + inches * 2.54`.
- **1B** uses strict `>` for both height and IF RNG. All other positions use `>=`.
- **Catcher training toggle** (`Filters!$A$72`) stripped — UI filter, not core eligibility.

**Two-way player refinement** (`refine_two_way`): After eligibility is computed, refines the initial `is_two_way` flag from `players.py`:
- **Path A:** 2/3 big-3 ratings (CON P, POW P, EYE P) >= 50 → qualifies regardless of position
- **Path B:** 3/3 big-3 >= 40 AND eligible for a defensive position (C, 2B, 3B, SS, LF, CF, RF — NOT 1B/DH)
- Both paths require all 3 pitcher ratings (STU P, MOV P, PCON P) >= 40

### Phase 6: Fielding — COMPLETE

**Status:** Implemented in `src/hitters.py`. 180 tests passing (132 batting/baserunning/eligibility + 48 fielding).

For each eligible position, compute defensive value. Ineligible positions get NaN.

**Catcher (7 output columns: FRMAA, SBA, RTO%, SB, CS, ArmR, RunsP):**
- FRMAA = `(c_frm_const + c_frm_slope * (FRM - avg)) * ip_c`
- SBA = `(c_frm_const + c_frm_slope * (ARM - avg_arm)) * ip_c + c_sba_scale` — **Bug 5**: uses FRM coefficients instead of SBA coefficients (replicated)
- RTO% = `MAX(0, c_rto_const + c_rto_slope * (ARM - avg_arm) + c_rto_lg)`
- CS = `RTO% * SBA`; SB = `SBA - CS`
- ArmR = `CS * -(0.2 + run_cs) - (c_sba_scale * c_rto_lg * -(0.2 + run_cs))`
- RunsP = `FRMAA + ArmR` (PMAA is always 0 in spreadsheet)

**1B (3 columns: PMAA, EAA, RunsP):**
- PMAA = `(const + rng_slope*(RNG - avg) + ht_slope*(HT - avg_ht)) * scale` — unique: uses height as secondary input
- EAA = `(const + slope*(ERR - avg)) * ip`
- RunsP = `(PMAA - EAA) * inf_out`

**2B/3B (3–4 columns: PMAA, EAA, [DPAA], RunsP):**
- PMAA = `(const + rng_slope*(RNG - avg) + arm_slope*(ARM - avg)) * scale` — uses IF ARM as secondary
- EAA = `(const + slope*(ERR - avg)) * (PMAA + scale * lg_pm%)` — **multiplicative** (self-referential)
- DPAA (2B only) = `(const + slope*(TDP - avg)) * ip`
- RunsP = `(PMAA - EAA [+ DPAA]) * inf_out`

**SS (4 columns: PMAA, EAA, DPAA, RunsP):**
- Same structure as 2B but with separate DP coefficients (K45/L45) and separate TDP average (Q25)

**Outfield LF/CF/RF (4 columns each: PMAA, EAA, ARMAA, RunsP):**
- PMAA = `(const + slope*(OF_RNG - avg)) * scale`
- EAA = `(const + slope*(OF_ERR - avg)) * (PMAA + scale * lg_pm%)` — multiplicative
- ARMAA = `(const + slope*(OF_ARM - avg)) * scale`
- RunsP = `(PMAA - EAA) * of_out + ARMAA`

Key scaling constants: `inf_out = 0.75`, `of_out = 0.9`, `ip_c = 1000` (catcher IP), `ip = 1200` (full-season IP).

### Phase 7: WAA Per Position — COMPLETE

**Status:** Implemented in `src/hitters.py`. 206 tests passing (180 batting/baserunning/eligibility/fielding + 26 WAA).

Combines batting, baserunning, and fielding into per-position WAA (Wins Above Average), then picks the best position as Max WAA.

**Standard positions (1B–RF):**
```
WAA_vR = (RunsP + BSR_vR + BatR_vR + PosAdj) / waa_const
WAA_vL = (RunsP + BSR_vL + BatR_vL + PosAdj) / waa_const
WAA_wtd = handedness_weighted(WAA_vR, WAA_vL)
```

**Catcher (special — PA=500 inline BatR):**
```
BatR_c = (wOBA - lg_wOBA) / woba_scale * 500    # recalculated at PA=500
park_adj_c = adj_value / PA * PA_c                # scales park adj from 600→500 PA
C_WAA = (C_RunsP + BSR + BatR_c + park_adj_c + PosAdj_C) / waa_const
```

**DH (special — park-neutral + BSR discount):**
```
DH_WAA = (BSR * 0.98 + DH_BatR + PosAdj_DH) / waa_const
```
- No fielding runs (RunsP = 0)
- Uses DH BatR (park-neutral) instead of regular BatR
- BSR multiplied by 0.98

**Max WAA** = `MAX(C_WAA, 1B_WAA, ..., DH_WAA)` per split (vR, vL, wtd).

**Output:** 30 new WAA columns: 9 positions × 3 splits + 3 Max WAA. Ineligible positions are NaN.

### Phase 8: Prospect Stats — COMPLETE (via `src/export.py`)

Prospect stats are now computed in the export pipeline (`_prepare_prospect_hitters()` substitutes potential ratings for vR/vL splits, then reruns the full batting + fielding + WAA pipeline). Rankings are deferred to the React frontend.

### Phase 9: JSON Export — COMPLETE (via `src/export.py` + `main.py`)

`build_dashboard()` in `src/export.py` assembles all computed stats (current + prospect) into nested JSON dicts. `main.py` writes the gzip-compressed output to `output/dashboard.json.gz`. Includes salary/price parsing, demand handling, and starter/starterP classification.

**Metadata auto-detection:** `build_dashboard()` accepts an optional `metadata_dir` parameter. If `data/metadata/inputs/` contains CSV files, the pipeline automatically calls `generate_data_points()` → `compose_data_points()` to compute custom league parameters. Otherwise it falls back to `DEFAULT_HITTER_DP` / `DEFAULT_PITCHER_DP`.

---

## Key Architectural Constraints

1. **No Eligible/Filter logic** — Calculate stats for every player unconditionally. Filtering is a UI concern (React frontend).

2. **STE cap at 80 REMOVED** — Bug 2 FIXED: SB% now uses raw STE without cap (matching SBA behavior).

3. **DH stats use zero park deltas** — DH batting is park-neutral by design.

4. **Two-way players** — Processed by both hitter and pitcher pipelines. The `players.py` two-way flag enables this.

5. **Dual park factor model** — High-model ratings (≥50) use additive `ParkDeltas`; low-model ratings (<50) use multiplicative `NormalizedAdjustments`.

6. **Rating regression is piecewise** — Split at rating = 50 (high model vs low model). Both segments centered on the league-average rating.

7. **Catcher PA reduction** — Catchers use PA = 500 (H32) and IP = 1000 (H34) instead of the standard PA = 600 / IP = 1200.

---

## Phased Roadmap

| Phase | Scope | Module | Status |
|-------|-------|--------|--------|
| 1 | CSV ingestion, merging, tagging, two-way detection | `players.py` | **COMPLETE** (29 tests) |
| 2+3 | Core batting stats vR/vL/wtd + DH stats | `hitters.py` | **COMPLETE** (59 tests) |
| 4 | Baserunning: SB%, SBA, SB, CS, wSB, UBR, BSR | `hitters.py` | **COMPLETE** (40 tests) |
| 5 | Position eligibility (rating/handedness requirements) | `hitters.py` | **COMPLETE** (33 tests) |
| 6 | Fielding (FRMAA, PMAA, EAA, DPAA, ARMAA, RunsP per position) | `hitters.py` | **COMPLETE** (48 tests) |
| 7 | WAA per position + Max WAA | `hitters.py` | **COMPLETE** (26 tests) |
| 8 | Prospect stats (potential ratings → pipeline) | `export.py` | **COMPLETE** |
| 9 | JSON export (nested per-player dicts) | `export.py` + `main.py` | **COMPLETE** |

---

## Testing Strategy

Each phase is tested by extracting actual cell values from `The Sheet Hitters.xlsx` (using `openpyxl` with `data_only=True`) for a representative sample of players, then asserting Python outputs match within floating-point tolerance.

**Sample players should cover:**
- Right-handed, left-handed, and switch hitters
- Players with ratings above and below 50 (high/low model boundary)
- Multi-position eligible players
- Catchers (reduced PA)
- Edge cases: rating exactly 50, STE > 80, two-way players
