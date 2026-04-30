// ============================================================================
// PROSPECTS — Prospect pool building, tier assignment, farm rankings, scouting
// ============================================================================
import { num } from "./helpers.js";
import { getMaxWaa, getMaxWaaP, pickPitcherRole } from "./accessors.js";
import { FV_TIERS, FG_TIER_STATS } from "./constants.js";

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

export function buildProspectPool(data, iafaTag) {
  const hitPool = data.hitters.filter((h) => isProspect(h) && isInOrg(h, iafaTag)).map((h) => {
    const maxWAAP = getMaxWaaP(h);
    const maxWAA = getMaxWaa(h);
    return {
      ...h,
      _baseVal: maxWAAP ?? 0, _currentVal: maxWAA,
      _baseValDisplay: maxWAAP ?? 0, _currentValDisplay: maxWAA,
      _poolType: "hitter",
    };
  });
  const pitPool = data.pitchers.filter((p) => isProspect(p) && isInOrg(p, iafaTag)).map((p) => {
    const r = pickPitcherRole(p, null, null, 'best');
    return {
      ...p,
      _baseVal: r.waaPSort ?? 0, _currentVal: r.waaSort ?? r.waa ?? 0,
      _baseValDisplay: r.waaP ?? 0, _currentValDisplay: r.waa ?? 0,
      _role: r.role, _poolType: "pitcher",
    };
  });
  return [...hitPool, ...pitPool];
}

export function suggestThresholds(prospects, numTeams) {
  if (!prospects || prospects.length === 0) return {};
  const sorted = [...prospects].sort((a, b) => (b._fv ?? b._baseVal ?? 0) - (a._fv ?? a._baseVal ?? 0));
  const scale = numTeams / 30;
  const thresholds = {};
  let cumAvg = 0;
  for (const tier of FV_TIERS) {
    const stats = FG_TIER_STATS[tier.id];
    if (!stats) continue;
    cumAvg += stats.avg * scale;
    const cumHigh = cumAvg + 2 * stats.std * scale;
    const idx = Math.min(Math.round(cumHigh) - 1, sorted.length - 1);
    if (idx < 0) {
      thresholds[tier.id] = thresholds[FV_TIERS[FV_TIERS.indexOf(tier) - 1]?.id] ?? 999;
      continue;
    }
    const fv = sorted[idx]._fv ?? sorted[idx]._baseVal ?? 0;
    thresholds[tier.id] = Math.round(fv * 100) / 100;
  }
  let prev = Infinity;
  for (const tier of FV_TIERS) {
    if (thresholds[tier.id] >= prev) thresholds[tier.id] = prev - 0.01;
    prev = thresholds[tier.id];
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
