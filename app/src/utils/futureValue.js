// ============================================================================
// FUTURE VALUE — Dev percentile, FV calculation, smart rank, risk helpers
// ============================================================================
import { G5_DEFAULTS } from "./constants.js";

export function computeDevPercentile(playerCurrentWAA, playerAge, peerPool, bandwidth = 2.0) {
  if (playerCurrentWAA == null || playerAge == null || peerPool.length === 0) return 0.5;
  let below = 0, total = 0;
  peerPool.forEach((peer) => {
    if (peer.currentWAA == null || peer.age == null) return;
    const dist = (peer.age - playerAge) / bandwidth;
    const w = Math.exp(-0.5 * dist * dist);
    if (w < 0.001) return;
    total += w;
    if (peer.currentWAA < playerCurrentWAA) below += w;
    else if (peer.currentWAA === playerCurrentWAA) below += w * 0.5;
  });
  return total > 0 ? below / total : 0.5;
}

export function riskExpToSlider(v) { return Math.log(Math.max(0.01, v) / 0.01) / Math.log(10000); }

export function sliderToRiskExp(s) {
  const raw = 0.01 * Math.pow(10000, s);
  if (raw < 0.1) return Math.round(raw * 100) / 100;
  if (raw < 1) return Math.round(raw * 20) / 20;
  if (raw < 5) return Math.round(raw * 2) / 2;
  if (raw < 20) return Math.round(raw);
  return Math.round(raw / 5) * 5;
}

export function fmtRiskExp(v) {
  if (v < 0.1) return v.toFixed(2);
  if (v < 1) return v.toFixed(2);
  if (v < 10) return v.toFixed(1);
  return String(Math.round(v));
}

export function normalizedLogit(x, k) {
  // k < 1: flat middle, steep edges (desired for devPct)
  // k = 1: linear (identity)
  // k > 1: steep middle, flat edges (sigmoid-like)
  const apply = (v) => {
    const cv = Math.max(0.001, Math.min(0.999, v));
    return 1 / (1 + Math.exp(-k * Math.log(cv / (1 - cv))));
  };
  const s0 = apply(0.001), s1 = apply(0.999);
  const cx = Math.max(0.001, Math.min(0.999, x));
  const val = apply(cx);
  return (val - s0) / (s1 - s0);
}

export function calcFutureValue(currentWAA, potentialWAA, age, devPercentile, cs = {}) {
  const { maxCurrentAge = 30, riskMin = 0.75, riskMax = 1.00, riskExp = 1,
          gapMax = 1.00, gapExp = 3,
          riskMode = 'power', logitK = 0.5 } = cs;
  if (potentialWAA == null) return currentWAA ?? 0;
  if (currentWAA == null) return potentialWAA;
  if (age == null) return potentialWAA;
  if (age >= maxCurrentAge) return currentWAA;
  const t = Math.max(0, Math.min(1, (age - 14) / (maxCurrentAge - 14)));
  const dp = devPercentile ?? 0.5;
  const riskScale = riskMode === 'logit'
    ? normalizedLogit(dp, logitK)
    : Math.pow(dp, riskExp);
  const riskFactor = riskMin + (riskMax - riskMin) * riskScale;
  const gap = potentialWAA - currentWAA;
  const gapFactor = Math.max(0, gapMax * (1 - Math.pow(t, gapExp)));
  return currentWAA + gap * riskFactor * gapFactor;
}

export function applySmartRank(player, toggles, orgNeed, scarcity, devPercentiles = null, curveSettings = null) {
  let score = player._baseVal ?? 0;

  if (toggles.devAdj && player._age != null) {
    const pct = devPercentiles ? (devPercentiles.get(String(player.ID)) ?? 0.5) : 0.5;
    const cs = curveSettings || { ...G5_DEFAULTS };
    // For RP-role pitchers, _currentVal and _baseVal are pre-scaled to SP-equivalent
    score = calcFutureValue(player._currentVal, player._baseVal, player._age, pct, cs);
  }

  if (toggles.orgNeed && orgNeed) {
    let maxNeed = orgNeed[player.meta?.pos ?? player.POS] ?? 0;
    if (player._eligiblePositions) {
      player._eligiblePositions.forEach((pos) => { maxNeed = Math.max(maxNeed, orgNeed[pos] ?? 0); });
    }
    score *= (1 + maxNeed);
  }

  if (toggles.scarcity && scarcity) {
    score *= (1 + (scarcity[player.meta?.pos ?? player.POS] ?? 0) * 0.5);
  }

  if (toggles.defSpectrum) {
    const premium = { C: 0.15, SS: 0.12, CF: 0.10, "2B": 0.05, "3B": 0.03, LF: 0, RF: 0, "1B": -0.05, DH: -0.1, SP: 0.08, RP: 0 };
    score *= (1 + (premium[player.meta?.pos ?? player.POS] ?? 0));
  }

  return score;
}
