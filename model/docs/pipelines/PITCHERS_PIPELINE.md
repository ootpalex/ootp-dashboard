# Pitchers Pipeline — Architectural Blueprint

## Overview

This document defines the architecture for implementing the OOTP pitcher evaluation pipeline in Python (`src/pitchers.py`). It serves as the blueprint for converting pitcher ratings into batting-against stats, RA/9, and WAA for both starters and relievers.

**Existing modules (complete):**
- `src/ballparks.py` — park factor computation (81 tests)
- `src/data_points.py` — model constants and regression coefficients (50 tests)
- `src/players.py` — CSV ingestion, merging, source tagging, two-way detection (29 tests)
- `src/hitters.py` — hitter stat computation pipeline (206 tests)

---

## Data Structures & Integration

### Integration with Existing Modules

`pitchers.py` will reuse the same upstream modules as `hitters.py`:

- **`PitcherDataPoints` / `DEFAULT_PITCHER_DP`** (from `data_points.py`) — regression coefficients, league params, wOBA weights
  - `pitching: PitchingRegressionCoeffs` — SP/RP rating → stat coefficients
  - `league: PitcherLeagueParams` — rating avgs, BF/IP, RA/9 baselines, pitcher matchup splits
  - `hitting_rates: HitterLeagueParams` — wOBA weights, league stat rates (shared with hitters)
  - `fielding: FieldingParams` — position adjustments (shared with hitters)
- **`NormalizedAdjustments`** (from `ballparks.py`) — multiplicative park factors per team
- **`load_players()`** (from `players.py`) — merged DataFrame with `is_pitcher` flag and all rating columns

### Key Reusable Pattern from hitters.py

The `_rating_to_delta()` helper (piecewise linear regression split at rating = 50) is identical for pitchers. Either import directly from `hitters.py` or extract to a shared utility.

---

## Module Organization

```
src/
  ballparks.py       # park factor computation
  data_points.py     # model constants, regression coefficients
  players.py         # shared CSV ingestion
  hitters.py         # hitter stat computation pipeline (sibling — see HITTERS_PIPELINE.md)
  pitchers.py        # pitcher stat computation pipeline (this doc)
  aggregators/       # Phase E split — hit/pitch/field aggregators for metadata.compose_data_points

tests/
  test_pitchers.py   # pitcher pipeline tests
```

> **Note on doc style:** "NEW" / "FUTURE" status flags throughout this doc reflect the original phased reverse-engineering rollout. All phases are now COMPLETE — see the Phased Roadmap table at the bottom for current status.

---

## Starter/Reliever Classification

### Starter Flag (Pitchers sheet column AX) — Bug 11 FIXED

The spreadsheet uses `SP P Pitch` (potential grades) for both Starter and Starter P. This is Bug 11 (see KNOWN_BUGS.md). Our Python implementation fixes this:

**Starter (current):**
```
Starter = AND(
  OR(
    SP_Pitch >= 3,
    AND(SP_Pitch >= 2, Pitches >= 3),
    AND(SP_Pitch >= 1, Pitches >= 5)
  ),
  STM >= 35
)
```

**Starter P (potential):**
```
StarterP = AND(
  OR(
    SP_P_Pitch >= 3,
    AND(SP_P_Pitch >= 2, Pitches >= 3),
    AND(SP_P_Pitch >= 1, Pitches >= 5)
  ),
  STM >= 35
)
```

Where:
- **`Pitches`** (Player List column CV) = count of pitch grades > 25, with knuckleball counting as 2:
  `SUM(IF(KNP<>"-", 2, 0), IF(FBP<>"-", 1, 0), ...)`
- **`SP Pitch`** (Player List column CX) = count of current pitch grades > 25 with grade weighting
- **`SP P Pitch`** (Player List column CW) = same but using potential/prospect grades
- **`STM`** = stamina rating (Player List column BV)

Functions: `compute_starter_flag()` (uses SP Pitch) and `compute_starter_potential()` (uses SP P Pitch).

### HLD Column Handling

The HLD (Hold runners) rating has mixed types in CSV — dashes (`'-'`) replaced with 20:
```
VALUE(SUBSTITUTE(INDEX(Players[...], ...), "-", 20))
```

---

## Phased Implementation

### Phase 1: Starter/Reliever Classification + Pitch Count

**Goal:** Compute the `Starter` flag, `Pitches`, and `SP Pitch`/`SP P Pitch` columns.

