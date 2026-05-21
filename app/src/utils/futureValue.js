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
import { DEV_CURVE_DEFAULTS, SMART_RANK_TUNING, CAP_GROUPS } from "./constants.js";

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

// Position-cap penalty driven by *this player's* eligible cap groups.
// bestFill = min(picked/cap across groups the player can land in). A player
// with no eligible group (rare — e.g. coachless DH outside the DH group)
// gets 0 penalty. The piecewise shape: 0 below CAP_START, gentle slope to
// 1.0, steep slope past 1.0. Capped at CAP_MAX_WAR.
function computeCapPenalty(player, capStatus) {
  if (!capStatus) return 0;
  const elig = player._eligiblePositions;
  if (!Array.isArray(elig) || elig.length === 0) return 0;

  let bestFill = Infinity;
  CAP_GROUPS.forEach((g) => {
    const overlaps = g.positions.some((p) => elig.includes(p));
    if (!overlaps) return;
    const s = capStatus[g.id];
    if (!s || !s.cap) return;
    const fill = s.picked / s.cap;
    if (fill < bestFill) bestFill = fill;
  });
  if (!Number.isFinite(bestFill)) return 0;

  const { CAP_START, CAP_GENTLE_WAR, CAP_STEEP_WAR, CAP_MAX_WAR } = SMART_RANK_TUNING;
  if (bestFill <= CAP_START) return 0;

  const gentleRange = 1.0 - CAP_START;
  let penalty;
  if (bestFill <= 1.0) {
    penalty = ((bestFill - CAP_START) / gentleRange) * CAP_GENTLE_WAR;
  } else {
    penalty = CAP_GENTLE_WAR + (bestFill - 1.0) * CAP_STEEP_WAR;
  }
  return Math.max(0, Math.min(CAP_MAX_WAR, penalty));
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
  // Baseline: FV (when devAdj on) or raw potential.
  let score;
  if (toggles.devAdj && player._age != null) {
    const cs = curveSettings || { ...DEV_CURVE_DEFAULTS };
    // _currentVal/_baseVal pre-stamped by buildBoardPool.
    // For RP-role pitchers all WAR fields are pre-scaled to SP-equivalent units.
    score = calcFutureValue(player._currentVal, player._baseVal, player._age, cs);
  } else {
    score = player._baseVal ?? 0;
  }

  if (toggles.orgNeed) score += computeOrgNeedBonus(player, orgNeed);
  if (toggles.posCaps) score -= computeCapPenalty(player, draftContext?.capStatus);
  if (toggles.signability) score -= computeSignabilityPenalty(player, draftContext);
  if (toggles.injury) score -= computeInjuryPenalty(player);
  if (toggles.intangibles) score += computeIntangiblesBonus(player);

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
