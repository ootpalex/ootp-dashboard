// ============================================================================
// FUTURE VALUE — v21 (three-input simplification, power-law creditAge)
//
// Formula:
//   gap        = max(0, pot − cur)
//   t          = clamp((age − 14) / (maxCurrentAge − 14), 0, 1)
//   creditAge  = max(0, gapMax × (1 − t^gapExp))
//   FV         = (age ≥ maxCurrentAge) ? cur :
//                (cur > pot)           ? cur :
//                                        cur + gap × creditAge
//
// Why three inputs: pot is reframed as the *ceiling* (max valuation at maturity),
// so within-cohort discrimination via devPct is unnecessary — `(cur, pot)`
// already encode the per-player spread. Dropping devPct also removes the
// implicit penalty for high-floor players (defense-driven cur, low batR-pct)
// that earlier formulas imposed.
//
// Why power-law shape: gives a smooth round decay from gapMax at age 14 to 0
// at maxCurrentAge. The logistic alternative tracks empirical median dev
// reality more tightly but creates a sharp 19→22 cliff that under-credits
// late-developing high-pot prospects (who don't follow median trajectory).
// Power-law's gentler shape is preferred for prospect ranking.
// ============================================================================
import { DEV_CURVE_DEFAULTS, SMART_RANK_TUNING, LEAF_CHAINS } from "./constants.js";

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Linear-interp p50 lookup from the cohort devCurve at any age.
// Used by FVIAT diagnostic display only — not by the FV path.
export function typicalAtAge(devCurve, age) {
  if (!Array.isArray(devCurve) || devCurve.length === 0 || age == null) return null;
  if (age <= devCurve[0].age) return devCurve[0].p50;
  if (age >= devCurve[devCurve.length - 1].age) return devCurve[devCurve.length - 1].p50;
  for (let i = 0; i < devCurve.length - 1; i++) {
    const a0 = devCurve[i].age, a1 = devCurve[i + 1].age;
    if (age >= a0 && age <= a1) {
      const t = a1 === a0 ? 0 : (age - a0) / (a1 - a0);
      return devCurve[i].p50 * (1 - t) + devCurve[i + 1].p50 * t;
    }
  }
  return devCurve[devCurve.length - 1].p50;
}

// Age-cohort percentile rank for a player's dev signal value. v21: dev signal
// is cur-WAR across all cohorts (hitter `maxWar.wtd`, SP `sp.wtd.war`, RP
// scaled `rp.wtd.war`). Used purely for the Dev% display column — not in the
// FV formula. Interpolates through the embedded percentile distribution at
// the player's exact age. Returns 0..1.
//
// Tail handling: below p10 saturates to (devValue / p10) × 0.10; above p95
// saturates toward 1.0 over the (p10 → p95) headroom.
export function devPercentileRank(devCurve, age, devValue) {
  if (!Array.isArray(devCurve) || devCurve.length === 0) return null;
  if (age == null || devValue == null) return null;

  const PCT_KEYS = ['p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99'];
  const ageRow = {};
  if (age <= devCurve[0].age) {
    PCT_KEYS.forEach(k => { ageRow[k] = devCurve[0][k]; });
  } else if (age >= devCurve[devCurve.length - 1].age) {
    PCT_KEYS.forEach(k => { ageRow[k] = devCurve[devCurve.length - 1][k]; });
  } else {
    for (let i = 0; i < devCurve.length - 1; i++) {
      const lo = devCurve[i], hi = devCurve[i + 1];
      if (age >= lo.age && age <= hi.age) {
        const t = hi.age === lo.age ? 0 : (age - lo.age) / (hi.age - lo.age);
        PCT_KEYS.forEach(k => { ageRow[k] = lo[k] * (1 - t) + hi[k] * t; });
        break;
      }
    }
  }

  // v21: p99 included for fuller resolution at the high tail (matches pipeline _PERCENTILE_KEYS).
  const anchors = [
    [0.10, ageRow.p10], [0.25, ageRow.p25], [0.50, ageRow.p50],
    [0.75, ageRow.p75], [0.90, ageRow.p90], [0.95, ageRow.p95], [0.99, ageRow.p99],
  ].filter(([, v]) => v != null);

  if (devValue <= anchors[0][1]) {
    if (!isFinite(anchors[0][1]) || anchors[0][1] === 0) return 0.05;
    return Math.max(0, Math.min(0.10, anchors[0][0] * (devValue / anchors[0][1])));
  }
  const lastVal = anchors[anchors.length - 1][1];
  if (devValue >= lastVal) {
    const headroom = lastVal - anchors[0][1];
    if (headroom <= 0) return 0.95;
    const excess = devValue - lastVal;
    return Math.min(1, 0.95 + 0.05 * (excess / headroom));
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    const [pctLo, valLo] = anchors[i];
    const [pctHi, valHi] = anchors[i + 1];
    if (devValue >= valLo && devValue <= valHi) {
      if (valHi === valLo) return pctLo;
      const t = (devValue - valLo) / (valHi - valLo);
      return pctLo + t * (pctHi - pctLo);
    }
  }
  return null;
}

