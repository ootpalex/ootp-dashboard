// ============================================================================
// DATA PROCESSING — processData, age calculation, best position, maturity
// ============================================================================
import { num, parseCSVBoolean } from "./helpers.js";
import { getMaxWar, getMaxWarP, getSpWar, getRpWar, getSpWarP, getRpWarP, getRunsP, isEligible } from "./accessors.js";
import { UNAFFILIATED, SP_REPLACEMENT_WAP, RP_ADVANTAGE_THRESHOLD, DEF_TIERS, TIER_RUNSP_MIN, TIER_DROP_ADVANTAGE } from "./constants.js";

export function isMatured(player, cs) {
  const age = player._age;
  if (age == null) return true;
  if (age >= cs.maxCurrentAge) return true;
  if (player._type === "hitter") {
    const cur = getMaxWar(player);
    const pot = getMaxWarP(player);
    if (cur != null && pot != null && cur > pot) return true;
  } else {
    const spCur = getSpWar(player);
    const spPot = getSpWarP(player);
    const rpCur = getRpWar(player);
    const rpPot = getRpWarP(player);
    const cur = spCur ?? rpCur;
    const pot = spPot ?? rpPot;
    if (cur != null && pot != null && cur > pot) return true;
  }
  return false;
}

export function isAgeMatured(player, cs) {
  const age = player._age;
  if (age == null) return true;
  if (age >= cs.maxCurrentAge) return true;
  return false;
}

export function calcBestPos(player, type, matured) {
  if (type === "hitter") {
    for (let ti = 0; ti < DEF_TIERS.length; ti++) {
      const tier = DEF_TIERS[ti];
      let bestInTier = -Infinity, bestTierPos = null;
      for (const pos of tier) {
        if (!isEligible(player, pos)) continue;
        const v = getRunsP(player, pos);
        if (v !== null && v > bestInTier) { bestInTier = v; bestTierPos = pos; }
      }
      if (bestTierPos === null) continue;
      if (bestInTier < TIER_RUNSP_MIN) continue;
      if (bestInTier >= 0) return bestTierPos;
      const nextTiers = DEF_TIERS.slice(ti + 1).flat();
      let bestNextTier = -Infinity;
      for (const pos of nextTiers) {
        if (!isEligible(player, pos)) continue;
        const v = getRunsP(player, pos);
        if (v !== null && v > bestNextTier) bestNextTier = v;
      }
      if (bestNextTier !== -Infinity && bestNextTier - bestInTier >= TIER_DROP_ADVANTAGE) continue;
      return bestTierPos;
    }
    if (isEligible(player, "DH")) return "DH";
    return (player.meta?.pos ?? player.POS) || "DH";
  }
  // Pitcher
  const isSPEligible = (player.starter ?? parseCSVBoolean(player.Starter)) || (player.starterP ?? parseCSVBoolean(player["Starter P"]));
  if (!isSPEligible) return "RP";
  const spVal = matured ? getSpWar(player) : getSpWarP(player);
  const rpVal = matured ? getRpWar(player) : getRpWarP(player);
  if (spVal != null || rpVal != null) {
    const sp = spVal ?? -Infinity;
    const rp = rpVal ?? -Infinity;
    if (sp >= SP_REPLACEMENT_WAP) {
      if (rp - sp > RP_ADVANTAGE_THRESHOLD) return "RP*";
      return "SP";
    }
    if (sp >= rp) return "SP";
    return "RP*";
  }
  return (player.meta?.pos ?? player.POS) || "RP";
}

export function processData(rawHitters, rawPitchers, filteredOrgs) {
  const excluded = filteredOrgs || new Set(["", "0"]);
  const hitters = rawHitters
    .filter((r) => {
      const name = r.meta?.name ?? r.Name;
      const org = r.meta?.org ?? r.ORG;
      return name && name.trim() !== "" && !excluded.has(org);
    })
    .map((r) => {
      const h = { ...r, _type: "hitter" };
      if (h.id !== undefined && h.ID === undefined) h.ID = h.id;
      h._age = r.meta?.age ?? num(r.Age);
      h._price = r.meta?.price ?? num(r.Price);
      h._bestPos = calcBestPos(h, "hitter");
      return h;
    });
  const pitchers = rawPitchers
    .filter((r) => {
      const name = r.meta?.name ?? r.Name;
      const org = r.meta?.org ?? r.ORG;
      return name && name.trim() !== "" && name !== "0" && !excluded.has(org);
    })
    .map((r) => {
      const p = { ...r, _type: "pitcher" };
      if (p.id !== undefined && p.ID === undefined) p.ID = p.id;
      p._age = r.meta?.age ?? num(r.Age);
      p._price = r.meta?.price ?? num(r.Price);
      p._bestPos = calcBestPos(p, "pitcher");
      return p;
    });
  const hitterIds = new Set(hitters.map(h => h.ID));
  const pitcherIds = new Set(pitchers.map(p => p.ID));
  hitters.forEach(h => {
    h._uid = h.ID + "-H";
    h._twoWay = pitcherIds.has(h.ID);
  });
  pitchers.forEach(p => {
    p._uid = p.ID + "-P";
    p._twoWay = hitterIds.has(p.ID);
  });

  const teamSet = new Set();
  [...hitters, ...pitchers].forEach((p) => { const org = p.meta?.org ?? p.ORG; if (org && !UNAFFILIATED.has(org)) teamSet.add(org); });
  return { hitters, pitchers, teams: [...teamSet].sort() };
}

export function calcExactAge(dob, gameDate) {
  if (!dob || !gameDate) return null;
  const d = new Date(dob);
  if (isNaN(d)) return null;
  const diffMs = gameDate.getTime() - d.getTime();
  return diffMs / (365.25 * 24 * 60 * 60 * 1000);
}

export function recomputeAges(data, gameDateStr) {
  if (!gameDateStr) return data;
  const gd = new Date(gameDateStr);
  if (isNaN(gd)) return data;
  const recompute = (player) => {
    const dob = player.meta?.dob ?? player.DOB;
    const exact = calcExactAge(dob, gd);
    if (exact != null && exact >= 0) return { ...player, _age: exact };
    return player;
  };
  return {
    ...data,
    hitters: data.hitters.map(recompute),
    pitchers: data.pitchers.map(recompute),
  };
}