**Input:** Player DataFrame from `load_players()`

**Pitch count computation:**
- Count pitch grades (FB, CH, CB, SL, SI, SP, CT, FO, CC, SC, KC, KN) where grade > 25
- Knuckleball (KN) counts as 2
- Uses current grades for `SP Pitch`, prospect grades for `SP P Pitch`

**Starter determination:**
- Combine pitch count with stamina threshold (STM >= 35)
- Three-tier pitch diversity gate (see classification logic above)

**Eligibility gating:**
- SP stats: `AND(Starter, Eligible)` — must be classified as starter AND pass all filters
- RP stats: `Eligible` only — all eligible pitchers get RP stats regardless of Starter flag

**Output:** Boolean columns: `Starter`, `Starter P`, plus `Pitches`, `SP Pitch`, `SP P Pitch`

**Test targets:** ~15–20 tests covering edge cases (STM=34/35, pitch count boundaries, KN counting)

---

### Phase 2: Core Batting-Against Stats (SP + RP, vR + vL)

**Goal:** For each role (SP/RP) and split (vR/vL), compute per-BF stat counts.

**Rating → Stat Mappings (4 pitcher ratings → 4 stats):**

| Rating | Stat Produced | Regression | Park Factor |
|--------|---------------|------------|-------------|
| CON vR/vL | uBB (walk rate) | Piecewise linear (split at 50) | None |
| HRR vR/vL | HR (home run rate) | Piecewise linear (split at 50) | `hr_park` (Filters!$C$11) |
| STU vR/vL | SO (strikeout rate) | Piecewise linear (split at 50) | None |
| PBABIP vR/vL | H-HR (BABIP hits) | Piecewise linear (split at 50) | `ba_park` (Filters!$C$8) |

**Stat computation order (per split):**

1. **HBP** = `hbp_rate × BF` — no regression, no park factor
2. **uBB** = `MAX((con_delta + bb_rate) × (BF - HBP), 0)` — CON regression
3. **SO** = `MAX((stu_delta + so_rate) × (BF - uBB - HBP), 0)` — STU regression
4. **HR** = `MAX((hrr_delta + hr_rate) × (BF - uBB - HBP) × hr_park, 0)` — HRR regression + park
5. **H-HR** = `MAX((babip_delta + babip) × (BF - HBP - uBB - SO - HR) × ba_park, 0)` — PBABIP regression + park
6. **XBH-HR** = `H-HR × xbh_rate × d_park` — no regression, multiplicative
7. **3B** = `XBH-HR × triple_rate × t_park` — no regression, multiplicative
8. **2B** = `XBH-HR - 3B`
9. **1B** = `H-HR - XBH-HR`

**STU penalty for non-SP position players:**
```
effective_stu = IF(POS == "SP", STU_vX, STU_vX - 5)
```
This penalty is based on the player's **POS column** (not the Starter flag). A player with POS="RP" but Starter=TRUE still gets the -5 penalty in the SP stat section.

**SP vs RP constants:**

| Constant | SP Value | RP Value | Source |
|----------|----------|----------|--------|
| BF (batters faced) | 800 | 300 | H31/H32 |
| Rating avg (CON) | 50.78 | 46.54 | H5/H10 |
| Rating avg (HRR) | 52.67 | 50.61 | H3/H8 |
| Rating avg (STU) | 49.12 | 51.39 | H2/H7 |
| Rating avg (PBABIP) | 53.11 | 51.27 | H4/H9 |
| Regression coefficients | sp_con/hrr/stu/babip | rp_con/hrr/stu/babip | B-E rows |
| League stat rates | K$3–K$12 | K$15–K$24 | K column |

**Park factors — simpler than hitters:**
- Always multiplicative (no dual additive/multiplicative model like hitters)
- Park factor values come from `NormalizedAdjustments` adjusted by home fraction
- Applied to: HR (hr_park), H-HR (ba_park), XBH-HR (d_park), 3B (t_park)
- These are the same normalized park factors used by the hitter low-model path

**Handedness weighting (by pitcher throwing hand, column T):**
```
SWITCH(throws):
  "R" → stat_vL × (1 - rvr) + stat_vR × rvr       # rvr = 0.569
  "L" → stat_vL × (1 - lvr) + stat_vR × lvr       # lvr = 0.745
  "S" → stat_vL × (1 - svr) + stat_vR × svr       # svr = 0.617
```
Note: these are **pitcher-side splits** from `PitcherLeagueParams`, NOT the batter-side splits from `HitterLeagueParams`. The values are fundamentally different (e.g., pitcher rvr=0.569 vs batter rvr=0.720).

