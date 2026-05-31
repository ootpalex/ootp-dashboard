// ============================================================================
// PROSPECTS — Prospect pool building, tier assignment, farm rankings, scouting
// ============================================================================
import { num } from "./helpers.js";
import { getMaxWar, getMaxWarP, pickPitcherRole } from "./accessors.js";
import {
  FV_TIERS,
  FG_TIER_STATS,
  DEV_CURVE_DEFAULTS,
  TIER_SEARCH_K,
  TIER_SNAP_T_THRESH,
  TIER_SNAP_WINDOW,
} from "./constants.js";
import { calcFutureValue } from "./futureValue.js";

export function isProspect(player) {
  const mld = player.meta?.mld ?? num(player.MLD);
  return mld == null || mld < 45;
}

export function isInOrg(player, iafaTag) {
  const org = (player.meta?.org ?? player.ORG ?? "").trim();
  if (!org || org === "-" || org === "0") return false;
  const m = (player.meta?.source ?? player.meta?.manual ?? player.Manual ?? "").trim();
  if (m.toLowerCase().includes("draft")) return false;
  if (m === (iafaTag || "IAFA")) return false;
  return true;
}

export function buildProspectPool(data, iafaTag, curveSettings = null) {
  const cs = curveSettings || DEV_CURVE_DEFAULTS;
  const hitPool = data.hitters.filter((h) => isProspect(h) && isInOrg(h, iafaTag)).map((h) => {
    const maxWARP = getMaxWarP(h);
    const maxWAR = getMaxWar(h);
    const age = h._age ?? h.meta?.age ?? num(h.Age);
    return {
      ...h,
      _baseVal: maxWARP ?? 0, _currentVal: maxWAR,
      _baseValDisplay: maxWARP ?? 0, _currentValDisplay: maxWAR,
      _fv: calcFutureValue(maxWAR, maxWARP, age, cs),
      _poolType: "hitter",
    };
  });
  const pitPool = data.pitchers.filter((p) => isProspect(p) && isInOrg(p, iafaTag)).map((p) => {
    const r = pickPitcherRole(p, null, null, 'best');
    const age = p._age ?? p.meta?.age ?? num(p.Age);
    return {
      ...p,
      _baseVal: r.warPSort ?? 0, _currentVal: r.warSort ?? r.war ?? 0,
      _baseValDisplay: r.warP ?? 0, _currentValDisplay: r.war ?? 0,
      _fv: calcFutureValue(r.warSort ?? r.war ?? 0, r.warPSort ?? 0, age, cs),
      _role: r.role, _poolType: "pitcher",
    };
  });
  return [...hitPool, ...pitPool];
}