// Cohort selector for downstream consumers — returns the embedded devCurve
// for the player's cohort (hit / sp / rp).
export function pickDevCurve(devCurves, player) {
  if (!devCurves) return null;
  const isPitcher = player._poolType === "pitcher" || player._type === "pitcher";
  if (!isPitcher) return devCurves.hit ?? null;
  if (player._role === "rp") return devCurves.rp ?? null;
  if (player._role === "sp") return devCurves.sp ?? null;
  return (player.starter || player.starterP) ? devCurves.sp : devCurves.rp;
}

// Compute v21 FV for a player. Pure (cur, pot, age) inputs — no devPct.
// Inputs are WAR (post-v0.2.0). The math is metric-agnostic — gap and credit
// shape don't care whether the values are WAA or WAR — but the curveSettings
// `gapMax` ceiling is calibrated to the WAR distribution.
export function calcFutureValue(currentWAR, potentialWAR, age, cs = {}) {
  const {
    gapMax = DEV_CURVE_DEFAULTS.gapMax,
    gapExp = DEV_CURVE_DEFAULTS.gapExp,
    maxCurrentAge = DEV_CURVE_DEFAULTS.maxCurrentAge,
  } = cs;
  if (potentialWAR == null) return currentWAR ?? 0;
  if (currentWAR == null) return potentialWAR;
  if (age == null) return potentialWAR;
  if (age >= maxCurrentAge) return currentWAR;
  if (currentWAR > potentialWAR) return currentWAR;        // over-achievers preserved

  const t = clamp((age - 14) / (maxCurrentAge - 14), 0, 1);
  const creditAge = Math.max(0, gapMax * (1 - Math.pow(t, gapExp)));
  const gap = Math.max(0, potentialWAR - currentWAR);
  return currentWAR + gap * creditAge;
}

// Computes the v21 power-law creditAge at a given age. Used by CurveTuningPanel
// chart preview to render the parametric curve.
export function calcCreditAge(age, cs = {}) {
  const {
    gapMax = DEV_CURVE_DEFAULTS.gapMax,
    gapExp = DEV_CURVE_DEFAULTS.gapExp,
    maxCurrentAge = DEV_CURVE_DEFAULTS.maxCurrentAge,
  } = cs;
  if (age == null) return null;
  if (age >= maxCurrentAge) return 0;
  const t = clamp((age - 14) / (maxCurrentAge - 14), 0, 1);
  return Math.max(0, gapMax * (1 - Math.pow(t, gapExp)));
}

// ============================================================================
// SMART RANK — additive WAR-unit deltas on top of FV
//
// Each toggle contributes a signed WAR-unit delta (or zero when off / N/A).
// No multiplicative `(1 + …)` chains — every adjustment is interpretable in
// the same units as the FV baseline. Tuning constants live in
// SMART_RANK_TUNING (constants.js). Penalties are clamped to documented
// ceilings to keep extreme edge cases from dominating the ranking.
// ============================================================================

// Bonus WAR for a player at one of the org's weak positions. Picks the best
// (highest-need) value across the player's eligible positions.
function computeOrgNeedBonus(player, orgNeed) {
  if (!orgNeed) return 0;
  let maxNeed = orgNeed[player.meta?.pos ?? player.POS] ?? 0;
  const elig = player._eligiblePositions;
  if (Array.isArray(elig)) {
    elig.forEach((pos) => { maxNeed = Math.max(maxNeed, orgNeed[pos] ?? 0); });
  }
  return SMART_RANK_TUNING.ORG_NEED_BONUS_SCALE * maxNeed;
}