**Output per role:** 9 stat columns × 2 splits + 9 weighted = 27 columns per role (SP + RP = 54 total batting columns)

**Test targets:** ~40–50 tests covering SP vR/vL, RP vR/vL, weighted, park factors, STU penalty

---

### Phase 3: Stolen Base Stats (SBAT, SB%, SB, CS)

**Goal:** Compute pitcher stolen base stats using cubic polynomial on HLD rating.

**SBA rate — cubic polynomial in HLD:**
```
sba_rate = SUMPRODUCT((HLD - avg_hld)^{0,1,2,3}, sba_coeffs) + lg_sba_rate
SBAT = MAX(sba_rate × (uBB + HBP + 1B), 0)
```

**SB% — cubic polynomial in HLD:**
```
sb_pct = MIN(SUMPRODUCT((HLD - avg_hld)^{0,1,2,3}, sb_pct_coeffs) + lg_sb_pct, 1.0)
```
- SB% is capped at 1.0 (pitcher version uses MIN, unlike hitter SB% which uses MAX with 0)
- SB% is a single value per player (not split by batter hand)

**SB / CS:**
```
SB = SB% × SBAT
CS = SBAT - SB
```

**SP vs RP differences:**

| Constant | SP | RP | Source |
|----------|----|----|--------|
| HLD baseline | I$2 (~55.96) | I$7 | Pitcher Data Points I column |
| SBA intercept | K$12 | K$24 | Pitcher Data Points K column |
| SB% intercept | K$9 | K$21 | Pitcher Data Points K column |
| SBA cubic coefficients | `sba` | Same `sba` | Shared |
| SB% cubic coefficients | `sp_sb_pct` | `rp_sb_pct` | Different c0 intercept, same c1 slope |

The SBA cubic coefficients are shared between SP and RP. The SB% cubic coefficients have the same slope (c1) but different intercepts (c0) for SP vs RP — `PitchingRegressionCoeffs.sp_sb_pct` and `.rp_sb_pct`.

**Key difference from hitter baserunning:**
- Pitchers use **HLD** (hold runners rating) as the polynomial input, not STE (stealing rating)
- No UBR, wSB, or BSR computation — pitchers have simpler stolen base modeling
- SB/CS are included directly in the wOBA formula (not through BSR)

**Output:** 4 columns per split × 2 splits = 8 per role, plus SB% shared = ~17 columns total (SP + RP)

**Test targets:** ~15–20 tests covering HLD polynomial, SP vs RP baselines, SB% cap

---

### Phase 4: wOBA, RA/9, WAA

**Goal:** Compute the final performance metrics from batting-against and stolen base stats.

**wOBA — includes SB/CS in weighted sum:**
```
wOBA = (wt_hbp×HBP + wt_bb×uBB + wt_1b×1B + wt_2b×2B + wt_3b×3B + wt_hr×HR
        + wt_sb×SB + wt_cs×CS) / BF / woba_ratio
```
- Unlike hitters, pitcher wOBA includes SB/CS weights directly (not through BSR)
- Divided by `woba_ratio` = `Ballparks!$AA$37` (park-adjusted wOBA divisor)
- wOBA weights from pitcher Data Points H$12–H$19

**Important: wOBA weights may differ from hitter weights.** The pitcher Data Points H column has its own set of wOBA weights calibrated for the pitcher context. These need to be verified against the values in `HitterLeagueParams` (currently shared via `PitcherDataPoints.hitting_rates`). See "Constants to Extract/Verify" section below.

**RA/9 — quadratic formula:**
```
RA/9 = (wOBA / woba_norm)^2 × ra9_baseline
```

| Constant | SP | RP | Source |
|----------|----|----|--------|
| woba_norm | I$31 | I$29 | Pitcher Data Points I column |
| ra9_baseline | 4.761 (H41) | 4.643 (H42) | PitcherLeagueParams |

