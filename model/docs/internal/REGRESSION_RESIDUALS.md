# Regression Residuals — Investigation & Action Items

## Summary

Out of 60 slope coefficients, **58 are exact (0.00%)**, **1 is near-exact (~0.003%)**, and
**1 has an intentional residual (0.06%)** due to a stale cached player in the Excel.

**Update 2:** Fixed `_hitting_triple_rate()` NaN propagation (speed slopes improved) and
matched the spreadsheet's approach of reusing SP SB% slope for RP (RP SB% now exact).

**Update 1:** The spreadsheet creator fixed Bug 8 (speed.l filter) and Player 411 stale cache
in an updated version of 25 Regressions.xlsx. This resolved 5 previously non-exact slopes,
bringing the exact count from 50 to 55.

---

## Group 1: Exact Slopes (58/60) — No Action Needed

- All 12 hitting linear slopes (eye, power, k, babip, gap, speed.h, speed.l)
  - speed.h and speed.l are near-exact (~0.00005% and ~0.003%) after fixing
    `_hitting_triple_rate()` to propagate NaN instead of `fillna(0)` for D+T=0 players
- All 8 SP pitching linear slopes (con, hrr, stu, babip)
- All 8 RP pitching linear slopes (con, hrr, stu, babip)
- Pitching SBA c1, SP SB% c1, **RP SB% c1** (now uses SP slope, matching spreadsheet)
- Hitting SBA c1, SB% c1 (exact after full-time 288-player filter)
- **All 26 fielding slopes** (C, 1B, 2B, 3B, SS, LF, CF, RF — PM, ERR, ARM, DP)

These match because our player sets, data, formulas, and regression method (WLS for
hitting/pitching, OLS for fielding) are identical to the Excel.

---

## Group 2: Fielding Slopes (26 slopes) — ALL RESOLVED (0.00%)

**Root cause was: WLS instead of OLS + player set mismatches + answer key extraction errors**

**Resolution**: All fielding regressions in the Excel use plain LINEST (unweighted OLS) with
simple-average centering (np.mean), NOT IP-weighted WLS. Switching from `_wls_single`/`_wls_multi`
to `_ols_single`/`_ols_multi` with `np.mean` centering produced exact matches for all 26 slopes.

### What we found

The answer key file (`fielding_reg_players.json`) was extracted incorrectly:

1. **IDs 1–32 in the IF answer key are TEAM IDs, not player IDs.** They come from the DP analysis section (rows 42–78 in "Fielding Reg IF") which totals double plays by team. The extraction script mixed these with actual player IDs from the regression sections.

2. **The Excel uses ~30 players per position (one per team)**, not 155 for IF or 90 for OF. The catcher answer key (30 players) is correct. The IF and OF answer keys are supersets.

3. **Regressions are position-specific.** Each position only includes players who actually played that position in the sims:
   - Using 60 LF-specific players → 0.24% error
   - Using all 90 combined-OF players → 19.4% error (wrong approach)

### Sub-issue: DP slopes — RESOLVED

**Root cause found and fixed:** The Excel DP regression uses:
1. **Team-level DP/IP** as the Y variable (from the Data Model, not player-level dp/ip)
2. **OLS** (unweighted LINEST), not WLS
3. Each player's Y value is looked up from their team's allocated DP/IP rate
4. The team DP/IP allocation formula splits team DPs between 2B and SS using PA-based weighting

**Fix:** Extracted team DP/IP rates from the Excel DP section (rows 43–78) and stored in `team_dp_rates.json`. The regression now uses OLS on these team-level rates. Both slopes are now **exact (0.00%)**.

**SS LINEST Bug (Bug 9):** Replicated — SS DP uses only 25 of 32 players (rows 165–189). The excluded 7 player IDs are stored in the answer key.

### Current slope errors — ALL EXACT (0.00%)

All 26 fielding slopes now match exactly after switching from WLS to OLS with simple-average centering.

---

## Group 3: RP Pitching Linear (4 slopes) — RESOLVED (updated spreadsheet)

