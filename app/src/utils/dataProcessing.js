// ============================================================================
// DATA PROCESSING — processData, age calculation, best position, maturity
// ============================================================================
import { num, parseCSVBoolean } from "./helpers.js";
import { getMaxWar, getMaxWarP, getSpWar, getRpWar, getSpWarP, getRpWarP, getRunsP, isEligible } from "./accessors.js";
import {
  UNAFFILIATED,
  SP_REPLACEMENT_WAP,
  RP_ADVANTAGE_THRESHOLD,
  DEF_SPECTRUM_BY_SLUG,
  DEF_SPECTRUM_DEFAULT,
  ARM_THR_BY_SLUG,
  ARM_THR_DEFAULT,
  BESTPOS_FIELD_ORDER,
} from "./constants.js";

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

// bestPos for hitters — Option B (Alex 2026-05-25; LOCKED 2026-05-28):
//   argmax over ELIGIBLE field positions of (RunsP + defSpectrum[pos]).
// DH only if eligible at NO field position. LF/RF leaf decided by arm-split
// (RF if OF arm ≥ league avg RF arm, else LF — RunsP can't split them because
// production centers each corner on its own peer group and the league deploys
// rangier/stronger-armed gloves at RF; arm is the real differentiator).
// Replaces the legacy tier-tree with its three magic numbers; the spectrum
// itself is data-derived per universe (see constants.js:DEF_SPECTRUM_BY_SLUG).
export function calcBestPos(player, type, matured, leagueSlug) {
  if (type === "hitter") {
    const spectrum = DEF_SPECTRUM_BY_SLUG[leagueSlug] || DEF_SPECTRUM_DEFAULT;
    let bestScore = -Infinity, bestPos = null;
    for (const pos of BESTPOS_FIELD_ORDER) {
      if (!isEligible(player, pos)) continue;
      const runsp = getRunsP(player, pos);
      if (runsp == null) continue;
      const score = runsp + (spectrum[pos] ?? 0);
      // Strict > so ties resolve in iteration order (hardest position wins).
      if (score > bestScore) { bestScore = score; bestPos = pos; }
    }
    if (bestPos === null) {
      if (isEligible(player, "DH")) return "DH";
      return (player.meta?.pos ?? player.POS) || "DH";
    }
    // LF/RF leaf — arm decides which label
    if (bestPos === "LF" || bestPos === "RF") {
      const armThr = ARM_THR_BY_SLUG[leagueSlug] ?? ARM_THR_DEFAULT;
      const arm = player.fieldingRatings?.ofArm;
      return (arm != null && arm >= armThr) ? "RF" : "LF";
    }
    return bestPos;
  }
  // Pitcher (unchanged)
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

export function processData(rawHitters, rawPitchers, filteredOrgs, leagueSlug) {
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
      h._bestPos = calcBestPos(h, "hitter", false, leagueSlug);
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
      p._bestPos = calcBestPos(p, "pitcher", false, leagueSlug);
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