**Weighted RA/9 — computed from weighted wOBA (NOT averaged from split RA/9 values):**
```
wOBA_wtd = SWITCH(throws, ...)      # weighted by pitcher hand
RA/9_wtd = (wOBA_wtd / woba_norm)^2 × ra9_baseline
```
This is a critical subtlety: the quadratic makes `avg(RA/9_vR, RA/9_vL) ≠ RA/9(avg(wOBA_vR, wOBA_vL))`.

**WAA — simpler than hitters (no position adjustments):**
```
WAA = (ra9_baseline - RA/9) × (IP / 9) / waa_const
```

| Constant | SP | RP | Source |
|----------|----|----|--------|
| IP | 185.47 (H33) | 69.55 (H34) | PitcherLeagueParams |
| waa_const | 10.073 (H30) | 10.073 (H30) | Shared |

**Row tiebreaker:** The spreadsheet adds `ROW/10000000` to WAA for deterministic ordering. We skip this (documented in KNOWN_BUGS.md if needed).

**WAA weighted — computed from weighted RA/9:**
```
WAA_wtd = (ra9_baseline - RA/9_wtd) × (IP / 9) / waa_const
```

**Output per role:** wOBA (vR/vL/wtd), RA/9 (vR/vL/wtd), WAA (vR/vL/wtd) = 9 columns × 2 roles = 18 columns

**Test targets:** ~25–30 tests covering wOBA with SB/CS, RA/9 quadratic, WAA, weighted stats

---

### Phase 5: Prospect Stats — COMPLETE (via `src/export.py`)

Prospect stats are computed in the export pipeline (`_prepare_prospect_pitchers()` substitutes potential ratings for vR/vL splits, then reruns the full SP + RP batting-against pipeline). Output includes prospect wOBA, RA/9, and WAA for both SP and RP roles.

---

## Key Architectural Constraints

1. **No Eligible/Filter logic** — Calculate stats for every player unconditionally. Filtering is a UI concern (React frontend). However, the Starter flag IS computed since it determines which coefficient set to use.

2. **Always multiplicative park factors** — Unlike hitters' dual additive/multiplicative model, pitchers use only multiplicative park adjustments. Park factors come from `NormalizedAdjustments` adjusted by home fraction.

3. **Pitcher-side splits** — Handedness weighting uses the pitcher's throwing hand (column T) with pitcher-specific split fractions (rvr=0.569, lvr=0.745, svr=0.617), NOT the batter-side splits used in `hitters.py`.

4. **STU penalty by POS, not Starter flag** — The -5 STU adjustment for non-SP pitchers is keyed on the POS column value, not the computed Starter boolean. A reliever (POS="RP") classified as a starter by pitch count still gets the penalty.

5. **Two-way players** — Processed by both hitter and pitcher pipelines. The `players.py` two-way flag enables this.

6. **Weighted RA/9 from weighted wOBA** — Due to the quadratic RA/9 formula, weighted RA/9 must be computed from weighted wOBA, not by averaging split RA/9 values.

7. **wOBA includes stolen base events** — Unlike hitters (where SB/CS flow through BSR → WAA), pitcher wOBA directly includes `wt_sb × SB + wt_cs × CS` in the numerator.

8. **SP and RP stats computed for all pitchers** — Every pitcher gets both SP and RP stat columns (gated by eligibility in the spreadsheet, but we compute unconditionally). The Starter flag determines which set is "primary" for ranking purposes.

---

## Constants — Extracted and Verified

All pitcher Data Points constants have been extracted from `The Sheet Pitchers.xlsx` and added to `PitcherLeagueParams` in `data_points.py` (64 total fields).

### Key Discovery: Pitcher Constants Are ALL Different from Hitter Constants

Pitcher wOBA weights, league stat rates, and several other constants are **entirely distinct** from hitter values. SP and RP also have **separate** weight/rate sets. The only shared constant is `waa_const` (H30 = 10.073).

### HLD Baselines (I column)

| Field | Cell | Value | Used By |
|-------|------|-------|---------|
| `avg_hld_sp` | I$2 | 55.963 | Phase 3 — SP SBA/SB% polynomial |
| `avg_hld_rp` | I$7 | 53.819 | Phase 3 — RP SBA/SB% polynomial |

### wOBA Normalization (I column)

| Field | Cell | Value | Used By |
|-------|------|-------|---------|
| `woba_norm_sp` | I$31 | 0.32340 | Phase 4 — SP RA/9 = (wOBA/norm)^2 × ra9 |
| `woba_norm_rp` | I$29 | 0.32288 | Phase 4 — RP RA/9 |