**Root cause was: Player 411 stale cached formula values in the Excel workbook**

The spreadsheet creator fixed this in the updated 25 Regressions.xlsx by recalculating
all formulas. All 8 RP linear slopes (con, hrr, stu, babip × h/l) now match exactly.

### What we found (historical)

The original `25 Regressions.xlsx` workbook's "Pitching Reg RP" sheet had a single player (ID 411)
whose downstream formula cells were **not recalculated** after the pivot table was refreshed.
Both the centered ratings (X) and centered stat rates (Y) retained stale cached values.

**Proof:** Patching BOTH X and Y for player 411 to their stale values reproduced the original
answer key slopes to **0.00000000%** for all 4 RP linear regressions. See `scripts/stale_cache_proof.py`.

---

## Group 3b: RP SB% (1 slope) — RESOLVED (matched spreadsheet)

**Root cause: Spreadsheet reuses SP SB% slope for RP**

The `rp_sb_pct.c1` answer key value (`-0.00254143972877271`) is **bit-for-bit identical** to
`sp_sb_pct.c1`. The Excel runs the SB% regression only on SP data and shares the c1 slope
with RP (while storing separate c0 intercepts). SP has a larger sample (5.96M BF vs 3.77M),
and the HLD mechanic is identical for SP and RP.

**Fix:** `compute_pitching_regressions()` now computes the RP-specific intercept but reuses
the SP slope for c1, matching the spreadsheet. RP SB% c1 is now **exact (0.00%)**.

---

## Group 4: Hitting Cubics (3 slopes) — RESOLVED

**Root cause: Excel uses 288 full-time baserunning players, not all 441**

| Slope | Error (441 players) | Error (288 players) | Notes |
|-------|---------------------|---------------------|-------|
| sba c1 | +2.44% | **0.0000%** | STE>=55 → 78 players |
| sb_pct c1 | -0.63% | **0.0000%** | SPE>=55 → 71 players |
| ubr c1 | -1.52% | **0.06%** | All 288 players; stale cache for player 1288 |

### What we found

The Excel "Hitting Reg" baserunning section uses only 288 players from the split_id=1 data,
corresponding to full-time players with PA >= ~17,329 (from the associated split_id=3 data).
All 288 are a subset of our 441 split_id=1 players; the extra 153 have lower PA.

With the 288-player set:
- SBA c1 → **EXACT (0.0000%)** — down from 2.44%
- SB% c1 → **EXACT (0.0000%)** — down from 0.63%
- UBR c1 → **0.06%** — down from 1.52%

The UBR residual (0.06%) is due to a stale cached value for player 1288 in the Excel
(same pattern as the now-fixed Player 411). Removing player 1288 gives exact match (6 ULP).
Our code is more correct — no fix needed.

---

## Group 5: speed.l_slope — RESOLVED (updated spreadsheet)

**Root cause was: Bug 8 — speed LOW filter used GAP vR instead of SPE**

The spreadsheet creator confirmed this was a bug and fixed the filter in the updated
25 Regressions.xlsx. Our code already used the correct SPE filter for both HIGH and LOW
models, so our speed.l_slope now matches the updated answer key within 0.01%.

---

## Final Status

| Group | Slopes | Status | Notes |
|-------|--------|--------|-------|
| Hitting linear (12) | all 12 | **Exact** | speed near-exact ~0.003% after NaN fix |
| SP pitching linear (8) | all 8 | **Exact** | |
| RP pitching linear (8) | all 8 | **Exact** | Player 411 stale cache fixed in spreadsheet |
| Pitching cubics (3) | SBA, SP SB%, RP SB% | **Exact** | RP SB% uses SP slope |
| Hitting cubics (2) | SBA, SB% | **Exact** | 288-player full-time filter |
| Hitting cubics (1) | UBR | **0.06%** | Stale cached player 1288 in Excel |
| Fielding (26) | all 26 | **Exact** | OLS with simple-average centering |

**Pass/fail summary** (60 slopes): **58 exact**, 1 near-exact (~0.003%), 1 intentional (0.06% stale cache)