// Two-tier per-player penalty for ONE cap node. Evaluated on the count this pick
// WOULD create (status.picked + 1), so the cap-EXCEEDING pick is the one
// penalized. ZERO at/below the SOFT cap (draft to roster share freely); a gentle
// CAP_SOFT_STEP per player through the soft→hard overage band; past the HARD cap
// a harsh CAP_HARD_STEP per player over hard — "hard-zone-only" (the band cost
// does NOT carry over). Per-player (not cap-relative) so the big guardrails bind.
// No-max / capless nodes (no soft cap) contribute 0.
// `steps` ({soft, hard}) lets the Draft Board override the calibrated default
// step magnitudes (SMART_RANK_TUNING.CAP_SOFT_STEP / CAP_HARD_STEP) live.
function capGroupPenalty(status, steps) {
  if (!status || !status.soft) return 0;
  const count = status.picked + 1;
  const softStep = steps?.soft ?? SMART_RANK_TUNING.CAP_SOFT_STEP;
  const hardStep = steps?.hard ?? SMART_RANK_TUNING.CAP_HARD_STEP;
  const hard = status.hard || status.soft;
  if (count > hard) return hardStep * (count - hard);
  if (count > status.soft) return softStep * (count - status.soft);
  return 0;
}

// CHAIN penalty for landing at a cap-tree leaf: the MAX penalty along the leaf's
// chain (leaf → parent → ... e.g. cOF → OF → Hitters). So a pick is penalized
// once ANY level it occupies is over its cap — SP only once Pitchers binds, cOF
// at the first of cOF / OF / Hitters. No-max / capless nodes contribute 0.
function chainPenalty(leafId, capStatus, steps) {
  const chain = LEAF_CHAINS[leafId];
  if (!chain) return capGroupPenalty(capStatus[leafId], steps);
  let pen = 0;
  for (const nodeId of chain) {
    const p = capGroupPenalty(capStatus[nodeId], steps);
    if (p > pen) pen = p;
  }
  return pen;
}

// Position-cap RELIEF value. The player keeps the value of their best eligible
// position whose cap CHAIN isn't full: for each eligible leaf, (that leaf's FV
// − the leaf's chain penalty), take the max. 1B/DH are excluded from the relief
// set unless 1B is the player's primary (1B eligibility is near-universal junk
// and must not grant relief). The pick still COUNTS against the primary leaf
// (handled by the board's capStatus, which counts each pick into its leaf and
// all ancestors). `useFv` = the devAdj toggle; leaf FV is calcFutureValue(cur,
// pot) when on, else the leaf's potential. Falls back to the headline value
// when the player has no contributing leaf. Mirrors the sim's
// my_value_and_landing().
function computeCappedReliefValue(player, capStatus, useFv, cs, steps) {
  const groups = player._groupFvInputs;
  const headline = useFv
    ? calcFutureValue(player._currentVal, player._baseVal, player._age, cs)
    : (player._baseVal ?? 0);
  if (!groups || !capStatus) return headline;
  const primary = player._primaryLeaf;
  let best = -Infinity;
  for (const gid of Object.keys(groups)) {
    if (gid === "1B" && primary !== "1B") continue; // junk 1B/DH relief excluded
    const { cur, pot } = groups[gid];
    const gfv = useFv ? calcFutureValue(cur, pot, player._age, cs) : (pot ?? cur ?? 0);
    const v = gfv - chainPenalty(gid, capStatus, steps);
    if (v > best) best = v;
  }
  return Number.isFinite(best) ? best : headline;
}

// Expected signing cost for a player — the OOTP-stated demand discounted by
// their Sign category. Easy signs settle for less than the listed amount;
// Extremely Hard need the full demand. 'Impossible' players have no parseable
// demand (pipeline stores NaN) and realistically cost more than the pool max,
// so they're estimated at SIG_IMPOSSIBLE_DEMAND. Returns 0 when no demand is
// known. Used by both the smart-rank signability penalty and the Draft Board
// budget tracker so the two always agree.
export function effectiveDemand(player) {
  const sign = player.meta?.sign ?? player.Sign ?? null;
  const { SIG_DEMAND_FRACTION, SIG_IMPOSSIBLE_DEMAND } = SMART_RANK_TUNING;
  if (sign === "Impossible") return SIG_IMPOSSIBLE_DEMAND ?? 0;
  const demand = Number(player._demSort ?? player.meta?.demSort ?? 0);
  if (!(demand > 0)) return 0;
  // No discount when Sign is missing/unknown (legacy dashboards) — assume the
  // listed demand is the cost rather than inventing a discount.
  const fraction = (SIG_DEMAND_FRACTION && sign != null && SIG_DEMAND_FRACTION[sign] != null)
    ? SIG_DEMAND_FRACTION[sign] : 1.0;
  return demand * fraction;
}