### SP wOBA Weights (H column) vs Hitter Weights

| Field | Pitcher Value | Hitter Value | Delta |
|-------|---------------|--------------|-------|
| `sp_lg_woba` | 0.32346 | 0.32263 | +0.00083 |
| `sp_wt_hbp` | 0.72636 | 0.72680 | -0.00044 |
| `sp_wt_bb` | 0.69677 | 0.69711 | -0.00034 |
| `sp_wt_1b` | 0.88021 | 0.88119 | -0.00098 |
| `sp_wt_2b` | 1.23526 | 1.23746 | -0.00220 |
| `sp_wt_3b` | 1.55481 | 1.55812 | -0.00331 |
| `sp_wt_hr` | 1.98036 | 1.98715 | -0.00679 |
| `sp_wt_sb` | 0.23670 | 0.23752 | -0.00082 |
| `sp_wt_cs` | -0.50400 | -0.50172 | -0.00228 |
| `sp_woba_scale` | 1.18350 | 1.18760 | -0.00410 |

### RP wOBA Weights (K column rows 28–37)

RP weights differ from SP weights. HR and SB weights are identical between SP and RP.

### SP vs RP League Stat Rates (K column)

| Stat | SP (K3–K12) | RP (K15–K24) | Hitter |
|------|-------------|--------------|--------|
| hbp_rate | 0.009854 | 0.010600 | 0.010154 |
| bb_rate | 0.08457 | 0.09188 | 0.08749 |
| hr_rate | 0.03345 | 0.03532 | 0.03429 |
| so_rate | 0.24032 | 0.25693 | 0.24754 |
| babip | 0.30307 | 0.30297 | 0.30309 |
| xbh_rate | 0.26475 | 0.26268 | 0.26392 |
| triple_rate | 0.08893 | 0.09083 | 0.08966 |
| sb_pct | 0.77961 | 0.77526 | 0.78104 |
| sba_rate | 0.11330 | 0.08380 | 0.10259 |

All values differ across all three contexts (SP, RP, hitter).

---

## Pitcher Output Columns (172 total)

### Column Layout

| Columns | Count | Group | Description |
|---------|-------|-------|-------------|
| A | 1 | Sheet ID | Sequential join key |
| B–S | 18 | Player Meta | ID, ORG, Lev, LEA, LOY, AD, WE, INT, ON40, Type, WAIV, R5, Price, DEM Sort, Manual, INJ, HT Sort, Prone |
| T | 1 | Eligible | Multi-condition filter flag |
| U–Y | 5 | Basic Info | Name, Age, B, T, POS |
| Z–AG | 8 | Rankings | SP Rank (wtd/vR/vL/P), RP Rank (wtd/vR/vL/P) |
| AH–AS | 12 | Ratings | STU/HRR/PBABIP/CON × P/vR/vL |
| AT–AW | 4 | Workload | STM, HLD, Pitches, SP Pitch |
| AX–AZ | 3 | Starter Flags | Starter, SP P Pitch, Starter P |
| BA–BP | 16 | SP Stats vR | HBP, uBB, SO, HR, H-HR, XBH-HR, 3B, 2B, 1B, SBAT, SB%, SB, CS, wOBA, RA/9, WAA |
| BQ–CF | 16 | SP Stats vL | Same structure |
| CG–CJ | 4 | SP Weighted | wOBA wtd, RA/9 wtd, WAA wtd, WAR wtd |
| CK–CZ | 16 | RP Stats vR | Same structure as SP |
| DA–DP | 16 | RP Stats vL | Same structure |
| DQ–DS | 3 | RP Weighted | wOBA wtd, RA/9 wtd, WAA wtd |
| DU–EJ | 16 | Prospect SP | P versions of SP stats (SKIPPED) |
| EL–FA | 16 | Prospect RP | P versions of RP stats (SKIPPED) |
| FC–FP | 14 | Filter Flags | Age, Team, Waivers, FA, Reliever, MILB, etc. |

### Columns We Compute (non-metadata, non-filter)

| Phase | Columns | Count | Description |
|-------|---------|-------|-------------|
| 1 | AV–AX, AY–AZ | 5 | Pitches, SP Pitch, Starter, SP P Pitch, Starter P |
| 2 | BA–BI (×2 splits ×2 roles) | 36 | 9 batting-against stats per split per role |
| 3 | BJ–BM (×2 splits ×2 roles) | 16 | SBAT, SB%, SB, CS per split per role |
| 4 | BN–BP, CG–CI (×2 roles) | 18 | wOBA, RA/9, WAA per split + weighted per role |

