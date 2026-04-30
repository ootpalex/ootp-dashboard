# Spreadsheet Issues Found During Reverse Engineering

I reverse-engineered the hitter/pitcher sheets and the regressions workbook into Python. In the process of validating my output against the spreadsheets, I found a handful of issues that are either bugs or possibly intentional choices I wanted to flag. Figured I'd share them in case any are worth fixing.

For context: I was able to reproduce 50 out of 60 regression slope coefficients to exact floating-point precision, so the vast majority of the spreadsheet logic is rock solid. These are the handful of things that stood out.

---

## 1. LH Park Deltas Use RH Lookup Row

**Sheets:** Ballparks (cells `AH40`, `AG40`, `AI40`) and Pitchers (RP vL park factors for HR and H-HR)

Row 40 in the Ballparks sheet is the LH delta row, but three cells (H-HR, XBH-HR, 3B) reference the RH lookup row (row 35) instead of the LH row (row 38). The result is that LH and RH batters get identical park factor deltas for those three stats.

The same pattern shows up in the Pitchers sheet — RP vL park factors for HR and H-HR pull from the RH row instead of LH.

Likely a copy-paste from the RH row where the row references weren't updated.

---

## 2. SB% Caps STE at 80, SBA Does Not

**Sheet:** Hitters (cell `CY2`)

The SB% formula applies `MIN(STE, 80)` before the polynomial, but SBA uses raw STE with no cap. So a player with STE=90 gets their steal attempt rate from the full 90 rating but their success rate is computed as if they were an 80. Seems inconsistent — either both should cap or neither should.

Could be intentional if the idea is that elite speedsters still attempt at their full rate but don't succeed at a proportionally higher rate, but it felt like an oversight.

---

## 3. UBR sb_adj Uses vL wSB for Both Splits

**Sheet:** Hitters (UBR vR and UBR vL columns — DI, DJ)

The UBR formula has an IF condition based on `wSB` that determines the `sb_adj` value. Both the vR and vL columns reference the vL wSB value for this condition instead of the split-appropriate one. Small impact in practice since wSB doesn't change sign often, but technically the vR column should reference vR wSB.

---

## 4. Catcher SBA Uses Framing Coefficients

**Sheet:** Hitters (cell `DQ2`)

The catcher SBA (stolen base attempts against) formula references the FRM regression coefficients (`K3:L3`, slope = +0.000547) instead of the SBA coefficients (`K5:L5`, slope = -0.000696). The signs are opposite, so higher C ARM currently *increases* SBA instead of decreasing it. Probably just a row reference off by 2.

---

## 5. Speed LOW Regression Filters on GAP vR Instead of SPE

**Sheet:** Hitting Reg, speed (3B%) LOW section

The speed regression splits players at rating = 50 into HIGH and LOW groups. The HIGH filter correctly uses `SPE >= 50`, but the LOW filter uses `GAP vR < 50` instead of `SPE < 50`. This means the LOW group has 90 players with low GAP rather than the intended ~155 with low SPE. The resulting slope differs by about 15% from what you'd get with the correct filter.

Looks like the LOW FILTER formula was copied from the GAP section and the column reference wasn't updated.

---

## 6. SS DP LINEST Range is 25 Rows Instead of 32

**Sheet:** Fielding Reg IF (cells `BB165:BC169`)

The SS DP regression's LINEST formula covers rows 165–189 (25 players) instead of 165–196 (all 32 SS players). Every other SS regression (PM, ERR, ARM) uses the full range to row 196. Looks like the range just wasn't extended to cover the last 7 players. The slope changes by about 43% if you include all 32.

---

## 7. RP SB% Slope Reuses the SP Value

**Sheet:** Regressions Data Points

The RP SB% regression slope (c1) in the Data Points sheet is bit-for-bit identical to the SP SB% slope. SP and RP have different player pools (160 SP vs 224 RP), so their actual slopes differ by about 14%. The intercepts (c0) are stored separately for SP and RP, so it seems like the intent was to have separate regressions, but the slope cell might just be pointing at the SP result instead of an RP-specific one.