// Signability penalty — apply the share-of-remaining-budget formula to the
// player's effective (signability-discounted) demand. 'Impossible' bypasses
// the dollar math entirely and returns a fixed SIG_IMPOSSIBLE_WAR penalty
// (these players will not sign within any realistic budget). Active only
// when demandsOn && budget > 0.
function computeSignabilityPenalty(player, ctx) {
  if (!ctx || !ctx.demandsOn || !(ctx.budget > 0)) return 0;
  const sign = player.meta?.sign ?? player.Sign ?? null;
  const { SIG_THRESHOLD, SIG_BASE_WAR, SIG_MAX_WAR, SIG_IMPOSSIBLE_WAR } = SMART_RANK_TUNING;
  if (sign === "Impossible") return SIG_IMPOSSIBLE_WAR;

  const effDemand = effectiveDemand(player);
  if (!(effDemand > 0)) return 0;

  const spent = Number(ctx.spent ?? 0);
  const remaining = Math.max(0, ctx.budget - spent);
  if (remaining <= 0) return SIG_MAX_WAR;
  const share = effDemand / remaining;
  if (share <= SIG_THRESHOLD) return 0;
  const penalty = (share - SIG_THRESHOLD) * SIG_BASE_WAR;
  return Math.max(0, Math.min(SIG_MAX_WAR, penalty));
}

// ============================================================================
// COVERAGE FLOOR — minimum-coverage nudge for scarce premium leaves (C/MI/CF).
// The caps are a MAX-limiter; this is the matching MIN-puller. Decoupled
// two-cushion urgency with a ramp that reaches the full bonus at HALF the fire
// point — validated in Leftovers/draft-cap-sim (coverage_floor_sweep.md).
//
//   ramp(x, fire) = clamp(2·(fire − x)/fire, 0, 1)
//   need   = min − have ;  fireP = PICKS_START + need ;  fireS = CUSHION_S + need
//   bonus  = MAX_BONUS · max(ramp(picksLeft, fireP), ramp(supply, fireS))^POWER
//
// supply = remaining primaries at the leaf with potential WAR > 0, each weighted
// by (1 − signabilityPenalty/SIG_MAX_WAR) so a player who'd eat your budget counts
// as less real supply (raw count when demands are off). Computed ONCE per render;
// applySmartRank adds floorCtx[player._primaryLeaf] to each candidate. Returns null
// when no leaf has a positive minimum.
//   ctx = { capStatus, picksLeft, floorMins, cushionS?, picksStart?, demandsOn, budget, spent }
// `cushionS` / `picksStart` override the calibrated FLOOR_CUSHION_S / FLOOR_PICKS_START
// defaults when the Draft Board passes user-tuned values.
// ============================================================================
export function computeCoverageFloorContext(pool, ctx) {
  if (!ctx || !ctx.floorMins) return null;
  const mins = ctx.floorMins;
  const leaves = Object.keys(mins).filter((l) => (mins[l] ?? 0) > 0);
  if (leaves.length === 0) return null;
  const { FLOOR_CUSHION_S, FLOOR_PICKS_START, FLOOR_MAX_BONUS, FLOOR_POWER, SIG_MAX_WAR } = SMART_RANK_TUNING;
  const cushionS = ctx.cushionS ?? FLOOR_CUSHION_S;
  const picksStart = ctx.picksStart ?? FLOOR_PICKS_START;

  const supply = {};
  leaves.forEach((l) => { supply[l] = 0; });
  for (const p of pool) {
    const l = p._primaryLeaf;
    if (supply[l] === undefined) continue;       // not a floored leaf
    if (!((p._baseVal ?? 0) > 0)) continue;       // WAR-P > 0 only (keeps high-upside young guys)
    const w = clamp(1 - computeSignabilityPenalty(p, ctx) / SIG_MAX_WAR, 0, 1);
    supply[l] += w;
  }

  const picksLeft = ctx.picksLeft ?? Infinity;
  const out = {};
  for (const l of leaves) {
    const need = (mins[l] ?? 0) - (ctx.capStatus?.[l]?.picked ?? 0);
    if (need <= 0) { out[l] = 0; continue; }      // minimum already met → no nudge
    const fireP = picksStart + need;
    const fireS = cushionS + need;
    const tP = clamp(2 * (fireP - picksLeft) / fireP, 0, 1);
    const tS = clamp(2 * (fireS - supply[l]) / fireS, 0, 1);
    out[l] = FLOOR_MAX_BONUS * Math.pow(Math.max(tP, tS), FLOOR_POWER);
  }
  return out;
}

// Injury proneness — straight lookup. Negative entries (Iron Man, Durable)
// act as a bonus because we *subtract* the penalty from score.
function computeInjuryPenalty(player) {
  const prone = player.meta?.prone ?? player.Prone;
  if (!prone) return 0;
  return SMART_RANK_TUNING.PRONE_PENALTY_WAR[prone] ?? 0;
}