function _sd(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

function _welchT(a, b) {
  if (a.length < 2 || b.length < 2) return null;
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  const va = a.reduce((s, v) => s + (v - ma) ** 2, 0) / (a.length - 1);
  const vb = b.reduce((s, v) => s + (v - mb) ** 2, 0) / (b.length - 1);
  const se = Math.sqrt(va / a.length + vb / b.length);
  if (!isFinite(se) || se === 0) return null;
  return (ma - mb) / se;
}

// V5c: range-constrained natural-break detection. For each tier T (descending),
// search rank window [cum_μ ± K·cum_σ] for the best natural break (max of FV-gap
// z-score and pot-cluster Welch t-stat); snap if significant, else default to
// round(cum_μ). One uniform rule across all tiers — no convex extrapolation.
// Empty middle tiers receive a linearly interpolated cut between the nearest
// non-empty anchors above and below (using FG cumulative population as the
// x-axis). Empty top tiers (no non-empty above) use linear extrapolation
// floored at top_FV + (top_FV − second_FV) so an empty 80 sits clearly above
// the league's best prospect. Full investigation: Leftovers/prospect-tier-thresholds/findings.md.
export function suggestThresholds(prospects, numTeams) {
  if (!prospects || prospects.length === 0) return {};
  const sorted = [...prospects].sort(
    (a, b) => (b._fv ?? b._baseVal ?? 0) - (a._fv ?? a._baseVal ?? 0)
  );
  const N = sorted.length;
  const scale = numTeams / 30;
  const thresholds = {};

  const fvOf = (p) => p._fv ?? p._baseVal ?? 0;
  const potOf = (p) => p._baseVal ?? p.pot ?? 0;

  // Phase 1: compute bestI and store cumMu for each tier.
  const tierStates = [];
  let cumMu = 0;
  let cumVar = 0;
  let prevI = 0;
  for (const tier of FV_TIERS) {
    const stats = FG_TIER_STATS[tier.id];
    if (!stats) continue;
    const mu = stats.avg * scale;
    const sg = stats.std * scale;
    cumMu += mu;
    cumVar += sg * sg;
    const cumSig = Math.sqrt(cumVar);

    const defaultI = Math.max(prevI, Math.min(N, Math.round(cumMu)));
    const rLo = Math.max(prevI, Math.floor(cumMu - TIER_SEARCH_K * cumSig));
    const rHi = Math.min(N, Math.ceil(cumMu + TIER_SEARCH_K * cumSig));

    let bestI = defaultI;
    let bestScore = -Infinity;

    if (rHi > rLo) {
      const ctxLo = Math.max(0, rLo - TIER_SNAP_WINDOW);
      const ctxHi = Math.min(N, rHi + TIER_SNAP_WINDOW);
      const ctxFVs = sorted.slice(ctxLo, ctxHi).map(fvOf);
      const fvScale = Math.max(0.05, _sd(ctxFVs));

      for (let i = rLo; i <= rHi && i < N; i++) {
        if (i <= prevI) continue;
        const fvGap = fvOf(sorted[i - 1]) - fvOf(sorted[i]);
        const zFV = fvGap / fvScale;
        const wLo = Math.max(prevI, i - TIER_SNAP_WINDOW);
        const wHi = Math.min(N, i + TIER_SNAP_WINDOW);
        const above = sorted.slice(wLo, i).map(potOf);
        const below = sorted.slice(i, wHi).map(potOf);
        const zPot = _welchT(above, below) ?? 0;
        const score = Math.max(zFV, zPot);
        if (score > bestScore) {
          bestScore = score;
          bestI = i;
        }
      }
      if (bestScore < TIER_SNAP_T_THRESH) bestI = defaultI;
    }
    tierStates.push({ id: tier.id, bestI, prevI, cumMu });
    prevI = bestI;
  }

  // Phase 2: assign FV cuts.
  // - Populated tiers (pop ≥ POP_STABLE): midpoint of bracketing players.
  // - Sparse non-empty (pop 1..POP_STABLE-1): midpoint blended halfway (α=ALPHA)
  //   toward LR_stable, clamped to keep all players in tier.
  // - Empty topmost: top_FV blended halfway toward LR_stable.
  // - Empty middle: LR_all (interpolation through all non-empty anchors).
  // Player assignments from Phase 1 (bestI) are never overridden — this is
  // purely about the displayed threshold numbers for sparse upper tiers.
  const POP_STABLE = 5;
  const ALPHA = 0.5;

  const allAnchors = [];
  const stableAnchors = [];
  for (const ts of tierStates) {
    if (ts.bestI > ts.prevI) {
      const cutFV = (fvOf(sorted[ts.bestI - 1]) + fvOf(sorted[ts.bestI])) / 2;
      const anchor = { cumMu: ts.cumMu, cutFV };
      allAnchors.push(anchor);
      if (ts.bestI - ts.prevI >= POP_STABLE) stableAnchors.push(anchor);
    }
  }

  // Log-linear regression: cutFV = slope * log(cumMu) + intercept.
  // Returns null if too few anchors or zero variance in log(cumMu).
  const fitLogLinear = (anchorList) => {
    if (anchorList.length < 2) return null;
    const xs = anchorList.map((a) => Math.log(a.cumMu));
    const ys = anchorList.map((a) => a.cutFV);
    const n = anchorList.length;
    const mx = xs.reduce((s, v) => s + v, 0) / n;
    const my = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    if (den === 0) return null;
    const slope = num / den;
    return { slope, intercept: my - slope * mx };
  };
  const fitStable = fitLogLinear(stableAnchors);
  const fitAll = fitLogLinear(allAnchors);
  const evalFit = (fit, cumMuT) => fit.slope * Math.log(cumMuT) + fit.intercept;

  const topFV = N > 0 ? fvOf(sorted[0]) : 0;
  const minAnchorCumMu = allAnchors.length > 0
    ? Math.min(...allAnchors.map((a) => a.cumMu))
    : Infinity;

  for (const ts of tierStates) {
    const pop = ts.bestI - ts.prevI;
    let cut;

    if (pop >= POP_STABLE) {
      // Populated tier — midpoint is reliable.
      cut = (fvOf(sorted[ts.bestI - 1]) + fvOf(sorted[ts.bestI])) / 2;
    } else if (pop >= 1) {
      // Sparse non-empty — blend midpoint with LR_stable prediction.
      const midpoint = (fvOf(sorted[ts.bestI - 1]) + fvOf(sorted[ts.bestI])) / 2;
      const lowestPlayerFV = fvOf(sorted[ts.bestI - 1]);
      if (fitStable != null) {
        const lrPred = evalFit(fitStable, ts.cumMu);
        const blend = midpoint + ALPHA * (lrPred - midpoint);
        const candidate = Math.max(midpoint, blend);
        // Don't eject the lowest player in the tier — fall back to midpoint if clamped.
        cut = candidate <= lowestPlayerFV ? candidate : midpoint;
      } else {
        cut = midpoint;
      }
    } else {
      // Empty tier.
      const isTopmost = ts.cumMu < minAnchorCumMu;
      if (isTopmost && fitStable != null) {
        // Empty topmost — blend top_FV with LR_stable prediction.
        const lrPred = evalFit(fitStable, ts.cumMu);
        cut = topFV + ALPHA * (lrPred - topFV);
      } else if (fitAll != null) {
        // Empty middle — LR through all anchors interpolates naturally.
        cut = evalFit(fitAll, ts.cumMu);
      } else if (allAnchors.length === 1) {
        cut = allAnchors[0].cutFV;
      } else {
        cut = topFV + 0.01; // fallback: empty league or single tier with no anchors
      }
    }
    thresholds[ts.id] = Math.round(cut * 100) / 100;
  }
  return thresholds;
}

export function assignFVTier(fv, thresholds) {
  if (fv == null) return null;
  for (const tier of FV_TIERS) {
    if (fv >= (thresholds[tier.id] ?? Infinity)) return tier.id;
  }
  return null;
}

export function getDollarValue(tierId, playerType, dollarValues) {
  const dv = dollarValues[tierId];
  if (!dv) return 0;
  return playerType === "pitcher" ? (dv.pit ?? 0) : (dv.bat ?? 0);
}

export function buildScoutingReport(ceiling, floor, batting, pitching) {
  const parts = [];
  const avg = (ceiling + floor) / 2;
  if (avg >= 60) parts.push("Premier System");
  else if (avg >= 55) parts.push("Strong System");
  else if (avg >= 45) parts.push("Average System");
  else if (avg >= 35) parts.push("Weak System");
  else parts.push("Barren System");
  if (ceiling >= 70) parts.push("Headline Talent");
  else if (ceiling >= 60) parts.push("Impact Talent");
  if (floor >= 70) parts.push("Endless Depth");
  else if (floor >= 60) parts.push("Stockpiled Depth");
  else if (floor <= 35) parts.push("Empty Shelf");
  if (ceiling >= floor + 10 && floor < 50) parts.push("Top Heavy");
  else if (floor >= ceiling + 10 && ceiling < 50) parts.push("Low Ceiling");
  if (avg >= 35) {
    if (Math.abs(batting - pitching) <= 5 && avg >= 45) parts.push("Balanced");
    else if (batting >= pitching + 10) parts.push("Bat Heavy");
    else if (pitching >= batting + 10) parts.push("Arm Heavy");
  }
  return parts.join(" | ");
}

export function calcFarmRankings(prospectPool, thresholds, dollarValues, teams) {
  const byTeam = {};
  teams.forEach((t) => { byTeam[t] = []; });
  prospectPool.forEach((p) => {
    const org = p.meta?.org ?? p.ORG;
    if (org && org !== "-" && org !== "0") {
      if (!byTeam[org]) byTeam[org] = [];
      byTeam[org].push(p);
    }
  });

  const rankings = [];

  Object.entries(byTeam).forEach(([team, players]) => {
    const tierCounts = {};
    FV_TIERS.forEach((t) => { tierCounts[t.id] = 0; });
    let totalValue = 0;
    let hitValue = 0, pitValue = 0;
    let count50Plus = 0, count40Plus = 0;

    players.forEach((p) => {
      const fv = p._fv ?? p._baseVal ?? 0;
      const tierId = assignFVTier(fv, thresholds);
      if (!tierId) return;
      tierCounts[tierId] = (tierCounts[tierId] || 0) + 1;
      const dv = getDollarValue(tierId, p._poolType, dollarValues);
      totalValue += dv;
      if (p._poolType === "pitcher") pitValue += dv;
      else hitValue += dv;
      const tierIdx = FV_TIERS.findIndex((t) => t.id === tierId);
      if (tierIdx >= 0 && tierIdx <= 5) count50Plus++;
      if (tierIdx >= 0 && tierIdx <= 8) count40Plus++;
    });

    const tieredCount = Object.values(tierCounts).reduce((a, b) => a + b, 0);
    rankings.push({ team, totalValue, hitValue, pitValue, count50Plus, count40Plus, tierCounts, count: tieredCount });
  });

  const zScore = (vals) => {
    const n = vals.length;
    if (n < 2) return vals.map(() => 0);
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
    return vals.map((v) => (v - mean) / std);
  };

  const ceilVals = rankings.map((r) => {
    let val = 0;
    r.tierCounts && FV_TIERS.slice(0, 6).forEach((t) => {
      val += (r.tierCounts[t.id] || 0) * ((dollarValues[t.id]?.bat ?? 0) + (dollarValues[t.id]?.pit ?? 0)) / 2;
    });
    return val;
  });
  const floorVals = rankings.map((r) => r.count40Plus);
  const batVals = rankings.map((r) => r.hitValue);
  const pitVals = rankings.map((r) => r.pitValue);

  const ceilZ = zScore(ceilVals);
  const floorZ = zScore(floorVals);
  const batZ = zScore(batVals);
  const pitZ = zScore(pitVals);

  rankings.forEach((r, i) => {
    r.ceiling = Math.round(50 + 10 * ceilZ[i]);
    r.floor = Math.round(50 + 10 * floorZ[i]);
    r.batting = Math.round(50 + 10 * batZ[i]);
    r.pitching = Math.round(50 + 10 * pitZ[i]);
    r.report = buildScoutingReport(r.ceiling, r.floor, r.batting, r.pitching);
    r.avgValue = r.count > 0 ? r.totalValue / r.count : 0;
  });

  rankings.sort((a, b) => b.totalValue - a.totalValue);
  rankings.forEach((r, i) => { r.rank = i + 1; });

  return rankings;
}