Could be intentional if the thinking was "the relationship between HLD and SB% is the same regardless of role," but wanted to flag it.

---

## 8. Stale Cached Values for One RP Player (ID 411)

**Sheet:** Pitching Reg RP

This one is more of a data staleness issue than a formula bug. Player 411 has formula cells in the RP regression sheet that appear to not have been recalculated after the last pivot table refresh. The centered rating values and centered stat rate values for this player reflect an older version of the data where their ratings and sim results were quite different:

| Rating | Old (cached) | Current (pivot) |
|--------|-------------|-----------------|
| CON vR | 65 | 50 |
| HRR vR | 45 | 40 |
| STU vR | 55 | 80 |
| PBABIP vR | 65 | 50 |

The counting stats also changed substantially (K% went from 0.265 to 0.388). Since this player has 15,898 BF (0.4% of total) and rating shifts up to 25 points, they create outsized leverage in the WLS regressions. This affects 4 RP slopes (CON, HRR, STU, BABIP) by 0.2–4.4%.

Probably just needs a Ctrl+Shift+F9 (full recalculate) or the workbook might be set to manual calculation mode. The SP sheet doesn't have this issue.

---

## 9. GAP Regression Only Uses High-Model Coefficients

**Sheets:** Hitters (XBH-HR column) and Regressions Data Points (rows 11–12)

Every other rating-to-stat regression (EYE, POW, K, BABIP, Speed) uses a piecewise model that splits at rating = 50: the HIGH model (`h_const + h_slope * centered`) for ratings ≥ 50, and the LOW model (`l_const + l_slope * centered`) for ratings < 50. The Regressions Data Points sheet stores both sets of coefficients for GAP as well (row 11 = high, row 12 = low), but the Hitters sheet formula for XBH-HR only references the high-model cells (`B11`/`C11`) regardless of the player's GAP rating.

The low-model slope (0.00651) is about 2× the high-model slope (0.00322), so players with GAP < 50 get a noticeably smaller XBH-HR delta than the low-model regression says they should. Looks like the piecewise IF was left out when the GAP formula was written, possibly because GAP is the only stat where the XBH-HR regression maps to a different column than the others.

---

## 10. S-Batter H-HR Park Factor Doesn't Flip by Split

**Sheet:** Hitters (H-HR / BA columns)

Switch hitters bat left-handed against RHP (vR split) and right-handed against LHP (vL split), so their park factors should flip by split to match the side they're actually hitting from. The HR park factor does this correctly — vR uses the LH factor, vL uses the RH factor. But the H-HR (batting average) park factor uses the same blended value (`ba_rh * svr + ba_lh * (1 - svr)`) for both splits instead of flipping.

This means a switch hitter's batting average gets the same park adjustment regardless of which side of the plate they're hitting from, while their HR rate correctly adjusts. In most parks the LH and RH BA factors are close enough that the impact is small, but it's inconsistent with how HR is handled.

---

## 11. Baserunning wSB Uses Hardcoded 0.2 Instead of wt_sb

**Sheet:** Hitters (wSB column and Catcher ArmR)

The wSB formula uses a hardcoded `0.2` for the SB event weight: `wSB = SB * 0.2 + CS * run_cs`. The Data Points sheet has a computed wOBA SB weight (`wt_sb`) of 0.2375, and the Pitchers sheet uses the correct ~0.237 value for its wOBA calculation. Using 0.2 instead of 0.2375 underweights the value of stolen bases by about 16%.

The same hardcoded 0.2 appears in the Catcher ArmR formula (`arm_weight = -(0.2 + run_cs)`).

Could be intentional — maybe the baserunning module was calibrated with 0.2 separately from the wOBA weights — but wanted to flag the discrepancy since the pitchers sheet uses the full-precision value.