// Intangibles — signed bonus tied to the 20–80 grade. Above 50 helps, below
// 50 hurts. Players without a computed `_intangibles` get 0. The grade is
// already bounded to [20, 80] by the normalizer in helpers.js, so the bonus
// is naturally bounded by ±3 × INT_BONUS_WAR — no explicit clamp needed.
function computeIntangiblesBonus(player) {
  const grade = player._intangibles;
  if (grade == null) return 0;
  const gradeOffset = (grade - 50) / 10;
  return gradeOffset * SMART_RANK_TUNING.INT_BONUS_WAR;
}

export function applySmartRank(player, toggles, orgNeed, curveSettings = null, draftContext = null) {
  const cs = curveSettings || { ...DEV_CURVE_DEFAULTS };
  const useFv = !!(toggles.devAdj && player._age != null);

  // RP-role adjustment scale. RP WAR/FV is raw and compressed (scaleRpWarP is now a no-op), so the
  // HIT/SP-calibrated talent-relative deltas below would swamp a reliever's ~+0.6 FV ceiling. We
  // shrink org-need / prone / intangibles for RP-role pitchers by the IP ratio (≈0.375). Caps,
  // signability, and the coverage floor are left at full strength. See SMART_RANK_TUNING.RP_ADJUST_SCALE.
  const adjScale = player._role === 'rp' ? SMART_RANK_TUNING.RP_ADJUST_SCALE : 1;

  // Baseline value. With Position Caps on, the cap penalty isn't a flat
  // subtraction — it's baked into the per-position RELIEF value (best surviving
  // eligible-position FV). Otherwise the baseline is the headline FV / potential.
  // _currentVal/_baseVal are pre-stamped by buildBoardPool; for RP-role pitchers these carry the
  // raw (unscaled) RP WAR — which is why the deltas, not the baseline, get the RP scaling.
  let score;
  if (toggles.posCaps && draftContext?.capStatus) {
    score = computeCappedReliefValue(player, draftContext.capStatus, useFv, cs, draftContext.capPenalty);
  } else if (useFv) {
    score = calcFutureValue(player._currentVal, player._baseVal, player._age, cs);
  } else {
    score = player._baseVal ?? 0;
  }

  if (toggles.orgNeed) score += adjScale * computeOrgNeedBonus(player, orgNeed);
  // Coverage floor: per-leaf min-coverage bonus (precomputed in draftContext.floorCtx),
  // added to candidates whose primary leaf is still under its minimum. On by default
  // (`!== false`) so saved toggles predating the key still get it; explicit off respected.
  // Not RP-scaled (only C/MI/CF have floors, so it never applies to an RP-role pitcher anyway).
  if (toggles.coverage !== false && draftContext?.floorCtx) {
    score += draftContext.floorCtx[player._primaryLeaf] ?? 0;
  }
  // Signability is NOT RP-scaled — budget is a shared opportunity cost (same dollars hurt the draft
  // equally regardless of role) and the cap already encodes a hard affordability wall.
  if (toggles.signability) score -= computeSignabilityPenalty(player, draftContext);
  if (toggles.injury) score -= adjScale * computeInjuryPenalty(player);
  if (toggles.intangibles) score += adjScale * computeIntangiblesBonus(player);

  return score;
}

// ============================================================================
// LEGACY EXPORTS — vestigial helpers kept for FVIAT / diagnostic code.
// The FV path no longer uses these.
// ============================================================================

// Linear-interpolated p50 of the legacy progressCurve.
export function midpointAtAge(curve, age) {
  if (!Array.isArray(curve) || curve.length === 0 || age == null) return null;
  if (age <= curve[0].age) return curve[0].p50;
  if (age >= curve[curve.length - 1].age) return curve[curve.length - 1].p50;
  for (let i = 0; i < curve.length - 1; i++) {
    const a0 = curve[i].age, a1 = curve[i + 1].age;
    if (age >= a0 && age <= a1) {
      const t = a1 === a0 ? 0 : (age - a0) / (a1 - a0);
      return curve[i].p50 * (1 - t) + curve[i + 1].p50 * t;
    }
  }
  return curve[curve.length - 1].p50;
}

// progress = clamp((cur - floor) / (pot - floor), 0, 1). Vestigial.
export function computeProgress(currentWAA, potentialWAA, floorWAA) {
  if (potentialWAA == null || floorWAA == null) return null;
  const denom = potentialWAA - floorWAA;
  if (denom <= 0) return null;
  if (currentWAA == null) return 0;
  return clamp((currentWAA - floorWAA) / denom, 0, 1);
}

export const pickProgressCurve = pickDevCurve;
export function progressPercentileRank(progressCurve, age, progress) {
  return devPercentileRank(progressCurve, age, progress);
}