**Total computed columns:** ~75 (excluding metadata lookups, rankings, prospect stats, and filters)

---

## Phased Roadmap

| Phase | Scope | Output Columns | Status |
|-------|-------|----------------|--------|
| 1 | Starter/reliever classification + pitch count | Pitches, SP Pitch, Starter, SP P Pitch, Starter P | **COMPLETE** (23 tests) |
| 2 | Core batting-against stats (SP+RP, vR+vL+wtd) | 9 stats × 2 splits × 2 roles + 9 wtd × 2 roles = 54 | **COMPLETE** (45 tests) |
| 3 | Stolen base stats (SB%, SBAT, SB, CS) | SB% per role + SBAT/SB/CS per split per role = 14 | **COMPLETE** (38 tests) |
| 4 | wOBA, RA/9, WAA (per split + weighted) | 3 stats × 3 (vR/vL/wtd) × 2 roles = 18 | **COMPLETE** (38 tests) |
| 5 | Prospect stats (potential ratings → pipeline) | `export.py` | **COMPLETE** |

---

## Testing Strategy

Each phase is tested by extracting actual cell values from `The Sheet Pitchers.xlsx` (using `openpyxl` with `data_only=True`) for a representative sample of pitchers, then asserting Python outputs match within floating-point tolerance.

**Sample pitchers should cover:**
- Right-handed and left-handed pitchers
- Starters (Starter=TRUE) and relievers (Starter=FALSE)
- POS="SP" vs POS="RP" (for STU penalty testing)
- Players with ratings above and below 50 (high/low model boundary)
- Edge cases: STM=34/35 boundary, rating exactly 50, HLD with dash values
- Two-way players (is_two_way=TRUE)
- Players at parks with strong park factors vs neutral parks

**Test file:** `tests/test_pitchers.py`

**Estimated test counts by phase:**
| Phase | Tests | Cumulative |
|-------|-------|------------|
| 1 | ~15–20 | ~15–20 |
| 2 | ~40–50 | ~55–70 |
| 3 | ~15–20 | ~70–90 |
| 4 | ~25–30 | ~95–120 |

---

## Key Differences: Pitchers vs Hitters

| Aspect | Hitters | Pitchers |
|--------|---------|----------|
| **Ratings** | 5 (BA, GAP, POW, EYE, K) | 4 (STU, HRR, PBABIP, CON) |
| **Role split** | Single role (all hitters) | Dual role (SP vs RP, different constants) |
| **Working stat** | PA = 600 (all), PA = 500 (catchers) | BF = 800 (SP), BF = 300 (RP) |
| **Park factors** | Dual: additive (high) + multiplicative (low) | Always multiplicative |
| **Handedness weighting** | By batter hand (B column) | By pitcher hand (T column) |
| **Split fractions** | RvR=0.720, LvR=0.776, SvR=0.741 | RvR=0.569, LvR=0.745, SvR=0.617 |
| **Baserunning** | Full: SB%, SBAT, SB, CS, wSB, UBR, BSR | Simple: SBAT, SB%, SB, CS only |
| **Baserunning input** | STE (stealing) + RUN ratings | HLD (hold runners) rating |
| **SB/CS in wOBA** | No (flows through BSR → WAA) | Yes (directly in wOBA formula) |
| **Performance metric** | wOBA → BatR (runs above average) | wOBA → RA/9 (quadratic) → WAA |
| **WAA components** | RunsP + BSR + BatR + PosAdj | (ra9_baseline - RA/9) × IP/9 |
| **Position adjustments** | 9 positions (C through DH) | None (single pitching position) |
| **Fielding** | 30 columns (7 C + ... + 4 RF) | None in pitcher sheet |

---

## Documentation Updates (on completion)

Upon completing each phase, update:
- `HITTERS_PIPELINE.md` (sibling in `model/docs/pipelines/`) — cross-reference to pitchers pipeline
- `../ARCHITECTURE_DEEP_DIVE.md` — formula details, column counts
- `../internal/archive/KNOWN_BUGS.md` — historical record of discovered bugs (new bugs go in a fresh entry under `model/docs/internal/`)
